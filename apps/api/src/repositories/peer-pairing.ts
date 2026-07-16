import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getDatabase, runInTransaction } from "../db.js";
import { PEER_PROTOCOL_VERSION } from "../peer-sharing-types.js";
import type {
  PeerAuthenticatedProvenance,
  PeerLocalIdentity,
  PeerPairingConfirmation,
  PeerPairingDevice,
  PeerPairingPrincipal
} from "../services/peer-core-gateway.js";
import { enqueuePeerOutboxEnvelope } from "./peer-delivery.js";
import { hashPeerApiValue } from "./peer-sharing.js";
import { createPerson, getPersonById } from "./people.js";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const pairingIdSchema = z.string().regex(/^[a-f0-9]{32}$/);
const pairingRequestPayloadSchema = z
  .object({
    protocolVersion: z.literal(PEER_PROTOCOL_VERSION),
    invitationId: z.string().trim().min(1).max(240),
    transcriptHash: hashSchema,
    verificationPhrase: z.string().trim().min(1).max(240),
    verificationPhraseHash: hashSchema,
    localPrincipalId: z.string().trim().min(1).max(240),
    localDeviceId: z.string().trim().min(1).max(240),
    remotePrincipalId: z.string().trim().min(1).max(240),
    remoteDeviceId: z.string().trim().min(1).max(240),
    stateBinding: hashSchema
  })
  .strict();

const peerActorClassSchema = z.enum([
  "operator_session",
  "agent_token",
  "companion_session",
  "companion_consent",
  "local_service",
  "system"
]);

type PeerActorClass = z.infer<typeof peerActorClassSchema>;

const BLAKE3_IV = Uint32Array.of(
  0x6a09e667,
  0xbb67ae85,
  0x3c6ef372,
  0xa54ff53a,
  0x510e527f,
  0x9b05688c,
  0x1f83d9ab,
  0x5be0cd19
);
const BLAKE3_MESSAGE_PERMUTATION = [
  2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8
] as const;
const BLAKE3_CHUNK_START = 1;
const BLAKE3_CHUNK_END = 2;
const BLAKE3_ROOT = 8;
const BLAKE3_DERIVE_KEY_CONTEXT = 32;
const BLAKE3_DERIVE_KEY_MATERIAL = 64;
const BLAKE3_BLOCK_BYTES = 64;
const BLAKE3_CHUNK_BYTES = 1_024;

type Blake3Output = {
  inputChainingValue: Uint32Array;
  blockWords: Uint32Array;
  blockLength: number;
  flags: number;
};

function rotateRight32(value: number, count: number): number {
  return ((value >>> count) | (value << (32 - count))) >>> 0;
}

function blake3Mix(
  state: Uint32Array,
  a: number,
  b: number,
  c: number,
  d: number,
  left: number,
  right: number
) {
  state[a] = (state[a]! + state[b]! + left) >>> 0;
  state[d] = rotateRight32(state[d]! ^ state[a]!, 16);
  state[c] = (state[c]! + state[d]!) >>> 0;
  state[b] = rotateRight32(state[b]! ^ state[c]!, 12);
  state[a] = (state[a]! + state[b]! + right) >>> 0;
  state[d] = rotateRight32(state[d]! ^ state[a]!, 8);
  state[c] = (state[c]! + state[d]!) >>> 0;
  state[b] = rotateRight32(state[b]! ^ state[c]!, 7);
}

function blake3Compress(
  chainingValue: Uint32Array,
  blockWords: Uint32Array,
  blockLength: number,
  flags: number
): Uint32Array {
  const state = new Uint32Array(16);
  state.set(chainingValue, 0);
  state.set(BLAKE3_IV.subarray(0, 4), 8);
  state[14] = blockLength;
  state[15] = flags;
  let schedule = Array.from({ length: 16 }, (_, index) => index);
  for (let round = 0; round < 7; round += 1) {
    blake3Mix(
      state,
      0,
      4,
      8,
      12,
      blockWords[schedule[0]!]!,
      blockWords[schedule[1]!]!
    );
    blake3Mix(
      state,
      1,
      5,
      9,
      13,
      blockWords[schedule[2]!]!,
      blockWords[schedule[3]!]!
    );
    blake3Mix(
      state,
      2,
      6,
      10,
      14,
      blockWords[schedule[4]!]!,
      blockWords[schedule[5]!]!
    );
    blake3Mix(
      state,
      3,
      7,
      11,
      15,
      blockWords[schedule[6]!]!,
      blockWords[schedule[7]!]!
    );
    blake3Mix(
      state,
      0,
      5,
      10,
      15,
      blockWords[schedule[8]!]!,
      blockWords[schedule[9]!]!
    );
    blake3Mix(
      state,
      1,
      6,
      11,
      12,
      blockWords[schedule[10]!]!,
      blockWords[schedule[11]!]!
    );
    blake3Mix(
      state,
      2,
      7,
      8,
      13,
      blockWords[schedule[12]!]!,
      blockWords[schedule[13]!]!
    );
    blake3Mix(
      state,
      3,
      4,
      9,
      14,
      blockWords[schedule[14]!]!,
      blockWords[schedule[15]!]!
    );
    schedule = BLAKE3_MESSAGE_PERMUTATION.map((index) => schedule[index]!);
  }
  for (let index = 0; index < 8; index += 1) {
    state[index] = (state[index]! ^ state[index + 8]!) >>> 0;
    state[index + 8] = (state[index + 8]! ^ chainingValue[index]!) >>> 0;
  }
  return state;
}

function blake3BlockWords(block: Uint8Array): Uint32Array {
  const padded = Buffer.alloc(BLAKE3_BLOCK_BYTES);
  Buffer.from(block).copy(padded);
  return Uint32Array.from({ length: 16 }, (_, index) =>
    padded.readUInt32LE(index * 4)
  );
}

