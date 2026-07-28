import { createHash } from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";
import type { FastifyInstance, FastifyRequest, RouteOptions } from "fastify";

import { HttpError } from "../errors.js";
import type { VerifiedBrowserSession } from "./browser-session-service.js";
import type { ForgePrincipal, RouteSecurityContract } from "./contracts.js";
import type { SecurityRateLimiter } from "./security-observability.js";
import {
  profileAllowsRoute,
  requiredProfileForRoute
} from "./profile-authorization.js";
import { resolveRouteSecurityContract } from "./route-contract.js";

const DEFAULT_PAYLOAD_RECEIVE_TIMEOUT_MS = 15_000;
const SECURITY_POLICY_VERSION = "forge-access-gateway/1";

type GatewayAuthenticationMode =
  | "browser_session"
  | "access_credential"
  | "legacy_agent_token"
  | "verified_protocol";

export type GatewayAuthentication = {
  principal: ForgePrincipal;
  mode: GatewayAuthenticationMode;
  csrfSatisfied: boolean;
  browserSession?: {
    id: string;
    absoluteExpiresAt: string;
    verified: VerifiedBrowserSession;
  };
};

export type GatewayProtocolAuthentication = GatewayAuthentication & {
  verifyBody?: (request: FastifyRequest) => Promise<void> | void;
};

export type GatewayRequestContext = {
  policyVersion: typeof SECURITY_POLICY_VERSION;
  contract: RouteSecurityContract;
  authentication: GatewayAuthentication | null;
  protocolBodyVerifier: GatewayProtocolAuthentication["verifyBody"] | null;
  receivedBodySha256: string | null;
  connectionId: string | null;
};

export type GatewayCredentialVerifier = {
  authenticate(
    request: FastifyRequest,
    contract: RouteSecurityContract
  ): Promise<GatewayAuthentication | null> | GatewayAuthentication | null;
  verifyProtocolEarly?(
    request: FastifyRequest,
    contract: RouteSecurityContract
  ):
    | Promise<GatewayProtocolAuthentication | null>
    | GatewayProtocolAuthentication
    | null;
};

export type GatewayAuthorizationPolicy = {
  authorize(input: {
    request: FastifyRequest;
    contract: RouteSecurityContract;
    authentication: GatewayAuthentication;
    phase: "early" | "body";
  }): Promise<void> | void;
};

export type GatewayAuditEvent = {
  requestId: string;
  connectionId?: string | null;
  jobId?: string | null;
  method: string;
  routePath: string;
  action: string;
  resource: string;
  outcome: "admitted" | "denied";
  reason: string;
  principalKind: ForgePrincipal["kind"] | "anonymous";
  subjectId: string | null;
  clientId: string | null;
  policyVersion: typeof SECURITY_POLICY_VERSION;
};

export type GatewayAuditSink = {
  record(event: GatewayAuditEvent): Promise<void> | void;
};

export type InstallAccessGatewayOptions = {
  credentials: GatewayCredentialVerifier;
  authorization?: GatewayAuthorizationPolicy;
  audit?: GatewayAuditSink;
  rateLimiter?: SecurityRateLimiter;
  payloadReceiveTimeoutMilliseconds?: number;
};

type RouteContractConfig = Record<string, RouteSecurityContract>;

declare module "fastify" {
  interface FastifyContextConfig {
    forgeSecurityContracts?: RouteContractConfig;
  }

  interface FastifyRequest {
    forgeSecurity: GatewayRequestContext | null;
  }
}

function singleHeader(
  request: FastifyRequest,
  name: string
): string | undefined {
  const value = request.headers[name];
  if (Array.isArray(value)) {
    throw new HttpError(
      400,
      "security_header_ambiguous",
      `Forge requires a single ${name} header.`
    );
  }
  return typeof value === "string" ? value : undefined;
}

function isUnsafeMethod(method: string) {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function loopbackAddress(value: string | undefined) {
  const normalized = value?.toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1"
  );
}

function socketIsEncrypted(request: FastifyRequest) {
  return Boolean(
    (
      request.raw.socket as typeof request.raw.socket & {
        encrypted?: boolean;
      }
    ).encrypted
  );
}

function hasForwardingIdentityHeaders(request: FastifyRequest) {
  return Object.keys(request.headers).some((name) => {
    const normalized = name.toLowerCase();
    return (
      normalized === "forwarded" ||
      normalized === "x-real-ip" ||
      normalized === "cf-connecting-ip" ||
      normalized.startsWith("x-forwarded-") ||
      normalized.startsWith("tailscale-")
    );
  });
}

