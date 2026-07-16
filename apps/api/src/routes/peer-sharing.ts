import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getDatabase } from "../db.js";
import { HttpError } from "../errors.js";
import type { AuthContext } from "../managers/contracts.js";
import type { AuthorizationManager } from "../managers/platform/authorization-manager.js";
import type { SecretsManager } from "../managers/platform/secrets-manager.js";
import { isTrustedOperatorNetworkEntry } from "../managers/platform/trusted-network.js";
import {
  PEER_API_SCHEMAS,
  parsePeerApiSuccess,
  peerGrantDraftSchema,
  type PeerApiOperationId
} from "../peer-api-schemas.js";
import {
  getPeerRouteContract,
  PEER_ROUTE_CONTRACTS,
  type PeerRouteContract,
  type PeerRouteMethod
} from "../peer-route-contract.js";
import {
  PEER_PROTOCOL_VERSION,
  peerShareGrantVersionSchema,
  type PeerShareGrantVersion
} from "../peer-sharing-types.js";
import {
  listPeerPresenceCredentialSummaries,
  recordPeerPresenceAudit,
  revokePeerPresenceCredential,
  SqlitePeerPresenceStore
} from "../repositories/peer-presence.js";
import {
  applyPeerCommand,
  derivePeerCommandId,
  getPeerCommand,
  markPeerCommandDispatched,
  markPeerCommandReceiptRecovered,
  markPeerCommandReconciliationRequired,
  preparePeerCommand,
  type PeerCommandJournalEntry
} from "../repositories/peer-command-journal.js";
import {
  cancelPeerInvitationRecord,
  createPeerInvitationRecord,
  createPeerPendingRequest,
  decidePeerPendingRequest,
  getLatestPeerGrantVersion,
  getPeerInvitationStatus,
  getPeerPendingRequest,
  getPeerRelationship,
  getPeerSyncStatus,
  hashPeerApiValue,
  insertPeerGrantVersion,
  listPeerDiagnostics,
  listPeerGrantVersions,
  listPeerPendingRequests,
  listPeerRelationshipDevices,
  listPeerRelationships,
  mutatePeerRelationshipDevice,
  readPeerIdempotency,
  recordPeerAuditEvent,
  revokePeerRelationshipRecord,
  writePeerIdempotency,
  type PeerPendingRequest,
  type PeerRelationshipRow
} from "../repositories/peer-sharing.js";
import { PeerPairingPersistenceError } from "../repositories/peer-pairing.js";
import { getDefaultUser } from "../repositories/users.js";
import {
  decodePeerCursor,
  encodePeerCursor
} from "../services/peer-cursors.js";
import type {
  PeerCoreGateway,
  PeerDaemonCommandReceipt,
  PeerPairingConfirmation
} from "../services/peer-core-gateway.js";
import {
  assertCounterProposalNarrowsGrant,
  assertHumanGrantActor,
  hashPeerGrantVersion,
  peerGrantMatchesReviewedPolicy,
  validateNextPeerGrantVersion
} from "../services/peer-grants.js";
import {
  capabilitySecretMatches,
  consumePeerPresenceCapability,
  digestPeerPresenceAction,
  peerPresenceCapabilityCookie,
  readPeerPresenceCapabilityCookie,
  type PeerPresenceAction,
  type PeerPresencePrincipal
} from "../services/peer-human-presence.js";
import { validateProjectionRule } from "../services/peer-projections.js";
import {
  PeerOperationRateLimiter,
  PeerRateLimitError
} from "../services/peer-rate-limit.js";
import {
  createPeerWebAuthnOptions,
  peerWebAuthnCredentialSetVersion,
  resolvePeerWebAuthnRelyingParty,
  verifyPeerWebAuthnCeremony
} from "../services/peer-webauthn.js";
import {
  createPeerCompanionConsentOptions,
  PEER_COMPANION_CONSENT_PROTOCOL,
  verifyPeerCompanionConsent
} from "../services/peer-companion-consent.js";
import {
  createPeerCompanionEnrollmentOptions,
  verifyPeerCompanionEnrollment
} from "../services/peer-companion-enrollment.js";
import {
  derivePeerCommandAuthorizationId,
  peerCommandApprovalBindingSchema
} from "../services/peer-command-authorization.js";
import {
  PEER_COMPANION_AUTHORIZED_OPERATION_IDS,
  PEER_COMPANION_CAPABILITIES,
  PEER_COMPANION_REQUEST_PROTOCOL,
  PEER_COMPANION_SCOPES
} from "../services/peer-companion-auth.js";

type Awaitable<T> = T | Promise<T>;

export type PeerCompanionRouteContext = {
  principalClass: "companion_session" | "companion_consent";
  principalId: string;
  ownerUserId: string;
  deviceId: string;
  enrollmentId: string;
  keyId: string;
  scopes: string[];
  authorizedOperations: string[];
  authenticatedAt: string;
  userPresenceAt: string | null;
  presenceCapability?: { capabilityId: string; secret: string } | null;
};

type PeerManagementGateway = PeerCoreGateway & {
  cancelInvitation?(input: {
    commandId: string;
    ownerUserId: string;
    invitationId: string;
  }): Promise<void>;
  acceptPendingRequest?(input: {
    commandId: string;
    ownerUserId: string;
    request: PeerPendingRequest;
  }): Promise<void>;
  revokeGrant?(input: {
    commandId: string;
    ownerUserId: string;
    grant: PeerShareGrantVersion;
    reason: string;
  }): Promise<PeerShareGrantVersion>;
};

export type PeerSharingRouteDependencies = {
  authenticate(headers: Record<string, unknown>): AuthContext;
  authenticateCompanion?: (
    request: FastifyRequest
  ) => Awaitable<PeerCompanionRouteContext | null>;
  authorization: AuthorizationManager;
  secrets: SecretsManager;
  peerCore: PeerCoreGateway;
  persistPairingConfirmation?: (input: {
    ownerUserId: string;
    pairingId: string;
    expectedPendingVersion: number;
    confirmation: PeerPairingConfirmation;
    personId: string | null;
    createPersonDisplayName: string | null;
    actorClass:
      | "operator_session"
      | "agent_token"
      | "companion_session"
      | "companion_consent";
    actorId: string;
    now: Date;
  }) => { relationshipId: string };
  rateLimiter?: PeerOperationRateLimiter;
  now?: () => Date;
  devWebOrigin?: string | null;
};

type PeerRouteActor = {
  auth: AuthContext | null;
  principalClass:
    | "operator_session"
    | "agent_token"
    | "companion_session"
    | "companion_consent";
  principalId: string;
  ownerUserId: string;
  deviceId: string | null;
  companionEnrollmentId: string | null;
  companionKeyId: string | null;
  scopes: string[];
  origin: string | null;
  host: string | null;
  sourceIp: string | null;
  authenticatedAt: string;
  userPresenceAt: string | null;
  presenceCapability: { capabilityId: string; secret: string } | null;
};

const pageCursorSchema = z
  .object({
    createdAt: z.string().datetime({ offset: true }),
    id: z.string().trim().min(1).max(240)
  })
  .strict();
const relationshipCursorSchema = z
  .object({
    updatedAt: z.string().datetime({ offset: true }),
    id: z.string().trim().min(1).max(240)
  })
  .strict();
const grantCursorSchema = z
  .object({
    issuedAt: z.string().datetime({ offset: true }),
    id: z.string().trim().min(1).max(240),
    sequence: z.number().int().positive()
  })
  .strict();

const peerManagementOperationIds = new Set<PeerApiOperationId>(
  PEER_ROUTE_CONTRACTS.filter(
    (contract) => !contract.path.startsWith("/api/v1/people")
  ).map((contract) => contract.operationId)
);

function routeContract(operationId: PeerApiOperationId): PeerRouteContract {
  const contract = PEER_ROUTE_CONTRACTS.find(
    (candidate) => candidate.operationId === operationId
  );
  if (!contract || !peerManagementOperationIds.has(operationId)) {
    throw new Error(
      `Missing peer-management route contract for ${operationId}.`
    );
  }
  return contract;
}

function nowFrom(dependencies: PeerSharingRouteDependencies) {
  const now = dependencies.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Peer route clock returned an invalid time.");
  }
  return now;
}

function asHeaders(request: FastifyRequest) {
  return request.headers as Record<string, unknown>;
}

function requestedCookie(request: FastifyRequest) {
  const value = request.headers.cookie;
  return Array.isArray(value) ? value.join("; ") : value;
}

function resolveLocalOwner(auth: AuthContext) {
  const scoped = auth.token?.scopePolicy.userIds ?? [];
  if (scoped.length === 1) {
    return scoped[0]!;
  }
  if (scoped.length > 1) {
    throw new HttpError(
      400,
      "peer_owner_required",
      "Select one Forge owner for this peer request."
    );
  }
  return getDefaultUser().id;
}

function ensureCompanionBoundary(
  context: PeerCompanionRouteContext,
  now: Date
) {
  const row = getDatabase()
    .prepare(
      `SELECT enrollment.status,
              pairing.status AS pairingStatus,
              pairing.paired_at AS pairedAt,
              pairing.expires_at AS expiresAt
       FROM peer_companion_enrollments AS enrollment
       JOIN companion_pairing_sessions AS pairing
         ON pairing.id = enrollment.pairing_session_id
        AND pairing.user_id = enrollment.owner_user_id
       WHERE enrollment.pairing_session_id = ?
         AND enrollment.enrollment_id = ?
         AND enrollment.key_id = ?
         AND enrollment.device_id = ?
         AND enrollment.owner_user_id = ?
       LIMIT 1`
    )
    .get(
      context.principalId,
      context.enrollmentId,
      context.keyId,
      context.deviceId,
      context.ownerUserId
    ) as
    | {
        status: string;
        pairingStatus: string;
        pairedAt: string | null;
        expiresAt: string;
      }
    | undefined;
  if (
    !row ||
    row.status !== "active" ||
    !row.pairedAt ||
    !["paired", "healthy", "stale", "permission_denied"].includes(
      row.pairingStatus
    ) ||
    Date.parse(row.expiresAt) <= now.getTime()
  ) {
    throw new HttpError(
      403,
      "peer_companion_device_forbidden",
      "The companion session is not bound to an active registered device key."
    );
  }
  const authenticatedAt = Date.parse(context.authenticatedAt);
  if (
    !Number.isFinite(authenticatedAt) ||
    authenticatedAt > now.getTime() ||
    now.getTime() - authenticatedAt > 24 * 60 * 60_000
  ) {
    throw new HttpError(
      401,
      "peer_companion_session_expired",
      "The companion session is no longer current."
    );
  }
  if (context.principalClass === "companion_consent") {
    const presenceAt = Date.parse(context.userPresenceAt ?? "");
    if (
      !Number.isFinite(presenceAt) ||
      presenceAt > now.getTime() ||
      now.getTime() - presenceAt > 5 * 60_000 ||
      presenceAt > authenticatedAt + 30_000 ||
      authenticatedAt - presenceAt > 5 * 60_000
    ) {
      throw new HttpError(
        409,
        "peer_companion_presence_expired",
        "Current companion user presence is required."
      );
    }
  }
}

async function authenticatePeerRoute(
  dependencies: PeerSharingRouteDependencies,
  request: FastifyRequest,
  operationId: PeerApiOperationId
): Promise<PeerRouteActor> {
  const contract = routeContract(operationId);
  let localAuth: AuthContext | null = null;
  let localError: unknown = null;
  try {
    localAuth = dependencies.authenticate(asHeaders(request));
  } catch (error) {
    localError = error;
  }
  if (localAuth?.session || localAuth?.token) {
    dependencies.authorization.requireAuthenticatedActor(localAuth, {
      operationId
    });
    dependencies.authorization.requireAllTokenScopes(
      localAuth,
      [...contract.requiredScopes],
      { operationId }
    );
    const principalClass = localAuth.session
      ? ("operator_session" as const)
      : ("agent_token" as const);
    if (!contract.principalClasses.includes(principalClass)) {
      throw new HttpError(
        403,
        "peer_principal_forbidden",
        "This principal cannot use the requested peer operation."
      );
    }
    return {
      auth: localAuth,
      principalClass,
      principalId: localAuth.session?.id ?? localAuth.token!.id,
      ownerUserId: resolveLocalOwner(localAuth),
      deviceId: null,
      companionEnrollmentId: null,
      companionKeyId: null,
      scopes: localAuth.token?.scopes ?? [...contract.requiredScopes],
      origin: localAuth.origin,
      host: localAuth.host,
      sourceIp: request.ip,
      authenticatedAt:
        localAuth.now?.toISOString() ?? nowFrom(dependencies).toISOString(),
      userPresenceAt: null,
      presenceCapability: null
    };
  }
  const companion = dependencies.authenticateCompanion
    ? await dependencies.authenticateCompanion(request)
    : null;
  if (!companion) {
    if (localError) {
      throw localError;
    }
    throw new HttpError(401, "auth_required", "Authentication is required.");
  }
  ensureCompanionBoundary(companion, nowFrom(dependencies));
  if (!contract.principalClasses.includes(companion.principalClass)) {
    throw new HttpError(
      403,
      "peer_principal_forbidden",
      "This companion principal cannot use the requested peer operation."
    );
  }
  if (!companion.authorizedOperations.includes(operationId)) {
    throw new HttpError(
      403,
      "peer_companion_operation_forbidden",
      "This secure companion enrollment does not authorize the requested operation."
    );
  }
  const missingScopes = contract.requiredScopes.filter(
    (scope) => !companion.scopes.includes(scope)
  );
  if (missingScopes.length > 0) {
    throw new HttpError(
      403,
      "insufficient_scope",
      "The companion session lacks required peer scopes.",
      { missingScopes }
    );
  }
  return {
    auth: null,
    principalClass: companion.principalClass,
    principalId: companion.principalId,
    ownerUserId: companion.ownerUserId,
    deviceId: companion.deviceId,
    companionEnrollmentId: companion.enrollmentId,
    companionKeyId: companion.keyId,
    scopes: companion.scopes,
    origin: null,
    host: null,
    sourceIp: request.ip,
    authenticatedAt: companion.authenticatedAt,
    userPresenceAt: companion.userPresenceAt,
    presenceCapability: companion.presenceCapability ?? null
  };
}

async function authenticateCompanionEnrollmentOperator(
  dependencies: PeerSharingRouteDependencies,
  request: FastifyRequest,
  operationId:
    | "createPeerCompanionEnrollmentOptions"
    | "verifyPeerCompanionEnrollment"
) {
  if (
    request.headers.authorization !== undefined ||
    Object.keys(request.headers).some((name) =>
      name.toLowerCase().startsWith("x-forge-companion-")
    )
  ) {
    throw new HttpError(
      401,
      "peer_companion_enrollment_operator_required",
      "Secure companion enrollment accepts only the current operator session cookie."
    );
  }
  const actor = await authenticatePeerRoute(dependencies, request, operationId);
  if (actor.principalClass !== "operator_session" || !actor.auth?.session) {
    throw new HttpError(
      401,
      "peer_companion_enrollment_operator_required",
      "Secure companion enrollment requires the current operator session."
    );
  }
  return actor;
}

function consumeRateLimit(
  limiter: PeerOperationRateLimiter,
  actor: PeerRouteActor,
  operationId: PeerApiOperationId,
  limit: number,
  now: Date
) {
  try {
    limiter.consume({
      operationId,
      principalId: actor.principalId,
      limit,
      now
    });
  } catch (error) {
    if (error instanceof PeerRateLimitError) {
      throw new HttpError(
        429,
        "peer_rate_limit_exceeded",
        "Too many peer operations were requested.",
        { retryAfterSeconds: error.retryAfterSeconds }
      );
    }
    throw error;
  }
}

function requireHumanActor(actor: PeerRouteActor): PeerPresencePrincipal {
  if (
    actor.principalClass !== "operator_session" &&
    actor.principalClass !== "companion_consent"
  ) {
    throw new HttpError(
      403,
      "peer_human_approval_required",
      "This peer operation requires a human-controlled session."
    );
  }
  return {
    principalClass: actor.principalClass,
    principalId: actor.principalId,
    ownerUserId: actor.ownerUserId,
    origin: actor.origin
  };
}

function isLoopbackProxyAddress(input: string | null) {
  const normalized = input?.trim().toLocaleLowerCase("en-US");
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1"
  );
}

function configuredWebOrigin(dependencies: PeerSharingRouteDependencies) {
  const raw = dependencies.devWebOrigin?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error("configured Forge web URL contains unsupported parts");
    }
    const relyingParty = resolvePeerWebAuthnRelyingParty(parsed.origin);
    const basePath =
      parsed.pathname === "/"
        ? "/"
        : parsed.pathname.replace(/\/+$/, "") || "/";
    return { relyingParty, basePath };
  } catch {
    throw new HttpError(
      503,
      "peer_web_origin_configuration_invalid",
      "The configured Forge web origin is invalid."
    );
  }
}

function operatorRelyingParty(
  actor: PeerRouteActor,
  dependencies: PeerSharingRouteDependencies
) {
  if (actor.principalClass !== "operator_session" || !actor.origin) {
    throw new HttpError(
      409,
      "peer_webauthn_operator_required",
      "Browser approval requires an operator session with an exact origin."
    );
  }
  try {
    const relyingParty = resolvePeerWebAuthnRelyingParty(actor.origin);
    const host = actor.host;
    const validHost =
      Boolean(host) && host!.trim() === host && !host!.includes(",");
    const originHost = new URL(relyingParty.origin).host.toLocaleLowerCase(
      "en-US"
    );
    if (validHost && originHost === host!.toLocaleLowerCase("en-US")) {
      return relyingParty;
    }
    const configured = configuredWebOrigin(dependencies);
    const trustedLocalProxy =
      validHost &&
      configured?.relyingParty.origin === relyingParty.origin &&
      isLoopbackProxyAddress(actor.sourceIp) &&
      isTrustedOperatorNetworkEntry(host!);
    if (!trustedLocalProxy) {
      throw new HttpError(
        403,
        "peer_webauthn_origin_host_mismatch",
        "The WebAuthn origin does not match the Forge request host."
      );
    }
    return configured.relyingParty;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      400,
      "peer_webauthn_origin_invalid",
      error instanceof Error ? error.message : "The WebAuthn origin is invalid."
    );
  }
}

