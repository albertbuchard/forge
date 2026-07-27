import type {
  OwnerChannelAuthority,
  VerifiedOwnerChannel
} from "./owner-channel.js";
import type {
  OwnerWebAuthnAuthority,
  VerifiedOwnerWebAuthn
} from "./owner-webauthn.js";
import type { SecurityClock } from "./security-runtime.js";
import type {
  BrowserSessionService,
  VerifiedBrowserSession
} from "./browser-session-service.js";

export type OwnerAuthenticator = {
  credentialId: string;
  ownerUserId: string;
  label: string;
  origin: string;
  relyingPartyId: string;
  enrolledAt: string;
  revokedAt: string | null;
};

export type OwnerSecurityRepository = {
  readOwnerSecurityEpoch(ownerId: string): number | null;
  createOwnerAuthenticator(record: OwnerAuthenticator): boolean;
  readOwnerAuthenticator(
    ownerId: string,
    credentialId: string
  ): OwnerAuthenticator | null;
  listOwnerAuthenticators(ownerId: string): OwnerAuthenticator[];
  recoverOwnerSecurity(input: {
    ownerId: string;
    lostCredentialIds: readonly string[];
    replacement: OwnerAuthenticator;
    recoveredAt: string;
  }): number;
};

declare const privilegedPairingAuthorizationBrand: unique symbol;

export type PrivilegedPairingAuthorization = {
  readonly ownerUserId: string;
  readonly credentialId: string;
  readonly requestId: string;
  readonly ownerSecurityEpoch: number;
  readonly authenticatedAt: string;
  readonly [privilegedPairingAuthorizationBrand]: true;
};

export class OwnerStepUpService<Input> {
  private readonly unusedPairingAuthorizations = new WeakSet<object>();

  constructor(
    private readonly clock: SecurityClock,
    private readonly ownerChannel: OwnerChannelAuthority,
    private readonly webAuthn: OwnerWebAuthnAuthority<Input>,
    private readonly repository: OwnerSecurityRepository,
    private readonly expectedOrigin: string | null,
    private readonly relyingPartyId: string | null,
    private readonly browserSessions: BrowserSessionService | null = null
  ) {}

  enroll(input: {
    ownerEvidence: VerifiedOwnerChannel;
    webAuthnEvidence: VerifiedOwnerWebAuthn;
    label: string;
  }) {
    const binding = this.requireConfiguredBinding();
    this.ownerChannel.assertVerified(input.ownerEvidence);
    this.webAuthn.consume(input.webAuthnEvidence, {
      ownerUserId: this.ownerChannel.ownerUserId,
      origin: binding.origin,
      relyingPartyId: binding.relyingPartyId,
      purpose: "owner_authenticator_enrollment"
    });
    const record: OwnerAuthenticator = {
      credentialId: input.webAuthnEvidence.credentialId,
      ownerUserId: this.ownerChannel.ownerUserId,
      label: input.label,
      origin: input.webAuthnEvidence.origin,
      relyingPartyId: input.webAuthnEvidence.relyingPartyId,
      enrolledAt: this.clock.now().toISOString(),
      revokedAt: null
    };
    if (!this.repository.createOwnerAuthenticator(record)) {
      throw new Error("Forge owner authenticator is already registered.");
    }
    return {
      ...record,
      ownerSecurityEpoch: this.requireOwnerEpoch()
    };
  }

  authorizePrivilegedPairing(input: {
    webAuthnEvidence: VerifiedOwnerWebAuthn;
    expectedOwnerSecurityEpoch: number;
    requestId: string;
  }) {
    const binding = this.requireConfiguredBinding();
    this.webAuthn.consume(input.webAuthnEvidence, {
      ownerUserId: this.ownerChannel.ownerUserId,
      origin: binding.origin,
      relyingPartyId: binding.relyingPartyId,
      purpose: "privileged_pairing"
    });
    const authenticator = this.repository.readOwnerAuthenticator(
      this.ownerChannel.ownerUserId,
      input.webAuthnEvidence.credentialId
    );
    const ownerSecurityEpoch = this.requireOwnerEpoch();
    if (
      !authenticator ||
      authenticator.revokedAt ||
      !/^pair_[A-Za-z0-9-]{16,160}$/.test(input.requestId) ||
      input.expectedOwnerSecurityEpoch !== ownerSecurityEpoch
    ) {
      throw new Error("Forge owner step-up credential is revoked or stale.");
    }
    const authorization = {
      ownerUserId: this.ownerChannel.ownerUserId,
      credentialId: authenticator.credentialId,
      requestId: input.requestId,
      ownerSecurityEpoch,
      authenticatedAt: this.clock.now().toISOString()
    } as PrivilegedPairingAuthorization;
    this.unusedPairingAuthorizations.add(authorization);
    return authorization;
  }

