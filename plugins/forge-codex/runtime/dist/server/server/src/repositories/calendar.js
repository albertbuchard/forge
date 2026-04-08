import { randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { recordActivityEvent } from "./activity-events.js";
import { decorateOwnedEntity, filterOwnedEntities, inferFirstOwnedUserId, setEntityOwner } from "./entity-ownership.js";
import { getProjectById } from "./projects.js";
import { getTaskById } from "./tasks.js";
import { calendarConnectionSchema, calendarContextConflictSchema, calendarEventSchema, calendarEventLinkSchema, calendarEventSourceSchema, calendarOverviewPayloadSchema, calendarSchema, calendarSchedulingRulesSchema, taskTimeboxSchema, workBlockInstanceSchema, workBlockTemplateSchema } from "../types.js";
const DEFAULT_SCHEDULING_RULES = {
    allowWorkBlockKinds: [],
    blockWorkBlockKinds: [],
    allowCalendarIds: [],
    blockCalendarIds: [],
    allowEventTypes: [],
    blockEventTypes: [],
    allowEventKeywords: [],
    blockEventKeywords: [],
    allowAvailability: [],
    blockAvailability: []
};
function nowIso() {
    return new Date().toISOString();
}
function dateOnly(value) {
    return value.toISOString().slice(0, 10);
}
function dateOnlyToUtcDate(value) {
    const [yearText, monthText, dayText] = value.split("-");
    return new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
}
function normalizeTimezone(value) {
    const normalized = value?.trim();
    return normalized && normalized.length > 0 ? normalized : "UTC";
}
function mapConnection(row) {
    const base = calendarConnectionSchema.parse({
        id: row.id,
        provider: row.provider,
        label: row.label,
        accountLabel: row.account_label,
        status: row.status,
        config: JSON.parse(row.config_json || "{}"),
        forgeCalendarId: row.forge_calendar_id,
        lastSyncedAt: row.last_synced_at,
        lastSyncError: row.last_sync_error,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
    return {
        ...base,
        credentialsSecretId: row.credentials_secret_id
    };
}
function mapCalendar(row) {
    return calendarSchema.parse({
        id: row.id,
        connectionId: row.connection_id,
        remoteId: row.remote_id,
        title: row.title,
        description: row.description,
        color: row.color,
        timezone: normalizeTimezone(row.timezone),
        isPrimary: Boolean(row.is_primary),
        canWrite: Boolean(row.can_write),
        selectedForSync: Boolean(row.selected_for_sync),
        forgeManaged: Boolean(row.forge_managed),
        lastSyncedAt: row.last_synced_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
function mapEventSource(row) {
    return calendarEventSourceSchema.parse({
        id: row.id,
        provider: row.provider,
        connectionId: row.connection_id,
        calendarId: row.calendar_id,
        remoteCalendarId: row.remote_calendar_id,
        remoteEventId: row.remote_event_id,
        remoteUid: row.remote_uid,
        recurrenceInstanceId: row.recurrence_instance_id,
        isMasterRecurring: Boolean(row.is_master_recurring),
        remoteHref: row.remote_href,
        remoteEtag: row.remote_etag,
        syncState: row.sync_state,
        lastSyncedAt: row.last_synced_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
function mapEventLink(row) {
    return calendarEventLinkSchema.parse({
        id: row.id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        relationshipType: row.relationship_type,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
function listEventSourcesForEvent(eventId) {
    const rows = getDatabase()
        .prepare(`SELECT id, forge_event_id, provider, connection_id, calendar_id, remote_calendar_id, remote_event_id, remote_uid,
              recurrence_instance_id, is_master_recurring, remote_href, remote_etag, sync_state, raw_payload_json,
              last_synced_at, created_at, updated_at
       FROM forge_event_sources
       WHERE forge_event_id = ?
       ORDER BY updated_at DESC, created_at DESC`)
        .all(eventId);
    return rows.map(mapEventSource);
}
function listEventLinksForEvent(eventId) {
    const rows = getDatabase()
        .prepare(`SELECT id, forge_event_id, entity_type, entity_id, relationship_type, created_at, updated_at
       FROM forge_event_links
       WHERE forge_event_id = ?
       ORDER BY updated_at DESC, created_at DESC`)
        .all(eventId);
    return rows.map(mapEventLink);
}
function mapEvent(row) {
    const sourceMappings = listEventSourcesForEvent(row.id);
    const primarySource = sourceMappings[0] ?? null;
    return calendarEventSchema.parse({
        id: row.id,
        connectionId: row.preferred_connection_id ?? primarySource?.connectionId ?? null,
        calendarId: row.preferred_calendar_id ?? primarySource?.calendarId ?? null,
        remoteId: primarySource?.remoteEventId ?? null,
        ownership: row.ownership,
        originType: row.origin_type,
        status: row.status,
        title: row.title,
        description: row.description,
        location: row.location,
        place: {
            label: row.place_label,
            address: row.place_address,
            timezone: row.place_timezone,
            latitude: row.place_latitude,
            longitude: row.place_longitude,
            source: row.place_source,
            externalPlaceId: row.place_external_id
        },
        startAt: row.start_at,
        endAt: row.end_at,
        timezone: normalizeTimezone(row.timezone),
        isAllDay: Boolean(row.is_all_day),
        availability: row.availability,
        eventType: row.event_type,
        categories: JSON.parse(row.categories_json || "[]"),
        sourceMappings,
        links: listEventLinksForEvent(row.id),
        remoteUpdatedAt: primarySource?.lastSyncedAt ?? null,
        deletedAt: row.deleted_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
function mapWorkBlockTemplate(row) {
    return workBlockTemplateSchema.parse({
        id: row.id,
        title: row.title,
        kind: row.kind,
        color: row.color,
        timezone: normalizeTimezone(row.timezone),
        weekDays: JSON.parse(row.weekdays_json || "[]"),
        startMinute: row.start_minute,
        endMinute: row.end_minute,
        startsOn: row.starts_on,
        endsOn: row.ends_on,
        blockingState: row.blocking_state,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
function mapTimebox(row) {
    return taskTimeboxSchema.parse({
        id: row.id,
        taskId: row.task_id,
        projectId: row.project_id,
        connectionId: row.connection_id,
        calendarId: row.calendar_id,
        remoteEventId: row.remote_event_id,
        linkedTaskRunId: row.linked_task_run_id,
        status: row.status,
        source: row.source,
        title: row.title,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        overrideReason: row.override_reason,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
function inferCalendarEventOwnerId(input) {
    return (input.userId ??
        inferFirstOwnedUserId((input.links ?? []).map((link) => ({
            entityType: link.entityType,
            entityId: link.entityId
        }))));
}
function inferTaskTimeboxOwnerId(input) {
    return (input.userId ??
        inferFirstOwnedUserId([
            { entityType: "task", entityId: input.taskId },
            { entityType: "project", entityId: input.projectId ?? null }
        ]));
}
function addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * 60 * 1000);
}
function normalizeRules(rules) {
    return calendarSchedulingRulesSchema.parse(rules ?? DEFAULT_SCHEDULING_RULES);
}
export function storeEncryptedSecret(secretId, cipherText, description = "") {
    const now = nowIso();
    getDatabase()
        .prepare(`INSERT INTO stored_secrets (id, cipher_text, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET cipher_text = excluded.cipher_text, description = excluded.description, updated_at = excluded.updated_at`)
        .run(secretId, cipherText, description, now, now);
}
export function readEncryptedSecret(secretId) {
    const row = getDatabase()
        .prepare(`SELECT id, cipher_text FROM stored_secrets WHERE id = ?`)
        .get(secretId);
    return row?.cipher_text;
}
export function deleteEncryptedSecret(secretId) {
    getDatabase().prepare(`DELETE FROM stored_secrets WHERE id = ?`).run(secretId);
}
export function listCalendarConnections() {
    const rows = getDatabase()
        .prepare(`SELECT id, provider, label, account_label, status, config_json, credentials_secret_id, forge_calendar_id,
              last_synced_at, last_sync_error, created_at, updated_at
       FROM calendar_connections
       ORDER BY created_at DESC`)
        .all();
    return rows.map(mapConnection);
}
export function getCalendarConnectionById(connectionId) {
    const row = getDatabase()
        .prepare(`SELECT id, provider, label, account_label, status, config_json, credentials_secret_id, forge_calendar_id,
              last_synced_at, last_sync_error, created_at, updated_at
       FROM calendar_connections
       WHERE id = ?`)
        .get(connectionId);
    return row ? mapConnection(row) : undefined;
}
export function createCalendarConnectionRecord(input) {
    const now = nowIso();
    const id = `calconn_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    getDatabase()
        .prepare(`INSERT INTO calendar_connections (
         id, provider, label, account_label, status, config_json, credentials_secret_id, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, 'connected', ?, ?, ?, ?)`)
        .run(id, input.provider, input.label, input.accountLabel ?? "", JSON.stringify(input.config), input.credentialsSecretId, now, now);
    return getCalendarConnectionById(id);
}
export function updateCalendarConnectionRecord(connectionId, patch) {
    const current = getCalendarConnectionById(connectionId);
    if (!current) {
        return undefined;
    }
    const next = {
        label: patch.label ?? current.label,
        accountLabel: patch.accountLabel ?? current.accountLabel,
        status: patch.status ?? current.status,
        config: patch.config ?? current.config,
        forgeCalendarId: patch.forgeCalendarId === undefined ? current.forgeCalendarId : patch.forgeCalendarId,
        lastSyncedAt: patch.lastSyncedAt === undefined ? current.lastSyncedAt : patch.lastSyncedAt,
        lastSyncError: patch.lastSyncError === undefined ? current.lastSyncError : patch.lastSyncError,
        updatedAt: nowIso()
    };
    getDatabase()
        .prepare(`UPDATE calendar_connections
       SET label = ?, account_label = ?, status = ?, config_json = ?, forge_calendar_id = ?, last_synced_at = ?, last_sync_error = ?, updated_at = ?
       WHERE id = ?`)
        .run(next.label, next.accountLabel, next.status, JSON.stringify(next.config), next.forgeCalendarId, next.lastSyncedAt, next.lastSyncError, next.updatedAt, connectionId);
    return getCalendarConnectionById(connectionId);
}
export function deleteCalendarConnectionRecord(connectionId) {
    const current = getCalendarConnectionById(connectionId);
    if (!current) {
        return undefined;
    }
    getDatabase()
        .prepare(`UPDATE calendar_connections
       SET forge_calendar_id = NULL, updated_at = ?
       WHERE id = ?`)
        .run(nowIso(), connectionId);
    getDatabase().prepare(`DELETE FROM calendar_connections WHERE id = ?`).run(connectionId);
    return current;
}
export function deleteExternalEventsForConnection(connectionId) {
    const rows = getDatabase()
        .prepare(`SELECT id
       FROM forge_events
       WHERE ownership = 'external' AND preferred_connection_id = ?`)
        .all(connectionId);
    for (const row of rows) {
        getDatabase().prepare(`DELETE FROM forge_events WHERE id = ?`).run(row.id);
    }
    return rows.map((row) => row.id);
}
export function detachConnectionFromForgeEvents(connectionId) {
    const now = nowIso();
    getDatabase()
        .prepare(`UPDATE forge_events
       SET preferred_connection_id = NULL,
           preferred_calendar_id = NULL,
           updated_at = ?
       WHERE ownership = 'forge' AND preferred_connection_id = ?`)
        .run(now, connectionId);
    getDatabase()
        .prepare(`DELETE FROM forge_event_sources
       WHERE connection_id = ?`)
        .run(connectionId);
}
export function listCalendars(connectionId, options = {}) {
    const visibilityClause = options.includeUnselected
        ? ""
        : connectionId
            ? "AND (selected_for_sync = 1 OR forge_managed = 1)"
            : "WHERE (selected_for_sync = 1 OR forge_managed = 1)";
    const rows = getDatabase()
        .prepare(`SELECT id, connection_id, remote_id, title, description, color, timezone, is_primary, can_write, selected_for_sync, forge_managed,
              last_synced_at, created_at, updated_at
       FROM calendar_calendars
       ${connectionId ? `WHERE connection_id = ? ${visibilityClause}` : visibilityClause}
       ORDER BY forge_managed DESC, title ASC`)
        .all(...(connectionId ? [connectionId] : []));
    return rows.map(mapCalendar);
}
export function getCalendarById(calendarId) {
    const row = getDatabase()
        .prepare(`SELECT id, connection_id, remote_id, title, description, color, timezone, is_primary, can_write, selected_for_sync, forge_managed,
              last_synced_at, created_at, updated_at
       FROM calendar_calendars
       WHERE id = ?`)
        .get(calendarId);
    return row ? mapCalendar(row) : undefined;
}
function getDefaultWritableCalendar() {
    const row = getDatabase()
        .prepare(`SELECT id, connection_id, remote_id, title, description, color, timezone, is_primary, can_write, selected_for_sync, forge_managed,
              last_synced_at, created_at, updated_at
       FROM calendar_calendars
       WHERE can_write = 1
         AND (selected_for_sync = 1 OR forge_managed = 1)
       ORDER BY forge_managed DESC, is_primary DESC, title ASC
       LIMIT 1`)
        .get();
    return row ? mapCalendar(row) : undefined;
}
export function getCalendarByRemoteId(connectionId, remoteId) {
    const row = getDatabase()
        .prepare(`SELECT id, connection_id, remote_id, title, description, color, timezone, is_primary, can_write, selected_for_sync, forge_managed,
              last_synced_at, created_at, updated_at
       FROM calendar_calendars
       WHERE connection_id = ? AND remote_id = ?`)
        .get(connectionId, remoteId);
    return row ? mapCalendar(row) : undefined;
}
export function upsertCalendarRecord(connectionId, input) {
    const existing = getCalendarByRemoteId(connectionId, input.remoteId);
    const now = nowIso();
    if (existing) {
        getDatabase()
            .prepare(`UPDATE calendar_calendars
         SET title = ?, description = ?, color = ?, timezone = ?, is_primary = ?, can_write = ?, selected_for_sync = ?, forge_managed = ?, last_synced_at = ?, updated_at = ?
         WHERE id = ?`)
            .run(input.title, input.description ?? existing.description, input.color ?? existing.color, normalizeTimezone(input.timezone ?? existing.timezone), input.isPrimary ? 1 : 0, input.canWrite === false ? 0 : 1, input.selectedForSync === false ? 0 : 1, input.forgeManaged ? 1 : 0, now, now, existing.id);
        return getCalendarById(existing.id);
    }
    const id = `calendar_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    getDatabase()
        .prepare(`INSERT INTO calendar_calendars (
         id, connection_id, remote_id, title, description, color, timezone, is_primary, can_write, selected_for_sync, forge_managed, last_synced_at, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, connectionId, input.remoteId, input.title, input.description ?? "", input.color ?? "#7dd3fc", normalizeTimezone(input.timezone), input.isPrimary ? 1 : 0, input.canWrite === false ? 0 : 1, input.selectedForSync === false ? 0 : 1, input.forgeManaged ? 1 : 0, now, now, now);
    return getCalendarById(id);
}
export function listCalendarEvents(query) {
    const clauses = [
        "deleted_at IS NULL",
        `(ownership != 'external' OR preferred_calendar_id IS NULL OR EXISTS (
        SELECT 1
        FROM calendar_calendars visible_calendars
        WHERE visible_calendars.id = forge_events.preferred_calendar_id
          AND (visible_calendars.selected_for_sync = 1 OR visible_calendars.forge_managed = 1)
      ))`
    ];
    const params = [];
    if (query.connectionId) {
        clauses.push("(preferred_connection_id = ? OR EXISTS (SELECT 1 FROM forge_event_sources src WHERE src.forge_event_id = forge_events.id AND src.connection_id = ?))");
        params.push(query.connectionId);
        params.push(query.connectionId);
    }
    if (query.calendarId) {
        clauses.push("(preferred_calendar_id = ? OR EXISTS (SELECT 1 FROM forge_event_sources src WHERE src.forge_event_id = forge_events.id AND src.calendar_id = ?))");
        params.push(query.calendarId);
        params.push(query.calendarId);
    }
    clauses.push("end_at > ?");
    params.push(query.from);
    clauses.push("start_at < ?");
    params.push(query.to);
    const rows = getDatabase()
        .prepare(`SELECT id, preferred_connection_id, preferred_calendar_id, ownership, origin_type, status, title, description, location,
              place_label, place_address, place_timezone, place_latitude, place_longitude, place_source, place_external_id,
              start_at, end_at, timezone, is_all_day, availability, event_type, categories_json, deleted_at, created_at, updated_at
       FROM forge_events
       WHERE ${clauses.join(" AND ")}
       ORDER BY start_at ASC, title ASC`)
        .all(...params);
    return filterOwnedEntities("calendar_event", rows.map(mapEvent), query.userIds);
}
export function getCalendarEventById(eventId) {
    const row = getDatabase()
        .prepare(`SELECT id, preferred_connection_id, preferred_calendar_id, ownership, origin_type, status, title, description, location,
              place_label, place_address, place_timezone, place_latitude, place_longitude, place_source, place_external_id,
              start_at, end_at, timezone, is_all_day, availability, event_type, categories_json, deleted_at, created_at, updated_at
       FROM forge_events
       WHERE id = ?`)
        .get(eventId);
    return row ? decorateOwnedEntity("calendar_event", mapEvent(row)) : undefined;
}
export function getCalendarEventStorageRecord(eventId) {
    return getDatabase()
        .prepare(`SELECT id, preferred_connection_id, preferred_calendar_id, ownership, origin_type, status, title, description, location,
              place_label, place_address, place_timezone, place_latitude, place_longitude, place_source, place_external_id,
              start_at, end_at, timezone, is_all_day, availability, event_type, categories_json, deleted_at, created_at, updated_at
       FROM forge_events
       WHERE id = ?`)
        .get(eventId);
}
export function getCalendarEventByRemoteId(connectionId, calendarId, remoteId) {
    const row = getDatabase()
        .prepare(`SELECT forge_events.id, forge_events.preferred_connection_id, forge_events.preferred_calendar_id, forge_events.ownership,
              forge_events.origin_type, forge_events.status, forge_events.title, forge_events.description, forge_events.location,
              forge_events.place_label, forge_events.place_address, forge_events.place_timezone, forge_events.place_latitude,
              forge_events.place_longitude, forge_events.place_source, forge_events.place_external_id,
              forge_events.start_at, forge_events.end_at, forge_events.timezone, forge_events.is_all_day, forge_events.availability,
              forge_events.event_type, forge_events.categories_json, forge_events.deleted_at, forge_events.created_at, forge_events.updated_at
       FROM forge_event_sources
       INNER JOIN forge_events ON forge_events.id = forge_event_sources.forge_event_id
       WHERE forge_event_sources.connection_id = ? AND forge_event_sources.calendar_id = ? AND forge_event_sources.remote_event_id = ?`)
        .get(connectionId, calendarId, remoteId);
    return row ? mapEvent(row) : undefined;
}
export function listCalendarEventSources(eventId) {
    return listEventSourcesForEvent(eventId);
}
export function getPrimaryCalendarEventSource(eventId) {
    return listEventSourcesForEvent(eventId)[0] ?? null;
}
function upsertEventSource(input) {
    const now = nowIso();
    const existing = getDatabase()
        .prepare(`SELECT id
       FROM forge_event_sources
       WHERE provider = ? AND connection_id IS ? AND calendar_id IS ? AND remote_event_id = ?`)
        .get(input.provider, input.connectionId ?? null, input.calendarId ?? null, input.remoteEventId);
    if (existing) {
        getDatabase()
            .prepare(`UPDATE forge_event_sources
         SET forge_event_id = ?, remote_calendar_id = ?, remote_uid = ?, recurrence_instance_id = ?, is_master_recurring = ?,
             remote_href = ?, remote_etag = ?, sync_state = ?, raw_payload_json = ?, last_synced_at = ?, updated_at = ?
         WHERE id = ?`)
            .run(input.forgeEventId, input.remoteCalendarId ?? null, input.remoteUid ?? null, input.recurrenceInstanceId ?? null, input.isMasterRecurring ? 1 : 0, input.remoteHref ?? null, input.remoteEtag ?? null, input.syncState ?? "synced", input.rawPayloadJson ?? "{}", input.lastSyncedAt ?? null, now, existing.id);
        return existing.id;
    }
    const id = `evsrc_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    getDatabase()
        .prepare(`INSERT INTO forge_event_sources (
         id, forge_event_id, provider, connection_id, calendar_id, remote_calendar_id, remote_event_id, remote_uid,
         recurrence_instance_id, is_master_recurring, remote_href, remote_etag, sync_state, raw_payload_json, last_synced_at, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.forgeEventId, input.provider, input.connectionId ?? null, input.calendarId ?? null, input.remoteCalendarId ?? null, input.remoteEventId, input.remoteUid ?? null, input.recurrenceInstanceId ?? null, input.isMasterRecurring ? 1 : 0, input.remoteHref ?? null, input.remoteEtag ?? null, input.syncState ?? "synced", input.rawPayloadJson ?? "{}", input.lastSyncedAt ?? null, now, now);
    return id;
}
export function registerCalendarEventSourceProjection(input) {
    upsertEventSource(input);
    return listEventSourcesForEvent(input.forgeEventId);
}
export function markCalendarEventSourcesSyncState(forgeEventId, syncState) {
    const now = nowIso();
    getDatabase()
        .prepare(`UPDATE forge_event_sources
       SET sync_state = ?, updated_at = ?
       WHERE forge_event_id = ?`)
        .run(syncState, now, forgeEventId);
}
function replaceEventLinks(forgeEventId, links) {
    getDatabase().prepare(`DELETE FROM forge_event_links WHERE forge_event_id = ?`).run(forgeEventId);
    const now = nowIso();
    const insert = getDatabase().prepare(`INSERT INTO forge_event_links (id, forge_event_id, entity_type, entity_id, relationship_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const link of links) {
        insert.run(`evlink_${randomUUID().replaceAll("-", "").slice(0, 10)}`, forgeEventId, link.entityType, link.entityId, link.relationshipType ?? "context", now, now);
    }
}
export function upsertCalendarEventRecord(connectionId, input) {
    const calendar = getCalendarByRemoteId(connectionId, input.calendarRemoteId);
    if (!calendar) {
        throw new Error(`Calendar ${input.calendarRemoteId} is not registered for connection ${connectionId}`);
    }
    const connection = getCalendarConnectionById(connectionId);
    if (!connection) {
        throw new Error(`Calendar connection ${connectionId} is not registered`);
    }
    const existing = getCalendarEventByRemoteId(connectionId, calendar.id, input.remoteId);
    const now = nowIso();
    if (existing) {
        getDatabase()
            .prepare(`UPDATE forge_events
         SET preferred_connection_id = ?, preferred_calendar_id = ?, ownership = ?, origin_type = ?, status = ?, title = ?, description = ?, location = ?,
             place_label = ?, place_address = ?, place_timezone = ?, place_latitude = ?, place_longitude = ?, place_source = ?, place_external_id = ?,
             start_at = ?, end_at = ?, timezone = ?, is_all_day = ?, availability = ?, event_type = ?, categories_json = ?, deleted_at = ?, updated_at = ?
         WHERE id = ?`)
            .run(connectionId, calendar.id, input.ownership ?? existing.ownership, connection.provider, input.status ?? existing.status, input.title, input.description ?? "", input.location ?? "", input.location ?? "", "", "", null, null, "", "", input.startAt, input.endAt, calendar.timezone, input.isAllDay ? 1 : 0, input.availability ?? existing.availability, input.eventType ?? "", JSON.stringify(input.categories ?? []), input.deletedAt ?? null, now, existing.id);
        upsertEventSource({
            forgeEventId: existing.id,
            provider: connection.provider,
            connectionId,
            calendarId: calendar.id,
            remoteCalendarId: calendar.remoteId,
            remoteEventId: input.remoteId,
            remoteUid: typeof input.rawPayload?.uid === "string" ? String(input.rawPayload.uid) : null,
            recurrenceInstanceId: typeof input.rawPayload?.recurrenceid === "string"
                ? String(input.rawPayload.recurrenceid)
                : null,
            isMasterRecurring: Boolean(input.rawPayload?.rrule),
            remoteHref: input.remoteHref ?? null,
            remoteEtag: input.remoteEtag ?? null,
            syncState: input.deletedAt ? "deleted" : "synced",
            rawPayloadJson: JSON.stringify(input.rawPayload ?? {}),
            lastSyncedAt: input.remoteUpdatedAt ?? now
        });
        return getCalendarEventById(existing.id);
    }
    const id = `calevent_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    getDatabase()
        .prepare(`INSERT INTO forge_events (
         id, preferred_connection_id, preferred_calendar_id, ownership, origin_type, status, title, description, location,
         place_label, place_address, place_timezone, place_latitude, place_longitude, place_source, place_external_id,
         start_at, end_at, timezone, is_all_day, availability, event_type, categories_json, deleted_at, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, connectionId, calendar.id, input.ownership ?? "external", connection.provider, input.status ?? "confirmed", input.title, input.description ?? "", input.location ?? "", input.location ?? "", "", "", null, null, "", "", input.startAt, input.endAt, calendar.timezone, input.isAllDay ? 1 : 0, input.availability ?? "busy", input.eventType ?? "", JSON.stringify(input.categories ?? []), input.deletedAt ?? null, now, now);
    upsertEventSource({
        forgeEventId: id,
        provider: connection.provider,
        connectionId,
        calendarId: calendar.id,
        remoteCalendarId: calendar.remoteId,
        remoteEventId: input.remoteId,
        remoteUid: typeof input.rawPayload?.uid === "string" ? String(input.rawPayload.uid) : null,
        recurrenceInstanceId: typeof input.rawPayload?.recurrenceid === "string"
            ? String(input.rawPayload.recurrenceid)
            : null,
        isMasterRecurring: Boolean(input.rawPayload?.rrule),
        remoteHref: input.remoteHref ?? null,
        remoteEtag: input.remoteEtag ?? null,
        syncState: input.deletedAt ? "deleted" : "synced",
        rawPayloadJson: JSON.stringify(input.rawPayload ?? {}),
        lastSyncedAt: input.remoteUpdatedAt ?? now
    });
    return getCalendarEventById(id);
}
export function createCalendarEvent(input) {
    const now = nowIso();
    const id = `calevent_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const place = input.place ?? {
        label: "",
        address: "",
        timezone: "",
        latitude: null,
        longitude: null,
        source: "",
        externalPlaceId: ""
    };
    const preferredCalendar = input.preferredCalendarId === undefined
        ? getDefaultWritableCalendar() ?? null
        : input.preferredCalendarId
            ? getCalendarById(input.preferredCalendarId)
            : null;
    getDatabase()
        .prepare(`INSERT INTO forge_events (
         id, preferred_connection_id, preferred_calendar_id, ownership, origin_type, status, title, description, location,
         place_label, place_address, place_timezone, place_latitude, place_longitude, place_source, place_external_id,
         start_at, end_at, timezone, is_all_day, availability, event_type, categories_json, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, preferredCalendar?.connectionId ?? null, preferredCalendar?.id ?? null, "forge", "native", "confirmed", input.title, input.description, input.location, place.label || input.location, place.address, place.timezone, place.latitude, place.longitude, place.source, place.externalPlaceId, input.startAt, input.endAt, normalizeTimezone(input.timezone), input.isAllDay ? 1 : 0, input.availability, input.eventType, JSON.stringify(input.categories), now, now);
    replaceEventLinks(id, input.links);
    setEntityOwner("calendar_event", id, inferCalendarEventOwnerId(input));
    return getCalendarEventById(id);
}
export function updateCalendarEvent(eventId, patch) {
    const current = getCalendarEventById(eventId);
    if (!current) {
        return undefined;
    }
    const preferredCalendar = patch.preferredCalendarId === undefined
        ? current.calendarId
            ? getCalendarById(current.calendarId)
            : null
        : patch.preferredCalendarId
            ? getCalendarById(patch.preferredCalendarId)
            : null;
    const next = {
        preferredConnectionId: preferredCalendar?.connectionId ?? null,
        preferredCalendarId: patch.preferredCalendarId === undefined
            ? current.calendarId
            : patch.preferredCalendarId,
        title: patch.title ?? current.title,
        description: patch.description ?? current.description,
        location: patch.location ?? current.location,
        place: {
            label: patch.place?.label ?? current.place.label,
            address: patch.place?.address ?? current.place.address,
            timezone: patch.place?.timezone ?? current.place.timezone,
            latitude: patch.place?.latitude === undefined
                ? current.place.latitude
                : patch.place.latitude,
            longitude: patch.place?.longitude === undefined
                ? current.place.longitude
                : patch.place.longitude,
            source: patch.place?.source ?? current.place.source,
            externalPlaceId: patch.place?.externalPlaceId ?? current.place.externalPlaceId
        },
        startAt: patch.startAt ?? current.startAt,
        endAt: patch.endAt ?? current.endAt,
        timezone: normalizeTimezone(patch.timezone ?? current.timezone),
        isAllDay: patch.isAllDay ?? current.isAllDay,
        availability: patch.availability ?? current.availability,
        eventType: patch.eventType ?? current.eventType,
        categories: patch.categories ?? current.categories,
        updatedAt: nowIso()
    };
    getDatabase()
        .prepare(`UPDATE forge_events
       SET preferred_connection_id = ?, preferred_calendar_id = ?, title = ?, description = ?, location = ?,
           place_label = ?, place_address = ?, place_timezone = ?, place_latitude = ?, place_longitude = ?, place_source = ?, place_external_id = ?,
           start_at = ?, end_at = ?, timezone = ?, is_all_day = ?, availability = ?, event_type = ?, categories_json = ?, updated_at = ?
       WHERE id = ?`)
        .run(next.preferredConnectionId, next.preferredCalendarId, next.title, next.description, next.location, next.place.label, next.place.address, next.place.timezone, next.place.latitude, next.place.longitude, next.place.source, next.place.externalPlaceId, next.startAt, next.endAt, next.timezone, next.isAllDay ? 1 : 0, next.availability, next.eventType, JSON.stringify(next.categories), next.updatedAt, eventId);
    if (patch.links) {
        replaceEventLinks(eventId, patch.links);
    }
    if (patch.userId !== undefined || patch.links !== undefined) {
        setEntityOwner("calendar_event", eventId, patch.userId === undefined
            ? inferCalendarEventOwnerId({
                userId: current.userId ?? null,
                links: patch.links ?? current.links
            })
            : patch.userId);
    }
    if (current.sourceMappings.length > 0) {
        const nextSyncState = current.deletedAt !== null ? "deleted" : current.originType === "native" ? "pending_update" : "synced";
        getDatabase()
            .prepare(`UPDATE forge_event_sources
         SET sync_state = ?, updated_at = ?
         WHERE forge_event_id = ? AND sync_state != 'deleted'`)
            .run(nextSyncState, next.updatedAt, eventId);
    }
    return getCalendarEventById(eventId);
}
export function deleteCalendarEvent(eventId) {
    const current = getCalendarEventById(eventId);
    if (!current) {
        return undefined;
    }
    const deletedAt = nowIso();
    getDatabase()
        .prepare(`UPDATE forge_events
       SET deleted_at = ?, updated_at = ?
       WHERE id = ?`)
        .run(deletedAt, deletedAt, eventId);
    getDatabase()
        .prepare(`UPDATE forge_event_sources
       SET sync_state = CASE WHEN remote_event_id IS NOT NULL THEN 'pending_delete' ELSE sync_state END,
           updated_at = ?
       WHERE forge_event_id = ? AND sync_state != 'deleted'`)
        .run(deletedAt, eventId);
    return getCalendarEventById(eventId);
}
export function createWorkBlockTemplate(input) {
    return runInTransaction(() => {
        const now = nowIso();
        const id = `wbtpl_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
        getDatabase()
            .prepare(`INSERT INTO work_block_templates (
           id, title, kind, color, timezone, weekdays_json, start_minute, end_minute, starts_on, ends_on, blocking_state, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, input.title, input.kind, input.color, normalizeTimezone(input.timezone), JSON.stringify(input.weekDays), input.startMinute, input.endMinute, input.startsOn ?? null, input.endsOn ?? null, input.blockingState, now, now);
        setEntityOwner("work_block_template", id, input.userId);
        return getWorkBlockTemplateById(id);
    });
}
export function listWorkBlockTemplates(filters = {}) {
    const rows = getDatabase()
        .prepare(`SELECT id, title, kind, color, timezone, weekdays_json, start_minute, end_minute, starts_on, ends_on, blocking_state, created_at, updated_at
       FROM work_block_templates
       ORDER BY COALESCE(starts_on, ''), start_minute ASC, title ASC`)
        .all();
    return filterOwnedEntities("work_block_template", rows.map(mapWorkBlockTemplate), filters.userIds);
}
export function getWorkBlockTemplateById(templateId) {
    const row = getDatabase()
        .prepare(`SELECT id, title, kind, color, timezone, weekdays_json, start_minute, end_minute, starts_on, ends_on, blocking_state, created_at, updated_at
       FROM work_block_templates
       WHERE id = ?`)
        .get(templateId);
    return row
        ? decorateOwnedEntity("work_block_template", mapWorkBlockTemplate(row))
        : undefined;
}
export function updateWorkBlockTemplate(templateId, patch) {
    const current = getWorkBlockTemplateById(templateId);
    if (!current) {
        return undefined;
    }
    const next = {
        title: patch.title ?? current.title,
        kind: patch.kind ?? current.kind,
        color: patch.color ?? current.color,
        timezone: normalizeTimezone(patch.timezone ?? current.timezone),
        weekDays: patch.weekDays ?? current.weekDays,
        startMinute: patch.startMinute ?? current.startMinute,
        endMinute: patch.endMinute ?? current.endMinute,
        startsOn: patch.startsOn === undefined ? current.startsOn : patch.startsOn,
        endsOn: patch.endsOn === undefined ? current.endsOn : patch.endsOn,
        blockingState: patch.blockingState ?? current.blockingState,
        updatedAt: nowIso()
    };
    getDatabase()
        .prepare(`UPDATE work_block_templates
       SET title = ?, kind = ?, color = ?, timezone = ?, weekdays_json = ?, start_minute = ?, end_minute = ?, starts_on = ?, ends_on = ?, blocking_state = ?, updated_at = ?
       WHERE id = ?`)
        .run(next.title, next.kind, next.color, next.timezone, JSON.stringify(next.weekDays), next.startMinute, next.endMinute, next.startsOn, next.endsOn, next.blockingState, next.updatedAt, templateId);
    if (patch.userId !== undefined) {
        setEntityOwner("work_block_template", templateId, patch.userId);
    }
    return getWorkBlockTemplateById(templateId);
}
export function deleteWorkBlockTemplate(templateId) {
    const current = getWorkBlockTemplateById(templateId);
    if (!current) {
        return undefined;
    }
    getDatabase().prepare(`DELETE FROM work_block_templates WHERE id = ?`).run(templateId);
    return current;
}
function deriveWorkBlockInstances(template, query) {
    const queryStart = new Date(query.from);
    const queryEnd = new Date(query.to);
    const start = new Date(Date.UTC(queryStart.getUTCFullYear(), queryStart.getUTCMonth(), queryStart.getUTCDate()));
    const end = new Date(Date.UTC(queryEnd.getUTCFullYear(), queryEnd.getUTCMonth(), queryEnd.getUTCDate()));
    const templateStart = template.startsOn ? dateOnlyToUtcDate(template.startsOn) : null;
    const templateEnd = template.endsOn ? dateOnlyToUtcDate(template.endsOn) : null;
    const firstDay = templateStart && templateStart.getTime() > start.getTime() ? templateStart : start;
    const lastDay = templateEnd && templateEnd.getTime() < end.getTime() ? templateEnd : end;
    if (firstDay.getTime() > lastDay.getTime()) {
        return [];
    }
    const rows = [];
    for (let cursor = new Date(firstDay); cursor <= lastDay; cursor = addMinutes(cursor, 24 * 60)) {
        if (!template.weekDays.includes(cursor.getUTCDay())) {
            continue;
        }
        const blockStart = addMinutes(new Date(cursor), template.startMinute);
        const blockEnd = addMinutes(new Date(cursor), template.endMinute);
        if (blockEnd.toISOString() <= query.from || blockStart.toISOString() >= query.to) {
            continue;
        }
        rows.push(workBlockInstanceSchema.parse({
            id: `wbinst_${template.id}_${dateOnly(cursor)}`,
            templateId: template.id,
            dateKey: dateOnly(cursor),
            startAt: blockStart.toISOString(),
            endAt: blockEnd.toISOString(),
            title: template.title,
            kind: template.kind,
            color: template.color,
            blockingState: template.blockingState,
            calendarEventId: null,
            createdAt: template.createdAt,
            updatedAt: template.updatedAt
        }));
    }
    return rows;
}
export function ensureWorkBlockInstancesInRange(_query) {
    return [];
}
export function listWorkBlockInstances(query) {
    return listWorkBlockTemplates({ userIds: query.userIds })
        .flatMap((template) => deriveWorkBlockInstances(template, query))
        .sort((left, right) => left.startAt.localeCompare(right.startAt) || left.title.localeCompare(right.title));
}
export function listTaskTimeboxes(query) {
    const clauses = ["ends_at > ?", "starts_at < ?"];
    const params = [query.from, query.to];
    if (query.taskId) {
        clauses.push("task_id = ?");
        params.push(query.taskId);
    }
    if (query.projectId) {
        clauses.push("project_id = ?");
        params.push(query.projectId);
    }
    const rows = getDatabase()
        .prepare(`SELECT id, task_id, project_id, connection_id, calendar_id, remote_event_id, linked_task_run_id, status, source, title,
              starts_at, ends_at, override_reason, created_at, updated_at
       FROM task_timeboxes
       WHERE ${clauses.join(" AND ")}
       ORDER BY starts_at ASC`)
        .all(...params);
    return filterOwnedEntities("task_timebox", rows.map(mapTimebox), query.userIds);
}
export function getTaskTimeboxById(timeboxId) {
    const row = getDatabase()
        .prepare(`SELECT id, task_id, project_id, connection_id, calendar_id, remote_event_id, linked_task_run_id, status, source, title,
              starts_at, ends_at, override_reason, created_at, updated_at
       FROM task_timeboxes
       WHERE id = ?`)
        .get(timeboxId);
    return row ? decorateOwnedEntity("task_timebox", mapTimebox(row)) : undefined;
}
export function createTaskTimebox(input) {
    const now = nowIso();
    const id = `timebox_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    getDatabase()
        .prepare(`INSERT INTO task_timeboxes (
         id, task_id, project_id, connection_id, calendar_id, linked_task_run_id, status, source, title, starts_at, ends_at, override_reason, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.taskId, input.projectId ?? null, input.connectionId ?? null, input.calendarId ?? null, input.linkedTaskRunId ?? null, input.status ?? "planned", input.source ?? "manual", input.title, input.startsAt, input.endsAt, input.overrideReason ?? null, now, now);
    setEntityOwner("task_timebox", id, inferTaskTimeboxOwnerId(input));
    return getTaskTimeboxById(id);
}
export function updateTaskTimebox(timeboxId, patch) {
    const current = getTaskTimeboxById(timeboxId);
    if (!current) {
        return undefined;
    }
    const next = {
        connectionId: patch.connectionId === undefined ? current.connectionId : patch.connectionId,
        calendarId: patch.calendarId === undefined ? current.calendarId : patch.calendarId,
        remoteEventId: patch.remoteEventId === undefined ? current.remoteEventId : patch.remoteEventId,
        linkedTaskRunId: patch.linkedTaskRunId === undefined ? current.linkedTaskRunId : patch.linkedTaskRunId,
        status: patch.status ?? current.status,
        source: patch.source ?? current.source,
        title: patch.title ?? current.title,
        startsAt: patch.startsAt ?? current.startsAt,
        endsAt: patch.endsAt ?? current.endsAt,
        overrideReason: patch.overrideReason === undefined ? current.overrideReason : patch.overrideReason,
        updatedAt: nowIso()
    };
    getDatabase()
        .prepare(`UPDATE task_timeboxes
       SET connection_id = ?, calendar_id = ?, remote_event_id = ?, linked_task_run_id = ?, status = ?, source = ?, title = ?,
           starts_at = ?, ends_at = ?, override_reason = ?, updated_at = ?
       WHERE id = ?`)
        .run(next.connectionId, next.calendarId, next.remoteEventId, next.linkedTaskRunId, next.status, next.source, next.title, next.startsAt, next.endsAt, next.overrideReason, next.updatedAt, timeboxId);
    if (patch.userId !== undefined) {
        setEntityOwner("task_timebox", timeboxId, patch.userId);
    }
    return getTaskTimeboxById(timeboxId);
}
export function deleteTaskTimebox(timeboxId) {
    const current = getTaskTimeboxById(timeboxId);
    if (!current) {
        return undefined;
    }
    getDatabase().prepare(`DELETE FROM task_timeboxes WHERE id = ?`).run(timeboxId);
    return current;
}
export function findCoveringTimeboxForTask(taskId, at) {
    const row = getDatabase()
        .prepare(`SELECT id, task_id, project_id, connection_id, calendar_id, remote_event_id, linked_task_run_id, status, source, title,
              starts_at, ends_at, override_reason, created_at, updated_at
       FROM task_timeboxes
       WHERE task_id = ? AND starts_at <= ? AND ends_at >= ?
       ORDER BY starts_at DESC
       LIMIT 1`)
        .get(taskId, at.toISOString(), at.toISOString());
    return row ? mapTimebox(row) : undefined;
}
export function bindTaskRunToTimebox(input) {
    return runInTransaction(() => {
        const existing = findCoveringTimeboxForTask(input.taskId, input.startedAt);
        const startsAt = existing?.startsAt ?? input.startedAt.toISOString();
        const endsAt = existing?.endsAt ??
            addMinutes(input.startedAt, Math.max(15, Math.ceil((input.plannedDurationSeconds ?? 30 * 60) / 60))).toISOString();
        if (existing) {
            return updateTaskTimebox(existing.id, {
                linkedTaskRunId: input.taskRunId,
                status: "active",
                title: input.title,
                startsAt,
                endsAt,
                overrideReason: input.overrideReason ?? existing.overrideReason
            });
        }
        return createTaskTimebox({
            taskId: input.taskId,
            projectId: input.projectId ?? null,
            linkedTaskRunId: input.taskRunId,
            status: "active",
            source: "live_run",
            title: input.title,
            startsAt,
            endsAt,
            overrideReason: input.overrideReason ?? null
        });
    });
}
export function heartbeatTaskRunTimebox(taskRunId, patch) {
    const row = getDatabase()
        .prepare(`SELECT id
       FROM task_timeboxes
       WHERE linked_task_run_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`)
        .get(taskRunId);
    if (!row) {
        return undefined;
    }
    return updateTaskTimebox(row.id, {
        title: patch.title,
        endsAt: patch.endsAt,
        status: "active",
        overrideReason: patch.overrideReason ?? undefined
    });
}
export function finalizeTaskRunTimebox(taskRunId, status, endsAt) {
    const row = getDatabase()
        .prepare(`SELECT id
       FROM task_timeboxes
       WHERE linked_task_run_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`)
        .get(taskRunId);
    if (!row) {
        return undefined;
    }
    return updateTaskTimebox(row.id, {
        status,
        endsAt,
        linkedTaskRunId: taskRunId
    });
}
function matchKeywords(keywords, haystack) {
    if (keywords.length === 0) {
        return false;
    }
    const normalized = haystack.toLowerCase();
    return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}
export function evaluateSchedulingForTask(task, at = new Date()) {
    const project = task.projectId ? getProjectById(task.projectId) ?? null : null;
    const effectiveRules = normalizeRules(task.schedulingRules ?? project?.schedulingRules);
    const currentEvents = listCalendarEvents({
        from: addMinutes(at, -1).toISOString(),
        to: addMinutes(at, 1).toISOString()
    }).filter((event) => event.startAt <= at.toISOString() && event.endAt >= at.toISOString());
    const currentBlocks = listWorkBlockInstances({
        from: addMinutes(at, -1).toISOString(),
        to: addMinutes(at, 1).toISOString()
    }).filter((block) => block.startAt <= at.toISOString() && block.endAt >= at.toISOString());
    const conflicts = [];
    for (const event of currentEvents) {
        if ((event.calendarId ? effectiveRules.blockCalendarIds.includes(event.calendarId) : false) ||
            effectiveRules.blockEventTypes.includes(event.eventType) ||
            effectiveRules.blockAvailability.includes(event.availability) ||
            matchKeywords(effectiveRules.blockEventKeywords, `${event.title}\n${event.description}\n${event.location}`)) {
            conflicts.push(calendarContextConflictSchema.parse({
                kind: "external_event",
                id: event.id,
                title: event.title,
                reason: "The active calendar event blocks this task or project.",
                startsAt: event.startAt,
                endsAt: event.endAt
            }));
        }
    }
    for (const block of currentBlocks) {
        if (effectiveRules.blockWorkBlockKinds.includes(block.kind) ||
            (effectiveRules.allowWorkBlockKinds.length > 0 &&
                !effectiveRules.allowWorkBlockKinds.includes(block.kind))) {
            conflicts.push(calendarContextConflictSchema.parse({
                kind: "work_block",
                id: block.id,
                title: block.title,
                reason: "The current work block does not allow this task or project.",
                startsAt: block.startAt,
                endsAt: block.endAt
            }));
        }
    }
    const anyAllowRules = effectiveRules.allowWorkBlockKinds.length > 0 ||
        effectiveRules.allowCalendarIds.length > 0 ||
        effectiveRules.allowEventTypes.length > 0 ||
        effectiveRules.allowEventKeywords.length > 0 ||
        effectiveRules.allowAvailability.length > 0;
    let allowSatisfied = !anyAllowRules;
    if (anyAllowRules) {
        const syntheticFreeAllowed = effectiveRules.allowAvailability.includes("free") &&
            currentEvents.every((event) => event.availability !== "busy");
        allowSatisfied = syntheticFreeAllowed;
        if (!allowSatisfied) {
            allowSatisfied = currentBlocks.some((block) => effectiveRules.allowWorkBlockKinds.includes(block.kind));
        }
        if (!allowSatisfied) {
            allowSatisfied = currentEvents.some((event) => (effectiveRules.allowCalendarIds.length === 0 ||
                (event.calendarId ? effectiveRules.allowCalendarIds.includes(event.calendarId) : false)) &&
                (effectiveRules.allowEventTypes.length === 0 ||
                    effectiveRules.allowEventTypes.includes(event.eventType)) &&
                (effectiveRules.allowAvailability.length === 0 ||
                    effectiveRules.allowAvailability.includes(event.availability)) &&
                (effectiveRules.allowEventKeywords.length === 0 ||
                    matchKeywords(effectiveRules.allowEventKeywords, `${event.title}\n${event.description}\n${event.location}`)));
        }
    }
    if (!allowSatisfied) {
        conflicts.push({
            kind: currentBlocks[0] ? "work_block" : "external_event",
            id: currentBlocks[0]?.id ?? currentEvents[0]?.id ?? "calendar_now",
            title: currentBlocks[0]?.title ?? currentEvents[0]?.title ?? "Current context",
            reason: "The current calendar context does not match the allowed rules for this task or project.",
            startsAt: currentBlocks[0]?.startAt ?? currentEvents[0]?.startAt ?? at.toISOString(),
            endsAt: currentBlocks[0]?.endAt ?? currentEvents[0]?.endAt ?? at.toISOString()
        });
    }
    return {
        blocked: conflicts.length > 0,
        effectiveRules,
        conflicts
    };
}
function collectBusyIntervals(query) {
    const busyIntervals = [];
    for (const event of listCalendarEvents(query)) {
        if (event.status !== "cancelled" && event.availability === "busy") {
            busyIntervals.push({ startAt: event.startAt, endAt: event.endAt });
        }
    }
    for (const block of listWorkBlockInstances(query)) {
        if (block.blockingState === "blocked") {
            busyIntervals.push({ startAt: block.startAt, endAt: block.endAt });
        }
    }
    for (const timebox of listTaskTimeboxes(query)) {
        if (timebox.status !== "cancelled") {
            busyIntervals.push({ startAt: timebox.startsAt, endAt: timebox.endsAt });
        }
    }
    return busyIntervals.sort((left, right) => left.startAt.localeCompare(right.startAt));
}
function hasOverlap(busyIntervals, startsAt, endsAt) {
    return busyIntervals.some((interval) => Date.parse(interval.startAt) < endsAt.getTime() &&
        Date.parse(interval.endAt) > startsAt.getTime());
}
export function suggestTaskTimeboxes(taskId, options = {}) {
    const task = getTaskById(taskId);
    if (!task) {
        return [];
    }
    const from = options.from ? new Date(options.from) : new Date();
    const to = options.to ? new Date(options.to) : addMinutes(from, 14 * 24 * 60);
    const durationMinutes = Math.max(15, Math.ceil(((task.plannedDurationSeconds ?? 30 * 60) / 60)));
    const query = { from: from.toISOString(), to: to.toISOString() };
    ensureWorkBlockInstancesInRange(query);
    const busyIntervals = collectBusyIntervals(query);
    const allowedBlocks = listWorkBlockInstances(query).filter((block) => block.blockingState === "allowed");
    const suggestions = [];
    const candidateWindows = allowedBlocks.length > 0
        ? allowedBlocks.map((block) => ({ start: new Date(block.startAt), end: new Date(block.endAt) }))
        : Array.from({ length: 14 }, (_, index) => {
            const day = addMinutes(new Date(from), index * 24 * 60);
            const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 8, 0, 0));
            const end = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 18, 0, 0));
            return { start, end };
        });
    for (const window of candidateWindows) {
        for (let cursor = new Date(window.start); cursor.getTime() + durationMinutes * 60 * 1000 <= window.end.getTime(); cursor = addMinutes(cursor, 30)) {
            const slotEnd = addMinutes(cursor, durationMinutes);
            if (hasOverlap(busyIntervals, cursor, slotEnd)) {
                continue;
            }
            const evaluation = evaluateSchedulingForTask(task, addMinutes(cursor, Math.floor(durationMinutes / 2)));
            if (evaluation.blocked) {
                continue;
            }
            suggestions.push(taskTimeboxSchema.parse({
                id: `suggested_${task.id}_${cursor.getTime()}`,
                taskId: task.id,
                projectId: task.projectId,
                connectionId: null,
                calendarId: null,
                remoteEventId: null,
                linkedTaskRunId: null,
                status: "planned",
                source: "suggested",
                title: task.title,
                startsAt: cursor.toISOString(),
                endsAt: slotEnd.toISOString(),
                overrideReason: null,
                createdAt: nowIso(),
                updatedAt: nowIso()
            }));
            if (suggestions.length >= (options.limit ?? 6)) {
                return suggestions;
            }
        }
    }
    return suggestions;
}
export function getCalendarOverview(query) {
    ensureWorkBlockInstancesInRange(query);
    return calendarOverviewPayloadSchema.parse({
        generatedAt: nowIso(),
        providers: [
            {
                provider: "google",
                label: "Google Calendar",
                supportsDedicatedForgeCalendar: true,
                connectionHelp: "Use a Google refresh token plus client credentials to sync calendars and publish Forge-owned events and timeboxes."
            },
            {
                provider: "apple",
                label: "Apple Calendar",
                supportsDedicatedForgeCalendar: true,
                connectionHelp: "Use your Apple ID email and an app-specific password. Forge discovers the writable calendars from https://caldav.icloud.com."
            },
            {
                provider: "microsoft",
                label: "Exchange Online",
                supportsDedicatedForgeCalendar: false,
                connectionHelp: "Save the Microsoft client ID and redirect URI in Calendar settings first, then sign in with Microsoft. Forge mirrors the selected calendars in read-only mode."
            },
            {
                provider: "caldav",
                label: "Custom CalDAV",
                supportsDedicatedForgeCalendar: true,
                connectionHelp: "Use an account-level CalDAV base URL, then let Forge discover the calendars before selecting sync and write targets."
            }
        ],
        connections: listCalendarConnections().map(({ credentialsSecretId: _secret, ...connection }) => connection),
        calendars: listCalendars(),
        events: listCalendarEvents(query),
        workBlockTemplates: listWorkBlockTemplates({ userIds: query.userIds }),
        workBlockInstances: listWorkBlockInstances(query),
        timeboxes: listTaskTimeboxes(query)
    });
}
export function recordCalendarActivity(eventType, entityType, entityId, title, description, context, metadata = {}) {
    recordActivityEvent({
        entityType,
        entityId,
        eventType,
        title,
        description,
        actor: context.actor ?? null,
        source: context.source,
        metadata
    });
}
