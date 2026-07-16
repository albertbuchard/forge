-- Additive People peer hardening. Migrations 087 and 088 are immutable; existing
-- command rows and legacy companion credentials are preserved but cannot grant
-- new authority until they are replaced by verifiable v2 state.

ALTER TABLE peer_command_journal
  ADD COLUMN authorization_state TEXT NOT NULL DEFAULT 'legacy_unverifiable'
  CHECK (authorization_state IN (
    'legacy_unverifiable', 'approved', 'invalidated', 'receipt_committed',
    'receipt_unresolved', 'quarantined'
  ));

ALTER TABLE peer_command_journal
  ADD COLUMN approval_owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE peer_command_journal ADD COLUMN approval_actor_class TEXT;
ALTER TABLE peer_command_journal ADD COLUMN approval_actor_id TEXT;
ALTER TABLE peer_command_journal ADD COLUMN approval_session_id TEXT;
ALTER TABLE peer_command_journal ADD COLUMN approval_device_id TEXT;
ALTER TABLE peer_command_journal ADD COLUMN approval_capability_id TEXT;
ALTER TABLE peer_command_journal ADD COLUMN approval_method TEXT;
ALTER TABLE peer_command_journal ADD COLUMN approval_deadline TEXT;
ALTER TABLE peer_command_journal ADD COLUMN authorization_id TEXT;
ALTER TABLE peer_command_journal ADD COLUMN authorization_state_hash TEXT;
ALTER TABLE peer_command_journal ADD COLUMN invalidated_at TEXT;
ALTER TABLE peer_command_journal ADD COLUMN invalidation_reason TEXT;
ALTER TABLE peer_command_journal ADD COLUMN daemon_committed_at TEXT;
ALTER TABLE peer_command_journal ADD COLUMN receipt_checked_at TEXT;
ALTER TABLE peer_command_journal ADD COLUMN quarantine_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_peer_command_authorization_id
  ON peer_command_journal (owner_user_id, authorization_id)
  WHERE authorization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_peer_command_authorization_recovery
  ON peer_command_journal (
    owner_user_id, authorization_state, approval_deadline, updated_at, command_id
  )
  WHERE authorization_state IN (
    'approved', 'invalidated', 'receipt_unresolved', 'quarantined'
  );

CREATE TRIGGER IF NOT EXISTS trg_peer_command_new_authorization_required
BEFORE INSERT ON peer_command_journal
WHEN NEW.authorization_state != 'approved'
  OR NEW.approval_owner_user_id IS NULL
  OR NEW.approval_owner_user_id IS NOT NEW.owner_user_id
  OR NEW.approval_actor_class IS NULL
  OR NEW.approval_actor_id IS NULL
  OR NEW.approval_session_id IS NULL
  OR NEW.approval_capability_id IS NULL
  OR NEW.approval_method IS NULL
  OR NEW.approval_deadline IS NULL
  OR NEW.authorization_id IS NULL
  OR NEW.authorization_state_hash IS NULL
  OR length(NEW.authorization_state_hash) != 64
  OR NEW.authorization_state_hash GLOB '*[^0-9a-f]*'
  OR julianday(NEW.approval_deadline) IS NULL
BEGIN
  SELECT RAISE(ABORT, 'new peer commands require an exact current approval binding');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_command_authorization_binding_immutable
BEFORE UPDATE OF approval_owner_user_id, approval_actor_class, approval_actor_id,
  approval_session_id, approval_device_id, approval_capability_id,
  approval_method, approval_deadline, authorization_id,
  authorization_state_hash ON peer_command_journal
