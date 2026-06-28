CREATE TABLE IF NOT EXISTS artifact_blobs (
  content_sha256 TEXT PRIMARY KEY,
  storage_key TEXT NOT NULL UNIQUE,
  byte_size INTEGER NOT NULL,
  detected_mime_type TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  short_description TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  original_file_name TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  detected_extension TEXT NOT NULL,
  declared_mime_type TEXT NOT NULL DEFAULT '',
  detected_mime_type TEXT NOT NULL DEFAULT '',
  format_family TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'upload',
  source_label TEXT NOT NULL DEFAULT '',
  uploaded_by_user_id TEXT,
  uploaded_by_agent_id TEXT,
  acting_for_user_id TEXT,
  artifact_state TEXT NOT NULL DEFAULT 'active',
  danger_score INTEGER NOT NULL DEFAULT 0,
  danger_level TEXT NOT NULL DEFAULT 'low',
  download_policy TEXT NOT NULL DEFAULT 'human_only',
  scan_results_json TEXT NOT NULL DEFAULT '{}',
  enrichment_results_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (content_sha256) REFERENCES artifact_blobs(content_sha256)
);

CREATE INDEX IF NOT EXISTS idx_artifacts_updated
  ON artifacts (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_artifacts_state_danger
  ON artifacts (artifact_state, danger_level, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_artifacts_sha
  ON artifacts (content_sha256, updated_at DESC);

CREATE TABLE IF NOT EXISTS artifact_versions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  content_sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  original_file_name TEXT NOT NULL,
  scan_results_json TEXT NOT NULL DEFAULT '{}',
  enrichment_results_json TEXT NOT NULL DEFAULT '{}',
  created_by_actor TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE,
  FOREIGN KEY (content_sha256) REFERENCES artifact_blobs(content_sha256),
  UNIQUE (artifact_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact
  ON artifact_versions (artifact_id, version_number DESC);

CREATE TABLE IF NOT EXISTS entity_links (
  source_entity_type TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  target_entity_type TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  anchor_key TEXT NOT NULL DEFAULT '',
  relationship TEXT NOT NULL DEFAULT 'related',
  created_by_actor TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (
    source_entity_type,
    source_entity_id,
    target_entity_type,
    target_entity_id,
    anchor_key,
    relationship
  )
);

CREATE INDEX IF NOT EXISTS idx_entity_links_source
  ON entity_links (source_entity_type, source_entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_entity_links_target
  ON entity_links (target_entity_type, target_entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS artifact_audit_events (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT,
  source TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_artifact_audit_events_artifact
  ON artifact_audit_events (artifact_id, created_at DESC);
