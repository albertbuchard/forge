ALTER TABLE notes
  ADD COLUMN parent_slug TEXT;

ALTER TABLE notes
  ADD COLUMN index_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE notes
  ADD COLUMN show_in_index INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_notes_space_parent_order
  ON notes (space_id, parent_slug, index_order, updated_at DESC);
