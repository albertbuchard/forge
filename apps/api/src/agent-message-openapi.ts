const jsonContent = (schema: Record<string, unknown>) => ({
  "application/json": { schema }
});

const response = (description: string, schema: Record<string, unknown> = {
  type: "object",
  additionalProperties: true
}) => ({ description, content: jsonContent(schema) });

const body = (schema: Record<string, unknown>) => ({
  required: true,
  content: jsonContent(schema)
});

const idParameter = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", minLength: 1, maxLength: 200 }
};

const operationKey = {
  type: "string",
  minLength: 8,
  maxLength: 200,
  pattern: "^[A-Za-z0-9._:-]+$"
};

const leaseFields = {
  operationKey,
  leaseSecret: {
    type: "string",
    minLength: 43,
    maxLength: 128,
    description: "Caller-generated base64url cryptographically random lease secret."
  },
  claimGeneration: { type: "integer", minimum: 1 }
};

const messageSchema = {
  type: "object",
  additionalProperties: true,
  required: [
    "id",
    "ownerUserId",
    "sender",
    "initialRecipient",
    "recipient",
    "bodyText",
    "voiceArtifact",
    "status",
    "revision",
    "retentionUntil",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string" },
    ownerUserId: { type: "string" },
    sender: { type: "object", additionalProperties: true },
    initialRecipient: { type: "object", additionalProperties: true },
    recipient: { type: "object", additionalProperties: true },
    bodyText: { type: "string", maxLength: 50_000 },
    voiceArtifact: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          required: ["id", "mimeType", "byteSize", "verifiedDurationMs", "sensitivity"],
          properties: {
            id: { type: "string" },
            mimeType: { type: "string" },
            byteSize: { type: "integer", minimum: 1, maximum: 26_214_400 },
            declaredDurationMs: { type: ["integer", "null"], minimum: 0 },
            verifiedDurationMs: {
              type: ["integer", "null"],
              minimum: 1,
              maximum: 600_000
            },
            sensitivity: { type: "string", const: "sensitive_media" }
          }
        }
      ]
    },
    status: {
      type: "string",
      enum: [
        "delivered",
        "claimed",
        "in_progress",
        "acknowledged",
        "handled",
        "failed",
        "forwarded"
      ]
    },
    revision: { type: "integer", minimum: 1 },
    unreadInboxEventSequence: { type: ["integer", "null"], minimum: 1 },
    retentionUntil: { type: "string", format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" }
  }
};

const ownerSecurity = [{ operatorSession: [] }];
const agentSecurity = [{ bearerAuth: [] }];

