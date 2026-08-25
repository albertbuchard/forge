import { z } from "zod";

export const WORK_LIST_MAX = 50;
export const WORK_CONTEXT_NESTED_MAX = 25;
export const WORK_CONTEXT_MAX_BYTES = 256 * 1024;

export const boundedText = (max = 4_000) => z.string().trim().max(max);
export const nonEmptyText = (max = 240) => z.string().trim().min(1).max(max);
export const stringList = (max = 100, itemMax = 500) =>
  z.array(z.string().trim().min(1).max(itemMax)).max(max).default([]);
export const jsonRecord = z.record(z.string(), z.unknown()).default({});
export const optionalDate = z.string().date().nullable().optional();
export const optionalDateTime = z
  .string()
  .datetime({ offset: true })
  .nullable()
  .optional();
export const queryBoolean = z.union([
  z.boolean(),
  z.enum(["true", "false"]).transform((value) => value === "true")
]);

export const workEntityTypes = [
  "work_organization",
  "work_engagement",
  "work_metric_observation",
  "opportunity_campaign",
  "job_opportunity",
  "job_application",
  "job_interview",
  "job_offer",
  "work_outreach"
] as const;

export const workEntityTypeSchema = z.enum(workEntityTypes);

export const workLinkTargetTypes = [
  ...workEntityTypes,
  "goal",
  "strategy",
  "project",
  "issue",
  "task",
  "subtask",
  "person",
  "artifact",
  "note",
  "wiki_page",
  "calendar_event",
  "life_event",
  "insight",
  "psyche_value",
  "sleep_session",
  "workout_session",
  "trigger_report",
  "habit",
  "movement_place",
  "tag"
] as const;

export const workLinkTargetTypeSchema = z.enum(workLinkTargetTypes);

export const workScopeSchema = z
  .object({
    projectIds: stringList(50, 240),
    tagIds: stringList(100, 240)
  })
  .strict()
  .default({ projectIds: [], tagIds: [] });

export const workProvenanceSchema = z
  .object({
    sourceKind: z
      .enum(["user", "agent", "import", "external_source", "system"])
      .default("user"),
    sourceLabel: boundedText(240).default(""),
    sourceUrl: boundedText(2_000).default(""),
    sourceArtifactId: boundedText(240).default(""),
    observedAt: optionalDateTime,
    actorId: boundedText(240).default(""),
    confidence: z.number().min(0).max(1).nullable().default(null),
    evidence: z.array(jsonRecord).max(100).default([])
  })
  .strict()
  .default({});

export const workActorSchema = z
  .object({
    kind: z.enum(["human_user", "agent", "system"]),
    id: nonEmptyText(240),
    label: boundedText(240).default(""),
    source: z.enum(["ui", "agent", "openclaw", "system"])
  })
  .strict();

export const moneySchema = z
  .object({
    amount: z.number().finite().nullable().default(null),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/u)
      .nullable()
      .default(null),
    basis: z.enum(["gross", "net", "unknown"]).default("unknown"),
    period: z
      .enum(["hour", "day", "week", "month", "year", "one_time", "unknown"])
      .default("unknown"),
    negotiable: z.boolean().nullable().default(null),
    unknown: z.boolean().default(false)
  })
  .strict();

export const noticePeriodSchema = z
  .object({
    value: z.number().int().min(0).max(1_000).nullable().default(null),
    unit: z.enum(["days", "weeks", "months"]).nullable().default(null),
    negotiable: z.boolean().nullable().default(null),
    conditions: boundedText(2_000).default(""),
    unknown: z.boolean().default(false)
  })
  .strict();

export const workWorkloadSchema = z
  .object({
    contractedWeeklyHours: z
      .number()
      .finite()
      .min(0)
      .max(168)
      .nullable()
      .default(null),
    actualWeeklyHours: z
      .number()
      .finite()
      .min(0)
      .max(168)
      .nullable()
      .default(null),
    fullTimeEquivalent: z
      .number()
      .finite()
      .min(0)
      .max(5)
      .nullable()
      .default(null),
    unknown: z.boolean().default(false)
  })
  .strict()
  .default({});

