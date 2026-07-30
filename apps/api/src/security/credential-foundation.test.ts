import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  SignJWT,
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  type JWK
} from "jose";

import { AccessCredentialService } from "./access-credential.js";
import { BrowserSessionService } from "./browser-session-service.js";
import { CompatibilityMigrationService } from "./compatibility-migration-service.js";
import type { ForgePrincipal } from "./contracts.js";
import { DpopVerifier } from "./dpop.js";
import { LocalOwnerAssertionService } from "./local-owner-assertion.js";
import {
  LocalOwnerSessionCoordinator,
  type BrowserPublicKey
} from "./local-owner-session-coordinator.js";
import {
  NATIVE_OWNER_BROKER_PROTOCOL,
  NativeOwnerBroker,
  OwnerChannelAuthority,
  type VerifiedOwnerChannel
} from "./owner-channel.js";
import { OwnerStepUpService } from "./owner-step-up-service.js";
import { OwnerWebAuthnAuthority } from "./owner-webauthn.js";
import { PairingClientProofVerifier } from "./pairing-client-proof.js";
import { PairingNetworkPartitionAuthority } from "./pairing-network-partition.js";
import { PairingOwnerAuthorizationService } from "./pairing-owner-authorization.js";
import { PairingService } from "./pairing-service.js";
import { RefreshFamilyService } from "./refresh-family-service.js";
import {
  KeyedSecretDigester,
  type OpaqueSecretSource,
  type SecurityClock
} from "./security-runtime.js";
import { redactSecurityAuditDetail } from "./security-observability.js";
import {
  FileSigningKeyProvider,
  InMemorySigningKeyProvider
} from "./signing-key-provider.js";
import { SqliteSecurityStore } from "./sqlite-security-store.js";

class MutableClock implements SecurityClock {
  constructor(private current: Date) {}

  now() {
    return new Date(this.current);
  }

  advance(seconds: number) {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

class IncrementingSecretSource implements OpaqueSecretSource {
  private next = 1;

  bytes(length: number) {
    const chunks: Buffer[] = [];
    while (Buffer.concat(chunks).byteLength < length) {
      chunks.push(
        createHash("sha256").update(`forge-test-secret-${this.next}`).digest()
      );
      this.next += 1;
    }
    return new Uint8Array(Buffer.concat(chunks).subarray(0, length));
  }
}

function foundation() {
  const clock = new MutableClock(new Date("2026-07-25T20:00:00.000Z"));
  const secrets = new IncrementingSecretSource();
  const digester = new KeyedSecretDigester(new Uint8Array(32).fill(41));
  return { clock, secrets, digester };
}

async function trustedTestMetadata(target: string) {
  const metadata = await lstat(target);
  return new Proxy(metadata, {
    get(value, property) {
      if (property === "mode") {
        return value.mode & ~0o022;
      }
      if (property === "uid") {
        return process.getuid?.() ?? value.uid;
      }
      const member = Reflect.get(value, property, value) as unknown;
      return typeof member === "function" ? member.bind(value) : member;
    }
  });
}

function assertSingleLineDiagnostic(value: string) {
  for (const control of ["\n", "\r", "\t", String.fromCharCode(27)]) {
    assert.equal(value.includes(control), false);
  }
}

function openStore(
  databasePath: string,
  context: ReturnType<typeof foundation>
) {
  const database = new DatabaseSync(databasePath);
  const store = new SqliteSecurityStore(
    database,
    context.clock,
    context.secrets,
    context.digester
  );
  store.initializeSchema();
  return { database, store };
}

function principal(overrides: Partial<ForgePrincipal> = {}): ForgePrincipal {
  return {
    kind: "paired_client",
    subjectId: "client-subject-1",
    ownerId: "owner-1",
    clientId: "client-1",
    installationId: "install-1",
    audience: "https://forge.local/api",
    scopes: ["read", "write"],
    profile: "trusted_personal_assistant",
    ownerSecurityEpoch: 1,
    clientSecurityEpoch: 1,
    authenticatedAt: "2026-07-25T20:00:00.000Z",
    ...overrides
  };
}

async function platformOwnerEvidence(
  authority: OwnerChannelAuthority,
  clock: SecurityClock
) {
  return authority.authenticateWithPlatform({
    authenticate: async (expectedOwnerUserId) => ({
      ownerUserId: expectedOwnerUserId,
      authenticatedAt: clock.now()
    })
  });
}

async function pairingKey() {
  const pair = await generateKeyPair("ES256", { extractable: true });
  const publicJwk = await exportJWK(pair.publicKey);
  return {
    pair,
    publicJwk,
    thumbprint: await calculateJwkThumbprint(publicJwk)
  };
}

async function pairingProof(input: {
  privateKey: CryptoKey;
  publicJwk: JWK;
  requestId: string;
  operation: "poll" | "cancel";
  tokenId: string;
  clock: SecurityClock;
}) {
  return new SignJWT({
    request_id: input.requestId,
    operation: input.operation
  })
    .setProtectedHeader({
      alg: "ES256",
      typ: "forge-pairing+jwt",
      jwk: input.publicJwk
    })
    .setJti(input.tokenId)
    .setIssuedAt(Math.floor(input.clock.now().getTime() / 1000))
    .sign(input.privateKey);
}

function ownerBrowserSession(input: {
  ownerId: string;
  context: ReturnType<typeof foundation>;
  store: SqliteSecurityStore;
}) {
  const browser = new BrowserSessionService(
    input.context.clock,
    input.context.secrets,
    input.context.digester,
    input.store,
    input.store
  );
  const tokens = browser.create(
    principal({
      kind: "operator_session",
      ownerId: input.ownerId,
      subjectId: `owner-${input.ownerId}`,
      clientId: null,
      installationId: null,
      clientSecurityEpoch: null,
      profile: "operator",
      scopes: ["operator"]
    })
  );
  return {
    browser,
    authenticate() {
      const session = browser.authenticate({
        sessionToken: tokens.sessionToken,
        csrfToken: tokens.csrfToken,
        unsafeMethod: true
      });
      assert.ok(session);
      return session;
    }
  };
}

function pairingOwnerAuthorizations(input: {
  context: ReturnType<typeof foundation>;
  store: SqliteSecurityStore;
  browser: BrowserSessionService;
  networkPartitions: PairingNetworkPartitionAuthority<string>;
}) {
  return new PairingOwnerAuthorizationService(
    input.context.clock,
    input.context.digester,
    input.store,
    input.browser,
    {
      consumePrivilegedPairingAuthorization: () => {
        throw new Error("Unexpected privileged pairing authorization.");
      }
    },
    input.networkPartitions
  );
}

function createSqliteRaceWorker(input: {
  databasePath: string;
  now: string;
  operation: "rotate_refresh" | "consume_pairing";
  payload: object;
}) {
  const storeModule = pathToFileURL(
    path.join(process.cwd(), "apps/api/src/security/sqlite-security-store.ts")
  ).href;
  const runtimeModule = pathToFileURL(
    path.join(process.cwd(), "apps/api/src/security/security-runtime.ts")
  ).href;
  const source = `
    import { DatabaseSync } from "node:sqlite";
    import { SqliteSecurityStore } from ${JSON.stringify(storeModule)};
    import { KeyedSecretDigester } from ${JSON.stringify(runtimeModule)};
    const [databasePath, now, operation, encodedPayload] = process.argv.slice(1);
    const payload = JSON.parse(encodedPayload);
    await new Promise((resolve) => process.stdin.once("data", resolve));
    const database = new DatabaseSync(databasePath);
    const clock = { now: () => new Date(now) };
    const secrets = { bytes: (length) => new Uint8Array(length).fill(19) };
    const store = new SqliteSecurityStore(
      database,
      clock,
      secrets,
      new KeyedSecretDigester(new Uint8Array(32).fill(41))
    );
    store.initializeSchema();
    const result = operation === "rotate_refresh"
      ? store.rotateRefresh(payload)
      : store.transitionPairingRequest(payload);
    process.stdout.write(JSON.stringify(result));
    database.close();
  `;
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      source,
      input.databasePath,
      input.now,
      input.operation,
      JSON.stringify(input.payload)
    ],
    { stdio: ["pipe", "pipe", "pipe"] }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
    if (stdout.length > 16_384) {
      child.kill("SIGTERM");
    }
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
    if (stderr.length > 16_384) {
      child.kill("SIGTERM");
    }
  });
  return {
    start() {
      child.stdin.end("go");
    },
    result: new Promise<unknown>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code !== 0) {
          reject(
            new Error(
              `Forge SQLite race worker failed (${code}): ${stderr.slice(0, 500)}`
            )
          );
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(error);
        }
      });
    })
  };
}

