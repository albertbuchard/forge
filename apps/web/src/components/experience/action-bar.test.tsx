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
import {
  ActionBar,
  mapLocalSearchResultsToActionBarItems
} from "@/components/experience/action-bar";
import type { ForgeCreateAction } from "@/components/create-menu";
import type { ForgeSnapshot, LocalSearchResult } from "@/lib/types";

const {
  createSavedViewMock,
  deleteSavedViewMock,
  getEntityNavigationMock,
  getSavedViewsMock,
  pinEntityNavigationMock,
  searchLocalRecordsMock,
  touchEntityNavigationMock,
  unpinEntityNavigationMock
} = vi.hoisted(() => ({
  createSavedViewMock: vi.fn(),
  deleteSavedViewMock: vi.fn(),
  getEntityNavigationMock: vi.fn(),
  getSavedViewsMock: vi.fn(),
  pinEntityNavigationMock: vi.fn(),
  searchLocalRecordsMock: vi.fn(),
  touchEntityNavigationMock: vi.fn(),
  unpinEntityNavigationMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  createSavedView: createSavedViewMock,
  deleteSavedView: deleteSavedViewMock,
  getEntityNavigation: getEntityNavigationMock,
  getSavedViews: getSavedViewsMock,
  pinEntityNavigation: pinEntityNavigationMock,
  searchLocalRecords: searchLocalRecordsMock,
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
    searchLocalRecordsMock.mockResolvedValue({
      query: "",
      retrievalMode: "local_lexical_structural",
      results: [],
      coverage: {
        eligibleEntityTypes: [],
        indexedDocuments: 0,
        indexedRelationships: 0,
        deletionTombstonesApplied: 0,
        scopeTombstonesApplied: 0,
        truncated: false
      }
    });
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

  it("applies a full local-search response within 50 ms", () => {
    const results: LocalSearchResult[] = Array.from(
      { length: 12 },
      (_, index) => ({
        entityType: "task",
        entityId: `task-performance-${index}`,
        entityKind: "task",
        title: `Performance task ${index}`,
        detail: "A bounded local-search result with exact evidence.",
        category: "Task",
        sourceHref: `/tasks/task-performance-${index}`,
        graphHref: `/knowledge-graph?focus=task%3Atask-performance-${index}`,
        score: 12 - index,
        evidence: [
          {
            kind: "text",
            label: "Title",
            field: "title",
            excerpt: `Performance task ${index}`,
            matchedTerms: ["performance", "task"]
          }
        ]
      })
    );
    for (let index = 0; index < 5; index += 1) {
      mapLocalSearchResultsToActionBarItems(results);
    }
    const samples: number[] = [];
    for (let index = 0; index < 40; index += 1) {
      const startedAt = performance.now();
      const items = mapLocalSearchResultsToActionBarItems(results);
      samples.push(performance.now() - startedAt);
      expect(items).toHaveLength(12);
    }
    samples.sort((left, right) => left - right);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!;
    if (process.env.FORGE_PERF_DIAGNOSTICS === "1") {
      console.info(
        `KNOW-09 Action Bar apply p95=${p95.toFixed(3)}ms; measured=${samples.length}; warmups=5; threshold=50ms`
      );
    }
    expect(
      p95,
      `Action Bar apply p95 was ${p95.toFixed(3)} ms`
    ).toBeLessThanOrEqual(50);
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
          <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
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

  it("keeps a missing pin removable without offering a false destination", async () => {
    const onOpenChange = vi.fn();
    getEntityNavigationMock.mockResolvedValue({
      generatedAt: "2026-08-11T00:00:00.000Z",
      pinnedTotal: 1,
      recentTotal: 0,
      hiddenRecentCount: 0,
      pinned: [
        {
          pinId: "pin_missing",
          entityType: "goal",
          entityId: "goal_missing",
          title: "Goal unavailable",
          detail: "The original record is no longer available.",
          category: "Goal",
          targetPath: null,
          ownerUserId: null,
          availability: "missing",
          pinnedAt: "2026-08-11T00:00:00.000Z",
          lastViewedAt: null,
          viewCount: 0
        }
      ],
      recent: []
    });
    renderActionBar({ onOpenChange });

    expect(
      await screen.findByRole("button", {
        name: "Goal unavailable is unavailable"
      })
    ).toBeDisabled();
    fireEvent.keyDown(
      screen.getByPlaceholderText(
        "Search anything in Forge or type create habit…"
      ),
      { key: "ArrowDown" }
    );
    fireEvent.keyDown(
      screen.getByPlaceholderText(
        "Search anything in Forge or type create habit…"
      ),
      { key: "Enter" }
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Unpin Goal unavailable" })
    );

    await waitFor(() =>
      expect(unpinEntityNavigationMock).toHaveBeenCalledWith("pin_missing")
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
    searchLocalRecordsMock.mockResolvedValue({
      results: [
        {
          entityType: "insight",
          entityId: "insight-1",
          entityKind: "insight",
          title: "A useful signal",
          detail: "Review this signal.",
          category: "Insight",
          sourceHref: "/knowledge-graph?focus=insight%3Ainsight-1",
          graphHref: "/knowledge-graph?focus=insight%3Ainsight-1",
          score: 12,
          evidence: [
            {
              kind: "text",
              label: "Title",
              field: "title",
              excerpt: "A useful signal",
              matchedTerms: ["useful", "signal"]
            }
          ]
        }
      ],
      query: "useful signal",
      retrievalMode: "local_lexical_structural",
      coverage: {
        eligibleEntityTypes: ["insight"],
        indexedDocuments: 1,
        indexedRelationships: 0,
        deletionTombstonesApplied: 0,
        scopeTombstonesApplied: 0,
        truncated: false
      }
    });
    renderActionBar();

    fireEvent.change(
      screen.getAllByPlaceholderText(/search anything in forge/i)[0]!,
      { target: { value: "useful signal" } }
    );
    expect(await screen.findByText(/Matched Title:/)).toBeVisible();
    const graphAction = screen.getByRole("button", {
      name: "Open A useful signal in Knowledge Graph"
    });
    expect(graphAction).toHaveClass("size-11");
    fireEvent.click(await screen.findByText("A useful signal"));

    await waitFor(() =>
      expect(touchEntityNavigationMock).not.toHaveBeenCalled()
    );
  });

  it("applies free-text and badge filters conjunctively", async () => {
    searchLocalRecordsMock.mockResolvedValue({
      results: [
        {
          entityType: "note",
          entityId: "wiki_mickael",
          entityKind: "wiki_page",
          title: "Mickael Atlas",
          detail: "Open the wiki page.",
          category: "Wiki page",
          sourceHref: "/wiki/page/mickael-atlas",
          graphHref: "/knowledge-graph?focus=note%3Awiki_mickael",
          score: 10,
          evidence: []
        }
      ],
      query: "Mickael",
      retrievalMode: "local_lexical_structural",
      coverage: {
        eligibleEntityTypes: ["note"],
        indexedDocuments: 1,
        indexedRelationships: 0,
        deletionTombstonesApplied: 0,
        scopeTombstonesApplied: 0,
        truncated: false
      }
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
    await waitFor(() =>
      expect(searchLocalRecordsMock).toHaveBeenLastCalledWith({
        query: "Mickael",
        entityTypes: ["note"],
        entityKinds: ["wiki_page"],
        userIds: undefined,
        limit: 12
      })
    );
  });

  it("keeps OR semantics when multiple entity-type badges are selected", async () => {
    searchLocalRecordsMock.mockResolvedValue({
      results: [
        {
          entityType: "note",
          entityId: "wiki_mickael",
          entityKind: "wiki_page",
          title: "Mickael Atlas",
          detail: "Open the wiki page.",
          category: "Wiki page",
          sourceHref: "/wiki/page/mickael-atlas",
          graphHref: "/knowledge-graph?focus=note%3Awiki_mickael",
          score: 10,
          evidence: []
        },
        {
          entityType: "note",
          entityId: "note_mickael",
          entityKind: "note",
          title: "Mickael scratchpad",
          detail: "Open the note.",
          category: "Note",
          sourceHref: "/notes?focus=note_mickael",
          graphHref: "/knowledge-graph?focus=note%3Anote_mickael",
          score: 9,
          evidence: []
        }
      ],
      query: "Mickael",
      retrievalMode: "local_lexical_structural",
      coverage: {
        eligibleEntityTypes: ["note"],
        indexedDocuments: 2,
        indexedRelationships: 0,
        deletionTombstonesApplied: 0,
        scopeTombstonesApplied: 0,
        truncated: false
      }
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
    await waitFor(() =>
      expect(searchLocalRecordsMock).toHaveBeenLastCalledWith({
        query: "Mickael",
        entityTypes: ["note"],
        entityKinds: ["note", "wiki_page"],
        userIds: undefined,
        limit: 12
      })
    );
  });

  it("reports a local search failure even when route matches remain", async () => {
    searchLocalRecordsMock.mockRejectedValue(
      new Error("Local search is unavailable")
    );
    renderActionBar();

    fireEvent.change(
      screen.getAllByPlaceholderText(/search anything in forge/i)[0]!,
      { target: { value: "recovery evidence" } }
    );

    const alert = await screen.findByText(
      /Forge could not search your local records/i
    );
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toBeVisible();
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