export const workScheduleSchema = z
  .object({
    summary: boundedText(4_000).default(""),
    shifts: stringList(100, 500),
    workingDays: z
      .array(
        z.enum([
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
          "sunday"
        ])
      )
      .max(7)
      .default([]),
    timezone: boundedText(120).default(""),
    officeDaysPerWeek: z
      .number()
      .finite()
      .min(0)
      .max(7)
      .nullable()
      .default(null),
    travelPercent: z.number().finite().min(0).max(100).nullable().default(null),
    onCallResponsibility: boundedText(4_000).default(""),
    flexibility: boundedText(4_000).default(""),
    unknown: z.boolean().default(false)
  })
  .strict()
  .default({});

export const workLocationSchema = z
  .object({
    label: boundedText(500).default(""),
    country: boundedText(160).default(""),
    region: boundedText(240).default(""),
    city: boundedText(240).default(""),
    commuteMinutesEachWay: z
      .number()
      .finite()
      .min(0)
      .max(1_440)
      .nullable()
      .default(null),
    unknown: z.boolean().default(false)
  })
  .strict()
  .default({});

export const workCompensationComponentSchema = z
  .object({
    description: boundedText(4_000).default(""),
    unknown: z.boolean().default(false)
  })
  .strict()
  .default({});

export const workBenefitSchema = z
  .object({
    type: z.enum([
      "paid_leave",
      "health_coverage",
      "pension",
      "parental_leave",
      "learning_budget",
      "education_budget",
      "conference_access",
      "protected_research_time",
      "equipment",
      "flexible_hours",
      "sabbatical",
      "wellness",
      "other"
    ]),
    label: boundedText(500).default(""),
    description: boundedText(4_000).default(""),
    amount: z.number().finite().min(0).nullable().default(null),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/u)
      .nullable()
      .default(null),
    period: z
      .enum(["day", "week", "month", "year", "one_time", "unknown"])
      .default("unknown"),
    days: z.number().finite().min(0).nullable().default(null),
    unknown: z.boolean().default(false)
  })
  .strict();

export const workCompensationShape = {
  base: moneySchema.nullable().default(null),
  total: moneySchema.nullable().default(null),
  hourlyRate: moneySchema.nullable().default(null),
  dailyRate: moneySchema.nullable().default(null),
  bonus: workCompensationComponentSchema,
  commission: workCompensationComponentSchema,
  equity: workCompensationComponentSchema,
  pension: workCompensationComponentSchema,
  other: jsonRecord
};

export const workCompensationSchema = z
  .object(workCompensationShape)
  .strict()
  .default({});

export const opportunityHoursSchema = z
  .object({
    minimum: z.number().finite().min(0).max(168).nullable().default(null),
    maximum: z.number().finite().min(0).max(168).nullable().default(null),
    value: z.number().finite().min(0).max(168).nullable().default(null),
    unknown: z.boolean().default(false)
  })
  .strict()
  .default({});

export const opportunityDurationSchema = z
  .object({
    value: z.number().finite().min(0).nullable().default(null),
    unit: z.enum(["days", "weeks", "months", "years"]).nullable().default(null),
    description: boundedText(2_000).default(""),
    fixedTerm: z.boolean().nullable().default(null),
    endDate: optionalDate,
    unknown: z.boolean().default(false)
  })
  .strict()
  .default({});

export const opportunityTravelSchema = z
  .object({
    percent: z.number().finite().min(0).max(100).nullable().default(null),
    ceilingPercent: z
      .number()
      .finite()
      .min(0)
      .max(100)
      .nullable()
      .default(null),
    frequency: boundedText(240).default(""),
    description: boundedText(2_000).default(""),
    unknown: z.boolean().default(false)
  })
  .strict()
  .default({});

export const opportunitySponsorshipSchema = z
  .object({
    needed: z.boolean().nullable().default(null),
    available: z.boolean().nullable().default(null),
    acceptable: z.boolean().nullable().default(null),
    status: boundedText(240).default(""),
    description: boundedText(2_000).default(""),
    unknown: z.boolean().default(false)
  })
  .strict()
  .default({});

