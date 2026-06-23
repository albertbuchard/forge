ALTER TABLE health_sleep_sessions
  ADD COLUMN source_timezone TEXT NOT NULL DEFAULT 'UTC';

ALTER TABLE health_sleep_sessions
  ADD COLUMN local_date_key TEXT NOT NULL DEFAULT '';

ALTER TABLE health_sleep_sessions
  ADD COLUMN raw_segment_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE health_sleep_sessions
  ADD COLUMN source_metrics_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_health_sleep_local_date
  ON health_sleep_sessions(user_id, local_date_key DESC, started_at DESC);

CREATE TABLE IF NOT EXISTS health_sleep_segments (
  id TEXT PRIMARY KEY,
  external_uid TEXT NOT NULL,
  import_run_id TEXT REFERENCES health_import_runs(id) ON DELETE SET NULL,
  pairing_session_id TEXT REFERENCES companion_pairing_sessions(id) ON DELETE SET NULL,
  sleep_session_id TEXT REFERENCES health_sleep_sessions(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'healthkit_segment',
  source_device TEXT NOT NULL DEFAULT '',
  source_timezone TEXT NOT NULL DEFAULT 'UTC',
  local_date_key TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  stage TEXT NOT NULL,
  bucket TEXT NOT NULL,
  source_value INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  provenance_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, source, external_uid)
);

CREATE INDEX IF NOT EXISTS idx_health_sleep_segments_session
  ON health_sleep_segments(sleep_session_id, started_at ASC);

CREATE INDEX IF NOT EXISTS idx_health_sleep_segments_local_date
  ON health_sleep_segments(user_id, local_date_key DESC, started_at DESC);

CREATE TABLE IF NOT EXISTS health_sleep_raw_logs (
  id TEXT PRIMARY KEY,
  import_run_id TEXT REFERENCES health_import_runs(id) ON DELETE SET NULL,
  pairing_session_id TEXT REFERENCES companion_pairing_sessions(id) ON DELETE SET NULL,
  sleep_session_id TEXT REFERENCES health_sleep_sessions(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  log_type TEXT NOT NULL,
  external_uid TEXT,
  source_timezone TEXT NOT NULL DEFAULT 'UTC',
  local_date_key TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  ended_at TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_health_sleep_raw_logs_session
  ON health_sleep_raw_logs(sleep_session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_health_sleep_raw_logs_local_date
  ON health_sleep_raw_logs(user_id, local_date_key DESC, created_at DESC);
