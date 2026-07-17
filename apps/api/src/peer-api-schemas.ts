import { z } from "zod";
import {
  personActorBindingKindSchema,
  personAliasKindSchema,
  personBirthdayPrecisionSchema,
  personContactKindSchema,
  personContactVisibilitySchema,
  personFactSensitivitySchema,
  personFactSourceKindSchema,
  personLinkSchema,
  personSchema,
  wikiPersonAssociationApplyResultSchema,
  wikiPersonCandidateSchema
} from "./people-types.js";
import { PEER_ROUTE_CONTRACTS } from "./peer-route-contract.js";
import {
  PEER_PROTOCOL_VERSION,
  peerCachePolicySchema,
  peerDeviceStatusSchema,
  peerGrantSignatureSchema,
  peerGrantStatusSchema,
  peerPairingInviteSchema,
  peerPrincipalClassSchema,
  peerProjectionIdSchema,
  peerProjectionResponseMetadataSchema,
  peerRelationshipStatusSchema,
  peerShareDirectionSchema,
  peerShareGrantVersionSchema,
  peerShareRuleSchema,
  peerTransportKindSchema,
  peerTransportPrivacyModeSchema
} from "./peer-sharing-types.js";
import { peerPresenceActionSchema } from "./services/peer-human-presence.js";
import {
  PEER_COMPANION_AUTHORIZED_OPERATION_IDS,
  PEER_COMPANION_CAPABILITIES,
  PEER_COMPANION_CONSENT_PROTOCOL,
  PEER_COMPANION_ENROLLMENT_PROTOCOL,
  PEER_COMPANION_REQUEST_PROTOCOL,
  PEER_COMPANION_SCOPES,
  peerCompanionDeviceIdentitySchema
} from "./services/peer-companion-contract.js";
import {
  peerCompanionEnrollmentOptionsInputSchema,
  peerCompanionEnrollmentVerifyInputSchema
} from "./services/peer-companion-enrollment.js";
import { peerProjectionOutputSchemas } from "./services/peer-projections.js";
import { peerTypedQuestionSchema } from "./services/peer-typed-query.js";

export { peerTypedQuestionSchema } from "./services/peer-typed-query.js";

export const peerApiIdSchema = z.string().trim().min(1).max(240);
export const peerApiVersionSchema = z.string().trim().min(1).max(240);
export const peerApiCursorSchema = z
  .string()
  .min(8)
  .max(2_048)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
export const peerApiIdempotencyKeySchema = z
  .string()
  .trim()
  .min(16)
  .max(240)
  .regex(/^[A-Za-z0-9._:-]+$/);
export const peerApiHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const emptySchema = z.object({}).strict();
const queryBooleanSchema = z.preprocess((value) => {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return value;
}, z.boolean());
const ianaTimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "A valid IANA time zone is required.");
const singleIdParamsSchema = (name: string) =>
  z.object({ [name]: peerApiIdSchema }).strict();
const relationshipParamsSchema = singleIdParamsSchema("relationshipId");
const personParamsSchema = singleIdParamsSchema("personId");
const grantParamsSchema = singleIdParamsSchema("grantId");
const requestParamsSchema = singleIdParamsSchema("requestId");
const invitationParamsSchema = singleIdParamsSchema("invitationId");
const pairingParamsSchema = singleIdParamsSchema("pairingId");
const credentialParamsSchema = singleIdParamsSchema("credentialId");
const relationshipDeviceParamsSchema = z
  .object({
    relationshipId: peerApiIdSchema,
    deviceId: peerApiIdSchema
  })
  .strict();

export const listPeopleQuerySchema = z
  .object({
    userId: peerApiIdSchema.optional(),
    query: z.string().trim().max(200).optional(),
    relationshipStatus: z
      .enum(["none", "pending", "active", "paused", "revoked"])
      .optional(),
    source: z.enum(["local", "shared", "both"]).default("both"),
    hasUpcomingSharedContext: queryBooleanSchema.optional(),
    sort: z
      .enum(["display_name", "updated_at", "next_shared_event"])
      .default("display_name"),
    direction: z.enum(["asc", "desc"]).default("asc"),
    cursor: peerApiCursorSchema
      .describe(
        "Opaque continuation bound to the owner, filters, sort order, and owner-scoped People read-model revision. A stale continuation fails with HTTP 409 and restartRequired=true; restart from the first page."
      )
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
  })
  .strict();

export const personContextQuerySchema = z
  .object({
    includePrivate: queryBooleanSchema.default(false),
    includeShared: queryBooleanSchema.default(true),
    linkLimit: z.coerce.number().int().min(1).max(200).default(100),
    projectionLimit: z.coerce.number().int().min(1).max(100).default(40)
  })
  .strict();

export const peopleWikiCandidateScanSchema = z
  .object({
    userId: peerApiIdSchema.optional(),
    peopleRootPageId: peerApiIdSchema,
    query: z.string().trim().max(200).optional(),
    cursor: peerApiCursorSchema.optional(),
    limit: z.number().int().min(1).max(100).default(50)
  })
  .strict();

export const wikiAssociationDecisionSchema = z.discriminatedUnion("action", [
  z
    .object({
      wikiPageId: peerApiIdSchema,
      action: z.literal("associate"),
      personId: peerApiIdSchema,
      expectedWikiVersion: peerApiVersionSchema,
      expectedPersonVersion: peerApiVersionSchema
    })
    .strict(),
  z
    .object({
      wikiPageId: peerApiIdSchema,
      action: z.literal("create_person"),
      displayName: z.string().trim().min(1).max(160),
      preferredName: z.string().trim().max(160).optional(),
      relationshipCategory: z
        .enum([
          "family",
          "friend",
          "partner",
          "colleague",
          "community",
          "professional",
          "other"
        ])
        .optional(),
      relationshipLabel: z.string().trim().max(240).optional(),
      shortDescription: z.string().trim().max(2000).optional(),
      aliases: z.array(z.string().trim().min(1).max(160)).max(32).optional(),
      expectedWikiVersion: peerApiVersionSchema
    })
    .strict(),
  z
    .object({
      wikiPageId: peerApiIdSchema,
      action: z.literal("skip"),
      expectedWikiVersion: peerApiVersionSchema
    })
    .strict()
]);

export const peopleWikiAssociationPreviewSchema = z
  .object({
    userId: peerApiIdSchema.optional(),
    peopleRootPageId: peerApiIdSchema,
    decisions: z.array(wikiAssociationDecisionSchema).min(1).max(100)
  })
  .strict();

