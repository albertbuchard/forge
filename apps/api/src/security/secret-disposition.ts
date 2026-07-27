import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type SecretPresenceLocation = {
  kind: "encrypted_store" | "database" | "mirror" | "export" | "backup";
  reference: string;
  trusted: boolean;
};

export type SecretDispositionDecision =
  | {
      kind: "rotated" | "revoked";
      ownerId: string;
      decidedAt: string;
      signature: string;
    }
  | {
      kind: "authoritatively_non_confidential";
      ownerId: string;
      decidedAt: string;
      authorityReference: string;
      signature: string;
    }
  | {
      kind: "owner_only_encrypted_quarantine";
      ownerId: string;
      decidedAt: string;
      rotationDeadline: string;
      signature: string;
    }
  | {
      kind: "unknown";
      ownerId: string;
      decidedAt: string;
      signature: string;
    };

export type UnsignedSecretDispositionDecision =
  SecretDispositionDecision extends infer Decision
    ? Decision extends { signature: string }
      ? Omit<Decision, "signature">
      : never
    : never;

export type SecretDispositionRecord = {
  secretId: string;
  providerKind: string;
  destination: string;
  version: number;
  presenceLocations: readonly SecretPresenceLocation[];
  lastUsedAt: string | null;
  decision: SecretDispositionDecision | null;
};

export type SecretDispositionFailure = {
  secretId: string;
  reason:
    | "inventory_empty"
    | "inventory_incomplete"
    | "inventory_receipt_invalid"
    | "missing_decision"
    | "invalid_signature"
    | "wrong_owner"
    | "invalid_timestamp"
    | "untrusted_location"
    | "unknown_provider_state"
    | "missing_authority"
    | "expired_deadline"
    | "deadline_exceeds_limit";
};

export type SecretInventoryCompletenessReceipt = {
  ownerId: string;
  generatedAt: string;
  expectedRecordCount: number;
  inventorySha256: string;
  complete: boolean;
  signature: string;
};

