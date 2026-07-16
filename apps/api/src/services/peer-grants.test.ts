import assert from "node:assert/strict";
import test from "node:test";
import { PEER_PROTOCOL_VERSION, type PeerShareGrantVersion } from "../peer-sharing-types.js";
import {
  assertCounterProposalNarrowsGrant,
  assertHumanGrantActor,
  canonicalPeerGrantConsentJson,
  evaluatePeerProjectionAccess,
  hashPeerGrantVersion,
  peerGrantMatchesReviewedPolicy,
  peerGrantSignaturePayload,
  validateNextPeerGrantVersion
} from "./peer-grants.js";

function grant(overrides: Partial<PeerShareGrantVersion> = {}): PeerShareGrantVersion {
  return {
    id: "grant_calendar",
    ownerUserId: "user_owner",
    relationshipId: "relationship_jon",
    direction: "local_to_remote",
    sequence: 1,
    previousVersionHash: null,
    status: "active",
    label: "Availability",
    purpose: "Coordinate plans",
    issuedAt: "2026-07-15T09:00:00.000Z",
    effectiveAt: "2026-07-15T09:00:00.000Z",
    expiresAt: "2026-08-15T09:00:00.000Z",
    revokedAt: null,
    cachePolicy: {
      mode: "until_revoked",
      maximumRetentionSeconds: 2_592_000,
      purgeOnRevocation: true
    },
    rules: [
      {
        id: "availability",
        effect: "allow",
        projectionId: "calendar.availability.v1",
        entitySelector: null,
        fields: {
          include: ["start", "end", "busyState"],
          exclude: ["eventTitle", "description", "eventLocation"]
        },
        time: {
          startsAt: null,
          endsAt: null,
          rollingPastDays: 0,
          rollingFutureDays: 30
        },
        precision: "fifteen_minutes",
        aggregation: null,
        approvedDeviceIds: ["jon_phone"],
        devicePolicy: "explicit",
        maximumResultCount: 100,
        maximumPayloadBytes: 262_144
      }
    ],
    signatures: [
      {
        deviceId: "owner_mac",
        party: "grantor",
        algorithm: "ed25519",
        signature: "A".repeat(86),
        signedAt: "2026-07-15T09:00:00.000Z"
      },
      {
        deviceId: "jon_phone",
        party: "grantee",
        algorithm: "ed25519",
        signature: "B".repeat(86),
        signedAt: "2026-07-15T09:01:00.000Z"
      }
    ],
    protocolVersion: PEER_PROTOCOL_VERSION,
    schemaVersion: 1,
    ...overrides
  };
}

test("grant hash is stable across object key order", () => {
  const first = grant();
  const second = JSON.parse(JSON.stringify(first)) as PeerShareGrantVersion;
  assert.equal(hashPeerGrantVersion(first), hashPeerGrantVersion(second));
});

test("grant hash canonicalizes set-like arrays and signature order", () => {
  const first = grant();
  const reordered = grant({
    rules: first.rules.map((rule) => ({
      ...rule,
      fields: {
        include: [...rule.fields.include].reverse(),
        exclude: [...rule.fields.exclude].reverse()
      },
      approvedDeviceIds: [...rule.approvedDeviceIds].reverse()
    })),
    signatures: [...first.signatures].reverse()
  });
  assert.equal(hashPeerGrantVersion(first), hashPeerGrantVersion(reordered));
});

