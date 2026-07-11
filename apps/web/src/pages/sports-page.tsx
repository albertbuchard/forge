import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  ArrowRight,
  CalendarDays,
  Dumbbell,
  HeartPulse,
  Save
} from "lucide-react";
import { EntityLinkMultiSelect } from "@/components/psyche/entity-link-multiselect";
import { SportComparisonPanel } from "@/components/sports/sport-comparison-panel";
import {
  FacetedTokenSearch,
  type FacetedTokenOption
} from "@/components/search/faceted-token-search";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import {
  SportsBrowserBox,
  SportsCompositionBox,
  SportsSummaryBox
} from "@/components/workbench-boxes/health/health-boxes";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { ErrorState } from "@/components/ui/page-state";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SheetScaffold } from "@/components/experience/sheet-scaffold";
import {
  getFitnessView,
  getWorkoutSession,
  listBehaviors,
  listBehaviorPatterns,
  listBeliefs,
  listPsycheValues,
  listTriggerReports,
  patchWorkoutSession
} from "@/lib/api";
import { formatLocalDateKey } from "@/lib/date-keys";
import {
  buildHealthEntityLinkOptions,
  parseHealthLinkValues
} from "@/lib/health-link-options";
import type {
  FitnessViewData,
  WorkoutAnalysisSessionRecord,
  WorkoutSessionRecord,
  WorkoutSessionSummaryRecord
} from "@/lib/types";

type WorkoutSessionListRecord =
  | WorkoutSessionRecord
  | WorkoutSessionSummaryRecord;

type WorkoutAnalysisListRecord =
  | WorkoutSessionListRecord
  | WorkoutAnalysisSessionRecord;

type WorkoutLabelRecord = Pick<
  WorkoutAnalysisListRecord,
  "workoutType" | "workoutTypeLabel" | "activityFamily" | "activityFamilyLabel"
>;

type WorkoutDraft = {
  subjectiveEffort: string;
  moodBefore: string;
  moodAfter: string;
  meaningText: string;
  plannedContext: string;
  socialContext: string;
  tagsText: string;
  linkValues: string[];
};

function ChartViewport({
  className,
  children
}: {
  className: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const update = () => {
      const node = ref.current;
      setReady(Boolean(node && node.clientWidth > 0 && node.clientHeight > 0));
    };
    const frame = window.requestAnimationFrame(update);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (ref.current && observer) {
      observer.observe(ref.current);
    }
    window.addEventListener("resize", update);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div ref={ref} className={className}>
      {ready ? children : null}
    </div>
  );
}

const ZONE_COLORS: Record<string, string> = {
  below_z1: "var(--chart-zone-below)",
  zone_1: "var(--chart-zone-1)",
  zone_2: "var(--chart-zone-2)",
  zone_3: "var(--chart-zone-3)",
  zone_4: "var(--chart-zone-4)",
  zone_5: "var(--chart-zone-5)"
};

const ZONE_ORDER = [
  "below_z1",
  "zone_1",
  "zone_2",
  "zone_3",
  "zone_4",
  "zone_5"
] as const;

type ZoneKey = (typeof ZONE_ORDER)[number];

type ZoneTrendPoint = Record<ZoneKey, number> & {
  id: string;
  dateKey: string;
  date: string;
  session: string;
  durationMinutes: number;
  confidence: string;
  restingHeartRate: number | null;
  vo2Max: number | null;
};

type AnalysisDateMode = "all" | "recent_90" | "custom";
type ZoneAnalysisChartMode = "rolling_stack" | "expanding_lines";

function humanizeToken(value: string | null | undefined) {
  if (!value) {
    return "Unknown";
  }
  return value
    .replace(/^activity_/i, "")
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function minutesLabel(seconds: number) {
  return `${Math.round(seconds / 60)}m`;
}

function kilometersLabel(distanceMeters: number | null) {
  if (!distanceMeters) {
    return "n/a";
  }
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

function formatWorkoutWindow(startedAt: string, endedAt: string) {
  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short"
  });
  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  });
  return `${dateFormatter.format(new Date(startedAt))} · ${timeFormatter.format(new Date(startedAt))} - ${timeFormatter.format(new Date(endedAt))}`;
}

function dateKeyFromIso(value: string) {
  return formatLocalDateKey(new Date(value));
}

function buildWorkoutDraft(session: WorkoutSessionListRecord): WorkoutDraft {
  return {
    subjectiveEffort:
      session.subjectiveEffort !== null ? String(session.subjectiveEffort) : "",
    moodBefore: session.moodBefore ?? "",
    moodAfter: session.moodAfter ?? "",
    meaningText: session.meaningText ?? "",
    plannedContext: session.plannedContext ?? "",
    socialContext: session.socialContext ?? "",
    tagsText: Array.isArray(session.tags) ? session.tags.join(", ") : "",
    linkValues: Array.isArray(session.links)
      ? session.links.map((link) => `${link.entityType}:${link.entityId}`)
      : []
  };
}

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function workoutTypeLabel(session: WorkoutLabelRecord) {
  return session.workoutTypeLabel?.trim() || humanizeToken(session.workoutType);
}

function activityFamilyLabel(session: WorkoutLabelRecord) {
  return (
    session.activityFamilyLabel?.trim() || humanizeToken(session.activityFamily)
  );
}

function sourceSystemLabel(session: WorkoutSessionListRecord) {
  return humanizeToken(session.sourceSystem ?? session.source);
}

function formatScalarValue(
  value: string | number | boolean | null | undefined
) {
  if (value == null) {
    return "n/a";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }
  return value;
}

function formatWorkoutMetric(metric: {
  value: string | number | boolean | null;
  unit: string;
}) {
  const base = formatScalarValue(metric.value);
  if (!metric.unit || metric.unit === "count") {
    return base;
  }
  return `${base} ${metric.unit}`;
}

function buildWorkoutSearchText(
  session: WorkoutSessionListRecord,
  draft: WorkoutDraft
) {
  return normalize(
    [
      session.workoutType,
      workoutTypeLabel(session),
      session.activityFamily,
      activityFamilyLabel(session),
      session.sourceSystem,
      sourceSystemLabel(session),
      session.sourceType,
      session.sourceDevice,
      session.reconciliationStatus,
      session.moodBefore,
      session.moodAfter,
      session.meaningText,
      session.plannedContext,
      session.socialContext,
      session.tags.join(" "),
      draft.moodBefore,
      draft.moodAfter,
      draft.meaningText,
      draft.plannedContext,
      draft.socialContext,
      draft.tagsText,
      formatWorkoutWindow(session.startedAt, session.endedAt)
    ].join(" ")
  );
}

function createWorkoutFilterOptions(
  sessions: WorkoutSessionListRecord[]
): FacetedTokenOption[] {
  const options = new Map<string, FacetedTokenOption>();

  for (const session of sessions) {
    options.set(`workout:${session.workoutType}`, {
      id: `workout:${session.workoutType}`,
      label: workoutTypeLabel(session),
      description: "Workout type",
      searchText: `${workoutTypeLabel(session)} workout`,
      badge: <Badge tone="meta">{workoutTypeLabel(session)}</Badge>
    });
    options.set(`source:${session.sourceType}`, {
      id: `source:${session.sourceType}`,
      label: session.sourceType.replaceAll("_", " "),
      description: "Source type",
      searchText: `${session.sourceType} source`,
      badge: (
        <Badge tone="meta" className="capitalize">
          {session.sourceType.replaceAll("_", " ")}
        </Badge>
      )
    });
    options.set(`status:${session.reconciliationStatus}`, {
      id: `status:${session.reconciliationStatus}`,
      label: session.reconciliationStatus.replaceAll("_", " "),
      description: "Reconciliation status",
      searchText: `${session.reconciliationStatus} status`,
      badge: (
        <Badge tone="meta" className="capitalize">
          {session.reconciliationStatus.replaceAll("_", " ")}
        </Badge>
      )
    });
  }

  options.set("linked:yes", {
    id: "linked:yes",
    label: "Linked",
    description: "Already tied to Forge or Psyche context",
    badge: <Badge tone="meta">Linked</Badge>
  });
  options.set("linked:no", {
    id: "linked:no",
    label: "Needs links",
    description: "No Forge or Psyche links yet",
    badge: <Badge tone="meta">Needs links</Badge>
  });
  options.set("habit:yes", {
    id: "habit:yes",
    label: "Habit-generated",
    description: "Created from a habit completion",
    badge: <Badge tone="meta">Habit-generated</Badge>
  });
  options.set("effort:rated", {
    id: "effort:rated",
    label: "Effort rated",
    description: "Already has a subjective effort score",
    badge: <Badge tone="meta">Effort rated</Badge>
  });

  return Array.from(options.values());
}