  authorizePrivilegedPairingFromBrowser(input: {
    session: VerifiedBrowserSession;
    webAuthnEvidence: VerifiedOwnerWebAuthn;
    requestId: string;
    credentialLabel: string;
    expectedOrigin: string;
    relyingPartyId: string;
  }) {
    if (!this.browserSessions) {
      throw new Error(
        "Forge owner browser step-up is unavailable in this runtime."
      );
    }
    const principal = input.session.principal;
    this.webAuthn.consume(input.webAuthnEvidence, {
      ownerUserId: this.ownerChannel.ownerUserId,
      origin: input.expectedOrigin,
      relyingPartyId: input.relyingPartyId,
      purpose: "privileged_pairing"
    });
    if (
      principal.kind !== "operator_session" ||
      principal.profile !== "operator" ||
      principal.clientId !== null ||
      principal.installationId !== null ||
      principal.clientSecurityEpoch !== null ||
      principal.ownerId !== this.ownerChannel.ownerUserId ||
      principal.ownerSecurityEpoch !== this.requireOwnerEpoch() ||
      !/^pair_[A-Za-z0-9-]{16,160}$/.test(input.requestId)
    ) {
      throw new Error("Forge owner browser step-up is stale or mismatched.");
    }
    let authenticator = this.repository.readOwnerAuthenticator(
      principal.ownerId,
      input.webAuthnEvidence.credentialId
    );
    if (!authenticator) {
      const record: OwnerAuthenticator = {
        credentialId: input.webAuthnEvidence.credentialId,
        ownerUserId: principal.ownerId,
        label: input.credentialLabel.trim().slice(0, 120),
        origin: input.webAuthnEvidence.origin,
        relyingPartyId: input.webAuthnEvidence.relyingPartyId,
        enrolledAt: this.clock.now().toISOString(),
        revokedAt: null
      };
      if (!record.label || !this.repository.createOwnerAuthenticator(record)) {
        throw new Error(
          "Forge could not register the verified owner authenticator."
        );
      }
      authenticator = record;
    }
    if (
      authenticator.revokedAt ||
      authenticator.origin !== input.expectedOrigin ||
      authenticator.relyingPartyId !== input.relyingPartyId
    ) {
      throw new Error("Forge owner step-up credential is revoked or stale.");
    }
    const authorization = {
      ownerUserId: principal.ownerId,
      credentialId: authenticator.credentialId,
      requestId: input.requestId,
      ownerSecurityEpoch: principal.ownerSecurityEpoch,
      authenticatedAt: this.clock.now().toISOString()
    } as PrivilegedPairingAuthorization;
    this.unusedPairingAuthorizations.add(authorization);
    return authorization;
  }

  consumePrivilegedPairingAuthorization(
    authorization: PrivilegedPairingAuthorization,
    expectedRequestId: string
  ) {
    const authenticatedAt = Date.parse(authorization.authenticatedAt);
    if (
      !this.unusedPairingAuthorizations.delete(authorization) ||
      authorization.ownerUserId !== this.ownerChannel.ownerUserId ||
      authorization.requestId !== expectedRequestId ||
      authorization.ownerSecurityEpoch !== this.requireOwnerEpoch() ||
      !Number.isFinite(authenticatedAt) ||
      Math.abs(this.clock.now().getTime() - authenticatedAt) > 2 * 60_000
    ) {
      throw new Error(
        "Forge privileged pairing authorization is forged, replayed, or stale."
      );
    }
    return authorization;
  }

  replaceLostAuthenticator(input: {
    ownerEvidence: VerifiedOwnerChannel;
    webAuthnEvidence: VerifiedOwnerWebAuthn;
    lostCredentialIds: readonly string[];
    replacementLabel: string;
  }) {
    const binding = this.requireConfiguredBinding();
    this.ownerChannel.assertVerified(input.ownerEvidence);
    this.webAuthn.consume(input.webAuthnEvidence, {
      ownerUserId: this.ownerChannel.ownerUserId,
      origin: binding.origin,
      relyingPartyId: binding.relyingPartyId,
      purpose: "owner_recovery"
    });
    const recoveredAt = this.clock.now().toISOString();
    const replacement: OwnerAuthenticator = {
      credentialId: input.webAuthnEvidence.credentialId,
      ownerUserId: this.ownerChannel.ownerUserId,
      label: input.replacementLabel,
      origin: input.webAuthnEvidence.origin,
      relyingPartyId: input.webAuthnEvidence.relyingPartyId,
      enrolledAt: recoveredAt,
      revokedAt: null
    };
    const ownerSecurityEpoch = this.repository.recoverOwnerSecurity({
      ownerId: this.ownerChannel.ownerUserId,
      lostCredentialIds: input.lostCredentialIds,
      replacement,
      recoveredAt
    });
    return { ...replacement, ownerSecurityEpoch };
  }

  inventory() {
    return {
      ownerUserId: this.ownerChannel.ownerUserId,
      ownerSecurityEpoch: this.requireOwnerEpoch(),
      authenticators: this.repository.listOwnerAuthenticators(
        this.ownerChannel.ownerUserId
      )
    };
  }

  private requireOwnerEpoch() {
    const epoch = this.repository.readOwnerSecurityEpoch(
      this.ownerChannel.ownerUserId
    );
    if (!epoch) {
      throw new Error("Forge owner security state is unavailable.");
    }
    return epoch;
  }

  private requireConfiguredBinding() {
    if (!this.expectedOrigin || !this.relyingPartyId) {
      throw new Error(
        "Forge owner authenticator operation requires an exact configured origin."
      );
    }
    return {
      origin: this.expectedOrigin,
      relyingPartyId: this.relyingPartyId
    };
  }
}
