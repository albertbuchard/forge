import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@/lib/i18n";
import type {
  Goal,
  ProjectSummary,
  Tag,
  Task,
  TaskStatus,
  UserSummary
} from "@/lib/types";
import {
  buildExecutionBoardItems,
  ExecutionBoard,
  groupExecutionBoardItemsByLane,
  LANE_ORDER,
  type ExecutionBoardItem
} from "./execution-board";

const TEST_NOW = "2026-08-09T08:00:00.000Z";

const operator: UserSummary = {
  id: "user_operator",
  kind: "human",
  handle: "albert",
  displayName: "Albert",
  description: "",
  accentColor: "#c0c1ff",
  createdAt: TEST_NOW,
  updatedAt: TEST_NOW
};

const goal = {
  id: "goal_board",
  title: "Ship the board",
  description: "Keep work legible across every level.",
  status: "active",
  horizon: "quarter",
  targetPoints: 100,
  themeColor: "#c0c1ff",
  createdAt: TEST_NOW,
  updatedAt: TEST_NOW,
  tagIds: [],
  owner: "Albert",
  userId: operator.id,
  user: operator
} as unknown as Goal;

function createTask({
  id,
  title,
  level,
  status = "backlog",
  projectId = "project_board",
  parentWorkItemId = null
}: {
  id: string;
  title: string;
  level: Task["level"];
  status?: TaskStatus;
  projectId?: string;
  parentWorkItemId?: string | null;
}): Task {
  return {
    id,
    title,
    description: `${title} description`,
    level,
    status,
    priority: "medium",
    owner: operator.displayName,
    goalId: goal.id,
    projectId,
    parentWorkItemId,
    dueDate: null,
    effort: "light",
    energy: "steady",
    points: 30,
    plannedDurationSeconds: 3_600,
    schedulingRules: null,
    sortOrder: 0,
    resolutionKind: null,
    splitParentTaskId: null,
    aiInstructions: "",
    executionMode: null,
    acceptanceCriteria: [],
    blockerLinks: [],
    completionReport: null,
    gitRefs: [],
    completedAt: null,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    tagIds: [],
    userId: operator.id,
    user: operator,
    assigneeUserIds: [],
    assignees: [],
    time: {
      totalTrackedSeconds: 0,
      totalCreditedSeconds: 0,
      liveTrackedSeconds: 0,
      liveCreditedSeconds: 0,
      manualAdjustedSeconds: 0,
      activeRunCount: 0,
      hasCurrentRun: false,
      currentRunId: null
    },
    actionPointSummary: undefined,
    splitSuggestion: undefined
  };
}

function createProject({
  id,
  title,
  workflowStatus = "backlog"
}: {
  id: string;
  title: string;
  workflowStatus?: TaskStatus;
}): ProjectSummary {
  return {
    id,
    goalId: goal.id,
    goalTitle: goal.title,
    title,
    description: `${title} description`,
    status: "active",
    workflowStatus,
    targetPoints: 100,
    themeColor: "#c0c1ff",
    productRequirementsDocument: "",
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
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    userId: operator.id,
    user: operator,
    assigneeUserIds: [],
    assignees: [],
    activeTaskCount: 0,
    completedTaskCount: 0,
    totalTasks: 0,
    earnedPoints: 0,
    progress: 0,
    nextTaskId: null,
    nextTaskTitle: null,
    momentumLabel: "Ready",
    time: {
      totalTrackedSeconds: 0,
      totalCreditedSeconds: 0,
      liveTrackedSeconds: 0,
      liveCreditedSeconds: 0,
      manualAdjustedSeconds: 0,
      activeRunCount: 0,
      hasCurrentRun: false,
      currentRunId: null
    }
  };
}

function installMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: "(max-width: 1023px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
}

function renderBoard({
  tasks,
  projects = [],
  onMove = vi.fn(async () => {}),
  onMoveProject = vi.fn(async () => {})
}: {
  tasks: Task[];
  projects?: ProjectSummary[];
  onMove?: (taskId: string, status: TaskStatus) => Promise<void>;
  onMoveProject?: (projectId: string, status: TaskStatus) => Promise<void>;
}) {
  render(
    <MemoryRouter>
      <I18nProvider locale="en">
        <ExecutionBoard
          tasks={tasks}
          projects={projects}
          goals={[goal]}
          tags={[]}
          selectedTaskId={null}
          onMove={onMove}
          onMoveProject={onMoveProject}
          onSelectTask={vi.fn()}
        />
      </I18nProvider>
    </MemoryRouter>
  );
  return { onMove, onMoveProject };
}

async function verifyKeyboardDragIdentity(
  card: HTMLElement,
  kind: "project" | "task",
  id: string
) {
  card.focus();
  fireEvent.keyDown(card, { key: " ", code: "Space" });
  const overlay = await screen.findByTestId("kanban-drag-overlay");
  expect(overlay).toHaveAttribute("data-active-kind", kind);
  expect(overlay).toHaveAttribute("data-active-id", id);
  fireEvent.keyDown(card, { key: "Escape", code: "Escape" });
  await waitFor(() =>
    expect(screen.queryByTestId("kanban-drag-overlay")).not.toBeInTheDocument()
  );
}

