import type { ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/flows/question-flow-dialog", () => ({
  FlowChoiceGrid: ({
    value,
    onChange,
    options
  }: {
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string; description?: string }>;
  }) => (
    <div>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.description}
        </button>
      ))}
    </div>
  ),
  FlowField: ({
    label,
    error,
    children
  }: {
    label: string;
    error?: string | null;
    children: ReactNode;
  }) => (
    <label>
      <span>{label}</span>
      {children}
      {error ? <span role="alert">{error}</span> : null}
    </label>
  ),
  QuestionFlowDialog: ({
    open,
    value,
    onChange,
    steps,
    submitLabel,
    error,
    draftPersistenceKey,
    onSubmit
  }: {
    open: boolean;
    value: unknown;
    onChange: (value: unknown) => void;
    steps: Array<{
      id: string;
      title: string;
      render: (
        value: unknown,
        setValue: (patch: Record<string, unknown>) => void
      ) => ReactNode;
    }>;
    submitLabel: string;
    error?: string | null;
    draftPersistenceKey?: string;
    onSubmit: () => Promise<void>;
  }) =>
    open ? (
      <div
        data-testid="mock-question-flow"
        data-draft-persistence-key={draftPersistenceKey}
        data-idempotency-key={
          (value as { idempotencyKey?: string }).idempotencyKey
        }
      >
        {error ? <div role="alert">{error}</div> : null}
        {steps.map((step) => (
          <section key={step.id}>
            <h2>{step.title}</h2>
            {step.render(value, (patch) =>
              onChange({ ...(value as Record<string, unknown>), ...patch })
            )}
          </section>
        ))}
        <button type="button" onClick={() => void onSubmit()}>
          {submitLabel}
        </button>
      </div>
    ) : null
}));

import { PreferenceGuidedFlowDialog } from "./preference-guided-flow-dialog";
import type {
  PreferenceCatalog,
  PreferenceItemScore,
  PreferenceWorkspacePayload,
  UserSummary
} from "@/lib/types";

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

