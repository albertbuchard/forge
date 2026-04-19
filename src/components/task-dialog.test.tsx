import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import { TaskDialog } from "./task-dialog";
import type { Goal, ProjectSummary, Tag, Task, UserSummary } from "@/lib/types";

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

describe("TaskDialog", () => {
  beforeEach(() => {
    installMatchMedia();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("defaults new tasks to one day and standard AP, then preserves edited values on submit", async () => {
    const onSubmit = vi.fn(async () => {});
    const goal = {
      id: "goal_1",
      title: "Ship Forge",
      description: "",
      status: "active",
      horizon: "lifetime",
      targetPoints: 120,
      themeColor: "#c0c1ff",
      createdAt: "2026-04-11T08:00:00.000Z",
      updatedAt: "2026-04-11T08:00:00.000Z",
      tagIds: [],
      owner: "Albert",
      userId: "user_operator",
      user: {
        id: "user_operator",
        kind: "human",
        handle: "albert",
        displayName: "Albert",
        description: "",
        accentColor: "#c0c1ff",
        createdAt: "2026-04-11T08:00:00.000Z",
        updatedAt: "2026-04-11T08:00:00.000Z"
      }
    } as unknown as Goal;
    const project = {
      id: "project_1",
      goalId: goal.id,
      goalTitle: goal.title,
      title: "Forge Runtime",
      description: "Core implementation work",
      status: "active",
      targetPoints: 120,
      themeColor: "#c0c1ff",
      schedulingRules: {
        allowWorkBlockKinds: [],
        blockWorkBlockKinds: [],
        allowCalendarIds: [],
        blockCalendarIds: [],
        allowEventTypes: [],
        blockEventTypes: [],
        allowEventKeywords: [],
        blockEventKeywords: [],
        allowAvailability: [],
        blockAvailability: []
      },
      createdAt: "2026-04-11T08:00:00.000Z",
      updatedAt: "2026-04-11T08:00:00.000Z",
      userId: "user_operator",
      user: goal.user,
      owner: "Albert"
    } as unknown as ProjectSummary;
    const tag = {
      id: "tag_1",
      name: "Deep work",
      color: "#7dd3fc",
      kind: "execution",
      description: ""
    } as unknown as Tag;
    const user: UserSummary = goal.user!;

    render(
      <I18nProvider locale="en">
        <TaskDialog
          open
          goals={[goal]}
          projects={[project]}
          tags={[tag]}
          users={[user]}
          editingTask={null}
          defaultUserId="user_operator"
          onOpenChange={vi.fn()}
          onSubmit={onSubmit}
        />
      </I18nProvider>
    );

    const anchorInput = screen.getByPlaceholderText(
      'Search or create Goal, Project, or parent Issue like Goal + "Creative system"'
    );
    fireEvent.focus(anchorInput);
    fireEvent.change(anchorInput, {
      target: { value: "Forge Runtime" }
    });
    fireEvent.click(await screen.findByText("Forge Runtime"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    fireEvent.change(
      await screen.findByPlaceholderText("Draft the first mode atlas sketch"),
      {
        target: { value: "Tune Life Force completion flow" }
      }
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const durationInput = await screen.findByDisplayValue("1440");
    expect(durationInput).toBeInTheDocument();
    expect(await screen.findByText("Standard")).toBeInTheDocument();

    fireEvent.change(durationInput, {
      target: { value: "2880" }
    });
    fireEvent.click(screen.getByText("Heavy"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create task" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Tune Life Force completion flow",
          plannedDurationSeconds: 172_800,
          actionCostBand: "heavy",
          projectId: "project_1"
        }),
        undefined
      );
    });
  });

  it("lets the edit flow change tracked minutes without starting a live run", async () => {
    const onSubmit = vi.fn(async () => {});
    const onAdjustTrackedTime = vi.fn(async () => {});
    const goal = {
      id: "goal_1",
      title: "Ship Forge",
      description: "",
      status: "active",
      horizon: "lifetime",
      targetPoints: 120,
      themeColor: "#c0c1ff",
      createdAt: "2026-04-11T08:00:00.000Z",
      updatedAt: "2026-04-11T08:00:00.000Z",
      tagIds: [],
      owner: "Albert",
      userId: "user_operator",
      user: {
        id: "user_operator",
        kind: "human",
        handle: "albert",
        displayName: "Albert",
        description: "",
        accentColor: "#c0c1ff",
        createdAt: "2026-04-11T08:00:00.000Z",
        updatedAt: "2026-04-11T08:00:00.000Z"
      }
    } as unknown as Goal;
    const project = {
      id: "project_1",
      goalId: goal.id,
      goalTitle: goal.title,
      title: "Forge Runtime",
      description: "Core implementation work",
      status: "active",
      targetPoints: 120,
      themeColor: "#c0c1ff",
      schedulingRules: {
        allowWorkBlockKinds: [],
        blockWorkBlockKinds: [],
        allowCalendarIds: [],
        blockCalendarIds: [],
        allowEventTypes: [],
        blockEventTypes: [],
        allowEventKeywords: [],
        blockEventKeywords: [],
        allowAvailability: [],
        blockAvailability: []
      },
      createdAt: "2026-04-11T08:00:00.000Z",
      updatedAt: "2026-04-11T08:00:00.000Z",
      userId: "user_operator",
      user: goal.user,
      owner: "Albert"
    } as unknown as ProjectSummary;
    const tag = {
      id: "tag_1",
      name: "Deep work",
      color: "#7dd3fc",
      kind: "execution",
      description: ""
    } as unknown as Tag;
    const user: UserSummary = goal.user!;
    const editingTask = {
      id: "task_1",
      title: "Tune Life Force completion flow",
      description: "",
      level: "task",
      owner: "Albert",
      userId: "user_operator",
      assigneeUserIds: [],
      goalId: goal.id,
      projectId: project.id,
      parentWorkItemId: null,
      priority: "medium",
      status: "focus",
      effort: "deep",
      energy: "steady",
      dueDate: null,
      points: 70,
      plannedDurationSeconds: 86_400,
      actionPointSummary: {
        costBand: "standard"
      },
      aiInstructions: "",
      executionMode: "afk",
      acceptanceCriteria: [],
      blockerLinks: [],
      completionReport: null,
      gitRefs: [],
      tagIds: [],
      time: {
        totalTrackedSeconds: 90 * 60,
        totalCreditedSeconds: 90 * 60,
        todayCreditedSeconds: 0,
        liveTrackedSeconds: 0,
        liveCreditedSeconds: 0,
        manualAdjustedSeconds: 0,
        activeRunCount: 0,
        hasCurrentRun: false,
        currentRunId: null
      }
    } as unknown as Task;

    render(
      <I18nProvider locale="en">
        <TaskDialog
          open
          goals={[goal]}
          projects={[project]}
          tags={[tag]}
          users={[user]}
          editingTask={editingTask}
          currentCreditedSeconds={editingTask.time.totalCreditedSeconds}
          onOpenChange={vi.fn()}
          onAdjustTrackedTime={onAdjustTrackedTime}
          onSubmit={onSubmit}
        />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByText("Reward and timing");

    const trackedMinutesInput = screen
      .getByText("Tracked minutes")
      .closest("label")
      ?.querySelector("input");
    expect(trackedMinutesInput).not.toBeNull();

    fireEvent.change(trackedMinutesInput!, {
      target: { value: "125" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save task" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Tune Life Force completion flow"
        }),
        "task_1"
      );
    });
    expect(onAdjustTrackedTime).toHaveBeenCalledWith({
      entityType: "task",
      entityId: "task_1",
      deltaMinutes: 35,
      note: "Adjusted from task editor."
    });
  });
});
