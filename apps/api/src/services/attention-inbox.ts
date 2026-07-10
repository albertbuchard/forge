import { randomUUID } from "node:crypto";
import { formatLocalDateKey } from "@/lib/date-keys.js";
import { getDatabase, runInTransaction } from "../db.js";
import {
  attentionInboxItemSchema,
  attentionInboxPayloadSchema,
  attentionInboxStateRecordSchema,
  type AttentionInboxAction,
  type AttentionInboxItem,
  type AttentionInboxPayload,
  type AttentionInboxSeverity,
  type AttentionInboxSource,
  type AttentionInboxState,
  type AttentionInboxStateRecord,
  type Task
} from "../types.js";
import {
  listApprovalRequests,
  listInsights
} from "../repositories/collaboration.js";
import { listAgentRuntimeSessions } from "../repositories/agent-runtime-sessions.js";
import { filterOwnedEntities } from "../repositories/entity-ownership.js";
import { getProjectById } from "../repositories/projects.js";
import { getTaskById, listTasks } from "../repositories/tasks.js";

const DEFAULT_LIMIT = 25;
const MAX_SOURCE_ITEMS = 100;
const STALE_SYNC_AFTER_MS = 2 * 60 * 60 * 1000;

type AttentionInboxScope = {
  userIds?: string[];
  projectIds?: string[];
  tagIds?: string[];
  includeOperationalSignals?: boolean;
};

type AttentionInboxListOptions = AttentionInboxScope & {
  actorKey: string;
  state?: AttentionInboxState;
  limit?: number;
  offset?: number;
  now?: Date;
};

type AttentionStateRow = {
  actor_key: string;
  item_id: string;
  status: AttentionInboxState;
  snoozed_until: string | null;
  source_updated_at: string;
  note: string;
  updated_at: string;
};

type MobileSyncAttentionRow = {
  id: string;
  user_id: string;
  status: "running" | "failed" | "expired";
  error_json: string;
  started_at: string;
  failed_at: string | null;
  expired_at: string | null;
  updated_at: string;
  unresolved_count: number;
};

const severityRank: Record<AttentionInboxSeverity, number> = {
  notice: 0,
  important: 1,
  blocking: 2
};

export function normalizeAttentionActorKey(actor: string | null | undefined) {
  const normalized = actor?.trim().toLowerCase().slice(0, 160);
  return normalized || "operator";
}

function safeJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readAttentionStates(actorKey: string, itemIds: string[]) {
  if (itemIds.length === 0) {
    return new Map<string, AttentionStateRow>();
  }
  const rows = getDatabase()
    .prepare(
      `SELECT actor_key, item_id, status, snoozed_until, source_updated_at, note, updated_at
       FROM attention_inbox_states
       WHERE actor_key = ?
         AND item_id IN (${itemIds.map(() => "?").join(", ")})`
    )
    .all(actorKey, ...itemIds) as AttentionStateRow[];
  return new Map(rows.map((row) => [row.item_id, row]));
}

function hasNarrowEntityScope(scope: AttentionInboxScope) {
  return Boolean(scope.projectIds?.length || scope.tagIds?.length);
}

function filterTasksForScope(tasks: Task[], scope: AttentionInboxScope) {
  const owned = scope.userIds?.length
    ? filterOwnedEntities("task", tasks, scope.userIds)
    : tasks;
  return owned.filter((task) => {
    if (
      scope.projectIds?.length &&
      (!task.projectId || !scope.projectIds.includes(task.projectId))
    ) {
      return false;
    }
    if (
      scope.tagIds?.length &&
      !task.tagIds.some((tagId) => scope.tagIds?.includes(tagId))
    ) {
      return false;
    }
    return true;
  });
}

