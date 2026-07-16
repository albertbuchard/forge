-- Keep cursor pagination truthful when mutable People read-model inputs change.
-- A cursor is bound to this owner-scoped revision and must be restarted after
-- any relevant mutation; Forge never pretends to provide historical MVCC rows.

CREATE TABLE IF NOT EXISTS people_read_model_revisions (
  owner_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0
    CHECK (revision BETWEEN 0 AND 9007199254740991),
  updated_at TEXT NOT NULL
);

INSERT INTO people_read_model_revisions (owner_user_id, revision, updated_at)
SELECT owner_user_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
  SELECT user_id AS owner_user_id FROM people
  UNION
  SELECT owner_user_id FROM peer_relationships
  UNION
  SELECT owner_user_id FROM peer_remote_records
)
WHERE true
ON CONFLICT(owner_user_id) DO NOTHING;

-- Migration 100 can exist in unreleased development databases with stale
-- same-name trigger bodies. The migration runner wraps this whole file in one
-- transaction, so replace every owned trigger instead of trusting its name.
DROP TRIGGER IF EXISTS trg_people_read_model_person_insert;
DROP TRIGGER IF EXISTS trg_people_read_model_person_update;
DROP TRIGGER IF EXISTS trg_people_read_model_person_delete;
DROP TRIGGER IF EXISTS trg_people_read_model_alias_insert;
DROP TRIGGER IF EXISTS trg_people_read_model_alias_update;
DROP TRIGGER IF EXISTS trg_people_read_model_alias_delete;
DROP TRIGGER IF EXISTS trg_people_read_model_fact_insert;
DROP TRIGGER IF EXISTS trg_people_read_model_fact_update;
DROP TRIGGER IF EXISTS trg_people_read_model_fact_delete;
DROP TRIGGER IF EXISTS trg_people_read_model_relationship_insert;
DROP TRIGGER IF EXISTS trg_people_read_model_relationship_update;
DROP TRIGGER IF EXISTS trg_people_read_model_relationship_delete;
DROP TRIGGER IF EXISTS trg_people_read_model_remote_record_insert;
DROP TRIGGER IF EXISTS trg_people_read_model_remote_record_update;
DROP TRIGGER IF EXISTS trg_people_read_model_remote_record_delete;

