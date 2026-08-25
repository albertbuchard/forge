import { z } from "zod";
import {
  boundedText,
  jsonRecord,
  nonEmptyText,
  noticePeriodSchema,
  opportunityDurationSchema,
  opportunityHoursSchema,
  optionalDate,
  optionalDateTime,
  stringList,
  workActorSchema,
  workBenefitSchema,
  workCompensationShape,
  workLocationSchema,
  workProvenanceSchema
} from "./types.js";

export const roleTargetSchema = z
  .object({
    id: boundedText(240).optional(),
    titleFamily: nonEmptyText(240),
    aliases: stringList(50, 240),
    seniority: boundedText(240).default(""),
    functionName: boundedText(240).default(""),
    domain: boundedText(500).default(""),
    responsibilities: stringList(100, 1_000),
    technologies: stringList(100, 500),
    requiredQualifications: stringList(100, 1_000),
    desiredQualifications: stringList(100, 1_000),
    transferableEvidence: stringList(100, 1_000),
    knownGaps: stringList(100, 1_000),
    evidenceActions: stringList(100, 1_000),
    searchTerms: stringList(100, 500),
    queryFragments: stringList(100, 1_000),
    priority: z.number().int().min(0).max(100).default(50),
    expectedRevision: z.number().int().min(1).optional()
  })
  .strict();

export const organizationTargetSchema = z
  .object({
    id: boundedText(240).optional(),
    organizationId: nonEmptyText(240),
    targetTier: boundedText(100).default("explore"),
    rationale: boundedText(4_000).default(""),
    status: z
      .enum([
        "active",
        "watching",
        "contacting",
        "paused",
        "excluded",
        "completed"
      ])
      .default("active"),
    evidence: z.array(jsonRecord).max(100).default([]),
    warmPaths: z.array(jsonRecord).max(100).default([]),
    exclusions: stringList(100, 1_000),
    priorApplications: z.array(jsonRecord).max(100).default([]),
    nextAction: boundedText(2_000).default(""),
    expectedRevision: z.number().int().min(1).optional()
  })
  .strict();

const approvalStateSchema = z.enum([
  "draft",
  "reviewed",
  "approved",
  "retired"
]);
const applicationSensitivitySchema = z.enum(["normal", "private", "protected"]);
const artifactApprovalStateSchema = z.enum([
  "draft",
  "reviewed",
  "approved",
  "sealed"
]);

export const artifactVersionReferenceSchema = z
  .object({
    artifactId: nonEmptyText(240),
    artifactVersionId: boundedText(240).nullable().default(null),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    artifactType: boundedText(120).default("other"),
    language: boundedText(40).default(""),
    label: boundedText(240).default(""),
    approvalState: artifactApprovalStateSchema.default("reviewed"),
    sealed: z.boolean().default(false),
    confidentiality: z
      .enum(["private", "restricted", "shareable"])
      .default("private")
  })
  .strict();

export const workEvidenceLinkSchema = z
  .object({
    entityType: z.enum([
      "goal",
      "strategy",
      "project",
      "task",
      "person",
      "artifact",
      "note",
      "calendar_event",
      "life_event",
      "insight",
      "trigger_report",
      "habit",
      "movement_place",
      "work_organization",
      "work_engagement",
      "opportunity_campaign",
      "job_opportunity",
      "job_application"
    ]),
    entityId: nonEmptyText(240),
    relationship: boundedText(120).default("supports")
  })
  .strict();

export const positioningEvidenceClaimSchema = z
  .object({
    claim: nonEmptyText(4_000),
    evidenceLinks: z.array(workEvidenceLinkSchema).min(1).max(50),
    reviewState: z.enum(["draft", "reviewed", "approved"]).default("draft")
  })
  .strict();

export const positioningProfileSchema = z
  .object({
    title: nonEmptyText(240),
    headline: boundedText(500).default(""),
    summary: boundedText(20_000).default(""),
    targetRoles: stringList(100, 500),
    evidenceClaims: z
      .array(positioningEvidenceClaimSchema)
      .max(500)
      .default([]),
    skills: stringList(300, 500),
    accomplishments: z
      .array(positioningEvidenceClaimSchema)
      .max(500)
      .default([]),
    languages: z.array(jsonRecord).max(100).default([]),
    publicLinks: z
      .array(
        z
          .object({
            label: boundedText(240).default(""),
            url: z.string().trim().url().max(2_000),
            intentionallyPublic: z.literal(true)
          })
          .strict()
      )
      .max(100)
      .default([]),
    preferredDefaultArtifactId: boundedText(240).nullable().default(null),
    validFrom: optionalDate,
    validUntil: optionalDate,
    approvalState: approvalStateSchema.default("draft"),
    scopeProjectIds: stringList(50, 240),
    scopeTagIds: stringList(100, 240),
    provenance: workProvenanceSchema
  })
  .strict();

