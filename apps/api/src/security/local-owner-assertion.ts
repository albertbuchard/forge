import { randomUUID } from "node:crypto";
import type { JWTPayload } from "jose";

import {
  type OwnerChannelAuthority,
  type VerifiedOwnerChannel
} from "./owner-channel.js";
import {
  type KeyedSecretDigester,
  type SecurityClock
} from "./security-runtime.js";
import type { SigningKeyProvider } from "./signing-key-provider.js";

export type LocalTransaction = {
  id: string;
  ownerUserId: string;
  installId: string;
  browserOrigin: string;
  browserNonceDigest: string;
  ownerSecurityEpoch: number;
  createdAt: string;
  expiresAt: string;
  assertionIssuedAt: string | null;
  exchangedAt: string | null;
};

export type LocalTransactionRepository = {
  createLocalTransaction(record: LocalTransaction): void;
  readLocalTransaction(id: string): LocalTransaction | null;
  claimLocalAssertion(input: {
    id: string;
    issuedAt: string;
    now: string;
  }): boolean;
  consumeLocalTransaction(input: {
    id: string;
    exchangedAt: string;
    now: string;
  }): boolean;
  readOwnerSecurityEpoch(ownerId: string): number | null;
};

type LocalAssertionClaims = JWTPayload & {
  type: "forge_local_owner_assertion";
  transaction_id: string;
  install_id: string;
  browser_origin: string;
  browser_nonce_digest: string;
  os_user_id: string;
  owner_epoch: number;
};

function requireLoopbackBrowserOrigin(value: string) {
  const parsed = new URL(value);
  const hostname = parsed.hostname.toLowerCase();
  const loopback =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]";
  if (
    parsed.protocol !== "http:" ||
    !loopback ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.origin !== value
  ) {
    throw new Error(
      "Forge local-owner exchange requires an exact loopback browser origin."
    );
  }
  return parsed.origin;
}

function requireBrowserNonce(value: string) {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(value)) {
    throw new Error(
      "Forge local-owner exchange requires a high-entropy browser nonce."
    );
  }
  return value;
}

export class LocalOwnerAssertionService {
  constructor(
    private readonly keys: SigningKeyProvider,
    private readonly clock: SecurityClock,
    private readonly digester: KeyedSecretDigester,
    private readonly repository: LocalTransactionRepository,
    private readonly ownerChannel: OwnerChannelAuthority,
    private readonly assertionAudience: string,
    private readonly lifetimeSeconds = 30
  ) {}

  begin(input: {
    installId: string;
    browserOrigin: string;
    browserNonce: string;
  }) {
    const ownerSecurityEpoch = this.repository.readOwnerSecurityEpoch(
      this.ownerChannel.ownerUserId
    );
    if (!ownerSecurityEpoch) {
      throw new Error("Forge owner security state is unavailable.");
    }
    const now = this.clock.now();
    const browserOrigin = requireLoopbackBrowserOrigin(input.browserOrigin);
    const browserNonce = requireBrowserNonce(input.browserNonce);
    const transaction: LocalTransaction = {
      id: `local_${randomUUID()}`,
      ownerUserId: this.ownerChannel.ownerUserId,
      installId: input.installId,
      browserOrigin,
      browserNonceDigest: this.digester.digest(
        "local-browser-nonce",
        browserNonce
      ),
      ownerSecurityEpoch,
      createdAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + this.lifetimeSeconds * 1000
      ).toISOString(),
      assertionIssuedAt: null,
      exchangedAt: null
    };
    this.repository.createLocalTransaction(transaction);
    return {
      transactionId: transaction.id,
      expiresAt: transaction.expiresAt
    };
  }

  async mintFromOwnerChannel(input: {
    transactionId: string;
    evidence: VerifiedOwnerChannel;
  }) {
    this.ownerChannel.assertVerified(input.evidence);
    const transaction = this.requirePending(input.transactionId);
    const now = this.clock.now();
    if (
      !this.repository.claimLocalAssertion({
        id: transaction.id,
        issuedAt: now.toISOString(),
        now: now.toISOString()
      })
    ) {
      throw new Error("Forge local-owner assertion was already issued.");
    }
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const claims: LocalAssertionClaims = {
      type: "forge_local_owner_assertion",
      transaction_id: transaction.id,
      install_id: transaction.installId,
      browser_origin: transaction.browserOrigin,
      browser_nonce_digest: transaction.browserNonceDigest,
      os_user_id: input.evidence.ownerUserId,
      owner_epoch: transaction.ownerSecurityEpoch
    };
    return this.keys.sign({
      audience: this.assertionAudience,
      subject: this.ownerChannel.ownerUserId,
      tokenId: `local_assertion_${randomUUID()}`,
      issuedAtSeconds: nowSeconds,
      expiresAtSeconds: nowSeconds + this.lifetimeSeconds,
      claims
    });
  }

  async exchange(input: {
    assertion: string;
    installId: string;
    browserOrigin: string;
    browserNonce: string;
  }) {
    const now = this.clock.now();
    const browserOrigin = requireLoopbackBrowserOrigin(input.browserOrigin);
    const browserNonce = requireBrowserNonce(input.browserNonce);
    const verified = await this.keys.verify(input.assertion, {
      audience: this.assertionAudience,
      nowSeconds: Math.floor(now.getTime() / 1000),
      clockToleranceSeconds: 2
    });
    const claims = verified.payload as LocalAssertionClaims;
    const currentOwnerEpoch = this.repository.readOwnerSecurityEpoch(
      this.ownerChannel.ownerUserId
    );
    if (
      claims.type !== "forge_local_owner_assertion" ||
      claims.sub !== this.ownerChannel.ownerUserId ||
      claims.install_id !== input.installId ||
      claims.browser_origin !== browserOrigin ||
      claims.browser_nonce_digest !==
        this.digester.digest("local-browser-nonce", browserNonce) ||
      claims.os_user_id !== this.ownerChannel.ownerUserId ||
      claims.owner_epoch !== currentOwnerEpoch ||
      !claims.transaction_id
    ) {
      throw new Error("Forge local-owner assertion binding is invalid.");
    }
    const transaction = this.requirePending(claims.transaction_id);
    if (!transaction.assertionIssuedAt) {
      throw new Error(
        "Forge local-owner assertion was not issued by the owner channel."
      );
    }
    if (
      !this.repository.consumeLocalTransaction({
        id: transaction.id,
        exchangedAt: now.toISOString(),
        now: now.toISOString()
      })
    ) {
      throw new Error(
        "Forge local-owner transaction is expired or already used."
      );
    }
    return {
      ownerUserId: this.ownerChannel.ownerUserId,
      transactionId: transaction.id,
      ownerSecurityEpoch: transaction.ownerSecurityEpoch
    };
  }

  private requirePending(transactionId: string) {
    const transaction = this.repository.readLocalTransaction(transactionId);
    if (
      !transaction ||
      transaction.ownerUserId !== this.ownerChannel.ownerUserId ||
      transaction.exchangedAt ||
      Date.parse(transaction.expiresAt) <= this.clock.now().getTime()
    ) {
      throw new Error(
        "Forge local-owner transaction is expired or already used."
      );
    }
    return transaction;
  }
}
