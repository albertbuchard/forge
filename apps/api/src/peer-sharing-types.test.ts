import assert from "node:assert/strict";
import test from "node:test";
import {
  PEER_PROTOCOL_VERSION,
  peerShareGrantVersionSchema,
  peerShareRuleSchema
} from "./peer-sharing-types.js";

const baseRule = {
  id: "rule_calendar",
  effect: "allow" as const,
  projectionId: "calendar.availability.v1" as const,
  entitySelector: null,
  fields: { include: ["startsAt", "endsAt"], exclude: [] },
  time: {
    startsAt: null,
    endsAt: null,
    rollingPastDays: 0,
    rollingFutureDays: 30
  },
  precision: "free_busy",
  aggregation: null,
  approvedDeviceIds: ["device_remote_phone"],
  devicePolicy: "explicit" as const,
  maximumResultCount: 100,
  maximumPayloadBytes: 262_144
};

test("peer allow rules fail closed without an approved device", () => {
  const result = peerShareRuleSchema.safeParse({
    ...baseRule,
    approvedDeviceIds: []
  });
  assert.equal(result.success, false);
});

test("peer field policy rejects contradictory include and exclude fields", () => {
  const result = peerShareRuleSchema.safeParse({
    ...baseRule,
    fields: { include: ["title"], exclude: ["title"] }
  });
  assert.equal(result.success, false);
});

test("selected entity rules require a type and reject omitted or duplicate ids", () => {
  for (const entitySelector of [
    { mode: "selected", entityIds: ["event_1"] },
    {
      mode: "selected",
      entityType: "calendar_event",
      entityIds: ["event_1", "event_1"]
    }
  ]) {
    assert.equal(
      peerShareRuleSchema.safeParse({ ...baseRule, entitySelector }).success,
      false
    );
  }
});

test("active grant versions require unique signatures from both parties", () => {
  const active = {
    id: "grant_active",
    ownerUserId: "user_owner",
    relationshipId: "relationship_1",
    direction: "local_to_remote" as const,
    sequence: 1,
    previousVersionHash: null,
    status: "active" as const,
    label: "Availability",
    purpose: "Coordinate plans",
    issuedAt: "2026-07-15T10:00:00.000Z",
    effectiveAt: "2026-07-15T10:00:00.000Z",
    expiresAt: "2026-08-15T10:00:00.000Z",
    revokedAt: null,
    cachePolicy: {
      mode: "until_revoked" as const,
      maximumRetentionSeconds: 2_592_000,
      purgeOnRevocation: true
    },
    rules: [baseRule],
    signatures: [
      {
        deviceId: "owner_device",
        party: "grantor" as const,
        algorithm: "ed25519" as const,
        signature: "A".repeat(86),
        signedAt: "2026-07-15T10:00:01.000Z"
      },
      {
        deviceId: "remote_device",
        party: "grantee" as const,
        algorithm: "ed25519" as const,
        signature: "B".repeat(86),
        signedAt: "2026-07-15T10:00:02.000Z"
      }
    ],
    protocolVersion: PEER_PROTOCOL_VERSION,
    schemaVersion: 1 as const
  };
  assert.equal(peerShareGrantVersionSchema.safeParse(active).success, true);
  assert.equal(
    peerShareGrantVersionSchema.safeParse({
      ...active,
      signatures: active.signatures.map((signature) => ({
        ...signature,
        party: "grantor" as const
      }))
    }).success,
    false
  );
});

test("first grant versions cannot claim a previous hash", () => {
  const result = peerShareGrantVersionSchema.safeParse({
    id: "grant_1",
    ownerUserId: "user_owner",
    relationshipId: "relationship_1",
    direction: "local_to_remote",
    sequence: 1,
    previousVersionHash: "a".repeat(64),
    status: "proposed",
    label: "Availability",
    purpose: "Coordinate plans",
    issuedAt: "2026-07-15T10:00:00.000Z",
    effectiveAt: null,
    expiresAt: "2026-08-15T10:00:00.000Z",
    revokedAt: null,
    cachePolicy: {
      mode: "until_revoked",
      maximumRetentionSeconds: 2_592_000,
      purgeOnRevocation: true
    },
    rules: [baseRule],
    signatures: [],
    protocolVersion: PEER_PROTOCOL_VERSION,
    schemaVersion: 1
  });
  assert.equal(result.success, false);
});

test("later grant versions require a previous hash", () => {
  const result = peerShareGrantVersionSchema.safeParse({
    id: "grant_2",
    ownerUserId: "user_owner",
    relationshipId: "relationship_1",
    direction: "local_to_remote",
    sequence: 2,
    previousVersionHash: null,
    status: "proposed",
    label: "Availability",
    purpose: "Coordinate plans",
    issuedAt: "2026-07-15T10:00:00.000Z",
    effectiveAt: null,
    expiresAt: "2026-08-15T10:00:00.000Z",
    revokedAt: null,
    cachePolicy: {
      mode: "until_revoked",
      maximumRetentionSeconds: 2_592_000,
      purgeOnRevocation: true
    },
    rules: [baseRule],
    signatures: [],
    protocolVersion: PEER_PROTOCOL_VERSION,
    schemaVersion: 1
  });
  assert.equal(result.success, false);
});
