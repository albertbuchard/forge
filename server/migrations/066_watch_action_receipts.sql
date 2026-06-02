CREATE TABLE IF NOT EXISTS watch_action_receipts (
  id TEXT PRIMARY KEY,
  pairing_session_id TEXT REFERENCES companion_pairing_sessions(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  status TEXT NOT NULL,
  result_json TEXT NOT NULL DEFAULT '{}',
  error_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (user_id, action_id)
);

CREATE INDEX IF NOT EXISTS idx_watch_action_receipts_user_processed
  ON watch_action_receipts(user_id, processed_at DESC);

CREATE INDEX IF NOT EXISTS idx_watch_action_receipts_kind
  ON watch_action_receipts(user_id, kind, processed_at DESC);
