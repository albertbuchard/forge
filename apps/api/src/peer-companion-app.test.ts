import assert from "node:assert/strict";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
  type KeyObject
} from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { PEER_ROUTE_CONTRACTS } from "./peer-route-contract.js";
import {
  PEER_COMPANION_AUTHORIZED_OPERATION_IDS,
  PEER_COMPANION_CAPABILITIES,
  PEER_COMPANION_REQUEST_PROTOCOL,
  PEER_COMPANION_SCOPES,
  canonicalPeerCompanionRequest,
  hashPeerCompanionRequestBody,
  peerCompanionDeviceId,
  type PeerCompanionRequestProof
} from "./services/peer-companion-auth.js";
import {
  canonicalPeerCompanionConsentSignature,
  type PeerCompanionConsentOptions
} from "./services/peer-companion-consent.js";
import {
  PEER_COMPANION_CONSENT_PROTOCOL,
  PEER_COMPANION_ENROLLMENT_PROTOCOL
} from "./services/peer-companion-contract.js";
import {
  canonicalPeerCompanionEnrollmentProof,
  type PeerCompanionEnrollmentOptions,
  type PeerCompanionEnrollmentReceipt
} from "./services/peer-companion-enrollment.js";
import type { PeerPresenceAction } from "./services/peer-human-presence.js";

const ownerUserId = "user_operator";
const host = "127.0.0.1:4317";

test("v2 companion authority exactly matches companion-capable peer routes", () => {
  const companionRoutes = PEER_ROUTE_CONTRACTS.filter((route) =>
    route.principalClasses.some(
      (principal) =>
        principal === "companion_session" || principal === "companion_consent"
    )
  );
  const authorized = [...PEER_COMPANION_AUTHORIZED_OPERATION_IDS].sort();
  const authorizedOperationIds: ReadonlySet<string> = new Set(authorized);

  assert.deepEqual(
    authorized,
    companionRoutes.map((route) => route.operationId).sort()
  );
  assert.deepEqual(
    [...PEER_COMPANION_SCOPES].sort(),
    [
      ...new Set(companionRoutes.flatMap((route) => route.requiredScopes))
    ].sort()
  );

  for (const route of PEER_ROUTE_CONTRACTS) {
    const advertisesCompanion = route.principalClasses.some(
      (principal) =>
        principal === "companion_session" || principal === "companion_consent"
    );
    assert.equal(
      authorizedOperationIds.has(route.operationId),
      advertisesCompanion,
      route.operationId
    );
  }

  assert.deepEqual(
    companionRoutes
      .filter((route) => route.principalClasses.includes("companion_session"))
      .filter((route) => !authorizedOperationIds.has(route.operationId)),
    []
  );
  assert.equal(
    authorizedOperationIds.has("createPeerCompanionEnrollmentOptions"),
    false
  );
  assert.equal(
    authorizedOperationIds.has("verifyPeerCompanionEnrollment"),
    false
  );
  assert.equal(
    authorizedOperationIds.has("revokePeerHumanPresenceCredential"),
    false
  );
});

type P256Device = {
  deviceId: string;
  publicKey: string;
  privateKey: KeyObject;
  algorithm: "ES256";
  publicKeyFormat: "ansi-x963";
  protection: "secure-enclave-user-presence";
};

type PairedCompanion = {
  sessionId: string;
  pairingToken: string;
  operatorCookie: string;
};

type EnrolledCompanion = PairedCompanion &
  P256Device & {
    enrollmentId: string;
    keyId: string;
  };

function p256Device(pair: {
  privateKey: KeyObject;
  publicKey: KeyObject;
}): P256Device {
  const jwk = pair.publicKey.export({ format: "jwk" });
  assert.equal(jwk.kty, "EC");
  assert.equal(jwk.crv, "P-256");
  assert.ok(jwk.x);
  assert.ok(jwk.y);
  const publicKey = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url")
  ]).toString("base64url");
  return {
    deviceId: peerCompanionDeviceId(publicKey),
    publicKey,
    privateKey: pair.privateKey,
    algorithm: "ES256",
    publicKeyFormat: "ansi-x963",
    protection: "secure-enclave-user-presence"
  };
}

function createDevice(): P256Device {
  return p256Device(generateKeyPairSync("ec", { namedCurve: "prime256v1" }));
}

