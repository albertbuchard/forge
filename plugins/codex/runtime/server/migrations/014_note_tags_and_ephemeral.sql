ALTER TABLE notes
  ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE notes
  ADD COLUMN destroy_at TEXT;

CREATE INDEX IF NOT EXISTS idx_notes_destroy_at
  ON notes(destroy_at);
