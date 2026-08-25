import { useState } from "react";
import { Link } from "react-router-dom";
import { BriefcaseBusiness, List, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-state";
import {
  ApplicationPipeline,
  WorkStatusBadge,
  formatDate,
  readable
} from "@/components/work/work-components";
import type {
  JobApplication,
  JobOpportunity,
  OpportunityCampaign,
  WorkRecord
} from "@/lib/work-api";
import { cn } from "@/lib/utils";
import { SectionHeading } from "./work-page-overview";

export function workObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function offerCompensationLabel(offer: WorkRecord) {
  const base = workObject(workObject(offer.privateCompensation).base);
  if (base.amount == null || base.unknown === true)
    return "Unknown or not stored";
  return `${String(base.amount)} ${String(base.currency ?? "")} per ${String(base.period ?? "period")}`;
}

export function ApplicationsTab({
  applications,
  opportunities,
  campaigns,
  interviews,
  offers,
  mutationEnabled,
  onCreate
}: {
  applications: JobApplication[];
  opportunities: JobOpportunity[];
  campaigns: OpportunityCampaign[];
  interviews: WorkRecord[];
  offers: WorkRecord[];
  mutationEnabled: boolean;
  onCreate: () => void;
}) {
  const [view, setView] = useState<"board" | "list">("board");
  const opportunityById = new Map(
    opportunities.map((opportunity) => [opportunity.id, opportunity])
  );
  const campaignById = new Map(
    campaigns.map((campaign) => [campaign.id, campaign])
  );
  const applicationById = new Map(
    applications.map((application) => [application.id, application])
  );
  const upcomingInterviews = [...interviews]
    .filter(
      (interview) =>
        typeof interview.scheduledStartAt === "string" &&
        new Date(interview.scheduledStartAt).getTime() >= Date.now() - 3_600_000
    )
    .sort((left, right) =>
      String(left.scheduledStartAt).localeCompare(
        String(right.scheduledStartAt)
      )
    )
    .slice(0, 6);
  const applicationList =
    applications.length === 0 ? (
      <EmptyState
        title="No application workspace yet"
        description="Shortlist a sourced role, then create a preparation workspace. Submission remains impossible without explicit approval and direct evidence."
        action={
          <Button
            onClick={onCreate}
            disabled={!campaigns.length || !opportunities.length}
          >
            Start application
          </Button>
        }
      />
    ) : view === "board" ? (
      <ApplicationPipeline
        applications={applications}
        opportunities={opportunities}
      />
    ) : (
      <Card className="p-0">
        <div className="divide-y divide-[var(--ui-border-subtle)]">
          {applications.map((application) => {
            const opportunity = opportunityById.get(application.opportunityId);
            const campaign = campaignById.get(application.primaryCampaignId);
            return (
              <Link
                key={application.id}
                to={`/work/applications/${application.id}`}
                className="grid gap-3 px-4 py-4 transition hover:bg-[var(--ui-surface-hover)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <WorkStatusBadge status={application.status} />
                    <Badge tone="meta">
                      {campaign?.title ?? "Campaign unavailable"}
                    </Badge>
                  </div>
                  <div className="mt-2 truncate font-semibold text-[var(--ui-ink-strong)]">
                    {opportunity?.title ?? "Application"}
                  </div>
                  <div className="mt-1 truncate text-sm text-[var(--ui-ink-soft)]">
                    {opportunity?.employerName || "Employer unknown"} ·{" "}
                    {application.nextAction || "No next action"}
                  </div>
                </div>
                <div className="text-right text-xs text-[var(--ui-ink-faint)]">
                  {application.nextFollowUpAt
                    ? `Follow up ${formatDate(application.nextFollowUpAt)}`
                    : `Updated ${formatDate(application.updatedAt)}`}
                </div>
              </Link>
            );
          })}
        </div>
      </Card>
    );
  return (
    <div className="grid gap-6">
      <SectionHeading
        eyebrow="Applications"
        title="Truthful application pipeline"
        description="Preparation, external transmission, and verified submission are separate states. Forge never marks an application submitted from a prepared package alone."
        actions={
          <>
            <div className="flex rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-1">
              <button
                type="button"
                className={cn(
                  "rounded-[12px] p-2",
                  view === "board" && "bg-[var(--ui-accent-soft)]"
                )}
                aria-label="Board view"
                aria-pressed={view === "board"}
                onClick={() => setView("board")}
              >
                <BriefcaseBusiness className="size-4" />
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-[12px] p-2",
                  view === "list" && "bg-[var(--ui-accent-soft)]"
                )}
                aria-label="List view"
                aria-pressed={view === "list"}
                onClick={() => setView("list")}
              >
                <List className="size-4" />
              </button>
            </div>
            <Button
              onClick={onCreate}
              disabled={
                !mutationEnabled || !campaigns.length || !opportunities.length
              }
            >
              <Plus className="size-4" />
              Application
            </Button>
          </>
        }
      />
      {applicationList}
      <section className="grid gap-3">
        <div>
          <h3 className="font-semibold text-[var(--ui-ink-strong)]">
            Upcoming interviews
          </h3>
          <p className="mt-1 text-sm text-[var(--ui-ink-soft)]">
            Scheduled preparation and follow-up stay connected to the exact
            application.
          </p>
        </div>
        {upcomingInterviews.length ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {upcomingInterviews.map((interview) => {
              const application = applicationById.get(
                String(interview.applicationId)
              );
              const opportunity = application
                ? opportunityById.get(application.opportunityId)
                : undefined;
              return (
                <Link
                  key={interview.id}
                  to={`/work/interviews/${interview.id}`}
                  className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 transition hover:bg-[var(--ui-surface-hover)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <WorkStatusBadge status={interview.status} />
                    <span className="text-xs text-[var(--ui-ink-faint)]">
                      {formatDate(interview.scheduledStartAt)}
                    </span>
                  </div>
                  <div className="mt-3 font-semibold text-[var(--ui-ink-strong)]">
                    {opportunity?.title ??
                      readable(interview.stage, "Interview")}
                  </div>
                  <div className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                    {opportunity?.employerName || "Employer unknown"} ·{" "}
                    {readable(interview.format)}
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="rounded-[18px] border border-dashed border-[var(--ui-border-subtle)] px-4 py-5 text-sm text-[var(--ui-ink-faint)]">
            No upcoming interview is recorded.
          </p>
        )}
      </section>
      <section className="grid gap-3">
        <div>
          <h3 className="font-semibold text-[var(--ui-ink-strong)]">
            Compare offers
          </h3>
          <p className="mt-1 text-sm text-[var(--ui-ink-soft)]">
            Compare exact terms without inventing a winner. Every offer retains
            the campaign criteria version used for its review.
          </p>
        </div>
        {offers.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {offers.map((offer) => {
              const application = applicationById.get(
                String(offer.applicationId)
              );
              const opportunity = application
                ? opportunityById.get(application.opportunityId)
                : undefined;
              const terms = workObject(offer.terms);
              return (
                <Link
                  key={offer.id}
                  to={`/work/offers/${offer.id}`}
                  className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 transition hover:bg-[var(--ui-surface-hover)]"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <WorkStatusBadge status={offer.status} />
                    {offer.expiresAt ? (
                      <Badge tone="meta">
                        Expires {formatDate(offer.expiresAt)}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-3 font-semibold text-[var(--ui-ink-strong)]">
                    {String(terms.title ?? opportunity?.title ?? "Job offer")}
                  </div>
                  <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
                    {opportunity?.employerName || "Employer unknown"} ·{" "}
                    {readable(terms.workModel)}
                  </div>
                  <dl className="mt-4 grid gap-2 text-xs">
                    <div>
                      <dt className="text-[var(--ui-ink-faint)]">
                        Private base
                      </dt>
                      <dd className="mt-0.5 font-medium text-[var(--ui-ink-strong)]">
                        {offerCompensationLabel(offer)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--ui-ink-faint)]">
                        Target start
                      </dt>
                      <dd className="mt-0.5 font-medium text-[var(--ui-ink-strong)]">
                        {formatDate(terms.startDate, "Unknown")}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--ui-ink-faint)]">
                        Criteria basis
                      </dt>
                      <dd className="mt-0.5 truncate font-mono text-[var(--ui-ink-strong)]">
                        {String(offer.criteriaVersionId ?? "Not linked")}
                      </dd>
                    </div>
                  </dl>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="rounded-[18px] border border-dashed border-[var(--ui-border-subtle)] px-4 py-5 text-sm text-[var(--ui-ink-faint)]">
            No offer is recorded yet.
          </p>
        )}
      </section>
    </div>
  );
}
