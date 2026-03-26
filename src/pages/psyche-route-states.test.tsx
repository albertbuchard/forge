import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { PsycheModeGuidePage } from "@/pages/psyche-mode-guide-page";
import { PsycheModesPage } from "@/pages/psyche-modes-page";
import { PsycheReportsPage } from "@/pages/psyche-reports-page";
import { PsycheSchemasBeliefsPage } from "@/pages/psyche-schemas-beliefs-page";
import { PsycheValuesPage } from "@/pages/psyche-values-page";
import type { ForgeSnapshot } from "@/lib/types";

const { useForgeShellMock, useQueryMock } = vi.hoisted(() => ({
  useForgeShellMock: vi.fn(),
  useQueryMock: vi.fn()
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: useQueryMock
  };
});

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({ title, description, badge }: { title: string; description: string; badge?: string }) => (
    <div>
      <div>{title}</div>
      <div>{description}</div>
      {badge ? <div>{badge}</div> : null}
    </div>
  )
}));

vi.mock("@/components/psyche/psyche-section-nav", () => ({
  PsycheSectionNav: () => <div>Psyche section nav</div>
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function createSnapshot(): ForgeSnapshot {
  return {
    meta: {
      apiVersion: "v1",
      transport: "rest+sse",
      generatedAt: "2026-03-24T08:00:00.000Z",
      backend: "node",
      mode: "transitional-node"
    },
    metrics: {
      totalXp: 0,
      level: 1,
      currentLevelXp: 0,
      nextLevelXp: 100,
      weeklyXp: 0,
      streakDays: 0,
      comboMultiplier: 1,
      momentumScore: 0,
      topGoalId: null,
      topGoalTitle: null
    },
    dashboard: {
      stats: {
        totalPoints: 0,
        completedThisWeek: 0,
        activeGoals: 0,
        alignmentScore: 0,
        focusTasks: 0,
        overdueTasks: 0,
        dueThisWeek: 0
      },
      goals: [],
      projects: [],
      tasks: [],
      tags: [],
      suggestedTags: [],
      owners: [],
      executionBuckets: [],
      gamification: {
        totalXp: 0,
        level: 1,
        currentLevelXp: 0,
        nextLevelXp: 100,
        weeklyXp: 0,
        streakDays: 0,
        comboMultiplier: 1,
        momentumScore: 0,
        topGoalId: null,
        topGoalTitle: null
      },
      achievements: [],
      milestoneRewards: [],
      recentActivity: []
    },
    overview: {
      generatedAt: "2026-03-24T08:00:00.000Z",
      strategicHeader: {
        streakDays: 0,
        level: 1,
        totalXp: 0,
        currentLevelXp: 0,
        nextLevelXp: 100,
        momentumScore: 0,
        focusTasks: 0,
        overdueTasks: 0
      },
      projects: [],
      activeGoals: [],
      topTasks: [],
      recentEvidence: [],
      achievements: [],
      domainBalance: [],
      neglectedGoals: []
    },
    today: {
      generatedAt: "2026-03-24T08:00:00.000Z",
      directive: {
        task: null,
        goalTitle: null,
        rewardXp: 0,
        sessionLabel: "No directive"
      },
      timeline: [],
      dailyQuests: [],
      milestoneRewards: [],
      momentum: {
        streakDays: 0,
        momentumScore: 0,
        recoveryHint: ""
      }
    },
    risk: {
      generatedAt: "2026-03-24T08:00:00.000Z",
      overdueTasks: [],
      blockedTasks: [],
      neglectedGoals: [],
      summary: ""
    },
    goals: [],
    projects: [],
    tags: [],
    tasks: [],
    activity: [],
    activeTaskRuns: []
  };
}

function createQueryResult(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    error: null,
    isError: false,
    isLoading: false,
    isPending: false,
    refetch: vi.fn(),
    ...overrides
  };
}

function renderWithProviders(element: React.ReactNode, initialEntries: string[] = ["/"]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>{element}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("psyche route states", () => {
  it("shows a loading state for the values route", () => {
    useForgeShellMock.mockReturnValue({ snapshot: createSnapshot() });
    useQueryMock.mockReturnValue(createQueryResult({ isLoading: true, isPending: true }));

    renderWithProviders(<PsycheValuesPage />);

    expect(screen.getByText("Loading value constellation")).toBeInTheDocument();
  });

  it("shows a recoverable error state for the reports route", () => {
    useForgeShellMock.mockReturnValue({ snapshot: createSnapshot() });
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) =>
      options.queryKey?.[0] === "forge-psyche-reports"
        ? createQueryResult({ isError: true, error: new Error("reports failed") })
        : createQueryResult({ data: {} })
    );

    renderWithProviders(<PsycheReportsPage />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("reports failed")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("shows the shared empty state for the values route", () => {
    useForgeShellMock.mockReturnValue({ snapshot: createSnapshot() });
    useQueryMock.mockReturnValue(createQueryResult({ data: { values: [] } }));

    renderWithProviders(<PsycheValuesPage />);

    expect(screen.getAllByRole("button", { name: "Add value" }).length).toBeGreaterThan(0);
  });

  it("shows the shared empty state for the mode guide route", () => {
    useQueryMock.mockReturnValue(createQueryResult({ data: { sessions: [] } }));

    renderWithProviders(<PsycheModeGuidePage />);

    expect(screen.getByText("No guided sessions yet")).toBeInTheDocument();
    expect(screen.getByText("No stored guide history")).toBeInTheDocument();
  });

  it("teaches the mode flow with placeholders and inline help", async () => {
    useForgeShellMock.mockReturnValue({ snapshot: createSnapshot() });
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      switch (options.queryKey?.[0]) {
        case "forge-psyche-modes":
          return createQueryResult({ data: { modes: [] } });
        case "forge-psyche-patterns":
          return createQueryResult({ data: { patterns: [] } });
        case "forge-psyche-behaviors":
          return createQueryResult({ data: { behaviors: [] } });
        case "forge-psyche-values":
          return createQueryResult({ data: { values: [] } });
        default:
          return createQueryResult({ data: {} });
      }
    });

    renderWithProviders(<PsycheModesPage />, ["/psyche/modes?create=1"]);

    expect(screen.getByPlaceholderText("The Friday Vigil, The Scanner, The Good Son")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Detached protector, vulnerable child, demanding critic")).toBeInTheDocument();

    const familyHelp = screen.getByRole("button", { name: "Explain Mode family" });
    familyHelp.click();

    expect(screen.getByText(/bigger cluster this state belongs to/i)).toBeInTheDocument();
    expect(screen.getByTestId("question-flow-canvas")).toBeInTheDocument();
  });

  it("separates maladaptive and adaptive schemas on the beliefs route", () => {
    useForgeShellMock.mockReturnValue({ snapshot: createSnapshot() });
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      switch (options.queryKey?.[0]) {
        case "forge-psyche-schema-catalog":
          return createQueryResult({
            data: {
              schemas: [
                {
                  id: "schema_abandonment",
                  slug: "abandonment",
                  title: "Abandonment",
                  family: "disconnection_rejection",
                  schemaType: "maladaptive",
                  description: "Expectation that close connection will not stay available.",
                  createdAt: "2026-03-24T08:00:00.000Z",
                  updatedAt: "2026-03-24T08:00:00.000Z"
                },
                {
                  id: "schema_adaptive_stable_attachment",
                  slug: "stable_attachment",
                  title: "Stable Attachment",
                  family: "disconnection_rejection",
                  schemaType: "adaptive",
                  description: "The belief that close relationships are stable and enduring.",
                  createdAt: "2026-03-24T08:00:00.000Z",
                  updatedAt: "2026-03-24T08:00:00.000Z"
                }
              ]
            }
          });
        case "forge-psyche-beliefs":
          return createQueryResult({ data: { beliefs: [] } });
        case "forge-psyche-behaviors":
          return createQueryResult({ data: { behaviors: [] } });
        case "forge-psyche-modes":
          return createQueryResult({ data: { modes: [] } });
        case "forge-psyche-values":
          return createQueryResult({ data: { values: [] } });
        case "forge-psyche-reports":
          return createQueryResult({ data: { reports: [] } });
        default:
          return createQueryResult({ data: {} });
      }
    });

    renderWithProviders(<PsycheSchemasBeliefsPage />);

    expect(screen.getByText("Maladaptive schemas")).toBeInTheDocument();
    expect(screen.getByText("Adaptive schemas")).toBeInTheDocument();
    expect(screen.getByText("Stable Attachment")).toBeInTheDocument();
  });
});
