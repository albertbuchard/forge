import { requestForgeBrowserJson } from "@/lib/api";

export type WorkRecord = {
  id: string;
  ownerUserId?: string;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

export type WorkLink = {
  sourceEntityType: string;
  sourceEntityId: string;
  targetEntityType: string;
  targetEntityId: string;
  relationship: string;
  anchorKey?: string;
};

export type WorkTrendPoint = {
  observedAt: string;
  numericValue: number | null;
  categoricalValue: string | null;
  missingState: string;
  note?: string;
  context?: Record<string, unknown>;
};

export type WorkTrendSeries = {
  engagementId: string;
  metricKey: string;
  displayName?: string;
  scale: Record<string, unknown>;
  target: Record<string, unknown>;
  warning: Record<string, unknown>;
  valueKind?: string;
  metricDefinitionId?: string;
  metricDefinitionVersion?: number | null;
  points: WorkTrendPoint[];
  rollingSummary?: {
    kind: "median_anchor" | "mean" | "latest_category";
    count: number;
    median?: number;
    mean?: number;
    latest?: string;
  } | null;
  meaningfulChange?: {
    direction: "increased" | "decreased";
    magnitude: number;
    threshold: number;
    explanation: string;
  } | null;
  summary?: {
    current?: number | string | null;
    previous?: number | string | null;
    change?: number | null;
    direction?: "improving" | "declining" | "stable" | "unknown";
    [key: string]: unknown;
  };
};

export type WorkEngagement = WorkRecord & {
  title: string;
  roleFunction?: string;
  organizationId?: string | null;
  description?: string;
  status:
    | "planned"
    | "current"
    | "on_leave"
    | "transitioning"
    | "ended"
    | "archived";
  priority?: string;
  engagementType?: string;
  startDate?: string | null;
  expectedEndDate?: string | null;
  actualEndDate?: string | null;
  probationEndDate?: string | null;
  renewalDate?: string | null;
  contractDeadline?: string | null;
  earliestDepartureDate?: string | null;
  noticePeriod?: Record<string, unknown>;
  workModel?: string;
  workload?: Record<string, unknown>;
  schedule?: Record<string, unknown>;
  location?: Record<string, unknown>;
  compensation?: Record<string, unknown>;
  benefits?: Array<Record<string, unknown>>;
  roleFacts?: Record<string, unknown>;
  responsibilities?: string[];
  successCriteria?: string[];
  purpose?: string;
  desiredOutcomes?: string[];
  risks?: string[];
  constraints?: string[];
  transitionIntentions?: string;
  exitReason?: string;
  exitOutcome?: string;
  nextAction?: string;
  latestCheckIns?: WorkRecord[];
  latestObservations?: WorkRecord[];
  trends?: WorkTrendSeries[];
  links?: WorkLink[];
  related?: WorkRecord[];
};

export type OpportunityCampaign = WorkRecord & {
  title: string;
  purpose?: string;
  description?: string;
  status:
    | "draft"
    | "planned"
    | "active"
    | "paused"
    | "completed"
    | "abandoned"
    | "archived";
  priority?: string;
  searchIntent?: string;
  sourceEngagementId?: string | null;
  activeFrom?: string | null;
  activeUntil?: string | null;
  targetStartDate?: string | null;
  searchDeadline?: string | null;
  urgency?: string;
  reviewCadence?: string;
  timezone?: string;
  completionCriteria?: string[];
  longTermDestination?: string;
  intermediateRoles?: string[];
  capabilitiesToAcquire?: string[];
  steppingStoneAssessment?: string;
  currentStage?: string;
  health?: string;
  nextAction?: string;
  blockers?: string[];
  primaryGoalId?: string | null;
  currentCriteria?: WorkRecord | null;
  roleTargets?: WorkRecord[];
  organizationTargets?: WorkRecord[];
  searchSources?: WorkRecord[];
  automationPolicies?: WorkRecord[];
  savedQueries?: WorkRecord[];
  recentSearchRuns?: WorkRecord[];
  latestEvaluations?: WorkRecord[];
  opportunities?: JobOpportunity[];
  applications?: JobApplication[];
  history?: WorkRecord[];
  pipeline?: {
    returnedApplications?: number;
    stageCounts?: Record<string, number>;
    hasMore?: boolean;
  };
  links?: WorkLink[];
  related?: WorkRecord[];
};

export type JobOpportunity = WorkRecord & {
  title: string;
  employerName?: string;
  organizationId?: string | null;
  canonicalUrl?: string;
  sourceName?: string;
  sourceIdentifier?: string;
  roleFamily?: string;
  seniority?: string;
  description?: string;
  responsibilities?: string[];
  requirements?: string[];
  preferredQualifications?: string[];
  skills?: string[];
  technologies?: string[];
  sector?: string;
  location?: Record<string, unknown>;
  workModel?: string;
  employmentType?: string;
  travel?: Record<string, unknown>;
  sponsorship?: Record<string, unknown>;
  weeklyHours?: Record<string, unknown>;
  duration?: Record<string, unknown>;
  startDate?: string | null;
  compensation?: Record<string, unknown>;
  benefits?: Array<Record<string, unknown>>;
  applicationRoute?: Record<string, unknown>;
  publishedAt?: string | null;
  firstSeenAt?: string;
  lastCheckedAt?: string | null;
  applicationDeadline?: string | null;
  availabilityStatus?: string;
  disposition?: string;
  confidence?: number | null;
  unknowns?: string[];
  redFlags?: string[];
  eligibilityUncertainties?: string[];
  excitement?: number | null;
  decision?: string;
  decisionRationale?: string;
  nextAction?: string;
  sourceSnapshotArtifactId?: string | null;
  sources?: WorkRecord[];
  evaluations?: WorkRecord[];
  applications?: JobApplication[];
  history?: WorkRecord[];
  links?: WorkLink[];
};

export type JobApplication = WorkRecord & {
  opportunityId: string;
  primaryCampaignId: string;
  status: string;
  startedAt?: string | null;
  submittedAt?: string | null;
  acknowledgedAt?: string | null;
  lastContactAt?: string | null;
  nextFollowUpAt?: string | null;
  decisionDeadline?: string | null;
  expectedResponseAt?: string | null;
  closedAt?: string | null;
  nextAction?: string;
  blocker?: string;
  priority?: string;
  referralState?: string;
  applicationRoute?: Record<string, unknown>;
  accountReference?: string;
  ownerLabel?: string;
  privateContacts?: Array<Record<string, unknown>>;
  positioningProfileId?: string | null;
  documentSetId?: string | null;
  representations?: Record<string, unknown>;
  unresolvedUserFacts?: Array<Record<string, unknown>>;
  outcome?: string;
  employerReason?: string;
  inferredExplanation?: string;
  lessons?: string;
  reapplicationDate?: string | null;
  events?: WorkRecord[];
  questions?: WorkRecord[];
  artifactUses?: WorkRecord[];
  interviews?: WorkRecord[];
  offers?: WorkRecord[];
  transmissionPreviews?: WorkRecord[];
  links?: WorkLink[];
};

export type WorkContext = {
  generatedAt: string;
  settings: Array<{
    ownerUserId: string;
    lookingForOpportunities: boolean;
    revision: number;
  }>;
  engagements: WorkEngagement[];
  campaigns: OpportunityCampaign[];
  metricComparisons: Array<Record<string, unknown>>;
  summary: {
    currentEngagements: number;
    plannedEngagements: number;
    pastEngagements: number;
    activeCampaigns: number;
    pausedCampaigns: number;
    blockedCampaigns: number;
    applicationsNeedingAttention: number;
    trendWindowDays: number;
  };
  nestedCollectionLimit: number;
  contextTruncated: boolean;
  contextTruncationReason?: string;
  contextBytes: number;
  contextByteLimit: number;
};

export type WorkListResponse<T extends WorkRecord> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

function json<T>(path: string, init?: RequestInit) {
  return requestForgeBrowserJson(path, init) as Promise<T>;
}

function userQuery(userIds: string[], input?: object) {
  const search = new URLSearchParams();
  for (const userId of userIds) search.append("userIds", userId);
  for (const [key, value] of Object.entries(input ?? {})) {
    if (value !== null && value !== undefined && String(value).length > 0) {
      search.set(key, String(value));
    }
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

function mutationInit(
  method: "POST" | "PATCH" | "PUT",
  body: unknown
): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  };
}

export function getWorkContext(
  userIds: string[],
  input?: {
    engagementId?: string;
    campaignId?: string;
    trendWindowDays?: number;
  }
) {
  return json<WorkContext>(`/api/v1/work/context${userQuery(userIds, input)}`);
}

export function getWorkOverview(userIds: string[]) {
  return json<WorkContext>(`/api/v1/work${userQuery(userIds)}`);
}

export function listWorkEngagements(
  userIds: string[],
  input?: Record<string, string | number | boolean | null | undefined>
) {
  return json<WorkListResponse<WorkEngagement>>(
    `/api/v1/work/engagements${userQuery(userIds, input)}`
  );
}

export function listWorkOrganizations(
  userIds: string[],
  input?: Record<string, string | number | boolean | null | undefined>
) {
  return json<WorkListResponse<WorkRecord>>(
    `/api/v1/work/organizations${userQuery(userIds, input)}`
  );
}

export function listOpportunityCampaigns(
  userIds: string[],
  input?: Record<string, string | number | boolean | null | undefined>
) {
  return json<WorkListResponse<OpportunityCampaign>>(
    `/api/v1/work/campaigns${userQuery(userIds, input)}`
  );
}

export function listJobOpportunities(
  userIds: string[],
  input?: Record<string, string | number | boolean | null | undefined>
) {
  return json<WorkListResponse<JobOpportunity>>(
    `/api/v1/work/opportunities${userQuery(userIds, input)}`
  );
}

export function listJobApplications(
  userIds: string[],
  input?: Record<string, string | number | boolean | null | undefined>
) {
  return json<WorkListResponse<JobApplication>>(
    `/api/v1/work/applications${userQuery(userIds, input)}`
  );
}

export function getWorkEngagement(userIds: string[], id: string) {
  return json<{ engagement: WorkEngagement }>(
    `/api/v1/work/engagements/${encodeURIComponent(id)}${userQuery(userIds, { archived: "include" })}`
  );
}

export function archiveWorkRecord(
  userIds: string[],
  entityType:
    | "work_organization"
    | "work_engagement"
    | "opportunity_campaign"
    | "job_opportunity"
    | "job_application",
  id: string,
  expectedRevision: number
) {
  return json<{ record: WorkRecord }>(
    `/api/v1/work/${encodeURIComponent(entityType)}/${encodeURIComponent(id)}/archive${userQuery(userIds)}`,
    mutationInit("POST", { expectedRevision })
  );
}

export function restoreWorkRecord(
  userIds: string[],
  entityType:
    | "work_organization"
    | "work_engagement"
    | "opportunity_campaign"
    | "job_opportunity"
    | "job_application",
  id: string,
  expectedRevision: number
) {
  return json<{ record: WorkRecord }>(
    `/api/v1/work/${encodeURIComponent(entityType)}/${encodeURIComponent(id)}/restore${userQuery(userIds)}`,
    mutationInit("POST", { expectedRevision })
  );
}

export function getOpportunityCampaign(userIds: string[], id: string) {
  return json<{ campaign: OpportunityCampaign }>(
    `/api/v1/work/campaigns/${encodeURIComponent(id)}${userQuery(userIds)}`
  );
}

export function getJobOpportunity(userIds: string[], id: string) {
  return json<{ opportunity: JobOpportunity }>(
    `/api/v1/work/opportunities/${encodeURIComponent(id)}${userQuery(userIds)}`
  );
}

export function getJobApplication(userIds: string[], id: string) {
  return json<{ application: JobApplication }>(
    `/api/v1/work/applications/${encodeURIComponent(id)}${userQuery(userIds)}`
  );
}

export function getWorkOrganization(userIds: string[], id: string) {
  return json<{ organization: WorkRecord; links: WorkLink[] }>(
    `/api/v1/work/organizations/${encodeURIComponent(id)}${userQuery(userIds)}`
  );
}

export function updateOpportunitySearchSetting(
  userIds: string[],
  body: { lookingForOpportunities: boolean; expectedRevision: number }
) {
  return json<{ settings: WorkContext["settings"][number] }>(
    `/api/v1/work/settings/opportunity-search${userQuery(userIds)}`,
    mutationInit("PATCH", body)
  );
}

export function createWorkOrganization(
  userIds: string[],
  body: Record<string, unknown>
) {
  return json<{ organization: WorkRecord }>(
    `/api/v1/work/organizations${userQuery(userIds)}`,
    mutationInit("POST", body)
  );
}

export function updateWorkOrganization(
  userIds: string[],
  id: string,
  body: Record<string, unknown>
) {
  return json<{ organization: WorkRecord }>(
    `/api/v1/work/organizations/${encodeURIComponent(id)}${userQuery(userIds)}`,
    mutationInit("PATCH", body)
  );
}

export function createWorkEngagement(
  userIds: string[],
  body: Record<string, unknown>
) {
  return json<{ engagement: WorkEngagement }>(
    `/api/v1/work/engagements${userQuery(userIds)}`,
    mutationInit("POST", body)
  );
}

export function updateWorkEngagement(
  userIds: string[],
  id: string,
  body: Record<string, unknown>
) {
  return json<{ engagement: WorkEngagement }>(
    `/api/v1/work/engagements/${encodeURIComponent(id)}${userQuery(userIds)}`,
    mutationInit("PATCH", body)
  );
}

export function createOpportunityCampaign(
  userIds: string[],
  body: Record<string, unknown>
) {
  return json<{ campaign: OpportunityCampaign }>(
    `/api/v1/work/campaigns${userQuery(userIds)}`,
    mutationInit("POST", body)
  );
}

export function updateOpportunityCampaign(
  userIds: string[],
  id: string,
  body: Record<string, unknown>
) {
  return json<{ campaign: OpportunityCampaign }>(
    `/api/v1/work/campaigns/${encodeURIComponent(id)}${userQuery(userIds)}`,
    mutationInit("PATCH", body)
  );
}

export function createCriteriaVersion(
  userIds: string[],
  campaignId: string,
  body: Record<string, unknown>
) {
  return json<{ criteriaVersion: WorkRecord }>(
    `/api/v1/work/campaigns/${encodeURIComponent(campaignId)}/criteria${userQuery(userIds)}`,
    mutationInit("POST", body)
  );
}

export function upsertJobOpportunity(
  userIds: string[],
  body: Record<string, unknown>
) {
  return json<{
    opportunity: JobOpportunity;
    deduplicated?: boolean;
    replayed?: boolean;
  }>(
    `/api/v1/work/opportunities/upsert${userQuery(userIds)}`,
    mutationInit("POST", body)
  );
}

export function updateJobOpportunity(
  userIds: string[],
  id: string,
  body: Record<string, unknown>
) {
  return json<{ opportunity: JobOpportunity }>(
    `/api/v1/work/opportunities/${encodeURIComponent(id)}${userQuery(userIds)}`,
    mutationInit("PATCH", body)
  );
}

export function createJobApplication(
  userIds: string[],
  body: Record<string, unknown>
) {
  return json<{ application: JobApplication }>(
    `/api/v1/work/applications${userQuery(userIds)}`,
    mutationInit("POST", body)
  );
}

export function updateJobApplication(
  userIds: string[],
  id: string,
  body: Record<string, unknown>
) {
  return json<{ application: JobApplication }>(
    `/api/v1/work/applications/${encodeURIComponent(id)}${userQuery(userIds)}`,
    mutationInit("PATCH", body)
  );
}

export function transitionJobApplication(
  userIds: string[],
  id: string,
  body: Record<string, unknown>
) {
  return json<{ application: JobApplication }>(
    `/api/v1/work/applications/${encodeURIComponent(id)}/transitions${userQuery(userIds)}`,
    mutationInit("POST", body)
  );
}

export function recordJobApplicationEvent(
  userIds: string[],
  id: string,
  body: Record<string, unknown>
) {
  return json<{
    replayed: boolean;
    event: WorkRecord;
    application: JobApplication;
  }>(
    `/api/v1/work/applications/${encodeURIComponent(id)}/events${userQuery(userIds)}`,
    mutationInit("POST", body)
  );
}

export function listWorkMetricDefinitions(userIds: string[]) {
  return json<{ definitions: WorkRecord[] }>(
    `/api/v1/work/metrics/definitions${userQuery(userIds)}`
  );
}

export function saveWorkMetricDefinition(
  userIds: string[],
  body: Record<string, unknown>
) {
  return json<{ definition: WorkRecord }>(
    `/api/v1/work/metrics/definitions${userQuery(userIds)}`,
    mutationInit("POST", body)
  );
}

export function recordWorkCheckIn(
  userIds: string[],
  body: Record<string, unknown>
) {
  return json<{
    checkIn: WorkRecord;
    observations: WorkRecord[];
    replayed: boolean;
  }>(`/api/v1/work/check-ins${userQuery(userIds)}`, mutationInit("POST", body));
}

export function listWorkSupportingRecords(
  userIds: string[],
  kind: string,
  input?: { parentId?: string; limit?: number; offset?: number }
) {
  return json<WorkListResponse<WorkRecord> & { redacted?: boolean }>(
    `/api/v1/work/supporting/${encodeURIComponent(kind)}${userQuery(userIds, input)}`
  );
}

export function getWorkSupportingRecord(
  userIds: string[],
  kind: string,
  id: string
) {
  return json<{ record: WorkRecord }>(
    `/api/v1/work/supporting/${encodeURIComponent(kind)}/${encodeURIComponent(id)}${userQuery(userIds)}`
  );
}

export function createWorkSupportingRecord(
  userIds: string[],
  kind: string,
  body: Record<string, unknown>,
  parentId?: string
) {
  return json<{ record: WorkRecord }>(
    `/api/v1/work/supporting/${encodeURIComponent(kind)}${userQuery(userIds, { parentId })}`,
    mutationInit("POST", body)
  );
}

export function updateWorkSupportingRecord(
  userIds: string[],
  kind: string,
  id: string,
  body: Record<string, unknown>
) {
  return json<{ record: WorkRecord }>(
    `/api/v1/work/supporting/${encodeURIComponent(kind)}/${encodeURIComponent(id)}${userQuery(userIds)}`,
    mutationInit("PATCH", body)
  );
}

export function recordWorkSearchRun(
  userIds: string[],
  body: Record<string, unknown>
) {
  return json<{ replayed: boolean; run: WorkRecord; items: WorkRecord[] }>(
    `/api/v1/work/search-runs${userQuery(userIds)}`,
    mutationInit("POST", body)
  );
}

export function listWorkSearchRuns(
  userIds: string[],
  input?: {
    campaignId?: string;
    status?: "running" | "completed" | "partial" | "failed" | "cancelled";
    limit?: number;
    offset?: number;
  }
) {
  return json<WorkListResponse<WorkRecord>>(
    `/api/v1/work/search-runs${userQuery(userIds, input)}`
  );
}

export function getWorkSearchRun(
  userIds: string[],
  id: string,
  input?: { limit?: number; offset?: number }
) {
  return json<{
    run: WorkRecord;
    items: WorkRecord[];
    restrictedItemCount: number;
    page: {
      limit: number;
      offset: number;
      returned: number;
      total: number;
      hasMore: boolean;
      nextOffset: number | null;
    };
  }>(
    `/api/v1/work/search-runs/${encodeURIComponent(id)}${userQuery(userIds, input)}`
  );
}

export function acceptWorkOffer(
  userIds: string[],
  id: string,
  body: { expectedRevision: number; idempotencyKey: string }
) {
  return json<{
    replayed: boolean;
    engagement: WorkEngagement;
    offer: WorkRecord;
    application: JobApplication;
  }>(
    `/api/v1/work/offers/${encodeURIComponent(id)}/accept${userQuery(userIds)}`,
    mutationInit("POST", body)
  );
}

export function replaceWorkRelationships(
  userIds: string[],
  entityType: string,
  id: string,
  body: {
    expectedRevision?: number;
    links: Array<{
      targetEntityType: string;
      targetEntityId: string;
      relationship: string;
      anchorKey: string;
    }>;
  }
) {
  return json<{ links: WorkLink[] }>(
    `/api/v1/work/relationships/${encodeURIComponent(entityType)}/${encodeURIComponent(id)}${userQuery(userIds)}`,
    mutationInit("PUT", body)
  );
}

export function createWorkTransmissionPreview(
  userIds: string[],
  body: Record<string, unknown>
) {
  return json<{
    replayed: boolean;
    preview: WorkRecord;
    application: WorkRecord;
  }>(
    `/api/v1/work/transmissions/previews${userQuery(userIds)}`,
    mutationInit("POST", body)
  );
}

export function requestWorkTransmissionApproval(
  userIds: string[],
  previewId: string,
  body: { idempotencyKey: string }
) {
  return json<{
    preview: WorkRecord;
    approvalRequest: WorkRecord;
    action: WorkRecord;
  }>(
    `/api/v1/work/transmissions/previews/${encodeURIComponent(previewId)}/request-approval${userQuery(userIds)}`,
    mutationInit("POST", body)
  );
}

export function recordWorkVerifiedSubmission(
  userIds: string[],
  body: Record<string, unknown>
) {
  return json<{
    replayed: boolean;
    application: JobApplication;
    preview: WorkRecord;
  }>(
    `/api/v1/work/transmissions/verified-submissions${userQuery(userIds)}`,
    mutationInit("POST", body)
  );
}
