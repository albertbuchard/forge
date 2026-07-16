import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Task,
  TodayPriorityDecision,
  TodayPriorityEvidence,
  TodayRankedCandidate
} from "@/lib/types";
import { TodayPriorityPanel } from "@/pages/today-priority-panel";

const NOW = "2026-07-15T10:00:00.000Z";

afterEach(cleanup);

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    description: `${id} description`,
    level: "task",
    status: "backlog",
    priority: "medium",
    owner: "Albert",
    goalId: null,
    projectId: null,
    parentWorkItemId: null,
    dueDate: null,
    effort: "light",
    energy: "steady",
    points: 10,
    plannedDurationSeconds: 1_800,
    schedulingRules: null,
    sortOrder: 0,
    aiInstructions: "",
    executionMode: null,
    acceptanceCriteria: [],
    blockerLinks: [],
    completionReport: null,
    gitRefs: [],
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    tagIds: [],
    time: {
      totalTrackedSeconds: 0,
      totalCreditedSeconds: 0,
      liveTrackedSeconds: 0,
      liveCreditedSeconds: 0,
      manualAdjustedSeconds: 0,
      activeRunCount: 0,
      hasCurrentRun: false,
      currentRunId: null
    },
    ...overrides
  };
}

const evidence: TodayPriorityEvidence[] = [
  {
    key: "urgency",
    label: "Urgency",
    state: "fresh",
    detail: "Urgency is current."
  },
  {
    key: "schedule",
    label: "Schedule",
    state: "fresh",
    detail: "Schedule is current."
  },
  {
    key: "capacity",
    label: "Capacity",
    state: "fresh",
    detail: "Capacity is current."
  },
  {
    key: "active-context",
    label: "Active context",
    state: "fresh",
    detail: "Active work is current."
  }
];

function makeCandidate(task: Task, score = 100): TodayRankedCandidate {
  return {
    task,
    score,
    urgencyScore: 30,
    scheduleScore: 30,
    capacityScore: 20,
    activeContextScore: 20,
    hasActiveRun: false,
    capacityFit: true,
    requiredAp: 12,
    requiredApEstimated: true,
    timebox: null,
    evidence,
    reason: "It is the strongest current candidate."
  };
}

function makeDecision(
  overrides: Partial<TodayPriorityDecision> = {}
): TodayPriorityDecision {
  const selectedCandidate = makeCandidate(makeTask("selected-task"));
  const alternatives = [1, 2, 3].map((index) =>
    makeCandidate(makeTask(`alternative-${index}`), 100 - index)
  );
  return {
    contractVersion: 1,
    generatedAt: NOW,
    mode: "ready",
    confidence: "full",
    decisionUserId: "user_albert",
    task: selectedCandidate.task,
    activeRun: null,
    activeRunCount: 0,
    summary: "The current signals agree on one next task.",
    rankedCandidates: [selectedCandidate, ...alternatives],
    selectedCandidate,
    alternatives,
    evidence,
    blockedTaskCount: 0,
    needsRefresh: false,
    isLoading: false,
    ...overrides
  };
}

describe("TodayPriorityPanel", () => {
  it("renders a bounded server decision and starts the selected task", async () => {
    const onStartTask = vi.fn().mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <TodayPriorityPanel
          decision={makeDecision()}
          onStartTask={onStartTask}
          onRefresh={vi.fn().mockResolvedValue(undefined)}
        />
      </MemoryRouter>
    );

    expect(
      screen.getByRole("region", { name: "Next useful work" })
    ).toBeInTheDocument();
    expect(screen.getByText("Why first:")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Urgency")).toBeInTheDocument();
    expect(screen.getByText("Schedule")).toBeInTheDocument();
    expect(screen.getByText("Capacity")).toBeInTheDocument();
    expect(screen.getByText("Active context")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start now" }));
    await waitFor(() =>
      expect(onStartTask).toHaveBeenCalledWith("selected-task")
    );
  });

  it("reports start and refresh failures through an accessible alert", async () => {
    const { rerender } = render(
      <MemoryRouter>
        <TodayPriorityPanel
          decision={makeDecision()}
          onStartTask={vi.fn().mockRejectedValue(new Error("offline"))}
          onRefresh={vi.fn().mockResolvedValue(undefined)}
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Start now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be started/i
    );

    rerender(
      <MemoryRouter>
        <TodayPriorityPanel
          decision={makeDecision({ needsRefresh: true })}
          onStartTask={vi.fn().mockResolvedValue(undefined)}
          onRefresh={vi.fn().mockRejectedValue(new Error("offline"))}
        />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh evidence" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not refresh all evidence/i
    );
  });

  it("withholds new starts when an active run needs review", () => {
    const task = makeTask("blocked-active-task", { status: "blocked" });
    const selectedCandidate = makeCandidate(task);
    render(
      <MemoryRouter>
        <TodayPriorityPanel
          decision={makeDecision({
            mode: "unresolved-active",
            task,
            activeRunCount: 1,
            selectedCandidate,
            summary:
              "A live run belongs to a blocked task. Resolve the blocker first."
          })}
          onStartTask={vi.fn().mockResolvedValue(undefined)}
          onRefresh={vi.fn().mockResolvedValue(undefined)}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("Resolve active work")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Today decision: Active run needs review")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Other work after resolving the live run")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Start now" })
    ).not.toBeInTheDocument();
  });

  it.each([
    {
      mode: "overloaded" as const,
      title: "Pause before adding work",
      badge: "Today decision: Capacity overloaded",
      summary: "Current capacity is overloaded."
    },
    {
      mode: "capacity-limited" as const,
      title: "Choose smaller work",
      badge: "Today decision: No task fits capacity",
      summary: "No open task fits the remaining capacity."
    },
    {
      mode: "no-work" as const,
      title: "No daily runway yet",
      badge: "Today decision: No startable work",
      summary: "There is no open, startable work."
    }
  ])("renders the $mode stop state without a start action", (state) => {
    render(
      <MemoryRouter>
        <TodayPriorityPanel
          decision={makeDecision({
            mode: state.mode,
            task: null,
            selectedCandidate: null,
            alternatives: [],
            summary: state.summary
          })}
          onStartTask={vi.fn().mockResolvedValue(undefined)}
          onRefresh={vi.fn().mockResolvedValue(undefined)}
        />
      </MemoryRouter>
    );

    expect(screen.getByText(state.title)).toBeInTheDocument();
    expect(screen.getByLabelText(state.badge)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Start now" })
    ).not.toBeInTheDocument();
  });

  it("shows stale evidence explicitly and offers one refresh action", () => {
    const staleEvidence = evidence.map((entry) => ({
      ...entry,
      state: "stale" as const,
      detail: `${entry.label} needs a refresh.`
    }));
    render(
      <MemoryRouter>
        <TodayPriorityPanel
          decision={makeDecision({
            confidence: "limited",
            needsRefresh: true,
            evidence: staleEvidence
          })}
          onStartTask={vi.fn().mockResolvedValue(undefined)}
          onRefresh={vi.fn().mockResolvedValue(undefined)}
        />
      </MemoryRouter>
    );

    expect(screen.getAllByText("Stale")).toHaveLength(4);
    expect(
      screen.getByRole("button", { name: "Refresh evidence" })
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Today decision: Check inputs")
    ).toBeInTheDocument();
  });
});
