import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

  sealJson(value: Record<string, unknown>) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.getEncryptionKey(), iv);
    const plaintext = Buffer.from(JSON.stringify(value), "utf8");
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
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
    const keyPath = path.join(this.rootDir, "data", ".forge-secrets.key");
    mkdirSync(path.dirname(keyPath), { recursive: true });
    if (!existsSync(keyPath)) {
      writeFileSync(keyPath, randomBytes(32).toString("base64"), { encoding: "utf8", mode: 0o600 });
    }
    const encoded = readFileSync(keyPath, "utf8").trim();
    const rawKey = Buffer.from(encoded, "base64");
    this.cachedKey = rawKey.length === 32 ? rawKey : createHash("sha256").update(rawKey).digest();
    return this.cachedKey;
  }
}
