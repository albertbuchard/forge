CREATE TABLE IF NOT EXISTS diagnostic_logs (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL DEFAULT 'info',
  source TEXT NOT NULL DEFAULT 'server',
  scope TEXT NOT NULL,
  event_key TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  route TEXT,
  function_name TEXT,
  request_id TEXT,
  entity_type TEXT,
  entity_id TEXT,
  job_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_diagnostic_logs_created
  ON diagnostic_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_diagnostic_logs_scope
  ON diagnostic_logs (scope, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_diagnostic_logs_job
  ON diagnostic_logs (job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_diagnostic_logs_entity
  ON diagnostic_logs (entity_type, entity_id, created_at DESC);
