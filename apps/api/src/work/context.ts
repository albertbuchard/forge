import { Buffer } from "node:buffer";
import { getDatabase } from "../db.js";
import { HttpError } from "../errors.js";
import type { WorkAccess } from "./access.js";
import { getWorkMetricTrends } from "./metrics.js";
import {
  fingerprint,
  getAuthorizedRoot,
  listAuthorizedWorkLinks,
  rootConfig,
  rootScopeSql,
  rowToWorkRecord,
  summarizeAuthorizedWorkLinks,
  type SqlRow
} from "./repository-helpers.js";
import { getWorkSettings } from "./repository.js";
import { getSearchRunDetail } from "./supporting.js";
import { WORK_CONTEXT_MAX_BYTES, WORK_CONTEXT_NESTED_MAX } from "./types.js";

type ContextOptions = {
  engagementId?: string;
  campaignId?: string;
  trendWindowDays?: number;
};

function scopedRows(input: {
  access: WorkAccess;
  entityType: string;
  where?: string;
  values?: Array<string | number>;
  order: string;
  limit?: number;
}) {
  const config = rootConfig(input.entityType);
  const scope = rootScopeSql(input.access, config);
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM ${config.table}
       WHERE ${scope.sql}
         ${config.supportsDeleted ? "AND deleted_at IS NULL" : ""}
         ${input.where ? `AND (${input.where})` : ""}
       ORDER BY ${input.order}
       LIMIT ?`
    )
    .all(
      ...scope.values,
      ...(input.values ?? []),
      input.limit ?? WORK_CONTEXT_NESTED_MAX
    ) as SqlRow[];
  return rows.map((row) => rowToWorkRecord(row, input.access));
}

function countScopedRoots(input: {
  access: WorkAccess;
  entityType: string;
  where?: string;
  values?: Array<string | number>;
}) {
  const config = rootConfig(input.entityType);
  const scope = rootScopeSql(input.access, config);
  const row = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS count FROM ${config.table}
       WHERE ${scope.sql}
         ${config.supportsDeleted ? "AND deleted_at IS NULL" : ""}
         ${input.where ? `AND (${input.where})` : ""}`
    )
    .get(...scope.values, ...(input.values ?? [])) as { count: number };
  return Number(row.count);
}

function latestRows(
  table: string,
  foreignKey: string,
  parentId: string,
  order: string,
  access: WorkAccess,
  limit = 5
) {
  return (
    getDatabase()
      .prepare(
        `SELECT * FROM ${table}
         WHERE ${foreignKey} = ?
         ORDER BY ${order}
         LIMIT ?`
      )
      .all(parentId, Math.min(limit, WORK_CONTEXT_NESTED_MAX)) as SqlRow[]
  ).map((row) => rowToWorkRecord(row, access));
}

function summarizeCriteria(row: Record<string, unknown> | null) {
  if (!row) return null;
  const document = row.criteria as Record<string, unknown> | undefined;
  const criteria = Array.isArray(document?.criteria)
    ? (document?.criteria as Array<Record<string, unknown>>)
    : [];
  const exposed = criteria.slice(0, WORK_CONTEXT_NESTED_MAX);
  return {
    id: row.id,
    version: row.version,
    effectiveAt: row.effectiveAt,
    rationale: row.rationale,
    digest: fingerprint(document ?? {}),
    criterionCount: criteria.length,
    criteria: exposed,
    criteriaPage: {
      returned: exposed.length,
      total: criteria.length,
      hasMore: criteria.length > exposed.length,
      nextOffset: criteria.length > exposed.length ? exposed.length : null
    },
    dealBreakers: Array.isArray(document?.dealBreakers)
      ? document.dealBreakers
      : [],
    acceptableTradeoffs: Array.isArray(document?.acceptableTradeoffs)
      ? document.acceptableTradeoffs
      : [],
    uncertaintyTolerance: document?.uncertaintyTolerance ?? "medium",
    minimumConfidence: document?.minimumConfidence ?? null
  };
}

