import type {
  CalendarConnection,
  CalendarDiscoveryCalendar,
  CalendarDiscoveryPayload,
  CalendarOverviewPayload,
  CalendarProvider,
  CalendarResource
} from "./types";

type CalendarNameSeed = {
  id: string;
  baseName: string;
  providerLabel: string | null;
  connectionLabel: string | null;
  accountLabel: string | null;
  url: string | null;
};

function normalizeNameKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function cleanLabel(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readBaseCalendarName(value: string | null | undefined) {
  return cleanLabel(value) ?? "Unnamed calendar";
}

function shortCalendarProviderLabel(provider: CalendarProvider) {
  switch (provider) {
    case "google":
      return "Google";
    case "apple":
      return "Apple";
    case "microsoft":
      return "Microsoft";
    case "macos_local":
      return "Mac";
    case "caldav":
    default:
      return "CalDAV";
  }
}

function readUrlQualifier(value: string | null) {
  const trimmed = cleanLabel(value);
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    const segments = url.pathname
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);
    const lastSegment = segments.at(-1);
    if (lastSegment) {
      return `${url.host}/${decodeURIComponent(lastSegment)}`;
    }
    return url.host;
  } catch {
    return trimmed;
  }
}

function joinQualifier(parts: Array<string | null | undefined>) {
  const cleaned = parts
    .map(cleanLabel)
    .filter((part): part is string => Boolean(part));
  return cleaned.length > 0 ? cleaned.join(" · ") : null;
}

function selectUniqueQualifier(group: CalendarNameSeed[]) {
  const selectors = [
    (entry: CalendarNameSeed) => entry.providerLabel,
    (entry: CalendarNameSeed) =>
      joinQualifier([entry.providerLabel, entry.accountLabel]),
    (entry: CalendarNameSeed) =>
      joinQualifier([entry.providerLabel, entry.connectionLabel]),
    (entry: CalendarNameSeed) => entry.connectionLabel,
    (entry: CalendarNameSeed) => entry.accountLabel,
    (entry: CalendarNameSeed) => readUrlQualifier(entry.url),
    (entry: CalendarNameSeed) => entry.url
  ];

  for (const select of selectors) {
    const qualifiers = group.map(select);
    if (qualifiers.some((qualifier) => !cleanLabel(qualifier))) {
      continue;
    }

    const normalized = qualifiers.map((qualifier) =>
      normalizeNameKey(qualifier!)
    );
    if (new Set(normalized).size === group.length) {
      return qualifiers as string[];
    }
  }

  return group.map((entry, index) =>
    joinQualifier([entry.providerLabel, `${index + 1}`]) ?? `${index + 1}`
  );
}

function buildDedupedNameMap(entries: CalendarNameSeed[]) {
  const deduped = new Map<string, string>();
  const groups = new Map<string, CalendarNameSeed[]>();

  for (const entry of entries) {
    const key = normalizeNameKey(entry.baseName);
    const bucket = groups.get(key) ?? [];
    bucket.push(entry);
    groups.set(key, bucket);
  }

  for (const group of groups.values()) {
    if (group.length === 1) {
      deduped.set(group[0]!.id, group[0]!.baseName);
      continue;
    }

    const qualifiers = selectUniqueQualifier(group);
    group.forEach((entry, index) => {
      deduped.set(entry.id, `${entry.baseName} (${qualifiers[index]})`);
    });
  }

  return deduped;
}

export function dedupeCalendarDiscoveryPayload(
  payload: CalendarDiscoveryPayload
): CalendarDiscoveryPayload {
  const dedupedNames = buildDedupedNameMap(
    payload.calendars.map((calendar) => ({
      id: calendar.url,
      baseName: readBaseCalendarName(calendar.displayName),
      providerLabel: shortCalendarProviderLabel(payload.provider),
      connectionLabel: null,
      accountLabel: payload.accountLabel,
      url: calendar.url
    }))
  );

  return {
    ...payload,
    calendars: payload.calendars.map((calendar) => ({
      ...calendar,
      dedupedName:
        dedupedNames.get(calendar.url) ??
        readBaseCalendarName(calendar.displayName)
    }))
  };
}

export function dedupeCalendarResourcesWithConnections(
  calendars: CalendarResource[],
  connections: CalendarConnection[]
): CalendarResource[] {
  const connectionsById = new Map(
    connections.map((connection) => [connection.id, connection])
  );
  const dedupedNames = buildDedupedNameMap(
    calendars.map((calendar) => {
      const connection = connectionsById.get(calendar.connectionId);
      return {
        id: calendar.id,
        baseName: readBaseCalendarName(calendar.title),
        providerLabel: connection
          ? shortCalendarProviderLabel(connection.provider)
          : null,
        connectionLabel: connection?.label ?? null,
        accountLabel: connection?.accountLabel ?? null,
        url: calendar.remoteId
      };
    })
  );

  return calendars.map((calendar) => ({
    ...calendar,
    dedupedName:
      dedupedNames.get(calendar.id) ?? readBaseCalendarName(calendar.title)
  }));
}

export function dedupeCalendarOverviewPayload(
  payload: CalendarOverviewPayload
): CalendarOverviewPayload {
  return {
    ...payload,
    calendars: dedupeCalendarResourcesWithConnections(
      payload.calendars,
      payload.connections
    )
  };
}

export function readCalendarDisplayName(
  calendar:
    | Pick<CalendarDiscoveryCalendar, "displayName" | "dedupedName">
    | Pick<CalendarResource, "title" | "dedupedName">
) {
  if ("title" in calendar) {
    return (
      cleanLabel(calendar.dedupedName) ?? readBaseCalendarName(calendar.title)
    );
  }

  return (
    cleanLabel(calendar.dedupedName) ??
    readBaseCalendarName(calendar.displayName)
  );
}
