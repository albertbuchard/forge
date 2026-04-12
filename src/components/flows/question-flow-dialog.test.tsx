import { describe, expect, it } from "vitest";
import { resolveQuestionFlowStepIndex } from "@/components/flows/question-flow-dialog";

describe("resolveQuestionFlowStepIndex", () => {
  const steps = [{ id: "details" }, { id: "review" }, { id: "confirm" }];

  it("resets closed dialogs back to the first step without looping state", () => {
    expect(
      resolveQuestionFlowStepIndex({
        open: false,
        wasOpen: true,
        initialStepId: "review",
        previousInitialStepId: "review",
        currentStepIndex: 2,
        steps
      })
    ).toBe(0);
  });

  it("opens on the requested initial step when the dialog is activated", () => {
    expect(
      resolveQuestionFlowStepIndex({
        open: true,
        wasOpen: false,
        initialStepId: "review",
        previousInitialStepId: undefined,
        currentStepIndex: 0,
        steps
      })
    ).toBe(1);
  });

  it("keeps the current step when nothing meaningfully changed", () => {
    expect(
      resolveQuestionFlowStepIndex({
        open: true,
        wasOpen: true,
        initialStepId: "review",
        previousInitialStepId: "review",
        currentStepIndex: 1,
        steps
      })
    ).toBe(1);
  });

  it("clamps stale step indexes back into range", () => {
    expect(
      resolveQuestionFlowStepIndex({
        open: true,
        wasOpen: true,
        initialStepId: undefined,
        previousInitialStepId: undefined,
        currentStepIndex: 9,
        steps
      })
    ).toBe(2);
  });
});
