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
import { ActionBar } from "@/components/experience/action-bar";
import type { ForgeCreateAction } from "@/components/create-menu";
import type { ForgeSnapshot } from "@/lib/types";

const {
  getEntityNavigationMock,
  pinEntityNavigationMock,
  searchEntitiesMock,
  touchEntityNavigationMock,
  unpinEntityNavigationMock
} = vi.hoisted(() => ({
  getEntityNavigationMock: vi.fn(),
  pinEntityNavigationMock: vi.fn(),
  searchEntitiesMock: vi.fn(),
  touchEntityNavigationMock: vi.fn(),
  unpinEntityNavigationMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  getEntityNavigation: getEntityNavigationMock,
  pinEntityNavigation: pinEntityNavigationMock,
  searchEntities: searchEntitiesMock,
  touchEntityNavigation: touchEntityNavigationMock,
  unpinEntityNavigation: unpinEntityNavigationMock
}));

function createSnapshot(): ForgeSnapshot {
  return {
    overview: {
      topTasks: [
        {
          id: "task_recent",
          title: "Recent focus task",
          user: null
        }
      ],
      activeGoals: [
        {
          id: "goal_recent",
          title: "Ship Forge",
          user: null
        }
      ]
    },
    dashboard: {
      projects: [
        {
          id: "project_recent",
          title: "Action Bar polish",
          goalTitle: "Ship Forge",
          user: null
        }
      ],
      habits: [
        {
          id: "habit_recent",
          title: "Morning review",
          frequency: "daily",
          user: null
        }
      ]
    },
    users: [
      {
        id: "user_mickael",
        kind: "human",
        displayName: "Mickael",
        handle: "mickael",
        description: "",
        accentColor: "",
        createdAt: "",
        updatedAt: ""
      }
    ]
  } as ForgeSnapshot;
}

