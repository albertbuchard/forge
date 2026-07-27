import { randomBytes } from "node:crypto";

import type { ForgePrincipal } from "./contracts.js";

const DEFAULT_ASSERTION_TTL_MS = 15_000;
const DEFAULT_MAXIMUM_PENDING_ASSERTIONS = 2_048;
const MAXIMUM_TARGET_BYTES = 8 * 1024;

type PendingAssertion = {
  principal: ForgePrincipal;
  target: string;
  expiresAt: number;
};

export class DevAssetProxyAssertionService {
  private readonly pending = new Map<string, PendingAssertion>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly assertionTtlMs = DEFAULT_ASSERTION_TTL_MS,
    private readonly maximumPendingAssertions = DEFAULT_MAXIMUM_PENDING_ASSERTIONS
  ) {}

  private pruneExpired() {
    const now = this.now();
    for (const [token, assertion] of this.pending) {
      if (assertion.expiresAt <= now) {
        this.pending.delete(token);
      }
    }
  }

  issue(principal: ForgePrincipal, target: string) {
    if (
      !target.startsWith("/") ||
      Buffer.byteLength(target, "utf8") > MAXIMUM_TARGET_BYTES
    ) {
      throw new Error("Forge requires a bounded development asset target.");
    }
    this.pruneExpired();
    if (this.pending.size >= this.maximumPendingAssertions) {
      throw new Error(
        "Forge has reached the pending development assertion limit."
      );
    }
    const token = randomBytes(32).toString("base64url");
    this.pending.set(token, {
      principal,
      target,
      expiresAt: this.now() + this.assertionTtlMs
    });
    return token;
  }

  consume(token: string, target: string) {
    const assertion = this.pending.get(token);
    this.pending.delete(token);
    if (
      !assertion ||
      assertion.expiresAt <= this.now() ||
      assertion.target !== target
    ) {
      return null;
    }
    return assertion.principal;
  }
}

export const forgeDevProxyAssertionHeader =
  "x-forge-dev-proxy-assertion" as const;
export const forgeDevProxyTargetHeader = "x-forge-dev-proxy-target" as const;