export const documentSetSchema = z
  .object({
    profileId: boundedText(240).nullable().default(null),
    title: nonEmptyText(240),
    version: z.number().int().min(1).default(1),
    artifactVersions: z
      .array(artifactVersionReferenceSchema)
      .max(100)
      .default([]),
    targetProfile: jsonRecord,
    approvalState: approvalStateSchema.default("draft"),
    sealed: z.boolean().default(false),
    confidentiality: z
      .enum(["private", "restricted", "shareable"])
      .default("private"),
    retentionPolicy: jsonRecord,
    scopeProjectIds: stringList(50, 240),
    scopeTagIds: stringList(100, 240),
    validFrom: optionalDate,
    validUntil: optionalDate,
    provenance: workProvenanceSchema
  })
  .strict();

export const reusableResponseSchema = z
  .object({
    exactQuestion: nonEmptyText(10_000),
    normalizedCategory: nonEmptyText(240),
    answer: boundedText(50_000).default(""),
    limit: z
      .object({
        kind: z.enum(["characters", "words", "none"]).default("none"),
        maximum: z.number().int().min(1).max(100_000).nullable().default(null)
      })
      .strict()
      .default({}),
    language: nonEmptyText(40).default("en"),
    evidenceLinks: z.array(workEvidenceLinkSchema).max(500).default([]),
    sensitivity: applicationSensitivitySchema.default("normal"),
    reviewState: approvalStateSchema.default("draft"),
    usageHistory: z.array(jsonRecord).max(5_000).default([]),
    scopeProjectIds: stringList(50, 240),
    scopeTagIds: stringList(100, 240),
    provenance: workProvenanceSchema
  })
  .strict();

export const applicationQuestionSchema = z
  .object({
    exactQuestion: nonEmptyText(10_000),
    normalizedCategory: boundedText(240).default(""),
    limit: z
      .object({
        kind: z.enum(["characters", "words", "none"]).default("none"),
        maximum: z.number().int().min(1).max(100_000).nullable().default(null)
      })
      .strict()
      .default({}),
    language: nonEmptyText(40).default("en"),
    sensitivity: applicationSensitivitySchema.default("normal"),
    reusableResponseId: boundedText(240).nullable().default(null),
    approvedAnswer: boundedText(50_000).default(""),
    evidenceLinks: z.array(workEvidenceLinkSchema).max(500).default([]),
    reviewState: z
      .enum(["draft", "reviewed", "approved", "submitted"])
      .default("draft"),
    useHistory: z.array(jsonRecord).max(5_000).default([])
  })
  .strict();

export const artifactUseSchema = z
  .object({
    artifactId: nonEmptyText(240),
    artifactVersionId: boundedText(240).nullable().default(null),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    useKind: z.enum([
      "preparation",
      "review",
      "transmission",
      "verified_submission"
    ]),
    approvalState: artifactApprovalStateSchema.default("draft"),
    usedAt: z.string().datetime({ offset: true }),
    transmissionPreviewId: boundedText(240).nullable().default(null),
    provenance: workProvenanceSchema
  })
  .strict();

export const interviewParticipantSchema = z
  .object({
    personId: nonEmptyText(240),
    role: boundedText(240).default(""),
    label: boundedText(500).default("")
  })
  .strict();

export const interviewQuestionSchema = z
  .object({
    question: nonEmptyText(5_000),
    status: z
      .enum(["planned", "asked", "answered", "skipped"])
      .default("planned"),
    notes: boundedText(10_000).default("")
  })
  .strict();

export const interviewSchema = z
  .object({
    stage: nonEmptyText(120).default("interview"),
    scheduledStartAt: optionalDateTime,
    scheduledEndAt: optionalDateTime,
    timezone: nonEmptyText(120).default("UTC"),
    format: boundedText(120).default("unknown"),
    privateLocationOrLink: boundedText(2_000).default(""),
    participantLinks: z.array(interviewParticipantSchema).max(100).default([]),
    focusAreas: stringList(100, 1_000),
    preparationArtifactId: boundedText(240).nullable().default(null),
    questionBank: z.array(interviewQuestionSchema).max(500).default([]),
    notes: boundedText(50_000).default(""),
    outcome: boundedText(10_000).default(""),
    followUp: boundedText(10_000).default(""),
    nextAction: boundedText(2_000).default("")
  })
  .strict();