function blake3SingleChunkOutput(
  value: Uint8Array,
  key: Uint32Array,
  flags: number
): Blake3Output {
  if (value.byteLength > BLAKE3_CHUNK_BYTES) {
    throw new PeerPairingPersistenceError(
      "invalid",
      "Peer pairing cryptographic binding exceeds one BLAKE3 chunk."
    );
  }
  const blockCount = Math.max(
    1,
    Math.ceil(value.byteLength / BLAKE3_BLOCK_BYTES)
  );
  let chainingValue = key.slice();
  for (let index = 0; index < blockCount - 1; index += 1) {
    const block = value.subarray(
      index * BLAKE3_BLOCK_BYTES,
      (index + 1) * BLAKE3_BLOCK_BYTES
    );
    chainingValue = blake3Compress(
      chainingValue,
      blake3BlockWords(block),
      BLAKE3_BLOCK_BYTES,
      flags | (index === 0 ? BLAKE3_CHUNK_START : 0)
    ).slice(0, 8);
  }
  const finalOffset = (blockCount - 1) * BLAKE3_BLOCK_BYTES;
  const finalBlock = value.subarray(finalOffset);
  return {
    inputChainingValue: chainingValue,
    blockWords: blake3BlockWords(finalBlock),
    blockLength: finalBlock.byteLength,
    flags:
      flags | BLAKE3_CHUNK_END | (blockCount === 1 ? BLAKE3_CHUNK_START : 0)
  };
}

function blake3OutputBytes(output: Blake3Output): Buffer {
  const words = blake3Compress(
    output.inputChainingValue,
    output.blockWords,
    output.blockLength,
    output.flags | BLAKE3_ROOT
  );
  const bytes = Buffer.alloc(32);
  for (let index = 0; index < 8; index += 1) {
    bytes.writeUInt32LE(words[index]!, index * 4);
  }
  return bytes;
}

function blake3DeriveKey(context: string, material: Uint8Array): Buffer {
  const contextKey = blake3OutputBytes(
    blake3SingleChunkOutput(
      Buffer.from(context, "utf8"),
      BLAKE3_IV,
      BLAKE3_DERIVE_KEY_CONTEXT
    )
  );
  const contextWords = Uint32Array.from({ length: 8 }, (_, index) =>
    contextKey.readUInt32LE(index * 4)
  );
  return blake3OutputBytes(
    blake3SingleChunkOutput(material, contextWords, BLAKE3_DERIVE_KEY_MATERIAL)
  );
}

function hashBytes(value: string, label: string): Buffer {
  if (!hashSchema.safeParse(value).success) {
    throw new PeerPairingPersistenceError(
      "invalid",
      `Peer pairing ${label} is not a lowercase 32-byte hash.`
    );
  }
  return Buffer.from(value, "hex");
}

function exactHash(left: string, right: string): boolean {
  if (
    !hashSchema.safeParse(left).success ||
    !hashSchema.safeParse(right).success
  ) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function expectedAuthenticatedEvidenceHash(input: {
  ownerUserId: string;
  localCertificateHash: string;
  relationshipId: string | null;
  remoteCertificateHash: string | null;
}): string {
  const material = [
    Buffer.from(input.ownerUserId, "utf8"),
    hashBytes(input.localCertificateHash, "local certificate hash")
  ];
  if (input.relationshipId !== null) {
    if (input.remoteCertificateHash === null) {
      throw new PeerPairingPersistenceError(
        "invalid",
        "Peer pairing provenance is missing its remote certificate hash."
      );
    }
    material.push(
      Buffer.from(input.relationshipId, "utf8"),
      hashBytes(input.remoteCertificateHash, "remote certificate hash"),
      Buffer.alloc(8)
    );
  } else if (input.remoteCertificateHash !== null) {
    throw new PeerPairingPersistenceError(
      "invalid",
      "Local peer identity provenance unexpectedly includes a remote certificate."
    );
  }
  return blake3DeriveKey(
    "forge-peer/1 IPC authenticated provenance",
    Buffer.concat(material)
  ).toString("hex");
}

type PairingRequestPayload = z.infer<typeof pairingRequestPayloadSchema>;

function assertPairingProtocolBindings(input: {
  ownerUserId: string;
  pairingId: string;
  request: PairingRequestPayload;
  confirmation: PeerPairingConfirmation;
  now: Date;
  requireFresh: boolean;
}) {
  const parsedPairingId = pairingIdSchema.safeParse(input.pairingId);
  if (!parsedPairingId.success) {
    throw new PeerPairingPersistenceError(
      "invalid",
      "The pairing request ID is not a canonical 16-byte identifier."
    );
  }
  const relationship = input.confirmation.relationship;
  const transcriptHash = hashBytes(
    input.request.transcriptHash,
    "transcript hash"
  );
  const expectedRelationshipId = blake3DeriveKey(
    "forge-peer/1 relationship id",
    transcriptHash
  )
    .subarray(0, 16)
    .toString("hex");
  const expectedStateBinding = blake3DeriveKey(
    "forge-peer/1 pairing IPC state binding",
    Buffer.concat([
      Buffer.from(parsedPairingId.data, "hex"),
      transcriptHash,
      hashBytes(
        relationship.localDevice.certificateHash,
        "local certificate hash"
      )
    ])
  ).toString("hex");
  const expectedPhraseHash = blake3DeriveKey(
    "forge-peer/1 verification phrase",
    Buffer.from(input.request.verificationPhrase, "utf8")
  ).toString("hex");
  const exactTranscript =
    relationship.id === expectedRelationshipId &&
    relationship.localPrincipal.id === input.request.localPrincipalId &&
    relationship.localDevice.id === input.request.localDeviceId &&
    relationship.localDevice.principalId === relationship.localPrincipal.id &&
    relationship.remotePrincipal.id === input.request.remotePrincipalId &&
    relationship.remoteDevice.id === input.request.remoteDeviceId &&
    relationship.remoteDevice.principalId === relationship.remotePrincipal.id &&
    exactHash(
      relationship.localPrincipal.certificateHash,
      relationship.localDevice.certificateHash
    ) &&
    exactHash(
      relationship.remotePrincipal.certificateHash,
      relationship.remoteDevice.certificateHash
    ) &&
    exactHash(input.request.stateBinding, expectedStateBinding) &&
    exactHash(input.request.verificationPhraseHash, expectedPhraseHash) &&
    exactHash(
      relationship.verificationPhraseHash,
      input.request.verificationPhraseHash
    ) &&
    relationship.negotiatedProtocolVersion === PEER_PROTOCOL_VERSION;
  if (!exactTranscript) {
    throw new PeerPairingPersistenceError(
      "invalid",
      "The confirmed relationship does not match every reviewed pairing transcript and state binding."
    );
  }
  assertAuthenticatedProvenance({
    provenance: input.confirmation.provenance,
    ownerUserId: input.ownerUserId,
    relationshipId: relationship.id,
    localPrincipalId: relationship.localPrincipal.id,
    localDeviceId: relationship.localDevice.id,
    remotePrincipalId: relationship.remotePrincipal.id,
    remoteDeviceId: relationship.remoteDevice.id,
    expectedEvidenceHash: expectedAuthenticatedEvidenceHash({
      ownerUserId: input.ownerUserId,
      localCertificateHash: relationship.localDevice.certificateHash,
      relationshipId: relationship.id,
      remoteCertificateHash: relationship.remoteDevice.certificateHash
    }),
    now: input.now,
    requireFresh: input.requireFresh
  });
}

function pairingApplicationHash(input: {
  ownerUserId: string;
  pairingId: string;
  expectedPendingVersion: number;
  pendingPayloadHash: string;
  confirmation: PeerPairingConfirmation;
  personId: string | null;
  createPersonDisplayName: string | null;
  actorClass: PeerActorClass;
  actorId: string;
  envelopeHash: string;
}): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        actorClass: input.actorClass,
        actorId: input.actorId,
        confirmation: {
          envelopeHash: input.envelopeHash,
          provenance: input.confirmation.provenance,
          relationship: input.confirmation.relationship
        },
        createPersonDisplayName: input.createPersonDisplayName,
        decision: "accepted",
        expectedPendingVersion: input.expectedPendingVersion,
        ownerUserId: input.ownerUserId,
        pairingId: input.pairingId,
        pendingPayloadHash: input.pendingPayloadHash,
        personId: input.personId
      })
    )
    .digest("hex");
}