function matchesWorkoutFilters(
  session: WorkoutSessionListRecord,
  selectedFilterIds: string[]
) {
  return selectedFilterIds.every((filterId) => {
    if (filterId.startsWith("workout:")) {
      return session.workoutType === filterId.slice("workout:".length);
    }
    if (filterId.startsWith("source:")) {
      return session.sourceType === filterId.slice("source:".length);
    }
    if (filterId.startsWith("status:")) {
      return session.reconciliationStatus === filterId.slice("status:".length);
    }
    if (filterId === "linked:yes") {
      return session.links.length > 0;
    }
    if (filterId === "linked:no") {
      return session.links.length === 0;
    }
    if (filterId === "habit:yes") {
      return Boolean(session.generatedFromHabitId);
    }
    if (filterId === "effort:rated") {
      return session.subjectiveEffort !== null;
    }
    return true;
  });
}

function getVitalOnOrBefore(
  vitals: FitnessViewData["vitalsTrend"] | undefined,
  dateKey: string,
  metric: "restingHeartRate" | "vo2Max"
) {
  if (!vitals || vitals.length === 0) {
    return null;
  }
  const exactOrEarlier = [...vitals]
    .filter((entry) => entry.dateKey <= dateKey && entry[metric] != null)
    .sort((left, right) => right.dateKey.localeCompare(left.dateKey))[0];
  return exactOrEarlier?.[metric] ?? null;
}

