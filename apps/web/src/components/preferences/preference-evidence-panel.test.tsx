import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PreferenceEvidencePanel } from "./preference-evidence-panel";
import type { PreferenceItemScore } from "@/lib/types";

const score: PreferenceItemScore = {
  id: "score_1",
  profileId: "profile_1",
  contextId: "context_1",
  itemId: "item_1",
  latentScore: 0.72,
  confidence: 0.68,
  uncertainty: 0.32,
  evidenceCount: 8,
  pairwiseWins: 4,
  pairwiseLosses: 1,
  pairwiseTies: 1,
  signalCount: 2,
  conflictCount: 1,
  status: "liked",
  dominantDimensions: ["rigor", "depth"],
  explanation: ["One", "Two", "Three", "Four", "Hidden fifth"],
  manualStatus: "favorite",
  manualScore: null,
  confidenceLock: 0.8,
  bookmarked: true,
  compareLater: false,
  frozen: true,
  lastInferredAt: "2026-01-02T00:00:00.000Z",
  lastJudgmentAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  item: {
    id: "item_1",
    profileId: "profile_1",
    label: "Thesis project",
    description: "",
    tags: [],
    featureWeights: {
      novelty: 0,
      simplicity: 0,
      rigor: 0.8,
      aesthetics: 0,
      depth: 0.9,
      structure: 0,
      familiarity: 0,
      surprise: 0
    },
    sourceEntityType: "project",
    sourceEntityId: "project_1",
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  }
};

describe("PreferenceEvidencePanel", () => {
  it("shows bounded evidence, provenance, conflicts, and manual model effects", () => {
    render(
      <PreferenceEvidencePanel
        score={score}
        contextName="Deep work"
        modelVersion="pref-v1-bt-lite"
      />
    );

    expect(
      screen.getByText(/inferred in deep work with model pref-v1-bt-lite/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText("4", { selector: ".font-medium" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1 conflicting signal reduces confidence/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/manual model controls are active/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/source: project · project_1/i)
    ).toBeInTheDocument();
    expect(screen.queryByText("Hidden fifth")).not.toBeInTheDocument();
  });
});