function ownerPaths(prefix: string, mobile: boolean) {
  const security = mobile ? undefined : ownerSecurity;
  const protocolDescription = mobile
    ? "Requires a signed, replay-protected verified Forge companion request. The owner is derived from the pairing and cannot be supplied by the phone. "
    : "Requires the authenticated Forge owner. ";
  return {
    [`${prefix}/agents`]: {
      get: {
        tags: ["Agent Messages"],
        summary: "List agents available for Agent Messages routing",
        description: `${protocolDescription}Connected is a fresh runtime observation, not a guarantee of immediate handling.`,
        security,
        responses: { "200": response("Owner-linked agents") }
      }
    },
    [`${prefix}/settings`]: {
      get: {
        tags: ["Agent Messages"],
        summary: "Read the default Agent Messages recipient and media policy",
        description: protocolDescription,
        security,
        responses: { "200": response("Agent Messages settings") }
      },
      patch: {
        tags: ["Agent Messages"],
        summary: "Select the default agent for future messages",
        description: `${protocolDescription}This never reroutes existing mail and writes the general audit log.`,
        security,
        requestBody: body({
          type: "object",
          additionalProperties: false,
          required: ["defaultAgentId"],
          properties: { defaultAgentId: { type: "string" } }
        }),
        responses: { "200": response("Updated settings") }
      }
    },
    [prefix]: {
      get: {
        tags: ["Agent Messages"],
        summary: "List the Agent Messages inbox or outbox",
        description: `${protocolDescription}Outbox contains owner-authored threads. Inbox contains distinct threads whose latest agent-authored progress, acknowledgement, handled, failed, or forwarded event is newer than the owner read cursor. Claim and lease events never create unread state.`,
        security,
        parameters: [
          {
            name: "box",
            in: "query",
            schema: { type: "string", enum: ["inbox", "outbox"], default: "outbox" }
          },
          { name: "status", in: "query", schema: messageSchema.properties.status },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 30 } },
          { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } }
        ],
        responses: { "200": response("Bounded inbox or outbox page") }
      },
      post: {
        tags: ["Agent Messages"],
        summary: "Send text, verified reserved voice, or both to an agent",
        description: `${protocolDescription}Creation atomically consumes an active owner-scoped voice reservation. Exact idempotency replay returns the original message; changed reuse is 409.`,
        security,
        requestBody: body({
          type: "object",
          additionalProperties: false,
          required: ["idempotencyKey"],
          properties: {
            idempotencyKey: operationKey,
            recipientAgentId: { type: "string" },
            bodyText: { type: "string", maxLength: 50_000 },
            voiceReservationId: { type: "string" },
            retentionDays: { type: "integer", minimum: 1, maximum: 3650, default: 365 }
          },
          anyOf: [
            { required: ["bodyText"] },
            { required: ["voiceReservationId"] }
          ]
        }),
        responses: {
          "200": response("Exact replay", { type: "object", properties: { message: messageSchema } }),
          "201": response("Created message", { type: "object", properties: { message: messageSchema } }),
          "409": response("Changed idempotency key or unavailable reservation")
        }
      }
    },
    [`${prefix}/{id}`]: {
      get: {
        tags: ["Agent Messages"],
        summary: "Read one message, immutable events, and forward/retry provenance",
        description: protocolDescription,
        security,
        parameters: [idParameter],
        responses: { "200": response("Message detail") }
      },
      delete: {
        tags: ["Agent Messages"],
        summary: "Soft-delete a message and revoke its live lease",
        description: `${protocolDescription}The original voice remains subject to reference-aware retention and crash-recoverable blob cleanup.`,
        security,
        parameters: [idParameter],
        requestBody: body({
          type: "object",
          additionalProperties: false,
          required: ["reason"],
          properties: { reason: { type: "string", minLength: 1, maxLength: 1000 } }
        }),
        responses: { "200": response("Soft deletion receipt") }
      }
    },
    [`${prefix}/{id}/read`]: {
      post: {
        tags: ["Agent Messages"],
        summary: "Advance the owner read cursor to an observed inbox-eligible event",
        description: `${protocolDescription}A concurrent newer eligible event remains unread. Lease events are excluded.`,
        security,
        parameters: [idParameter],
        requestBody: body({
          type: "object",
          additionalProperties: false,
          required: ["operationKey", "expectedInboxEventSequence"],
          properties: {
            operationKey,
            expectedInboxEventSequence: { type: "integer", minimum: 1 }
          }
        }),
        responses: { "200": response("Idempotent read-cursor receipt") }
      }
    },
    [`${prefix}/voice-reservations`]: {
      post: {
        tags: ["Agent Messages"],
        summary: "Reserve an idempotent sensitive voice upload",
        description: `${protocolDescription}An unconsumed reservation expires after 24 hours and is cleaned only after reference checks.`,
        security,
        requestBody: body({
          type: "object",
          additionalProperties: false,
          required: ["idempotencyKey", "originalFileName", "declaredMimeType", "declaredDurationMs"],
          properties: {
            idempotencyKey: operationKey,
            originalFileName: { type: "string", minLength: 1, maxLength: 180 },
            declaredMimeType: { type: "string" },
            declaredDurationMs: { type: "integer", minimum: 0, maximum: 600_000 }
          }
        }),
        responses: { "201": response("Pending voice reservation") }
      }
    },
    [`${prefix}/voice-reservations/{id}`]: {
      put: {
        tags: ["Agent Messages"],
        summary: "Upload and verify the original audio for a reservation",
        description: `${protocolDescription}The JSON body is bounded at 35 MiB; decoded media is bounded at 25 MiB and must pass signature, MIME/extension, container/codec, and verified duration at or below 600 seconds.`,
        security,
        parameters: [idParameter],
        requestBody: body({
          type: "object",
          additionalProperties: false,
          required: ["idempotencyKey", "contentBase64", "declaredMimeType", "declaredDurationMs"],
          properties: {
            idempotencyKey: operationKey,
            contentBase64: { type: "string", contentEncoding: "base64" },
            declaredMimeType: { type: "string" },
            declaredDurationMs: { type: "integer", minimum: 0, maximum: 600_000 }
          }
        }),
        responses: { "200": response("Active verified reservation") }
      }
    },
    [`${prefix}/{id}/reassign`]: {
      post: {
        tags: ["Agent Messages"],
        summary: "Reassign a nonterminal message, explicitly revoking a live lease when confirmed",
        description: `${protocolDescription}Requires expected revision, reason, and stable operation key. The old lease secret fails immediately.`,
        security,
        parameters: [idParameter],
        requestBody: body({
          type: "object",
          additionalProperties: false,
          required: ["operationKey", "expectedRevision", "recipientAgentId", "reason"],
          properties: {
            operationKey,
            expectedRevision: { type: "integer", minimum: 1 },
            recipientAgentId: { type: "string" },
            revokeActiveLease: { type: "boolean", default: false },
            reason: { type: "string", minLength: 1, maxLength: 1000 }
          }
        }),
        responses: { "200": response("Idempotent reassignment receipt") }
      }
    },
    [`${prefix}/{id}/retry`]: {
      post: {
        tags: ["Agent Messages"],
        summary: "Create an immutable delivered child from a failed message",
        description: protocolDescription,
        security,
        parameters: [idParameter],
        requestBody: body({
          type: "object",
          additionalProperties: false,
          required: ["operationKey"],
          properties: { operationKey, recipientAgentId: { type: "string" } }
        }),
        responses: { "201": response("Retry child receipt") }
      }
    }
  };
}

