import swagger from "@fastify/swagger";
import Fastify, {
  LogController,
  type FastifyError,
  type FastifyInstance,
  type FastifyRequest
} from "fastify";

import type { ConnectivityConfig } from "./config.js";
import { ServiceError, rateLimited, unauthorized } from "./errors.js";
import { SafeLogger } from "./logger.js";
import { PollCoordinator } from "./poll-coordinator.js";
import { TokenBucketRateLimiter } from "./rate-limiter.js";
import { registerConnectivityRoutes } from "./routes.js";
import { SqliteConnectivityStore } from "./storage/sqlite.js";
import type { ConnectivityStore } from "./storage/types.js";
import { PROTOCOL_VERSION, SERVICE_VERSION } from "./version.js";

const ROUTE_TEMPLATES = new Set([
  "/.well-known/forge-connectivity",
  "/healthz",
  "/v1/presence/:opaqueChannel",
  "/v1/envelopes/:opaqueChannel",
  "/v1/envelopes/:opaqueChannel/ack",
  "/v1/key-packages/:opaqueChannel"
]);
const PUBLIC_ROUTE_TEMPLATES = new Set([
  "/.well-known/forge-connectivity",
  "/healthz"
]);
const BODY_ROUTE_KEYS = new Set([
  "PUT /v1/presence/:opaqueChannel",
  "POST /v1/envelopes/:opaqueChannel",
  "POST /v1/envelopes/:opaqueChannel/ack",
  "PUT /v1/key-packages/:opaqueChannel"
]);
const SINGLETON_REQUEST_HEADERS = new Set([
  "authorization",
  "content-encoding",
  "content-length",
  "content-type",
  "expect",
  "host",
  "idempotency-key",
  "transfer-encoding"
]);
export interface CreateServiceOptions {
  clock?: () => number;
  config: ConnectivityConfig;
  logger?: SafeLogger;
  store?: ConnectivityStore;
}

export interface ConnectivityService {
  app: FastifyInstance;
  close: () => Promise<void>;
  listen: () => Promise<void>;
  store: ConnectivityStore;
}

