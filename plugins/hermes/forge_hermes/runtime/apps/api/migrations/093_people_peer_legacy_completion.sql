-- Complete the original People migration for databases that recorded 087
-- before these additive peer workflow tables were part of that migration.

CREATE TABLE IF NOT EXISTS peer_pending_requests (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  relationship_id TEXT,
  request_kind TEXT NOT NULL CHECK (request_kind IN ('pairing', 'device', 'grant')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  payload_json TEXT NOT NULL
    CHECK (
      json_valid(payload_json)
      AND json_type(payload_json) = 'object'
      AND length(payload_json) <= 1048576
    ),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  decision_reason TEXT NOT NULL DEFAULT '' CHECK (length(decision_reason) <= 1000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (relationship_id, owner_user_id)
    REFERENCES peer_relationships(id, owner_user_id),
  UNIQUE (id, owner_user_id),
  CHECK (expires_at > created_at),
  CHECK (
    (status = 'pending' AND decided_at IS NULL)
    OR (status IN ('accepted', 'rejected') AND decided_at IS NOT NULL)
    OR (status = 'expired' AND decided_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_peer_pending_requests_owner_status
  ON peer_pending_requests (owner_user_id, status, request_kind, created_at DESC, id);

CREATE TRIGGER IF NOT EXISTS trg_peer_pending_requests_payload_immutable
BEFORE UPDATE OF owner_user_id, relationship_id, request_kind, payload_json,
  payload_hash, expires_at, created_at ON peer_pending_requests
BEGIN
  SELECT RAISE(ABORT, 'peer request reviewed payload is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_pending_requests_terminal
BEFORE UPDATE OF status ON peer_pending_requests
WHEN OLD.status != 'pending' AND NEW.status != OLD.status
BEGIN
  SELECT RAISE(ABORT, 'peer request decision is terminal');
END;

CREATE TABLE IF NOT EXISTS peer_idempotency_records (
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation_id TEXT NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 160),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 240),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  response_status INTEGER NOT NULL CHECK (response_status BETWEEN 200 AND 599),
  response_json TEXT NOT NULL
    CHECK (json_valid(response_json) AND length(response_json) <= 1048576),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (owner_user_id, operation_id, idempotency_key),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_peer_idempotency_expiry
  ON peer_idempotency_records (expires_at, owner_user_id);

CREATE TRIGGER IF NOT EXISTS trg_peer_idempotency_immutable
BEFORE UPDATE ON peer_idempotency_records
BEGIN
  SELECT RAISE(ABORT, 'peer idempotency response is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_idempotency_no_delete
BEFORE DELETE ON peer_idempotency_records
WHEN OLD.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
BEGIN
  SELECT RAISE(ABORT, 'unexpired peer idempotency response deletion is forbidden');
END;

CREATE TABLE IF NOT EXISTS peer_command_journal (
  command_id TEXT PRIMARY KEY CHECK (length(command_id) BETWEEN 16 AND 240),
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation_id TEXT NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 160),
  target_type TEXT NOT NULL CHECK (length(target_type) BETWEEN 1 AND 80),
  target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 240),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  expected_version TEXT CHECK (expected_version IS NULL OR length(expected_version) <= 500),
  status TEXT NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared', 'dispatched', 'applied', 'failed', 'reconciliation_required')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  result_hash TEXT CHECK (result_hash IS NULL OR length(result_hash) = 64),
  result_reference TEXT CHECK (result_reference IS NULL OR length(result_reference) <= 240),
  last_error TEXT NOT NULL DEFAULT '' CHECK (length(last_error) <= 4000),
  last_dispatched_at TEXT,
  applied_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_user_id, operation_id, command_id),
  CHECK ((status = 'applied' AND applied_at IS NOT NULL) OR status != 'applied')
);

CREATE INDEX IF NOT EXISTS idx_peer_command_journal_recovery
  ON peer_command_journal (owner_user_id, status, updated_at, command_id)
  WHERE status IN ('prepared', 'dispatched', 'failed', 'reconciliation_required');

CREATE TRIGGER IF NOT EXISTS trg_peer_command_journal_binding_immutable
BEFORE UPDATE OF command_id, owner_user_id, operation_id, target_type,
  target_id, request_hash, expected_version, created_at ON peer_command_journal
BEGIN
  SELECT RAISE(ABORT, 'peer command binding is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_command_journal_applied_terminal
BEFORE UPDATE ON peer_command_journal
WHEN OLD.status = 'applied'
BEGIN
  SELECT RAISE(ABORT, 'applied peer command is terminal');
END;

CREATE TABLE IF NOT EXISTS people_wiki_association_previews (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  preview_hash TEXT NOT NULL UNIQUE CHECK (length(preview_hash) = 64),
  decisions_json TEXT NOT NULL
    CHECK (
      json_valid(decisions_json)
      AND json_type(decisions_json) = 'array'
      AND length(decisions_json) <= 1048576
    ),
  source_versions_json TEXT NOT NULL
    CHECK (
      json_valid(source_versions_json)
      AND json_type(source_versions_json) = 'object'
      AND length(source_versions_json) <= 262144
    ),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'consumed', 'expired')),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (id, owner_user_id),
  CHECK (expires_at > created_at),
  CHECK (
    (status = 'consumed' AND consumed_at IS NOT NULL)
    OR (status IN ('active', 'expired') AND consumed_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_people_wiki_previews_owner_status
  ON people_wiki_association_previews (owner_user_id, status, expires_at, created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_people_wiki_previews_binding_immutable
BEFORE UPDATE OF owner_user_id, preview_hash, decisions_json,
  source_versions_json, expires_at, created_at ON people_wiki_association_previews
BEGIN
  SELECT RAISE(ABORT, 'Wiki association preview binding is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_people_wiki_previews_terminal
BEFORE UPDATE OF status ON people_wiki_association_previews
WHEN OLD.status != 'active' AND NEW.status != OLD.status
BEGIN
  SELECT RAISE(ABORT, 'Wiki association preview state is terminal');
END;

CREATE TABLE IF NOT EXISTS peer_question_interpretations (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  interpretation_hash TEXT NOT NULL UNIQUE CHECK (length(interpretation_hash) = 64),
  normalized_question_hash TEXT NOT NULL CHECK (length(normalized_question_hash) = 64),
  typed_query_json TEXT NOT NULL
    CHECK (
      json_valid(typed_query_json)
      AND json_type(typed_query_json) = 'object'
      AND length(typed_query_json) <= 262144
    ),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'consumed', 'expired')),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (person_id, owner_user_id) REFERENCES people(id, user_id),
  UNIQUE (id, owner_user_id),
  CHECK (expires_at > created_at),
  CHECK (
    (status = 'consumed' AND consumed_at IS NOT NULL)
    OR (status IN ('active', 'expired') AND consumed_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_peer_question_interpretations_owner_status
  ON peer_question_interpretations (owner_user_id, person_id, status, expires_at);

CREATE TRIGGER IF NOT EXISTS trg_peer_question_interpretations_binding_immutable
BEFORE UPDATE OF owner_user_id, person_id, interpretation_hash,
  normalized_question_hash, typed_query_json, expires_at, created_at
  ON peer_question_interpretations
BEGIN
  SELECT RAISE(ABORT, 'peer question interpretation binding is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_question_interpretations_terminal
BEFORE UPDATE OF status ON peer_question_interpretations
WHEN OLD.status != 'active' AND NEW.status != OLD.status
BEGIN
  SELECT RAISE(ABORT, 'peer question interpretation state is terminal');
END;
