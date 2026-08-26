import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Archive,
  Network,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Target
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/page-state";
import {
  CampaignCard,
  OpportunityComparison,
  OpportunityInbox,
  WorkSectionNav,
  WorkStatusBadge,
  formatDate,
  readable
} from "@/components/work/work-components";
import {
  OutreachDialog,
  SearchAutomationDialog,
  SearchRunDialog
} from "@/components/work/work-operational-dialogs";
import type { AutomationDialogKind } from "@/components/work/work-operational-dialogs";
import { updateJobOpportunity } from "@/lib/work-api";
import type {
  JobApplication,
  JobOpportunity,
  OpportunityCampaign,
  WorkRecord
} from "@/lib/work-api";
import { SectionHeading, LookingControl } from "./work-page-overview";
import { workObject } from "./work-page-applications";

export type SearchView = "searches" | "roles" | "targets" | "activity";

export function resolveSearchView(value: string | null): SearchView {
  return ["searches", "roles", "targets", "activity"].includes(value ?? "")
    ? (value as SearchView)
    : "searches";
}

function searchRunSummary(run: WorkRecord) {
  const counts = workObject(run.counts);
  const labels: Array<[string, string]> = [
    ["found", "found"],
    ["new", "new"],
    ["changed", "changed"],
    ["duplicate", "duplicates"],
    ["stale", "stale"],
    ["closed", "closed"],
    ["failed", "failed"]
  ];
  return labels
    .filter(([key]) => Number.isFinite(Number(counts[key])))
    .map(([key, label]) => ({ key, label, value: Number(counts[key]) }));
}

function SearchRunHistoryCard({ run }: { run: WorkRecord }) {
  const items = Array.isArray(run.items) ? (run.items as WorkRecord[]) : [];
  const cost = workObject(run.cost);
  const costLabel =
    cost.amount == null
      ? null
      : `${String(cost.amount)} ${String(cost.currency ?? "")} / ${String(cost.billingUnit ?? "run")}`;
  return (
    <div className="rounded-[15px] bg-[var(--ui-surface-2)] p-3">
      <div className="flex justify-between gap-2">
        <WorkStatusBadge status={run.status} />
        <span className="text-xs text-[var(--ui-ink-faint)]">
          {formatDate(run.startedAt)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {searchRunSummary(run).map((count) => (
          <Badge
            key={count.key}
            tone={count.key === "failed" && count.value > 0 ? "signal" : "meta"}
          >
            {count.value} {count.label}
          </Badge>
        ))}
      </div>
      <div className="mt-2 text-xs text-[var(--ui-ink-faint)]">
        {Array.isArray(run.sources) ? run.sources.length : 0} sources ·{" "}
        {Array.isArray(run.queries) ? run.queries.length : 0} queries
        {run.endedAt ? ` · ended ${formatDate(run.endedAt)}` : " · still open"}
        {costLabel ? ` · ${costLabel}` : ""}
      </div>
      {items.length > 0 ? (
        <div className="mt-3 grid gap-1.5">
          {items.slice(0, 3).map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-[12px] border border-[var(--ui-border-subtle)] px-2.5 py-2 text-xs"
            >
              <span className="font-medium text-[var(--ui-ink-medium)]">
                {readable(item.resultKind)}
              </span>
              {item.opportunityId ? (
                <Link
                  className="truncate text-[var(--primary)]"
                  to={`/work/opportunities/${String(item.opportunityId)}`}
                >
                  Open role
                </Link>
              ) : (
                <span className="text-[var(--ui-ink-faint)]">
                  No linked role
                </span>
              )}
            </div>
          ))}
        </div>
      ) : null}
      {Array.isArray(run.failures) && run.failures.length ? (
        <p className="mt-2 text-xs text-[var(--danger)]">
          {run.failures.length} recorded source failure
          {run.failures.length === 1 ? "" : "s"}
        </p>
      ) : null}
      {Number(run.restrictedItemCount ?? 0) > 0 ? (
        <p className="mt-2 text-xs text-[var(--ui-ink-faint)]">
          {Number(run.restrictedItemCount)} result hidden by this credential's
          current scope.
        </p>
      ) : null}
    </div>
  );
}

export type OpportunityFilters = {
  query: string;
  employer: string;
  location: string;
  workModel: string;
  hardGate: string;
  minimumScore: string;
  deadlineBefore: string;
  missingInformation: boolean;
  stale: boolean;
};

