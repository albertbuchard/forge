import {
  rootOutputSchema,
  provenance,
  stringArray,
  jsonObject,
  jsonArray,
  nullableString,
  nullableDateTime,
  scope,
  workLocation,
  workWorkload,
  noticePeriod,
  workSchedule,
  workBenefit,
  workCompensation,
  opportunityHours,
  opportunityDuration,
  opportunityTravel,
  opportunitySponsorship,
  applicationRoute
} from "./work-openapi-shared.js";
import { workLinkTargetTypes } from "./work/types.js";

export const commonInputProperties = {
  id: { type: "string", maxLength: 240 },
  visibility: { enum: ["private", "shared"] },
  scope,
  provenance
};

export const workOrganizationInput = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    ...commonInputProperties,
    name: { type: "string", minLength: 1, maxLength: 240 },
    aliases: { type: "array", items: { type: "string" } },
    domain: { type: "string" },
    websiteUrl: { type: "string" },
    location: workLocation,
    organizationFacts: { type: "object", additionalProperties: true },
    status: { enum: ["active", "target", "excluded", "past", "archived"] },
    description: { type: "string" }
  }
};

export const workEngagementInput = {
  type: "object",
  additionalProperties: false,
  required: ["title"],
  properties: {
    ...commonInputProperties,
    organizationId: { type: ["string", "null"] },
    title: { type: "string", minLength: 1, maxLength: 240 },
    roleFunction: { type: "string" },
    description: { type: "string" },
    status: {
      enum: [
        "planned",
        "current",
        "on_leave",
        "transitioning",
        "ended",
        "archived"
      ]
    },
    priority: { enum: ["low", "normal", "high", "critical"] },
    engagementType: {
      enum: [
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
      ]
    },
    startDate: { type: ["string", "null"], format: "date" },
    expectedEndDate: { type: ["string", "null"], format: "date" },
    actualEndDate: { type: ["string", "null"], format: "date" },
    probationEndDate: { type: ["string", "null"], format: "date" },
    renewalDate: { type: ["string", "null"], format: "date" },
    contractDeadline: { type: ["string", "null"], format: "date" },
    noticePeriod,
    earliestDepartureDate: { type: ["string", "null"], format: "date" },
    workload: workWorkload,
    schedule: workSchedule,
    location: workLocation,
    workModel: { enum: ["remote", "hybrid", "on_site", "variable", "unknown"] },
    roleFacts: {
      type: "object",
      additionalProperties: false,
      properties: {
        seniority: { type: "string" },
        roleFamily: { type: "string" },
        teamName: { type: "string" },
        managerRole: { type: "string" },
        directReportCount: { type: ["integer", "null"], minimum: 0 },
        decisionAuthority: { type: "array", items: { type: "string" } },
        ownershipAreas: { type: "array", items: { type: "string" } },
        domains: { type: "array", items: { type: "string" } },
        technologies: { type: "array", items: { type: "string" } },
        skillsUsed: { type: "array", items: { type: "string" } },
        skillsDeveloping: { type: "array", items: { type: "string" } },
        clinicalExposure: { type: "string" },
        customerExposure: { type: "string" },
        researchFreedom: { type: "string" },
        publicationRights: { type: "string" },
        openSourceRights: { type: "string" },
        deliverables: { type: "array", items: { type: "string" } }
      }
    },
    responsibilities: { type: "array", items: { type: "string" } },
    successCriteria: { type: "array", items: { type: "string" } },
    compensation: workCompensation,
    benefits: { type: "array", maxItems: 100, items: workBenefit },
    purpose: { type: "string" },
    desiredOutcomes: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    constraints: { type: "array", items: { type: "string" } },
    transitionIntentions: { type: "string" },
    exitReason: { type: "string" },
    exitOutcome: { type: "string" },
    nextAction: { type: "string" }
  }
};

