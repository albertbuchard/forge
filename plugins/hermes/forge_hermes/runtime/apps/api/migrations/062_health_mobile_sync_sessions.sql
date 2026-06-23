CREATE TABLE IF NOT EXISTS health_mobile_sync_sessions (
  id TEXT PRIMARY KEY,
  pairing_session_id TEXT NOT NULL REFERENCES companion_pairing_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running',
  schema_version TEXT NOT NULL DEFAULT 'healthkit-sync-v2',
  requested_families_json TEXT NOT NULL DEFAULT '[]',
  source_metadata_json TEXT NOT NULL DEFAULT '{}',
  expected_counts_json TEXT NOT NULL DEFAULT '{}',
  received_counts_json TEXT NOT NULL DEFAULT '{}',
  byte_totals_json TEXT NOT NULL DEFAULT '{}',
  affected_workout_ids_json TEXT NOT NULL DEFAULT '[]',
  error_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  failed_at TEXT,
  aborted_at TEXT,
  expired_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_health_mobile_sync_sessions_pairing_status
  ON health_mobile_sync_sessions(pairing_session_id, status, started_at DESC);

CREATE TABLE IF NOT EXISTS health_mobile_sync_chunks (
  id TEXT PRIMARY KEY,
  sync_session_id TEXT NOT NULL REFERENCES health_mobile_sync_sessions(id) ON DELETE CASCADE,
  chunk_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  family TEXT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 0,
  byte_count INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  payload_summary_json TEXT NOT NULL DEFAULT '{}',
  received_at TEXT NOT NULL,
  applied_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(sync_session_id, chunk_id)
);

CREATE INDEX IF NOT EXISTS idx_health_mobile_sync_chunks_session_sequence
  ON health_mobile_sync_chunks(sync_session_id, sequence);

CREATE TABLE IF NOT EXISTS health_mobile_sync_family_cursors (
  id TEXT PRIMARY KEY,
  pairing_session_id TEXT NOT NULL REFERENCES companion_pairing_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family TEXT NOT NULL,
  cursor_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  UNIQUE(pairing_session_id, family)
);
