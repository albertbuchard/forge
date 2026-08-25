import { runInTransaction, getDatabase } from "../db.js";
import { HttpError } from "../errors.js";
import type { WorkAccess } from "./access.js";
import { assertScopeAssignment } from "./access.js";
import {
  assertAuthorizedWorkReference,
  getAuthorizedRoot,
  listWorkActivityHistory,
  listAuthorizedWorkLinks,
  newWorkId,
  nowIso,
  parseJson,
  recordWorkActivity,
  registerWorkRoot,
  replaceAuthorizedWorkLinks,
  rootConfig,
  rootScopeSql,
  rowToWorkRecord,
  type SqlRow
} from "./repository-helpers.js";
import type {
  CreateCriteriaVersionInput,
  CreateOpportunityCampaignInput,
  CreateWorkEngagementInput,
  CreateWorkOrganizationInput,
  UpdateOpportunityCampaignInput,
  UpdateWorkEngagementInput,
  UpdateWorkOrganizationInput
} from "./types.js";
import type { WorkListQuery } from "./types-operations.js";

import {
  assertCompensationWrite,
  criteriaContainCompensation,
  insertRow,
  json,
  scopeColumns,
  updateRevisionedRow
} from "./repository-write-helpers.js";

function rootSearchSql(entityType: string, titleColumn: string) {
  const secondary: Record<string, string> = {
    work_organization: "description",
    work_engagement: "description",
    opportunity_campaign: "description",
    job_opportunity: "description",
    job_application:
      "COALESCE(next_action, '') || ' ' || COALESCE(blocker, '') || ' ' || COALESCE((SELECT opportunity.title || ' ' || opportunity.employer_name FROM job_opportunities opportunity WHERE opportunity.id = job_applications.opportunity_id), '')",
    work_outreach: "COALESCE(proposal, '') || ' ' || COALESCE(status, '')"
  };
  return `(forge_nfkc_lower(${titleColumn}) LIKE forge_nfkc_lower(?) OR forge_nfkc_lower(${secondary[entityType] ?? "''"}) LIKE forge_nfkc_lower(?))`;
}

function rootSortSql(entityType: string, sort: WorkListQuery["sort"]) {
  if (sort === "created_desc") return "created_at DESC, id ASC";
  if (sort === "deadline_asc" && entityType === "job_opportunity") {
    return "application_deadline IS NULL, application_deadline ASC, id ASC";
  }
  if (
    sort === "priority_desc" &&
    ["work_engagement", "opportunity_campaign", "job_application"].includes(
      entityType
    )
  ) {
    return "CASE priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END DESC, updated_at DESC, id ASC";
  }
  if (sort === "score_desc" && entityType === "job_opportunity") {
    return `(SELECT MAX(evaluation.overall_score)
      FROM campaign_opportunity_evaluations evaluation
      WHERE evaluation.opportunity_id = job_opportunities.id
        AND evaluation.evaluation_version = (
          SELECT MAX(latest.evaluation_version)
          FROM campaign_opportunity_evaluations latest
          WHERE latest.opportunity_id = evaluation.opportunity_id
            AND latest.campaign_id = evaluation.campaign_id
        )) DESC, updated_at DESC, id ASC`;
  }
  return "updated_at DESC, id ASC";
}