function nativeDeterministicDevice(): P256Device {
  const privateKey = createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      d: Buffer.concat([Buffer.alloc(31), Buffer.from([1])]).toString(
        "base64url"
      ),
      x: Buffer.from(
        "6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296",
        "hex"
      ).toString("base64url"),
      y: Buffer.from(
        "4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5",
        "hex"
      ).toString("base64url")
    }
  });
  return p256Device({ privateKey, publicKey: createPublicKey(privateKey) });
}

async function withServer(
  run: (app: Awaited<ReturnType<typeof buildServer>>) => Promise<void>
) {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-peer-companion-v2-")
  );
  await chmod(dataRoot, 0o700);
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    taskRunWatchdog: false,
    devrageMetricSync: false
  });
  try {
    await app.ready();
    await run(app);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
}

async function createOperatorCookie(
  app: Awaited<ReturnType<typeof buildServer>>
) {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/auth/operator-session",
    headers: { host }
  });
  assert.equal(response.statusCode, 200, response.body);
  const cookie = response.cookies[0];
  assert.ok(cookie);
  return `${cookie.name}=${cookie.value}`;
}

async function establishCompanion(
  app: Awaited<ReturnType<typeof buildServer>>
): Promise<PairedCompanion> {
  const operatorCookie = await createOperatorCookie(app);
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/health/pairing-sessions",
    headers: { host, cookie: operatorCookie },
    payload: { userId: ownerUserId }
  });
  assert.equal(created.statusCode, 201, created.body);
  const pairing = created.json() as {
    qrPayload: { sessionId: string; pairingToken: string };
  };
  const verified = await app.inject({
    method: "POST",
    url: "/api/v1/mobile/pairing/verify",
    payload: {
      sessionId: pairing.qrPayload.sessionId,
      pairingToken: pairing.qrPayload.pairingToken,
      device: {
        name: "Secure Enclave integration iPhone",
        platform: "ios",
        appVersion: "2.0",
        sourceDevice: "iPhone"
      }
    }
  });
  assert.equal(verified.statusCode, 200, verified.body);
  return {
    sessionId: pairing.qrPayload.sessionId,
    pairingToken: pairing.qrPayload.pairingToken,
    operatorCookie
  };
}

async function enrollCompanion(
  app: Awaited<ReturnType<typeof buildServer>>,
  pairing: PairedCompanion,
  device = createDevice()
): Promise<EnrolledCompanion> {
  const enrollmentAttemptId = `attempt_${randomBytes(16).toString("hex")}`;
  const optionsBody = {
    protocol: PEER_COMPANION_ENROLLMENT_PROTOCOL,
    enrollmentAttemptId,
    pairingSessionId: pairing.sessionId,
    device: {
      deviceId: device.deviceId,
      publicKey: device.publicKey,
      algorithm: device.algorithm,
      publicKeyFormat: device.publicKeyFormat,
      protection: device.protection
    }
  };
  const optionsResponse = await app.inject({
    method: "POST",
    url: "/api/v1/peers/companion-enrollments/options",
    headers: { host, cookie: pairing.operatorCookie },
    payload: optionsBody
  });
  assert.equal(optionsResponse.statusCode, 200, optionsResponse.body);
  const options = optionsResponse.json() as PeerCompanionEnrollmentOptions;
  assert.deepEqual(options.device, optionsBody.device);
  const signature = sign(
    "sha256",
    canonicalPeerCompanionEnrollmentProof({
      algorithm: options.device.algorithm,
      challenge: options.challenge,
      challengeId: options.challengeId,
      deviceId: options.device.deviceId,
      enrollmentAttemptId: options.enrollmentAttemptId,
      expiresAt: options.expiresAt,
      issuedAt: options.issuedAt,
      ownerUserId: options.ownerUserId,
      pairingSessionId: options.pairingSessionId,
      protocol: options.protocol,
      publicKey: options.device.publicKey,
      publicKeyFormat: options.device.publicKeyFormat,
      protection: options.device.protection
    }),
    device.privateKey
  ).toString("base64url");
  const verified = await app.inject({
    method: "POST",
    url: "/api/v1/peers/companion-enrollments/verify",
    headers: { host, cookie: pairing.operatorCookie },
    payload: {
      protocol: PEER_COMPANION_ENROLLMENT_PROTOCOL,
      challengeId: options.challengeId,
      enrollmentAttemptId,
      pairingSessionId: pairing.sessionId,
      signature
    }
  });
  assert.equal(verified.statusCode, 200, verified.body);
  const receipt = verified.json() as PeerCompanionEnrollmentReceipt;
  return {
    ...pairing,
    ...device,
    enrollmentId: receipt.enrollmentId,
    keyId: receipt.keyId
  };
}

