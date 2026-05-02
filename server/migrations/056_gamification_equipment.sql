CREATE TABLE IF NOT EXISTS gamification_equipment (
  user_id TEXT PRIMARY KEY,
  selected_mascot_skin TEXT,
  selected_hud_treatment TEXT,
  selected_streak_effect TEXT,
  selected_trophy_shelf TEXT,
  selected_celebration_variant TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gamification_item_unlocks_user_unlocked
  ON gamification_item_unlocks(user_id, unlocked_at DESC);

CREATE INDEX IF NOT EXISTS idx_gamification_celebrations_user_seen
  ON gamification_celebrations(user_id, seen_at, created_at DESC);
