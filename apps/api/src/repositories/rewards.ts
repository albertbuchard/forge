import { createHash, randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { recordEventLog } from "./event-log.js";
import {
  createManualRewardGrantSchema,
  workAdjustmentEntityTypeSchema,
  rewardLedgerEventSchema,
  rewardRuleSchema,
  sessionEventSchema,
  updateRewardRuleSchema,
  type ActivitySource,
  type CreateManualRewardGrantInput,
  type Habit,
  type RewardLedgerEvent,
  type RewardRule,
  type RewardsLedgerQuery,
  type SessionEvent,
  type Task,
  type UpdateRewardRuleInput
} from "../types.js";

type RewardRuleRow = {
  id: string;
  family: RewardRule["family"];
  code: string;
  title: string;
  description: string;
  active: number;
  config_json: string;
  created_at: string;
  updated_at: string;
};

type RewardLedgerRow = {
  id: string;
  rule_id: string | null;
  event_log_id: string | null;
  entity_type: string;
  entity_id: string;
  actor: string | null;
  source: ActivitySource;
  delta_xp: number;
  reason_title: string;
  reason_summary: string;
  reversible_group: string | null;
  reversed_by_reward_id: string | null;
  metadata_json: string;
  created_at: string;
};

type SessionEventRow = {
  id: string;
  session_id: string;
  event_type: string;
  actor: string | null;
  source: ActivitySource;
  metrics_json: string;
  created_at: string;
};

type MetadataValue = string | number | boolean | null;

type LedgerEventInput = {
  ruleId?: string | null;
  eventLogId?: string | null;
  entityType: string;
  entityId: string;
  actor?: string | null;
  source: ActivitySource;
  deltaXp: number;
  reasonTitle: string;
  reasonSummary?: string;
  reversibleGroup?: string | null;
  metadata?: Record<string, MetadataValue>;
};

const DEFAULT_RULES: Array<{
  id: string;
  family: RewardRule["family"];
  code: string;
  title: string;
  description: string;
  config: Record<string, MetadataValue>;
}> = [
  {
    id: "reward_rule_task_completion",
    family: "completion",
    code: "task_completion",
    title: "Task completion",
    description: "Award XP equal to the task points when work reaches done.",
    config: { award: "task.points" }
  },
  {
    id: "reward_rule_task_run_started",
    family: "consistency",
    code: "task_run_started",
    title: "Task started",
    description: "Award a small start bounty when real work begins on a task.",
    config: { fixedXp: 8 }
  },
  {
    id: "reward_rule_task_run_progress",
    family: "consistency",
    code: "task_run_progress",
    title: "Work time bounty",
    description:
      "Award a small XP bounty for each ten credited minutes of active work.",
    config: { fixedXp: 4, intervalMinutes: 10 }
  },
  {
    id: "reward_rule_entity_created",
    family: "consistency",
    code: "entity_created",
    title: "Forge entity created",
    description:
      "Award a small activity bounty when the user creates a real Forge entity.",
    config: { fixedXp: 2 }
  },
  {
    id: "reward_rule_task_run_completion",
    family: "completion",
    code: "task_run_completion",
    title: "Focused run completion",
    description:
      "Award a small bonus when a claimed execution run is completed cleanly.",
    config: { fixedXp: 20 }
  },
  {
    id: "reward_rule_insight_applied",
    family: "collaboration",
    code: "insight_applied",
    title: "Insight applied",
    description: "Reward a concrete decision to apply a useful insight.",
    config: { fixedXp: 15 }
  },
  {
    id: "reward_rule_habit_aligned",
    family: "consistency",
    code: "habit_aligned",
    title: "Habit alignment",
    description:
      "Award XP when a habit outcome matches the intended direction.",
    config: { award: "habit.rewardXp" }
  },
  {
    id: "reward_rule_habit_misaligned",
    family: "recovery",
    code: "habit_misaligned",
    title: "Habit miss",
    description:
      "Apply a small XP penalty when a habit outcome moves against the intended direction.",
    config: { penalty: "habit.penaltyXp" }
  },
  {
    id: "reward_rule_psyche_reflection_capture",
    family: "alignment",
    code: "psyche_reflection_capture",
    title: "Functional analysis captured",
    description:
      "Reward a completed therapeutic reflection capture in a bounded, explainable way.",
    config: { fixedXp: 8 }
  },
  {
    id: "reward_rule_psyche_value_defined",
    family: "alignment",
    code: "psyche_value_defined",
    title: "Value clarified",
    description:
      "Reward the user for naming a value in concrete life language.",
    config: { fixedXp: 5 }
  },
  {
    id: "reward_rule_psyche_pattern_defined",
    family: "alignment",
    code: "psyche_pattern_defined",
    title: "Pattern named",
    description: "Reward honest identification of a recurring loop.",
    config: { fixedXp: 5 }
  },
  {
    id: "reward_rule_psyche_behavior_defined",
    family: "recovery",
    code: "psyche_behavior_defined",
    title: "Behavior mapped",
    description:
      "Reward mapping an away, committed, or recovery move clearly enough to work with it later.",
    config: { fixedXp: 6 }
  },
  {
    id: "reward_rule_psyche_belief_captured",
    family: "alignment",
    code: "psyche_belief_captured",
    title: "Belief surfaced",
    description: "Reward naming a belief and beginning to loosen its grip.",
    config: { fixedXp: 4 }
  },
  {
    id: "reward_rule_psyche_mode_named",
    family: "consistency",
    code: "psyche_mode_named",
    title: "Mode mapped",
    description:
      "Reward giving a recurring mode enough shape to recognize it later.",
    config: { fixedXp: 4 }
  },
  {
    id: "reward_rule_weekly_review_completed",
    family: "alignment",
    code: "weekly_review_completed",
    title: "Weekly review completed",
    description:
      "Reward closing the current weekly review cycle and turning it into explicit evidence.",
    config: { fixedXp: 250 }
  },
  {
    id: "reward_rule_session_dwell",
    family: "ambient",
    code: "session_dwell_120",
    title: "Active dwell milestone",
    description:
      "Award a small amount of XP for sustained focused presence in the app.",
    config: { fixedXp: 2, dailyCap: 12 }
  },
  {
    id: "reward_rule_scroll_depth",
    family: "ambient",
    code: "scroll_depth_75",
    title: "Review depth milestone",
    description:
      "Award a bounded ambient nudge when the user actively explores the product deeply.",
    config: { fixedXp: 3, dailyCap: 12 }
  }
];

function mapRule(row: RewardRuleRow): RewardRule {
  return rewardRuleSchema.parse({
    id: row.id,
    family: row.family,
    code: row.code,
    title: row.title,
    description: row.description,
    active: row.active === 1,
    config: JSON.parse(row.config_json) as Record<string, MetadataValue>,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapLedger(row: RewardLedgerRow): RewardLedgerEvent {
  return rewardLedgerEventSchema.parse({
    id: row.id,
    ruleId: row.rule_id,
    eventLogId: row.event_log_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actor: row.actor,
    source: row.source,
    deltaXp: row.delta_xp,
    reasonTitle: row.reason_title,
    reasonSummary: row.reason_summary,
    reversibleGroup: row.reversible_group,
    reversedByRewardId: row.reversed_by_reward_id,
    metadata: JSON.parse(row.metadata_json) as Record<string, MetadataValue>,
    createdAt: row.created_at
  });
}

function mapSession(row: SessionEventRow): SessionEvent {
  return sessionEventSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    eventType: row.event_type,
    actor: row.actor,
    source: row.source,
    metrics: JSON.parse(row.metrics_json) as Record<string, MetadataValue>,
    createdAt: row.created_at
  });
}

export function ensureDefaultRewardRules(now = new Date().toISOString()): void {
  const insert = getDatabase().prepare(
    `INSERT OR IGNORE INTO reward_rules (id, family, code, title, description, active, config_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
  );
  for (const rule of DEFAULT_RULES) {
    insert.run(
      rule.id,
      rule.family,
      rule.code,
      rule.title,
      rule.description,
      JSON.stringify(rule.config),
      now,
      now
    );
  }
}

export function listRewardRules(): RewardRule[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, family, code, title, description, active, config_json, created_at, updated_at
       FROM reward_rules
       ORDER BY family, created_at`
    )
    .all() as RewardRuleRow[];
  return rows.map(mapRule);
}

export function getRewardRuleById(ruleId: string): RewardRule | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT id, family, code, title, description, active, config_json, created_at, updated_at
       FROM reward_rules
       WHERE id = ?`
    )
    .get(ruleId) as RewardRuleRow | undefined;
  return row ? mapRule(row) : undefined;
}

function getRuleByCode(code: string): RewardRule | undefined {
  return listRewardRules().find((rule) => rule.code === code);
}

export function getTaskRunProgressRewardCadence(): {
  rule: RewardRule | undefined;
  intervalMinutes: number;
  intervalSeconds: number;
  fixedXp: number;
} {
  const rule = getRuleByCode("task_run_progress");
  const intervalMinutes = Math.max(
    1,
    Number(rule?.config.intervalMinutes ?? 10)
  );
  return {
    rule,
    intervalMinutes,
    intervalSeconds: intervalMinutes * 60,
    fixedXp: effectiveFixedXp(rule, 4)
  };
}

export function updateRewardRule(
  ruleId: string,
  input: UpdateRewardRuleInput,
  activity: { actor?: string | null; source: ActivitySource }
): RewardRule | undefined {
  ensureDefaultRewardRules();
  const current = getRewardRuleById(ruleId);
  if (!current) {
    return undefined;
  }

  const parsed = updateRewardRuleSchema.parse(input);
  const next = rewardRuleSchema.parse({
    ...current,
    ...parsed,
    config: parsed.config ?? current.config,
    updatedAt: new Date().toISOString()
  });

  getDatabase()
    .prepare(
      `UPDATE reward_rules
       SET title = ?, description = ?, active = ?, config_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      next.title,
      next.description,
      next.active ? 1 : 0,
      JSON.stringify(next.config),
      next.updatedAt,
      ruleId
    );

  recordEventLog({
    eventKind: "reward.rule_updated",
    entityType: "reward",
    entityId: ruleId,
    actor: activity.actor ?? null,
    source: activity.source,
    metadata: {
      ruleId,
      code: next.code,
      active: next.active
    }
  });

  return getRewardRuleById(ruleId);
}

