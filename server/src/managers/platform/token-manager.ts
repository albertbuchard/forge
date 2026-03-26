import { AbstractAuditedManager } from "../base.js";
import type { AuthContext } from "../contracts.js";
import { createAgentToken, getAgentTokenById, revokeAgentToken, rotateAgentToken, verifyAgentToken } from "../../repositories/settings.js";
import type { CreateAgentTokenInput } from "../../types.js";
import type { AuditManager } from "./audit-manager.js";

export class TokenManager extends AbstractAuditedManager {
  readonly name = "TokenManager";

  constructor(private readonly auditManager: AuditManager) {
    super();
  }

  verifyBearerToken(token: string) {
    return verifyAgentToken(token);
  }

  issueLocalAgentToken(input: CreateAgentTokenInput, context: AuthContext) {
    const created = createAgentToken(input, { actor: context.actor, source: context.source });
    this.auditManager.record("token.issued", "agent_token", created.tokenSummary.id, context, {
      label: created.tokenSummary.label
    });
    return created;
  }

  rotateLocalAgentToken(tokenId: string, context: AuthContext) {
    const rotated = rotateAgentToken(tokenId, { actor: context.actor, source: context.source });
    if (rotated) {
      this.auditManager.record("token.rotated", "agent_token", tokenId, context);
    }
    return rotated;
  }

  revokeLocalAgentToken(tokenId: string, context: AuthContext) {
    const revoked = revokeAgentToken(tokenId, { actor: context.actor, source: context.source });
    if (revoked) {
      this.auditManager.record("token.revoked", "agent_token", tokenId, context);
    }
    return revoked;
  }

  getTokenById(tokenId: string) {
    return getAgentTokenById(tokenId) ?? null;
  }
}
