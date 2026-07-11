import { describe, expect, it } from "vitest";
import {
  findDuplicateInsight,
  getInsightTargetValidationError,
  getVisibleInsightCandidates,
  type InsightEntityCandidate
} from "@/components/insights/insight-flow-dialog";
import type { CreateInsightInput } from "@/lib/schemas";
import type { Insight } from "@/lib/types";

const input: CreateInsightInput = {
  originType: "user",
  originAgentId: "",
  originLabel: "",
  entityType: "project",
  entityId: "project_alpha",
  timeframeLabel: "This week",
  title: "Protect the review boundary",
  summary: "The week needs one exact evidence window.",
  recommendation: "Keep every review event inside that window.",
  rationale: "",
  confidence: 0.72,
  ctaLabel: "Review insight"
};

function insight(patch: Partial<Insight> = {}): Insight {
  return {
    id: "insight_existing",
    originType: "user",
    originAgentId: null,
    originLabel: null,
    visibility: "visible",
    status: "open",
    entityType: "project",
    entityId: "project_alpha",
    timeframeLabel: "this   week",
    title: " protect the review boundary ",
    summary: "The week needs one exact evidence window.",
    recommendation: "Keep every review event inside that window.",
    rationale: "",
    confidence: 0.72,
    ctaLabel: "Review insight",
    evidence: [],
    createdAt: "2026-07-11T08:00:00.000Z",
    updatedAt: "2026-07-11T08:00:00.000Z",
    userId: null,
    user: null,
    ...patch
  };
}

describe("insight flow safeguards", () => {
  it("requires an exact linked record for targeted insights", () => {
    expect(getInsightTargetValidationError("project", "")).toMatch(
      /specific record/i
    );
    expect(
      getInsightTargetValidationError("project", "project_alpha")
    ).toBeNull();
    expect(getInsightTargetValidationError("general", "")).toBeNull();
  });

  it("finds exact active duplicates after whitespace and case normalization", () => {
    expect(findDuplicateInsight(input, [insight()])?.id).toBe(
      "insight_existing"
    );
    expect(
      findDuplicateInsight(input, [insight({ status: "dismissed" })])
    ).toBeNull();
    expect(
      findDuplicateInsight(input, [insight({ timeframeLabel: "Next week" })])
    ).toBeNull();
  });

  it("searches all supplied records while bounding rendered candidates", () => {
    const candidates: InsightEntityCandidate[] = Array.from(
      { length: 20 },
      (_, index) => ({
        entityType: "task",
        entityId: `task_${index}`,
        kind: "task",
        label: index === 17 ? "Boundary audit" : `Task ${index}`,
        description: `Evidence item ${index}`
      })
    );

    expect(getVisibleInsightCandidates(candidates, "task", "")).toMatchObject({
      total: 20,
      visible: { length: 12 }
    });
    expect(
      getVisibleInsightCandidates(candidates, "task", "boundary").visible[0]
        ?.entityId
    ).toBe("task_17");
  });
});