export const applicationRouteSchema = z
  .object({
    name: boundedText(500).default(""),
    url: z.string().trim().url().max(2_000).nullable().default(null),
    channel: z
      .enum([
        "web_portal",
        "email",
        "recruiter",
        "referral",
        "api",
        "other",
        "unknown"
      ])
      .default("unknown"),
    instructions: boundedText(4_000).default("")
  })
  .strict()
  .default({});

export const workRoleFactsSchema = z
  .object({
    seniority: boundedText(120).default(""),
    roleFamily: boundedText(240).default(""),
    teamName: boundedText(240).default(""),
    managerRole: boundedText(240).default(""),
    directReportCount: z
      .number()
      .int()
      .min(0)
      .max(10_000)
      .nullable()
      .default(null),
    decisionAuthority: stringList(100, 1_000),
    ownershipAreas: stringList(100, 1_000),
    domains: stringList(100, 500),
    technologies: stringList(200, 500),
    skillsUsed: stringList(200, 500),
    skillsDeveloping: stringList(200, 500),
    clinicalExposure: boundedText(2_000).default(""),
    customerExposure: boundedText(2_000).default(""),
    researchFreedom: boundedText(2_000).default(""),
    publicationRights: boundedText(2_000).default(""),
    openSourceRights: boundedText(2_000).default(""),
    deliverables: stringList(200, 1_000)
  })
  .strict()
  .default({});

export const workEngagementStatusSchema = z.enum([
  "planned",
  "current",
  "on_leave",
  "transitioning",
  "ended",
  "archived"
]);

export const workEngagementTypeSchema = z.enum([
  "employment",
  "appointment",
  "contract",
  "freelance",
  "fractional",
  "shift",
  "self_employment",
  "advisory",
  "internship",
  "seasonal",
  "other"
]);

export const createWorkOrganizationSchema = z
  .object({
    id: boundedText(240).optional(),
    name: nonEmptyText(240),
    aliases: stringList(50, 240),
    domain: boundedText(240).default(""),
    websiteUrl: boundedText(2_000).default(""),
    location: workLocationSchema,
    organizationFacts: jsonRecord,
    status: z
      .enum(["active", "target", "excluded", "past", "archived"])
      .default("active"),
    description: boundedText(10_000).default(""),
    visibility: z.enum(["private", "shared"]).default("private"),
    scope: workScopeSchema,
    provenance: workProvenanceSchema
  })
  .strict();

export const updateWorkOrganizationSchema = createWorkOrganizationSchema
  .omit({ id: true })
  .partial()
  .extend({ expectedRevision: z.number().int().min(1) })
  .strict();

export const createWorkEngagementSchema = z
  .object({
    id: boundedText(240).optional(),
    organizationId: boundedText(240).nullable().default(null),
    title: nonEmptyText(240),
    roleFunction: boundedText(500).default(""),
    description: boundedText(20_000).default(""),
    status: workEngagementStatusSchema.default("planned"),
    priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
    engagementType: workEngagementTypeSchema.default("employment"),
    startDate: optionalDate,
    expectedEndDate: optionalDate,
    actualEndDate: optionalDate,
    probationEndDate: optionalDate,
    renewalDate: optionalDate,
    contractDeadline: optionalDate,
    noticePeriod: noticePeriodSchema.default({}),
    earliestDepartureDate: optionalDate,
    workload: workWorkloadSchema,
    schedule: workScheduleSchema,
    location: workLocationSchema,
    workModel: z
      .enum(["remote", "hybrid", "on_site", "variable", "unknown"])
      .default("unknown"),
    roleFacts: workRoleFactsSchema,
    responsibilities: stringList(200, 1_000),
    successCriteria: stringList(100, 1_000),
    compensation: workCompensationSchema,
    benefits: z.array(workBenefitSchema).max(100).default([]),
    purpose: boundedText(10_000).default(""),
    desiredOutcomes: stringList(100, 1_000),
    risks: stringList(100, 1_000),
    constraints: stringList(100, 1_000),
    transitionIntentions: boundedText(10_000).default(""),
    exitReason: boundedText(4_000).default(""),
    exitOutcome: boundedText(4_000).default(""),
    nextAction: boundedText(2_000).default(""),
    visibility: z.enum(["private", "shared"]).default("private"),
    scope: workScopeSchema,
    provenance: workProvenanceSchema
  })
  .strict();

