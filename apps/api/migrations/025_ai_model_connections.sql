CREATE TABLE IF NOT EXISTS ai_model_connections (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  provider TEXT NOT NULL,
  auth_mode TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  account_label TEXT,
  secret_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE app_settings
  ADD COLUMN forge_basic_chat_connection_id TEXT NOT NULL DEFAULT '';

ALTER TABLE app_settings
  ADD COLUMN forge_basic_chat_model TEXT NOT NULL DEFAULT 'gpt-5.4-mini';

ALTER TABLE app_settings
  ADD COLUMN forge_wiki_connection_id TEXT NOT NULL DEFAULT '';

ALTER TABLE app_settings
  ADD COLUMN forge_wiki_model TEXT NOT NULL DEFAULT 'gpt-5.4-mini';
