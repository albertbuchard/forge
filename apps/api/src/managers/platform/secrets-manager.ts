import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import {
  closeSync,
  constants as fileConstants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { AbstractManager } from "../base.js";

export class SecretsManager extends AbstractManager {
  readonly name = "SecretsManager";
  private rootDir = process.cwd();
  private cachedKey: Buffer | null = null;

  configure(rootDir?: string | null) {
    this.rootDir = rootDir ?? process.cwd();
    this.cachedKey = null;
  }

  createSecret(prefix: string) {
    return `${prefix}_${randomBytes(18).toString("hex")}`;
  }

  hashSecret(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  secureEquals(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  deriveKey(purpose: string, length = 32) {
    return this.derivePurposeKey(this.getEncryptionKey(), purpose, length);
  }

  deriveExistingCanonicalKey(purpose: string, length = 32) {
    return this.derivePurposeKey(
      this.readExistingCanonicalEncryptionKey(),
      purpose,
      length
    );
  }

  private derivePurposeKey(key: Uint8Array, purpose: string, length: number) {
    const normalizedPurpose = purpose.trim();
    if (!normalizedPurpose || normalizedPurpose.length > 240) {
      throw new Error("Secret-key purpose must contain 1 to 240 characters");
    }
    if (!Number.isInteger(length) || length < 16 || length > 64) {
      throw new Error("Derived secret keys must contain 16 to 64 bytes");
    }
    return new Uint8Array(
      createHmac("sha512", key)
        .update("forge-purpose-key/v1\0", "utf8")
        .update(normalizedPurpose, "utf8")
        .digest()
        .subarray(0, length)
    );
  }

  private getCanonicalKeyPath() {
    return path.join(this.rootDir, ".forge-secrets.key");
  }

  private getLegacyKeyPath() {
    return path.join(this.rootDir, "data", ".forge-secrets.key");
  }

  private getPreferredKeyPath() {
    const canonicalKeyPath = this.getCanonicalKeyPath();
    if (existsSync(canonicalKeyPath)) {
      return canonicalKeyPath;
    }
    const legacyKeyPath = this.getLegacyKeyPath();
    if (existsSync(legacyKeyPath)) {
      return legacyKeyPath;
    }
    return canonicalKeyPath;
  }

  sealJson(value: Record<string, unknown>) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.getEncryptionKey(), iv);
    const plaintext = Buffer.from(JSON.stringify(value), "utf8");
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      iv.toString("base64"),
      tag.toString("base64"),
      encrypted.toString("base64")
    ].join(".");
  }

  openJson<T extends Record<string, unknown>>(cipherText: string): T {
    const [ivEncoded, tagEncoded, payloadEncoded] = cipherText.split(".");
    if (!ivEncoded || !tagEncoded || !payloadEncoded) {
      throw new Error("Malformed encrypted secret payload");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.getEncryptionKey(),
      Buffer.from(ivEncoded, "base64")
    );
    decipher.setAuthTag(Buffer.from(tagEncoded, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payloadEncoded, "base64")),
      decipher.final()
    ]);
    return JSON.parse(decrypted.toString("utf8")) as T;
  }

  private getEncryptionKey() {
    if (this.cachedKey) {
      return this.cachedKey;
    }
    const keyPath = this.getPreferredKeyPath();
    mkdirSync(path.dirname(keyPath), { recursive: true });
    if (!existsSync(keyPath)) {
      writeFileSync(keyPath, randomBytes(32).toString("base64"), {
        encoding: "utf8",
        mode: 0o600
      });
    }
    const encoded = readFileSync(keyPath, "utf8").trim();
    const rawKey = Buffer.from(encoded, "base64");
    this.cachedKey =
      rawKey.length === 32
        ? rawKey
        : createHash("sha256").update(rawKey).digest();
    return this.cachedKey;
  }

  private readExistingCanonicalEncryptionKey() {
    const keyPath = this.getCanonicalKeyPath();
    if (!existsSync(keyPath)) {
      throw new Error("Forge's existing secret key was not found.");
    }
    const metadata = lstatSync(keyPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(
        "Forge's existing secret key must be a regular file, not a link."
      );
    }
    if (process.platform === "win32") {
      throw new Error(
        "Read-only Forge key verification is not yet available on Windows."
      );
    }
    let handle: number;
    try {
      handle = openSync(
        keyPath,
        fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW
      );
    } catch {
      throw new Error(
        "Forge's existing secret key must be a regular file, not a link."
      );
    }
    let encoded: string;
    try {
      const openedMetadata = fstatSync(handle);
      if (
        !process.getuid ||
        !openedMetadata.isFile() ||
        openedMetadata.uid !== process.getuid() ||
        (openedMetadata.mode & 0o077) !== 0
      ) {
        throw new Error(
          "Forge's existing secret key must be owned by the current user and inaccessible to other users."
        );
      }
      encoded = readFileSync(handle, "utf8").trim();
    } finally {
      closeSync(handle);
    }
    if (!/^[A-Za-z0-9+/]{43}=$/u.test(encoded)) {
      throw new Error("Forge's existing secret key is malformed.");
    }
    const rawKey = Buffer.from(encoded, "base64");
    if (rawKey.length !== 32 || rawKey.toString("base64") !== encoded) {
      throw new Error("Forge's existing secret key is malformed.");
    }
    return rawKey;
  }
}
