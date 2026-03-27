ALTER TABLE task_runs ADD COLUMN timer_mode TEXT NOT NULL DEFAULT 'unlimited';
ALTER TABLE task_runs ADD COLUMN planned_duration_seconds INTEGER;
ALTER TABLE task_runs ADD COLUMN is_current INTEGER NOT NULL DEFAULT 0;

UPDATE task_runs
SET timer_mode = 'unlimited',
    planned_duration_seconds = NULL
WHERE timer_mode IS NULL OR timer_mode = '';

ALTER TABLE app_settings ADD COLUMN max_active_tasks INTEGER NOT NULL DEFAULT 2;
ALTER TABLE app_settings ADD COLUMN time_accounting_mode TEXT NOT NULL DEFAULT 'split';

CREATE INDEX IF NOT EXISTS idx_task_runs_actor_status_claimed
  ON task_runs(actor, status, claimed_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_runs_single_current_per_actor
  ON task_runs(actor)
  WHERE status = 'active' AND is_current = 1;
