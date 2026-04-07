CREATE TABLE IF NOT EXISTS movement_places (
  id TEXT PRIMARY KEY,
  external_uid TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  radius_meters REAL NOT NULL DEFAULT 100,
  category_tags_json TEXT NOT NULL DEFAULT '[]',
  visibility TEXT NOT NULL DEFAULT 'shared',
  wiki_note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
  linked_entities_json TEXT NOT NULL DEFAULT '[]',
  linked_people_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, source, external_uid)
);

CREATE INDEX IF NOT EXISTS idx_movement_places_user
  ON movement_places(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS movement_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tracking_enabled INTEGER NOT NULL DEFAULT 0,
  publish_mode TEXT NOT NULL DEFAULT 'auto_publish',
  retention_mode TEXT NOT NULL DEFAULT 'aggregates_only',
  location_permission_status TEXT NOT NULL DEFAULT 'not_determined',
  motion_permission_status TEXT NOT NULL DEFAULT 'unknown',
  background_tracking_ready INTEGER NOT NULL DEFAULT 0,
  last_companion_sync_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS movement_stays (
  id TEXT PRIMARY KEY,
  external_uid TEXT NOT NULL,
  pairing_session_id TEXT REFERENCES companion_pairing_sessions(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place_id TEXT REFERENCES movement_places(id) ON DELETE SET NULL,
  label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'completed',
  classification TEXT NOT NULL DEFAULT 'stationary',
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  center_latitude REAL NOT NULL,
  center_longitude REAL NOT NULL,
  radius_meters REAL NOT NULL DEFAULT 100,
  sample_count INTEGER NOT NULL DEFAULT 0,
  weather_json TEXT NOT NULL DEFAULT '{}',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  published_note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, external_uid)
);

CREATE INDEX IF NOT EXISTS idx_movement_stays_user
  ON movement_stays(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS movement_trips (
  id TEXT PRIMARY KEY,
  external_uid TEXT NOT NULL,
  pairing_session_id TEXT REFERENCES companion_pairing_sessions(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_place_id TEXT REFERENCES movement_places(id) ON DELETE SET NULL,
  end_place_id TEXT REFERENCES movement_places(id) ON DELETE SET NULL,
  label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'completed',
  travel_mode TEXT NOT NULL DEFAULT 'travel',
  activity_type TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  distance_meters REAL NOT NULL DEFAULT 0,
  moving_seconds INTEGER NOT NULL DEFAULT 0,
  idle_seconds INTEGER NOT NULL DEFAULT 0,
  average_speed_mps REAL,
  max_speed_mps REAL,
  calories_kcal REAL,
  expected_met REAL,
  weather_json TEXT NOT NULL DEFAULT '{}',
  tags_json TEXT NOT NULL DEFAULT '[]',
  linked_entities_json TEXT NOT NULL DEFAULT '[]',
  linked_people_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  published_note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, external_uid)
);

CREATE INDEX IF NOT EXISTS idx_movement_trips_user
  ON movement_trips(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS movement_trip_points (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES movement_trips(id) ON DELETE CASCADE,
  sequence_index INTEGER NOT NULL,
  recorded_at TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracy_meters REAL,
  altitude_meters REAL,
  speed_mps REAL,
  is_stop_anchor INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_movement_trip_points_trip
  ON movement_trip_points(trip_id, sequence_index ASC);

CREATE TABLE IF NOT EXISTS movement_trip_stops (
  id TEXT PRIMARY KEY,
  external_uid TEXT NOT NULL DEFAULT '',
  trip_id TEXT NOT NULL REFERENCES movement_trips(id) ON DELETE CASCADE,
  sequence_index INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL DEFAULT '',
  place_id TEXT REFERENCES movement_places(id) ON DELETE SET NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  radius_meters REAL NOT NULL DEFAULT 80,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_movement_trip_stops_trip
  ON movement_trip_stops(trip_id, sequence_index ASC);