export const campaignInput = {
  type: "object",
  additionalProperties: false,
  required: ["title"],
  properties: {
    ...commonInputProperties,
    sourceEngagementId: { type: ["string", "null"] },
    title: { type: "string", minLength: 1, maxLength: 240 },
    purpose: { type: "string" },
    description: { type: "string" },
    status: {
      enum: [
        "draft",
        "planned",
        "active",
        "paused",
        "completed",
        "abandoned",
        "archived"
      ]
    },
    priority: { enum: ["low", "normal", "high", "critical"] },
    searchIntent: {
      enum: [
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
      ]
    },
    activeFrom: { type: ["string", "null"], format: "date" },
    activeUntil: { type: ["string", "null"], format: "date" },
    targetStartDate: { type: ["string", "null"], format: "date" },
    searchDeadline: { type: ["string", "null"], format: "date" },
    urgency: { enum: ["low", "normal", "high", "urgent"] },
    reviewCadence: { type: "string" },
    timezone: { type: "string" },
    completionCriteria: { type: "array", items: { type: "string" } },
    longTermDestination: { type: "string" },
    intermediateRoles: { type: "array", items: { type: "string" } },
    capabilitiesToAcquire: { type: "array", items: { type: "string" } },
    steppingStoneAssessment: {
      enum: ["stepping_stone", "neutral", "dead_end_risk", "unknown"]
    },
    currentStage: { type: "string" },
    health: { enum: ["healthy", "attention", "blocked", "unknown"] },
    nextAction: { type: "string" },
    blockers: { type: "array", items: { type: "string" } },
    primaryGoalId: { type: ["string", "null"] },
    initialCriteria: { $ref: "#/components/schemas/CampaignCriteriaDocument" }
  }
};

export const criterion = {
  type: "object",
  additionalProperties: false,
  required: ["key", "section", "field", "kind", "importance", "operator"],
  properties: {
    key: { type: "string" },
    section: { type: "string" },
    field: { type: "string" },
    kind: { type: "string" },
    importance: { enum: ["hard", "soft"] },
    weight: { type: "number", minimum: 0, maximum: 100 },
    operator: { type: "string" },
    value: {},
    unknown: { type: "boolean" },
    flexibility: { enum: ["none", "low", "medium", "high"] },
    rationale: { type: "string" },
    evidenceRequirement: { type: "string" },
    evidenceFreshnessDays: { type: ["integer", "null"] },
    disqualificationRule: { type: "string" }
  }
};

export const campaignCriteriaDocument = {
  type: "object",
  additionalProperties: false,
  required: ["criteria"],
  properties: {
    schemaVersion: { const: 1 },
    criteria: { type: "array", maxItems: 500, items: criterion },
    rankingWeights: {
      type: "object",
      additionalProperties: { type: "number" }
    },
    dealBreakers: { type: "array", items: { type: "string" } },
    acceptableTradeoffs: { type: "array", items: { type: "string" } },
    uncertaintyTolerance: { enum: ["low", "medium", "high"] },
    minimumExcitement: { type: ["integer", "null"], minimum: 1, maximum: 5 },
    includeKeywords: { type: "array", items: { type: "string" } },
    excludeKeywords: { type: "array", items: { type: "string" } },
    requiredSources: { type: "array", items: { type: "string" } },
    minimumConfidence: { type: ["number", "null"], minimum: 0, maximum: 1 }
  }
};

export const jobApplicationStatuses = [
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
];

export const jobApplicationPreparationStatuses = [
  "planned",
  "preparing",
  "blocked_on_user_input",
  "ready_for_review",
  "ready_to_submit"
];

export const workMetricDefinitionInput = {
  type: "object",
  additionalProperties: false,
  required: ["canonicalKey", "displayName"],
  properties: {
    canonicalKey: { type: "string", pattern: "^[a-z][a-z0-9_]{1,119}$" },
    displayName: { type: "string", minLength: 1, maxLength: 160 },
    description: { type: "string", maxLength: 2000 },
    valueKind: { enum: ["ordinal", "numeric", "categorical"] },
    scale: jsonObject,
    target: jsonObject,
    warning: jsonObject,
    reviewCadence: { type: "string", maxLength: 120 },
    enabled: { type: "boolean" },
    expectedRevision: { type: "integer", minimum: 1 },
    provenance
  }
};

