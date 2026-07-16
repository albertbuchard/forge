import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import type { AuthenticatedPeerRevocationPage } from "./repositories/peer-sharing.js";
import {
  applyAuthenticatedPeerRevocationPage,
  getAppliedPeerRevocationState
} from "./repositories/peer-sharing.js";
import {
  decryptPeerCachePayload,
  encryptPeerCachePayload,
  peerCacheKeyId,
  type PeerCacheContext,
  type PeerCacheEnvelope
} from "./services/peer-cache-crypto.js";

const ISSUED_AT = "2026-07-16T08:00:00.000Z";
const AUTHENTICATED_AT = "2026-07-16T08:01:00.000Z";
const APPLIED_AT = new Date("2026-07-16T08:02:00.000Z");
const CACHE_KEY = new Uint8Array(32).fill(23);

type RevocationKind = AuthenticatedPeerRevocationPage["events"][number]["kind"];

type SeededRelationship = {
  relationshipId: string;
  grantId: string;
  signingDeviceId: string;
  signingCertificate: string;
  signingCertificateHash: string;
  targetDeviceId: string;
  targetCertificate: string;
  targetCertificateHash: string;
  targetCertificateSerial: string;
  cache: {
    id: string;
    context: PeerCacheContext;
    envelope: PeerCacheEnvelope;
    payload: Record<string, unknown>;
  };
};

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function key(byte: number): string {
  return Buffer.alloc(32, byte).toString("base64url");
}

function certificate(byte: number): string {
  return Buffer.alloc(96, byte).toString("base64url");
}

function signature(byte: number): string {
  return Buffer.alloc(64, byte).toString("base64url");
}

async function configureTemporaryDatabase(rootDir: string): Promise<void> {
  configureDatabase({ dataRoot: rootDir, seedDemoData: false });
  configureLegacyWikiAutoImport(false);
  await initializeDatabase();
}

async function withTemporaryDatabase(
  operation: (rootDir: string) => Promise<void>
): Promise<void> {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-peer-revocation-repository-")
  );
  await configureTemporaryDatabase(rootDir);
  try {
    await operation(rootDir);
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
}

