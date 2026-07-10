CREATE TABLE IF NOT EXISTS entity_pins (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL DEFAULT '',
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  pinned_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_user_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_pins_owner_pinned
  ON entity_pins(owner_user_id, pinned_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_entity_pins_target
  ON entity_pins(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS entity_pin_events (
  id TEXT PRIMARY KEY,
  pin_id TEXT NOT NULL,
  actor_key TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('pinned', 'unpinned')),
  owner_user_id TEXT NOT NULL DEFAULT '',
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entity_pin_events_pin_occurred
  ON entity_pin_events(pin_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_entity_pin_events_target_occurred
  ON entity_pin_events(entity_type, entity_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS entity_recent_views (
  actor_key TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 1 CHECK (view_count > 0),
  first_viewed_at TEXT NOT NULL,
  last_viewed_at TEXT NOT NULL,
  PRIMARY KEY (actor_key, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_recent_views_actor_last
  ON entity_recent_views(actor_key, last_viewed_at DESC, entity_type, entity_id);
