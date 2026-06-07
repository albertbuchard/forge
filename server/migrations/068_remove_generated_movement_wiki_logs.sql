UPDATE movement_stays
SET published_note_id = NULL
WHERE published_note_id IS NOT NULL;

UPDATE movement_trips
SET published_note_id = NULL
WHERE published_note_id IS NOT NULL;

DELETE FROM notes
WHERE source = 'system'
  AND kind = 'evidence'
  AND json_extract(frontmatter_json, '$.movement.kind') IN ('stay', 'trip');
