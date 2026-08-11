import { timingSafeEqual } from "node:crypto";

import sodium from "libsodium-wrappers-sumo";

import type {
  PairingNetworkPartitionAuthority,
  VerifiedNetworkPartition
} from "./pairing-network-partition.js";
import type {
  KeyedSecretDigester,
  OpaqueSecretSource,
  SecurityClock
} from "./security-runtime.js";

export const MASTER_PASSWORD_MINIMUM_LENGTH = 15;
export const MASTER_PASSWORD_MAXIMUM_LENGTH = 128;
export const MASTER_PASSWORD_MAXIMUM_UTF8_BYTES = 1_024;
export const MASTER_PASSWORD_MINIMUM_DIVERSITY_BITS = 50;
export const MASTER_PASSWORD_MEMLIMIT = 19 * 1_024 * 1_024;
export const MASTER_PASSWORD_OPSLIMIT = 2;
export const MASTER_PASSWORD_PARALLELISM = 1;

const COMMON_MASTER_PASSWORDS = new Set([
  "123456789012345",
  "correct horse battery staple",
  "forge master password",
  "forge remote access",
  "letmeinletmeinletmein",
  "passwordpassword",
  "password123456789",
  "qwertyuiopasdfgh",
  "this is my password",
  "trustno1trustno1"
]);

export type MasterPasswordCredential = {
  ownerId: string;
  version: 1;
  algorithm: "argon2id13";
  saltBase64: string;
  verifierBase64: string;
  memlimit: number;
  opslimit: number;
  parallelism: number;
  createdAt: string;
  updatedAt: string;
};

export type MasterPasswordRepository = {
  readMasterPasswordCredential(
    ownerId: string
  ): MasterPasswordCredential | null;
  writeMasterPasswordCredential(record: MasterPasswordCredential): void;
  readOwnerSecurityEpoch(ownerId: string): number | null;
  claimPairingApprovalAttempt(input: {
    bucketKey: string;
    now: string;
    windowSeconds: number;
    maximumAttempts: number;
  }): boolean;
};

declare const masterPasswordAuthorizationBrand: unique symbol;

export type MasterPasswordPairingAuthorization = {
  readonly ownerId: string;
  readonly ownerSecurityEpoch: number;
  readonly requestId: string;
  readonly authorizedAt: string;
  readonly [masterPasswordAuthorizationBrand]: true;
};

export type MasterPasswordAuthorizationConsumer = {
  consumeMasterPasswordAuthorization(
    authorization: MasterPasswordPairingAuthorization,
    expectedRequestId: string
  ): MasterPasswordPairingAuthorization;
};

export class MasterPasswordError extends Error {
  constructor(
    readonly code:
      | "master_password_not_configured"
      | "master_password_current_required"
      | "master_password_invalid"
      | "master_password_rate_limited"
      | "master_password_too_short"
      | "master_password_too_long"
      | "master_password_too_large"
      | "master_password_common"
      | "master_password_weak",
    message: string
  ) {
    super(message);
    this.name = "MasterPasswordError";
  }
}

function normalizePassword(password: string) {
  return password.normalize("NFC");
}

function passwordFingerprint(password: string) {
  return password
    .toLocaleLowerCase("en-US")
    .replaceAll("0", "o")
    .replaceAll("1", "i")
    .replaceAll("3", "e")
    .replaceAll("4", "a")
    .replaceAll("5", "s")
    .replaceAll("7", "t")
    .replaceAll(/[^a-z0-9]/gu, "");
}

function compactPassword(password: string) {
  return password.toLocaleLowerCase("en-US").replaceAll(/[^a-z0-9]/gu, "");
}

function characterDistributionBits(password: string) {
  const symbols = [...password];
  const counts = new Map<string, number>();
  for (const symbol of symbols) {
    counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  }
  return (
    symbols.length *
    [...counts.values()].reduce((entropy, count) => {
      const probability = count / symbols.length;
      return entropy - probability * Math.log2(probability);
    }, 0)
  );
}

function containsObviousSequence(fingerprint: string) {
  for (const sequence of [
    "abcdefghijklmnopqrstuvwxyz",
    "zyxwvutsrqponmlkjihgfedcba",
    "0123456789",
    "9876543210",
    "qwertyuiopasdfghjklzxcvbnm",
    "mnbvcxzlkjhgfdsaqpoiuytrewq"
  ]) {
    for (let index = 0; index <= sequence.length - 6; index += 1) {
      if (fingerprint.includes(sequence.slice(index, index + 6))) return true;
    }
  }
  return false;
}

