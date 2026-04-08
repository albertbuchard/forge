import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Provider } from "react-redux";
import { MemoryRouter, Outlet } from "react-router-dom";
import { App } from "./app";
import { createAppStore } from "@/store/store";

afterEach(() => {
  cleanup();
});

vi.mock("@/components/shell/app-shell", () => ({
  AppShell: () => (
    <div>
      <div>Forge shell</div>
      <Outlet />
    </div>
  )
}));

vi.mock("@/components/customization/surface-route-frame", () => ({
  SurfaceRouteFrame: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  )
}));

function renderApp(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });
  return render(
    <Provider store={createAppStore()}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>
  );
}

vi.mock("@/pages/overview-page", () => ({
  OverviewPage: () => <div>Overview route</div>
}));

vi.mock("@/pages/goals-page", () => ({
  GoalsPage: () => <div>Goals route</div>
}));

vi.mock("@/pages/habits-page", () => ({
  HabitsPage: () => <div>Habits route</div>
}));

vi.mock("@/pages/projects-page", () => ({
  ProjectsPage: () => <div>Projects route</div>
}));

vi.mock("@/pages/preferences-page", () => ({
  PreferencesPage: () => <div>Preferences route</div>
}));

vi.mock("@/pages/kanban-page", () => ({
  KanbanPage: () => <div>Kanban route</div>
}));

vi.mock("@/pages/today-page", () => ({
  TodayPage: () => <div>Today route</div>
}));

vi.mock("@/pages/activity-page", () => ({
  ActivityPage: () => <div>Activity route</div>
}));

vi.mock("@/pages/insights-page", () => ({
  InsightsPage: () => <div>Insights route</div>
}));

vi.mock("@/pages/weekly-review-page", () => ({
  WeeklyReviewPage: () => <div>Weekly review route</div>
}));

vi.mock("@/pages/psyche-page", () => ({
  PsychePage: () => <div>Psyche route</div>
}));

vi.mock("@/pages/psyche-values-page", () => ({
  PsycheValuesPage: () => <div>Psyche values route</div>
}));

vi.mock("@/pages/psyche-patterns-page", () => ({
  PsychePatternsPage: () => <div>Psyche patterns route</div>
}));

vi.mock("@/pages/psyche-questionnaires-page", () => ({
  PsycheQuestionnairesPage: () => <div>Psyche questionnaires route</div>
}));

vi.mock("@/pages/psyche-questionnaire-detail-page", () => ({
  PsycheQuestionnaireDetailPage: () => <div>Psyche questionnaire detail route</div>
}));

vi.mock("@/pages/psyche-questionnaire-run-page", () => ({
  PsycheQuestionnaireRunPage: () => <div>Psyche questionnaire run route</div>
}));

vi.mock("@/pages/psyche-questionnaire-run-detail-page", () => ({
  PsycheQuestionnaireRunDetailPage: () => <div>Psyche questionnaire run detail route</div>
}));

vi.mock("@/pages/psyche-questionnaire-builder-page", () => ({
  PsycheQuestionnaireBuilderPage: () => <div>Psyche questionnaire builder route</div>
}));

vi.mock("@/pages/psyche-self-observation-page", () => ({
  PsycheSelfObservationPage: () => <div>Psyche self observation route</div>
}));

vi.mock("@/pages/psyche-behaviors-page", () => ({
  PsycheBehaviorsPage: () => <div>Psyche behaviors route</div>
}));

vi.mock("@/pages/psyche-reports-page", () => ({
  PsycheReportsPage: () => <div>Psyche reports route</div>
}));

vi.mock("@/pages/psyche-report-detail-page", () => ({
  PsycheReportDetailPage: () => <div>Psyche report detail route</div>
}));

vi.mock("@/pages/psyche-goal-map-page", () => ({
  PsycheGoalMapPage: () => <div>Psyche goal map route</div>
}));

vi.mock("@/pages/psyche-schemas-beliefs-page", () => ({
  PsycheSchemasBeliefsPage: () => <div>Psyche schemas beliefs route</div>
}));

vi.mock("@/pages/psyche-modes-page", () => ({
  PsycheModesPage: () => <div>Psyche modes route</div>
}));

vi.mock("@/pages/psyche-mode-guide-page", () => ({
  PsycheModeGuidePage: () => <div>Psyche mode guide route</div>
}));

vi.mock("@/pages/settings-page", () => ({
  SettingsPage: () => <div>Settings route</div>
}));

vi.mock("@/pages/goal-detail-page", () => ({
  GoalDetailPage: () => <div>Goal detail route</div>
}));

