ALTER TABLE artifact_blobs
  ADD COLUMN stored_content_sha256 TEXT NOT NULL DEFAULT '';

ALTER TABLE artifact_blobs
  ADD COLUMN stored_byte_size INTEGER NOT NULL DEFAULT 0;

ALTER TABLE artifact_blobs
  ADD COLUMN content_protection_mode TEXT NOT NULL DEFAULT 'plaintext';

UPDATE artifact_blobs
SET stored_content_sha256 = content_sha256
WHERE stored_content_sha256 = '';

UPDATE artifact_blobs
SET stored_byte_size = byte_size
WHERE stored_byte_size = 0;

ALTER TABLE artifacts
  ADD COLUMN stored_content_sha256 TEXT NOT NULL DEFAULT '';

ALTER TABLE artifacts
  ADD COLUMN stored_byte_size INTEGER NOT NULL DEFAULT 0;

ALTER TABLE artifacts
  ADD COLUMN content_protection_mode TEXT NOT NULL DEFAULT 'plaintext';

ALTER TABLE artifacts
  ADD COLUMN content_encryption_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE artifacts
  ADD COLUMN encrypted_at TEXT;

ALTER TABLE artifacts
  ADD COLUMN encrypted_by_actor TEXT;

ALTER TABLE artifacts
  ADD COLUMN encrypted_source TEXT NOT NULL DEFAULT '';

ALTER TABLE artifacts
  ADD COLUMN content_password_hint TEXT NOT NULL DEFAULT '';

UPDATE artifacts
SET stored_content_sha256 = content_sha256
WHERE stored_content_sha256 = '';

UPDATE artifacts
SET stored_byte_size = byte_size
WHERE stored_byte_size = 0;

CREATE INDEX IF NOT EXISTS idx_artifacts_content_protection
  ON artifacts (content_protection_mode, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_artifacts_stored_sha
  ON artifacts (stored_content_sha256, updated_at DESC);

ALTER TABLE artifact_versions
  ADD COLUMN stored_content_sha256 TEXT NOT NULL DEFAULT '';

ALTER TABLE artifact_versions
  ADD COLUMN stored_byte_size INTEGER NOT NULL DEFAULT 0;

ALTER TABLE artifact_versions
  ADD COLUMN content_protection_mode TEXT NOT NULL DEFAULT 'plaintext';

ALTER TABLE artifact_versions
  ADD COLUMN content_encryption_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE artifact_versions
  ADD COLUMN encrypted_at TEXT;

ALTER TABLE artifact_versions
  ADD COLUMN content_password_hint TEXT NOT NULL DEFAULT '';

UPDATE artifact_versions
SET stored_content_sha256 = content_sha256
WHERE stored_content_sha256 = '';

UPDATE artifact_versions
SET stored_byte_size = byte_size
WHERE stored_byte_size = 0;
