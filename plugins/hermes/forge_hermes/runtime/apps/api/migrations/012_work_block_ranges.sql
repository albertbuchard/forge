ALTER TABLE work_block_templates ADD COLUMN starts_on TEXT;
ALTER TABLE work_block_templates ADD COLUMN ends_on TEXT;

CREATE INDEX IF NOT EXISTS idx_work_block_templates_active_window
  ON work_block_templates(starts_on, ends_on, start_minute);

DROP TABLE IF EXISTS work_block_instances;
