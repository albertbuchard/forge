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
    onSubmit
  }: {
    open: boolean;
    value: unknown;
    onChange: (value: unknown) => void;
    steps: Array<{
      id: string;
      render: (
        value: unknown,
        setValue: (patch: Record<string, unknown>) => void
      ) => ReactNode;
    }>;
    submitLabel: string;
    error?: string | null;
    onSubmit: () => Promise<void>;
  }) =>
    open ? (
      <div>
        {error ? <div role="alert">{error}</div> : null}
        {steps.map((step) => (
          <section key={step.id}>
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
  domain: "projects",
  slug: "travel",
  title: "Travel",
  description: "Trip shapes",
  source: "custom",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
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
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  ]
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

const baseProps = {
  onOpenChange: vi.fn(),
  pending: false,
  user,
  domain: "projects" as const,
  workspace: buildWorkspace()
};

describe("PreferenceGuidedFlowDialog", () => {
  afterEach(() => cleanup());

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
