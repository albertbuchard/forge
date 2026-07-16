import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FlowField,
  QuestionFlowDialog,
  resolveQuestionFlowStepIndex
} from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: "(max-width: 1023px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

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

  it("persists guided drafts on continue and restores them for the same baseline", () => {
    function ExampleDialog() {
      const [open, setOpen] = useState(true);
      const [value, setValue] = useState({ title: "" });

      return (
        <QuestionFlowDialog
          open={open}
          onOpenChange={setOpen}
          eyebrow="Pattern"
          title="Create pattern"
          description="Draft a pattern."
          value={value}
          onChange={setValue}
          draftPersistenceKey="test.pattern.create"
          steps={[
            {
              id: "details",
              title: "Details",
              render: (draft, setDraft) => (
                <FlowField label="Title">
                  <Input
                    value={draft.title}
                    onChange={(event) =>
                      setDraft({ title: event.target.value })
                    }
                  />
                </FlowField>
              )
            },
            {
              id: "review",
              title: "Review",
              render: (draft) => <div>{draft.title || "No title"}</div>
            }
          ]}
          submitLabel="Save"
          onSubmit={async () => undefined}
        />
      );
    }

    const { unmount } = render(<ExampleDialog />);

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Restored pattern" }
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(
      window.localStorage.getItem(
        "forge.question-flow-draft.test.pattern.create"
      )
    ).toContain("Restored pattern");

    unmount();

    render(<ExampleDialog />);

    expect(screen.getByDisplayValue("Restored pattern")).toBeInTheDocument();
  });

  it("starts every new question at the top of the modal canvas", async () => {
    render(
      <QuestionFlowDialog
        open
        onOpenChange={() => undefined}
        eyebrow="Experiment"
        title="Create experiment"
        description="Define an experiment."
        value={{}}
        onChange={() => undefined}
        steps={[
          {
            id: "long-step",
            title: "Long step",
            render: () => <div style={{ height: 1200 }}>Long content</div>
          },
          {
            id: "next-step",
            title: "Next step",
            render: () => <div>Next content</div>
          }
        ]}
        submitLabel="Save"
        onSubmit={async () => undefined}
      />
    );

    const canvas = screen.getByTestId("question-flow-canvas");
    canvas.scrollTop = 420;
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(canvas.scrollTop).toBe(0));
    expect(await screen.findByText("Next step")).toBeInTheDocument();
  });

  it("mounts the next question immediately without an empty transition canvas", () => {
    render(
      <QuestionFlowDialog
        open
        onOpenChange={() => undefined}
        eyebrow="Experiment"
        title="Create experiment"
        description="Define an experiment."
        value={{}}
        onChange={() => undefined}
        steps={[
          {
            id: "first-step",
            title: "First step",
            render: () => <div>First-step content</div>
          },
          {
            id: "second-step",
            title: "Second step",
            render: () => <div>Second-step content</div>
          }
        ]}
        submitLabel="Save"
        onSubmit={async () => undefined}
      />
    );

    expect(screen.getByTestId("question-flow-step")).toHaveAttribute(
      "data-step-id",
      "first-step"
    );

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(screen.getByTestId("question-flow-step")).toHaveAttribute(
      "data-step-id",
      "second-step"
    );
    expect(screen.getByText("Second-step content")).toBeInTheDocument();
    expect(screen.queryByText("First-step content")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("question-flow-canvas")
    ).not.toBeEmptyDOMElement();
  });

  it("keeps field errors and hints out of the control's accessible name", () => {
    render(
      <FlowField
        label="Birthday month"
        hint="Use a number from 1 to 12."
        error="Enter a birthday month."
      >
        <Input />
      </FlowField>
    );

    expect(
      screen.getByRole("textbox", { name: "Birthday month" })
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a birthday month."
    );
  });

  it("keeps required missing information on the current step", async () => {
    function RequiredDialog() {
      const [value, setValue] = useState({ title: "" });
      return (
        <QuestionFlowDialog
          open
          onOpenChange={() => undefined}
          eyebrow="Goal"
          title="Create goal"
          description="Name the goal."
          value={value}
          onChange={setValue}
          steps={[
            {
              id: "identity",
              title: "Identity",
              render: (draft, setDraft) => (
                <FlowField label="Title">
                  <Input
                    value={draft.title}
                    onChange={(event) =>
                      setDraft({ title: event.target.value })
                    }
                  />
                </FlowField>
              )
            },
            { id: "review", title: "Review", render: () => <div>Ready</div> }
          ]}
          resolveContinueBlocker={(stepId, draft) =>
            stepId === "identity" && !draft.title.trim()
              ? "Name the goal before continuing."
              : null
          }
          submitLabel="Save"
          onSubmit={async () => undefined}
        />
      );
    }

    render(<RequiredDialog />);
    const continueButton = screen.getByRole("button", { name: /continue/i });
    expect(
      screen.getByRole("progressbar", { name: "Create goal progress" })
    ).toHaveAttribute("aria-valuetext", "Step 1 of 2");
    expect(continueButton).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Name the goal before continuing."
    );

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "A clear goal" }
    });
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);
    expect(await screen.findByText("Review")).toBeInTheDocument();
  });
});
