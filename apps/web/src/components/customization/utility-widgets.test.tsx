import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MiniCalendarWidget } from "./utility-widgets";

describe("MiniCalendarWidget", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("updates its local month when the date rolls over", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 31, 23, 59, 50));

    render(<MiniCalendarWidget compact={false} />);
    expect(screen.getByText("January 2026")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(screen.getByText("February 2026")).toBeInTheDocument();
  });
});