async function chooseFocusMoveFromKeyboardReachableMenu(title: string) {
  const trigger = screen.getByRole("button", {
    name: `Open ${title} actions`
  });
  trigger.focus();
  fireEvent.click(trigger);
  const menu = await screen.findByRole("menu");
  const target = within(menu).getByRole("menuitem", {
    name: /^Move to focus/i
  });
  await waitFor(() =>
    expect(within(menu).getAllByRole("menuitem")[0]).toHaveFocus()
  );
  for (
    let index = 0;
    index < 12 && document.activeElement !== target;
    index += 1
  ) {
    fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
  }
  expect(target).toHaveFocus();
  fireEvent.click(target);
}

function legacyPrepareBoardItems({
  tasks,
  projects,
  goals,
  tags
}: {
  tasks: Task[];
  projects: ProjectSummary[];
  goals: Goal[];
  tags: Tag[];
}): ExecutionBoardItem[] {
  return [
    ...projects.map((project) => ({
      kind: "project" as const,
      id: project.id,
      status: project.workflowStatus,
      project,
      goal: goals.find((entry) => entry.id === project.goalId)
    })),
    ...tasks.map((task) => ({
      kind: "task" as const,
      id: task.id,
      status: task.status,
      task,
      goal: goals.find((entry) => entry.id === task.goalId),
      tags: task.tagIds
        .map((tagId) => tags.find((entry) => entry.id === tagId))
        .filter((entry): entry is Tag => entry !== undefined),
      activeRun: null
    }))
  ];
}

