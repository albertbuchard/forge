import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { SchedulingRulesEditor } from "@/components/calendar/scheduling-rules-editor";
import { SheetScaffold } from "@/components/experience/sheet-scaffold";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Task } from "@/lib/types";

export function TaskSchedulingDialog({
  open,
  onOpenChange,
  tasks,
  onSave
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: Task[];
  onSave: (input: {
    taskId: string;
    schedulingRules: Task["schedulingRules"];
    plannedDurationSeconds: number | null;
  }) => Promise<void>;
}) {
  const availableTasks = useMemo(
    () => tasks.filter((task) => task.status !== "done"),
    [tasks]
  );
  const [selectedTaskId, setSelectedTaskId] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    if (availableTasks.length === 0) {
      setSelectedTaskId("");
      return;
    }
    setSelectedTaskId((current) =>
      current && availableTasks.some((task) => task.id === current)
        ? current
        : availableTasks[0].id
    );
  }, [availableTasks, open]);

  const selectedTask =
    availableTasks.find((task) => task.id === selectedTaskId) ?? null;

  return (
    <SheetScaffold
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Calendar"
      title="Adjust task scheduling rules"
      description="Choose a task, then tell Forge which work blocks, calendar conditions, or keywords should allow or block that work."
    >
      <div className="grid gap-4">
        <Card className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(18,28,38,0.98),rgba(11,17,28,0.98))]">
          <div className="flex items-start gap-3">
            <div className="rounded-[18px] bg-[var(--primary)]/14 p-3 text-[var(--primary)]">
              <Sparkles className="size-4" />
            </div>
            <div>
              <div className="font-medium text-white">Guided rule editing</div>
              <p className="mt-2 text-sm leading-6 text-white/60">
                Use this when a task should only run in certain blocks such as Secondary Activity, or should stay blocked during clinic, rest, or other provider events.
              </p>
            </div>
          </div>
        </Card>

        {availableTasks.length > 0 ? (
          <>
            <label className="grid gap-2">
              <span className="text-sm text-white/58">Task</span>
              <select
                value={selectedTaskId}
                onChange={(event) => setSelectedTaskId(event.target.value)}
                className="rounded-[22px] border border-white/8 bg-white/6 px-4 py-3 text-[15px] text-white outline-none"
              >
                {availableTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </label>

            {selectedTask ? (
              <SchedulingRulesEditor
                title="Task rules"
                subtitle="These rules are saved directly on the task. They drive blocked-now checks and future timebox recommendations."
                initialRules={selectedTask.schedulingRules}
                initialPlannedDurationSeconds={selectedTask.plannedDurationSeconds}
                allowPlannedDuration
                saveLabel="Save task rules"
                onSave={async ({ schedulingRules, plannedDurationSeconds }) => {
                  await onSave({
                    taskId: selectedTask.id,
                    schedulingRules,
                    plannedDurationSeconds:
                      plannedDurationSeconds === undefined
                        ? selectedTask.plannedDurationSeconds
                        : plannedDurationSeconds ?? null
                  });
                  onOpenChange(false);
                }}
              />
            ) : null}
          </>
        ) : (
          <Card className="rounded-[28px] border border-white/8 bg-white/[0.04]">
            <div className="font-medium text-white">No schedulable tasks yet</div>
            <p className="mt-2 text-sm leading-6 text-white/60">
              Create or reopen a task first, then come back here to define work-block and calendar eligibility.
            </p>
            <div className="mt-4">
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </Card>
        )}
      </div>
    </SheetScaffold>
  );
}