export type ApplicationFilters = {
  query: string;
  employer: string;
  campaignId: string;
  status: string;
  deadlineBefore: string;
  hasNextAction: boolean;
};

export const EMPTY_OPPORTUNITY_FILTERS: OpportunityFilters = {
  query: "",
  employer: "",
  location: "",
  workModel: "",
  hardGate: "",
  minimumScore: "",
  deadlineBefore: "",
  missingInformation: false,
  stale: false
};
export const EMPTY_APPLICATION_FILTERS: ApplicationFilters = {
  query: "",
  employer: "",
  campaignId: "",
  status: "",
  deadlineBefore: "",
  hasNextAction: false
};

function OpportunityFilterBar({
  value,
  campaignSelected,
  hasMore,
  onChange
}: {
  value: OpportunityFilters;
  campaignSelected: boolean;
  hasMore: boolean;
  onChange: (value: OpportunityFilters) => void;
}) {
  const set = (patch: Partial<OpportunityFilters>) =>
    onChange({ ...value, ...patch });
  const selectClass =
    "min-h-11 rounded-[14px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm text-[var(--ui-ink-strong)]";
  const active = Object.entries(value).some(
    ([, entry]) =>
      entry === true || (typeof entry === "string" && entry.length > 0)
  );
  return (
    <Card className="grid gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--ui-ink-strong)]">
            Filter roles
          </h3>
          <p className="mt-1 text-xs text-[var(--ui-ink-soft)]">
            Narrow the role list without loading every saved role at once.
          </p>
        </div>
        {active ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange(EMPTY_OPPORTUNITY_FILTERS)}
          >
            Clear filters
          </Button>
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          aria-label="Search roles"
          placeholder="Title, employer, source…"
          value={value.query}
          onChange={(event) => set({ query: event.target.value })}
        />
        <Input
          aria-label="Filter by employer"
          placeholder="Employer"
          value={value.employer}
          onChange={(event) => set({ employer: event.target.value })}
        />
        <Input
          aria-label="Filter by location"
          placeholder="Location"
          value={value.location}
          onChange={(event) => set({ location: event.target.value })}
        />
        <select
          aria-label="Filter by work model"
          value={value.workModel}
          onChange={(event) => set({ workModel: event.target.value })}
          className={selectClass}
        >
          <option value="">Any work model</option>
          {["remote", "hybrid", "on_site", "variable", "unknown"].map(
            (option) => (
              <option key={option} value={option}>
                {readable(option)}
              </option>
            )
          )}
        </select>
        <select
          aria-label="Filter by hard-gate result"
          value={value.hardGate}
          onChange={(event) => set({ hardGate: event.target.value })}
          disabled={!campaignSelected}
          className={selectClass}
        >
          <option value="">Any hard-gate result</option>
          {["pass", "fail", "unknown", "needs_review"].map((option) => (
            <option key={option} value={option}>
              {readable(option)}
            </option>
          ))}
        </select>
        <Input
          aria-label="Minimum job-search score"
          type="number"
          min="0"
          max="100"
          placeholder="Minimum score"
          value={value.minimumScore}
          onChange={(event) => set({ minimumScore: event.target.value })}
          disabled={!campaignSelected}
        />
        <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
          Deadline before
          <Input
            type="date"
            value={value.deadlineBefore}
            onChange={(event) => set({ deadlineBefore: event.target.value })}
          />
        </label>
        <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--ui-ink-medium)]">
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={value.missingInformation}
              onChange={(event) =>
                set({ missingInformation: event.target.checked })
              }
            />
            Missing facts
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={value.stale}
              onChange={(event) => set({ stale: event.target.checked })}
            />
            Stale
          </label>
        </div>
      </div>
      {hasMore ? (
        <p className="text-xs text-[var(--ui-ink-soft)]">
          More than 50 roles match. Narrow the filters to keep daily review
          focused.
        </p>
      ) : null}
    </Card>
  );
}

