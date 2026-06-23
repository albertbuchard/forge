import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useShellTaskHeartbeat } from "@/features/shell/use-shell-task-heartbeat";

const { heartbeatTaskRunMock } = vi.hoisted(() => ({
  heartbeatTaskRunMock: vi.fn()
}));

vi.mock("@/store/api/forge-api", () => ({
  useHeartbeatTaskRunMutation: () => [heartbeatTaskRunMock]
}));

function TestHeartbeatSurface() {
  useShellTaskHeartbeat({
    snapshot: {
      activeTaskRuns: [
        {
          id: "run_1",
          actor: "Albert",
          leaseTtlSeconds: 1800,
          note: ""
        }
      ]
    } as never,
    settings: {
      profile: {
        operatorName: "Albert",
        operatorEmail: "albert@example.com",
        operatorTitle: "Operator"
      }
    } as never
  });
  return null;
}

describe("useShellTaskHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    heartbeatTaskRunMock.mockReset();
    heartbeatTaskRunMock.mockReturnValue({
      unwrap: vi.fn().mockResolvedValue(undefined)
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden"
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps heartbeating active runs even when the document is hidden", () => {
    render(<TestHeartbeatSurface />);

    vi.advanceTimersByTime(30_000);

    expect(heartbeatTaskRunMock).toHaveBeenCalledTimes(1);
    expect(heartbeatTaskRunMock).toHaveBeenLastCalledWith({
      runId: "run_1",
      input: {
        actor: "Albert",
        leaseTtlSeconds: 1800,
        note: ""
      }
    });
  });
});
