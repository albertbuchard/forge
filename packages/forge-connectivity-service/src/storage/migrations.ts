export interface StorageMigration {
  name: string;
  sql: string;
  version: number;
}

export const STORAGE_MIGRATIONS: readonly StorageMigration[] = [
  {
    version: 1,
    name: "initial_content_blind_mailbox",
    sql: `
      CREATE TABLE presence (
        channel_hash TEXT PRIMARY KEY,
        ciphertext BLOB NOT NULL,
        ciphertext_bytes INTEGER NOT NULL CHECK (ciphertext_bytes >= 32),
        content_digest TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE envelopes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_hash TEXT NOT NULL,
        message_id TEXT NOT NULL,
        ciphertext BLOB,
        ciphertext_bytes INTEGER NOT NULL CHECK (ciphertext_bytes >= 0),
        content_digest TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        retain_until INTEGER NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'acked', 'expired')),
        created_at INTEGER NOT NULL,
        UNIQUE (channel_hash, message_id)
      ) STRICT;

      CREATE TABLE key_packages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_hash TEXT NOT NULL,
        package_id TEXT NOT NULL,
        ciphertext BLOB NOT NULL,
        ciphertext_bytes INTEGER NOT NULL CHECK (ciphertext_bytes >= 32),
        content_digest TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (channel_hash, package_id)
      ) STRICT;

      CREATE TABLE auth_nonces (
        channel_hash TEXT NOT NULL,
        nonce_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (channel_hash, nonce_hash)
      ) WITHOUT ROWID, STRICT;

      CREATE TABLE idempotency_records (
        channel_hash TEXT NOT NULL,
        scope TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_digest TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        response_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (channel_hash, scope, idempotency_key)
      ) WITHOUT ROWID, STRICT;

      CREATE TABLE channel_usage (
        channel_hash TEXT PRIMARY KEY,
        envelope_count INTEGER NOT NULL DEFAULT 0 CHECK (envelope_count >= 0),
        envelope_bytes INTEGER NOT NULL DEFAULT 0 CHECK (envelope_bytes >= 0),
        retained_envelope_count INTEGER NOT NULL DEFAULT 0 CHECK (retained_envelope_count >= 0),
        idempotency_count INTEGER NOT NULL DEFAULT 0 CHECK (idempotency_count >= 0),
        key_package_count INTEGER NOT NULL DEFAULT 0 CHECK (key_package_count >= 0),
        key_package_bytes INTEGER NOT NULL DEFAULT 0 CHECK (key_package_bytes >= 0),
        presence_bytes INTEGER NOT NULL DEFAULT 0 CHECK (presence_bytes >= 0),
        updated_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE service_usage (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        total_bytes INTEGER NOT NULL DEFAULT 0 CHECK (total_bytes >= 0),
        retained_envelope_count INTEGER NOT NULL DEFAULT 0 CHECK (retained_envelope_count >= 0),
        idempotency_count INTEGER NOT NULL DEFAULT 0 CHECK (idempotency_count >= 0)
      ) STRICT;
      INSERT INTO service_usage (singleton, total_bytes) VALUES (1, 0);

      CREATE INDEX idx_presence_expiry ON presence (expires_at);
      CREATE INDEX idx_envelopes_expiry ON envelopes (state, expires_at, id);
      CREATE INDEX idx_envelopes_retention ON envelopes (state, retain_until, id);
      CREATE INDEX idx_key_packages_channel_page ON key_packages (channel_hash, id);
      CREATE INDEX idx_key_packages_expiry ON key_packages (expires_at, id);
      CREATE INDEX idx_auth_nonces_expiry ON auth_nonces (expires_at);
      CREATE INDEX idx_idempotency_expiry ON idempotency_records (expires_at);

      CREATE TRIGGER presence_usage_insert AFTER INSERT ON presence BEGIN
        INSERT INTO channel_usage (
          channel_hash, envelope_count, envelope_bytes, key_package_count, key_package_bytes, presence_bytes, updated_at
        ) VALUES (NEW.channel_hash, 0, 0, 0, 0, NEW.ciphertext_bytes, NEW.updated_at)
        ON CONFLICT(channel_hash) DO UPDATE SET
          presence_bytes = presence_bytes + NEW.ciphertext_bytes,
          updated_at = NEW.updated_at;
        UPDATE service_usage SET total_bytes = total_bytes + NEW.ciphertext_bytes WHERE singleton = 1;
      END;

      CREATE TRIGGER presence_usage_update AFTER UPDATE OF ciphertext_bytes ON presence BEGIN
        UPDATE channel_usage SET
          presence_bytes = presence_bytes + NEW.ciphertext_bytes - OLD.ciphertext_bytes,
          updated_at = NEW.updated_at
        WHERE channel_hash = NEW.channel_hash;
        UPDATE service_usage SET total_bytes = total_bytes + NEW.ciphertext_bytes - OLD.ciphertext_bytes WHERE singleton = 1;
      END;

      CREATE TRIGGER presence_usage_delete AFTER DELETE ON presence BEGIN
        UPDATE channel_usage SET
          presence_bytes = presence_bytes - OLD.ciphertext_bytes,
          updated_at = OLD.updated_at
        WHERE channel_hash = OLD.channel_hash;
        UPDATE service_usage SET total_bytes = total_bytes - OLD.ciphertext_bytes WHERE singleton = 1;
      END;

      CREATE TRIGGER envelope_usage_insert AFTER INSERT ON envelopes WHEN NEW.state = 'pending' BEGIN
        INSERT INTO channel_usage (
          channel_hash, envelope_count, envelope_bytes, retained_envelope_count,
          key_package_count, key_package_bytes, presence_bytes, updated_at
        ) VALUES (NEW.channel_hash, 1, NEW.ciphertext_bytes, 1, 0, 0, 0, NEW.created_at)
        ON CONFLICT(channel_hash) DO UPDATE SET
          envelope_count = envelope_count + 1,
          envelope_bytes = envelope_bytes + NEW.ciphertext_bytes,
          retained_envelope_count = retained_envelope_count + 1,
          updated_at = NEW.created_at;
        UPDATE service_usage SET
          total_bytes = total_bytes + NEW.ciphertext_bytes,
          retained_envelope_count = retained_envelope_count + 1
        WHERE singleton = 1;
      END;

      CREATE TRIGGER envelope_usage_update AFTER UPDATE OF state, ciphertext_bytes ON envelopes BEGIN
        UPDATE channel_usage SET
          envelope_count = envelope_count
            + CASE WHEN NEW.state = 'pending' THEN 1 ELSE 0 END
            - CASE WHEN OLD.state = 'pending' THEN 1 ELSE 0 END,
          envelope_bytes = envelope_bytes
            + CASE WHEN NEW.state = 'pending' THEN NEW.ciphertext_bytes ELSE 0 END
            - CASE WHEN OLD.state = 'pending' THEN OLD.ciphertext_bytes ELSE 0 END,
          updated_at = NEW.created_at
        WHERE channel_hash = NEW.channel_hash;
        UPDATE service_usage SET total_bytes = total_bytes
          + CASE WHEN NEW.state = 'pending' THEN NEW.ciphertext_bytes ELSE 0 END
          - CASE WHEN OLD.state = 'pending' THEN OLD.ciphertext_bytes ELSE 0 END
        WHERE singleton = 1;
      END;

      CREATE TRIGGER envelope_usage_delete AFTER DELETE ON envelopes BEGIN
        UPDATE channel_usage SET
          envelope_count = envelope_count - CASE WHEN OLD.state = 'pending' THEN 1 ELSE 0 END,
          envelope_bytes = envelope_bytes - CASE WHEN OLD.state = 'pending' THEN OLD.ciphertext_bytes ELSE 0 END,
          retained_envelope_count = retained_envelope_count - 1,
          updated_at = OLD.created_at
        WHERE channel_hash = OLD.channel_hash;
        UPDATE service_usage SET
          total_bytes = total_bytes - CASE WHEN OLD.state = 'pending' THEN OLD.ciphertext_bytes ELSE 0 END,
          retained_envelope_count = retained_envelope_count - 1
        WHERE singleton = 1;
      END;

      CREATE TRIGGER idempotency_usage_insert AFTER INSERT ON idempotency_records BEGIN
        INSERT INTO channel_usage (channel_hash, idempotency_count, updated_at)
        VALUES (NEW.channel_hash, 1, NEW.created_at)
        ON CONFLICT(channel_hash) DO UPDATE SET
          idempotency_count = idempotency_count + 1,
          updated_at = NEW.created_at;
        UPDATE service_usage SET idempotency_count = idempotency_count + 1 WHERE singleton = 1;
      END;

      CREATE TRIGGER idempotency_usage_delete AFTER DELETE ON idempotency_records BEGIN
        UPDATE channel_usage SET
          idempotency_count = idempotency_count - 1,
          updated_at = OLD.created_at
        WHERE channel_hash = OLD.channel_hash;
        UPDATE service_usage SET idempotency_count = idempotency_count - 1 WHERE singleton = 1;
      END;

      CREATE TRIGGER key_package_usage_insert AFTER INSERT ON key_packages BEGIN
        INSERT INTO channel_usage (
          channel_hash, envelope_count, envelope_bytes, key_package_count, key_package_bytes, presence_bytes, updated_at
        ) VALUES (NEW.channel_hash, 0, 0, 1, NEW.ciphertext_bytes, 0, NEW.created_at)
        ON CONFLICT(channel_hash) DO UPDATE SET
          key_package_count = key_package_count + 1,
          key_package_bytes = key_package_bytes + NEW.ciphertext_bytes,
          updated_at = NEW.created_at;
        UPDATE service_usage SET total_bytes = total_bytes + NEW.ciphertext_bytes WHERE singleton = 1;
      END;

      CREATE TRIGGER key_package_usage_delete AFTER DELETE ON key_packages BEGIN
        UPDATE channel_usage SET
          key_package_count = key_package_count - 1,
          key_package_bytes = key_package_bytes - OLD.ciphertext_bytes,
          updated_at = OLD.created_at
        WHERE channel_hash = OLD.channel_hash;
        UPDATE service_usage SET total_bytes = total_bytes - OLD.ciphertext_bytes WHERE singleton = 1;
      END;
    `
  },
  {
    version: 2,
    name: "indexed_received_order",
    sql: `
      ALTER TABLE envelopes ADD COLUMN received_at INTEGER NOT NULL DEFAULT 0;
      UPDATE envelopes SET received_at = created_at WHERE received_at = 0;
      CREATE INDEX idx_envelopes_channel_pending_page
        ON envelopes (channel_hash, id)
        WHERE state = 'pending';
    `
  },
  {
    version: 3,
    name: "global_object_and_nonce_cardinality",
    sql: `
      ALTER TABLE channel_usage
        ADD COLUMN nonce_count INTEGER NOT NULL DEFAULT 0 CHECK (nonce_count >= 0);
      ALTER TABLE service_usage
        ADD COLUMN presence_count INTEGER NOT NULL DEFAULT 0 CHECK (presence_count >= 0);
      ALTER TABLE service_usage
        ADD COLUMN key_package_count INTEGER NOT NULL DEFAULT 0 CHECK (key_package_count >= 0);
      ALTER TABLE service_usage
        ADD COLUMN nonce_count INTEGER NOT NULL DEFAULT 0 CHECK (nonce_count >= 0);

      CREATE TRIGGER presence_global_count_insert AFTER INSERT ON presence BEGIN
        UPDATE service_usage SET presence_count = presence_count + 1 WHERE singleton = 1;
      END;

      CREATE TRIGGER presence_global_count_delete AFTER DELETE ON presence BEGIN
        UPDATE service_usage SET presence_count = presence_count - 1 WHERE singleton = 1;
      END;

      CREATE TRIGGER key_package_global_count_insert AFTER INSERT ON key_packages BEGIN
        UPDATE service_usage SET key_package_count = key_package_count + 1 WHERE singleton = 1;
      END;

      CREATE TRIGGER key_package_global_count_delete AFTER DELETE ON key_packages BEGIN
        UPDATE service_usage SET key_package_count = key_package_count - 1 WHERE singleton = 1;
      END;

      CREATE TRIGGER nonce_usage_insert AFTER INSERT ON auth_nonces BEGIN
        INSERT INTO channel_usage (channel_hash, nonce_count, updated_at)
        VALUES (NEW.channel_hash, 1, NEW.expires_at)
        ON CONFLICT(channel_hash) DO UPDATE SET
          nonce_count = nonce_count + 1,
          updated_at = NEW.expires_at;
        UPDATE service_usage SET nonce_count = nonce_count + 1 WHERE singleton = 1;
      END;

      CREATE TRIGGER nonce_usage_delete AFTER DELETE ON auth_nonces BEGIN
        UPDATE channel_usage SET
          nonce_count = nonce_count - 1,
          updated_at = OLD.expires_at
        WHERE channel_hash = OLD.channel_hash;
        UPDATE service_usage SET nonce_count = nonce_count - 1 WHERE singleton = 1;
      END;
    `
  }
] as const;

export const CURRENT_STORAGE_SCHEMA_VERSION =
  STORAGE_MIGRATIONS.at(-1)?.version ?? 0;
