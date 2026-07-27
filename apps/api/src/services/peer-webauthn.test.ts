import assert from "node:assert/strict";
import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomBytes
} from "node:crypto";
import test from "node:test";
import {
  createPeerWebAuthnOptions,
  peerWebAuthnChallengeMatches,
  peerWebAuthnCredentialSetVersion,
  resolvePeerWebAuthnRelyingParty,
  verifyPeerWebAuthnCeremony,
  type PeerWebAuthnChallengeRecord,
  type PeerWebAuthnCredentialRecord,
  type PeerWebAuthnStore
} from "./peer-webauthn.js";
import { createPeerOwnerWebAuthnAuthority } from "../security/owner-webauthn.js";

const hashingKey = new Uint8Array(32).fill(23);
const action = {
  ownerUserId: "user_owner",
  method: "POST" as const,
  routePath: "/api/v1/peers/grants/:grantId/revoke",
  pathParams: { grantId: "grant_1" },
  expectedVersion: "grant_hash_4",
  body: { purgeManagedCache: true }
};

class MemoryWebAuthnStore implements PeerWebAuthnStore {
  credentials: PeerWebAuthnCredentialRecord[] = [];
  challenges: PeerWebAuthnChallengeRecord[] = [];

  listActiveCredentials(ownerUserId: string, rpId: string) {
    return this.credentials.filter(
      (credential) =>
        credential.ownerUserId === ownerUserId && credential.rpId === rpId
    );
  }

  createChallenge(record: PeerWebAuthnChallengeRecord) {
    this.challenges.push(record);
  }

  claimChallenge(input: {
    id: string;
    principal: {
      ownerUserId: string;
      principalClass: "operator_session" | "companion_consent";
      principalId: string;
      origin: string | null;
    };
    actionDigest: string;
    rpId: string;
    expectedOrigin: string;
    now: string;
  }): PeerWebAuthnChallengeRecord | null {
    const challenge = this.challenges.find(
      (candidate) =>
        candidate.id === input.id &&
        candidate.ownerUserId === input.principal.ownerUserId &&
        candidate.principalClass === input.principal.principalClass &&
        candidate.principalId === input.principal.principalId &&
        candidate.origin === input.principal.origin &&
        candidate.actionDigest === input.actionDigest &&
        candidate.rpId === input.rpId &&
        candidate.expectedOrigin === input.expectedOrigin &&
        !candidate.consumedAt &&
        Date.parse(candidate.expiresAt) > Date.parse(input.now)
    );
    if (!challenge) {
      return null;
    }
    challenge.consumedAt = input.now;
    return challenge;
  }

  createCredential(record: PeerWebAuthnCredentialRecord) {
    this.credentials.push(record);
    return true;
  }

  updateCredentialAfterAuthentication(input: {
    id: string;
    expectedCounter: number;
    newCounter: number;
    usedAt: string;
  }) {
    const credential = this.credentials.find(
      (candidate) =>
        candidate.id === input.id &&
        candidate.counter === input.expectedCounter
    );
    if (!credential) {
      return false;
    }
    credential.counter = input.newCounter;
    credential.lastUsedAt = input.usedAt;
    return true;
  }
}

type TestCbor =
  | number
  | string
  | Uint8Array
  | ReadonlyMap<number | string, TestCbor>;

function cborHeader(major: number, length: number) {
  if (length < 24) {
    return Buffer.from([(major << 5) | length]);
  }
  if (length <= 0xff) {
    return Buffer.from([(major << 5) | 24, length]);
  }
  if (length <= 0xffff) {
    const result = Buffer.alloc(3);
    result[0] = (major << 5) | 25;
    result.writeUInt16BE(length, 1);
    return result;
  }
  throw new Error("Test CBOR value exceeds its bounded encoder.");
}

function encodeTestCbor(value: TestCbor): Buffer {
  if (typeof value === "number") {
    return value >= 0
      ? cborHeader(0, value)
      : cborHeader(1, -1 - value);
  }
  if (typeof value === "string") {
    const encoded = Buffer.from(value, "utf8");
    return Buffer.concat([cborHeader(3, encoded.length), encoded]);
  }
  if (value instanceof Uint8Array) {
    const encoded = Buffer.from(value);
    return Buffer.concat([cborHeader(2, encoded.length), encoded]);
  }
  const entries = [...value.entries()];
  return Buffer.concat([
    cborHeader(5, entries.length),
    ...entries.flatMap(([key, entry]) => [
      encodeTestCbor(key),
      encodeTestCbor(entry)
    ])
  ]);
}

