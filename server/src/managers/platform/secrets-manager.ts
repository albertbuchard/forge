import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AbstractManager } from "../base.js";

export class SecretsManager extends AbstractManager {
  readonly name = "SecretsManager";

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
}
