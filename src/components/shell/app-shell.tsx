import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  useIsFetching,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Bot,
  BookCopy,
  BrainCircuit,
  BriefcaseBusiness,
  BatteryCharging,
  CalendarDays,
  Check,
  ChevronsLeft,
  ChevronsRight,
  Clock3,
  Dumbbell,
  Flame,
  GitBranch,
  GripVertical,
  LayoutDashboard,
  LayoutGrid,
  Map,
  HeartPulse,
  Network,
  Moon,
  NotebookPen,
  Orbit,
  Radar,
  RefreshCcw,
  Repeat,
  Search,
  Settings,
  SlidersHorizontal,
  Target,
  Trophy,
  UserRound,
  Users,
  Zap
} from "lucide-react";
import {
  Link,
  NavLink,
  UNSAFE_LocationContext,
  useLocation,
  useNavigate,
  useOutlet,
  useOutletContext
} from "react-router-dom";
import type { Location as RouterLocation } from "react-router-dom";
import { AmbientActivityPill } from "@/components/experience/ambient-activity-pill";
import {
  GamificationCelebrationLayer,
  GamificationMiniHud
} from "@/components/gamification/gamification-widgets";
import { GamificationAssetSetupDialog } from "@/components/gamification/gamification-asset-setup-dialog";
import { ActionBar } from "@/components/experience/action-bar";
import { RouteTransitionFrame } from "@/components/experience/route-transition-frame";
import { SheetScaffold } from "@/components/experience/sheet-scaffold";
import { KnowledgeGraphFocusDrawer } from "@/components/knowledge-graph/knowledge-graph-focus-drawer";
import { CreateMenu, useForgeCreateActions } from "@/components/create-menu";
import { PSYCHE_SECTIONS } from "@/components/psyche/psyche-section-nav";
import { StartWorkComposer } from "@/components/start-work-composer";
import {
  TaskTimerRailProvider,
  TaskTimerRailBar,
  TaskTimerRailPanel
} from "@/components/shell/task-timer-rail";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { useLiveEvents } from "@/hooks/use-live-events";
import {
  claimTaskRun,
  completeTaskRun,
  createGoal,
  createProject,
  createTask,
  getXpMetrics,
  markGamificationCelebrationSeen,
  patchGoal,
  patchProject,
  patchTask,
  focusTaskRun,
  recordSessionEvent,
  releaseTaskRun
} from "@/lib/api";
import { ForgeApiError } from "@/lib/api-error";
import { I18nProvider, useI18n, type TranslationKey } from "@/lib/i18n";
import {
  formatKnowledgeGraphFocusValue,
  type KnowledgeGraphNode
} from "@/lib/knowledge-graph-types";
import { formatLifeForceRate } from "@/lib/life-force-display";
import { getEntityNotesHref } from "@/lib/note-helpers";
import { cn } from "@/lib/utils";
import { isShellRouteReady } from "@/features/shell/route-readiness";
import {
  selectPendingRtkRequestCount,
  selectSelectedUserIds
} from "@/features/shell/selectors";
import { useShellBackgroundActivity } from "@/features/shell/use-shell-background-activity";
import { useShellCollapseController } from "@/features/shell/use-shell-collapse-controller";
import { useShellRouteHandoff } from "@/features/shell/use-shell-route-handoff";
import { useShellSessionTelemetry } from "@/features/shell/use-shell-session-telemetry";
import { useShellTaskHeartbeat } from "@/features/shell/use-shell-task-heartbeat";
import { useShellThemeController } from "@/features/shell/use-shell-theme-controller";
import type {
  GoalMutationInput,
  ProjectMutationInput,
  QuickTaskInput
} from "@/lib/schemas";
import type {
  CalendarSchedulingRules,
  ForgeSnapshot,
  SettingsPayload,
  TaskRun,
  UserSummary,
  WikiIngestJobPayload
} from "@/lib/types";
import {
  useClaimTaskRunMutation,
  useCompleteTaskRunMutation,
  useCreateGoalMutation,
  useCreateProjectMutation,
  useCreateTaskMutation,
  useFocusTaskRunMutation,
  useGetOperatorSessionQuery,
  useGetSettingsQuery,
  useGetSnapshotQuery,
  usePatchGoalMutation,
  usePatchProjectMutation,
  usePatchTaskMutation,
  usePatchTaskStatusMutation,
  useReleaseTaskRunMutation
} from "@/store/api/forge-api";
import { invalidateForgeSnapshot } from "@/store/api/invalidate-forge-snapshot";
import {
  clearKnowledgeGraphOverlayFocus,
  setSelectedUserIds as setSelectedUserIdsAction
} from "@/store/slices/shell-slice";
import { useAppDispatch, useAppSelector } from "@/store/typed-hooks";

type ShellContextValue = {
  snapshot: ForgeSnapshot;
  selectedUserIds: string[];
  setSelectedUserIds: (userIds: string[]) => void;
  refresh: () => Promise<void>;
  createTask: (input: QuickTaskInput) => Promise<void>;
  startTaskNow: (
    taskId: string,
    options?: {
      timerMode?: "planned" | "unlimited";
      plannedDurationSeconds?: number | null;
    }
  ) => Promise<void>;
  stopTaskRun: (run: TaskRun) => Promise<void>;
  createGoal: (input: GoalMutationInput) => Promise<void>;
  createProject: (input: ProjectMutationInput) => Promise<void>;
  patchGoal: (goalId: string, patch: GoalMutationInput) => Promise<void>;
  patchProject: (
    projectId: string,
    patch: Partial<ProjectMutationInput> & {
      schedulingRules?: CalendarSchedulingRules | null;
    }
  ) => Promise<void>;
  patchTask: (
    taskId: string,
    patch: Parameters<typeof patchTask>[1]
  ) => Promise<void>;
  patchTaskStatus: (
    taskId: string,
    status: "backlog" | "focus" | "in_progress" | "blocked" | "done",
    options?: {
      completedTodayWorkSeconds?: number;
    }
  ) => Promise<void>;
  openStartWork: (defaults?: {
    taskId?: string | null;
    projectId?: string | null;
  }) => void;
};

