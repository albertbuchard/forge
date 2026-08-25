import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import type { AuthContext } from "../managers/contracts.js";
import type { AuthorizationManager } from "../managers/platform/authorization-manager.js";
import {
  createAgentAction,
  type CollaborationContext
} from "../repositories/collaboration.js";
import type { AgentTokenSummary } from "../types.js";
import { resolveWorkAccess, type WorkAccess } from "./access.js";
import { getCompleteWorkContext } from "./context.js";
import { applyWorkImport } from "./import-apply.js";
import { previewWorkImport } from "./import.js";
import {
  previewWorkImportRollback,
  rollbackWorkImport
} from "./import-rollback.js";
import {
  createWorkMetricDefinition,
  getWorkMetricTrends,
  listWorkMetricDefinitions,
  recordWorkCheckIn
} from "./metrics.js";
import {
  createCampaignCriteriaVersion,
  createJobApplication,
  createOpportunityCampaign,
  createWorkEngagement,
  createWorkOrganization,
  evaluateJobOpportunity,
  getAuthorizedRoot,
  getJobApplicationDetail,
  getJobOpportunityDetail,
  getOpportunityCampaignDetail,
  getWorkEngagementDetail,
  getWorkSettings,
  listAuthorizedWorkLinks,
  listWorkActivityHistory,
  listWorkRoots,
  replaceAuthorizedWorkLinks,
  recordJobApplicationEvent,
  restoreWorkRoot,
  softDeleteWorkRoot,
  transitionJobApplication,
  updateJobApplication,
  updateJobOpportunity,
  updateLookingForOpportunities,
  updateOpportunityCampaign,
  updateWorkEngagement,
  updateWorkOrganization,
  upsertJobOpportunity
} from "./repository.js";
import {
  acceptOfferAsPlannedEngagement,
  createSupportingRecord,
  getSearchRunDetail,
  getSupportingRecord,
  listSearchRuns,
  listSupportingRecords,
  recordSearchRun,
  updateSupportingRecord
} from "./supporting.js";
import {
  attachTransmissionApproval,
  buildTransmissionApprovalAction,
  createTransmissionPreview
} from "./transmission.js";
import { recordVerifiedSubmission } from "./transmission-submission.js";
import {
  createCriteriaVersionSchema,
  createJobApplicationSchema,
  createOpportunityCampaignSchema,
  createWorkEngagementSchema,
  createWorkOrganizationSchema,
  evaluationSchema,
  recordJobApplicationEventSchema,
  transitionJobApplicationSchema,
  updateJobApplicationSchema,
  updateJobOpportunitySchema,
  updateOpportunityCampaignSchema,
  updateWorkEngagementSchema,
  updateWorkOrganizationSchema,
  upsertJobOpportunitySchema,
  workEntityTypeSchema
} from "./types.js";
import {
  applicationQuestionSchema,
  artifactUseSchema,
  automationPolicySchema,
  documentSetSchema,
  interviewSchema,
  offerSchema,
  organizationTargetSchema,
  outreachSchema,
  positioningProfileSchema,
  recordSearchRunSchema,
  reusableResponseSchema,
  roleTargetSchema,
  savedQuerySchema,
  searchSourceSchema
} from "./types-supporting.js";
import {
  createWorkCheckInSchema,
  genericWorkRecordSchema,
  replaceWorkLinksSchema,
  transmissionPreviewSchema,
  verifiedSubmissionSchema,
  workImportManifestSchema,
  workListQuerySchema,
  workMetricDefinitionSchema
} from "./types-operations.js";

type WorkRouteDependencies = {
  authenticate(headers: Record<string, unknown>): AuthContext;
  authorization: AuthorizationManager;
  getTokenById(tokenId: string): AgentTokenSummary | undefined;
};

const idParamsSchema = z
  .object({ id: z.string().trim().min(1).max(240) })
  .strict();
const opportunityEvaluationParamsSchema = z
  .object({
    campaignId: z.string().trim().min(1).max(240),
    opportunityId: z.string().trim().min(1).max(240)
  })
  .strict();
