import { useEffect, type ReactElement } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "@/components/shell/app-shell";
import {
  createUiDiagnosticLogger,
  publishUiDiagnosticLog
} from "@/lib/diagnostics";
import {
  ActivityPage,
  ArtifactsPage,
  CalendarPage,
  CompanionSyncLabPage,
  GoalDetailPage,
  GoalsPage,
  HabitsPage,
  InsightsPage,
  KanbanPage,
  KnowledgeGraphPage,
  LifeForcePage,
  MovementPage,
  NotesPage,
  OverviewPage,
  PreferencesPage,
  ProjectDetailPage,
  ProjectManagementHierarchyPage,
  ProjectsPage,
  PsycheBehaviorsPage,
  PsycheFlashcardsPage,
  PsycheGoalMapPage,
  PsycheMetricsPage,
  PsycheModeGuidePage,
  PsycheModesPage,
  PsychePage,
  PsychePatternsPage,
  PsycheQuestionnaireBuilderPage,
  PsycheQuestionnaireDetailPage,
  PsycheQuestionnaireRunDetailPage,
  PsycheQuestionnaireRunPage,
  PsycheQuestionnairesPage,
  PsycheReportDetailPage,
  PsycheReportsPage,
  PsycheSchemasBeliefsPage,
  PsycheScreenTimePage,
  PsycheSelfObservationPage,
  PsycheValuesPage,
  RewardsPage,
  SettingsAgentsPage,
  SettingsBinPage,
  SettingsCalendarPage,
  SettingsDataPage,
  SettingsLogsPage,
  SettingsMobilePage,
  SettingsModelsPage,
  SettingsPage,
  SettingsRewardsPage,
  SettingsUsersPage,
  SettingsWikiPage,
  SleepPage,
  SportsPage,
  StrategiesPage,
  StrategyDetailPage,
  TaskDetailPage,
  TodayPage,
  TrainingLoadPage,
  VitalsPage,
  WeightLossPage,
  WeeklyReviewPage,
  WikiEditorPage,
  WikiIngestHistoryPage,
  WikiPage,
  WorkbenchFlowPage,
  WorkbenchPage,
  WorkoutDetailPage
} from "@/routes/lazy-pages";
import { RouteView } from "@/routes/route-view";
import type { RouteViewId } from "@/routes/route-view-catalog";

function DiagnosticsBootstrap() {
  const location = useLocation();

  useEffect(() => {
    const route = `${location.pathname}${location.search}${location.hash}`;
    const logRuntimeError = createUiDiagnosticLogger({
      scope: "frontend_runtime",
      route
    });
    const handleError = (event: ErrorEvent) => {
      void logRuntimeError({
        level: "error",
        eventKey: "window_error",
        message: event.message || "Unhandled browser error",
        functionName: "window.onerror",
        details: {
          fileName: event.filename || null,
          line: event.lineno || null,
          column: event.colno || null,
          error: event.error ?? null
        }
      });
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      void logRuntimeError({
        level: "error",
        eventKey: "unhandled_rejection",
        message: "Unhandled promise rejection",
        functionName: "window.onunhandledrejection",
        details: {
          reason: event.reason ?? null
        }
      });
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener(
        "unhandledrejection",
        handleUnhandledRejection
      );
    };
  }, [location.hash, location.pathname, location.search]);

  useEffect(() => {
    const route = `${location.pathname}${location.search}${location.hash}`;
    void publishUiDiagnosticLog({
      level: "info",
      scope: "frontend_navigation",
      eventKey: "route_view",
      message: `Viewed route ${location.pathname}`,
      route,
      functionName: "DiagnosticsBootstrap.routeView",
      details: {
        pathname: location.pathname,
        search: location.search || null,
        hash: location.hash || null
      }
    });
  }, [location.hash, location.pathname, location.search]);

  return null;
}

