import { getDatabase } from "../db.js";
import {
  enqueueGamificationCelebration,
  getGamificationEquipment,
  insertGamificationUnlock,
  listGamificationDailyActivity,
  listGamificationUnlocks,
  listUnseenGamificationCelebrations,
  replaceGamificationDailyActivity,
  upsertGamificationEquipment
} from "../repositories/gamification.js";
import { getDailyAmbientXp, listRewardRules } from "../repositories/rewards.js";
import {
  getDefaultUser,
  listUsers,
  listUsersByIds
} from "../repositories/users.js";
import {
  GAMIFICATION_CATALOG,
  GAMIFICATION_STREAK_AWAY_DAY_KEYS,
  GAMIFICATION_STREAK_POWER_DAY_KEYS,
  type GamificationCatalogItem,
  type GamificationMetricKey,
  type GamificationRequirement
} from "../../../src/lib/gamification-catalog.js";
import {
  achievementSignalSchema,
  gamificationCatalogPayloadSchema,
  gamificationProfileSchema,
  milestoneRewardSchema,
  rewardLedgerEventSchema,
  type AchievementSignal,
  type GamificationCatalogEntry,
  type GamificationCatalogPayload,
  type GamificationEquipment,
  type GamificationMascotState,
  type GamificationProfile,
  type GamificationScope,
  type Goal,
  type Habit,
  type MilestoneReward,
  type RewardLedgerEvent,
  type Task,
  type UserSummary,
  type XpMomentumPulse
} from "../types.js";

const XP_CURVE_VERSION = "smith-forge";

type MetadataValue = string | number | boolean | null;

type RewardMetricRow = RewardLedgerEvent & {
  ownerUserId: string | null;
  ruleCode: string | null;
  ruleFamily: string | null;
};

type RewardLedgerDbRow = {
  id: string;
  rule_id: string | null;
  event_log_id: string | null;
  entity_type: string;
  entity_id: string;
  actor: string | null;
  source: RewardLedgerEvent["source"];
  delta_xp: number;
  reason_title: string;
  reason_summary: string;
  reversible_group: string | null;
  reversed_by_reward_id: string | null;
  metadata_json: string;
  created_at: string;
  rule_code: string | null;
  rule_family: string | null;
};

type CatalogMetricValues = Record<GamificationMetricKey, number>;

function startOfWeek(date: Date): Date {
  const clone = new Date(date);
  const day = clone.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  clone.setDate(clone.getDate() + delta);
  clone.setHours(0, 0, 0, 0);
  return clone;
}

function dayKey(isoDate: string): string {
  return isoDate.slice(0, 10);
}

function isAlignedHabitCheckIn(
  habit: Habit,
  checkIn: Habit["checkIns"][number]
) {
  return (
    (habit.polarity === "positive" && checkIn.status === "done") ||
    (habit.polarity === "negative" && checkIn.status === "missed")
  );
}

export function xpToAdvance(level: number): number {
  return 100 + Math.round(35 * Math.pow(Math.max(0, level - 1), 1.25));
}

function cumulativeXpForLevel(level: number): number {
  let total = 0;
  for (let cursor = 1; cursor < level; cursor += 1) {
    total += xpToAdvance(cursor);
  }
  return total;
}

export function calculateLevel(totalXp: number): {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  xpIntoLevel: number;
  xpToNextLevel: number;
  currentLevelStartXp: number;
  nextLevelTotalXp: number;
  levelCurveVersion: string;
} {
  const safeTotal = Math.max(0, Math.trunc(totalXp));
  let level = 1;
  let currentLevelStartXp = 0;
  let nextLevelXp = xpToAdvance(level);
  while (safeTotal >= currentLevelStartXp + nextLevelXp) {
    currentLevelStartXp += nextLevelXp;
    level += 1;
    nextLevelXp = xpToAdvance(level);
  }
  const xpIntoLevel = safeTotal - currentLevelStartXp;
  const xpToNextLevel = Math.max(0, nextLevelXp - xpIntoLevel);
  return {
    level,
    currentLevelXp: xpIntoLevel,
    nextLevelXp,
    xpIntoLevel,
    xpToNextLevel,
    currentLevelStartXp,
    nextLevelTotalXp: currentLevelStartXp + nextLevelXp,
    levelCurveVersion: XP_CURVE_VERSION
  };
}

function latestCompletionForTasks(tasks: Task[]): string | null {
  return (
    tasks
      .flatMap((task) =>
        task.completedAt ? [task.completedAt] : []
      )
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null
  );
}

function latestAlignedHabitAt(habits: Habit[]): string | null {
  return (
    habits
      .flatMap((habit) =>
        habit.checkIns
          .filter((checkIn) => isAlignedHabitCheckIn(habit, checkIn))
          .map((checkIn) => checkIn.createdAt)
      )
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null
  );
}

function resolveTimezone(): string {
  return (
    process.env.TZ ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC"
  );
}

