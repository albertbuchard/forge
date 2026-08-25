import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Plus, Sparkles, ToggleLeft, ToggleRight } from "lucide-react";
import { useForgeShell } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-state";
import {
  CampaignCard,
  EngagementCard,
  NextActions,
  StatStrip,
  WORK_TABS,
  WorkStatusBadge
} from "@/components/work/work-components";
import type { WorkTabId } from "@/components/work/work-components";
import type { WorkDetailKind } from "@/components/work/work-detail";
import type {
  JobApplication,
  JobOpportunity,
  OpportunityCampaign,
  WorkEngagement,
  WorkRecord
} from "@/lib/work-api";
import { cn } from "@/lib/utils";

export function resolveTab(value: string | null): WorkTabId {
  return WORK_TABS.some((tab) => tab.id === value)
    ? (value as WorkTabId)
    : "overview";
}

export function parseDetail(pathname: string) {
  const match = pathname.match(
    /^\/work\/(engagements|organizations|campaigns|opportunities|applications|interviews|offers|outreach)\/([^/]+)$/u
  );
  return match
    ? { kind: match[1] as WorkDetailKind, id: decodeURIComponent(match[2]) }
    : null;
}

export function uniqueById<T extends { id: string }>(...collections: T[][]) {
  const map = new Map<string, T>();
  for (const collection of collections)
    for (const item of collection)
      map.set(item.id, { ...map.get(item.id), ...item });
  return [...map.values()];
}

export function selectedOwners(shell: ReturnType<typeof useForgeShell>) {
  if (shell.selectedUserIds.length > 0) return shell.selectedUserIds;
  const human = shell.snapshot.users.find((user) => user.kind === "human");
  return human ? [human.id] : [];
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  actions
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--secondary)]">
            {eyebrow}
          </div>
        ) : null}
        <h2 className="mt-1 text-xl font-semibold text-[var(--ui-ink-strong)]">
          {title}
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--ui-ink-soft)]">
          {description}
        </p>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export function LookingControl({
  looking,
  revision,
  disabled,
  pending,
  onChange
}: {
  looking: boolean;
  revision: number;
  disabled: boolean;
  pending: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={looking}
      disabled={disabled || pending}
      onClick={() => onChange(!looking)}
      className={cn(
        "flex min-h-12 w-full items-center justify-between gap-4 rounded-[22px] border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_45%,transparent)] disabled:opacity-60",
        looking
          ? "border-[color-mix(in_srgb,var(--primary)_30%,var(--ui-border-subtle))] bg-[var(--ui-accent-soft)]"
          : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] hover:bg-[var(--ui-surface-hover)]"
      )}
      data-revision={revision}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[var(--ui-ink-strong)]">
          Looking for opportunities
        </span>
        <span className="mt-0.5 block text-xs leading-5 text-[var(--ui-ink-soft)]">
          {looking
            ? "Job searches and applications are foregrounded. Each search keeps its own criteria and history."
            : "Search history remains available. Turn this on when you want to create or resume a campaign."}
        </span>
      </span>
      {looking ? (
        <ToggleRight
          className="size-8 shrink-0 text-[var(--primary)]"
          aria-hidden="true"
        />
      ) : (
        <ToggleLeft
          className="size-8 shrink-0 text-[var(--ui-ink-faint)]"
          aria-hidden="true"
        />
      )}
    </button>
  );
}