function sameSelectedUserIds(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

export function sanitizeSelectedUserIds(
  selectedUserIds: string[],
  users: UserSummary[]
) {
  if (selectedUserIds.length === 0 || users.length === 0) {
    return selectedUserIds;
  }
  const validUserIds = new Set(users.map((user) => user.id));
  return selectedUserIds.filter((userId) => validUserIds.has(userId));
}

export function buildStartTaskNowInput(
  actor: string,
  options: {
    timerMode?: "planned" | "unlimited";
    plannedDurationSeconds?: number | null;
  } = {}
) {
  const timerMode = options.timerMode ?? "unlimited";
  const plannedDurationSeconds =
    options.plannedDurationSeconds === undefined
      ? timerMode === "planned"
        ? 20 * 60
        : null
      : options.plannedDurationSeconds;
  return {
    actor,
    timerMode,
    plannedDurationSeconds,
    isCurrent: true,
    leaseTtlSeconds: 1800,
    note: ""
  };
}

function getKnowledgeGraphNodeNotesHref(node: KnowledgeGraphNode) {
  switch (node.entityType) {
    case "workbench_flow":
    case "workbench_surface":
    case "wiki_space":
      return null;
    default:
      return getEntityNotesHref(node.entityType, node.entityId);
  }
}

function buildKnowledgeGraphSearchFromLocation(
  location: RouterLocation,
  node: KnowledgeGraphNode | null,
  extras?: Record<string, string | null>
) {
  const next = new URLSearchParams(location.search);
  if (!node) {
    next.delete("focus");
  } else {
    next.set(
      "focus",
      formatKnowledgeGraphFocusValue(node.entityType, node.entityId)
    );
  }
  if (extras) {
    for (const [key, value] of Object.entries(extras)) {
      if (value === null) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }
  }
  const query = next.toString();
  return query ? `?${query}` : "";
}

const ShellContext = createContext<ShellContextValue | null>(null);
let lastKnownShellContext: ShellContextValue | null = null;

type ShellRouteDefinition = {
  id: string;
  to: string;
  labelKey?: TranslationKey;
  detailKey?: TranslationKey;
  icon: typeof LayoutDashboard;
  label?: string;
  detail?: string;
};

const PRIMARY_ROUTES: ShellRouteDefinition[] = [
  {
    id: "overview",
    to: "/overview",
    labelKey: "common.routeLabels.overview",
    detailKey: "common.routeDetails.overview",
    icon: LayoutDashboard
  },
  {
    id: "life-force",
    to: "/life-force",
    label: "Life Force",
    detail: "Action Point capacity, weekday curves, and instant drains",
    icon: BatteryCharging
  },
  {
    id: "goals",
    to: "/goals",
    labelKey: "common.routeLabels.goals",
    detailKey: "common.routeDetails.goals",
    icon: Target
  },
  {
    id: "habits",
    to: "/habits",
    labelKey: "common.routeLabels.habits",
    detailKey: "common.routeDetails.habits",
    icon: Repeat
  },
  {
    id: "projects",
    to: "/projects",
    labelKey: "common.routeLabels.projects",
    detailKey: "common.routeDetails.projects",
    icon: BriefcaseBusiness
  },
  {
    id: "strategies",
    to: "/strategies",
    labelKey: "common.routeLabels.strategies",
    detailKey: "common.routeDetails.strategies",
    icon: GitBranch
  },
  {
    id: "preferences",
    to: "/preferences",
    labelKey: "common.routeLabels.preferences",
    detailKey: "common.routeDetails.preferences",
    icon: SlidersHorizontal
  },
  {
    id: "calendar",
    to: "/calendar",
    labelKey: "common.routeLabels.calendar",
    detailKey: "common.routeDetails.calendar",
    icon: CalendarDays
  },
  {
    id: "knowledge-graph",
    to: "/knowledge-graph",
    label: "Knowledge Graph",
    detail: "A living graph of Forge entities, links, and structural layers",
    icon: Orbit
  },
  {
    id: "workbench",
    to: "/workbench",
    label: "Workbench",
    detail: "Global graph flows, AI tools, and published outputs",
    icon: Network
  },
  {
    id: "movement",
    to: "/movement",
    labelKey: "common.routeLabels.movement",
    detailKey: "common.routeDetails.movement",
    icon: Map
  },
  {
    id: "sleep",
    to: "/sleep",
    labelKey: "common.routeLabels.sleep",
    detailKey: "common.routeDetails.sleep",
    icon: Moon
  },
  {
    id: "sports",
    to: "/sports",
    labelKey: "common.routeLabels.sports",
    detailKey: "common.routeDetails.sports",
    icon: Dumbbell
  },
  {
    id: "vitals",
    to: "/vitals",
    label: "Vitals",
    detail:
      "Recovery, cardio fitness, breathing, composition, and body signals",
    icon: HeartPulse
  },
  {
    id: "kanban",
    to: "/kanban",
    labelKey: "common.routeLabels.kanban",
    detailKey: "common.routeDetails.kanban",
    icon: Zap
  },
  {
    id: "today",
    to: "/today",
    labelKey: "common.routeLabels.today",
    detailKey: "common.routeDetails.today",
    icon: Clock3
  },
  {
    id: "rewards",
    to: "/rewards",
    label: "Trophy Hall",
    detail: "Forge Smith levels, streaks, trophies, and cosmetic unlocks",
    icon: Trophy
  },
  {
    id: "notes",
    to: "/notes",
    labelKey: "common.routeLabels.notes",
    detailKey: "common.routeDetails.notes",
    icon: NotebookPen
  },
  {
    id: "wiki",
    to: "/wiki",
    labelKey: "common.routeLabels.wiki",
    detailKey: "common.routeDetails.wiki",
    icon: BookCopy
  },
  {
    id: "psyche",
    to: "/psyche",
    labelKey: "common.routeLabels.psyche",
    detailKey: "common.routeDetails.psyche",
    icon: BrainCircuit
  },
  {
    id: "activity",
    to: "/activity",
    labelKey: "common.routeLabels.activity",
    detailKey: "common.routeDetails.activity",
    icon: ArrowUpRight
  },
  {
    id: "insights",
    to: "/insights",
    labelKey: "common.routeLabels.insights",
    detailKey: "common.routeDetails.insights",
    icon: Radar
  },
  {
    id: "review",
    to: "/review/weekly",
    labelKey: "common.routeLabels.review",
    detailKey: "common.routeDetails.review",
    icon: BarChart3
  },
  {
    id: "settings",
    to: "/settings",
    labelKey: "common.routeLabels.settings",
    detailKey: "common.routeDetails.settings",
    icon: Settings
  }
];

const PSYCHE_SHORTCUT_ROUTES: ShellRouteDefinition[] = PSYCHE_SECTIONS.filter(
  (route) => route.to !== "/psyche"
).map((route) => ({
  id: `psyche:${route.to}`,
  to: route.to,
  icon: route.icon,
  label: route.label,
  detail: "Psyche shortcut"
}));

const NAV_ROUTE_REGISTRY: ShellRouteDefinition[] = [
  ...PRIMARY_ROUTES,
  ...PSYCHE_SHORTCUT_ROUTES
];

const SHELL_NAV_ROUTES = PRIMARY_ROUTES.filter(
  (route) => route.to !== "/preferences" && route.to !== "/sleep"
);

function requirePrimaryRoute(id: string) {
  const route = PRIMARY_ROUTES.find((entry) => entry.id === id);
  if (!route) {
    throw new Error(`Missing primary route: ${id}`);
  }
  return route;
}

const MOBILE_CORE_ROUTES = [
  requirePrimaryRoute("overview"),
  requirePrimaryRoute("today"),
  requirePrimaryRoute("kanban"),
  requirePrimaryRoute("notes")
] as const;
const MOBILE_MORE_ROUTES = [
  requirePrimaryRoute("goals"),
  requirePrimaryRoute("habits"),
  requirePrimaryRoute("projects"),
  requirePrimaryRoute("strategies"),
  requirePrimaryRoute("rewards"),
  requirePrimaryRoute("calendar"),
  requirePrimaryRoute("knowledge-graph"),
  requirePrimaryRoute("workbench"),
  requirePrimaryRoute("movement"),
  requirePrimaryRoute("sports"),
  requirePrimaryRoute("vitals"),
  requirePrimaryRoute("wiki"),
  requirePrimaryRoute("psyche"),
  requirePrimaryRoute("activity"),
  requirePrimaryRoute("insights")
] as const;

const USER_SCOPE_STORAGE_KEY = "forge.selected-user-ids";
const DESKTOP_NAV_STORAGE_KEY = "forge.desktop-nav-layout";
const MOBILE_NAV_STORAGE_KEY = "forge.mobile-nav-layout";
const NAV_MIGRATION_STORAGE_KEY = "forge.nav-layout-migrations";
const DESKTOP_SIDEBAR_METRICS_POSITION_STORAGE_KEY =
  "forge.desktop-sidebar-metrics-position";
const DESKTOP_KNOWLEDGE_GRAPH_MIGRATION = "desktop-knowledge-graph-default-v1";
const MOBILE_KNOWLEDGE_GRAPH_MIGRATION = "mobile-knowledge-graph-default-v1";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function interpolateNumber(progress: number, from: number, to: number) {
  return from + (to - from) * progress;
}

function applyShellCollapseVariables(
  target: HTMLElement | null,
  progress: number
) {
  if (!target) {
    return;
  }
  target.style.setProperty("--forge-shell-collapse", progress.toFixed(4));
  target.style.setProperty(
    "--forge-shell-desktop-header-padding-top",
    `${interpolateNumber(progress, 18, 4)}px`
  );
  target.style.setProperty(
    "--forge-shell-desktop-header-padding-bottom",
    `${interpolateNumber(progress, 15, 4)}px`
  );
  target.style.setProperty(
    "--forge-shell-desktop-title-size",
    `${interpolateNumber(progress, 1.42, 0.96)}rem`
  );
  target.style.setProperty(
    "--forge-shell-desktop-primary-translate-y",
    `${interpolateNumber(progress, 0, 2)}px`
  );
  target.style.setProperty(
    "--forge-shell-desktop-primary-scale",
    `${interpolateNumber(progress, 1, 0.98)}`
  );
  target.style.setProperty(
    "--forge-shell-desktop-secondary-opacity",
    `${interpolateNumber(progress, 1, 0)}`
  );
  target.style.setProperty(
    "--forge-shell-desktop-secondary-max-height",
    `${interpolateNumber(progress, 176, 0)}px`
  );
  target.style.setProperty(
    "--forge-shell-desktop-secondary-spacing",
    `${interpolateNumber(progress, 14, 0)}px`
  );
  target.style.setProperty(
    "--forge-shell-desktop-secondary-translate-y",
    `${interpolateNumber(progress, 0, -18)}px`
  );
  target.style.setProperty(
    "--forge-shell-mobile-header-padding-top",
    `${interpolateNumber(progress, 14, 4)}px`
  );
  target.style.setProperty(
    "--forge-shell-mobile-header-padding-bottom",
    `${interpolateNumber(progress, 12, 4)}px`
  );
  target.style.setProperty(
    "--forge-shell-mobile-title-size",
    `${interpolateNumber(progress, 1.2, 0.9)}rem`
  );
  target.style.setProperty(
    "--forge-shell-mobile-primary-translate-y",
    `${interpolateNumber(progress, 0, 1)}px`
  );
  target.style.setProperty(
    "--forge-shell-mobile-primary-scale",
    `${interpolateNumber(progress, 1, 0.98)}`
  );
  target.style.setProperty(
    "--forge-shell-mobile-copy-opacity",
    `${interpolateNumber(progress, 1, 0)}`
  );
  target.style.setProperty(
    "--forge-shell-mobile-copy-max-height",
    `${interpolateNumber(progress, 320, 0)}px`
  );
  target.style.setProperty(
    "--forge-shell-mobile-copy-translate-y",
    `${interpolateNumber(progress, 0, -14)}px`
  );
  target.style.setProperty(
    "--forge-shell-hero-padding-top",
    `${interpolateNumber(progress, 20, 15)}px`
  );
  target.style.setProperty(
    "--forge-shell-hero-padding-bottom",
    `${interpolateNumber(progress, 20, 14)}px`
  );
  target.style.setProperty(
    "--forge-shell-hero-title-translate-y",
    `${interpolateNumber(progress, 0, -6)}px`
  );
  target.style.setProperty(
    "--forge-shell-hero-title-scale",
    `${interpolateNumber(progress, 1, 0.94)}`
  );
  target.style.setProperty(
    "--forge-shell-hero-description-opacity",
    `${interpolateNumber(progress, 1, 0.45)}`
  );
  target.style.setProperty(
    "--forge-shell-hero-description-translate-y",
    `${interpolateNumber(progress, 0, -5)}px`
  );
}

function readWindowScrollTop() {
  if (typeof window === "undefined") {
    return 0;
  }
  return Math.max(
    window.scrollY || 0,
    document.scrollingElement?.scrollTop || 0,
    document.documentElement?.scrollTop || 0,
    document.body?.scrollTop || 0
  );
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 0
  }).format(value);
}

function getRouteTransitionKey(pathname: string) {
  if (pathname === "/wiki" || pathname.startsWith("/wiki/page/")) {
    return "/wiki";
  }

  if (pathname === "/wiki/new" || pathname.startsWith("/wiki/edit/")) {
    return "/wiki/editor";
  }

  return pathname;
}

function isWikiRoute(pathname: string) {
  return (
    pathname === "/wiki" ||
    pathname.startsWith("/wiki/page/") ||
    pathname === "/wiki/new" ||
    pathname.startsWith("/wiki/edit/")
  );
}

function isPsycheRoute(pathname: string) {
  return (
    pathname.startsWith("/psyche") ||
    pathname === "/preferences" ||
    pathname.startsWith("/preferences/") ||
    pathname === "/sleep" ||
    pathname.startsWith("/sleep/")
  );
}

function getWikiIngestRoute(job: WikiIngestJobPayload) {
  const search = new URLSearchParams();
  if (job.job.spaceId) {
    search.set("spaceId", job.job.spaceId);
  }
  search.set("ingest", "1");
  search.set("ingestJobId", job.job.id);
  return {
    pathname: "/wiki",
    search: `?${search.toString()}`
  };
}

function formatActivityTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function readStoredSelectedUserIds() {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(USER_SCOPE_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeStoredSelectedUserIds(userIds: string[]) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      USER_SCOPE_STORAGE_KEY,
      JSON.stringify(Array.from(new Set(userIds)))
    );
  } catch {
    return;
  }
}

function sameUserScope(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }
  const leftKey = [...left].sort().join("|");
  const rightKey = [...right].sort().join("|");
  return leftKey === rightKey;
}

function routeMatches(pathname: string, route: ShellRouteDefinition) {
  if (route.to === "/psyche") {
    return isPsycheRoute(pathname);
  }
  return pathname === route.to || pathname.startsWith(`${route.to}/`);
}

function getRouteLabel(
  route: ShellRouteDefinition,
  t: (key: TranslationKey) => string
) {
  return route.labelKey ? t(route.labelKey) : (route.label ?? route.to);
}

function getRouteDetail(
  route: ShellRouteDefinition,
  t: (key: TranslationKey) => string
) {
  if (route.detailKey) {
    return t(route.detailKey);
  }
  return route.detail ?? route.to;
}

function readStoredNavIds(storageKey: string, defaults: string[]) {
  if (typeof window === "undefined") {
    return defaults;
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return defaults;
    }
    const validIds = new Set(NAV_ROUTE_REGISTRY.map((route) => route.id));
    const filtered = parsed.filter(
      (entry): entry is string =>
        typeof entry === "string" && validIds.has(entry)
    );
    const resolved = filtered.length > 0 ? filtered : defaults;
    const readMigrationState = () => {
      try {
        const rawMigrations = window.localStorage.getItem(
          NAV_MIGRATION_STORAGE_KEY
        );
        if (!rawMigrations) {
          return {} as Record<string, boolean>;
        }
        const parsedMigrations = JSON.parse(rawMigrations) as unknown;
        return parsedMigrations &&
          typeof parsedMigrations === "object" &&
          !Array.isArray(parsedMigrations)
          ? (parsedMigrations as Record<string, boolean>)
          : ({} as Record<string, boolean>);
      } catch {
        return {} as Record<string, boolean>;
      }
    };
    const writeMigrationState = (nextState: Record<string, boolean>) => {
      try {
        window.localStorage.setItem(
          NAV_MIGRATION_STORAGE_KEY,
          JSON.stringify(nextState)
        );
      } catch {
        return;
      }
    };
    const applyKnowledgeGraphMigration = (
      ids: string[],
      migrationKey: string,
      insertAfterId: string
    ) => {
      const migrationState = readMigrationState();
      if (migrationState[migrationKey]) {
        return ids;
      }
      const nextIds = ids.includes("knowledge-graph")
        ? ids
        : (() => {
            const insertIndex = ids.indexOf(insertAfterId);
            if (insertIndex < 0) {
              return [...ids, "knowledge-graph"];
            }
            return [
              ...ids.slice(0, insertIndex + 1),
              "knowledge-graph",
              ...ids.slice(insertIndex + 1)
            ];
          })();
      writeMigrationState({
        ...migrationState,
        [migrationKey]: true
      });
      return nextIds;
    };

    if (storageKey === DESKTOP_NAV_STORAGE_KEY) {
      return applyKnowledgeGraphMigration(
        resolved,
        DESKTOP_KNOWLEDGE_GRAPH_MIGRATION,
        "calendar"
      );
    }
    if (storageKey === MOBILE_NAV_STORAGE_KEY) {
      return applyKnowledgeGraphMigration(
        resolved,
        MOBILE_KNOWLEDGE_GRAPH_MIGRATION,
        "notes"
      );
    }
    return resolved;
  } catch {
    return defaults;
  }
}

