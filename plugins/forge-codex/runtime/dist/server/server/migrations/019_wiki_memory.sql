ALTER TABLE notes
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'evidence';

ALTER TABLE notes
  ADD COLUMN title TEXT NOT NULL DEFAULT '';

ALTER TABLE notes
  ADD COLUMN slug TEXT NOT NULL DEFAULT '';

ALTER TABLE notes
  ADD COLUMN space_id TEXT NOT NULL DEFAULT '';

ALTER TABLE notes
  ADD COLUMN aliases_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE notes
  ADD COLUMN summary TEXT NOT NULL DEFAULT '';

ALTER TABLE notes
  ADD COLUMN source_path TEXT NOT NULL DEFAULT '';

ALTER TABLE notes
  ADD COLUMN frontmatter_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE notes
  ADD COLUMN revision_hash TEXT NOT NULL DEFAULT '';

ALTER TABLE notes
  ADD COLUMN last_synced_at TEXT;

CREATE INDEX IF NOT EXISTS idx_notes_kind_updated
  ON notes (kind, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_notes_space_updated
  ON notes (space_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_space_slug_unique
  ON notes (space_id, slug)
  WHERE slug != '';

CREATE TABLE IF NOT EXISTS wiki_spaces (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_user_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'personal',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wiki_spaces_owner
  ON wiki_spaces (owner_user_id, updated_at DESC);

INSERT INTO wiki_spaces (id, slug, label, description, owner_user_id, visibility, created_at, updated_at)
VALUES (
  'wiki_space_shared',
  'shared',
  'Shared Forge Memory',
  'Shared wiki space for SQLite-backed Forge knowledge.',
  NULL,
  'shared',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT(id) DO NOTHING;

UPDATE notes
SET space_id = 'wiki_space_shared'
WHERE trim(space_id) = '';

UPDATE notes
SET title = CASE
  WHEN trim(title) != '' THEN title
  WHEN trim(content_plain) != '' THEN substr(trim(content_plain), 1, 120)
  ELSE 'Untitled note'
END
WHERE trim(title) = '';

UPDATE notes
SET slug = replace(replace(lower(id), '_', '-'), ' ', '-')
WHERE trim(slug) = '';

CREATE TABLE IF NOT EXISTS wiki_link_edges (
  source_note_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_note_id TEXT,
  target_entity_type TEXT,
  target_entity_id TEXT,
  label TEXT NOT NULL DEFAULT '',
  raw_target TEXT NOT NULL DEFAULT '',
  is_embed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (
    source_note_id,
    target_type,
    target_note_id,
    target_entity_type,
    target_entity_id,
    raw_target,
    is_embed
  ),
  FOREIGN KEY (source_note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wiki_link_edges_source
  ON wiki_link_edges (source_note_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_wiki_link_edges_target_note
  ON wiki_link_edges (target_note_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_wiki_link_edges_target_entity
  ON wiki_link_edges (target_entity_type, target_entity_id, updated_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS wiki_pages_fts
USING fts5(
  note_id UNINDEXED,
  title,
  slug,
  aliases,
  summary,
  content_plain,
  linked_entities
);

INSERT INTO wiki_pages_fts (note_id, title, slug, aliases, summary, content_plain, linked_entities)
SELECT
  notes.id,
  notes.title,
  notes.slug,
  COALESCE(notes.aliases_json, '[]'),
  COALESCE(notes.summary, ''),
  notes.content_plain,
  ''
FROM notes
WHERE NOT EXISTS (
  SELECT 1
  FROM wiki_pages_fts
  WHERE wiki_pages_fts.note_id = notes.id
);

CREATE TABLE IF NOT EXISTS wiki_media_assets (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  note_id TEXT,
  label TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  checksum TEXT NOT NULL DEFAULT '',
  transcript_note_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE SET NULL,
  FOREIGN KEY (transcript_note_id) REFERENCES notes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_wiki_media_assets_space
  ON wiki_media_assets (space_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS wiki_llm_profiles (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL,
  secret_id TEXT,
  system_prompt TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wiki_embedding_profiles (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL,
  secret_id TEXT,
  dimensions INTEGER,
  chunk_size INTEGER NOT NULL DEFAULT 1200,
  chunk_overlap INTEGER NOT NULL DEFAULT 200,
  enabled INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wiki_embedding_chunks (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  chunk_key TEXT NOT NULL,
  heading_path TEXT NOT NULL DEFAULT '',
  content_text TEXT NOT NULL,
  vector_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES wiki_embedding_profiles(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_embedding_chunks_unique
  ON wiki_embedding_chunks (note_id, profile_id, chunk_key);

CREATE INDEX IF NOT EXISTS idx_wiki_embedding_chunks_profile_space
  ON wiki_embedding_chunks (profile_id, space_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS wiki_ingest_jobs (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  llm_profile_id TEXT,
  status TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_locator TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  title_hint TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  page_note_id TEXT,
  created_by_actor TEXT,
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (llm_profile_id) REFERENCES wiki_llm_profiles(id) ON DELETE SET NULL,
  FOREIGN KEY (page_note_id) REFERENCES notes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_wiki_ingest_jobs_space
  ON wiki_ingest_jobs (space_id, created_at DESC);

CREATE TABLE IF NOT EXISTS wiki_ingest_job_items (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  status TEXT NOT NULL,
  note_id TEXT,
  media_asset_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES wiki_ingest_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE SET NULL,
  FOREIGN KEY (media_asset_id) REFERENCES wiki_media_assets(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_wiki_ingest_job_items_job
  ON wiki_ingest_job_items (job_id, created_at DESC);
