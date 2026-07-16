import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
  verify,
  type KeyObject
} from "node:crypto";
import { open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { SecretsManager } from "../managers/platform/secrets-manager.js";

export const PEER_COMMAND_AUTHORIZATION_PROTOCOL =
  "forge-peer-command-authorization/v1" as const;
export const PEER_COMMAND_AUTHORITY_STATE_PROTOCOL =
  "forge-peer-command-authority-state/v1" as const;
export const PEER_COMMAND_AUTHORITY_STATE_FILE =
  "command-authorization-state.json" as const;

const AUTHORIZATION_DOMAIN = Buffer.from(
  "forge-peer/node-command-authorization/v1\0",
  "utf8"
);
const AUTHORITY_STATE_DOMAIN = Buffer.from(
  "forge-peer/node-command-authority-state/v1\0",
  "utf8"
);
const AUTHORITY_KEY_ID_DOMAIN = Buffer.from(
  "forge-peer/node-command-authority-key-id/v1\0",
  "utf8"
);
const COMMAND_ACTION_DOMAIN = Buffer.from(
  "forge-peer/node-command-action/v1\0",
  "utf8"
);
const QUERY_WORKER_CAPABILITY_ID_DOMAIN = Buffer.from(
  "forge-peer/node-query-worker-capability-id/v1\0",
  "utf8"
);
const QUERY_WORKER_SESSION_ID_DOMAIN = Buffer.from(
  "forge-peer/node-query-worker-session-id/v1\0",
  "utf8"
);
const REVOCATION_CONSUMER_CAPABILITY_ID_DOMAIN = Buffer.from(
  "forge-peer/node-revocation-consumer-capability-id/v1\0",
  "utf8"
);
const REVOCATION_CONSUMER_SESSION_ID_DOMAIN = Buffer.from(
  "forge-peer/node-revocation-consumer-session-id/v1\0",
  "utf8"
);
const ED25519_PKCS8_SEED_PREFIX = Buffer.from(
  "302e020100300506032b657004220420",
  "hex"
);
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
const BLAKE3_PARENT = 4;
const BLAKE3_ROOT = 8;
const BLAKE3_BLOCK_BYTES = 64;
const BLAKE3_CHUNK_BYTES = 1_024;

type Blake3Output = {
  inputChainingValue: Uint32Array;
  blockWords: Uint32Array;
  counter: number;
  blockLength: number;
  flags: number;
};

const identifierSchema = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9._:-]+$/);
const base64Url32Schema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const base64Url64Schema = z.string().regex(/^[A-Za-z0-9_-]{86}$/);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const timestampSchema = z.string().datetime({ offset: true });

export const peerCommandApprovalBindingSchema = z
  .object({
    actorClass: z.enum(["operator_session", "companion_consent"]),
    actorId: identifierSchema,
    sessionId: identifierSchema,
    deviceId: identifierSchema.nullable(),
    capabilityId: identifierSchema,
    actionDigest: hashSchema,
    capabilityIssuedAt: timestampSchema,
    capabilityExpiresAt: timestampSchema,
    authorizationIssuedAt: timestampSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (value.actorClass === "companion_consent" && value.deviceId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Companion command approval requires its exact device.",
        path: ["deviceId"]
      });
    }
    const issued = Date.parse(value.capabilityIssuedAt);
    const authorized = Date.parse(value.authorizationIssuedAt);
    const expires = Date.parse(value.capabilityExpiresAt);
    if (issued > authorized || authorized > expires) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Command approval timestamps are outside the capability window."
      });
    }
  });

export type PeerCommandApprovalBinding = z.infer<
  typeof peerCommandApprovalBindingSchema
>;

const peerCommandAuthorizationBaseSchema = z
  .object({
    protocol: z.literal(PEER_COMMAND_AUTHORIZATION_PROTOCOL),
    authorityKeyId: base64Url32Schema,
    authorizationId: identifierSchema,
    ownerUserId: identifierSchema,
    action: z.string().regex(/^[a-z_]{1,64}$/),
    commandId: identifierSchema,
    commandDigest: hashSchema,
    approvalDeadline: timestampSchema,
    issuedAt: timestampSchema,
    invalidationEpoch: z.string().regex(/^(0|[1-9][0-9]*)$/),
    signature: base64Url64Schema
  })
  .strict();