function insertOwner(ownerUserId: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO users (
         id, kind, handle, display_name, description, accent_color,
         created_at, updated_at
       ) VALUES (?, 'human', ?, ?, '', '#123456', ?, ?)`
    )
    .run(ownerUserId, ownerUserId, ownerUserId, ISSUED_AT, ISSUED_AT);
}

async function seedRelationship(input: {
  ownerUserId: string;
  relationshipId: string;
  namespace: string;
  byte: number;
}): Promise<SeededRelationship> {
  const localPrincipalId = hash(`${input.namespace}:local-principal`);
  const remotePrincipalId = hash(`${input.namespace}:remote-principal`);
  const signingDeviceId = hash(`${input.namespace}:signing-device`).slice(
    0,
    32
  );
  const targetDeviceId = hash(`${input.namespace}:target-device`).slice(0, 32);
  const signingCertificate = certificate(input.byte);
  const signingCertificateHash = hash(signingCertificate);
  const targetCertificate = certificate(input.byte + 1);
  const targetCertificateHash = hash(targetCertificate);
  const targetCertificateSerial = String(input.byte + 100);
  const grantId = `${input.namespace}_grant`;

  getDatabase()
    .prepare(
      `INSERT INTO forge_principals (
         id, owner_user_id, principal_kind, public_principal_id,
         root_public_key, root_key_secret_id, display_label, trust_state,
         first_verified_at, last_verified_at, created_at, updated_at
       ) VALUES
         (?, ?, 'local', ?, ?, ?, 'Local', 'verified', ?, ?, ?, ?),
         (?, ?, 'remote', ?, ?, NULL, 'Remote', 'verified', ?, ?, ?, ?)`
    )
    .run(
      localPrincipalId,
      input.ownerUserId,
      localPrincipalId,
      key(input.byte),
      `${input.namespace}_root_secret`,
      ISSUED_AT,
      ISSUED_AT,
      ISSUED_AT,
      ISSUED_AT,
      remotePrincipalId,
      input.ownerUserId,
      remotePrincipalId,
      key(input.byte + 1),
      ISSUED_AT,
      ISSUED_AT,
      ISSUED_AT,
      ISSUED_AT
    );
  getDatabase()
    .prepare(
      `INSERT INTO peer_relationships (
         id, owner_user_id, local_principal_id, remote_principal_id,
         status, verification_phrase_hash, established_at, last_connected_at,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
    )
    .run(
      input.relationshipId,
      input.ownerUserId,
      localPrincipalId,
      remotePrincipalId,
      hash(`${input.namespace}:phrase`),
      ISSUED_AT,
      ISSUED_AT,
      ISSUED_AT,
      ISSUED_AT
    );
  const insertDevice = getDatabase().prepare(
    `INSERT INTO forge_devices (
       id, owner_user_id, principal_id, certified_public_key,
       key_agreement_public_key, private_key_secret_id, certificate,
       certificate_serial, certificate_hash, label, device_type, status,
       added_at, last_seen_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'test', 'approved', ?, ?, ?, ?)`
  );
  insertDevice.run(
    signingDeviceId,
    input.ownerUserId,
    localPrincipalId,
    key(input.byte + 2),
    key(input.byte + 3),
    `${input.namespace}_device_secret`,
    signingCertificate,
    String(input.byte),
    signingCertificateHash,
    "Signing device",
    ISSUED_AT,
    ISSUED_AT,
    ISSUED_AT,
    ISSUED_AT
  );
  insertDevice.run(
    targetDeviceId,
    input.ownerUserId,
    remotePrincipalId,
    key(input.byte + 4),
    key(input.byte + 5),
    null,
    targetCertificate,
    targetCertificateSerial,
    targetCertificateHash,
    "Target device",
    ISSUED_AT,
    ISSUED_AT,
    ISSUED_AT,
    ISSUED_AT
  );
  const insertRelationshipDevice = getDatabase().prepare(
    `INSERT INTO peer_relationship_devices (
       relationship_id, owner_user_id, device_id, principal_role, status,
       approved_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'approved', ?, ?, ?)`
  );
  insertRelationshipDevice.run(
    input.relationshipId,
    input.ownerUserId,
    signingDeviceId,
    "local",
    ISSUED_AT,
    ISSUED_AT,
    ISSUED_AT
  );
  insertRelationshipDevice.run(
    input.relationshipId,
    input.ownerUserId,
    targetDeviceId,
    "remote",
    ISSUED_AT,
    ISSUED_AT,
    ISSUED_AT
  );
  const versionHash = hash(`${input.namespace}:grant`);
  getDatabase()
    .prepare(
      `INSERT INTO peer_share_grants (
         id, sequence, owner_user_id, relationship_id, direction, status,
         previous_version_hash, version_hash, label, purpose,
         canonical_grant_json, cache_policy_json, signatures_json,
         verification_evidence_json, issued_at, accepted_at, effective_at,
         created_at
       ) VALUES (?, 1, ?, ?, 'remote_to_local', 'active', NULL, ?, ?, '',
                 '{}', '{}', '[]', '{}', ?, ?, ?, ?)`
    )
    .run(
      grantId,
      input.ownerUserId,
      input.relationshipId,
      versionHash,
      `${input.namespace} grant`,
      ISSUED_AT,
      ISSUED_AT,
      ISSUED_AT,
      ISSUED_AT
    );
  getDatabase()
    .prepare(
      `INSERT INTO peer_grant_verifications (
         id, owner_user_id, relationship_id, grant_id, grant_sequence,
         verified_grant_hash, verified_signatures_json,
         verified_signer_device_ids_json,
         approved_relationship_device_ids_json, requesting_device_id,
         verification_result, verified_at, created_at
       ) VALUES (?, ?, ?, ?, 1, ?, '[]', ?, ?, ?, 'valid', ?, ?)`
    )
    .run(
      `${input.namespace}_verification`,
      input.ownerUserId,
      input.relationshipId,
      grantId,
      versionHash,
      JSON.stringify([signingDeviceId, targetDeviceId]),
      JSON.stringify([signingDeviceId, targetDeviceId]),
      targetDeviceId,
      ISSUED_AT,
      ISSUED_AT
    );

  const context: PeerCacheContext = {
    ownerUserId: input.ownerUserId,
    relationshipId: input.relationshipId,
    projectionId: "calendar.availability.v1",
    queryHash: hash(`${input.namespace}:query`),
    sourceRecordId: `${input.namespace}_record`,
    sourceVersion: "1"
  };
  const payload = { owner: input.ownerUserId, secret: input.namespace };
  const cacheId = `${input.namespace}_cache`;
  const keyId = peerCacheKeyId(CACHE_KEY);
  const envelope = await encryptPeerCachePayload({
    key: CACHE_KEY,
    keyId,
    context,
    payload
  });
  getDatabase()
    .prepare(
      `INSERT INTO peer_remote_records (
         id, owner_user_id, relationship_id, projection_id,
         source_record_id, source_version, encrypted_payload,
         encryption_key_id, encryption_nonce, payload_hash,
         query_metadata_json, query_hash, source_timestamp, received_at,
         valid_until, grant_id, grant_sequence, cache_state, created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1,
                 'current', ?, ?)`
    )
    .run(
      cacheId,
      input.ownerUserId,
      input.relationshipId,
      context.projectionId,
      context.sourceRecordId,
      context.sourceVersion,
      Buffer.from(envelope.ciphertextBase64, "base64"),
      keyId,
      Buffer.from(envelope.nonceBase64, "base64"),
      hash(JSON.stringify(payload)),
      JSON.stringify({ authenticated: true, queryHash: context.queryHash }),
      context.queryHash,
      ISSUED_AT,
      ISSUED_AT,
      "2026-07-17T08:00:00.000Z",
      grantId,
      ISSUED_AT,
      ISSUED_AT
    );
  return {
    relationshipId: input.relationshipId,
    grantId,
    signingDeviceId,
    signingCertificate,
    signingCertificateHash,
    targetDeviceId,
    targetCertificate,
    targetCertificateHash,
    targetCertificateSerial,
    cache: { id: cacheId, context, envelope, payload }
  };
}

