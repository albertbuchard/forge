import { randomUUID } from "node:crypto";
import { getDatabase } from "../db.js";
import { eventLogEntrySchema, type ActivitySource, type EventLogEntry, type EventsListQuery } from "../types.js";

type EventLogRow = {
  id: string;
  event_kind: string;
  entity_type: string;
  entity_id: string;
  actor: string | null;
  source: ActivitySource;
  caused_by_event_id: string | null;
  metadata_json: string;
  created_at: string;
};

type EventMetadataValue = string | number | boolean | null;

export type EventLogInput = {
  eventKind: string;
  entityType: string;
  entityId: string;
  actor?: string | null;
  source: ActivitySource;
  causedByEventId?: string | null;
  metadata?: Record<string, EventMetadataValue>;
};

function mapEvent(row: EventLogRow): EventLogEntry {
  return eventLogEntrySchema.parse({
    id: row.id,
    eventKind: row.event_kind,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actor: row.actor,
    source: row.source,
    causedByEventId: row.caused_by_event_id,
    metadata: JSON.parse(row.metadata_json) as Record<string, EventMetadataValue>,
    createdAt: row.created_at
  });
}

export function recordEventLog(input: EventLogInput, now = new Date()): EventLogEntry {
  const event = eventLogEntrySchema.parse({
    id: `log_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
    eventKind: input.eventKind,
    entityType: input.entityType,
    entityId: input.entityId,
    actor: input.actor ?? null,
    source: input.source,
    causedByEventId: input.causedByEventId ?? null,
    metadata: input.metadata ?? {},
    createdAt: now.toISOString()
  });

  getDatabase()
    .prepare(
      `INSERT INTO event_log (
        id, event_kind, entity_type, entity_id, actor, source, caused_by_event_id, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      event.id,
      event.eventKind,
      event.entityType,
      event.entityId,
      event.actor,
      event.source,
      event.causedByEventId,
      JSON.stringify(event.metadata),
      event.createdAt
    );

  return event;
}

export function listEventLog(filters: EventsListQuery = {}): EventLogEntry[] {
  const whereClauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters.entityType) {
    whereClauses.push("entity_type = ?");
    params.push(filters.entityType);
  }
  if (filters.entityId) {
    whereClauses.push("entity_id = ?");
    params.push(filters.entityId);
  }
  if (filters.eventKind) {
    whereClauses.push("event_kind = ?");
    params.push(filters.eventKind);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const limitSql = filters.limit ? "LIMIT ?" : "";
  if (filters.limit) {
    params.push(filters.limit);
  }

  const rows = getDatabase()
    .prepare(
      `SELECT id, event_kind, entity_type, entity_id, actor, source, caused_by_event_id, metadata_json, created_at
       FROM event_log
       ${whereSql}
       ORDER BY created_at DESC
       ${limitSql}`
    )
    .all(...params) as EventLogRow[];

  return rows.map(mapEvent);
}
