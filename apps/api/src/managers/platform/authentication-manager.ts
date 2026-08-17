import { AbstractManager } from "../base.js";
import type { AuthContext } from "../contracts.js";
import type { ForgePrincipal } from "../../security/contracts.js";
import type { LegacyTokenTransport } from "../../security/legacy-token-migration.js";
import type { SessionManager } from "./session-manager.js";
import type { TokenManager } from "./token-manager.js";

function readSingleHeaderValue(value: unknown) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return typeof value === "string" ? value : null;
}

function resolveVerifiedUserScope(principal: ForgePrincipal) {
  const selected = principal.selectedUserIds;
  if (!selected || selected.length === 0) {
    return [principal.ownerId];
  }
  return [...new Set(selected.map((value) => value.trim()))]
    .filter((value) => value.length > 0 && value.length <= 128)
    .sort();
}

export class AuthenticationManager extends AbstractManager {
  readonly name = "AuthenticationManager";
  private readonly verifiedPrincipals = new WeakMap<
    Record<string, unknown>,
    ForgePrincipal
  >();
  private readonly verifiedContexts = new WeakMap<
    Record<string, unknown>,
    AuthContext
  >();

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly tokenManager: TokenManager
  ) {
    super();
  }

  bindVerifiedPrincipal(
    headers: Record<string, unknown>,
    principal: ForgePrincipal
  ) {
    this.verifiedPrincipals.set(headers, principal);
  }

  bindVerifiedContext(headers: Record<string, unknown>, context: AuthContext) {
    this.verifiedContexts.set(headers, context);
  }

  authenticate(
    headers: Record<string, unknown>,
    legacyTransport: LegacyTokenTransport = "other_network"
  ): AuthContext {
    const verifiedContext = this.verifiedContexts.get(headers);
    if (verifiedContext) {
      return verifiedContext;
    }
    const verified = this.verifiedPrincipals.get(headers);
    if (verified) {
      const requestContext = {
        now: new Date(),
        correlationId: null,
        requestId: null,
        origin: readSingleHeaderValue(headers.origin),
        host: readSingleHeaderValue(headers.host),
        ip: null
      };
      if (verified.kind === "operator_session") {
        return {
          ...requestContext,
          actor: verified.subjectId,
          source: "ui",
          token: null,
          scope: { userIds: [], projectIds: [], tagIds: [] },
          session: {
            id: verified.subjectId,
            actorLabel: verified.subjectId,
            expiresAt: new Date(Date.now() + 60_000).toISOString()
          }
        };
      }
      const tokenId = verified.clientId ?? verified.subjectId;
      const trusted =
        verified.profile === "operator" ||
        verified.profile === "trusted_personal_assistant" ||
        verified.profile === "executor";
      const userIds = resolveVerifiedUserScope(verified);
      return {
        ...requestContext,
        actor: verified.subjectId,
        source: verified.kind === "system" ? "system" : "agent",
        token: {
          id: tokenId,
          agentId: verified.subjectId,
          agentLabel: verified.subjectId,
          scopes: [...verified.scopes],
          trustLevel: trusted ? "trusted" : "viewer",
          autonomyMode: trusted ? "supervised" : "read_only",
          approvalMode: "explicit",
          bootstrapPolicy: {
            mode: "disabled",
            goalsLimit: 0,
            projectsLimit: 0,
            tasksLimit: 0,
            habitsLimit: 0,
            strategiesLimit: 0,
            peoplePageLimit: 0,
            includePeoplePages: false
          },
          scopePolicy: {
            userIds,
            projectIds: [],
            tagIds: []
          }
        },
        scope: {
          userIds,
          projectIds: [],
          tagIds: []
        },
        session: null
      };
    }
    const bearer = this.parseBearerToken(headers);
    const token = bearer
      ? this.tokenManager.verifyBearerToken(bearer, legacyTransport)
      : null;
    const session = this.sessionManager.readSessionFromHeaders(headers);
    const actor = token?.agentLabel ?? session?.actorLabel ?? null;
    const source = token ? "agent" : "ui";

    return {
      now: new Date(),
      correlationId: null,
      requestId: null,
      origin: readSingleHeaderValue(headers.origin),
      host: readSingleHeaderValue(headers.host),
      ip: null,
      actor,
      source,
      token,
      scope: {
        userIds: token?.scopePolicy.userIds ?? [],
        projectIds: token?.scopePolicy.projectIds ?? [],
        tagIds: token?.scopePolicy.tagIds ?? []
      },
      session
    };
  }

  private parseBearerToken(headers: Record<string, unknown>) {
    const raw = readSingleHeaderValue(headers.authorization);
    if (!raw) {
      return null;
    }
    const [scheme, token] = raw.trim().split(/\s+/, 2);
    if (scheme?.toLowerCase() !== "bearer" || !token) {
      return null;
    }
    return token;
  }
}