export type PeerPairingPersistenceStep =
  | "pending_request"
  | "person"
  | "remote_principal"
  | "remote_device"
  | "relationship"
  | "local_membership"
  | "remote_membership"
  | "outbox"
  | "audit";

export class PeerPairingPersistenceError extends Error {
  constructor(
    readonly code: "conflict" | "invalid" | "not_found",
    message: string
  ) {
    super(message);
    this.name = "PeerPairingPersistenceError";
  }
}

type PrincipalSqlRow = {
  id: string;
  owner_user_id: string;
  principal_kind: "local" | "remote";
  public_principal_id: string;
  root_public_key: string;
  root_key_secret_id: string | null;
  local_person_id: string | null;
  trust_state: string;
  minimum_protocol_version: number;
  maximum_protocol_version: number;
  revoked_at: string | null;
};

type DeviceSqlRow = {
  id: string;
  owner_user_id: string;
  principal_id: string;
  certified_public_key: string;
  key_agreement_public_key: string | null;
  private_key_secret_id: string | null;
  certificate: string;
  certificate_serial: string | null;
  certificate_hash: string | null;
  status: string;
  transport_endpoints_json: string;
  capabilities_json: string;
  revoked_at: string | null;
};

type RelationshipSqlRow = {
  id: string;
  owner_user_id: string;
  local_principal_id: string;
  remote_principal_id: string;
  local_person_id: string | null;
  status: string;
  negotiated_protocol_version: string;
  verification_phrase_hash: string;
  transport_privacy_mode: string;
  highest_received_sequence: number;
  highest_sent_sequence: number;
  established_at: string | null;
  revoked_at: string | null;
};

type PendingPairingSqlRow = {
  request_kind: string;
  status: string;
  version: number;
  payload_json: string;
  payload_hash: string;
  expires_at: string;
  decided_at: string | null;
  decision_reason: string;
  updated_at: string;
};

function canonicalJson(value: unknown): string {
  let nodeCount = 0;
  const visit = (candidate: unknown, depth: number): unknown => {
    nodeCount += 1;
    if (depth > 20 || nodeCount > 20_000) {
      throw new PeerPairingPersistenceError(
        "invalid",
        "Peer pairing data exceeds structural limits."
      );
    }
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "boolean" ||
      (typeof candidate === "number" && Number.isFinite(candidate))
    ) {
      return candidate;
    }
    if (Array.isArray(candidate)) {
      return candidate.map((entry) => visit(entry, depth + 1));
    }
    if (candidate && typeof candidate === "object") {
      const prototype = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new PeerPairingPersistenceError(
          "invalid",
          "Peer pairing data contains a non-plain object."
        );
      }
      return Object.fromEntries(
        Object.entries(candidate as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => {
            if (["__proto__", "constructor", "prototype"].includes(key)) {
              throw new PeerPairingPersistenceError(
                "invalid",
                "Peer pairing data contains a protected key."
              );
            }
            return [key, visit(nested, depth + 1)];
          })
      );
    }
    throw new PeerPairingPersistenceError(
      "invalid",
      "Peer pairing data contains a non-JSON value."
    );
  };
  return JSON.stringify(visit(value, 0));
}

function timestamp(now: Date): string {
  if (!Number.isFinite(now.getTime())) {
    throw new PeerPairingPersistenceError(
      "invalid",
      "Peer pairing time is invalid."
    );
  }
  return now.toISOString();
}

