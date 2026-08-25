import type { JsonSchema } from "./work-openapi-shared.js";
import {
  jsonObject,
  nullableDateTime,
  nullableString,
  provenance
} from "./work-openapi-shared.js";
import {
  jobApplicationStatuses,
  workImportApplicationInput
} from "./work-openapi-core-schemas.js";
import { supportingInputSchemas } from "./work-openapi-supporting-schemas.js";
import { workEntityTypes, workLinkTargetTypes } from "./work/types.js";

export function buildWorkImportOpenApiComponents(): Record<string, JsonSchema> {
  return {
    WorkImportCriteriaVersion: {
      type: "object",
      additionalProperties: false,
      required: ["ref", "campaignRef", "value"],
      properties: {
        ref: { type: "string", minLength: 1, maxLength: 240 },
        campaignRef: { type: "string", minLength: 1, maxLength: 240 },
        value: {
          type: "object",
          additionalProperties: false,
          required: ["criteria"],
          properties: {
            criteria: { $ref: "#/components/schemas/CampaignCriteriaDocument" },
            rationale: { type: "string", maxLength: 4000 },
            effectiveAt: { type: "string", format: "date-time" },
            provenance
          }
        }
      }
    },
    WorkImportRoleTarget: {
      type: "object",
      additionalProperties: false,
      required: ["campaignRef", "value"],
      properties: {
        campaignRef: { type: "string", minLength: 1, maxLength: 240 },
        value: {
          type: "object",
          additionalProperties: false,
          required: ["titleFamily"],
          properties: {
            ...((supportingInputSchemas.WorkRoleTargetInput
              .properties as Record<string, unknown>) ?? {}),
            id: { type: "string", maxLength: 240 },
            expectedRevision: { type: "integer", minimum: 1 }
          }
        }
      }
    },
    WorkImportOrganizationTarget: {
      type: "object",
      additionalProperties: false,
      required: ["campaignRef", "value"],
      properties: {
        campaignRef: { type: "string", minLength: 1, maxLength: 240 },
        value: {
          type: "object",
          additionalProperties: false,
          required: ["organizationId"],
          properties: {
            ...((supportingInputSchemas.WorkOrganizationTargetInput
              .properties as Record<string, unknown>) ?? {}),
            id: { type: "string", maxLength: 240 },
            expectedRevision: { type: "integer", minimum: 1 }
          }
        }
      }
    },
    WorkImportJobApplicationInput: workImportApplicationInput,
    WorkImportApplicationEvent: {
      type: "object",
      additionalProperties: false,
      required: ["applicationRef", "eventType", "occurredAt", "actor"],
      properties: {
        applicationRef: { type: "string", minLength: 1, maxLength: 240 },
        eventType: { type: "string", minLength: 1, maxLength: 120 },
        priorStatus: {
          type: ["string", "null"],
          enum: [...jobApplicationStatuses, null]
        },
        newStatus: {
          type: ["string", "null"],
          enum: [...jobApplicationStatuses, null]
        },
        occurredAt: { type: "string", format: "date-time" },
        actor: { $ref: "#/components/schemas/WorkActor" },
        sourceArtifactId: nullableString,
        factualDescription: { type: "string", maxLength: 10000 },
        outcome: { type: "string", maxLength: 4000 },
        nextAction: { type: "string", maxLength: 2000 },
        dueAt: nullableDateTime,
        confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
        provenance
      }
    },
    WorkImportLink: {
      type: "object",
      additionalProperties: false,
      required: ["sourceType", "sourceRef", "link"],
      properties: {
        sourceType: { type: "string", enum: workEntityTypes },
        sourceRef: { type: "string", minLength: 1, maxLength: 240 },
        link: {
          type: "object",
          additionalProperties: false,
          required: ["targetEntityType", "targetEntityId"],
          properties: {
            targetEntityType: { type: "string", enum: workLinkTargetTypes },
            targetEntityId: { type: "string", minLength: 1, maxLength: 240 },
            relationship: { type: "string", minLength: 1, maxLength: 120 },
            anchorKey: { type: "string", maxLength: 240 }
          }
        }
      }
    },
    WorkImportArtifactReference: {
      type: "object",
      additionalProperties: false,
      required: ["ref", "artifactId", "contentSha256"],
      properties: {
        ref: { type: "string", minLength: 1, maxLength: 240 },
        artifactId: { type: "string", minLength: 1, maxLength: 240 },
        artifactVersionId: nullableString,
        contentSha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
        applicationRef: nullableString,
        useKind: {
          enum: ["preparation", "review", "transmission", "verified_submission"]
        },
        approvalState: { enum: ["draft", "reviewed", "approved", "sealed"] },
        usedAt: { type: "string", format: "date-time" },
        provenance
      }
    },
    WorkImportManifest: {
      type: "object",
      additionalProperties: false,
      required: ["schemaVersion", "source", "ownerUserId"],
      description:
        "Insert-only private manifest. Subjective Work observations, credentials, passwords, tokens, protected demographics, and exact home addresses are not accepted. Historical application states require evidence-bound provenance and preserve unknown timestamps.",
      properties: {
        schemaVersion: { const: 1 },
        source: {
          type: "object",
          additionalProperties: false,
          required: ["label", "digest", "observedAt"],
          properties: {
            label: { type: "string", minLength: 1, maxLength: 240 },
            digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
            observedAt: { type: "string", format: "date-time" }
          }
        },
        ownerUserId: { type: "string", minLength: 1, maxLength: 240 },
        lookingForOpportunities: { type: "boolean" },
        organizations: {
          type: "array",
          maxItems: 1000,
          items: { $ref: "#/components/schemas/WorkOrganizationInput" }
        },
        engagements: {
          type: "array",
          maxItems: 1000,
          items: { $ref: "#/components/schemas/WorkEngagementInput" }
        },
        campaigns: {
          type: "array",
          maxItems: 1000,
          items: { $ref: "#/components/schemas/OpportunityCampaignInput" }
        },
        criteriaVersions: {
          type: "array",
          maxItems: 5000,
          items: { $ref: "#/components/schemas/WorkImportCriteriaVersion" }
        },
        roleTargets: {
          type: "array",
          maxItems: 5000,
          items: { $ref: "#/components/schemas/WorkImportRoleTarget" }
        },
        organizationTargets: {
          type: "array",
          maxItems: 5000,
          items: { $ref: "#/components/schemas/WorkImportOrganizationTarget" }
        },
        opportunities: {
          type: "array",
          maxItems: 20000,
          items: { $ref: "#/components/schemas/JobOpportunityInput" }
        },
        applications: {
          type: "array",
          maxItems: 20000,
          items: { $ref: "#/components/schemas/WorkImportJobApplicationInput" }
        },
        applicationEvents: {
          type: "array",
          maxItems: 50000,
          items: { $ref: "#/components/schemas/WorkImportApplicationEvent" }
        },
        links: {
          type: "array",
          maxItems: 50000,
          items: { $ref: "#/components/schemas/WorkImportLink" }
        },
        artifactReferences: {
          type: "array",
          maxItems: 20000,
          items: { $ref: "#/components/schemas/WorkImportArtifactReference" }
        }
      }
    },
    WorkImportResolution: {
      type: "object",
      additionalProperties: false,
      required: ["ref", "action", "existingId"],
      properties: {
        ref: { type: "string" },
        action: { enum: ["create", "reference"] },
        existingId: nullableString
      }
    },
    WorkImportCounts: {
      type: "object",
      additionalProperties: false,
      required: [
        "organizations",
        "engagements",
        "campaigns",
        "opportunities",
        "applications",
        "criteriaVersions",
        "roleTargets",
        "organizationTargets",
        "applicationEvents",
        "links",
        "artifactReferences"
      ],
      properties: {
        ...Object.fromEntries(
          [
            "organizations",
            "engagements",
            "campaigns",
            "opportunities",
            "applications"
          ].map((key) => [
            key,
            {
              type: "object",
              additionalProperties: false,
              required: ["create", "reference"],
              properties: {
                create: { type: "integer", minimum: 0 },
                reference: { type: "integer", minimum: 0 }
              }
            }
          ])
        ),
        criteriaVersions: { type: "integer", minimum: 0 },
        roleTargets: { type: "integer", minimum: 0 },
        organizationTargets: { type: "integer", minimum: 0 },
        applicationEvents: { type: "integer", minimum: 0 },
        links: { type: "integer", minimum: 0 },
        artifactReferences: { type: "integer", minimum: 0 }
      }
    },
    WorkImportPreview: {
      type: "object",
      additionalProperties: false,
      required: [
        "schemaVersion",
        "sourceDigest",
        "manifestDigest",
        "ownerUserId",
        "counts",
        "resolutions",
        "warnings",
        "subjectiveMetricObservations",
        "rollbackClassification",
        "previewDigest",
        "readyToApply"
      ],
      properties: {
        schemaVersion: { const: 1 },
        sourceDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
        manifestDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
        ownerUserId: { type: "string" },
        counts: { $ref: "#/components/schemas/WorkImportCounts" },
        resolutions: {
          type: "object",
          additionalProperties: false,
          required: [
            "organizations",
            "engagements",
            "campaigns",
            "opportunities",
            "applications"
          ],
          properties: Object.fromEntries(
            [
              "organizations",
              "engagements",
              "campaigns",
              "opportunities",
              "applications"
            ].map((key) => [
              key,
              {
                type: "array",
                items: { $ref: "#/components/schemas/WorkImportResolution" }
              }
            ])
          )
        },
        warnings: { type: "array", items: { type: "string" } },
        subjectiveMetricObservations: { const: 0 },
        rollbackClassification: {
          type: "object",
          additionalProperties: {
            enum: [
              "reference_only",
              "soft_delete_root",
              "physical_delete_receipt_row",
              "immutable_receipt"
            ]
          }
        },
        previewDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
        readyToApply: { const: true }
      }
    },
    WorkImportApplyReceipt: {
      type: "object",
      additionalProperties: false,
      required: [
        "replayed",
        "receiptId",
        "previewDigest",
        "manifestDigest",
        "appliedAt",
        "counts",
        "references",
        "createdRecordCount",
        "matchedExistingCount",
        "subjectiveMetricObservations",
        "dependencyFingerprint"
      ],
      properties: {
        replayed: { type: "boolean" },
        receiptId: { type: "string" },
        previewDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
        manifestDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
        appliedAt: { type: "string", format: "date-time" },
        counts: { $ref: "#/components/schemas/WorkImportCounts" },
        references: {
          type: "object",
          additionalProperties: { type: "string" }
        },
        createdRecordCount: { type: "integer", minimum: 0 },
        matchedExistingCount: { type: "integer", minimum: 0 },
        subjectiveMetricObservations: { const: 0 },
        dependencyFingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" }
      }
    },
    WorkImportRollbackPreview: {
      type: "object",
      additionalProperties: false,
      required: ["receiptId", "status", "canRollback", "replayed"],
      properties: {
        receiptId: { type: "string" },
        status: { type: "string" },
        recordCount: { type: "integer", minimum: 0 },
        classifications: {
          type: "object",
          additionalProperties: { type: "integer", minimum: 0 }
        },
        conflicts: { type: "array", items: jsonObject },
        rollbackPreviewDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
        canRollback: { type: "boolean" },
        replayed: { type: "boolean" },
        tombstone: jsonObject
      }
    },
    WorkImportRollbackResult: {
      type: "object",
      additionalProperties: false,
      required: [
        "replayed",
        "receiptId",
        "idempotencyKey",
        "requestFingerprint",
        "rollbackPreviewDigest",
        "rolledBackAt",
        "removed",
        "softDeleted",
        "retainedReferences"
      ],
      properties: {
        replayed: { type: "boolean" },
        receiptId: { type: "string" },
        idempotencyKey: { type: "string" },
        requestFingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
        rollbackPreviewDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
        rolledBackAt: { type: "string", format: "date-time" },
        removed: { type: "array", items: jsonObject },
        softDeleted: { type: "array", items: jsonObject },
        retainedReferences: { type: "array", items: jsonObject }
      }
    }
  };
}
