import assert from "node:assert/strict";
import test from "node:test";
import {
  capabilitySecretMatches,
  canonicalPeerPresenceActionJson,
  consumePeerPresenceCapability,
  digestPeerPresenceAction,
  issuePeerPresenceCapability,
  peerPresenceCapabilityCookie,
  readPeerPresenceCapabilityCookie,
  type PeerPresenceAction,
  type PeerPresenceCapabilityRecord,
  type PeerPresenceCapabilityStore,
  type PeerPresencePrincipal
} from "./peer-human-presence.js";

const hashingKey = new Uint8Array(32).fill(17);
const principal: PeerPresencePrincipal = {
  principalClass: "operator_session",
  principalId: "session_owner",
  ownerUserId: "user_owner",
  origin: "https://forge.example"
};
const action: PeerPresenceAction = {
  ownerUserId: "user_owner",
  method: "POST",
  routePath: "/api/v1/peers/grants/:grantId/revoke",
  pathParams: { grantId: "grant_1" },
  expectedVersion: "version_4",
  body: { reason: "No longer shared", purgeManagedCache: true }
};

class MemoryCapabilityStore implements PeerPresenceCapabilityStore {
  constructor(private readonly record: PeerPresenceCapabilityRecord) {}

  consumeExact(
    input: Parameters<PeerPresenceCapabilityStore["consumeExact"]>[0]
  ) {
    if (
      this.record.consumedAt !== null ||
      Date.parse(this.record.expiresAt) <= Date.parse(input.now) ||
      this.record.id !== input.id ||
      this.record.tokenHash !== input.tokenHash ||
      this.record.actionDigest !== input.actionDigest ||
      this.record.principalClass !== input.principal.principalClass ||
      this.record.principalId !== input.principal.principalId ||
      this.record.ownerUserId !== input.principal.ownerUserId ||
      this.record.origin !== input.principal.origin
    ) {
      return false;
    }
    this.record.consumedAt = input.now;
    return true;
  }
}

test("peer approval digest binds exact route, target, version, and body", () => {
  const reordered = {
    ...action,
    pathParams: { grantId: "grant_1" },
    body: { purgeManagedCache: true, reason: "No longer shared" }
  };
  assert.equal(
    canonicalPeerPresenceActionJson(action),
    canonicalPeerPresenceActionJson(reordered)
  );
  assert.equal(
    digestPeerPresenceAction(action),
    digestPeerPresenceAction(reordered)
  );
  for (const changed of [
    { ...action, pathParams: { grantId: "grant_2" } },
    { ...action, expectedVersion: "version_5" },
    {
      ...action,
      body: { ...(action.body as object), purgeManagedCache: false }
    }
  ]) {
    assert.notEqual(
      digestPeerPresenceAction(action),
      digestPeerPresenceAction(changed)
    );
  }
});

test("peer approval digest rejects unprotected routes and malformed JSON", () => {
  assert.throws(
    () =>
      digestPeerPresenceAction({
        ...action,
        method: "DELETE",
        routePath: "/api/v1/peers/invitations/:invitationId",
        pathParams: { wrongId: "invite_1" }
      }),
    /path parameters/
  );
  assert.throws(
    () =>
      digestPeerPresenceAction({
        ...action,
        routePath: "/api/v1/people/:personId/questions/execute",
        pathParams: { personId: "person_1" }
      }),
    /does not accept/
  );
  assert.throws(
    () => digestPeerPresenceAction({ ...action, body: { unsafe: undefined } }),
    /undefined/
  );
  assert.throws(
    () => digestPeerPresenceAction({ ...action, expectedVersion: null }),
    /expected record version/
  );
});

test("approval for adding an authenticator binds the credential-set version", () => {
  const registrationAction: PeerPresenceAction = {
    ownerUserId: "user_owner",
    method: "POST",
    routePath: "/api/v1/peers/human-presence/options",
    pathParams: {},
    expectedVersion: "credential_set_hash_4",
    body: {
      ceremony: "register",
      credentialLabel: "MacBook Touch ID"
    }
  };
  assert.match(digestPeerPresenceAction(registrationAction), /^[a-f0-9]{64}$/);
  assert.throws(
    () =>
      digestPeerPresenceAction({
        ...registrationAction,
        expectedVersion: null
      }),
    /expected record version/
  );
});