test("grant signature payload is domain separated from lifecycle state", () => {
  const activeGrant = grant();
  const signer = {
    deviceId: activeGrant.signatures[0]!.deviceId,
    party: activeGrant.signatures[0]!.party,
    algorithm: activeGrant.signatures[0]!.algorithm,
    signedAt: activeGrant.signatures[0]!.signedAt
  };
  assert.equal(
    canonicalPeerGrantConsentJson(activeGrant),
    canonicalPeerGrantConsentJson({ ...activeGrant, status: "proposed" })
  );
  assert.deepEqual(
    peerGrantSignaturePayload(activeGrant, signer),
    peerGrantSignaturePayload({ ...activeGrant, status: "proposed" }, signer)
  );
  assert.notDeepEqual(
    peerGrantSignaturePayload(activeGrant, signer),
    peerGrantSignaturePayload(
      {
        ...activeGrant,
        rules: [
          {
            ...activeGrant.rules[0]!,
            maximumResultCount: activeGrant.rules[0]!.maximumResultCount - 1
          }
        ]
      },
      signer
    )
  );
});

test("daemon grant results may change only status and signatures", () => {
  const reviewed = grant({ status: "proposed", signatures: [] });
  assert.equal(
    peerGrantMatchesReviewedPolicy(
      {
        ...reviewed,
        status: "active",
        signatures: grant().signatures
      },
      reviewed
    ),
    true
  );

  const rule = reviewed.rules[0]!;
  const broadened = [
    { ...reviewed, purpose: "A broader hidden purpose" },
    {
      ...reviewed,
      cachePolicy: {
        ...reviewed.cachePolicy,
        maximumRetentionSeconds:
          reviewed.cachePolicy.maximumRetentionSeconds + 1
      }
    },
    {
      ...reviewed,
      rules: [{ ...rule, maximumResultCount: rule.maximumResultCount + 1 }]
    },
    {
      ...reviewed,
      rules: [{ ...rule, maximumPayloadBytes: rule.maximumPayloadBytes + 1 }]
    },
    {
      ...reviewed,
      rules: [
        {
          ...rule,
          fields: {
            ...rule.fields,
            include: [...rule.fields.include, "attendeeCount"]
          }
        }
      ]
    },
    {
      ...reviewed,
      rules: [
        {
          ...rule,
          approvedDeviceIds: [...rule.approvedDeviceIds, "unreviewed_device"]
        }
      ]
    },
    { ...reviewed, issuedAt: "2026-07-15T08:59:59.000Z" },
    { ...reviewed, revokedAt: "2026-07-15T09:00:00.000Z" }
  ] satisfies PeerShareGrantVersion[];

  for (const candidate of broadened) {
    assert.equal(peerGrantMatchesReviewedPolicy(candidate, reviewed), false);
  }
});

test("next grant version must extend the exact accepted hash", () => {
  const first = grant();
  const next = grant({
    sequence: 2,
    previousVersionHash: hashPeerGrantVersion(first),
    issuedAt: "2026-07-15T10:00:00.000Z",
    effectiveAt: "2026-07-15T10:00:00.000Z",
    signatures: first.signatures.map((signature, index) => ({
      ...signature,
      signedAt: `2026-07-15T10:00:0${index + 1}.000Z`
    }))
  });
  assert.equal(validateNextPeerGrantVersion(first, next).sequence, 2);
  assert.throws(
    () =>
      validateNextPeerGrantVersion(first, {
        ...next,
        previousVersionHash: "f".repeat(64)
      }),
    /hash chain/
  );
});

test("projection access redacts fields and enforces approved devices", () => {
  const activeGrant = grant();
  const request = {
    ownerUserId: "user_owner",
    relationshipId: "relationship_jon",
    requestingDeviceId: "jon_phone",
    projectionId: "calendar.availability.v1" as const,
    requestedFields: ["start", "end", "eventTitle"],
    requestedPrecision: "fifteen_minutes",
    startsAt: "2026-07-20T09:00:00.000Z",
    endsAt: "2026-07-20T17:00:00.000Z",
    requestedResultCount: 10,
    requestedPayloadBytes: 10_000
  };
  const decision = evaluatePeerProjectionAccess(
    activeGrant,
    request,
    {
      now: new Date("2026-07-15T12:00:00.000Z"),
      verifiedGrantHash: hashPeerGrantVersion(activeGrant),
      verifiedSignerDeviceIds: ["owner_mac", "jon_phone"],
      approvedRelationshipDeviceIds: ["jon_phone"]
    }
  );
  assert.equal(decision.allowed, true);
  if (decision.allowed) {
    assert.deepEqual(decision.effectiveFields, ["start", "end"]);
    assert.deepEqual(decision.redactedFields, ["eventTitle"]);
  }
  assert.deepEqual(
    evaluatePeerProjectionAccess(
      activeGrant,
      { ...request, requestingDeviceId: "new_unapproved_device" },
      {
        now: new Date("2026-07-15T12:00:00.000Z"),
        verifiedGrantHash: hashPeerGrantVersion(activeGrant),
        verifiedSignerDeviceIds: ["owner_mac", "jon_phone"],
        approvedRelationshipDeviceIds: ["jon_phone"]
      }
    ),
    { allowed: false, reason: "device_not_approved" }
  );
});