const sourceParamsSchema = z
  .object({
    entityType: workEntityTypeSchema,
    id: z.string().trim().min(1).max(240)
  })
  .strict();
const archivableSourceParamsSchema = z
  .object({
    entityType: z.enum([
      "work_organization",
      "work_engagement",
      "opportunity_campaign",
      "job_opportunity",
      "job_application"
    ]),
    id: z.string().trim().min(1).max(240)
  })
  .strict();
const supportingKindSchema = z.enum([
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
]);
const supportingParamsSchema = z
  .object({ kind: supportingKindSchema })
  .strict();
const supportingRecordParamsSchema = z
  .object({ kind: supportingKindSchema, id: z.string().trim().min(1).max(240) })
  .strict();

function rawQuery(request: FastifyRequest) {
  return (request.query ?? {}) as Record<string, unknown>;
}

function domainQuery(request: FastifyRequest) {
  const { userId: _userId, userIds: _userIds, ...query } = rawQuery(request);
  return query;
}

function requireWorkScope(
  deps: WorkRouteDependencies,
  request: FastifyRequest,
  scope: "work.read" | "work.write" | "work.transmit",
  mutation = false
) {
  const auth = deps.authenticate(request.headers as Record<string, unknown>);
  deps.authorization.requireAuthenticatedActor(auth, {
    routeFamily: "work"
  });
  deps.authorization.requireTokenScope(auth, scope, {
    routeFamily: "work"
  });
  return {
    auth,
    access: resolveWorkAccess(auth, rawQuery(request), { mutation })
  };
}

function requireRead(deps: WorkRouteDependencies, request: FastifyRequest) {
  return requireWorkScope(deps, request, "work.read");
}

function requireWrite(deps: WorkRouteDependencies, request: FastifyRequest) {
  return requireWorkScope(deps, request, "work.write", true);
}

function requireTransmit(deps: WorkRouteDependencies, request: FastifyRequest) {
  return requireWorkScope(deps, request, "work.transmit", true);
}

function collaborationContext(
  deps: WorkRouteDependencies,
  auth: AuthContext
): CollaborationContext {
  return {
    actor: auth.actor,
    source: auth.source,
    token: auth.token ? (deps.getTokenById(auth.token.id) ?? null) : null
  };
}

function readParentId(request: FastifyRequest) {
  const value = domainQuery(request).parentId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function supportingData(
  kind: z.infer<typeof supportingKindSchema>,
  body: unknown,
  mode: "create" | "update"
) {
  const generic = genericWorkRecordSchema.parse(body ?? {});
  const data: Record<string, unknown> = { ...generic.data };
  delete data.id;
  delete data.expectedRevision;
  const parse = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) =>
    (mode === "update" ? schema.partial() : schema).parse(data);
  switch (kind) {
    case "roleTarget":
      return parse(roleTargetSchema.omit({ id: true, expectedRevision: true }));
    case "organizationTarget":
      return parse(
        organizationTargetSchema.omit({ id: true, expectedRevision: true })
      );
    case "positioningProfile":
      return parse(positioningProfileSchema);
    case "documentSet":
      return parse(documentSetSchema);
    case "reusableResponse":
      return parse(reusableResponseSchema);
    case "applicationQuestion":
      return parse(applicationQuestionSchema);
    case "artifactUse":
      if (mode === "update") {
        throw new HttpError(
          400,
          "work_supporting_update_invalid",
          "Application Artifact use records are immutable."
        );
      }
      return artifactUseSchema.parse(data);
    case "interview":
      return parse(interviewSchema);
    case "offer":
      return parse(offerSchema);
    case "searchSource":
      return parse(searchSourceSchema);
    case "savedQuery":
      return parse(savedQuerySchema);
    case "automationPolicy":
      return parse(automationPolicySchema);
    case "outreach":
      return parse(outreachSchema);
  }
}

function operatorImportAccess(
  deps: WorkRouteDependencies,
  request: FastifyRequest
): WorkAccess {
  const auth = deps.authenticate(request.headers as Record<string, unknown>);
  deps.authorization.requireAuthenticatedOperator(auth, {
    routeFamily: "work_import"
  });
  return resolveWorkAccess(auth, rawQuery(request), { mutation: true });
}

