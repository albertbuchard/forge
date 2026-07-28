import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  SignJWT
} from "jose";

import { buildServer } from "../app.js";
import type { ApplicationSecurityRuntime } from "./application-security-runtime.js";
import type { ForgePrincipal } from "./contracts.js";

async function clientKey() {
  const pair = await generateKeyPair("ES256", { extractable: true });
  const publicJwk = await exportJWK(pair.publicKey);
  return {
    privateKey: pair.privateKey,
    publicJwk,
    thumbprint: await calculateJwkThumbprint(publicJwk)
  };
}

async function pairingProof(input: {
  privateKey: CryptoKey;
  publicJwk: Awaited<ReturnType<typeof exportJWK>>;
  requestId: string;
  operation: "poll" | "cancel";
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
    .setIssuedAt()
    .setJti(`pair-proof-${randomUUID()}`)
    .sign(input.privateKey);
}

async function dpopProof(input: {
  privateKey: CryptoKey;
  publicJwk: Awaited<ReturnType<typeof exportJWK>>;
  method: string;
  target: string;
  credential: string;
}) {
  return new SignJWT({
    htm: input.method,
    htu: input.target,
    ath: createHash("sha256")
      .update(input.credential, "utf8")
      .digest("base64url")
  })
    .setProtectedHeader({
      alg: "ES256",
      typ: "dpop+jwt",
      jwk: input.publicJwk
    })
    .setIssuedAt()
    .setJti(`dpop-${randomUUID()}`)
    .sign(input.privateKey);
}

test("remote API client pairs once, renews with DPoP, and is denied after revocation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-remote-pairing-"));
  let runtime!: ApplicationSecurityRuntime;
  const app = await buildServer({
    dataRoot: root,
    seedDemoData: false,
    taskRunWatchdog: false,
    devrageMetricSync: false,
    peerRuntime: false,
    onSecurityRuntimeReady(value) {
      runtime = value;
    }
  });
  try {
    assert.ok(runtime);
    const key = await clientKey();
    const begun = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device",
      headers: { host: "127.0.0.1" },
      payload: {
        clientName: "Codex",
        clientKeyThumbprint: key.thumbprint,
        requestedScopes: ["read"],
        requestedProfile: "viewer"
      }
    });
    assert.equal(begun.statusCode, 200, begun.body);
    const pairing = begun.json<{
      requestId: string;
      deviceCode: string;
      userCode: string;
      expiresIn: number;
    }>();
    assert.equal(pairing.expiresIn, 600);
    const request = runtime.store.readPairingRequest(pairing.requestId);
    assert.ok(request);

    const ownerPrincipal: ForgePrincipal = {
      kind: "operator_session",
      subjectId: "test-owner-browser",
      ownerId: request.ownerId,
      clientId: null,
      installationId: null,
      audience: runtime.audience,
      scopes: ["*"],
      profile: "operator",
      ownerSecurityEpoch: request.ownerSecurityEpoch,
      clientSecurityEpoch: null,
      authenticatedAt: new Date().toISOString()
    };
    const ownerSession = runtime.browserSessions.create(ownerPrincipal);
    const approved = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device/approve",
      headers: {
        host: "127.0.0.1",
        cookie: `forge_session=${encodeURIComponent(ownerSession.sessionToken)}`,
        "x-forge-csrf": ownerSession.csrfToken
      },
      payload: {
        userCode: pairing.userCode,
        scopes: ["read"],
        profile: "viewer"
      }
    });
    assert.equal(approved.statusCode, 200, approved.body);

    const approvedRequest = runtime.store.readPairingRequest(pairing.requestId);
    assert.ok(approvedRequest);
    assert.equal(approvedRequest.status, "approved");
    assert.equal(
      runtime.store.updatePairingPoll({
        id: approvedRequest.id,
        expectedNextPollAt: approvedRequest.nextPollAt,
        pollIntervalSeconds: approvedRequest.pollIntervalSeconds,
        nextPollAt: new Date(Date.now() - 1_000).toISOString(),
        now: new Date().toISOString()
      }),
      true
    );
    const tokenResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/token",
      headers: { host: "127.0.0.1" },
      payload: {
        grantType: "device_code",
        deviceCode: pairing.deviceCode,
        clientProof: await pairingProof({
          privateKey: key.privateKey,
          publicJwk: key.publicJwk,
          requestId: pairing.requestId,
          operation: "poll"
        })
      }
    });
    assert.equal(tokenResponse.statusCode, 200, tokenResponse.body);
    const issued = tokenResponse.json<{
      accessToken: string;
      refreshToken: string;
      clientId: string;
    }>();
    assert.equal(tokenResponse.headers["cache-control"], "no-store");

    const protectedTarget = "http://127.0.0.1/api/v1/context";
    const admitted = await app.inject({
      method: "GET",
      url: "/api/v1/context",
      headers: {
        host: "127.0.0.1",
        authorization: `DPoP ${issued.accessToken}`,
        dpop: await dpopProof({
          privateKey: key.privateKey,
          publicJwk: key.publicJwk,
          method: "GET",
          target: protectedTarget,
          credential: issued.accessToken
        })
      }
    });
    assert.equal(admitted.statusCode, 200, admitted.body);

    const tokenTarget = "http://127.0.0.1/api/v1/auth/token";
    const renewed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/token",
      headers: {
        host: "127.0.0.1",
        dpop: await dpopProof({
          privateKey: key.privateKey,
          publicJwk: key.publicJwk,
          method: "POST",
          target: tokenTarget,
          credential: issued.refreshToken
        })
      },
      payload: {
        grantType: "refresh_token",
        refreshToken: issued.refreshToken,
        clientId: issued.clientId,
        clientKeyThumbprint: key.thumbprint
      }
    });
    assert.equal(renewed.statusCode, 200, renewed.body);
    const renewedCredential = renewed.json<{
      accessToken: string;
      refreshToken: string;
    }>();
    assert.notEqual(renewedCredential.refreshToken, issued.refreshToken);

    const revoked = await app.inject({
      method: "POST",
      url: `/api/v1/auth/clients/${issued.clientId}/revoke`,
      headers: {
        host: "127.0.0.1",
        cookie: `forge_session=${encodeURIComponent(ownerSession.sessionToken)}`,
        "x-forge-csrf": ownerSession.csrfToken
      }
    });
    assert.equal(revoked.statusCode, 200, revoked.body);
    assert.equal(revoked.json<{ revoked: boolean }>().revoked, true);
    const revokedEpoch =
      runtime.store.readClient(issued.clientId)?.clientSecurityEpoch;
    const repeatedRevocation = await app.inject({
      method: "POST",
      url: `/api/v1/auth/clients/${issued.clientId}/revoke`,
      headers: {
        host: "127.0.0.1",
        cookie: `forge_session=${encodeURIComponent(ownerSession.sessionToken)}`,
        "x-forge-csrf": ownerSession.csrfToken
      }
    });
    assert.equal(repeatedRevocation.statusCode, 200, repeatedRevocation.body);
    assert.equal(
      repeatedRevocation.json<{ revoked: boolean }>().revoked,
      true
    );
    assert.equal(
      runtime.store.readClient(issued.clientId)?.clientSecurityEpoch,
      revokedEpoch
    );

    const denied = await app.inject({
      method: "GET",
      url: "/api/v1/context",
      headers: {
        host: "127.0.0.1",
        authorization: `DPoP ${renewedCredential.accessToken}`,
        dpop: await dpopProof({
          privateKey: key.privateKey,
          publicJwk: key.publicJwk,
          method: "GET",
          target: protectedTarget,
          credential: renewedCredential.accessToken
        })
      }
    });
    assert.equal(denied.statusCode, 401, denied.body);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("companion bootstrap grants one pairing invitation and no renewable API credential", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "forge-companion-bootstrap-")
  );
  let runtime!: ApplicationSecurityRuntime;
  const canonicalOrigin = "https://forge.example.test";
  const forwardedHeaders = {
    host: "forge.example.test",
    "x-forwarded-proto": "https"
  };
  const app = await buildServer({
    dataRoot: root,
    seedDemoData: false,
    taskRunWatchdog: false,
    devrageMetricSync: false,
    peerRuntime: false,
    canonicalExternalOrigin: canonicalOrigin,
    onSecurityRuntimeReady(value) {
      runtime = value;
    }
  });
  try {
    const key = await clientKey();
    const browserBootstrap = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device",
      headers: forwardedHeaders,
      payload: {
        clientName: "Wrong browser bootstrap",
        clientType: "browser",
        clientKeyThumbprint: key.thumbprint,
        requestedScopes: ["companion.pair"],
        requestedProfile: "trusted_personal_assistant"
      }
    });
    assert.equal(browserBootstrap.statusCode, 400, browserBootstrap.body);
    assert.equal(
      browserBootstrap.json<{ code: string }>().code,
      "companion_pairing_api_client_required"
    );

    const begun = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device",
      headers: forwardedHeaders,
      payload: {
        clientName: "Forge Companion on iPhone",
        clientType: "api",
        clientKeyThumbprint: key.thumbprint,
        requestedScopes: ["companion.pair"],
        requestedProfile: "trusted_personal_assistant"
      }
    });
    assert.equal(begun.statusCode, 200, begun.body);
    const pairing = begun.json<{
      requestId: string;
      deviceCode: string;
      userCode: string;
      expiresIn: number;
    }>();
    assert.equal(pairing.expiresIn, 600);
    const request = runtime.store.readPairingRequest(pairing.requestId);
    assert.ok(request);
    const ownerSession = runtime.browserSessions.create({
      kind: "operator_session",
      subjectId: "test-owner-browser",
      ownerId: request.ownerId,
      clientId: null,
      installationId: null,
      audience: runtime.audience,
      scopes: ["*"],
      profile: "operator",
      ownerSecurityEpoch: request.ownerSecurityEpoch,
      clientSecurityEpoch: null,
      authenticatedAt: new Date().toISOString()
    });
    const approved = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device/approve",
      headers: {
        ...forwardedHeaders,
        cookie: `forge_session=${encodeURIComponent(ownerSession.sessionToken)}`,
        "x-forge-csrf": ownerSession.csrfToken
      },
      payload: {
        userCode: pairing.userCode,
        scopes: ["companion.pair"],
        profile: "trusted_personal_assistant"
      }
    });
    assert.equal(approved.statusCode, 200, approved.body);

    const approvedRequest = runtime.store.readPairingRequest(pairing.requestId);
    assert.ok(approvedRequest);
    assert.equal(
      runtime.store.updatePairingPoll({
        id: approvedRequest.id,
        expectedNextPollAt: approvedRequest.nextPollAt,
        pollIntervalSeconds: approvedRequest.pollIntervalSeconds,
        nextPollAt: new Date(Date.now() - 1_000).toISOString(),
        now: new Date().toISOString()
      }),
      true
    );
    const exchanged = await app.inject({
      method: "POST",
      url: "/api/v1/auth/token",
      headers: forwardedHeaders,
      payload: {
        grantType: "device_code",
        deviceCode: pairing.deviceCode,
        clientProof: await pairingProof({
          privateKey: key.privateKey,
          publicJwk: key.publicJwk,
          requestId: pairing.requestId,
          operation: "poll"
        })
      }
    });
    assert.equal(exchanged.statusCode, 200, exchanged.body);
    const issued = exchanged.json<{
      accessToken: string;
      refreshToken?: string;
      clientId: string;
      scopes: string[];
      profile: string;
    }>();
    assert.equal(issued.refreshToken, undefined);
    assert.deepEqual(issued.scopes, [
      "companion.pair",
      "profile:trusted_personal_assistant"
    ]);
    assert.equal(issued.profile, "trusted_personal_assistant");

    const unrelatedTarget = `${canonicalOrigin}/api/v1/context`;
    const unrelated = await app.inject({
      method: "GET",
      url: "/api/v1/context",
      headers: {
        ...forwardedHeaders,
        authorization: `DPoP ${issued.accessToken}`,
        dpop: await dpopProof({
          privateKey: key.privateKey,
          publicJwk: key.publicJwk,
          method: "GET",
          target: unrelatedTarget,
          credential: issued.accessToken
        })
      }
    });
    assert.equal(unrelated.statusCode, 403, unrelated.body);

    const invitationTarget =
      `${canonicalOrigin}/api/v1/health/pairing-sessions`;
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: {
        ...forwardedHeaders,
        authorization: `DPoP ${issued.accessToken}`,
        dpop: await dpopProof({
          privateKey: key.privateKey,
          publicJwk: key.publicJwk,
          method: "POST",
          target: invitationTarget,
          credential: issued.accessToken
        })
      },
      payload: {
        label: "Albert's iPhone"
      }
    });
    assert.equal(created.statusCode, 201, created.body);
    const invitation = created.json<{
      session: {
        userId: string;
        label: string;
        capabilities: string[];
      };
      qrPayload: {
        apiBaseUrl: string;
        transportMode: string;
        expiresAt: string;
        capabilities: string[];
      };
    }>();
    assert.equal(invitation.session.userId, request.ownerId);
    assert.equal(invitation.session.label, "Albert's iPhone");
    assert.equal(invitation.qrPayload.apiBaseUrl, `${canonicalOrigin}/api/v1`);
    assert.equal(invitation.qrPayload.transportMode, "manual-http");
    assert.deepEqual(
      invitation.session.capabilities,
      invitation.qrPayload.capabilities
    );
    assert.ok(
      Date.parse(invitation.qrPayload.expiresAt) - Date.now() <=
        10 * 60 * 1_000
    );
    assert.ok(runtime.store.readClient(issued.clientId)?.revokedAt);

    const replayed = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: {
        ...forwardedHeaders,
        authorization: `DPoP ${issued.accessToken}`,
        dpop: await dpopProof({
          privateKey: key.privateKey,
          publicJwk: key.publicJwk,
          method: "POST",
          target: invitationTarget,
          credential: issued.accessToken
        })
      },
      payload: { label: "Replay" }
    });
    assert.equal(replayed.statusCode, 401, replayed.body);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("remote pairing rejects unavailable machine scopes and requires owner step-up for elevated profiles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-pairing-denial-"));
  let runtime!: ApplicationSecurityRuntime;
  const app = await buildServer({
    dataRoot: root,
    seedDemoData: false,
    taskRunWatchdog: false,
    devrageMetricSync: false,
    peerRuntime: false,
    onSecurityRuntimeReady(value) {
      runtime = value;
    }
  });
  try {
    assert.ok(runtime);
    const key = await clientKey();
    const unavailable = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device",
      headers: { host: "127.0.0.1" },
      payload: {
        clientName: "Remote executor",
        clientKeyThumbprint: key.thumbprint,
        requestedScopes: ["read", "machine.exec"],
        requestedProfile: "executor"
      }
    });
    assert.equal(unavailable.statusCode, 409, unavailable.body);
    assert.equal(
      unavailable.json<{ code: string }>().code,
      "pairing_machine_scope_unavailable"
    );

    const begun = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device",
      headers: { host: "127.0.0.1" },
      payload: {
        clientName: "Remote executor",
        clientKeyThumbprint: key.thumbprint,
        requestedScopes: ["read"],
        requestedProfile: "executor"
      }
    });
    assert.equal(begun.statusCode, 200, begun.body);
    const pairing = begun.json<{ requestId: string; userCode: string }>();
    const request = runtime.store.readPairingRequest(pairing.requestId);
    assert.ok(request);
    const ownerSession = runtime.browserSessions.create({
      kind: "operator_session",
      subjectId: "test-owner-browser",
      ownerId: request.ownerId,
      clientId: null,
      installationId: null,
      audience: runtime.audience,
      scopes: ["*"],
      profile: "operator",
      ownerSecurityEpoch: request.ownerSecurityEpoch,
      clientSecurityEpoch: null,
      authenticatedAt: new Date().toISOString()
    });
    const unavailableApproval = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device/approve",
      headers: {
        host: "127.0.0.1",
        cookie: `forge_session=${encodeURIComponent(ownerSession.sessionToken)}`,
        "x-forge-csrf": ownerSession.csrfToken
      },
      payload: {
        userCode: pairing.userCode,
        scopes: ["read", "machine.exec"],
        profile: "executor"
      }
    });
    assert.equal(unavailableApproval.statusCode, 409, unavailableApproval.body);
    assert.equal(
      unavailableApproval.json<{ code: string }>().code,
      "pairing_machine_scope_unavailable"
    );
    assert.equal(
      runtime.store.readPairingRequest(pairing.requestId)?.status,
      "pending"
    );
    const elevated = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device/approve",
      headers: {
        host: "127.0.0.1",
        cookie: `forge_session=${encodeURIComponent(ownerSession.sessionToken)}`,
        "x-forge-csrf": ownerSession.csrfToken
      },
      payload: {
        userCode: pairing.userCode,
        scopes: ["read"],
        profile: "executor"
      }
    });
    assert.notEqual(elevated.statusCode, 200, elevated.body);
    assert.equal(
      runtime.store.readPairingRequest(pairing.requestId)?.status,
      "pending"
    );
    const stepUpOptions = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device/step-up/options",
      headers: {
        host: "127.0.0.1",
        origin: "http://127.0.0.1",
        cookie: `forge_session=${encodeURIComponent(ownerSession.sessionToken)}`,
        "x-forge-csrf": ownerSession.csrfToken
      },
      payload: {
        userCode: pairing.userCode,
        credentialLabel: "Test owner passkey"
      }
    });
    assert.equal(stepUpOptions.statusCode, 200, stepUpOptions.body);
    const ceremony = stepUpOptions.json<{
      challengeId: string;
      ceremony: string;
      review: { requestId: string };
    }>();
    assert.equal(ceremony.ceremony, "register");
    assert.equal(ceremony.review.requestId, pairing.requestId);

    const forgedStepUp = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device/step-up/verify",
      headers: {
        host: "127.0.0.1",
        origin: "http://127.0.0.1",
        cookie: `forge_session=${encodeURIComponent(ownerSession.sessionToken)}`,
        "x-forge-csrf": ownerSession.csrfToken
      },
      payload: {
        userCode: pairing.userCode,
        requestId: pairing.requestId,
        scopes: ["read"],
        profile: "executor",
        challengeId: ceremony.challengeId,
        response: {
          id: "forged",
          rawId: "forged",
          response: {},
          clientExtensionResults: {},
          type: "public-key"
        }
      }
    });
    assert.equal(forgedStepUp.statusCode, 403, forgedStepUp.body);
    assert.equal(
      runtime.store.readPairingRequest(pairing.requestId)?.status,
      "pending"
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("remote browser pairing reports a bounded retry window after unfinished requests fill the cap", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-browser-pairing-cap-"));
  const app = await buildServer({
    dataRoot: root,
    seedDemoData: false,
    taskRunWatchdog: false,
    devrageMetricSync: false,
    peerRuntime: false
  });
  try {
    const key = await clientKey();
    for (let index = 0; index < 3; index += 1) {
      const admitted = await app.inject({
        method: "POST",
        url: "/api/v1/auth/device",
        headers: { host: "127.0.0.1" },
        payload: {
          clientName: `Remote browser ${index + 1}`,
          clientType: "browser",
          clientKeyThumbprint: key.thumbprint,
          requestedScopes: ["read"],
          requestedProfile: "viewer"
        }
      });
      assert.equal(admitted.statusCode, 200, admitted.body);
      assert.equal(admitted.json<{ expiresIn: number }>().expiresIn, 180);
    }

    const limited = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device",
      headers: { host: "127.0.0.1" },
      payload: {
        clientName: "Remote browser 4",
        clientType: "browser",
        clientKeyThumbprint: key.thumbprint,
        requestedScopes: ["read"],
        requestedProfile: "viewer"
      }
    });
    assert.equal(limited.statusCode, 429, limited.body);
    assert.equal(limited.headers["retry-after"], "180");
    assert.equal(
      limited.json<{ code: string }>().code,
      "pairing_admission_limited"
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("remote browser pairing reports the longer retry window when API clients fill the shared cap", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "forge-mixed-pairing-cap-")
  );
  const app = await buildServer({
    dataRoot: root,
    seedDemoData: false,
    taskRunWatchdog: false,
    devrageMetricSync: false,
    peerRuntime: false
  });
  try {
    const key = await clientKey();
    for (let index = 0; index < 3; index += 1) {
      const admitted = await app.inject({
        method: "POST",
        url: "/api/v1/auth/device",
        headers: { host: "127.0.0.1" },
        payload: {
          clientName: `API client ${index + 1}`,
          clientType: "api",
          clientKeyThumbprint: key.thumbprint,
          requestedScopes: ["read"],
          requestedProfile: "viewer"
        }
      });
      assert.equal(admitted.statusCode, 200, admitted.body);
      assert.equal(admitted.json<{ expiresIn: number }>().expiresIn, 600);
    }

    const limited = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device",
      headers: { host: "127.0.0.1" },
      payload: {
        clientName: "Remote browser",
        clientType: "browser",
        clientKeyThumbprint: key.thumbprint,
        requestedScopes: ["read"],
        requestedProfile: "viewer"
      }
    });
    assert.equal(limited.statusCode, 429, limited.body);
    assert.equal(limited.headers["retry-after"], "600");
    assert.deepEqual(
      limited.json<{ code: string; retryAfterSeconds: number }>(),
      {
        code: "pairing_admission_limited",
        error:
          "Forge cannot admit another pairing request in the current bounded window.",
        statusCode: 429,
        retryAfterSeconds: 600
      }
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("remote pairing reports the remaining admission window after rapid start and cancel attempts", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "forge-pairing-rate-window-")
  );
  const app = await buildServer({
    dataRoot: root,
    seedDemoData: false,
    taskRunWatchdog: false,
    devrageMetricSync: false,
    peerRuntime: false
  });
  try {
    const key = await clientKey();
    for (let index = 0; index < 10; index += 1) {
      const admitted = await app.inject({
        method: "POST",
        url: "/api/v1/auth/device",
        headers: { host: "127.0.0.1" },
        payload: {
          clientName: `Cancelled browser ${index + 1}`,
          clientType: "browser",
          clientKeyThumbprint: key.thumbprint,
          requestedScopes: ["read"],
          requestedProfile: "viewer"
        }
      });
      assert.equal(admitted.statusCode, 200, admitted.body);
      const pairing = admitted.json<{
        requestId: string;
        deviceCode: string;
      }>();
      const cancelled = await app.inject({
        method: "POST",
        url: "/api/v1/auth/device/cancel",
        headers: { host: "127.0.0.1" },
        payload: {
          deviceCode: pairing.deviceCode,
          clientProof: await pairingProof({
            privateKey: key.privateKey,
            publicJwk: key.publicJwk,
            requestId: pairing.requestId,
            operation: "cancel"
          })
        }
      });
      assert.equal(cancelled.statusCode, 200, cancelled.body);
    }

    const limited = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device",
      headers: { host: "127.0.0.1" },
      payload: {
        clientName: "Rate-limited browser",
        clientType: "browser",
        clientKeyThumbprint: key.thumbprint,
        requestedScopes: ["read"],
        requestedProfile: "viewer"
      }
    });
    assert.equal(limited.statusCode, 429, limited.body);
    const retryAfterSeconds = Number(limited.headers["retry-after"]);
    assert.ok(retryAfterSeconds >= 1 && retryAfterSeconds <= 60);
    assert.equal(
      limited.json<{ retryAfterSeconds: number }>().retryAfterSeconds,
      retryAfterSeconds
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("remote browser pairing returns only an HttpOnly session and revocation closes it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-browser-pairing-"));
  let runtime!: ApplicationSecurityRuntime;
  const app = await buildServer({
    dataRoot: root,
    seedDemoData: false,
    taskRunWatchdog: false,
    devrageMetricSync: false,
    peerRuntime: false,
    onSecurityRuntimeReady(value) {
      runtime = value;
    }
  });
  try {
    assert.ok(runtime);
    const key = await clientKey();
    const begun = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device",
      headers: { host: "127.0.0.1" },
      payload: {
        clientName: "Remote browser",
        clientType: "browser",
        clientKeyThumbprint: key.thumbprint,
        requestedScopes: ["read"],
        requestedProfile: "viewer"
      }
    });
    assert.equal(begun.statusCode, 200, begun.body);
    const pairing = begun.json<{
      requestId: string;
      deviceCode: string;
      userCode: string;
      expiresIn: number;
    }>();
    assert.equal(pairing.expiresIn, 180);
    const request = runtime.store.readPairingRequest(pairing.requestId);
    assert.ok(request);
    assert.equal(request.clientType, "browser");
    const ownerSession = runtime.browserSessions.create({
      kind: "operator_session",
      subjectId: "test-owner-browser",
      ownerId: request.ownerId,
      clientId: null,
      installationId: null,
      audience: runtime.audience,
      scopes: ["*"],
      profile: "operator",
      ownerSecurityEpoch: request.ownerSecurityEpoch,
      clientSecurityEpoch: null,
      authenticatedAt: new Date().toISOString()
    });
    const reviewed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device/review",
      headers: {
        host: "127.0.0.1",
        cookie: `forge_session=${encodeURIComponent(ownerSession.sessionToken)}`,
        "x-forge-csrf": ownerSession.csrfToken
      },
      payload: { userCode: pairing.userCode }
    });
    assert.equal(reviewed.statusCode, 200, reviewed.body);
    const review = reviewed.json<{
      requestId: string;
      clientName: string;
      clientType: string;
      audience: string;
      requestedScopes: string[];
      requestedProfile: string;
      expiresAt: string;
      installationFingerprint: string;
      endpoint: { origin: string | null; fingerprint: string };
      boundaries: {
        resources: { scopes: string[] };
        egress: { requestedScopes: string[] };
      };
    }>();
    assert.equal(review.requestId, pairing.requestId);
    assert.equal(review.clientName, "Remote browser");
    assert.equal(review.clientType, "browser");
    assert.equal(review.audience, runtime.audience);
    assert.deepEqual(review.requestedScopes, ["read"]);
    assert.equal(review.requestedProfile, "viewer");
    assert.equal(review.expiresAt, request.expiresAt);
    assert.match(
      review.installationFingerprint,
      /^[A-F0-9]{8}(?:-[A-F0-9]{8}){3}$/
    );
    assert.match(
      review.endpoint.fingerprint,
      /^[A-F0-9]{8}(?:-[A-F0-9]{8}){3}$/
    );
    assert.deepEqual(review.boundaries.resources.scopes, ["read"]);
    assert.deepEqual(review.boundaries.egress.requestedScopes, []);
    const approved = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device/approve",
      headers: {
        host: "127.0.0.1",
        cookie: `forge_session=${encodeURIComponent(ownerSession.sessionToken)}`,
        "x-forge-csrf": ownerSession.csrfToken
      },
      payload: {
        userCode: pairing.userCode,
        scopes: ["read"],
        profile: "viewer"
      }
    });
    assert.equal(approved.statusCode, 200, approved.body);
    const approvedRequest = runtime.store.readPairingRequest(pairing.requestId);
    assert.ok(approvedRequest);
    assert.equal(
      runtime.store.updatePairingPoll({
        id: approvedRequest.id,
        expectedNextPollAt: approvedRequest.nextPollAt,
        pollIntervalSeconds: approvedRequest.pollIntervalSeconds,
        nextPollAt: new Date(Date.now() - 1_000).toISOString(),
        now: new Date().toISOString()
      }),
      true
    );
    const exchanged = await app.inject({
      method: "POST",
      url: "/api/v1/auth/token",
      headers: { host: "127.0.0.1" },
      payload: {
        grantType: "device_code",
        deviceCode: pairing.deviceCode,
        clientProof: await pairingProof({
          privateKey: key.privateKey,
          publicJwk: key.publicJwk,
          requestId: pairing.requestId,
          operation: "poll"
        })
      }
    });
    assert.equal(exchanged.statusCode, 200, exchanged.body);
    const body = exchanged.json<{
      clientId: string;
      csrfToken: string;
      accessToken?: string;
      refreshToken?: string;
    }>();
    assert.equal(body.accessToken, undefined);
    assert.equal(body.refreshToken, undefined);
    const setCookieHeader = exchanged.headers["set-cookie"];
    const setCookies = Array.isArray(setCookieHeader)
      ? setCookieHeader
      : [String(setCookieHeader)];
    const setCookie = setCookies.join("\n");
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=Strict/);
    const cookiePairs = setCookies.map((value) => value.split(";", 1)[0]!);
    const browserCookie = cookiePairs.find((value) =>
      value.startsWith("forge_session=")
    )!;
    const refreshCookie = cookiePairs.find((value) =>
      value.startsWith("forge_browser_refresh=")
    )!;
    const clientCookie = cookiePairs.find((value) =>
      value.startsWith("forge_browser_client=")
    )!;
    assert.ok(browserCookie);
    assert.ok(refreshCookie);
    assert.ok(clientCookie);

    const pairedBrowserSession = await app.inject({
      method: "GET",
      url: "/api/v1/auth/operator-session",
      headers: { host: "127.0.0.1", cookie: browserCookie }
    });
    assert.equal(
      pairedBrowserSession.statusCode,
      200,
      pairedBrowserSession.body
    );
    const pairedBrowserAuthority = pairedBrowserSession.json<{
      session: {
        actorLabel: string;
        principalKind: string;
        localOwner: boolean;
        profile: string;
      };
    }>().session;
    assert.equal(pairedBrowserAuthority.actorLabel, "Paired Browser");
    assert.equal(pairedBrowserAuthority.principalKind, "paired_client");
    assert.equal(pairedBrowserAuthority.localOwner, false);
    assert.equal(pairedBrowserAuthority.profile, "viewer");

    const admitted = await app.inject({
      method: "GET",
      url: "/api/v1/context",
      headers: { host: "127.0.0.1", cookie: browserCookie }
    });
    assert.equal(admitted.statusCode, 200, admitted.body);
    const redactedSettings = await app.inject({
      method: "GET",
      url: "/api/v1/settings",
      headers: { host: "127.0.0.1", cookie: browserCookie }
    });
    assert.equal(redactedSettings.statusCode, 200, redactedSettings.body);
    const pairedSettings = redactedSettings.json<{
      settings: {
        profile: { operatorEmail: string };
        calendarProviders: {
          google: Record<string, unknown>;
        };
        modelSettings: { connections: unknown[] };
        agents: unknown[];
        agentTokens: unknown[];
      };
    }>().settings;
    assert.equal(pairedSettings.profile.operatorEmail, "");
    assert.equal(
      "storedClientSecret" in pairedSettings.calendarProviders.google,
      false
    );
    assert.equal(
      "clientSecret" in pairedSettings.calendarProviders.google,
      false
    );
    assert.deepEqual(pairedSettings.modelSettings.connections, []);
    assert.deepEqual(pairedSettings.agents, []);
    assert.deepEqual(pairedSettings.agentTokens, []);
    const unsafeWithoutCsrf = await app.inject({
      method: "POST",
      url: `/api/v1/auth/clients/${body.clientId}/revoke`,
      headers: { host: "127.0.0.1", cookie: browserCookie }
    });
    assert.equal(unsafeWithoutCsrf.statusCode, 403, unsafeWithoutCsrf.body);

    const renewed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/browser/refresh",
      headers: {
        host: "127.0.0.1",
        origin: "http://127.0.0.1",
        cookie: [browserCookie, refreshCookie, clientCookie].join("; ")
      }
    });
    assert.equal(renewed.statusCode, 200, renewed.body);
    const renewedCookiesHeader = renewed.headers["set-cookie"];
    const renewedCookies = Array.isArray(renewedCookiesHeader)
      ? renewedCookiesHeader
      : [String(renewedCookiesHeader)];
    const renewedSessionCookie = renewedCookies
      .map((value) => value.split(";", 1)[0]!)
      .find((value) => value.startsWith("forge_session="));
    assert.ok(renewedSessionCookie);
    assert.notEqual(
      renewed.json<{ csrfToken: string }>().csrfToken,
      body.csrfToken
    );
    const admittedAfterRenewal = await app.inject({
      method: "GET",
      url: "/api/v1/context",
      headers: { host: "127.0.0.1", cookie: renewedSessionCookie }
    });
    assert.equal(
      admittedAfterRenewal.statusCode,
      200,
      admittedAfterRenewal.body
    );
    const oldSessionDenied = await app.inject({
      method: "GET",
      url: "/api/v1/context",
      headers: { host: "127.0.0.1", cookie: browserCookie }
    });
    assert.equal(oldSessionDenied.statusCode, 401, oldSessionDenied.body);

    const replayedRenewal = await app.inject({
      method: "POST",
      url: "/api/v1/auth/browser/refresh",
      headers: {
        host: "127.0.0.1",
        origin: "http://127.0.0.1",
        cookie: [refreshCookie, clientCookie].join("; ")
      }
    });
    assert.equal(replayedRenewal.statusCode, 401, replayedRenewal.body);
    assert.equal(
      runtime.store.readClient(body.clientId)?.revokedAt === null,
      false
    );
    const deniedAfterReplay = await app.inject({
      method: "GET",
      url: "/api/v1/context",
      headers: { host: "127.0.0.1", cookie: renewedSessionCookie }
    });
    assert.equal(deniedAfterReplay.statusCode, 401, deniedAfterReplay.body);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
