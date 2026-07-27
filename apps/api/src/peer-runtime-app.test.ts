import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import { closeDatabase, getDatabase } from "./db.js";
import {
  expectedAuthenticatedEvidenceHash,
  persistLocalPeerIdentity
} from "./repositories/peer-pairing.js";
import type {
  PeerCoreGateway,
  PeerLocalIdentity
} from "./services/peer-core-gateway.js";
import type { PeerDaemonSupervisorSnapshot } from "./services/peer-daemon-supervisor.js";
import type { PeerCommandAuthorizer } from "./services/peer-command-authorization.js";
import type { PeerPresenceAction } from "./services/peer-human-presence.js";
import { peerWebAuthnCredentialSetVersion } from "./services/peer-webauthn.js";

const ownerUserId = "user_operator";
const authorityKeyId = "A".repeat(43);

function commandAuthorizer(): PeerCommandAuthorizer {
  return {
    publicKeyBase64Url: Buffer.alloc(32, 7).toString("base64url"),
    authorityKeyId,
    async initialize() {
      return {
        protocol: "forge-peer-command-authority-state/v1",
        authorityKeyId,
        ownerUserId,
        epoch: "0",
        invalidatedBefore: "1970-01-01T00:00:00.000Z",
        revokedAuthorizationIds: [],
        revokedSessionIds: [],
        revokedDeviceIds: [],
        signature: "S".repeat(86)
      };
    },
    async authorize() {
      throw new Error("not used");
    }
  };
}

function browserStatusHeaders(input: {
  cookie: string;
  host?: string;
  referer?: string;
  site?: string;
  origin?: string;
}) {
  const host = input.host ?? "127.0.0.1:4317";
  return {
    cookie: input.cookie,
    host,
    referer: input.referer ?? `http://${host}/forge/people/person_test`,
    "sec-fetch-site": input.site ?? "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    ...(input.origin ? { origin: input.origin } : {})
  };
}

function snapshot(
  state: PeerDaemonSupervisorSnapshot["state"]
): PeerDaemonSupervisorSnapshot {
  return {
    enabled: true,
    state,
    pid: state === "ready" ? 123 : null,
    restartCount: 0,
    restartsInWindow: 0,
    circuitOpen: false,
    startedAt: "2026-07-15T10:00:00.000Z",
    readyAt: state === "ready" ? "2026-07-15T10:00:01.000Z" : null,
    nextRestartAt: null,
    lastExit: null,
    lastError: null,
    stderrTail: null
  };
}

function localIdentity(): PeerLocalIdentity {
  const principalId = "1".repeat(64);
  const deviceId = "2".repeat(32);
  const certificateHash = "3".repeat(64);
  return {
    principal: {
      id: principalId,
      rootPublicKey: Buffer.alloc(32, 1).toString("base64url"),
      trustState: "verified",
      certificateHash
    },
    device: {
      id: deviceId,
      principalId,
      signingPublicKey: Buffer.alloc(32, 2).toString("base64url"),
      keyAgreementPublicKey: Buffer.alloc(32, 3).toString("base64url"),
      certificateSerial: "1",
      certificate: Buffer.alloc(96, 4).toString("base64url"),
      certificateHash,
      capabilities: ["direct_stream", "query", "projection"],
      transportEndpoints: [
        { kind: "local_direct", host: "100.64.0.4", port: 4318 }
      ],
      status: "approved"
    },
    provenance: {
      protocolVersion: "forge-peer/1",
      ownerUserId,
      relationshipId: null,
      localPrincipalId: principalId,
      localDeviceId: deviceId,
      remotePrincipalId: null,
      remoteDeviceId: null,
      evidenceHash: expectedAuthenticatedEvidenceHash({
        ownerUserId,
        localCertificateHash: certificateHash,
        relationshipId: null,
        remoteCertificateHash: null
      }),
      authenticatedAt: new Date().toISOString()
    }
  };
}

function gateway(identity: PeerLocalIdentity): PeerCoreGateway {
  return {
    health: async () => ({
      enabled: true,
      healthy: true,
      protocolVersion: "forge-peer/1",
      reason: null
    }),
    localIdentity: async () => identity,
    syncCommandAuthorizationState: async () => ({
      commandId: "authority-state-0-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      authorityKeyId,
      invalidationEpoch: "0",
      stateHash: "a".repeat(64),
      committedAt: new Date().toISOString(),
      authorization: {
        authorityKeyId,
        authorizationId: null,
        actorClass: null,
        actorId: null,
        actorDeviceId: null,
        sessionId: null,
        capabilityId: null,
        actionDigest: null,
        invalidationEpoch: "0",
        authorityStateHash: "a".repeat(64),
        verifiedAt: new Date().toISOString()
      },
      provenance: identity.provenance
    })
  } as unknown as PeerCoreGateway;
}

