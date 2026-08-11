import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Compass,
  HeartPulse,
  History,
  LayoutDashboard,
  Library,
  Search,
  Settings,
  Target,
  Wrench,
  type LucideIcon
} from "lucide-react";
import { AiSurfaceWorkspace } from "@/components/customization/ai-surface-workspace";
import { type SurfaceWidgetDefinition } from "@/components/customization/editable-surface";
import {
  MiniCalendarWidget,
  QuickCaptureWidget,
  SpotifyWidget,
  TimeWidget,
  WeatherWidget
} from "@/components/customization/utility-widgets";
import { CreateMenu, useForgeCreateActions } from "@/components/create-menu";
import { GamificationOverviewWidget } from "@/components/gamification/gamification-widgets";
import { LifeForceOverviewWorkspace } from "@/components/life-force/life-force-workspace";
import { ProvenanceSummary } from "@/components/provenance-summary";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { ProgressMeter } from "@/components/ui/progress-meter";
import {
  getAttentionInbox,
  getFitnessView,
  getMovementDay,
  getSleepView,
  getVitalsView
} from "@/lib/api";
import {
  getReadableActivityDescription,
  getReadableActivityTitle
} from "@/lib/activity-copy";
import { getRuntimeTimeZone } from "@/lib/date-keys";
import { getActivityEventHref } from "@/lib/entity-links";
import {
  formatLifeForceAp,
  formatLifeForceRate
} from "@/lib/life-force-display";
import type {
  ForgeSnapshot,
  MovementDayData,
  VitalsViewData,
  XpMetricsPayload
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { normalizeOverviewLayout } from "@/pages/overview-layout";
import {
  useGetForgeDoctorQuery,
  useGetXpMetricsQuery
} from "@/store/api/forge-api";

type OverviewDestination = {
  label: string;
  href: string;
  detail: string;
};

type OverviewGroup = {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  destinations: OverviewDestination[];
  advanced?: {
    label: string;
    destinations: OverviewDestination[];
  };
};

export const FORGE_OVERVIEW_GROUPS: OverviewGroup[] = [
  {
    id: "now",
    title: "Now and review",
    description: "See current obligations, time, changes, and decisions.",
    icon: Clock3,
    destinations: [
      {
        label: "Attention",
        href: "/attention",
        detail: "Items that need a decision or follow-up"
      },
      { label: "Today", href: "/today", detail: "Today’s work and habits" },
      { label: "Calendar", href: "/calendar", detail: "Scheduled commitments" },
      {
        label: "Life Events",
        href: "/life-events",
        detail: "Important events and dates"
      },
      {
        label: "Activity",
        href: "/activity",
        detail: "Recent changes across Forge"
      },
      {
        label: "Insights",
        href: "/insights",
        detail: "Patterns ready for review"
      },
      {
        label: "Weekly Review",
        href: "/review/weekly",
        detail: "Reflect on the past week"
      }
    ]
  },
  {
    id: "direction",
    title: "Direction and work",
    description: "Move from long-range direction to work you can finish.",
    icon: Target,
    destinations: [
      { label: "Goals", href: "/goals", detail: "Long-range outcomes" },
      {
        label: "Strategies",
        href: "/strategies",
        detail: "Choices that guide goals and projects"
      },
      { label: "Projects", href: "/projects", detail: "Owned bodies of work" },
      {
        label: "Full hierarchy",
        href: "/projects/hierarchy",
        detail: "Goals, strategies, projects, and work together"
      },
      {
        label: "Work board",
        href: "/kanban",
        detail: "Issues, tasks, and subtasks"
      },
      { label: "Habits", href: "/habits", detail: "Recurring commitments" },
      {
        label: "Workbench",
        href: "/workbench",
        detail: "Structured working flows"
      }
    ]
  },
  {
    id: "knowledge",
    title: "Knowledge and learning",
    description: "Capture memory, inspect evidence, and continue learning.",
    icon: Library,
    destinations: [
      {
        label: "Notes",
        href: "/notes",
        detail: "Captured thoughts and evidence"
      },
      { label: "Wiki", href: "/wiki", detail: "Durable pages and references" },
      {
        label: "Knowledge Graph",
        href: "/knowledge-graph",
        detail: "Explore connections across records"
      },
      {
        label: "Artifacts",
        href: "/artifacts",
        detail: "Trusted files and source material"
      },
      {
        label: "Courses",
        href: "/courses",
        detail: "Learning paths and progress"
      },
      {
        label: "Concepts",
        href: "/concepts",
        detail: "Reusable ideas and mastery"
      }
    ],
    advanced: {
      label: "Wiki tools",
      destinations: [
        {
          label: "Wiki ingestion history",
          href: "/wiki/ingest-history",
          detail: "Review imported knowledge"
        }
      ]
    }
  },
  {
    id: "health",
    title: "Health, capacity, and self-understanding",
    description:
      "Review capacity, recovery, health evidence, and personal patterns.",
    icon: HeartPulse,
    destinations: [
      {
        label: "Life Force",
        href: "/life-force",
        detail: "Capacity and Action Point planning"
      },
      {
        label: "Movement",
        href: "/movement",
        detail: "Places, trips, and movement"
      },
      { label: "Sleep", href: "/sleep", detail: "Sleep history and recovery" },
      {
        label: "Sports",
        href: "/sports",
        detail: "Workouts and training sessions"
      },
      {
        label: "Training Load",
        href: "/training-load",
        detail: "Training strain and recovery"
      },
      {
        label: "Vitals",
        href: "/vitals",
        detail: "Body measurements over time"
      },
      {
        label: "Weight Loss",
        href: "/weight-loss",
        detail: "Weight goals and progress"
      },
      {
        label: "Psyche",
        href: "/psyche",
        detail: "Values, patterns, and reflection"
      },
      {
        label: "Preferences",
        href: "/preferences",
        detail: "Personal preferences and defaults"
      }
    ],
    advanced: {
      label: "Psyche areas",
      destinations: [
        {
          label: "Metrics",
          href: "/psyche/metrics",
          detail: "Psyche measurements"
        },
        {
          label: "Flashcards",
          href: "/psyche/flashcards",
          detail: "Reflection cards"
        },
        { label: "Values", href: "/psyche/values", detail: "Guiding values" },
        {
          label: "Patterns",
          href: "/psyche/patterns",
          detail: "Recurring patterns"
        },
        {
          label: "Questionnaires",
          href: "/psyche/questionnaires",
          detail: "Structured questionnaires"
        },
        {
          label: "Self-observation",
          href: "/psyche/self-observation",
          detail: "Personal observations"
        },
        {
          label: "Screen time",
          href: "/psyche/screen-time",
          detail: "Screen-use evidence"
        },
        {
          label: "Behaviors",
          href: "/psyche/behaviors",
          detail: "Behaviors and change"
        },
        {
          label: "Reports",
          href: "/psyche/reports",
          detail: "Reflection reports"
        },
        {
          label: "Goal map",
          href: "/psyche/goal-map",
          detail: "Goals and psychological context"
        },
        {
          label: "Schemas and beliefs",
          href: "/psyche/schemas-beliefs",
          detail: "Beliefs and schemas"
        },
        { label: "Modes", href: "/psyche/modes", detail: "Current modes" },
        {
          label: "Modes guide",
          href: "/psyche/modes/guide",
          detail: "Help understanding modes"
        }
      ]
    }
  },
  {
    id: "system",
    title: "People, connections, and system",
    description: "See who and what is connected, then inspect system health.",
    icon: Settings,
    destinations: [
      {
        label: "People",
        href: "/people",
        detail: "People represented in Forge"
      },
      {
        label: "Settings and system health",
        href: "/settings",
        detail: "Configuration and Doctor checks"
      },
      {
        label: "Data",
        href: "/settings/data",
        detail: "Data location and integrity"
      },
      {
        label: "Users",
        href: "/settings/users",
        detail: "User scope and access"
      },
      {
        label: "Calendar integrations",
        href: "/settings/calendar",
        detail: "Calendar connections and sync"
      },
      {
        label: "Mobile companion",
        href: "/settings/mobile",
        detail: "Mobile connection and sync"
      },
      {
        label: "Models",
        href: "/settings/models",
        detail: "Model connections"
      },
      {
        label: "Agents",
        href: "/settings/agents",
        detail: "Agents, tokens, and approvals"
      },
      {
        label: "Reward settings",
        href: "/settings/rewards",
        detail: "Progression rules and art"
      },
      {
        label: "Wiki settings",
        href: "/settings/wiki",
        detail: "Wiki configuration and index health"
      },
      {
        label: "Runtime logs",
        href: "/settings/logs",
        detail: "Runtime diagnostics"
      },
      {
        label: "Deleted records",
        href: "/settings/bin",
        detail: "Recoverable deleted items"
      },
      {
        label: "Trophy Hall",
        href: "/rewards",
        detail: "Achievements and unlocks"
      }
    ]
  }
];

const OVERVIEW_METRIC_HELP: Record<string, string> = {
  "Life Force":
    "Life Force compares today’s spent Action Points with the modeled daily budget. It supports capacity planning and is not a medical score.",
  Momentum:
    "Momentum summarizes recent execution, XP, and streak context. Treat it as an attention cue, not a ranking.",
  Level:
    "Level comes from the XP ledger and represents accumulated meaningful Forge activity for the selected user scope.",
  "Weekly XP":
    "Weekly XP shows recent reward-ledger activity rather than old accumulated progress."
};

export function buildOverviewXpFallback(
  snapshot: Pick<ForgeSnapshot, "userScope" | "metrics">
): XpMetricsPayload {
  return {
    timezone: getRuntimeTimeZone(),
    scope: {
      mode: "operator_fallback",
      userIds: snapshot.userScope.selectedUserIds,
      users: snapshot.userScope.selectedUsers,
      label: snapshot.userScope.selectedUsers[0]?.displayName ?? "Forge"
    },
    profile: snapshot.metrics,
    achievements: [],
    milestoneRewards: [],
    momentumPulse: {
      status:
        snapshot.metrics.momentumScore >= 80
          ? "surging"
          : snapshot.metrics.momentumScore >= 60
            ? "steady"
            : "recovering",
      headline: `${snapshot.metrics.streakDays}-day streak`,
      detail: `${snapshot.metrics.currentLevelXp}/${snapshot.metrics.nextLevelXp} XP in level ${snapshot.metrics.level}.`,
      celebrationLabel: "Forge Smith",
      nextMilestoneId: null,
      nextMilestoneLabel: "Next unlock"
    },
    catalogPreview: [],
    unlockedItemCount: 0,
    totalItemCount: 144,
    nextUnlock: null,
    newestUnlock: null,
    nextTargets: [],
    equipment: {
      selectedMascotSkin: null,
      selectedHudTreatment: null,
      selectedStreakEffect: null,
      selectedTrophyShelf: null,
      selectedCelebrationVariant: null,
      updatedAt: null
    },
    mascot: {
      mood: "wise",
      spriteKey: "mascot-state-014",
      streakSpriteKey: "mascot-state-017",
      headline: "Small heat still counts.",
      line: "Return to the anvil today.",
      pressureLevel: 0,
      missedDays: 0,
      lastActiveDateKey: null
    },
    celebrations: [],
    recentLedger: [],
    rules: [],
    dailyAmbientXp: 0,
    dailyAmbientCap: 12
  } satisfies XpMetricsPayload;
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatCompactDuration(seconds: number) {
  if (seconds >= 3_600) {
    const hours = seconds / 3_600;
    return `${hours >= 10 || Number.isInteger(hours) ? Math.round(hours) : hours.toFixed(1)}h`;
  }
  return `${Math.max(1, Math.round(seconds / 60))}m`;
}

function buildMovementPlaceBreakdown(day: MovementDayData | undefined) {
  if (!day) return [];
  const totals = new Map<string, number>();
  for (const segment of day.segments) {
    if (segment.kind !== "stay" || segment.durationSeconds <= 0) continue;
    const label = segment.label.trim() || "Unlabeled stay";
    totals.set(label, (totals.get(label) ?? 0) + segment.durationSeconds);
  }
  return [...totals.entries()]
    .map(([label, seconds]) => ({ label, seconds }))
    .sort((left, right) => right.seconds - left.seconds)
    .slice(0, 2);
}

function buildVitalsHighlightRows(vitals: VitalsViewData | undefined) {
  if (!vitals) return [];
  const desired = ["restingHeartRate", "heartRateVariabilitySDNN", "vo2Max"];
  return desired
    .map((key) => vitals.metrics.find((metric) => metric.metric === key))
    .filter((metric): metric is VitalsViewData["metrics"][number] =>
      Boolean(metric)
    );
}

function formatVitalValue(metric: VitalsViewData["metrics"][number]) {
  if (metric.latestValue == null) return "No reading";
  return `${metric.latestValue.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${metric.unit}`;
}

function WidgetHeading({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
          {eyebrow}
        </div>
        <h2 className="mt-1 text-xl font-semibold text-[var(--ui-ink-strong)]">
          {title}
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--ui-ink-soft)]">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

function DestinationLink({
  destination,
  showDetail = false
}: {
  destination: OverviewDestination;
  showDetail?: boolean;
}) {
  if (!showDetail) {
    return (
      <Link
        to={destination.href}
        title={destination.detail}
        aria-label={`${destination.label}: ${destination.detail}`}
        className="min-h-11 min-w-0 rounded-[14px] px-3 py-3 text-sm font-medium text-[var(--ui-ink-strong)] transition hover:bg-[var(--ui-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
      >
        {destination.label}
      </Link>
    );
  }
  return (
    <Link
      to={destination.href}
      className="group flex min-h-11 min-w-0 items-start justify-between gap-3 rounded-[16px] px-3 py-2.5 transition hover:bg-[var(--ui-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--ui-ink-strong)]">
          {destination.label}
        </span>
        <span className="mt-0.5 block text-xs leading-5 text-[var(--ui-ink-faint)]">
          {destination.detail}
        </span>
      </span>
    </Link>
  );
}

function StatusTile({
  to,
  icon: Icon,
  label,
  value,
  detail,
  tone = "neutral"
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "warning" | "good";
}) {
  return (
    <Link
      to={to}
      className="group min-w-0 rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={cn(
            "rounded-full p-2",
            tone === "warning"
              ? "bg-[var(--ui-warning-soft)] text-[var(--warning)]"
              : tone === "good"
                ? "bg-[var(--ui-success-soft)] text-[var(--success)]"
                : "bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]"
          )}
        >
          <Icon aria-hidden="true" className="size-4" />
        </div>
        <ArrowRight
          aria-hidden="true"
          className="size-3.5 text-[var(--ui-ink-faint)] transition group-hover:translate-x-0.5"
        />
      </div>
      <div className="mt-3 text-[11px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-[var(--ui-ink-strong)]">
        {value}
      </div>
      <div className="mt-1 text-xs leading-5 text-[var(--ui-ink-soft)]">
        {detail}
      </div>
    </Link>
  );
}

