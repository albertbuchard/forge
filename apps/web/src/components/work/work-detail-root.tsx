import { useQuery } from "@tanstack/react-query";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import {
  getJobApplication,
  getJobOpportunity,
  getOpportunityCampaign,
  getWorkEngagement,
  getWorkOrganization,
  getWorkSupportingRecord
} from "@/lib/work-api";
import type {
  JobApplication,
  JobOpportunity,
  OpportunityCampaign,
  WorkRecord,
  WorkTrendSeries
} from "@/lib/work-api";
import type { WorkDetailKind } from "./work-detail-shared";
import { EngagementDetail } from "./work-engagement-detail";
import { CampaignDetail } from "./work-campaign-detail";
import { OpportunityDetail } from "./work-opportunity-detail";
import { ApplicationWorkspaceDetail } from "./work-application-detail";
import {
  OrganizationOperationalDetail,
  SupportingOperationalDetail
} from "./work-supporting-detail";

export function WorkDetail({
  kind,
  id,
  userIds,
  organizations,
  campaigns,
  opportunities,
  applications,
  trends,
  onRefresh,
  onCheckIn
}: {
  kind: WorkDetailKind;
  id: string;
  userIds: string[];
  organizations: WorkRecord[];
  campaigns: OpportunityCampaign[];
  opportunities: JobOpportunity[];
  applications: JobApplication[];
  trends: WorkTrendSeries[];
  onRefresh: () => Promise<void>;
  onCheckIn: (engagementId: string) => void;
}) {
  const engagementQuery = useQuery({
    queryKey: ["work", "engagement", id, userIds],
    queryFn: () => getWorkEngagement(userIds, id),
    enabled: kind === "engagements" && userIds.length > 0
  });
  const organizationQuery = useQuery({
    queryKey: ["work", "organization", id, userIds],
    queryFn: () => getWorkOrganization(userIds, id),
    enabled: kind === "organizations" && userIds.length > 0
  });
  const campaignQuery = useQuery({
    queryKey: ["work", "campaign", id, userIds],
    queryFn: () => getOpportunityCampaign(userIds, id),
    enabled: kind === "campaigns" && userIds.length > 0
  });
  const opportunityQuery = useQuery({
    queryKey: ["work", "opportunity", id, userIds],
    queryFn: () => getJobOpportunity(userIds, id),
    enabled: kind === "opportunities" && userIds.length > 0
  });
  const applicationQuery = useQuery({
    queryKey: ["work", "application", id, userIds],
    queryFn: () => getJobApplication(userIds, id),
    enabled: kind === "applications" && userIds.length > 0
  });
  const applicationOpportunityId =
    kind === "applications"
      ? applicationQuery.data?.application.opportunityId
      : undefined;
  const boundedApplicationOpportunity = opportunities.find(
    (item) => item.id === applicationOpportunityId
  );
  const applicationOpportunityQuery = useQuery({
    queryKey: ["work", "opportunity", applicationOpportunityId, userIds],
    queryFn: () => getJobOpportunity(userIds, String(applicationOpportunityId)),
    enabled:
      kind === "applications" &&
      userIds.length > 0 &&
      Boolean(applicationOpportunityId) &&
      !boundedApplicationOpportunity
  });
  const applicationCampaignId =
    kind === "applications"
      ? applicationQuery.data?.application.primaryCampaignId
      : undefined;
  const boundedApplicationCampaign = campaigns.find(
    (item) => item.id === applicationCampaignId
  );
  const applicationCampaignQuery = useQuery({
    queryKey: ["work", "campaign", applicationCampaignId, userIds],
    queryFn: () =>
      getOpportunityCampaign(userIds, String(applicationCampaignId)),
    enabled:
      kind === "applications" &&
      userIds.length > 0 &&
      Boolean(applicationCampaignId) &&
      !boundedApplicationCampaign
  });
  const supportingKind =
    kind === "interviews"
      ? "interview"
      : kind === "offers"
        ? "offer"
        : kind === "outreach"
          ? "outreach"
          : "";
  const supportingQuery = useQuery({
    queryKey: ["work", "supporting", supportingKind, id, userIds],
    queryFn: () => getWorkSupportingRecord(userIds, supportingKind, id),
    enabled: Boolean(supportingKind) && userIds.length > 0
  });
  const active =
    kind === "engagements"
      ? engagementQuery
      : kind === "organizations"
        ? organizationQuery
        : kind === "campaigns"
          ? campaignQuery
          : kind === "opportunities"
            ? opportunityQuery
            : kind === "applications"
              ? applicationQuery
              : supportingQuery;
  const linkedApplicationContextLoading =
    kind === "applications" &&
    Boolean(applicationQuery.data) &&
    ((!boundedApplicationOpportunity &&
      applicationOpportunityQuery.isLoading) ||
      (!boundedApplicationCampaign && applicationCampaignQuery.isLoading));
  if (active.isLoading || linkedApplicationContextLoading)
    return (
      <div className="p-6">
        <LoadingState
          title="Loading Work detail…"
          description="Reading the authorized record, history, and connected context."
        />
      </div>
    );
  if (active.error)
    return (
      <div className="p-6">
        <ErrorState
          error={active.error}
          onRetry={() => void active.refetch()}
        />
      </div>
    );
  if (kind === "engagements" && engagementQuery.data) {
    const engagement = engagementQuery.data.engagement;
    const engagementTrends = trends.filter(
      (series) => series.engagementId === engagement.id
    );
    return (
      <EngagementDetail
        engagement={engagement}
        organizations={organizations}
        trends={engagementTrends}
        userIds={userIds}
        onRefresh={onRefresh}
        onCheckIn={() => onCheckIn(engagement.id)}
      />
    );
  }
  if (kind === "organizations" && organizationQuery.data)
    return (
      <OrganizationOperationalDetail
        organization={{
          ...organizationQuery.data.organization,
          links: organizationQuery.data.links
        }}
        userIds={userIds}
        onRefresh={onRefresh}
      />
    );
  if (kind === "campaigns" && campaignQuery.data)
    return (
      <CampaignDetail
        campaign={campaignQuery.data.campaign}
        organizations={organizations}
        opportunities={opportunities}
        applications={applications}
        userIds={userIds}
        onRefresh={onRefresh}
      />
    );
  if (kind === "opportunities" && opportunityQuery.data)
    return (
      <OpportunityDetail
        opportunity={opportunityQuery.data.opportunity}
        organizations={organizations}
        campaigns={campaigns}
        allOpportunities={opportunities}
        userIds={userIds}
        onRefresh={onRefresh}
      />
    );
  if (kind === "applications" && applicationQuery.data) {
    const application = applicationQuery.data.application;
    return (
      <ApplicationWorkspaceDetail
        application={application}
        opportunity={
          boundedApplicationOpportunity ??
          applicationOpportunityQuery.data?.opportunity
        }
        campaign={
          boundedApplicationCampaign ?? applicationCampaignQuery.data?.campaign
        }
        userIds={userIds}
        onRefresh={onRefresh}
      />
    );
  }
  if (supportingKind && supportingQuery.data)
    return (
      <SupportingOperationalDetail
        kind={kind as "interviews" | "offers" | "outreach"}
        item={supportingQuery.data.record}
        userIds={userIds}
        campaigns={campaigns}
        organizations={organizations}
        applications={applications}
        onRefresh={onRefresh}
      />
    );
  return (
    <div className="p-6">
      <ErrorState
        error={new Error("The requested Work record is unavailable.")}
      />
    </div>
  );
}
