import { useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearchParams } from "react-router-dom";
import { PageHero } from "@/components/shell/page-hero";
import { useForgeShell } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import {
  EmptyState,
  ErrorState,
  LoadingState
} from "@/components/ui/page-state";
import { WorkTabBar } from "@/components/work/work-components";
import { WorkDetail } from "@/components/work/work-detail";
import {
  OpportunityCampaignDialog,
  WorkEngagementDialog,
  WorkOrganizationDialog
} from "@/components/work/work-dialogs";
import {
  JobApplicationDialog,
  JobOpportunityDialog,
  WorkCheckInDialog
} from "@/components/work/work-pipeline-dialogs";
import {
  getWorkContext,
  listJobApplications,
  listJobOpportunities,
  listOpportunityCampaigns,
  listWorkEngagements,
  listWorkMetricDefinitions,
  listWorkOrganizations,
  listWorkSupportingRecords,
  updateOpportunitySearchSetting
} from "@/lib/work-api";
import type {
  OpportunityCampaign,
  WorkEngagement,
  WorkRecord
} from "@/lib/work-api";
import {
  resolveTab,
  parseDetail,
  uniqueById,
  selectedOwners,
  OverviewTab,
  CurrentWorkTab
} from "./work-page-overview";
import { CheckInsTab } from "./work-page-checkins";
import type { TrendWindowDays } from "./work-page-checkins";
import { PlansTab } from "./work-page-plans";
import {
  EMPTY_OPPORTUNITY_FILTERS,
  EMPTY_APPLICATION_FILTERS,
  ApplicationFilterBar,
  SearchTab
} from "./work-page-search";
import type {
  OpportunityFilters,
  ApplicationFilters
} from "./work-page-search";
import { ApplicationsTab } from "./work-page-applications";
import { DocumentsOperationalTab } from "./work-page-documents";

