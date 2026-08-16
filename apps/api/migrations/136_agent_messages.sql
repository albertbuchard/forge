PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agent_message_defaults (
  owner_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_agent_id TEXT NOT NULL REFERENCES agent_identities(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS agent_message_voice_reservations (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  upload_idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) = 64),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'consumed', 'expired')),
  artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
  original_file_name TEXT NOT NULL DEFAULT '',
  declared_mime_type TEXT NOT NULL DEFAULT '',
  verified_mime_type TEXT NOT NULL DEFAULT '',
  verified_container TEXT NOT NULL DEFAULT '',
  verified_codec TEXT NOT NULL DEFAULT '',
  byte_size INTEGER CHECK (byte_size IS NULL OR (byte_size >= 0 AND byte_size <= 26214400)),
  content_sha256 TEXT CHECK (content_sha256 IS NULL OR length(content_sha256) = 64),
  declared_duration_ms INTEGER CHECK (declared_duration_ms IS NULL OR declared_duration_ms >= 0),
  verified_duration_ms INTEGER CHECK (verified_duration_ms IS NULL OR (verified_duration_ms >= 0 AND verified_duration_ms <= 600000)),
  parser_name TEXT NOT NULL DEFAULT '',
  parser_version TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  consumed_message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_user_id, upload_idempotency_key),
  FOREIGN KEY (consumed_message_id) REFERENCES agent_messages(id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_kind TEXT NOT NULL CHECK (sender_kind IN ('human_user', 'agent', 'system')),
  sender_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  sender_agent_id TEXT REFERENCES agent_identities(id) ON DELETE SET NULL,
  sender_label TEXT NOT NULL,
  initial_recipient_agent_id TEXT NOT NULL REFERENCES agent_identities(id) ON DELETE RESTRICT,
  initial_recipient_label TEXT NOT NULL,
  recipient_agent_id TEXT NOT NULL REFERENCES agent_identities(id) ON DELETE RESTRICT,
  recipient_label TEXT NOT NULL,
  forwarded_from_message_id TEXT REFERENCES agent_messages(id) ON DELETE SET NULL,
  retried_from_message_id TEXT REFERENCES agent_messages(id) ON DELETE SET NULL,
  body_text TEXT NOT NULL DEFAULT '' CHECK (length(CAST(body_text AS BLOB)) <= 50000),
  voice_artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
  voice_mime_type TEXT NOT NULL DEFAULT '',
  voice_byte_size INTEGER CHECK (voice_byte_size IS NULL OR (voice_byte_size >= 0 AND voice_byte_size <= 26214400)),
  voice_declared_duration_ms INTEGER CHECK (voice_declared_duration_ms IS NULL OR voice_declared_duration_ms >= 0),
  voice_verified_duration_ms INTEGER CHECK (voice_verified_duration_ms IS NULL OR (voice_verified_duration_ms >= 0 AND voice_verified_duration_ms <= 600000)),
  sensitivity TEXT NOT NULL DEFAULT 'sensitive_media' CHECK (sensitivity = 'sensitive_media'),
  status TEXT NOT NULL CHECK (status IN ('delivered', 'claimed', 'in_progress', 'acknowledged', 'handled', 'failed', 'forwarded')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  progress_summary TEXT NOT NULL DEFAULT '' CHECK (length(progress_summary) <= 10000),
  result_markdown TEXT NOT NULL DEFAULT '' CHECK (length(result_markdown) <= 100000),
  transcript_text TEXT NOT NULL DEFAULT '' CHECK (length(transcript_text) <= 100000),
  transcript_provider TEXT NOT NULL DEFAULT '' CHECK (length(transcript_provider) <= 200),
  transcript_disclosure TEXT NOT NULL DEFAULT '' CHECK (length(transcript_disclosure) <= 2000),
  failure_code TEXT NOT NULL DEFAULT '' CHECK (length(failure_code) <= 200),
  failure_message TEXT NOT NULL DEFAULT '' CHECK (length(failure_message) <= 4000),
  claim_secret_digest TEXT,
  claimed_by_agent_id TEXT REFERENCES agent_identities(id) ON DELETE SET NULL,
  claim_generation INTEGER NOT NULL DEFAULT 0 CHECK (claim_generation >= 0),
  claimed_at TEXT,
  claim_renewed_at TEXT,
  claim_expires_at TEXT,
  client_idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) = 64),
  retention_until TEXT NOT NULL,
  retention_purged_at TEXT,
  purge_receipt_sha256 TEXT CHECK (purge_receipt_sha256 IS NULL OR length(purge_receipt_sha256) = 64),
  purged_voice_artifact_id TEXT,
  purged_voice_content_sha256 TEXT CHECK (purged_voice_content_sha256 IS NULL OR length(purged_voice_content_sha256) = 64),
  purged_voice_byte_size INTEGER CHECK (purged_voice_byte_size IS NULL OR purged_voice_byte_size >= 0),
  deleted_at TEXT,
  deleted_by_kind TEXT,
  deleted_by_id TEXT,
  deletion_reason TEXT NOT NULL DEFAULT '' CHECK (length(deletion_reason) <= 1000),
  delivered_at TEXT NOT NULL,
  acknowledged_at TEXT,
  handled_at TEXT,
  failed_at TEXT,
  forwarded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    length(trim(body_text)) > 0
    OR voice_artifact_id IS NOT NULL
    OR retention_purged_at IS NOT NULL
  ),
  CHECK (
    (sender_kind = 'human_user' AND sender_user_id IS NOT NULL AND sender_agent_id IS NULL)
    OR (sender_kind = 'agent' AND sender_agent_id IS NOT NULL AND sender_user_id IS NULL)
    OR (sender_kind = 'system' AND sender_user_id IS NULL AND sender_agent_id IS NULL)
  ),
  CHECK (
    claim_secret_digest IS NULL
    OR (
      claimed_by_agent_id IS NOT NULL
      AND claimed_at IS NOT NULL
      AND claim_expires_at IS NOT NULL
      AND claim_generation > 0
    )
  ),
  UNIQUE (owner_user_id, client_idempotency_key)
) STRICT;

