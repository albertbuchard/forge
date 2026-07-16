import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  closeDatabase,
  configureDatabase,
  configureLegacyWikiAutoImport,
  getDatabase,
  initializeDatabase
} from "./db.js";
import {
  type PeerPairingPersistenceStep,
  PeerPairingPersistenceError,
  persistLocalPeerIdentity,
  persistPeerPairingConfirmation
} from "./repositories/peer-pairing.js";
import { createPeerPendingRequest } from "./repositories/peer-sharing.js";
import { createPerson, softDeletePerson } from "./repositories/people.js";
import { getDefaultUser } from "./repositories/users.js";
import type {
  PeerLocalIdentity,
  PeerPairingConfirmation,
  PeerPairingDevice,
  PeerPairingPrincipal
} from "./services/peer-core-gateway.js";

const now = new Date("2026-07-15T12:00:00.000Z");
const expiresAt = "2026-07-15T12:10:00.000Z";
const verificationPhraseHash =
  "06f35368d3e9c31f0dff25673165dfffc06949f874a67903c0918e0c1ac3540d";
type ProtocolVectorName = "primary" | "secondOwner";
type ProtocolVector = {
  ownerUserId: string;
  pairingId: string;
  invitationId: string;
  transcriptHash: string;
  relationshipId: string;
  stateBinding: string;
  identityEvidenceHash: string;
  confirmationEvidenceHash: string;
};

const protocolVectors: Record<ProtocolVectorName, ProtocolVector> = {
  primary: {
    ownerUserId: "user_operator",
    pairingId: "5".repeat(32),
    invitationId: "9".repeat(32),
    transcriptHash: "7".repeat(64),
    relationshipId: "7719798402551fce37eeed892129d64d",
    stateBinding:
      "8c38305864f34262059ed2e7a8814ac43fa0a97183ff15fb0db477371d736c8f",
    identityEvidenceHash:
      "bf7d7254886c1be029c3ad5d16cfbc2c8385aa36f240fa7c1fc1207ccb82463e",
    confirmationEvidenceHash:
      "f03b7af9204a93a2045c4e6fef8ae7be665c5a20db0f3484a92581b6776a9990"
  },
  secondOwner: {
    ownerUserId: "user_other",
    pairingId: "a".repeat(32),
    invitationId: "c".repeat(32),
    transcriptHash: "f".repeat(64),
    relationshipId: "fe5a34781c9a11447ab930813cf064ac",
    stateBinding:
      "56bd7359df7a382f9dc5fac1e5733ed7a9d136b9406310a2929d0ea85e5f1518",
    identityEvidenceHash:
      "64a115655fcbd2fce4549b682d90a07d37b3a4fa7f6e959b37078d8d1871a0af",
    confirmationEvidenceHash:
      "20f35435bfb26fc43f7cb31ae6f4fc8315e7af02aa5cdafc33db796d0a629c25"
  }
};

async function withDatabase(
  operation: (ownerUserId: string) => void | Promise<void>
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-peer-pairing-"));
  configureDatabase({ dataRoot: root, seedDemoData: false });
  configureLegacyWikiAutoImport(false);
  await initializeDatabase();
  try {
    await operation(getDefaultUser().id);
  } finally {
    closeDatabase();
    await rm(root, { recursive: true, force: true });
  }
}

function principal(
  fill: string,
  certificateHash: string
): PeerPairingPrincipal {
  return {
    id: fill.repeat(64),
    rootPublicKey: Buffer.alloc(32, Number.parseInt(fill, 16)).toString(
      "base64url"
    ),
    trustState: "verified",
    certificateHash
  };
}

function device(input: {
  fill: string;
  principalId: string;
  certificateHash: string;
  remote?: boolean;
}): PeerPairingDevice {
  const numeric = Number.parseInt(input.fill, 16);
  return {
    id: input.fill.repeat(32),
    principalId: input.principalId,
    signingPublicKey: Buffer.alloc(32, numeric).toString("base64url"),
    keyAgreementPublicKey: Buffer.alloc(32, numeric + 1).toString("base64url"),
    certificateSerial: "1",
    certificate: Buffer.alloc(128, numeric + 2).toString("base64url"),
    certificateHash: input.certificateHash,
    capabilities: ["direct_stream", "iroh", "query", "projection"],
    transportEndpoints: input.remote
      ? [
          {
            kind: "iroh",
            endpointId: Buffer.alloc(32, numeric + 3).toString("base64url"),
            relayOrigin: "https://relay.example"
          }
        ]
      : [{ kind: "local_direct", host: "127.0.0.1", port: 44321 }],
    status: "approved"
  };
}

