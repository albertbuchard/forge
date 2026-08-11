import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { PsycheReportsPage } from "@/pages/psyche-reports-page";

const {
  createTriggerReportMock,
  listBehaviorPatternsMock,
  listEventTypesMock,
  listPsycheValuesMock,
  listTriggerReportsMock,
  useForgeShellMock
} = vi.hoisted(() => ({
  createTriggerReportMock: vi.fn(),
  listBehaviorPatternsMock: vi.fn(),
  listEventTypesMock: vi.fn(),
  listPsycheValuesMock: vi.fn(),
  listTriggerReportsMock: vi.fn(),
  useForgeShellMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  createBehavior: vi.fn(),
  createBelief: vi.fn(),
  createEmotionDefinition: vi.fn(),
  createEventType: vi.fn(),
  createMode: vi.fn(),
  createPsycheValue: vi.fn(),
  createTriggerReport: createTriggerReportMock,
  deleteEmotionDefinition: vi.fn(),
  deleteEventType: vi.fn(),
  listBehaviorPatterns: listBehaviorPatternsMock,
  listBeliefs: vi.fn().mockResolvedValue({ beliefs: [] }),
  listBehaviors: vi.fn().mockResolvedValue({ behaviors: [] }),
  listEmotionDefinitions: vi.fn().mockResolvedValue({ emotions: [] }),
  listEventTypes: listEventTypesMock,
  listModes: vi.fn().mockResolvedValue({ modes: [] }),
  listPsycheValues: listPsycheValuesMock,
  listSchemaCatalog: vi.fn().mockResolvedValue({ schemas: [] }),
  listTriggerReports: listTriggerReportsMock,
  patchEmotionDefinition: vi.fn(),
  patchEventType: vi.fn()
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({ actions }: { actions?: ReactNode }) => <header>{actions}</header>
}));

vi.mock("@/components/psyche/psyche-section-nav", () => ({
  PsycheSectionNav: () => null
}));

vi.mock("@/components/psyche/atlas-panel", () => ({
  AtlasPanel: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  )
}));

vi.mock("@/components/notes/entity-note-count-link", () => ({
  EntityNoteCountLink: () => null
}));

vi.mock("@/components/ui/entity-name", () => ({
  EntityName: ({ label }: { label: ReactNode }) => <>{label}</>
}));

vi.mock("@/components/ui/user-select-field", () => ({
  UserSelectField: () => null
}));

vi.mock("@/components/psyche/entity-link-multiselect", () => ({
  EntityLinkMultiSelect: ({
    placeholder,
    selectedValues = [],
    onChange
  }: {
    placeholder?: string;
    selectedValues?: string[];
    onChange: (values: string[]) => void;
  }) =>
    placeholder?.includes("patterns") ? (
      <button
        type="button"
        aria-label={placeholder}
        onClick={() => onChange([...selectedValues, "pattern-1"])}
      >
        Select pattern link
      </button>
    ) : null
}));

vi.mock("@/components/psyche/schema-badge", () => ({
  SchemaBadge: () => null
}));

vi.mock("@/components/psyche/report-chain-fields", () => ({
  StringListEditor: ({
    title,
    onChange
  }: {
    title: string;
    onChange: (items: string[]) => void;
  }) => (
    <button type="button" onClick={() => onChange([`${title} entered`])}>
      Add {title}
    </button>
  ),
  EmotionRowsEditor: ({
    onChange
  }: {
    onChange: (items: unknown[]) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange([
          {
            id: "emotion-1",
            emotionDefinitionId: null,
            label: "Fear",
            intensity: 72,
            note: ""
          }
        ])
      }
    >
      Add emotion
    </button>
  ),
  ThoughtRowsEditor: ({
    onChange
  }: {
    onChange: (items: unknown[]) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange([
          {
            id: "thought-1",
            text: "This means I am being rejected.",
            parentMode: "",
            criticMode: "",
            beliefId: null
          }
        ])
      }
    >
      Add thought
    </button>
  ),
  BehaviorRowsEditor: ({
    onChange
  }: {
    onChange: (items: unknown[]) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange([
          {
            id: "behavior-1",
            text: "I withdrew and checked my phone.",
            mode: "",
            behaviorId: null
          }
        ])
      }
    >
      Add behavior
    </button>
  ),
  ModeTimelineEditor: () => null
}));

