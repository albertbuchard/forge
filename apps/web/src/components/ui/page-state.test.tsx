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

  it("renders a pre-staged owner authorization as a direct custom-protocol link", () => {
    const onRetry = vi.fn();
    const retryHref =
      "forge://local-auth?apiOrigin=http%3A%2F%2F127.0.0.1%3A4317&browserNonce=nonce&browserOrigin=http%3A%2F%2F127.0.0.1%3A4317&transactionId=transaction_123456";
    render(
      <ErrorState
        error={new Error("Authorization required")}
        onRetry={onRetry}
        retryHref={retryHref}
        retryLabel="Authorize this browser"
      />
    );

    const link = screen.getByRole("link", {
      name: /authorize this browser/i
    });
    expect(link).toHaveAttribute("href", retryHref);
    expect(fireEvent.click(link)).toBe(false);
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
