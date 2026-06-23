ALTER TABLE projects ADD COLUMN scheduling_rules_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE tasks ADD COLUMN scheduling_rules_json TEXT;
ALTER TABLE tasks ADD COLUMN planned_duration_seconds INTEGER;
ALTER TABLE task_runs ADD COLUMN override_reason TEXT;

CREATE TABLE IF NOT EXISTS stored_secrets (
  id TEXT PRIMARY KEY,
  cipher_text TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_connections (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  account_label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'connected',
  config_json TEXT NOT NULL DEFAULT '{}',
  credentials_secret_id TEXT NOT NULL,
  forge_calendar_id TEXT,
  last_synced_at TEXT,
  last_sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (credentials_secret_id) REFERENCES stored_secrets(id) ON DELETE RESTRICT,
  FOREIGN KEY (forge_calendar_id) REFERENCES calendar_calendars(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS calendar_calendars (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#7dd3fc',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  is_primary INTEGER NOT NULL DEFAULT 0,
  can_write INTEGER NOT NULL DEFAULT 1,
  forge_managed INTEGER NOT NULL DEFAULT 0,
  sync_cursor TEXT,
  remote_etag TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(connection_id, remote_id),
  FOREIGN KEY (connection_id) REFERENCES calendar_connections(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  remote_href TEXT,
  remote_etag TEXT,
  ownership TEXT NOT NULL DEFAULT 'external',
  status TEXT NOT NULL DEFAULT 'confirmed',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  is_all_day INTEGER NOT NULL DEFAULT 0,
  availability TEXT NOT NULL DEFAULT 'busy',
  event_type TEXT NOT NULL DEFAULT '',
  categories_json TEXT NOT NULL DEFAULT '[]',
  raw_payload_json TEXT NOT NULL DEFAULT '{}',
  remote_updated_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(connection_id, calendar_id, remote_id),
  FOREIGN KEY (connection_id) REFERENCES calendar_connections(id) ON DELETE CASCADE,
  FOREIGN KEY (calendar_id) REFERENCES calendar_calendars(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_calendar_start
  ON calendar_events(calendar_id, start_at, end_at);

CREATE INDEX IF NOT EXISTS idx_calendar_events_connection_updated
  ON calendar_events(connection_id, updated_at);

CREATE TABLE IF NOT EXISTS work_block_templates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#60a5fa',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  weekdays_json TEXT NOT NULL DEFAULT '[]',
  start_minute INTEGER NOT NULL,
  end_minute INTEGER NOT NULL,
  blocking_state TEXT NOT NULL DEFAULT 'blocked',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_block_instances (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#60a5fa',
  blocking_state TEXT NOT NULL DEFAULT 'blocked',
  calendar_event_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(template_id, date_key, start_at, end_at),
  FOREIGN KEY (template_id) REFERENCES work_block_templates(id) ON DELETE CASCADE,
  FOREIGN KEY (calendar_event_id) REFERENCES calendar_events(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_work_block_instances_date
  ON work_block_instances(date_key, start_at, end_at);

CREATE TABLE IF NOT EXISTS task_timeboxes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  project_id TEXT,
  connection_id TEXT,
  calendar_id TEXT,
  remote_event_id TEXT,
  linked_task_run_id TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  source TEXT NOT NULL DEFAULT 'manual',
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  override_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (connection_id) REFERENCES calendar_connections(id) ON DELETE SET NULL,
  FOREIGN KEY (calendar_id) REFERENCES calendar_calendars(id) ON DELETE SET NULL,
  FOREIGN KEY (linked_task_run_id) REFERENCES task_runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_task_timeboxes_task_start
  ON task_timeboxes(task_id, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_task_timeboxes_run
  ON task_timeboxes(linked_task_run_id);
