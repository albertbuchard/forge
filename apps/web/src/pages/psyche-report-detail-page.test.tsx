import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { PsycheReportDetailPage } from "@/pages/psyche-report-detail-page";
import type { TriggerReport } from "@/lib/psyche-types";

const {
  deleteTriggerReportMock,
  getTriggerReportMock,
  patchTriggerReportMock,
  useForgeShellMock
} = vi.hoisted(() => ({
  deleteTriggerReportMock: vi.fn(),
  getTriggerReportMock: vi.fn(),
  patchTriggerReportMock: vi.fn(),
  useForgeShellMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  createInsight: vi.fn(),
  deleteTriggerReport: deleteTriggerReportMock,
  getTriggerReport: getTriggerReportMock,
  listBehaviorPatterns: vi.fn().mockResolvedValue({
    patterns: [{ id: "pattern-2", title: "Updated pattern", user: null }]
  }),
  listBehaviors: vi.fn().mockResolvedValue({ behaviors: [] }),
  listBeliefs: vi.fn().mockResolvedValue({ beliefs: [] }),
  listEmotionDefinitions: vi.fn().mockResolvedValue({ emotions: [] }),
  listEventTypes: vi.fn().mockResolvedValue({ eventTypes: [] }),
  listModes: vi.fn().mockResolvedValue({ modes: [] }),
  listPsycheValues: vi.fn().mockResolvedValue({
    values: [{ id: "value-2", title: "Updated value", user: null }]
  }),
  listSchemaCatalog: vi.fn().mockResolvedValue({ schemas: [] }),
  patchTriggerReport: patchTriggerReportMock
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({ title, actions }: { title: ReactNode; actions?: ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  )
}));

vi.mock("@/components/psyche/psyche-section-nav", () => ({
  PsycheSectionNav: () => null
}));

vi.mock("@/components/knowledge-graph/open-in-graph-button", () => ({
  OpenInGraphButton: () => null
}));

vi.mock("@/components/notes/entity-notes-surface", () => ({
  EntityNotesSurface: () => null
}));

vi.mock("@/components/insights/insight-flow-dialog", () => ({
  InsightFlowDialog: () => null
}));

vi.mock("@/components/psyche/report-chain-fields", () => ({
  BehaviorRowsEditor: () => null,
  EmotionRowsEditor: () => null,
  ModeTimelineEditor: () => null,
  StringListEditor: () => null,
  ThoughtRowsEditor: () => null
}));

vi.mock("@/components/psyche/chain-canvas", () => ({
  ChainCanvas: ({
    stages,
    onStageChange,
    stageContent
  }: {
    stages: Array<{ id: string; label: string }>;
    onStageChange: (id: string) => void;
    stageContent: ReactNode;
  }) => (
    <section>
      <nav>
        {stages.map((stage) => (
          <button
            key={stage.id}
            type="button"
            onClick={() => onStageChange(stage.id)}
          >
            {stage.label}
          </button>
        ))}
      </nav>
      {stageContent}
    </section>
  )
}));

vi.mock("@/components/psyche/entity-link-multiselect", () => ({
  EntityLinkMultiSelect: ({
    placeholder,
    onChange
  }: {
    placeholder?: string;
    onChange: (values: string[]) => void;
  }) => {
    const value = placeholder?.includes("patterns")
      ? "pattern-2"
      : placeholder?.includes("values")
        ? "value-2"
        : placeholder?.includes("goals")
          ? "goal-2"
          : placeholder?.includes("projects")
            ? "project-2"
            : "task-2";
    return (
      <button
        type="button"
        aria-label={placeholder}
        onClick={() => onChange([value])}
      >
        Choose link
      </button>
    );
  }
}));

vi.mock("@/components/planning/planning-record-delete-dialog", () => ({
  PlanningRecordDeleteDialog: ({
    open,
    onConfirm
  }: {
    open: boolean;
    onConfirm: () => Promise<void>;
  }) =>
    open ? (
      <button type="button" onClick={() => void onConfirm()}>
        Move to bin
      </button>
    ) : null
}));

function buildReport(overrides: Partial<TriggerReport> = {}): TriggerReport {
  return {
    id: "report-1",
    domainId: "domain-1",
    title: "A difficult wait",
    status: "draft",
    eventTypeId: null,
    customEventType: "Difficult conversation",
    eventSituation: "They stopped replying after I asked for clarity.",
    occurredAt: null,
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
    linkedPatternIds: ["pattern-1"],
    linkedValueIds: ["value-1"],
    linkedGoalIds: ["goal-1"],
    linkedProjectIds: ["project-1"],
    linkedTaskIds: ["task-1"],
    linkedBehaviorIds: [],
    linkedBeliefIds: [],
    linkedModeIds: [],
    modeOverlays: [],
    schemaLinks: [],
    modeTimeline: [],
    nextMoves: [],
    memoryClarity: "unspecified",
    reflection: "",
    hypothesis: "",
    hypothesisFit: "not_reviewed",
    hypothesisCorrection: "",
    interpretationConsent: false,
    revision: 1,
    userId: "user_operator",
    user: null,
    createdAt: "2026-07-15T08:00:00.000Z",
    updatedAt: "2026-07-15T08:00:00.000Z",
    ...overrides
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/psyche/reports/report-1"]}>
        <Routes>
          <Route
            path="/psyche/reports/:reportId"
            element={<PsycheReportDetailPage />}
          />
          <Route path="/psyche/reports" element={<div>Reports list</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return queryClient;
}

beforeEach(() => {
  const report = buildReport();
  getTriggerReportMock.mockResolvedValue({
    report,
    notes: [],
    insights: []
  });
  patchTriggerReportMock.mockImplementation(
    async (_reportId: string, patch: Record<string, unknown>) => ({
      report: buildReport({
        revision: Number(patch.expectedRevision) + 1,
        title: String(patch.title),
        eventSituation: String(patch.eventSituation),
        linkedPatternIds: patch.linkedPatternIds as string[],
        linkedValueIds: patch.linkedValueIds as string[],
        linkedGoalIds: patch.linkedGoalIds as string[],
        linkedProjectIds: patch.linkedProjectIds as string[],
        linkedTaskIds: patch.linkedTaskIds as string[]
      })
    })
  );
  deleteTriggerReportMock.mockResolvedValue({ report });
  useForgeShellMock.mockReturnValue({
    selectedUserIds: ["user_operator"],
    snapshot: {
      goals: [{ id: "goal-2", title: "Goal", description: "", user: null }],
      projects: [
        { id: "project-2", title: "Project", description: "", user: null }
      ],
      tasks: [
        {
          id: "task-2",
          title: "Task",
          description: "",
          owner: "Albert",
          user: null
        }
      ]
    }
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Psyche trigger report detail flow", () => {
  it("updates pattern, value, goal, project, and task links", async () => {
    renderPage();
    expect(await screen.findByText("A difficult wait")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Lens" }));
    for (const name of [
      "Search linked patterns",
      "Search linked values",
      "Search linked goals",
      "Search linked projects",
      "Search linked tasks"
    ]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Pivot" }));
    fireEvent.click(screen.getByRole("button", { name: "Save chain" }));

    await waitFor(() =>
      expect(patchTriggerReportMock).toHaveBeenCalledTimes(1)
    );
    expect(patchTriggerReportMock.mock.calls[0][1]).toMatchObject({
      expectedRevision: 1,
      linkedPatternIds: ["pattern-2"],
      linkedValueIds: ["value-2"],
      linkedGoalIds: ["goal-2"],
      linkedProjectIds: ["project-2"],
      linkedTaskIds: ["task-2"],
      memoryClarity: "unspecified"
    });
  });

  it("rebases dirty edits only after an explicit conflict choice", async () => {
    const queryClient = renderPage();
    const title = await screen.findByLabelText("Title");
    fireEvent.change(title, { target: { value: "My unsaved title" } });

    act(() => {
      queryClient.setQueryData(["forge-psyche-report", "report-1"], {
        report: buildReport({
          title: "Server title",
          eventSituation: "The server has a newer situation.",
          revision: 2
        }),
        notes: [],
        insights: []
      });
    });

    expect(
      await screen.findByText("A newer version is available")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("My unsaved title");
    expect(
      screen.getByRole("button", { name: "Reload latest" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Keep my edits" })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Keep my edits" }));
    expect(screen.getByLabelText("Title")).toHaveValue("My unsaved title");
    expect(screen.getByLabelText("Situation")).toHaveValue(
      "The server has a newer situation."
    );

    fireEvent.click(screen.getByRole("button", { name: "Pivot" }));
    fireEvent.click(screen.getByRole("button", { name: "Save chain" }));
    await waitFor(() =>
      expect(patchTriggerReportMock).toHaveBeenCalledTimes(1)
    );
    expect(patchTriggerReportMock.mock.calls[0][1]).toMatchObject({
      expectedRevision: 2,
      title: "My unsaved title",
      eventSituation: "The server has a newer situation."
    });
  });

  it("invokes the established reversible delete flow", async () => {
    renderPage();
    expect(await screen.findByText("A difficult wait")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete report" }));
    fireEvent.click(screen.getByRole("button", { name: "Move to bin" }));

    await waitFor(() =>
      expect(deleteTriggerReportMock).toHaveBeenCalledWith("report-1")
    );
    expect(await screen.findByText("Reports list")).toBeInTheDocument();
  });
});
