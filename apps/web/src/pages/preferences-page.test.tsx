import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PreferenceCatalog,
  PreferenceItemScore,
  PreferenceWorkspacePayload,
  UserSummary
} from "@/lib/types";
import { ForgeApiError } from "@/lib/api-error";

const {
  deletePreferenceCatalogMock,
  getPreferenceCatalogsMock,
  getPreferenceCatalogItemsMock,
  getPreferenceWorkspaceMock,
  patchPreferenceItemMock,
  patchPreferenceScoreMock,
  patchPreferenceCatalogItemMock,
  refreshPreferenceWorkspaceMock,
  submitPreferenceSignalMock,
  ForgeApiErrorMock,
  useForgeShellMock
} = vi.hoisted(() => ({
  deletePreferenceCatalogMock: vi.fn(),
  getPreferenceCatalogsMock: vi.fn(),
  getPreferenceCatalogItemsMock: vi.fn(),
  getPreferenceWorkspaceMock: vi.fn(),
  patchPreferenceItemMock: vi.fn(),
  patchPreferenceScoreMock: vi.fn(),
  patchPreferenceCatalogItemMock: vi.fn(),
  refreshPreferenceWorkspaceMock: vi.fn(),
  submitPreferenceSignalMock: vi.fn(),
  ForgeApiErrorMock: class ForgeApiErrorMock extends Error {
    code: string;

    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
  useForgeShellMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  ForgeApiError: ForgeApiErrorMock,
  createPreferenceCatalog: vi.fn(),
  createPreferenceCatalogItem: vi.fn(),
  createPreferenceContext: vi.fn(),
  createPreferenceItem: vi.fn(),
  deletePreferenceCatalog: deletePreferenceCatalogMock,
  deletePreferenceCatalogItem: vi.fn(),
  enqueuePreferenceEntity: vi.fn(),
  getPreferenceCatalogs: getPreferenceCatalogsMock,
  getPreferenceCatalogItems: getPreferenceCatalogItemsMock,
  getPreferenceWorkspace: getPreferenceWorkspaceMock,
  mergePreferenceContexts: vi.fn(),
  patchPreferenceCatalog: vi.fn(),
  patchPreferenceCatalogItem: patchPreferenceCatalogItemMock,
  patchPreferenceContext: vi.fn(),
  patchPreferenceItem: patchPreferenceItemMock,
  patchPreferenceScore: patchPreferenceScoreMock,
  refreshPreferenceWorkspace: refreshPreferenceWorkspaceMock,
  searchEntities: vi.fn(),
  startPreferenceGame: vi.fn(),
  submitPairwisePreferenceJudgment: vi.fn(),
  submitPreferenceSignal: submitPreferenceSignalMock
}));

vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: useForgeShellMock
}));

vi.mock("@/components/shell/page-hero", () => ({
  PageHero: ({
    titleText,
    actions
  }: {
    titleText: string;
    actions?: ReactNode;
  }) => (
    <div>
      {titleText}
      {actions}
    </div>
  )
}));

vi.mock("@/components/psyche/psyche-section-nav", () => ({
  PsycheSectionNav: () => null
}));

vi.mock("@/components/psyche/use-psyche-focus-target", () => ({
  psycheFocusClass: () => "",
  usePsycheFocusTarget: () => undefined
}));

vi.mock("@/components/preferences/preference-game-dialog", () => ({
  PreferenceGameDialog: ({
    state,
    filteredCatalogs,
    catalogsLoading,
    onSelectDomain
  }: {
    state: { open: boolean; phase: string };
    filteredCatalogs: Array<{ title: string }>;
    catalogsLoading: boolean;
    onSelectDomain: (domain: "food") => void;
  }) =>
    state.open ? (
      <div data-testid="preference-game-dialog">
        <div>Game phase: {state.phase}</div>
        <div>
          Game catalogs:{" "}
          {filteredCatalogs.map((catalog) => catalog.title).join(", ")}
        </div>
        <div>Game catalogs loading: {String(catalogsLoading)}</div>
        <button type="button" onClick={() => onSelectDomain("food")}>
          Choose food concepts
        </button>
      </div>
    ) : null
}));

