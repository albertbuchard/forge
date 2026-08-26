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
  getOpportunityCampaign,
  getWorkContext,
  getWorkSettings,
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
  resolveSearchView,
  SearchTab
} from "./work-page-search";
import type {
  OpportunityFilters,
  ApplicationFilters,
  SearchView
} from "./work-page-search";
import { ApplicationsTab } from "./work-page-applications";
import {
  DocumentsOperationalTab,
  resolveDocumentsView
} from "./work-page-documents";
import type { DocumentsView } from "./work-page-documents";

export function WorkPage() {
  const shell = useForgeShell();
  const location = useLocation();
  const detail = parseDetail(location.pathname);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = resolveTab(searchParams.get("tab"));
  const searchView = resolveSearchView(searchParams.get("view"));
  const documentsView = resolveDocumentsView(searchParams.get("view"));
  const detailSection = searchParams.get("section") ?? "summary";
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
  const hasUsers = userIds.length > 0;
  const detailKind = detail?.kind;
  const needsContext =
    (!detail && ["overview", "check-ins", "plans"].includes(tab)) ||
    (detailKind === "engagements" && detailSection === "check-ins");
  const needsEngagements =
    (!detail && ["current", "check-ins", "plans"].includes(tab)) ||
    campaignOpen ||
    checkInOpen;
  const needsOrganizations =
    (!detail && ["overview", "current"].includes(tab)) ||
    (!detail && tab === "searches" && searchView === "targets") ||
    [
      "engagements",
      "campaigns",
      "opportunities",
      "interviews",
      "offers",
      "outreach"
    ].includes(detailKind ?? "") ||
    engagementOpen;
  const needsCampaigns =
    (!detail && ["plans", "searches", "applications"].includes(tab)) ||
    ["campaigns", "opportunities", "interviews", "offers", "outreach"].includes(
      detailKind ?? ""
    ) ||
    applicationOpen;
  const needsOpportunities =
    (!detail && tab === "overview") ||
    (!detail && tab === "searches" && searchView === "roles") ||
    (!detail && tab === "applications") ||
    detailKind === "campaigns" ||
    applicationOpen;
  const needsApplications =
    (!detail && tab === "overview") ||
    (!detail && tab === "searches" && searchView === "roles") ||
    (!detail && tab === "applications") ||
    ["campaigns", "interviews", "offers", "outreach"].includes(
      detailKind ?? ""
    );
  const needsMetrics = (!detail && tab === "check-ins") || checkInOpen;
  const needsProfiles =
    (!detail && tab === "searches" && searchView === "activity") ||
    (!detail &&
      tab === "documents" &&
      ["positioning", "documents"].includes(documentsView));
  const needsDocuments =
    (!detail && tab === "searches" && searchView === "activity") ||
    (!detail && tab === "documents" && documentsView === "documents");
  const needsResponses =
    !detail && tab === "documents" && documentsView === "answers";
  const needsOutreach =
    !detail && tab === "searches" && searchView === "targets";
  const needsApplicationActivity = !detail && tab === "applications";
  const overviewQuery = useQuery({
    queryKey: [
      "work",
      "overview",
      scopeKey,
      trendWindowDays,
      detailKind === "engagements" ? detail?.id : ""
    ],
    queryFn: () =>
      getWorkContext(userIds, {
        trendWindowDays,
        ...(detailKind === "engagements" && detail?.id
          ? { engagementId: detail.id }
          : {})
      }),
    enabled: hasUsers && needsContext
  });
  const settingsQuery = useQuery({
    queryKey: ["work", "settings", scopeKey],
    queryFn: () => getWorkSettings(userIds),
    enabled: hasUsers && !detail
  });
  const engagementQuery = useQuery({
    queryKey: ["work", "engagements", scopeKey],
    queryFn: () =>
      listWorkEngagements(userIds, { limit: 50, archived: "include" }),
    enabled: hasUsers && needsEngagements
  });
  const organizationQuery = useQuery({
    queryKey: ["work", "organizations", scopeKey],
    queryFn: () => listWorkOrganizations(userIds, { limit: 50 }),
    enabled: hasUsers && needsOrganizations
  });
  const campaignQuery = useQuery({
    queryKey: ["work", "campaigns", scopeKey],
    queryFn: () => listOpportunityCampaigns(userIds, { limit: 50 }),
    enabled: hasUsers && needsCampaigns
  });
  const selectedCampaignForQuery =
    selectedCampaignId ||
    campaignQuery.data?.items.find((campaign) => campaign.status === "active")
      ?.id ||
    campaignQuery.data?.items[0]?.id ||
    "";
  const needsSelectedCampaignDetail =
    !detail &&
    tab === "searches" &&
    ["roles", "targets", "activity"].includes(searchView) &&
    Boolean(selectedCampaignForQuery);
  const selectedCampaignDetailQuery = useQuery({
    queryKey: ["work", "campaign-detail", selectedCampaignForQuery, scopeKey],
    queryFn: () => getOpportunityCampaign(userIds, selectedCampaignForQuery),
    enabled: hasUsers && needsSelectedCampaignDetail
  });
  const opportunityListInput =
    detail || tab !== "searches" || searchView !== "roles"
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
    enabled: hasUsers && needsOpportunities
  });
  const applicationQuery = useQuery({
    queryKey: ["work", "applications", scopeKey, applicationListInput],
    queryFn: () =>
      listJobApplications(userIds, {
        limit: 50,
        sort: "priority_desc",
        ...applicationListInput
      }),
    enabled: hasUsers && needsApplications
  });
  const metricQuery = useQuery({
    queryKey: ["work", "metric-definitions", scopeKey],
    queryFn: () => listWorkMetricDefinitions(userIds),
    enabled: hasUsers && needsMetrics
  });
  const profileQuery = useQuery({
    queryKey: ["work", "positioning-profiles", scopeKey],
    queryFn: () =>
      listWorkSupportingRecords(userIds, "positioningProfile", { limit: 50 }),
    enabled: hasUsers && needsProfiles
  });
  const documentQuery = useQuery({
    queryKey: ["work", "document-sets", scopeKey],
    queryFn: () =>
      listWorkSupportingRecords(userIds, "documentSet", { limit: 50 }),
    enabled: hasUsers && needsDocuments
  });
  const responseQuery = useQuery({
    queryKey: ["work", "responses", scopeKey],
    queryFn: () =>
      listWorkSupportingRecords(userIds, "reusableResponse", { limit: 50 }),
    enabled: hasUsers && needsResponses
  });
  const outreachQuery = useQuery({
    queryKey: ["work", "outreach", scopeKey],
    queryFn: () =>
      listWorkSupportingRecords(userIds, "outreach", { limit: 50 }),
    enabled: hasUsers && needsOutreach
  });
  const interviewQuery = useQuery({
    queryKey: ["work", "interviews", scopeKey],
    queryFn: () =>
      listWorkSupportingRecords(userIds, "interview", { limit: 50 }),
    enabled: hasUsers && needsApplicationActivity
  });
  const offerQuery = useQuery({
    queryKey: ["work", "offers", scopeKey],
    queryFn: () => listWorkSupportingRecords(userIds, "offer", { limit: 50 }),
    enabled: hasUsers && needsApplicationActivity
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
    context?.campaigns ?? [],
    selectedCampaignDetailQuery.data?.campaign
      ? [selectedCampaignDetailQuery.data.campaign]
      : []
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
  const settings = settingsQuery.data?.settings[0] ??
    context?.settings[0] ?? {
      lookingForOpportunities: false,
      revision: 0
    };
  const looking = settings.lookingForOpportunities;
  const selectedCampaign =
    selectedCampaignForQuery ||
    campaigns.find((campaign) => campaign.status === "active")?.id ||
    campaigns[0]?.id ||
    "";
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
  const setActiveView = (view: SearchView | DocumentsView) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    next.set("view", view);
    setSearchParams(next, { replace: true });
  };

  if (detail)
    return (
      <div
        data-work-surface="ready"
        className="grid min-w-0 gap-0 [&_button]:min-h-11 [&_button]:min-w-11 [&_select]:min-h-11"
      >
        <WorkDetail
          kind={detail.kind}
          id={detail.id}
          userIds={userIds}
          organizations={organizations}
          campaigns={campaigns}
          opportunities={opportunities}
          applications={applications}
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
      </div>
    );
  const activeQueryStates = [
    {
      active: needsContext,
      error: overviewQuery.error,
      loading: overviewQuery.isLoading
    },
    {
      active: !detail,
      error: settingsQuery.error,
      loading: settingsQuery.isLoading
    },
    {
      active: needsEngagements,
      error: engagementQuery.error,
      loading: engagementQuery.isLoading
    },
    {
      active: needsOrganizations,
      error: organizationQuery.error,
      loading: organizationQuery.isLoading
    },
    {
      active: needsCampaigns,
      error: campaignQuery.error,
      loading: campaignQuery.isLoading
    },
    {
      active: needsSelectedCampaignDetail,
      error: selectedCampaignDetailQuery.error,
      loading: selectedCampaignDetailQuery.isLoading
    },
    {
      active: needsOpportunities,
      error: opportunityQuery.error,
      loading: opportunityQuery.isLoading
    },
    {
      active: needsApplications,
      error: applicationQuery.error,
      loading: applicationQuery.isLoading
    },
    {
      active: needsMetrics,
      error: metricQuery.error,
      loading: metricQuery.isLoading
    },
    {
      active: needsProfiles,
      error: profileQuery.error,
      loading: profileQuery.isLoading
    },
    {
      active: needsDocuments,
      error: documentQuery.error,
      loading: documentQuery.isLoading
    },
    {
      active: needsResponses,
      error: responseQuery.error,
      loading: responseQuery.isLoading
    },
    {
      active: needsOutreach,
      error: outreachQuery.error,
      loading: outreachQuery.isLoading
    },
    {
      active: needsApplicationActivity,
      error: interviewQuery.error,
      loading: interviewQuery.isLoading
    },
    {
      active: needsApplicationActivity,
      error: offerQuery.error,
      loading: offerQuery.isLoading
    }
  ];
  const primaryError = activeQueryStates.find(
    (query) => query.active && query.error
  )?.error;
  if (!userIds.length)
    return (
      <div className="p-6">
        <EmptyState
          title="Choose a Forge user"
          description="Work is private owner-scoped context. Select one user before creating or editing work records."
        />
      </div>
    );
  if (activeQueryStates.some((query) => query.active && query.loading))
    return (
      <div className="p-6">
        <LoadingState
          eyebrow="Work"
          title="Loading current work…"
          description="Loading only the records needed for this view."
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
        view={searchView}
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
        onViewChange={setActiveView}
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
        view={documentsView}
        profiles={profileQuery.data?.items ?? []}
        documentSets={documentQuery.data?.items ?? []}
        responses={responseQuery.data?.items ?? []}
        mutationEnabled={mutationEnabled}
        userIds={userIds}
        onRefresh={refresh}
        onViewChange={setActiveView}
      />
    );

  return (
    <div
      data-work-surface="ready"
      className="grid min-w-0 gap-0 [&_button]:min-h-11 [&_button]:min-w-11 [&_select]:min-h-11"
    >
      <PageHero
        entityKind="work_engagement"
        title="Work"
        description="Current work, career direction, job searches, applications, and the documents used for them."
        badge={looking ? "Looking for work" : "Work history saved"}
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
          This page is showing a shorter summary. Open a specific role or job
          search to see all of its details.
        </div>
      ) : null}
      <main className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 sm:px-6 lg:py-7 [&>*]:min-w-0">
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