export const updateWorkEngagementSchema = createWorkEngagementSchema
  .omit({ id: true })
  .partial()
  .extend({ expectedRevision: z.number().int().min(1) })
  .strict();

export const opportunityCampaignStatusSchema = z.enum([
  "draft",
  "planned",
  "active",
  "paused",
  "completed",
  "abandoned",
  "archived"
]);

export const campaignCriterionSchema = z
  .object({
    key: nonEmptyText(160),
    section: z.enum([
      "role",
      "responsibilities",
      "work_balance",
      "workload",
      "schedule",
      "geography",
      "authorization",
      "availability",
      "compensation",
      "benefits",
      "organization",
      "growth",
      "tradeoffs",
      "keywords",
      "evidence",
      "uncertainty",
      "custom"
    ]),
    field: nonEmptyText(240),
    kind: z.enum([
      "boolean",
      "number",
      "money",
      "duration",
      "text",
      "set",
      "range",
      "location",
      "unknown"
    ]),
    importance: z.enum(["hard", "soft"]),
    weight: z.number().min(0).max(100).default(50),
    operator: z.enum([
      "eq",
      "neq",
      "in",
      "not_in",
      "gte",
      "lte",
      "between",
      "contains",
      "excludes",
      "known",
      "unknown"
    ]),
    value: z.unknown().nullable().default(null),
    unknown: z.boolean().default(false),
    flexibility: z.enum(["none", "low", "medium", "high"]).default("medium"),
    rationale: boundedText(2_000).default(""),
    evidenceRequirement: boundedText(2_000).default(""),
    evidenceFreshnessDays: z
      .number()
      .int()
      .min(0)
      .max(3_650)
      .nullable()
      .default(null),
    disqualificationRule: boundedText(2_000).default("")
  })
  .strict();

export const campaignCriteriaDocumentSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    criteria: z.array(campaignCriterionSchema).max(500),
    rankingWeights: z
      .record(z.string(), z.number().min(0).max(100))
      .default({}),
    dealBreakers: stringList(100, 1_000),
    acceptableTradeoffs: stringList(100, 1_000),
    uncertaintyTolerance: z.enum(["low", "medium", "high"]).default("medium"),
    minimumExcitement: z.number().int().min(1).max(5).nullable().default(null),
    includeKeywords: stringList(200, 200),
    excludeKeywords: stringList(200, 200),
    requiredSources: stringList(100, 500),
    minimumConfidence: z.number().min(0).max(1).nullable().default(null)
  })
  .strict();

export const createOpportunityCampaignSchema = z
  .object({
    id: boundedText(240).optional(),
    sourceEngagementId: boundedText(240).nullable().default(null),
    title: nonEmptyText(240),
    purpose: boundedText(10_000).default(""),
    description: boundedText(20_000).default(""),
    status: opportunityCampaignStatusSchema.default("draft"),
    priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
    searchIntent: z
      .enum([
        "full_time_employment",
        "part_time_employment",
        "contract",
        "freelance",
        "fractional",
        "internship",
        "shift_work",
        "seasonal",
        "board_advisory",
        "other"
      ])
      .default("full_time_employment"),
    activeFrom: optionalDate,
    activeUntil: optionalDate,
    targetStartDate: optionalDate,
    searchDeadline: optionalDate,
    urgency: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    reviewCadence: boundedText(100).default("weekly"),
    timezone: nonEmptyText(120).default("UTC"),
    completionCriteria: stringList(100, 1_000),
    longTermDestination: boundedText(10_000).default(""),
    intermediateRoles: stringList(100, 500),
    capabilitiesToAcquire: stringList(100, 500),
    steppingStoneAssessment: z
      .enum(["stepping_stone", "neutral", "dead_end_risk", "unknown"])
      .default("unknown"),
    currentStage: boundedText(200).default("defining"),
    health: z
      .enum(["healthy", "attention", "blocked", "unknown"])
      .default("unknown"),
    nextAction: boundedText(2_000).default(""),
    blockers: stringList(100, 1_000),
    primaryGoalId: boundedText(240).nullable().default(null),
    visibility: z.enum(["private", "shared"]).default("private"),
    scope: workScopeSchema,
    initialCriteria: campaignCriteriaDocumentSchema.optional(),
    provenance: workProvenanceSchema
  })
  .strict();

