import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type SecurityClock = {
  now(): Date;
};

export const systemSecurityClock: SecurityClock = {
  now: () => new Date()
};

export type OpaqueSecretSource = {
  bytes(length: number): Uint8Array;
};

export const systemOpaqueSecretSource: OpaqueSecretSource = {
  bytes: (length) => randomBytes(length)
};

function base64Url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64url");
}

export class KeyedSecretDigester {
  constructor(private readonly key: Uint8Array) {
    if (key.byteLength < 32) {
      throw new Error(
        "Forge secret digest keys must contain at least 256 bits."
      );
    }
  }

  digest(purpose: string, secret: string) {
    return createHmac("sha256", this.key)
      .update(`forge:${purpose}:`, "utf8")
      .update(secret, "utf8")
      .digest("base64url");
  }

  matches(purpose: string, secret: string, expectedDigest: string) {
    const actual = Buffer.from(this.digest(purpose, secret));
    const expected = Buffer.from(expectedDigest);
    return (
      actual.byteLength === expected.byteLength &&
      timingSafeEqual(actual, expected)
    );
  }
}

export function createOpaqueSecret(
  source: OpaqueSecretSource,
  prefix: string,
  byteLength = 32
) {
  if (byteLength < 32) {
    throw new Error("Forge opaque credentials must contain at least 256 bits.");
  }
  return `${prefix}_${base64Url(source.bytes(byteLength))}`;
}

const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";

export function createHumanUserCode(source: OpaqueSecretSource) {
  const bytes = source.bytes(8);
  const characters = Array.from(bytes, (byte) => USER_CODE_ALPHABET[byte % 20]);
  return `${characters.slice(0, 4).join("")}-${characters.slice(4).join("")}`;
}

export function normalizeHumanUserCode(value: string) {
  return value
    .toUpperCase()
    .split("")
    .filter((character) => USER_CODE_ALPHABET.includes(character))
    .join("");
}
