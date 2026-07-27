import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  importJWK,
  jwtVerify,
  type JWK,
  type JWTPayload
} from "jose";

export type SigningKeyRecord = {
  keyId: string;
  algorithm: "ES256";
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicJwk: JWK;
  verificationExpiresAt: string | null;
};

export type SignedTokenInput = {
  audience: string;
  subject: string;
  tokenId: string;
  issuedAtSeconds: number;
  expiresAtSeconds: number;
  claims: JWTPayload;
};

export type SigningKeyProvider = {
  sign(input: SignedTokenInput): Promise<string>;
  verify(
    token: string,
    input: {
      audience: string;
      nowSeconds: number;
      clockToleranceSeconds?: number;
    }
  ): ReturnType<typeof jwtVerify>;
  publicJwks(): Promise<{ keys: JWK[] }>;
};

type StoredSigningKey = {
  keyId: string;
  privateJwk: JWK;
  publicJwk: JWK;
  verificationExpiresAt: string | null;
};

type StoredSigningKeyFile = {
  version: 1;
  activeKeyId: string;
  keys: StoredSigningKey[];
};

abstract class SigningKeyProviderBase implements SigningKeyProvider {
  protected activeKey: SigningKeyRecord | null = null;
  protected readonly verificationKeys = new Map<string, SigningKeyRecord>();

  constructor(protected readonly issuer: string) {}

  protected abstract ensureInitialized(): Promise<void>;

  async sign(input: SignedTokenInput) {
    await this.ensureInitialized();
    const key = this.activeKey;
    if (!key) {
      throw new Error("Forge has no active signing key.");
    }
    return new SignJWT(input.claims)
      .setProtectedHeader({
        alg: key.algorithm,
        kid: key.keyId,
        typ: "JWT"
      })
      .setIssuer(this.issuer)
      .setAudience(input.audience)
      .setSubject(input.subject)
      .setJti(input.tokenId)
      .setIssuedAt(input.issuedAtSeconds)
      .setExpirationTime(input.expiresAtSeconds)
      .sign(key.privateKey);
  }

  async verify(
    token: string,
    input: {
      audience: string;
      nowSeconds: number;
      clockToleranceSeconds?: number;
    }
  ) {
    await this.ensureInitialized();
    return jwtVerify(
      token,
      async (protectedHeader) => {
        if (protectedHeader.alg !== "ES256" || !protectedHeader.kid) {
          throw new Error("Forge token uses an unapproved signing key.");
        }
        const key = this.verificationKeys.get(protectedHeader.kid);
        if (
          !key ||
          (key.verificationExpiresAt !== null &&
            Date.parse(key.verificationExpiresAt) <= input.nowSeconds * 1000)
        ) {
          throw new Error("Forge token uses an unknown signing key.");
        }
        return key.publicKey;
      },
      {
        algorithms: ["ES256"],
        issuer: this.issuer,
        audience: input.audience,
        currentDate: new Date(input.nowSeconds * 1000),
        clockTolerance: input.clockToleranceSeconds ?? 5
      }
    );
  }

  async publicJwks() {
    await this.ensureInitialized();
    return {
      keys: [...this.verificationKeys.values()]
        .filter(
          (entry) =>
            entry === this.activeKey ||
            entry.verificationExpiresAt === null ||
            Date.parse(entry.verificationExpiresAt) > Date.now()
        )
        .map((entry) => entry.publicJwk)
    };
  }
}

async function generateStoredKey(keyId: string): Promise<StoredSigningKey> {
  const pair = await generateKeyPair("ES256", { extractable: true });
  const privateJwk = await exportJWK(pair.privateKey);
  const publicJwk = await exportJWK(pair.publicKey);
  return {
    keyId,
    privateJwk: { ...privateJwk, kid: keyId, alg: "ES256", use: "sig" },
    publicJwk: { ...publicJwk, kid: keyId, alg: "ES256", use: "sig" },
    verificationExpiresAt: null
  };
}

async function importStoredKey(
  stored: StoredSigningKey
): Promise<SigningKeyRecord> {
  const privateKey = await importJWK(stored.privateJwk, "ES256", {
    extractable: false
  });
  const publicKey = await importJWK(stored.publicJwk, "ES256", {
    extractable: false
  });
  if (
    !(privateKey instanceof CryptoKey) ||
    !(publicKey instanceof CryptoKey) ||
    privateKey.extractable ||
    publicKey.extractable
  ) {
    throw new Error("Forge signing keys must be non-extractable in memory.");
  }
  return {
    keyId: stored.keyId,
    algorithm: "ES256",
    privateKey,
    publicKey,
    publicJwk: stored.publicJwk,
    verificationExpiresAt: stored.verificationExpiresAt
  };
}

