ALTER TABLE reward_ledger
  ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

UPDATE reward_ledger
SET owner_user_id = COALESCE(
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
    LIMIT 1
  ),
  (
    SELECT entity_owners.user_id
    FROM entity_owners
    JOIN users ON users.id = entity_owners.user_id
    WHERE entity_owners.entity_type = 'task'
      AND entity_owners.entity_id = json_extract(reward_ledger.metadata_json, '$.taskId')
    LIMIT 1
  ),
  (
    SELECT users.id
    FROM users
    WHERE reward_ledger.actor IS NOT NULL
      AND (
        LOWER(TRIM(users.display_name)) = LOWER(TRIM(reward_ledger.actor))
        OR LOWER(TRIM(users.handle)) = LOWER(TRIM(reward_ledger.actor))
      )
    ORDER BY
      CASE
        WHEN LOWER(TRIM(users.handle)) = LOWER(TRIM(reward_ledger.actor))
        THEN 0 ELSE 1
      END,
      users.id
    LIMIT 1
  )
)
WHERE owner_user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_reward_ledger_owner_created
  ON reward_ledger(owner_user_id, created_at, id);

CREATE TABLE IF NOT EXISTS gamification_reconciliation_state (
  user_id TEXT NOT NULL,
  timezone TEXT NOT NULL,
  cursor_created_at TEXT,
  cursor_reward_id TEXT,
  requires_full_rebuild INTEGER NOT NULL DEFAULT 1
    CHECK (requires_full_rebuild IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, timezone),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (cursor_reward_id) REFERENCES reward_ledger(id) ON DELETE SET NULL
);

CREATE TRIGGER IF NOT EXISTS trg_reward_ledger_reconciliation_insert
AFTER INSERT ON reward_ledger
BEGIN
  UPDATE gamification_reconciliation_state
  SET requires_full_rebuild = 1,
      updated_at = CURRENT_TIMESTAMP
  WHERE (NEW.owner_user_id IS NULL OR user_id = NEW.owner_user_id)
    AND cursor_created_at IS NOT NULL
    AND (
      NEW.created_at < cursor_created_at
      OR (
        NEW.created_at = cursor_created_at
        AND NEW.id <= COALESCE(cursor_reward_id, '')
      )
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_reward_ledger_reconciliation_update
AFTER UPDATE OF owner_user_id, delta_xp, reversed_by_reward_id, metadata_json, created_at
ON reward_ledger
BEGIN
  UPDATE gamification_reconciliation_state
  SET requires_full_rebuild = 1,
      updated_at = CURRENT_TIMESTAMP
  WHERE OLD.owner_user_id IS NULL
     OR NEW.owner_user_id IS NULL
     OR user_id = OLD.owner_user_id
     OR user_id = NEW.owner_user_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_reward_ledger_reconciliation_delete
AFTER DELETE ON reward_ledger
BEGIN
  UPDATE gamification_reconciliation_state
  SET requires_full_rebuild = 1,
      updated_at = CURRENT_TIMESTAMP
  WHERE OLD.owner_user_id IS NULL OR user_id = OLD.owner_user_id;
END;
