import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCalendarOverview, recommendTaskTimeboxes } from "@/lib/api";
import { formatWeekday } from "@/lib/calendar-ui";
import {
  estimateTaskTimeboxActionPointLoad,
  formatLifeForceAp,
  formatLifeForceRate,
  getCalendarActivityPresetOptions
} from "@/lib/life-force-display";
import type { CalendarEvent, Task, TaskTimebox, WorkBlockInstance } from "@/lib/types";

type PlannerMode = "suggested" | "manual";

type PlannerDraft = {
  taskId: string;
  preferredDate: string;
  plannerMode: PlannerMode;
  selectedTimeboxId: string;
  activityPresetKey: string | null;
  customSustainRateApPerHour: number | null;
  manualStartTime: string;
  manualEndTime: string;
  manualTitle: string;
  overrideReason: string;
};

function toDateKey(input: string) {
  return input.slice(0, 10);
}

function toDayStartIso(dateKey: string) {
  return new Date(`${dateKey}T00:00:00`).toISOString();
}

function toDayEndIso(dateKey: string) {
  return new Date(`${dateKey}T23:59:59.999`).toISOString();
}

function clampDateKey(dateKey: string, minDateKey: string, maxDateKey: string) {
  if (dateKey < minDateKey) {
    return minDateKey;
  }
  if (dateKey > maxDateKey) {
    return maxDateKey;
  }
  return dateKey;
}

function getPreferredPlanningDateKey(from: string, to: string) {
  const minDateKey = toDateKey(from);
  const maxDateKey = toDateKey(to);
  const candidate = new Date(`${minDateKey}T12:00:00`);
  candidate.setDate(candidate.getDate() + 1);
  return clampDateKey(toDateKey(candidate.toISOString()), minDateKey, maxDateKey);
}

function padNumber(value: number) {
  return String(value).padStart(2, "0");
}

function toTimeInputValue(date: Date) {
  return `${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`;
}

