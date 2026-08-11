import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotesPage } from "@/pages/notes-page";
import {
  countNotesCreatedOnLocalDate,
  getEntityRoute
} from "@/lib/note-helpers";

const {
  createNoteMock,
  deleteNoteMock,
  getNoteMock,
  getLifeForceMock,
  listNotesMock,
  patchNoteMock,
  searchEntitiesMock,
  entityLinkMultiSelectPropsMock,
  useForgeShellMock
} = vi.hoisted(() => ({
  createNoteMock: vi.fn(),
  deleteNoteMock: vi.fn(),
  getNoteMock: vi.fn(),
  getLifeForceMock: vi.fn(),
  listNotesMock: vi.fn(),
  patchNoteMock: vi.fn(),
  searchEntitiesMock: vi.fn(),
  entityLinkMultiSelectPropsMock: vi.fn(),
  useForgeShellMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  createNote: createNoteMock,
  deleteNote: deleteNoteMock,
  getNote: getNoteMock,
  getLifeForce: getLifeForceMock,
  listNotes: listNotesMock,
  patchNote: patchNoteMock,
  searchEntities: searchEntitiesMock
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

vi.mock("@/components/psyche/entity-link-multiselect", () => ({
  EntityLinkMultiSelect: (props: {
    onSearch?: (query: string) => Promise<unknown>;
  }) => {
    entityLinkMultiSelectPropsMock(props);
    return <div>Entity links</div>;
  }
}));

vi.mock("@/components/notes/note-filter-input", () => ({
  NoteFilterInput: () => <div>Note filters</div>
}));

vi.mock("@/components/notes/note-markdown", () => ({
  NoteMarkdown: ({ markdown }: { markdown: string }) => <div>{markdown}</div>,
  NoteMarkdownDisclosure: ({ markdown }: { markdown: string }) => (
    <div>{markdown}</div>
  )
}));

vi.mock("@/components/notes/note-tags-input", () => ({
  NoteTagsInput: () => <div>Note tags</div>
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({
    titleText,
    description,
    badge,
    actions
  }: {
    titleText: string;
    description: string;
    badge?: string;
    actions?: ReactNode;
  }) => (
    <div>
      <div>{titleText}</div>
      <div>{description}</div>
      {badge ? <div>{badge}</div> : null}
      {actions}
    </div>
  )
}));

vi.mock("@/components/workbench-boxes/notes/notes-boxes", () => ({
  NoteComposerBox: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  NoteFiltersBox: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  NotesLibraryBox: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  )
}));

vi.mock("@/components/ui/floating-action-menu", () => ({
  FloatingActionMenu: ({
    open,
    items
  }: {
    open: boolean;
    items: Array<{ id: string; label: string; onSelect: () => void }>;
  }) =>
    open ? (
      <div>
        {items.map((item) => (
          <button key={item.id} type="button" onClick={item.onSelect}>
            {item.label}
          </button>
        ))}
      </div>
    ) : null
}));

function HistoryBackButton() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      History back
    </button>
  );
}

