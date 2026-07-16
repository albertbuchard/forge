import { z } from "zod";

export const PEER_PROTOCOL_VERSION = "forge-peer/1" as const;

export const PEER_PROJECTION_IDS = [
  "calendar.availability.v1",
  "calendar.selected_events.v1",
  "goals.horizon_summary.v1",
  "health.cycling.aggregate.v1",
  "person.profile.v1",
  "life_events.selected.v1",
  "movement.aggregate.v1",
  "custom.selected_entities.v1"
] as const;

export const peerProjectionIdSchema = z.enum(PEER_PROJECTION_IDS);
export type PeerProjectionId = z.infer<typeof peerProjectionIdSchema>;

export const peerPrincipalClassSchema = z.enum([
  "operator_session",
  "agent_token",
  "companion_session",
  "companion_consent",
  "peer_device",
  "local_service"
]);
export type PeerPrincipalClass = z.infer<typeof peerPrincipalClassSchema>;

export const peerShareDirectionSchema = z.enum([
  "local_to_remote",
  "remote_to_local"
]);
export type PeerShareDirection = z.infer<typeof peerShareDirectionSchema>;

export const peerGrantStatusSchema = z.enum([
  "draft",
  "proposed",
  "active",
  "countered",
  "rejected",
  "revoked",
  "superseded",
  "expired",
  "conflicted"
]);
export type PeerGrantStatus = z.infer<typeof peerGrantStatusSchema>;

export const peerRelationshipStatusSchema = z.enum([
  "pending_verification",
  "active",
  "paused",
  "revoked",
  "recovery_required"
]);

export const peerDeviceStatusSchema = z.enum([
  "pending",
  "approved",
  "removed",
  "revoked",
  "compromised"
]);

export const peerTransportKindSchema = z.enum([
  "local_direct",
  "iroh",
  "tor_onion",
  "http_mailbox"
]);

export const peerTransportPrivacyModeSchema = z.enum([
  "fastest",
  "hide_network_address",
  "custom"
]);
export type PeerTransportPrivacyMode = z.infer<
  typeof peerTransportPrivacyModeSchema
>;

export const peerSensitivitySchema = z.enum([
  "basic",
  "private",
  "sensitive",
  "restricted"
]);

export const peerFieldPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(
    /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/,
    "Shared fields must use a structured dotted field path."
  );

export const peerCachePolicySchema = z
  .object({
    mode: z.enum(["none", "until_expiry", "until_revoked", "duration"]),
    maximumRetentionSeconds: z.number().int().min(0).max(31_536_000),
    purgeOnRevocation: z.boolean().default(true)
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.mode === "none" && policy.maximumRetentionSeconds !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A no-cache policy must have zero retention.",
        path: ["maximumRetentionSeconds"]
      });
    }
    if (policy.mode === "duration" && policy.maximumRetentionSeconds === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A duration cache policy requires positive retention.",
        path: ["maximumRetentionSeconds"]
      });
    }
  });

export const peerEntitySelectorSchema = z
  .object({
    mode: z.enum(["all_shareable", "selected"]),
    entityType: z.string().trim().min(1).max(80).optional(),
    entityIds: z.array(z.string().trim().min(1).max(240)).max(5_000).default([])
  })
  .strict()
  .superRefine((selector, context) => {
    if (selector.mode === "selected" && selector.entityIds.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Selected entity rules require at least one entity id.",
        path: ["entityIds"]
      });
    }
    if (selector.mode === "selected" && selector.entityType === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Selected entity rules require an entity type.",
        path: ["entityType"]
      });
    }
    if (selector.mode === "all_shareable" && selector.entityIds.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "All-shareable selectors cannot also list entity ids.",
        path: ["entityIds"]
      });
    }
    if (new Set(selector.entityIds).size !== selector.entityIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Entity selectors cannot contain duplicate ids.",
        path: ["entityIds"]
      });
    }
  });

