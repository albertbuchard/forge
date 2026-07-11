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
    onSubmit
  }: {
    open: boolean;
    value: unknown;
    onChange: (value: unknown) => void;
    steps: Array<{
      id: string;
      render: (
        value: unknown,
        setValue: (patch: Record<string, unknown>) => void
      ) => ReactNode;
    }>;
    submitLabel: string;
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
            {step.render(value, (patch) =>
              onChange({ ...(value as Record<string, unknown>), ...patch })
            )}
          </section>
        ))}
        <button type="submit">{submitLabel}</button>
      </form>
    ) : null
}));

import { AgentTokenFlowDialog } from "@/components/settings/agent-token-flow-dialog";

describe("AgentTokenFlowDialog", () => {
  afterEach(cleanup);

  it("submits bootstrap and default scope policies together", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <AgentTokenFlowDialog
        open
        onOpenChange={() => undefined}
        recommendedScopes={["read", "write"]}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText("Default user IDs"), {
      target: { value: "user_operator, user_forge_bot" }
    });
    fireEvent.change(screen.getByLabelText("Project IDs"), {
      target: { value: "project_alpha" }
    });
    fireEvent.change(screen.getByLabelText("Tag IDs"), {
      target: { value: "tag_focus, tag_client" }
    });

    fireEvent.click(screen.getByRole("button", { name: /issue token/i }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          bootstrapPolicy: expect.objectContaining({ mode: "active_only" }),
          scopePolicy: {
            userIds: ["user_operator", "user_forge_bot"],
            projectIds: ["project_alpha"],
            tagIds: ["tag_focus", "tag_client"]
          }
        })
      )
    );
  });

  it("uses the live onboarding scope bundle for the full operator preset", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const scopes = ["read", "write", "artifact.readMetadata", "future.scope"];

    render(
      <AgentTokenFlowDialog
        open
        onOpenChange={() => undefined}
        recommendedScopes={scopes}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByText("future.scope")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /issue token/i }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ scopes }))
    );
  });

  it("keeps review-first read-only even when onboarding recommends direct mutation scopes", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <AgentTokenFlowDialog
        open
        initialPreset="review"
        onOpenChange={() => undefined}
        recommendedScopes={[
          "read",
          "write",
          "psyche.read",
          "psyche.write",
          "artifact.readMetadata",
          "artifact.create",
          "artifact.uploadBytes",
          "future.mutation"
        ]}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByRole("button", { name: /^Write\b/ })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /^Artifact create\b/ })
    ).toBeDisabled();
    expect(screen.getByText(/Review-first is read-only/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Write\b/ }));
    fireEvent.click(screen.getByRole("button", { name: /issue token/i }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          trustLevel: "standard",
          autonomyMode: "approval_required",
          approvalMode: "approval_by_default",
          scopes: ["read", "psyche.read", "artifact.readMetadata"]
        })
      )
    );
  });
});
