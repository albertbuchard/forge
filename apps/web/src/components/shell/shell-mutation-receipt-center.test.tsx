import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import {
  ShellMutationReceiptCenter,
  ShellMutationReceiptTrigger
} from "@/components/shell/shell-mutation-receipt-center";
import type { OfflineMutationOutboxController } from "@/features/shell/use-offline-mutation-outbox";
import { createOfflineTaskMutationEntry } from "@/lib/offline-mutation-outbox";

function controller(
  overrides: Partial<OfflineMutationOutboxController> = {}
): OfflineMutationOutboxController {
  return {
    entries: [],
    available: true,
    isOnline: true,
    isDraining: false,
    errorMessage: null,
    queuedCount: 0,
    decisionCount: 0,
    queueTaskStatusMove: vi.fn(),
    retryQueued: vi.fn(),
    retryConflict: vi.fn(),
    discard: vi.fn(),
    clearSettled: vi.fn(),
    updateMutationReceipt: vi.fn(),
    refresh: vi.fn(),
    ...overrides
  } as OfflineMutationOutboxController;
}

function queuedEntry() {
  return createOfflineTaskMutationEntry({
    sessionId: "session_1",
    taskId: "task_1",
    taskLabel: "Prepare quarterly review",
    expectedUpdatedAt: "2026-08-09T12:00:00.000Z",
    desiredStatus: "focus",
    now: new Date("2026-08-09T12:01:00.000Z")
  });
}

describe("ShellMutationReceiptCenter", () => {
  it("leads with the supported outcome and states the online-only boundary", () => {
    render(
      <MemoryRouter>
        <ShellMutationReceiptCenter
          open
          onOpenChange={vi.fn()}
          controller={controller()}
        />
      </MemoryRouter>
    );

    expect(
      screen.getByText(
        /Forge can keep supported task moves here while you are offline/i
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Completing tasks and other changes still need a live connection/i
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "No offline changes" })
    ).toBeInTheDocument();
  });

  it("shows queued truth without claiming that the task moved", () => {
    const entry = queuedEntry();
    const retryQueued = vi.fn();
    const discard = vi.fn();
    render(
      <MemoryRouter>
        <ShellMutationReceiptCenter
          open
          onOpenChange={vi.fn()}
          controller={controller({
            entries: [entry],
            isOnline: false,
            queuedCount: 1,
            retryQueued,
            discard
          })}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.getByText("Move to Focus")).toBeInTheDocument();
    expect(
      screen.getByText(/Waiting to move Prepare quarterly review/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try now" })).toHaveClass(
      "min-h-11"
    );
    expect(screen.getByRole("button", { name: "Try now" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Try queued changes" })
    ).toHaveClass("min-h-11");
    const discardButton = screen.getByRole("button", {
      name: "Discard queued move"
    });
    expect(discardButton).toHaveClass("min-h-11");
    fireEvent.click(discardButton);
    expect(discard).toHaveBeenCalledWith(entry.id);
  });

  it("offers an explicit new attempt against the current revision after conflict", () => {
    const entry = {
      ...queuedEntry(),
      state: "conflicted" as const,
      summary: "This task changed before the queued move could be applied.",
      current: {
        status: "blocked" as const,
        updatedAt: "2026-08-09T12:02:00.000Z"
      }
    };
    const retryConflict = vi.fn();
    render(
      <MemoryRouter>
        <ShellMutationReceiptCenter
          open
          onOpenChange={vi.fn()}
          controller={controller({
            entries: [entry],
            decisionCount: 1,
            retryConflict
          })}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("Needs your decision")).toBeInTheDocument();
    expect(
      screen.getByText(/Current server state: Blocked/i)
    ).toBeInTheDocument();
    const retryButton = screen.getByRole("button", {
      name: "Move to Focus now"
    });
    expect(retryButton).toHaveClass("min-h-11");
    fireEvent.click(retryButton);
    expect(retryConflict).toHaveBeenCalledWith(entry.id);
    expect(screen.getByRole("link", { name: "Open task" })).toHaveAttribute(
      "href",
      "/tasks/task_1"
    );
  });

  it("gives the shell trigger a named 44-pixel control and decision count", () => {
    const onOpen = vi.fn();
    render(
      <ShellMutationReceiptTrigger
        compact
        onOpen={onOpen}
        controller={controller({ decisionCount: 2 })}
      />
    );

    const trigger = screen.getByRole("button", { name: "2 offline changes" });
    expect(trigger).toHaveClass("min-h-11", "min-w-11");
    fireEvent.click(trigger);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("gives the clear-settled action a 44-pixel target", () => {
    const accepted = { ...queuedEntry(), state: "accepted" as const };
    render(
      <MemoryRouter>
        <ShellMutationReceiptCenter
          open
          onOpenChange={vi.fn()}
          controller={controller({ entries: [accepted] })}
        />
      </MemoryRouter>
    );

    expect(
      screen.getByRole("button", { name: "Clear accepted and rejected" })
    ).toHaveClass("min-h-11");
  });
});