function usesSecureApplicationTransport(request: FastifyRequest) {
  if (socketIsEncrypted(request)) {
    return true;
  }
  if (!loopbackAddress(request.raw.socket.remoteAddress)) {
    return false;
  }
  if (!hasForwardingIdentityHeaders(request)) {
    return true;
  }
  return singleHeader(request, "x-forwarded-proto")?.toLowerCase() === "https";
}

function genericScopeForContract(contract: RouteSecurityContract) {
  return ["GET", "HEAD"].includes(contract.method) ? "read" : "write";
}

function exactRouteScopes(contract: RouteSecurityContract) {
  const operation = genericScopeForContract(contract);
  return new Set([contract.action, `${contract.resource}.${operation}`]);
}

function legacyCompatibilityScopes(contract: RouteSecurityContract) {
  return new Set(["*", ...contract.acceptedLegacyScopes]);
}

export const defaultGatewayAuthorization: GatewayAuthorizationPolicy = {
  authorize({ contract, authentication }) {
    const principal = authentication.principal;
    if (
      principal.kind === "operator_session" ||
      principal.kind === "system" ||
      principal.kind === "local_service"
    ) {
      return;
    }
    if (
      authentication.mode === "verified_protocol" &&
      (principal.kind === "companion_session" ||
        principal.kind === "peer_device")
    ) {
      return;
    }
    if (!profileAllowsRoute(principal, contract)) {
      throw new HttpError(
        403,
        "gateway_profile_forbidden",
        "The verified Forge client profile cannot perform this operation.",
        {
          profile: principal.profile,
          requiredProfile: requiredProfileForRoute(contract),
          action: contract.action,
          resource: contract.resource
        }
      );
    }
    const acceptedScopes =
      principal.kind === "legacy_agent_token"
        ? legacyCompatibilityScopes(contract)
        : new Set([
            ...exactRouteScopes(contract),
            `profile:${principal.profile}`
          ]);
    if (!principal.scopes.some((scope) => acceptedScopes.has(scope))) {
      throw new HttpError(
        403,
        "gateway_scope_forbidden",
        "The verified Forge principal lacks the required route scope.",
        {
          action: contract.action,
          resource: contract.resource,
          requiredAnyScope: [...acceptedScopes].sort()
        }
      );
    }
  }
};

class BoundedPayloadStream extends Transform {
  receivedEncodedLength = 0;
  private readonly digest = createHash("sha256");
  private readonly timeout: NodeJS.Timeout;

  constructor(
    private readonly maximumBytes: number,
    timeoutMilliseconds: number,
    private readonly onDigest: (sha256: string) => void
  ) {
    super();
    this.timeout = setTimeout(() => {
      this.destroy(
        new HttpError(
          408,
          "gateway_payload_timeout",
          "The Forge request body was not received within the allowed time."
        )
      );
    }, timeoutMilliseconds);
    this.timeout.unref();
  }

  override _transform(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: TransformCallback
  ) {
    const bytes = Buffer.isBuffer(chunk)
      ? chunk.byteLength
      : Buffer.byteLength(chunk, encoding);
    this.receivedEncodedLength += bytes;
    if (this.receivedEncodedLength > this.maximumBytes) {
      callback(
        new HttpError(
          413,
          "payload_too_large",
          "The Forge request body exceeds the route's reviewed byte limit.",
          { maximumBytes: this.maximumBytes }
        )
      );
      return;
    }
    if (Buffer.isBuffer(chunk)) {
      this.digest.update(chunk);
    } else {
      this.digest.update(chunk, encoding);
    }
    callback(null, chunk);
  }

  override _flush(callback: TransformCallback) {
    clearTimeout(this.timeout);
    this.onDigest(this.digest.digest("hex"));
    callback();
  }

  override _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void
  ) {
    clearTimeout(this.timeout);
    callback(error);
  }
}

function normalizeMethods(method: RouteOptions["method"]) {
  const values = Array.isArray(method) ? method : [method];
  return values.map((value) => String(value).toUpperCase());
}

function routeContractsFromConfig(request: FastifyRequest) {
  return request.routeOptions.config.forgeSecurityContracts;
}

function contractForRequest(request: FastifyRequest) {
  const contracts = routeContractsFromConfig(request);
  const contract = contracts?.[request.method.toUpperCase()];
  if (!contract) {
    throw new HttpError(
      500,
      "gateway_route_unclassified",
      "Forge refused a route that has no immutable security contract."
    );
  }
  return contract;
}

