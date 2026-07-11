import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import {
  PlanningRecordDeleteDialog,
  PlanningRecordDeletedState
} from "./planning-record-delete-dialog";

function installMatchMedia(matches = false) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
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

function renderDeleteDialog(
  onConfirm: () => Promise<void>,
  onOpenChange = vi.fn()
) {
  render(
    <MemoryRouter>
      <I18nProvider locale="en">
        <PlanningRecordDeleteDialog
          open
          recordKind="goal"
          recordTitle="Ship Forge"
          onOpenChange={onOpenChange}
          onConfirm={onConfirm}
        />
      </I18nProvider>
    </MemoryRouter>
  );
  return { onOpenChange };
}

describe("PlanningRecordDeleteDialog", () => {
  beforeEach(() => installMatchMedia());
  afterEach(cleanup);

  it("submits a reversible delete only once while the request is pending", async () => {
    let finishDelete: (() => void) | undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishDelete = resolve;
        })
    );
    const { onOpenChange } = renderDeleteDialog(onConfirm);
    const submit = screen.getByRole("button", { name: "Move to bin" });

    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    finishDelete?.();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("keeps the dialog open and exposes permission failures", async () => {
    const { onOpenChange } = renderDeleteDialog(async () => {
      throw new Error(
        "Permission denied: only the record owner can delete it."
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Move to bin" }));

    expect(
      await screen.findByText(
        "Permission denied: only the record owner can delete it."
      )
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("PlanningRecordDeletedState", () => {
  beforeEach(() => installMatchMedia());
  afterEach(cleanup);

  it("offers restore, collection navigation, and a bounded restore error", () => {
    const onRestore = vi.fn(async () => {});
    render(
      <MemoryRouter>
        <I18nProvider locale="en">
          <PlanningRecordDeletedState
            recordKind="project"
            recordTitle="Forge Runtime"
            backHref="/projects"
            backLabel="Back to projects"
            restoreError={new Error("Restore permission changed.")}
            restoring={false}
            onRestore={onRestore}
          />
        </I18nProvider>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Restore project" }));
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Restore permission changed."
    );
    expect(
      screen.getByRole("link", { name: "Back to projects" })
    ).toHaveAttribute("href", "/projects");
    expect(
      screen
        .getByRole("link", { name: "Back to projects" })
        .querySelector("button")
    ).toBeNull();
  });

  it("ignores rapid duplicate restore activation", async () => {
    let finishRestore: (() => void) | undefined;
    const onRestore = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRestore = resolve;
        })
    );
    render(
      <MemoryRouter>
        <I18nProvider locale="en">
          <PlanningRecordDeletedState
            recordKind="goal"
            recordTitle="Ship Forge"
            backHref="/goals"
            backLabel="Back to goals"
            restoring={false}
            onRestore={onRestore}
          />
        </I18nProvider>
      </MemoryRouter>
    );
    const restore = screen.getByRole("button", { name: "Restore goal" });

    fireEvent.click(restore);
    fireEvent.click(restore);

    expect(onRestore).toHaveBeenCalledTimes(1);
    finishRestore?.();
    await waitFor(() => expect(onRestore).toHaveBeenCalledTimes(1));
  });
});
