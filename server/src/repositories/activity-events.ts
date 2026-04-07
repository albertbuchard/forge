import { randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { getEntityOwner } from "./entity-ownership.js";
import { recordEventLog } from "./event-log.js";
import {
  activityEventSchema,
  type ActivityEvent,
  type ActivityEntityType,
  type ActivityListQuery,
  type RemoveActivityEventInput,
  type ActivitySource
} from "../types.js";

type ActivityEventRow = {
  id: string;
  entity_type: ActivityEntityType;
  entity_id: string;
  event_type: string;
  title: string;
  description: string;
  actor: string | null;
  source: ActivitySource;
  metadata_json: string;
  created_at: string;
};

type ActivityMetadataValue = unknown;

export type ActivityEventInput = {
  entityType: ActivityEntityType;
  entityId: string;
  eventType: string;
  title: string;
  description?: string;
  actor?: string | null;
  source: ActivitySource;
  metadata?: Record<string, ActivityMetadataValue>;
};

function resolveActivityOwner(
  row: ActivityEventRow
): Pick<ActivityEvent, "userId" | "user"> {
  if (row.entity_type === "task_run") {
    const taskRunRow = getDatabase()
      .prepare(`SELECT task_id FROM task_runs WHERE id = ?`)
      .get(row.entity_id) as { task_id: string } | undefined;
    if (taskRunRow) {
      const user = getEntityOwner("task", taskRunRow.task_id);
      return { userId: user?.id ?? null, user };
    }
  }

  if (row.entity_type === "work_block") {
    const user = getEntityOwner("work_block_template", row.entity_id);
    return { userId: user?.id ?? null, user };
  }

  if (row.entity_type === "system") {
    const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
    const correctedEntityType =
      typeof metadata.correctedEntityType === "string"
        ? metadata.correctedEntityType
        : null;
    const correctedEntityId =
      typeof metadata.correctedEntityId === "string"
        ? metadata.correctedEntityId
        : null;
    if (correctedEntityType && correctedEntityId) {
      const mappedEntityType =
        correctedEntityType === "work_block"
          ? "work_block_template"
          : correctedEntityType;
      const user = getEntityOwner(
        mappedEntityType as Parameters<typeof getEntityOwner>[0],
        correctedEntityId
      );
      return { userId: user?.id ?? null, user };
    }
  }

  const rawEntityType = row.entity_type as string;
  const mappedEntityType =
    rawEntityType === "work_block" ? "work_block_template" : rawEntityType;
  const user = getEntityOwner(
    mappedEntityType as Parameters<typeof getEntityOwner>[0],
    row.entity_id
  );
  return { userId: user?.id ?? null, user };
}

function mapActivityEvent(row: ActivityEventRow): ActivityEvent {
  const owner = resolveActivityOwner(row);
  return activityEventSchema.parse({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    eventType: row.event_type,
    title: row.title,
    description: row.description,
    actor: row.actor,
    source: row.source,
    metadata: JSON.parse(row.metadata_json) as Record<string, ActivityMetadataValue>,
    createdAt: row.created_at,
    userId: owner.userId,
    user: owner.user
  });
}

export function recordActivityEvent(input: ActivityEventInput, now = new Date()): ActivityEvent {
  const id = `evt_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const createdAt = now.toISOString();
  const event = activityEventSchema.parse({
    id,
    entityType: input.entityType,
    entityId: input.entityId,
    eventType: input.eventType,
    title: input.title,
    description: input.description ?? "",
    actor: input.actor ?? null,
    source: input.source,
    metadata: input.metadata ?? {},
    createdAt
  });

  getDatabase()
    .prepare(
      `INSERT INTO activity_events (
        id, entity_type, entity_id, event_type, title, description, actor, source, metadata_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      event.id,
      event.entityType,
      event.entityId,
      event.eventType,
      event.title,
      event.description,
      event.actor,
      event.source,
      JSON.stringify(event.metadata),
      event.createdAt
    );

  recordEventLog(
    {
      eventKind: `activity.${event.eventType}`,
      entityType: event.entityType,
      entityId: event.entityId,
      actor: event.actor,
      source: event.source,
      metadata: {
        activityEventId: event.id,
        title: event.title
      }
    },
    now
  );

  return event;
}

export function listActivityEvents(filters: ActivityListQuery = {}): ActivityEvent[] {
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
  if (filters.source) {
    whereClauses.push("source = ?");
    params.push(filters.source);
  }
  if (!filters.includeCorrected) {
    whereClauses.push("event_type != 'activity_corrected'");
    whereClauses.push(
      "NOT EXISTS (SELECT 1 FROM activity_event_corrections WHERE activity_event_corrections.corrected_event_id = activity_events.id)"
    );
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const limitSql = filters.limit ? "LIMIT ?" : "";
  if (filters.limit) {
    params.push(filters.limit);
  }

  const rows = getDatabase()
    .prepare(
      `SELECT id, entity_type, entity_id, event_type, title, description, actor, source, metadata_json, created_at
       FROM activity_events
       ${whereSql}
       ORDER BY created_at DESC
       ${limitSql}`
    )
    .all(...params) as ActivityEventRow[];

  const events = rows.map(mapActivityEvent);
  if (!filters.userIds || filters.userIds.length === 0) {
    return events;
  }
  const allowed = new Set(filters.userIds);
  return events.filter(
    (event) => event.userId !== null && allowed.has(event.userId)
  );
}

export function listActivityEventsForTask(
  taskId: string,
  limit = 25,
  userIds?: string[]
): ActivityEvent[] {
  const rows = getDatabase()
    .prepare(
      `SELECT
         activity_events.id,
         activity_events.entity_type,
         activity_events.entity_id,
         activity_events.event_type,
         activity_events.title,
         activity_events.description,
         activity_events.actor,
         activity_events.source,
         activity_events.metadata_json,
         activity_events.created_at
       FROM activity_events
       LEFT JOIN task_runs
         ON activity_events.entity_type = 'task_run'
        AND task_runs.id = activity_events.entity_id
       WHERE (
            (activity_events.entity_type = 'task' AND activity_events.entity_id = ?)
         OR (activity_events.entity_type = 'task_run' AND task_runs.task_id = ?)
       )
         AND activity_events.event_type != 'activity_corrected'
         AND NOT EXISTS (
           SELECT 1
           FROM activity_event_corrections
           WHERE activity_event_corrections.corrected_event_id = activity_events.id
         )
       ORDER BY activity_events.created_at DESC
       LIMIT ?`
    )
    .all(taskId, taskId, limit) as ActivityEventRow[];

  const events = rows.map(mapActivityEvent);
  if (!userIds || userIds.length === 0) {
    return events;
  }
  const allowed = new Set(userIds);
  return events.filter(
    (event) => event.userId !== null && allowed.has(event.userId)
  );
}

export function getActivityEventById(eventId: string): ActivityEvent | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT id, entity_type, entity_id, event_type, title, description, actor, source, metadata_json, created_at
       FROM activity_events
       WHERE id = ?`
    )
    .get(eventId) as ActivityEventRow | undefined;
  return row ? mapActivityEvent(row) : undefined;
}

export function removeActivityEvent(
  eventId: string,
  input: RemoveActivityEventInput,
  activity: { source: ActivitySource; actor?: string | null }
): ActivityEvent | undefined {
  const original = getActivityEventById(eventId);
  if (!original || original.eventType === "activity_corrected") {
    return undefined;
  }

  return runInTransaction(() => {
    const existingCorrection = getDatabase()
      .prepare(`SELECT correcting_event_id FROM activity_event_corrections WHERE corrected_event_id = ?`)
      .get(eventId) as { correcting_event_id: string } | undefined;
    if (existingCorrection) {
      return getActivityEventById(existingCorrection.correcting_event_id);
    }

    const correction = recordActivityEvent({
      entityType: "system",
      entityId: original.id,
      eventType: "activity_corrected",
      title: `Log removed: ${original.title}`,
      description: input.reason,
      actor: activity.actor ?? null,
      source: activity.source,
      metadata: {
        correctedEventId: original.id,
        correctedEntityType: original.entityType,
        correctedEntityId: original.entityId
      }
    });

    getDatabase()
      .prepare(
        `INSERT INTO activity_event_corrections (corrected_event_id, correcting_event_id, created_at)
         VALUES (?, ?, ?)`
      )
      .run(original.id, correction.id, correction.createdAt);

    return correction;
  });
}
