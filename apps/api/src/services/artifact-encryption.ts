import { createHash, timingSafeEqual } from "node:crypto";
import sodium from "libsodium-wrappers-sumo";

export const ARTIFACT_ENCRYPTION_ALGORITHM =
  "libsodium-secretstream-xchacha20poly1305" as const;
export const ARTIFACT_ENCRYPTION_KDF = "argon2id" as const;
export const ARTIFACT_ENCRYPTION_ENVELOPE_VERSION = 1 as const;
export const ARTIFACT_ENCRYPTION_CHUNK_SIZE = 1024 * 1024;
export const ARTIFACT_ENCRYPTION_MEMLIMIT = 19 * 1024 * 1024;
export const ARTIFACT_ENCRYPTION_OPSLIMIT = 2;
export const ARTIFACT_ENCRYPTION_PARALLELISM = 1;

export type ArtifactContentProtectionMode =
  | "plaintext"
  | "password_encrypted";

export type ArtifactEncryptionKdfParams = {
  memlimit: number;
  opslimit: number;
  parallelism: number;
};

export type ArtifactEncryptionEnvelope = {
  version: typeof ARTIFACT_ENCRYPTION_ENVELOPE_VERSION;
  algorithm: typeof ARTIFACT_ENCRYPTION_ALGORITHM;
  kdf: typeof ARTIFACT_ENCRYPTION_KDF;
  kdfParams: ArtifactEncryptionKdfParams;
  saltBase64: string;
  headerBase64: string;
  chunkSize: number;
  plaintextSha256: string;
  plaintextByteSize: number;
  originalFileName: string;
  detectedMimeType: string;
  artifactId: string;
  versionId: string;
  encryptedAt: string;
};

export type SafeArtifactContentProtection = {
  mode: ArtifactContentProtectionMode;
  encryptedAt: string | null;
  algorithm: typeof ARTIFACT_ENCRYPTION_ALGORITHM | null;
  kdf: typeof ARTIFACT_ENCRYPTION_KDF | null;
  kdfParams: ArtifactEncryptionKdfParams | null;
  passwordHint: string | null;
};

export class ArtifactDecryptionError extends Error {
  constructor(message = "The password did not decrypt this artifact.") {
    super(message);
    this.name = "ArtifactDecryptionError";
  }
}

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function toBase64(value: Uint8Array) {
  return Buffer.from(value).toString("base64");
}

function fromBase64(value: string) {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function canonicalEnvelopeForAuthentication(
  envelope: ArtifactEncryptionEnvelope
) {
  return JSON.stringify({
    version: envelope.version,
    algorithm: envelope.algorithm,
    kdf: envelope.kdf,
    kdfParams: {
      memlimit: envelope.kdfParams.memlimit,
      opslimit: envelope.kdfParams.opslimit,
      parallelism: envelope.kdfParams.parallelism
    },
    saltBase64: envelope.saltBase64,
    headerBase64: envelope.headerBase64,
    chunkSize: envelope.chunkSize,
    plaintextSha256: envelope.plaintextSha256,
    plaintextByteSize: envelope.plaintextByteSize,
    originalFileName: envelope.originalFileName,
    detectedMimeType: envelope.detectedMimeType,
    artifactId: envelope.artifactId,
    versionId: envelope.versionId,
    encryptedAt: envelope.encryptedAt
  });
}

function hashEquals(a: string, b: string) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseEnvelope(input: unknown): ArtifactEncryptionEnvelope {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ArtifactDecryptionError("Artifact encryption metadata is invalid.");
  }
  const value = input as Record<string, unknown>;
  if (
    value.version !== ARTIFACT_ENCRYPTION_ENVELOPE_VERSION ||
    value.algorithm !== ARTIFACT_ENCRYPTION_ALGORITHM ||
    value.kdf !== ARTIFACT_ENCRYPTION_KDF
  ) {
    throw new ArtifactDecryptionError("Artifact encryption metadata is unsupported.");
  }
  const kdfParams = value.kdfParams as Record<string, unknown> | undefined;
  const envelope = {
    version: ARTIFACT_ENCRYPTION_ENVELOPE_VERSION,
    algorithm: ARTIFACT_ENCRYPTION_ALGORITHM,
    kdf: ARTIFACT_ENCRYPTION_KDF,
    kdfParams: {
      memlimit:
        typeof kdfParams?.memlimit === "number" ? kdfParams.memlimit : 0,
      opslimit:
        typeof kdfParams?.opslimit === "number" ? kdfParams.opslimit : 0,
      parallelism:
        typeof kdfParams?.parallelism === "number"
          ? kdfParams.parallelism
          : 0
    },
    saltBase64: typeof value.saltBase64 === "string" ? value.saltBase64 : "",
    headerBase64:
      typeof value.headerBase64 === "string" ? value.headerBase64 : "",
    chunkSize: typeof value.chunkSize === "number" ? value.chunkSize : 0,
    plaintextSha256:
      typeof value.plaintextSha256 === "string" ? value.plaintextSha256 : "",
    plaintextByteSize:
      typeof value.plaintextByteSize === "number"
        ? value.plaintextByteSize
        : -1,
    originalFileName:
      typeof value.originalFileName === "string" ? value.originalFileName : "",
    detectedMimeType:
      typeof value.detectedMimeType === "string" ? value.detectedMimeType : "",
    artifactId: typeof value.artifactId === "string" ? value.artifactId : "",
    versionId: typeof value.versionId === "string" ? value.versionId : "",
    encryptedAt:
      typeof value.encryptedAt === "string" ? value.encryptedAt : ""
  } satisfies ArtifactEncryptionEnvelope;

  if (
    envelope.kdfParams.memlimit < ARTIFACT_ENCRYPTION_MEMLIMIT ||
    envelope.kdfParams.opslimit < ARTIFACT_ENCRYPTION_OPSLIMIT ||
    envelope.kdfParams.parallelism !== ARTIFACT_ENCRYPTION_PARALLELISM ||
    envelope.chunkSize <= 0 ||
    envelope.saltBase64.length === 0 ||
    envelope.headerBase64.length === 0 ||
    envelope.plaintextSha256.length !== 64 ||
    envelope.plaintextByteSize < 0
  ) {
    throw new ArtifactDecryptionError("Artifact encryption metadata is invalid.");
  }
  return envelope;
}

