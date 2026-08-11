const jsonContent = (schema: Record<string, unknown>) => ({
  "application/json": { schema }
});

const errorResponse = {
  description: "Forge pairing error response",
  content: jsonContent({ $ref: "#/components/schemas/ErrorResponse" })
};

const requestIdParameter = {
  name: "requestId",
  in: "path",
  required: true,
  schema: {
    type: "string",
    pattern: "^pair_[A-Za-z0-9-]{16,160}$"
  }
};

const pairingReviewSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "requestId",
    "clientName",
    "clientType",
    "audience",
    "requestedScopes",
    "requestedProfile",
    "expiresAt",
    "installationFingerprint",
    "endpoint",
    "boundaries",
    "status",
    "approvedAt",
    "clientId"
  ],
  properties: {
    requestId: { type: "string" },
    clientName: { type: "string" },
    clientType: { type: "string", enum: ["api", "browser"] },
    audience: { type: "string" },
    requestedScopes: {
      type: "array",
      items: { type: "string" },
      maxItems: 32
    },
    requestedProfile: {
      type: "string",
      enum: [
        "viewer",
        "trusted_personal_assistant",
        "executor",
        "operator",
        "custom"
      ]
    },
    expiresAt: { type: "string", format: "date-time" },
    installationFingerprint: { type: "string" },
    endpoint: {
      type: "object",
      additionalProperties: false,
      required: ["origin", "fingerprint"],
      properties: {
        origin: { type: ["string", "null"] },
        fingerprint: { type: "string" }
      }
    },
    boundaries: {
      type: "object",
      additionalProperties: true,
      description:
        "The exact resource and network-egress boundary shown to the owner before approval."
    },
    status: { type: "string", enum: ["pending", "approved"] },
    approvedAt: { type: ["string", "null"], format: "date-time" },
    clientId: { type: ["string", "null"] }
  }
};

const masterPasswordStatusSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "configured",
    "configuredAt",
    "updatedAt",
    "minimumLength",
    "maximumLength"
  ],
  properties: {
    configured: { type: "boolean" },
    configuredAt: { type: ["string", "null"], format: "date-time" },
    updatedAt: { type: ["string", "null"], format: "date-time" },
    minimumLength: { type: "integer", enum: [15] },
    maximumLength: { type: "integer", enum: [128] }
  }
};