function registerWorkOverviewRoutes(
  app: FastifyInstance,
  deps: WorkRouteDependencies
) {
  app.get("/api/v1/work", async (request) => {
    const { access } = requireRead(deps, request);
    return getCompleteWorkContext(access, { trendWindowDays: 90 });
  });

  app.get("/api/v1/work/context", async (request) => {
    const { access } = requireRead(deps, request);
    const query = z
      .object({
        engagementId: z.string().trim().min(1).max(240).optional(),
        campaignId: z.string().trim().min(1).max(240).optional(),
        trendWindowDays: z.coerce.number().int().min(7).max(730).default(90)
      })
      .strict()
      .parse(domainQuery(request));
    return getCompleteWorkContext(access, query);
  });

  app.get("/api/v1/work/settings", async (request) => {
    const { access } = requireRead(deps, request);
    return { settings: getWorkSettings(access) };
  });

  app.patch("/api/v1/work/settings/opportunity-search", async (request) => {
    const { access } = requireWrite(deps, request);
    const body = z
      .object({
        lookingForOpportunities: z.boolean(),
        expectedRevision: z.number().int().min(0)
      })
      .strict()
      .parse(request.body ?? {});
    return {
      settings: updateLookingForOpportunities({
        access,
        looking: body.lookingForOpportunities,
        expectedRevision: body.expectedRevision
      })
    };
  });

  app.get("/api/v1/work/organizations", async (request) => {
    const { access } = requireRead(deps, request);
    return listWorkRoots(
      "work_organization",
      access,
      workListQuerySchema.parse(domainQuery(request))
    );
  });

  app.post("/api/v1/work/organizations", async (request, reply) => {
    const { access } = requireWrite(deps, request);
    const organization = createWorkOrganization(
      access,
      createWorkOrganizationSchema.parse(request.body ?? {})
    );
    reply.code(201);
    return { organization };
  });

  app.get("/api/v1/work/organizations/:id", async (request) => {
    const { access } = requireRead(deps, request);
    const { id } = idParamsSchema.parse(request.params);
    return {
      organization: {
        ...getAuthorizedRoot("work_organization", id, access),
        history: listWorkActivityHistory("work_organization", id, access)
      },
      links: listAuthorizedWorkLinks("work_organization", id, access)
    };
  });

  app.patch("/api/v1/work/organizations/:id", async (request) => {
    const { access } = requireWrite(deps, request);
    const { id } = idParamsSchema.parse(request.params);
    return {
      organization: updateWorkOrganization(
        access,
        id,
        updateWorkOrganizationSchema.parse(request.body ?? {})
      )
    };
  });

  app.get("/api/v1/work/engagements", async (request) => {
    const { access } = requireRead(deps, request);
    return listWorkRoots(
      "work_engagement",
      access,
      workListQuerySchema.parse(domainQuery(request))
    );
  });

  app.post("/api/v1/work/engagements", async (request, reply) => {
    const { access } = requireWrite(deps, request);
    const engagement = createWorkEngagement(
      access,
      createWorkEngagementSchema.parse(request.body ?? {})
    );
    reply.code(201);
    return { engagement };
  });

  app.get("/api/v1/work/engagements/:id", async (request) => {
    const { access } = requireRead(deps, request);
    const { id } = idParamsSchema.parse(request.params);
    const query = z
      .object({ archived: z.enum(["exclude", "include"]).default("exclude") })
      .strict()
      .parse(domainQuery(request));
    return {
      engagement: getWorkEngagementDetail(access, id, {
        includeArchived: query.archived === "include"
      })
    };
  });

  app.patch("/api/v1/work/engagements/:id", async (request) => {
    const { access } = requireWrite(deps, request);
    const { id } = idParamsSchema.parse(request.params);
    return {
      engagement: updateWorkEngagement(
        access,
        id,
        updateWorkEngagementSchema.parse(request.body ?? {})
      )
    };
  });
}

