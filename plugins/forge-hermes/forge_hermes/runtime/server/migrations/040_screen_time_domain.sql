CREATE TABLE IF NOT EXISTS screen_time_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tracking_enabled INTEGER NOT NULL DEFAULT 0,
  sync_enabled INTEGER NOT NULL DEFAULT 1,
  authorization_status TEXT NOT NULL DEFAULT 'not_determined',
  capture_state TEXT NOT NULL DEFAULT 'disabled',
  last_captured_day_key TEXT,
  last_capture_started_at TEXT,
  last_capture_ended_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS screen_time_day_summaries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pairing_session_id TEXT REFERENCES companion_pairing_sessions(id) ON DELETE SET NULL,
  source_device TEXT NOT NULL DEFAULT 'iPhone',
  date_key TEXT NOT NULL,
  total_activity_seconds INTEGER NOT NULL DEFAULT 0,
  pickup_count INTEGER NOT NULL DEFAULT 0,
  notification_count INTEGER NOT NULL DEFAULT 0,
  first_pickup_at TEXT,
  longest_activity_seconds INTEGER NOT NULL DEFAULT 0,
  top_app_bundle_ids_json TEXT NOT NULL DEFAULT '[]',
  top_category_labels_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, source_device, date_key)
);

CREATE INDEX IF NOT EXISTS idx_screen_time_day_summaries_user
  ON screen_time_day_summaries(user_id, date_key DESC);

CREATE TABLE IF NOT EXISTS screen_time_hourly_segments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pairing_session_id TEXT REFERENCES companion_pairing_sessions(id) ON DELETE SET NULL,
  source_device TEXT NOT NULL DEFAULT 'iPhone',
  date_key TEXT NOT NULL,
  hour_index INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  total_activity_seconds INTEGER NOT NULL DEFAULT 0,
  pickup_count INTEGER NOT NULL DEFAULT 0,
  notification_count INTEGER NOT NULL DEFAULT 0,
  first_pickup_at TEXT,
  longest_activity_started_at TEXT,
  longest_activity_ended_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, source_device, date_key, hour_index)
);

CREATE INDEX IF NOT EXISTS idx_screen_time_hourly_segments_user
  ON screen_time_hourly_segments(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS screen_time_app_usage (
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL REFERENCES screen_time_hourly_segments(id) ON DELETE CASCADE,
  bundle_identifier TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  category_label TEXT,
  total_activity_seconds INTEGER NOT NULL DEFAULT 0,
  pickup_count INTEGER NOT NULL DEFAULT 0,
  notification_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (segment_id, bundle_identifier)
);

CREATE INDEX IF NOT EXISTS idx_screen_time_app_usage_segment
  ON screen_time_app_usage(segment_id, total_activity_seconds DESC);

CREATE TABLE IF NOT EXISTS screen_time_category_usage (
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL REFERENCES screen_time_hourly_segments(id) ON DELETE CASCADE,
  category_label TEXT NOT NULL,
  total_activity_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (segment_id, category_label)
);

CREATE INDEX IF NOT EXISTS idx_screen_time_category_usage_segment
  ON screen_time_category_usage(segment_id, total_activity_seconds DESC);