function revocationPage(
  ownerUserId: string,
  relationships: SeededRelationship[]
): AuthenticatedPeerRevocationPage {
  const kinds: RevocationKind[] = [
    "grant",
    "device",
    "relationship",
    "credential_retirement"
  ];
  let previousEventHash = "0".repeat(64);
  const events = relationships.map((relationship, index) => {
    const kind = kinds[index]!;
    const eventHash = hash(`event:${index + 1}`);
    const targetsDevice = kind === "device" || kind === "credential_retirement";
    const event = {
      cursor: String(index + 1),
      eventHash,
      previousEventHash,
      kind,
      source: "local_operator" as const,
      relationshipId: relationship.relationshipId,
      grantId: kind === "grant" ? relationship.grantId : null,
      deviceId: targetsDevice ? relationship.targetDeviceId : null,
      targetCertificate: targetsDevice ? relationship.targetCertificate : null,
      targetCertificateHash: targetsDevice
        ? relationship.targetCertificateHash
        : null,
      targetCertificateSerial: targetsDevice
        ? relationship.targetCertificateSerial
        : null,
      reason: `Test ${kind} revocation`,
      occurredAt: ISSUED_AT,
      authenticatedRemotePrincipalId: null,
      authenticatedRemoteDeviceId: null,
      signingDeviceId: relationship.signingDeviceId,
      signingCertificate: relationship.signingCertificate,
      signingCertificateHash: relationship.signingCertificateHash,
      signature: signature(index + 1)
    };
    previousEventHash = eventHash;
    return event;
  });
  return {
    events,
    acknowledgedCursor: "0",
    nextCursor: "4",
    hasMore: false,
    provenance: {
      protocolVersion: "forge-peer/1",
      ownerUserId,
      relationshipId: null,
      localPrincipalId: `${ownerUserId}_revocation_principal`,
      localDeviceId: `${ownerUserId}_revocation_device`,
      remotePrincipalId: null,
      remoteDeviceId: null,
      evidenceHash: hash(`${ownerUserId}:page-evidence`),
      authenticatedAt: AUTHENTICATED_AT
    }
  };
}