function engagementContext(
  access: WorkAccess,
  engagement: Record<string, unknown>,
  trendSeries: ReturnType<typeof getWorkMetricTrends>["series"]
) {
  const id = String(engagement.id);
  const latestCheckIns = latestRows(
    "work_check_ins",
    "engagement_id",
    id,
    "observed_at DESC, id DESC",
    access,
    5
  );
  const latestObservations = latestRows(
    "work_metric_observations",
    "engagement_id",
    id,
    "observed_at DESC, id DESC",
    access,
    WORK_CONTEXT_NESTED_MAX
  ).filter((observation) => observation.confirmationState === "confirmed");
  return {
    ...engagement,
    latestCheckIns,
    latestObservations,
    trends: trendSeries
      .filter((series) => series.engagementId === id)
      .map((series) => ({
        ...series,
        points: Array.isArray(series.points) ? series.points.slice(-10) : []
      })),
    links: listAuthorizedWorkLinks("work_engagement", id, access).slice(
      0,
      WORK_CONTEXT_NESTED_MAX
    ),
    related: summarizeAuthorizedWorkLinks(
      "work_engagement",
      id,
      access,
      WORK_CONTEXT_NESTED_MAX
    )
  };
}

function latestCampaignEvaluations(access: WorkAccess, campaignId: string) {
  return (
    getDatabase()
      .prepare(
        `SELECT evaluation.*
         FROM campaign_opportunity_evaluations evaluation
         JOIN (
           SELECT opportunity_id, MAX(evaluation_version) AS version
           FROM campaign_opportunity_evaluations
           WHERE campaign_id = ?
           GROUP BY opportunity_id
         ) latest
           ON latest.opportunity_id = evaluation.opportunity_id
          AND latest.version = evaluation.evaluation_version
         WHERE evaluation.campaign_id = ?
         ORDER BY evaluation.evaluated_at DESC, evaluation.id DESC
         LIMIT ?`
      )
      .all(campaignId, campaignId, WORK_CONTEXT_NESTED_MAX) as SqlRow[]
  ).map((row) => rowToWorkRecord(row, access));
}

function campaignContext(
  access: WorkAccess,
  campaign: Record<string, unknown>
) {
  const id = String(campaign.id);
  const criteriaRows = latestRows(
    "campaign_criteria_versions",
    "campaign_id",
    id,
    "version DESC",
    access,
    1
  );
  const roleTargets = latestRows(
    "campaign_role_targets",
    "campaign_id",
    id,
    "priority DESC, updated_at DESC",
    access,
    WORK_CONTEXT_NESTED_MAX
  );
  const organizationTargets = latestRows(
    "campaign_organization_targets",
    "campaign_id",
    id,
    "updated_at DESC",
    access,
    WORK_CONTEXT_NESTED_MAX
  );
  const policies = latestRows(
    "job_automation_policies",
    "campaign_id",
    id,
    "updated_at DESC",
    access,
    5
  );
  const searchSources = latestRows(
    "job_search_sources",
    "campaign_id",
    id,
    "updated_at DESC",
    access,
    20
  );
  const savedQueries = latestRows(
    "job_saved_queries",
    "campaign_id",
    id,
    "updated_at DESC",
    access,
    10
  );
  const searchRunRows = latestRows(
    "job_search_runs",
    "campaign_id",
    id,
    "started_at DESC, id DESC",
    access,
    10
  );
  const searchRuns = searchRunRows.map((run) => {
    const detail = getSearchRunDetail({
      access,
      id: String(run.id),
      limit: WORK_CONTEXT_NESTED_MAX,
      offset: 0
    });
    return {
      ...detail.run,
      items: detail.items,
      restrictedItemCount: detail.restrictedItemCount,
      itemPage: detail.page
    };
  });
  const evaluations = latestCampaignEvaluations(access, id);
  const applications = scopedRows({
    access,
    entityType: "job_application",
    where: "primary_campaign_id = ?",
    values: [id],
    order: "updated_at DESC, id ASC"
  });
  const applicationIds = applications.map((application) =>
    String(application.id)
  );
  const opportunityIds = Array.from(
    new Set([
      ...evaluations.map((evaluation) => String(evaluation.opportunityId)),
      ...applications.map((application) => String(application.opportunityId))
    ])
  ).slice(0, WORK_CONTEXT_NESTED_MAX);
  const opportunities = opportunityIds.flatMap((opportunityId) => {
    try {
      const opportunity = getAuthorizedRoot(
        "job_opportunity",
        opportunityId,
        access
      );
      return [
        {
          id: opportunity.id,
          title: opportunity.title,
          employerName: opportunity.employerName,
          disposition: opportunity.disposition,
          availabilityStatus: opportunity.availabilityStatus,
          applicationDeadline: opportunity.applicationDeadline,
          nextAction: opportunity.nextAction,
          unknowns: opportunity.unknowns,
          redFlags: opportunity.redFlags,
          updatedAt: opportunity.updatedAt
        }
      ];
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 404) return [];
      throw error;
    }
  });
  const stageCounts = Object.fromEntries(
    [
      ...new Set(applications.map((application) => String(application.status)))
    ].map((status) => [
      status,
      applications.filter((application) => application.status === status).length
    ])
  );
  return {
    ...campaign,
    currentCriteria: summarizeCriteria(criteriaRows[0] ?? null),
    roleTargets,
    organizationTargets,
    searchSources,
    automationPolicies: policies,
    savedQueries,
    recentSearchRuns: searchRuns,
    latestEvaluations: evaluations,
    opportunities,
    applications,
    pipeline: {
      returnedApplications: applicationIds.length,
      stageCounts,
      hasMore: applications.length === WORK_CONTEXT_NESTED_MAX
    },
    links: listAuthorizedWorkLinks("opportunity_campaign", id, access).slice(
      0,
      WORK_CONTEXT_NESTED_MAX
    ),
    related: summarizeAuthorizedWorkLinks(
      "opportunity_campaign",
      id,
      access,
      WORK_CONTEXT_NESTED_MAX
    )
  };
}