export function WorkPage() {
  const shell = useForgeShell();
  const location = useLocation();
  const detail = parseDetail(location.pathname);
  const [searchParams] = useSearchParams();
  const tab = resolveTab(searchParams.get("tab"));
  const queryClient = useQueryClient();
  const userIds = selectedOwners(shell);
  const mutationEnabled = userIds.length === 1;
  const scopeKey = userIds.join(",");
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [opportunityFilters, setOpportunityFilters] =
    useState<OpportunityFilters>(EMPTY_OPPORTUNITY_FILTERS);
  const [applicationFilters, setApplicationFilters] =
    useState<ApplicationFilters>(EMPTY_APPLICATION_FILTERS);
  const [trendWindowDays, setTrendWindowDays] = useState<TrendWindowDays>(90);
  const overviewQuery = useQuery({
    queryKey: ["work", "overview", scopeKey, trendWindowDays],
    queryFn: () => getWorkContext(userIds, { trendWindowDays }),
    enabled: userIds.length > 0
  });
  const engagementQuery = useQuery({
    queryKey: ["work", "engagements", scopeKey],
    queryFn: () =>
      listWorkEngagements(userIds, { limit: 50, archived: "include" }),
    enabled: userIds.length > 0
  });
  const organizationQuery = useQuery({
    queryKey: ["work", "organizations", scopeKey],
    queryFn: () => listWorkOrganizations(userIds, { limit: 50 }),
    enabled: userIds.length > 0
  });
  const campaignQuery = useQuery({
    queryKey: ["work", "campaigns", scopeKey],
    queryFn: () => listOpportunityCampaigns(userIds, { limit: 50 }),
    enabled: userIds.length > 0
  });
  const selectedCampaignForQuery =
    selectedCampaignId ||
    campaignQuery.data?.items.find((campaign) => campaign.status === "active")
      ?.id ||
    campaignQuery.data?.items[0]?.id ||
    "";
  const opportunityListInput =
    detail || tab !== "searches"
      ? {}
      : {
          query: opportunityFilters.query || undefined,
          employer: opportunityFilters.employer || undefined,
          location: opportunityFilters.location || undefined,
          workModel: opportunityFilters.workModel || undefined,
          campaignId:
            opportunityFilters.minimumScore || opportunityFilters.hardGate
              ? selectedCampaignForQuery || undefined
              : undefined,
          hardGate: opportunityFilters.hardGate || undefined,
          minimumScore: opportunityFilters.minimumScore || undefined,
          deadlineBefore: opportunityFilters.deadlineBefore || undefined,
          missingInformation: opportunityFilters.missingInformation
            ? true
            : undefined,
          stale: opportunityFilters.stale ? true : undefined
        };
  const applicationListInput =
    detail || tab !== "applications"
      ? {}
      : {
          query: applicationFilters.query || undefined,
          employer: applicationFilters.employer || undefined,
          campaignId: applicationFilters.campaignId || undefined,
          status: applicationFilters.status || undefined,
          deadlineBefore: applicationFilters.deadlineBefore || undefined,
          hasNextAction: applicationFilters.hasNextAction ? true : undefined
        };
  const opportunityQuery = useQuery({
    queryKey: ["work", "opportunities", scopeKey, opportunityListInput],
    queryFn: () =>
      listJobOpportunities(userIds, {
        limit: 50,
        sort: "deadline_asc",
        ...opportunityListInput
      }),
    enabled: userIds.length > 0
  });
  const applicationQuery = useQuery({
    queryKey: ["work", "applications", scopeKey, applicationListInput],
    queryFn: () =>
      listJobApplications(userIds, {
        limit: 50,
        sort: "priority_desc",
        ...applicationListInput
      }),
    enabled: userIds.length > 0
  });
  const metricQuery = useQuery({
    queryKey: ["work", "metric-definitions", scopeKey],
    queryFn: () => listWorkMetricDefinitions(userIds),
    enabled: userIds.length > 0
  });
  const profileQuery = useQuery({
    queryKey: ["work", "positioning-profiles", scopeKey],
    queryFn: () =>
      listWorkSupportingRecords(userIds, "positioningProfile", { limit: 50 }),
    enabled: userIds.length > 0
  });
  const documentQuery = useQuery({
    queryKey: ["work", "document-sets", scopeKey],
    queryFn: () =>
      listWorkSupportingRecords(userIds, "documentSet", { limit: 50 }),
    enabled: userIds.length > 0
  });
  const responseQuery = useQuery({
    queryKey: ["work", "responses", scopeKey],
    queryFn: () =>
      listWorkSupportingRecords(userIds, "reusableResponse", { limit: 50 }),
    enabled: userIds.length > 0
  });
  const outreachQuery = useQuery({
    queryKey: ["work", "outreach", scopeKey],
    queryFn: () =>
      listWorkSupportingRecords(userIds, "outreach", { limit: 50 }),
    enabled: userIds.length > 0
  });
  const interviewQuery = useQuery({
    queryKey: ["work", "interviews", scopeKey],
    queryFn: () =>
      listWorkSupportingRecords(userIds, "interview", { limit: 50 }),
    enabled: userIds.length > 0
  });
  const offerQuery = useQuery({
    queryKey: ["work", "offers", scopeKey],
    queryFn: () => listWorkSupportingRecords(userIds, "offer", { limit: 50 }),
    enabled: userIds.length > 0
  });
  const context = overviewQuery.data;
  const engagements = uniqueById<WorkEngagement>(
    engagementQuery.data?.items ?? [],
    context?.engagements ?? []
  );
  const activeEngagements = engagements.filter(
    (engagement) => !engagement.deletedAt
  );
  const campaigns = uniqueById<OpportunityCampaign>(
    campaignQuery.data?.items ?? [],
    context?.campaigns ?? []
  );
  const organizations = organizationQuery.data?.items ?? [];
  const rawOpportunities = opportunityQuery.data?.items ?? [];
  const evaluations = campaigns.flatMap(
    (campaign) =>
      (campaign.latestEvaluations ?? campaign.evaluations ?? []) as WorkRecord[]
  );
  const opportunities = rawOpportunities.map((opportunity) => ({
    ...opportunity,
    evaluations: evaluations.filter(
      (evaluation) => evaluation.opportunityId === opportunity.id
    )
  }));
  const applications = applicationQuery.data?.items ?? [];
  const trends =
    context?.engagements.flatMap((engagement) => engagement.trends ?? []) ?? [];
  const definitions = metricQuery.data?.definitions ?? [];
  const settings = context?.settings[0] ?? {
    lookingForOpportunities: false,
    revision: 0
  };
  const looking = settings.lookingForOpportunities;
  const selectedCampaign =
    selectedCampaignForQuery ||
    campaigns.find((campaign) => campaign.status === "active")?.id ||
    campaigns[0]?.id ||
    "";
  const [organizationOpen, setOrganizationOpen] = useState(false);
  const [engagementOpen, setEngagementOpen] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [opportunityOpen, setOpportunityOpen] = useState(false);
  const [applicationOpen, setApplicationOpen] = useState(false);
  const [applicationOpportunityId, setApplicationOpportunityId] = useState<
    string | undefined
  >();
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [checkInEngagementId, setCheckInEngagementId] = useState<
    string | undefined
  >();

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["work"] });
  };
  const toggle = useMutation({
    mutationFn: (value: boolean) =>
      updateOpportunitySearchSetting(userIds, {
        lookingForOpportunities: value,
        expectedRevision: settings.revision
      }),
    onSuccess: refresh
  });

  const openCheckIn = (engagementId?: string) => {
    setCheckInEngagementId(engagementId);
    setCheckInOpen(true);
  };
  const openApplication = (opportunityId?: string) => {
    setApplicationOpportunityId(opportunityId);
    setApplicationOpen(true);
  };

  if (detail)
    return (
      <>
        <WorkDetail
          kind={detail.kind}
          id={detail.id}
          userIds={userIds}
          engagements={engagements}
          organizations={organizations}
          campaigns={campaigns}
          opportunities={opportunities}
          applications={applications}
          profiles={profileQuery.data?.items ?? []}
          documentSets={documentQuery.data?.items ?? []}
          responses={responseQuery.data?.items ?? []}
          trends={trends}
          onRefresh={refresh}
          onCheckIn={openCheckIn}
        />
        <WorkCheckInDialog
          open={checkInOpen}
          onOpenChange={setCheckInOpen}
          userIds={userIds}
          engagements={activeEngagements}
          definitions={definitions}
          initialEngagementId={checkInEngagementId}
          onSaved={refresh}
        />
      </>
    );
  const primaryError =
    overviewQuery.error ??
    engagementQuery.error ??
    organizationQuery.error ??
    campaignQuery.error ??
    opportunityQuery.error ??
    applicationQuery.error ??
    metricQuery.error ??
    outreachQuery.error ??
    interviewQuery.error ??
    offerQuery.error;
  if (!userIds.length)
    return (
      <div className="p-6">
        <EmptyState
          title="Choose a Forge user"
          description="Work is private owner-scoped context. Select one user before creating or editing work records."
        />
      </div>
    );
  if (
    overviewQuery.isLoading ||
    engagementQuery.isLoading ||
    campaignQuery.isLoading
  )
    return (
      <div className="p-6">
        <LoadingState
          eyebrow="Work"
          title="Loading current work…"
          description="Reading engagements, check-ins, campaigns, opportunities, applications, and next actions."
        />
      </div>
    );
  if (primaryError)
    return (
      <div className="p-6">
        <ErrorState error={primaryError} onRetry={() => void refresh()} />
      </div>
    );

  let content: ReactNode;
  if (tab === "overview")
    content = (
      <OverviewTab
        engagements={activeEngagements}
        organizations={organizations}
        campaigns={campaigns}
        applications={applications}
        opportunities={opportunities}
        looking={looking}
        settingsRevision={settings.revision}
        mutationEnabled={mutationEnabled}
        togglePending={toggle.isPending}
        onToggle={(value) => toggle.mutate(value)}
        onAddEngagement={() => setEngagementOpen(true)}
        onCreateCampaign={() => setCampaignOpen(true)}
        onCheckIn={openCheckIn}
      />
    );
  else if (tab === "current")
    content = (
      <CurrentWorkTab
        engagements={engagements}
        organizations={organizations}
        mutationEnabled={mutationEnabled}
        onAddEngagement={() => setEngagementOpen(true)}
        onAddOrganization={() => setOrganizationOpen(true)}
        onCheckIn={(id) => openCheckIn(id)}
      />
    );
  else if (tab === "check-ins")
    content = (
      <CheckInsTab
        engagements={activeEngagements}
        trends={trends}
        definitions={definitions}
        trendWindowDays={trendWindowDays}
        mutationEnabled={mutationEnabled}
        userIds={userIds}
        onRefresh={refresh}
        onCheckIn={openCheckIn}
        onTrendWindowChange={setTrendWindowDays}
      />
    );
  else if (tab === "plans")
    content = <PlansTab engagements={engagements} campaigns={campaigns} />;
  else if (tab === "searches")
    content = (
      <SearchTab
        looking={looking}
        settingsRevision={settings.revision}
        campaigns={campaigns}
        opportunities={opportunities}
        applications={applications}
        organizations={organizations}
        outreach={outreachQuery.data?.items ?? []}
        profiles={profileQuery.data?.items ?? []}
        documentSets={documentQuery.data?.items ?? []}
        userIds={userIds}
        mutationEnabled={mutationEnabled}
        togglePending={toggle.isPending}
        filters={opportunityFilters}
        hasMore={Boolean(opportunityQuery.data?.hasMore)}
        selectedCampaignId={selectedCampaign}
        onSelectCampaign={setSelectedCampaignId}
        onToggle={(value) => toggle.mutate(value)}
        onFiltersChange={setOpportunityFilters}
        onCreateCampaign={() => setCampaignOpen(true)}
        onAddOpportunity={() => setOpportunityOpen(true)}
        onStartApplication={openApplication}
        onRefresh={refresh}
      />
    );
  else if (tab === "applications")
    content = (
      <div className="grid gap-5">
        <ApplicationFilterBar
          value={applicationFilters}
          campaigns={campaigns}
          hasMore={Boolean(applicationQuery.data?.hasMore)}
          onChange={setApplicationFilters}
        />
        <ApplicationsTab
          applications={applications}
          opportunities={opportunities}
          campaigns={campaigns}
          interviews={interviewQuery.data?.items ?? []}
          offers={offerQuery.data?.items ?? []}
          mutationEnabled={mutationEnabled}
          onCreate={() => openApplication()}
        />
      </div>
    );
  else
    content = (
      <DocumentsOperationalTab
        profiles={profileQuery.data?.items ?? []}
        documentSets={documentQuery.data?.items ?? []}
        responses={responseQuery.data?.items ?? []}
        mutationEnabled={mutationEnabled}
        userIds={userIds}
        onRefresh={refresh}
      />
    );

  return (
    <div className="grid min-w-0 gap-0">
      <PageHero
        entityKind="work_engagement"
        title="Work"
        description="Current jobs, work experience over time, career direction, opportunity searches, applications, and exact documents in one connected view."
        badge={looking ? "Looking for opportunities" : "Permanent work context"}
        actions={
          !mutationEnabled ? (
            <Badge tone="meta" wrap>
              Select one user to edit
            </Badge>
          ) : undefined
        }
      />
      <WorkTabBar active={tab} />
      {context?.contextTruncated ? (
        <div className="mx-4 mt-4 rounded-[18px] border border-[color-mix(in_srgb,var(--warning)_30%,var(--ui-border-subtle))] bg-[color-mix(in_srgb,var(--warning)_7%,var(--ui-surface-1))] px-4 py-3 text-sm text-[var(--ui-ink-medium)]">
          The compound Work context was safely bounded. Open a specific role or
          campaign for its complete nested context.
        </div>
      ) : null}
      <main className="grid min-w-0 gap-6 px-4 py-6 sm:px-6 lg:py-7">
        {content}
      </main>
      <WorkOrganizationDialog
        open={organizationOpen}
        onOpenChange={setOrganizationOpen}
        userIds={userIds}
        onSaved={refresh}
      />
      <WorkEngagementDialog
        open={engagementOpen}
        onOpenChange={setEngagementOpen}
        userIds={userIds}
        organizations={organizations}
        onSaved={refresh}
      />
      <OpportunityCampaignDialog
        open={campaignOpen}
        onOpenChange={setCampaignOpen}
        userIds={userIds}
        engagements={activeEngagements}
        onSaved={refresh}
      />
      <JobOpportunityDialog
        open={opportunityOpen}
        onOpenChange={setOpportunityOpen}
        userIds={userIds}
        onSaved={refresh}
      />
      <JobApplicationDialog
        open={applicationOpen}
        onOpenChange={setApplicationOpen}
        userIds={userIds}
        campaigns={campaigns}
        opportunities={opportunities}
        initialOpportunityId={applicationOpportunityId}
        onSaved={refresh}
      />
      <WorkCheckInDialog
        open={checkInOpen}
        onOpenChange={setCheckInOpen}
        userIds={userIds}
        engagements={activeEngagements}
        definitions={definitions}
        initialEngagementId={checkInEngagementId}
        onSaved={refresh}
      />
    </div>
  );
}