function resolveRewardOwnerUserId(input: LedgerEventInput): string | null {
  const explicitOwner = input.metadata?.ownerUserId;
  if (typeof explicitOwner === "string" && explicitOwner.trim()) {
    return explicitOwner.trim();
  }

  const entityOwner = getDatabase()
    .prepare(
      `SELECT user_id
       FROM entity_owners
       WHERE entity_type = ? AND entity_id = ?
       LIMIT 1`
    )
    .get(input.entityType, input.entityId) as { user_id: string } | undefined;
  if (entityOwner) {
    return entityOwner.user_id;
  }

  const taskId = input.metadata?.taskId;
  if (typeof taskId === "string" && taskId.trim()) {
    const taskOwner = getDatabase()
      .prepare(
        `SELECT user_id
         FROM entity_owners
         WHERE entity_type = 'task' AND entity_id = ?
         LIMIT 1`
      )
      .get(taskId.trim()) as { user_id: string } | undefined;
    if (taskOwner) {
      return taskOwner.user_id;
    }
  }

  if (!input.actor?.trim()) {
    return null;
  }
  const normalizedActor = input.actor.trim().toLowerCase();
  const actorUser = getDatabase()
    .prepare(
      `SELECT id
       FROM users
       WHERE LOWER(TRIM(display_name)) = ? OR LOWER(TRIM(handle)) = ?
       ORDER BY CASE WHEN LOWER(TRIM(handle)) = ? THEN 0 ELSE 1 END, id
       LIMIT 1`
    )
    .get(normalizedActor, normalizedActor, normalizedActor) as
    | { id: string }
    | undefined;
  return actorUser?.id ?? null;
}

