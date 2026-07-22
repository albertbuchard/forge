import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CourseMarkdown } from "@/components/courses/course-markdown";

describe("CourseMarkdown", () => {
  it("renders prose and LaTeX without exposing raw delimiters", () => {
    const { container } = render(
      <CourseMarkdown
        markdown={"A **local inverse** exists when $f'(w) \\ne 0$."}
      />
    );

    expect(screen.getByText("local inverse")).toBeInTheDocument();
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.textContent).not.toContain("$f'");
  });
});
