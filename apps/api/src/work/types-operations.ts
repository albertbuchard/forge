import { z } from "zod";
import {
  WORK_LIST_MAX,
  boundedText,
  createCriteriaVersionSchema,
  createJobApplicationSchema,
  createOpportunityCampaignSchema,
  createWorkEngagementSchema,
  createWorkOrganizationSchema,
  jobApplicationStatusSchema,
  jsonRecord,
  nonEmptyText,
  optionalDate,
  optionalDateTime,
  queryBoolean,
  stringList,
  upsertJobOpportunitySchema,
  workActorSchema,
  workEntityTypeSchema,
  workLinkTargetTypeSchema,
  workProvenanceSchema
} from "./types.js";
import {
  artifactVersionReferenceSchema,
  organizationTargetSchema,
  roleTargetSchema
} from "./types-supporting.js";

export const builtInWorkMetricKeys = [
  "overall_satisfaction",
  "creativity",
  "financial_satisfaction",
  "financial_adequacy",
  "growth_advancement",
  "learning_skill_development",
  "autonomy_decision_authority",
  "meaning_purpose_impact",
  "workload_sustainability",
  "stress_burnout_risk",
  "work_life_balance",
  "flexibility_time_control",
  "job_security_stability",
  "manager_relationship",
  "team_relationship",
  "recognition_fairness",
  "values_mission_alignment",
  "professional_environment_quality",
  "ownership_ability_to_build",
  "energy_before_work",
  "energy_during_work",
  "energy_after_work",
  "future_excitement"
] as const;

export const workMetricDefinitionSchema = z
  .object({
    canonicalKey: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,119}$/u),
    displayName: nonEmptyText(160),
    description: boundedText(2_000).default(""),
    valueKind: z.enum(["ordinal", "numeric", "categorical"]).default("ordinal"),
    scale: jsonRecord,
    target: jsonRecord,
    warning: jsonRecord,
    reviewCadence: boundedText(120).default("monthly"),
    enabled: z.boolean().default(true),
    expectedRevision: z.number().int().min(1).optional(),
    provenance: workProvenanceSchema
  })
  .strict();

export const workObservationInputSchema = z
  .object({
    metricDefinitionId: nonEmptyText(240),
    numericValue: z.number().finite().nullable().default(null),
    categoricalValue: boundedText(500).nullable().default(null),
    missingState: z
      .enum(["observed", "unknown", "skipped", "not_applicable"])
      .default("observed"),
    confidence: z.number().min(0).max(1).nullable().default(null),
    note: boundedText(2_000).default(""),
    tags: stringList(50, 240),
    context: jsonRecord
  })
  .strict()
  .superRefine((value, context) => {
    const observedValues =
      Number(value.numericValue !== null) +
      Number(value.categoricalValue !== null);
    if (value.missingState === "observed" && observedValues !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "An observed metric requires exactly one numeric or categorical value."
      });
    }
    if (value.missingState !== "observed" && observedValues !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A missing metric cannot include a value."
      });
    }
  });

export const createWorkCheckInSchema = z
  .object({
    engagementId: nonEmptyText(240),
    observedAt: z.string().datetime({ offset: true }).optional(),
    timezone: nonEmptyText(120),
    note: boundedText(10_000).default(""),
    tags: stringList(50, 240),
    context: jsonRecord,
    sourceKind: z
      .enum(["user_entered", "imported", "agent_suggested"])
      .default("user_entered"),
    confirmationState: z
      .enum(["suggested", "confirmed", "rejected"])
      .default("confirmed"),
    userConfirmation: z
      .object({
        userId: nonEmptyText(240),
        confirmedAt: z.string().datetime({ offset: true }),
        method: z.enum([
          "forge_ui",
          "voice",
          "message",
          "import_review",
          "other"
        ]),
        evidenceArtifactId: boundedText(240).nullable().default(null),
        note: boundedText(2_000).default("")
      })
      .strict()
      .nullable()
      .default(null),
    observations: z.array(workObservationInputSchema).min(1).max(100),
    provenance: workProvenanceSchema,
    idempotencyKey: nonEmptyText(200)
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.sourceKind === "agent_suggested" &&
      value.confirmationState === "confirmed" &&
      !value.userConfirmation
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["userConfirmation"],
        message:
          "A confirmed agent suggestion requires explicit user-confirmation evidence."
      });
    }
    if (value.confirmationState !== "confirmed" && value.userConfirmation) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["userConfirmation"],
        message:
          "User-confirmation evidence is valid only for a confirmed check-in."
      });
    }
  });

