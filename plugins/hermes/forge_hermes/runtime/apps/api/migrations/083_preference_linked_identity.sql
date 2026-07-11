CREATE TEMP TABLE preference_item_duplicate_map (
  duplicate_id TEXT PRIMARY KEY,
  survivor_id TEXT NOT NULL
);

INSERT INTO preference_item_duplicate_map (duplicate_id, survivor_id)
SELECT id, survivor_id
FROM (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY profile_id, source_entity_type, source_entity_id
      ORDER BY created_at ASC, id ASC
    ) AS survivor_id,
    ROW_NUMBER() OVER (
      PARTITION BY profile_id, source_entity_type, source_entity_id
      ORDER BY created_at ASC, id ASC
    ) AS duplicate_rank
  FROM preference_items
  WHERE source_entity_type IS NOT NULL
    AND source_entity_id IS NOT NULL
)
WHERE duplicate_rank > 1;

DELETE FROM pairwise_judgments
WHERE COALESCE(
        (SELECT survivor_id FROM preference_item_duplicate_map WHERE duplicate_id = left_item_id),
        left_item_id
      ) = COALESCE(
        (SELECT survivor_id FROM preference_item_duplicate_map WHERE duplicate_id = right_item_id),
        right_item_id
      );

UPDATE pairwise_judgments
SET left_item_id = COALESCE(
      (SELECT survivor_id FROM preference_item_duplicate_map WHERE duplicate_id = left_item_id),
      left_item_id
    ),
    right_item_id = COALESCE(
      (SELECT survivor_id FROM preference_item_duplicate_map WHERE duplicate_id = right_item_id),
      right_item_id
    )
WHERE left_item_id IN (SELECT duplicate_id FROM preference_item_duplicate_map)
   OR right_item_id IN (SELECT duplicate_id FROM preference_item_duplicate_map);

UPDATE absolute_signals
SET item_id = (
  SELECT survivor_id
  FROM preference_item_duplicate_map
  WHERE duplicate_id = absolute_signals.item_id
)
WHERE item_id IN (SELECT duplicate_id FROM preference_item_duplicate_map);