function fixture(
  ownerUserId: string,
  vectorName: ProtocolVectorName = "primary"
) {
  const vector = protocolVectors[vectorName];
  assert.equal(ownerUserId, vector.ownerUserId);
  const localCertificateHash = "a".repeat(64);
  const remoteCertificateHash = "b".repeat(64);
  const localPrincipal = principal("1", localCertificateHash);
  const remotePrincipal = principal("2", remoteCertificateHash);
  const localDevice = device({
    fill: "3",
    principalId: localPrincipal.id,
    certificateHash: localCertificateHash
  });
  const remoteDevice = device({
    fill: "4",
    principalId: remotePrincipal.id,
    certificateHash: remoteCertificateHash,
    remote: true
  });
  const pairingId = vector.pairingId;
  const relationshipId = vector.relationshipId;
  const transcriptHash = vector.transcriptHash;
  const requestPayload = {
    protocolVersion: "forge-peer/1" as const,
    invitationId: vector.invitationId,
    transcriptHash,
    verificationPhrase: "amber cedar river",
    verificationPhraseHash,
    localPrincipalId: localPrincipal.id,
    localDeviceId: localDevice.id,
    remotePrincipalId: remotePrincipal.id,
    remoteDeviceId: remoteDevice.id,
    stateBinding: vector.stateBinding
  };
  const provenance = {
    protocolVersion: "forge-peer/1" as const,
    ownerUserId,
    relationshipId: null,
    localPrincipalId: localPrincipal.id,
    localDeviceId: localDevice.id,
    remotePrincipalId: null,
    remoteDeviceId: null,
    evidenceHash: vector.identityEvidenceHash,
    authenticatedAt: now.toISOString()
  };
  const identity: PeerLocalIdentity = {
    principal: localPrincipal,
    device: localDevice,
    provenance
  };
  const confirmation: PeerPairingConfirmation = {
    relationship: {
      id: relationshipId,
      localPrincipal,
      remotePrincipal,
      localDevice,
      remoteDevice,
      negotiatedProtocolVersion: "forge-peer/1",
      verificationPhraseHash,
      privacyMode: "hide_network_address"
    },
    outboundEnvelope: Buffer.from("encrypted pairing acceptance", "utf8"),
    provenance: {
      ...provenance,
      relationshipId,
      remotePrincipalId: remotePrincipal.id,
      remoteDeviceId: remoteDevice.id,
      evidenceHash: vector.confirmationEvidenceHash
    }
  };
  return {
    pairingId,
    relationshipId,
    requestPayload,
    identity,
    confirmation,
    localPrincipal,
    localDevice,
    remotePrincipal,
    remoteDevice
  };
}

function preparePairing(
  ownerUserId: string,
  data: ReturnType<typeof fixture> = fixture(ownerUserId)
) {
  persistLocalPeerIdentity({ ownerUserId, identity: data.identity, now });
  createPeerPendingRequest({
    id: data.pairingId,
    ownerUserId,
    kind: "pairing",
    payload: data.requestPayload,
    expiresAt,
    now
  });
  return data;
}

function persist(input: {
  ownerUserId: string;
  data: ReturnType<typeof fixture>;
  personId?: string | null;
  createPersonDisplayName?: string | null;
  afterStep?: (step: PeerPairingPersistenceStep) => void;
  at?: Date;
}) {
  return persistPeerPairingConfirmation({
    ownerUserId: input.ownerUserId,
    pairingId: input.data.pairingId,
    expectedPendingVersion: 1,
    confirmation: input.data.confirmation,
    personId: input.personId ?? null,
    createPersonDisplayName: input.createPersonDisplayName ?? null,
    actorClass: "operator_session",
    actorId: "user:operator",
    now: input.at ?? now,
    afterStep: input.afterStep
  });
}

