import type { FastifySchema } from "fastify";

import { CHANNEL_AUTHORIZATION_HEADER_PATTERN } from "./auth.js";
import type { ConnectivityConfig } from "./config.js";
import { OPAQUE_CHANNEL_PATTERN, OPAQUE_ID_PATTERN } from "./encoding.js";
import { SERVICE_ERROR_CODES } from "./errors.js";

const dateTime = { type: "string", format: "date-time" } as const;
const cursor = { type: "string", pattern: "^[A-Za-z0-9_-]{11}$" } as const;
const opaqueChannelParams = {
  type: "object",
  additionalProperties: false,
  required: ["opaqueChannel"],
  properties: {
    opaqueChannel: { type: "string", pattern: OPAQUE_CHANNEL_PATTERN }
  }
} as const;

const errorResponse = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: {
    error: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message"],
      properties: {
        code: { type: "string", enum: SERVICE_ERROR_CODES },
        message: { type: "string" }
      }
    }
  }
} as const;

const authorizationHeader = {
  type: "string",
  pattern: CHANNEL_AUTHORIZATION_HEADER_PATTERN,
  description: "Exactly one ForgeChannel authorization header."
} as const;

const idempotencyHeader = {
  type: "string",
  pattern: "^[A-Za-z0-9_-]{16,128}$",
  description: "Exactly one mutation idempotency key."
} as const;

const idempotencyResponseHeaders = {
  "idempotency-replayed": {
    type: "string",
    enum: ["true", "false"],
    description:
      "Whether this response was replayed from a committed idempotency record."
  }
} as const;

const security = [{ ForgeChannelSignature: [] }];
const emptyQuery = {
  type: "object",
  properties: {},
  additionalProperties: false,
  maxProperties: 0
} as const;

export interface RouteSchemas {
  ackEnvelopes: FastifySchema;
  deletePresence: FastifySchema;
  getEnvelopes: FastifySchema;
  getKeyPackages: FastifySchema;
  getPresence: FastifySchema;
  health: FastifySchema;
  postEnvelope: FastifySchema;
  putKeyPackage: FastifySchema;
  putPresence: FastifySchema;
  wellKnown: FastifySchema;
}

