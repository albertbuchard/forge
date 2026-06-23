CREATE TABLE IF NOT EXISTS agent_runtime_sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  agent_label TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  session_key TEXT NOT NULL,
  session_label TEXT NOT NULL DEFAULT '',
  actor_label TEXT NOT NULL,
  connection_mode TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'connected',
  base_url TEXT,
  web_url TEXT,
  data_root TEXT,
  external_session_id TEXT,
  stale_after_seconds INTEGER NOT NULL DEFAULT 120,
  reconnect_count INTEGER NOT NULL DEFAULT 0,
  reconnect_requested_at TEXT,
  last_error TEXT,
  last_seen_at TEXT NOT NULL,
  last_heartbeat_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agent_identities(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runtime_sessions_provider_key
  ON agent_runtime_sessions(provider, session_key);

CREATE INDEX IF NOT EXISTS idx_agent_runtime_sessions_last_seen
  ON agent_runtime_sessions(last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runtime_sessions_status
  ON agent_runtime_sessions(status, last_heartbeat_at DESC);

CREATE TABLE IF NOT EXISTS agent_runtime_session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES agent_runtime_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_runtime_session_events_session
  ON agent_runtime_session_events(session_id, created_at DESC);
