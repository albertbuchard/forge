ALTER TABLE forge_devices
  ADD COLUMN key_agreement_public_key TEXT;

ALTER TABLE forge_devices
  ADD COLUMN certificate_serial TEXT;

ALTER TABLE forge_devices
  ADD COLUMN certificate_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_forge_principals_public_id_global
  ON forge_principals (public_principal_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_forge_principals_root_key_global
  ON forge_principals (root_public_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_forge_devices_signing_key_global
  ON forge_devices (certified_public_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_forge_devices_agreement_key_global
  ON forge_devices (key_agreement_public_key)
  WHERE key_agreement_public_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_forge_devices_certificate_global
  ON forge_devices (certificate);

CREATE UNIQUE INDEX IF NOT EXISTS idx_forge_devices_certificate_hash_global
  ON forge_devices (certificate_hash)
  WHERE certificate_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_forge_devices_private_key_handle_global
  ON forge_devices (private_key_secret_id)
  WHERE private_key_secret_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_peer_relationships_one_live_person
  ON peer_relationships (owner_user_id, local_person_id)
  WHERE local_person_id IS NOT NULL
    AND status IN ('active', 'paused', 'recovery_required');

CREATE TRIGGER IF NOT EXISTS trg_forge_principals_peer_identity_insert
BEFORE INSERT ON forge_principals
WHEN length(NEW.id) = 64
  OR length(NEW.public_principal_id) = 64
  OR length(NEW.root_public_key) = 43
BEGIN
  SELECT CASE
    WHEN length(NEW.id) != 64
      OR NEW.id GLOB '*[^0-9a-f]*'
      OR NEW.public_principal_id != NEW.id
    THEN RAISE(ABORT, 'Forge peer principal ID must equal its lowercase hexadecimal public principal ID')
  END;
  SELECT CASE
    WHEN typeof(NEW.root_public_key) != 'text'
      OR length(NEW.root_public_key) != 43
      OR NEW.root_public_key GLOB '*[^A-Za-z0-9_-]*'
      OR substr(NEW.root_public_key, -1, 1) NOT IN (
        'A', 'E', 'I', 'M', 'Q', 'U', 'Y', 'c',
        'g', 'k', 'o', 's', 'w', '0', '4', '8'
      )
    THEN RAISE(ABORT, 'Forge peer principal root public key is not canonical base64url')
  END;
  SELECT CASE
    WHEN (NEW.principal_kind = 'local' AND NEW.root_key_secret_id IS NULL)
      OR (NEW.principal_kind = 'remote' AND NEW.root_key_secret_id IS NOT NULL)
    THEN RAISE(ABORT, 'Forge peer principal secret handle does not match its principal kind')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_forge_principals_identity_immutable
BEFORE UPDATE ON forge_principals
WHEN OLD.id IS NOT NEW.id
  OR OLD.owner_user_id IS NOT NEW.owner_user_id
  OR OLD.principal_kind IS NOT NEW.principal_kind
  OR OLD.public_principal_id IS NOT NEW.public_principal_id
  OR OLD.root_public_key IS NOT NEW.root_public_key
  OR OLD.root_key_secret_id IS NOT NEW.root_key_secret_id
BEGIN
  SELECT RAISE(ABORT, 'Forge principal cryptographic identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_forge_principals_lifecycle_insert
BEFORE INSERT ON forge_principals
WHEN NEW.updated_at < NEW.created_at
  OR (NEW.first_verified_at IS NULL) != (NEW.last_verified_at IS NULL)
  OR NEW.first_verified_at < NEW.created_at
  OR NEW.last_verified_at < NEW.first_verified_at
  OR NEW.last_verified_at > NEW.updated_at
  OR (NEW.trust_state = 'revoked') != (NEW.revoked_at IS NOT NULL)
  OR NEW.revoked_at < NEW.created_at
  OR NEW.revoked_at < NEW.last_verified_at
  OR NEW.revoked_at > NEW.updated_at
BEGIN
  SELECT RAISE(ABORT, 'Forge principal lifecycle timestamps are inconsistent');
END;

CREATE TRIGGER IF NOT EXISTS trg_forge_principals_lifecycle_update
BEFORE UPDATE ON forge_principals
WHEN NEW.updated_at < OLD.updated_at
  OR OLD.created_at IS NOT NEW.created_at
  OR (OLD.first_verified_at IS NOT NULL AND OLD.first_verified_at IS NOT NEW.first_verified_at)
  OR (OLD.last_verified_at IS NOT NULL AND NEW.last_verified_at < OLD.last_verified_at)
  OR (OLD.revoked_at IS NOT NULL AND OLD.revoked_at IS NOT NEW.revoked_at)
  OR (OLD.trust_state = 'revoked' AND NEW.trust_state != OLD.trust_state)
  OR NEW.updated_at < NEW.created_at
  OR (NEW.first_verified_at IS NULL) != (NEW.last_verified_at IS NULL)
  OR NEW.first_verified_at < NEW.created_at
  OR NEW.last_verified_at < NEW.first_verified_at
  OR NEW.last_verified_at > NEW.updated_at
  OR (NEW.trust_state = 'revoked') != (NEW.revoked_at IS NOT NULL)
  OR NEW.revoked_at < NEW.created_at
  OR NEW.revoked_at < NEW.last_verified_at
  OR NEW.revoked_at > NEW.updated_at
BEGIN
  SELECT RAISE(ABORT, 'Forge principal lifecycle transition is inconsistent');
END;

CREATE TRIGGER IF NOT EXISTS trg_forge_devices_peer_identity_insert
BEFORE INSERT ON forge_devices
WHEN (
    length(NEW.id) = 32
    AND NEW.id NOT GLOB '*[^0-9a-f]*'
  )
  OR NEW.key_agreement_public_key IS NOT NULL
  OR NEW.certificate_serial IS NOT NULL
  OR NEW.certificate_hash IS NOT NULL
BEGIN
  SELECT CASE
    WHEN length(NEW.id) != 32
      OR NEW.id GLOB '*[^0-9a-f]*'
    THEN RAISE(ABORT, 'Forge peer device ID is not lowercase hexadecimal')
  END;
  SELECT CASE
    WHEN typeof(NEW.certified_public_key) != 'text'
      OR length(NEW.certified_public_key) != 43
      OR NEW.certified_public_key GLOB '*[^A-Za-z0-9_-]*'
      OR substr(NEW.certified_public_key, -1, 1) NOT IN (
        'A', 'E', 'I', 'M', 'Q', 'U', 'Y', 'c',
        'g', 'k', 'o', 's', 'w', '0', '4', '8'
      )
    THEN RAISE(ABORT, 'Forge peer device signing public key is not canonical base64url')
  END;
  SELECT CASE
    WHEN NEW.key_agreement_public_key IS NULL
      OR typeof(NEW.key_agreement_public_key) != 'text'
      OR length(NEW.key_agreement_public_key) != 43
      OR NEW.key_agreement_public_key GLOB '*[^A-Za-z0-9_-]*'
      OR substr(NEW.key_agreement_public_key, -1, 1) NOT IN (
        'A', 'E', 'I', 'M', 'Q', 'U', 'Y', 'c',
        'g', 'k', 'o', 's', 'w', '0', '4', '8'
      )
    THEN RAISE(ABORT, 'Forge peer device key-agreement public key is not canonical base64url')
  END;
  SELECT CASE
    WHEN typeof(NEW.certificate) != 'text'
      OR NEW.certificate GLOB '*[^A-Za-z0-9_-]*'
      OR length(NEW.certificate) % 4 = 1
      OR (
        length(NEW.certificate) % 4 = 2
        AND substr(NEW.certificate, -1, 1) NOT IN ('A', 'Q', 'g', 'w')
      )
      OR (
        length(NEW.certificate) % 4 = 3
        AND substr(NEW.certificate, -1, 1) NOT IN (
          'A', 'E', 'I', 'M', 'Q', 'U', 'Y', 'c',
          'g', 'k', 'o', 's', 'w', '0', '4', '8'
        )
      )
    THEN RAISE(ABORT, 'Forge peer device certificate is not canonical base64url')
  END;
  SELECT CASE
    WHEN NEW.certificate_serial IS NULL
      OR typeof(NEW.certificate_serial) != 'text'
      OR length(NEW.certificate_serial) NOT BETWEEN 1 AND 20
      OR NEW.certificate_serial GLOB '*[^0-9]*'
      OR substr(NEW.certificate_serial, 1, 1) = '0'
      OR (
        length(NEW.certificate_serial) = 20
        AND NEW.certificate_serial > '18446744073709551615'
      )
    THEN RAISE(ABORT, 'Forge peer device certificate serial is not a canonical positive u64 string')
  END;
  SELECT CASE
    WHEN NEW.certificate_hash IS NULL
      OR typeof(NEW.certificate_hash) != 'text'
      OR length(NEW.certificate_hash) != 64
      OR NEW.certificate_hash GLOB '*[^0-9a-f]*'
    THEN RAISE(ABORT, 'Forge peer device certificate hash is not a lowercase BLAKE3 fingerprint')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_forge_devices_identity_immutable
BEFORE UPDATE ON forge_devices
WHEN OLD.id IS NOT NEW.id
  OR OLD.owner_user_id IS NOT NEW.owner_user_id
  OR OLD.principal_id IS NOT NEW.principal_id
  OR OLD.certified_public_key IS NOT NEW.certified_public_key
  OR OLD.key_agreement_public_key IS NOT NEW.key_agreement_public_key
  OR OLD.private_key_secret_id IS NOT NEW.private_key_secret_id
  OR OLD.certificate IS NOT NEW.certificate
  OR OLD.certificate_serial IS NOT NEW.certificate_serial
  OR OLD.certificate_hash IS NOT NEW.certificate_hash
BEGIN
  SELECT RAISE(ABORT, 'Forge device cryptographic identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_forge_devices_lifecycle_insert
BEFORE INSERT ON forge_devices
WHEN NEW.updated_at < NEW.created_at
  OR NEW.added_at < NEW.created_at
  OR NEW.added_at > NEW.updated_at
  OR NEW.last_seen_at < NEW.added_at
  OR NEW.last_seen_at > NEW.updated_at
  OR (NEW.status IN ('removed', 'revoked', 'compromised')) != (NEW.revoked_at IS NOT NULL)
  OR NEW.revoked_at < NEW.added_at
  OR NEW.revoked_at < NEW.last_seen_at
  OR NEW.revoked_at > NEW.updated_at
BEGIN
  SELECT RAISE(ABORT, 'Forge device lifecycle timestamps are inconsistent');
END;

CREATE TRIGGER IF NOT EXISTS trg_forge_devices_lifecycle_update
BEFORE UPDATE ON forge_devices
WHEN NEW.updated_at < OLD.updated_at
  OR OLD.created_at IS NOT NEW.created_at
  OR OLD.added_at IS NOT NEW.added_at
  OR (OLD.last_seen_at IS NOT NULL AND NEW.last_seen_at < OLD.last_seen_at)
  OR (OLD.revoked_at IS NOT NULL AND OLD.revoked_at IS NOT NEW.revoked_at)
  OR (OLD.status IN ('removed', 'revoked', 'compromised') AND NEW.status != OLD.status)
  OR NEW.updated_at < NEW.created_at
  OR NEW.added_at < NEW.created_at
  OR NEW.added_at > NEW.updated_at
  OR NEW.last_seen_at < NEW.added_at
  OR NEW.last_seen_at > NEW.updated_at
  OR (NEW.status IN ('removed', 'revoked', 'compromised')) != (NEW.revoked_at IS NOT NULL)
  OR NEW.revoked_at < NEW.added_at
  OR NEW.revoked_at < NEW.last_seen_at
  OR NEW.revoked_at > NEW.updated_at
BEGIN
  SELECT RAISE(ABORT, 'Forge device lifecycle transition is inconsistent');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_relationships_identity_immutable
BEFORE UPDATE ON peer_relationships
WHEN OLD.id IS NOT NEW.id
  OR OLD.owner_user_id IS NOT NEW.owner_user_id
  OR OLD.local_principal_id IS NOT NEW.local_principal_id
  OR OLD.remote_principal_id IS NOT NEW.remote_principal_id
  OR OLD.verification_phrase_hash IS NOT NEW.verification_phrase_hash
BEGIN
  SELECT RAISE(ABORT, 'Peer relationship principal binding is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_relationships_lifecycle_insert
BEFORE INSERT ON peer_relationships
WHEN NEW.updated_at < NEW.created_at
  OR (
    NEW.status = 'pending_verification'
    AND (
      NEW.established_at IS NOT NULL
      OR NEW.last_connected_at IS NOT NULL
      OR NEW.revoked_at IS NOT NULL
    )
  )
  OR (
    NEW.status IN ('active', 'paused', 'recovery_required')
    AND (NEW.established_at IS NULL OR NEW.revoked_at IS NOT NULL)
  )
  OR (NEW.status = 'revoked') != (NEW.revoked_at IS NOT NULL)
  OR NEW.established_at < NEW.created_at
  OR NEW.established_at > NEW.updated_at
  OR (NEW.last_connected_at IS NOT NULL AND NEW.established_at IS NULL)
  OR NEW.last_connected_at < NEW.established_at
  OR NEW.last_connected_at > NEW.updated_at
  OR NEW.revoked_at < NEW.created_at
  OR NEW.revoked_at < NEW.established_at
  OR NEW.revoked_at < NEW.last_connected_at
  OR NEW.revoked_at > NEW.updated_at
BEGIN
  SELECT RAISE(ABORT, 'Peer relationship lifecycle timestamps are inconsistent');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_relationships_lifecycle_update
BEFORE UPDATE ON peer_relationships
WHEN NEW.updated_at < OLD.updated_at
  OR OLD.created_at IS NOT NEW.created_at
  OR (OLD.established_at IS NOT NULL AND OLD.established_at IS NOT NEW.established_at)
  OR (OLD.last_connected_at IS NOT NULL AND NEW.last_connected_at < OLD.last_connected_at)
  OR (OLD.revoked_at IS NOT NULL AND OLD.revoked_at IS NOT NEW.revoked_at)
  OR (OLD.status = 'revoked' AND NEW.status != OLD.status)
  OR (
    OLD.status = 'active'
    AND NEW.status NOT IN ('active', 'paused', 'recovery_required', 'revoked')
  )
  OR (
    OLD.status = 'paused'
    AND NEW.status NOT IN ('active', 'paused', 'recovery_required', 'revoked')
  )
  OR (
    OLD.status = 'recovery_required'
    AND NEW.status NOT IN ('active', 'paused', 'recovery_required', 'revoked')
  )
  OR (
    OLD.status = 'pending_verification'
    AND NEW.status NOT IN ('pending_verification', 'active', 'revoked')
  )
  OR NEW.updated_at < NEW.created_at
  OR (
    NEW.status = 'pending_verification'
    AND (
      NEW.established_at IS NOT NULL
      OR NEW.last_connected_at IS NOT NULL
      OR NEW.revoked_at IS NOT NULL
    )
  )
  OR (
    NEW.status IN ('active', 'paused', 'recovery_required')
    AND (NEW.established_at IS NULL OR NEW.revoked_at IS NOT NULL)
  )
  OR (NEW.status = 'revoked') != (NEW.revoked_at IS NOT NULL)
  OR NEW.established_at < NEW.created_at
  OR NEW.established_at > NEW.updated_at
  OR (NEW.last_connected_at IS NOT NULL AND NEW.established_at IS NULL)
  OR NEW.last_connected_at < NEW.established_at
  OR NEW.last_connected_at > NEW.updated_at
  OR NEW.revoked_at < NEW.created_at
  OR NEW.revoked_at < NEW.established_at
  OR NEW.revoked_at < NEW.last_connected_at
  OR NEW.revoked_at > NEW.updated_at
BEGIN
  SELECT RAISE(ABORT, 'Peer relationship lifecycle transition is inconsistent');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_relationship_devices_role_insert
BEFORE INSERT ON peer_relationship_devices
WHEN NOT EXISTS (
  SELECT 1
  FROM peer_relationships AS relationship
  JOIN forge_devices AS device
    ON device.id = NEW.device_id
   AND device.owner_user_id = NEW.owner_user_id
  WHERE relationship.id = NEW.relationship_id
    AND relationship.owner_user_id = NEW.owner_user_id
    AND device.principal_id = CASE NEW.principal_role
      WHEN 'local' THEN relationship.local_principal_id
      WHEN 'remote' THEN relationship.remote_principal_id
    END
)
BEGIN
  SELECT RAISE(ABORT, 'Peer relationship device role does not match its principal');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_relationship_devices_role_update
BEFORE UPDATE ON peer_relationship_devices
WHEN NOT EXISTS (
  SELECT 1
  FROM peer_relationships AS relationship
  JOIN forge_devices AS device
    ON device.id = NEW.device_id
   AND device.owner_user_id = NEW.owner_user_id
  WHERE relationship.id = NEW.relationship_id
    AND relationship.owner_user_id = NEW.owner_user_id
    AND device.principal_id = CASE NEW.principal_role
      WHEN 'local' THEN relationship.local_principal_id
      WHEN 'remote' THEN relationship.remote_principal_id
    END
)
BEGIN
  SELECT RAISE(ABORT, 'Peer relationship device role does not match its principal');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_relationship_devices_binding_immutable
BEFORE UPDATE ON peer_relationship_devices
WHEN OLD.relationship_id IS NOT NEW.relationship_id
  OR OLD.owner_user_id IS NOT NEW.owner_user_id
  OR OLD.device_id IS NOT NEW.device_id
  OR OLD.principal_role IS NOT NEW.principal_role
BEGIN
  SELECT RAISE(ABORT, 'Peer relationship device binding is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_relationship_devices_lifecycle_insert
BEFORE INSERT ON peer_relationship_devices
WHEN NEW.updated_at < NEW.created_at
  OR (NEW.status = 'pending' AND (NEW.approved_at IS NOT NULL OR NEW.removed_at IS NOT NULL))
  OR (NEW.status = 'approved' AND (NEW.approved_at IS NULL OR NEW.removed_at IS NOT NULL))
  OR (NEW.status IN ('removed', 'revoked', 'compromised') AND NEW.removed_at IS NULL)
  OR NEW.approved_at < NEW.created_at
  OR NEW.approved_at > NEW.updated_at
  OR NEW.removed_at < NEW.created_at
  OR NEW.removed_at < NEW.approved_at
  OR NEW.removed_at > NEW.updated_at
BEGIN
  SELECT RAISE(ABORT, 'Peer relationship device lifecycle timestamps are inconsistent');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_relationship_devices_lifecycle_update
BEFORE UPDATE ON peer_relationship_devices
WHEN NEW.updated_at < OLD.updated_at
  OR OLD.created_at IS NOT NEW.created_at
  OR (OLD.approved_at IS NOT NULL AND OLD.approved_at IS NOT NEW.approved_at)
  OR (OLD.removed_at IS NOT NULL AND OLD.removed_at IS NOT NEW.removed_at)
  OR (OLD.status IN ('removed', 'revoked', 'compromised') AND NEW.status != OLD.status)
  OR (
    OLD.status = 'pending'
    AND NEW.status NOT IN ('pending', 'approved', 'removed', 'revoked', 'compromised')
  )
  OR (
    OLD.status = 'approved'
    AND NEW.status NOT IN ('approved', 'removed', 'revoked', 'compromised')
  )
  OR NEW.updated_at < NEW.created_at
  OR (NEW.status = 'pending' AND (NEW.approved_at IS NOT NULL OR NEW.removed_at IS NOT NULL))
  OR (NEW.status = 'approved' AND (NEW.approved_at IS NULL OR NEW.removed_at IS NOT NULL))
  OR (NEW.status IN ('removed', 'revoked', 'compromised') AND NEW.removed_at IS NULL)
  OR NEW.approved_at < NEW.created_at
  OR NEW.approved_at > NEW.updated_at
  OR NEW.removed_at < NEW.created_at
  OR NEW.removed_at < NEW.approved_at
  OR NEW.removed_at > NEW.updated_at
BEGIN
  SELECT RAISE(ABORT, 'Peer relationship device lifecycle transition is inconsistent');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_audit_events_no_update
BEFORE UPDATE ON peer_audit_events
BEGIN
  SELECT RAISE(ABORT, 'Peer audit events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_audit_events_no_delete
BEFORE DELETE ON peer_audit_events
BEGIN
  SELECT RAISE(ABORT, 'Peer audit events are append-only');
END;

ALTER TABLE peer_idempotency_records
  ADD COLUMN response_ciphertext TEXT
  CHECK (response_ciphertext IS NULL OR length(response_ciphertext) BETWEEN 32 AND 2097152);

ALTER TABLE peer_idempotency_records
  ADD COLUMN response_reference TEXT
  CHECK (response_reference IS NULL OR length(response_reference) BETWEEN 1 AND 240);

CREATE UNIQUE INDEX IF NOT EXISTS idx_peer_idempotency_response_reference
  ON peer_idempotency_records (owner_user_id, operation_id, response_reference)
  WHERE response_reference IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_peer_invitation_idempotency_encrypted
BEFORE INSERT ON peer_idempotency_records
WHEN NEW.operation_id = 'createPeerInvitation'
  AND (
    NEW.response_ciphertext IS NULL
    OR NEW.response_reference IS NULL
    OR json_extract(NEW.response_json, '$.encryptedResponseReference') IS NOT NEW.response_reference
    OR json_type(NEW.response_json, '$.invitation') IS NOT NULL
    OR NEW.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at, '+900 seconds')
  )
BEGIN
  SELECT RAISE(ABORT, 'peer invitation replay material must be encrypted and invitation-bounded');
END;

CREATE TABLE IF NOT EXISTS peer_companion_credentials (
  pairing_session_id TEXT PRIMARY KEY
    REFERENCES companion_pairing_sessions(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL UNIQUE CHECK (length(device_id) BETWEEN 16 AND 80),
  signing_public_key TEXT NOT NULL UNIQUE CHECK (length(signing_public_key) = 43),
  scopes_json TEXT NOT NULL
    CHECK (
      json_valid(scopes_json)
      AND json_type(scopes_json) = 'array'
      AND length(scopes_json) <= 4096
    ),
  capabilities_json TEXT NOT NULL
    CHECK (
      json_valid(capabilities_json)
      AND json_type(capabilities_json) = 'array'
      AND length(capabilities_json) <= 4096
    ),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  registered_at TEXT NOT NULL,
  last_authenticated_at TEXT NOT NULL,
  revoked_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (pairing_session_id, device_id),
  CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_peer_companion_credentials_owner_status
  ON peer_companion_credentials (owner_user_id, status, updated_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_peer_companion_credential_pairing_insert
BEFORE INSERT ON peer_companion_credentials
WHEN NOT EXISTS (
  SELECT 1
  FROM companion_pairing_sessions AS pairing
  WHERE pairing.id = NEW.pairing_session_id
    AND pairing.user_id = NEW.owner_user_id
    AND pairing.paired_at IS NOT NULL
    AND pairing.status IN ('paired', 'healthy', 'stale', 'permission_denied')
)
BEGIN
  SELECT RAISE(ABORT, 'peer companion credential requires an established companion pairing');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_companion_credential_binding_immutable
BEFORE UPDATE ON peer_companion_credentials
WHEN OLD.pairing_session_id IS NOT NEW.pairing_session_id
  OR OLD.owner_user_id IS NOT NEW.owner_user_id
  OR OLD.device_id IS NOT NEW.device_id
  OR OLD.signing_public_key IS NOT NEW.signing_public_key
  OR OLD.registered_at IS NOT NEW.registered_at
BEGIN
  SELECT RAISE(ABORT, 'peer companion credential binding is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_companion_credential_revocation_terminal
BEFORE UPDATE ON peer_companion_credentials
WHEN OLD.status = 'revoked'
BEGIN
  SELECT RAISE(ABORT, 'peer companion credential is already revoked');
END;

CREATE TABLE IF NOT EXISTS peer_companion_request_nonces (
  pairing_session_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  nonce_hash TEXT NOT NULL CHECK (length(nonce_hash) = 64),
  request_digest TEXT NOT NULL CHECK (length(request_digest) = 64),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (pairing_session_id, nonce_hash),
  FOREIGN KEY (pairing_session_id, device_id)
    REFERENCES peer_companion_credentials(pairing_session_id, device_id) ON DELETE CASCADE,
  CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS idx_peer_companion_nonces_expiry
  ON peer_companion_request_nonces (expires_at, pairing_session_id);

CREATE TRIGGER IF NOT EXISTS trg_peer_companion_nonce_no_update
BEFORE UPDATE ON peer_companion_request_nonces
BEGIN
  SELECT RAISE(ABORT, 'peer companion request nonce is immutable');
END;

-- Bind managed cache rows to the exact typed query that produced them. Existing
-- rows remain preserved with a NULL hash and are intentionally ineligible for
-- reads until an authenticated resync replaces them.
ALTER TABLE peer_remote_records
  ADD COLUMN query_hash TEXT
  CHECK (
    query_hash IS NULL
    OR (
      length(query_hash) = 64
      AND query_hash NOT GLOB '*[^0-9a-f]*'
    )
  );

ALTER TABLE peer_remote_records
  ADD COLUMN next_event_at TEXT
  CHECK (
    next_event_at IS NULL
    OR (
      projection_id IN ('calendar.availability.v1', 'calendar.selected_events.v1')
      AND julianday(next_event_at) IS NOT NULL
    )
  );

CREATE INDEX IF NOT EXISTS idx_peer_remote_records_exact_query
  ON peer_remote_records (
    owner_user_id,
    relationship_id,
    projection_id,
    query_hash,
    cache_state,
    received_at DESC,
    id DESC
  )
  WHERE query_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_peer_remote_records_next_calendar_event
  ON peer_remote_records (
    owner_user_id,
    cache_state,
    next_event_at,
    relationship_id
  )
  WHERE next_event_at IS NOT NULL
    AND projection_id IN ('calendar.availability.v1', 'calendar.selected_events.v1');

CREATE TRIGGER IF NOT EXISTS trg_peer_remote_records_query_binding_insert
BEFORE INSERT ON peer_remote_records
WHEN NEW.cache_state IN ('current', 'stale')
  AND (
    NEW.query_hash IS NULL
    OR json_type(NEW.query_metadata_json, '$.queryHash') != 'text'
    OR json_extract(NEW.query_metadata_json, '$.queryHash') IS NOT NEW.query_hash
  )
BEGIN
  SELECT RAISE(ABORT, 'current peer cache rows require an exact query binding');
END;

CREATE TRIGGER IF NOT EXISTS trg_peer_remote_records_query_binding_immutable
BEFORE UPDATE ON peer_remote_records
WHEN OLD.query_hash IS NOT NEW.query_hash
BEGIN
  SELECT RAISE(ABORT, 'peer cache query binding is immutable');
END;