function writeStoredNavIds(storageKey: string, ids: string[]) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(ids));
  } catch {
    return;
  }
}

function getInitials(label: string) {
  const parts = label
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return "??";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function buildUserScopeOptions(users: UserSummary[]) {
  const humans = users.filter((user) => user.kind === "human");
  const bots = users.filter((user) => user.kind === "bot");
  return [
    {
      id: "all",
      label: "All",
      shortLabel: "All",
      description: "Show every human and bot together.",
      userIds: [] as string[],
      token: "ALL",
      icon: Users
    },
    {
      id: "humans",
      label: "Humans",
      shortLabel: "Humans",
      description: "Focus only on human-owned work.",
      userIds: humans.map((user) => user.id),
      token: "HU",
      icon: UserRound
    },
    {
      id: "bots",
      label: "Bots",
      shortLabel: "Bots",
      description: "Focus only on bot-owned work.",
      userIds: bots.map((user) => user.id),
      token: "AI",
      icon: Bot
    },
    ...users.map((user) => ({
      id: user.id,
      label: user.displayName,
      shortLabel: user.displayName,
      description: `${user.kind === "human" ? "Human" : "Bot"} · ${user.handle}`,
      userIds: [user.id],
      token: getInitials(user.displayName),
      icon: user.kind === "human" ? UserRound : Bot
    }))
  ];
}

function resolveUserScopeOption(
  users: UserSummary[],
  selectedUserIds: string[]
) {
  return (
    buildUserScopeOptions(users).find((option) =>
      sameUserScope(selectedUserIds, option.userIds)
    ) ?? {
      id: "custom",
      label:
        selectedUserIds.length > 1
          ? `${selectedUserIds.length} selected`
          : "Custom",
      shortLabel:
        selectedUserIds.length > 1
          ? `${selectedUserIds.length} selected`
          : "Custom",
      description: "Using a custom combination of users.",
      userIds: selectedUserIds,
      token: selectedUserIds.length > 1 ? String(selectedUserIds.length) : "C",
      icon: Users
    }
  );
}

export function UserScopeSelector({
  users,
  selectedUserIds,
  onChange,
  compact = false
}: {
  users: UserSummary[];
  selectedUserIds: string[];
  onChange: (userIds: string[]) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const options = useMemo(() => buildUserScopeOptions(users), [users]);
  const activeOption = useMemo(
    () => resolveUserScopeOption(users, selectedUserIds),
    [selectedUserIds, users]
  );
  const ActiveScopeIcon = activeOption.icon;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={cn(
            "shell-scope-trigger inline-flex items-center gap-2",
            compact ? "px-2.5 text-[12px]" : "px-3.5 text-[13px]"
          )}
        >
          <span className="shell-scope-avatar">
            {activeOption.id === "all" ? (
              <ActiveScopeIcon className="size-3.5" />
            ) : (
              activeOption.token
            )}
          </span>
          <span
            className={cn(
              "truncate text-left",
              compact ? "max-w-[7.5rem]" : "max-w-[11rem]"
            )}
          >
            {activeOption.shortLabel}
          </span>
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgba(3,7,18,0.72)] backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-[12vh] z-50 w-[min(40rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-[30px] border border-white/10 bg-[rgba(10,15,28,0.97)] p-4 shadow-[0_32px_90px_rgba(0,0,0,0.45)] sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-display text-[1.25rem] tracking-[-0.04em] text-white">
                Choose user scope
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-[13px] leading-6 text-white/56">
                Change which humans and bots shape the current Forge view.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <ModalCloseButton aria-label="Close user scope dialog" />
            </Dialog.Close>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {options.map((option) => {
              const selected = sameUserScope(selectedUserIds, option.userIds);
              const Icon = option.icon;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-[24px] border px-4 py-4 text-left transition",
                    selected
                      ? "border-[rgba(192,193,255,0.24)] bg-[rgba(192,193,255,0.12)] text-white"
                      : "border-white/8 bg-white/[0.03] text-white/78 hover:bg-white/[0.06] hover:text-white"
                  )}
                  onClick={() => {
                    onChange(option.userIds);
                    setOpen(false);
                  }}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="shell-scope-avatar">
                      <Icon className="size-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-semibold">
                        {option.label}
                      </span>
                      <span className="mt-1 block text-[12px] leading-5 text-white/52">
                        {option.description}
                      </span>
                    </span>
                  </span>
                  {selected ? (
                    <Check className="size-4 shrink-0 text-[var(--primary)]" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function NavItem({
  route,
  compact = false
}: {
  route: ShellRouteDefinition;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const location = useLocation();
  const label = getRouteLabel(route, t);
  const Icon = route.icon;
  const forceActive = routeMatches(location.pathname, route);

  return (
    <NavLink
      to={route.to}
      title={compact ? label : undefined}
      aria-label={label}
      className={({ isActive }) =>
        `interactive-tap flex items-center rounded-[18px] text-sm transition ${
          isActive || forceActive
            ? "bg-white/[0.08] text-white shadow-[inset_0_0_0_1px_rgba(192,193,255,0.2)]"
            : "text-white/60 hover:bg-white/[0.04] hover:text-white"
        } ${compact ? "justify-center px-3 py-3.5" : "gap-3 px-4 py-3"}`
      }
    >
      <Icon className="size-4 shrink-0" />
      {!compact ? <span>{label}</span> : null}
    </NavLink>
  );
}

function MobileBottomNav({
  routes,
  onOpenEditor
}: {
  routes: ShellRouteDefinition[];
  onOpenEditor?: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const { t } = useI18n();
  const location = useLocation();
  const holdTimerRef = useRef<number | null>(null);
  const holdTriggeredRef = useRef(false);
  const visibleRoutes = routes.slice(0, 4);
  const moreRoutes = NAV_ROUTE_REGISTRY.filter(
    (route) => !visibleRoutes.some((entry) => entry.id === route.id)
  );

  function startHold() {
    holdTriggeredRef.current = false;
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
    }
    holdTimerRef.current = window.setTimeout(() => {
      holdTriggeredRef.current = true;
      setMoreOpen(false);
      onOpenEditor?.();
    }, 520);
  }

  function endHold() {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  return (
    <>
      <nav
        data-testid="mobile-bottom-nav"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/6 bg-[rgba(9,14,28,0.94)] backdrop-blur-xl lg:hidden"
        style={{
          paddingLeft:
            "max(0.75rem, calc(var(--forge-safe-area-left) + 0.75rem))",
          paddingRight:
            "max(0.75rem, calc(var(--forge-safe-area-right) + 0.75rem))",
          paddingTop: "0.75rem",
          paddingBottom: "calc(var(--forge-safe-area-bottom) + 0.75rem)"
        }}
      >
        <div className="grid grid-cols-5 gap-2">
          {visibleRoutes.map((route) => (
            <NavLink
              key={route.id}
              to={route.to}
              onPointerDown={startHold}
              onPointerUp={endHold}
              onPointerLeave={endHold}
              onClick={(event) => {
                if (holdTriggeredRef.current) {
                  event.preventDefault();
                  holdTriggeredRef.current = false;
                }
              }}
              className={({ isActive }) =>
                `flex min-h-11 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[12px] ${
                  isActive || routeMatches(location.pathname, route)
                    ? "bg-white/[0.08] text-[var(--primary)]"
                    : "text-white/55"
                }`
              }
            >
              <route.icon className="size-4" />
              <span>{getRouteLabel(route, t)}</span>
            </NavLink>
          ))}
          <button
            type="button"
            className="flex min-h-11 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[12px] text-white/55"
            onClick={() => {
              if (holdTriggeredRef.current) {
                holdTriggeredRef.current = false;
                return;
              }
              setMoreOpen(true);
            }}
            onPointerDown={startHold}
            onPointerUp={endHold}
            onPointerLeave={endHold}
          >
            <Settings className="size-4" />
            <span>{t("common.shell.more")}</span>
          </button>
        </div>
      </nav>

      <SheetScaffold
        open={moreOpen}
        onOpenChange={setMoreOpen}
        eyebrow={t("common.shell.moreRoutesEyebrow")}
        title={t("common.shell.moreRoutesTitle")}
        description={t("common.shell.moreRoutesDescription")}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <button
            type="button"
            className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white/[0.05] px-3 py-2 text-sm text-white/72"
            onClick={() => {
              setMoreOpen(false);
              onOpenEditor?.();
            }}
          >
            <GripVertical className="size-4" />
            Customize navigation
          </button>
        </div>
        <div className="grid gap-3">
          {moreRoutes.map((route) => (
            <NavLink
              key={route.id}
              to={route.to}
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) =>
                `interactive-tap flex items-center justify-between rounded-[24px] px-4 py-4 ${
                  isActive || routeMatches(location.pathname, route)
                    ? "bg-white/[0.08] text-white"
                    : "bg-white/[0.04] text-white/70"
                }`
              }
            >
              <span className="flex items-center gap-3">
                <route.icon className="size-4 text-[var(--primary)]" />
                <span>
                  <span className="block text-base font-medium">
                    {getRouteLabel(route, t)}
                  </span>
                  <span className="mt-1 block text-sm text-white/54">
                    {getRouteDetail(route, t)}
                  </span>
                </span>
              </span>
              <ArrowUpRight className="size-4 text-white/35" />
            </NavLink>
          ))}
        </div>
      </SheetScaffold>
    </>
  );
}

function moveNavEntry(values: string[], fromId: string, toId: string) {
  const fromIndex = values.indexOf(fromId);
  const toIndex = values.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return values;
  }
  return arrayMove(values, fromIndex, toIndex);
}

function SortableNavEntry({
  route,
  prefix,
  label,
  onRemove
}: {
  route: ShellRouteDefinition;
  prefix: string;
  label: string;
  onRemove: () => void;
}) {
  const sortable = useSortable({ id: `${prefix}:${route.id}` });

  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition
      }}
      className="flex min-h-16 items-center justify-between gap-3 rounded-[20px] bg-white/[0.04] px-4 py-3"
    >
      <span className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-white/50 transition hover:bg-white/[0.08] hover:text-white"
          aria-label={`Reorder ${label}`}
          {...sortable.attributes}
          {...sortable.listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <route.icon className="size-4 shrink-0 text-[var(--primary)]" />
        <span className="truncate text-sm text-white">{label}</span>
      </span>
      <button
        type="button"
        className="rounded-full bg-white/[0.05] px-3 py-1.5 text-[12px] text-white/70"
        onClick={onRemove}
      >
        Remove
      </button>
    </div>
  );
}

function ShellNavEditor({
  open,
  onOpenChange,
  desktopNavIds,
  onDesktopNavIdsChange,
  desktopSidebarMetricsPosition,
  onDesktopSidebarMetricsPositionChange,
  mobileNavIds,
  onMobileNavIdsChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  desktopNavIds: string[];
  onDesktopNavIdsChange: (ids: string[]) => void;
  desktopSidebarMetricsPosition: "above" | "below";
  onDesktopSidebarMetricsPositionChange: (position: "above" | "below") => void;
  mobileNavIds: string[];
  onMobileNavIdsChange: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }
    })
  );
  const availableRoutes = NAV_ROUTE_REGISTRY.filter(
    (route) =>
      !desktopNavIds.includes(route.id) || !mobileNavIds.includes(route.id)
  );
  const desktopSlotCount = 10;
  const mobileSlotCount = 4;

  function renderSlots(
    ids: string[],
    slotCount: number,
    onChange: (ids: string[]) => void,
    minimum: number,
    prefix: string
  ) {
    const filledRoutes = ids
      .map((id) => NAV_ROUTE_REGISTRY.find((entry) => entry.id === id) ?? null)
      .filter((route): route is ShellRouteDefinition => route !== null);
    const emptySlotCount = Math.max(0, slotCount - filledRoutes.length);

    return (
      <div className="grid gap-2">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(event: DragEndEvent) => {
            const activeId = String(event.active.id);
            const overId = event.over ? String(event.over.id) : null;
            if (!overId) {
              return;
            }
            onChange(
              moveNavEntry(
                ids,
                activeId.replace(`${prefix}:`, ""),
                overId.replace(`${prefix}:`, "")
              )
            );
          }}
        >
          <SortableContext
            items={filledRoutes.map((route) => `${prefix}:${route.id}`)}
            strategy={verticalListSortingStrategy}
          >
            {filledRoutes.map((route) => (
              <SortableNavEntry
                key={`${prefix}-${route.id}`}
                route={route}
                prefix={prefix}
                label={getRouteLabel(route, t)}
                onRemove={() =>
                  removeFromList(ids, route.id, onChange, minimum)
                }
              />
            ))}
          </SortableContext>
        </DndContext>
        {Array.from({ length: emptySlotCount }, (_, index) => (
          <div
            key={`${prefix}-empty-${index}`}
            className="flex min-h-16 items-center justify-between gap-3 rounded-[20px] border border-dashed border-white/12 bg-white/[0.02] px-4 py-3"
          >
            <div>
              <div className="text-sm text-white/44">Empty slot</div>
              <div className="text-[12px] text-white/30">
                Add a route below to fill this slot
              </div>
            </div>
            <div className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/46">
              Slot {filledRoutes.length + index + 1}
            </div>
          </div>
        ))}
      </div>
    );
  }

  function addToList(
    current: string[],
    nextId: string,
    onChange: (ids: string[]) => void,
    maxItems?: number
  ) {
    if (current.includes(nextId)) {
      return;
    }
    const next = [...current, nextId];
    onChange(maxItems ? next.slice(0, maxItems) : next);
  }

  function removeFromList(
    current: string[],
    id: string,
    onChange: (ids: string[]) => void,
    minimum = 1
  ) {
    const next = current.filter((entry) => entry !== id);
    if (next.length < minimum) {
      return;
    }
    onChange(next);
  }

  return (
    <SheetScaffold
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Navigation"
      title="Customize navigation"
      description="Add or remove main routes, Psyche shortcuts, and the Workbench flow workspace."
    >
      <div className="grid gap-5">
        <div className="grid gap-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
            Desktop sidebar
          </div>
          <div className="rounded-[20px] bg-white/[0.03] p-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-white/38">
              Metric strip position
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(
                [
                  ["above", "Above navigation"],
                  ["below", "Below navigation"]
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={cn(
                    "rounded-full px-3 py-1.5 text-[12px] transition",
                    desktopSidebarMetricsPosition === value
                      ? "bg-[var(--primary)] text-slate-950"
                      : "bg-white/[0.05] text-white/70 hover:bg-white/[0.08]"
                  )}
                  onClick={() => onDesktopSidebarMetricsPositionChange(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-2">
            {renderSlots(
              desktopNavIds,
              desktopSlotCount,
              onDesktopNavIdsChange,
              4,
              "desktop"
            )}
          </div>
        </div>
        <div className="grid gap-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
            Mobile bar
          </div>
          <div className="grid gap-2">
            {renderSlots(
              mobileNavIds,
              mobileSlotCount,
              onMobileNavIdsChange,
              2,
              "mobile"
            )}
          </div>
        </div>
        <div className="grid gap-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
            Available routes
          </div>
          <div className="grid gap-2">
            {availableRoutes.map((route) => (
              <div
                key={`available-${route.id}`}
                className="flex items-center justify-between gap-3 rounded-[20px] bg-white/[0.03] px-4 py-3"
              >
                <span className="flex items-center gap-3">
                  <route.icon className="size-4 text-[var(--primary)]" />
                  <span>
                    <span className="block text-sm text-white">
                      {getRouteLabel(route, t)}
                    </span>
                    <span className="block text-[12px] text-white/48">
                      {getRouteDetail(route, t)}
                    </span>
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  {!desktopNavIds.includes(route.id) ? (
                    <button
                      type="button"
                      className="rounded-full bg-white/[0.05] px-2.5 py-1.5 text-[11px] text-white/70"
                      onClick={() =>
                        addToList(
                          desktopNavIds,
                          route.id,
                          onDesktopNavIdsChange
                        )
                      }
                    >
                      + Sidebar
                    </button>
                  ) : null}
                  {!mobileNavIds.includes(route.id) ? (
                    <button
                      type="button"
                      className="rounded-full bg-white/[0.05] px-2.5 py-1.5 text-[11px] text-white/70"
                      onClick={() =>
                        addToList(
                          mobileNavIds,
                          route.id,
                          onMobileNavIdsChange,
                          4
                        )
                      }
                    >
                      + Mobile
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SheetScaffold>
  );
}

function ShellCommandButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();

  return (
    <Button
      variant="secondary"
      size="sm"
      className="min-w-[8.25rem] px-3.5"
      onClick={onClick}
    >
      <Search className="size-4" />
      {t("common.shell.command")}
      <Badge
        size="sm"
        tone="meta"
        className="ml-1 hidden bg-white/[0.06] text-white/52 xl:inline-flex"
      >
        Shift Shift
      </Badge>
      <Badge
        size="sm"
        tone="meta"
        className="hidden bg-white/[0.06] text-white/52 2xl:inline-flex"
      >
        Cmd K
      </Badge>
    </Button>
  );
}

function ShellFrame({
  children,
  routeLocation,
  settings,
  timerPending,
  startWorkOpen,
  startWorkPending,
  startWorkError,
  startWorkDefaults,
  onOpenStartWork,
  onCloseStartWork,
  onStartExistingTask,
  onCreateAndStartTask,
  onFocusRun,
  onPauseRun,
  onCompleteRun
}: {
  children: ReactNode;
  routeLocation: RouterLocation;
  settings: SettingsPayload;
  timerPending: boolean;
  startWorkOpen: boolean;
  startWorkPending: boolean;
  startWorkError: string | null;
  startWorkDefaults: { taskId?: string | null; projectId?: string | null };
  onOpenStartWork: (defaults?: {
    taskId?: string | null;
    projectId?: string | null;
  }) => void;
  onCloseStartWork: () => void;
  onStartExistingTask: (
    taskId: string,
    input: {
      timerMode: "planned" | "unlimited";
      plannedDurationSeconds: number | null;
      gitContext: import("@/lib/types").TaskRunGitContext | null;
    }
  ) => Promise<void>;
  onCreateAndStartTask: (input: {
    title: string;
    description: string;
    projectId: string;
    timerMode: "planned" | "unlimited";
    plannedDurationSeconds: number | null;
    gitContext: import("@/lib/types").TaskRunGitContext | null;
  }) => Promise<void>;
  onFocusRun: (runId: string) => Promise<void>;
  onPauseRun: (runId: string) => Promise<void>;
  onCompleteRun: (runId: string) => Promise<void>;
}) {
  const shell = useForgeShell();
  const { t } = useI18n();
  const active =
    NAV_ROUTE_REGISTRY.find((route) =>
      routeMatches(routeLocation.pathname, route)
    ) ?? PRIMARY_ROUTES[0];
  const transitionKey = getRouteTransitionKey(routeLocation.pathname);
  const [actionBarOpen, setActionBarOpen] = useState(false);
  const [backgroundActivityOpen, setBackgroundActivityOpen] = useState(false);
  const shellRootRef = useRef<HTMLDivElement | null>(null);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [desktopNavIds, setDesktopNavIds] = useState<string[]>(() =>
    readStoredNavIds(DESKTOP_NAV_STORAGE_KEY, [
      ...SHELL_NAV_ROUTES.map((route) => route.id)
    ])
  );
  const [mobileNavIds, setMobileNavIds] = useState<string[]>(() =>
    readStoredNavIds(MOBILE_NAV_STORAGE_KEY, [
      requirePrimaryRoute("overview").id,
      requirePrimaryRoute("today").id,
      requirePrimaryRoute("kanban").id,
      requirePrimaryRoute("notes").id,
      requirePrimaryRoute("knowledge-graph").id
    ])
  );
  const [navEditorOpen, setNavEditorOpen] = useState(false);
  const [desktopSidebarMetricsPosition, setDesktopSidebarMetricsPosition] =
    useState<"above" | "below">(() => {
      if (typeof window === "undefined") {
        return "above";
      }
      try {
        const stored = window.localStorage.getItem(
          DESKTOP_SIDEBAR_METRICS_POSITION_STORAGE_KEY
        );
        return stored === "below" ? "below" : "above";
      } catch {
        return "above";
      }
    });
  const autoCollapseAppliedRef = useRef(false);
  const preAutoCollapseRef = useRef(false);
  const skipNavPersistenceRef = useRef(false);
  const isPsyche = isPsycheRoute(routeLocation.pathname);
  const wikiSurface = isWikiRoute(routeLocation.pathname);
  const psycheSurface = isPsycheRoute(routeLocation.pathname);
  const workbenchSurface = routeLocation.pathname.startsWith("/workbench");
  const knowledgeGraphSurface =
    routeLocation.pathname.startsWith("/knowledge-graph");
  const autoCollapseSurface =
    wikiSurface || psycheSurface || workbenchSurface || knowledgeGraphSurface;
  const immersiveMobileSurface = false;
  const desktopRoutes = desktopNavIds
    .map((id) => NAV_ROUTE_REGISTRY.find((route) => route.id === id) ?? null)
    .filter((route): route is ShellRouteDefinition => route !== null);
  const mobileRoutes = mobileNavIds
    .map((id) => NAV_ROUTE_REGISTRY.find((route) => route.id === id) ?? null)
    .filter((route): route is ShellRouteDefinition => route !== null);
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const pendingRtkRequests = useAppSelector(selectPendingRtkRequestCount);
  const activityCount = fetching + mutating + pendingRtkRequests;
  const {
    activityLabel,
    hasActiveIngestJobs,
    ingestJobsQuery,
    recentIngestJobs
  } = useShellBackgroundActivity({
    backgroundActivityOpen,
    fetchingCount: fetching + pendingRtkRequests,
    mutatingCount: mutating,
    t
  });
  const sidebarMetrics = buildSidebarMetrics(shell.snapshot, t);
  const createActions = useForgeCreateActions({
    goals: shell.snapshot.dashboard.goals,
    projects: shell.snapshot.dashboard.projects,
    tags: shell.snapshot.tags,
    users: shell.snapshot.users,
    defaultUserId:
      shell.selectedUserIds.length === 1 ? shell.selectedUserIds[0] : null,
    onCreateGoal: shell.createGoal,
    onCreateProject: shell.createProject,
    onCreateTask: shell.createTask
  });
  const railLinks = useMemo(() => {
    if (routeLocation.pathname.startsWith("/tasks/")) {
      return [
        { to: "/kanban", label: t("common.shell.rail.taskBackToKanban") },
        { to: "/today", label: t("common.shell.rail.taskOpenToday") }
      ];
    }
    if (routeLocation.pathname.startsWith("/projects/")) {
      return [
        { to: "/projects", label: t("common.shell.rail.projectAll") },
        { to: "/goals", label: t("common.shell.rail.projectGoals") }
      ];
    }
    if (routeLocation.pathname.startsWith("/goals/")) {
      return [
        { to: "/goals", label: t("common.shell.rail.goalAll") },
        { to: "/projects", label: t("common.shell.rail.goalProjects") }
      ];
    }
    if (routeLocation.pathname.startsWith("/strategies")) {
      return [
        { to: "/strategies", label: t("common.routeLabels.strategies") },
        { to: "/projects", label: t("common.shell.rail.projectAll") }
      ];
    }
    if (isPsycheRoute(routeLocation.pathname)) {
      return [
        { to: "/psyche", label: t("common.shell.rail.psycheHub") },
        { to: "/psyche/reports", label: t("common.shell.rail.psycheReports") }
      ];
    }
    return [
      { to: "/overview", label: t("common.shell.rail.overview") },
      { to: "/today", label: t("common.shell.rail.today") }
    ];
  }, [routeLocation.pathname, t]);

  useEffect(() => {
    let lastStandaloneShiftAt = 0;

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setActionBarOpen((current) => !current);
        lastStandaloneShiftAt = 0;
        return;
      }

      if (
        event.key === "Shift" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.repeat
      ) {
        const now = window.performance.now();
        if (now - lastStandaloneShiftAt <= 360) {
          event.preventDefault();
          setActionBarOpen(true);
          lastStandaloneShiftAt = 0;
          return;
        }
        lastStandaloneShiftAt = now;
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        lastStandaloneShiftAt = 0;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("forge.desktop-nav-collapsed");
      if (stored === "true") {
        setNavCollapsed(true);
      }
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    if (skipNavPersistenceRef.current) {
      skipNavPersistenceRef.current = false;
      return;
    }
    try {
      window.localStorage.setItem(
        "forge.desktop-nav-collapsed",
        String(navCollapsed)
      );
    } catch {
      return;
    }
  }, [navCollapsed]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        DESKTOP_SIDEBAR_METRICS_POSITION_STORAGE_KEY,
        desktopSidebarMetricsPosition
      );
    } catch {
      return;
    }
  }, [desktopSidebarMetricsPosition]);

  useEffect(() => {
    writeStoredNavIds(DESKTOP_NAV_STORAGE_KEY, desktopNavIds);
  }, [desktopNavIds]);

  useEffect(() => {
    writeStoredNavIds(MOBILE_NAV_STORAGE_KEY, mobileNavIds);
  }, [mobileNavIds]);

  useEffect(() => {
    if (autoCollapseSurface) {
      if (!autoCollapseAppliedRef.current) {
        preAutoCollapseRef.current = navCollapsed;
        autoCollapseAppliedRef.current = true;
        if (!navCollapsed) {
          skipNavPersistenceRef.current = true;
          setNavCollapsed(true);
        }
      }
      return;
    }

    if (!autoCollapseAppliedRef.current) {
      return;
    }
    autoCollapseAppliedRef.current = false;
    if (navCollapsed !== preAutoCollapseRef.current) {
      skipNavPersistenceRef.current = true;
      setNavCollapsed(preAutoCollapseRef.current);
    }
  }, [autoCollapseSurface, navCollapsed]);

  useShellCollapseController(shellRootRef);
  const shellRootStyle = useMemo(
    () =>
      ({
        "--forge-shell-collapse": "0",
        "--forge-shell-desktop-header-padding-top": "18px",
        "--forge-shell-desktop-header-padding-bottom": "15px",
        "--forge-shell-desktop-title-size": "1.42rem",
        "--forge-shell-desktop-primary-translate-y": "0px",
        "--forge-shell-desktop-primary-scale": "1",
        "--forge-shell-desktop-secondary-opacity": "1",
        "--forge-shell-desktop-secondary-max-height": "176px",
        "--forge-shell-desktop-secondary-spacing": "14px",
        "--forge-shell-desktop-secondary-translate-y": "0px",
        "--forge-shell-mobile-header-padding-top": "14px",
        "--forge-shell-mobile-header-padding-bottom": "12px",
        "--forge-shell-mobile-title-size": "1.2rem",
        "--forge-shell-mobile-primary-translate-y": "0px",
        "--forge-shell-mobile-primary-scale": "1",
        "--forge-shell-mobile-copy-opacity": "1",
        "--forge-shell-mobile-copy-max-height": "320px",
        "--forge-shell-mobile-copy-translate-y": "0px",
        "--forge-shell-hero-padding-top": "20px",
        "--forge-shell-hero-padding-bottom": "20px",
        "--forge-shell-hero-title-translate-y": "0px",
        "--forge-shell-hero-title-scale": "1",
        "--forge-shell-hero-description-opacity": "1",
        "--forge-shell-hero-description-translate-y": "0px"
      }) as CSSProperties,
    []
  );
  const sidebarMetricsPanel = (
    <div className={cn(navCollapsed ? "mt-4" : "mt-6")}>
      <div
        className={cn(
          "rounded-[24px] bg-white/[0.04]",
          navCollapsed ? "px-2 py-2.5" : "p-4"
        )}
      >
        {!navCollapsed ? (
          <div className="type-label text-white/40">Live metrics</div>
        ) : null}
        <div className={cn("grid", navCollapsed ? "gap-1.5" : "mt-3 gap-3")}>
          {sidebarMetrics.map((metric) => {
            const Icon = metric.icon;
            return navCollapsed ? (
              <div
                key={metric.id}
                title={`${metric.label}: ${metric.compactValue}`}
                className="flex min-w-0 flex-col items-center gap-1 rounded-[16px] bg-white/[0.04] px-1 py-2.5 text-center"
              >
                <Icon className="size-3.5 shrink-0 text-white/42" />
                <div className="max-w-full text-[12px] font-semibold leading-none text-white">
                  {metric.compactValue}
                </div>
              </div>
            ) : (
              <div
                key={metric.id}
                className="rounded-[18px] bg-white/[0.04] px-3 py-3"
              >
                <div className="text-[11px] uppercase tracking-[0.14em] text-white/42">
                  {metric.label}
                </div>
                <div className="mt-1 text-lg font-semibold leading-tight text-white">
                  {metric.expandedValue}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  return (
    <div ref={shellRootRef} className="min-h-screen" style={shellRootStyle}>
      <ActionBar
        open={actionBarOpen}
        onOpenChange={setActionBarOpen}
        snapshot={shell.snapshot}
        selectedUserIds={shell.selectedUserIds}
        createActions={createActions.actions}
      />
      {createActions.dialogs}

      <div
        className="hidden lg:grid lg:min-h-screen"
        style={{
          gridTemplateColumns: navCollapsed
            ? "5.75rem minmax(0,1fr)"
            : "17.75rem minmax(0,1fr)"
        }}
      >
        <aside
          className={cn(
            "flex min-h-screen flex-col border-r border-white/5 py-6 backdrop-blur-xl transition-[padding,width]",
            navCollapsed ? "px-3" : "px-5"
          )}
          style={{
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--surface-panel) 94%, transparent), color-mix(in srgb, var(--surface-low) 92%, transparent))"
          }}
        >
          <div
            className={cn(
              "flex items-start",
              navCollapsed
                ? "flex-col items-center gap-3"
                : "justify-between gap-3"
            )}
          >
            <Link
              to="/overview"
              className={cn("block min-w-0", navCollapsed && "text-center")}
            >
              <div
                className={cn(
                  "font-display text-[var(--primary)]",
                  navCollapsed ? "text-2xl" : "text-3xl"
                )}
              >
                {t("common.shell.appMark")}
              </div>
              {!navCollapsed ? (
                <div className="type-meta mt-2 text-white/40">
                  Level {shell.snapshot.metrics.level}
                </div>
              ) : null}
            </Link>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-0.5 px-2.5"
              onClick={() => setNavCollapsed((current) => !current)}
              aria-label={t(
                navCollapsed
                  ? "common.shell.expandSidebar"
                  : "common.shell.collapseSidebar"
              )}
              title={t(
                navCollapsed
                  ? "common.shell.expandSidebar"
                  : "common.shell.collapseSidebar"
              )}
            >
              {navCollapsed ? (
                <ChevronsRight className="size-4" />
              ) : (
                <ChevronsLeft className="size-4" />
              )}
            </Button>
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            className={cn(
              "mt-3",
              navCollapsed ? "px-2.5" : "w-full justify-start px-3"
            )}
            onClick={() => setNavEditorOpen(true)}
          >
            <GripVertical className="size-4" />
            {!navCollapsed ? "Customize nav" : null}
          </Button>

          {desktopSidebarMetricsPosition === "above"
            ? sidebarMetricsPanel
            : null}

          <div className={cn("grid gap-2", navCollapsed ? "mt-6" : "mt-8")}>
            {desktopRoutes.map((route) => (
              <NavItem key={route.id} route={route} compact={navCollapsed} />
            ))}
          </div>

          {desktopSidebarMetricsPosition === "below"
            ? sidebarMetricsPanel
            : null}
        </aside>

        <div className="min-h-screen">
          <TaskTimerRailProvider>
            <header
              className="sticky top-0 z-30 border-b border-white/5 px-6 backdrop-blur-xl"
              style={{
                background:
                  "color-mix(in srgb, var(--surface-glass) 92%, transparent)",
                paddingTop: "var(--forge-shell-desktop-header-padding-top)",
                paddingBottom:
                  "var(--forge-shell-desktop-header-padding-bottom)",
                willChange: "padding, background-color"
              }}
            >
              {/* ── Title row: page title + work bar + action buttons — all same height ── */}
              <div
                className="flex items-center justify-between gap-4"
                style={{
                  transform:
                    "translateY(var(--forge-shell-desktop-primary-translate-y)) scale(var(--forge-shell-desktop-primary-scale))",
                  transformOrigin: "top center",
                  willChange: "transform"
                }}
              >
                <div className="flex min-w-0 flex-1 items-center gap-5">
                  <div
                    className="shrink-0 font-display text-white"
                    style={{
                      fontSize: "var(--forge-shell-desktop-title-size)",
                      lineHeight: 1,
                      willChange: "font-size"
                    }}
                  >
                    {getRouteLabel(active, t)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <TaskTimerRailBar
                      runs={shell.snapshot.activeTaskRuns}
                      tasks={shell.snapshot.tasks}
                      generatedAt={shell.snapshot.meta.generatedAt}
                      timeAccountingMode={settings.execution.timeAccountingMode}
                      pending={timerPending}
                      onOpenStartWork={() => onOpenStartWork()}
                      onPause={onPauseRun}
                      onFocus={onFocusRun}
                    />
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  <GamificationMiniHud
                    metrics={shell.snapshot.metrics}
                    className="hidden xl:inline-flex"
                  />
                  <AmbientActivityPill
                    active={activityCount > 0 || hasActiveIngestJobs}
                    label={activityLabel}
                    onClick={() => setBackgroundActivityOpen(true)}
                  />
                  <ShellCommandButton onClick={() => setActionBarOpen(true)} />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="min-w-[7.25rem] px-3.5"
                    onClick={() => void shell.refresh()}
                  >
                    <RefreshCcw className="size-4" />
                    {t("common.actions.refresh")}
                  </Button>
                </div>
              </div>

              {/* ── Expanded work detail — full width below the title row ── */}
              <TaskTimerRailPanel
                runs={shell.snapshot.activeTaskRuns}
                tasks={shell.snapshot.tasks}
                generatedAt={shell.snapshot.meta.generatedAt}
                timeAccountingMode={settings.execution.timeAccountingMode}
                pending={timerPending}
                onOpenStartWork={() => onOpenStartWork()}
                onFocus={onFocusRun}
                onPause={onPauseRun}
                onComplete={onCompleteRun}
              />

              <div
                className="flex items-center justify-between gap-4 overflow-hidden border-t border-white/6"
                style={{
                  opacity: "var(--forge-shell-desktop-secondary-opacity)",
                  maxHeight: "var(--forge-shell-desktop-secondary-max-height)",
                  marginTop: "var(--forge-shell-desktop-secondary-spacing)",
                  paddingTop: "var(--forge-shell-desktop-secondary-spacing)",
                  transform:
                    "translateY(var(--forge-shell-desktop-secondary-translate-y))",
                  willChange: "opacity, max-height, transform"
                }}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {railLinks.map((link) => (
                    <Link
                      key={link.to}
                      to={link.to}
                      className="interactive-tap inline-flex min-h-10 min-w-max items-center justify-center rounded-full bg-white/[0.04] px-4 py-2 text-[13px] leading-none whitespace-nowrap text-white/62 transition hover:bg-white/[0.07] hover:text-white"
                    >
                      {link.label}
                    </Link>
                  ))}
                  <UserScopeSelector
                    users={shell.snapshot.users}
                    selectedUserIds={shell.selectedUserIds}
                    onChange={shell.setSelectedUserIds}
                    compact
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="meta">
                    {t(
                      shell.snapshot.metrics.streakDays === 1
                        ? "common.shell.momentum.streakBadgeOne"
                        : "common.shell.momentum.streakBadgeOther",
                      {
                        count: shell.snapshot.metrics.streakDays
                      }
                    )}
                  </Badge>
                  <Badge tone="meta">
                    {t("common.shell.momentum.weeklyXp", {
                      count: shell.snapshot.metrics.weeklyXp
                    })}
                  </Badge>
                  <Badge tone={isPsyche ? "signal" : "meta"}>
                    {isPsyche
                      ? t("common.shell.momentum.psycheMode")
                      : t("common.shell.momentum.liveMomentum", {
                          count: shell.snapshot.metrics.momentumScore
                        })}
                  </Badge>
                </div>
              </div>
            </header>
          </TaskTimerRailProvider>

          <div className="px-6 pt-3">
            <StartWorkComposer
              open={startWorkOpen}
              onOpenChange={(open) => {
                if (!open) {
                  onCloseStartWork();
                }
              }}
              presentation="desktop_inline"
              tasks={shell.snapshot.tasks}
              projects={shell.snapshot.dashboard.projects}
              activeRunCount={shell.snapshot.activeTaskRuns.length}
              maxActiveTasks={settings.execution.maxActiveTasks}
              timeAccountingMode={settings.execution.timeAccountingMode}
              pending={startWorkPending}
              errorMessage={startWorkError}
              initialTaskId={startWorkDefaults.taskId ?? null}
              defaultProjectId={startWorkDefaults.projectId ?? null}
              onStartExisting={onStartExistingTask}
              onCreateAndStart={onCreateAndStartTask}
            />
          </div>

          <main className="px-6 pb-3">
            <div className="min-w-0">
              <RouteTransitionFrame
                routeKey={transitionKey}
                tone={isPsyche ? "psyche" : "core"}
              >
                {children}
              </RouteTransitionFrame>
            </div>
          </main>
        </div>
      </div>

      <div className="min-h-[100dvh] overflow-x-clip lg:hidden">
        <TaskTimerRailProvider>
          {!immersiveMobileSurface ? (
            <header
              className="sticky top-0 z-30 border-b border-white/6 px-4 backdrop-blur-xl"
              style={{
                background:
                  "color-mix(in srgb, var(--surface-glass) 96%, transparent)",
                paddingTop: "var(--forge-shell-mobile-header-padding-top)",
                paddingBottom:
                  "var(--forge-shell-mobile-header-padding-bottom)",
                willChange: "padding, background-color"
              }}
            >
              <div
                className="flex items-center justify-between gap-2"
                style={{
                  transform:
                    "translateY(var(--forge-shell-mobile-primary-translate-y)) scale(var(--forge-shell-mobile-primary-scale))",
                  transformOrigin: "top center",
                  willChange: "transform"
                }}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div
                    className="min-w-0 truncate font-display text-white"
                    style={{
                      fontSize: "var(--forge-shell-mobile-title-size)",
                      willChange: "font-size"
                    }}
                  >
                    {getRouteLabel(active, t)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <TaskTimerRailBar
                      runs={shell.snapshot.activeTaskRuns}
                      tasks={shell.snapshot.tasks}
                      generatedAt={shell.snapshot.meta.generatedAt}
                      timeAccountingMode={settings.execution.timeAccountingMode}
                      pending={timerPending}
                      onOpenStartWork={() => onOpenStartWork()}
                      onPause={onPauseRun}
                      onFocus={onFocusRun}
                    />
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="min-h-[2.125rem] px-2.5"
                    onClick={() => setActionBarOpen(true)}
                  >
                    <Search className="size-4" />
                  </Button>
                  <div className="inline-flex min-h-[2.125rem] items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.05] px-2.5 text-[12px] font-medium text-[var(--primary)]">
                    <Zap className="size-3.5 shrink-0" />
                    <span className="max-w-[9rem] truncate">
                      L{shell.snapshot.metrics.level} ·{" "}
                      {formatCompactNumber(shell.snapshot.metrics.totalXp)} XP ·{" "}
                      {shell.snapshot.metrics.streakDays}d
                    </span>
                  </div>
                </div>
              </div>

              {/* ── Expanded work detail — full width below the title row ── */}
              <TaskTimerRailPanel
                runs={shell.snapshot.activeTaskRuns}
                tasks={shell.snapshot.tasks}
                generatedAt={shell.snapshot.meta.generatedAt}
                timeAccountingMode={settings.execution.timeAccountingMode}
                pending={timerPending}
                onOpenStartWork={() => onOpenStartWork()}
                onFocus={onFocusRun}
                onPause={onPauseRun}
                onComplete={onCompleteRun}
              />

              <div
                className="overflow-hidden"
                style={{
                  opacity: "var(--forge-shell-mobile-copy-opacity)",
                  maxHeight: "var(--forge-shell-mobile-copy-max-height)",
                  transform:
                    "translateY(var(--forge-shell-mobile-copy-translate-y))",
                  willChange: "opacity, max-height, transform"
                }}
              >
                <div className="mt-2 text-[13px] leading-5 text-white/52">
                  {getRouteDetail(active, t)}
                </div>
                <div className="mt-2">
                  <AmbientActivityPill
                    active={activityCount > 0 || hasActiveIngestJobs}
                    label={activityLabel}
                    onClick={() => setBackgroundActivityOpen(true)}
                  />
                </div>
                <div className="mt-3 overflow-x-auto pb-1">
                  <UserScopeSelector
                    users={shell.snapshot.users}
                    selectedUserIds={shell.selectedUserIds}
                    onChange={shell.setSelectedUserIds}
                    compact
                  />
                </div>
              </div>
            </header>
          ) : null}
        </TaskTimerRailProvider>

        <StartWorkComposer
          open={startWorkOpen}
          onOpenChange={(open) => {
            if (!open) {
              onCloseStartWork();
            }
          }}
          presentation="mobile_sheet"
          tasks={shell.snapshot.tasks}
          projects={shell.snapshot.dashboard.projects}
          activeRunCount={shell.snapshot.activeTaskRuns.length}
          maxActiveTasks={settings.execution.maxActiveTasks}
          timeAccountingMode={settings.execution.timeAccountingMode}
          pending={startWorkPending}
          errorMessage={startWorkError}
          initialTaskId={startWorkDefaults.taskId ?? null}
          defaultProjectId={startWorkDefaults.projectId ?? null}
          onStartExisting={onStartExistingTask}
          onCreateAndStart={onCreateAndStartTask}
        />

        <main
          className={cn(
            "overflow-x-clip pb-2.5 lg:pb-24",
            knowledgeGraphSurface
              ? "px-0"
              : immersiveMobileSurface
                ? "px-0"
                : "px-4"
          )}
          style={{
            paddingBottom: "calc(var(--forge-mobile-nav-clearance) + 2.5rem)",
            paddingLeft: knowledgeGraphSurface
              ? "var(--forge-safe-area-left)"
              : immersiveMobileSurface
                ? "var(--forge-safe-area-left)"
                : "max(1rem, calc(var(--forge-safe-area-left) + 1rem))",
            paddingRight: knowledgeGraphSurface
              ? "var(--forge-safe-area-right)"
              : immersiveMobileSurface
                ? "var(--forge-safe-area-right)"
                : "max(1rem, calc(var(--forge-safe-area-right) + 1rem))"
          }}
        >
          <RouteTransitionFrame
            routeKey={transitionKey}
            tone={isPsyche ? "psyche" : "core"}
          >
            {children}
          </RouteTransitionFrame>
        </main>
        <MobileBottomNav
          routes={mobileRoutes}
          onOpenEditor={() => setNavEditorOpen(true)}
        />

        <ShellNavEditor
          open={navEditorOpen}
          onOpenChange={setNavEditorOpen}
          desktopNavIds={desktopNavIds}
          onDesktopNavIdsChange={setDesktopNavIds}
          desktopSidebarMetricsPosition={desktopSidebarMetricsPosition}
          onDesktopSidebarMetricsPositionChange={
            setDesktopSidebarMetricsPosition
          }
          mobileNavIds={mobileNavIds}
          onMobileNavIdsChange={setMobileNavIds}
        />
      </div>

      <Dialog.Root
        open={backgroundActivityOpen}
        onOpenChange={setBackgroundActivityOpen}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgba(3,7,18,0.72)] backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-[10vh] z-50 w-[min(42rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-[30px] border border-white/10 bg-[rgba(10,15,28,0.97)] p-4 shadow-[0_32px_90px_rgba(0,0,0,0.45)] sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="font-display text-[1.25rem] tracking-[-0.04em] text-white">
                  Background activity
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-[13px] leading-6 text-white/56">
                  Follow active KarpaWiki ingest jobs and reopen completed
                  reviews without leaving your current context.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <ModalCloseButton aria-label="Close background activity dialog" />
              </Dialog.Close>
            </div>

            <div className="mt-4 max-h-[65vh] overflow-y-auto">
              {ingestJobsQuery.isLoading ? (
                <LoadingState
                  eyebrow="Background"
                  title="Loading activity"
                  description="Checking the latest queued and completed ingest jobs."
                />
              ) : ingestJobsQuery.isError ? (
                <ErrorState
                  eyebrow="Background"
                  error={ingestJobsQuery.error}
                  onRetry={() => void ingestJobsQuery.refetch()}
                />
              ) : recentIngestJobs.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-white/10 px-4 py-10 text-center text-[13px] leading-6 text-white/42">
                  No background ingest jobs yet.
                </div>
              ) : (
                <div className="grid gap-3">
                  {recentIngestJobs.map((job) => {
                    const activeJob = ["queued", "processing"].includes(
                      job.job.status
                    );
                    return (
                      <Link
                        key={job.job.id}
                        to={getWikiIngestRoute(job)}
                        onClick={() => setBackgroundActivityOpen(false)}
                        className="rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-4 transition hover:bg-white/[0.06]"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                              KarpaWiki ingest
                            </div>
                            <div className="mt-2 text-[14px] font-semibold text-white">
                              {job.job.titleHint ||
                                job.job.latestMessage ||
                                "Background ingest"}
                            </div>
                            <div className="mt-1 text-[12px] leading-5 text-white/56">
                              {job.job.status} · {job.job.phase} ·{" "}
                              {job.job.progressPercent}% ·{" "}
                              {formatActivityTimestamp(job.job.updatedAt)}
                            </div>
                            <div className="mt-2 text-[12px] leading-5 text-white/46">
                              {job.job.createdPageCount} pages ·{" "}
                              {job.job.createdEntityCount} entities ·{" "}
                              {job.job.acceptedCount} accepted ·{" "}
                              {job.job.rejectedCount} rejected
                            </div>
                          </div>
                          <div className="shrink-0">
                            {activeJob ? (
                              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/58">
                                <RefreshCcw className="size-3.5 animate-spin" />
                                Running
                              </div>
                            ) : (
                              <Badge tone="meta">{job.job.phase}</Badge>
                            )}
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <CreateMenu
        className="fixed z-40 lg:bottom-6 lg:right-6"
        actions={createActions.actions}
      />
    </div>
  );
}

export function AppShell() {
  useLiveEvents();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const xpTimerRef = useRef<number | null>(null);
  const previousXpRef = useRef<number | null>(null);
  const queryClient = useQueryClient();
  const routerLocation = useLocation();
  const routerLocationContext = useContext(UNSAFE_LocationContext);
  const outlet = useOutlet();
  const tanstackFetching = useIsFetching();
  const pendingRtkRequests = useAppSelector(selectPendingRtkRequestCount);
  const selectedUserIds = useAppSelector(selectSelectedUserIds);
  const knowledgeGraphOverlayFocus = useAppSelector(
    (state) => state.shell.knowledgeGraphOverlayFocus
  );
  const [startWorkOpen, setStartWorkOpen] = useState(false);
  const [startWorkDefaults, setStartWorkDefaults] = useState<{
    taskId?: string | null;
    projectId?: string | null;
  }>({});
  const [startWorkError, setStartWorkError] = useState<string | null>(null);
  const [taskCompletionPrompt, setTaskCompletionPrompt] = useState<{
    taskId: string;
    title: string;
    status: "done";
    customMinutes: string;
    error: string | null;
  } | null>(null);
  const [xpNotice, setXpNotice] = useState<{
    deltaXp: number;
    totalXp: number;
  } | null>(null);
  const routePathKey = `${routerLocation.pathname}${routerLocation.search}${routerLocation.hash}`;
  const operatorSessionQuery = useGetOperatorSessionQuery();
  const snapshotQuery = useGetSnapshotQuery(selectedUserIds, {
    skip: !operatorSessionQuery.isSuccess
  });
  const xpMetricsQuery = useQuery({
    queryKey: ["forge-xp-metrics", ...selectedUserIds],
    queryFn: () => getXpMetrics(selectedUserIds),
    enabled: operatorSessionQuery.isSuccess
  });
  const settingsQuery = useGetSettingsQuery(undefined, {
    skip: !operatorSessionQuery.isSuccess
  });
  const celebrationSeenMutation = useMutation({
    mutationFn: markGamificationCelebrationSeen,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-xp-metrics"] });
    }
  });
  const routeReady = isShellRouteReady(routerLocation.pathname, {
    bootstrapReady:
      operatorSessionQuery.isSuccess &&
      snapshotQuery.isSuccess &&
      settingsQuery.isSuccess,
    sleepReady: true
  });
  const {
    displayedRoute,
    displayedLocationContext,
    pendingRoute,
    visibleLocation
  } = useShellRouteHandoff({
    routePathKey,
    routerLocation,
    outlet,
    routerLocationContext,
    externalFetching: tanstackFetching + pendingRtkRequests,
    routeReady
  });
  const setSelectedUserIds = (userIds: string[]) => {
    dispatch(setSelectedUserIdsAction(userIds));
  };

  const setKnowledgeGraphRouteFocus = (node: KnowledgeGraphNode | null) => {
    const search = buildKnowledgeGraphSearchFromLocation(routerLocation, node);
    if (!node) {
      dispatch(clearKnowledgeGraphOverlayFocus());
    }
    navigate({
      pathname: "/knowledge-graph",
      search
    });
  };

  const openKnowledgeGraphHierarchy = (node: KnowledgeGraphNode) => {
    navigate({
      pathname: "/knowledge-graph",
      search: buildKnowledgeGraphSearchFromLocation(routerLocation, node, {
        view: "hierarchy"
      })
    });
  };

  useEffect(() => {
    if (!operatorSessionQuery.isSuccess) {
      return;
    }
    void queryClient.invalidateQueries({
      predicate: (query) => {
        const [root] = query.queryKey;
        return (
          root === "notes-index" ||
          root === "project-board" ||
          root === "task-context" ||
          (typeof root === "string" && root.startsWith("forge-"))
        );
      }
    });
  }, [operatorSessionQuery.isSuccess, queryClient, selectedUserIds]);

  useEffect(() => {
    const users = snapshotQuery.data?.users;
    if (!users || selectedUserIds.length === 0) {
      return;
    }
    const sanitized = sanitizeSelectedUserIds(selectedUserIds, users);
    if (!sameSelectedUserIds(sanitized, selectedUserIds)) {
      dispatch(setSelectedUserIdsAction(sanitized));
    }
  }, [dispatch, selectedUserIds, snapshotQuery.data?.users]);

  useEffect(() => {
    if (routerLocation.pathname.startsWith("/knowledge-graph")) {
      return;
    }
    if (knowledgeGraphOverlayFocus) {
      dispatch(clearKnowledgeGraphOverlayFocus());
    }
  }, [dispatch, knowledgeGraphOverlayFocus, routerLocation.pathname]);

  useShellSessionTelemetry(operatorSessionQuery.isSuccess);
  useShellTaskHeartbeat({
    snapshot: snapshotQuery.data,
    settings: settingsQuery.data?.settings
  });
  useShellThemeController(settingsQuery.data?.settings);

  useEffect(() => {
    const totalXp = snapshotQuery.data?.metrics.totalXp;
    if (typeof totalXp !== "number") {
      return;
    }

    if (previousXpRef.current === null) {
      previousXpRef.current = totalXp;
      return;
    }

    const deltaXp = totalXp - previousXpRef.current;
    previousXpRef.current = totalXp;
    if (deltaXp === 0) {
      return;
    }

    setXpNotice({ deltaXp, totalXp });
    void queryClient.invalidateQueries({ queryKey: ["forge-xp-metrics"] });
    if (xpTimerRef.current !== null) {
      window.clearTimeout(xpTimerRef.current);
    }
    xpTimerRef.current = window.setTimeout(() => {
      setXpNotice(null);
      xpTimerRef.current = null;
    }, 2600);
  }, [queryClient, snapshotQuery.data?.metrics.totalXp]);

  useEffect(() => {
    return () => {
      if (xpTimerRef.current !== null) {
        window.clearTimeout(xpTimerRef.current);
      }
    };
  }, []);

  const [createTaskMutation, createTaskMutationState] = useCreateTaskMutation();
  const [createGoalMutation, createGoalMutationState] = useCreateGoalMutation();
  const [createProjectMutation, createProjectMutationState] =
    useCreateProjectMutation();
  const [patchGoalMutation, patchGoalMutationState] = usePatchGoalMutation();
  const [patchProjectMutation, patchProjectMutationState] =
    usePatchProjectMutation();
  const [patchTaskMutation, patchTaskMutationState] = usePatchTaskMutation();
  const [patchTaskStatusMutation, patchTaskStatusMutationState] =
    usePatchTaskStatusMutation();
  const [claimTaskRunMutation, claimTaskRunMutationState] =
    useClaimTaskRunMutation();
  const [focusTaskRunMutation, focusTaskRunMutationState] =
    useFocusTaskRunMutation();
  const [releaseTaskRunMutation, releaseTaskRunMutationState] =
    useReleaseTaskRunMutation();
  const [completeTaskRunMutation, completeTaskRunMutationState] =
    useCompleteTaskRunMutation();
  const refreshLegacySnapshotQueries = async () => {
    await invalidateForgeSnapshot(queryClient);
  };
  const submitTaskStatusPatch = async (
    taskId: string,
    status: "backlog" | "focus" | "in_progress" | "blocked" | "done",
    options?: {
      completedTodayWorkSeconds?: number;
    }
  ) => {
    try {
      await patchTaskStatusMutation({
        taskId,
        status,
        enforceTodayWorkLog:
          status === "done" && options?.completedTodayWorkSeconds === undefined,
        completedTodayWorkSeconds: options?.completedTodayWorkSeconds
      }).unwrap();
      await refreshLegacySnapshotQueries();
    } catch (error) {
      if (
        error instanceof ForgeApiError &&
        error.code === "task_completion_work_log_required" &&
        status === "done" &&
        options?.completedTodayWorkSeconds === undefined
      ) {
        const taskTitle =
          snapshotQuery.data?.tasks.find((entry) => entry.id === taskId)
            ?.title ?? "this task";
        setTaskCompletionPrompt({
          taskId,
          title: taskTitle,
          status,
          customMinutes: "",
          error: null
        });
        return;
      }
      throw error;
    }
  };
  const submitCompletionPrompt = async (completedTodayWorkSeconds: number) => {
    if (!taskCompletionPrompt) {
      return;
    }
    try {
      await submitTaskStatusPatch(
        taskCompletionPrompt.taskId,
        taskCompletionPrompt.status,
        {
          completedTodayWorkSeconds
        }
      );
      setTaskCompletionPrompt(null);
    } catch (error) {
      setTaskCompletionPrompt((current) =>
        current
          ? {
              ...current,
              error:
                error instanceof Error
                  ? error.message
                  : "Could not close the task right now."
            }
          : current
      );
    }
  };

  const createAndStartTaskMutation = useMutation({
    mutationFn: async (input: {
      title: string;
      description: string;
      projectId: string;
      timerMode: "planned" | "unlimited";
      plannedDurationSeconds: number | null;
      gitContext: import("@/lib/types").TaskRunGitContext | null;
    }) => {
      const project = snapshotQuery.data?.dashboard.projects.find(
        (entry) => entry.id === input.projectId
      );
      if (!project) {
        throw new Error("Select a project before starting work.");
      }
      const operatorName =
        settingsQuery.data?.settings.profile.operatorName ?? "Albert";
      const created = await createTaskMutation({
        title: input.title,
        description: input.description,
        level: "task",
        owner: operatorName,
        userId:
          project.userId ??
          (selectedUserIds.length === 1 ? selectedUserIds[0] : null),
        assigneeUserIds: [],
        goalId: project.goalId,
        projectId: project.id,
        parentWorkItemId: null,
        priority: "medium",
        status: "in_progress",
        effort: "deep",
        energy: "steady",
        dueDate: "",
        points: 60,
        plannedDurationSeconds: 86_400,
        aiInstructions: "",
        executionMode: null,
        acceptanceCriteria: [],
        blockerLinks: [],
        completionReport: null,
        gitRefs: [],
        tagIds: [],
        notes: []
      }).unwrap();
      const started = await startTaskRunWithOverride(created.task.id, {
        actor: operatorName,
        timerMode: input.timerMode,
        plannedDurationSeconds: input.plannedDurationSeconds,
        isCurrent: true,
        leaseTtlSeconds: 1800,
        note: "",
        gitContext: input.gitContext
      });
      if (!started) {
        throw new Error(
          "The task was created, but live work did not start because the calendar override was cancelled."
        );
      }
      return created.task;
    },
    onSuccess: async () => {
      await refreshLegacySnapshotQueries();
    }
  });

  const startTaskRunWithOverride = async (
    taskId: string,
    input: Parameters<typeof claimTaskRun>[1]
  ) => {
    try {
      await claimTaskRunMutation({ taskId, input }).unwrap();
      await refreshLegacySnapshotQueries();
      return true;
    } catch (error) {
      if (
        error instanceof ForgeApiError &&
        error.code === "task_run_calendar_blocked" &&
        typeof window !== "undefined"
      ) {
        const overrideReason = window.prompt(
          "Calendar rules block this task right now. Add a reason to override and start anyway."
        );
        if (!overrideReason || overrideReason.trim().length === 0) {
          return false;
        }
        await claimTaskRunMutation({
          taskId,
          input: {
            ...input,
            overrideReason: overrideReason.trim()
          }
        }).unwrap();
        await refreshLegacySnapshotQueries();
        return true;
      }
      throw error;
    }
  };

  if (
    operatorSessionQuery.isLoading ||
    snapshotQuery.isLoading ||
    settingsQuery.isLoading
  ) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <LoadingState
          eyebrow="Forge shell"
          title="Loading Forge"
          description="Checking your operator session and loading your latest snapshot."
        />
      </div>
    );
  }

  if (operatorSessionQuery.isError) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <ErrorState
          eyebrow="Forge operator session"
          error={operatorSessionQuery.error}
          onRetry={() => void operatorSessionQuery.refetch()}
        />
      </div>
    );
  }

  if (settingsQuery.isError) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <ErrorState
          eyebrow="Forge settings"
          error={settingsQuery.error}
          onRetry={() => void settingsQuery.refetch()}
        />
      </div>
    );
  }

  if (snapshotQuery.isError || !snapshotQuery.data || !settingsQuery.data) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <ErrorState
          eyebrow="Forge state"
          error={snapshotQuery.error}
          onRetry={() => void snapshotQuery.refetch()}
        />
      </div>
    );
  }

  const contextValue: ShellContextValue = {
    snapshot: snapshotQuery.data,
    selectedUserIds,
    setSelectedUserIds,
    refresh: async () => {
      await Promise.all([
        snapshotQuery.refetch(),
        refreshLegacySnapshotQueries()
      ]);
    },
    createTask: async (input) => {
      await createTaskMutation(input).unwrap();
      await refreshLegacySnapshotQueries();
    },
    startTaskNow: async (taskId, options = {}) => {
      const operatorName = settingsQuery.data.settings.profile.operatorName;
      await startTaskRunWithOverride(
        taskId,
        buildStartTaskNowInput(operatorName, options)
      );
    },
    stopTaskRun: async (run) => {
      await releaseTaskRunMutation({
        runId: run.id,
        input: {
          actor: run.actor,
          note: run.note ?? ""
        }
      }).unwrap();
      await refreshLegacySnapshotQueries();
    },
    createGoal: async (input) => {
      await createGoalMutation(input).unwrap();
      await refreshLegacySnapshotQueries();
    },
    createProject: async (input) => {
      await createProjectMutation(input).unwrap();
      await refreshLegacySnapshotQueries();
    },
    patchGoal: async (goalId, patch) => {
      await patchGoalMutation({ goalId, patch }).unwrap();
      await refreshLegacySnapshotQueries();
    },
    patchProject: async (projectId, patch) => {
      await patchProjectMutation({ projectId, patch }).unwrap();
      await refreshLegacySnapshotQueries();
    },
    patchTask: async (taskId, patch) => {
      await patchTaskMutation({ taskId, patch }).unwrap();
      await refreshLegacySnapshotQueries();
    },
    patchTaskStatus: async (taskId, status, options) => {
      await submitTaskStatusPatch(taskId, status, options);
    },
    openStartWork: (defaults = {}) => {
      setStartWorkDefaults(defaults);
      setStartWorkError(null);
      setStartWorkOpen(true);
    }
  };
  lastKnownShellContext = contextValue;

  return (
    <I18nProvider locale={settingsQuery.data.settings.localePreference}>
      <ShellContext.Provider value={contextValue}>
        <>
          <GamificationAssetSetupDialog />
          <ShellFrame
            routeLocation={visibleLocation}
            settings={settingsQuery.data.settings}
            timerPending={
              focusTaskRunMutationState.isLoading ||
              releaseTaskRunMutationState.isLoading ||
              completeTaskRunMutationState.isLoading
            }
            startWorkOpen={startWorkOpen}
            startWorkPending={
              claimTaskRunMutationState.isLoading ||
              createAndStartTaskMutation.isPending
            }
            startWorkError={startWorkError}
            startWorkDefaults={startWorkDefaults}
            onOpenStartWork={(defaults) => {
              setStartWorkDefaults(defaults ?? {});
              setStartWorkError(null);
              setStartWorkOpen(true);
            }}
            onCloseStartWork={() => {
              setStartWorkOpen(false);
              setStartWorkError(null);
            }}
            onStartExistingTask={async (taskId, input) => {
              try {
                const operatorName =
                  settingsQuery.data.settings.profile.operatorName;
                const started = await startTaskRunWithOverride(taskId, {
                  actor: operatorName,
                  timerMode: input.timerMode,
                  plannedDurationSeconds: input.plannedDurationSeconds,
                  isCurrent: true,
                  leaseTtlSeconds: 1800,
                  note: "",
                  gitContext: input.gitContext
                });
                if (started) {
                  setStartWorkOpen(false);
                  setStartWorkError(null);
                }
              } catch (error) {
                setStartWorkError(
                  error instanceof Error
                    ? error.message
                    : "Could not start work."
                );
              }
            }}
            onCreateAndStartTask={async (input) => {
              try {
                await createAndStartTaskMutation.mutateAsync(input);
                setStartWorkOpen(false);
                setStartWorkError(null);
              } catch (error) {
                setStartWorkError(
                  error instanceof Error
                    ? error.message
                    : "Could not create and start the task."
                );
              }
            }}
            onFocusRun={async (runId) => {
              await focusTaskRunMutation(runId).unwrap();
              await refreshLegacySnapshotQueries();
            }}
            onPauseRun={async (runId) => {
              const run = snapshotQuery.data.activeTaskRuns.find(
                (entry) => entry.id === runId
              );
              await releaseTaskRunMutation({
                runId,
                input: {
                  actor: run?.actor,
                  note: run?.note ?? ""
                }
              }).unwrap();
              await refreshLegacySnapshotQueries();
            }}
            onCompleteRun={async (runId) => {
              const run = snapshotQuery.data.activeTaskRuns.find(
                (entry) => entry.id === runId
              );
              await completeTaskRunMutation({
                runId,
                input: {
                  actor: run?.actor,
                  note: run?.note ?? ""
                }
              }).unwrap();
              await refreshLegacySnapshotQueries();
            }}
          >
            <div className="relative min-w-0">
              {displayedLocationContext ? (
                <UNSAFE_LocationContext.Provider
                  value={displayedLocationContext}
                >
                  {displayedRoute.node}
                </UNSAFE_LocationContext.Provider>
              ) : (
                displayedRoute.node
              )}
              {pendingRoute ? (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 overflow-hidden opacity-0"
                >
                  {pendingRoute.node}
                </div>
              ) : null}
            </div>
          </ShellFrame>
          <Dialog.Root
            open={taskCompletionPrompt !== null}
            onOpenChange={(open) => {
              if (!open) {
                setTaskCompletionPrompt(null);
              }
            }}
          >
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-[70] bg-[rgba(5,8,18,0.74)] backdrop-blur-xl" />
              <Dialog.Content className="fixed left-1/2 top-1/2 z-[71] w-[min(92vw,34rem)] -translate-x-1/2 -translate-y-1/2 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(16,22,36,0.98),rgba(9,13,22,0.99))] p-6 shadow-[0_32px_90px_rgba(5,8,18,0.58)]">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Dialog.Title className="font-display text-[1.35rem] leading-tight text-white">
                      Log today&apos;s work before closing
                    </Dialog.Title>
                    <Dialog.Description className="mt-2 text-sm leading-6 text-white/64">
                      Forge closes tasks from actual time worked today, not from
                      the checkbox itself. Add the time you spent on{" "}
                      <span className="font-medium text-white">
                        {taskCompletionPrompt?.title ?? "this task"}
                      </span>{" "}
                      today, or confirm that you did not work on it today.
                    </Dialog.Description>
                  </div>
                  <ModalCloseButton
                    onClick={() => setTaskCompletionPrompt(null)}
                  />
                </div>

                <div className="mt-5">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">
                    Quick amounts
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[
                      { label: "5m", seconds: 5 * 60 },
                      { label: "15m", seconds: 15 * 60 },
                      { label: "30m", seconds: 30 * 60 },
                      { label: "1h", seconds: 60 * 60 },
                      { label: "2h", seconds: 2 * 60 * 60 }
                    ].map((entry) => (
                      <Button
                        key={entry.label}
                        variant="secondary"
                        onClick={() => {
                          void submitCompletionPrompt(entry.seconds);
                        }}
                      >
                        {entry.label}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="mt-5 grid gap-3 rounded-[20px] bg-white/[0.04] p-4">
                  <label className="grid gap-2 text-sm text-white/72">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-white/40">
                      Custom minutes
                    </span>
                    <input
                      type="number"
                      min={0}
                      step={5}
                      value={taskCompletionPrompt?.customMinutes ?? ""}
                      onChange={(event) => {
                        setTaskCompletionPrompt((current) =>
                          current
                            ? {
                                ...current,
                                customMinutes: event.target.value,
                                error: null
                              }
                            : current
                        );
                      }}
                      className="h-11 rounded-[16px] border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none transition focus:border-[var(--primary)]/40 focus:bg-white/[0.06]"
                      placeholder="45"
                    />
                  </label>
                  {taskCompletionPrompt?.error ? (
                    <div className="text-sm text-rose-200">
                      {taskCompletionPrompt.error}
                    </div>
                  ) : null}
                </div>

                <div className="mt-5 flex flex-wrap justify-end gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => setTaskCompletionPrompt(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      void submitCompletionPrompt(0);
                    }}
                  >
                    No work today
                  </Button>
                  <Button
                    onClick={() => {
                      if (!taskCompletionPrompt) {
                        return;
                      }
                      const minutes = Number(
                        taskCompletionPrompt.customMinutes
                      );
                      if (!Number.isFinite(minutes) || minutes < 0) {
                        setTaskCompletionPrompt((current) =>
                          current
                            ? {
                                ...current,
                                error: "Enter a valid number of minutes."
                              }
                            : current
                        );
                        return;
                      }
                      void submitCompletionPrompt(Math.round(minutes * 60));
                    }}
                  >
                    Close with logged time
                  </Button>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          {knowledgeGraphOverlayFocus?.focusNode ? (
            <div className="pointer-events-none fixed inset-y-0 right-0 z-[64] hidden lg:flex lg:max-w-[min(30rem,calc(100vw-4rem))] lg:items-start lg:justify-end lg:p-4">
              <div className="pointer-events-auto h-full w-[min(30rem,calc(100vw-4rem))] max-w-full overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,12,20,0.82),rgba(8,12,20,0.94))] pt-[calc(var(--forge-shell-desktop-header-padding-top)+4.8rem)] shadow-[0_24px_80px_rgba(5,8,18,0.42)] backdrop-blur-xl">
                <div className="h-full min-h-0 overflow-hidden">
                  <KnowledgeGraphFocusDrawer
                    focus={knowledgeGraphOverlayFocus}
                    onOpenPage={(node) => {
                      if (node.href) {
                        navigate(node.href);
                      }
                    }}
                    onOpenNotes={(node) => {
                      const href = getKnowledgeGraphNodeNotesHref(node);
                      if (href) {
                        navigate(href);
                      }
                    }}
                    onOpenHierarchy={openKnowledgeGraphHierarchy}
                    onSelectNode={setKnowledgeGraphRouteFocus}
                    onClose={() => setKnowledgeGraphRouteFocus(null)}
                  />
                </div>
              </div>
            </div>
          ) : null}
          <GamificationCelebrationLayer
            xpNotice={xpNotice}
            celebrations={xpMetricsQuery.data?.metrics.celebrations ?? []}
            onSeen={(celebrationId) => {
              if (!celebrationSeenMutation.isPending) {
                celebrationSeenMutation.mutate(celebrationId);
              }
            }}
          />
        </>
      </ShellContext.Provider>
    </I18nProvider>
  );
}

export function useForgeShell() {
  const shellContext = useContext(ShellContext);
  const outletContext = useOutletContext<ShellContextValue | null>();
  const resolvedContext =
    shellContext ?? outletContext ?? lastKnownShellContext;
  if (!resolvedContext) {
    throw new Error("Forge shell context is unavailable.");
  }
  return resolvedContext;
}

export function buildSidebarMetrics(
  snapshot: ForgeSnapshot,
  t: ReturnType<typeof useI18n>["t"]
) {
  return [
    {
      id: "ap",
      label: "AP",
      compactValue: snapshot.lifeForce
        ? String(Math.round(snapshot.lifeForce.remainingAp))
        : "0",
      expandedValue: snapshot.lifeForce
        ? `${Math.round(snapshot.lifeForce.remainingAp)} AP left`
        : "AP unavailable",
      icon: BatteryCharging
    },
    {
      id: "instant-ap",
      label: "Instant AP/h",
      compactValue: snapshot.lifeForce
        ? String(Number(snapshot.lifeForce.instantFreeApPerHour.toFixed(1)))
        : "0",
      expandedValue: snapshot.lifeForce
        ? formatLifeForceRate(snapshot.lifeForce.instantFreeApPerHour)
        : "0 AP/h",
      icon: Clock3
    },
    {
      id: "streak",
      label: t("common.shell.momentum.streak"),
      compactValue: String(snapshot.metrics.streakDays),
      expandedValue: t(
        snapshot.metrics.streakDays === 1
          ? "common.shell.momentum.streakBadgeOne"
          : "common.shell.momentum.streakBadgeOther",
        {
          count: snapshot.metrics.streakDays
        }
      ),
      icon: Flame
    },
    {
      id: "xp",
      label: t("common.shell.momentum.xp"),
      compactValue: String(snapshot.metrics.totalXp),
      expandedValue: `${snapshot.metrics.totalXp} XP`,
      icon: Zap
    },
    {
      id: "momentum",
      label: t("common.shell.momentum.momentum"),
      compactValue: `${snapshot.metrics.momentumScore}%`,
      expandedValue: t("common.shell.momentum.liveMomentum", {
        count: snapshot.metrics.momentumScore
      }),
      icon: Activity
    }
  ] as const;
}
