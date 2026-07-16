CREATE TABLE IF NOT EXISTS artifact_pending_blob_cleanup_provenance (
  cleanup_id TEXT PRIMARY KEY,
  blob_created_by_operation INTEGER NOT NULL DEFAULT 0
    CHECK (blob_created_by_operation IN (0, 1)),
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (cleanup_id)
    REFERENCES artifact_pending_blob_cleanups(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS artifact_blob_retentions (
  storage_key TEXT PRIMARY KEY,
  artifact_id TEXT,
  content_sha256 TEXT NOT NULL,
  reason TEXT NOT NULL,
  retained_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifact_blob_retentions_artifact
  ON artifact_blob_retentions (artifact_id, retained_at);

-- artifact_blobs rows without current metadata references predate explicit
-- retention records. Preserve them rather than guessing that they are garbage.
INSERT OR IGNORE INTO artifact_blob_retentions (
  storage_key,
  artifact_id,
  content_sha256,
  reason,
  retained_at
)
SELECT
  artifact_blobs.storage_key,
  NULL,
  artifact_blobs.content_sha256,
  'legacy_unreferenced_blob_preserved',
  artifact_blobs.created_at
FROM artifact_blobs
WHERE artifact_blobs.storage_key <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM artifacts
    WHERE artifacts.storage_key = artifact_blobs.storage_key
  )
  AND NOT EXISTS (
    SELECT 1
    FROM artifact_versions
    WHERE artifact_versions.storage_key = artifact_blobs.storage_key
  );

-- Normalize every public Artifact JSON surface through one recursive workset.
-- Sensitive keys are found at any nesting depth, including inside arrays.
DROP TABLE IF EXISTS temp.artifact_recursive_cleanup;
CREATE TEMP TABLE artifact_recursive_cleanup (
  source TEXT NOT NULL,
  row_key TEXT NOT NULL,
  document TEXT NOT NULL,
  PRIMARY KEY (source, row_key)
);

INSERT INTO artifact_recursive_cleanup (source, row_key, document)
SELECT 'artifacts.enrichment_results_json', id, enrichment_results_json
FROM artifacts
WHERE json_valid(enrichment_results_json)
UNION ALL
SELECT 'artifacts.metadata_json', id, metadata_json
FROM artifacts
WHERE json_valid(metadata_json)
UNION ALL
SELECT 'artifacts.scan_results_json', id, scan_results_json
FROM artifacts
WHERE json_valid(scan_results_json)
UNION ALL
SELECT 'artifact_versions.enrichment_results_json', id, enrichment_results_json
FROM artifact_versions
WHERE json_valid(enrichment_results_json)
UNION ALL
SELECT 'artifact_versions.scan_results_json', id, scan_results_json
FROM artifact_versions
WHERE json_valid(scan_results_json)
UNION ALL
SELECT 'artifact_audit_events.metadata_json', id, metadata_json
FROM artifact_audit_events
WHERE json_valid(metadata_json)
UNION ALL
SELECT 'deleted_entities.snapshot_json', entity_id, snapshot_json
FROM deleted_entities
WHERE entity_type = 'artifact' AND json_valid(snapshot_json)
UNION ALL
SELECT 'event_log.metadata_json', id, metadata_json
FROM event_log
WHERE entity_type = 'artifact' AND json_valid(metadata_json);

WITH RECURSIVE
json_nodes AS (
  SELECT
    cleanup.source,
    cleanup.row_key,
    tree.id,
    tree.parent,
    tree.fullkey,
    lower(
      replace(
        replace(
          replace(CAST(tree.key AS TEXT), '_', ''),
          '-',
          ''
        ),
        ' ',
        ''
      )
    ) AS normalized_key,
    tree.type,
    tree.atom
  FROM artifact_recursive_cleanup AS cleanup,
       json_tree(cleanup.document) AS tree
  WHERE tree.key IS NOT NULL
),
classified_nodes AS (
  SELECT
    nodes.*,
    CASE
      WHEN normalized_key IN (
        'storagepath',
        'storagekey',
        'blobpath',
        'blobkey',
        'filepath',
        'temporarypath',
        'temppath'
      ) THEN 'locator'
      WHEN normalized_key = 'extractedtextsample' THEN 'extracted_text'
      WHEN normalized_key IN (
        'error',
        'errormessage',
        'errorcontext',
        'errordetail',
        'errordetails',
        'rawerrorcontext',
        'providererror',
        'providerexception',
        'providercontext',
        'providerresponse',
        'providerresponsebody',
        'providerdetails',
        'exception',
        'stack',
        'stacktrace',
        'cause',
        'responsebody',
        'rawresponsebody',
        'rawproviderbody',
        'rawprovideroutput'
      ) THEN 'failure'
      ELSE NULL
    END AS sensitive_kind
  FROM json_nodes AS nodes
),
raw_operations AS (
  SELECT
    node.source,
    node.row_key,
    0 AS priority,
    'set_error_code' AS operation,
    CASE
      WHEN parent.fullkey = '$' THEN '$.errorCode'
      ELSE parent.fullkey || '.errorCode'
    END AS path,
    length(node.fullkey) AS depth,
    0 AS truthy
  FROM classified_nodes AS node
  INNER JOIN json_nodes AS parent
    ON parent.source = node.source
   AND parent.row_key = node.row_key
   AND parent.id = node.parent
  WHERE node.sensitive_kind = 'failure'

  UNION ALL

  SELECT
    node.source,
    node.row_key,
    0 AS priority,
    'set_extracted_available' AS operation,
    CASE
      WHEN parent.fullkey = '$' THEN '$.extractedTextAvailable'
      ELSE parent.fullkey || '.extractedTextAvailable'
    END AS path,
    length(node.fullkey) AS depth,
    CASE
      WHEN node.type = 'text' AND length(COALESCE(node.atom, '')) > 0 THEN 1
      ELSE 0
    END AS truthy
  FROM classified_nodes AS node
  INNER JOIN json_nodes AS parent
    ON parent.source = node.source
   AND parent.row_key = node.row_key
   AND parent.id = node.parent
  WHERE node.sensitive_kind = 'extracted_text'

  UNION ALL

  SELECT
    node.source,
    node.row_key,
    1 AS priority,
    'remove' AS operation,
    node.fullkey AS path,
    length(node.fullkey) AS depth,
    0 AS truthy
  FROM classified_nodes AS node
  WHERE node.sensitive_kind IS NOT NULL
),
deduplicated_operations AS (
  SELECT
    source,
    row_key,
    priority,
    operation,
    path,
    max(depth) AS depth,
    max(truthy) AS truthy
  FROM raw_operations
  GROUP BY source, row_key, priority, operation, path
),
ordered_operations AS (
  SELECT
    operations.*,
    row_number() OVER (
      PARTITION BY source, row_key
      ORDER BY priority ASC, depth DESC, path DESC, operation ASC
    ) AS sequence
  FROM deduplicated_operations AS operations
),
rewritten_documents(source, row_key, sequence, document) AS (
  SELECT source, row_key, 0, document
  FROM artifact_recursive_cleanup

  UNION ALL

  SELECT
    rewritten.source,
    rewritten.row_key,
    operation.sequence,
    CASE operation.operation
      WHEN 'set_error_code' THEN json_set(
        rewritten.document,
        operation.path,
        'artifact_llm_enrichment_failed'
      )
      WHEN 'set_extracted_available' THEN
        CASE operation.truthy
          WHEN 1 THEN json_set(
            rewritten.document,
            operation.path,
            json('true')
          )
          ELSE json_insert(
            rewritten.document,
            operation.path,
            json('false')
          )
        END
      ELSE json_remove(rewritten.document, operation.path)
    END
  FROM rewritten_documents AS rewritten
  INNER JOIN ordered_operations AS operation
    ON operation.source = rewritten.source
   AND operation.row_key = rewritten.row_key
   AND operation.sequence = rewritten.sequence + 1
)
UPDATE artifact_recursive_cleanup AS cleanup
SET document = COALESCE(
  (
    SELECT rewritten.document
    FROM rewritten_documents AS rewritten
    WHERE rewritten.source = cleanup.source
      AND rewritten.row_key = cleanup.row_key
    ORDER BY rewritten.sequence DESC
    LIMIT 1
  ),
  cleanup.document
);

UPDATE artifacts
SET enrichment_results_json = (
  SELECT document FROM artifact_recursive_cleanup
  WHERE source = 'artifacts.enrichment_results_json'
    AND row_key = artifacts.id
)
WHERE EXISTS (
  SELECT 1 FROM artifact_recursive_cleanup
  WHERE source = 'artifacts.enrichment_results_json'
    AND row_key = artifacts.id
);

UPDATE artifacts
SET metadata_json = (
  SELECT document FROM artifact_recursive_cleanup
  WHERE source = 'artifacts.metadata_json'
    AND row_key = artifacts.id
)
WHERE EXISTS (
  SELECT 1 FROM artifact_recursive_cleanup
  WHERE source = 'artifacts.metadata_json'
    AND row_key = artifacts.id
);

UPDATE artifacts
SET scan_results_json = (
  SELECT document FROM artifact_recursive_cleanup
  WHERE source = 'artifacts.scan_results_json'
    AND row_key = artifacts.id
)
WHERE EXISTS (
  SELECT 1 FROM artifact_recursive_cleanup
  WHERE source = 'artifacts.scan_results_json'
    AND row_key = artifacts.id
);

UPDATE artifact_versions
SET enrichment_results_json = (
  SELECT document FROM artifact_recursive_cleanup
  WHERE source = 'artifact_versions.enrichment_results_json'
    AND row_key = artifact_versions.id
)
WHERE EXISTS (
  SELECT 1 FROM artifact_recursive_cleanup
  WHERE source = 'artifact_versions.enrichment_results_json'
    AND row_key = artifact_versions.id
);

UPDATE artifact_versions
SET scan_results_json = (
  SELECT document FROM artifact_recursive_cleanup
  WHERE source = 'artifact_versions.scan_results_json'
    AND row_key = artifact_versions.id
)
WHERE EXISTS (
  SELECT 1 FROM artifact_recursive_cleanup
  WHERE source = 'artifact_versions.scan_results_json'
    AND row_key = artifact_versions.id
);

UPDATE artifact_audit_events
SET metadata_json = (
  SELECT document FROM artifact_recursive_cleanup
  WHERE source = 'artifact_audit_events.metadata_json'
    AND row_key = artifact_audit_events.id
)
WHERE EXISTS (
  SELECT 1 FROM artifact_recursive_cleanup
  WHERE source = 'artifact_audit_events.metadata_json'
    AND row_key = artifact_audit_events.id
);

UPDATE deleted_entities
SET snapshot_json = (
  SELECT document FROM artifact_recursive_cleanup
  WHERE source = 'deleted_entities.snapshot_json'
    AND row_key = deleted_entities.entity_id
)
WHERE entity_type = 'artifact'
  AND EXISTS (
    SELECT 1 FROM artifact_recursive_cleanup
    WHERE source = 'deleted_entities.snapshot_json'
      AND row_key = deleted_entities.entity_id
  );

UPDATE event_log
SET metadata_json = (
  SELECT document FROM artifact_recursive_cleanup
  WHERE source = 'event_log.metadata_json'
    AND row_key = event_log.id
)
WHERE entity_type = 'artifact'
  AND EXISTS (
    SELECT 1 FROM artifact_recursive_cleanup
    WHERE source = 'event_log.metadata_json'
      AND row_key = event_log.id
  );

DROP TABLE artifact_recursive_cleanup;
