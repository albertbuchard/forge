import { randomUUID } from "node:crypto";
import { getDatabase } from "../db.js";
import { recordEventLog } from "./event-log.js";
import { createManualRewardGrantSchema, workAdjustmentEntityTypeSchema, rewardLedgerEventSchema, rewardRuleSchema, sessionEventSchema, updateRewardRuleSchema } from "../types.js";
const DEFAULT_RULES = [
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
        description: "Award a small XP bounty for each ten credited minutes of active work.",
        config: { fixedXp: 4, intervalMinutes: 10 }
    },
    {
        id: "reward_rule_task_run_completion",
        family: "completion",
        code: "task_run_completion",
        title: "Focused run completion",
        description: "Award a small bonus when a claimed execution run is completed cleanly.",
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
        description: "Award XP when a habit outcome matches the intended direction.",
        config: { award: "habit.rewardXp" }
    },
    {
        id: "reward_rule_habit_misaligned",
        family: "recovery",
        code: "habit_misaligned",
        title: "Habit miss",
        description: "Apply a small XP penalty when a habit outcome moves against the intended direction.",
        config: { penalty: "habit.penaltyXp" }
    },
    {
        id: "reward_rule_psyche_reflection_capture",
        family: "alignment",
        code: "psyche_reflection_capture",
        title: "Functional analysis captured",
        description: "Reward a completed therapeutic reflection capture in a bounded, explainable way.",
        config: { fixedXp: 8 }
    },
    {
        id: "reward_rule_psyche_value_defined",
        family: "alignment",
        code: "psyche_value_defined",
        title: "Value clarified",
        description: "Reward the user for naming a value in concrete life language.",
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
        description: "Reward mapping an away, committed, or recovery move clearly enough to work with it later.",
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
        description: "Reward giving a recurring mode enough shape to recognize it later.",
        config: { fixedXp: 4 }
    },
    {
        id: "reward_rule_weekly_review_completed",
        family: "alignment",
        code: "weekly_review_completed",
        title: "Weekly review completed",
        description: "Reward closing the current weekly review cycle and turning it into explicit evidence.",
        config: { fixedXp: 250 }
    },
    {
        id: "reward_rule_session_dwell",
        family: "ambient",
        code: "session_dwell_120",
        title: "Active dwell milestone",
        description: "Award a small amount of XP for sustained focused presence in the app.",
        config: { fixedXp: 2, dailyCap: 12 }
    },
    {
        id: "reward_rule_scroll_depth",
        family: "ambient",
        code: "scroll_depth_75",
        title: "Review depth milestone",
        description: "Award a bounded ambient nudge when the user actively explores the product deeply.",
        config: { fixedXp: 3, dailyCap: 12 }
    }
];
function mapRule(row) {
    return rewardRuleSchema.parse({
        id: row.id,
        family: row.family,
        code: row.code,
        title: row.title,
        description: row.description,
        active: row.active === 1,
        config: JSON.parse(row.config_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
function mapLedger(row) {
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
        metadata: JSON.parse(row.metadata_json),
        createdAt: row.created_at
    });
}
function mapSession(row) {
    return sessionEventSchema.parse({
        id: row.id,
        sessionId: row.session_id,
        eventType: row.event_type,
        actor: row.actor,
        source: row.source,
        metrics: JSON.parse(row.metrics_json),
        createdAt: row.created_at
    });
}
export function ensureDefaultRewardRules(now = new Date().toISOString()) {
    const insert = getDatabase().prepare(`INSERT OR IGNORE INTO reward_rules (id, family, code, title, description, active, config_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`);
    for (const rule of DEFAULT_RULES) {
        insert.run(rule.id, rule.family, rule.code, rule.title, rule.description, JSON.stringify(rule.config), now, now);
    }
}
export function listRewardRules() {
    ensureDefaultRewardRules();
    const rows = getDatabase()
        .prepare(`SELECT id, family, code, title, description, active, config_json, created_at, updated_at
       FROM reward_rules
       ORDER BY family, created_at`)
        .all();
    return rows.map(mapRule);
}
export function getRewardRuleById(ruleId) {
    ensureDefaultRewardRules();
    const row = getDatabase()
        .prepare(`SELECT id, family, code, title, description, active, config_json, created_at, updated_at
       FROM reward_rules
       WHERE id = ?`)
        .get(ruleId);
    return row ? mapRule(row) : undefined;
}
function getRuleByCode(code) {
    return listRewardRules().find((rule) => rule.code === code);
}
export function getTaskRunProgressRewardCadence() {
    ensureDefaultRewardRules();
    const rule = getRuleByCode("task_run_progress");
    const intervalMinutes = Math.max(1, Number(rule?.config.intervalMinutes ?? 10));
    return {
        rule,
        intervalMinutes,
        intervalSeconds: intervalMinutes * 60,
        fixedXp: Number(rule?.config.fixedXp ?? 4)
    };
}
export function updateRewardRule(ruleId, input, activity) {
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
        .prepare(`UPDATE reward_rules
       SET title = ?, description = ?, active = ?, config_json = ?, updated_at = ?
       WHERE id = ?`)
        .run(next.title, next.description, next.active ? 1 : 0, JSON.stringify(next.config), next.updatedAt, ruleId);
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
function insertLedgerEvent(input, now = new Date()) {
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
        metadata: input.metadata ?? {},
        createdAt: now.toISOString()
    });
    getDatabase()
        .prepare(`INSERT INTO reward_ledger (
        id, rule_id, event_log_id, entity_type, entity_id, actor, source, delta_xp, reason_title, reason_summary,
        reversible_group, reversed_by_reward_id, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
        .run(event.id, event.ruleId, event.eventLogId, event.entityType, event.entityId, event.actor, event.source, event.deltaXp, event.reasonTitle, event.reasonSummary, event.reversibleGroup, JSON.stringify(event.metadata), event.createdAt);
    return event;
}
export function listRewardLedger(filters = {}) {
    ensureDefaultRewardRules();
    const whereClauses = [];
    const params = [];
    if (filters.entityType) {
        whereClauses.push("entity_type = ?");
        params.push(filters.entityType);
    }
    if (filters.entityId) {
        whereClauses.push("entity_id = ?");
        params.push(filters.entityId);
    }
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const limitSql = filters.limit ? "LIMIT ?" : "";
    if (filters.limit) {
        params.push(filters.limit);
    }
    const rows = getDatabase()
        .prepare(`SELECT
         id, rule_id, event_log_id, entity_type, entity_id, actor, source, delta_xp, reason_title, reason_summary,
         reversible_group, reversed_by_reward_id, metadata_json, created_at
       FROM reward_ledger
       ${whereSql}
       ORDER BY created_at DESC
       ${limitSql}`)
        .all(...params);
    return rows.map(mapLedger);
}
export function getRewardLedgerEventById(rewardId) {
    ensureDefaultRewardRules();
    const row = getDatabase()
        .prepare(`SELECT
         id, rule_id, event_log_id, entity_type, entity_id, actor, source, delta_xp, reason_title, reason_summary,
         reversible_group, reversed_by_reward_id, metadata_json, created_at
       FROM reward_ledger
       WHERE id = ?`)
        .get(rewardId);
    return row ? mapLedger(row) : null;
}
export function getTotalXp() {
    ensureDefaultRewardRules();
    const row = getDatabase().prepare(`SELECT COALESCE(SUM(delta_xp), 0) AS total FROM reward_ledger`).get();
    return row.total;
}
export function getWeeklyXp(weekStartIso) {
    ensureDefaultRewardRules();
    const row = getDatabase()
        .prepare(`SELECT COALESCE(SUM(delta_xp), 0) AS total FROM reward_ledger WHERE created_at >= ?`)
        .get(weekStartIso);
    return row.total;
}
export function getDailyAmbientXp(dayKey) {
    ensureDefaultRewardRules();
    const row = getDatabase()
        .prepare(`SELECT COALESCE(SUM(reward_ledger.delta_xp), 0) AS total
       FROM reward_ledger
       JOIN reward_rules ON reward_rules.id = reward_ledger.rule_id
       WHERE reward_rules.family = 'ambient'
         AND reward_ledger.created_at >= ?
         AND reward_ledger.created_at < ?`)
        .get(`${dayKey}T00:00:00.000Z`, `${dayKey}T23:59:59.999Z`);
    return row.total;
}
export function awardTaskCompletionReward(task, activity) {
    ensureDefaultRewardRules();
    const rule = getRuleByCode("task_completion");
    const eventLog = recordEventLog({
        eventKind: "reward.task_completion",
        entityType: "task",
        entityId: task.id,
        actor: activity.actor ?? null,
        source: activity.source,
        metadata: {
            taskId: task.id,
            points: task.points,
            completedAt: task.completedAt ?? ""
        }
    });
    return insertLedgerEvent({
        ruleId: rule?.id ?? null,
        eventLogId: eventLog.id,
        entityType: "task",
        entityId: task.id,
        actor: activity.actor ?? null,
        source: activity.source,
        deltaXp: task.points,
        reasonTitle: `Task completed: ${task.title}`,
        reasonSummary: "Completion XP awarded from the reward engine.",
        reversibleGroup: `task_completion:${task.id}:${task.completedAt ?? eventLog.createdAt}`,
        metadata: {
            taskId: task.id,
            points: task.points
        }
    });
}
export function reverseLatestTaskCompletionReward(task, activity) {
    ensureDefaultRewardRules();
    const latest = getDatabase()
        .prepare(`SELECT
         id, rule_id, event_log_id, entity_type, entity_id, actor, source, delta_xp, reason_title, reason_summary,
         reversible_group, reversed_by_reward_id, metadata_json, created_at
       FROM reward_ledger
       WHERE entity_type = 'task'
         AND entity_id = ?
         AND delta_xp > 0
         AND reversible_group LIKE 'task_completion:%'
         AND reversed_by_reward_id IS NULL
       ORDER BY created_at DESC
       LIMIT 1`)
        .get(task.id);
    if (!latest) {
        return null;
    }
    const reversalEventLog = recordEventLog({
        eventKind: "reward.task_completion_reversed",
        entityType: "task",
        entityId: task.id,
        actor: activity.actor ?? null,
        source: activity.source,
        metadata: {
            rewardId: latest.id,
            taskId: task.id
        }
    });
    const reversal = insertLedgerEvent({
        ruleId: latest.rule_id,
        eventLogId: reversalEventLog.id,
        entityType: latest.entity_type,
        entityId: latest.entity_id,
        actor: activity.actor ?? null,
        source: activity.source,
        deltaXp: -Math.abs(latest.delta_xp),
        reasonTitle: `Task reopened: ${task.title}`,
        reasonSummary: "Completion XP reversed because the task left done.",
        reversibleGroup: latest.reversible_group,
        metadata: {
            reversedRewardId: latest.id,
            taskId: task.id
        }
    });
    getDatabase().prepare(`UPDATE reward_ledger SET reversed_by_reward_id = ? WHERE id = ?`).run(reversal.id, latest.id);
    return reversal;
}
export function recordInsightAppliedReward(insightId, entityType, entityId, activity) {
    ensureDefaultRewardRules();
    const rule = getRuleByCode("insight_applied");
    const eventLog = recordEventLog({
        eventKind: "reward.insight_applied",
        entityType,
        entityId,
        actor: activity.actor ?? null,
        source: activity.source,
        metadata: {
            insightId
        }
    });
    return insertLedgerEvent({
        ruleId: rule?.id ?? null,
        eventLogId: eventLog.id,
        entityType,
        entityId,
        actor: activity.actor ?? null,
        source: activity.source,
        deltaXp: Number(rule?.config.fixedXp ?? 15),
        reasonTitle: "Insight applied",
        reasonSummary: "A structured insight was accepted and marked as applied.",
        reversibleGroup: `insight_applied:${insightId}`,
        metadata: {
            insightId
        }
    });
}
export function recordPsycheReflectionReward(reportId, title, activity) {
    ensureDefaultRewardRules();
    const rule = getRuleByCode("psyche_reflection_capture");
    const eventLog = recordEventLog({
        eventKind: "reward.psyche_reflection_capture",
        entityType: "trigger_report",
        entityId: reportId,
        actor: activity.actor ?? null,
        source: activity.source,
        metadata: {
            triggerReportId: reportId,
            title
        }
    });
    return insertLedgerEvent({
        ruleId: rule?.id ?? null,
        eventLogId: eventLog.id,
        entityType: "trigger_report",
        entityId: reportId,
        actor: activity.actor ?? null,
        source: activity.source,
        deltaXp: Number(rule?.config.fixedXp ?? 8),
        reasonTitle: `Psyche reflection captured: ${title}`,
        reasonSummary: "A structured trigger report was stored and the reflection ledger was updated.",
        reversibleGroup: `psyche_reflection_capture:${reportId}`,
        metadata: {
            triggerReportId: reportId
        }
    });
}
export function recordPsycheClarityReward(entityType, entityId, title, ruleCode, activity) {
    ensureDefaultRewardRules();
    const rule = getRuleByCode(ruleCode);
    const eventLog = recordEventLog({
        eventKind: `reward.${ruleCode}`,
        entityType,
        entityId,
        actor: activity.actor ?? null,
        source: activity.source,
        metadata: {
            entityId,
            entityType,
            title
        }
    });
    return insertLedgerEvent({
        ruleId: rule?.id ?? null,
        eventLogId: eventLog.id,
        entityType,
        entityId,
        actor: activity.actor ?? null,
        source: activity.source,
        deltaXp: Number(rule?.config.fixedXp ?? 4),
        reasonTitle: rule?.title ?? "Psyche clarity gained",
        reasonSummary: rule?.description ?? "A Psyche entity was clarified and stored.",
        reversibleGroup: `${ruleCode}:${entityId}`,
        metadata: {
            entityType,
            title
        }
    });
}
export function recordTaskRunCompletionReward(taskRunId, taskId, actor, source) {
    ensureDefaultRewardRules();
    const rule = getRuleByCode("task_run_completion");
    const eventLog = recordEventLog({
        eventKind: "reward.task_run_completion",
        entityType: "task_run",
        entityId: taskRunId,
        actor,
        source,
        metadata: {
            taskId,
            taskRunId
        }
    });
    return insertLedgerEvent({
        ruleId: rule?.id ?? null,
        eventLogId: eventLog.id,
        entityType: "task_run",
        entityId: taskRunId,
        actor,
        source,
        deltaXp: Number(rule?.config.fixedXp ?? 20),
        reasonTitle: rule?.title ?? "Focused run completion",
        reasonSummary: rule?.description ?? "A claimed execution run was completed.",
        reversibleGroup: `task_run_completion:${taskRunId}`,
        metadata: {
            taskId,
            taskRunId
        }
    });
}
export function recordTaskRunStartReward(taskRunId, taskId, actor, source) {
    ensureDefaultRewardRules();
    const rule = getRuleByCode("task_run_started");
    const eventLog = recordEventLog({
        eventKind: "reward.task_run_started",
        entityType: "task_run",
        entityId: taskRunId,
        actor,
        source,
        metadata: {
            taskId,
            taskRunId
        }
    });
    return insertLedgerEvent({
        ruleId: rule?.id ?? null,
        eventLogId: eventLog.id,
        entityType: "task_run",
        entityId: taskRunId,
        actor,
        source,
        deltaXp: Number(rule?.config.fixedXp ?? 8),
        reasonTitle: rule?.title ?? "Task started",
        reasonSummary: rule?.description ?? "A live work timer was started for a task.",
        reversibleGroup: `task_run_started:${taskRunId}`,
        metadata: {
            taskId,
            taskRunId
        }
    });
}
export function recordTaskRunProgressRewards(taskRunId, taskId, actor, source, creditedSeconds) {
    const { rule, intervalMinutes, intervalSeconds, fixedXp } = getTaskRunProgressRewardCadence();
    const earnedBuckets = Math.floor(Math.max(0, creditedSeconds) / intervalSeconds);
    if (earnedBuckets <= 0) {
        return [];
    }
    const existingCount = getDatabase()
        .prepare(`SELECT COUNT(*) AS count
         FROM reward_ledger
         WHERE entity_type = 'task_run'
           AND entity_id = ?
           AND reversible_group LIKE ?`)
        .get(taskRunId, `task_run_progress:${taskRunId}:%`).count;
    if (existingCount >= earnedBuckets) {
        return [];
    }
    const rewards = [];
    for (let bucketIndex = existingCount + 1; bucketIndex <= earnedBuckets; bucketIndex += 1) {
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
        rewards.push(insertLedgerEvent({
            ruleId: rule?.id ?? null,
            eventLogId: eventLog.id,
            entityType: "task_run",
            entityId: taskRunId,
            actor,
            source,
            deltaXp: fixedXp,
            reasonTitle: rule?.title ?? "Work time bounty",
            reasonSummary: `Awarded after ${creditedMinutes} credited minutes of active work.`,
            reversibleGroup: `task_run_progress:${taskRunId}:${bucketIndex}`,
            metadata: {
                taskId,
                taskRunId,
                bucketIndex,
                creditedMinutes
            }
        }));
    }
    return rewards;
}
export function recordWorkAdjustmentReward(input) {
    const { rule, intervalMinutes, intervalSeconds, fixedXp } = getTaskRunProgressRewardCadence();
    const entityType = workAdjustmentEntityTypeSchema.parse(input.entityType);
    const previousBuckets = Math.floor(Math.max(0, input.previousCreditedSeconds) / intervalSeconds);
    const nextBuckets = Math.floor(Math.max(0, input.nextCreditedSeconds) / intervalSeconds);
    const bucketDelta = nextBuckets - previousBuckets;
    if (bucketDelta === 0) {
        return null;
    }
    const deltaXp = bucketDelta * fixedXp;
    const direction = bucketDelta > 0 ? "added" : "removed";
    const appliedMinutes = Math.abs(input.appliedDeltaMinutes);
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
        reasonTitle: bucketDelta > 0 ? "Manual work minutes added" : "Manual work minutes removed",
        reasonSummary: `${appliedMinutes} manual minute${appliedMinutes === 1 ? "" : "s"} ${direction}, shifting ${Math.abs(bucketDelta)} ${intervalMinutes}-minute reward bucket${Math.abs(bucketDelta) === 1 ? "" : "s"} for ${input.targetTitle}.`,
        reversibleGroup: `work_adjustment:${entityType}:${input.entityId}:${input.adjustmentId}`,
        metadata: {
            adjustmentId: input.adjustmentId,
            requestedDeltaMinutes: input.requestedDeltaMinutes,
            appliedDeltaMinutes: input.appliedDeltaMinutes,
            previousCreditedSeconds: input.previousCreditedSeconds,
            nextCreditedSeconds: input.nextCreditedSeconds,
            bucketDelta,
            intervalMinutes,
            rewardCategory: "manual_work_adjustment"
        }
    });
}
export function recordSessionEvent(input, activity, now = new Date()) {
    ensureDefaultRewardRules();
    const sessionEvent = sessionEventSchema.parse({
        id: `ses_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
        sessionId: input.sessionId,
        eventType: input.eventType,
        actor: activity.actor ?? null,
        source: activity.source,
        metrics: input.metrics,
        createdAt: now.toISOString()
    });
    getDatabase()
        .prepare(`INSERT INTO session_events (id, session_id, event_type, actor, source, metrics_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(sessionEvent.id, sessionEvent.sessionId, sessionEvent.eventType, sessionEvent.actor, sessionEvent.source, JSON.stringify(sessionEvent.metrics), sessionEvent.createdAt);
    recordEventLog({
        eventKind: `session.${sessionEvent.eventType}`,
        entityType: "session",
        entityId: sessionEvent.id,
        actor: sessionEvent.actor,
        source: sessionEvent.source,
        metadata: {
            sessionId: sessionEvent.sessionId
        }
    }, now);
    const day = sessionEvent.createdAt.slice(0, 10);
    const currentAmbientXp = getDailyAmbientXp(day);
    const active = sessionEvent.metrics.visible === true && sessionEvent.metrics.interacted === true;
    const ruleCode = sessionEvent.eventType === "dwell_120_seconds"
        ? "session_dwell_120"
        : sessionEvent.eventType === "scroll_depth_75"
            ? "scroll_depth_75"
            : null;
    const rule = ruleCode ? getRuleByCode(ruleCode) : null;
    const dailyCap = Number(rule?.config.dailyCap ?? 12);
    const awardXp = Number(rule?.config.fixedXp ?? 0);
    if (!rule || !active || currentAmbientXp >= dailyCap) {
        return { sessionEvent, rewardEvent: null };
    }
    const rewardEvent = insertLedgerEvent({
        ruleId: rule.id,
        entityType: "session",
        entityId: sessionEvent.id,
        actor: activity.actor ?? null,
        source: activity.source,
        deltaXp: Math.max(0, Math.min(awardXp, dailyCap - currentAmbientXp)),
        reasonTitle: rule.title,
        reasonSummary: rule.description,
        reversibleGroup: `session:${sessionEvent.id}:${rule.code}`,
        metadata: {
            sessionId: sessionEvent.sessionId,
            eventType: sessionEvent.eventType
        }
    }, now);
    return { sessionEvent, rewardEvent };
}
export function recordHabitCheckInReward(habit, status, dateKey, activity) {
    ensureDefaultRewardRules();
    const aligned = (habit.polarity === "positive" && status === "done") ||
        (habit.polarity === "negative" && status === "missed");
    const rule = getRuleByCode(aligned ? "habit_aligned" : "habit_misaligned");
    const deltaXp = aligned ? habit.rewardXp : -Math.abs(habit.penaltyXp);
    const actionLabel = habit.polarity === "positive"
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
        reasonTitle: aligned ? `${habit.title} aligned` : `${habit.title} slipped`,
        reasonSummary: `Habit ${actionLabel} on ${dateKey}.`,
        reversibleGroup: `habit:${habit.id}:${dateKey}`,
        metadata: {
            habitId: habit.id,
            status,
            polarity: habit.polarity,
            dateKey
        }
    });
}
export function recordHabitGeneratedWorkoutReward(input, activity) {
    ensureDefaultRewardRules();
    if (input.xpReward <= 0) {
        return null;
    }
    const reversibleGroup = `habit_generated_workout:${input.checkInId}`;
    const existing = getDatabase()
        .prepare(`SELECT
         id, rule_id, event_log_id, entity_type, entity_id, actor, source, delta_xp, reason_title, reason_summary,
         reversible_group, reversed_by_reward_id, metadata_json, created_at
       FROM reward_ledger
       WHERE reversible_group = ?
       LIMIT 1`)
        .get(reversibleGroup);
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
            rewardCategory: "habit_generated_workout"
        }
    });
}
export function recordWeeklyReviewCompletionReward(input, activity) {
    ensureDefaultRewardRules();
    const rule = getRuleByCode("weekly_review_completed");
    const deltaXp = Math.max(0, Number(rule?.config.fixedXp ?? input.rewardXp));
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
        reasonSummary: `Closed the review for ${input.windowLabel}.`,
        reversibleGroup: `weekly_review_completed:${input.weekKey}`,
        metadata: {
            weekKey: input.weekKey,
            windowLabel: input.windowLabel
        }
    });
}
export function listSessionEvents(limit = 50) {
    const rows = getDatabase()
        .prepare(`SELECT id, session_id, event_type, actor, source, metrics_json, created_at
       FROM session_events
       ORDER BY created_at DESC
       LIMIT ?`)
        .all(limit);
    return rows.map(mapSession);
}
export function createManualRewardGrant(input, activity) {
    ensureDefaultRewardRules();
    const parsed = createManualRewardGrantSchema.parse(input);
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
        reversibleGroup: `manual_bonus:${parsed.entityType}:${parsed.entityId}:${eventLog.id}`,
        metadata: {
            manual: true,
            ...parsed.metadata
        }
    });
}
