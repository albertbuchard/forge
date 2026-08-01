import { describe, expect, it } from "vitest";
import { hasIncompleteEarlierCourseWork } from "./course-detail-page";

describe("Course syllabus guidance", () => {
  it("warns at a later module when an earlier module is incomplete", () => {
    expect(
      hasIncompleteEarlierCourseWork(
        [
          { order: 0, completed: false },
          { order: 1, completed: true },
          { order: 10, completed: false }
        ],
        10
      )
    ).toBe(true);
  });

  it("does not warn when every earlier lesson is complete", () => {
    expect(
      hasIncompleteEarlierCourseWork(
        [
          { order: 0, completed: true },
          { order: 1, completed: true },
          { order: 10, completed: false }
        ],
        10
      )
    ).toBe(false);
  });
});
