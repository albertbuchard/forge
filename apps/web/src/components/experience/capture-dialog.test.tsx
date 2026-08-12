import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CaptureDialog } from "@/components/experience/capture-dialog";

const { confirmCaptureMock, proposeCaptureMock } = vi.hoisted(() => ({
  confirmCaptureMock: vi.fn(),
  proposeCaptureMock: vi.fn()
}));

vi.mock("@/lib/api", () => ({
  confirmCapture: (...args: unknown[]) => confirmCaptureMock(...args),
  proposeCapture: (...args: unknown[]) => proposeCaptureMock(...args)
}));

describe("Global Capture", () => {
  beforeEach(() => {
    window.localStorage.clear();
    proposeCaptureMock.mockResolvedValue({
      proposal: {
        version: 1,
        proposalId: "capture_proposal_0123456789abcdef0123456789abcdef",
        targetType: "note",
        confidence: "review_required",
        classificationReason: "Text becomes an editable Note.",
        title: "Research decision",
        contentMarkdown: "Research decision\nPreserve the evidence.",
        description: null,
        relationships: [
          {
            entityType: "goal",
            entityId: "goal_research",
            title: "Answer the research question",
            sourceHref: "/goals/goal_research",
            reason: "Matched title: research decision"
          }
        ],
        warnings: [],
        requiresConfirmation: true
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps the draft local, requires review, and preserves one retry key across an uncertain failure", async () => {
    confirmCaptureMock
      .mockRejectedValueOnce(new Error("The connection ended before Forge returned a receipt."))
      .mockResolvedValueOnce({
        receipt: {
          version: 1,
          proposalId: "capture_proposal_0123456789abcdef0123456789abcdef",
          targetType: "note",
          targetId: "note_capture",
          targetHref: "/notes?focus=note_capture",
          title: "Research decision",
          replayed: true,
          confirmedAt: "2026-08-12T12:00:00.000Z",
          relationshipCount: 1
        }
      });

    render(
      <MemoryRouter>
        <CaptureDialog open onOpenChange={vi.fn()} ownerUserId="user_operator" />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText("What do you want to capture?"), {
      target: { value: "Research decision\nPreserve the evidence." }
    });
    expect(window.localStorage.getItem("forge.capture.draft.v1")).toContain(
      "Research decision"
    );
    expect(screen.getByText("No Forge record exists yet.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Review proposal" }));
    await screen.findByText("Proposed relationships");
    expect(proposeCaptureMock).toHaveBeenCalledWith({
      version: 1,
      kind: "text",
      text: "Research decision\nPreserve the evidence.",
      ownerUserId: "user_operator"
    });
    expect(screen.getByDisplayValue("Research decision")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /Answer the research question/u })).toHaveProperty(
      "checked",
      true
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm and create" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("connection ended");

    fireEvent.click(screen.getByRole("button", { name: "Confirm and create" }));
    await screen.findByText("Capture already confirmed");
    expect(confirmCaptureMock).toHaveBeenCalledTimes(2);
    const firstKey = confirmCaptureMock.mock.calls[0]?.[0].idempotencyKey;
    const secondKey = confirmCaptureMock.mock.calls[1]?.[0].idempotencyKey;
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBe(firstKey);
    expect(window.localStorage.getItem("forge.capture.draft.v1")).toBe(
      JSON.stringify({ version: 1, kind: "text", text: "", url: "" })
    );
  });

  it("does not pretend browser dictation is available when the speech API is absent", async () => {
    render(
      <MemoryRouter>
        <CaptureDialog open onOpenChange={vi.fn()} ownerUserId="user_operator" />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /Dictate/u }));
    fireEvent.click(screen.getByRole("button", { name: "Start dictation" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "does not provide speech recognition"
      );
    });
    expect(proposeCaptureMock).not.toHaveBeenCalled();
  });
});
