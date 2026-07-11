import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import type { Goal, UserSummary } from "@/lib/types";
import { ProjectDialog } from "./project-dialog";

const operator = {
  id: "user_operator",
  kind: "human",
  handle: "operator",
  displayName: "Operator",
  description: "",
  accentColor: "#6c8cff",
  createdAt: "2026-07-11T08:00:00.000Z",
  updatedAt: "2026-07-11T08:00:00.000Z"
} satisfies UserSummary;

const buildAgent = {
  ...operator,
  id: "user_build_agent",
  kind: "bot",
  handle: "build-agent",
  displayName: "Build Agent"
} satisfies UserSummary;

const goal = {
  id: "goal_1",
  title: "Make Forge dependable",
  description: "Keep the system useful under real load.",
  horizon: "year",
  status: "active",
  targetPoints: 400,
  themeColor: "#c8a46b",
  createdAt: "2026-07-11T08:00:00.000Z",
  updatedAt: "2026-07-11T08:00:00.000Z",
  tagIds: [],
  userId: operator.id,
  user: operator
} satisfies Goal;

function installMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: "(max-width: 1023px)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
}

describe("ProjectDialog", () => {
  beforeEach(() => {
    installMatchMedia();
    window.localStorage.clear();
  });
  afterEach(cleanup);

  it("explains the required goal anchor when no goals are available", () => {
    render(
      <I18nProvider locale="en">
        <ProjectDialog
          open
          goals={[]}
          editingProject={null}
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
        />
      </I18nProvider>
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Create an active goal before adding a project"
    );
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(
      screen.getByText("Choose a life goal before continuing.")
    ).toBeVisible();
  });

  it("uses explicit checkboxes for project assignees", async () => {
    render(
      <I18nProvider locale="en">
        <ProjectDialog
          open
          goals={[goal]}
          users={[operator, buildAgent]}
          initialGoalId={goal.id}
          editingProject={null}
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
        />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const agentCheckbox = await screen.findByRole("checkbox", {
      name: /Build Agent/i
    });
    fireEvent.click(agentCheckbox);

    expect(agentCheckbox).toBeChecked();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
