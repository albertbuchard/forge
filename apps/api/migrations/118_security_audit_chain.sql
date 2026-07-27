CREATE TABLE IF NOT EXISTS security_audit_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  occurred_at TEXT NOT NULL,
  principal_kind TEXT NOT NULL,
  subject_id TEXT,
  client_id TEXT,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  outcome TEXT NOT NULL,
  reason TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  request_id TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  previous_mac TEXT NOT NULL,
  event_mac TEXT NOT NULL,
  checkpoint INTEGER NOT NULL DEFAULT 0 CHECK (checkpoint IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_security_audit_subject_time
  ON security_audit_events(subject_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_client_time
  ON security_audit_events(client_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_action_time
  ON security_audit_events(action, occurred_at DESC);

CREATE TABLE IF NOT EXISTS security_audit_retention_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  base_sequence INTEGER NOT NULL,
  base_mac TEXT NOT NULL,
  state_mac TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS security_rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,
  tokens REAL NOT NULL,
  updated_at_milliseconds INTEGER NOT NULL,
  last_seen_milliseconds INTEGER NOT NULL
);
