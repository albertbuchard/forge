CREATE TABLE IF NOT EXISTS saved_views (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  query_text TEXT NOT NULL DEFAULT '' CHECK (length(query_text) <= 200),
  filter_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(filter_ids_json) AND json_type(filter_ids_json) = 'array'),
  scope_mode TEXT NOT NULL CHECK (scope_mode IN ('all', 'selected')),
  scope_user_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(scope_user_ids_json) AND json_type(scope_user_ids_json) = 'array'),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_views_owner_name
  ON saved_views(owner_user_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_saved_views_owner_updated
  ON saved_views(owner_user_id, updated_at DESC, id);