function insertLedgerEvent(
  input: LedgerEventInput,
  now = new Date()
): RewardLedgerEvent {
  const ownerUserId = resolveRewardOwnerUserId(input);
  const metadata = {
    ...(input.metadata ?? {}),
    ...(ownerUserId ? { ownerUserId } : {})
  };
  const event = rewardLedgerEventSchema.parse({
    id: `rwd_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
    ruleId: input.ruleId ?? null,
    eventLogId: input.eventLogId ?? null,
    entityType: input.entityType,
    entityId: input.entityId,
    actor: input.actor ?? null,
    source: input.source,
    deltaXp: input.deltaXp,
    reasonTitle: input.reasonTitle,
    reasonSummary: input.reasonSummary ?? "",
    reversibleGroup: input.reversibleGroup ?? null,
    reversedByRewardId: null,
    metadata,
    createdAt: now.toISOString()
  });

  getDatabase()
    .prepare(
      `INSERT INTO reward_ledger (
        id, rule_id, event_log_id, entity_type, entity_id, actor, source, delta_xp, reason_title, reason_summary,
        reversible_group, reversed_by_reward_id, metadata_json, owner_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
    )
    .run(
      event.id,
      event.ruleId,
      event.eventLogId,
      event.entityType,
      event.entityId,
      event.actor,
      event.source,
      event.deltaXp,
      event.reasonTitle,
      event.reasonSummary,
      event.reversibleGroup,
      JSON.stringify(event.metadata),
      ownerUserId,
      event.createdAt
    );

  return event;
}

function getLedgerEventByReversibleGroup(
  reversibleGroup: string
): RewardLedgerEvent | null {
  const existing = getDatabase()
    .prepare(
      `SELECT
         id, rule_id, event_log_id, entity_type, entity_id, actor, source,
         delta_xp, reason_title, reason_summary, reversible_group,
         reversed_by_reward_id, metadata_json, created_at
       FROM reward_ledger
       WHERE reversible_group = ?
       ORDER BY created_at ASC, id ASC
       LIMIT 1`
    )
    .get(reversibleGroup) as RewardLedgerRow | undefined;
  return existing ? mapLedger(existing) : null;
}

function runIdempotentRewardOperation(
  reversibleGroup: string,
  create: () => RewardLedgerEvent
): RewardLedgerEvent {
  return runInTransaction(() => {
    return getLedgerEventByReversibleGroup(reversibleGroup) ?? create();
  });
}

export class RewardIdempotencyConflictError extends Error {
  readonly existingReward: RewardLedgerEvent;

  constructor(existingReward: RewardLedgerEvent) {
    super(
      "This idempotency key was already used for a different manual reward payload."
    );
    this.name = "RewardIdempotencyConflictError";
    this.existingReward = existingReward;
  }
}

function canonicalManualRewardMetadata(
  metadata: Record<string, string | number | boolean | null>
) {
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(
        ([key]) =>
          key !== "idempotencyKey" &&
          key !== "idempotencyFingerprint" &&
          key !== "manual" &&
          key !== "qualifiesForStreak"
      )
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function manualRewardFingerprint(input: {
  entityType: string;
  entityId: string;
  deltaXp: number;
  reasonTitle: string;
  reasonSummary: string;
  metadata: Record<string, string | number | boolean | null>;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        entityType: input.entityType,
        entityId: input.entityId,
        deltaXp: input.deltaXp,
        reasonTitle: input.reasonTitle,
        reasonSummary: input.reasonSummary,
        metadata: canonicalManualRewardMetadata(input.metadata)
      })
    )
    .digest("hex");
}

function fingerprintStoredManualReward(event: RewardLedgerEvent) {
  const storedFingerprint = event.metadata.idempotencyFingerprint;
  if (typeof storedFingerprint === "string" && storedFingerprint.trim()) {
    return storedFingerprint.trim();
  }
  return manualRewardFingerprint({
    entityType: event.entityType,
    entityId: event.entityId,
    deltaXp: event.deltaXp,
    reasonTitle: event.reasonTitle,
    reasonSummary: event.reasonSummary,
    metadata: event.metadata
  });
}

function manualRewardIdempotencyGroup(
  input: CreateManualRewardGrantInput,
  idempotencyKey: string,
  activity: { actor?: string | null; source: ActivitySource }
) {
  const ownerUserId = input.metadata.ownerUserId;
  const scope =
    typeof ownerUserId === "string" && ownerUserId.trim()
      ? `user:${ownerUserId.trim()}`
      : `actor:${activity.source}:${activity.actor?.trim() || "unknown"}`;
  const scopeHash = createHash("sha256")
    .update(scope)
    .digest("hex")
    .slice(0, 24);
  const keyHash = createHash("sha256").update(idempotencyKey).digest("hex");
  return `manual_bonus:${scopeHash}:${keyHash}`;
}

function effectiveFixedXp(
  rule: RewardRule | undefined,
  fallback: number
): number {
  if (rule && !rule.active) {
    return 0;
  }
  const configured = Number(rule?.config.fixedXp ?? fallback);
  return Number.isFinite(configured)
    ? Math.max(0, Math.trunc(configured))
    : Math.max(0, Math.trunc(fallback));
}

export function listRewardLedger(
  filters: RewardsLedgerQuery = {}
): RewardLedgerEvent[] {
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

  const whereSql =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(200, filters.limit ?? 50));
  params.push(limit);

  const rows = getDatabase()
    .prepare(
      `SELECT
         id, rule_id, event_log_id, entity_type, entity_id, actor, source, delta_xp, reason_title, reason_summary,
         reversible_group, reversed_by_reward_id, metadata_json, created_at
       FROM reward_ledger
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(...params) as RewardLedgerRow[];

  return rows.map(mapLedger);
}

export function getRewardLedgerEventById(
  rewardId: string
): RewardLedgerEvent | null {
  const row = getDatabase()
    .prepare(
      `SELECT
         id, rule_id, event_log_id, entity_type, entity_id, actor, source, delta_xp, reason_title, reason_summary,
         reversible_group, reversed_by_reward_id, metadata_json, created_at
       FROM reward_ledger
       WHERE id = ?`
    )
    .get(rewardId) as RewardLedgerRow | undefined;

  return row ? mapLedger(row) : null;
}

export function getTotalXp(): number {
  const row = getDatabase()
    .prepare(`SELECT COALESCE(SUM(delta_xp), 0) AS total FROM reward_ledger`)
    .get() as { total: number };
  return Math.max(0, row.total);
}

export function getWeeklyXp(weekStartIso: string): number {
  const row = getDatabase()
    .prepare(
      `SELECT COALESCE(SUM(delta_xp), 0) AS total FROM reward_ledger WHERE created_at >= ?`
    )
    .get(weekStartIso) as { total: number };
  return Math.max(0, row.total);
}

function resolveRewardTimezone(requestedTimezone?: string): string {
  const candidate =
    requestedTimezone?.trim() ||
    process.env.TZ?.trim() ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return "UTC";
  }
}

function dateKeyInTimezone(value: string | Date, timezone: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  return `${parts.find((part) => part.type === "year")?.value ?? "1970"}-${parts.find((part) => part.type === "month")?.value ?? "01"}-${parts.find((part) => part.type === "day")?.value ?? "01"}`;
}

export function getDailyAmbientXp(
  dayKey: string,
  actor: string | null = null,
  timezone = resolveRewardTimezone()
): number {
  const day = new Date(`${dayKey}T12:00:00.000Z`);
  const lower = new Date(day);
  lower.setUTCDate(lower.getUTCDate() - 2);
  const upper = new Date(day);
  upper.setUTCDate(upper.getUTCDate() + 2);
  const rows = getDatabase()
    .prepare(
      `SELECT reward_ledger.delta_xp, reward_ledger.created_at
       FROM reward_ledger
       JOIN reward_rules ON reward_rules.id = reward_ledger.rule_id
       WHERE reward_rules.family = 'ambient'
         AND reward_ledger.actor IS ?
         AND reward_ledger.created_at >= ?
         AND reward_ledger.created_at < ?`
    )
    .all(actor, lower.toISOString(), upper.toISOString()) as Array<{
    delta_xp: number;
    created_at: string;
  }>;
  return Math.max(
    0,
    rows
      .filter((row) => dateKeyInTimezone(row.created_at, timezone) === dayKey)
      .reduce((sum, row) => sum + row.delta_xp, 0)
  );
}

export function awardTaskCompletionReward(
  task: Task,
  activity: { actor?: string | null; source: ActivitySource }
): RewardLedgerEvent {
  return runInTransaction(() => {
    ensureDefaultRewardRules();
    const rule = getRuleByCode("task_completion");
    const group = `task_completion:${task.id}:${task.completedAt ?? "unspecified"}`;
    const existingRows = getDatabase()
      .prepare(
        `SELECT
           id, rule_id, event_log_id, entity_type, entity_id, actor, source,
           delta_xp, reason_title, reason_summary, reversible_group,
           reversed_by_reward_id, metadata_json, created_at
         FROM reward_ledger
         WHERE reversible_group = ?
         ORDER BY created_at ASC, id ASC`
      )
      .all(group) as RewardLedgerRow[];
    const firstMetadata = existingRows[0]
      ? (mapLedger(existingRows[0]).metadata as Record<string, MetadataValue>)
      : null;
    const ruleWasActive =
      firstMetadata?.ruleActive === false ? false : (rule?.active ?? true);
    const targetXp = ruleWasActive ? Math.max(0, task.points) : 0;
    const currentNetXp = existingRows.reduce(
      (sum, row) => sum + row.delta_xp,
      0
    );
    const deltaXp = targetXp - currentNetXp;
    if (existingRows.length > 0 && deltaXp === 0) {
      return mapLedger(existingRows.at(-1)!);
    }

    const correction = existingRows.length > 0;
    const eventLog = recordEventLog({
      eventKind: correction
        ? "reward.task_completion_corrected"
        : "reward.task_completion",
      entityType: "task",
      entityId: task.id,
      actor: activity.actor ?? null,
      source: activity.source,
      metadata: {
        taskId: task.id,
        points: task.points,
        completedAt: task.completedAt ?? "",
        previousNetXp: currentNetXp,
        nextNetXp: targetXp,
        correction
      }
    });

    return insertLedgerEvent({
      ruleId: rule?.id ?? null,
      eventLogId: eventLog.id,
      entityType: "task",
      entityId: task.id,
      actor: activity.actor ?? null,
      source: activity.source,
      deltaXp,
      reasonTitle: correction
        ? `Task XP corrected: ${task.title}`
        : `Task completed: ${task.title}`,
      reasonSummary: !ruleWasActive
        ? "The task completion rule was disabled, so this completion earned no XP."
        : correction
          ? `Completion XP was corrected from ${currentNetXp} to ${targetXp} after the task points changed.`
          : "Completion XP awarded from the task's point value.",
      reversibleGroup: group,
      metadata: {
        taskId: task.id,
        points: task.points,
        awardedPoints: targetXp,
        ruleActive: ruleWasActive,
        correction,
        qualifiesForStreak: !correction && deltaXp > 0
      }
    });
  });
}

export function reverseLatestTaskCompletionReward(
  task: Task,
  activity: { actor?: string | null; source: ActivitySource }
): RewardLedgerEvent | null {
  return runInTransaction(() => {
    ensureDefaultRewardRules();
    const latestGroup = getDatabase()
      .prepare(
        `SELECT reversible_group, MAX(created_at) AS latest_created_at,
                SUM(delta_xp) AS net_xp
         FROM reward_ledger
         WHERE entity_type = 'task'
           AND entity_id = ?
           AND reversible_group LIKE 'task_completion:%'
         GROUP BY reversible_group
         HAVING SUM(delta_xp) <> 0
         ORDER BY latest_created_at DESC, reversible_group DESC
         LIMIT 1`
      )
      .get(task.id) as
      | {
          reversible_group: string;
          latest_created_at: string;
          net_xp: number;
        }
      | undefined;

    if (!latestGroup) {
      return null;
    }
    const latest = getDatabase()
      .prepare(
        `SELECT
           id, rule_id, event_log_id, entity_type, entity_id, actor, source,
           delta_xp, reason_title, reason_summary, reversible_group,
           reversed_by_reward_id, metadata_json, created_at
         FROM reward_ledger
         WHERE reversible_group = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`
      )
      .get(latestGroup.reversible_group) as RewardLedgerRow;
    const reversalEventLog = recordEventLog({
      eventKind: "reward.task_completion_reversed",
      entityType: "task",
      entityId: task.id,
      actor: activity.actor ?? null,
      source: activity.source,
      metadata: {
        rewardGroup: latestGroup.reversible_group,
        taskId: task.id,
        reversedXp: latestGroup.net_xp
      }
    });

    const reversal = insertLedgerEvent({
      ruleId: latest.rule_id,
      eventLogId: reversalEventLog.id,
      entityType: latest.entity_type,
      entityId: latest.entity_id,
      actor: activity.actor ?? null,
      source: activity.source,
      deltaXp: -latestGroup.net_xp,
      reasonTitle: `Task reopened: ${task.title}`,
      reasonSummary: `Reversed ${latestGroup.net_xp} net completion XP because the task left done.`,
      reversibleGroup: latestGroup.reversible_group,
      metadata: {
        reversedRewardGroup: latestGroup.reversible_group,
        taskId: task.id,
        qualifiesForStreak: false
      }
    });

    getDatabase()
      .prepare(
        `UPDATE reward_ledger
         SET reversed_by_reward_id = COALESCE(reversed_by_reward_id, ?)
         WHERE reversible_group = ? AND id <> ?`
      )
      .run(reversal.id, latestGroup.reversible_group, reversal.id);
    return reversal;
  });
}

export function reconcileTaskCompletionRewards(tasks: Task[]): number {
  const completed = tasks.filter(
    (task) =>
      task.status === "done" &&
      task.resolutionKind !== "split" &&
      Boolean(task.completedAt)
  );
  if (completed.length === 0) {
    return 0;
  }

  const groups = completed.map(
    (task) => `task_completion:${task.id}:${task.completedAt}`
  );
  const existingGroups = new Set<string>();
  for (let offset = 0; offset < groups.length; offset += 400) {
    const chunk = groups.slice(offset, offset + 400);
    const rows = getDatabase()
      .prepare(
        `SELECT DISTINCT reversible_group
         FROM reward_ledger
         WHERE reversible_group IN (${chunk.map(() => "?").join(", ")})`
      )
      .all(...chunk) as Array<{ reversible_group: string }>;
    for (const row of rows) {
      existingGroups.add(row.reversible_group);
    }
  }

  let corrected = 0;
  for (const task of completed) {
    const group = `task_completion:${task.id}:${task.completedAt}`;
    if (!existingGroups.has(group)) {
      continue;
    }
    const before = getDatabase()
      .prepare(
        `SELECT COALESCE(SUM(delta_xp), 0) AS net_xp, COUNT(*) AS event_count
         FROM reward_ledger
         WHERE reversible_group = ?`
      )
      .get(group) as { net_xp: number; event_count: number };
    const event = awardTaskCompletionReward(task, {
      actor: null,
      source: "system"
    });
    if (event.createdAt && before.event_count > 0) {
      const after = getDatabase()
        .prepare(
          `SELECT COUNT(*) AS event_count
           FROM reward_ledger
           WHERE reversible_group = ?`
        )
        .get(group) as { event_count: number };
      if (after.event_count > before.event_count) {
        corrected += 1;
      }
    }
  }
  return corrected;
}

export function reverseLatestHabitCheckInReward(
  habit: Habit,
  dateKey: string,
  activity: { actor?: string | null; source: ActivitySource }
): RewardLedgerEvent | null {
  return runInTransaction(() => {
    ensureDefaultRewardRules();
    const reversibleGroup = `habit:${habit.id}:${dateKey}`;
    const latest = getDatabase()
      .prepare(
        `SELECT
           id, rule_id, event_log_id, entity_type, entity_id, actor, source, delta_xp, reason_title, reason_summary,
           reversible_group, reversed_by_reward_id, metadata_json, created_at
         FROM reward_ledger
         WHERE reversible_group = ?
           AND reversed_by_reward_id IS NULL
           AND json_type(metadata_json, '$.status') IS NOT NULL
         ORDER BY created_at DESC, id DESC
         LIMIT 1`
      )
      .get(reversibleGroup) as RewardLedgerRow | undefined;

    if (!latest) {
      return null;
    }

    const reversalEventLog = recordEventLog({
      eventKind: "reward.habit_check_in_reversed",
      entityType: "habit",
      entityId: habit.id,
      actor: activity.actor ?? null,
      source: activity.source,
      metadata: {
        rewardId: latest.id,
        habitId: habit.id,
        dateKey
      }
    });

    const reversal = insertLedgerEvent({
      ruleId: latest.rule_id,
      eventLogId: reversalEventLog.id,
      entityType: latest.entity_type,
      entityId: latest.entity_id,
      actor: activity.actor ?? null,
      source: activity.source,
      deltaXp: -latest.delta_xp,
      reasonTitle: `Habit entry removed: ${habit.title}`,
      reasonSummary: `Habit check-in removed for ${dateKey}.`,
      reversibleGroup: latest.reversible_group,
      metadata: {
        reversedRewardId: latest.id,
        habitId: habit.id,
        dateKey,
        qualifiesForStreak: false
      }
    });

    getDatabase()
      .prepare(
        `UPDATE reward_ledger SET reversed_by_reward_id = ? WHERE id = ?`
      )
      .run(reversal.id, latest.id);
    return reversal;
  });
}

export function recordInsightAppliedReward(
  insightId: string,
  entityType: string,
  entityId: string,
  activity: { actor?: string | null; source: ActivitySource }
): RewardLedgerEvent {
  const reversibleGroup = `insight_applied:${insightId}`;
  return runIdempotentRewardOperation(reversibleGroup, () => {
    ensureDefaultRewardRules();
    const rule = getRuleByCode("insight_applied");
    const eventLog = recordEventLog({
      eventKind: "reward.insight_applied",
      entityType,
      entityId,
      actor: activity.actor ?? null,
      source: activity.source,
      metadata: { insightId }
    });
    const deltaXp = effectiveFixedXp(rule, 15);
    return insertLedgerEvent({
      ruleId: rule?.id ?? null,
      eventLogId: eventLog.id,
      entityType,
      entityId,
      actor: activity.actor ?? null,
      source: activity.source,
      deltaXp,
      reasonTitle: "Insight applied",
      reasonSummary:
        deltaXp > 0
          ? "A structured insight was accepted and marked as applied."
          : "The insight rule was disabled, so this event earned no XP.",
      reversibleGroup,
      metadata: {
        insightId,
        ruleActive: rule?.active ?? true,
        qualifiesForStreak: deltaXp > 0
      }
    });
  });
}

export function recordPsycheReflectionReward(
  reportId: string,
  title: string,
  activity: { actor?: string | null; source: ActivitySource }
): RewardLedgerEvent {
  const reversibleGroup = `psyche_reflection_capture:${reportId}`;
  return runIdempotentRewardOperation(reversibleGroup, () => {
    ensureDefaultRewardRules();
    const rule = getRuleByCode("psyche_reflection_capture");
    const eventLog = recordEventLog({
      eventKind: "reward.psyche_reflection_capture",
      entityType: "trigger_report",
      entityId: reportId,
      actor: activity.actor ?? null,
      source: activity.source,
      metadata: { triggerReportId: reportId, title }
    });
    const deltaXp = effectiveFixedXp(rule, 8);
    return insertLedgerEvent({
      ruleId: rule?.id ?? null,
      eventLogId: eventLog.id,
      entityType: "trigger_report",
      entityId: reportId,
      actor: activity.actor ?? null,
      source: activity.source,
      deltaXp,
      reasonTitle: `Psyche reflection captured: ${title}`,
      reasonSummary:
        deltaXp > 0
          ? "A structured trigger report was stored and the reflection ledger was updated."
          : "The reflection rule was disabled, so this event earned no XP.",
      reversibleGroup,
      metadata: {
        triggerReportId: reportId,
        ruleActive: rule?.active ?? true,
        qualifiesForStreak: deltaXp > 0
      }
    });
  });
}

export function recordPsycheClarityReward(
  entityType:
    | "psyche_value"
    | "behavior_pattern"
    | "behavior"
    | "belief_entry"
    | "mode_profile",
  entityId: string,
  title: string,
  ruleCode:
    | "psyche_value_defined"
    | "psyche_pattern_defined"
    | "psyche_behavior_defined"
    | "psyche_belief_captured"
    | "psyche_mode_named",
  activity: { actor?: string | null; source: ActivitySource }
): RewardLedgerEvent {
  const reversibleGroup = `${ruleCode}:${entityId}`;
  return runIdempotentRewardOperation(reversibleGroup, () => {
    ensureDefaultRewardRules();
    const rule = getRuleByCode(ruleCode);
    const eventLog = recordEventLog({
      eventKind: `reward.${ruleCode}`,
      entityType,
      entityId,
      actor: activity.actor ?? null,
      source: activity.source,
      metadata: { entityId, entityType, title }
    });
    const deltaXp = effectiveFixedXp(rule, 4);
    return insertLedgerEvent({
      ruleId: rule?.id ?? null,
      eventLogId: eventLog.id,
      entityType,
      entityId,
      actor: activity.actor ?? null,
      source: activity.source,
      deltaXp,
      reasonTitle: rule?.title ?? "Psyche clarity gained",
      reasonSummary:
        deltaXp > 0
          ? (rule?.description ?? "A Psyche entity was clarified and stored.")
          : "The reward rule was disabled, so this event earned no XP.",
      reversibleGroup,
      metadata: {
        entityType,
        title,
        ruleActive: rule?.active ?? true,
        qualifiesForStreak: deltaXp > 0
      }
    });
  });
}

export function recordTaskRunCompletionReward(
  taskRunId: string,
  taskId: string,
  actor: string | null,
  source: ActivitySource
): RewardLedgerEvent {
  const reversibleGroup = `task_run_completion:${taskRunId}`;
  return runIdempotentRewardOperation(reversibleGroup, () => {
    ensureDefaultRewardRules();
    const rule = getRuleByCode("task_run_completion");
    const eventLog = recordEventLog({
      eventKind: "reward.task_run_completion",
      entityType: "task_run",
      entityId: taskRunId,
      actor,
      source,
      metadata: { taskId, taskRunId }
    });
    const deltaXp = effectiveFixedXp(rule, 20);
    return insertLedgerEvent({
      ruleId: rule?.id ?? null,
      eventLogId: eventLog.id,
      entityType: "task_run",
      entityId: taskRunId,
      actor,
      source,
      deltaXp,
      reasonTitle: rule?.title ?? "Focused run completion",
      reasonSummary:
        deltaXp > 0
          ? (rule?.description ?? "A claimed execution run was completed.")
          : "The focused-run completion rule was disabled, so this event earned no XP.",
      reversibleGroup,
      metadata: {
        taskId,
        taskRunId,
        ruleActive: rule?.active ?? true,
        qualifiesForStreak: deltaXp > 0
      }
    });
  });
}

export function recordTaskRunStartReward(
  taskRunId: string,
  taskId: string,
  actor: string | null,
  source: ActivitySource
): RewardLedgerEvent {
  const reversibleGroup = `task_run_started:${taskRunId}`;
  return runIdempotentRewardOperation(reversibleGroup, () => {
    ensureDefaultRewardRules();
    const rule = getRuleByCode("task_run_started");
    const eventLog = recordEventLog({
      eventKind: "reward.task_run_started",
      entityType: "task_run",
      entityId: taskRunId,
      actor,
      source,
      metadata: { taskId, taskRunId }
    });
    const deltaXp = effectiveFixedXp(rule, 8);
    return insertLedgerEvent({
      ruleId: rule?.id ?? null,
      eventLogId: eventLog.id,
      entityType: "task_run",
      entityId: taskRunId,
      actor,
      source,
      deltaXp,
      reasonTitle: rule?.title ?? "Task started",
      reasonSummary:
        deltaXp > 0
          ? (rule?.description ?? "A live work timer was started for a task.")
          : "The task-start rule was disabled, so this event earned no XP.",
      reversibleGroup,
      metadata: {
        taskId,
        taskRunId,
        ruleActive: rule?.active ?? true,
        qualifiesForStreak: deltaXp > 0
      }
    });
  });
}

export function recordTaskRunProgressRewards(
  taskRunId: string,
  taskId: string,
  actor: string | null,
  source: ActivitySource,
  creditedSeconds: number
): RewardLedgerEvent[] {
  return runInTransaction(() => {
    ensureDefaultRewardRules();
    const { rule, intervalMinutes, intervalSeconds, fixedXp } =
      getTaskRunProgressRewardCadence();
    const earnedBuckets = Math.floor(
      Math.max(0, creditedSeconds) / intervalSeconds
    );
    if (earnedBuckets <= 0) {
      return [];
    }

    const existingCount = (
      getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count
           FROM reward_ledger
           WHERE entity_type = 'task_run'
             AND entity_id = ?
             AND reversible_group LIKE ?`
        )
        .get(taskRunId, `task_run_progress:${taskRunId}:%`) as { count: number }
    ).count;

    if (existingCount >= earnedBuckets) {
      return [];
    }

    const rewards: RewardLedgerEvent[] = [];
    for (
      let bucketIndex = existingCount + 1;
      bucketIndex <= earnedBuckets;
      bucketIndex += 1
    ) {
      const creditedMinutes = bucketIndex * intervalMinutes;
      const eventLog = recordEventLog({
        eventKind: "reward.task_run_progress",
        entityType: "task_run",
        entityId: taskRunId,
        actor,
        source,
        metadata: {
          taskId,
          taskRunId,
          bucketIndex,
          creditedMinutes
        }
      });

      rewards.push(
        insertLedgerEvent({
          ruleId: rule?.id ?? null,
          eventLogId: eventLog.id,
          entityType: "task_run",
          entityId: taskRunId,
          actor,
          source,
          deltaXp: fixedXp,
          reasonTitle: rule?.title ?? "Work time bounty",
          reasonSummary:
            fixedXp > 0
              ? `Awarded after ${creditedMinutes} credited minutes of active work.`
              : "The work-time rule was disabled, so this milestone earned no XP.",
          reversibleGroup: `task_run_progress:${taskRunId}:${bucketIndex}`,
          metadata: {
            taskId,
            taskRunId,
            bucketIndex,
            creditedMinutes,
            ruleActive: rule?.active ?? true,
            qualifiesForStreak: fixedXp > 0
          }
        })
      );
    }

    return rewards;
  });
}

