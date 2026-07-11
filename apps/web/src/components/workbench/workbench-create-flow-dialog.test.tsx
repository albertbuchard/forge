import type { ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/flows/question-flow-dialog", () => ({
  FlowChoiceGrid: ({
    value,
    onChange,
    options
  }: {
    value: string;
    onChange: (next: string) => void;
    options: Array<{ value: string; label: string }>;
  }) => (
    <div>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
  FlowField: ({ label, children }: { label: string; children: ReactNode }) => (
    <label>
      <span>{label}</span>
      {children}
    </label>
  ),
  QuestionFlowDialog: ({
    open,
    value,
    onChange,
    steps,
    submitLabel,
    error,
    onSubmit
  }: {
    open: boolean;
    value: Record<string, unknown>;
    onChange: (value: Record<string, unknown>) => void;
    steps: Array<{
      id: string;
      render: (
        value: Record<string, unknown>,
        setValue: (patch: Record<string, unknown>) => void
      ) => ReactNode;
    }>;
    submitLabel: string;
    error?: string | null;
    onSubmit: () => Promise<void>;
  }) =>
    open ? (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit();
        }}
      >
        {steps.map((step) => (
          <section key={step.id}>
            {step.render(value, (patch) => onChange({ ...value, ...patch }))}
          </section>
        ))}
        {error ? <div role="alert">{error}</div> : null}
        <button type="submit">{submitLabel}</button>
      </form>
    ) : null
}));

import { WorkbenchCreateFlowDialog } from "@/components/workbench/workbench-create-flow-dialog";

afterEach(cleanup);

describe("WorkbenchCreateFlowDialog", () => {
  it("submits a trimmed chat-flow identity and preferred surface", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <WorkbenchCreateFlowDialog
        open
        onOpenChange={() => undefined}
        initialKind="chat"
        preferredSurface=" projects "
        pending={false}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText("Flow title"), {
      target: { value: "  Project risk follow-up  " }
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "  Continue the saved risk review.  " }
    });
    fireEvent.click(screen.getByRole("button", { name: "Create flow" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        title: "Project risk follow-up",
        description: "Continue the saved risk review.",
        kind: "chat",
        homeSurfaceId: "projects"
      })
    );
  });

  it("keeps the create action local until a title is present", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <WorkbenchCreateFlowDialog
        open
        onOpenChange={() => undefined}
        initialKind="functor"
        pending={false}
        onSubmit={onSubmit}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Create flow" }));

    expect(
      await screen.findByText("Add a flow title before creating the flow.")
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