export const updateOpportunityCampaignSchema = createOpportunityCampaignSchema
  .omit({ id: true, initialCriteria: true })
  .partial()
  .extend({ expectedRevision: z.number().int().min(1) })
  .strict();

export const createCriteriaVersionSchema = z
  .object({
    criteria: campaignCriteriaDocumentSchema,
    rationale: boundedText(4_000).default(""),
    effectiveAt: z.string().datetime({ offset: true }).optional(),
    provenance: workProvenanceSchema
  })
  .strict();

export const jobOpportunityDispositionSchema = z.enum([
  "discovered",
  "reviewing",
  "shortlisted",
  "qualified",
  "rejected_by_user",
  "disqualified",
  "applied",
  "stale",
  "closed",
  "archived"
]);

export const opportunityClaimEvidenceSchema = z
  .object({
    field: nonEmptyText(240),
    evidence: jsonRecord,
    confidence: z.number().min(0).max(1).nullable().default(null),
    observedAt: optionalDateTime,
    provenance: workProvenanceSchema
  })
  .strict();

export const upsertJobOpportunitySchema = z
  .object({
    id: boundedText(240).optional(),
    organizationId: boundedText(240).nullable().default(null),
    canonicalUrl: boundedText(2_000).default(""),
    sourceName: boundedText(240).default(""),
    sourceIdentifier: boundedText(500).default(""),
    title: nonEmptyText(300),
    employerName: boundedText(300).default(""),
    roleFamily: boundedText(240).default(""),
    seniority: boundedText(240).default(""),
    description: boundedText(100_000).default(""),
    responsibilities: stringList(200, 2_000),
    requirements: stringList(200, 2_000),
    preferredQualifications: stringList(200, 2_000),
    skills: stringList(200, 500),
    technologies: stringList(200, 500),
    sector: boundedText(500).default(""),
    location: workLocationSchema,
    workModel: z
      .enum(["remote", "hybrid", "on_site", "variable", "unknown"])
      .default("unknown"),
    travel: opportunityTravelSchema,
    sponsorship: opportunitySponsorshipSchema,
    employmentType: boundedText(120).default("unknown"),
    weeklyHours: opportunityHoursSchema,
    duration: opportunityDurationSchema,
    startDate: optionalDate,
    compensation: workCompensationSchema,
    benefits: z.array(workBenefitSchema).max(100).default([]),
    applicationRoute: applicationRouteSchema,
    publishedAt: optionalDateTime,
    applicationDeadline: optionalDate,
    availabilityStatus: z
      .enum(["live", "stale", "closed", "filled", "unknown"])
      .default("unknown"),
    disposition: jobOpportunityDispositionSchema.default("discovered"),
    confidence: z.number().min(0).max(1).nullable().default(null),
    unknowns: stringList(100, 1_000),
    redFlags: stringList(100, 1_000),
    eligibilityUncertainties: stringList(100, 1_000),
    excitement: z.number().int().min(1).max(5).nullable().default(null),
    decision: boundedText(2_000).default(""),
    decisionRationale: boundedText(4_000).default(""),
    nextAction: boundedText(2_000).default(""),
    scope: workScopeSchema,
    sourceSnapshotArtifactId: boundedText(240).nullable().default(null),
    claimEvidence: z.array(opportunityClaimEvidenceSchema).max(500).default([]),
    provenance: workProvenanceSchema,
    idempotencyKey: nonEmptyText(200)
  })
  .strict();

export const updateJobOpportunitySchema = upsertJobOpportunitySchema
  .omit({ id: true, idempotencyKey: true })
  .partial()
  .extend({ expectedRevision: z.number().int().min(1) })
  .strict();

