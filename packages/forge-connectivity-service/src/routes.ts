import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationHookHandler
} from "fastify";

import {
  authenticateChannelRequest,
  requireIdempotencyKey,
  type ChannelAuthContext
} from "./auth.js";
import type { ConnectivityConfig } from "./config.js";
import {
  decodeBase64Url,
  decodeCursor,
  digestCiphertextForChannel,
  encodeBase64Url,
  encodeCursor
} from "./encoding.js";
import { ServiceError, rateLimited } from "./errors.js";
import type { PollCoordinator } from "./poll-coordinator.js";
import { TokenBucketRateLimiter } from "./rate-limiter.js";
import { createRouteSchemas } from "./schemas.js";
import type { ConnectivityStore, StoredHttpResponse } from "./storage/types.js";
import { PROTOCOL_VERSION, SERVICE_NAME, SERVICE_VERSION } from "./version.js";

interface OpaqueChannelParams {
  opaqueChannel: string;
}

interface CiphertextBody {
  ciphertext: string;
  expiresInSeconds?: number;
}

interface EnvelopeBody extends CiphertextBody {
  messageId: string;
}

interface AckBody {
  messageIds: string[];
}

interface KeyPackageBody extends CiphertextBody {
  packageId: string;
}

interface PageQuery {
  cursor?: string;
  limit?: number;
}

interface EnvelopePageQuery extends PageQuery {
  waitSeconds?: number;
}

export interface RouteDependencies {
  clock?: () => number;
  config: ConnectivityConfig;
  pollCoordinator: PollCoordinator;
  store: ConnectivityStore;
}