export function OverviewTab({
  engagements,
  organizations,
  campaigns,
  applications,
  opportunities,
  looking,
  settingsRevision,
  mutationEnabled,
  togglePending,
  onToggle,
  onAddEngagement,
  onCreateCampaign,
  onCheckIn
}: {
  engagements: WorkEngagement[];
  organizations: WorkRecord[];
  campaigns: OpportunityCampaign[];
  applications: JobApplication[];
  opportunities: JobOpportunity[];
  looking: boolean;
  settingsRevision: number;
  mutationEnabled: boolean;
  togglePending: boolean;
  onToggle: (value: boolean) => void;
  onAddEngagement: () => void;
  onCreateCampaign: () => void;
  onCheckIn: (id?: string) => void;
}) {
  const current = engagements.filter((engagement) =>
    ["current", "transitioning", "on_leave"].includes(engagement.status)
  );
  const activeCampaigns = campaigns.filter(
    (campaign) => campaign.status === "active"
  );
  const openApplications = applications.filter(
    (application) =>
      ![
        "accepted",
        "declined_by_candidate",
        "withdrawn",
        "rejected",
        "closed"
      ].includes(application.status)
  );
  return (
    <div className="grid gap-7">
      <StatStrip
        items={[
          {
            label: "Current roles",
            value: current.length,
            detail: engagements.some((item) => item.status === "planned")
              ? `${engagements.filter((item) => item.status === "planned").length} planned`
              : "No planned roles"
          },
          {
            label: "Active searches",
            value: activeCampaigns.length,
            detail: looking ? "Opportunity mode on" : "Opportunity mode off"
          },
          {
            label: "Open applications",
            value: openApplications.length,
            detail: applications.some((item) => item.nextFollowUpAt)
              ? "Follow-ups are tracked"
              : "No follow-up dates"
          },
          {
            label: "Roles to review",
            value: opportunities.filter((item) =>
              ["discovered", "reviewing"].includes(String(item.disposition))
            ).length,
            detail: "Discovery inbox"
          }
        ]}
      />
      <section className="grid gap-4">
        <SectionHeading
          eyebrow="Current work"
          title="What work are you doing now?"
          description="Several employment, appointment, contract, freelance, fractional, shift, or advisory arrangements can overlap."
          actions={
            <>
              <Button
                variant="secondary"
                onClick={() => onCheckIn()}
                disabled={!current.length}
              >
                <Sparkles className="size-4" />
                Check in
              </Button>
              <Button onClick={onAddEngagement} disabled={!mutationEnabled}>
                <Plus className="size-4" />
                Add work
              </Button>
            </>
          }
        />
        {current.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {current.map((engagement) => (
              <EngagementCard
                key={engagement.id}
                engagement={engagement}
                organizations={organizations}
                onCheckIn={(id) => onCheckIn(id)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            eyebrow="Current work"
            title="No current job or engagement recorded"
            description="Forge still keeps Work available. Add a current role, a planned role, self-employment, a contract, or a side job when it applies."
            action={
              <Button onClick={onAddEngagement} disabled={!mutationEnabled}>
                Add current work
              </Button>
            }
          />
        )}
      </section>
      <section className="grid gap-4">
        <SectionHeading
          eyebrow="Opportunity state"
          title="Current work and future options, together"
          description="Turning opportunity mode off never deletes or rewrites previous searches, roles, applications, or outcomes."
        />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <Card>
            <LookingControl
              looking={looking}
              revision={settingsRevision}
              disabled={!mutationEnabled}
              pending={togglePending}
              onChange={onToggle}
            />
            {looking ? (
              <Button
                className="mt-4 w-full"
                onClick={onCreateCampaign}
                disabled={!mutationEnabled}
              >
                <Plus className="size-4" />
                Create another campaign
              </Button>
            ) : null}
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            {(looking ? activeCampaigns : campaigns.slice(0, 2)).map(
              (campaign) => (
                <CampaignCard key={campaign.id} campaign={campaign} />
              )
            )}
            {campaigns.length === 0 ? (
              <Card>
                <h3 className="font-semibold text-[var(--ui-ink-strong)]">
                  No search campaigns yet
                </h3>
                <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                  When you decide to look, create distinct campaigns for
                  intentions with materially different constraints.
                </p>
              </Card>
            ) : null}
          </div>
        </div>
      </section>
      <NextActions
        engagements={engagements}
        campaigns={campaigns}
        applications={applications}
        opportunities={opportunities}
      />
    </div>
  );
}

export function CurrentWorkTab({
  engagements,
  organizations,
  mutationEnabled,
  onAddEngagement,
  onAddOrganization,
  onCheckIn
}: {
  engagements: WorkEngagement[];
  organizations: WorkRecord[];
  mutationEnabled: boolean;
  onAddEngagement: () => void;
  onAddOrganization: () => void;
  onCheckIn: (id: string) => void;
}) {
  const groups = [
    {
      id: "current",
      title: "Current and transitioning",
      statuses: ["current", "transitioning", "on_leave"]
    },
    { id: "planned", title: "Planned", statuses: ["planned"] },
    { id: "past", title: "Past", statuses: ["ended", "archived"] },
    { id: "archived", title: "Archived and restorable", statuses: [] }
  ];
  return (
    <div className="grid gap-7">
      <SectionHeading
        eyebrow="Current work"
        title="All work arrangements"
        description="Dates, workload, notice periods, objectives, people, documents, and long-term direction remain attached to each engagement."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={onAddOrganization}
              disabled={!mutationEnabled}
            >
              <Plus className="size-4" />
              Organization
            </Button>
            <Button onClick={onAddEngagement} disabled={!mutationEnabled}>
              <Plus className="size-4" />
              Work engagement
            </Button>
          </>
        }
      />
      {groups.map((group) => {
        const items = engagements.filter((engagement) =>
          group.id === "archived"
            ? Boolean(engagement.deletedAt)
            : !engagement.deletedAt &&
              group.statuses.includes(engagement.status)
        );
        return (
          <section key={group.id} className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--ui-ink-soft)]">
                {group.title}
              </h3>
              <Badge tone="meta">{items.length}</Badge>
            </div>
            {items.length ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {items.map((engagement) => (
                  <EngagementCard
                    key={engagement.id}
                    engagement={engagement}
                    organizations={organizations}
                    onCheckIn={group.id === "current" ? onCheckIn : undefined}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-[20px] border border-dashed border-[var(--ui-border-subtle)] px-4 py-6 text-sm text-[var(--ui-ink-faint)]">
                No {group.title.toLowerCase()} work arrangements.
              </div>
            )}
          </section>
        );
      })}
      <section className="grid gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--ui-ink-soft)]">
          Organizations
        </h3>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {organizations.map((organization) => (
            <Link
              key={organization.id}
              to={`/work/organizations/${organization.id}`}
              className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-[var(--ui-ink-strong)]">
                    {String(organization.name ?? "Organization")}
                  </div>
                  <div className="mt-1 truncate text-xs text-[var(--ui-ink-soft)]">
                    {String(organization.domain ?? organization.status ?? "")}
                  </div>
                </div>
                <WorkStatusBadge status={organization.status} />
              </div>
            </Link>
          ))}
          {organizations.length === 0 ? (
            <p className="text-sm text-[var(--ui-ink-faint)]">
              No employer, client, or target organization records yet.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