function targetIsVisible(
  entityType: string | null,
  entityId: string | null,
  scope: AttentionInboxScope
) {
  if (!entityType || !entityId) {
    return !scope.userIds?.length && !hasNarrowEntityScope(scope);
  }
  if (entityType === "task") {
    const task = getTaskById(entityId);
    return Boolean(task && filterTasksForScope([task], scope).length > 0);
  }
  if (entityType === "project") {
    const project = getProjectById(entityId);
    if (!project || scope.tagIds?.length) {
      return false;
    }
    if (scope.projectIds?.length && !scope.projectIds.includes(project.id)) {
      return false;
    }
    return !scope.userIds?.length
      ? true
      : filterOwnedEntities("project", [project], scope.userIds).length > 0;
  }
  if (hasNarrowEntityScope(scope)) {
    return false;
  }
  if (!scope.userIds?.length) {
    return true;
  }
  return (
    filterOwnedEntities(entityType, [{ id: entityId }], scope.userIds).length >
    0
  );
}

function buildTaskItems(tasks: Task[], now: Date): AttentionInboxItem[] {
  const todayKey = formatLocalDateKey(now);
  return tasks.flatMap((task) => {
    const blocked = task.status === "blocked";
    const overdue =
      task.status !== "done" &&
      task.dueDate !== null &&
      task.dueDate < todayKey;
    if (!blocked && !overdue) {
      return [];
    }
    const kind = blocked ? "blocked_work" : "overdue_work";
    const reason = blocked
      ? overdue
        ? "This work is blocked and its due date has passed."
        : "This work is blocked and needs a decision or dependency."
      : `This work was due ${task.dueDate}.`;
    const blockerLabels = task.blockerLinks
      .map((link) => link.label || `${link.entityType} ${link.entityId}`)
      .filter(Boolean);
    return [
      attentionInboxItemSchema.parse({
        id: `attn:task:${task.id}`,
        source: "task",
        kind,
        severity: blocked ? "important" : "notice",
        state: "active",
        title: task.title,
        reason,
        detail:
          blockerLabels.length > 0
            ? `Blocked by ${blockerLabels.slice(0, 3).join(", ")}.`
            : task.description,
        target: {
          entityType: "task",
          entityId: task.id,
          label: task.title,
          href: `/tasks/${task.id}`
        },
        allowedActions: ["open", "snooze"],
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        sourceUpdatedAt: task.updatedAt,
        dueAt: task.dueDate,
        snoozedUntil: null,
        metadata: {
          blocked,
          overdue,
          priority: task.priority,
          projectId: task.projectId,
          tagIds: task.tagIds
        }
      })
    ];
  });
}

function listMobileSyncAttentionRows(now: Date, userIds?: string[]) {
  const clauses = [
    `(sync.status IN ('failed', 'expired') OR (sync.status = 'running' AND sync.started_at < ?))`,
    `NOT EXISTS (
       SELECT 1
       FROM health_mobile_sync_sessions later
       WHERE later.user_id = sync.user_id
         AND later.status = 'completed'
         AND later.started_at > sync.started_at
     )`
  ];
  const params: Array<string> = [
    new Date(now.getTime() - STALE_SYNC_AFTER_MS).toISOString()
  ];
  if (userIds?.length) {
    clauses.push(`sync.user_id IN (${userIds.map(() => "?").join(", ")})`);
    params.push(...userIds);
  }
  return getDatabase()
    .prepare(
      `SELECT sync.id, sync.user_id, sync.status, sync.error_json, sync.started_at,
              sync.failed_at, sync.expired_at, sync.updated_at,
              COUNT(*) OVER (PARTITION BY sync.user_id) AS unresolved_count
       FROM health_mobile_sync_sessions sync
       WHERE ${clauses.join(" AND ")}
       ORDER BY sync.updated_at DESC
       LIMIT ${MAX_SOURCE_ITEMS}`
    )
    .all(...params) as MobileSyncAttentionRow[];
}

