import assert from "node:assert/strict";
import test from "node:test";
import {
  createPeerWebAuthnOptions,
  peerWebAuthnChallengeMatches,
  peerWebAuthnCredentialSetVersion,
  resolvePeerWebAuthnRelyingParty,
  type PeerWebAuthnChallengeRecord,
  type PeerWebAuthnCredentialRecord,
  type PeerWebAuthnStore
} from "./peer-webauthn.js";

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

  claimChallenge(): PeerWebAuthnChallengeRecord | null {
    throw new Error("not needed by option-generation tests");
  }

  createCredential(record: PeerWebAuthnCredentialRecord) {
    this.credentials.push(record);
    return true;
  }

  updateCredentialAfterAuthentication() {
    return true;
  }
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