function dateKeyInTimezone(value: string | Date, timezone: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function daysBetweenDateKeys(left: string, right: string): number {
  const leftDate = new Date(`${left}T12:00:00.000Z`);
  const rightDate = new Date(`${right}T12:00:00.000Z`);
  return Math.round(
    (rightDate.getTime() - leftDate.getTime()) / 86_400_000
  );
}

function subtractDaysFromDateKey(dateKeyValue: string, days: number): string {
  const date = new Date(`${dateKeyValue}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function resolveScopeUsers(requestedUserIds?: string[]): {
  mode: GamificationScope["mode"];
  users: UserSummary[];
} {
  const uniqueRequestedUserIds = Array.from(
    new Set((requestedUserIds ?? []).filter((userId) => userId.trim()))
  );
  if (uniqueRequestedUserIds.length === 1) {
    const selectedUsers = listUsersByIds(uniqueRequestedUserIds);
    if (selectedUsers.length === 1) {
      return { mode: "selected_user", users: selectedUsers };
    }
  }
  try {
    return { mode: "operator_fallback", users: [getDefaultUser()] };
  } catch {
    return { mode: "aggregate_fallback", users: listUsers() };
  }
}

export function resolveGamificationScope(
  requestedUserIds?: string[]
): GamificationScope {
  const { mode, users } = resolveScopeUsers(requestedUserIds);
  const label =
    users.length === 1
      ? users[0]!.displayName
      : users.length > 1
        ? `${users.length} users`
        : "Forge";
  return {
    mode,
    userIds: users.map((user) => user.id),
    users,
    label
  };
}

function buildOwnerResolver(defaultUserId: string | null) {
  const ownerRows = getDatabase()
    .prepare(
      `SELECT entity_type, entity_id, user_id
       FROM entity_owners`
    )
    .all() as Array<{
    entity_type: string;
    entity_id: string;
    user_id: string;
  }>;
  const ownerByEntityKey = new Map(
    ownerRows.map(
      (row) => [`${row.entity_type}:${row.entity_id}`, row.user_id] as const
    )
  );
  const usersByLabel = new Map<string, string>();
  for (const user of listUsers()) {
    usersByLabel.set(user.displayName.trim().toLowerCase(), user.id);
    usersByLabel.set(user.handle.trim().toLowerCase(), user.id);
  }
  return (row: Pick<RewardMetricRow, "entityType" | "entityId" | "actor">) => {
    if (row.entityType === "system" && row.actor) {
      const actorUserId = usersByLabel.get(row.actor.trim().toLowerCase());
      if (actorUserId) return actorUserId;
    }
    return ownerByEntityKey.get(`${row.entityType}:${row.entityId}`) ?? defaultUserId;
  };
}

function parseMetadata(raw: string): Record<string, MetadataValue> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, MetadataValue>;
  } catch {
    return {};
  }
}

function loadScopedRewardEvents(scope: GamificationScope): RewardMetricRow[] {
  const rows = getDatabase()
    .prepare(
      `SELECT
         reward_ledger.id,
         reward_ledger.rule_id,
         reward_ledger.event_log_id,
         reward_ledger.entity_type,
         reward_ledger.entity_id,
         reward_ledger.actor,
         reward_ledger.source,
         reward_ledger.delta_xp,
         reward_ledger.reason_title,
         reward_ledger.reason_summary,
         reward_ledger.reversible_group,
         reward_ledger.reversed_by_reward_id,
         reward_ledger.metadata_json,
         reward_ledger.created_at,
         reward_rules.code AS rule_code,
         reward_rules.family AS rule_family
       FROM reward_ledger
       LEFT JOIN reward_rules ON reward_rules.id = reward_ledger.rule_id
       ORDER BY reward_ledger.created_at ASC`
    )
    .all() as RewardLedgerDbRow[];
  const scopeUserIds = new Set(scope.userIds);
  const defaultUserId = scope.userIds[0] ?? null;
  const resolveOwner = buildOwnerResolver(defaultUserId);
  return rows
    .map((row) => {
      const event = rewardLedgerEventSchema.parse({
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
        metadata: parseMetadata(row.metadata_json),
        createdAt: row.created_at
      });
      return {
        ...event,
        ownerUserId: resolveOwner(event),
        ruleCode: row.rule_code,
        ruleFamily: row.rule_family
      };
    })
    .filter((event) =>
      scopeUserIds.size === 0
        ? true
        : event.ownerUserId !== null && scopeUserIds.has(event.ownerUserId)
    );
}

function isQualifyingStreakReward(event: RewardMetricRow): boolean {
  return (
    event.deltaXp > 0 &&
    event.reversedByRewardId === null &&
    event.metadata.manual !== true
  );
}

function syncDailyActivity(
  userId: string,
  scopedRewards: RewardMetricRow[],
  timezone: string
) {
  const byDate = new Map<
    string,
    {
      dateKey: string;
      qualifyingXp: number;
      eventCount: number;
      firstRewardEventId: string | null;
      lastRewardEventId: string | null;
    }
  >();
  for (const event of scopedRewards.filter(isQualifyingStreakReward)) {
    const dateKeyValue = dateKeyInTimezone(event.createdAt, timezone);
    const current =
      byDate.get(dateKeyValue) ??
      {
        dateKey: dateKeyValue,
        qualifyingXp: 0,
        eventCount: 0,
        firstRewardEventId: null,
        lastRewardEventId: null
      };
    current.qualifyingXp += event.deltaXp;
    current.eventCount += 1;
    current.firstRewardEventId ??= event.id;
    current.lastRewardEventId = event.id;
    byDate.set(dateKeyValue, current);
  }
  replaceGamificationDailyActivity(
    userId,
    [...byDate.values()].map((row) => ({
      userId,
      dateKey: row.dateKey,
      timezone,
      qualifyingXp: row.qualifyingXp,
      eventCount: row.eventCount,
      firstRewardEventId: row.firstRewardEventId,
      lastRewardEventId: row.lastRewardEventId
    }))
  );
  return listGamificationDailyActivity(userId);
}

function calculateStreakFromActivity(
  activeDateKeys: Set<string>,
  now: Date,
  timezone: string
): number {
  const today = dateKeyInTimezone(now, timezone);
  let streak = 0;
  let cursor = today;
  while (activeDateKeys.has(cursor)) {
    streak += 1;
    cursor = subtractDaysFromDateKey(cursor, 1);
  }
  return streak;
}

function calculateLongestStreak(activeDateKeys: string[]): number {
  if (activeDateKeys.length === 0) return 0;
  const ordered = [...new Set(activeDateKeys)].sort();
  let longest = 1;
  let current = 1;
  for (let index = 1; index < ordered.length; index += 1) {
    if (daysBetweenDateKeys(ordered[index - 1]!, ordered[index]!) === 1) {
      current += 1;
    } else {
      longest = Math.max(longest, current);
      current = 1;
    }
  }
  return Math.max(longest, current);
}

function calculateComebackCount(activeDateKeys: string[]): number {
  const ordered = [...new Set(activeDateKeys)].sort();
  let count = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    if (daysBetweenDateKeys(ordered[index - 1]!, ordered[index]!) > 1) {
      count += 1;
    }
  }
  return count;
}

function calculateMajorComebackCount(activeDateKeys: string[]): number {
  const ordered = [...new Set(activeDateKeys)].sort();
  let count = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const gapDays = daysBetweenDateKeys(ordered[index - 1]!, ordered[index]!);
    if (gapDays >= 8) {
      count += 1;
    }
  }
  return count;
}

function calculateMissedDays(
  activeDateKeys: string[],
  now: Date,
  timezone: string
) {
  const today = dateKeyInTimezone(now, timezone);
  const latest = [...activeDateKeys].sort().at(-1) ?? null;
  if (!latest || latest === today) {
    return { missedDays: 0, lastActiveDateKey: latest };
  }
  return {
    missedDays: Math.max(0, daysBetweenDateKeys(latest, today)),
    lastActiveDateKey: latest
  };
}

function scalarNumber(sql: string, params: unknown[] = []): number {
  const row = getDatabase().prepare(sql).get(...(params as never[])) as
    | { value: number | null }
    | undefined;
  return Math.max(0, Number(row?.value ?? 0));
}

function ownerScopeClause(
  entityAlias: string,
  ownerAlias: string,
  entityType: string,
  scope: GamificationScope
) {
  if (scope.userIds.length === 0) {
    return { join: "", where: "", joinParams: [] as unknown[], whereParams: [] as unknown[] };
  }
  const placeholders = scope.userIds.map(() => "?").join(", ");
  return {
    join: `INNER JOIN entity_owners ${ownerAlias}
      ON ${ownerAlias}.entity_type = ?
     AND ${ownerAlias}.entity_id = ${entityAlias}.id`,
    where: ` AND ${ownerAlias}.user_id IN (${placeholders})`,
    joinParams: [entityType] as unknown[],
    whereParams: scope.userIds as unknown[]
  };
}

function countOwnedRows(
  tableName: string,
  entityType: string,
  scope: GamificationScope,
  whereSql = "1 = 1",
  whereParams: unknown[] = []
): number {
  const scopeClause = ownerScopeClause("t", "eo", entityType, scope);
  return scalarNumber(
    `SELECT COUNT(*) AS value
     FROM ${tableName} t
     ${scopeClause.join}
     WHERE (${whereSql})${scopeClause.where}`,
    [...scopeClause.joinParams, ...whereParams, ...scopeClause.whereParams]
  );
}

function countDistinctOwnedRows(
  tableName: string,
  entityType: string,
  distinctSql: string,
  scope: GamificationScope,
  whereSql = "1 = 1",
  whereParams: unknown[] = []
): number {
  const scopeClause = ownerScopeClause("t", "eo", entityType, scope);
  return scalarNumber(
    `SELECT COUNT(DISTINCT ${distinctSql}) AS value
     FROM ${tableName} t
     ${scopeClause.join}
     WHERE (${whereSql})${scopeClause.where}`,
    [...scopeClause.joinParams, ...whereParams, ...scopeClause.whereParams]
  );
}

function countRowsByUser(
  tableName: string,
  scope: GamificationScope,
  whereSql = "1 = 1",
  whereParams: unknown[] = []
): number {
  const scopeWhere =
    scope.userIds.length > 0
      ? ` AND user_id IN (${scope.userIds.map(() => "?").join(", ")})`
      : "";
  return scalarNumber(
    `SELECT COUNT(*) AS value
     FROM ${tableName}
     WHERE (${whereSql})${scopeWhere}`,
    [...whereParams, ...scope.userIds]
  );
}

function countTaskRuns(
  scope: GamificationScope,
  whereSql = "1 = 1",
  whereParams: unknown[] = []
): number {
  const scopeClause = ownerScopeClause("t", "eo", "task", scope);
  return scalarNumber(
    `SELECT COUNT(*) AS value
     FROM task_runs r
     INNER JOIN tasks t ON t.id = r.task_id
     ${scopeClause.join}
     WHERE (${whereSql})${scopeClause.where}`,
    [...scopeClause.joinParams, ...whereParams, ...scopeClause.whereParams]
  );
}

function countOwnedWikiPages(
  scope: GamificationScope,
  whereSql = "1 = 1",
  whereParams: unknown[] = []
): number {
  const scopeClause = ownerScopeClause("t", "eo", "note", scope);
  return scalarNumber(
    `SELECT COUNT(DISTINCT t.id) AS value
     FROM wiki_pages_fts w
     INNER JOIN notes t ON t.id = w.note_id
     ${scopeClause.join}
     WHERE (t.destroy_at IS NULL OR t.destroy_at = '' OR t.destroy_at > CURRENT_TIMESTAMP)
       AND (${whereSql})${scopeClause.where}`,
    [...scopeClause.joinParams, ...whereParams, ...scopeClause.whereParams]
  );
}

function countOwnedWikiLinks(
  scope: GamificationScope,
  selectSql = "COUNT(*)",
  whereSql = "1 = 1",
  whereParams: unknown[] = []
): number {
  const scopeClause = ownerScopeClause("t", "eo", "note", scope);
  return scalarNumber(
    `SELECT ${selectSql} AS value
     FROM wiki_link_edges e
     INNER JOIN notes t ON t.id = e.source_note_id
     ${scopeClause.join}
     WHERE (${whereSql})${scopeClause.where}`,
    [...scopeClause.joinParams, ...whereParams, ...scopeClause.whereParams]
  );
}

function jsonTextPresent(expression: string): string {
  return `TRIM(COALESCE(${expression}, '')) NOT IN ('', '[]', '{}', 'null')`;
}

function buildMetricValues(input: {
  scope: GamificationScope;
  profile: GamificationProfile;
  scopedRewards: RewardMetricRow[];
  tasks: Task[];
  habits: Habit[];
  activeDateKeys: string[];
}): CatalogMetricValues {
  const positiveRewards = input.scopedRewards.filter(isQualifyingStreakReward);
  const doneTasks = input.tasks.filter((task) => task.status === "done");
  const completedRunWhere = "r.status IN ('completed', 'released', 'timed_out')";
  const psycheEntityTypes = new Set([
    "psyche_value",
    "behavior_pattern",
    "behavior",
    "belief_entry",
    "mode_profile",
    "mode_guide_session",
    "trigger_report"
  ]);
  const nonManualXp = positiveRewards.reduce(
    (sum, reward) => sum + reward.deltaXp,
    0
  );
  const goalLinkedTaskCompletionCount = doneTasks.filter(
    (task) => task.goalId !== null
  ).length;
  const projectLinkedTaskCompletionCount = doneTasks.filter(
    (task) => task.projectId !== null
  ).length;
  const wikiPageCount = countOwnedWikiPages(input.scope);
  const wikiLinkCount = countOwnedWikiLinks(input.scope);
  const linkedWikiPageCount = countOwnedWikiLinks(
    input.scope,
    "COUNT(DISTINCT e.source_note_id)",
    "e.target_note_id IS NOT NULL OR (e.target_entity_type IS NOT NULL AND e.target_entity_id IS NOT NULL)"
  );
  const wikiPageWithSummaryCount = countOwnedWikiPages(
    input.scope,
    "TRIM(COALESCE(w.summary, '')) <> ''"
  );
  const knowledgeGraphTargetCount = countOwnedWikiLinks(
    input.scope,
    "COUNT(DISTINCT COALESCE(e.target_note_id, e.target_entity_type || ':' || e.target_entity_id, NULLIF(e.raw_target, '')))",
    "e.target_note_id IS NOT NULL OR e.target_entity_id IS NOT NULL OR TRIM(e.raw_target) <> ''"
  );
  const modeProfileCount = countOwnedRows("mode_profiles", "mode_profile", input.scope);
  const behaviorPatternCount = countOwnedRows(
    "behavior_patterns",
    "behavior_pattern",
    input.scope
  );
  const beliefEntryCount = countOwnedRows("belief_entries", "belief_entry", input.scope);
  const triggerReportCount = countOwnedRows(
    "trigger_reports",
    "trigger_report",
    input.scope
  );
  const healthSleepSessionCount = countRowsByUser(
    "health_sleep_sessions",
    input.scope
  );
  const workoutSessionCount = countRowsByUser(
    "health_workout_sessions",
    input.scope
  );
  const agentActionCount = scalarNumber(
    `SELECT COUNT(*) AS value FROM agent_actions`
  );
  const agentCompletedActionCount = scalarNumber(
    `SELECT COUNT(*) AS value
     FROM agent_actions
     WHERE status IN ('completed', 'approved', 'applied', 'done')`
  );
  const base: Omit<CatalogMetricValues, "activeCategoryCount"> = {
    totalXp: input.profile.totalXp,
    nonManualXp,
    level: input.profile.level,
    streakDays: input.profile.streakDays,
    longestStreakDays: calculateLongestStreak(input.activeDateKeys),
    comebackCount: calculateComebackCount(input.activeDateKeys),
    comebackAfter7Count: calculateMajorComebackCount(input.activeDateKeys),
    taskCompletionCount: doneTasks.length,
    goalLinkedTaskCompletionCount,
    distinctGoalsWithCompletions: new Set(
      doneTasks.flatMap((task) => (task.goalId ? [task.goalId] : []))
    ).size,
    projectLinkedTaskCompletionCount,
    projectCompletionCount: countOwnedRows(
      "projects",
      "project",
      input.scope,
      "t.status IN ('completed', 'done') OR t.workflow_status IN ('completed', 'done')"
    ),
    activeProjectCount: countOwnedRows(
      "projects",
      "project",
      input.scope,
      "t.status = 'active' AND t.workflow_status NOT IN ('completed', 'done')"
    ),
    strategyCount: countOwnedRows("strategies", "strategy", input.scope),
    focusRunCount: countTaskRuns(input.scope, completedRunWhere),
    plannedFocusRunCount: countTaskRuns(
      input.scope,
      `${completedRunWhere} AND r.timer_mode = 'planned'`
    ),
    creditedFocusMinutes: Math.floor(
      input.tasks.reduce(
        (sum, task) => sum + (task.time?.totalCreditedSeconds ?? 0),
        0
      ) / 60
    ),
    taskCloseoutReportCount: doneTasks.filter(
      (task) => task.completionReport !== null
    ).length,
    habitAlignedCount: input.habits.reduce(
      (sum, habit) =>
        sum +
        habit.checkIns.filter((checkIn) =>
          isAlignedHabitCheckIn(habit, checkIn)
        ).length,
      0
    ),
    habitStreakMax: Math.max(0, ...input.habits.map((habit) => habit.streakCount)),
    distinctHabitCount: input.habits.filter((habit) =>
      habit.checkIns.some((checkIn) => isAlignedHabitCheckIn(habit, checkIn))
    ).length,
    recoveryEventCount: positiveRewards.filter(
      (reward) => reward.ruleFamily === "recovery"
    ).length,
    lifeForceSnapshotCount: countRowsByUser(
      "life_force_day_snapshots",
      input.scope
    ),
    healthSleepSessionCount,
    workoutSessionCount,
    wikiPageCount,
    wikiPageWithSummaryCount,
    wikiLinkCount,
    linkedWikiPageCount,
    noteCount: countOwnedRows(
      "notes",
      "note",
      input.scope,
      "t.destroy_at IS NULL OR t.destroy_at = '' OR t.destroy_at > CURRENT_TIMESTAMP"
    ),
    knowledgeGraphNodeCount: wikiPageCount + knowledgeGraphTargetCount,
    psycheValueCount: countOwnedRows("psyche_values", "psyche_value", input.scope),
    modeProfileCount,
    linkedModeProfileCount: countOwnedRows(
      "mode_profiles",
      "mode_profile",
      input.scope,
      [
        jsonTextPresent("t.linked_pattern_ids_json"),
        jsonTextPresent("t.linked_behavior_ids_json"),
        jsonTextPresent("t.linked_value_ids_json")
      ].join(" OR ")
    ),
    modeGuideSessionCount: scalarNumber(
      `SELECT COUNT(*) AS value FROM mode_guide_sessions`
    ),
    triggerReportCount,
    triggerReportCompletedCount: countOwnedRows(
      "trigger_reports",
      "trigger_report",
      input.scope,
      "t.status NOT IN ('draft')"
    ),
    triggerReportRichCount: countOwnedRows(
      "trigger_reports",
      "trigger_report",
      input.scope,
      [
        jsonTextPresent("t.emotions_json"),
        jsonTextPresent("t.thoughts_json"),
        jsonTextPresent("t.behaviors_json"),
        jsonTextPresent("t.consequences_json"),
        jsonTextPresent("t.next_moves_json")
      ].join(" AND ")
    ),
    behaviorPatternCount,
    behaviorPatternWithReplacementCount: countOwnedRows(
      "behavior_patterns",
      "behavior_pattern",
      input.scope,
      "TRIM(COALESCE(t.preferred_response, '')) <> ''"
    ),
    behaviorCount: countOwnedRows("psyche_behaviors", "behavior", input.scope),
    beliefEntryCount,
    beliefFlexibleAlternativeCount: countOwnedRows(
      "belief_entries",
      "belief_entry",
      input.scope,
      "TRIM(COALESCE(t.flexible_alternative, '')) <> ''"
    ),
    questionnaireRunCount: countRowsByUser(
      "questionnaire_runs",
      input.scope,
      "status = 'completed' OR completed_at IS NOT NULL"
    ),
    agentActionCount,
    agentCompletedActionCount,
    collaborationRewardCount: positiveRewards.filter(
      (reward) =>
        reward.ruleFamily === "collaboration" ||
        reward.entityType === "insight" ||
        reward.entityType.includes("agent")
    ).length
  };
  const activeCategorySignals = [
    base.nonManualXp > 0,
    base.longestStreakDays > 0,
    base.taskCompletionCount > 0,
    base.goalLinkedTaskCompletionCount > 0 || base.projectLinkedTaskCompletionCount > 0,
    base.habitAlignedCount > 0,
    base.psycheValueCount > 0 ||
      base.modeProfileCount > 0 ||
      base.triggerReportCount > 0 ||
      base.behaviorPatternCount > 0 ||
      base.beliefEntryCount > 0,
    base.wikiPageCount > 0 || base.noteCount > 0 || base.wikiLinkCount > 0,
    base.lifeForceSnapshotCount > 0 ||
      base.healthSleepSessionCount > 0 ||
      base.workoutSessionCount > 0,
    base.agentActionCount > 0 || base.collaborationRewardCount > 0,
    base.comebackCount > 0
  ];
  return {
    ...base,
    activeCategoryCount: activeCategorySignals.filter(Boolean).length
  };
}

function assetKeyForMascot(
  streakDays: number,
  missedDays: number
): string {
  if (missedDays > 0) {
    return (
      [...GAMIFICATION_STREAK_AWAY_DAY_KEYS]
        .filter(([days]) => missedDays >= days)
        .at(-1)?.[1] ?? "mascot-state-010"
    );
  }
  return (
    [...GAMIFICATION_STREAK_POWER_DAY_KEYS]
      .filter(([days]) => streakDays >= days)
      .at(-1)?.[1] ?? "mascot-state-017"
  );
}

function spriteKeyForMascotPose(
  pose: "idle" | "forging" | "wise" | "celebration",
  _equipment: GamificationEquipment
) {
  if (pose === "celebration") return "mascot-state-020";
  if (pose === "forging") return "mascot-state-016";
  if (pose === "idle") return "mascot-state-013";
  return "mascot-state-014";
}

function buildMascotState(input: {
  profile: GamificationProfile;
  equipment: GamificationEquipment;
  missedDays: number;
  lastActiveDateKey: string | null;
}): GamificationMascotState {
  if (input.missedDays >= 7) {
    return {
      mood: "absent",
      spriteKey: assetKeyForMascot(input.profile.streakDays, input.missedDays),
      streakSpriteKey: assetKeyForMascot(input.profile.streakDays, input.missedDays),
      headline: "The forge is cooling.",
      line:
        input.missedDays >= 14
          ? "You left the steel alone long enough for rust to start talking. One honest strike fixes the direction."
          : "Do not negotiate with drift. One real completion relights the room.",
      pressureLevel: Math.min(5, Math.ceil(input.missedDays / 7)),
      missedDays: input.missedDays,
      lastActiveDateKey: input.lastActiveDateKey
    };
  }
  if (input.missedDays >= 3) {
    return {
      mood: "pressure",
      spriteKey: assetKeyForMascot(input.profile.streakDays, input.missedDays),
      streakSpriteKey: assetKeyForMascot(input.profile.streakDays, input.missedDays),
      headline: "The anvil is going quiet.",
      line: "This is the dangerous middle: not gone, not back. Make one real mark today.",
      pressureLevel: 3,
      missedDays: input.missedDays,
      lastActiveDateKey: input.lastActiveDateKey
    };
  }
  if (input.missedDays > 0) {
    return {
      mood: "comeback",
      spriteKey: assetKeyForMascot(input.profile.streakDays, input.missedDays),
      streakSpriteKey: assetKeyForMascot(input.profile.streakDays, input.missedDays),
      headline: "Repair window open.",
      line: "The streak cracked. Pick up the hammer before the crack becomes the story.",
      pressureLevel: 2,
      missedDays: input.missedDays,
      lastActiveDateKey: input.lastActiveDateKey
    };
  }
  if (input.profile.streakDays >= 30 || input.profile.momentumScore >= 80) {
    return {
      mood: "celebrating",
      spriteKey: spriteKeyForMascotPose("celebration", input.equipment),
      streakSpriteKey: assetKeyForMascot(input.profile.streakDays, 0),
      headline: "The forge is loud.",
      line: "Good. Keep swinging while the metal is already hot.",
      pressureLevel: 0,
      missedDays: 0,
      lastActiveDateKey: input.lastActiveDateKey
    };
  }
  if (input.profile.streakDays >= 7) {
    return {
      mood: "forging",
      spriteKey: spriteKeyForMascotPose("forging", input.equipment),
      streakSpriteKey: assetKeyForMascot(input.profile.streakDays, 0),
      headline: "A real streak is forming.",
      line: "Seven days changes the temperature. Now make it expensive to break.",
      pressureLevel: 0,
      missedDays: 0,
      lastActiveDateKey: input.lastActiveDateKey
    };
  }
  return {
    mood: "wise",
    spriteKey: spriteKeyForMascotPose("wise", input.equipment),
    streakSpriteKey: assetKeyForMascot(input.profile.streakDays, 0),
    headline: "Small heat still counts.",
    line: "The first duty is not glory. It is returning to the anvil today.",
    pressureLevel: 0,
    missedDays: 0,
    lastActiveDateKey: input.lastActiveDateKey
  };
}

type RequirementEvaluation = {
  met: boolean;
  current: number;
  target: number;
  percent: number;
  sourceMetric: GamificationMetricKey;
};

function evaluateRequirement(
  requirement: GamificationRequirement,
  metricValues: CatalogMetricValues
): RequirementEvaluation {
  if ("metric" in requirement) {
    const current = Math.max(
      0,
      Math.trunc(metricValues[requirement.metric] ?? 0)
    );
    const target = Math.max(1, Math.trunc(requirement.threshold));
    return {
      met: current >= target,
      current,
      target,
      percent: Math.max(0, Math.min(100, Math.round((current / target) * 100))),
      sourceMetric: requirement.metric
    };
  }
  if ("allOf" in requirement) {
    const children = requirement.allOf.map((child) =>
      evaluateRequirement(child, metricValues)
    );
    const target = Math.max(
      1,
      children.reduce((sum, child) => sum + child.target, 0)
    );
    const current = children.reduce(
      (sum, child) => sum + Math.min(child.current, child.target),
      0
    );
    return {
      met: children.every((child) => child.met),
      current,
      target,
      percent: Math.max(
        0,
        Math.min(
          100,
          Math.round(
            children.reduce((sum, child) => sum + child.percent, 0) /
              Math.max(1, children.length)
          )
        )
      ),
      sourceMetric: children[0]?.sourceMetric ?? "totalXp"
    };
  }
  const children = requirement.anyOf.map((child) =>
    evaluateRequirement(child, metricValues)
  );
  const best =
    [...children].sort((left, right) => right.percent - left.percent)[0] ??
    ({
      met: false,
      current: 0,
      target: 1,
      percent: 0,
      sourceMetric: "totalXp"
    } satisfies RequirementEvaluation);
  return {
    ...best,
    met: children.some((child) => child.met)
  };
}

function evaluateCatalogItem(
  item: GamificationCatalogItem,
  metricValues: CatalogMetricValues
): RequirementEvaluation {
  return evaluateRequirement(item.requirement, metricValues);
}

function syncCatalog(input: {
  scope: GamificationScope;
  profile: GamificationProfile;
  metricValues: CatalogMetricValues;
  equipment: GamificationEquipment;
  mascot: GamificationMascotState;
  now: Date;
}): GamificationCatalogPayload {
  const userId = input.scope.userIds[0] ?? "aggregate";
  const nowIso = input.now.toISOString();
  const catalogItemIds = new Set(GAMIFICATION_CATALOG.map((item) => item.id));
  const existingUnlocks = listGamificationUnlocks(userId).filter((unlock) =>
    catalogItemIds.has(unlock.itemId)
  );
  const isInitialBackfill = existingUnlocks.length === 0;
  for (const item of GAMIFICATION_CATALOG) {
    const evaluation = evaluateCatalogItem(item, input.metricValues);
    if (evaluation.met) {
      const inserted = insertGamificationUnlock({
        userId,
        itemId: item.id,
        unlockedAt: nowIso,
        sourceMetric: evaluation.sourceMetric,
        sourceValue: evaluation.current,
        celebrationSeenAt: isInitialBackfill ? nowIso : null
      });
      if (inserted && !isInitialBackfill) {
        enqueueGamificationCelebration({
          id: `gce_${userId}_${item.id}`,
          userId,
          kind: item.kind,
          itemId: item.id,
          title: item.title,
          summary: item.reward,
          assetKey: item.assetKey,
          metadata: {
            tier: item.tier,
            category: item.category,
            metric: evaluation.sourceMetric,
            value: evaluation.current
          },
          createdAt: nowIso
        });
      }
    }
  }
  if (input.profile.level > 1) {
    enqueueGamificationCelebration({
      id: `gce_${userId}_level_${input.profile.level}`,
      userId,
      kind: "level",
      itemId: null,
      title: `Level ${input.profile.level}`,
      summary: "The Forge Smith acknowledges the stronger heat.",
      assetKey: "mascot-state-020",
      metadata: {
        level: input.profile.level,
        totalXp: input.profile.totalXp
      },
      createdAt: nowIso
    });
  }
  if (input.mascot.missedDays > 0) {
    enqueueGamificationCelebration({
      id: `gce_${userId}_comeback_pressure_${input.mascot.lastActiveDateKey ?? "none"}`,
      userId,
      kind: "comeback",
      itemId: null,
      title: "The forge is waiting",
      summary: input.mascot.line,
      assetKey: input.mascot.streakSpriteKey,
      metadata: {
        missedDays: input.mascot.missedDays
      },
      createdAt: nowIso
    });
  }

  const unlocksByItemId = new Map(
    listGamificationUnlocks(userId)
      .filter((unlock) => catalogItemIds.has(unlock.itemId))
      .map((unlock) => [unlock.itemId, unlock])
  );
  const entries: GamificationCatalogEntry[] = GAMIFICATION_CATALOG.map((item) => {
    const evaluation = evaluateCatalogItem(item, input.metricValues);
    const unlock = unlocksByItemId.get(item.id);
    return {
      ...item,
      unlocked: Boolean(unlock),
      unlockedAt: unlock?.unlockedAt ?? null,
      progressCurrent: Math.max(0, Math.min(evaluation.current, evaluation.target)),
      progressTarget: evaluation.target,
      progressPercent: evaluation.percent,
      celebrationSeenAt: unlock?.celebrationSeenAt ?? null
    };
  });
  const newestUnlock =
    entries
      .filter((entry) => entry.unlocked && entry.unlockedAt)
      .sort(
        (left, right) =>
          Date.parse(right.unlockedAt ?? "") - Date.parse(left.unlockedAt ?? "")
      )[0] ?? null;
  const nextUnlock =
    entries
      .filter((entry) => !entry.unlocked)
      .sort((left, right) => {
        if (right.progressPercent !== left.progressPercent) {
          return right.progressPercent - left.progressPercent;
        }
        return left.sortOrder - right.sortOrder;
      })[0] ?? null;
  const nextTargets = entries
    .filter((entry) => !entry.unlocked)
    .sort((left, right) => {
      if (right.progressPercent !== left.progressPercent) {
        return right.progressPercent - left.progressPercent;
      }
      return left.sortOrder - right.sortOrder;
    })
    .slice(0, 3);
  const recentlyUnlocked = entries
    .filter((entry) => entry.unlocked && entry.unlockedAt)
    .sort(
      (left, right) =>
        Date.parse(right.unlockedAt ?? "") - Date.parse(left.unlockedAt ?? "")
    )
    .slice(0, 8);
  return gamificationCatalogPayloadSchema.parse({
    scope: input.scope,
    equipment: input.equipment,
    items: entries,
    totalCount: entries.length,
    unlockedCount: entries.filter((entry) => entry.unlocked).length,
    trophyCount: entries.filter((entry) => entry.kind === "trophy").length,
    unlockCount: entries.filter((entry) => entry.kind === "unlock").length,
    nextUnlock,
    newestUnlock,
    nextTargets,
    recentlyUnlocked
  });
}

function buildGamificationState(
  goals: Goal[],
  tasks: Task[],
  habits: Habit[],
  options: { userIds?: string[]; now?: Date } = {}
) {
  const now = options.now ?? new Date();
  const scope = resolveGamificationScope(options.userIds);
  const scopedRewards = loadScopedRewardEvents(scope);
  const timezone = resolveTimezone();
  const primaryUserId = scope.userIds[0] ?? "aggregate";
  const dailyActivity = syncDailyActivity(primaryUserId, scopedRewards, timezone);
  const activeDateKeys = dailyActivity.map((row) => row.dateKey);
  const activeDateSet = new Set(activeDateKeys);
  const streakDays = calculateStreakFromActivity(activeDateSet, now, timezone);
  const { missedDays, lastActiveDateKey } = calculateMissedDays(
    activeDateKeys,
    now,
    timezone
  );
  const weekStart = startOfWeek(now).toISOString();
  const totalXp = Math.max(
    0,
    scopedRewards.reduce((sum, event) => sum + event.deltaXp, 0)
  );
  const weeklyXp = Math.max(
    0,
    scopedRewards
      .filter((event) => event.createdAt >= weekStart)
      .reduce((sum, event) => sum + event.deltaXp, 0)
  );
  const doneTasks = tasks.filter((task) => task.status === "done");
  const focusTasks = tasks.filter(
    (task) => task.status === "focus" || task.status === "in_progress"
  ).length;
  const overdueTasks = tasks.filter(
    (task) =>
      task.status !== "done" &&
      task.dueDate !== null &&
      task.dueDate < now.toISOString().slice(0, 10)
  ).length;
  const dueHabits = habits.filter((habit) => habit.dueToday).length;
  const alignedHabitCheckIns = habits.flatMap((habit) =>
    habit.checkIns.filter((checkIn) => isAlignedHabitCheckIn(habit, checkIn))
  );
  const habitMomentum = habits.reduce(
    (sum, habit) => sum + habit.streakCount * 3 + (habit.dueToday ? -4 : 2),
    0
  );
  const alignedDonePoints = doneTasks
    .filter((task) => task.goalId !== null && task.tagIds.length > 0)
    .reduce((sum, task) => sum + task.points, 0);
  const levelState = calculateLevel(totalXp);
  const goalScores = goals
    .map((goal) => ({
      goalId: goal.id,
      goalTitle: goal.title,
      earnedXp: doneTasks
        .filter((task) => task.goalId === goal.id)
        .reduce((sum, task) => sum + task.points, 0)
    }))
    .sort((left, right) => right.earnedXp - left.earnedXp);
  const topGoal = goalScores.find((goal) => goal.earnedXp > 0) ?? null;
  const profile = gamificationProfileSchema.parse({
    totalXp,
    ...levelState,
    weeklyXp,
    streakDays,
    comboMultiplier: Number((1 + Math.min(0.75, streakDays * 0.05)).toFixed(2)),
    momentumScore: Math.max(
      0,
      Math.min(
        100,
        Math.round(
          weeklyXp / 6 +
            alignedDonePoints / 20 +
            focusTasks * 5 +
            alignedHabitCheckIns.length * 4 +
            habitMomentum -
            overdueTasks * 9 -
            dueHabits * 3
        )
      )
    ),
    topGoalId: topGoal?.goalId ?? null,
    topGoalTitle: topGoal?.goalTitle ?? null
  });
  const equipment = getGamificationEquipment(primaryUserId);
  const metricValues = buildMetricValues({
    scope,
    profile,
    scopedRewards,
    tasks,
    habits,
    activeDateKeys
  });
  const mascot = buildMascotState({
    profile,
    equipment,
    missedDays,
    lastActiveDateKey
  });
  const catalog = syncCatalog({
    scope,
    profile,
    metricValues,
    equipment,
    mascot,
    now
  });
  return {
    scope,
    scopedRewards,
    profile,
    metricValues,
    equipment,
    mascot,
    catalog
  };
}

export function buildGamificationProfile(
  goals: Goal[],
  tasks: Task[],
  habits: Habit[],
  now = new Date(),
  options: { userIds?: string[] } = {}
): GamificationProfile {
  return buildGamificationState(goals, tasks, habits, {
    userIds: options.userIds,
    now
  }).profile;
}

export function buildAchievementSignals(
  goals: Goal[],
  tasks: Task[],
  habits: Habit[],
  now = new Date(),
  options: { userIds?: string[] } = {}
): AchievementSignal[] {
  const state = buildGamificationState(goals, tasks, habits, {
    userIds: options.userIds,
    now
  });
  const profile = state.profile;
  const doneTasks = tasks.filter((task) => task.status === "done");
  const alignedDoneTasks = doneTasks.filter(
    (task) => task.goalId !== null && task.tagIds.length > 0
  );
  const focusTasks = tasks.filter(
    (task) => task.status === "focus" || task.status === "in_progress"
  );
  const highValueGoals = goals.filter((goal) =>
    doneTasks.some((task) => task.goalId === goal.id)
  );
  const alignedHabitCount = habits.reduce(
    (sum, habit) =>
      sum +
      habit.checkIns.filter((checkIn) =>
        isAlignedHabitCheckIn(habit, checkIn)
      ).length,
    0
  );
  const topHabitStreak = Math.max(0, ...habits.map((habit) => habit.streakCount));
  const latestHabitWin = latestAlignedHabitAt(habits);

  return [
    {
      id: "streak-operator",
      title: "Streak Operator",
      summary: "Maintain consecutive days of meaningful completions.",
      tier: profile.streakDays >= 7 ? "gold" : "silver",
      progressLabel: `${Math.min(profile.streakDays, 7)}/7 days`,
      unlocked: profile.streakDays >= 7,
      unlockedAt:
        profile.streakDays >= 7 ? latestCompletionForTasks(doneTasks) : null
    },
    {
      id: "aligned-maker",
      title: "Aligned Maker",
      summary: "Complete work that is explicitly tied to a goal and tagged context.",
      tier: alignedDoneTasks.length >= 5 ? "gold" : "bronze",
      progressLabel: `${Math.min(alignedDoneTasks.length, 5)}/5 aligned completions`,
      unlocked: alignedDoneTasks.length >= 5,
      unlockedAt:
        alignedDoneTasks.length >= 5
          ? latestCompletionForTasks(alignedDoneTasks)
          : null
    },
    {
      id: "momentum-engine",
      title: "Momentum Engine",
      summary: "Push weekly XP high enough that momentum becomes visible.",
      tier:
        profile.weeklyXp >= 240
          ? "gold"
          : profile.weeklyXp >= 120
            ? "silver"
            : "bronze",
      progressLabel: `${Math.min(profile.weeklyXp, 240)}/240 weekly xp`,
      unlocked: profile.weeklyXp >= 240,
      unlockedAt:
        profile.weeklyXp >= 240 ? latestCompletionForTasks(doneTasks) : null
    },
    {
      id: "path-keeper",
      title: "Path Keeper",
      summary: "Keep multiple life arcs alive instead of overfitting one lane.",
      tier: highValueGoals.length >= 3 ? "platinum" : "silver",
      progressLabel: `${Math.min(highValueGoals.length, 3)}/3 active arcs with wins`,
      unlocked: highValueGoals.length >= 3,
      unlockedAt:
        highValueGoals.length >= 3 ? latestCompletionForTasks(doneTasks) : null
    },
    {
      id: "focus-lane",
      title: "Focus Lane Live",
      summary: "Sustain a protected execution lane instead of browsing a backlog.",
      tier: focusTasks.length > 0 ? "silver" : "bronze",
      progressLabel: `${Math.min(focusTasks.length, 1)}/1 live directives`,
      unlocked: focusTasks.length > 0,
      unlockedAt: focusTasks.length > 0 ? now.toISOString() : null
    },
    {
      id: "habit-keeper",
      title: "Habit Keeper",
      summary: "Turn recurring behavior into visible operating evidence.",
      tier:
        alignedHabitCount >= 12
          ? "gold"
          : alignedHabitCount >= 6
            ? "silver"
            : "bronze",
      progressLabel: `${Math.min(alignedHabitCount, 12)}/12 aligned habit wins`,
      unlocked: alignedHabitCount >= 12,
      unlockedAt: alignedHabitCount >= 12 ? latestHabitWin : null
    },
    {
      id: "ritual-pressure",
      title: "Ritual Pressure",
      summary: "Keep one habit alive long enough that it changes the texture of the week.",
      tier: topHabitStreak >= 10 ? "gold" : "silver",
      progressLabel: `${Math.min(topHabitStreak, 10)}/10 habit streak`,
      unlocked: topHabitStreak >= 10,
      unlockedAt: topHabitStreak >= 10 ? latestHabitWin : null
    }
  ].map((achievement) => achievementSignalSchema.parse(achievement));
}

export function buildMilestoneRewards(
  goals: Goal[],
  tasks: Task[],
  habits: Habit[],
  now = new Date(),
  options: { userIds?: string[] } = {}
): MilestoneReward[] {
  const profile = buildGamificationProfile(goals, tasks, habits, now, options);
  const doneTasks = tasks.filter((task) => task.status === "done");
  const topGoal = profile.topGoalId
    ? goals.find((goal) => goal.id === profile.topGoalId) ?? null
    : null;
  const topGoalXp = topGoal
    ? doneTasks
        .filter((task) => task.goalId === topGoal.id)
        .reduce((sum, task) => sum + task.points, 0)
    : 0;
  const completedToday = doneTasks.filter(
    (task) => task.completedAt?.slice(0, 10) === now.toISOString().slice(0, 10)
  ).length;
  const alignedHabitCount = habits.reduce(
    (sum, habit) =>
      sum +
      habit.checkIns.filter((checkIn) =>
        isAlignedHabitCheckIn(habit, checkIn)
      ).length,
    0
  );

  return [
    {
      id: "next-level",
      title: "Next level threshold",
      summary: "Keep pushing until the next level unlocks a stronger sense of ascent.",
      rewardLabel: `Level ${profile.level + 1}`,
      progressLabel: `${profile.currentLevelXp}/${profile.nextLevelXp} xp`,
      current: profile.currentLevelXp,
      target: profile.nextLevelXp,
      completed: profile.xpToNextLevel === 0
    },
    {
      id: "weekly-sprint",
      title: "Weekly sprint heat",
      summary: "Cross the weekly XP line that keeps the system feeling alive.",
      rewardLabel: "Momentum bonus",
      progressLabel: `${Math.min(profile.weeklyXp, 240)}/240 weekly xp`,
      current: profile.weeklyXp,
      target: 240,
      completed: profile.weeklyXp >= 240
    },
    {
      id: "daily-mass",
      title: "Daily mass threshold",
      summary: "Make the day feel consequential with multiple completed tasks.",
      rewardLabel: "Quest chest +90 xp",
      progressLabel: `${Math.min(completedToday, 3)}/3 completions today`,
      current: completedToday,
      target: 3,
      completed: completedToday >= 3
    },
    {
      id: "goal-project",
      title: "Project reward track",
      summary: topGoal
        ? `Keep advancing the leading life goal through a concrete project path.`
        : "No leading life goal is established yet.",
      rewardLabel: topGoal ? `${topGoal.title} milestone` : "Establish a lead goal",
      progressLabel: topGoal
        ? `${Math.min(topGoalXp, topGoal.targetPoints)}/${topGoal.targetPoints} goal xp`
        : "0/1 lead arcs",
      current: topGoal ? topGoalXp : 0,
      target: topGoal ? topGoal.targetPoints : 1,
      completed: topGoal ? topGoalXp >= topGoal.targetPoints : false
    },
    {
      id: "habit-mass",
      title: "Habit mass threshold",
      summary: "Make recurring behavior part of the same reward engine as tasks and projects.",
      rewardLabel: "Consistency cache +75 xp",
      progressLabel: `${Math.min(alignedHabitCount, 14)}/14 aligned habit check-ins`,
      current: alignedHabitCount,
      target: 14,
      completed: alignedHabitCount >= 14
    }
  ].map((reward) => milestoneRewardSchema.parse(reward));
}

export function buildXpMomentumPulse(
  goals: Goal[],
  tasks: Task[],
  habits: Habit[],
  now = new Date(),
  options: { userIds?: string[] } = {}
): XpMomentumPulse {
  const profile = buildGamificationProfile(goals, tasks, habits, now, options);
  const achievements = buildAchievementSignals(goals, tasks, habits, now, options);
  const milestoneRewards = buildMilestoneRewards(goals, tasks, habits, now, options);
  const nextMilestone =
    milestoneRewards.find((reward) => !reward.completed) ??
    milestoneRewards[0] ??
    null;
  const unlockedAchievements = achievements.filter(
    (achievement) => achievement.unlocked
  ).length;
  const status: XpMomentumPulse["status"] =
    profile.momentumScore >= 80
      ? "surging"
      : profile.momentumScore >= 60
        ? "steady"
        : "recovering";
  const headline =
    status === "surging"
      ? `${profile.streakDays}-day streak online. Forge is compounding.`
      : status === "steady"
        ? `Momentum is stable. One sharp push keeps the engine hot.`
        : `Recovery window open. A small real win will restart the climb.`;
  const detail =
    nextMilestone !== null
      ? `${nextMilestone.title} is the clean next unlock. ${nextMilestone.progressLabel}.`
      : `Level ${profile.level} is active with ${profile.weeklyXp} weekly XP already recorded.`;
  const celebrationLabel =
    unlockedAchievements > 0
      ? `${unlockedAchievements} achievement${unlockedAchievements === 1 ? "" : "s"} unlocked`
      : profile.weeklyXp >= 120
        ? `Weekly sprint heat is building`
        : `Next celebration comes from a real completion or repair`;
  return {
    status,
    headline,
    detail,
    celebrationLabel,
    nextMilestoneId: nextMilestone?.id ?? null,
    nextMilestoneLabel:
      nextMilestone?.rewardLabel ?? "Keep building visible momentum"
  };
}

export function buildGamificationCatalogPayload(
  goals: Goal[],
  tasks: Task[],
  habits: Habit[],
  options: { userIds?: string[]; now?: Date } = {}
): GamificationCatalogPayload {
  return buildGamificationState(goals, tasks, habits, options).catalog;
}

export class LockedGamificationCosmeticError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockedGamificationCosmeticError";
  }
}

const EQUIPMENT_UNLOCK_FIELDS = [
  {
    equipmentKey: "selectedMascotSkin",
    unlockType: "mascot_skin",
    payloadKey: "mascotSkin"
  },
  {
    equipmentKey: "selectedHudTreatment",
    unlockType: "hud_treatment",
    payloadKey: "hudTreatment"
  },
  {
    equipmentKey: "selectedStreakEffect",
    unlockType: "streak_effect",
    payloadKey: "streakEffect"
  },
  {
    equipmentKey: "selectedTrophyShelf",
    unlockType: "trophy_shelf",
    payloadKey: "trophyShelf"
  },
  {
    equipmentKey: "selectedCelebrationVariant",
    unlockType: "celebration_variant",
    payloadKey: "celebrationVariant"
  }
] as const;

export function updateGamificationEquipmentSelection(input: {
  goals: Goal[];
  tasks: Task[];
  habits: Habit[];
  userIds?: string[];
  equipment: Partial<Omit<GamificationEquipment, "updatedAt">>;
}) {
  const state = buildGamificationState(input.goals, input.tasks, input.habits, {
    userIds: input.userIds
  });
  const userId = state.scope.userIds[0];
  if (!userId) {
    throw new LockedGamificationCosmeticError(
      "Equipment can only be changed for a concrete Forge user."
    );
  }
  for (const field of EQUIPMENT_UNLOCK_FIELDS) {
    const requested = input.equipment[field.equipmentKey];
    if (requested === undefined || requested === null) {
      continue;
    }
    const unlocked = state.catalog.items.some(
      (item) =>
        item.kind === "unlock" &&
        item.unlocked &&
        item.unlockType === field.unlockType &&
        item.rewardPayload[field.payloadKey] === requested
    );
    if (!unlocked) {
      throw new LockedGamificationCosmeticError(
        `The ${requested} cosmetic is still locked.`
      );
    }
  }
  return upsertGamificationEquipment(userId, input.equipment);
}

export function buildGamificationOverview(
  goals: Goal[],
  tasks: Task[],
  habits: Habit[],
  now = new Date(),
  options: { userIds?: string[] } = {}
) {
  return {
    profile: buildGamificationProfile(goals, tasks, habits, now, options),
    achievements: buildAchievementSignals(goals, tasks, habits, now, options),
    milestoneRewards: buildMilestoneRewards(goals, tasks, habits, now, options)
  };
}

export function buildXpMetricsPayloadModel(input: {
  goals: Goal[];
  tasks: Task[];
  habits: Habit[];
  userIds?: string[];
}) {
  const now = new Date();
  const state = buildGamificationState(input.goals, input.tasks, input.habits, {
    userIds: input.userIds,
    now
  });
  const rules = listRewardRules();
  const dailyAmbientCap =
    rules
      .filter((rule) => rule.family === "ambient")
      .reduce(
        (max, rule) => Math.max(max, Number(rule.config.dailyCap ?? 0)),
        0
      ) || 12;
  const achievements = buildAchievementSignals(
    input.goals,
    input.tasks,
    input.habits,
    now,
    { userIds: input.userIds }
  );
  const milestoneRewards = buildMilestoneRewards(
    input.goals,
    input.tasks,
    input.habits,
    now,
    { userIds: input.userIds }
  );
  const visibleCatalog = [
    ...(state.catalog.newestUnlock ? [state.catalog.newestUnlock] : []),
    ...(state.catalog.nextUnlock ? [state.catalog.nextUnlock] : []),
    ...state.catalog.items
      .filter((item) => item.unlocked)
      .sort(
        (left, right) =>
          Date.parse(right.unlockedAt ?? "") - Date.parse(left.unlockedAt ?? "")
      )
      .slice(0, 4)
  ];
  const uniquePreview = [...new Map(visibleCatalog.map((item) => [item.id, item])).values()].slice(0, 6);
  return {
    scope: state.scope,
    profile: state.profile,
    achievements,
    milestoneRewards,
    momentumPulse: buildXpMomentumPulse(
      input.goals,
      input.tasks,
      input.habits,
      now,
      { userIds: input.userIds }
    ),
    catalogPreview: uniquePreview,
    unlockedItemCount: state.catalog.unlockedCount,
    totalItemCount: state.catalog.totalCount,
    nextUnlock: state.catalog.nextUnlock,
    newestUnlock: state.catalog.newestUnlock,
    nextTargets: state.catalog.nextTargets,
    equipment: state.equipment,
    mascot: state.mascot,
    celebrations: listUnseenGamificationCelebrations(
      state.scope.userIds[0] ?? "aggregate",
      5
    ),
    recentLedger: state.scopedRewards
      .slice(-25)
      .reverse()
      .map(({ ownerUserId: _ownerUserId, ruleCode: _ruleCode, ruleFamily: _ruleFamily, ...event }) => event),
    rules,
    dailyAmbientXp: getDailyAmbientXp(new Date().toISOString().slice(0, 10)),
    dailyAmbientCap
  };
}
