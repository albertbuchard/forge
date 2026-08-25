import type { JsonSchema } from "./work-openapi-shared.js";
import {
  provenance,
  searchCostConstraints,
  searchRateConstraints,
  automaticEligibility,
  compensationGate,
  legalAnswerGate,
  stringArray,
  jsonObject,
  jsonArray,
  nullableString,
  nullableDateTime,
  workLocation,
  noticePeriod,
  offerCompensation,
  opportunityHours,
  opportunityDuration
} from "./work-openapi-shared.js";
import { artifactVersionReference } from "./work-openapi-core-schemas.js";

export const supportingInputSchemas: Record<string, JsonSchema> = {
  WorkRoleTargetInput: {
    type: "object",
    additionalProperties: false,
    required: ["titleFamily"],
    properties: {
      titleFamily: { type: "string" },
      aliases: stringArray,
      seniority: { type: "string" },
      functionName: { type: "string" },
      domain: { type: "string" },
      responsibilities: stringArray,
      technologies: stringArray,
      requiredQualifications: stringArray,
      desiredQualifications: stringArray,
      transferableEvidence: stringArray,
      knownGaps: stringArray,
      evidenceActions: stringArray,
      searchTerms: stringArray,
      queryFragments: stringArray,
      priority: { type: "integer", minimum: 0, maximum: 100 }
    }
  },
  WorkOrganizationTargetInput: {
    type: "object",
    additionalProperties: false,
    required: ["organizationId"],
    properties: {
      organizationId: { type: "string" },
      targetTier: { type: "string" },
      rationale: { type: "string" },
      status: {
        enum: [
          "active",
          "watching",
          "contacting",
          "paused",
          "excluded",
          "completed"
        ]
      },
      evidence: jsonArray,
      warmPaths: jsonArray,
      exclusions: stringArray,
      priorApplications: jsonArray,
      nextAction: { type: "string" }
    }
  },
  WorkEvidenceLink: {
    type: "object",
    additionalProperties: false,
    required: ["entityType", "entityId"],
    properties: {
      entityType: {
        enum: [
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
        ]
      },
      entityId: { type: "string", minLength: 1, maxLength: 240 },
      relationship: { type: "string", maxLength: 120, default: "supports" }
    }
  },
  WorkPositioningEvidenceClaim: {
    type: "object",
    additionalProperties: false,
    required: ["claim", "evidenceLinks"],
    properties: {
      claim: { type: "string", minLength: 1, maxLength: 4000 },
      evidenceLinks: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        items: { $ref: "#/components/schemas/WorkEvidenceLink" }
      },
      reviewState: { enum: ["draft", "reviewed", "approved"] }
    }
  },
  WorkPositioningProfileInput: {
    type: "object",
    additionalProperties: false,
    required: ["title"],
    properties: {
      title: { type: "string" },
      headline: { type: "string" },
      summary: { type: "string" },
      targetRoles: stringArray,
      evidenceClaims: {
        type: "array",
        maxItems: 500,
        items: { $ref: "#/components/schemas/WorkPositioningEvidenceClaim" }
      },
      skills: stringArray,
      accomplishments: {
        type: "array",
        maxItems: 500,
        items: { $ref: "#/components/schemas/WorkPositioningEvidenceClaim" }
      },
      languages: jsonArray,
      publicLinks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["url", "intentionallyPublic"],
          properties: {
            label: { type: "string" },
            url: { type: "string", format: "uri" },
            intentionallyPublic: { const: true }
          }
        }
      },
      preferredDefaultArtifactId: nullableString,
      validFrom: { type: ["string", "null"], format: "date" },
      validUntil: { type: ["string", "null"], format: "date" },
      approvalState: { enum: ["draft", "reviewed", "approved", "retired"] },
      scopeProjectIds: stringArray,
      scopeTagIds: stringArray,
      provenance
    }
  },
  WorkDocumentSetInput: {
    type: "object",
    additionalProperties: false,
    required: ["title"],
    properties: {
      profileId: nullableString,
      title: { type: "string" },
      version: { type: "integer", minimum: 1 },
      artifactVersions: {
        type: "array",
        maxItems: 100,
        items: artifactVersionReference
      },
      targetProfile: jsonObject,
      approvalState: { enum: ["draft", "reviewed", "approved", "retired"] },
      sealed: { type: "boolean" },
      confidentiality: { enum: ["private", "restricted", "shareable"] },
      retentionPolicy: jsonObject,
      scopeProjectIds: stringArray,
      scopeTagIds: stringArray,
      validFrom: { type: ["string", "null"], format: "date" },
      validUntil: { type: ["string", "null"], format: "date" },
      provenance
    }
  },
  WorkReusableResponseInput: {
    type: "object",
    additionalProperties: false,
    required: ["exactQuestion", "normalizedCategory"],
    properties: {
      exactQuestion: { type: "string" },
      normalizedCategory: { type: "string" },
      answer: { type: "string" },
      limit: jsonObject,
      language: { type: "string" },
      evidenceLinks: {
        type: "array",
        maxItems: 500,
        items: { $ref: "#/components/schemas/WorkEvidenceLink" }
      },
      sensitivity: { enum: ["normal", "private", "protected"] },
      reviewState: { enum: ["draft", "reviewed", "approved", "retired"] },
      usageHistory: jsonArray,
      scopeProjectIds: stringArray,
      scopeTagIds: stringArray,
      provenance
    }
  },
  WorkApplicationQuestionInput: {
    type: "object",
    additionalProperties: false,
    required: ["exactQuestion"],
    properties: {
      exactQuestion: { type: "string" },
      normalizedCategory: { type: "string" },
      limit: jsonObject,
      language: { type: "string" },
      sensitivity: { enum: ["normal", "private", "protected"] },
      reusableResponseId: nullableString,
      approvedAnswer: { type: "string" },
      evidenceLinks: {
        type: "array",
        maxItems: 500,
        items: { $ref: "#/components/schemas/WorkEvidenceLink" }
      },
      reviewState: { enum: ["draft", "reviewed", "approved", "submitted"] },
      useHistory: jsonArray
    }
  },
  WorkArtifactUseInput: {
    type: "object",
    additionalProperties: false,
    required: ["artifactId", "contentSha256", "useKind", "usedAt"],
    properties: {
      artifactId: { type: "string" },
      artifactVersionId: nullableString,
      contentSha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
      useKind: {
        enum: ["preparation", "review", "transmission", "verified_submission"]
      },
      approvalState: { enum: ["draft", "reviewed", "approved", "sealed"] },
      usedAt: { type: "string", format: "date-time" },
      transmissionPreviewId: nullableString,
      provenance
    }
  },
  WorkInterviewInput: {
    type: "object",
    additionalProperties: false,
    properties: {
      stage: { type: "string" },
      scheduledStartAt: nullableDateTime,
      scheduledEndAt: nullableDateTime,
      timezone: { type: "string" },
      format: { type: "string" },
      privateLocationOrLink: { type: "string" },
      participantLinks: {
        type: "array",
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["personId"],
          properties: {
            personId: { type: "string" },
            role: { type: "string" },
            label: { type: "string" }
          }
        }
      },
      focusAreas: stringArray,
      preparationArtifactId: nullableString,
      questionBank: {
        type: "array",
        maxItems: 500,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["question"],
          properties: {
            question: { type: "string" },
            status: { enum: ["planned", "asked", "answered", "skipped"] },
            notes: { type: "string" }
          }
        }
      },
      notes: { type: "string" },
      outcome: { type: "string" },
      followUp: { type: "string" },
      nextAction: { type: "string" }
    }
  },
  WorkOfferInput: {
    type: "object",
    additionalProperties: false,
    properties: {
      status: {
        enum: [
          "expected",
          "received",
          "negotiating",
          "revised",
          "accepted",
          "declined",
          "expired",
          "withdrawn"
        ]
      },
      terms: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          level: { type: "string" },
          location: workLocation,
          workModel: {
            enum: ["remote", "hybrid", "on_site", "variable", "unknown"]
          },
          employmentType: { type: "string" },
          startDate: { type: ["string", "null"], format: "date" },
          weeklyHours: opportunityHours,
          duration: opportunityDuration,
          noticeInteraction: noticePeriod,
          otherTerms: jsonObject
        }
      },
      privateCompensation: offerCompensation,
      contingencies: jsonArray,
      negotiationAsks: jsonArray,
      response: { type: "string" },
      artifactIds: stringArray,
      expiresAt: nullableDateTime,
      decision: { type: "string" },
      rationale: { type: "string" },
      criteriaVersionId: nullableString,
      plannedEngagementId: nullableString,
      provenance
    }
  },
  WorkSearchSourceInput: {
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: {
      name: { type: "string" },
      sourceType: {
        enum: [
          "website",
          "job_board",
          "ats",
          "organization_careers",
          "agency",
          "network",
          "feed",
          "manual",
          "other"
        ]
      },
      canonicalUrl: { type: "string" },
      reliability: { type: ["number", "null"], minimum: 0, maximum: 1 },
      costConstraints: searchCostConstraints,
      rateConstraints: searchRateConstraints,
      enabled: { type: "boolean" },
      provenance
    }
  },
  WorkSavedQueryInput: {
    type: "object",
    additionalProperties: false,
    required: ["criteriaVersionId", "title", "queryText"],
    properties: {
      sourceId: nullableString,
      criteriaVersionId: { type: "string" },
      title: { type: "string" },
      queryText: { type: "string" },
      geography: jsonObject,
      filters: jsonObject,
      cadence: { type: "string" },
      freshnessHours: { type: "integer", minimum: 1, maximum: 8760 },
      enabled: { type: "boolean" }
    }
  },
  WorkAutomationPolicyInput: {
    type: "object",
    additionalProperties: false,
    required: ["criteriaVersionId"],
    properties: {
      criteriaVersionId: { type: "string" },
      researchAuthority: { enum: ["disabled", "allowed", "review_required"] },
      preparationAuthority: {
        enum: ["disabled", "allowed", "review_required"]
      },
      uploadAuthority: { enum: ["disabled", "allowed", "review_required"] },
      submissionAuthority: { enum: ["disabled", "review_required"] },
      reviewRequiredClasses: stringArray,
      automaticEligibility,
      defaultProfileId: nullableString,
      defaultDocumentSetId: nullableString,
      compensationGates: {
        type: "array",
        maxItems: 200,
        items: compensationGate
      },
      legalAnswerGates: {
        type: "array",
        maxItems: 200,
        items: legalAnswerGate
      },
      maximumApplications: {
        type: ["integer", "null"],
        minimum: 1,
        maximum: 10000
      },
      duplicatePrevention: { type: "boolean" }
    }
  },
  WorkOutreachInput: {
    type: "object",
    additionalProperties: false,
    properties: {
      campaignId: nullableString,
      organizationId: nullableString,
      personId: nullableString,
      proposal: { type: "string" },
      channel: { type: "string" },
      status: {
        enum: [
          "planned",
          "drafted",
          "ready",
          "sent",
          "replied",
          "follow_up",
          "closed"
        ]
      },
      messageArtifactId: nullableString,
      sentAt: nullableDateTime,
      followUpAt: nullableDateTime,
      response: { type: "string" },
      nextAction: { type: "string" },
      scopeProjectIds: stringArray,
      scopeTagIds: stringArray,
      provenance
    }
  }
};