function byteLength(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function enforceContextBound(payload: Record<string, unknown>) {
  const bytes = byteLength(payload);
  if (bytes <= WORK_CONTEXT_MAX_BYTES) {
    return {
      ...payload,
      contextBytes: bytes,
      contextByteLimit: WORK_CONTEXT_MAX_BYTES
    };
  }
  const reduced = structuredClone(payload) as Record<string, unknown>;
  const engagements = Array.isArray(reduced.engagements)
    ? (reduced.engagements as Array<Record<string, unknown>>)
    : [];
  const campaigns = Array.isArray(reduced.campaigns)
    ? (reduced.campaigns as Array<Record<string, unknown>>)
    : [];
  for (const engagement of engagements) {
    engagement.latestCheckIns =
      (engagement.latestCheckIns as unknown[] | undefined)?.slice(0, 3) ?? [];
    engagement.latestObservations =
      (engagement.latestObservations as unknown[] | undefined)?.slice(0, 10) ??
      [];
    engagement.trends =
      (engagement.trends as unknown[] | undefined)?.slice(0, 10) ?? [];
  }
  for (const campaign of campaigns) {
    campaign.roleTargets =
      (campaign.roleTargets as unknown[] | undefined)?.slice(0, 10) ?? [];
    campaign.organizationTargets =
      (campaign.organizationTargets as unknown[] | undefined)?.slice(0, 10) ??
      [];
    campaign.searchSources =
      (campaign.searchSources as unknown[] | undefined)?.slice(0, 10) ?? [];
    campaign.latestEvaluations =
      (campaign.latestEvaluations as unknown[] | undefined)?.slice(0, 10) ?? [];
    campaign.opportunities =
      (campaign.opportunities as unknown[] | undefined)?.slice(0, 10) ?? [];
    campaign.applications =
      (campaign.applications as unknown[] | undefined)?.slice(0, 10) ?? [];
    const currentCriteria = campaign.currentCriteria as Record<
      string,
      unknown
    > | null;
    if (currentCriteria)
      currentCriteria.criteria =
        (currentCriteria.criteria as unknown[] | undefined)?.slice(0, 10) ?? [];
  }
  reduced.metricComparisons =
    (reduced.metricComparisons as unknown[] | undefined)?.slice(0, 10) ?? [];
  reduced.contextTruncated = true;
  reduced.contextTruncationReason =
    "The bounded Work context exceeded 256 KiB; nested collections were reduced and retain continuation metadata.";
  const reducedBytes = byteLength(reduced);
  if (reducedBytes > WORK_CONTEXT_MAX_BYTES) {
    throw new HttpError(
      413,
      "work_context_too_large",
      "The authorized Work context is too large for the bounded compound response. Request one engagement or campaign context."
    );
  }
  return {
    ...reduced,
    contextBytes: reducedBytes,
    contextByteLimit: WORK_CONTEXT_MAX_BYTES
  };
}

export function getCompleteWorkContext(
  access: WorkAccess,
  options: ContextOptions = {}
) {
  const trendWindowDays = Math.min(
    Math.max(options.trendWindowDays ?? 90, 7),
    730
  );
  if (options.engagementId) {
    getAuthorizedRoot("work_engagement", options.engagementId, access);
  }
  if (options.campaignId) {
    getAuthorizedRoot("opportunity_campaign", options.campaignId, access);
  }
  const engagementRows = scopedRows({
    access,
    entityType: "work_engagement",
    where: options.engagementId
      ? "id = ?"
      : "status IN ('planned','current','on_leave','transitioning')",
    values: options.engagementId ? [options.engagementId] : [],
    order:
      "CASE status WHEN 'current' THEN 1 WHEN 'transitioning' THEN 2 WHEN 'on_leave' THEN 3 ELSE 4 END, priority DESC, updated_at DESC"
  });
  const campaignRows = scopedRows({
    access,
    entityType: "opportunity_campaign",
    where: options.campaignId
      ? "id = ?"
      : "status IN ('planned','active','paused')",
    values: options.campaignId ? [options.campaignId] : [],
    order:
      "CASE status WHEN 'active' THEN 1 WHEN 'planned' THEN 2 ELSE 3 END, priority DESC, updated_at DESC"
  });
  const trendBundle = getWorkMetricTrends({
    access,
    engagementIds: engagementRows.map((engagement) => String(engagement.id)),
    windowDays: trendWindowDays
  });
  const payload = {
    generatedAt: new Date().toISOString(),
    settings: getWorkSettings(access),
    engagements: engagementRows.map((engagement) =>
      engagementContext(access, engagement, trendBundle.series)
    ),
    metricComparisons: trendBundle.comparisons,
    campaigns: campaignRows.map((campaign) =>
      campaignContext(access, campaign)
    ),
    summary: {
      currentEngagements: countScopedRoots({
        access,
        entityType: "work_engagement",
        where: "status = 'current'"
      }),
      plannedEngagements: countScopedRoots({
        access,
        entityType: "work_engagement",
        where: "status = 'planned'"
      }),
      pastEngagements: countScopedRoots({
        access,
        entityType: "work_engagement",
        where: "status IN ('ended','archived')"
      }),
      activeCampaigns: countScopedRoots({
        access,
        entityType: "opportunity_campaign",
        where: "status = 'active'"
      }),
      pausedCampaigns: countScopedRoots({
        access,
        entityType: "opportunity_campaign",
        where: "status = 'paused'"
      }),
      blockedCampaigns: countScopedRoots({
        access,
        entityType: "opportunity_campaign",
        where: "health = 'blocked'"
      }),
      applicationsNeedingAttention: countScopedRoots({
        access,
        entityType: "job_application",
        where: `status NOT IN ('accepted','declined_by_candidate','withdrawn','rejected','ghosted','closed')
          AND (COALESCE(next_action, '') <> '' OR COALESCE(blocker, '') <> '' OR
               (next_follow_up_at IS NOT NULL AND next_follow_up_at <= ?))`,
        values: [new Date().toISOString()]
      }),
      trendWindowDays
    },
    nestedCollectionLimit: WORK_CONTEXT_NESTED_MAX,
    contextTruncated: false
  };
  return enforceContextBound(payload);
}
