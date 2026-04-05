import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrategyDialog } from "@/components/strategy-dialog";
import { I18nProvider } from "@/lib/i18n";
import type {
  DashboardGoal,
  Habit,
  ProjectSummary,
  Strategy,
  Task,
  UserSummary
} from "@/lib/types";

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      get matches() {
        return matches;
      },
      media: "(max-width: 1023px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });

  return {
    setMatches(next: boolean) {
      matches = next;
    }
  };
}

const users: UserSummary[] = [
  {
    id: "user_human",
    kind: "human",
    handle: "clo",
    displayName: "Clo",
    description: "Human operator",
    accentColor: "#c0c1ff",
    createdAt: "2026-04-05T00:00:00.000Z",
    updatedAt: "2026-04-05T00:00:00.000Z"
  }
];

const goals: DashboardGoal[] = [
  {
    id: "goal_multi_user",
    title: "Land multi-user Forge",
    description: "A clear multi-user planning system.",
    status: "active",
    progress: 20,
    completedTasks: 1,
    totalTasks: 5,
    activeProjects: 1,
    earnedPoints: 120,
    horizon: "year",
    userId: "user_human",
    user: users[0]
  } as unknown as DashboardGoal
];

const projects: ProjectSummary[] = [
  {
    id: "project_core",
    goalId: "goal_multi_user",
    goalTitle: "Land multi-user Forge",
    title: "Core strategy project",
    description: "Main project used by the strategy.",
    status: "active",
    progress: 35,
    activeTaskCount: 2,
    completedTaskCount: 1,
    trackedMinutes: 90,
    userId: "user_human",
    user: users[0]
  } as unknown as ProjectSummary,
  {
    id: "project_unrelated",
    goalId: "goal_multi_user",
    goalTitle: "Land multi-user Forge",
    title: "Unrelated support project",
    description: "This should only appear after searching.",
    status: "active",
    progress: 10,
    activeTaskCount: 0,
    completedTaskCount: 0,
    trackedMinutes: 0,
    userId: "user_human",
    user: users[0]
  } as unknown as ProjectSummary
];

const tasks: Task[] = [
  {
    id: "task_alpha",
    title: "First task",
    description: "Strategy task.",
    owner: "Clo",
    status: "focus",
    priority: "medium",
    effort: "deep",
    energy: "steady",
    points: 60,
    goalId: "goal_multi_user",
    projectId: "project_core",
    trackedMinutes: 0,
    userId: "user_human",
    user: users[0]
  } as unknown as Task
];

function renderDialog() {
  return render(
    <I18nProvider locale="en">
      <StrategyDialog
        open
        editingStrategy={null}
        goals={goals}
        projects={projects}
        tasks={tasks}
        habits={[] as Habit[]}
        strategies={[] as Strategy[]}
        users={users}
        defaultUserId="user_human"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    </I18nProvider>
  );
}

describe("StrategyDialog", () => {
  beforeEach(() => {
    installMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("stays on the current step while the user types", async () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText("Strategy title"), {
      target: { value: "Land the multi-user planning system" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByRole("heading", {
        name: "Define the objective and the end targets"
      })
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Overview"), {
      target: { value: "This should not reset the dialog." }
    });

    expect(
      await screen.findByRole("heading", {
        name: "Define the objective and the end targets"
      })
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("This should not reset the dialog.")
    ).toBeInTheDocument();
  });

  it("keeps sequence results search-first instead of showing the full list immediately", async () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText("Strategy title"), {
      target: { value: "Land the multi-user planning system" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", {
      name: "Define the objective and the end targets"
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", {
      name: "Keep the right supporting entities in view"
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByRole("heading", {
        name: "Build the execution sequence"
      })
    ).toBeInTheDocument();
    expect(screen.getByText("Type to search.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create new task" })
    ).toBeInTheDocument();
    expect(
      screen.queryByText("This should only appear after searching.")
    ).not.toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText(
        "Search goals, projects, tasks, owners, humans, or bots"
      ),
      {
        target: { value: "Unrelated support" }
      }
    );

    expect(
      screen.getByText("This should only appear after searching.")
    ).toBeInTheDocument();
  });

  it("seeds the inline task form from the sequence search", async () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText("Strategy title"), {
      target: { value: "Land the multi-user planning system" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", {
      name: "Define the objective and the end targets"
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", {
      name: "Keep the right supporting entities in view"
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", {
      name: "Build the execution sequence"
    });

    fireEvent.change(
      screen.getByPlaceholderText(
        "Search goals, projects, tasks, owners, humans, or bots"
      ),
      {
        target: { value: "Draft the mobile-safe strategy footer" }
      }
    );
    fireEvent.click(screen.getByRole("button", { name: "Create new task" }));

    expect(screen.getByLabelText("Task title")).toHaveValue(
      "Draft the mobile-safe strategy footer"
    );
  });
});
