import {
  verifyPeerWebAuthnCeremony,
  type BoundOwnerWebAuthnVerificationInput,
  type PeerWebAuthnCredentialRecord,
  type PeerWebAuthnVerificationInput
} from "../services/peer-webauthn.js";
import type { SecurityClock } from "./security-runtime.js";

declare const verifiedOwnerWebAuthnBrand: unique symbol;

export type OwnerWebAuthnPurpose =
  | "owner_authenticator_enrollment"
  | "privileged_pairing"
  | "owner_recovery";

export type VerifiedOwnerWebAuthn = {
  readonly ownerUserId: string;
  readonly credentialId: string;
  readonly origin: string;
  readonly relyingPartyId: string;
  readonly purpose: OwnerWebAuthnPurpose;
  readonly verifiedAt: string;
  readonly [verifiedOwnerWebAuthnBrand]: true;
};

type CryptographicVerificationResult = {
  ownerUserId: string;
  credential: PeerWebAuthnCredentialRecord;
  origin: string;
};

export class OwnerWebAuthnAuthority<Input> {
  private readonly unusedEvidence = new WeakSet<object>();

  constructor(
    private readonly clock: SecurityClock,
    private readonly verifyCryptographically: (
      input: Input
    ) => Promise<CryptographicVerificationResult>
  ) {}

  async verify(
    purpose: OwnerWebAuthnPurpose,
    input: Input
  ): Promise<VerifiedOwnerWebAuthn> {
    const verified = await this.verifyCryptographically(input);
    if (
      verified.credential.ownerUserId !== verified.ownerUserId ||
      !verified.credential.credentialId ||
      !verified.credential.rpId
    ) {
      throw new Error(
        "Forge WebAuthn verifier returned an invalid owner binding."
      );
    }
    const evidence = {
      ownerUserId: verified.ownerUserId,
      credentialId: verified.credential.credentialId,
      origin: verified.origin,
      relyingPartyId: verified.credential.rpId,
      purpose,
      verifiedAt: this.clock.now().toISOString()
    } as VerifiedOwnerWebAuthn;
    this.unusedEvidence.add(evidence);
    return evidence;
  }

  consume(
    evidence: VerifiedOwnerWebAuthn,
    expected: {
      ownerUserId: string;
      origin: string;
      relyingPartyId: string;
      purpose: OwnerWebAuthnPurpose;
    }
  ) {
    if (
      !this.unusedEvidence.delete(evidence) ||
      evidence.ownerUserId !== expected.ownerUserId ||
      evidence.origin !== expected.origin ||
      evidence.relyingPartyId !== expected.relyingPartyId ||
      evidence.purpose !== expected.purpose
    ) {
      throw new Error(
        "Forge owner WebAuthn evidence is forged, replayed, or bound to another action."
      );
    }
    const verifiedAt = Date.parse(evidence.verifiedAt);
    if (
      !Number.isFinite(verifiedAt) ||
      Math.abs(this.clock.now().getTime() - verifiedAt) > 2 * 60_000
    ) {
      throw new Error("Forge owner WebAuthn evidence is stale.");
    }
  }
}

export type PeerOwnerWebAuthnVerificationInput = {
  ceremony: PeerWebAuthnVerificationInput;
};

export function createPeerOwnerWebAuthnAuthority(clock: SecurityClock) {
  return new OwnerWebAuthnAuthority<PeerOwnerWebAuthnVerificationInput>(
    clock,
    async ({ ceremony }) => {
      const result =
        ceremony.action === undefined
          ? await verifyPeerWebAuthnCeremony(
              ceremony as BoundOwnerWebAuthnVerificationInput
            )
          : await verifyPeerWebAuthnCeremony(ceremony);
      return {
        ownerUserId: ceremony.principal.ownerUserId,
        credential: result.credential,
        origin: ceremony.origin
      };
    }
  );
}
