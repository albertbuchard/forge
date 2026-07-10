import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotesPage } from "@/pages/notes-page";

const {
  createNoteMock,
  deleteNoteMock,
  getNoteMock,
  getLifeForceMock,
  listBehaviorsMock,
  listBehaviorPatternsMock,
  listBeliefsMock,
  listFlashcardsMock,
  listModesMock,
  listNotesMock,
  listPsycheValuesMock,
  listTriggerReportsMock,
  patchNoteMock,
  useForgeShellMock
} = vi.hoisted(() => ({
  createNoteMock: vi.fn(),
  deleteNoteMock: vi.fn(),
  getNoteMock: vi.fn(),
  getLifeForceMock: vi.fn(),
  listBehaviorsMock: vi.fn(),
  listBehaviorPatternsMock: vi.fn(),
  listBeliefsMock: vi.fn(),
  listFlashcardsMock: vi.fn(),
  listModesMock: vi.fn(),
  listNotesMock: vi.fn(),
  listPsycheValuesMock: vi.fn(),
  listTriggerReportsMock: vi.fn(),
  patchNoteMock: vi.fn(),
  useForgeShellMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  createNote: createNoteMock,
  deleteNote: deleteNoteMock,
  getNote: getNoteMock,
  getLifeForce: getLifeForceMock,
  listBehaviors: listBehaviorsMock,
  listBehaviorPatterns: listBehaviorPatternsMock,
  listBeliefs: listBeliefsMock,
  listFlashcards: listFlashcardsMock,
  listModes: listModesMock,
  listNotes: listNotesMock,
  listPsycheValues: listPsycheValuesMock,
  listTriggerReports: listTriggerReportsMock,
  patchNote: patchNoteMock
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

vi.mock("@/components/psyche/entity-link-multiselect", () => ({
  EntityLinkMultiSelect: () => <div>Entity links</div>
}));

vi.mock("@/components/notes/note-filter-input", () => ({
  NoteFilterInput: () => <div>Note filters</div>
}));

vi.mock("@/components/notes/note-markdown", () => ({
  NoteMarkdown: ({ markdown }: { markdown: string }) => <div>{markdown}</div>
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
  FloatingActionMenu: () => null
}));

function renderWithProviders(initialEntry = "/notes") {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/notes" element={<NotesPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
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
    listPsycheValuesMock.mockResolvedValue({ values: [] });
    listBehaviorPatternsMock.mockResolvedValue({ patterns: [] });
    listBehaviorsMock.mockResolvedValue({ behaviors: [] });
    listBeliefsMock.mockResolvedValue({ beliefs: [] });
    listFlashcardsMock.mockResolvedValue({ flashcards: [] });
    listModesMock.mockResolvedValue({ modes: [] });
    listTriggerReportsMock.mockResolvedValue({ reports: [] });
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
      ]
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
});
