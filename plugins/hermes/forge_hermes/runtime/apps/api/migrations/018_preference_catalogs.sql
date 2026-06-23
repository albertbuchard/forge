CREATE TABLE IF NOT EXISTS preference_catalogs (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES preference_profiles(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'custom' CHECK (source IN ('seeded', 'custom')),
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (profile_id, slug)
);

CREATE TABLE IF NOT EXISTS preference_catalog_items (
  id TEXT PRIMARY KEY,
  catalog_id TEXT NOT NULL REFERENCES preference_catalogs(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  feature_weights_json TEXT NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_preference_catalogs_profile
  ON preference_catalogs(profile_id, archived, source, title);
CREATE INDEX IF NOT EXISTS idx_preference_catalog_items_catalog
  ON preference_catalog_items(catalog_id, archived, position, label);
