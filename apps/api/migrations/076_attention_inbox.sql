CREATE TABLE IF NOT EXISTS attention_inbox_states (
  actor_key TEXT NOT NULL,
  item_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'snoozed', 'dismissed')),
  snoozed_until TEXT,
  source_updated_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (actor_key, item_id)
);

CREATE INDEX IF NOT EXISTS idx_attention_inbox_states_actor_status
  ON attention_inbox_states(actor_key, status, snoozed_until, updated_at DESC);

CREATE TABLE IF NOT EXISTS attention_inbox_state_events (
  id TEXT PRIMARY KEY,
  actor_key TEXT NOT NULL,
  item_id TEXT NOT NULL,
  from_status TEXT CHECK (from_status IS NULL OR from_status IN ('active', 'snoozed', 'dismissed')),
  to_status TEXT NOT NULL CHECK (to_status IN ('active', 'snoozed', 'dismissed')),
  snoozed_until TEXT,
  source_updated_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attention_inbox_state_events_actor_item
  ON attention_inbox_state_events(actor_key, item_id, created_at DESC);