function deterministicId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash("sha256")
    .update(parts.join("\0"), "utf8")
    .digest("hex")}`;
}

function principalRow(ownerUserId: string, id: string): PrincipalSqlRow | null {
  return (
    (getDatabase()
      .prepare(
        `SELECT id, owner_user_id, principal_kind, public_principal_id,
                root_public_key, root_key_secret_id, local_person_id,
                trust_state, minimum_protocol_version,
                maximum_protocol_version, revoked_at
         FROM forge_principals
         WHERE owner_user_id = ? AND id = ? LIMIT 1`
      )
      .get(ownerUserId, id) as PrincipalSqlRow | undefined) ?? null
  );
}

function deviceRow(ownerUserId: string, id: string): DeviceSqlRow | null {
  return (
    (getDatabase()
      .prepare(
        `SELECT id, owner_user_id, principal_id, certified_public_key,
                key_agreement_public_key, private_key_secret_id, certificate,
                certificate_serial, certificate_hash, status,
                transport_endpoints_json, capabilities_json, revoked_at
         FROM forge_devices
         WHERE owner_user_id = ? AND id = ? LIMIT 1`
      )
      .get(ownerUserId, id) as DeviceSqlRow | undefined) ?? null
  );
}

function relationshipRow(
  ownerUserId: string,
  id: string
): RelationshipSqlRow | null {
  return (
    (getDatabase()
      .prepare(
        `SELECT id, owner_user_id, local_principal_id, remote_principal_id,
                local_person_id, status, negotiated_protocol_version,
                verification_phrase_hash, transport_privacy_mode,
                highest_received_sequence, highest_sent_sequence,
                established_at, revoked_at
         FROM peer_relationships
         WHERE owner_user_id = ? AND id = ? LIMIT 1`
      )
      .get(ownerUserId, id) as RelationshipSqlRow | undefined) ?? null
  );
}

function assertPrincipalExact(input: {
  row: PrincipalSqlRow;
  ownerUserId: string;
  kind: "local" | "remote";
  principal: PeerPairingPrincipal;
  personId: string | null;
}) {
  const exact =
    input.row.owner_user_id === input.ownerUserId &&
    input.row.id === input.principal.id &&
    input.row.public_principal_id === input.principal.id &&
    input.row.principal_kind === input.kind &&
    input.row.root_public_key === input.principal.rootPublicKey &&
    input.row.local_person_id === input.personId &&
    input.row.trust_state === "verified" &&
    input.row.minimum_protocol_version === 1 &&
    input.row.maximum_protocol_version === 1 &&
    input.row.revoked_at === null &&
    (input.kind === "remote"
      ? input.row.root_key_secret_id === null
      : input.row.root_key_secret_id !== null);
  if (!exact) {
    throw new PeerPairingPersistenceError(
      "conflict",
      "A Forge principal conflicts with the authenticated pairing identity."
    );
  }
}

function assertDeviceExact(input: {
  row: DeviceSqlRow;
  ownerUserId: string;
  principalId: string;
  device: PeerPairingDevice;
  local: boolean;
}) {
  const exact =
    input.row.owner_user_id === input.ownerUserId &&
    input.row.principal_id === input.principalId &&
    input.row.certified_public_key === input.device.signingPublicKey &&
    input.row.key_agreement_public_key === input.device.keyAgreementPublicKey &&
    input.row.certificate === input.device.certificate &&
    input.row.certificate_serial === input.device.certificateSerial &&
    input.row.certificate_hash === input.device.certificateHash &&
    input.row.status === "approved" &&
    input.row.revoked_at === null &&
    input.row.transport_endpoints_json ===
      canonicalJson(input.device.transportEndpoints) &&
    input.row.capabilities_json === canonicalJson(input.device.capabilities) &&
    (input.local
      ? input.row.private_key_secret_id !== null
      : input.row.private_key_secret_id === null);
  if (!exact) {
    throw new PeerPairingPersistenceError(
      "conflict",
      "A Forge device conflicts with the authenticated pairing certificate."
    );
  }
}

function assertAuthenticatedProvenance(input: {
  provenance: PeerAuthenticatedProvenance;
  ownerUserId: string;
  relationshipId: string | null;
  localPrincipalId: string;
  localDeviceId: string;
  remotePrincipalId: string | null;
  remoteDeviceId: string | null;
  expectedEvidenceHash: string;
  now: Date;
  requireFresh?: boolean;
}) {
  const authenticatedAt = Date.parse(input.provenance.authenticatedAt);
  const skew = Math.abs(input.now.getTime() - authenticatedAt);
  const exact =
    input.provenance.protocolVersion === PEER_PROTOCOL_VERSION &&
    input.provenance.ownerUserId === input.ownerUserId &&
    input.provenance.relationshipId === input.relationshipId &&
    input.provenance.localPrincipalId === input.localPrincipalId &&
    input.provenance.localDeviceId === input.localDeviceId &&
    input.provenance.remotePrincipalId === input.remotePrincipalId &&
    input.provenance.remoteDeviceId === input.remoteDeviceId &&
    exactHash(input.provenance.evidenceHash, input.expectedEvidenceHash) &&
    Number.isFinite(authenticatedAt) &&
    (input.requireFresh === false || skew <= 5 * 60_000);
  if (!exact) {
    throw new PeerPairingPersistenceError(
      "invalid",
      "Peer pairing provenance is stale or does not exactly match the authenticated evidence."
    );
  }
}

function insertPrincipal(input: {
  ownerUserId: string;
  kind: "local" | "remote";
  principal: PeerPairingPrincipal;
  personId: string | null;
  displayLabel: string;
  secretHandle: string | null;
  now: string;
}) {
  getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO forge_principals (
         id, owner_user_id, principal_kind, public_principal_id,
         root_public_key, root_key_secret_id, display_label, local_person_id,
         trust_state, minimum_protocol_version, maximum_protocol_version,
         first_verified_at, last_verified_at, revoked_at, metadata_json,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'verified', 1, 1, ?, ?, NULL, ?, ?, ?)`
    )
    .run(
      input.principal.id,
      input.ownerUserId,
      input.kind,
      input.principal.id,
      input.principal.rootPublicKey,
      input.secretHandle,
      input.displayLabel,
      input.personId,
      input.now,
      input.now,
      canonicalJson({
        managedBy: "forge-peer",
        protocolVersion: PEER_PROTOCOL_VERSION
      }),
      input.now,
      input.now
    );
  const row = principalRow(input.ownerUserId, input.principal.id);
  if (!row) {
    throw new PeerPairingPersistenceError(
      "conflict",
      "The Forge principal could not be persisted."
    );
  }
  assertPrincipalExact({
    row,
    ownerUserId: input.ownerUserId,
    kind: input.kind,
    principal: input.principal,
    personId: input.personId
  });
}

