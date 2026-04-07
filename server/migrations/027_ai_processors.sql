CREATE TABLE IF NOT EXISTS ai_processors (
  id TEXT PRIMARY KEY,
  surface_id TEXT NOT NULL,
  title TEXT NOT NULL,
  prompt_flow TEXT NOT NULL DEFAULT '',
  context_input TEXT NOT NULL DEFAULT '',
  tool_config_json TEXT NOT NULL DEFAULT '[]',
  agent_ids_json TEXT NOT NULL DEFAULT '[]',
  trigger_mode TEXT NOT NULL DEFAULT 'manual',
  cron_expression TEXT NOT NULL DEFAULT '',
  machine_access_json TEXT NOT NULL DEFAULT '{"read":false,"write":false,"exec":false}',
  endpoint_enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  last_run_status TEXT,
  last_run_output_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_processor_links (
  id TEXT PRIMARY KEY,
  surface_id TEXT NOT NULL,
  source_widget_id TEXT NOT NULL,
  target_processor_id TEXT NOT NULL,
  access_mode TEXT NOT NULL DEFAULT 'read',
  capability_mode TEXT NOT NULL DEFAULT 'content',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (target_processor_id) REFERENCES ai_processors(id) ON DELETE CASCADE
);
