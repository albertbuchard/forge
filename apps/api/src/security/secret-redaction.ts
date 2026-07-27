const SENSITIVE_KEY =
  /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passphrase|authorization|cookie|private[_-]?key|secret|secret[_-]?value|token)$/i;
const SENSITIVE_ASSIGNMENT =
  /(["']?)(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passphrase|authorization|cookie|private[_-]?key|secret|token)\1(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}]+)/gi;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;

export type SecretRedactionResult<T> = {
  value: T;
  redactedPaths: readonly string[];
  truncated: boolean;
};

function redactString(value: string) {
  return value
    .replace(BEARER_VALUE, "Bearer [redacted]")
    .replace(
      SENSITIVE_ASSIGNMENT,
      (
        _match,
        keyQuote: string,
        key: string,
        separator: string,
        encodedValue: string
      ) => {
        const valueQuote = /^["']/u.test(encodedValue)
          ? encodedValue[0]
          : "";
        return `${keyQuote}${key}${keyQuote}${separator}${valueQuote}[redacted]${valueQuote}`;
      }
    );
}

export function redactSecretValues<T>(
  input: T,
  options: {
    maximumDepth?: number;
    maximumArrayItems?: number;
    maximumObjectKeys?: number;
  } = {}
): SecretRedactionResult<T> {
  const maximumDepth = options.maximumDepth ?? 12;
  const maximumArrayItems = options.maximumArrayItems ?? 1_000;
  const maximumObjectKeys = options.maximumObjectKeys ?? 1_000;
  const redactedPaths: string[] = [];
  let truncated = false;
  const ancestors = new WeakSet<object>();

  const visit = (value: unknown, path: string, depth: number): unknown => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
      ) {
        try {
          return JSON.stringify(
            visit(JSON.parse(trimmed), `${path}.[serialized]`, depth + 1)
          );
        } catch {
          // Fall through to bounded pattern redaction for non-JSON diagnostics.
        }
      }
      return redactString(value);
    }
    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }
    if (
      (Array.isArray(value) || typeof value === "object") &&
      ancestors.has(value)
    ) {
      return "[circular]";
    }
    if (depth > maximumDepth) {
      truncated = true;
      return "[truncated]";
    }
    if (Array.isArray(value)) {
      ancestors.add(value);
      const bounded = value
        .slice(0, maximumArrayItems)
        .map((entry, index) => visit(entry, `${path}[${index}]`, depth + 1));
      if (value.length > maximumArrayItems) truncated = true;
      ancestors.delete(value);
      return bounded;
    }
    if (typeof value === "object") {
      ancestors.add(value);
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length > maximumObjectKeys) truncated = true;
      const result: Record<string, unknown> = {};
      for (const [key, entry] of entries.slice(0, maximumObjectKeys)) {
        const entryPath = path ? `${path}.${key}` : key;
        if (SENSITIVE_KEY.test(key)) {
          result[key] = "[redacted]";
          redactedPaths.push(entryPath);
        } else {
          result[key] = visit(entry, entryPath, depth + 1);
        }
      }
      ancestors.delete(value);
      return result;
    }
    return String(value);
  };

  return Object.freeze({
    value: visit(input, "", 0) as T,
    redactedPaths: Object.freeze(redactedPaths),
    truncated
  });
}
