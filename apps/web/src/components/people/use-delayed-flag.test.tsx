import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDelayedFlag } from "@/components/people/use-delayed-flag";

function DelayedFlagProbe({ active }: { active: boolean }) {
  const delayed = useDelayedFlag(active, 800);
  return <div role="status">{delayed ? "slow" : "waiting"}</div>;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useDelayedFlag", () => {
  it("announces slow work only after the threshold and clears immediately", () => {
    vi.useFakeTimers();
    const view = render(<DelayedFlagProbe active />);
    expect(screen.getByRole("status")).toHaveTextContent("waiting");

    act(() => vi.advanceTimersByTime(799));
    expect(screen.getByRole("status")).toHaveTextContent("waiting");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toHaveTextContent("slow");

    view.rerender(<DelayedFlagProbe active={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("waiting");
  });
});