function insertDevice(input: {
  ownerUserId: string;
  principalId: string;
  device: PeerPairingDevice;
  local: boolean;
  secretHandle: string | null;
  label: string;
  now: string;
}) {
  getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO forge_devices (
         id, owner_user_id, principal_id, certified_public_key,
         key_agreement_public_key, private_key_secret_id, certificate,
         certificate_serial, certificate_hash, label, device_type, status,
         transport_endpoints_json, capabilities_json, added_at, last_seen_at,
         revoked_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'forge_peer', 'approved',
                 ?, ?, ?, NULL, NULL, ?, ?)`
    )
    .run(
      input.device.id,
      input.ownerUserId,
      input.principalId,
      input.device.signingPublicKey,
      input.device.keyAgreementPublicKey,
      input.secretHandle,
      input.device.certificate,
      input.device.certificateSerial,
      input.device.certificateHash,
      input.label,
      canonicalJson(input.device.transportEndpoints),
      canonicalJson(input.device.capabilities),
      input.now,
      input.now,
      input.now
    );
  const row = deviceRow(input.ownerUserId, input.device.id);
  if (!row) {
    throw new PeerPairingPersistenceError(
      "conflict",
      "The Forge device could not be persisted."
    );
  }
  assertDeviceExact({
    row,
    ownerUserId: input.ownerUserId,
    principalId: input.principalId,
    device: input.device,
    local: input.local
  });
}

export function persistLocalPeerIdentity(input: {
  ownerUserId: string;
  identity: PeerLocalIdentity;
  now?: Date;
}): { principalId: string; deviceId: string } {
  const now = input.now ?? new Date();
  const at = timestamp(now);
  assertAuthenticatedProvenance({
    provenance: input.identity.provenance,
    ownerUserId: input.ownerUserId,
    relationshipId: null,
    localPrincipalId: input.identity.principal.id,
    localDeviceId: input.identity.device.id,
    remotePrincipalId: null,
    remoteDeviceId: null,
    expectedEvidenceHash: expectedAuthenticatedEvidenceHash({
      ownerUserId: input.ownerUserId,
      localCertificateHash: input.identity.device.certificateHash,
      relationshipId: null,
      remoteCertificateHash: null
    }),
    now
  });
  if (
    input.identity.device.principalId !== input.identity.principal.id ||
    input.identity.device.certificateHash !==
      input.identity.principal.certificateHash
  ) {
    throw new PeerPairingPersistenceError(
      "invalid",
      "The local Forge device is not bound to its principal."
    );
  }
  return runInTransaction(() => {
    insertPrincipal({
      ownerUserId: input.ownerUserId,
      kind: "local",
      principal: input.identity.principal,
      personId: null,
      displayLabel: "Local Forge",
      secretHandle: `forge-peer:principal:${input.identity.principal.id}`,
      now: at
    });
    insertDevice({
      ownerUserId: input.ownerUserId,
      principalId: input.identity.principal.id,
      device: input.identity.device,
      local: true,
      secretHandle: `forge-peer:device:${input.identity.device.id}`,
      label: "Forge peer daemon",
      now: at
    });
    return {
      principalId: input.identity.principal.id,
      deviceId: input.identity.device.id
    };
  });
}

function resolvePerson(input: {
  ownerUserId: string;
  pairingId: string;
  personId: string | null;
  createPersonDisplayName: string | null;
  now: Date;
}): { id: string; displayName: string } | null {
  if (input.personId !== null && input.createPersonDisplayName !== null) {
    throw new PeerPairingPersistenceError(
      "invalid",
      "A pairing cannot select and create a Person at the same time."
    );
  }
  if (input.personId !== null) {
    const person = getPersonById(input.personId, input.ownerUserId);
    if (!person) {
      throw new PeerPairingPersistenceError(
        "not_found",
        "The selected Person is unavailable for this owner."
      );
    }
    return { id: person.id, displayName: person.displayName };
  }
  if (input.createPersonDisplayName === null) return null;
  const id = deterministicId("person_peer", input.ownerUserId, input.pairingId);
  const existing = getPersonById(id, input.ownerUserId);
  if (existing) {
    if (existing.displayName !== input.createPersonDisplayName) {
      throw new PeerPairingPersistenceError(
        "conflict",
        "The deterministic pairing Person already has different content."
      );
    }
    return { id: existing.id, displayName: existing.displayName };
  }
  const person = createPerson(
    {
      userId: input.ownerUserId,
      displayName: input.createPersonDisplayName,
      metadata: { createdFrom: "peer_pairing" }
    },
    { id, now: input.now }
  );
  return { id: person.id, displayName: person.displayName };
}

function assertRelationshipDevice(input: {
  ownerUserId: string;
  relationshipId: string;
  deviceId: string;
  role: "local" | "remote";
  approvedAt: string;
}) {
  const row = getDatabase()
    .prepare(
      `SELECT owner_user_id AS ownerUserId, principal_role AS role,
              status, approved_at AS approvedAt, removed_at AS removedAt
       FROM peer_relationship_devices
       WHERE owner_user_id = ? AND relationship_id = ? AND device_id = ?
       LIMIT 1`
    )
    .get(input.ownerUserId, input.relationshipId, input.deviceId) as
    | {
        ownerUserId: string;
        role: string;
        status: string;
        approvedAt: string | null;
        removedAt: string | null;
      }
    | undefined;
  if (
    !row ||
    row.ownerUserId !== input.ownerUserId ||
    row.role !== input.role ||
    row.status !== "approved" ||
    row.approvedAt !== input.approvedAt ||
    row.removedAt !== null
  ) {
    throw new PeerPairingPersistenceError(
      "conflict",
      "A relationship device conflicts with the authenticated pairing role."
    );
  }
}

function insertRelationshipDevice(input: {
  ownerUserId: string;
  relationshipId: string;
  deviceId: string;
  role: "local" | "remote";
  now: string;
}) {
  getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO peer_relationship_devices (
         relationship_id, owner_user_id, device_id, principal_role, status,
         approved_at, removed_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'approved', ?, NULL, ?, ?)`
    )
    .run(
      input.relationshipId,
      input.ownerUserId,
      input.deviceId,
      input.role,
      input.now,
      input.now,
      input.now
    );
  assertRelationshipDevice({
    ownerUserId: input.ownerUserId,
    relationshipId: input.relationshipId,
    deviceId: input.deviceId,
    role: input.role,
    approvedAt: input.now
  });
}

type PairingAuditInput = {
  ownerUserId: string;
  relationshipId: string;
  localDeviceId: string;
  remoteDeviceId: string;
  remotePrincipalId: string;
  pairingId: string;
  transcriptHash: string;
  stateBinding: string;
  pendingPayloadHash: string;
  applicationHash: string;
  actorClass: PeerActorClass;
  actorId: string;
  provenance: PeerAuthenticatedProvenance;
  expectedCreatedAt: string;
};

function pairingAuditValues(input: PairingAuditInput) {
  const id = deterministicId(
    "pae_pairing",
    input.ownerUserId,
    input.pairingId,
    input.relationshipId
  );
  const metadataJson = canonicalJson({
    pairingId: input.pairingId,
    pendingPayloadHash: input.pendingPayloadHash,
    remoteDeviceId: input.remoteDeviceId,
    remotePrincipalId: input.remotePrincipalId,
    stateBinding: input.stateBinding,
    transcriptHash: input.transcriptHash
  });
  const evidenceJson = canonicalJson({
    applicationHash: input.applicationHash,
    authenticatedAt: input.provenance.authenticatedAt,
    evidenceHash: input.provenance.evidenceHash,
    protocolVersion: input.provenance.protocolVersion
  });
  return { id, metadataJson, evidenceJson };
}