export const peopleWikiAssociationApplySchema = z
  .object({
    userId: peerApiIdSchema.optional(),
    peopleRootPageId: peerApiIdSchema,
    previewId: peerApiIdSchema,
    previewHash: peerApiHashSchema,
    idempotencyKey: peerApiIdempotencyKeySchema,
    decisions: z.array(wikiAssociationDecisionSchema).min(1).max(100)
  })
  .strict();

export const peerHumanPresenceOptionsSchema = z
  .object({
    ceremony: z.enum(["register", "authenticate", "companion_consent"]),
    action: peerPresenceActionSchema,
    credentialLabel: z.string().trim().min(1).max(120).optional(),
    companionDeviceId: peerApiIdSchema.optional()
  })
  .strict()
  .superRefine((input, context) => {
    if (input.ceremony === "register" && !input.credentialLabel) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Registration requires a credential label.",
        path: ["credentialLabel"]
      });
    }
    if (input.ceremony === "companion_consent" && !input.companionDeviceId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Companion consent requires an approved companion device.",
        path: ["companionDeviceId"]
      });
    }
  });

const webAuthnVerificationSchema = z
  .object({
    kind: z.literal("webauthn"),
    response: z.unknown()
  })
  .strict();
const companionVerificationSchema = z
  .object({
    kind: z.literal("companion_signature"),
    deviceId: peerApiIdSchema,
    challenge: z.string().regex(/^[A-Za-z0-9_-]{32,512}$/),
    signature: z.string().regex(/^[A-Za-z0-9_-]{64,256}$/),
    algorithm: z.literal("ES256"),
    keyId: peerApiIdSchema
  })
  .strict();

export const peerHumanPresenceVerifySchema = z
  .object({
    challengeId: peerApiIdSchema,
    action: peerPresenceActionSchema,
    verification: z.discriminatedUnion("kind", [
      webAuthnVerificationSchema,
      companionVerificationSchema
    ])
  })
  .strict();

export const createPeerInvitationSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    expiresInSeconds: z.number().int().min(60).max(900).default(300),
    privacyMode: peerTransportPrivacyModeSchema.default("fastest"),
    transportKinds: z.array(peerTransportKindSchema).min(1).max(4),
    idempotencyKey: peerApiIdempotencyKeySchema
  })
  .strict();

export const cancelPeerInvitationSchema = z
  .object({
    expectedVersion: peerApiVersionSchema.optional()
  })
  .strict();

export const acceptPeerPairingSchema = z
  .object({
    invitation: peerPairingInviteSchema,
    scannedAt: z.string().datetime({ offset: true }),
    localDeviceId: peerApiIdSchema,
    privacyMode: peerTransportPrivacyModeSchema.default("fastest"),
    idempotencyKey: peerApiIdempotencyKeySchema
  })
  .strict();

export const confirmPeerPairingSchema = z
  .object({
    expectedVersion: peerApiVersionSchema,
    transcriptHash: peerApiHashSchema,
    verificationPhrase: z.string().trim().min(7).max(240),
    personId: peerApiIdSchema.nullable().default(null),
    createPersonDisplayName: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .nullable()
      .default(null),
    idempotencyKey: peerApiIdempotencyKeySchema
  })
  .strict()
  .superRefine((input, context) => {
    if (input.personId && input.createPersonDisplayName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A pairing can link an existing Person or create one, not both."
      });
    }
  });

export const listPeerRequestsQuerySchema = z
  .object({
    kind: z.enum(["pairing", "device", "grant"]).optional(),
    status: z.enum(["pending", "accepted", "rejected", "expired"]).optional(),
    cursor: peerApiCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
  })
  .strict();

export const peerRequestDecisionSchema = z
  .object({
    expectedVersion: peerApiVersionSchema,
    reason: z.string().trim().max(500).default("")
  })
  .strict();

export const listPeerRelationshipsQuerySchema = z
  .object({
    query: z.string().trim().max(200).optional(),
    status: z
      .enum([
        "pending_verification",
        "active",
        "paused",
        "revoked",
        "recovery_required"
      ])
      .optional(),
    cursor: peerApiCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
  })
  .strict();

export const revokePeerRelationshipSchema = z
  .object({
    expectedVersion: peerApiVersionSchema,
    reason: z.string().trim().min(1).max(500),
    purgeManagedCache: z.boolean().default(true)
  })
  .strict();

export const peerDeviceMutationSchema = z
  .object({
    expectedVersion: peerApiVersionSchema,
    label: z.string().trim().min(1).max(160).optional(),
    reason: z.string().trim().max(500).default("")
  })
  .strict();

export const peerGrantDraftSchema = z
  .object({
    direction: peerShareDirectionSchema,
    label: z.string().trim().min(1).max(160),
    purpose: z.string().trim().max(2_000).default(""),
    effectiveAt: z.string().datetime({ offset: true }).nullable().default(null),
    expiresAt: z.string().datetime({ offset: true }).nullable().default(null),
    cachePolicy: peerCachePolicySchema,
    rules: z.array(peerShareRuleSchema).min(1).max(256)
  })
  .strict()
  .superRefine((draft, context) => {
    if (
      draft.effectiveAt &&
      draft.expiresAt &&
      Date.parse(draft.effectiveAt) >= Date.parse(draft.expiresAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The grant expiry must be after its effective time.",
        path: ["expiresAt"]
      });
    }
  });

export const previewPeerGrantSchema = z
  .object({
    draft: peerGrantDraftSchema,
    sampleLimit: z.number().int().min(1).max(100).default(25),
    includeWorstCase: z.literal(true).default(true)
  })
  .strict();

export const proposePeerGrantSchema = z
  .object({
    expectedRelationshipVersion: peerApiVersionSchema,
    previewHash: peerApiHashSchema,
    idempotencyKey: peerApiIdempotencyKeySchema,
    draft: peerGrantDraftSchema
  })
  .strict();

export const listPeerGrantsQuerySchema = z
  .object({
    status: z
      .enum([
        "draft",
        "proposed",
        "active",
        "countered",
        "rejected",
        "revoked",
        "superseded",
        "expired",
        "conflicted"
      ])
      .optional(),
    cursor: peerApiCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
  })
  .strict();

export const acceptPeerGrantSchema = z
  .object({
    expectedVersionHash: peerApiHashSchema,
    idempotencyKey: peerApiIdempotencyKeySchema
  })
  .strict();

export const counterPeerGrantSchema = z
  .object({
    expectedVersionHash: peerApiHashSchema,
    previewHash: peerApiHashSchema,
    idempotencyKey: peerApiIdempotencyKeySchema,
    draft: peerGrantDraftSchema
  })
  .strict();

