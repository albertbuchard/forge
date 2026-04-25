UPDATE wiki_spaces
SET description = 'Shared wiki space for SQLite-backed Forge knowledge.'
WHERE id = 'wiki_space_shared'
  AND description != 'Shared wiki space for SQLite-backed Forge knowledge.';

UPDATE notes
SET source_path = ''
WHERE source_path != '';
