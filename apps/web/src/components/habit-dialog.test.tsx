import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HabitDialog } from "@/components/habit-dialog";

function renderHabitDialog(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  render(
    <HabitDialog
      open
      editingHabit={null}
      values={[]}
      patterns={[]}
      behaviors={[]}
      beliefs={[]}
      modes={[]}
      reports={[]}
      goals={[]}
      projects={[]}
      tasks={[]}
      users={[]}
      onOpenChange={vi.fn()}
      onSubmit={onSubmit}
    />
  );
  return onSubmit;
}

describe("HabitDialog", () => {
  afterEach(cleanup);

  it("offers explicit travel boundaries and keeps negative habits out of workout generation", async () => {
    renderHabitDialog();
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("Train lower body"), {
      target: { value: "Late-night scrolling" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    await within(dialog).findByRole("heading", {
      name: "Set direction and cadence"
    });

    fireEvent.click(
      within(dialog).getByText("Negative").closest("button") as HTMLElement
    );
    fireEvent.click(
      within(dialog).getByText("Follow device").closest("button") as HTMLElement
    );
    expect(within(dialog).getByPlaceholderText("Europe/Zurich")).toHaveValue(
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    await within(dialog).findByRole("heading", {
      name: "Decide whether this habit should create a workout record"
    });
    expect(
      within(dialog).getByText(/Resisting is aligned; performing the behavior/i)
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", {
        name: /Enabled A completed check-in/i
      })
    ).not.toBeInTheDocument();
  });

  it("blocks an invalid IANA timezone before creating the habit", async () => {
    const onSubmit = renderHabitDialog();
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("Train lower body"), {
      target: { value: "Morning plan" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    await within(dialog).findByRole("heading", {
      name: "Set direction and cadence"
    });
    fireEvent.change(within(dialog).getByPlaceholderText("Europe/Zurich"), {
      target: { value: "Mars/Olympus" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create habit" })
    );

    expect(
      await within(dialog).findByText("Some habit fields still need attention.")
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