function validateNewPassword(password: string, ownerId: string) {
  const normalized = normalizePassword(password);
  const length = [...normalized].length;
  if (length < MASTER_PASSWORD_MINIMUM_LENGTH) {
    throw new MasterPasswordError(
      "master_password_too_short",
      `Use at least ${MASTER_PASSWORD_MINIMUM_LENGTH} characters. A long, unique passphrase is recommended.`
    );
  }
  if (length > MASTER_PASSWORD_MAXIMUM_LENGTH) {
    throw new MasterPasswordError(
      "master_password_too_long",
      `Use no more than ${MASTER_PASSWORD_MAXIMUM_LENGTH} characters.`
    );
  }
  if (
    Buffer.byteLength(normalized, "utf8") > MASTER_PASSWORD_MAXIMUM_UTF8_BYTES
  ) {
    throw new MasterPasswordError(
      "master_password_too_large",
      "The UTF-8 encoded master password is too large."
    );
  }
  const blocklist = new Set(COMMON_MASTER_PASSWORDS);
  const normalizedLower = normalized.toLocaleLowerCase("en-US");
  if (blocklist.has(normalizedLower)) {
    throw new MasterPasswordError(
      "master_password_common",
      "Choose a unique passphrase that is not a common password, the product name, or your owner identifier."
    );
  }
  const fingerprint = passwordFingerprint(normalized);
  const ownerFingerprint = passwordFingerprint(ownerId);
  const weakFragments = [
    "password",
    "letmein",
    "qwerty",
    "asdfgh",
    "abcdef",
    "i2eas6",
    "trustnoi",
    "correcthorsebatterystaple",
    "forge"
  ];
  if (
    weakFragments.some((fragment) => fingerprint.includes(fragment)) ||
    (ownerFingerprint.length >= 4 && fingerprint.includes(ownerFingerprint))
  ) {
    throw new MasterPasswordError(
      "master_password_common",
      "Choose a unique passphrase that is not a common password, an obvious variation, the product name, or your owner identifier."
    );
  }
  if (
    new Set([...normalizedLower]).size < 6 ||
    containsObviousSequence(compactPassword(normalized)) ||
    characterDistributionBits(normalized) <
      MASTER_PASSWORD_MINIMUM_DIVERSITY_BITS
  ) {
    throw new MasterPasswordError(
      "master_password_weak",
      "Choose a less predictable passphrase. Avoid repeated characters, short repeated patterns, and obvious alphabet, number, or keyboard sequences."
    );
  }
  return normalized;
}

function credentialIsSupported(credential: MasterPasswordCredential) {
  return (
    credential.version === 1 &&
    credential.algorithm === "argon2id13" &&
    credential.memlimit >= MASTER_PASSWORD_MEMLIMIT &&
    credential.opslimit >= MASTER_PASSWORD_OPSLIMIT &&
    credential.parallelism === MASTER_PASSWORD_PARALLELISM
  );
}

export class MasterPasswordService<
  ServerContext