function validatePayloadHeaders(
  request: FastifyRequest,
  contract: RouteSecurityContract
) {
  const contentLength = singleHeader(request, "content-length");
  const transferEncoding = singleHeader(request, "transfer-encoding");
  if (contentLength !== undefined && transferEncoding !== undefined) {
    throw new HttpError(
      400,
      "gateway_ambiguous_body_framing",
      "Forge rejects requests with both Content-Length and Transfer-Encoding."
    );
  }
  if (
    transferEncoding !== undefined &&
    transferEncoding.toLowerCase() !== "chunked"
  ) {
    throw new HttpError(
      400,
      "gateway_transfer_encoding_forbidden",
      "Forge accepts only standard chunked transfer encoding."
    );
  }
  if (contentLength !== undefined) {
    if (!/^(0|[1-9]\d*)$/.test(contentLength)) {
      throw new HttpError(
        400,
        "gateway_content_length_invalid",
        "Forge requires a canonical non-negative Content-Length."
      );
    }
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed) || parsed > contract.maximumBodyBytes) {
      const healthSyncRoute = contract.routePath.startsWith(
        "/api/v1/mobile/healthkit/"
      );
      throw new HttpError(
        413,
        "payload_too_large",
        healthSyncRoute
          ? "The request body is too large. Use chunked HealthKit sync."
          : "The Forge request body exceeds the route's reviewed byte limit.",
        {
          maximumBytes: contract.maximumBodyBytes,
          ...(healthSyncRoute
            ? {
                recommendedMode: "chunked",
                maxBytes: contract.maximumBodyBytes
              }
            : {})
        }
      );
    }
  }
  const contentEncoding = singleHeader(request, "content-encoding");
  if (
    contentEncoding !== undefined &&
    contentEncoding.trim().toLowerCase() !== "identity"
  ) {
    throw new HttpError(
      415,
      "gateway_content_encoding_forbidden",
      "Forge does not accept encoded request bodies on this route."
    );
  }
}

function auditEvent(
  request: FastifyRequest,
  context: {
    contract: RouteSecurityContract;
    authentication: GatewayAuthentication | null;
  },
  outcome: GatewayAuditEvent["outcome"],
  reason: string
): GatewayAuditEvent {
  const principal = context.authentication?.principal ?? null;
  const connectionId =
    context.contract.routePath.includes("/events/stream") ||
    context.contract.routePath.includes("/ws")
      ? `forge-connection:${request.id}`
      : null;
  return {
    requestId: request.id,
    connectionId,
    jobId: null,
    method: context.contract.method,
    routePath: context.contract.routePath,
    action: context.contract.action,
    resource: context.contract.resource,
    outcome,
    reason,
    principalKind: principal?.kind ?? "anonymous",
    subjectId: principal?.subjectId ?? null,
    clientId: principal?.clientId ?? null,
    policyVersion: SECURITY_POLICY_VERSION
  };
}

function securityHeaders(request: FastifyRequest) {
  const encrypted = Boolean(
    (
      request.raw.socket as typeof request.raw.socket & {
        encrypted?: boolean;
      }
    ).encrypted
  );
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; connect-src 'self' https: http: ws: wss:; font-src 'self' data:; worker-src 'self' blob:; child-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'self'",
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy":
      "camera=(self), geolocation=(self), microphone=(self), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    ...(encrypted
      ? {
          "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
        }
      : {})
  };
}

export class AccessGatewayController {
  readonly registeredContracts = new Map<string, RouteSecurityContract>();

  constructor(
    private readonly options: Required<
      Pick<
        InstallAccessGatewayOptions,
        "credentials" | "authorization" | "payloadReceiveTimeoutMilliseconds"
      >
    > &
      Pick<InstallAccessGatewayOptions, "audit"> &
      Pick<InstallAccessGatewayOptions, "rateLimiter">
  ) {}

