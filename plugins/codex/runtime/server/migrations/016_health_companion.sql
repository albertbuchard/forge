CREATE TABLE IF NOT EXISTS companion_pairing_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  pairing_token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  capability_flags_json TEXT NOT NULL DEFAULT '[]',
  device_name TEXT,
  platform TEXT,
  app_version TEXT,
  api_base_url TEXT NOT NULL DEFAULT '',
  last_seen_at TEXT,
  last_sync_at TEXT,
  last_sync_error TEXT,
  paired_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_companion_pairing_token
  ON companion_pairing_sessions(pairing_token);

CREATE INDEX IF NOT EXISTS idx_companion_pairing_user
  ON companion_pairing_sessions(user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS health_import_runs (
  id TEXT PRIMARY KEY,
  pairing_session_id TEXT REFERENCES companion_pairing_sessions(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_device TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'completed',
  payload_summary_json TEXT NOT NULL DEFAULT '{}',
  imported_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  merged_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  imported_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_health_import_runs_user
  ON health_import_runs(user_id, imported_at DESC);

CREATE TABLE IF NOT EXISTS health_sleep_sessions (
  id TEXT PRIMARY KEY,
  external_uid TEXT NOT NULL,
  pairing_session_id TEXT REFERENCES companion_pairing_sessions(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'healthkit',
  source_device TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  time_in_bed_seconds INTEGER NOT NULL DEFAULT 0,
  asleep_seconds INTEGER NOT NULL DEFAULT 0,
  awake_seconds INTEGER NOT NULL DEFAULT 0,
  sleep_score REAL,
  regularity_score REAL,
  bedtime_consistency_minutes INTEGER,
  wake_consistency_minutes INTEGER,
  stage_breakdown_json TEXT NOT NULL DEFAULT '[]',
  recovery_metrics_json TEXT NOT NULL DEFAULT '{}',
  links_json TEXT NOT NULL DEFAULT '[]',
  annotations_json TEXT NOT NULL DEFAULT '{}',
  provenance_json TEXT NOT NULL DEFAULT '{}',
  derived_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, source, external_uid)
);

CREATE INDEX IF NOT EXISTS idx_health_sleep_user
  ON health_sleep_sessions(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS health_workout_sessions (
  id TEXT PRIMARY KEY,
  external_uid TEXT NOT NULL,
  pairing_session_id TEXT REFERENCES companion_pairing_sessions(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'healthkit',
  workout_type TEXT NOT NULL,
  source_device TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  active_energy_kcal REAL,
  total_energy_kcal REAL,
  distance_meters REAL,
  step_count INTEGER,
  exercise_minutes REAL,
  average_heart_rate REAL,
  max_heart_rate REAL,
  subjective_effort INTEGER,
  mood_before TEXT NOT NULL DEFAULT '',
  mood_after TEXT NOT NULL DEFAULT '',
  meaning_text TEXT NOT NULL DEFAULT '',
  planned_context TEXT NOT NULL DEFAULT '',
  social_context TEXT NOT NULL DEFAULT '',
  links_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  annotations_json TEXT NOT NULL DEFAULT '{}',
  provenance_json TEXT NOT NULL DEFAULT '{}',
  derived_json TEXT NOT NULL DEFAULT '{}',
  generated_from_habit_id TEXT REFERENCES habits(id) ON DELETE SET NULL,
  generated_from_check_in_id TEXT REFERENCES habit_check_ins(id) ON DELETE SET NULL,
  reconciliation_status TEXT NOT NULL DEFAULT 'standalone',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, source, external_uid)
);

CREATE INDEX IF NOT EXISTS idx_health_workouts_user
  ON health_workout_sessions(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS health_daily_summaries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date_key TEXT NOT NULL,
  summary_type TEXT NOT NULL,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  derived_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'derived',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, date_key, summary_type)
);

CREATE INDEX IF NOT EXISTS idx_health_daily_summaries_user
  ON health_daily_summaries(user_id, date_key DESC, summary_type);

ALTER TABLE habits
  ADD COLUMN generated_health_event_template_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE forge_events
  ADD COLUMN place_label TEXT NOT NULL DEFAULT '';

ALTER TABLE forge_events
  ADD COLUMN place_address TEXT NOT NULL DEFAULT '';

ALTER TABLE forge_events
  ADD COLUMN place_timezone TEXT NOT NULL DEFAULT '';

ALTER TABLE forge_events
  ADD COLUMN place_latitude REAL;

ALTER TABLE forge_events
  ADD COLUMN place_longitude REAL;

ALTER TABLE forge_events
  ADD COLUMN place_source TEXT NOT NULL DEFAULT '';

ALTER TABLE forge_events
  ADD COLUMN place_external_id TEXT NOT NULL DEFAULT '';