const humanCommandAuthorizationSchema = peerCommandAuthorizationBaseSchema
  .extend({
    actor: z
      .object({
        class: z.enum(["operator_session", "companion_consent"]),
        actorId: identifierSchema,
        sessionId: identifierSchema,
        deviceId: identifierSchema.nullable()
      })
      .strict(),
    capability: z
      .object({
        kind: z.literal("human_approval"),
        capabilityId: identifierSchema,
        actionDigest: hashSchema,
        state: z.literal("consumed"),
        issuedAt: timestampSchema,
        expiresAt: timestampSchema
      })
      .strict()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.actor.class === "companion_consent" &&
      value.actor.deviceId === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Companion command authorization requires its exact device.",
        path: ["actor", "deviceId"]
      });
    }
  });

const queryWorkerCommandAuthorizationSchema = peerCommandAuthorizationBaseSchema
  .extend({
    actor: z
      .object({
        class: z.literal("service_worker"),
        actorId: identifierSchema,
        sessionId: identifierSchema,
        deviceId: z.null()
      })
      .strict(),
    capability: z
      .object({
        kind: z.literal("query_worker"),
        capabilityId: identifierSchema,
        actionDigest: hashSchema,
        state: z.literal("active"),
        issuedAt: timestampSchema,
        expiresAt: timestampSchema
      })
      .strict()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.capability.actionDigest !== value.commandDigest) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Query-worker capability is not bound to the exact command body.",
        path: ["capability", "actionDigest"]
      });
    }
  });

const revocationConsumerCommandAuthorizationSchema =
  peerCommandAuthorizationBaseSchema
    .extend({
      actor: z
        .object({
          class: z.literal("service_worker"),
          actorId: identifierSchema,
          sessionId: identifierSchema,
          deviceId: z.null()
        })
        .strict(),
      capability: z
        .object({
          kind: z.literal("revocation_consumer"),
          capabilityId: identifierSchema,
          actionDigest: hashSchema,
          state: z.literal("active"),
          issuedAt: timestampSchema,
          expiresAt: timestampSchema
        })
        .strict()
    })
    .strict()
    .superRefine((value, context) => {
      if (value.capability.actionDigest !== value.commandDigest) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Revocation-consumer capability is not bound to the exact command body.",
          path: ["capability", "actionDigest"]
        });
      }
    });

export const peerCommandAuthorizationSchema = z.union([
  humanCommandAuthorizationSchema,
  queryWorkerCommandAuthorizationSchema,
  revocationConsumerCommandAuthorizationSchema
]);

export type PeerCommandAuthorization = z.infer<
  typeof peerCommandAuthorizationSchema
>;

