import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/shell/app-shell";
import { ActivityPage } from "@/pages/activity-page";
import { CampaignsPage } from "@/pages/campaigns-page";
import { GoalDetailPage } from "@/pages/goal-detail-page";
import { GoalsPage } from "@/pages/goals-page";
import { InsightsPage } from "@/pages/insights-page";
import { KanbanPage } from "@/pages/kanban-page";
import { OverviewPage } from "@/pages/overview-page";
import { ProjectDetailPage } from "@/pages/project-detail-page";
import { ProjectsPage } from "@/pages/projects-page";
import { PsychePage } from "@/pages/psyche-page";
import { PsycheBehaviorsPage } from "@/pages/psyche-behaviors-page";
import { PsycheGoalMapPage } from "@/pages/psyche-goal-map-page";
import { PsycheModeGuidePage } from "@/pages/psyche-mode-guide-page";
import { PsycheModesPage } from "@/pages/psyche-modes-page";
import { PsychePatternsPage } from "@/pages/psyche-patterns-page";
import { PsycheReportDetailPage } from "@/pages/psyche-report-detail-page";
import { PsycheReportsPage } from "@/pages/psyche-reports-page";
import { PsycheSchemasBeliefsPage } from "@/pages/psyche-schemas-beliefs-page";
import { PsycheValuesPage } from "@/pages/psyche-values-page";
import { SettingsPage } from "@/pages/settings-page";
import { SettingsAgentsPage } from "@/pages/settings-agents-page";
import { SettingsBinPage } from "@/pages/settings-bin-page";
import { SettingsRewardsPage } from "@/pages/settings-rewards-page";
import { TaskDetailPage } from "@/pages/task-detail-page";
import { TodayPage } from "@/pages/today-page";
import { WeeklyReviewPage } from "@/pages/weekly-review-page";

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/overview" replace />} />
        <Route path="overview" element={<OverviewPage />} />
        <Route path="goals" element={<GoalsPage />} />
        <Route path="goals/:goalId" element={<GoalDetailPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:projectId" element={<ProjectDetailPage />} />
        <Route path="campaigns" element={<CampaignsPage />} />
        <Route path="psyche" element={<PsychePage />} />
        <Route path="psyche/values" element={<PsycheValuesPage />} />
        <Route path="psyche/patterns" element={<PsychePatternsPage />} />
        <Route path="psyche/behaviors" element={<PsycheBehaviorsPage />} />
        <Route path="psyche/reports" element={<PsycheReportsPage />} />
        <Route path="psyche/reports/:reportId" element={<PsycheReportDetailPage />} />
        <Route path="psyche/goal-map" element={<PsycheGoalMapPage />} />
        <Route path="psyche/schemas-beliefs" element={<PsycheSchemasBeliefsPage />} />
        <Route path="psyche/modes" element={<PsycheModesPage />} />
        <Route path="psyche/modes/guide" element={<PsycheModeGuidePage />} />
        <Route path="kanban" element={<KanbanPage />} />
        <Route path="today" element={<TodayPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="insights" element={<InsightsPage />} />
        <Route path="review/weekly" element={<WeeklyReviewPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="settings/agents" element={<SettingsAgentsPage />} />
        <Route path="settings/rewards" element={<SettingsRewardsPage />} />
        <Route path="settings/bin" element={<SettingsBinPage />} />
        <Route path="tasks/:taskId" element={<TaskDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
}