export const opportunityEvaluationEvidenceSchema = z
  .object({
    kind: z.enum([
      "artifact",
      "source_snapshot",
      "source_url",
      "user_statement",
      "agent_observation",
      "other"
    ]),
    label: nonEmptyText(1_000),
    sourceUrl: z.string().trim().url().max(2_000).nullable().default(null),
    sourceArtifactId: boundedText(240).nullable().default(null),
    sourceDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable()
      .default(null),
    observedAt: optionalDateTime,
    claim: boundedText(4_000).default(""),
    confidence: z.number().min(0).max(1).nullable().default(null)
  })
  .strict();

export const opportunityCriterionEvaluationSchema = z
  .object({
    criterionKey: nonEmptyText(160),
    result: z.enum(["pass", "partial", "fail", "unknown", "not_applicable"]),
    score: z.number().min(0).max(100).nullable().default(null),
    weightedContribution: z.number().finite().nullable().default(null),
    confidence: z.number().min(0).max(1).nullable().default(null),
    matchedEvidence: z
      .array(opportunityEvaluationEvidenceSchema)
      .max(100)
      .default([]),
    gaps: stringList(100, 1_000),
    failureReasons: stringList(100, 1_000),
    tradeoffs: stringList(100, 1_000),
    explanation: boundedText(10_000).default("")
  })
  .strict();

export const opportunityModelProvenanceSchema = z
  .object({
    provider: boundedText(240).default(""),
    model: boundedText(240).default(""),
    modelVersion: boundedText(240).default(""),
    runId: boundedText(240).default(""),
    promptDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable()
      .default(null),
    method: boundedText(500).default(""),
    parameters: jsonRecord,
    generatedAt: optionalDateTime
  })
  .strict()
  .default({});

export const evaluationSchema = z
  .object({
    criteriaVersionId: nonEmptyText(240),
    evaluatedAt: z.string().datetime({ offset: true }).optional(),
    evaluator: workActorSchema,
    modelProvenance: opportunityModelProvenanceSchema,
    evidenceSources: z
      .array(opportunityEvaluationEvidenceSchema)
      .max(200)
      .default([]),
    overallScore: z.number().min(0).max(100).nullable().default(null),
    confidence: z.number().min(0).max(1).nullable().default(null),
    hardGateResult: z
      .enum(["pass", "fail", "unknown", "needs_review"])
      .default("unknown"),
    criterionScores: z
      .array(opportunityCriterionEvaluationSchema)
      .max(500)
      .default([]),
    matchedEvidence: z
      .array(opportunityEvaluationEvidenceSchema)
      .max(500)
      .default([]),
    gaps: stringList(200, 1_000),
    failureReasons: stringList(200, 1_000),
    tradeoffs: stringList(200, 1_000),
    recommendation: boundedText(10_000).default(""),
    humanOverride: z
      .object({
        value: z.string().max(500),
        reason: nonEmptyText(2_000),
        actorId: nonEmptyText(240)
      })
      .strict()
      .nullable()
      .default(null),
    provenance: workProvenanceSchema
  })
  .strict();

export const jobApplicationStatusSchema = z.enum([
  "planned",
  "preparing",
  "blocked_on_user_input",
  "ready_for_review",
  "ready_to_submit",
  "submitted",
  "acknowledged",
  "screening",
  "interviewing",
  "assessment",
  "references",
  "offer",
  "accepted",
  "declined_by_candidate",
  "withdrawn",
  "rejected",
  "ghosted",
  "closed"
]);

export const createJobApplicationSchema = z
  .object({
    id: boundedText(240).optional(),
    opportunityId: nonEmptyText(240),
    primaryCampaignId: nonEmptyText(240),
    criteriaVersionId: boundedText(240).nullable().default(null),
    candidateUserId: boundedText(240).optional(),
    applicationRoute: applicationRouteSchema,
    accountReference: boundedText(500).default(""),
    status: jobApplicationStatusSchema.default("planned"),
    nextAction: boundedText(2_000).default(""),
    ownerLabel: boundedText(240).default(""),
    blocker: boundedText(2_000).default(""),
    priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
    referralState: boundedText(120).default("none"),
    privateContacts: z.array(jsonRecord).max(100).default([]),
    positioningProfileId: boundedText(240).nullable().default(null),
    documentSetId: boundedText(240).nullable().default(null),
    representations: jsonRecord,
    unresolvedUserFacts: z.array(jsonRecord).max(100).default([]),
    lastContactAt: optionalDateTime,
    nextFollowUpAt: optionalDateTime,
    decisionDeadline: optionalDateTime,
    expectedResponseAt: optionalDateTime,
    employerReason: boundedText(4_000).default(""),
    inferredExplanation: boundedText(4_000).default(""),
    lessons: boundedText(10_000).default(""),
    reapplicationDate: optionalDate,
    scope: workScopeSchema,
    provenance: workProvenanceSchema,
    reapplicationReason: boundedText(2_000).default("")
  })
  .strict();