export function listWorkRoots(
  entityType: string,
  access: WorkAccess,
  query: WorkListQuery
) {
  const config = rootConfig(entityType);
  const scope = rootScopeSql(access, config);
  const clauses = [scope.sql];
  const values: Array<string | number> = [...scope.values];
  if (config.supportsDeleted && query.archived === "exclude") {
    clauses.push("deleted_at IS NULL");
  } else if (config.supportsDeleted && query.archived === "only") {
    clauses.push("deleted_at IS NOT NULL");
  }
  if (query.status) {
    const statusColumn =
      entityType === "job_opportunity" ? "disposition" : "status";
    clauses.push(`${statusColumn} = ?`);
    values.push(query.status);
  }
  if (query.employer && entityType === "job_opportunity") {
    clauses.push("forge_nfkc_lower(employer_name) LIKE forge_nfkc_lower(?)");
    values.push(`%${query.employer}%`);
  }
  if (query.employer && entityType === "job_application") {
    clauses.push(`EXISTS (
      SELECT 1 FROM job_opportunities opportunity
      WHERE opportunity.id = job_applications.opportunity_id
        AND forge_nfkc_lower(opportunity.employer_name) LIKE forge_nfkc_lower(?)
    )`);
    values.push(`%${query.employer}%`);
  }
  if (
    query.location &&
    ["work_organization", "work_engagement", "job_opportunity"].includes(
      entityType
    )
  ) {
    clauses.push("forge_nfkc_lower(location_json) LIKE forge_nfkc_lower(?)");
    values.push(`%${query.location}%`);
  }
  if (
    query.workModel &&
    (entityType === "job_opportunity" || entityType === "work_engagement")
  ) {
    clauses.push("work_model = ?");
    values.push(query.workModel);
  }
  if (query.query) {
    clauses.push(rootSearchSql(entityType, config.titleColumn));
    values.push(`%${query.query}%`, `%${query.query}%`);
  }
  if (query.stale && entityType === "job_opportunity")
    clauses.push("availability_status = 'stale'");
  if (query.missingInformation && entityType === "job_opportunity")
    clauses.push("json_array_length(unknowns_json) > 0");
  if (
    query.hasNextAction !== undefined &&
    [
      "work_engagement",
      "opportunity_campaign",
      "job_opportunity",
      "job_application",
      "work_outreach"
    ].includes(entityType)
  ) {
    clauses.push(
      query.hasNextAction
        ? "length(trim(next_action)) > 0"
        : "length(trim(next_action)) = 0"
    );
  }
  if (query.campaignId && entityType === "job_opportunity") {
    clauses.push(`EXISTS (
      SELECT 1 FROM campaign_opportunity_evaluations evaluation
      WHERE evaluation.opportunity_id = job_opportunities.id AND evaluation.campaign_id = ?
        AND evaluation.evaluation_version = (
          SELECT MAX(latest.evaluation_version)
          FROM campaign_opportunity_evaluations latest
          WHERE latest.opportunity_id = evaluation.opportunity_id
            AND latest.campaign_id = evaluation.campaign_id
        )
    )`);
    values.push(query.campaignId);
  }
  if (query.campaignId && entityType === "job_application") {
    clauses.push("primary_campaign_id = ?");
    values.push(query.campaignId);
  }
  if (query.hardGate && entityType === "job_opportunity") {
    clauses.push(`EXISTS (
      SELECT 1 FROM campaign_opportunity_evaluations evaluation
      WHERE evaluation.opportunity_id = job_opportunities.id
        AND evaluation.hard_gate_result = ?
        ${query.campaignId ? "AND evaluation.campaign_id = ?" : ""}
        AND evaluation.evaluation_version = (
          SELECT MAX(latest.evaluation_version)
          FROM campaign_opportunity_evaluations latest
          WHERE latest.opportunity_id = evaluation.opportunity_id
            AND latest.campaign_id = evaluation.campaign_id
        )
    )`);
    values.push(query.hardGate);
    if (query.campaignId) values.push(query.campaignId);
  }
  if (query.minimumScore !== undefined && entityType === "job_opportunity") {
    clauses.push(`EXISTS (
      SELECT 1 FROM campaign_opportunity_evaluations evaluation
      WHERE evaluation.opportunity_id = job_opportunities.id
        AND evaluation.overall_score >= ?
        ${query.campaignId ? "AND evaluation.campaign_id = ?" : ""}
        AND evaluation.evaluation_version = (
          SELECT MAX(latest.evaluation_version)
          FROM campaign_opportunity_evaluations latest
          WHERE latest.opportunity_id = evaluation.opportunity_id
            AND latest.campaign_id = evaluation.campaign_id
        )
    )`);
    values.push(query.minimumScore);
    if (query.campaignId) values.push(query.campaignId);
  }
  if (query.deadlineBefore && entityType === "job_opportunity") {
    clauses.push(
      "application_deadline IS NOT NULL AND application_deadline <= ?"
    );
    values.push(query.deadlineBefore);
  }
  if (query.deadlineBefore && entityType === "job_application") {
    clauses.push(`(
      (decision_deadline IS NOT NULL AND substr(decision_deadline, 1, 10) <= ?)
      OR (next_follow_up_at IS NOT NULL AND substr(next_follow_up_at, 1, 10) <= ?)
      OR (expected_response_at IS NOT NULL AND substr(expected_response_at, 1, 10) <= ?)
    )`);
    values.push(
      query.deadlineBefore,
      query.deadlineBefore,
      query.deadlineBefore
    );
  }
  if (
    (query.minimumCompensation !== undefined || query.compensationCurrency) &&
    entityType === "job_opportunity"
  ) {
    if (!access.canCompensation) {
      throw new HttpError(
        403,
        "work_compensation_scope_required",
        "Filtering Job Opportunities by compensation requires Work compensation authority."
      );
    }
    if (query.minimumCompensation !== undefined) {
      clauses.push(
        "CAST(json_extract(compensation_json, '$.base.amount') AS REAL) >= ?"
      );
      values.push(query.minimumCompensation);
    }
    if (query.compensationCurrency) {
      clauses.push("json_extract(compensation_json, '$.base.currency') = ?");
      values.push(query.compensationCurrency);
    }
  }
  const order = rootSortSql(entityType, query.sort);
  const totalRow = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS count FROM ${config.table} WHERE ${clauses.join(" AND ")}`
    )
    .get(...values) as { count: number };
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM ${config.table}
       WHERE ${clauses.join(" AND ")}
       ORDER BY ${order}
       LIMIT ? OFFSET ?`
    )
    .all(...values, query.limit, query.offset) as SqlRow[];
  return {
    items: rows.map((row) => rowToWorkRecord(row, access)),
    total: totalRow.count,
    limit: query.limit,
    offset: query.offset,
    hasMore: query.offset + rows.length < totalRow.count
  };
}