CREATE TABLE IF NOT EXISTS agent_message_events (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES agent_messages(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  event_kind TEXT NOT NULL CHECK (event_kind IN (
    'created', 'delivered', 'claimed', 'lease_renewed', 'lease_expired_takeover',
    'progress', 'acknowledgement', 'lease_revoked', 'reassigned', 'retried',
    'handled', 'failed', 'forwarded', 'deleted', 'retention_purged'
  )),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('human_user', 'agent', 'system')),
  actor_id TEXT,
  actor_label TEXT NOT NULL,
  prior_status TEXT,
  next_status TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  UNIQUE (message_id, sequence)
) STRICT;

CREATE TABLE IF NOT EXISTS agent_message_reads (
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES agent_messages(id) ON DELETE CASCADE,
  last_read_event_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_read_event_sequence >= 0),
  read_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_user_id, message_id)
) STRICT;

CREATE TABLE IF NOT EXISTS agent_message_operation_receipts (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES agent_messages(id) ON DELETE CASCADE,
  operation_kind TEXT NOT NULL CHECK (operation_kind IN (
    'claim', 'renew', 'progress', 'acknowledge', 'mark_read', 'reassign', 'retry'
  )),
  operation_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) = 64),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('human_user', 'agent', 'system')),
  actor_id TEXT,
  resulting_revision INTEGER NOT NULL CHECK (resulting_revision >= 1),
  resulting_claim_generation INTEGER NOT NULL CHECK (resulting_claim_generation >= 0),
  resulting_event_sequence INTEGER NOT NULL CHECK (resulting_event_sequence >= 0),
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (message_id, operation_kind, operation_key)
) STRICT;

CREATE TABLE IF NOT EXISTS agent_message_terminal_receipts (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES agent_messages(id) ON DELETE CASCADE,
  receipt_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) = 64),
  terminal_outcome TEXT NOT NULL CHECK (terminal_outcome IN ('handled', 'failed', 'forwarded')),
  resulting_message_id TEXT REFERENCES agent_messages(id) ON DELETE SET NULL,
  agent_id TEXT NOT NULL REFERENCES agent_identities(id) ON DELETE RESTRICT,
  claim_generation INTEGER NOT NULL CHECK (claim_generation >= 1),
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (message_id, receipt_key)
) STRICT;

CREATE TABLE IF NOT EXISTS agent_message_voice_purge_jobs (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  storage_key TEXT NOT NULL,
  stored_content_sha256 TEXT NOT NULL CHECK (length(stored_content_sha256) = 64),
  stored_byte_size INTEGER NOT NULL CHECK (stored_byte_size >= 0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (artifact_id, storage_key)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_agent_messages_owner_outbox
  ON agent_messages(owner_user_id, deleted_at, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_agent_messages_agent_poll
  ON agent_messages(recipient_agent_id, status, claim_expires_at, created_at, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_agent_messages_voice_artifact
  ON agent_messages(voice_artifact_id, retention_until)
  WHERE voice_artifact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_message_events_inbox
  ON agent_message_events(message_id, event_kind, sequence DESC);

CREATE INDEX IF NOT EXISTS idx_agent_message_reservations_expiry
  ON agent_message_voice_reservations(status, expires_at);

CREATE INDEX IF NOT EXISTS idx_agent_message_receipts_lookup
  ON agent_message_operation_receipts(message_id, operation_kind, operation_key);

CREATE INDEX IF NOT EXISTS idx_agent_message_voice_purge_jobs_created
  ON agent_message_voice_purge_jobs(created_at, id);