export function ApplicationFilterBar({
  value,
  campaigns,
  hasMore,
  onChange
}: {
  value: ApplicationFilters;
  campaigns: OpportunityCampaign[];
  hasMore: boolean;
  onChange: (value: ApplicationFilters) => void;
}) {
  const set = (patch: Partial<ApplicationFilters>) =>
    onChange({ ...value, ...patch });
  const selectClass =
    "min-h-11 rounded-[14px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm text-[var(--ui-ink-strong)]";
  const active = Object.entries(value).some(
    ([, entry]) =>
      entry === true || (typeof entry === "string" && entry.length > 0)
  );
  return (
    <Card className="grid gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--ui-ink-strong)]">
            Filter pipeline
          </h3>
          <p className="mt-1 text-xs text-[var(--ui-ink-soft)]">
            Find the applications that need attention without changing their
            evidence-backed stages.
          </p>
        </div>
        {active ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange(EMPTY_APPLICATION_FILTERS)}
          >
            Clear filters
          </Button>
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          aria-label="Search applications"
          placeholder="Role or next action…"
          value={value.query}
          onChange={(event) => set({ query: event.target.value })}
        />
        <Input
          aria-label="Filter applications by employer"
          placeholder="Employer"
          value={value.employer}
          onChange={(event) => set({ employer: event.target.value })}
        />
        <select
          aria-label="Filter applications by job search"
          value={value.campaignId}
          onChange={(event) => set({ campaignId: event.target.value })}
          className={selectClass}
        >
          <option value="">Any job search</option>
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>
              {campaign.title}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter applications by stage"
          value={value.status}
          onChange={(event) => set({ status: event.target.value })}
          className={selectClass}
        >
          <option value="">Any stage</option>
          {[
            "planned",
            "preparing",
            "blocked_on_user_input",
            "ready_for_review",
            "ready_to_submit",
            "submitted",
            "acknowledged",
            "screening",
            "interviewing",
            "assessment",
            "references",
            "offer",
            "accepted",
            "declined_by_candidate",
            "withdrawn",
            "rejected",
            "ghosted",
            "closed"
          ].map((status) => (
            <option key={status} value={status}>
              {readable(status)}
            </option>
          ))}
        </select>
        <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
          Decision or follow-up before
          <Input
            type="date"
            value={value.deadlineBefore}
            onChange={(event) => set({ deadlineBefore: event.target.value })}
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm text-[var(--ui-ink-medium)]">
          <input
            type="checkbox"
            checked={value.hasNextAction}
            onChange={(event) => set({ hasNextAction: event.target.checked })}
          />
          Has a next action
        </label>
      </div>
      {hasMore ? (
        <p className="text-xs text-[var(--ui-ink-soft)]">
          More than 50 applications match. Narrow the filters to focus the
          pipeline.
        </p>
      ) : null}
    </Card>
  );
}

