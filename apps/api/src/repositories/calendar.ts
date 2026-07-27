import { createHash, randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import { recordActivityEvent } from "./activity-events.js";
import {
  clearEntityOwner,
  decorateOwnedEntity,
  filterOwnedEntities,
  getEntityOwnerId,
  inferFirstOwnedUserId,
  setEntityOwner
} from "./entity-ownership.js";
import { getProjectById } from "./projects.js";
import { getTaskById } from "./tasks.js";
import {
  buildCalendarEventActionProfile,
  buildTaskTimeboxActionProfile,
  buildWorkBlockTemplateActionProfile,
  readEntityActionProfile,
  upsertEntityActionProfile
} from "../services/life-force.js";
import {
  calendarConnectionSchema,
  calendarContextConflictSchema,
  calendarEventSchema,
  calendarEventLinkSchema,
  calendarEventSourceSchema,
  calendarOverviewPayloadSchema,
  calendarSchema,
  calendarSchedulingRulesSchema,
  taskTimeboxSchema,
  workBlockInstanceSchema,
  workBlockTemplateSchema,
  type ActivitySource,
  type CalendarConnection,
  type CalendarEventLink,
  type CalendarEventOrigin,
  type CalendarEventSource,
  type CalendarOverviewPayload,
  type CalendarSchedulingRules,
  type CalendarTimeboxStatus,
  type CalendarTimeboxSource,
  type CalendarActivityPresetKey,
  type CreateCalendarEventInput,
  type CreateTaskTimeboxInput,
  type CreateWorkBlockTemplateInput,
  type Task,
  type TaskTimebox,
  type UpdateCalendarEventInput,
  type UpdateWorkBlockTemplateInput,
  type WorkBlockInstance,
  type WorkBlockTemplate
} from "../types.js";
import {
  isValidTimeZone,
  resolveZonedDateTime
} from "../services/calendar-time.js";

type ActivityContext = {
  source: ActivitySource;
  actor?: string | null;
};

type StoredSecretRow = {
  id: string;
  cipher_text: string;
};

type CalendarConnectionRow = {
  id: string;
  provider: "google" | "apple" | "caldav" | "microsoft" | "macos_local";
  label: string;
  account_label: string;
  status: "connected" | "needs_attention" | "error";
  config_json: string;
  credentials_secret_id: string;
  forge_calendar_id: string | null;
  last_synced_at: string | null;
  last_sync_error: string | null;
  created_at: string;
  updated_at: string;
};

type CalendarRow = {
  id: string;
  connection_id: string;
  remote_id: string;
  title: string;
  description: string;
  color: string;
  timezone: string;
  is_primary: number;
  can_write: number;
  selected_for_sync: number;
  forge_managed: number;
  source_id: string | null;
  source_title: string | null;
  source_type: string | null;
  calendar_type: string | null;
  host_calendar_id: string | null;
  canonical_key: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

type CalendarEventRow = {
  id: string;
  preferred_connection_id: string | null;
  preferred_calendar_id: string | null;
  ownership: "external" | "forge";
  origin_type: CalendarEventOrigin;
  status: "confirmed" | "tentative" | "cancelled";
  title: string;
  description: string;
  location: string;
  place_label: string;
  place_address: string;
  place_timezone: string;
  place_latitude: number | null;
  place_longitude: number | null;
  place_source: string;
  place_external_id: string;
  start_at: string;
  end_at: string;
  timezone: string;
  is_all_day: number;
  availability: "busy" | "free";
  event_type: string;
  categories_json: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

type CalendarEventSourceRow = {
  id: string;
  forge_event_id: string;
  provider: "google" | "apple" | "caldav" | "microsoft";
  connection_id: string | null;
  calendar_id: string | null;
  remote_calendar_id: string | null;
  remote_event_id: string;
  remote_uid: string | null;
  recurrence_instance_id: string | null;
  is_master_recurring: number;
  remote_href: string | null;
  remote_etag: string | null;
  sync_state:
    | "pending_create"
    | "pending_update"
    | "pending_delete"
    | "synced"
    | "error"
    | "deleted";
  raw_payload_json: string;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

type CalendarEventLinkRow = {
  id: string;
  forge_event_id: string;
  entity_type: CalendarEventLink["entityType"];
  entity_id: string;
  relationship_type: string;
  created_at: string;
  updated_at: string;
};

type WorkBlockTemplateRow = {
  id: string;
  title: string;
  kind: WorkBlockTemplate["kind"];
  color: string;
  timezone: string;
  weekdays_json: string;
  start_minute: number;
  end_minute: number;
  starts_on: string | null;
  ends_on: string | null;
  exclusion_dates_json: string;
  blocking_state: "allowed" | "blocked";
  created_at: string;
  updated_at: string;
};

type TaskTimeboxRow = {
  id: string;
  task_id: string;
  project_id: string | null;
  connection_id: string | null;
  calendar_id: string | null;
  remote_event_id: string | null;
  linked_task_run_id: string | null;
  status: CalendarTimeboxStatus;
  source: CalendarTimeboxSource;
  title: string;
  starts_at: string;
  ends_at: string;
  override_reason: string | null;
  deletion_requested_at: string | null;
  created_at: string;
  updated_at: string;
};

type TaskTimeboxProviderOperationRow = {
  timebox_id: string;
  operation: "upsert" | "delete";
  state: "pending" | "claimed" | "applied" | "error";
  target_connection_id: string | null;
  target_calendar_id: string | null;
  remote_event_id: string | null;
  claim_token: string | null;
  claim_version: number;
  needs_retry: number;
  claimed_at: string | null;
  lease_expires_at: string | null;
  attempt_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskTimeboxProjectionClaim = {
  timebox: TaskTimebox;
  operation: "upsert" | "delete";
  claimToken: string;
  claimVersion: number;
  targetConnectionId: string | null;
  targetCalendarId: string | null;
  remoteEventId: string | null;
  attemptCount: number;
};

export type CalendarConnectionCredentialsRecord = Record<string, unknown>;

export type CalendarConnectionRecord = CalendarConnection & {
  credentialsSecretId: string;
};

export type CalendarSyncCalendarInput = {
  remoteId: string;
  title: string;
  description?: string;
  color?: string;
  timezone?: string;
  isPrimary?: boolean;
  canWrite?: boolean;
  selectedForSync?: boolean;
  forgeManaged?: boolean;
  sourceId?: string | null;
  sourceTitle?: string | null;
  sourceType?: string | null;
  calendarType?: string | null;
  hostCalendarId?: string | null;
  canonicalKey?: string | null;
};

export type CalendarSyncEventInput = {
  calendarRemoteId: string;
  remoteId: string;
  remoteHref?: string | null;
  remoteEtag?: string | null;
  ownership?: "external" | "forge";
  status?: "confirmed" | "tentative" | "cancelled";
  title: string;
  description?: string;
  location?: string;
  startAt: string;
  endAt: string;
  timezone?: string;
  isAllDay?: boolean;
  availability?: "busy" | "free";
  eventType?: string;
  categories?: string[];
  rawPayload?: Record<string, unknown>;
  remoteUpdatedAt?: string | null;
  deletedAt?: string | null;
};

function readRecurrenceInstanceId(
  rawPayload: Record<string, unknown> | undefined
) {
  if (!rawPayload) {
    return null;
  }
  for (const key of ["recurrenceid", "occurrenceDate"]) {
    const value = rawPayload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString();
    }
  }
  const originalStart = rawPayload.originalStartTime;
  if (typeof originalStart === "object" && originalStart !== null) {
    const record = originalStart as Record<string, unknown>;
    for (const key of ["dateTime", "date"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return null;
}

function isMasterRecurringProviderRecord(
  rawPayload: Record<string, unknown> | undefined
) {
  return Boolean(rawPayload?.rrule);
}

export type CalendarAgendaQuery = {
  from: string;
  to: string;
};

export type SchedulingEvaluation = {
  blocked: boolean;
  effectiveRules: CalendarSchedulingRules;
  conflicts: Array<{
    kind: "external_event" | "work_block";
    id: string;
    title: string;
    reason: string;
    startsAt: string;
    endsAt: string;
  }>;
};

export type TaskTimeboxPlacementConflict = {
  kind: "calendar_event" | "work_block" | "task_timebox" | "scheduling_rule";
  id: string;
  title: string;
  reason: string;
  startsAt: string;
  endsAt: string;
};

export type TaskTimeboxPlacementEvaluation = {
  blocked: boolean;
  requiresOverride: boolean;
  conflicts: TaskTimeboxPlacementConflict[];
};

const DEFAULT_SCHEDULING_RULES: CalendarSchedulingRules = {
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

const MAX_TIMEBOX_QUERY_DAYS = 732;
const MAX_TIMEBOX_ROWS = 5_000;
const MAX_TIMEBOX_SUGGESTION_DAYS = 31;
const MAX_TIMEBOX_SUGGESTIONS = 12;
const MAX_TIMEBOX_DURATION_MS = 31 * 24 * 60 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function dateOnlyToUtcDate(value: string) {
  const [yearText, monthText, dayText] = value.split("-");
  return new Date(
    Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText))
  );
}

function addCalendarDays(value: string, days: number) {
  const date = dateOnlyToUtcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}

function localDateKeyForInstant(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(
      400,
      "calendar_range_invalid",
      "Calendar ranges must use valid timestamps."
    );
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const fields = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function recurrenceEndDateForQuery(value: string, timeZone: string) {
  const date = new Date(value);
  if (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  ) {
    return addCalendarDays(dateOnly(date), -1);
  }
  return localDateKeyForInstant(value, timeZone);
}

function localMinuteToInstant(
  dateKey: string,
  minute: number,
  timeZone: string
) {
  const normalizedDateKey =
    minute === 1440 ? addCalendarDays(dateKey, 1) : dateKey;
  const normalizedMinute = minute === 1440 ? 0 : minute;
  const hour = Math.floor(normalizedMinute / 60);
  const minuteOfHour = normalizedMinute % 60;
  const resolution = resolveZonedDateTime(
    `${normalizedDateKey}T${String(hour).padStart(2, "0")}:${String(minuteOfHour).padStart(2, "0")}`,
    timeZone
  );
  if (resolution.kind === "exact") {
    return resolution.instants[0];
  }
  if (resolution.kind === "ambiguous") {
    return resolution.instants[0];
  }
  return null;
}

function normalizeExclusionDates(values: string[] | undefined) {
  return [...new Set(values ?? [])].sort();
}

function normalizeTimezone(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : "UTC";
}

function mapConnection(row: CalendarConnectionRow): CalendarConnectionRecord {
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
  const legacyMacOSPermissionError =
    base.provider === "macos_local" &&
    base.status === "error" &&
    base.lastSyncError
      ? /^(?:invalidRequest|unavailable)\("([\s\S]*)"\)$/.exec(
          base.lastSyncError.trim()
        )
      : null;

  return {
    ...base,
    ...(legacyMacOSPermissionError?.[1]
      ? {
          status: "needs_attention" as const,
          lastSyncError: legacyMacOSPermissionError[1]
        }
      : {}),
    credentialsSecretId: row.credentials_secret_id
  };
}

function mapCalendar(row: CalendarRow) {
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
    sourceId: row.source_id,
    sourceTitle: row.source_title,
    sourceType: row.source_type,
    calendarType: row.calendar_type,
    hostCalendarId: row.host_calendar_id,
    canonicalKey: row.canonical_key,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapEventSource(row: CalendarEventSourceRow) {
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

function mapEventLink(row: CalendarEventLinkRow) {
  return calendarEventLinkSchema.parse({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    relationshipType: row.relationship_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function listEventSourcesForEvent(eventId: string): CalendarEventSource[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, forge_event_id, provider, connection_id, calendar_id, remote_calendar_id, remote_event_id, remote_uid,
              recurrence_instance_id, is_master_recurring, remote_href, remote_etag, sync_state, raw_payload_json,
              last_synced_at, created_at, updated_at
       FROM forge_event_sources
       WHERE forge_event_id = ?
       ORDER BY updated_at DESC, created_at DESC`
    )
    .all(eventId) as CalendarEventSourceRow[];
  return rows.map(mapEventSource);
}

function listEventLinksForEvent(eventId: string): CalendarEventLink[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, forge_event_id, entity_type, entity_id, relationship_type, created_at, updated_at
       FROM forge_event_links
       WHERE forge_event_id = ?
       ORDER BY updated_at DESC, created_at DESC`
    )
    .all(eventId) as CalendarEventLinkRow[];
  return rows.map(mapEventLink);
}

function mapEvent(row: CalendarEventRow) {
  const sourceMappings = listEventSourcesForEvent(row.id);
  const primarySource = sourceMappings[0] ?? null;
  return calendarEventSchema.parse({
    id: row.id,
    connectionId:
      row.preferred_connection_id ?? primarySource?.connectionId ?? null,
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
    actionProfile: readEntityActionProfile("calendar_event", row.id, {
      profileKey: `calendar_event_${row.id}`,
      title: row.title,
      entityType: "calendar_event"
    }),
    remoteUpdatedAt: primarySource?.lastSyncedAt ?? null,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapWorkBlockTemplate(row: WorkBlockTemplateRow) {
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
    exclusionDates: normalizeExclusionDates(
      JSON.parse(row.exclusion_dates_json || "[]") as string[]
    ),
    blockingState: row.blocking_state,
    actionProfile: readEntityActionProfile("work_block_template", row.id, {
      profileKey: `work_block_template_${row.id}`,
      title: row.title,
      entityType: "work_block_template"
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapTimebox(row: TaskTimeboxRow) {
  const task = getTaskById(row.task_id);
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
    actionProfile:
      readEntityActionProfile("task_timebox", row.id, {
        profileKey: `task_timebox_${row.id}`,
        title: row.title,
        entityType: "task_timebox"
      }) ??
      (task
        ? buildTaskTimeboxActionProfile({
            timeboxId: row.id,
            title: row.title,
            taskId: row.task_id,
            taskPlannedDurationSeconds: task.plannedDurationSeconds,
            startsAt: row.starts_at,
            endsAt: row.ends_at
          })
        : null),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function inferCalendarEventOwnerId(input: {
  userId?: string | null;
  links?: Array<{
    entityType: CalendarEventLink["entityType"];
    entityId: string;
  }>;
}) {
  return (
    input.userId ??
    inferFirstOwnedUserId(
      (input.links ?? []).map((link) => ({
        entityType: link.entityType,
        entityId: link.entityId
      }))
    )
  );
}

function inferTaskTimeboxOwnerId(input: {
  userId?: string | null;
  taskId: string;
  projectId?: string | null;
}) {
  return (
    input.userId ??
    inferFirstOwnedUserId([
      { entityType: "task", entityId: input.taskId },
      { entityType: "project", entityId: input.projectId ?? null }
    ])
  );
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function parseTimeboxWindow(
  startsAt: string,
  endsAt: string,
  options: {
    maxDurationMs?: number;
    limitKind?: "timebox" | "range";
  } = {}
) {
  const startsAtMs = Date.parse(startsAt);
  const endsAtMs = Date.parse(endsAt);
  if (
    !Number.isFinite(startsAtMs) ||
    !Number.isFinite(endsAtMs) ||
    endsAtMs <= startsAtMs
  ) {
    throw new HttpError(
      400,
      "calendar_timebox_window_invalid",
      "Task timeboxes need valid start and end timestamps, with the end after the start."
    );
  }
  const maxDurationMs = options.maxDurationMs ?? MAX_TIMEBOX_DURATION_MS;
  if (endsAtMs - startsAtMs > maxDurationMs) {
    const isTimeboxDurationLimit = options.limitKind !== "range";
    throw new HttpError(
      400,
      isTimeboxDurationLimit
        ? "calendar_timebox_duration_too_long"
        : "calendar_timebox_range_too_large",
      isTimeboxDurationLimit
        ? "A single task timebox can span at most 31 days. Split longer plans into separate focused blocks."
        : "The requested task-timebox range is too large. Request a shorter range."
    );
  }
  return { startsAtMs, endsAtMs };
}

function validateTimeboxQueryRange(query: CalendarAgendaQuery) {
  const { startsAtMs, endsAtMs } = parseTimeboxWindow(query.from, query.to, {
    maxDurationMs: MAX_TIMEBOX_QUERY_DAYS * 24 * 60 * 60 * 1000,
    limitKind: "range"
  });
  return { fromMs: startsAtMs, toMs: endsAtMs };
}

function taskOwnerId(task: Task) {
  return (
    getEntityOwnerId("task", task.id) ?? task.ownerUserId ?? task.userId ?? null
  );
}

function validateTaskTimeboxIdentity(input: {
  task: Task | undefined;
  taskId: string;
  projectId?: string | null;
  userId?: string | null;
}) {
  if (!input.task) {
    throw new HttpError(
      404,
      "calendar_timebox_task_not_found",
      "The task for this timebox does not exist."
    );
  }
  if (
    input.projectId !== undefined &&
    input.projectId !== null &&
    input.projectId !== input.task.projectId
  ) {
    throw new HttpError(
      409,
      "calendar_timebox_project_mismatch",
      "The timebox project must match the task's current project."
    );
  }
  const ownerId = taskOwnerId(input.task);
  if (input.userId !== undefined && input.userId !== null && ownerId) {
    if (input.userId !== ownerId) {
      throw new HttpError(
        409,
        "calendar_timebox_owner_mismatch",
        "A task timebox must stay owned by the same user as its task."
      );
    }
  }
  return ownerId;
}

function normalizeRules(rules: CalendarSchedulingRules | null | undefined) {
  return calendarSchedulingRulesSchema.parse(rules ?? DEFAULT_SCHEDULING_RULES);
}

export function storeEncryptedSecret(
  secretId: string,
  cipherText: string,
  description = ""
) {
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO stored_secrets (id, cipher_text, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET cipher_text = excluded.cipher_text, description = excluded.description, updated_at = excluded.updated_at`
    )
    .run(secretId, cipherText, description, now, now);
}

export function readEncryptedSecret(secretId: string) {
  const row = getDatabase()
    .prepare(`SELECT id, cipher_text FROM stored_secrets WHERE id = ?`)
    .get(secretId) as StoredSecretRow | undefined;
  return row?.cipher_text;
}

export function deleteEncryptedSecret(secretId: string) {
  getDatabase()
    .prepare(`DELETE FROM stored_secrets WHERE id = ?`)
    .run(secretId);
}

export function isSupersededCalendarConnection(connectionId: string) {
  const connection = getCalendarConnectionById(connectionId);
  if (!connection) {
    return false;
  }
  return isSupersededConnection(connection);
}

export function listCalendarConnections(): CalendarConnectionRecord[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, provider, label, account_label, status, config_json, credentials_secret_id, forge_calendar_id,
              last_synced_at, last_sync_error, created_at, updated_at
       FROM calendar_connections
       ORDER BY created_at DESC`
    )
    .all() as CalendarConnectionRow[];
  return rows.map(mapConnection);
}

function isSupersededConnection(connection: CalendarConnectionRecord) {
  return (
    typeof connection.config.replacedByConnectionId === "string" &&
    connection.config.replacedByConnectionId.trim().length > 0
  );
}

function activeConnectionIds() {
  return new Set(
    listCalendarConnections()
      .filter((connection) => !isSupersededConnection(connection))
      .map((connection) => connection.id)
  );
}

export function getCalendarConnectionById(
  connectionId: string
): CalendarConnectionRecord | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT id, provider, label, account_label, status, config_json, credentials_secret_id, forge_calendar_id,
              last_synced_at, last_sync_error, created_at, updated_at
       FROM calendar_connections
       WHERE id = ?`
    )
    .get(connectionId) as CalendarConnectionRow | undefined;
  return row ? mapConnection(row) : undefined;
}

export function createCalendarConnectionRecord(input: {
  provider: CalendarConnection["provider"];
  label: string;
  accountLabel?: string;
  config: Record<string, string | number | boolean | null>;
  credentialsSecretId: string;
  userId?: string | null;
}): CalendarConnectionRecord {
  const now = nowIso();
  const id = `calconn_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  getDatabase()
    .prepare(
      `INSERT INTO calendar_connections (
         id, provider, label, account_label, status, config_json, credentials_secret_id, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, 'connected', ?, ?, ?, ?)`
    )
    .run(
      id,
      input.provider,
      input.label,
      input.accountLabel ?? "",
      JSON.stringify(input.config),
      input.credentialsSecretId,
      now,
      now
    );
  setEntityOwner("calendar_connection", id, input.userId ?? null);
  return getCalendarConnectionById(id)!;
}

export function updateCalendarConnectionRecord(
  connectionId: string,
  patch: Partial<{
    label: string;
    accountLabel: string;
    status: CalendarConnection["status"];
    config: Record<string, string | number | boolean | null>;
    forgeCalendarId: string | null;
    lastSyncedAt: string | null;
    lastSyncError: string | null;
  }>
): CalendarConnectionRecord | undefined {
  const current = getCalendarConnectionById(connectionId);
  if (!current) {
    return undefined;
  }
  const next = {
    label: patch.label ?? current.label,
    accountLabel: patch.accountLabel ?? current.accountLabel,
    status: patch.status ?? current.status,
    config: patch.config ?? current.config,
    forgeCalendarId:
      patch.forgeCalendarId === undefined
        ? current.forgeCalendarId
        : patch.forgeCalendarId,
    lastSyncedAt:
      patch.lastSyncedAt === undefined
        ? current.lastSyncedAt
        : patch.lastSyncedAt,
    lastSyncError:
      patch.lastSyncError === undefined
        ? current.lastSyncError
        : patch.lastSyncError,
    updatedAt: nowIso()
  };

  getDatabase()
    .prepare(
      `UPDATE calendar_connections
       SET label = ?, account_label = ?, status = ?, config_json = ?, forge_calendar_id = ?, last_synced_at = ?, last_sync_error = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      next.label,
      next.accountLabel,
      next.status,
      JSON.stringify(next.config),
      next.forgeCalendarId,
      next.lastSyncedAt,
      next.lastSyncError,
      next.updatedAt,
      connectionId
    );

  return getCalendarConnectionById(connectionId);
}

export function deleteCalendarConnectionRecord(connectionId: string) {
  const current = getCalendarConnectionById(connectionId);
  if (!current) {
    return undefined;
  }
  getDatabase()
    .prepare(
      `UPDATE calendar_connections
       SET forge_calendar_id = NULL, updated_at = ?
       WHERE id = ?`
    )
    .run(nowIso(), connectionId);
  getDatabase()
    .prepare(`DELETE FROM calendar_connections WHERE id = ?`)
    .run(connectionId);
  clearEntityOwner("calendar_connection", connectionId);
  return current;
}

export function deleteExternalEventsForConnection(connectionId: string) {
  const rows = getDatabase()
    .prepare(
      `SELECT id
       FROM forge_events
       WHERE ownership = 'external' AND preferred_connection_id = ?`
    )
    .all(connectionId) as Array<{ id: string }>;
  for (const row of rows) {
    getDatabase().prepare(`DELETE FROM forge_events WHERE id = ?`).run(row.id);
  }
  return rows.map((row) => row.id);
}

export function rehomeCalendarConnectionReferences(input: {
  fromConnectionId: string;
  toConnectionId: string;
}) {
  return runInTransaction(() => {
    const fromCalendars = listCalendars(input.fromConnectionId, {
      includeUnselected: true
    });
    const toCalendars = listCalendars(input.toConnectionId, {
      includeUnselected: true
    });
    const toForgeCalendar =
      toCalendars.find((calendar) => calendar.forgeManaged) ??
      toCalendars.find((calendar) => calendar.canWrite) ??
      null;
    const toByCanonicalKey = new Map(
      toCalendars
        .filter(
          (calendar): calendar is typeof calendar & { canonicalKey: string } =>
            typeof calendar.canonicalKey === "string" &&
            calendar.canonicalKey.trim().length > 0
        )
        .map((calendar) => [calendar.canonicalKey, calendar])
    );
    const mappedCalendarIds = new Map<string, string | null>();
    for (const fromCalendar of fromCalendars) {
      const mapped =
        (fromCalendar.canonicalKey
          ? toByCanonicalKey.get(fromCalendar.canonicalKey)
          : null) ??
        (fromCalendar.forgeManaged ? toForgeCalendar : null) ??
        null;
      mappedCalendarIds.set(fromCalendar.id, mapped?.id ?? null);
    }

    const now = nowIso();

    const forgeEventRows = getDatabase()
      .prepare(
        `SELECT id, preferred_calendar_id
         FROM forge_events
         WHERE ownership = 'forge' AND preferred_connection_id = ?`
      )
      .all(input.fromConnectionId) as Array<{
      id: string;
      preferred_calendar_id: string | null;
    }>;

    const updateForgeEvent = getDatabase().prepare(
      `UPDATE forge_events
       SET preferred_connection_id = ?, preferred_calendar_id = ?, updated_at = ?
       WHERE id = ?`
    );

    for (const row of forgeEventRows) {
      const nextCalendarId = row.preferred_calendar_id
        ? (mappedCalendarIds.get(row.preferred_calendar_id) ??
          toForgeCalendar?.id ??
          null)
        : (toForgeCalendar?.id ?? null);
      updateForgeEvent.run(
        nextCalendarId ? input.toConnectionId : null,
        nextCalendarId,
        now,
        row.id
      );
    }

    const timeboxRows = getDatabase()
      .prepare(
        `SELECT id, calendar_id
         FROM task_timeboxes
         WHERE connection_id = ?`
      )
      .all(input.fromConnectionId) as Array<{
      id: string;
      calendar_id: string | null;
    }>;

    const updateTimebox = getDatabase().prepare(
      `UPDATE task_timeboxes
       SET connection_id = ?, calendar_id = ?, remote_event_id = NULL, updated_at = ?
       WHERE id = ?`
    );

    for (const row of timeboxRows) {
      const nextCalendarId = row.calendar_id
        ? (mappedCalendarIds.get(row.calendar_id) ??
          toForgeCalendar?.id ??
          null)
        : (toForgeCalendar?.id ?? null);
      updateTimebox.run(
        nextCalendarId ? input.toConnectionId : null,
        nextCalendarId,
        now,
        row.id
      );
    }

    getDatabase()
      .prepare(
        `DELETE FROM forge_event_sources
         WHERE connection_id = ?
           AND forge_event_id IN (
             SELECT id
             FROM forge_events
             WHERE ownership = 'forge'
           )`
      )
      .run(input.fromConnectionId);
  });
}

export function detachConnectionFromForgeEvents(connectionId: string) {
  const now = nowIso();
  getDatabase()
    .prepare(
      `UPDATE forge_events
       SET preferred_connection_id = NULL,
           preferred_calendar_id = NULL,
           updated_at = ?
       WHERE ownership = 'forge' AND preferred_connection_id = ?`
    )
    .run(now, connectionId);
  getDatabase()
    .prepare(
      `DELETE FROM forge_event_sources
       WHERE connection_id = ?`
    )
    .run(connectionId);
}

export function listCalendars(
  connectionId?: string,
  options: {
    includeUnselected?: boolean;
  } = {}
) {
  const visibilityClause = options.includeUnselected
    ? ""
    : connectionId
      ? "AND (selected_for_sync = 1 OR forge_managed = 1)"
      : "WHERE (selected_for_sync = 1 OR forge_managed = 1)";
  const rows = getDatabase()
    .prepare(
      `SELECT id, connection_id, remote_id, title, description, color, timezone, is_primary, can_write, selected_for_sync, forge_managed,
              source_id, source_title, source_type, calendar_type, host_calendar_id, canonical_key,
              last_synced_at, created_at, updated_at
       FROM calendar_calendars
       ${connectionId ? `WHERE connection_id = ? ${visibilityClause}` : visibilityClause}
       ORDER BY forge_managed DESC, title ASC`
    )
    .all(...(connectionId ? [connectionId] : [])) as CalendarRow[];
  const mapped = rows.map(mapCalendar);
  if (connectionId) {
    return mapped;
  }
  const activeIds = activeConnectionIds();
  return mapped.filter((calendar) => activeIds.has(calendar.connectionId));
}

export function getCalendarById(calendarId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT id, connection_id, remote_id, title, description, color, timezone, is_primary, can_write, selected_for_sync, forge_managed,
              source_id, source_title, source_type, calendar_type, host_calendar_id, canonical_key,
              last_synced_at, created_at, updated_at
       FROM calendar_calendars
       WHERE id = ?`
    )
    .get(calendarId) as CalendarRow | undefined;
  return row ? mapCalendar(row) : undefined;
}

function getDefaultWritableCalendar() {
  const row = getDatabase()
    .prepare(
      `SELECT calendars.id, calendars.connection_id, calendars.remote_id, calendars.title, calendars.description,
              calendars.color, calendars.timezone, calendars.is_primary, calendars.can_write,
              calendars.selected_for_sync, calendars.forge_managed, calendars.source_id, calendars.source_title,
              calendars.source_type, calendars.calendar_type, calendars.host_calendar_id, calendars.canonical_key,
              calendars.last_synced_at, calendars.created_at, calendars.updated_at
       FROM calendar_calendars AS calendars
       INNER JOIN calendar_connections AS connections
         ON connections.id = calendars.connection_id
       WHERE calendars.can_write = 1
         AND connections.status = 'connected'
         AND (calendars.selected_for_sync = 1 OR calendars.forge_managed = 1)
       ORDER BY calendars.forge_managed DESC, calendars.is_primary DESC, calendars.title ASC
       LIMIT 1`
    )
    .get() as CalendarRow | undefined;
  return row ? mapCalendar(row) : undefined;
}

export function getCalendarByRemoteId(connectionId: string, remoteId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT id, connection_id, remote_id, title, description, color, timezone, is_primary, can_write, selected_for_sync, forge_managed,
              source_id, source_title, source_type, calendar_type, host_calendar_id, canonical_key,
              last_synced_at, created_at, updated_at
       FROM calendar_calendars
       WHERE connection_id = ? AND remote_id = ?`
    )
    .get(connectionId, remoteId) as CalendarRow | undefined;
  return row ? mapCalendar(row) : undefined;
}

export function upsertCalendarRecord(
  connectionId: string,
  input: CalendarSyncCalendarInput
) {
  const existing = getCalendarByRemoteId(connectionId, input.remoteId);
  const now = nowIso();

  if (existing) {
    getDatabase()
      .prepare(
        `UPDATE calendar_calendars
         SET title = ?, description = ?, color = ?, timezone = ?, is_primary = ?, can_write = ?, selected_for_sync = ?, forge_managed = ?,
             source_id = ?, source_title = ?, source_type = ?, calendar_type = ?, host_calendar_id = ?, canonical_key = ?,
             last_synced_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.title,
        input.description ?? existing.description,
        input.color ?? existing.color,
        normalizeTimezone(input.timezone ?? existing.timezone),
        input.isPrimary ? 1 : 0,
        input.canWrite === false ? 0 : 1,
        input.selectedForSync === false ? 0 : 1,
        input.forgeManaged ? 1 : 0,
        input.sourceId ?? existing.sourceId,
        input.sourceTitle ?? existing.sourceTitle,
        input.sourceType ?? existing.sourceType,
        input.calendarType ?? existing.calendarType,
        input.hostCalendarId ?? existing.hostCalendarId,
        input.canonicalKey ?? existing.canonicalKey ?? existing.remoteId,
        now,
        now,
        existing.id
      );
    return getCalendarById(existing.id)!;
  }

  const id = `calendar_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  getDatabase()
    .prepare(
      `INSERT INTO calendar_calendars (
         id, connection_id, remote_id, title, description, color, timezone, is_primary, can_write, selected_for_sync, forge_managed,
         source_id, source_title, source_type, calendar_type, host_calendar_id, canonical_key, last_synced_at, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      connectionId,
      input.remoteId,
      input.title,
      input.description ?? "",
      input.color ?? "#7dd3fc",
      normalizeTimezone(input.timezone),
      input.isPrimary ? 1 : 0,
      input.canWrite === false ? 0 : 1,
      input.selectedForSync === false ? 0 : 1,
      input.forgeManaged ? 1 : 0,
      input.sourceId ?? null,
      input.sourceTitle ?? null,
      input.sourceType ?? null,
      input.calendarType ?? null,
      input.hostCalendarId ?? null,
      input.canonicalKey ?? input.remoteId,
      now,
      now,
      now
    );

  return getCalendarById(id)!;
}

export function listCalendarEvents(
  query: CalendarAgendaQuery & {
    connectionId?: string;
    calendarId?: string;
    userIds?: string[];
  }
) {
  const clauses = [
    "deleted_at IS NULL",
    `(ownership != 'external' OR preferred_calendar_id IS NULL OR EXISTS (
        SELECT 1
        FROM calendar_calendars visible_calendars
        WHERE visible_calendars.id = forge_events.preferred_calendar_id
          AND (visible_calendars.selected_for_sync = 1 OR visible_calendars.forge_managed = 1)
      ))`
  ];
  const params: Array<string> = [];
  if (query.connectionId) {
    clauses.push(
      "(preferred_connection_id = ? OR EXISTS (SELECT 1 FROM forge_event_sources src WHERE src.forge_event_id = forge_events.id AND src.connection_id = ?))"
    );
    params.push(query.connectionId);
    params.push(query.connectionId);
  }
  if (query.calendarId) {
    clauses.push(
      "(preferred_calendar_id = ? OR EXISTS (SELECT 1 FROM forge_event_sources src WHERE src.forge_event_id = forge_events.id AND src.calendar_id = ?))"
    );
    params.push(query.calendarId);
    params.push(query.calendarId);
  }
  clauses.push("end_at > ?");
  params.push(query.from);
  clauses.push("start_at < ?");
  params.push(query.to);

  const rows = getDatabase()
    .prepare(
      `SELECT id, preferred_connection_id, preferred_calendar_id, ownership, origin_type, status, title, description, location,
              place_label, place_address, place_timezone, place_latitude, place_longitude, place_source, place_external_id,
              start_at, end_at, timezone, is_all_day, availability, event_type, categories_json, deleted_at, created_at, updated_at
       FROM forge_events
       WHERE ${clauses.join(" AND ")}
       ORDER BY start_at ASC, title ASC`
    )
    .all(...params) as CalendarEventRow[];
  const activeIds = activeConnectionIds();
  return filterOwnedEntities(
    "calendar_event",
    rows
      .map(mapEvent)
      .filter(
        (event) =>
          event.ownership !== "external" ||
          event.connectionId === null ||
          activeIds.has(event.connectionId)
      ),
    query.userIds
  );
}

export function getCalendarEventById(eventId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT id, preferred_connection_id, preferred_calendar_id, ownership, origin_type, status, title, description, location,
              place_label, place_address, place_timezone, place_latitude, place_longitude, place_source, place_external_id,
              start_at, end_at, timezone, is_all_day, availability, event_type, categories_json, deleted_at, created_at, updated_at
       FROM forge_events
       WHERE id = ?`
    )
    .get(eventId) as CalendarEventRow | undefined;
  return row ? decorateOwnedEntity("calendar_event", mapEvent(row)) : undefined;
}

export function getCalendarEventStorageRecord(eventId: string) {
  return getDatabase()
    .prepare(
      `SELECT id, preferred_connection_id, preferred_calendar_id, ownership, origin_type, status, title, description, location,
              place_label, place_address, place_timezone, place_latitude, place_longitude, place_source, place_external_id,
              start_at, end_at, timezone, is_all_day, availability, event_type, categories_json, deleted_at, created_at, updated_at
       FROM forge_events
       WHERE id = ?`
    )
    .get(eventId) as CalendarEventRow | undefined;
}

export function getCalendarEventByRemoteId(
  connectionId: string,
  calendarId: string,
  remoteId: string
) {
  const row = getDatabase()
    .prepare(
      `SELECT forge_events.id, forge_events.preferred_connection_id, forge_events.preferred_calendar_id, forge_events.ownership,
              forge_events.origin_type, forge_events.status, forge_events.title, forge_events.description, forge_events.location,
              forge_events.place_label, forge_events.place_address, forge_events.place_timezone, forge_events.place_latitude,
              forge_events.place_longitude, forge_events.place_source, forge_events.place_external_id,
              forge_events.start_at, forge_events.end_at, forge_events.timezone, forge_events.is_all_day, forge_events.availability,
              forge_events.event_type, forge_events.categories_json, forge_events.deleted_at, forge_events.created_at, forge_events.updated_at
       FROM forge_event_sources
       INNER JOIN forge_events ON forge_events.id = forge_event_sources.forge_event_id
       WHERE forge_event_sources.connection_id = ? AND forge_event_sources.calendar_id = ? AND forge_event_sources.remote_event_id = ?`
    )
    .get(connectionId, calendarId, remoteId) as CalendarEventRow | undefined;
  return row ? mapEvent(row) : undefined;
}

export function listCalendarEventSources(eventId: string) {
  return listEventSourcesForEvent(eventId);
}

export function getPrimaryCalendarEventSource(eventId: string) {
  return listEventSourcesForEvent(eventId)[0] ?? null;
}

function upsertEventSource(input: {
  forgeEventId: string;
  provider: CalendarEventSource["provider"];
  connectionId?: string | null;
  calendarId?: string | null;
  remoteCalendarId?: string | null;
  remoteEventId: string;
  remoteUid?: string | null;
  recurrenceInstanceId?: string | null;
  isMasterRecurring?: boolean;
  remoteHref?: string | null;
  remoteEtag?: string | null;
  syncState?: CalendarEventSource["syncState"];
  rawPayloadJson?: string;
  lastSyncedAt?: string | null;
}) {
  const now = nowIso();
  const existing = getDatabase()
    .prepare(
      `SELECT id
       FROM forge_event_sources
       WHERE provider = ? AND connection_id IS ? AND calendar_id IS ? AND remote_event_id = ?`
    )
    .get(
      input.provider,
      input.connectionId ?? null,
      input.calendarId ?? null,
      input.remoteEventId
    ) as { id: string } | undefined;

  if (existing) {
    getDatabase()
      .prepare(
        `UPDATE forge_event_sources
         SET forge_event_id = ?, remote_calendar_id = ?, remote_uid = ?, recurrence_instance_id = ?, is_master_recurring = ?,
             remote_href = ?, remote_etag = ?, sync_state = ?, raw_payload_json = ?, last_synced_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.forgeEventId,
        input.remoteCalendarId ?? null,
        input.remoteUid ?? null,
        input.recurrenceInstanceId ?? null,
        input.isMasterRecurring ? 1 : 0,
        input.remoteHref ?? null,
        input.remoteEtag ?? null,
        input.syncState ?? "synced",
        input.rawPayloadJson ?? "{}",
        input.lastSyncedAt ?? null,
        now,
        existing.id
      );
    return existing.id;
  }

  const id = `evsrc_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  getDatabase()
    .prepare(
      `INSERT INTO forge_event_sources (
         id, forge_event_id, provider, connection_id, calendar_id, remote_calendar_id, remote_event_id, remote_uid,
         recurrence_instance_id, is_master_recurring, remote_href, remote_etag, sync_state, raw_payload_json, last_synced_at, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.forgeEventId,
      input.provider,
      input.connectionId ?? null,
      input.calendarId ?? null,
      input.remoteCalendarId ?? null,
      input.remoteEventId,
      input.remoteUid ?? null,
      input.recurrenceInstanceId ?? null,
      input.isMasterRecurring ? 1 : 0,
      input.remoteHref ?? null,
      input.remoteEtag ?? null,
      input.syncState ?? "synced",
      input.rawPayloadJson ?? "{}",
      input.lastSyncedAt ?? null,
      now,
      now
    );
  return id;
}

export function registerCalendarEventSourceProjection(input: {
  forgeEventId: string;
  provider: CalendarEventSource["provider"];
  connectionId?: string | null;
  calendarId?: string | null;
  remoteCalendarId?: string | null;
  remoteEventId: string;
  remoteUid?: string | null;
  recurrenceInstanceId?: string | null;
  isMasterRecurring?: boolean;
  remoteHref?: string | null;
  remoteEtag?: string | null;
  syncState?: CalendarEventSource["syncState"];
  rawPayloadJson?: string;
  lastSyncedAt?: string | null;
}) {
  upsertEventSource(input);
  return listEventSourcesForEvent(input.forgeEventId);
}

export function markCalendarEventSourcesSyncState(
  forgeEventId: string,
  syncState: CalendarEventSource["syncState"]
) {
  const now = nowIso();
  getDatabase()
    .prepare(
      `UPDATE forge_event_sources
       SET sync_state = ?, updated_at = ?
       WHERE forge_event_id = ?`
    )
    .run(syncState, now, forgeEventId);
}

function replaceEventLinks(
  forgeEventId: string,
  links: Array<{
    entityType: CalendarEventLink["entityType"];
    entityId: string;
    relationshipType?: string;
  }>
) {
  getDatabase()
    .prepare(`DELETE FROM forge_event_links WHERE forge_event_id = ?`)
    .run(forgeEventId);
  const now = nowIso();
  const insert = getDatabase().prepare(
    `INSERT INTO forge_event_links (id, forge_event_id, entity_type, entity_id, relationship_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const link of links) {
    insert.run(
      `evlink_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
      forgeEventId,
      link.entityType,
      link.entityId,
      link.relationshipType ?? "context",
      now,
      now
    );
  }
}

export function upsertCalendarEventRecord(
  connectionId: string,
  input: CalendarSyncEventInput
) {
  const calendar = getCalendarByRemoteId(connectionId, input.calendarRemoteId);
  if (!calendar) {
    throw new Error(
      `Calendar ${input.calendarRemoteId} is not registered for connection ${connectionId}`
    );
  }
  const connection = getCalendarConnectionById(connectionId);
  if (!connection) {
    throw new Error(`Calendar connection ${connectionId} is not registered`);
  }
  const connectionOwnerId =
    getEntityOwnerId("calendar_connection", connectionId) ??
    setEntityOwner("calendar_connection", connectionId).userId;
  const existing = getCalendarEventByRemoteId(
    connectionId,
    calendar.id,
    input.remoteId
  );
  const now = nowIso();

  if (existing) {
    getDatabase()
      .prepare(
        `UPDATE forge_events
         SET preferred_connection_id = ?, preferred_calendar_id = ?, ownership = ?, origin_type = ?, status = ?, title = ?, description = ?, location = ?,
             place_label = ?, place_address = ?, place_timezone = ?, place_latitude = ?, place_longitude = ?, place_source = ?, place_external_id = ?,
             start_at = ?, end_at = ?, timezone = ?, is_all_day = ?, availability = ?, event_type = ?, categories_json = ?, deleted_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        connectionId,
        calendar.id,
        input.ownership ?? existing.ownership,
        connection.provider,
        input.status ?? existing.status,
        input.title,
        input.description ?? "",
        input.location ?? "",
        input.location ?? "",
        "",
        "",
        null,
        null,
        "",
        "",
        input.startAt,
        input.endAt,
        normalizeTimezone(input.timezone ?? calendar.timezone),
        input.isAllDay ? 1 : 0,
        input.availability ?? existing.availability,
        input.eventType ?? "",
        JSON.stringify(input.categories ?? []),
        input.deletedAt ?? null,
        now,
        existing.id
      );
    upsertEventSource({
      forgeEventId: existing.id,
      provider: connection.provider,
      connectionId,
      calendarId: calendar.id,
      remoteCalendarId: calendar.remoteId,
      remoteEventId: input.remoteId,
      remoteUid:
        typeof input.rawPayload?.uid === "string"
          ? String(input.rawPayload.uid)
          : typeof input.rawPayload?.externalId === "string"
            ? String(input.rawPayload.externalId)
            : typeof input.rawPayload?.iCalUID === "string"
              ? String(input.rawPayload.iCalUID)
              : typeof input.rawPayload?.iCalUId === "string"
                ? String(input.rawPayload.iCalUId)
                : null,
      recurrenceInstanceId: readRecurrenceInstanceId(input.rawPayload),
      isMasterRecurring: isMasterRecurringProviderRecord(input.rawPayload),
      remoteHref: input.remoteHref ?? null,
      remoteEtag: input.remoteEtag ?? null,
      syncState: input.deletedAt ? "deleted" : "synced",
      rawPayloadJson: JSON.stringify(input.rawPayload ?? {}),
      lastSyncedAt: input.remoteUpdatedAt ?? now
    });
    if ((input.ownership ?? existing.ownership) === "external") {
      setEntityOwner("calendar_event", existing.id, connectionOwnerId);
    }
    return getCalendarEventById(existing.id)!;
  }

  const id = `calevent_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  getDatabase()
    .prepare(
      `INSERT INTO forge_events (
         id, preferred_connection_id, preferred_calendar_id, ownership, origin_type, status, title, description, location,
         place_label, place_address, place_timezone, place_latitude, place_longitude, place_source, place_external_id,
         start_at, end_at, timezone, is_all_day, availability, event_type, categories_json, deleted_at, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      connectionId,
      calendar.id,
      input.ownership ?? "external",
      connection.provider,
      input.status ?? "confirmed",
      input.title,
      input.description ?? "",
      input.location ?? "",
      input.location ?? "",
      "",
      "",
      null,
      null,
      "",
      "",
      input.startAt,
      input.endAt,
      normalizeTimezone(input.timezone ?? calendar.timezone),
      input.isAllDay ? 1 : 0,
      input.availability ?? "busy",
      input.eventType ?? "",
      JSON.stringify(input.categories ?? []),
      input.deletedAt ?? null,
      now,
      now
    );
  upsertEventSource({
    forgeEventId: id,
    provider: connection.provider,
    connectionId,
    calendarId: calendar.id,
    remoteCalendarId: calendar.remoteId,
    remoteEventId: input.remoteId,
    remoteUid:
      typeof input.rawPayload?.uid === "string"
        ? String(input.rawPayload.uid)
        : typeof input.rawPayload?.externalId === "string"
          ? String(input.rawPayload.externalId)
          : typeof input.rawPayload?.iCalUID === "string"
            ? String(input.rawPayload.iCalUID)
            : typeof input.rawPayload?.iCalUId === "string"
              ? String(input.rawPayload.iCalUId)
              : null,
    recurrenceInstanceId: readRecurrenceInstanceId(input.rawPayload),
    isMasterRecurring: isMasterRecurringProviderRecord(input.rawPayload),
    remoteHref: input.remoteHref ?? null,
    remoteEtag: input.remoteEtag ?? null,
    syncState: input.deletedAt ? "deleted" : "synced",
    rawPayloadJson: JSON.stringify(input.rawPayload ?? {}),
    lastSyncedAt: input.remoteUpdatedAt ?? now
  });
  setEntityOwner("calendar_event", id, connectionOwnerId);
  return getCalendarEventById(id)!;
}

export function createCalendarEvent(input: CreateCalendarEventInput) {
  const now = nowIso();
  const id = `calevent_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const startAt = new Date(input.startAt).toISOString();
  const endAt = new Date(input.endAt).toISOString();
  const place = input.place ?? {
    label: "",
    address: "",
    timezone: "",
    latitude: null,
    longitude: null,
    source: "",
    externalPlaceId: ""
  };
  const preferredCalendar =
    input.preferredCalendarId === undefined
      ? (getDefaultWritableCalendar() ?? null)
      : input.preferredCalendarId
        ? getCalendarById(input.preferredCalendarId)
        : null;
  if (input.preferredCalendarId && !preferredCalendar) {
    throw new HttpError(
      404,
      "calendar_not_found",
      `Calendar ${input.preferredCalendarId} does not exist.`
    );
  }
  if (preferredCalendar && !preferredCalendar.canWrite) {
    throw new HttpError(
      409,
      "calendar_provider_read_only",
      "The selected provider calendar is read-only. Choose a writable calendar or keep the event in Forge only.",
      { calendarId: preferredCalendar.id }
    );
  }

  getDatabase()
    .prepare(
      `INSERT INTO forge_events (
         id, preferred_connection_id, preferred_calendar_id, ownership, origin_type, status, title, description, location,
         place_label, place_address, place_timezone, place_latitude, place_longitude, place_source, place_external_id,
         start_at, end_at, timezone, is_all_day, availability, event_type, categories_json, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      preferredCalendar?.connectionId ?? null,
      preferredCalendar?.id ?? null,
      "forge",
      "native",
      "confirmed",
      input.title,
      input.description,
      input.location,
      place.label || input.location,
      place.address,
      place.timezone,
      place.latitude,
      place.longitude,
      place.source,
      place.externalPlaceId,
      startAt,
      endAt,
      normalizeTimezone(input.timezone),
      input.isAllDay ? 1 : 0,
      input.availability,
      input.eventType,
      JSON.stringify(input.categories),
      now,
      now
    );

  replaceEventLinks(id, input.links);
  upsertEntityActionProfile({
    entityType: "calendar_event",
    entityId: id,
    profile: buildCalendarEventActionProfile({
      eventId: id,
      title: input.title,
      eventType: input.eventType,
      availability: input.availability,
      startAt,
      endAt,
      activityPresetKey: input.activityPresetKey ?? null,
      customSustainRateApPerHour: input.customSustainRateApPerHour ?? null
    })
  });
  setEntityOwner("calendar_event", id, inferCalendarEventOwnerId(input));
  return getCalendarEventById(id)!;
}

export function updateCalendarEvent(
  eventId: string,
  patch: UpdateCalendarEventInput
) {
  const current = getCalendarEventById(eventId);
  if (!current) {
    return undefined;
  }

  const recurringSource = current.sourceMappings.find(
    (source) => source.recurrenceInstanceId || source.isMasterRecurring
  );
  if (recurringSource && patch.recurrenceEditScope === undefined) {
    throw new HttpError(
      409,
      "calendar_recurring_edit_scope_required",
      "Choose whether this recurring change applies to one occurrence or the series.",
      {
        eventId,
        recurrenceInstanceId: recurringSource.recurrenceInstanceId,
        allowedScopes: ["single", "series"]
      }
    );
  }
  if (recurringSource && patch.recurrenceEditScope === "series") {
    throw new HttpError(
      409,
      "calendar_recurring_series_edit_unsupported",
      "Forge cannot safely edit the whole provider series from an expanded occurrence yet. Open the provider calendar or copy the occurrence into a Forge-owned event.",
      {
        eventId,
        recurrenceInstanceId: recurringSource.recurrenceInstanceId,
        supportedScope: "single"
      }
    );
  }
  if (current.ownership === "external") {
    throw new HttpError(
      409,
      "calendar_provider_event_read_only",
      recurringSource
        ? "This provider occurrence is mirrored read-only. Copy it to create a Forge-owned event before changing it."
        : "This provider event is mirrored read-only. Copy it to create a Forge-owned event before changing it.",
      {
        eventId,
        provider: current.originType,
        recurrenceInstanceId: recurringSource?.recurrenceInstanceId ?? null,
        permittedAction: "copy_as_forge_event"
      }
    );
  }

  const preferredCalendar =
    patch.preferredCalendarId === undefined
      ? current.calendarId
        ? getCalendarById(current.calendarId)
        : null
      : patch.preferredCalendarId
        ? getCalendarById(patch.preferredCalendarId)
        : null;
  if (patch.preferredCalendarId && !preferredCalendar) {
    throw new HttpError(
      404,
      "calendar_not_found",
      `Calendar ${patch.preferredCalendarId} does not exist.`
    );
  }
  if (preferredCalendar && !preferredCalendar.canWrite) {
    throw new HttpError(
      409,
      "calendar_provider_read_only",
      "The selected provider calendar is read-only. Choose a writable calendar or keep the event in Forge only.",
      { calendarId: preferredCalendar.id }
    );
  }

  const next = {
    preferredConnectionId: preferredCalendar?.connectionId ?? null,
    preferredCalendarId:
      patch.preferredCalendarId === undefined
        ? current.calendarId
        : patch.preferredCalendarId,
    title: patch.title ?? current.title,
    description: patch.description ?? current.description,
    location: patch.location ?? current.location,
    place: {
      label: patch.place?.label ?? current.place.label,
      address: patch.place?.address ?? current.place.address,
      timezone: patch.place?.timezone ?? current.place.timezone,
      latitude:
        patch.place?.latitude === undefined
          ? current.place.latitude
          : patch.place.latitude,
      longitude:
        patch.place?.longitude === undefined
          ? current.place.longitude
          : patch.place.longitude,
      source: patch.place?.source ?? current.place.source,
      externalPlaceId:
        patch.place?.externalPlaceId ?? current.place.externalPlaceId
    },
    startAt: patch.startAt
      ? new Date(patch.startAt).toISOString()
      : current.startAt,
    endAt: patch.endAt ? new Date(patch.endAt).toISOString() : current.endAt,
    timezone: normalizeTimezone(patch.timezone ?? current.timezone),
    isAllDay: patch.isAllDay ?? current.isAllDay,
    availability: patch.availability ?? current.availability,
    eventType: patch.eventType ?? current.eventType,
    categories: patch.categories ?? current.categories,
    updatedAt: nowIso()
  };

  getDatabase()
    .prepare(
      `UPDATE forge_events
       SET preferred_connection_id = ?, preferred_calendar_id = ?, title = ?, description = ?, location = ?,
           place_label = ?, place_address = ?, place_timezone = ?, place_latitude = ?, place_longitude = ?, place_source = ?, place_external_id = ?,
           start_at = ?, end_at = ?, timezone = ?, is_all_day = ?, availability = ?, event_type = ?, categories_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      next.preferredConnectionId,
      next.preferredCalendarId,
      next.title,
      next.description,
      next.location,
      next.place.label,
      next.place.address,
      next.place.timezone,
      next.place.latitude,
      next.place.longitude,
      next.place.source,
      next.place.externalPlaceId,
      next.startAt,
      next.endAt,
      next.timezone,
      next.isAllDay ? 1 : 0,
      next.availability,
      next.eventType,
      JSON.stringify(next.categories),
      next.updatedAt,
      eventId
    );

  if (patch.links) {
    replaceEventLinks(eventId, patch.links);
  }

  if (
    patch.title !== undefined ||
    patch.startAt !== undefined ||
    patch.endAt !== undefined ||
    patch.availability !== undefined ||
    patch.eventType !== undefined ||
    patch.activityPresetKey !== undefined ||
    patch.customSustainRateApPerHour !== undefined
  ) {
    upsertEntityActionProfile({
      entityType: "calendar_event",
      entityId: eventId,
      profile: buildCalendarEventActionProfile({
        eventId,
        title: next.title,
        eventType: next.eventType,
        availability: next.availability,
        startAt: next.startAt,
        endAt: next.endAt,
        activityPresetKey:
          patch.activityPresetKey === undefined
            ? (current.actionProfile?.metadata?.activityPresetKey as
                | string
                | null
                | undefined)
            : patch.activityPresetKey,
        customSustainRateApPerHour:
          patch.customSustainRateApPerHour === undefined
            ? typeof current.actionProfile?.metadata
                ?.customSustainRateApPerHour === "number"
              ? current.actionProfile.metadata.customSustainRateApPerHour
              : null
            : patch.customSustainRateApPerHour
      })
    });
  }

  if (patch.userId !== undefined || patch.links !== undefined) {
    setEntityOwner(
      "calendar_event",
      eventId,
      patch.userId === undefined
        ? inferCalendarEventOwnerId({
            userId: current.userId ?? null,
            links: patch.links ?? current.links
          })
        : patch.userId
    );
  }

  if (current.sourceMappings.length > 0) {
    const nextSyncState =
      current.deletedAt !== null
        ? "deleted"
        : current.originType === "native"
          ? "pending_update"
          : "synced";
    getDatabase()
      .prepare(
        `UPDATE forge_event_sources
         SET sync_state = ?, updated_at = ?
         WHERE forge_event_id = ? AND sync_state != 'deleted'`
      )
      .run(nextSyncState, next.updatedAt, eventId);
  }

  return getCalendarEventById(eventId)!;
}

export function deleteCalendarEvent(eventId: string) {
  const current = getCalendarEventById(eventId);
  if (!current) {
    return undefined;
  }
  const deletedAt = nowIso();
  getDatabase()
    .prepare(
      `UPDATE forge_events
       SET deleted_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(deletedAt, deletedAt, eventId);
  getDatabase()
    .prepare(
      `UPDATE forge_event_sources
       SET sync_state = CASE WHEN remote_event_id IS NOT NULL THEN 'pending_delete' ELSE sync_state END,
           updated_at = ?
       WHERE forge_event_id = ? AND sync_state != 'deleted'`
    )
    .run(deletedAt, eventId);
  return getCalendarEventById(eventId)!;
}

export function createWorkBlockTemplate(input: CreateWorkBlockTemplateInput) {
  return runInTransaction(() => {
    const now = nowIso();
    const id = `wbtpl_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    getDatabase()
      .prepare(
        `INSERT INTO work_block_templates (
           id, title, kind, color, timezone, weekdays_json, start_minute, end_minute, starts_on, ends_on, exclusion_dates_json, blocking_state, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.title,
        input.kind,
        input.color,
        normalizeTimezone(input.timezone),
        JSON.stringify(input.weekDays),
        input.startMinute,
        input.endMinute,
        input.startsOn ?? null,
        input.endsOn ?? null,
        JSON.stringify(normalizeExclusionDates(input.exclusionDates)),
        input.blockingState,
        now,
        now
      );
    upsertEntityActionProfile({
      entityType: "work_block_template",
      entityId: id,
      profile: buildWorkBlockTemplateActionProfile({
        templateId: id,
        title: input.title,
        kind: input.kind,
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        activityPresetKey: input.activityPresetKey ?? null,
        customSustainRateApPerHour: input.customSustainRateApPerHour ?? null
      })
    });
    setEntityOwner("work_block_template", id, input.userId);
    return getWorkBlockTemplateById(id)!;
  });
}

export function listWorkBlockTemplates(filters: { userIds?: string[] } = {}) {
  const rows = getDatabase()
    .prepare(
      `SELECT id, title, kind, color, timezone, weekdays_json, start_minute, end_minute, starts_on, ends_on, exclusion_dates_json, blocking_state, created_at, updated_at
       FROM work_block_templates
       ORDER BY COALESCE(starts_on, ''), start_minute ASC, title ASC`
    )
    .all() as WorkBlockTemplateRow[];
  return filterOwnedEntities(
    "work_block_template",
    rows.map(mapWorkBlockTemplate),
    filters.userIds
  );
}

export function getWorkBlockTemplateById(templateId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT id, title, kind, color, timezone, weekdays_json, start_minute, end_minute, starts_on, ends_on, exclusion_dates_json, blocking_state, created_at, updated_at
       FROM work_block_templates
       WHERE id = ?`
    )
    .get(templateId) as WorkBlockTemplateRow | undefined;
  return row
    ? decorateOwnedEntity("work_block_template", mapWorkBlockTemplate(row))
    : undefined;
}

export function updateWorkBlockTemplate(
  templateId: string,
  patch: UpdateWorkBlockTemplateInput
) {
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
    exclusionDates:
      patch.exclusionDates === undefined
        ? current.exclusionDates
        : normalizeExclusionDates(patch.exclusionDates),
    blockingState: patch.blockingState ?? current.blockingState,
    updatedAt: nowIso()
  };

  if (next.endMinute === next.startMinute) {
    throw new HttpError(
      400,
      "work_block_duration_invalid",
      "A recurring work block must have a non-zero duration. Use an earlier end minute for an overnight block."
    );
  }
  if (next.startsOn && next.endsOn && next.endsOn < next.startsOn) {
    throw new HttpError(
      400,
      "work_block_date_range_invalid",
      "The work block end date must be on or after its start date."
    );
  }

  getDatabase()
    .prepare(
      `UPDATE work_block_templates
       SET title = ?, kind = ?, color = ?, timezone = ?, weekdays_json = ?, start_minute = ?, end_minute = ?, starts_on = ?, ends_on = ?, exclusion_dates_json = ?, blocking_state = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      next.title,
      next.kind,
      next.color,
      next.timezone,
      JSON.stringify(next.weekDays),
      next.startMinute,
      next.endMinute,
      next.startsOn,
      next.endsOn,
      JSON.stringify(next.exclusionDates),
      next.blockingState,
      next.updatedAt,
      templateId
    );
  if (
    patch.title !== undefined ||
    patch.kind !== undefined ||
    patch.startMinute !== undefined ||
    patch.endMinute !== undefined ||
    patch.activityPresetKey !== undefined ||
    patch.customSustainRateApPerHour !== undefined
  ) {
    upsertEntityActionProfile({
      entityType: "work_block_template",
      entityId: templateId,
      profile: buildWorkBlockTemplateActionProfile({
        templateId,
        title: next.title,
        kind: next.kind,
        startMinute: next.startMinute,
        endMinute: next.endMinute,
        activityPresetKey:
          patch.activityPresetKey === undefined
            ? (current.actionProfile?.metadata?.activityPresetKey as
                | string
                | null
                | undefined)
            : patch.activityPresetKey,
        customSustainRateApPerHour:
          patch.customSustainRateApPerHour === undefined
            ? typeof current.actionProfile?.metadata
                ?.customSustainRateApPerHour === "number"
              ? current.actionProfile.metadata.customSustainRateApPerHour
              : null
            : patch.customSustainRateApPerHour
      })
    });
  }
  if (patch.userId !== undefined) {
    setEntityOwner("work_block_template", templateId, patch.userId);
  }
  return getWorkBlockTemplateById(templateId);
}

export function deleteWorkBlockTemplate(templateId: string) {
  const current = getWorkBlockTemplateById(templateId);
  if (!current) {
    return undefined;
  }
  getDatabase()
    .prepare(`DELETE FROM work_block_templates WHERE id = ?`)
    .run(templateId);
  return current;
}

const MAX_WORK_BLOCK_EXPANSION_DAYS = 732;
const MAX_WORK_BLOCK_INSTANCES = 10_000;

function deriveWorkBlockInstances(
  template: WorkBlockTemplate,
  query: CalendarAgendaQuery
) {
  const queryStartMs = Date.parse(query.from);
  const queryEndMs = Date.parse(query.to);
  if (
    !Number.isFinite(queryStartMs) ||
    !Number.isFinite(queryEndMs) ||
    queryEndMs <= queryStartMs
  ) {
    throw new HttpError(
      400,
      "calendar_range_invalid",
      "Calendar range end must be after its start."
    );
  }

  const queryStartDate = addCalendarDays(
    localDateKeyForInstant(query.from, template.timezone),
    -1
  );
  const queryEndDate = recurrenceEndDateForQuery(query.to, template.timezone);
  const firstDate =
    template.startsOn && template.startsOn > queryStartDate
      ? template.startsOn
      : queryStartDate;
  const lastDate =
    template.endsOn && template.endsOn < queryEndDate
      ? template.endsOn
      : queryEndDate;

  if (firstDate > lastDate) {
    return [];
  }

  const expansionDays =
    Math.round(
      (dateOnlyToUtcDate(lastDate).getTime() -
        dateOnlyToUtcDate(firstDate).getTime()) /
        (24 * 60 * 60 * 1000)
    ) + 1;
  if (expansionDays > MAX_WORK_BLOCK_EXPANSION_DAYS) {
    throw new HttpError(
      400,
      "calendar_range_too_large",
      `Recurring work blocks can be expanded across at most ${MAX_WORK_BLOCK_EXPANSION_DAYS} local calendar days per request.`
    );
  }

  const rows: WorkBlockInstance[] = [];
  const exclusions = new Set(template.exclusionDates);
  for (
    let cursorDate = firstDate;
    cursorDate <= lastDate;
    cursorDate = addCalendarDays(cursorDate, 1)
  ) {
    if (
      exclusions.has(cursorDate) ||
      !template.weekDays.includes(dateOnlyToUtcDate(cursorDate).getUTCDay())
    ) {
      continue;
    }
    const endDate =
      template.endMinute < template.startMinute
        ? addCalendarDays(cursorDate, 1)
        : cursorDate;
    const blockStart = localMinuteToInstant(
      cursorDate,
      template.startMinute,
      template.timezone
    );
    const blockEnd = localMinuteToInstant(
      endDate,
      template.endMinute,
      template.timezone
    );
    if (!blockStart || !blockEnd) {
      continue;
    }
    if (
      Date.parse(blockEnd) <= queryStartMs ||
      Date.parse(blockStart) >= queryEndMs
    ) {
      continue;
    }
    rows.push(
      workBlockInstanceSchema.parse({
        id: `wbinst_${template.id}_${cursorDate}`,
        templateId: template.id,
        dateKey: cursorDate,
        startAt: blockStart,
        endAt: blockEnd,
        title: template.title,
        kind: template.kind,
        color: template.color,
        blockingState: template.blockingState,
        calendarEventId: null,
        actionProfile: template.actionProfile ?? null,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt
      })
    );
  }
  return rows;
}

export function ensureWorkBlockInstancesInRange(_query: CalendarAgendaQuery) {
  return [];
}

export function listWorkBlockInstances(
  query: CalendarAgendaQuery & { userIds?: string[] }
) {
  const instances: WorkBlockInstance[] = [];
  for (const template of listWorkBlockTemplates({ userIds: query.userIds })) {
    instances.push(...deriveWorkBlockInstances(template, query));
    if (instances.length > MAX_WORK_BLOCK_INSTANCES) {
      throw new HttpError(
        400,
        "calendar_instance_limit_exceeded",
        `The requested range produces more than ${MAX_WORK_BLOCK_INSTANCES} recurring work-block instances. Request a shorter range.`
      );
    }
  }
  return instances.sort(
    (left, right) =>
      left.startAt.localeCompare(right.startAt) ||
      left.title.localeCompare(right.title)
  );
}

export function listTaskTimeboxes(
  query: CalendarAgendaQuery & {
    taskId?: string;
    projectId?: string;
    userIds?: string[];
  }
) {
  validateTimeboxQueryRange(query);
  const clauses = [
    "deletion_requested_at IS NULL",
    "ends_at > ?",
    "starts_at < ?"
  ];
  const params: Array<string | number> = [query.from, query.to];
  if (query.taskId) {
    clauses.push("task_id = ?");
    params.push(query.taskId);
  }
  if (query.projectId) {
    clauses.push("project_id = ?");
    params.push(query.projectId);
  }
  const userIds = Array.from(
    new Set(
      (query.userIds ?? [])
        .map((userId) => userId.trim())
        .filter((userId) => userId.length > 0)
    )
  );
  if (userIds.length > 0) {
    const placeholders = userIds.map(() => "?").join(", ");
    clauses.push(
      `(EXISTS (
          SELECT 1
          FROM entity_owners timebox_owner
          WHERE timebox_owner.entity_type = 'task_timebox'
            AND timebox_owner.entity_id = task_timeboxes.id
            AND timebox_owner.user_id IN (${placeholders})
        ) OR EXISTS (
          SELECT 1
          FROM entity_assignments timebox_assignment
          WHERE timebox_assignment.entity_type = 'task_timebox'
            AND timebox_assignment.entity_id = task_timeboxes.id
            AND timebox_assignment.role = 'assignee'
            AND timebox_assignment.user_id IN (${placeholders})
        ))`
    );
    params.push(...userIds, ...userIds);
  }
  params.push(MAX_TIMEBOX_ROWS + 1);
  const rows = getDatabase()
    .prepare(
      `SELECT id, task_id, project_id, connection_id, calendar_id, remote_event_id, linked_task_run_id, status, source, title,
              starts_at, ends_at, override_reason, created_at, updated_at
       FROM task_timeboxes
       WHERE ${clauses.join(" AND ")}
       ORDER BY starts_at ASC, id ASC
       LIMIT ?`
    )
    .all(...params) as TaskTimeboxRow[];
  if (rows.length > MAX_TIMEBOX_ROWS) {
    throw new HttpError(
      400,
      "calendar_timebox_result_too_large",
      `The requested range contains more than ${MAX_TIMEBOX_ROWS} task timeboxes. Request a shorter range.`
    );
  }
  const activeIds = activeConnectionIds();
  return filterOwnedEntities(
    "task_timebox",
    rows
      .map(mapTimebox)
      .filter(
        (timebox) =>
          timebox.connectionId === null || activeIds.has(timebox.connectionId)
      ),
    userIds
  );
}

function buildTaskTimeboxFtsQuery(value: string) {
  const terms = value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}_]+/gu);
  if (!terms || terms.length === 0) {
    return null;
  }
  return terms
    .slice(0, 12)
    .map((term) => `"${term.replaceAll('"', '""')}"*`)
    .join(" AND ");
}

export function searchTaskTimeboxesForEntityCrud(
  input: {
    ids?: string[];
    query?: string;
    status?: string[];
    userIds?: string[];
    limit?: number;
  } = {}
) {
  const boundedLimit = Math.max(
    1,
    Math.min(input.limit ?? MAX_TIMEBOX_ROWS, MAX_TIMEBOX_ROWS)
  );
  const clauses = ["task_timeboxes.deletion_requested_at IS NULL"];
  const params: Array<string | number> = [];
  const ids = Array.from(
    new Set((input.ids ?? []).map((id) => id.trim()).filter(Boolean))
  );
  if (ids.length > 0) {
    clauses.push(`task_timeboxes.id IN (${ids.map(() => "?").join(", ")})`);
    params.push(...ids);
  }
  const statuses = Array.from(
    new Set((input.status ?? []).map((status) => status.trim()).filter(Boolean))
  );
  if (statuses.length > 0) {
    clauses.push(
      `task_timeboxes.status IN (${statuses.map(() => "?").join(", ")})`
    );
    params.push(...statuses);
  }
  const userIds = Array.from(
    new Set((input.userIds ?? []).map((id) => id.trim()).filter(Boolean))
  );
  if (userIds.length > 0) {
    const placeholders = userIds.map(() => "?").join(", ");
    clauses.push(
      `(EXISTS (
          SELECT 1 FROM entity_owners owner
          WHERE owner.entity_type = 'task_timebox'
            AND owner.entity_id = task_timeboxes.id
            AND owner.user_id IN (${placeholders})
        ) OR EXISTS (
          SELECT 1 FROM entity_assignments assignment
          WHERE assignment.entity_type = 'task_timebox'
            AND assignment.entity_id = task_timeboxes.id
            AND assignment.role = 'assignee'
            AND assignment.user_id IN (${placeholders})
        ))`
    );
    params.push(...userIds, ...userIds);
  }
  const query = input.query?.trim().toLowerCase() ?? "";
  if (query) {
    const ftsQuery = buildTaskTimeboxFtsQuery(query);
    if (!ftsQuery) {
      clauses.push("0 = 1");
    } else {
      clauses.push(`task_timeboxes.rowid IN (
        SELECT rowid
        FROM task_timebox_search
        WHERE task_timebox_search MATCH ?
      )`);
      params.push(ftsQuery);
    }
  }
  params.push(boundedLimit);
  const rows = getDatabase()
    .prepare(
      `SELECT id, task_id, project_id, connection_id, calendar_id, remote_event_id, linked_task_run_id, status, source, title,
              starts_at, ends_at, override_reason, created_at, updated_at
       FROM task_timeboxes
       WHERE ${clauses.join(" AND ")}
       ORDER BY task_timeboxes.updated_at DESC, task_timeboxes.id ASC
       LIMIT ?`
    )
    .all(...params) as TaskTimeboxRow[];
  const activeIds = activeConnectionIds();
  return filterOwnedEntities(
    "task_timebox",
    rows
      .map(mapTimebox)
      .filter(
        (timebox) =>
          timebox.connectionId === null || activeIds.has(timebox.connectionId)
      ),
    userIds
  );
}

export function listTaskTimeboxesForEntityCrud(limit = MAX_TIMEBOX_ROWS) {
  return searchTaskTimeboxesForEntityCrud({ limit });
}

export function getTaskTimeboxById(timeboxId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT id, task_id, project_id, connection_id, calendar_id, remote_event_id, linked_task_run_id, status, source, title,
              starts_at, ends_at, override_reason, created_at, updated_at
       FROM task_timeboxes
       WHERE id = ? AND deletion_requested_at IS NULL`
    )
    .get(timeboxId) as TaskTimeboxRow | undefined;
  return row ? decorateOwnedEntity("task_timebox", mapTimebox(row)) : undefined;
}

export function getTaskTimeboxByIdIncludingPendingDeletion(timeboxId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT id, task_id, project_id, connection_id, calendar_id, remote_event_id, linked_task_run_id, status, source, title,
              starts_at, ends_at, override_reason, deletion_requested_at, created_at, updated_at
       FROM task_timeboxes
       WHERE id = ?`
    )
    .get(timeboxId) as TaskTimeboxRow | undefined;
  return row ? decorateOwnedEntity("task_timebox", mapTimebox(row)) : undefined;
}

function taskTimeboxRequestFingerprint(
  input: CreateTaskTimeboxInput & {
    connectionId?: string | null;
    calendarId?: string | null;
    linkedTaskRunId?: string | null;
  }
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        taskId: input.taskId,
        projectId: input.projectId ?? null,
        connectionId: input.connectionId ?? null,
        calendarId: input.calendarId ?? null,
        linkedTaskRunId: input.linkedTaskRunId ?? null,
        status: input.status ?? "planned",
        source: input.source ?? "manual",
        title: input.title,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        overrideReason: input.overrideReason ?? null,
        activityPresetKey: input.activityPresetKey ?? null,
        customSustainRateApPerHour: input.customSustainRateApPerHour ?? null,
        userId: input.userId ?? null
      })
    )
    .digest("hex");
}

function readTaskTimeboxProviderOperation(timeboxId: string) {
  return getDatabase()
    .prepare(
      `SELECT timebox_id, operation, state, target_connection_id, target_calendar_id, remote_event_id,
              claim_token, claim_version, needs_retry, claimed_at, lease_expires_at, attempt_count, last_error, created_at, updated_at
       FROM task_timebox_provider_operations
       WHERE timebox_id = ?`
    )
    .get(timeboxId) as TaskTimeboxProviderOperationRow | undefined;
}

export function queueTaskTimeboxProviderOperation(
  timeboxId: string,
  operation?: "upsert" | "delete"
) {
  const timebox = getTaskTimeboxByIdIncludingPendingDeletion(timeboxId);
  if (!timebox) {
    return undefined;
  }
  const requestedOperation =
    operation ?? (timebox.status === "cancelled" ? "delete" : "upsert");
  const timestamp = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO task_timebox_provider_operations (
         timebox_id, operation, state, target_connection_id, target_calendar_id, remote_event_id,
         claim_version, attempt_count, created_at, updated_at
       )
       VALUES (?, ?, 'pending', ?, ?, ?, 0, 0, ?, ?)
       ON CONFLICT(timebox_id) DO UPDATE SET
         operation = excluded.operation,
         state = CASE
           WHEN task_timebox_provider_operations.state = 'claimed' THEN 'claimed'
           ELSE 'pending'
         END,
         target_connection_id = excluded.target_connection_id,
         target_calendar_id = excluded.target_calendar_id,
         remote_event_id = COALESCE(excluded.remote_event_id, task_timebox_provider_operations.remote_event_id),
         claim_token = CASE
           WHEN task_timebox_provider_operations.state = 'claimed' THEN task_timebox_provider_operations.claim_token
           ELSE NULL
         END,
         claim_version = CASE
           WHEN task_timebox_provider_operations.state = 'claimed' THEN task_timebox_provider_operations.claim_version
           ELSE task_timebox_provider_operations.claim_version + 1
         END,
         needs_retry = CASE
           WHEN task_timebox_provider_operations.state = 'claimed'
             AND task_timebox_provider_operations.operation = excluded.operation
           THEN 1
           ELSE 0
         END,
         claimed_at = CASE
           WHEN task_timebox_provider_operations.state = 'claimed' THEN task_timebox_provider_operations.claimed_at
           ELSE NULL
         END,
         lease_expires_at = CASE
           WHEN task_timebox_provider_operations.state = 'claimed' THEN task_timebox_provider_operations.lease_expires_at
           ELSE NULL
         END,
         last_error = NULL,
         updated_at = excluded.updated_at`
    )
    .run(
      timeboxId,
      requestedOperation,
      timebox.connectionId,
      timebox.calendarId,
      timebox.remoteEventId,
      timestamp,
      timestamp
    );
  return readTaskTimeboxProviderOperation(timeboxId);
}

export function listTaskTimeboxProjectionCandidateIds(input: {
  connectionId: string;
  from: string;
  to: string;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(input.limit ?? 5_000, 5_000));
  const rows = getDatabase()
    .prepare(
      `SELECT operation.timebox_id
       FROM task_timebox_provider_operations operation
       JOIN task_timeboxes timebox ON timebox.id = operation.timebox_id
       WHERE operation.state != 'applied'
         AND (operation.target_connection_id IS NULL OR operation.target_connection_id = ?)
         AND (
           operation.operation = 'delete'
           OR (timebox.ends_at > ? AND timebox.starts_at < ?)
         )
       ORDER BY
         CASE operation.operation WHEN 'delete' THEN 0 ELSE 1 END,
         timebox.starts_at ASC,
         operation.timebox_id ASC
       LIMIT ?`
    )
    .all(input.connectionId, input.from, input.to, limit) as Array<{
    timebox_id: string;
  }>;
  return rows.map((row) => row.timebox_id);
}

export function claimTaskTimeboxProviderOperation(input: {
  timeboxId: string;
  connectionId: string;
  now?: string;
  leaseMs?: number;
}): TaskTimeboxProjectionClaim | null {
  return runInTransaction(() => {
    const timestamp = input.now ?? nowIso();
    const leaseMs = Math.max(1_000, Math.min(input.leaseMs ?? 60_000, 600_000));
    const operation = readTaskTimeboxProviderOperation(input.timeboxId);
    if (
      !operation ||
      operation.state === "applied" ||
      (operation.target_connection_id !== null &&
        operation.target_connection_id !== input.connectionId) ||
      (operation.state === "claimed" &&
        operation.lease_expires_at !== null &&
        operation.lease_expires_at > timestamp)
    ) {
      return null;
    }
    const timebox = getTaskTimeboxByIdIncludingPendingDeletion(input.timeboxId);
    if (!timebox) {
      return null;
    }
    const claimToken = `tbclaim_${randomUUID()}`;
    const claimVersion = operation.claim_version + 1;
    const leaseExpiresAt = new Date(
      Date.parse(timestamp) + leaseMs
    ).toISOString();
    const result = getDatabase()
      .prepare(
        `UPDATE task_timebox_provider_operations
         SET state = 'claimed', claim_token = ?, claim_version = ?, claimed_at = ?, lease_expires_at = ?,
             needs_retry = 0, attempt_count = attempt_count + 1, last_error = NULL, updated_at = ?
         WHERE timebox_id = ?
           AND claim_version = ?
           AND state != 'applied'
           AND (target_connection_id IS NULL OR target_connection_id = ?)
           AND (state != 'claimed' OR lease_expires_at IS NULL OR lease_expires_at <= ?)`
      )
      .run(
        claimToken,
        claimVersion,
        timestamp,
        leaseExpiresAt,
        timestamp,
        input.timeboxId,
        operation.claim_version,
        input.connectionId,
        timestamp
      );
    if (result.changes !== 1) {
      return null;
    }
    return {
      timebox,
      operation: operation.operation,
      claimToken,
      claimVersion,
      targetConnectionId: operation.target_connection_id,
      targetCalendarId: operation.target_calendar_id,
      remoteEventId: operation.remote_event_id,
      attemptCount: operation.attempt_count + 1
    };
  });
}

export function completeTaskTimeboxProviderOperation(input: {
  timeboxId: string;
  operation: "upsert" | "delete";
  claimToken: string;
  claimVersion: number;
  connectionId: string;
  calendarId: string | null;
  remoteEventId: string | null;
}) {
  return runInTransaction(() => {
    const timestamp = nowIso();
    const operation = readTaskTimeboxProviderOperation(input.timeboxId);
    if (
      !operation ||
      operation.operation !== input.operation ||
      operation.state !== "claimed" ||
      operation.claim_token !== input.claimToken ||
      operation.claim_version !== input.claimVersion
    ) {
      return false;
    }
    if (input.operation === "delete") {
      getDatabase()
        .prepare(`DELETE FROM task_timeboxes WHERE id = ?`)
        .run(input.timeboxId);
      clearEntityOwner("task_timebox", input.timeboxId);
      return true;
    }
    const retryPending = operation.needs_retry === 1;
    const targetConnectionId = retryPending
      ? (operation.target_connection_id ?? input.connectionId)
      : input.connectionId;
    const targetCalendarId = retryPending
      ? (operation.target_calendar_id ?? input.calendarId)
      : input.calendarId;
    const claimed = getDatabase()
      .prepare(
        `UPDATE task_timebox_provider_operations
         SET state = ?, target_connection_id = ?, target_calendar_id = ?, remote_event_id = ?,
             claim_token = NULL, needs_retry = 0, claimed_at = NULL, lease_expires_at = NULL,
             last_error = NULL, updated_at = ?
         WHERE timebox_id = ? AND operation = 'upsert' AND state = 'claimed' AND claim_token = ? AND claim_version = ?`
      )
      .run(
        retryPending ? "pending" : "applied",
        targetConnectionId,
        targetCalendarId,
        input.remoteEventId,
        timestamp,
        input.timeboxId,
        input.claimToken,
        input.claimVersion
      );
    if (claimed.changes !== 1) {
      return false;
    }
    getDatabase()
      .prepare(
        `UPDATE task_timeboxes
         SET connection_id = ?, calendar_id = ?, remote_event_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        targetConnectionId,
        targetCalendarId,
        input.remoteEventId,
        timestamp,
        input.timeboxId
      );
    return true;
  });
}

export function failTaskTimeboxProviderOperation(input: {
  timeboxId: string;
  claimToken: string;
  claimVersion: number;
  error: string;
}) {
  const timestamp = nowIso();
  return (
    getDatabase()
      .prepare(
        `UPDATE task_timebox_provider_operations
         SET state = 'error', claim_token = NULL, claimed_at = NULL, lease_expires_at = NULL,
             needs_retry = 0, last_error = ?, updated_at = ?
         WHERE timebox_id = ? AND state = 'claimed' AND claim_token = ? AND claim_version = ?`
      )
      .run(
        input.error.slice(0, 2_000),
        timestamp,
        input.timeboxId,
        input.claimToken,
        input.claimVersion
      ).changes === 1
  );
}

export function createTaskTimebox(
  input: CreateTaskTimeboxInput & {
    connectionId?: string | null;
    calendarId?: string | null;
    linkedTaskRunId?: string | null;
    idempotencyKey?: string | null;
  }
) {
  return runInTransaction(() => {
    const task = getTaskById(input.taskId);
    const ownerId = validateTaskTimeboxIdentity({
      task,
      taskId: input.taskId,
      projectId: input.projectId,
      userId: input.userId
    });
    const effectiveOwnerId =
      ownerId ?? inferTaskTimeboxOwnerId(input) ?? "user_operator";
    parseTimeboxWindow(input.startsAt, input.endsAt);
    const idempotencyKey = input.idempotencyKey?.trim() || null;
    const requestFingerprint = taskTimeboxRequestFingerprint(input);
    if (idempotencyKey) {
      const existing = getDatabase()
        .prepare(
          `SELECT request_fingerprint, timebox_id
           FROM task_timebox_create_idempotency
           WHERE owner_user_id = ? AND idempotency_key = ?`
        )
        .get(effectiveOwnerId, idempotencyKey) as
        | { request_fingerprint: string; timebox_id: string }
        | undefined;
      if (existing) {
        if (existing.request_fingerprint !== requestFingerprint) {
          throw new HttpError(
            409,
            "idempotency_conflict",
            "This idempotency key was already used for a different task-timebox payload."
          );
        }
        const replay = getTaskTimeboxByIdIncludingPendingDeletion(
          existing.timebox_id
        );
        if (!replay) {
          throw new HttpError(
            409,
            "idempotency_result_deleted",
            "The task timebox created with this idempotency key was later deleted. Use a new key for a new timebox."
          );
        }
        return replay;
      }
    }

    if ((input.source ?? "manual") !== "live_run") {
      assertTaskTimeboxPlacementAllowed({
        task: task!,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        overrideReason: input.overrideReason ?? null,
        userIds: [effectiveOwnerId]
      });
    }

    const now = nowIso();
    const id = `timebox_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    getDatabase()
      .prepare(
        `INSERT INTO task_timeboxes (
           id, task_id, project_id, connection_id, calendar_id, linked_task_run_id, status, source, title, starts_at, ends_at, override_reason, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.taskId,
        task!.projectId ?? null,
        input.connectionId ?? null,
        input.calendarId ?? null,
        input.linkedTaskRunId ?? null,
        input.status ?? "planned",
        input.source ?? "manual",
        input.title,
        input.startsAt,
        input.endsAt,
        input.overrideReason ?? null,
        now,
        now
      );
    upsertEntityActionProfile({
      entityType: "task_timebox",
      entityId: id,
      profile: buildTaskTimeboxActionProfile({
        timeboxId: id,
        title: input.title,
        taskId: input.taskId,
        taskPlannedDurationSeconds: task!.plannedDurationSeconds ?? null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        activityPresetKey: input.activityPresetKey ?? null,
        customSustainRateApPerHour: input.customSustainRateApPerHour ?? null
      })
    });
    setEntityOwner("task_timebox", id, effectiveOwnerId);
    queueTaskTimeboxProviderOperation(id);
    if (idempotencyKey) {
      getDatabase()
        .prepare(
          `INSERT INTO task_timebox_create_idempotency (
             owner_user_id, idempotency_key, request_fingerprint, timebox_id, created_at
           )
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(effectiveOwnerId, idempotencyKey, requestFingerprint, id, now);
    }
    return getTaskTimeboxById(id)!;
  });
}

export function updateTaskTimebox(
  timeboxId: string,
  patch: Partial<{
    connectionId: string | null;
    calendarId: string | null;
    remoteEventId: string | null;
    linkedTaskRunId: string | null;
    status: CalendarTimeboxStatus;
    source: CalendarTimeboxSource;
    title: string;
    startsAt: string;
    endsAt: string;
    overrideReason: string | null;
    activityPresetKey: CalendarActivityPresetKey | null;
    customSustainRateApPerHour: number | null;
    userId: string | null;
  }>
) {
  return runInTransaction(() => {
    const current = getTaskTimeboxById(timeboxId);
    if (!current) {
      return undefined;
    }
    const task = getTaskById(current.taskId);
    const ownerId = validateTaskTimeboxIdentity({
      task,
      taskId: current.taskId,
      projectId: current.projectId,
      userId: patch.userId
    });
    const next = {
      connectionId:
        patch.connectionId === undefined
          ? current.connectionId
          : patch.connectionId,
      calendarId:
        patch.calendarId === undefined ? current.calendarId : patch.calendarId,
      remoteEventId:
        patch.remoteEventId === undefined
          ? current.remoteEventId
          : patch.remoteEventId,
      linkedTaskRunId:
        patch.linkedTaskRunId === undefined
          ? current.linkedTaskRunId
          : patch.linkedTaskRunId,
      status: patch.status ?? current.status,
      source: patch.source ?? current.source,
      title: patch.title ?? current.title,
      startsAt: patch.startsAt ?? current.startsAt,
      endsAt: patch.endsAt ?? current.endsAt,
      overrideReason:
        patch.overrideReason === undefined
          ? current.overrideReason
          : patch.overrideReason,
      updatedAt: nowIso()
    };

    parseTimeboxWindow(next.startsAt, next.endsAt);
    const placementChanged =
      patch.startsAt !== undefined ||
      patch.endsAt !== undefined ||
      patch.overrideReason !== undefined ||
      (patch.status !== undefined &&
        current.status === "cancelled" &&
        patch.status !== "cancelled");
    if (placementChanged && next.status !== "cancelled") {
      assertTaskTimeboxPlacementAllowed({
        task: task!,
        startsAt: next.startsAt,
        endsAt: next.endsAt,
        overrideReason: next.overrideReason,
        excludeTimeboxId: timeboxId,
        userIds: ownerId ? [ownerId] : undefined
      });
    }

    getDatabase()
      .prepare(
        `UPDATE task_timeboxes
         SET connection_id = ?, calendar_id = ?, remote_event_id = ?, linked_task_run_id = ?, status = ?, source = ?, title = ?,
             starts_at = ?, ends_at = ?, override_reason = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        next.connectionId,
        next.calendarId,
        next.remoteEventId,
        next.linkedTaskRunId,
        next.status,
        next.source,
        next.title,
        next.startsAt,
        next.endsAt,
        next.overrideReason,
        next.updatedAt,
        timeboxId
      );

    if (
      patch.title !== undefined ||
      patch.startsAt !== undefined ||
      patch.endsAt !== undefined ||
      patch.activityPresetKey !== undefined ||
      patch.customSustainRateApPerHour !== undefined
    ) {
      upsertEntityActionProfile({
        entityType: "task_timebox",
        entityId: timeboxId,
        profile: buildTaskTimeboxActionProfile({
          timeboxId,
          title: next.title,
          taskId: current.taskId,
          taskPlannedDurationSeconds: task!.plannedDurationSeconds ?? null,
          startsAt: next.startsAt,
          endsAt: next.endsAt,
          activityPresetKey:
            patch.activityPresetKey === undefined
              ? (current.actionProfile?.metadata?.activityPresetKey as
                  | string
                  | null
                  | undefined)
              : patch.activityPresetKey,
          customSustainRateApPerHour:
            patch.customSustainRateApPerHour === undefined
              ? typeof current.actionProfile?.metadata
                  ?.customSustainRateApPerHour === "number"
                ? current.actionProfile.metadata.customSustainRateApPerHour
                : null
              : patch.customSustainRateApPerHour
        })
      });
    }
    if (patch.userId !== undefined && ownerId) {
      setEntityOwner("task_timebox", timeboxId, ownerId);
    }
    queueTaskTimeboxProviderOperation(timeboxId);
    return getTaskTimeboxById(timeboxId);
  });
}

export function deleteTaskTimebox(timeboxId: string) {
  return runInTransaction(() => {
    const current = getTaskTimeboxByIdIncludingPendingDeletion(timeboxId);
    if (!current) {
      return undefined;
    }
    const operation = readTaskTimeboxProviderOperation(timeboxId);
    if (!current.remoteEventId && operation?.state !== "claimed") {
      getDatabase()
        .prepare(`DELETE FROM task_timeboxes WHERE id = ?`)
        .run(timeboxId);
      clearEntityOwner("task_timebox", timeboxId);
      return current;
    }
    const timestamp = nowIso();
    getDatabase()
      .prepare(
        `UPDATE task_timeboxes
         SET deletion_requested_at = COALESCE(deletion_requested_at, ?), status = 'cancelled', updated_at = ?
         WHERE id = ?`
      )
      .run(timestamp, timestamp, timeboxId);
    queueTaskTimeboxProviderOperation(timeboxId, "delete");
    return current;
  });
}

export function findCoveringTimeboxForTask(taskId: string, at: Date) {
  const row = getDatabase()
    .prepare(
      `SELECT id, task_id, project_id, connection_id, calendar_id, remote_event_id, linked_task_run_id, status, source, title,
              starts_at, ends_at, override_reason, created_at, updated_at
       FROM task_timeboxes
       WHERE task_id = ?
         AND deletion_requested_at IS NULL
         AND status IN ('planned', 'active')
         AND starts_at <= ?
         AND ends_at > ?
       ORDER BY starts_at DESC
       LIMIT 1`
    )
    .get(taskId, at.toISOString(), at.toISOString()) as
    | TaskTimeboxRow
    | undefined;
  return row ? mapTimebox(row) : undefined;
}

export function bindTaskRunToTimebox(input: {
  taskId: string;
  taskRunId: string;
  startedAt: Date;
  title: string;
  projectId?: string | null;
  plannedDurationSeconds?: number | null;
  overrideReason?: string | null;
}) {
  return runInTransaction(() => {
    const existing = findCoveringTimeboxForTask(input.taskId, input.startedAt);
    const startsAt = existing?.startsAt ?? input.startedAt.toISOString();
    const endsAt =
      existing?.endsAt ??
      addMinutes(
        input.startedAt,
        Math.max(15, Math.ceil((input.plannedDurationSeconds ?? 30 * 60) / 60))
      ).toISOString();

    if (existing) {
      return updateTaskTimebox(existing.id, {
        linkedTaskRunId: input.taskRunId,
        status: "active",
        title: input.title,
        startsAt,
        endsAt,
        overrideReason: input.overrideReason ?? existing.overrideReason
      })!;
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

export function heartbeatTaskRunTimebox(
  taskRunId: string,
  patch: { title: string; endsAt: string; overrideReason?: string | null }
) {
  const row = getDatabase()
    .prepare(
      `SELECT id
       FROM task_timeboxes
       WHERE linked_task_run_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    .get(taskRunId) as { id: string } | undefined;
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

export function finalizeTaskRunTimebox(
  taskRunId: string,
  status: Extract<CalendarTimeboxStatus, "completed" | "cancelled">,
  endsAt: string
) {
  const row = getDatabase()
    .prepare(
      `SELECT id
       FROM task_timeboxes
       WHERE linked_task_run_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    .get(taskRunId) as { id: string } | undefined;
  if (!row) {
    return undefined;
  }
  return updateTaskTimebox(row.id, {
    status,
    endsAt,
    linkedTaskRunId: taskRunId
  });
}

function matchKeywords(keywords: string[], haystack: string) {
  if (keywords.length === 0) {
    return false;
  }
  const normalized = haystack.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

type TaskSchedulingContext = {
  events: ReturnType<typeof listCalendarEvents>;
  blocks: WorkBlockInstance[];
  timeboxes: TaskTimebox[];
};

function spansOverlap(
  left: { startAt: string; endAt: string },
  right: { startAt: string; endAt: string }
) {
  return (
    Date.parse(left.startAt) < Date.parse(right.endAt) &&
    Date.parse(left.endAt) > Date.parse(right.startAt)
  );
}

function spanCovers(
  candidate: { startAt: string; endAt: string },
  target: { startAt: string; endAt: string }
) {
  return (
    Date.parse(candidate.startAt) <= Date.parse(target.startAt) &&
    Date.parse(candidate.endAt) >= Date.parse(target.endAt)
  );
}

function loadTaskSchedulingContext(input: {
  startsAt: string;
  endsAt: string;
  userIds?: string[];
}): TaskSchedulingContext {
  const query = {
    from: input.startsAt,
    to: input.endsAt,
    userIds: input.userIds
  };
  return {
    events: listCalendarEvents(query),
    blocks: listWorkBlockInstances(query),
    timeboxes: listTaskTimeboxes(query)
  };
}

function evaluateSchedulingRulesForWindow(
  task: Task,
  window: { startsAt: string; endsAt: string },
  context: TaskSchedulingContext
): SchedulingEvaluation {
  const project = task.projectId
    ? (getProjectById(task.projectId) ?? null)
    : null;
  const effectiveRules = normalizeRules(
    task.schedulingRules ?? project?.schedulingRules
  );
  const currentEvents = context.events.filter((event) =>
    spansOverlap(
      { startAt: event.startAt, endAt: event.endAt },
      { startAt: window.startsAt, endAt: window.endsAt }
    )
  );
  const currentBlocks = context.blocks.filter((block) =>
    spansOverlap(
      { startAt: block.startAt, endAt: block.endAt },
      { startAt: window.startsAt, endAt: window.endsAt }
    )
  );

  const conflicts: SchedulingEvaluation["conflicts"] = [];
  for (const event of currentEvents) {
    if (
      (event.calendarId
        ? effectiveRules.blockCalendarIds.includes(event.calendarId)
        : false) ||
      effectiveRules.blockEventTypes.includes(event.eventType) ||
      effectiveRules.blockAvailability.includes(event.availability) ||
      matchKeywords(
        effectiveRules.blockEventKeywords,
        `${event.title}\n${event.description}\n${event.location}\n${event.categories.join(" ")}`
      )
    ) {
      conflicts.push(
        calendarContextConflictSchema.parse({
          kind: "external_event",
          id: event.id,
          title: event.title,
          reason:
            "This calendar event blocks the task under its current scheduling rules.",
          startsAt: event.startAt,
          endsAt: event.endAt
        })
      );
    }
  }

  for (const block of currentBlocks) {
    if (effectiveRules.blockWorkBlockKinds.includes(block.kind)) {
      conflicts.push(
        calendarContextConflictSchema.parse({
          kind: "work_block",
          id: block.id,
          title: block.title,
          reason:
            "This work block blocks the task under its current scheduling rules.",
          startsAt: block.startAt,
          endsAt: block.endAt
        })
      );
    }
  }

  const anyAllowRules =
    effectiveRules.allowWorkBlockKinds.length > 0 ||
    effectiveRules.allowCalendarIds.length > 0 ||
    effectiveRules.allowEventTypes.length > 0 ||
    effectiveRules.allowEventKeywords.length > 0 ||
    effectiveRules.allowAvailability.length > 0;
  let allowSatisfied = !anyAllowRules;
  if (anyAllowRules) {
    allowSatisfied =
      (effectiveRules.allowAvailability.includes("free") &&
        currentEvents.every(
          (event) =>
            event.status === "cancelled" || event.availability !== "busy"
        )) ||
      currentBlocks.some(
        (block) =>
          effectiveRules.allowWorkBlockKinds.includes(block.kind) &&
          spanCovers(
            { startAt: block.startAt, endAt: block.endAt },
            { startAt: window.startsAt, endAt: window.endsAt }
          )
      ) ||
      currentEvents.some(
        (event) =>
          spanCovers(
            { startAt: event.startAt, endAt: event.endAt },
            { startAt: window.startsAt, endAt: window.endsAt }
          ) &&
          (effectiveRules.allowCalendarIds.length === 0 ||
            (event.calendarId
              ? effectiveRules.allowCalendarIds.includes(event.calendarId)
              : false)) &&
          (effectiveRules.allowEventTypes.length === 0 ||
            effectiveRules.allowEventTypes.includes(event.eventType)) &&
          (effectiveRules.allowAvailability.length === 0 ||
            effectiveRules.allowAvailability.includes(event.availability)) &&
          (effectiveRules.allowEventKeywords.length === 0 ||
            matchKeywords(
              effectiveRules.allowEventKeywords,
              `${event.title}\n${event.description}\n${event.location}\n${event.categories.join(" ")}`
            ))
      );
  }

  if (!allowSatisfied) {
    conflicts.push({
      kind: currentBlocks[0] ? "work_block" : "external_event",
      id: currentBlocks[0]?.id ?? currentEvents[0]?.id ?? "calendar_window",
      title:
        currentBlocks[0]?.title ?? currentEvents[0]?.title ?? "Calendar window",
      reason:
        "This window does not fully match the allowed scheduling context for the task.",
      startsAt: window.startsAt,
      endsAt: window.endsAt
    });
  }

  return {
    blocked: conflicts.length > 0,
    effectiveRules,
    conflicts
  };
}

export function evaluateSchedulingForTask(
  task: Task,
  at = new Date()
): SchedulingEvaluation {
  const startsAt = at.toISOString();
  const endsAt = new Date(at.getTime() + 1).toISOString();
  const ownerId = taskOwnerId(task);
  return evaluateSchedulingRulesForWindow(
    task,
    { startsAt, endsAt },
    loadTaskSchedulingContext({
      startsAt,
      endsAt,
      userIds: ownerId ? [ownerId] : undefined
    })
  );
}

function evaluateTaskTimeboxPlacementWithContext(input: {
  task: Task;
  startsAt: string;
  endsAt: string;
  excludeTimeboxId?: string;
  context: TaskSchedulingContext;
}): TaskTimeboxPlacementEvaluation {
  const window = { startAt: input.startsAt, endAt: input.endsAt };
  const conflicts: TaskTimeboxPlacementConflict[] = [];
  for (const event of input.context.events) {
    if (
      event.status !== "cancelled" &&
      event.availability === "busy" &&
      spansOverlap({ startAt: event.startAt, endAt: event.endAt }, window)
    ) {
      conflicts.push({
        kind: "calendar_event",
        id: event.id,
        title: event.title,
        reason: "This provider or Forge calendar event is marked busy.",
        startsAt: event.startAt,
        endsAt: event.endAt
      });
    }
  }
  for (const block of input.context.blocks) {
    if (
      block.blockingState === "blocked" &&
      spansOverlap({ startAt: block.startAt, endAt: block.endAt }, window)
    ) {
      conflicts.push({
        kind: "work_block",
        id: block.id,
        title: block.title,
        reason: "This work block reserves the selected time.",
        startsAt: block.startAt,
        endsAt: block.endAt
      });
    }
  }
  for (const timebox of input.context.timeboxes) {
    if (
      timebox.id !== input.excludeTimeboxId &&
      timebox.status !== "cancelled" &&
      spansOverlap({ startAt: timebox.startsAt, endAt: timebox.endsAt }, window)
    ) {
      conflicts.push({
        kind: "task_timebox",
        id: timebox.id,
        title: timebox.title,
        reason: "Another task timebox already occupies this window.",
        startsAt: timebox.startsAt,
        endsAt: timebox.endsAt
      });
    }
  }

  const ruleEvaluation = evaluateSchedulingRulesForWindow(
    input.task,
    { startsAt: input.startsAt, endsAt: input.endsAt },
    input.context
  );
  for (const conflict of ruleEvaluation.conflicts) {
    conflicts.push({
      kind: "scheduling_rule",
      id: conflict.id,
      title: conflict.title,
      reason: conflict.reason,
      startsAt: conflict.startsAt,
      endsAt: conflict.endsAt
    });
  }

  return {
    blocked: conflicts.length > 0,
    requiresOverride: conflicts.length > 0,
    conflicts
  };
}

export function evaluateTaskTimeboxPlacement(input: {
  task: Task;
  startsAt: string;
  endsAt: string;
  excludeTimeboxId?: string;
  userIds?: string[];
}) {
  parseTimeboxWindow(input.startsAt, input.endsAt);
  return evaluateTaskTimeboxPlacementWithContext({
    ...input,
    context: loadTaskSchedulingContext(input)
  });
}

function assertTaskTimeboxPlacementAllowed(input: {
  task: Task;
  startsAt: string;
  endsAt: string;
  overrideReason: string | null;
  excludeTimeboxId?: string;
  userIds?: string[];
}) {
  const evaluation = evaluateTaskTimeboxPlacement(input);
  if (evaluation.requiresOverride && !input.overrideReason?.trim()) {
    throw new HttpError(
      409,
      "calendar_timebox_overlap_requires_override",
      "This time overlaps calendar pressure or the task's scheduling rules. Review the conflicts or add a specific override reason.",
      { conflicts: evaluation.conflicts }
    );
  }
  return evaluation;
}

function firstResolvedInstant(localDateTime: string, timeZone: string) {
  const resolution = resolveZonedDateTime(localDateTime, timeZone);
  return resolution.kind === "exact" || resolution.kind === "ambiguous"
    ? resolution.instants[0]
    : null;
}

function buildFallbackSuggestionWindows(input: {
  from: Date;
  to: Date;
  timeZone: string;
}) {
  const firstDateKey = localDateKeyForInstant(
    input.from.toISOString(),
    input.timeZone
  );
  const lastDateKey = localDateKeyForInstant(
    new Date(input.to.getTime() - 1).toISOString(),
    input.timeZone
  );
  const windows: Array<{ start: Date; end: Date }> = [];
  for (
    let dateKey = firstDateKey;
    dateKey <= lastDateKey;
    dateKey = addCalendarDays(dateKey, 1)
  ) {
    const dayStart = firstResolvedInstant(
      `${dateKey}T08:00:00`,
      input.timeZone
    );
    const dayEnd = firstResolvedInstant(`${dateKey}T18:00:00`, input.timeZone);
    if (!dayStart || !dayEnd) {
      continue;
    }
    const start = new Date(
      Math.max(Date.parse(dayStart), input.from.getTime())
    );
    const end = new Date(Math.min(Date.parse(dayEnd), input.to.getTime()));
    if (end > start) {
      windows.push({ start, end });
    }
  }
  return windows;
}

export function suggestTaskTimeboxes(
  taskId: string,
  options: {
    from?: string;
    to?: string;
    limit?: number;
    timeZone?: string;
  } = {}
) {
  const task = getTaskById(taskId);
  if (!task) {
    return [];
  }
  const from = options.from ? new Date(options.from) : new Date();
  const to = options.to ? new Date(options.to) : addMinutes(from, 14 * 24 * 60);
  const { startsAtMs, endsAtMs } = parseTimeboxWindow(
    from.toISOString(),
    to.toISOString(),
    {
      maxDurationMs: MAX_TIMEBOX_SUGGESTION_DAYS * 24 * 60 * 60 * 1000,
      limitKind: "range"
    }
  );
  const limit = Math.max(
    1,
    Math.min(MAX_TIMEBOX_SUGGESTIONS, options.limit ?? 6)
  );
  const durationMinutes = Math.max(
    15,
    Math.ceil((task.plannedDurationSeconds ?? 30 * 60) / 60)
  );
  const query = {
    from: new Date(startsAtMs).toISOString(),
    to: new Date(endsAtMs).toISOString()
  };
  const ownerId = taskOwnerId(task);
  const context = loadTaskSchedulingContext({
    startsAt: query.from,
    endsAt: query.to,
    userIds: ownerId ? [ownerId] : undefined
  });
  const allowedBlocks = context.blocks.filter(
    (block) => block.blockingState === "allowed"
  );
  const resolvedTimeZone =
    options.timeZone && isValidTimeZone(options.timeZone)
      ? options.timeZone
      : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const candidateWindows =
    allowedBlocks.length > 0
      ? allowedBlocks.map((block) => ({
          start: new Date(Math.max(Date.parse(block.startAt), startsAtMs)),
          end: new Date(Math.min(Date.parse(block.endAt), endsAtMs))
        }))
      : buildFallbackSuggestionWindows({
          from,
          to,
          timeZone: resolvedTimeZone
        });
  const suggestions: TaskTimebox[] = [];
  const slotStepMs = 30 * 60 * 1000;

  for (const window of candidateWindows) {
    const firstSlotMs =
      Math.ceil(window.start.getTime() / slotStepMs) * slotStepMs;
    for (
      let cursor = new Date(firstSlotMs);
      cursor.getTime() + durationMinutes * 60 * 1000 <= window.end.getTime();
      cursor = addMinutes(cursor, 30)
    ) {
      const slotEnd = addMinutes(cursor, durationMinutes);
      const evaluation = evaluateTaskTimeboxPlacementWithContext({
        task,
        startsAt: cursor.toISOString(),
        endsAt: slotEnd.toISOString(),
        context
      });
      if (evaluation.blocked) {
        continue;
      }
      const generatedAt = nowIso();
      suggestions.push(
        taskTimeboxSchema.parse({
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
          createdAt: generatedAt,
          updatedAt: generatedAt
        })
      );
      if (suggestions.length >= limit) {
        return suggestions;
      }
    }
  }
  return suggestions;
}

export function getCalendarOverview(
  query: CalendarAgendaQuery & { userIds?: string[] }
): CalendarOverviewPayload {
  ensureWorkBlockInstancesInRange(query);
  return calendarOverviewPayloadSchema.parse({
    generatedAt: nowIso(),
    providers: [
      {
        provider: "google",
        label: "Google Calendar",
        supportsDedicatedForgeCalendar: true,
        connectionHelp:
          "Forge uses a localhost Authorization Code + PKCE flow. Users sign in with Google from the same machine running Forge, Forge exchanges the code on the backend, and stores a per-user refresh token server-side."
      },
      {
        provider: "apple",
        label: "Apple Calendar",
        supportsDedicatedForgeCalendar: true,
        connectionHelp:
          "Use your Apple ID email and an app-specific password. Forge discovers the writable calendars from https://caldav.icloud.com."
      },
      {
        provider: "microsoft",
        label: "Exchange Online",
        supportsDedicatedForgeCalendar: false,
        connectionHelp:
          "Save the Microsoft client ID and redirect URI in Calendar settings first, then sign in with Microsoft. Forge mirrors the selected calendars in read-only mode."
      },
      {
        provider: "caldav",
        label: "Custom CalDAV",
        supportsDedicatedForgeCalendar: true,
        connectionHelp:
          "Use an account-level CalDAV base URL, then let Forge discover the calendars before selecting sync and write targets."
      },
      {
        provider: "macos_local",
        label: "Calendars On This Mac",
        supportsDedicatedForgeCalendar: true,
        connectionHelp:
          "Use EventKit to access the calendars already configured in Calendar.app on this Mac. Forge replaces overlapping remote account connections instead of showing duplicate copies."
      }
    ],
    connections: listCalendarConnections().map(
      ({ credentialsSecretId: _secret, ...connection }) => connection
    ),
    calendars: listCalendars(),
    events: listCalendarEvents(query),
    workBlockTemplates: listWorkBlockTemplates({ userIds: query.userIds }),
    workBlockInstances: listWorkBlockInstances(query),
    timeboxes: listTaskTimeboxes(query)
  });
}

export function recordCalendarActivity(
  eventType: string,
  entityType:
    | "calendar_connection"
    | "calendar"
    | "calendar_event"
    | "work_block"
    | "task_timebox",
  entityId: string,
  title: string,
  description: string,
  context: ActivityContext,
  metadata: Record<string, string | number | boolean | null> = {}
) {
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