function signedRequestHeaders(
  credential: EnrolledCompanion,
  input: {
    method: "GET" | "POST" | "DELETE";
    path: string;
    body?: unknown;
    nonce?: string;
    issuedAt?: string;
    privateKey?: KeyObject;
  }
) {
  const proof: PeerCompanionRequestProof = {
    bodySha256: hashPeerCompanionRequestBody(input.body),
    deviceId: credential.deviceId,
    enrollmentId: credential.enrollmentId,
    issuedAt: input.issuedAt ?? new Date().toISOString(),
    keyId: credential.keyId,
    method: input.method,
    nonce: input.nonce ?? randomBytes(16).toString("base64url"),
    ownerUserId,
    path: input.path,
    protocol: PEER_COMPANION_REQUEST_PROTOCOL,
    sessionId: credential.sessionId
  };
  const signature = sign(
    "sha256",
    canonicalPeerCompanionRequest(proof),
    input.privateKey ?? credential.privateKey
  ).toString("base64url");
  return {
    host,
    "X-Forge-Companion-Session-Id": credential.sessionId,
    "X-Forge-Companion-Device-Id": credential.deviceId,
    "X-Forge-Companion-Enrollment-Id": credential.enrollmentId,
    "X-Forge-Companion-Key-Id": credential.keyId,
    "X-Forge-Companion-Key-Algorithm": "ES256",
    "X-Forge-Companion-Request-Protocol": PEER_COMPANION_REQUEST_PROTOCOL,
    "X-Forge-Companion-Request-Nonce": proof.nonce,
    "X-Forge-Companion-Request-Issued-At": proof.issuedAt,
    "X-Forge-Companion-Request-Signature": signature
  };
}

function invitationAction(): PeerPresenceAction {
  return {
    ownerUserId,
    method: "POST",
    routePath: "/api/v1/peers/invitations",
    pathParams: {},
    expectedVersion: null,
    body: {
      label: "P-256 companion invitation",
      expiresInSeconds: 300,
      privacyMode: "fastest",
      transportKinds: ["iroh"],
      idempotencyKey: "companion-v2-invitation-0001"
    }
  };
}

test("server canonical request bytes match the native P-256 v2 wire contract", () => {
  const device = nativeDeterministicDevice();
  const proof: PeerCompanionRequestProof = {
    bodySha256:
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    deviceId: device.deviceId,
    enrollmentId: "pce_11111111111111111111111111111111",
    issuedAt: "2026-07-15T12:00:00Z",
    keyId: "pck_22222222222222222222222222222222",
    method: "GET",
    nonce: "0123456789abcdef0123456789abcdef",
    ownerUserId: ownerUserId,
    path: "/api/v1/peers/relationships?limit=100",
    protocol: PEER_COMPANION_REQUEST_PROTOCOL,
    sessionId: "pair-swift-wire-fixture"
  };
  const canonical = canonicalPeerCompanionRequest(proof);
  assert.equal(
    canonical.toString("utf8"),
    `{"bodySha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","deviceId":"${device.deviceId}","enrollmentId":"pce_11111111111111111111111111111111","issuedAt":"2026-07-15T12:00:00Z","keyId":"pck_22222222222222222222222222222222","method":"GET","nonce":"0123456789abcdef0123456789abcdef","ownerUserId":"user_operator","path":"/api/v1/peers/relationships?limit=100","protocol":"forge-peer-companion-request/v2","sessionId":"pair-swift-wire-fixture"}`
  );
  const signature = sign("sha256", canonical, device.privateKey);
  assert.equal(
    verify("sha256", canonical, createPublicKey(device.privateKey), signature),
    true
  );
});

