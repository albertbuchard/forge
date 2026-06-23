CREATE TABLE IF NOT EXISTS companion_pairing_source_states (
  id TEXT PRIMARY KEY,
  pairing_session_id TEXT NOT NULL REFERENCES companion_pairing_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  desired_enabled INTEGER NOT NULL DEFAULT 1,
  applied_enabled INTEGER NOT NULL DEFAULT 0,
  authorization_status TEXT NOT NULL DEFAULT 'not_determined',
  sync_eligible INTEGER NOT NULL DEFAULT 0,
  last_observed_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (pairing_session_id, source_key)
);

CREATE INDEX IF NOT EXISTS idx_companion_pairing_source_states_pairing
  ON companion_pairing_source_states(pairing_session_id, source_key);

CREATE INDEX IF NOT EXISTS idx_companion_pairing_source_states_user
  ON companion_pairing_source_states(user_id, updated_at DESC);
