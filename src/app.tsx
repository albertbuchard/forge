import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "@/components/shell/app-shell";
import {
  createUiDiagnosticLogger,
  publishUiDiagnosticLog
} from "@/lib/diagnostics";
import { ActivityPage } from "@/pages/activity-page";
import { CalendarPage } from "@/pages/calendar-page";
import { GoalDetailPage } from "@/pages/goal-detail-page";
import { GoalsPage } from "@/pages/goals-page";
import { HabitsPage } from "@/pages/habits-page";
import { InsightsPage } from "@/pages/insights-page";
import { KanbanPage } from "@/pages/kanban-page";
import { NotesPage } from "@/pages/notes-page";
import { OverviewPage } from "@/pages/overview-page";
import { ProjectDetailPage } from "@/pages/project-detail-page";
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
import { PsycheSchemasBeliefsPage } from "@/pages/psyche-schemas-beliefs-page";
import { PsycheValuesPage } from "@/pages/psyche-values-page";
import { SettingsPage } from "@/pages/settings-page";
import { SettingsAgentsPage } from "@/pages/settings-agents-page";
import { SettingsBinPage } from "@/pages/settings-bin-page";
import { SettingsCalendarPage } from "@/pages/settings-calendar-page";
import { SettingsMobilePage } from "@/pages/settings-mobile-page";
import { SettingsModelsPage } from "@/pages/settings-models-page";
import { SettingsLogsPage } from "@/pages/settings-logs-page";
import { SettingsRewardsPage } from "@/pages/settings-rewards-page";
import { SettingsUsersPage } from "@/pages/settings-users-page";
import { SleepPage } from "@/pages/sleep-page";
import { SportsPage } from "@/pages/sports-page";
import { TaskDetailPage } from "@/pages/task-detail-page";
import { TodayPage } from "@/pages/today-page";
import { WikiPage } from "@/pages/wiki-page";
import { WikiIngestHistoryPage } from "@/pages/wiki-ingest-history-page";
import { WikiEditorPage } from "@/pages/wiki-editor-page";
import { WeeklyReviewPage } from "@/pages/weekly-review-page";
import { WorkbenchPage } from "@/pages/workbench-page";

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
  return (
    <>
      <DiagnosticsBootstrap />
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="goals" element={<GoalsPage />} />
          <Route path="habits" element={<HabitsPage />} />
          <Route path="goals/:goalId" element={<GoalDetailPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="strategies" element={<StrategiesPage />} />
          <Route
            path="strategies/:strategyId"
            element={<StrategyDetailPage />}
          />
          <Route path="preferences" element={<PreferencesPage />} />
          <Route
            path="campaigns"
            element={<Navigate to="/projects" replace />}
          />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="sleep" element={<SleepPage />} />
          <Route path="sports" element={<SportsPage />} />
          <Route path="psyche" element={<PsychePage />} />
          <Route path="psyche/values" element={<PsycheValuesPage />} />
          <Route path="psyche/patterns" element={<PsychePatternsPage />} />
          <Route
            path="psyche/questionnaires"
            element={<PsycheQuestionnairesPage />}
          />
          <Route
            path="psyche/questionnaires/new"
            element={<PsycheQuestionnaireBuilderPage />}
          />
          <Route
            path="psyche/questionnaires/:instrumentId"
            element={<PsycheQuestionnaireDetailPage />}
          />
          <Route
            path="psyche/questionnaires/:instrumentId/edit"
            element={<PsycheQuestionnaireBuilderPage />}
          />
          <Route
            path="psyche/questionnaires/:instrumentId/take"
            element={<PsycheQuestionnaireRunPage />}
          />
          <Route
            path="psyche/questionnaire-runs/:runId"
            element={<PsycheQuestionnaireRunDetailPage />}
          />
          <Route
            path="psyche/self-observation"
            element={<PsycheSelfObservationPage />}
          />
          <Route path="psyche/behaviors" element={<PsycheBehaviorsPage />} />
          <Route path="psyche/reports" element={<PsycheReportsPage />} />
          <Route
            path="psyche/reports/:reportId"
            element={<PsycheReportDetailPage />}
          />
          <Route path="psyche/goal-map" element={<PsycheGoalMapPage />} />
          <Route
            path="psyche/schemas-beliefs"
            element={<PsycheSchemasBeliefsPage />}
          />
          <Route path="psyche/modes" element={<PsycheModesPage />} />
          <Route path="psyche/modes/guide" element={<PsycheModeGuidePage />} />
          <Route path="kanban" element={<KanbanPage />} />
          <Route path="notes" element={<NotesPage />} />
          <Route path="wiki" element={<WikiPage />} />
          <Route
            path="wiki/ingest-history"
            element={<WikiIngestHistoryPage />}
          />
          <Route path="wiki/page/:slug" element={<WikiPage />} />
          <Route path="wiki/new" element={<WikiEditorPage />} />
          <Route path="wiki/edit/:pageId" element={<WikiEditorPage />} />
          <Route path="today" element={<TodayPage />} />
          <Route path="workbench" element={<WorkbenchPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="insights" element={<InsightsPage />} />
          <Route path="review/weekly" element={<WeeklyReviewPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/users" element={<SettingsUsersPage />} />
          <Route path="settings/calendar" element={<SettingsCalendarPage />} />
          <Route path="settings/mobile" element={<SettingsMobilePage />} />
          <Route path="settings/models" element={<SettingsModelsPage />} />
          <Route path="settings/agents" element={<SettingsAgentsPage />} />
          <Route path="settings/rewards" element={<SettingsRewardsPage />} />
          <Route path="settings/wiki" element={<SettingsWikiPage />} />
          <Route path="settings/logs" element={<SettingsLogsPage />} />
          <Route path="settings/bin" element={<SettingsBinPage />} />
          <Route path="tasks/:taskId" element={<TaskDetailPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </>
  );
}
