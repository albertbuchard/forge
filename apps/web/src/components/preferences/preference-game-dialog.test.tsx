import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PreferenceGameDialog } from "./preference-game-dialog";
import type { PreferenceItem, PreferenceWorkspacePayload } from "@/lib/types";

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

const left = item("item_left", "Deep focus");
const right = item("item_right", "Fast iteration");

const workspace = {
  selectedContext: { name: "Deep work" },
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
} as PreferenceWorkspacePayload;

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
  onSelectDomain: vi.fn(),
  onStartCatalogGame: vi.fn()
};

describe("PreferenceGameDialog", () => {
  it("supports keyboard judgments and explains context-specific model effects", () => {
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
      screen.getAllByText(/neutral records zero score weight/i)
    ).not.toHaveLength(0);

    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "T" });

    expect(onJudge).toHaveBeenNthCalledWith(1, "left", 1);
    expect(onJudge).toHaveBeenNthCalledWith(2, "tie", 1);

    fireEvent.click(screen.getAllByRole("button", { name: "Favorite" })[0]!);
    expect(onSignal).toHaveBeenCalledWith("item_left", "favorite");
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
      screen.getAllByRole("button", { name: "Favorite" })[0]
    ).toBeDisabled();
  });
});