vi.mock("@/components/preferences/preference-guided-flow-dialog", () => ({
  PreferenceGuidedFlowDialog: ({
    flow,
    pending,
    onSubmit
  }: {
    flow: {
      kind: string;
      catalog?: { id: string };
      item?: { id: string };
      score?: PreferenceItemScore;
    } | null;
    pending: boolean;
    onSubmit: (input: Record<string, unknown>) => Promise<void>;
  }) =>
    flow ? (
      <div>
        guided:{flow.kind}
        {flow.catalog ? `:${flow.catalog.id}` : ""}
        {flow.kind === "catalog-item" && flow.catalog ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              void onSubmit({
                kind: "catalog-item",
                catalogId: flow.catalog?.id,
                catalogItemId: flow.item?.id,
                label: "Updated concept",
                description: "Updated description",
                tags: []
              })
            }
          >
            Save guided concept
          </button>
        ) : null}
        {flow.kind === "signal" && flow.score ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              void onSubmit({
                kind: "signal",
                itemId: flow.score?.itemId,
                signalType: "veto",
                strength: 1
              })
            }
          >
            Apply guided veto
          </button>
        ) : null}
      </div>
    ) : null
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
        Confirm archive
      </button>
    ) : null
}));

import { PreferencesPage } from "./preferences-page";

const user = {
  id: "user_1",
  kind: "human",
  handle: "albert",
  displayName: "Albert",
  description: "",
  accentColor: "#fff",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
} satisfies UserSummary;

