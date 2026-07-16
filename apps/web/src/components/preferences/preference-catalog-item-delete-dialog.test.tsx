import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PreferenceCatalogItemDeleteDialog } from "./preference-catalog-item-delete-dialog";

describe("PreferenceCatalogItemDeleteDialog", () => {
  afterEach(() => cleanup());

  it("confirms reversible concept removal and closes after success", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(
      <PreferenceCatalogItemDeleteDialog
        open
        itemLabel="Quiet cafe"
        catalogTitle="Breakfast shortlist"
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />
    );

    expect(
      screen.getByText(/existing scored items, judgments, signals, scores/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/can be restored from settings/i)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Move to bin" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the dialog open and exposes a colocated error", async () => {
    const onOpenChange = vi.fn();
    render(
      <PreferenceCatalogItemDeleteDialog
        open
        itemLabel="Quiet cafe"
        catalogTitle="Breakfast shortlist"
        onOpenChange={onOpenChange}
        onConfirm={vi.fn().mockRejectedValue(new Error("Delete unavailable"))}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Move to bin" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Delete unavailable"
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
