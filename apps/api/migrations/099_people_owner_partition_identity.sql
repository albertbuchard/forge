-- Owner-partition Forge peer identities without changing public principal or
-- device IDs. The migration runner already owns the surrounding transaction;
-- defer FK checks only for the parent-table replacement and prove the rebuilt
-- graph is valid before restoring immediate enforcement.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE forge_principals_099_owner_partition (
  id TEXT NOT NULL,
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
  PRIMARY KEY (owner_user_id, id),
  FOREIGN KEY (local_person_id, owner_user_id) REFERENCES people(id, user_id),
  UNIQUE (owner_user_id, public_principal_id),
  UNIQUE (id, owner_user_id),
  CHECK (principal_kind != 'local' OR root_key_secret_id IS NOT NULL)
);

CREATE TABLE forge_devices_099_owner_partition (
  id TEXT NOT NULL,
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
  key_agreement_public_key TEXT,
  certificate_serial TEXT,
  certificate_hash TEXT,
  PRIMARY KEY (owner_user_id, id),
  FOREIGN KEY (principal_id, owner_user_id)
    REFERENCES forge_principals_099_owner_partition(id, owner_user_id) ON DELETE CASCADE,
  UNIQUE (id, owner_user_id)
);

INSERT INTO forge_principals_099_owner_partition (
  id, owner_user_id, principal_kind, public_principal_id, root_public_key,
  root_key_secret_id, display_label, local_person_id, trust_state,
  minimum_protocol_version, maximum_protocol_version, first_verified_at,
  last_verified_at, revoked_at, metadata_json, created_at, updated_at
)
SELECT
  id, owner_user_id, principal_kind, public_principal_id, root_public_key,
  root_key_secret_id, display_label, local_person_id, trust_state,
  minimum_protocol_version, maximum_protocol_version, first_verified_at,
  last_verified_at, revoked_at, metadata_json, created_at, updated_at
FROM forge_principals;

INSERT INTO forge_devices_099_owner_partition (
  id, owner_user_id, principal_id, certified_public_key,
  private_key_secret_id, certificate, label, device_type, status,
  transport_endpoints_json, capabilities_json, added_at, last_seen_at,
  revoked_at, created_at, updated_at, key_agreement_public_key,
  certificate_serial, certificate_hash
)
SELECT
  id, owner_user_id, principal_id, certified_public_key,
  private_key_secret_id, certificate, label, device_type, status,
  transport_endpoints_json, capabilities_json, added_at, last_seen_at,
  revoked_at, created_at, updated_at, key_agreement_public_key,
  certificate_serial, certificate_hash
FROM forge_devices;

CREATE TEMP TABLE forge_owner_partition_content_guard (
  difference_count INTEGER NOT NULL CHECK (difference_count = 0)
);

INSERT INTO forge_owner_partition_content_guard (difference_count)
SELECT
  (SELECT COUNT(*) FROM forge_principals)
  - (SELECT COUNT(*) FROM forge_principals_099_owner_partition);

INSERT INTO forge_owner_partition_content_guard (difference_count)
SELECT
  (SELECT COUNT(*) FROM forge_devices)
  - (SELECT COUNT(*) FROM forge_devices_099_owner_partition);

INSERT INTO forge_owner_partition_content_guard (difference_count)
SELECT COUNT(*)
FROM (
  SELECT * FROM forge_principals
  EXCEPT
  SELECT * FROM forge_principals_099_owner_partition
);

INSERT INTO forge_owner_partition_content_guard (difference_count)
SELECT COUNT(*)
FROM (
  SELECT * FROM forge_principals_099_owner_partition
  EXCEPT
  SELECT * FROM forge_principals
);

INSERT INTO forge_owner_partition_content_guard (difference_count)
SELECT COUNT(*)
FROM (
  SELECT * FROM forge_devices
  EXCEPT
  SELECT * FROM forge_devices_099_owner_partition
);

INSERT INTO forge_owner_partition_content_guard (difference_count)
SELECT COUNT(*)
FROM (
  SELECT * FROM forge_devices_099_owner_partition
  EXCEPT
  SELECT * FROM forge_devices
);

DROP TRIGGER trg_peer_relationship_devices_role_insert;
DROP TRIGGER trg_peer_relationship_devices_role_update;

DROP TABLE forge_devices;
DROP TABLE forge_principals;

ALTER TABLE forge_principals_099_owner_partition RENAME TO forge_principals;
ALTER TABLE forge_devices_099_owner_partition RENAME TO forge_devices;

CREATE INDEX idx_forge_principals_owner_state
  ON forge_principals (owner_user_id, trust_state, updated_at DESC);

CREATE UNIQUE INDEX idx_forge_principals_owner_root_key
  ON forge_principals (owner_user_id, root_public_key);

CREATE INDEX idx_forge_devices_principal_state
  ON forge_devices (owner_user_id, principal_id, status, updated_at DESC);

CREATE UNIQUE INDEX idx_forge_devices_owner_signing_key
  ON forge_devices (owner_user_id, certified_public_key);

CREATE UNIQUE INDEX idx_forge_devices_owner_agreement_key
  ON forge_devices (owner_user_id, key_agreement_public_key)
  WHERE key_agreement_public_key IS NOT NULL;

CREATE UNIQUE INDEX idx_forge_devices_owner_certificate
  ON forge_devices (owner_user_id, certificate);

CREATE UNIQUE INDEX idx_forge_devices_owner_certificate_hash
  ON forge_devices (owner_user_id, certificate_hash)
  WHERE certificate_hash IS NOT NULL;

CREATE UNIQUE INDEX idx_forge_devices_owner_private_key_handle
  ON forge_devices (owner_user_id, private_key_secret_id)
  WHERE private_key_secret_id IS NOT NULL;

CREATE TRIGGER trg_forge_principals_peer_identity_insert
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

CREATE TRIGGER trg_forge_principals_identity_immutable
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

CREATE TRIGGER trg_forge_principals_lifecycle_insert
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

CREATE TRIGGER trg_forge_principals_lifecycle_update
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

CREATE TRIGGER trg_forge_devices_peer_identity_insert
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

CREATE TRIGGER trg_forge_devices_identity_immutable
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

CREATE TRIGGER trg_forge_devices_lifecycle_insert
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

CREATE TRIGGER trg_forge_devices_lifecycle_update
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

CREATE TRIGGER trg_peer_relationship_devices_role_insert
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

CREATE TRIGGER trg_peer_relationship_devices_role_update
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

DROP TABLE forge_owner_partition_content_guard;

CREATE TEMP TABLE forge_owner_partition_fk_guard (
  violation_count INTEGER NOT NULL CHECK (violation_count = 0)
);

INSERT INTO forge_owner_partition_fk_guard (violation_count)
SELECT COUNT(*) FROM pragma_foreign_key_check;

DROP TABLE forge_owner_partition_fk_guard;

PRAGMA defer_foreign_keys = OFF;
