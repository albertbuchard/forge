ALTER TABLE preference_catalogs
  ADD COLUMN scope_in TEXT NOT NULL DEFAULT '';

ALTER TABLE preference_catalogs
  ADD COLUMN scope_out TEXT NOT NULL DEFAULT '';

ALTER TABLE preference_catalogs
  ADD COLUMN created_source TEXT NOT NULL DEFAULT 'unknown'
  CHECK (created_source IN ('ui', 'openclaw', 'agent', 'system', 'unknown'));

ALTER TABLE preference_catalogs
  ADD COLUMN created_by_actor TEXT;

INSERT INTO entity_owners (
  entity_type,
  entity_id,
  user_id,
  role,
  created_at,
  updated_at
)
SELECT
  'preference_catalog',
  preference_catalogs.id,
  preference_profiles.user_id,
  'owner',
  preference_catalogs.created_at,
  preference_catalogs.updated_at
FROM preference_catalogs
INNER JOIN preference_profiles
  ON preference_profiles.id = preference_catalogs.profile_id
ON CONFLICT(entity_type, entity_id) DO NOTHING;

INSERT INTO entity_owners (
  entity_type,
  entity_id,
  user_id,
  role,
  created_at,
  updated_at
)
SELECT
  'preference_catalog_item',
  preference_catalog_items.id,
  preference_profiles.user_id,
  'owner',
  preference_catalog_items.created_at,
  preference_catalog_items.updated_at
FROM preference_catalog_items
INNER JOIN preference_catalogs
  ON preference_catalogs.id = preference_catalog_items.catalog_id
INNER JOIN preference_profiles
  ON preference_profiles.id = preference_catalogs.profile_id
