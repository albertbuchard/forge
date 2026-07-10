import { lazy } from "react";

export const ActivityPage = lazy(() =>
  import("@/pages/activity-page").then((module) => ({
    default: module.ActivityPage
  }))
);
export const AttentionInboxPage = lazy(() =>
  import("@/pages/attention-inbox-page").then((module) => ({
    default: module.AttentionInboxPage
  }))
);
export const ArtifactsPage = lazy(() =>
  import("@/pages/artifacts-page").then((module) => ({
    default: module.ArtifactsPage
  }))
);
export const CalendarPage = lazy(() =>
  import("@/pages/calendar-page").then((module) => ({
    default: module.CalendarPage
  }))
);
export const CompanionSyncLabPage = lazy(() =>
  import("@/pages/companion-sync-lab-page").then((module) => ({
    default: module.CompanionSyncLabPage
  }))
);
export const GoalDetailPage = lazy(() =>
  import("@/pages/goal-detail-page").then((module) => ({
    default: module.GoalDetailPage
  }))
);
export const GoalsPage = lazy(() =>
  import("@/pages/goals-page").then((module) => ({
    default: module.GoalsPage
  }))
);
export const HabitsPage = lazy(() =>
  import("@/pages/habits-page").then((module) => ({
    default: module.HabitsPage
  }))
);
export const InsightsPage = lazy(() =>
  import("@/pages/insights-page").then((module) => ({
    default: module.InsightsPage
  }))
);
export const KanbanPage = lazy(() =>
  import("@/pages/kanban-page").then((module) => ({
    default: module.KanbanPage
  }))
);
export const KnowledgeGraphPage = lazy(() =>
  import("@/pages/knowledge-graph-page").then((module) => ({
    default: module.KnowledgeGraphPage
  }))
);
export const LifeForcePage = lazy(() =>
  import("@/pages/life-force-page").then((module) => ({
    default: module.LifeForcePage
  }))
);
export const LifeEventsPage = lazy(() =>
  import("@/pages/life-events-page").then((module) => ({
    default: module.LifeEventsPage
  }))
);
export const MovementPage = lazy(() =>
  import("@/pages/movement-page").then((module) => ({
    default: module.MovementPage
  }))
);
export const NotesPage = lazy(() =>
  import("@/pages/notes-page").then((module) => ({
    default: module.NotesPage
  }))
);
export const OverviewPage = lazy(() =>
  import("@/pages/overview-page").then((module) => ({
    default: module.OverviewPage
  }))
);
export const ProjectDetailPage = lazy(() =>
  import("@/pages/project-detail-page").then((module) => ({
    default: module.ProjectDetailPage
  }))
);
export const ProjectManagementHierarchyPage = lazy(() =>
  import("@/pages/project-management-hierarchy-page").then((module) => ({
    default: module.ProjectManagementHierarchyPage
  }))
);
export const ProjectsPage = lazy(() =>
  import("@/pages/projects-page").then((module) => ({
    default: module.ProjectsPage
  }))
);
export const SettingsWikiPage = lazy(() =>
  import("@/pages/settings-wiki-page").then((module) => ({
    default: module.SettingsWikiPage
  }))
);
export const StrategiesPage = lazy(() =>
  import("@/pages/strategies-page").then((module) => ({
    default: module.StrategiesPage
  }))
);
export const StrategyDetailPage = lazy(() =>
  import("@/pages/strategy-detail-page").then((module) => ({
    default: module.StrategyDetailPage
  }))
);
export const PreferencesPage = lazy(() =>
  import("@/pages/preferences-page").then((module) => ({
    default: module.PreferencesPage
  }))
);
export const PsychePage = lazy(() =>
  import("@/pages/psyche-page").then((module) => ({
    default: module.PsychePage
  }))
);
export const PsycheBehaviorsPage = lazy(() =>
  import("@/pages/psyche-behaviors-page").then((module) => ({
    default: module.PsycheBehaviorsPage
  }))
);
export const PsycheFlashcardsPage = lazy(() =>
  import("@/pages/psyche-flashcards-page").then((module) => ({
    default: module.PsycheFlashcardsPage
  }))
);
export const PsycheGoalMapPage = lazy(() =>
  import("@/pages/psyche-goal-map-page").then((module) => ({
    default: module.PsycheGoalMapPage
  }))
);
export const PsycheMetricsPage = lazy(() =>
  import("@/pages/psyche-metrics-page").then((module) => ({
    default: module.PsycheMetricsPage
  }))
);
export const PsycheModeGuidePage = lazy(() =>
  import("@/pages/psyche-mode-guide-page").then((module) => ({
    default: module.PsycheModeGuidePage
  }))
);
export const PsycheModesPage = lazy(() =>
  import("@/pages/psyche-modes-page").then((module) => ({
    default: module.PsycheModesPage
  }))
);
export const PsychePatternsPage = lazy(() =>
  import("@/pages/psyche-patterns-page").then((module) => ({
    default: module.PsychePatternsPage
  }))
);
export const PsycheQuestionnaireBuilderPage = lazy(() =>
  import("@/pages/psyche-questionnaire-builder-page").then((module) => ({
    default: module.PsycheQuestionnaireBuilderPage
  }))
);
export const PsycheQuestionnaireDetailPage = lazy(() =>
  import("@/pages/psyche-questionnaire-detail-page").then((module) => ({
    default: module.PsycheQuestionnaireDetailPage
  }))
);
export const PsycheQuestionnaireRunDetailPage = lazy(() =>
  import("@/pages/psyche-questionnaire-run-detail-page").then((module) => ({
    default: module.PsycheQuestionnaireRunDetailPage
  }))
);
export const PsycheQuestionnaireRunPage = lazy(() =>
  import("@/pages/psyche-questionnaire-run-page").then((module) => ({
    default: module.PsycheQuestionnaireRunPage
  }))
);
export const PsycheQuestionnairesPage = lazy(() =>
  import("@/pages/psyche-questionnaires-page").then((module) => ({
    default: module.PsycheQuestionnairesPage
  }))
);
export const PsycheReportDetailPage = lazy(() =>
  import("@/pages/psyche-report-detail-page").then((module) => ({
    default: module.PsycheReportDetailPage
  }))
);
export const PsycheReportsPage = lazy(() =>
  import("@/pages/psyche-reports-page").then((module) => ({
    default: module.PsycheReportsPage
  }))
);
export const PsycheSelfObservationPage = lazy(() =>
  import("@/pages/psyche-self-observation-page").then((module) => ({
    default: module.PsycheSelfObservationPage
  }))
);
export const PsycheScreenTimePage = lazy(() =>
  import("@/pages/psyche-screen-time-page").then((module) => ({
    default: module.PsycheScreenTimePage
  }))
);
export const PsycheSchemasBeliefsPage = lazy(() =>
  import("@/pages/psyche-schemas-beliefs-page").then((module) => ({
    default: module.PsycheSchemasBeliefsPage
  }))
);
export const PsycheValuesPage = lazy(() =>
  import("@/pages/psyche-values-page").then((module) => ({
    default: module.PsycheValuesPage
  }))
);
export const SettingsPage = lazy(() =>
  import("@/pages/settings-page").then((module) => ({
    default: module.SettingsPage
  }))
);
export const SettingsDataPage = lazy(() =>
  import("@/pages/settings-data-page").then((module) => ({
    default: module.SettingsDataPage
  }))
);
export const SettingsAgentsPage = lazy(() =>
  import("@/pages/settings-agents-page").then((module) => ({
    default: module.SettingsAgentsPage
  }))
);
export const SettingsBinPage = lazy(() =>
  import("@/pages/settings-bin-page").then((module) => ({
    default: module.SettingsBinPage
  }))
);
export const SettingsCalendarPage = lazy(() =>
  import("@/pages/settings-calendar-page").then((module) => ({
    default: module.SettingsCalendarPage
  }))
);
export const SettingsMobilePage = lazy(() =>
  import("@/pages/settings-mobile-page").then((module) => ({
    default: module.SettingsMobilePage
  }))
);
export const SettingsModelsPage = lazy(() =>
  import("@/pages/settings-models-page").then((module) => ({
    default: module.SettingsModelsPage
  }))
);
export const SettingsLogsPage = lazy(() =>
  import("@/pages/settings-logs-page").then((module) => ({
    default: module.SettingsLogsPage
  }))
);
export const SettingsRewardsPage = lazy(() =>
  import("@/pages/settings-rewards-page").then((module) => ({
    default: module.SettingsRewardsPage
  }))
);
export const SettingsUsersPage = lazy(() =>
  import("@/pages/settings-users-page").then((module) => ({
    default: module.SettingsUsersPage
  }))
);
export const RewardsPage = lazy(() =>
  import("@/pages/rewards-page").then((module) => ({
    default: module.RewardsPage
  }))
);
export const SleepPage = lazy(() =>
  import("@/pages/sleep-page").then((module) => ({
    default: module.SleepPage
  }))
);
export const SportsPage = lazy(() =>
  import("@/pages/sports-page").then((module) => ({
    default: module.SportsPage
  }))
);
export const TrainingLoadPage = lazy(() =>
  import("@/pages/training-load-page").then((module) => ({
    default: module.TrainingLoadPage
  }))
);
export const WorkoutDetailPage = lazy(() =>
  import("@/pages/workout-detail-page").then((module) => ({
    default: module.WorkoutDetailPage
  }))
);
export const TaskDetailPage = lazy(() =>
  import("@/pages/task-detail-page").then((module) => ({
    default: module.TaskDetailPage
  }))
);
export const TodayPage = lazy(() =>
  import("@/pages/today-page").then((module) => ({
    default: module.TodayPage
  }))
);
export const VitalsPage = lazy(() =>
  import("@/pages/vitals-page").then((module) => ({
    default: module.VitalsPage
  }))
);
export const WeightLossPage = lazy(() =>
  import("@/pages/weight-loss-page").then((module) => ({
    default: module.WeightLossPage
  }))
);
export const WikiPage = lazy(() =>
  import("@/pages/wiki-page").then((module) => ({
    default: module.WikiPage
  }))
);
export const WikiIngestHistoryPage = lazy(() =>
  import("@/pages/wiki-ingest-history-page").then((module) => ({
    default: module.WikiIngestHistoryPage
  }))
);
export const WikiEditorPage = lazy(() =>
  import("@/pages/wiki-editor-page").then((module) => ({
    default: module.WikiEditorPage
  }))
);
export const WeeklyReviewPage = lazy(() =>
  import("@/pages/weekly-review-page").then((module) => ({
    default: module.WeeklyReviewPage
  }))
);
export const WorkbenchPage = lazy(() =>
  import("@/pages/workbench-page").then((module) => ({
    default: module.WorkbenchPage
  }))
);
export const WorkbenchFlowPage = lazy(() =>
  import("@/pages/workbench-flow-page").then((module) => ({
    default: module.WorkbenchFlowPage
  }))
);
