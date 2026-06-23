CREATE TABLE IF NOT EXISTS work_adjustments (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  requested_delta_minutes INTEGER NOT NULL,
  applied_delta_minutes INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  actor TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_work_adjustments_entity
ON work_adjustments(entity_type, entity_id, created_at DESC);
