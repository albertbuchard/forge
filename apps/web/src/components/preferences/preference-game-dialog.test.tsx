import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PreferenceGameDialog } from "./preference-game-dialog";
import type {
  PreferenceCatalogItem,
  PreferenceItem,
  PreferenceWorkspacePayload
} from "@/lib/types";

const dimensions = {
  novelty: 0,
  simplicity: 0,
  rigor: 0,
  aesthetics: 0,
  depth: 0,
  structure: 0,
  familiarity: 0,
  surprise: 0
};

function item(id: string, label: string): PreferenceItem {
  return {
    id,
    profileId: "profile_1",
    label,
    description: `${label} description`,
    tags: [],
    featureWeights: dimensions,
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function catalogItem(id: string, label: string): PreferenceCatalogItem {
  return {
    id,
    catalogId: "catalog_1",
    label,
    description: `${label} description`,
    tags: [],
    featureWeights: dimensions,
    position: 0,
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

const left = item("item_left", "Deep focus");
const right = item("item_right", "Fast iteration");

const workspace = {
  selectedContext: {
    id: "context_1",
    profileId: "profile_1",
    name: "Deep work",
    description: "Focused delivery decisions.",
    shareMode: "blended",
    active: true,
    isDefault: true,
    decayDays: 75,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  },
  history: {
    judgments: [
      {
        id: "judgment_1",
        profileId: "profile_1",
        contextId: "context_1",
        userId: "user_1",
        leftItemId: "item_left",
        rightItemId: "item_right",
        outcome: "right",
        strength: 1,
        responseTimeMs: null,
        source: "ui",
        reasonTags: [],
        createdAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    signals: [
      {
        id: "signal_1",
        profileId: "profile_1",
        contextId: "context_1",
        userId: "user_1",
        ownerUserId: "user_1",
        itemId: "item_left",
        signalType: "favorite",
        strength: 1,
        modelWeight: 1.25,
        source: "ui",
        actor: "Operator",
        createdAt: "2026-01-02T00:00:00.000Z"
      }
    ],
    snapshots: [],
    staleItemIds: [],
    flippedItemIds: []
  },
  scores: [
    {
      itemId: "item_left",
      pairwiseWins: 0,
      pairwiseLosses: 1,
      effectiveSignal: {
        id: "signal_1",
        profileId: "profile_1",
        contextId: "context_1",
        userId: "user_1",
        ownerUserId: "user_1",
        itemId: "item_left",
        signalType: "favorite",
        strength: 1,
        modelWeight: 1.25,
        source: "ui",
        actor: "Operator",
        createdAt: "2026-01-02T00:00:00.000Z"
      }
    },
    {
      itemId: "item_right",
      pairwiseWins: 1,
      pairwiseLosses: 0,
      effectiveSignal: null
    }
  ],
  presentation: { historyLimit: 50 },
  evidenceCoverage: {
    contexts: [
      {
        contextId: "context_1",
        totalJudgments: 1,
        consideredJudgments: 1,
        truncated: false
      }
    ]
  },
  compare: {
    nextPair: {
      left,
      right,
      rationale: ["Both items have high uncertainty"],
      score: 0.8
    },
    pendingCount: 3,
    candidateCount: 2
  }
} as unknown as PreferenceWorkspacePayload;

const baseProps = {
  state: { open: true, phase: "play" as const, domain: "projects" as const },
  onOpenChange: vi.fn(),
  error: null,
  notice: null,
  loading: false,
  submitting: false,
  workspaceLoading: false,
  activeWorkspace: workspace,
  conceptSearchQuery: "",
  onConceptSearchQueryChange: vi.fn(),
  filteredCatalogs: [],
  catalogsLoading: false,
  catalogsRefreshing: false,
  catalogsError: null,
  catalogOffset: 0,
  catalogPreviousOffset: null,
  catalogNextOffset: null,
  onPreviousCatalogs: vi.fn(),
  onNextCatalogs: vi.fn(),
  onRetryCatalogs: vi.fn(),
  onSelectDomain: vi.fn(),
  onStartCatalogGame: vi.fn()
};

describe("PreferenceGameDialog", () => {
  it("supports keyboard judgments and explains context-specific model effects", async () => {
    const onJudge = vi.fn();
    const onSignal = vi.fn();
    render(
      <PreferenceGameDialog
        {...baseProps}
        onJudge={onJudge}
        onSignal={onSignal}
      />
    );

    expect(screen.getByText("Deep work")).toBeInTheDocument();
    expect(
      screen.getByText(/both items have high uncertainty/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/tie adds tie evidence/i)).toBeInTheDocument();
    expect(
      screen.getByText(/other active contexts contribute at 45%/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/tanh\(raw \/ 4\)/i)).toBeInTheDocument();
    expect(screen.getByText(/\+1.25 raw weight/i)).toBeInTheDocument();
    expect(
      screen.getByText(/1 prior comparison loss conflicts/i)
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "1" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Left · 1" })).toBeEnabled()
    );
    fireEvent.keyDown(window, { key: "T" });

    expect(onJudge).toHaveBeenNthCalledWith(1, "left", 1, expect.any(String));
    expect(onJudge).toHaveBeenNthCalledWith(2, "tie", 1, expect.any(String));

    fireEvent.click(
      screen.getByRole("button", { name: "Favorite for Deep focus" })
    );
    expect(onSignal).toHaveBeenCalledWith(
      "item_left",
      "favorite",
      expect.any(String)
    );
  });

  it("locks duplicate signal input and offers an idempotent retry after an ambiguous failure", async () => {
    let resolveSignal!: () => void;
    const onSignal = vi.fn(
      (_itemId: string, _signalType: string, _idempotencyKey: string) =>
        new Promise<void>((resolve) => {
          resolveSignal = resolve;
        })
    );
    const { rerender } = render(
      <PreferenceGameDialog
        {...baseProps}
        onJudge={vi.fn()}
        onSignal={onSignal}
      />
    );

    const vetoButton = screen.getByRole("button", {
      name: "Veto for Deep focus"
    });
    fireEvent.click(vetoButton);
    fireEvent.click(vetoButton);
    expect(onSignal).toHaveBeenCalledTimes(1);
    const firstIdempotencyKey = onSignal.mock.calls[0]?.[2];
    expect(firstIdempotencyKey).toEqual(expect.any(String));
    expect(
      screen.getByRole("button", { name: "Favorite for Deep focus" })
    ).toBeDisabled();

    await act(async () => resolveSignal());
    expect(
      screen.getByRole("button", { name: "Favorite for Deep focus" })
    ).toBeEnabled();

    rerender(
      <PreferenceGameDialog
        {...baseProps}
        error="The response was lost."
        onJudge={vi.fn()}
        onSignal={onSignal}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The response was lost."
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Retry Veto for Deep focus" })
    );
    expect(onSignal).toHaveBeenCalledTimes(2);
    expect(onSignal).toHaveBeenLastCalledWith(
      "item_left",
      "veto",
      firstIdempotencyKey
    );
  });

  it("keeps a just-applied signal available for replacement after the pair advances", async () => {
    const onSignal = vi.fn(() => Promise.resolve());
    const { rerender } = render(
      <PreferenceGameDialog
        {...baseProps}
        onJudge={vi.fn()}
        onSignal={onSignal}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Veto for Deep focus" })
    );
    await waitFor(() => expect(onSignal).toHaveBeenCalledTimes(1));

    const advancedWorkspace = {
      ...workspace,
      history: {
        ...workspace.history,
        signals: [
          {
            ...workspace.history.signals[0]!,
            id: "signal_2",
            signalType: "veto",
            createdAt: "2026-01-03T00:00:00.000Z"
          },
          ...workspace.history.signals
        ]
      },
      scores: workspace.scores.map((score) =>
        score.itemId === "item_left"
          ? {
              ...score,
              effectiveSignal: {
                ...workspace.history.signals[0]!,
                id: "signal_2",
                signalType: "veto" as const,
                createdAt: "2026-01-03T00:00:00.000Z"
              }
            }
          : score
      ),
      compare: {
        ...workspace.compare,
        nextPair: {
          left: item("item_next_left", "Careful review"),
          right: item("item_next_right", "Quick handoff"),
          rationale: ["The signal changed the most informative pair"],
          score: 0.7
        }
      }
    } as PreferenceWorkspacePayload;

    rerender(
      <PreferenceGameDialog
        {...baseProps}
        activeWorkspace={advancedWorkspace}
        onJudge={vi.fn()}
        onSignal={onSignal}
      />
    );

    const recentEditor = screen
      .getByText("Recently changed")
      .closest("section");
    expect(recentEditor).not.toBeNull();
    expect(recentEditor).toHaveTextContent("Deep focus");
    expect(recentEditor).toHaveTextContent("veto active");
    expect(recentEditor).toHaveTextContent(
      "current veto signal replaced the prior favorite signal"
    );

    fireEvent.click(
      within(recentEditor as HTMLElement).getByRole("button", {
        name: "Clear effect for Deep focus"
      })
    );
    expect(onSignal).toHaveBeenLastCalledWith(
      "item_left",
      "neutral",
      expect.any(String)
    );
  });

  it("submits at most one judgment for a pair while the request is pending", async () => {
    let resolveJudgment!: () => void;
    const onJudge = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveJudgment = resolve;
        })
    );

    render(
      <PreferenceGameDialog
        {...baseProps}
        onJudge={onJudge}
        onSignal={vi.fn()}
      />
    );

    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "T" });
    fireEvent.click(screen.getByRole("button", { name: "Left · 1" }));

    expect(onJudge).toHaveBeenCalledTimes(1);
    expect(onJudge).toHaveBeenCalledWith("left", 1, expect.any(String));
    expect(screen.getByRole("button", { name: "Left · 1" })).toBeDisabled();

    await act(async () => resolveJudgment());

    expect(screen.getByRole("button", { name: "Left · 1" })).toBeEnabled();
  });

  it("retries an ambiguous judgment with the same idempotency key", async () => {
    const onJudge = vi
      .fn()
      .mockRejectedValueOnce(new Error("Judgment failed"))
      .mockResolvedValueOnce(undefined);
    const { rerender } = render(
      <PreferenceGameDialog
        {...baseProps}
        onJudge={onJudge}
        onSignal={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Left · 1" }));
    expect(onJudge).toHaveBeenCalledTimes(1);
    const idempotencyKey = onJudge.mock.calls[0]?.[2];
    expect(idempotencyKey).toEqual(expect.any(String));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Left · 1" })).toBeEnabled()
    );

    rerender(
      <PreferenceGameDialog
        {...baseProps}
        error="The response was lost."
        onJudge={onJudge}
        onSignal={vi.fn()}
      />
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Retry left for Deep focus versus Fast iteration"
      })
    );
    expect(onJudge).toHaveBeenCalledTimes(2);
    expect(onJudge).toHaveBeenLastCalledWith("left", 1, idempotencyKey);
  });

  it("locks round actions while a judgment or signal is saving", () => {
    render(
      <PreferenceGameDialog
        {...baseProps}
        submitting
        notice="Deep focus preferred in Deep work."
        onJudge={vi.fn()}
        onSignal={vi.fn()}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Deep focus preferred in Deep work."
    );
    expect(screen.getByRole("button", { name: "Left · 1" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Favorite for Deep focus" })
    ).toBeDisabled();
  });

  it("uses an authoritative retry baseline when the effective signal is outside bounded history", async () => {
    const historySignal = {
      ...workspace.history.signals[0]!,
      id: "signal_in_history",
      signalType: "veto" as const,
      modelWeight: -1.6
    };
    const effectiveSignal = {
      ...workspace.history.signals[0]!,
      id: "signal_outside_history",
      signalType: "favorite" as const
    };
    const truncatedWorkspace = {
      ...workspace,
      history: { ...workspace.history, signals: [historySignal] },
      scores: workspace.scores.map((score) =>
        score.itemId === "item_left"
          ? {
              ...score,
              pairwiseLosses: 6,
              effectiveSignal
            }
          : score
      ),
      presentation: { ...workspace.presentation, historyLimit: 1 }
    } as PreferenceWorkspacePayload;
    const onSignal = vi.fn(() => Promise.resolve());
    const { rerender } = render(
      <PreferenceGameDialog
        {...baseProps}
        activeWorkspace={truncatedWorkspace}
        onJudge={vi.fn()}
        onSignal={onSignal}
      />
    );

    expect(
      screen.getByRole("button", { name: "Favorite for Deep focus" })
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/recent history is partial/i)).toBeInTheDocument();
    expect(
      screen.getByText(/6 prior comparison losses conflict/i)
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Veto for Deep focus" })
    );
    const updatedWorkspace = {
      ...truncatedWorkspace,
      scores: truncatedWorkspace.scores.map((score) =>
        score.itemId === "item_left"
          ? { ...score, effectiveSignal: historySignal }
          : score
      )
    };
    rerender(
      <PreferenceGameDialog
        {...baseProps}
        activeWorkspace={updatedWorkspace}
        error="The response was lost."
        onJudge={vi.fn()}
        onSignal={onSignal}
      />
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("button", {
          name: "Retry Veto for Deep focus"
        })
      ).not.toBeInTheDocument()
    );
  });

  it("shows explicit catalog loading, failure recovery, and bounded paging", () => {
    const onRetryCatalogs = vi.fn();
    const onNextCatalogs = vi.fn();
    const { rerender } = render(
      <PreferenceGameDialog
        {...baseProps}
        state={{
          open: true,
          phase: "catalog",
          domain: "projects"
        }}
        catalogsLoading
        catalogsRefreshing
        onRetryCatalogs={onRetryCatalogs}
        onNextCatalogs={onNextCatalogs}
        onJudge={vi.fn()}
        onSignal={vi.fn()}
      />
    );

    expect(screen.getByText("Loading concept lists")).toBeInTheDocument();
    expect(
      screen.queryByText(/no concept list matches/i)
    ).not.toBeInTheDocument();

    rerender(
      <PreferenceGameDialog
        {...baseProps}
        state={{
          open: true,
          phase: "catalog",
          domain: "projects"
        }}
        catalogsError="The concept list request failed."
        onRetryCatalogs={onRetryCatalogs}
        onNextCatalogs={onNextCatalogs}
        onJudge={vi.fn()}
        onSignal={vi.fn()}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The concept list request failed."
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Retry concept lists" })
    );
    expect(onRetryCatalogs).toHaveBeenCalledTimes(1);

    rerender(
      <PreferenceGameDialog
        {...baseProps}
        state={{
          open: true,
          phase: "catalog",
          domain: "projects"
        }}
        filteredCatalogs={[
          {
            id: "catalog_1",
            profileId: "profile_1",
            userId: "user_1",
            user: null,
            domain: "projects",
            slug: "delivery-shapes",
            title: "Delivery shapes",
            description: "Compare ways to deliver work.",
            scopeIn: "",
            scopeOut: "",
            source: "custom",
            createdSource: "ui",
            createdByActor: null,
            archived: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            links: [],
            items: Array.from({ length: 24 }, (_, index) =>
              catalogItem(`catalog_item_${index}`, `Catalog item ${index}`)
            ),
            itemCount: 48,
            itemsTruncated: true
          }
        ]}
        catalogOffset={0}
        catalogNextOffset={24}
        onRetryCatalogs={onRetryCatalogs}
        onNextCatalogs={onNextCatalogs}
        onJudge={vi.fn()}
        onSignal={vi.fn()}
      />
    );
    expect(screen.getByText("Delivery shapes")).toBeInTheDocument();
    expect(screen.getByText("48 items")).toBeInTheDocument();
    expect(screen.getByText("Showing 1-1 libraries")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next libraries" }));
    expect(onNextCatalogs).toHaveBeenCalledTimes(1);
  });
});
