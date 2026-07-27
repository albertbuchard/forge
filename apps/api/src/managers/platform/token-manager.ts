import { AbstractAuditedManager } from "../base.js";
import type { AuthContext } from "../contracts.js";
import {
  createAgentToken,
  getAgentTokenById,
  revokeAgentToken,
  rotateAgentToken,
  verifyAgentToken
} from "../../repositories/settings.js";
import type {
  LegacyTokenMigrationService,
  LegacyTokenTransport
} from "../../security/legacy-token-migration.js";
import type { CreateAgentTokenInput } from "../../types.js";
import type { AuditManager } from "./audit-manager.js";

export class TokenManager extends AbstractAuditedManager {
  readonly name = "TokenManager";
  private legacyMigration: LegacyTokenMigrationService | null = null;

  constructor(private readonly auditManager: AuditManager) {
    super();
  }

  configureLegacyMigration(service: LegacyTokenMigrationService) {
    if (this.legacyMigration) {
      throw new Error("Legacy-token migration is already configured.");
    }
    this.legacyMigration = service;
  }

  verifyBearerToken(
    token: string,
    transport: LegacyTokenTransport = "other_network"
  ) {
    const verified = verifyAgentToken(token);
    return verified &&
      (!this.legacyMigration ||
        this.legacyMigration.authorize(verified, transport))
      ? verified
      : null;
  }

  issueLocalAgentToken(
    input: CreateAgentTokenInput,
    context: AuthContext,
    transport: LegacyTokenTransport = "other_network"
  ) {
    if (this.legacyMigration && !this.legacyMigration.canCreate(transport)) {
      throw new Error(
        "Legacy bearer-token creation is disabled at the current Forge rollout gate. Pair a scoped client instead."
      );
    }
    const created = createAgentToken(input, {
      actor: context.actor,
      source: context.source
    });
    this.legacyMigration?.register(created.tokenSummary);
    this.auditManager.record(
      "token.issued",
      "agent_token",
      created.tokenSummary.id,
      context,
      {
        label: created.tokenSummary.label
      }
    );
    return created;
  }

  rotateLocalAgentToken(
    tokenId: string,
    context: AuthContext,
    transport: LegacyTokenTransport = "other_network"
  ) {
    const current = getAgentTokenById(tokenId);
    if (
      this.legacyMigration &&
      (!current || !this.legacyMigration.authorize(current, transport))
    ) {
      throw new Error(
        "This legacy bearer token is outside its migration window and cannot be rotated."
      );
    }
    const rotated = rotateAgentToken(tokenId, {
      actor: context.actor,
      source: context.source
    });
    if (rotated) {
      this.auditManager.record(
        "token.rotated",
        "agent_token",
        tokenId,
        context
      );
    }
    return rotated;
  }

  revokeLocalAgentToken(tokenId: string, context: AuthContext) {
    const revoked = revokeAgentToken(tokenId, {
      actor: context.actor,
      source: context.source
    });
    if (revoked) {
      this.legacyMigration?.revoke(tokenId, revoked.revokedAt ?? undefined);
      this.auditManager.record(
        "token.revoked",
        "agent_token",
        tokenId,
        context
      );
    }
    return revoked;
  }

  getTokenById(tokenId: string) {
    return getAgentTokenById(tokenId) ?? null;
  }
}
