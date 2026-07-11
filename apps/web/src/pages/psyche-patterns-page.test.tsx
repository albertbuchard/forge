import { describe, expect, it } from "vitest";
import { resolvePatternContinueBlocker } from "@/pages/psyche-patterns-page";
import type { BehaviorPatternInput } from "@/lib/psyche-schemas";

const completePattern: BehaviorPatternInput = {
  title: "Reassurance loop",
  description: "",
  targetBehavior: "I reread the message and ask twice if everything is okay.",
  cueContexts: ["A friend does not reply after a vulnerable message."],
  shortTermPayoff: "I briefly feel certain that the relationship is safe.",
  longTermCost: "I lose focus and put pressure on the relationship.",
  preferredResponse: "I wait ten minutes, name the uncertainty, then ask once.",
  linkedValueIds: [],
  linkedSchemaLabels: [],
  linkedModeIds: [],
  linkedBeliefIds: [],
  userId: null
};

describe("behavior-pattern guided flow", () => {
  const blockerCases: Array<[string, Partial<BehaviorPatternInput>, RegExp]> = [
    ["context", { cueContexts: [] }, /specific situation or cue/i],
    ["response", { targetBehavior: "  " }, /visible response/i],
    ["impact", { shortTermPayoff: "" }, /immediate relief or protection/i],
    ["impact", { longTermCost: "" }, /later cost/i],
    ["alternative", { preferredResponse: "" }, /concrete response/i]
  ];

  it.each(blockerCases)(
    "blocks the %s step until its functional detail is concrete",
    (stepId, patch, expectedMessage) => {
      expect(
        resolvePatternContinueBlocker(stepId, {
          ...completePattern,
          ...patch
        })
      ).toMatch(expectedMessage);
    }
  );

  it("allows each required stage to advance once the full pattern is concrete", () => {
    for (const stepId of ["context", "response", "impact", "alternative"]) {
      expect(resolvePatternContinueBlocker(stepId, completePattern)).toBeNull();
    }
  });

  it("lets a legacy sparse pattern remain sparse while it is being edited", () => {
    const sparsePattern = {
      ...completePattern,
      cueContexts: [],
      shortTermPayoff: "",
      longTermCost: ""
    };

    expect(
      resolvePatternContinueBlocker("context", sparsePattern, true)
    ).toBeNull();
    expect(
      resolvePatternContinueBlocker("impact", sparsePattern, true)
    ).toBeNull();
  });
});