CREATE TRIGGER trg_people_read_model_person_insert
AFTER INSERT ON people
BEGIN
  INSERT INTO people_read_model_revisions (owner_user_id, revision, updated_at)
  VALUES (NEW.user_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(owner_user_id) DO UPDATE SET
    revision = CASE
      WHEN people_read_model_revisions.revision >= 9007199254740991 THEN 0
      ELSE people_read_model_revisions.revision + 1
    END,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER trg_people_read_model_person_update
AFTER UPDATE OF
  id,
  user_id,
  display_name,
  normalized_display_name,
  given_name,
  middle_name,
  family_name,
  preferred_name,
  pronouns,
  relationship_category,
  relationship_label,
  closeness,
  importance,
  short_description,
  timezone,
  home_place_label,
  created_at,
  updated_at,
  deleted_at
ON people
WHEN OLD.id IS NOT NEW.id
  OR OLD.user_id IS NOT NEW.user_id
  OR OLD.display_name IS NOT NEW.display_name
  OR OLD.normalized_display_name IS NOT NEW.normalized_display_name
  OR OLD.given_name IS NOT NEW.given_name
  OR OLD.middle_name IS NOT NEW.middle_name
  OR OLD.family_name IS NOT NEW.family_name
  OR OLD.preferred_name IS NOT NEW.preferred_name
  OR OLD.pronouns IS NOT NEW.pronouns
  OR OLD.relationship_category IS NOT NEW.relationship_category
  OR OLD.relationship_label IS NOT NEW.relationship_label
  OR OLD.closeness IS NOT NEW.closeness
  OR OLD.importance IS NOT NEW.importance
  OR OLD.short_description IS NOT NEW.short_description
  OR OLD.timezone IS NOT NEW.timezone
  OR OLD.home_place_label IS NOT NEW.home_place_label
  OR OLD.created_at IS NOT NEW.created_at
  OR OLD.updated_at IS NOT NEW.updated_at
  OR OLD.deleted_at IS NOT NEW.deleted_at
BEGIN
  INSERT INTO people_read_model_revisions (owner_user_id, revision, updated_at)
  VALUES (OLD.user_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(owner_user_id) DO UPDATE SET
    revision = CASE
      WHEN people_read_model_revisions.revision >= 9007199254740991 THEN 0
      ELSE people_read_model_revisions.revision + 1
    END,
    updated_at = excluded.updated_at;

  INSERT INTO people_read_model_revisions (owner_user_id, revision, updated_at)
  SELECT NEW.user_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE NEW.user_id IS NOT OLD.user_id
  ON CONFLICT(owner_user_id) DO UPDATE SET
    revision = CASE
      WHEN people_read_model_revisions.revision >= 9007199254740991 THEN 0
      ELSE people_read_model_revisions.revision + 1
    END,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER trg_people_read_model_person_delete
AFTER DELETE ON people
BEGIN
  INSERT INTO people_read_model_revisions (owner_user_id, revision, updated_at)
  VALUES (OLD.user_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(owner_user_id) DO UPDATE SET
    revision = CASE
      WHEN people_read_model_revisions.revision >= 9007199254740991 THEN 0
      ELSE people_read_model_revisions.revision + 1
    END,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER trg_people_read_model_alias_insert
AFTER INSERT ON person_aliases
BEGIN
  INSERT INTO people_read_model_revisions (owner_user_id, revision, updated_at)
  SELECT people.user_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM people
  WHERE people.id = NEW.person_id
  ON CONFLICT(owner_user_id) DO UPDATE SET
    revision = CASE
      WHEN people_read_model_revisions.revision >= 9007199254740991 THEN 0
      ELSE people_read_model_revisions.revision + 1
    END,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER trg_people_read_model_alias_update
AFTER UPDATE OF
  id,
  person_id,
  alias,
  normalized_alias,
  kind,
  created_at,
  updated_at
ON person_aliases
WHEN OLD.id IS NOT NEW.id
  OR OLD.person_id IS NOT NEW.person_id
  OR OLD.alias IS NOT NEW.alias
  OR OLD.normalized_alias IS NOT NEW.normalized_alias
  OR OLD.kind IS NOT NEW.kind
  OR OLD.created_at IS NOT NEW.created_at
  OR OLD.updated_at IS NOT NEW.updated_at
BEGIN
  INSERT INTO people_read_model_revisions (owner_user_id, revision, updated_at)
  SELECT people.user_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM people
  WHERE people.id = OLD.person_id
  ON CONFLICT(owner_user_id) DO UPDATE SET
    revision = CASE
      WHEN people_read_model_revisions.revision >= 9007199254740991 THEN 0
      ELSE people_read_model_revisions.revision + 1
    END,
    updated_at = excluded.updated_at;

  INSERT INTO people_read_model_revisions (owner_user_id, revision, updated_at)
  SELECT people.user_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM people
  WHERE people.id = NEW.person_id
    AND NOT EXISTS (
      SELECT 1
      FROM people AS old_people
      WHERE old_people.id = OLD.person_id
        AND old_people.user_id = people.user_id
    )
  ON CONFLICT(owner_user_id) DO UPDATE SET
    revision = CASE
      WHEN people_read_model_revisions.revision >= 9007199254740991 THEN 0
      ELSE people_read_model_revisions.revision + 1
    END,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER trg_people_read_model_alias_delete
AFTER DELETE ON person_aliases
BEGIN
  INSERT INTO people_read_model_revisions (owner_user_id, revision, updated_at)
  SELECT people.user_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM people
  WHERE people.id = OLD.person_id
  ON CONFLICT(owner_user_id) DO UPDATE SET
    revision = CASE
      WHEN people_read_model_revisions.revision >= 9007199254740991 THEN 0
      ELSE people_read_model_revisions.revision + 1
    END,
    updated_at = excluded.updated_at;
END;

-- Only active basic facts are rendered by the non-private People list.
CREATE TRIGGER trg_people_read_model_fact_insert
AFTER INSERT ON person_facts
WHEN NEW.sensitivity = 'basic' AND NEW.deleted_at IS NULL
BEGIN
  INSERT INTO people_read_model_revisions (owner_user_id, revision, updated_at)
  SELECT people.user_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM people
  WHERE people.id = NEW.person_id
  ON CONFLICT(owner_user_id) DO UPDATE SET
    revision = CASE
      WHEN people_read_model_revisions.revision >= 9007199254740991 THEN 0
      ELSE people_read_model_revisions.revision + 1
    END,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER trg_people_read_model_fact_update
AFTER UPDATE OF
  id,
  person_id,
  fact_type,
  label,
  value_json,
  sensitivity,
  source_kind,
  source_entity_type,
  source_entity_id,
  observed_at,
  confidence,
  reviewed_at,
  created_at,
  updated_at,
  deleted_at
ON person_facts
WHEN (
    (
      OLD.sensitivity = 'basic' AND OLD.deleted_at IS NULL
    ) OR (
      NEW.sensitivity = 'basic' AND NEW.deleted_at IS NULL
    )
  )
  AND (
    OLD.id IS NOT NEW.id
    OR OLD.person_id IS NOT NEW.person_id
    OR OLD.fact_type IS NOT NEW.fact_type
    OR OLD.label IS NOT NEW.label
    OR OLD.value_json IS NOT NEW.value_json
    OR OLD.sensitivity IS NOT NEW.sensitivity
    OR OLD.source_kind IS NOT NEW.source_kind
    OR OLD.source_entity_type IS NOT NEW.source_entity_type
    OR OLD.source_entity_id IS NOT NEW.source_entity_id
    OR OLD.observed_at IS NOT NEW.observed_at
    OR OLD.confidence IS NOT NEW.confidence
    OR OLD.reviewed_at IS NOT NEW.reviewed_at
    OR OLD.created_at IS NOT NEW.created_at
    OR OLD.updated_at IS NOT NEW.updated_at
    OR OLD.deleted_at IS NOT NEW.deleted_at
  )
BEGIN
  INSERT INTO people_read_model_revisions (owner_user_id, revision, updated_at)
  SELECT people.user_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM people
  WHERE people.id = OLD.person_id
    AND OLD.sensitivity = 'basic'
    AND OLD.deleted_at IS NULL
  ON CONFLICT(owner_user_id) DO UPDATE SET
    revision = CASE
      WHEN people_read_model_revisions.revision >= 9007199254740991 THEN 0
      ELSE people_read_model_revisions.revision + 1
    END,
    updated_at = excluded.updated_at;

  INSERT INTO people_read_model_revisions (owner_user_id, revision, updated_at)
  SELECT people.user_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM people
  WHERE people.id = NEW.person_id
    AND NEW.sensitivity = 'basic'
    AND NEW.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM people AS old_people
      WHERE old_people.id = OLD.person_id
        AND old_people.user_id = people.user_id
        AND OLD.sensitivity = 'basic'
        AND OLD.deleted_at IS NULL
    )
  ON CONFLICT(owner_user_id) DO UPDATE SET
    revision = CASE
      WHEN people_read_model_revisions.revision >= 9007199254740991 THEN 0
      ELSE people_read_model_revisions.revision + 1
    END,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER trg_people_read_model_fact_delete
AFTER DELETE ON person_facts
WHEN OLD.sensitivity = 'basic' AND OLD.deleted_at IS NULL
BEGIN
  INSERT INTO people_read_model_revisions (owner_user_id, revision, updated_at)
  SELECT people.user_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM people
  WHERE people.id = OLD.person_id
  ON CONFLICT(owner_user_id) DO UPDATE SET
    revision = CASE
      WHEN people_read_model_revisions.revision >= 9007199254740991 THEN 0
      ELSE people_read_model_revisions.revision + 1
    END,
    updated_at = excluded.updated_at;
END;

-- Relationship transport counters and connection timestamps are not People
-- list inputs. Only a linked person's membership/status can change the list.
CREATE TRIGGER trg_people_read_model_relationship_insert
AFTER INSERT ON peer_relationships
WHEN NEW.local_person_id IS NOT NULL
BEGIN
  INSERT INTO people_read_model_revisions (owner_user_id, revision, updated_at)
  VALUES (NEW.owner_user_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(owner_user_id) DO UPDATE SET
    revision = CASE
      WHEN people_read_model_revisions.revision >= 9007199254740991 THEN 0
      ELSE people_read_model_revisions.revision + 1
    END,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER trg_people_read_model_relationship_update
AFTER UPDATE OF owner_user_id, local_person_id, status ON peer_relationships
WHEN (
    OLD.owner_user_id IS NOT NEW.owner_user_id
    OR OLD.local_person_id IS NOT NEW.local_person_id
    OR OLD.status IS NOT NEW.status
  )
  AND (OLD.local_person_id IS NOT NULL OR NEW.local_person_id IS NOT NULL)
BEGIN
  INSERT INTO people_read_model_revisions (owner_user_id, revision, updated_at)
  SELECT OLD.owner_user_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE OLD.local_person_id IS NOT NULL
  ON CONFLICT(owner_user_id) DO UPDATE SET
    revision = CASE
      WHEN people_read_model_revisions.revision >= 9007199254740991 THEN 0
      ELSE people_read_model_revisions.revision + 1
    END,
    updated_at = excluded.updated_at;

  INSERT INTO people_read_model_revisions (owner_user_id, revision, updated_at)
  SELECT NEW.owner_user_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE NEW.local_person_id IS NOT NULL
    AND (
      NEW.owner_user_id IS NOT OLD.owner_user_id
      OR OLD.local_person_id IS NULL
    )
  ON CONFLICT(owner_user_id) DO UPDATE SET
    revision = CASE
      WHEN people_read_model_revisions.revision >= 9007199254740991 THEN 0
      ELSE people_read_model_revisions.revision + 1
    END,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER trg_people_read_model_relationship_delete
AFTER DELETE ON peer_relationships
WHEN OLD.local_person_id IS NOT NULL
BEGIN
  INSERT INTO people_read_model_revisions (owner_user_id, revision, updated_at)
  VALUES (OLD.owner_user_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(owner_user_id) DO UPDATE SET
    revision = CASE
      WHEN people_read_model_revisions.revision >= 9007199254740991 THEN 0
      ELSE people_read_model_revisions.revision + 1
    END,
    updated_at = excluded.updated_at;
END;

-- Only current, query-bound calendar rows attached to active linked
-- relationships participate in People list filtering or next-event sorting.
CREATE TRIGGER trg_people_read_model_remote_record_insert
AFTER INSERT ON peer_remote_records
WHEN NEW.projection_id IN (
    'calendar.availability.v1',
    'calendar.selected_events.v1'
  )
  AND NEW.query_hash IS NOT NULL
  AND NEW.next_event_at IS NOT NULL
  AND NEW.cache_state = 'current'
  AND EXISTS (
    SELECT 1
    FROM peer_relationships
    WHERE peer_relationships.owner_user_id = NEW.owner_user_id
      AND peer_relationships.id = NEW.relationship_id
      AND peer_relationships.local_person_id IS NOT NULL
      AND peer_relationships.status = 'active'
  )
BEGIN
  INSERT INTO people_read_model_revisions (owner_user_id, revision, updated_at)
  VALUES (NEW.owner_user_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(owner_user_id) DO UPDATE SET
    revision = CASE
      WHEN people_read_model_revisions.revision >= 9007199254740991 THEN 0
      ELSE people_read_model_revisions.revision + 1
    END,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER trg_people_read_model_remote_record_update
AFTER UPDATE OF
  owner_user_id,
  relationship_id,
  projection_id,
  query_hash,
  next_event_at,
  cache_state,
  valid_until
ON peer_remote_records
WHEN (
    OLD.owner_user_id IS NOT NEW.owner_user_id
    OR OLD.relationship_id IS NOT NEW.relationship_id
    OR (
      OLD.projection_id IN (
        'calendar.availability.v1',
        'calendar.selected_events.v1'
      )
    ) IS NOT (
      NEW.projection_id IN (
        'calendar.availability.v1',
        'calendar.selected_events.v1'
      )
    )
    OR (OLD.query_hash IS NULL) IS NOT (NEW.query_hash IS NULL)
    OR OLD.next_event_at IS NOT NEW.next_event_at
    OR (OLD.cache_state = 'current') IS NOT (NEW.cache_state = 'current')
    OR OLD.valid_until IS NOT NEW.valid_until
  )
  AND (
    (
      OLD.projection_id IN (
        'calendar.availability.v1',
        'calendar.selected_events.v1'
      )
      AND OLD.query_hash IS NOT NULL
      AND OLD.next_event_at IS NOT NULL
      AND OLD.cache_state = 'current'
      AND EXISTS (
        SELECT 1
        FROM peer_relationships
        WHERE peer_relationships.owner_user_id = OLD.owner_user_id
          AND peer_relationships.id = OLD.relationship_id
          AND peer_relationships.local_person_id IS NOT NULL
          AND peer_relationships.status = 'active'
      )
    ) OR (
      NEW.projection_id IN (
        'calendar.availability.v1',
        'calendar.selected_events.v1'
      )
      AND NEW.query_hash IS NOT NULL
      AND NEW.next_event_at IS NOT NULL
      AND NEW.cache_state = 'current'
      AND EXISTS (
        SELECT 1
        FROM peer_relationships
        WHERE peer_relationships.owner_user_id = NEW.owner_user_id
          AND peer_relationships.id = NEW.relationship_id
          AND peer_relationships.local_person_id IS NOT NULL
          AND peer_relationships.status = 'active'
      )
    )
  )
BEGIN
  INSERT INTO people_read_model_revisions (owner_user_id, revision, updated_at)
  SELECT OLD.owner_user_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE OLD.projection_id IN (
      'calendar.availability.v1',
      'calendar.selected_events.v1'
    )
    AND OLD.query_hash IS NOT NULL
    AND OLD.next_event_at IS NOT NULL
    AND OLD.cache_state = 'current'
    AND EXISTS (
      SELECT 1
      FROM peer_relationships
      WHERE peer_relationships.owner_user_id = OLD.owner_user_id
        AND peer_relationships.id = OLD.relationship_id
        AND peer_relationships.local_person_id IS NOT NULL
        AND peer_relationships.status = 'active'
    )
  ON CONFLICT(owner_user_id) DO UPDATE SET
    revision = CASE
      WHEN people_read_model_revisions.revision >= 9007199254740991 THEN 0
      ELSE people_read_model_revisions.revision + 1
    END,
    updated_at = excluded.updated_at;

  INSERT INTO people_read_model_revisions (owner_user_id, revision, updated_at)
  SELECT NEW.owner_user_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE NEW.projection_id IN (
      'calendar.availability.v1',
      'calendar.selected_events.v1'
    )
    AND NEW.query_hash IS NOT NULL
    AND NEW.next_event_at IS NOT NULL
    AND NEW.cache_state = 'current'
    AND EXISTS (
      SELECT 1
      FROM peer_relationships
      WHERE peer_relationships.owner_user_id = NEW.owner_user_id
        AND peer_relationships.id = NEW.relationship_id
        AND peer_relationships.local_person_id IS NOT NULL
        AND peer_relationships.status = 'active'
    )
    AND NOT (
      NEW.owner_user_id IS OLD.owner_user_id
      AND OLD.projection_id IN (
        'calendar.availability.v1',
        'calendar.selected_events.v1'
      )
      AND OLD.query_hash IS NOT NULL
      AND OLD.next_event_at IS NOT NULL
      AND OLD.cache_state = 'current'
      AND EXISTS (
        SELECT 1
        FROM peer_relationships
        WHERE peer_relationships.owner_user_id = OLD.owner_user_id
          AND peer_relationships.id = OLD.relationship_id
          AND peer_relationships.local_person_id IS NOT NULL
          AND peer_relationships.status = 'active'
      )
    )
  ON CONFLICT(owner_user_id) DO UPDATE SET
    revision = CASE
      WHEN people_read_model_revisions.revision >= 9007199254740991 THEN 0
      ELSE people_read_model_revisions.revision + 1
    END,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER trg_people_read_model_remote_record_delete
AFTER DELETE ON peer_remote_records
WHEN OLD.projection_id IN (
    'calendar.availability.v1',
    'calendar.selected_events.v1'
  )
  AND OLD.query_hash IS NOT NULL
  AND OLD.next_event_at IS NOT NULL
  AND OLD.cache_state = 'current'
  AND EXISTS (
    SELECT 1
    FROM peer_relationships
    WHERE peer_relationships.owner_user_id = OLD.owner_user_id
      AND peer_relationships.id = OLD.relationship_id
      AND peer_relationships.local_person_id IS NOT NULL
      AND peer_relationships.status = 'active'
  )
BEGIN
  INSERT INTO people_read_model_revisions (owner_user_id, revision, updated_at)
  VALUES (OLD.owner_user_id, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(owner_user_id) DO UPDATE SET
    revision = CASE
      WHEN people_read_model_revisions.revision >= 9007199254740991 THEN 0
      ELSE people_read_model_revisions.revision + 1
    END,
    updated_at = excluded.updated_at;
END;