export function recordEntityCreationReward(input: {
  entityType: string;
  entityId: string;
  title?: string | null;
  actor?: string | null;
  source?: ActivitySource;
  createdAt: string;
}): RewardLedgerEvent {
  return runInTransaction(() => {
    ensureDefaultRewardRules();
    const reversibleGroup = `entity_created:${input.entityType}:${input.entityId}`;
    const existing = getDatabase()
      .prepare(
        `SELECT
           id, rule_id, event_log_id, entity_type, entity_id, actor, source,
           delta_xp, reason_title, reason_summary, reversible_group,
           reversed_by_reward_id, metadata_json, created_at
         FROM reward_ledger
         WHERE reversible_group = ?
         ORDER BY created_at ASC, id ASC
         LIMIT 1`
      )
      .get(reversibleGroup) as RewardLedgerRow | undefined;
    if (existing) {
      return mapLedger(existing);
    }

    const createdAtDate = Number.isNaN(Date.parse(input.createdAt))
      ? new Date()
      : new Date(input.createdAt);
    const rule = getRuleByCode("entity_created");
    const deltaXp = effectiveFixedXp(rule, 2);
    const readableType = input.entityType.replaceAll("_", " ");
    const title = input.title?.trim() || readableType;
    const eventLog = recordEventLog(
      {
        eventKind: "reward.entity_created",
        entityType: input.entityType,
        entityId: input.entityId,
        actor: input.actor ?? null,
        source: input.source ?? "system",
        metadata: {
          entityType: input.entityType,
          entityId: input.entityId,
          title,
          createdAt: input.createdAt
        }
      },
      createdAtDate
    );

    return insertLedgerEvent(
      {
        ruleId: rule?.id ?? null,
        eventLogId: eventLog.id,
        entityType: input.entityType,
        entityId: input.entityId,
        actor: input.actor ?? null,
        source: input.source ?? "system",
        deltaXp,
        reasonTitle: `Created ${readableType}: ${title}`,
        reasonSummary:
          deltaXp > 0
            ? "Small Forge activity XP for creating something concrete."
            : "The entity-creation rule was disabled, so this event earned no XP.",
        reversibleGroup,
        metadata: {
          entityType: input.entityType,
          title,
          ruleActive: rule?.active ?? true,
          qualifiesForStreak: deltaXp > 0
        }
      },
      createdAtDate
    );
  });
}