async function deriveKey(password: string, salt: Uint8Array) {
  await sodium.ready;
  return sodium.crypto_pwhash(
    sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES,
    password,
    salt,
    ARTIFACT_ENCRYPTION_OPSLIMIT,
    ARTIFACT_ENCRYPTION_MEMLIMIT,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  );
}

export async function encryptArtifactBytes(input: {
  plaintext: Buffer;
  password: string;
  originalFileName: string;
  detectedMimeType: string;
  artifactId: string;
  versionId: string;
  encryptedAt: string;
}) {
  if (input.password.length === 0) {
    throw new Error("Password is required to encrypt artifact content.");
  }
  await sodium.ready;
  const plaintextSha256 = sha256(input.plaintext);
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const key = await deriveKey(input.password, salt);
  try {
    const { state, header } =
      sodium.crypto_secretstream_xchacha20poly1305_init_push(key);
    const envelope: ArtifactEncryptionEnvelope = {
      version: ARTIFACT_ENCRYPTION_ENVELOPE_VERSION,
      algorithm: ARTIFACT_ENCRYPTION_ALGORITHM,
      kdf: ARTIFACT_ENCRYPTION_KDF,
      kdfParams: {
        memlimit: ARTIFACT_ENCRYPTION_MEMLIMIT,
        opslimit: ARTIFACT_ENCRYPTION_OPSLIMIT,
        parallelism: ARTIFACT_ENCRYPTION_PARALLELISM
      },
      saltBase64: toBase64(salt),
      headerBase64: toBase64(header),
      chunkSize: ARTIFACT_ENCRYPTION_CHUNK_SIZE,
      plaintextSha256,
      plaintextByteSize: input.plaintext.byteLength,
      originalFileName: input.originalFileName,
      detectedMimeType: input.detectedMimeType,
      artifactId: input.artifactId,
      versionId: input.versionId,
      encryptedAt: input.encryptedAt
    };
    const associatedData = sodium.from_string(
      canonicalEnvelopeForAuthentication(envelope)
    );
    const chunks: Buffer[] = [];
    if (input.plaintext.byteLength === 0) {
      chunks.push(
        Buffer.from(
          sodium.crypto_secretstream_xchacha20poly1305_push(
            state,
            new Uint8Array(),
            associatedData,
            sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
          )
        )
      );
    }
    for (
      let offset = 0;
      offset < input.plaintext.byteLength;
      offset += ARTIFACT_ENCRYPTION_CHUNK_SIZE
    ) {
      const end = Math.min(
        offset + ARTIFACT_ENCRYPTION_CHUNK_SIZE,
        input.plaintext.byteLength
      );
      const tag =
        end >= input.plaintext.byteLength
          ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
          : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;
      chunks.push(
        Buffer.from(
          sodium.crypto_secretstream_xchacha20poly1305_push(
            state,
            input.plaintext.subarray(offset, end),
            associatedData,
            tag
          )
        )
      );
    }
    return {
      envelope,
      ciphertext: Buffer.concat(chunks),
      plaintextSha256,
      plaintextByteSize: input.plaintext.byteLength
    };
  } finally {
    key.fill(0);
  }
}

