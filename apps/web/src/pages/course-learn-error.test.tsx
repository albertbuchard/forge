import { QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ForgeApiError } from "@/lib/api-error";
import { createForgeQueryClient } from "@/lib/app-runtime";
import type { LearningSession } from "@/lib/course-types";

const apiMocks = vi.hoisted(() => ({
  getForgeLearningSession: vi.fn(),
  submitForgeCourseAttempt: vi.fn()
}));

vi.mock("@/lib/api", () => apiMocks);
vi.mock("@/components/shell/app-shell", () => ({
  useForgeShell: () => ({ selectedUserIds: ["user_operator"] })
}));

import { CourseLearnPage } from "./course-learn-page";

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}

describe("locked Course lesson recovery", () => {
  const currentLessonSession: LearningSession = {
    course: {
      id: "course-a",
      slug: "course-a",
      version: "1.0.0",
      schemaVersion: "1",
      title: "Course A",
      subtitle: "A bounded course",
      description: "Course description.",
      language: "en",
      authors: ["Forge"],
      license: "Private",
      estimatedWeeks: 1,
      minutesPerWeek: 30,
      tags: [],
      entryLessonId: "lesson-current",
      featuredLessonId: null,
      sourceUrl: null,
      contentHash: "content-hash",
      presentation: {
        preset: "editorial",
        brandLabel: "Forge Course",
        defaultLessonLayoutId: "default",
        theme: {
          accent: "#123456",
          highlight: "#abcdef",
          paper: "#ffffff",
          ink: "#111111"
        },
        extensions: []
      },
      grading: {
        defaultAssessmentProfileId: "default",
        attemptAggregation: "latest",
        pointsPolicy: "first_completion",
        lessonCompletion: "all_required",
        gradeScale: [{ minimum: 0, label: "—" }],
        masteryDimensions: []
      },
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z"
    },
    release: {
      enrolledVersion: "1.0.0",
      latestVersion: "1.0.0",
      updateAvailable: false
    },
    progress: {
      completedLessons: 0,
      totalLessons: 1,
      progressPercent: 0,
      averageScore: null,
      grade: null,
      pointsEarned: 0,
      currentLessonId: "lesson-current"
    },
    lesson: {
      id: "lesson-current",
      moduleId: "module-a",
      week: 1,
      day: 1,
      order: 0,
      title: "Current foundation",
      summary: "The learner's current unlocked lesson.",
      estimatedMinutes: 20,
      conceptIds: [],
      objectives: ["Explain the current idea."],
      content: [
        {
          type: "checkpoint",
          activityId: "activity-current",
          title: "Current check",
          introMarkdown: "Explain the idea.",
          continuation: "after_pass"
        }
      ],
      activities: [
        {
          id: "activity-current",
          title: "Current check",
          type: "short_answer",
          promptMarkdown: "Explain the current idea.",
          conceptIds: [],
          masteryDimensionIds: [],
          competencyIds: [],
          assessmentProfileId: "default",
          points: 1,
          estimatedMinutes: 5,
          required: true,
          reviewAfterDays: [],
          revision: "1",
          answerGuidance: []
        }
      ]
    },
    flow: {
      availableActivityIds: ["activity-current"],
      submittableActivityIds: ["activity-current"],
      blockedByActivityId: "activity-current",
      disclosure: "checkpoint_frontier"
    },
    resources: [],
    modules: [
      {
        id: "module-a",
        title: "Module A",
        description: "Module description.",
        order: 0,
        startWeek: 1,
        endWeek: 1,
        lessonIds: ["lesson-current"]
      }
    ],
    navigation: [
      {
        id: "lesson-current",
        moduleId: "module-a",
        week: 1,
        day: 1,
        order: 0,
        title: "Current foundation",
        completed: false,
        unlocked: true
      }
    ],
    previousLessonId: null,
    nextLessonId: null,
    concepts: [],
    latestAttempts: [null]
  };

  beforeEach(() => {
    apiMocks.getForgeLearningSession
      .mockReset()
      .mockRejectedValueOnce(
        new ForgeApiError({
          status: 409,
          code: "course_lesson_locked",
          message: "Complete the preceding lesson first.",
          requestPath: "/api/v1/courses/course-a/learn"
        })
      )
      .mockRejectedValueOnce(
        new ForgeApiError({
          status: 409,
          code: "course_lesson_locked",
          message: "Complete the preceding lesson first.",
          requestPath: "/api/v1/courses/course-a/learn"
        })
      )
      .mockResolvedValueOnce(currentLessonSession);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps deliberate Retry stable and separately opens the current lesson after a locked bookmark", async () => {
    const queryClient = createForgeQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[
            "/courses/course-a/learn?lesson=mp-algebra-week-40-day-3"
          ]}
        >
          <LocationProbe />
          <Routes>
            <Route
              path="/courses/:courseId/learn"
              element={<CourseLearnPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await screen.findByText(/course_lesson_locked/);
    await waitFor(() =>
      expect(apiMocks.getForgeLearningSession).toHaveBeenCalledTimes(1)
    );
    expect(apiMocks.submitForgeCourseAttempt).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(apiMocks.getForgeLearningSession).toHaveBeenCalledTimes(2)
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/courses/course-a/learn?lesson=mp-algebra-week-40-day-3"
    );
    expect(apiMocks.getForgeLearningSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ lessonId: "mp-algebra-week-40-day-3" })
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open current lesson" })
    );
    await waitFor(() =>
      expect(apiMocks.getForgeLearningSession).toHaveBeenCalledTimes(3)
    );
    expect(apiMocks.getForgeLearningSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ lessonId: undefined })
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/courses/course-a/learn"
    );
    expect(await screen.findAllByText("Current foundation")).not.toHaveLength(
      0
    );
    expect(apiMocks.submitForgeCourseAttempt).not.toHaveBeenCalled();
    queryClient.clear();
  });

  it("renders the complete lesson and keeps feedback guidance attached to real feedback", async () => {
    const firstActivity = currentLessonSession.lesson.activities[0]!;
    const secondActivity = {
      ...firstActivity,
      id: "activity-transfer",
      title: "Transfer the idea",
      promptMarkdown: "Apply the idea to a different example."
    };
    const completeLessonSession: LearningSession = {
      ...currentLessonSession,
      lesson: {
        ...currentLessonSession.lesson,
        summary: "Read a definition, inspect a model, and transfer the idea.",
        estimatedMinutes: 55,
        content: [
          {
            type: "markdown",
            markdown:
              "# Read the complete argument\n\nStart from the definition."
          },
          {
            type: "checkpoint",
            activityId: firstActivity.id,
            title: firstActivity.title,
            introMarkdown: "Explain the definition.",
            continuation: "after_pass"
          },
          {
            type: "markdown",
            markdown:
              "### Use the feedback before continuing\n\nRepair the first unsupported inference."
          },
          {
            type: "markdown",
            markdown:
              "## Worked model\n\nHere is the complete intermediate argument."
          },
          {
            type: "checkpoint",
            activityId: secondActivity.id,
            title: secondActivity.title,
            introMarkdown: "Transfer the idea.",
            continuation: "after_pass"
          }
        ],
        activities: [firstActivity, secondActivity]
      },
      navigation: [
        ...currentLessonSession.navigation,
        {
          id: "lesson-later",
          moduleId: "module-a",
          week: 1,
          day: 2,
          order: 1,
          title: "A later lesson",
          completed: false,
          unlocked: true
        }
      ],
      nextLessonId: "lesson-later",
      latestAttempts: [null, null]
    };
    apiMocks.getForgeLearningSession
      .mockReset()
      .mockResolvedValue(completeLessonSession);
    const queryClient = createForgeQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={["/courses/course-a/learn?lesson=lesson-current"]}
        >
          <Routes>
            <Route
              path="/courses/:courseId/learn"
              element={<CourseLearnPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(
      await screen.findByRole("heading", { name: "Read the complete argument" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Worked model" })
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("region", { name: "Question 1: Current check" })
      ).getByText("Explain the current idea.")
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("region", {
          name: "Question 2: Transfer the idea"
        })
      ).getByText("Apply the idea to a different example.")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Use the feedback before continuing")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/One section at a time/u)
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next day" })).toBeEnabled();

    queryClient.clear();
  });

  it("renders answerable questions for legacy lessons without checkpoint blocks", async () => {
    const firstActivity = currentLessonSession.lesson.activities[0]!;
    const secondActivity = {
      ...firstActivity,
      id: "activity-legacy-transfer",
      title: "Legacy transfer",
      promptMarkdown: "Transfer the argument to a second case."
    };
    const legacySession: LearningSession = {
      ...currentLessonSession,
      lesson: {
        ...currentLessonSession.lesson,
        content: [
          {
            type: "markdown",
            markdown:
              "# Legacy authored chapter\n\nThe complete teaching remains readable before the written work."
          }
        ],
        activities: [firstActivity, secondActivity]
      },
      flow: {
        availableActivityIds: [firstActivity.id, secondActivity.id],
        submittableActivityIds: [firstActivity.id, secondActivity.id],
        blockedByActivityId: firstActivity.id,
        disclosure: "checkpoint_frontier"
      },
      latestAttempts: [null, null]
    };
    apiMocks.getForgeLearningSession
      .mockReset()
      .mockResolvedValue(legacySession);
    const queryClient = createForgeQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={["/courses/course-a/learn?lesson=lesson-current"]}
        >
          <Routes>
            <Route
              path="/courses/:courseId/learn"
              element={<CourseLearnPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(
      await screen.findByRole("heading", { name: "Legacy authored chapter" })
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("region", { name: "Question 1: Current check" })
      ).getByText("Explain the current idea.")
    ).toBeInTheDocument();
    const secondQuestion = screen.getByRole("region", {
      name: "Question 2: Legacy transfer"
    });
    expect(
      within(secondQuestion).getByText(
        "Transfer the argument to a second case."
      )
    ).toBeInTheDocument();
    fireEvent.click(
      within(secondQuestion).getByRole("button", {
        name: "Write your response"
      })
    );
    expect(
      within(secondQuestion).getByRole("textbox", { name: "Your solution" })
    ).toBeInTheDocument();

    queryClient.clear();
  });

  it("reveals a repair bridge only beside feedback for its own question", async () => {
    const activity = currentLessonSession.lesson.activities[0]!;
    const feedbackSession: LearningSession = {
      ...currentLessonSession,
      lesson: {
        ...currentLessonSession.lesson,
        content: [
          {
            type: "checkpoint",
            activityId: activity.id,
            title: activity.title,
            introMarkdown: "Explain the definition.",
            continuation: "always"
          },
          {
            type: "extension",
            namespace: "forge",
            renderer: "feedback-bridge",
            version: "1",
            data: {
              activityId: activity.id,
              markdown:
                "### Correct and retry\n\nRepair the first unsupported inference."
            }
          }
        ]
      },
      latestAttempts: [
        {
          id: "attempt-current",
          activityId: activity.id,
          status: "assessed",
          score: 50,
          grade: "Revise",
          pointsAwarded: 0,
          answerMarkdown: "An incomplete explanation.",
          submittedAt: "2026-08-01T12:00:00.000Z",
          feedback: {
            verdict: "revise",
            score: 50,
            grade: "Revise",
            summary: "The implication is not justified.",
            strengths: [],
            issues: ["The central implication is unsupported."],
            lineFeedback: [],
            criterionScores: [],
            nextStep: "State the definition before the implication.",
            conceptScores: [],
            misconceptionIds: []
          }
        }
      ]
    };
    apiMocks.getForgeLearningSession
      .mockReset()
      .mockResolvedValue(feedbackSession);
    const queryClient = createForgeQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={["/courses/course-a/learn?lesson=lesson-current"]}
        >
          <Routes>
            <Route
              path="/courses/:courseId/learn"
              element={<CourseLearnPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const question = await screen.findByRole("region", {
      name: "Question 1: Current check"
    });
    expect(
      within(question).getByText("The implication is not justified.")
    ).toBeInTheDocument();
    expect(
      within(question).getByText("Repair the first unsupported inference.")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Optional course component unavailable")
    ).not.toBeInTheDocument();

    queryClient.clear();
  });
});
