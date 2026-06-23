ALTER TABLE strategies ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE strategies ADD COLUMN locked_at TEXT;
ALTER TABLE strategies ADD COLUMN locked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_strategies_locked_by_user ON strategies(locked_by_user_id, updated_at DESC);

DELETE FROM user_access_grants
WHERE rowid NOT IN (
  SELECT MIN(rowid)
  FROM user_access_grants
  GROUP BY subject_user_id, target_user_id
);

UPDATE user_access_grants
SET access_level = 'manage',
    config_json = CASE
      WHEN subject_user_id = target_user_id THEN
        '{"self":true,"mutable":true,"linkedEntities":true,"rights":{"discoverable":true,"canListUsers":true,"canReadProfile":true,"canReadEntities":true,"canSearchEntities":true,"canLinkEntities":true,"canAffectEntities":true,"canManageStrategies":true,"canCreateOnBehalf":true,"canViewMetrics":true,"canViewActivity":true}}'
      ELSE
        '{"self":false,"mutable":false,"linkedEntities":true,"rights":{"discoverable":true,"canListUsers":true,"canReadProfile":true,"canReadEntities":true,"canSearchEntities":true,"canLinkEntities":true,"canAffectEntities":true,"canManageStrategies":true,"canCreateOnBehalf":true,"canViewMetrics":true,"canViewActivity":true}}'
    END,
    updated_at = CURRENT_TIMESTAMP;