export const workCheckInInput = {
  type: "object",
  additionalProperties: false,
  required: ["engagementId", "timezone", "observations", "idempotencyKey"],
  properties: {
    engagementId: { type: "string", minLength: 1, maxLength: 240 },
    observedAt: { type: "string", format: "date-time" },
    timezone: { type: "string", minLength: 1, maxLength: 120 },
    note: { type: "string", maxLength: 10000 },
    tags: stringArray,
    context: jsonObject,
    sourceKind: { enum: ["user_entered", "imported", "agent_suggested"] },
    confirmationState: { enum: ["suggested", "confirmed", "rejected"] },
    userConfirmation: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["userId", "confirmedAt", "method"],
      properties: {
        userId: { type: "string" },
        confirmedAt: { type: "string", format: "date-time" },
        method: {
          enum: ["forge_ui", "voice", "message", "import_review", "other"]
        },
        evidenceArtifactId: nullableString,
        note: { type: "string" }
      }
    },
    observations: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["metricDefinitionId"],
        properties: {
          metricDefinitionId: { type: "string" },
          numericValue: { type: ["number", "null"] },
          categoricalValue: nullableString,
          missingState: {
            enum: ["observed", "unknown", "skipped", "not_applicable"]
          },
          confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
          note: { type: "string" },
          tags: stringArray,
          context: jsonObject
        }
      }
    },
    provenance,
    idempotencyKey: { type: "string", minLength: 1, maxLength: 200 }
  }
};

export const jobOpportunityInput = {
  type: "object",
  additionalProperties: false,
  required: ["title", "idempotencyKey"],
  properties: {
    id: { type: "string", maxLength: 240 },
    organizationId: nullableString,
    canonicalUrl: { type: "string", maxLength: 2000 },
    sourceName: { type: "string", maxLength: 240 },
    sourceIdentifier: { type: "string", maxLength: 500 },
    title: { type: "string", minLength: 1, maxLength: 300 },
    employerName: { type: "string", maxLength: 300 },
    roleFamily: { type: "string", maxLength: 240 },
    seniority: { type: "string", maxLength: 240 },
    description: { type: "string", maxLength: 100000 },
    responsibilities: stringArray,
    requirements: stringArray,
    preferredQualifications: stringArray,
    skills: stringArray,
    technologies: stringArray,
    sector: { type: "string", maxLength: 500 },
    location: workLocation,
    workModel: { enum: ["remote", "hybrid", "on_site", "variable", "unknown"] },
    travel: opportunityTravel,
    sponsorship: opportunitySponsorship,
    employmentType: { type: "string", maxLength: 120 },
    weeklyHours: opportunityHours,
    duration: opportunityDuration,
    startDate: { type: ["string", "null"], format: "date" },
    compensation: workCompensation,
    benefits: { type: "array", maxItems: 100, items: workBenefit },
    applicationRoute,
    publishedAt: nullableDateTime,
    applicationDeadline: { type: ["string", "null"], format: "date" },
    availabilityStatus: {
      enum: ["live", "stale", "closed", "filled", "unknown"]
    },
    disposition: {
      enum: [
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
      ]
    },
    confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
    unknowns: stringArray,
    redFlags: stringArray,
    eligibilityUncertainties: stringArray,
    excitement: { type: ["integer", "null"], minimum: 1, maximum: 5 },
    decision: { type: "string", maxLength: 2000 },
    decisionRationale: { type: "string", maxLength: 4000 },
    nextAction: { type: "string", maxLength: 2000 },
    scope,
    sourceSnapshotArtifactId: nullableString,
    claimEvidence: {
      type: "array",
      maxItems: 500,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field"],
        properties: {
          field: { type: "string", minLength: 1, maxLength: 240 },
          evidence: jsonObject,
          confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
          observedAt: nullableDateTime,
          provenance
        }
      }
    },
    provenance,
    idempotencyKey: { type: "string", minLength: 1, maxLength: 200 }
  }
};