export function getWorkSettings(access: WorkAccess) {
  return access.ownerUserIds.map((ownerUserId) => {
    const row = getDatabase()
      .prepare("SELECT * FROM work_settings WHERE owner_user_id = ?")
      .get(ownerUserId) as SqlRow | undefined;
    return row
      ? rowToWorkRecord(row, access)
      : {
          ownerUserId,
          lookingForOpportunities: false,
          revision: 0,
          provenance: {},
          createdAt: null,
          updatedAt: null
        };
  });
}

export function updateLookingForOpportunities(input: {
  access: WorkAccess;
  looking: boolean;
  expectedRevision: number;
}) {
  const now = nowIso();
  return runInTransaction(() => {
    const existing = getDatabase()
      .prepare("SELECT revision FROM work_settings WHERE owner_user_id = ?")
      .get(input.access.mutationOwnerUserId) as
      | { revision: number }
      | undefined;
    if (!existing) {
      if (input.expectedRevision !== 0) {
        throw new HttpError(
          409,
          "work_revision_conflict",
          "Work settings changed after they were opened."
        );
      }
      insertRow("work_settings", {
        owner_user_id: input.access.mutationOwnerUserId,
        looking_for_opportunities: input.looking ? 1 : 0,
        revision: 1,
        provenance_json: json({
          sourceKind: "user",
          actorId: input.access.actor.id
        }),
        created_at: now,
        updated_at: now,
        import_receipt_id: null
      });
    } else {
      const result = getDatabase()
        .prepare(
          `UPDATE work_settings
           SET looking_for_opportunities = ?, revision = revision + 1, updated_at = ?
           WHERE owner_user_id = ? AND revision = ?`
        )
        .run(
          input.looking ? 1 : 0,
          now,
          input.access.mutationOwnerUserId,
          input.expectedRevision
        );
      if (Number(result.changes) !== 1) {
        throw new HttpError(
          409,
          "work_revision_conflict",
          "Work settings changed after they were opened."
        );
      }
    }
    recordWorkActivity({
      entityType: "work_settings",
      entityId: input.access.mutationOwnerUserId,
      eventType: "work_opportunity_search_toggled",
      title: input.looking
        ? "Looking for opportunities enabled"
        : "Looking for opportunities paused",
      description: input.looking
        ? "Job Search is visible and ready for one or more Opportunity Campaigns."
        : "Existing campaigns and application history remain available.",
      actor: input.access.actor
    });
    return getWorkSettings(input.access)[0];
  });
}

export function createWorkOrganization(
  access: WorkAccess,
  input: CreateWorkOrganizationInput
) {
  assertScopeAssignment(access, input.scope);
  const id = input.id ?? newWorkId("worg");
  const now = nowIso();
  return runInTransaction(() => {
    insertRow("work_organizations", {
      id,
      owner_user_id: access.mutationOwnerUserId,
      name: input.name,
      normalized_name: input.name.normalize("NFKC").trim().toLowerCase(),
      aliases_json: json(input.aliases),
      domain: input.domain,
      website_url: input.websiteUrl,
      location_json: json(input.location),
      organization_facts_json: json(input.organizationFacts),
      status: input.status,
      description: input.description,
      visibility: input.visibility,
      ...scopeColumns(input.scope),
      provenance_json: json(input.provenance),
      revision: 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      import_receipt_id: null
    });
    registerWorkRoot("work_organization", id, access.mutationOwnerUserId);
    recordWorkActivity({
      entityType: "work_organization",
      entityId: id,
      eventType: "work_organization_created",
      title: `Organization added: ${input.name}`,
      actor: access.actor
    });
    return getAuthorizedRoot("work_organization", id, access);
  });
}