function HealthLink({
  to,
  label,
  value,
  detail,
  loading,
  error
}: {
  to: string;
  label: string;
  value: string;
  detail: string;
  loading?: boolean;
  error?: boolean;
}) {
  return (
    <Link
      to={to}
      className="group min-w-0 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 transition hover:bg-[var(--ui-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-[var(--ui-ink-strong)]">
          {label}
        </span>
        <ArrowRight
          aria-hidden="true"
          className="size-3.5 text-[var(--ui-ink-faint)] transition group-hover:translate-x-0.5"
        />
      </div>
      <div className="mt-3 text-lg font-semibold text-[var(--ui-ink-strong)]">
        {loading ? "Loading…" : error ? "Unavailable" : value}
      </div>
      <div className="mt-1 text-xs leading-5 text-[var(--ui-ink-soft)]">
        {error
          ? `${label} could not be loaded. Open the full page to try again.`
          : detail}
      </div>
    </Link>
  );
}

export function OverviewPage() {
  const shell = useForgeShell();
  const snapshot = shell.snapshot;
  const selectedUserIds = shell.selectedUserIds ?? [];
  const [createTarget, setCreateTarget] = useState<HTMLDivElement | null>(null);

  const todayDateKey = localDateKey();
  const sleepQuery = useQuery({
    queryKey: ["forge-overview-sleep", ...selectedUserIds],
    queryFn: async () => (await getSleepView(selectedUserIds)).sleep,
    staleTime: 60_000
  });
  const fitnessQuery = useQuery({
    queryKey: ["forge-overview-fitness", ...selectedUserIds],
    queryFn: async () =>
      (await getFitnessView(selectedUserIds, { compact: true })).fitness,
    staleTime: 60_000
  });
  const movementDayQuery = useQuery({
    queryKey: ["forge-overview-movement-day", todayDateKey, ...selectedUserIds],
    queryFn: async () =>
      (await getMovementDay({ date: todayDateKey, userIds: selectedUserIds }))
        .movement,
    staleTime: 60_000
  });
  const vitalsQuery = useQuery({
    queryKey: ["forge-overview-vitals", ...selectedUserIds],
    queryFn: async () => (await getVitalsView(selectedUserIds)).vitals,
    staleTime: 60_000
  });
  const attentionQuery = useQuery({
    queryKey: ["forge-overview-attention", ...selectedUserIds],
    queryFn: () =>
      getAttentionInbox({
        state: "active",
        limit: 6,
        userIds: selectedUserIds
      }),
    staleTime: 30_000
  });
  const isOperator = shell.operatorSession.profile === "operator";
  const doctorQuery = useGetForgeDoctorQuery(undefined, { skip: !isOperator });
  const xpMetricsQuery = useGetXpMetricsQuery(selectedUserIds);
  const createActions = useForgeCreateActions({
    goals: snapshot.dashboard.goals,
    projects: snapshot.dashboard.projects,
    tasks: snapshot.tasks,
    strategies: snapshot.strategies,
    habits: snapshot.habits,
    tags: snapshot.tags,
    users: snapshot.users,
    defaultUserId: selectedUserIds.length === 1 ? selectedUserIds[0] : null,
    onCreateGoal: shell.createGoal,
    onCreateProject: shell.createProject,
    onCreateTask: shell.createTask
  });

  const topTask =
    snapshot.overview.topTasks[0] ?? snapshot.today.directive.task ?? null;
  const topHabit = snapshot.overview.dueHabits[0] ?? null;
  const activeRun = snapshot.activeTaskRuns[0] ?? null;
  const currentWorkHref = activeRun
    ? `/tasks/${activeRun.taskId}`
    : topTask
      ? `/tasks/${topTask.id}`
      : "/today";
  const currentWorkTitle =
    activeRun?.taskTitle ?? topTask?.title ?? "Nothing selected";
  const recentActivity = snapshot.overview.recentEvidence.slice(0, 3);
  const attention = attentionQuery.data;
  const doctor = doctorQuery.data?.doctor;
  const riskCount = new Set([
    ...snapshot.risk.blockedTasks.map((task) => task.id),
    ...snapshot.risk.overdueTasks.map((task) => task.id)
  ]).size;
  const scopeLabel =
    snapshot.userScope.selectedUsers.length === 1
      ? (snapshot.userScope.selectedUsers[0]?.displayName ?? "1 user")
      : snapshot.userScope.selectedUsers.length > 1
        ? `${snapshot.userScope.selectedUsers.length} users`
        : "Current scope";
  const heroStatus =
    snapshot.metrics.momentumScore >= 80
      ? "Strong"
      : snapshot.metrics.momentumScore >= 60
        ? "Steady"
        : "Needs attention";
  const sleepSummary = sleepQuery.data?.summary ?? null;
  const fitnessSummary = fitnessQuery.data?.summary ?? null;
  const movementDay = movementDayQuery.data;
  const vitals = vitalsQuery.data;
  const movementPlaces = buildMovementPlaceBreakdown(movementDay);
  const vitalRows = buildVitalsHighlightRows(vitals);

  const openSearch = () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        code: "KeyK",
        metaKey: true,
        ctrlKey: true,
        bubbles: true
      })
    );
  };

  const widgets: SurfaceWidgetDefinition[] = [
    {
      id: "hero",
      title: "Overview",
      description: "The front door to every part of Forge.",
      defaultWidth: 12,
      defaultHeight: 2,
      removable: false,
      minHeight: 2,
      maxHeight: 3,
      surfaceChrome: "none",
      defaultTitleVisible: false,
      defaultDescriptionVisible: false,
      render: () => (
        <PageHero
          title="Overview"
          titleText="Overview"
          description="See what needs attention, continue current work, or open any part of Forge."
          badge={scopeLabel}
          actions={
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openSearch}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 text-sm font-medium text-[var(--ui-ink-strong)] transition hover:bg-[var(--ui-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
              >
                <Search aria-hidden="true" className="size-4" /> Search Forge
              </button>
              <div
                ref={setCreateTarget}
                className="min-h-11"
                aria-label="Create in Forge"
              />
              <Link
                to="/attention"
                className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-[var(--ui-ink-medium)] hover:text-[var(--ui-ink-strong)]"
              >
                Attention
              </Link>
              <Link
                to="/workbench"
                className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-[var(--ui-ink-medium)] hover:text-[var(--ui-ink-strong)]"
              >
                Continue work
              </Link>
              <a
                href="#forge-map"
                className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-[var(--ui-ink-medium)] hover:text-[var(--ui-ink-strong)]"
              >
                Explore Forge
              </a>
              <CreateMenu
                actions={createActions.actions}
                mobileTriggerTarget={createTarget}
                desktopTriggerTarget={createTarget}
              />
            </div>
          }
        />
      )
    },
    {
      id: "gamification",
      title: "Forge Smith",
      description: "Level, XP, streak, trophy, and unlock state.",
      defaultWidth: 4,
      defaultHeight: 3,
      minWidth: 4,
      minHeight: 3,
      removable: false,
      surfaceChrome: "none",
      defaultTitleVisible: false,
      defaultDescriptionVisible: false,
      render: () => (
        <GamificationOverviewWidget
          metrics={
            xpMetricsQuery.data?.metrics ?? buildOverviewXpFallback(snapshot)
          }
          compact
          statusMessage={
            xpMetricsQuery.isError
              ? "Progression could not be refreshed. The latest Overview snapshot is shown."
              : xpMetricsQuery.data
                ? undefined
                : "Refreshing progression from the reward ledger."
          }
        />
      )
    },
    {
      id: "what-matters",
      title: "What matters now",
      description: "Current attention, work, habits, and system health.",
      defaultWidth: 8,
      defaultHeight: 3,
      minWidth: 6,
      minHeight: 3,
      removable: false,
      defaultTitleVisible: false,
      defaultDescriptionVisible: false,
      render: () => (
        <div className="min-w-0">
          <WidgetHeading
            eyebrow="Start here"
            title="What matters now"
            description="Open the work, decision, or system area that needs attention."
          />
          <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatusTile
              to="/attention"
              icon={
                attentionQuery.isLoading
                  ? Clock3
                  : attentionQuery.isError
                    ? AlertTriangle
                    : attention?.summary.activeCount
                      ? AlertTriangle
                      : CheckCircle2
              }
              label="Attention"
              value={
                attentionQuery.isLoading
                  ? "Loading…"
                  : attentionQuery.isError
                    ? "Unavailable"
                    : `${attention?.summary.activeCount ?? 0} active`
              }
              detail={
                attentionQuery.isLoading
                  ? "Checking current attention"
                  : attentionQuery.isError
                    ? "Attention could not be loaded. Other Forge areas are still available."
                    : attention?.summary.activeCount
                      ? `${attention.summary.blockingCount} blocking and ${attention.summary.importantCount} important`
                      : "No items need attention"
              }
              tone={
                attentionQuery.isError || attention?.summary.activeCount
                  ? "warning"
                  : attentionQuery.isLoading
                    ? "neutral"
                    : "good"
              }
            />
            <StatusTile
              to={currentWorkHref}
              icon={LayoutDashboard}
              label="Current work"
              value={currentWorkTitle}
              detail={
                activeRun
                  ? `${snapshot.activeTaskRuns.length} ${snapshot.activeTaskRuns.length === 1 ? "run is" : "runs are"} active`
                  : topTask
                    ? "Open the clearest current task"
                    : "Choose work from Today"
              }
            />
            <StatusTile
              to={riskCount ? "/kanban" : "/habits"}
              icon={riskCount ? AlertTriangle : CalendarDays}
              label={riskCount ? "Work risks" : "Due habits"}
              value={
                riskCount
                  ? `${riskCount} need review`
                  : `${snapshot.overview.dueHabits.length} due`
              }
              detail={
                riskCount
                  ? `${snapshot.risk.blockedTasks.length} blocked and ${snapshot.risk.overdueTasks.length} overdue`
                  : topHabit
                    ? topHabit.title
                    : "No habits are due"
              }
              tone={riskCount ? "warning" : "neutral"}
            />
            <StatusTile
              to="/settings"
              icon={Wrench}
              label="System health"
              value={
                !isOperator
                  ? "Permission required"
                  : doctorQuery.isLoading
                    ? "Checking…"
                    : doctorQuery.isError
                      ? "Unavailable"
                      : doctor
                        ? `${doctor.integrity.score}/100`
                        : "No report"
              }
              detail={
                !isOperator
                  ? "Doctor details require local-operator access"
                  : doctorQuery.isError
                    ? "Health details could not be loaded"
                    : (doctor?.integrity.headline ??
                      "System health is being checked")
              }
              tone={
                doctor?.integrity.status === "healthy"
                  ? "good"
                  : doctor?.integrity.status || doctorQuery.isError
                    ? "warning"
                    : "neutral"
              }
            />
          </div>
          {attentionQuery.isError ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-[var(--ui-ink-soft)]">
              <span>Attention is unavailable on this page.</span>
              <button
                type="button"
                onClick={() => void attentionQuery.refetch()}
                className="min-h-10 rounded-full px-3 font-medium text-[var(--primary)] hover:bg-[var(--ui-accent-soft)]"
              >
                Try again
              </button>
            </div>
          ) : attention?.items.length ? (
            <div
              className="mt-3 flex min-w-0 flex-wrap gap-2"
              aria-label="Leading attention items"
            >
              {attention.items.slice(0, 3).map((item) => (
                <Link
                  key={item.id}
                  to={item.target.href}
                  className="inline-flex min-h-10 min-w-0 max-w-full items-center gap-2 rounded-full bg-[var(--ui-surface-2)] px-3 text-sm text-[var(--ui-ink-medium)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                >
                  <span className="truncate">{item.title}</span>
                  <ArrowRight
                    aria-hidden="true"
                    className="size-3.5 shrink-0"
                  />
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      )
    },
    {
      id: "signals",
      title: "Continue where you left off",
      description: "Return to current work or recent evidence.",
      defaultWidth: 12,
      defaultHeight: 3,
      minWidth: 6,
      defaultTitleVisible: false,
      defaultDescriptionVisible: false,
      render: ({ compact }) => (
        <div className="min-w-0">
          <WidgetHeading
            eyebrow="Continue"
            title="Continue where you left off"
            description="Return to an active task, the current daily direction, or recent evidence."
            action={
              <Link
                to="/activity"
                className="inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-sm font-medium text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
              >
                All activity{" "}
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </Link>
            }
          />
          <div
            className={cn(
              "mt-4 grid gap-3",
              compact ? "grid-cols-1" : "md:grid-cols-3"
            )}
          >
            <DestinationLink
              showDetail
              destination={{
                label: activeRun ? "Active task run" : "Current work",
                href: currentWorkHref,
                detail: activeRun
                  ? activeRun.taskTitle
                  : (topTask?.title ?? "Choose a task from Today")
              }}
            />
            <DestinationLink
              showDetail
              destination={{
                label: "Daily briefing",
                href: "/today#daily-briefing",
                detail:
                  snapshot.today.directive.task?.title ??
                  snapshot.today.directive.sessionLabel ??
                  "Review sourced work, schedule, capacity, and recent activity"
              }}
            />
            {recentActivity[0] ? (
              <DestinationLink
                showDetail
                destination={{
                  label: getReadableActivityTitle(recentActivity[0]),
                  href:
                    getActivityEventHref(recentActivity[0]) ??
                    `/activity?eventId=${recentActivity[0].id}`,
                  detail: getReadableActivityDescription(recentActivity[0])
                }}
              />
            ) : (
              <DestinationLink
                showDetail
                destination={{
                  label: "Recent activity",
                  href: "/activity",
                  detail: "No recent activity for this user scope"
                }}
              />
            )}
          </div>
        </div>
      )
    },
    {
      id: "forge-map",
      title: "Everything in Forge",
      description: "A complete map of Forge’s supported areas.",
      defaultWidth: 12,
      defaultHeight: 7,
      minWidth: 6,
      minHeight: 4,
      removable: false,
      defaultTitleVisible: false,
      defaultDescriptionVisible: false,
      render: () => (
        <div id="forge-map" className="min-w-0 scroll-mt-24">
          <WidgetHeading
            eyebrow="Find any area"
            title="Everything in Forge"
            description="Choose an area by what you want to understand or do. Every destination below opens an existing Forge page."
          />
          <div className="mt-5 grid min-w-0 gap-4 xl:grid-cols-2">
            {FORGE_OVERVIEW_GROUPS.map((group) => {
              const Icon = group.icon;
              return (
                <section
                  key={group.id}
                  aria-labelledby={`forge-map-${group.id}`}
                  className={cn(
                    "min-w-0 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-3",
                    group.id === "system" && "xl:col-span-2"
                  )}
                >
                  <div className="flex items-start gap-3 px-2 pb-2 pt-1">
                    <div className="rounded-full bg-[var(--ui-surface-2)] p-2 text-[var(--ui-ink-medium)]">
                      <Icon aria-hidden="true" className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <h3
                        id={`forge-map-${group.id}`}
                        className="text-base font-semibold text-[var(--ui-ink-strong)]"
                      >
                        {group.title}
                      </h3>
                      <p className="mt-1 text-sm leading-5 text-[var(--ui-ink-soft)]">
                        {group.description}
                      </p>
                    </div>
                  </div>
                  <div
                    className={cn(
                      "grid min-w-0 grid-cols-2",
                      group.id === "system" && "xl:grid-cols-3"
                    )}
                  >
                    {group.destinations.map((destination) => (
                      <DestinationLink
                        key={destination.href}
                        destination={destination}
                      />
                    ))}
                  </div>
                  {group.advanced ? (
                    <details className="mt-2 border-t border-[var(--ui-border-subtle)] px-2 pt-2">
                      <summary className="min-h-11 cursor-pointer rounded-[14px] px-2 py-3 text-sm font-medium text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]">
                        {group.advanced.label}
                      </summary>
                      <div className="grid min-w-0 grid-cols-2 pb-1 xl:grid-cols-3">
                        {group.advanced.destinations.map((destination) => (
                          <DestinationLink
                            key={destination.href}
                            destination={destination}
                          />
                        ))}
                      </div>
                    </details>
                  ) : null}
                </section>
              );
            })}
          </div>
        </div>
      )
    },
    {
      id: "body-signals",
      title: "Health and capacity",
      description: "Recent health evidence and capacity context.",
      defaultWidth: 12,
      defaultHeight: 4,
      minWidth: 6,
      defaultDescriptionVisible: false,
      render: () => (
        <div className="min-w-0">
          <WidgetHeading
            eyebrow="Capacity"
            title="Health and capacity"
            description="Recent imported evidence can help plan effort. It is not medical advice or a diagnosis."
          />
          <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <HealthLink
              to="/life-force"
              label="Life Force"
              value={
                snapshot.lifeForce
                  ? formatLifeForceAp(snapshot.lifeForce.remainingAp)
                  : "Not configured"
              }
              detail={
                snapshot.lifeForce
                  ? `Remaining from ${formatLifeForceAp(snapshot.lifeForce.dailyBudgetAp)} today`
                  : "Set up a capacity profile to begin"
              }
            />
            <HealthLink
              to="/sleep"
              label="Sleep"
              loading={sleepQuery.isLoading}
              error={sleepQuery.isError}
              value={
                sleepSummary?.totalSleepSeconds
                  ? formatCompactDuration(sleepSummary.averageSleepSeconds)
                  : "No recent data"
              }
              detail={
                sleepSummary?.totalSleepSeconds
                  ? `Average sleep score ${Math.round(sleepSummary.averageSleepScore)}`
                  : "Sleep summaries appear after an import"
              }
            />
            <HealthLink
              to="/sports"
              label="Sports"
              loading={fitnessQuery.isLoading}
              error={fitnessQuery.isError}
              value={
                fitnessSummary?.workoutCount
                  ? `${fitnessSummary.workoutCount} workouts`
                  : "No recent data"
              }
              detail={
                fitnessSummary?.workoutCount
                  ? `${Math.round(fitnessSummary.exerciseMinutes)} exercise minutes`
                  : "Workout summaries appear after an import"
              }
            />
            <HealthLink
              to="/vitals"
              label="Vitals"
              loading={vitalsQuery.isLoading}
              error={vitalsQuery.isError}
              value={
                vitals?.summary.metricCount
                  ? `${vitals.summary.metricCount} metrics`
                  : "No recent data"
              }
              detail={
                vitalRows[0]
                  ? `${vitalRows[0].label}: ${formatVitalValue(vitalRows[0])}`
                  : "Vitals appear after an import"
              }
            />
            <HealthLink
              to="/movement"
              label="Movement"
              loading={movementDayQuery.isLoading}
              error={movementDayQuery.isError}
              value={
                movementDay?.summary.totalMovingSeconds
                  ? formatCompactDuration(
                      movementDay.summary.totalMovingSeconds
                    )
                  : "No movement today"
              }
              detail={
                movementPlaces[0]
                  ? `${formatCompactDuration(movementPlaces[0].seconds)} at ${movementPlaces[0].label}`
                  : "Places and trips appear after companion sync"
              }
            />
          </div>
          {snapshot.lifeForce?.provenance ||
          vitals?.provenance ||
          movementDay?.provenance ? (
            <div className="mt-3 grid gap-2 xl:grid-cols-3">
              {snapshot.lifeForce?.provenance ? (
                <ProvenanceSummary
                  provenance={snapshot.lifeForce.provenance}
                  href="/life-force"
                  actionLabel="Open Life Force"
                />
              ) : null}
              {vitals?.provenance ? (
                <ProvenanceSummary
                  provenance={vitals.provenance}
                  href="/vitals"
                  actionLabel="Open Vitals"
                />
              ) : null}
              {movementDay?.provenance ? (
                <ProvenanceSummary
                  provenance={movementDay.provenance}
                  href="/movement"
                  actionLabel="Open Movement"
                />
              ) : null}
            </div>
          ) : null}
        </div>
      )
    },
    {
      id: "summary",
      title: "Progress snapshot",
      description: "Optional capacity and progression details.",
      defaultWidth: 12,
      defaultHeight: 2,
      defaultHidden: true,
      defaultTitleVisible: false,
      defaultDescriptionVisible: false,
      render: () => {
        const metrics = [
          {
            label: "Momentum",
            value: `${snapshot.metrics.momentumScore}`,
            detail: heroStatus,
            help: OVERVIEW_METRIC_HELP.Momentum
          },
          {
            label: "Level",
            value: `L${snapshot.metrics.level}`,
            detail: `${snapshot.metrics.currentLevelXp} XP in this level`,
            help: OVERVIEW_METRIC_HELP.Level
          },
          {
            label: "Weekly XP",
            value: `${snapshot.metrics.weeklyXp}`,
            detail: `${snapshot.metrics.totalXp} total XP`,
            help: OVERVIEW_METRIC_HELP["Weekly XP"]
          },
          {
            label: "Life Force",
            value: snapshot.lifeForce
              ? formatLifeForceRate(snapshot.lifeForce.instantFreeApPerHour)
              : "Not set",
            detail: "Current free capacity",
            help: OVERVIEW_METRIC_HELP["Life Force"]
          }
        ];
        return (
          <div className="min-w-0">
            <WidgetHeading
              eyebrow="Optional detail"
              title="Progress snapshot"
              description="Capacity and progression for the selected user scope."
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {metrics.map((metric) => (
                <div
                  key={metric.label}
                  className="border-l border-[var(--ui-border-subtle)] pl-3"
                >
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-[var(--ui-ink-faint)]">
                    {metric.label}
                    <InfoTooltip
                      label={`Explain ${metric.label}`}
                      title={metric.label}
                      content={metric.help}
                    />
                  </div>
                  <div className="mt-1 text-lg font-semibold text-[var(--ui-ink-strong)]">
                    {metric.value}
                  </div>
                  <div className="mt-1 text-xs text-[var(--ui-ink-soft)]">
                    {metric.detail}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      }
    },
    {
      id: "pipeline",
      title: "Work details",
      description: "Optional counts for projects, habits, and tasks.",
      defaultWidth: 12,
      defaultHeight: 2,
      defaultHidden: true,
      defaultDescriptionVisible: false,
      render: () => (
        <div className="min-w-0">
          <WidgetHeading
            eyebrow="Optional detail"
            title="Work details"
            description="Open the complete list for each kind of work."
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <StatusTile
              to="/projects"
              icon={Compass}
              label="Projects"
              value={`${snapshot.projects.length}`}
              detail="Open all projects"
            />
            <StatusTile
              to="/habits"
              icon={History}
              label="Habits"
              value={`${snapshot.habits.length}`}
              detail="Open all habits"
            />
            <StatusTile
              to="/kanban"
              icon={LayoutDashboard}
              label="Issues and tasks"
              value={`${snapshot.tasks.length}`}
              detail="Open the work board"
            />
          </div>
        </div>
      )
    },
    {
      id: "goals",
      title: "Goals",
      description: "Optional long-range direction.",
      defaultWidth: 12,
      defaultHeight: 3,
      defaultHidden: true,
      defaultDescriptionVisible: false,
      render: ({ compact }) => (
        <div className="min-w-0">
          <WidgetHeading
            eyebrow="Optional detail"
            title="Goals"
            description="Long-range outcomes remain available without defining the whole Overview."
            action={
              <Link
                to="/goals"
                className="inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-sm font-medium text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)]"
              >
                All goals <ArrowRight aria-hidden="true" className="size-3.5" />
              </Link>
            }
          />
          <div className={cn("mt-4 grid gap-3", !compact && "md:grid-cols-2")}>
            {snapshot.overview.activeGoals
              .slice(0, compact ? 2 : 4)
              .map((goal) => (
                <Link
                  key={goal.id}
                  to={`/goals/${goal.id}`}
                  className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 transition hover:bg-[var(--ui-surface-hover)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-[var(--ui-ink-strong)]">
                      {goal.title}
                    </span>
                    <Badge>{goal.progress}%</Badge>
                  </div>
                  <div className="mt-3">
                    <ProgressMeter value={goal.progress} />
                  </div>
                </Link>
              ))}
            {snapshot.overview.activeGoals.length === 0 ? (
              <p className="text-sm text-[var(--ui-ink-soft)]">
                No active goals for this user scope.
              </p>
            ) : null}
          </div>
        </div>
      )
    },
    {
      id: "life-force",
      title: "Life Force details",
      description: "Optional capacity curve and drains.",
      defaultWidth: 12,
      defaultHeight: 7,
      minWidth: 6,
      defaultHidden: true,
      defaultTitleVisible: false,
      defaultDescriptionVisible: false,
      render: () =>
        snapshot.lifeForce ? (
          <LifeForceOverviewWorkspace
            selectedUserIds={selectedUserIds}
            fallbackLifeForce={snapshot.lifeForce}
            onRefresh={shell.refresh}
            showEditor={false}
          />
        ) : (
          <Card className="rounded-[24px] p-5 text-sm text-[var(--ui-ink-soft)]">
            Life Force is not configured for this user yet.
          </Card>
        )
    },
    {
      id: "time",
      title: "Clock",
      description: "Optional utility widget.",
      defaultWidth: 3,
      defaultHeight: 2,
      defaultHidden: true,
      render: ({ compact }) => <TimeWidget compact={compact} />
    },
    {
      id: "weather",
      title: "Weather",
      description: "Optional utility widget.",
      defaultWidth: 3,
      defaultHeight: 2,
      defaultHidden: true,
      render: ({ compact }) => <WeatherWidget compact={compact} />
    },
    {
      id: "mini-calendar",
      title: "Mini calendar",
      description: "Optional utility widget.",
      defaultWidth: 4,
      defaultHeight: 3,
      defaultHidden: true,
      render: ({ compact }) => <MiniCalendarWidget compact={compact} />
    },
    {
      id: "spotify",
      title: "Spotify",
      description: "Optional utility widget.",
      defaultWidth: 4,
      defaultHeight: 2,
      defaultHidden: true,
      render: () => <SpotifyWidget surfaceId="overview" />
    },
    {
      id: "quick-capture",
      title: "Quick capture",
      description: "Save a note or Wiki draft.",
      defaultWidth: 5,
      defaultHeight: 3,
      defaultHidden: true,
      render: ({ compact }) => (
        <QuickCaptureWidget
          compact={compact}
          defaultUserId={selectedUserIds[0] ?? snapshot.users[0]?.id ?? null}
        />
      )
    }
  ];

  return (
    <>
      <AiSurfaceWorkspace
        surfaceId="overview"
        baseWidgets={widgets}
        normalizeLayout={normalizeOverviewLayout}
      />
      {createActions.dialogs}
    </>
  );
}