function renderWithProviders(
  initialEntry: string | string[] = "/notes",
  initialIndex?: number,
  queryRetry: boolean | number = false
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: queryRetry, retryDelay: 1 },
      mutations: { retry: false }
    }
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={
          Array.isArray(initialEntry) ? initialEntry : [initialEntry]
        }
        initialIndex={initialIndex}
      >
        <HistoryBackButton />
        <Routes>
          <Route path="/notes" element={<NotesPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function buildNote(index: number) {
  return {
    id: `note_${index}`,
    kind: "evidence" as const,
    title: `Note ${index}`,
    slug: `note-${index}`,
    spaceId: "space_1",
    parentSlug: null,
    indexOrder: 0,
    showInIndex: true,
    aliases: [],
    summary: "",
    contentMarkdown: `Bounded note ${index}`,
    contentPlain: `Bounded note ${index}`,
    author: "Albert",
    source: "ui" as const,
    sourcePath: "",
    frontmatter: {},
    revisionHash: `hash-${index}`,
    lastSyncedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    links: [],
    tags: ["bounded"],
    destroyAt: null,
    userId: "user_operator",
    user: null
  };
}

describe("NotesPage", () => {
  beforeEach(() => {
    useForgeShellMock.mockReturnValue({
      selectedUserIds: ["user_operator"],
      snapshot: {
        goals: [],
        tasks: [],
        strategies: [],
        habits: [],
        tags: [],
        dashboard: {
          projects: []
        }
      }
    });
    searchEntitiesMock.mockResolvedValue({ results: [] });
    deleteNoteMock.mockResolvedValue({ note: buildNote(1) });
    listNotesMock.mockResolvedValue({
      notes: [
        {
          id: "note_1",
          kind: "evidence",
          title: "Quick handoff",
          slug: "quick-handoff",
          spaceId: "space_1",
          parentSlug: null,
          indexOrder: 0,
          showInIndex: true,
          aliases: [],
          summary: "",
          contentMarkdown: "Capture the blocker and keep moving.",
          contentPlain: "Capture the blocker and keep moving.",
          author: "Albert",
          source: "ui",
          sourcePath: "",
          frontmatter: {},
          revisionHash: "hash",
          lastSyncedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          links: [],
          tags: ["capture"],
          destroyAt: null
        }
      ],
      total: 1,
      limit: 40,
      nextCursor: null,
      hasMore: false
    });
    getNoteMock.mockResolvedValue({
      note: {
        id: "note_outside_window",
        kind: "evidence",
        title: "Older durable note",
        slug: "older-durable-note",
        spaceId: "space_1",
        parentSlug: null,
        indexOrder: 0,
        showInIndex: true,
        aliases: [],
        summary: "",
        contentMarkdown: "This note is older than the bounded library window.",
        contentPlain: "This note is older than the bounded library window.",
        author: "Albert",
        source: "ui",
        sourcePath: "",
        frontmatter: {},
        revisionHash: "older-hash",
        lastSyncedAt: null,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
        links: [],
        tags: ["durable"],
        destroyAt: null
      }
    });
    getLifeForceMock.mockResolvedValue({
      lifeForce: {
        userId: "user_operator",
        dateKey: "2026-04-12",
        baselineDailyAp: 200,
        dailyBudgetAp: 210,
        spentTodayAp: 88,
        remainingAp: 122,
        forecastAp: 130,
        plannedRemainingAp: 18,
        targetBandMinAp: 178.5,
        targetBandMaxAp: 210,
        instantCapacityApPerHour: 10,
        instantFreeApPerHour: 4.1,
        overloadApPerHour: 0,
        currentDrainApPerHour: 4.2,
        fatigueBufferApPerHour: 1.7,
        sleepRecoveryMultiplier: 1,
        readinessMultiplier: 1,
        fatigueDebtCarry: 0,
        stats: [],
        currentCurve: [],
        activeDrains: [],
        plannedDrains: [],
        warnings: [],
        recommendations: [],
        topTaskIdsNeedingSplit: [],
        updatedAt: "2026-04-12T12:00:00.000Z"
      },
      templates: []
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("wires canonical remote entity search into the library editor", async () => {
    renderWithProviders();
    fireEvent.click(await screen.findByRole("button", { name: "New note" }));
    fireEvent.change(
      screen.getByPlaceholderText(
        "Write what happened, what it means, or what should be remembered."
      ),
      { target: { value: "Ticket context" } }
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const onSearch = entityLinkMultiSelectPropsMock.mock.lastCall?.[0]
      ?.onSearch as ((query: string) => Promise<unknown>) | undefined;
    expect(onSearch).toEqual(expect.any(Function));
    searchEntitiesMock.mockClear();
    await onSearch?.("ticket");
    expect(searchEntitiesMock).toHaveBeenCalledWith({
      searches: [
        expect.objectContaining({
          query: "ticket",
          limit: 40,
          entityTypes: expect.arrayContaining([
            "person",
            "artifact",
            "calendar_event",
            "trigger_report"
          ])
        })
      ]
    });
  });

  it("surfaces note AP and Life Force context in the notes workspace", async () => {
    renderWithProviders();

    expect(await screen.findByText("Quick note default")).toBeInTheDocument();
    expect(
      await screen.findByText("Capture the blocker and keep moving.")
    ).toBeInTheDocument();
    expect((await screen.findAllByText("1 AP")).length).toBeGreaterThan(0);
    expect(screen.getByText("Life Force sync")).toBeInTheDocument();
    expect(screen.getByText("Instant headroom")).toBeInTheDocument();
    expect(
      screen.getByText((_, node) => node?.textContent === "1 AP quick note")
    ).toBeInTheDocument();
    expect(
      (await screen.findAllByText("88 AP / 210 AP")).length
    ).toBeGreaterThan(0);
    expect((await screen.findAllByText("4.1 AP/h")).length).toBeGreaterThan(0);
    expect(searchEntitiesMock).not.toHaveBeenCalled();
  });

  it("keeps Notes usable when Life Force is unavailable", async () => {
    getLifeForceMock.mockRejectedValueOnce(new Error("Life Force offline"));

    renderWithProviders();

    expect(
      await screen.findByText("Capture the blocker and keep moving.")
    ).toBeInTheDocument();
    expect(await screen.findAllByText("Unavailable")).toHaveLength(2);
  });

  it("counts notes by the runtime local date across a UTC boundary", () => {
    const resolvedOptions = vi
      .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
      .mockReturnValue({
        timeZone: "Europe/Zurich"
      } as Intl.ResolvedDateTimeFormatOptions);

    expect(
      countNotesCreatedOnLocalDate(
        [{ createdAt: "2026-07-15T22:30:00.000Z" }],
        new Date("2026-07-16T00:15:00.000Z")
      )
    ).toBe(1);
    resolvedOptions.mockRestore();
  });

  it("uses only exact stable routes for newly navigable linked records", () => {
    expect(getEntityRoute("person", "person/1")).toBe("/people/person%2F1");
    expect(getEntityRoute("life_event", "event 1")).toBe(
      "/life-events?focus=event%201"
    );
    expect(getEntityRoute("task_timebox", "box_1")).toBe(
      "/calendar?timeboxId=box_1"
    );
    expect(getEntityRoute("calendar_event", "calendar_1")).toBeNull();
    expect(getEntityRoute("event_type", "event type/1")).toBe(
      "/psyche/reports?vocabulary=event_type&focusVocabulary=event%20type%2F1"
    );
    expect(getEntityRoute("emotion_definition", "emotion 1")).toBe(
      "/psyche/reports?vocabulary=emotion_definition&focusVocabulary=emotion%201"
    );
  });

  it("rehydrates filter controls when browser history changes the URL", async () => {
    renderWithProviders(
      ["/notes?author=Alice", "/notes?author=Bob&tags=recent"],
      1
    );

    expect(await screen.findByDisplayValue("Bob")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "History back" }));

    expect(await screen.findByDisplayValue("Alice")).toBeInTheDocument();
    await waitFor(() =>
      expect(listNotesMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ author: "Alice", tags: [] })
      )
    );
  });

  it("preserves and highlights an exact note navigation focus", async () => {
    renderWithProviders("/notes?focus=note_1");

    expect(
      await screen.findByText("Capture the blocker and keep moving.")
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(document.getElementById("forge-note-note_1")).toHaveAttribute(
        "aria-current",
        "true"
      );
    });
  });

  it("loads and highlights a focused note outside the bounded library window", async () => {
    renderWithProviders("/notes?focus=note_outside_window");

    expect(
      await screen.findByText(
        "This note is older than the bounded library window."
      )
    ).toBeInTheDocument();
    expect(getNoteMock).toHaveBeenCalledWith("note_outside_window");
    expect(
      document.getElementById("forge-note-note_outside_window")
    ).toHaveAttribute("aria-current", "true");
  });

  it("loads notes in bounded user-scoped windows and expands intentionally", async () => {
    listNotesMock.mockImplementation(
      async (input: {
        limit?: number;
        cursor?: string;
        userIds?: string[];
      }) => {
        const start = input.cursor === "page-2" ? 40 : 0;
        return {
          notes: Array.from({ length: 40 }, (_, index) =>
            buildNote(start + index)
          ),
          total: 80,
          limit: 40,
          nextCursor: start === 0 ? "page-2" : null,
          hasMore: start === 0
        };
      }
    );

    renderWithProviders("/notes?textTerms=bounded&tags=capture");

    const loadOlder = await screen.findByRole("button", {
      name: "Load older notes"
    });
    expect(listNotesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 40,
        textTerms: ["bounded"],
        tags: ["capture"],
        userIds: ["user_operator"]
      })
    );

    fireEvent.click(loadOlder);

    await waitFor(() =>
      expect(listNotesMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ limit: 40, cursor: "page-2" })
      )
    );
    expect(
      await screen.findByText(/Showing the newest 80 of 80/)
    ).toBeInTheDocument();
  });

  it("keeps loaded pages after a next-page failure and resumes only after an explicit retry", async () => {
    let nextPageAttempts = 0;
    listNotesMock.mockImplementation(
      async (input: { limit?: number; cursor?: string }) => {
        if (!input.cursor) {
          return {
            notes: Array.from({ length: 40 }, (_, index) => buildNote(index)),
            total: 80,
            limit: 40,
            nextCursor: "page-2",
            hasMore: true
          };
        }

        nextPageAttempts += 1;
        if (nextPageAttempts === 1) {
          throw new Error("Older notes are temporarily unavailable");
        }

        return {
          notes: Array.from({ length: 40 }, (_, index) =>
            buildNote(40 + index)
          ),
          total: 80,
          limit: 40,
          nextCursor: null,
          hasMore: false
        };
      }
    );

    renderWithProviders("/notes?textTerms=bounded", undefined, 3);

    fireEvent.click(
      await screen.findByRole("button", { name: "Load older notes" })
    );

    expect(
      await screen.findByText(
        "Older notes could not be loaded. The pages above are intact."
      )
    ).toBeInTheDocument();
    expect(nextPageAttempts).toBe(1);
    expect(screen.getByText("Bounded note 0")).toBeInTheDocument();
    expect(screen.getByText("Bounded note 39")).toBeInTheDocument();
    expect(screen.queryByText("Bounded note 40")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry older notes" }));

    expect(await screen.findByText("Bounded note 79")).toBeInTheDocument();
    expect(nextPageAttempts).toBe(2);
    expect(
      screen.queryByText(
        "Older notes could not be loaded. The pages above are intact."
      )
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Showing the newest 80 of 80/)).toBeInTheDocument();
  });

  it("requires confirmation before a note is soft-deleted", async () => {
    renderWithProviders();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Open actions for Quick handoff"
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete note" }));

    expect(deleteNoteMock).not.toHaveBeenCalled();
    expect(screen.getByText(/This is a soft delete/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Move to bin" }));
    await waitFor(() => expect(deleteNoteMock).toHaveBeenCalledWith("note_1"));
  });
});