function createRegistrationResponse(input: {
  challenge: string;
  origin: string;
  rpId: string;
}) {
  const credentialId = randomBytes(32);
  const keyPair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicJwk = keyPair.publicKey.export({ format: "jwk" });
  assert.equal(typeof publicJwk.x, "string");
  assert.equal(typeof publicJwk.y, "string");
  const cosePublicKey = encodeTestCbor(
    new Map<number, TestCbor>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(publicJwk.x!, "base64url")],
      [-3, Buffer.from(publicJwk.y!, "base64url")]
    ])
  );
  const credentialLength = Buffer.alloc(2);
  credentialLength.writeUInt16BE(credentialId.length);
  const authenticatorData = Buffer.concat([
    createHash("sha256").update(input.rpId).digest(),
    Buffer.from([0x45]),
    Buffer.alloc(4),
    Buffer.alloc(16),
    credentialLength,
    credentialId,
    cosePublicKey
  ]);
  const attestationObject = encodeTestCbor(
    new Map<string, TestCbor>([
      ["fmt", "none"],
      ["attStmt", new Map()],
      ["authData", authenticatorData]
    ])
  );
  const clientData = Buffer.from(
    JSON.stringify({
      type: "webauthn.create",
      challenge: input.challenge,
      origin: input.origin,
      crossOrigin: false
    }),
    "utf8"
  );
  const encodedCredentialId = credentialId.toString("base64url");
  return {
    keyPair,
    credentialId: encodedCredentialId,
    response: {
      id: encodedCredentialId,
      rawId: encodedCredentialId,
      response: {
        clientDataJSON: clientData.toString("base64url"),
        attestationObject: attestationObject.toString("base64url"),
        transports: ["internal" as const]
      },
      authenticatorAttachment: "platform" as const,
      clientExtensionResults: {},
      type: "public-key" as const
    }
  };
}

function createAuthenticationResponse(input: {
  challenge: string;
  origin: string;
  rpId: string;
  credentialId: string;
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
  counter: number;
}) {
  const clientData = Buffer.from(
    JSON.stringify({
      type: "webauthn.get",
      challenge: input.challenge,
      origin: input.origin,
      crossOrigin: false
    }),
    "utf8"
  );
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(input.counter);
  const authenticatorData = Buffer.concat([
    createHash("sha256").update(input.rpId).digest(),
    Buffer.from([0x05]),
    counter
  ]);
  const signature = createSign("SHA256")
    .update(
      Buffer.concat([
        authenticatorData,
        createHash("sha256").update(clientData).digest()
      ])
    )
    .end()
    .sign(input.privateKey);
  return {
    id: input.credentialId,
    rawId: input.credentialId,
    response: {
      clientDataJSON: clientData.toString("base64url"),
      authenticatorData: authenticatorData.toString("base64url"),
      signature: signature.toString("base64url")
    },
    authenticatorAttachment: "platform" as const,
    clientExtensionResults: {},
    type: "public-key" as const
  };
}

test("WebAuthn relying party accepts HTTPS and loopback HTTP only", () => {
  assert.deepEqual(resolvePeerWebAuthnRelyingParty("http://127.0.0.1:4317"), {
    origin: "http://127.0.0.1:4317",
    rpId: "127.0.0.1",
    loopback: true
  });
  assert.deepEqual(resolvePeerWebAuthnRelyingParty("https://forge.example"), {
    origin: "https://forge.example",
    rpId: "forge.example",
    loopback: false
  });
  assert.throws(
    () => resolvePeerWebAuthnRelyingParty("http://forge.example"),
    /requires HTTPS/
  );
  assert.throws(
    () => resolvePeerWebAuthnRelyingParty("https://forge.example/path"),
    /exact Forge origin/
  );
});