function registerWorkMetricRoutes(
  app: FastifyInstance,
  deps: WorkRouteDependencies
) {
  app.get("/api/v1/work/metrics/definitions", async (request) => {
    const { access } = requireRead(deps, request);
    return { definitions: listWorkMetricDefinitions(access) };
  });

  app.post("/api/v1/work/metrics/definitions", async (request, reply) => {
    const { access } = requireWrite(deps, request);
    const definition = createWorkMetricDefinition({
      access,
      definition: workMetricDefinitionSchema.parse(request.body ?? {})
    });
    reply.code(201);
    return { definition };
  });

  app.post("/api/v1/work/check-ins", async (request, reply) => {
    const { access } = requireWrite(deps, request);
    const result = recordWorkCheckIn(
      access,
      createWorkCheckInSchema.parse(request.body ?? {})
    );
    reply.code(result.replayed ? 200 : 201);
    return result;
  });

  app.get("/api/v1/work/metrics/trends", async (request) => {
    const { access } = requireRead(deps, request);
    const query = z
      .object({
        engagementIds: z
          .union([z.string(), z.array(z.string())])
          .transform((value) =>
            Array.isArray(value)
              ? value
              : value
                  .split(",")
                  .map((entry) => entry.trim())
                  .filter(Boolean)
          ),
        metricKeys: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .transform((value) =>
            value === undefined
              ? undefined
              : Array.isArray(value)
                ? value
                : value
                    .split(",")
                    .map((entry) => entry.trim())
                    .filter(Boolean)
          ),
        windowDays: z.coerce.number().int().min(7).max(730).default(90)
      })
      .strict()
      .parse(domainQuery(request));
    return getWorkMetricTrends({ access, ...query });
  });
}

function registerWorkOpportunityRoutes(
  app: FastifyInstance,
  deps: WorkRouteDependencies
) {
  app.get("/api/v1/work/campaigns", async (request) => {
    const { access } = requireRead(deps, request);
    return listWorkRoots(
      "opportunity_campaign",
      access,
      workListQuerySchema.parse(domainQuery(request))
    );
  });

  app.post("/api/v1/work/campaigns", async (request, reply) => {
    const { access } = requireWrite(deps, request);
    const campaign = createOpportunityCampaign(
      access,
      createOpportunityCampaignSchema.parse(request.body ?? {})
    );
    reply.code(201);
    return { campaign };
  });

  app.get("/api/v1/work/campaigns/:id", async (request) => {
    const { access } = requireRead(deps, request);
    const { id } = idParamsSchema.parse(request.params);
    return { campaign: getOpportunityCampaignDetail(access, id) };
  });

  app.patch("/api/v1/work/campaigns/:id", async (request) => {
    const { access } = requireWrite(deps, request);
    const { id } = idParamsSchema.parse(request.params);
    return {
      campaign: updateOpportunityCampaign(
        access,
        id,
        updateOpportunityCampaignSchema.parse(request.body ?? {})
      )
    };
  });

  app.post("/api/v1/work/campaigns/:id/criteria", async (request, reply) => {
    const { access } = requireWrite(deps, request);
    const { id } = idParamsSchema.parse(request.params);
    const criteriaVersion = createCampaignCriteriaVersion(
      access,
      id,
      createCriteriaVersionSchema.parse(request.body ?? {})
    );
    reply.code(201);
    return { criteriaVersion };
  });

  app.get("/api/v1/work/opportunities", async (request) => {
    const { access } = requireRead(deps, request);
    return listWorkRoots(
      "job_opportunity",
      access,
      workListQuerySchema.parse(domainQuery(request))
    );
  });

  app.post("/api/v1/work/opportunities/upsert", async (request, reply) => {
    const { access } = requireWrite(deps, request);
    const result = upsertJobOpportunity(
      access,
      upsertJobOpportunitySchema.parse(request.body ?? {})
    );
    reply.code(result.replayed || result.deduplicated ? 200 : 201);
    return result;
  });

  app.get("/api/v1/work/opportunities/:id", async (request) => {
    const { access } = requireRead(deps, request);
    const { id } = idParamsSchema.parse(request.params);
    return { opportunity: getJobOpportunityDetail(access, id) };
  });

  app.patch("/api/v1/work/opportunities/:id", async (request) => {
    const { access } = requireWrite(deps, request);
    const { id } = idParamsSchema.parse(request.params);
    return {
      opportunity: updateJobOpportunity(
        access,
        id,
        updateJobOpportunitySchema.parse(request.body ?? {})
      )
    };
  });

  app.post(
    "/api/v1/work/campaigns/:campaignId/opportunities/:opportunityId/evaluations",
    async (request, reply) => {
      const { access } = requireWrite(deps, request);
      const params = opportunityEvaluationParamsSchema.parse(request.params);
      const evaluation = evaluateJobOpportunity({
        access,
        ...params,
        evaluation: evaluationSchema.parse(request.body ?? {})
      });
      reply.code(201);
      return { evaluation };
    }
  );
}

