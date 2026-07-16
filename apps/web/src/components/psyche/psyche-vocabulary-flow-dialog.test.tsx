import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventType } from "@/lib/psyche-types";
import type { UserSummary } from "@/lib/types";
import {
  createPsycheVocabularyDraft,
  PsycheVocabularyFlowDialog,
  type PsycheVocabularyDraft
} from "./psyche-vocabulary-flow-dialog";

const user: UserSummary = {
  id: "user_operator",
  kind: "human",
  handle: "operator",
  displayName: "Operator",
  description: "",
  accentColor: "#123456",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

function eventType(id: string, label: string, system = false): EventType {
  return {
    id,
    domainId: "domain_psyche",
    label,
    description: `${label} definition`,
    system,
    userId: system ? null : user.id,
    user: system ? null : user,
    ownerUserId: system ? null : user.id,
    ownerUser: system ? null : user,
    assigneeUserIds: [],
    assignees: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function DialogHarness({
  eventTypes = [
    eventType("event_system", "Criticism", true),
    eventType("event_custom", "Unexpected distance")
  ],
  initial = createPsycheVocabularyDraft(user.id),
  loading = false,
  loadError = false,
  onRetry = vi.fn(),
  onSubmit = vi.fn()
}: {
  eventTypes?: EventType[];
  initial?: PsycheVocabularyDraft;
  loading?: boolean;
  loadError?: boolean;
  onRetry?: () => void;
  onSubmit?: (value: PsycheVocabularyDraft) => Promise<void> | void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <PsycheVocabularyFlowDialog
      open
      onOpenChange={() => undefined}
      value={value}
      onChange={setValue}
      eventTypes={eventTypes}
      emotions={[]}
      users={[user]}
      loading={loading}
      loadError={loadError}
      onRetry={onRetry}
      pending={false}
      error={error}
      onSubmit={async () => {
        try {
          await onSubmit(value);
        } catch (submitError) {
          setError(
            submitError instanceof Error ? submitError.message : "Save failed"
          );
        }
      }}
    />
  );
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: true,
      media: "(max-width: 1023px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PsycheVocabularyFlowDialog", () => {
  it("keeps built-ins read-only and opens custom labels for editing", () => {
    render(<DialogHarness />);

    const dialog = screen.getByTestId("question-flow-dialog");
    expect(dialog).toHaveClass("inset-x-3");
    expect(screen.getByLabelText("Built-in label")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Criticism/i })
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /Unexpected distance/i })
    );
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));

    expect(screen.getByLabelText("Label")).toHaveValue("Unexpected distance");
    expect(
      screen.getByRole("button", { name: /Delete custom label/i })
    ).toBeInTheDocument();
  });

  it("requires explicit confirmation before deleting a custom label", () => {
    const onSubmit = vi.fn();
    render(<DialogHarness onSubmit={onSubmit} />);

    fireEvent.click(
      screen.getByRole("button", { name: /Unexpected distance/i })
    );
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /Delete custom label/i })
    );

    expect(screen.getByRole("button", { name: /Continue/i })).toBeDisabled();
    fireEvent.click(
      screen.getByRole("switch", { name: /Remove this custom label/i })
    );
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /Delete label/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "delete",
        selectedId: "event_custom",
        confirmDelete: true
      })
    );
  });

  it("bounds dense collections and makes every row reachable through search", () => {
    const entries = Array.from({ length: 75 }, (_, index) =>
      eventType(`event_${index}`, `Custom moment ${index}`)
    );
    render(<DialogHarness eventTypes={entries} />);

    const list = screen.getByRole("list", { name: "event_type vocabulary" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(50);
    expect(screen.getByText(/Showing 50 of 75 matches/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Find a event type"), {
      target: { value: "Custom moment 74" }
    });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: /Custom moment 74/i })
    ).toBeInTheDocument();
  });

  it("preserves entered wording and exposes an actionable failure", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("Duplicate label"));
    render(<DialogHarness onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: /Add event type/i }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "My exact wording" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /Add label/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Duplicate label")
    );
    fireEvent.click(screen.getByRole("button", { name: /Back/i }));
    expect(screen.getByLabelText("Label")).toHaveValue("My exact wording");
  });

  it("blocks Continue through loading, error, and deliberate retry", () => {
    const onRetry = vi.fn();
    const { rerender } = render(<DialogHarness loading onRetry={onRetry} />);
    expect(screen.getByText("Loading reusable labels…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue/i })).toBeDisabled();

    rerender(<DialogHarness loadError onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Reusable labels could not be loaded"
    );
    expect(screen.getByRole("button", { name: /Continue/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<DialogHarness loading onRetry={onRetry} />);
    expect(screen.getByRole("button", { name: /Continue/i })).toBeDisabled();

    rerender(<DialogHarness onRetry={onRetry} />);
    expect(screen.getByRole("button", { name: /Continue/i })).toBeDisabled();
  });
});
