CREATE TABLE IF NOT EXISTS watch_capture_events (
  id TEXT PRIMARY KEY,
  pairing_session_id TEXT REFERENCES companion_pairing_sessions(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL,
  source_device TEXT NOT NULL DEFAULT 'Apple Watch',
  event_type TEXT NOT NULL,
  prompt_id TEXT,
  recorded_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  linked_context_json TEXT NOT NULL DEFAULT '{}',
  payload_json TEXT NOT NULL DEFAULT '{}',
  projection_status TEXT NOT NULL DEFAULT 'stored',
  projection_details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (user_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_watch_capture_events_user_recorded
  ON watch_capture_events(user_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_watch_capture_events_event_type
  ON watch_capture_events(user_id, event_type, recorded_at DESC);