const authorityStateSchema = z
  .object({
    protocol: z.literal(PEER_COMMAND_AUTHORITY_STATE_PROTOCOL),
    authorityKeyId: base64Url32Schema,
    ownerUserId: identifierSchema,
    epoch: z.string().regex(/^(0|[1-9][0-9]*)$/),
    invalidatedBefore: timestampSchema,
    revokedAuthorizationIds: z.array(identifierSchema).max(128),
    revokedSessionIds: z.array(identifierSchema).max(128),
    revokedDeviceIds: z.array(identifierSchema).max(128),
    signature: base64Url64Schema
  })
  .strict()
  .superRefine((value, context) => {
    for (const key of [
      "revokedAuthorizationIds",
      "revokedSessionIds",
      "revokedDeviceIds"
    ] as const) {
      const values = value[key];
      if (
        values.some((entry, index) => index > 0 && values[index - 1]! >= entry)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key} must be unique and sorted.`,
          path: [key]
        });
      }
    }
  });

export type PeerCommandAuthorityState = z.infer<typeof authorityStateSchema>;

export type PeerCommandAuthorizer = {
  readonly publicKeyBase64Url: string;
  readonly authorityKeyId: string;
  initialize(): Promise<PeerCommandAuthorityState>;
  authorize(input: {
    ownerUserId: string;
    action: string;
    commandId: string;
    commandDigest: string;
    approvalDeadline: string;
    approval: PeerCommandApprovalBinding;
  }): Promise<PeerCommandAuthorization>;
  authorizeQueryWorker?(input: {
    ownerUserId: string;
    workerId: string;
    action: "claim_inbound_query" | "respond_inbound_query";
    commandId: string;
    commandDigest: string;
    approvalDeadline: string;
    issuedAt: string;
  }): Promise<PeerCommandAuthorization>;
  authorizeRevocationConsumer?(input: {
    ownerUserId: string;
    consumerId: string;
    action: "ack_revocation_events";
    commandId: string;
    commandDigest: string;
    approvalDeadline: string;
    issuedAt: string;
  }): Promise<PeerCommandAuthorization>;
  invalidateAuthority?(input: {
    ownerUserId: string;
    invalidatedAt: string;
    revokedAuthorizationIds?: readonly string[];
    revokedSessionIds?: readonly string[];
    revokedDeviceIds?: readonly string[];
  }): Promise<PeerCommandAuthorityState>;
};

function canonicalize(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("Peer command documents require finite JSON numbers.");
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, nested]) => {
          if (nested === undefined) {
            throw new Error("Peer command documents cannot contain undefined.");
          }
          return [key, canonicalize(nested)];
        })
    );
  }
  throw new Error("Peer command documents must contain only JSON values.");
}

function rotateRight32(value: number, count: number) {
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
  counter: number,
  blockLength: number,
  flags: number
) {
  const state = new Uint32Array(16);
  state.set(chainingValue, 0);
  state.set(BLAKE3_IV.subarray(0, 4), 8);
  state[12] = counter >>> 0;
  state[13] = Math.floor(counter / 0x1_0000_0000) >>> 0;
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

function blake3BlockWords(block: Uint8Array) {
  const padded = Buffer.alloc(BLAKE3_BLOCK_BYTES);
  Buffer.from(block).copy(padded);
  return Uint32Array.from({ length: 16 }, (_, index) =>
    padded.readUInt32LE(index * 4)
  );
}

function blake3ChunkOutput(value: Uint8Array, counter: number): Blake3Output {
  if (value.byteLength > BLAKE3_CHUNK_BYTES) {
    throw new Error("A BLAKE3 chunk cannot exceed 1024 bytes.");
  }
  const blockCount = Math.max(
    1,
    Math.ceil(value.byteLength / BLAKE3_BLOCK_BYTES)
  );
  let chainingValue = BLAKE3_IV.slice();
  for (let index = 0; index < blockCount - 1; index += 1) {
    const block = value.subarray(
      index * BLAKE3_BLOCK_BYTES,
      (index + 1) * BLAKE3_BLOCK_BYTES
    );
    chainingValue = blake3Compress(
      chainingValue,
      blake3BlockWords(block),
      counter,
      BLAKE3_BLOCK_BYTES,
      index === 0 ? BLAKE3_CHUNK_START : 0
    ).slice(0, 8);
  }
  const finalBlock = value.subarray((blockCount - 1) * BLAKE3_BLOCK_BYTES);
  return {
    inputChainingValue: chainingValue,
    blockWords: blake3BlockWords(finalBlock),
    counter,
    blockLength: finalBlock.byteLength,
    flags: BLAKE3_CHUNK_END | (blockCount === 1 ? BLAKE3_CHUNK_START : 0)
  };
}

function blake3ChainingValue(output: Blake3Output) {
  return blake3Compress(
    output.inputChainingValue,
    output.blockWords,
    output.counter,
    output.blockLength,
    output.flags
  ).slice(0, 8);
}

function blake3ParentOutput(
  left: Uint32Array,
  right: Uint32Array
): Blake3Output {
  const blockWords = new Uint32Array(16);
  blockWords.set(left, 0);
  blockWords.set(right, 8);
  return {
    inputChainingValue: BLAKE3_IV,
    blockWords,
    counter: 0,
    blockLength: BLAKE3_BLOCK_BYTES,
    flags: BLAKE3_PARENT
  };
}

function blake3Hash(value: Uint8Array) {
  const chunkCount = Math.max(
    1,
    Math.ceil(value.byteLength / BLAKE3_CHUNK_BYTES)
  );
  const stack: Uint32Array[] = [];
  for (let index = 0; index < chunkCount - 1; index += 1) {
    const chunk = value.subarray(
      index * BLAKE3_CHUNK_BYTES,
      (index + 1) * BLAKE3_CHUNK_BYTES
    );
    let chainingValue = blake3ChainingValue(blake3ChunkOutput(chunk, index));
    let totalChunks = index + 1;
    while ((totalChunks & 1) === 0) {
      const left = stack.pop();
      if (!left) throw new Error("The BLAKE3 tree stack is inconsistent.");
      chainingValue = blake3ChainingValue(
        blake3ParentOutput(left, chainingValue)
      );
      totalChunks >>>= 1;
    }
    stack.push(chainingValue);
  }
  const finalOffset = (chunkCount - 1) * BLAKE3_CHUNK_BYTES;
  let output = blake3ChunkOutput(value.subarray(finalOffset), chunkCount - 1);
  while (stack.length > 0) {
    output = blake3ParentOutput(stack.pop()!, blake3ChainingValue(output));
  }
  const words = blake3Compress(
    output.inputChainingValue,
    output.blockWords,
    0,
    output.blockLength,
    output.flags | BLAKE3_ROOT
  );
  const digest = Buffer.alloc(32);
  for (let index = 0; index < 8; index += 1) {
    digest.writeUInt32LE(words[index]!, index * 4);
  }
  return digest;
}

function canonicalSigningBytes(
  value: Record<string, unknown>,
  domain: Buffer
): Buffer {
  const unsigned = { ...value };
  if (!("signature" in unsigned)) {
    throw new Error(
      "Signed peer command document is missing its signature field."
    );
  }
  delete unsigned.signature;
  return Buffer.concat([
    domain,
    Buffer.from(JSON.stringify(canonicalize(unsigned)), "utf8")
  ]);
}

export function peerCommandActionDigest(
  request: Record<string, unknown>
): string {
  const action = { ...request };
  if (!("requestId" in action)) {
    throw new Error("Peer command action is missing its request id.");
  }
  delete action.requestId;
  return createHash("sha256")
    .update(COMMAND_ACTION_DOMAIN)
    .update(JSON.stringify(canonicalize(action)), "utf8")
    .digest("hex");
}

export function peerCommandRequestHash(
  request: Record<string, unknown>
): string {
  const body = { ...request };
  if (!("requestId" in body) || !("commandId" in body)) {
    throw new Error(
      "Peer command request hashing requires its request and command ids."
    );
  }
  delete body.requestId;
  delete body.commandId;
  return blake3Hash(
    Buffer.from(JSON.stringify(canonicalize(body)), "utf8")
  ).toString("hex");
}

export function peerCommandAuthorityStateHash(
  state: PeerCommandAuthorityState | unknown
): string {
  const parsed = authorityStateSchema.parse(state);
  return createHash("sha256")
    .update(AUTHORITY_STATE_DOMAIN)
    .update(JSON.stringify(canonicalize(parsed)), "utf8")
    .digest("hex");
}

export function derivePeerCommandAuthorizationId(input: {
  commandId: string;
  capabilityId: string;
  actionDigest: string;
}): string {
  const commandId = identifierSchema.parse(input.commandId);
  const capabilityId = identifierSchema.parse(input.capabilityId);
  const actionDigest = hashSchema.parse(input.actionDigest);
  return `pca_${createHash("sha256")
    .update("forge-peer/node-authorization-id/v1\0", "utf8")
    .update(commandId, "utf8")
    .update("\0", "utf8")
    .update(capabilityId, "utf8")
    .update("\0", "utf8")
    .update(actionDigest, "utf8")
    .digest("hex")}`;
}

function deriveQueryWorkerIdentifier(input: {
  ownerUserId: string;
  workerId: string;
  prefix: string;
  domain: Buffer;
}): string {
  const ownerUserId = identifierSchema.parse(input.ownerUserId);
  const workerId = identifierSchema.parse(input.workerId);
  return `${input.prefix}_${createHash("sha256")
    .update(input.domain)
    .update(ownerUserId, "utf8")
    .update("\0", "utf8")
    .update(workerId, "utf8")
    .digest("hex")}`;
}

export function derivePeerQueryWorkerCapabilityId(input: {
  ownerUserId: string;
  workerId: string;
}): string {
  return deriveQueryWorkerIdentifier({
    ...input,
    prefix: "pqw_capability",
    domain: QUERY_WORKER_CAPABILITY_ID_DOMAIN
  });
}

export function derivePeerQueryWorkerSessionId(input: {
  ownerUserId: string;
  workerId: string;
}): string {
  return deriveQueryWorkerIdentifier({
    ...input,
    prefix: "pqw_session",
    domain: QUERY_WORKER_SESSION_ID_DOMAIN
  });
}

export function derivePeerRevocationConsumerCapabilityId(input: {
  ownerUserId: string;
  consumerId: string;
}): string {
  return deriveQueryWorkerIdentifier({
    ownerUserId: input.ownerUserId,
    workerId: input.consumerId,
    prefix: "prc_capability",
    domain: REVOCATION_CONSUMER_CAPABILITY_ID_DOMAIN
  });
}

export function derivePeerRevocationConsumerSessionId(input: {
  ownerUserId: string;
  consumerId: string;
}): string {
  return deriveQueryWorkerIdentifier({
    ownerUserId: input.ownerUserId,
    workerId: input.consumerId,
    prefix: "prc_session",
    domain: REVOCATION_CONSUMER_SESSION_ID_DOMAIN
  });
}

function privateKeyFromSeed(seed: Uint8Array): KeyObject {
  if (seed.byteLength !== 32) {
    throw new Error("Peer command authority requires a 32-byte Ed25519 seed.");
  }
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_SEED_PREFIX, Buffer.from(seed)]),
    format: "der",
    type: "pkcs8"
  });
}

function publicKeyBytes(privateKey: KeyObject): Buffer {
  const jwk = createPublicKey(privateKey).export({ format: "jwk" });
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x) {
    throw new Error("Peer command authority public key is not Ed25519.");
  }
  const bytes = Buffer.from(jwk.x, "base64url");
  if (bytes.byteLength !== 32 || bytes.toString("base64url") !== jwk.x) {
    throw new Error("Peer command authority public key is not canonical.");
  }
  return bytes;
}

function signatureFor(
  privateKey: KeyObject,
  value: Record<string, unknown>,
  domain: Buffer
): string {
  return sign(null, canonicalSigningBytes(value, domain), privateKey).toString(
    "base64url"
  );
}

function verifySignature(
  publicKey: KeyObject,
  value: Record<string, unknown>,
  domain: Buffer,
  signature: string
): boolean {
  return verify(
    null,
    canonicalSigningBytes(value, domain),
    publicKey,
    Buffer.from(signature, "base64url")
  );
}

export class DerivedPeerCommandAuthorizer implements PeerCommandAuthorizer {
  readonly publicKeyBase64Url: string;
  readonly authorityKeyId: string;
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private readonly statePath: string;
  private state: PeerCommandAuthorityState | null = null;
  private stateMutationTail: Promise<void> = Promise.resolve();

  constructor(input: {
    ownerUserId: string;
    stateDir: string;
    secrets: SecretsManager;
  }) {
    this.ownerUserId = identifierSchema.parse(input.ownerUserId);
    this.statePath = path.join(
      input.stateDir,
      PEER_COMMAND_AUTHORITY_STATE_FILE
    );
    this.privateKey = privateKeyFromSeed(
      input.secrets.deriveKey(
        `peer-command-authority/${this.ownerUserId}/ed25519/v1`,
        32
      )
    );
    this.publicKey = createPublicKey(this.privateKey);
    const bytes = publicKeyBytes(this.privateKey);
    this.publicKeyBase64Url = bytes.toString("base64url");
    this.authorityKeyId = createHash("sha256")
      .update(AUTHORITY_KEY_ID_DOMAIN)
      .update(bytes)
      .digest("base64url");
  }

  private readonly ownerUserId: string;

  private async currentState() {
    await this.stateMutationTail;
    return this.initialize();
  }

  private runStateMutation<T>(mutate: () => Promise<T>): Promise<T> {
    const operation = this.stateMutationTail.then(mutate, mutate);
    this.stateMutationTail = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  private async replaceState(state: PeerCommandAuthorityState) {
    const temporaryPath = `${this.statePath}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(state)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, this.statePath);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  private assertAuthorizationIsCurrent(input: {
    state: PeerCommandAuthorityState;
    authorizationId: string;
    issuedAt: string;
    sessionId: string;
    deviceId: string | null;
  }) {
    if (
      Date.parse(input.issuedAt) < Date.parse(input.state.invalidatedBefore) ||
      input.state.revokedAuthorizationIds.includes(input.authorizationId) ||
      input.state.revokedSessionIds.includes(input.sessionId) ||
      (input.deviceId !== null &&
        input.state.revokedDeviceIds.includes(input.deviceId))
    ) {
      throw new Error("Peer command authorization was invalidated or revoked.");
    }
  }

  async initialize(): Promise<PeerCommandAuthorityState> {
    if (this.state) return this.state;
    let raw: string | null = null;
    try {
      raw = await readFile(this.statePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (raw !== null) {
      const parsed = authorityStateSchema.parse(JSON.parse(raw) as unknown);
      if (
        parsed.ownerUserId !== this.ownerUserId ||
        parsed.authorityKeyId !== this.authorityKeyId ||
        !verifySignature(
          this.publicKey,
          parsed as unknown as Record<string, unknown>,
          AUTHORITY_STATE_DOMAIN,
          parsed.signature
        )
      ) {
        throw new Error(
          "Stored peer command authority state is not authentic."
        );
      }
      this.state = parsed;
      return parsed;
    }
    const unsigned = {
      protocol: PEER_COMMAND_AUTHORITY_STATE_PROTOCOL,
      authorityKeyId: this.authorityKeyId,
      ownerUserId: this.ownerUserId,
      epoch: "0",
      invalidatedBefore: "1970-01-01T00:00:00.000Z",
      revokedAuthorizationIds: [] as string[],
      revokedSessionIds: [] as string[],
      revokedDeviceIds: [] as string[],
      signature: ""
    };
    const created = authorityStateSchema.parse({
      ...unsigned,
      signature: signatureFor(
        this.privateKey,
        unsigned as unknown as Record<string, unknown>,
        AUTHORITY_STATE_DOMAIN
      )
    });
    try {
      await writeFile(this.statePath, `${JSON.stringify(created)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx"
      });
      this.state = created;
      return created;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return this.initializeAfterConcurrentCreate();
    }
  }

  private async initializeAfterConcurrentCreate() {
    const parsed = authorityStateSchema.parse(
      JSON.parse(await readFile(this.statePath, "utf8")) as unknown
    );
    if (
      parsed.ownerUserId !== this.ownerUserId ||
      parsed.authorityKeyId !== this.authorityKeyId ||
      !verifySignature(
        this.publicKey,
        parsed as unknown as Record<string, unknown>,
        AUTHORITY_STATE_DOMAIN,
        parsed.signature
      )
    ) {
      throw new Error(
        "Concurrent peer command authority state is not authentic."
      );
    }
    this.state = parsed;
    return parsed;
  }

  async authorize(
    input: Parameters<PeerCommandAuthorizer["authorize"]>[0]
  ): Promise<PeerCommandAuthorization> {
    const state = await this.currentState();
    const approval = peerCommandApprovalBindingSchema.parse(input.approval);
    const approvalDeadline = timestampSchema.parse(input.approvalDeadline);
    if (
      input.ownerUserId !== this.ownerUserId ||
      approval.capabilityExpiresAt !== approvalDeadline ||
      Date.parse(approval.authorizationIssuedAt) > Date.parse(approvalDeadline)
    ) {
      throw new Error(
        "Peer command authorization is outside its exact approval binding."
      );
    }
    const authorizationId = derivePeerCommandAuthorizationId({
      commandId: input.commandId,
      capabilityId: approval.capabilityId,
      actionDigest: approval.actionDigest
    });
    this.assertAuthorizationIsCurrent({
      state,
      authorizationId,
      issuedAt: approval.authorizationIssuedAt,
      sessionId: approval.sessionId,
      deviceId: approval.deviceId
    });
    const unsigned = {
      protocol: PEER_COMMAND_AUTHORIZATION_PROTOCOL,
      authorityKeyId: this.authorityKeyId,
      authorizationId,
      ownerUserId: this.ownerUserId,
      actor: {
        class: approval.actorClass,
        actorId: approval.actorId,
        sessionId: approval.sessionId,
        deviceId: approval.deviceId
      },
      capability: {
        kind: "human_approval" as const,
        capabilityId: approval.capabilityId,
        actionDigest: approval.actionDigest,
        state: "consumed" as const,
        issuedAt: approval.capabilityIssuedAt,
        expiresAt: approval.capabilityExpiresAt
      },
      action: input.action,
      commandId: input.commandId,
      commandDigest: hashSchema.parse(input.commandDigest),
      approvalDeadline,
      issuedAt: approval.authorizationIssuedAt,
      invalidationEpoch: state.epoch,
      signature: ""
    };
    return peerCommandAuthorizationSchema.parse({
      ...unsigned,
      signature: signatureFor(
        this.privateKey,
        unsigned as unknown as Record<string, unknown>,
        AUTHORIZATION_DOMAIN
      )
    });
  }

  async authorizeQueryWorker(
    input: Parameters<
      NonNullable<PeerCommandAuthorizer["authorizeQueryWorker"]>
    >[0]
  ): Promise<PeerCommandAuthorization> {
    const state = await this.currentState();
    if (input.ownerUserId !== this.ownerUserId) {
      throw new Error(
        "Peer query-worker authorization belongs to another owner."
      );
    }
    const issuedAt = timestampSchema.parse(input.issuedAt);
    const approvalDeadline = timestampSchema.parse(input.approvalDeadline);
    const issuedAtMs = Date.parse(issuedAt);
    const deadlineMs = Date.parse(approvalDeadline);
    if (
      issuedAtMs > deadlineMs ||
      deadlineMs - issuedAtMs > 24 * 60 * 60 * 1_000
    ) {
      throw new Error("Peer query-worker authorization window is invalid.");
    }
    const workerId = identifierSchema.parse(input.workerId);
    const commandDigest = hashSchema.parse(input.commandDigest);
    const capabilityId = derivePeerQueryWorkerCapabilityId({
      ownerUserId: this.ownerUserId,
      workerId
    });
    const authorizationId = derivePeerCommandAuthorizationId({
      commandId: input.commandId,
      capabilityId,
      actionDigest: commandDigest
    });
    const sessionId = derivePeerQueryWorkerSessionId({
      ownerUserId: this.ownerUserId,
      workerId
    });
    this.assertAuthorizationIsCurrent({
      state,
      authorizationId,
      issuedAt,
      sessionId,
      deviceId: null
    });
    const unsigned = {
      protocol: PEER_COMMAND_AUTHORIZATION_PROTOCOL,
      authorityKeyId: this.authorityKeyId,
      authorizationId,
      ownerUserId: this.ownerUserId,
      actor: {
        class: "service_worker" as const,
        actorId: workerId,
        sessionId,
        deviceId: null
      },
      capability: {
        kind: "query_worker" as const,
        capabilityId,
        actionDigest: commandDigest,
        state: "active" as const,
        issuedAt,
        expiresAt: approvalDeadline
      },
      action: input.action,
      commandId: identifierSchema.parse(input.commandId),
      commandDigest,
      approvalDeadline,
      issuedAt,
      invalidationEpoch: state.epoch,
      signature: ""
    };
    return peerCommandAuthorizationSchema.parse({
      ...unsigned,
      signature: signatureFor(
        this.privateKey,
        unsigned as unknown as Record<string, unknown>,
        AUTHORIZATION_DOMAIN
      )
    });
  }

  async authorizeRevocationConsumer(
    input: Parameters<
      NonNullable<PeerCommandAuthorizer["authorizeRevocationConsumer"]>
    >[0]
  ): Promise<PeerCommandAuthorization> {
    const state = await this.currentState();
    if (input.ownerUserId !== this.ownerUserId) {
      throw new Error(
        "Peer revocation-consumer authorization belongs to another owner."
      );
    }
    const issuedAt = timestampSchema.parse(input.issuedAt);
    const approvalDeadline = timestampSchema.parse(input.approvalDeadline);
    const issuedAtMs = Date.parse(issuedAt);
    const deadlineMs = Date.parse(approvalDeadline);
    if (
      issuedAtMs > deadlineMs ||
      deadlineMs - issuedAtMs > 24 * 60 * 60 * 1_000
    ) {
      throw new Error(
        "Peer revocation-consumer authorization window is invalid."
      );
    }
    const consumerId = identifierSchema.parse(input.consumerId);
    const commandDigest = hashSchema.parse(input.commandDigest);
    const capabilityId = derivePeerRevocationConsumerCapabilityId({
      ownerUserId: this.ownerUserId,
      consumerId
    });
    const authorizationId = derivePeerCommandAuthorizationId({
      commandId: input.commandId,
      capabilityId,
      actionDigest: commandDigest
    });
    const sessionId = derivePeerRevocationConsumerSessionId({
      ownerUserId: this.ownerUserId,
      consumerId
    });
    this.assertAuthorizationIsCurrent({
      state,
      authorizationId,
      issuedAt,
      sessionId,
      deviceId: null
    });
    const unsigned = {
      protocol: PEER_COMMAND_AUTHORIZATION_PROTOCOL,
      authorityKeyId: this.authorityKeyId,
      authorizationId,
      ownerUserId: this.ownerUserId,
      actor: {
        class: "service_worker" as const,
        actorId: consumerId,
        sessionId,
        deviceId: null
      },
      capability: {
        kind: "revocation_consumer" as const,
        capabilityId,
        actionDigest: commandDigest,
        state: "active" as const,
        issuedAt,
        expiresAt: approvalDeadline
      },
      action: input.action,
      commandId: identifierSchema.parse(input.commandId),
      commandDigest,
      approvalDeadline,
      issuedAt,
      invalidationEpoch: state.epoch,
      signature: ""
    };
    return peerCommandAuthorizationSchema.parse({
      ...unsigned,
      signature: signatureFor(
        this.privateKey,
        unsigned as unknown as Record<string, unknown>,
        AUTHORIZATION_DOMAIN
      )
    });
  }

  invalidateAuthority(
    input: Parameters<
      NonNullable<PeerCommandAuthorizer["invalidateAuthority"]>
    >[0]
  ): Promise<PeerCommandAuthorityState> {
    return this.runStateMutation(async () => {
      if (input.ownerUserId !== this.ownerUserId) {
        throw new Error(
          "Peer command authority invalidation belongs to another owner."
        );
      }
      const invalidatedAt = timestampSchema.parse(input.invalidatedAt);
      const current = await this.initialize();
      const boundedRevocations = (values: readonly string[] | undefined) =>
        [
          ...new Set(
            (values ?? []).map((value) => identifierSchema.parse(value))
          )
        ]
          .sort()
          .slice(-128);
      const revokedAuthorizationIds = boundedRevocations([
        ...current.revokedAuthorizationIds,
        ...(input.revokedAuthorizationIds ?? [])
      ]);
      const revokedSessionIds = boundedRevocations([
        ...current.revokedSessionIds,
        ...(input.revokedSessionIds ?? [])
      ]);
      const revokedDeviceIds = boundedRevocations([
        ...current.revokedDeviceIds,
        ...(input.revokedDeviceIds ?? [])
      ]);
      const nextEpoch = (BigInt(current.epoch) + 1n).toString();
      const nextInvalidatedBefore = new Date(
        Math.max(
          Date.parse(current.invalidatedBefore),
          Date.parse(invalidatedAt)
        )
      ).toISOString();
      const unsigned = {
        protocol: PEER_COMMAND_AUTHORITY_STATE_PROTOCOL,
        authorityKeyId: this.authorityKeyId,
        ownerUserId: this.ownerUserId,
        epoch: nextEpoch,
        invalidatedBefore: nextInvalidatedBefore,
        revokedAuthorizationIds,
        revokedSessionIds,
        revokedDeviceIds,
        signature: ""
      };
      const next = authorityStateSchema.parse({
        ...unsigned,
        signature: signatureFor(
          this.privateKey,
          unsigned as unknown as Record<string, unknown>,
          AUTHORITY_STATE_DOMAIN
        )
      });
      await this.replaceState(next);
      this.state = next;
      return next;
    });
  }
}