function median(values: number[]) {
  return [...values].sort((left, right) => left - right)[
    Math.floor(values.length / 2)
  ]!;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ExecutionBoard PLAN-06 readiness", () => {
  it.each([
    ["issue", "Issue card"],
    ["task", "Task card"],
    ["subtask", "Subtask card"]
  ] as const)(
    "moves a %s by keyboard while retaining its work-item type and hierarchy",
    async (level, title) => {
      installMatchMedia(false);
      const task = createTask({
        id: `${level}_keyboard`,
        title,
        level,
        projectId: "project_parent",
        parentWorkItemId: level === "issue" ? null : "issue_parent"
      });
      const onMove = vi.fn(async () => {});
      renderBoard({ tasks: [task], onMove });

      await verifyKeyboardDragIdentity(
        screen.getByTestId(`task-card-${task.id}`),
        "task",
        task.id
      );
      await chooseFocusMoveFromKeyboardReachableMenu(title);

      await waitFor(() =>
        expect(onMove).toHaveBeenCalledWith(task.id, "focus")
      );
      const movedCard = within(
        screen.getByTestId("kanban-lane-focus")
      ).getByTestId(`task-card-${task.id}`);
      expect(within(movedCard).getByText(level)).toBeInTheDocument();
      const prepared = buildExecutionBoardItems({
        tasks: [task],
        projects: [],
        activeRuns: [],
        goals: [goal],
        tags: []
      });
      expect(prepared[0]).toMatchObject({
        kind: "task",
        task: {
          id: task.id,
          level,
          projectId: "project_parent",
          parentWorkItemId: level === "issue" ? null : "issue_parent"
        }
      });
    }
  );

  it("keeps a same-ID project and task distinct through keyboard drag", async () => {
    installMatchMedia(false);
    const sharedTask = createTask({
      id: "shared_identity",
      title: "Shared-ID task",
      level: "task"
    });
    const sharedProject = createProject({
      id: "shared_identity",
      title: "Shared-ID project"
    });
    const onMove = vi.fn(async () => {});
    const onMoveProject = vi.fn(async () => {});
    renderBoard({
      tasks: [sharedTask],
      projects: [sharedProject],
      onMove,
      onMoveProject
    });

    await verifyKeyboardDragIdentity(
      screen.getByTestId("task-card-shared_identity"),
      "task",
      "shared_identity"
    );
    await verifyKeyboardDragIdentity(
      screen.getByTestId("project-card-shared_identity"),
      "project",
      "shared_identity"
    );
    expect(onMove).not.toHaveBeenCalled();
    expect(onMoveProject).not.toHaveBeenCalled();
  });

  it("moves a project by keyboard without converting it into a work item", async () => {
    installMatchMedia(false);
    const project = createProject({
      id: "project_keyboard",
      title: "Keyboard project"
    });
    const onMoveProject = vi.fn(async () => {});
    renderBoard({ tasks: [], projects: [project], onMoveProject });

    await verifyKeyboardDragIdentity(
      screen.getByTestId(`project-card-${project.id}`),
      "project",
      project.id
    );
    await chooseFocusMoveFromKeyboardReachableMenu(project.title);

    await waitFor(() =>
      expect(onMoveProject).toHaveBeenCalledWith(project.id, "focus")
    );
    const movedCard = within(
      screen.getByTestId("kanban-lane-focus")
    ).getByTestId(`project-card-${project.id}`);
    expect(within(movedCard).getByText("project")).toBeInTheDocument();
  });

  it("restores failed task and project moves and exposes 44px mobile controls", async () => {
    installMatchMedia(true);
    const task = createTask({
      id: "issue_rollback",
      title: "Rollback issue",
      level: "issue",
      status: "focus"
    });
    const project = createProject({
      id: "project_rollback",
      title: "Rollback project",
      workflowStatus: "focus"
    });
    const onMove = vi.fn(async () => {
      throw new Error("Task move unavailable.");
    });
    const onMoveProject = vi.fn(async () => {
      throw new Error("Project move unavailable.");
    });
    renderBoard({ tasks: [task], projects: [project], onMove, onMoveProject });

    const taskMove = screen.getByRole("button", {
      name: "Move Rollback issue to the next lane"
    });
    const projectMove = screen.getByRole("button", {
      name: "Move Rollback project to the next lane"
    });
    expect(taskMove).toHaveClass("size-11");
    expect(projectMove).toHaveClass("size-11");
    expect(
      screen.getByRole("button", { name: "Open Rollback issue actions" })
    ).toHaveClass("size-11");

    fireEvent.click(taskMove);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /restored its previous lane.*task move unavailable/i
      )
    );
    expect(
      within(screen.getByTestId("kanban-lane-focus")).getByTestId(
        "task-card-issue_rollback"
      )
    ).toBeInTheDocument();
    const dismiss = screen.getByRole("button", {
      name: "Dismiss board move error"
    });
    expect(dismiss).toHaveClass("size-11");
    fireEvent.click(dismiss);

    fireEvent.click(projectMove);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /restored its previous lane.*project move unavailable/i
      )
    );
    expect(
      within(screen.getByTestId("kanban-lane-focus")).getByTestId(
        "project-card-project_rollback"
      )
    ).toBeInTheDocument();
  });

  it("prepares and groups a dense mixed board exactly once per record", () => {
    const denseGoals = Array.from({ length: 600 }, (_, index) => ({
      ...goal,
      id: `goal_${index}`,
      title: `Goal ${index}`
    })) as Goal[];
    const denseTags = Array.from({ length: 600 }, (_, index) => ({
      id: `tag_${index}`,
      name: `Tag ${index}`,
      color: "#7dd3fc",
      kind: "execution",
      description: ""
    })) as Tag[];
    const denseProjects = Array.from(
      { length: 600 },
      (_, index) =>
        ({
          id: `project_${index}`,
          goalId: `goal_${index}`,
          workflowStatus: LANE_ORDER[index % LANE_ORDER.length]
        }) as ProjectSummary
    );
    const denseTasks = Array.from(
      { length: 12_000 },
      (_, index) =>
        ({
          id: `task_${index}`,
          level: (["issue", "task", "subtask"] as const)[index % 3],
          status: LANE_ORDER[index % LANE_ORDER.length],
          goalId: `goal_${index % denseGoals.length}`,
          projectId: `project_${index % denseProjects.length}`,
          parentWorkItemId:
            index % 3 === 0 ? null : `task_${Math.max(0, index - 1)}`,
          tagIds: [`tag_${index % denseTags.length}`]
        }) as Task
    );
    const input = {
      tasks: denseTasks,
      projects: denseProjects,
      activeRuns: [],
      goals: denseGoals,
      tags: denseTags
    };

    buildExecutionBoardItems(input);
    legacyPrepareBoardItems(input);
    const optimizedSamples: number[] = [];
    const legacySamples: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      let startedAt = performance.now();
      const optimized = buildExecutionBoardItems(input);
      optimizedSamples.push(performance.now() - startedAt);
      startedAt = performance.now();
      legacyPrepareBoardItems(input);
      legacySamples.push(performance.now() - startedAt);
      expect(optimized).toHaveLength(denseProjects.length + denseTasks.length);
    }

    const prepared = buildExecutionBoardItems(input);
    const grouped = groupExecutionBoardItemsByLane(prepared);
    expect(
      LANE_ORDER.reduce((sum, status) => sum + grouped[status].length, 0)
    ).toBe(prepared.length);
    expect(
      new Set(prepared.map((item) => `${item.kind}:${item.id}`)).size
    ).toBe(prepared.length);
    for (const index of [0, 5_999, 11_999]) {
      const item = prepared[denseProjects.length + index];
      expect(item).toMatchObject({
        kind: "task",
        task: {
          id: `task_${index}`,
          level: denseTasks[index]!.level,
          projectId: denseTasks[index]!.projectId,
          parentWorkItemId: denseTasks[index]!.parentWorkItemId
        },
        goal: { id: denseTasks[index]!.goalId },
        tags: [{ id: denseTasks[index]!.tagIds[0] }]
      });
    }
    expect(median(optimizedSamples)).toBeLessThan(median(legacySamples) * 0.4);
  });
});
