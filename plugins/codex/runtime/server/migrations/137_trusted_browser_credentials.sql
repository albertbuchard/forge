-- Restore one exact paired-browser grant through a user-verified WebAuthn
-- credential. Challenges are single-use and store only keyed challenge hashes.

ALTER TABLE security_clients
  ADD COLUMN selected_user_ids_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE security_trusted_browser_credentials (
  id TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL REFERENCES security_owners(owner_id),
  installation_id TEXT NOT NULL,
  data_root_binding TEXT NOT NULL CHECK (length(data_root_binding) = 64),
  client_id TEXT NOT NULL,
  client_subject_id TEXT NOT NULL,
  client_key_thumbprint TEXT NOT NULL,
  client_type TEXT NOT NULL CHECK (client_type = 'browser'),
  audience TEXT NOT NULL,
  profile TEXT NOT NULL CHECK (
    profile IN ('viewer', 'trusted_personal_assistant', 'executor', 'custom')
  ),
  scopes_json TEXT NOT NULL,
  selected_user_ids_json TEXT NOT NULL DEFAULT '[]',
  owner_epoch INTEGER NOT NULL CHECK (owner_epoch >= 1),
  client_epoch INTEGER NOT NULL CHECK (client_epoch >= 1),
  authority_digest TEXT NOT NULL CHECK (length(authority_digest) = 64),
  rp_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  public_key_base64 TEXT NOT NULL,
  counter INTEGER NOT NULL CHECK (counter >= 0),
  transports_json TEXT NOT NULL,
  label TEXT NOT NULL,
  device_type TEXT NOT NULL CHECK (
    device_type IN ('singleDevice', 'multiDevice')
  ),
  backed_up INTEGER NOT NULL CHECK (backed_up IN (0, 1)),
  aaguid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  revocation_reason TEXT
) STRICT;

CREATE INDEX idx_security_trusted_browser_owner
  ON security_trusted_browser_credentials (owner_id, revoked_at, created_at);

CREATE INDEX idx_security_trusted_browser_client
  ON security_trusted_browser_credentials (client_id, revoked_at, created_at);

CREATE INDEX idx_security_trusted_browser_rp
  ON security_trusted_browser_credentials (rp_id, revoked_at, credential_id);

CREATE TRIGGER trg_security_trusted_browser_active_credential_cap
BEFORE INSERT ON security_trusted_browser_credentials
WHEN NEW.revoked_at IS NULL AND (
  SELECT COUNT(*)
  FROM security_trusted_browser_credentials
  WHERE revoked_at IS NULL
) >= 64
BEGIN
  SELECT RAISE(ABORT, 'trusted browser active credential limit reached');
END;

CREATE TRIGGER trg_security_trusted_browser_terminal_revocation
BEFORE UPDATE OF revoked_at ON security_trusted_browser_credentials
WHEN OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'trusted browser revocation is terminal');
END;

CREATE TABLE security_trusted_browser_challenges (
  id TEXT PRIMARY KEY,
  ceremony TEXT NOT NULL CHECK (ceremony IN ('register', 'authenticate')),
  challenge_keyed_hash TEXT NOT NULL CHECK (length(challenge_keyed_hash) = 64),
  expected_origin TEXT NOT NULL,
  rp_id TEXT NOT NULL,
  session_id TEXT,
  client_id TEXT,
  authority_digest TEXT,
  credential_set_version TEXT NOT NULL CHECK (
    length(credential_set_version) = 64
  ),
  credential_label TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  CHECK (
    (ceremony = 'register' AND session_id IS NOT NULL AND client_id IS NOT NULL
      AND authority_digest IS NOT NULL AND credential_label IS NOT NULL)
    OR
    (ceremony = 'authenticate' AND session_id IS NULL AND client_id IS NULL
      AND authority_digest IS NULL AND credential_label IS NULL)
  )
) STRICT;