export function registerConnectivityRoutes(
  app: FastifyInstance,
  dependencies: RouteDependencies
): void {
  const clock = dependencies.clock ?? Date.now;
  const schemas = createRouteSchemas(dependencies.config);
  const authContexts = new WeakMap<FastifyRequest, ChannelAuthContext>();
  const channelRateLimiter = new TokenBucketRateLimiter(
    dependencies.config.rateLimit.channelRequestsPerMinute,
    dependencies.config.rateLimit.trackedChannels,
    dependencies.config.rateLimit.channelBurstRequests
  );

  const authenticate: preValidationHookHandler = (request, _reply, done) => {
    try {
      const typedRequest = request as FastifyRequest<{
        Params: OpaqueChannelParams;
      }>;
      const context = authenticateChannelRequest(
        typedRequest,
        dependencies.store,
        dependencies.config,
        clock(),
        (channelHash, nowMs) => {
          const rateDecision = channelRateLimiter.consume(channelHash, nowMs);
          if (!rateDecision.allowed) {
            throw rateLimited(rateDecision.retryAfterSeconds);
          }
        }
      );
      authContexts.set(request, context);
      done();
    } catch (error) {
      done(
        error instanceof Error
          ? error
          : new ServiceError(
              "INTERNAL_ERROR",
              500,
              "Channel authentication failed."
            )
      );
    }
  };
  const normalizePageQuery: preValidationHookHandler = (
    request,
    _reply,
    done
  ) => {
    try {
      const query = request.query as Record<string, unknown>;
      for (const field of ["limit", "waitSeconds"] as const) {
        if (query[field] !== undefined) {
          query[field] = parseUnsignedQueryInteger(query[field]);
        }
      }
      done();
    } catch (error) {
      done(
        error instanceof Error
          ? error
          : new ServiceError(
              "INTERNAL_ERROR",
              500,
              "Query normalization failed."
            )
      );
    }
  };

  app.get(
    "/.well-known/forge-connectivity",
    { schema: schemas.wellKnown },
    () => ({
      protocol: PROTOCOL_VERSION,
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      auth: {
        scheme: "ForgeChannel",
        algorithm: "Ed25519",
        channelDerivation: "sha256-spki-v1",
        replayProtection: "timestamp-nonce-v1"
      },
      capabilities: {
        presence: true,
        envelopes: true,
        keyPackages: true,
        longPoll: true,
        ciphertextOnly: true
      },
      limits: {
        maxEnvelopeBytes: dependencies.config.limits.maxEnvelopeBytes,
        maxPresenceBytes: dependencies.config.limits.maxPresenceBytes,
        maxKeyPackageBytes: dependencies.config.limits.maxKeyPackageBytes,
        maxChannelEnvelopeCount:
          dependencies.config.limits.maxChannelEnvelopeCount,
        maxChannelEnvelopeBytes:
          dependencies.config.limits.maxChannelEnvelopeBytes,
        maxChannelRetainedEnvelopeCount:
          dependencies.config.limits.maxChannelRetainedEnvelopeCount,
        maxChannelKeyPackageCount:
          dependencies.config.limits.maxChannelKeyPackageCount,
        maxChannelKeyPackageBytes:
          dependencies.config.limits.maxChannelKeyPackageBytes,
        channelRequestsPerMinute:
          dependencies.config.rateLimit.channelRequestsPerMinute,
        channelBurstRequests:
          dependencies.config.rateLimit.channelBurstRequests,
        maxCursorPageSize: dependencies.config.polling.maxPageSize,
        maxLongPollSeconds: Math.floor(
          dependencies.config.polling.maxWaitMs / 1_000
        ),
        maxEnvelopeTtlSeconds: Math.floor(
          dependencies.config.limits.maxEnvelopeTtlMs / 1_000
        ),
        maxPresenceTtlSeconds: Math.floor(
          dependencies.config.limits.maxPresenceTtlMs / 1_000
        ),
        maxKeyPackageTtlSeconds: Math.floor(
          dependencies.config.limits.maxKeyPackageTtlMs / 1_000
        )
      },
      routes: {
        presence: "/v1/presence/{opaqueChannel}",
        envelopes: "/v1/envelopes/{opaqueChannel}",
        envelopeAck: "/v1/envelopes/{opaqueChannel}/ack",
        keyPackages: "/v1/key-packages/{opaqueChannel}",
        health: "/healthz"
      }
    })
  );

  app.get("/healthz", { schema: schemas.health }, (_request, reply) => {
    try {
      const health = dependencies.store.healthCheck();
      return reply.code(health.ok ? 200 : 503).send({
        status: health.ok ? "ok" : "degraded",
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        storage: {
          status: health.ok ? "ok" : "unavailable",
          schemaVersion: health.schemaVersion
        }
      });
    } catch {
      return reply.code(503).send({
        status: "degraded",
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        storage: { status: "unavailable", schemaVersion: 0 }
      });
    }
  });

  app.put<{ Params: OpaqueChannelParams; Body: CiphertextBody }>(
    "/v1/presence/:opaqueChannel",
    { preValidation: authenticate, schema: schemas.putPresence },
    (request, reply) => {
      const nowMs = clock();
      const ciphertext = decodeBase64Url(
        request.body.ciphertext,
        dependencies.config.limits.maxPresenceBytes
      );
      const expiresAt = expiryFromSeconds(
        nowMs,
        request.body.expiresInSeconds,
        dependencies.config.limits.defaultPresenceTtlMs
      );
      return sendIdempotent(
        request,
        reply,
        authContexts,
        dependencies,
        "PUT presence",
        nowMs,
        () => {
          const context = requireContext(authContexts, request);
          const result = dependencies.store.putPresence({
            channelHash: context.channelHash,
            ciphertext,
            contentDigest: digestCiphertextForChannel(
              context.channelHash,
              ciphertext
            ),
            expiresAt,
            maxGlobalBytes: dependencies.config.limits.maxGlobalBytes,
            maxGlobalCount: dependencies.config.limits.maxGlobalPresenceCount,
            nowMs
          });
          return {
            statusCode: result.created ? 201 : 200,
            body: { stored: true, expiresAt: toIso(result.expiresAt) }
          };
        }
      );
    }
  );

  app.get<{ Params: OpaqueChannelParams }>(
    "/v1/presence/:opaqueChannel",
    { preValidation: authenticate, schema: schemas.getPresence },
    (request) => {
      const context = requireContext(authContexts, request);
      const record = dependencies.store.getPresence(
        context.channelHash,
        clock()
      );
      if (record === undefined) {
        throw new ServiceError(
          "NOT_FOUND",
          404,
          "No active presence descriptor exists for this channel."
        );
      }
      return {
        ciphertext: encodeBase64Url(record.ciphertext),
        updatedAt: toIso(record.updatedAt),
        expiresAt: toIso(record.expiresAt)
      };
    }
  );

  app.delete<{ Params: OpaqueChannelParams }>(
    "/v1/presence/:opaqueChannel",
    { preValidation: authenticate, schema: schemas.deletePresence },
    (request, reply) => {
      const nowMs = clock();
      return sendIdempotent(
        request,
        reply,
        authContexts,
        dependencies,
        "DELETE presence",
        nowMs,
        () => {
          const context = requireContext(authContexts, request);
          return {
            statusCode: 200,
            body: {
              deleted: dependencies.store.deletePresence(context.channelHash)
            }
          };
        }
      );
    }
  );

  app.post<{ Params: OpaqueChannelParams; Body: EnvelopeBody }>(
    "/v1/envelopes/:opaqueChannel",
    { preValidation: authenticate, schema: schemas.postEnvelope },
    (request, reply) => {
      const nowMs = clock();
      const ciphertext = decodeBase64Url(
        request.body.ciphertext,
        dependencies.config.limits.maxEnvelopeBytes
      );
      const expiresAt = expiryFromSeconds(
        nowMs,
        request.body.expiresInSeconds,
        dependencies.config.limits.defaultEnvelopeTtlMs
      );
      const response = sendIdempotent(
        request,
        reply,
        authContexts,
        dependencies,
        "POST envelope",
        nowMs,
        () => {
          const context = requireContext(authContexts, request);
          const result = dependencies.store.putEnvelope({
            channelHash: context.channelHash,
            ciphertext,
            contentDigest: digestCiphertextForChannel(
              context.channelHash,
              ciphertext
            ),
            expiresAt,
            maxChannelBytes: dependencies.config.limits.maxChannelEnvelopeBytes,
            maxChannelCount: dependencies.config.limits.maxChannelEnvelopeCount,
            maxChannelRetainedCount:
              dependencies.config.limits.maxChannelRetainedEnvelopeCount,
            maxGlobalBytes: dependencies.config.limits.maxGlobalBytes,
            maxGlobalRetainedCount:
              dependencies.config.limits.maxGlobalRetainedEnvelopeCount,
            messageId: request.body.messageId,
            nowMs,
            replayRetentionMs: dependencies.config.limits.replayRetentionMs
          });
          return {
            statusCode: result.accepted ? 202 : 200,
            body: {
              accepted: result.accepted,
              duplicate: result.duplicate,
              messageId: request.body.messageId,
              state: result.state,
              expiresAt: toIso(result.expiresAt)
            }
          };
        },
        (result) => {
          if (!result.replayed && result.body.accepted === true) {
            const context = requireContext(authContexts, request);
            dependencies.pollCoordinator.notify(context.channelHash);
          }
        }
      );
      return response;
    }
  );

  app.get<{ Params: OpaqueChannelParams; Querystring: EnvelopePageQuery }>(
    "/v1/envelopes/:opaqueChannel",
    {
      preValidation: [authenticate, normalizePageQuery],
      schema: schemas.getEnvelopes
    },
    async (request, reply) => {
      const context = requireContext(authContexts, request);
      const afterRowId = decodeCursor(request.query.cursor);
      const limit =
        request.query.limit ?? dependencies.config.polling.defaultPageSize;
      const waitMs = (request.query.waitSeconds ?? 0) * 1_000;
      const generation =
        waitMs > 0
          ? dependencies.pollCoordinator.generation(context.channelHash)
          : 0;
      let page = dependencies.store.listEnvelopes(
        context.channelHash,
        afterRowId,
        limit,
        clock()
      );
      let pollTimedOut = false;

      if (page.records.length === 0 && waitMs > 0) {
        const pollAbort = new AbortController();
        const abortPoll = (): void => pollAbort.abort();
        request.raw.once("aborted", abortPoll);
        reply.raw.once("close", abortPoll);
        if (request.raw.aborted || reply.raw.destroyed) {
          pollAbort.abort();
        }
        let wakeReason: Awaited<ReturnType<PollCoordinator["wait"]>>;
        try {
          wakeReason = await dependencies.pollCoordinator.wait(
            context.channelHash,
            waitMs,
            generation,
            pollAbort.signal
          );
        } finally {
          request.raw.off("aborted", abortPoll);
          reply.raw.off("close", abortPoll);
        }
        if (wakeReason === "aborted") {
          reply.hijack();
          return reply;
        }
        if (wakeReason === "closed") {
          throw new ServiceError(
            "SERVICE_CLOSING",
            503,
            "The service is shutting down."
          );
        }
        pollTimedOut = wakeReason === "timeout";
        page = dependencies.store.listEnvelopes(
          context.channelHash,
          afterRowId,
          limit,
          clock()
        );
      }

      const finalRowId = page.records.at(-1)?.rowId ?? afterRowId;
      return {
        envelopes: page.records.map((record) => ({
          messageId: record.messageId,
          ciphertext: encodeBase64Url(record.ciphertext),
          createdAt: toIso(record.createdAt),
          expiresAt: toIso(record.expiresAt)
        })),
        nextCursor: encodeCursor(finalRowId),
        pollTimedOut
      };
    }
  );

  app.post<{ Params: OpaqueChannelParams; Body: AckBody }>(
    "/v1/envelopes/:opaqueChannel/ack",
    { preValidation: authenticate, schema: schemas.ackEnvelopes },
    (request, reply) => {
      const nowMs = clock();
      return sendIdempotent(
        request,
        reply,
        authContexts,
        dependencies,
        "POST envelope ack",
        nowMs,
        () => {
          const context = requireContext(authContexts, request);
          return {
            statusCode: 200,
            body: dependencies.store.ackEnvelopes(
              context.channelHash,
              request.body.messageIds,
              nowMs,
              dependencies.config.limits.replayRetentionMs
            )
          };
        }
      );
    }
  );

  app.put<{ Params: OpaqueChannelParams; Body: KeyPackageBody }>(
    "/v1/key-packages/:opaqueChannel",
    { preValidation: authenticate, schema: schemas.putKeyPackage },
    (request, reply) => {
      const nowMs = clock();
      const ciphertext = decodeBase64Url(
        request.body.ciphertext,
        dependencies.config.limits.maxKeyPackageBytes
      );
      const expiresAt = expiryFromSeconds(
        nowMs,
        request.body.expiresInSeconds,
        dependencies.config.limits.defaultKeyPackageTtlMs
      );
      return sendIdempotent(
        request,
        reply,
        authContexts,
        dependencies,
        "PUT key package",
        nowMs,
        () => {
          const context = requireContext(authContexts, request);
          const result = dependencies.store.putKeyPackage({
            channelHash: context.channelHash,
            ciphertext,
            contentDigest: digestCiphertextForChannel(
              context.channelHash,
              ciphertext
            ),
            expiresAt,
            maxChannelBytes:
              dependencies.config.limits.maxChannelKeyPackageBytes,
            maxChannelCount:
              dependencies.config.limits.maxChannelKeyPackageCount,
            maxGlobalBytes: dependencies.config.limits.maxGlobalBytes,
            maxGlobalCount: dependencies.config.limits.maxGlobalKeyPackageCount,
            nowMs,
            packageId: request.body.packageId
          });
          return {
            statusCode: result.created ? 201 : 200,
            body: {
              stored: result.created,
              duplicate: result.duplicate,
              packageId: request.body.packageId,
              expiresAt: toIso(result.expiresAt)
            }
          };
        }
      );
    }
  );

  app.get<{ Params: OpaqueChannelParams; Querystring: PageQuery }>(
    "/v1/key-packages/:opaqueChannel",
    {
      preValidation: [authenticate, normalizePageQuery],
      schema: schemas.getKeyPackages
    },
    (request) => {
      const context = requireContext(authContexts, request);
      const afterRowId = decodeCursor(request.query.cursor);
      const page = dependencies.store.listKeyPackages(
        context.channelHash,
        afterRowId,
        request.query.limit ?? dependencies.config.polling.defaultPageSize,
        clock()
      );
      return {
        keyPackages: page.records.map((record) => ({
          packageId: record.packageId,
          ciphertext: encodeBase64Url(record.ciphertext),
          createdAt: toIso(record.createdAt),
          expiresAt: toIso(record.expiresAt)
        })),
        nextCursor: encodeCursor(page.records.at(-1)?.rowId ?? afterRowId)
      };
    }
  );
}

