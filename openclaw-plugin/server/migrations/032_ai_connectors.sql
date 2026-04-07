CREATE TABLE IF NOT EXISTS ai_connectors (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  home_surface_id TEXT,
  endpoint_enabled INTEGER NOT NULL DEFAULT 1,
  graph_json TEXT NOT NULL,
  published_outputs_json TEXT NOT NULL DEFAULT '[]',
  last_run_json TEXT,
  legacy_processor_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_connector_runs (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  user_input TEXT NOT NULL DEFAULT '',
  context_json TEXT NOT NULL DEFAULT '{}',
  conversation_id TEXT,
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY(connector_id) REFERENCES ai_connectors(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_connector_runs_connector_created
ON ai_connector_runs(connector_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_connector_conversations (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL UNIQUE,
  provider TEXT,
  external_conversation_id TEXT,
  transcript_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(connector_id) REFERENCES ai_connectors(id) ON DELETE CASCADE
);