> implements MasterPasswordAuthorizationConsumer {
  private readonly unusedAuthorizations = new WeakSet<object>();

  constructor(
    private readonly clock: SecurityClock,
    private readonly secrets: OpaqueSecretSource,
    private readonly digester: KeyedSecretDigester,
    private readonly repository: MasterPasswordRepository,
    private readonly networkPartitions: PairingNetworkPartitionAuthority<ServerContext>,
    private readonly maximumAttempts = 5,
    private readonly attemptWindowSeconds = 5 * 60
  ) {}

  status(ownerId: string) {
    const credential = this.repository.readMasterPasswordCredential(ownerId);
    return {
      configured: Boolean(credential),
      configuredAt: credential?.createdAt ?? null,
      updatedAt: credential?.updatedAt ?? null,
      minimumLength: MASTER_PASSWORD_MINIMUM_LENGTH,
      maximumLength: MASTER_PASSWORD_MAXIMUM_LENGTH
    };
  }

  async set(input: {
    ownerId: string;
    password: string;
    currentPassword?: string;
  }) {
    await sodium.ready;
    const existing = this.repository.readMasterPasswordCredential(
      input.ownerId
    );
    if (existing) {
      if (!input.currentPassword) {
        throw new MasterPasswordError(
          "master_password_current_required",
          "Enter the current master password before replacing it."
        );
      }
      if (!(await this.verifyCredential(existing, input.currentPassword))) {
        throw new MasterPasswordError(
          "master_password_invalid",
          "The current master password is incorrect."
        );
      }
    }
    const password = validateNewPassword(input.password, input.ownerId);
    const salt = this.secrets.bytes(sodium.crypto_pwhash_SALTBYTES);
    const verifier = await this.deriveVerifier(password, salt);
    const now = this.clock.now().toISOString();
    this.repository.writeMasterPasswordCredential({
      ownerId: input.ownerId,
      version: 1,
      algorithm: "argon2id13",
      saltBase64: Buffer.from(salt).toString("base64"),
      verifierBase64: Buffer.from(verifier).toString("base64"),
      memlimit: MASTER_PASSWORD_MEMLIMIT,
      opslimit: MASTER_PASSWORD_OPSLIMIT,
      parallelism: MASTER_PASSWORD_PARALLELISM,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    });
    return this.status(input.ownerId);
  }

  async authorizePairing(input: {
    ownerId: string;
    requestId: string;
    password: string;
    networkPartition: VerifiedNetworkPartition;
  }) {
    const networkIdentity = this.networkPartitions.consume(
      input.networkPartition
    );
    const now = this.clock.now().toISOString();
    const bucketKey = this.digester.digest(
      "master-password-pairing-attempt",
      `${input.ownerId}\0${networkIdentity}`
    );
    if (
      !this.repository.claimPairingApprovalAttempt({
        bucketKey,
        now,
        windowSeconds: this.attemptWindowSeconds,
        maximumAttempts: this.maximumAttempts
      })
    ) {
      throw new MasterPasswordError(
        "master_password_rate_limited",
        "Too many master-password attempts were made. Wait five minutes before trying again."
      );
    }
    const credential = this.repository.readMasterPasswordCredential(
      input.ownerId
    );
    if (!credential) {
      throw new MasterPasswordError(
        "master_password_not_configured",
        "The local owner has not configured master-password pairing."
      );
    }
    if (!(await this.verifyCredential(credential, input.password))) {
      throw new MasterPasswordError(
        "master_password_invalid",
        "The master password is incorrect."
      );
    }
    const ownerSecurityEpoch = this.repository.readOwnerSecurityEpoch(
      input.ownerId
    );
    if (!ownerSecurityEpoch) {
      throw new MasterPasswordError(
        "master_password_invalid",
        "The master-password authority is unavailable."
      );
    }
    const authorization = {
      ownerId: input.ownerId,
      ownerSecurityEpoch,
      requestId: input.requestId,
      authorizedAt: now
    } as MasterPasswordPairingAuthorization;
    this.unusedAuthorizations.add(authorization);
    return authorization;
  }

  consumeMasterPasswordAuthorization(
    authorization: MasterPasswordPairingAuthorization,
    expectedRequestId: string
  ) {
    if (
      !this.unusedAuthorizations.delete(authorization) ||
      authorization.requestId !== expectedRequestId ||
      this.repository.readOwnerSecurityEpoch(authorization.ownerId) !==
        authorization.ownerSecurityEpoch
    ) {
      throw new Error(
        "Forge master-password pairing authorization is forged, replayed, mismatched, or stale."
      );
    }
    return authorization;
  }

  private async deriveVerifier(password: string, salt: Uint8Array) {
    await sodium.ready;
    const peppered = this.digester.digest(
      "master-password-verifier-input/v1",
      normalizePassword(password)
    );
    return sodium.crypto_pwhash(
      32,
      peppered,
      salt,
      MASTER_PASSWORD_OPSLIMIT,
      MASTER_PASSWORD_MEMLIMIT,
      sodium.crypto_pwhash_ALG_ARGON2ID13
    );
  }

  private async verifyCredential(
    credential: MasterPasswordCredential,
    password: string
  ) {
    await sodium.ready;
    if (!credentialIsSupported(credential)) return false;
    try {
      const expected = Buffer.from(credential.verifierBase64, "base64");
      const salt = Buffer.from(credential.saltBase64, "base64");
      if (
        expected.length !== 32 ||
        salt.length !== sodium.crypto_pwhash_SALTBYTES
      ) {
        return false;
      }
      const actual = Buffer.from(await this.deriveVerifier(password, salt));
      return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
      );
    } catch {
      return false;
    }
  }
}
