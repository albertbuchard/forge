ALTER TABLE habits
ADD COLUMN linked_goal_ids_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE habits
ADD COLUMN linked_project_ids_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE habits
ADD COLUMN linked_task_ids_json TEXT NOT NULL DEFAULT '[]';
