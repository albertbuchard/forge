import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Outlet } from "react-router-dom";
import { App } from "./app";

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
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText("Forge shell")).toBeInTheDocument();
    expect(await screen.findByText("Overview route")).toBeInTheDocument();
  });

  it("renders the settings route inside the shell", async () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText("Forge shell")).toBeInTheDocument();
    expect(await screen.findByText("Settings route")).toBeInTheDocument();
  });

  it("renders the preferences route inside the shell", async () => {
    render(
      <MemoryRouter initialEntries={["/preferences"]}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText("Forge shell")).toBeInTheDocument();
    expect(await screen.findByText("Preferences route")).toBeInTheDocument();
  });

  it("renders psyche hub and detail routes inside the shell", async () => {
    render(
      <MemoryRouter initialEntries={["/psyche"]}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText("Forge shell")).toBeInTheDocument();
    expect(await screen.findByText("Psyche route")).toBeInTheDocument();

    render(
      <MemoryRouter initialEntries={["/psyche/reports/report_1"]}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText("Psyche report detail route")).toBeInTheDocument();

    render(
      <MemoryRouter initialEntries={["/psyche/behaviors"]}>
        <App />
      </MemoryRouter>
    );
    expect(await screen.findByText("Psyche behaviors route")).toBeInTheDocument();

    render(
      <MemoryRouter initialEntries={["/psyche/self-observation"]}>
        <App />
      </MemoryRouter>
    );
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
  });

  it("redirects legacy campaigns to projects", async () => {
    render(
      <MemoryRouter initialEntries={["/campaigns"]}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText("Forge shell")).toBeInTheDocument();
    expect(await screen.findByText("Projects route")).toBeInTheDocument();
  });

  it("renders the habits route inside the shell", async () => {
    render(
      <MemoryRouter initialEntries={["/habits"]}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText("Forge shell")).toBeInTheDocument();
    expect(await screen.findByText("Habits route")).toBeInTheDocument();
  });

  it("renders wiki reading and writing routes inside the shell", async () => {
    render(
      <MemoryRouter initialEntries={["/wiki"]}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText("Wiki route")).toBeInTheDocument();

    render(
      <MemoryRouter initialEntries={["/wiki/page/index"]}>
        <App />
      </MemoryRouter>
    );
    expect(await screen.findAllByText("Wiki route")).not.toHaveLength(0);

    render(
      <MemoryRouter initialEntries={["/wiki/new"]}>
        <App />
      </MemoryRouter>
    );
    expect(await screen.findByText("Wiki editor route")).toBeInTheDocument();
  });

  it("renders goal, project, and task detail routes inside the shell", async () => {
    render(
      <MemoryRouter initialEntries={["/goals/goal_1", "/projects/project_1", "/tasks/task_1"]} initialIndex={0}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText("Goal detail route")).toBeInTheDocument();

    render(
      <MemoryRouter initialEntries={["/projects/project_1"]}>
        <App />
      </MemoryRouter>
    );
    expect(await screen.findByText("Project detail route")).toBeInTheDocument();

    render(
      <MemoryRouter initialEntries={["/tasks/task_1"]}>
        <App />
      </MemoryRouter>
    );
    expect(await screen.findByText("Task detail route")).toBeInTheDocument();
  });
});