export const revokePeerGrantSchema = z
  .object({
    expectedVersionHash: peerApiHashSchema,
    reason: z.string().trim().min(1).max(500),
    purgeManagedCache: z.boolean().default(true)
  })
  .strict();

export const requestPeerResyncSchema = z
  .object({
    expectedRelationshipVersion: peerApiVersionSchema,
    projectionIds: z.array(peerProjectionIdSchema).min(1).max(8),
    idempotencyKey: peerApiIdempotencyKeySchema
  })
  .strict();

export const peerDiagnosticsQuerySchema = z
  .object({
    cursor: peerApiCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100)
  })
  .strict();

export const personQuestionInterpretSchema = z
  .object({
    question: z.string().trim().min(1).max(1_000),
    timeZone: ianaTimeZoneSchema,
    referenceTime: z.string().datetime({ offset: true }).optional()
  })
  .strict();

export const personQuestionExecuteSchema = z
  .object({
    interpretationId: peerApiIdSchema,
    interpretationHash: peerApiHashSchema,
    query: peerTypedQuestionSchema,
    sourcePreference: z
      .enum(["live_then_cache", "live_only", "cache_only"])
      .default("live_then_cache")
  })
  .strict();

export const personQuestionHistoryQuerySchema = z
  .object({
    cursor: peerApiCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
  })
  .strict();

export type PeerApiOperationId =
  (typeof PEER_ROUTE_CONTRACTS)[number]["operationId"];

const peerApiIsoDateTimeSchema = z.string().datetime({ offset: true });
const peerApiNullableIsoDateTimeSchema = peerApiIsoDateTimeSchema.nullable();
const peerApiNonnegativeIntegerSchema = z.number().int().nonnegative();
const peerApiPageSchema = z
  .object({
    limit: z.number().int().min(1).max(200),
    hasMore: z.boolean(),
    nextCursor: peerApiCursorSchema.nullable()
  })
  .strict();

const peerApiJsonScalarSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null()
]);
const peerApiJsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    peerApiJsonScalarSchema,
    z.array(peerApiJsonValueSchema).max(20_000),
    z.record(peerApiJsonValueSchema)
  ])
);
const peerApiJsonObjectSchema = z.record(peerApiJsonValueSchema);

const peerPersonAliasResponseSchema = z
  .object({
    id: peerApiIdSchema,
    personId: peerApiIdSchema,
    alias: z.string().min(1).max(240),
    normalizedAlias: z.string().min(1).max(240),
    kind: personAliasKindSchema,
    createdAt: peerApiIsoDateTimeSchema,
    updatedAt: peerApiIsoDateTimeSchema
  })
  .strict();
const peerPersonContactResponseSchema = z
  .object({
    id: peerApiIdSchema,
    personId: peerApiIdSchema,
    kind: personContactKindSchema,
    label: z.string().max(240),
    value: z.string().min(1).max(4_000),
    normalizedValue: z.string().min(1).max(4_000),
    isPrimary: z.boolean(),
    visibility: personContactVisibilitySchema,
    provenance: peerApiJsonObjectSchema,
    createdAt: peerApiIsoDateTimeSchema,
    updatedAt: peerApiIsoDateTimeSchema,
    deletedAt: peerApiNullableIsoDateTimeSchema
  })
  .strict();
const peerPersonFactResponseSchema = z
  .object({
    id: peerApiIdSchema,
    personId: peerApiIdSchema,
    factType: z.string().min(1).max(120),
    label: z.string().max(500),
    value: peerApiJsonValueSchema,
    sensitivity: personFactSensitivitySchema,
    sourceKind: personFactSourceKindSchema,
    sourceEntityType: z.string().max(120).nullable(),
    sourceEntityId: peerApiIdSchema.nullable(),
    observedAt: z.string().max(64).nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    reviewedAt: peerApiNullableIsoDateTimeSchema,
    createdAt: peerApiIsoDateTimeSchema,
    updatedAt: peerApiIsoDateTimeSchema,
    deletedAt: peerApiNullableIsoDateTimeSchema
  })
  .strict();
const peerPersonActorBindingResponseSchema = z
  .object({
    id: peerApiIdSchema,
    personId: peerApiIdSchema,
    ownerUserId: peerApiIdSchema,
    actorUserId: peerApiIdSchema,
    bindingKind: personActorBindingKindSchema,
    verifiedAt: peerApiNullableIsoDateTimeSchema,
    createdAt: peerApiIsoDateTimeSchema
  })
  .strict();
const peerPersonWireResponseSchema = z
  .object({
    id: peerApiIdSchema,
    userId: peerApiIdSchema,
    normalizedDisplayName: z.string().min(1).max(240),
    displayName: z.string().min(1).max(240),
    givenName: z.string().max(160),
    middleName: z.string().max(160),
    familyName: z.string().max(160),
    preferredName: z.string().max(160),
    pronouns: z.string().max(120),
    relationshipCategory: z.string().max(120),
    relationshipLabel: z.string().max(240),
    closeness: z.number().int().min(0).max(5).nullable(),
    importance: z.number().int().min(0).max(5).nullable(),
    shortDescription: z.string().max(2_000),
    description: z.string().max(50_000),
    privateNotes: z.string().max(100_000),
    howWeMet: z.string().max(10_000),
    metAt: z.string().max(64).nullable(),
    birthdayYear: z.number().int().min(1).max(9_999).nullable(),
    birthdayMonth: z.number().int().min(1).max(12).nullable(),
    birthdayDay: z.number().int().min(1).max(31).nullable(),
    birthdayPrecision: personBirthdayPrecisionSchema,
    timezone: z.string().max(128),
    homePlaceLabel: z.string().max(500),
    contactPreferences: peerApiJsonObjectSchema,
    metadata: peerApiJsonObjectSchema,
    aliases: z.array(peerPersonAliasResponseSchema).max(256),
    contacts: z.array(peerPersonContactResponseSchema).max(256),
    facts: z.array(peerPersonFactResponseSchema).max(1_000),
    actorBindings: z.array(peerPersonActorBindingResponseSchema).max(256),
    createdAt: peerApiIsoDateTimeSchema,
    updatedAt: peerApiIsoDateTimeSchema,
    deletedAt: peerApiNullableIsoDateTimeSchema
  })
  .strict();
const peerPersonResponseSchema = peerPersonWireResponseSchema.superRefine(
  (person, context) => {
    const canonical = personSchema.safeParse(person);
    if (!canonical.success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Person response does not satisfy the canonical Person schema."
      });
    }
  }
);