export const workListQuerySchema = z
  .object({
    status: boundedText(120).optional(),
    campaignId: boundedText(240).optional(),
    employer: boundedText(240).optional(),
    location: boundedText(240).optional(),
    workModel: boundedText(120).optional(),
    hardGate: boundedText(120).optional(),
    minimumScore: z.coerce.number().min(0).max(100).optional(),
    minimumCompensation: z.coerce.number().min(0).optional(),
    compensationCurrency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/u)
      .optional(),
    deadlineBefore: optionalDate,
    hasNextAction: queryBoolean.optional(),
    missingInformation: queryBoolean.optional(),
    stale: queryBoolean.optional(),
    archived: z.enum(["exclude", "include", "only"]).default("exclude"),
    query: boundedText(500).optional(),
    sort: z
      .enum([
        "updated_desc",
        "created_desc",
        "deadline_asc",
        "priority_desc",
        "score_desc"
      ])
      .default("updated_desc"),
    limit: z.coerce.number().int().min(1).max(WORK_LIST_MAX).default(25),
    offset: z.coerce.number().int().min(0).default(0)
  })
  .strict();

export const workLinkSchema = z
  .object({
    targetEntityType: workLinkTargetTypeSchema,
    targetEntityId: nonEmptyText(240),
    relationship: nonEmptyText(120).default("related"),
    anchorKey: boundedText(240).default("")
  })
  .strict();

export const replaceWorkLinksSchema = z
  .object({
    expectedRevision: z.number().int().min(1).optional(),
    links: z.array(workLinkSchema).max(500)
  })
  .strict();

export const transmissionPreviewSchema = z
  .object({
    applicationId: nonEmptyText(240),
    destination: z
      .object({
        name: nonEmptyText(500),
        url: z.string().trim().url().max(2_000),
        channel: z
          .enum([
            "web_portal",
            "email",
            "recruiter",
            "referral",
            "api",
            "other"
          ])
          .default("web_portal")
      })
      .strict(),
    fields: jsonRecord,
    answers: z
      .array(
        z
          .object({
            questionId: nonEmptyText(240),
            exactQuestion: nonEmptyText(10_000),
            answer: nonEmptyText(50_000)
          })
          .strict()
      )
      .max(200)
      .default([]),
    artifactVersions: z
      .array(artifactVersionReferenceSchema)
      .max(100)
      .default([]),
    representations: jsonRecord,
    unresolvedGates: z
      .array(
        z
          .object({
            kind: boundedText(160).default("caller_reported"),
            label: nonEmptyText(2_000),
            source: boundedText(240).default("caller")
          })
          .strict()
      )
      .max(100)
      .default([]),
    expiresInMinutes: z.number().int().min(5).max(1_440).default(60),
    idempotencyKey: nonEmptyText(200)
  })
  .strict();

export const verifiedSubmissionSchema = z
  .object({
    authorizationIdentity: nonEmptyText(240),
    previewDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    evidenceArtifactId: boundedText(240).nullable().default(null),
    confirmationReceipt: boundedText(4_000).default(""),
    trackingIdentifier: boundedText(2_000).default(""),
    factualDescription: nonEmptyText(10_000),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    idempotencyKey: nonEmptyText(200)
  })
  .strict()
  .refine(
    (value) =>
      Boolean(
        value.evidenceArtifactId ||
        value.confirmationReceipt ||
        value.trackingIdentifier
      ),
    {
      message:
        "Verified submission requires a receipt/tracking identifier or an evidence Artifact."
    }
  );