function singleBrowserHeader(request: FastifyRequest, name: string) {
  const value = request.headers[name];
  return typeof value === "string" ? value : null;
}

function operatorStatusReadActor(
  actor: PeerRouteActor,
  request: FastifyRequest,
  dependencies: PeerSharingRouteDependencies
): PeerRouteActor {
  if (actor.principalClass !== "operator_session") return actor;
  const site = singleBrowserHeader(request, "sec-fetch-site");
  const mode = singleBrowserHeader(request, "sec-fetch-mode");
  const destination = singleBrowserHeader(request, "sec-fetch-dest");
  const referer = singleBrowserHeader(request, "referer");
  if (
    site !== "same-origin" ||
    (mode !== "cors" && mode !== "same-origin") ||
    destination !== "empty" ||
    !referer
  ) {
    throw new HttpError(
      403,
      "peer_browser_origin_untrusted",
      "People sharing status requires a same-origin Forge browser request."
    );
  }
  let refererUrl: URL;
  try {
    refererUrl = new URL(referer);
    if (refererUrl.username || refererUrl.password) {
      throw new Error("invalid referer");
    }
  } catch {
    throw new HttpError(
      403,
      "peer_browser_origin_untrusted",
      "People sharing status requires a valid same-origin Forge referrer."
    );
  }
  const refererOrigin = refererUrl.origin;
  if (actor.origin && actor.origin !== refererOrigin) {
    throw new HttpError(
      403,
      "peer_browser_origin_untrusted",
      "The browser Origin and Forge referrer do not match."
    );
  }
  const statusActor = { ...actor, origin: actor.origin ?? refererOrigin };
  const requestHost = actor.host?.toLocaleLowerCase("en-US") ?? null;
  if (refererUrl.host.toLocaleLowerCase("en-US") !== requestHost) {
    const configured = configuredWebOrigin(dependencies);
    const insideConfiguredBase =
      configured?.relyingParty.origin === refererOrigin &&
      (configured.basePath === "/" ||
        refererUrl.pathname === configured.basePath ||
        refererUrl.pathname.startsWith(`${configured.basePath}/`));
    if (!insideConfiguredBase) {
      throw new HttpError(
        403,
        "peer_browser_origin_untrusted",
        "People sharing status must come from the configured Forge web app."
      );
    }
  }
  operatorRelyingParty(statusActor, dependencies);
  return statusActor;
}

function activeCredentialSet(
  actor: PeerRouteActor,
  store: SqlitePeerPresenceStore,
  dependencies: PeerSharingRouteDependencies
) {
  const relyingParty = operatorRelyingParty(actor, dependencies);
  const credentials = store.listActiveCredentials(
    actor.ownerUserId,
    relyingParty.rpId
  );
  return {
    relyingParty,
    credentials,
    version: peerWebAuthnCredentialSetVersion(credentials)
  };
}

function requireVersion(
  actual: string,
  expected: string | null,
  label: string
) {
  if (expected !== actual) {
    throw new HttpError(
      409,
      "peer_version_conflict",
      `${label} changed after it was reviewed.`,
      { currentVersion: actual }
    );
  }
}

function invitationVersion(invitation: unknown) {
  const updatedAt = (invitation as { updatedAt?: unknown }).updatedAt;
  if (
    typeof updatedAt !== "string" ||
    !Number.isFinite(Date.parse(updatedAt))
  ) {
    throw new HttpError(
      500,
      "peer_invitation_version_invalid",
      "The stored peer invitation version is invalid."
    );
  }
  return updatedAt;
}

function requireEmptyBody(body: unknown) {
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body as Record<string, unknown>).length !== 0
  ) {
    throw new HttpError(
      400,
      "peer_presence_body_invalid",
      "This approval action requires an empty JSON body."
    );
  }
}

function validateActionSchema(
  operationId: PeerApiOperationId,
  action: PeerPresenceAction
) {
  const schema = PEER_API_SCHEMAS[operationId];
  schema.params.parse(action.pathParams);
  if (operationId === "createPeerHumanPresenceOptions") {
    const body = z
      .object({
        ceremony: z.literal("register"),
        credentialLabel: z.string().trim().min(1).max(120)
      })
      .strict()
      .parse(action.body);
    return body;
  }
  if (schema.body) {
    schema.body.parse(action.body);
  } else {
    requireEmptyBody(action.body);
  }
  return action.body;
}

function currentGrantVersion(actor: PeerRouteActor, grantId: string) {
  const grant = getLatestPeerGrantVersion(actor.ownerUserId, grantId);
  if (!grant) {
    throw new HttpError(404, "peer_grant_not_found", "Peer grant not found.");
  }
  return grant;
}

function currentRelationship(actor: PeerRouteActor, relationshipId: string) {
  const relationship = getPeerRelationship(actor.ownerUserId, relationshipId);
  if (!relationship) {
    throw new HttpError(
      404,
      "peer_relationship_not_found",
      "Peer relationship not found."
    );
  }
  return relationship;
}

function validatePresenceActionTarget(input: {
  dependencies: PeerSharingRouteDependencies;
  actor: PeerRouteActor;
  action: PeerPresenceAction;
  store: SqlitePeerPresenceStore;
}) {
  if (input.action.ownerUserId !== input.actor.ownerUserId) {
    throw new HttpError(
      403,
      "peer_presence_owner_mismatch",
      "The reviewed action belongs to another Forge owner."
    );
  }
  try {
    digestPeerPresenceAction(input.action);
  } catch (error) {
    throw new HttpError(
      400,
      "peer_presence_action_invalid",
      error instanceof Error ? error.message : "The reviewed action is invalid."
    );
  }
  const contract = getPeerRouteContract(
    input.action.method,
    input.action.routePath
  );
  if (!contract || !peerManagementOperationIds.has(contract.operationId)) {
    throw new HttpError(
      400,
      "peer_presence_route_invalid",
      "The reviewed action does not target a peer-management route."
    );
  }
  validateActionSchema(contract.operationId, input.action);
  const params = input.action.pathParams;
  switch (contract.operationId) {
    case "createPeerHumanPresenceOptions": {
      const set = activeCredentialSet(
        input.actor,
        input.store,
        input.dependencies
      );
      requireVersion(
        set.version,
        input.action.expectedVersion,
        "Approval credentials"
      );
      break;
    }
    case "revokePeerHumanPresenceCredential": {
      const set = activeCredentialSet(
        input.actor,
        input.store,
        input.dependencies
      );
      if (!set.credentials.some((item) => item.id === params.credentialId)) {
        throw new HttpError(
          404,
          "peer_presence_credential_not_found",
          "Approval credential not found for this Forge origin."
        );
      }
      requireVersion(
        set.version,
        input.action.expectedVersion,
        "Approval credentials"
      );
      break;
    }
    case "cancelPeerInvitation": {
      const invitation = getPeerInvitationStatus(
        input.actor.ownerUserId,
        params.invitationId!
      );
      if (!invitation) {
        throw new HttpError(
          404,
          "peer_invitation_not_found",
          "Peer invitation not found."
        );
      }
      requireVersion(
        invitationVersion(invitation),
        input.action.expectedVersion,
        "Peer invitation"
      );
      break;
    }
    case "confirmPeerPairing":
    case "acceptPeerRequest":
    case "rejectPeerRequest": {
      const requestId =
        contract.operationId === "confirmPeerPairing"
          ? params.pairingId!
          : params.requestId!;
      const pending = getPeerPendingRequest(input.actor.ownerUserId, requestId);
      if (!pending) {
        throw new HttpError(
          404,
          "peer_request_not_found",
          "Pending peer request not found."
        );
      }
      if (
        contract.operationId === "confirmPeerPairing" &&
        pending.kind !== "pairing"
      ) {
        throw new HttpError(
          409,
          "peer_request_kind_conflict",
          "The reviewed request is not a pairing request."
        );
      }
      requireVersion(
        String(pending.version),
        input.action.expectedVersion,
        "Pending peer request"
      );
      break;
    }
    case "revokePeerRelationship":
    case "approvePeerDevice":
    case "removePeerDevice":
    case "previewPeerGrant":
    case "proposePeerGrant":
    case "requestPeerResync": {
      const relationship = currentRelationship(
        input.actor,
        params.relationshipId!
      );
      requireVersion(
        relationship.updatedAt,
        input.action.expectedVersion,
        "Peer relationship"
      );
      if (
        contract.operationId === "approvePeerDevice" ||
        contract.operationId === "removePeerDevice"
      ) {
        const device = listPeerRelationshipDevices(
          input.actor.ownerUserId,
          relationship.id
        ).find((candidate) => candidate.deviceId === params.deviceId);
        if (!device) {
          throw new HttpError(
            404,
            "peer_device_not_found",
            "Peer relationship device not found."
          );
        }
      }
      break;
    }
    case "acceptPeerGrant":
    case "counterPeerGrant":
    case "revokePeerGrant": {
      const grant = currentGrantVersion(input.actor, params.grantId!);
      requireVersion(
        hashPeerGrantVersion(grant),
        input.action.expectedVersion,
        "Peer grant"
      );
      break;
    }
    case "createPeerInvitation":
    case "acceptScannedPeerPairing":
      if (input.action.expectedVersion !== null) {
        throw new HttpError(
          409,
          "peer_presence_version_unexpected",
          "This reviewed action does not use a record version."
        );
      }
      break;
    default:
      throw new HttpError(
        400,
        "peer_presence_route_invalid",
        "This route cannot consume a human approval capability."
      );
  }
  return contract;
}

function buildPresenceAction(input: {
  actor: PeerRouteActor;
  operationId: PeerApiOperationId;
  pathParams?: Record<string, string>;
  expectedVersion: string | null;
  body: unknown;
}): PeerPresenceAction {
  const contract = routeContract(input.operationId);
  if (contract.method !== "POST" && contract.method !== "DELETE") {
    throw new Error("Only peer mutations can consume human presence.");
  }
  return {
    ownerUserId: input.actor.ownerUserId,
    method: contract.method,
    routePath: contract.path,
    pathParams: input.pathParams ?? {},
    expectedVersion: input.expectedVersion,
    body: input.body
  };
}

function auditPresenceFailure(input: {
  actor: PeerRouteActor;
  action: PeerPresenceAction;
  capabilityId: string | null;
  error: unknown;
}) {
  const principal = requireHumanActor(input.actor);
  const capabilityExists = input.capabilityId
    ? Boolean(
        getDatabase()
          .prepare(
            `SELECT 1 FROM forge_human_presence_capabilities
             WHERE id = ? AND owner_user_id = ? LIMIT 1`
          )
          .get(input.capabilityId, input.actor.ownerUserId)
      )
    : false;
  recordPeerPresenceAudit({
    ownerUserId: input.actor.ownerUserId,
    eventType: "peer_action_approval_consumption",
    outcome: "denied",
    principal,
    capabilityId: capabilityExists ? input.capabilityId : null,
    actionDigest: digestPeerPresenceAction(input.action),
    evidence: {
      reason:
        input.error instanceof Error
          ? input.error.message.slice(0, 500)
          : "unknown"
    }
  });
}

type ConsumedHumanApproval = {
  capabilityId: string;
  secret: string;
  actionDigest: string;
  approvalDeadline: string;
  capabilityIssuedAt: string;
  authorizationIssuedAt: string;
  approvalMethod: "webauthn" | "companion_signature";
  credentialId: string | null;
  validatedAt: string;
};

function readConsumedHumanApproval(input: {
  actor: PeerRouteActor;
  capability: { capabilityId: string; secret: string };
  action: PeerPresenceAction;
  capabilityHashingKey: Uint8Array;
  store: SqlitePeerPresenceStore;
}): Omit<ConsumedHumanApproval, "validatedAt"> | null {
  const principal = requireHumanActor(input.actor);
  const actionDigest = digestPeerPresenceAction(input.action);
  const row = getDatabase()
    .prepare(
      `SELECT capability.status,
              capability.action_digest AS actionDigest,
              capability.capability_keyed_hash AS capabilityKeyedHash,
              capability.expires_at AS approvalDeadline,
              capability.issued_at AS capabilityIssuedAt,
              capability.consumed_at AS authorizationIssuedAt,
              challenge.ceremony,
              challenge.verified_credential_id AS credentialId
       FROM forge_human_presence_capabilities AS capability
       JOIN forge_human_presence_challenges AS challenge
         ON challenge.id = capability.challenge_id
        AND challenge.owner_user_id = capability.owner_user_id
       WHERE capability.id = ? AND capability.owner_user_id = ?
         AND capability.principal_class = ? AND capability.principal_id = ?
         AND COALESCE(capability.principal_origin, '') = COALESCE(?, '')
         AND capability.session_binding_keyed_hash = ?
       LIMIT 1`
    )
    .get(
      input.capability.capabilityId,
      input.actor.ownerUserId,
      principal.principalClass,
      principal.principalId,
      principal.origin,
      input.store.principalBindingHash(principal)
    ) as
    | {
        status: string;
        actionDigest: string;
        capabilityKeyedHash: string;
        approvalDeadline: string;
        capabilityIssuedAt: string;
        authorizationIssuedAt: string | null;
        ceremony: string;
        credentialId: string | null;
      }
    | undefined;
  if (
    row?.status !== "consumed" ||
    row.actionDigest !== actionDigest ||
    !capabilitySecretMatches(
      input.capability.secret,
      row.capabilityKeyedHash,
      input.capabilityHashingKey
    ) ||
    !Number.isFinite(Date.parse(row.approvalDeadline)) ||
    !Number.isFinite(Date.parse(row.capabilityIssuedAt)) ||
    !Number.isFinite(Date.parse(row.authorizationIssuedAt ?? ""))
  ) {
    return null;
  }
  const approvalMethod =
    row.ceremony === "companion" ? "companion_signature" : "webauthn";
  return {
    capabilityId: input.capability.capabilityId,
    secret: input.capability.secret,
    actionDigest,
    approvalDeadline: row.approvalDeadline,
    capabilityIssuedAt: row.capabilityIssuedAt,
    authorizationIssuedAt: row.authorizationIssuedAt!,
    approvalMethod,
    credentialId: row.credentialId
  };
}

function consumeHumanApproval(input: {
  dependencies: PeerSharingRouteDependencies;
  actor: PeerRouteActor;
  request: FastifyRequest;
  reply: FastifyReply;
  store: SqlitePeerPresenceStore;
  capabilityHashingKey: Uint8Array;
  action: PeerPresenceAction;
}) {
  const principal = requireHumanActor(input.actor);
  validatePresenceActionTarget({
    dependencies: input.dependencies,
    actor: input.actor,
    action: input.action,
    store: input.store
  });
  const capability =
    input.actor.presenceCapability ??
    readPeerPresenceCapabilityCookie(requestedCookie(input.request));
  if (!capability) {
    throw new HttpError(
      409,
      "peer_human_approval_required",
      "Approve this exact peer action before submitting it."
    );
  }
  const now = nowFrom(input.dependencies);
  try {
    consumePeerPresenceCapability({
      capabilityId: capability.capabilityId,
      secret: capability.secret,
      action: input.action,
      principal,
      hashingKey: input.capabilityHashingKey,
      store: input.store,
      now
    });
  } catch (error) {
    auditPresenceFailure({
      actor: input.actor,
      action: input.action,
      capabilityId: capability.capabilityId,
      error
    });
    throw new HttpError(
      409,
      "peer_human_approval_invalid",
      "The approval is invalid, expired, already used, or bound to another action."
    );
  }
  recordPeerPresenceAudit({
    ownerUserId: input.actor.ownerUserId,
    eventType: "peer_action_approval_consumption",
    outcome: "allowed",
    principal,
    capabilityId: capability.capabilityId,
    actionDigest: digestPeerPresenceAction(input.action)
  });
  if (input.actor.principalClass === "operator_session") {
    input.reply.header(
      "set-cookie",
      peerPresenceCapabilityCookie({
        capabilityId: capability.capabilityId,
        secret: capability.secret,
        secure: input.actor.origin?.startsWith("https://") ?? false,
        clear: true
      })
    );
  }
  const approval = readConsumedHumanApproval({
    actor: input.actor,
    capability,
    action: input.action,
    capabilityHashingKey: input.capabilityHashingKey,
    store: input.store
  });
  if (!approval || Date.parse(approval.approvalDeadline) <= now.getTime()) {
    throw new HttpError(
      409,
      "peer_human_approval_invalid",
      "The consumed approval could not be bound to this command."
    );
  }
  return { ...approval, validatedAt: now.toISOString() };
}

function consumeHumanApprovalOrRecover(
  input: Parameters<typeof consumeHumanApproval>[0] & {
    approvedRecovery: boolean;
  }
) {
  if (
    input.approvedRecovery &&
    input.actor.principalClass === "companion_consent" &&
    input.actor.presenceCapability
  ) {
    const capability = input.actor.presenceCapability;
    const approval = readConsumedHumanApproval({
      actor: input.actor,
      capability,
      action: input.action,
      capabilityHashingKey: input.capabilityHashingKey,
      store: input.store
    });
    if (approval) {
      recordPeerPresenceAudit({
        ownerUserId: input.actor.ownerUserId,
        eventType: "peer_action_approval_recovery",
        outcome: "allowed",
        principal: requireHumanActor(input.actor),
        capabilityId: capability.capabilityId,
        actionDigest: approval.actionDigest,
        evidence: { committedOrJournaledReplay: true }
      });
      return {
        ...approval,
        validatedAt: nowFrom(input.dependencies).toISOString()
      };
    }
  }
  return consumeHumanApproval(input);
}

async function requireHealthyPeerCore(
  dependencies: PeerSharingRouteDependencies
) {
  try {
    const health = await dependencies.peerCore.health();
    if (!health.enabled || !health.healthy) {
      throw new HttpError(
        503,
        "peer_core_unavailable",
        "Peer connectivity is unavailable.",
        { reason: health.reason, protocolVersion: health.protocolVersion }
      );
    }
    return health;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(
      503,
      "peer_core_unavailable",
      "Peer connectivity is unavailable."
    );
  }
}