export const peerRelationshipResponseSchema = z
  .object({
    id: peerApiIdSchema,
    ownerUserId: peerApiIdSchema,
    localPrincipalId: peerApiIdSchema,
    remotePrincipalId: peerApiIdSchema,
    localPersonId: peerApiIdSchema.nullable(),
    status: peerRelationshipStatusSchema,
    negotiatedProtocolVersion: z.string().trim().min(1).max(80),
    transportPrivacyMode: peerTransportPrivacyModeSchema,
    highestReceivedSequence: peerApiNonnegativeIntegerSchema,
    highestSentSequence: peerApiNonnegativeIntegerSchema,
    establishedAt: peerApiNullableIsoDateTimeSchema,
    lastConnectedAt: peerApiNullableIsoDateTimeSchema,
    revokedAt: peerApiNullableIsoDateTimeSchema,
    createdAt: peerApiIsoDateTimeSchema,
    updatedAt: peerApiIsoDateTimeSchema,
    remoteDisplayLabel: z.string().max(240),
    remoteTrustState: z.enum([
      "unverified",
      "pending",
      "verified",
      "revoked",
      "recovery_required"
    ])
  })
  .strict();

const peerPersonRelationshipResponseSchema = peerRelationshipResponseSchema
  .extend({
    pendingRequestCount: peerApiNonnegativeIntegerSchema,
    approvedDeviceCount: peerApiNonnegativeIntegerSchema,
    pendingDeviceCount: peerApiNonnegativeIntegerSchema
  })
  .strict();

export const peerDeviceResponseSchema = z
  .object({
    relationshipId: peerApiIdSchema,
    deviceId: peerApiIdSchema,
    principalRole: z.enum(["local", "remote"]),
    status: peerDeviceStatusSchema,
    label: z.string().max(240),
    deviceType: z.string().trim().min(1).max(80),
    lastSeenAt: peerApiNullableIsoDateTimeSchema,
    approvedAt: peerApiNullableIsoDateTimeSchema,
    removedAt: peerApiNullableIsoDateTimeSchema,
    createdAt: peerApiIsoDateTimeSchema,
    updatedAt: peerApiIsoDateTimeSchema
  })
  .strict();

export const peerPendingRequestResponseSchema = z
  .object({
    id: peerApiIdSchema,
    ownerUserId: peerApiIdSchema,
    relationshipId: peerApiIdSchema.nullable(),
    kind: z.enum(["pairing", "device", "grant"]),
    status: z.enum(["pending", "accepted", "rejected", "expired"]),
    version: z.number().int().positive(),
    payload: peerApiJsonValueSchema,
    payloadHash: peerApiHashSchema,
    expiresAt: peerApiIsoDateTimeSchema,
    decidedAt: peerApiNullableIsoDateTimeSchema,
    decisionReason: z.string().max(1_000),
    createdAt: peerApiIsoDateTimeSchema,
    updatedAt: peerApiIsoDateTimeSchema
  })
  .strict();

const peerCoreHealthResponseSchema = z
  .object({
    enabled: z.boolean(),
    healthy: z.boolean(),
    protocolVersion: z.string().trim().min(1).max(80).nullable(),
    reason: z.string().max(500).nullable()
  })
  .strict();

const peerCorePresenceResponseSchema = peerCoreHealthResponseSchema
  .extend({ localDeviceId: peerApiIdSchema.nullable() })
  .strict();

const peerPresenceCredentialResponseSchema = z
  .object({
    id: peerApiIdSchema,
    rpId: z.string().trim().min(1).max(253),
    label: z.string().max(120),
    deviceType: z.enum(["singleDevice", "multiDevice"]),
    backedUp: z.boolean(),
    createdAt: peerApiIsoDateTimeSchema,
    lastUsedAt: peerApiNullableIsoDateTimeSchema
  })
  .strict();

const peerCompanionEnrollmentOptionsResponseSchema = z
  .object({
    protocol: z.literal(PEER_COMPANION_ENROLLMENT_PROTOCOL),
    challengeId: peerApiIdSchema,
    challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    enrollmentAttemptId: peerApiIdSchema,
    pairingSessionId: peerApiIdSchema,
    ownerUserId: peerApiIdSchema,
    device: peerCompanionDeviceIdentitySchema,
    issuedAt: peerApiIsoDateTimeSchema,
    expiresAt: peerApiIsoDateTimeSchema
  })
  .strict();

const peerCompanionEnrollmentReceiptResponseSchema = z
  .object({
    protocol: z.literal(PEER_COMPANION_ENROLLMENT_PROTOCOL),
    enrollmentId: peerApiIdSchema,
    keyId: peerApiIdSchema,
    pairingSessionId: peerApiIdSchema,
    ownerUserId: peerApiIdSchema,
    device: peerCompanionDeviceIdentitySchema,
    scopes: z
      .array(z.enum(PEER_COMPANION_SCOPES))
      .length(PEER_COMPANION_SCOPES.length),
    capabilities: z
      .array(z.enum(PEER_COMPANION_CAPABILITIES))
      .length(PEER_COMPANION_CAPABILITIES.length),
    authorizedOperations: z
      .array(z.enum(PEER_COMPANION_AUTHORIZED_OPERATION_IDS))
      .length(PEER_COMPANION_AUTHORIZED_OPERATION_IDS.length),
    enrolledAt: peerApiIsoDateTimeSchema,
    legacyBootstrapDisabledAt: peerApiIsoDateTimeSchema,
    legacyBootstrapAccepted: z.literal(false)
  })
  .strict();

const peerHumanPresenceStatusResponseSchema = z.union([
  z
    .object({
      methods: z
        .object({
          webauthn: z
            .object({
              available: z.literal(true),
              firstCredentialBootstrapAllowed: z.boolean(),
              credentialSetVersion: peerApiHashSchema,
              rpId: z.string().trim().min(1).max(253)
            })
            .strict(),
          companionConsent: z.object({ available: z.literal(false) }).strict()
        })
        .strict(),
      credentials: z.array(peerPresenceCredentialResponseSchema).max(64),
      peerCore: peerCorePresenceResponseSchema
    })
    .strict(),
  z
    .object({
      methods: z
        .object({
          webauthn: z.object({ available: z.literal(false) }).strict(),
          companionConsent: z
            .object({
              available: z.literal(true),
              protocol: z.literal(PEER_COMPANION_CONSENT_PROTOCOL),
              requestProtocol: z.literal(PEER_COMPANION_REQUEST_PROTOCOL),
              deviceId: peerApiIdSchema.nullable(),
              scopes: z.array(z.string().trim().min(1).max(160)).max(256),
              capabilities: z.array(z.string().trim().min(1).max(160)).max(32),
              authorizedOperations: z
                .array(z.string().trim().min(1).max(160))
                .max(64)
            })
            .strict()
        })
        .strict(),
      credentials: z.tuple([]),
      peerCore: peerCorePresenceResponseSchema
    })
    .strict()
]);

