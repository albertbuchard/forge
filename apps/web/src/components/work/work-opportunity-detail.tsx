import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, Save } from "lucide-react";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  EvidenceList,
  SourceFreshness,
  WorkStatusBadge,
  formatDate,
  readable
} from "@/components/work/work-components";
import { JobApplicationDialog } from "@/components/work/work-pipeline-dialogs";
import { updateJobOpportunity } from "@/lib/work-api";
import type {
  JobOpportunity,
  OpportunityCampaign,
  WorkRecord
} from "@/lib/work-api";
import {
  RelationshipEditor,
  EventTimeline,
  FactsGrid,
  OpportunitySourceEvidence,
  record
} from "./work-detail-shared";
import { workBenefitLabel } from "./work-engagement-detail-support";

type OpportunityEditDraft = {
  organizationId: string;
  canonicalUrl: string;
  sourceName: string;
  sourceIdentifier: string;
  sourceSnapshotArtifactId: string;
  title: string;
  employerName: string;
  roleFamily: string;
  seniority: string;
  sector: string;
  description: string;
  responsibilities: string;
  requirements: string;
  preferredQualifications: string;
  skills: string;
  technologies: string;
  location: string;
  workModel: string;
  travel: string;
  sponsorship: string;
  employmentType: string;
  weeklyHoursMinimum: string;
  weeklyHoursMaximum: string;
  duration: string;
  startDate: string;
  publishedAt: string;
  applicationDeadline: string;
  availabilityStatus: string;
  disposition: string;
  confidencePercent: string;
  compensationUnknown: boolean;
  compensationAmount: string;
  compensationCurrency: string;
  compensationPeriod: string;
  benefits: string;
  unknowns: string;
  redFlags: string;
  eligibilityUncertainties: string;
  decision: string;
  decisionRationale: string;
  nextAction: string;
};