export function updateWorkOrganization(
  access: WorkAccess,
  id: string,
  input: UpdateWorkOrganizationInput
) {
  const before = getAuthorizedRoot("work_organization", id, access);
  if (input.scope) assertScopeAssignment(access, input.scope);
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    data.name = input.name;
    data.normalized_name = input.name.normalize("NFKC").trim().toLowerCase();
  }
  if (input.aliases !== undefined) data.aliases_json = json(input.aliases);
  if (input.domain !== undefined) data.domain = input.domain;
  if (input.websiteUrl !== undefined) data.website_url = input.websiteUrl;
  if (input.location !== undefined) data.location_json = json(input.location);
  if (input.organizationFacts !== undefined)
    data.organization_facts_json = json(input.organizationFacts);
  if (input.status !== undefined) data.status = input.status;
  if (input.description !== undefined) data.description = input.description;
  if (input.visibility !== undefined) data.visibility = input.visibility;
  if (input.scope !== undefined) Object.assign(data, scopeColumns(input.scope));
  if (input.provenance !== undefined)
    data.provenance_json = json(input.provenance);
  updateRevisionedRow({
    table: "work_organizations",
    id,
    expectedRevision: input.expectedRevision,
    data
  });
  const after = getAuthorizedRoot("work_organization", id, access);
  recordWorkActivity({
    entityType: "work_organization",
    entityId: id,
    eventType: "work_organization_updated",
    title: "Organization updated",
    actor: access.actor,
    metadata: { beforeRevision: before.revision, afterRevision: after.revision }
  });
  return after;
}

function engagementData(
  input: CreateWorkEngagementInput | Partial<CreateWorkEngagementInput>
) {
  const map: Record<string, string> = {
    organizationId: "organization_id",
    title: "title",
    roleFunction: "role_function",
    description: "description",
    status: "status",
    priority: "priority",
    engagementType: "engagement_type",
    startDate: "start_date",
    expectedEndDate: "expected_end_date",
    actualEndDate: "actual_end_date",
    probationEndDate: "probation_end_date",
    renewalDate: "renewal_date",
    contractDeadline: "contract_deadline",
    earliestDepartureDate: "earliest_departure_date",
    workModel: "work_model",
    purpose: "purpose",
    transitionIntentions: "transition_intentions",
    exitReason: "exit_reason",
    exitOutcome: "exit_outcome",
    nextAction: "next_action",
    visibility: "visibility"
  };
  const jsonMap: Record<string, string> = {
    noticePeriod: "notice_period_json",
    workload: "workload_json",
    schedule: "schedule_json",
    location: "location_json",
    roleFacts: "role_facts_json",
    responsibilities: "responsibilities_json",
    successCriteria: "success_criteria_json",
    compensation: "compensation_json",
    benefits: "benefits_json",
    desiredOutcomes: "desired_outcomes_json",
    risks: "risks_json",
    constraints: "constraints_json",
    provenance: "provenance_json"
  };
  const data: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(map)) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) data[column] = value;
  }
  for (const [key, column] of Object.entries(jsonMap)) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) data[column] = json(value);
  }
  if (input.scope !== undefined) Object.assign(data, scopeColumns(input.scope));
  return data;
}

export function createWorkEngagement(
  access: WorkAccess,
  input: CreateWorkEngagementInput
) {
  assertScopeAssignment(access, input.scope);
  assertCompensationWrite(access, [input.compensation, input.benefits]);
  assertAuthorizedWorkReference({
    access,
    entityType: "work_organization",
    entityId: input.organizationId
  });
  const id = input.id ?? newWorkId("weng");
  const now = nowIso();
  return runInTransaction(() => {
    insertRow("work_engagements", {
      id,
      owner_user_id: access.mutationOwnerUserId,
      ...engagementData(input),
      revision: 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      import_receipt_id: null
    });
    insertRow("work_engagement_events", {
      id: newWorkId("wevt"),
      engagement_id: id,
      event_type: "created",
      prior_status: null,
      new_status: input.status,
      factual_description: input.description,
      changes_json: json({ created: true }),
      occurred_at: now,
      actor_json: json(access.actor),
      provenance_json: json(input.provenance),
      created_at: now,
      import_receipt_id: null
    });
    registerWorkRoot("work_engagement", id, access.mutationOwnerUserId);
    recordWorkActivity({
      entityType: "work_engagement",
      entityId: id,
      eventType: "work_engagement_created",
      title: `Work Engagement added: ${input.title}`,
      actor: access.actor
    });
    return getWorkEngagementDetail(access, id);
  });
}