export function recordWorkAdjustmentReward(input: {
  entityType: "task" | "project";
  entityId: string;
  targetTitle: string;
  actor?: string | null;
  source: ActivitySource;
  requestedDeltaMinutes: number;
  appliedDeltaMinutes: number;
  previousCreditedSeconds: number;
  nextCreditedSeconds: number;
  adjustmentId: string;
}): RewardLedgerEvent | null {
  ensureDefaultRewardRules();
  const { rule, intervalMinutes, intervalSeconds, fixedXp } =
    getTaskRunProgressRewardCadence();
  const entityType = workAdjustmentEntityTypeSchema.parse(input.entityType);
  const previousBuckets = Math.floor(
    Math.max(0, input.previousCreditedSeconds) / intervalSeconds
  );
  const nextBuckets = Math.floor(
    Math.max(0, input.nextCreditedSeconds) / intervalSeconds
  );
  const bucketDelta = nextBuckets - previousBuckets;

  if (bucketDelta === 0) {
    return null;
  }

  const deltaXp = bucketDelta * fixedXp;
  const direction = bucketDelta > 0 ? "added" : "removed";
  const appliedMinutes = Math.abs(input.appliedDeltaMinutes);
  const reversibleGroup = `work_adjustment:${entityType}:${input.entityId}:${input.adjustmentId}`;
  return runIdempotentRewardOperation(reversibleGroup, () => {
    const eventLog = recordEventLog({
      eventKind: "reward.work_adjustment",
      entityType,
      entityId: input.entityId,
      actor: input.actor ?? null,
      source: input.source,
      metadata: {
        adjustmentId: input.adjustmentId,
        requestedDeltaMinutes: input.requestedDeltaMinutes,
        appliedDeltaMinutes: input.appliedDeltaMinutes,
        bucketDelta,
        deltaXp
      }
    });
    return insertLedgerEvent({
      ruleId: rule?.id ?? null,
      eventLogId: eventLog.id,
      entityType,
      entityId: input.entityId,
      actor: input.actor ?? null,
      source: input.source,
      deltaXp,
      reasonTitle:
        bucketDelta > 0
          ? "Manual work minutes added"
          : "Manual work minutes removed",
      reasonSummary:
        fixedXp > 0
          ? `${appliedMinutes} manual minute${appliedMinutes === 1 ? "" : "s"} ${direction}, shifting ${Math.abs(bucketDelta)} ${intervalMinutes}-minute reward bucket${Math.abs(bucketDelta) === 1 ? "" : "s"} for ${input.targetTitle}.`
          : `${appliedMinutes} manual minute${appliedMinutes === 1 ? "" : "s"} ${direction}; the work-time reward rule is disabled, so XP did not change.`,
      reversibleGroup,
      metadata: {
        adjustmentId: input.adjustmentId,
        requestedDeltaMinutes: input.requestedDeltaMinutes,
        appliedDeltaMinutes: input.appliedDeltaMinutes,
        previousCreditedSeconds: input.previousCreditedSeconds,
        nextCreditedSeconds: input.nextCreditedSeconds,
        bucketDelta,
        intervalMinutes,
        rewardCategory: "manual_work_adjustment",
        manual: true,
        qualifiesForStreak: false,
        ruleActive: rule?.active ?? true
      }
    });
  });
}

