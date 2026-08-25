import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, ListChecks, Pause, Play, Plus, Save } from "lucide-react";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  EvidenceList,
  WorkStatusBadge,
  formatDate,
  readable
} from "@/components/work/work-components";
import { CampaignCriteriaDialog } from "@/components/work/work-dialogs";
import {
  OrganizationTargetDialog,
  RoleTargetDialog
} from "@/components/work/work-operational-dialogs";
import { updateOpportunityCampaign } from "@/lib/work-api";
import type {
  JobApplication,
  JobOpportunity,
  OpportunityCampaign,
  WorkRecord
} from "@/lib/work-api";
import {
  RelationshipEditor,
  EventTimeline,
  FactsGrid
} from "./work-detail-shared";

type CampaignEditDraft = {
  title: string;
  purpose: string;
  description: string;
  status: OpportunityCampaign["status"];
  priority: string;
  searchIntent: string;
  activeFrom: string;
  activeUntil: string;
  targetStartDate: string;
  searchDeadline: string;
  urgency: string;
  reviewCadence: string;
  timezone: string;
  completionCriteria: string;
  primaryGoalId: string;
  longTermDestination: string;
  intermediateRoles: string;
  capabilitiesToAcquire: string;
  steppingStoneAssessment: string;
  currentStage: string;
  health: string;
  nextAction: string;
  blockers: string;
};

function campaignEditDraft(campaign: OpportunityCampaign): CampaignEditDraft {
  return {
    title: campaign.title,
    purpose: campaign.purpose ?? "",
    description: campaign.description ?? "",
    status: campaign.status,
    priority: String(campaign.priority ?? "normal"),
    searchIntent: String(campaign.searchIntent ?? "full_time_employment"),
    activeFrom: campaign.activeFrom ?? "",
    activeUntil: campaign.activeUntil ?? "",
    targetStartDate: campaign.targetStartDate ?? "",
    searchDeadline: campaign.searchDeadline ?? "",
    urgency: String(campaign.urgency ?? "normal"),
    reviewCadence: campaign.reviewCadence ?? "weekly",
    timezone:
      campaign.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    completionCriteria: (campaign.completionCriteria ?? []).join("\n"),
    primaryGoalId: campaign.primaryGoalId ?? "",
    longTermDestination: campaign.longTermDestination ?? "",
    intermediateRoles: (campaign.intermediateRoles ?? []).join("\n"),
    capabilitiesToAcquire: (campaign.capabilitiesToAcquire ?? []).join("\n"),
    steppingStoneAssessment: campaign.steppingStoneAssessment ?? "unknown",
    currentStage: campaign.currentStage ?? "",
    health: String(campaign.health ?? "unknown"),
    nextAction: campaign.nextAction ?? "",
    blockers: (campaign.blockers ?? []).join("\n")
  };
}