const webAuthnTransportSchema = z.enum([
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb"
]);
const webAuthnCredentialDescriptorSchema = z
  .object({
    id: z.string().min(1).max(2_048),
    type: z.literal("public-key"),
    transports: z.array(webAuthnTransportSchema).max(16).optional()
  })
  .strict();
const webAuthnRegistrationOptionsSchema = z
  .object({
    challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    rp: z
      .object({
        name: z.string().min(1).max(120),
        id: z.string().trim().min(1).max(253)
      })
      .strict(),
    user: z
      .object({
        id: z.string().min(1).max(2_048),
        name: z.string().min(1).max(240),
        displayName: z.string().min(1).max(240)
      })
      .strict(),
    pubKeyCredParams: z
      .array(
        z
          .object({ alg: z.number().int(), type: z.literal("public-key") })
          .strict()
      )
      .min(1)
      .max(32),
    timeout: z.number().int().positive(),
    attestation: z.literal("none"),
    excludeCredentials: z.array(webAuthnCredentialDescriptorSchema).max(256),
    authenticatorSelection: z
      .object({
        residentKey: z.literal("preferred"),
        userVerification: z.literal("required"),
        requireResidentKey: z.boolean()
      })
      .strict(),
    extensions: z.object({ credProps: z.literal(true) }).strict(),
    hints: z.array(z.string().max(80)).max(32)
  })
  .strict();
const webAuthnAuthenticationOptionsSchema = z
  .object({
    rpId: z.string().trim().min(1).max(253),
    challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    allowCredentials: z
      .array(webAuthnCredentialDescriptorSchema)
      .min(1)
      .max(256),
    timeout: z.number().int().positive(),
    userVerification: z.literal("required")
  })
  .strict();
const peerHumanPresenceOptionsResponseSchema = z.union([
  z
    .object({
      protocol: z.literal(PEER_COMPANION_CONSENT_PROTOCOL),
      challengeId: peerApiIdSchema,
      challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      actionDigest: peerApiHashSchema,
      deviceId: peerApiIdSchema,
      ownerUserId: peerApiIdSchema,
      principalId: peerApiIdSchema,
      issuedAt: peerApiIsoDateTimeSchema,
      expiresAt: peerApiIsoDateTimeSchema
    })
    .strict(),
  z
    .object({
      challengeId: peerApiIdSchema,
      ceremony: z.literal("register"),
      options: webAuthnRegistrationOptionsSchema
    })
    .strict(),
  z
    .object({
      challengeId: peerApiIdSchema,
      ceremony: z.literal("authenticate"),
      options: webAuthnAuthenticationOptionsSchema
    })
    .strict()
]);

const peerHumanPresenceVerifyResponseSchema = z.union([
  z
    .object({
      approved: z.literal(true),
      protocol: z.literal(PEER_COMPANION_CONSENT_PROTOCOL),
      capabilityId: peerApiIdSchema,
      expiresAt: peerApiIsoDateTimeSchema,
      deviceId: peerApiIdSchema,
      actionDigest: peerApiHashSchema
    })
    .strict(),
  z
    .object({
      approved: z.literal(true),
      expiresAt: peerApiIsoDateTimeSchema,
      credential: z
        .object({
          id: peerApiIdSchema,
          label: z.string().max(120),
          deviceType: z.enum(["singleDevice", "multiDevice"]),
          backedUp: z.boolean(),
          createdAt: peerApiIsoDateTimeSchema,
          lastUsedAt: peerApiNullableIsoDateTimeSchema
        })
        .strict()
    })
    .strict()
]);

const peerInvitationStatusResponseSchema = z
  .object({
    id: peerApiIdSchema,
    status: z.enum([
      "active",
      "claimed",
      "consumed",
      "canceled",
      "expired",
      "locked"
    ]),
    fingerprint: z.string().trim().min(16).max(120),
    protocolVersion: z.string().trim().min(1).max(80),
    transportKinds: z.array(peerTransportKindSchema).max(4),
    failedAttemptCount: peerApiNonnegativeIntegerSchema,
    maximumAttempts: z.number().int().min(1).max(100),
    expiresAt: peerApiIsoDateTimeSchema,
    claimedAt: peerApiNullableIsoDateTimeSchema,
    consumedAt: peerApiNullableIsoDateTimeSchema,
    canceledAt: peerApiNullableIsoDateTimeSchema,
    createdAt: peerApiIsoDateTimeSchema,
    updatedAt: peerApiIsoDateTimeSchema
  })
  .strict();

const peerGrantListItemResponseSchema = z
  .object({
    id: peerApiIdSchema,
    ownerUserId: peerApiIdSchema,
    relationshipId: peerApiIdSchema,
    direction: peerShareDirectionSchema,
    sequence: z.number().int().positive(),
    previousVersionHash: peerApiHashSchema.nullable(),
    status: peerGrantStatusSchema,
    label: z.string().trim().min(1).max(160),
    purpose: z.string().max(2_000),
    issuedAt: peerApiIsoDateTimeSchema,
    effectiveAt: peerApiNullableIsoDateTimeSchema,
    expiresAt: peerApiNullableIsoDateTimeSchema,
    revokedAt: peerApiNullableIsoDateTimeSchema,
    cachePolicy: peerCachePolicySchema,
    rules: z.array(peerShareRuleSchema).min(1).max(256),
    signatures: z.array(peerGrantSignatureSchema).max(16),
    protocolVersion: z.literal(PEER_PROTOCOL_VERSION),
    schemaVersion: z.literal(1),
    versionHash: peerApiHashSchema
  })
  .strict();

const peerGrantEnvelopeResponseSchema = z
  .object({
    grant: peerShareGrantVersionSchema,
    versionHash: peerApiHashSchema
  })
  .strict();

