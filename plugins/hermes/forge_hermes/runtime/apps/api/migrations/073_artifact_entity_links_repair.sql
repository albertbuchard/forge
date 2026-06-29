CREATE TABLE IF NOT EXISTS entity_links (
  source_entity_type TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  target_entity_type TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  anchor_key TEXT NOT NULL DEFAULT '',
  relationship TEXT NOT NULL DEFAULT 'related',
  created_by_actor TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (
    source_entity_type,
    source_entity_id,
    target_entity_type,
    target_entity_id,
    anchor_key,
    relationship
  )
);

CREATE INDEX IF NOT EXISTS idx_entity_links_source
  ON entity_links (source_entity_type, source_entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_entity_links_target
  ON entity_links (target_entity_type, target_entity_id, created_at DESC);
