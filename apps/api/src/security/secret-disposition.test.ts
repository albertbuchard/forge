import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateSecretDispositionGate,
  signSecretInventoryCompleteness,
  signSecretDisposition,
  type SecretDispositionRecord,
  type UnsignedSecretDispositionDecision
} from "./secret-disposition.js";

const ownerSigningKey = Buffer.alloc(32, 7);
const now = new Date("2026-07-26T20:00:00.000Z");

function record(
  secretId: string,
  decision: UnsignedSecretDispositionDecision,
  overrides: Partial<SecretDispositionRecord> = {}
): SecretDispositionRecord {
  const inventory = {
    secretId,
    providerKind: "synthetic-provider",
    destination: "https://api.example.test:443/v1/",
    version: 1,
    presenceLocations: [
      {
        kind: "encrypted_store" as const,
        reference: `encrypted:${secretId}`,
        trusted: true
      }
    ],
    lastUsedAt: null,
    ...overrides
  };
  return {
    ...inventory,
    decision: signSecretDisposition(inventory, decision, ownerSigningKey)
  };
}

function completenessReceipt(
  records: readonly SecretDispositionRecord[],
  complete = true
) {
  return signSecretInventoryCompleteness(
    {
      records,
      ownerId: "owner",
      generatedAt: now.toISOString(),
      complete
    },
    ownerSigningKey
  );
}

test("G2 accepts each explicitly allowed synthetic disposition", () => {
  const records = [
    record("rotated", {
      kind: "rotated",
      ownerId: "owner",
      decidedAt: "2026-07-26T19:00:00.000Z"
    }),
    record("revoked", {
      kind: "revoked",
      ownerId: "owner",
      decidedAt: "2026-07-26T19:00:00.000Z"
    }),
    record("public", {
      kind: "authoritatively_non_confidential",
      ownerId: "owner",
      decidedAt: "2026-07-26T19:00:00.000Z",
      authorityReference: "provider-documentation:v1"
    }),
    record("quarantined", {
      kind: "owner_only_encrypted_quarantine",
      ownerId: "owner",
      decidedAt: "2026-07-26T19:00:00.000Z",
      rotationDeadline: "2026-08-20T19:00:00.000Z"
    })
  ];
  const receipt = evaluateSecretDispositionGate({
    records,
    ownerId: "owner",
    ownerSigningKey,
    completenessReceipt: completenessReceipt(records),
    now
  });
  assert.equal(receipt.eligible, true);
  assert.equal(receipt.acceptedCount, 4);
  assert.match(receipt.inventorySha256, /^[0-9a-f]{64}$/);
});

test("G2 fails closed for missing, invalid, expired, unknown, and untrusted decisions", () => {
  const missing = record("missing", {
    kind: "rotated",
    ownerId: "owner",
    decidedAt: "2026-07-26T19:00:00.000Z"
  });
  missing.decision = null;
  const invalidSignature = record("bad-signature", {
    kind: "revoked",
    ownerId: "owner",
    decidedAt: "2026-07-26T19:00:00.000Z"
  });
  invalidSignature.decision = {
    ...invalidSignature.decision!,
    signature: "tampered"
  };
  const records = [
    missing,
    invalidSignature,
    record("expired", {
      kind: "owner_only_encrypted_quarantine",
      ownerId: "owner",
      decidedAt: "2026-07-20T19:00:00.000Z",
      rotationDeadline: "2026-07-25T19:00:00.000Z"
    }),
    record("overlong", {
      kind: "owner_only_encrypted_quarantine",
      ownerId: "owner",
      decidedAt: "2026-07-26T19:00:00.000Z",
      rotationDeadline: "2026-09-01T19:00:00.000Z"
    }),
    record("unknown", {
      kind: "unknown",
      ownerId: "owner",
      decidedAt: "2026-07-26T19:00:00.000Z"
    }),
    record(
      "untrusted",
      {
        kind: "rotated",
        ownerId: "owner",
        decidedAt: "2026-07-26T19:00:00.000Z"
      },
      {
        presenceLocations: [
          {
            kind: "backup",
            reference: "legacy-backup",
            trusted: false
          }
        ]
      }
    )
  ];
  const receipt = evaluateSecretDispositionGate({
    records,
    ownerId: "owner",
    ownerSigningKey,
    completenessReceipt: completenessReceipt(records),
    now
  });
  assert.equal(receipt.eligible, false);
  assert.deepEqual(
    receipt.failures.map((failure) => failure.reason),
    [
      "missing_decision",
      "invalid_signature",
      "expired_deadline",
      "deadline_exceeds_limit",
      "unknown_provider_state",
      "untrusted_location"
    ]
  );
});

test("G2 fails closed for empty or incomplete inventory evidence", () => {
  const emptyRecords: SecretDispositionRecord[] = [];
  const empty = evaluateSecretDispositionGate({
    records: emptyRecords,
    ownerId: "owner",
    ownerSigningKey,
    completenessReceipt: completenessReceipt(emptyRecords),
    now
  });
  assert.equal(empty.eligible, false);
  assert.equal(empty.failures[0]?.reason, "inventory_empty");

  const records = [
    record("known", {
      kind: "rotated",
      ownerId: "owner",
      decidedAt: "2026-07-26T19:00:00.000Z"
    })
  ];
  const incomplete = evaluateSecretDispositionGate({
    records,
    ownerId: "owner",
    ownerSigningKey,
    completenessReceipt: completenessReceipt(records, false),
    now
  });
  assert.equal(incomplete.eligible, false);
  assert.deepEqual(
    incomplete.failures.map((failure) => failure.reason),
    ["inventory_incomplete"]
  );

  const tamperedReceipt = {
    ...completenessReceipt(records),
    expectedRecordCount: 2
  };
  const tampered = evaluateSecretDispositionGate({
    records,
    ownerId: "owner",
    ownerSigningKey,
    completenessReceipt: tamperedReceipt,
    now
  });
  assert.equal(tampered.eligible, false);
  assert.equal(tampered.failures[0]?.reason, "inventory_receipt_invalid");
});