export function updateWorkEngagement(
  access: WorkAccess,
  id: string,
  input: UpdateWorkEngagementInput
) {
  const before = getAuthorizedRoot("work_engagement", id, access);
  if (input.scope) assertScopeAssignment(access, input.scope);
  if (input.compensation !== undefined || input.benefits !== undefined) {
    if (!access.canCompensation) {
      throw new HttpError(
        403,
        "work_compensation_scope_required",
        "Updating Work compensation or benefits requires Work compensation authority."
      );
    }
  }
  if (input.organizationId !== undefined) {
    assertAuthorizedWorkReference({
      access,
      entityType: "work_organization",
      entityId: input.organizationId
    });
  }
  return runInTransaction(() => {
    updateRevisionedRow({
      table: "work_engagements",
      id,
      expectedRevision: input.expectedRevision,
      data: engagementData(input)
    });
    const after = getAuthorizedRoot("work_engagement", id, access);
    insertRow("work_engagement_events", {
      id: newWorkId("wevt"),
      engagement_id: id,
      event_type:
        before.status !== after.status ? "status_changed" : "facts_updated",
      prior_status: before.status ?? null,
      new_status: after.status ?? null,
      factual_description: "Work Engagement updated.",
      changes_json: json({
        beforeRevision: before.revision,
        afterRevision: after.revision
      }),
      occurred_at: nowIso(),
      actor_json: json(access.actor),
      provenance_json: json(input.provenance ?? {}),
      created_at: nowIso(),
      import_receipt_id: null
    });
    recordWorkActivity({
      entityType: "work_engagement",
      entityId: id,
      eventType: "work_engagement_updated",
      title: `Work Engagement updated: ${String(after.title)}`,
      actor: access.actor,
      metadata: {
        beforeRevision: before.revision,
        afterRevision: after.revision,
        priorStatus: before.status,
        newStatus: after.status
      }
    });
    return getWorkEngagementDetail(access, id);
  });
}

export function getWorkEngagementDetail(
  access: WorkAccess,
  id: string,
  options: { includeArchived?: boolean } = {}
) {
  const engagement = getAuthorizedRoot("work_engagement", id, access, {
    includeDeleted: options.includeArchived === true
  });
  const events = getDatabase()
    .prepare(
      "SELECT * FROM work_engagement_events WHERE engagement_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 100"
    )
    .all(id) as SqlRow[];
  const observations = getDatabase()
    .prepare(
      "SELECT * FROM work_metric_observations WHERE engagement_id = ? AND confirmation_state = 'confirmed' ORDER BY observed_at DESC, id DESC LIMIT 100"
    )
    .all(id) as SqlRow[];
  return {
    ...engagement,
    events: events.map((row) => rowToWorkRecord(row, access)),
    observations: observations.map((row) => rowToWorkRecord(row, access)),
    history: listWorkActivityHistory("work_engagement", id, access),
    links: listAuthorizedWorkLinks("work_engagement", id, access)
  };
}

function campaignData(
  input:
    | CreateOpportunityCampaignInput
    | Partial<CreateOpportunityCampaignInput>
) {
  const map: Record<string, string> = {
    sourceEngagementId: "source_engagement_id",
    title: "title",
    purpose: "purpose",
    description: "description",
    status: "status",
    priority: "priority",
    searchIntent: "search_intent",
    activeFrom: "active_from",
    activeUntil: "active_until",
    targetStartDate: "target_start_date",
    searchDeadline: "search_deadline",
    urgency: "urgency",
    reviewCadence: "review_cadence",
    timezone: "timezone",
    longTermDestination: "long_term_destination",
    steppingStoneAssessment: "stepping_stone_assessment",
    currentStage: "current_stage",
    health: "health",
    nextAction: "next_action",
    primaryGoalId: "primary_goal_id",
    visibility: "visibility"
  };
  const jsonMap: Record<string, string> = {
    completionCriteria: "completion_criteria_json",
    intermediateRoles: "intermediate_roles_json",
    capabilitiesToAcquire: "capabilities_to_acquire_json",
    blockers: "blockers_json",
    provenance: "provenance_json"
  };
  const data: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(map)) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) data[column] = value;
  }
  for (const [key, column] of Object.entries(jsonMap)) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) data[column] = json(value);
  }
  if (input.scope !== undefined) Object.assign(data, scopeColumns(input.scope));
  return data;
}