export function recordSessionEvent(
  input: {
    sessionId: string;
    eventType: string;
    timezone?: string;
    metrics: Record<string, MetadataValue>;
  },
  activity: { actor?: string | null; source: ActivitySource },
  now = new Date()
): { sessionEvent: SessionEvent; rewardEvent: RewardLedgerEvent | null } {
  return runInTransaction(() => {
    ensureDefaultRewardRules();
    const actor = activity.actor ?? null;
    const existingRow = getDatabase()
      .prepare(
        `SELECT id, session_id, event_type, actor, source, metrics_json, created_at
         FROM session_events
         WHERE session_id = ? AND event_type = ? AND actor IS ? AND source = ?
         ORDER BY created_at ASC, id ASC
         LIMIT 1`
      )
      .get(input.sessionId, input.eventType, actor, activity.source) as
      | SessionEventRow
      | undefined;
    if (existingRow) {
      const sessionEvent = mapSession(existingRow);
      const rewardRow = getDatabase()
        .prepare(
          `SELECT
             id, rule_id, event_log_id, entity_type, entity_id, actor, source,
             delta_xp, reason_title, reason_summary, reversible_group,
             reversed_by_reward_id, metadata_json, created_at
           FROM reward_ledger
           WHERE reversible_group LIKE ?
           ORDER BY created_at ASC, id ASC
           LIMIT 1`
        )
        .get(`session:${sessionEvent.id}:%`) as RewardLedgerRow | undefined;
      return {
        sessionEvent,
        rewardEvent: rewardRow ? mapLedger(rewardRow) : null
      };
    }

    const sessionEvent = sessionEventSchema.parse({
      id: `ses_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
      sessionId: input.sessionId,
      eventType: input.eventType,
      actor,
      source: activity.source,
      metrics: input.metrics,
      createdAt: now.toISOString()
    });

    getDatabase()
      .prepare(
        `INSERT INTO session_events (id, session_id, event_type, actor, source, metrics_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        sessionEvent.id,
        sessionEvent.sessionId,
        sessionEvent.eventType,
        sessionEvent.actor,
        sessionEvent.source,
        JSON.stringify(sessionEvent.metrics),
        sessionEvent.createdAt
      );

    recordEventLog(
      {
        eventKind: `session.${sessionEvent.eventType}`,
        entityType: "session",
        entityId: sessionEvent.id,
        actor: sessionEvent.actor,
        source: sessionEvent.source,
        metadata: {
          sessionId: sessionEvent.sessionId
        }
      },
      now
    );

    const timezone = resolveRewardTimezone(input.timezone);
    const day = dateKeyInTimezone(sessionEvent.createdAt, timezone);
    const currentAmbientXp = getDailyAmbientXp(day, actor, timezone);
    const active =
      sessionEvent.metrics.visible === true &&
      sessionEvent.metrics.interacted === true;
    const ruleCode =
      sessionEvent.eventType === "dwell_120_seconds"
        ? "session_dwell_120"
        : sessionEvent.eventType === "scroll_depth_75"
          ? "scroll_depth_75"
          : null;
    const rule = ruleCode ? getRuleByCode(ruleCode) : null;
    const configuredCap = Number(rule?.config.dailyCap ?? 12);
    const dailyCap = Number.isFinite(configuredCap)
      ? Math.max(0, Math.trunc(configuredCap))
      : 12;
    const awardXp = effectiveFixedXp(rule ?? undefined, 0);

    if (
      !rule ||
      !rule.active ||
      !active ||
      awardXp <= 0 ||
      currentAmbientXp >= dailyCap
    ) {
      return { sessionEvent, rewardEvent: null };
    }

    const rewardEvent = insertLedgerEvent(
      {
        ruleId: rule.id,
        entityType: "session",
        entityId: sessionEvent.id,
        actor,
        source: activity.source,
        deltaXp: Math.max(0, Math.min(awardXp, dailyCap - currentAmbientXp)),
        reasonTitle: rule.title,
        reasonSummary: rule.description,
        reversibleGroup: `session:${sessionEvent.id}:${rule.code}`,
        metadata: {
          sessionId: sessionEvent.sessionId,
          eventType: sessionEvent.eventType,
          ruleActive: true,
          qualifiesForStreak: true,
          timezone,
          dateKey: day
        }
      },
      now
    );

    return { sessionEvent, rewardEvent };
  });
}

export function recordHabitCheckInReward(
  habit: Habit,
  status: "done" | "missed",
  dateKey: string,
  activity: { actor?: string | null; source: ActivitySource }
): RewardLedgerEvent {
  return runInTransaction(() => {
    ensureDefaultRewardRules();
    const reversibleGroup = `habit:${habit.id}:${dateKey}`;
    const existing = getDatabase()
      .prepare(
        `SELECT
           id, rule_id, event_log_id, entity_type, entity_id, actor, source,
           delta_xp, reason_title, reason_summary, reversible_group,
           reversed_by_reward_id, metadata_json, created_at
         FROM reward_ledger
         WHERE reversible_group = ?
           AND reversed_by_reward_id IS NULL
           AND json_extract(metadata_json, '$.status') = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`
      )
      .get(reversibleGroup, status) as RewardLedgerRow | undefined;
    if (existing) {
      return mapLedger(existing);
    }

    const aligned =
      (habit.polarity === "positive" && status === "done") ||
      (habit.polarity === "negative" && status === "missed");
    const rule = getRuleByCode(aligned ? "habit_aligned" : "habit_misaligned");
    const ruleActive = rule?.active ?? true;
    const deltaXp = ruleActive
      ? aligned
        ? habit.rewardXp
        : -Math.abs(habit.penaltyXp)
      : 0;
    const actionLabel =
      habit.polarity === "positive"
        ? status === "done"
          ? "completed"
          : "missed"
        : status === "done"
          ? "performed"
          : "resisted";
    const eventLog = recordEventLog({
      eventKind: aligned ? "reward.habit_aligned" : "reward.habit_misaligned",
      entityType: "habit",
      entityId: habit.id,
      actor: activity.actor ?? null,
      source: activity.source,
      metadata: {
        habitId: habit.id,
        status,
        polarity: habit.polarity,
        dateKey,
        deltaXp
      }
    });

    return insertLedgerEvent({
      ruleId: rule?.id ?? null,
      eventLogId: eventLog.id,
      entityType: "habit",
      entityId: habit.id,
      actor: activity.actor ?? null,
      source: activity.source,
      deltaXp,
      reasonTitle: aligned
        ? `${habit.title} aligned`
        : `${habit.title} slipped`,
      reasonSummary: ruleActive
        ? `Habit ${actionLabel} on ${dateKey}.`
        : `Habit ${actionLabel} on ${dateKey}; the matching reward rule was disabled, so XP did not change.`,
      reversibleGroup,
      metadata: {
        habitId: habit.id,
        status,
        polarity: habit.polarity,
        dateKey,
        ruleActive,
        qualifiesForStreak: aligned && deltaXp > 0
      }
    });
  });
}

export function recordHabitGeneratedWorkoutReward(
  input: {
    habitId: string;
    habitTitle: string;
    checkInId: string;
    workoutId: string;
    workoutType: string;
    xpReward: number;
  },
  activity: { actor?: string | null; source: ActivitySource }
): RewardLedgerEvent | null {
  if (input.xpReward <= 0) {
    return null;
  }

  return runInTransaction(() => {
    ensureDefaultRewardRules();
    const reversibleGroup = `habit_generated_workout:${input.checkInId}`;
    const existing = getDatabase()
      .prepare(
        `SELECT
           id, rule_id, event_log_id, entity_type, entity_id, actor, source, delta_xp, reason_title, reason_summary,
           reversible_group, reversed_by_reward_id, metadata_json, created_at
         FROM reward_ledger
         WHERE reversible_group = ?
         LIMIT 1`
      )
      .get(reversibleGroup) as RewardLedgerRow | undefined;
    if (existing) {
      return mapLedger(existing);
    }

    const eventLog = recordEventLog({
      eventKind: "reward.habit_generated_workout",
      entityType: "habit",
      entityId: input.habitId,
      actor: activity.actor ?? null,
      source: activity.source,
      metadata: {
        habitId: input.habitId,
        checkInId: input.checkInId,
        workoutId: input.workoutId,
        workoutType: input.workoutType,
        xpReward: input.xpReward
      }
    });

    return insertLedgerEvent({
      ruleId: null,
      eventLogId: eventLog.id,
      entityType: "habit",
      entityId: input.habitId,
      actor: activity.actor ?? null,
      source: activity.source,
      deltaXp: input.xpReward,
      reasonTitle: `Generated workout: ${input.habitTitle}`,
      reasonSummary: `Created a ${input.workoutType} session from a completed habit.`,
      reversibleGroup,
      metadata: {
        habitId: input.habitId,
        checkInId: input.checkInId,
        workoutId: input.workoutId,
        workoutType: input.workoutType,
        rewardCategory: "habit_generated_workout",
        qualifiesForStreak: true
      }
    });
  });
}

export function recordWeeklyReviewCompletionReward(
  input: {
    weekKey: string;
    windowLabel: string;
    rewardXp: number;
  },
  activity: { actor?: string | null; source: ActivitySource }
): RewardLedgerEvent {
  const reversibleGroup = `weekly_review_completed:${input.weekKey}`;
  return runIdempotentRewardOperation(reversibleGroup, () => {
    ensureDefaultRewardRules();
    const rule = getRuleByCode("weekly_review_completed");
    const deltaXp = effectiveFixedXp(rule, input.rewardXp);
    const eventLog = recordEventLog({
      eventKind: "reward.weekly_review_completed",
      entityType: "system",
      entityId: input.weekKey,
      actor: activity.actor ?? null,
      source: activity.source,
      metadata: {
        weekKey: input.weekKey,
        windowLabel: input.windowLabel,
        deltaXp
      }
    });
    return insertLedgerEvent({
      ruleId: rule?.id ?? null,
      eventLogId: eventLog.id,
      entityType: "system",
      entityId: input.weekKey,
      actor: activity.actor ?? null,
      source: activity.source,
      deltaXp,
      reasonTitle: rule?.title ?? "Weekly review completed",
      reasonSummary:
        deltaXp > 0
          ? `Closed the review for ${input.windowLabel}.`
          : `Closed the review for ${input.windowLabel}; the weekly-review reward rule was disabled.`,
      reversibleGroup,
      metadata: {
        weekKey: input.weekKey,
        windowLabel: input.windowLabel,
        ruleActive: rule?.active ?? true,
        qualifiesForStreak: deltaXp > 0
      }
    });
  });
}

export function listSessionEvents(limit = 50): SessionEvent[] {
  const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
  const rows = getDatabase()
    .prepare(
      `SELECT id, session_id, event_type, actor, source, metrics_json, created_at
       FROM session_events
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(boundedLimit) as SessionEventRow[];
  return rows.map(mapSession);
}

export function createManualRewardGrant(
  input: CreateManualRewardGrantInput,
  activity: { actor?: string | null; source: ActivitySource }
): RewardLedgerEvent {
  const parsed = createManualRewardGrantSchema.parse(input);
  const idempotencyKey =
    typeof parsed.metadata.idempotencyKey === "string" &&
    parsed.metadata.idempotencyKey.trim()
      ? parsed.metadata.idempotencyKey.trim()
      : null;
  const fingerprint = manualRewardFingerprint(parsed);
  const reversibleGroup = idempotencyKey
    ? manualRewardIdempotencyGroup(parsed, idempotencyKey, activity)
    : null;
  const legacyReversibleGroup = idempotencyKey
    ? `manual_bonus:${parsed.entityType}:${parsed.entityId}:${idempotencyKey}`
    : null;
  const createReward = () => {
    const eventLog = recordEventLog({
      eventKind: "reward.manual_bonus",
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      actor: activity.actor ?? null,
      source: activity.source,
      metadata: {
        deltaXp: parsed.deltaXp,
        reasonTitle: parsed.reasonTitle
      }
    });
    return insertLedgerEvent({
      ruleId: null,
      eventLogId: eventLog.id,
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      actor: activity.actor ?? null,
      source: activity.source,
      deltaXp: parsed.deltaXp,
      reasonTitle: parsed.reasonTitle,
      reasonSummary: parsed.reasonSummary,
      reversibleGroup:
        reversibleGroup ??
        `manual_bonus:${parsed.entityType}:${parsed.entityId}:${eventLog.id}`,
      metadata: {
        ...parsed.metadata,
        manual: true,
        qualifiesForStreak: false,
        ...(idempotencyKey ? { idempotencyFingerprint: fingerprint } : {})
      }
    });
  };
  if (!reversibleGroup) {
    return runInTransaction(createReward);
  }
  return runInTransaction(() => {
    const existing =
      getLedgerEventByReversibleGroup(reversibleGroup) ??
      (legacyReversibleGroup
        ? getLedgerEventByReversibleGroup(legacyReversibleGroup)
        : null);
    if (!existing) {
      return createReward();
    }
    if (fingerprintStoredManualReward(existing) !== fingerprint) {
      throw new RewardIdempotencyConflictError(existing);
    }
    return existing;
  });
}