export const opportunityEvaluationEvidence = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "label"],
  properties: {
    kind: {
      enum: [
        "artifact",
        "source_snapshot",
        "source_url",
        "user_statement",
        "agent_observation",
        "other"
      ]
    },
    label: { type: "string", minLength: 1, maxLength: 1000 },
    sourceUrl: { type: ["string", "null"], format: "uri", maxLength: 2000 },
    sourceArtifactId: nullableString,
    sourceDigest: { type: ["string", "null"], pattern: "^[a-f0-9]{64}$" },
    observedAt: nullableDateTime,
    claim: { type: "string", maxLength: 4000 },
    confidence: { type: ["number", "null"], minimum: 0, maximum: 1 }
  }
};

export const opportunityCriterionEvaluation = {
  type: "object",
  additionalProperties: false,
  required: ["criterionKey", "result"],
  properties: {
    criterionKey: { type: "string", minLength: 1, maxLength: 160 },
    result: { enum: ["pass", "partial", "fail", "unknown", "not_applicable"] },
    score: { type: ["number", "null"], minimum: 0, maximum: 100 },
    weightedContribution: { type: ["number", "null"] },
    confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
    matchedEvidence: {
      type: "array",
      maxItems: 100,
      items: opportunityEvaluationEvidence
    },
    gaps: stringArray,
    failureReasons: stringArray,
    tradeoffs: stringArray,
    explanation: { type: "string", maxLength: 10000 }
  }
};

export const opportunityModelProvenance = {
  type: "object",
  additionalProperties: false,
  properties: {
    provider: { type: "string", maxLength: 240 },
    model: { type: "string", maxLength: 240 },
    modelVersion: { type: "string", maxLength: 240 },
    runId: { type: "string", maxLength: 240 },
    promptDigest: { type: ["string", "null"], pattern: "^[a-f0-9]{64}$" },
    method: { type: "string", maxLength: 500 },
    parameters: jsonObject,
    generatedAt: nullableDateTime
  }
};

export const evaluationInput = {
  type: "object",
  additionalProperties: false,
  required: ["criteriaVersionId", "evaluator"],
  properties: {
    criteriaVersionId: { type: "string" },
    evaluatedAt: { type: "string", format: "date-time" },
    evaluator: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "id", "source"],
      properties: {
        kind: { enum: ["human_user", "agent", "system"] },
        id: { type: "string" },
        label: { type: "string" },
        source: { enum: ["ui", "agent", "openclaw", "system"] }
      }
    },
    modelProvenance: opportunityModelProvenance,
    evidenceSources: {
      type: "array",
      maxItems: 200,
      items: opportunityEvaluationEvidence
    },
    overallScore: { type: ["number", "null"], minimum: 0, maximum: 100 },
    confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
    hardGateResult: { enum: ["pass", "fail", "unknown", "needs_review"] },
    criterionScores: {
      type: "array",
      maxItems: 500,
      items: opportunityCriterionEvaluation
    },
    matchedEvidence: {
      type: "array",
      maxItems: 500,
      items: opportunityEvaluationEvidence
    },
    gaps: stringArray,
    failureReasons: stringArray,
    tradeoffs: stringArray,
    recommendation: { type: "string" },
    humanOverride: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["value", "reason", "actorId"],
      properties: {
        value: { type: "string" },
        reason: { type: "string" },
        actorId: { type: "string" }
      }
    },
    provenance
  }
};

export const jobApplicationInput = {
  type: "object",
  additionalProperties: false,
  required: ["opportunityId", "primaryCampaignId"],
  properties: {
    id: { type: "string" },
    opportunityId: { type: "string" },
    primaryCampaignId: { type: "string" },
    criteriaVersionId: nullableString,
    candidateUserId: { type: "string" },
    applicationRoute,
    accountReference: { type: "string" },
    status: { enum: jobApplicationPreparationStatuses },
    nextAction: { type: "string" },
    ownerLabel: { type: "string" },
    blocker: { type: "string" },
    priority: { enum: ["low", "normal", "high", "critical"] },
    referralState: { type: "string" },
    privateContacts: jsonArray,
    positioningProfileId: nullableString,
    documentSetId: nullableString,
    representations: jsonObject,
    unresolvedUserFacts: jsonArray,
    scope,
    provenance,
    reapplicationReason: { type: "string" },
    lastContactAt: nullableDateTime,
    nextFollowUpAt: nullableDateTime,
    decisionDeadline: nullableDateTime,
    expectedResponseAt: nullableDateTime,
    employerReason: { type: "string" },
    inferredExplanation: { type: "string" },
    lessons: { type: "string" },
    reapplicationDate: { type: ["string", "null"], format: "date" }
  }
};

