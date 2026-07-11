ALTER TABLE ai_connector_runs
ADD COLUMN flow_snapshot_json TEXT;

ALTER TABLE ai_connector_runs
ADD COLUMN flow_updated_at TEXT;

ALTER TABLE ai_connector_runs
ADD COLUMN retry_of_run_id TEXT;

CREATE TABLE IF NOT EXISTS ai_connector_node_results (
  run_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  label TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(run_id, node_id),
  FOREIGN KEY(run_id) REFERENCES ai_connector_runs(id) ON DELETE CASCADE,
  FOREIGN KEY(connector_id) REFERENCES ai_connectors(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_connector_node_results_latest
ON ai_connector_node_results(connector_id, node_id, created_at DESC, run_id DESC);
