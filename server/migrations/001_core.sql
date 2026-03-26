CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  horizon TEXT NOT NULL,
  status TEXT NOT NULL,
  target_points INTEGER NOT NULL,
  theme_color TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  color TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goal_tags (
  goal_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (goal_id, tag_id),
  FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  theme_color TEXT NOT NULL,
  target_points INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  owner TEXT NOT NULL,
  goal_id TEXT,
  project_id TEXT,
  due_date TEXT,
  effort TEXT NOT NULL,
  energy TEXT NOT NULL,
  points INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS task_tags (
  task_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (task_id, tag_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  actor TEXT,
  source TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_event_corrections (
  corrected_event_id TEXT PRIMARY KEY,
  correcting_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (corrected_event_id) REFERENCES activity_events(id) ON DELETE CASCADE,
  FOREIGN KEY (correcting_event_id) REFERENCES activity_events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_create_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  request_fingerprint TEXT NOT NULL,
  task_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  lease_ttl_seconds INTEGER NOT NULL,
  claimed_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  completed_at TEXT,
  released_at TEXT,
  timed_out_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  operator_name TEXT NOT NULL,
  operator_email TEXT NOT NULL,
  operator_title TEXT NOT NULL,
  theme_preference TEXT NOT NULL,
  locale_preference TEXT NOT NULL DEFAULT 'en',
  goal_drift_alerts INTEGER NOT NULL DEFAULT 1,
  daily_quest_reminders INTEGER NOT NULL DEFAULT 1,
  achievement_celebrations INTEGER NOT NULL DEFAULT 1,
  integrity_score INTEGER NOT NULL DEFAULT 98,
  last_audit_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_identities (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  trust_level TEXT NOT NULL DEFAULT 'standard',
  autonomy_mode TEXT NOT NULL DEFAULT 'approval_required',
  approval_mode TEXT NOT NULL DEFAULT 'approval_by_default',
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_tokens (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  agent_id TEXT,
  trust_level TEXT NOT NULL DEFAULT 'standard',
  autonomy_mode TEXT NOT NULL DEFAULT 'approval_required',
  approval_mode TEXT NOT NULL DEFAULT 'approval_by_default',
  description TEXT NOT NULL DEFAULT '',
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agent_identities(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS event_log (
  id TEXT PRIMARY KEY,
  event_kind TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  actor TEXT,
  source TEXT NOT NULL,
  caused_by_event_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (caused_by_event_id) REFERENCES event_log(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS agent_actions (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  token_id TEXT,
  action_type TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT,
  approval_request_id TEXT,
  outcome_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (agent_id) REFERENCES agent_identities(id) ON DELETE SET NULL,
  FOREIGN KEY (token_id) REFERENCES agent_tokens(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  entity_type TEXT,
  entity_id TEXT,
  requested_by_agent_id TEXT,
  requested_by_token_id TEXT,
  requested_payload_json TEXT NOT NULL DEFAULT '{}',
  approved_by TEXT,
  approved_at TEXT,
  rejected_by TEXT,
  rejected_at TEXT,
  resolution_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (requested_by_agent_id) REFERENCES agent_identities(id) ON DELETE SET NULL,
  FOREIGN KEY (requested_by_token_id) REFERENCES agent_tokens(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY,
  origin_type TEXT NOT NULL,
  origin_agent_id TEXT,
  origin_label TEXT,
  visibility TEXT NOT NULL DEFAULT 'visible',
  status TEXT NOT NULL DEFAULT 'open',
  entity_type TEXT,
  entity_id TEXT,
  timeframe_label TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0.5,
  cta_label TEXT NOT NULL DEFAULT 'Review insight',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (origin_agent_id) REFERENCES agent_identities(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS insight_feedback (
  id TEXT PRIMARY KEY,
  insight_id TEXT NOT NULL,
  actor TEXT,
  feedback_type TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (insight_id) REFERENCES insights(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reward_rules (
  id TEXT PRIMARY KEY,
  family TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reward_ledger (
  id TEXT PRIMARY KEY,
  rule_id TEXT,
  event_log_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  actor TEXT,
  source TEXT NOT NULL,
  delta_xp INTEGER NOT NULL,
  reason_title TEXT NOT NULL,
  reason_summary TEXT NOT NULL DEFAULT '',
  reversible_group TEXT,
  reversed_by_reward_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (rule_id) REFERENCES reward_rules(id) ON DELETE SET NULL,
  FOREIGN KEY (event_log_id) REFERENCES event_log(id) ON DELETE SET NULL,
  FOREIGN KEY (reversed_by_reward_id) REFERENCES reward_ledger(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT,
  source TEXT NOT NULL,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operator_sessions (
  id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL UNIQUE,
  actor_label TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status_sort ON tasks(status, sort_order);
CREATE INDEX IF NOT EXISTS idx_tasks_goal ON tasks(goal_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, status, sort_order);
CREATE INDEX IF NOT EXISTS idx_tags_kind ON tags(kind);
CREATE INDEX IF NOT EXISTS idx_projects_goal ON projects(goal_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_events_created_at ON activity_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_events_entity ON activity_events(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_runs_task_id ON task_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_status_expiry ON task_runs(status, lease_expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_runs_one_active_per_task
  ON task_runs(task_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_agent_tokens_active ON agent_tokens(revoked_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tokens_agent ON agent_tokens(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_log_entity ON event_log(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_log_kind ON event_log(event_kind, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_actions_idempotency ON agent_actions(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_actions_agent ON agent_actions(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_insights_status ON insights(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_insights_entity ON insights(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_insight_feedback_insight ON insight_feedback(insight_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_ledger_created ON reward_ledger(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_ledger_entity ON reward_ledger(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_ledger_group ON reward_ledger(reversible_group);
CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_events_type ON session_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operator_sessions_active
  ON operator_sessions(revoked_at, expires_at, last_used_at DESC);