test("native owner-channel evidence is kernel-backed, exact, opaque, and single-use", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-owner-socket-"));
  const socketPath = path.join(await realpath(root), "owner.sock");
  const { clock } = foundation();
  const ownerUserId = String(process.getuid?.() ?? 501);
  const ownerUid = process.getuid?.() ?? 501;
  const authority = new OwnerChannelAuthority(clock, ownerUserId, ownerUid);
  const binaryPath = path.join(
    process.cwd(),
    "packages/forge-peer/target/debug/forge-owner-broker"
  );
  const broker = new NativeOwnerBroker(binaryPath, socketPath, clock);
  const request = {
    protocol: NATIVE_OWNER_BROKER_PROTOCOL,
    requestId: "request_native_owner_1",
    transactionId: "local_native_transaction_1",
    installId: "forge-local-install",
    browserOrigin: "http://127.0.0.1:3027",
    browserNonce: "A".repeat(43)
  } as const;
  try {
    const evidence = await authority.authenticateWithNativeBroker(
      broker,
      request,
      async ({ binaryPath: helper, socketPath: socket, request: approval }) => {
        const child = spawn(helper, ["approve", "--socket", socket], {
          stdio: ["pipe", "ignore", "pipe"],
          env: {}
        });
        child.stdin.end(JSON.stringify(approval));
        const exitCode = await new Promise<number | null>((resolve, reject) => {
          child.once("error", reject);
          child.once("exit", resolve);
        });
        assert.equal(exitCode, 0);
      }
    );
    assert.equal(evidence.transport, "native_owner_broker");
    authority.assertVerified(evidence);
    assert.throws(() => authority.assertVerified(evidence), /replayed/);

    const replayedBrokerReceipt = authority.authenticateWithNativeBroker(
      broker,
      { ...request, requestId: "request_native_owner_2" },
      async () => {
        throw new Error("owner declined");
      }
    );
    await assert.rejects(replayedBrokerReceipt, /owner declined/);

    const forged = {
      ownerUserId,
      transport: "native_owner_broker",
      verifiedAt: clock.now().toISOString()
    } as VerifiedOwnerChannel;
    assert.throws(
      () => authority.assertVerified(forged),
      /trusted OS boundary/
    );

    const unsafeDirectory = path.join(root, "unsafe-broker-parent");
    await mkdir(unsafeDirectory, { mode: 0o700 });
    await chmod(unsafeDirectory, 0o777);
    const unsafeBinary = path.join(unsafeDirectory, "forge-owner-broker");
    await copyFile(binaryPath, unsafeBinary);
    await chmod(unsafeBinary, 0o755);
    const unsafeBroker = new NativeOwnerBroker(
      unsafeBinary,
      path.join(await realpath(root), "unsafe-owner.sock"),
      clock
    );
    await assert.rejects(
      unsafeBroker.authenticate(request, async () => undefined),
      /unsafe writable, untrusted-owner, or symlinked directory/
    );

    const foreignOwnedDirectory = path.join(root, "foreign-broker-parent");
    await mkdir(foreignOwnedDirectory, { mode: 0o755 });
    const foreignOwnedBinary = path.join(
      foreignOwnedDirectory,
      "forge-owner-broker"
    );
    await copyFile(binaryPath, foreignOwnedBinary);
    await chmod(foreignOwnedBinary, 0o755);
    const foreignUid = (process.getuid?.() ?? 501) + 1;
    const foreignOwnedBroker = new NativeOwnerBroker(
      foreignOwnedBinary,
      path.join(await realpath(root), "foreign-owner.sock"),
      clock,
      15_000,
      async (target) => {
        const metadata = await lstat(target);
        if (target !== foreignOwnedDirectory) {
          return metadata;
        }
        return new Proxy(metadata, {
          get(value, property) {
            if (property === "uid") {
              return foreignUid;
            }
            const member = Reflect.get(value, property, value) as unknown;
            return typeof member === "function" ? member.bind(value) : member;
          }
        });
      }
    );
    await assert.rejects(
      foreignOwnedBroker.authenticate(request, async () => undefined),
      /unsafe writable, untrusted-owner, or symlinked directory/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native owner-channel failures retain bounded broker diagnostics", async () => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "forge-owner-diagnostic-"))
  );
  const binaryPath = path.join(root, "failing-owner-broker");
  const socketPath = path.join(await realpath(root), "owner.sock");
  const { clock } = foundation();
  const request = {
    protocol: NATIVE_OWNER_BROKER_PROTOCOL,
    requestId: "request_native_owner_diagnostic",
    transactionId: "local_native_transaction_diagnostic",
    installId: "forge-local-install",
    browserOrigin: "http://127.0.0.1:3027",
    browserNonce: "A".repeat(43)
  } as const;
  try {
    await writeFile(
      binaryPath,
      `#!/bin/sh
printf 'diagnostic\\nsecond\\r\\t\\033[31m' >&2
printf '%4096s' diagnostic | tr ' ' x >&2
exit 42
`
    );
    await chmod(binaryPath, 0o700);
    const broker = new NativeOwnerBroker(
      binaryPath,
      socketPath,
      clock,
      15_000,
      trustedTestMetadata
    );
    await assert.rejects(
      broker.authenticate(request, async () => undefined),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /exited before verification \(code 42\)/);
        assert.match(
          error.message,
          /Broker stderr: diagnostic\?second\?\?\?\[31mx+/
        );
        assertSingleLineDiagnostic(error.message);
        assert.ok(error.message.length < 2_300);
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native owner-channel diagnostics cover readiness timeout and invalid events", async () => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "forge-owner-events-"))
  );
  const { clock } = foundation();
  const request = {
    protocol: NATIVE_OWNER_BROKER_PROTOCOL,
    requestId: "request_native_owner_event_diagnostic",
    transactionId: "local_native_transaction_event_diagnostic",
    installId: "forge-local-install",
    browserOrigin: "http://127.0.0.1:3027",
    browserNonce: "A".repeat(43)
  } as const;
  try {
    const timeoutBinary = path.join(root, "timeout-owner-broker");
    await writeFile(
      timeoutBinary,
      `#!/bin/sh
printf 'timeout\\ncontrol\\033[31m' >&2
sleep 2
`
    );
    await chmod(timeoutBinary, 0o700);
    const timeoutBroker = new NativeOwnerBroker(
      timeoutBinary,
      path.join(await realpath(root), "timeout.sock"),
      clock,
      500,
      trustedTestMetadata
    );
    await assert.rejects(
      timeoutBroker.authenticate(request, async () => undefined),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /did not become ready/);
        assert.match(error.message, /Broker stderr: timeout\?control\?\[31m/);
        assertSingleLineDiagnostic(error.message);
        return true;
      }
    );

    const invalidEventBinary = path.join(root, "invalid-event-owner-broker");
    await writeFile(
      invalidEventBinary,
      `#!/bin/sh
printf 'invalid\\nevent' >&2
sleep 0.1
printf 'not-json\\n'
sleep 0.1
exit 43
`
    );
    await chmod(invalidEventBinary, 0o700);
    const invalidEventBroker = new NativeOwnerBroker(
      invalidEventBinary,
      path.join(await realpath(root), "invalid.sock"),
      clock,
      1_000,
      trustedTestMetadata
    );
    await assert.rejects(
      invalidEventBroker.authenticate(
        { ...request, requestId: "request_native_owner_invalid_event" },
        async () => undefined
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /emitted invalid JSON/);
        assert.match(error.message, /Broker stderr: invalid\?event/);
        assertSingleLineDiagnostic(error.message);
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local-owner exchange survives restart and rejects forged, stale, cross-origin, and replayed assertions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-local-owner-"));
  const databasePath = path.join(root, "security.sqlite");
  const keyPath = path.join(root, "keys", "signing.json");
  const context = foundation();
  const authority = new OwnerChannelAuthority(context.clock, "501");
  let opened = openStore(databasePath, context);
  try {
    opened.store.ensureOwner("501");
    let keys = new FileSigningKeyProvider("https://forge.local", keyPath);
    await keys.initialize();
    let service = new LocalOwnerAssertionService(
      keys,
      context.clock,
      context.digester,
      opened.store,
      authority,
      "forge-local-exchange",
      30
    );
    assert.throws(
      () =>
        service.begin({
          installId: "install-remote",
          browserOrigin: "https://remote.example",
          browserNonce: "A".repeat(43)
        }),
      /loopback/
    );
    assert.throws(
      () =>
        service.begin({
          installId: "install-weak",
          browserOrigin: "http://127.0.0.1:3027",
          browserNonce: "weak"
        }),
      /high-entropy/
    );
    const transaction = service.begin({
      installId: "install-1",
      browserOrigin: "http://127.0.0.1:3027",
      browserNonce: "A".repeat(43)
    });
    const assertion = await service.mintFromOwnerChannel({
      transactionId: transaction.transactionId,
      evidence: await platformOwnerEvidence(authority, context.clock)
    });
    opened.database.close();

    opened = openStore(databasePath, context);
    keys = new FileSigningKeyProvider("https://forge.local", keyPath);
    await keys.initialize();
    service = new LocalOwnerAssertionService(
      keys,
      context.clock,
      context.digester,
      opened.store,
      authority,
      "forge-local-exchange",
      30
    );
    await assert.rejects(
      service.exchange({
        assertion,
        installId: "install-1",
        browserOrigin: "http://attacker.invalid",
        browserNonce: "A".repeat(43)
      }),
      /loopback|binding/
    );
    await assert.rejects(
      service.exchange({
        assertion,
        installId: "install-attacker",
        browserOrigin: "http://127.0.0.1:3027",
        browserNonce: "A".repeat(43)
      }),
      /binding/
    );
    await assert.rejects(
      service.exchange({
        assertion,
        installId: "install-1",
        browserOrigin: "http://127.0.0.1:3027",
        browserNonce: "Z".repeat(43)
      }),
      /binding/
    );
    opened.store.ensureOwner("502");
    const wrongOwnerService = new LocalOwnerAssertionService(
      keys,
      context.clock,
      context.digester,
      opened.store,
      new OwnerChannelAuthority(context.clock, "502"),
      "forge-local-exchange",
      30
    );
    await assert.rejects(
      wrongOwnerService.exchange({
        assertion,
        installId: "install-1",
        browserOrigin: "http://127.0.0.1:3027",
        browserNonce: "A".repeat(43)
      }),
      /binding/
    );
    assert.equal(
      (
        await service.exchange({
          assertion,
          installId: "install-1",
          browserOrigin: "http://127.0.0.1:3027",
          browserNonce: "A".repeat(43)
        })
      ).ownerUserId,
      "501"
    );
    await assert.rejects(
      service.exchange({
        assertion,
        installId: "install-1",
        browserOrigin: "http://127.0.0.1:3027",
        browserNonce: "A".repeat(43)
      }),
      /already used/
    );

    const expiredAssertionTransaction = service.begin({
      installId: "install-expired-assertion",
      browserOrigin: "http://127.0.0.1:3027",
      browserNonce: "D".repeat(43)
    });
    const expiredAssertion = await service.mintFromOwnerChannel({
      transactionId: expiredAssertionTransaction.transactionId,
      evidence: await platformOwnerEvidence(authority, context.clock)
    });
    context.clock.advance(31);
    await assert.rejects(
      service.exchange({
        assertion: expiredAssertion,
        installId: "install-expired-assertion",
        browserOrigin: "http://127.0.0.1:3027",
        browserNonce: "D".repeat(43)
      }),
      /expired/
    );

    const expiring = service.begin({
      installId: "install-2",
      browserOrigin: "http://127.0.0.1:3027",
      browserNonce: "B".repeat(43)
    });
    context.clock.advance(31);
    await assert.rejects(
      service.mintFromOwnerChannel({
        transactionId: expiring.transactionId,
        evidence: await platformOwnerEvidence(authority, context.clock)
      }),
      /expired/
    );

    const interactive = service.begin(
      {
        installId: "install-interactive",
        browserOrigin: "http://127.0.0.1:3027",
        browserNonce: "I".repeat(43)
      },
      { transactionLifetimeSeconds: 120 }
    );
    context.clock.advance(31);
    const interactiveAssertion = await service.mintFromOwnerChannel({
      transactionId: interactive.transactionId,
      evidence: await platformOwnerEvidence(authority, context.clock)
    });
    context.clock.advance(33);
    await assert.rejects(
      service.exchange({
        assertion: interactiveAssertion,
        installId: "install-interactive",
        browserOrigin: "http://127.0.0.1:3027",
        browserNonce: "I".repeat(43)
      }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "ERR_JWT_EXPIRED"
    );
    assert.throws(
      () =>
        service.begin(
          {
            installId: "install-unbounded",
            browserOrigin: "http://127.0.0.1:3027",
            browserNonce: "U".repeat(43)
          },
          { transactionLifetimeSeconds: 301 }
        ),
      /bounded range/
    );

    const staleEpochTransaction = service.begin({
      installId: "install-stale-epoch",
      browserOrigin: "http://127.0.0.1:3027",
      browserNonce: "E".repeat(43)
    });
    const staleEpochAssertion = await service.mintFromOwnerChannel({
      transactionId: staleEpochTransaction.transactionId,
      evidence: await platformOwnerEvidence(authority, context.clock)
    });
    opened.database
      .prepare(
        `UPDATE security_owners SET security_epoch = security_epoch + 1
         WHERE owner_id = ?`
      )
      .run("501");
    await assert.rejects(
      service.exchange({
        assertion: staleEpochAssertion,
        installId: "install-stale-epoch",
        browserOrigin: "http://127.0.0.1:3027",
        browserNonce: "E".repeat(43)
      }),
      /binding/
    );
  } finally {
    opened.database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent local-owner begins reserve at most four broker slots and release them cleanly", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "forge-local-owner-capacity-")
  );
  const context = foundation();
  const opened = openStore(path.join(root, "security.sqlite"), context);
  try {
    opened.store.ensureOwner("501");
    const keys = new InMemorySigningKeyProvider("https://forge.local");
    await keys.initialize();
    const authority = new OwnerChannelAuthority(context.clock, "501");
    const assertions = new LocalOwnerAssertionService(
      keys,
      context.clock,
      context.digester,
      opened.store,
      authority,
      "forge-local-capacity"
    );
    const browserSessions = new BrowserSessionService(
      context.clock,
      context.secrets,
      context.digester,
      opened.store,
      opened.store
    );
    let releaseBrokerReadiness!: () => void;
    const brokerReadiness = new Promise<void>((resolve) => {
      releaseBrokerReadiness = resolve;
    });
    let signalFourBrokers!: () => void;
    const fourBrokersCreated = new Promise<void>((resolve) => {
      signalFourBrokers = resolve;
    });
    const brokerTimeouts: number[] = [];
    const closedSockets = new Set<string>();
    const coordinator = new LocalOwnerSessionCoordinator(
      "install-capacity",
      "https://forge.local/api",
      "501",
      "/private/forge-owner-broker",
      null,
      path.join(root, "sockets"),
      context.clock,
      assertions,
      authority,
      browserSessions,
      null,
      (brokerInput) => {
        brokerTimeouts.push(brokerInput.timeoutMilliseconds);
        if (brokerTimeouts.length === 4) {
          signalFourBrokers();
        }
        return {
          socketPath: brokerInput.socketPath,
          async authenticate(
            request: {
              requestId: string;
            },
            launchOwnerHelper: (input: {
              binaryPath: string;
              socketPath: string;
              request: unknown;
            }) => Promise<void>
          ) {
            await brokerReadiness;
            await launchOwnerHelper({
              binaryPath: brokerInput.binaryPath,
              socketPath: brokerInput.socketPath,
              request
            });
            return {
              requestId: request.requestId,
              peerUid: 501,
              verifiedAt: context.clock.now().toISOString()
            };
          },
          consume() {},
          close() {
            closedSockets.add(brokerInput.socketPath);
          }
        } as unknown as NativeOwnerBroker;
      }
    );
    const browserPublicKey: BrowserPublicKey = {
      kty: "EC",
      crv: "P-256",
      x: "A".repeat(43),
      y: "B".repeat(43),
      ext: true,
      key_ops: ["verify"]
    };
    const starts = Array.from({ length: 4 }, (_, index) =>
      coordinator.begin({
        browserOrigin: "http://127.0.0.1:3027",
        browserNonce: String(index).repeat(43),
        browserPublicKey
      })
    );
    await fourBrokersCreated;
    await assert.rejects(
      coordinator.begin({
        browserOrigin: "http://127.0.0.1:3027",
        browserNonce: "X".repeat(43),
        browserPublicKey
      }),
      /maximum number/
    );
    assert.equal(brokerTimeouts.length, 4);
    assert.deepEqual(brokerTimeouts, [5_000, 5_000, 5_000, 5_000]);
    coordinator.close();
    assert.equal(closedSockets.size, 4);
    releaseBrokerReadiness();
    const interruptedStarts = await Promise.allSettled(starts);
    assert.equal(
      interruptedStarts.every(
        (entry) =>
          entry.status === "rejected" &&
          entry.reason instanceof Error &&
          "code" in entry.reason &&
          entry.reason.code === "local_owner_coordinator_closed"
      ),
      true
    );
    assert.equal(closedSockets.size, 4);

    await coordinator.begin({
      browserOrigin: "http://127.0.0.1:3027",
      browserNonce: "R".repeat(43),
      browserPublicKey,
      approvalMode: "interactive"
    });
    assert.equal(brokerTimeouts.length, 5);
    assert.equal(brokerTimeouts.at(-1), 120_000);
    coordinator.close();
    assert.equal(closedSockets.size, 5);

    await coordinator.begin({
      browserOrigin: "http://127.0.0.1:3027",
      browserNonce: "S".repeat(43)
    });
    assert.equal(brokerTimeouts.length, 6);
    assert.equal(brokerTimeouts.at(-1), 15_000);
    coordinator.close();
    assert.equal(closedSockets.size, 6);
  } finally {
    opened.database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("persistent signing keys, sender-constrained access credentials, and DPoP survive restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-signing-"));
  const databasePath = path.join(root, "security.sqlite");
  const keyPath = path.join(root, "owner-keys", "signing.json");
  const context = foundation();
  let opened = openStore(databasePath, context);
  try {
    const client = await pairingKey();
    opened.store.registerClient({
      id: "client-1",
      ownerId: "owner-1",
      subjectId: "client-subject-1",
      installationId: "install-1",
      keyThumbprint: client.thumbprint,
      audience: "https://forge.local/api",
      profile: "trusted_personal_assistant",
      scopes: ["read", "write"]
    });
    opened.store.registerClient({
      id: "legacy-client-1",
      ownerId: "owner-1",
      subjectId: "legacy-subject-1",
      installationId: "legacy-install-1",
      keyThumbprint: "legacy-migration-key",
      audience: "https://forge.local/api",
      profile: "viewer",
      scopes: ["read"]
    });
    const keys = new FileSigningKeyProvider("https://forge.local", keyPath);
    await keys.initialize("key-1");
    const credentials = new AccessCredentialService(
      keys,
      context.clock,
      opened.store
    );
    const compatibilityBrowser = ownerBrowserSession({
      ownerId: "owner-1",
      context,
      store: opened.store
    });
    const migrations = new CompatibilityMigrationService(
      context.clock,
      compatibilityBrowser.browser,
      opened.store
    );
    const issued = await credentials.issue(principal(), {
      mode: "sender_constrained",
      confirmationJkt: client.thumbprint,
      tokenId: "access-token-1"
    });
    assert.equal(
      (
        await credentials.verify({
          token: issued.token,
          audience: "https://forge.local/api",
          requiredScopes: ["read"],
          requireSenderConstraint: true
        })
      ).cnf?.jkt,
      client.thumbprint
    );
    await assert.rejects(
      credentials.issue(principal({ scopes: ["read", "write", "operator"] }), {
        mode: "sender_constrained",
        confirmationJkt: client.thumbprint
      }),
      /exceeds the registered client grant/
    );
    await assert.rejects(
      credentials.issue(principal(), {
        mode: "sender_constrained",
        confirmationJkt: "attacker-key"
      }),
      /exceeds the registered client grant/
    );
    await assert.rejects(
      credentials.issue(principal({ installationId: "other-install" }), {
        mode: "sender_constrained",
        confirmationJkt: client.thumbprint
      }),
      /registered client grant/
    );
    await assert.rejects(
      credentials.issue(principal(), {
        mode: "compatibility_bearer",
        authorizationId: "compat_missing"
      }),
      /allowlisted, expiring, read-only legacy viewer/
    );
    for (const profile of ["executor", "operator"] as const) {
      await assert.rejects(
        credentials.issue(principal({ profile, kind: "paired_client" }), {
          mode: "compatibility_bearer",
          authorizationId: "compat_missing"
        }),
        /allowlisted, expiring, read-only legacy viewer/
      );
    }

    const legacyAuthorization = migrations.authorize({
      session: compatibilityBrowser.authenticate(),
      clientId: "legacy-client-1",
      scopes: ["read"],
      reason: "bounded migration receipt M-1",
      expiresAt: new Date(context.clock.now().getTime() + 90_000).toISOString()
    });
    const legacy = await credentials.issue(
      principal({
        kind: "legacy_agent_token",
        clientId: "legacy-client-1",
        installationId: "legacy-install-1",
        subjectId: "legacy-subject-1",
        profile: "viewer",
        scopes: ["read"]
      }),
      {
        mode: "compatibility_bearer",
        tokenId: "legacy-token-1",
        authorizationId: legacyAuthorization.id
      }
    );
    assert.equal(legacy.credentialMode, "compatibility_bearer");
    assert.ok(
      Date.parse(legacy.expiresAt) <= context.clock.now().getTime() + 90_000
    );
    await assert.rejects(
      credentials.issue(principal(), {
        mode: "compatibility_bearer",
        authorizationId: legacyAuthorization.id
      }),
      /allowlisted, expiring, read-only legacy viewer/
    );
    const expiringAuthorization = migrations.authorize({
      session: compatibilityBrowser.authenticate(),
      clientId: "legacy-client-1",
      scopes: ["read"],
      reason: "short migration validation",
      expiresAt: new Date(context.clock.now().getTime() + 1_000).toISOString()
    });
    context.clock.advance(2);
    await assert.rejects(
      credentials.issue(
        principal({
          kind: "legacy_agent_token",
          clientId: "legacy-client-1",
          installationId: "legacy-install-1",
          subjectId: "legacy-subject-1",
          profile: "viewer",
          scopes: ["read"]
        }),
        {
          mode: "compatibility_bearer",
          authorizationId: expiringAuthorization.id
        }
      ),
      /allowlisted, expiring, read-only legacy viewer/
    );
    await keys.rotate("key-2");
    const postRotation = await credentials.issue(principal(), {
      mode: "sender_constrained",
      confirmationJkt: client.thumbprint,
      tokenId: "access-token-2"
    });
    assert.equal(
      (
        await credentials.verify({
          token: issued.token,
          audience: "https://forge.local/api"
        })
      ).jti,
      "access-token-1"
    );
    assert.equal(
      (
        await credentials.verify({
          token: postRotation.token,
          audience: "https://forge.local/api"
        })
      ).jti,
      "access-token-2"
    );

    const targetUri = "https://forge.local/api/v1/context?ignored=query";
    const proof = await new SignJWT({
      htm: "GET",
      htu: "https://forge.local/api/v1/context",
      ath: createHash("sha256")
        .update(issued.token, "ascii")
        .digest("base64url"),
      nonce: "server-nonce-1"
    })
      .setProtectedHeader({
        alg: "ES256",
        typ: "dpop+jwt",
        jwk: client.publicJwk
      })
      .setJti("proof-1")
      .setIssuedAt(Math.floor(context.clock.now().getTime() / 1000))
      .sign(client.pair.privateKey);
    const dpop = new DpopVerifier(context.clock, opened.store);
    await dpop.verify({
      proof,
      accessToken: issued.token,
      expectedMethod: "GET",
      expectedTargetUri: targetUri,
      expectedKeyThumbprint: client.thumbprint,
      expectedNonce: "server-nonce-1"
    });
    await assert.rejects(
      dpop.verify({
        proof,
        accessToken: issued.token,
        expectedMethod: "GET",
        expectedTargetUri: targetUri,
        expectedKeyThumbprint: client.thumbprint,
        expectedNonce: "server-nonce-1"
      }),
      /replayed/
    );
    opened.database.close();

    opened = openStore(databasePath, context);
    const restartedKeys = new FileSigningKeyProvider(
      "https://forge.local",
      keyPath
    );
    await restartedKeys.initialize();
    assert.equal((await restartedKeys.publicJwks()).keys.length, 2);
    assert.equal(
      (
        await new AccessCredentialService(
          restartedKeys,
          context.clock,
          opened.store
        ).verify({
          token: issued.token,
          audience: "https://forge.local/api"
        })
      ).jti,
      "access-token-1"
    );
    const restartedCredentials = new AccessCredentialService(
      restartedKeys,
      context.clock,
      opened.store
    );
    assert.equal(
      (
        await restartedCredentials.verify({
          token: legacy.token,
          audience: "https://forge.local/api"
        })
      ).compatibility_authorization_id,
      legacyAuthorization.id
    );
    const restartedCompatibilityBrowser = ownerBrowserSession({
      ownerId: "owner-1",
      context,
      store: opened.store
    });
    const restartedMigrations = new CompatibilityMigrationService(
      context.clock,
      restartedCompatibilityBrowser.browser,
      opened.store
    );
    assert.equal(
      restartedMigrations.revoke({
        session: restartedCompatibilityBrowser.authenticate(),
        authorizationId: legacyAuthorization.id,
        reason: "migration completed"
      }),
      true
    );
    await assert.rejects(
      restartedCredentials.verify({
        token: legacy.token,
        audience: "https://forge.local/api"
      }),
      /revoked or stale/
    );
    assert.equal((await stat(keyPath)).mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(keyPath))).mode & 0o777, 0o700);
  } finally {
    opened.database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("signing-key rotation has a bounded overlap and ignores interrupted temporary state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-key-overlap-"));
  const keyPath = path.join(root, "keys", "signing.json");
  const context = foundation();
  try {
    let keys = new FileSigningKeyProvider("https://forge.local", keyPath, 2);
    await keys.initialize("overlap-old");
    const issuedAt = Math.floor(context.clock.now().getTime() / 1_000);
    const oldToken = await keys.sign({
      audience: "https://forge.local/api",
      subject: "owner",
      tokenId: "overlap-old-token",
      issuedAtSeconds: issuedAt,
      expiresAtSeconds: issuedAt + 60,
      claims: { purpose: "overlap-test" }
    });
    const interruptedPath = `${keyPath}.interrupted.new`;
    await writeFile(interruptedPath, "incomplete", {
      mode: 0o600,
      flag: "wx"
    });
    await keys.rotate("overlap-new", context.clock.now());
    assert.equal(
      (
        await keys.verify(oldToken, {
          audience: "https://forge.local/api",
          nowSeconds: issuedAt
        })
      ).payload.jti,
      "overlap-old-token"
    );
    const newToken = await keys.sign({
      audience: "https://forge.local/api",
      subject: "owner",
      tokenId: "overlap-new-token",
      issuedAtSeconds: issuedAt,
      expiresAtSeconds: issuedAt + 60,
      claims: { purpose: "overlap-test" }
    });
    context.clock.advance(3);
    const afterOverlap = Math.floor(context.clock.now().getTime() / 1_000);
    await assert.rejects(
      keys.verify(oldToken, {
        audience: "https://forge.local/api",
        nowSeconds: afterOverlap
      }),
      /unknown signing key/
    );
    assert.equal(
      (
        await keys.verify(newToken, {
          audience: "https://forge.local/api",
          nowSeconds: afterOverlap
        })
      ).payload.jti,
      "overlap-new-token"
    );

    keys = new FileSigningKeyProvider("https://forge.local", keyPath, 2);
    await keys.initialize();
    await assert.rejects(
      keys.verify(oldToken, {
        audience: "https://forge.local/api",
        nowSeconds: afterOverlap
      }),
      /unknown signing key/
    );
    assert.equal(
      (
        await keys.verify(newToken, {
          audience: "https://forge.local/api",
          nowSeconds: afterOverlap
        })
      ).payload.jti,
      "overlap-new-token"
    );
    assert.equal(await readFile(interruptedPath, "utf8"), "incomplete");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pairing is persistent, client-key proven, rate-isolated, cancellable, race-safe, and plaintext-free", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-pairing-"));
  const databasePath = path.join(root, "security.sqlite");
  const context = foundation();
  const client = await pairingKey();
  const wrongClient = await pairingKey();
  let opened = openStore(databasePath, context);
  const buildServices = () => {
    const networkPartitions = new PairingNetworkPartitionAuthority<string>(
      (serverObservation) => serverObservation
    );
    const ownerBrowser = ownerBrowserSession({
      ownerId: "owner-1",
      context,
      store: opened.store
    });
    const ownerAuthorizations = pairingOwnerAuthorizations({
      context,
      store: opened.store,
      browser: ownerBrowser.browser,
      networkPartitions
    });
    return {
      networkPartitions,
      ownerBrowser,
      ownerAuthorizations,
      service: new PairingService(
        context.clock,
        context.secrets,
        context.digester,
        opened.store,
        new PairingClientProofVerifier(context.clock, opened.store),
        ownerAuthorizations,
        networkPartitions,
        "https://forge.local/forge/pair"
      )
    };
  };
  try {
    opened.store.ensureOwner("owner-1");
    let services = buildServices();
    let service = services.service;
    const forgedNetworkPartition = {
      material: "attacker-selected-rate-key"
    } as Parameters<typeof service.begin>[0]["networkPartition"];
    assert.throws(
      () =>
        service.begin({
          ownerId: "owner-1",
          networkPartition: forgedNetworkPartition,
          installationId: "forged-network-install",
          clientName: "Forged network client",
          clientKeyThumbprint: client.thumbprint,
          audience: "https://forge.local/api",
          requestedScopes: ["read"],
          requestedProfile: "viewer"
        }),
      /network partition is forged/
    );
    assert.throws(
      () =>
        service.begin({
          ownerId: "owner-1",
          networkPartition: services.networkPartitions.observe(
            "tailscale:wrong-audience"
          ),
          installationId: "wrong-audience-install",
          clientName: "Wrong audience client",
          clientKeyThumbprint: client.thumbprint,
          audience: "https://attacker.example/api",
          requestedScopes: ["read"],
          requestedProfile: "viewer"
        }),
      /audience does not match/
    );
    const started = service.begin({
      ownerId: "owner-1",
      networkPartition: services.networkPartitions.observe(
        "tailscale:device-hermes"
      ),
      installationId: "install-1",
      clientName: "Hermes",
      clientKeyThumbprint: client.thumbprint,
      audience: "https://forge.local/api",
      requestedScopes: ["read", "write"],
      requestedProfile: "trusted_personal_assistant"
    });
    assert.match(
      started.userCode,
      /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/
    );
    opened.database.close();
    opened = openStore(databasePath, context);
    services = buildServices();
    service = services.service;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.throws(
        () =>
          services.ownerAuthorizations.authorizeApproval({
            session: services.ownerBrowser.authenticate(),
            userCode: "BBBB-BBBB",
            networkPartition: services.networkPartitions.observe("network-a"),
            scopes: ["read"],
            profile: "trusted_personal_assistant"
          }),
        /invalid/
      );
    }
    assert.throws(
      () =>
        services.ownerAuthorizations.authorizeApproval({
          session: services.ownerBrowser.authenticate(),
          userCode: started.userCode,
          networkPartition: services.networkPartitions.observe("network-a"),
          scopes: ["read"],
          profile: "trusted_personal_assistant"
        }),
      /rate limited/
    );
    assert.throws(
      () =>
        services.ownerAuthorizations.authorizeApproval({
          session: services.ownerBrowser.authenticate(),
          userCode: started.userCode,
          networkPartition: services.networkPartitions.observe("network-b"),
          scopes: ["read", "write", "operator"],
          profile: "trusted_personal_assistant"
        }),
      /cannot expand/
    );
    service.approve({
      authorization: services.ownerAuthorizations.authorizeApproval({
        session: services.ownerBrowser.authenticate(),
        userCode: started.userCode,
        networkPartition: services.networkPartitions.observe("network-b"),
        scopes: ["read"],
        profile: "trusted_personal_assistant"
      })
    });

    await assert.rejects(
      service.poll({
        deviceCode: started.deviceCode,
        networkPartition:
          services.networkPartitions.observe("poll-wrong-client"),
        clientProof: await pairingProof({
          privateKey: wrongClient.pair.privateKey,
          publicJwk: wrongClient.publicJwk,
          requestId: started.requestId,
          operation: "poll",
          tokenId: "wrong-key-proof",
          clock: context.clock
        })
      }),
      /wrong key/
    );
    await assert.rejects(
      service.poll({
        deviceCode: started.deviceCode,
        networkPartition: {
          material: "caller-selected-poll-key"
        } as Parameters<typeof service.poll>[0]["networkPartition"],
        clientProof: "not-evaluated"
      }),
      /network partition is forged/
    );
    context.clock.advance(10);
    const pollInputs = await Promise.all(
      ["race-proof-1", "race-proof-2"].map(async (tokenId) => ({
        deviceCode: started.deviceCode,
        networkPartition:
          services.networkPartitions.observe("poll-race-network"),
        clientProof: await pairingProof({
          privateKey: client.pair.privateKey,
          publicJwk: client.publicJwk,
          requestId: started.requestId,
          operation: "poll",
          tokenId,
          clock: context.clock
        })
      }))
    );
    const raced = await Promise.all(
      pollInputs.map((input) => service.poll(input))
    );
    assert.deepEqual(raced.map((result) => result.status).sort(), [
      "approved",
      "expired_token"
    ]);
    const approvedRace = raced.find((result) => result.status === "approved");
    assert.equal(
      approvedRace?.status === "approved"
        ? approvedRace.grant.installationId
        : null,
      "install-1"
    );

    const cancellable = service.begin({
      ownerId: "owner-1",
      networkPartition: services.networkPartitions.observe(
        "internet:203.0.113.4"
      ),
      installationId: "install-2",
      clientName: "OpenClaw",
      clientKeyThumbprint: client.thumbprint,
      audience: "https://forge.local/api",
      requestedScopes: ["read"],
      requestedProfile: "viewer"
    });
    const cancelProof = await pairingProof({
      privateKey: client.pair.privateKey,
      publicJwk: client.publicJwk,
      requestId: cancellable.requestId,
      operation: "cancel",
      tokenId: "cancel-proof-1",
      clock: context.clock
    });
    assert.equal(
      await service.cancel({
        deviceCode: cancellable.deviceCode,
        clientProof: cancelProof
      }),
      true
    );
    await assert.rejects(
      service.cancel({
        deviceCode: cancellable.deviceCode,
        clientProof: cancelProof
      }),
      /replayed/
    );
    assert.equal(
      (
        await service.poll({
          deviceCode: cancellable.deviceCode,
          networkPartition: services.networkPartitions.observe(
            "poll-cancelled-network"
          ),
          clientProof: await pairingProof({
            privateKey: client.pair.privateKey,
            publicJwk: client.publicJwk,
            requestId: cancellable.requestId,
            operation: "poll",
            tokenId: "cancelled-poll-1",
            clock: context.clock
          })
        })
      ).status,
      "expired_token"
    );

    const deniedPairing = service.begin({
      ownerId: "owner-1",
      networkPartition: services.networkPartitions.observe(
        "tailscale:denied-device"
      ),
      installationId: "denied-install",
      clientName: "Denied client",
      clientKeyThumbprint: client.thumbprint,
      audience: "https://forge.local/api",
      requestedScopes: ["read"],
      requestedProfile: "viewer"
    });
    const denial = services.ownerAuthorizations.authorizeDenial({
      session: services.ownerBrowser.authenticate(),
      userCode: deniedPairing.userCode,
      networkPartition: services.networkPartitions.observe(
        "owner-denial-network"
      )
    });
    service.deny({ authorization: denial });
    assert.throws(
      () => service.deny({ authorization: denial }),
      /forged, replayed/
    );
    context.clock.advance(5);
    assert.equal(
      (
        await service.poll({
          deviceCode: deniedPairing.deviceCode,
          networkPartition: services.networkPartitions.observe(
            "poll-denied-network"
          ),
          clientProof: await pairingProof({
            privateKey: client.pair.privateKey,
            publicJwk: client.publicJwk,
            requestId: deniedPairing.requestId,
            operation: "poll",
            tokenId: "denied-poll-1",
            clock: context.clock
          })
        })
      ).status,
      "access_denied"
    );

    const expiringPairing = service.begin({
      ownerId: "owner-1",
      networkPartition: services.networkPartitions.observe(
        "tailscale:device-claude"
      ),
      installationId: "expiring-install",
      clientName: "Claude",
      clientKeyThumbprint: client.thumbprint,
      audience: "https://forge.local/api",
      requestedScopes: ["read"],
      requestedProfile: "viewer"
    });
    context.clock.advance(601);
    assert.equal(
      (
        await service.poll({
          deviceCode: expiringPairing.deviceCode,
          networkPartition: services.networkPartitions.observe(
            "poll-expired-network"
          ),
          clientProof: await pairingProof({
            privateKey: client.pair.privateKey,
            publicJwk: client.publicJwk,
            requestId: expiringPairing.requestId,
            operation: "poll",
            tokenId: "expired-poll-1",
            clock: context.clock
          })
        })
      ).status,
      "expired_token"
    );

    for (let index = 0; index < 3; index += 1) {
      service.begin({
        ownerId: "owner-1",
        networkPartition: services.networkPartitions.observe(
          "tailscale:bounded-device"
        ),
        installationId: "bounded-install",
        clientName: `Client ${index}`,
        clientKeyThumbprint: client.thumbprint,
        audience: "https://forge.local/api",
        requestedScopes: ["read"],
        requestedProfile: "viewer"
      });
    }
    assert.throws(
      () =>
        service.begin({
          ownerId: "owner-1",
          networkPartition: services.networkPartitions.observe(
            "tailscale:bounded-device"
          ),
          installationId: "bounded-install",
          clientName: "Fourth client",
          clientKeyThumbprint: client.thumbprint,
          audience: "https://forge.local/api",
          requestedScopes: ["read"],
          requestedProfile: "viewer"
        }),
      /pending-request cap/
    );

    const serializedRows = JSON.stringify(
      opened.database
        .prepare(`SELECT * FROM security_pairing_requests ORDER BY id`)
        .all()
    );
    assert.equal(serializedRows.includes(started.deviceCode), false);
    assert.equal(serializedRows.includes(started.userCode), false);
    const rateNow = context.clock.now().toISOString();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      assert.equal(
        opened.store.claimPairingPollNetworkAttempt({
          bucketKey: "test-poll-network-bucket",
          now: rateNow,
          windowSeconds: 60,
          maximumAttempts: 2
        }),
        true
      );
      assert.equal(
        opened.store.claimPairingPollClientAttempt({
          installationBucketKey: "test-poll-install-bucket",
          clientBucketKey: "test-poll-client-bucket",
          now: rateNow,
          windowSeconds: 60,
          maximumInstallationAttempts: 2,
          maximumClientAttempts: 2
        }),
        true
      );
    }
    assert.equal(
      opened.store.claimPairingPollNetworkAttempt({
        bucketKey: "test-poll-network-bucket",
        now: rateNow,
        windowSeconds: 60,
        maximumAttempts: 2
      }),
      false
    );
    assert.equal(
      opened.store.claimPairingPollClientAttempt({
        installationBucketKey: "test-poll-install-bucket",
        clientBucketKey: "test-poll-client-bucket",
        now: rateNow,
        windowSeconds: 60,
        maximumInstallationAttempts: 2,
        maximumClientAttempts: 2
      }),
      false
    );
  } finally {
    opened.database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("refresh reuse atomically advances the authoritative client epoch and invalidates access after restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-refresh-"));
  const databasePath = path.join(root, "security.sqlite");
  const context = foundation();
  let opened = openStore(databasePath, context);
  try {
    opened.store.registerClient({
      id: "client-1",
      ownerId: "owner-1",
      subjectId: "client-subject-1",
      installationId: "install-1",
      keyThumbprint: "jkt-1",
      audience: "https://forge.local/api",
      profile: "trusted_personal_assistant",
      scopes: ["read"]
    });
    const refresh = new RefreshFamilyService(opened.store);
    assert.throws(
      () =>
        refresh.issue({
          clientId: "client-1",
          ownerId: "owner-1",
          installationId: "install-1",
          audience: "https://forge.local/api",
          profile: "trusted_personal_assistant",
          keyThumbprint: "jkt-1",
          scopes: ["read", "operator"],
          ownerSecurityEpoch: 1,
          clientSecurityEpoch: 1
        }),
      /current active client/
    );
    assert.throws(
      () =>
        refresh.issue({
          clientId: "client-1",
          ownerId: "owner-1",
          installationId: "attacker-install",
          audience: "https://forge.local/api",
          profile: "trusted_personal_assistant",
          keyThumbprint: "jkt-1",
          scopes: ["read"],
          ownerSecurityEpoch: 1,
          clientSecurityEpoch: 1
        }),
      /current active client/
    );
    const issued = refresh.issue({
      clientId: "client-1",
      ownerId: "owner-1",
      installationId: "install-1",
      audience: "https://forge.local/api",
      profile: "trusted_personal_assistant",
      keyThumbprint: "jkt-1",
      scopes: ["read"],
      ownerSecurityEpoch: 1,
      clientSecurityEpoch: 1
    });
    assert.equal(
      refresh.rotate({
        refreshToken: issued.refreshToken,
        clientId: "client-1",
        installationId: "attacker-install",
        keyThumbprint: "jkt-1",
        audience: "https://forge.local/api"
      }).status,
      "invalid"
    );
    assert.throws(
      () =>
        refresh.rotate({
          refreshToken: issued.refreshToken,
          clientId: "client-1",
          installationId: "install-1",
          keyThumbprint: "jkt-1",
          audience: "https://forge.local/api",
          afterMarkUsed: () => {
            throw new Error("simulated interruption");
          }
        }),
      /simulated interruption/
    );
    const rotated = refresh.rotate({
      refreshToken: issued.refreshToken,
      clientId: "client-1",
      installationId: "install-1",
      keyThumbprint: "jkt-1",
      audience: "https://forge.local/api"
    });
    assert.equal(rotated.status, "rotated");

    const keys = new InMemorySigningKeyProvider("https://forge.local");
    await keys.initialize();
    const access = new AccessCredentialService(
      keys,
      context.clock,
      opened.store
    );
    const token = await access.issue(principal({ scopes: ["read"] }), {
      mode: "sender_constrained",
      confirmationJkt: "jkt-1",
      tokenId: "pre-reuse-access"
    });
    assert.equal(
      refresh.rotate({
        refreshToken: issued.refreshToken,
        clientId: "client-1",
        installationId: "install-1",
        keyThumbprint: "jkt-1",
        audience: "https://forge.local/api"
      }).status,
      "reuse_detected"
    );
    assert.equal(opened.store.readClient("client-1")?.clientSecurityEpoch, 2);
    await assert.rejects(
      access.verify({
        token: token.token,
        audience: "https://forge.local/api"
      }),
      /revoked or stale/
    );
    opened.database.close();
    opened = openStore(databasePath, context);
    assert.equal(opened.store.readClient("client-1")?.revokedAt !== null, true);
    if (rotated.status === "rotated") {
      assert.equal(
        new RefreshFamilyService(opened.store).rotate({
          refreshToken: rotated.refreshToken,
          clientId: "client-1",
          installationId: "install-1",
          keyThumbprint: "jkt-1",
          audience: "https://forge.local/api"
        }).status,
        "expired"
      );
    }
  } finally {
    opened.database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("independent SQLite processes serialize refresh reuse and pairing consumption", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-process-race-"));
  const databasePath = path.join(root, "security.sqlite");
  const context = foundation();
  let opened = openStore(databasePath, context);
  try {
    opened.store.registerClient({
      id: "race-client",
      ownerId: "race-owner",
      subjectId: "race-subject",
      installationId: "race-install",
      keyThumbprint: "race-jkt",
      audience: "https://forge.local/api",
      profile: "trusted_personal_assistant",
      scopes: ["read"]
    });
    const issued = new RefreshFamilyService(opened.store).issue({
      clientId: "race-client",
      ownerId: "race-owner",
      installationId: "race-install",
      audience: "https://forge.local/api",
      profile: "trusted_personal_assistant",
      keyThumbprint: "race-jkt",
      scopes: ["read"],
      ownerSecurityEpoch: 1,
      clientSecurityEpoch: 1
    });
    opened.database.close();

    const refreshInput = {
      refreshToken: issued.refreshToken,
      clientId: "race-client",
      installationId: "race-install",
      keyThumbprint: "race-jkt",
      audience: "https://forge.local/api"
    };
    const refreshWorkers = [0, 1].map(() =>
      createSqliteRaceWorker({
        databasePath,
        now: context.clock.now().toISOString(),
        operation: "rotate_refresh",
        payload: refreshInput
      })
    );
    refreshWorkers.forEach((worker) => worker.start());
    const refreshResults = (await Promise.all(
      refreshWorkers.map((worker) => worker.result)
    )) as Array<{ status: string }>;
    assert.deepEqual(refreshResults.map((result) => result.status).sort(), [
      "reuse_detected",
      "rotated"
    ]);

    opened = openStore(databasePath, context);
    assert.equal(
      opened.store.readClient("race-client")?.revokedAt !== null,
      true
    );
    const now = context.clock.now().toISOString();
    assert.equal(
      opened.store.createPairingRequestWithCaps({
        record: {
          id: "pair_process_race",
          ownerId: "race-owner",
          ownerSecurityEpoch: 1,
          installationId: "race-install",
          clientName: "Race client",
          clientType: "api",
          clientKeyThumbprint: "race-jkt",
          audience: "https://forge.local/api",
          requestedScopes: ["read"],
          requestedProfile: "viewer",
          deviceDigest: "race-device-digest",
          userCodeDigest: "race-user-code-digest",
          status: "pending",
          createdAt: now,
          updatedAt: now,
          expiresAt: new Date(
            context.clock.now().getTime() + 60_000
          ).toISOString(),
          pollIntervalSeconds: 5,
          nextPollAt: now,
          approval: null
        },
        maximumPendingPerInstallation: 3,
        maximumPendingPerOwner: 25,
        maximumPendingGlobally: 1_000,
        admissionNetworkBucketKey: "race-network-bucket",
        admissionInstallationBucketKey: "race-install-bucket",
        admissionWindowSeconds: 60,
        maximumAdmissionAttempts: 10
      }),
      true
    );
    assert.equal(
      opened.store.transitionPairingRequest({
        id: "pair_process_race",
        fromStatuses: ["pending"],
        toStatus: "approved",
        now
      }),
      true
    );
    opened.database.close();

    const pairingInput = {
      id: "pair_process_race",
      fromStatuses: ["approved"],
      toStatus: "consumed",
      now
    };
    const pairingWorkers = [0, 1].map(() =>
      createSqliteRaceWorker({
        databasePath,
        now,
        operation: "consume_pairing",
        payload: pairingInput
      })
    );
    pairingWorkers.forEach((worker) => worker.start());
    assert.deepEqual(
      (await Promise.all(pairingWorkers.map((worker) => worker.result))).sort(),
      [false, true]
    );
    opened = openStore(databasePath, context);
    assert.equal(
      opened.store.readPairingRequest("pair_process_race")?.status,
      "consumed"
    );
  } finally {
    try {
      opened.database.close();
    } catch {
      // The parent connection is deliberately closed while child processes race.
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("browser sessions persist across restart while CSRF, rotation, idle, and owner epoch remain enforced", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-browser-session-"));
  const databasePath = path.join(root, "security.sqlite");
  const context = foundation();
  let opened = openStore(databasePath, context);
  const buildService = () =>
    new BrowserSessionService(
      context.clock,
      context.secrets,
      context.digester,
      opened.store,
      opened.store,
      60,
      600
    );
  try {
    opened.store.ensureOwner("owner-1");
    let service = buildService();
    const created = service.create(
      principal({
        kind: "operator_session",
        subjectId: "owner-1",
        clientId: null,
        installationId: null,
        clientSecurityEpoch: null,
        profile: "operator"
      })
    );
    opened.database.close();
    opened = openStore(databasePath, context);
    service = buildService();
    assert.throws(
      () =>
        service.authenticate({
          sessionToken: created.sessionToken,
          unsafeMethod: true
        }),
      /CSRF/
    );
    assert.ok(
      service.authenticate({
        sessionToken: created.sessionToken,
        csrfToken: created.csrfToken,
        unsafeMethod: true
      })
    );
    const rotated = service.rotate(created.sessionToken);
    assert.ok(rotated);
    assert.equal(
      service.authenticate({
        sessionToken: created.sessionToken,
        unsafeMethod: false
      }),
      null
    );
    context.clock.advance(61);
    assert.equal(
      service.authenticate({
        sessionToken: rotated!.sessionToken,
        unsafeMethod: false
      }),
      null
    );
  } finally {
    opened.database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("browser, passkey summary, pairing, local exchange, refresh, client, and access state share owner recovery epoch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-owner-recovery-"));
  const databasePath = path.join(root, "security.sqlite");
  const context = foundation();
  let opened = openStore(databasePath, context);
  const ownerChannel = new OwnerChannelAuthority(context.clock, "501");
  const origin = "https://forge.example.ts.net";
  const rpId = "forge.example.ts.net";
  const webAuthn = new OwnerWebAuthnAuthority<string>(
    context.clock,
    async (credentialId) => ({
      ownerUserId: "501",
      origin,
      credential: {
        id: `row-${credentialId}`,
        ownerUserId: "501",
        rpId,
        credentialId,
        publicKeyBase64: Buffer.from([1]).toString("base64"),
        counter: 1,
        transports: ["internal"],
        label: credentialId,
        deviceType: "singleDevice",
        backedUp: false,
        aaguid: "00000000-0000-0000-0000-000000000000",
        createdAt: context.clock.now().toISOString(),
        lastUsedAt: context.clock.now().toISOString()
      }
    })
  );
  try {
    opened.store.ensureOwner("501");
    const stepUp = new OwnerStepUpService(
      context.clock,
      ownerChannel,
      webAuthn,
      opened.store,
      origin,
      rpId
    );
    const forgedWebAuthn = {
      ownerUserId: "501",
      credentialId: "forged",
      origin,
      relyingPartyId: rpId,
      purpose: "privileged_pairing",
      verifiedAt: context.clock.now().toISOString()
    } as Awaited<ReturnType<typeof webAuthn.verify>>;
    assert.throws(
      () =>
        webAuthn.consume(forgedWebAuthn, {
          ownerUserId: "501",
          origin,
          relyingPartyId: rpId,
          purpose: "privileged_pairing"
        }),
      /forged/
    );

    const enrolled = stepUp.enroll({
      ownerEvidence: await platformOwnerEvidence(ownerChannel, context.clock),
      webAuthnEvidence: await webAuthn.verify(
        "owner_authenticator_enrollment",
        "passkey-1"
      ),
      label: "Mac passkey"
    });
    assert.equal(enrolled.ownerSecurityEpoch, 1);
    const pairingEvidence = await webAuthn.verify(
      "privileged_pairing",
      "passkey-1"
    );
    const preliminaryPairingAuthorization = stepUp.authorizePrivilegedPairing({
      webAuthnEvidence: pairingEvidence,
      expectedOwnerSecurityEpoch: 1,
      requestId: "pair_1234567890123456"
    });
    assert.equal(preliminaryPairingAuthorization.ownerUserId, "501");
    assert.throws(
      () =>
        stepUp.authorizePrivilegedPairing({
          webAuthnEvidence: pairingEvidence,
          expectedOwnerSecurityEpoch: 1,
          requestId: "pair_1234567890123456"
        }),
      /replayed/
    );

    opened.store.registerClient({
      id: "client-501",
      ownerId: "501",
      subjectId: "subject-501",
      installationId: "install-501",
      keyThumbprint: "jkt-501",
      audience: "https://forge.local/api",
      profile: "trusted_personal_assistant",
      scopes: ["read"]
    });
    const clientPrincipal = principal({
      ownerId: "501",
      clientId: "client-501",
      subjectId: "subject-501",
      installationId: "install-501",
      scopes: ["read"]
    });
    const keys = new InMemorySigningKeyProvider("https://forge.local");
    await keys.initialize();
    const accessService = new AccessCredentialService(
      keys,
      context.clock,
      opened.store
    );
    const access = await accessService.issue(clientPrincipal, {
      mode: "sender_constrained",
      confirmationJkt: "jkt-501"
    });
    const refresh = new RefreshFamilyService(opened.store).issue({
      clientId: "client-501",
      ownerId: "501",
      installationId: "install-501",
      audience: "https://forge.local/api",
      profile: "trusted_personal_assistant",
      keyThumbprint: "jkt-501",
      scopes: ["read"],
      ownerSecurityEpoch: 1,
      clientSecurityEpoch: 1
    });
    const browser = new BrowserSessionService(
      context.clock,
      context.secrets,
      context.digester,
      opened.store,
      opened.store,
      60,
      600
    );
    const browserSession = browser.create(
      principal({
        kind: "operator_session",
        ownerId: "501",
        subjectId: "owner-501",
        clientId: null,
        installationId: null,
        clientSecurityEpoch: null,
        profile: "operator"
      })
    );
    assert.throws(
      () =>
        browser.authenticate({
          sessionToken: browserSession.sessionToken,
          unsafeMethod: true
        }),
      /CSRF/
    );
    assert.ok(
      browser.authenticate({
        sessionToken: browserSession.sessionToken,
        csrfToken: browserSession.csrfToken,
        unsafeMethod: true
      })
    );

    const pairingClient = await pairingKey();
    const recoveryNetworkPartitions =
      new PairingNetworkPartitionAuthority<string>(
        (serverObservation) => serverObservation
      );
    const recoveryPairingAuthorizations = new PairingOwnerAuthorizationService(
      context.clock,
      context.digester,
      opened.store,
      browser,
      stepUp,
      recoveryNetworkPartitions
    );
    const pairingService = new PairingService(
      context.clock,
      context.secrets,
      context.digester,
      opened.store,
      new PairingClientProofVerifier(context.clock, opened.store),
      recoveryPairingAuthorizations,
      recoveryNetworkPartitions,
      "https://forge.local/forge/pair"
    );
    const elevatedPairing = pairingService.begin({
      ownerId: "501",
      networkPartition: recoveryNetworkPartitions.observe(
        "tailscale:elevated-codex"
      ),
      installationId: "install-elevated-recovery",
      clientName: "Codex executor",
      clientKeyThumbprint: pairingClient.thumbprint,
      audience: "https://forge.local/api",
      requestedScopes: ["read", "machine.exec"],
      requestedProfile: "executor"
    });
    const privilegedPairingAuthorization = stepUp.authorizePrivilegedPairing({
      webAuthnEvidence: await webAuthn.verify(
        "privileged_pairing",
        "passkey-1"
      ),
      expectedOwnerSecurityEpoch: 1,
      requestId: elevatedPairing.requestId
    });
    const insufficientSession = browser.authenticate({
      sessionToken: browserSession.sessionToken,
      csrfToken: browserSession.csrfToken,
      unsafeMethod: true
    });
    assert.ok(insufficientSession);
    assert.throws(
      () =>
        recoveryPairingAuthorizations.authorizeApproval({
          session: insufficientSession,
          userCode: elevatedPairing.userCode,
          networkPartition: recoveryNetworkPartitions.observe(
            "owner-elevated-missing-step-up"
          ),
          scopes: ["read", "machine.exec"],
          profile: "executor"
        }),
      /requires current owner step-up/
    );
    const mismatchedStepUpSession = browser.authenticate({
      sessionToken: browserSession.sessionToken,
      csrfToken: browserSession.csrfToken,
      unsafeMethod: true
    });
    assert.ok(mismatchedStepUpSession);
    assert.throws(
      () =>
        recoveryPairingAuthorizations.authorizeApproval({
          session: mismatchedStepUpSession,
          userCode: elevatedPairing.userCode,
          networkPartition: recoveryNetworkPartitions.observe(
            "owner-elevated-wrong-step-up"
          ),
          scopes: ["read", "machine.exec"],
          profile: "executor",
          privilegedAuthorization: preliminaryPairingAuthorization
        }),
      /forged, replayed, or stale/
    );
    const elevatedSession = browser.authenticate({
      sessionToken: browserSession.sessionToken,
      csrfToken: browserSession.csrfToken,
      unsafeMethod: true
    });
    assert.ok(elevatedSession);
    pairingService.approve({
      authorization: recoveryPairingAuthorizations.authorizeApproval({
        session: elevatedSession,
        userCode: elevatedPairing.userCode,
        networkPartition: recoveryNetworkPartitions.observe(
          "owner-elevated-step-up"
        ),
        scopes: ["read", "machine.exec"],
        profile: "executor",
        privilegedAuthorization: privilegedPairingAuthorization
      })
    });
    const pendingPairing = pairingService.begin({
      ownerId: "501",
      networkPartition: recoveryNetworkPartitions.observe(
        "tailscale:device-codex"
      ),
      installationId: "install-recovery",
      clientName: "Codex",
      clientKeyThumbprint: pairingClient.thumbprint,
      audience: "https://forge.local/api",
      requestedScopes: ["read"],
      requestedProfile: "viewer"
    });
    const recoveryOwnerSession = browser.authenticate({
      sessionToken: browserSession.sessionToken,
      csrfToken: browserSession.csrfToken,
      unsafeMethod: true
    });
    assert.ok(recoveryOwnerSession);
    pairingService.approve({
      authorization: recoveryPairingAuthorizations.authorizeApproval({
        session: recoveryOwnerSession,
        userCode: pendingPairing.userCode,
        networkPartition: recoveryNetworkPartitions.observe("owner-recovery"),
        scopes: ["read"],
        profile: "viewer"
      })
    });

    const localService = new LocalOwnerAssertionService(
      keys,
      context.clock,
      context.digester,
      opened.store,
      ownerChannel,
      "forge-local-exchange"
    );
    const local = localService.begin({
      installId: "local-recovery",
      browserOrigin: "http://127.0.0.1:3027",
      browserNonce: "C".repeat(43)
    });
    const localAssertion = await localService.mintFromOwnerChannel({
      transactionId: local.transactionId,
      evidence: await platformOwnerEvidence(ownerChannel, context.clock)
    });

    const replacement = stepUp.replaceLostAuthenticator({
      ownerEvidence: await platformOwnerEvidence(ownerChannel, context.clock),
      webAuthnEvidence: await webAuthn.verify("owner_recovery", "passkey-2"),
      lostCredentialIds: ["passkey-1"],
      replacementLabel: "Replacement passkey"
    });
    assert.equal(replacement.ownerSecurityEpoch, 2);
    await assert.rejects(
      accessService.verify({
        token: access.token,
        audience: "https://forge.local/api"
      }),
      /revoked or stale/
    );
    assert.equal(
      new RefreshFamilyService(opened.store).rotate({
        refreshToken: refresh.refreshToken,
        clientId: "client-501",
        installationId: "install-501",
        keyThumbprint: "jkt-501",
        audience: "https://forge.local/api"
      }).status,
      "expired"
    );
    assert.equal(
      browser.authenticate({
        sessionToken: browserSession.sessionToken,
        unsafeMethod: false
      }),
      null
    );
    assert.equal(
      opened.store.findPairingByDeviceDigest(
        context.digester.digest("device-code", pendingPairing.deviceCode)
      )?.status,
      "cancelled"
    );
    assert.equal(
      opened.store.findPairingByDeviceDigest(
        context.digester.digest("device-code", elevatedPairing.deviceCode)
      )?.status,
      "cancelled"
    );
    await assert.rejects(
      localService.exchange({
        assertion: localAssertion,
        installId: "local-recovery",
        browserOrigin: "http://127.0.0.1:3027",
        browserNonce: "C".repeat(43)
      }),
      /binding/
    );
    assert.equal(
      opened.store
        .listOwnerAuthenticators("501")
        .filter((entry) => !entry.revokedAt).length,
      1
    );
    opened.database.close();
    opened = openStore(databasePath, context);
    assert.equal(opened.store.readOwnerSecurityEpoch("501"), 2);
    assert.deepEqual(
      opened.store
        .listOwnerAuthenticators("501")
        .filter((entry) => !entry.revokedAt)
        .map((entry) => entry.credentialId),
      ["passkey-2"]
    );
  } finally {
    opened.database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("security audit detail redacts credentials and structured bodies", () => {
  const sentinel = "forge synthetic audit secret 123456";
  assert.deepEqual(
    redactSecurityAuditDetail({
      actorLabel: "Hermes",
      authorization: "Bearer do-not-log",
      refreshToken: "do-not-log",
      summary: JSON.stringify({ client_secret: sentinel }),
      requestBody: { private: true },
      cost: 12
    }),
    {
      actorLabel: "Hermes",
      authorization: "[redacted]",
      refreshToken: "[redacted]",
      summary: '{"client_secret":"[redacted]"}',
      requestBody: "[structured value omitted]",
      cost: 12
    }
  );
});
