CREATE TABLE IF NOT EXISTS preference_judgment_receipts (
  user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  request_fingerprint TEXT NOT NULL,
  judgment_id TEXT NOT NULL REFERENCES pairwise_judgments(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_preference_judgment_receipts_judgment
  ON preference_judgment_receipts(judgment_id);

-- Some restored databases can retain the 086 migration receipt while missing
-- this support table. Recreate it before repairing legacy archive provenance.
CREATE TABLE IF NOT EXISTS preference_catalog_archive_members (
  catalog_id TEXT NOT NULL REFERENCES preference_catalogs(id) ON DELETE CASCADE,
  catalog_item_id TEXT NOT NULL REFERENCES preference_catalog_items(id) ON DELETE CASCADE,
  PRIMARY KEY (catalog_id, catalog_item_id)
);

INSERT INTO entity_owners (
  entity_type,
  entity_id,
  user_id,
  role,
  created_at,
  updated_at
)
SELECT
  'preference_context',
  preference_contexts.id,
  preference_profiles.user_id,
  'owner',
  preference_contexts.created_at,
  preference_contexts.updated_at
FROM preference_contexts
INNER JOIN preference_profiles
  ON preference_profiles.id = preference_contexts.profile_id
WHERE true
ON CONFLICT(entity_type, entity_id) DO UPDATE SET
  user_id = excluded.user_id,
  role = excluded.role,
  updated_at = excluded.updated_at;

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
  'preference_catalog_item',
  preference_catalog_items.id,
  preference_catalog_items.label,
  preference_catalog_items.description,
  preference_catalog_items.updated_at,
  NULL,
  'system',
  CASE
    WHEN preference_catalogs.archived = 0
      THEN 'Converted from an independently archived legacy preference concept.'
    ELSE 'Preserved as independently archived because the legacy parent archive did not record concept-level provenance.'
  END,
  json_object(
    'id', preference_catalog_items.id,
    'catalogId', preference_catalog_items.catalog_id,
    'label', preference_catalog_items.label,
    'description', preference_catalog_items.description,
    'tags', json(preference_catalog_items.tags_json),
    'featureWeights', json(preference_catalog_items.feature_weights_json),
    'position', preference_catalog_items.position,
    'archived', json('true'),
    'createdAt', preference_catalog_items.created_at,
    'updatedAt', preference_catalog_items.updated_at,
    'userId', preference_profiles.user_id
  )
FROM preference_catalog_items
INNER JOIN preference_catalogs
  ON preference_catalogs.id = preference_catalog_items.catalog_id
INNER JOIN preference_profiles
  ON preference_profiles.id = preference_catalogs.profile_id
LEFT JOIN deleted_entities AS deleted_item
  ON deleted_item.entity_type = 'preference_catalog_item'
 AND deleted_item.entity_id = preference_catalog_items.id
LEFT JOIN deleted_entities AS deleted_catalog
  ON deleted_catalog.entity_type = 'preference_catalog'
 AND deleted_catalog.entity_id = preference_catalogs.id
WHERE preference_catalog_items.archived = 1
  AND deleted_item.entity_id IS NULL
  AND (
    preference_catalogs.archived = 0
    OR (
      preference_catalogs.archived = 1
      AND deleted_catalog.delete_reason = 'Converted from the legacy archived preference catalog state.'
    )
  )
ON CONFLICT(entity_type, entity_id) DO NOTHING;

-- Migration 086 could not distinguish concepts archived independently before
-- their parent from concepts archived by the parent. Preserve the archived
-- state rather than reviving ambiguous records when the parent is restored.
DELETE FROM preference_catalog_archive_members
WHERE catalog_item_id IN (
  SELECT entity_id
  FROM deleted_entities
  WHERE entity_type = 'preference_catalog_item'
    AND delete_reason = 'Preserved as independently archived because the legacy parent archive did not record concept-level provenance.'
);