export class FileSigningKeyProvider extends SigningKeyProviderBase {
  private initialized = false;

  constructor(
    issuer: string,
    private readonly keyFilePath: string,
    private readonly maximumVerificationOverlapSeconds = 15 * 60
  ) {
    super(issuer);
  }

  async initialize(initialKeyId = "forge-signing-key-1") {
    if (this.initialized) {
      return;
    }
    await mkdir(path.dirname(this.keyFilePath), {
      recursive: true,
      mode: 0o700
    });
    const directory = await lstat(path.dirname(this.keyFilePath));
    const currentUserId = process.getuid?.();
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      (directory.mode & 0o077) !== 0 ||
      (currentUserId !== undefined && directory.uid !== currentUserId)
    ) {
      throw new Error(
        "Forge signing-key directory must be an owner-only real directory."
      );
    }
    try {
      await access(this.keyFilePath, constants.F_OK);
    } catch {
      await this.persist({
        version: 1,
        activeKeyId: initialKeyId,
        keys: [await generateStoredKey(initialKeyId)]
      });
    }
    await this.load();
  }

  async rotate(keyId: string, rotatedAt = new Date()) {
    await this.ensureInitialized();
    const current = await this.readStoredFile();
    if (current.keys.some((entry) => entry.keyId === keyId)) {
      throw new Error("Forge signing key id already exists.");
    }
    const previous = current.keys.find(
      (entry) => entry.keyId === current.activeKeyId
    );
    if (!previous) {
      throw new Error("Forge active signing key is missing.");
    }
    previous.verificationExpiresAt = new Date(
      rotatedAt.getTime() + this.maximumVerificationOverlapSeconds * 1000
    ).toISOString();
    current.keys.push(await generateStoredKey(keyId));
    current.activeKeyId = keyId;
    await this.persist(current);
    await this.load();
    return this.activeKey;
  }

  protected async ensureInitialized() {
    await this.initialize();
  }

  private async readStoredFile() {
    const metadata = await lstat(this.keyFilePath);
    const currentUserId = process.getuid?.();
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o177) !== 0 ||
      (currentUserId !== undefined && metadata.uid !== currentUserId)
    ) {
      throw new Error(
        "Forge signing-key storage must be an owner-only regular file."
      );
    }
    const parsed: unknown = JSON.parse(
      await readFile(this.keyFilePath, "utf8")
    );
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as StoredSigningKeyFile).version !== 1 ||
      typeof (parsed as StoredSigningKeyFile).activeKeyId !== "string" ||
      !Array.isArray((parsed as StoredSigningKeyFile).keys)
    ) {
      throw new Error("Forge signing-key storage is invalid.");
    }
    return parsed as StoredSigningKeyFile;
  }

  private async load() {
    const stored = await this.readStoredFile();
    const records = await Promise.all(stored.keys.map(importStoredKey));
    const next = new Map(records.map((record) => [record.keyId, record]));
    const active = next.get(stored.activeKeyId);
    if (!active) {
      throw new Error("Forge active signing key is missing.");
    }
    this.verificationKeys.clear();
    for (const [keyId, record] of next) {
      this.verificationKeys.set(keyId, record);
    }
    this.activeKey = active;
    this.initialized = true;
  }

  private async persist(contents: StoredSigningKeyFile) {
    const temporaryPath = `${this.keyFilePath}.${process.pid}.${randomUUID()}.new`;
    try {
      await writeFile(temporaryPath, JSON.stringify(contents), {
        mode: 0o600,
        flag: "wx"
      });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, this.keyFilePath);
      await chmod(this.keyFilePath, 0o600);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}

/**
 * Test-only fixture. Runtime composition must use FileSigningKeyProvider or a
 * platform keystore-backed implementation of SigningKeyProvider.
 */
export class InMemorySigningKeyProvider extends SigningKeyProviderBase {
  private initialized = false;

  async initialize(keyId = "forge-test-key-1") {
    if (this.initialized) {
      return this.activeKey;
    }
    const stored = await generateStoredKey(keyId);
    const record = await importStoredKey(stored);
    this.activeKey = record;
    this.verificationKeys.set(keyId, record);
    this.initialized = true;
    return record;
  }

  async rotate(keyId: string) {
    await this.ensureInitialized();
    const stored = await generateStoredKey(keyId);
    const current = await importStoredKey(stored);
    const previous = this.activeKey;
    this.activeKey = current;
    this.verificationKeys.set(keyId, current);
    return { previous, current };
  }

  protected async ensureInitialized() {
    await this.initialize();
  }
}