export async function decryptArtifactBytes(input: {
  ciphertext: Buffer;
  password: string;
  envelope: ArtifactEncryptionEnvelope | Record<string, unknown>;
}) {
  if (input.password.length === 0) {
    throw new ArtifactDecryptionError();
  }
  await sodium.ready;
  const envelope = parseEnvelope(input.envelope);
  const salt = fromBase64(envelope.saltBase64);
  const header = fromBase64(envelope.headerBase64);
  if (
    salt.byteLength !== sodium.crypto_pwhash_SALTBYTES ||
    header.byteLength !== sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES
  ) {
    throw new ArtifactDecryptionError("Artifact encryption metadata is invalid.");
  }
  const key = await deriveKey(input.password, salt);
  try {
    const associatedData = sodium.from_string(
      canonicalEnvelopeForAuthentication(envelope)
    );
    const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(
      header,
      key
    );
    const plaintextChunks: Buffer[] = [];
    let sawFinal = false;
    for (let offset = 0; offset < input.ciphertext.byteLength; ) {
      const remaining = input.ciphertext.byteLength - offset;
      const fullCipherChunk =
        envelope.chunkSize + sodium.crypto_secretstream_xchacha20poly1305_ABYTES;
      const chunkSize =
        remaining > fullCipherChunk ? fullCipherChunk : remaining;
      const chunk = input.ciphertext.subarray(offset, offset + chunkSize);
      const result = sodium.crypto_secretstream_xchacha20poly1305_pull(
        state,
        chunk,
        associatedData
      );
      if (!result) {
        throw new ArtifactDecryptionError();
      }
      if (sawFinal) {
        throw new ArtifactDecryptionError("Artifact ciphertext has trailing data.");
      }
      plaintextChunks.push(Buffer.from(result.message));
      sawFinal =
        result.tag === sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL;
      offset += chunkSize;
    }
    if (!sawFinal) {
      throw new ArtifactDecryptionError("Artifact ciphertext is incomplete.");
    }
    const plaintext = Buffer.concat(plaintextChunks);
    if (
      plaintext.byteLength !== envelope.plaintextByteSize ||
      !hashEquals(sha256(plaintext), envelope.plaintextSha256)
    ) {
      plaintext.fill(0);
      throw new ArtifactDecryptionError("Artifact plaintext identity check failed.");
    }
    return { plaintext, envelope };
  } finally {
    key.fill(0);
  }
}

export async function verifyArtifactEncryptionRoundTrip(input: {
  ciphertext: Buffer;
  password: string;
  envelope: ArtifactEncryptionEnvelope;
  expectedPlaintextSha256: string;
  expectedPlaintextByteSize: number;
}) {
  const { plaintext } = await decryptArtifactBytes({
    ciphertext: input.ciphertext,
    password: input.password,
    envelope: input.envelope
  });
  try {
    return (
      plaintext.byteLength === input.expectedPlaintextByteSize &&
      hashEquals(sha256(plaintext), input.expectedPlaintextSha256)
    );
  } finally {
    plaintext.fill(0);
  }
}

export function safeContentProtectionFromEnvelope(input: {
  mode: ArtifactContentProtectionMode;
  encryptedAt: string | null;
  envelope: Record<string, unknown>;
  passwordHint: string;
}): SafeArtifactContentProtection {
  if (input.mode !== "password_encrypted") {
    return {
      mode: "plaintext",
      encryptedAt: null,
      algorithm: null,
      kdf: null,
      kdfParams: null,
      passwordHint: null
    };
  }
  const envelope = parseEnvelope(input.envelope);
  return {
    mode: "password_encrypted",
    encryptedAt: input.encryptedAt || envelope.encryptedAt,
    algorithm: ARTIFACT_ENCRYPTION_ALGORITHM,
    kdf: ARTIFACT_ENCRYPTION_KDF,
    kdfParams: {
      memlimit: envelope.kdfParams.memlimit,
      opslimit: envelope.kdfParams.opslimit,
      parallelism: envelope.kdfParams.parallelism
    },
    passwordHint: input.passwordHint.trim() || null
  };
}
