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
import { EventTimeline } from "./work-detail-shared";
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
  profiles,
  documentSets,
  responses,
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
  profiles: WorkRecord[];
  documentSets: WorkRecord[];
  responses: WorkRecord[];
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
  if (active.isLoading)
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
      <div className="grid gap-5">
        <OrganizationOperationalDetail
          organization={{
            ...organizationQuery.data.organization,
            links: organizationQuery.data.links
          }}
          userIds={userIds}
          onRefresh={onRefresh}
        />
        <div className="px-4 sm:px-6">
          <EventTimeline
            events={organizationQuery.data.organization.history}
            empty="No organization history has been recorded."
          />
        </div>
      </div>
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
        opportunity={opportunities.find(
          (item) => item.id === application.opportunityId
        )}
        campaign={campaigns.find(
          (item) => item.id === application.primaryCampaignId
        )}
        profiles={profiles}
        documentSets={documentSets}
        responses={responses}
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