export function createRouteSchemas(config: ConnectivityConfig): RouteSchemas {
  const protectedHeaders = {
    type: "object",
    required: ["authorization"],
    properties: { authorization: authorizationHeader }
  } as const;
  const mutationHeaders = {
    type: "object",
    required: ["authorization", "idempotency-key"],
    properties: {
      authorization: authorizationHeader,
      "idempotency-key": idempotencyHeader
    }
  } as const;
  const pageQuery = {
    type: "object",
    additionalProperties: false,
    properties: {
      cursor,
      limit: {
        type: "integer",
        minimum: 1,
        maximum: config.polling.maxPageSize,
        default: config.polling.defaultPageSize
      }
    }
  } as const;
  const mutationResponse = {
    type: "object",
    headers: idempotencyResponseHeaders,
    additionalProperties: false,
    required: ["stored", "expiresAt"],
    properties: {
      stored: { type: "boolean" },
      expiresAt: dateTime
    }
  } as const;

  return {
    wellKnown: {
      operationId: "getForgeConnectivityDiscovery",
      tags: ["Discovery"],
      summary: "Discover the Forge connectivity service contract and limits.",
      response: {
        200: {
          type: "object",
          additionalProperties: false,
          required: [
            "protocol",
            "service",
            "version",
            "auth",
            "capabilities",
            "limits",
            "routes"
          ],
          properties: {
            protocol: { type: "string", const: "forge-connectivity/1" },
            service: { type: "string", const: "forge-connectivity-service" },
            version: { type: "string" },
            auth: {
              type: "object",
              additionalProperties: false,
              required: [
                "scheme",
                "algorithm",
                "channelDerivation",
                "replayProtection"
              ],
              properties: {
                scheme: { type: "string", const: "ForgeChannel" },
                algorithm: { type: "string", const: "Ed25519" },
                channelDerivation: { type: "string", const: "sha256-spki-v1" },
                replayProtection: {
                  type: "string",
                  const: "timestamp-nonce-v1"
                }
              }
            },
            capabilities: {
              type: "object",
              additionalProperties: false,
              required: [
                "presence",
                "envelopes",
                "keyPackages",
                "longPoll",
                "ciphertextOnly"
              ],
              properties: {
                presence: { type: "boolean", const: true },
                envelopes: { type: "boolean", const: true },
                keyPackages: { type: "boolean", const: true },
                longPoll: { type: "boolean", const: true },
                ciphertextOnly: { type: "boolean", const: true }
              }
            },
            limits: {
              type: "object",
              additionalProperties: false,
              required: [
                "maxEnvelopeBytes",
                "maxPresenceBytes",
                "maxKeyPackageBytes",
                "maxChannelEnvelopeCount",
                "maxChannelEnvelopeBytes",
                "maxChannelRetainedEnvelopeCount",
                "maxChannelKeyPackageCount",
                "maxChannelKeyPackageBytes",
                "channelRequestsPerMinute",
                "channelBurstRequests",
                "maxCursorPageSize",
                "maxLongPollSeconds",
                "maxEnvelopeTtlSeconds",
                "maxPresenceTtlSeconds",
                "maxKeyPackageTtlSeconds"
              ],
              properties: {
                maxEnvelopeBytes: { type: "integer" },
                maxPresenceBytes: { type: "integer" },
                maxKeyPackageBytes: { type: "integer" },
                maxChannelEnvelopeCount: { type: "integer" },
                maxChannelEnvelopeBytes: { type: "integer" },
                maxChannelRetainedEnvelopeCount: { type: "integer" },
                maxChannelKeyPackageCount: { type: "integer" },
                maxChannelKeyPackageBytes: { type: "integer" },
                channelRequestsPerMinute: { type: "integer" },
                channelBurstRequests: { type: "integer" },
                maxCursorPageSize: { type: "integer" },
                maxLongPollSeconds: { type: "integer" },
                maxEnvelopeTtlSeconds: { type: "integer" },
                maxPresenceTtlSeconds: { type: "integer" },
                maxKeyPackageTtlSeconds: { type: "integer" }
              }
            },
            routes: {
              type: "object",
              additionalProperties: false,
              required: [
                "presence",
                "envelopes",
                "envelopeAck",
                "keyPackages",
                "health"
              ],
              properties: {
                presence: { type: "string" },
                envelopes: { type: "string" },
                envelopeAck: { type: "string" },
                keyPackages: { type: "string" },
                health: { type: "string" }
              }
            }
          }
        },
        default: errorResponse
      },
      querystring: emptyQuery
    },
    health: {
      operationId: "getHealth",
      tags: ["Operations"],
      summary:
        "Check process and SQLite readiness without exposing mailbox metrics.",
      querystring: emptyQuery,
      response: {
        200: healthResponseSchema(),
        503: healthResponseSchema(),
        default: errorResponse
      }
    },
    putPresence: withSecurity({
      operationId: "putPresence",
      tags: ["Presence"],
      summary: "Create or replace an encrypted presence descriptor.",
      params: opaqueChannelParams,
      headers: mutationHeaders,
      querystring: emptyQuery,
      body: ciphertextBody(
        config.limits.maxPresenceBytes,
        30,
        config.limits.maxPresenceTtlMs
      ),
      response: {
        200: mutationResponse,
        201: mutationResponse,
        default: errorResponse
      }
    }),
    getPresence: withSecurity({
      operationId: "getPresence",
      tags: ["Presence"],
      summary: "Fetch the active encrypted presence descriptor.",
      params: opaqueChannelParams,
      headers: protectedHeaders,
      querystring: emptyQuery,
      response: {
        200: ciphertextRecordResponse(
          "updatedAt",
          config.limits.maxPresenceBytes
        ),
        404: errorResponse,
        default: errorResponse
      }
    }),
    deletePresence: withSecurity({
      operationId: "deletePresence",
      tags: ["Presence"],
      summary: "Delete the encrypted presence descriptor.",
      params: opaqueChannelParams,
      headers: mutationHeaders,
      querystring: emptyQuery,
      response: {
        200: {
          type: "object",
          headers: idempotencyResponseHeaders,
          additionalProperties: false,
          required: ["deleted"],
          properties: { deleted: { type: "boolean" } }
        },
        default: errorResponse
      }
    }),
    postEnvelope: withSecurity({
      operationId: "postEnvelope",
      tags: ["Envelopes"],
      summary: "Store one bounded opaque encrypted envelope.",
      params: opaqueChannelParams,
      headers: mutationHeaders,
      querystring: emptyQuery,
      body: {
        type: "object",
        additionalProperties: false,
        required: ["messageId", "ciphertext"],
        properties: {
          messageId: { type: "string", pattern: OPAQUE_ID_PATTERN },
          ciphertext: ciphertext(config.limits.maxEnvelopeBytes),
          expiresInSeconds: ttl(60, config.limits.maxEnvelopeTtlMs)
        }
      },
      response: {
        200: envelopeMutationResponse(),
        202: envelopeMutationResponse(),
        default: errorResponse
      }
    }),
    getEnvelopes: withSecurity({
      operationId: "getEnvelopes",
      tags: ["Envelopes"],
      summary:
        "Read a cursor page, optionally waiting for a new encrypted envelope.",
      params: opaqueChannelParams,
      headers: protectedHeaders,
      querystring: {
        ...pageQuery,
        properties: {
          ...pageQuery.properties,
          waitSeconds: {
            type: "integer",
            minimum: 0,
            maximum: Math.floor(config.polling.maxWaitMs / 1_000),
            default: 0
          }
        }
      },
      response: {
        200: {
          type: "object",
          additionalProperties: false,
          required: ["envelopes", "nextCursor", "pollTimedOut"],
          properties: {
            envelopes: {
              type: "array",
              maxItems: config.polling.maxPageSize,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["messageId", "ciphertext", "createdAt", "expiresAt"],
                properties: {
                  messageId: { type: "string", pattern: OPAQUE_ID_PATTERN },
                  ciphertext: ciphertext(config.limits.maxEnvelopeBytes),
                  createdAt: dateTime,
                  expiresAt: dateTime
                }
              }
            },
            nextCursor: cursor,
            pollTimedOut: { type: "boolean" }
          }
        },
        default: errorResponse
      }
    }),
    ackEnvelopes: withSecurity({
      operationId: "ackEnvelopes",
      tags: ["Envelopes"],
      summary:
        "Acknowledge encrypted envelopes and erase their ciphertext bytes.",
      params: opaqueChannelParams,
      headers: mutationHeaders,
      querystring: emptyQuery,
      body: {
        type: "object",
        additionalProperties: false,
        required: ["messageIds"],
        properties: {
          messageIds: {
            type: "array",
            minItems: 1,
            maxItems: 100,
            uniqueItems: true,
            items: { type: "string", pattern: OPAQUE_ID_PATTERN }
          }
        }
      },
      response: {
        200: {
          type: "object",
          headers: idempotencyResponseHeaders,
          additionalProperties: false,
          required: ["acknowledged", "alreadyFinalized", "unknown"],
          properties: {
            acknowledged: { type: "integer", minimum: 0 },
            alreadyFinalized: { type: "integer", minimum: 0 },
            unknown: { type: "integer", minimum: 0 }
          }
        },
        default: errorResponse
      }
    }),
    putKeyPackage: withSecurity({
      operationId: "putKeyPackage",
      tags: ["Key packages"],
      summary: "Store one bounded opaque encrypted key package.",
      params: opaqueChannelParams,
      headers: mutationHeaders,
      querystring: emptyQuery,
      body: {
        type: "object",
        additionalProperties: false,
        required: ["packageId", "ciphertext"],
        properties: {
          packageId: { type: "string", pattern: OPAQUE_ID_PATTERN },
          ciphertext: ciphertext(config.limits.maxKeyPackageBytes),
          expiresInSeconds: ttl(60, config.limits.maxKeyPackageTtlMs)
        }
      },
      response: {
        200: keyPackageMutationResponse(),
        201: keyPackageMutationResponse(),
        default: errorResponse
      }
    }),
    getKeyPackages: withSecurity({
      operationId: "getKeyPackages",
      tags: ["Key packages"],
      summary: "Read a bounded cursor page of active encrypted key packages.",
      params: opaqueChannelParams,
      headers: protectedHeaders,
      querystring: pageQuery,
      response: {
        200: {
          type: "object",
          additionalProperties: false,
          required: ["keyPackages", "nextCursor"],
          properties: {
            keyPackages: {
              type: "array",
              maxItems: config.polling.maxPageSize,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["packageId", "ciphertext", "createdAt", "expiresAt"],
                properties: {
                  packageId: { type: "string", pattern: OPAQUE_ID_PATTERN },
                  ciphertext: ciphertext(config.limits.maxKeyPackageBytes),
                  createdAt: dateTime,
                  expiresAt: dateTime
                }
              }
            },
            nextCursor: cursor
          }
        },
        default: errorResponse
      }
    })
  };
}

