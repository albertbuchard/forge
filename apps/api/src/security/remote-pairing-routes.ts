import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { HttpError } from "../errors.js";
import { MasterPasswordError } from "./master-password-service.js";
import {
  isDirectLocalTransport,
  type ApplicationSecurityRuntime
} from "./application-security-runtime.js";
import type { ForgePrincipal } from "./contracts.js";
import {
  isCompanionBootstrapGrant,
  isCompanionBootstrapRequest
} from "./companion-bootstrap-grant.js";
import { PairingAdmissionError } from "./pairing-service.js";
import type { SqliteSecurityStore } from "./sqlite-security-store.js";

const clientKeyThumbprintSchema = z.string().regex(/^[A-Za-z0-9_-]{43,128}$/);
const profileSchema = z.enum([
  "viewer",
  "trusted_personal_assistant",
  "executor",
  "operator",
  "custom"
]);
const scopeSchema = z.string().regex(/^[a-z0-9.*_:-]{1,128}$/);
const deviceCodeSchema = z.string().regex(/^fg_device_[A-Za-z0-9_-]{43,128}$/);
const pairingProofSchema = z.string().min(64).max(8_192);
const refreshTokenSchema = z
  .string()
  .regex(/^fg_refresh_[A-Za-z0-9_-]{43,128}$/);
const pairingRequestIdSchema = z.string().regex(/^pair_[A-Za-z0-9-]{16,160}$/);
const browserClientIdSchema = z.string().regex(/^client_[A-Za-z0-9-]{16,180}$/);
const BROWSER_SESSION_COOKIE = "forge_session";
const BROWSER_REFRESH_COOKIE = "forge_browser_refresh";
const BROWSER_CLIENT_COOKIE = "forge_browser_client";
const BROWSER_REFRESH_COOKIE_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

