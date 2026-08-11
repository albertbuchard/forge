import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
import { issueTestOperatorSessionCookie } from "./test-operator-authority.js";

const MASTER_PASSWORD = "Frosted lanterns orbit the quiet lake 2026";

async function browserKey() {
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
  operation: "master_key_approve" | "poll";
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
    .setJti(`master-key-proof-${randomUUID()}`)
    .sign(input.privateKey);
}

test("master password is opt-in, locally configured, and pairs one sender-bound remote browser", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "forge-master-password-pairing-")
  );
  let runtime!: ApplicationSecurityRuntime;
  const externalOrigin = "https://forge-master.example.test";
  const remoteHeaders = {
    host: "forge-master.example.test",
    "x-forwarded-for": "100.64.10.20",
    "x-forwarded-proto": "https"
  };
  const app = await buildServer({
    dataRoot: root,
    seedDemoData: false,
    taskRunWatchdog: false,
    devrageMetricSync: false,
    peerRuntime: false,
    canonicalExternalOrigin: externalOrigin,
    onSecurityRuntimeReady(value) {
      runtime = value;
    }
  });
  try {
    const operatorCookie = issueTestOperatorSessionCookie(app);
    const initial = await app.inject({
      method: "GET",
      url: "/api/v1/auth/master-password",
      headers: { host: "127.0.0.1", cookie: operatorCookie }
    });
    assert.equal(initial.statusCode, 200, initial.body);
    assert.deepEqual(initial.json(), {
      configured: false,
      configuredAt: null,
      updatedAt: null,
      minimumLength: 15,
      maximumLength: 128
    });

    const common = await app.inject({
      method: "PUT",
      url: "/api/v1/auth/master-password",
      headers: { host: "127.0.0.1", cookie: operatorCookie },
      payload: {
        password: "passwordpassword",
        confirmation: "passwordpassword"
      }
    });
    assert.equal(common.statusCode, 400, common.body);
    assert.equal(
      common.json<{ code: string }>().code,
      "master_password_common"
    );

    const remoteSetup = await app.inject({
      method: "PUT",
      url: "/api/v1/auth/master-password",
      headers: { ...remoteHeaders, cookie: operatorCookie },
      payload: { password: MASTER_PASSWORD, confirmation: MASTER_PASSWORD }
    });
    assert.equal(remoteSetup.statusCode, 401, remoteSetup.body);

    const configured = await app.inject({
      method: "PUT",
      url: "/api/v1/auth/master-password",
      headers: { host: "127.0.0.1", cookie: operatorCookie },
      payload: { password: MASTER_PASSWORD, confirmation: MASTER_PASSWORD }
    });
    assert.equal(configured.statusCode, 200, configured.body);
    assert.equal(configured.json<{ configured: boolean }>().configured, true);
    const stored = runtime.store.readMasterPasswordCredential("user_operator");
    assert.ok(stored);
    assert.equal(stored.algorithm, "argon2id13");
    assert.equal(JSON.stringify(stored).includes(MASTER_PASSWORD), false);

    const key = await browserKey();
    const begun = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device",
      headers: remoteHeaders,
      payload: {
        clientName: "Remote Forge browser",
        clientType: "browser",
        clientKeyThumbprint: key.thumbprint,
        requestedScopes: ["read", "write"],
        requestedProfile: "trusted_personal_assistant"
      }
    });
    assert.equal(begun.statusCode, 200, begun.body);
    const pairing = begun.json<{
      requestId: string;
      deviceCode: string;
      userCode: string;
      masterPasswordAvailable: boolean;
    }>();
    assert.equal(pairing.masterPasswordAvailable, true);

    const wrong = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device/master-password/approve",
      headers: remoteHeaders,
      payload: {
        requestId: pairing.requestId,
        userCode: pairing.userCode,
        password: "A wrong but sufficiently bounded password",
        clientProof: await pairingProof({
          privateKey: key.privateKey,
          publicJwk: key.publicJwk,
          requestId: pairing.requestId,
          operation: "master_key_approve"
        })
      }
    });
    assert.equal(wrong.statusCode, 401, wrong.body);
    assert.equal(
      runtime.store.readPairingRequest(pairing.requestId)?.status,
      "pending"
    );

    const approved = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device/master-password/approve",
      headers: remoteHeaders,
      payload: {
        requestId: pairing.requestId,
        userCode: pairing.userCode,
        password: MASTER_PASSWORD,
        clientProof: await pairingProof({
          privateKey: key.privateKey,
          publicJwk: key.publicJwk,
          requestId: pairing.requestId,
          operation: "master_key_approve"
        })
      }
    });
    assert.equal(approved.statusCode, 200, approved.body);
    assert.equal(
      runtime.store.readPairingRequest(pairing.requestId)?.status,
      "approved"
    );
    assert.ok(runtime.store.readClientBySubjectId(pairing.requestId));

    const request = runtime.store.readPairingRequest(pairing.requestId);
    assert.ok(request);
    assert.equal(
      runtime.store.updatePairingPoll({
        id: request.id,
        expectedNextPollAt: request.nextPollAt,
        pollIntervalSeconds: request.pollIntervalSeconds,
        nextPollAt: new Date(Date.now() - 1_000).toISOString(),
        now: new Date().toISOString()
      }),
      true
    );
    const exchanged = await app.inject({
      method: "POST",
      url: "/api/v1/auth/token",
      headers: remoteHeaders,
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
    const session = exchanged.json<{
      csrfToken: string;
      scopes: string[];
      profile: string;
    }>();
    assert.ok(session.csrfToken.length > 20);
    assert.deepEqual(session.scopes, [
      "profile:trusted_personal_assistant",
      "read",
      "write"
    ]);
    assert.equal(session.profile, "trusted_personal_assistant");
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("master password cannot approve privileged, API-client, or mismatched pairing requests", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "forge-master-password-boundary-")
  );
  let runtime!: ApplicationSecurityRuntime;
  const app = await buildServer({
    dataRoot: root,
    seedDemoData: false,
    taskRunWatchdog: false,
    devrageMetricSync: false,
    peerRuntime: false,
    canonicalExternalOrigin: "https://forge-boundary.example.test",
    onSecurityRuntimeReady(value) {
      runtime = value;
    }
  });
  try {
    const operatorCookie = issueTestOperatorSessionCookie(app);
    const setup = await app.inject({
      method: "PUT",
      url: "/api/v1/auth/master-password",
      headers: { host: "127.0.0.1", cookie: operatorCookie },
      payload: { password: MASTER_PASSWORD, confirmation: MASTER_PASSWORD }
    });
    assert.equal(setup.statusCode, 200, setup.body);

    const remoteHeaders = {
      host: "forge-boundary.example.test",
      "x-forwarded-for": "100.64.10.21",
      "x-forwarded-proto": "https"
    };
    const key = await browserKey();
    const begun = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device",
      headers: remoteHeaders,
      payload: {
        clientName: "Privileged remote browser",
        clientType: "browser",
        clientKeyThumbprint: key.thumbprint,
        requestedScopes: ["read", "write"],
        requestedProfile: "operator"
      }
    });
    assert.equal(begun.statusCode, 200, begun.body);
    const pairing = begun.json<{ requestId: string; userCode: string }>();
    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device/master-password/approve",
      headers: remoteHeaders,
      payload: {
        requestId: pairing.requestId,
        userCode: pairing.userCode,
        password: MASTER_PASSWORD,
        clientProof: await pairingProof({
          privateKey: key.privateKey,
          publicJwk: key.publicJwk,
          requestId: pairing.requestId,
          operation: "master_key_approve"
        })
      }
    });
    assert.equal(rejected.statusCode, 403, rejected.body);
    assert.equal(
      runtime.store.readPairingRequest(pairing.requestId)?.status,
      "pending"
    );
    assert.equal(runtime.store.readClientBySubjectId(pairing.requestId), null);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