function parseDateAndTime(dateKey: string, timeValue: string) {
  if (!dateKey || !timeValue) {
    return null;
  }
  const date = new Date(`${dateKey}T${timeValue}:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildManualWindow(
  dateKey: string,
  durationSeconds?: number | null,
  seed?: { startsAt: string; endsAt: string } | null
) {
  if (seed) {
    const seededStart = new Date(seed.startsAt);
    const seededEnd = new Date(seed.endsAt);
    return {
      startTime: toTimeInputValue(seededStart),
      endTime: toTimeInputValue(seededEnd)
    };
  }
  const start = new Date(`${dateKey}T09:00:00`);
  const boundedDurationSeconds = Math.max(
    30 * 60,
    Math.min(durationSeconds ?? 60 * 60, 6 * 60 * 60)
  );
  const end = new Date(start.getTime() + boundedDurationSeconds * 1000);
  return {
    startTime: toTimeInputValue(start),
    endTime: toTimeInputValue(end)
  };
}

function formatClockRange(startAt: string, endAt: string) {
  return `${new Date(startAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  })} - ${new Date(endAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}

function formatContextTime(startAt: string, endAt: string) {
  return `${formatWeekday(new Date(startAt))} · ${formatClockRange(startAt, endAt)}`;
}

function CalendarContextColumn({
  title,
  subtitle,
  emptyLabel,
  children
}: {
  title: string;
  subtitle: string;
  emptyLabel: string;
  children: ReactNode;
}) {
  const items = Array.isArray(children) ? children : children ? [children] : [];
  return (
    <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium text-white">{title}</div>
          <div className="mt-1 text-sm text-white/54">{subtitle}</div>
        </div>
        <Badge className="bg-white/[0.08] text-white/74">{items.length}</Badge>
      </div>
      <div className="mt-3 grid gap-2">
        {items.length > 0 ? (
          items
        ) : (
          <div className="rounded-[18px] border border-dashed border-white/8 bg-white/[0.03] px-3 py-3 text-sm text-white/46">
            {emptyLabel}
          </div>
        )}
      </div>
    </div>
  );
}

function CalendarEventCard({ event }: { event: CalendarEvent }) {
  return (
    <div className="rounded-[18px] bg-white/[0.04] px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-white">{event.title}</div>
        <Badge className="bg-white/[0.08] text-white/70">{event.availability}</Badge>
      </div>
      <div className="mt-1 text-sm text-white/56">
        {formatContextTime(event.startAt, event.endAt)}
      </div>
    </div>
  );
}

function WorkBlockCard({ block }: { block: WorkBlockInstance }) {
  return (
    <div className="rounded-[18px] bg-white/[0.04] px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-white">{block.title}</div>
        <Badge className="bg-white/[0.08] text-white/70">{block.blockingState}</Badge>
      </div>
      <div className="mt-1 text-sm text-white/56">
        {formatContextTime(block.startAt, block.endAt)}
      </div>
    </div>
  );
}

function TimeboxCard({ timebox }: { timebox: TaskTimebox }) {
  const actionPointLoad = estimateTaskTimeboxActionPointLoad(timebox);
  return (
    <div className="rounded-[18px] bg-white/[0.04] px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-white">{timebox.title}</div>
        <Badge className="bg-white/[0.08] text-white/70">{timebox.source}</Badge>
      </div>
      <div className="mt-1 text-sm text-white/56">
        {formatContextTime(timebox.startsAt, timebox.endsAt)}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Badge className="bg-white/[0.08] text-white/72">
          {formatLifeForceRate(actionPointLoad.rateApPerHour)}
        </Badge>
        <Badge className="bg-white/[0.08] text-white/72">
          {formatLifeForceAp(actionPointLoad.totalAp)}
        </Badge>
      </div>
    </div>
  );
}

export function TimeboxPlanningDialog({
  open,
  onOpenChange,
  tasks,
  from,
  to,
  onCreateTimebox,
  onUpdateTimebox,
  initialTaskId,
  lockedTaskId,
  editingTimebox,
  userIds
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
    overrideReason?: string | null;
    activityPresetKey?: string | null;
    customSustainRateApPerHour?: number | null;
  }) => Promise<void>;
  onUpdateTimebox?: (
    timeboxId: string,
    patch: {
      title: string;
      startsAt: string;
      endsAt: string;
      overrideReason?: string | null;
      activityPresetKey?: string | null;
      customSustainRateApPerHour?: number | null;
    }
  ) => Promise<void>;
  initialTaskId?: string;
  lockedTaskId?: string;
  editingTimebox?: TaskTimebox | null;
  userIds?: string[];
}) {
  const isEditing = Boolean(editingTimebox);
  const availableTasks = useMemo(() => {
    const pinnedTaskId = lockedTaskId ?? editingTimebox?.taskId ?? null;
    const liveTasks = tasks.filter(
      (task) => task.status !== "done" || task.id === pinnedTaskId
    );
    if (!pinnedTaskId) {
      return liveTasks;
    }
    const locked = liveTasks.find((task) => task.id === pinnedTaskId);
    return locked ? [locked] : [];
  }, [editingTimebox?.taskId, lockedTaskId, tasks]);

  const minDateKey = toDateKey(from);
  const maxDateKey = toDateKey(to);
  const defaultDateKey = editingTimebox
    ? clampDateKey(toDateKey(editingTimebox.startsAt), minDateKey, maxDateKey)
    : getPreferredPlanningDateKey(from, to);
  const defaultTaskId =
    lockedTaskId ??
    editingTimebox?.taskId ??
    initialTaskId ??
    availableTasks[0]?.id ??
    "";
  const defaultTask =
    availableTasks.find((task) => task.id === defaultTaskId) ?? availableTasks[0] ?? null;
  const defaultManualWindow = buildManualWindow(
    defaultDateKey,
    defaultTask?.plannedDurationSeconds,
    editingTimebox
      ? {
          startsAt: editingTimebox.startsAt,
          endsAt: editingTimebox.endsAt
        }
      : null
  );

  const [draft, setDraft] = useState<PlannerDraft>({
    taskId: defaultTaskId,
    preferredDate: defaultDateKey,
    plannerMode: editingTimebox ? "manual" : "suggested",
    selectedTimeboxId: "",
    activityPresetKey:
      editingTimebox?.actionProfile?.profileKey ?? "task_inherited",
    customSustainRateApPerHour:
      editingTimebox?.actionProfile?.sourceMethod === "manual"
        ? editingTimebox.actionProfile.sustainRateApPerHour
        : null,
    manualStartTime: defaultManualWindow.startTime,
    manualEndTime: defaultManualWindow.endTime,
    manualTitle: editingTimebox?.title ?? defaultTask?.title ?? "",
    overrideReason: editingTimebox?.overrideReason ?? ""
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    const nextTaskId = lockedTaskId ?? initialTaskId ?? availableTasks[0]?.id ?? "";
    const resolvedTaskId = editingTimebox?.taskId ?? nextTaskId;
    const nextTask =
      availableTasks.find((task) => task.id === resolvedTaskId) ?? availableTasks[0] ?? null;
    const nextDateKey = editingTimebox
      ? clampDateKey(toDateKey(editingTimebox.startsAt), minDateKey, maxDateKey)
      : getPreferredPlanningDateKey(from, to);
    const nextManualWindow = buildManualWindow(
      nextDateKey,
      nextTask?.plannedDurationSeconds,
      editingTimebox
        ? {
            startsAt: editingTimebox.startsAt,
            endsAt: editingTimebox.endsAt
          }
        : null
    );
    setSubmitError(null);
    setDraft({
      taskId: resolvedTaskId,
      preferredDate: nextDateKey,
      plannerMode: editingTimebox ? "manual" : "suggested",
      selectedTimeboxId: "",
      activityPresetKey:
        editingTimebox?.actionProfile?.profileKey ?? "task_inherited",
      customSustainRateApPerHour:
        editingTimebox?.actionProfile?.sourceMethod === "manual"
          ? editingTimebox.actionProfile.sustainRateApPerHour
          : null,
      manualStartTime: nextManualWindow.startTime,
      manualEndTime: nextManualWindow.endTime,
      manualTitle: editingTimebox?.title ?? nextTask?.title ?? "",
      overrideReason: editingTimebox?.overrideReason ?? ""
    });
  }, [availableTasks, editingTimebox, from, initialTaskId, lockedTaskId, maxDateKey, minDateKey, open, to]);

  const selectedTask =
    availableTasks.find((task) => task.id === draft.taskId) ?? null;

  const selectedDayWindow = useMemo(
    () => ({
      from: toDayStartIso(draft.preferredDate),
      to: toDayEndIso(draft.preferredDate)
    }),
    [draft.preferredDate]
  );

  const suggestionQuery = useQuery({
    queryKey: [
      "forge-calendar-suggestions-dialog",
      draft.taskId,
      selectedDayWindow.from,
      selectedDayWindow.to
    ],
    queryFn: () =>
      recommendTaskTimeboxes({
        taskId: draft.taskId,
        from: selectedDayWindow.from,
        to: selectedDayWindow.to,
        limit: 8
      }),
    enabled: open && draft.taskId.length > 0
  });

  const calendarDayQuery = useQuery({
    queryKey: [
      "forge-calendar-timebox-dialog-day",
      selectedDayWindow.from,
      selectedDayWindow.to,
      ...(userIds ?? [])
    ],
    queryFn: () =>
      getCalendarOverview({
        from: selectedDayWindow.from,
        to: selectedDayWindow.to,
        userIds
      }),
    enabled: open
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

  const calendarDay = calendarDayQuery.data?.calendar;
  const dayEvents = calendarDay?.events ?? [];
  const dayBlocks = calendarDay?.workBlockInstances ?? [];
  const dayTimeboxes = calendarDay?.timeboxes ?? [];
  const selectedSuggestion = (suggestionQuery.data?.timeboxes ?? []).find(
    (timebox) => timebox.id === draft.selectedTimeboxId
  );
  const manualStart = parseDateAndTime(draft.preferredDate, draft.manualStartTime);
  const manualEnd = parseDateAndTime(draft.preferredDate, draft.manualEndTime);
  const manualPreview =
    manualStart && manualEnd
      ? estimateTaskTimeboxActionPointLoad({
          startsAt: manualStart.toISOString(),
          endsAt: manualEnd.toISOString(),
          actionProfile:
            draft.customSustainRateApPerHour !== null ||
            draft.activityPresetKey !== "task_inherited"
              ? {
                  id: "manual-preview",
                  profileKey: "manual-preview",
                  title: draft.manualTitle || selectedTask?.title || "Manual timebox",
                  entityType: "task_timebox",
                  mode: "container",
                  startupAp: 0,
                  totalCostAp: 0,
                  expectedDurationSeconds: null,
                  sustainRateApPerHour:
                    draft.customSustainRateApPerHour ??
                    getCalendarActivityPresetOptions().find(
                      (preset) => preset.key === draft.activityPresetKey
                    )?.defaultRateApPerHour ??
                    100 / 24,
                  demandWeights: {
                    activation: 0.1,
                    focus: 0.3,
                    vigor: 0.1,
                    composure: 0.1,
                    flow: 0.4
                  },
                  doubleCountPolicy: "container_only",
                  sourceMethod: "manual",
                  costBand: "light",
                  recoveryEffect: 0,
                  metadata: {},
                  createdAt: manualStart.toISOString(),
                  updatedAt: manualStart.toISOString()
                }
              : null
        })
      : null;

  const taskStepTitle = isEditing
    ? "Review the task tied to this scheduled block"
    : lockedTaskId
    ? "Review the task you are planning"
    : "Choose the task you want to place into the calendar";

  const taskStepDescription = isEditing
    ? "The timebox stays linked to this task. Update the day, hours, title, or AP profile without leaving the planning flow."
    : lockedTaskId
    ? "Forge will use this task's current duration target and scheduling rules while it looks for viable slots."
    : "Forge will use the task's current planned duration and scheduling rules when it searches for valid slots.";

  const steps = useMemo<Array<QuestionFlowStep<PlannerDraft>>>(
    () => [
      {
        id: "task",
        eyebrow: "Planning",
        title: taskStepTitle,
        description: taskStepDescription,
        render: (value, setValue) => (
          <div className="grid gap-4">
            {!lockedTaskId ? (
              <FlowField label="Task">
                <select
                  value={value.taskId}
                  onChange={(event) =>
                    (() => {
                      const nextTask = availableTasks.find(
                        (task) => task.id === event.target.value
                      );
                      const nextManualWindow = buildManualWindow(
                        value.preferredDate,
                        nextTask?.plannedDurationSeconds
                      );
                      setValue({
                        taskId: event.target.value,
                        selectedTimeboxId: "",
                        activityPresetKey: "task_inherited",
                        customSustainRateApPerHour: null,
                        manualStartTime: nextManualWindow.startTime,
                        manualEndTime: nextManualWindow.endTime,
                        manualTitle: nextTask?.title ?? value.manualTitle
                      });
                    })()
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
            ) : null}

            {selectedTask ? (
              <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(28,36,54,0.78),rgba(15,22,34,0.78))] p-5 shadow-[0_18px_40px_rgba(5,12,24,0.22)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                      Time Box
                    </div>
                    <div className="mt-2 font-display text-[1.4rem] leading-tight text-white">
                      {selectedTask.title}
                    </div>
                  </div>
                  <Badge className="bg-white/[0.08] text-white/74">
                    {selectedTask.status}
                  </Badge>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge className="bg-white/[0.08] text-white/74">
                    {selectedTask.plannedDurationSeconds
                      ? `${Math.round(selectedTask.plannedDurationSeconds / 60)} min target`
                      : "No duration yet"}
                  </Badge>
                  <Badge className="bg-white/[0.08] text-white/74">
                    {selectedTask.schedulingRules ? "Task-specific rules" : "Uses project rules"}
                  </Badge>
                  <Badge className="bg-white/[0.08] text-white/74">
                    {selectedTask.points} xp
                  </Badge>
                  {selectedTask.plannedDurationSeconds ? (
                    <Badge className="bg-white/[0.08] text-white/74">
                      {formatLifeForceAp(
                        ((selectedTask.plannedDurationSeconds / 3600) / 24) * 100
                      )} target load
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-4 text-sm leading-6 text-white/60">
                  Pick a day first, then either accept one of Forge&apos;s suggested slots or set the block manually.
                </p>
              </div>
            ) : null}
          </div>
        )
      },
      {
        id: "day",
        eyebrow: "Calendar",
        title: "Choose the day and review what is already there",
        description:
          "Forge reads the real day first so the timebox stays grounded in your provider events, work blocks, and already-planned work.",
        render: (value, setValue) => (
          <div className="grid gap-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
              <div className="grid gap-4">
                <FlowField
                  label="Date"
                  description="Choose the day you want to protect for this task."
                >
                  <Input
                    type="date"
                    min={minDateKey}
                    max={maxDateKey}
                    value={value.preferredDate}
                    onChange={(event) => {
                      const nextManualWindow = buildManualWindow(
                        event.target.value,
                        selectedTask?.plannedDurationSeconds,
                        editingTimebox
                          ? {
                              startsAt: `${event.target.value}T${value.manualStartTime}:00`,
                              endsAt: `${event.target.value}T${value.manualEndTime}:00`
                            }
                          : null
                      );
                      setValue({
                        preferredDate: event.target.value,
                        selectedTimeboxId: "",
                        manualStartTime: nextManualWindow.startTime,
                        manualEndTime: nextManualWindow.endTime
                      });
                    }}
                  />
                </FlowField>
                <FlowField
                  label="Planning style"
                  description="Take Forge's slot recommendation when it fits, or set the block yourself."
                >
                  <FlowChoiceGrid
                    value={value.plannerMode}
                    onChange={(plannerMode) =>
                      setValue({ plannerMode: plannerMode as PlannerMode })
                    }
                    options={[
                      {
                        value: "suggested",
                        label: "Use suggestions",
                        description: "Forge proposes slots that fit the task rules and the selected day."
                      },
                      {
                        value: "manual",
                        label: "Set it manually",
                        description: "You choose the exact start and end time yourself."
                      }
                    ]}
                  />
                </FlowField>
              </div>
              <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(21,31,44,0.86),rgba(11,17,28,0.86))] p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
                      Selected day
                    </div>
                    <div className="mt-2 font-display text-[1.3rem] leading-tight text-white">
                      {value.preferredDate
                        ? new Date(`${value.preferredDate}T12:00:00`).toLocaleDateString([], {
                            weekday: "long",
                            month: "long",
                            day: "numeric"
                          })
                        : "Choose a day"}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge className="bg-white/[0.08] text-white/74">
                      {dayEvents.length} events
                    </Badge>
                    <Badge className="bg-white/[0.08] text-white/74">
                      {dayBlocks.length} work blocks
                    </Badge>
                    <Badge className="bg-white/[0.08] text-white/74">
                      {dayTimeboxes.length} timeboxes
                    </Badge>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-white/58">
                  This is the context Forge will use while recommending a slot. You can still place the block manually if you want something more exact.
                </p>
                {calendarDayQuery.isLoading ? (
                  <div className="mt-4 rounded-[18px] border border-white/8 bg-white/[0.04] px-4 py-4 text-sm text-white/56">
                    Loading the selected day…
                  </div>
                ) : (
                  <div className="mt-4 grid gap-4 xl:grid-cols-3">
                    <CalendarContextColumn
                      title="Provider events"
                      subtitle="Busy or free events already on the day."
                      emptyLabel="No mirrored events on this day."
                    >
                      {dayEvents.slice(0, 4).map((event) => (
                        <CalendarEventCard key={event.id} event={event} />
                      ))}
                    </CalendarContextColumn>
                    <CalendarContextColumn
                      title="Work blocks"
                      subtitle="Recurring allowed or blocked containers."
                      emptyLabel="No work blocks land on this day."
                    >
                      {dayBlocks.slice(0, 4).map((block) => (
                        <WorkBlockCard key={block.id} block={block} />
                      ))}
                    </CalendarContextColumn>
                    <CalendarContextColumn
                      title="Planned timeboxes"
                      subtitle="Existing owned work already placed there."
                      emptyLabel="No other planned timeboxes yet."
                    >
                      {dayTimeboxes.slice(0, 4).map((timebox) => (
                        <TimeboxCard key={timebox.id} timebox={timebox} />
                      ))}
                    </CalendarContextColumn>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      },
      {
        id: "slot",
        eyebrow: draft.plannerMode === "suggested" ? "Suggestion" : "Manual",
        title:
          draft.plannerMode === "suggested"
            ? "Choose one of Forge's suggested slots"
            : "Set the exact timebox yourself",
        description:
          draft.plannerMode === "suggested"
            ? "Forge proposes slots that fit the selected day, the task rules, and the current calendar picture."
            : "Use manual mode when the right block is obvious to you or when you want to place the timebox despite imperfect recommendations.",
        render: (value, setValue) => {
          if (value.plannerMode === "manual") {
            return (
              <div className="grid gap-5">
                <div className="grid gap-4 md:grid-cols-3">
                  <FlowField
                    label="Day"
                    description="Pick the day for the block. Forge defaults to a future day, but you can move it."
                  >
                    <Input
                      type="date"
                      min={minDateKey}
                      max={maxDateKey}
                      value={value.preferredDate}
                      onChange={(event) => setValue({ preferredDate: event.target.value })}
                    />
                  </FlowField>
                  <FlowField
                    label="Start time"
                    description="Choose when the protected work block should begin."
                  >
                    <Input
                      type="time"
                      step={300}
                      value={value.manualStartTime}
                      onChange={(event) =>
                        setValue({ manualStartTime: event.target.value })
                      }
                    />
                  </FlowField>
                  <FlowField
                    label="End time"
                    description="Choose when the work block should end."
                  >
                    <Input
                      type="time"
                      step={300}
                      value={value.manualEndTime}
                      onChange={(event) =>
                        setValue({ manualEndTime: event.target.value })
                      }
                    />
                  </FlowField>
                </div>
                <FlowField
                  label="Title"
                  description="By default Forge uses the task title. Tighten it only if a shorter calendar label would help."
                >
                  <Input
                    value={value.manualTitle}
                    onChange={(event) =>
                      setValue({ manualTitle: event.target.value })
                    }
                    placeholder={selectedTask?.title ?? "Task timebox"}
                  />
                </FlowField>
                <FlowField
                  label="Override reason"
                  description="Optional. Add a short reason only if you are intentionally placing the block despite the normal rules or calendar shape."
                >
                  <Input
                    value={value.overrideReason}
                    onChange={(event) =>
                      setValue({ overrideReason: event.target.value })
                    }
                    placeholder="Protected writing block before clinic."
                  />
                </FlowField>
                <div className="grid gap-4 md:grid-cols-2">
                  <FlowField label="Activity profile">
                    <select
                      value={value.activityPresetKey ?? "task_inherited"}
                      onChange={(event) =>
                        setValue({ activityPresetKey: event.target.value })
                      }
                      className="rounded-[18px] border border-white/8 bg-white/6 px-4 py-3 text-[15px] text-white outline-none"
                    >
                      {getCalendarActivityPresetOptions().map((preset) => (
                        <option key={preset.key} value={preset.key}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </FlowField>
                  <FlowField label="Custom AP per hour">
                    <Input
                      type="number"
                      min={0}
                      step={0.5}
                      value={value.customSustainRateApPerHour ?? ""}
                      onChange={(event) =>
                        setValue({
                          customSustainRateApPerHour:
                            event.target.value.trim() === ""
                              ? null
                              : Number(event.target.value)
                        })
                      }
                      placeholder="Leave empty to use the activity profile"
                    />
                  </FlowField>
                </div>
                <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-white">
                        {value.manualTitle || selectedTask?.title || "Manual timebox"}
                      </div>
                      <div className="mt-1 text-sm text-white/56">
                        {manualStart && manualEnd
                          ? `${manualStart.toLocaleDateString([], {
                              weekday: "long",
                              month: "short",
                              day: "numeric"
                            })} · ${formatClockRange(
                              manualStart.toISOString(),
                              manualEnd.toISOString()
                            )}`
                          : "Choose a start and end time."}
                      </div>
                    </div>
                    <Badge className="bg-white/[0.08] text-white/74">manual</Badge>
                  </div>
                  {manualPreview ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge className="bg-white/[0.08] text-white/72">
                        {formatLifeForceRate(manualPreview.rateApPerHour)}
                      </Badge>
                      <Badge className="bg-white/[0.08] text-white/72">
                        {formatLifeForceAp(manualPreview.totalAp)}
                      </Badge>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          }

          const suggestions = suggestionQuery.data?.timeboxes ?? [];
          if (suggestionQuery.isLoading) {
            return <div className="text-sm text-white/62">Looking for valid slots on the selected day…</div>;
          }
          if (!suggestions.length) {
            return (
              <div className="grid gap-3">
                <div className="rounded-[24px] border border-amber-400/20 bg-amber-400/10 px-4 py-4 text-sm leading-6 text-amber-100/86">
                  Forge could not find a valid slot on this day. Try another day, adjust the task rules, or switch to manual placement if you already know the right block.
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => void suggestionQuery.refetch()}>
                    Refresh suggestions
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setValue({ plannerMode: "manual" })}
                  >
                    Switch to manual
                  </Button>
                </div>
              </div>
            );
          }

          return (
            <div className="grid gap-3">
              {suggestions.map((timebox) => {
                const active = value.selectedTimeboxId === timebox.id;
                const actionPointLoad = estimateTaskTimeboxActionPointLoad({
                  ...timebox,
                  actionProfile:
                    value.customSustainRateApPerHour !== null ||
                    value.activityPresetKey !== "task_inherited"
                      ? {
                          id: "suggested-preview",
                          profileKey: "suggested-preview",
                          title: timebox.title,
                          entityType: "task_timebox",
                          mode: "container",
                          startupAp: 0,
                          totalCostAp: 0,
                          expectedDurationSeconds: null,
                          sustainRateApPerHour:
                            value.customSustainRateApPerHour ??
                            getCalendarActivityPresetOptions().find(
                              (preset) => preset.key === value.activityPresetKey
                            )?.defaultRateApPerHour ??
                            100 / 24,
                          demandWeights: {
                            activation: 0.1,
                            focus: 0.3,
                            vigor: 0.1,
                            composure: 0.1,
                            flow: 0.4
                          },
                          doubleCountPolicy: "container_only",
                          sourceMethod: "manual",
                          costBand: "light",
                          recoveryEffect: 0,
                          metadata: {},
                          createdAt: timebox.startsAt,
                          updatedAt: timebox.startsAt
                        }
                      : null
                });
                return (
                  <button
                    key={timebox.id}
                    type="button"
                    onClick={() => setValue({ selectedTimeboxId: timebox.id })}
                    className={`rounded-[24px] border px-4 py-4 text-left transition ${
                      active
                        ? "border-[rgba(192,193,255,0.28)] bg-[rgba(192,193,255,0.14)] text-white shadow-[0_18px_36px_rgba(5,12,24,0.24)]"
                        : "border-white/8 bg-white/[0.04] text-white/72 hover:bg-white/[0.07]"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="font-medium">{timebox.title}</div>
                      <Badge className="bg-white/[0.08] text-white/76">{timebox.source}</Badge>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-white/58">
                      {formatContextTime(timebox.startsAt, timebox.endsAt)}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge className="bg-white/[0.08] text-white/74">
                        {formatLifeForceRate(actionPointLoad.rateApPerHour)}
                      </Badge>
                      <Badge className="bg-white/[0.08] text-white/74">
                        {formatLifeForceAp(actionPointLoad.totalAp)}
                      </Badge>
                    </div>
                    {active ? (
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <FlowField label="Activity profile">
                          <select
                            value={value.activityPresetKey ?? "task_inherited"}
                            onChange={(event) =>
                              setValue({ activityPresetKey: event.target.value })
                            }
                            className="rounded-[18px] border border-white/8 bg-white/6 px-4 py-3 text-[15px] text-white outline-none"
                          >
                            {getCalendarActivityPresetOptions().map((preset) => (
                              <option key={preset.key} value={preset.key}>
                                {preset.label}
                              </option>
                            ))}
                          </select>
                        </FlowField>
                        <FlowField label="Custom AP per hour">
                          <Input
                            type="number"
                            min={0}
                            step={0.5}
                            value={value.customSustainRateApPerHour ?? ""}
                            onChange={(event) =>
                              setValue({
                                customSustainRateApPerHour:
                                  event.target.value.trim() === ""
                                    ? null
                                    : Number(event.target.value)
                              })
                            }
                            placeholder="Leave empty to use the activity profile"
                          />
                        </FlowField>
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          );
        }
      }
    ],
    [
      availableTasks,
      calendarDayQuery.isLoading,
      dayBlocks,
      dayEvents,
      dayTimeboxes,
      draft.plannerMode,
      editingTimebox,
      from,
      lockedTaskId,
      maxDateKey,
      manualPreview,
      minDateKey,
      selectedTask,
      suggestionQuery.data,
      suggestionQuery.isLoading,
      taskStepDescription,
      taskStepTitle,
      to
    ]
  );

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Calendar"
      title={isEditing ? "Edit timebox" : "Plan work"}
      description={
        isEditing
          ? "Update the day, hour range, title, and AP profile for this scheduled block without leaving the task or calendar view."
          : "Review the day, let Forge recommend valid slots, and place a real timebox on the task without leaving the detail view."
      }
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={isEditing ? "Save timebox" : "Schedule timebox"}
      pending={submitting}
      pendingLabel="Scheduling"
      error={submitError}
      contentClassName="md:w-[min(70rem,calc(100vw-1.5rem))]"
      onSubmit={async () => {
        if (!selectedTask) {
          setSubmitError("Choose a task before scheduling a timebox.");
          return;
        }

        if (draft.plannerMode === "manual") {
          if (!manualStart || !manualEnd) {
            setSubmitError("Choose a valid manual start and end time.");
            return;
          }
          if (manualEnd <= manualStart) {
            setSubmitError("The manual timebox needs an end time after the start time.");
            return;
          }
          setSubmitError(null);
          setSubmitting(true);
          try {
            const manualPayload = {
              title: draft.manualTitle.trim() || selectedTask.title,
              startsAt: manualStart.toISOString(),
              endsAt: manualEnd.toISOString(),
              overrideReason: draft.overrideReason.trim() || null,
              activityPresetKey: draft.activityPresetKey,
              customSustainRateApPerHour: draft.customSustainRateApPerHour
            };
            if (editingTimebox && onUpdateTimebox) {
              await onUpdateTimebox(editingTimebox.id, manualPayload);
            } else {
              await onCreateTimebox({
                taskId: selectedTask.id,
                projectId: selectedTask.projectId,
                ...manualPayload,
                source: "manual"
              });
            }
            onOpenChange(false);
          } catch (error) {
            setSubmitError(
              error instanceof Error
                ? error.message
                : "Forge could not create the manual timebox."
            );
          } finally {
            setSubmitting(false);
          }
          return;
        }

        if (!selectedSuggestion) {
          setSubmitError("Pick one suggested slot before scheduling the timebox.");
          return;
        }
        setSubmitError(null);
        setSubmitting(true);
        try {
          const suggestedPayload = {
            title: selectedSuggestion.title,
            startsAt: selectedSuggestion.startsAt,
            endsAt: selectedSuggestion.endsAt,
            activityPresetKey: draft.activityPresetKey,
            customSustainRateApPerHour: draft.customSustainRateApPerHour
          };
          if (editingTimebox && onUpdateTimebox) {
            await onUpdateTimebox(editingTimebox.id, suggestedPayload);
          } else {
            await onCreateTimebox({
              taskId: selectedTask.id,
              projectId: selectedTask.projectId,
              ...suggestedPayload,
              source: selectedSuggestion.source
            });
          }
          onOpenChange(false);
        } catch (error) {
          setSubmitError(
            error instanceof Error
              ? error.message
              : "Forge could not create the selected timebox."
          );
        } finally {
          setSubmitting(false);
        }
      }}
    />
  );
}
