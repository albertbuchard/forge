import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
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
import { motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Bot,
  BookCopy,
  BrainCircuit,
  BriefcaseBusiness,
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
  Moon,
  NotebookPen,
  Radar,
  RefreshCcw,
  Repeat,
  Search,
  Settings,
  SlidersHorizontal,
  Target,
  UserRound,
  Users,
  Zap
} from "lucide-react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useOutletContext
} from "react-router-dom";
import { AmbientActivityPill } from "@/components/experience/ambient-activity-pill";
import { CommandPalette } from "@/components/experience/command-palette";
import { RouteTransitionFrame } from "@/components/experience/route-transition-frame";
import { SheetScaffold } from "@/components/experience/sheet-scaffold";
import { CreateMenu } from "@/components/create-menu";
import { PSYCHE_SECTIONS } from "@/components/psyche/psyche-section-nav";
import { StartWorkComposer } from "@/components/start-work-composer";
import {
  TaskTimerRailProvider,
  TaskTimerRailBar,
  TaskTimerRailPanel
} from "@/components/shell/task-timer-rail";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { useLiveEvents } from "@/hooks/use-live-events";
import {
  claimTaskRun,
  completeTaskRun,
  createGoal,
  createProject,
  createTask,
  ensureOperatorSession,
  getForgeSnapshot,
  getSettings,
  heartbeatTaskRun,
  listWikiIngestJobs,
  patchGoal,
  patchProject,
  patchTask,
  focusTaskRun,
  recordSessionEvent,
  releaseTaskRun
} from "@/lib/api";
import { ForgeApiError } from "@/lib/api-error";
import { I18nProvider, useI18n, type TranslationKey } from "@/lib/i18n";
import { applyForgeThemeToDocument } from "@/lib/theme-system";
import { cn } from "@/lib/utils";
import type {
  GoalMutationInput,
  ProjectMutationInput,
  QuickTaskInput
} from "@/lib/schemas";
import type {
  CalendarSchedulingRules,
  ForgeSnapshot,
  SettingsPayload,
  UserSummary,
  WikiIngestJobPayload
} from "@/lib/types";

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
  createGoal: (input: GoalMutationInput) => Promise<void>;
  createProject: (input: ProjectMutationInput) => Promise<void>;
  patchGoal: (goalId: string, patch: GoalMutationInput) => Promise<void>;
  patchProject: (
    projectId: string,
    patch: Partial<ProjectMutationInput> & {
      schedulingRules?: CalendarSchedulingRules | null;
    }
  ) => Promise<void>;
  patchTaskStatus: (
    taskId: string,
    status: "backlog" | "focus" | "in_progress" | "blocked" | "done"
  ) => Promise<void>;
  openStartWork: (defaults?: {
    taskId?: string | null;
    projectId?: string | null;
  }) => void;
};

const ShellContext = createContext<ShellContextValue | null>(null);

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

const WORKBENCH_ROUTE: ShellRouteDefinition = {
  id: "workbench",
  to: "/workbench",
  icon: LayoutGrid,
  label: "Workbench",
  detail: "Custom widgets and utility surface"
};

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
  WORKBENCH_ROUTE,
  ...PSYCHE_SHORTCUT_ROUTES
];

const SHELL_NAV_ROUTES = PRIMARY_ROUTES.filter(
  (route) => route.to !== "/preferences" && route.to !== "/sleep"
);

const MOBILE_CORE_ROUTES = [
  PRIMARY_ROUTES[0],
  PRIMARY_ROUTES[10],
  PRIMARY_ROUTES[9],
  PRIMARY_ROUTES[13]
] as const;
const MOBILE_MORE_ROUTES = [
  PRIMARY_ROUTES[1],
  PRIMARY_ROUTES[2],
  PRIMARY_ROUTES[3],
  PRIMARY_ROUTES[4],
  PRIMARY_ROUTES[6],
  PRIMARY_ROUTES[8],
  PRIMARY_ROUTES[11],
  PRIMARY_ROUTES[12],
  PRIMARY_ROUTES[14],
  PRIMARY_ROUTES[15],
  PRIMARY_ROUTES[16],
  PRIMARY_ROUTES[17]
] as const;

