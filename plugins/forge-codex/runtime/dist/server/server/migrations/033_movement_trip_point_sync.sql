ALTER TABLE movement_trip_points
ADD COLUMN external_uid TEXT NOT NULL DEFAULT '';

UPDATE movement_trip_points
SET external_uid = id
WHERE trim(external_uid) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_movement_trip_points_trip_external
ON movement_trip_points(trip_id, external_uid);

CREATE TABLE IF NOT EXISTS movement_trip_point_tombstones (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trip_external_uid TEXT NOT NULL,
  point_external_uid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, trip_external_uid, point_external_uid)
);

CREATE INDEX IF NOT EXISTS idx_movement_trip_point_tombstones_user_trip
ON movement_trip_point_tombstones(user_id, trip_external_uid, updated_at DESC);

CREATE TABLE IF NOT EXISTS movement_trip_point_overrides (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trip_external_uid TEXT NOT NULL,
  point_external_uid TEXT NOT NULL,
  point_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, trip_external_uid, point_external_uid)
);

CREATE INDEX IF NOT EXISTS idx_movement_trip_point_overrides_user_trip
ON movement_trip_point_overrides(user_id, trip_external_uid, updated_at DESC);
