ALTER TABLE ai_connectors
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0);

CREATE TABLE IF NOT EXISTS ai_connector_versions (
  connector_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('functor', 'chat')),
  node_count INTEGER NOT NULL CHECK (node_count >= 0),
  edge_count INTEGER NOT NULL CHECK (edge_count >= 0),
  public_input_count INTEGER NOT NULL CHECK (public_input_count >= 0),
  published_output_count INTEGER NOT NULL CHECK (published_output_count >= 0),
  snapshot_json TEXT NOT NULL CHECK (
    json_valid(snapshot_json)
    AND json_type(snapshot_json) = 'object'
    AND length(snapshot_json) <= 4194304
  ),
  change_kind TEXT NOT NULL CHECK (change_kind IN ('baseline', 'created', 'updated', 'restored')),
  restored_from_revision INTEGER CHECK (restored_from_revision IS NULL OR restored_from_revision > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (connector_id, revision),
  FOREIGN KEY (connector_id) REFERENCES ai_connectors(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_connector_versions_connector_revision
  ON ai_connector_versions (connector_id, revision DESC);

INSERT OR IGNORE INTO ai_connector_versions (
  connector_id,
  revision,
  title,
  kind,
  node_count,
  edge_count,
  public_input_count,
  published_output_count,
  snapshot_json,
  change_kind,
  restored_from_revision,
  created_at
)
SELECT
  id,
  revision,
  title,
  kind,
  json_array_length(json_extract(graph_json, '$.nodes')),
  json_array_length(json_extract(graph_json, '$.edges')),
  json_array_length(public_inputs_json),
  json_array_length(published_outputs_json),
  json_object(
    'title', title,
    'description', description,
    'kind', kind,
    'homeSurfaceId', home_surface_id,
    'endpointEnabled', json(CASE WHEN endpoint_enabled = 1 THEN 'true' ELSE 'false' END),
    'graph', json(graph_json),
    'publicInputs', json(public_inputs_json),
    'publishedOutputs', json(published_outputs_json)
  ),
  'baseline',
  NULL,
  updated_at
FROM ai_connectors;