function assertPairingAudit(input: PairingAuditInput) {
  const { id, metadataJson, evidenceJson } = pairingAuditValues(input);
  const row = getDatabase()
    .prepare(
      `SELECT owner_user_id AS ownerUserId, relationship_id AS relationshipId,
              event_type AS eventType, actor_class AS actorClass,
              actor_id AS actorId, device_id AS deviceId,
              metadata_json AS metadataJson, evidence_json AS evidenceJson,
              created_at AS createdAt
       FROM peer_audit_events
       WHERE owner_user_id = ? AND id = ? LIMIT 1`
    )
    .get(input.ownerUserId, id) as
    | {
        ownerUserId: string;
        relationshipId: string | null;
        eventType: string;
        actorClass: string;
        actorId: string;
        deviceId: string | null;
        metadataJson: string;
        evidenceJson: string;
        createdAt: string;
      }
    | undefined;
  if (
    !row ||
    row.ownerUserId !== input.ownerUserId ||
    row.relationshipId !== input.relationshipId ||
    row.eventType !== "pairing_confirmed" ||
    row.actorClass !== input.actorClass ||
    row.actorId !== input.actorId ||
    row.deviceId !== input.localDeviceId ||
    row.metadataJson !== metadataJson ||
    row.evidenceJson !== evidenceJson ||
    row.createdAt !== input.expectedCreatedAt
  ) {
    throw new PeerPairingPersistenceError(
      "conflict",
      "The pairing audit record conflicts with an earlier application."
    );
  }
}

