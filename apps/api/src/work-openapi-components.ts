import type { JsonSchema } from "./work-openapi-shared.js";
import {
  rootOutputSchema,
  rootEnvelope,
  rootList,
  provenance,
  searchRunCost,
  stringArray,
  jsonObject,
  jsonArray,
  nullableString,
  nullableDateTime,
  scope
} from "./work-openapi-shared.js";
import {
  workOrganizationInput,
  workEngagementInput,
  campaignInput,
  criterion,
  campaignCriteriaDocument,
  jobApplicationStatuses,
  workMetricDefinitionInput,
  workCheckInInput,
  jobOpportunityInput,
  opportunityEvaluationEvidence,
  opportunityCriterionEvaluation,
  opportunityModelProvenance,
  evaluationInput,
  jobApplicationInput,
  workActor,
  jobApplicationOutput,
  applicationTransitionInput,
  applicationEventInput,
  relationshipReplacementInput,
  transmissionPreviewInput,
  verifiedSubmissionInput,
  transmissionPreviewOutput,
  artifactVersionReference
} from "./work-openapi-core-schemas.js";
import { buildWorkImportOpenApiComponents } from "./work-openapi-import-components.js";
import {
  supportingInputSchemas,
  supportingDataUnion,
  supportingPatchInputSchemas,
  supportingPatchDataUnion,
  supportingOutputSchemas,
  supportingOutputUnion
} from "./work-openapi-supporting-schemas.js";