export const peerFieldPolicySchema = z
  .object({
    include: z.array(peerFieldPathSchema).max(256).default([]),
    exclude: z.array(peerFieldPathSchema).max(256).default([])
  })
  .strict()
  .superRefine((policy, context) => {
    if (new Set(policy.include).size !== policy.include.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Included fields cannot contain duplicates.",
        path: ["include"]
      });
    }
    if (new Set(policy.exclude).size !== policy.exclude.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Excluded fields cannot contain duplicates.",
        path: ["exclude"]
      });
    }
    const included = new Set(policy.include);
    for (const field of policy.exclude) {
      if (included.has(field)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Field ${field} cannot be both included and excluded.`,
          path: ["exclude"]
        });
      }
    }
  });

export const peerTimePolicySchema = z
  .object({
    startsAt: z.string().datetime({ offset: true }).nullable().default(null),
    endsAt: z.string().datetime({ offset: true }).nullable().default(null),
    rollingPastDays: z
      .number()
      .int()
      .min(0)
      .max(3_650)
      .nullable()
      .default(null),
    rollingFutureDays: z
      .number()
      .int()
      .min(0)
      .max(3_650)
      .nullable()
      .default(null)
  })
  .strict()
  .superRefine((policy, context) => {
    if (
      policy.startsAt !== null &&
      policy.endsAt !== null &&
      Date.parse(policy.startsAt) >= Date.parse(policy.endsAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The time policy end must be after its start.",
        path: ["endsAt"]
      });
    }
  });

export const peerAggregationPolicySchema = z
  .object({
    minimumRecords: z.number().int().min(1).max(10_000).default(3),
    granularity: z.enum(["day", "week", "month", "quarter"]).default("week"),
    privacyBudget: z.number().min(0).max(10_000).default(30),
    maximumQueriesPerDay: z.number().int().min(1).max(10_000).default(30)
  })
  .strict();

export const peerShareRuleSchema = z
  .object({
    id: z.string().trim().min(1).max(240),
    effect: z.enum(["allow", "deny"]),
    projectionId: peerProjectionIdSchema,
    entitySelector: peerEntitySelectorSchema.nullable().default(null),
    fields: peerFieldPolicySchema,
    time: peerTimePolicySchema,
    precision: z.string().trim().min(1).max(80),
    aggregation: peerAggregationPolicySchema.nullable().default(null),
    approvedDeviceIds: z
      .array(z.string().trim().min(1).max(240))
      .max(128)
      .default([]),
    devicePolicy: z
      .enum(["explicit", "approved_current_devices"])
      .default("explicit"),
    maximumResultCount: z.number().int().min(1).max(10_000).default(100),
    maximumPayloadBytes: z
      .number()
      .int()
      .min(256)
      .max(10_485_760)
      .default(262_144)
  })
  .strict()
  .superRefine((rule, context) => {
    if (
      rule.effect === "allow" &&
      rule.devicePolicy === "explicit" &&
      rule.approvedDeviceIds.length === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Allow rules with explicit device policy require an approved device.",
        path: ["approvedDeviceIds"]
      });
    }
    if (
      new Set(rule.approvedDeviceIds).size !== rule.approvedDeviceIds.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Approved device ids cannot contain duplicates.",
        path: ["approvedDeviceIds"]
      });
    }
  });
export type PeerShareRule = z.infer<typeof peerShareRuleSchema>;

export const peerGrantSignerSchema = z
  .object({
    deviceId: z.string().trim().min(1).max(240),
    party: z.enum(["grantor", "grantee"]),
    algorithm: z.literal("ed25519"),
    signedAt: z.string().datetime({ offset: true })
  })
  .strict();
export type PeerGrantSigner = z.infer<typeof peerGrantSignerSchema>;

export const peerGrantSignatureSchema = peerGrantSignerSchema
  .extend({
    signature: z.string().regex(/^[A-Za-z0-9_-]{64,256}$/)
  })
  .strict();
export type PeerGrantSignature = z.infer<typeof peerGrantSignatureSchema>;

export const peerShareGrantVersionSchema = z
  .object({
    id: z.string().trim().min(1).max(240),
    ownerUserId: z.string().trim().min(1).max(240),
    relationshipId: z.string().trim().min(1).max(240),
    direction: peerShareDirectionSchema,
    sequence: z.number().int().positive(),
    previousVersionHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    status: peerGrantStatusSchema,
    label: z.string().trim().min(1).max(160),
    purpose: z.string().trim().max(2_000).default(""),
    issuedAt: z.string().datetime({ offset: true }),
    effectiveAt: z.string().datetime({ offset: true }).nullable().default(null),
    expiresAt: z.string().datetime({ offset: true }).nullable().default(null),
    revokedAt: z.string().datetime({ offset: true }).nullable().default(null),
    cachePolicy: peerCachePolicySchema,
    rules: z.array(peerShareRuleSchema).min(1).max(256),
    signatures: z.array(peerGrantSignatureSchema).max(16).default([]),
    protocolVersion: z.literal(PEER_PROTOCOL_VERSION),
    schemaVersion: z.literal(1)
  })
  .strict()
  .superRefine((grant, context) => {
    if (grant.sequence === 1 && grant.previousVersionHash !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The first grant version cannot have a previous hash.",
        path: ["previousVersionHash"]
      });
    }
    if (grant.sequence > 1 && grant.previousVersionHash === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Later grant versions require the previous version hash.",
        path: ["previousVersionHash"]
      });
    }
    if (
      grant.expiresAt !== null &&
      Date.parse(grant.expiresAt) <= Date.parse(grant.issuedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A grant must expire after it is issued.",
        path: ["expiresAt"]
      });
    }
    if (
      grant.effectiveAt !== null &&
      Date.parse(grant.effectiveAt) < Date.parse(grant.issuedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A grant cannot become effective before it is issued.",
        path: ["effectiveAt"]
      });
    }
    if (
      grant.effectiveAt !== null &&
      grant.expiresAt !== null &&
      Date.parse(grant.effectiveAt) >= Date.parse(grant.expiresAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A grant must expire after it becomes effective.",
        path: ["expiresAt"]
      });
    }
    if (grant.status === "active" && grant.revokedAt !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An active grant cannot have a revocation timestamp.",
        path: ["revokedAt"]
      });
    }
    if (grant.status === "revoked" && grant.revokedAt === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A revoked grant requires a revocation timestamp.",
        path: ["revokedAt"]
      });
    }
    const ruleIds = grant.rules.map((rule) => rule.id);
    if (new Set(ruleIds).size !== ruleIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Grant rule ids must be unique within a version.",
        path: ["rules"]
      });
    }
    const signerDeviceIds = grant.signatures.map(
      (signature) => signature.deviceId
    );
    if (new Set(signerDeviceIds).size !== signerDeviceIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A device can sign a grant version only once.",
        path: ["signatures"]
      });
    }
    const signerParties = new Set(
      grant.signatures.map((signature) => signature.party)
    );
    if (
      grant.status === "active" &&
      (!signerParties.has("grantor") || !signerParties.has("grantee"))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "An active grant requires verified signatures from both parties.",
        path: ["signatures"]
      });
    }
    for (const [index, signature] of grant.signatures.entries()) {
      if (Date.parse(signature.signedAt) < Date.parse(grant.issuedAt)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A grant signature cannot predate the grant version.",
          path: ["signatures", index, "signedAt"]
        });
      }
    }
  });
export type PeerShareGrantVersion = z.infer<typeof peerShareGrantVersionSchema>;

export const peerActorContextSchema = z
  .object({
    principalClass: peerPrincipalClassSchema,
    ownerUserId: z.string().trim().min(1).max(240),
    principalId: z.string().trim().min(1).max(240),
    deviceId: z.string().trim().min(1).max(240).nullable().default(null),
    scopes: z.array(z.string().trim().min(1).max(160)).max(256).default([]),
    authenticatedAt: z.string().datetime({ offset: true }),
    userPresenceAt: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .default(null)
  })
  .strict();
export type PeerActorContext = z.infer<typeof peerActorContextSchema>;

export const peerQuerySourceSchema = z
  .object({
    principalId: z.string().trim().min(1).max(240),
    deviceId: z.string().trim().min(1).max(240),
    relationshipId: z.string().trim().min(1).max(240)
  })
  .strict();

export const peerProjectionResponseMetadataSchema = z
  .object({
    source: peerQuerySourceSchema,
    projectionId: peerProjectionIdSchema,
    projectionVersion: z.literal(1),
    grantId: z.string().trim().min(1).max(240),
    grantSequence: z.number().int().positive(),
    asOf: z.string().datetime({ offset: true }),
    receivedAt: z.string().datetime({ offset: true }),
    validUntil: z.string().datetime({ offset: true }).nullable(),
    completeness: z.number().min(0).max(1),
    precision: z.string().trim().min(1).max(80),
    redactedFields: z.array(z.string().trim().min(1).max(120)).max(256),
    state: z.enum(["live", "cached", "stale", "revoked", "unavailable"])
  })
  .strict();

export type PeerProjectionResponseMetadata = z.infer<
  typeof peerProjectionResponseMetadataSchema
>;

export const peerPairingInviteSchema = z
  .object({
    id: z.string().trim().min(1).max(240),
    ownerUserId: z.string().trim().min(1).max(240),
    inviterPrincipalId: z.string().trim().min(1).max(240),
    inviterDeviceId: z.string().trim().min(1).max(240),
    fingerprint: z.string().regex(/^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3,7}$/),
    expiresAt: z.string().datetime({ offset: true }),
    protocolVersion: z.literal(PEER_PROTOCOL_VERSION),
    transportKinds: z.array(peerTransportKindSchema).min(1).max(4),
    bootstrap: z.string().regex(/^[A-Za-z0-9_-]{32,1024}$/),
    signature: z.string().regex(/^[A-Za-z0-9_-]{64,256}$/)
  })
  .strict();

export type PeerPairingInvite = z.infer<typeof peerPairingInviteSchema>;
