CREATE TABLE IF NOT EXISTS health_sleep_source_records (
  id TEXT PRIMARY KEY,
  import_run_id TEXT REFERENCES health_import_runs(id) ON DELETE SET NULL,
  pairing_session_id TEXT REFERENCES companion_pairing_sessions(id) ON DELETE SET NULL,
  sleep_session_id TEXT REFERENCES health_sleep_sessions(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_record_type TEXT NOT NULL,
  provider_record_uid TEXT NOT NULL,
  source_device TEXT NOT NULL DEFAULT '',
  source_timezone TEXT NOT NULL DEFAULT 'UTC',
  local_date_key TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  raw_stage TEXT NOT NULL DEFAULT '',
  raw_value INTEGER,
  quality_kind TEXT NOT NULL DEFAULT 'provider_native',
  payload_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  ingested_at TEXT NOT NULL,
  UNIQUE (user_id, provider, provider_record_uid)
);

CREATE INDEX IF NOT EXISTS idx_health_sleep_source_records_session
  ON health_sleep_source_records(sleep_session_id, started_at ASC);

CREATE INDEX IF NOT EXISTS idx_health_sleep_source_records_local_date
  ON health_sleep_source_records(user_id, local_date_key DESC, started_at DESC);

ALTER TABLE health_sleep_segments
  ADD COLUMN quality_kind TEXT NOT NULL DEFAULT 'provider_native';

ALTER TABLE health_sleep_segments
  ADD COLUMN source_record_ids_json TEXT NOT NULL DEFAULT '[]';