vi.mock("@/pages/project-detail-page", () => ({
  ProjectDetailPage: () => <div>Project detail route</div>
}));

vi.mock("@/pages/task-detail-page", () => ({
  TaskDetailPage: () => <div>Task detail route</div>
}));

vi.mock("@/pages/wiki-page", () => ({
  WikiPage: () => <div>Wiki route</div>
}));

vi.mock("@/pages/wiki-editor-page", () => ({
  WikiEditorPage: () => <div>Wiki editor route</div>
}));

describe("App routing", () => {
  it("redirects the index route to overview", async () => {
    renderApp("/");

    expect(await screen.findByText("Forge shell")).toBeInTheDocument();
    expect(await screen.findByText("Overview route")).toBeInTheDocument();
  });

  it("renders the settings route inside the shell", async () => {
    renderApp("/settings");

    expect(await screen.findByText("Forge shell")).toBeInTheDocument();
    expect(await screen.findByText("Settings route")).toBeInTheDocument();
  });

  it("renders the preferences route inside the shell", async () => {
    renderApp("/preferences");

    expect(await screen.findByText("Forge shell")).toBeInTheDocument();
    expect(await screen.findByText("Preferences route")).toBeInTheDocument();
  });

  it("renders psyche hub and detail routes inside the shell", async () => {
    renderApp("/psyche");

    expect(await screen.findByText("Forge shell")).toBeInTheDocument();
    expect(await screen.findByText("Psyche route")).toBeInTheDocument();

    renderApp("/psyche/reports/report_1");

    expect(await screen.findByText("Psyche report detail route")).toBeInTheDocument();

    renderApp("/psyche/behaviors");
    expect(await screen.findByText("Psyche behaviors route")).toBeInTheDocument();

    renderApp("/psyche/questionnaires");
    expect(await screen.findByText("Psyche questionnaires route")).toBeInTheDocument();

    renderApp("/psyche/questionnaires/q_1");
    expect(await screen.findByText("Psyche questionnaire detail route")).toBeInTheDocument();

    renderApp("/psyche/questionnaires/q_1/take");
    expect(await screen.findByText("Psyche questionnaire run route")).toBeInTheDocument();

    renderApp("/psyche/questionnaire-runs/run_1");
    expect(await screen.findByText("Psyche questionnaire run detail route")).toBeInTheDocument();

    renderApp("/psyche/self-observation");
    expect(await screen.findByText("Psyche self observation route")).toBeInTheDocument();

    render(
      <MemoryRouter initialEntries={["/psyche/schemas-beliefs"]}>
        <App />
      </MemoryRouter>
    );
    expect(await screen.findByText("Psyche schemas beliefs route")).toBeInTheDocument();

    render(
      <MemoryRouter initialEntries={["/psyche/modes/guide"]}>
        <App />
      </MemoryRouter>
    );
    expect(await screen.findByText("Psyche mode guide route")).toBeInTheDocument();

    render(
      <MemoryRouter initialEntries={["/psyche/questionnaires/new"]}>
        <App />
      </MemoryRouter>
    );
    expect(await screen.findByText("Psyche questionnaire builder route")).toBeInTheDocument();
  });

  it("redirects legacy campaigns to projects", async () => {
    renderApp("/campaigns");

    expect(await screen.findByText("Forge shell")).toBeInTheDocument();
    expect(await screen.findByText("Projects route")).toBeInTheDocument();
  });

  it("renders the habits route inside the shell", async () => {
    renderApp("/habits");

    expect(await screen.findByText("Forge shell")).toBeInTheDocument();
    expect(await screen.findByText("Habits route")).toBeInTheDocument();
  });

  it("renders wiki reading and writing routes inside the shell", async () => {
    renderApp("/wiki");

    expect(await screen.findByText("Wiki route")).toBeInTheDocument();

    renderApp("/wiki/page/index");
    expect(await screen.findAllByText("Wiki route")).not.toHaveLength(0);

    renderApp("/wiki/new");
    expect(await screen.findByText("Wiki editor route")).toBeInTheDocument();
  });

  it("renders goal, project, and task detail routes inside the shell", async () => {
    renderApp("/goals/goal_1");

    expect(await screen.findByText("Goal detail route")).toBeInTheDocument();

    renderApp("/projects/project_1");
    expect(await screen.findByText("Project detail route")).toBeInTheDocument();

    renderApp("/tasks/task_1");
    expect(await screen.findByText("Task detail route")).toBeInTheDocument();
  });
});
