import { chmodSync, existsSync, lstatSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { ServiceError } from "../errors.js";
import {
  CURRENT_STORAGE_SCHEMA_VERSION,
  STORAGE_MIGRATIONS
} from "./migrations.js";
import type {
  CleanupResult,
  ConnectivityStore,
  EnvelopePage,
  IdempotentMutation,
  KeyPackagePage,
  PresenceRecord,
  StoredHttpResponse,
  UsageSnapshot
} from "./types.js";

interface EnvelopeRow {
  ciphertext: Uint8Array | null;
  content_digest: string;
  created_at: number;
  expires_at: number;
  id: number;
  message_id: string;
  state: "acked" | "expired" | "pending";
}

interface KeyPackageRow {
  ciphertext: Uint8Array;
  created_at: number;
  expires_at: number;
  id: number;
  package_id: string;
}

interface PresenceRow {
  ciphertext: Uint8Array;
  expires_at: number;
  updated_at: number;
}

interface UsageRow {
  envelope_bytes: number;
  envelope_count: number;
  idempotency_count: number;
  key_package_bytes: number;
  key_package_count: number;
  nonce_count: number;
  presence_bytes: number;
  retained_envelope_count: number;
}

interface IdempotencyRow {
  expires_at: number;
  request_digest: string;
  response_json: string;
  status_code: number;
}

const IDEMPOTENCY_RESPONSE_METADATA_KEYS = new Set([
  "accepted",
  "acknowledged",
  "alreadyFinalized",
  "deleted",
  "duplicate",
  "expiresAt",
  "messageId",
  "packageId",
  "state",
  "stored",
  "unknown"
]);

export interface SqliteConnectivityStoreOptions {
  busyTimeoutMs: number;
  databasePath: string;
}

export class SqliteConnectivityStore implements ConnectivityStore {
  readonly #database: DatabaseSync;
  #closed = false;
  #transactionDepth = 0;

  public readonly schemaVersion = CURRENT_STORAGE_SCHEMA_VERSION;

  public constructor(options: SqliteConnectivityStoreOptions) {
    validateStoreOptions(options);
    try {
      prepareDatabasePath(options.databasePath);
    } catch (error) {
      throw error instanceof ServiceError ? error : storageUnavailable();
    }
    try {
      this.#database = new DatabaseSync(options.databasePath);
    } catch {
      throw storageUnavailable();
    }
    try {
      if (options.databasePath !== ":memory:") {
        chmodSync(options.databasePath, 0o600);
      }
      this.#configure(
        options.busyTimeoutMs,
        options.databasePath === ":memory:"
      );
      this.#applyMigrations();
      this.#assertIntegrity();
      this.#rebuildUsage();
    } catch (error) {
      this.#database.close();
      this.#closed = true;
      throw error instanceof ServiceError ? error : storageUnavailable();
    }
  }

  public claimNonce(input: {
    channelHash: string;
    expiresAt: number;
    maxChannelRecords: number;
    maxGlobalRecords: number;
    nonceHash: string;
    nowMs: number;
  }): boolean {
    return this.#transaction(() => {
      this.#database
        .prepare(
          `DELETE FROM auth_nonces
           WHERE channel_hash = ? AND nonce_hash = ? AND expires_at < ?`
        )
        .run(input.channelHash, input.nonceHash, input.nowMs);
      const existing = this.#database
        .prepare(
          `SELECT 1 AS claimed FROM auth_nonces
           WHERE channel_hash = ? AND nonce_hash = ?`
        )
        .get(input.channelHash, input.nonceHash);
      if (existing !== undefined) {
        return false;
      }

      const usage = this.getUsage(input.channelHash);
      if (
        usage.channel.nonceCount + 1 > input.maxChannelRecords ||
        usage.globalNonceCount + 1 > input.maxGlobalRecords
      ) {
        throw quotaExceeded();
      }

      this.#database
        .prepare(
          `INSERT INTO auth_nonces (channel_hash, nonce_hash, expires_at)
           VALUES (?, ?, ?)`
        )
        .run(input.channelHash, input.nonceHash, input.expiresAt);
      return true;
    });
  }

  public runIdempotent<T extends Record<string, unknown>>(
    input: IdempotentMutation,
    operation: () => Omit<StoredHttpResponse<T>, "replayed">
  ): StoredHttpResponse<T> {
    return this.#transaction(() => {
      const existing = this.#database
        .prepare(
          `SELECT request_digest, status_code, response_json, expires_at
           FROM idempotency_records
           WHERE channel_hash = ? AND scope = ? AND idempotency_key = ?`
        )
        .get(input.channelHash, input.scope, input.key) as
        IdempotencyRow | undefined;

      if (existing !== undefined && existing.expires_at > input.nowMs) {
        if (existing.request_digest !== input.requestDigest) {
          throw new ServiceError(
            "IDEMPOTENCY_CONFLICT",
            409,
            "The idempotency key was already used for a different request."
          );
        }
        return {
          body: JSON.parse(existing.response_json) as T,
          replayed: true,
          statusCode: existing.status_code
        };
      }

      if (existing !== undefined) {
        this.#database
          .prepare(
            `DELETE FROM idempotency_records
             WHERE channel_hash = ? AND scope = ? AND idempotency_key = ?`
          )
          .run(input.channelHash, input.scope, input.key);
      }

      const usage = this.getUsage(input.channelHash);
      if (
        usage.channel.idempotencyCount + 1 > input.maxChannelRecords ||
        usage.globalIdempotencyCount + 1 > input.maxGlobalRecords
      ) {
        throw quotaExceeded();
      }

      const response = operation();
      assertMetadataOnlyResponse(response.body);
      this.#database
        .prepare(
          `INSERT INTO idempotency_records (
             channel_hash, scope, idempotency_key, request_digest,
             status_code, response_json, expires_at, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.channelHash,
          input.scope,
          input.key,
          input.requestDigest,
          response.statusCode,
          JSON.stringify(response.body),
          input.expiresAt,
          input.nowMs
        );
      return { ...response, replayed: false };
    });
  }

  public putPresence(input: {
    channelHash: string;
    ciphertext: Buffer;
    contentDigest: string;
    expiresAt: number;
    maxGlobalBytes: number;
    maxGlobalCount: number;
    nowMs: number;
  }): { created: boolean; expiresAt: number } {
    return this.#transaction(() => {
      const existing = this.#database
        .prepare("SELECT ciphertext_bytes FROM presence WHERE channel_hash = ?")
        .get(input.channelHash) as { ciphertext_bytes: number } | undefined;
      if (
        existing === undefined &&
        this.getUsage(input.channelHash).globalPresenceCount + 1 >
          input.maxGlobalCount
      ) {
        throw quotaExceeded();
      }
      this.#assertGlobalQuota(
        input.ciphertext.length - (existing?.ciphertext_bytes ?? 0),
        input.maxGlobalBytes
      );
      this.#database
        .prepare(
          `INSERT INTO presence (
             channel_hash, ciphertext, ciphertext_bytes, content_digest, expires_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(channel_hash) DO UPDATE SET
             ciphertext = excluded.ciphertext,
             ciphertext_bytes = excluded.ciphertext_bytes,
             content_digest = excluded.content_digest,
             expires_at = excluded.expires_at,
             updated_at = excluded.updated_at`
        )
        .run(
          input.channelHash,
          input.ciphertext,
          input.ciphertext.length,
          input.contentDigest,
          input.expiresAt,
          input.nowMs
        );
      return { created: existing === undefined, expiresAt: input.expiresAt };
    });
  }

  public getPresence(
    channelHash: string,
    nowMs: number
  ): PresenceRecord | undefined {
    return this.#transaction(() => {
      this.#database
        .prepare(
          "DELETE FROM presence WHERE channel_hash = ? AND expires_at <= ?"
        )
        .run(channelHash, nowMs);
      const row = this.#database
        .prepare(
          "SELECT ciphertext, expires_at, updated_at FROM presence WHERE channel_hash = ?"
        )
        .get(channelHash) as PresenceRow | undefined;
      if (row === undefined) {
        return undefined;
      }
      return {
        ciphertext: Buffer.from(row.ciphertext),
        expiresAt: row.expires_at,
        updatedAt: row.updated_at
      };
    });
  }

  public deletePresence(channelHash: string): boolean {
    return this.#transaction(
      () =>
        this.#database
          .prepare("DELETE FROM presence WHERE channel_hash = ?")
          .run(channelHash).changes === 1
    );
  }

  public putEnvelope(input: {
    channelHash: string;
    ciphertext: Buffer;
    contentDigest: string;
    expiresAt: number;
    maxChannelBytes: number;
    maxChannelCount: number;
    maxChannelRetainedCount: number;
    maxGlobalBytes: number;
    maxGlobalRetainedCount: number;
    messageId: string;
    nowMs: number;
    replayRetentionMs: number;
  }): {
    accepted: boolean;
    duplicate: boolean;
    expiresAt: number;
    state: "acked" | "expired" | "pending";
  } {
    return this.#transaction(() => {
      const existing = this.#database
        .prepare(
          `SELECT content_digest, expires_at, state
           FROM envelopes WHERE channel_hash = ? AND message_id = ?`
        )
        .get(input.channelHash, input.messageId) as
        | {
            content_digest: string;
            expires_at: number;
            state: "acked" | "expired" | "pending";
          }
        | undefined;
      if (existing !== undefined) {
        if (existing.content_digest !== input.contentDigest) {
          throw new ServiceError(
            "REPLAY_CONFLICT",
            409,
            "The message identifier is bound to different ciphertext."
          );
        }
        return {
          accepted: false,
          duplicate: true,
          expiresAt: existing.expires_at,
          state: existing.state
        };
      }

      const usage = this.getUsage(input.channelHash);
      if (usage.channel.envelopeCount + 1 > input.maxChannelCount) {
        throw quotaExceeded();
      }
      if (
        usage.channel.retainedEnvelopeCount + 1 >
          input.maxChannelRetainedCount ||
        usage.globalRetainedEnvelopeCount + 1 > input.maxGlobalRetainedCount
      ) {
        throw quotaExceeded();
      }
      if (
        usage.channel.envelopeBytes + input.ciphertext.length >
        input.maxChannelBytes
      ) {
        throw quotaExceeded();
      }
      this.#assertGlobalQuota(input.ciphertext.length, input.maxGlobalBytes);

      this.#database
        .prepare(
          `INSERT INTO envelopes (
             channel_hash, message_id, ciphertext, ciphertext_bytes, content_digest,
             expires_at, retain_until, state, created_at, received_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
        )
        .run(
          input.channelHash,
          input.messageId,
          input.ciphertext,
          input.ciphertext.length,
          input.contentDigest,
          input.expiresAt,
          input.expiresAt + input.replayRetentionMs,
          input.nowMs,
          input.nowMs
        );
      return {
        accepted: true,
        duplicate: false,
        expiresAt: input.expiresAt,
        state: "pending"
      };
    });
  }

  public listEnvelopes(
    channelHash: string,
    afterRowId: number,
    limit: number,
    nowMs: number
  ): EnvelopePage {
    this.#assertOpen();
    const rows = this.#database
      .prepare(
        `SELECT id, message_id, ciphertext, expires_at, created_at, content_digest, state
         FROM envelopes
         WHERE channel_hash = ? AND state = 'pending' AND expires_at > ? AND id > ?
         ORDER BY id ASC
         LIMIT ?`
      )
      .all(channelHash, nowMs, afterRowId, limit) as unknown as EnvelopeRow[];
    return {
      records: rows.map((row) => {
        if (row.ciphertext === null) {
          throw new ServiceError(
            "STORAGE_UNAVAILABLE",
            503,
            "Stored envelope state is inconsistent."
          );
        }
        return {
          ciphertext: Buffer.from(row.ciphertext),
          createdAt: row.created_at,
          expiresAt: row.expires_at,
          messageId: row.message_id,
          rowId: safeRowId(row.id)
        };
      })
    };
  }

  public ackEnvelopes(
    channelHash: string,
    messageIds: readonly string[],
    nowMs: number,
    replayRetentionMs: number
  ): { acknowledged: number; alreadyFinalized: number; unknown: number } {
    if (messageIds.length === 0) {
      return { acknowledged: 0, alreadyFinalized: 0, unknown: 0 };
    }
    return this.#transaction(() => {
      const placeholders = messageIds.map(() => "?").join(", ");
      const parameters: SQLInputValue[] = [channelHash, ...messageIds];
      const rows = this.#database
        .prepare(
          `SELECT message_id, state FROM envelopes
           WHERE channel_hash = ? AND message_id IN (${placeholders})`
        )
        .all(...parameters) as unknown as {
        message_id: string;
        state: "acked" | "expired" | "pending";
      }[];
      const pending = rows
        .filter((row) => row.state === "pending")
        .map((row) => row.message_id);
      if (pending.length > 0) {
        const pendingPlaceholders = pending.map(() => "?").join(", ");
        this.#database
          .prepare(
            `UPDATE envelopes SET
               state = 'acked', ciphertext = NULL, ciphertext_bytes = 0,
               retain_until = MAX(retain_until, ?)
             WHERE channel_hash = ? AND state = 'pending' AND message_id IN (${pendingPlaceholders})`
          )
          .run(nowMs + replayRetentionMs, channelHash, ...pending);
      }
      return {
        acknowledged: pending.length,
        alreadyFinalized: rows.length - pending.length,
        unknown: messageIds.length - rows.length
      };
    });
  }

  public putKeyPackage(input: {
    channelHash: string;
    ciphertext: Buffer;
    contentDigest: string;
    expiresAt: number;
    maxChannelBytes: number;
    maxChannelCount: number;
    maxGlobalBytes: number;
    maxGlobalCount: number;
    nowMs: number;
    packageId: string;
  }): { created: boolean; duplicate: boolean; expiresAt: number } {
    return this.#transaction(() => {
      const existing = this.#database
        .prepare(
          `SELECT content_digest, expires_at FROM key_packages
           WHERE channel_hash = ? AND package_id = ?`
        )
        .get(input.channelHash, input.packageId) as
        { content_digest: string; expires_at: number } | undefined;
      if (existing !== undefined) {
        if (existing.content_digest !== input.contentDigest) {
          throw new ServiceError(
            "REPLAY_CONFLICT",
            409,
            "The package identifier is bound to different ciphertext."
          );
        }
        return {
          created: false,
          duplicate: true,
          expiresAt: existing.expires_at
        };
      }

      const usage = this.getUsage(input.channelHash);
      if (usage.channel.keyPackageCount + 1 > input.maxChannelCount) {
        throw quotaExceeded();
      }
      if (
        usage.channel.keyPackageBytes + input.ciphertext.length >
        input.maxChannelBytes
      ) {
        throw quotaExceeded();
      }
      if (usage.globalKeyPackageCount + 1 > input.maxGlobalCount) {
        throw quotaExceeded();
      }
      this.#assertGlobalQuota(input.ciphertext.length, input.maxGlobalBytes);

      this.#database
        .prepare(
          `INSERT INTO key_packages (
             channel_hash, package_id, ciphertext, ciphertext_bytes,
             content_digest, expires_at, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.channelHash,
          input.packageId,
          input.ciphertext,
          input.ciphertext.length,
          input.contentDigest,
          input.expiresAt,
          input.nowMs
        );
      return { created: true, duplicate: false, expiresAt: input.expiresAt };
    });
  }

  public listKeyPackages(
    channelHash: string,
    afterRowId: number,
    limit: number,
    nowMs: number
  ): KeyPackagePage {
    this.#assertOpen();
    const rows = this.#database
      .prepare(
        `SELECT id, package_id, ciphertext, expires_at, created_at
         FROM key_packages
         WHERE channel_hash = ? AND expires_at > ? AND id > ?
         ORDER BY id ASC
         LIMIT ?`
      )
      .all(channelHash, nowMs, afterRowId, limit) as unknown as KeyPackageRow[];
    return {
      records: rows.map((row) => ({
        ciphertext: Buffer.from(row.ciphertext),
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        packageId: row.package_id,
        rowId: safeRowId(row.id)
      }))
    };
  }

  public cleanupExpired(nowMs: number, batchSize: number): CleanupResult {
    return this.#transaction(() => {
      const envelopesExpired = changeCount(
        this.#database
          .prepare(
            `UPDATE envelopes SET state = 'expired', ciphertext = NULL, ciphertext_bytes = 0
           WHERE id IN (
             SELECT id FROM envelopes
             WHERE state = 'pending' AND expires_at <= ?
             ORDER BY expires_at ASC LIMIT ?
           )`
          )
          .run(nowMs, batchSize).changes
      );
      const presenceExpired = changeCount(
        this.#database
          .prepare(
            `DELETE FROM presence WHERE channel_hash IN (
             SELECT channel_hash FROM presence WHERE expires_at <= ? ORDER BY expires_at ASC LIMIT ?
           )`
          )
          .run(nowMs, batchSize).changes
      );
      const keyPackagesExpired = changeCount(
        this.#database
          .prepare(
            `DELETE FROM key_packages WHERE id IN (
             SELECT id FROM key_packages WHERE expires_at <= ? ORDER BY expires_at ASC LIMIT ?
           )`
          )
          .run(nowMs, batchSize).changes
      );
      const tombstonesPurged = changeCount(
        this.#database
          .prepare(
            `DELETE FROM envelopes WHERE id IN (
             SELECT id FROM envelopes
             WHERE state IN ('acked', 'expired') AND retain_until <= ?
             ORDER BY retain_until ASC LIMIT ?
           )`
          )
          .run(nowMs, batchSize).changes
      );
      const noncesPurged = changeCount(
        this.#database
          .prepare(
            `DELETE FROM auth_nonces WHERE (channel_hash, nonce_hash) IN (
             SELECT channel_hash, nonce_hash FROM auth_nonces
             WHERE expires_at < ? ORDER BY expires_at ASC LIMIT ?
           )`
          )
          .run(nowMs, batchSize).changes
      );
      const idempotencyPurged = changeCount(
        this.#database
          .prepare(
            `DELETE FROM idempotency_records WHERE (channel_hash, scope, idempotency_key) IN (
             SELECT channel_hash, scope, idempotency_key FROM idempotency_records
             WHERE expires_at <= ? ORDER BY expires_at ASC LIMIT ?
           )`
          )
          .run(nowMs, batchSize).changes
      );
      this.#database
        .prepare(
          `DELETE FROM channel_usage
           WHERE envelope_count = 0
             AND retained_envelope_count = 0
             AND idempotency_count = 0
             AND key_package_count = 0
             AND nonce_count = 0
             AND presence_bytes = 0`
        )
        .run();
      return {
        envelopesExpired,
        idempotencyPurged,
        keyPackagesExpired,
        noncesPurged,
        presenceExpired,
        tombstonesPurged
      };
    });
  }

  public getUsage(channelHash: string): UsageSnapshot {
    this.#assertOpen();
    const channel = this.#database
      .prepare(
        `SELECT envelope_count, envelope_bytes, retained_envelope_count, idempotency_count,
                key_package_count, key_package_bytes, nonce_count, presence_bytes
         FROM channel_usage WHERE channel_hash = ?`
      )
      .get(channelHash) as UsageRow | undefined;
    const global = this.#database
      .prepare(
        `SELECT total_bytes, retained_envelope_count, idempotency_count,
                key_package_count, nonce_count, presence_count
         FROM service_usage WHERE singleton = 1`
      )
      .get() as {
      idempotency_count: number;
      key_package_count: number;
      nonce_count: number;
      presence_count: number;
      retained_envelope_count: number;
      total_bytes: number;
    };
    return {
      channel: {
        envelopeBytes: channel?.envelope_bytes ?? 0,
        envelopeCount: channel?.envelope_count ?? 0,
        idempotencyCount: channel?.idempotency_count ?? 0,
        keyPackageBytes: channel?.key_package_bytes ?? 0,
        keyPackageCount: channel?.key_package_count ?? 0,
        nonceCount: channel?.nonce_count ?? 0,
        presenceBytes: channel?.presence_bytes ?? 0,
        retainedEnvelopeCount: channel?.retained_envelope_count ?? 0
      },
      globalBytes: global.total_bytes,
      globalIdempotencyCount: global.idempotency_count,
      globalKeyPackageCount: global.key_package_count,
      globalNonceCount: global.nonce_count,
      globalPresenceCount: global.presence_count,
      globalRetainedEnvelopeCount: global.retained_envelope_count
    };
  }

  public healthCheck(): { ok: boolean; schemaVersion: number } {
    this.#assertOpen();
    const result = this.#database.prepare("SELECT 1 AS ready").get() as {
      ready: number;
    };
    const migration = this.#database
      .prepare(
        "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations"
      )
      .get() as { version: number };
    return {
      ok: result.ready === 1 && migration.version === this.schemaVersion,
      schemaVersion: migration.version
    };
  }

  public checkpoint(): void {
    this.#assertOpen();
    this.#database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }

  public close(): void {
    if (this.#closed) {
      return;
    }
    try {
      this.checkpoint();
    } finally {
      try {
        this.#database.close();
      } finally {
        this.#closed = true;
      }
    }
  }

  #configure(busyTimeoutMs: number, inMemory: boolean): void {
    this.#database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA trusted_schema = OFF;
      PRAGMA secure_delete = ON;
      PRAGMA synchronous = FULL;
      PRAGMA temp_store = MEMORY;
      PRAGMA busy_timeout = ${busyTimeoutMs};
    `);
    if (!inMemory) {
      this.#database.exec(
        "PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 1000;"
      );
    }
  }

  #applyMigrations(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at INTEGER NOT NULL
      ) STRICT;
    `);
    const appliedMigrations = this.#database
      .prepare(
        "SELECT version, name FROM schema_migrations ORDER BY version ASC"
      )
      .all() as unknown as { name: string; version: number }[];
    for (const [index, applied] of appliedMigrations.entries()) {
      const expected = STORAGE_MIGRATIONS[index];
      if (
        expected === undefined ||
        applied.version !== expected.version ||
        applied.name !== expected.name
      ) {
        throw new ServiceError(
          "STORAGE_UNAVAILABLE",
          503,
          "The database migration ledger is incompatible with this service binary."
        );
      }
    }
    const currentVersion = appliedMigrations.at(-1)?.version ?? 0;
    for (const migration of STORAGE_MIGRATIONS) {
      if (migration.version <= currentVersion) {
        continue;
      }
      this.#transaction(() => {
        this.#database.exec(migration.sql);
        this.#database
          .prepare(
            "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
          )
          .run(migration.version, migration.name, Date.now());
        this.#database.exec(`PRAGMA user_version = ${migration.version}`);
      });
    }
  }

  #rebuildUsage(): void {
    this.#transaction(() => {
      this.#database.exec(`
        DELETE FROM channel_usage;
        INSERT INTO channel_usage (
          channel_hash, envelope_count, envelope_bytes, retained_envelope_count,
          idempotency_count, key_package_count, key_package_bytes, nonce_count,
          presence_bytes, updated_at
        )
        WITH channels AS (
          SELECT channel_hash FROM presence
          UNION SELECT channel_hash FROM envelopes
          UNION SELECT channel_hash FROM key_packages
          UNION SELECT channel_hash FROM idempotency_records
          UNION SELECT channel_hash FROM auth_nonces
        )
        SELECT
          channels.channel_hash,
          (SELECT COUNT(*) FROM envelopes e WHERE e.channel_hash = channels.channel_hash AND e.state = 'pending'),
          COALESCE((SELECT SUM(ciphertext_bytes) FROM envelopes e WHERE e.channel_hash = channels.channel_hash AND e.state = 'pending'), 0),
          (SELECT COUNT(*) FROM envelopes e WHERE e.channel_hash = channels.channel_hash),
          (SELECT COUNT(*) FROM idempotency_records i WHERE i.channel_hash = channels.channel_hash),
          (SELECT COUNT(*) FROM key_packages k WHERE k.channel_hash = channels.channel_hash),
          COALESCE((SELECT SUM(ciphertext_bytes) FROM key_packages k WHERE k.channel_hash = channels.channel_hash), 0),
          (SELECT COUNT(*) FROM auth_nonces n WHERE n.channel_hash = channels.channel_hash),
          COALESCE((SELECT ciphertext_bytes FROM presence p WHERE p.channel_hash = channels.channel_hash), 0),
          0
        FROM channels;
        UPDATE service_usage SET
          total_bytes =
            COALESCE((SELECT SUM(ciphertext_bytes) FROM presence), 0)
            + COALESCE((SELECT SUM(ciphertext_bytes) FROM envelopes WHERE state = 'pending'), 0)
            + COALESCE((SELECT SUM(ciphertext_bytes) FROM key_packages), 0),
          retained_envelope_count = (SELECT COUNT(*) FROM envelopes),
          idempotency_count = (SELECT COUNT(*) FROM idempotency_records),
          key_package_count = (SELECT COUNT(*) FROM key_packages),
          nonce_count = (SELECT COUNT(*) FROM auth_nonces),
          presence_count = (SELECT COUNT(*) FROM presence)
        WHERE singleton = 1;
      `);
    });
  }

  #assertIntegrity(): void {
    const result = this.#database.prepare("PRAGMA quick_check(1)").get() as {
      quick_check: string;
    };
    if (result.quick_check !== "ok") {
      throw new ServiceError(
        "STORAGE_UNAVAILABLE",
        503,
        "SQLite integrity validation failed."
      );
    }
  }

  #assertGlobalQuota(deltaBytes: number, maximumBytes: number): void {
    const usage = this.#database
      .prepare("SELECT total_bytes FROM service_usage WHERE singleton = 1")
      .get() as {
      total_bytes: number;
    };
    if (usage.total_bytes + deltaBytes > maximumBytes) {
      throw quotaExceeded();
    }
  }

  #transaction<T>(operation: () => T): T {
    this.#assertOpen();
    if (this.#transactionDepth > 0) {
      return operation();
    }
    this.#database.exec("BEGIN IMMEDIATE");
    this.#transactionDepth += 1;
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    } finally {
      this.#transactionDepth -= 1;
    }
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new ServiceError(
        "STORAGE_UNAVAILABLE",
        503,
        "The storage adapter is closed."
      );
    }
  }
}

function prepareDatabasePath(databasePath: string): void {
  if (databasePath === ":memory:") {
    return;
  }
  const directoryPath = path.dirname(databasePath);
  mkdirSync(directoryPath, { mode: 0o700, recursive: true });
  const directory = lstatSync(directoryPath);
  if (
    directory.isSymbolicLink() ||
    !directory.isDirectory() ||
    (process.platform !== "win32" && (directory.mode & 0o077) !== 0)
  ) {
    throw storageUnavailable();
  }
  if (existsSync(databasePath)) {
    const database = lstatSync(databasePath);
    if (database.isSymbolicLink() || !database.isFile()) {
      throw storageUnavailable();
    }
  }
}

function validateStoreOptions(options: SqliteConnectivityStoreOptions): void {
  if (
    typeof options.databasePath !== "string" ||
    options.databasePath.length === 0 ||
    options.databasePath.includes("\0") ||
    !Number.isSafeInteger(options.busyTimeoutMs) ||
    options.busyTimeoutMs < 100 ||
    options.busyTimeoutMs > 60_000
  ) {
    throw storageUnavailable();
  }
}

function storageUnavailable(): ServiceError {
  return new ServiceError(
    "STORAGE_UNAVAILABLE",
    503,
    "The configured storage path or options are unavailable."
  );
}

function quotaExceeded(): ServiceError {
  return new ServiceError(
    "QUOTA_EXCEEDED",
    429,
    "The configured storage quota was exceeded.",
    {
      "retry-after": "60"
    }
  );
}

function safeRowId(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ServiceError(
      "STORAGE_UNAVAILABLE",
      503,
      "A storage cursor is outside the supported range."
    );
  }
  return value;
}

function changeCount(value: number | bigint): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new ServiceError(
      "STORAGE_UNAVAILABLE",
      503,
      "A storage change count is outside the supported range."
    );
  }
  return count;
}

function assertMetadataOnlyResponse(value: unknown): void {
  if (value === null || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertMetadataOnlyResponse(item);
    }
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!IDEMPOTENCY_RESPONSE_METADATA_KEYS.has(key)) {
      throw new ServiceError(
        "INTERNAL_ERROR",
        500,
        "Idempotency storage rejected a content-bearing response."
      );
    }
    assertMetadataOnlyResponse(item);
  }
}
