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

INSERT INTO entity_owners (
  entity_type,
  entity_id,
  user_id,
  role,
  created_at,
  updated_at
)
SELECT
  'preference_item',
  preference_items.id,
  preference_profiles.user_id,
  'owner',
  preference_items.created_at,
  preference_items.updated_at
FROM preference_items
INNER JOIN preference_profiles
  ON preference_profiles.id = preference_items.profile_id
WHERE true
ON CONFLICT(entity_type, entity_id) DO UPDATE SET
  user_id = excluded.user_id,
  role = excluded.role,
  updated_at = excluded.updated_at;

INSERT INTO entity_owners (
  entity_type,
  entity_id,
  user_id,
  role,
  created_at,
  updated_at
)
SELECT
  'preference_signal',
  absolute_signals.id,
  absolute_signals.user_id,
  'owner',
  absolute_signals.created_at,
  absolute_signals.created_at
FROM absolute_signals
WHERE true
ON CONFLICT(entity_type, entity_id) DO UPDATE SET
  user_id = excluded.user_id,
  role = excluded.role,
  updated_at = excluded.updated_at;