UPDATE preference_item_scores
SET manual_status = COALESCE(
      manual_status,
      (
        SELECT duplicate_score.manual_status
        FROM preference_item_scores AS duplicate_score
        JOIN preference_item_duplicate_map AS duplicate_map
          ON duplicate_map.duplicate_id = duplicate_score.item_id
        WHERE duplicate_map.survivor_id = preference_item_scores.item_id
          AND duplicate_score.context_id = preference_item_scores.context_id
          AND duplicate_score.manual_status IS NOT NULL
        ORDER BY duplicate_score.updated_at DESC, duplicate_score.id ASC
        LIMIT 1
      )
    ),
    manual_score = COALESCE(
      manual_score,
      (
        SELECT duplicate_score.manual_score
        FROM preference_item_scores AS duplicate_score
        JOIN preference_item_duplicate_map AS duplicate_map
          ON duplicate_map.duplicate_id = duplicate_score.item_id
        WHERE duplicate_map.survivor_id = preference_item_scores.item_id
          AND duplicate_score.context_id = preference_item_scores.context_id
          AND duplicate_score.manual_score IS NOT NULL
        ORDER BY duplicate_score.updated_at DESC, duplicate_score.id ASC
        LIMIT 1
      )
    ),
    confidence_lock = CASE
      WHEN confidence_lock IS NULL
       AND (
         SELECT MAX(duplicate_score.confidence_lock)
         FROM preference_item_scores AS duplicate_score
         JOIN preference_item_duplicate_map AS duplicate_map
           ON duplicate_map.duplicate_id = duplicate_score.item_id
         WHERE duplicate_map.survivor_id = preference_item_scores.item_id
           AND duplicate_score.context_id = preference_item_scores.context_id
       ) IS NULL
      THEN NULL
      ELSE MAX(
        COALESCE(confidence_lock, 0),
        COALESCE(
          (
            SELECT MAX(duplicate_score.confidence_lock)
            FROM preference_item_scores AS duplicate_score
            JOIN preference_item_duplicate_map AS duplicate_map
              ON duplicate_map.duplicate_id = duplicate_score.item_id
            WHERE duplicate_map.survivor_id = preference_item_scores.item_id
              AND duplicate_score.context_id = preference_item_scores.context_id
          ),
          0
        )
      )
    END,
    bookmarked = MAX(
      bookmarked,
      COALESCE(
        (
          SELECT MAX(duplicate_score.bookmarked)
          FROM preference_item_scores AS duplicate_score
          JOIN preference_item_duplicate_map AS duplicate_map
            ON duplicate_map.duplicate_id = duplicate_score.item_id
          WHERE duplicate_map.survivor_id = preference_item_scores.item_id
            AND duplicate_score.context_id = preference_item_scores.context_id
        ),
        0
      )
    ),
    compare_later = MAX(
      compare_later,
      COALESCE(
        (
          SELECT MAX(duplicate_score.compare_later)
          FROM preference_item_scores AS duplicate_score
          JOIN preference_item_duplicate_map AS duplicate_map
            ON duplicate_map.duplicate_id = duplicate_score.item_id
          WHERE duplicate_map.survivor_id = preference_item_scores.item_id
            AND duplicate_score.context_id = preference_item_scores.context_id
        ),
        0
      )
    ),
    frozen = MAX(
      frozen,
      COALESCE(
        (
          SELECT MAX(duplicate_score.frozen)
          FROM preference_item_scores AS duplicate_score
          JOIN preference_item_duplicate_map AS duplicate_map
            ON duplicate_map.duplicate_id = duplicate_score.item_id
          WHERE duplicate_map.survivor_id = preference_item_scores.item_id
            AND duplicate_score.context_id = preference_item_scores.context_id
        ),
        0
      )
    ),
    updated_at = MAX(
      updated_at,
      COALESCE(
        (
          SELECT MAX(duplicate_score.updated_at)
          FROM preference_item_scores AS duplicate_score
          JOIN preference_item_duplicate_map AS duplicate_map
            ON duplicate_map.duplicate_id = duplicate_score.item_id
          WHERE duplicate_map.survivor_id = preference_item_scores.item_id
            AND duplicate_score.context_id = preference_item_scores.context_id
        ),
        updated_at
      )
    )
WHERE item_id IN (SELECT survivor_id FROM preference_item_duplicate_map);

DELETE FROM preference_item_scores
WHERE item_id IN (SELECT duplicate_id FROM preference_item_duplicate_map)
  AND EXISTS (
    SELECT 1
    FROM preference_item_duplicate_map AS duplicate_map
    JOIN preference_item_scores AS survivor_score
      ON survivor_score.item_id = duplicate_map.survivor_id
     AND survivor_score.context_id = preference_item_scores.context_id
    WHERE duplicate_map.duplicate_id = preference_item_scores.item_id
  );

UPDATE preference_item_scores
SET item_id = (
  SELECT survivor_id
  FROM preference_item_duplicate_map
  WHERE duplicate_id = preference_item_scores.item_id
)
WHERE item_id IN (SELECT duplicate_id FROM preference_item_duplicate_map);

UPDATE activity_events
SET entity_id = (
  SELECT survivor_id
  FROM preference_item_duplicate_map
  WHERE duplicate_id = activity_events.entity_id
)
WHERE entity_type = 'preference_item'
  AND entity_id IN (SELECT duplicate_id FROM preference_item_duplicate_map);

UPDATE diagnostic_logs
SET entity_id = (
  SELECT survivor_id
  FROM preference_item_duplicate_map
  WHERE duplicate_id = diagnostic_logs.entity_id
)
WHERE entity_type = 'preference_item'
  AND entity_id IN (SELECT duplicate_id FROM preference_item_duplicate_map);

INSERT OR IGNORE INTO note_links (
  note_id, entity_type, entity_id, anchor_key, created_at
)
SELECT
  note_links.note_id,
  note_links.entity_type,
  preference_item_duplicate_map.survivor_id,
  note_links.anchor_key,
  note_links.created_at
FROM note_links
JOIN preference_item_duplicate_map
  ON preference_item_duplicate_map.duplicate_id = note_links.entity_id