function isKickboxingSession(session: WorkoutAnalysisListRecord) {
  return [
    session.workoutType,
    session.workoutTypeLabel,
    session.activityFamily,
    session.activityFamilyLabel
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes("kickboxing");
}

function createExerciseTypeOptions(
  sessions: WorkoutAnalysisListRecord[]
): FacetedTokenOption[] {
  const options = new Map<string, FacetedTokenOption>();
  for (const session of sessions) {
    const id = `type:${session.workoutType}`;
    options.set(id, {
      id,
      label: workoutTypeLabel(session),
      description: activityFamilyLabel(session),
      searchText: `${workoutTypeLabel(session)} ${activityFamilyLabel(session)} ${session.workoutType}`,
      badge: <Badge tone="meta">{workoutTypeLabel(session)}</Badge>
    });
  }
  return [...options.values()].sort((left, right) =>
    left.label.localeCompare(right.label)
  );
}

function filterAnalysisSessions(
  sessions: WorkoutAnalysisListRecord[],
  selectedExerciseTypeIds: string[],
  dateMode: AnalysisDateMode,
  startDate: string,
  endDate: string
) {
  const selectedWorkoutTypes = selectedExerciseTypeIds
    .filter((id) => id.startsWith("type:"))
    .map((id) => id.slice("type:".length));
  const selectedSet = new Set(selectedWorkoutTypes);
  const today = dateKeyFromIso(new Date().toISOString());
  const recentThreshold = new Date(`${today}T12:00:00.000Z`);
  recentThreshold.setUTCDate(recentThreshold.getUTCDate() - 90);
  const recentStart = recentThreshold.toISOString().slice(0, 10);

  return sessions
    .filter((session) => {
      if (selectedSet.size > 0 && !selectedSet.has(session.workoutType)) {
        return false;
      }
      const dateKey = dateKeyFromIso(session.startedAt);
      if (dateMode === "recent_90") {
        return dateKey >= recentStart;
      }
      if (dateMode === "custom") {
        if (startDate && dateKey < startDate) {
          return false;
        }
        if (endDate && dateKey > endDate) {
          return false;
        }
      }
      return true;
    })
    .sort(
      (left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt)
    );
}

function zoneTotalsForSessions(sessions: WorkoutAnalysisListRecord[]) {
  const totals = Object.fromEntries(
    ZONE_ORDER.map((zoneKey) => [zoneKey, 0])
  ) as Record<ZoneKey, number>;
  for (const session of sessions) {
    for (const zone of session.analytics?.zoneDurations ?? []) {
      if (ZONE_ORDER.includes(zone.key as ZoneKey)) {
        totals[zone.key as ZoneKey] += zone.seconds;
      }
    }
  }
  return totals;
}

function zonePercentagesFromTotals(totals: Record<ZoneKey, number>) {
  const totalSeconds = Object.values(totals).reduce(
    (sum, seconds) => sum + seconds,
    0
  );
  return Object.fromEntries(
    ZONE_ORDER.map((zoneKey) => [
      zoneKey,
      totalSeconds > 0
        ? Number(((totals[zoneKey] / totalSeconds) * 100).toFixed(1))
        : 0
    ])
  ) as Record<ZoneKey, number>;
}

export function formatZoneTrendTooltipValue(
  value: unknown,
  name: unknown,
  item?: { dataKey?: unknown }
): [string, string] {
  const dataKey =
    typeof item?.dataKey === "string"
      ? item.dataKey
      : typeof name === "string"
        ? name
        : "";
  const formattedValue =
    typeof value === "number"
      ? Number(value.toFixed(1))
      : String(value ?? "n/a");

  if (dataKey === "restingHeartRate" || name === "Resting HR") {
    return [`${formattedValue} bpm`, "Resting HR"];
  }
  if (dataKey === "vo2Max" || name === "VO2max") {
    return [`${formattedValue} ml/kg/min`, "VO2max"];
  }
  return [`${formattedValue}%`, humanizeToken(dataKey)];
}

function buildZoneAnalysisView(
  sessions: WorkoutAnalysisListRecord[],
  vitalsTrend: FitnessViewData["vitalsTrend"] | undefined
) {
  const lineData = sessions.map((session, index): ZoneTrendPoint => {
    const dateKey = dateKeyFromIso(session.startedAt);
    const rollingWindow = sessions.slice(Math.max(0, index - 2), index + 1);
    const rollingTotals = zoneTotalsForSessions(rollingWindow);
    const zonePercentages = zonePercentagesFromTotals(rollingTotals);
    return {
      id: session.id,
      dateKey,
      date: dateKey.slice(5),
      session: workoutTypeLabel(session),
      durationMinutes: Math.round(session.durationSeconds / 60),
      confidence: session.analytics?.confidence ?? "unavailable",
      restingHeartRate:
        session.analytics?.hrSummary?.restingHr ??
        getVitalOnOrBefore(vitalsTrend, dateKey, "restingHeartRate"),
      vo2Max: getVitalOnOrBefore(vitalsTrend, dateKey, "vo2Max"),
      ...zonePercentages
    };
  });

  const expandingLineData = sessions.map((session, index): ZoneTrendPoint => {
    const dateKey = dateKeyFromIso(session.startedAt);
    const expandingTotals = zoneTotalsForSessions(sessions.slice(0, index + 1));
    const zonePercentages = zonePercentagesFromTotals(expandingTotals);
    return {
      id: session.id,
      dateKey,
      date: dateKey.slice(5),
      session: workoutTypeLabel(session),
      durationMinutes: Math.round(session.durationSeconds / 60),
      confidence: session.analytics?.confidence ?? "unavailable",
      restingHeartRate:
        session.analytics?.hrSummary?.restingHr ??
        getVitalOnOrBefore(vitalsTrend, dateKey, "restingHeartRate"),
      vo2Max: getVitalOnOrBefore(vitalsTrend, dateKey, "vo2Max"),
      ...zonePercentages
    };
  });

  const allTotals = zoneTotalsForSessions(sessions);
  const allZoneSeconds = Object.values(allTotals).reduce(
    (sum, seconds) => sum + seconds,
    0
  );
  const averageZoneData = ZONE_ORDER.map((zoneKey) => {
    const label =
      sessions
        .flatMap((session) => session.analytics?.zoneDurations ?? [])
        .find((zone) => zone.key === zoneKey)?.label ?? humanizeToken(zoneKey);
    return {
      key: zoneKey,
      zone: label,
      percentage:
        allZoneSeconds > 0
          ? Number(((allTotals[zoneKey] / allZoneSeconds) * 100).toFixed(1))
          : 0,
      fill: ZONE_COLORS[zoneKey] ?? "var(--ui-ink-strong)"
    };
  });

  const rawHrCount = sessions.filter(
    (session) => (session.analytics?.dataQuality?.heartRateSampleCount ?? 0) > 0
  ).length;
  const exerciseLabels = [
    ...new Set(sessions.map((session) => workoutTypeLabel(session)))
  ];

  return {
    sessions,
    lineData,
    expandingLineData,
    averageZoneData,
    rawHrCount,
    exerciseLabels
  };
}

function SportsSessionEditor({
  session,
  draft,
  linkOptions,
  pending,
  step,
  onStepChange,
  onDraftChange,
  onSave
}: {
  session: WorkoutSessionRecord;
  draft: WorkoutDraft;
  linkOptions: ReturnType<typeof buildHealthEntityLinkOptions>;
  pending: boolean;
  step: number;
  onStepChange: (next: number) => void;
  onDraftChange: (patch: Partial<WorkoutDraft>) => void;
  onSave: () => void;
}) {
  const steps = [
    {
      id: "context",
      title: "Session context",
      description: "Quick facts, effort, and how this session happened."
    },
    {
      id: "reflection",
      title: "Reflection",
      description: "Mood, meaning, and what the session actually did for you."
    },
    {
      id: "links",
      title: "Links",
      description: "Tie the session back to Forge and Psyche context."
    }
  ] as const;

  return (
    <div className="grid gap-5">
      <div className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-lg text-[var(--ui-ink-strong)]">
              <Dumbbell className="size-4 text-[var(--primary)]" />
              <span>{workoutTypeLabel(session)}</span>
            </div>
            <div className="mt-2 text-sm text-[var(--ui-ink-soft)]">
              {formatWorkoutWindow(session.startedAt, session.endedAt)}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>{minutesLabel(session.durationSeconds)}</Badge>
            {session.totalEnergyKcal ? (
              <Badge tone="meta">
                {Math.round(session.totalEnergyKcal)} kcal
              </Badge>
            ) : null}
            {session.distanceMeters ? (
              <Badge tone="meta">
                {kilometersLabel(session.distanceMeters)}
              </Badge>
            ) : null}
            <Badge tone="meta">{activityFamilyLabel(session)}</Badge>
            <Badge tone="meta" className="capitalize">
              {session.reconciliationStatus.replaceAll("_", " ")}
            </Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {steps.map((entry, index) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => onStepChange(index)}
            className={`rounded-[20px] border px-4 py-3 text-left transition ${
              step === index
                ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--ui-ink-strong)]"
                : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-ink-strong)]"
            }`}
          >
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
              Step {index + 1}
            </div>
            <div className="mt-2 text-sm font-medium">{entry.title}</div>
          </button>
        ))}
      </div>

      <div className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
        <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
          {steps[step]!.title}
        </div>
        <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
          {steps[step]!.description}
        </div>

        {step === 0 ? (
          <div className="mt-4 grid gap-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                <div className="text-sm text-[var(--ui-ink-soft)]">
                  Activity family
                </div>
                <div className="mt-2 text-lg text-[var(--ui-ink-strong)] capitalize">
                  {activityFamilyLabel(session)}
                </div>
              </div>
              <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                <div className="text-sm text-[var(--ui-ink-soft)]">
                  Source system
                </div>
                <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                  {sourceSystemLabel(session)}
                </div>
              </div>
              <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                <div className="text-sm text-[var(--ui-ink-soft)]">
                  Source device
                </div>
                <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                  {session.sourceDevice || "n/a"}
                </div>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                <div className="text-sm text-[var(--ui-ink-soft)]">Steps</div>
                <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                  {session.stepCount ?? "n/a"}
                </div>
              </div>
              <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                <div className="text-sm text-[var(--ui-ink-soft)]">Avg HR</div>
                <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                  {session.averageHeartRate
                    ? Math.round(session.averageHeartRate)
                    : "n/a"}
                </div>
              </div>
              <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                <div className="text-sm text-[var(--ui-ink-soft)]">Max HR</div>
                <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                  {session.maxHeartRate
                    ? Math.round(session.maxHeartRate)
                    : "n/a"}
                </div>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="grid gap-2">
                <span className="text-sm text-[var(--ui-ink-soft)]">
                  Effort
                </span>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={draft.subjectiveEffort}
                  onChange={(event) =>
                    onDraftChange({ subjectiveEffort: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm text-[var(--ui-ink-soft)]">
                  Planned vs spontaneous
                </span>
                <Input
                  value={draft.plannedContext}
                  onChange={(event) =>
                    onDraftChange({ plannedContext: event.target.value })
                  }
                  placeholder="Planned recovery block"
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm text-[var(--ui-ink-soft)]">
                  Social context
                </span>
                <Input
                  value={draft.socialContext}
                  onChange={(event) =>
                    onDraftChange({ socialContext: event.target.value })
                  }
                  placeholder="Solo, coach, group class, partner"
                />
              </label>
            </div>
            <label className="grid gap-2">
              <span className="text-sm text-[var(--ui-ink-soft)]">Tags</span>
              <Input
                value={draft.tagsText}
                onChange={(event) =>
                  onDraftChange({ tagsText: event.target.value })
                }
                placeholder="recovery, interval-block, stress-release"
              />
            </label>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="mt-4 grid gap-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm text-[var(--ui-ink-soft)]">
                  Mood before
                </span>
                <Input
                  value={draft.moodBefore}
                  onChange={(event) =>
                    onDraftChange({ moodBefore: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm text-[var(--ui-ink-soft)]">
                  Mood after
                </span>
                <Input
                  value={draft.moodAfter}
                  onChange={(event) =>
                    onDraftChange({ moodAfter: event.target.value })
                  }
                />
              </label>
            </div>
            <label className="grid gap-2">
              <span className="text-sm text-[var(--ui-ink-soft)]">
                Meaning, impact, and why this session mattered
              </span>
              <Textarea
                className="min-h-[160px]"
                value={draft.meaningText}
                onChange={(event) =>
                  onDraftChange({ meaningText: event.target.value })
                }
                placeholder="This session was planned as active recovery after a heavy work block and helped reset stress before sleep."
              />
            </label>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="mt-4 grid gap-3">
            <div className="text-sm text-[var(--ui-ink-soft)]">
              Search goals, projects, habits, values, beliefs, patterns, or
              reports and attach the ones that explain this session.
            </div>
            <EntityLinkMultiSelect
              options={linkOptions}
              selectedValues={draft.linkValues}
              onChange={(linkValues) => onDraftChange({ linkValues })}
              placeholder="Search Forge and Psyche records…"
            />
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 border-t border-[var(--ui-border-subtle)] pt-5">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
              Captured data
            </div>
            <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
              Source-native workout metrics, events, and phases exposed through
              the adapter layer.
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(session.details?.metrics ?? []).slice(0, 12).map((metric) => (
              <div
                key={`${metric.category}:${metric.key}:${metric.statistic}`}
                className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4"
              >
                <div className="text-sm text-[var(--ui-ink-soft)]">
                  {metric.label}
                </div>
                <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                  {formatWorkoutMetric(metric)}
                </div>
                <div className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                  {humanizeToken(metric.category)} ·{" "}
                  {humanizeToken(metric.statistic)}
                </div>
              </div>
            ))}
            {(session.details?.metrics?.length ?? 0) === 0 ? (
              <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 text-sm text-[var(--ui-ink-faint)]">
                No provider metrics were captured for this session yet.
              </div>
            ) : null}
          </div>
          {(session.details?.events?.length ?? 0) > 0 ? (
            <div className="grid gap-3">
              <div className="text-sm text-[var(--ui-ink-soft)]">
                Workout events
              </div>
              <div className="grid gap-2">
                {session.details?.events.map((event, eventIndex) => (
                  <div
                    key={[
                      event.type,
                      event.startedAt,
                      event.endedAt ?? "",
                      event.durationSeconds,
                      eventIndex
                    ].join(":")}
                    className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[var(--ui-ink-strong)]">
                        {event.label}
                      </div>
                      <Badge tone="meta">
                        {minutesLabel(event.durationSeconds)}
                      </Badge>
                    </div>
                    <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
                      {formatWorkoutWindow(
                        event.startedAt,
                        event.endedAt ?? event.startedAt
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {(session.details?.components?.length ?? 0) > 0 ? (
            <div className="grid gap-3">
              <div className="text-sm text-[var(--ui-ink-soft)]">
                Workout phases
              </div>
              <div className="grid gap-2">
                {session.details?.components.map((component) => (
                  <div
                    key={component.externalUid}
                    className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[var(--ui-ink-strong)]">
                        {component.activity.canonicalLabel}
                      </div>
                      <Badge tone="meta">
                        {minutesLabel(component.durationSeconds)}
                      </Badge>
                    </div>
                    <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
                      {formatWorkoutWindow(
                        component.startedAt,
                        component.endedAt ?? component.startedAt
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-[var(--ui-ink-faint)]">
          {step < steps.length - 1
            ? "Move through the session one step at a time, then save when the context is clean."
            : "Everything is in place. Save the session metadata back into Forge."}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onStepChange(Math.max(0, step - 1))}
            disabled={step === 0}
          >
            Back
          </Button>
          {step < steps.length - 1 ? (
            <Button type="button" onClick={() => onStepChange(step + 1)}>
              Next
              <ArrowRight className="size-4" />
            </Button>
          ) : null}
          <Button
            type="button"
            pending={pending}
            pendingLabel="Saving"
            onClick={onSave}
          >
            <Save className="size-4" />
            Save session
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SportsPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const selectedUserIds = Array.isArray(shell.selectedUserIds)
    ? shell.selectedUserIds
    : [];
  const [drafts, setDrafts] = useState<Record<string, WorkoutDraft>>({});
  const [query, setQuery] = useState("");
  const [selectedFilterIds, setSelectedFilterIds] = useState<string[]>([]);
  const [selectedAnalysisExerciseIds, setSelectedAnalysisExerciseIds] =
    useState<string[]>([]);
  const [analysisExerciseQuery, setAnalysisExerciseQuery] = useState("");
  const [analysisDateMode, setAnalysisDateMode] =
    useState<AnalysisDateMode>("all");
  const [analysisZoneChartMode, setAnalysisZoneChartMode] =
    useState<ZoneAnalysisChartMode>("rolling_stack");
  const [analysisStartDate, setAnalysisStartDate] = useState("");
  const [analysisEndDate, setAnalysisEndDate] = useState("");
  const [analysisDefaultsApplied, setAnalysisDefaultsApplied] = useState(false);
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(
    null
  );
  const [editorStep, setEditorStep] = useState(0);
  const sessionListRef = useRef<HTMLDivElement | null>(null);

  const fitnessQuery = useQuery({
    queryKey: ["forge-fitness", ...selectedUserIds],
    queryFn: async () =>
      (
        await getFitnessView(selectedUserIds, {
          sessionDetail: "summary",
          analysisDetail: "compact"
        })
      ).fitness
  });
  const activeSessionQuery = useQuery({
    queryKey: ["forge-workout-session", selectedWorkoutId, ...selectedUserIds],
    queryFn: async () =>
      (await getWorkoutSession(selectedWorkoutId as string, selectedUserIds))
        .workout,
    enabled: Boolean(selectedWorkoutId)
  });
  const valuesQuery = useQuery({
    queryKey: ["forge-health-values", ...selectedUserIds],
    queryFn: async () => (await listPsycheValues(selectedUserIds)).values,
    enabled: Boolean(selectedWorkoutId)
  });
  const patternsQuery = useQuery({
    queryKey: ["forge-health-patterns", ...selectedUserIds],
    queryFn: async () => (await listBehaviorPatterns(selectedUserIds)).patterns,
    enabled: Boolean(selectedWorkoutId)
  });
  const behaviorsQuery = useQuery({
    queryKey: ["forge-health-behaviors", ...selectedUserIds],
    queryFn: async () => (await listBehaviors(selectedUserIds)).behaviors,
    enabled: Boolean(selectedWorkoutId)
  });
  const beliefsQuery = useQuery({
    queryKey: ["forge-health-beliefs", ...selectedUserIds],
    queryFn: async () => (await listBeliefs(selectedUserIds)).beliefs,
    enabled: Boolean(selectedWorkoutId)
  });
  const reportsQuery = useQuery({
    queryKey: ["forge-health-reports", ...selectedUserIds],
    queryFn: async () => (await listTriggerReports(selectedUserIds)).reports,
    enabled: Boolean(selectedWorkoutId)
  });

  useEffect(() => {
    if (analysisDefaultsApplied || !fitnessQuery.data) {
      return;
    }
    const analysisSessions =
      fitnessQuery.data.analysisSessions ?? fitnessQuery.data.sessions;
    const kickboxing = analysisSessions.find(isKickboxingSession);
    if (kickboxing) {
      setSelectedAnalysisExerciseIds([`type:${kickboxing.workoutType}`]);
    }
    setAnalysisDefaultsApplied(true);
  }, [analysisDefaultsApplied, fitnessQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (input: {
      workoutId: string;
      subjectiveEffort: string;
      moodBefore: string;
      moodAfter: string;
      meaningText: string;
      plannedContext: string;
      socialContext: string;
      tagsText: string;
      linkValues: string[];
    }) =>
      patchWorkoutSession(input.workoutId, {
        subjectiveEffort:
          input.subjectiveEffort.trim().length > 0
            ? Number(input.subjectiveEffort)
            : null,
        moodBefore: input.moodBefore,
        moodAfter: input.moodAfter,
        meaningText: input.meaningText,
        plannedContext: input.plannedContext,
        socialContext: input.socialContext,
        tags: input.tagsText
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        links: parseHealthLinkValues(input.linkValues)
      }),
    onSuccess: async (_workout, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["forge-fitness"] }),
        queryClient.invalidateQueries({
          queryKey: ["forge-workout-session", variables.workoutId]
        })
      ]);
    }
  });

  const fitness = fitnessQuery.data;
  const sessions = useMemo(() => fitness?.sessions ?? [], [fitness?.sessions]);
  const analysisSessions = fitness?.analysisSessions ?? sessions;
  const linkOptions = buildHealthEntityLinkOptions({
    goals: shell.snapshot.dashboard.goals,
    projects: shell.snapshot.dashboard.projects,
    tasks: shell.snapshot.dashboard.tasks,
    habits: shell.snapshot.dashboard.habits,
    values: valuesQuery.data ?? [],
    patterns: patternsQuery.data ?? [],
    behaviors: behaviorsQuery.data ?? [],
    beliefs: beliefsQuery.data ?? [],
    reports: reportsQuery.data ?? []
  });
  const searchOptions = useMemo(
    () => createWorkoutFilterOptions(sessions),
    [sessions]
  );
  const analysisExerciseOptions = useMemo(
    () => createExerciseTypeOptions(analysisSessions),
    [analysisSessions]
  );
  const filteredSessions = useMemo(() => {
    const normalizedQuery = normalize(query);
    return [...sessions]
      .sort(
        (left, right) =>
          new Date(right.startedAt).getTime() -
          new Date(left.startedAt).getTime()
      )
      .filter((session) => {
        const draft = drafts[session.id] ?? buildWorkoutDraft(session);
        const textMatch =
          normalizedQuery.length === 0 ||
          buildWorkoutSearchText(session, draft).includes(normalizedQuery);
        return textMatch && matchesWorkoutFilters(session, selectedFilterIds);
      });
  }, [drafts, query, selectedFilterIds, sessions]);
  const sessionVirtualizer = useVirtualizer({
    count: filteredSessions.length,
    getScrollElement: () => sessionListRef.current,
    estimateSize: () => 164,
    overscan: 6
  });
  useEffect(() => {
    if (sessionListRef.current) {
      sessionListRef.current.scrollTop = 0;
    }
  }, [query, selectedFilterIds]);
  const filteredAnalysisSessions = useMemo(
    () =>
      filterAnalysisSessions(
        analysisSessions,
        selectedAnalysisExerciseIds,
        analysisDateMode,
        analysisStartDate,
        analysisEndDate
      ),
    [
      analysisDateMode,
      analysisEndDate,
      analysisSessions,
      analysisStartDate,
      selectedAnalysisExerciseIds
    ]
  );
  const resultSummary =
    filteredSessions.length === sessions.length &&
    query.trim().length === 0 &&
    selectedFilterIds.length === 0
      ? `${sessions.length} workout sessions visible`
      : `${filteredSessions.length} of ${sessions.length} workout sessions visible`;
  const activeSession =
    activeSessionQuery.data?.id === selectedWorkoutId
      ? activeSessionQuery.data
      : null;
  const selectedSessionSummary =
    filteredSessions.find((session) => session.id === selectedWorkoutId) ??
    sessions.find((session) => session.id === selectedWorkoutId) ??
    null;
  const activeDraft = activeSession
    ? (drafts[activeSession.id] ?? buildWorkoutDraft(activeSession))
    : null;

  if (fitnessQuery.isLoading) {
    return (
      <SurfaceSkeleton
        eyebrow="Sports"
        title="Loading sports view"
        description="Reading synced workouts and local reflection metadata."
        columns={2}
        blocks={6}
      />
    );
  }

  if (fitnessQuery.isError || !fitness) {
    return (
      <ErrorState
        eyebrow="Sports"
        error={fitnessQuery.error ?? new Error("Sports data unavailable")}
        onRetry={() => void fitnessQuery.refetch()}
      />
    );
  }

  const { summary, weeklyTrend, typeBreakdown } = fitness;
  const totalStoredWorkoutCount =
    summary.storedWorkoutCount ??
    fitness.sportComparison?.periods.find((period) => period.key === "all")
      ?.totals.sessionCount ??
    sessions.length;
  const analysisUsesRecentSample =
    analysisSessions.length < totalStoredWorkoutCount;
  const zoneMix = summary.zoneMix ?? [];
  const zoneAnalysisView = buildZoneAnalysisView(
    filteredAnalysisSessions,
    fitness.vitalsTrend
  );
  const selectedAnalysisLabel =
    selectedAnalysisExerciseIds.length === 0
      ? "All exercise types"
      : zoneAnalysisView.exerciseLabels.length > 0
        ? zoneAnalysisView.exerciseLabels.join(", ")
        : `${selectedAnalysisExerciseIds.length} selected types`;
  const zoneChartData = zoneMix.map((zone) => ({
    zone: zone.label,
    minutes: Math.round(zone.seconds / 60),
    percentage: Math.round(zone.percentage * 100),
    fill: ZONE_COLORS[zone.key] ?? "var(--ui-ink-strong)"
  }));
  const trendChartData = weeklyTrend.map((entry) => {
    const zones = Object.fromEntries(
      (entry.zoneDurations ?? []).map((zone) => [
        zone.key,
        Math.round(zone.seconds / 60)
      ])
    );
    return {
      date: entry.dateKey.slice(5),
      duration: entry.durationMinutes,
      load: entry.trainingLoad ?? 0,
      coverage: Math.round((entry.heartRateCoverage ?? 0) * 100),
      ...zones
    };
  });
  const scatterData = analysisSessions.map((session) => ({
    duration: Math.round(session.durationSeconds / 60),
    intensity: Math.round((session.analytics?.load?.intensity ?? 0) * 100),
    load: session.analytics?.load?.trimp ?? 0,
    type: workoutTypeLabel(session),
    name: workoutTypeLabel(session)
  }));

  function patchDraft(sessionId: string, patch: Partial<WorkoutDraft>) {
    setDrafts((current) => {
      const sourceSession =
        activeSession?.id === sessionId
          ? activeSession
          : sessions.find((entry) => entry.id === sessionId);
      if (!sourceSession) {
        return current;
      }
      const base = current[sessionId] ?? buildWorkoutDraft(sourceSession);
      return {
        ...current,
        [sessionId]: {
          ...base,
          ...patch
        }
      };
    });
  }

  async function saveWorkout(workoutId: string) {
    const session = sessions.find((entry) => entry.id === workoutId);
    if (!session) {
      return;
    }
    const draft = drafts[workoutId] ?? buildWorkoutDraft(session);
    await saveMutation.mutateAsync({
      workoutId,
      subjectiveEffort: draft.subjectiveEffort,
      moodBefore: draft.moodBefore,
      moodAfter: draft.moodAfter,
      meaningText: draft.meaningText,
      plannedContext: draft.plannedContext,
      socialContext: draft.socialContext,
      tagsText: draft.tagsText,
      linkValues: draft.linkValues
    });
    setSelectedWorkoutId(null);
    setEditorStep(0);
  }

  return (
    <div className="grid gap-5">
      <PageHero
        eyebrow="Health"
        copyMode="title_plus_orientation"
        title="Sports"
        description="A session-first training surface for workout data, subjective meaning, and links back into Forge execution and Psyche."
        badge={`${totalStoredWorkoutCount} sessions`}
      />

      <SportsSummaryBox>
        <section
          className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4"
          data-testid="sports-summary-grid"
        >
          <Card className="h-full p-3 sm:p-4">
            <div className="font-label text-[10px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)] sm:text-[11px] sm:tracking-[0.18em]">
              Weekly volume
            </div>
            <div className="mt-2 font-display text-2xl text-[var(--primary)] sm:mt-3 sm:text-4xl">
              {minutesLabel(summary.weeklyVolumeSeconds)}
            </div>
            <div className="mt-1.5 text-xs leading-5 text-[var(--ui-ink-soft)] sm:mt-2 sm:text-sm">
              Total training time in the recent week.
            </div>
          </Card>
          <Card className="h-full p-3 sm:p-4">
            <div className="font-label text-[10px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)] sm:text-[11px] sm:tracking-[0.18em]">
              Exercise minutes
            </div>
            <div className="mt-2 font-display text-2xl text-[var(--ui-ink-strong)] sm:mt-3 sm:text-4xl">
              {summary.exerciseMinutes}
            </div>
            <div className="mt-1.5 text-xs leading-5 text-[var(--ui-ink-soft)] sm:mt-2 sm:text-sm">
              Aggregate exercise minutes from synced sessions.
            </div>
          </Card>
          <Card className="h-full p-3 sm:p-4">
            <div className="font-label text-[10px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)] sm:text-[11px] sm:tracking-[0.18em]">
              Energy burned
            </div>
            <div className="mt-2 font-display text-2xl text-[var(--ui-ink-strong)] sm:mt-3 sm:text-4xl">
              {summary.energyBurnedKcal}
            </div>
            <div className="mt-1.5 text-xs leading-5 text-[var(--ui-ink-soft)] sm:mt-2 sm:text-sm">
              Recent weekly kcal.
            </div>
          </Card>
          <Card className="h-full p-3 sm:p-4">
            <div className="font-label text-[10px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)] sm:text-[11px] sm:tracking-[0.18em]">
              Training streak
            </div>
            <div className="mt-2 font-display text-2xl text-[var(--ui-ink-strong)] sm:mt-3 sm:text-4xl">
              {summary.streakDays}
            </div>
            <div className="mt-1.5 text-xs leading-5 text-[var(--ui-ink-soft)] sm:mt-2 sm:text-sm">
              Distinct workout days in the recent week.
            </div>
          </Card>
          <Card className="h-full p-3 sm:p-4">
            <div className="font-label text-[10px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)] sm:text-[11px] sm:tracking-[0.18em]">
              Average session
            </div>
            <div className="mt-2 font-display text-2xl text-[var(--ui-ink-strong)] sm:mt-3 sm:text-4xl">
              {summary.averageSessionMinutes}m
            </div>
            <div className="mt-1.5 text-xs leading-5 text-[var(--ui-ink-soft)] sm:mt-2 sm:text-sm">
              Mean duration across recent sessions.
            </div>
          </Card>
          <Card className="h-full p-3 sm:p-4">
            <div className="font-label text-[10px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)] sm:text-[11px] sm:tracking-[0.18em]">
              Training load
            </div>
            <div className="mt-2 font-display text-2xl text-[var(--ui-ink-strong)] sm:mt-3 sm:text-4xl">
              {summary.totalTrainingLoad ?? "n/a"}
            </div>
            <div className="mt-1.5 text-xs leading-5 text-[var(--ui-ink-soft)] sm:mt-2 sm:text-sm">
              Forge TRIMP across recent sessions.
            </div>
          </Card>
          <Card className="h-full p-3 sm:p-4">
            <div className="font-label text-[10px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)] sm:text-[11px] sm:tracking-[0.18em]">
              Linked sessions
            </div>
            <div className="mt-2 font-display text-2xl text-[var(--ui-ink-strong)] sm:mt-3 sm:text-4xl">
              {summary.linkedSessionCount}
            </div>
            <div className="mt-1.5 text-xs leading-5 text-[var(--ui-ink-soft)] sm:mt-2 sm:text-sm">
              Sessions already tied to Forge or Psyche entities.
            </div>
          </Card>
          <Card className="h-full p-3 sm:p-4">
            <div className="font-label text-[10px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)] sm:text-[11px] sm:tracking-[0.18em]">
              HR coverage
            </div>
            <div className="mt-2 font-display text-2xl text-[var(--ui-ink-strong)] sm:mt-3 sm:text-4xl">
              {Math.round((summary.averageHeartRateCoverage ?? 0) * 100)}%
            </div>
            <div className="mt-1.5 text-xs leading-5 text-[var(--ui-ink-soft)] sm:mt-2 sm:text-sm">
              Average raw HR sample coverage.
            </div>
          </Card>
        </section>
      </SportsSummaryBox>

      {fitness.sportComparison ? (
        <SportsCompositionBox>
          <SportComparisonPanel comparison={fitness.sportComparison} />
        </SportsCompositionBox>
      ) : null}

      <SportsCompositionBox>
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <Card className="min-h-[320px]">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
              Load and volume trend
            </div>
            <ChartViewport className="mt-4 h-[260px]">
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={1}
                minHeight={1}
                initialDimension={{ width: 1, height: 1 }}
              >
                <AreaChart data={trendChartData}>
                  <defs>
                    <linearGradient id="sportsLoad" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="var(--chart-zone-4)"
                        stopOpacity={0.36}
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--chart-zone-4)"
                        stopOpacity={0.04}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    stroke="var(--ui-border-subtle)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "var(--ui-ink-faint)", fontSize: 11 }}
                  />
                  <YAxis
                    tick={{ fill: "var(--ui-ink-faint)", fontSize: 11 }}
                    width={34}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--ui-surface-popover)",
                      border: "1px solid var(--ui-border-strong)",
                      borderRadius: 8,
                      color: "var(--ui-ink-strong)"
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="load"
                    stroke="var(--chart-zone-4)"
                    fill="url(#sportsLoad)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="duration"
                    stroke="var(--chart-zone-1)"
                    fill="var(--ui-info-soft)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartViewport>
          </Card>

          <Card>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
              Zone distribution
            </div>
            <div className="mt-4 grid gap-3">
              {zoneMix.map((zone) => (
                <div key={zone.key} className="grid gap-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-[var(--ui-ink)]">{zone.label}</span>
                    <span className="text-[var(--ui-ink-strong)]">
                      {Math.round(zone.percentage * 100)}% ·{" "}
                      {minutesLabel(zone.seconds)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--ui-surface-3)]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(1, zone.percentage * 100)}%`,
                        background:
                          ZONE_COLORS[zone.key] ?? "var(--ui-ink-strong)"
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <ChartViewport className="mt-5 h-[180px]">
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={1}
                minHeight={1}
                initialDimension={{ width: 1, height: 1 }}
              >
                <BarChart data={zoneChartData}>
                  <XAxis
                    dataKey="zone"
                    tick={{ fill: "var(--ui-ink-faint)", fontSize: 10 }}
                  />
                  <YAxis
                    tick={{ fill: "var(--ui-ink-faint)", fontSize: 10 }}
                    width={34}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--ui-surface-popover)",
                      border: "1px solid var(--ui-border-strong)",
                      borderRadius: 8,
                      color: "var(--ui-ink-strong)"
                    }}
                  />
                  <Bar
                    dataKey="minutes"
                    fill="var(--chart-zone-4)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartViewport>
          </Card>
        </section>
      </SportsCompositionBox>

      <SportsCompositionBox>
        <section className="grid gap-4">
          <Card className="relative z-10 grid gap-4 overflow-visible">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                  HR zone analysis
                </div>
                <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                  {analysisUsesRecentSample
                    ? `Filter the ${analysisSessions.length} most recent analysis-ready workouts by exercise type and date.`
                    : "Filter workout evidence by exercise type and date."}
                </div>
              </div>
              <Badge tone="meta">
                {filteredAnalysisSessions.length} of {analysisSessions.length}{" "}
                sessions
              </Badge>
            </div>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
              <FacetedTokenSearch
                title="Exercise types"
                description="Select one, many, or none for all exercise types."
                query={analysisExerciseQuery}
                onQueryChange={setAnalysisExerciseQuery}
                options={analysisExerciseOptions}
                selectedOptionIds={selectedAnalysisExerciseIds}
                onSelectedOptionIdsChange={setSelectedAnalysisExerciseIds}
                resultSummary={selectedAnalysisLabel}
                placeholder="Search exercise types"
                emptyStateMessage="No exercise type matches."
              />
              <div className="grid gap-3 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                  Date range
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    [
                      "all",
                      analysisUsesRecentSample ? "Loaded history" : "All time"
                    ],
                    ["recent_90", "90 days"],
                    ["custom", "Custom"]
                  ].map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      className={`rounded-[8px] border px-3 py-2 text-sm transition ${
                        analysisDateMode === mode
                          ? "border-[var(--primary)] bg-[var(--primary)]/12 text-[var(--ui-ink-strong)]"
                          : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-ink-strong)]"
                      }`}
                      onClick={() =>
                        setAnalysisDateMode(mode as AnalysisDateMode)
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="text-sm text-[var(--ui-ink-soft)]">
                      Start
                    </span>
                    <Input
                      type="date"
                      value={analysisStartDate}
                      onChange={(event) => {
                        setAnalysisStartDate(event.target.value);
                        setAnalysisDateMode("custom");
                      }}
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm text-[var(--ui-ink-soft)]">
                      End
                    </span>
                    <Input
                      type="date"
                      value={analysisEndDate}
                      onChange={(event) => {
                        setAnalysisEndDate(event.target.value);
                        setAnalysisDateMode("custom");
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <Card className="min-h-[330px] overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                    Average zones
                  </div>
                  <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                    Duration-weighted proportion of time in each HR zone.
                  </div>
                </div>
                <Badge tone="meta">{selectedAnalysisLabel}</Badge>
              </div>
              <ChartViewport className="mt-4 h-[235px]">
                {zoneAnalysisView.sessions.length > 0 ? (
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    minWidth={1}
                    minHeight={1}
                    initialDimension={{ width: 1, height: 1 }}
                  >
                    <BarChart data={zoneAnalysisView.averageZoneData}>
                      <CartesianGrid
                        stroke="var(--ui-border-subtle)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="zone"
                        interval={0}
                        tick={{ fill: "var(--ui-ink-faint)", fontSize: 10 }}
                      />
                      <YAxis
                        unit="%"
                        domain={[0, 100]}
                        ticks={[0, 25, 50, 75, 100]}
                        tick={{ fill: "var(--ui-ink-faint)", fontSize: 10 }}
                        width={38}
                      />
                      <Tooltip
                        formatter={(value) => [`${value}%`, "Average time"]}
                        contentStyle={{
                          background: "var(--ui-surface-popover)",
                          border: "1px solid var(--ui-border-strong)",
                          borderRadius: 8,
                          color: "var(--ui-ink-strong)"
                        }}
                      />
                      <Bar dataKey="percentage" radius={[4, 4, 0, 0]}>
                        {zoneAnalysisView.averageZoneData.map((entry) => (
                          <Cell key={entry.key} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="grid h-full place-items-center rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-6 text-center text-sm leading-6 text-[var(--ui-ink-soft)]">
                    No selected sessions with zone analytics are available yet.
                  </div>
                )}
              </ChartViewport>
              {zoneAnalysisView.sessions.length > 0 ? (
                <div className="mt-3 grid gap-2 text-sm text-[var(--ui-ink-soft)] sm:grid-cols-3">
                  <div>
                    {zoneAnalysisView.rawHrCount} sessions have raw HR timelines
                  </div>
                  <div>
                    Latest: {zoneAnalysisView.lineData.at(-1)?.dateKey ?? "n/a"}
                  </div>
                  <div>
                    VO2max points:{" "}
                    {
                      zoneAnalysisView.lineData.filter(
                        (entry) => entry.vo2Max != null
                      ).length
                    }
                  </div>
                </div>
              ) : null}
            </Card>

            <Card className="min-h-[330px] overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                    {analysisZoneChartMode === "expanding_lines"
                      ? "Expanding zone lines"
                      : "Zone drift"}
                  </div>
                  <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                    {analysisZoneChartMode === "expanding_lines"
                      ? "Expanding all-session average with resting HR and VO2max overlay."
                      : "Rolling duration-weighted zone mix with resting HR and VO2max overlay."}
                  </div>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
                  <div
                    className="grid grid-cols-2 gap-1 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-1"
                    aria-label="Zone chart display"
                  >
                    {[
                      ["rolling_stack", "Stacked"],
                      ["expanding_lines", "Lines"]
                    ].map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        className={`min-h-9 rounded-[6px] px-3 py-1.5 text-xs font-medium transition ${
                          analysisZoneChartMode === mode
                            ? "bg-[var(--primary)]/18 text-[var(--ui-ink-strong)]"
                            : "text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-ink-strong)]"
                        }`}
                        onClick={() =>
                          setAnalysisZoneChartMode(
                            mode as ZoneAnalysisChartMode
                          )
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <Badge tone="meta">HRR zones</Badge>
                </div>
              </div>
              <ChartViewport className="mt-4 h-[255px]">
                {zoneAnalysisView.lineData.length > 0 ? (
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    minWidth={1}
                    minHeight={1}
                    initialDimension={{ width: 1, height: 1 }}
                  >
                    <ComposedChart
                      data={
                        analysisZoneChartMode === "expanding_lines"
                          ? zoneAnalysisView.expandingLineData
                          : zoneAnalysisView.lineData
                      }
                    >
                      <CartesianGrid
                        stroke="var(--ui-border-subtle)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fill: "var(--ui-ink-faint)", fontSize: 10 }}
                      />
                      <YAxis
                        yAxisId="zones"
                        domain={[0, 100]}
                        ticks={[0, 25, 50, 75, 100]}
                        unit="%"
                        tick={{ fill: "var(--ui-ink-faint)", fontSize: 10 }}
                        width={38}
                      />
                      <YAxis
                        yAxisId="vitals"
                        orientation="right"
                        tick={{ fill: "var(--ui-ink-faint)", fontSize: 10 }}
                        width={42}
                      />
                      <Tooltip
                        formatter={(value, name, item) =>
                          formatZoneTrendTooltipValue(value, name, item)
                        }
                        contentStyle={{
                          background: "var(--ui-surface-popover)",
                          border: "1px solid var(--ui-border-strong)",
                          borderRadius: 8,
                          color: "var(--ui-ink-strong)"
                        }}
                      />
                      <Legend
                        wrapperStyle={{
                          color: "var(--ui-ink)",
                          fontSize: 11
                        }}
                      />
                      {analysisZoneChartMode === "expanding_lines"
                        ? ZONE_ORDER.map((zoneKey) => (
                            <Line
                              key={zoneKey}
                              yAxisId="zones"
                              type="monotone"
                              dataKey={zoneKey}
                              name={humanizeToken(zoneKey)}
                              stroke={ZONE_COLORS[zoneKey]}
                              strokeWidth={2}
                              dot={{ r: 2.5 }}
                              activeDot={{ r: 4 }}
                              connectNulls
                            />
                          ))
                        : ZONE_ORDER.map((zoneKey) => (
                            <Bar
                              key={zoneKey}
                              yAxisId="zones"
                              dataKey={zoneKey}
                              stackId="zones"
                              fill={ZONE_COLORS[zoneKey]}
                              isAnimationActive={false}
                            />
                          ))}
                      <Line
                        yAxisId="vitals"
                        type="monotone"
                        dataKey="restingHeartRate"
                        name="Resting HR"
                        stroke="var(--ui-ink-soft)"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        connectNulls
                      />
                      <Line
                        yAxisId="vitals"
                        type="monotone"
                        dataKey="vo2Max"
                        name="VO2max"
                        stroke="var(--chart-series-alt)"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        connectNulls
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="grid h-full place-items-center rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-6 text-center text-sm leading-6 text-[var(--ui-ink-soft)]">
                    Select workouts with HR evidence to unlock the time-series
                    plot.
                  </div>
                )}
              </ChartViewport>
            </Card>
          </div>
        </section>
      </SportsCompositionBox>

      <SportsCompositionBox>
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="min-h-[300px]">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
              Duration vs intensity
            </div>
            <ChartViewport className="mt-4 h-[250px]">
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={1}
                minHeight={1}
                initialDimension={{ width: 1, height: 1 }}
              >
                <ScatterChart data={scatterData}>
                  <CartesianGrid stroke="var(--ui-border-subtle)" />
                  <XAxis
                    type="number"
                    dataKey="duration"
                    name="minutes"
                    tick={{ fill: "var(--ui-ink-faint)", fontSize: 11 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="intensity"
                    name="intensity"
                    tick={{ fill: "var(--ui-ink-faint)", fontSize: 11 }}
                    width={38}
                  />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    contentStyle={{
                      background: "var(--ui-surface-popover)",
                      border: "1px solid var(--ui-border-strong)",
                      borderRadius: 8,
                      color: "var(--ui-ink-strong)"
                    }}
                  />
                  <Scatter dataKey="load" fill="var(--chart-zone-4)" />
                </ScatterChart>
              </ResponsiveContainer>
            </ChartViewport>
          </Card>
          <Card>
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
              Evidence quality
            </div>
            <div className="mt-4 grid gap-3">
              <div className="rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                <div className="text-sm text-[var(--ui-ink-soft)]">
                  Raw HR coverage
                </div>
                <div className="mt-2 text-2xl text-[var(--ui-ink-strong)]">
                  {Math.round((summary.averageHeartRateCoverage ?? 0) * 100)}%
                </div>
              </div>
              <div className="rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                <div className="text-sm text-[var(--ui-ink-soft)]">
                  Route-backed workouts
                </div>
                <div className="mt-2 text-2xl text-[var(--ui-ink-strong)]">
                  {summary.routeWorkoutCount ?? 0}
                </div>
              </div>
              <div className="rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                <div className="text-sm text-[var(--ui-ink-soft)]">
                  Top sport
                </div>
                <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                  {summary.topWorkoutTypeLabel ??
                    summary.topWorkoutType ??
                    "n/a"}
                </div>
              </div>
            </div>
          </Card>
        </section>
      </SportsCompositionBox>

      <SportsCompositionBox>
        <section className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <Card className="grid gap-4">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
              Recent volume
            </div>
            <div className="grid gap-3">
              {weeklyTrend.map((session) => (
                <div
                  key={session.id}
                  className="grid gap-2 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 md:grid-cols-[110px_150px_minmax(0,1fr)_90px]"
                >
                  <div className="text-sm text-[var(--ui-ink-soft)]">
                    {session.dateKey}
                  </div>
                  <div className="text-sm text-[var(--ui-ink-strong)]">
                    {session.workoutTypeLabel ??
                      humanizeToken(session.workoutType)}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--ui-surface-3)]">
                      <div
                        className="h-full rounded-full bg-[var(--primary)]"
                        style={{
                          width: `${Math.min(100, (session.durationMinutes / 120) * 100)}%`
                        }}
                      />
                    </div>
                    <div className="text-sm text-[var(--ui-ink-strong)]">
                      {session.durationMinutes}m
                    </div>
                  </div>
                  <div className="text-sm text-[var(--ui-ink-soft)]">
                    {session.energyKcal} kcal
                  </div>
                </div>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                <div className="text-sm text-[var(--ui-ink-soft)]">
                  Distance
                </div>
                <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                  {kilometersLabel(summary.distanceMeters)}
                </div>
              </div>
              <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                <div className="text-sm text-[var(--ui-ink-soft)]">
                  Planned sessions
                </div>
                <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                  {summary.plannedSessionCount}
                </div>
              </div>
              <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                <div className="text-sm text-[var(--ui-ink-soft)]">
                  Imported / merged
                </div>
                <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                  {summary.importedSessionCount} /{" "}
                  {summary.reconciledSessionCount}
                </div>
              </div>
            </div>
          </Card>

          <Card className="grid gap-4">
            <div>
              <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                Recent composition
              </div>
              <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                Workout type and provenance mix across the latest 40 sessions
              </div>
            </div>
            <div className="grid gap-3">
              {typeBreakdown.slice(0, 6).map((entry) => (
                <div
                  key={entry.workoutType}
                  className="grid gap-2 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 md:grid-cols-[minmax(0,1fr)_90px_90px]"
                >
                  <div>
                    <div className="text-[var(--ui-ink-strong)]">
                      {entry.workoutTypeLabel ??
                        humanizeToken(entry.workoutType)}
                    </div>
                    <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
                      {entry.sessionCount} sessions ·{" "}
                      {entry.activityFamilyLabel ?? "Other"}
                    </div>
                  </div>
                  <div className="text-sm text-[var(--ui-ink)]">
                    {entry.totalMinutes}m
                  </div>
                  <div className="text-sm text-[var(--ui-ink)]">
                    {entry.energyKcal} kcal
                  </div>
                </div>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                <div className="text-sm text-[var(--ui-ink-soft)]">
                  Habit-generated
                </div>
                <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                  {summary.habitGeneratedSessionCount}
                </div>
              </div>
              <div className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
                <div className="text-sm text-[var(--ui-ink-soft)]">
                  Forge-linked
                </div>
                <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                  {summary.linkedSessionCount}
                </div>
              </div>
            </div>
          </Card>
        </section>
      </SportsCompositionBox>

      <SportsBrowserBox>
        <section className="grid gap-4 xl:grid-cols-[minmax(0,25rem)_minmax(0,1fr)]">
          <FacetedTokenSearch
            title="Session browser"
            description="Search past activities by workout type, source, reconciliation state, or whether they still need context."
            query={query}
            onQueryChange={setQuery}
            options={searchOptions}
            selectedOptionIds={selectedFilterIds}
            onSelectedOptionIdsChange={setSelectedFilterIds}
            resultSummary={resultSummary}
            placeholder="Search workouts, devices, notes, moods, or filter chips"
            emptyStateMessage="Keep typing or pick a filter chip to narrow the activity history."
          />

          <Card className="grid gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                  Activity history
                </div>
                <div className="mt-2 text-lg text-[var(--ui-ink-strong)]">
                  Open a workout to add reflection and links in a guided modal.
                </div>
              </div>
              <Badge tone="meta">{resultSummary}</Badge>
            </div>

            <div
              ref={sessionListRef}
              className="h-[34rem] overflow-y-auto rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]"
              data-testid="virtual-workout-history"
            >
              {filteredSessions.length === 0 ? (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm leading-6 text-[var(--ui-ink-faint)]">
                  No workout matches the current search yet. Clear some filters
                  or search by workout type, device, or reflection text.
                </div>
              ) : (
                <div
                  className="relative w-full"
                  style={{ height: `${sessionVirtualizer.getTotalSize()}px` }}
                >
                  {sessionVirtualizer.getVirtualItems().map((virtualRow) => {
                    const session = filteredSessions[virtualRow.index]!;
                    const hasReflection =
                      session.meaningText.trim().length > 0 ||
                      session.moodBefore.trim().length > 0 ||
                      session.moodAfter.trim().length > 0 ||
                      session.tags.length > 0 ||
                      session.links.length > 0;
                    return (
                      <div
                        key={virtualRow.key}
                        ref={sessionVirtualizer.measureElement}
                        data-index={virtualRow.index}
                        className="absolute left-0 top-0 w-full px-3 py-1.5"
                        style={{
                          transform: `translateY(${virtualRow.start}px)`
                        }}
                      >
                        <div className="grid min-w-0 gap-3 rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 text-left transition hover:bg-[var(--ui-surface-2)]">
                          <div className="grid min-w-0 gap-3 sm:flex sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <Link
                                to={`/sports/workouts/${session.id}`}
                                onClick={() =>
                                  window.scrollTo({ top: 0, left: 0 })
                                }
                                className="flex min-w-0 items-center gap-2 text-[var(--ui-ink-strong)] transition hover:text-[var(--primary)]"
                              >
                                <Dumbbell className="size-4 shrink-0 text-[var(--primary)]" />
                                <span className="truncate text-base font-medium">
                                  {workoutTypeLabel(session)}
                                </span>
                              </Link>
                              <div className="mt-2 flex min-w-0 items-center gap-2 text-sm text-[var(--ui-ink-soft)]">
                                <CalendarDays className="size-3.5 shrink-0" />
                                <span className="min-w-0 truncate">
                                  {formatWorkoutWindow(
                                    session.startedAt,
                                    session.endedAt
                                  )}
                                </span>
                              </div>
                              <div className="mt-2 text-sm text-[var(--ui-ink-faint)]">
                                {activityFamilyLabel(session)} ·{" "}
                                {session.sourceDevice}
                              </div>
                            </div>
                            <button
                              type="button"
                              aria-label={`Edit ${workoutTypeLabel(session)} reflection`}
                              className="inline-flex w-fit max-w-full items-center gap-2 rounded-full bg-[var(--ui-surface-2)] px-3 py-1.5 text-xs text-[var(--ui-ink)] transition hover:bg-[var(--ui-surface-3)] hover:text-[var(--ui-ink-strong)]"
                              onClick={() => {
                                setSelectedWorkoutId(session.id);
                                setEditorStep(0);
                              }}
                            >
                              <span className="truncate">
                                {hasReflection
                                  ? "Reflected"
                                  : "Needs reflection"}
                              </span>
                              <ArrowRight className="size-3.5 shrink-0" />
                            </button>
                          </div>
                          <div className="flex min-w-0 flex-wrap gap-2">
                            <Badge>
                              {minutesLabel(session.durationSeconds)}
                            </Badge>
                            {session.totalEnergyKcal ? (
                              <Badge tone="meta">
                                {Math.round(session.totalEnergyKcal)} kcal
                              </Badge>
                            ) : null}
                            {session.distanceMeters ? (
                              <Badge tone="meta">
                                {kilometersLabel(session.distanceMeters)}
                              </Badge>
                            ) : null}
                            {session.averageHeartRate ? (
                              <Badge tone="meta">
                                <HeartPulse className="mr-1 size-3.5" />
                                {Math.round(session.averageHeartRate)} bpm
                              </Badge>
                            ) : null}
                            <Badge tone="meta">
                              {activityFamilyLabel(session)}
                            </Badge>
                            <Badge tone="meta" className="capitalize">
                              {session.sourceType.replaceAll("_", " ")}
                            </Badge>
                            <Badge tone="meta" className="capitalize">
                              {session.reconciliationStatus.replaceAll(
                                "_",
                                " "
                              )}
                            </Badge>
                            {session.analytics?.confidence ? (
                              <Badge tone="meta">
                                {session.analytics.confidence} zones
                              </Badge>
                            ) : null}
                            {session.analytics?.routeSummary?.hasRoute ? (
                              <Badge tone="meta">Route</Badge>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        </section>
      </SportsBrowserBox>

      {selectedWorkoutId ? (
        <SheetScaffold
          open
          onOpenChange={(open) => {
            if (!open) {
              setSelectedWorkoutId(null);
              setEditorStep(0);
            }
          }}
          eyebrow="Sports session"
          title={
            activeSession
              ? workoutTypeLabel(activeSession)
              : selectedSessionSummary
                ? workoutTypeLabel(selectedSessionSummary)
                : "Workout session"
          }
          description="Add contextual meaning without crowding the main training surface."
        >
          {activeSessionQuery.isLoading ? (
            <div
              className="flex min-h-64 items-center justify-center text-sm text-[var(--ui-ink-soft)]"
              role="status"
            >
              Loading complete workout details...
            </div>
          ) : activeSessionQuery.isError || !activeSession || !activeDraft ? (
            <div
              className="flex min-h-64 flex-col items-center justify-center gap-4 text-center"
              role="alert"
            >
              <div>
                <div className="text-base font-medium text-[var(--ui-ink-strong)]">
                  Workout details could not be loaded
                </div>
                <div className="mt-2 max-w-md text-sm leading-6 text-[var(--ui-ink-soft)]">
                  The session remains unchanged. Retry before adding reflection
                  or links.
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void activeSessionQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : (
            <SportsSessionEditor
              session={activeSession}
              draft={activeDraft}
              linkOptions={linkOptions}
              pending={
                saveMutation.isPending &&
                saveMutation.variables?.workoutId === activeSession.id
              }
              step={editorStep}
              onStepChange={setEditorStep}
              onDraftChange={(patch) => patchDraft(activeSession.id, patch)}
              onSave={() => void saveWorkout(activeSession.id)}
            />
          )}
        </SheetScaffold>
      ) : null}
    </div>
  );
}
