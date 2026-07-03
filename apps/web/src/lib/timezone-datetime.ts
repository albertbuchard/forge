function validTimeZone(timeZone?: string | null) {
  const candidate = timeZone?.trim();
  if (!candidate) {
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
  timeZone?: string | null
) {
  const match = value
    .trim()
    .match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
    );
  if (!match) {
    return null;
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
  if (Number.isNaN(localAsUtc.getTime())) {
    return null;
  }
  let instant = new Date(
    localAsUtc.getTime() - timeZoneOffsetMs(localAsUtc, timeZone)
  );
  instant = new Date(
    localAsUtc.getTime() - timeZoneOffsetMs(instant, timeZone)
  );
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
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
  timeZone?: string | null
) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: validTimeZone(timeZone),
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

export function formatShortDateInTimeZone(
  value: string,
  timeZone?: string | null
) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: validTimeZone(timeZone),
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

export function formatTimeInTimeZone(
  value: string,
  timeZone?: string | null
) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: validTimeZone(timeZone),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(value));
}