function renderActionBar({
  createActions = [],
  onOpenChange = vi.fn(),
  selectedUserIds = []
}: {
  createActions?: ForgeCreateAction[];
  onOpenChange?: (open: boolean) => void;
  selectedUserIds?: string[];
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ActionBar
          open
          onOpenChange={onOpenChange}
          snapshot={createSnapshot()}
          selectedUserIds={selectedUserIds}
          createActions={createActions}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchEntitiesMock.mockResolvedValue({ results: [] });
    getEntityNavigationMock.mockResolvedValue({
      generatedAt: "2026-07-09T00:00:00.000Z",
      pinnedTotal: 1,
      recentTotal: 1,
      hiddenRecentCount: 0,
      pinned: [
        {
          pinId: "pin_task",
          entityType: "task",
          entityId: "task_recent",
          title: "Pinned focus task",
          detail: "Resume the current work.",
          category: "Task",
          targetPath: "/tasks/task_recent",
          ownerUserId: null,
          availability: "available",
          pinnedAt: "2026-07-09T00:00:00.000Z",
          lastViewedAt: null,
          viewCount: 0
        }
      ],
      recent: [
        {
          pinId: null,
          entityType: "project",
          entityId: "project_recent",
          title: "Recently opened project",
          detail: "Continue where you left off.",
          category: "Project",
          targetPath: "/projects/project_recent",
          ownerUserId: null,
          availability: "available",
          pinnedAt: null,
          lastViewedAt: "2026-07-09T00:00:00.000Z",
          viewCount: 2
        }
      ]
    });
    pinEntityNavigationMock.mockResolvedValue({});
    touchEntityNavigationMock.mockResolvedValue({});
    unpinEntityNavigationMock.mockResolvedValue({});
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows canonical pinned and recent records when no query or filters are active", async () => {
    renderActionBar();

    const pinnedLabel = await screen.findByText("Pinned");
    const routesLabel = screen.getByText("Routes");
    const recentLabel = screen.getByText("Recent");
    const dialogText = screen.getByRole("dialog").textContent ?? "";

    expect(pinnedLabel).toBeInTheDocument();
    expect(routesLabel).toBeInTheDocument();
    expect(recentLabel).toBeInTheDocument();
    expect(dialogText.indexOf("Pinned")).toBeLessThan(
      dialogText.indexOf("Recent")
    );
    expect(dialogText.indexOf("Recent")).toBeLessThan(
      dialogText.indexOf("Routes")
    );
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Pinned focus task")).toBeInTheDocument();
    expect(screen.getByText("Recently opened project")).toBeInTheDocument();
    expect(screen.queryByText("Recent focus task")).not.toBeInTheDocument();
  });

  it("unpins a canonical item without opening it", async () => {
    renderActionBar();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Unpin Pinned focus task"
      })
    );

    await waitFor(() =>
      expect(unpinEntityNavigationMock).toHaveBeenCalledWith("pin_task")
    );
    expect(touchEntityNavigationMock).not.toHaveBeenCalled();
  });

  it("lets the shell route tracker handle direct detail routes without double touching", async () => {
    renderActionBar();

    fireEvent.click(await screen.findByText("Recently opened project"));

    expect(touchEntityNavigationMock).not.toHaveBeenCalled();
  });

  it("lets the shell route tracker handle exact Knowledge Graph routes", async () => {
    searchEntitiesMock.mockResolvedValue({
      results: [
        {
          matches: [
            {
              entityType: "insight",
              id: "insight-1",
              entity: {
                id: "insight-1",
                title: "A useful signal",
                summary: "Review this signal."
              }
            }
          ]
        }
      ]
    });
    renderActionBar();

    fireEvent.change(
      screen.getAllByPlaceholderText(/search anything in forge/i)[0]!,
      { target: { value: "useful signal" } }
    );
    fireEvent.click(await screen.findByText("A useful signal"));

    await waitFor(() =>
      expect(touchEntityNavigationMock).not.toHaveBeenCalled()
    );
  });

  it("applies free-text and badge filters conjunctively", async () => {
    searchEntitiesMock.mockResolvedValue({
      results: [
        {
          matches: [
            {
              entityType: "note",
              id: "wiki_mickael",
              entity: {
                id: "wiki_mickael",
                kind: "wiki",
                title: "Mickael Atlas",
                slug: "mickael-atlas"
              }
            },
            {
              entityType: "note",
              id: "note_mickael",
              entity: {
                id: "note_mickael",
                kind: "evidence",
                title: "Mickael scratchpad"
              }
            }
          ]
        }
      ]
    });

    renderActionBar();

    fireEvent.change(
      screen.getAllByPlaceholderText(/add entity type filters/i)[0]!,
      {
        target: { value: "wiki" }
      }
    );
    fireEvent.click(await screen.findByText("Wiki page"));
    fireEvent.change(
      screen.getAllByPlaceholderText(/search anything in forge/i)[0]!,
      {
        target: { value: "Mickael" }
      }
    );

    expect(await screen.findByText("Mickael Atlas")).toBeInTheDocument();
    expect(screen.queryByText("Mickael scratchpad")).not.toBeInTheDocument();
  });

  it("keeps OR semantics when multiple entity-type badges are selected", async () => {
    searchEntitiesMock.mockResolvedValue({
      results: [
        {
          matches: [
            {
              entityType: "note",
              id: "wiki_mickael",
              entity: {
                id: "wiki_mickael",
                kind: "wiki",
                title: "Mickael Atlas",
                slug: "mickael-atlas"
              }
            },
            {
              entityType: "note",
              id: "note_mickael",
              entity: {
                id: "note_mickael",
                kind: "evidence",
                title: "Mickael scratchpad"
              }
            }
          ]
        }
      ]
    });

    renderActionBar();

    fireEvent.change(
      screen.getAllByPlaceholderText(/add entity type filters/i)[0]!,
      {
        target: { value: "wiki" }
      }
    );
    fireEvent.click(await screen.findByText("Wiki page"));
    fireEvent.change(
      screen.getAllByPlaceholderText(/add entity type filters/i)[0]!,
      {
        target: { value: "note" }
      }
    );
    fireEvent.click(await screen.findByText(/^Note$/));
    fireEvent.change(
      screen.getAllByPlaceholderText(/search anything in forge/i)[0]!,
      {
        target: { value: "Mickael" }
      }
    );

    expect(await screen.findByText("Mickael Atlas")).toBeInTheDocument();
    expect(await screen.findByText("Mickael scratchpad")).toBeInTheDocument();
  });

  it("removes the last badge when backspace is pressed on an empty filter input", async () => {
    renderActionBar();

    const filterInput = screen.getAllByPlaceholderText(
      /add entity type filters/i
    )[0]!;
    fireEvent.change(filterInput, { target: { value: "wiki" } });
    fireEvent.click(await screen.findByText("Wiki page"));

    expect(screen.getByLabelText("Remove Wiki page")).toBeInTheDocument();

    fireEvent.keyDown(
      screen.getAllByPlaceholderText(/add entity type filters/i)[0]!,
      {
        key: "Backspace"
      }
    );

    await waitFor(() =>
      expect(
        screen.queryByLabelText("Remove Wiki page")
      ).not.toBeInTheDocument()
    );
  });

  it("surfaces quick create actions and runs the shared create handler", async () => {
    const onOpenChange = vi.fn();
    const onCreateHabit = vi.fn();

    renderActionBar({
      onOpenChange,
      createActions: [
        {
          id: "habit",
          kind: "habit",
          group: "Execution",
          title: "Habit",
          quickActionTitle: "Create habit",
          description: "Track a recurring commitment.",
          aliases: ["habit", "routine"],
          filterIds: ["habit"],
          onSelect: onCreateHabit
        }
      ]
    });

    fireEvent.change(
      screen.getAllByPlaceholderText(/search anything in forge/i)[0]!,
      {
        target: { value: "create habit" }
      }
    );

    fireEvent.click(await screen.findByText("Create habit"));

    expect(onCreateHabit).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
