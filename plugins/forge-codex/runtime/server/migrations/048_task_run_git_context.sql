ALTER TABLE task_runs ADD COLUMN git_provider TEXT NOT NULL DEFAULT '';
ALTER TABLE task_runs ADD COLUMN git_repository TEXT NOT NULL DEFAULT '';
ALTER TABLE task_runs ADD COLUMN git_branch TEXT NOT NULL DEFAULT '';
ALTER TABLE task_runs ADD COLUMN git_base_branch TEXT NOT NULL DEFAULT 'main';
ALTER TABLE task_runs ADD COLUMN git_branch_url TEXT;
ALTER TABLE task_runs ADD COLUMN git_pull_request_url TEXT;
ALTER TABLE task_runs ADD COLUMN git_pull_request_number INTEGER;
ALTER TABLE task_runs ADD COLUMN git_compare_url TEXT;
