import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { DailyRunway } from "@/components/daily-runway";
import { I18nProvider } from "@/lib/i18n";
import type { Task } from "@/lib/types";

function task(index: number): Task {
  return {
    id: `task_${index}`,
    title: `Priority task ${index}`,
    description: `Useful context for priority task ${index}.`,
    level: "task",
    status: "backlog",
    priority: "high",
    owner: "Albert",
    goalId: null,
    projectId: null,
    parentWorkItemId: null,
    dueDate: null,
    effort: "deep",
    energy: "high",
    points: 40,
    plannedDurationSeconds: null,
    schedulingRules: null,
    sortOrder: index,
    aiInstructions: "",
    executionMode: null,
    acceptanceCriteria: [],
    blockerLinks: [],
    completionReport: null,
    gitRefs: [],
    completedAt: null,
    createdAt: "2026-07-09T08:00:00.000Z",
    updatedAt: "2026-07-09T08:00:00.000Z",
    tagIds: [],
    assigneeUserIds: [],
    assignees: [],
    time: {
      totalTrackedSeconds: 0,
      totalCreditedSeconds: 0,
      liveTrackedSeconds: 0,
      liveCreditedSeconds: 0,
      manualAdjustedSeconds: 0,
      activeRunCount: 0,
      hasCurrentRun: false,
      currentRunId: null
    }
  };
}

describe("DailyRunway", () => {
  it("bounds the narrow Today view and hands the remaining work to Kanban", () => {
    const tasks = [task(1), task(2), task(3), task(4)];

    render(
      <MemoryRouter>
        <I18nProvider locale="en">
          <DailyRunway
            tasks={tasks}
            timeline={[
              { id: "ready", label: "Ready", tasks },
              { id: "blocked", label: "Blocked", tasks: [] }
            ]}
            goals={[]}
            tags={[]}
            selectedTaskId={tasks[0]!.id}
            onSelectTask={vi.fn()}
            onMove={vi.fn().mockResolvedValue(undefined)}
            onStartTask={vi.fn().mockResolvedValue(undefined)}
            compact
          />
        </I18nProvider>
      </MemoryRouter>
    );

    expect(screen.getByText("Priority task 1")).toBeInTheDocument();
    expect(screen.getByText("Priority task 3")).toBeInTheDocument();
    expect(screen.queryByText("Priority task 4")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /View 1 more task/i })
    ).toHaveAttribute("href", "/kanban");
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Kanban/i })).toHaveAttribute(
      "href",
      "/kanban"
    );
  });
});