export async function createConnectivityService(
  options: CreateServiceOptions
): Promise<ConnectivityService> {
  const clock = options.clock ?? Date.now;
  const logger =
    options.logger ??
    new SafeLogger(options.config.logging.level, undefined, clock);
  const store =
    options.store ??
    new SqliteConnectivityStore({
      busyTimeoutMs: options.config.storage.busyTimeoutMs,
      databasePath: options.config.storage.databasePath
    });
  const pollCoordinator = new PollCoordinator(
    options.config.polling.maxGlobalConcurrent,
    options.config.polling.maxChannelConcurrent,
    options.config.rateLimit.trackedChannels
  );
  const globalRateLimiter = new TokenBucketRateLimiter(
    options.config.rateLimit.globalRequestsPerMinute,
    1,
    options.config.rateLimit.globalBurstRequests
  );
  const requestStartedAt = new WeakMap<FastifyRequest, number>();

  const app = Fastify({
    ajv: {
      customOptions: {
        coerceTypes: false,
        removeAdditional: false,
        useDefaults: true
      }
    },
    bodyLimit: options.config.server.requestBodyLimitBytes,
    connectionTimeout: 10_000,
    exposeHeadRoutes: false,
    keepAliveTimeout: 72_000,
    logController: new LogController({ disableRequestLogging: true }),
    logger: false,
    onConstructorPoisoning: "error",
    onProtoPoisoning: "error",
    requestTimeout: options.config.polling.maxWaitMs + 10_000,
    trustProxy: false
  });

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Forge Connectivity Service",
        description:
          "Content-blind presence, mailbox, and key-package transport for independently operated Forge peers.",
        version: SERVICE_VERSION,
        license: { name: "Apache-2.0", identifier: "Apache-2.0" }
      },
      tags: [
        { name: "Discovery" },
        { name: "Presence" },
        { name: "Envelopes" },
        { name: "Key packages" },
        { name: "Operations" }
      ],
      components: {
        securitySchemes: {
          ForgeChannelSignature: {
            type: "apiKey",
            in: "header",
            name: "Authorization",
            description:
              "Ed25519 possession proof: ForgeChannel v1.<SPKI>.<unix-seconds>.<nonce>.<signature>. It is unrelated to Forge bearer tokens."
          }
        }
      },
      externalDocs: {
        description: `${PROTOCOL_VERSION} self-hosting and security documentation`,
        url: "https://github.com/albertbuchard/forge/tree/main/packages/forge-connectivity-service/docs"
      }
    },
    hideUntagged: true
  });

  app.addHook("onRequest", (request, _reply, done) => {
    const nowMs = clock();
    requestStartedAt.set(request, nowMs);
    const routeTemplate = request.routeOptions.url;
    if (routeTemplate !== "/healthz") {
      const decision = globalRateLimiter.consume("global", nowMs);
      if (!decision.allowed) {
        done(rateLimited(decision.retryAfterSeconds));
        return;
      }
    }
    if (
      hasDuplicateSingletonHeader(request.raw.rawHeaders) ||
      (request.headers["content-length"] !== undefined &&
        request.headers["transfer-encoding"] !== undefined)
    ) {
      done(
        new ServiceError(
          "AMBIGUOUS_REQUEST_HEADERS",
          400,
          "Security-sensitive request headers must be unambiguous."
        )
      );
      return;
    }
    const authorization = request.headers.authorization;
    if (authorization !== undefined && /^Bearer(?:\s|$)/i.test(authorization)) {
      done(unauthorized("AUTH_INVALID"));
      return;
    }
    if (
      routeTemplate !== undefined &&
      PUBLIC_ROUTE_TEMPLATES.has(routeTemplate) &&
      authorization !== undefined
    ) {
      done(
        new ServiceError(
          "CREDENTIAL_NOT_ALLOWED",
          400,
          "Credentials are not accepted on public service routes."
        )
      );
      return;
    }
    if (request.headers.cookie !== undefined) {
      done(
        new ServiceError(
          "CREDENTIAL_NOT_ALLOWED",
          400,
          "Cookies are not accepted by this service."
        )
      );
      return;
    }
    if (
      Object.keys(request.headers).some((header) =>
        header.startsWith("x-forge-")
      )
    ) {
      done(
        new ServiceError(
          "SENSITIVE_METADATA_NOT_ALLOWED",
          400,
          "Forge tokens, grants, projections, and contact metadata are not accepted."
        )
      );
      return;
    }
    const contentEncoding = request.headers["content-encoding"];
    if (contentEncoding !== undefined && contentEncoding !== "identity") {
      done(
        new ServiceError(
          "CONTENT_ENCODING_UNSUPPORTED",
          415,
          "Compressed request bodies are not accepted."
        )
      );
      return;
    }
    const carriesBody = requestCarriesBody(request);
    const acceptsBody = BODY_ROUTE_KEYS.has(
      `${request.method} ${routeTemplate ?? "unmatched"}`
    );
    if (carriesBody && !acceptsBody) {
      done(
        new ServiceError(
          "REQUEST_BODY_NOT_ALLOWED",
          400,
          "This route does not accept a request body."
        )
      );
      return;
    }
    if (
      carriesBody &&
      acceptsBody &&
      !isJsonContentType(request.headers["content-type"])
    ) {
      done(
        new ServiceError(
          "CONTENT_TYPE_UNSUPPORTED",
          415,
          "Request bodies must use the application/json media type."
        )
      );
      return;
    }
    done();
  });

  app.addHook("onSend", (request, reply, payload, done) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header(
      "cache-control",
      request.routeOptions.url === "/.well-known/forge-connectivity"
        ? "public, max-age=300"
        : "no-store"
    );
    done(null, payload);
  });

  app.addHook("onResponse", (request, reply, done) => {
    const startedAt = requestStartedAt.get(request) ?? clock();
    logger.routeCompleted(
      request.method,
      safeRouteTemplate(request),
      reply.statusCode,
      Math.max(0, clock() - startedAt)
    );
    done();
  });

  app.setErrorHandler((error, request, reply) => {
    const serviceError = normalizeError(error);
    for (const [header, value] of Object.entries(serviceError.headers)) {
      reply.header(header, value);
    }
    logger.requestRejected(
      safeRouteTemplate(request),
      serviceError.code,
      serviceError.statusCode
    );
    return reply.code(serviceError.statusCode).send({
      error: { code: serviceError.code, message: serviceError.message }
    });
  });

  app.setNotFoundHandler((request, reply) => {
    const notFound = new ServiceError(
      "NOT_FOUND",
      404,
      "The requested service route does not exist."
    );
    logger.requestRejected(
      safeRouteTemplate(request),
      notFound.code,
      notFound.statusCode
    );
    return reply
      .code(404)
      .send({ error: { code: notFound.code, message: notFound.message } });
  });

  registerConnectivityRoutes(app, {
    clock,
    config: options.config,
    pollCoordinator,
    store
  });

  const cleanupTimer = setInterval(() => {
    try {
      store.cleanupExpired(clock(), options.config.storage.cleanupBatchSize);
    } catch {
      logger.cleanupFailed("STORAGE_CLEANUP_FAILED");
    }
  }, options.config.storage.cleanupIntervalMs);
  cleanupTimer.unref();

  app.addHook("preClose", () => {
    clearInterval(cleanupTimer);
    pollCoordinator.close();
  });
  app.addHook("onClose", () => {
    store.close();
  });

  try {
    await app.ready();
  } catch (error) {
    clearInterval(cleanupTimer);
    pollCoordinator.close();
    store.close();
    throw error;
  }

  return {
    app,
    store,
    close: async () => {
      pollCoordinator.close();
      await app.close();
    },
    listen: async () => {
      await app.listen({
        host: options.config.server.host,
        port: options.config.server.port
      });
    }
  };
}