const catalog = {
  id: "catalog_1",
  profileId: "profile_1",
  userId: user.id,
  user,
  domain: "projects",
  slug: "travel",
  title: "Travel",
  description: "Trip shapes",
  scopeIn: "Leisure travel",
  scopeOut: "Daily commuting",
  source: "custom",
  createdSource: "ui",
  createdByActor: "Albert",
  archived: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  links: [
    {
      sourceEntityType: "preference_catalog",
      sourceEntityId: "catalog_1",
      targetEntityType: "goal",
      targetEntityId: "goal_trip",
      anchorKey: "decision-context",
      relationship: "supports",
      createdByActor: "Albert",
      createdAt: "2026-01-01T00:00:00.000Z"
    }
  ],
  items: [
    {
      id: "concept_1",
      catalogId: "catalog_1",
      label: "City break",
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
      position: 0,
      archived: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  ],
  itemCount: 1,
  itemsTruncated: false
} satisfies PreferenceCatalog;

function buildWorkspace(): PreferenceWorkspacePayload {
  return {
    profile: {
      id: "profile_1",
      userId: user.id,
      domain: "projects",
      defaultContextId: "context_default",
      modelVersion: "pref-v1-bt-lite",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      user
    },
    selectedContext: {
      id: "context_default",
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
    contexts: [
      {
        id: "context_default",
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
      {
        id: "context_work",
        profileId: "profile_1",
        name: "Work",
        description: "",
        shareMode: "blended",
        active: true,
        isDefault: false,
        decayDays: 75,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    catalogs: [catalog],
    dimensions: [],
    scores: [],
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
      totalItems: 0,
      returnedItems: 0,
      hasMore: false,
      nextOffset: null,
      historyLimit: 50
    },
    evidenceCoverage: {
      judgmentLimitPerContext: 1000,
      totalJudgments: 0,
      consideredJudgments: 0,
      truncated: false,
      contexts: [
        {
          contextId: "context_default",
          totalJudgments: 0,
          consideredJudgments: 0,
          truncated: false
        }
      ]
    },
    compare: { nextPair: null, pendingCount: 0, candidateCount: 0 },
    summary: {
      totalItems: 0,
      likedCount: 0,
      dislikedCount: 0,
      uncertainCount: 0,
      bookmarkedCount: 0,
      vetoedCount: 0,
      averageConfidence: 0,
      pendingComparisons: 0
    },
    libraries: {
      totalCatalogs: 1,
      totalCatalogItems: 1,
      seededCatalogCount: 0,
      customCatalogCount: 1
    }
  };
}

const signalScore = {
  id: "score_signal",
  profileId: "profile_1",
  contextId: "context_default",
  itemId: "item_signal",
  latentScore: 0.3,
  confidence: 0.4,
  uncertainty: 0.6,
  evidenceCount: 1,
  pairwiseWins: 0,
  pairwiseLosses: 0,
  pairwiseTies: 0,
  signalCount: 1,
  effectiveSignal: {
    id: "signal_favorite",
    profileId: "profile_1",
    contextId: "context_default",
    userId: user.id,
    ownerUserId: user.id,
    itemId: "item_signal",
    signalType: "favorite",
    strength: 1,
    modelWeight: 1.25,
    source: "agent",
    actor: "Preference assistant",
    createdAt: "2026-01-02T00:00:00.000Z"
  },
  conflictCount: 0,
  status: "favorite",
  dominantDimensions: [],
  explanation: [],
  manualStatus: null,
  manualScore: null,
  confidenceLock: null,
  bookmarked: false,
  compareLater: false,
  frozen: false,
  lastInferredAt: "2026-01-02T00:00:00.000Z",
  lastJudgmentAt: null,
  updatedAt: "2026-01-02T00:00:00.000Z",
  item: {
    id: "item_signal",
    profileId: "profile_1",
    label: "Quiet breakfast cafe",
    description: "A calm place for a focused morning.",
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
} satisfies PreferenceItemScore;

const baseProps = {
  onOpenChange: vi.fn(),
  pending: false,
  user,
  domain: "projects" as const,
  workspace: buildWorkspace()
};

describe("PreferenceGuidedFlowDialog", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("reviews and clears an arbitrary item's direct effect with exact context and provenance", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const workspace = buildWorkspace();
    workspace.scores = [signalScore];
    render(
      <PreferenceGuidedFlowDialog
        {...baseProps}
        workspace={workspace}
        flow={{ kind: "signal", score: signalScore }}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByText(/current mark: favorite/i)).toBeInTheDocument();
    expect(screen.getByText(/preference assistant/i)).toBeInTheDocument();
    expect(
      screen.getByText(/all active contexts contribute at full weight/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /clear effect/i }));
    expect(
      screen.getAllByText(/clears the current direct effect/i)
    ).not.toHaveLength(0);
    expect(
      screen.getByText(/replaces the current favorite signal/i)
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear direct effect" })
    );

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        kind: "signal",
        itemId: signalScore.itemId,
        signalType: "neutral",
        strength: 1
      })
    );
  });

  it("blocks a duplicate catalog title inside the same owner and domain", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <PreferenceGuidedFlowDialog
        {...baseProps}
        flow={{ kind: "catalog" }}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText("Catalog title"), {
      target: { value: " travel " }
    });
    fireEvent.click(screen.getByRole("button", { name: "Create catalog" }));

    expect(
      await screen.findAllByText(/concept list with this title already exists/i)
    ).not.toHaveLength(0);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits catalog purpose, boundaries, generic links, and a stable retry key", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          x: 20,
          y: 100,
          width: 320,
          height: 48,
          top: 100,
          right: 340,
          bottom: 148,
          left: 20,
          toJSON: () => ({})
        }) as DOMRect
    );
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <PreferenceGuidedFlowDialog
        {...baseProps}
        flow={{ kind: "catalog" }}
        linkOptions={[
          {
            value: "goal:goal_1",
            label: "Choose a breakfast venue",
            kind: "goal"
          }
        ]}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText("Catalog title"), {
      target: { value: "Breakfast options" }
    });
    fireEvent.change(screen.getByLabelText("Decision purpose"), {
      target: { value: "Compare practical breakfast meeting venues." }
    });
    fireEvent.change(screen.getByLabelText("Include"), {
      target: { value: "Quiet cafes within walking distance." }
    });
    fireEvent.change(screen.getByLabelText("Exclude"), {
      target: { value: "Takeaway-only counters." }
    });
    const linkSearch = screen.getByPlaceholderText("Search Forge records");
    fireEvent.focus(linkSearch);
    fireEvent.change(linkSearch, { target: { value: "breakfast" } });
    fireEvent.click(
      screen.getByRole("option", { name: /choose a breakfast venue/i })
    );
    fireEvent.click(screen.getByRole("button", { name: "Create catalog" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "catalog",
          title: "Breakfast options",
          description: "Compare practical breakfast meeting venues.",
          scopeIn: "Quiet cafes within walking distance.",
          scopeOut: "Takeaway-only counters.",
          links: [
            {
              entityType: "goal",
              entityId: "goal_1",
              relationship: "related"
            }
          ],
          idempotencyKey: expect.any(String)
        })
      )
    );
  });

  it("keeps the catalog draft baseline stable across a full remount", () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const firstRender = render(
      <PreferenceGuidedFlowDialog
        {...baseProps}
        flow={{ kind: "catalog" }}
        onSubmit={onSubmit}
      />
    );
    const firstFlow = screen.getByTestId("mock-question-flow");
    const firstKey = firstFlow.getAttribute("data-idempotency-key");
    expect(firstKey).toBeTruthy();
    expect(firstFlow).toHaveAttribute(
      "data-draft-persistence-key",
      "preference-catalog:user_1:projects"
    );

    firstRender.unmount();
    render(
      <PreferenceGuidedFlowDialog
        {...baseProps}
        flow={{ kind: "catalog" }}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByTestId("mock-question-flow")).toHaveAttribute(
      "data-idempotency-key",
      firstKey
    );
  });

  it("uses the guided catalog flow for edits and preserves existing boundaries", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <PreferenceGuidedFlowDialog
        {...baseProps}
        flow={{ kind: "catalog", catalog }}
        onSubmit={onSubmit}
      />
    );
    expect(screen.getByLabelText("Catalog title")).toHaveValue("Travel");
    expect(screen.getByLabelText("Include")).toHaveValue("Leisure travel");
    expect(
      screen.getByText("Confirm ownership and provenance")
    ).toBeInTheDocument();
    expect(screen.getByText("goal: goal_trip")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save catalog" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "catalog",
          catalogId: catalog.id,
          scopeIn: "Leisure travel",
          scopeOut: "Daily commuting",
          links: [
            {
              entityType: "goal",
              entityId: "goal_trip",
              anchorKey: "decision-context",
              relationship: "supports"
            }
          ]
        })
      )
    );
  });

  it("warns but allows distinct direct items with the same label", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const workspace = buildWorkspace();
    workspace.scores = [
      {
        item: { label: "City break" }
      } as PreferenceWorkspacePayload["scores"][number]
    ];
    render(
      <PreferenceGuidedFlowDialog
        {...baseProps}
        workspace={workspace}
        flow={{ kind: "item" }}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText("Item label"), {
      target: { value: "City break" }
    });
    expect(
      screen.getByText(/may still be a distinct preference record/i)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create item" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "item", label: "City break" })
      )
    );
  });

  it("keeps reusable concepts attached to their catalog", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <PreferenceGuidedFlowDialog
        {...baseProps}
        flow={{ kind: "catalog-item", catalog }}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText("Concept label"), {
      target: { value: "Mountain retreat" }
    });
    fireEvent.change(screen.getByLabelText("Tags"), {
      target: { value: "quiet, nature, quiet" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Add concept" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        kind: "catalog-item",
        catalogId: catalog.id,
        label: "Mountain retreat",
        description: "",
        tags: ["quiet", "nature"]
      })
    );
  });

  it("edits an existing reusable concept through the guided flow", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const item = catalog.items[0]!;
    render(
      <PreferenceGuidedFlowDialog
        {...baseProps}
        flow={{ kind: "catalog-item", catalog, item }}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByLabelText("Concept label")).toHaveValue("City break");
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "A short city trip with museums." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save concept" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        kind: "catalog-item",
        catalogId: catalog.id,
        catalogItemId: item.id,
        label: "City break",
        description: "A short city trip with museums.",
        tags: []
      })
    );
  });

  it("submits an evidence-preserving context merge with distinct ids", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <PreferenceGuidedFlowDialog
        {...baseProps}
        flow={{ kind: "merge" }}
        onSubmit={onSubmit}
      />
    );

    const sourceSelect = screen.getByLabelText("Source context");
    expect(
      within(sourceSelect).queryByRole("option", { name: "Default" })
    ).not.toBeInTheDocument();
    fireEvent.change(sourceSelect, {
      target: { value: "context_work" }
    });
    fireEvent.change(screen.getByLabelText("Target context"), {
      target: { value: "context_default" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Merge contexts" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        kind: "merge",
        sourceContextId: "context_work",
        targetContextId: "context_default"
      })
    );
    expect(
      screen.getByText(/source is retained as inactive/i)
    ).toBeInTheDocument();
  });

  it("makes duplicate-safe linked entity provenance explicit", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const candidate = {
      entityType: "project" as const,
      entityId: "project_1",
      domain: "projects" as const,
      label: "Forge Preferences",
      description: "Preference model work",
      user,
      searchText: "forge preferences",
      href: "/projects/project_1"
    };
    render(
      <PreferenceGuidedFlowDialog
        {...baseProps}
        flow={{
          kind: "entity",
          candidate,
          existingItemId: "pref_item_existing"
        }}
        onSubmit={onSubmit}
      />
    );

    expect(
      screen.getByText(/will not duplicate the source identity/i)
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Keep in comparison queue" })
    );

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ kind: "entity", candidate })
    );
  });
});
