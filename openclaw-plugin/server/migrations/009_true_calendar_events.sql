CREATE TABLE IF NOT EXISTS forge_events (
  id TEXT PRIMARY KEY,
  preferred_connection_id TEXT,
  preferred_calendar_id TEXT,
  ownership TEXT NOT NULL DEFAULT 'forge',
  origin_type TEXT NOT NULL DEFAULT 'native',
  status TEXT NOT NULL DEFAULT 'confirmed',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  is_all_day INTEGER NOT NULL DEFAULT 0,
  availability TEXT NOT NULL DEFAULT 'busy',
  event_type TEXT NOT NULL DEFAULT '',
  categories_json TEXT NOT NULL DEFAULT '[]',
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (preferred_connection_id) REFERENCES calendar_connections(id) ON DELETE SET NULL,
  FOREIGN KEY (preferred_calendar_id) REFERENCES calendar_calendars(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_forge_events_time
  ON forge_events(start_at, end_at);

CREATE INDEX IF NOT EXISTS idx_forge_events_calendar
  ON forge_events(preferred_calendar_id, start_at, end_at);

CREATE TABLE IF NOT EXISTS forge_event_sources (
  id TEXT PRIMARY KEY,
  forge_event_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  connection_id TEXT,
  calendar_id TEXT,
  remote_calendar_id TEXT,
  remote_event_id TEXT NOT NULL,
  remote_uid TEXT,
  recurrence_instance_id TEXT,
  is_master_recurring INTEGER NOT NULL DEFAULT 0,
  remote_href TEXT,
  remote_etag TEXT,
  sync_state TEXT NOT NULL DEFAULT 'synced',
  raw_payload_json TEXT NOT NULL DEFAULT '{}',
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (forge_event_id) REFERENCES forge_events(id) ON DELETE CASCADE,
  FOREIGN KEY (connection_id) REFERENCES calendar_connections(id) ON DELETE SET NULL,
  FOREIGN KEY (calendar_id) REFERENCES calendar_calendars(id) ON DELETE SET NULL,
  UNIQUE(provider, connection_id, calendar_id, remote_event_id)
);

CREATE INDEX IF NOT EXISTS idx_forge_event_sources_event
  ON forge_event_sources(forge_event_id);

CREATE INDEX IF NOT EXISTS idx_forge_event_sources_remote
  ON forge_event_sources(connection_id, calendar_id, remote_event_id);

CREATE TABLE IF NOT EXISTS forge_event_links (
  id TEXT PRIMARY KEY,
  forge_event_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL DEFAULT 'context',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (forge_event_id) REFERENCES forge_events(id) ON DELETE CASCADE,
  UNIQUE(forge_event_id, entity_type, entity_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_forge_event_links_entity
  ON forge_event_links(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS forge_event_metadata (
  id TEXT PRIMARY KEY,
  forge_event_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL DEFAULT 'null',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (forge_event_id) REFERENCES forge_events(id) ON DELETE CASCADE,
  UNIQUE(forge_event_id, namespace, key)
);

ALTER TABLE task_timeboxes ADD COLUMN forge_event_id TEXT REFERENCES forge_events(id) ON DELETE SET NULL;

INSERT INTO forge_events (
  id,
  preferred_connection_id,
  preferred_calendar_id,
  ownership,
  origin_type,
  status,
  title,
  description,
  location,
  start_at,
  end_at,
  timezone,
  is_all_day,
  availability,
  event_type,
  categories_json,
  deleted_at,
  created_at,
  updated_at
)
SELECT
  calendar_events.id,
  calendar_events.connection_id,
  calendar_events.calendar_id,
  calendar_events.ownership,
  calendar_connections.provider,
  calendar_events.status,
  calendar_events.title,
  calendar_events.description,
  calendar_events.location,
  calendar_events.start_at,
  calendar_events.end_at,
  COALESCE(calendar_calendars.timezone, 'UTC'),
  calendar_events.is_all_day,
  calendar_events.availability,
  calendar_events.event_type,
  calendar_events.categories_json,
  calendar_events.deleted_at,
  calendar_events.created_at,
  calendar_events.updated_at
FROM calendar_events
LEFT JOIN calendar_connections
  ON calendar_connections.id = calendar_events.connection_id
LEFT JOIN calendar_calendars
  ON calendar_calendars.id = calendar_events.calendar_id
WHERE NOT EXISTS (
  SELECT 1 FROM forge_events WHERE forge_events.id = calendar_events.id
);

INSERT INTO forge_event_sources (
  id,
  forge_event_id,
  provider,
  connection_id,
  calendar_id,
  remote_calendar_id,
  remote_event_id,
  remote_uid,
  recurrence_instance_id,
  is_master_recurring,
  remote_href,
  remote_etag,
  sync_state,
  raw_payload_json,
  last_synced_at,
  created_at,
  updated_at
)
SELECT
  'evsrc_' || lower(hex(randomblob(5))),
  calendar_events.id,
  calendar_connections.provider,
  calendar_events.connection_id,
  calendar_events.calendar_id,
  calendar_calendars.remote_id,
  calendar_events.remote_id,
  json_extract(calendar_events.raw_payload_json, '$.uid'),
  json_extract(calendar_events.raw_payload_json, '$.recurrenceid'),
  CASE
    WHEN json_extract(calendar_events.raw_payload_json, '$.rrule') IS NOT NULL THEN 1
    ELSE 0
  END,
  calendar_events.remote_href,
  calendar_events.remote_etag,
  CASE
    WHEN calendar_events.deleted_at IS NOT NULL THEN 'deleted'
    ELSE 'synced'
  END,
  calendar_events.raw_payload_json,
  COALESCE(calendar_events.remote_updated_at, calendar_events.updated_at),
  calendar_events.created_at,
  calendar_events.updated_at
FROM calendar_events
LEFT JOIN calendar_connections
  ON calendar_connections.id = calendar_events.connection_id
LEFT JOIN calendar_calendars
  ON calendar_calendars.id = calendar_events.calendar_id
WHERE NOT EXISTS (
  SELECT 1
  FROM forge_event_sources
  WHERE forge_event_sources.forge_event_id = calendar_events.id
    AND forge_event_sources.connection_id = calendar_events.connection_id
    AND forge_event_sources.calendar_id = calendar_events.calendar_id
    AND forge_event_sources.remote_event_id = calendar_events.remote_id
);