export function CampaignDetail({
  campaign,
  organizations,
  opportunities,
  applications,
  userIds,
  onRefresh
}: {
  campaign: OpportunityCampaign;
  organizations: WorkRecord[];
  opportunities: JobOpportunity[];
  applications: JobApplication[];
  userIds: string[];
  onRefresh: () => Promise<void>;
}) {
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [roleTarget, setRoleTarget] = useState<WorkRecord | undefined>();
  const [organizationOpen, setOrganizationOpen] = useState(false);
  const [organizationTarget, setOrganizationTarget] = useState<
    WorkRecord | undefined
  >();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => campaignEditDraft(campaign));
  useEffect(() => {
    setDraft(campaignEditDraft(campaign));
  }, [campaign]);
  const setCampaignDraft = (patch: Partial<CampaignEditDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const splitLines = (value: string) =>
    value
      .split(/\r?\n/gu)
      .map((entry) => entry.trim())
      .filter(Boolean);
  const statusMutation = useMutation({
    mutationFn: (status: OpportunityCampaign["status"]) =>
      updateOpportunityCampaign(userIds, campaign.id, {
        expectedRevision: Number(campaign.revision),
        status,
        provenance: { sourceKind: "user", sourceLabel: "Forge Work campaign" }
      }),
    onSuccess: onRefresh
  });
  const editMutation = useMutation({
    mutationFn: () =>
      updateOpportunityCampaign(userIds, campaign.id, {
        expectedRevision: Number(campaign.revision),
        title: draft.title,
        purpose: draft.purpose,
        description: draft.description,
        status: draft.status,
        priority: draft.priority,
        searchIntent: draft.searchIntent,
        activeFrom: draft.activeFrom || null,
        activeUntil: draft.activeUntil || null,
        targetStartDate: draft.targetStartDate || null,
        searchDeadline: draft.searchDeadline || null,
        urgency: draft.urgency,
        reviewCadence: draft.reviewCadence,
        timezone: draft.timezone,
        completionCriteria: splitLines(draft.completionCriteria),
        primaryGoalId: draft.primaryGoalId || null,
        longTermDestination: draft.longTermDestination,
        intermediateRoles: splitLines(draft.intermediateRoles),
        capabilitiesToAcquire: splitLines(draft.capabilitiesToAcquire),
        steppingStoneAssessment: draft.steppingStoneAssessment,
        currentStage: draft.currentStage,
        health: draft.health,
        nextAction: draft.nextAction,
        blockers: splitLines(draft.blockers),
        provenance: {
          sourceKind: "user",
          sourceLabel: "Forge Work campaign editor"
        }
      }),
    onSuccess: async () => {
      setEditing(false);
      await onRefresh();
    }
  });
  const criteriaVersions =
    (campaign.criteriaVersions as WorkRecord[] | undefined) ?? [];
  const currentCriteria = criteriaVersions[0];
  const criteria =
    currentCriteria &&
    currentCriteria.criteria &&
    typeof currentCriteria.criteria === "object"
      ? ((currentCriteria.criteria as Record<string, unknown>).criteria as
          | WorkRecord[]
          | undefined)
      : [];
  const campaignOpportunities = opportunities.filter(
    (opportunity) =>
      (campaign.evaluations as WorkRecord[] | undefined)?.some(
        (evaluation) => evaluation.opportunityId === opportunity.id
      ) ||
      applications.some(
        (application) =>
          application.primaryCampaignId === campaign.id &&
          application.opportunityId === opportunity.id
      )
  );
  return (
    <div className="grid gap-5">
      <PageHero
        entityKind="opportunity_campaign"
        title={campaign.title}
        description={
          campaign.purpose ||
          campaign.description ||
          "A bounded, goal-linked strategy for finding paid work."
        }
        badge={
          <div className="flex gap-2">
            <WorkStatusBadge status={campaign.status} />
            <WorkStatusBadge status={campaign.health} />
          </div>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => setEditing((current) => !current)}
            >
              {editing ? "Cancel edit" : "Edit campaign"}
            </Button>
            <Button variant="secondary" onClick={() => setCriteriaOpen(true)}>
              <ListChecks className="size-4" />
              New criteria version
            </Button>
            {campaign.status === "active" ? (
              <Button
                onClick={() => statusMutation.mutate("paused")}
                pending={statusMutation.isPending}
              >
                <Pause className="size-4" />
                Pause
              </Button>
            ) : ["draft", "planned", "paused"].includes(campaign.status) ? (
              <Button
                onClick={() => statusMutation.mutate("active")}
                pending={statusMutation.isPending}
              >
                <Play className="size-4" />
                Activate
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="grid gap-5 px-4 sm:px-6">
        <Link
          to="/work?tab=searches"
          className="inline-flex items-center gap-2 text-sm text-[var(--primary)]"
        >
          <ArrowLeft className="size-4" />
          Back to Job searches
        </Link>
        {editing ? (
          <Card className="grid gap-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Title
                <Input
                  value={draft.title}
                  onChange={(event) =>
                    setCampaignDraft({ title: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Lifecycle status
                <select
                  value={draft.status}
                  onChange={(event) =>
                    setCampaignDraft({
                      status: event.target
                        .value as OpportunityCampaign["status"]
                    })
                  }
                  className="min-h-10 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm"
                >
                  {[
                    "draft",
                    "planned",
                    "active",
                    "paused",
                    "completed",
                    "abandoned",
                    "archived"
                  ].map((value) => (
                    <option key={value} value={value}>
                      {readable(value)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Search intent
                <select
                  value={draft.searchIntent}
                  onChange={(event) =>
                    setCampaignDraft({ searchIntent: event.target.value })
                  }
                  className="min-h-10 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm"
                >
                  {[
                    "full_time_employment",
                    "part_time_employment",
                    "contract",
                    "freelance",
                    "fractional",
                    "internship",
                    "shift_work",
                    "seasonal",
                    "board_advisory",
                    "other"
                  ].map((value) => (
                    <option key={value}>{readable(value)}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)] md:col-span-2">
                Purpose
                <Textarea
                  rows={3}
                  value={draft.purpose}
                  onChange={(event) =>
                    setCampaignDraft({ purpose: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)] md:col-span-2">
                Description
                <Textarea
                  rows={4}
                  value={draft.description}
                  onChange={(event) =>
                    setCampaignDraft({ description: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Priority
                <select
                  value={draft.priority}
                  onChange={(event) =>
                    setCampaignDraft({ priority: event.target.value })
                  }
                  className="min-h-10 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm"
                >
                  {["low", "normal", "high", "critical"].map((value) => (
                    <option key={value}>{readable(value)}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Health
                <select
                  value={draft.health}
                  onChange={(event) =>
                    setCampaignDraft({ health: event.target.value })
                  }
                  className="min-h-10 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm"
                >
                  {["unknown", "healthy", "attention", "blocked"].map(
                    (value) => (
                      <option key={value}>{readable(value)}</option>
                    )
                  )}
                </select>
              </label>
              {(
                [
                  ["activeFrom", "Active from"],
                  ["activeUntil", "Active until"],
                  ["targetStartDate", "Target start"],
                  ["searchDeadline", "Search deadline"]
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="grid gap-1 text-xs text-[var(--ui-ink-soft)]"
                >
                  {label}
                  <Input
                    type="date"
                    value={draft[key]}
                    onChange={(event) =>
                      setCampaignDraft({ [key]: event.target.value })
                    }
                  />
                </label>
              ))}
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Urgency
                <select
                  value={draft.urgency}
                  onChange={(event) =>
                    setCampaignDraft({ urgency: event.target.value })
                  }
                  className="min-h-10 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm"
                >
                  {["low", "normal", "high", "urgent"].map((value) => (
                    <option key={value}>{readable(value)}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Review cadence
                <Input
                  value={draft.reviewCadence}
                  onChange={(event) =>
                    setCampaignDraft({ reviewCadence: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Timezone
                <Input
                  value={draft.timezone}
                  onChange={(event) =>
                    setCampaignDraft({ timezone: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Current stage
                <Input
                  value={draft.currentStage}
                  onChange={(event) =>
                    setCampaignDraft({ currentStage: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)] md:col-span-2">
                Completion criteria, one per line
                <Textarea
                  rows={3}
                  value={draft.completionCriteria}
                  onChange={(event) =>
                    setCampaignDraft({ completionCriteria: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)] md:col-span-2">
                Long-term destination
                <Textarea
                  rows={3}
                  value={draft.longTermDestination}
                  onChange={(event) =>
                    setCampaignDraft({
                      longTermDestination: event.target.value
                    })
                  }
                />
              </label>
              {(
                [
                  ["intermediateRoles", "Intermediate roles"],
                  ["capabilitiesToAcquire", "Capabilities to acquire"],
                  ["blockers", "Blockers"]
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="grid gap-1 text-xs text-[var(--ui-ink-soft)]"
                >
                  {label}, one per line
                  <Textarea
                    rows={4}
                    value={draft[key]}
                    onChange={(event) =>
                      setCampaignDraft({ [key]: event.target.value })
                    }
                  />
                </label>
              ))}
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Stepping-stone assessment
                <select
                  value={draft.steppingStoneAssessment}
                  onChange={(event) =>
                    setCampaignDraft({
                      steppingStoneAssessment: event.target.value
                    })
                  }
                  className="min-h-10 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm"
                >
                  {[
                    "unknown",
                    "stepping_stone",
                    "neutral",
                    "dead_end_risk"
                  ].map((value) => (
                    <option key={value}>{readable(value)}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)] md:col-span-2">
                Next action
                <Textarea
                  rows={3}
                  value={draft.nextAction}
                  onChange={(event) =>
                    setCampaignDraft({ nextAction: event.target.value })
                  }
                />
              </label>
            </div>
            <div>
              <Button
                disabled={!draft.title.trim()}
                pending={editMutation.isPending}
                onClick={() => editMutation.mutate()}
              >
                <Save className="size-4" />
                Save campaign facts
              </Button>
              {editMutation.error ? (
                <p className="mt-2 text-sm text-[var(--danger)]">
                  {editMutation.error.message}
                </p>
              ) : null}
            </div>
          </Card>
        ) : null}
        <FactsGrid
          facts={[
            { label: "Search intent", value: campaign.searchIntent },
            { label: "Current stage", value: campaign.currentStage },
            { label: "Urgency", value: campaign.urgency },
            { label: "Active from", value: formatDate(campaign.activeFrom) },
            {
              label: "Search deadline",
              value: formatDate(campaign.searchDeadline)
            },
            {
              label: "Target start",
              value: formatDate(campaign.targetStartDate)
            },
            { label: "Review cadence", value: campaign.reviewCadence },
            {
              label: "Criteria version",
              value: currentCriteria?.version ?? "None"
            },
            {
              label: "Stepping-stone assessment",
              value: campaign.steppingStoneAssessment
            }
          ]}
        />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.7fr)]">
          <div className="grid gap-5">
            <Card>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-[var(--ui-ink-strong)]">
                    Current criteria matrix
                  </h2>
                  <p className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                    Every evaluation cites an immutable criteria version.
                  </p>
                </div>
                <Badge tone="meta">
                  v{String(currentCriteria?.version ?? "—")}
                </Badge>
              </div>
              {criteria?.length ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[38rem] text-left text-sm">
                    <thead>
                      <tr className="text-xs text-[var(--ui-ink-faint)]">
                        <th className="pb-2">Criterion</th>
                        <th className="pb-2">Gate</th>
                        <th className="pb-2">Rule</th>
                        <th className="pb-2">Weight</th>
                      </tr>
                    </thead>
                    <tbody>
                      {criteria.map((criterion) => (
                        <tr
                          key={String(criterion.key)}
                          className="border-t border-[var(--ui-border-subtle)]"
                        >
                          <td className="py-3 font-medium text-[var(--ui-ink-strong)]">
                            {readable(criterion.field ?? criterion.key)}
                          </td>
                          <td className="py-3">
                            <Badge
                              tone={
                                criterion.importance === "hard"
                                  ? "signal"
                                  : "meta"
                              }
                            >
                              {String(criterion.importance)}
                            </Badge>
                          </td>
                          <td className="py-3 text-[var(--ui-ink-soft)]">
                            {readable(criterion.operator)}{" "}
                            {typeof criterion.value === "object"
                              ? JSON.stringify(criterion.value)
                              : String(criterion.value ?? "")}
                          </td>
                          <td className="py-3 tabular-nums text-[var(--ui-ink-soft)]">
                            {String(criterion.weight ?? 50)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-4 text-sm text-[var(--ui-ink-soft)]">
                  No structured criteria are stored. Create the first version
                  before evaluating roles.
                </p>
              )}
            </Card>
            <Card>
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold text-[var(--ui-ink-strong)]">
                  Role targets
                </h2>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setRoleTarget(undefined);
                    setRoleOpen(true);
                  }}
                >
                  <Plus className="size-3.5" />
                  Role target
                </Button>
              </div>
              <div className="mt-3 grid gap-2">
                {((campaign.roleTargets as WorkRecord[] | undefined) ?? []).map(
                  (target) => (
                    <button
                      key={target.id}
                      type="button"
                      onClick={() => {
                        setRoleTarget(target);
                        setRoleOpen(true);
                      }}
                      className="rounded-[16px] bg-[var(--ui-surface-2)] p-3 text-left"
                    >
                      <div className="font-medium text-[var(--ui-ink-strong)]">
                        {String(target.titleFamily)}
                      </div>
                      <div className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                        {readable(target.seniority)} · priority{" "}
                        {String(target.priority)} ·{" "}
                        {Array.isArray(target.knownGaps)
                          ? target.knownGaps.length
                          : 0}{" "}
                        known gaps
                      </div>
                    </button>
                  )
                )}
                {!campaign.roleTargets?.length ? (
                  <p className="text-sm text-[var(--ui-ink-faint)]">
                    No role targets yet.
                  </p>
                ) : null}
              </div>
            </Card>
            <Card>
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold text-[var(--ui-ink-strong)]">
                  Organization targets
                </h2>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setOrganizationTarget(undefined);
                    setOrganizationOpen(true);
                  }}
                >
                  <Plus className="size-3.5" />
                  Organization
                </Button>
              </div>
              <div className="mt-3 grid gap-2">
                {(
                  (campaign.organizationTargets as WorkRecord[] | undefined) ??
                  []
                ).map((target) => (
                  <button
                    key={target.id}
                    type="button"
                    onClick={() => {
                      setOrganizationTarget(target);
                      setOrganizationOpen(true);
                    }}
                    className="rounded-[16px] bg-[var(--ui-surface-2)] p-3 text-left"
                  >
                    <div className="font-medium text-[var(--ui-ink-strong)]">
                      {String(
                        organizations.find(
                          (organization) =>
                            organization.id === target.organizationId
                        )?.name ?? target.organizationId
                      )}
                    </div>
                    <div className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                      {readable(target.targetTier)} · {readable(target.status)}{" "}
                      · {String(target.nextAction ?? "No next action")}
                    </div>
                  </button>
                ))}
                {!campaign.organizationTargets?.length ? (
                  <p className="text-sm text-[var(--ui-ink-faint)]">
                    No organization targets yet.
                  </p>
                ) : null}
              </div>
            </Card>
            <Card>
              <h2 className="font-semibold text-[var(--ui-ink-strong)]">
                Campaign opportunities
              </h2>
              <div className="mt-3 divide-y divide-[var(--ui-border-subtle)]">
                {campaignOpportunities.map((opportunity) => (
                  <Link
                    key={opportunity.id}
                    to={`/work/opportunities/${opportunity.id}`}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <span>
                      <span className="block text-sm font-medium text-[var(--ui-ink-strong)]">
                        {opportunity.title}
                      </span>
                      <span className="block text-xs text-[var(--ui-ink-soft)]">
                        {opportunity.employerName || "Employer unknown"}
                      </span>
                    </span>
                    <WorkStatusBadge status={opportunity.disposition} />
                  </Link>
                ))}
                {campaignOpportunities.length === 0 ? (
                  <p className="py-4 text-sm text-[var(--ui-ink-soft)]">
                    No evaluated or applied opportunities yet.
                  </p>
                ) : null}
              </div>
            </Card>
            <EventTimeline
              events={campaign.history}
              empty="No campaign history has been recorded."
            />
          </div>
          <div className="grid content-start gap-5">
            <Card>
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                Next action
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-strong)]">
                {campaign.nextAction || "No next action recorded."}
              </p>
              {campaign.blockers?.length ? (
                <div className="mt-4">
                  <EvidenceList
                    title="Blockers"
                    items={campaign.blockers}
                    tone="warning"
                  />
                </div>
              ) : null}
            </Card>
            <Card>
              <EvidenceList
                title="Long-term destination"
                items={
                  campaign.longTermDestination
                    ? [campaign.longTermDestination]
                    : []
                }
              />
              <div className="mt-4">
                <EvidenceList
                  title="Intermediate roles"
                  items={campaign.intermediateRoles}
                />
              </div>
              <div className="mt-4">
                <EvidenceList
                  title="Capabilities to acquire"
                  items={campaign.capabilitiesToAcquire}
                />
              </div>
            </Card>
            <RelationshipEditor
              links={campaign.links}
              entityType="opportunity_campaign"
              entityId={campaign.id}
              revision={Number(campaign.revision)}
              userIds={userIds}
              onRefresh={onRefresh}
            />
          </div>
        </div>
      </div>
      <CampaignCriteriaDialog
        open={criteriaOpen}
        onOpenChange={setCriteriaOpen}
        userIds={userIds}
        campaign={campaign}
        onSaved={onRefresh}
      />
      <RoleTargetDialog
        open={roleOpen}
        onOpenChange={setRoleOpen}
        userIds={userIds}
        campaignId={campaign.id}
        target={roleTarget}
        onSaved={onRefresh}
      />
      <OrganizationTargetDialog
        open={organizationOpen}
        onOpenChange={setOrganizationOpen}
        userIds={userIds}
        campaignId={campaign.id}
        organizations={organizations}
        target={organizationTarget}
        onSaved={onRefresh}
      />
    </div>
  );
}