export function App() {
  function surface(
    surfaceId: RouteViewId,
    _title: string,
    _description: string,
    element: ReactElement
  ) {
    return <RouteView viewId={surfaceId}>{element}</RouteView>;
  }

  return (
    <>
      <DiagnosticsBootstrap />
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/overview" replace />} />
          <Route
            path="overview"
            element={surface(
              "overview",
              "Overview",
              "Daily signal, momentum, and current Forge state.",
              <OverviewPage />
            )}
          />
          <Route
            path="life-force"
            element={surface(
              "life-force-index",
              "Life Force",
              "Action Point capacity, weekday curves, and dynamic drains.",
              <LifeForcePage />
            )}
          />
          <Route
            path="goals"
            element={surface(
              "goals-index",
              "Goals",
              "Goal planning and long-horizon direction.",
              <GoalsPage />
            )}
          />
          <Route
            path="habits"
            element={surface(
              "habits-index",
              "Habits",
              "Recurring commitments, streaks, and check-ins.",
              <HabitsPage />
            )}
          />
          <Route
            path="goals/:goalId"
            element={surface(
              "goal-detail",
              "Goal detail",
              "Goal detail, progress, and linked execution context.",
              <GoalDetailPage />
            )}
          />
          <Route
            path="projects"
            element={surface(
              "projects-index",
              "Projects",
              "PRD-backed projects and execution initiatives.",
              <ProjectsPage />
            )}
          />
          <Route
            path="projects/hierarchy"
            element={surface(
              "project-hierarchy",
              "Project hierarchy",
              "Full hierarchy from goals down to subtasks.",
              <ProjectManagementHierarchyPage />
            )}
          />
          <Route
            path="projects/:projectId"
            element={surface(
              "project-detail",
              "Project detail",
              "Project detail, tasks, and execution health.",
              <ProjectDetailPage />
            )}
          />
          <Route
            path="strategies"
            element={surface(
              "strategies-index",
              "Strategies",
              "Strategy graphs and long-range execution plans.",
              <StrategiesPage />
            )}
          />
          <Route
            path="strategies/:strategyId"
            element={surface(
              "strategy-detail",
              "Strategy detail",
              "Strategy DAG detail, targets, and progress.",
              <StrategyDetailPage />
            )}
          />
          <Route
            path="preferences"
            element={surface(
              "preferences-index",
              "Preferences",
              "Preference profiles, pairwise judgments, and model state.",
              <PreferencesPage />
            )}
          />
          <Route
            path="campaigns"
            element={<Navigate to="/projects" replace />}
          />
          <Route
            path="calendar"
            element={surface(
              "calendar-index",
              "Calendar",
              "Calendar planning, timeboxes, and provider sync.",
              <CalendarPage />
            )}
          />
          <Route
            path="knowledge-graph"
            element={surface(
              "knowledge-graph-index",
              "Knowledge Graph",
              "One connected map of Forge entities and explicit relationships.",
              <KnowledgeGraphPage />
            )}
          />
          <Route
            path="artifacts"
            element={surface(
              "artifacts-index",
              "Artifacts",
              "Trusted file artifact store, safety scans, metadata, and links.",
              <ArtifactsPage />
            )}
          />
          <Route
            path="artifacts/:artifactId"
            element={surface(
              "artifacts-index",
              "Artifacts",
              "Trusted file artifact store, safety scans, metadata, and links.",
              <ArtifactsPage />
            )}
          />
          <Route
            path="movement"
            element={surface(
              "movement-index",
              "Movement",
              "Movement traces, places, and trip evidence.",
              <MovementPage />
            )}
          />
          <Route
            path="sleep"
            element={surface(
              "sleep-index",
              "Sleep",
              "Sleep sessions, health context, and recovery trends.",
              <SleepPage />
            )}
          />
          <Route
            path="sports"
            element={surface(
              "sports-index",
              "Sports",
              "Fitness, workouts, and sports context.",
              <SportsPage />
            )}
          />
          <Route
            path="sports/workouts/:workoutId"
            element={surface(
              "sports-workout-detail",
              "Workout Detail",
              "Raw workout evidence, heart-rate zones, and session context.",
              <WorkoutDetailPage />
            )}
          />
          <Route
            path="training-load"
            element={surface(
              "training-load-index",
              "Training Load",
              "Cardiovascular load, intensity distribution, and training targets.",
              <TrainingLoadPage />
            )}
          />
          <Route
            path="vitals"
            element={surface(
              "vitals-index",
              "Vitals",
              "Body signals, recovery, cardio fitness, and daily HealthKit metrics.",
              <VitalsPage />
            )}
          />
          <Route
            path="weight-loss"
            element={surface(
              "weight-loss-index",
              "Weight Loss",
              "Nutrition, body composition, food effects, gut signals, and aesthetic experiments.",
              <WeightLossPage />
            )}
          />
          <Route
            path="psyche"
            element={surface(
              "psyche-index",
              "Psyche",
              "Values, modes, reports, and reflective context.",
              <PsychePage />
            )}
          />
          <Route
            path="psyche/metrics"
            element={surface(
              "psyche-metrics",
              "Psyche metrics",
              "Daily Psyche metric history with plots and summary statistics.",
              <PsycheMetricsPage />
            )}
          />
          <Route
            path="psyche/flashcards"
            element={surface(
              "psyche-flashcards",
              "Psyche flashcards",
              "Therapeutic reminder cards for urges, triggers, and values-based pivots.",
              <PsycheFlashcardsPage />
            )}
          />
          <Route
            path="psyche/values"
            element={surface(
              "psyche-values",
              "Psyche values",
              "Values and linked goal context.",
              <PsycheValuesPage />
            )}
          />
          <Route
            path="psyche/patterns"
            element={surface(
              "psyche-patterns",
              "Psyche patterns",
              "Behavior patterns and recurring loops.",
              <PsychePatternsPage />
            )}
          />
          <Route
            path="psyche/questionnaires"
            element={surface(
              "psyche-questionnaires",
              "Questionnaires",
              "Questionnaire library and recent runs.",
              <PsycheQuestionnairesPage />
            )}
          />
          <Route
            path="psyche/questionnaires/new"
            element={surface(
              "psyche-questionnaire-new",
              "New questionnaire",
              "Questionnaire builder workspace.",
              <PsycheQuestionnaireBuilderPage />
            )}
          />
          <Route
            path="psyche/questionnaires/:instrumentId"
            element={surface(
              "psyche-questionnaire-detail",
              "Questionnaire detail",
              "Questionnaire detail and scores.",
              <PsycheQuestionnaireDetailPage />
            )}
          />
          <Route
            path="psyche/questionnaires/:instrumentId/edit"
            element={surface(
              "psyche-questionnaire-edit",
              "Edit questionnaire",
              "Questionnaire builder workspace.",
              <PsycheQuestionnaireBuilderPage />
            )}
          />
          <Route
            path="psyche/questionnaires/:instrumentId/take"
            element={surface(
              "psyche-questionnaire-run",
              "Take questionnaire",
              "Questionnaire runner and answers.",
              <PsycheQuestionnaireRunPage />
            )}
          />
          <Route
            path="psyche/questionnaire-runs/:runId"
            element={surface(
              "psyche-questionnaire-run-detail",
              "Questionnaire run detail",
              "Questionnaire result review.",
              <PsycheQuestionnaireRunDetailPage />
            )}
          />
          <Route
            path="psyche/self-observation"
            element={surface(
              "psyche-self-observation",
              "Self observation",
              "Self-observation notes and reflective tracking.",
              <PsycheSelfObservationPage />
            )}
          />
          <Route
            path="psyche/screen-time"
            element={surface(
              "psyche-screen-time",
              "Screen Time",
              "Apple-compliant device-activity patterns and reflective usage history.",
              <PsycheScreenTimePage />
            )}
          />
          <Route
            path="psyche/behaviors"
            element={surface(
              "psyche-behaviors",
              "Behaviors",
              "Behavior records and linked evidence.",
              <PsycheBehaviorsPage />
            )}
          />
          <Route
            path="psyche/reports"
            element={surface(
              "psyche-reports",
              "Reports",
              "Trigger and reflective report review.",
              <PsycheReportsPage />
            )}
          />
          <Route
            path="psyche/reports/:reportId"
            element={surface(
              "psyche-report-detail",
              "Report detail",
              "Detailed reflective report view.",
              <PsycheReportDetailPage />
            )}
          />
          <Route
            path="psyche/goal-map"
            element={surface(
              "psyche-goal-map",
              "Goal map",
              "Goal-to-values relationship map.",
              <PsycheGoalMapPage />
            )}
          />
          <Route
            path="psyche/schemas-beliefs"
            element={surface(
              "psyche-schemas-beliefs",
              "Schemas and beliefs",
              "Beliefs, schemas, and linked patterns.",
              <PsycheSchemasBeliefsPage />
            )}
          />
          <Route
            path="psyche/modes"
            element={surface(
              "psyche-modes",
              "Modes",
              "Mode profiles and guides.",
              <PsycheModesPage />
            )}
          />
          <Route
            path="psyche/modes/guide"
            element={surface(
              "psyche-mode-guide",
              "Mode guide",
              "Guided mode session flow.",
              <PsycheModeGuidePage />
            )}
          />
          <Route
            path="kanban"
            element={surface(
              "kanban-index",
              "Kanban",
              "Task board execution surface.",
              <KanbanPage />
            )}
          />
          <Route
            path="notes"
            element={surface(
              "notes-index",
              "Notes",
              "Notes, evidence, and writing surfaces.",
              <NotesPage />
            )}
          />
          <Route
            path="wiki"
            element={surface(
              "wiki-index",
              "KarpaWiki",
              "KarpaWiki search and page navigation.",
              <WikiPage />
            )}
          />
          <Route
            path="wiki/ingest-history"
            element={surface(
              "wiki-ingest-history",
              "KarpaWiki ingest history",
              "Ingest jobs and processing history.",
              <WikiIngestHistoryPage />
            )}
          />
          <Route
            path="wiki/page/:slug"
            element={surface(
              "wiki-page-detail",
              "KarpaWiki page",
              "KarpaWiki page detail and backlinks.",
              <WikiPage />
            )}
          />
          <Route
            path="wiki/new"
            element={surface(
              "wiki-new",
              "New KarpaWiki page",
              "KarpaWiki editor for new pages.",
              <WikiEditorPage />
            )}
          />
          <Route
            path="wiki/edit/:pageId"
            element={surface(
              "wiki-edit",
              "Edit KarpaWiki page",
              "KarpaWiki editor for existing pages.",
              <WikiEditorPage />
            )}
          />
          <Route
            path="today"
            element={surface(
              "today-index",
              "Today",
              "Current work, time, and daily runway.",
              <TodayPage />
            )}
          />
          <Route
            path="workbench"
            element={surface(
              "workbench",
              "Workbench",
              "Search, organize, and launch Forge flows.",
              <WorkbenchPage />
            )}
          />
          <Route
            path="workbench/:flowId"
            element={surface(
              "workbench-flow",
              "Workbench flow",
              "Graph editor and runtime surface for a single flow.",
              <WorkbenchFlowPage />
            )}
          />
          <Route
            path="activity"
            element={surface(
              "activity-index",
              "Activity",
              "Activity log and event history.",
              <ActivityPage />
            )}
          />
          <Route
            path="insights"
            element={surface(
              "insights-index",
              "Insights",
              "Insight review and decisions.",
              <InsightsPage />
            )}
          />
          <Route
            path="review/weekly"
            element={surface(
              "weekly-review",
              "Weekly review",
              "Weekly review workflow and closeout.",
              <WeeklyReviewPage />
            )}
          />
          <Route
            path="settings"
            element={surface(
              "settings-index",
              "Settings",
              "Operator settings and runtime configuration.",
              <SettingsPage />
            )}
          />
          <Route
            path="settings/data"
            element={surface(
              "settings-data",
              "Settings data",
              "Runtime storage, backups, exports, and recovery.",
              <SettingsDataPage />
            )}
          />
          <Route
            path="settings/users"
            element={surface(
              "settings-users",
              "Settings users",
              "User directory and ownership settings.",
              <SettingsUsersPage />
            )}
          />
          <Route
            path="settings/calendar"
            element={surface(
              "settings-calendar",
              "Settings calendar",
              "Calendar provider settings and sync.",
              <SettingsCalendarPage />
            )}
          />
          <Route
            path="settings/mobile"
            element={surface(
              "settings-mobile",
              "Settings mobile",
              "Mobile companion settings and pairing.",
              <SettingsMobilePage />
            )}
          />
          {import.meta.env.DEV ? (
            <Route
              path="settings/mobile/lab"
              element={surface(
                "settings-mobile-lab",
                "Companion sync lab",
                "Dev-only fixtures for source-state and movement gap QA.",
                <CompanionSyncLabPage />
              )}
            />
          ) : null}
          <Route
            path="settings/models"
            element={surface(
              "settings-models",
              "Settings models",
              "Model connections and defaults.",
              <SettingsModelsPage />
            )}
          />
          <Route
            path="settings/agents"
            element={surface(
              "settings-agents",
              "Settings agents",
              "Agent tokens and runtime access.",
              <SettingsAgentsPage />
            )}
          />
          <Route
            path="settings/rewards"
            element={surface(
              "settings-rewards",
              "Settings rewards",
              "Rewards and XP rule settings.",
              <SettingsRewardsPage />
            )}
          />
          <Route
            path="rewards"
            element={surface(
              "rewards",
              "Trophy Hall",
              "Trophies, unlocks, streak pressure, and Forge Smith progression.",
              <RewardsPage />
            )}
          />
          <Route
            path="settings/wiki"
            element={surface(
              "settings-wiki",
              "KarpaWiki settings",
              "KarpaWiki ingestion and profile settings.",
              <SettingsWikiPage />
            )}
          />
          <Route
            path="settings/logs"
            element={surface(
              "settings-logs",
              "Settings logs",
              "Diagnostics and event logs.",
              <SettingsLogsPage />
            )}
          />
          <Route
            path="settings/bin"
            element={surface(
              "settings-bin",
              "Settings bin",
              "Deleted entity recovery.",
              <SettingsBinPage />
            )}
          />
          <Route
            path="tasks/:taskId"
            element={surface(
              "task-detail",
              "Task detail",
              "Task detail, timer, and notes.",
              <TaskDetailPage />
            )}
          />
        </Route>
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </>
  );
}
