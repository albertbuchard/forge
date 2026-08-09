import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CreateMenu,
  resolveForgeCreateContext,
  useForgeCreateActions,
  type ForgeCreateAction
} from "@/components/create-menu";

const { contextualDialogRenderedMock } = vi.hoisted(() => ({
  contextualDialogRenderedMock: vi.fn()
}));

vi.mock("@/components/notes/contextual-note-dialog", () => ({
  ContextualNoteDialog: ({
    open,
    source,
    onOpenChange
  }: {
    open: boolean;
    source: { label: string };
    onOpenChange: (open: boolean) => void;
  }) => {
    if (!open) {
      return null;
    }
    contextualDialogRenderedMock(performance.now());
    return (
      <div role="dialog" aria-label="Contextual note">
        <span>{source.label}</span>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close contextual note
        </button>
      </div>
    );
  }
}));

const actions: ForgeCreateAction[] = [
  {
    id: "goal",
    kind: "goal",
    group: "Execution",
    title: "New life goal",
    quickActionTitle: "Create life goal",
    description: "Define a long-term direction.",
    aliases: ["goal"],
    filterIds: ["goal"],
    onSelect: vi.fn()
  },
  {
    id: "task",
    kind: "task",
    group: "Execution",
    title: "New task",
    quickActionTitle: "Create task",
    description: "Capture the next actionable step in a project.",
    aliases: ["task"],
    filterIds: ["task"],
    onSelect: vi.fn()
  },
  {
    id: "psyche_value",
    kind: "value",
    group: "Psyche",
    title: "Value",
    quickActionTitle: "Create value",
    description:
      "Place one value into the goal, project, and task constellation.",
    aliases: ["value"],
    filterIds: ["psyche_value"],
    onSelect: vi.fn()
  },
  {
    id: "flashcard",
    kind: "flashcard",
    group: "Psyche",
    title: "Flashcard",
    quickActionTitle: "Create flashcard",
    description: "Write a compact therapeutic card.",
    aliases: ["flashcard"],
    filterIds: ["flashcard"],
    onSelect: vi.fn()
  },
  {
    id: "wiki_page",
    kind: "wiki_page",
    group: "Knowledge",
    title: "Wiki page",
    quickActionTitle: "Create wiki page",
    description: "Open a fresh KarpaWiki page draft.",
    aliases: ["wiki"],
    filterIds: ["wiki_page"],
    onSelect: vi.fn()
  }
];

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

function ContextualActionsHarness() {
  const createActions = useForgeCreateActions({
    goals: [{ id: "goal_1", title: "Finish the thesis" }] as never,
    projects: [],
    tasks: [],
    strategies: [],
    habits: [],
    tags: [],
    users: [],
    onCreateGoal: vi.fn(),
    onCreateProject: vi.fn(),
    onCreateTask: vi.fn()
  });
  const action = createActions.actions.find((entry) => entry.id === "note");
  return (
    <>
      <span>{action?.description}</span>
      <button
        type="button"
        onClick={(event) => action?.onSelect(event.currentTarget)}
      >
        Open related note
      </button>
      {createActions.dialogs}
    </>
  );
}

