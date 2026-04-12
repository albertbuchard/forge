import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AbstractManager } from "../base.js";
export class SecretsManager extends AbstractManager {
    name = "SecretsManager";
    rootDir = process.cwd();
    cachedKey = null;
    configure(rootDir) {
        this.rootDir = rootDir ?? process.cwd();
        this.cachedKey = null;
    }
    createSecret(prefix) {
        return `${prefix}_${randomBytes(18).toString("hex")}`;
    }
    hashSecret(value) {
        return createHash("sha256").update(value).digest("hex");
    }
    secureEquals(left, right) {
        const leftBuffer = Buffer.from(left);
        const rightBuffer = Buffer.from(right);
        if (leftBuffer.length !== rightBuffer.length) {
            return false;
        }
        return timingSafeEqual(leftBuffer, rightBuffer);
    }
    getCanonicalKeyPath() {
        return path.join(this.rootDir, ".forge-secrets.key");
    }
    getLegacyKeyPath() {
        return path.join(this.rootDir, "data", ".forge-secrets.key");
    }
    getPreferredKeyPath() {
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
    sealJson(value) {
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", this.getEncryptionKey(), iv);
        const plaintext = Buffer.from(JSON.stringify(value), "utf8");
        const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const tag = cipher.getAuthTag();
        return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
    }
    openJson(cipherText) {
        const [ivEncoded, tagEncoded, payloadEncoded] = cipherText.split(".");
        if (!ivEncoded || !tagEncoded || !payloadEncoded) {
            throw new Error("Malformed encrypted secret payload");
        }
        const decipher = createDecipheriv("aes-256-gcm", this.getEncryptionKey(), Buffer.from(ivEncoded, "base64"));
        decipher.setAuthTag(Buffer.from(tagEncoded, "base64"));
        const decrypted = Buffer.concat([
            decipher.update(Buffer.from(payloadEncoded, "base64")),
            decipher.final()
        ]);
        return JSON.parse(decrypted.toString("utf8"));
    }
    getEncryptionKey() {
        if (this.cachedKey) {
            return this.cachedKey;
        }
        const keyPath = this.getPreferredKeyPath();
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
