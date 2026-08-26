import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { ForgePrincipal } from "./contracts.js";
import { KeyedSecretDigester } from "./security-runtime.js";
import { SqliteSecurityStore } from "./sqlite-security-store.js";

const NOW = new Date("2026-08-26T12:00:00.000Z");

function createStore() {
  const database = new DatabaseSync(":memory:");
  const store = new SqliteSecurityStore(
    database,
    { now: () => new Date(NOW) },
    { bytes: (length) => new Uint8Array(length).fill(7) },
    new KeyedSecretDigester(new Uint8Array(32).fill(9))
  );
  store.initializeSchema();
  store.ensureOwner("owner-1");
  return { database, store };
}

function principal(kind: ForgePrincipal["kind"]): ForgePrincipal {
  if (kind === "local_service") {
    return {
      kind,
      subjectId: "owner-1",
      ownerId: "owner-1",
      clientId: null,
      installationId: "install-1",
      audience: "http://127.0.0.1:4317/api",
      scopes: ["*"],
      profile: "operator",
      ownerSecurityEpoch: 1,
      clientSecurityEpoch: null,
      authenticatedAt: NOW.toISOString()
    };
  }
  if (kind === "operator_session") {
    return {
      kind,
      subjectId: "owner-1",
      ownerId: "owner-1",
      clientId: null,
      installationId: null,
      audience: "http://127.0.0.1:4317/api",
      scopes: ["*"],
      profile: "operator",
      ownerSecurityEpoch: 1,
      clientSecurityEpoch: null,
      authenticatedAt: NOW.toISOString()
    };
  }
  return {
    kind: "paired_client",
    subjectId: "pair-1",
    ownerId: "owner-1",
    clientId: "client-1",
    installationId: "install-1",
    audience: "https://forge.example.test/api",
    scopes: ["read"],
    profile: "trusted_personal_assistant",
    ownerSecurityEpoch: 1,
    clientSecurityEpoch: 1,
    authenticatedAt: NOW.toISOString()
  };
}

function insertSession(
  database: DatabaseSync,
  input: {
    id: string;
    kind: ForgePrincipal["kind"];
    idleExpiresAt: string;
    absoluteExpiresAt: string;
    revokedAt?: string | null;
  }
) {
  database
    .prepare(
      `INSERT INTO security_browser_sessions (
        id, session_digest, csrf_digest, principal_json, owner_id, owner_epoch,
        created_at, last_used_at, idle_expires_at, absolute_expires_at, revoked_at
      ) VALUES (?, ?, ?, ?, 'owner-1', 1, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      `digest-${input.id}`,
      `csrf-${input.id}`,
      JSON.stringify(principal(input.kind)),
      "2026-06-01T00:00:00.000Z",
      "2026-06-01T00:00:00.000Z",
      input.idleExpiresAt,
      input.absoluteExpiresAt,
      input.revokedAt ?? null
    );
}

function sessionIds(database: DatabaseSync) {
  return (
    database
      .prepare("SELECT id FROM security_browser_sessions ORDER BY id")
      .all() as Array<{ id: string }>
  ).map((row) => row.id);
}

test("browser-session maintenance retains live authority and applies kind-specific windows", () => {
  const { database, store } = createStore();
  insertSession(database, {
    id: "local-expired-old",
    kind: "local_service",
    idleExpiresAt: "2026-08-24T09:00:00.000Z",
    absoluteExpiresAt: "2026-08-24T10:00:00.000Z"
  });
  insertSession(database, {
    id: "local-revoked-old",
    kind: "local_service",
    idleExpiresAt: "2026-08-27T00:00:00.000Z",
    absoluteExpiresAt: "2026-08-27T01:00:00.000Z",
    revokedAt: "2026-08-24T10:00:00.000Z"
  });
  insertSession(database, {
    id: "local-revoked-recent",
    kind: "local_service",
    idleExpiresAt: "2026-08-27T00:00:00.000Z",
    absoluteExpiresAt: "2026-08-27T01:00:00.000Z",
    revokedAt: "2026-08-25T13:00:00.000Z"
  });
  insertSession(database, {
    id: "local-active",
    kind: "local_service",
    idleExpiresAt: "2026-08-26T13:00:00.000Z",
    absoluteExpiresAt: "2026-08-26T14:00:00.000Z"
  });
  insertSession(database, {
    id: "paired-revoked-old",
    kind: "paired_client",
    idleExpiresAt: "2026-09-01T00:00:00.000Z",
    absoluteExpiresAt: "2026-09-02T00:00:00.000Z",
    revokedAt: "2026-07-25T10:00:00.000Z"
  });
  insertSession(database, {
    id: "operator-expired-old",
    kind: "operator_session",
    idleExpiresAt: "2026-07-25T09:00:00.000Z",
    absoluteExpiresAt: "2026-07-25T10:00:00.000Z"
  });
  insertSession(database, {
    id: "paired-revoked-recent",
    kind: "paired_client",
    idleExpiresAt: "2026-09-01T00:00:00.000Z",
    absoluteExpiresAt: "2026-09-02T00:00:00.000Z",
    revokedAt: "2026-07-28T10:00:00.000Z"
  });
  insertSession(database, {
    id: "paired-active",
    kind: "paired_client",
    idleExpiresAt: "2026-08-27T00:00:00.000Z",
    absoluteExpiresAt: "2026-09-02T00:00:00.000Z"
  });

  assert.deepEqual(store.pruneRetiredBrowserSessions(), {
    localServiceSessions: 2,
    browserSessions: 2,
    total: 4
  });
  assert.deepEqual(sessionIds(database), [
    "local-active",
    "local-revoked-recent",
    "paired-active",
    "paired-revoked-recent"
  ]);
});

test("browser-session maintenance never exceeds its bounded pass limit", () => {
  const { database, store } = createStore();
  for (let index = 0; index < 5; index += 1) {
    insertSession(database, {
      id: `local-old-${index}`,
      kind: "local_service",
      idleExpiresAt: "2026-08-20T00:00:00.000Z",
      absoluteExpiresAt: "2026-08-20T01:00:00.000Z"
    });
  }

  assert.equal(store.pruneRetiredBrowserSessions(2).total, 2);
  assert.equal(sessionIds(database).length, 3);
  assert.equal(store.pruneRetiredBrowserSessions(2).total, 2);
  assert.equal(sessionIds(database).length, 1);
  assert.equal(store.pruneRetiredBrowserSessions(2).total, 1);
  assert.equal(sessionIds(database).length, 0);
  assert.throws(
    () => store.pruneRetiredBrowserSessions(100_001),
    /maintenance limit is invalid/
  );
});
