export type ZonedDateTimeResolution =
  | { kind: "exact"; instants: [string] }
  | { kind: "ambiguous"; instants: [string, string, ...string[]] }
  | { kind: "nonexistent"; instants: [] }
  | { kind: "invalid"; instants: [] }
  | { kind: "invalid_timezone"; instants: [] };

export function isValidTimeZone(timeZone: string) {
  if (timeZone !== "UTC" && !timeZone.includes("/")) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  ) as Record<string, string>;
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second)
  };
}

function parseLocalDateTime(value: string) {
  const match = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? "0")
  };
  const utc = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    )
  );
  if (
    utc.getUTCFullYear() !== parts.year ||
    utc.getUTCMonth() + 1 !== parts.month ||
    utc.getUTCDate() !== parts.day ||
    utc.getUTCHours() !== parts.hour ||
    utc.getUTCMinutes() !== parts.minute ||
    utc.getUTCSeconds() !== parts.second
  ) {
    return null;
  }
  return { parts, localAsUtcMs: utc.getTime() };
}

export function resolveZonedDateTime(
  value: string,
  timeZone: string
): ZonedDateTimeResolution {
  const parsed = parseLocalDateTime(value);
  if (!parsed) {
    return { kind: "invalid", instants: [] };
  }
  if (!isValidTimeZone(timeZone)) {
    return { kind: "invalid_timezone", instants: [] };
  }

  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 1) {
    const sample = new Date(parsed.localAsUtcMs + hours * 60 * 60 * 1000);
    const parts = localParts(sample, timeZone);
    offsets.add(
      Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second
      ) - sample.getTime()
    );
  }

  const instants = Array.from(offsets)
    .map((offset) => new Date(parsed.localAsUtcMs - offset))
    .filter((candidate) => {
      const parts = localParts(candidate, timeZone);
      return Object.entries(parsed.parts).every(
        ([key, value]) => parts[key as keyof typeof parts] === value
      );
    })
    .map((candidate) => candidate.toISOString())
    .filter((instant, index, values) => values.indexOf(instant) === index)
    .sort();

  if (instants.length === 0) {
    return { kind: "nonexistent", instants: [] };
  }
  if (instants.length === 1) {
    return { kind: "exact", instants: [instants[0]!] };
  }
  return {
    kind: "ambiguous",
    instants: instants as [string, string, ...string[]]
  };
}

export function providerDateToInstant(
  value:
    | {
        date?: string | null;
        dateTime?: string | null;
        timeZone?: string | null;
      }
    | null
    | undefined,
  fallbackTimeZone: string
) {
  if (!value) {
    return null;
  }
  if (typeof value.dateTime === "string" && value.dateTime.trim()) {
    const instant = new Date(value.dateTime);
    return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
  }
  if (typeof value.date === "string" && value.date.trim()) {
    const timeZone = value.timeZone?.trim() || fallbackTimeZone;
    const resolution = resolveZonedDateTime(
      `${value.date.trim()}T00:00`,
      timeZone
    );
    if (resolution.kind === "exact" || resolution.kind === "ambiguous") {
      return resolution.instants[0];
    }
  }
  return null;
}
