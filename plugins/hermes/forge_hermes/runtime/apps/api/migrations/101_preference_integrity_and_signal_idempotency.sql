CREATE TABLE IF NOT EXISTS preference_signal_receipts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  request_fingerprint TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_preference_signal_receipts_signal
  ON preference_signal_receipts(signal_id);

-- A legacy profile can exist without a context after an interrupted or manual
-- import. Add one neutral context so the repaired default pointer is valid.
INSERT INTO preference_contexts (
  id,
  profile_id,
  name,
  description,
  share_mode,
  active,
  is_default,
  decay_days,
  created_at,
  updated_at
)
SELECT
  'pref_ctx_recovered_' || lower(hex(randomblob(10))),
  preference_profiles.id,
  'Recovered default',
  'Recovered from a legacy preference profile that had no context.',
  'blended',
  1,
  1,
  90,
  preference_profiles.updated_at,
  preference_profiles.updated_at
FROM preference_profiles
WHERE NOT EXISTS (
  SELECT 1
  FROM preference_contexts
  WHERE preference_contexts.profile_id = preference_profiles.id
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

DROP TABLE IF EXISTS temp.preference_default_context_repair;
CREATE TEMP TABLE preference_default_context_repair (
  profile_id TEXT PRIMARY KEY,
  context_id TEXT NOT NULL
);

-- Preserve a valid declared pointer first. Otherwise prefer an active declared
-- default, then any active context, then the oldest surviving context.
INSERT INTO preference_default_context_repair (profile_id, context_id)
SELECT
  profile.id,
  (
    SELECT candidate.id
    FROM preference_contexts AS candidate
    WHERE candidate.profile_id = profile.id
    ORDER BY
      CASE
        WHEN candidate.id = profile.default_context_id THEN 0
        WHEN candidate.is_default = 1 AND candidate.active = 1 THEN 1
        WHEN candidate.active = 1 THEN 2
        WHEN candidate.is_default = 1 THEN 3
        ELSE 4
      END,
      candidate.created_at ASC,
      candidate.id ASC
    LIMIT 1
  )
FROM preference_profiles AS profile;

UPDATE preference_contexts
SET
  is_default = CASE
    WHEN id = (
      SELECT repair.context_id
      FROM preference_default_context_repair AS repair
      WHERE repair.profile_id = preference_contexts.profile_id
    ) THEN 1
    ELSE 0
  END,
  active = CASE
    WHEN id = (
      SELECT repair.context_id
      FROM preference_default_context_repair AS repair
      WHERE repair.profile_id = preference_contexts.profile_id
    ) THEN 1
    ELSE active
  END;

UPDATE preference_profiles
SET default_context_id = (
  SELECT repair.context_id
  FROM preference_default_context_repair AS repair
  WHERE repair.profile_id = preference_profiles.id
);

DROP TABLE preference_default_context_repair;

CREATE UNIQUE INDEX IF NOT EXISTS idx_preference_contexts_one_default
  ON preference_contexts(profile_id)
  WHERE is_default = 1;

CREATE TRIGGER IF NOT EXISTS trg_preference_context_default_must_be_active_insert
BEFORE INSERT ON preference_contexts
WHEN NEW.is_default = 1 AND NEW.active <> 1
BEGIN
  SELECT RAISE(ABORT, 'preference default context must be active');
END;

CREATE TRIGGER IF NOT EXISTS trg_preference_context_default_must_be_active_update
BEFORE UPDATE OF is_default, active ON preference_contexts
WHEN NEW.is_default = 1 AND NEW.active <> 1
BEGIN
  SELECT RAISE(ABORT, 'preference default context must be active');
END;

CREATE TRIGGER IF NOT EXISTS trg_preference_profile_default_pointer_update
BEFORE UPDATE OF default_context_id ON preference_profiles
WHEN NEW.default_context_id IS NULL
  OR NOT EXISTS (
    SELECT 1
    FROM preference_contexts
    WHERE preference_contexts.id = NEW.default_context_id
      AND preference_contexts.profile_id = NEW.id
      AND preference_contexts.is_default = 1
      AND preference_contexts.active = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'preference default context pointer is invalid');
END;