function insertPairingAudit(input: PairingAuditInput) {
  const { id, metadataJson, evidenceJson } = pairingAuditValues(input);
  getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO peer_audit_events (
         id, owner_user_id, relationship_id, event_type, actor_class,
         actor_id, device_id, outcome, metadata_json, evidence_json, created_at
       ) VALUES (?, ?, ?, 'pairing_confirmed', ?, ?, ?, 'recorded', ?, ?, ?)`
    )
    .run(
      id,
      input.ownerUserId,
      input.relationshipId,
      input.actorClass,
      input.actorId,
      input.localDeviceId,
      metadataJson,
      evidenceJson,
      input.expectedCreatedAt
    );
  assertPairingAudit(input);
}

function expectedPairingPersonId(input: {
  ownerUserId: string;
  pairingId: string;
  personId: string | null;
  createPersonDisplayName: string | null;
}): string | null {
  if (input.personId !== null && input.createPersonDisplayName !== null) {
    throw new PeerPairingPersistenceError(
      "invalid",
      "A pairing cannot select and create a Person at the same time."
    );
  }
  if (input.personId !== null) return input.personId;
  return input.createPersonDisplayName === null
    ? null
    : deterministicId("person_peer", input.ownerUserId, input.pairingId);
}

function assertRelationshipExact(input: {
  row: RelationshipSqlRow | null;
  ownerUserId: string;
  relationship: PeerPairingConfirmation["relationship"];
  personId: string | null;
  establishedAt: string;
}) {
  const exact =
    input.row !== null &&
    input.row.owner_user_id === input.ownerUserId &&
    input.row.local_principal_id === input.relationship.localPrincipal.id &&
    input.row.remote_principal_id === input.relationship.remotePrincipal.id &&
    input.row.local_person_id === input.personId &&
    input.row.status === "active" &&
    input.row.negotiated_protocol_version ===
      input.relationship.negotiatedProtocolVersion &&
    exactHash(
      input.row.verification_phrase_hash,
      input.relationship.verificationPhraseHash
    ) &&
    input.row.transport_privacy_mode === input.relationship.privacyMode &&
    input.row.highest_received_sequence === 0 &&
    input.row.highest_sent_sequence === 0 &&
    input.row.established_at === input.establishedAt &&
    input.row.revoked_at === null;
  if (!exact) {
    throw new PeerPairingPersistenceError(
      "conflict",
      "The peer relationship conflicts with an existing relationship."
    );
  }
}

function assertPairingOutbox(input: {
  ownerUserId: string;
  pairingId: string;
  relationshipId: string;
  remoteDeviceId: string;
  outboundEnvelope: Uint8Array;
  envelopeHash: string;
  expiresAt: string;
}) {
  const envelopeId = deterministicId(
    "pairing_acceptance",
    input.ownerUserId,
    input.pairingId,
    input.relationshipId
  );
  const row = getDatabase()
    .prepare(
      `SELECT owner_user_id AS ownerUserId,
              relationship_id AS relationshipId,
              recipient_device_id AS recipientDeviceId,
              channel_id AS channelId, sequence,
              previous_acknowledgement AS previousAcknowledgement,
              message_kind AS messageKind, mls_epoch AS mlsEpoch,
              ciphertext, ciphertext_hash AS ciphertextHash,
              expires_at AS expiresAt
       FROM peer_outbox
       WHERE owner_user_id = ? AND envelope_id = ? LIMIT 1`
    )
    .get(input.ownerUserId, envelopeId) as
    | {
        ownerUserId: string;
        relationshipId: string;
        recipientDeviceId: string;
        channelId: string;
        sequence: number;
        previousAcknowledgement: number;
        messageKind: string;
        mlsEpoch: number;
        ciphertext: Uint8Array;
        ciphertextHash: string;
        expiresAt: string;
      }
    | undefined;
  const expectedChannelId = deterministicId(
    "pairing_channel",
    input.ownerUserId,
    input.pairingId
  );
  if (
    !row ||
    row.ownerUserId !== input.ownerUserId ||
    row.relationshipId !== input.relationshipId ||
    row.recipientDeviceId !== input.remoteDeviceId ||
    row.channelId !== expectedChannelId ||
    row.sequence !== 1 ||
    row.previousAcknowledgement !== 0 ||
    row.messageKind !== "pairing_acceptance" ||
    row.mlsEpoch !== 0 ||
    !Buffer.from(row.ciphertext).equals(Buffer.from(input.outboundEnvelope)) ||
    !exactHash(row.ciphertextHash, input.envelopeHash) ||
    row.expiresAt !== input.expiresAt
  ) {
    throw new PeerPairingPersistenceError(
      "conflict",
      "The pairing acceptance envelope conflicts with the durable result."
    );
  }
}

function assertReplayPerson(input: {
  ownerUserId: string;
  expectedPersonId: string | null;
  createPersonDisplayName: string | null;
}) {
  if (input.expectedPersonId === null) return;
  const person = getPersonById(input.expectedPersonId, input.ownerUserId);
  if (
    !person ||
    (input.createPersonDisplayName !== null &&
      person.displayName !== input.createPersonDisplayName)
  ) {
    throw new PeerPairingPersistenceError(
      "conflict",
      "The accepted pairing Person conflicts with the durable result."
    );
  }
}

export type PersistPeerPairingConfirmationInput = {
  ownerUserId: string;
  pairingId: string;
  expectedPendingVersion: number;
  confirmation: PeerPairingConfirmation;
  personId: string | null;
  createPersonDisplayName: string | null;
  actorClass: PeerActorClass;
  actorId: string;
  now: Date;
  afterStep?: (step: PeerPairingPersistenceStep) => void;
};

function persistPeerPairingConfirmationInTransaction(
  input: PersistPeerPairingConfirmationInput
): { relationshipId: string; personId: string | null } {
  const at = timestamp(input.now);
  const relationship = input.confirmation.relationship;
  const actorClass = peerActorClassSchema.parse(input.actorClass);
  if (
    !Number.isSafeInteger(input.expectedPendingVersion) ||
    input.expectedPendingVersion < 1
  ) {
    throw new PeerPairingPersistenceError(
      "invalid",
      "The expected pending pairing version is invalid."
    );
  }
  const pending = getDatabase()
    .prepare(
      `SELECT request_kind, status, version, payload_json, payload_hash,
              expires_at, decided_at, decision_reason, updated_at
       FROM peer_pending_requests
       WHERE id = ? AND owner_user_id = ? LIMIT 1`
    )
    .get(input.pairingId, input.ownerUserId) as
    | PendingPairingSqlRow
    | undefined;
  if (!pending || pending.request_kind !== "pairing") {
    throw new PeerPairingPersistenceError(
      "conflict",
      "The pending pairing is missing, expired, or changed."
    );
  }
  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(pending.payload_json);
  } catch {
    throw new PeerPairingPersistenceError(
      "invalid",
      "The pending pairing payload is malformed."
    );
  }
  if (hashPeerApiValue(rawPayload) !== pending.payload_hash) {
    throw new PeerPairingPersistenceError(
      "invalid",
      "The pending pairing payload hash does not match."
    );
  }
  const request = pairingRequestPayloadSchema.safeParse(rawPayload);
  if (!request.success) {
    throw new PeerPairingPersistenceError(
      "invalid",
      "The pending pairing payload does not match the peer protocol."
    );
  }
  const requestPayload = request.data;
  assertPairingProtocolBindings({
    ownerUserId: input.ownerUserId,
    pairingId: input.pairingId,
    request: requestPayload,
    confirmation: input.confirmation,
    now: input.now,
    requireFresh: pending.status !== "accepted"
  });
  if (
    input.confirmation.outboundEnvelope === null ||
    input.confirmation.outboundEnvelope.byteLength === 0
  ) {
    throw new PeerPairingPersistenceError(
      "invalid",
      "The confirmed pairing is missing its encrypted acceptance envelope."
    );
  }
  const outboundEnvelope = input.confirmation.outboundEnvelope;
  const envelopeHash = createHash("sha256")
    .update(outboundEnvelope)
    .digest("hex");
  const expectedPersonId = expectedPairingPersonId({
    ownerUserId: input.ownerUserId,
    pairingId: input.pairingId,
    personId: input.personId,
    createPersonDisplayName: input.createPersonDisplayName
  });
  const applicationHash = pairingApplicationHash({
    ownerUserId: input.ownerUserId,
    pairingId: input.pairingId,
    expectedPendingVersion: input.expectedPendingVersion,
    pendingPayloadHash: pending.payload_hash,
    confirmation: input.confirmation,
    personId: input.personId,
    createPersonDisplayName: input.createPersonDisplayName,
    actorClass,
    actorId: input.actorId,
    envelopeHash
  });
  const localPrincipal = principalRow(
    input.ownerUserId,
    relationship.localPrincipal.id
  );
  if (!localPrincipal) {
    throw new PeerPairingPersistenceError(
      "not_found",
      "The approved local Forge principal is unavailable."
    );
  }
  assertPrincipalExact({
    row: localPrincipal,
    ownerUserId: input.ownerUserId,
    kind: "local",
    principal: relationship.localPrincipal,
    personId: null
  });
  const localDevice = deviceRow(input.ownerUserId, relationship.localDevice.id);
  if (!localDevice) {
    throw new PeerPairingPersistenceError(
      "not_found",
      "The approved local Forge device is unavailable."
    );
  }
  assertDeviceExact({
    row: localDevice,
    ownerUserId: input.ownerUserId,
    principalId: relationship.localPrincipal.id,
    device: relationship.localDevice,
    local: true
  });

  if (pending.status === "accepted") {
    if (
      pending.version !== input.expectedPendingVersion + 1 ||
      pending.decided_at === null ||
      !Number.isFinite(Date.parse(pending.decided_at)) ||
      pending.decision_reason !== "pairing_confirmed" ||
      pending.updated_at !== pending.decided_at
    ) {
      throw new PeerPairingPersistenceError(
        "conflict",
        "The accepted pairing decision does not match the durable confirmation."
      );
    }
    const decidedAt = pending.decided_at;
    assertReplayPerson({
      ownerUserId: input.ownerUserId,
      expectedPersonId,
      createPersonDisplayName: input.createPersonDisplayName
    });
    const remotePrincipal = principalRow(
      input.ownerUserId,
      relationship.remotePrincipal.id
    );
    if (!remotePrincipal) {
      throw new PeerPairingPersistenceError(
        "conflict",
        "The accepted pairing is missing its durable remote principal."
      );
    }
    assertPrincipalExact({
      row: remotePrincipal,
      ownerUserId: input.ownerUserId,
      kind: "remote",
      principal: relationship.remotePrincipal,
      personId: expectedPersonId
    });
    const remoteDevice = deviceRow(
      input.ownerUserId,
      relationship.remoteDevice.id
    );
    if (!remoteDevice) {
      throw new PeerPairingPersistenceError(
        "conflict",
        "The accepted pairing is missing its durable remote device."
      );
    }
    assertDeviceExact({
      row: remoteDevice,
      ownerUserId: input.ownerUserId,
      principalId: relationship.remotePrincipal.id,
      device: relationship.remoteDevice,
      local: false
    });
    assertRelationshipExact({
      row: relationshipRow(input.ownerUserId, relationship.id),
      ownerUserId: input.ownerUserId,
      relationship,
      personId: expectedPersonId,
      establishedAt: decidedAt
    });
    assertRelationshipDevice({
      ownerUserId: input.ownerUserId,
      relationshipId: relationship.id,
      deviceId: relationship.localDevice.id,
      role: "local",
      approvedAt: decidedAt
    });
    assertRelationshipDevice({
      ownerUserId: input.ownerUserId,
      relationshipId: relationship.id,
      deviceId: relationship.remoteDevice.id,
      role: "remote",
      approvedAt: decidedAt
    });
    assertPairingOutbox({
      ownerUserId: input.ownerUserId,
      pairingId: input.pairingId,
      relationshipId: relationship.id,
      remoteDeviceId: relationship.remoteDevice.id,
      outboundEnvelope,
      envelopeHash,
      expiresAt: pending.expires_at
    });
    assertPairingAudit({
      ownerUserId: input.ownerUserId,
      relationshipId: relationship.id,
      localDeviceId: relationship.localDevice.id,
      remoteDeviceId: relationship.remoteDevice.id,
      remotePrincipalId: relationship.remotePrincipal.id,
      pairingId: input.pairingId,
      transcriptHash: requestPayload.transcriptHash,
      stateBinding: requestPayload.stateBinding,
      pendingPayloadHash: pending.payload_hash,
      applicationHash,
      actorClass,
      actorId: input.actorId,
      provenance: input.confirmation.provenance,
      expectedCreatedAt: decidedAt
    });
    return { relationshipId: relationship.id, personId: expectedPersonId };
  }

  if (
    pending.status !== "pending" ||
    pending.version !== input.expectedPendingVersion ||
    Date.parse(pending.expires_at) <= input.now.getTime()
  ) {
    throw new PeerPairingPersistenceError(
      "conflict",
      "The pending pairing is missing, expired, or changed."
    );
  }
  const accepted = getDatabase()
    .prepare(
      `UPDATE peer_pending_requests
       SET status = 'accepted', version = version + 1, decided_at = ?,
           decision_reason = 'pairing_confirmed', updated_at = ?
       WHERE id = ? AND owner_user_id = ? AND request_kind = 'pairing'
         AND status = 'pending' AND version = ? AND expires_at > ?`
    )
    .run(
      at,
      at,
      input.pairingId,
      input.ownerUserId,
      input.expectedPendingVersion,
      at
    );
  if (accepted.changes !== 1) {
    throw new PeerPairingPersistenceError(
      "conflict",
      "The pending pairing changed before confirmation committed."
    );
  }
  input.afterStep?.("pending_request");

  const selectedPerson = resolvePerson({
    ownerUserId: input.ownerUserId,
    pairingId: input.pairingId,
    personId: input.personId,
    createPersonDisplayName: input.createPersonDisplayName,
    now: input.now
  });
  input.afterStep?.("person");

  insertPrincipal({
    ownerUserId: input.ownerUserId,
    kind: "remote",
    principal: relationship.remotePrincipal,
    personId: selectedPerson?.id ?? null,
    displayLabel: selectedPerson?.displayName ?? "Paired Forge",
    secretHandle: null,
    now: at
  });
  input.afterStep?.("remote_principal");

  insertDevice({
    ownerUserId: input.ownerUserId,
    principalId: relationship.remotePrincipal.id,
    device: relationship.remoteDevice,
    local: false,
    secretHandle: null,
    label: selectedPerson?.displayName ?? "Paired Forge device",
    now: at
  });
  input.afterStep?.("remote_device");

  getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO peer_relationships (
         id, owner_user_id, local_principal_id, remote_principal_id,
         local_person_id, status, negotiated_protocol_version,
         verification_phrase_hash, transport_privacy_mode,
         highest_received_sequence, highest_sent_sequence, established_at,
         last_connected_at, revoked_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 0, 0, ?, NULL, NULL, ?, ?)`
    )
    .run(
      relationship.id,
      input.ownerUserId,
      relationship.localPrincipal.id,
      relationship.remotePrincipal.id,
      selectedPerson?.id ?? null,
      relationship.negotiatedProtocolVersion,
      relationship.verificationPhraseHash,
      relationship.privacyMode,
      at,
      at,
      at
    );
  assertRelationshipExact({
    row: relationshipRow(input.ownerUserId, relationship.id),
    ownerUserId: input.ownerUserId,
    relationship,
    personId: selectedPerson?.id ?? null,
    establishedAt: at
  });
  input.afterStep?.("relationship");

  insertRelationshipDevice({
    ownerUserId: input.ownerUserId,
    relationshipId: relationship.id,
    deviceId: relationship.localDevice.id,
    role: "local",
    now: at
  });
  input.afterStep?.("local_membership");
  insertRelationshipDevice({
    ownerUserId: input.ownerUserId,
    relationshipId: relationship.id,
    deviceId: relationship.remoteDevice.id,
    role: "remote",
    now: at
  });
  input.afterStep?.("remote_membership");

  enqueuePeerOutboxEnvelope({
    envelopeId: deterministicId(
      "pairing_acceptance",
      input.ownerUserId,
      input.pairingId,
      relationship.id
    ),
    ownerUserId: input.ownerUserId,
    relationshipId: relationship.id,
    recipientDeviceId: relationship.remoteDevice.id,
    channelId: deterministicId(
      "pairing_channel",
      input.ownerUserId,
      input.pairingId
    ),
    sequence: 1,
    previousAcknowledgement: 0,
    messageKind: "pairing_acceptance",
    mlsEpoch: 0,
    ciphertext: outboundEnvelope,
    ciphertextHash: envelopeHash,
    expiresAt: new Date(pending.expires_at),
    now: input.now
  });
  assertPairingOutbox({
    ownerUserId: input.ownerUserId,
    pairingId: input.pairingId,
    relationshipId: relationship.id,
    remoteDeviceId: relationship.remoteDevice.id,
    outboundEnvelope,
    envelopeHash,
    expiresAt: pending.expires_at
  });
  input.afterStep?.("outbox");

  insertPairingAudit({
    ownerUserId: input.ownerUserId,
    relationshipId: relationship.id,
    localDeviceId: relationship.localDevice.id,
    remoteDeviceId: relationship.remoteDevice.id,
    remotePrincipalId: relationship.remotePrincipal.id,
    pairingId: input.pairingId,
    transcriptHash: requestPayload.transcriptHash,
    stateBinding: requestPayload.stateBinding,
    pendingPayloadHash: pending.payload_hash,
    applicationHash,
    actorClass,
    actorId: input.actorId,
    provenance: input.confirmation.provenance,
    expectedCreatedAt: at
  });
  input.afterStep?.("audit");
  return {
    relationshipId: relationship.id,
    personId: selectedPerson?.id ?? null
  };
}

export function persistPeerPairingConfirmation(
  input: PersistPeerPairingConfirmationInput
): { relationshipId: string; personId: string | null } {
  return runInTransaction(() =>
    persistPeerPairingConfirmationInTransaction(input)
  );
}
