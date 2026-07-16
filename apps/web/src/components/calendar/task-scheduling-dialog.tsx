import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { SchedulingRulesEditor } from "@/components/calendar/scheduling-rules-editor";
import { SheetScaffold } from "@/components/experience/sheet-scaffold";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { evaluateSchedulingRulesNow } from "@/lib/calendar-rules";
import type { CalendarOverviewPayload, Task } from "@/lib/types";

export function TaskSchedulingDialog({
  open,
  onOpenChange,
  tasks,
  calendar,
  userIds,
  onSave
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: Task[];
  calendar?: CalendarOverviewPayload;
  userIds?: string[];
  onSave: (input: {
    taskId: string;
    schedulingRules: Task["schedulingRules"];
    plannedDurationSeconds: number | null;
  }) => Promise<void>;
}) {
  const availableTasks = useMemo(() => {
    const allowed = new Set(userIds ?? []);
    return tasks.filter(
      (task) =>
        task.status !== "done" &&
        (allowed.size === 0 ||
          (typeof task.ownerUserId === "string" &&
            allowed.has(task.ownerUserId)) ||
          (typeof task.userId === "string" && allowed.has(task.userId)) ||
          (Array.isArray(task.assigneeUserIds) &&
            task.assigneeUserIds.some((userId) => allowed.has(userId))))
    );
  }, [tasks, userIds]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSaveError(null);
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
  const currentPressure = selectedTask
    ? evaluateSchedulingRulesNow({
        rules: selectedTask.schedulingRules,
        overview: calendar
      })
    : null;

  return (
    <SheetScaffold
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Calendar"
      title="Adjust task scheduling rules"
      description="Choose a task, then tell Forge which work blocks, calendar conditions, or keywords should allow or block that work."
    >
      <div className="grid min-w-0 gap-4">
        <Card className="min-w-0 overflow-hidden rounded-[28px] border border-[var(--ui-border-subtle)] !bg-[var(--ui-surface-1)]">
          <div className="flex min-w-0 items-start gap-3">
            <div className="rounded-[18px] bg-[var(--primary)]/14 p-3 text-[var(--primary)]">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="font-medium text-[var(--ui-ink-strong)]">
                Guided rule editing
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                Use this when a task should only run in certain blocks such as
                Secondary Activity, or should stay blocked during clinic, rest,
                or other provider events.
              </p>
            </div>
          </div>
        </Card>

        {availableTasks.length > 0 ? (
          <>
            <label className="grid min-w-0 gap-2">
              <span className="text-sm text-[var(--ui-ink-soft)]">Task</span>
              <select
                value={selectedTaskId}
                onChange={(event) => {
                  setSelectedTaskId(event.target.value);
                  setSaveError(null);
                }}
                className="w-full min-w-0 max-w-full rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 text-[15px] text-[var(--ui-ink-strong)] outline-none transition focus:border-[var(--ui-border-strong)] focus:ring-2 focus:ring-[var(--primary)]/20"
              >
                {availableTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </label>

            {currentPressure ? (
              <Card
                className="min-w-0 overflow-hidden rounded-[24px] border-[var(--ui-border-subtle)] !bg-[var(--ui-surface-1)]"
                aria-live="polite"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                      Current pressure
                    </div>
                    <div className="mt-2 font-medium text-[var(--ui-ink-strong)]">
                      {currentPressure.label}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                      currentPressure.blocked
                        ? "bg-[var(--ui-danger-soft)] text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]"
                        : "bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)]"
                    }`}
                  >
                    {currentPressure.blocked ? "Blocked" : "Available"}
                  </span>
                </div>
                {currentPressure.context.length > 0 ? (
                  <p className="mt-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
                    {currentPressure.context.slice(0, 4).join(" · ")}
                  </p>
                ) : null}
                {currentPressure.conflicts.length > 0 ? (
                  <div className="mt-3 grid gap-2">
                    {currentPressure.conflicts.map((conflict) => (
                      <div
                        key={conflict}
                        className="rounded-[16px] bg-[var(--ui-danger-soft)] px-3 py-2 text-sm text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]"
                      >
                        {conflict}
                      </div>
                    ))}
                  </div>
                ) : null}
              </Card>
            ) : null}

            {saveError ? (
              <div
                role="alert"
                className="rounded-[20px] border border-[color-mix(in_srgb,var(--danger)_24%,var(--ui-border-subtle)_76%)] bg-[var(--ui-danger-soft)] px-4 py-3 text-sm text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]"
              >
                {saveError}
              </div>
            ) : null}

            {selectedTask ? (
              <SchedulingRulesEditor
                key={selectedTask.id}
                title="Task rules"
                subtitle="These rules are saved directly on the task. They drive blocked-now checks and future timebox recommendations."
                initialRules={selectedTask.schedulingRules}
                initialPlannedDurationSeconds={
                  selectedTask.plannedDurationSeconds
                }
                allowPlannedDuration
                saveLabel="Save task rules"
                onSave={async ({ schedulingRules, plannedDurationSeconds }) => {
                  setSaveError(null);
                  try {
                    await onSave({
                      taskId: selectedTask.id,
                      schedulingRules,
                      plannedDurationSeconds:
                        plannedDurationSeconds === undefined
                          ? selectedTask.plannedDurationSeconds
                          : (plannedDurationSeconds ?? null)
                    });
                    onOpenChange(false);
                  } catch (error) {
                    setSaveError(
                      error instanceof Error
                        ? error.message
                        : "Forge could not save the task scheduling rules."
                    );
                  }
                }}
              />
            ) : null}
          </>
        ) : (
          <Card className="min-w-0 overflow-hidden rounded-[28px] border border-[var(--ui-border-subtle)] !bg-[var(--ui-surface-1)]">
            <div className="font-medium text-[var(--ui-ink-strong)]">
              No schedulable tasks yet
            </div>
            <p className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
              Create or reopen a task first, then come back here to define
              work-block and calendar eligibility.
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