function cacheRows(ownerUserId: string) {
  return getDatabase()
    .prepare(
      `SELECT id, encrypted_payload, encryption_key_id, encryption_nonce,
              query_metadata_json, cache_state, next_event_at, revoked_at
       FROM peer_remote_records WHERE owner_user_id = ? ORDER BY id`
    )
    .all(ownerUserId) as Array<{
    id: string;
    encrypted_payload: Uint8Array;
    encryption_key_id: string;
    encryption_nonce: Uint8Array;
    query_metadata_json: string;
    cache_state: string;
    next_event_at: string | null;
    revoked_at: string | null;
  }>;
}

test("authenticated revocation pages apply atomically per owner and survive replay after restart", async () => {
  await withTemporaryDatabase(async (rootDir) => {
    insertOwner("owner_a");
    insertOwner("owner_b");
    const ownerA = await Promise.all(
      [1, 2, 3, 4].map((index) =>
        seedRelationship({
          ownerUserId: "owner_a",
          relationshipId: `${"a".repeat(31)}${index}`,
          namespace: `owner_a_${index}`,
          byte: 10 + index * 8
        })
      )
    );
    const ownerB = await Promise.all(
      [1, 2, 3, 4].map((index) =>
        seedRelationship({
          ownerUserId: "owner_b",
          relationshipId: `${"b".repeat(31)}${index}`,
          namespace: `owner_b_${index}`,
          byte: 80 + index * 8
        })
      )
    );
    const page = revocationPage("owner_a", ownerA);
    const invalidPage = structuredClone(page);
    invalidPage.events[3]!.signingDeviceId = "unbound_signing_device";

    assert.throws(
      () =>
        applyAuthenticatedPeerRevocationPage({
          ownerUserId: "owner_a",
          consumerId: "service_worker_revocations",
          afterCursor: "0",
          page: invalidPage,
          now: APPLIED_AT
        }),
      /signing device is not locally bound/
    );
    assert.equal(
      getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count FROM peer_idempotency_records
           WHERE operation_id = 'apply_authenticated_revocations'`
        )
        .get()!.count,
      0
    );
    assert.deepEqual(
      cacheRows("owner_a").map((row) => row.cache_state),
      ["current", "current", "current", "current"]
    );

    assert.throws(
      () =>
        applyAuthenticatedPeerRevocationPage({
          ownerUserId: "owner_b",
          consumerId: "service_worker_revocations",
          afterCursor: "0",
          page,
          now: APPLIED_AT
        }),
      /outside its exact owner cursor/
    );

    const applied = applyAuthenticatedPeerRevocationPage({
      ownerUserId: "owner_a",
      consumerId: "service_worker_revocations",
      afterCursor: "0",
      page,
      now: APPLIED_AT
    });
    assert.deepEqual(applied, {
      consumerId: "service_worker_revocations",
      throughCursor: "4",
      eventHash: page.events[3]!.eventHash,
      eventCount: 4,
      appliedAt: APPLIED_AT.toISOString(),
      replayed: false
    });
    assert.deepEqual(
      getAppliedPeerRevocationState({
        ownerUserId: "owner_a",
        consumerId: "service_worker_revocations"
      }),
      {
        consumerId: "service_worker_revocations",
        throughCursor: "4",
        eventHash: page.events[3]!.eventHash,
        appliedAt: APPLIED_AT.toISOString()
      }
    );
    assert.equal(
      getAppliedPeerRevocationState({
        ownerUserId: "owner_b",
        consumerId: "service_worker_revocations"
      }),
      null
    );

    const revokedCaches = cacheRows("owner_a");
    assert.equal(revokedCaches.length, 4);
    for (const row of revokedCaches) {
      assert.equal(row.cache_state, "revoked");
      assert.equal(row.query_metadata_json, "{}");
      assert.equal(row.next_event_at, null);
      assert.equal(row.revoked_at, APPLIED_AT.toISOString());
      const original = ownerA.find((seeded) => seeded.cache.id === row.id);
      assert.ok(original);
      await assert.rejects(
        decryptPeerCachePayload({
          key: CACHE_KEY,
          expectedKeyId: row.encryption_key_id,
          context: original.cache.context,
          envelope: {
            ...original.cache.envelope,
            nonceBase64: Buffer.from(row.encryption_nonce).toString("base64"),
            ciphertextBase64: Buffer.from(row.encrypted_payload).toString(
              "base64"
            )
          }
        }),
        /payload authentication failed/
      );
    }
    const readableOwnerBCaches = cacheRows("owner_b");
    assert.deepEqual(
      readableOwnerBCaches.map((row) => row.cache_state),
      ["current", "current", "current", "current"]
    );
    for (const row of readableOwnerBCaches) {
      const original = ownerB.find((seeded) => seeded.cache.id === row.id);
      assert.ok(original);
      assert.deepEqual(
        await decryptPeerCachePayload({
          key: CACHE_KEY,
          expectedKeyId: row.encryption_key_id,
          context: original.cache.context,
          envelope: {
            ...original.cache.envelope,
            nonceBase64: Buffer.from(row.encryption_nonce).toString("base64"),
            ciphertextBase64: Buffer.from(row.encrypted_payload).toString(
              "base64"
            )
          }
        }),
        original.cache.payload
      );
    }

    assert.deepEqual(
      getDatabase()
        .prepare(
          `SELECT verification_result FROM peer_grant_verifications
           WHERE owner_user_id = 'owner_a' ORDER BY id`
        )
        .all()
        .map((row) => row.verification_result),
      ["invalid", "invalid", "invalid", "invalid"]
    );
    assert.equal(
      getDatabase()
        .prepare(
          `SELECT status FROM peer_relationships
           WHERE owner_user_id = 'owner_a' AND id = ?`
        )
        .get(ownerA[2]!.relationshipId)!.status,
      "revoked"
    );
    for (const target of [ownerA[1]!, ownerA[3]!]) {
      assert.equal(
        getDatabase()
          .prepare(
            `SELECT status FROM forge_devices
             WHERE owner_user_id = 'owner_a' AND id = ?`
          )
          .get(target.targetDeviceId)!.status,
        "revoked"
      );
    }
    assert.equal(
      getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count FROM peer_audit_events
           WHERE owner_user_id = 'owner_a'
             AND event_type LIKE 'authenticated_%_revocation_applied'`
        )
        .get()!.count,
      4
    );
    assert.equal(
      getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count FROM peer_remote_records
           WHERE owner_user_id = 'owner_a' AND cache_state = 'current'`
        )
        .get()!.count,
      0
    );
    assert.equal(
      getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count FROM peer_remote_records
           WHERE owner_user_id = 'owner_b' AND cache_state = 'current'`
        )
        .get()!.count,
      4
    );

    closeDatabase();
    await configureTemporaryDatabase(rootDir);
    const replay = applyAuthenticatedPeerRevocationPage({
      ownerUserId: "owner_a",
      consumerId: "service_worker_revocations",
      afterCursor: "0",
      page,
      now: new Date("2026-07-16T09:00:00.000Z")
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.appliedAt, APPLIED_AT.toISOString());
    assert.equal(
      getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count FROM peer_audit_events
           WHERE owner_user_id = 'owner_a'
             AND event_type LIKE 'authenticated_%_revocation_applied'`
        )
        .get()!.count,
      4
    );
    assert.deepEqual(
      cacheRows("owner_b").map((row) => row.cache_state),
      ["current", "current", "current", "current"]
    );
  });
});
