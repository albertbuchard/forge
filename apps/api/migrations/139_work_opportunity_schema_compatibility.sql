-- Upgrade databases that applied an early development copy of migration 138.
-- The migration runner first reconstructs every changed table from the sealed
-- 138 schema inside this transaction, preserves row counts, and checks all
-- foreign keys before recording this migration. These IF NOT EXISTS statements
-- cover the only fully additive object and remain safe on fresh databases.

CREATE TABLE IF NOT EXISTS work_supporting_revisions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_kind TEXT NOT NULL,
  record_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  data_json TEXT NOT NULL CHECK (json_valid(data_json) AND json_type(data_json) = 'object'),
  actor_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(actor_json) AND json_type(actor_json) = 'object'),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  created_at TEXT NOT NULL,
  import_receipt_id TEXT,
  UNIQUE (record_kind, record_id, version)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_work_supporting_revisions_record
  ON work_supporting_revisions (record_kind, record_id, version DESC);
