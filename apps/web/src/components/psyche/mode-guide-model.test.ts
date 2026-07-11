import { describe, expect, it } from "vitest";
import {
  buildModeGuideHypothesis,
  buildModeGuideSessionInput,
  DEFAULT_MODE_GUIDE_DRAFT,
  getModeGuideStepError,
  type ModeGuideDraft
} from "@/components/psyche/mode-guide-model";

function createDraft(patch: Partial<ModeGuideDraft> = {}): ModeGuideDraft {
  return {
    ...DEFAULT_MODE_GUIDE_DRAFT,
    summary: "I went quiet after a tense exchange.",
    copingResponse: "detach",
    childState: "vulnerable",
    criticStyle: "demanding",
    healthyContact: "healthy_adult",
    interpretationStance: "partly",
    correction: "I was also trying not to escalate the conversation.",
    nextResponse: "set_boundary",
    saveDecision: "save",
    ...patch
  };
}

describe("mode guide model", () => {
  it("offers a functional hypothesis with explicit uncertainty", () => {
    const hypothesis = buildModeGuideHypothesis(createDraft());

    expect(hypothesis).toContain("tried to help");
    expect(hypothesis).toContain("may have been a need");
    expect(hypothesis).toContain("working hypothesis, not a diagnosis");
  });

  it("preserves corrections and next responses in the existing answer contract", () => {
    const input = buildModeGuideSessionInput(createDraft());

    expect(input.summary).toBe("I went quiet after a tense exchange.");
    expect(input.answers).toEqual(
      expect.arrayContaining([
        { questionKey: "coping_response", value: "detach" },
        { questionKey: "interpretation_stance", value: "partly" },
        {
          questionKey: "user_correction",
          value: "I was also trying not to escalate the conversation."
        },
        { questionKey: "next_response", value: "set_boundary" }
      ])
    );
  });

  it("does not submit declined or uncertain labels to the scoring keys", () => {
    const input = buildModeGuideSessionInput(
      createDraft({ interpretationStance: "decline" })
    );

    expect(input.answers).toEqual(
      expect.arrayContaining([
        { questionKey: "coping_response", value: "none" },
        { questionKey: "child_state", value: "none" },
        { questionKey: "reported_coping_response", value: "detach" },
        { questionKey: "interpretation_stance", value: "decline" }
      ])
    );
  });

  it("requires own words, interpretation control, a next response, and save consent", () => {
    expect(getModeGuideStepError("moment", DEFAULT_MODE_GUIDE_DRAFT)).toContain(
      "own words"
    );
    expect(getModeGuideStepError("check", DEFAULT_MODE_GUIDE_DRAFT)).toContain(
      "working hypothesis"
    );
    expect(
      getModeGuideStepError("next-response", DEFAULT_MODE_GUIDE_DRAFT)
    ).toContain("smallest response");
    expect(
      getModeGuideStepError("consent", DEFAULT_MODE_GUIDE_DRAFT)
    ).toContain("save");
  });
});
