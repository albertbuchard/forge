-- Repair reward ownership on runtimes whose SQLite version could not execute
-- migration 093's original correlated ordering expression.
UPDATE reward_ledger
SET owner_user_id = COALESCE(
  owner_user_id,
  (
    SELECT users.id
    FROM users
    WHERE users.id = NULLIF(json_extract(reward_ledger.metadata_json, '$.ownerUserId'), '')
    LIMIT 1
  ),
  (
    SELECT entity_owners.user_id
    FROM entity_owners
    JOIN users ON users.id = entity_owners.user_id
    WHERE entity_owners.entity_type = reward_ledger.entity_type
      AND entity_owners.entity_id = reward_ledger.entity_id
    ORDER BY entity_owners.user_id
    LIMIT 1
  ),
  (
    SELECT entity_owners.user_id
    FROM entity_owners
    JOIN users ON users.id = entity_owners.user_id
    WHERE entity_owners.entity_type = 'task'
      AND entity_owners.entity_id = json_extract(reward_ledger.metadata_json, '$.taskId')
    ORDER BY entity_owners.user_id
    LIMIT 1
  ),
  (
    SELECT users.id
    FROM users
    WHERE reward_ledger.actor IS NOT NULL
      AND LOWER(TRIM(users.handle)) = LOWER(TRIM(reward_ledger.actor))
    ORDER BY users.id
    LIMIT 1
  ),
  (
    SELECT users.id
    FROM users
    WHERE reward_ledger.actor IS NOT NULL
      AND LOWER(TRIM(users.display_name)) = LOWER(TRIM(reward_ledger.actor))
    ORDER BY users.id
    LIMIT 1
  )
)
WHERE owner_user_id IS NULL;