export type SecretDispositionReceipt = {
  gate: "G2";
  eligible: boolean;
  evaluatedAt: string;
  recordCount: number;
  acceptedCount: number;
  failures: readonly SecretDispositionFailure[];
  inventorySha256: string;
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function unsignedDecision(decision: SecretDispositionDecision) {
  const { signature: _signature, ...unsigned } = decision;
  return unsigned;
}

function signedPayload(
  record: SecretDispositionRecord,
  decision: SecretDispositionDecision
) {
  return canonicalJson({
    secretId: record.secretId,
    providerKind: record.providerKind,
    destination: record.destination,
    version: record.version,
    presenceLocations: record.presenceLocations,
    lastUsedAt: record.lastUsedAt,
    decision: unsignedDecision(decision)
  });
}

export function signSecretDisposition(
  record: Omit<SecretDispositionRecord, "decision">,
  decision: UnsignedSecretDispositionDecision,
  ownerSigningKey: Uint8Array
): SecretDispositionDecision {
  const unsignedRecord = {
    ...record,
    decision: { ...decision, signature: "" } as SecretDispositionDecision
  };
  return {
    ...decision,
    signature: createHmac("sha256", ownerSigningKey)
      .update(signedPayload(unsignedRecord, unsignedRecord.decision))
      .digest("base64url")
  } as SecretDispositionDecision;
}

function validSignature(
  record: SecretDispositionRecord,
  ownerSigningKey: Uint8Array
) {
  if (!record.decision) return false;
  const expected = createHmac("sha256", ownerSigningKey)
    .update(signedPayload(record, record.decision))
    .digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(record.decision.signature, "base64url");
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function inventorySha256(records: readonly SecretDispositionRecord[]) {
  return createHash("sha256").update(canonicalJson(records)).digest("hex");
}

function unsignedCompletenessReceipt(
  receipt: SecretInventoryCompletenessReceipt
) {
  const { signature: _signature, ...unsigned } = receipt;
  return unsigned;
}

export function signSecretInventoryCompleteness(
  input: {
    records: readonly SecretDispositionRecord[];
    ownerId: string;
    generatedAt: string;
    complete: boolean;
  },
  ownerSigningKey: Uint8Array
): SecretInventoryCompletenessReceipt {
  const receipt = {
    ownerId: input.ownerId,
    generatedAt: input.generatedAt,
    expectedRecordCount: input.records.length,
    inventorySha256: inventorySha256(input.records),
    complete: input.complete
  };
  return {
    ...receipt,
    signature: createHmac("sha256", ownerSigningKey)
      .update(canonicalJson(receipt))
      .digest("base64url")
  };
}

function validCompletenessReceiptSignature(
  receipt: SecretInventoryCompletenessReceipt,
  ownerSigningKey: Uint8Array
) {
  const expected = createHmac("sha256", ownerSigningKey)
    .update(canonicalJson(unsignedCompletenessReceipt(receipt)))
    .digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(receipt.signature, "base64url");
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function validDate(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function evaluateSecretDispositionGate(input: {
  records: readonly SecretDispositionRecord[];
  ownerId: string;
  ownerSigningKey: Uint8Array;
  completenessReceipt: SecretInventoryCompletenessReceipt;
  now: Date;
  maximumQuarantineDays?: number;
}): SecretDispositionReceipt {
  const failures: SecretDispositionFailure[] = [];
  const maximumQuarantineMilliseconds =
    (input.maximumQuarantineDays ?? 30) * 24 * 60 * 60 * 1_000;
  const inventoryHash = inventorySha256(input.records);
  const completenessGeneratedAt = validDate(
    input.completenessReceipt.generatedAt
  );
  const completenessReceiptValid =
    input.completenessReceipt.ownerId === input.ownerId &&
    input.completenessReceipt.complete === true &&
    completenessGeneratedAt !== null &&
    completenessGeneratedAt <= input.now.getTime() &&
    input.completenessReceipt.expectedRecordCount === input.records.length &&
    input.completenessReceipt.inventorySha256 === inventoryHash &&
    validCompletenessReceiptSignature(
      input.completenessReceipt,
      input.ownerSigningKey
    );

  if (input.records.length === 0) {
    failures.push({ secretId: "__inventory__", reason: "inventory_empty" });
  }
  if (!input.completenessReceipt.complete) {
    failures.push({
      secretId: "__inventory__",
      reason: "inventory_incomplete"
    });
  } else if (!completenessReceiptValid) {
    failures.push({
      secretId: "__inventory__",
      reason: "inventory_receipt_invalid"
    });
  }

  for (const record of input.records) {
    const decision = record.decision;
    const fail = (reason: SecretDispositionFailure["reason"]) =>
      failures.push({ secretId: record.secretId, reason });
    if (!decision) {
      fail("missing_decision");
      continue;
    }
    if (decision.ownerId !== input.ownerId) {
      fail("wrong_owner");
      continue;
    }
    if (!validSignature(record, input.ownerSigningKey)) {
      fail("invalid_signature");
      continue;
    }
    const decidedAt = validDate(decision.decidedAt);
    if (decidedAt === null || decidedAt > input.now.getTime()) {
      fail("invalid_timestamp");
      continue;
    }
    if (
      record.presenceLocations.length === 0 ||
      record.presenceLocations.some((location) => !location.trusted)
    ) {
      fail("untrusted_location");
      continue;
    }
    if (decision.kind === "unknown") {
      fail("unknown_provider_state");
      continue;
    }
    if (
      decision.kind === "authoritatively_non_confidential" &&
      decision.authorityReference.trim().length === 0
    ) {
      fail("missing_authority");
      continue;
    }
    if (decision.kind === "owner_only_encrypted_quarantine") {
      const deadline = validDate(decision.rotationDeadline);
      if (deadline === null) {
        fail("invalid_timestamp");
      } else if (deadline <= input.now.getTime()) {
        fail("expired_deadline");
      } else if (deadline - decidedAt > maximumQuarantineMilliseconds) {
        fail("deadline_exceeds_limit");
      }
    }
  }

  const evaluatedAt = input.now.toISOString();
  return Object.freeze({
    gate: "G2",
    eligible: failures.length === 0,
    evaluatedAt,
    recordCount: input.records.length,
    acceptedCount: input.records.length - failures.length,
    failures: Object.freeze(failures),
    inventorySha256: inventoryHash
  });
}
