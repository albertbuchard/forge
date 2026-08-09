import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MutationReceiptBanner } from "@/components/mutation-receipt-banner";
import { ForgeApiError } from "@/lib/api-error";
import type { MutationReceipt } from "@/lib/mutation-receipts";

const { undoMutationReceiptMock } = vi.hoisted(() => ({
  undoMutationReceiptMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  createMutationReceiptUndoKey: () => "undo_test_key",
  undoMutationReceipt: undoMutationReceiptMock
}));

const availableReceipt: MutationReceipt = {
  id: "mrc_available",
  operation: "task_update",
  targetType: "task",
  targetId: "task_1",
  targetLabel: "Prepare release",
  ownerUserId: "user_operator",
  summary: "Moved Prepare release from backlog to focus.",
  status: "available",
  reversible: true,
  explanation: "Undo is available until the time shown.",
  expiresAt: "2099-08-09T13:10:00.000Z",
  createdAt: "2099-08-09T13:00:00.000Z",
  undoneAt: null
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("MutationReceiptBanner", () => {
  it("states the completed change and exposes one named 44px Undo action", async () => {
    const undoneReceipt: MutationReceipt = {
      ...availableReceipt,
      status: "undone",
      reversible: false,
      explanation: "This change has already been undone.",
      undoneAt: "2026-08-09T13:01:00.000Z"
    };
    undoMutationReceiptMock.mockResolvedValue({
      receipt: undoneReceipt,
      replayed: false,
      result: {}
    });
    const onReceiptChange = vi.fn();
    const onUndone = vi.fn();
    render(
      <MutationReceiptBanner
        receipt={availableReceipt}
        onReceiptChange={onReceiptChange}
        onUndone={onUndone}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Moved Prepare release from backlog to focus."
    );
    expect(screen.getByText(/Undo is available until/)).toBeVisible();
    const undo = screen.getByRole("button", {
      name: "Undo: Moved Prepare release from backlog to focus."
    });
    expect(undo.className).toContain("min-h-11");
    expect(undo.className).toContain("w-full");
    fireEvent.click(undo);
    await waitFor(() => expect(onReceiptChange).toHaveBeenCalledWith(undoneReceipt));
    expect(onUndone).toHaveBeenCalledTimes(1);
  });

  it("shows a truthful terminal explanation without a false Undo button", () => {
    render(
      <MutationReceiptBanner
        receipt={{
          ...availableReceipt,
          status: "not_reversible",
          reversible: false,
          expiresAt: null,
          explanation: "This task was permanently deleted and cannot be restored."
        }}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "This task was permanently deleted and cannot be restored."
    );
    expect(screen.queryByRole("button", { name: /Undo/ })).toBeNull();
  });

  it("replaces stale availability with the server's conflict state", async () => {
    const conflictedReceipt: MutationReceipt = {
      ...availableReceipt,
      status: "conflicted",
      reversible: false,
      explanation: "This task changed after the receipt was created."
    };
    undoMutationReceiptMock.mockRejectedValue(
      new ForgeApiError({
        status: 409,
        code: "mutation_receipt_target_changed",
        message: conflictedReceipt.explanation,
        requestPath: `/api/v1/mutation-receipts/${availableReceipt.id}/undo`,
        response: { receipt: conflictedReceipt }
      })
    );
    const onReceiptChange = vi.fn();
    render(
      <MutationReceiptBanner
        receipt={availableReceipt}
        onReceiptChange={onReceiptChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Undo:/ }));
    await waitFor(() =>
      expect(onReceiptChange).toHaveBeenCalledWith(conflictedReceipt)
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      conflictedReceipt.explanation
    );
  });

  it("removes Undo exactly when the receipt expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T13:09:59.000Z"));
    render(
      <MutationReceiptBanner
        receipt={{
          ...availableReceipt,
          createdAt: "2026-08-09T13:00:00.000Z",
          expiresAt: "2026-08-09T13:10:00.000Z"
        }}
      />
    );
    expect(screen.getByRole("button", { name: /Undo:/ })).toBeVisible();

    act(() => vi.advanceTimersByTime(1_000));

    expect(screen.queryByRole("button", { name: /Undo:/ })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "The Undo window expired. Forge left the current data unchanged."
    );
  });

  it("reuses one idempotency key after a transport failure", async () => {
    const undoneReceipt: MutationReceipt = {
      ...availableReceipt,
      status: "undone",
      reversible: false,
      explanation: "This change has already been undone.",
      undoneAt: "2099-08-09T13:01:00.000Z"
    };
    undoMutationReceiptMock
      .mockRejectedValueOnce(new Error("The response was interrupted."))
      .mockResolvedValueOnce({
        receipt: undoneReceipt,
        replayed: true,
        result: {}
      });
    render(<MutationReceiptBanner receipt={availableReceipt} />);
    const undo = screen.getByRole("button", { name: /Undo:/ });

    fireEvent.click(undo);
    await screen.findByRole("alert");
    fireEvent.click(undo);
    await waitFor(() => expect(undoMutationReceiptMock).toHaveBeenCalledTimes(2));

    expect(undoMutationReceiptMock.mock.calls[0]?.[1]).toBeTruthy();
    expect(undoMutationReceiptMock.mock.calls[1]?.[1]).toBe(
      undoMutationReceiptMock.mock.calls[0]?.[1]
    );
  });
});