export function createOpportunityCampaign(
  access: WorkAccess,
  input: CreateOpportunityCampaignInput
) {
  assertScopeAssignment(access, input.scope);
  if (
    input.initialCriteria &&
    criteriaContainCompensation(input.initialCriteria) &&
    !access.canCompensation
  ) {
    throw new HttpError(
      403,
      "work_compensation_scope_required",
      "Creating compensation criteria requires Work compensation authority."
    );
  }
  assertAuthorizedWorkReference({
    access,
    entityType: "work_engagement",
    entityId: input.sourceEngagementId
  });
  assertAuthorizedWorkReference({
    access,
    entityType: "goal",
    entityId: input.primaryGoalId
  });
  const id = input.id ?? newWorkId("ocamp");
  const now = nowIso();
  return runInTransaction(() => {
    insertRow("opportunity_campaigns", {
      id,
      owner_user_id: access.mutationOwnerUserId,
      ...campaignData(input),
      last_meaningful_activity_at: now,
      current_criteria_version_id: null,
      revision: 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      import_receipt_id: null
    });
    registerWorkRoot("opportunity_campaign", id, access.mutationOwnerUserId);
    if (input.initialCriteria) {
      createCampaignCriteriaVersion(access, id, {
        criteria: input.initialCriteria,
        rationale: "Initial campaign criteria",
        effectiveAt: now,
        provenance: input.provenance
      });
    }
    recordWorkActivity({
      entityType: "opportunity_campaign",
      entityId: id,
      eventType: "opportunity_campaign_created",
      title: `Opportunity Campaign created: ${input.title}`,
      actor: access.actor
    });
    return getOpportunityCampaignDetail(access, id);
  });
}

export function updateOpportunityCampaign(
  access: WorkAccess,
  id: string,
  input: UpdateOpportunityCampaignInput
) {
  const before = getAuthorizedRoot("opportunity_campaign", id, access);
  if (input.scope) assertScopeAssignment(access, input.scope);
  if (input.sourceEngagementId !== undefined) {
    assertAuthorizedWorkReference({
      access,
      entityType: "work_engagement",
      entityId: input.sourceEngagementId
    });
  }
  if (input.primaryGoalId !== undefined) {
    assertAuthorizedWorkReference({
      access,
      entityType: "goal",
      entityId: input.primaryGoalId
    });
  }
  updateRevisionedRow({
    table: "opportunity_campaigns",
    id,
    expectedRevision: input.expectedRevision,
    data: campaignData(input)
  });
  const after = getAuthorizedRoot("opportunity_campaign", id, access);
  recordWorkActivity({
    entityType: "opportunity_campaign",
    entityId: id,
    eventType: "opportunity_campaign_updated",
    title: "Opportunity Campaign updated",
    actor: access.actor,
    metadata: {
      beforeRevision: before.revision,
      afterRevision: after.revision,
      priorStatus: before.status,
      newStatus: after.status
    }
  });
  return getOpportunityCampaignDetail(access, id);
}

export function createCampaignCriteriaVersion(
  access: WorkAccess,
  campaignId: string,
  input: CreateCriteriaVersionInput
) {
  getAuthorizedRoot("opportunity_campaign", campaignId, access);
  if (criteriaContainCompensation(input.criteria) && !access.canCompensation) {
    throw new HttpError(
      403,
      "work_compensation_scope_required",
      "Creating compensation criteria requires Work compensation authority."
    );
  }
  return runInTransaction(() => {
    const current = getDatabase()
      .prepare(
        "SELECT COALESCE(MAX(version), 0) AS version FROM campaign_criteria_versions WHERE campaign_id = ?"
      )
      .get(campaignId) as { version: number };
    const id = newWorkId("ccrit");
    const createdAt = nowIso();
    insertRow("campaign_criteria_versions", {
      id,
      campaign_id: campaignId,
      version: current.version + 1,
      criteria_json: json(input.criteria),
      rationale: input.rationale,
      effective_at: input.effectiveAt ?? createdAt,
      actor_json: json(access.actor),
      provenance_json: json(input.provenance),
      created_at: createdAt,
      import_receipt_id: null
    });
    getDatabase()
      .prepare(
        "UPDATE opportunity_campaigns SET current_criteria_version_id = ?, revision = revision + 1, updated_at = ?, last_meaningful_activity_at = ? WHERE id = ?"
      )
      .run(id, createdAt, createdAt, campaignId);
    recordWorkActivity({
      entityType: "opportunity_campaign",
      entityId: campaignId,
      eventType: "campaign_criteria_version_created",
      title: `Campaign criteria version ${current.version + 1} created`,
      actor: access.actor
    });
    return rowToWorkRecord(
      getDatabase()
        .prepare("SELECT * FROM campaign_criteria_versions WHERE id = ?")
        .get(id) as SqlRow,
      access
    );
  });
}

