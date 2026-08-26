import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  ExternalLink,
  FileQuestion,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-state";
import type {
  JobApplication,
  JobOpportunity,
  OpportunityCampaign,
  WorkEngagement,
  WorkRecord,
  WorkTrendSeries
} from "@/lib/work-api";
import { cn } from "@/lib/utils";

export const WORK_TABS = [
  {
    id: "overview",
    label: "Overview",
    description: "Your work and search status at a glance"
  },
  {
    id: "current",
    label: "Current work",
    description: "Jobs, contracts, and other active roles"
  },
  {
    id: "check-ins",
    label: "Check-ins",
    description: "How each role is changing over time"
  },
  {
    id: "plans",
    label: "Goals and plans",
    description: "Career direction and next steps"
  },
  {
    id: "searches",
    label: "Job searches",
    description: "Separate searches, roles, and targets"
  },
  {
    id: "applications",
    label: "Applications",
    description: "Applications, interviews, and outcomes"
  },
  {
    id: "documents",
    label: "Documents",
    description: "CVs, letters, and saved answers"
  }
] as const;

export type WorkTabId = (typeof WORK_TABS)[number]["id"];

type WorkMobileSectionPickerProps<T extends string> = {
  label: string;
  active: T;
  options: Array<WorkSectionOption<T>> | ReadonlyArray<WorkSectionOption<T>>;
  onChange: (id: T) => void;
  desktopBreakpoint: "md" | "lg";
};