function score(index: number): PreferenceItemScore {
  return {
    id: `score_${index}`,
    profileId: "profile_1",
    contextId: "context_1",
    itemId: `item_${index}`,
    latentScore: 0.1,
    confidence: 0.2,
    uncertainty: 0.8,
    evidenceCount: 0,
    pairwiseWins: 0,
    pairwiseLosses: 0,
    pairwiseTies: 0,
    signalCount: 0,
    effectiveSignal: null,
    conflictCount: 0,
    status: "uncertain",
    dominantDimensions: [],
    explanation: [],
    manualStatus: null,
    manualScore: null,
    confidenceLock: null,
    bookmarked: false,
    compareLater: false,
    frozen: false,
    lastInferredAt: "2026-01-01T00:00:00.000Z",
    lastJudgmentAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    item: {
      id: `item_${index}`,
      profileId: "profile_1",
      label: `Preference ${index}`,
      description: "",
      tags: [],
      featureWeights: {
        novelty: 0,
        simplicity: 0,
        rigor: 0,
        aesthetics: 0,
        depth: 0,
        structure: 0,
        familiarity: 0,
        surprise: 0
      },
      metadata: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  };
}

function workspace(): PreferenceWorkspacePayload {
  const scores = Array.from({ length: 50 }, (_, index) => score(index + 1));
  return {
    profile: {
      id: "profile_1",
      userId: user.id,
      domain: "projects",
      defaultContextId: "context_1",
      modelVersion: "pref-v1-bt-lite",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      user
    },
    selectedContext: {
      id: "context_1",
      profileId: "profile_1",
      name: "Default",
      description: "",
      shareMode: "shared",
      active: true,
      isDefault: true,
      decayDays: 90,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    contexts: [],
    catalogs: [],
    dimensions: [],
    scores,
    map: [],
    history: {
      judgments: [],
      signals: [],
      snapshots: [],
      staleItemIds: [],
      flippedItemIds: []
    },
    presentation: {
      itemLimit: 50,
      itemOffset: 0,
      totalItems: 55,
      returnedItems: 50,
      hasMore: true,
      nextOffset: 50,
      historyLimit: 50
    },
    evidenceCoverage: {
      judgmentLimitPerContext: 1000,
      totalJudgments: 0,
      consideredJudgments: 0,
      truncated: false,
      contexts: [
        {
          contextId: "context_1",
          totalJudgments: 0,
          consideredJudgments: 0,
          truncated: false
        }
      ]
    },
    compare: { nextPair: null, pendingCount: 55, candidateCount: 55 },
    summary: {
      totalItems: 55,
      likedCount: 0,
      dislikedCount: 0,
      uncertainCount: 55,
      bookmarkedCount: 0,
      vetoedCount: 0,
      averageConfidence: 0.2,
      pendingComparisons: 55
    },
    libraries: {
      totalCatalogs: 0,
      totalCatalogItems: 0,
      seededCatalogCount: 0,
      customCatalogCount: 0
    }
  };
}

function workspaceForSelection({
  owner = user,
  domain = "projects",
  contextId = "context_1",
  contextName = "Default",
  itemLabel = "Preference 1"
}: {
  owner?: UserSummary;
  domain?: PreferenceWorkspacePayload["profile"]["domain"];
  contextId?: string;
  contextName?: string;
  itemLabel?: string;
} = {}) {
  const payload = workspace();
  payload.profile = {
    ...payload.profile,
    id: `profile_${owner.id}_${domain}`,
    userId: owner.id,
    domain,
    defaultContextId: contextId,
    user: owner
  };
  payload.selectedContext = {
    ...payload.selectedContext,
    id: contextId,
    profileId: payload.profile.id,
    name: contextName
  };
  payload.contexts = [payload.selectedContext];
  payload.scores = payload.scores.map((entry, index) => ({
    ...entry,
    profileId: payload.profile.id,
    contextId,
    item:
      index === 0 && entry.item
        ? { ...entry.item, profileId: payload.profile.id, label: itemLabel }
        : entry.item
          ? { ...entry.item, profileId: payload.profile.id }
          : entry.item
  }));
  payload.evidenceCoverage.contexts = [
    {
      contextId,
      totalJudgments: 0,
      consideredJudgments: 0,
      truncated: false
    }
  ];
  return payload;
}

function renderPage(entry = "/preferences?domain=projects&tab=table") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/preferences" element={<PreferencesPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("PreferencesPage", () => {
  beforeEach(() => {
    cleanup();
    patchPreferenceCatalogItemMock.mockReset();
    patchPreferenceCatalogItemMock.mockResolvedValue({ item: null });
    patchPreferenceItemMock.mockReset();
    patchPreferenceItemMock.mockResolvedValue({ item: null });
    patchPreferenceScoreMock.mockReset();
    patchPreferenceScoreMock.mockResolvedValue({ workspace: workspace() });
    refreshPreferenceWorkspaceMock.mockReset();
    refreshPreferenceWorkspaceMock.mockResolvedValue({
      workspace: workspace()
    });
    submitPreferenceSignalMock.mockReset();
    submitPreferenceSignalMock.mockImplementation(async (input) => ({
      signal: {
        id: "signal_veto",
        profileId: "profile_1",
        contextId: input.contextId,
        userId: input.userId,
        ownerUserId: input.userId,
        itemId: input.itemId,
        signalType: input.signalType,
        strength: input.strength,
        modelWeight: -1.6,
        source: "ui",
        actor: user.displayName,
        createdAt: "2026-01-02T00:00:00.000Z"
      },
      score: {
        ...score(1),
        status: "vetoed",
        latentScore: -0.38
      }
    }));
    getPreferenceWorkspaceMock.mockReset();
    getPreferenceWorkspaceMock.mockResolvedValue({ workspace: workspace() });
    getPreferenceCatalogsMock.mockResolvedValue({
      catalogs: [],
      limit: 24,
      offset: 0,
      hasMore: false,
      nextOffset: null,
      previousOffset: null,
      snapshotAt: "2026-01-01T00:00:00.000Z",
      nextCursor: null
    });
    getPreferenceCatalogItemsMock.mockResolvedValue({
      items: [],
      limit: 24,
      offset: 0,
      hasMore: false,
      nextOffset: null,
      previousOffset: null,
      snapshotAt: "2026-01-01T00:00:00.000Z",
      nextCursor: null
    });
    deletePreferenceCatalogMock.mockResolvedValue({
      catalog: { id: "catalog_1" }
    });
    useForgeShellMock.mockReturnValue({
      selectedUserIds: [user.id],
      snapshot: {
        users: [user],
        goals: [],
        tasks: [],
        strategies: [],
        habits: [],
        dashboard: { projects: [] }
      }
    });
  });

  it("bounds the scored-item list and opens direct items in a guided flow", async () => {
    renderPage();

    expect(
      await screen.findByText(/showing 50 matching items on page 1-50 of 55/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Active preference user" })
    ).toHaveValue(user.id);
    expect(screen.getByRole("button", { name: "Projects" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Calendar" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByRole("button", { name: "Table" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText(/no supporting evidence yet/i)).toBeInTheDocument();
    const inspectButton = screen.getByRole("button", {
      name: "Inspect Preference 1"
    });
    inspectButton.focus();
    expect(inspectButton).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: /add direct item/i }));

    await waitFor(() =>
      expect(screen.getByText("guided:item")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(getPreferenceWorkspaceMock).toHaveBeenCalledWith(
        expect.objectContaining({
          itemLimit: 50,
          itemOffset: 50,
          historyLimit: 50
        })
      )
    );
  });

  it("applies a direct signal to the selected item through the guided flow", async () => {
    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Review direct mark" })
    );
    expect(screen.getByText("guided:signal")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply guided veto" }));

    await waitFor(() =>
      expect(submitPreferenceSignalMock).toHaveBeenCalledWith(
        {
          userId: user.id,
          domain: "projects",
          contextId: "context_1",
          itemId: "item_1",
          signalType: "veto",
          strength: 1
        },
        expect.any(Object)
      )
    );
  });

  it("requires an explicit owner when the shell has multiple selected users", async () => {
    const bot = {
      ...user,
      id: "user_2",
      kind: "bot" as const,
      handle: "forge-bot",
      displayName: "Forge Bot"
    };
    useForgeShellMock.mockReturnValue({
      selectedUserIds: [user.id, bot.id],
      snapshot: {
        users: [user, bot],
        goals: [],
        tasks: [],
        strategies: [],
        habits: [],
        dashboard: { projects: [] }
      }
    });

    renderPage();

    expect(
      await screen.findByText("Choose one preference owner")
    ).toBeInTheDocument();
    expect(getPreferenceWorkspaceMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Albert" }));
    await waitFor(() =>
      expect(getPreferenceWorkspaceMock).toHaveBeenCalledWith(
        expect.objectContaining({ userId: user.id })
      )
    );
  });

  it("does not disclose the prior owner workspace during a delayed owner switch", async () => {
    const bot = {
      ...user,
      id: "user_2",
      kind: "bot" as const,
      handle: "forge-bot",
      displayName: "Forge Bot"
    };
    useForgeShellMock.mockReturnValue({
      selectedUserIds: [user.id],
      snapshot: {
        users: [user, bot],
        goals: [],
        tasks: [],
        strategies: [],
        habits: [],
        dashboard: { projects: [] }
      }
    });
    let resolveBotWorkspace!: (value: {
      workspace: PreferenceWorkspacePayload;
    }) => void;
    getPreferenceWorkspaceMock.mockImplementation(
      ({ userId }: { userId: string }) =>
        userId === bot.id
          ? new Promise((resolve) => {
              resolveBotWorkspace = resolve;
            })
          : Promise.resolve({
              workspace: workspaceForSelection({ itemLabel: "Albert private" })
            })
    );

    renderPage();
    expect(await screen.findByText("Albert private")).toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("combobox", { name: "Active preference user" }),
      { target: { value: bot.id } }
    );

    expect(
      await screen.findByText("Loading preference model")
    ).toBeInTheDocument();
    expect(screen.queryByText("Albert private")).not.toBeInTheDocument();

    await act(async () =>
      resolveBotWorkspace({
        workspace: workspaceForSelection({
          owner: bot,
          itemLabel: "Bot private"
        })
      })
    );
    expect(await screen.findByText("Bot private")).toBeInTheDocument();
  });

  it("does not disclose the prior domain workspace during a delayed domain switch", async () => {
    let resolveCalendarWorkspace!: (value: {
      workspace: PreferenceWorkspacePayload;
    }) => void;
    getPreferenceWorkspaceMock.mockImplementation(
      ({ domain }: { domain: string }) =>
        domain === "calendar"
          ? new Promise((resolve) => {
              resolveCalendarWorkspace = resolve;
            })
          : Promise.resolve({
              workspace: workspaceForSelection({
                itemLabel: "Private project preference"
              })
            })
    );

    renderPage();
    expect(
      await screen.findByText("Private project preference")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));

    expect(
      await screen.findByText("Loading preference model")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Private project preference")
    ).not.toBeInTheDocument();

    await act(async () =>
      resolveCalendarWorkspace({
        workspace: workspaceForSelection({
          domain: "calendar",
          contextId: "context_calendar",
          itemLabel: "Calendar preference"
        })
      })
    );
    expect(await screen.findByText("Calendar preference")).toBeInTheDocument();
  });

  it("does not disclose the prior context workspace during a delayed context switch", async () => {
    const initialWorkspace = workspaceForSelection({
      contextName: "Private default context",
      itemLabel: "Default context preference"
    });
    const travelContext = {
      ...initialWorkspace.selectedContext,
      id: "context_travel",
      name: "Travel",
      isDefault: false
    };
    initialWorkspace.contexts = [
      initialWorkspace.selectedContext,
      travelContext
    ];
    let resolveTravelWorkspace!: (value: {
      workspace: PreferenceWorkspacePayload;
    }) => void;
    getPreferenceWorkspaceMock.mockImplementation(
      ({ contextId }: { contextId?: string }) =>
        contextId === travelContext.id
          ? new Promise((resolve) => {
              resolveTravelWorkspace = resolve;
            })
          : Promise.resolve({ workspace: initialWorkspace })
    );

    renderPage("/preferences?domain=projects&tab=contexts");
    expect(
      (await screen.findAllByText("Private default context")).length
    ).toBeGreaterThan(0);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Open context" })[1]!
    );

    expect(
      await screen.findByText("Loading preference model")
    ).toBeInTheDocument();
    expect(screen.queryAllByText("Private default context")).toHaveLength(0);

    await act(async () =>
      resolveTravelWorkspace({
        workspace: workspaceForSelection({
          contextId: travelContext.id,
          contextName: travelContext.name,
          itemLabel: "Travel context preference"
        })
      })
    );
    expect(
      await screen.findByText("Travel context preference")
    ).toBeInTheDocument();
  });

  it("refreshes the stored model through the explicit write route", async () => {
    renderPage("/preferences?domain=projects&tab=overview");

    fireEvent.click(
      await screen.findByRole("button", { name: "Refresh model" })
    );
    await waitFor(() =>
      expect(refreshPreferenceWorkspaceMock).toHaveBeenCalledWith({
        userId: user.id,
        domain: "projects",
        contextId: undefined,
        itemLimit: 50,
        itemOffset: 0,
        historyLimit: 50
      })
    );
  });

  it("keeps an uninitialized GET pure until the user explicitly initializes", async () => {
    getPreferenceWorkspaceMock.mockRejectedValueOnce(
      new ForgeApiError({
        status: 404,
        code: "preferences_workspace_not_initialized",
        message: "Preference workspace has not been initialized.",
        requestPath: "/api/v1/preferences/workspace"
      })
    );
    renderPage("/preferences?domain=projects&tab=overview");

    const initialize = await screen.findByRole("button", {
      name: "Initialize preferences"
    });
    expect(refreshPreferenceWorkspaceMock).not.toHaveBeenCalled();

    fireEvent.click(initialize);
    await waitFor(() =>
      expect(refreshPreferenceWorkspaceMock).toHaveBeenCalledTimes(1)
    );
  });

  it("sends explicit nulls when manual overrides are cleared", async () => {
    const payload = workspace();
    payload.scores[0] = {
      ...payload.scores[0]!,
      manualStatus: "liked",
      manualScore: 0.8,
      confidenceLock: 0.9
    };
    getPreferenceWorkspaceMock.mockResolvedValue({ workspace: payload });
    renderPage();

    const status = await screen.findByDisplayValue("liked");
    fireEvent.change(status, { target: { value: "" } });
    fireEvent.change(screen.getByPlaceholderText("Manual score"), {
      target: { value: "" }
    });
    fireEvent.change(screen.getByPlaceholderText("Confidence lock 0-1"), {
      target: { value: "" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save item model" }));

    await waitFor(() =>
      expect(patchPreferenceScoreMock).toHaveBeenCalledWith("item_1", {
        userId: user.id,
        domain: "projects",
        contextId: "context_1",
        manualStatus: null,
        manualScore: null,
        confidenceLock: null,
        bookmarked: false,
        compareLater: false,
        frozen: false
      })
    );
  });

  it("shows when the context-aware model evidence window is truncated", async () => {
    const payload = workspace();
    payload.evidenceCoverage = {
      judgmentLimitPerContext: 1000,
      totalJudgments: 1201,
      consideredJudgments: 1000,
      truncated: true,
      contexts: [
        {
          contextId: "context_1",
          totalJudgments: 1201,
          consideredJudgments: 1000,
          truncated: true
        }
      ]
    };
    getPreferenceWorkspaceMock.mockResolvedValue({ workspace: payload });
    renderPage("/preferences?domain=projects&tab=history");

    expect(
      await screen.findByText(/showing latest 0 of 1201/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /model used the latest 1000 judgments for this context; older evidence remains stored/i
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/recent preference history is partial/i)
    ).toBeInTheDocument();
  });

  it("does not show catalogs from the prior domain while the game loads a new domain", async () => {
    const payload = workspace();
    const baseCatalog = {
      id: "catalog_projects",
      profileId: "profile_1",
      userId: user.id,
      user,
      domain: "projects" as const,
      slug: "project-options",
      title: "Project options",
      description: "Project comparison concepts.",
      scopeIn: "",
      scopeOut: "",
      source: "custom" as const,
      createdSource: "ui" as const,
      createdByActor: user.displayName,
      archived: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      links: [],
      items: [],
      itemCount: 0,
      itemsTruncated: false
    } satisfies PreferenceCatalog;
    payload.catalogs = [baseCatalog];
    payload.libraries.totalCatalogs = 1;
    getPreferenceWorkspaceMock.mockResolvedValue({ workspace: payload });

    let resolveFoodCatalogs!: (value: {
      catalogs: PreferenceCatalog[];
      limit: number;
      offset: number;
      hasMore: boolean;
      nextOffset: null;
      previousOffset: null;
      snapshotAt: string;
      nextCursor: null;
    }) => void;
    getPreferenceCatalogsMock.mockImplementation(
      ({ domain }: { domain: string }) =>
        domain === "food"
          ? new Promise((resolve) => {
              resolveFoodCatalogs = resolve;
            })
          : Promise.resolve({
              catalogs: [baseCatalog],
              limit: 24,
              offset: 0,
              hasMore: false,
              nextOffset: null,
              previousOffset: null,
              snapshotAt: "2026-01-01T00:00:00.000Z",
              nextCursor: null
            })
    );

    renderPage("/preferences?domain=projects&tab=overview");
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Start the game" }))[0]!
    );
    expect(
      screen.getByText("Game catalogs: Project options")
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Choose food concepts" })
    );

    await waitFor(() =>
      expect(screen.getByText("Game phase: catalog")).toBeInTheDocument()
    );
    expect(screen.getByText("Game catalogs:")).toBeInTheDocument();
    expect(
      screen.queryByText("Game catalogs: Project options")
    ).not.toBeInTheDocument();
    expect(screen.getByText("Game catalogs loading: true")).toBeInTheDocument();

    const foodCatalog = {
      ...baseCatalog,
      id: "catalog_food",
      domain: "food" as const,
      slug: "food-options",
      title: "Food options"
    };
    await act(async () =>
      resolveFoodCatalogs({
        catalogs: [foodCatalog],
        limit: 24,
        offset: 0,
        hasMore: false,
        nextOffset: null,
        previousOffset: null,
        snapshotAt: "2026-01-01T00:00:00.000Z",
        nextCursor: null
      })
    );
    expect(
      await screen.findByText("Game catalogs: Food options")
    ).toBeInTheDocument();
  });

  it("pages bounded catalogs, edits through the guided flow, and archives through the standard dialog", async () => {
    const payload = workspace();
    payload.catalogs = Array.from({ length: 101 }, (_, catalogIndex) => ({
      id: `catalog_${catalogIndex + 1}`,
      profileId: "profile_1",
      userId: user.id,
      user,
      domain: "projects" as const,
      slug: `catalog-${catalogIndex + 1}`,
      title: `Catalog ${catalogIndex + 1}`,
      description: "A decision catalog.",
      scopeIn: "Included options.",
      scopeOut: "Excluded options.",
      source: "custom" as const,
      createdSource: "ui" as const,
      createdByActor: user.displayName,
      archived: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      links: [],
      items: [],
      itemCount: 0,
      itemsTruncated: false
    }));
    payload.libraries.totalCatalogs = 101;
    payload.catalogs = payload.catalogs.slice(0, 24);
    getPreferenceWorkspaceMock.mockResolvedValue({ workspace: payload });
    getPreferenceCatalogsMock.mockImplementation(
      ({ cursor }: { cursor?: string }) => {
        const pageIndex = cursor
          ? Number(cursor.replace("catalog-page-", ""))
          : 0;
        const offset = pageIndex * 24;
        const catalogs = Array.from({ length: 101 }, (_, index) => ({
          ...payload.catalogs[0]!,
          id: `catalog_${index + 1}`,
          slug: `catalog-${index + 1}`,
          title: `Catalog ${index + 1}`
        })).slice(offset, offset + 24);
        return Promise.resolve({
          catalogs,
          limit: 24,
          offset,
          hasMore: offset + 24 < 101,
          nextOffset: offset + 24 < 101 ? offset + 24 : null,
          previousOffset: offset > 0 ? Math.max(0, offset - 24) : null,
          snapshotAt: "2026-01-01T00:00:00.000Z",
          nextCursor: offset + 24 < 101 ? `catalog-page-${pageIndex + 1}` : null
        });
      }
    );

    renderPage("/preferences?domain=projects&tab=concepts");
    expect(await screen.findByText("Catalog 1")).toBeInTheDocument();
    expect(screen.getByText("Catalog 13")).toBeInTheDocument();
    expect(screen.queryByText("Catalog 25")).not.toBeInTheDocument();
    expect(screen.queryByText("Catalog 101")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Archive list" })[0]!
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm archive" })
    );
    await waitFor(() =>
      expect(deletePreferenceCatalogMock.mock.calls[0]?.[0]).toBe("catalog_1")
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Edit list" })[0]!);
    expect(screen.getByText("guided:catalog:catalog_1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next libraries" }));
    expect(await screen.findByText("Catalog 25")).toBeInTheDocument();
    expect(screen.queryByText("Catalog 1")).not.toBeInTheDocument();
  }, 10_000);

  it("loads the next bounded page of a large concept list without expanding the whole catalog", async () => {
    const payload = workspace();
    const items = Array.from({ length: 24 }, (_, itemIndex) => ({
      id: `catalog_1_item_${itemIndex + 1}`,
      catalogId: "catalog_1",
      label: `Concept ${itemIndex + 1}`,
      description: "",
      tags: [],
      featureWeights: {
        novelty: 0,
        simplicity: 0,
        rigor: 0,
        aesthetics: 0,
        depth: 0,
        structure: 0,
        familiarity: 0,
        surprise: 0
      },
      position: itemIndex,
      archived: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }));
    payload.catalogs = [
      {
        id: "catalog_1",
        profileId: "profile_1",
        userId: user.id,
        user,
        domain: "projects",
        slug: "large-catalog",
        title: "Large catalog",
        description: "A bounded catalog.",
        scopeIn: "",
        scopeOut: "",
        source: "custom",
        createdSource: "ui",
        createdByActor: user.displayName,
        archived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        links: [],
        items,
        itemCount: 25,
        itemsTruncated: true
      }
    ];
    getPreferenceWorkspaceMock.mockResolvedValue({ workspace: payload });
    getPreferenceCatalogsMock.mockResolvedValue({
      catalogs: payload.catalogs,
      limit: 24,
      offset: 0,
      hasMore: false,
      nextOffset: null,
      previousOffset: null,
      snapshotAt: "2026-01-01T00:00:00.000Z",
      nextCursor: null
    });
    getPreferenceCatalogItemsMock.mockImplementation(
      ({ cursor }: { cursor?: string }) =>
        cursor
          ? Promise.resolve({
              items: [
                {
                  ...items[0],
                  id: "catalog_1_item_25",
                  label: "Concept 25",
                  position: 24,
                  archived: false
                }
              ],
              limit: 24,
              offset: 24,
              hasMore: false,
              nextOffset: null,
              previousOffset: 0,
              snapshotAt: "2026-01-01T00:00:00.000Z",
              nextCursor: null
            })
          : Promise.resolve({
              items,
              limit: 24,
              offset: 0,
              hasMore: true,
              nextOffset: 24,
              previousOffset: null,
              snapshotAt: "2026-01-01T00:00:00.000Z",
              nextCursor: "catalog-item-page-2"
            })
    );

    renderPage("/preferences?domain=projects&tab=concepts");
    expect(await screen.findByText("25 items")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next concepts" }));

    expect(await screen.findByText("Concept 25")).toBeInTheDocument();
    expect(getPreferenceCatalogItemsMock).toHaveBeenNthCalledWith(1, {
      catalogId: "catalog_1",
      query: "",
      limit: 24,
      cursor: undefined
    });
    expect(getPreferenceCatalogItemsMock).toHaveBeenNthCalledWith(2, {
      catalogId: "catalog_1",
      query: "",
      limit: 24,
      cursor: "catalog-item-page-2"
    });
    expect(
      screen.queryByRole("button", { name: "Next concepts" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Previous concepts" })
    ).toBeInTheDocument();
  });

  it("does not offer an empty concept page for a title-only catalog match", async () => {
    const payload = workspace();
    const catalog = {
      id: "catalog_1",
      profileId: "profile_1",
      userId: user.id,
      user,
      domain: "projects" as const,
      slug: "matching-title",
      title: "Matching title",
      description: "The search matches this catalog, not its concepts.",
      scopeIn: "",
      scopeOut: "",
      source: "custom" as const,
      createdSource: "ui" as const,
      createdByActor: user.displayName,
      archived: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      links: [],
      items: [],
      itemCount: 25,
      matchingItemCount: 0,
      itemsTruncated: false
    };
    payload.catalogs = [];
    payload.libraries.totalCatalogs = 1;
    getPreferenceWorkspaceMock.mockResolvedValue({ workspace: payload });
    getPreferenceCatalogsMock.mockImplementation(
      ({ query }: { query: string }) =>
        Promise.resolve({
          catalogs: query ? [catalog] : [],
          limit: 24,
          offset: 0,
          hasMore: false,
          nextOffset: null,
          previousOffset: null,
          snapshotAt: "2026-01-01T00:00:00.000Z",
          nextCursor: null
        })
    );

    renderPage("/preferences?domain=projects&tab=concepts");
    fireEvent.change(
      await screen.findByPlaceholderText(
        "Search lists, concepts, tags, and seeded domains"
      ),
      { target: { value: "Matching title" } }
    );

    expect(await screen.findByText("0 matches · 25 items")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Next concepts" })
    ).not.toBeInTheDocument();
  });

  it("keeps a guided concept edit locked until the update finishes", async () => {
    const payload = workspace();
    const catalogItem = {
      id: "catalog_item_1",
      catalogId: "catalog_1",
      label: "Original concept",
      description: "Original description",
      tags: [],
      featureWeights: {
        novelty: 0,
        simplicity: 0,
        rigor: 0,
        aesthetics: 0,
        depth: 0,
        structure: 0,
        familiarity: 0,
        surprise: 0
      },
      position: 0,
      archived: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    };
    payload.catalogs = [
      {
        id: "catalog_1",
        profileId: "profile_1",
        userId: user.id,
        user,
        domain: "projects",
        slug: "catalog-1",
        title: "Catalog 1",
        description: "A decision catalog.",
        scopeIn: "",
        scopeOut: "",
        source: "custom",
        createdSource: "ui",
        createdByActor: user.displayName,
        archived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        links: [],
        items: [catalogItem],
        itemCount: 1,
        itemsTruncated: false
      }
    ];
    payload.libraries.totalCatalogs = 1;
    getPreferenceWorkspaceMock.mockResolvedValue({ workspace: payload });
    getPreferenceCatalogsMock.mockResolvedValue({
      catalogs: payload.catalogs,
      limit: 24,
      offset: 0,
      hasMore: false,
      nextOffset: null,
      previousOffset: null,
      snapshotAt: "2026-01-01T00:00:00.000Z",
      nextCursor: null
    });

    let resolveUpdate!: (value: { item: typeof catalogItem }) => void;
    patchPreferenceCatalogItemMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        })
    );

    renderPage("/preferences?domain=projects&tab=concepts");
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const saveButton = screen.getByRole("button", {
      name: "Save guided concept"
    });
    fireEvent.click(saveButton);

    await waitFor(() => expect(saveButton).toBeDisabled());
    expect(patchPreferenceCatalogItemMock).toHaveBeenCalledWith(
      "catalog_item_1",
      {
        label: "Updated concept",
        description: "Updated description",
        tags: []
      }
    );

    await act(async () => resolveUpdate({ item: catalogItem }));
    await waitFor(() => expect(saveButton).toBeEnabled());
  });
});