export function getOpportunityCampaignDetail(access: WorkAccess, id: string) {
  const campaign = getAuthorizedRoot("opportunity_campaign", id, access);
  const criteria = getDatabase()
    .prepare(
      "SELECT * FROM campaign_criteria_versions WHERE campaign_id = ? ORDER BY version DESC"
    )
    .all(id) as SqlRow[];
  const roleTargets = getDatabase()
    .prepare(
      "SELECT * FROM campaign_role_targets WHERE campaign_id = ? ORDER BY priority DESC, updated_at DESC"
    )
    .all(id) as SqlRow[];
  const organizationTargets = getDatabase()
    .prepare(
      "SELECT * FROM campaign_organization_targets WHERE campaign_id = ? ORDER BY updated_at DESC"
    )
    .all(id) as SqlRow[];
  const evaluations = getDatabase()
    .prepare(
      `SELECT evaluation.* FROM campaign_opportunity_evaluations evaluation
    JOIN (SELECT opportunity_id, MAX(evaluation_version) version FROM campaign_opportunity_evaluations WHERE campaign_id = ? GROUP BY opportunity_id) latest
      ON latest.opportunity_id = evaluation.opportunity_id AND latest.version = evaluation.evaluation_version
    WHERE evaluation.campaign_id = ? ORDER BY evaluation.evaluated_at DESC LIMIT 25`
    )
    .all(id, id) as SqlRow[];
  const applications = getDatabase()
    .prepare(
      "SELECT * FROM job_applications WHERE primary_campaign_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 25"
    )
    .all(id) as SqlRow[];
  return {
    ...campaign,
    currentCriteria:
      criteria
        .map((row) => rowToWorkRecord(row, access))
        .find((version) => version.id === campaign.currentCriteriaVersionId) ??
      null,
    criteriaVersions: criteria.map((row) => rowToWorkRecord(row, access)),
    roleTargets: roleTargets.map((row) => rowToWorkRecord(row, access)),
    organizationTargets: organizationTargets.map((row) =>
      rowToWorkRecord(row, access)
    ),
    evaluations: evaluations.map((row) => rowToWorkRecord(row, access)),
    applications: applications.map((row) => rowToWorkRecord(row, access)),
    history: listWorkActivityHistory("opportunity_campaign", id, access),
    links: listAuthorizedWorkLinks("opportunity_campaign", id, access)
  };
}

const archivalLifecycleColumns: Record<
  string,
  { column: "status" | "disposition"; fallback: string }
> = {
  work_organization: { column: "status", fallback: "past" },
  work_engagement: { column: "status", fallback: "ended" },
  opportunity_campaign: { column: "status", fallback: "paused" },
  job_opportunity: { column: "disposition", fallback: "closed" }
};

function priorArchivedLifecycle(
  entityType: string,
  entityId: string,
  current: Record<string, unknown>
) {
  const lifecycle = archivalLifecycleColumns[entityType];
  if (!lifecycle) return null;
  const row = getDatabase()
    .prepare(
      `SELECT metadata_json
       FROM activity_events
       WHERE entity_type = ? AND entity_id = ? AND event_type = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`
    )
    .get(entityType, entityId, `${entityType}_archived`) as
    | { metadata_json: string }
    | undefined;
  const metadata = row ? parseJson(row.metadata_json, {}) : {};
  const prior =
    metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    typeof (metadata as Record<string, unknown>).priorLifecycle === "string"
      ? String((metadata as Record<string, unknown>).priorLifecycle)
      : null;
  const currentValue = current[lifecycle.column];
  return (
    prior ??
    (typeof currentValue === "string" && currentValue !== "archived"
      ? currentValue
      : lifecycle.fallback)
  );
}

