-- Persist the default-deny gateway's owner, client, pairing, browser-session,
-- renewable-credential, replay, and local recovery authority.

CREATE TABLE IF NOT EXISTS security_owners (
  owner_id TEXT PRIMARY KEY,
  security_epoch INTEGER NOT NULL DEFAULT 1 CHECK (security_epoch >= 1),
  created_at TEXT NOT NULL,
  recovered_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS security_installation (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  installation_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS security_clients (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES security_owners(owner_id),
  subject_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  key_thumbprint TEXT NOT NULL,
  audience TEXT NOT NULL,
  profile TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  client_epoch INTEGER NOT NULL DEFAULT 1 CHECK (client_epoch >= 1),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  revocation_reason TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS security_access_revocations (
  token_id TEXT PRIMARY KEY,
  revoked_at TEXT NOT NULL,
  reason TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS security_compatibility_authorizations (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES security_clients(id),
  owner_id TEXT NOT NULL REFERENCES security_owners(owner_id),
  audience TEXT NOT NULL,
  profile TEXT NOT NULL CHECK (profile = 'viewer'),
  scopes_json TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode = 'compatibility_bearer'),
  reason TEXT NOT NULL,
  authorized_by TEXT NOT NULL,
  authorized_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revocation_reason TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS security_pairing_requests (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES security_owners(owner_id),
  owner_epoch INTEGER NOT NULL,
  installation_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_key_thumbprint TEXT NOT NULL,
  audience TEXT NOT NULL,
  requested_scopes_json TEXT NOT NULL,
  requested_profile TEXT NOT NULL,
  device_digest TEXT NOT NULL UNIQUE,
  user_code_digest TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'approved', 'denied', 'cancelled', 'consumed', 'expired')
  ),
  poll_interval_seconds INTEGER NOT NULL CHECK (poll_interval_seconds >= 5),
  next_poll_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  approval_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_security_pairing_pending_install
  ON security_pairing_requests (installation_id, status, expires_at);

CREATE TABLE IF NOT EXISTS security_pairing_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  failures INTEGER NOT NULL CHECK (failures >= 0),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS security_browser_sessions (
  id TEXT PRIMARY KEY,
  session_digest TEXT NOT NULL UNIQUE,
  csrf_digest TEXT NOT NULL,
  principal_json TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES security_owners(owner_id),
  owner_epoch INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  idle_expires_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS security_refresh_families (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES security_clients(id),
  owner_id TEXT NOT NULL REFERENCES security_owners(owner_id),
  installation_id TEXT NOT NULL,
  audience TEXT NOT NULL,
  profile TEXT NOT NULL,
  key_thumbprint TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  owner_epoch INTEGER NOT NULL CHECK (owner_epoch >= 1),
  client_epoch INTEGER NOT NULL CHECK (client_epoch >= 1),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  inactive_expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revocation_reason TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS security_refresh_tokens (
  digest TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES security_refresh_families(id) ON DELETE CASCADE,
  issued_at TEXT NOT NULL,
  used_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS security_dpop_replays (
  key_thumbprint TEXT NOT NULL,
  token_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (key_thumbprint, token_id)
) STRICT;

CREATE TABLE IF NOT EXISTS security_local_transactions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES security_owners(owner_id),
  install_id TEXT NOT NULL,
  browser_origin TEXT NOT NULL,
  browser_nonce_digest TEXT NOT NULL,
  owner_epoch INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  assertion_issued_at TEXT,
  exchanged_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS security_owner_authenticators (
  credential_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES security_owners(owner_id),
  label TEXT NOT NULL,
  origin TEXT NOT NULL,
  relying_party_id TEXT NOT NULL,
  enrolled_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS security_mobile_request_nonces (
  pairing_session_id TEXT NOT NULL
    REFERENCES companion_pairing_sessions(id) ON DELETE CASCADE,
  nonce_digest TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (pairing_session_id, nonce_digest)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_security_mobile_nonce_expiry
  ON security_mobile_request_nonces (pairing_session_id, expires_at);

CREATE TABLE IF NOT EXISTS security_mobile_pairing_credentials (
  pairing_session_id TEXT PRIMARY KEY
    REFERENCES companion_pairing_sessions(id) ON DELETE CASCADE,
  token_digest TEXT NOT NULL UNIQUE,
  token_ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL,
  rotated_at TEXT,
  revoked_at TEXT
) STRICT;