export function buildWorkOpenApiComponents(): Record<string, JsonSchema> {
  return {
    WorkEnvelope: { type: "object", additionalProperties: true },
    WorkRecord: {
      type: "object",
      additionalProperties: true,
      required: ["id", "revision", "createdAt", "updatedAt"],
      properties: {
        id: { type: "string" },
        revision: { type: "integer", minimum: 1 },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" }
      }
    },
    WorkScope: scope,
    WorkProvenance: provenance,
    WorkOrganizationInput: workOrganizationInput,
    WorkOrganization: rootOutputSchema(workOrganizationInput),
    WorkOrganizationEnvelope: rootEnvelope(
      "organization",
      "#/components/schemas/WorkOrganization",
      {
        links: {
          type: "array",
          items: { $ref: "#/components/schemas/WorkRelationship" }
        }
      }
    ),
    WorkOrganizationList: rootList("#/components/schemas/WorkOrganization"),
    WorkEngagementInput: workEngagementInput,
    WorkEngagement: rootOutputSchema(workEngagementInput),
    WorkEngagementEnvelope: rootEnvelope(
      "engagement",
      "#/components/schemas/WorkEngagement"
    ),
    WorkEngagementList: rootList("#/components/schemas/WorkEngagement"),
    OpportunityCampaignInput: campaignInput,
    OpportunityCampaign: rootOutputSchema(campaignInput, ["initialCriteria"]),
    OpportunityCampaignEnvelope: rootEnvelope(
      "campaign",
      "#/components/schemas/OpportunityCampaign"
    ),
    OpportunityCampaignList: rootList(
      "#/components/schemas/OpportunityCampaign"
    ),
    WorkMetricDefinitionInput: workMetricDefinitionInput,
    WorkCheckInInput: workCheckInInput,
    JobOpportunityInput: jobOpportunityInput,
    JobOpportunity: rootOutputSchema(jobOpportunityInput, ["idempotencyKey"]),
    JobOpportunityEnvelope: rootEnvelope(
      "opportunity",
      "#/components/schemas/JobOpportunity"
    ),
    JobOpportunityList: rootList("#/components/schemas/JobOpportunity"),
    OpportunityEvaluationInput: evaluationInput,
    JobApplicationInput: jobApplicationInput,
    JobApplication: jobApplicationOutput,
    JobApplicationEnvelope: rootEnvelope(
      "application",
      "#/components/schemas/JobApplication"
    ),
    JobApplicationList: rootList("#/components/schemas/JobApplication"),
    WorkRootRecord: {
      oneOf: [
        "WorkOrganization",
        "WorkEngagement",
        "OpportunityCampaign",
        "JobOpportunity",
        "JobApplication"
      ].map((name) => ({ $ref: `#/components/schemas/${name}` }))
    },
    WorkRootRecordEnvelope: rootEnvelope(
      "record",
      "#/components/schemas/WorkRootRecord"
    ),
    JobApplicationTransitionInput: applicationTransitionInput,
    JobApplicationEventInput: applicationEventInput,
    JobApplicationEvent: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "applicationId",
        "eventType",
        "occurredAt",
        "actor",
        "factualDescription",
        "outcome",
        "nextAction",
        "provenance",
        "createdAt"
      ],
      properties: {
        id: { type: "string" },
        applicationId: { type: "string" },
        eventType: { type: "string" },
        priorStatus: { type: ["string", "null"] },
        newStatus: { type: ["string", "null"] },
        occurredAt: { type: "string", format: "date-time" },
        actor: jsonObject,
        sourceArtifactId: nullableString,
        factualDescription: { type: "string" },
        outcome: { type: "string" },
        nextAction: { type: "string" },
        dueAt: nullableDateTime,
        confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
        provenance,
        createdAt: { type: "string", format: "date-time" }
      }
    },
    JobApplicationEventResult: {
      type: "object",
      additionalProperties: false,
      required: ["replayed", "event", "application"],
      properties: {
        replayed: { type: "boolean" },
        event: { $ref: "#/components/schemas/JobApplicationEvent" },
        application: { $ref: "#/components/schemas/WorkEnvelope" }
      }
    },
    WorkRelationshipReplacementInput: relationshipReplacementInput,
    WorkRelationship: {
      type: "object",
      additionalProperties: false,
      required: [
        "sourceEntityType",
        "sourceEntityId",
        "targetEntityType",
        "targetEntityId",
        "relationship"
      ],
      properties: {
        sourceEntityType: { type: "string" },
        sourceEntityId: { type: "string" },
        targetEntityType: { type: "string" },
        targetEntityId: { type: "string" },
        relationship: { type: "string" },
        anchorKey: { type: "string" },
        createdByActor: { type: "string" },
        createdAt: { type: "string", format: "date-time" }
      }
    },
    WorkRelationshipEnvelope: {
      type: "object",
      additionalProperties: false,
      required: ["links"],
      properties: {
        links: {
          type: "array",
          items: { $ref: "#/components/schemas/WorkRelationship" }
        }
      }
    },
    WorkTransmissionPreviewInput: transmissionPreviewInput,
    WorkTransmissionPreview: transmissionPreviewOutput,
    WorkTransmissionPreviewResult: {
      type: "object",
      additionalProperties: false,
      required: ["replayed", "preview", "application"],
      properties: {
        replayed: { type: "boolean" },
        preview: { $ref: "#/components/schemas/WorkTransmissionPreview" },
        application: {
          type: "object",
          additionalProperties: false,
          required: ["id", "status", "revision"],
          properties: {
            id: { type: "string" },
            status: { enum: jobApplicationStatuses },
            revision: { type: "integer", minimum: 1 }
          }
        }
      }
    },
    WorkTransmissionApprovalResult: {
      type: "object",
      additionalProperties: true,
      required: ["action", "approvalRequest", "preview"],
      properties: {
        action: jsonObject,
        approvalRequest: jsonObject,
        preview: { $ref: "#/components/schemas/WorkTransmissionPreview" }
      }
    },
    WorkVerifiedSubmissionInput: verifiedSubmissionInput,
    WorkVerifiedSubmissionResult: {
      type: "object",
      additionalProperties: false,
      required: ["replayed", "application", "preview"],
      properties: {
        replayed: { type: "boolean" },
        application: { $ref: "#/components/schemas/WorkEnvelope" },
        preview: { $ref: "#/components/schemas/WorkTransmissionPreview" }
      }
    },
    CampaignCriterion: criterion,
    CampaignCriteriaDocument: campaignCriteriaDocument,
    ArtifactVersionReference: artifactVersionReference,
    ...supportingInputSchemas,
    WorkSupportingDataInput: supportingDataUnion,
    ...supportingPatchInputSchemas,
    WorkSupportingDataPatch: supportingPatchDataUnion,
    ...supportingOutputSchemas,
    WorkSupportingRecord: supportingOutputUnion,
    WorkSupportingEnvelope: {
      type: "object",
      additionalProperties: false,
      required: ["record"],
      properties: {
        record: { $ref: "#/components/schemas/WorkSupportingRecord" }
      }
    },
    WorkSupportingList: {
      type: "object",
      additionalProperties: false,
      required: ["items", "total", "limit", "offset", "hasMore"],
      properties: {
        items: {
          type: "array",
          items: { $ref: "#/components/schemas/WorkSupportingRecord" }
        },
        total: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1, maximum: 50 },
        offset: { type: "integer", minimum: 0 },
        hasMore: { type: "boolean" },
        redacted: { type: "boolean" }
      }
    },
    WorkOfferAcceptanceResult: {
      type: "object",
      additionalProperties: false,
      required: ["replayed", "engagement", "offer", "application"],
      properties: {
        replayed: { type: "boolean" },
        engagement: { $ref: "#/components/schemas/WorkEngagement" },
        offer: { $ref: "#/components/schemas/WorkOffer" },
        application: { $ref: "#/components/schemas/JobApplication" }
      }
    },
    WorkMetricDefinition: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "ownerUserId",
        "canonicalKey",
        "version",
        "displayName",
        "valueKind",
        "scale",
        "enabled",
        "isBuiltin",
        "revision"
      ],
      properties: {
        id: { type: "string" },
        ownerUserId: { type: "string" },
        canonicalKey: { type: "string" },
        version: { type: "integer", minimum: 1 },
        displayName: { type: "string" },
        description: { type: "string" },
        valueKind: { enum: ["ordinal", "numeric", "categorical"] },
        scale: jsonObject,
        target: jsonObject,
        warning: jsonObject,
        reviewCadence: { type: "string" },
        enabled: { type: "boolean" },
        isBuiltin: { type: "boolean" },
        provenance,
        revision: { type: "integer", minimum: 1 },
        createdAt: nullableDateTime,
        updatedAt: nullableDateTime
      }
    },
    WorkMetricDefinitionList: {
      type: "object",
      additionalProperties: false,
      required: ["definitions"],
      properties: {
        definitions: {
          type: "array",
          items: { $ref: "#/components/schemas/WorkMetricDefinition" }
        }
      }
    },
    WorkMetricDefinitionEnvelope: rootEnvelope(
      "definition",
      "#/components/schemas/WorkMetricDefinition"
    ),
    WorkCheckIn: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "engagementId",
        "observedAt",
        "timezone",
        "sourceKind",
        "confirmationState",
        "createdAt"
      ],
      properties: {
        id: { type: "string" },
        engagementId: { type: "string" },
        observedAt: { type: "string", format: "date-time" },
        timezone: { type: "string" },
        sourceKind: { enum: ["user_entered", "imported", "agent_suggested"] },
        confirmationState: {
          enum: ["confirmed", "pending_confirmation", "rejected"]
        },
        note: { type: "string" },
        tags: stringArray,
        context: jsonObject,
        triggerId: nullableString,
        eventId: nullableString,
        actor: jsonObject,
        provenance,
        createdAt: { type: "string", format: "date-time" }
      }
    },
    WorkMetricObservation: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "engagementId",
        "checkInId",
        "metricDefinitionId",
        "metricKey",
        "metricVersion",
        "observedAt",
        "timezone",
        "sourceKind",
        "confirmationState",
        "missingState",
        "createdAt"
      ],
      properties: {
        id: { type: "string" },
        engagementId: { type: "string" },
        checkInId: { type: "string" },
        metricDefinitionId: { type: "string" },
        metricKey: { type: "string" },
        metricVersion: { type: "integer", minimum: 1 },
        numericValue: { type: ["number", "null"] },
        categoricalValue: nullableString,
        scale: jsonObject,
        missingState: {
          enum: ["observed", "unknown", "skipped", "not_applicable"]
        },
        confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
        note: { type: "string" },
        tags: stringArray,
        context: jsonObject,
        triggerId: nullableString,
        eventId: nullableString,
        sourceKind: { enum: ["user_entered", "imported", "agent_suggested"] },
        confirmationState: {
          enum: ["confirmed", "pending_confirmation", "rejected"]
        },
        actor: jsonObject,
        provenance,
        observedAt: { type: "string", format: "date-time" },
        timezone: { type: "string" },
        createdAt: { type: "string", format: "date-time" }
      }
    },
    WorkCheckInResult: {
      type: "object",
      additionalProperties: false,
      required: ["replayed", "checkIn", "observations"],
      properties: {
        replayed: { type: "boolean" },
        checkIn: { $ref: "#/components/schemas/WorkCheckIn" },
        observations: {
          type: "array",
          items: { $ref: "#/components/schemas/WorkMetricObservation" }
        }
      }
    },
    WorkMetricTrends: {
      type: "object",
      additionalProperties: false,
      required: ["windowDays", "observedFrom", "series", "comparisons"],
      properties: {
        windowDays: { type: "integer", minimum: 7, maximum: 730 },
        observedFrom: { type: "string", format: "date-time" },
        series: { type: "array", items: jsonObject },
        comparisons: { type: "array", items: jsonObject }
      }
    },
    WorkSearchRunInput: {
      type: "object",
      additionalProperties: false,
      required: [
        "campaignId",
        "criteriaVersionId",
        "data",
        "items",
        "idempotencyKey"
      ],
      properties: {
        campaignId: { type: "string" },
        criteriaVersionId: { type: "string" },
        data: {
          type: "object",
          additionalProperties: false,
          properties: {
            agent: jsonObject,
            startedAt: { type: "string", format: "date-time" },
            endedAt: nullableDateTime,
            status: {
              enum: ["running", "completed", "partial", "failed", "cancelled"]
            },
            sources: {
              type: "array",
              items: { oneOf: [{ type: "string" }, jsonObject] }
            },
            queries: {
              type: "array",
              items: { oneOf: [{ type: "string" }, jsonObject] }
            },
            counts: {
              type: "object",
              additionalProperties: false,
              properties: {
                found: { type: "integer", minimum: 0 },
                new: { type: "integer", minimum: 0 },
                changed: { type: "integer", minimum: 0 },
                duplicate: { type: "integer", minimum: 0 },
                stale: { type: "integer", minimum: 0 },
                closed: { type: "integer", minimum: 0 },
                failed: { type: "integer", minimum: 0 }
              }
            },
            failures: jsonArray,
            cost: searchRunCost,
            evidence: jsonArray
          }
        },
        items: {
          type: "array",
          maxItems: 10000,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["resultKind"],
            properties: {
              opportunityId: nullableString,
              resultKind: {
                enum: [
                  "new",
                  "changed",
                  "duplicate",
                  "stale",
                  "closed",
                  "failed"
                ]
              },
              evidence: jsonObject
            }
          }
        },
        idempotencyKey: { type: "string", minLength: 1, maxLength: 200 }
      }
    },
    WorkSearchRun: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "ownerUserId",
        "campaignId",
        "criteriaVersionId",
        "startedAt",
        "status",
        "sources",
        "queries",
        "counts",
        "failures",
        "cost",
        "evidence",
        "createdAt",
        "updatedAt"
      ],
      properties: {
        id: { type: "string" },
        ownerUserId: { type: "string" },
        campaignId: { type: "string" },
        criteriaVersionId: { type: "string" },
        agent: jsonObject,
        startedAt: { type: "string", format: "date-time" },
        endedAt: nullableDateTime,
        status: {
          enum: ["running", "completed", "partial", "failed", "cancelled"]
        },
        sources: {
          type: "array",
          items: { oneOf: [{ type: "string" }, jsonObject] }
        },
        queries: {
          type: "array",
          items: { oneOf: [{ type: "string" }, jsonObject] }
        },
        counts: jsonObject,
        failures: jsonArray,
        cost: searchRunCost,
        evidence: jsonArray,
        idempotencyKey: { type: "string" },
        requestFingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" }
      }
    },
    WorkSearchRunList: rootList("#/components/schemas/WorkSearchRun"),
    WorkSearchRunItem: {
      type: "object",
      additionalProperties: false,
      required: ["id", "runId", "resultKind", "evidence", "createdAt"],
      properties: {
        id: { type: "string" },
        runId: { type: "string" },
        opportunityId: nullableString,
        resultKind: {
          enum: ["new", "changed", "duplicate", "stale", "closed", "failed"]
        },
        evidence: jsonObject,
        createdAt: { type: "string", format: "date-time" }
      }
    },
    WorkSearchRunResult: {
      type: "object",
      additionalProperties: false,
      required: ["replayed", "run", "items"],
      properties: {
        replayed: { type: "boolean" },
        run: { $ref: "#/components/schemas/WorkSearchRun" },
        items: {
          type: "array",
          items: { $ref: "#/components/schemas/WorkSearchRunItem" }
        }
      }
    },
    WorkSearchRunDetail: {
      type: "object",
      additionalProperties: false,
      required: ["run", "items", "restrictedItemCount", "page"],
      properties: {
        run: { $ref: "#/components/schemas/WorkSearchRun" },
        items: {
          type: "array",
          items: { $ref: "#/components/schemas/WorkSearchRunItem" }
        },
        restrictedItemCount: { type: "integer", minimum: 0 },
        page: {
          type: "object",
          additionalProperties: false,
          required: [
            "limit",
            "offset",
            "returned",
            "total",
            "hasMore",
            "nextOffset"
          ],
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 200 },
            offset: { type: "integer", minimum: 0 },
            returned: { type: "integer", minimum: 0 },
            total: { type: "integer", minimum: 0 },
            hasMore: { type: "boolean" },
            nextOffset: { type: ["integer", "null"], minimum: 0 }
          }
        }
      }
    },
    WorkContext: {
      type: "object",
      additionalProperties: false,
      required: [
        "generatedAt",
        "settings",
        "engagements",
        "campaigns",
        "metricComparisons",
        "summary",
        "nestedCollectionLimit",
        "contextTruncated",
        "contextBytes",
        "contextByteLimit"
      ],
      properties: {
        generatedAt: { type: "string", format: "date-time" },
        settings: {
          type: "array",
          items: { $ref: "#/components/schemas/WorkSettings" }
        },
        engagements: {
          type: "array",
          maxItems: 25,
          items: { $ref: "#/components/schemas/WorkEngagement" }
        },
        campaigns: {
          type: "array",
          maxItems: 25,
          items: { $ref: "#/components/schemas/OpportunityCampaign" }
        },
        metricComparisons: { type: "array", items: jsonObject },
        summary: { $ref: "#/components/schemas/WorkContextSummary" },
        nestedCollectionLimit: { const: 25 },
        contextTruncated: { type: "boolean" },
        contextTruncationReason: { type: "string" },
        contextBytes: { type: "integer", maximum: 262144 },
        contextByteLimit: { const: 262144 }
      }
    },
    WorkSettings: {
      type: "object",
      additionalProperties: false,
      required: [
        "ownerUserId",
        "lookingForOpportunities",
        "revision",
        "createdAt",
        "updatedAt"
      ],
      properties: {
        ownerUserId: { type: "string" },
        lookingForOpportunities: { type: "boolean" },
        revision: { type: "integer", minimum: 0 },
        provenance,
        createdAt: nullableDateTime,
        updatedAt: nullableDateTime
      }
    },
    WorkSettingsListEnvelope: {
      type: "object",
      additionalProperties: false,
      required: ["settings"],
      properties: {
        settings: {
          type: "array",
          items: { $ref: "#/components/schemas/WorkSettings" }
        }
      }
    },
    WorkSettingsEnvelope: rootEnvelope(
      "settings",
      "#/components/schemas/WorkSettings"
    ),
    CampaignCriteriaVersion: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "campaignId",
        "version",
        "criteria",
        "rationale",
        "effectiveAt",
        "actor",
        "provenance",
        "createdAt"
      ],
      properties: {
        id: { type: "string" },
        campaignId: { type: "string" },
        version: { type: "integer", minimum: 1 },
        criteria: { $ref: "#/components/schemas/CampaignCriteriaDocument" },
        rationale: { type: "string" },
        effectiveAt: { type: "string", format: "date-time" },
        actor: jsonObject,
        provenance,
        createdAt: { type: "string", format: "date-time" }
      }
    },
    CampaignCriteriaVersionEnvelope: rootEnvelope(
      "criteriaVersion",
      "#/components/schemas/CampaignCriteriaVersion"
    ),
    OpportunityEvaluation: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "campaignId",
        "opportunityId",
        "criteriaVersionId",
        "evaluationVersion",
        "evaluatedAt",
        "evaluator",
        "overallScore",
        "confidence",
        "hardGateResult",
        "criterionScores",
        "matchedEvidence",
        "gaps",
        "failureReasons",
        "tradeoffs",
        "recommendation",
        "humanOverride",
        "provenance",
        "createdAt"
      ],
      properties: {
        id: { type: "string" },
        campaignId: { type: "string" },
        opportunityId: { type: "string" },
        criteriaVersionId: { type: "string" },
        evaluationVersion: { type: "integer", minimum: 1 },
        evaluatedAt: { type: "string", format: "date-time" },
        evaluator: jsonObject,
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
        gaps: jsonArray,
        failureReasons: jsonArray,
        tradeoffs: jsonArray,
        recommendation: { type: "string" },
        humanOverride: jsonObject,
        provenance,
        createdAt: { type: "string", format: "date-time" }
      }
    },
    OpportunityEvaluationEnvelope: rootEnvelope(
      "evaluation",
      "#/components/schemas/OpportunityEvaluation"
    ),
    JobOpportunityUpsertResult: {
      type: "object",
      additionalProperties: false,
      required: ["replayed", "opportunity", "deduplicated"],
      properties: {
        replayed: { type: "boolean" },
        opportunity: { $ref: "#/components/schemas/JobOpportunity" },
        deduplicated: { type: "boolean" },
        referenceOnly: { type: "boolean" },
        createdRecords: jsonArray
      }
    },
    WorkContextSummary: {
      type: "object",
      additionalProperties: false,
      required: [
        "currentEngagements",
        "plannedEngagements",
        "pastEngagements",
        "activeCampaigns",
        "pausedCampaigns",
        "blockedCampaigns",
        "applicationsNeedingAttention",
        "trendWindowDays"
      ],
      properties: {
        currentEngagements: { type: "integer", minimum: 0 },
        plannedEngagements: { type: "integer", minimum: 0 },
        pastEngagements: { type: "integer", minimum: 0 },
        activeCampaigns: { type: "integer", minimum: 0 },
        pausedCampaigns: { type: "integer", minimum: 0 },
        blockedCampaigns: { type: "integer", minimum: 0 },
        applicationsNeedingAttention: { type: "integer", minimum: 0 },
        trendWindowDays: { type: "integer", minimum: 7, maximum: 730 }
      }
    },
    WorkActor: workActor,
    ...buildWorkImportOpenApiComponents()
  };
}
