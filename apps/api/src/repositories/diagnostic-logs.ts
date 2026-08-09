import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { getDatabase } from "../db.js";
import { redactSecretValues } from "../security/secret-redaction.js";
import {
  createDiagnosticLogSchema,
  diagnosticLogEntrySchema,
  type CreateDiagnosticLogInput,
  type DiagnosticLogEntry,
  type DiagnosticLogLevel,
  type DiagnosticLogListQuery,
  type DiagnosticLogSource
} from "../types.js";

type DiagnosticLogRow = {
  id: string;
  level: DiagnosticLogLevel;
  source: DiagnosticLogSource;
  scope: string;
  event_key: string;
  message: string;
  route: string | null;
  function_name: string | null;
  request_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  job_id: string | null;
  details_json: string;
  created_at: string;
};

export const DIAGNOSTIC_LOG_MAX_ENTRIES = 5_000;
export const DIAGNOSTIC_LOG_RETENTION_DAYS = 14;
export const DIAGNOSTIC_LOG_RETENTION_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const MAX_STRING_LENGTH = 4_000;
const MAX_ARRAY_ITEMS = 24;
const MAX_OBJECT_KEYS = 40;
const MAX_DEPTH = 4;
const LIST_MAX_STRING_LENGTH = 600;
const LIST_MAX_ARRAY_ITEMS = 8;
const LIST_MAX_OBJECT_KEYS = 16;
const LIST_MAX_DEPTH = 2;
let nextRetentionSweepAt = 0;

function nowIso() {
  return new Date().toISOString();
}

function redactDiagnosticText(value: string) {
  return redactSecretValues(value).value;
}

function redactNullableDiagnosticText(value: string | null) {
  return value === null ? null : redactDiagnosticText(value);
}

function sanitizeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }

  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}…`
      : value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    const richError = value as Error & {
      code?: unknown;
      statusCode?: unknown;
      details?: unknown;
    };
    return {
      name: value.name,
      message: value.message,
      ...(typeof richError.code === "string" ? { code: richError.code } : {}),
      ...(typeof richError.statusCode === "number"
        ? { statusCode: richError.statusCode }
        : {}),
      ...(richError.details && typeof richError.details === "object"
        ? { details: sanitizeDiagnosticValue(richError.details, depth + 1) }
        : {}),
      stack:
        typeof value.stack === "string"
          ? sanitizeDiagnosticValue(value.stack, depth + 1)
          : null
    };
  }

  if (Buffer.isBuffer(value)) {
    return {
      type: "Buffer",
      bytes: value.byteLength
    };
  }

  if (depth >= MAX_DEPTH) {
    if (Array.isArray(value)) {
      return `[Array(${value.length})]`;
    }
    return "[Object]";
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((entry) => sanitizeDiagnosticValue(entry, depth + 1));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
    return Object.fromEntries(
      entries.map(([key, entry]) => [
        key,
        sanitizeDiagnosticValue(entry, depth + 1)
      ])
    );
  }

  return String(value);
}

function sanitizeDetails(
  details: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!details) {
    return {};
  }
  const sanitized = Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      sanitizeDiagnosticValue(value)
    ])
  );
  return redactSecretValues(sanitized, {
    maximumDepth: MAX_DEPTH,
    maximumArrayItems: MAX_ARRAY_ITEMS,
    maximumObjectKeys: MAX_OBJECT_KEYS
  }).value;
}

function compactDiagnosticValue(value: unknown, depth = 0): unknown {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }

  if (typeof value === "string") {
    return value.length > LIST_MAX_STRING_LENGTH
      ? `${value.slice(0, LIST_MAX_STRING_LENGTH)}…`
      : value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (depth >= LIST_MAX_DEPTH) {
    if (Array.isArray(value)) {
      return `[Array(${value.length})]`;
    }
    return "[Object]";
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, LIST_MAX_ARRAY_ITEMS)
      .map((entry) => compactDiagnosticValue(entry, depth + 1));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value).slice(0, LIST_MAX_OBJECT_KEYS);
    return Object.fromEntries(
      entries.map(([key, entry]) => [
        key,
        compactDiagnosticValue(entry, depth + 1)
      ])
    );
  }

  return String(value);
}

function compactDiagnosticDetails(
  details: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      compactDiagnosticValue(value)
    ])
  );
}

function mapRow(
  row: DiagnosticLogRow,
  options: { compactDetails?: boolean } = {}
): DiagnosticLogEntry {
  const parsedDetails = JSON.parse(row.details_json) as Record<string, unknown>;
  const redactedDetails = redactSecretValues(parsedDetails, {
    maximumDepth: LIST_MAX_DEPTH,
    maximumArrayItems: LIST_MAX_ARRAY_ITEMS,
    maximumObjectKeys: LIST_MAX_OBJECT_KEYS
  }).value;
  return diagnosticLogEntrySchema.parse({
    id: row.id,
    level: row.level,
    source: row.source,
    scope: redactDiagnosticText(row.scope),
    eventKey: redactDiagnosticText(row.event_key),
    message: redactDiagnosticText(row.message),
    route: redactNullableDiagnosticText(row.route),
    functionName: redactNullableDiagnosticText(row.function_name),
    requestId: redactNullableDiagnosticText(row.request_id),
    entityType: redactNullableDiagnosticText(row.entity_type),
    entityId: redactNullableDiagnosticText(row.entity_id),
    jobId: redactNullableDiagnosticText(row.job_id),
    details: options.compactDetails
      ? compactDiagnosticDetails(redactedDetails)
      : redactedDetails,
    createdAt: row.created_at
  });
}

function pruneExpiredDiagnosticLogs() {
  const expiredBefore = new Date(
    Date.now() - DIAGNOSTIC_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1_000
  ).toISOString();
  const result = getDatabase()
    .prepare(
      `DELETE FROM diagnostic_logs
       WHERE created_at < ?`
    )
    .run(expiredBefore) as { changes?: number };

  return result.changes ?? 0;
}

function pruneDiagnosticLogOverflow() {
  const result = getDatabase()
    .prepare(
      `DELETE FROM diagnostic_logs
     WHERE id IN (
       SELECT id
       FROM diagnostic_logs
       ORDER BY created_at DESC, id DESC
       LIMIT -1 OFFSET ?
     )`
    )
    .run(DIAGNOSTIC_LOG_MAX_ENTRIES) as { changes?: number };

  return result.changes ?? 0;
}

function pruneDiagnosticLogs() {
  return pruneExpiredDiagnosticLogs() + pruneDiagnosticLogOverflow();
}

function checkpointDiagnosticLogStore() {
  getDatabase().exec("PRAGMA wal_checkpoint(TRUNCATE);");
}

export function enforceDiagnosticLogRetention(options: {
  now?: Date;
  force?: boolean;
} = {}) {
  const now = options.now ?? new Date();
  const startedAt = now.getTime();
  if (!options.force && startedAt < nextRetentionSweepAt) {
    return { prunedCount: 0, ran: false };
  }
  nextRetentionSweepAt =
    startedAt + DIAGNOSTIC_LOG_RETENTION_SWEEP_INTERVAL_MS;
  const prunedCount = pruneDiagnosticLogs();
  if (prunedCount > 0) {
    checkpointDiagnosticLogStore();
  }
  return {
    prunedCount,
    ran: true
  };
}

export function recordDiagnosticLog(
  input: CreateDiagnosticLogInput,
  now = new Date()
): DiagnosticLogEntry {
  const parsed = createDiagnosticLogSchema.parse(input);
  const entry = diagnosticLogEntrySchema.parse({
    id: `diag_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
    level: parsed.level,
    source: parsed.source ?? "server",
    scope: redactDiagnosticText(parsed.scope),
    eventKey: redactDiagnosticText(parsed.eventKey),
    message: redactDiagnosticText(parsed.message),
    route: redactNullableDiagnosticText(parsed.route ?? null),
    functionName: redactNullableDiagnosticText(parsed.functionName ?? null),
    requestId: redactNullableDiagnosticText(parsed.requestId ?? null),
    entityType: redactNullableDiagnosticText(parsed.entityType ?? null),
    entityId: redactNullableDiagnosticText(parsed.entityId ?? null),
    jobId: redactNullableDiagnosticText(parsed.jobId ?? null),
    details: sanitizeDetails(parsed.details),
    createdAt: now.toISOString()
  });

  getDatabase().prepare(
    `INSERT INTO diagnostic_logs (
      id, level, source, scope, event_key, message, route, function_name,
      request_id, entity_type, entity_id, job_id, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.id,
    entry.level,
    entry.source,
    entry.scope,
    entry.eventKey,
    entry.message,
    entry.route,
    entry.functionName,
    entry.requestId,
    entry.entityType,
    entry.entityId,
    entry.jobId,
    JSON.stringify(entry.details),
    entry.createdAt
  );

  const retentionSweep = enforceDiagnosticLogRetention({ now });
  if (!retentionSweep.ran) {
    const prunedCount = pruneDiagnosticLogOverflow();
    if (prunedCount > 0) {
      checkpointDiagnosticLogStore();
    }
  }
  return entry;
}

export function listDiagnosticLogs(
  filters: DiagnosticLogListQuery = {}
): {
  logs: DiagnosticLogEntry[];
  retention: {
    days: number;
    maximumEntries: number;
  };
  nextCursor: {
    beforeCreatedAt: string;
    beforeId: string;
  } | null;
} {
  enforceDiagnosticLogRetention();
  const whereClauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters.level) {
    whereClauses.push("level = ?");
    params.push(filters.level);
  }
  if (filters.source) {
    whereClauses.push("source = ?");
    params.push(filters.source);
  }
  if (filters.scope) {
    whereClauses.push("scope = ?");
    params.push(filters.scope);
  }
  if (filters.route) {
    whereClauses.push("route = ?");
    params.push(filters.route);
  }
  if (filters.entityType) {
    whereClauses.push("entity_type = ?");
    params.push(filters.entityType);
  }
  if (filters.entityId) {
    whereClauses.push("entity_id = ?");
    params.push(filters.entityId);
  }
  if (filters.jobId) {
    whereClauses.push("job_id = ?");
    params.push(filters.jobId);
  }
  if (filters.search) {
    whereClauses.push(
      "(message LIKE ? OR scope LIKE ? OR event_key LIKE ? OR IFNULL(route, '') LIKE ? OR details_json LIKE ?)"
    );
    const term = `%${filters.search}%`;
    params.push(term, term, term, term, term);
  }
  if (filters.beforeCreatedAt && filters.beforeId) {
    whereClauses.push(
      "(created_at < ? OR (created_at = ? AND id < ?))"
    );
    params.push(
      filters.beforeCreatedAt,
      filters.beforeCreatedAt,
      filters.beforeId
    );
  }

  const whereSql =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const limit = filters.limit ?? 100;
  const rows = getDatabase()
    .prepare(
      `SELECT id, level, source, scope, event_key, message, route, function_name,
              request_id, entity_type, entity_id, job_id, details_json, created_at
       FROM diagnostic_logs
       ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(...params, limit) as DiagnosticLogRow[];

  const logs = rows.map((row) => mapRow(row, { compactDetails: true }));
  const tail = rows.at(-1) ?? null;
  return {
    logs,
    retention: {
      days: DIAGNOSTIC_LOG_RETENTION_DAYS,
      maximumEntries: DIAGNOSTIC_LOG_MAX_ENTRIES
    },
    nextCursor:
      rows.length >= limit && tail
        ? {
            beforeCreatedAt: tail.created_at,
            beforeId: tail.id
          }
        : null
  };
}

export function normalizeDiagnosticSource(value: unknown): DiagnosticLogSource {
  return value === "ui" ||
    value === "openclaw" ||
    value === "agent" ||
    value === "system" ||
    value === "server"
    ? value
    : "server";
}

export function serializeDiagnosticError(error: unknown) {
  return sanitizeDiagnosticValue(error);
}

export function createDiagnosticMessage(input: {
  method?: string | null;
  route?: string | null;
  statusCode?: number | null;
}) {
  const method = input.method?.toUpperCase() || "CALL";
  const route = input.route || "unknown-route";
  if (typeof input.statusCode === "number") {
    return `${method} ${route} -> ${input.statusCode}`;
  }
  return `${method} ${route}`;
}

export function createDiagnosticTimestamp() {
  return nowIso();
}