function registerWorkApplicationRoutes(
  app: FastifyInstance,
  deps: WorkRouteDependencies
) {
  app.get("/api/v1/work/applications", async (request) => {
    const { access } = requireRead(deps, request);
    return listWorkRoots(
      "job_application",
      access,
      workListQuerySchema.parse(domainQuery(request))
    );
  });

  app.post("/api/v1/work/applications", async (request, reply) => {
    const { access } = requireWrite(deps, request);
    const application = createJobApplication(
      access,
      createJobApplicationSchema.parse(request.body ?? {})
    );
    reply.code(201);
    return { application };
  });

  app.get("/api/v1/work/applications/:id", async (request) => {
    const { access } = requireRead(deps, request);
    const { id } = idParamsSchema.parse(request.params);
    return { application: getJobApplicationDetail(access, id) };
  });

  app.patch("/api/v1/work/applications/:id", async (request) => {
    const { access } = requireWrite(deps, request);
    const { id } = idParamsSchema.parse(request.params);
    return {
      application: updateJobApplication(
        access,
        id,
        updateJobApplicationSchema.parse(request.body ?? {})
      )
    };
  });

  app.post("/api/v1/work/applications/:id/transitions", async (request) => {
    const { access } = requireWrite(deps, request);
    const { id } = idParamsSchema.parse(request.params);
    const transition = transitionJobApplicationSchema.parse(request.body ?? {});
    return {
      application: transitionJobApplication({
        access,
        id,
        expectedRevision: transition.expectedRevision,
        newStatus: transition.newStatus,
        occurredAt: transition.occurredAt,
        factualDescription: transition.factualDescription,
        outcome: transition.outcome,
        nextAction: transition.nextAction,
        dueAt: transition.dueAt ?? null,
        sourceArtifactId: transition.sourceArtifactId,
        confidence: transition.confidence,
        provenance: transition.provenance
      })
    };
  });

  app.post("/api/v1/work/applications/:id/events", async (request, reply) => {
    const { access } = requireWrite(deps, request);
    const { id } = idParamsSchema.parse(request.params);
    const result = recordJobApplicationEvent(
      access,
      id,
      recordJobApplicationEventSchema.parse(request.body ?? {})
    );
    reply.code(result.replayed ? 200 : 201);
    return result;
  });
}

function registerWorkSupportingRoutes(
  app: FastifyInstance,
  deps: WorkRouteDependencies
) {
  app.get("/api/v1/work/supporting/:kind", async (request) => {
    const { access } = requireRead(deps, request);
    const { kind } = supportingParamsSchema.parse(request.params);
    const query = z
      .object({
        parentId: z.string().trim().min(1).max(240).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(25),
        offset: z.coerce.number().int().min(0).default(0)
      })
      .strict()
      .parse(domainQuery(request));
    return listSupportingRecords({ kind, access, ...query });
  });

  app.post("/api/v1/work/supporting/:kind", async (request, reply) => {
    const { access } = requireWrite(deps, request);
    const { kind } = supportingParamsSchema.parse(request.params);
    const record = createSupportingRecord({
      kind,
      access,
      parentId: readParentId(request),
      data: supportingData(kind, request.body, "create")
    });
    reply.code(201);
    return { record };
  });

  app.get("/api/v1/work/supporting/:kind/:id", async (request) => {
    const { access } = requireRead(deps, request);
    const { kind, id } = supportingRecordParamsSchema.parse(request.params);
    return { record: getSupportingRecord({ kind, id, access }) };
  });

  app.patch("/api/v1/work/supporting/:kind/:id", async (request) => {
    const { access } = requireWrite(deps, request);
    const { kind, id } = supportingRecordParamsSchema.parse(request.params);
    const body = genericWorkRecordSchema.parse(request.body ?? {});
    if (body.expectedRevision === undefined) {
      throw new HttpError(
        400,
        "work_expected_revision_required",
        "Updating a Work supporting record requires expectedRevision."
      );
    }
    return {
      record: updateSupportingRecord({
        kind,
        id,
        access,
        expectedRevision: body.expectedRevision,
        data: supportingData(kind, request.body, "update")
      })
    };
  });
}

