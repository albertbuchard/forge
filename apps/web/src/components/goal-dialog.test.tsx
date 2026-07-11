import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import { GoalDialog } from "./goal-dialog";

function installMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: "(max-width: 1023px)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
}

describe("GoalDialog", () => {
  beforeEach(() => {
    installMatchMedia();
    window.localStorage.clear();
  });
  afterEach(cleanup);

  it("creates a minimal goal once and preserves the guided defaults", async () => {
    let finishSubmit: (() => void) | undefined;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSubmit = resolve;
        })
    );
    render(
      <I18nProvider locale="en">
        <GoalDialog
          open
          editingGoal={null}
          tags={[]}
          users={[]}
          onOpenChange={vi.fn()}
          onSubmit={onSubmit}
        />
      </I18nProvider>
    );

    fireEvent.change(
      screen.getByPlaceholderText("Build a durable body and calm energy"),
      { target: { value: "Ship Forge" } }
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const submit = await screen.findByRole("button", {
      name: "Create life goal"
    });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Ship Forge",
        horizon: "year",
        status: "active",
        targetPoints: 400
      }),
      undefined
    );
    finishSubmit?.();
    await waitFor(() => expect(submit).toBeEnabled());
  });
});