export const offerTermsSchema = z
  .object({
    title: boundedText(300).default(""),
    level: boundedText(240).default(""),
    location: workLocationSchema,
    workModel: z
      .enum(["remote", "hybrid", "on_site", "variable", "unknown"])
      .default("unknown"),
    employmentType: boundedText(120).default("unknown"),
    startDate: optionalDate,
    weeklyHours: opportunityHoursSchema,
    duration: opportunityDurationSchema,
    noticeInteraction: noticePeriodSchema.default({}),
    otherTerms: jsonRecord
  })
  .strict();

export const offerCompensationSchema = z
  .object({
    ...workCompensationShape,
    benefits: z.array(workBenefitSchema).max(100).default([])
  })
  .strict()
  .default({});

export const offerSchema = z
  .object({
    status: z
      .enum([
        "expected",
        "received",
        "negotiating",
        "revised",
        "accepted",
        "declined",
        "expired",
        "withdrawn"
      ])
      .default("received"),
    terms: offerTermsSchema.default({}),
    privateCompensation: offerCompensationSchema.default({}),
    contingencies: z.array(jsonRecord).max(200).default([]),
    negotiationAsks: z.array(jsonRecord).max(200).default([]),
    response: boundedText(20_000).default(""),
    artifactIds: stringList(100, 240),
    expiresAt: optionalDateTime,
    decision: boundedText(4_000).default(""),
    rationale: boundedText(10_000).default(""),
    criteriaVersionId: boundedText(240).nullable().default(null),
    plannedEngagementId: boundedText(240).nullable().default(null),
    provenance: workProvenanceSchema
  })
  .strict();

export const searchCostConstraintsSchema = z
  .object({
    billingModel: z
      .enum([
        "free",
        "subscription",
        "per_request",
        "per_result",
        "other",
        "unknown"
      ])
      .default("unknown"),
    maximumPerRun: z.number().finite().min(0).nullable().default(null),
    currency: boundedText(3).nullable().default(null),
    notes: boundedText(2_000).default("")
  })
  .strict()
  .default({});

export const searchRateConstraintsSchema = z
  .object({
    maximumRequests: z
      .number()
      .int()
      .min(1)
      .max(1_000_000)
      .nullable()
      .default(null),
    windowSeconds: z
      .number()
      .int()
      .min(1)
      .max(31_536_000)
      .nullable()
      .default(null),
    notes: boundedText(2_000).default("")
  })
  .strict()
  .default({});

export const searchSourceSchema = z
  .object({
    name: nonEmptyText(240),
    sourceType: z
      .enum([
        "website",
        "job_board",
        "ats",
        "organization_careers",
        "agency",
        "network",
        "feed",
        "manual",
        "other"
      ])
      .default("website"),
    canonicalUrl: boundedText(2_000).default(""),
    reliability: z.number().min(0).max(1).nullable().default(null),
    costConstraints: searchCostConstraintsSchema,
    rateConstraints: searchRateConstraintsSchema,
    enabled: z.boolean().default(true),
    provenance: workProvenanceSchema
  })
  .strict();

export const savedQuerySchema = z
  .object({
    sourceId: boundedText(240).nullable().default(null),
    criteriaVersionId: nonEmptyText(240),
    title: nonEmptyText(240),
    queryText: nonEmptyText(10_000),
    geography: jsonRecord,
    filters: jsonRecord,
    cadence: nonEmptyText(120).default("weekly"),
    freshnessHours: z.number().int().min(1).max(8_760).default(168),
    enabled: z.boolean().default(true)
  })
  .strict();

export const automaticEligibilitySchema = z
  .object({
    enabled: z.boolean().default(false),
    minimumScore: z.number().min(0).max(100).nullable().default(null),
    minimumConfidence: z.number().min(0).max(1).nullable().default(null),
    requireHardGatePass: z.boolean().default(true),
    requireNoUnresolvedFacts: z.boolean().default(true),
    allowedRoleClasses: stringList(100, 500),
    excludedEmployerClasses: stringList(100, 500)
  })
  .strict()
  .default({});

export const compensationGateSchema = z
  .object({
    kind: z.enum([
      "minimum_base",
      "minimum_total",
      "minimum_hourly",
      "minimum_daily",
      "currency",
      "user_confirmation"
    ]),
    operator: z.enum([
      "greater_than_or_equal",
      "equals",
      "known",
      "review_required"
    ]),
    amount: z.number().finite().min(0).nullable().default(null),
    currency: boundedText(3).nullable().default(null),
    period: boundedText(80).nullable().default(null),
    notes: boundedText(2_000).default("")
  })
  .strict();