function peerCoreFailure(error: unknown): never {
  if (error instanceof HttpError) {
    throw error;
  }
  if (error instanceof PeerPairingPersistenceError) {
    if (error.code === "not_found") {
      throw new HttpError(
        404,
        "peer_pairing_person_not_found",
        "The selected Person is unavailable for this pairing."
      );
    }
    if (error.code === "conflict") {
      throw new HttpError(
        409,
        "peer_pairing_conflict",
        "The pairing conflicts with existing Forge identity state and requires review."
      );
    }
  }
  throw new HttpError(
    503,
    "peer_core_operation_failed",
    "The peer operation could not be completed safely."
  );
}

function requireManagementGatewayMethod<K extends keyof PeerManagementGateway>(
  dependencies: PeerSharingRouteDependencies,
  method: K
): NonNullable<PeerManagementGateway[K]> {
  const candidate = (dependencies.peerCore as PeerManagementGateway)[method];
  if (typeof candidate !== "function") {
    throw new HttpError(
      503,
      "peer_core_operation_unavailable",
      "This peer operation is not available in the configured peer daemon."
    );
  }
  return candidate.bind(dependencies.peerCore) as NonNullable<
    PeerManagementGateway[K]
  >;
}

function readIdempotent(input: {
  ownerUserId: string;
  operationId: PeerApiOperationId;
  idempotencyKey: string;
  body: unknown;
  secrets?: SecretsManager;
  now: Date;
}) {
  const requestHash = hashPeerApiValue(input.body);
  try {
    return {
      requestHash,
      stored: readPeerIdempotency({
        ownerUserId: input.ownerUserId,
        operationId: input.operationId,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        secrets: input.secrets,
        now: input.now
      })
    };
  } catch (error) {
    throw new HttpError(
      409,
      "peer_idempotency_conflict",
      error instanceof Error
        ? error.message
        : "The idempotency key conflicts with another request."
    );
  }
}

function storeIdempotent(input: {
  ownerUserId: string;
  operationId: PeerApiOperationId;
  idempotencyKey: string;
  requestHash: string;
  status: number;
  response: unknown;
  encryptedResponse?: {
    secrets: SecretsManager;
    reference: string;
    expiresAt: string;
  };
  now: Date;
}) {
  try {
    writePeerIdempotency(input);
  } catch (error) {
    const stored = readPeerIdempotency({
      ownerUserId: input.ownerUserId,
      operationId: input.operationId,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      secrets: input.encryptedResponse?.secrets,
      now: input.now
    });
    if (!stored) {
      throw error;
    }
  }
}

function sendStored(
  reply: FastifyReply,
  stored: { status: number; response: unknown }
) {
  reply.header("x-forge-idempotent-replay", "true");
  return reply.code(stored.status).send(stored.response);
}

function peerCommandHashValue(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  if (value instanceof Uint8Array) {
    return { bytesBase64: Buffer.from(value).toString("base64") };
  }
  if (Array.isArray(value)) {
    return value.map(peerCommandHashValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        peerCommandHashValue(nested)
      ])
    );
  }
  return value;
}

type DispatchedPeerCommand<TResult> = {
  entry: PeerCommandJournalEntry;
  commandId: string;
  result: TResult;
  alreadyApplied: false;
};

type AppliedPeerCommand = {
  entry: PeerCommandJournalEntry;
  commandId: string;
  result: null;
  alreadyApplied: true;
};

const daemonOperationByApiOperation = {
  createPeerInvitation: "create_invitation",
  cancelPeerInvitation: "cancel_invitation",
  acceptScannedPeerPairing: "accept_invitation",
  confirmPeerPairing: "confirm_pairing",
  acceptPeerRequest: "accept_pending_request",
  revokePeerRelationship: "revoke_relationship",
  approvePeerDevice: "update_device",
  removePeerDevice: "update_device",
  proposePeerGrant: "sign_grant",
  acceptPeerGrant: "accept_grant",
  counterPeerGrant: "sign_grant",
  revokePeerGrant: "revoke_grant",
  requestPeerResync: "request_resync"
} as const;

function validateCommittedPeerReceipt<TResult>(input: {
  receipt: PeerDaemonCommandReceipt;
  daemonOperation: (typeof daemonOperationByApiOperation)[keyof typeof daemonOperationByApiOperation];
  commandId: string;
  approval: ConsumedHumanApproval;
  commandApproval: z.infer<typeof peerCommandApprovalBindingSchema>;
}): TResult {
  const { receipt, commandApproval } = input;
  const approvalDeadline = Date.parse(input.approval.approvalDeadline);
  const receiptDeadline = Date.parse(receipt.approvalDeadline ?? "");
  const committedAt = Date.parse(receipt.committedAt ?? "");
  const authorization = receipt.authorization;
  const verifiedAt = Date.parse(authorization?.verifiedAt ?? "");
  const authorizedAt = Date.parse(commandApproval.authorizationIssuedAt);
  const expectedAuthorizationId = derivePeerCommandAuthorizationId({
    commandId: input.commandId,
    capabilityId: commandApproval.capabilityId,
    actionDigest: commandApproval.actionDigest
  });
  if (
    receipt.commandId !== input.commandId ||
    receipt.operation !== input.daemonOperation ||
    /^0{64}$/.test(receipt.requestHash) ||
    !Number.isFinite(receiptDeadline) ||
    receiptDeadline !== approvalDeadline ||
    !Number.isFinite(committedAt) ||
    committedAt > approvalDeadline ||
    !authorization ||
    authorization.authorizationId !== expectedAuthorizationId ||
    authorization.actorClass !== commandApproval.actorClass ||
    authorization.actorId !== commandApproval.actorId ||
    authorization.actorDeviceId !== commandApproval.deviceId ||
    authorization.sessionId !== commandApproval.sessionId ||
    authorization.capabilityId !== commandApproval.capabilityId ||
    authorization.actionDigest !== commandApproval.actionDigest ||
    /^0{64}$/.test(authorization.authorityStateHash) ||
    !Number.isFinite(verifiedAt) ||
    verifiedAt < authorizedAt ||
    verifiedAt > committedAt
  ) {
    throw new Error(
      "The daemon receipt is not bound to the exact reviewed command authorization."
    );
  }
  return receipt.result as TResult;
}

async function recoverDurablePeerCommand<TResult>(input: {
  actor: PeerRouteActor;
  peerCore: PeerCoreGateway;
  approval: ConsumedHumanApproval;
  commandApproval: z.infer<typeof peerCommandApprovalBindingSchema>;
  daemonOperation: (typeof daemonOperationByApiOperation)[keyof typeof daemonOperationByApiOperation];
  commandId: string;
  now: Date;
}): Promise<DispatchedPeerCommand<TResult>> {
  let receipt: PeerDaemonCommandReceipt;
  try {
    receipt = await input.peerCore.commandReceipt({
      ownerUserId: input.actor.ownerUserId,
      commandId: input.commandId
    });
  } catch {
    markPeerCommandReconciliationRequired({
      commandId: input.commandId,
      ownerUserId: input.actor.ownerUserId,
      reason:
        "The peer daemon outcome is unresolved; an exact durable receipt is required before any local application or redispatch.",
      now: input.now
    });
    throw new HttpError(
      409,
      "peer_command_recovery_required",
      "The peer command outcome is unresolved and requires receipt reconciliation."
    );
  }
  let result: TResult;
  try {
    result = validateCommittedPeerReceipt<TResult>({
      receipt,
      daemonOperation: input.daemonOperation,
      commandId: input.commandId,
      approval: input.approval,
      commandApproval: input.commandApproval
    });
  } catch (error) {
    markPeerCommandReconciliationRequired({
      commandId: input.commandId,
      ownerUserId: input.actor.ownerUserId,
      reason: `SECURITY QUARANTINE: ${
        error instanceof Error ? error.message : "invalid daemon receipt"
      }`,
      now: input.now
    });
    throw new HttpError(
      409,
      "peer_command_security_incident",
      "The peer daemon receipt failed authorization binding and was quarantined."
    );
  }
  const entry = markPeerCommandReceiptRecovered({
    commandId: input.commandId,
    ownerUserId: input.actor.ownerUserId,
    now: input.now
  });
  return {
    entry,
    commandId: input.commandId,
    result,
    alreadyApplied: false
  };
}

async function dispatchDurablePeerCommand<TResult>(input: {
  actor: PeerRouteActor;
  peerCore: PeerCoreGateway;
  approval: ConsumedHumanApproval;
  operationId: PeerApiOperationId;
  targetType: string;
  targetId: string;
  requestHash: string;
  expectedVersion?: string | null;
  retryKey?: string | null;
  now: Date;
  dispatch: (
    commandId: string,
    approvalDeadline: string,
    approval: z.infer<typeof peerCommandApprovalBindingSchema>
  ) => Promise<TResult>;
}): Promise<DispatchedPeerCommand<TResult> | AppliedPeerCommand> {
  const deadline = Date.parse(input.approval.approvalDeadline);
  const validatedAt = Date.parse(input.approval.validatedAt);
  if (!Number.isFinite(deadline) || !Number.isFinite(validatedAt)) {
    throw new HttpError(
      409,
      "peer_human_approval_invalid",
      "The reviewed approval has invalid timing metadata."
    );
  }
  const daemonOperation =
    daemonOperationByApiOperation[
      input.operationId as keyof typeof daemonOperationByApiOperation
    ];
  if (!daemonOperation) {
    throw new Error(
      `Peer operation ${input.operationId} has no daemon command binding.`
    );
  }
  const commandApproval = peerCommandApprovalBindingSchema.parse({
    actorClass: input.actor.principalClass,
    actorId: input.actor.principalId,
    sessionId: input.actor.principalId,
    deviceId: input.actor.deviceId,
    capabilityId: input.approval.capabilityId,
    actionDigest: input.approval.actionDigest,
    capabilityIssuedAt: input.approval.capabilityIssuedAt,
    capabilityExpiresAt: input.approval.approvalDeadline,
    authorizationIssuedAt: input.approval.authorizationIssuedAt
  });
  const commandId = derivePeerCommandId({
    ownerUserId: input.actor.ownerUserId,
    operationId: input.operationId,
    targetType: input.targetType,
    targetId: input.targetId,
    requestHash: input.requestHash,
    retryKey: input.retryKey
  });
  const authorizationId = derivePeerCommandAuthorizationId({
    commandId,
    capabilityId: input.approval.capabilityId,
    actionDigest: input.approval.actionDigest
  });
  const approvalJournalBinding = {
    ownerUserId: input.actor.ownerUserId,
    actorClass: commandApproval.actorClass,
    actorId: commandApproval.actorId,
    sessionId: commandApproval.sessionId,
    deviceId: commandApproval.deviceId,
    capabilityId: commandApproval.capabilityId,
    approvalMethod: input.approval.approvalMethod,
    approvalDeadline: input.approval.approvalDeadline,
    authorizationId,
    authorizationStateHash: hashPeerApiValue({
      authorizationId,
      ownerUserId: input.actor.ownerUserId,
      approval: commandApproval,
      approvalMethod: input.approval.approvalMethod
    })
  } as const;
  const prepared = preparePeerCommand({
    commandId,
    ownerUserId: input.actor.ownerUserId,
    operationId: input.operationId,
    targetType: input.targetType,
    targetId: input.targetId,
    requestHash: input.requestHash,
    expectedVersion: input.expectedVersion,
    approval: approvalJournalBinding,
    now: input.now
  });
  if (prepared.entry.status === "applied") {
    return {
      entry: prepared.entry,
      commandId,
      result: null,
      alreadyApplied: true
    };
  }
  if (prepared.entry.status !== "prepared") {
    return recoverDurablePeerCommand<TResult>({
      actor: input.actor,
      peerCore: input.peerCore,
      approval: input.approval,
      commandApproval,
      daemonOperation,
      commandId,
      now: input.now
    });
  }
  if (deadline <= validatedAt) {
    throw new HttpError(
      409,
      "peer_human_approval_expired",
      "The reviewed approval expired before daemon dispatch."
    );
  }
  const dispatched = markPeerCommandDispatched({
    commandId,
    ownerUserId: input.actor.ownerUserId,
    now: input.now
  });
  if (dispatched.status === "applied") {
    return { entry: dispatched, commandId, result: null, alreadyApplied: true };
  }
  try {
    await input.dispatch(
      commandId,
      input.approval.approvalDeadline,
      commandApproval
    );
  } catch {
    return recoverDurablePeerCommand<TResult>({
      actor: input.actor,
      peerCore: input.peerCore,
      approval: input.approval,
      commandApproval,
      daemonOperation,
      commandId,
      now: input.now
    });
  }
  return recoverDurablePeerCommand<TResult>({
    actor: input.actor,
    peerCore: input.peerCore,
    approval: input.approval,
    commandApproval,
    daemonOperation,
    commandId,
    now: input.now
  });
}

function durablePeerCommandTime(input: {
  ownerUserId: string;
  operationId: PeerApiOperationId;
  targetType: string;
  targetId: string;
  requestHash: string;
  retryKey?: string | null;
  fallback: Date;
}): Date {
  const commandId = derivePeerCommandId(input);
  const existing = getPeerCommand(commandId);
  return existing ? new Date(existing.createdAt) : input.fallback;
}

function applyDurablePeerCommand<TResult, TValue>(input: {
  actor: PeerRouteActor;
  command: DispatchedPeerCommand<TResult>;
  now: Date;
  resultReference?: (result: TResult) => string | null;
  apply: (result: TResult) => TValue;
}): TValue {
  const resultHash = hashPeerApiValue(
    peerCommandHashValue(input.command.result)
  );
  try {
    const applied = applyPeerCommand({
      commandId: input.command.commandId,
      ownerUserId: input.actor.ownerUserId,
      resultHash,
      resultReference: input.resultReference?.(input.command.result) ?? null,
      now: input.now,
      apply: () => input.apply(input.command.result)
    });
    if (!applied.applied || applied.value === null) {
      throw new Error(
        "Peer command was already applied without a replay response."
      );
    }
    return applied.value;
  } catch (error) {
    markPeerCommandReconciliationRequired({
      commandId: input.command.commandId,
      ownerUserId: input.actor.ownerUserId,
      reason: "The peer daemon completed but local state did not commit.",
      now: input.now
    });
    throw error;
  }
}

function relationshipVersion(relationship: PeerRelationshipRow) {
  return relationship.updatedAt;
}

function requireActiveRelationship(
  actor: PeerRouteActor,
  relationshipId: string
) {
  const relationship = currentRelationship(actor, relationshipId);
  if (relationship.status !== "active") {
    throw new HttpError(
      409,
      "peer_relationship_inactive",
      "The peer relationship is not active."
    );
  }
  return relationship;
}

function sanitizedReviewValue(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return "[bounded]";
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((entry) => sanitizedReviewValue(entry, depth + 1));
  }
  if (typeof value !== "object") {
    return "[redacted]";
  }
  const blocked =
    /(secret|token|bootstrap|cipher|private|signature|certificate|public.?key|endpoint|address|host|url|ip)/i;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 200)
      .map(([key, nested]) => [
        key,
        blocked.test(key)
          ? "[redacted]"
          : sanitizedReviewValue(nested, depth + 1)
      ])
  );
}

function requestReadModel(request: PeerPendingRequest) {
  return {
    ...request,
    payload: sanitizedReviewValue(request.payload)
  };
}

function buildGrantPreview(input: {
  actor: PeerRouteActor;
  relationship: PeerRelationshipRow;
  draft: z.infer<typeof peerGrantDraftSchema>;
  sampleLimit: number;
}) {
  const devices = listPeerRelationshipDevices(
    input.actor.ownerUserId,
    input.relationship.id
  );
  const approvedDeviceIds = new Set(
    devices
      .filter((device) => device.status === "approved")
      .map((device) => device.deviceId)
  );
  for (const rule of input.draft.rules) {
    try {
      validateProjectionRule(rule);
    } catch (error) {
      throw new HttpError(
        400,
        "peer_grant_rule_invalid",
        error instanceof Error ? error.message : "A grant rule is invalid.",
        { ruleId: rule.id }
      );
    }
    for (const deviceId of rule.approvedDeviceIds) {
      if (!approvedDeviceIds.has(deviceId)) {
        throw new HttpError(
          409,
          "peer_grant_device_not_approved",
          "A grant rule references a device that is not currently approved.",
          { ruleId: rule.id, deviceId }
        );
      }
    }
  }
  const previewInput = {
    ownerUserId: input.actor.ownerUserId,
    relationshipId: input.relationship.id,
    relationshipVersion: relationshipVersion(input.relationship),
    draft: input.draft
  };
  const allowRules = input.draft.rules.filter(
    (rule) => rule.effect === "allow"
  );
  const maximumResultCount = allowRules.reduce(
    (total, rule) => total + rule.maximumResultCount,
    0
  );
  const maximumPayloadBytes = allowRules.reduce(
    (total, rule) => total + rule.maximumPayloadBytes,
    0
  );
  return {
    hash: hashPeerApiValue(previewInput),
    relationshipVersion: relationshipVersion(input.relationship),
    exact: {
      direction: input.draft.direction,
      rules: input.draft.rules,
      cachePolicy: input.draft.cachePolicy,
      effectiveAt: input.draft.effectiveAt,
      expiresAt: input.draft.expiresAt
    },
    worstCase: {
      projectionIds: [...new Set(allowRules.map((rule) => rule.projectionId))],
      maximumResultCount,
      maximumPayloadBytes,
      maximumRetentionSeconds: input.draft.cachePolicy.maximumRetentionSeconds,
      allShareableRuleCount: allowRules.filter(
        (rule) =>
          rule.entitySelector?.mode === "all_shareable" ||
          rule.entitySelector === null
      ).length,
      currentApprovedDeviceCount: approvedDeviceIds.size
    },
    samples: allowRules.slice(0, input.sampleLimit).map((rule) => ({
      ruleId: rule.id,
      projectionId: rule.projectionId,
      fields: rule.fields.include,
      excludedFields: rule.fields.exclude,
      precision: rule.precision,
      entitySelector: rule.entitySelector,
      time: rule.time
    }))
  };
}

