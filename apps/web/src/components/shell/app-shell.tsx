import {
  createContext,
  useContext,
  useEffect,
  lazy,
  useMemo,
  useRef,
  Suspense,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import {
  useIsFetching,
  useIsMutating,
  useMutation,
  useQueryClient
} from "@tanstack/react-query";
import {
  ChevronsLeft,
  ChevronsRight,
  GripVertical,
  RefreshCcw,
  Search,
  Zap
} from "lucide-react";
import {
  Link,
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
import { RouteTransitionFrame } from "@/components/experience/route-transition-frame";
import { KnowledgeGraphFocusDrawer } from "@/components/knowledge-graph/knowledge-graph-focus-drawer";
import { CreateMenu, useForgeCreateActions } from "@/components/create-menu";
import { StartWorkComposer } from "@/components/start-work-composer";
import {
  buildKnowledgeGraphSearchFromLocation,
  buildRouteIntentLocation,
  buildRoutePathKey,
  buildStartTaskNowInput,
  formatCompactNumber,
  getKnowledgeGraphNodeNotesHref,
  getRouteTransitionKey,
  sameSelectedUserIds,
  sanitizeSelectedUserIds
} from "@/components/shell/shell-model";
export {
  buildStartTaskNowInput,
  sanitizeSelectedUserIds
} from "@/components/shell/shell-model";
import {
  MobileBottomNav,
  NavItem,
  ShellNavEditor,
  useShellNavigationState
} from "@/components/shell/shell-navigation";
import { ShellBackgroundActivityDialog } from "@/components/shell/shell-background-activity-dialog";
import {
  NAV_ROUTE_REGISTRY,
  PRIMARY_ROUTES,
  getRouteDetail,
  getRouteLabel,
  isPsycheRoute,
  routeMatches
} from "@/components/shell/shell-routes";
import {
  SidebarMetricsPanel,
  buildSidebarMetrics
} from "@/components/shell/shell-sidebar-metrics";
export { buildSidebarMetrics } from "@/components/shell/shell-sidebar-metrics";
import {
  TaskCompletionWorkLogDialog,
  type TaskCompletionPromptState
} from "@/components/shell/task-completion-work-log-dialog";
import {
  TaskTimerRailProvider,
  TaskTimerRailBar,
  TaskTimerRailPanel
} from "@/components/shell/task-timer-rail";
import { UserScopeSelector } from "@/components/shell/user-scope-selector";
export { UserScopeSelector } from "@/components/shell/user-scope-selector";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { ErrorState, LoadingState } from "@/components/ui/page-state";
import { useLiveEvents } from "@/hooks/use-live-events";
import { claimTaskRun, patchTask } from "@/lib/api";
import { ForgeApiError } from "@/lib/api-error";
import { I18nProvider, useI18n } from "@/lib/i18n";
import type { KnowledgeGraphNode } from "@/lib/knowledge-graph-types";
import { getSurfaceHelp } from "@/lib/surface-help";
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
  TaskRun
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
  useGetXpMetricsQuery,
  useMarkGamificationCelebrationSeenMutation,
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
import { RouteViewLoadingSurface } from "@/routes/route-view";
import {
  ROUTE_VIEW_CATALOG,
  resolveRouteViewIdFromPathname
} from "@/routes/route-view-catalog";

const LazyActionBar = lazy(() =>
  import("@/components/experience/action-bar").then((module) => ({
    default: module.ActionBar
  }))
);

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

const ShellContext = createContext<ShellContextValue | null>(null);
let lastKnownShellContext: ShellContextValue | null = null;

function ShellCommandButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();

  return (
    <Button
      variant="secondary"
      size="sm"
      className="min-w-0 px-3.5"
      onClick={onClick}
    >
      <Search className="size-4" />
      {t("common.shell.command")}
      <Badge
        size="sm"
        tone="meta"
        className="ml-1 hidden bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)] xl:inline-flex"
      >
        Shift Shift
      </Badge>
      <Badge
        size="sm"
        tone="meta"
        className="hidden bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)] 2xl:inline-flex"
      >
        Cmd K
      </Badge>
    </Button>
  );
}

function ShellFrame({
  children,
  routeLocation,
  onRouteIntent,
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
  onRouteIntent: (to: string) => void;
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
  const activeHelp = getSurfaceHelp(active.id);
  const transitionKey = getRouteTransitionKey(routeLocation.pathname);
  const [actionBarOpen, setActionBarOpen] = useState(false);
  const [backgroundActivityOpen, setBackgroundActivityOpen] = useState(false);
  const shellRootRef = useRef<HTMLDivElement | null>(null);
  const {
    navCollapsed,
    setNavCollapsed,
    desktopNavIds,
    setDesktopNavIds,
    mobileNavIds,
    setMobileNavIds,
    desktopRoutes,
    mobileRoutes,
    navEditorOpen,
    setNavEditorOpen,
    desktopSidebarMetricsPosition,
    setDesktopSidebarMetricsPosition
  } = useShellNavigationState(routeLocation.pathname);
  const isPsyche = isPsycheRoute(routeLocation.pathname);
  const knowledgeGraphSurface =
    routeLocation.pathname.startsWith("/knowledge-graph");
  const showGlobalCreateMenu = !routeLocation.pathname.startsWith("/artifacts");
  const immersiveMobileSurface = false;
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
  return (
    <div ref={shellRootRef} className="min-h-screen" style={shellRootStyle}>
      <Suspense fallback={null}>
        {actionBarOpen ? (
          <LazyActionBar
            open={actionBarOpen}
            onOpenChange={setActionBarOpen}
            snapshot={shell.snapshot}
            selectedUserIds={shell.selectedUserIds}
            createActions={createActions.actions}
          />
        ) : null}
      </Suspense>
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
            "flex min-h-screen flex-col border-r border-[var(--ui-border-subtle)] py-6 backdrop-blur-xl transition-[padding,width]",
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
                <div className="type-meta mt-2 text-[var(--ui-ink-faint)]">
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

          {desktopSidebarMetricsPosition === "above" ? (
            <SidebarMetricsPanel
              metrics={sidebarMetrics}
              collapsed={navCollapsed}
            />
          ) : null}

          <div className={cn("grid gap-2", navCollapsed ? "mt-6" : "mt-8")}>
            {desktopRoutes.map((route) => (
              <NavItem
                key={route.id}
                route={route}
                compact={navCollapsed}
                onRouteIntent={onRouteIntent}
              />
            ))}
          </div>

          {desktopSidebarMetricsPosition === "below" ? (
            <SidebarMetricsPanel
              metrics={sidebarMetrics}
              collapsed={navCollapsed}
            />
          ) : null}
        </aside>

        <div className="min-h-screen">
          <TaskTimerRailProvider>
            <header
              className="sticky top-0 z-30 border-b border-[var(--ui-border-subtle)] px-6 backdrop-blur-xl"
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
                    className="flex shrink-0 items-center gap-2 font-display text-[var(--ui-ink-strong)]"
                    style={{
                      fontSize: "var(--forge-shell-desktop-title-size)",
                      lineHeight: 1,
                      willChange: "font-size"
                    }}
                  >
                    <span>{getRouteLabel(active, t)}</span>
                    <InfoTooltip
                      className="font-sans"
                      label={`Explain ${getRouteLabel(active, t)}`}
                      title={activeHelp.title}
                      content={
                        <span className="grid gap-2">
                          <span>{activeHelp.purpose}</span>
                          <span>{activeHelp.primaryAction}</span>
                          {activeHelp.metricNote ? (
                            <span className="text-[var(--ui-ink-soft)]">
                              {activeHelp.metricNote}
                            </span>
                          ) : null}
                        </span>
                      }
                    />
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
                    className="min-w-0 px-3.5"
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
                className="flex items-center justify-between gap-4 overflow-hidden border-t border-[var(--ui-border-subtle)]"
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
                  <div className="max-w-[34rem] text-[12px] leading-5 text-[var(--ui-ink-soft)]">
                    {activeHelp.primaryAction}
                  </div>
                  {railLinks.map((link) => (
                    <Link
                      key={link.to}
                      to={link.to}
                      className="interactive-tap inline-flex min-h-10 min-w-0 max-w-full items-center justify-center rounded-full bg-[var(--ui-surface-1)] px-4 py-2 text-center text-[13px] leading-tight text-[var(--ui-ink-medium)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)] sm:whitespace-nowrap"
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
              className="sticky top-0 z-30 border-b border-[var(--ui-border-subtle)] px-4 backdrop-blur-xl"
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
                className="grid gap-2"
                style={{
                  transform:
                    "translateY(var(--forge-shell-mobile-primary-translate-y)) scale(var(--forge-shell-mobile-primary-scale))",
                  transformOrigin: "top center",
                  willChange: "transform"
                }}
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <div
                      className="min-w-0 truncate font-display text-[var(--ui-ink-strong)]"
                      style={{
                        fontSize: "var(--forge-shell-mobile-title-size)",
                        willChange: "font-size"
                      }}
                    >
                      {getRouteLabel(active, t)}
                    </div>
                    <InfoTooltip
                      className="shrink-0"
                      label={`Explain ${getRouteLabel(active, t)}`}
                      title={activeHelp.title}
                      content={
                        <span className="grid gap-2">
                          <span>{activeHelp.purpose}</span>
                          <span>{activeHelp.primaryAction}</span>
                          {activeHelp.metricNote ? (
                            <span className="text-[var(--ui-ink-soft)]">
                              {activeHelp.metricNote}
                            </span>
                          ) : null}
                        </span>
                      }
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="min-h-[2.125rem] px-2.5"
                      onClick={() => setActionBarOpen(true)}
                      aria-label={t("common.actionBar.title")}
                      title={t("common.actionBar.title")}
                    >
                      <Search className="size-4" />
                    </Button>
                    <div
                      className="inline-flex min-h-[2.125rem] max-w-[9.5rem] items-center gap-1.5 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-2.5 text-[12px] font-medium text-[var(--primary)]"
                      title={`Level ${shell.snapshot.metrics.level} · ${shell.snapshot.metrics.totalXp} XP · ${shell.snapshot.metrics.streakDays} day streak`}
                    >
                      <Zap className="size-3.5 shrink-0" />
                      <span className="min-w-0 truncate">
                        L{shell.snapshot.metrics.level} ·{" "}
                        {formatCompactNumber(shell.snapshot.metrics.totalXp)} XP
                        · {shell.snapshot.metrics.streakDays}d
                      </span>
                    </div>
                  </div>
                </div>
                <div className="min-w-0">
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
                <div className="mt-2 text-[13px] leading-5 text-[var(--ui-ink-soft)]">
                  {getRouteDetail(active, t)} {activeHelp.primaryAction}
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
          onRouteIntent={onRouteIntent}
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

      <ShellBackgroundActivityDialog
        open={backgroundActivityOpen}
        onOpenChange={setBackgroundActivityOpen}
        isLoading={ingestJobsQuery.isLoading}
        isError={ingestJobsQuery.isError}
        error={ingestJobsQuery.error}
        onRetry={() => void ingestJobsQuery.refetch()}
        recentIngestJobs={recentIngestJobs}
      />

      {showGlobalCreateMenu ? (
        <CreateMenu
          className="fixed z-40 lg:bottom-6 lg:right-6"
          actions={createActions.actions}
        />
      ) : null}
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
  const [taskCompletionPrompt, setTaskCompletionPrompt] =
    useState<TaskCompletionPromptState | null>(null);
  const [xpNotice, setXpNotice] = useState<{
    deltaXp: number;
    totalXp: number;
  } | null>(null);
  const [xpMetricsPollingEnabled, setXpMetricsPollingEnabled] = useState(false);
  const [optimisticRouteLocation, setOptimisticRouteLocation] =
    useState<RouterLocation | null>(null);
  const [locallySeenCelebrationIds, setLocallySeenCelebrationIds] = useState<
    Set<string>
  >(() => new Set());
  const routePathKey = buildRoutePathKey(routerLocation);
  const optimisticRoutePathKey = optimisticRouteLocation
    ? buildRoutePathKey(optimisticRouteLocation)
    : null;
  const handleRouteIntent = (to: string) => {
    const nextLocation = buildRouteIntentLocation(routerLocation, to);
    if (buildRoutePathKey(nextLocation) === routePathKey) {
      setOptimisticRouteLocation(null);
      return;
    }
    setOptimisticRouteLocation(nextLocation);
  };
  const operatorSessionQuery = useGetOperatorSessionQuery();
  const snapshotQuery = useGetSnapshotQuery(selectedUserIds, {
    skip: !operatorSessionQuery.isSuccess
  });
  const settingsQuery = useGetSettingsQuery(undefined, {
    skip: !operatorSessionQuery.isSuccess
  });
  const shellBootstrapReady =
    operatorSessionQuery.isSuccess &&
    snapshotQuery.isSuccess &&
    settingsQuery.isSuccess;
  const xpMetricsQuery = useGetXpMetricsQuery(selectedUserIds, {
    skip: !shellBootstrapReady || !xpMetricsPollingEnabled
  });
  const [markCelebrationSeen, celebrationSeenMutation] =
    useMarkGamificationCelebrationSeenMutation();
  const visibleCelebrations = useMemo(
    () =>
      (xpMetricsQuery.data?.metrics.celebrations ?? []).filter(
        (celebration) => !locallySeenCelebrationIds.has(celebration.id)
      ),
    [locallySeenCelebrationIds, xpMetricsQuery.data?.metrics.celebrations]
  );
  const routeReady = isShellRouteReady(routerLocation.pathname, {
    bootstrapReady: shellBootstrapReady,
    sleepReady: true
  });
  const destinationRouteViewId = resolveRouteViewIdFromPathname(
    optimisticRouteLocation?.pathname ?? routerLocation.pathname
  );
  const destinationLoadingNode = useMemo(
    () => (
      <RouteViewLoadingSurface
        key={optimisticRoutePathKey ?? routePathKey}
        meta={ROUTE_VIEW_CATALOG[destinationRouteViewId]}
      />
    ),
    [destinationRouteViewId, optimisticRoutePathKey, routePathKey]
  );
  const { displayedRoute, displayedLocationContext, visibleLocation } =
    useShellRouteHandoff({
      routePathKey,
      routerLocation,
      outlet,
      routerLocationContext,
      optimisticLocation: optimisticRouteLocation,
      optimisticRoutePathKey,
      externalFetching: tanstackFetching + pendingRtkRequests,
      routeReady,
      destinationLoadingNode
    });
  const setSelectedUserIds = (userIds: string[]) => {
    dispatch(setSelectedUserIdsAction(userIds));
  };

  useEffect(() => {
    if (
      optimisticRoutePathKey !== null &&
      optimisticRoutePathKey === routePathKey
    ) {
      setOptimisticRouteLocation(null);
    }
  }, [optimisticRoutePathKey, routePathKey]);

  useEffect(() => {
    setXpMetricsPollingEnabled(false);
    if (!shellBootstrapReady) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setXpMetricsPollingEnabled(true);
    }, 8_000);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [selectedUserIds, shellBootstrapReady]);

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
    previousXpRef.current = null;
    setXpNotice(null);
  }, [operatorSessionQuery.isSuccess, selectedUserIds]);

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

  const [createTaskMutation] = useCreateTaskMutation();
  const [createGoalMutation] = useCreateGoalMutation();
  const [createProjectMutation] = useCreateProjectMutation();
  const [patchGoalMutation] = usePatchGoalMutation();
  const [patchProjectMutation] = usePatchProjectMutation();
  const [patchTaskMutation] = usePatchTaskMutation();
  const [patchTaskStatusMutation] = usePatchTaskStatusMutation();
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
            onRouteIntent={handleRouteIntent}
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
            </div>
          </ShellFrame>
          <TaskCompletionWorkLogDialog
            prompt={taskCompletionPrompt}
            setPrompt={setTaskCompletionPrompt}
            onSubmit={(completedTodayWorkSeconds) => {
              void submitCompletionPrompt(completedTodayWorkSeconds);
            }}
          />
          {knowledgeGraphOverlayFocus?.focusNode ? (
            <div className="pointer-events-none fixed inset-y-0 right-0 z-[64] hidden lg:flex lg:max-w-[min(30rem,calc(100vw-4rem))] lg:items-start lg:justify-end lg:p-4">
              <div className="pointer-events-auto h-full w-[min(30rem,calc(100vw-4rem))] max-w-full overflow-hidden rounded-[28px] border border-[var(--ui-border-subtle)] bg-[color-mix(in_srgb,var(--surface-glass)_94%,transparent)] pt-[calc(var(--forge-shell-desktop-header-padding-top)+4.8rem)] shadow-[var(--ui-shadow-floating)] backdrop-blur-xl">
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
            celebrations={visibleCelebrations}
            onSeen={(celebrationId) => {
              if (
                celebrationSeenMutation.isLoading ||
                locallySeenCelebrationIds.has(celebrationId)
              ) {
                return;
              }
              setLocallySeenCelebrationIds((current) => {
                const next = new Set(current);
                next.add(celebrationId);
                return next;
              });
              void markCelebrationSeen(celebrationId)
                .unwrap()
                .catch(() => {
                  setLocallySeenCelebrationIds((current) => {
                    const next = new Set(current);
                    next.delete(celebrationId);
                    return next;
                  });
                });
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