function WorkMobileSectionPicker<T extends string>({
  label,
  active,
  options,
  onChange,
  desktopBreakpoint
}: WorkMobileSectionPickerProps<T>) {
  const [open, setOpen] = useState(false);
  const activeOption =
    options.find((option) => option.id === active) ?? options[0];
  const desktopHidden = desktopBreakpoint === "md" ? "md:hidden" : "lg:hidden";
  const desktopQuery =
    desktopBreakpoint === "md" ? "(min-width: 768px)" : "(min-width: 1024px)";

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(desktopQuery);
    const closeAtDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    if (media.matches) setOpen(false);
    media.addEventListener("change", closeAtDesktop);
    return () => media.removeEventListener("change", closeAtDesktop);
  }, [desktopQuery]);

  if (!activeOption) return null;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${activeOption.label}`}
          className={cn(
            "flex min-h-14 w-full min-w-0 items-center justify-between gap-3 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3.5 py-2.5 text-left shadow-[var(--ui-shadow-soft)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]",
            desktopHidden
          )}
          data-work-mobile-section-trigger={label}
        >
          <span className="min-w-0">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
              {label}
            </span>
            <span className="mt-0.5 block truncate text-sm font-semibold text-[var(--ui-ink-strong)]">
              {activeOption.label}
            </span>
            {activeOption.description ? (
              <span className="mt-0.5 block truncate text-xs text-[var(--ui-ink-soft)]">
                {activeOption.description}
              </span>
            ) : null}
          </span>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)]">
            <ChevronDown className="size-4" />
          </span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "fixed inset-0 z-[70] bg-[var(--overlay)] backdrop-blur-xl",
            desktopHidden
          )}
        />
        <div
          className={cn(
            "pointer-events-none fixed inset-0 z-[71] flex items-end justify-center",
            desktopHidden
          )}
          style={{
            paddingLeft:
              "max(0.75rem, calc(var(--forge-safe-area-left) + 0.75rem))",
            paddingRight:
              "max(0.75rem, calc(var(--forge-safe-area-right) + 0.75rem))",
            paddingTop:
              "max(0.75rem, calc(env(safe-area-inset-top) + 0.75rem))",
            paddingBottom:
              "calc(var(--forge-mobile-nav-clearance) - 0.25rem)"
          }}
        >
          <Dialog.Content className="surface-modal-panel pointer-events-auto flex max-h-[min(38rem,calc(100dvh-var(--forge-mobile-nav-clearance)-1rem))] w-full max-w-xl min-h-0 flex-col overflow-hidden rounded-[30px] border border-[var(--ui-border-subtle)] shadow-[var(--ui-shadow-floating)]">
            <div className="shrink-0 border-b border-[var(--ui-border-subtle)] px-4 pb-3 pt-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Dialog.Title className="text-lg font-semibold text-[var(--ui-ink-strong)]">
                    Choose {label.toLowerCase()}
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-sm leading-5 text-[var(--ui-ink-soft)]">
                    Open one focused view. Your other Work information stays
                    available here.
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    aria-label={`Close ${label.toLowerCase()}`}
                    className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                  >
                    <X className="size-4" />
                  </button>
                </Dialog.Close>
              </div>
            </div>
            <nav
              aria-label={label}
              className="min-h-0 overflow-y-auto overscroll-contain p-3"
            >
              <div className="grid gap-2">
                {options.map((option) => {
                  const selected = option.id === active;
                  return (
                    <Dialog.Close asChild key={option.id}>
                      <button
                        type="button"
                        aria-current={selected ? "page" : undefined}
                        onClick={() => onChange(option.id)}
                        className={cn(
                          "flex min-h-14 w-full min-w-0 items-center justify-between gap-3 rounded-[20px] border px-3.5 py-3 text-left transition",
                          selected
                            ? "border-[color-mix(in_srgb,var(--primary)_30%,var(--ui-border-subtle))] bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)]"
                            : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)] hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]"
                        )}
                        data-work-mobile-section-option={option.id}
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">
                            {option.label}
                          </span>
                          {option.description ? (
                            <span className="mt-0.5 block text-xs leading-5 text-[var(--ui-ink-soft)]">
                              {option.description}
                            </span>
                          ) : null}
                        </span>
                        {selected ? (
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--ui-surface-1)] text-[var(--primary)]">
                            <Check className="size-4" />
                          </span>
                        ) : (
                          <ChevronRight className="size-4 shrink-0 text-[var(--ui-ink-faint)]" />
                        )}
                      </button>
                    </Dialog.Close>
                  );
                })}
              </div>
            </nav>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function WorkTabBar({ active }: { active: WorkTabId }) {
  const navigate = useNavigate();
  return (
    <div className="border-b border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 sm:px-6">
      <WorkMobileSectionPicker
        label="Work sections"
        active={active}
        options={WORK_TABS}
        onChange={(tab) => navigate(`/work?tab=${tab}`)}
        desktopBreakpoint="md"
      />
      <nav aria-label="Work sections" className="hidden md:block">
        <div className="flex flex-wrap gap-1">
          {WORK_TABS.map((tab) => (
            <Link
              key={tab.id}
              to={`/work?tab=${tab.id}`}
              aria-current={active === tab.id ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_45%,transparent)]",
                active === tab.id
                  ? "bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)] shadow-[var(--ui-shadow-soft)]"
                  : "text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
              )}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

export type WorkSectionOption<T extends string = string> = {
  id: T;
  label: string;
  description?: string;
};

export function WorkSectionNav<T extends string>({
  label,
  active,
  options,
  onChange
}: {
  label: string;
  active: T;
  options: Array<WorkSectionOption<T>>;
  onChange: (id: T) => void;
}) {
  return (
    <div className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-2">
      <WorkMobileSectionPicker
        label={label}
        active={active}
        options={options}
        onChange={onChange}
        desktopBreakpoint="lg"
      />
      <div
        className="hidden gap-1 lg:grid"
        style={{
          gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`
        }}
        role="navigation"
        aria-label={label}
      >
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-current={active === option.id ? "page" : undefined}
            onClick={() => onChange(option.id)}
            className={cn(
              "min-w-0 rounded-[14px] px-3 py-2 text-left transition",
              active === option.id
                ? "bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)]"
                : "text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)]"
            )}
          >
            <span className="block truncate text-sm font-semibold">
              {option.label}
            </span>
            {option.description ? (
              <span className="mt-0.5 block truncate text-xs opacity-75">
                {option.description}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

const HUMAN_LABELS: Record<string, string> = {
  acknowledged: "Acknowledged",
  blocked_on_user_input: "Waiting for you",
  declined_by_candidate: "Declined",
  discovered: "New",
  fail: "Does not meet requirements",
  full_time_employment: "Full-time work",
  hard: "Required",
  information_request: "Information requested",
  needs_review: "Needs review",
  on_site: "On-site",
  pass: "Meets requirements",
  ready_for_review: "Ready for review",
  ready_to_submit: "Ready to send",
  rejected_by_user: "Not for me",
  soft: "Preference",
  verified_submission: "Verified submission"
};

export function readable(value: unknown, fallback = "Not set") {
  if (typeof value === "string" && value.trim()) {
    const original = value.trim();
    const words = original
      .replaceAll(/([a-z0-9])([A-Z])/gu, "$1 $2")
      .replaceAll(/[_-]+/gu, " ")
      .replaceAll(/\s+/gu, " ");
    const key = words.toLowerCase().replaceAll(" ", "_");
    if (HUMAN_LABELS[key]) return HUMAN_LABELS[key];
    if (words !== original || original === original.toLowerCase())
      return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
    return original;
  }
  if (typeof value === "number") return String(value);
  return fallback;
}

export function formatDate(value: unknown, fallback = "No date") {
  if (typeof value !== "string" || !value) return fallback;
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(parsed);
}

export function WorkStatusBadge({ status }: { status: unknown }) {
  const value = readable(status, "unknown");
  const statusKey =
    typeof status === "string"
      ? status.trim().toLowerCase().replaceAll(" ", "_")
      : "unknown";
  const signal = [
    "current",
    "active",
    "healthy",
    "qualified",
    "shortlisted",
    "offer",
    "accepted",
    "ready_to_submit"
  ].includes(statusKey);
  const warning = [
    "blocked",
    "attention",
    "stale",
    "rejected",
    "closed",
    "abandoned"
  ].includes(statusKey);
  return (
    <Badge
      tone={signal ? "signal" : "meta"}
      className={
        warning
          ? "border-[color-mix(in_srgb,var(--danger)_35%,var(--ui-border-subtle))] text-[var(--danger)]"
          : undefined
      }
    >
      {value}
    </Badge>
  );
}

export function StatStrip({
  items
}: {
  items: Array<{ label: string; value: string | number; detail?: string }>;
}) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-border-subtle)] lg:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="min-w-0 bg-[var(--ui-surface-1)] px-4 py-4"
        >
          <dt className="text-[11px] font-medium uppercase tracking-[0.15em] text-[var(--ui-ink-faint)]">
            {item.label}
          </dt>
          <dd className="mt-2 truncate text-2xl font-semibold tabular-nums text-[var(--ui-ink-strong)]">
            {item.value}
          </dd>
          {item.detail ? (
            <dd className="mt-1 text-xs text-[var(--ui-ink-soft)]">
              {item.detail}
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

function organizationName(
  organizationId: string | null | undefined,
  organizations: WorkRecord[]
) {
  const organization = organizations.find(
    (candidate) => candidate.id === organizationId
  );
  return organization
    ? String(organization.name ?? "Organization")
    : "Organization not linked";
}

export function EngagementCard({
  engagement,
  organizations,
  onCheckIn
}: {
  engagement: WorkEngagement;
  organizations: WorkRecord[];
  onCheckIn?: (id: string) => void;
}) {
  const weeklyHours =
    engagement.workload &&
    typeof engagement.workload.contractedWeeklyHours === "number"
      ? `${engagement.workload.contractedWeeklyHours} h/week`
      : "Hours not set";
  return (
    <Card className="flex h-full flex-col gap-4 p-5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <WorkStatusBadge status={engagement.status} />
            <Badge tone="meta">{readable(engagement.engagementType)}</Badge>
          </div>
          <Link
            to={`/work/engagements/${encodeURIComponent(engagement.id)}`}
            className="mt-3 block text-lg font-semibold leading-tight text-[var(--ui-ink-strong)] hover:text-[var(--primary)]"
          >
            {engagement.title}
          </Link>
          <p className="mt-1 text-sm text-[var(--ui-ink-soft)]">
            {organizationName(engagement.organizationId, organizations)}
            {engagement.roleFunction ? ` · ${engagement.roleFunction}` : ""}
          </p>
        </div>
        <Link
          to={`/work/engagements/${encodeURIComponent(engagement.id)}`}
          aria-label={`Open ${engagement.title}`}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full p-2 text-[var(--ui-ink-faint)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
        >
          <ChevronRight className="size-5" />
        </Link>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-[var(--ui-ink-faint)]">Dates</dt>
          <dd className="mt-1 text-[var(--ui-ink-medium)]">
            {formatDate(engagement.startDate, "Start unknown")}
            {engagement.expectedEndDate
              ? ` → ${formatDate(engagement.expectedEndDate)}`
              : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--ui-ink-faint)]">Work pattern</dt>
          <dd className="mt-1 text-[var(--ui-ink-medium)]">
            {readable(engagement.workModel)} · {weeklyHours}
          </dd>
        </div>
      </dl>
      <div className="mt-auto rounded-[18px] bg-[var(--ui-surface-2)] p-3">
        <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
          Next action
        </div>
        <p className="mt-1 text-sm leading-5 text-[var(--ui-ink-medium)]">
          {engagement.nextAction || "No next action recorded."}
        </p>
      </div>
      {onCheckIn ? (
        <Button variant="secondary" onClick={() => onCheckIn(engagement.id)}>
          Check in on this work
        </Button>
      ) : null}
    </Card>
  );
}

export function CampaignCard({ campaign }: { campaign: OpportunityCampaign }) {
  const stageCounts = campaign.pipeline?.stageCounts ?? {};
  const applicationCount = Object.values(stageCounts).reduce(
    (sum, count) => sum + count,
    0
  );
  return (
    <Link
      to={`/work/campaigns/${encodeURIComponent(campaign.id)}`}
      className="group block h-full rounded-[var(--radius-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_45%,transparent)]"
    >
      <Card className="flex h-full flex-col gap-4 p-5 transition group-hover:border-[var(--ui-border-strong)] group-hover:bg-[var(--ui-surface-hover)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap gap-2">
              <WorkStatusBadge status={campaign.status} />
              <WorkStatusBadge status={campaign.health} />
            </div>
            <h3 className="mt-3 text-lg font-semibold text-[var(--ui-ink-strong)]">
              {campaign.title}
            </h3>
            <p className="mt-1 text-sm leading-5 text-[var(--ui-ink-soft)]">
              {campaign.purpose ||
                campaign.description ||
                "No job-search purpose recorded."}
            </p>
          </div>
          <ChevronRight className="mt-1 size-5 shrink-0 text-[var(--ui-ink-faint)] transition group-hover:translate-x-0.5 group-hover:text-[var(--ui-ink-strong)]" />
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-[16px] bg-[var(--ui-surface-2)] px-2 py-3">
            <div className="text-lg font-semibold tabular-nums text-[var(--ui-ink-strong)]">
              {campaign.opportunities?.length ?? 0}
            </div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--ui-ink-faint)]">
              Roles
            </div>
          </div>
          <div className="rounded-[16px] bg-[var(--ui-surface-2)] px-2 py-3">
            <div className="text-lg font-semibold tabular-nums text-[var(--ui-ink-strong)]">
              {applicationCount}
            </div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--ui-ink-faint)]">
              Applications
            </div>
          </div>
          <div className="rounded-[16px] bg-[var(--ui-surface-2)] px-2 py-3">
            <div className="text-lg font-semibold tabular-nums text-[var(--ui-ink-strong)]">
              {campaign.blockers?.length ?? 0}
            </div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--ui-ink-faint)]">
              Blockers
            </div>
          </div>
        </div>
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-[var(--ui-border-subtle)] pt-3 text-xs text-[var(--ui-ink-soft)]">
          <span>
            {campaign.searchDeadline
              ? `Deadline ${formatDate(campaign.searchDeadline)}`
              : readable(campaign.reviewCadence, "Review cadence not set")}
          </span>
          <span className="truncate">
            {campaign.nextAction || "Define next action"}
          </span>
        </div>
      </Card>
    </Link>
  );
}

