import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  InMemorySecurityRateLimiter,
  SqliteRateLimitStatePersistence
} from "./security-rate-limiter.js";
import type { RateAdmissionRequest } from "./security-observability.js";

function request(
  overrides: Partial<RateAdmissionRequest> = {}
): RateAdmissionRequest {
  return {
    bucket: "request",
    principalId: "principal_a",
    clientId: null,
    installationId: "installation_a",
    networkId: "network_a",
    action: "notes.read",
    cost: 1,
    now: new Date("2026-07-26T12:00:00.000Z"),
    ...overrides
  };
}

test("rate limits isolate network, principal, action, and bucket identities", () => {
  const limiter = new InMemorySecurityRateLimiter({
    policies: {
      request: { capacity: 2, refillPerSecond: 1 }
    }
  });

  assert.equal(limiter.admit(request()).allowed, true);
  assert.equal(limiter.admit(request()).allowed, true);
  assert.equal(limiter.admit(request()).allowed, false);
  assert.equal(
    limiter.admit(request({ principalId: "principal_b" })).allowed,
    false
  );
  assert.equal(
    limiter.admit(
      request({
        principalId: "principal_b",
        installationId: "installation_b",
        networkId: "network_b"
      })
    ).allowed,
    true
  );
  assert.equal(
    limiter.admit(request({ action: "projects.read" })).allowed,
    true
  );
  assert.equal(limiter.admit(request({ bucket: "mcp_tool" })).allowed, true);
});

test("rate limits refill monotonically and do not reset on clock rollback", () => {
  const limiter = new InMemorySecurityRateLimiter({
    policies: {
      request: { capacity: 1, refillPerSecond: 1 }
    }
  });

  assert.equal(limiter.admit(request()).allowed, true);
  assert.equal(
    limiter.admit(request({ now: new Date("2026-07-26T11:59:59.000Z") }))
      .allowed,
    false
  );
  assert.equal(
    limiter.admit(request({ now: new Date("2026-07-26T12:00:01.000Z") }))
      .allowed,
    true
  );
});

test("a single oversized cost is denied without exhausting another identity", () => {
  const limiter = new InMemorySecurityRateLimiter({
    policies: {
      ai_cost: { capacity: 10, refillPerSecond: 1 }
    }
  });
  const denied = limiter.admit(
    request({ bucket: "ai_cost", cost: 11, principalId: "principal_a" })
  );

  assert.equal(denied.allowed, false);
  assert.equal(
    limiter.admit(
      request({ bucket: "ai_cost", cost: 1, principalId: "principal_b" })
    ).allowed,
    true
  );
});

test("security-sensitive rate state survives an API process replacement", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(
      await readFile(
        new URL(
          "../../../../apps/api/migrations/118_security_audit_chain.sql",
          import.meta.url
        ),
        "utf8"
      )
    );
    const options = {
      policies: {
        pairing_attempt: { capacity: 2, refillPerSecond: 0.01 }
      },
      persistence: new SqliteRateLimitStatePersistence(database)
    };
    const first = new InMemorySecurityRateLimiter(options);
    assert.equal(
      first.admit(request({ bucket: "pairing_attempt" })).allowed,
      true
    );
    assert.equal(
      first.admit(request({ bucket: "pairing_attempt" })).allowed,
      true
    );

    const replacement = new InMemorySecurityRateLimiter(options);
    assert.equal(
      replacement.admit(request({ bucket: "pairing_attempt" })).allowed,
      false
    );
  } finally {
    database.close();
  }
});

test("persistent multi-dimensional admission rolls back every debit on failure", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(
      await readFile(
        new URL(
          "../../../../apps/api/migrations/118_security_audit_chain.sql",
          import.meta.url
        ),
        "utf8"
      )
    );
    let writes = 0;
    class FailingPersistence extends SqliteRateLimitStatePersistence {
      override upsert(
        key: string,
        state: Parameters<SqliteRateLimitStatePersistence["upsert"]>[1]
      ) {
        writes += 1;
        if (writes === 2) {
          throw new Error("injected persistent admission failure");
        }
        super.upsert(key, state);
      }
    }
    const limiter = new InMemorySecurityRateLimiter({
      persistence: new FailingPersistence(database)
    });
    assert.throws(() => limiter.admit(request()), /injected/u);
    assert.equal(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM security_rate_limit_buckets")
          .get() as { count: number }
      ).count,
      0
    );
  } finally {
    database.close();
  }
});

