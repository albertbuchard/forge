import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  BrowserSessionService,
  type BrowserSessionRecord,
  type BrowserSessionRepository
} from "./browser-session-service.js";
import type { ForgePrincipal } from "./contracts.js";
import {
  KeyedSecretDigester,
  type OpaqueSecretSource,
  type SecurityClock
} from "./security-runtime.js";

class MutableClock implements SecurityClock {
  constructor(private current: Date) {}

  now() {
    return new Date(this.current);
  }

  advance(seconds: number) {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

class TestSecrets implements OpaqueSecretSource {
  private counter = 0;

  bytes(length: number) {
    const output: Buffer[] = [];
    while (Buffer.concat(output).byteLength < length) {
      output.push(
        createHash("sha256")
          .update(`browser-session-test-${this.counter++}`)
          .digest()
      );
    }
    return new Uint8Array(Buffer.concat(output).subarray(0, length));
  }
}

function memoryRepository(): BrowserSessionRepository {
  const records = new Map<string, BrowserSessionRecord>();
  return {
    createBrowserSession(record) {
      records.set(record.sessionDigest, record);
    },
    findBrowserSessionByDigest(sessionDigest) {
      return records.get(sessionDigest) ?? null;
    },
    touchBrowserSession(input) {
      const current = records.get(input.expectedSessionDigest);
      if (!current || current.id !== input.id) return false;
      current.lastUsedAt = input.lastUsedAt;
      current.idleExpiresAt = input.idleExpiresAt;
      return true;
    },
    rotateBrowserSession() {
      return false;
    },
    revokeBrowserSession(id, revokedAt) {
      const current = [...records.values()].find((record) => record.id === id);
      if (!current) return false;
      current.revokedAt = revokedAt;
      return true;
    }
  };
}

test("a local-owner session is proof-bound and usable only once", () => {
  const clock = new MutableClock(new Date("2026-07-26T12:00:00.000Z"));
  const repository = memoryRepository();
  const service = new BrowserSessionService(
    clock,
    new TestSecrets(),
    new KeyedSecretDigester(new Uint8Array(32).fill(7)),
    repository,
    { readOwnerSecurityEpoch: () => 1 }
  );
  const principal: ForgePrincipal = {
    kind: "local_service",
    subjectId: "owner-1",
    ownerId: "owner-1",
    clientId: null,
    installationId: "install-1",
    audience: "http://127.0.0.1:4317/api",
    scopes: ["*"],
    profile: "operator",
    ownerSecurityEpoch: 1,
    clientSecurityEpoch: null,
    authenticatedAt: clock.now().toISOString()
  };
  const session = service.create(principal, {
    idleLifetimeSeconds: 15 * 60,
    absoluteLifetimeSeconds: 60 * 60
  });

  assert.ok(
    service.authenticate({
      sessionToken: session.sessionToken,
      csrfToken: session.csrfToken,
      unsafeMethod: false
    })
  );
  assert.equal(
    service.authenticate({
      sessionToken: session.sessionToken,
      csrfToken: session.csrfToken,
      unsafeMethod: false
    }),
    null
  );
});

test("a process-bound browser session cannot survive API service replacement", () => {
  const clock = new MutableClock(new Date("2026-07-26T12:00:00.000Z"));
  const repository = memoryRepository();
  const digester = new KeyedSecretDigester(new Uint8Array(32).fill(9));
  const ownerEpochs = { readOwnerSecurityEpoch: () => 1 };
  const firstRuntime = new BrowserSessionService(
    clock,
    new TestSecrets(),
    digester,
    repository,
    ownerEpochs
  );
  const principal: ForgePrincipal = {
    kind: "operator_session",
    subjectId: "owner-1",
    ownerId: "owner-1",
    clientId: null,
    installationId: null,
    audience: "http://127.0.0.1:4317/api",
    scopes: ["*"],
    profile: "operator",
    ownerSecurityEpoch: 1,
    clientSecurityEpoch: null,
    authenticatedAt: clock.now().toISOString()
  };
  const session = firstRuntime.create(principal, { processBound: true });
  const replacementRuntime = new BrowserSessionService(
    clock,
    new TestSecrets(),
    digester,
    repository,
    ownerEpochs
  );

  assert.equal(
    replacementRuntime.authenticate({
      sessionToken: session.sessionToken,
      unsafeMethod: false
    }),
    null
  );
});

test("a persistent owner browser session survives API service replacement", () => {
  const clock = new MutableClock(new Date("2026-07-26T12:00:00.000Z"));
  const repository = memoryRepository();
  const digester = new KeyedSecretDigester(new Uint8Array(32).fill(10));
  const ownerEpochs = { readOwnerSecurityEpoch: () => 1 };
  const firstRuntime = new BrowserSessionService(
    clock,
    new TestSecrets(),
    digester,
    repository,
    ownerEpochs
  );
  const principal: ForgePrincipal = {
    kind: "operator_session",
    subjectId: "owner-1",
    ownerId: "owner-1",
    clientId: null,
    installationId: null,
    audience: "http://127.0.0.1:4317/api",
    scopes: ["*"],
    profile: "operator",
    ownerSecurityEpoch: 1,
    clientSecurityEpoch: null,
    authenticatedAt: clock.now().toISOString()
  };
  const session = firstRuntime.create(principal);
  const replacementRuntime = new BrowserSessionService(
    clock,
    new TestSecrets(),
    digester,
    repository,
    ownerEpochs
  );

  assert.ok(
    replacementRuntime.authenticate({
      sessionToken: session.sessionToken,
      unsafeMethod: false
    })
  );
});