test("selected entity and bounded-time rules reject omitted request constraints", () => {
  const selectedGrant = grant({
    rules: [
      {
        ...grant().rules[0]!,
        entitySelector: {
          mode: "selected",
          entityType: "calendar_event",
          entityIds: ["calendar_event_allowed"]
        }
      }
    ]
  });
  const baseRequest = {
    ownerUserId: "user_owner",
    relationshipId: "relationship_jon",
    requestingDeviceId: "jon_phone",
    projectionId: "calendar.availability.v1" as const,
    requestedFields: ["start", "end"],
    requestedPrecision: "fifteen_minutes",
    startsAt: "2026-07-20T09:00:00.000Z",
    endsAt: "2026-07-20T17:00:00.000Z"
  };
  const context = {
    now: new Date("2026-07-15T12:00:00.000Z"),
    verifiedGrantHash: hashPeerGrantVersion(selectedGrant),
    verifiedSignerDeviceIds: ["owner_mac", "jon_phone"],
    approvedRelationshipDeviceIds: ["jon_phone"]
  };
  assert.deepEqual(
    evaluatePeerProjectionAccess(selectedGrant, baseRequest, context),
    { allowed: false, reason: "entity_not_granted" }
  );
  assert.deepEqual(
    evaluatePeerProjectionAccess(
      selectedGrant,
      {
        ...baseRequest,
        entityIds: ["calendar_event_allowed"],
        startsAt: undefined,
        endsAt: undefined
      },
      context
    ),
    { allowed: false, reason: "time_not_granted" }
  );
});

test("grant evaluation requires verified signatures and current device approval", () => {
  const activeGrant = grant();
  const request = {
    ownerUserId: "user_owner",
    relationshipId: "relationship_jon",
    requestingDeviceId: "jon_phone",
    projectionId: "calendar.availability.v1" as const,
    requestedFields: ["start", "end"],
    requestedPrecision: "fifteen_minutes",
    startsAt: "2026-07-20T09:00:00.000Z",
    endsAt: "2026-07-20T17:00:00.000Z"
  };
  const baseContext = {
    now: new Date("2026-07-15T12:00:00.000Z"),
    verifiedGrantHash: hashPeerGrantVersion(activeGrant),
    verifiedSignerDeviceIds: ["owner_mac", "jon_phone"],
    approvedRelationshipDeviceIds: ["jon_phone"]
  };
  assert.deepEqual(
    evaluatePeerProjectionAccess(activeGrant, request, {
      ...baseContext,
      verifiedGrantHash: "f".repeat(64)
    }),
    { allowed: false, reason: "grant_verification_failed" }
  );
  assert.deepEqual(
    evaluatePeerProjectionAccess(activeGrant, request, {
      ...baseContext,
      verifiedSignerDeviceIds: ["owner_mac"]
    }),
    { allowed: false, reason: "grant_verification_failed" }
  );
  assert.deepEqual(
    evaluatePeerProjectionAccess(activeGrant, request, {
      ...baseContext,
      approvedRelationshipDeviceIds: []
    }),
    { allowed: false, reason: "device_not_approved" }
  );

  const currentDevicesGrant = grant({
    rules: [
      {
        ...grant().rules[0]!,
        approvedDeviceIds: [],
        devicePolicy: "approved_current_devices"
      }
    ]
  });
  assert.equal(
    evaluatePeerProjectionAccess(currentDevicesGrant, request, {
      ...baseContext,
      verifiedGrantHash: hashPeerGrantVersion(currentDevicesGrant)
    }).allowed,
    true
  );
});

