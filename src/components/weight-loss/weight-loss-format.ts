export function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function formatNumber(value: unknown, digits = 0) {
  const number = numeric(value);
  return number === null ? "n/a" : number.toFixed(digits);
}

export function formatSigned(value: unknown, digits = 0) {
  const number = numeric(value);
  if (number === null) {
    return "n/a";
  }
  return `${number > 0 ? "+" : ""}${number.toFixed(digits)}`;
}

export function scoreLabel(value: unknown) {
  const number = numeric(value);
  return number === null ? "n/a" : `${number.toFixed(1)}/10`;
}

export function insightArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
      )
    : [];
}