const peerGrantPreviewResponseSchema = z
  .object({
    preview: z
      .object({
        hash: peerApiHashSchema,
        relationshipVersion: peerApiVersionSchema,
        exact: z
          .object({
            direction: peerShareDirectionSchema,
            rules: z.array(peerShareRuleSchema).min(1).max(256),
            cachePolicy: peerCachePolicySchema,
            effectiveAt: peerApiNullableIsoDateTimeSchema,
            expiresAt: peerApiNullableIsoDateTimeSchema
          })
          .strict(),
        worstCase: z
          .object({
            projectionIds: z.array(peerProjectionIdSchema).max(8),
            maximumResultCount: peerApiNonnegativeIntegerSchema,
            maximumPayloadBytes: peerApiNonnegativeIntegerSchema,
            maximumRetentionSeconds: peerApiNonnegativeIntegerSchema,
            allShareableRuleCount: peerApiNonnegativeIntegerSchema,
            currentApprovedDeviceCount: peerApiNonnegativeIntegerSchema
          })
          .strict(),
        samples: z
          .array(
            z
              .object({
                ruleId: peerApiIdSchema,
                projectionId: peerProjectionIdSchema,
                fields: z.array(z.string().min(1).max(120)).max(256),
                excludedFields: z.array(z.string().min(1).max(120)).max(256),
                precision: z.string().trim().min(1).max(80),
                entitySelector: z
                  .object({
                    mode: z.enum(["all_shareable", "selected"]),
                    entityType: z.string().trim().min(1).max(80).optional(),
                    entityIds: z.array(peerApiIdSchema).max(5_000)
                  })
                  .strict()
                  .nullable(),
                time: z
                  .object({
                    startsAt: peerApiNullableIsoDateTimeSchema,
                    endsAt: peerApiNullableIsoDateTimeSchema,
                    rollingPastDays: z
                      .number()
                      .int()
                      .min(0)
                      .max(3_650)
                      .nullable(),
                    rollingFutureDays: z
                      .number()
                      .int()
                      .min(0)
                      .max(3_650)
                      .nullable()
                  })
                  .strict()
              })
              .strict()
          )
          .max(100)
      })
      .strict()
  })
  .strict();

const peerSyncResponseSchema = z
  .object({
    relationship: peerRelationshipResponseSchema,
    pendingOutbox: peerApiNonnegativeIntegerSchema,
    pendingInbox: peerApiNonnegativeIntegerSchema,
    currentRemoteRecords: peerApiNonnegativeIntegerSchema,
    staleRemoteRecords: peerApiNonnegativeIntegerSchema
  })
  .strict();

const personSharedProjectionResponseSchema = z
  .object({
    id: peerApiIdSchema,
    projectionId: peerProjectionIdSchema,
    projectionVersion: z.literal(1),
    asOf: peerApiIsoDateTimeSchema,
    receivedAt: peerApiIsoDateTimeSchema,
    validUntil: peerApiNullableIsoDateTimeSchema,
    completeness: z.number().min(0).max(1),
    precision: z.string().trim().min(1).max(80),
    state: z.enum([
      "current",
      "stale",
      "revoked",
      "withdrawn",
      "key_unavailable"
    ]),
    relationshipId: peerApiIdSchema,
    grantId: peerApiIdSchema.nullable(),
    grantSequence: z.number().int().positive().nullable(),
    source: z
      .object({
        principalId: peerApiIdSchema,
        deviceId: peerApiIdSchema,
        relationshipId: peerApiIdSchema
      })
      .strict()
      .nullable()
  })
  .strict();

const peopleWikiRootResponseSchema = z
  .object({
    id: peerApiIdSchema,
    slug: z.string().trim().min(1).max(240),
    spaceId: peerApiIdSchema,
    updatedAt: peerApiIsoDateTimeSchema
  })
  .strict();

const supportedPersonQuestionInterpretationSchema = z
  .object({
    supported: z.literal(true),
    projectionId: z.enum([
      "calendar.availability.v1",
      "goals.horizon_summary.v1",
      "health.cycling.aggregate.v1"
    ]),
    confidence: z.number().min(0).max(1),
    requestedPrecision: z.enum(["exact", "fifteen_minutes"]),
    requiresTimeResolution: z.boolean(),
    id: peerApiIdSchema,
    hash: peerApiHashSchema,
    expiresAt: peerApiIsoDateTimeSchema,
    query: peerTypedQuestionSchema
  })
  .strict();
const unsupportedPersonQuestionInterpretationSchema = z
  .object({
    supported: z.literal(false),
    reason: z.enum(["unsupported_projection", "question_empty"])
  })
  .strict();

function peerQuestionResultVariant(
  projectionId: keyof typeof peerProjectionOutputSchemas
) {
  return z
    .object({
      state: z.enum(["live", "cached", "stale"]),
      payload: peerProjectionOutputSchemas[projectionId],
      metadata: peerProjectionResponseMetadataSchema
        .extend({
          projectionId: z.literal(projectionId),
          state: z.enum(["live", "cached", "stale"])
        })
        .strict()
    })
    .strict();
}

const peerQuestionResultResponseSchema = z.union([
  peerQuestionResultVariant("calendar.availability.v1"),
  peerQuestionResultVariant("calendar.selected_events.v1"),
  peerQuestionResultVariant("goals.horizon_summary.v1"),
  peerQuestionResultVariant("health.cycling.aggregate.v1"),
  peerQuestionResultVariant("person.profile.v1"),
  peerQuestionResultVariant("life_events.selected.v1"),
  peerQuestionResultVariant("movement.aggregate.v1"),
  peerQuestionResultVariant("custom.selected_entities.v1")
]);

const peerQuestionHistoryEntrySchema = z
  .object({
    id: peerApiIdSchema,
    projectionId: peerProjectionIdSchema,
    requesterClass: peerPrincipalClassSchema,
    decision: z.enum(["allowed", "denied", "error"]),
    decisionReason: z.string().max(1_000),
    resultCount: peerApiNonnegativeIntegerSchema,
    durationMs: peerApiNonnegativeIntegerSchema,
    createdAt: peerApiIsoDateTimeSchema
  })
  .strict();

const peerDiagnosticEntrySchema = z
  .object({
    id: peerApiIdSchema,
    eventType: z.string().trim().min(1).max(160),
    actorClass: z.enum([
      "operator_session",
      "agent_token",
      "companion_session",
      "companion_consent",
      "peer_device",
      "local_service",
      "system"
    ]),
    outcome: z.enum(["recorded", "allowed", "denied", "failed"]),
    createdAt: peerApiIsoDateTimeSchema,
    metadata: peerApiJsonValueSchema
  })
  .strict();

const peopleListResponseSchema = z
  .object({
    people: z.array(peerPersonResponseSchema).max(100),
    page: peerApiPageSchema
  })
  .strict();
const personContextResponseSchema = z
  .object({
    context: z
      .object({
        person: peerPersonResponseSchema,
        links: z.array(personLinkSchema).max(200),
        profilePageLinks: z.array(personLinkSchema).max(200),
        relationships: z.array(peerPersonRelationshipResponseSchema).max(100),
        sharedProjections: z
          .array(personSharedProjectionResponseSchema)
          .max(100),
        sources: z
          .object({
            local: z.boolean(),
            wiki: z.boolean(),
            shared: z.boolean(),
            sharedProjectionCount: peerApiNonnegativeIntegerSchema
          })
          .strict()
      })
      .strict()
  })
  .strict();