function withSecurity(schema: FastifySchema): FastifySchema {
  return { ...schema, security } as FastifySchema;
}

function ciphertext(maximumBytes: number): Record<string, unknown> {
  return {
    type: "string",
    minLength: 43,
    maxLength: Math.ceil((maximumBytes * 4) / 3),
    pattern: "^[A-Za-z0-9_-]+$",
    description:
      "Unpadded base64url end-to-end ciphertext. The service does not decrypt or inspect it."
  };
}

function ciphertextBody(
  maximumBytes: number,
  minimumTtlSeconds: number,
  maximumTtlMs: number
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["ciphertext"],
    properties: {
      ciphertext: ciphertext(maximumBytes),
      expiresInSeconds: ttl(minimumTtlSeconds, maximumTtlMs)
    }
  };
}

function ttl(
  minimumSeconds: number,
  maximumMs: number
): Record<string, unknown> {
  return {
    type: "integer",
    minimum: minimumSeconds,
    maximum: Math.floor(maximumMs / 1_000)
  };
}

function ciphertextRecordResponse(
  timestampField: "updatedAt",
  maximumBytes: number
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["ciphertext", timestampField, "expiresAt"],
    properties: {
      ciphertext: ciphertext(maximumBytes),
      [timestampField]: dateTime,
      expiresAt: dateTime
    }
  };
}

