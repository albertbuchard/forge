-- Preserve every existing canonical owner. For unowned artifacts, a valid
-- acting-for user wins; otherwise a valid uploader is used. Conflicting valid
-- values are therefore deterministic, while null, blank, or unknown values
-- remain unowned for scoped access instead of being guessed.
WITH artifact_owner_candidates AS (
  SELECT
    artifacts.id AS artifact_id,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM users
        WHERE users.id = NULLIF(trim(artifacts.acting_for_user_id), '')
      ) THEN NULLIF(trim(artifacts.acting_for_user_id), '')
      WHEN EXISTS (
        SELECT 1
        FROM users
        WHERE users.id = NULLIF(trim(artifacts.uploaded_by_user_id), '')
      ) THEN NULLIF(trim(artifacts.uploaded_by_user_id), '')
      ELSE NULL
    END AS owner_user_id,
    artifacts.created_at,
    artifacts.updated_at
  FROM artifacts
)
INSERT OR IGNORE INTO entity_owners (
  entity_type,
  entity_id,
  user_id,
  role,
  created_at,
  updated_at
)
SELECT
  'artifact',
  artifact_id,
  owner_user_id,
  'owner',
  created_at,
  updated_at
FROM artifact_owner_candidates
WHERE owner_user_id IS NOT NULL;

-- Legacy scanner rows could contain a plaintext sample. Keep only the
-- truthful availability fact; encrypted rows cannot make text available.
UPDATE artifacts
SET scan_results_json = json_set(
  scan_results_json,
  '$.extractedTextAvailable',
  json('true')
)
WHERE json_valid(scan_results_json)
  AND content_protection_mode = 'plaintext'
  AND length(COALESCE(json_extract(scan_results_json, '$.extractedTextSample'), '')) > 0;

UPDATE artifacts
SET scan_results_json = json_set(
  scan_results_json,
  '$.extractedTextAvailable',
  json('false')
)
WHERE json_valid(scan_results_json)
  AND json_type(scan_results_json, '$.extractedTextSample') IS NOT NULL
  AND NOT (
    content_protection_mode = 'plaintext'
    AND length(COALESCE(json_extract(scan_results_json, '$.extractedTextSample'), '')) > 0
  );

UPDATE artifacts
SET scan_results_json = json_remove(
  scan_results_json,
  '$.extractedTextSample'
)
WHERE json_valid(scan_results_json)
  AND json_type(scan_results_json, '$.extractedTextSample') IS NOT NULL;

UPDATE artifact_versions
SET scan_results_json = json_set(
  scan_results_json,
  '$.extractedTextAvailable',
  json('true')
)
WHERE json_valid(scan_results_json)
  AND content_protection_mode = 'plaintext'
  AND length(COALESCE(json_extract(scan_results_json, '$.extractedTextSample'), '')) > 0;

UPDATE artifact_versions
SET scan_results_json = json_set(
  scan_results_json,
  '$.extractedTextAvailable',
  json('false')
)
WHERE json_valid(scan_results_json)
  AND json_type(scan_results_json, '$.extractedTextSample') IS NOT NULL
  AND NOT (
    content_protection_mode = 'plaintext'
    AND length(COALESCE(json_extract(scan_results_json, '$.extractedTextSample'), '')) > 0
  );

UPDATE artifact_versions
SET scan_results_json = json_remove(
  scan_results_json,
  '$.extractedTextSample'
)
WHERE json_valid(scan_results_json)
  AND json_type(scan_results_json, '$.extractedTextSample') IS NOT NULL;