export const supportingSchemaNames = Object.keys(supportingInputSchemas);
export const supportingDataUnion = {
  oneOf: supportingSchemaNames.map((name) => ({
    $ref: `#/components/schemas/${name}`
  }))
};
export const supportingPatchInputSchemas = Object.fromEntries(
  Object.entries(supportingInputSchemas)
    .filter(([name]) => name !== "WorkArtifactUseInput")
    .map(([name, schema]) => {
      const { required: _required, ...partialSchema } = schema;
      return [`${name}Patch`, partialSchema];
    })
) as Record<string, JsonSchema>;
export const supportingPatchDataUnion = {
  oneOf: Object.keys(supportingPatchInputSchemas).map((name) => ({
    $ref: `#/components/schemas/${name}`
  }))
};

export const supportingOutputSchemas = Object.fromEntries(
  Object.entries(supportingInputSchemas).map(([name, schema]) => {
    const outputName = name.replace(/Input$/u, "");
    return [
      outputName,
      {
        type: "object",
        additionalProperties: false,
        required: ["id", "createdAt"],
        properties: {
          ...((schema.properties as Record<string, unknown> | undefined) ?? {}),
          id: { type: "string" },
          ownerUserId: { type: "string" },
          campaignId: { type: "string" },
          applicationId: { type: "string" },
          revision: { type: "integer", minimum: 1 },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          importReceiptId: nullableString,
          links: {
            type: "array",
            items: { $ref: "#/components/schemas/WorkRelationship" }
          },
          revisionHistory: jsonArray,
          offerRevisions: jsonArray
        }
      }
    ];
  })
) as Record<string, JsonSchema>;
export const supportingOutputNames = Object.keys(supportingOutputSchemas);
export const supportingOutputUnion = {
  oneOf: supportingOutputNames.map((name) => ({
    $ref: `#/components/schemas/${name}`
  }))
};
export const supportingKinds = [
  "roleTarget",
  "organizationTarget",
  "positioningProfile",
  "documentSet",
  "reusableResponse",
  "applicationQuestion",
  "artifactUse",
  "interview",
  "offer",
  "searchSource",
  "savedQuery",
  "automationPolicy",
  "outreach"
];
export const supportingKindParameter = {
  name: "kind",
  in: "path",
  required: true,
  schema: { type: "string", enum: supportingKinds }
};
