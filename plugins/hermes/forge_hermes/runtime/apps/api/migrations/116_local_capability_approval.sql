-- Persist explicit, installation-bound owner approval for capabilities that
-- intentionally retain unrestricted same-machine behavior.

CREATE TABLE IF NOT EXISTS security_local_capability_approvals (
  owner_id TEXT NOT NULL REFERENCES security_owners(owner_id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL REFERENCES security_installation(installation_id) ON DELETE CASCADE,
  capability_id TEXT NOT NULL,
  warning_version INTEGER NOT NULL CHECK (warning_version > 0),
  warning_sha256 TEXT NOT NULL CHECK (length(warning_sha256) = 64),
  approved_at TEXT NOT NULL,
  approved_by_subject_id TEXT NOT NULL,
  revoked_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, installation_id, capability_id)
);
