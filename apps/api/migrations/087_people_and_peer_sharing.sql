CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 240),
  normalized_display_name TEXT NOT NULL CHECK (length(normalized_display_name) BETWEEN 1 AND 240),
  given_name TEXT NOT NULL DEFAULT '' CHECK (length(given_name) <= 160),
  middle_name TEXT NOT NULL DEFAULT '' CHECK (length(middle_name) <= 160),
  family_name TEXT NOT NULL DEFAULT '' CHECK (length(family_name) <= 160),
  preferred_name TEXT NOT NULL DEFAULT '' CHECK (length(preferred_name) <= 160),
  pronouns TEXT NOT NULL DEFAULT '' CHECK (length(pronouns) <= 120),
  relationship_category TEXT NOT NULL DEFAULT '' CHECK (length(relationship_category) <= 120),
  relationship_label TEXT NOT NULL DEFAULT '' CHECK (length(relationship_label) <= 240),
  closeness INTEGER CHECK (closeness IS NULL OR closeness BETWEEN 0 AND 5),
  importance INTEGER CHECK (importance IS NULL OR importance BETWEEN 0 AND 5),
  short_description TEXT NOT NULL DEFAULT '' CHECK (length(short_description) <= 2000),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 50000),
  private_notes TEXT NOT NULL DEFAULT '' CHECK (length(private_notes) <= 100000),
  how_we_met TEXT NOT NULL DEFAULT '' CHECK (length(how_we_met) <= 10000),
  met_at TEXT CHECK (met_at IS NULL OR length(met_at) <= 64),
  birthday_year INTEGER CHECK (birthday_year IS NULL OR birthday_year BETWEEN 1 AND 9999),
  birthday_month INTEGER CHECK (birthday_month IS NULL OR birthday_month BETWEEN 1 AND 12),
  birthday_day INTEGER CHECK (birthday_day IS NULL OR birthday_day BETWEEN 1 AND 31),
  birthday_precision TEXT NOT NULL DEFAULT 'unknown'
    CHECK (birthday_precision IN ('unknown', 'year', 'month_day', 'year_month', 'full')),
  timezone TEXT NOT NULL DEFAULT '' CHECK (length(timezone) <= 128),
  home_place_label TEXT NOT NULL DEFAULT '' CHECK (length(home_place_label) <= 500),
  contact_preferences_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(contact_preferences_json) AND length(contact_preferences_json) <= 65536),
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json) AND length(metadata_json) <= 131072),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (id, user_id),
  CHECK (
    (birthday_precision = 'unknown' AND birthday_year IS NULL AND birthday_month IS NULL AND birthday_day IS NULL)
    OR (birthday_precision = 'year' AND birthday_year IS NOT NULL AND birthday_month IS NULL AND birthday_day IS NULL)
    OR (birthday_precision = 'month_day' AND birthday_year IS NULL AND birthday_month IS NOT NULL AND birthday_day IS NOT NULL)
    OR (birthday_precision = 'year_month' AND birthday_year IS NOT NULL AND birthday_month IS NOT NULL AND birthday_day IS NULL)
    OR (birthday_precision = 'full' AND birthday_year IS NOT NULL AND birthday_month IS NOT NULL AND birthday_day IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_people_owner_active_name
  ON people (user_id, deleted_at, normalized_display_name, id);

CREATE INDEX IF NOT EXISTS idx_people_owner_relationship
  ON people (user_id, relationship_category, deleted_at, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_people_owner_importance
  ON people (user_id, importance DESC, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS person_aliases (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  alias TEXT NOT NULL CHECK (length(trim(alias)) BETWEEN 1 AND 240),
  normalized_alias TEXT NOT NULL CHECK (length(normalized_alias) BETWEEN 1 AND 240),
  kind TEXT NOT NULL DEFAULT 'name'
    CHECK (kind IN ('name', 'nickname', 'former_name', 'handle')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (person_id, normalized_alias)
);

CREATE INDEX IF NOT EXISTS idx_person_aliases_normalized
  ON person_aliases (normalized_alias, person_id);

CREATE TABLE IF NOT EXISTS person_contact_methods (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN ('email', 'phone', 'messaging', 'social', 'address', 'website', 'custom')),
  label TEXT NOT NULL DEFAULT '' CHECK (length(label) <= 240),
  value TEXT NOT NULL CHECK (length(trim(value)) BETWEEN 1 AND 4000),
  normalized_value TEXT NOT NULL CHECK (length(normalized_value) BETWEEN 1 AND 4000),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'selected', 'shared')),
  provenance_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(provenance_json) AND length(provenance_json) <= 65536),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_person_contacts_person_active
  ON person_contact_methods (person_id, deleted_at, kind, is_primary DESC, created_at);

CREATE INDEX IF NOT EXISTS idx_person_contacts_normalized
  ON person_contact_methods (person_id, kind, normalized_value)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_person_contacts_one_primary_kind
  ON person_contact_methods (person_id, kind)
  WHERE is_primary = 1 AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS person_facts (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  fact_type TEXT NOT NULL CHECK (length(trim(fact_type)) BETWEEN 1 AND 120),
  label TEXT NOT NULL DEFAULT '' CHECK (length(label) <= 500),
  value_json TEXT NOT NULL
    CHECK (json_valid(value_json) AND length(value_json) <= 131072),
  sensitivity TEXT NOT NULL DEFAULT 'private'
    CHECK (sensitivity IN ('basic', 'private', 'sensitive', 'restricted')),
  source_kind TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_kind IN ('manual', 'imported', 'observed', 'inferred', 'entity')),
  source_entity_type TEXT CHECK (source_entity_type IS NULL OR length(source_entity_type) BETWEEN 1 AND 120),
  source_entity_id TEXT CHECK (source_entity_id IS NULL OR length(source_entity_id) BETWEEN 1 AND 240),
  observed_at TEXT,
  confidence REAL CHECK (confidence IS NULL OR confidence BETWEEN 0.0 AND 1.0),
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (
    (source_entity_type IS NULL AND source_entity_id IS NULL)
    OR (source_entity_type IS NOT NULL AND source_entity_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_person_facts_person_active
  ON person_facts (person_id, deleted_at, fact_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_person_facts_source
  ON person_facts (source_entity_type, source_entity_id, updated_at DESC)
  WHERE source_entity_type IS NOT NULL AND source_entity_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS person_actor_bindings (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  binding_kind TEXT NOT NULL DEFAULT 'self'
    CHECK (binding_kind IN ('self', 'local_actor')),
  verified_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (person_id, owner_user_id) REFERENCES people(id, user_id) ON DELETE CASCADE,
  UNIQUE (person_id, actor_user_id, binding_kind),
  CHECK (binding_kind != 'self' OR owner_user_id = actor_user_id)
);

CREATE INDEX IF NOT EXISTS idx_person_actor_bindings_owner
  ON person_actor_bindings (owner_user_id, actor_user_id, person_id);

CREATE TABLE IF NOT EXISTS forge_principals (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  principal_kind TEXT NOT NULL CHECK (principal_kind IN ('local', 'remote')),
  public_principal_id TEXT NOT NULL CHECK (length(public_principal_id) BETWEEN 16 AND 240),
  root_public_key TEXT NOT NULL CHECK (length(root_public_key) BETWEEN 32 AND 2048),
  root_key_secret_id TEXT CHECK (root_key_secret_id IS NULL OR length(root_key_secret_id) BETWEEN 1 AND 500),
  display_label TEXT NOT NULL DEFAULT '' CHECK (length(display_label) <= 240),
  local_person_id TEXT,
  trust_state TEXT NOT NULL DEFAULT 'unverified'
    CHECK (trust_state IN ('unverified', 'pending', 'verified', 'revoked', 'recovery_required')),
  minimum_protocol_version INTEGER NOT NULL DEFAULT 1 CHECK (minimum_protocol_version > 0),
  maximum_protocol_version INTEGER NOT NULL DEFAULT 1 CHECK (maximum_protocol_version >= minimum_protocol_version),
  first_verified_at TEXT,
  last_verified_at TEXT,
  revoked_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json) AND length(metadata_json) <= 65536),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (local_person_id, owner_user_id) REFERENCES people(id, user_id),
  UNIQUE (owner_user_id, public_principal_id),
  UNIQUE (id, owner_user_id),
  CHECK (principal_kind != 'local' OR root_key_secret_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_forge_principals_owner_state
  ON forge_principals (owner_user_id, trust_state, updated_at DESC);

CREATE TABLE IF NOT EXISTS forge_devices (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  certified_public_key TEXT NOT NULL CHECK (length(certified_public_key) BETWEEN 32 AND 2048),
  private_key_secret_id TEXT CHECK (private_key_secret_id IS NULL OR length(private_key_secret_id) BETWEEN 1 AND 500),
  certificate TEXT NOT NULL CHECK (length(certificate) BETWEEN 64 AND 32768),
  label TEXT NOT NULL DEFAULT '' CHECK (length(label) <= 240),
  device_type TEXT NOT NULL DEFAULT 'unknown' CHECK (length(device_type) BETWEEN 1 AND 80),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'removed', 'revoked', 'compromised')),
  transport_endpoints_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(transport_endpoints_json) AND length(transport_endpoints_json) <= 131072),
  capabilities_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(capabilities_json) AND length(capabilities_json) <= 65536),
  added_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (principal_id, owner_user_id) REFERENCES forge_principals(id, owner_user_id) ON DELETE CASCADE,
  UNIQUE (id, owner_user_id)
);

CREATE INDEX IF NOT EXISTS idx_forge_devices_principal_state
  ON forge_devices (owner_user_id, principal_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS forge_webauthn_credentials (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rp_id TEXT NOT NULL CHECK (length(rp_id) BETWEEN 1 AND 253),
  credential_id TEXT NOT NULL UNIQUE CHECK (length(credential_id) BETWEEN 16 AND 4096),
  public_key_base64 TEXT NOT NULL CHECK (length(public_key_base64) BETWEEN 32 AND 32768),
  counter INTEGER NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transports_json TEXT NOT NULL DEFAULT '[]'
    CHECK (
      json_valid(transports_json)
      AND json_type(transports_json) = 'array'
      AND length(transports_json) <= 4096
    ),
  label TEXT NOT NULL DEFAULT '' CHECK (length(label) <= 240),
  device_type TEXT NOT NULL DEFAULT 'singleDevice'
    CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up INTEGER NOT NULL DEFAULT 0 CHECK (backed_up IN (0, 1)),
  aaguid TEXT NOT NULL DEFAULT '' CHECK (length(aaguid) <= 128),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  UNIQUE (id, owner_user_id),
  CHECK (
    (status = 'revoked' AND revoked_at IS NOT NULL)
    OR (status = 'active' AND revoked_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_forge_webauthn_credentials_owner_status
  ON forge_webauthn_credentials (owner_user_id, status, rp_id, created_at DESC);

CREATE TABLE IF NOT EXISTS forge_human_presence_challenges (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  principal_class TEXT NOT NULL
    CHECK (principal_class IN ('operator_session', 'companion_consent')),
  principal_id TEXT NOT NULL CHECK (length(principal_id) BETWEEN 1 AND 240),
  principal_origin TEXT CHECK (principal_origin IS NULL OR length(principal_origin) <= 2048),
  ceremony TEXT NOT NULL CHECK (ceremony IN ('register', 'authenticate', 'companion')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'consumed', 'canceled', 'expired')),
  session_binding_keyed_hash TEXT NOT NULL CHECK (length(session_binding_keyed_hash) = 64),
  rp_id TEXT NOT NULL CHECK (length(rp_id) BETWEEN 1 AND 253),
  expected_origin TEXT NOT NULL CHECK (length(expected_origin) BETWEEN 1 AND 2048),
  challenge_keyed_hash TEXT NOT NULL UNIQUE CHECK (length(challenge_keyed_hash) = 64),
  action_digest TEXT CHECK (action_digest IS NULL OR length(action_digest) = 64),
  credential_set_version TEXT
    CHECK (credential_set_version IS NULL OR length(credential_set_version) = 64),
  credential_label TEXT CHECK (credential_label IS NULL OR length(credential_label) <= 120),
  verified_credential_id TEXT,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  issued_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (verified_credential_id, owner_user_id)
    REFERENCES forge_webauthn_credentials(id, owner_user_id),
  UNIQUE (id, owner_user_id),
  UNIQUE (
    id,
    owner_user_id,
    principal_class,
    principal_id,
    session_binding_keyed_hash
  ),
  CHECK (ceremony = 'companion' OR credential_set_version IS NOT NULL),
  CHECK (
    (ceremony = 'register' AND credential_label IS NOT NULL)
    OR (ceremony != 'register' AND credential_label IS NULL)
  ),
  CHECK (
    (status = 'consumed' AND consumed_at IS NOT NULL)
    OR (status != 'consumed' AND consumed_at IS NULL)
  ),
  CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS idx_forge_presence_challenges_owner_status_expiry
  ON forge_human_presence_challenges (owner_user_id, status, expires_at, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_forge_presence_challenges_principal
  ON forge_human_presence_challenges (
    owner_user_id,
    principal_class,
    principal_id,
    status,
    expires_at
  );

CREATE TABLE IF NOT EXISTS forge_human_presence_capabilities (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  challenge_id TEXT NOT NULL,
  principal_class TEXT NOT NULL
    CHECK (principal_class IN ('operator_session', 'companion_consent')),
  principal_id TEXT NOT NULL CHECK (length(principal_id) BETWEEN 1 AND 240),
  principal_origin TEXT CHECK (principal_origin IS NULL OR length(principal_origin) <= 2048),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'consumed', 'revoked', 'expired')),
  session_binding_keyed_hash TEXT NOT NULL CHECK (length(session_binding_keyed_hash) = 64),
  capability_keyed_hash TEXT NOT NULL UNIQUE CHECK (length(capability_keyed_hash) = 64),
  action_digest TEXT NOT NULL CHECK (length(action_digest) = 64),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (
    challenge_id,
    owner_user_id,
    principal_class,
    principal_id,
    session_binding_keyed_hash
  ) REFERENCES forge_human_presence_challenges (
    id,
    owner_user_id,
    principal_class,
    principal_id,
    session_binding_keyed_hash
  ),
  UNIQUE (id, owner_user_id),
  CHECK (
    (status = 'consumed' AND consumed_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'revoked' AND consumed_at IS NULL AND revoked_at IS NOT NULL)
    OR (status IN ('active', 'expired') AND consumed_at IS NULL AND revoked_at IS NULL)
  ),
  CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS idx_forge_presence_capabilities_owner_status_expiry
  ON forge_human_presence_capabilities (owner_user_id, status, expires_at, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_forge_presence_capabilities_principal_status
  ON forge_human_presence_capabilities (
    owner_user_id,
    principal_class,
    principal_id,
    status,
    expires_at
  );

CREATE TABLE IF NOT EXISTS forge_human_presence_audit_events (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 1 AND 160),
  outcome TEXT NOT NULL CHECK (outcome IN ('recorded', 'allowed', 'denied', 'failed')),
  session_binding_keyed_hash TEXT CHECK (
    session_binding_keyed_hash IS NULL OR length(session_binding_keyed_hash) = 64
  ),
  principal_class TEXT NOT NULL
    CHECK (principal_class IN ('operator_session', 'companion_consent')),
  principal_id TEXT NOT NULL CHECK (length(principal_id) BETWEEN 1 AND 240),
  principal_origin TEXT CHECK (principal_origin IS NULL OR length(principal_origin) <= 2048),
  credential_id TEXT,
  challenge_id TEXT,
  capability_id TEXT,
  action_digest TEXT CHECK (action_digest IS NULL OR length(action_digest) = 64),
  evidence_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(evidence_json) AND length(evidence_json) <= 262144),
  created_at TEXT NOT NULL,
  FOREIGN KEY (credential_id, owner_user_id)
    REFERENCES forge_webauthn_credentials(id, owner_user_id),
  FOREIGN KEY (challenge_id, owner_user_id)
    REFERENCES forge_human_presence_challenges(id, owner_user_id),
  FOREIGN KEY (capability_id, owner_user_id)
    REFERENCES forge_human_presence_capabilities(id, owner_user_id)
);

CREATE INDEX IF NOT EXISTS idx_forge_presence_audit_owner_time
  ON forge_human_presence_audit_events (owner_user_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_forge_presence_audit_challenge
  ON forge_human_presence_audit_events (owner_user_id, challenge_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_forge_presence_audit_capability
  ON forge_human_presence_audit_events (owner_user_id, capability_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_forge_presence_capabilities_consumed_challenge
BEFORE INSERT ON forge_human_presence_capabilities
WHEN NOT EXISTS (
  SELECT 1
  FROM forge_human_presence_challenges AS challenge
  WHERE challenge.id = NEW.challenge_id
    AND challenge.owner_user_id = NEW.owner_user_id
    AND challenge.principal_class = NEW.principal_class
    AND challenge.principal_id = NEW.principal_id
    AND challenge.principal_origin IS NEW.principal_origin
    AND challenge.session_binding_keyed_hash = NEW.session_binding_keyed_hash
    AND challenge.action_digest = NEW.action_digest
    AND challenge.status = 'consumed'
)
BEGIN
  SELECT RAISE(ABORT, 'human-presence capability requires the exact consumed challenge');
END;

CREATE TRIGGER IF NOT EXISTS trg_forge_webauthn_credentials_identity_immutable
BEFORE UPDATE ON forge_webauthn_credentials
WHEN OLD.owner_user_id IS NOT NEW.owner_user_id
  OR OLD.rp_id IS NOT NEW.rp_id
  OR OLD.credential_id IS NOT NEW.credential_id
  OR OLD.public_key_base64 IS NOT NEW.public_key_base64
  OR OLD.created_at IS NOT NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'WebAuthn credential identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_forge_webauthn_credentials_revocation_terminal
BEFORE UPDATE ON forge_webauthn_credentials
WHEN OLD.status = 'revoked'
BEGIN
  SELECT RAISE(ABORT, 'WebAuthn credential is already revoked');
END;

CREATE TRIGGER IF NOT EXISTS trg_forge_presence_challenges_binding_immutable
BEFORE UPDATE ON forge_human_presence_challenges
WHEN OLD.owner_user_id IS NOT NEW.owner_user_id
  OR OLD.principal_class IS NOT NEW.principal_class
  OR OLD.principal_id IS NOT NEW.principal_id
  OR OLD.principal_origin IS NOT NEW.principal_origin
  OR OLD.ceremony IS NOT NEW.ceremony
  OR OLD.session_binding_keyed_hash IS NOT NEW.session_binding_keyed_hash
  OR OLD.rp_id IS NOT NEW.rp_id
  OR OLD.expected_origin IS NOT NEW.expected_origin
  OR OLD.challenge_keyed_hash IS NOT NEW.challenge_keyed_hash
  OR OLD.action_digest IS NOT NEW.action_digest
  OR OLD.credential_set_version IS NOT NEW.credential_set_version
  OR OLD.credential_label IS NOT NEW.credential_label
  OR OLD.expires_at IS NOT NEW.expires_at
  OR OLD.issued_at IS NOT NEW.issued_at
BEGIN
  SELECT RAISE(ABORT, 'human-presence challenge binding is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_forge_presence_challenges_terminal
BEFORE UPDATE ON forge_human_presence_challenges
WHEN OLD.status != 'pending'
BEGIN
  SELECT RAISE(ABORT, 'human-presence challenge is already terminal');
END;

CREATE TRIGGER IF NOT EXISTS trg_forge_presence_capabilities_binding_immutable
BEFORE UPDATE ON forge_human_presence_capabilities
WHEN OLD.owner_user_id IS NOT NEW.owner_user_id
  OR OLD.challenge_id IS NOT NEW.challenge_id
  OR OLD.principal_class IS NOT NEW.principal_class
  OR OLD.principal_id IS NOT NEW.principal_id
  OR OLD.principal_origin IS NOT NEW.principal_origin
  OR OLD.session_binding_keyed_hash IS NOT NEW.session_binding_keyed_hash
  OR OLD.capability_keyed_hash IS NOT NEW.capability_keyed_hash
  OR OLD.action_digest IS NOT NEW.action_digest
  OR OLD.issued_at IS NOT NEW.issued_at
  OR OLD.expires_at IS NOT NEW.expires_at
BEGIN
  SELECT RAISE(ABORT, 'human-presence capability binding is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_forge_presence_capabilities_terminal
BEFORE UPDATE ON forge_human_presence_capabilities
WHEN OLD.status != 'active'
BEGIN
  SELECT RAISE(ABORT, 'human-presence capability is already terminal');
END;

CREATE TRIGGER IF NOT EXISTS trg_forge_presence_audit_no_update
BEFORE UPDATE ON forge_human_presence_audit_events
BEGIN
  SELECT RAISE(ABORT, 'human-presence audit events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_forge_presence_audit_no_delete
BEFORE DELETE ON forge_human_presence_audit_events
BEGIN
  SELECT RAISE(ABORT, 'human-presence audit events are append-only');
END;

CREATE TABLE IF NOT EXISTS peer_pairing_invites (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  inviter_principal_id TEXT NOT NULL,
  inviter_device_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'claimed', 'consumed', 'canceled', 'expired', 'locked')),
  bootstrap_ciphertext BLOB NOT NULL
    CHECK (typeof(bootstrap_ciphertext) = 'blob' AND length(bootstrap_ciphertext) BETWEEN 32 AND 65536),
  bootstrap_nonce BLOB NOT NULL
    CHECK (typeof(bootstrap_nonce) = 'blob' AND length(bootstrap_nonce) BETWEEN 12 AND 64),
  bootstrap_hash TEXT NOT NULL CHECK (length(bootstrap_hash) = 64),
  invitation_fingerprint TEXT NOT NULL CHECK (length(invitation_fingerprint) BETWEEN 16 AND 120),
  protocol_version TEXT NOT NULL DEFAULT 'forge-peer/1' CHECK (length(protocol_version) <= 80),
  transport_kinds_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(transport_kinds_json) AND length(transport_kinds_json) <= 4096),
  monotonic_sequence INTEGER NOT NULL DEFAULT 1 CHECK (monotonic_sequence > 0),
  failed_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempt_count >= 0),
  maximum_attempts INTEGER NOT NULL DEFAULT 5 CHECK (maximum_attempts BETWEEN 1 AND 100),
  expires_at TEXT NOT NULL,
  claimed_at TEXT,
  consumed_at TEXT,
  canceled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (inviter_principal_id, owner_user_id) REFERENCES forge_principals(id, owner_user_id),
  FOREIGN KEY (inviter_device_id, owner_user_id) REFERENCES forge_devices(id, owner_user_id),
  UNIQUE (id, owner_user_id),
  CHECK (failed_attempt_count <= maximum_attempts)
);

CREATE INDEX IF NOT EXISTS idx_peer_pairing_invites_active
  ON peer_pairing_invites (owner_user_id, status, expires_at, created_at DESC);

CREATE TABLE IF NOT EXISTS peer_relationships (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  local_principal_id TEXT NOT NULL,
  remote_principal_id TEXT NOT NULL,
  local_person_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('pending_verification', 'active', 'paused', 'revoked', 'recovery_required')),
  negotiated_protocol_version TEXT NOT NULL DEFAULT 'forge-peer/1'
    CHECK (length(negotiated_protocol_version) BETWEEN 1 AND 80),
  verification_phrase_hash TEXT NOT NULL CHECK (length(verification_phrase_hash) = 64),
  transport_privacy_mode TEXT NOT NULL DEFAULT 'fastest'
    CHECK (transport_privacy_mode IN ('fastest', 'hide_network_address', 'custom')),
  highest_received_sequence INTEGER NOT NULL DEFAULT 0 CHECK (highest_received_sequence >= 0),
  highest_sent_sequence INTEGER NOT NULL DEFAULT 0 CHECK (highest_sent_sequence >= 0),
  established_at TEXT,
  last_connected_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (local_principal_id, owner_user_id) REFERENCES forge_principals(id, owner_user_id),
  FOREIGN KEY (remote_principal_id, owner_user_id) REFERENCES forge_principals(id, owner_user_id),
  FOREIGN KEY (local_person_id, owner_user_id) REFERENCES people(id, user_id),
  UNIQUE (owner_user_id, remote_principal_id),
  UNIQUE (id, owner_user_id),
  CHECK (local_principal_id != remote_principal_id)
);

CREATE INDEX IF NOT EXISTS idx_peer_relationships_owner_state
  ON peer_relationships (owner_user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS peer_relationship_devices (
  relationship_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  principal_role TEXT NOT NULL CHECK (principal_role IN ('local', 'remote')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'removed', 'revoked', 'compromised')),
  approved_at TEXT,
  removed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (relationship_id, device_id),
  FOREIGN KEY (relationship_id, owner_user_id) REFERENCES peer_relationships(id, owner_user_id) ON DELETE CASCADE,
  FOREIGN KEY (device_id, owner_user_id) REFERENCES forge_devices(id, owner_user_id)
);

CREATE INDEX IF NOT EXISTS idx_peer_relationship_devices_state
  ON peer_relationship_devices (owner_user_id, relationship_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS peer_share_grants (
  id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  owner_user_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('local_to_remote', 'remote_to_local')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'proposed', 'active', 'countered', 'rejected', 'revoked', 'superseded', 'expired', 'conflicted')),
  previous_version_hash TEXT CHECK (previous_version_hash IS NULL OR length(previous_version_hash) = 64),
  version_hash TEXT NOT NULL CHECK (length(version_hash) = 64),
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 160),
  purpose TEXT NOT NULL DEFAULT '' CHECK (length(purpose) <= 2000),
  canonical_grant_json TEXT NOT NULL
    CHECK (
      json_valid(canonical_grant_json)
      AND json_type(canonical_grant_json) = 'object'
      AND length(canonical_grant_json) <= 10485760
    ),
  cache_policy_json TEXT NOT NULL
    CHECK (
      json_valid(cache_policy_json)
      AND json_type(cache_policy_json) = 'object'
      AND length(cache_policy_json) <= 32768
    ),
  signatures_json TEXT NOT NULL DEFAULT '[]'
    CHECK (
      json_valid(signatures_json)
      AND json_type(signatures_json) = 'array'
      AND length(signatures_json) <= 131072
    ),
  verification_evidence_json TEXT NOT NULL DEFAULT '{}'
    CHECK (
      json_valid(verification_evidence_json)
      AND json_type(verification_evidence_json) = 'object'
      AND length(verification_evidence_json) <= 262144
    ),
  protocol_version TEXT NOT NULL DEFAULT 'forge-peer/1' CHECK (length(protocol_version) <= 80),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  issued_at TEXT NOT NULL,
  accepted_at TEXT,
  effective_at TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id, sequence),
  FOREIGN KEY (relationship_id, owner_user_id) REFERENCES peer_relationships(id, owner_user_id),
  UNIQUE (id, sequence, owner_user_id),
  CHECK (
    (sequence = 1 AND previous_version_hash IS NULL)
    OR (sequence > 1 AND previous_version_hash IS NOT NULL)
  ),
  CHECK (expires_at IS NULL OR expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS idx_peer_share_grants_relationship
  ON peer_share_grants (owner_user_id, relationship_id, direction, status, sequence DESC);

CREATE INDEX IF NOT EXISTS idx_peer_share_grants_expiry
  ON peer_share_grants (owner_user_id, status, expires_at)
  WHERE status IN ('proposed', 'active');

CREATE TRIGGER IF NOT EXISTS trg_peer_share_grants_exact_previous_version
BEFORE INSERT ON peer_share_grants
WHEN NEW.sequence > 1 AND NOT EXISTS (
  SELECT 1
  FROM peer_share_grants AS previous_version
  WHERE previous_version.id = NEW.id
    AND previous_version.sequence = NEW.sequence - 1
    AND previous_version.owner_user_id = NEW.owner_user_id
    AND previous_version.relationship_id = NEW.relationship_id
    AND previous_version.direction = NEW.direction
    AND previous_version.version_hash = NEW.previous_version_hash
    AND NEW.issued_at >= previous_version.issued_at
)
BEGIN
  SELECT RAISE(ABORT, 'grant version does not extend the exact previous version');
END;

CREATE TABLE IF NOT EXISTS peer_grant_signatures (
  grant_id TEXT NOT NULL,
  grant_sequence INTEGER NOT NULL,
  owner_user_id TEXT NOT NULL,
  signer_device_id TEXT NOT NULL,
  party TEXT NOT NULL CHECK (party IN ('grantor', 'grantee')),
  algorithm TEXT NOT NULL CHECK (algorithm = 'ed25519'),
  signature TEXT NOT NULL CHECK (length(signature) BETWEEN 64 AND 256),
  signed_grant_hash TEXT NOT NULL CHECK (length(signed_grant_hash) = 64),
  signed_at TEXT NOT NULL,
  verification_evidence_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(verification_evidence_json) AND length(verification_evidence_json) <= 131072),
  created_at TEXT NOT NULL,
  PRIMARY KEY (grant_id, grant_sequence, signer_device_id),
  FOREIGN KEY (grant_id, grant_sequence, owner_user_id)
    REFERENCES peer_share_grants(id, sequence, owner_user_id) ON DELETE CASCADE,
  FOREIGN KEY (signer_device_id, owner_user_id)
    REFERENCES forge_devices(id, owner_user_id)
);

CREATE INDEX IF NOT EXISTS idx_peer_grant_signatures_party
  ON peer_grant_signatures (
    owner_user_id,
    grant_id,
    grant_sequence,
    party,
    signed_at DESC
  );

CREATE TRIGGER IF NOT EXISTS trg_peer_grant_signatures_exact_version
BEFORE INSERT ON peer_grant_signatures
WHEN NOT EXISTS (
  SELECT 1
  FROM peer_share_grants AS grant_version
  WHERE grant_version.id = NEW.grant_id
    AND grant_version.sequence = NEW.grant_sequence
    AND grant_version.owner_user_id = NEW.owner_user_id
    AND grant_version.version_hash = NEW.signed_grant_hash
    AND NEW.signed_at >= grant_version.issued_at
)
BEGIN
  SELECT RAISE(ABORT, 'grant signature does not match the exact grant version');
END;

CREATE TABLE IF NOT EXISTS peer_share_rules (
  grant_id TEXT NOT NULL,
  grant_sequence INTEGER NOT NULL,
  owner_user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rule_position INTEGER NOT NULL CHECK (rule_position BETWEEN 0 AND 255),
  projection_id TEXT NOT NULL CHECK (length(projection_id) BETWEEN 1 AND 160),
  projection_version INTEGER NOT NULL DEFAULT 1 CHECK (projection_version > 0),
  effect TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
  entity_selector_json TEXT
    CHECK (entity_selector_json IS NULL OR (json_valid(entity_selector_json) AND length(entity_selector_json) <= 262144)),
  field_policy_json TEXT NOT NULL
    CHECK (json_valid(field_policy_json) AND length(field_policy_json) <= 131072),
  time_policy_json TEXT NOT NULL
    CHECK (json_valid(time_policy_json) AND length(time_policy_json) <= 32768),
  precision TEXT CHECK (precision IS NULL OR length(precision) <= 80),
  aggregation_policy_json TEXT
    CHECK (aggregation_policy_json IS NULL OR (json_valid(aggregation_policy_json) AND length(aggregation_policy_json) <= 32768)),
  approved_device_ids_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(approved_device_ids_json) AND length(approved_device_ids_json) <= 65536),
  device_policy TEXT NOT NULL DEFAULT 'explicit'
    CHECK (device_policy IN ('explicit', 'approved_current_devices')),
  maximum_result_count INTEGER NOT NULL DEFAULT 100 CHECK (maximum_result_count BETWEEN 1 AND 10000),
  maximum_payload_bytes INTEGER NOT NULL DEFAULT 262144 CHECK (maximum_payload_bytes BETWEEN 256 AND 10485760),
  created_at TEXT NOT NULL,
  PRIMARY KEY (grant_id, grant_sequence, id),
  FOREIGN KEY (grant_id, grant_sequence, owner_user_id)
    REFERENCES peer_share_grants(id, sequence, owner_user_id) ON DELETE CASCADE,
  UNIQUE (grant_id, grant_sequence, rule_position)
);

CREATE INDEX IF NOT EXISTS idx_peer_share_rules_projection
  ON peer_share_rules (owner_user_id, projection_id, effect, grant_id, grant_sequence DESC);

CREATE TABLE IF NOT EXISTS peer_grant_verifications (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  grant_sequence INTEGER NOT NULL,
  verified_grant_hash TEXT NOT NULL CHECK (length(verified_grant_hash) = 64),
  verified_signatures_json TEXT NOT NULL
    CHECK (
      json_valid(verified_signatures_json)
      AND json_type(verified_signatures_json) = 'array'
      AND length(verified_signatures_json) <= 262144
    ),
  verified_signer_device_ids_json TEXT NOT NULL
    CHECK (
      json_valid(verified_signer_device_ids_json)
      AND json_type(verified_signer_device_ids_json) = 'array'
      AND length(verified_signer_device_ids_json) <= 65536
    ),
  approved_relationship_device_ids_json TEXT NOT NULL
    CHECK (
      json_valid(approved_relationship_device_ids_json)
      AND json_type(approved_relationship_device_ids_json) = 'array'
      AND length(approved_relationship_device_ids_json) <= 65536
    ),
  requesting_device_id TEXT,
  verification_result TEXT NOT NULL CHECK (verification_result IN ('valid', 'invalid')),
  failure_reason TEXT NOT NULL DEFAULT '' CHECK (length(failure_reason) <= 1000),
  verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (relationship_id, owner_user_id) REFERENCES peer_relationships(id, owner_user_id),
  FOREIGN KEY (grant_id, grant_sequence, owner_user_id)
    REFERENCES peer_share_grants(id, sequence, owner_user_id),
  FOREIGN KEY (requesting_device_id, owner_user_id) REFERENCES forge_devices(id, owner_user_id),
  UNIQUE (id, owner_user_id)
);

CREATE INDEX IF NOT EXISTS idx_peer_grant_verifications_grant
  ON peer_grant_verifications (
    owner_user_id,
    grant_id,
    grant_sequence,
    verification_result,
    verified_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_peer_grant_verifications_relationship
  ON peer_grant_verifications (owner_user_id, relationship_id, requesting_device_id, verified_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_peer_grant_verifications_exact_valid_version
BEFORE INSERT ON peer_grant_verifications
WHEN NEW.verification_result = 'valid' AND NOT EXISTS (
  SELECT 1
  FROM peer_share_grants AS grant_version
  WHERE grant_version.id = NEW.grant_id
    AND grant_version.sequence = NEW.grant_sequence
    AND grant_version.owner_user_id = NEW.owner_user_id
    AND grant_version.relationship_id = NEW.relationship_id
    AND grant_version.version_hash = NEW.verified_grant_hash
)
BEGIN
  SELECT RAISE(ABORT, 'valid verification does not match the exact grant version');
END;

CREATE TABLE IF NOT EXISTS peer_projection_changes (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  projection_id TEXT NOT NULL CHECK (length(projection_id) BETWEEN 1 AND 160),
  projection_version INTEGER NOT NULL DEFAULT 1 CHECK (projection_version > 0),
  change_sequence INTEGER NOT NULL CHECK (change_sequence > 0),
  source_entity_type TEXT NOT NULL CHECK (length(source_entity_type) BETWEEN 1 AND 120),
  source_entity_id TEXT NOT NULL CHECK (length(source_entity_id) BETWEEN 1 AND 240),
  source_version TEXT NOT NULL CHECK (length(source_version) BETWEEN 1 AND 240),
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'tombstone', 'withdrawal')),
  encrypted_payload_ref TEXT CHECK (encrypted_payload_ref IS NULL OR length(encrypted_payload_ref) <= 1000),
  payload_hash TEXT CHECK (payload_hash IS NULL OR length(payload_hash) = 64),
  grant_id TEXT,
  grant_sequence INTEGER,
  claimed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (relationship_id, owner_user_id) REFERENCES peer_relationships(id, owner_user_id),
  FOREIGN KEY (grant_id, grant_sequence, owner_user_id)
    REFERENCES peer_share_grants(id, sequence, owner_user_id),
  UNIQUE (owner_user_id, relationship_id, projection_id, change_sequence),
  CHECK (
    (grant_id IS NULL AND grant_sequence IS NULL)
    OR (grant_id IS NOT NULL AND grant_sequence IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_peer_projection_changes_claim
  ON peer_projection_changes (owner_user_id, relationship_id, claimed_at, change_sequence);

CREATE INDEX IF NOT EXISTS idx_peer_projection_changes_source
  ON peer_projection_changes (owner_user_id, source_entity_type, source_entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS peer_outbox (
  envelope_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  recipient_device_id TEXT NOT NULL,
  channel_id TEXT NOT NULL CHECK (length(channel_id) BETWEEN 16 AND 240),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  previous_acknowledgement INTEGER NOT NULL DEFAULT 0 CHECK (previous_acknowledgement >= 0),
  message_kind TEXT NOT NULL CHECK (length(message_kind) BETWEEN 1 AND 120),
  mls_epoch INTEGER NOT NULL CHECK (mls_epoch >= 0),
  ciphertext BLOB NOT NULL
    CHECK (typeof(ciphertext) = 'blob' AND length(ciphertext) BETWEEN 1 AND 10485760),
  ciphertext_hash TEXT NOT NULL CHECK (length(ciphertext_hash) = 64),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760 AND size_bytes = length(ciphertext)),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_flight', 'acknowledged', 'expired', 'failed', 'canceled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT NOT NULL,
  last_attempt_at TEXT,
  acknowledged_at TEXT,
  expires_at TEXT NOT NULL,
  last_error TEXT NOT NULL DEFAULT '' CHECK (length(last_error) <= 4000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (relationship_id, owner_user_id) REFERENCES peer_relationships(id, owner_user_id),
  FOREIGN KEY (recipient_device_id, owner_user_id) REFERENCES forge_devices(id, owner_user_id),
  UNIQUE (owner_user_id, relationship_id, recipient_device_id, channel_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_peer_outbox_due
  ON peer_outbox (owner_user_id, status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_peer_outbox_relationship
  ON peer_outbox (owner_user_id, relationship_id, status, sequence);

CREATE INDEX IF NOT EXISTS idx_peer_outbox_in_flight_lease
  ON peer_outbox (owner_user_id, last_attempt_at, created_at)
  WHERE status = 'in_flight';

CREATE TABLE IF NOT EXISTS peer_inbox (
  envelope_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  sender_device_id TEXT NOT NULL,
  channel_id TEXT NOT NULL CHECK (length(channel_id) BETWEEN 16 AND 240),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  message_kind TEXT NOT NULL CHECK (length(message_kind) BETWEEN 1 AND 120),
  mls_epoch INTEGER NOT NULL CHECK (mls_epoch >= 0),
  ciphertext BLOB NOT NULL
    CHECK (typeof(ciphertext) = 'blob' AND length(ciphertext) BETWEEN 1 AND 10485760),
  ciphertext_hash TEXT NOT NULL CHECK (length(ciphertext_hash) = 64),
  processing_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (processing_state IN ('pending', 'processing', 'processed', 'rejected', 'duplicate')),
  received_at TEXT NOT NULL,
  processed_at TEXT,
  expires_at TEXT NOT NULL,
  failure_reason TEXT NOT NULL DEFAULT '' CHECK (length(failure_reason) <= 4000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (relationship_id, owner_user_id) REFERENCES peer_relationships(id, owner_user_id),
  FOREIGN KEY (sender_device_id, owner_user_id) REFERENCES forge_devices(id, owner_user_id),
  UNIQUE (owner_user_id, relationship_id, sender_device_id, channel_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_peer_inbox_pending
  ON peer_inbox (owner_user_id, processing_state, received_at)
  WHERE processing_state IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_peer_inbox_relationship
  ON peer_inbox (owner_user_id, relationship_id, sender_device_id, sequence);

CREATE INDEX IF NOT EXISTS idx_peer_inbox_processing_lease
  ON peer_inbox (owner_user_id, updated_at, received_at)
  WHERE processing_state = 'processing';

CREATE TABLE IF NOT EXISTS peer_delivery_receipts (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  acknowledging_device_id TEXT NOT NULL,
  channel_id TEXT NOT NULL CHECK (length(channel_id) BETWEEN 16 AND 240),
  highest_contiguous_sequence INTEGER NOT NULL CHECK (highest_contiguous_sequence >= 0),
  acknowledgement_signature TEXT NOT NULL CHECK (length(acknowledgement_signature) BETWEEN 64 AND 2048),
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (relationship_id, owner_user_id) REFERENCES peer_relationships(id, owner_user_id),
  FOREIGN KEY (acknowledging_device_id, owner_user_id) REFERENCES forge_devices(id, owner_user_id),
  UNIQUE (owner_user_id, relationship_id, acknowledging_device_id, channel_id, highest_contiguous_sequence)
);

CREATE INDEX IF NOT EXISTS idx_peer_delivery_receipts_latest
  ON peer_delivery_receipts (
    owner_user_id,
    relationship_id,
    acknowledging_device_id,
    channel_id,
    highest_contiguous_sequence DESC
  );

CREATE TABLE IF NOT EXISTS peer_remote_records (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  projection_id TEXT NOT NULL CHECK (length(projection_id) BETWEEN 1 AND 160),
  projection_version INTEGER NOT NULL DEFAULT 1 CHECK (projection_version > 0),
  source_record_id TEXT NOT NULL CHECK (length(source_record_id) BETWEEN 1 AND 500),
  source_version TEXT NOT NULL CHECK (length(source_version) BETWEEN 1 AND 240),
  encrypted_payload BLOB NOT NULL
    CHECK (typeof(encrypted_payload) = 'blob' AND length(encrypted_payload) BETWEEN 1 AND 10485760),
  encryption_key_id TEXT NOT NULL CHECK (length(encryption_key_id) BETWEEN 1 AND 500),
  encryption_nonce BLOB NOT NULL
    CHECK (typeof(encryption_nonce) = 'blob' AND length(encryption_nonce) BETWEEN 12 AND 64),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  query_metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(query_metadata_json) AND length(query_metadata_json) <= 32768),
  source_timestamp TEXT NOT NULL,
  received_at TEXT NOT NULL,
  valid_until TEXT,
  completeness REAL NOT NULL DEFAULT 1.0 CHECK (completeness BETWEEN 0.0 AND 1.0),
  precision TEXT NOT NULL DEFAULT 'exact' CHECK (length(precision) BETWEEN 1 AND 80),
  grant_id TEXT,
  grant_sequence INTEGER,
  cache_state TEXT NOT NULL DEFAULT 'current'
    CHECK (cache_state IN ('current', 'stale', 'revoked', 'withdrawn', 'key_unavailable')),
  tombstoned_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (relationship_id, owner_user_id) REFERENCES peer_relationships(id, owner_user_id),
  FOREIGN KEY (grant_id, grant_sequence, owner_user_id)
    REFERENCES peer_share_grants(id, sequence, owner_user_id),
  UNIQUE (owner_user_id, relationship_id, projection_id, source_record_id),
  CHECK (
    (grant_id IS NULL AND grant_sequence IS NULL)
    OR (grant_id IS NOT NULL AND grant_sequence IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_peer_remote_records_query
  ON peer_remote_records (
    owner_user_id,
    relationship_id,
    projection_id,
    cache_state,
    valid_until,
    source_timestamp DESC
  );

CREATE TABLE IF NOT EXISTS peer_query_audit (
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

CREATE INDEX IF NOT EXISTS idx_peer_query_audit_owner_time
  ON peer_query_audit (owner_user_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_peer_query_audit_relationship
  ON peer_query_audit (owner_user_id, relationship_id, projection_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_peer_query_audit_exact_allowed_verification
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

CREATE TABLE IF NOT EXISTS peer_audit_events (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  relationship_id TEXT,
  event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 1 AND 160),
  actor_class TEXT NOT NULL
    CHECK (actor_class IN ('operator_session', 'agent_token', 'companion_session', 'companion_consent', 'peer_device', 'local_service', 'system')),
  actor_id TEXT CHECK (actor_id IS NULL OR length(actor_id) <= 240),
  device_id TEXT,
  outcome TEXT NOT NULL DEFAULT 'recorded'
    CHECK (outcome IN ('recorded', 'allowed', 'denied', 'failed')),
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json) AND length(metadata_json) <= 32768),
  evidence_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(evidence_json) AND length(evidence_json) <= 262144),
  created_at TEXT NOT NULL,
  FOREIGN KEY (relationship_id, owner_user_id) REFERENCES peer_relationships(id, owner_user_id),
  FOREIGN KEY (device_id, owner_user_id) REFERENCES forge_devices(id, owner_user_id)
);

CREATE INDEX IF NOT EXISTS idx_peer_audit_events_owner_time
  ON peer_audit_events (owner_user_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_peer_audit_events_relationship
  ON peer_audit_events (owner_user_id, relationship_id, created_at DESC);

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

CREATE TABLE IF NOT EXISTS peer_mls_group_states (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  group_id TEXT NOT NULL CHECK (length(group_id) BETWEEN 16 AND 500),
  epoch INTEGER NOT NULL CHECK (epoch >= 0),
  checkpoint_counter INTEGER NOT NULL CHECK (checkpoint_counter >= 0),
  cipher_suite TEXT NOT NULL CHECK (length(cipher_suite) BETWEEN 1 AND 160),
  protocol_version TEXT NOT NULL DEFAULT 'forge-peer/1' CHECK (length(protocol_version) <= 80),
  encrypted_state BLOB NOT NULL
    CHECK (typeof(encrypted_state) = 'blob' AND length(encrypted_state) BETWEEN 32 AND 10485760),
  encryption_nonce BLOB NOT NULL
    CHECK (typeof(encryption_nonce) = 'blob' AND length(encryption_nonce) BETWEEN 12 AND 64),
  state_hash TEXT NOT NULL CHECK (length(state_hash) = 64),
  secret_store_checkpoint_id TEXT NOT NULL CHECK (length(secret_store_checkpoint_id) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'resync_required', 'reinitialization_required', 'revoked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (relationship_id, owner_user_id) REFERENCES peer_relationships(id, owner_user_id),
  UNIQUE (owner_user_id, relationship_id, group_id),
  UNIQUE (id, owner_user_id)
);

CREATE INDEX IF NOT EXISTS idx_peer_mls_group_states_relationship
  ON peer_mls_group_states (owner_user_id, relationship_id, status, epoch DESC);

CREATE TABLE IF NOT EXISTS peer_mls_state_checkpoints (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  group_state_id TEXT NOT NULL,
  epoch INTEGER NOT NULL CHECK (epoch >= 0),
  checkpoint_counter INTEGER NOT NULL CHECK (checkpoint_counter >= 0),
  state_hash TEXT NOT NULL CHECK (length(state_hash) = 64),
  secret_store_checkpoint_id TEXT NOT NULL CHECK (length(secret_store_checkpoint_id) BETWEEN 1 AND 500),
  created_at TEXT NOT NULL,
  FOREIGN KEY (group_state_id, owner_user_id)
    REFERENCES peer_mls_group_states(id, owner_user_id) ON DELETE CASCADE,
  UNIQUE (group_state_id, epoch, checkpoint_counter)
);

CREATE INDEX IF NOT EXISTS idx_peer_mls_state_checkpoints_group
  ON peer_mls_state_checkpoints (owner_user_id, group_state_id, epoch DESC, checkpoint_counter DESC);
