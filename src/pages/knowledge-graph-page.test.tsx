import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { KnowledgeGraphPage } from "@/pages/knowledge-graph-page";
import type {
  KnowledgeGraphNode,
  KnowledgeGraphPayload
} from "@/lib/knowledge-graph-types";
import type { ForgeSnapshot } from "@/lib/types";

const {
  getKnowledgeGraphMock,
  useForgeShellMock,
  useAppDispatchMock,
  useAppSelectorMock,
  dispatchMock,
  forceViewModeMock
} = vi.hoisted(() => ({
  getKnowledgeGraphMock: vi.fn(),
  useForgeShellMock: vi.fn(),
  dispatchMock: vi.fn(),
  useAppDispatchMock: vi.fn(),
  useAppSelectorMock: vi.fn(),
  forceViewModeMock: {
    current: "render" as "render" | "throw"
  }
}));

vi.mock("@/lib/api", () => ({
  getKnowledgeGraph: getKnowledgeGraphMock
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

vi.mock("@/store/typed-hooks", () => ({
  useAppDispatch: useAppDispatchMock,
  useAppSelector: useAppSelectorMock
}));

vi.mock("@/components/psyche/entity-link-multiselect", () => ({
  EntityLinkMultiSelect: ({
    options = [],
    selectedValues = [],
    onChange,
    placeholder
  }: {
    options?: Array<{ value: string; label: string }>;
    selectedValues?: string[];
    onChange: (values: string[]) => void;
    placeholder?: string;
  }) => (
    <div>
      <input placeholder={placeholder} readOnly value="" />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange([...selectedValues, option.value])}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({
    title,
    description,
    badge,
    actions
  }: {
    title: string;
    description: string;
    badge?: string;
    actions?: ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      <div>{description}</div>
      {badge ? <div>{badge}</div> : null}
      {actions}
    </div>
  )
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: ComponentProps<"div">) => (
      <div {...props}>{children}</div>
    )
  }
}));

vi.mock("@/components/knowledge-graph/knowledge-graph-force-view", () => ({
  KnowledgeGraphForceView: ({
    nodes,
    focusNodeId,
    physicsSettings,
    onSelectNode
  }: {
    nodes: KnowledgeGraphNode[];
    focusNodeId: string | null;
    physicsSettings: {
      focusRepulsion: number;
      focusDiffusion: number;
    };
    onSelectNode: (node: KnowledgeGraphNode | null) => void;
  }) => {
    if (forceViewModeMock.current === "throw") {
      throw new Error("Renderer exploded");
    }
    return (
      <div aria-label="Knowledge graph canvas">
        <div>{`nodes:${nodes.length}`}</div>
        <div>{focusNodeId ? `focus:${focusNodeId}` : "focus:none"}</div>
        <div>{`physics:${physicsSettings.focusRepulsion.toFixed(2)}:${physicsSettings.focusDiffusion.toFixed(2)}`}</div>
        <button type="button" onClick={() => onSelectNode(nodes[0] ?? null)}>
          Focus first node
        </button>
        <button type="button" onClick={() => onSelectNode(nodes[1] ?? null)}>
          Focus second node
        </button>
        <button type="button" onClick={() => onSelectNode(null)}>
          Clear focused node
        </button>
      </div>
    );
  }
}));

vi.mock("@/components/knowledge-graph/knowledge-graph-hierarchy-view", () => ({
  KnowledgeGraphHierarchyView: () => <div>Hierarchy view</div>
}));

vi.mock("@/components/knowledge-graph/knowledge-graph-focus-drawer", () => ({
  KnowledgeGraphFocusDrawer: ({
    focus,
    onClose
  }: {
    focus: { focusNode: KnowledgeGraphNode | null };
    onClose?: () => void;
  }) => (
    <div>
      <div>{`Focus drawer: ${focus.focusNode?.title ?? "empty"}`}</div>
      <button type="button" onClick={onClose}>
        Close focus drawer
      </button>
    </div>
  )
}));

vi.mock("@/components/knowledge-graph/knowledge-graph-entity-panel", () => ({
  KnowledgeGraphEntityPanel: ({
    focus
  }: {
    focus: { focusNode: KnowledgeGraphNode | null };
  }) => <div>{`Entity panel: ${focus.focusNode?.title ?? "empty"}`}</div>
}));

vi.mock("@/components/experience/sheet-scaffold", () => ({
  SheetScaffold: ({
    open,
    children
  }: {
    open: boolean;
    children: ReactNode;
  }) => (open ? <div data-testid="mobile-sheet">{children}</div> : null)
}));

const graphFixture: KnowledgeGraphPayload = {
  generatedAt: "2026-04-12T12:00:00.000Z",
  nodes: [
    {
      id: "goal:goal-1",
      entityType: "goal",
      entityId: "goal-1",
      entityKind: "goal",
      title: "North Star",
      subtitle: "Top goal",
      description: "Primary direction",
      href: "/goals/goal-1",
      graphHref: "/knowledge-graph?focus=goal%3Agoal-1",
      iconName: "Target",
      accentToken: "--forge-entity-goal-rgb",
      size: 56,
      importance: 90,
      previewStats: [],
      owner: {
        userId: "user_operator",
        displayName: "Operator",
        accentColor: "#99f6e4",
        kind: "human"
      },
      tags: [{ id: "tag-vision", label: "Vision" }],
      updatedAt: "2026-04-12T10:00:00.000Z",
      graphStats: {
        degree: 1,
        structuralDegree: 1,
        contextualDegree: 0,
        taxonomyDegree: 0,
        workspaceDegree: 0
      }
    },
    {
      id: "project:project-1",
      entityType: "project",
      entityId: "project-1",
      entityKind: "project",
      title: "Execution Layer",
      subtitle: "Supports goal",
      description: "Project attached to the goal",
      href: "/projects/project-1",
      graphHref: "/knowledge-graph?focus=project%3Aproject-1",
      iconName: "FolderOpen",
      accentToken: "--forge-entity-project-rgb",
      size: 48,
      importance: 72,
      previewStats: [],
      owner: {
        userId: "user_operator",
        displayName: "Operator",
        accentColor: "#99f6e4",
        kind: "human"
      },
      tags: [{ id: "tag-vision", label: "Vision" }],
      updatedAt: "2026-04-12T11:00:00.000Z",
      graphStats: {
        degree: 1,
        structuralDegree: 1,
        contextualDegree: 0,
        taxonomyDegree: 0,
        workspaceDegree: 0
      }
    }
  ],
  edges: [
    {
      id: "goal-project",
      source: "goal:goal-1",
      target: "project:project-1",
      relationKind: "goal_project",
      family: "structural",
      label: "Supports goal",
      strength: 0.9,
      directional: true,
      structural: true
    }
  ],
  facets: {
    entityKinds: [
      { value: "goal", label: "Goal", count: 1 },
      { value: "project", label: "Project", count: 1 }
    ],
    relationKinds: [
      { value: "goal_project", label: "Goal → Project", count: 1 }
    ],
    tags: [{ id: "tag-vision", label: "Vision", count: 2 }],
    owners: [
      {
        userId: "user_operator",
        displayName: "Operator",
        accentColor: "#99f6e4",
        kind: "human",
        count: 2
      }
    ],
    updatedAt: {
      min: "2026-04-12T10:00:00.000Z",
      max: "2026-04-12T11:00:00.000Z"
    }
  },
  counts: {
    nodeCount: 2,
    edgeCount: 1,
    totalNodeCount: 2,
    totalEdgeCount: 1,
    filteredNodeCount: 2,
    filteredEdgeCount: 1,
    kinds: {
      goal: 1,
      project: 1
    },
    relationKinds: {
      goal_project: 1
    },
    limited: false
  }
};

function createSnapshot(): ForgeSnapshot {
  return {
    meta: {
      apiVersion: "v1",
      transport: "rest+sse",
      generatedAt: "2026-04-12T12:00:00.000Z",
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
      habits: [],
      tags: [],
      suggestedTags: [],
      owners: [],
      executionBuckets: [],
      notesSummaryByEntity: {},
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
      generatedAt: "2026-04-12T12:00:00.000Z",
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
      dueHabits: [],
      recentEvidence: [],
      achievements: [],
      domainBalance: [],
      neglectedGoals: []
    },
    today: {
      generatedAt: "2026-04-12T12:00:00.000Z",
      directive: {
        task: null,
        goalTitle: null,
        rewardXp: 0,
        sessionLabel: "No directive"
      },
      timeline: [],
      dueHabits: [],
      dailyQuests: [],
      milestoneRewards: [],
      recentHabitRewards: [],
      momentum: {
        streakDays: 0,
        momentumScore: 0,
        recoveryHint: ""
      }
    },
    risk: {
      generatedAt: "2026-04-12T12:00:00.000Z",
      overdueTasks: [],
      blockedTasks: [],
      neglectedGoals: [],
      summary: ""
    },
    users: [
      {
        id: "user_operator",
        displayName: "Operator",
        kind: "human",
        accentColor: "#99f6e4",
        handle: "operator",
        description: "",
        createdAt: "2026-04-12T12:00:00.000Z",
        updatedAt: "2026-04-12T12:00:00.000Z"
      }
    ],
    strategies: [],
    userScope: {
      selectedUserIds: ["user_operator"],
      selectedUsers: []
    },
    goals: [],
    projects: [],
    tags: [],
    tasks: [],
    habits: [],
    activity: [],
    activeTaskRuns: []
  };
}

function renderPage(initialEntry = "/knowledge-graph") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/knowledge-graph" element={<KnowledgeGraphPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("KnowledgeGraphPage", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: "(max-width: 1023px)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });
    forceViewModeMock.current = "render";
    dispatchMock.mockReset();
    useAppDispatchMock.mockReturnValue(dispatchMock);
    useAppSelectorMock.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        shell: {
          knowledgeGraphOverlayFocus: null
        },
        knowledgeGraphDiagnostics: {
          panelOpen: false,
          latestStatus: null,
          recentEvents: [],
          recentSnapshots: []
        }
      })
    );
    getKnowledgeGraphMock.mockResolvedValue(graphFixture);
    useForgeShellMock.mockReturnValue({
      selectedUserIds: ["user_operator"],
      snapshot: createSnapshot()
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
    delete window.__FORGE_ENABLE_GRAPH_DIAGNOSTICS__;
    delete window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__;
  });

  it("builds the graph query from route params", async () => {
    renderPage(
      "/knowledge-graph?q=North%20Star&entityKind=goal&relationKind=goal_project&tag=tag-vision&owner=user_operator&updatedFrom=2026-04-01&updatedTo=2026-04-12&limit=120&focus=goal%3Agoal-1"
    );

    await waitFor(() =>
      expect(getKnowledgeGraphMock).toHaveBeenCalledWith(["user_operator"], {
        q: "North Star",
        entityKinds: ["goal"],
        relationKinds: ["goal_project"],
        tags: ["tag-vision"],
        owners: ["user_operator"],
        updatedFrom: "2026-04-01",
        updatedTo: "2026-04-12",
        limit: 120,
        focusNodeId: null
      })
    );
    await waitFor(() =>
      expect(
        screen.queryByText("Loading the Forge world model")
      ).not.toBeInTheDocument()
    );
    expect(
      screen.getByPlaceholderText(
        "Type a graph search, then press Enter or the search button"
      )
    ).toBeInTheDocument();
  });

  it("records the resolved graph diagnostics event only once per stable query result", async () => {
    useAppSelectorMock.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        shell: {
          knowledgeGraphOverlayFocus: null
        },
        knowledgeGraphDiagnostics: {
          panelOpen: true,
          latestStatus: null,
          recentEvents: [],
          recentSnapshots: []
        }
      })
    );
    const groupSpy = vi
      .spyOn(console, "groupCollapsed")
      .mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const endSpy = vi.spyOn(console, "groupEnd").mockImplementation(() => {});

    renderPage("/knowledge-graph?q=North%20Star&entityKind=goal&limit=120");

    await waitFor(() =>
      expect(
        groupSpy.mock.calls.filter(([label]) =>
          String(label).includes("graph_query_resolved")
        )
      ).toHaveLength(1)
    );

    groupSpy.mockRestore();
    infoSpy.mockRestore();
    logSpy.mockRestore();
    endSpy.mockRestore();
  });

  it("updates free text, entity filters, and max nodes through the graph controls", async () => {
    renderPage();
    await waitFor(() =>
      expect(
        screen.queryByText("Loading the Forge world model")
      ).not.toBeInTheDocument()
    );

    const searchInput = screen.getByPlaceholderText(
      "Type a graph search, then press Enter or the search button"
    );
    fireEvent.click(screen.getByRole("button", { name: /Advanced/i }));
    const entityFilterInput = screen.getByPlaceholderText("Filter by entity type");
    fireEvent.focus(entityFilterInput);
    expect(screen.getByRole("button", { name: /^Wiki Page$/i })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /^Goal$/i }));
    await waitFor(() =>
      expect(getKnowledgeGraphMock).toHaveBeenLastCalledWith(["user_operator"], {
        q: null,
        entityKinds: ["goal"],
        relationKinds: [],
        tags: [],
        owners: [],
        updatedFrom: null,
        updatedTo: null,
        limit: 2000,
        focusNodeId: null
      })
    );

    const callsBeforeTyping = getKnowledgeGraphMock.mock.calls.length;
    fireEvent.change(searchInput, { target: { value: "North Star" } });
    expect(getKnowledgeGraphMock).toHaveBeenCalledTimes(callsBeforeTyping);
    fireEvent.keyDown(searchInput, { key: "Enter" });

    await waitFor(() =>
      expect(getKnowledgeGraphMock).toHaveBeenLastCalledWith(["user_operator"], {
        q: "North Star",
        entityKinds: ["goal"],
        relationKinds: [],
        tags: [],
        owners: [],
        updatedFrom: null,
        updatedTo: null,
        limit: 2000,
        focusNodeId: null
      })
    );

    fireEvent.change(screen.getByRole("slider"), { target: { value: "80" } });

    await waitFor(() =>
      expect(getKnowledgeGraphMock).toHaveBeenLastCalledWith(["user_operator"], {
        q: "North Star",
        entityKinds: ["goal"],
        relationKinds: [],
        tags: [],
        owners: [],
        updatedFrom: null,
        updatedTo: null,
        limit: 80,
        focusNodeId: null
      })
    );
  });

  it("opens the graph appearance dialog and pushes physics slider changes into the graph view", async () => {
    renderPage();
    await waitFor(() =>
      expect(
        screen.queryByText("Loading the Forge world model")
      ).not.toBeInTheDocument()
    );

    expect(screen.getByText("physics:2.25:1.95")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: /open graph appearance settings/i
      })
    );

    expect(
      await screen.findByText("Tune the focus field")
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Focused repulsion"), {
      target: { value: "3.10" }
    });
    fireEvent.change(screen.getByLabelText("Focus diffusion"), {
      target: { value: "2.60" }
    });

    await waitFor(() =>
      expect(screen.getByText("physics:3.10:2.60")).toBeInTheDocument()
    );
  });

  it("opens the dev diagnostics panel from Redux-backed state in dev mode", async () => {
    useAppSelectorMock.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        shell: {
          knowledgeGraphOverlayFocus: null
        },
        knowledgeGraphDiagnostics: {
          panelOpen: true,
          latestStatus: {
            datasetSignature: "graph-a",
            route: "/knowledge-graph",
            rendererMode: "sigma",
            startupPhase: "startup_verified",
            startupInvariantSatisfied: true,
            visibleNodeCount: 2,
            focusedNodeId: null,
            primaryFocusedNodeId: null,
            graphCentroid: { x: 0, y: 0 },
            boundsCenter: { x: 0, y: 0 },
            camera: { x: 0, y: 0, ratio: 1, angle: 0 },
            cameraTarget: null,
            driftMetrics: {
              centroidDistanceFromOrigin: 0,
              boundsCenterDistanceFromOrigin: 0,
              cameraDistanceFromOrigin: 0,
              cameraToCentroidDistance: 0
            },
            latestSnapshotAt: "2026-04-12T14:00:05.000Z",
            lastVerifiedAt: "2026-04-12T14:00:06.000Z"
          },
          recentEvents: [
            {
              id: "event-1",
              createdAt: "2026-04-12T14:00:01.000Z",
              level: "info",
              eventKey: "startup_verified",
              message: "Startup verified",
              route: "/knowledge-graph",
              details: {}
            }
          ],
          recentSnapshots: [
            {
              id: "snapshot-1",
              capturedAt: "2026-04-12T14:00:05.000Z",
              datasetSignature: "graph-a",
              route: "/knowledge-graph",
              rendererMode: "sigma",
              startupPhase: "startup_verified",
              startupInvariantSatisfied: true,
              focusedNodeId: null,
              primaryFocusedNodeId: null,
              graphCentroid: { x: 0, y: 0 },
              boundsCenter: { x: 0, y: 0 },
              camera: { x: 0, y: 0, ratio: 1, angle: 0 },
              cameraTarget: null,
              driftMetrics: {
                centroidDistanceFromOrigin: 0,
                boundsCenterDistanceFromOrigin: 0,
                cameraDistanceFromOrigin: 0,
                cameraToCentroidDistance: 0
              },
              nodeCount: 2,
              viewportSize: {
                width: 1280,
                height: 720
              },
              nodePositions: [
                { id: "goal:goal-1", x: -1, y: 0.5 },
                { id: "project:project-1", x: 1, y: -0.5 }
              ]
            }
          ]
        }
      })
    );

    renderPage();
    await waitFor(() =>
      expect(
        screen.queryByText("Loading the Forge world model")
      ).not.toBeInTheDocument()
    );

    expect(
      screen.getByText("Knowledge Graph truth surface")
    ).toBeInTheDocument();
    expect(screen.getAllByText("startup_verified").length).toBeGreaterThan(0);
    expect(screen.getByText("Startup verified")).toBeInTheDocument();
  });

  it("restores saved graph physics settings from local storage", async () => {
    window.localStorage.setItem(
      "forge.knowledge-graph.physics",
      JSON.stringify({
        focusRepulsion: 2.9,
        focusDiffusion: 2.4
      })
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("physics:2.90:2.40")).toBeInTheDocument()
    );
  });

  it("publishes desktop focus details through the shell store instead of a local drawer", async () => {
    renderPage();
    await waitFor(() =>
      expect(
        screen.queryByText("Loading the Forge world model")
      ).not.toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: "Focus first node" }));
    await waitFor(() =>
      expect(dispatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "shell/setKnowledgeGraphOverlayFocus",
          payload: expect.objectContaining({
            focusNode: expect.objectContaining({
              id: "goal:goal-1"
            })
          })
        })
      )
    );
  });

  it("keeps the mobile graph visible on first tap and opens the sheet on the second tap", async () => {
    vi.mocked(window.matchMedia).mockImplementation(() => ({
      matches: true,
      media: "(max-width: 1023px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }));

    renderPage();
    await waitFor(() =>
      expect(
        screen.queryByText("Loading the Forge world model")
      ).not.toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: "Focus first node" }));
    expect(screen.getByText("focus:goal:goal-1")).toBeInTheDocument();
    expect(screen.queryByTestId("mobile-sheet")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("knowledge-graph-desktop-toolbar")
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open graph filters" })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Focus first node" }));
    expect(await screen.findByTestId("mobile-sheet")).toBeInTheDocument();
    expect(screen.getByText("Entity panel: North Star")).toBeInTheDocument();
  });

  it("exposes a page diagnostics activation hook that reopens the focused mobile sheet", async () => {
    window.__FORGE_ENABLE_GRAPH_DIAGNOSTICS__ = true;
    vi.mocked(window.matchMedia).mockImplementation(() => ({
      matches: true,
      media: "(max-width: 1023px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }));

    renderPage();
    await waitFor(() =>
      expect(
        screen.queryByText("Loading the Forge world model")
      ).not.toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: "Focus first node" }));
    expect(screen.queryByTestId("mobile-sheet")).not.toBeInTheDocument();

    await waitFor(() =>
      expect(
        window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.activateFocusedNode
      ).toBeTypeOf("function")
    );

    window.__FORGE_KNOWLEDGE_GRAPH_PAGE_TEST__?.activateFocusedNode?.();
    expect(await screen.findByTestId("mobile-sheet")).toBeInTheDocument();
  });

  it("retargets mobile focus without opening the sheet when a different node is tapped", async () => {
    vi.mocked(window.matchMedia).mockImplementation(() => ({
      matches: true,
      media: "(max-width: 1023px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }));

    renderPage();
    await waitFor(() =>
      expect(
        screen.queryByText("Loading the Forge world model")
      ).not.toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: "Focus first node" }));
    fireEvent.click(screen.getByRole("button", { name: "Focus second node" }));

    expect(screen.getByText("focus:project:project-1")).toBeInTheDocument();
    expect(screen.queryByTestId("mobile-sheet")).not.toBeInTheDocument();
  });

  it("does not refetch the graph dataset when focus changes", async () => {
    renderPage();
    await waitFor(() =>
      expect(
        screen.queryByText("Loading the Forge world model")
      ).not.toBeInTheDocument()
    );

    expect(getKnowledgeGraphMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Focus first node" }));
    await waitFor(() =>
      expect(screen.getByText("focus:goal:goal-1")).toBeInTheDocument()
    );
    expect(getKnowledgeGraphMock).toHaveBeenCalledTimes(1);
  });

  it("shows a sturdy fallback when the graph renderer throws", async () => {
    forceViewModeMock.current = "throw";
    renderPage();

    expect(
      await screen.findByText("The graph renderer hit a display error.")
    ).toBeInTheDocument();
    expect(screen.getByText("Renderer exploded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open hierarchy/i })).toBeInTheDocument();
  });
});
