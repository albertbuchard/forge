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

const trustedBrowserCredentialSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "label",
    "clientId",
    "clientName",
    "profile",
    "scopes",
    "selectedUserIds",
    "origin",
    "relyingPartyId",
    "deviceType",
    "backedUp",
    "createdAt",
    "lastUsedAt",
    "revokedAt",
    "revocationReason"
  ],
  properties: {
    id: { type: "string", pattern: "^tbr_[A-Za-z0-9]{16,160}$" },
    label: { type: "string", maxLength: 120 },
    clientId: { type: "string" },
    clientName: { type: "string" },
    profile: {
      type: "string",
      enum: ["viewer", "trusted_personal_assistant", "executor", "custom"]
    },
    scopes: { type: "array", items: { type: "string" }, maxItems: 32 },
    selectedUserIds: {
      type: "array",
      items: { type: "string" },
      maxItems: 64
    },
    origin: { type: "string", format: "uri" },
    relyingPartyId: { type: "string" },
    deviceType: { type: "string", enum: ["singleDevice", "multiDevice"] },
    backedUp: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    lastUsedAt: { type: ["string", "null"], format: "date-time" },
    revokedAt: { type: ["string", "null"], format: "date-time" },
    revocationReason: { type: ["string", "null"] }
  }
};

const webAuthnCeremonySchema = {
  type: "object",
  additionalProperties: false,
  required: ["challengeId", "options"],
  properties: {
    challengeId: {
      type: "string",
      pattern: "^tbc_[A-Za-z0-9]{16,160}$"
    },
    options: {
      type: "object",
      additionalProperties: true,
      description:
        "WebAuthn PublicKeyCredential options. Authentication uses discoverable credentials and therefore returns an empty allowCredentials array."
    }
  }
};

export function buildSecurityPairingOpenApiPaths(): Record<string, unknown> {
  return {
    "/api/v1/auth/trusted-browser/authentication/options": {
      post: {
        summary: "Begin trusted-device browser restoration",
        description:
          "Public, origin-bound WebAuthn start operation. It returns discoverable-credential options without credential identifiers, client identifiers, profile names, or scopes. Challenges are hashed, bounded, expire after two minutes, and can be consumed once.",
        security: [],
        requestBody: {
          required: true,
          content: jsonContent({
            type: "object",
            additionalProperties: false
          })
        },
        responses: {
          "200": {
            description: "Non-enumerating trusted-device challenge",
            content: jsonContent(webAuthnCeremonySchema)
          },
          "400": errorResponse,
          "403": errorResponse
        }
      }
    },
    "/api/v1/auth/trusted-browser/authentication/verify": {
      post: {
        summary: "Restore an exact paired-browser grant with WebAuthn",
        description:
          "Verifies user presence and user verification, the exact origin and relying party, the credential counter, installation and data-root identity, owner and client epochs, client key, profile, scopes, and active pairing lifecycle. Success creates the ordinary paired-client browser session and refresh family; it can never create an operator session.",
        security: [],
        requestBody: {
          required: true,
          content: jsonContent({
            type: "object",
            additionalProperties: false,
            required: ["challengeId", "response"],
            properties: {
              challengeId: {
                type: "string",
                pattern: "^tbc_[A-Za-z0-9]{16,160}$"
              },
              response: { type: "object", additionalProperties: true }
            }
          })
        },
        responses: {
          "200": { description: "Paired-browser session restored" },
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse
        }
      }
    },
    "/api/v1/auth/trusted-browser/registration/options": {
      post: {
        summary: "Begin explicit trusted-device registration",
        description:
          "Requires a current paired-browser session, or a direct-loopback operator session selecting an active browser client. A paired browser may register only its own exact authority. Registration requires a discoverable credential and user verification.",
        security: [{ browserSession: [] }],
        requestBody: {
          required: true,
          content: jsonContent({
            type: "object",
            additionalProperties: false,
            properties: {
              clientId: { type: "string" },
              label: { type: "string", minLength: 1, maxLength: 120 }
            }
          })
        },
        responses: {
          "200": {
            description: "Trusted-device registration challenge",
            content: jsonContent(webAuthnCeremonySchema)
          },
          "401": errorResponse,
          "403": errorResponse
        }
      }
    },
    "/api/v1/auth/trusted-browser/registration/verify": {
      post: {
        summary: "Bind a verified passkey to one paired-browser authority",
        security: [{ browserSession: [] }],
        requestBody: {
          required: true,
          content: jsonContent({
            type: "object",
            additionalProperties: false,
            required: ["challengeId", "response"],
            properties: {
              clientId: { type: "string" },
              challengeId: { type: "string" },
              response: { type: "object", additionalProperties: true }
            }
          })
        },
        responses: {
          "200": {
            description: "Trusted-device credential bound",
            content: jsonContent({
              type: "object",
              additionalProperties: false,
              required: ["credential"],
              properties: { credential: trustedBrowserCredentialSchema }
            })
          },
          "401": errorResponse,
          "403": errorResponse
        }
      }
    },
    "/api/v1/auth/trusted-browser/status": {
      post: {
        summary: "Read trusted-device status for the current browser session",
        description:
          "Returns only active trusted-device credentials bound to the current paired-browser client and relying party. It does not expose credentials belonging to another client and does not grant or restore authority.",
        security: [{ browserSession: [] }],
        requestBody: {
          required: true,
          content: jsonContent({
            type: "object",
            additionalProperties: false
          })
        },
        responses: {
          "200": {
            description: "Current paired-browser trusted-device status",
            content: jsonContent({
              type: "object",
              additionalProperties: false,
              required: ["available", "credentials"],
              properties: {
                available: { type: "boolean" },
                credentials: {
                  type: "array",
                  maxItems: 16,
                  items: trustedBrowserCredentialSchema
                }
              }
            })
          },
          "401": errorResponse,
          "403": errorResponse
        }
      }
    },
    "/api/v1/auth/trusted-browser/credentials": {
      get: {
        summary: "List current and revoked trusted-device credentials",
        description:
          "Owner-only bounded management projection. It never returns credential public keys, counters, raw challenges, challenge hashes, or cookie material.",
        security: [{ operatorSession: [] }],
        responses: {
          "200": {
            description: "Trusted-device credential summaries",
            content: jsonContent({
              type: "object",
              additionalProperties: false,
              required: ["credentials"],
              properties: {
                credentials: {
                  type: "array",
                  maxItems: 64,
                  items: trustedBrowserCredentialSchema
                }
              }
            })
          },
          "401": errorResponse,
          "403": errorResponse
        }
      }
    },
    "/api/v1/auth/trusted-browser/credentials/{id}/revoke": {
      post: {
        summary: "Revoke one trusted-device credential",
        security: [{ operatorSession: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: {
              type: "string",
              pattern: "^tbr_[A-Za-z0-9]{16,160}$"
            }
          }
        ],
        responses: {
          "200": { description: "Trusted-device credential revoked" },
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse
        }
      }
    },
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
