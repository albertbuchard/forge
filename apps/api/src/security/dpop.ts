import { createHash } from "node:crypto";
import {
  calculateJwkThumbprint,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type JWK,
  type JWTPayload
} from "jose";

import type { SecurityClock } from "./security-runtime.js";

type DpopPayload = JWTPayload & {
  htm: string;
  htu: string;
  ath: string;
  nonce?: string;
};

export type DpopReplayStore = {
  claim(input: {
    keyThumbprint: string;
    tokenId: string;
    now: Date;
    expiresAt: Date;
  }): boolean;
};

function canonicalTargetUri(value: string) {
  const parsed = new URL(value);
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString();
}

function accessTokenHash(accessToken: string) {
  return createHash("sha256").update(accessToken, "ascii").digest("base64url");
}

function containsPrivateJwkMaterial(jwk: JWK) {
  return ["d", "p", "q", "dp", "dq", "qi", "oth", "k"].some(
    (property) => property in jwk
  );
}

export class DpopVerifier {
  constructor(
    private readonly clock: SecurityClock,
    private readonly replayStore: DpopReplayStore,
    private readonly maximumProofAgeSeconds = 60
  ) {}

  async verify(input: {
    proof: string;
    accessToken: string;
    expectedMethod: string;
    expectedTargetUri: string;
    expectedKeyThumbprint: string;
    expectedNonce?: string;
  }) {
    const header = decodeProtectedHeader(input.proof);
    if (
      header.typ?.toLowerCase() !== "dpop+jwt" ||
      header.alg !== "ES256" ||
      !header.jwk ||
      containsPrivateJwkMaterial(header.jwk)
    ) {
      throw new Error("Forge DPoP proof header is invalid.");
    }
    const keyThumbprint = await calculateJwkThumbprint(header.jwk);
    if (keyThumbprint !== input.expectedKeyThumbprint) {
      throw new Error("Forge DPoP proof uses the wrong client key.");
    }
    const publicKey = await importJWK(header.jwk, "ES256");
    const now = this.clock.now();
    const verified = await jwtVerify(input.proof, publicKey, {
      algorithms: ["ES256"],
      typ: "dpop+jwt",
      currentDate: now,
      maxTokenAge: `${this.maximumProofAgeSeconds}s`,
      clockTolerance: 5
    });
    const payload = verified.payload as DpopPayload;
    if (
      !payload.jti ||
      typeof payload.iat !== "number" ||
      payload.htm !== input.expectedMethod.toUpperCase() ||
      canonicalTargetUri(payload.htu) !==
        canonicalTargetUri(input.expectedTargetUri) ||
      payload.ath !== accessTokenHash(input.accessToken)
    ) {
      throw new Error("Forge DPoP proof claims do not match the request.");
    }
    if (
      input.expectedNonce !== undefined &&
      payload.nonce !== input.expectedNonce
    ) {
      throw new Error("Forge DPoP proof nonce is missing or stale.");
    }
    const claimed = this.replayStore.claim({
      keyThumbprint,
      tokenId: payload.jti,
      now,
      expiresAt: new Date(
        (payload.iat + this.maximumProofAgeSeconds + 5) * 1000
      )
    });
    if (!claimed) {
      throw new Error("Forge DPoP proof was replayed.");
    }
    return { keyThumbprint, tokenId: payload.jti, issuedAt: payload.iat };
  }
}