export const genericWorkRecordSchema = z
  .object({
    id: boundedText(240).optional(),
    expectedRevision: z.number().int().min(1).optional(),
    data: jsonRecord,
    idempotencyKey: boundedText(200).optional()
  })
  .strict();

export const workImportManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    source: z
      .object({
        label: nonEmptyText(240),
        digest: z.string().regex(/^[a-f0-9]{64}$/u),
        observedAt: z.string().datetime({ offset: true })
      })
      .strict(),
    ownerUserId: nonEmptyText(240),
    lookingForOpportunities: z.boolean().optional(),
    organizations: z.array(createWorkOrganizationSchema).max(1_000).default([]),
    engagements: z.array(createWorkEngagementSchema).max(1_000).default([]),
    campaigns: z.array(createOpportunityCampaignSchema).max(1_000).default([]),
    criteriaVersions: z
      .array(
        z
          .object({
            ref: nonEmptyText(240),
            campaignRef: nonEmptyText(240),
            value: createCriteriaVersionSchema
          })
          .strict()
      )
      .max(5_000)
      .default([]),
    roleTargets: z
      .array(
        z
          .object({ campaignRef: nonEmptyText(240), value: roleTargetSchema })
          .strict()
      )
      .max(5_000)
      .default([]),
    organizationTargets: z
      .array(
        z
          .object({
            campaignRef: nonEmptyText(240),
            value: organizationTargetSchema
          })
          .strict()
      )
      .max(5_000)
      .default([]),
    opportunities: z.array(upsertJobOpportunitySchema).max(20_000).default([]),
    applications: z.array(createJobApplicationSchema).max(20_000).default([]),
    applicationEvents: z
      .array(
        z
          .object({
            applicationRef: nonEmptyText(240),
            eventType: nonEmptyText(120),
            priorStatus: jobApplicationStatusSchema.nullable().default(null),
            newStatus: jobApplicationStatusSchema.nullable().default(null),
            occurredAt: z.string().datetime({ offset: true }),
            actor: workActorSchema,
            sourceArtifactId: boundedText(240).nullable().default(null),
            factualDescription: boundedText(10_000).default(""),
            outcome: boundedText(4_000).default(""),
            nextAction: boundedText(2_000).default(""),
            dueAt: optionalDateTime,
            confidence: z.number().min(0).max(1).nullable().default(null),
            provenance: workProvenanceSchema
          })
          .strict()
      )
      .max(50_000)
      .default([]),
    links: z
      .array(
        z
          .object({
            sourceType: workEntityTypeSchema,
            sourceRef: nonEmptyText(240),
            link: workLinkSchema
          })
          .strict()
      )
      .max(50_000)
      .default([]),
    artifactReferences: z
      .array(
        z
          .object({
            ref: nonEmptyText(240),
            artifactId: nonEmptyText(240),
            artifactVersionId: boundedText(240).nullable().default(null),
            contentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
            applicationRef: boundedText(240).nullable().default(null),
            useKind: z
              .enum([
                "preparation",
                "review",
                "transmission",
                "verified_submission"
              ])
              .default("preparation"),
            approvalState: z
              .enum(["draft", "reviewed", "approved", "sealed"])
              .default("reviewed"),
            usedAt: z.string().datetime({ offset: true }).optional(),
            provenance: workProvenanceSchema
          })
          .strict()
      )
      .max(20_000)
      .default([])
  })
  .strict();

export type CreateWorkCheckInInput = z.infer<typeof createWorkCheckInSchema>;
export type WorkListQuery = z.infer<typeof workListQuerySchema>;
export type WorkImportManifest = z.infer<typeof workImportManifestSchema>;