function humanGrantActor(actor: PeerRouteActor, now: Date) {
  return assertHumanGrantActor(
    {
      principalClass: actor.principalClass,
      ownerUserId: actor.ownerUserId,
      principalId: actor.principalId,
      deviceId: actor.deviceId,
      scopes: ["peer:grants:manage"],
      authenticatedAt: actor.authenticatedAt,
      userPresenceAt: now.toISOString()
    },
    { ownerUserId: actor.ownerUserId, now }
  );
}

function proposedGrant(input: {
  actor: PeerRouteActor;
  relationshipId: string;
  draft: z.infer<typeof peerGrantDraftSchema>;
  id?: string;
  now: Date;
}): PeerShareGrantVersion {
  try {
    return peerShareGrantVersionSchema.parse({
      id: input.id ?? `psg_${randomUUID().replaceAll("-", "")}`,
      ownerUserId: input.actor.ownerUserId,
      relationshipId: input.relationshipId,
      direction: input.draft.direction,
      sequence: 1,
      previousVersionHash: null,
      status: "proposed",
      label: input.draft.label,
      purpose: input.draft.purpose,
      issuedAt: input.now.toISOString(),
      effectiveAt: input.draft.effectiveAt,
      expiresAt: input.draft.expiresAt,
      revokedAt: null,
      cachePolicy: input.draft.cachePolicy,
      rules: input.draft.rules,
      signatures: [],
      protocolVersion: PEER_PROTOCOL_VERSION,
      schemaVersion: 1
    });
  } catch {
    throw new HttpError(
      409,
      "peer_grant_draft_stale",
      "The reviewed grant timing is no longer valid; preview it again."
    );
  }
}

function counterGrant(input: {
  previous: PeerShareGrantVersion;
  draft: z.infer<typeof peerGrantDraftSchema>;
  now: Date;
}): PeerShareGrantVersion {
  try {
    return peerShareGrantVersionSchema.parse({
      ...input.previous,
      direction: input.draft.direction,
      sequence: input.previous.sequence + 1,
      previousVersionHash: hashPeerGrantVersion(input.previous),
      status: "countered",
      label: input.draft.label,
      purpose: input.draft.purpose,
      issuedAt: input.now.toISOString(),
      effectiveAt: input.draft.effectiveAt,
      expiresAt: input.draft.expiresAt,
      revokedAt: null,
      cachePolicy: input.draft.cachePolicy,
      rules: input.draft.rules,
      signatures: []
    });
  } catch {
    throw new HttpError(
      409,
      "peer_grant_draft_stale",
      "The reviewed counter-proposal timing is no longer valid; preview it again."
    );
  }
}

function validateGatewayGrant(input: {
  actor: PeerRouteActor;
  relationshipId: string;
  grant: PeerShareGrantVersion;
  expectedStatus: PeerShareGrantVersion["status"];
  previous?: PeerShareGrantVersion;
  expectedPolicy?: PeerShareGrantVersion;
}) {
  const grant = peerShareGrantVersionSchema.parse(input.grant);
  if (
    grant.ownerUserId !== input.actor.ownerUserId ||
    grant.relationshipId !== input.relationshipId ||
    grant.status !== input.expectedStatus
  ) {
    throw new HttpError(
      503,
      "peer_core_grant_invalid",
      "The peer daemon returned a grant outside the reviewed relationship or state."
    );
  }
  if (
    input.expectedPolicy &&
    !peerGrantMatchesReviewedPolicy(grant, input.expectedPolicy)
  ) {
    throw new HttpError(
      503,
      "peer_core_grant_policy_changed",
      "The peer daemon changed fields from the human-reviewed grant."
    );
  }
  const relationshipDevices = new Map(
    listPeerRelationshipDevices(
      input.actor.ownerUserId,
      input.relationshipId
    ).map((device) => [device.deviceId, device] as const)
  );
  const localParty =
    grant.direction === "local_to_remote" ? "grantor" : "grantee";
  for (const signature of grant.signatures) {
    const device = relationshipDevices.get(signature.deviceId);
    const expectedRole =
      grant.direction === "local_to_remote"
        ? signature.party === "grantor"
          ? "local"
          : "remote"
        : signature.party === "grantor"
          ? "remote"
          : "local";
    if (
      !device ||
      device.status !== "approved" ||
      device.principalRole !== expectedRole
    ) {
      throw new HttpError(
        503,
        "peer_core_grant_signer_invalid",
        "The peer daemon returned a signature from an unapproved or mis-bound device."
      );
    }
  }
  if (!grant.signatures.some((signature) => signature.party === localParty)) {
    throw new HttpError(
      503,
      "peer_core_grant_unsigned",
      "The peer daemon did not return the required local grant signature."
    );
  }
  if (input.previous) {
    validateNextPeerGrantVersion(input.previous, grant);
  }
  return grant;
}

function ensureInvitationIdentity(
  ownerUserId: string,
  invitation: { inviterPrincipalId: string; inviterDeviceId: string }
) {
  const row = getDatabase()
    .prepare(
      `SELECT principals.principal_kind AS principalKind,
              principals.trust_state AS principalTrust,
              devices.status AS deviceStatus
       FROM forge_principals AS principals
       JOIN forge_devices AS devices
         ON devices.principal_id = principals.id
        AND devices.owner_user_id = principals.owner_user_id
       WHERE principals.id = ? AND devices.id = ?
         AND principals.owner_user_id = ?
       LIMIT 1`
    )
    .get(
      invitation.inviterPrincipalId,
      invitation.inviterDeviceId,
      ownerUserId
    ) as
    | { principalKind: string; principalTrust: string; deviceStatus: string }
    | undefined;
  if (
    !row ||
    row.principalKind !== "local" ||
    row.principalTrust !== "verified" ||
    row.deviceStatus !== "approved"
  ) {
    throw new HttpError(
      503,
      "peer_local_identity_unavailable",
      "The peer daemon did not use an approved local Forge identity."
    );
  }
}