function leasedRequest(extra: Record<string, unknown> = {}) {
  return body({
    type: "object",
    additionalProperties: false,
    required: ["operationKey", "leaseSecret", "claimGeneration"],
    properties: { ...leaseFields, ...extra }
  });
}

function agentPaths() {
  const base = "/api/v1/agent-messages";
  return {
    [`${base}/poll`]: {
      get: {
        tags: ["Agent Messages"],
        summary: "Poll claim-eligible messages addressed to the authenticated agent",
        description: "Requires agentMessages.poll. Polling never claims and omits audio bytes.",
        security: agentSecurity,
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } }
        ],
        responses: { "200": response("Compact claim-eligible messages") }
      }
    },
    [`${base}/{id}/detail`]: {
      get: {
        tags: ["Agent Messages"],
        summary: "Read the addressed message and its immutable audit history",
        description: "Requires agentMessages.poll and exact recipient plus owner scope.",
        security: agentSecurity,
        parameters: [idParameter],
        responses: { "200": response("Message detail and ordered audit events") }
      }
    },
    [`${base}/{id}/claim`]: {
      post: {
        tags: ["Agent Messages"],
        summary: "Atomically claim a message with a retry-safe lease",
        description: "Requires agentMessages.claim. The caller supplies a random secret; Forge stores only its keyed digest and a durable exact-replay receipt.",
        security: agentSecurity,
        parameters: [idParameter],
        requestBody: body({
          type: "object",
          additionalProperties: false,
          required: ["operationKey", "leaseSecret"],
          properties: {
            operationKey,
            leaseSecret: leaseFields.leaseSecret,
            leaseSeconds: { type: "integer", minimum: 60, maximum: 900, default: 300 }
          }
        }),
        responses: { "200": response("Claim lease or exact replay"), "409": response("Live competing claim or changed replay") }
      }
    },
    [`${base}/{id}/lease`]: {
      post: {
        tags: ["Agent Messages"], summary: "Renew the authenticated claim lease",
        security: agentSecurity, parameters: [idParameter],
        requestBody: leasedRequest({ leaseSeconds: { type: "integer", minimum: 60, maximum: 900, default: 300 } }),
        responses: { "200": response("Renewal receipt") }
      }
    },
    [`${base}/{id}/progress`]: {
      post: {
        tags: ["Agent Messages"], summary: "Append user-visible agent progress",
        security: agentSecurity, parameters: [idParameter],
        requestBody: leasedRequest({ progressSummary: { type: "string", minLength: 1, maxLength: 10_000 } }),
        responses: { "200": response("Progress receipt") }
      }
    },
    [`${base}/{id}/acknowledge`]: {
      post: {
        tags: ["Agent Messages"], summary: "Acknowledge the message under its live lease",
        security: agentSecurity, parameters: [idParameter], requestBody: leasedRequest(),
        responses: { "200": response("Acknowledgement receipt") }
      }
    },
    [`${base}/{id}/handle`]: {
      post: {
        tags: ["Agent Messages"], summary: "Handle the message with an idempotent terminal receipt",
        description: "Requires agentMessages.complete. Transcript fields require explicit provider/cost/privacy disclosure and never replace the original Artifact.",
        security: agentSecurity, parameters: [idParameter],
        requestBody: leasedRequest({
          receiptKey: operationKey,
          resultMarkdown: { type: "string", maxLength: 100_000 },
          transcriptText: { type: "string", maxLength: 100_000 },
          transcriptProvider: { type: "string", maxLength: 200 },
          transcriptDisclosure: { type: "string", maxLength: 2000 }
        }),
        responses: { "200": response("Handled terminal receipt") }
      }
    },
    [`${base}/{id}/fail`]: {
      post: {
        tags: ["Agent Messages"], summary: "Fail the message with an idempotent terminal receipt",
        security: agentSecurity, parameters: [idParameter],
        requestBody: leasedRequest({
          receiptKey: operationKey,
          failureCode: { type: "string", minLength: 1, maxLength: 200 },
          failureMessage: { type: "string", minLength: 1, maxLength: 4000 }
        }),
        responses: { "200": response("Failed terminal receipt") }
      }
    },
    [`${base}/{id}/forward`]: {
      post: {
        tags: ["Agent Messages"], summary: "Forward to another owner-linked agent as an immutable child",
        security: agentSecurity, parameters: [idParameter],
        requestBody: leasedRequest({
          receiptKey: operationKey,
          recipientAgentId: { type: "string" },
          progressSummary: { type: "string", maxLength: 10_000 }
        }),
        responses: { "200": response("Forward terminal and child receipt") }
      }
    },
    [`${base}/{id}/voice`]: {
      post: {
        tags: ["Agent Messages"], summary: "Read only this leased message's verified original voice Artifact",
        description: "Requires agentMessages.voice.read and exact recipient, claimant, owner scope, secret, generation, nonterminal state, retention, sensitivity, and Artifact integrity. This is not generic Artifact download.",
        security: agentSecurity, parameters: [idParameter],
        requestBody: body({
          type: "object", additionalProperties: false,
          required: ["leaseSecret", "claimGeneration"],
          properties: { leaseSecret: leaseFields.leaseSecret, claimGeneration: leaseFields.claimGeneration }
        }),
        responses: {
          "200": {
            description: "Exact original voice bytes. Hash and Artifact id are returned in response headers.",
            headers: {
              "X-Forge-Artifact-Id": { schema: { type: "string" } },
              "X-Forge-Content-Sha256": { schema: { type: "string", pattern: "^[a-f0-9]{64}$" } }
            },
            content: {
              "audio/mp4": { schema: { type: "string", format: "binary" } },
              "audio/aac": { schema: { type: "string", format: "binary" } },
              "audio/mpeg": { schema: { type: "string", format: "binary" } },
              "audio/wav": { schema: { type: "string", format: "binary" } },
              "audio/webm": { schema: { type: "string", format: "binary" } },
              "audio/ogg": { schema: { type: "string", format: "binary" } }
            }
          }
        }
      }
    }
  };
}

export function buildAgentMessageOpenApiPaths() {
  return {
    ...ownerPaths("/api/v1/agent-messages", false),
    ...ownerPaths("/api/v1/mobile/agent-messages", true),
    ...agentPaths()
  };
}
