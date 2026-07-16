import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskSchedulingDialog } from "@/components/calendar/task-scheduling-dialog";
import type { Task } from "@/lib/types";

function installMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: "(max-width: 1023px)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
}

function task(input: {
  id: string;
  title: string;
  plannedDurationSeconds: number;
  keyword: string;
}) {
  return {
    id: input.id,
    title: input.title,
    status: "focus",
    priority: "medium",
    owner: "Albert",
    goalId: null,
    projectId: null,
    dueDate: null,
    effort: "steady",
    energy: "steady",
    points: 50,
    plannedDurationSeconds: input.plannedDurationSeconds,
    schedulingRules: {
      allowWorkBlockKinds: [],
      blockWorkBlockKinds: [],
      allowCalendarIds: [],
      blockCalendarIds: [],
      allowEventTypes: [],
      blockEventTypes: [],
      allowEventKeywords: [input.keyword],
      blockEventKeywords: [],
      allowAvailability: [],
      blockAvailability: []
    },
    sortOrder: 1,
    completedAt: null,
    createdAt: "2026-04-12T08:00:00.000Z",
    updatedAt: "2026-04-12T08:00:00.000Z",
    tagIds: []
  } as unknown as Task;
}

describe("TaskSchedulingDialog", () => {
  beforeEach(installMatchMedia);
  afterEach(cleanup);

  it("resets rules and duration when the selected task changes", async () => {
    const onSave = vi.fn(async () => {});
    render(
      <TaskSchedulingDialog
        open
        onOpenChange={vi.fn()}
        tasks={[
          task({
            id: "task_first",
            title: "First task",
            plannedDurationSeconds: 30 * 60,
            keyword: "first-keyword"
          }),
          task({
            id: "task_second",
            title: "Second task",
            plannedDurationSeconds: 90 * 60,
            keyword: "second-keyword"
          })
        ]}
        onSave={onSave}
      />
    );

    expect(await screen.findByDisplayValue("30")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("30"), {
      target: { value: "45" }
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Task" }), {
      target: { value: "task_second" }
    });

    expect(await screen.findByDisplayValue("90")).toBeInTheDocument();
    expect(screen.getByDisplayValue("second-keyword")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("first-keyword")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save task rules" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task_second",
          plannedDurationSeconds: 90 * 60,
          schedulingRules: expect.objectContaining({
            allowEventKeywords: ["second-keyword"]
          })
        })
      )
    );
  });
});
