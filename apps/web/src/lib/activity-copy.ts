type ActivityCopySource = {
  title: string;
  description: string;
  source?: string | null;
};

const ACTIVITY_SECRET_PATTERNS: Array<{
  pattern: RegExp;
  replacement: string;
}> = [
  {
    pattern: /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi,
    replacement: "$1 [redacted]"
  },
  {
    pattern: /\bfg_(?:live|test)_[A-Za-z0-9_-]+\b/gi,
    replacement: "[redacted Forge token]"
  },
  {
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}\b/gi,
    replacement: "[redacted API key]"
  },
  {
    pattern:
      /(\b(?:password|passphrase|client[_ -]?secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token)\b\s*(?:=|:)\s*)([^\s,;]+)/gi,
    replacement: "$1[redacted]"
  },
  {
    pattern: /([?&](?:token|api_key|key|secret|password)=)[^&#\s]+/gi,
    replacement: "$1[redacted]"
  }
];

export function redactActivityText(value: string) {
  return ACTIVITY_SECRET_PATTERNS.reduce(
    (redacted, { pattern, replacement }) =>
      redacted.replace(pattern, replacement),
    value
  );
}

export function getExclusiveActivityEndDate(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    return undefined;
  }
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  );
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3])
  ) {
    return undefined;
  }
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function looksSynthetic(event: ActivityCopySource) {
  const combined =
    `${event.title} ${event.description} ${event.source ?? ""}`.toLowerCase();
  return (
    combined.includes("playwright") ||
    combined.includes("operator console") ||
    combined.includes("retroactive work logging")
  );
}

export function getReadableActivityTitle(event: ActivityCopySource) {
  if (looksSynthetic(event)) {
    return "Work log added";
  }
  return redactActivityText(event.title);
}

export function getReadableActivityDescription(event: ActivityCopySource) {
  if (looksSynthetic(event)) {
    return "This entry was added later so the work history stays complete and accurate.";
  }
  return redactActivityText(event.description);
}
