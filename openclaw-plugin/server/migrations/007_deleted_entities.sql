-- Shared soft-delete/bin store for user-facing entities.
CREATE TABLE deleted_entities (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  deleted_at TEXT NOT NULL,
  deleted_by_actor TEXT,
  deleted_source TEXT NOT NULL,
  delete_reason TEXT NOT NULL DEFAULT '',
  snapshot_json TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);

CREATE INDEX idx_deleted_entities_deleted_at
  ON deleted_entities (deleted_at DESC);