const peopleWikiScanResponseSchema = z
  .object({
    candidates: z.array(wikiPersonCandidateSchema).max(100),
    root: peopleWikiRootResponseSchema,
    page: peerApiPageSchema,
    scan: z
      .object({
        rootCount: peerApiNonnegativeIntegerSchema,
        scannedCount: peerApiNonnegativeIntegerSchema,
        truncated: z.boolean()
      })
      .strict()
  })
  .strict();
const peopleWikiPreviewResponseSchema = z
  .object({
    preview: z
      .object({
        id: peerApiIdSchema,
        hash: peerApiHashSchema,
        expiresAt: peerApiIsoDateTimeSchema,
        effects: z
          .array(
            z
              .object({
                wikiPageId: peerApiIdSchema,
                action: z.enum(["associate", "create_person", "skip"]),
                personId: peerApiIdSchema.nullable(),
                displayName: z.string().max(160).nullable()
              })
              .strict()
          )
          .min(1)
          .max(100),
        mutationCount: z.number().int().min(0).max(100)
      })
      .strict()
  })
  .strict();
const personQuestionInterpretResponseSchema = z
  .object({
    interpretation: z.union([
      supportedPersonQuestionInterpretationSchema,
      unsupportedPersonQuestionInterpretationSchema
    ])
  })
  .strict();
const personQuestionExecuteResponseSchema = z
  .object({
    result: peerQuestionResultResponseSchema,
    durationMs: peerApiNonnegativeIntegerSchema
  })
  .strict();
const personQuestionHistoryResponseSchema = z
  .object({
    questions: z.array(peerQuestionHistoryEntrySchema).max(100),
    page: peerApiPageSchema
  })
  .strict();

export type PeerApiSuccessContract = {
  status: 200 | 201 | 202;
  schema: z.ZodTypeAny;
};

export const PEER_API_SUCCESS_SCHEMAS: Record<
  PeerApiOperationId,
  PeerApiSuccessContract
> = {
  listPeopleReadModel: { status: 200, schema: peopleListResponseSchema },
  getPersonContext: { status: 200, schema: personContextResponseSchema },
  scanPeopleWikiCandidates: {
    status: 200,
    schema: peopleWikiScanResponseSchema
  },
  previewPeopleWikiAssociations: {
    status: 200,
    schema: peopleWikiPreviewResponseSchema
  },
  applyPeopleWikiAssociations: {
    status: 200,
    schema: wikiPersonAssociationApplyResultSchema
  },
  createPeerCompanionEnrollmentOptions: {
    status: 200,
    schema: peerCompanionEnrollmentOptionsResponseSchema
  },
  verifyPeerCompanionEnrollment: {
    status: 200,
    schema: peerCompanionEnrollmentReceiptResponseSchema
  },
  getPeerHumanPresenceStatus: {
    status: 200,
    schema: peerHumanPresenceStatusResponseSchema
  },
  createPeerHumanPresenceOptions: {
    status: 200,
    schema: peerHumanPresenceOptionsResponseSchema
  },
  verifyPeerHumanPresence: {
    status: 200,
    schema: peerHumanPresenceVerifyResponseSchema
  },
  revokePeerHumanPresenceCredential: {
    status: 200,
    schema: z
      .object({ revoked: z.literal(true), credentialId: peerApiIdSchema })
      .strict()
  },
  createPeerInvitation: {
    status: 201,
    schema: z.object({ invitation: peerPairingInviteSchema }).strict()
  },
  getPeerInvitationStatus: {
    status: 200,
    schema: z
      .object({ invitation: peerInvitationStatusResponseSchema })
      .strict()
  },
  cancelPeerInvitation: {
    status: 200,
    schema: z
      .object({ canceled: z.literal(true), invitationId: peerApiIdSchema })
      .strict()
  },
  acceptScannedPeerPairing: {
    status: 202,
    schema: z.object({ request: peerPendingRequestResponseSchema }).strict()
  },
  confirmPeerPairing: {
    status: 200,
    schema: z
      .object({
        relationshipId: peerApiIdSchema,
        request: peerPendingRequestResponseSchema
      })
      .strict()
  },
  listPeerRequests: {
    status: 200,
    schema: z
      .object({
        requests: z.array(peerPendingRequestResponseSchema).max(100),
        page: peerApiPageSchema
      })
      .strict()
  },
  acceptPeerRequest: {
    status: 200,
    schema: z.object({ request: peerPendingRequestResponseSchema }).strict()
  },
  rejectPeerRequest: {
    status: 200,
    schema: z.object({ request: peerPendingRequestResponseSchema }).strict()
  },
  listPeerRelationships: {
    status: 200,
    schema: z
      .object({
        relationships: z.array(peerRelationshipResponseSchema).max(100),
        page: peerApiPageSchema
      })
      .strict()
  },
  getPeerRelationship: {
    status: 200,
    schema: z
      .object({
        relationship: peerRelationshipResponseSchema,
        devices: z.array(peerDeviceResponseSchema).max(256),
        grants: z.array(peerShareGrantVersionSchema).max(20),
        sync: peerSyncResponseSchema.nullable()
      })
      .strict()
  },
  revokePeerRelationship: {
    status: 200,
    schema: z.object({ relationship: peerRelationshipResponseSchema }).strict()
  },
  listPeerDevices: {
    status: 200,
    schema: z
      .object({
        devices: z.array(peerDeviceResponseSchema).max(256),
        boundedAt: z.literal(256),
        truncated: z.boolean()
      })
      .strict()
  },
  approvePeerDevice: {
    status: 200,
    schema: z.object({ device: peerDeviceResponseSchema }).strict()
  },
  removePeerDevice: {
    status: 200,
    schema: z.object({ device: peerDeviceResponseSchema }).strict()
  },
  previewPeerGrant: { status: 200, schema: peerGrantPreviewResponseSchema },
  proposePeerGrant: { status: 201, schema: peerGrantEnvelopeResponseSchema },
  listPeerGrants: {
    status: 200,
    schema: z
      .object({
        grants: z.array(peerGrantListItemResponseSchema).max(100),
        page: peerApiPageSchema
      })
      .strict()
  },
  acceptPeerGrant: { status: 200, schema: peerGrantEnvelopeResponseSchema },
  counterPeerGrant: { status: 201, schema: peerGrantEnvelopeResponseSchema },
  revokePeerGrant: { status: 200, schema: peerGrantEnvelopeResponseSchema },
  getPeerSyncStatus: {
    status: 200,
    schema: z
      .object({
        sync: peerSyncResponseSchema,
        peerCore: peerCoreHealthResponseSchema
      })
      .strict()
  },
  requestPeerResync: {
    status: 202,
    schema: z
      .object({
        requested: z.literal(true),
        envelopeIds: z.array(peerApiIdSchema).max(10_000)
      })
      .strict()
  },
  getPeerDiagnostics: {
    status: 200,
    schema: z
      .object({
        diagnostics: z.array(peerDiagnosticEntrySchema).max(200),
        peerCore: peerCoreHealthResponseSchema,
        page: peerApiPageSchema
      })
      .strict()
  },
  interpretPersonQuestion: {
    status: 200,
    schema: personQuestionInterpretResponseSchema
  },
  executePersonQuestion: {
    status: 200,
    schema: personQuestionExecuteResponseSchema
  },
  listPersonQuestionHistory: {
    status: 200,
    schema: personQuestionHistoryResponseSchema
  }
};