function renderPage(initialEntry = "/psyche/reports") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <PsycheReportsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function buildReport(id: string, title: string) {
  return {
    id,
    title,
    status: "draft",
    eventTypeId: null,
    customEventType: "Difficult conversation",
    eventSituation: `${title} situation`,
    occurredAt: null,
    memoryClarity: "clear",
    bodyCues: [],
    emotions: [],
    thoughts: [],
    behaviors: [],
    consequences: {
      selfShortTerm: [],
      selfLongTerm: [],
      othersShortTerm: [],
      othersLongTerm: []
    },
    reflection: "",
    hypothesis: "",
    hypothesisFit: "not_reviewed",
    hypothesisCorrection: "",
    interpretationConsent: false,
    linkedValueIds: [],
    linkedPatternIds: [],
    linkedBehaviorIds: [],
    linkedBeliefIds: [],
    linkedModeIds: [],
    linkedGoalIds: [],
    linkedProjectIds: [],
    linkedTaskIds: [],
    linkedStrategyIds: [],
    schemaLinks: [],
    modeTimeline: [],
    nextMoves: [],
    revision: 1,
    userId: "user_operator",
    user: null,
    createdAt: "2026-07-15T08:00:00.000Z",
    updatedAt: "2026-07-15T08:00:00.000Z"
  };
}

