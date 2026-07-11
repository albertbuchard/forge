import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PreferenceItemScore,
  PreferenceWorkspacePayload,
  UserSummary
} from "@/lib/types";

const { getPreferenceWorkspaceMock, useForgeShellMock } = vi.hoisted(() => ({
  getPreferenceWorkspaceMock: vi.fn(),
  useForgeShellMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  createPreferenceCatalog: vi.fn(),
  createPreferenceCatalogItem: vi.fn(),
  createPreferenceContext: vi.fn(),
  createPreferenceItem: vi.fn(),
  deletePreferenceCatalog: vi.fn(),
  deletePreferenceCatalogItem: vi.fn(),
  enqueuePreferenceEntity: vi.fn(),
  getPreferenceWorkspace: getPreferenceWorkspaceMock,
  mergePreferenceContexts: vi.fn(),
  patchPreferenceCatalog: vi.fn(),
  patchPreferenceCatalogItem: vi.fn(),
  patchPreferenceContext: vi.fn(),
  patchPreferenceItem: vi.fn(),
  patchPreferenceScore: vi.fn(),
  startPreferenceGame: vi.fn(),
  submitPairwisePreferenceJudgment: vi.fn(),
  submitPreferenceSignal: vi.fn()
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
  PreferenceGameDialog: () => null
}));

vi.mock("@/components/preferences/preference-guided-flow-dialog", () => ({
  PreferenceGuidedFlowDialog: ({ flow }: { flow: { kind: string } | null }) =>
    flow ? <div>guided:{flow.kind}</div> : null
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
  const scores = Array.from({ length: 55 }, (_, index) => score(index + 1));
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

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/preferences?domain=projects&tab=table"]}>
        <Routes>
          <Route path="/preferences" element={<PreferencesPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("PreferencesPage", () => {
  beforeEach(() => {
    getPreferenceWorkspaceMock.mockResolvedValue({ workspace: workspace() });
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
      await screen.findByText(/showing 50 of 55 matching items/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/no supporting evidence yet/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add direct item/i }));

    await waitFor(() =>
      expect(screen.getByText("guided:item")).toBeInTheDocument()
    );
  });
});