CREATE INDEX idx_security_trusted_browser_challenge_expiry
  ON security_trusted_browser_challenges (expires_at, consumed_at);

-- Direct SQL must not be able to change an active client grant while leaving
-- already-issued browser/access sessions on the old client epoch.
CREATE TRIGGER trg_security_trusted_browser_client_epoch_guard
AFTER UPDATE OF owner_id, subject_id, installation_id, key_thumbprint,
  audience, profile, scopes_json, selected_user_ids_json, revoked_at
ON security_clients
WHEN OLD.client_epoch IS NEW.client_epoch
  AND (
    OLD.owner_id IS NOT NEW.owner_id
    OR OLD.subject_id IS NOT NEW.subject_id
    OR OLD.installation_id IS NOT NEW.installation_id
    OR OLD.key_thumbprint IS NOT NEW.key_thumbprint
    OR OLD.audience IS NOT NEW.audience
    OR OLD.profile IS NOT NEW.profile
    OR OLD.scopes_json IS NOT NEW.scopes_json
    OR OLD.selected_user_ids_json IS NOT NEW.selected_user_ids_json
    OR OLD.revoked_at IS NOT NEW.revoked_at
  )
BEGIN
  UPDATE security_clients
  SET client_epoch = client_epoch + 1
  WHERE id = NEW.id AND client_epoch = NEW.client_epoch;
END;

CREATE TRIGGER trg_security_trusted_browser_client_authority_change
AFTER UPDATE OF owner_id, subject_id, installation_id, key_thumbprint,
  audience, profile, scopes_json, selected_user_ids_json, client_epoch,
  revoked_at
ON security_clients
WHEN OLD.owner_id IS NOT NEW.owner_id
  OR OLD.subject_id IS NOT NEW.subject_id
  OR OLD.installation_id IS NOT NEW.installation_id
  OR OLD.key_thumbprint IS NOT NEW.key_thumbprint
  OR OLD.audience IS NOT NEW.audience
  OR OLD.profile IS NOT NEW.profile
  OR OLD.scopes_json IS NOT NEW.scopes_json
  OR OLD.selected_user_ids_json IS NOT NEW.selected_user_ids_json
  OR OLD.client_epoch IS NOT NEW.client_epoch
  OR OLD.revoked_at IS NOT NEW.revoked_at
BEGIN
  UPDATE security_trusted_browser_credentials
  SET revoked_at = COALESCE(
        revoked_at,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      ),
      revocation_reason = COALESCE(
        revocation_reason,
        'client_authority_changed'
      )
  WHERE client_id = NEW.id AND revoked_at IS NULL;
END;

CREATE TRIGGER trg_security_trusted_browser_client_delete
BEFORE DELETE ON security_clients
BEGIN
  UPDATE security_trusted_browser_credentials
  SET revoked_at = COALESCE(
        revoked_at,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      ),
      revocation_reason = COALESCE(revocation_reason, 'client_deleted')
  WHERE client_id = OLD.id AND revoked_at IS NULL;
END;

CREATE TRIGGER trg_security_trusted_browser_owner_epoch_change
AFTER UPDATE OF security_epoch ON security_owners
WHEN OLD.security_epoch IS NOT NEW.security_epoch
BEGIN
  UPDATE security_trusted_browser_credentials
  SET revoked_at = COALESCE(
        revoked_at,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      ),
      revocation_reason = COALESCE(revocation_reason, 'owner_epoch_changed')
  WHERE owner_id = NEW.owner_id AND revoked_at IS NULL;
END;

CREATE TRIGGER trg_security_trusted_browser_installation_change
AFTER UPDATE OF installation_id ON security_installation
WHEN OLD.installation_id IS NOT NEW.installation_id
BEGIN
  UPDATE security_trusted_browser_credentials
  SET revoked_at = COALESCE(
        revoked_at,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      ),
      revocation_reason = COALESCE(
        revocation_reason,
        'installation_identity_changed'
      )
  WHERE revoked_at IS NULL;
END;
