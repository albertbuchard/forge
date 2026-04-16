import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
});
