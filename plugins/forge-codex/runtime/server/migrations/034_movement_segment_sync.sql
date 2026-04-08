CREATE TABLE IF NOT EXISTS movement_stay_tombstones (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stay_external_uid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, stay_external_uid)
);

CREATE INDEX IF NOT EXISTS idx_movement_stay_tombstones_user
ON movement_stay_tombstones(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS movement_stay_overrides (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stay_external_uid TEXT NOT NULL,
  stay_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, stay_external_uid)
);

CREATE INDEX IF NOT EXISTS idx_movement_stay_overrides_user
ON movement_stay_overrides(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS movement_trip_tombstones (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trip_external_uid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, trip_external_uid)
);

CREATE INDEX IF NOT EXISTS idx_movement_trip_tombstones_user
ON movement_trip_tombstones(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS movement_trip_overrides (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trip_external_uid TEXT NOT NULL,
  trip_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, trip_external_uid)
);

CREATE INDEX IF NOT EXISTS idx_movement_trip_overrides_user
ON movement_trip_overrides(user_id, updated_at DESC);
