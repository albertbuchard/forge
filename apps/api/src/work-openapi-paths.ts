import type { JsonSchema } from "./work-openapi-shared.js";
import {
  response,
  body,
  idParameter,
  userParameter,
  listParameters,
  readOperation,
  writeOperation,
  withTypedResponse,
  withReplayResponses,
  withOnlyTypedSuccess,
  provenance
} from "./work-openapi-shared.js";
import {
  workOrganizationInput,
  workEngagementInput,
  campaignInput,
  jobOpportunityInput,
  jobApplicationInput
} from "./work-openapi-core-schemas.js";
import { supportingKindParameter } from "./work-openapi-supporting-schemas.js";
import { workEntityTypes } from "./work/types.js";

export function buildWorkOpenApiPaths(): Record<string, JsonSchema> {
  const rootDetailParameters = [idParameter, userParameter];
  const engagementDetailParameters = [
    ...rootDetailParameters,
    {
      name: "archived",
      in: "query",
      schema: { enum: ["exclude", "include"], default: "exclude" }
    }
  ];
  const patchSchema = (schema: JsonSchema, omitted: string[] = []) => {
    const properties = {
      ...((schema.properties as Record<string, unknown> | undefined) ?? {})
    };
    for (const key of omitted) delete properties[key];
    return {
      type: "object",
      additionalProperties: false,
      required: ["expectedRevision"],
      properties: {
        ...properties,
        expectedRevision: { type: "integer", minimum: 1 }
      }
    };
  };
  return {
    "/api/v1/work": {
      get: {
        ...readOperation(
          "Get the permanent Work overview",
          "Returns current and planned engagements, longitudinal summaries, and active or paused Opportunity Campaigns in one bounded response."
        ),
        responses: {
          "200": response("Complete bounded Work context", {
            $ref: "#/components/schemas/WorkContext"
          }),
          "403": { $ref: "#/components/responses/Error" }
        }
      }
    },
    "/api/v1/work/context": {
      get: withTypedResponse(
        readOperation(
          "Get complete Work or campaign context",
          "Optional engagementId or campaignId narrows the compound context; trendWindowDays is bounded from 7 to 730.",
          [
            userParameter,
            { name: "engagementId", in: "query", schema: { type: "string" } },
            { name: "campaignId", in: "query", schema: { type: "string" } },
            {
              name: "trendWindowDays",
              in: "query",
              schema: { type: "integer", minimum: 7, maximum: 730, default: 90 }
            }
          ]
        ),
        { $ref: "#/components/schemas/WorkContext" }
      )
    },
    "/api/v1/work/settings": {
      get: withTypedResponse(
        readOperation(
          "Get Work settings",
          "The Looking for opportunities switch never deletes historical search data."
        ),
        { $ref: "#/components/schemas/WorkSettingsListEnvelope" }
      )
    },
    "/api/v1/work/settings/opportunity-search": {
      patch: withTypedResponse(
        writeOperation(
          "Set Looking for opportunities",
          "Turning search off preserves every campaign, opportunity, application, and outcome.",
          {
            type: "object",
            additionalProperties: false,
            required: ["lookingForOpportunities", "expectedRevision"],
            properties: {
              lookingForOpportunities: { type: "boolean" },
              expectedRevision: { type: "integer", minimum: 0 }
            }
          }
        ),
        { $ref: "#/components/schemas/WorkSettingsEnvelope" }
      )
    },
    "/api/v1/work/organizations": {
      get: withTypedResponse(
        readOperation(
          "List Work organizations",
          "Returns a stable, paged list.",
          listParameters
        ),
        { $ref: "#/components/schemas/WorkOrganizationList" }
      ),
      post: withTypedResponse(
        writeOperation(
          "Create a Work organization",
          "Reuses Forge ownership and relationship semantics.",
          { $ref: "#/components/schemas/WorkOrganizationInput" },
          [userParameter],
          true
        ),
        { $ref: "#/components/schemas/WorkOrganizationEnvelope" },
        "201"
      )
    },
    "/api/v1/work/organizations/{id}": {
      get: withTypedResponse(
        readOperation(
          "Get a Work organization",
          "Includes bidirectional links.",
          rootDetailParameters
        ),
        { $ref: "#/components/schemas/WorkOrganizationEnvelope" }
      ),
      patch: withTypedResponse(
        writeOperation(
          "Update a Work organization",
          "Uses optimistic revision concurrency.",
          patchSchema(workOrganizationInput, ["id"]),
          rootDetailParameters
        ),
        { $ref: "#/components/schemas/WorkOrganizationEnvelope" }
      )
    },
    "/api/v1/work/engagements": {
      get: withTypedResponse(
        readOperation(
          "List Work Engagements",
          "Supports several overlapping current, planned, past, or transitioning roles.",
          listParameters
        ),
        { $ref: "#/components/schemas/WorkEngagementList" }
      ),
      post: withTypedResponse(
        writeOperation(
          "Create a Work Engagement",
          "Represents employment, appointments, contracts, freelance, shifts, and other paid work.",
          { $ref: "#/components/schemas/WorkEngagementInput" },
          [userParameter],
          true
        ),
        { $ref: "#/components/schemas/WorkEngagementEnvelope" },
        "201"
      )
    },
    "/api/v1/work/engagements/{id}": {
      get: withTypedResponse(
        readOperation(
          "Get a Work Engagement",
          "Includes facts, immutable events, confirmed observations, and relationships. Set archived=include to inspect a restorable archived engagement.",
          engagementDetailParameters
        ),
        { $ref: "#/components/schemas/WorkEngagementEnvelope" }
      ),
      patch: withTypedResponse(
        writeOperation(
          "Update a Work Engagement",
          "A status or fact change appends history instead of rewriting it.",
          patchSchema(workEngagementInput, ["id"]),
          rootDetailParameters
        ),
        { $ref: "#/components/schemas/WorkEngagementEnvelope" }
      )
    },
    "/api/v1/work/metrics/definitions": {
      get: withTypedResponse(
        readOperation(
          "List Work metric definitions",
          "Returns versioned built-in and user-defined metrics with anchored scales."
        ),
        { $ref: "#/components/schemas/WorkMetricDefinitionList" }
      ),
      post: withTypedResponse(
        writeOperation(
          "Create a Work metric definition version",
          "Canonical meanings remain stable when display labels change.",
          { $ref: "#/components/schemas/WorkMetricDefinitionInput" },
          [userParameter],
          true
        ),
        { $ref: "#/components/schemas/WorkMetricDefinitionEnvelope" },
        "201"
      )
    },
    "/api/v1/work/check-ins": {
      post: withReplayResponses(
        writeOperation(
          "Record a Work check-in",
          "Agent suggestions remain distinct from user-entered values and require explicit user-confirmation evidence before becoming confirmed.",
          { $ref: "#/components/schemas/WorkCheckInInput" },
          [userParameter],
          true
        ),
        { $ref: "#/components/schemas/WorkCheckInResult" }
      )
    },
    "/api/v1/work/metrics/trends": {
      get: withTypedResponse(
        readOperation(
          "Get Work metric trends",
          "Returns confirmed observations, scale-aware summaries, evidence-based meaningful changes, and non-aggregated concurrent-role comparisons.",
          [
            userParameter,
            {
              name: "engagementIds",
              in: "query",
              required: true,
              schema: { type: "array", items: { type: "string" } }
            },
            {
              name: "metricKeys",
              in: "query",
              schema: { type: "array", items: { type: "string" } }
            },
            {
              name: "windowDays",
              in: "query",
              schema: { type: "integer", minimum: 7, maximum: 730 }
            }
          ]
        ),
        { $ref: "#/components/schemas/WorkMetricTrends" }
      )
    },
    "/api/v1/work/campaigns": {
      get: withTypedResponse(
        readOperation(
          "List Opportunity Campaigns",
          "Several materially different searches may run concurrently.",
          listParameters
        ),
        { $ref: "#/components/schemas/OpportunityCampaignList" }
      ),
      post: withTypedResponse(
        writeOperation(
          "Create an Opportunity Campaign",
          "The campaign is a first-class search strategy, not a Task.",
          { $ref: "#/components/schemas/OpportunityCampaignInput" },
          [userParameter],
          true
        ),
        { $ref: "#/components/schemas/OpportunityCampaignEnvelope" },
        "201"
      )
    },
    "/api/v1/work/campaigns/{id}": {
      get: withTypedResponse(
        readOperation(
          "Get an Opportunity Campaign",
          "Returns criteria history, targets, evaluations, applications, and links.",
          rootDetailParameters
        ),
        { $ref: "#/components/schemas/OpportunityCampaignEnvelope" }
      ),
      patch: withTypedResponse(
        writeOperation(
          "Update an Opportunity Campaign",
          "Activation, pause, completion, abandonment, and archive preserve history.",
          patchSchema(campaignInput, ["id", "initialCriteria"]),
          rootDetailParameters
        ),
        { $ref: "#/components/schemas/OpportunityCampaignEnvelope" }
      )
    },
    "/api/v1/work/campaigns/{id}/criteria": {
      post: withTypedResponse(
        writeOperation(
          "Create a campaign criteria version",
          "Earlier opportunity evaluations retain the exact criteria version originally used.",
          {
            type: "object",
            additionalProperties: false,
            required: ["criteria"],
            properties: {
              criteria: {
                $ref: "#/components/schemas/CampaignCriteriaDocument"
              },
              rationale: { type: "string" },
              effectiveAt: { type: "string", format: "date-time" },
              provenance
            }
          },
          rootDetailParameters,
          true
        ),
        { $ref: "#/components/schemas/CampaignCriteriaVersionEnvelope" },
        "201"
      )
    },
    "/api/v1/work/opportunities": {
      get: withTypedResponse(
        readOperation(
          "List Job Opportunities",
          "Filters by campaign, disposition, employer, work model, missing facts, freshness, deadline, and text.",
          listParameters
        ),
        { $ref: "#/components/schemas/JobOpportunityList" }
      )
    },
    "/api/v1/work/opportunities/upsert": {
      post: withReplayResponses(
        writeOperation(
          "Upsert one sourced Job Opportunity",
          "Conservative identity and stable idempotency deduplicate a sourced role while preserving source evidence.",
          { $ref: "#/components/schemas/JobOpportunityInput" },
          [userParameter],
          true
        ),
        { $ref: "#/components/schemas/JobOpportunityUpsertResult" }
      )
    },
    "/api/v1/work/opportunities/{id}": {
      get: withTypedResponse(
        readOperation(
          "Get a Job Opportunity",
          "Includes sources, campaign-specific evaluation history, applications, and relationships.",
          rootDetailParameters
        ),
        { $ref: "#/components/schemas/JobOpportunityEnvelope" }
      ),
      patch: withTypedResponse(
        writeOperation(
          "Update a Job Opportunity",
          "Records user disposition, freshness, uncertainties, next action, or sourced fact corrections with optimistic concurrency.",
          patchSchema(jobOpportunityInput, ["id", "idempotencyKey"]),
          rootDetailParameters
        ),
        { $ref: "#/components/schemas/JobOpportunityEnvelope" }
      )
    },
    "/api/v1/work/campaigns/{campaignId}/opportunities/{opportunityId}/evaluations":
      {
        post: withTypedResponse(
          writeOperation(
            "Evaluate an opportunity against one campaign",
            "Every evaluation identifies the exact criteria version, evidence, confidence, hard gates, and human override reason.",
            { $ref: "#/components/schemas/OpportunityEvaluationInput" },
            [
              {
                name: "campaignId",
                in: "path",
                required: true,
                schema: { type: "string" }
              },
              {
                name: "opportunityId",
                in: "path",
                required: true,
                schema: { type: "string" }
              },
              userParameter
            ],
            true
          ),
          { $ref: "#/components/schemas/OpportunityEvaluationEnvelope" },
          "201"
        )
      },
    "/api/v1/work/applications": {
      get: withTypedResponse(
        readOperation(
          "List Job Applications",
          "Opportunity status and application status remain separate.",
          listParameters
        ),
        { $ref: "#/components/schemas/JobApplicationList" }
      ),
      post: withTypedResponse(
        writeOperation(
          "Create an application workspace",
          "Duplicate active submissions are rejected; preparation never implies submission.",
          { $ref: "#/components/schemas/JobApplicationInput" },
          [userParameter],
          true
        ),
        { $ref: "#/components/schemas/JobApplicationEnvelope" },
        "201"
      )
    },
    "/api/v1/work/applications/{id}": {
      get: withTypedResponse(
        readOperation(
          "Get an application workspace",
          "Private answers, contacts, links, and document-use metadata require work.transmit or operator authority.",
          rootDetailParameters
        ),
        { $ref: "#/components/schemas/JobApplicationEnvelope" }
      ),
      patch: withTypedResponse(
        writeOperation(
          "Update an application workspace",
          "Status changes use the guarded transition route.",
          patchSchema(jobApplicationInput, [
            "id",
            "opportunityId",
            "primaryCampaignId",
            "criteriaVersionId",
            "status",
            "reapplicationReason"
          ]),
          rootDetailParameters
        ),
        { $ref: "#/components/schemas/JobApplicationEnvelope" }
      )
    },
    "/api/v1/work/applications/{id}/transitions": {
      post: withTypedResponse(
        writeOperation(
          "Transition an application stage",
          "The state machine appends an immutable event. Submitted requires an exact authorized transmission plus direct completion evidence.",
          { $ref: "#/components/schemas/JobApplicationTransitionInput" },
          rootDetailParameters
        ),
        { $ref: "#/components/schemas/JobApplicationEnvelope" }
      )
    },
    "/api/v1/work/applications/{id}/events": {
      post: withReplayResponses(
        writeOperation(
          "Record application activity without inventing a stage change",
          "Appends an immutable email, acknowledgement, call, interview, assessment, request, follow-up, withdrawal, offer, rejection, correction, or note event. Lifecycle changes still use the guarded transition route.",
          { $ref: "#/components/schemas/JobApplicationEventInput" },
          rootDetailParameters,
          true
        ),
        { $ref: "#/components/schemas/JobApplicationEventResult" }
      )
    },
    "/api/v1/work/supporting/{kind}": {
      get: withTypedResponse(
        readOperation(
          "List a Work supporting collection",
          "Kinds cover targets, positioning profiles, document sets, reusable answers, questions, Artifact uses, interviews, offers, sources, saved queries, automation policies, and outreach.",
          [
            supportingKindParameter,
            userParameter,
            { name: "parentId", in: "query", schema: { type: "string" } },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", maximum: 50 }
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", minimum: 0 }
            }
          ]
        ),
        { $ref: "#/components/schemas/WorkSupportingList" }
      ),
      post: withTypedResponse(
        writeOperation(
          "Create a Work supporting record",
          "The selected kind determines the exact closed data schema. Private application records apply the private-field permission matrix.",
          {
            type: "object",
            additionalProperties: false,
            required: ["data"],
            properties: {
              data: { $ref: "#/components/schemas/WorkSupportingDataInput" }
            }
          },
          [
            supportingKindParameter,
            userParameter,
            { name: "parentId", in: "query", schema: { type: "string" } }
          ],
          true
        ),
        { $ref: "#/components/schemas/WorkSupportingEnvelope" },
        "201"
      )
    },
    "/api/v1/work/supporting/{kind}/{id}": {
      get: withTypedResponse(
        readOperation(
          "Read one authorized Work supporting record",
          "Private application records remain permission-gated.",
          [supportingKindParameter, idParameter, userParameter]
        ),
        { $ref: "#/components/schemas/WorkSupportingEnvelope" }
      ),
      patch: withTypedResponse(
        writeOperation(
          "Update a Work supporting record",
          "Uses the kind-specific closed patch schema, exact ID, and revision. Artifact-use records are immutable and reject this operation.",
          {
            type: "object",
            additionalProperties: false,
            required: ["expectedRevision", "data"],
            properties: {
              expectedRevision: { type: "integer", minimum: 1 },
              data: { $ref: "#/components/schemas/WorkSupportingDataPatch" }
            }
          },
          [supportingKindParameter, idParameter, userParameter]
        ),
        { $ref: "#/components/schemas/WorkSupportingEnvelope" }
      )
    },
    "/api/v1/work/search-runs": {
      get: withTypedResponse(
        readOperation(
          "List Search Runs",
          "Returns stable newest-first campaign automation history with optional campaign and status filters.",
          [
            userParameter,
            { name: "campaignId", in: "query", schema: { type: "string" } },
            {
              name: "status",
              in: "query",
              schema: {
                enum: ["running", "completed", "partial", "failed", "cancelled"]
              }
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 50, default: 25 }
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", minimum: 0, default: 0 }
            }
          ]
        ),
        { $ref: "#/components/schemas/WorkSearchRunList" }
      ),
      post: withReplayResponses(
        writeOperation(
          "Record a search run",
          "Stores criteria version, sources, queries, counts, failures, cost when known, evidence, and per-opportunity result kinds.",
          { $ref: "#/components/schemas/WorkSearchRunInput" },
          [userParameter],
          true
        ),
        { $ref: "#/components/schemas/WorkSearchRunResult" }
      )
    },
    "/api/v1/work/search-runs/{id}": {
      get: withTypedResponse(
        readOperation(
          "Read one Search Run",
          "Returns a bounded page of per-opportunity results and reports any items hidden by the current credential scope.",
          [
            idParameter,
            userParameter,
            {
              name: "limit",
              in: "query",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 200,
                default: 100
              }
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", minimum: 0, default: 0 }
            }
          ]
        ),
        { $ref: "#/components/schemas/WorkSearchRunDetail" }
      )
    },
    "/api/v1/work/offers/{id}/accept": {
      post: {
        ...withTypedResponse(
          writeOperation(
            "Accept an offer and create a planned Work Engagement",
            "The idempotent transaction links the accepted offer and application to exactly one planned engagement.",
            {
              type: "object",
              additionalProperties: false,
              required: ["expectedRevision", "idempotencyKey"],
              properties: {
                expectedRevision: { type: "integer", minimum: 1 },
                idempotencyKey: { type: "string" }
              }
            },
            rootDetailParameters
          ),
          { $ref: "#/components/schemas/WorkOfferAcceptanceResult" }
        ),
        description:
          "Requires work.transmit or an authenticated local operator session. If compensation is present, compensation authority is also required. Creates one planned Work Engagement and preserves offer and application history."
      }
    },
    "/api/v1/work/relationships/{entityType}/{id}": {
      get: withTypedResponse(
        readOperation(
          "List bidirectional Work relationships",
          "Inbound links never widen owner, project, tag, or sensitive-field authority.",
          [
            {
              name: "entityType",
              in: "path",
              required: true,
              schema: { type: "string" }
            },
            idParameter,
            userParameter
          ]
        ),
        { $ref: "#/components/schemas/WorkRelationshipEnvelope" }
      ),
      put: withTypedResponse(
        writeOperation(
          "Replace outgoing Work relationships",
          "Targets must share the owner and remain inside the credential's direct project and tag scope.",
          { $ref: "#/components/schemas/WorkRelationshipReplacementInput" },
          [
            {
              name: "entityType",
              in: "path",
              required: true,
              schema: { type: "string" }
            },
            idParameter,
            userParameter
          ]
        ),
        { $ref: "#/components/schemas/WorkRelationshipEnvelope" }
      )
    },
    "/api/v1/work/{entityType}/{id}/archive": {
      post: withTypedResponse(
        writeOperation(
          "Archive a Work root",
          "Soft deletion preserves history and supports restore.",
          {
            type: "object",
            additionalProperties: false,
            required: ["expectedRevision"],
            properties: { expectedRevision: { type: "integer", minimum: 1 } }
          },
          [
            {
              name: "entityType",
              in: "path",
              required: true,
              schema: {
                type: "string",
                enum: workEntityTypes.filter((type) =>
                  [
                    "work_organization",
                    "work_engagement",
                    "opportunity_campaign",
                    "job_opportunity",
                    "job_application"
                  ].includes(type)
                )
              }
            },
            idParameter,
            userParameter
          ]
        ),
        { $ref: "#/components/schemas/WorkRootRecordEnvelope" }
      )
    },
    "/api/v1/work/{entityType}/{id}/restore": {
      post: withTypedResponse(
        writeOperation(
          "Restore an archived Work root",
          "Restores the exact revisioned root.",
          {
            type: "object",
            additionalProperties: false,
            required: ["expectedRevision"],
            properties: { expectedRevision: { type: "integer", minimum: 1 } }
          },
          [
            {
              name: "entityType",
              in: "path",
              required: true,
              schema: {
                type: "string",
                enum: workEntityTypes.filter((type) =>
                  [
                    "work_organization",
                    "work_engagement",
                    "opportunity_campaign",
                    "job_opportunity",
                    "job_application"
                  ].includes(type)
                )
              }
            },
            idParameter,
            userParameter
          ]
        ),
        { $ref: "#/components/schemas/WorkRootRecordEnvelope" }
      )
    },
    "/api/v1/work/transmissions/previews": {
      post: {
        ...withReplayResponses(
          writeOperation(
            "Create an exact application transmission preview",
            "Requires work.transmit. The server verifies ready-to-submit state, approved answers, approved or sealed Artifact versions, unresolved gates, criteria-bound policy, Opportunity facts, and immutable checksums without sending anything.",
            { $ref: "#/components/schemas/WorkTransmissionPreviewInput" },
            [userParameter],
            true
          ),
          { $ref: "#/components/schemas/WorkTransmissionPreviewResult" }
        ),
        description:
          "Requires work.transmit or an authenticated local operator session. Creates a digest- and guard-context-bound review preview and never records submission."
      }
    },
    "/api/v1/work/transmissions/previews/{id}/request-approval": {
      post: withOnlyTypedSuccess(
        writeOperation(
          "Request approval for one exact transmission",
          "Requires work.transmit. The current application, policy, answers, Artifact approvals, Opportunity facts, gates, and digest must still exactly match. Approval authorizes one principal and never records submission.",
          {
            type: "object",
            additionalProperties: false,
            required: ["idempotencyKey"],
            properties: { idempotencyKey: { type: "string" } }
          },
          rootDetailParameters
        ),
        { $ref: "#/components/schemas/WorkTransmissionApprovalResult" },
        "202",
        "Approval request created"
      )
    },
    "/api/v1/work/transmissions/verified-submissions": {
      post: {
        ...withTypedResponse(
          writeOperation(
            "Record a directly verified submission",
            "Requires work.transmit, the same authorized principal, an unconsumed digest, unchanged guard context, and direct receipt, tracking, or Artifact evidence.",
            { $ref: "#/components/schemas/WorkVerifiedSubmissionInput" },
            [userParameter]
          ),
          { $ref: "#/components/schemas/WorkVerifiedSubmissionResult" }
        ),
        description:
          "Requires work.transmit or an authenticated local operator session. Consumes one exact authorization, appends a submitted event exactly once, and records exact answer and Artifact submitted-use history."
      }
    },
    "/api/v1/work/imports/preview": {
      post: {
        tags: ["Work"],
        summary: "Preview a private Work import",
        description:
          "Local operator only. Validates source and manifest digests, globally unique typed references, exact Artifact checksums, evidence-bound historical application status, insert-only dedupe, relationship authority, prohibited private data, and exhaustive rollback classes without writing.",
        security: [{ operatorSession: [] }],
        parameters: [userParameter],
        requestBody: body({ $ref: "#/components/schemas/WorkImportManifest" }),
        responses: {
          "200": response("Digest-bound import preview", {
            $ref: "#/components/schemas/WorkImportPreview"
          }),
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "403": { $ref: "#/components/responses/Error" },
          "409": { $ref: "#/components/responses/Error" }
        }
      }
    },
    "/api/v1/work/imports/apply": {
      post: {
        tags: ["Work"],
        summary: "Apply a reviewed private Work import",
        description:
          "Local operator only. Applies the unchanged preview atomically and insert-only, preserves exact criteria and application history, and records exact rollback inventory. No subjective Work metric is accepted or inferred.",
        security: [{ operatorSession: [] }],
        parameters: [userParameter],
        requestBody: body({
          type: "object",
          additionalProperties: false,
          required: ["manifest", "expectedPreviewDigest", "idempotencyKey"],
          properties: {
            manifest: { $ref: "#/components/schemas/WorkImportManifest" },
            expectedPreviewDigest: {
              type: "string",
              pattern: "^[a-f0-9]{64}$"
            },
            idempotencyKey: { type: "string", minLength: 1, maxLength: 200 }
          }
        }),
        responses: {
          "200": response("Import apply receipt", {
            $ref: "#/components/schemas/WorkImportApplyReceipt"
          }),
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "403": { $ref: "#/components/responses/Error" },
          "409": { $ref: "#/components/responses/Error" }
        }
      }
    },
    "/api/v1/work/imports/{id}/rollback-preview": {
      get: {
        tags: ["Work"],
        summary: "Preview exact import rollback",
        description:
          "Local operator only. Computes current fingerprints and the complete foreign-key, activity, and entity-link dependency closure. Any changed record or later dependency is a conflict.",
        security: [{ operatorSession: [] }],
        parameters: rootDetailParameters,
        responses: {
          "200": response("Exact rollback preview", {
            $ref: "#/components/schemas/WorkImportRollbackPreview"
          }),
          "401": { $ref: "#/components/responses/Error" },
          "403": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" }
        }
      }
    },
    "/api/v1/work/imports/{id}/rollback": {
      post: {
        tags: ["Work"],
        summary: "Apply exact import rollback",
        description:
          "Local operator only. Any changed row or later dependent aborts the whole transaction. Unchanged receipt-created non-roots and links are removed, eligible roots are soft-deleted, and exact removed identities and hashes remain in the immutable tombstone. A rolled-back root cannot be restored without re-importing its reviewed source.",
        security: [{ operatorSession: [] }],
        parameters: rootDetailParameters,
        requestBody: body({
          type: "object",
          additionalProperties: false,
          required: ["expectedRollbackPreviewDigest", "idempotencyKey"],
          properties: {
            expectedRollbackPreviewDigest: {
              type: "string",
              pattern: "^[a-f0-9]{64}$"
            },
            idempotencyKey: { type: "string", minLength: 1, maxLength: 200 }
          }
        }),
        responses: {
          "200": response("Import rollback tombstone", {
            $ref: "#/components/schemas/WorkImportRollbackResult"
          }),
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "403": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
          "409": { $ref: "#/components/responses/Error" }
        }
      }
    }
  };
}