export function SearchTab({
  view,
  looking,
  settingsRevision,
  campaigns,
  opportunities,
  applications,
  organizations,
  outreach,
  profiles,
  documentSets,
  userIds,
  mutationEnabled,
  togglePending,
  filters,
  hasMore,
  selectedCampaignId,
  onSelectCampaign,
  onViewChange,
  onToggle,
  onFiltersChange,
  onCreateCampaign,
  onAddOpportunity,
  onStartApplication,
  onRefresh
}: {
  view: SearchView;
  looking: boolean;
  settingsRevision: number;
  campaigns: OpportunityCampaign[];
  opportunities: JobOpportunity[];
  applications: JobApplication[];
  organizations: WorkRecord[];
  outreach: WorkRecord[];
  profiles: WorkRecord[];
  documentSets: WorkRecord[];
  userIds: string[];
  mutationEnabled: boolean;
  togglePending: boolean;
  filters: OpportunityFilters;
  hasMore: boolean;
  selectedCampaignId: string;
  onSelectCampaign: (id: string) => void;
  onViewChange: (view: SearchView) => void;
  onToggle: (value: boolean) => void;
  onFiltersChange: (value: OpportunityFilters) => void;
  onCreateCampaign: () => void;
  onAddOpportunity: () => void;
  onStartApplication: (id: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());
  const selectedCampaign =
    campaigns.find((campaign) => campaign.id === selectedCampaignId) ??
    campaigns[0];
  const disposition = useMutation({
    mutationFn: ({
      opportunity,
      status
    }: {
      opportunity: JobOpportunity;
      status: "shortlisted" | "rejected_by_user";
    }) =>
      updateJobOpportunity(userIds, opportunity.id, {
        expectedRevision: Number(opportunity.revision),
        disposition: status,
        provenance: {
          sourceKind: "user",
          sourceLabel: "Forge opportunity inbox"
        }
      }),
    onSuccess: onRefresh
  });
  const campaignEvaluations = (selectedCampaign?.latestEvaluations ??
    selectedCampaign?.evaluations ??
    []) as WorkRecord[];
  const visibleOpportunities = selectedCampaign
    ? opportunities.filter(
        (opportunity) =>
          campaignEvaluations.some(
            (evaluation) => evaluation.opportunityId === opportunity.id
          ) ||
          applications.some(
            (application) =>
              application.primaryCampaignId === selectedCampaign.id &&
              application.opportunityId === opportunity.id
          ) ||
          opportunity.disposition === "discovered"
      )
    : opportunities;
  const [automationKind, setAutomationKind] =
    useState<AutomationDialogKind>("searchSource");
  const [automationOpen, setAutomationOpen] = useState(false);
  const [automationRecord, setAutomationRecord] = useState<
    WorkRecord | undefined
  >();
  const [outreachOpen, setOutreachOpen] = useState(false);
  const [outreachRecord, setOutreachRecord] = useState<
    WorkRecord | undefined
  >();
  const [runOpen, setRunOpen] = useState(false);
  const openAutomation = (kind: AutomationDialogKind, record?: WorkRecord) => {
    setAutomationKind(kind);
    setAutomationRecord(record);
    setAutomationOpen(true);
  };
  const campaignOutreach = selectedCampaign
    ? outreach.filter((item) => item.campaignId === selectedCampaign.id)
    : [];
  const organizationName = (id: unknown) =>
    String(
      organizations.find((organization) => organization.id === id)?.name ??
        "Unknown organization"
    );
  return (
    <div className="grid gap-6">
      <SectionHeading
        eyebrow="Job searches"
        title="Run more than one job search clearly"
        description="Keep searches for different goals separate. Each one has its own criteria, roles, targets, saved searches, and history."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={onAddOpportunity}
              disabled={!mutationEnabled}
            >
              <Plus className="size-4" />
              Add role
            </Button>
            <Button onClick={onCreateCampaign} disabled={!mutationEnabled}>
              <Plus className="size-4" />
              Job search
            </Button>
          </>
        }
      />
      <LookingControl
        looking={looking}
        revision={settingsRevision}
        disabled={!mutationEnabled}
        pending={togglePending}
        onChange={onToggle}
      />
      {!looking ? (
        <Card className="flex items-start gap-3">
          <Archive className="mt-0.5 size-5 shrink-0 text-[var(--ui-ink-faint)]" />
          <div>
            <h3 className="font-semibold text-[var(--ui-ink-strong)]">
              Search is not currently foregrounded
            </h3>
            <p className="mt-1 text-sm leading-6 text-[var(--ui-ink-soft)]">
              All past and paused job searches, roles, applications, documents,
              and outcomes below remain available.
            </p>
          </div>
        </Card>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <WorkSectionNav
          label="Job search views"
          active={view}
          onChange={onViewChange}
          options={[
            {
              id: "searches",
              label: "Searches",
              description: "Goals and criteria"
            },
            {
              id: "roles",
              label: "Roles to review",
              description: "New and shortlisted roles"
            },
            {
              id: "targets",
              label: "Targets and outreach",
              description: "People and organizations"
            },
            {
              id: "activity",
              label: "Search activity",
              description: "Sources, saved searches, and runs"
            }
          ]}
        />
        {campaigns.length ? (
          <label className="grid gap-1 text-xs font-medium text-[var(--ui-ink-soft)]">
            Job search
            <select
              value={selectedCampaign?.id ?? ""}
              onChange={(event) => onSelectCampaign(event.target.value)}
              className="min-h-11 w-full rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm text-[var(--ui-ink-strong)] lg:min-w-56"
            >
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {view === "searches" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {campaigns.map((campaign) => (
            <CampaignCard key={campaign.id} campaign={campaign} />
          ))}
          {campaigns.length === 0 ? (
            <EmptyState
              title="No job search yet"
              description="Create one for each distinct goal. A side job and a long-term research role should not share one set of criteria."
              action={
                <Button onClick={onCreateCampaign}>Create job search</Button>
              }
            />
          ) : null}
        </div>
      ) : null}
      {view === "roles" ? (
        <div className="grid gap-4">
          <OpportunityFilterBar
            value={filters}
            campaignSelected={Boolean(selectedCampaign)}
            hasMore={hasMore}
            onChange={onFiltersChange}
          />
          <OpportunityComparison
            opportunities={opportunities.filter((opportunity) =>
              compareIds.has(opportunity.id)
            )}
            onClear={() => setCompareIds(new Set())}
          />
          <OpportunityInbox
            opportunities={visibleOpportunities}
            selectedIds={compareIds}
            onToggleCompare={(id) =>
              setCompareIds((current) => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else if (next.size < 3) next.add(id);
                return next;
              })
            }
            onDisposition={(opportunity, status) =>
              disposition.mutate({ opportunity, status })
            }
            onStartApplication={onStartApplication}
          />
        </div>
      ) : null}
      {view === "targets" ? (
        selectedCampaign ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h3 className="font-semibold text-[var(--ui-ink-strong)]">
                Role targets
              </h3>
              <div className="mt-3 grid gap-2">
                {(selectedCampaign.roleTargets ?? []).map((target) => (
                  <div
                    key={target.id}
                    className="rounded-[16px] bg-[var(--ui-surface-2)] p-3"
                  >
                    <div className="font-medium text-[var(--ui-ink-strong)]">
                      {String(target.titleFamily)}
                    </div>
                    <div className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                      {readable(target.seniority)} · priority{" "}
                      {String(target.priority)}
                    </div>
                  </div>
                ))}
                {!selectedCampaign.roleTargets?.length ? (
                  <Link
                    to={`/work/campaigns/${selectedCampaign.id}?section=targets`}
                    className="text-sm font-medium text-[var(--primary)]"
                  >
                    Add role targets
                  </Link>
                ) : null}
              </div>
              <Link
                to={`/work/campaigns/${selectedCampaign.id}`}
                className="mt-4 inline-flex items-center gap-2 text-sm text-[var(--primary)]"
              >
                Manage role targets <Target className="size-4" />
              </Link>
            </Card>
            <Card>
              <h3 className="font-semibold text-[var(--ui-ink-strong)]">
                Organization targets
              </h3>
              <div className="mt-3 grid gap-2">
                {(selectedCampaign.organizationTargets ?? []).map((target) => (
                  <div
                    key={target.id}
                    className="rounded-[16px] bg-[var(--ui-surface-2)] p-3"
                  >
                    <div className="font-medium text-[var(--ui-ink-strong)]">
                      {organizationName(target.organizationId)}
                    </div>
                    <div className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                      {readable(target.targetTier)} · {readable(target.status)}
                    </div>
                  </div>
                ))}
                {!selectedCampaign.organizationTargets?.length ? (
                  <Link
                    to={`/work/campaigns/${selectedCampaign.id}?section=targets`}
                    className="text-sm font-medium text-[var(--primary)]"
                  >
                    Add organization targets
                  </Link>
                ) : null}
              </div>
            </Card>
            <Card className="lg:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-[var(--ui-ink-strong)]">
                    Outreach and networking
                  </h3>
                  <p className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                    Concrete proposals, factual send times, responses, and
                    follow-ups.
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    setOutreachRecord(undefined);
                    setOutreachOpen(true);
                  }}
                >
                  <Plus className="size-3.5" />
                  Outreach
                </Button>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {campaignOutreach.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setOutreachRecord(item);
                      setOutreachOpen(true);
                    }}
                    className="rounded-[16px] bg-[var(--ui-surface-2)] p-3 text-left"
                  >
                    <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                      {String(item.proposal || "Outreach")}
                    </div>
                    <div className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                      {organizationName(item.organizationId)} ·{" "}
                      {readable(item.status)}
                    </div>
                  </button>
                ))}
                {campaignOutreach.length === 0 ? (
                  <p className="text-sm text-[var(--ui-ink-faint)]">
                    No outreach for this job search.
                  </p>
                ) : null}
              </div>
            </Card>
          </div>
        ) : (
          <EmptyState
            title="Choose a job search"
            description="Targets and outreach belong to one focused job search."
          />
        )
      ) : null}
      {view === "activity" ? (
        selectedCampaign ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Network className="size-4 text-[var(--primary)]" />
                  <h3 className="font-semibold text-[var(--ui-ink-strong)]">
                    Search sources
                  </h3>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openAutomation("searchSource")}
                >
                  <Plus className="size-3.5" />
                  Add
                </Button>
              </div>
              <div className="mt-3 grid gap-2">
                {(selectedCampaign.searchSources ?? []).map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => openAutomation("searchSource", source)}
                    className="rounded-[15px] bg-[var(--ui-surface-2)] p-3 text-left"
                  >
                    <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                      {String(source.name)}
                    </div>
                    <div className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                      {readable(source.sourceType)} ·{" "}
                      {source.enabled ? "enabled" : "paused"}
                    </div>
                  </button>
                ))}
                {!selectedCampaign.searchSources?.length ? (
                  <p className="text-sm text-[var(--ui-ink-faint)]">
                    No search source has been added.
                  </p>
                ) : null}
              </div>
            </Card>
            <Card>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Settings2 className="size-4 text-[var(--primary)]" />
                  <h3 className="font-semibold text-[var(--ui-ink-strong)]">
                    Agent permissions
                  </h3>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    openAutomation(
                      "automationPolicy",
                      selectedCampaign.automationPolicies?.[0]
                    )
                  }
                >
                  {selectedCampaign.automationPolicies?.length ? "Edit" : "Add"}
                </Button>
              </div>
              {selectedCampaign.automationPolicies?.length ? (
                selectedCampaign.automationPolicies.map((policy) => (
                  <dl key={policy.id} className="mt-3 grid gap-2 text-sm">
                    {[
                      ["researchAuthority", "Find roles"],
                      ["preparationAuthority", "Prepare materials"],
                      ["uploadAuthority", "Upload files"],
                      ["submissionAuthority", "Send applications"],
                      ["duplicatePrevention", "Prevent duplicates"],
                      ["maximumApplications", "Application limit"]
                    ].map(([key, label]) => (
                      <div key={key} className="flex justify-between gap-3">
                        <dt className="text-[var(--ui-ink-soft)]">{label}</dt>
                        <dd className="text-right font-medium text-[var(--ui-ink-strong)]">
                          {readable(policy[key])}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ))
              ) : (
                <p className="mt-3 text-sm text-[var(--ui-ink-faint)]">
                  No custom permissions have been set. Sending an application
                  still requires your approval.
                </p>
              )}
            </Card>
            <Card>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Search className="size-4 text-[var(--primary)]" />
                  <h3 className="font-semibold text-[var(--ui-ink-strong)]">
                    Saved queries
                  </h3>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openAutomation("savedQuery")}
                >
                  <Plus className="size-3.5" />
                  Add
                </Button>
              </div>
              <div className="mt-3 grid gap-2">
                {selectedCampaign.savedQueries?.map((query) => (
                  <button
                    key={query.id}
                    type="button"
                    onClick={() => openAutomation("savedQuery", query)}
                    className="rounded-[15px] bg-[var(--ui-surface-2)] p-3 text-left"
                  >
                    <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                      {String(query.title)}
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs text-[var(--ui-ink-soft)]">
                      {String(query.queryText)}
                    </div>
                  </button>
                ))}
                {!selectedCampaign.savedQueries?.length ? (
                  <p className="text-sm text-[var(--ui-ink-faint)]">
                    No saved query.
                  </p>
                ) : null}
              </div>
            </Card>
            <Card>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <RefreshCw className="size-4 text-[var(--primary)]" />
                  <h3 className="font-semibold text-[var(--ui-ink-strong)]">
                    Search runs
                  </h3>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRunOpen(true)}
                >
                  <Plus className="size-3.5" />
                  Record
                </Button>
              </div>
              <div className="mt-3 grid gap-2">
                {selectedCampaign.recentSearchRuns?.map((run) => (
                  <SearchRunHistoryCard key={run.id} run={run} />
                ))}
                {!selectedCampaign.recentSearchRuns?.length ? (
                  <p className="text-sm text-[var(--ui-ink-faint)]">
                    No search activity has been recorded.
                  </p>
                ) : null}
              </div>
            </Card>
          </div>
        ) : (
          <EmptyState
            title="Choose a job search"
            description="Sources, saved searches, permissions, and run history belong to one job search."
          />
        )
      ) : null}
      {selectedCampaign ? (
        <SearchAutomationDialog
          open={automationOpen}
          onOpenChange={setAutomationOpen}
          kind={automationKind}
          userIds={userIds}
          campaign={selectedCampaign}
          record={automationRecord}
          sources={selectedCampaign.searchSources ?? []}
          profiles={profiles}
          documentSets={documentSets}
          onSaved={onRefresh}
        />
      ) : null}
      {selectedCampaign ? (
        <SearchRunDialog
          open={runOpen}
          onOpenChange={setRunOpen}
          userIds={userIds}
          campaign={selectedCampaign}
          onSaved={onRefresh}
        />
      ) : null}
      <OutreachDialog
        open={outreachOpen}
        onOpenChange={setOutreachOpen}
        userIds={userIds}
        campaigns={campaigns}
        organizations={organizations}
        outreach={outreachRecord}
        initialCampaignId={selectedCampaign?.id}
        onSaved={onRefresh}
      />
    </div>
  );
}