export const workImportApplicationInput = {
  ...jobApplicationInput,
  description:
    "Private operator-only import shape. Historical post-preparation statuses require explicit provenance evidence and are recorded as snapshots or validated events; no intermediate stage is inferred.",
  properties: {
    ...jobApplicationInput.properties,
    status: { enum: jobApplicationStatuses }
  }
};

export const workActor = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "id", "source"],
  properties: {
    kind: { enum: ["human_user", "agent", "system"] },
    id: { type: "string", minLength: 1, maxLength: 240 },
    label: { type: "string", maxLength: 240 },
    source: { enum: ["ui", "agent", "openclaw", "system"] }
  }
};

export const jobApplicationOutput = {
  ...rootOutputSchema(jobApplicationInput),
  properties: {
    ...((rootOutputSchema(jobApplicationInput).properties as Record<
      string,
      unknown
    >) ?? {}),
    status: { enum: jobApplicationStatuses },
    startedAt: nullableDateTime,
    submittedAt: nullableDateTime,
    acknowledgedAt: nullableDateTime,
    closedAt: nullableDateTime,
    confirmationReceipt: { type: "string" },
    trackingIdentifier: { type: "string" },
    outcome: { type: "string" },
    reapplicationOfApplicationId: nullableString,
    reapplicationReason: { type: "string" },
    reapplicationReviewedAt: nullableDateTime
  }
};

export const applicationTransitionInput = {
  type: "object",
  additionalProperties: false,
  required: ["expectedRevision", "newStatus"],
  properties: {
    expectedRevision: { type: "integer", minimum: 1 },
    newStatus: { enum: jobApplicationStatuses },
    occurredAt: { type: "string", format: "date-time" },
    factualDescription: { type: "string" },
    outcome: { type: "string" },
    nextAction: { type: "string" },
    dueAt: nullableDateTime,
    sourceArtifactId: nullableString,
    confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
    provenance
  }
};

export const applicationEventInput = {
  type: "object",
  additionalProperties: false,
  required: [
    "expectedRevision",
    "eventType",
    "factualDescription",
    "idempotencyKey"
  ],
  properties: {
    expectedRevision: { type: "integer", minimum: 1 },
    eventType: {
      enum: [
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
      ]
    },
    occurredAt: { type: "string", format: "date-time" },
    sourceArtifactId: nullableString,
    factualDescription: { type: "string", minLength: 1, maxLength: 10000 },
    outcome: { type: "string", maxLength: 4000 },
    nextAction: { type: "string", maxLength: 2000 },
    nextFollowUpAt: nullableDateTime,
    dueAt: nullableDateTime,
    confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
    provenance,
    idempotencyKey: { type: "string", minLength: 1, maxLength: 200 }
  }
};

export const relationshipReplacementInput = {
  type: "object",
  additionalProperties: false,
  required: ["links"],
  properties: {
    expectedRevision: { type: "integer", minimum: 1 },
    links: {
      type: "array",
      maxItems: 500,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["targetEntityType", "targetEntityId"],
        properties: {
          targetEntityType: { type: "string", enum: workLinkTargetTypes },
          targetEntityId: { type: "string" },
          relationship: { type: "string" },
          anchorKey: { type: "string" }
        }
      }
    }
  }
};