function sendIdempotent<T extends Record<string, unknown>>(
  request: FastifyRequest,
  reply: FastifyReply,
  authContexts: WeakMap<FastifyRequest, ChannelAuthContext>,
  dependencies: RouteDependencies,
  scope: string,
  nowMs: number,
  operation: () => Omit<StoredHttpResponse<T>, "replayed">,
  afterCommit?: (result: StoredHttpResponse<T>) => void
): FastifyReply {
  const context = requireContext(authContexts, request);
  const result = dependencies.store.runIdempotent(
    {
      channelHash: context.channelHash,
      expiresAt: nowMs + dependencies.config.limits.idempotencyRetentionMs,
      key: requireIdempotencyKey(context),
      maxChannelRecords:
        dependencies.config.limits.maxChannelIdempotencyRecords,
      maxGlobalRecords: dependencies.config.limits.maxGlobalIdempotencyRecords,
      nowMs,
      requestDigest: context.requestDigest,
      scope
    },
    operation
  );
  afterCommit?.(result);
  reply.header("idempotency-replayed", result.replayed ? "true" : "false");
  return reply.code(result.statusCode).send(result.body);
}

function requireContext(
  authContexts: WeakMap<FastifyRequest, ChannelAuthContext>,
  request: FastifyRequest
): ChannelAuthContext {
  const context = authContexts.get(request);
  if (context === undefined) {
    throw new ServiceError(
      "AUTH_INVALID",
      401,
      "A verified channel request context is required."
    );
  }
  return context;
}

function expiryFromSeconds(
  nowMs: number,
  requestedSeconds: number | undefined,
  defaultTtlMs: number
): number {
  return (
    nowMs +
    (requestedSeconds === undefined ? defaultTtlMs : requestedSeconds * 1_000)
  );
}

function toIso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function parseUnsignedQueryInteger(value: unknown): number {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new ServiceError(
      "VALIDATION_ERROR",
      400,
      "Integer query parameters must use unsigned decimal notation."
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ServiceError(
      "VALIDATION_ERROR",
      400,
      "Integer query parameters are outside the supported range."
    );
  }
  return parsed;
}