function ensureApprovedLocalDevice(ownerUserId: string, deviceId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT devices.status, principals.principal_kind AS principalKind,
              principals.trust_state AS principalTrust
       FROM forge_devices AS devices
       JOIN forge_principals AS principals
         ON principals.id = devices.principal_id
        AND principals.owner_user_id = devices.owner_user_id
       WHERE devices.id = ? AND devices.owner_user_id = ? LIMIT 1`
    )
    .get(deviceId, ownerUserId) as
    | { status: string; principalKind: string; principalTrust: string }
    | undefined;
  if (
    !row ||
    row.status !== "approved" ||
    row.principalKind !== "local" ||
    row.principalTrust !== "verified"
  ) {
    throw new HttpError(
      403,
      "peer_local_device_forbidden",
      "Pairing requires an approved local Forge device."
    );
  }
}

export async function registerPeerSharingRoutes(
  app: FastifyInstance,
  dependencies: PeerSharingRouteDependencies
) {
  app.addHook("preSerialization", async (request, reply, payload) => {
    const routePath = request.routeOptions.url;
    if (!routePath) return payload;
    const contract = getPeerRouteContract(
      request.method as PeerRouteMethod,
      routePath
    );
    if (
      contract?.tag !== "Peer sharing" ||
      reply.statusCode < 200 ||
      reply.statusCode >= 300
    ) {
      return payload;
    }
    return parsePeerApiSuccess(
      contract.operationId as PeerApiOperationId,
      payload
    );
  });
  const cursorKey = dependencies.secrets.deriveKey("peer-api-cursors/v1");
  const capabilityHashingKey = dependencies.secrets.deriveKey(
    "peer-presence-capabilities/v1"
  );
  const challengeHashingKey = dependencies.secrets.deriveKey(
    "peer-webauthn-challenges/v1"
  );
  const companionChallengeHashingKey = dependencies.secrets.deriveKey(
    "peer-companion-consent-challenges/v2"
  );
  const companionEnrollmentChallengeHashingKey = dependencies.secrets.deriveKey(
    "peer-companion-enrollment-challenges/v2"
  );
  const sessionBindingKey = dependencies.secrets.deriveKey(
    "peer-presence-session-binding/v1"
  );
  const presenceStore = new SqlitePeerPresenceStore(sessionBindingKey);
  const limiter = dependencies.rateLimiter ?? new PeerOperationRateLimiter();

  app.post("/api/v1/peers/companion-enrollments/options", async (request) => {
    const body =
      PEER_API_SCHEMAS.createPeerCompanionEnrollmentOptions.body!.parse(
        request.body ?? {}
      ) as z.infer<
        NonNullable<
          (typeof PEER_API_SCHEMAS)["createPeerCompanionEnrollmentOptions"]["body"]
        >
      >;
    const actor = await authenticateCompanionEnrollmentOperator(
      dependencies,
      request,
      "createPeerCompanionEnrollmentOptions"
    );
    consumeRateLimit(
      limiter,
      actor,
      "createPeerCompanionEnrollmentOptions",
      10,
      nowFrom(dependencies)
    );
    try {
      return createPeerCompanionEnrollmentOptions({
        body,
        ownerUserId: actor.ownerUserId,
        operatorSessionId: actor.principalId,
        challengeHashingKey: companionEnrollmentChallengeHashingKey,
        now: nowFrom(dependencies)
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        400,
        "peer_companion_enrollment_options_rejected",
        error instanceof Error
          ? error.message
          : "Secure companion enrollment options were rejected."
      );
    }
  });

  app.post("/api/v1/peers/companion-enrollments/verify", async (request) => {
    const body = PEER_API_SCHEMAS.verifyPeerCompanionEnrollment.body!.parse(
      request.body ?? {}
    ) as z.infer<
      NonNullable<
        (typeof PEER_API_SCHEMAS)["verifyPeerCompanionEnrollment"]["body"]
      >
    >;
    const actor = await authenticateCompanionEnrollmentOperator(
      dependencies,
      request,
      "verifyPeerCompanionEnrollment"
    );
    consumeRateLimit(
      limiter,
      actor,
      "verifyPeerCompanionEnrollment",
      10,
      nowFrom(dependencies)
    );
    try {
      return verifyPeerCompanionEnrollment({
        body,
        ownerUserId: actor.ownerUserId,
        operatorSessionId: actor.principalId,
        challengeHashingKey: companionEnrollmentChallengeHashingKey,
        now: nowFrom(dependencies)
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        409,
        "peer_companion_enrollment_verification_failed",
        error instanceof Error
          ? error.message
          : "Secure companion enrollment verification failed."
      );
    }
  });

  app.get("/api/v1/peers/human-presence", async (request) => {
    const authenticatedActor = await authenticatePeerRoute(
      dependencies,
      request,
      "getPeerHumanPresenceStatus"
    );
    const actor = operatorStatusReadActor(
      authenticatedActor,
      request,
      dependencies
    );
    consumeRateLimit(
      limiter,
      actor,
      "getPeerHumanPresenceStatus",
      120,
      nowFrom(dependencies)
    );
    const [health, localIdentity] = await Promise.all([
      dependencies.peerCore.health().catch(() => ({
        enabled: false,
        healthy: false,
        protocolVersion: null,
        reason: "Peer connectivity health could not be read."
      })),
      dependencies.peerCore
        .localIdentity({ ownerUserId: actor.ownerUserId })
        .catch(() => null)
    ]);
    const peerCore = {
      ...health,
      localDeviceId: localIdentity?.device.id ?? null
    };
    if (actor.principalClass === "operator_session") {
      const set = activeCredentialSet(actor, presenceStore, dependencies);
      const credentials = listPeerPresenceCredentialSummaries(
        actor.ownerUserId
      );
      return {
        methods: {
          webauthn: {
            available: true,
            firstCredentialBootstrapAllowed:
              set.credentials.length === 0 && set.relyingParty.loopback,
            credentialSetVersion: set.version,
            rpId: set.relyingParty.rpId
          },
          companionConsent: { available: false }
        },
        credentials,
        peerCore
      };
    }
    return {
      methods: {
        webauthn: { available: false },
        companionConsent: {
          available: true,
          protocol: PEER_COMPANION_CONSENT_PROTOCOL,
          requestProtocol: PEER_COMPANION_REQUEST_PROTOCOL,
          deviceId: actor.deviceId,
          scopes: PEER_COMPANION_SCOPES,
          capabilities: PEER_COMPANION_CAPABILITIES,
          authorizedOperations: PEER_COMPANION_AUTHORIZED_OPERATION_IDS
        }
      },
      credentials: [],
      peerCore
    };
  });

  app.post("/api/v1/peers/human-presence/options", async (request, reply) => {
    const body = PEER_API_SCHEMAS.createPeerHumanPresenceOptions.body!.parse(
      request.body ?? {}
    ) as z.infer<
      NonNullable<
        (typeof PEER_API_SCHEMAS)["createPeerHumanPresenceOptions"]["body"]
      >
    >;
    const actor = await authenticatePeerRoute(
      dependencies,
      request,
      "createPeerHumanPresenceOptions"
    );
    consumeRateLimit(
      limiter,
      actor,
      "createPeerHumanPresenceOptions",
      30,
      nowFrom(dependencies)
    );
    if (body.ceremony === "companion_consent") {
      if (
        actor.principalClass !== "companion_session" ||
        !actor.deviceId ||
        !actor.companionKeyId ||
        body.companionDeviceId !== actor.deviceId
      ) {
        throw new HttpError(
          403,
          "peer_companion_consent_device_mismatch",
          "Companion consent must use the authenticated device key."
        );
      }
      validatePresenceActionTarget({
        dependencies,
        actor,
        action: body.action,
        store: presenceStore
      });
      try {
        return createPeerCompanionConsentOptions({
          action: body.action,
          ownerUserId: actor.ownerUserId,
          principalId: actor.principalId,
          deviceId: actor.deviceId,
          keyId: actor.companionKeyId,
          challengeHashingKey: companionChallengeHashingKey,
          sessionBindingKey,
          now: nowFrom(dependencies)
        });
      } catch (error) {
        throw new HttpError(
          409,
          "peer_companion_consent_options_rejected",
          error instanceof Error
            ? error.message
            : "Companion consent options were rejected."
        );
      }
    }
    const set = activeCredentialSet(actor, presenceStore, dependencies);
    validatePresenceActionTarget({
      dependencies,
      actor,
      action: body.action,
      store: presenceStore
    });
    if (body.ceremony === "register" && set.credentials.length > 0) {
      const registrationAction = buildPresenceAction({
        actor,
        operationId: "createPeerHumanPresenceOptions",
        expectedVersion: set.version,
        body: {
          ceremony: "register",
          credentialLabel: body.credentialLabel!
        }
      });
      if (
        digestPeerPresenceAction(registrationAction) !==
        digestPeerPresenceAction(body.action)
      ) {
        throw new HttpError(
          409,
          "peer_registration_approval_mismatch",
          "Adding an approval credential requires approval of that exact registration."
        );
      }
      consumeHumanApproval({
        dependencies,
        actor,
        request,
        reply,
        store: presenceStore,
        capabilityHashingKey,
        action: registrationAction
      });
    }
    try {
      return await createPeerWebAuthnOptions({
        ceremony: body.ceremony,
        action: body.action,
        principal: requireHumanActor(actor),
        origin: set.relyingParty.origin,
        credentialLabel: body.credentialLabel,
        additionalRegistrationAuthorized:
          body.ceremony === "register" && set.credentials.length > 0,
        hashingKey: challengeHashingKey,
        store: presenceStore,
        now: nowFrom(dependencies)
      });
    } catch (error) {
      throw new HttpError(
        409,
        "peer_webauthn_options_rejected",
        error instanceof Error
          ? error.message
          : "WebAuthn options were rejected."
      );
    }
  });

  app.post("/api/v1/peers/human-presence/verify", async (request, reply) => {
    const body = PEER_API_SCHEMAS.verifyPeerHumanPresence.body!.parse(
      request.body ?? {}
    ) as z.infer<
      NonNullable<(typeof PEER_API_SCHEMAS)["verifyPeerHumanPresence"]["body"]>
    >;
    const actor = await authenticatePeerRoute(
      dependencies,
      request,
      "verifyPeerHumanPresence"
    );
    consumeRateLimit(
      limiter,
      actor,
      "verifyPeerHumanPresence",
      30,
      nowFrom(dependencies)
    );
    validatePresenceActionTarget({
      dependencies,
      actor,
      action: body.action,
      store: presenceStore
    });
    if (body.verification.kind === "companion_signature") {
      if (
        actor.principalClass !== "companion_session" ||
        !actor.deviceId ||
        !actor.companionKeyId ||
        body.verification.deviceId !== actor.deviceId ||
        body.verification.keyId !== actor.companionKeyId ||
        body.verification.algorithm !== "ES256"
      ) {
        throw new HttpError(
          403,
          "peer_companion_consent_device_mismatch",
          "Companion consent must use the authenticated device key."
        );
      }
      try {
        const verified = verifyPeerCompanionConsent({
          challengeId: body.challengeId,
          challenge: body.verification.challenge,
          signature: body.verification.signature,
          algorithm: body.verification.algorithm,
          keyId: body.verification.keyId,
          action: body.action,
          ownerUserId: actor.ownerUserId,
          principalId: actor.principalId,
          deviceId: actor.deviceId,
          challengeHashingKey: companionChallengeHashingKey,
          sessionBindingKey,
          capabilityHashingKey,
          presenceStore,
          now: nowFrom(dependencies)
        });
        const principal: PeerPresencePrincipal = {
          principalClass: "companion_consent",
          principalId: actor.principalId,
          ownerUserId: actor.ownerUserId,
          origin: null
        };
        recordPeerPresenceAudit({
          ownerUserId: actor.ownerUserId,
          eventType: "peer_companion_consent_verified",
          outcome: "allowed",
          principal,
          challengeId: body.challengeId,
          capabilityId: verified.capability.record.id,
          actionDigest: verified.actionDigest,
          evidence: { deviceId: actor.deviceId }
        });
        reply.header(
          "set-cookie",
          peerPresenceCapabilityCookie({
            capabilityId: verified.capability.record.id,
            secret: verified.capability.secret,
            secure: request.protocol === "https"
          })
        );
        return {
          approved: true,
          protocol: PEER_COMPANION_CONSENT_PROTOCOL,
          capabilityId: verified.capability.record.id,
          expiresAt: verified.capability.record.expiresAt,
          deviceId: actor.deviceId,
          actionDigest: verified.actionDigest
        };
      } catch (error) {
        recordPeerPresenceAudit({
          ownerUserId: actor.ownerUserId,
          eventType: "peer_companion_consent_verified",
          outcome: "denied",
          principal: {
            principalClass: "companion_consent",
            principalId: actor.principalId,
            ownerUserId: actor.ownerUserId,
            origin: null
          },
          actionDigest: digestPeerPresenceAction(body.action),
          evidence: {
            deviceId: actor.deviceId,
            reason:
              error instanceof Error ? error.message.slice(0, 500) : "unknown"
          }
        });
        throw new HttpError(
          409,
          "peer_companion_consent_verification_failed",
          error instanceof Error
            ? error.message
            : "Companion consent verification failed."
        );
      }
    }
    const relyingParty = operatorRelyingParty(actor, dependencies);
    try {
      const verified = await verifyPeerWebAuthnCeremony({
        challengeId: body.challengeId,
        action: body.action,
        principal: requireHumanActor(actor),
        origin: relyingParty.origin,
        response: body.verification.response,
        capabilityId: `phc_${randomUUID().replaceAll("-", "")}`,
        capabilityHashingKey,
        challengeHashingKey,
        store: presenceStore,
        now: nowFrom(dependencies)
      });
      presenceStore.storeCapability(
        verified.capability.record,
        body.challengeId
      );
      recordPeerPresenceAudit({
        ownerUserId: actor.ownerUserId,
        eventType: "peer_webauthn_verified",
        outcome: "allowed",
        principal: requireHumanActor(actor),
        credentialId: verified.credential.id,
        challengeId: body.challengeId,
        capabilityId: verified.capability.record.id,
        actionDigest: verified.capability.record.actionDigest
      });
      reply.header(
        "set-cookie",
        peerPresenceCapabilityCookie({
          capabilityId: verified.capability.record.id,
          secret: verified.capability.secret,
          secure: relyingParty.origin.startsWith("https://")
        })
      );
      return {
        approved: true,
        expiresAt: verified.capability.record.expiresAt,
        credential: {
          id: verified.credential.id,
          label: verified.credential.label,
          deviceType: verified.credential.deviceType,
          backedUp: verified.credential.backedUp,
          createdAt: verified.credential.createdAt,
          lastUsedAt: verified.credential.lastUsedAt
        }
      };
    } catch (error) {
      throw new HttpError(
        409,
        "peer_webauthn_verification_failed",
        error instanceof Error ? error.message : "WebAuthn verification failed."
      );
    }
  });

  app.delete(
    "/api/v1/peers/human-presence/credentials/:credentialId",
    async (request, reply) => {
      const params =
        PEER_API_SCHEMAS.revokePeerHumanPresenceCredential.params.parse(
          request.params ?? {}
        ) as { credentialId: string };
      const actor = await authenticatePeerRoute(
        dependencies,
        request,
        "revokePeerHumanPresenceCredential"
      );
      const set = activeCredentialSet(actor, presenceStore, dependencies);
      const target = set.credentials.find(
        (credential) => credential.id === params.credentialId
      );
      if (!target) {
        throw new HttpError(
          404,
          "peer_presence_credential_not_found",
          "Approval credential not found for this Forge origin."
        );
      }
      if (set.credentials.length < 2) {
        throw new HttpError(
          409,
          "peer_presence_last_credential",
          "At least one active approval credential must remain."
        );
      }
      const action = buildPresenceAction({
        actor,
        operationId: "revokePeerHumanPresenceCredential",
        pathParams: { credentialId: params.credentialId },
        expectedVersion: set.version,
        body: {}
      });
      const cookie =
        actor.presenceCapability ??
        readPeerPresenceCapabilityCookie(requestedCookie(request));
      if (!cookie) {
        throw new HttpError(
          409,
          "peer_human_approval_required",
          "Approve this credential deletion with another credential."
        );
      }
      const evidence = getDatabase()
        .prepare(
          `SELECT audit.credential_id AS credentialId
           FROM forge_human_presence_audit_events AS audit
           JOIN forge_webauthn_credentials AS credentials
             ON credentials.id = audit.credential_id
            AND credentials.owner_user_id = audit.owner_user_id
           WHERE audit.owner_user_id = ? AND audit.capability_id = ?
             AND audit.event_type = 'peer_webauthn_verified'
             AND audit.outcome = 'allowed' AND credentials.status = 'active'
             AND credentials.rp_id = ?
           ORDER BY audit.created_at DESC LIMIT 1`
        )
        .get(actor.ownerUserId, cookie.capabilityId, set.relyingParty.rpId) as
        | { credentialId: string }
        | undefined;
      if (!evidence || evidence.credentialId === params.credentialId) {
        throw new HttpError(
          409,
          "peer_presence_self_revocation_forbidden",
          "A credential cannot authorize its own deletion."
        );
      }
      consumeHumanApproval({
        dependencies,
        actor,
        request,
        reply,
        store: presenceStore,
        capabilityHashingKey,
        action
      });
      if (
        !revokePeerPresenceCredential({
          ownerUserId: actor.ownerUserId,
          credentialId: params.credentialId,
          now: nowFrom(dependencies)
        })
      ) {
        throw new HttpError(
          409,
          "peer_presence_credential_conflict",
          "The approval credential changed before deletion."
        );
      }
      return reply
        .code(200)
        .send({ revoked: true, credentialId: params.credentialId });
    }
  );

  app.post("/api/v1/peers/invitations", async (request, reply) => {
    const rawBody = request.body ?? {};
    const body = PEER_API_SCHEMAS.createPeerInvitation.body!.parse(
      rawBody
    ) as z.infer<
      NonNullable<(typeof PEER_API_SCHEMAS)["createPeerInvitation"]["body"]>
    >;
    const actor = await authenticatePeerRoute(
      dependencies,
      request,
      "createPeerInvitation"
    );
    consumeRateLimit(
      limiter,
      actor,
      "createPeerInvitation",
      20,
      nowFrom(dependencies)
    );
    const idempotency = readIdempotent({
      ownerUserId: actor.ownerUserId,
      operationId: "createPeerInvitation",
      idempotencyKey: body.idempotencyKey,
      body: rawBody,
      secrets: dependencies.secrets,
      now: nowFrom(dependencies)
    });
    const action = buildPresenceAction({
      actor,
      operationId: "createPeerInvitation",
      expectedVersion: null,
      body: rawBody
    });
    if (idempotency.stored) {
      if (actor.principalClass === "companion_consent") {
        consumeHumanApprovalOrRecover({
          dependencies,
          actor,
          request,
          reply,
          store: presenceStore,
          capabilityHashingKey,
          action,
          approvedRecovery: true
        });
      }
      return sendStored(reply, idempotency.stored);
    }
    await requireHealthyPeerCore(dependencies);
    const commandId = derivePeerCommandId({
      ownerUserId: actor.ownerUserId,
      operationId: "createPeerInvitation",
      targetType: "invitation",
      targetId: body.idempotencyKey,
      requestHash: idempotency.requestHash,
      retryKey: body.idempotencyKey
    });
    const priorCommand = getPeerCommand(commandId);
    const approvedRecovery =
      priorCommand?.ownerUserId === actor.ownerUserId &&
      [
        "prepared",
        "dispatched",
        "applied",
        "failed",
        "reconciliation_required"
      ].includes(priorCommand.status);
    const approval = consumeHumanApprovalOrRecover({
      dependencies,
      actor,
      request,
      reply,
      store: presenceStore,
      capabilityHashingKey,
      action,
      approvedRecovery
    });
    const issuedAt = durablePeerCommandTime({
      ownerUserId: actor.ownerUserId,
      operationId: "createPeerInvitation",
      targetType: "invitation",
      targetId: body.idempotencyKey,
      requestHash: idempotency.requestHash,
      retryKey: body.idempotencyKey,
      fallback: nowFrom(dependencies)
    });
    const expectedExpiresAt = new Date(
      issuedAt.getTime() + body.expiresInSeconds * 1_000
    ).toISOString();
    try {
      const command = await dispatchDurablePeerCommand({
        actor,
        peerCore: dependencies.peerCore,
        approval,
        operationId: "createPeerInvitation",
        targetType: "invitation",
        targetId: body.idempotencyKey,
        requestHash: idempotency.requestHash,
        retryKey: body.idempotencyKey,
        now: issuedAt,
        dispatch: (commandId, approvalDeadline, commandApproval) =>
          dependencies.peerCore.createInvitation({
            commandId,
            approvalDeadline,
            approval: commandApproval,
            ownerUserId: actor.ownerUserId,
            label: body.label,
            expiresAt: expectedExpiresAt,
            privacyMode: body.privacyMode,
            transportKinds: body.transportKinds
          })
      });
      if (command.alreadyApplied) {
        const stored = readPeerIdempotency({
          ownerUserId: actor.ownerUserId,
          operationId: "createPeerInvitation",
          idempotencyKey: body.idempotencyKey,
          requestHash: idempotency.requestHash,
          secrets: dependencies.secrets,
          now: issuedAt
        });
        if (stored) return sendStored(reply, stored);
        throw new HttpError(
          409,
          "peer_command_recovery_required",
          "The invitation command was applied but its response requires reconciliation."
        );
      }
      const response = applyDurablePeerCommand({
        actor,
        command,
        now: issuedAt,
        resultReference: (material) => material.invitation.id,
        apply: (material) => {
          if (
            material.invitation.expiresAt !== expectedExpiresAt ||
            JSON.stringify([...material.invitation.transportKinds].sort()) !==
              JSON.stringify([...body.transportKinds].sort())
          ) {
            throw new HttpError(
              503,
              "peer_core_invitation_invalid",
              "The peer daemon changed the reviewed invitation lifetime or transports."
            );
          }
          ensureInvitationIdentity(actor.ownerUserId, material.invitation);
          createPeerInvitationRecord({
            ownerUserId: actor.ownerUserId,
            invitation: material.invitation,
            bootstrapCiphertext: material.bootstrapCiphertext,
            bootstrapNonce: material.bootstrapNonce,
            bootstrapHash: material.bootstrapHash,
            now: issuedAt
          });
          const nextResponse = { invitation: material.invitation };
          storeIdempotent({
            ownerUserId: actor.ownerUserId,
            operationId: "createPeerInvitation",
            idempotencyKey: body.idempotencyKey,
            requestHash: idempotency.requestHash,
            status: 201,
            response: nextResponse,
            encryptedResponse: {
              secrets: dependencies.secrets,
              reference: material.invitation.id,
              expiresAt: material.invitation.expiresAt
            },
            now: issuedAt
          });
          return nextResponse;
        }
      });
      return reply.code(201).send(response);
    } catch (error) {
      return peerCoreFailure(error);
    }
  });

  app.get("/api/v1/peers/invitations/:invitationId", async (request) => {
    const params = PEER_API_SCHEMAS.getPeerInvitationStatus.params.parse(
      request.params ?? {}
    ) as { invitationId: string };
    const actor = await authenticatePeerRoute(
      dependencies,
      request,
      "getPeerInvitationStatus"
    );
    const invitation = getPeerInvitationStatus(
      actor.ownerUserId,
      params.invitationId,
      nowFrom(dependencies)
    );
    if (!invitation) {
      throw new HttpError(
        404,
        "peer_invitation_not_found",
        "Peer invitation not found."
      );
    }
    return { invitation };
  });

  app.delete(
    "/api/v1/peers/invitations/:invitationId",
    async (request, reply) => {
      const params = PEER_API_SCHEMAS.cancelPeerInvitation.params.parse(
        request.params ?? {}
      ) as { invitationId: string };
      const rawBody = request.body ?? {};
      const body = PEER_API_SCHEMAS.cancelPeerInvitation.body!.parse(
        rawBody
      ) as { expectedVersion?: string };
      const actor = await authenticatePeerRoute(
        dependencies,
        request,
        "cancelPeerInvitation"
      );
      const invitation = getPeerInvitationStatus(
        actor.ownerUserId,
        params.invitationId,
        nowFrom(dependencies)
      );
      if (!invitation) {
        throw new HttpError(
          404,
          "peer_invitation_not_found",
          "Peer invitation not found."
        );
      }
      const expectedVersion =
        body.expectedVersion ?? invitationVersion(invitation);
      const action = buildPresenceAction({
        actor,
        operationId: "cancelPeerInvitation",
        pathParams: { invitationId: params.invitationId },
        expectedVersion,
        body: rawBody
      });
      if (invitation.status === "canceled") {
        if (actor.principalClass === "companion_consent") {
          consumeHumanApprovalOrRecover({
            dependencies,
            actor,
            request,
            reply,
            store: presenceStore,
            capabilityHashingKey,
            action,
            approvedRecovery: true
          });
        }
        return { canceled: true, invitationId: params.invitationId };
      }
      const cancel = requireManagementGatewayMethod(
        dependencies,
        "cancelInvitation"
      );
      await requireHealthyPeerCore(dependencies);
      const now = nowFrom(dependencies);
      const requestHash = hashPeerApiValue({
        invitationId: params.invitationId,
        expectedVersion,
        body: rawBody
      });
      const commandId = derivePeerCommandId({
        ownerUserId: actor.ownerUserId,
        operationId: "cancelPeerInvitation",
        targetType: "invitation",
        targetId: params.invitationId,
        requestHash
      });
      const priorCommand = getPeerCommand(commandId);
      const approvedRecovery =
        priorCommand?.ownerUserId === actor.ownerUserId &&
        [
          "prepared",
          "dispatched",
          "applied",
          "failed",
          "reconciliation_required"
        ].includes(priorCommand.status);
      const approval = consumeHumanApprovalOrRecover({
        dependencies,
        actor,
        request,
        reply,
        store: presenceStore,
        capabilityHashingKey,
        action,
        approvedRecovery
      });
      try {
        const command = await dispatchDurablePeerCommand({
          actor,
          peerCore: dependencies.peerCore,
          approval,
          operationId: "cancelPeerInvitation",
          targetType: "invitation",
          targetId: params.invitationId,
          requestHash,
          expectedVersion,
          now,
          dispatch: (commandId, approvalDeadline, commandApproval) =>
            cancel({
              commandId,
              approvalDeadline,
              approval: commandApproval,
              ownerUserId: actor.ownerUserId,
              invitationId: params.invitationId
            })
        });
        if (command.alreadyApplied) {
          return { canceled: true, invitationId: params.invitationId };
        }
        return applyDurablePeerCommand({
          actor,
          command,
          now,
          apply: () => {
            if (
              !cancelPeerInvitationRecord({
                ownerUserId: actor.ownerUserId,
                invitationId: params.invitationId,
                now
              })
            ) {
              throw new HttpError(
                409,
                "peer_invitation_conflict",
                "The invitation changed before cancellation."
              );
            }
            return { canceled: true, invitationId: params.invitationId };
          }
        });
      } catch (error) {
        return peerCoreFailure(error);
      }
    }
  );

  app.post("/api/v1/peers/pairings/accept", async (request, reply) => {
    const rawBody = request.body ?? {};
    const body = PEER_API_SCHEMAS.acceptScannedPeerPairing.body!.parse(
      rawBody
    ) as z.infer<
      NonNullable<(typeof PEER_API_SCHEMAS)["acceptScannedPeerPairing"]["body"]>
    >;
    const actor = await authenticatePeerRoute(
      dependencies,
      request,
      "acceptScannedPeerPairing"
    );
    const now = nowFrom(dependencies);
    const idempotency = readIdempotent({
      ownerUserId: actor.ownerUserId,
      operationId: "acceptScannedPeerPairing",
      idempotencyKey: body.idempotencyKey,
      body: rawBody,
      now
    });
    const action = buildPresenceAction({
      actor,
      operationId: "acceptScannedPeerPairing",
      expectedVersion: null,
      body: rawBody
    });
    if (idempotency.stored) {
      if (actor.principalClass === "companion_consent") {
        consumeHumanApprovalOrRecover({
          dependencies,
          actor,
          request,
          reply,
          store: presenceStore,
          capabilityHashingKey,
          action,
          approvedRecovery: true
        });
      }
      return sendStored(reply, idempotency.stored);
    }
    const commandId = derivePeerCommandId({
      ownerUserId: actor.ownerUserId,
      operationId: "acceptScannedPeerPairing",
      targetType: "invitation",
      targetId: body.invitation.id,
      requestHash: idempotency.requestHash,
      retryKey: body.idempotencyKey
    });
    const priorCommand = getPeerCommand(commandId);
    const isApprovedRecovery =
      priorCommand?.ownerUserId === actor.ownerUserId &&
      [
        "prepared",
        "dispatched",
        "applied",
        "failed",
        "reconciliation_required"
      ].includes(priorCommand.status);
    const scannedAt = Date.parse(body.scannedAt);
    if (
      !isApprovedRecovery &&
      (Date.parse(body.invitation.expiresAt) <= now.getTime() ||
        scannedAt > now.getTime() + 5 * 60_000 ||
        scannedAt < now.getTime() - 15 * 60_000)
    ) {
      throw new HttpError(
        409,
        "peer_pairing_scan_stale",
        "The scanned pairing invitation is expired or outside the accepted time window."
      );
    }
    ensureApprovedLocalDevice(actor.ownerUserId, body.localDeviceId);
    await requireHealthyPeerCore(dependencies);
    const approval = consumeHumanApprovalOrRecover({
      dependencies,
      actor,
      request,
      reply,
      store: presenceStore,
      capabilityHashingKey,
      action,
      approvedRecovery: isApprovedRecovery
    });
    try {
      const command = await dispatchDurablePeerCommand({
        actor,
        peerCore: dependencies.peerCore,
        approval,
        operationId: "acceptScannedPeerPairing",
        targetType: "invitation",
        targetId: body.invitation.id,
        requestHash: idempotency.requestHash,
        retryKey: body.idempotencyKey,
        now,
        dispatch: (nextCommandId, approvalDeadline, commandApproval) =>
          dependencies.peerCore.acceptInvitation({
            commandId: nextCommandId,
            approvalDeadline,
            approval: commandApproval,
            ownerUserId: actor.ownerUserId,
            invitation: body.invitation,
            localDeviceId: body.localDeviceId,
            privacyMode: body.privacyMode,
            scannedAt: body.scannedAt
          })
      });
      if (command.alreadyApplied) {
        const pending = command.entry.resultReference
          ? getPeerPendingRequest(
              actor.ownerUserId,
              command.entry.resultReference
            )
          : null;
        if (!pending) {
          throw new HttpError(
            409,
            "peer_command_recovery_required",
            "The pairing acceptance was applied but its request record requires reconciliation."
          );
        }
        const response = { request: requestReadModel(pending) };
        storeIdempotent({
          ownerUserId: actor.ownerUserId,
          operationId: "acceptScannedPeerPairing",
          idempotencyKey: body.idempotencyKey,
          requestHash: idempotency.requestHash,
          status: 202,
          response,
          now
        });
        reply.header("x-forge-idempotent-replay", "true");
        return reply.code(202).send(response);
      }
      const response = applyDurablePeerCommand({
        actor,
        command,
        now,
        resultReference: (accepted) => accepted.requestId,
        apply: (accepted) => {
          const pending = createPeerPendingRequest({
            ownerUserId: actor.ownerUserId,
            kind: "pairing",
            payload: accepted.requestPayload,
            expiresAt: accepted.expiresAt,
            id: accepted.requestId,
            now
          });
          const nextResponse = { request: requestReadModel(pending) };
          storeIdempotent({
            ownerUserId: actor.ownerUserId,
            operationId: "acceptScannedPeerPairing",
            idempotencyKey: body.idempotencyKey,
            requestHash: idempotency.requestHash,
            status: 202,
            response: nextResponse,
            now
          });
          return nextResponse;
        }
      });
      return reply.code(202).send(response);
    } catch (error) {
      return peerCoreFailure(error);
    }
  });

  app.post(
    "/api/v1/peers/pairings/:pairingId/confirm",
    async (request, reply) => {
      const params = PEER_API_SCHEMAS.confirmPeerPairing.params.parse(
        request.params ?? {}
      ) as { pairingId: string };
      const rawBody = request.body ?? {};
      const body = PEER_API_SCHEMAS.confirmPeerPairing.body!.parse(
        rawBody
      ) as z.infer<
        NonNullable<(typeof PEER_API_SCHEMAS)["confirmPeerPairing"]["body"]>
      >;
      const actor = await authenticatePeerRoute(
        dependencies,
        request,
        "confirmPeerPairing"
      );
      const idempotency = readIdempotent({
        ownerUserId: actor.ownerUserId,
        operationId: "confirmPeerPairing",
        idempotencyKey: body.idempotencyKey,
        body: rawBody,
        now: nowFrom(dependencies)
      });
      const action = buildPresenceAction({
        actor,
        operationId: "confirmPeerPairing",
        pathParams: { pairingId: params.pairingId },
        expectedVersion: body.expectedVersion,
        body: rawBody
      });
      if (idempotency.stored) {
        if (actor.principalClass === "companion_consent") {
          consumeHumanApprovalOrRecover({
            dependencies,
            actor,
            request,
            reply,
            store: presenceStore,
            capabilityHashingKey,
            action,
            approvedRecovery: true
          });
        }
        return sendStored(reply, idempotency.stored);
      }
      const commandId = derivePeerCommandId({
        ownerUserId: actor.ownerUserId,
        operationId: "confirmPeerPairing",
        targetType: "pairing",
        targetId: params.pairingId,
        requestHash: idempotency.requestHash,
        retryKey: body.idempotencyKey
      });
      const priorCommand = getPeerCommand(commandId);
      const approvedRecovery =
        priorCommand?.ownerUserId === actor.ownerUserId &&
        [
          "prepared",
          "dispatched",
          "applied",
          "failed",
          "reconciliation_required"
        ].includes(priorCommand.status);
      const pending = getPeerPendingRequest(
        actor.ownerUserId,
        params.pairingId
      );
      if (
        !pending ||
        pending.kind !== "pairing" ||
        pending.status !== "pending"
      ) {
        throw new HttpError(
          404,
          "peer_pairing_not_found",
          "Pending peer pairing not found."
        );
      }
      requireVersion(
        String(pending.version),
        body.expectedVersion,
        "Peer pairing"
      );
      if (!dependencies.persistPairingConfirmation) {
        throw new HttpError(
          503,
          "peer_pairing_persistence_unavailable",
          "Verified pairing persistence is not configured."
        );
      }
      await requireHealthyPeerCore(dependencies);
      const approval = consumeHumanApprovalOrRecover({
        dependencies,
        actor,
        request,
        reply,
        store: presenceStore,
        capabilityHashingKey,
        action,
        approvedRecovery
      });
      try {
        const now = nowFrom(dependencies);
        const command = await dispatchDurablePeerCommand({
          actor,
          peerCore: dependencies.peerCore,
          approval,
          operationId: "confirmPeerPairing",
          targetType: "pairing",
          targetId: params.pairingId,
          requestHash: idempotency.requestHash,
          expectedVersion: body.expectedVersion,
          retryKey: body.idempotencyKey,
          now,
          dispatch: (commandId, approvalDeadline, commandApproval) =>
            dependencies.peerCore.confirmPairing({
              commandId,
              approvalDeadline,
              approval: commandApproval,
              ownerUserId: actor.ownerUserId,
              pairingId: params.pairingId,
              requestPayload: pending.payload,
              transcriptHash: body.transcriptHash,
              verificationPhrase: body.verificationPhrase
            })
        });
        if (command.alreadyApplied) {
          const stored = readPeerIdempotency({
            ownerUserId: actor.ownerUserId,
            operationId: "confirmPeerPairing",
            idempotencyKey: body.idempotencyKey,
            requestHash: idempotency.requestHash,
            now
          });
          if (stored) return sendStored(reply, stored);
          throw new HttpError(
            409,
            "peer_command_recovery_required",
            "The pairing was applied but its response requires reconciliation."
          );
        }
        return applyDurablePeerCommand({
          actor,
          command,
          now,
          resultReference: (confirmation) => confirmation.relationship.id,
          apply: (confirmation) => {
            const persisted = dependencies.persistPairingConfirmation!({
              ownerUserId: actor.ownerUserId,
              pairingId: params.pairingId,
              expectedPendingVersion: pending.version,
              confirmation,
              personId: body.personId,
              createPersonDisplayName: body.createPersonDisplayName,
              actorClass: actor.principalClass,
              actorId: actor.principalId,
              now
            });
            const decided = getPeerPendingRequest(
              actor.ownerUserId,
              params.pairingId
            );
            if (
              !decided ||
              decided.status !== "accepted" ||
              decided.version !== pending.version + 1 ||
              decided.payloadHash !== pending.payloadHash ||
              decided.decisionReason !== "pairing_confirmed" ||
              decided.decidedAt !== now.toISOString() ||
              decided.updatedAt !== now.toISOString()
            ) {
              throw new HttpError(
                409,
                "peer_pairing_conflict",
                "The pairing request changed during confirmation."
              );
            }
            const response = {
              relationshipId: persisted.relationshipId,
              request: requestReadModel(decided)
            };
            storeIdempotent({
              ownerUserId: actor.ownerUserId,
              operationId: "confirmPeerPairing",
              idempotencyKey: body.idempotencyKey,
              requestHash: idempotency.requestHash,
              status: 200,
              response,
              now
            });
            return response;
          }
        });
      } catch (error) {
        return peerCoreFailure(error);
      }
    }
  );

  app.get("/api/v1/peers/requests", async (request) => {
    const query = PEER_API_SCHEMAS.listPeerRequests.query.parse(
      request.query ?? {}
    ) as z.infer<(typeof PEER_API_SCHEMAS)["listPeerRequests"]["query"]>;
    const actor = await authenticatePeerRoute(
      dependencies,
      request,
      "listPeerRequests"
    );
    const cursor = decodePeerCursor(query.cursor, {
      kind: `peer-requests:${actor.ownerUserId}:${query.kind ?? "all"}:${query.status ?? "all"}`,
      key: cursorKey,
      payloadSchema: pageCursorSchema,
      now: nowFrom(dependencies)
    });
    const rows = listPeerPendingRequests({
      ownerUserId: actor.ownerUserId,
      kind: query.kind,
      status: query.status,
      limit: query.limit,
      before: cursor,
      now: nowFrom(dependencies)
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      requests: page.map(requestReadModel),
      page: {
        limit: query.limit,
        hasMore: rows.length > query.limit,
        nextCursor:
          rows.length > query.limit && last
            ? encodePeerCursor({
                kind: `peer-requests:${actor.ownerUserId}:${query.kind ?? "all"}:${query.status ?? "all"}`,
                key: cursorKey,
                payload: { createdAt: last.createdAt, id: last.id },
                now: nowFrom(dependencies)
              })
            : null
      }
    };
  });

  app.post(
    "/api/v1/peers/requests/:requestId/accept",
    async (request, reply) => {
      const params = PEER_API_SCHEMAS.acceptPeerRequest.params.parse(
        request.params ?? {}
      ) as { requestId: string };
      const rawBody = request.body ?? {};
      const body = PEER_API_SCHEMAS.acceptPeerRequest.body!.parse(
        rawBody
      ) as z.infer<
        NonNullable<(typeof PEER_API_SCHEMAS)["acceptPeerRequest"]["body"]>
      >;
      const actor = await authenticatePeerRoute(
        dependencies,
        request,
        "acceptPeerRequest"
      );
      const action = buildPresenceAction({
        actor,
        operationId: "acceptPeerRequest",
        pathParams: { requestId: params.requestId },
        expectedVersion: body.expectedVersion,
        body: rawBody
      });
      const requestHash = hashPeerApiValue({
        requestId: params.requestId,
        body: rawBody
      });
      const commandId = derivePeerCommandId({
        ownerUserId: actor.ownerUserId,
        operationId: "acceptPeerRequest",
        targetType: "pending_request",
        targetId: params.requestId,
        requestHash
      });
      const priorCommand = getPeerCommand(commandId);
      const approvedRecovery =
        priorCommand?.ownerUserId === actor.ownerUserId &&
        [
          "prepared",
          "dispatched",
          "applied",
          "failed",
          "reconciliation_required"
        ].includes(priorCommand.status);
      const pending = getPeerPendingRequest(
        actor.ownerUserId,
        params.requestId
      );
      if (!pending) {
        throw new HttpError(
          404,
          "peer_request_not_found",
          "Pending request not found."
        );
      }
      if (pending.status === "accepted") {
        if (actor.principalClass === "companion_consent") {
          consumeHumanApprovalOrRecover({
            dependencies,
            actor,
            request,
            reply,
            store: presenceStore,
            capabilityHashingKey,
            action,
            approvedRecovery
          });
        }
        return { request: requestReadModel(pending) };
      }
      if (pending.status !== "pending") {
        throw new HttpError(
          409,
          "peer_request_not_pending",
          "The peer request is already terminal."
        );
      }
      requireVersion(
        String(pending.version),
        body.expectedVersion,
        "Pending request"
      );
      const accept = requireManagementGatewayMethod(
        dependencies,
        "acceptPendingRequest"
      );
      await requireHealthyPeerCore(dependencies);
      const approval = consumeHumanApprovalOrRecover({
        dependencies,
        actor,
        request,
        reply,
        store: presenceStore,
        capabilityHashingKey,
        action,
        approvedRecovery
      });
      const now = nowFrom(dependencies);
      try {
        const command = await dispatchDurablePeerCommand({
          actor,
          peerCore: dependencies.peerCore,
          approval,
          operationId: "acceptPeerRequest",
          targetType: "pending_request",
          targetId: params.requestId,
          requestHash,
          expectedVersion: body.expectedVersion,
          now,
          dispatch: (commandId, approvalDeadline, commandApproval) =>
            accept({
              commandId,
              approvalDeadline,
              approval: commandApproval,
              ownerUserId: actor.ownerUserId,
              request: pending
            })
        });
        if (command.alreadyApplied) {
          const current = getPeerPendingRequest(
            actor.ownerUserId,
            params.requestId
          );
          if (current?.status === "accepted") {
            return { request: requestReadModel(current) };
          }
          throw new HttpError(
            409,
            "peer_command_recovery_required",
            "The request acceptance requires reconciliation."
          );
        }
        return applyDurablePeerCommand({
          actor,
          command,
          now,
          resultReference: () => params.requestId,
          apply: () => {
            const decided = decidePeerPendingRequest({
              ownerUserId: actor.ownerUserId,
              requestId: params.requestId,
              expectedVersion: pending.version,
              decision: "accepted",
              reason: body.reason,
              now
            });
            if (!decided) {
              throw new HttpError(
                409,
                "peer_request_conflict",
                "Pending request changed."
              );
            }
            return { request: requestReadModel(decided) };
          }
        });
      } catch (error) {
        return peerCoreFailure(error);
      }
    }
  );

  app.post(
    "/api/v1/peers/requests/:requestId/reject",
    async (request, reply) => {
      const params = PEER_API_SCHEMAS.rejectPeerRequest.params.parse(
        request.params ?? {}
      ) as { requestId: string };
      const rawBody = request.body ?? {};
      const body = PEER_API_SCHEMAS.rejectPeerRequest.body!.parse(
        rawBody
      ) as z.infer<
        NonNullable<(typeof PEER_API_SCHEMAS)["rejectPeerRequest"]["body"]>
      >;
      const actor = await authenticatePeerRoute(
        dependencies,
        request,
        "rejectPeerRequest"
      );
      const action = buildPresenceAction({
        actor,
        operationId: "rejectPeerRequest",
        pathParams: { requestId: params.requestId },
        expectedVersion: body.expectedVersion,
        body: rawBody
      });
      const pending = getPeerPendingRequest(
        actor.ownerUserId,
        params.requestId
      );
      if (!pending) {
        throw new HttpError(
          404,
          "peer_request_not_found",
          "Pending request not found."
        );
      }
      if (pending.status === "rejected") {
        if (actor.principalClass === "companion_consent") {
          consumeHumanApprovalOrRecover({
            dependencies,
            actor,
            request,
            reply,
            store: presenceStore,
            capabilityHashingKey,
            action,
            approvedRecovery: true
          });
        }
        return { request: requestReadModel(pending) };
      }
      if (pending.status !== "pending") {
        throw new HttpError(
          409,
          "peer_request_not_pending",
          "The peer request is already terminal."
        );
      }
      requireVersion(
        String(pending.version),
        body.expectedVersion,
        "Pending request"
      );
      consumeHumanApproval({
        dependencies,
        actor,
        request,
        reply,
        store: presenceStore,
        capabilityHashingKey,
        action
      });
      const decided = decidePeerPendingRequest({
        ownerUserId: actor.ownerUserId,
        requestId: params.requestId,
        expectedVersion: pending.version,
        decision: "rejected",
        reason: body.reason,
        now: nowFrom(dependencies)
      });
      if (!decided) {
        throw new HttpError(
          409,
          "peer_request_conflict",
          "Pending request changed."
        );
      }
      return { request: requestReadModel(decided) };
    }
  );

  app.get("/api/v1/peers/relationships", async (request) => {
    const query = PEER_API_SCHEMAS.listPeerRelationships.query.parse(
      request.query ?? {}
    ) as z.infer<(typeof PEER_API_SCHEMAS)["listPeerRelationships"]["query"]>;
    const actor = await authenticatePeerRoute(
      dependencies,
      request,
      "listPeerRelationships"
    );
    const cursor = decodePeerCursor(query.cursor, {
      kind: `peer-relationships:${actor.ownerUserId}:${query.status ?? "all"}:${hashPeerApiValue(query.query ?? "")}`,
      key: cursorKey,
      payloadSchema: relationshipCursorSchema,
      now: nowFrom(dependencies)
    });
    const rows = listPeerRelationships({
      ownerUserId: actor.ownerUserId,
      status: query.status,
      query: query.query,
      limit: query.limit,
      before: cursor
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      relationships: page,
      page: {
        limit: query.limit,
        hasMore: rows.length > query.limit,
        nextCursor:
          rows.length > query.limit && last
            ? encodePeerCursor({
                kind: `peer-relationships:${actor.ownerUserId}:${query.status ?? "all"}:${hashPeerApiValue(query.query ?? "")}`,
                key: cursorKey,
                payload: { updatedAt: last.updatedAt, id: last.id },
                now: nowFrom(dependencies)
              })
            : null
      }
    };
  });

  app.get("/api/v1/peers/relationships/:relationshipId", async (request) => {
    const params = PEER_API_SCHEMAS.getPeerRelationship.params.parse(
      request.params ?? {}
    ) as { relationshipId: string };
    const actor = await authenticatePeerRoute(
      dependencies,
      request,
      "getPeerRelationship"
    );
    const relationship = currentRelationship(actor, params.relationshipId);
    return {
      relationship,
      devices: listPeerRelationshipDevices(actor.ownerUserId, relationship.id),
      grants: listPeerGrantVersions({
        ownerUserId: actor.ownerUserId,
        relationshipId: relationship.id,
        limit: 20
      }).slice(0, 20),
      sync: getPeerSyncStatus(actor.ownerUserId, relationship.id)
    };
  });

  app.post(
    "/api/v1/peers/relationships/:relationshipId/revoke",
    async (request, reply) => {
      const params = PEER_API_SCHEMAS.revokePeerRelationship.params.parse(
        request.params ?? {}
      ) as { relationshipId: string };
      const rawBody = request.body ?? {};
      const body = PEER_API_SCHEMAS.revokePeerRelationship.body!.parse(
        rawBody
      ) as z.infer<
        NonNullable<(typeof PEER_API_SCHEMAS)["revokePeerRelationship"]["body"]>
      >;
      const actor = await authenticatePeerRoute(
        dependencies,
        request,
        "revokePeerRelationship"
      );
      const action = buildPresenceAction({
        actor,
        operationId: "revokePeerRelationship",
        pathParams: { relationshipId: params.relationshipId },
        expectedVersion: body.expectedVersion,
        body: rawBody
      });
      const requestHash = hashPeerApiValue({
        relationshipId: params.relationshipId,
        body: rawBody
      });
      const commandId = derivePeerCommandId({
        ownerUserId: actor.ownerUserId,
        operationId: "revokePeerRelationship",
        targetType: "relationship",
        targetId: params.relationshipId,
        requestHash
      });
      const priorCommand = getPeerCommand(commandId);
      const approvedRecovery =
        priorCommand?.ownerUserId === actor.ownerUserId &&
        [
          "prepared",
          "dispatched",
          "applied",
          "failed",
          "reconciliation_required"
        ].includes(priorCommand.status);
      const relationship = currentRelationship(actor, params.relationshipId);
      if (relationship.status === "revoked") {
        if (actor.principalClass === "companion_consent") {
          consumeHumanApprovalOrRecover({
            dependencies,
            actor,
            request,
            reply,
            store: presenceStore,
            capabilityHashingKey,
            action,
            approvedRecovery
          });
        }
        return { relationship };
      }
      requireVersion(
        relationship.updatedAt,
        body.expectedVersion,
        "Peer relationship"
      );
      await requireHealthyPeerCore(dependencies);
      const approval = consumeHumanApprovalOrRecover({
        dependencies,
        actor,
        request,
        reply,
        store: presenceStore,
        capabilityHashingKey,
        action,
        approvedRecovery
      });
      const now = nowFrom(dependencies);
      try {
        const command = await dispatchDurablePeerCommand({
          actor,
          peerCore: dependencies.peerCore,
          approval,
          operationId: "revokePeerRelationship",
          targetType: "relationship",
          targetId: params.relationshipId,
          requestHash,
          expectedVersion: body.expectedVersion,
          now,
          dispatch: (commandId, approvalDeadline, commandApproval) =>
            dependencies.peerCore.revokeRelationship({
              commandId,
              approvalDeadline,
              approval: commandApproval,
              ownerUserId: actor.ownerUserId,
              relationshipId: params.relationshipId,
              reason: body.reason
            })
        });
        if (command.alreadyApplied) {
          return {
            relationship: currentRelationship(actor, params.relationshipId)
          };
        }
        return applyDurablePeerCommand({
          actor,
          command,
          now,
          resultReference: () => params.relationshipId,
          apply: () => {
            const revoked = revokePeerRelationshipRecord({
              ownerUserId: actor.ownerUserId,
              relationshipId: params.relationshipId,
              expectedVersion: body.expectedVersion,
              reason: body.reason,
              purgeManagedCache: body.purgeManagedCache,
              now
            });
            if (!revoked) {
              throw new HttpError(
                409,
                "peer_relationship_conflict",
                "The peer relationship changed during revocation."
              );
            }
            return { relationship: revoked };
          }
        });
      } catch (error) {
        return peerCoreFailure(error);
      }
    }
  );

  app.get(
    "/api/v1/peers/relationships/:relationshipId/devices",
    async (request) => {
      const params = PEER_API_SCHEMAS.listPeerDevices.params.parse(
        request.params ?? {}
      ) as { relationshipId: string };
      const actor = await authenticatePeerRoute(
        dependencies,
        request,
        "listPeerDevices"
      );
      currentRelationship(actor, params.relationshipId);
      const devices = listPeerRelationshipDevices(
        actor.ownerUserId,
        params.relationshipId
      );
      return { devices, boundedAt: 256, truncated: devices.length === 256 };
    }
  );

  const registerDeviceMutation = (
    operationId: "approvePeerDevice" | "removePeerDevice",
    path: string,
    actionKind: "approve" | "remove"
  ) => {
    app.post(path, async (request, reply) => {
      const params = PEER_API_SCHEMAS[operationId].params.parse(
        request.params ?? {}
      ) as { relationshipId: string; deviceId: string };
      const rawBody = request.body ?? {};
      const body = PEER_API_SCHEMAS[operationId].body!.parse(rawBody) as {
        expectedVersion: string;
        label?: string;
        reason: string;
      };
      const actor = await authenticatePeerRoute(
        dependencies,
        request,
        operationId
      );
      const action = buildPresenceAction({
        actor,
        operationId,
        pathParams: params,
        expectedVersion: body.expectedVersion,
        body: rawBody
      });
      const requestHash = hashPeerApiValue({
        relationshipId: params.relationshipId,
        deviceId: params.deviceId,
        body: rawBody
      });
      const commandId = derivePeerCommandId({
        ownerUserId: actor.ownerUserId,
        operationId,
        targetType: "device",
        targetId: params.deviceId,
        requestHash
      });
      const priorCommand = getPeerCommand(commandId);
      const approvedRecovery =
        priorCommand?.ownerUserId === actor.ownerUserId &&
        [
          "prepared",
          "dispatched",
          "applied",
          "failed",
          "reconciliation_required"
        ].includes(priorCommand.status);
      const relationship = currentRelationship(actor, params.relationshipId);
      const device = listPeerRelationshipDevices(
        actor.ownerUserId,
        relationship.id
      ).find((candidate) => candidate.deviceId === params.deviceId);
      if (!device) {
        throw new HttpError(
          404,
          "peer_device_not_found",
          "Peer device not found."
        );
      }
      if (
        (actionKind === "approve" && device.status === "approved") ||
        (actionKind === "remove" && device.status === "removed")
      ) {
        if (actor.principalClass === "companion_consent") {
          consumeHumanApprovalOrRecover({
            dependencies,
            actor,
            request,
            reply,
            store: presenceStore,
            capabilityHashingKey,
            action,
            approvedRecovery
          });
        }
        return { device };
      }
      requireVersion(
        relationship.updatedAt,
        body.expectedVersion,
        "Peer relationship"
      );
      await requireHealthyPeerCore(dependencies);
      const approval = consumeHumanApprovalOrRecover({
        dependencies,
        actor,
        request,
        reply,
        store: presenceStore,
        capabilityHashingKey,
        action,
        approvedRecovery
      });
      const now = nowFrom(dependencies);
      try {
        const command = await dispatchDurablePeerCommand({
          actor,
          peerCore: dependencies.peerCore,
          approval,
          operationId,
          targetType: "device",
          targetId: params.deviceId,
          requestHash,
          expectedVersion: body.expectedVersion,
          now,
          dispatch: (commandId, approvalDeadline, commandApproval) =>
            dependencies.peerCore.updateDevice({
              commandId,
              approvalDeadline,
              approval: commandApproval,
              ownerUserId: actor.ownerUserId,
              relationshipId: params.relationshipId,
              deviceId: params.deviceId,
              action: actionKind
            })
        });
        if (command.alreadyApplied) {
          const current = listPeerRelationshipDevices(
            actor.ownerUserId,
            params.relationshipId
          ).find((candidate) => candidate.deviceId === params.deviceId);
          if (current) return { device: current };
          throw new HttpError(
            409,
            "peer_command_recovery_required",
            "The device command requires reconciliation."
          );
        }
        return applyDurablePeerCommand({
          actor,
          command,
          now,
          resultReference: () => params.deviceId,
          apply: () => {
            const changed = mutatePeerRelationshipDevice({
              ownerUserId: actor.ownerUserId,
              relationshipId: params.relationshipId,
              deviceId: params.deviceId,
              expectedRelationshipVersion: body.expectedVersion,
              action: actionKind,
              now
            });
            if (!changed) {
              throw new HttpError(
                409,
                "peer_device_conflict",
                "Peer device changed."
              );
            }
            getDatabase()
              .prepare(
                `UPDATE peer_grant_verifications
                 SET verification_result = 'invalid',
                     failure_reason = 'relationship device approval changed'
                 WHERE owner_user_id = ? AND relationship_id = ?
                   AND verification_result = 'valid'`
              )
              .run(actor.ownerUserId, params.relationshipId);
            return { device: changed };
          }
        });
      } catch (error) {
        return peerCoreFailure(error);
      }
    });
  };

  registerDeviceMutation(
    "approvePeerDevice",
    "/api/v1/peers/relationships/:relationshipId/devices/:deviceId/approve",
    "approve"
  );
  registerDeviceMutation(
    "removePeerDevice",
    "/api/v1/peers/relationships/:relationshipId/devices/:deviceId/remove",
    "remove"
  );

  app.post(
    "/api/v1/peers/relationships/:relationshipId/grants/preview",
    async (request) => {
      const params = PEER_API_SCHEMAS.previewPeerGrant.params.parse(
        request.params ?? {}
      ) as { relationshipId: string };
      const body = PEER_API_SCHEMAS.previewPeerGrant.body!.parse(
        request.body ?? {}
      ) as z.infer<
        NonNullable<(typeof PEER_API_SCHEMAS)["previewPeerGrant"]["body"]>
      >;
      const actor = await authenticatePeerRoute(
        dependencies,
        request,
        "previewPeerGrant"
      );
      requireHumanActor(actor);
      const relationship = currentRelationship(actor, params.relationshipId);
      if (relationship.status === "revoked") {
        throw new HttpError(
          409,
          "peer_relationship_revoked",
          "A revoked relationship cannot receive a grant."
        );
      }
      return {
        preview: buildGrantPreview({
          actor,
          relationship,
          draft: body.draft,
          sampleLimit: body.sampleLimit
        })
      };
    }
  );

  app.post(
    "/api/v1/peers/relationships/:relationshipId/grants/propose",
    async (request, reply) => {
      const params = PEER_API_SCHEMAS.proposePeerGrant.params.parse(
        request.params ?? {}
      ) as { relationshipId: string };
      const rawBody = request.body ?? {};
      const body = PEER_API_SCHEMAS.proposePeerGrant.body!.parse(
        rawBody
      ) as z.infer<
        NonNullable<(typeof PEER_API_SCHEMAS)["proposePeerGrant"]["body"]>
      >;
      const actor = await authenticatePeerRoute(
        dependencies,
        request,
        "proposePeerGrant"
      );
      const idempotency = readIdempotent({
        ownerUserId: actor.ownerUserId,
        operationId: "proposePeerGrant",
        idempotencyKey: body.idempotencyKey,
        body: rawBody,
        now: nowFrom(dependencies)
      });
      if (idempotency.stored) {
        return sendStored(reply, idempotency.stored);
      }
      const relationship = currentRelationship(actor, params.relationshipId);
      requireVersion(
        relationship.updatedAt,
        body.expectedRelationshipVersion,
        "Peer relationship"
      );
      const preview = buildGrantPreview({
        actor,
        relationship,
        draft: body.draft,
        sampleLimit: 25
      });
      requireVersion(preview.hash, body.previewHash, "Peer grant preview");
      await requireHealthyPeerCore(dependencies);
      const action = buildPresenceAction({
        actor,
        operationId: "proposePeerGrant",
        pathParams: { relationshipId: params.relationshipId },
        expectedVersion: body.expectedRelationshipVersion,
        body: rawBody
      });
      const approval = consumeHumanApproval({
        dependencies,
        actor,
        request,
        reply,
        store: presenceStore,
        capabilityHashingKey,
        action
      });
      const requestNow = nowFrom(dependencies);
      humanGrantActor(actor, requestNow);
      const now = durablePeerCommandTime({
        ownerUserId: actor.ownerUserId,
        operationId: "proposePeerGrant",
        targetType: "grant",
        targetId: relationship.id,
        requestHash: idempotency.requestHash,
        retryKey: body.idempotencyKey,
        fallback: requestNow
      });
      const stableCommandId = derivePeerCommandId({
        ownerUserId: actor.ownerUserId,
        operationId: "proposePeerGrant",
        targetType: "grant",
        targetId: relationship.id,
        requestHash: idempotency.requestHash,
        retryKey: body.idempotencyKey
      });
      const unsigned = proposedGrant({
        actor,
        relationshipId: relationship.id,
        draft: body.draft,
        id: `psg_${stableCommandId.slice("pcmd_".length)}`,
        now
      });
      try {
        const command = await dispatchDurablePeerCommand({
          actor,
          peerCore: dependencies.peerCore,
          approval,
          operationId: "proposePeerGrant",
          targetType: "grant",
          targetId: relationship.id,
          requestHash: idempotency.requestHash,
          expectedVersion: body.expectedRelationshipVersion,
          retryKey: body.idempotencyKey,
          now,
          dispatch: (commandId, approvalDeadline, commandApproval) =>
            dependencies.peerCore.signGrant({
              commandId,
              approvalDeadline,
              approval: commandApproval,
              ownerUserId: actor.ownerUserId,
              relationshipId: relationship.id,
              grant: unsigned
            })
        });
        if (command.alreadyApplied) {
          const stored = readPeerIdempotency({
            ownerUserId: actor.ownerUserId,
            operationId: "proposePeerGrant",
            idempotencyKey: body.idempotencyKey,
            requestHash: idempotency.requestHash,
            now
          });
          if (stored) return sendStored(reply, stored);
          throw new HttpError(
            409,
            "peer_command_recovery_required",
            "The grant proposal was applied but its response requires reconciliation."
          );
        }
        const response = applyDurablePeerCommand({
          actor,
          command,
          now,
          resultReference: (grant) => grant.id,
          apply: (gatewayGrant) => {
            const signed = validateGatewayGrant({
              actor,
              relationshipId: relationship.id,
              grant: gatewayGrant,
              expectedStatus: "proposed",
              expectedPolicy: unsigned
            });
            insertPeerGrantVersion(signed);
            const nextResponse = {
              grant: signed,
              versionHash: hashPeerGrantVersion(signed)
            };
            storeIdempotent({
              ownerUserId: actor.ownerUserId,
              operationId: "proposePeerGrant",
              idempotencyKey: body.idempotencyKey,
              requestHash: idempotency.requestHash,
              status: 201,
              response: nextResponse,
              now
            });
            return nextResponse;
          }
        });
        return reply.code(201).send(response);
      } catch (error) {
        return peerCoreFailure(error);
      }
    }
  );

  app.get(
    "/api/v1/peers/relationships/:relationshipId/grants",
    async (request) => {
      const params = PEER_API_SCHEMAS.listPeerGrants.params.parse(
        request.params ?? {}
      ) as { relationshipId: string };
      const query = PEER_API_SCHEMAS.listPeerGrants.query.parse(
        request.query ?? {}
      ) as z.infer<(typeof PEER_API_SCHEMAS)["listPeerGrants"]["query"]>;
      const actor = await authenticatePeerRoute(
        dependencies,
        request,
        "listPeerGrants"
      );
      currentRelationship(actor, params.relationshipId);
      const cursor = decodePeerCursor(query.cursor, {
        kind: `peer-grants:${actor.ownerUserId}:${params.relationshipId}:${query.status ?? "all"}`,
        key: cursorKey,
        payloadSchema: grantCursorSchema,
        now: nowFrom(dependencies)
      });
      const rows = listPeerGrantVersions({
        ownerUserId: actor.ownerUserId,
        relationshipId: params.relationshipId,
        status: query.status,
        limit: query.limit,
        before: cursor
      });
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        grants: page.map((grant) => ({
          ...grant,
          versionHash: hashPeerGrantVersion(grant)
        })),
        page: {
          limit: query.limit,
          hasMore: rows.length > query.limit,
          nextCursor:
            rows.length > query.limit && last
              ? encodePeerCursor({
                  kind: `peer-grants:${actor.ownerUserId}:${params.relationshipId}:${query.status ?? "all"}`,
                  key: cursorKey,
                  payload: {
                    issuedAt: last.issuedAt,
                    id: last.id,
                    sequence: last.sequence
                  },
                  now: nowFrom(dependencies)
                })
              : null
        }
      };
    }
  );

  app.post("/api/v1/peers/grants/:grantId/accept", async (request, reply) => {
    const params = PEER_API_SCHEMAS.acceptPeerGrant.params.parse(
      request.params ?? {}
    ) as { grantId: string };
    const rawBody = request.body ?? {};
    const body = PEER_API_SCHEMAS.acceptPeerGrant.body!.parse(
      rawBody
    ) as z.infer<
      NonNullable<(typeof PEER_API_SCHEMAS)["acceptPeerGrant"]["body"]>
    >;
    const actor = await authenticatePeerRoute(
      dependencies,
      request,
      "acceptPeerGrant"
    );
    const idempotency = readIdempotent({
      ownerUserId: actor.ownerUserId,
      operationId: "acceptPeerGrant",
      idempotencyKey: body.idempotencyKey,
      body: rawBody,
      now: nowFrom(dependencies)
    });
    if (idempotency.stored) {
      return sendStored(reply, idempotency.stored);
    }
    const previous = currentGrantVersion(actor, params.grantId);
    requireVersion(
      hashPeerGrantVersion(previous),
      body.expectedVersionHash,
      "Peer grant"
    );
    if (!["proposed", "countered"].includes(previous.status)) {
      throw new HttpError(
        409,
        "peer_grant_state_conflict",
        "This grant cannot be accepted."
      );
    }
    await requireHealthyPeerCore(dependencies);
    const action = buildPresenceAction({
      actor,
      operationId: "acceptPeerGrant",
      pathParams: { grantId: params.grantId },
      expectedVersion: body.expectedVersionHash,
      body: rawBody
    });
    const approval = consumeHumanApproval({
      dependencies,
      actor,
      request,
      reply,
      store: presenceStore,
      capabilityHashingKey,
      action
    });
    const requestNow = nowFrom(dependencies);
    humanGrantActor(actor, requestNow);
    const now = durablePeerCommandTime({
      ownerUserId: actor.ownerUserId,
      operationId: "acceptPeerGrant",
      targetType: "grant",
      targetId: params.grantId,
      requestHash: idempotency.requestHash,
      retryKey: body.idempotencyKey,
      fallback: requestNow
    });
    try {
      const command = await dispatchDurablePeerCommand({
        actor,
        peerCore: dependencies.peerCore,
        approval,
        operationId: "acceptPeerGrant",
        targetType: "grant",
        targetId: params.grantId,
        requestHash: idempotency.requestHash,
        expectedVersion: body.expectedVersionHash,
        retryKey: body.idempotencyKey,
        now,
        dispatch: (commandId, approvalDeadline, commandApproval) =>
          dependencies.peerCore.acceptGrant({
            commandId,
            approvalDeadline,
            approval: commandApproval,
            ownerUserId: actor.ownerUserId,
            grant: previous
          })
      });
      if (command.alreadyApplied) {
        const stored = readPeerIdempotency({
          ownerUserId: actor.ownerUserId,
          operationId: "acceptPeerGrant",
          idempotencyKey: body.idempotencyKey,
          requestHash: idempotency.requestHash,
          now
        });
        if (stored) return sendStored(reply, stored);
        throw new HttpError(
          409,
          "peer_command_recovery_required",
          "The grant acceptance was applied but its response requires reconciliation."
        );
      }
      return applyDurablePeerCommand({
        actor,
        command,
        now,
        resultReference: (grant) => grant.id,
        apply: (gatewayGrant) => {
          const accepted = validateGatewayGrant({
            actor,
            relationshipId: previous.relationshipId,
            grant: gatewayGrant,
            expectedStatus: "active",
            previous,
            expectedPolicy: previous
          });
          insertPeerGrantVersion(accepted);
          const response = {
            grant: accepted,
            versionHash: hashPeerGrantVersion(accepted)
          };
          storeIdempotent({
            ownerUserId: actor.ownerUserId,
            operationId: "acceptPeerGrant",
            idempotencyKey: body.idempotencyKey,
            requestHash: idempotency.requestHash,
            status: 200,
            response,
            now
          });
          return response;
        }
      });
    } catch (error) {
      return peerCoreFailure(error);
    }
  });

  app.post("/api/v1/peers/grants/:grantId/counter", async (request, reply) => {
    const params = PEER_API_SCHEMAS.counterPeerGrant.params.parse(
      request.params ?? {}
    ) as { grantId: string };
    const rawBody = request.body ?? {};
    const body = PEER_API_SCHEMAS.counterPeerGrant.body!.parse(
      rawBody
    ) as z.infer<
      NonNullable<(typeof PEER_API_SCHEMAS)["counterPeerGrant"]["body"]>
    >;
    const actor = await authenticatePeerRoute(
      dependencies,
      request,
      "counterPeerGrant"
    );
    const idempotency = readIdempotent({
      ownerUserId: actor.ownerUserId,
      operationId: "counterPeerGrant",
      idempotencyKey: body.idempotencyKey,
      body: rawBody,
      now: nowFrom(dependencies)
    });
    if (idempotency.stored) {
      return sendStored(reply, idempotency.stored);
    }
    const previous = currentGrantVersion(actor, params.grantId);
    requireVersion(
      hashPeerGrantVersion(previous),
      body.expectedVersionHash,
      "Peer grant"
    );
    const relationship = currentRelationship(actor, previous.relationshipId);
    const preview = buildGrantPreview({
      actor,
      relationship,
      draft: body.draft,
      sampleLimit: 25
    });
    requireVersion(preview.hash, body.previewHash, "Peer grant preview");
    await requireHealthyPeerCore(dependencies);
    const action = buildPresenceAction({
      actor,
      operationId: "counterPeerGrant",
      pathParams: { grantId: params.grantId },
      expectedVersion: body.expectedVersionHash,
      body: rawBody
    });
    const approval = consumeHumanApproval({
      dependencies,
      actor,
      request,
      reply,
      store: presenceStore,
      capabilityHashingKey,
      action
    });
    const requestNow = nowFrom(dependencies);
    humanGrantActor(actor, requestNow);
    const now = durablePeerCommandTime({
      ownerUserId: actor.ownerUserId,
      operationId: "counterPeerGrant",
      targetType: "grant",
      targetId: params.grantId,
      requestHash: idempotency.requestHash,
      retryKey: body.idempotencyKey,
      fallback: requestNow
    });
    const unsigned = counterGrant({ previous, draft: body.draft, now });
    assertCounterProposalNarrowsGrant(previous, unsigned);
    try {
      const command = await dispatchDurablePeerCommand({
        actor,
        peerCore: dependencies.peerCore,
        approval,
        operationId: "counterPeerGrant",
        targetType: "grant",
        targetId: params.grantId,
        requestHash: idempotency.requestHash,
        expectedVersion: body.expectedVersionHash,
        retryKey: body.idempotencyKey,
        now,
        dispatch: (commandId, approvalDeadline, commandApproval) =>
          dependencies.peerCore.signGrant({
            commandId,
            approvalDeadline,
            approval: commandApproval,
            ownerUserId: actor.ownerUserId,
            relationshipId: previous.relationshipId,
            grant: unsigned
          })
      });
      if (command.alreadyApplied) {
        const stored = readPeerIdempotency({
          ownerUserId: actor.ownerUserId,
          operationId: "counterPeerGrant",
          idempotencyKey: body.idempotencyKey,
          requestHash: idempotency.requestHash,
          now
        });
        if (stored) return sendStored(reply, stored);
        throw new HttpError(
          409,
          "peer_command_recovery_required",
          "The grant counter-proposal was applied but its response requires reconciliation."
        );
      }
      const response = applyDurablePeerCommand({
        actor,
        command,
        now,
        resultReference: (grant) => grant.id,
        apply: (gatewayGrant) => {
          const signed = validateGatewayGrant({
            actor,
            relationshipId: previous.relationshipId,
            grant: gatewayGrant,
            expectedStatus: "countered",
            previous,
            expectedPolicy: unsigned
          });
          assertCounterProposalNarrowsGrant(previous, signed);
          insertPeerGrantVersion(signed);
          const nextResponse = {
            grant: signed,
            versionHash: hashPeerGrantVersion(signed)
          };
          storeIdempotent({
            ownerUserId: actor.ownerUserId,
            operationId: "counterPeerGrant",
            idempotencyKey: body.idempotencyKey,
            requestHash: idempotency.requestHash,
            status: 201,
            response: nextResponse,
            now
          });
          return nextResponse;
        }
      });
      return reply.code(201).send(response);
    } catch (error) {
      return peerCoreFailure(error);
    }
  });

  app.post("/api/v1/peers/grants/:grantId/revoke", async (request, reply) => {
    const params = PEER_API_SCHEMAS.revokePeerGrant.params.parse(
      request.params ?? {}
    ) as { grantId: string };
    const rawBody = request.body ?? {};
    const body = PEER_API_SCHEMAS.revokePeerGrant.body!.parse(
      rawBody
    ) as z.infer<
      NonNullable<(typeof PEER_API_SCHEMAS)["revokePeerGrant"]["body"]>
    >;
    const actor = await authenticatePeerRoute(
      dependencies,
      request,
      "revokePeerGrant"
    );
    const action = buildPresenceAction({
      actor,
      operationId: "revokePeerGrant",
      pathParams: { grantId: params.grantId },
      expectedVersion: body.expectedVersionHash,
      body: rawBody
    });
    const requestHash = hashPeerApiValue({
      grantId: params.grantId,
      body: rawBody
    });
    const commandId = derivePeerCommandId({
      ownerUserId: actor.ownerUserId,
      operationId: "revokePeerGrant",
      targetType: "grant",
      targetId: params.grantId,
      requestHash
    });
    const priorCommand = getPeerCommand(commandId);
    const approvedRecovery =
      priorCommand?.ownerUserId === actor.ownerUserId &&
      [
        "prepared",
        "dispatched",
        "applied",
        "failed",
        "reconciliation_required"
      ].includes(priorCommand.status);
    const previous = currentGrantVersion(actor, params.grantId);
    if (previous.status === "revoked") {
      if (actor.principalClass === "companion_consent") {
        consumeHumanApprovalOrRecover({
          dependencies,
          actor,
          request,
          reply,
          store: presenceStore,
          capabilityHashingKey,
          action,
          approvedRecovery
        });
      }
      return { grant: previous, versionHash: hashPeerGrantVersion(previous) };
    }
    requireVersion(
      hashPeerGrantVersion(previous),
      body.expectedVersionHash,
      "Peer grant"
    );
    const revoke = requireManagementGatewayMethod(dependencies, "revokeGrant");
    await requireHealthyPeerCore(dependencies);
    const approval = consumeHumanApprovalOrRecover({
      dependencies,
      actor,
      request,
      reply,
      store: presenceStore,
      capabilityHashingKey,
      action,
      approvedRecovery
    });
    const requestNow = nowFrom(dependencies);
    humanGrantActor(actor, requestNow);
    const now = durablePeerCommandTime({
      ownerUserId: actor.ownerUserId,
      operationId: "revokePeerGrant",
      targetType: "grant",
      targetId: params.grantId,
      requestHash,
      fallback: requestNow
    });
    const unsigned = peerShareGrantVersionSchema.parse({
      ...previous,
      sequence: previous.sequence + 1,
      previousVersionHash: hashPeerGrantVersion(previous),
      status: "revoked",
      issuedAt: now.toISOString(),
      revokedAt: now.toISOString(),
      signatures: []
    });
    try {
      const command = await dispatchDurablePeerCommand({
        actor,
        peerCore: dependencies.peerCore,
        approval,
        operationId: "revokePeerGrant",
        targetType: "grant",
        targetId: params.grantId,
        requestHash,
        expectedVersion: body.expectedVersionHash,
        now,
        dispatch: (commandId, approvalDeadline, commandApproval) =>
          revoke({
            commandId,
            approvalDeadline,
            approval: commandApproval,
            ownerUserId: actor.ownerUserId,
            grant: unsigned,
            reason: body.reason
          })
      });
      if (command.alreadyApplied) {
        const current = currentGrantVersion(actor, params.grantId);
        if (current.status === "revoked") {
          return { grant: current, versionHash: hashPeerGrantVersion(current) };
        }
        throw new HttpError(
          409,
          "peer_command_recovery_required",
          "The grant revocation requires reconciliation."
        );
      }
      return applyDurablePeerCommand({
        actor,
        command,
        now,
        resultReference: (grant) => grant.id,
        apply: (gatewayGrant) => {
          const revoked = validateGatewayGrant({
            actor,
            relationshipId: previous.relationshipId,
            grant: gatewayGrant,
            expectedStatus: "revoked",
            previous,
            expectedPolicy: unsigned
          });
          insertPeerGrantVersion(revoked);
          getDatabase()
            .prepare(
              `UPDATE peer_share_grants
               SET status = 'superseded'
               WHERE owner_user_id = ? AND id = ? AND sequence < ?
                 AND status IN ('draft', 'proposed', 'active', 'countered')`
            )
            .run(actor.ownerUserId, previous.id, revoked.sequence);
          getDatabase()
            .prepare(
              `UPDATE peer_grant_verifications
               SET verification_result = 'invalid', failure_reason = 'grant revoked'
               WHERE owner_user_id = ? AND grant_id = ?
                 AND verification_result = 'valid'`
            )
            .run(actor.ownerUserId, previous.id);
          if (body.purgeManagedCache) {
            getDatabase()
              .prepare(
                `UPDATE peer_remote_records
                 SET encrypted_payload = randomblob(length(encrypted_payload)),
                     cache_state = 'revoked', revoked_at = ?, updated_at = ?
                 WHERE owner_user_id = ? AND relationship_id = ?
                   AND grant_id = ? AND cache_state NOT IN ('revoked', 'withdrawn')`
              )
              .run(
                now.toISOString(),
                now.toISOString(),
                actor.ownerUserId,
                previous.relationshipId,
                previous.id
              );
          } else {
            getDatabase()
              .prepare(
                `UPDATE peer_remote_records
                 SET cache_state = 'revoked', revoked_at = ?, updated_at = ?
                 WHERE owner_user_id = ? AND relationship_id = ?
                   AND grant_id = ? AND cache_state NOT IN ('revoked', 'withdrawn')`
              )
              .run(
                now.toISOString(),
                now.toISOString(),
                actor.ownerUserId,
                previous.relationshipId,
                previous.id
              );
          }
          recordPeerAuditEvent({
            ownerUserId: actor.ownerUserId,
            relationshipId: previous.relationshipId,
            eventType: "grant_revoked",
            actorClass: actor.principalClass,
            actorId: actor.principalId,
            deviceId: actor.deviceId,
            outcome: "recorded",
            metadata: { grantId: previous.id, reason: body.reason }
          });
          return { grant: revoked, versionHash: hashPeerGrantVersion(revoked) };
        }
      });
    } catch (error) {
      return peerCoreFailure(error);
    }
  });

  app.get(
    "/api/v1/peers/relationships/:relationshipId/sync",
    async (request) => {
      const params = PEER_API_SCHEMAS.getPeerSyncStatus.params.parse(
        request.params ?? {}
      ) as { relationshipId: string };
      const actor = await authenticatePeerRoute(
        dependencies,
        request,
        "getPeerSyncStatus"
      );
      const sync = getPeerSyncStatus(actor.ownerUserId, params.relationshipId);
      if (!sync) {
        throw new HttpError(
          404,
          "peer_relationship_not_found",
          "Peer relationship not found."
        );
      }
      const health = await dependencies.peerCore.health().catch(() => ({
        enabled: false,
        healthy: false,
        protocolVersion: null,
        reason: "Peer connectivity health could not be read."
      }));
      return { sync, peerCore: health };
    }
  );

  app.post(
    "/api/v1/peers/relationships/:relationshipId/resync",
    async (request, reply) => {
      const params = PEER_API_SCHEMAS.requestPeerResync.params.parse(
        request.params ?? {}
      ) as { relationshipId: string };
      const rawBody = request.body ?? {};
      const body = PEER_API_SCHEMAS.requestPeerResync.body!.parse(
        rawBody
      ) as z.infer<
        NonNullable<(typeof PEER_API_SCHEMAS)["requestPeerResync"]["body"]>
      >;
      const actor = await authenticatePeerRoute(
        dependencies,
        request,
        "requestPeerResync"
      );
      const idempotency = readIdempotent({
        ownerUserId: actor.ownerUserId,
        operationId: "requestPeerResync",
        idempotencyKey: body.idempotencyKey,
        body: rawBody,
        now: nowFrom(dependencies)
      });
      if (idempotency.stored) {
        return sendStored(reply, idempotency.stored);
      }
      const relationship = requireActiveRelationship(
        actor,
        params.relationshipId
      );
      requireVersion(
        relationship.updatedAt,
        body.expectedRelationshipVersion,
        "Peer relationship"
      );
      await requireHealthyPeerCore(dependencies);
      const action = buildPresenceAction({
        actor,
        operationId: "requestPeerResync",
        pathParams: { relationshipId: params.relationshipId },
        expectedVersion: body.expectedRelationshipVersion,
        body: rawBody
      });
      const approval = consumeHumanApproval({
        dependencies,
        actor,
        request,
        reply,
        store: presenceStore,
        capabilityHashingKey,
        action
      });
      const now = nowFrom(dependencies);
      try {
        const command = await dispatchDurablePeerCommand({
          actor,
          peerCore: dependencies.peerCore,
          approval,
          operationId: "requestPeerResync",
          targetType: "relationship",
          targetId: relationship.id,
          requestHash: idempotency.requestHash,
          expectedVersion: body.expectedRelationshipVersion,
          retryKey: body.idempotencyKey,
          now,
          dispatch: (commandId, approvalDeadline, commandApproval) =>
            dependencies.peerCore.requestResync({
              commandId,
              approvalDeadline,
              approval: commandApproval,
              ownerUserId: actor.ownerUserId,
              relationshipId: relationship.id,
              projectionIds: body.projectionIds
            })
        });
        if (command.alreadyApplied) {
          const stored = readPeerIdempotency({
            ownerUserId: actor.ownerUserId,
            operationId: "requestPeerResync",
            idempotencyKey: body.idempotencyKey,
            requestHash: idempotency.requestHash,
            now
          });
          if (stored) return sendStored(reply, stored);
          throw new HttpError(
            409,
            "peer_command_recovery_required",
            "The resync request was applied but its response requires reconciliation."
          );
        }
        const response = applyDurablePeerCommand({
          actor,
          command,
          now,
          resultReference: () => relationship.id,
          apply: (result) => {
            const nextResponse = {
              requested: true,
              envelopeIds: result.envelopeIds
            };
            storeIdempotent({
              ownerUserId: actor.ownerUserId,
              operationId: "requestPeerResync",
              idempotencyKey: body.idempotencyKey,
              requestHash: idempotency.requestHash,
              status: 202,
              response: nextResponse,
              now
            });
            return nextResponse;
          }
        });
        return reply.code(202).send(response);
      } catch (error) {
        return peerCoreFailure(error);
      }
    }
  );

  app.get(
    "/api/v1/peers/relationships/:relationshipId/diagnostics",
    async (request) => {
      const params = PEER_API_SCHEMAS.getPeerDiagnostics.params.parse(
        request.params ?? {}
      ) as { relationshipId: string };
      const query = PEER_API_SCHEMAS.getPeerDiagnostics.query.parse(
        request.query ?? {}
      ) as z.infer<(typeof PEER_API_SCHEMAS)["getPeerDiagnostics"]["query"]>;
      const actor = await authenticatePeerRoute(
        dependencies,
        request,
        "getPeerDiagnostics"
      );
      currentRelationship(actor, params.relationshipId);
      const cursor = decodePeerCursor(query.cursor, {
        kind: `peer-diagnostics:${actor.ownerUserId}:${params.relationshipId}`,
        key: cursorKey,
        payloadSchema: pageCursorSchema,
        now: nowFrom(dependencies)
      });
      const rows = listPeerDiagnostics({
        ownerUserId: actor.ownerUserId,
        relationshipId: params.relationshipId,
        limit: query.limit,
        before: cursor
      }) as unknown as Array<{
        id: string;
        createdAt: string;
        metadata: unknown;
      }>;
      const page = rows.slice(0, query.limit).map((row) => ({
        ...row,
        metadata: sanitizedReviewValue(row.metadata)
      }));
      const last = page.at(-1);
      const health = await dependencies.peerCore.health().catch(() => ({
        enabled: false,
        healthy: false,
        protocolVersion: null,
        reason: "Peer connectivity health could not be read."
      }));
      return {
        diagnostics: page,
        peerCore: health,
        page: {
          limit: query.limit,
          hasMore: rows.length > query.limit,
          nextCursor:
            rows.length > query.limit && last
              ? encodePeerCursor({
                  kind: `peer-diagnostics:${actor.ownerUserId}:${params.relationshipId}`,
                  key: cursorKey,
                  payload: { createdAt: last.createdAt, id: last.id },
                  now: nowFrom(dependencies)
                })
              : null
        }
      };
    }
  );
}