export {
  evaluateJobOpportunity,
  findJobOpportunityDuplicate,
  getJobOpportunityDetail,
  opportunityDedupeKey,
  updateJobOpportunity,
  upsertJobOpportunity
} from "./opportunity-repository.js";
export {
  applicationTransitions,
  createJobApplication,
  getJobApplicationDetail,
  recordJobApplicationEvent,
  transitionJobApplication,
  updateJobApplication
} from "./application-repository.js";
export function softDeleteWorkRoot(
  access: WorkAccess,
  entityType: string,
  id: string,
  expectedRevision: number
) {
  return runInTransaction(() => {
    const config = rootConfig(entityType);
    if (!config.supportsDeleted)
      throw new HttpError(
        400,
        "work_archive_unsupported",
        "This Work record cannot be archived through the root lifecycle."
      );
    const current = getAuthorizedRoot(entityType, id, access);
    const archivedAt = nowIso();
    const lifecycle = archivalLifecycleColumns[entityType];
    const priorLifecycle = lifecycle
      ? String(current[lifecycle.column] ?? lifecycle.fallback)
      : null;
    const result = getDatabase()
      .prepare(
        `UPDATE ${config.table}
         SET deleted_at = ?${lifecycle ? `, ${lifecycle.column} = 'archived'` : ""},
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ?`
      )
      .run(archivedAt, archivedAt, id, expectedRevision);
    if (Number(result.changes) !== 1)
      throw new HttpError(
        409,
        "work_revision_conflict",
        "This Work record changed before it could be archived."
      );
    if (entityType === "work_engagement") {
      insertRow("work_engagement_events", {
        id: newWorkId("wevt"),
        engagement_id: id,
        event_type: "archived",
        prior_status: current.status ?? null,
        new_status: "archived",
        factual_description:
          "Work Engagement archived without deleting its history.",
        changes_json: json({
          beforeRevision: current.revision,
          afterRevision: Number(current.revision) + 1
        }),
        occurred_at: archivedAt,
        actor_json: json(access.actor),
        provenance_json: json({ sourceKind: "user" }),
        created_at: archivedAt,
        import_receipt_id: null
      });
    }
    recordWorkActivity({
      entityType,
      entityId: id,
      eventType: `${entityType}_archived`,
      title: "Work record archived",
      actor: access.actor,
      metadata: {
        ...(priorLifecycle ? { priorLifecycle } : {}),
        archivedLifecycle: lifecycle ? "archived" : null
      }
    });
    return getAuthorizedRoot(entityType, id, access, { includeDeleted: true });
  });
}

export function restoreWorkRoot(
  access: WorkAccess,
  entityType: string,
  id: string,
  expectedRevision: number
) {
  return runInTransaction(() => {
    const config = rootConfig(entityType);
    if (!config.supportsDeleted)
      throw new HttpError(
        400,
        "work_restore_unsupported",
        "This Work record cannot be restored through the root lifecycle."
      );
    const current = getAuthorizedRoot(entityType, id, access, {
      includeDeleted: true
    });
    if (current.importReceiptId) {
      const receipt = getDatabase()
        .prepare(
          "SELECT status FROM work_operation_receipts WHERE id = ? LIMIT 1"
        )
        .get(String(current.importReceiptId)) as { status: string } | undefined;
      if (receipt?.status === "rolled_back") {
        throw new HttpError(
          409,
          "work_import_rollback_root_not_restorable",
          "This root belongs to a rolled-back private import whose child records were intentionally removed. Re-import the reviewed source instead of restoring an incomplete root."
        );
      }
    }
    const restoredAt = nowIso();
    const lifecycle = archivalLifecycleColumns[entityType];
    const restoredLifecycle = priorArchivedLifecycle(entityType, id, current);
    const result = getDatabase()
      .prepare(
        `UPDATE ${config.table}
         SET deleted_at = NULL${lifecycle ? `, ${lifecycle.column} = ?` : ""},
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ?`
      )
      .run(
        ...(lifecycle ? [restoredLifecycle] : []),
        restoredAt,
        id,
        expectedRevision
      );
    if (Number(result.changes) !== 1)
      throw new HttpError(
        409,
        "work_revision_conflict",
        "This Work record changed before it could be restored."
      );
    if (entityType === "work_engagement") {
      insertRow("work_engagement_events", {
        id: newWorkId("wevt"),
        engagement_id: id,
        event_type: "restored",
        prior_status: "archived",
        new_status: restoredLifecycle,
        factual_description:
          "Work Engagement restored with its history intact.",
        changes_json: json({
          beforeRevision: current.revision,
          afterRevision: Number(current.revision) + 1
        }),
        occurred_at: restoredAt,
        actor_json: json(access.actor),
        provenance_json: json({ sourceKind: "user" }),
        created_at: restoredAt,
        import_receipt_id: null
      });
    }
    recordWorkActivity({
      entityType,
      entityId: id,
      eventType: `${entityType}_restored`,
      title: "Work record restored",
      actor: access.actor,
      metadata: {
        ...(restoredLifecycle ? { restoredLifecycle } : {})
      }
    });
    return getAuthorizedRoot(entityType, id, access);
  });
}

export {
  getAuthorizedRoot,
  listAuthorizedWorkLinks,
  listWorkActivityHistory,
  replaceAuthorizedWorkLinks
};