test("local identity bootstrap and pairing persist exact certificates, Person, envelope, and redacted audit", async () => {
  await withDatabase((ownerUserId) => {
    const data = preparePairing(ownerUserId);
    const result = persist({
      ownerUserId,
      data,
      createPersonDisplayName: "Jon"
    });
    assert.equal(result.relationshipId, data.relationshipId);
    assert.ok(result.personId);
    assert.deepEqual(
      {
        ...(getDatabase()
          .prepare(
            `SELECT status, version, decided_at AS decidedAt,
                    decision_reason AS decisionReason,
                    updated_at AS updatedAt
             FROM peer_pending_requests
             WHERE id = ? AND owner_user_id = ?`
          )
          .get(data.pairingId, ownerUserId) as Record<string, unknown>)
      },
      {
        status: "accepted",
        version: 2,
        decidedAt: now.toISOString(),
        decisionReason: "pairing_confirmed",
        updatedAt: now.toISOString()
      }
    );

    const remoteDevice = getDatabase()
      .prepare(
        `SELECT principal_id AS principalId,
                key_agreement_public_key AS keyAgreementPublicKey,
                certificate, certificate_serial AS certificateSerial,
                certificate_hash AS certificateHash,
                transport_endpoints_json AS endpoints,
                capabilities_json AS capabilities, private_key_secret_id AS secretId
         FROM forge_devices WHERE id = ?`
      )
      .get(data.remoteDevice.id) as Record<string, unknown>;
    assert.deepEqual(
      { ...remoteDevice, endpoints: undefined },
      {
        principalId: data.remotePrincipal.id,
        keyAgreementPublicKey: data.remoteDevice.keyAgreementPublicKey,
        certificate: data.remoteDevice.certificate,
        certificateSerial: "1",
        certificateHash: data.remoteDevice.certificateHash,
        endpoints: undefined,
        capabilities: JSON.stringify(data.remoteDevice.capabilities),
        secretId: null
      }
    );
    assert.deepEqual(
      JSON.parse(remoteDevice.endpoints as string),
      data.remoteDevice.transportEndpoints
    );

    const relationship = getDatabase()
      .prepare(
        `SELECT local_person_id AS personId, status,
                highest_received_sequence AS received,
                highest_sent_sequence AS sent
         FROM peer_relationships WHERE id = ?`
      )
      .get(data.relationshipId);
    assert.deepEqual(
      { ...relationship },
      {
        personId: result.personId,
        status: "active",
        received: 0,
        sent: 0
      }
    );
    const memberships = getDatabase()
      .prepare(
        `SELECT device_id AS deviceId, principal_role AS role, status
         FROM peer_relationship_devices WHERE relationship_id = ?
         ORDER BY role`
      )
      .all(data.relationshipId);
    assert.deepEqual(
      memberships.map((entry) => ({ ...entry })),
      [
        { deviceId: data.localDevice.id, role: "local", status: "approved" },
        { deviceId: data.remoteDevice.id, role: "remote", status: "approved" }
      ]
    );

    const outbox = getDatabase()
      .prepare(
        `SELECT recipient_device_id AS recipientDeviceId, sequence,
                previous_acknowledgement AS previousAcknowledgement,
                message_kind AS messageKind, mls_epoch AS mlsEpoch,
                ciphertext, ciphertext_hash AS ciphertextHash
         FROM peer_outbox WHERE relationship_id = ?`
      )
      .get(data.relationshipId) as {
      recipientDeviceId: string;
      sequence: number;
      previousAcknowledgement: number;
      messageKind: string;
      mlsEpoch: number;
      ciphertext: Uint8Array;
      ciphertextHash: string;
    };
    assert.equal(outbox.recipientDeviceId, data.remoteDevice.id);
    assert.equal(outbox.sequence, 1);
    assert.equal(outbox.previousAcknowledgement, 0);
    assert.equal(outbox.messageKind, "pairing_acceptance");
    assert.equal(outbox.mlsEpoch, 0);
    assert.deepEqual(
      Buffer.from(outbox.ciphertext),
      Buffer.from(data.confirmation.outboundEnvelope!)
    );
    assert.match(outbox.ciphertextHash, /^[a-f0-9]{64}$/);

    const audit = getDatabase()
      .prepare(
        `SELECT metadata_json AS metadata, evidence_json AS evidence
         FROM peer_audit_events WHERE relationship_id = ?`
      )
      .get(data.relationshipId) as { metadata: string; evidence: string };
    const auditText = `${audit.metadata}${audit.evidence}`;
    assert.doesNotMatch(auditText, /amber cedar river/);
    assert.doesNotMatch(auditText, new RegExp(data.remoteDevice.certificate));
    assert.doesNotMatch(auditText, /relay\.example/);

    const countsBefore = getDatabase()
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM people) AS people,
           (SELECT COUNT(*) FROM peer_relationships) AS relationships,
           (SELECT COUNT(*) FROM peer_outbox) AS outbox,
           (SELECT COUNT(*) FROM peer_audit_events) AS audit`
      )
      .get();
    assert.deepEqual(
      persist({
        ownerUserId,
        data,
        createPersonDisplayName: "Jon"
      }),
      result
    );
    assert.deepEqual(
      getDatabase()
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM people) AS people,
             (SELECT COUNT(*) FROM peer_relationships) AS relationships,
             (SELECT COUNT(*) FROM peer_outbox) AS outbox,
             (SELECT COUNT(*) FROM peer_audit_events) AS audit`
        )
        .get(),
      countsBefore
    );
  });
});