ON CONFLICT(entity_type, entity_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_preference_catalogs_profile_title_active
  ON preference_catalogs(profile_id, archived, lower(trim(title)));

CREATE INDEX IF NOT EXISTS idx_preference_catalog_items_catalog_label_active
  ON preference_catalog_items(catalog_id, archived, lower(trim(label)));

CREATE TABLE IF NOT EXISTS preference_catalog_create_receipts (
  user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  catalog_id TEXT NOT NULL REFERENCES preference_catalogs(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS preference_catalog_archive_members (
  catalog_id TEXT NOT NULL REFERENCES preference_catalogs(id) ON DELETE CASCADE,
  catalog_item_id TEXT NOT NULL REFERENCES preference_catalog_items(id) ON DELETE CASCADE,
  PRIMARY KEY (catalog_id, catalog_item_id)
);

INSERT INTO preference_catalog_archive_members (catalog_id, catalog_item_id)
SELECT
  preference_catalog_items.catalog_id,
  preference_catalog_items.id
FROM preference_catalog_items
INNER JOIN preference_catalogs
  ON preference_catalogs.id = preference_catalog_items.catalog_id
WHERE preference_catalogs.archived = 1
  AND preference_catalog_items.archived = 1
ON CONFLICT(catalog_id, catalog_item_id) DO NOTHING;

INSERT INTO deleted_entities (
  entity_type,
  entity_id,
  title,
  subtitle,
  deleted_at,
  deleted_by_actor,
  deleted_source,
  delete_reason,
  snapshot_json
)
SELECT
  'preference_catalog',
  preference_catalogs.id,
  preference_catalogs.title,
  preference_catalogs.description,
  preference_catalogs.updated_at,
  NULL,
  'system',
  'Converted from the legacy archived preference catalog state.',
  json_object(
    'id', preference_catalogs.id,
    'profileId', preference_catalogs.profile_id,
    'userId', preference_profiles.user_id,
    'domain', preference_catalogs.domain,
    'slug', preference_catalogs.slug,
    'title', preference_catalogs.title,
    'description', preference_catalogs.description,
    'scopeIn', preference_catalogs.scope_in,
    'scopeOut', preference_catalogs.scope_out,
    'source', preference_catalogs.source,
    'createdSource', preference_catalogs.created_source,
    'createdByActor', preference_catalogs.created_by_actor,
    'archived', json('true'),
    'createdAt', preference_catalogs.created_at,
    'updatedAt', preference_catalogs.updated_at
  )
FROM preference_catalogs
INNER JOIN preference_profiles
  ON preference_profiles.id = preference_catalogs.profile_id
WHERE preference_catalogs.archived = 1
ON CONFLICT(entity_type, entity_id) DO NOTHING;

CREATE TRIGGER IF NOT EXISTS trg_preference_catalog_title_unique_insert
BEFORE INSERT ON preference_catalogs
FOR EACH ROW
WHEN NEW.archived = 0 AND EXISTS (
  SELECT 1
  FROM preference_catalogs
  WHERE profile_id = NEW.profile_id
    AND archived = 0
    AND lower(trim(title)) = lower(trim(NEW.title))
)
BEGIN
  SELECT RAISE(ABORT, 'active preference catalog title must be unique per profile');
END;

CREATE TRIGGER IF NOT EXISTS trg_preference_catalog_title_unique_update
BEFORE UPDATE OF profile_id, title, archived ON preference_catalogs
FOR EACH ROW
WHEN NEW.archived = 0
AND (
  OLD.archived <> NEW.archived
  OR OLD.profile_id <> NEW.profile_id
  OR lower(trim(OLD.title)) <> lower(trim(NEW.title))
)
AND EXISTS (
  SELECT 1
  FROM preference_catalogs
  WHERE profile_id = NEW.profile_id
    AND archived = 0
    AND id <> NEW.id
    AND lower(trim(title)) = lower(trim(NEW.title))
)
BEGIN
  SELECT RAISE(ABORT, 'active preference catalog title must be unique per profile');
END;

CREATE TRIGGER IF NOT EXISTS trg_preference_catalog_item_label_unique_insert
BEFORE INSERT ON preference_catalog_items
FOR EACH ROW
WHEN NEW.archived = 0 AND EXISTS (
  SELECT 1
  FROM preference_catalog_items
  WHERE catalog_id = NEW.catalog_id
    AND archived = 0
    AND lower(trim(label)) = lower(trim(NEW.label))
)
BEGIN
  SELECT RAISE(ABORT, 'active preference catalog item label must be unique per catalog');
END;

CREATE TRIGGER IF NOT EXISTS trg_preference_catalog_item_label_unique_update
BEFORE UPDATE OF catalog_id, label, archived ON preference_catalog_items
FOR EACH ROW
WHEN NEW.archived = 0
AND (
  OLD.archived <> NEW.archived
  OR OLD.catalog_id <> NEW.catalog_id
  OR lower(trim(OLD.label)) <> lower(trim(NEW.label))
)
AND EXISTS (
  SELECT 1
  FROM preference_catalog_items
  WHERE catalog_id = NEW.catalog_id
    AND archived = 0
    AND id <> NEW.id
    AND lower(trim(label)) = lower(trim(NEW.label))
)
BEGIN
  SELECT RAISE(ABORT, 'active preference catalog item label must be unique per catalog');
END;

CREATE TRIGGER IF NOT EXISTS trg_preference_catalog_domain_insert
BEFORE INSERT ON preference_catalogs
FOR EACH ROW
WHEN NEW.domain <> (
  SELECT domain FROM preference_profiles WHERE id = NEW.profile_id
)
BEGIN
  SELECT RAISE(ABORT, 'preference catalog domain must match profile domain');
END;

CREATE TRIGGER IF NOT EXISTS trg_preference_catalog_domain_update
BEFORE UPDATE OF profile_id, domain ON preference_catalogs
FOR EACH ROW
WHEN NEW.domain <> (
  SELECT domain FROM preference_profiles WHERE id = NEW.profile_id
)
BEGIN
  SELECT RAISE(ABORT, 'preference catalog domain must match profile domain');
END;
