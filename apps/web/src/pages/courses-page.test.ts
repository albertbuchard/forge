import { describe, expect, it } from "vitest";
import { resolveCourseStartLessonId } from "./courses-page";

describe("Course library lesson start", () => {
  it("starts a new 330-lesson course at its entry lesson, not its feature", () => {
    const course = {
      entryLessonId: "mpsi-foundations-week-1-day-1",
      featuredLessonId: "mp-algebra-week-40-day-3",
      progress: {
        currentLessonId: null,
        totalLessons: 330
      }
    };

    expect(resolveCourseStartLessonId(course)).toBe(
      "mpsi-foundations-week-1-day-1"
    );
    expect(resolveCourseStartLessonId(course)).not.toBe(
      course.featuredLessonId
    );
  });

  it("resumes the exact saved current lesson", () => {
    expect(
      resolveCourseStartLessonId({
        entryLessonId: "lesson-1",
        progress: { currentLessonId: "lesson-37" }
      })
    ).toBe("lesson-37");
  });
});