async function openFlow() {
  fireEvent.click(await screen.findByRole("button", { name: "Reflect" }));
  await screen.findByText("What happened, as best as you remember it?");
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: "(max-width: 1023px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn()
    }))
  });
  window.localStorage.clear();
  listPsycheValuesMock.mockResolvedValue({ values: [] });
  listBehaviorPatternsMock.mockResolvedValue({
    patterns: [
      {
        id: "pattern-1",
        title: "Withdrawal loop",
        description: "Pulling away after uncertainty.",
        targetBehavior: "Withdrawal",
        preferredResponse: "Ask directly",
        user: null
      }
    ]
  });
  listEventTypesMock.mockResolvedValue({ eventTypes: [] });
  listTriggerReportsMock.mockResolvedValue({
    reports: [],
    total: 0,
    limit: 25,
    nextCursor: null,
    hasMore: false
  });
  createTriggerReportMock.mockResolvedValue({ report: { id: "report-new" } });
  useForgeShellMock.mockReturnValue({
    selectedUserIds: ["user_operator"],
    snapshot: {
      users: [],
      goals: [],
      tasks: [],
      dashboard: { projects: [], notesSummaryByEntity: {} }
    }
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("Psyche trigger report guided flow", () => {
  it("opens an exact linked vocabulary record from a report", async () => {
    listEventTypesMock.mockResolvedValue({
      eventTypes: [
        {
          id: "event_type_1",
          label: "Difficult conversation",
          description: "A conversation where connection became uncertain.",
          system: false,
          userId: "user_operator",
          user: null
        }
      ]
    });

    renderPage(
      "/psyche/reports?vocabulary=event_type&focusVocabulary=event_type_1"
    );

    expect(
      await screen.findByRole("button", { name: /Difficult conversation/ })
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("renders reports without waiting for supporting link catalogs", async () => {
    listPsycheValuesMock.mockReturnValueOnce(new Promise(() => undefined));
    listTriggerReportsMock.mockResolvedValueOnce({
      reports: [buildReport("report-1", "A difficult wait")],
      total: 1,
      limit: 25,
      nextCursor: null,
      hasMore: false
    });

    renderPage();

    expect(await screen.findByText("A difficult wait")).toBeInTheDocument();
    expect(screen.queryByText("Loading reports")).not.toBeInTheDocument();
    expect(listPsycheValuesMock).not.toHaveBeenCalled();
  });

  it("appends the next keyset page while preserving earlier reports", async () => {
    listTriggerReportsMock
      .mockResolvedValueOnce({
        reports: [buildReport("report-1", "First episode")],
        total: 2,
        limit: 1,
        nextCursor: "cursor-1",
        hasMore: true
      })
      .mockResolvedValueOnce({
        reports: [buildReport("report-2", "Second episode")],
        total: 2,
        limit: 1,
        nextCursor: null,
        hasMore: false
      });

    renderPage();
    expect(await screen.findByText("First episode")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Load more reports" }));

    expect(await screen.findByText("Second episode")).toBeInTheDocument();
    expect(screen.getByText("First episode")).toBeInTheDocument();
    expect(listTriggerReportsMock).toHaveBeenNthCalledWith(
      2,
      ["user_operator"],
      { limit: 25, cursor: "cursor-1" }
    );
  });

  it("saves an incomplete memory as a sparse draft without browser persistence", async () => {
    renderPage();
    await openFlow();

    expect(
      screen.getByRole("button", { name: "Save draft and pause" })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /^Not recorded/ })
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /^Partial/ }));
    fireEvent.change(screen.getByLabelText("The concrete moment"), {
      target: {
        value: "I remember the message, but not what happened just before it."
      }
    });
    expect(
      screen.getByRole("button", { name: "Save draft and pause" })
    ).toBeEnabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Save draft and pause" })
    );

    await waitFor(() =>
      expect(createTriggerReportMock).toHaveBeenCalledTimes(1)
    );
    const [input, options] = createTriggerReportMock.mock.calls[0];
    expect(input).toMatchObject({
      status: "draft",
      memoryClarity: "partial",
      eventSituation:
        "I remember the message, but not what happened just before it.",
      bodyCues: [],
      interpretationConsent: false,
      hypothesis: ""
    });
    expect(input.title).toMatch(/I remember the message/);
    expect(options.idempotencyKey).toEqual(expect.any(String));
    expect(
      Object.keys(window.localStorage).some((key) =>
        key.includes("psyche.report")
      )
    ).toBe(false);
  });

  it("keeps observation, user reflection, hypothesis consent, fit, and correction distinct", async () => {
    renderPage();
    await openFlow();

    fireEvent.change(screen.getByLabelText("The concrete moment"), {
      target: { value: "They stopped replying after I asked for clarity." }
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    fireEvent.click(
      await screen.findByRole("button", { name: "Add Body cues" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Add emotion" }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    fireEvent.click(await screen.findByRole("button", { name: "Add thought" }));
    fireEvent.click(screen.getByRole("button", { name: "Add behavior" }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    fireEvent.change(await screen.findByLabelText("Your reflection"), {
      target: {
        value: "The uncertainty felt more painful than the delay itself."
      }
    });
    const interpretationSwitch = screen.getByRole("switch", {
      name: /include a tentative interpretation/i
    });
    fireEvent.click(interpretationSwitch);
    expect(interpretationSwitch).toHaveAttribute("aria-checked", "true");
    fireEvent.change(await screen.findByLabelText(/Tentative hypothesis/), {
      target: {
        value:
          "One possibility is that withdrawal tried to prevent another explicit rejection."
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "It partly fits" }));
    fireEvent.change(screen.getByLabelText("Your correction"), {
      target: {
        value: "It was also anger about being left without information."
      }
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(await screen.findByRole("button", { name: /continue/i }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Create report" })
    );

    await waitFor(() =>
      expect(createTriggerReportMock).toHaveBeenCalledTimes(1)
    );
    expect(createTriggerReportMock.mock.calls[0][0]).toMatchObject({
      eventSituation: "They stopped replying after I asked for clarity.",
      bodyCues: ["Body cues entered"],
      reflection: "The uncertainty felt more painful than the delay itself.",
      interpretationConsent: true,
      hypothesis:
        "One possibility is that withdrawal tried to prevent another explicit rejection.",
      hypothesisFit: "partly_fits",
      hypothesisCorrection:
        "It was also anger about being left without information."
    });
  });

  it("adds a pattern link through the guided create flow", async () => {
    renderPage();
    await openFlow();

    fireEvent.change(screen.getByLabelText("The concrete moment"), {
      target: { value: "I withdrew after a difficult message." }
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(await screen.findByRole("button", { name: /continue/i }));
    fireEvent.click(await screen.findByRole("button", { name: /continue/i }));
    fireEvent.click(await screen.findByRole("button", { name: /continue/i }));

    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: "Search linked patterns…" },
        { timeout: 3_000 }
      )
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Create report" })
    );

    await waitFor(() =>
      expect(createTriggerReportMock).toHaveBeenCalledTimes(1)
    );
    expect(createTriggerReportMock.mock.calls[0][0]).toMatchObject({
      linkedPatternIds: ["pattern-1"],
      memoryClarity: "unspecified"
    });
  });
});