test("operator-only enrollment rejects stolen bootstrap and key substitution", async () => {
  await withServer(async (app) => {
    const pairing = await establishCompanion(app);
    const device = createDevice();
    const optionsBody = {
      protocol: PEER_COMPANION_ENROLLMENT_PROTOCOL,
      enrollmentAttemptId: "attempt_attacker_first_0001",
      pairingSessionId: pairing.sessionId,
      device: {
        deviceId: device.deviceId,
        publicKey: device.publicKey,
        algorithm: device.algorithm,
        publicKeyFormat: device.publicKeyFormat,
        protection: device.protection
      }
    };
    const stolenToken = await app.inject({
      method: "POST",
      url: "/api/v1/peers/companion-enrollments/options",
      headers: {
        host,
        "X-Forge-Companion-Pairing-Token": pairing.pairingToken
      },
      payload: optionsBody
    });
    assert.equal(stolenToken.statusCode, 401, stolenToken.body);
    assert.equal(
      stolenToken.json().code,
      "peer_companion_enrollment_operator_required"
    );

    const optionsResponse = await app.inject({
      method: "POST",
      url: "/api/v1/peers/companion-enrollments/options",
      headers: { host, cookie: pairing.operatorCookie },
      payload: optionsBody
    });
    assert.equal(optionsResponse.statusCode, 200, optionsResponse.body);
    const options = optionsResponse.json() as PeerCompanionEnrollmentOptions;
    const attacker = createDevice();
    const substitutedSignature = sign(
      "sha256",
      canonicalPeerCompanionEnrollmentProof({
        algorithm: options.device.algorithm,
        challenge: options.challenge,
        challengeId: options.challengeId,
        deviceId: options.device.deviceId,
        enrollmentAttemptId: options.enrollmentAttemptId,
        expiresAt: options.expiresAt,
        issuedAt: options.issuedAt,
        ownerUserId: options.ownerUserId,
        pairingSessionId: options.pairingSessionId,
        protocol: options.protocol,
        publicKey: options.device.publicKey,
        publicKeyFormat: options.device.publicKeyFormat,
        protection: options.device.protection
      }),
      attacker.privateKey
    ).toString("base64url");
    const substitution = await app.inject({
      method: "POST",
      url: "/api/v1/peers/companion-enrollments/verify",
      headers: { host, cookie: pairing.operatorCookie },
      payload: {
        protocol: PEER_COMPANION_ENROLLMENT_PROTOCOL,
        challengeId: options.challengeId,
        enrollmentAttemptId: options.enrollmentAttemptId,
        pairingSessionId: pairing.sessionId,
        signature: substitutedSignature
      }
    });
    assert.equal(substitution.statusCode, 401, substitution.body);
    assert.equal(
      substitution.json().code,
      "peer_companion_enrollment_signature_invalid"
    );
    assert.equal(
      (
        getDatabase()
          .prepare("SELECT COUNT(*) AS count FROM peer_companion_enrollments")
          .get() as { count: number }
      ).count,
      0
    );
  });
});

test("enrollment disables legacy bootstrap and returns the exact native receipt", async () => {
  await withServer(async (app) => {
    const pairing = await establishCompanion(app);
    const legacy = generateKeyPairSync("ed25519").publicKey.export({
      format: "jwk"
    });
    assert.ok(legacy.x);
    const now = new Date().toISOString();
    getDatabase()
      .prepare(
        `INSERT INTO peer_companion_credentials (
           pairing_session_id, owner_user_id, device_id, signing_public_key,
           scopes_json, capabilities_json, status, registered_at,
           last_authenticated_at, revoked_at, updated_at
         ) VALUES (?, ?, ?, ?, '[]', '[]', 'active', ?, ?, NULL, ?)`
      )
      .run(
        pairing.sessionId,
        ownerUserId,
        `ios_${"a".repeat(32)}`,
        legacy.x,
        now,
        now,
        now
      );
    const enrolled = await enrollCompanion(
      app,
      pairing,
      nativeDeterministicDevice()
    );
    const row = getDatabase()
      .prepare(
        `SELECT enrollment_id AS enrollmentId, key_id AS keyId,
                legacy_bootstrap_disabled_at AS disabledAt
         FROM peer_companion_enrollments WHERE pairing_session_id = ?`
      )
      .get(pairing.sessionId) as {
      enrollmentId: string;
      keyId: string;
      disabledAt: string;
    };
    assert.equal(row.enrollmentId, enrolled.enrollmentId);
    assert.equal(row.keyId, enrolled.keyId);
    assert.ok(Number.isFinite(Date.parse(row.disabledAt)));
    assert.equal(
      (
        getDatabase()
          .prepare(
            "SELECT status FROM peer_companion_credentials WHERE pairing_session_id = ?"
          )
          .get(pairing.sessionId) as { status: string }
      ).status,
      "revoked"
    );
    const policy = getDatabase()
      .prepare(
        `SELECT scopes_json AS scopes, capabilities_json AS capabilities,
                authorized_operations_json AS operations
         FROM peer_companion_enrollments WHERE enrollment_id = ?`
      )
      .get(enrolled.enrollmentId) as {
      scopes: string;
      capabilities: string;
      operations: string;
    };
    assert.deepEqual(JSON.parse(policy.scopes), PEER_COMPANION_SCOPES);
    assert.deepEqual(
      JSON.parse(policy.capabilities),
      PEER_COMPANION_CAPABILITIES
    );
    assert.deepEqual(
      JSON.parse(policy.operations),
      PEER_COMPANION_AUTHORIZED_OPERATION_IDS
    );
  });
});