WHERE note_links.entity_type = 'preference_item';

DELETE FROM note_links
WHERE entity_type = 'preference_item'
  AND entity_id IN (SELECT duplicate_id FROM preference_item_duplicate_map);

INSERT OR IGNORE INTO wiki_link_edges (
  source_note_id, target_type, target_note_id, target_entity_type,
  target_entity_id, label, raw_target, is_embed, created_at, updated_at
)
SELECT
  wiki_link_edges.source_note_id,
  wiki_link_edges.target_type,
  wiki_link_edges.target_note_id,
  wiki_link_edges.target_entity_type,
  preference_item_duplicate_map.survivor_id,
  wiki_link_edges.label,
  wiki_link_edges.raw_target,
  wiki_link_edges.is_embed,
  wiki_link_edges.created_at,
  wiki_link_edges.updated_at
FROM wiki_link_edges
JOIN preference_item_duplicate_map
  ON preference_item_duplicate_map.duplicate_id = wiki_link_edges.target_entity_id
WHERE wiki_link_edges.target_entity_type = 'preference_item';

DELETE FROM wiki_link_edges
WHERE target_entity_type = 'preference_item'
  AND target_entity_id IN (SELECT duplicate_id FROM preference_item_duplicate_map);

INSERT OR IGNORE INTO entity_links (
  source_entity_type, source_entity_id, target_entity_type, target_entity_id,
  anchor_key, relationship, created_by_actor, created_at
)
SELECT
  entity_links.source_entity_type,
  COALESCE(
    source_map.survivor_id,
    entity_links.source_entity_id
  ),
  entity_links.target_entity_type,
  COALESCE(
    target_map.survivor_id,
    entity_links.target_entity_id
  ),
  entity_links.anchor_key,
  entity_links.relationship,
  entity_links.created_by_actor,
  entity_links.created_at
FROM entity_links
LEFT JOIN preference_item_duplicate_map AS source_map
  ON entity_links.source_entity_type = 'preference_item'
 AND source_map.duplicate_id = entity_links.source_entity_id
LEFT JOIN preference_item_duplicate_map AS target_map
  ON entity_links.target_entity_type = 'preference_item'
 AND target_map.duplicate_id = entity_links.target_entity_id
WHERE source_map.duplicate_id IS NOT NULL
   OR target_map.duplicate_id IS NOT NULL;

DELETE FROM entity_links
WHERE (source_entity_type = 'preference_item'
       AND source_entity_id IN (SELECT duplicate_id FROM preference_item_duplicate_map))
   OR (target_entity_type = 'preference_item'
       AND target_entity_id IN (SELECT duplicate_id FROM preference_item_duplicate_map));

INSERT OR IGNORE INTO entity_owners (
  entity_type, entity_id, user_id, role, created_at, updated_at
)
SELECT
  entity_owners.entity_type,
  preference_item_duplicate_map.survivor_id,
  entity_owners.user_id,
  entity_owners.role,
  entity_owners.created_at,
  entity_owners.updated_at
FROM entity_owners
JOIN preference_item_duplicate_map
  ON preference_item_duplicate_map.duplicate_id = entity_owners.entity_id
WHERE entity_owners.entity_type = 'preference_item';

DELETE FROM entity_owners
WHERE entity_type = 'preference_item'
  AND entity_id IN (SELECT duplicate_id FROM preference_item_duplicate_map);

DELETE FROM entity_pins
WHERE entity_type = 'preference_item'
  AND entity_id IN (SELECT duplicate_id FROM preference_item_duplicate_map)
  AND EXISTS (
    SELECT 1
    FROM preference_item_duplicate_map
    JOIN entity_pins AS survivor_pin
      ON survivor_pin.entity_type = 'preference_item'
     AND survivor_pin.entity_id = preference_item_duplicate_map.survivor_id
     AND survivor_pin.owner_user_id = entity_pins.owner_user_id
    WHERE preference_item_duplicate_map.duplicate_id = entity_pins.entity_id
  );