test("first credential registration is loopback-only and stores no raw challenge", async () => {
  const store = new MemoryWebAuthnStore();
  const principal = {
    principalClass: "operator_session" as const,
    principalId: "session_owner",
    ownerUserId: "user_owner",
    origin: "http://127.0.0.1:4317"
  };
  const result = await createPeerWebAuthnOptions({
    ceremony: "register",
    action,
    principal,
    origin: principal.origin,
    hashingKey,
    store,
    now: new Date("2026-07-15T12:00:00.000Z")
  });
  assert.equal(result.ceremony, "register");
  assert.equal(store.challenges.length, 1);
  assert.notEqual(store.challenges[0]!.challengeHash, result.options.challenge);
  assert.equal(
    peerWebAuthnChallengeMatches(
      result.options.challenge,
      store.challenges[0]!.challengeHash,
      hashingKey
    ),
    true
  );

  await assert.rejects(
    createPeerWebAuthnOptions({
      ceremony: "register",
      action,
      principal: { ...principal, origin: "https://forge.example" },
      origin: "https://forge.example",
      hashingKey,
      store: new MemoryWebAuthnStore()
    }),
    /first approval credential must be registered on loopback/
  );
});

test("authentication requires a credential and additional registration requires approval", async () => {
  const store = new MemoryWebAuthnStore();
  const principal = {
    principalClass: "operator_session" as const,
    principalId: "session_owner",
    ownerUserId: "user_owner",
    origin: "https://forge.example"
  };
  await assert.rejects(
    createPeerWebAuthnOptions({
      ceremony: "authenticate",
      action,
      principal,
      origin: principal.origin,
      hashingKey,
      store
    }),
    /No approval credential/
  );
  store.credentials.push({
    id: "credential_1",
    ownerUserId: "user_owner",
    rpId: "forge.example",
    credentialId: "credential-id",
    publicKeyBase64: Buffer.from([1, 2, 3]).toString("base64"),
    counter: 0,
    transports: ["internal"],
    label: "Touch ID",
    deviceType: "singleDevice",
    backedUp: false,
    aaguid: "00000000-0000-0000-0000-000000000000",
    createdAt: "2026-07-15T10:00:00.000Z",
    lastUsedAt: null
  });
  await assert.rejects(
    createPeerWebAuthnOptions({
      ceremony: "register",
      action,
      principal,
      origin: principal.origin,
      hashingKey,
      store
    }),
    /requires a current approval/
  );
  assert.equal(peerWebAuthnCredentialSetVersion(store.credentials).length, 64);
});

