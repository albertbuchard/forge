function normalizeNameKey(value) {
    return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
function cleanLabel(value) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}
function readBaseCalendarName(value) {
    return cleanLabel(value) ?? "Unnamed calendar";
}
function shortCalendarProviderLabel(provider) {
    switch (provider) {
        case "google":
            return "Google";
        case "apple":
            return "Apple";
        case "microsoft":
            return "Microsoft";
        case "caldav":
        default:
            return "CalDAV";
    }
}
function readUrlQualifier(value) {
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
    }
    catch {
        return trimmed;
    }
}
function joinQualifier(parts) {
    const cleaned = parts
        .map(cleanLabel)
        .filter((part) => Boolean(part));
    return cleaned.length > 0 ? cleaned.join(" · ") : null;
}
function selectUniqueQualifier(group) {
    const selectors = [
        (entry) => entry.providerLabel,
        (entry) => joinQualifier([entry.providerLabel, entry.accountLabel]),
        (entry) => joinQualifier([entry.providerLabel, entry.connectionLabel]),
        (entry) => entry.connectionLabel,
        (entry) => entry.accountLabel,
        (entry) => readUrlQualifier(entry.url),
        (entry) => entry.url
    ];
    for (const select of selectors) {
        const qualifiers = group.map(select);
        if (qualifiers.some((qualifier) => !cleanLabel(qualifier))) {
            continue;
        }
        const normalized = qualifiers.map((qualifier) => normalizeNameKey(qualifier));
        if (new Set(normalized).size === group.length) {
            return qualifiers;
        }
    }
    return group.map((entry, index) => joinQualifier([entry.providerLabel, `${index + 1}`]) ?? `${index + 1}`);
}
function buildDedupedNameMap(entries) {
    const deduped = new Map();
    const groups = new Map();
    for (const entry of entries) {
        const key = normalizeNameKey(entry.baseName);
        const bucket = groups.get(key) ?? [];
        bucket.push(entry);
        groups.set(key, bucket);
    }
    for (const group of groups.values()) {
        if (group.length === 1) {
            deduped.set(group[0].id, group[0].baseName);
            continue;
        }
        const qualifiers = selectUniqueQualifier(group);
        group.forEach((entry, index) => {
            deduped.set(entry.id, `${entry.baseName} (${qualifiers[index]})`);
        });
    }
    return deduped;
}
export function dedupeCalendarDiscoveryPayload(payload) {
    const dedupedNames = buildDedupedNameMap(payload.calendars.map((calendar) => ({
        id: calendar.url,
        baseName: readBaseCalendarName(calendar.displayName),
        providerLabel: shortCalendarProviderLabel(payload.provider),
        connectionLabel: null,
        accountLabel: payload.accountLabel,
        url: calendar.url
    })));
    return {
        ...payload,
        calendars: payload.calendars.map((calendar) => ({
            ...calendar,
            dedupedName: dedupedNames.get(calendar.url) ??
                readBaseCalendarName(calendar.displayName)
        }))
    };
}
export function dedupeCalendarResourcesWithConnections(calendars, connections) {
    const connectionsById = new Map(connections.map((connection) => [connection.id, connection]));
    const dedupedNames = buildDedupedNameMap(calendars.map((calendar) => {
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
    }));
    return calendars.map((calendar) => ({
        ...calendar,
        dedupedName: dedupedNames.get(calendar.id) ?? readBaseCalendarName(calendar.title)
    }));
}
export function dedupeCalendarOverviewPayload(payload) {
    return {
        ...payload,
        calendars: dedupeCalendarResourcesWithConnections(payload.calendars, payload.connections)
    };
}
export function readCalendarDisplayName(calendar) {
    if ("title" in calendar) {
        return (cleanLabel(calendar.dedupedName) ?? readBaseCalendarName(calendar.title));
    }
    return (cleanLabel(calendar.dedupedName) ??
        readBaseCalendarName(calendar.displayName));
}