describe("CreateMenu", () => {
  beforeEach(() => {
    installMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens the desktop menu in a fixed floating layer", () => {
    render(
      <MemoryRouter>
        <CreateMenu actions={actions} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(screen.getByTestId("create-desktop-menu")).toHaveClass("fixed");
    expect(screen.getByTestId("create-desktop-menu")).toHaveStyle({
      transform: "translateY(-100%)"
    });
    expect(screen.getByRole("button", { name: /create/i })).toHaveClass(
      "min-w-max"
    );
    expect(screen.getByRole("button", { name: /create/i })).toHaveClass(
      "whitespace-nowrap"
    );
    expect(screen.getByText("New life goal")).toBeInTheDocument();
    expect(screen.getByText("New task")).toBeInTheDocument();
    expect(screen.getByText("Value")).toBeInTheDocument();
    expect(screen.getByText("Flashcard")).toBeInTheDocument();
    expect(screen.getByText("Wiki page")).toBeInTheDocument();
  });

  it("uses a mobile modal selector instead of the desktop popover", () => {
    installMatchMedia(true);

    render(
      <MemoryRouter>
        <CreateMenu actions={actions} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(screen.queryByTestId("create-desktop-menu")).not.toBeInTheDocument();
    expect(screen.getByTestId("create-mobile-sheet")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Create in Forge" })
    ).toBeInTheDocument();
  });

  it("can place the mobile trigger inside shell chrome without changing the guided modal", () => {
    installMatchMedia(true);
    const mobileTarget = document.createElement("div");
    mobileTarget.dataset.testid = "mobile-create-target";
    document.body.appendChild(mobileTarget);

    render(
      <MemoryRouter>
        <CreateMenu actions={actions} mobileTriggerTarget={mobileTarget} />
      </MemoryRouter>
    );

    const trigger = screen.getByRole("button", { name: "Create" });
    expect(mobileTarget).toContainElement(trigger);
    expect(trigger).toHaveClass("size-11");

    fireEvent.click(trigger);

    expect(screen.getByTestId("create-mobile-sheet")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Create in Forge" })
    ).toBeInTheDocument();

    mobileTarget.remove();
  });

  it("can place the desktop trigger in the shell header and opens the menu below it", () => {
    const desktopTarget = document.createElement("div");
    document.body.appendChild(desktopTarget);

    render(
      <MemoryRouter>
        <CreateMenu actions={actions} desktopTriggerTarget={desktopTarget} />
      </MemoryRouter>
    );

    const trigger = screen.getByRole("button", { name: "Create" });
    expect(desktopTarget).toContainElement(trigger);

    fireEvent.click(trigger);

    const menu = screen.getByRole("dialog", { name: "Create in Forge" });
    expect(menu).toHaveStyle({
      transform: "none"
    });
    expect(menu.style.maxHeight).toContain("100vh");
    expect(screen.getByText("New life goal")).toBeInTheDocument();

    desktopTarget.remove();
  });
});

describe("resolveForgeCreateContext", () => {
  it.each([
    ["/goals/goal_1", "", "goal", "goal_1"],
    ["/projects/project_1", "", "project", "project_1"],
    ["/tasks/task_1", "", "task", "task_1"],
    ["/strategies/strategy_1", "", "strategy", "strategy_1"],
    ["/habits", "?focus=habit_1", "habit", "habit_1"],
    ["/psyche/reports/report_1", "", "trigger_report", "report_1"]
  ])(
    "resolves the exact supported context at %s",
    (pathname, search, entityType, entityId) => {
      expect(resolveForgeCreateContext(pathname, search)).toEqual({
        version: 1,
        entityType,
        entityId,
        anchorKey: null
      });
    }
  );

  it("does not guess an ambiguous, malformed, or list-only context", () => {
    expect(resolveForgeCreateContext("/habits", "")).toBeNull();
    expect(
      resolveForgeCreateContext("/habits", "?focus=habit_1&focus=habit_2")
    ).toBeNull();
    expect(
      resolveForgeCreateContext("/habits", "?focus=bad%2Fid&focus=habit_1")
    ).toBeNull();
    expect(
      resolveForgeCreateContext("/habits", "?focus=&focus=habit_1")
    ).toBeNull();
    expect(resolveForgeCreateContext("/tasks", "")).toBeNull();
    expect(resolveForgeCreateContext("/tasks/bad%2Fid", "")).toBeNull();
    expect(
      resolveForgeCreateContext("/projects/project_1/edit", "")
    ).toBeNull();
  });

  it("keeps contextual route resolution below the one-millisecond p95 budget", () => {
    const durations: number[] = [];
    for (let index = 0; index < 33; index += 1) {
      const startedAt = performance.now();
      expect(
        resolveForgeCreateContext("/habits", "?focus=habit_evening_walk")
      ).not.toBeNull();
      if (index >= 3) {
        durations.push(performance.now() - startedAt);
      }
    }
    durations.sort((left, right) => left - right);
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1]!;
    console.log(`context resolver p95 ${p95.toFixed(3)}ms`);
    expect(p95).toBeLessThanOrEqual(1);
  });
});

describe("contextual create action", () => {
  it("states the relationship clearly and opens within the 100ms p95 budget", async () => {
    contextualDialogRenderedMock.mockClear();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/goals/goal_1?view=active#notes"]}>
          <ContextualActionsHarness />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(
      screen.getByText(
        "Add a note here. Forge keeps it linked to Finish the thesis and returns you to this exact place."
      )
    ).toBeInTheDocument();
    const durations: number[] = [];
    const openButton = screen.getByRole("button", {
      name: "Open related note"
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    for (let index = 0; index < 33; index += 1) {
      const startedAt = performance.now();
      fireEvent.click(openButton);
      if (index === 0) {
        expect(screen.getByRole("status")).toHaveTextContent(
          "Opening creation form…"
        );
      }
      await screen.findByRole("dialog", { name: "Contextual note" });
      if (index >= 3) {
        const renderedAt = contextualDialogRenderedMock.mock.calls.at(-1)?.[0];
        expect(renderedAt).toEqual(expect.any(Number));
        durations.push(renderedAt - startedAt);
      }
      fireEvent.click(
        screen.getByRole("button", { name: "Close contextual note" })
      );
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Contextual note" })
        ).not.toBeInTheDocument()
      );
    }
    durations.sort((left, right) => left - right);
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1]!;
    console.log(`contextual create open p95 ${p95.toFixed(2)}ms`);
    expect(p95).toBeLessThanOrEqual(100);
  });
});
