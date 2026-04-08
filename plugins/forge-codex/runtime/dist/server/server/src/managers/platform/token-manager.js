import { AbstractAuditedManager } from "../base.js";
import { createAgentToken, getAgentTokenById, revokeAgentToken, rotateAgentToken, verifyAgentToken } from "../../repositories/settings.js";
export class TokenManager extends AbstractAuditedManager {
    auditManager;
    name = "TokenManager";
    constructor(auditManager) {
        super();
        this.auditManager = auditManager;
    }
    verifyBearerToken(token) {
        return verifyAgentToken(token);
    }
    issueLocalAgentToken(input, context) {
        const created = createAgentToken(input, { actor: context.actor, source: context.source });
        this.auditManager.record("token.issued", "agent_token", created.tokenSummary.id, context, {
            label: created.tokenSummary.label
        });
        return created;
    }
    rotateLocalAgentToken(tokenId, context) {
        const rotated = rotateAgentToken(tokenId, { actor: context.actor, source: context.source });
        if (rotated) {
            this.auditManager.record("token.rotated", "agent_token", tokenId, context);
        }
        return rotated;
    }
    revokeLocalAgentToken(tokenId, context) {
        const revoked = revokeAgentToken(tokenId, { actor: context.actor, source: context.source });
        if (revoked) {
            this.auditManager.record("token.revoked", "agent_token", tokenId, context);
        }
        return revoked;
    }
    getTokenById(tokenId) {
        return getAgentTokenById(tokenId) ?? null;
    }
}