  private requireRateAdmission(
    request: FastifyRequest,
    contract: RouteSecurityContract,
    authentication: GatewayAuthentication | null,
    phase: "pre_authentication" | "authenticated"
  ) {
    if (!this.options.rateLimiter) return;
    const isPairingPoll =
      contract.routePath === "/api/v1/auth/token" ||
      contract.routePath === "/api/v1/auth/browser/refresh";
    const isAuthProtocol = contract.securityClass === "bounded_auth_protocol";
    const isStream =
      contract.routePath.includes("/events/stream") ||
      contract.routePath.includes("/ws");
    const bucket = isPairingPoll
      ? "pairing_poll"
      : isAuthProtocol
        ? "pairing_attempt"
        : phase === "pre_authentication" && isStream
          ? "request"
          : contract.routePath.includes("/mcp/") ||
              contract.routePath.endsWith("/tools/call")
            ? "mcp_tool"
            : isStream
              ? "stream"
              : contract.routePath.includes("/ai/") ||
                  contract.routePath.includes("/workbench/")
                ? "ai_cost"
                : contract.action.includes("machine")
                  ? "machine_execution"
                  : "request";
    const decision = this.options.rateLimiter.admit({
      bucket,
      principalId: authentication?.principal.subjectId ?? null,
      clientId: authentication?.principal.clientId ?? null,
      installationId: authentication?.principal.installationId ?? null,
      networkId: authentication
        ? null
        : (request.raw.socket.remoteAddress ?? "unknown"),
      action: contract.action,
      cost: bucket === "ai_cost" ? 1_000 : 1,
      now: new Date()
    });
    if (!decision.allowed) {
      throw new HttpError(
        429,
        "security_rate_limit_exceeded",
        "Forge temporarily limited this security-sensitive request. Retry after the indicated delay.",
        {
          retryAfterSeconds: decision.retryAfterSeconds,
          reason: decision.reason
        }
      );
    }
  }

  recordRoute(options: RouteOptions) {
    const contracts: RouteContractConfig = {};
    for (const method of normalizeMethods(options.method)) {
      const contract = resolveRouteSecurityContract({
        method,
        routePath: options.url,
        explicitBodyLimit: options.bodyLimit
      });
      const key = `${contract.method} ${contract.routePath}`;
      const existing = this.registeredContracts.get(key);
      if (existing && JSON.stringify(existing) !== JSON.stringify(contract)) {
        throw new Error(`Conflicting Forge gateway contract for ${key}.`);
      }
      this.registeredContracts.set(key, contract);
      contracts[method] = contract;
    }
    options.config = {
      ...(options.config ?? {}),
      forgeSecurityContracts: contracts
    };
    const reviewedBodyLimit = Math.max(
      ...Object.values(contracts).map((contract) => contract.maximumBodyBytes)
    );
    if (reviewedBodyLimit > 0) {
      options.bodyLimit = reviewedBodyLimit;
    }
  }

  async admit(request: FastifyRequest) {
    const contract = contractForRequest(request);
    let authentication: GatewayAuthentication | null = null;
    let protocolBodyVerifier:
      | GatewayProtocolAuthentication["verifyBody"]
      | null = null;
    try {
      this.requireRateAdmission(request, contract, null, "pre_authentication");
      if (
        contract.securityClass !== "public_static_or_health" &&
        !usesSecureApplicationTransport(request)
      ) {
        throw new HttpError(
          426,
          "gateway_secure_transport_required",
          "Remote Forge API and authentication requests require HTTPS."
        );
      }
      const requiresVerifiedProtocol =
        contract.securityClass === "verified_protocol";
      if (
        requiresVerifiedProtocol &&
        contract.allowedApplicationPrincipalKinds.length > 0
      ) {
        authentication = await this.options.credentials.authenticate(
          request,
          contract
        );
        if (
          authentication &&
          !contract.allowedApplicationPrincipalKinds.includes(
            authentication.principal.kind
          )
        ) {
          throw new HttpError(
            403,
            "gateway_protocol_principal_forbidden",
            "This mixed Forge protocol route does not accept that application principal."
          );
        }
      }
      if (!contract.allowsAnonymousAdmission && !requiresVerifiedProtocol) {
        authentication = await this.options.credentials.authenticate(
          request,
          contract
        );
      }
      if (contract.securityClass === "protected" && !authentication) {
        throw new HttpError(
          401,
          "gateway_authentication_required",
          "A valid paired Forge credential or browser session is required."
        );
      }
      if (requiresVerifiedProtocol && !authentication) {
        const verified = await this.options.credentials.verifyProtocolEarly?.(
          request,
          contract
        );
        if (!verified || verified.mode !== "verified_protocol") {
          throw new HttpError(
            401,
            "gateway_protocol_verification_required",
            "The Forge protocol proof is missing, invalid, replayed, or expired."
          );
        }
        authentication = verified;
        protocolBodyVerifier = verified.verifyBody ?? null;
      }
      if (
        authentication?.mode === "browser_session" &&
        isUnsafeMethod(request.method) &&
        !authentication.csrfSatisfied
      ) {
        throw new HttpError(
          403,
          "gateway_csrf_required",
          "A valid anti-CSRF proof is required for this browser operation."
        );
      }
      if (authentication) {
        this.requireRateAdmission(
          request,
          contract,
          authentication,
          "authenticated"
        );
        await this.options.authorization.authorize({
          request,
          contract,
          authentication,
          phase: "early"
        });
      }
      validatePayloadHeaders(request, contract);
      request.forgeSecurity = {
        policyVersion: SECURITY_POLICY_VERSION,
        contract,
        authentication,
        protocolBodyVerifier,
        receivedBodySha256: null,
        connectionId:
          contract.routePath.includes("/events/stream") ||
          contract.routePath.includes("/ws")
            ? `forge-connection:${request.id}`
            : null
      };
      await this.options.audit?.record(
        auditEvent(
          request,
          { contract, authentication },
          "admitted",
          protocolBodyVerifier
            ? "gateway_admitted_body_binding_pending"
            : "gateway_admitted"
        )
      );
    } catch (error) {
      await this.options.audit?.record(
        auditEvent(
          request,
          { contract, authentication },
          "denied",
          error instanceof HttpError ? error.code : "gateway_error"
        )
      );
      throw error;
    }
  }

