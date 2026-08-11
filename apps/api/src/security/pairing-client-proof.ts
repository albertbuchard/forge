import {
  calculateJwkThumbprint,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type JWK,
  type JWTPayload
} from "jose";

import type { DpopReplayStore } from "./dpop.js";
import type { SecurityClock } from "./security-runtime.js";

type PairingProofPayload = JWTPayload & {
  request_id: string;
  operation: "poll" | "cancel" | "master_key_approve";
};

function containsPrivateJwkMaterial(jwk: JWK) {
  return ["d", "p", "q", "dp", "dq", "qi", "oth", "k"].some(
    (property) => property in jwk
  );
}

export class PairingClientProofVerifier {
  constructor(
    private readonly clock: SecurityClock,
    private readonly replayStore: DpopReplayStore,
    private readonly maximumProofAgeSeconds = 60
  ) {}

  async verify(input: {
    proof: string;
    expectedKeyThumbprint: string;
    expectedRequestId: string;
    expectedOperation: "poll" | "cancel" | "master_key_approve";
  }) {
    const header = decodeProtectedHeader(input.proof);
    if (
      header.typ?.toLowerCase() !== "forge-pairing+jwt" ||
      header.alg !== "ES256" ||
      !header.jwk ||
      containsPrivateJwkMaterial(header.jwk)
    ) {
      throw new Error("Forge pairing client proof header is invalid.");
    }
    const keyThumbprint = await calculateJwkThumbprint(header.jwk);
    if (keyThumbprint !== input.expectedKeyThumbprint) {
      throw new Error("Forge pairing client proof uses the wrong key.");
    }
    const publicKey = await importJWK(header.jwk, "ES256");
    const now = this.clock.now();
    const verified = await jwtVerify(input.proof, publicKey, {
      algorithms: ["ES256"],
      typ: "forge-pairing+jwt",
      currentDate: now,
      maxTokenAge: `${this.maximumProofAgeSeconds}s`,
      clockTolerance: 5
    });
    const payload = verified.payload as PairingProofPayload;
    if (
      !payload.jti ||
      typeof payload.iat !== "number" ||
      payload.request_id !== input.expectedRequestId ||
      payload.operation !== input.expectedOperation
    ) {
      throw new Error(
        "Forge pairing client proof is bound to another request."
      );
    }
    if (
      !this.replayStore.claim({
        keyThumbprint,
        tokenId: payload.jti,
        now,
        expiresAt: new Date(
          (payload.iat + this.maximumProofAgeSeconds + 5) * 1000
        )
      })
    ) {
      throw new Error("Forge pairing client proof was replayed.");
    }
    return { keyThumbprint, tokenId: payload.jti };
  }
}