for (const substitution of [
  {
    name: "transcriptHash",
    apply(data: ReturnType<typeof fixture>) {
      data.requestPayload.transcriptHash = "0".repeat(64);
    }
  },
  {
    name: "stateBinding",
    apply(data: ReturnType<typeof fixture>) {
      data.requestPayload.stateBinding = "0".repeat(64);
    }
  },
  {
    name: "evidenceHash",
    apply(data: ReturnType<typeof fixture>) {
      data.confirmation.provenance.evidenceHash = "0".repeat(64);
    }
  }
] as const) {
  test(`pairing rejects ${substitution.name} substitution before writes`, async () => {
    await withDatabase((ownerUserId) => {
      const data = fixture(ownerUserId);
      substitution.apply(data);
      preparePairing(ownerUserId, data);
      assert.throws(
        () => persist({ ownerUserId, data }),
        (error: unknown) =>
          error instanceof PeerPairingPersistenceError &&
          error.code === "invalid"
      );
      assert.deepEqual(
        {
          ...(getDatabase()
            .prepare(
              `SELECT status, version, decided_at AS decidedAt,
                      decision_reason AS decisionReason
               FROM peer_pending_requests
               WHERE id = ? AND owner_user_id = ?`
            )
            .get(data.pairingId, ownerUserId) as Record<string, unknown>)
        },
        {
          status: "pending",
          version: 1,
          decidedAt: null,
          decisionReason: ""
        }
      );
      assert.deepEqual(
        {
          ...(getDatabase()
            .prepare(
              `SELECT
                 (SELECT COUNT(*) FROM forge_principals
                  WHERE principal_kind = 'remote') AS remotes,
                 (SELECT COUNT(*) FROM peer_relationships) AS relationships,
                 (SELECT COUNT(*) FROM peer_outbox) AS outbox,
                 (SELECT COUNT(*) FROM peer_audit_events) AS audit`
            )
            .get() as Record<string, unknown>)
        },
        { remotes: 0, relationships: 0, outbox: 0, audit: 0 }
      );
    });
  });
}