const USER_SCOPE_STORAGE_KEY = "forge.selected-user-ids";
const DESKTOP_NAV_STORAGE_KEY = "forge.desktop-nav-layout";
const MOBILE_NAV_STORAGE_KEY = "forge.mobile-nav-layout";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function interpolateNumber(progress: number, from: number, to: number) {
  return from + (to - from) * progress;
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
    return filtered.length > 0 ? filtered : defaults;
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

function UserScopeSelector({
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
          <span className="shell-scope-avatar">{activeOption.token}</span>
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
              <button
                type="button"
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[12px] font-medium text-white/70 transition hover:bg-white/[0.08] hover:text-white"
              >
                Close
              </button>
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

function ShellNavEditor({
  open,
  onOpenChange,
  desktopNavIds,
  onDesktopNavIdsChange,
  mobileNavIds,
  onMobileNavIdsChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  desktopNavIds: string[];
  onDesktopNavIdsChange: (ids: string[]) => void;
  mobileNavIds: string[];
  onMobileNavIdsChange: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const desktopRoutes = desktopNavIds
    .map((id) => NAV_ROUTE_REGISTRY.find((route) => route.id === id) ?? null)
    .filter((route): route is ShellRouteDefinition => route !== null);
  const mobileRoutes = mobileNavIds
    .map((id) => NAV_ROUTE_REGISTRY.find((route) => route.id === id) ?? null)
    .filter((route): route is ShellRouteDefinition => route !== null);
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
    return Array.from({ length: slotCount }, (_, index) => {
      const id = ids[index] ?? null;
      const route = id
        ? (NAV_ROUTE_REGISTRY.find((entry) => entry.id === id) ?? null)
        : null;

      if (!route) {
        return (
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
              Slot {index + 1}
            </div>
          </div>
        );
      }

      return (
        <div
          key={`${prefix}-${route.id}`}
          className="flex min-h-16 items-center justify-between gap-3 rounded-[20px] bg-white/[0.04] px-4 py-3"
        >
          <span className="flex items-center gap-3">
            <route.icon className="size-4 text-[var(--primary)]" />
            <span className="text-sm text-white">
              {getRouteLabel(route, t)}
            </span>
          </span>
          <button
            type="button"
            className="rounded-full bg-white/[0.05] px-3 py-1.5 text-[12px] text-white/70"
            onClick={() => removeFromList(ids, route.id, onChange, minimum)}
          >
            Remove
          </button>
        </div>
      );
    });
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
      description="Add or remove main routes, Psyche shortcuts, and the custom workbench surface."
    >
      <div className="grid gap-5">
        <div className="grid gap-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
            Desktop sidebar
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
                      className="rounded-full bg-white/[0.05] px-3 py-1.5 text-[12px] text-white/70"
                      onClick={() =>
                        addToList(
                          desktopNavIds,
                          route.id,
                          onDesktopNavIdsChange
                        )
                      }
                    >
                      Add to sidebar
                    </button>
                  ) : null}
                  {!mobileNavIds.includes(route.id) ? (
                    <button
                      type="button"
                      className="rounded-full bg-white/[0.05] px-3 py-1.5 text-[12px] text-white/70"
                      onClick={() =>
                        addToList(
                          mobileNavIds,
                          route.id,
                          onMobileNavIdsChange,
                          4
                        )
                      }
                    >
                      Add to mobile
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
    }
  ) => Promise<void>;
  onCreateAndStartTask: (input: {
    title: string;
    description: string;
    projectId: string;
    timerMode: "planned" | "unlimited";
    plannedDurationSeconds: number | null;
  }) => Promise<void>;
  onFocusRun: (runId: string) => Promise<void>;
  onPauseRun: (runId: string) => Promise<void>;
  onCompleteRun: (runId: string) => Promise<void>;
}) {
  const location = useLocation();
  const shell = useForgeShell();
  const { t } = useI18n();
  const active =
    NAV_ROUTE_REGISTRY.find((route) =>
      routeMatches(location.pathname, route)
    ) ?? PRIMARY_ROUTES[0];
  const transitionKey = getRouteTransitionKey(location.pathname);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [backgroundActivityOpen, setBackgroundActivityOpen] = useState(false);
  const [collapseProgress, setCollapseProgress] = useState(0);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [desktopNavIds, setDesktopNavIds] = useState<string[]>(() =>
    readStoredNavIds(DESKTOP_NAV_STORAGE_KEY, [
      ...SHELL_NAV_ROUTES.map((route) => route.id),
      WORKBENCH_ROUTE.id
    ])
  );
  const [mobileNavIds, setMobileNavIds] = useState<string[]>(() =>
    readStoredNavIds(MOBILE_NAV_STORAGE_KEY, [
      PRIMARY_ROUTES[0]!.id,
      PRIMARY_ROUTES[10]!.id,
      PRIMARY_ROUTES[9]!.id,
      PRIMARY_ROUTES[13]!.id
    ])
  );
  const [navEditorOpen, setNavEditorOpen] = useState(false);
  const autoCollapseAppliedRef = useRef(false);
  const preAutoCollapseRef = useRef(false);
  const skipNavPersistenceRef = useRef(false);
  const isPsyche = isPsycheRoute(location.pathname);
  const wikiSurface = isWikiRoute(location.pathname);
  const psycheSurface = isPsycheRoute(location.pathname);
  const autoCollapseSurface = wikiSurface || psycheSurface;
  const desktopRoutes = desktopNavIds
    .map((id) => NAV_ROUTE_REGISTRY.find((route) => route.id === id) ?? null)
    .filter((route): route is ShellRouteDefinition => route !== null);
  const mobileRoutes = mobileNavIds
    .map((id) => NAV_ROUTE_REGISTRY.find((route) => route.id === id) ?? null)
    .filter((route): route is ShellRouteDefinition => route !== null);
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const reduceMotion = useReducedMotion();
  const collapsed = collapseProgress >= 0.96;
  const activityCount = fetching + mutating;
  const ingestJobsQuery = useQuery({
    queryKey: ["forge-background-wiki-ingest-jobs"],
    queryFn: () => listWikiIngestJobs({ limit: 12 }),
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs ?? [];
      return backgroundActivityOpen ||
        jobs.some((job) => ["queued", "processing"].includes(job.job.status))
        ? 2000
        : false;
    }
  });
  const sidebarMetrics = [
    {
      id: "streak",
      label: t("common.shell.momentum.streak"),
      compactValue: String(shell.snapshot.metrics.streakDays),
      expandedValue: t(
        shell.snapshot.metrics.streakDays === 1
          ? "common.shell.momentum.streakBadgeOne"
          : "common.shell.momentum.streakBadgeOther",
        {
          count: shell.snapshot.metrics.streakDays
        }
      ),
      icon: Flame
    },
    {
      id: "xp",
      label: t("common.shell.momentum.xp"),
      compactValue: String(shell.snapshot.metrics.totalXp),
      expandedValue: `${shell.snapshot.metrics.totalXp} XP`,
      icon: Zap
    },
    {
      id: "momentum",
      label: t("common.shell.momentum.momentum"),
      compactValue: `${shell.snapshot.metrics.momentumScore}%`,
      expandedValue: t("common.shell.momentum.liveMomentum", {
        count: shell.snapshot.metrics.momentumScore
      }),
      icon: Activity
    }
  ] as const;
  const activityLabel = (ingestJobsQuery.data?.jobs ?? []).some((job) =>
    ["queued", "processing"].includes(job.job.status)
  )
    ? (() => {
        const activeJobs = (ingestJobsQuery.data?.jobs ?? []).filter((job) =>
          ["queued", "processing"].includes(job.job.status)
        );
        if (activeJobs.length === 1) {
          return (
            activeJobs[0]?.job.latestMessage ||
            activeJobs[0]?.job.titleHint ||
            "1 ingest running"
          );
        }
        return `${activeJobs.length} ingest jobs running`;
      })()
    : mutating > 0
      ? t(
          mutating === 1
            ? "common.shell.savingOne"
            : "common.shell.savingOther",
          { count: mutating }
        )
      : fetching > 0
        ? t(
            fetching === 1
              ? "common.shell.refreshingOne"
              : "common.shell.refreshingOther",
            { count: fetching }
          )
        : t("common.shell.settled");
  const recentIngestJobs = ingestJobsQuery.data?.jobs ?? [];
  const hasActiveIngestJobs = recentIngestJobs.some((job) =>
    ["queued", "processing"].includes(job.job.status)
  );

  const railLinks = useMemo(() => {
    if (location.pathname.startsWith("/tasks/")) {
      return [
        { to: "/kanban", label: t("common.shell.rail.taskBackToKanban") },
        { to: "/today", label: t("common.shell.rail.taskOpenToday") }
      ];
    }
    if (location.pathname.startsWith("/projects/")) {
      return [
        { to: "/projects", label: t("common.shell.rail.projectAll") },
        { to: "/goals", label: t("common.shell.rail.projectGoals") }
      ];
    }
    if (location.pathname.startsWith("/goals/")) {
      return [
        { to: "/goals", label: t("common.shell.rail.goalAll") },
        { to: "/projects", label: t("common.shell.rail.goalProjects") }
      ];
    }
    if (location.pathname.startsWith("/strategies")) {
      return [
        { to: "/strategies", label: t("common.routeLabels.strategies") },
        { to: "/projects", label: t("common.shell.rail.projectAll") }
      ];
    }
    if (isPsycheRoute(location.pathname)) {
      return [
        { to: "/psyche", label: t("common.shell.rail.psycheHub") },
        { to: "/psyche/reports", label: t("common.shell.rail.psycheReports") }
      ];
    }
    return [
      { to: "/overview", label: t("common.shell.rail.overview") },
      { to: "/today", label: t("common.shell.rail.today") }
    ];
  }, [location.pathname, t]);

  useEffect(() => {
    let lastStandaloneShiftAt = 0;

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((current) => !current);
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
          setPaletteOpen(true);
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

  useEffect(() => {
    const syncCollapsed = () => {
      const collapseDistance = window.innerWidth >= 1024 ? 72 : 56;
      const nextProgress = clamp(
        readWindowScrollTop() / collapseDistance,
        0,
        1
      );
      setCollapseProgress((current) =>
        Math.abs(current - nextProgress) < 0.01 ? current : nextProgress
      );
    };

    syncCollapsed();
    window.addEventListener("scroll", syncCollapsed, { passive: true });
    window.addEventListener("resize", syncCollapsed);
    return () => {
      window.removeEventListener("scroll", syncCollapsed);
      window.removeEventListener("resize", syncCollapsed);
    };
  }, []);

  const desktopHeaderPaddingTop = interpolateNumber(collapseProgress, 10, 6);
  const desktopHeaderPaddingBottom = interpolateNumber(collapseProgress, 9, 6);
  const desktopTitleSize = interpolateNumber(collapseProgress, 1.12, 1);
  const desktopSecondaryOpacity = 1 - collapseProgress;
  const desktopSecondaryMaxHeight = interpolateNumber(collapseProgress, 160, 0);
  const desktopSecondarySpacing = interpolateNumber(collapseProgress, 12, 0);
  const desktopSecondaryTranslateY = interpolateNumber(
    collapseProgress,
    0,
    -10
  );

  const mobileHeaderPaddingTop = interpolateNumber(collapseProgress, 9, 6);
  const mobileHeaderPaddingBottom = interpolateNumber(collapseProgress, 8, 6);
  const mobileTitleSize = interpolateNumber(collapseProgress, 1, 0.95);
  const mobileCopyOpacity = 1 - collapseProgress;
  const mobileCopyMaxHeight = interpolateNumber(collapseProgress, 240, 0);
  const mobileCopyTranslateY = interpolateNumber(collapseProgress, 0, -8);

  return (
    <div
      className={`min-h-screen ${shell.snapshot.meta.mode === "transitional-node" ? "theme-forge-obsidian" : ""}`}
    >
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        snapshot={shell.snapshot}
        selectedUserIds={shell.selectedUserIds}
      />

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
            "flex min-h-screen flex-col border-r border-white/5 bg-[rgba(8,13,28,0.78)] py-6 backdrop-blur-xl transition-[padding,width]",
            navCollapsed ? "px-3" : "px-5"
          )}
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

          <div className={cn("grid gap-2", navCollapsed ? "mt-6" : "mt-8")}>
            {desktopRoutes.map((route) => (
              <NavItem key={route.id} route={route} compact={navCollapsed} />
            ))}
          </div>

          <div className={cn(navCollapsed ? "mt-4" : "mt-6")}>
            <div
              className={cn(
                "rounded-[24px] bg-white/[0.04]",
                navCollapsed ? "px-2 py-2.5" : "p-4"
              )}
            >
              {!navCollapsed ? (
                <div className="type-label text-white/40">
                  {t("common.shell.momentum.title")}
                </div>
              ) : null}
              <div
                className={cn("grid", navCollapsed ? "gap-1.5" : "mt-3 gap-3")}
              >
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
        </aside>

        <div className="min-h-screen">
          <TaskTimerRailProvider>
            <motion.header
              className="sticky top-0 z-30 border-b border-white/5 bg-[rgba(10,16,30,0.82)] px-6 backdrop-blur-xl"
              animate={reduceMotion ? undefined : undefined}
              style={{
                paddingTop: `${desktopHeaderPaddingTop}px`,
                paddingBottom: `${desktopHeaderPaddingBottom}px`
              }}
              transition={{ duration: 0.35, ease: "easeOut" }}
            >
              {/* ── Title row: page title + work bar + action buttons — all same height ── */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 flex-1 items-center gap-5">
                  <motion.div
                    className="shrink-0 font-display text-white"
                    animate={reduceMotion ? undefined : undefined}
                    style={{
                      fontSize: `${desktopTitleSize}rem`,
                      lineHeight: 1
                    }}
                    transition={{ duration: 0.35, ease: "easeOut" }}
                  >
                    {getRouteLabel(active, t)}
                  </motion.div>
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
                  <AmbientActivityPill
                    active={activityCount > 0 || hasActiveIngestJobs}
                    label={activityLabel}
                    onClick={() => setBackgroundActivityOpen(true)}
                  />
                  <ShellCommandButton onClick={() => setPaletteOpen(true)} />
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

              <motion.div
                className="flex items-center justify-between gap-4 overflow-hidden border-t border-white/6"
                animate={reduceMotion ? undefined : undefined}
                style={{
                  opacity: desktopSecondaryOpacity,
                  maxHeight: `${desktopSecondaryMaxHeight}px`,
                  marginTop: `${desktopSecondarySpacing}px`,
                  paddingTop: `${desktopSecondarySpacing}px`,
                  transform: `translateY(${desktopSecondaryTranslateY}px)`,
                  pointerEvents: collapseProgress >= 0.96 ? "none" : "auto"
                }}
                transition={{ duration: 0.28, ease: "easeOut" }}
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
              </motion.div>
            </motion.header>
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

          <main className="px-6 py-3">
            <RouteTransitionFrame
              routeKey={transitionKey}
              tone={isPsyche ? "psyche" : "core"}
            >
              {children}
            </RouteTransitionFrame>
          </main>
        </div>
      </div>

      <div className="min-h-[100dvh] overflow-x-clip lg:hidden">
        <TaskTimerRailProvider>
          <motion.header
            className="sticky top-0 z-30 border-b border-white/6 bg-[rgba(8,13,28,0.92)] px-4 backdrop-blur-xl"
            animate={reduceMotion ? undefined : undefined}
            style={{
              paddingTop: `${mobileHeaderPaddingTop}px`,
              paddingBottom: `${mobileHeaderPaddingBottom}px`
            }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div
                  className={cn(
                    "shrink-0 font-display text-white transition",
                    collapsed ? "text-[0.95rem]" : "text-base"
                  )}
                  style={{ fontSize: `${mobileTitleSize}rem` }}
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
                  onClick={() => setPaletteOpen(true)}
                >
                  <Search className="size-4" />
                </Button>
                <div className="inline-flex min-h-[2.125rem] items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.05] px-2.5 text-[12px] font-medium text-[var(--primary)]">
                  <Zap className="size-3.5 shrink-0" />
                  <span>
                    {formatCompactNumber(shell.snapshot.metrics.totalXp)} XP
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

            <motion.div
              className="overflow-hidden"
              animate={reduceMotion ? undefined : undefined}
              style={{
                opacity: mobileCopyOpacity,
                maxHeight: `${mobileCopyMaxHeight}px`,
                transform: `translateY(${mobileCopyTranslateY}px)`,
                pointerEvents: collapseProgress >= 0.96 ? "none" : "auto"
              }}
              transition={{ duration: 0.28, ease: "easeOut" }}
            >
              <div className="mt-2 text-[13px] leading-5 text-white/52">
                {getRouteDetail(active, t)}
              </div>
            </motion.div>
            {!collapsed ? (
              <>
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
              </>
            ) : null}
          </motion.header>
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
          className="overflow-x-clip px-4 py-2.5 lg:pb-24"
          style={{
            paddingBottom: "calc(var(--forge-mobile-nav-clearance) + 2.5rem)",
            paddingLeft: "max(1rem, calc(var(--forge-safe-area-left) + 1rem))",
            paddingRight: "max(1rem, calc(var(--forge-safe-area-right) + 1rem))"
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
                  Follow active wiki ingest jobs and reopen completed reviews
                  without leaving your current context.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[12px] font-medium text-white/70 transition hover:bg-white/[0.08] hover:text-white"
                >
                  Close
                </button>
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
                              Wiki ingest
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
        goals={shell.snapshot.dashboard.goals}
        projects={shell.snapshot.dashboard.projects}
        tags={shell.snapshot.tags}
        users={shell.snapshot.users}
        defaultUserId={
          shell.selectedUserIds.length === 1 ? shell.selectedUserIds[0] : null
        }
        onCreateGoal={shell.createGoal}
        onCreateProject={shell.createProject}
        onCreateTask={shell.createTask}
      />
    </div>
  );
}

export function AppShell() {
  useLiveEvents();
  const sessionIdRef = useRef(
    `forge_session_${Math.random().toString(36).slice(2, 10)}`
  );
  const xpTimerRef = useRef<number | null>(null);
  const previousXpRef = useRef<number | null>(null);
  const queryClient = useQueryClient();
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(
    readStoredSelectedUserIds
  );
  const [startWorkOpen, setStartWorkOpen] = useState(false);
  const [startWorkDefaults, setStartWorkDefaults] = useState<{
    taskId?: string | null;
    projectId?: string | null;
  }>({});
  const [startWorkError, setStartWorkError] = useState<string | null>(null);
  const [xpNotice, setXpNotice] = useState<{
    deltaXp: number;
    totalXp: number;
  } | null>(null);
  const operatorSessionQuery = useQuery({
    queryKey: ["forge-shell-operator-session"],
    queryFn: ensureOperatorSession,
    retry: false,
    staleTime: 5 * 60_000
  });
  const snapshotQuery = useQuery({
    queryKey: ["forge-snapshot", ...selectedUserIds],
    queryFn: () => getForgeSnapshot(selectedUserIds),
    enabled: operatorSessionQuery.isSuccess
  });
  const settingsQuery = useQuery({
    queryKey: ["forge-settings"],
    queryFn: getSettings,
    enabled: operatorSessionQuery.isSuccess
  });

  useEffect(() => {
    writeStoredSelectedUserIds(selectedUserIds);
  }, [selectedUserIds]);

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
    if (xpTimerRef.current !== null) {
      window.clearTimeout(xpTimerRef.current);
    }
    xpTimerRef.current = window.setTimeout(() => {
      setXpNotice(null);
      xpTimerRef.current = null;
    }, 2600);
  }, [snapshotQuery.data?.metrics.totalXp]);

  useEffect(() => {
    return () => {
      if (xpTimerRef.current !== null) {
        window.clearTimeout(xpTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const settings = settingsQuery.data?.settings;
    if (!settings) {
      return;
    }

    const applyTheme = () => {
      applyForgeThemeToDocument(
        settings.themePreference,
        settings.customTheme ?? null
      );
    };

    applyTheme();

    if (
      settings.themePreference !== "system" ||
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyTheme();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, [settingsQuery.data?.settings]);

  useEffect(() => {
    if (!operatorSessionQuery.isSuccess) {
      return;
    }

    let interacted = false;
    let dwellSent = false;
    let scrollSent = false;

    const markInteraction = () => {
      interacted = true;
    };

    const sendEvent = (
      eventType: string,
      metrics: Record<string, string | number | boolean | null>
    ) =>
      recordSessionEvent({
        sessionId: sessionIdRef.current,
        eventType,
        metrics
      }).catch(() => undefined);

    void sendEvent("session_started", {
      visible: document.visibilityState === "visible",
      interacted: false
    });

    const dwellTimer = window.setTimeout(() => {
      if (document.visibilityState === "visible" && interacted && !dwellSent) {
        dwellSent = true;
        void sendEvent("dwell_120_seconds", {
          visible: true,
          interacted: true
        });
      }
    }, 120_000);

    const onScroll = () => {
      const denominator = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight
      );
      const progress = Math.round((window.scrollY / denominator) * 100);
      if (progress >= 75 && interacted && !scrollSent) {
        scrollSent = true;
        void sendEvent("scroll_depth_75", {
          visible: document.visibilityState === "visible",
          interacted: true,
          scrollDepth: progress
        });
      }
    };

    window.addEventListener("pointerdown", markInteraction);
    window.addEventListener("keydown", markInteraction);
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.clearTimeout(dwellTimer);
      window.removeEventListener("pointerdown", markInteraction);
      window.removeEventListener("keydown", markInteraction);
      window.removeEventListener("scroll", onScroll);
    };
  }, [operatorSessionQuery.isSuccess]);

  const createTaskMutation = useMutation({
    mutationFn: (input: QuickTaskInput) => createTask(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] });
    }
  });

  const createGoalMutation = useMutation({
    mutationFn: (input: GoalMutationInput) => createGoal(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] });
    }
  });

  const createProjectMutation = useMutation({
    mutationFn: (input: ProjectMutationInput) => createProject(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] });
    }
  });

  const patchGoalMutation = useMutation({
    mutationFn: ({
      goalId,
      patch
    }: {
      goalId: string;
      patch: GoalMutationInput;
    }) => patchGoal(goalId, patch),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] });
    }
  });

  const patchProjectMutation = useMutation({
    mutationFn: ({
      projectId,
      patch
    }: {
      projectId: string;
      patch: Partial<ProjectMutationInput>;
    }) => patchProject(projectId, patch),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] });
    }
  });

  const patchTaskMutation = useMutation({
    mutationFn: ({
      taskId,
      status
    }: {
      taskId: string;
      status: "backlog" | "focus" | "in_progress" | "blocked" | "done";
    }) => patchTask(taskId, { status }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] });
    }
  });
  const claimTaskRunMutation = useMutation({
    mutationFn: ({
      taskId,
      input
    }: {
      taskId: string;
      input: Parameters<typeof claimTaskRun>[1];
    }) => claimTaskRun(taskId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] });
    }
  });
  const focusTaskRunMutation = useMutation({
    mutationFn: (runId: string) => focusTaskRun(runId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] });
    }
  });
  const releaseTaskRunMutation = useMutation({
    mutationFn: ({
      runId,
      actor,
      note
    }: {
      runId: string;
      actor?: string;
      note?: string;
    }) => releaseTaskRun(runId, { actor, note: note ?? "" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] });
    }
  });
  const completeTaskRunMutation = useMutation({
    mutationFn: ({
      runId,
      actor,
      note
    }: {
      runId: string;
      actor?: string;
      note?: string;
    }) => completeTaskRun(runId, { actor, note: note ?? "" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] });
    }
  });

  const createAndStartTaskMutation = useMutation({
    mutationFn: async (input: {
      title: string;
      description: string;
      projectId: string;
      timerMode: "planned" | "unlimited";
      plannedDurationSeconds: number | null;
    }) => {
      const project = snapshotQuery.data?.dashboard.projects.find(
        (entry) => entry.id === input.projectId
      );
      if (!project) {
        throw new Error("Select a project before starting work.");
      }
      const operatorName =
        settingsQuery.data?.settings.profile.operatorName ?? "Albert";
      const created = await createTask({
        title: input.title,
        description: input.description,
        owner: operatorName,
        userId:
          project.userId ??
          (selectedUserIds.length === 1 ? selectedUserIds[0] : null),
        goalId: project.goalId,
        projectId: project.id,
        priority: "medium",
        status: "in_progress",
        effort: "deep",
        energy: "steady",
        dueDate: "",
        points: 60,
        tagIds: [],
        notes: []
      });
      const started = await startTaskRunWithOverride(created.task.id, {
        actor: operatorName,
        timerMode: input.timerMode,
        plannedDurationSeconds: input.plannedDurationSeconds,
        isCurrent: true,
        leaseTtlSeconds: 1800,
        note: ""
      });
      if (!started) {
        throw new Error(
          "The task was created, but live work did not start because the calendar override was cancelled."
        );
      }
      return created.task;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] });
    }
  });

  const startTaskRunWithOverride = async (
    taskId: string,
    input: Parameters<typeof claimTaskRun>[1]
  ) => {
    try {
      await claimTaskRunMutation.mutateAsync({ taskId, input });
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
        await claimTaskRunMutation.mutateAsync({
          taskId,
          input: {
            ...input,
            overrideReason: overrideReason.trim()
          }
        });
        return true;
      }
      throw error;
    }
  };

  useEffect(() => {
    const snapshot = snapshotQuery.data;
    if (!snapshot || snapshot.activeTaskRuns.length === 0) {
      return;
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      for (const run of snapshot.activeTaskRuns) {
        void heartbeatTaskRun(run.id, {
          actor: run.actor,
          leaseTtlSeconds: run.leaseTtlSeconds,
          note: run.note
        }).catch(() => undefined);
      }
      void queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] });
    }, 30_000);

    return () => window.clearInterval(timer);
  }, [queryClient, snapshotQuery.data]);

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
          onRetry={() =>
            void queryClient.invalidateQueries({
              queryKey: ["forge-shell-operator-session"]
            })
          }
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
          onRetry={() =>
            void queryClient.invalidateQueries({ queryKey: ["forge-settings"] })
          }
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
          onRetry={() =>
            void queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] })
          }
        />
      </div>
    );
  }

  const contextValue: ShellContextValue = {
    snapshot: snapshotQuery.data,
    selectedUserIds,
    setSelectedUserIds,
    refresh: async () => {
      await queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] });
    },
    createTask: async (input) => {
      await createTaskMutation.mutateAsync(input);
    },
    startTaskNow: async (taskId, options = {}) => {
      const operatorName = settingsQuery.data.settings.profile.operatorName;
      await startTaskRunWithOverride(taskId, {
        actor: operatorName,
        timerMode: options.timerMode ?? "planned",
        plannedDurationSeconds:
          options.plannedDurationSeconds === undefined
            ? 20 * 60
            : options.plannedDurationSeconds,
        isCurrent: true,
        leaseTtlSeconds: 1800,
        note: ""
      });
    },
    createGoal: async (input) => {
      await createGoalMutation.mutateAsync(input);
    },
    createProject: async (input) => {
      await createProjectMutation.mutateAsync(input);
    },
    patchGoal: async (goalId, patch) => {
      await patchGoalMutation.mutateAsync({ goalId, patch });
    },
    patchProject: async (projectId, patch) => {
      await patchProjectMutation.mutateAsync({ projectId, patch });
    },
    patchTaskStatus: async (taskId, status) => {
      await patchTaskMutation.mutateAsync({ taskId, status });
    },
    openStartWork: (defaults = {}) => {
      setStartWorkDefaults(defaults);
      setStartWorkError(null);
      setStartWorkOpen(true);
    }
  };

  return (
    <I18nProvider locale={settingsQuery.data.settings.localePreference}>
      <ShellContext.Provider value={contextValue}>
        <>
          <ShellFrame
            settings={settingsQuery.data.settings}
            timerPending={
              focusTaskRunMutation.isPending ||
              releaseTaskRunMutation.isPending ||
              completeTaskRunMutation.isPending
            }
            startWorkOpen={startWorkOpen}
            startWorkPending={
              claimTaskRunMutation.isPending ||
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
                  note: ""
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
              await focusTaskRunMutation.mutateAsync(runId);
            }}
            onPauseRun={async (runId) => {
              const run = snapshotQuery.data.activeTaskRuns.find(
                (entry) => entry.id === runId
              );
              await releaseTaskRunMutation.mutateAsync({
                runId,
                actor: run?.actor,
                note: run?.note
              });
            }}
            onCompleteRun={async (runId) => {
              const run = snapshotQuery.data.activeTaskRuns.find(
                (entry) => entry.id === runId
              );
              await completeTaskRunMutation.mutateAsync({
                runId,
                actor: run?.actor,
                note: run?.note
              });
            }}
          >
            <Outlet context={contextValue} />
          </ShellFrame>
          {xpNotice ? (
            <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 lg:bottom-6">
              <div
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-[0_18px_48px_rgba(3,8,18,0.38)] backdrop-blur-xl",
                  xpNotice.deltaXp > 0
                    ? "border-emerald-400/30 bg-emerald-500/14 text-emerald-100"
                    : "border-rose-400/30 bg-rose-500/14 text-rose-100"
                )}
              >
                <Zap className="size-4 shrink-0" />
                <span>
                  {xpNotice.deltaXp > 0
                    ? `XP +${xpNotice.deltaXp}`
                    : `XP ${xpNotice.deltaXp}`}{" "}
                  · {formatCompactNumber(xpNotice.totalXp)} total
                </span>
              </div>
            </div>
          ) : null}
        </>
      </ShellContext.Provider>
    </I18nProvider>
  );
}

export function useForgeShell() {
  return useContext(ShellContext) ?? useOutletContext<ShellContextValue>();
}
