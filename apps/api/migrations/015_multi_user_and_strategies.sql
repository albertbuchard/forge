CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('human', 'bot')),
  handle TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  accent_color TEXT NOT NULL DEFAULT '#c0c1ff',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_access_grants (
  id TEXT PRIMARY KEY,
  subject_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL DEFAULT 'view',
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (subject_user_id, target_user_id, access_level)
);

CREATE TABLE IF NOT EXISTS entity_owners (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS strategies (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  overview TEXT NOT NULL DEFAULT '',
  end_state_description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  target_goal_ids_json TEXT NOT NULL DEFAULT '[]',
  target_project_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_entities_json TEXT NOT NULL DEFAULT '[]',
  graph_json TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_kind ON users(kind, display_name);
CREATE INDEX IF NOT EXISTS idx_entity_owners_user ON entity_owners(user_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_strategies_status ON strategies(status, updated_at DESC);

INSERT OR IGNORE INTO users (
  id,
  kind,
  handle,
  display_name,
  description,
  accent_color,
  created_at,
  updated_at
)
VALUES (
  'user_operator',
  'human',
  'operator',
  'Operator',
  'Primary human Forge operator.',
  '#f4b97a',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

UPDATE users
SET handle = COALESCE(
      (
        SELECT CASE
          WHEN trim(lower(replace(replace(replace(operator_name, ' ', '_'), '-', '_'), '.', ''))) = '' THEN 'operator'
          ELSE trim(lower(replace(replace(replace(operator_name, ' ', '_'), '-', '_'), '.', '')))
        END
        FROM app_settings
        WHERE id = 1
      ),
      handle
    ),
    display_name = COALESCE(
      (
        SELECT CASE
          WHEN trim(operator_name) = '' THEN 'Operator'
          ELSE trim(operator_name)
        END
        FROM app_settings
        WHERE id = 1
      ),
      display_name
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'user_operator';

INSERT OR IGNORE INTO users (
  id,
  kind,
  handle,
  display_name,
  description,
  accent_color,
  created_at,
  updated_at
)
VALUES (
  'user_forge_bot',
  'bot',
  'forge_bot',
  'Forge Bot',
  'Autonomous or semi-autonomous execution partner inside Forge.',
  '#7dd3fc',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO users (
  id,
  kind,
  handle,
  display_name,
  description,
  accent_color,
  created_at,
  updated_at
)
SELECT
  'user_human_' || lower(hex(substr(owner, 1, 16))),
  'human',
  trim(lower(replace(replace(replace(owner, ' ', '_'), '-', '_'), '.', ''))),
  trim(owner),
  'Backfilled from existing task ownership labels.',
  '#f4b97a',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM tasks
WHERE trim(owner) != ''
  AND lower(trim(owner)) NOT IN (SELECT lower(display_name) FROM users)
GROUP BY trim(owner);

INSERT OR IGNORE INTO entity_owners (entity_type, entity_id, user_id, role, created_at, updated_at)
SELECT 'goal', id, 'user_operator', 'owner', created_at, updated_at FROM goals;

INSERT OR IGNORE INTO entity_owners (entity_type, entity_id, user_id, role, created_at, updated_at)
SELECT 'project', id, 'user_operator', 'owner', created_at, updated_at FROM projects;

INSERT OR IGNORE INTO entity_owners (entity_type, entity_id, user_id, role, created_at, updated_at)
SELECT
  'task',
  tasks.id,
  COALESCE(
    (
      SELECT users.id
      FROM users
      WHERE lower(users.display_name) = lower(trim(tasks.owner))
         OR lower(users.handle) = lower(trim(replace(replace(replace(tasks.owner, ' ', '_'), '-', '_'), '.', '')))
      ORDER BY CASE WHEN users.kind = 'human' THEN 0 ELSE 1 END, users.created_at
      LIMIT 1
    ),
    'user_operator'
  ),
  'owner',
  tasks.created_at,
  tasks.updated_at
FROM tasks;

INSERT OR IGNORE INTO entity_owners (entity_type, entity_id, user_id, role, created_at, updated_at)
SELECT 'habit', id, 'user_operator', 'owner', created_at, updated_at FROM habits;

INSERT OR IGNORE INTO entity_owners (entity_type, entity_id, user_id, role, created_at, updated_at)
SELECT 'tag', id, 'user_operator', 'owner', created_at, created_at FROM tags;

INSERT OR IGNORE INTO entity_owners (entity_type, entity_id, user_id, role, created_at, updated_at)
SELECT 'note', id, 'user_operator', 'owner', created_at, updated_at FROM notes;

INSERT OR IGNORE INTO entity_owners (entity_type, entity_id, user_id, role, created_at, updated_at)
SELECT 'insight', id, 'user_operator', 'owner', created_at, updated_at FROM insights;

INSERT OR IGNORE INTO entity_owners (entity_type, entity_id, user_id, role, created_at, updated_at)
SELECT 'calendar_event', id, 'user_operator', 'owner', created_at, updated_at FROM calendar_events;

INSERT OR IGNORE INTO entity_owners (entity_type, entity_id, user_id, role, created_at, updated_at)
SELECT 'work_block_template', id, 'user_operator', 'owner', created_at, updated_at FROM work_block_templates;

INSERT OR IGNORE INTO entity_owners (entity_type, entity_id, user_id, role, created_at, updated_at)
SELECT 'task_timebox', id, 'user_operator', 'owner', created_at, updated_at FROM task_timeboxes;

INSERT OR IGNORE INTO entity_owners (entity_type, entity_id, user_id, role, created_at, updated_at)
SELECT 'psyche_value', id, 'user_operator', 'owner', created_at, updated_at FROM psyche_values;

INSERT OR IGNORE INTO entity_owners (entity_type, entity_id, user_id, role, created_at, updated_at)
SELECT 'behavior_pattern', id, 'user_operator', 'owner', created_at, updated_at FROM behavior_patterns;

INSERT OR IGNORE INTO entity_owners (entity_type, entity_id, user_id, role, created_at, updated_at)
SELECT 'behavior', id, 'user_operator', 'owner', created_at, updated_at FROM psyche_behaviors;

INSERT OR IGNORE INTO entity_owners (entity_type, entity_id, user_id, role, created_at, updated_at)
SELECT 'belief_entry', id, 'user_operator', 'owner', created_at, updated_at FROM belief_entries;

INSERT OR IGNORE INTO entity_owners (entity_type, entity_id, user_id, role, created_at, updated_at)
SELECT 'mode_profile', id, 'user_operator', 'owner', created_at, updated_at FROM mode_profiles;

INSERT OR IGNORE INTO entity_owners (entity_type, entity_id, user_id, role, created_at, updated_at)
SELECT 'mode_guide_session', id, 'user_operator', 'owner', created_at, updated_at FROM mode_guide_sessions;

INSERT OR IGNORE INTO entity_owners (entity_type, entity_id, user_id, role, created_at, updated_at)
SELECT 'event_type', id, 'user_operator', 'owner', created_at, updated_at FROM event_types;

INSERT OR IGNORE INTO entity_owners (entity_type, entity_id, user_id, role, created_at, updated_at)
SELECT 'emotion_definition', id, 'user_operator', 'owner', created_at, updated_at FROM emotion_definitions;

INSERT OR IGNORE INTO entity_owners (entity_type, entity_id, user_id, role, created_at, updated_at)
SELECT 'trigger_report', id, 'user_operator', 'owner', created_at, updated_at FROM trigger_reports;

INSERT OR IGNORE INTO entity_owners (entity_type, entity_id, user_id, role, created_at, updated_at)
SELECT 'strategy', id, 'user_operator', 'owner', created_at, updated_at FROM strategies;

INSERT OR IGNORE INTO user_access_grants (
  id,
  subject_user_id,
  target_user_id,
  access_level,
  config_json,
  created_at,
  updated_at
)
SELECT
  'grant_' || lower(hex(randomblob(8))),
  subject_users.id,
  target_users.id,
  CASE
    WHEN subject_users.id = target_users.id THEN 'manage'
    ELSE 'view'
  END,
  CASE
    WHEN subject_users.id = target_users.id THEN '{"self":true,"mutable":true}'
    ELSE '{"discoverable":true,"linkedEntities":true}'
  END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM users AS subject_users
CROSS JOIN users AS target_users;
