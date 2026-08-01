import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CourseDrawer,
  CourseSectionNavigation,
  FeedbackPanel,
  activitySubmissionLabel,
  courseAccentStyle,
  courseDraftStorageKey,
  courseLessonFlowState,
  parseCourseDraft,
  recallWeekCheckpoints
} from "./course-learn-page";
import type {
  CourseActivity,
  CourseAttempt,
  CourseContentBlock,
  LearningSession
} from "@/lib/course-types";

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

describe("course section navigation", () => {
  it("lets a learner revisit the previous section while a checkpoint blocks the next one", () => {
    const onPrevious = vi.fn();
    const onContinue = vi.fn();
    render(
      <CourseSectionNavigation
        currentIndex={2}
        totalSteps={4}
        canContinue={false}
        onPrevious={onPrevious}
        onContinue={onContinue}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Previous section" })
    );
    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onContinue).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Continue" })
    ).not.toBeInTheDocument();
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

function checkpointActivity(
  id: string,
  required = true
): CourseActivity {
  return {
    id,
    title: `Checkpoint ${id}`,
    type: "short_answer",
    promptMarkdown: "Explain your reasoning.",
    conceptIds: ["concept"],
    masteryDimensionIds: ["conceptual_understanding"],
    competencyIds: [],
    assessmentProfileId: "default",
    points: 10,
    estimatedMinutes: 5,
    required,
    reviewAfterDays: [1, 3, 8, 16],
    revision: "2",
    answerGuidance: []
  };
}

function assessedAttempt(
  activityId: string,
  verdict: "pass" | "revise"
): CourseAttempt {
  return {
    id: `attempt-${activityId}`,
    activityId,
    status: "assessed",
    score: verdict === "pass" ? 90 : 55,
    grade: verdict === "pass" ? "A-" : "F",
    pointsAwarded: verdict === "pass" ? 10 : 0,
    answerMarkdown: "My reasoning.",
    submittedAt: "2026-07-25T10:00:00.000Z",
    feedback: {
      verdict,
      score: verdict === "pass" ? 90 : 55,
      grade: verdict === "pass" ? "A-" : "F",
      summary: verdict === "pass" ? "Correct." : "Revise this step.",
      strengths: [],
      issues: [],
      lineFeedback: [],
      criterionScores: [],
      nextStep: "Use the definition explicitly.",
      conceptScores: [],
      misconceptionIds: []
    }
  };
}

function checkpointSession(
  attempts: CourseAttempt[] = []
): Pick<LearningSession, "lesson" | "latestAttempts"> {
  const firstCheckpoint: CourseContentBlock = {
    type: "checkpoint",
    activityId: "first",
    title: "First check",
    introMarkdown: "Explain the definition before continuing.",
    continuation: "after_pass"
  };
  const secondCheckpoint: CourseContentBlock = {
    type: "checkpoint",
    activityId: "exit",
    title: "Exit check",
    introMarkdown: "Apply the idea without copying the model.",
    continuation: "after_pass"
  };
  return {
    lesson: {
      id: "lesson",
      moduleId: "module",
      week: 1,
      day: 1,
      order: 0,
      title: "A progressive lesson",
      summary: "Learn, explain, and apply.",
      estimatedMinutes: 40,
      conceptIds: ["concept"],
      objectives: ["Explain the central definition."],
      content: [
        { type: "markdown", markdown: "Teach the definition." },
        firstCheckpoint,
        { type: "markdown", markdown: "Now study a worked example." },
        secondCheckpoint,
        { type: "markdown", markdown: "Connect this result to tomorrow." }
      ],
      activities: [
        checkpointActivity("first"),
        checkpointActivity("exit")
      ]
    },
    latestAttempts: attempts
  };
}

describe("progressive lesson flow", () => {
  it("shows the whole lesson while marking the first unanswered checkpoint", () => {
    const flow = courseLessonFlowState(checkpointSession());
    expect(flow.blocks).toHaveLength(5);
    expect(flow.availableActivityIds).toEqual(["first", "exit"]);
    expect(flow.blockedBy?.activityId).toBe("first");
    expect(flow.complete).toBe(false);
  });

  it("keeps later sections available while moving the guidance marker", () => {
    const reviseFlow = courseLessonFlowState(
      checkpointSession([assessedAttempt("first", "revise")])
    );
    expect(reviseFlow.blocks).toHaveLength(5);
    expect(reviseFlow.availableActivityIds).toEqual(["first", "exit"]);
    expect(reviseFlow.blockedBy?.activityId).toBe("first");

    const passFlow = courseLessonFlowState(
      checkpointSession([assessedAttempt("first", "pass")])
    );
    expect(passFlow.blocks).toHaveLength(5);
    expect(passFlow.availableActivityIds).toEqual(["first", "exit"]);
    expect(passFlow.blockedBy?.activityId).toBe("exit");
  });

  it("completes only after every required checkpoint passes", () => {
    const flow = courseLessonFlowState(
      checkpointSession([
        assessedAttempt("first", "pass"),
        assessedAttempt("exit", "pass")
      ])
    );
    expect(flow.blocks).toHaveLength(5);
    expect(flow.blockedBy).toBeNull();
    expect(flow.complete).toBe(true);
  });

  it("keeps legacy lessons fully visible while honoring required completion", () => {
    const session = checkpointSession([assessedAttempt("first", "pass")]);
    session.lesson.content = [
      { type: "markdown", markdown: "A legacy lesson page." }
    ];
    const flow = courseLessonFlowState(session);
    expect(flow.blocks).toEqual(session.lesson.content);
    expect(flow.availableActivityIds).toEqual(["first", "exit"]);
    expect(flow.complete).toBe(false);
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
