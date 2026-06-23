CREATE TABLE IF NOT EXISTS health_workout_time_series (
  id TEXT PRIMARY KEY,
  workout_id TEXT NOT NULL REFERENCES health_workout_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_sample_uid TEXT NOT NULL,
  series_index INTEGER NOT NULL DEFAULT 0,
  metric_key TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  value REAL NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  source_device TEXT NOT NULL DEFAULT '',
  source_bundle_identifier TEXT,
  source_product_type TEXT,
  capture_method TEXT NOT NULL DEFAULT 'associated_workout',
  quality_flags_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  provenance_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workout_id, metric_key, source_sample_uid, series_index)
);

CREATE INDEX IF NOT EXISTS idx_health_workout_time_series_workout_metric
  ON health_workout_time_series(workout_id, metric_key, started_at);

CREATE INDEX IF NOT EXISTS idx_health_workout_time_series_user_metric
  ON health_workout_time_series(user_id, metric_key, started_at DESC);

CREATE TABLE IF NOT EXISTS health_workout_routes (
  id TEXT PRIMARY KEY,
  workout_id TEXT NOT NULL REFERENCES health_workout_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_route_uid TEXT NOT NULL,
  point_index INTEGER NOT NULL,
  recorded_at TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  altitude_meters REAL,
  horizontal_accuracy_meters REAL,
  vertical_accuracy_meters REAL,
  speed_mps REAL,
  course_degrees REAL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  provenance_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workout_id, source_route_uid, point_index)
);

CREATE INDEX IF NOT EXISTS idx_health_workout_routes_workout
  ON health_workout_routes(workout_id, point_index);

CREATE TABLE IF NOT EXISTS health_zone_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_version TEXT NOT NULL DEFAULT 'forge-hrr-v1',
  birth_year INTEGER,
  sex_at_birth TEXT,
  known_max_hr REAL,
  threshold_hr REAL,
  resting_hr_override REAL,
  custom_zones_json TEXT NOT NULL DEFAULT '[]',
  inferred_max_hr REAL,
  inferred_resting_hr REAL,
  confidence TEXT NOT NULL DEFAULT 'medium',
  thresholds_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, model_version)
);

CREATE TABLE IF NOT EXISTS health_workout_analytics (
  id TEXT PRIMARY KEY,
  workout_id TEXT NOT NULL REFERENCES health_workout_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  zone_profile_id TEXT REFERENCES health_zone_profiles(id) ON DELETE SET NULL,
  model_version TEXT NOT NULL DEFAULT 'forge-hrr-v1',
  confidence TEXT NOT NULL DEFAULT 'unavailable',
  data_quality_json TEXT NOT NULL DEFAULT '{}',
  zone_durations_json TEXT NOT NULL DEFAULT '[]',
  hr_summary_json TEXT NOT NULL DEFAULT '{}',
  load_json TEXT NOT NULL DEFAULT '{}',
  route_summary_json TEXT NOT NULL DEFAULT '{}',
  computed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workout_id, model_version)
);

CREATE INDEX IF NOT EXISTS idx_health_workout_analytics_user
  ON health_workout_analytics(user_id, computed_at DESC);
