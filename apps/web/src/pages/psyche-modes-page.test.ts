import { describe, expect, it } from "vitest";
import type { ModeProfileInput } from "@/lib/psyche-schemas";
import { resolveModeContinueBlocker } from "./psyche-modes-page";

const mode: ModeProfileInput = {
  family: "coping",
  archetype: "watchful protector",
  title: "The Scanner",
  persona: "Alert and searching for signs of rejection.",
  imagery: "",
  symbolicForm: "",
  facialExpression: "",
  fear: "Being surprised by rejection.",
  burden: "Never being allowed to relax.",
  protectiveJob: "Notice danger early enough to avoid humiliation.",
  originContext: "",
  firstAppearanceAt: null,
  linkedPatternIds: [],
  linkedBehaviorIds: [],
  linkedValueIds: [],
  userId: null
};

describe("mode-profile guided formulation", () => {
  it("requires a tentative name and protective-function hypothesis for new modes", () => {
    expect(
      resolveModeContinueBlocker("identity", { ...mode, title: "" })
    ).toMatch(/working name/i);
    expect(
      resolveModeContinueBlocker("burden", { ...mode, protectiveJob: "" })
    ).toMatch(/working hypothesis/i);
  });

  it("does not force a legacy sparse mode to invent a protective function on edit", () => {
    expect(
      resolveModeContinueBlocker("burden", { ...mode, protectiveJob: "" }, true)
    ).toBeNull();
  });
});
