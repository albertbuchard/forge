-- Bind every legacy bearer token to the one Forge installation owner and a
-- bounded migration window. The token secret remains only in agent_tokens as
-- its existing one-way hash; this table contains authorization metadata only.

CREATE TABLE IF NOT EXISTS security_legacy_token_migrations (
  token_id TEXT PRIMARY KEY REFERENCES agent_tokens(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES security_owners(owner_id),
  installation_id TEXT NOT NULL,
  audience TEXT NOT NULL,
  profile TEXT NOT NULL CHECK (
    profile IN ('viewer', 'trusted_personal_assistant', 'executor', 'custom')
  ),
  scopes_json TEXT NOT NULL,
  migrated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  CHECK (expires_at > migrated_at)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_security_legacy_token_expiry
  ON security_legacy_token_migrations(expires_at, revoked_at);

-- Forge currently supports one immutable installation owner. Domain-level
-- user/person records remain supported; this trigger only prevents a second
-- authentication authority from being inserted into security_owners.
CREATE TRIGGER IF NOT EXISTS trg_security_single_owner_insert
BEFORE INSERT ON security_owners
WHEN EXISTS (
  SELECT 1
  FROM security_owners
  WHERE owner_id <> NEW.owner_id
)
BEGIN
  SELECT RAISE(ABORT, 'Forge single-owner mode rejects a second security owner');
END;