function cookieValue(request: FastifyRequest, name: string) {
  const header = request.headers.cookie;
  if (typeof header !== "string" || header.length > 8 * 1024) {
    return null;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function secureCookie(
  name: string,
  value: string,
  options: { maxAgeSeconds: number; path?: string }
) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path ?? "/"}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${Math.max(1, Math.floor(options.maxAgeSeconds))}`,
    "Priority=High"
  ].join("; ");
}

function pairedBrowserCookies(input: {
  sessionToken: string;
  sessionAbsoluteExpiresAt: string;
  refreshToken: string;
  clientId: string;
}) {
  const sessionMaximumAgeSeconds = Math.max(
    1,
    Math.floor(
      (Date.parse(input.sessionAbsoluteExpiresAt) - Date.now()) / 1_000
    )
  );
  return [
    secureCookie(BROWSER_SESSION_COOKIE, input.sessionToken, {
      maxAgeSeconds: sessionMaximumAgeSeconds
    }),
    secureCookie(BROWSER_REFRESH_COOKIE, input.refreshToken, {
      maxAgeSeconds: BROWSER_REFRESH_COOKIE_LIFETIME_SECONDS,
      path: "/api/v1/auth/browser/refresh"
    }),
    secureCookie(BROWSER_CLIENT_COOKIE, input.clientId, {
      maxAgeSeconds: BROWSER_REFRESH_COOKIE_LIFETIME_SECONDS,
      path: "/api/v1/auth/browser/refresh"
    })
  ];
}

function requireSameTargetBrowserOrigin(
  request: FastifyRequest,
  runtime: ApplicationSecurityRuntime
) {
  const origin = exactBrowserOrigin(request);
  const expectedOrigin = new URL(runtime.exactTargetUri(request)).origin;
  if (origin !== expectedOrigin) {
    throw new HttpError(
      403,
      "browser_refresh_origin_invalid",
      "Forge refused browser renewal from a different origin."
    );
  }
  return origin;
}

function ownerPairingSession(request: FastifyRequest) {
  const authentication = request.forgeSecurity?.authentication;
  const ownerPrincipal =
    authentication?.mode === "browser_session" &&
    authentication.browserSession &&
    (authentication.principal.kind === "operator_session" ||
      (authentication.principal.kind === "local_service" &&
        isDirectLocalTransport(request)));
  if (
    !ownerPrincipal ||
    authentication.mode !== "browser_session" ||
    !authentication.browserSession
  ) {
    throw new HttpError(
      401,
      "pairing_owner_session_required",
      "Forge pairing approval requires an authenticated local owner session."
    );
  }
  return authentication.browserSession.verified;
}

function ownerBrowserSession(request: FastifyRequest) {
  const authentication = request.forgeSecurity?.authentication;
  if (
    authentication?.mode !== "browser_session" ||
    authentication.principal.kind !== "operator_session" ||
    !authentication.browserSession
  ) {
    throw new HttpError(
      401,
      "pairing_owner_session_required",
      "Forge pairing approval requires an authenticated owner browser session."
    );
  }
  return authentication.browserSession.verified;
}

function localOwnerMasterPasswordSession(request: FastifyRequest) {
  if (!isDirectLocalTransport(request)) {
    throw new HttpError(
      401,
      "master_password_local_owner_required",
      "The master password can be configured only from an authenticated browser on the Forge host."
    );
  }
  return ownerBrowserSession(request);
}

function pairingProtocolFailure(
  error: unknown,
  input: {
    statusCode: number;
    code: string;
    message: string;
  }
): never {
  if (error instanceof HttpError) {
    throw error;
  }
  throw new HttpError(input.statusCode, input.code, input.message);
}

function requireAvailableRemoteMachineScopes(
  scopes: readonly string[],
  available: boolean
) {
  if (
    available ||
    !scopes.some((scope) => scope === "*" || scope.startsWith("machine."))
  ) {
    return;
  }
  throw new HttpError(
    409,
    "pairing_machine_scope_unavailable",
    "This Forge installation cannot grant remote machine access until an operating-system-isolated worker is installed and validated."
  );
}

function pairedPrincipal(
  client: NonNullable<ReturnType<SqliteSecurityStore["readClient"]>>
): ForgePrincipal {
  return {
    kind: "paired_client",
    subjectId: client.subjectId,
    ownerId: client.ownerId,
    clientId: client.id,
    installationId: client.installationId,
    audience: client.audience,
    scopes: client.scopes,
    clientType: client.clientType,
    profile: client.profile,
    ownerSecurityEpoch: client.ownerSecurityEpoch,
    clientSecurityEpoch: client.clientSecurityEpoch,
    authenticatedAt: new Date().toISOString()
  };
}

function requireActiveClient(
  runtime: ApplicationSecurityRuntime,
  clientId: string,
  keyThumbprint: string
) {
  const client = runtime.store.readClient(clientId);
  if (
    !client ||
    client.revokedAt ||
    client.installationId !== runtime.installationId ||
    client.audience !== runtime.audience ||
    client.keyThumbprint !== keyThumbprint
  ) {
    throw new HttpError(
      401,
      "pairing_client_invalid",
      "The Forge client registration is invalid, revoked, or stale."
    );
  }
  return client;
}

function exactBrowserOrigin(request: FastifyRequest) {
  const value = request.headers.origin;
  if (typeof value !== "string") {
    throw new HttpError(
      400,
      "pairing_step_up_origin_required",
      "Forge owner step-up requires one exact browser Origin."
    );
  }
  try {
    const parsed = new URL(value);
    if (parsed.origin !== value) {
      throw new Error("non-canonical origin");
    }
    return parsed.origin;
  } catch {
    throw new HttpError(
      400,
      "pairing_step_up_origin_invalid",
      "Forge owner step-up requires one canonical browser Origin."
    );
  }
}

export function registerRemotePairingRoutes(
  app: FastifyInstance,
  input: {
    runtime: ApplicationSecurityRuntime;
    ownerId: string;
    remoteMachineScopesAvailable?: boolean;
  }
) {
  const { runtime } = input;
  const remoteMachineScopesAvailable =
    input.remoteMachineScopesAvailable === true;

  app.get("/api/v1/auth/master-password", async (request, reply) => {
    const session = localOwnerMasterPasswordSession(request);
    reply.header("cache-control", "no-store");
    return runtime.masterPasswords.status(session.principal.ownerId);
  });

  app.put("/api/v1/auth/master-password", async (request, reply) => {
    const session = localOwnerMasterPasswordSession(request);
    const body = z
      .object({
        password: z.string().min(1).max(512),
        confirmation: z.string().min(1).max(512),
        currentPassword: z.string().min(1).max(512).optional()
      })
      .strict()
      .parse(request.body ?? {});
    if (body.password.normalize("NFC") !== body.confirmation.normalize("NFC")) {
      throw new HttpError(
        400,
        "master_password_confirmation_mismatch",
        "The new master password and confirmation do not match."
      );
    }
    try {
      const status = await runtime.masterPasswords.set({
        ownerId: session.principal.ownerId,
        password: body.password,
        currentPassword: body.currentPassword
      });
      reply.header("cache-control", "no-store");
      return status;
    } catch (error) {
      if (error instanceof MasterPasswordError) {
        throw new HttpError(
          error.code === "master_password_current_required" ||
            error.code === "master_password_invalid"
            ? 403
            : 400,
          error.code,
          error.message
        );
      }
      throw error;
    }
  });

  app.post("/api/v1/auth/browser/refresh", async (request, reply) => {
    requireSameTargetBrowserOrigin(request, runtime);
    const refreshToken = cookieValue(request, BROWSER_REFRESH_COOKIE);
    const clientIdValue = cookieValue(request, BROWSER_CLIENT_COOKIE);
    const parsedClientId = browserClientIdSchema.safeParse(clientIdValue);
    if (
      !refreshToken ||
      !refreshTokenSchema.safeParse(refreshToken).success ||
      !parsedClientId.success
    ) {
      throw new HttpError(
        401,
        "browser_refresh_required",
        "This Forge browser does not have a renewable paired session."
      );
    }
    const registered = runtime.store.readClient(parsedClientId.data);
    const pairingRequest = registered
      ? runtime.store.readPairingRequest(registered.subjectId)
      : null;
    if (
      !registered ||
      registered.revokedAt ||
      !pairingRequest ||
      pairingRequest.clientType !== "browser"
    ) {
      throw new HttpError(
        401,
        "browser_refresh_invalid",
        "The paired Forge browser is revoked or stale."
      );
    }
    const rotated = runtime.refreshFamilies.rotate({
      refreshToken,
      clientId: registered.id,
      installationId: runtime.installationId,
      keyThumbprint: registered.keyThumbprint,
      audience: runtime.audience
    });
    if (rotated.status !== "rotated") {
      if (rotated.status === "reuse_detected") {
        throw new HttpError(
          401,
          "browser_refresh_reuse_detected",
          "Forge detected paired-browser credential replay and revoked the client."
        );
      }
      throw new HttpError(
        401,
        "browser_refresh_invalid",
        "The paired Forge browser renewal is invalid, expired, or stale."
      );
    }
    const client = requireActiveClient(
      runtime,
      registered.id,
      registered.keyThumbprint
    );
    const session = runtime.browserSessions.create(pairedPrincipal(client));
    const priorSessionToken = cookieValue(request, BROWSER_SESSION_COOKIE);
    if (priorSessionToken) {
      runtime.browserSessions.revoke(priorSessionToken);
    }
    reply.header(
      "set-cookie",
      pairedBrowserCookies({
        sessionToken: session.sessionToken,
        sessionAbsoluteExpiresAt: session.absoluteExpiresAt,
        refreshToken: rotated.refreshToken,
        clientId: client.id
      })
    );
    reply.header("cache-control", "no-store");
    reply.header("pragma", "no-cache");
    return {
      session: {
        id: session.sessionId,
        absoluteExpiresAt: session.absoluteExpiresAt
      },
      csrfToken: session.csrfToken
    };
  });

  app.post("/api/v1/auth/device", async (request, reply) => {
    const body = z
      .object({
        clientName: z.string().trim().min(1).max(120),
        clientType: z.enum(["api", "browser"]).default("api"),
        clientKeyThumbprint: clientKeyThumbprintSchema,
        requestedScopes: z.array(scopeSchema).min(1).max(32),
        requestedProfile: profileSchema
      })
      .strict()
      .parse(request.body ?? {});
    const requestsCompanionBootstrap =
      body.requestedProfile === "trusted_personal_assistant" &&
      body.requestedScopes.length === 1 &&
      body.requestedScopes[0] === "companion.pair";
    if (
      requestsCompanionBootstrap &&
      !isCompanionBootstrapRequest({
        profile: body.requestedProfile,
        scopes: body.requestedScopes,
        clientType: body.clientType
      })
    ) {
      throw new HttpError(
        400,
        "companion_pairing_api_client_required",
        "Forge companion bootstrap pairing requires an API client."
      );
    }
    requireAvailableRemoteMachineScopes(
      body.requestedScopes,
      remoteMachineScopesAvailable
    );
    try {
      const begun = runtime.pairing.begin({
        ownerId: input.ownerId,
        networkPartition: runtime.pairingNetworkPartitions.observe(request),
        installationId: runtime.installationId,
        clientName: body.clientName,
        clientType: body.clientType,
        clientKeyThumbprint: body.clientKeyThumbprint,
        audience: runtime.audience,
        requestedScopes: body.requestedScopes,
        requestedProfile: body.requestedProfile
      });
      return {
        ...begun,
        masterPasswordAvailable:
          body.clientType === "browser" &&
          runtime.masterPasswords.status(input.ownerId).configured
      };
    } catch (error) {
      const retryAfterSeconds =
        error instanceof PairingAdmissionError ? error.retryAfterSeconds : 60;
      reply.header("retry-after", String(retryAfterSeconds));
      if (error instanceof PairingAdmissionError) {
        throw new HttpError(
          429,
          "pairing_admission_limited",
          "Forge cannot admit another pairing request in the current bounded window.",
          { retryAfterSeconds }
        );
      }
      pairingProtocolFailure(error, {
        statusCode: 429,
        code: "pairing_admission_limited",
        message:
          "Forge cannot admit another pairing request in the current bounded window."
      });
    }
  });

  app.post(
    "/api/v1/auth/device/master-password/approve",
    async (request, reply) => {
      const body = z
        .object({
          requestId: pairingRequestIdSchema,
          userCode: z.string().trim().min(8).max(64),
          password: z.string().min(1).max(512),
          clientProof: pairingProofSchema
        })
        .strict()
        .parse(request.body ?? {});
      let pending;
      try {
        pending = await runtime.pairing.verifyMasterPasswordApprovalClient({
          requestId: body.requestId,
          clientProof: body.clientProof
        });
      } catch (error) {
        pairingProtocolFailure(error, {
          statusCode: 401,
          code: "master_password_pairing_client_proof_invalid",
          message:
            "Forge rejected the sender-bound master-password pairing proof."
        });
      }
      try {
        const masterPasswordAuthorization =
          await runtime.masterPasswords.authorizePairing({
            ownerId: pending.ownerId,
            requestId: pending.id,
            password: body.password,
            networkPartition: runtime.pairingNetworkPartitions.observe(request)
          });
        return runtime.pairing.approve({
          authorization:
            runtime.pairingOwnerAuthorizations.authorizeMasterPasswordApproval({
              requestId: pending.id,
              userCode: body.userCode,
              networkPartition:
                runtime.pairingNetworkPartitions.observe(request),
              masterPasswordAuthorization
            }),
          registerClient: true
        });
      } catch (error) {
        if (error instanceof MasterPasswordError) {
          if (error.code === "master_password_rate_limited") {
            reply.header("retry-after", "300");
          }
          throw new HttpError(
            error.code === "master_password_rate_limited"
              ? 429
              : error.code === "master_password_not_configured"
                ? 409
                : 401,
            error.code,
            error.message
          );
        }
        pairingProtocolFailure(error, {
          statusCode: 403,
          code: "master_password_pairing_rejected",
          message:
            "Forge rejected the master-password pairing request because its code, owner, scope, or state did not match."
        });
      }
    }
  );

  app.post("/api/v1/auth/device/cancel", async (request) => {
    const body = z
      .object({
        deviceCode: deviceCodeSchema,
        clientProof: pairingProofSchema
      })
      .strict()
      .parse(request.body ?? {});
    try {
      return {
        cancelled: await runtime.pairing.cancel(body)
      };
    } catch (error) {
      pairingProtocolFailure(error, {
        statusCode: 401,
        code: "pairing_client_proof_invalid",
        message: "Forge rejected the pairing client proof."
      });
    }
  });

  app.get("/api/v1/auth/device/requests", async (request) => {
    const reviews = runtime.pairingOwnerAuthorizations.listActiveRequests({
      session: ownerPairingSession(request),
      limit: 25
    });
    return {
      requests: reviews.map((review) => ({
        ...review,
        clientId:
          review.status === "approved"
            ? (runtime.store.readClientBySubjectId(review.requestId)?.id ??
              null)
            : null
      }))
    };
  });

  app.post(
    "/api/v1/auth/device/requests/:requestId/approve",
    async (request) => {
      const { requestId } = z
        .object({ requestId: pairingRequestIdSchema })
        .parse(request.params);
      const body = z
        .object({ userCode: z.string().trim().min(8).max(64) })
        .strict()
        .parse(request.body ?? {});
      const session = ownerPairingSession(request);
      const pending = runtime.store.readPairingRequest(requestId);
      if (!pending) {
        throw new HttpError(
          404,
          "pairing_request_not_found",
          "Forge found no active pairing request with that identifier."
        );
      }
      requireAvailableRemoteMachineScopes(
        pending.requestedScopes,
        remoteMachineScopesAvailable
      );
      try {
        return runtime.pairing.approve({
          authorization: runtime.pairingOwnerAuthorizations.authorizeApproval({
            session,
            userCode: body.userCode,
            requestId,
            networkPartition: runtime.pairingNetworkPartitions.observe(request),
            scopes: pending.requestedScopes,
            profile: pending.requestedProfile
          }),
          registerClient: true
        });
      } catch (error) {
        pairingProtocolFailure(error, {
          statusCode: 403,
          code: "pairing_approval_rejected",
          message:
            "Forge rejected this approval because the code, selected request, owner session, or required step-up did not match."
        });
      }
    }
  );

  app.post("/api/v1/auth/device/requests/:requestId/deny", async (request) => {
    const { requestId } = z
      .object({ requestId: pairingRequestIdSchema })
      .parse(request.params);
    z.object({})
      .strict()
      .parse(request.body ?? {});
    try {
      runtime.pairing.deny({
        authorization:
          runtime.pairingOwnerAuthorizations.authorizeDenialByRequestId({
            session: ownerPairingSession(request),
            requestId
          })
      });
    } catch (error) {
      pairingProtocolFailure(error, {
        statusCode: 404,
        code: "pairing_denial_unavailable",
        message:
          "Forge found no active pairing request with that identifier for this owner."
      });
    }
    return { denied: true };
  });

  app.post("/api/v1/auth/device/approve", async (request) => {
    const body = z
      .object({
        userCode: z.string().trim().min(8).max(64),
        scopes: z.array(scopeSchema).min(1).max(32),
        profile: profileSchema
      })
      .strict()
      .parse(request.body ?? {});
    requireAvailableRemoteMachineScopes(
      body.scopes,
      remoteMachineScopesAvailable
    );
    try {
      return runtime.pairing.approve({
        authorization: runtime.pairingOwnerAuthorizations.authorizeApproval({
          session: ownerBrowserSession(request),
          userCode: body.userCode,
          networkPartition: runtime.pairingNetworkPartitions.observe(request),
          scopes: body.scopes,
          profile: body.profile
        })
      });
    } catch (error) {
      pairingProtocolFailure(error, {
        statusCode: 403,
        code: "pairing_approval_rejected",
        message:
          "Forge rejected this approval because the code, grant, owner session, or required step-up did not match."
      });
    }
  });

  app.post("/api/v1/auth/device/review", async (request) => {
    const body = z
      .object({ userCode: z.string().trim().min(8).max(64) })
      .strict()
      .parse(request.body ?? {});
    try {
      return runtime.pairingOwnerAuthorizations.review({
        session: ownerBrowserSession(request),
        userCode: body.userCode,
        networkPartition: runtime.pairingNetworkPartitions.observe(request)
      });
    } catch (error) {
      pairingProtocolFailure(error, {
        statusCode: 404,
        code: "pairing_review_unavailable",
        message:
          "Forge found no pending pairing request for that code and owner."
      });
    }
  });

  app.post("/api/v1/auth/device/step-up/options", async (request) => {
    const body = z
      .object({
        userCode: z.string().trim().min(8).max(64),
        credentialLabel: z.string().trim().min(1).max(120).optional()
      })
      .strict()
      .parse(request.body ?? {});
    try {
      const session = ownerBrowserSession(request);
      const review = runtime.pairingOwnerAuthorizations.review({
        session,
        userCode: body.userCode,
        networkPartition: runtime.pairingNetworkPartitions.observe(request)
      });
      requireAvailableRemoteMachineScopes(
        review.requestedScopes,
        remoteMachineScopesAvailable
      );
      if (
        !["executor", "operator", "custom"].includes(review.requestedProfile) &&
        !review.requestedScopes.some(
          (scope) =>
            scope === "*" ||
            scope.startsWith("machine.") ||
            scope.startsWith("secret.") ||
            scope.startsWith("admin.")
        )
      ) {
        throw new Error(
          "Forge owner step-up is reserved for privileged pairing grants."
        );
      }
      return runtime.privilegedPairingStepUp.createOptions({
        session,
        origin: exactBrowserOrigin(request),
        review,
        credentialLabel: body.credentialLabel
      });
    } catch (error) {
      pairingProtocolFailure(error, {
        statusCode: 403,
        code: "pairing_step_up_options_rejected",
        message:
          "Forge could not start a privileged pairing ceremony for this exact request."
      });
    }
  });

  app.post("/api/v1/auth/device/step-up/verify", async (request) => {
    const body = z
      .object({
        userCode: z.string().trim().min(8).max(64),
        requestId: z.string().regex(/^pair_[A-Za-z0-9-]{16,160}$/),
        scopes: z.array(scopeSchema).min(1).max(32),
        profile: profileSchema,
        challengeId: z.string().regex(/^pwc_[A-Za-z0-9]{16,160}$/),
        response: z.unknown(),
        credentialLabel: z.string().trim().min(1).max(120).optional()
      })
      .strict()
      .parse(request.body ?? {});
    requireAvailableRemoteMachineScopes(
      body.scopes,
      remoteMachineScopesAvailable
    );
    try {
      const session = ownerBrowserSession(request);
      const pending = runtime.store.readPairingRequest(body.requestId);
      if (
        !pending ||
        pending.status !== "pending" ||
        pending.ownerId !== input.ownerId ||
        Date.parse(pending.expiresAt) <= Date.now() ||
        pending.requestedProfile !== body.profile ||
        pending.requestedScopes.length !== body.scopes.length ||
        pending.requestedScopes.some(
          (scope, index) => scope !== [...body.scopes].sort()[index]
        )
      ) {
        throw new Error("Forge privileged pairing request changed or expired.");
      }
      const review = runtime.pairingReview(pending);
      const privilegedAuthorization =
        await runtime.privilegedPairingStepUp.verify({
          session,
          origin: exactBrowserOrigin(request),
          review,
          challengeId: body.challengeId,
          response: body.response,
          credentialLabel: body.credentialLabel
        });
      return runtime.pairing.approve({
        authorization: runtime.pairingOwnerAuthorizations.authorizeApproval({
          session,
          userCode: body.userCode,
          requestId: body.requestId,
          networkPartition: runtime.pairingNetworkPartitions.observe(request),
          scopes: body.scopes,
          profile: body.profile,
          privilegedAuthorization
        }),
        registerClient: true
      });
    } catch (error) {
      pairingProtocolFailure(error, {
        statusCode: 403,
        code: "pairing_step_up_verification_rejected",
        message:
          "Forge rejected the passkey ceremony or exact privileged pairing grant."
      });
    }
  });

  app.post("/api/v1/auth/device/deny", async (request) => {
    const body = z
      .object({ userCode: z.string().trim().min(8).max(64) })
      .strict()
      .parse(request.body ?? {});
    try {
      runtime.pairing.deny({
        authorization: runtime.pairingOwnerAuthorizations.authorizeDenial({
          session: ownerBrowserSession(request),
          userCode: body.userCode,
          networkPartition: runtime.pairingNetworkPartitions.observe(request)
        })
      });
    } catch (error) {
      pairingProtocolFailure(error, {
        statusCode: 404,
        code: "pairing_denial_unavailable",
        message:
          "Forge found no pending pairing request for that code and owner."
      });
    }
    return { denied: true };
  });

  app.post("/api/v1/auth/token", async (request, reply) => {
    const body = z
      .discriminatedUnion("grantType", [
        z
          .object({
            grantType: z.literal("device_code"),
            deviceCode: deviceCodeSchema,
            clientProof: pairingProofSchema
          })
          .strict(),
        z
          .object({
            grantType: z.literal("refresh_token"),
            refreshToken: refreshTokenSchema,
            clientId: z.string().regex(/^client_[A-Za-z0-9-]{16,180}$/),
            clientKeyThumbprint: clientKeyThumbprintSchema
          })
          .strict()
      ])
      .parse(request.body ?? {});

    if (body.grantType === "refresh_token") {
      const client = requireActiveClient(
        runtime,
        body.clientId,
        body.clientKeyThumbprint
      );
      const proof = request.headers.dpop;
      if (typeof proof !== "string") {
        throw new HttpError(
          401,
          "pairing_refresh_dpop_required",
          "Forge refresh requires a sender-bound DPoP proof."
        );
      }
      await runtime.dpop.verify({
        proof,
        accessToken: body.refreshToken,
        expectedMethod: request.method,
        expectedTargetUri: runtime.exactTargetUri(request),
        expectedKeyThumbprint: client.keyThumbprint
      });
      const rotated = runtime.refreshFamilies.rotate({
        refreshToken: body.refreshToken,
        clientId: client.id,
        installationId: runtime.installationId,
        keyThumbprint: client.keyThumbprint,
        audience: runtime.audience
      });
      if (rotated.status !== "rotated") {
        if (rotated.status === "reuse_detected") {
          throw new HttpError(
            401,
            "pairing_refresh_reuse_detected",
            "Forge detected refresh credential reuse and revoked the client."
          );
        }
        throw new HttpError(
          401,
          "pairing_refresh_invalid",
          "The Forge refresh credential is invalid, expired, or stale."
        );
      }
      const currentClient = requireActiveClient(
        runtime,
        client.id,
        client.keyThumbprint
      );
      const access = await runtime.accessCredentials.issue(
        pairedPrincipal(currentClient),
        {
          mode: "sender_constrained",
          confirmationJkt: currentClient.keyThumbprint
        }
      );
      reply.header("cache-control", "no-store");
      reply.header("pragma", "no-cache");
      return {
        tokenType: "DPoP",
        accessToken: access.token,
        expiresAt: access.expiresAt,
        refreshToken: rotated.refreshToken,
        clientId: currentClient.id,
        audience: currentClient.audience,
        scopes: currentClient.scopes,
        profile: currentClient.profile
      };
    }

    let polled;
    try {
      polled = await runtime.pairing.poll({
        deviceCode: body.deviceCode,
        clientProof: body.clientProof,
        networkPartition: runtime.pairingNetworkPartitions.observe(request)
      });
    } catch (error) {
      pairingProtocolFailure(error, {
        statusCode: 401,
        code: "pairing_client_proof_invalid",
        message: "Forge rejected the pairing client proof."
      });
    }
    if (polled.status !== "approved") {
      if (polled.status === "slow_down") {
        reply.header("retry-after", String(polled.intervalSeconds));
        reply.code(429);
      } else if (polled.status === "authorization_pending") {
        reply.header("retry-after", String(polled.intervalSeconds));
        reply.code(428);
      } else {
        reply.code(400);
      }
      return polled;
    }
    const existingClient = runtime.store.readClientBySubjectId(
      polled.grant.requestId
    );
    const clientId = existingClient?.id ?? `client_${randomUUID()}`;
    if (!existingClient) {
      runtime.store.registerClient({
        id: clientId,
        ownerId: polled.grant.ownerId,
        subjectId: polled.grant.requestId,
        installationId: runtime.installationId,
        keyThumbprint: polled.grant.clientKeyThumbprint,
        audience: runtime.audience,
        profile: polled.grant.profile as ForgePrincipal["profile"],
        scopes: polled.grant.scopes,
        clientSecurityEpoch: 1
      });
    }
    const client = requireActiveClient(
      runtime,
      clientId,
      polled.grant.clientKeyThumbprint
    );
    if (
      client.ownerId !== polled.grant.ownerId ||
      client.subjectId !== polled.grant.requestId ||
      client.ownerSecurityEpoch !== polled.grant.ownerSecurityEpoch ||
      client.profile !== polled.grant.profile ||
      client.scopes.length !== polled.grant.scopes.length ||
      client.scopes.some(
        (scope, index) => scope !== [...polled.grant.scopes].sort()[index]
      )
    ) {
      throw new HttpError(
        401,
        "pairing_client_grant_mismatch",
        "The registered Forge client does not match this approved pairing grant."
      );
    }
    const principal = pairedPrincipal(client);
    if (polled.grant.clientType === "browser") {
      const session = runtime.browserSessions.create(principal);
      const refresh = runtime.refreshFamilies.issue({
        clientId,
        ownerId: principal.ownerId,
        installationId: runtime.installationId,
        audience: runtime.audience,
        profile: principal.profile,
        keyThumbprint: client.keyThumbprint,
        scopes: principal.scopes,
        ownerSecurityEpoch: principal.ownerSecurityEpoch,
        clientSecurityEpoch: principal.clientSecurityEpoch!
      });
      reply.header(
        "set-cookie",
        pairedBrowserCookies({
          sessionToken: session.sessionToken,
          sessionAbsoluteExpiresAt: session.absoluteExpiresAt,
          refreshToken: refresh.refreshToken,
          clientId
        })
      );
      reply.header("cache-control", "no-store");
      reply.header("pragma", "no-cache");
      return {
        session: {
          id: session.sessionId,
          absoluteExpiresAt: session.absoluteExpiresAt
        },
        csrfToken: session.csrfToken,
        clientId,
        audience: principal.audience,
        scopes: principal.scopes,
        profile: principal.profile
      };
    }
    if (
      isCompanionBootstrapGrant({
        clientType: polled.grant.clientType,
        profile: principal.profile,
        scopes: principal.scopes
      })
    ) {
      const access = await runtime.accessCredentials.issue(principal, {
        mode: "sender_constrained",
        confirmationJkt: client.keyThumbprint
      });
      reply.header("cache-control", "no-store");
      reply.header("pragma", "no-cache");
      return {
        tokenType: "DPoP",
        accessToken: access.token,
        expiresAt: access.expiresAt,
        clientId,
        audience: principal.audience,
        scopes: principal.scopes,
        profile: principal.profile
      };
    }
    const refresh = runtime.refreshFamilies.issue({
      clientId,
      ownerId: principal.ownerId,
      installationId: runtime.installationId,
      audience: runtime.audience,
      profile: principal.profile,
      keyThumbprint: client.keyThumbprint,
      scopes: principal.scopes,
      ownerSecurityEpoch: principal.ownerSecurityEpoch,
      clientSecurityEpoch: principal.clientSecurityEpoch!
    });
    const access = await runtime.accessCredentials.issue(principal, {
      mode: "sender_constrained",
      confirmationJkt: client.keyThumbprint
    });
    reply.header("cache-control", "no-store");
    reply.header("pragma", "no-cache");
    return {
      tokenType: "DPoP",
      accessToken: access.token,
      expiresAt: access.expiresAt,
      refreshToken: refresh.refreshToken,
      clientId,
      audience: principal.audience,
      scopes: principal.scopes,
      profile: principal.profile
    };
  });

  app.get("/api/v1/auth/clients", async (request) => {
    ownerBrowserSession(request);
    return {
      clients: runtime.store.listClients(input.ownerId)
    };
  });

  app.post("/api/v1/auth/clients/:id/revoke", async (request) => {
    ownerBrowserSession(request);
    const { id } = z
      .object({ id: z.string().regex(/^client_[A-Za-z0-9-]{16,180}$/) })
      .parse(request.params);
    const client = runtime.store.readClient(id);
    if (!client || client.ownerId !== input.ownerId) {
      throw new HttpError(
        404,
        "pairing_client_not_found",
        "The Forge client registration was not found."
      );
    }
    return {
      revoked: runtime.store.revokeClient(id, "owner_revoked")
    };
  });
}
