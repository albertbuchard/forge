ALTER TABLE projects
ADD COLUMN workflow_status TEXT NOT NULL DEFAULT 'backlog';

ALTER TABLE projects
ADD COLUMN product_requirements_document TEXT NOT NULL DEFAULT '';

UPDATE projects
SET workflow_status = CASE status
  WHEN 'completed' THEN 'done'
  WHEN 'paused' THEN 'blocked'
  ELSE 'focus'
END
WHERE workflow_status IS NULL
   OR trim(workflow_status) = '';

ALTER TABLE tasks
ADD COLUMN level TEXT NOT NULL DEFAULT 'task';

ALTER TABLE tasks
ADD COLUMN parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;

ALTER TABLE tasks
ADD COLUMN ai_instructions TEXT NOT NULL DEFAULT '';

ALTER TABLE tasks
ADD COLUMN execution_mode TEXT;

ALTER TABLE tasks
ADD COLUMN acceptance_criteria_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE tasks
ADD COLUMN blocker_links_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE tasks
ADD COLUMN completion_report_json TEXT;

CREATE TABLE IF NOT EXISTS entity_assignments (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'assignee',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id, user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_entity_assignments_user
ON entity_assignments(user_id, entity_type, role, entity_id);

CREATE TABLE IF NOT EXISTS work_item_git_refs (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  ref_type TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'git',
  repository TEXT NOT NULL DEFAULT '',
  ref_value TEXT NOT NULL,
  url TEXT,
  display_title TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_work_item_git_refs_item
ON work_item_git_refs(work_item_id, ref_type, created_at DESC);

INSERT OR IGNORE INTO tags (id, name, kind, color, description, created_at)
VALUES
  ('tag_execution_feature', 'feature', 'execution', '#7dd3fc', 'Feature work and new capability delivery.', CURRENT_TIMESTAMP),
  ('tag_execution_bug', 'bug', 'execution', '#fb7185', 'Bug fixing, repair, and regression work.', CURRENT_TIMESTAMP),
  ('tag_execution_knowledge', 'knowledge', 'execution', '#f5d06a', 'Research, discovery, and knowledge-building work.', CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO entity_owners (entity_type, entity_id, user_id, role, created_at, updated_at)
SELECT 'tag', id, 'user_operator', 'owner', created_at, created_at
FROM tags
WHERE id IN ('tag_execution_feature', 'tag_execution_bug', 'tag_execution_knowledge');
