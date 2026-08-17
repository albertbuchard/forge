-- Early published revisions of migration 087 created peer_query_audit before
-- the exact grant-verification evidence columns were added. The database
-- initializer conditionally adds those columns and drops the potentially
-- invalid legacy trigger before this migration rebuilds the table with the
-- complete constraints.

ALTER TABLE peer_query_audit RENAME TO peer_query_audit_before_compatibility;

CREATE TABLE peer_query_audit (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  person_id TEXT,
  relationship_id TEXT NOT NULL,
  projection_id TEXT NOT NULL CHECK (length(projection_id) BETWEEN 1 AND 160),
  requester_class TEXT NOT NULL
    CHECK (requester_class IN ('operator_session', 'agent_token', 'companion_session', 'companion_consent', 'peer_device', 'local_service')),
  requester_id TEXT NOT NULL CHECK (length(requester_id) BETWEEN 1 AND 240),
  parameters_hash TEXT NOT NULL CHECK (length(parameters_hash) = 64),
  decision TEXT NOT NULL CHECK (decision IN ('allowed', 'denied', 'error')),
  decision_reason TEXT NOT NULL DEFAULT '' CHECK (length(decision_reason) <= 1000),
  grant_id TEXT,
  grant_sequence INTEGER,
  grant_verification_id TEXT,
  verified_grant_hash TEXT CHECK (verified_grant_hash IS NULL OR length(verified_grant_hash) = 64),
  authorization_evidence_json TEXT NOT NULL DEFAULT '{}'
    CHECK (
      json_valid(authorization_evidence_json)
      AND json_type(authorization_evidence_json) = 'object'
      AND length(authorization_evidence_json) <= 262144
    ),
  result_count INTEGER NOT NULL DEFAULT 0 CHECK (result_count >= 0),
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (person_id, owner_user_id) REFERENCES people(id, user_id),
  FOREIGN KEY (relationship_id, owner_user_id) REFERENCES peer_relationships(id, owner_user_id),
  FOREIGN KEY (grant_id, grant_sequence, owner_user_id)
    REFERENCES peer_share_grants(id, sequence, owner_user_id),
  FOREIGN KEY (grant_verification_id, owner_user_id)
    REFERENCES peer_grant_verifications(id, owner_user_id),
  CHECK (
    (grant_id IS NULL AND grant_sequence IS NULL)
    OR (grant_id IS NOT NULL AND grant_sequence IS NOT NULL)
  )
);

INSERT INTO peer_query_audit (
  id,
  owner_user_id,
  person_id,
  relationship_id,
  projection_id,
  requester_class,
  requester_id,
  parameters_hash,
  decision,
  decision_reason,
  grant_id,
  grant_sequence,
  grant_verification_id,
  verified_grant_hash,
  authorization_evidence_json,
  result_count,
  duration_ms,
  created_at
)
SELECT
  id,
  owner_user_id,
  person_id,
  relationship_id,
  projection_id,
  requester_class,
  requester_id,
  parameters_hash,
  decision,
  decision_reason,
  grant_id,
  grant_sequence,
  grant_verification_id,
  verified_grant_hash,
  authorization_evidence_json,
  result_count,
  duration_ms,
  created_at
FROM peer_query_audit_before_compatibility;

DROP TABLE peer_query_audit_before_compatibility;

CREATE INDEX idx_peer_query_audit_owner_time
  ON peer_query_audit (owner_user_id, created_at DESC, id);

CREATE INDEX idx_peer_query_audit_relationship
  ON peer_query_audit (owner_user_id, relationship_id, projection_id, created_at DESC);

CREATE TRIGGER trg_peer_query_audit_exact_allowed_verification
BEFORE INSERT ON peer_query_audit
WHEN NEW.decision = 'allowed'
  AND (
    NEW.grant_id IS NULL
    OR NEW.grant_sequence IS NULL
    OR NEW.grant_verification_id IS NULL
    OR NEW.verified_grant_hash IS NULL
    OR NOT EXISTS (
    SELECT 1
    FROM peer_grant_verifications AS verification
    WHERE verification.id = NEW.grant_verification_id
      AND verification.owner_user_id = NEW.owner_user_id
      AND verification.relationship_id = NEW.relationship_id
      AND verification.grant_id = NEW.grant_id
      AND verification.grant_sequence = NEW.grant_sequence
      AND verification.verified_grant_hash = NEW.verified_grant_hash
      AND verification.verification_result = 'valid'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'allowed peer query lacks exact valid grant evidence');
END;
