import { getDatabase } from "../db.js";
import {
  gamificationCelebrationSchema,
  gamificationEquipmentSchema,
  type GamificationCelebration,
  type GamificationEquipment
} from "../types.js";

type MetadataValue = string | number | boolean | null;

type DailyActivityInput = {
  userId: string;
  dateKey: string;
  timezone: string;
  qualifyingXp: number;
  eventCount: number;
  firstRewardEventId: string | null;
  lastRewardEventId: string | null;
};

type UnlockInput = {
  userId: string;
  itemId: string;
  unlockedAt: string;
  sourceMetric: string;
  sourceValue: number;
  celebrationSeenAt?: string | null;
};

type UnlockRow = {
  user_id: string;
  item_id: string;
  unlocked_at: string;
  source_metric: string;
  source_value: number;
  celebration_seen_at: string | null;
};

type CelebrationInput = {
  id: string;
  userId: string;
  kind: GamificationCelebration["kind"];
  itemId?: string | null;
  title: string;
  summary: string;
  assetKey: string;
  metadata?: Record<string, MetadataValue>;
  createdAt?: string;
};

type CelebrationRow = {
  id: string;
  user_id: string;
  kind: GamificationCelebration["kind"];
  item_id: string | null;
  title: string;
  summary: string;
  asset_key: string;
  metadata_json: string;
  created_at: string;
  seen_at: string | null;
};

function mapCelebration(row: CelebrationRow): GamificationCelebration {
  return gamificationCelebrationSchema.parse({
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    itemId: row.item_id,
    title: row.title,
    summary: row.summary,
    assetKey: row.asset_key,
    metadata: JSON.parse(row.metadata_json) as Record<string, MetadataValue>,
    createdAt: row.created_at,
    seenAt: row.seen_at
  });
}