test("assembled Forge starts, persists, exposes, and stops the configured peer runtime", async (t) => {
  const previousDevWebOrigin = process.env.FORGE_DEV_WEB_ORIGIN;
  const browserOrigin = "http://127.0.0.1:3027";
  process.env.FORGE_DEV_WEB_ORIGIN = `${browserOrigin}/forge/`;
  t.after(() => {
    if (previousDevWebOrigin === undefined) {
      delete process.env.FORGE_DEV_WEB_ORIGIN;
    } else {
      process.env.FORGE_DEV_WEB_ORIGIN = previousDevWebOrigin;
    }
  });
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-peer-runtime-app-")
  );
  await chmod(dataRoot, 0o700);
  const sentinelPath = path.join(dataRoot, "preexisting-user-data.txt");
  await writeFile(sentinelPath, "preserve me", { mode: 0o600 });
  const identity = localIdentity();
  let starts = 0;
  let stops = 0;
  let persistenceError: unknown = null;
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    taskRunWatchdog: false,
    devrageMetricSync: false,
    peerRuntime: {
      environment: {
        FORGE_PEER_ENABLED: "1",
        FORGE_PEER_BIN: "/opt/forge/bin/forge-peer",
        FORGE_PEER_DIRECT_ENDPOINTS: "100.64.0.4:4318"
      },
      resolveTemporaryDirectory: async () => "/private/tmp",
      createCommandAuthorizer: commandAuthorizer,
      createSupervisor: () => ({
        async start() {
          starts += 1;
          return snapshot("ready");
        },
        async stop() {
          stops += 1;
          return snapshot("stopped");
        }
      }),
      createGateway: () => gateway(identity),
      persistIdentity: (input) => {
        try {
          return persistLocalPeerIdentity(input);
        } catch (error) {
          persistenceError = error;
          throw error;
        }
      }
    }
  });

  try {
    assert.equal(starts, 0, "daemon startup must wait for Fastify readiness");
    const secretPath = path.join(dataRoot, ".forge-secrets.key");
    const secretMetadata = await stat(secretPath);
    assert.equal(secretMetadata.mode & 0o777, 0o600);

    await app.ready();
    assert.equal(starts, 1);
    assert.equal(persistenceError, null);
    const principal = getDatabase()
      .prepare(
        `SELECT owner_user_id AS ownerUserId, public_principal_id AS publicPrincipalId,
                root_public_key AS rootPublicKey, trust_state AS trustState
         FROM forge_principals WHERE id = ?`
      )
      .get(identity.principal.id) as Record<string, unknown> | undefined;
    assert.ok(principal);
    assert.deepEqual(
      { ...principal },
      {
        ownerUserId,
        publicPrincipalId: identity.principal.id,
        rootPublicKey: identity.principal.rootPublicKey,
        trustState: "verified"
      }
    );
    const device = getDatabase()
      .prepare(
        `SELECT owner_user_id AS ownerUserId, principal_id AS principalId,
                certified_public_key AS signingPublicKey,
                key_agreement_public_key AS agreementPublicKey,
                certificate_serial AS certificateSerial,
                certificate_hash AS certificateHash, status
         FROM forge_devices WHERE id = ?`
      )
      .get(identity.device.id) as Record<string, unknown> | undefined;
    assert.ok(device);
    assert.deepEqual(
      { ...device },
      {
        ownerUserId,
        principalId: identity.principal.id,
        signingPublicKey: identity.device.signingPublicKey,
        agreementPublicKey: identity.device.keyAgreementPublicKey,
        certificateSerial: identity.device.certificateSerial,
        certificateHash: identity.device.certificateHash,
        status: "approved"
      }
    );

    const cookie = issueTestOperatorSessionCookie(app);
    const presence = await app.inject({
      method: "GET",
      url: "/api/v1/peers/human-presence",
      headers: browserStatusHeaders({
        cookie
      })
    });
    assert.equal(presence.statusCode, 200, presence.body);
    assert.deepEqual((presence.json() as { peerCore: unknown }).peerCore, {
      enabled: true,
      healthy: true,
      protocolVersion: "forge-peer/1",
      reason: null,
      localDeviceId: identity.device.id
    });

    const proxiedPresence = await app.inject({
      method: "GET",
      url: "/api/v1/peers/human-presence",
      headers: browserStatusHeaders({
        cookie,
        referer: `${browserOrigin}/forge/people/person_test`,
        origin: browserOrigin
      })
    });
    assert.equal(proxiedPresence.statusCode, 200, proxiedPresence.body);

    const credentialSetVersion = peerWebAuthnCredentialSetVersion([]);
    const registrationAction: PeerPresenceAction = {
      ownerUserId,
      method: "POST",
      routePath: "/api/v1/peers/human-presence/options",
      pathParams: {},
      expectedVersion: credentialSetVersion,
      body: {
        ceremony: "register",
        credentialLabel: "People approval credential"
      }
    };
    const proxiedWebAuthnOptions = await app.inject({
      method: "POST",
      url: "/api/v1/peers/human-presence/options",
      headers: {
        ...browserStatusHeaders({
          cookie,
          referer: `${browserOrigin}/forge/people/person_test`,
          origin: browserOrigin
        }),
        "content-type": "application/json"
      },
      payload: {
        ceremony: "register",
        credentialLabel: "People approval credential",
        action: registrationAction
      }
    });
    assert.equal(
      proxiedWebAuthnOptions.statusCode,
      200,
      proxiedWebAuthnOptions.body
    );
    assert.equal(proxiedWebAuthnOptions.json().options.rp.id, "127.0.0.1");

    const outsideForgeBase = await app.inject({
      method: "GET",
      url: "/api/v1/peers/human-presence",
      headers: browserStatusHeaders({
        cookie,
        referer: `${browserOrigin}/not-forge/people/person_test`,
        origin: browserOrigin
      })
    });
    assert.equal(outsideForgeBase.statusCode, 403, outsideForgeBase.body);
    assert.equal(outsideForgeBase.json().code, "peer_browser_origin_untrusted");

    const unconfiguredBrowserOrigin = await app.inject({
      method: "GET",
      url: "/api/v1/peers/human-presence",
      headers: browserStatusHeaders({
        cookie,
        referer: "http://localhost:3027/forge/people/person_test",
        origin: "http://localhost:3027"
      })
    });
    assert.equal(
      unconfiguredBrowserOrigin.statusCode,
      403,
      unconfiguredBrowserOrigin.body
    );
    assert.equal(
      unconfiguredBrowserOrigin.json().code,
      "peer_browser_origin_untrusted"
    );

    const nonLoopbackProxy = await app.inject({
      method: "GET",
      url: "/api/v1/peers/human-presence",
      remoteAddress: "100.64.0.42",
      headers: browserStatusHeaders({
        cookie,
        referer: `${browserOrigin}/forge/people/person_test`,
        origin: browserOrigin
      })
    });
    assert.equal(nonLoopbackProxy.statusCode, 426, nonLoopbackProxy.body);
    assert.equal(
      nonLoopbackProxy.json().code,
      "gateway_secure_transport_required"
    );

    const crossSite = await app.inject({
      method: "GET",
      url: "/api/v1/peers/human-presence",
      headers: browserStatusHeaders({
        cookie,
        referer: "https://attacker.example/people",
        site: "cross-site"
      })
    });
    assert.equal(crossSite.statusCode, 403, crossSite.body);
    assert.equal(crossSite.json().code, "peer_browser_origin_untrusted");

    const forgedReferer = await app.inject({
      method: "GET",
      url: "/api/v1/peers/human-presence",
      headers: browserStatusHeaders({
        cookie,
        referer: "https://attacker.example/people"
      })
    });
    assert.equal(forgedReferer.statusCode, 403, forgedReferer.body);
    assert.equal(forgedReferer.json().code, "peer_browser_origin_untrusted");

    const conflictingOrigin = await app.inject({
      method: "GET",
      url: "/api/v1/peers/human-presence",
      headers: browserStatusHeaders({
        cookie,
        origin: "https://attacker.example"
      })
    });
    assert.equal(conflictingOrigin.statusCode, 403, conflictingOrigin.body);
    assert.equal(
      conflictingOrigin.json().code,
      "peer_browser_origin_untrusted"
    );
    assert.equal(await readFile(sentinelPath, "utf8"), "preserve me");
  } finally {
    await app.close();
    assert.equal(stops, 1);
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("assembled Forge reports an explicitly disabled peer runtime without spawning", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-peer-runtime-disabled-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    taskRunWatchdog: false,
    devrageMetricSync: false,
    peerRuntime: false
  });

  try {
    await app.ready();
    const cookie = issueTestOperatorSessionCookie(app);
    const presence = await app.inject({
      method: "GET",
      url: "/api/v1/peers/human-presence",
      headers: browserStatusHeaders({
        cookie
      })
    });
    assert.equal(presence.statusCode, 200, presence.body);
    assert.deepEqual((presence.json() as { peerCore: unknown }).peerCore, {
      enabled: false,
      healthy: false,
      protocolVersion: null,
      reason: "The forge-peer daemon is not configured.",
      localDeviceId: null
    });
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});
