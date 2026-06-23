import { randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { recordActivityEvent } from "./activity-events.js";
import { getRewardLedgerEventById, recordWeeklyReviewCompletionReward } from "./rewards.js";
import {
  weeklyReviewClosureSchema,
  type ActivitySource,
  type RewardLedgerEvent,
  type WeeklyReviewClosure
} from "../types.js";

type WeeklyReviewClosureRow = {
  id: string;
  week_key: string;
  week_start_date: string;
  week_end_date: string;
  window_label: string;
  actor: string | null;
  source: ActivitySource;
  reward_id: string;
  activity_event_id: string;
  created_at: string;
};

function mapWeeklyReviewClosure(row: WeeklyReviewClosureRow): WeeklyReviewClosure {
  return weeklyReviewClosureSchema.parse({
    id: row.id,
    weekKey: row.week_key,
    weekStartDate: row.week_start_date,
    weekEndDate: row.week_end_date,
    windowLabel: row.window_label,
    actor: row.actor,
    source: row.source,
    rewardId: row.reward_id,
    activityEventId: row.activity_event_id,
    createdAt: row.created_at
  });
}

export function getWeeklyReviewClosure(weekKey: string): WeeklyReviewClosure | null {
  const row = getDatabase()
    .prepare(
      `SELECT
         id,
         week_key,
         week_start_date,
         week_end_date,
         window_label,
         actor,
         source,
         reward_id,
         activity_event_id,
         created_at
       FROM weekly_review_closures
       WHERE week_key = ?`
    )
    .get(weekKey) as WeeklyReviewClosureRow | undefined;

  return row ? mapWeeklyReviewClosure(row) : null;
}

export function finalizeWeeklyReviewClosure(input: {
  weekKey: string;
  weekStartDate: string;
  weekEndDate: string;
  windowLabel: string;
  rewardXp: number;
  actor?: string | null;
  source: ActivitySource;
}): { closure: WeeklyReviewClosure; reward: RewardLedgerEvent; created: boolean } {
  return runInTransaction(() => {
    const existing = getWeeklyReviewClosure(input.weekKey);
    if (existing) {
      const existingReward = getRewardLedgerEventById(existing.rewardId);
      if (!existingReward) {
        throw new Error(`Weekly review closure ${existing.id} is missing reward ${existing.rewardId}.`);
      }
      return {
        closure: existing,
        reward: existingReward,
        created: false
      };
    }

    const reward = recordWeeklyReviewCompletionReward(
      {
        weekKey: input.weekKey,
        windowLabel: input.windowLabel,
        rewardXp: input.rewardXp
      },
      {
        actor: input.actor ?? null,
        source: input.source
      }
    );

    const activity = recordActivityEvent({
      entityType: "system",
      entityId: input.weekKey,
      eventType: "weekly_review_finalized",
      title: `Weekly review finalized: ${input.windowLabel}`,
      description: `Review completion locked this cycle and awarded ${reward.deltaXp} XP.`,
      actor: input.actor ?? null,
      source: input.source,
      metadata: {
        weekKey: input.weekKey,
        weekStartDate: input.weekStartDate,
        weekEndDate: input.weekEndDate,
        rewardId: reward.id,
        rewardXp: reward.deltaXp
      }
    });

    const createdAt = new Date().toISOString();
    const closure = weeklyReviewClosureSchema.parse({
      id: `wrc_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
      weekKey: input.weekKey,
      weekStartDate: input.weekStartDate,
      weekEndDate: input.weekEndDate,
      windowLabel: input.windowLabel,
      actor: input.actor ?? null,
      source: input.source,
      rewardId: reward.id,
      activityEventId: activity.id,
      createdAt
    });

    getDatabase()
      .prepare(
        `INSERT INTO weekly_review_closures (
          id,
          week_key,
          week_start_date,
          week_end_date,
          window_label,
          actor,
          source,
          reward_id,
          activity_event_id,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        closure.id,
        closure.weekKey,
        closure.weekStartDate,
        closure.weekEndDate,
        closure.windowLabel,
        closure.actor,
        closure.source,
        closure.rewardId,
        closure.activityEventId,
        closure.createdAt
      );

    return {
      closure,
      reward,
      created: true
    };
  });
}