export function replaceGamificationDailyActivity(
  userId: string,
  rows: DailyActivityInput[]
) {
  const database = getDatabase();
  const deleteRows = database.prepare(
    `DELETE FROM gamification_daily_activity WHERE user_id = ?`
  );
  const insertRow = database.prepare(
    `INSERT INTO gamification_daily_activity (
       user_id, date_key, timezone, qualifying_xp, event_count,
       first_reward_event_id, last_reward_event_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, date_key, timezone) DO UPDATE SET
       qualifying_xp = excluded.qualifying_xp,
       event_count = excluded.event_count,
       first_reward_event_id = excluded.first_reward_event_id,
       last_reward_event_id = excluded.last_reward_event_id,
       updated_at = excluded.updated_at`
  );
  const now = new Date().toISOString();
  database.exec("BEGIN");
  try {
    deleteRows.run(userId);
    for (const row of rows) {
      insertRow.run(
        row.userId,
        row.dateKey,
        row.timezone,
        row.qualifyingXp,
        row.eventCount,
        row.firstRewardEventId,
        row.lastRewardEventId,
        now,
        now
      );
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function listGamificationDailyActivity(userId: string): Array<{
  userId: string;
  dateKey: string;
  timezone: string;
  qualifyingXp: number;
  eventCount: number;
  firstRewardEventId: string | null;
  lastRewardEventId: string | null;
}> {
  const rows = getDatabase()
    .prepare(
      `SELECT user_id, date_key, timezone, qualifying_xp, event_count,
              first_reward_event_id, last_reward_event_id
       FROM gamification_daily_activity
       WHERE user_id = ?
       ORDER BY date_key DESC`
    )
    .all(userId) as Array<{
    user_id: string;
    date_key: string;
    timezone: string;
    qualifying_xp: number;
    event_count: number;
    first_reward_event_id: string | null;
    last_reward_event_id: string | null;
  }>;
  return rows.map((row) => ({
    userId: row.user_id,
    dateKey: row.date_key,
    timezone: row.timezone,
    qualifyingXp: row.qualifying_xp,
    eventCount: row.event_count,
    firstRewardEventId: row.first_reward_event_id,
    lastRewardEventId: row.last_reward_event_id
  }));
}

export function listGamificationUnlocks(userId: string) {
  const rows = getDatabase()
    .prepare(
      `SELECT user_id, item_id, unlocked_at, source_metric, source_value, celebration_seen_at
       FROM gamification_item_unlocks
       WHERE user_id = ?`
    )
    .all(userId) as UnlockRow[];
  return rows.map((row) => ({
    userId: row.user_id,
    itemId: row.item_id,
    unlockedAt: row.unlocked_at,
    sourceMetric: row.source_metric,
    sourceValue: row.source_value,
    celebrationSeenAt: row.celebration_seen_at
  }));
}

export function insertGamificationUnlock(input: UnlockInput): boolean {
  const result = getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO gamification_item_unlocks (
        user_id, item_id, unlocked_at, source_metric, source_value, celebration_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.userId,
      input.itemId,
      input.unlockedAt,
      input.sourceMetric,
      input.sourceValue,
      input.celebrationSeenAt ?? null
    );
  return result.changes > 0;
}

export function enqueueGamificationCelebration(input: CelebrationInput): void {
  getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO gamification_celebrations (
        id, user_id, kind, item_id, title, summary, asset_key, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.userId,
      input.kind,
      input.itemId ?? null,
      input.title,
      input.summary,
      input.assetKey,
      JSON.stringify(input.metadata ?? {}),
      input.createdAt ?? new Date().toISOString()
    );
}

export function listUnseenGamificationCelebrations(
  userId: string,
  limit = 5
): GamificationCelebration[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, user_id, kind, item_id, title, summary, asset_key, metadata_json, created_at, seen_at
       FROM gamification_celebrations
       WHERE user_id = ? AND seen_at IS NULL
       ORDER BY created_at ASC
       LIMIT ?`
    )
    .all(userId, limit) as CelebrationRow[];
  return rows.map(mapCelebration);
}

export function markGamificationCelebrationSeen(
  celebrationId: string,
  seenAt = new Date().toISOString()
): GamificationCelebration | null {
  getDatabase()
    .prepare(
      `UPDATE gamification_celebrations
       SET seen_at = COALESCE(seen_at, ?)
       WHERE id = ?`
    )
    .run(seenAt, celebrationId);
  const row = getDatabase()
    .prepare(
      `SELECT id, user_id, kind, item_id, title, summary, asset_key, metadata_json, created_at, seen_at
       FROM gamification_celebrations
       WHERE id = ?`
    )
    .get(celebrationId) as CelebrationRow | undefined;
  if (row?.item_id) {
    getDatabase()
      .prepare(
        `UPDATE gamification_item_unlocks
         SET celebration_seen_at = COALESCE(celebration_seen_at, ?)
         WHERE user_id = ? AND item_id = ?`
      )
      .run(seenAt, row.user_id, row.item_id);
  }
  return row ? mapCelebration(row) : null;
}

type EquipmentRow = {
  user_id: string;
  selected_mascot_skin: string | null;
  selected_hud_treatment: string | null;
  selected_streak_effect: string | null;
  selected_trophy_shelf: string | null;
  selected_celebration_variant: string | null;
  updated_at: string;
};

function mapEquipment(row: EquipmentRow | undefined): GamificationEquipment {
  return gamificationEquipmentSchema.parse({
    selectedMascotSkin: row?.selected_mascot_skin ?? null,
    selectedHudTreatment: row?.selected_hud_treatment ?? null,
    selectedStreakEffect: row?.selected_streak_effect ?? null,
    selectedTrophyShelf: row?.selected_trophy_shelf ?? null,
    selectedCelebrationVariant: row?.selected_celebration_variant ?? null,
    updatedAt: row?.updated_at ?? null
  });
}

export function getGamificationEquipment(userId: string): GamificationEquipment {
  const row = getDatabase()
    .prepare(
      `SELECT user_id, selected_mascot_skin, selected_hud_treatment,
              selected_streak_effect, selected_trophy_shelf,
              selected_celebration_variant, updated_at
       FROM gamification_equipment
       WHERE user_id = ?`
    )
    .get(userId) as EquipmentRow | undefined;
  return mapEquipment(row);
}

export function upsertGamificationEquipment(
  userId: string,
  input: Partial<Omit<GamificationEquipment, "updatedAt">>,
  updatedAt = new Date().toISOString()
): GamificationEquipment {
  const current = getGamificationEquipment(userId);
  const next = {
    selectedMascotSkin:
      input.selectedMascotSkin !== undefined
        ? input.selectedMascotSkin
        : current.selectedMascotSkin,
    selectedHudTreatment:
      input.selectedHudTreatment !== undefined
        ? input.selectedHudTreatment
        : current.selectedHudTreatment,
    selectedStreakEffect:
      input.selectedStreakEffect !== undefined
        ? input.selectedStreakEffect
        : current.selectedStreakEffect,
    selectedTrophyShelf:
      input.selectedTrophyShelf !== undefined
        ? input.selectedTrophyShelf
        : current.selectedTrophyShelf,
    selectedCelebrationVariant:
      input.selectedCelebrationVariant !== undefined
        ? input.selectedCelebrationVariant
        : current.selectedCelebrationVariant
  };
  getDatabase()
    .prepare(
      `INSERT INTO gamification_equipment (
         user_id, selected_mascot_skin, selected_hud_treatment,
         selected_streak_effect, selected_trophy_shelf,
         selected_celebration_variant, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         selected_mascot_skin = excluded.selected_mascot_skin,
         selected_hud_treatment = excluded.selected_hud_treatment,
         selected_streak_effect = excluded.selected_streak_effect,
         selected_trophy_shelf = excluded.selected_trophy_shelf,
         selected_celebration_variant = excluded.selected_celebration_variant,
         updated_at = excluded.updated_at`
    )
    .run(
      userId,
      next.selectedMascotSkin,
      next.selectedHudTreatment,
      next.selectedStreakEffect,
      next.selectedTrophyShelf,
      next.selectedCelebrationVariant,
      updatedAt
    );
  return getGamificationEquipment(userId);
}