UPDATE entity_pins
SET entity_id = (
  SELECT survivor_id
  FROM preference_item_duplicate_map
  WHERE duplicate_id = entity_pins.entity_id
)
WHERE entity_type = 'preference_item'
  AND entity_id IN (SELECT duplicate_id FROM preference_item_duplicate_map);

UPDATE entity_pin_events
SET entity_id = (
  SELECT survivor_id
  FROM preference_item_duplicate_map
  WHERE duplicate_id = entity_pin_events.entity_id
)
WHERE entity_type = 'preference_item'
  AND entity_id IN (SELECT duplicate_id FROM preference_item_duplicate_map);

UPDATE entity_recent_views
SET view_count = view_count + COALESCE(
      (
        SELECT SUM(duplicate_view.view_count)
        FROM entity_recent_views AS duplicate_view
        JOIN preference_item_duplicate_map
          ON preference_item_duplicate_map.duplicate_id = duplicate_view.entity_id
        WHERE duplicate_view.entity_type = 'preference_item'
          AND preference_item_duplicate_map.survivor_id = entity_recent_views.entity_id
          AND duplicate_view.actor_key = entity_recent_views.actor_key
      ),
      0
    ),
    first_viewed_at = MIN(
      first_viewed_at,
      COALESCE(
        (
          SELECT MIN(duplicate_view.first_viewed_at)
          FROM entity_recent_views AS duplicate_view
          JOIN preference_item_duplicate_map
            ON preference_item_duplicate_map.duplicate_id = duplicate_view.entity_id
          WHERE duplicate_view.entity_type = 'preference_item'
            AND preference_item_duplicate_map.survivor_id = entity_recent_views.entity_id
            AND duplicate_view.actor_key = entity_recent_views.actor_key
        ),
        first_viewed_at
      )
    ),
    last_viewed_at = MAX(
      last_viewed_at,
      COALESCE(
        (
          SELECT MAX(duplicate_view.last_viewed_at)
          FROM entity_recent_views AS duplicate_view
          JOIN preference_item_duplicate_map
            ON preference_item_duplicate_map.duplicate_id = duplicate_view.entity_id
          WHERE duplicate_view.entity_type = 'preference_item'
            AND preference_item_duplicate_map.survivor_id = entity_recent_views.entity_id
            AND duplicate_view.actor_key = entity_recent_views.actor_key
        ),
        last_viewed_at
      )
    )
WHERE entity_type = 'preference_item'
  AND entity_id IN (SELECT survivor_id FROM preference_item_duplicate_map);

DELETE FROM entity_recent_views
WHERE entity_type = 'preference_item'
  AND entity_id IN (SELECT duplicate_id FROM preference_item_duplicate_map)
  AND EXISTS (
    SELECT 1
    FROM preference_item_duplicate_map
    JOIN entity_recent_views AS survivor_view
      ON survivor_view.entity_type = 'preference_item'
     AND survivor_view.entity_id = preference_item_duplicate_map.survivor_id
     AND survivor_view.actor_key = entity_recent_views.actor_key
    WHERE preference_item_duplicate_map.duplicate_id = entity_recent_views.entity_id
  );

UPDATE entity_recent_views
SET entity_id = (
  SELECT survivor_id
  FROM preference_item_duplicate_map
  WHERE duplicate_id = entity_recent_views.entity_id
)
WHERE entity_type = 'preference_item'
  AND entity_id IN (SELECT duplicate_id FROM preference_item_duplicate_map);

UPDATE wiki_ingest_job_candidates
SET published_entity_id = (
  SELECT survivor_id
  FROM preference_item_duplicate_map
  WHERE duplicate_id = wiki_ingest_job_candidates.published_entity_id
)
WHERE published_entity_type = 'preference_item'
  AND published_entity_id IN (SELECT duplicate_id FROM preference_item_duplicate_map);

DELETE FROM preference_items
WHERE id IN (SELECT duplicate_id FROM preference_item_duplicate_map);

CREATE UNIQUE INDEX IF NOT EXISTS idx_preference_items_linked_identity
  ON preference_items(profile_id, source_entity_type, source_entity_id)
  WHERE source_entity_type IS NOT NULL
    AND source_entity_id IS NOT NULL;

DROP TABLE preference_item_duplicate_map;
