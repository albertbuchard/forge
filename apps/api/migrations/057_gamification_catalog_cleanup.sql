DROP INDEX IF EXISTS idx_gamification_item_unlocks_user_version_unlocked;
DROP INDEX IF EXISTS idx_gamification_celebrations_user_version_seen;
DROP INDEX IF EXISTS idx_gamification_item_unlocks_user_unlocked;
DROP INDEX IF EXISTS idx_gamification_celebrations_user_seen;

DELETE FROM gamification_item_unlocks;
DELETE FROM gamification_celebrations;

CREATE TABLE gamification_item_unlocks_canonical (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  unlocked_at TEXT NOT NULL,
  source_metric TEXT NOT NULL,
  source_value INTEGER NOT NULL DEFAULT 0,
  celebration_seen_at TEXT,
  PRIMARY KEY (user_id, item_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

DROP TABLE gamification_item_unlocks;
ALTER TABLE gamification_item_unlocks_canonical RENAME TO gamification_item_unlocks;

CREATE TABLE gamification_celebrations_canonical (
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

DROP TABLE gamification_celebrations;
ALTER TABLE gamification_celebrations_canonical RENAME TO gamification_celebrations;

CREATE INDEX IF NOT EXISTS idx_gamification_item_unlocks_user_unlocked
  ON gamification_item_unlocks(user_id, unlocked_at DESC);

CREATE INDEX IF NOT EXISTS idx_gamification_celebrations_user_seen
  ON gamification_celebrations(user_id, seen_at, created_at DESC);
