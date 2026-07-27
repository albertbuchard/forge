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
    }>();
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

test("remote pairing cannot expand scopes or approve elevated profiles without owner step-up", async () => {
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
    const begun = await app.inject({
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
        scopes: ["read", "machine.exec"],
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
        scopes: ["machine.exec", "read"],
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
    }>();
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