test("retired browser-session principal buckets are pruned without touching active or unrelated rate state", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE security_rate_limit_buckets (
        bucket_key TEXT PRIMARY KEY,
        tokens REAL NOT NULL,
        updated_at_milliseconds INTEGER NOT NULL,
        last_seen_milliseconds INTEGER NOT NULL
      );
      CREATE TABLE security_browser_sessions (
        id TEXT PRIMARY KEY,
        idle_expires_at TEXT NOT NULL,
        absolute_expires_at TEXT NOT NULL,
        revoked_at TEXT
      );
    `);
    const persistence = new SqliteRateLimitStatePersistence(database);
    const state = {
      tokens: 599,
      updatedAtMilliseconds: Date.parse("2026-07-30T10:00:00.000Z"),
      lastSeenMilliseconds: Date.parse("2026-07-30T10:00:00.000Z")
    };
    database
      .prepare(
        `INSERT INTO security_browser_sessions (
           id, idle_expires_at, absolute_expires_at, revoked_at
         ) VALUES (?, ?, ?, ?)`
      )
      .run(
        "ses_revoked",
        "2026-07-30T11:00:00.000Z",
        "2026-07-30T12:00:00.000Z",
        "2026-07-30T10:01:00.000Z"
      );
    database
      .prepare(
        `INSERT INTO security_browser_sessions (
           id, idle_expires_at, absolute_expires_at, revoked_at
         ) VALUES (?, ?, ?, ?)`
      )
      .run(
        "ses_expired",
        "2026-07-30T09:59:59.000Z",
        "2026-07-30T09:59:59.000Z",
        null
      );
    database
      .prepare(
        `INSERT INTO security_browser_sessions (
           id, idle_expires_at, absolute_expires_at, revoked_at
         ) VALUES (?, ?, ?, ?)`
      )
      .run(
        "ses_idle_expired",
        "2026-07-30T09:59:59.000Z",
        "2026-07-30T12:00:00.000Z",
        null
      );
    database
      .prepare(
        `INSERT INTO security_browser_sessions (
           id, idle_expires_at, absolute_expires_at, revoked_at
         ) VALUES (?, ?, ?, ?)`
      )
      .run(
        "ses_active",
        "2026-07-30T11:00:00.000Z",
        "2026-07-30T12:00:00.000Z",
        null
      );

    const revokedKey = JSON.stringify([
      "request",
      "principal:ses_revoked",
      "notes.read"
    ]);
    const expiredKey = JSON.stringify([
      "request",
      "principal:ses_expired",
      "notes.read"
    ]);
    const activeKey = JSON.stringify([
      "request",
      "principal:ses_active",
      "notes.read"
    ]);
    const idleExpiredKey = JSON.stringify([
      "request",
      "principal:ses_idle_expired",
      "notes.read"
    ]);
    const installationKey = JSON.stringify([
      "request",
      "installation:installation_a",
      "notes.read"
    ]);
    const malformedTwoElementKey = JSON.stringify([
      "request",
      "principal:ses_revoked"
    ]);
    const malformedFourElementKey = JSON.stringify([
      "request",
      "principal:ses_revoked",
      "notes.read",
      "unexpected"
    ]);
    const malformedNonTextKey = JSON.stringify([
      "request",
      "principal:ses_revoked",
      42
    ]);
    const unknownBucketKey = JSON.stringify([
      "unknown_bucket",
      "principal:ses_revoked",
      "notes.read"
    ]);
    for (const key of [
      revokedKey,
      expiredKey,
      idleExpiredKey,
      activeKey,
      installationKey,
      malformedTwoElementKey,
      malformedFourElementKey,
      malformedNonTextKey,
      unknownBucketKey,
      "not-json"
    ]) {
      persistence.upsert(key, state);
    }

    assert.equal(
      persistence.pruneRetiredBrowserSessionPrincipalState(
        new Date("2026-07-30T10:00:00.000Z")
      ),
      3
    );
    assert.deepEqual(
      persistence
        .load()
        .map(({ key }) => key)
        .sort(),
      [
        activeKey,
        installationKey,
        malformedTwoElementKey,
        malformedFourElementKey,
        malformedNonTextKey,
        unknownBucketKey,
        "not-json"
      ].sort()
    );
    assert.equal(
      persistence.pruneRetiredBrowserSessionPrincipalState(
        new Date("2026-07-30T10:00:00.000Z")
      ),
      0
    );
  } finally {
    database.close();
  }
});