test("registered v2 requests reject replay, legacy headers, tamper, and key substitution", async () => {
  await withServer(async (app) => {
    const credential = await enrollCompanion(
      app,
      await establishCompanion(app)
    );
    const statusPath = "/api/v1/peers/human-presence";
    const headers = signedRequestHeaders(credential, {
      method: "GET",
      path: statusPath,
      nonce: "0123456789abcdef0123456789abcdef"
    });
    const first = await app.inject({ method: "GET", url: statusPath, headers });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(
      first.json().methods.companionConsent.protocol,
      PEER_COMPANION_CONSENT_PROTOCOL
    );
    assert.equal(
      first.json().methods.companionConsent.requestProtocol,
      PEER_COMPANION_REQUEST_PROTOCOL
    );
    const replay = await app.inject({
      method: "GET",
      url: statusPath,
      headers
    });
    assert.equal(replay.statusCode, 409, replay.body);
    assert.equal(replay.json().code, "peer_companion_request_replayed");

    const legacy = await app.inject({
      method: "GET",
      url: statusPath,
      headers: {
        ...signedRequestHeaders(credential, {
          method: "GET",
          path: statusPath
        }),
        "X-Forge-Companion-Pairing-Token": credential.pairingToken,
        "X-Forge-Companion-Public-Key": credential.publicKey
      }
    });
    assert.equal(legacy.statusCode, 401, legacy.body);
    assert.equal(
      legacy.json().code,
      "peer_companion_legacy_bootstrap_disabled"
    );

    const wrongKey = await app.inject({
      method: "GET",
      url: statusPath,
      headers: signedRequestHeaders(credential, {
        method: "GET",
        path: statusPath,
        privateKey: createDevice().privateKey
      })
    });
    assert.equal(wrongKey.statusCode, 401, wrongKey.body);
    assert.equal(
      wrongKey.json().code,
      "peer_companion_request_signature_invalid"
    );

    const pathTamper = await app.inject({
      method: "GET",
      url: `${statusPath}?tampered=true`,
      headers: signedRequestHeaders(credential, {
        method: "GET",
        path: statusPath
      })
    });
    assert.equal(pathTamper.statusCode, 401, pathTamper.body);
    assert.equal(
      pathTamper.json().code,
      "peer_companion_request_signature_invalid"
    );

    const concurrentHeaders = signedRequestHeaders(credential, {
      method: "GET",
      path: statusPath,
      nonce: "fedcba9876543210fedcba9876543210"
    });
    const concurrent = await Promise.all([
      app.inject({
        method: "GET",
        url: statusPath,
        headers: concurrentHeaders
      }),
      app.inject({ method: "GET", url: statusPath, headers: concurrentHeaders })
    ]);
    assert.deepEqual(
      concurrent.map((response) => response.statusCode).sort(),
      [200, 409]
    );
  });
});