test("cryptographic registration and authorized replacement store real passkeys and reject replay", async () => {
  const store = new MemoryWebAuthnStore();
  const principal = {
    principalClass: "operator_session" as const,
    principalId: "session_owner",
    ownerUserId: "user_owner",
    origin: "http://127.0.0.1:4317"
  };
  const firstOptions = await createPeerWebAuthnOptions({
    ceremony: "register",
    action,
    principal,
    origin: principal.origin,
    hashingKey,
    credentialLabel: "Primary passkey",
    store,
    now: new Date("2026-07-15T12:00:00.000Z")
  });
  const firstAuthenticator = createRegistrationResponse({
    challenge: firstOptions.options.challenge,
    origin: principal.origin,
    rpId: "127.0.0.1"
  });
  const firstVerification = {
    challengeId: firstOptions.challengeId,
    action,
    principal,
    origin: principal.origin,
    response: firstAuthenticator.response,
    capabilityId: "capability_registration_1",
    capabilityHashingKey: new Uint8Array(32).fill(47),
    challengeHashingKey: hashingKey,
    store,
    now: new Date("2026-07-15T12:00:30.000Z")
  };
  const first = await verifyPeerWebAuthnCeremony(firstVerification);
  assert.equal(first.credential.credentialId, firstAuthenticator.credentialId);
  assert.equal(first.credential.label, "Primary passkey");
  assert.ok(Buffer.from(first.credential.publicKeyBase64, "base64").length > 64);
  await assert.rejects(
    verifyPeerWebAuthnCeremony(firstVerification),
    /already used/
  );

  const replacementOptions = await createPeerWebAuthnOptions({
    ceremony: "register",
    action,
    principal,
    origin: principal.origin,
    hashingKey,
    credentialLabel: "Recovery passkey",
    additionalRegistrationAuthorized: true,
    store,
    now: new Date("2026-07-15T12:01:00.000Z")
  });
  const replacementAuthenticator = createRegistrationResponse({
    challenge: replacementOptions.options.challenge,
    origin: principal.origin,
    rpId: "127.0.0.1"
  });
  const replacement = await verifyPeerWebAuthnCeremony({
    challengeId: replacementOptions.challengeId,
    action,
    principal,
    origin: principal.origin,
    response: replacementAuthenticator.response,
    capabilityId: "capability_registration_2",
    capabilityHashingKey: new Uint8Array(32).fill(47),
    challengeHashingKey: hashingKey,
    store,
    now: new Date("2026-07-15T12:01:30.000Z")
  });
  assert.equal(
    replacement.credential.credentialId,
    replacementAuthenticator.credentialId
  );
  assert.equal(replacement.credential.label, "Recovery passkey");
  assert.deepEqual(
    store.credentials.map((credential) => credential.label).sort(),
    ["Primary passkey", "Recovery passkey"]
  );

  const recoveryOptions = await createPeerWebAuthnOptions({
    ceremony: "authenticate",
    action,
    principal,
    origin: principal.origin,
    hashingKey,
    store,
    now: new Date("2026-07-15T12:02:00.000Z")
  });
  const recoveryAuthority = createPeerOwnerWebAuthnAuthority({
    now: () => new Date("2026-07-15T12:02:30.000Z")
  });
  const recoveryEvidence = await recoveryAuthority.verify("owner_recovery", {
    ceremony: {
      challengeId: recoveryOptions.challengeId,
      action,
      principal,
      origin: principal.origin,
      response: createAuthenticationResponse({
        challenge: recoveryOptions.options.challenge,
        origin: principal.origin,
        rpId: "127.0.0.1",
        credentialId: replacementAuthenticator.credentialId,
        privateKey: replacementAuthenticator.keyPair.privateKey,
        counter: 1
      }),
      capabilityId: "capability_recovery",
      capabilityHashingKey: new Uint8Array(32).fill(47),
      challengeHashingKey: hashingKey,
      store,
      now: new Date("2026-07-15T12:02:30.000Z")
    }
  });
  assert.equal(
    recoveryEvidence.credentialId,
    replacementAuthenticator.credentialId
  );
  recoveryAuthority.consume(recoveryEvidence, {
    ownerUserId: principal.ownerUserId,
    origin: principal.origin,
    relyingPartyId: "127.0.0.1",
    purpose: "owner_recovery"
  });
  assert.throws(
    () =>
      recoveryAuthority.consume(recoveryEvidence, {
        ownerUserId: principal.ownerUserId,
        origin: principal.origin,
        relyingPartyId: "127.0.0.1",
        purpose: "owner_recovery"
      }),
    /replayed/
  );
});

test("owner WebAuthn binds an opaque privileged action digest without minting a peer capability", async () => {
  const store = new MemoryWebAuthnStore();
  const principal = {
    principalClass: "operator_session" as const,
    principalId: "session_pairing_owner",
    ownerUserId: "user_owner",
    origin: "http://127.0.0.1:4317"
  };
  const actionDigest = createHash("sha256")
    .update("exact privileged pairing grant", "utf8")
    .digest("hex");
  const options = await createPeerWebAuthnOptions({
    ceremony: "register",
    actionDigest,
    principal,
    origin: principal.origin,
    hashingKey,
    credentialLabel: "Pairing passkey",
    store,
    now: new Date("2026-07-15T13:00:00.000Z")
  });
  const authenticator = createRegistrationResponse({
    challenge: options.options.challenge,
    origin: principal.origin,
    rpId: "127.0.0.1"
  });
  await assert.rejects(
    verifyPeerWebAuthnCeremony({
      challengeId: options.challengeId,
      actionDigest: createHash("sha256")
        .update("different privileged pairing grant", "utf8")
        .digest("hex"),
      principal,
      origin: principal.origin,
      response: authenticator.response,
      challengeHashingKey: hashingKey,
      store,
      now: new Date("2026-07-15T13:00:30.000Z")
    }),
    /invalid, expired, or already used/
  );

  const retryOptions = await createPeerWebAuthnOptions({
    ceremony: "register",
    actionDigest,
    principal,
    origin: principal.origin,
    hashingKey,
    credentialLabel: "Pairing passkey",
    store,
    now: new Date("2026-07-15T13:01:00.000Z")
  });
  const retryAuthenticator = createRegistrationResponse({
    challenge: retryOptions.options.challenge,
    origin: principal.origin,
    rpId: "127.0.0.1"
  });
  const verified = await verifyPeerWebAuthnCeremony({
    challengeId: retryOptions.challengeId,
    actionDigest,
    principal,
    origin: principal.origin,
    response: retryAuthenticator.response,
    challengeHashingKey: hashingKey,
    store,
    now: new Date("2026-07-15T13:01:30.000Z")
  });
  assert.equal(verified.capability, null);
  assert.equal(verified.credential.label, "Pairing passkey");
});

