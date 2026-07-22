import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CourseContentBlockView,
  CourseExtensionActivityView,
  CourseLessonLayoutView,
  registerCourseBlockRenderer,
  registerCourseLayoutRenderer
} from "./course-renderer-registry";

describe("course renderer registry", () => {
  it("links an installed course resource directly from a lesson", () => {
    render(
      <CourseContentBlockView
        index={0}
        block={{
          type: "resource",
          resourceId: "proof-book",
          presentation: "card"
        }}
        resources={[
          {
            id: "proof-book",
            label: "Proof book",
            url: "https://example.com/proof-book",
            description: "A course reference."
          }
        ]}
      />
    );
    expect(screen.getByRole("link", { name: /proof book/i })).toHaveAttribute(
      "href",
      "https://example.com/proof-book"
    );
  });

  it("shows a safe fallback for an uninstalled extension", () => {
    render(
      <CourseContentBlockView
        index={0}
        block={{
          type: "extension",
          namespace: "example.course",
          renderer: "diagram",
          version: "1",
          data: { source: "untrusted package data" }
        }}
      />
    );
    expect(
      screen.getByText(/optional course component unavailable/i)
    ).toBeInTheDocument();
  });

  it("uses only an explicitly registered trusted renderer", () => {
    registerCourseBlockRenderer({
      namespace: "forge.test",
      renderer: "note",
      version: "1",
      component: () => <p>Trusted renderer output</p>
    });
    render(
      <CourseContentBlockView
        index={0}
        block={{
          type: "extension",
          namespace: "forge.test",
          renderer: "note",
          version: "1",
          data: {}
        }}
      />
    );
    expect(screen.getByText("Trusted renderer output")).toBeInTheDocument();
  });

  it("does not expose assessment data through learner extension activities", () => {
    const onResponseChange = vi.fn();
    render(
      <CourseExtensionActivityView
        response=""
        onResponseChange={onResponseChange}
        disabled={false}
        activity={{
          id: "extension.activity",
          type: "extension",
          title: "Custom lab",
          promptMarkdown: "Run the lab.",
          conceptIds: ["concept.lab"],
          masteryDimensionIds: ["transfer"],
          competencyIds: [],
          assessmentProfileId: "default",
          points: 10,
          estimatedMinutes: 10,
          required: true,
          reviewAfterDays: [1, 3, 8, 16],
          namespace: "example.course",
          renderer: "lab",
          version: "1",
          responseMode: "structured",
          config: {}
        }}
      />
    );
    expect(
      screen.getByText(/using the portable activity fallback/i)
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/structured response/i), {
      target: { value: '{"result": 42}' }
    });
    expect(onResponseChange).toHaveBeenCalledWith('{"result": 42}');
  });

  it("uses a trusted layout selected by the course contract", () => {
    registerCourseLayoutRenderer({
      id: "forge.test-layout",
      component: ({ children, layoutId, preset }) => (
        <section
          data-testid="trusted-layout"
          data-layout={layoutId}
          data-preset={preset}
        >
          {children}
        </section>
      )
    });
    render(
      <CourseLessonLayoutView layoutId="forge.test-layout" preset="forge.paper">
        <p>Lesson surface</p>
      </CourseLessonLayoutView>
    );
    expect(screen.getByTestId("trusted-layout")).toHaveAttribute(
      "data-layout",
      "forge.test-layout"
    );
    expect(screen.getByText("Lesson surface")).toBeInTheDocument();
  });
});
