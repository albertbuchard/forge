import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { WorkAdjustmentDialog } from "@/components/work-adjustment-dialog";

vi.mock("@/lib/api", () => ({
  getXpMetrics: vi.fn().mockResolvedValue({
    metrics: {
      rules: [
        {
          id: "reward_rule_task_run_progress",
          family: "consistency",
          code: "task_run_progress",
          title: "Work time bounty",
          description: "Award a small XP bounty for each ten credited minutes of active work.",
          active: true,
          config: { fixedXp: 4, intervalMinutes: 10 },
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString()
        }
      ]
    }
  })
}));

function renderDialog(overrides: Partial<Parameters<typeof WorkAdjustmentDialog>[0]> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
  const onSubmit = vi.fn().mockResolvedValue(undefined);

  render(
    <QueryClientProvider client={queryClient}>
      <WorkAdjustmentDialog
        open
        onOpenChange={vi.fn()}
        entityType="task"
        entityId="task_1"
        targetLabel="Draft the operator brief"
        currentCreditedSeconds={25 * 60}
        onSubmit={onSubmit}
        {...overrides}
      />
    </QueryClientProvider>
  );

  return { onSubmit };
}

describe("WorkAdjustmentDialog", () => {
  it("previews signed minute and xp changes while clamping removals to the current tracked total", async () => {
    renderDialog({ currentCreditedSeconds: 8 * 60 });

    fireEvent.click(screen.getByRole("button", { name: /remove minutes/i }));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "15" } });

    await waitFor(() => {
      expect(screen.getByText("-8")).toBeInTheDocument();
    });
    expect(screen.getByText(/remove up to 8 whole minutes/i)).toBeInTheDocument();
    expect(screen.getByText(/does not cross a reward bucket/i)).toBeInTheDocument();
  });

  it("submits a signed delta for the selected target", async () => {
    const { onSubmit } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /remove minutes/i }));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "15" } });
    fireEvent.change(screen.getAllByPlaceholderText(/captured the review session/i).at(-1)!, { target: { value: "Correcting the inflated estimate." } });
    fireEvent.click(screen.getByRole("button", { name: /save adjustment/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        entityType: "task",
        entityId: "task_1",
        deltaMinutes: -15,
        note: "Correcting the inflated estimate."
      });
    });
  });
});
