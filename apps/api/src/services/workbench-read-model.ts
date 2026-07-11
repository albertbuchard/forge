import type { AiConnectorRun, AiConnectorRunResult } from "../types.js";

const SENSITIVE_KEY_PATTERN =
  /^(?:api[_-]?key|authorization|cookie|credential|password|passphrase|private[_-]?key|secret|token)$/i;
const MAX_REDACTED_PATHS = 50;

type ReadLimits = {
  maxArrayItems: number;
  maxDepth: number;
  maxObjectKeys: number;
  maxStringLength: number;
};

export type WorkbenchReadMetadata = {
  contentType: "text" | "json" | "mixed";
  originalBytes: number;
  returnedBytes: number;
  redacted: boolean;
  redactedPaths: string[];
  truncated: boolean;
};

export type WorkbenchRunSummary = {
  id: string;
  connectorId: string;
  mode: AiConnectorRun["mode"];
  status: AiConnectorRun["status"];
  conversationId: string | null;
  retryOfRunId: string | null;
  outputPreview: string;
  result: { primaryText: string } | null;
  hasResult: boolean;
  error: string | null;
  flowUpdatedAt: string | null;
  createdAt: string;
  completedAt: string | null;
};

function byteLength(value: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
  } catch {
    return 0;
  }
}

function sanitizeValue(
  value: unknown,
  limits: ReadLimits,
  state: { redactedPaths: string[]; truncated: boolean },
  path = "$",
  depth = 0
): unknown {
  if (depth > limits.maxDepth) {
    state.truncated = true;
    return "[truncated: depth limit]";
  }
  if (typeof value === "string") {
    if (value.length <= limits.maxStringLength) {
      return value;
    }
    state.truncated = true;
    return `${value.slice(0, limits.maxStringLength)}\n[truncated]`;
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > limits.maxArrayItems) {
      state.truncated = true;
    }
    return value
      .slice(0, limits.maxArrayItems)
      .map((entry, index) =>
        sanitizeValue(entry, limits, state, `${path}[${index}]`, depth + 1)
      );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > limits.maxObjectKeys) {
      state.truncated = true;
    }
    return Object.fromEntries(
      entries.slice(0, limits.maxObjectKeys).map(([key, entry]) => {
        const entryPath = `${path}.${key}`;
        if (SENSITIVE_KEY_PATTERN.test(key)) {
          if (state.redactedPaths.length < MAX_REDACTED_PATHS) {
            state.redactedPaths.push(entryPath);
          }
          return [key, "[redacted]"];
        }
        return [key, sanitizeValue(entry, limits, state, entryPath, depth + 1)];
      })
    );
  }
  return String(value);
}

export function buildBoundedWorkbenchValue<T>(
  value: T,
  limits: ReadLimits
): { value: T; metadata: WorkbenchReadMetadata } {
  const state = { redactedPaths: [] as string[], truncated: false };
  const bounded = sanitizeValue(value, limits, state) as T;
  const hasText =
    typeof value === "string" ||
    (Boolean(value) &&
      typeof value === "object" &&
      Object.values(value as Record<string, unknown>).some(
        (entry) => typeof entry === "string"
      ));
  const hasJson = Boolean(value) && typeof value === "object";
  return {
    value: bounded,
    metadata: {
      contentType: hasText && hasJson ? "mixed" : hasJson ? "json" : "text",
      originalBytes: byteLength(value),
      returnedBytes: byteLength(bounded),
      redacted: state.redactedPaths.length > 0,
      redactedPaths: state.redactedPaths,
      truncated: state.truncated
    }
  };
}

export function buildWorkbenchRunSummary(input: {
  id: string;
  connectorId: string;
  mode: AiConnectorRun["mode"];
  status: AiConnectorRun["status"];
  conversationId: string | null;
  retryOfRunId: string | null;
  outputPreview: string | null;
  hasResult: boolean;
  error: string | null;
  flowUpdatedAt: string | null;
  createdAt: string;
  completedAt: string | null;
}): WorkbenchRunSummary {
  const boundedPreview = buildBoundedWorkbenchValue(input.outputPreview ?? "", {
    maxArrayItems: 1,
    maxDepth: 1,
    maxObjectKeys: 1,
    maxStringLength: 320
  }).value;
  const boundedError = buildBoundedWorkbenchValue(input.error ?? "", {
    maxArrayItems: 1,
    maxDepth: 1,
    maxObjectKeys: 1,
    maxStringLength: 500
  }).value;
  return {
    id: input.id,
    connectorId: input.connectorId,
    mode: input.mode,
    status: input.status,
    conversationId: input.conversationId,
    retryOfRunId: input.retryOfRunId,
    outputPreview: boundedPreview,
    result: input.hasResult ? { primaryText: boundedPreview } : null,
    hasResult: input.hasResult,
    error: boundedError || null,
    flowUpdatedAt: input.flowUpdatedAt,
    createdAt: input.createdAt,
    completedAt: input.completedAt
  };
}

export function buildWorkbenchRunDetail(run: AiConnectorRun) {
  const bounded = buildBoundedWorkbenchValue(run, {
    maxArrayItems: 100,
    maxDepth: 8,
    maxObjectKeys: 100,
    maxStringLength: 16_000
  });
  return {
    run: bounded.value,
    readMetadata: bounded.metadata
  };
}

export function buildWorkbenchNodeSummary(
  nodeResult: AiConnectorRunResult["nodeResults"][number]
) {
  return {
    nodeId: nodeResult.nodeId,
    nodeType: nodeResult.nodeType,
    label: nodeResult.label,
    outputKeys: Object.keys(nodeResult.outputMap).slice(0, 100),
    outputPreview: buildBoundedWorkbenchValue(nodeResult.primaryText, {
      maxArrayItems: 1,
      maxDepth: 1,
      maxObjectKeys: 1,
      maxStringLength: 320
    }).value,
    hasPayload: nodeResult.payload !== null,
    error: nodeResult.error,
    timingMs: nodeResult.timingMs ?? null
  };
}

export function buildWorkbenchNodeDetail(
  nodeResult: AiConnectorRunResult["nodeResults"][number]
) {
  const bounded = buildBoundedWorkbenchValue(nodeResult, {
    maxArrayItems: 100,
    maxDepth: 8,
    maxObjectKeys: 100,
    maxStringLength: 16_000
  });
  return {
    nodeResult: bounded.value,
    readMetadata: bounded.metadata
  };
}

export function buildWorkbenchOutputDetail(result: AiConnectorRunResult) {
  const bounded = buildBoundedWorkbenchValue(result, {
    maxArrayItems: 100,
    maxDepth: 8,
    maxObjectKeys: 100,
    maxStringLength: 32_000
  });
  return {
    output: bounded.value,
    readMetadata: bounded.metadata
  };
}