export const transmissionPreviewInput = {
  type: "object",
  additionalProperties: false,
  required: [
    "applicationId",
    "destination",
    "fields",
    "representations",
    "idempotencyKey"
  ],
  properties: {
    applicationId: { type: "string" },
    destination: {
      type: "object",
      additionalProperties: false,
      required: ["name", "url"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: 500 },
        url: { type: "string", format: "uri", maxLength: 2000 },
        channel: {
          enum: [
            "web_portal",
            "email",
            "recruiter",
            "referral",
            "api",
            "other"
          ],
          default: "web_portal"
        }
      }
    },
    fields: jsonObject,
    answers: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["questionId", "exactQuestion", "answer"],
        properties: {
          questionId: { type: "string", minLength: 1, maxLength: 240 },
          exactQuestion: { type: "string", minLength: 1, maxLength: 10000 },
          answer: { type: "string", minLength: 1, maxLength: 50000 }
        }
      }
    },
    artifactVersions: {
      type: "array",
      maxItems: 100,
      items: { $ref: "#/components/schemas/ArtifactVersionReference" }
    },
    representations: jsonObject,
    unresolvedGates: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label"],
        properties: {
          kind: { type: "string", maxLength: 160, default: "caller_reported" },
          label: { type: "string", minLength: 1, maxLength: 2000 },
          source: { type: "string", maxLength: 240, default: "caller" }
        }
      }
    },
    expiresInMinutes: { type: "integer", minimum: 5, maximum: 1440 },
    idempotencyKey: { type: "string", minLength: 1, maxLength: 200 }
  }
};

export const verifiedSubmissionInput = {
  type: "object",
  additionalProperties: false,
  required: [
    "authorizationIdentity",
    "previewDigest",
    "factualDescription",
    "idempotencyKey"
  ],
  anyOf: [
    {
      required: ["evidenceArtifactId"],
      properties: { evidenceArtifactId: { type: "string", minLength: 1 } }
    },
    {
      required: ["confirmationReceipt"],
      properties: { confirmationReceipt: { type: "string", minLength: 1 } }
    },
    {
      required: ["trackingIdentifier"],
      properties: { trackingIdentifier: { type: "string", minLength: 1 } }
    }
  ],
  properties: {
    authorizationIdentity: { type: "string" },
    previewDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
    evidenceArtifactId: nullableString,
    confirmationReceipt: { type: "string", maxLength: 4000 },
    trackingIdentifier: { type: "string", maxLength: 2000 },
    factualDescription: { type: "string", minLength: 1 },
    occurredAt: { type: "string", format: "date-time" },
    idempotencyKey: { type: "string", minLength: 1, maxLength: 200 }
  }
};

export const transmissionPreviewOutput = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "ownerUserId",
    "applicationId",
    "requestingClientIdentity",
    "destination",
    "fields",
    "answers",
    "artifactVersions",
    "representations",
    "unresolvedGates",
    "guardContext",
    "previewDigest",
    "status",
    "authorizedPrincipal",
    "expiresAt",
    "completionEvidence",
    "revision",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string" },
    ownerUserId: { type: "string" },
    applicationId: { type: "string" },
    requestingAgentId: nullableString,
    requestingTokenId: nullableString,
    requestingClientIdentity: { type: "string" },
    destination: jsonObject,
    fields: jsonObject,
    answers: jsonArray,
    artifactVersions: {
      type: "array",
      items: { $ref: "#/components/schemas/ArtifactVersionReference" }
    },
    representations: jsonObject,
    unresolvedGates: jsonArray,
    guardContext: jsonObject,
    previewDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
    status: {
      enum: [
        "draft",
        "approval_pending",
        "authorized",
        "rejected",
        "expired",
        "consumed",
        "failed"
      ]
    },
    approvalRequestId: nullableString,
    agentActionId: nullableString,
    authorizationIdentity: nullableString,
    authorizedPrincipal: jsonObject,
    authorizedAt: nullableDateTime,
    expiresAt: { type: "string", format: "date-time" },
    consumedAt: nullableDateTime,
    completionEvidence: jsonObject,
    revision: { type: "integer", minimum: 1 },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    importReceiptId: nullableString
  }
};

export const artifactVersionReference = {
  type: "object",
  additionalProperties: false,
  required: ["artifactId", "contentSha256"],
  properties: {
    artifactId: { type: "string" },
    artifactVersionId: nullableString,
    contentSha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
    artifactType: { type: "string" },
    language: { type: "string" },
    label: { type: "string" },
    approvalState: { enum: ["draft", "reviewed", "approved", "sealed"] },
    sealed: { type: "boolean" },
    confidentiality: { enum: ["private", "restricted", "shareable"] }
  }
};