test("counter proposals cannot widen selectors, time, fields, cache, or denies", () => {
  const baseline = grant({ status: "proposed", signatures: [] });
  const narrowRule = {
    ...baseline.rules[0]!,
    fields: {
      include: ["start", "end"],
      exclude: ["eventTitle", "description", "eventLocation", "busyState"]
    },
    time: {
      ...baseline.rules[0]!.time,
      rollingFutureDays: 7
    },
    maximumResultCount: 20
  };
  const narrower = grant({
    sequence: 2,
    previousVersionHash: hashPeerGrantVersion(baseline),
    status: "countered",
    issuedAt: "2026-07-15T10:00:00.000Z",
    effectiveAt: "2026-07-15T10:00:00.000Z",
    expiresAt: "2026-08-01T09:00:00.000Z",
    cachePolicy: {
      mode: "none",
      maximumRetentionSeconds: 0,
      purgeOnRevocation: true
    },
    rules: [narrowRule],
    signatures: []
  });
  assert.doesNotThrow(() => assertCounterProposalNarrowsGrant(baseline, narrower));
  assert.throws(
    () =>
      assertCounterProposalNarrowsGrant(baseline, {
        ...narrower,
        rules: [
          {
            ...narrowRule,
            maximumResultCount: baseline.rules[0]!.maximumResultCount + 1
          }
        ]
      }),
    /cannot widen/
  );
  assert.throws(
    () =>
      assertCounterProposalNarrowsGrant(baseline, {
        ...narrower,
        cachePolicy: {
          ...baseline.cachePolicy,
          maximumRetentionSeconds:
            baseline.cachePolicy.maximumRetentionSeconds + 1
        }
      }),
    /cache retention/
  );
});

test("agents and stale companion consent cannot change grants", () => {
  const baseActor = {
    ownerUserId: "user_owner",
    principalId: "principal_owner",
    deviceId: "owner_phone",
    scopes: ["peer:grants:manage"],
    authenticatedAt: "2026-07-15T11:55:00.000Z",
    userPresenceAt: "2026-07-15T11:59:00.000Z"
  };
  assert.throws(
    () =>
      assertHumanGrantActor(
        { ...baseActor, principalClass: "agent_token" },
        { ownerUserId: "user_owner", now: new Date("2026-07-15T12:00:00.000Z") }
      ),
    /human-controlled/
  );
  assert.throws(
    () =>
      assertHumanGrantActor(
        {
          ...baseActor,
          principalClass: "companion_consent",
          userPresenceAt: "2026-07-15T11:00:00.000Z"
        },
        { ownerUserId: "user_owner", now: new Date("2026-07-15T12:00:00.000Z") }
      ),
    /expired/
  );
  assert.throws(
    () =>
      assertHumanGrantActor(
        {
          ...baseActor,
          principalClass: "operator_session",
          authenticatedAt: "2026-07-15T10:00:00.000Z"
        },
        {
          ownerUserId: "user_owner",
          now: new Date("2026-07-15T12:00:00.000Z"),
          maximumReauthAgeMs: 24 * 60 * 60 * 1_000
        }
      ),
    /expired/
  );
  assert.throws(
    () =>
      assertHumanGrantActor(
        {
          ...baseActor,
          principalClass: "companion_consent",
          deviceId: null
        },
        { ownerUserId: "user_owner", now: new Date("2026-07-15T12:00:00.000Z") }
      ),
    /bound to the approving device/
  );
});