export const legalAnswerGateSchema = z
  .object({
    category: nonEmptyText(240),
    requirement: z.enum([
      "approved_response_required",
      "user_confirmation_required",
      "never_automate"
    ]),
    notes: boundedText(2_000).default("")
  })
  .strict();

export const automationPolicySchema = z
  .object({
    criteriaVersionId: nonEmptyText(240),
    researchAuthority: z
      .enum(["disabled", "allowed", "review_required"])
      .default("allowed"),
    preparationAuthority: z
      .enum(["disabled", "allowed", "review_required"])
      .default("review_required"),
    uploadAuthority: z
      .enum(["disabled", "allowed", "review_required"])
      .default("review_required"),
    submissionAuthority: z
      .enum(["disabled", "review_required"])
      .default("review_required"),
    reviewRequiredClasses: stringList(100, 500),
    automaticEligibility: automaticEligibilitySchema,
    defaultProfileId: boundedText(240).nullable().default(null),
    defaultDocumentSetId: boundedText(240).nullable().default(null),
    compensationGates: z.array(compensationGateSchema).max(200).default([]),
    legalAnswerGates: z.array(legalAnswerGateSchema).max(200).default([]),
    maximumApplications: z
      .number()
      .int()
      .min(1)
      .max(10_000)
      .nullable()
      .default(null),
    duplicatePrevention: z.boolean().default(true)
  })
  .strict();

export const outreachSchema = z
  .object({
    campaignId: boundedText(240).nullable().default(null),
    organizationId: boundedText(240).nullable().default(null),
    personId: boundedText(240).nullable().default(null),
    proposal: boundedText(10_000).default(""),
    channel: boundedText(120).default(""),
    status: z
      .enum([
        "planned",
        "drafted",
        "ready",
        "sent",
        "replied",
        "follow_up",
        "closed"
      ])
      .default("planned"),
    messageArtifactId: boundedText(240).nullable().default(null),
    sentAt: optionalDateTime,
    followUpAt: optionalDateTime,
    response: boundedText(20_000).default(""),
    nextAction: boundedText(2_000).default(""),
    scopeProjectIds: stringList(50, 240),
    scopeTagIds: stringList(100, 240),
    provenance: workProvenanceSchema
  })
  .strict();

export const searchRunCostSchema = z
  .object({
    amount: z.number().finite().min(0).nullable().default(null),
    currency: boundedText(3).nullable().default(null),
    billingUnit: boundedText(120).default("run"),
    notes: boundedText(2_000).default("")
  })
  .strict()
  .default({});

export const searchRunDataSchema = z
  .object({
    agent: workActorSchema.optional(),
    startedAt: z.string().datetime({ offset: true }).optional(),
    endedAt: optionalDateTime,
    status: z
      .enum(["running", "completed", "partial", "failed", "cancelled"])
      .default("completed"),
    sources: z
      .array(z.union([nonEmptyText(240), jsonRecord]))
      .max(1_000)
      .default([]),
    queries: z
      .array(z.union([nonEmptyText(10_000), jsonRecord]))
      .max(5_000)
      .default([]),
    counts: z
      .object({
        found: z.number().int().min(0).default(0),
        new: z.number().int().min(0).default(0),
        changed: z.number().int().min(0).default(0),
        duplicate: z.number().int().min(0).default(0),
        stale: z.number().int().min(0).default(0),
        closed: z.number().int().min(0).default(0),
        failed: z.number().int().min(0).default(0)
      })
      .strict()
      .default({}),
    failures: z.array(jsonRecord).max(5_000).default([]),
    cost: searchRunCostSchema,
    evidence: z.array(jsonRecord).max(5_000).default([])
  })
  .strict();

export const searchRunItemSchema = z
  .object({
    opportunityId: boundedText(240).nullable().default(null),
    resultKind: z.enum([
      "new",
      "changed",
      "duplicate",
      "stale",
      "closed",
      "failed"
    ]),
    evidence: jsonRecord
  })
  .strict();

export const recordSearchRunSchema = z
  .object({
    campaignId: nonEmptyText(240),
    criteriaVersionId: nonEmptyText(240),
    data: searchRunDataSchema,
    items: z.array(searchRunItemSchema).max(10_000),
    idempotencyKey: nonEmptyText(200)
  })
  .strict();
