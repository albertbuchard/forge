CREATE TABLE IF NOT EXISTS artifact_pending_blob_cleanups (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  stored_content_sha256 TEXT NOT NULL,
  stored_byte_size INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifact_pending_blob_cleanups_created
  ON artifact_pending_blob_cleanups (created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_artifact_pending_blob_cleanups_storage
  ON artifact_pending_blob_cleanups (storage_key, created_at ASC);

-- Deleted Artifact snapshots predate the public DTO boundary. Preserve their
-- reviewable metadata while removing physical locators and extracted text.
UPDATE deleted_entities
SET snapshot_json = json_set(
  snapshot_json,
  '$.scanResults.extractedTextAvailable',
  json(
    CASE
      WHEN COALESCE(json_extract(snapshot_json, '$.contentProtection.mode'), 'plaintext') = 'plaintext'
        AND length(COALESCE(json_extract(snapshot_json, '$.scanResults.extractedTextSample'), '')) > 0
      THEN 'true'
      ELSE 'false'
    END
  )
)
WHERE entity_type = 'artifact'
  AND json_valid(snapshot_json)
  AND json_type(snapshot_json, '$.scanResults.extractedTextSample') IS NOT NULL;

UPDATE deleted_entities
SET snapshot_json = json_set(
  snapshot_json,
  '$.enrichmentResults.errorCode',
  'artifact_llm_enrichment_failed'
)
WHERE entity_type = 'artifact'
  AND json_valid(snapshot_json)
  AND json_extract(snapshot_json, '$.enrichmentResults.status') = 'failed'
  AND json_type(snapshot_json, '$.enrichmentResults.error') IS NOT NULL;

UPDATE deleted_entities
SET snapshot_json = json_remove(
  snapshot_json,
  '$.storageKey',
  '$.storagePath',
  '$.storage_key',
  '$.storage_path',
  '$.scanResults.extractedTextSample',
  '$.scan_results.extractedTextSample',
  '$.scan_results.extracted_text_sample',
  '$.enrichmentResults.error',
  '$.enrichmentResults.responseBody',
  '$.enrichmentResults.rawProviderBody',
  '$.enrichmentResults.rawProviderOutput',
  '$.artifact.storageKey',
  '$.artifact.storagePath',
  '$.artifact.scanResults.extractedTextSample'
)
WHERE entity_type = 'artifact'
  AND json_valid(snapshot_json);

-- Legacy failed enrichment rows may contain an upstream response in `error`.
-- Keep only a stable machine-readable failure code.
UPDATE artifacts
SET enrichment_results_json = json_set(
  enrichment_results_json,
  '$.errorCode',
  'artifact_llm_enrichment_failed'
)
WHERE json_valid(enrichment_results_json)
  AND json_extract(enrichment_results_json, '$.status') = 'failed'
  AND json_type(enrichment_results_json, '$.error') IS NOT NULL;

UPDATE artifacts
SET enrichment_results_json = json_remove(
  enrichment_results_json,
  '$.error',
  '$.responseBody',
  '$.rawProviderBody',
  '$.rawProviderOutput'
)
WHERE json_valid(enrichment_results_json);

UPDATE artifact_versions
SET enrichment_results_json = json_set(
  enrichment_results_json,
  '$.errorCode',
  'artifact_llm_enrichment_failed'
)
WHERE json_valid(enrichment_results_json)
  AND json_extract(enrichment_results_json, '$.status') = 'failed'
  AND json_type(enrichment_results_json, '$.error') IS NOT NULL;

UPDATE artifact_versions
SET enrichment_results_json = json_remove(
  enrichment_results_json,
  '$.error',
  '$.responseBody',
  '$.rawProviderBody',
  '$.rawProviderOutput'
)
WHERE json_valid(enrichment_results_json);

UPDATE artifact_audit_events
SET metadata_json = json_set(
  metadata_json,
  '$.errorCode',
  'artifact_llm_enrichment_failed'
)
WHERE event_type = 'artifact.enrichment_failed'
  AND json_valid(metadata_json)
  AND json_type(metadata_json, '$.error') IS NOT NULL;

UPDATE artifact_audit_events
SET metadata_json = json_remove(
  metadata_json,
  '$.storageKey',
  '$.storagePath',
  '$.blobKey',
  '$.blobPath',
  '$.filePath',
  '$.temporaryPath',
  '$.tempPath',
  '$.extractedTextSample',
  '$.error',
  '$.responseBody',
  '$.rawProviderBody',
  '$.rawProviderOutput'
)
WHERE json_valid(metadata_json);

UPDATE event_log
SET metadata_json = json_set(
  metadata_json,
  '$.errorCode',
  'artifact_llm_enrichment_failed'
)
WHERE entity_type = 'artifact'
  AND event_kind = 'artifact.enrichment_failed'
  AND json_valid(metadata_json)
  AND json_type(metadata_json, '$.error') IS NOT NULL;

UPDATE event_log
SET metadata_json = json_remove(
  metadata_json,
  '$.storageKey',
  '$.storagePath',
  '$.blobKey',
  '$.blobPath',
  '$.filePath',
  '$.temporaryPath',
  '$.tempPath',
  '$.extractedTextSample',
  '$.error',
  '$.responseBody',
  '$.rawProviderBody',
  '$.rawProviderOutput'
)
WHERE entity_type = 'artifact'
  AND json_valid(metadata_json);
