CREATE TABLE IF NOT EXISTS movement_boxes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('stay', 'trip', 'missing')),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('automatic', 'user_defined')),
  origin TEXT NOT NULL CHECK (
    origin IN (
      'recorded',
      'continued_stay',
      'repaired_gap',
      'missing',
      'user_defined',
      'user_invalidated'
    )
  ),
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  place_label TEXT,
  anchor_external_uid TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  distance_meters REAL,
  average_speed_mps REAL,
  editable INTEGER NOT NULL DEFAULT 0,
  override_count INTEGER NOT NULL DEFAULT 0,
  overridden_automatic_box_ids_json TEXT NOT NULL DEFAULT '[]',
  raw_stay_ids_json TEXT NOT NULL DEFAULT '[]',
  raw_trip_ids_json TEXT NOT NULL DEFAULT '[]',
  raw_point_count INTEGER NOT NULL DEFAULT 0,
  has_legacy_corrections INTEGER NOT NULL DEFAULT 0,
  legacy_origin_key TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_movement_boxes_user_time
ON movement_boxes(user_id, started_at, ended_at);

CREATE INDEX IF NOT EXISTS idx_movement_boxes_user_source
ON movement_boxes(user_id, source_kind, deleted_at, started_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_movement_boxes_legacy_origin
ON movement_boxes(user_id, legacy_origin_key)
WHERE legacy_origin_key IS NOT NULL;