export function WorkTrendChart({
  series,
  title
}: {
  series: WorkTrendSeries;
  title?: string;
}) {
  const numericPoints = series.points.filter(
    (point) => typeof point.numericValue === "number"
  );
  const categoricalPoints = series.points.filter(
    (point) =>
      typeof point.categoricalValue === "string" &&
      point.categoricalValue.length > 0
  );
  const isCategorical = series.valueKind === "categorical";
  const observedValues = numericPoints.map((point) =>
    Number(point.numericValue)
  );
  const observedMinimum = observedValues.length
    ? Math.min(...observedValues)
    : 0;
  const observedMaximum = observedValues.length
    ? Math.max(...observedValues)
    : 1;
  const configuredMinimum =
    typeof series.scale?.minimum === "number" ? series.scale.minimum : null;
  const configuredMaximum =
    typeof series.scale?.maximum === "number" ? series.scale.maximum : null;
  const scaleMinimum =
    configuredMinimum ??
    (observedMinimum === observedMaximum
      ? observedMinimum - 1
      : observedMinimum);
  const scaleMaximum =
    configuredMaximum !== null && configuredMaximum > scaleMinimum
      ? configuredMaximum
      : observedMinimum === observedMaximum
        ? observedMaximum + 1
        : observedMaximum;
  const width = 440;
  const height = 150;
  const left = 28;
  const right = 10;
  const top = 12;
  const bottom = 24;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const path = numericPoints.map((point, index) => {
    const x =
      left +
      (numericPoints.length <= 1
        ? plotWidth / 2
        : (index / (numericPoints.length - 1)) * plotWidth);
    const value = Math.min(
      scaleMaximum,
      Math.max(scaleMinimum, Number(point.numericValue))
    );
    const y =
      top +
      ((scaleMaximum - value) / (scaleMaximum - scaleMinimum)) * plotHeight;
    return { x, y, value, observedAt: point.observedAt };
  });
  const delta = path.length > 1 ? path.at(-1)!.value - path[0].value : 0;
  return (
    <Card className="min-w-0 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--ui-ink-strong)]">
            {title ?? series.displayName ?? readable(series.metricKey)}
          </h3>
          <p className="mt-1 text-xs text-[var(--ui-ink-soft)]">
            {isCategorical
              ? "Recorded categories are shown as a dated history; no order or numeric distance is inferred."
              : `${configuredMinimum !== null && configuredMaximum !== null ? "Defined" : "Observed"} ${scaleMinimum}–${scaleMaximum} range; no values are inferred between check-ins.`}
          </p>
        </div>
        {path.length > 1 ? (
          <Badge tone="meta">
            {delta > 0 ? (
              <TrendingUp className="mr-1 size-3" />
            ) : delta < 0 ? (
              <TrendingDown className="mr-1 size-3" />
            ) : (
              <CircleDot className="mr-1 size-3" />
            )}
            {delta === 0
              ? "Stable"
              : `${delta > 0 ? "Up" : "Down"} ${Math.abs(delta).toFixed(series.valueKind === "ordinal" ? 1 : 2)} ${series.valueKind === "ordinal" ? `anchor step${Math.abs(delta) === 1 ? "" : "s"}` : `scale unit${Math.abs(delta) === 1 ? "" : "s"}`}`}
          </Badge>
        ) : null}
      </div>
      {isCategorical && categoricalPoints.length > 0 ? (
        <ol className="mt-4 grid gap-2">
          {categoricalPoints
            .slice(-8)
            .reverse()
            .map((point, index) => (
              <li
                key={`${point.observedAt}-${index}`}
                className="flex min-w-0 items-start justify-between gap-3 rounded-[16px] bg-[var(--ui-surface-2)] px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[var(--ui-ink-strong)]">
                    {point.categoricalValue}
                  </div>
                  {point.note ? (
                    <p className="mt-1 line-clamp-2 text-xs text-[var(--ui-ink-soft)]">
                      {point.note}
                    </p>
                  ) : null}
                </div>
                <time
                  dateTime={point.observedAt}
                  className="shrink-0 text-xs text-[var(--ui-ink-faint)]"
                >
                  {formatDate(point.observedAt)}
                </time>
              </li>
            ))}
        </ol>
      ) : isCategorical || path.length === 0 ? (
        <div className="mt-4 rounded-[18px] bg-[var(--ui-surface-2)] px-4 py-8 text-center text-sm text-[var(--ui-ink-soft)]">
          No confirmed observations in this window.
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${title ?? series.metricKey} trend with ${path.length} confirmed observations`}
          className="mt-3 h-auto w-full overflow-visible"
        >
          {[scaleMinimum, (scaleMinimum + scaleMaximum) / 2, scaleMaximum].map(
            (value) => {
              const y =
                top +
                ((scaleMaximum - value) / (scaleMaximum - scaleMinimum)) *
                  plotHeight;
              return (
                <g key={value}>
                  <line
                    x1={left}
                    y1={y}
                    x2={width - right}
                    y2={y}
                    stroke="var(--ui-border-subtle)"
                    strokeWidth="1"
                  />
                  <text
                    x="2"
                    y={y + 4}
                    fill="var(--ui-ink-faint)"
                    fontSize="10"
                  >
                    {value}
                  </text>
                </g>
              );
            }
          )}
          {path.length > 1 ? (
            <polyline
              points={path.map((point) => `${point.x},${point.y}`).join(" ")}
              fill="none"
              stroke="var(--primary)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
          {path.map((point, index) => (
            <g key={`${point.observedAt}-${index}`}>
              <circle
                cx={point.x}
                cy={point.y}
                r="5"
                fill="var(--ui-surface-1)"
                stroke="var(--primary)"
                strokeWidth="3"
              >
                <title>{`${formatDate(point.observedAt)}: ${point.value} on a ${scaleMinimum}–${scaleMaximum} scale`}</title>
              </circle>
            </g>
          ))}
          <text
            x={left}
            y={height - 5}
            fill="var(--ui-ink-faint)"
            fontSize="10"
          >
            {formatDate(path[0].observedAt)}
          </text>
          {path.length > 1 ? (
            <text
              x={width - right}
              y={height - 5}
              fill="var(--ui-ink-faint)"
              fontSize="10"
              textAnchor="end"
            >
              {formatDate(path.at(-1)!.observedAt)}
            </text>
          ) : null}
        </svg>
      )}
    </Card>
  );
}

export function OpportunityInbox({
  opportunities,
  selectedIds,
  onToggleCompare,
  onDisposition,
  onStartApplication
}: {
  opportunities: JobOpportunity[];
  selectedIds: Set<string>;
  onToggleCompare: (id: string) => void;
  onDisposition: (
    opportunity: JobOpportunity,
    disposition: "shortlisted" | "rejected_by_user"
  ) => void;
  onStartApplication: (id: string) => void;
}) {
  if (opportunities.length === 0)
    return (
      <EmptyState
        eyebrow="Roles to review"
        title="No roles yet"
        description="Add a role from a reliable source, or let an agent with permission add one. A role can be evaluated against more than one job search."
      />
    );
  return (
    <div className="grid gap-3">
      {opportunities.map((opportunity) => {
        const evaluation = opportunity.evaluations?.[0] as
          | WorkRecord
          | undefined;
        return (
          <Card
            key={opportunity.id}
            className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <WorkStatusBadge status={opportunity.disposition} />
                <WorkStatusBadge status={opportunity.availabilityStatus} />
                {evaluation?.overallScore !== undefined ? (
                  <Badge tone="signal">
                    {String(evaluation.overallScore)} / 100 fit
                  </Badge>
                ) : (
                  <Badge tone="meta">Not evaluated</Badge>
                )}
                {evaluation?.hardGateResult ? (
                  <Badge
                    tone={
                      evaluation.hardGateResult === "pass" ? "signal" : "meta"
                    }
                  >
                    <ShieldCheck className="mr-1 size-3" />
                    Hard gates {String(evaluation.hardGateResult)}
                  </Badge>
                ) : null}
              </div>
              <Link
                to={`/work/opportunities/${encodeURIComponent(opportunity.id)}`}
                className="mt-2 inline-flex items-center gap-2 text-base font-semibold text-[var(--ui-ink-strong)] hover:text-[var(--primary)]"
              >
                {opportunity.title}
                <ChevronRight className="size-4" />
              </Link>
              <p className="mt-1 text-sm text-[var(--ui-ink-soft)]">
                {opportunity.employerName || "Employer unknown"} ·{" "}
                {readable(opportunity.workModel)} ·{" "}
                {opportunity.applicationDeadline
                  ? `Apply by ${formatDate(opportunity.applicationDeadline)}`
                  : "No deadline found"}
              </p>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--ui-ink-soft)]">
                <span className="inline-flex items-center gap-1">
                  <FileQuestion className="size-3.5" />
                  {opportunity.unknowns?.length ?? 0} unknowns
                </span>
                <span className="inline-flex items-center gap-1">
                  <AlertTriangle className="size-3.5" />
                  {opportunity.redFlags?.length ?? 0} red flags
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock3 className="size-3.5" />
                  {opportunity.lastCheckedAt
                    ? `Checked ${formatDate(opportunity.lastCheckedAt)}`
                    : "Freshness unknown"}
                </span>
                {opportunity.canonicalUrl ? (
                  <a
                    href={opportunity.canonicalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[var(--primary)] hover:underline"
                  >
                    Source <ExternalLink className="size-3" />
                  </a>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 lg:max-w-[25rem] lg:justify-end">
              <Button
                variant={
                  selectedIds.has(opportunity.id) ? "primary" : "secondary"
                }
                size="sm"
                onClick={() => onToggleCompare(opportunity.id)}
              >
                {selectedIds.has(opportunity.id) ? (
                  <Check className="size-3.5" />
                ) : null}
                Compare
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onDisposition(opportunity, "rejected_by_user")}
              >
                Reject
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onDisposition(opportunity, "shortlisted")}
              >
                Shortlist
              </Button>
              <Button
                size="sm"
                onClick={() => onStartApplication(opportunity.id)}
              >
                Start application
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export function OpportunityComparison({
  opportunities,
  onClear
}: {
  opportunities: JobOpportunity[];
  onClear: () => void;
}) {
  if (opportunities.length < 2) return null;
  const latestEvaluation = (item: JobOpportunity) =>
    item.evaluations?.[0] as WorkRecord | undefined;
  const rows: Array<[string, (opportunity: JobOpportunity) => ReactNode]> = [
    ["Employer", (item) => item.employerName || "Unknown"],
    [
      "Fit score",
      (item) =>
        latestEvaluation(item)?.overallScore == null
          ? "Not evaluated"
          : `${String(latestEvaluation(item)?.overallScore)} / 100`
    ],
    [
      "Hard gates",
      (item) =>
        readable(latestEvaluation(item)?.hardGateResult, "Not evaluated")
    ],
    [
      "Evaluation confidence",
      (item) =>
        latestEvaluation(item)?.confidence == null
          ? "Unknown"
          : `${Math.round(Number(latestEvaluation(item)?.confidence) * 100)}%`
    ],
    [
      "Evaluation gaps",
      (item) =>
        Array.isArray(latestEvaluation(item)?.gaps)
          ? (latestEvaluation(item)?.gaps as unknown[]).length
          : 0
    ],
    ["Work model", (item) => readable(item.workModel)],
    ["Employment type", (item) => readable(item.employmentType)],
    ["Deadline", (item) => formatDate(item.applicationDeadline, "Unknown")],
    ["Unknown facts", (item) => item.unknowns?.length ?? 0],
    ["Red flags", (item) => item.redFlags?.length ?? 0],
    [
      "Excitement",
      (item) => (item.excitement ? `${item.excitement} / 5` : "Not rated")
    ],
    ["Next action", (item) => item.nextAction || "Not set"]
  ];
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--ui-border-subtle)] px-4 py-3">
        <div>
          <h3 className="font-semibold text-[var(--ui-ink-strong)]">
            Compare roles
          </h3>
          <p className="text-xs text-[var(--ui-ink-soft)]">
            Facts and explicit unknowns only; no missing value is treated as
            equivalent.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
          <thead>
            <tr>
              <th className="w-40 border-b border-[var(--ui-border-subtle)] p-3 text-xs text-[var(--ui-ink-faint)]">
                Field
              </th>
              {opportunities.map((opportunity) => (
                <th
                  key={opportunity.id}
                  className="border-b border-[var(--ui-border-subtle)] p-3 font-semibold text-[var(--ui-ink-strong)]"
                >
                  {opportunity.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, getter]) => (
              <tr key={label}>
                <th className="border-b border-[var(--ui-border-subtle)] p-3 text-xs font-medium text-[var(--ui-ink-faint)]">
                  {label}
                </th>
                {opportunities.map((opportunity) => (
                  <td
                    key={opportunity.id}
                    className="border-b border-[var(--ui-border-subtle)] p-3 align-top text-[var(--ui-ink-medium)]"
                  >
                    {getter(opportunity)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const PIPELINE_COLUMNS = [
  {
    id: "preparing",
    label: "Preparing",
    statuses: ["planned", "preparing", "blocked_on_user_input"]
  },
  {
    id: "ready",
    label: "Ready",
    statuses: ["ready_for_review", "ready_to_submit"]
  },
  {
    id: "submitted",
    label: "Submitted",
    statuses: ["submitted", "acknowledged", "screening"]
  },
  {
    id: "interviewing",
    label: "Interviewing",
    statuses: ["interviewing", "assessment", "references", "offer"]
  },
  {
    id: "closed",
    label: "Outcome",
    statuses: [
      "accepted",
      "declined_by_candidate",
      "withdrawn",
      "rejected",
      "ghosted",
      "closed"
    ]
  }
] as const;

export function ApplicationPipeline({
  applications,
  opportunities
}: {
  applications: JobApplication[];
  opportunities: JobOpportunity[];
}) {
  const [selectedColumn, setSelectedColumn] = useState(
    PIPELINE_COLUMNS.find((column) =>
      applications.some((application) =>
        (column.statuses as readonly string[]).includes(application.status)
      )
    )?.id ?? PIPELINE_COLUMNS[0].id
  );
  const [wide, setWide] = useState(() =>
    typeof window === "undefined" || typeof window.matchMedia !== "function"
      ? false
      : window.matchMedia("(min-width: 1280px)").matches
  );
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    )
      return;
    const media = window.matchMedia("(min-width: 1280px)");
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const opportunityById = useMemo(
    () =>
      new Map(
        opportunities.map((opportunity) => [opportunity.id, opportunity])
      ),
    [opportunities]
  );
  const visibleColumns = wide
    ? PIPELINE_COLUMNS
    : PIPELINE_COLUMNS.filter((column) => column.id === selectedColumn);
  return (
    <div className="grid min-w-0 gap-3" aria-label="Application pipeline">
      {!wide ? (
        <label className="grid gap-1 text-xs font-medium text-[var(--ui-ink-soft)]">
          Pipeline stage
          <select
            value={selectedColumn}
            onChange={(event) =>
              setSelectedColumn(
                event.target.value as (typeof PIPELINE_COLUMNS)[number]["id"]
              )
            }
            className="min-h-11 w-full rounded-[14px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-sm font-medium text-[var(--ui-ink-strong)]"
          >
            {PIPELINE_COLUMNS.map((column) => {
              const count = applications.filter((application) =>
                (column.statuses as readonly string[]).includes(
                  application.status
                )
              ).length;
              return (
                <option key={column.id} value={column.id}>
                  {column.label} ({count})
                </option>
              );
            })}
          </select>
        </label>
      ) : null}
      <div className={cn("grid min-w-0 gap-3", wide && "grid-cols-5")}>
        {visibleColumns.map((column) => {
          const items = applications.filter((application) =>
            (column.statuses as readonly string[]).includes(application.status)
          );
          return (
            <section
              key={column.id}
              className="min-w-0 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3"
              aria-labelledby={`pipeline-${column.id}`}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3
                  id={`pipeline-${column.id}`}
                  className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ui-ink-soft)]"
                >
                  {column.label}
                </h3>
                <Badge size="xs" tone="meta">
                  {items.length}
                </Badge>
              </div>
              <div className="grid gap-2">
                {items.map((application) => {
                  const opportunity = opportunityById.get(
                    application.opportunityId
                  );
                  return (
                    <Link
                      key={application.id}
                      to={`/work/applications/${encodeURIComponent(application.id)}`}
                      className="rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3 transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]"
                    >
                      <div className="line-clamp-2 text-sm font-medium text-[var(--ui-ink-strong)]">
                        {opportunity?.title ?? "Application"}
                      </div>
                      <div className="mt-1 truncate text-xs text-[var(--ui-ink-soft)]">
                        {opportunity?.employerName ||
                          readable(application.status)}
                      </div>
                      {application.nextFollowUpAt ? (
                        <div className="mt-2 flex items-center gap-1 text-[10px] text-[var(--ui-ink-faint)]">
                          <CalendarClock className="size-3" />
                          {formatDate(application.nextFollowUpAt)}
                        </div>
                      ) : null}
                    </Link>
                  );
                })}
                {items.length === 0 ? (
                  <div className="rounded-[14px] border border-dashed border-[var(--ui-border-subtle)] px-2 py-5 text-center text-xs text-[var(--ui-ink-faint)]">
                    No applications
                  </div>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function NextActions({
  engagements,
  campaigns,
  applications,
  opportunities
}: {
  engagements: WorkEngagement[];
  campaigns: OpportunityCampaign[];
  applications: JobApplication[];
  opportunities: JobOpportunity[];
}) {
  const opportunityById = new Map(
    opportunities.map((opportunity) => [opportunity.id, opportunity])
  );
  const actions = [
    ...engagements.flatMap((engagement) =>
      engagement.nextAction
        ? [
            {
              id: `engagement-${engagement.id}`,
              label: engagement.nextAction,
              context: engagement.title,
              href: `/work/engagements/${engagement.id}`,
              urgency: engagement.contractDeadline ?? engagement.renewalDate
            }
          ]
        : []
    ),
    ...campaigns.flatMap((campaign) =>
      campaign.nextAction
        ? [
            {
              id: `campaign-${campaign.id}`,
              label: campaign.nextAction,
              context: campaign.title,
              href: `/work/campaigns/${campaign.id}`,
              urgency: campaign.searchDeadline
            }
          ]
        : []
    ),
    ...applications.flatMap((application) =>
      application.nextAction
        ? [
            {
              id: `application-${application.id}`,
              label: application.nextAction,
              context:
                opportunityById.get(application.opportunityId)?.title ??
                "Application",
              href: `/work/applications/${application.id}`,
              urgency:
                application.nextFollowUpAt ?? application.decisionDeadline
            }
          ]
        : []
    )
  ]
    .sort((left, right) =>
      String(left.urgency ?? "9999").localeCompare(
        String(right.urgency ?? "9999")
      )
    )
    .slice(0, 5);
  if (actions.length === 0)
    return (
      <EmptyState
        title="No next actions recorded"
        description="Add a next action to a role, job search, or application so Work can show what deserves attention."
      />
    );
  return (
    <Card className="p-0">
      <div className="border-b border-[var(--ui-border-subtle)] px-4 py-3">
        <h2 className="font-semibold text-[var(--ui-ink-strong)]">
          What needs attention next
        </h2>
      </div>
      <ol className="divide-y divide-[var(--ui-border-subtle)]">
        {actions.map((action) => (
          <li key={action.id}>
            <Link
              to={action.href}
              className="flex min-w-0 items-center gap-3 px-4 py-3 transition hover:bg-[var(--ui-surface-hover)]"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--ui-accent-soft)] text-[var(--primary)]">
                <ArrowRight className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 break-words text-sm font-medium text-[var(--ui-ink-strong)]">
                  {action.label}
                </span>
                <span className="line-clamp-1 break-words text-xs text-[var(--ui-ink-soft)]">
                  {action.context}
                </span>
              </span>
              {action.urgency ? (
                <Badge tone="meta" size="xs">
                  {formatDate(action.urgency)}
                </Badge>
              ) : null}
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function EvidenceList({
  title,
  items,
  empty = "None recorded",
  tone = "normal"
}: {
  title: string;
  items: unknown;
  empty?: string;
  tone?: "normal" | "warning" | "positive";
}) {
  const values = Array.isArray(items) ? items.map(String).filter(Boolean) : [];
  return (
    <section className="min-w-0">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
        {title}
      </h3>
      {values.length ? (
        <ul className="mt-2 grid gap-2">
          {values.map((value, index) => (
            <li
              key={`${value}-${index}`}
              className={cn(
                "rounded-[15px] border px-3 py-2 text-sm leading-5",
                tone === "warning"
                  ? "border-[color-mix(in_srgb,var(--danger)_25%,var(--ui-border-subtle))] bg-[color-mix(in_srgb,var(--danger)_6%,var(--ui-surface-1))] text-[var(--ui-ink-medium)]"
                  : tone === "positive"
                    ? "border-[color-mix(in_srgb,var(--success)_25%,var(--ui-border-subtle))] bg-[color-mix(in_srgb,var(--success)_6%,var(--ui-surface-1))] text-[var(--ui-ink-medium)]"
                    : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]"
              )}
            >
              {value}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-[var(--ui-ink-faint)]">{empty}</p>
      )}
    </section>
  );
}

export function SourceFreshness({
  opportunity
}: {
  opportunity: JobOpportunity;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--ui-ink-soft)]">
      <span className="inline-flex items-center gap-1">
        <Sparkles className="size-3.5" />
        First seen {formatDate(opportunity.firstSeenAt)}
      </span>
      <span className="inline-flex items-center gap-1">
        <Clock3 className="size-3.5" />
        Last checked {formatDate(opportunity.lastCheckedAt, "not recorded")}
      </span>
      {opportunity.canonicalUrl ? (
        <a
          href={opportunity.canonicalUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[var(--primary)]"
        >
          Open source <ExternalLink className="size-3" />
        </a>
      ) : null}
    </div>
  );
}
