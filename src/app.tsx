import { useEffect, type ReactElement } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "@/components/shell/app-shell";
import { WorkbenchProvider } from "@/components/workbench/workbench-provider";
import { WorkbenchRouteSurface } from "@/components/workbench/workbench-route-surface";
import {
  createUiDiagnosticLogger,
  publishUiDiagnosticLog
} from "@/lib/diagnostics";
import { ActivityPage } from "@/pages/activity-page";
import { CalendarPage } from "@/pages/calendar-page";
import { CompanionSyncLabPage } from "@/pages/companion-sync-lab-page";
import { GoalDetailPage } from "@/pages/goal-detail-page";
import { GoalsPage } from "@/pages/goals-page";
import { HabitsPage } from "@/pages/habits-page";
import { InsightsPage } from "@/pages/insights-page";
import { KanbanPage } from "@/pages/kanban-page";
import { KnowledgeGraphPage } from "@/pages/knowledge-graph-page";
import { LifeForcePage } from "@/pages/life-force-page";
import { MovementPage } from "@/pages/movement-page";
import { NotesPage } from "@/pages/notes-page";
import { OverviewPage } from "@/pages/overview-page";
import { ProjectDetailPage } from "@/pages/project-detail-page";
import { ProjectManagementHierarchyPage } from "@/pages/project-management-hierarchy-page";
import { ProjectsPage } from "@/pages/projects-page";
import { SettingsWikiPage } from "@/pages/settings-wiki-page";
import { StrategiesPage } from "@/pages/strategies-page";
import { StrategyDetailPage } from "@/pages/strategy-detail-page";
import { PreferencesPage } from "@/pages/preferences-page";
import { PsychePage } from "@/pages/psyche-page";
import { PsycheBehaviorsPage } from "@/pages/psyche-behaviors-page";
import { PsycheGoalMapPage } from "@/pages/psyche-goal-map-page";
import { PsycheModeGuidePage } from "@/pages/psyche-mode-guide-page";
import { PsycheModesPage } from "@/pages/psyche-modes-page";
import { PsychePatternsPage } from "@/pages/psyche-patterns-page";
import { PsycheQuestionnaireBuilderPage } from "@/pages/psyche-questionnaire-builder-page";
import { PsycheQuestionnaireDetailPage } from "@/pages/psyche-questionnaire-detail-page";
import { PsycheQuestionnaireRunDetailPage } from "@/pages/psyche-questionnaire-run-detail-page";
import { PsycheQuestionnaireRunPage } from "@/pages/psyche-questionnaire-run-page";
import { PsycheQuestionnairesPage } from "@/pages/psyche-questionnaires-page";
import { PsycheReportDetailPage } from "@/pages/psyche-report-detail-page";
import { PsycheReportsPage } from "@/pages/psyche-reports-page";
import { PsycheSelfObservationPage } from "@/pages/psyche-self-observation-page";
import { PsycheScreenTimePage } from "@/pages/psyche-screen-time-page";
import { PsycheSchemasBeliefsPage } from "@/pages/psyche-schemas-beliefs-page";
import { PsycheValuesPage } from "@/pages/psyche-values-page";
import { SettingsPage } from "@/pages/settings-page";
import { SettingsDataPage } from "@/pages/settings-data-page";
import { SettingsAgentsPage } from "@/pages/settings-agents-page";
import { SettingsBinPage } from "@/pages/settings-bin-page";
import { SettingsCalendarPage } from "@/pages/settings-calendar-page";
import { SettingsMobilePage } from "@/pages/settings-mobile-page";
import { SettingsModelsPage } from "@/pages/settings-models-page";
import { SettingsLogsPage } from "@/pages/settings-logs-page";
import { SettingsRewardsPage } from "@/pages/settings-rewards-page";
import { SettingsUsersPage } from "@/pages/settings-users-page";
import { RewardsPage } from "@/pages/rewards-page";
import { SleepPage } from "@/pages/sleep-page";
import { SportsPage } from "@/pages/sports-page";
import { TaskDetailPage } from "@/pages/task-detail-page";
import { TodayPage } from "@/pages/today-page";
import { VitalsPage } from "@/pages/vitals-page";
import { WikiPage } from "@/pages/wiki-page";
import { WikiIngestHistoryPage } from "@/pages/wiki-ingest-history-page";
import { WikiEditorPage } from "@/pages/wiki-editor-page";
import { WeeklyReviewPage } from "@/pages/weekly-review-page";
import { WorkbenchPage } from "@/pages/workbench-page";
import { WorkbenchFlowPage } from "@/pages/workbench-flow-page";

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
    _surfaceId: string,
    _title: string,
    _description: string,
    element: ReactElement
  ) {
    return (
      <WorkbenchRouteSurface surfaceId={_surfaceId}>
        {element}
      </WorkbenchRouteSurface>
    );
  }

  return (
    <WorkbenchProvider>
      <DiagnosticsBootstrap />
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="overview" element={<OverviewPage />} />
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
          <Route path="projects" element={<ProjectsPage />} />
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
            path="vitals"
            element={surface(
              "vitals-index",
              "Vitals",
              "Body signals, recovery, cardio fitness, and daily HealthKit metrics.",
              <VitalsPage />
            )}
          />
          <Route path="psyche" element={<PsychePage />} />
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
          <Route path="today" element={<TodayPage />} />
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
    </WorkbenchProvider>
  );
}