function dateTimeInput(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function opportunityEditDraft(
  opportunity: JobOpportunity
): OpportunityEditDraft {
  const weeklyHours = record(opportunity.weeklyHours);
  const compensation = record(opportunity.compensation);
  const base = record(compensation.base);
  const primarySource = opportunity.sources?.[0];
  return {
    organizationId: opportunity.organizationId ?? "",
    canonicalUrl: opportunity.canonicalUrl ?? "",
    sourceName: opportunity.sourceName ?? "",
    sourceIdentifier: opportunity.sourceIdentifier ?? "",
    sourceSnapshotArtifactId: String(primarySource?.snapshotArtifactId ?? ""),
    title: opportunity.title,
    employerName: opportunity.employerName ?? "",
    roleFamily: opportunity.roleFamily ?? "",
    seniority: opportunity.seniority ?? "",
    sector: opportunity.sector ?? "",
    description: opportunity.description ?? "",
    responsibilities: (opportunity.responsibilities ?? []).join("\n"),
    requirements: (opportunity.requirements ?? []).join("\n"),
    preferredQualifications: (opportunity.preferredQualifications ?? []).join(
      "\n"
    ),
    skills: (opportunity.skills ?? []).join("\n"),
    technologies: (opportunity.technologies ?? []).join("\n"),
    location: String(record(opportunity.location).label ?? ""),
    workModel: String(opportunity.workModel ?? "unknown"),
    travel: String(
      record(opportunity.travel).description ??
        record(opportunity.travel).summary ??
        ""
    ),
    sponsorship: String(
      record(opportunity.sponsorship).description ??
        record(opportunity.sponsorship).summary ??
        ""
    ),
    employmentType: String(opportunity.employmentType ?? "unknown"),
    weeklyHoursMinimum:
      weeklyHours.minimum == null ? "" : String(weeklyHours.minimum),
    weeklyHoursMaximum:
      weeklyHours.maximum == null ? "" : String(weeklyHours.maximum),
    duration: String(
      record(opportunity.duration).description ??
        record(opportunity.duration).summary ??
        ""
    ),
    startDate: String(opportunity.startDate ?? ""),
    publishedAt: dateTimeInput(opportunity.publishedAt),
    applicationDeadline: String(opportunity.applicationDeadline ?? ""),
    availabilityStatus: String(opportunity.availabilityStatus ?? "unknown"),
    disposition: String(opportunity.disposition ?? "discovered"),
    confidencePercent:
      opportunity.confidence == null
        ? ""
        : String(Math.round(opportunity.confidence * 100)),
    compensationUnknown: base.unknown !== false,
    compensationAmount: base.amount == null ? "" : String(base.amount),
    compensationCurrency: String(base.currency ?? "CHF"),
    compensationPeriod: String(base.period ?? "year"),
    benefits: (opportunity.benefits ?? [])
      .map((benefit) => workBenefitLabel(benefit))
      .filter(Boolean)
      .join("\n"),
    unknowns: (opportunity.unknowns ?? []).join("\n"),
    redFlags: (opportunity.redFlags ?? []).join("\n"),
    eligibilityUncertainties: (opportunity.eligibilityUncertainties ?? []).join(
      "\n"
    ),
    decision: opportunity.decision ?? "",
    decisionRationale: opportunity.decisionRationale ?? "",
    nextAction: opportunity.nextAction ?? ""
  };
}

function opportunityDraftPayload(
  draft: OpportunityEditDraft,
  includeCompensation: boolean,
  source?: JobOpportunity
) {
  const lineValues = (value: string) =>
    value
      .split(/\r?\n/gu)
      .map((entry) => entry.trim())
      .filter(Boolean);
  const numberOrNull = (value: string) => (value.trim() ? Number(value) : null);
  return {
    organizationId: draft.organizationId || null,
    canonicalUrl: draft.canonicalUrl,
    sourceName: draft.sourceName,
    sourceIdentifier: draft.sourceIdentifier,
    sourceSnapshotArtifactId: draft.sourceSnapshotArtifactId || null,
    title: draft.title,
    employerName: draft.employerName,
    roleFamily: draft.roleFamily,
    seniority: draft.seniority,
    sector: draft.sector,
    description: draft.description,
    responsibilities: lineValues(draft.responsibilities),
    requirements: lineValues(draft.requirements),
    preferredQualifications: lineValues(draft.preferredQualifications),
    skills: lineValues(draft.skills),
    technologies: lineValues(draft.technologies),
    location: { ...record(source?.location), label: draft.location },
    workModel: draft.workModel,
    travel: {
      ...record(source?.travel),
      description: draft.travel
    },
    sponsorship: {
      ...record(source?.sponsorship),
      description: draft.sponsorship
    },
    employmentType: draft.employmentType,
    weeklyHours: {
      ...record(source?.weeklyHours),
      minimum: numberOrNull(draft.weeklyHoursMinimum),
      maximum: numberOrNull(draft.weeklyHoursMaximum)
    },
    duration: {
      ...record(source?.duration),
      description: draft.duration
    },
    startDate: draft.startDate || null,
    publishedAt: draft.publishedAt
      ? new Date(draft.publishedAt).toISOString()
      : null,
    applicationDeadline: draft.applicationDeadline || null,
    availabilityStatus: draft.availabilityStatus,
    disposition: draft.disposition,
    confidence: draft.confidencePercent.trim()
      ? Number(draft.confidencePercent) / 100
      : null,
    compensation: includeCompensation
      ? {
          ...record(source?.compensation),
          base: {
            ...record(record(source?.compensation).base),
            amount: draft.compensationUnknown
              ? null
              : numberOrNull(draft.compensationAmount),
            currency: draft.compensationUnknown
              ? null
              : draft.compensationCurrency.toUpperCase(),
            basis: draft.compensationUnknown ? "unknown" : "gross",
            period: draft.compensationUnknown
              ? "unknown"
              : draft.compensationPeriod,
            negotiable: null,
            unknown: draft.compensationUnknown
          }
        }
      : undefined,
    benefits: includeCompensation
      ? lineValues(draft.benefits).map(
          (label) =>
            source?.benefits?.find(
              (benefit) => workBenefitLabel(benefit) === label
            ) ?? {
              type: "other",
              label,
              description: "",
              amount: null,
              currency: null,
              period: "unknown",
              days: null,
              unknown: false
            }
        )
      : undefined,
    unknowns: lineValues(draft.unknowns),
    redFlags: lineValues(draft.redFlags),
    eligibilityUncertainties: lineValues(draft.eligibilityUncertainties),
    decision: draft.decision,
    decisionRationale: draft.decisionRationale,
    nextAction: draft.nextAction
  };
}

function opportunityEditPatch(
  opportunity: JobOpportunity,
  draft: OpportunityEditDraft,
  compensationEdited: boolean
) {
  const before = opportunityDraftPayload(
    opportunityEditDraft(opportunity),
    compensationEdited,
    opportunity
  );
  const after = opportunityDraftPayload(draft, compensationEdited, opportunity);
  return Object.fromEntries(
    Object.entries(after).filter(
      ([key, value]) =>
        JSON.stringify(value) !==
        JSON.stringify((before as Record<string, unknown>)[key])
    )
  );
}

function EvaluationEvidenceList({
  title,
  items
}: {
  title: string;
  items: unknown;
}) {
  const records = Array.isArray(items)
    ? items.filter((item) => item && typeof item === "object").map(record)
    : [];
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
        {title}
      </h3>
      {records.length ? (
        <ul className="mt-2 grid gap-2">
          {records.map((item, index) => {
            const artifactId =
              typeof item.sourceArtifactId === "string"
                ? item.sourceArtifactId
                : "";
            const sourceUrl =
              typeof item.sourceUrl === "string" ? item.sourceUrl : "";
            const content = (
              <>
                <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                  {String(item.label ?? readable(item.kind, "Evidence"))}
                </div>
                {item.claim ? (
                  <p className="mt-1 text-xs leading-5 text-[var(--ui-ink-soft)]">
                    {String(item.claim)}
                  </p>
                ) : null}
                <div className="mt-1 text-[10px] text-[var(--ui-ink-faint)]">
                  {readable(item.kind)}
                  {item.observedAt ? ` · ${formatDate(item.observedAt)}` : ""}
                  {typeof item.confidence === "number"
                    ? ` · ${Math.round(item.confidence * 100)}% confidence`
                    : ""}
                </div>
              </>
            );
            return (
              <li
                key={`${String(item.sourceDigest ?? item.label ?? item.kind)}-${index}`}
                className="rounded-[15px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3"
              >
                {artifactId ? (
                  <Link
                    to={`/artifacts/${encodeURIComponent(artifactId)}`}
                    className="block hover:text-[var(--primary)]"
                  >
                    {content}
                  </Link>
                ) : sourceUrl ? (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block hover:text-[var(--primary)]"
                  >
                    {content}
                  </a>
                ) : (
                  content
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-[var(--ui-ink-faint)]">
          No matched evidence recorded.
        </p>
      )}
    </section>
  );
}

export function OpportunityDetail({
  opportunity,
  organizations,
  campaigns,
  allOpportunities,
  userIds,
  onRefresh
}: {
  opportunity: JobOpportunity;
  organizations: WorkRecord[];
  campaigns: OpportunityCampaign[];
  allOpportunities: JobOpportunity[];
  userIds: string[];
  onRefresh: () => Promise<void>;
}) {
  const [applicationOpen, setApplicationOpen] = useState(false);
  const applicationOpportunities = allOpportunities.some(
    (candidate) => candidate.id === opportunity.id
  )
    ? allOpportunities
    : [opportunity, ...allOpportunities];
  const [editing, setEditing] = useState(false);
  const [compensationEdited, setCompensationEdited] = useState(false);
  const [draft, setDraft] = useState(() => opportunityEditDraft(opportunity));
  useEffect(() => {
    setDraft(opportunityEditDraft(opportunity));
    setCompensationEdited(false);
  }, [opportunity]);
  const set = (patch: Partial<OpportunityEditDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const editPatch = opportunityEditPatch(
    opportunity,
    draft,
    compensationEdited
  );
  const mutation = useMutation({
    mutationFn: (input: {
      disposition?: string;
      excitement?: number;
      nextAction?: string;
    }) =>
      updateJobOpportunity(userIds, opportunity.id, {
        expectedRevision: Number(opportunity.revision),
        ...input,
        provenance: {
          sourceKind: "user",
          sourceLabel: "Forge Work opportunity review"
        }
      }),
    onSuccess: onRefresh
  });
  const save = useMutation({
    mutationFn: () =>
      updateJobOpportunity(userIds, opportunity.id, {
        expectedRevision: Number(opportunity.revision),
        ...editPatch,
        provenance: {
          sourceKind: "user",
          sourceLabel: "Forge Work opportunity editor"
        }
      }),
    onSuccess: async () => {
      setEditing(false);
      await onRefresh();
    }
  });
  const evaluation = opportunity.evaluations?.[0] as WorkRecord | undefined;
  const scores =
    (evaluation?.criterionScores as WorkRecord[] | undefined) ?? [];
  return (
    <div className="grid gap-5">
      <PageHero
        entityKind="job_opportunity"
        title={opportunity.title}
        description={`${opportunity.employerName || "Employer unknown"} · ${readable(opportunity.workModel)}`}
        badge={
          <div className="flex gap-2">
            <WorkStatusBadge status={opportunity.disposition} />
            <WorkStatusBadge status={opportunity.availabilityStatus} />
          </div>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => setEditing((current) => !current)}
            >
              {editing ? "Cancel edit" : "Edit facts"}
            </Button>
            <Button
              variant="secondary"
              pending={mutation.isPending}
              onClick={() =>
                mutation.mutate({ disposition: "rejected_by_user" })
              }
            >
              Reject
            </Button>
            <Button
              variant="secondary"
              pending={mutation.isPending}
              onClick={() => mutation.mutate({ disposition: "shortlisted" })}
            >
              Shortlist
            </Button>
            <Button onClick={() => setApplicationOpen(true)}>
              Start application
            </Button>
          </div>
        }
      />
      <div className="grid gap-5 px-4 sm:px-6">
        <Link
          to="/work?tab=searches"
          className="inline-flex items-center gap-2 text-sm text-[var(--primary)]"
        >
          <ArrowLeft className="size-4" />
          Back to opportunity inbox
        </Link>
        <SourceFreshness opportunity={opportunity} />
        {editing ? (
          <Card className="grid gap-5">
            <div>
              <h2 className="font-semibold text-[var(--ui-ink-strong)]">
                Edit sourced opportunity
              </h2>
              <p className="mt-1 text-sm leading-6 text-[var(--ui-ink-soft)]">
                Preserve explicit unknowns and source provenance. Changing
                source identity runs duplicate protection before saving.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Title
                <Input
                  value={draft.title}
                  onChange={(event) => set({ title: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Employer
                <Input
                  value={draft.employerName}
                  onChange={(event) =>
                    set({ employerName: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Organization
                <select
                  value={draft.organizationId}
                  onChange={(event) =>
                    set({ organizationId: event.target.value })
                  }
                  className="min-h-11 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm"
                >
                  <option value="">No linked organization</option>
                  {organizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {String(organization.name ?? organization.id)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Role family
                <Input
                  value={draft.roleFamily}
                  onChange={(event) => set({ roleFamily: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Seniority
                <Input
                  value={draft.seniority}
                  onChange={(event) => set({ seniority: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Sector
                <Input
                  value={draft.sector}
                  onChange={(event) => set({ sector: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Canonical URL
                <Input
                  type="url"
                  value={draft.canonicalUrl}
                  onChange={(event) =>
                    set({ canonicalUrl: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Source
                <Input
                  value={draft.sourceName}
                  onChange={(event) => set({ sourceName: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Source identifier
                <Input
                  value={draft.sourceIdentifier}
                  onChange={(event) =>
                    set({ sourceIdentifier: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Source snapshot Artifact ID
                <Input
                  value={draft.sourceSnapshotArtifactId}
                  onChange={(event) =>
                    set({ sourceSnapshotArtifactId: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Location
                <Input
                  value={draft.location}
                  onChange={(event) => set({ location: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Work model
                <select
                  value={draft.workModel}
                  onChange={(event) => set({ workModel: event.target.value })}
                  className="min-h-11 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm"
                >
                  {["unknown", "remote", "hybrid", "on_site", "variable"].map(
                    (value) => (
                      <option key={value} value={value}>
                        {readable(value)}
                      </option>
                    )
                  )}
                </select>
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Employment type
                <Input
                  value={draft.employmentType}
                  onChange={(event) =>
                    set({ employmentType: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Minimum weekly hours
                <Input
                  type="number"
                  min="0"
                  max="168"
                  value={draft.weeklyHoursMinimum}
                  onChange={(event) =>
                    set({ weeklyHoursMinimum: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Maximum weekly hours
                <Input
                  type="number"
                  min="0"
                  max="168"
                  value={draft.weeklyHoursMaximum}
                  onChange={(event) =>
                    set({ weeklyHoursMaximum: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Duration
                <Input
                  value={draft.duration}
                  onChange={(event) => set({ duration: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Start date
                <Input
                  type="date"
                  value={draft.startDate}
                  onChange={(event) => set({ startDate: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Published at
                <Input
                  type="datetime-local"
                  value={draft.publishedAt}
                  onChange={(event) => set({ publishedAt: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Application deadline
                <Input
                  type="date"
                  value={draft.applicationDeadline}
                  onChange={(event) =>
                    set({ applicationDeadline: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Availability
                <select
                  value={draft.availabilityStatus}
                  onChange={(event) =>
                    set({ availabilityStatus: event.target.value })
                  }
                  className="min-h-11 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm"
                >
                  {["unknown", "live", "stale", "closed", "filled"].map(
                    (value) => (
                      <option key={value}>{value}</option>
                    )
                  )}
                </select>
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Disposition
                <select
                  value={draft.disposition}
                  onChange={(event) => set({ disposition: event.target.value })}
                  className="min-h-11 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm"
                >
                  {[
                    "discovered",
                    "reviewing",
                    "shortlisted",
                    "qualified",
                    "rejected_by_user",
                    "disqualified",
                    "applied",
                    "stale",
                    "closed",
                    "archived"
                  ].map((value) => (
                    <option key={value}>{readable(value)}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Source confidence (0–100%)
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={draft.confidencePercent}
                  onChange={(event) =>
                    set({ confidencePercent: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)] md:col-span-2 lg:col-span-3">
                Description
                <Textarea
                  rows={8}
                  value={draft.description}
                  onChange={(event) => set({ description: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Responsibilities · one per line
                <Textarea
                  rows={6}
                  value={draft.responsibilities}
                  onChange={(event) =>
                    set({ responsibilities: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Required qualifications · one per line
                <Textarea
                  rows={6}
                  value={draft.requirements}
                  onChange={(event) =>
                    set({ requirements: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Preferred qualifications · one per line
                <Textarea
                  rows={6}
                  value={draft.preferredQualifications}
                  onChange={(event) =>
                    set({ preferredQualifications: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Skills · one per line
                <Textarea
                  rows={5}
                  value={draft.skills}
                  onChange={(event) => set({ skills: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Technologies · one per line
                <Textarea
                  rows={5}
                  value={draft.technologies}
                  onChange={(event) =>
                    set({ technologies: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Benefits · one per line
                <Textarea
                  rows={5}
                  value={draft.benefits}
                  onChange={(event) => {
                    setCompensationEdited(true);
                    set({ benefits: event.target.value });
                  }}
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Travel
                <Input
                  value={draft.travel}
                  onChange={(event) => set({ travel: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Sponsorship or authorization
                <Input
                  value={draft.sponsorship}
                  onChange={(event) => set({ sponsorship: event.target.value })}
                />
              </label>
              <div className="grid gap-3 rounded-[18px] border border-[var(--ui-border-subtle)] p-3">
                <label className="flex items-center gap-2 text-sm text-[var(--ui-ink-medium)]">
                  <input
                    type="checkbox"
                    checked={draft.compensationUnknown}
                    onChange={(event) => {
                      setCompensationEdited(true);
                      set({ compensationUnknown: event.target.checked });
                    }}
                  />
                  Compensation is unknown
                </label>
                {!draft.compensationUnknown ? (
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      aria-label="Compensation amount"
                      type="number"
                      min="0"
                      value={draft.compensationAmount}
                      onChange={(event) => {
                        setCompensationEdited(true);
                        set({ compensationAmount: event.target.value });
                      }}
                    />
                    <Input
                      aria-label="Compensation currency"
                      maxLength={3}
                      value={draft.compensationCurrency}
                      onChange={(event) => {
                        setCompensationEdited(true);
                        set({ compensationCurrency: event.target.value });
                      }}
                    />
                    <select
                      aria-label="Compensation period"
                      value={draft.compensationPeriod}
                      onChange={(event) => {
                        setCompensationEdited(true);
                        set({ compensationPeriod: event.target.value });
                      }}
                      className="min-h-11 rounded-[14px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-2 text-sm"
                    >
                      {["hour", "day", "week", "month", "year"].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <p className="text-xs text-[var(--ui-ink-faint)]">
                  Changes here require the separate Work compensation
                  permission. Leaving this section untouched does not request
                  that permission.
                </p>
              </div>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Explicit unknowns · one per line
                <Textarea
                  rows={5}
                  value={draft.unknowns}
                  onChange={(event) => set({ unknowns: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Eligibility uncertainties · one per line
                <Textarea
                  rows={5}
                  value={draft.eligibilityUncertainties}
                  onChange={(event) =>
                    set({ eligibilityUncertainties: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Red flags · one per line
                <Textarea
                  rows={5}
                  value={draft.redFlags}
                  onChange={(event) => set({ redFlags: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                User decision
                <Textarea
                  rows={3}
                  value={draft.decision}
                  onChange={(event) => set({ decision: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Decision rationale
                <Textarea
                  rows={3}
                  value={draft.decisionRationale}
                  onChange={(event) =>
                    set({ decisionRationale: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--ui-ink-soft)]">
                Next action
                <Textarea
                  rows={3}
                  value={draft.nextAction}
                  onChange={(event) => set({ nextAction: event.target.value })}
                />
              </label>
            </div>
            <div>
              <Button
                disabled={
                  !draft.title.trim() || Object.keys(editPatch).length === 0
                }
                pending={save.isPending}
                onClick={() => save.mutate()}
              >
                <Save className="size-4" />
                Save opportunity facts
              </Button>
              {save.error ? (
                <p className="mt-2 text-sm text-[var(--danger)]">
                  {save.error.message}
                </p>
              ) : null}
            </div>
          </Card>
        ) : null}
        <FactsGrid
          facts={[
            { label: "Employer", value: opportunity.employerName },
            { label: "Role family", value: opportunity.roleFamily },
            { label: "Seniority", value: opportunity.seniority },
            { label: "Work model", value: opportunity.workModel },
            { label: "Employment type", value: opportunity.employmentType },
            {
              label: "Application deadline",
              value: formatDate(opportunity.applicationDeadline)
            },
            { label: "Source", value: opportunity.sourceName },
            {
              label: "Confidence",
              value:
                opportunity.confidence === null ||
                opportunity.confidence === undefined
                  ? "Unknown"
                  : `${Math.round(opportunity.confidence * 100)}%`
            },
            {
              label: "Excitement",
              value: opportunity.excitement
                ? `${opportunity.excitement} / 5`
                : "Not rated"
            }
          ]}
        />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.7fr)]">
          <div className="grid gap-5">
            <Card>
              <h2 className="font-semibold text-[var(--ui-ink-strong)]">
                Role facts
              </h2>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--ui-ink-medium)]">
                {opportunity.description || "No source description stored."}
              </p>
              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <EvidenceList
                  title="Responsibilities"
                  items={opportunity.responsibilities}
                />
                <EvidenceList
                  title="Requirements"
                  items={opportunity.requirements}
                />
                <EvidenceList
                  title="Preferred qualifications"
                  items={opportunity.preferredQualifications}
                />
                <EvidenceList
                  title="Skills and technologies"
                  items={[
                    ...(opportunity.skills ?? []),
                    ...(opportunity.technologies ?? [])
                  ]}
                />
              </div>
            </Card>
            <OpportunitySourceEvidence sources={opportunity.sources ?? []} />
            <Card>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-[var(--ui-ink-strong)]">
                    Campaign-specific evaluation
                  </h2>
                  <p className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                    Scored against one exact criteria version.
                  </p>
                </div>
                {evaluation ? (
                  <div className="flex gap-2">
                    <Badge tone="signal">
                      {String(evaluation.overallScore ?? "—")} / 100
                    </Badge>
                    <WorkStatusBadge status={evaluation.hardGateResult} />
                  </div>
                ) : null}
              </div>
              {evaluation ? (
                <>
                  <div className="mt-4 grid gap-2">
                    {scores.map((score, index) => (
                      <div
                        key={String(score.criterionKey ?? index)}
                        className="grid gap-2 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                      >
                        <div>
                          <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                            {readable(score.criterionKey, "Criterion")}
                          </div>
                          <div className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                            {String(
                              score.explanation ||
                                (Array.isArray(score.failureReasons)
                                  ? score.failureReasons[0]
                                  : "") ||
                                (Array.isArray(score.gaps)
                                  ? score.gaps[0]
                                  : "") ||
                                "No evaluation explanation"
                            )}
                          </div>
                          <div className="mt-2 text-[10px] text-[var(--ui-ink-faint)]">
                            {Array.isArray(score.matchedEvidence)
                              ? score.matchedEvidence.length
                              : 0}{" "}
                            evidence item
                            {Array.isArray(score.matchedEvidence) &&
                            score.matchedEvidence.length === 1
                              ? ""
                              : "s"}
                            {typeof score.confidence === "number"
                              ? ` · ${Math.round(score.confidence * 100)}% confidence`
                              : ""}
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <WorkStatusBadge status={score.result} />
                          <Badge tone="meta">
                            {score.score == null
                              ? "No score"
                              : `${String(score.score)} / 100`}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 grid gap-5 md:grid-cols-2">
                    <EvaluationEvidenceList
                      title="Matched evidence"
                      items={evaluation.matchedEvidence}
                    />
                    <EvidenceList
                      title="Gaps"
                      items={evaluation.gaps}
                      tone="warning"
                    />
                    <EvidenceList
                      title="Failure reasons"
                      items={evaluation.failureReasons}
                      tone="warning"
                    />
                    <EvidenceList
                      title="Trade-offs"
                      items={evaluation.tradeoffs}
                    />
                  </div>
                </>
              ) : (
                <p className="mt-4 text-sm text-[var(--ui-ink-soft)]">
                  No evaluation has been recorded. An authorized agent can
                  evaluate it against an exact campaign criteria version with
                  sourced evidence.
                </p>
              )}
            </Card>
            <EventTimeline
              events={opportunity.history}
              empty="No opportunity history has been recorded."
            />
          </div>
          <div className="grid content-start gap-5">
            <Card>
              <EvidenceList
                title="Unknown facts"
                items={opportunity.unknowns}
                empty="No unknowns recorded."
              />
              <div className="mt-5">
                <EvidenceList
                  title="Eligibility uncertainties"
                  items={opportunity.eligibilityUncertainties}
                  tone="warning"
                />
              </div>
              <div className="mt-5">
                <EvidenceList
                  title="Red flags"
                  items={opportunity.redFlags}
                  tone="warning"
                />
              </div>
            </Card>
            <Card>
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                Decision and next action
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-strong)]">
                {opportunity.decision || "No decision recorded."}
              </p>
              <p className="mt-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
                {opportunity.nextAction || "No next action recorded."}
              </p>
              <div className="mt-4">
                <label className="text-xs text-[var(--ui-ink-faint)]">
                  Personal excitement
                </label>
                <div className="mt-2 grid grid-cols-5 gap-2">
                  {[1, 2, 3, 4, 5].map((score) => (
                    <button
                      key={score}
                      type="button"
                      aria-pressed={opportunity.excitement === score}
                      onClick={() => mutation.mutate({ excitement: score })}
                      className={`min-h-11 rounded-xl border text-sm ${opportunity.excitement === score ? "border-[var(--primary)] bg-[var(--ui-accent-soft)]" : "border-[var(--ui-border-subtle)]"}`}
                    >
                      {score}
                    </button>
                  ))}
                </div>
              </div>
            </Card>
            <RelationshipEditor
              links={opportunity.links}
              entityType="job_opportunity"
              entityId={opportunity.id}
              revision={Number(opportunity.revision)}
              userIds={userIds}
              onRefresh={onRefresh}
            />
          </div>
        </div>
      </div>
      <JobApplicationDialog
        open={applicationOpen}
        onOpenChange={setApplicationOpen}
        userIds={userIds}
        campaigns={campaigns}
        opportunities={applicationOpportunities}
        initialOpportunityId={opportunity.id}
        onSaved={onRefresh}
      />
    </div>
  );
}