function normalizeError(error: unknown): ServiceError {
  if (error instanceof ServiceError) {
    return error;
  }
  const fastifyError = error as FastifyError;
  if (fastifyError.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
    return new ServiceError(
      "BLOB_TOO_LARGE",
      413,
      "The request body exceeds the service limit."
    );
  }
  if (fastifyError.statusCode === 415) {
    return new ServiceError(
      "CONTENT_TYPE_UNSUPPORTED",
      415,
      "Request bodies must use the application/json media type."
    );
  }
  if (
    fastifyError.validation !== undefined ||
    fastifyError.statusCode === 400
  ) {
    return new ServiceError(
      "VALIDATION_ERROR",
      400,
      "Request validation failed."
    );
  }
  return new ServiceError(
    "INTERNAL_ERROR",
    500,
    "The service could not complete the request."
  );
}

function safeRouteTemplate(request: FastifyRequest): string {
  const route = request.routeOptions.url;
  return route !== undefined && ROUTE_TEMPLATES.has(route)
    ? route
    : "unmatched";
}

function requestCarriesBody(request: FastifyRequest): boolean {
  const contentLength = request.headers["content-length"];
  return (
    request.headers["transfer-encoding"] !== undefined ||
    (Array.isArray(contentLength)
      ? contentLength.length > 0
      : contentLength !== undefined && contentLength !== "0")
  );
}

function hasDuplicateSingletonHeader(rawHeaders: readonly string[]): boolean {
  const seen = new Set<string>();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const rawName = rawHeaders[index];
    if (rawName === undefined) {
      return true;
    }
    const name = rawName.toLowerCase();
    if (!SINGLETON_REQUEST_HEADERS.has(name)) {
      continue;
    }
    if (seen.has(name)) {
      return true;
    }
    seen.add(name);
  }
  return false;
}

function isJsonContentType(value: string | string[] | undefined): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const mediaType = value.split(";", 1)[0];
  return mediaType?.trim().toLowerCase() === "application/json";
}