export function buildSecurityPairingOpenApiPaths(): Record<string, unknown> {
  return {
    "/api/v1/auth/master-password": {
      get: {
        summary: "Read optional master-password pairing status",
        description:
          "Direct-loopback local-owner operation. Returns only whether the optional password is configured and its public length policy; it never returns verifier material.",
        security: [{ operatorSession: [] }],
        responses: {
          "200": {
            description: "Master-password pairing status",
            content: jsonContent(masterPasswordStatusSchema)
          },
          "401": errorResponse,
          "403": errorResponse
        }
      },
      put: {
        summary: "Set or replace the optional remote-pairing master password",
        description:
          "Direct-loopback local-owner operation. No password exists by default. Forge requires at least 15 characters, rejects common and context-derived values, and stores only a peppered Argon2id verifier. Replacing an existing password requires the current password.",
        security: [{ operatorSession: [] }],
        requestBody: {
          required: true,
          content: jsonContent({
            type: "object",
            additionalProperties: false,
            required: ["password", "confirmation"],
            properties: {
              password: {
                type: "string",
                minLength: 15,
                maxLength: 128,
                writeOnly: true
              },
              confirmation: {
                type: "string",
                minLength: 15,
                maxLength: 128,
                writeOnly: true
              },
              currentPassword: {
                type: "string",
                minLength: 1,
                maxLength: 128,
                writeOnly: true
              }
            }
          })
        },
        responses: {
          "200": {
            description: "Master password configured",
            content: jsonContent(masterPasswordStatusSchema)
          },
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse
        }
      }
    },
    "/api/v1/auth/device/master-password/approve": {
      post: {
        summary:
          "Approve one sender-bound remote browser with the master password",
        description:
          "Optional HTTPS-only bounded pairing protocol. The master password can approve only a browser viewer or trusted-personal-assistant request limited to read/write scopes. The request id, short code, and one-use P-256 client proof must all match. Attempts are rate-limited, and the resulting browser credential remains scoped, sender-bound, and revocable.",
        security: [],
        requestBody: {
          required: true,
          content: jsonContent({
            type: "object",
            additionalProperties: false,
            required: ["requestId", "userCode", "password", "clientProof"],
            properties: {
              requestId: {
                type: "string",
                pattern: "^pair_[A-Za-z0-9-]{16,160}$"
              },
              userCode: { type: "string", minLength: 8, maxLength: 64 },
              password: {
                type: "string",
                minLength: 1,
                maxLength: 128,
                writeOnly: true
              },
              clientProof: {
                type: "string",
                minLength: 64,
                maxLength: 8192,
                writeOnly: true
              }
            }
          })
        },
        responses: {
          "200": { description: "Browser pairing request approved" },
          "401": errorResponse,
          "403": errorResponse,
          "409": errorResponse,
          "429": errorResponse
        }
      }
    },
    "/api/v1/auth/device/requests": {
      get: {
        summary: "List active pairing requests for the local owner",
        description:
          "Returns a bounded current-owner review projection without device codes, user codes, proof material, or credentials. A paired remote browser cannot use this operation.",
        security: [{ operatorSession: [] }],
        responses: {
          "200": {
            description: "Pending and newly approved pairing requests",
            content: jsonContent({
              type: "object",
              additionalProperties: false,
              required: ["requests"],
              properties: {
                requests: {
                  type: "array",
                  maxItems: 25,
                  items: pairingReviewSchema
                }
              }
            })
          },
          "401": errorResponse,
          "403": errorResponse
        }
      }
    },
    "/api/v1/auth/device/requests/{requestId}/approve": {
      post: {
        summary: "Approve one exact pairing request",
        description:
          "Requires the verified local-owner browser session and the short code for this exact request. Elevated grants additionally require the existing passkey step-up route.",
        security: [{ operatorSession: [] }],
        parameters: [requestIdParameter],
        requestBody: {
          required: true,
          content: jsonContent({
            type: "object",
            additionalProperties: false,
            required: ["userCode"],
            properties: {
              userCode: {
                type: "string",
                minLength: 8,
                maxLength: 64,
                writeOnly: true
              }
            }
          })
        },
        responses: {
          "200": {
            description:
              "Approved request and the real registered client waiting for the requesting device",
            content: jsonContent({
              type: "object",
              additionalProperties: false,
              required: [
                "requestId",
                "clientId",
                "clientName",
                "audience",
                "scopes",
                "profile"
              ],
              properties: {
                requestId: { type: "string" },
                clientId: { type: "string" },
                clientName: { type: "string" },
                audience: { type: "string" },
                scopes: {
                  type: "array",
                  items: { type: "string" },
                  maxItems: 33
                },
                profile: {
                  type: "string",
                  enum: [
                    "viewer",
                    "trusted_personal_assistant",
                    "executor",
                    "operator",
                    "custom"
                  ]
                }
              }
            })
          },
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
          "409": errorResponse,
          "429": errorResponse
        }
      }
    },
    "/api/v1/auth/device/requests/{requestId}/deny": {
      post: {
        summary: "Deny one exact pairing request",
        description:
          "Requires the verified local-owner browser session. The exact listed request identifier is sufficient because denial cannot create authority.",
        security: [{ operatorSession: [] }],
        parameters: [requestIdParameter],
        requestBody: {
          required: false,
          content: jsonContent({
            type: "object",
            additionalProperties: false,
            maxProperties: 0
          })
        },
        responses: {
          "200": {
            description: "Pairing request denied",
            content: jsonContent({
              type: "object",
              additionalProperties: false,
              required: ["denied"],
              properties: { denied: { type: "boolean", enum: [true] } }
            })
          },
          "401": errorResponse,
          "404": errorResponse
        }
      }
    }
  };
}
