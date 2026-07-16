CREATE TABLE IF NOT EXISTS psyche_vocabulary_create_idempotency (
  receipt_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  entity_type TEXT NOT NULL
    CHECK (entity_type IN ('event_type', 'emotion_definition')),
  idempotency_key TEXT,
  request_fingerprint TEXT,
  entity_id TEXT NOT NULL,
  payload_label TEXT NOT NULL,
  payload_description TEXT NOT NULL DEFAULT '',
  payload_category TEXT NOT NULL DEFAULT '',
  lifecycle_state TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle_state IN ('active', 'deleted')),
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (
    (idempotency_key IS NULL AND request_fingerprint IS NULL)
    OR (idempotency_key IS NOT NULL AND request_fingerprint IS NOT NULL)
  ),
  CHECK (
    (lifecycle_state = 'active' AND deleted_at IS NULL)
    OR (lifecycle_state = 'deleted' AND deleted_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_psyche_vocabulary_idempotency_key
  ON psyche_vocabulary_create_idempotency (
    owner_user_id,
    entity_type,
    idempotency_key
  )
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_psyche_vocabulary_idempotency_entity
  ON psyche_vocabulary_create_idempotency (entity_type, entity_id);

-- Before 097, retry-safe vocabulary ids encoded a truncated owner/key digest but
-- did not retain the key itself. Preserve those identifiable records by entity id
-- and exact payload so a delayed retry can bind the original key without recreating.
INSERT OR IGNORE INTO psyche_vocabulary_create_idempotency (
  receipt_id,
  owner_user_id,
  entity_type,
  idempotency_key,
  request_fingerprint,
  entity_id,
  payload_label,
  payload_description,
  payload_category,
  lifecycle_state,
  created_at,
  deleted_at
)
SELECT
  'legacy:event_type:' || event_types.id,
  entity_owners.user_id,
  'event_type',
  NULL,
  NULL,
  event_types.id,
  event_types.label,
  event_types.description,
  '',
  'active',
  event_types.created_at,
  NULL
FROM event_types
JOIN entity_owners
  ON entity_owners.entity_type = 'event_type'
 AND entity_owners.entity_id = event_types.id
 AND entity_owners.role = 'owner'
WHERE event_types.system = 0
  AND length(event_types.id) = 20
  AND substr(event_types.id, 1, 4) = 'evt_'
  AND substr(event_types.id, 5) NOT GLOB '*[^0-9a-f]*';

INSERT OR IGNORE INTO psyche_vocabulary_create_idempotency (
  receipt_id,
  owner_user_id,
  entity_type,
  idempotency_key,
  request_fingerprint,
  entity_id,
  payload_label,
  payload_description,
  payload_category,
  lifecycle_state,
  created_at,
  deleted_at
)
SELECT
  'legacy:emotion_definition:' || emotion_definitions.id,
  entity_owners.user_id,
  'emotion_definition',
  NULL,
  NULL,
  emotion_definitions.id,
  emotion_definitions.label,
  emotion_definitions.description,
  emotion_definitions.category,
  'active',
  emotion_definitions.created_at,
  NULL
FROM emotion_definitions
JOIN entity_owners
  ON entity_owners.entity_type = 'emotion_definition'
 AND entity_owners.entity_id = emotion_definitions.id
 AND entity_owners.role = 'owner'
WHERE emotion_definitions.system = 0
  AND length(emotion_definitions.id) = 20
  AND substr(emotion_definitions.id, 1, 4) = 'emo_'
  AND substr(emotion_definitions.id, 5) NOT GLOB '*[^0-9a-f]*';

CREATE TRIGGER IF NOT EXISTS trg_psyche_event_type_idempotency_terminal
AFTER DELETE ON event_types
BEGIN
  UPDATE psyche_vocabulary_create_idempotency
  SET lifecycle_state = 'deleted',
      deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE entity_type = 'event_type'
    AND entity_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_psyche_emotion_idempotency_terminal
AFTER DELETE ON emotion_definitions
BEGIN
  UPDATE psyche_vocabulary_create_idempotency
  SET lifecycle_state = 'deleted',
      deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE entity_type = 'emotion_definition'
    AND entity_id = OLD.id;
END;
