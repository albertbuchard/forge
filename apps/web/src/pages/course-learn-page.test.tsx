import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CourseDrawer,
  FeedbackPanel,
  activitySubmissionLabel,
  courseAccentStyle,
  courseDraftStorageKey,
  parseCourseDraft,
  recallWeekCheckpoints
} from "./course-learn-page";

describe("course activity labels", () => {
  it("distinguishes deterministic, proof, written, and extension submission", () => {
    expect(activitySubmissionLabel("multiple_choice")).toBe("Check answer");
    expect(activitySubmissionLabel("proof")).toBe("Submit for proof review");
    for (const type of [
      "short_answer",
      "computation",
      "reflection",
      "recall"
    ] as const) {
      expect(activitySubmissionLabel(type)).toBe("Submit for written review");
    }
    expect(activitySubmissionLabel("extension")).toBe("Submit activity");
  });
});

describe("recall interval presentation", () => {
  it("turns authored source-week references into explicit learner intervals", () => {
    expect(
      recallWeekCheckpoints(
        17,
        "Retrieve Week 16, Week 14, Week 9, and Week 1. Ignore Week 17."
      )
    ).toEqual([
      { intervalWeeks: 1, sourceWeek: 16 },
      { intervalWeeks: 3, sourceWeek: 14 },
      { intervalWeeks: 8, sourceWeek: 9 },
      { intervalWeeks: 16, sourceWeek: 1 }
    ]);
  });
});

function DrawerHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open concepts</button>
      {open ? (
        <CourseDrawer label="Concept ledger" onClose={() => setOpen(false)}>
          <button>First action</button>
          <button>Last action</button>
        </CourseDrawer>
      ) : null}
    </>
  );
}

describe("course drawer", () => {
  it("traps focus, closes with Escape, and restores the trigger", async () => {
    render(<DrawerHarness />);
    const trigger = screen.getByRole("button", { name: "Open concepts" });
    trigger.focus();
    fireEvent.click(trigger);

    const first = screen.getByRole("button", { name: "First action" });
    const last = screen.getByRole("button", { name: "Last action" });
    await waitFor(() => expect(first).toHaveFocus());
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });
});

describe("course presentation boundary", () => {
  it("lets a package provide accents without replacing Forge surfaces or ink", () => {
    expect(
      courseAccentStyle({
        accent: "#a84637",
        highlight: "#d1a44a",
        paper: "#f4efe5",
        ink: "#10233f"
      })
    ).toEqual({
      "--course-package-accent": "#a84637",
      "--course-package-highlight": "#d1a44a"
    });
  });
});

describe("course drafts", () => {
  it("scopes a draft to the learner, course, lesson, and activity", () => {
    expect(
      courseDraftStorageKey({
        userId: "learner 1",
        courseId: "course",
        lessonId: "lesson",
        activityId: "proof"
      })
    ).toBe("forge%3Acourse-draft%3Av1:learner%201:course:lesson:proof");
  });

  it("accepts only the current validated draft shape", () => {
    const draft = {
      version: 1 as const,
      answer: "Let w be nonzero.",
      selectedOptions: [],
      updatedAt: "2026-07-22T20:00:00.000Z"
    };
    expect(parseCourseDraft(JSON.stringify(draft))).toEqual(draft);
    expect(parseCourseDraft('{"version":1,"answer":4}')).toBeNull();
    expect(parseCourseDraft("not json")).toBeNull();
  });
});

describe("automated proof feedback", () => {
  it("labels model feedback as automated and fallible", () => {
    render(
      <FeedbackPanel
        feedback={{
          verdict: "pass",
          score: 92,
          grade: "A",
          summary: "The proof is correct.",
          strengths: [],
          issues: [],
          lineFeedback: [],
          criterionScores: [],
          nextStep: "Polish the final sentence.",
          conceptScores: [],
          misconceptionIds: []
        }}
      />
    );

    expect(
      screen.getByText("Forge automated proof review")
    ).toBeInTheDocument();
    expect(screen.getByText("Automated review passed")).toBeInTheDocument();
    expect(
      screen.getByText(/Model-generated feedback can be wrong/u)
    ).toBeInTheDocument();
  });
});