function envelopeMutationResponse(): Record<string, unknown> {
  return {
    type: "object",
    headers: idempotencyResponseHeaders,
    additionalProperties: false,
    required: ["accepted", "duplicate", "messageId", "state", "expiresAt"],
    properties: {
      accepted: { type: "boolean" },
      duplicate: { type: "boolean" },
      messageId: { type: "string", pattern: OPAQUE_ID_PATTERN },
      state: { type: "string", enum: ["pending", "acked", "expired"] },
      expiresAt: dateTime
    }
  };
}

function keyPackageMutationResponse(): Record<string, unknown> {
  return {
    type: "object",
    headers: idempotencyResponseHeaders,
    additionalProperties: false,
    required: ["stored", "duplicate", "packageId", "expiresAt"],
    properties: {
      stored: { type: "boolean" },
      duplicate: { type: "boolean" },
      packageId: { type: "string", pattern: OPAQUE_ID_PATTERN },
      expiresAt: dateTime
    }
  };
}

function healthResponseSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["status", "service", "version", "storage"],
    properties: {
      status: { type: "string", enum: ["ok", "degraded"] },
      service: { type: "string", const: "forge-connectivity-service" },
      version: { type: "string" },
      storage: {
        type: "object",
        additionalProperties: false,
        required: ["status", "schemaVersion"],
        properties: {
          status: { type: "string", enum: ["ok", "unavailable"] },
          schemaVersion: { type: "integer", minimum: 0 }
        }
      }
    }
  };
}