function registerWorkOperationsRoutes(
  app: FastifyInstance,
  deps: WorkRouteDependencies
) {
  app.get("/api/v1/work/search-runs", async (request) => {
    const { access } = requireRead(deps, request);
    const query = z
      .object({
        campaignId: z.string().trim().min(1).max(240).optional(),
        status: z
          .enum(["running", "completed", "partial", "failed", "cancelled"])
          .optional(),
        limit: z.coerce.number().int().min(1).max(50).default(25),
        offset: z.coerce.number().int().min(0).default(0)
      })
      .strict()
      .parse(domainQuery(request));
    return listSearchRuns({ access, ...query });
  });

  app.get("/api/v1/work/search-runs/:id", async (request) => {
    const { access } = requireRead(deps, request);
    const { id } = idParamsSchema.parse(request.params);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(100),
        offset: z.coerce.number().int().min(0).default(0)
      })
      .strict()
      .parse(domainQuery(request));
    return getSearchRunDetail({ access, id, ...query });
  });

  app.post("/api/v1/work/search-runs", async (request, reply) => {
    const { access } = requireWrite(deps, request);
    const body = recordSearchRunSchema.parse(request.body ?? {});
    const result = recordSearchRun({ access, ...body });
    reply.code(result.replayed ? 200 : 201);
    return result;
  });

  app.post("/api/v1/work/offers/:id/accept", async (request) => {
    const { access } = requireTransmit(deps, request);
    const { id } = idParamsSchema.parse(request.params);
    const body = z
      .object({
        expectedRevision: z.number().int().min(1),
        idempotencyKey: z.string().trim().min(1).max(200)
      })
      .strict()
      .parse(request.body ?? {});
    return acceptOfferAsPlannedEngagement({
      access,
      offerId: id,
      expectedOfferRevision: body.expectedRevision,
      idempotencyKey: body.idempotencyKey
    });
  });

  app.get("/api/v1/work/relationships/:entityType/:id", async (request) => {
    const { access } = requireRead(deps, request);
    const params = sourceParamsSchema.parse(request.params);
    return {
      links: listAuthorizedWorkLinks(params.entityType, params.id, access)
    };
  });

  app.put("/api/v1/work/relationships/:entityType/:id", async (request) => {
    const { access } = requireWrite(deps, request);
    const params = sourceParamsSchema.parse(request.params);
    const body = replaceWorkLinksSchema.parse(request.body ?? {});
    return {
      links: replaceAuthorizedWorkLinks({
        sourceEntityType: params.entityType,
        sourceEntityId: params.id,
        access,
        expectedRevision: body.expectedRevision,
        links: body.links
      })
    };
  });

  app.post("/api/v1/work/:entityType/:id/archive", async (request) => {
    const { access } = requireWrite(deps, request);
    const params = archivableSourceParamsSchema.parse(request.params);
    const body = z
      .object({ expectedRevision: z.number().int().min(1) })
      .strict()
      .parse(request.body ?? {});
    return {
      record: softDeleteWorkRoot(
        access,
        params.entityType,
        params.id,
        body.expectedRevision
      )
    };
  });

  app.post("/api/v1/work/:entityType/:id/restore", async (request) => {
    const { access } = requireWrite(deps, request);
    const params = archivableSourceParamsSchema.parse(request.params);
    const body = z
      .object({ expectedRevision: z.number().int().min(1) })
      .strict()
      .parse(request.body ?? {});
    return {
      record: restoreWorkRoot(
        access,
        params.entityType,
        params.id,
        body.expectedRevision
      )
    };
  });
}

