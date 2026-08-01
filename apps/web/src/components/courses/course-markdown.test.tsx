import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CourseFeedbackMarkdown,
  CourseMarkdown,
  normalizeCourseMarkdown
} from "@/components/courses/course-markdown";

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

  it("normalizes common model-style TeX delimiters before rendering", () => {
    const markdown = String.raw`Use \(w_0\in\mathbb C^\times\), then show \[f(w_0)=w_0^3.\]`;
    const normalized = normalizeCourseMarkdown(markdown);

    expect(normalized).toContain(String.raw`$w_0\in\mathbb C^\times$`);
    expect(normalized).toContain("$$");

    const { container } = render(<CourseMarkdown markdown={markdown} />);
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(
      2
    );
    expect(container.querySelector(".katex-html")?.textContent).not.toContain(
      String.raw`\mathbb`
    );
  });

  it("keeps lesson-authored headings below the page title", () => {
    render(
      <CourseMarkdown
        markdown={"# Chapter opening\n\n## First argument"}
        offsetHeadings
      />
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Chapter opening" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "First argument" })
    ).toBeInTheDocument();
  });

  it("blocks remote media and hardens links in generated feedback", () => {
    const { container } = render(
      <CourseFeedbackMarkdown
        markdown={
          "![tracking pixel](https://tracker.example/pixel.png) [Reference](https://example.com) <script>alert(1)</script>"
        }
      />
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByRole("link", { name: "Reference" })).toHaveAttribute(
      "target",
      "_blank"
    );
    expect(screen.getByRole("link", { name: "Reference" })).toHaveAttribute(
      "rel",
      "noopener noreferrer"
    );
  });
});