test("companion grant preview approval binds the exact relationship version and draft", () => {
  const previewAction: PeerPresenceAction = {
    ownerUserId: "user_owner",
    method: "POST",
    routePath: "/api/v1/peers/relationships/:relationshipId/grants/preview",
    pathParams: { relationshipId: "relationship_1" },
    expectedVersion: "relationship_version_4",
    body: {
      draft: { label: "Availability", rules: [{ id: "availability" }] },
      includeWorstCase: true,
      sampleLimit: 25
    }
  };
  assert.match(digestPeerPresenceAction(previewAction), /^[a-f0-9]{64}$/);
  assert.notEqual(
    digestPeerPresenceAction(previewAction),
    digestPeerPresenceAction({
      ...previewAction,
      body: {
        ...(previewAction.body as Record<string, unknown>),
        sampleLimit: 10
      }
    })
  );
  assert.throws(
    () => digestPeerPresenceAction({ ...previewAction, expectedVersion: null }),
    /expected record version/
  );
});

test("peer approval capability is action-bound and consumed atomically", () => {
  const issued = issuePeerPresenceCapability({
    id: "presence_1",
    action,
    principal,
    hashingKey,
    now: new Date("2026-07-15T12:00:00.000Z")
  });
  assert.equal(
    capabilitySecretMatches(issued.secret, issued.record.tokenHash, hashingKey),
    true
  );
  assert.equal(
    capabilitySecretMatches("malformed", issued.record.tokenHash, hashingKey),
    false
  );
  const store = new MemoryCapabilityStore(issued.record);
  consumePeerPresenceCapability({
    capabilityId: issued.record.id,
    secret: issued.secret,
    action,
    principal,
    hashingKey,
    store,
    now: new Date("2026-07-15T12:01:00.000Z")
  });
  assert.throws(
    () =>
      consumePeerPresenceCapability({
        capabilityId: issued.record.id,
        secret: issued.secret,
        action,
        principal,
        hashingKey,
        store,
        now: new Date("2026-07-15T12:01:01.000Z")
      }),
    /already used/
  );
});

test("approval principals require canonical browser or companion semantics", () => {
  assert.throws(
    () =>
      issuePeerPresenceCapability({
        id: "presence_bad_origin",
        action,
        principal: { ...principal, origin: "https://forge.example/path" },
        hashingKey
      }),
    /canonical URL origin/
  );
  assert.throws(
    () =>
      issuePeerPresenceCapability({
        id: "presence_bad_companion",
        action,
        principal: {
          principalClass: "companion_consent",
          principalId: "phone_1",
          ownerUserId: "user_owner",
          origin: "https://forge.example"
        },
        hashingKey
      }),
    /must not claim a browser origin/
  );
});

test("peer approval capability rejects another action, principal, and expiry", () => {
  for (const attempt of [
    {
      action: { ...action, expectedVersion: "version_5" },
      principal,
      now: new Date("2026-07-15T12:01:00.000Z")
    },
    {
      action,
      principal: { ...principal, principalId: "session_attacker" },
      now: new Date("2026-07-15T12:01:00.000Z")
    },
    {
      action,
      principal,
      now: new Date("2026-07-15T12:06:00.000Z")
    }
  ]) {
    const issued = issuePeerPresenceCapability({
      id: `presence_${attempt.now.getTime()}`,
      action,
      principal,
      hashingKey,
      now: new Date("2026-07-15T12:00:00.000Z")
    });
    assert.throws(
      () =>
        consumePeerPresenceCapability({
          capabilityId: issued.record.id,
          secret: issued.secret,
          action: attempt.action,
          principal: attempt.principal,
          hashingKey,
          store: new MemoryCapabilityStore(issued.record),
          now: attempt.now
        }),
      /invalid, expired, or already used/
    );
  }
});

test("presence cookie is HttpOnly, strict, path-bounded, and secure on HTTPS", () => {
  const issued = issuePeerPresenceCapability({
    id: "presence_cookie",
    action,
    principal,
    hashingKey,
    now: new Date("2026-07-15T12:00:00.000Z")
  });
  const cookie = peerPresenceCapabilityCookie({
    capabilityId: issued.record.id,
    secret: issued.secret,
    secure: true
  });
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\/api\/v1\/peers/);
  assert.match(cookie, /Secure/);
  assert.doesNotMatch(cookie, /Domain=/);
  assert.deepEqual(readPeerPresenceCapabilityCookie(cookie), {
    capabilityId: issued.record.id,
    secret: issued.secret
  });
  assert.equal(
    readPeerPresenceCapabilityCookie("forge_peer_presence=bad"),
    null
  );
});
