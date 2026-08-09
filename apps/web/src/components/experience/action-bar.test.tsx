import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionBar } from "@/components/experience/action-bar";
import type { ForgeCreateAction } from "@/components/create-menu";
import type { ForgeSnapshot } from "@/lib/types";

const {
  createSavedViewMock,
  deleteSavedViewMock,
  getEntityNavigationMock,
  getSavedViewsMock,
  pinEntityNavigationMock,
  searchEntitiesMock,
  touchEntityNavigationMock,
  unpinEntityNavigationMock
} = vi.hoisted(() => ({
  createSavedViewMock: vi.fn(),
  deleteSavedViewMock: vi.fn(),
  getEntityNavigationMock: vi.fn(),
  getSavedViewsMock: vi.fn(),
  pinEntityNavigationMock: vi.fn(),
  searchEntitiesMock: vi.fn(),
  touchEntityNavigationMock: vi.fn(),
  unpinEntityNavigationMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  createSavedView: createSavedViewMock,
  deleteSavedView: deleteSavedViewMock,
  getEntityNavigation: getEntityNavigationMock,
  getSavedViews: getSavedViewsMock,
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
  selectedUserIds = [],
  onSelectedUserIdsChange = vi.fn()
}: {
  createActions?: ForgeCreateAction[];
  onOpenChange?: (open: boolean) => void;
  selectedUserIds?: string[];
  onSelectedUserIdsChange?: (userIds: string[]) => void;
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
          onSelectedUserIdsChange={onSelectedUserIdsChange}
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
    getSavedViewsMock.mockResolvedValue({ savedViews: [] });
    createSavedViewMock.mockImplementation((input) =>
      Promise.resolve({
        savedView: {
          id: "svw_created",
          ...input,
          unavailableFilterIds: [],
          unavailableScopeUserIds: [],
          compatibility: "ready",
          schemaVersion: 1,
          createdAt: "2026-08-09T12:00:00.000Z",
          updatedAt: "2026-08-09T12:00:00.000Z"
        }
      })
    );
    deleteSavedViewMock.mockResolvedValue({
      deleted: true,
      savedViewId: "svw_created"
    });
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

  it("provides an explicit close control on phone and desktop", async () => {
    const onOpenChange = vi.fn();
    renderActionBar({ onOpenChange });

    fireEvent.click(
      await screen.findByRole("button", { name: "Close Forge Action bar" })
    );

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("returns focus to the shell trigger after closing", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    });

    function Harness() {
      const [open, setOpen] = useState(false);
      const triggerRef = useRef<HTMLButtonElement | null>(null);
      return (
        <>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen(true)}
          >
            Open Action Bar
          </button>
          <ActionBar
            open={open}
            onOpenChange={setOpen}
            snapshot={createSnapshot()}
            selectedUserIds={[]}
            createActions={[]}
            returnFocusRef={triggerRef}
          />
        </>
      );
    }

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Harness />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const trigger = screen.getByRole("button", { name: "Open Action Bar" });
    fireEvent.click(trigger);
    fireEvent.click(
      await screen.findByRole("button", { name: "Close Forge Action bar" })
    );

    await waitFor(() => expect(trigger).toHaveFocus());
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

  it("searches every primary Forge domain, not only the default route shortcuts", async () => {
    renderActionBar();

    fireEvent.change(
      screen.getAllByPlaceholderText(/search anything in forge/i)[0]!,
      { target: { value: "artifacts" } }
    );

    expect(await screen.findByText("Artifacts")).toBeInTheDocument();
    expect(screen.getByText(/trusted files/i)).toBeInTheDocument();
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

  it("saves the current query, filters, and people scope under a clear name", async () => {
    renderActionBar({ selectedUserIds: ["user_mickael"] });
    fireEvent.change(
      screen.getAllByPlaceholderText(/search anything in forge/i)[0]!,
      { target: { value: "calendar review" } }
    );
    const filterInput = screen.getAllByPlaceholderText(
      /add entity type filters/i
    )[0]!;
    fireEvent.change(filterInput, { target: { value: "calendar" } });
    fireEvent.click(await screen.findByRole("option", { name: /Calendar/i }));
    fireEvent.change(screen.getByLabelText("Saved view name"), {
      target: { value: "Weekly calendar review" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save this view" }));

    await waitFor(() =>
      expect(createSavedViewMock).toHaveBeenCalledWith({
        ownerUserId: "user_mickael",
        name: "Weekly calendar review",
        query: "calendar review",
        filterIds: ["calendar_event"],
        scopeMode: "selected",
        scopeUserIds: ["user_mickael"]
      })
    );
    expect(
      await screen.findByText("Saved Weekly calendar review.")
    ).toBeVisible();
  });

  it("opens a saved view and reports stale state that was skipped", async () => {
    const onSelectedUserIdsChange = vi.fn();
    getSavedViewsMock.mockResolvedValue({
      savedViews: [
        {
          id: "svw_calendar",
          ownerUserId: "user_mickael",
          name: "Calendar decisions",
          query: "decision",
          filterIds: ["calendar_event"],
          scopeMode: "selected",
          scopeUserIds: ["user_mickael"],
          unavailableFilterIds: ["retired_filter"],
          unavailableScopeUserIds: ["user_retired"],
          compatibility: "ready",
          schemaVersion: 1,
          createdAt: "2026-08-09T12:00:00.000Z",
          updatedAt: "2026-08-09T12:00:00.000Z"
        }
      ]
    });
    renderActionBar({ onSelectedUserIdsChange });

    fireEvent.click(
      await screen.findByRole("button", {
        name: /^Calendar decisions decision$/
      })
    );

    expect(
      screen.getAllByPlaceholderText(/search anything in forge/i)[0]
    ).toHaveValue("decision");
    expect(screen.getByLabelText("Remove Calendar event")).toBeInTheDocument();
    expect(onSelectedUserIdsChange).toHaveBeenCalledWith(["user_mickael"]);
    expect(
      screen.getByText(
        "Opened Calendar decisions. 2 unavailable items were skipped."
      )
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete saved view Calendar decisions"
      })
    );
    await waitFor(() =>
      expect(deleteSavedViewMock).toHaveBeenCalledWith(
        "svw_calendar",
        "user_mickael"
      )
    );
  });

  it("blocks all-retired and unsupported saved views instead of widening scope", async () => {
    const onSelectedUserIdsChange = vi.fn();
    getSavedViewsMock.mockResolvedValue({
      savedViews: [
        {
          id: "svw_retired",
          ownerUserId: "user_mickael",
          name: "Retired team",
          query: "private review",
          filterIds: ["task"],
          scopeMode: "selected",
          scopeUserIds: [],
          unavailableFilterIds: [],
          unavailableScopeUserIds: ["user_retired"],
          compatibility: "ready",
          schemaVersion: 1,
          createdAt: "2026-08-09T12:00:00.000Z",
          updatedAt: "2026-08-09T12:00:00.000Z"
        },
        {
          id: "svw_future",
          ownerUserId: "user_mickael",
          name: "Future view",
          query: "future query",
          filterIds: [],
          scopeMode: "all",
          scopeUserIds: [],
          unavailableFilterIds: [],
          unavailableScopeUserIds: [],
          compatibility: "unsupported",
          schemaVersion: 2,
          createdAt: "2026-08-09T12:00:00.000Z",
          updatedAt: "2026-08-09T12:00:00.000Z"
        }
      ]
    });
    renderActionBar({ onSelectedUserIdsChange });

    fireEvent.click(
      await screen.findByRole("button", {
        name: /^Retired team All saved people are unavailable$/
      })
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "cannot be opened because every saved person is unavailable"
    );
    expect(
      screen.getAllByPlaceholderText(/search anything in forge/i)[0]
    ).toHaveValue("");
    expect(onSelectedUserIdsChange).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: /^Future view Needs a newer Forge version$/
      })
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "was saved by a newer Forge version"
    );
    expect(onSelectedUserIdsChange).not.toHaveBeenCalled();
  });

  it("keeps all 20 allowed views in a bounded scroll region", async () => {
    getSavedViewsMock.mockResolvedValue({
      savedViews: Array.from({ length: 20 }, (_, index) => ({
        id: `svw_${index + 1}`,
        ownerUserId: "user_mickael",
        name: `View ${index + 1}`,
        query: `query ${index + 1}`,
        filterIds: [],
        scopeMode: "all",
        scopeUserIds: [],
        unavailableFilterIds: [],
        unavailableScopeUserIds: [],
        compatibility: "ready",
        schemaVersion: 1,
        createdAt: "2026-08-09T12:00:00.000Z",
        updatedAt: "2026-08-09T12:00:00.000Z"
      }))
    });
    renderActionBar();

    const region = await screen.findByRole("region", { name: "Saved views" });
    expect(region).toHaveClass("max-h-56", "overflow-y-auto");
    expect(
      screen.getAllByRole("button", { name: /^View \d+ query \d+$/ })
    ).toHaveLength(20);
  });

  it("reports a failed deletion and clears the previous success notice", async () => {
    getSavedViewsMock.mockResolvedValue({
      savedViews: [
        {
          id: "svw_calendar",
          ownerUserId: "user_mickael",
          name: "Calendar decisions",
          query: "decision",
          filterIds: [],
          scopeMode: "all",
          scopeUserIds: [],
          unavailableFilterIds: [],
          unavailableScopeUserIds: [],
          compatibility: "ready",
          schemaVersion: 1,
          createdAt: "2026-08-09T12:00:00.000Z",
          updatedAt: "2026-08-09T12:00:00.000Z"
        }
      ]
    });
    deleteSavedViewMock.mockRejectedValue(
      new Error("Forge could not delete this saved view.")
    );
    renderActionBar();

    fireEvent.click(
      await screen.findByRole("button", {
        name: /^Calendar decisions decision$/
      })
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Opened Calendar decisions."
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete saved view Calendar decisions"
      })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Forge could not delete this saved view."
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