test("companion consent signs only server challenge time and rejects caller time", async () => {
  await withServer(async (app) => {
    const credential = await enrollCompanion(
      app,
      await establishCompanion(app)
    );
    const action = invitationAction();
    const optionsPath = "/api/v1/peers/human-presence/options";
    const optionsBody = {
      ceremony: "companion_consent",
      action,
      companionDeviceId: credential.deviceId
    };
    const optionsResponse = await app.inject({
      method: "POST",
      url: optionsPath,
      headers: signedRequestHeaders(credential, {
        method: "POST",
        path: optionsPath,
        body: optionsBody
      }),
      payload: optionsBody
    });
    assert.equal(optionsResponse.statusCode, 200, optionsResponse.body);
    const options = optionsResponse.json() as PeerCompanionConsentOptions;
    const signature = sign(
      "sha256",
      canonicalPeerCompanionConsentSignature({
        ...options,
        algorithm: "ES256",
        keyId: credential.keyId
      }),
      credential.privateKey
    ).toString("base64url");
    const verification = {
      challengeId: options.challengeId,
      action,
      verification: {
        kind: "companion_signature",
        deviceId: credential.deviceId,
        challenge: options.challenge,
        signature,
        algorithm: "ES256",
        keyId: credential.keyId
      }
    };
    const verifyPath = "/api/v1/peers/human-presence/verify";
    const callerTime = await app.inject({
      method: "POST",
      url: verifyPath,
      headers: signedRequestHeaders(credential, {
        method: "POST",
        path: verifyPath,
        body: {
          ...verification,
          verification: {
            ...verification.verification,
            authenticatedAt: "2099-01-01T00:00:00.000Z"
          }
        }
      }),
      payload: {
        ...verification,
        verification: {
          ...verification.verification,
          authenticatedAt: "2099-01-01T00:00:00.000Z"
        }
      }
    });
    assert.equal(callerTime.statusCode, 400, callerTime.body);

    const accepted = await app.inject({
      method: "POST",
      url: verifyPath,
      headers: signedRequestHeaders(credential, {
        method: "POST",
        path: verifyPath,
        body: verification
      }),
      payload: verification
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(accepted.json().approved, true);
    assert.equal(accepted.json().protocol, PEER_COMPANION_CONSENT_PROTOCOL);
    const timing = getDatabase()
      .prepare(
        `SELECT challenge.issued_at AS issuedAt,
                challenge.consumed_at AS consumedAt,
                capability.issued_at AS capabilityIssuedAt
         FROM forge_human_presence_challenges AS challenge
         JOIN forge_human_presence_capabilities AS capability
           ON capability.challenge_id = challenge.id
         WHERE challenge.id = ?`
      )
      .get(options.challengeId) as {
      issuedAt: string;
      consumedAt: string;
      capabilityIssuedAt: string;
    };
    assert.ok(Date.parse(timing.consumedAt) >= Date.parse(timing.issuedAt));
    assert.ok(
      Date.parse(timing.consumedAt) - Date.parse(timing.capabilityIssuedAt) >= 0
    );
    assert.ok(
      Date.parse(timing.consumedAt) - Date.parse(timing.capabilityIssuedAt) <
        1_000
    );
  });
});

test("enrollment verification is bound to the issuing operator session", async () => {
  await withServer(async (app) => {
    const pairing = await establishCompanion(app);
    const otherCookie = await createOperatorCookie(app);
    const device = createDevice();
    const body = {
      protocol: PEER_COMPANION_ENROLLMENT_PROTOCOL,
      enrollmentAttemptId: "attempt_session_substitution_0001",
      pairingSessionId: pairing.sessionId,
      device: {
        deviceId: device.deviceId,
        publicKey: device.publicKey,
        algorithm: device.algorithm,
        publicKeyFormat: device.publicKeyFormat,
        protection: device.protection
      }
    };
    const issued = await app.inject({
      method: "POST",
      url: "/api/v1/peers/companion-enrollments/options",
      headers: { host, cookie: pairing.operatorCookie },
      payload: body
    });
    assert.equal(issued.statusCode, 200, issued.body);
    const options = issued.json() as PeerCompanionEnrollmentOptions;
    const signature = sign(
      "sha256",
      canonicalPeerCompanionEnrollmentProof({
        algorithm: options.device.algorithm,
        challenge: options.challenge,
        challengeId: options.challengeId,
        deviceId: options.device.deviceId,
        enrollmentAttemptId: options.enrollmentAttemptId,
        expiresAt: options.expiresAt,
        issuedAt: options.issuedAt,
        ownerUserId: options.ownerUserId,
        pairingSessionId: options.pairingSessionId,
        protocol: options.protocol,
        publicKey: options.device.publicKey,
        publicKeyFormat: options.device.publicKeyFormat,
        protection: options.device.protection
      }),
      device.privateKey
    ).toString("base64url");
    const substituted = await app.inject({
      method: "POST",
      url: "/api/v1/peers/companion-enrollments/verify",
      headers: { host, cookie: otherCookie },
      payload: {
        protocol: PEER_COMPANION_ENROLLMENT_PROTOCOL,
        challengeId: options.challengeId,
        enrollmentAttemptId: options.enrollmentAttemptId,
        pairingSessionId: pairing.sessionId,
        signature
      }
    });
    assert.equal(substituted.statusCode, 409, substituted.body);
    assert.equal(
      substituted.json().code,
      "peer_companion_enrollment_challenge_invalid"
    );
  });
});