  wrapPayload(request: FastifyRequest, payload: NodeJS.ReadableStream) {
    const context = request.forgeSecurity;
    if (!context) {
      throw new HttpError(
        500,
        "gateway_context_missing",
        "Forge payload parsing began without gateway admission."
      );
    }
    const bounded = new BoundedPayloadStream(
      context.contract.maximumBodyBytes,
      this.options.payloadReceiveTimeoutMilliseconds,
      (sha256) => {
        context.receivedBodySha256 = sha256;
      }
    );
    return payload.pipe(bounded);
  }

  async authorizeBody(request: FastifyRequest) {
    const context = request.forgeSecurity;
    if (!context) {
      throw new HttpError(
        500,
        "gateway_context_missing",
        "Forge validation began without gateway admission."
      );
    }
    if (
      context.receivedBodySha256 === null &&
      request.headers["transfer-encoding"] === undefined &&
      (request.headers["content-length"] === undefined ||
        request.headers["content-length"] === "0")
    ) {
      context.receivedBodySha256 = createHash("sha256")
        .update(Buffer.alloc(0))
        .digest("hex");
    }
    if (context.protocolBodyVerifier) {
      await context.protocolBodyVerifier(request);
      context.protocolBodyVerifier = null;
    }
    if (context.authentication) {
      await this.options.authorization.authorize({
        request,
        contract: context.contract,
        authentication: context.authentication,
        phase: "body"
      });
    }
  }
}

export function installAccessGateway(
  app: FastifyInstance,
  options: InstallAccessGatewayOptions
) {
  const controller = new AccessGatewayController({
    credentials: options.credentials,
    authorization: options.authorization ?? defaultGatewayAuthorization,
    audit: options.audit,
    rateLimiter: options.rateLimiter,
    payloadReceiveTimeoutMilliseconds:
      options.payloadReceiveTimeoutMilliseconds ??
      DEFAULT_PAYLOAD_RECEIVE_TIMEOUT_MS
  });
  app.decorateRequest("forgeSecurity", null);
  app.addHook("onRoute", (routeOptions) => {
    controller.recordRoute(routeOptions);
  });
  app.addHook("onRequest", async (request) => {
    await controller.admit(request);
  });
  app.addHook("preParsing", async (request, _reply, payload) =>
    controller.wrapPayload(request, payload)
  );
  app.addHook("preValidation", async (request) => {
    await controller.authorizeBody(request);
  });
  app.addHook("onError", async (_request, reply, error) => {
    if (!(error instanceof HttpError) || error.statusCode !== 429) return;
    const retryAfterSeconds =
      error.details &&
      typeof error.details.retryAfterSeconds === "number" &&
      Number.isFinite(error.details.retryAfterSeconds)
        ? Math.max(
            1,
            Math.min(86_400, Math.ceil(error.details.retryAfterSeconds))
          )
        : null;
    if (retryAfterSeconds !== null && !reply.hasHeader("Retry-After")) {
      reply.header("Retry-After", String(retryAfterSeconds));
    }
  });
  app.addHook("onSend", async (request, reply, payload) => {
    for (const [name, value] of Object.entries(securityHeaders(request))) {
      if (!reply.hasHeader(name)) {
        reply.header(name, value);
      }
    }
    return payload;
  });
  return controller;
}

export function requireGatewayPrincipal(request: FastifyRequest) {
  const principal = request.forgeSecurity?.authentication?.principal;
  if (!principal) {
    throw new HttpError(
      401,
      "gateway_authentication_required",
      "A verified Forge principal is required."
    );
  }
  return principal;
}

export const forgeAccessGatewayPolicyVersion = SECURITY_POLICY_VERSION;
