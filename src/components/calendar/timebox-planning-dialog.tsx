import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { recommendTaskTimeboxes } from "@/lib/api";
import { formatWeekday } from "@/lib/calendar-ui";
import type { Task, TaskTimebox } from "@/lib/types";

type PlannerDraft = {
  taskId: string;
  selectedTimeboxId: string;
};

export function TimeboxPlanningDialog({
  open,
  onOpenChange,
  tasks,
  from,
  to,
  onCreateTimebox
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: Task[];
  from: string;
  to: string;
  onCreateTimebox: (input: {
    taskId: string;
    projectId?: string | null;
    title: string;
    startsAt: string;
    endsAt: string;
    source?: TaskTimebox["source"];
  }) => Promise<void>;
}) {
  const availableTasks = useMemo(
    () => tasks.filter((task) => task.status !== "done"),
    [tasks]
  );
  const [draft, setDraft] = useState<PlannerDraft>({
    taskId: "",
    selectedTimeboxId: ""
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    const nextTaskId = availableTasks[0]?.id ?? "";
    setSubmitError(null);
    setDraft({
      taskId: nextTaskId,
      selectedTimeboxId: ""
    });
  }, [availableTasks, open]);

  const selectedTask =
    availableTasks.find((task) => task.id === draft.taskId) ?? null;

  const suggestionQuery = useQuery({
    queryKey: ["forge-calendar-suggestions-dialog", draft.taskId, from, to],
    queryFn: () =>
      recommendTaskTimeboxes({
        taskId: draft.taskId,
        from,
        to,
        limit: 8
      }),
    enabled: open && draft.taskId.length > 0
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    const suggestions = suggestionQuery.data?.timeboxes ?? [];
    if (!suggestions.length) {
      setDraft((current) =>
        current.selectedTimeboxId ? { ...current, selectedTimeboxId: "" } : current
      );
      return;
    }
    setDraft((current) =>
      current.selectedTimeboxId &&
      suggestions.some((timebox) => timebox.id === current.selectedTimeboxId)
        ? current
        : {
            ...current,
            selectedTimeboxId: suggestions[0].id
          }
    );
  }, [open, suggestionQuery.data]);

  const steps = useMemo<Array<QuestionFlowStep<PlannerDraft>>>(
    () => [
      {
        id: "task",
        eyebrow: "Planning",
        title: "Choose the task you want to place into the week",
        description:
          "Forge will use the task's current planned duration and scheduling rules when it searches for valid slots.",
        render: (value, setValue) => (
          <div className="grid gap-4">
            <FlowField label="Task">
              <select
                value={value.taskId}
                onChange={(event) =>
                  setValue({
                    taskId: event.target.value,
                    selectedTimeboxId: ""
                  })
                }
                className="rounded-[22px] border border-white/8 bg-white/6 px-4 py-3 text-[15px] text-white outline-none"
              >
                {availableTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </FlowField>

            {selectedTask ? (
              <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
                <div className="font-medium text-white">{selectedTask.title}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge className="bg-white/[0.08] text-white/74">
                    {selectedTask.plannedDurationSeconds
                      ? `${Math.round(selectedTask.plannedDurationSeconds / 60)} min target`
                      : "No duration yet"}
                  </Badge>
                  <Badge className="bg-white/[0.08] text-white/74">
                    {selectedTask.schedulingRules ? "Custom scheduling rules" : "Inherits project rules"}
                  </Badge>
                </div>
              </div>
            ) : null}
          </div>
        )
      },
      {
        id: "slot",
        eyebrow: "Suggestion",
        title: "Pick one of Forge's recommended timeboxes",
        description:
          "The slots below come from your connected calendar, work blocks, and the current task rules.",
        render: (value, setValue) => {
          const suggestions = suggestionQuery.data?.timeboxes ?? [];
          if (suggestionQuery.isLoading) {
            return <div className="text-sm text-white/62">Looking for valid upcoming slots…</div>;
          }
          if (!suggestions.length) {
            return (
              <div className="grid gap-3">
                <div className="rounded-[24px] border border-amber-400/20 bg-amber-400/10 px-4 py-4 text-sm leading-6 text-amber-100/86">
                  Forge could not find a valid slot in the selected window. Adjust work blocks or task rules, then try again.
                </div>
                <Button variant="secondary" onClick={() => void suggestionQuery.refetch()}>
                  Refresh suggestions
                </Button>
              </div>
            );
          }

          return (
            <div className="grid gap-3">
              {suggestions.map((timebox) => {
                const active = value.selectedTimeboxId === timebox.id;
                return (
                  <button
                    key={timebox.id}
                    type="button"
                    onClick={() => setValue({ selectedTimeboxId: timebox.id })}
                    className={`rounded-[24px] border px-4 py-4 text-left transition ${
                      active
                        ? "border-[rgba(192,193,255,0.28)] bg-[rgba(192,193,255,0.14)] text-white"
                        : "border-white/8 bg-white/[0.04] text-white/72 hover:bg-white/[0.07]"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="font-medium">{timebox.title}</div>
                      <Badge className="bg-white/[0.08] text-white/76">{timebox.source}</Badge>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-white/58">
                      {formatWeekday(new Date(timebox.startsAt))} ·{" "}
                      {new Date(timebox.startsAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit"
                      })}{" "}
                      -{" "}
                      {new Date(timebox.endsAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                    </div>
                  </button>
                );
              })}
            </div>
          );
        }
      }
    ],
    [availableTasks, selectedTask, suggestionQuery]
  );

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Calendar"
      title="Plan a task timebox"
      description="Pick a task, review Forge's slot recommendations, and schedule it directly into the calendar."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel="Schedule timebox"
      pending={submitting}
      pendingLabel="Scheduling"
      error={submitError}
      onSubmit={async () => {
        const suggestion = (suggestionQuery.data?.timeboxes ?? []).find(
          (timebox) => timebox.id === draft.selectedTimeboxId
        );
        if (!suggestion) {
          setSubmitError("Pick one suggested slot before scheduling the timebox.");
          return;
        }
        try {
          setSubmitting(true);
          setSubmitError(null);
          await onCreateTimebox({
            taskId: suggestion.taskId,
            projectId: suggestion.projectId,
            title: suggestion.title,
            startsAt: suggestion.startsAt,
            endsAt: suggestion.endsAt,
            source: "suggested"
          });
          onOpenChange(false);
        } catch (error) {
          setSubmitError(
            error instanceof Error ? error.message : "Forge could not create the selected timebox."
          );
        } finally {
          setSubmitting(false);
        }
      }}
    />
  );
}
