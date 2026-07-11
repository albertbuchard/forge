import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmptyState, ErrorState, LoadingState } from "./page-state";

describe("shared page states", () => {
  afterEach(() => cleanup());

  it("announces loading without presenting it as an error", () => {
    render(<LoadingState title="Loading movement" />);

    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("announces errors and keeps recovery actionable", () => {
    const onRetry = vi.fn();
    render(<ErrorState error={new Error("Offline")} onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("announces a truthful empty result as a status", () => {
    render(
      <EmptyState
        title="No matching records"
        description="Change the filters or add a record."
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "No matching records"
    );
    expect(screen.getByRole("status")).toHaveTextContent("No data");
  });
});
