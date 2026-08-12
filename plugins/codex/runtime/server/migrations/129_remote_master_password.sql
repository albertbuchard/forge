-- Optional owner-created master password for sender-bound remote browser pairing.
-- No row exists by default. Only an Argon2id verifier is persisted.

CREATE TABLE IF NOT EXISTS security_owner_master_passwords (
  owner_id TEXT PRIMARY KEY REFERENCES security_owners(owner_id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version = 1),
  algorithm TEXT NOT NULL CHECK (algorithm = 'argon2id13'),
  salt_base64 TEXT NOT NULL,
  verifier_base64 TEXT NOT NULL,
  memlimit INTEGER NOT NULL CHECK (memlimit >= 19922944),
  opslimit INTEGER NOT NULL CHECK (opslimit >= 2),
  parallelism INTEGER NOT NULL CHECK (parallelism = 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
