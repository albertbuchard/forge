CREATE TABLE IF NOT EXISTS life_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  short_description TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT 'custom',
  status TEXT NOT NULL DEFAULT 'planned',
  importance TEXT NOT NULL DEFAULT 'meaningful',
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  is_all_day INTEGER NOT NULL DEFAULT 0,
  place_label TEXT NOT NULL DEFAULT '',
  place_address TEXT NOT NULL DEFAULT '',
  place_timezone TEXT NOT NULL DEFAULT '',
  place_latitude REAL,
  place_longitude REAL,
  origin_label TEXT NOT NULL DEFAULT '',
  origin_city TEXT NOT NULL DEFAULT '',
  origin_country TEXT NOT NULL DEFAULT '',
  origin_latitude REAL,
  origin_longitude REAL,
  destination_label TEXT NOT NULL DEFAULT '',
  destination_city TEXT NOT NULL DEFAULT '',
  destination_country TEXT NOT NULL DEFAULT '',
  destination_latitude REAL,
  destination_longitude REAL,
  transport_mode TEXT,
  primary_calendar_event_id TEXT REFERENCES forge_events(id) ON DELETE SET NULL,
  calendar_sync_state TEXT NOT NULL DEFAULT 'not_synced',
  calendar_match_confidence REAL,
  source_kind TEXT NOT NULL DEFAULT 'manual',
  source_artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
  extraction_status TEXT NOT NULL DEFAULT 'none',
  extraction_summary_json TEXT NOT NULL DEFAULT '{}',
  travel_details_json TEXT NOT NULL DEFAULT '{}',
  display_style_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_life_events_time
  ON life_events (starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_life_events_status_time
  ON life_events (status, starts_at);

CREATE INDEX IF NOT EXISTS idx_life_events_type_time
  ON life_events (event_type, starts_at);

CREATE INDEX IF NOT EXISTS idx_life_events_calendar
  ON life_events (primary_calendar_event_id);

CREATE INDEX IF NOT EXISTS idx_life_events_artifact
  ON life_events (source_artifact_id);

CREATE TABLE IF NOT EXISTS life_event_segments (
  id TEXT PRIMARY KEY,
  life_event_id TEXT NOT NULL REFERENCES life_events(id) ON DELETE CASCADE,
  segment_type TEXT NOT NULL DEFAULT 'custom',
  transport_mode TEXT,
  sequence_index INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  starts_at TEXT,
  ends_at TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  origin_label TEXT NOT NULL DEFAULT '',
  origin_iata TEXT NOT NULL DEFAULT '',
  origin_icao TEXT NOT NULL DEFAULT '',
  origin_city TEXT NOT NULL DEFAULT '',
  origin_country TEXT NOT NULL DEFAULT '',
  origin_latitude REAL,
  origin_longitude REAL,
  destination_label TEXT NOT NULL DEFAULT '',
  destination_iata TEXT NOT NULL DEFAULT '',
  destination_icao TEXT NOT NULL DEFAULT '',
  destination_city TEXT NOT NULL DEFAULT '',
  destination_country TEXT NOT NULL DEFAULT '',
  destination_latitude REAL,
  destination_longitude REAL,
  carrier_name TEXT NOT NULL DEFAULT '',
  carrier_code TEXT NOT NULL DEFAULT '',
  service_number TEXT NOT NULL DEFAULT '',
  booking_reference TEXT NOT NULL DEFAULT '',
  terminal TEXT NOT NULL DEFAULT '',
  gate TEXT NOT NULL DEFAULT '',
  seat TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled',
  status_source TEXT NOT NULL DEFAULT 'scheduled',
  status_checked_at TEXT,
  route_geometry_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_life_event_segments_event
  ON life_event_segments (life_event_id, sequence_index);

CREATE INDEX IF NOT EXISTS idx_life_event_segments_service
  ON life_event_segments (segment_type, carrier_code, service_number, starts_at);

CREATE TABLE IF NOT EXISTS life_event_status_cache (
  id TEXT PRIMARY KEY,
  life_event_id TEXT NOT NULL REFERENCES life_events(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  status_kind TEXT NOT NULL DEFAULT 'scheduled',
  status_json TEXT NOT NULL DEFAULT '{}',
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_life_event_status_cache_event
  ON life_event_status_cache (life_event_id, provider, expires_at);
