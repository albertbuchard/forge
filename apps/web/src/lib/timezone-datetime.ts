export function validTimeZone(timeZone?: string | null) {
  const candidate = timeZone?.trim();
  if (!candidate) {
    return undefined;
  }
  if (candidate !== "UTC" && !candidate.includes("/")) {
    return undefined;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(
      new Date(0)
    );
    return candidate;
  } catch {
    return undefined;
  }
}

function partMapFor(date: Date, timeZone?: string | null) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: validTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  ) as Record<string, string>;
}

function timeZoneOffsetMs(date: Date, timeZone?: string | null) {
  const parts = partMapFor(date, timeZone);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - date.getTime();
}

export function localDateKeyInTimeZone(
  value: string | Date,
  timeZone?: string | null
) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const parts = partMapFor(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatDateTimeInputInTimeZone(
  value: string,
  timeZone?: string | null
) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const parts = partMapFor(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function parseDateTimeInputInTimeZone(
  value: string,
  timeZone?: string | null,
  options: {
    disambiguation?: "earlier" | "later" | "reject";
    preferredInstant?: string | null;
  } = {}
) {
  const resolution = resolveDateTimeInputInTimeZone(value, timeZone);
  if (resolution.kind !== "exact" && resolution.kind !== "ambiguous") {
    return null;
  }
  if (resolution.kind === "exact") {
    return resolution.instants[0];
  }
  const preferredDate = options.preferredInstant
    ? new Date(options.preferredInstant)
    : null;
  const preferredInstant =
    preferredDate && !Number.isNaN(preferredDate.getTime())
      ? preferredDate.toISOString()
      : null;
  if (preferredInstant && resolution.instants.includes(preferredInstant)) {
    return preferredInstant;
  }
  if (options.disambiguation === "reject") {
    return null;
  }
  return options.disambiguation === "later"
    ? (resolution.instants.at(-1) ?? null)
    : resolution.instants[0];
}

export type DateTimeInputResolution =
  | { kind: "exact"; instants: [string] }
  | { kind: "ambiguous"; instants: [string, string, ...string[]] }
  | { kind: "nonexistent"; instants: [] }
  | { kind: "invalid"; instants: [] }
  | { kind: "invalid_timezone"; instants: [] };

export function resolveDateTimeInputInTimeZone(
  value: string,
  timeZone?: string | null
): DateTimeInputResolution {
  const match = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return { kind: "invalid", instants: [] };
  }
  const resolvedTimeZone = validTimeZone(timeZone);
  if (!resolvedTimeZone) {
    return { kind: "invalid_timezone", instants: [] };
  }
  const [, year, month, day, hour, minute, second = "00"] = match;
  const localAsUtc = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    )
  );
  if (
    Number.isNaN(localAsUtc.getTime()) ||
    localAsUtc.getUTCFullYear() !== Number(year) ||
    localAsUtc.getUTCMonth() + 1 !== Number(month) ||
    localAsUtc.getUTCDate() !== Number(day) ||
    localAsUtc.getUTCHours() !== Number(hour) ||
    localAsUtc.getUTCMinutes() !== Number(minute) ||
    localAsUtc.getUTCSeconds() !== Number(second)
  ) {
    return { kind: "invalid", instants: [] };
  }
  const offsets = new Set<number>();
  for (
    let hoursFromWallTime = -36;
    hoursFromWallTime <= 36;
    hoursFromWallTime += 1
  ) {
    offsets.add(
      timeZoneOffsetMs(
        new Date(localAsUtc.getTime() + hoursFromWallTime * 60 * 60 * 1000),
        resolvedTimeZone
      )
    );
  }
  const expected = `${year}-${month}-${day}T${hour}:${minute}`;
  const instants = Array.from(offsets)
    .map((offset) => new Date(localAsUtc.getTime() - offset).toISOString())
    .filter(
      (instant) =>
        formatDateTimeInputInTimeZone(instant, resolvedTimeZone) === expected
    )
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

export function isSameDateInTimeZone(
  start: string | Date,
  end: string | Date,
  timeZone?: string | null
) {
  return (
    localDateKeyInTimeZone(start, timeZone) ===
    localDateKeyInTimeZone(end, timeZone)
  );
}

export function formatDateInTimeZone(
  value: string,
  timeZone?: string | null,
  locale?: string
) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: validTimeZone(timeZone),
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

export function formatShortDateInTimeZone(
  value: string,
  timeZone?: string | null,
  locale?: string
) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: validTimeZone(timeZone),
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

export function formatTimeInTimeZone(
  value: string,
  timeZone?: string | null,
  locale?: string
) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: validTimeZone(timeZone),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(value));
}