function buildMobileSyncItems(
  now: Date,
  userIds?: string[]
): AttentionInboxItem[] {
  const seenUserIds = new Set<string>();
  return listMobileSyncAttentionRows(now, userIds).flatMap((row) => {
    if (seenUserIds.has(row.user_id)) {
      return [];
    }
    seenUserIds.add(row.user_id);
    const error = safeJsonObject(row.error_json);
    const errorMessage =
      (typeof error.message === "string" && error.message) ||
      (typeof error.error === "string" && error.error) ||
      "The companion did not complete this sync session.";
    const stale = row.status === "running";
    return attentionInboxItemSchema.parse({
      id: `attn:companion-sync:${row.id}`,
      source: "companion_sync",
      kind: "sync_problem",
      severity: row.status === "failed" ? "important" : "notice",
      state: "active",
      title: stale
        ? "Companion sync is still running"
        : "Companion sync needs review",
      reason: stale
        ? row.unresolved_count > 1
          ? `The latest sync has not advanced for more than two hours. ${row.unresolved_count} attempts remain unresolved.`
          : "This sync has not advanced for more than two hours."
        : row.unresolved_count > 1
          ? `The latest of ${row.unresolved_count} unresolved sync attempts ended as ${row.status}.`
          : `The latest unresolved sync ended as ${row.status}.`,
      detail: errorMessage,
      target: {
        entityType: "health_mobile_sync_session",
        entityId: row.id,
        label: "Companion sync",
        href: "/settings/mobile"
      },
      allowedActions: ["open", "snooze", "dismiss"],
      createdAt: row.started_at,
      updatedAt: row.updated_at,
      sourceUpdatedAt: row.updated_at,
      dueAt: null,
      snoozedUntil: null,
      metadata: {
        status: row.status,
        userId: row.user_id,
        unresolvedCount: row.unresolved_count
      }
    });
  });
}