test("pairing supports an existing Person or no Person without inventing generic links", async () => {
  await withDatabase((ownerUserId) => {
    const person = createPerson(
      { userId: ownerUserId, displayName: "Existing Jon" },
      { now }
    );
    const data = preparePairing(ownerUserId);
    const result = persist({ ownerUserId, data, personId: person.id });
    assert.equal(result.personId, person.id);
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count FROM entity_links
             WHERE source_entity_type = 'person' AND source_entity_id = ?`
          )
          .get(person.id) as { count: number }
      ).count,
      0
    );
  });

  await withDatabase((ownerUserId) => {
    const data = preparePairing(ownerUserId);
    assert.equal(persist({ ownerUserId, data }).personId, null);
  });
});

test("accepted pairing exact replay returns the durable result without writes", async () => {
  await withDatabase((ownerUserId) => {
    const data = preparePairing(ownerUserId);
    const first = persist({ ownerUserId, data });
    const counts = getDatabase()
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM peer_relationships) AS relationships,
           (SELECT COUNT(*) FROM peer_relationship_devices) AS memberships,
           (SELECT COUNT(*) FROM peer_outbox) AS outbox,
           (SELECT COUNT(*) FROM peer_audit_events) AS audit`
      )
      .get();
    assert.deepEqual(
      persist({
        ownerUserId,
        data,
        at: new Date("2026-07-15T13:00:00.000Z")
      }),
      first
    );
    assert.deepEqual(
      getDatabase()
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM peer_relationships) AS relationships,
             (SELECT COUNT(*) FROM peer_relationship_devices) AS memberships,
             (SELECT COUNT(*) FROM peer_outbox) AS outbox,
             (SELECT COUNT(*) FROM peer_audit_events) AS audit`
        )
        .get(),
      counts
    );
  });
});

test("accepted pairing rejects a conflicting replay without changing the durable result", async () => {
  await withDatabase((ownerUserId) => {
    const data = preparePairing(ownerUserId);
    persist({ ownerUserId, data });
    const conflicting = structuredClone(data);
    conflicting.confirmation.outboundEnvelope = Buffer.from(
      "substituted encrypted pairing acceptance",
      "utf8"
    );
    assert.throws(
      () =>
        persist({
          ownerUserId,
          data: conflicting,
          at: new Date("2026-07-15T13:00:00.000Z")
        }),
      (error: unknown) =>
        error instanceof PeerPairingPersistenceError &&
        error.code === "conflict"
    );
    assert.deepEqual(
      {
        ...(getDatabase()
          .prepare(
            `SELECT status, version, decided_at AS decidedAt,
                    (SELECT COUNT(*) FROM peer_relationships) AS relationships,
                    (SELECT COUNT(*) FROM peer_outbox) AS outbox,
                    (SELECT COUNT(*) FROM peer_audit_events) AS audit
             FROM peer_pending_requests
             WHERE id = ? AND owner_user_id = ?`
          )
          .get(data.pairingId, ownerUserId) as Record<string, unknown>)
      },
      {
        status: "accepted",
        version: 2,
        decidedAt: now.toISOString(),
        relationships: 1,
        outbox: 1,
        audit: 1
      }
    );
  });
});

test("overlapping double confirmation commits one terminal transition", async () => {
  await withDatabase((ownerUserId) => {
    const data = preparePairing(ownerUserId);
    let contenderError: unknown;
    const result = persist({
      ownerUserId,
      data,
      afterStep: (step) => {
        if (step !== "pending_request") return;
        try {
          persist({ ownerUserId, data });
          assert.fail("An overlapping confirmation unexpectedly succeeded.");
        } catch (error) {
          contenderError = error;
        }
      }
    });
    assert.ok(contenderError instanceof PeerPairingPersistenceError);
    assert.equal(contenderError.code, "conflict");
    assert.deepEqual(result, {
      relationshipId: data.relationshipId,
      personId: null
    });
    assert.deepEqual(persist({ ownerUserId, data }), result);
    assert.deepEqual(
      {
        ...(getDatabase()
          .prepare(
            `SELECT status, version,
                    (SELECT COUNT(*) FROM peer_relationships) AS relationships,
                    (SELECT COUNT(*) FROM peer_outbox) AS outbox,
                    (SELECT COUNT(*) FROM peer_audit_events) AS audit
             FROM peer_pending_requests
             WHERE id = ? AND owner_user_id = ?`
          )
          .get(data.pairingId, ownerUserId) as Record<string, unknown>)
      },
      { status: "accepted", version: 2, relationships: 1, outbox: 1, audit: 1 }
    );
  });
});

test("pairing rejects foreign, deleted, stale, and cryptographically substituted state", async () => {
  await withDatabase((ownerUserId) => {
    const data = preparePairing(ownerUserId);
    assert.throws(
      () => persist({ ownerUserId, data, personId: "person_foreign" }),
      (error: unknown) =>
        error instanceof PeerPairingPersistenceError &&
        error.code === "not_found"
    );

    const deleted = createPerson(
      { userId: ownerUserId, displayName: "Deleted" },
      { now }
    );
    softDeletePerson(deleted.id, ownerUserId, { now });
    assert.throws(
      () => persist({ ownerUserId, data, personId: deleted.id }),
      (error: unknown) =>
        error instanceof PeerPairingPersistenceError &&
        error.code === "not_found"
    );

    const stale = structuredClone(data.confirmation);
    stale.provenance.authenticatedAt = "2026-07-15T11:00:00.000Z";
    assert.throws(
      () =>
        persistPeerPairingConfirmation({
          ownerUserId,
          pairingId: data.pairingId,
          expectedPendingVersion: 1,
          confirmation: stale,
          personId: null,
          createPersonDisplayName: null,
          actorClass: "operator_session",
          actorId: "user:operator",
          now
        }),
      /provenance/i
    );

    const substituted = structuredClone(data.confirmation);
    substituted.relationship.remoteDevice.certificate = Buffer.alloc(
      128,
      15
    ).toString("base64url");
    persist({ ownerUserId, data });
    assert.throws(
      () =>
        persist({
          ownerUserId,
          data: { ...data, confirmation: substituted }
        }),
      (error: unknown) =>
        error instanceof PeerPairingPersistenceError &&
        error.code === "conflict"
    );
  });
});

test("local identity bootstrap is idempotent, owner-partitioned, and rejects certificate substitution", async () => {
  await withDatabase((ownerUserId) => {
    const data = fixture(ownerUserId);
    const first = persistLocalPeerIdentity({
      ownerUserId,
      identity: data.identity,
      now
    });
    assert.deepEqual(
      persistLocalPeerIdentity({ ownerUserId, identity: data.identity, now }),
      first
    );

    const substituted = structuredClone(data.identity);
    substituted.device.certificate = Buffer.alloc(128, 14).toString(
      "base64url"
    );
    assert.throws(
      () =>
        persistLocalPeerIdentity({ ownerUserId, identity: substituted, now }),
      (error: unknown) =>
        error instanceof PeerPairingPersistenceError &&
        error.code === "conflict"
    );

    getDatabase()
      .prepare(
        `INSERT INTO users (
           id, kind, handle, display_name, description, accent_color,
           created_at, updated_at
         ) VALUES ('user_other', 'human', 'other', 'Other', '', '#000000', ?, ?)`
      )
      .run(now.toISOString(), now.toISOString());
    const foreignIdentity = structuredClone(data.identity);
    foreignIdentity.provenance.ownerUserId = "user_other";
    foreignIdentity.provenance.evidenceHash =
      protocolVectors.secondOwner.identityEvidenceHash;
    assert.deepEqual(
      persistLocalPeerIdentity({
        ownerUserId: "user_other",
        identity: foreignIdentity,
        now
      }),
      first
    );
    assert.deepEqual(
      getDatabase()
        .prepare(
          `SELECT owner_user_id AS ownerUserId
           FROM forge_principals WHERE id = ? ORDER BY owner_user_id`
        )
        .all(data.localPrincipal.id)
        .map((row) => ({ ...row })),
      [{ ownerUserId }, { ownerUserId: "user_other" }]
    );
    assert.deepEqual(
      getDatabase()
        .prepare(
          `SELECT owner_user_id AS ownerUserId
           FROM forge_devices WHERE id = ? ORDER BY owner_user_id`
        )
        .all(data.localDevice.id)
        .map((row) => ({ ...row })),
      [{ ownerUserId }, { ownerUserId: "user_other" }]
    );
  });
});

test("pairing cannot borrow another owner's matching identities and supports the same remote peer after owner bootstrap", async () => {
  await withDatabase((ownerUserId) => {
    const ownerAData = preparePairing(ownerUserId);
    persist({ ownerUserId, data: ownerAData });

    const ownerB = "user_other";
    getDatabase()
      .prepare(
        `INSERT INTO users (
           id, kind, handle, display_name, description, accent_color,
           created_at, updated_at
         ) VALUES (?, 'human', 'other', 'Other', '', '#000000', ?, ?)`
      )
      .run(ownerB, now.toISOString(), now.toISOString());
    const ownerBData = fixture(ownerB, "secondOwner");
    createPeerPendingRequest({
      id: ownerBData.pairingId,
      ownerUserId: ownerB,
      kind: "pairing",
      payload: ownerBData.requestPayload,
      expiresAt,
      now
    });

    assert.throws(
      () => persist({ ownerUserId: ownerB, data: ownerBData }),
      (error: unknown) =>
        error instanceof PeerPairingPersistenceError &&
        error.code === "not_found"
    );
    persistLocalPeerIdentity({
      ownerUserId: ownerB,
      identity: ownerBData.identity,
      now
    });
    assert.deepEqual(persist({ ownerUserId: ownerB, data: ownerBData }), {
      relationshipId: ownerBData.relationshipId,
      personId: null
    });

    for (const [table, id] of [
      ["forge_principals", ownerBData.remotePrincipal.id],
      ["forge_devices", ownerBData.remoteDevice.id]
    ] as const) {
      assert.deepEqual(
        getDatabase()
          .prepare(
            `SELECT owner_user_id AS ownerUserId FROM ${table}
             WHERE id = ? ORDER BY owner_user_id`
          )
          .all(id)
          .map((row) => ({ ...row })),
        [{ ownerUserId }, { ownerUserId: ownerB }]
      );
    }
    assert.deepEqual(
      getDatabase()
        .prepare(
          `SELECT owner_user_id AS ownerUserId, id
           FROM peer_relationships ORDER BY owner_user_id`
        )
        .all()
        .map((row) => ({ ...row })),
      [
        { ownerUserId, id: ownerAData.relationshipId },
        { ownerUserId: ownerB, id: ownerBData.relationshipId }
      ]
    );
    assert.deepEqual(
      getDatabase().prepare("PRAGMA foreign_key_check").all(),
      []
    );
  });
});

for (const failureStep of [
  "pending_request",
  "person",
  "remote_principal",
  "remote_device",
  "relationship",
  "local_membership",
  "remote_membership",
  "outbox",
  "audit"
] as const satisfies readonly PeerPairingPersistenceStep[]) {
  test(`pairing failure after ${failureStep} rolls back every local side effect`, async () => {
    await withDatabase((ownerUserId) => {
      const data = preparePairing(ownerUserId);
      assert.throws(
        () =>
          persist({
            ownerUserId,
            data,
            createPersonDisplayName: "Rollback Person",
            afterStep: (step) => {
              if (step === failureStep) throw new Error(`fault:${step}`);
            }
          }),
        new RegExp(`fault:${failureStep}`)
      );
      const counts = getDatabase()
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM people) AS people,
             (SELECT COUNT(*) FROM forge_principals WHERE principal_kind = 'remote') AS remotes,
             (SELECT COUNT(*) FROM forge_devices WHERE principal_id = ?) AS remoteDevices,
             (SELECT COUNT(*) FROM peer_relationships) AS relationships,
             (SELECT COUNT(*) FROM peer_relationship_devices) AS memberships,
             (SELECT COUNT(*) FROM peer_outbox) AS outbox,
             (SELECT COUNT(*) FROM peer_audit_events) AS audit`
        )
        .get(data.remotePrincipal.id);
      assert.deepEqual(
        { ...counts },
        {
          people: 0,
          remotes: 0,
          remoteDevices: 0,
          relationships: 0,
          memberships: 0,
          outbox: 0,
          audit: 0
        }
      );
      assert.deepEqual(
        {
          ...(getDatabase()
            .prepare(
              `SELECT status, version, decided_at AS decidedAt,
                      decision_reason AS decisionReason,
                      updated_at AS updatedAt
               FROM peer_pending_requests
               WHERE id = ? AND owner_user_id = ?`
            )
            .get(data.pairingId, ownerUserId) as Record<string, unknown>)
        },
        {
          status: "pending",
          version: 1,
          decidedAt: null,
          decisionReason: "",
          updatedAt: now.toISOString()
        }
      );
    });
  });
}