BEGIN
  SELECT RAISE(ABORT, 'peer command approval binding is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_command_authorization_transition
BEFORE UPDATE OF authorization_state ON peer_command_journal
WHEN NOT (
  (OLD.authorization_state = 'approved'
    AND NEW.authorization_state IN (
      'approved', 'invalidated', 'receipt_committed', 'receipt_unresolved',
      'quarantined'
    ))
  OR (OLD.authorization_state = 'invalidated'
    AND NEW.authorization_state IN (
      'invalidated', 'receipt_committed', 'receipt_unresolved', 'quarantined'
    ))
  OR (OLD.authorization_state = 'receipt_unresolved'
    AND NEW.authorization_state IN (
      'receipt_unresolved', 'receipt_committed', 'quarantined'
    ))
  OR (OLD.authorization_state = NEW.authorization_state
    AND OLD.authorization_state IN (
      'legacy_unverifiable', 'receipt_committed', 'quarantined'
    ))
)
BEGIN
  SELECT RAISE(ABORT, 'invalid peer command authorization transition');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_command_invalidation_evidence
BEFORE UPDATE ON peer_command_journal
WHEN NEW.authorization_state = 'invalidated'
  AND (NEW.invalidated_at IS NULL OR NEW.invalidation_reason IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'invalidated peer command requires evidence');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_command_quarantine_evidence
BEFORE UPDATE ON peer_command_journal
WHEN NEW.authorization_state = 'quarantined'
  AND NEW.quarantine_reason IS NULL
BEGIN
  SELECT RAISE(ABORT, 'quarantined peer command requires evidence');
END;

CREATE TABLE IF NOT EXISTS peer_companion_enrollments (
  enrollment_id TEXT PRIMARY KEY
    CHECK (
      typeof(enrollment_id) = 'text'
      AND substr(enrollment_id, 1, 4) = 'pce_'
      AND length(enrollment_id) = 36
      AND substr(enrollment_id, 5) NOT GLOB '*[^0-9a-f]*'
    ),
  key_id TEXT NOT NULL UNIQUE
    CHECK (
      typeof(key_id) = 'text'
      AND substr(key_id, 1, 4) = 'pck_'
      AND length(key_id) = 36
      AND substr(key_id, 5) NOT GLOB '*[^0-9a-f]*'
    ),
  pairing_session_id TEXT NOT NULL UNIQUE
    REFERENCES companion_pairing_sessions(id) ON DELETE RESTRICT,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  device_id TEXT NOT NULL UNIQUE
    CHECK (
      typeof(device_id) = 'text'
      AND substr(device_id, 1, 4) = 'ios_'
      AND length(device_id) = 36
      AND substr(device_id, 5) NOT GLOB '*[^0-9a-f]*'
    ),
  signing_public_key TEXT NOT NULL UNIQUE
    CHECK (
      typeof(signing_public_key) = 'text'
      AND length(signing_public_key) = 87
      AND signing_public_key NOT GLOB '*[^A-Za-z0-9_-]*'
      AND substr(signing_public_key, 1, 1) = 'B'
      AND substr(signing_public_key, -1, 1) IN (
        'A', 'E', 'I', 'M', 'Q', 'U', 'Y', 'c',
        'g', 'k', 'o', 's', 'w', '0', '4', '8'
      )
    ),
  algorithm TEXT NOT NULL CHECK (algorithm = 'ES256'),
  public_key_format TEXT NOT NULL CHECK (public_key_format = 'ansi-x963'),
  protection TEXT NOT NULL CHECK (protection = 'secure-enclave-user-presence'),
  scopes_json TEXT NOT NULL
    CHECK (scopes_json = '["peer:grants:manage","peer:query","peer:status"]'),
  capabilities_json TEXT NOT NULL
    CHECK (
      capabilities_json =
      '["forge-peer-companion-consent/v2","forge-peer-companion-enrollment/v2","forge-peer-companion-request/v2"]'
    ),
  authorized_operations_json TEXT NOT NULL
    CHECK (
      authorized_operations_json =
      '["acceptPeerGrant","acceptPeerRequest","acceptScannedPeerPairing","approvePeerDevice","cancelPeerInvitation","confirmPeerPairing","counterPeerGrant","createPeerHumanPresenceOptions","createPeerInvitation","getPeerDiagnostics","getPeerHumanPresenceStatus","getPeerInvitationStatus","getPeerRelationship","getPeerSyncStatus","listPeerDevices","listPeerGrants","listPeerRelationships","listPeerRequests","previewPeerGrant","proposePeerGrant","rejectPeerRequest","removePeerDevice","requestPeerResync","revokePeerGrant","revokePeerRelationship","verifyPeerHumanPresence"]'
    ),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  enrolled_at TEXT NOT NULL,
  legacy_bootstrap_disabled_at TEXT NOT NULL,
  last_authenticated_at TEXT NOT NULL,
  revoked_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (typeof(enrolled_at) = 'text' AND julianday(enrolled_at) IS NOT NULL),
  CHECK (
    typeof(legacy_bootstrap_disabled_at) = 'text'
    AND julianday(legacy_bootstrap_disabled_at) IS NOT NULL
    AND julianday(legacy_bootstrap_disabled_at) >= julianday(enrolled_at)
  ),
  CHECK (
    typeof(last_authenticated_at) = 'text'
    AND julianday(last_authenticated_at) IS NOT NULL
    AND julianday(last_authenticated_at) >= julianday(enrolled_at)
  ),
  CHECK (
    typeof(updated_at) = 'text'
    AND julianday(updated_at) IS NOT NULL
    AND julianday(updated_at) >= julianday(legacy_bootstrap_disabled_at)
    AND julianday(updated_at) >= julianday(last_authenticated_at)
  ),
  CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR (
      status = 'revoked'
      AND typeof(revoked_at) = 'text'
      AND julianday(revoked_at) IS NOT NULL
      AND julianday(revoked_at) >= julianday(enrolled_at)
      AND julianday(revoked_at) >= julianday(last_authenticated_at)
      AND julianday(revoked_at) <= julianday(updated_at)
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_peer_companion_v2_owner_status
  ON peer_companion_enrollments (owner_user_id, status, updated_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_peer_companion_v2_pairing_insert
BEFORE INSERT ON peer_companion_enrollments
WHEN NOT EXISTS (
  SELECT 1 FROM companion_pairing_sessions AS pairing
  WHERE pairing.id = NEW.pairing_session_id
    AND pairing.user_id = NEW.owner_user_id
    AND pairing.paired_at IS NOT NULL
    AND pairing.status IN ('paired', 'healthy', 'stale', 'permission_denied')
)
BEGIN
  SELECT RAISE(ABORT, 'secure companion enrollment requires an established pairing');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_companion_v2_binding_immutable
BEFORE UPDATE OF enrollment_id, key_id, pairing_session_id, owner_user_id,
  device_id, signing_public_key, algorithm, public_key_format, protection,
  scopes_json, capabilities_json, authorized_operations_json, enrolled_at,
  legacy_bootstrap_disabled_at ON peer_companion_enrollments
BEGIN
  SELECT RAISE(ABORT, 'secure companion enrollment binding is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_companion_v2_revocation_terminal
BEFORE UPDATE ON peer_companion_enrollments
WHEN OLD.status = 'revoked'
BEGIN
  SELECT RAISE(ABORT, 'secure companion enrollment revocation is terminal');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_companion_v2_lifecycle_update
BEFORE UPDATE ON peer_companion_enrollments
WHEN julianday(NEW.updated_at) < julianday(OLD.updated_at)
  OR julianday(NEW.last_authenticated_at) < julianday(OLD.last_authenticated_at)
  OR (OLD.revoked_at IS NOT NULL AND OLD.revoked_at IS NOT NEW.revoked_at)
BEGIN
  SELECT RAISE(ABORT, 'secure companion enrollment lifecycle is inconsistent');
END;

CREATE TABLE IF NOT EXISTS peer_companion_enrollment_challenges (
  id TEXT PRIMARY KEY
    CHECK (typeof(id) = 'text' AND length(id) BETWEEN 16 AND 240),
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operator_session_id TEXT NOT NULL CHECK (length(operator_session_id) BETWEEN 8 AND 240),
  pairing_session_id TEXT NOT NULL
    REFERENCES companion_pairing_sessions(id) ON DELETE RESTRICT,
  enrollment_attempt_id TEXT NOT NULL CHECK (length(enrollment_attempt_id) BETWEEN 1 AND 240),
  device_id TEXT NOT NULL CHECK (
    typeof(device_id) = 'text'
    AND substr(device_id, 1, 4) = 'ios_'
    AND length(device_id) = 36
    AND substr(device_id, 5) NOT GLOB '*[^0-9a-f]*'
  ),
  signing_public_key TEXT NOT NULL CHECK (
    typeof(signing_public_key) = 'text'
    AND length(signing_public_key) = 87
    AND signing_public_key NOT GLOB '*[^A-Za-z0-9_-]*'
    AND substr(signing_public_key, 1, 1) = 'B'
    AND substr(signing_public_key, -1, 1) IN (
      'A', 'E', 'I', 'M', 'Q', 'U', 'Y', 'c',
      'g', 'k', 'o', 's', 'w', '0', '4', '8'
    )
  ),
  algorithm TEXT NOT NULL CHECK (algorithm = 'ES256'),
  public_key_format TEXT NOT NULL CHECK (public_key_format = 'ansi-x963'),
  protection TEXT NOT NULL CHECK (protection = 'secure-enclave-user-presence'),
  challenge TEXT NOT NULL CHECK (
    typeof(challenge) = 'text'
    AND length(challenge) = 43
    AND challenge NOT GLOB '*[^A-Za-z0-9_-]*'
    AND substr(challenge, -1, 1) IN (
      'A', 'E', 'I', 'M', 'Q', 'U', 'Y', 'c',
      'g', 'k', 'o', 's', 'w', '0', '4', '8'
    )
  ),
  challenge_keyed_hash TEXT NOT NULL
    CHECK (
      typeof(challenge_keyed_hash) = 'text'
      AND length(challenge_keyed_hash) = 64
      AND challenge_keyed_hash NOT GLOB '*[^0-9a-f]*'
    ),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'consumed', 'expired', 'rejected')),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  enrollment_id TEXT REFERENCES peer_companion_enrollments(enrollment_id) ON DELETE RESTRICT,
  verification_signature_hash TEXT
    CHECK (
      verification_signature_hash IS NULL
      OR (typeof(verification_signature_hash) = 'text'
        AND length(verification_signature_hash) = 64
        AND verification_signature_hash NOT GLOB '*[^0-9a-f]*')
    ),
  updated_at TEXT NOT NULL,
  CHECK (
    typeof(issued_at) = 'text'
    AND typeof(expires_at) = 'text'
    AND typeof(updated_at) = 'text'
    AND julianday(issued_at) IS NOT NULL
    AND julianday(expires_at) > julianday(issued_at)
    AND julianday(updated_at) >= julianday(issued_at)
  ),
  CHECK (
    (status = 'consumed'
      AND typeof(consumed_at) = 'text'
      AND julianday(consumed_at) >= julianday(issued_at)
      AND julianday(consumed_at) < julianday(expires_at)
      AND julianday(consumed_at) <= julianday(updated_at)
      AND enrollment_id IS NOT NULL AND verification_signature_hash IS NOT NULL)
    OR (status != 'consumed' AND consumed_at IS NULL
      AND enrollment_id IS NULL AND verification_signature_hash IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_peer_companion_enrollment_challenge_lookup
  ON peer_companion_enrollment_challenges (
    owner_user_id, operator_session_id, pairing_session_id,
    enrollment_attempt_id, status, expires_at
  );

CREATE TRIGGER IF NOT EXISTS trg_peer_companion_enrollment_challenge_pairing_insert
BEFORE INSERT ON peer_companion_enrollment_challenges
WHEN NOT EXISTS (
  SELECT 1 FROM companion_pairing_sessions AS pairing
  WHERE pairing.id = NEW.pairing_session_id
    AND pairing.user_id = NEW.owner_user_id
    AND pairing.paired_at IS NOT NULL
    AND pairing.status IN ('paired', 'healthy', 'stale', 'permission_denied')
    AND julianday(pairing.expires_at) > julianday(NEW.issued_at)
)
BEGIN
  SELECT RAISE(ABORT, 'secure companion enrollment challenge requires an established pairing');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_companion_enrollment_challenge_binding_immutable
BEFORE UPDATE OF id, owner_user_id, operator_session_id, pairing_session_id,
  enrollment_attempt_id, device_id, signing_public_key, algorithm,
  public_key_format, protection, challenge, challenge_keyed_hash,
  issued_at, expires_at ON peer_companion_enrollment_challenges
BEGIN
  SELECT RAISE(ABORT, 'secure companion enrollment challenge binding is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_companion_enrollment_challenge_terminal
BEFORE UPDATE ON peer_companion_enrollment_challenges
WHEN OLD.status IN ('consumed', 'expired', 'rejected')
BEGIN
  SELECT RAISE(ABORT, 'secure companion enrollment challenge is terminal');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_companion_enrollment_challenge_lifecycle
BEFORE UPDATE ON peer_companion_enrollment_challenges
WHEN julianday(NEW.updated_at) < julianday(OLD.updated_at)
BEGIN
  SELECT RAISE(ABORT, 'secure companion enrollment challenge lifecycle is inconsistent');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_companion_v2_pairing_binding_immutable
BEFORE UPDATE OF id, user_id ON companion_pairing_sessions
WHEN (OLD.id IS NOT NEW.id OR OLD.user_id IS NOT NEW.user_id)
  AND (
    EXISTS (
      SELECT 1 FROM peer_companion_enrollments
      WHERE pairing_session_id = OLD.id
    )
    OR EXISTS (
      SELECT 1 FROM peer_companion_enrollment_challenges
      WHERE pairing_session_id = OLD.id
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'secure companion pairing owner binding is immutable');
END;

CREATE TABLE IF NOT EXISTS peer_companion_v2_request_nonces (
  enrollment_id TEXT NOT NULL
    REFERENCES peer_companion_enrollments(enrollment_id) ON DELETE RESTRICT,
  nonce_hash TEXT NOT NULL
    CHECK (
      typeof(nonce_hash) = 'text'
      AND length(nonce_hash) = 64
      AND nonce_hash NOT GLOB '*[^0-9a-f]*'
    ),
  request_digest TEXT NOT NULL
    CHECK (
      typeof(request_digest) = 'text'
      AND length(request_digest) = 64
      AND request_digest NOT GLOB '*[^0-9a-f]*'
    ),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (enrollment_id, nonce_hash),
  CHECK (
    typeof(issued_at) = 'text'
    AND typeof(expires_at) = 'text'
    AND typeof(created_at) = 'text'
    AND julianday(issued_at) IS NOT NULL
    AND julianday(expires_at) > julianday(issued_at)
    AND julianday(created_at) IS NOT NULL
    AND julianday(created_at) < julianday(expires_at)
  )
);

CREATE INDEX IF NOT EXISTS idx_peer_companion_v2_nonce_expiry
  ON peer_companion_v2_request_nonces (expires_at, enrollment_id);

CREATE TRIGGER IF NOT EXISTS trg_peer_companion_v2_nonce_immutable
BEFORE UPDATE ON peer_companion_v2_request_nonces
BEGIN
  SELECT RAISE(ABORT, 'secure companion request nonce is immutable');
END;