test("cryptographic WebAuthn authentication requires user verification and rejects challenge replay", async () => {
  const store = new MemoryWebAuthnStore();
  const principal = {
    principalClass: "operator_session" as const,
    principalId: "session_owner",
    ownerUserId: "user_owner",
    origin: "https://forge.example"
  };
  const credentialId = randomBytes(32).toString("base64url");
  const keyPair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicJwk = keyPair.publicKey.export({ format: "jwk" });
  assert.equal(typeof publicJwk.x, "string");
  assert.equal(typeof publicJwk.y, "string");
  const x = Buffer.from(publicJwk.x!, "base64url");
  const y = Buffer.from(publicJwk.y!, "base64url");
  const cosePublicKey = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    x,
    Buffer.from([0x22, 0x58, 0x20]),
    y
  ]);
  store.credentials.push({
    id: "credential_row_1",
    ownerUserId: principal.ownerUserId,
    rpId: "forge.example",
    credentialId,
    publicKeyBase64: cosePublicKey.toString("base64"),
    counter: 0,
    transports: ["internal"],
    label: "Test passkey",
    deviceType: "singleDevice",
    backedUp: false,
    aaguid: "00000000-0000-0000-0000-000000000000",
    createdAt: "2026-07-15T10:00:00.000Z",
    lastUsedAt: null
  });
  const options = await createPeerWebAuthnOptions({
    ceremony: "authenticate",
    action,
    principal,
    origin: principal.origin,
    hashingKey,
    store,
    now: new Date("2026-07-15T12:00:00.000Z")
  });
  const clientData = Buffer.from(
    JSON.stringify({
      type: "webauthn.get",
      challenge: options.options.challenge,
      origin: principal.origin,
      crossOrigin: false
    }),
    "utf8"
  );
  const rpIdHash = createHash("sha256").update("forge.example").digest();
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(1);
  const authenticatorData = Buffer.concat([
    rpIdHash,
    Buffer.from([0x05]),
    counter
  ]);
  const signature = createSign("SHA256")
    .update(
      Buffer.concat([
        authenticatorData,
        createHash("sha256").update(clientData).digest()
      ])
    )
    .end()
    .sign(keyPair.privateKey);
  const verificationInput = {
    challengeId: options.challengeId,
    action,
    principal,
    origin: principal.origin,
    response: {
      id: credentialId,
      rawId: credentialId,
      response: {
        clientDataJSON: clientData.toString("base64url"),
        authenticatorData: authenticatorData.toString("base64url"),
        signature: signature.toString("base64url")
      },
      authenticatorAttachment: "platform" as const,
      clientExtensionResults: {},
      type: "public-key" as const
    },
    capabilityId: "capability_1",
    capabilityHashingKey: new Uint8Array(32).fill(47),
    challengeHashingKey: hashingKey,
    store,
    now: new Date("2026-07-15T12:00:30.000Z")
  };
  const verified = await verifyPeerWebAuthnCeremony(verificationInput);
  assert.equal(verified.credential.counter, 1);
  await assert.rejects(
    verifyPeerWebAuthnCeremony(verificationInput),
    /already used/
  );
});
