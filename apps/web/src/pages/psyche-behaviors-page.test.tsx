import { describe, expect, it } from "vitest";
import { resolveBehaviorContinueBlocker } from "@/pages/psyche-behaviors-page";
import {
  behaviorCreateSchema,
  behaviorSchema,
  type BehaviorInput
} from "@/lib/psyche-schemas";

const completeAwayBehavior: BehaviorInput = {
  kind: "away",
  title: "Check the message again",
  description:
    "I unlock my phone, reopen the chat, and reread the last message.",
  commonCues: ["The reply has not arrived after an hour."],
  urgeStory: "Just check once more. Then I'll know whether we're okay.",
  shortTermPayoff: "I get a brief sense that I am doing something.",
  longTermCost: "I lose focus and become more tense.",
  replacementMove: "Put the phone down and finish one small task.",
  repairPlan: "Name the spiral and return to the task without blaming myself.",
  linkedPatternIds: [],
  linkedValueIds: [],
  linkedSchemaIds: [],
  linkedModeIds: [],
  userId: null
};

describe("Psyche behavior guided flow", () => {
  it("requires an observable action instead of accepting an adjacent entity description", () => {
    const blocker = resolveBehaviorContinueBlocker("behavior", {
      ...completeAwayBehavior,
      description: ""
    });

    expect(blocker).toMatch(/observable behavior/i);
    expect(blocker).toMatch(/belief, pattern, goal, or episode report/i);
    expect(
      behaviorCreateSchema.safeParse({
        ...completeAwayBehavior,
        description: ""
      }).success
    ).toBe(false);
  });

  const missingCreateCases: Array<[string, Partial<BehaviorInput>, RegExp]> = [
    ["context", { commonCues: [] }, /situation or cue/i],
    ["context", { urgeStory: "" }, /urge or inner push/i],
    ["context", { shortTermPayoff: "" }, /provides right away/i],
    ["response", { longTermCost: "" }, /cost that appears later/i]
  ];

  it.each(missingCreateCases)(
    "asks only for the missing create detail on the %s step",
    (stepId, patch, expectedMessage) => {
      expect(
        resolveBehaviorContinueBlocker(stepId, {
          ...completeAwayBehavior,
          ...patch
        })
      ).toMatch(expectedMessage);
    }
  );

  it("allows a complete create flow and preserves the user's urge wording", () => {
    for (const stepId of [
      "behavior",
      "classification",
      "context",
      "response"
    ]) {
      expect(
        resolveBehaviorContinueBlocker(stepId, completeAwayBehavior)
      ).toBeNull();
    }

    const parsed = behaviorCreateSchema.parse(completeAwayBehavior);
    expect(parsed.urgeStory).toBe(
      "Just check once more. Then I'll know whether we're okay."
    );
    expect(parsed.description).toBe(
      "I unlock my phone, reopen the chat, and reread the last message."
    );
  });

  it("keeps a complete edit valid without asking for information already present", () => {
    const editedBehavior = {
      ...completeAwayBehavior,
      description:
        "I unlock my phone and reread their exact words before I can continue."
    };

    for (const stepId of [
      "behavior",
      "classification",
      "context",
      "response"
    ]) {
      expect(
        resolveBehaviorContinueBlocker(stepId, editedBehavior, true)
      ).toBeNull();
    }
    expect(behaviorSchema.parse(editedBehavior).description).toBe(
      editedBehavior.description
    );
  });

  it("preserves sparse legacy records while still applying stronger create guidance", () => {
    const legacyBehavior: BehaviorInput = {
      ...completeAwayBehavior,
      description: "",
      commonCues: [],
      urgeStory: "",
      shortTermPayoff: "",
      longTermCost: "",
      replacementMove: "",
      repairPlan: ""
    };

    expect(behaviorSchema.safeParse(legacyBehavior).success).toBe(true);
    expect(behaviorCreateSchema.safeParse(legacyBehavior).success).toBe(false);
    for (const stepId of [
      "behavior",
      "classification",
      "context",
      "response"
    ]) {
      expect(
        resolveBehaviorContinueBlocker(stepId, legacyBehavior, true)
      ).toBeNull();
    }
  });

  it("asks recovery moves for a concrete repair action without away-move demands", () => {
    const recoveryBehavior: BehaviorInput = {
      ...completeAwayBehavior,
      kind: "recovery",
      urgeStory: "",
      shortTermPayoff: "",
      longTermCost: "",
      repairPlan: ""
    };

    expect(
      resolveBehaviorContinueBlocker("context", recoveryBehavior)
    ).toBeNull();
    expect(
      resolveBehaviorContinueBlocker("response", recoveryBehavior)
    ).toMatch(/repair, steady, or return/i);
    expect(behaviorCreateSchema.safeParse(recoveryBehavior).success).toBe(
      false
    );
  });
});
