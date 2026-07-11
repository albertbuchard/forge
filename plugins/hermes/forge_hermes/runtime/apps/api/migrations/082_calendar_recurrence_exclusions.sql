ALTER TABLE work_block_templates
  ADD COLUMN exclusion_dates_json TEXT NOT NULL DEFAULT '[]';
