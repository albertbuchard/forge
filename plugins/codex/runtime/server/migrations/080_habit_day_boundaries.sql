ALTER TABLE habits
  ADD COLUMN timezone TEXT NOT NULL DEFAULT '';

ALTER TABLE habits
  ADD COLUMN day_boundary_mode TEXT NOT NULL DEFAULT 'fixed';