function buildCandidates(scope: AttentionInboxScope, now: Date) {
  const candidateTasksById = new Map<string, Task>();
  for (const task of [
    ...listTasks({ status: "blocked", limit: MAX_SOURCE_ITEMS }, { now }),
    ...listTasks({ due: "overdue", limit: MAX_SOURCE_ITEMS }, { now })
  ]) {
    candidateTasksById.set(task.id, task);
  }
  const candidateTasks = filterTasksForScope(
    [...candidateTasksById.values()],
    scope
  );
  const items: AttentionInboxItem[] = buildTaskItems(candidateTasks, now);

  if (scope.includeOperationalSignals) {
    for (const approval of listApprovalRequests("pending").slice(
      0,
      MAX_SOURCE_ITEMS
    )) {
      if (!targetIsVisible(approval.entityType, approval.entityId, scope)) {
        continue;
      }
      items.push(
        attentionInboxItemSchema.parse({
          id: `attn:approval:${approval.id}`,
          source: "approval",
          kind: "decision",
          severity: "blocking",
          state: "active",
          title: approval.title,
          reason: "A trusted agent is waiting for a human decision.",
          detail: approval.summary || approval.actionType,
          target: {
            entityType: approval.entityType,
            entityId: approval.entityId,
            label: approval.title,
            href: "/settings/agents"
          },
          allowedActions: ["open", "approve", "reject", "snooze"],
          createdAt: approval.createdAt,
          updatedAt: approval.updatedAt,
          sourceUpdatedAt: approval.updatedAt,
          dueAt: null,
          snoozedUntil: null,
          metadata: {
            approvalRequestId: approval.id,
            actionType: approval.actionType,
            requestedByAgentId: approval.requestedByAgentId
          }
        })
      );
    }
  }

  for (const insight of listInsights({
    status: "open",
    limit: MAX_SOURCE_ITEMS,
    userIds: scope.userIds
  })) {
    if (!targetIsVisible(insight.entityType, insight.entityId, scope)) {
      continue;
    }
    items.push(
      attentionInboxItemSchema.parse({
        id: `attn:insight:${insight.id}`,
        source: "insight",
        kind: "review",
        severity: insight.confidence >= 0.8 ? "important" : "notice",
        state: "active",
        title: insight.title,
        reason: "This insight has not been reviewed yet.",
        detail: insight.recommendation || insight.summary,
        target: {
          entityType: "insight",
          entityId: insight.id,
          label: insight.title,
          href: "/insights"
        },
        allowedActions: ["open", "snooze", "dismiss"],
        createdAt: insight.createdAt,
        updatedAt: insight.updatedAt,
        sourceUpdatedAt: insight.updatedAt,
        dueAt: null,
        snoozedUntil: null,
        metadata: {
          confidence: insight.confidence,
          linkedEntityType: insight.entityType,
          linkedEntityId: insight.entityId
        }
      })
    );
  }

  if (scope.includeOperationalSignals && !hasNarrowEntityScope(scope)) {
    items.push(...buildMobileSyncItems(now, scope.userIds));
    const latestSessionByGroup = new Map<
      string,
      ReturnType<typeof listAgentRuntimeSessions>[number]
    >();
    for (const session of listAgentRuntimeSessions()) {
      const groupKey = `${session.provider}:${session.agentLabel.trim().toLowerCase()}`;
      if (latestSessionByGroup.has(groupKey)) {
        continue;
      }
      latestSessionByGroup.set(groupKey, session);
      if (latestSessionByGroup.size >= MAX_SOURCE_ITEMS) {
        break;
      }
    }
    for (const session of latestSessionByGroup.values()) {
      if (session.status !== "stale" && session.status !== "error") {
        continue;
      }
      items.push(
        attentionInboxItemSchema.parse({
          id: `attn:agent-session:${session.id}`,
          source: "agent_session",
          kind: "runtime_problem",
          severity: session.status === "error" ? "important" : "notice",
          state: "active",
          title: `${session.agentLabel} is ${session.status}`,
          reason:
            session.status === "error"
              ? "The agent runtime reported an error."
              : "The agent runtime stopped sending heartbeats.",
          detail: session.lastError || session.reconnectPlan.summary,
          target: {
            entityType: "agent_runtime_session",
            entityId: session.id,
            label: session.agentLabel,
            href: "/settings/agents"
          },
          allowedActions: ["open", "snooze", "dismiss"],
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          sourceUpdatedAt: session.updatedAt,
          dueAt: null,
          snoozedUntil: null,
          metadata: {
            provider: session.provider,
            status: session.status,
            lastHeartbeatAt: session.lastHeartbeatAt
          }
        })
      );
    }
  }

  const deduplicated = new Map<string, AttentionInboxItem>();
  for (const item of items) {
    const current = deduplicated.get(item.id);
    if (
      !current ||
      severityRank[item.severity] > severityRank[current.severity] ||
      item.updatedAt > current.updatedAt
    ) {
      deduplicated.set(item.id, item);
    }
  }
  return [...deduplicated.values()].sort((left, right) => {
    const severityDifference =
      severityRank[right.severity] - severityRank[left.severity];
    if (severityDifference !== 0) {
      return severityDifference;
    }
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

function applyState(
  item: AttentionInboxItem,
  state: AttentionStateRow | undefined,
  now: Date
) {
  if (!state || state.source_updated_at !== item.sourceUpdatedAt) {
    return item;
  }
  const snoozed =
    state.status === "snoozed" &&
    state.snoozed_until !== null &&
    Date.parse(state.snoozed_until) > now.getTime();
  const effectiveState: AttentionInboxState = snoozed
    ? "snoozed"
    : state.status === "dismissed"
      ? "dismissed"
      : "active";
  const allowedActions: AttentionInboxAction[] =
    effectiveState === "active" ? item.allowedActions : ["open", "restore"];
  return attentionInboxItemSchema.parse({
    ...item,
    state: effectiveState,
    snoozedUntil: snoozed ? state.snoozed_until : null,
    allowedActions
  });
}

export function listAttentionInbox(
  options: AttentionInboxListOptions
): AttentionInboxPayload {
  const now = options.now ?? new Date();
  const actorKey = normalizeAttentionActorKey(options.actorKey);
  const requestedState = options.state ?? "active";
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), 100);
  const offset = Math.min(Math.max(options.offset ?? 0, 0), 10_000);
  const candidates = buildCandidates(options, now);
  const stateByItemId = readAttentionStates(
    actorKey,
    candidates.map((item) => item.id)
  );
  const allItems = candidates.map((item) =>
    applyState(item, stateByItemId.get(item.id), now)
  );
  const sourceCounts = {
    approval: 0,
    insight: 0,
    task: 0,
    companion_sync: 0,
    agent_session: 0
  } satisfies Record<AttentionInboxSource, number>;
  for (const item of allItems.filter((entry) => entry.state === "active")) {
    sourceCounts[item.source] += 1;
  }
  const filtered = allItems.filter((item) => item.state === requestedState);
  const items = filtered.slice(offset, offset + limit);
  return attentionInboxPayloadSchema.parse({
    generatedAt: now.toISOString(),
    state: requestedState,
    total: filtered.length,
    offset,
    limit,
    hasMore: offset + items.length < filtered.length,
    summary: {
      activeCount: allItems.filter((item) => item.state === "active").length,
      snoozedCount: allItems.filter((item) => item.state === "snoozed").length,
      dismissedCount: allItems.filter((item) => item.state === "dismissed")
        .length,
      blockingCount: allItems.filter(
        (item) => item.state === "active" && item.severity === "blocking"
      ).length,
      importantCount: allItems.filter(
        (item) => item.state === "active" && item.severity === "important"
      ).length,
      sourceCounts
    },
    items
  });
}

export function getAttentionInboxCandidate(
  itemId: string,
  scope: AttentionInboxScope,
  now = new Date()
) {
  return buildCandidates(scope, now).find((item) => item.id === itemId) ?? null;
}

export function getAttentionInboxItem(
  itemId: string,
  options: AttentionInboxScope & { actorKey: string; now?: Date }
) {
  const now = options.now ?? new Date();
  const item = getAttentionInboxCandidate(itemId, options, now);
  if (!item) {
    return null;
  }
  const state = readAttentionStates(
    normalizeAttentionActorKey(options.actorKey),
    [item.id]
  ).get(item.id);
  return applyState(item, state, now);
}

export function transitionAttentionInboxState(input: {
  actorKey: string;
  item: AttentionInboxItem;
  state: AttentionInboxState;
  snoozedUntil?: string | null;
  note?: string;
}): AttentionInboxStateRecord {
  const actorKey = normalizeAttentionActorKey(input.actorKey);
  const now = new Date().toISOString();
  return runInTransaction(() => {
    const current = getDatabase()
      .prepare(
        `SELECT actor_key, item_id, status, snoozed_until, source_updated_at, note, updated_at
         FROM attention_inbox_states
         WHERE actor_key = ? AND item_id = ?`
      )
      .get(actorKey, input.item.id) as AttentionStateRow | undefined;
    getDatabase()
      .prepare(
        `INSERT INTO attention_inbox_states (
           actor_key, item_id, status, snoozed_until, source_updated_at, note, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(actor_key, item_id) DO UPDATE SET
           status = excluded.status,
           snoozed_until = excluded.snoozed_until,
           source_updated_at = excluded.source_updated_at,
           note = excluded.note,
           updated_at = excluded.updated_at`
      )
      .run(
        actorKey,
        input.item.id,
        input.state,
        input.state === "snoozed" ? (input.snoozedUntil ?? null) : null,
        input.item.sourceUpdatedAt,
        input.note?.trim() ?? "",
        now,
        now
      );
    getDatabase()
      .prepare(
        `INSERT INTO attention_inbox_state_events (
           id, actor_key, item_id, from_status, to_status, snoozed_until,
           source_updated_at, note, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `atie_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
        actorKey,
        input.item.id,
        current?.source_updated_at === input.item.sourceUpdatedAt
          ? input.item.state
          : null,
        input.state,
        input.state === "snoozed" ? (input.snoozedUntil ?? null) : null,
        input.item.sourceUpdatedAt,
        input.note?.trim() ?? "",
        now
      );
    return attentionInboxStateRecordSchema.parse({
      itemId: input.item.id,
      state: input.state,
      snoozedUntil:
        input.state === "snoozed" ? (input.snoozedUntil ?? null) : null,
      sourceUpdatedAt: input.item.sourceUpdatedAt,
      note: input.note?.trim() ?? "",
      updatedAt: now
    });
  });
}
