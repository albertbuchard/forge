import { createHash } from "node:crypto";

import type { SecretsManager } from "../managers/platform/secrets-manager.js";
import { SqlitePeerPresenceStore } from "../repositories/peer-presence.js";
import {
  createPeerWebAuthnOptions,
  resolvePeerWebAuthnRelyingParty
} from "../services/peer-webauthn.js";
import type { VerifiedBrowserSession } from "./browser-session-service.js";
import { OwnerChannelAuthority } from "./owner-channel.js";
import {
  OwnerStepUpService,
  type PrivilegedPairingAuthorization
} from "./owner-step-up-service.js";
import {
  createPeerOwnerWebAuthnAuthority,
  type OwnerWebAuthnAuthority,
  type PeerOwnerWebAuthnVerificationInput
} from "./owner-webauthn.js";
import type { ServerPairingReview } from "./pairing-review.js";
import type { SqliteSecurityStore } from "./sqlite-security-store.js";
import {
  systemSecurityClock,
  type SecurityClock
} from "./security-runtime.js";

export type PrivilegedPairingReview = ServerPairingReview;

function exactPairingActionDigest(input: {
  ownerId: string;
  review: PrivilegedPairingReview;
}) {
  return createHash("sha256")
    .update("forge/privileged-pairing-step-up/v1\0", "utf8")
    .update(
      JSON.stringify({
        ownerId: input.ownerId,
        requestId: input.review.requestId,
        clientName: input.review.clientName,
        clientType: input.review.clientType,
        audience: input.review.audience,
        scopes: [...input.review.requestedScopes],
        profile: input.review.requestedProfile,
        expiresAt: input.review.expiresAt,
        installationFingerprint: input.review.installationFingerprint,
        endpoint: input.review.endpoint,
        boundaries: input.review.boundaries
      }),
      "utf8"
    )
    .digest("hex");
}

export class PrivilegedPairingStepUp {
  private readonly store: SqlitePeerPresenceStore;
  private readonly challengeHashingKey: Uint8Array;
  private readonly ownerWebAuthn: OwnerWebAuthnAuthority<PeerOwnerWebAuthnVerificationInput>;
  readonly authorizations: OwnerStepUpService<PeerOwnerWebAuthnVerificationInput>;

  constructor(
    private readonly clock: SecurityClock,
    secrets: SecretsManager,
    ownerId: string,
    securityStore: SqliteSecurityStore,
    browserSessions: import("./browser-session-service.js").BrowserSessionService
  ) {
    this.ownerWebAuthn = createPeerOwnerWebAuthnAuthority(this.clock);
    this.challengeHashingKey = secrets.deriveKey(
      "security-privileged-pairing-webauthn-challenges/v1"
    );
    this.store = new SqlitePeerPresenceStore(
      secrets.deriveKey(
        "security-privileged-pairing-session-binding/v1"
      )
    );
    this.authorizations = new OwnerStepUpService(
      this.clock,
      new OwnerChannelAuthority(this.clock, ownerId),
      this.ownerWebAuthn,
      securityStore,
      null,
      null,
      browserSessions
    );
  }

  async createOptions(input: {
    session: VerifiedBrowserSession;
    origin: string;
    review: PrivilegedPairingReview;
    credentialLabel?: string;
  }) {
    const relyingParty = resolvePeerWebAuthnRelyingParty(input.origin);
    const principal = this.requireOwnerSession(input.session, relyingParty.origin);
    const credentials = this.store.listActiveCredentials(
      principal.ownerUserId,
      relyingParty.rpId
    );
    const ceremony = credentials.length === 0 ? "register" : "authenticate";
    const options = await createPeerWebAuthnOptions({
      ceremony,
      actionDigest: exactPairingActionDigest({
        ownerId: principal.ownerUserId,
        review: input.review
      }),
      principal,
      origin: relyingParty.origin,
      credentialLabel:
        ceremony === "register"
          ? input.credentialLabel ?? "Forge owner passkey"
          : undefined,
      hashingKey: this.challengeHashingKey,
      store: this.store,
      now: this.clock.now()
    });
    return {
      ...options,
      review: input.review
    };
  }

  async verify(input: {
    session: VerifiedBrowserSession;
    origin: string;
    review: PrivilegedPairingReview;
    challengeId: string;
    response: unknown;
    credentialLabel?: string;
  }): Promise<PrivilegedPairingAuthorization> {
    const relyingParty = resolvePeerWebAuthnRelyingParty(input.origin);
    const principal = this.requireOwnerSession(input.session, relyingParty.origin);
    const evidence = await this.ownerWebAuthn.verify("privileged_pairing", {
      ceremony: {
        challengeId: input.challengeId,
        actionDigest: exactPairingActionDigest({
          ownerId: principal.ownerUserId,
          review: input.review
        }),
        principal,
        origin: relyingParty.origin,
        response: input.response,
        challengeHashingKey: this.challengeHashingKey,
        store: this.store,
        now: this.clock.now()
      }
    });
    return this.authorizations.authorizePrivilegedPairingFromBrowser({
      session: input.session,
      webAuthnEvidence: evidence,
      requestId: input.review.requestId,
      credentialLabel:
        input.credentialLabel ?? "Forge owner passkey",
      expectedOrigin: relyingParty.origin,
      relyingPartyId: relyingParty.rpId
    });
  }

  private requireOwnerSession(
    session: VerifiedBrowserSession,
    origin: string
  ) {
    const principal = session.principal;
    if (
      principal.kind !== "operator_session" ||
      principal.profile !== "operator" ||
      principal.clientId !== null ||
      principal.installationId !== null ||
      principal.clientSecurityEpoch !== null
    ) {
      throw new Error(
        "Privileged pairing requires a locally authenticated owner session."
      );
    }
    return {
      principalClass: "operator_session" as const,
      principalId: session.sessionId,
      ownerUserId: principal.ownerId,
      origin
    };
  }
}

export function createPrivilegedPairingStepUp(input: {
  secrets: SecretsManager;
  ownerId: string;
  store: SqliteSecurityStore;
  browserSessions: import("./browser-session-service.js").BrowserSessionService;
}) {
  return new PrivilegedPairingStepUp(
    systemSecurityClock,
    input.secrets,
    input.ownerId,
    input.store,
    input.browserSessions
  );
}
