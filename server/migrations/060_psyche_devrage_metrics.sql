CREATE TABLE IF NOT EXISTS psyche_devrage_conversation_measures (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0,
  messages_with_swears INTEGER NOT NULL DEFAULT 0,
  swear_count INTEGER NOT NULL DEFAULT 0,
  scanned_at TEXT NOT NULL,
  UNIQUE (source, conversation_id, date_key)
);

CREATE INDEX IF NOT EXISTS psyche_devrage_conversation_measures_date_idx
  ON psyche_devrage_conversation_measures (date_key DESC);

CREATE INDEX IF NOT EXISTS psyche_devrage_conversation_measures_updated_idx
  ON psyche_devrage_conversation_measures (updated_at DESC);

CREATE TABLE IF NOT EXISTS psyche_devrage_metric_measures (
  id TEXT PRIMARY KEY,
  date_key TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  sample_count INTEGER NOT NULL DEFAULT 0,
  computed_at TEXT NOT NULL,
  UNIQUE (date_key, metric_key)
);

CREATE INDEX IF NOT EXISTS psyche_devrage_metric_measures_metric_date_idx
  ON psyche_devrage_metric_measures (metric_key, date_key DESC);

CREATE TABLE IF NOT EXISTS psyche_devrage_sync_state (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  full_sync_completed_at TEXT,
  last_daily_sync_at TEXT,
  last_synced_date_key TEXT,
  updated_at TEXT NOT NULL
);