function registerWorkTransmissionRoutes(
  app: FastifyInstance,
  deps: WorkRouteDependencies
) {
  app.post("/api/v1/work/transmissions/previews", async (request, reply) => {
    const { access } = requireTransmit(deps, request);
    const result = createTransmissionPreview(
      access,
      transmissionPreviewSchema.parse(request.body ?? {})
    );
    reply.code(result.replayed ? 200 : 201);
    return result;
  });

  app.post(
    "/api/v1/work/transmissions/previews/:id/request-approval",
    async (request, reply) => {
      const { access, auth } = requireTransmit(deps, request);
      const { id } = idParamsSchema.parse(request.params);
      const body = z
        .object({ idempotencyKey: z.string().trim().min(1).max(200) })
        .strict()
        .parse(request.body ?? {});
      const result = runInTransaction(() => {
        const created = createAgentAction(
          buildTransmissionApprovalAction({ access, previewId: id }),
          collaborationContext(deps, auth),
          body.idempotencyKey
        );
        if (!created.approvalRequest) {
          throw new HttpError(
            409,
            "work_transmission_approval_required",
            "An application transmission always requires one exact approval."
          );
        }
        const preview = attachTransmissionApproval({
          previewId: id,
          actionId: created.action.id,
          approvalRequestId: created.approvalRequest.id,
          access
        });
        return { ...created, preview };
      });
      reply.code(202);
      return result;
    }
  );

  app.post(
    "/api/v1/work/transmissions/verified-submissions",
    async (request) => {
      const { access } = requireTransmit(deps, request);
      return recordVerifiedSubmission({
        access,
        ...verifiedSubmissionSchema.parse(request.body ?? {})
      });
    }
  );
}

function registerWorkImportRoutes(
  app: FastifyInstance,
  deps: WorkRouteDependencies
) {
  app.post("/api/v1/work/imports/preview", async (request) => {
    const access = operatorImportAccess(deps, request);
    return previewWorkImport(
      access,
      workImportManifestSchema.parse(request.body ?? {})
    );
  });

  app.post("/api/v1/work/imports/apply", async (request) => {
    const access = operatorImportAccess(deps, request);
    const body = z
      .object({
        manifest: workImportManifestSchema,
        expectedPreviewDigest: z.string().regex(/^[a-f0-9]{64}$/u),
        idempotencyKey: z.string().trim().min(1).max(200)
      })
      .strict()
      .parse(request.body ?? {});
    return applyWorkImport({ access, ...body });
  });

  app.get("/api/v1/work/imports/:id/rollback-preview", async (request) => {
    const access = operatorImportAccess(deps, request);
    const { id } = idParamsSchema.parse(request.params);
    return previewWorkImportRollback(access, id);
  });

  app.post("/api/v1/work/imports/:id/rollback", async (request) => {
    const access = operatorImportAccess(deps, request);
    const { id } = idParamsSchema.parse(request.params);
    const body = z
      .object({
        expectedRollbackPreviewDigest: z.string().regex(/^[a-f0-9]{64}$/u),
        idempotencyKey: z.string().trim().min(1).max(200)
      })
      .strict()
      .parse(request.body ?? {});
    return rollbackWorkImport({ access, receiptId: id, ...body });
  });
}

export async function registerWorkRoutes(
  app: FastifyInstance,
  deps: WorkRouteDependencies
) {
  registerWorkOverviewRoutes(app, deps);
  registerWorkMetricRoutes(app, deps);
  registerWorkOpportunityRoutes(app, deps);
  registerWorkApplicationRoutes(app, deps);
  registerWorkSupportingRoutes(app, deps);
  registerWorkOperationsRoutes(app, deps);
  registerWorkTransmissionRoutes(app, deps);
  registerWorkImportRoutes(app, deps);
}