export const updateJobApplicationSchema = createJobApplicationSchema
  .omit({
    id: true,
    opportunityId: true,
    primaryCampaignId: true,
    criteriaVersionId: true,
    status: true,
    reapplicationReason: true
  })
  .partial()
  .extend({
    expectedRevision: z.number().int().min(1),
    lastContactAt: optionalDateTime,
    nextFollowUpAt: optionalDateTime,
    decisionDeadline: optionalDateTime,
    expectedResponseAt: optionalDateTime,
    employerReason: boundedText(4_000).optional(),
    inferredExplanation: boundedText(4_000).optional(),
    lessons: boundedText(10_000).optional(),
    reapplicationDate: optionalDate
  })
  .strict();

export const transitionJobApplicationSchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    newStatus: jobApplicationStatusSchema,
    occurredAt: z.string().datetime({ offset: true }).optional(),
    factualDescription: boundedText(10_000).default(""),
    outcome: boundedText(4_000).default(""),
    nextAction: boundedText(2_000).default(""),
    dueAt: optionalDateTime,
    sourceArtifactId: boundedText(240).nullable().default(null),
    confidence: z.number().min(0).max(1).nullable().default(null),
    provenance: workProvenanceSchema
  })
  .strict();

export const applicationActivityTypeSchema = z.enum([
  "email",
  "acknowledgement",
  "call",
  "interview",
  "assessment",
  "information_request",
  "follow_up",
  "withdrawal",
  "offer",
  "rejection",
  "correction",
  "note"
]);

export const recordJobApplicationEventSchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    eventType: applicationActivityTypeSchema,
    occurredAt: z.string().datetime({ offset: true }).optional(),
    sourceArtifactId: boundedText(240).nullable().default(null),
    factualDescription: nonEmptyText(10_000),
    outcome: boundedText(4_000).default(""),
    nextAction: boundedText(2_000).optional(),
    nextFollowUpAt: optionalDateTime,
    dueAt: optionalDateTime,
    confidence: z.number().min(0).max(1).nullable().default(null),
    provenance: workProvenanceSchema,
    idempotencyKey: nonEmptyText(200)
  })
  .strict();

export type CreateWorkOrganizationInput = z.infer<
  typeof createWorkOrganizationSchema
>;
export type UpdateWorkOrganizationInput = z.infer<
  typeof updateWorkOrganizationSchema
>;
export type CreateWorkEngagementInput = z.infer<
  typeof createWorkEngagementSchema
>;
export type UpdateWorkEngagementInput = z.infer<
  typeof updateWorkEngagementSchema
>;
export type CreateOpportunityCampaignInput = z.infer<
  typeof createOpportunityCampaignSchema
>;
export type UpdateOpportunityCampaignInput = z.infer<
  typeof updateOpportunityCampaignSchema
>;
export type CreateCriteriaVersionInput = z.infer<
  typeof createCriteriaVersionSchema
>;
export type UpsertJobOpportunityInput = z.infer<
  typeof upsertJobOpportunitySchema
>;
export type UpdateJobOpportunityInput = z.infer<
  typeof updateJobOpportunitySchema
>;
export type CreateJobApplicationInput = z.infer<
  typeof createJobApplicationSchema
>;
export type UpdateJobApplicationInput = z.infer<
  typeof updateJobApplicationSchema
>;
export type RecordJobApplicationEventInput = z.infer<
  typeof recordJobApplicationEventSchema
>;
export type WorkActor = z.infer<typeof workActorSchema>;
