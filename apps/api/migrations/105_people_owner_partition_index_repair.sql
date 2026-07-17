-- The first published 104 repair replayed migration 088's obsolete global
-- identity indexes after migration 099 had replaced them with owner partitions.
-- Remove only those stale indexes and ensure the canonical owner-scoped set.

DROP INDEX IF EXISTS idx_forge_principals_public_id_global;
DROP INDEX IF EXISTS idx_forge_principals_root_key_global;
DROP INDEX IF EXISTS idx_forge_devices_signing_key_global;
DROP INDEX IF EXISTS idx_forge_devices_agreement_key_global;
DROP INDEX IF EXISTS idx_forge_devices_certificate_global;
DROP INDEX IF EXISTS idx_forge_devices_certificate_hash_global;
DROP INDEX IF EXISTS idx_forge_devices_private_key_handle_global;

CREATE UNIQUE INDEX IF NOT EXISTS idx_forge_principals_owner_root_key
  ON forge_principals (owner_user_id, root_public_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_forge_devices_owner_signing_key
  ON forge_devices (owner_user_id, certified_public_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_forge_devices_owner_agreement_key
  ON forge_devices (owner_user_id, key_agreement_public_key)
  WHERE key_agreement_public_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_forge_devices_owner_certificate
  ON forge_devices (owner_user_id, certificate);

CREATE UNIQUE INDEX IF NOT EXISTS idx_forge_devices_owner_certificate_hash
  ON forge_devices (owner_user_id, certificate_hash)
  WHERE certificate_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_forge_devices_owner_private_key_handle
  ON forge_devices (owner_user_id, private_key_secret_id)
  WHERE private_key_secret_id IS NOT NULL;