export type PeerApiRequestSchemaContract = {
  params: z.ZodTypeAny;
  query: z.ZodTypeAny;
  body?: z.ZodTypeAny;
};

export type PeerApiSchemaContract = PeerApiRequestSchemaContract & {
  success: PeerApiSuccessContract;
};

const PEER_API_REQUEST_SCHEMAS: Record<
  PeerApiOperationId,
  PeerApiRequestSchemaContract
> = {
  listPeopleReadModel: { params: emptySchema, query: listPeopleQuerySchema },
  getPersonContext: {
    params: personParamsSchema,
    query: personContextQuerySchema
  },
  scanPeopleWikiCandidates: {
    params: emptySchema,
    query: emptySchema,
    body: peopleWikiCandidateScanSchema
  },
  previewPeopleWikiAssociations: {
    params: emptySchema,
    query: emptySchema,
    body: peopleWikiAssociationPreviewSchema
  },
  applyPeopleWikiAssociations: {
    params: emptySchema,
    query: emptySchema,
    body: peopleWikiAssociationApplySchema
  },
  createPeerCompanionEnrollmentOptions: {
    params: emptySchema,
    query: emptySchema,
    body: peerCompanionEnrollmentOptionsInputSchema
  },
  verifyPeerCompanionEnrollment: {
    params: emptySchema,
    query: emptySchema,
    body: peerCompanionEnrollmentVerifyInputSchema
  },
  getPeerHumanPresenceStatus: { params: emptySchema, query: emptySchema },
  createPeerHumanPresenceOptions: {
    params: emptySchema,
    query: emptySchema,
    body: peerHumanPresenceOptionsSchema
  },
  verifyPeerHumanPresence: {
    params: emptySchema,
    query: emptySchema,
    body: peerHumanPresenceVerifySchema
  },
  revokePeerHumanPresenceCredential: {
    params: credentialParamsSchema,
    query: emptySchema
  },
  createPeerInvitation: {
    params: emptySchema,
    query: emptySchema,
    body: createPeerInvitationSchema
  },
  getPeerInvitationStatus: {
    params: invitationParamsSchema,
    query: emptySchema
  },
  cancelPeerInvitation: {
    params: invitationParamsSchema,
    query: emptySchema,
    body: cancelPeerInvitationSchema
  },
  acceptScannedPeerPairing: {
    params: emptySchema,
    query: emptySchema,
    body: acceptPeerPairingSchema
  },
  confirmPeerPairing: {
    params: pairingParamsSchema,
    query: emptySchema,
    body: confirmPeerPairingSchema
  },
  listPeerRequests: { params: emptySchema, query: listPeerRequestsQuerySchema },
  acceptPeerRequest: {
    params: requestParamsSchema,
    query: emptySchema,
    body: peerRequestDecisionSchema
  },
  rejectPeerRequest: {
    params: requestParamsSchema,
    query: emptySchema,
    body: peerRequestDecisionSchema
  },
  listPeerRelationships: {
    params: emptySchema,
    query: listPeerRelationshipsQuerySchema
  },
  getPeerRelationship: { params: relationshipParamsSchema, query: emptySchema },
  revokePeerRelationship: {
    params: relationshipParamsSchema,
    query: emptySchema,
    body: revokePeerRelationshipSchema
  },
  listPeerDevices: { params: relationshipParamsSchema, query: emptySchema },
  approvePeerDevice: {
    params: relationshipDeviceParamsSchema,
    query: emptySchema,
    body: peerDeviceMutationSchema
  },
  removePeerDevice: {
    params: relationshipDeviceParamsSchema,
    query: emptySchema,
    body: peerDeviceMutationSchema
  },
  previewPeerGrant: {
    params: relationshipParamsSchema,
    query: emptySchema,
    body: previewPeerGrantSchema
  },
  proposePeerGrant: {
    params: relationshipParamsSchema,
    query: emptySchema,
    body: proposePeerGrantSchema
  },
  listPeerGrants: {
    params: relationshipParamsSchema,
    query: listPeerGrantsQuerySchema
  },
  acceptPeerGrant: {
    params: grantParamsSchema,
    query: emptySchema,
    body: acceptPeerGrantSchema
  },
  counterPeerGrant: {
    params: grantParamsSchema,
    query: emptySchema,
    body: counterPeerGrantSchema
  },
  revokePeerGrant: {
    params: grantParamsSchema,
    query: emptySchema,
    body: revokePeerGrantSchema
  },
  getPeerSyncStatus: { params: relationshipParamsSchema, query: emptySchema },
  requestPeerResync: {
    params: relationshipParamsSchema,
    query: emptySchema,
    body: requestPeerResyncSchema
  },
  getPeerDiagnostics: {
    params: relationshipParamsSchema,
    query: peerDiagnosticsQuerySchema
  },
  interpretPersonQuestion: {
    params: personParamsSchema,
    query: emptySchema,
    body: personQuestionInterpretSchema
  },
  executePersonQuestion: {
    params: personParamsSchema,
    query: emptySchema,
    body: personQuestionExecuteSchema
  },
  listPersonQuestionHistory: {
    params: personParamsSchema,
    query: personQuestionHistoryQuerySchema
  }
};

export const PEER_API_SCHEMAS = Object.fromEntries(
  Object.entries(PEER_API_REQUEST_SCHEMAS).map(([operationId, request]) => [
    operationId,
    {
      ...request,
      success: PEER_API_SUCCESS_SCHEMAS[operationId as PeerApiOperationId]
    }
  ])
) as Record<PeerApiOperationId, PeerApiSchemaContract>;

export function parsePeerApiSuccess(
  operationId: PeerApiOperationId,
  payload: unknown
) {
  return PEER_API_SUCCESS_SCHEMAS[operationId].schema.parse(payload);
}
