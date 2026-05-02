CREATE TABLE IF NOT EXISTS gamification_daily_activity (
  user_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  timezone TEXT NOT NULL,
  qualifying_xp INTEGER NOT NULL DEFAULT 0,
  event_count INTEGER NOT NULL DEFAULT 0,
  first_reward_event_id TEXT,
  last_reward_event_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, date_key, timezone),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (first_reward_event_id) REFERENCES reward_ledger(id) ON DELETE SET NULL,
  FOREIGN KEY (last_reward_event_id) REFERENCES reward_ledger(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS gamification_item_unlocks (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  unlocked_at TEXT NOT NULL,
  source_metric TEXT NOT NULL,
  source_value INTEGER NOT NULL DEFAULT 0,
  celebration_seen_at TEXT,
  PRIMARY KEY (user_id, item_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gamification_celebrations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  item_id TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  asset_key TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  seen_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gamification_daily_activity_user_date
  ON gamification_daily_activity(user_id, date_key DESC);

CREATE INDEX IF NOT EXISTS idx_gamification_item_unlocks_user_unlocked
  ON gamification_item_unlocks(user_id, unlocked_at DESC);

CREATE INDEX IF NOT EXISTS idx_gamification_celebrations_user_seen
  ON gamification_celebrations(user_id, seen_at, created_at DESC);
