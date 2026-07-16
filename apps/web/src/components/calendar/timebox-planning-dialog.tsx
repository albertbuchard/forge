import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCcw } from "lucide-react";
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
import {
  estimateCalendarEventActionPointLoad,
  estimateTaskTimeboxActionPointLoad,
  estimateWorkBlockActionPointLoad,
  formatLifeForceAp,
  formatLifeForceRate,
  getCalendarActivityCustomRate,
  getCalendarActivityPresetKey,
  getCalendarActivityPresetOptions
} from "@/lib/life-force-display";
import {
  formatDateInTimeZone,
  formatDateTimeInputInTimeZone,
  formatTimeInTimeZone,
  localDateKeyInTimeZone,
  parseDateTimeInputInTimeZone,
  resolveDateTimeInputInTimeZone
} from "@/lib/timezone-datetime";
import type {
  CalendarEvent,
  Task,
  TaskTimebox,
  WorkBlockInstance
} from "@/lib/types";

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

export function getPlanningRangeDateKeys(
  from: string,
  to: string,
  timeZone: string
) {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    throw new Error(
      "Planning ranges require an exclusive end after the start."
    );
  }
  return {
    minDateKey: localDateKeyInTimeZone(
      new Date(fromMs).toISOString(),
      timeZone
    ),
    maxDateKey: localDateKeyInTimeZone(
      new Date(toMs - 1).toISOString(),
      timeZone
    )
  };
}

function toDayStartIso(dateKey: string, timeZone: string) {
  return parseDateTimeInputInTimeZone(`${dateKey}T00:00`, timeZone);
}

function toDayEndIso(dateKey: string, timeZone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return parseDateTimeInputInTimeZone(
    `${next.toISOString().slice(0, 10)}T00:00`,
    timeZone
  );
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

function getPreferredPlanningDateKey(
  from: string,
  to: string,
  timeZone: string
) {
  const { minDateKey, maxDateKey } = getPlanningRangeDateKeys(
    from,
    to,
    timeZone
  );
  const candidate = new Date(`${minDateKey}T00:00:00.000Z`);
  candidate.setUTCDate(candidate.getUTCDate() + 1);
  return clampDateKey(
    candidate.toISOString().slice(0, 10),
    minDateKey,
    maxDateKey
  );
}

function toTimeInputValue(value: string, timeZone: string) {
  return formatDateTimeInputInTimeZone(value, timeZone).slice(11, 16);
}

function parseDateAndTime(
  dateKey: string,
  timeValue: string,
  timeZone: string,
  preferredInstant?: string | null
) {
  if (!dateKey || !timeValue) {
    return null;
  }
  const instant = parseDateTimeInputInTimeZone(
    `${dateKey}T${timeValue}`,
    timeZone,
    { disambiguation: "reject", preferredInstant }
  );
  return instant ? new Date(instant) : null;
}

function buildManualWindow(
  dateKey: string,
  durationSeconds?: number | null,
  seed?: { startsAt: string; endsAt: string } | null,
  timeZone = "UTC"
) {
  if (seed) {
    return {
      startTime: toTimeInputValue(seed.startsAt, timeZone),
      endTime: toTimeInputValue(seed.endsAt, timeZone)
    };
  }
  const boundedDurationSeconds = Math.max(
    30 * 60,
    Math.min(durationSeconds ?? 60 * 60, 6 * 60 * 60)
  );
  const start = parseDateTimeInputInTimeZone(`${dateKey}T09:00`, timeZone);
  const end = start
    ? new Date(Date.parse(start) + boundedDurationSeconds * 1000).toISOString()
    : null;
  return {
    startTime: "09:00",
    endTime: end ? toTimeInputValue(end, timeZone) : "10:00"
  };
}

function formatClockRange(
  startAt: string,
  endAt: string,
  timeZone?: string | null
) {
  return `${formatTimeInTimeZone(startAt, timeZone)} - ${formatTimeInTimeZone(endAt, timeZone)}`;
}

function formatContextTime(
  startAt: string,
  endAt: string,
  timeZone?: string | null
) {
  return `${formatDateInTimeZone(startAt, timeZone)} · ${formatClockRange(startAt, endAt, timeZone)}`;
}

const PANEL_CLASS =
  "rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)]";
const INNER_CARD_CLASS =
  "rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]";
const SOFT_BADGE_CLASS = "bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)]";
const SELECT_CLASS =
  "rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 text-[15px] text-[var(--ui-ink-strong)] outline-none transition focus:border-[var(--ui-border-strong)] focus:ring-2 focus:ring-[var(--primary)]/20";

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
    <div className={`${PANEL_CLASS} p-4`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium text-[var(--ui-ink-strong)]">{title}</div>
          <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
            {subtitle}
          </div>
        </div>
        <Badge className={SOFT_BADGE_CLASS}>{items.length}</Badge>
      </div>
      <div className="mt-3 grid gap-2">
        {items.length > 0 ? (
          items
        ) : (
          <div className="rounded-[18px] border border-dashed border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-3 text-sm text-[var(--ui-ink-muted)]">
            {emptyLabel}
          </div>
        )}
      </div>
    </div>
  );
}

function CalendarEventCard({ event }: { event: CalendarEvent }) {
  return (
    <div className={`${INNER_CARD_CLASS} px-3 py-3`}>
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-[var(--ui-ink-strong)]">
          {event.title}
        </div>
        <Badge className={SOFT_BADGE_CLASS}>{event.availability}</Badge>
      </div>
      <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
        {formatContextTime(event.startAt, event.endAt, event.timezone)}
      </div>
    </div>
  );
}

function WorkBlockCard({
  block,
  timeZone
}: {
  block: WorkBlockInstance;
  timeZone: string;
}) {
  return (
    <div className={`${INNER_CARD_CLASS} px-3 py-3`}>
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-[var(--ui-ink-strong)]">
          {block.title}
        </div>
        <Badge className={SOFT_BADGE_CLASS}>{block.blockingState}</Badge>
      </div>
      <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
        {formatContextTime(block.startAt, block.endAt, timeZone)}
      </div>
    </div>
  );
}

function TimeboxCard({
  timebox,
  timeZone
}: {
  timebox: TaskTimebox;
  timeZone: string;
}) {
  const actionPointLoad = estimateTaskTimeboxActionPointLoad(timebox);
  return (
    <div className={`${INNER_CARD_CLASS} px-3 py-3`}>
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-[var(--ui-ink-strong)]">
          {timebox.title}
        </div>
        <Badge className={SOFT_BADGE_CLASS}>{timebox.source}</Badge>
      </div>
      <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
        {formatContextTime(timebox.startsAt, timebox.endsAt, timeZone)}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Badge className={SOFT_BADGE_CLASS}>
          {formatLifeForceRate(actionPointLoad.rateApPerHour)}
        </Badge>
        <Badge className={SOFT_BADGE_CLASS}>
          {formatLifeForceAp(actionPointLoad.totalAp)}
        </Badge>
      </div>
    </div>
  );
}

function taskMatchesUserScope(task: Task, userIds?: string[]) {
  if (!userIds || userIds.length === 0) {
    return true;
  }
  const allowed = new Set(userIds);
  return (
    (typeof task.ownerUserId === "string" && allowed.has(task.ownerUserId)) ||
    (typeof task.userId === "string" && allowed.has(task.userId)) ||
    (Array.isArray(task.assigneeUserIds) &&
      task.assigneeUserIds.some((userId) => allowed.has(userId)))
  );
}

function overlapsWindow(
  candidate: { startsAt: string; endsAt: string },
  startsAt: string,
  endsAt: string
) {
  return (
    Date.parse(candidate.startsAt) < Date.parse(endsAt) &&
    Date.parse(candidate.endsAt) > Date.parse(startsAt)
  );
}

function findManualPlacementConflicts(input: {
  startsAt: string | null;
  endsAt: string | null;
  events: CalendarEvent[];
  blocks: WorkBlockInstance[];
  timeboxes: TaskTimebox[];
  editingTimeboxId?: string | null;
}) {
  if (!input.startsAt || !input.endsAt) {
    return [];
  }
  return [
    ...input.events
      .filter(
        (event) =>
          event.status !== "cancelled" &&
          event.availability === "busy" &&
          overlapsWindow(
            { startsAt: event.startAt, endsAt: event.endAt },
            input.startsAt!,
            input.endsAt!
          )
      )
      .map((event) => ({ id: event.id, title: event.title, kind: "event" })),
    ...input.blocks
      .filter(
        (block) =>
          block.blockingState === "blocked" &&
          overlapsWindow(
            { startsAt: block.startAt, endsAt: block.endAt },
            input.startsAt!,
            input.endsAt!
          )
      )
      .map((block) => ({
        id: block.id,
        title: block.title,
        kind: "work block"
      })),
    ...input.timeboxes
      .filter(
        (timebox) =>
          timebox.id !== input.editingTimeboxId &&
          timebox.status !== "cancelled" &&
          overlapsWindow(timebox, input.startsAt!, input.endsAt!)
      )
      .map((timebox) => ({
        id: timebox.id,
        title: timebox.title,
        kind: "timebox"
      }))
  ];
}

export function TimeboxPlanningDialog({
  open,
  onOpenChange,
  tasks,
  from,
  to,
  onCreateTimebox,
  onUpdateTimebox,
  onDeleteTimebox,
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
  onDeleteTimebox?: (timeboxId: string) => Promise<void>;
  initialTaskId?: string;
  lockedTaskId?: string;
  editingTimebox?: TaskTimebox | null;
  userIds?: string[];
}) {
  const isEditing = Boolean(editingTimebox);
  const planningTimeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const availableTasks = useMemo(() => {
    const pinnedTaskId = lockedTaskId ?? editingTimebox?.taskId ?? null;
    const liveTasks = tasks.filter(
      (task) =>
        taskMatchesUserScope(task, userIds) &&
        (task.status !== "done" || task.id === pinnedTaskId)
    );
    if (!pinnedTaskId) {
      return liveTasks;
    }
    const locked = liveTasks.find((task) => task.id === pinnedTaskId);
    return locked ? [locked] : [];
  }, [editingTimebox?.taskId, lockedTaskId, tasks, userIds]);

  const { minDateKey, maxDateKey } = getPlanningRangeDateKeys(
    from,
    to,
    planningTimeZone
  );
  const defaultDateKey = editingTimebox
    ? clampDateKey(
        localDateKeyInTimeZone(editingTimebox.startsAt, planningTimeZone),
        minDateKey,
        maxDateKey
      )
    : getPreferredPlanningDateKey(from, to, planningTimeZone);
  const defaultTaskId =
    lockedTaskId ??
    editingTimebox?.taskId ??
    initialTaskId ??
    availableTasks[0]?.id ??
    "";
  const defaultTask =
    availableTasks.find((task) => task.id === defaultTaskId) ??
    availableTasks[0] ??
    null;
  const defaultManualWindow = buildManualWindow(
    defaultDateKey,
    defaultTask?.plannedDurationSeconds,
    editingTimebox
      ? {
          startsAt: editingTimebox.startsAt,
          endsAt: editingTimebox.endsAt
        }
      : null,
    planningTimeZone
  );

  const [draft, setDraft] = useState<PlannerDraft>({
    taskId: defaultTaskId,
    preferredDate: defaultDateKey,
    plannerMode: editingTimebox ? "manual" : "suggested",
    selectedTimeboxId: "",
    activityPresetKey:
      getCalendarActivityPresetKey(editingTimebox?.actionProfile) ??
      "task_inherited",
    customSustainRateApPerHour: getCalendarActivityCustomRate(
      editingTimebox?.actionProfile
    ),
    manualStartTime: defaultManualWindow.startTime,
    manualEndTime: defaultManualWindow.endTime,
    manualTitle: editingTimebox?.title ?? defaultTask?.title ?? "",
    overrideReason: editingTimebox?.overrideReason ?? ""
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    const nextTaskId =
      lockedTaskId ?? initialTaskId ?? availableTasks[0]?.id ?? "";
    const resolvedTaskId = editingTimebox?.taskId ?? nextTaskId;
    const nextTask =
      availableTasks.find((task) => task.id === resolvedTaskId) ??
      availableTasks[0] ??
      null;
    const nextDateKey = editingTimebox
      ? clampDateKey(
          localDateKeyInTimeZone(editingTimebox.startsAt, planningTimeZone),
          minDateKey,
          maxDateKey
        )
      : getPreferredPlanningDateKey(from, to, planningTimeZone);
    const nextManualWindow = buildManualWindow(
      nextDateKey,
      nextTask?.plannedDurationSeconds,
      editingTimebox
        ? {
            startsAt: editingTimebox.startsAt,
            endsAt: editingTimebox.endsAt
          }
        : null,
      planningTimeZone
    );
    setSubmitError(null);
    setDraft({
      taskId: resolvedTaskId,
      preferredDate: nextDateKey,
      plannerMode: editingTimebox ? "manual" : "suggested",
      selectedTimeboxId: "",
      activityPresetKey:
        getCalendarActivityPresetKey(editingTimebox?.actionProfile) ??
        "task_inherited",
      customSustainRateApPerHour: getCalendarActivityCustomRate(
        editingTimebox?.actionProfile
      ),
      manualStartTime: nextManualWindow.startTime,
      manualEndTime: nextManualWindow.endTime,
      manualTitle: editingTimebox?.title ?? nextTask?.title ?? "",
      overrideReason: editingTimebox?.overrideReason ?? ""
    });
  }, [
    availableTasks,
    editingTimebox,
    from,
    initialTaskId,
    lockedTaskId,
    maxDateKey,
    minDateKey,
    open,
    planningTimeZone,
    to
  ]);

  const selectedTask =
    availableTasks.find((task) => task.id === draft.taskId) ?? null;

  const selectedDayWindow = useMemo(
    () => ({
      from:
        toDayStartIso(draft.preferredDate, planningTimeZone) ??
        `${draft.preferredDate}T00:00:00.000Z`,
      to:
        toDayEndIso(draft.preferredDate, planningTimeZone) ??
        `${draft.preferredDate}T23:59:59.999Z`
    }),
    [draft.preferredDate, planningTimeZone]
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
        limit: 8,
        timezone: planningTimeZone
      }),
    enabled: open && draft.taskId.length > 0,
    retry: 1,
    staleTime: 30_000
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
    enabled: open,
    retry: 1,
    staleTime: 30_000
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    const suggestions = suggestionQuery.data?.timeboxes ?? [];
    if (!suggestions.length) {
      setDraft((current) =>
        current.selectedTimeboxId
          ? { ...current, selectedTimeboxId: "" }
          : current
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
  const manualStart = parseDateAndTime(
    draft.preferredDate,
    draft.manualStartTime,
    planningTimeZone,
    editingTimebox?.startsAt
  );
  const manualEnd = parseDateAndTime(
    draft.preferredDate,
    draft.manualEndTime,
    planningTimeZone,
    editingTimebox?.endsAt
  );
  const manualStartResolution = resolveDateTimeInputInTimeZone(
    `${draft.preferredDate}T${draft.manualStartTime}`,
    planningTimeZone
  );
  const manualEndResolution = resolveDateTimeInputInTimeZone(
    `${draft.preferredDate}T${draft.manualEndTime}`,
    planningTimeZone
  );
  const manualTimeResolutionError = [
    manualStartResolution,
    manualEndResolution
  ].some((resolution) => resolution.kind === "nonexistent")
    ? "That local time does not exist because the clock changes on this day. Choose another time."
    : [manualStartResolution, manualEndResolution].some(
          (resolution) => resolution.kind === "ambiguous"
        ) && !editingTimebox
      ? "That local time occurs twice because the clock changes on this day. Choose an unambiguous time."
      : null;
  const manualConflicts = findManualPlacementConflicts({
    startsAt: manualStart?.toISOString() ?? null,
    endsAt: manualEnd?.toISOString() ?? null,
    events: dayEvents,
    blocks: dayBlocks,
    timeboxes: dayTimeboxes,
    editingTimeboxId: editingTimebox?.id
  });
  const selectedDayPressureAp = [
    ...dayEvents.map(
      (event) => estimateCalendarEventActionPointLoad(event).totalAp
    ),
    ...dayBlocks.map(
      (block) => estimateWorkBlockActionPointLoad(block).totalAp
    ),
    ...dayTimeboxes.map(
      (timebox) => estimateTaskTimeboxActionPointLoad(timebox).totalAp
    )
  ].reduce((total, value) => total + value, 0);
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
                  title:
                    draft.manualTitle ||
                    selectedTask?.title ||
                    "Manual timebox",
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

  const steps: Array<QuestionFlowStep<PlannerDraft>> = [
    {
      id: "task",
      eyebrow: "Planning",
      title: taskStepTitle,
      description: taskStepDescription,
      render: (value, setValue) => (
        <div className="grid min-w-0 max-w-full gap-4 overflow-hidden">
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
                      nextTask?.plannedDurationSeconds,
                      null,
                      planningTimeZone
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
                className={SELECT_CLASS}
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
            <div className="min-w-0 max-w-full overflow-hidden rounded-[28px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-5 shadow-[var(--ui-shadow-soft)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                    Time Box
                  </div>
                  <div className="mt-2 break-words font-display text-[1.4rem] leading-tight text-[var(--ui-ink-strong)]">
                    {selectedTask.title}
                  </div>
                </div>
                <Badge className={SOFT_BADGE_CLASS}>
                  {selectedTask.status}
                </Badge>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge className={SOFT_BADGE_CLASS}>
                  {selectedTask.plannedDurationSeconds
                    ? `${Math.round(selectedTask.plannedDurationSeconds / 60)} min target`
                    : "No duration yet"}
                </Badge>
                <Badge className={SOFT_BADGE_CLASS}>
                  {selectedTask.schedulingRules
                    ? "Task-specific rules"
                    : "Uses project rules"}
                </Badge>
                <Badge className={SOFT_BADGE_CLASS}>
                  {selectedTask.points} xp
                </Badge>
                {selectedTask.plannedDurationSeconds ? (
                  <Badge className={SOFT_BADGE_CLASS}>
                    {formatLifeForceAp(
                      (selectedTask.plannedDurationSeconds / 3600 / 24) * 100
                    )}{" "}
                    target load
                  </Badge>
                ) : null}
              </div>
              <p className="mt-4 text-sm leading-6 text-[var(--ui-ink-soft)]">
                Pick a day first, then either accept one of Forge&apos;s
                suggested slots or set the block manually.
              </p>
              {isEditing && editingTimebox && onDeleteTimebox ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-[color-mix(in_srgb,var(--danger)_24%,var(--ui-border-subtle)_76%)] bg-[var(--ui-danger-soft)] px-4 py-3">
                  <div className="text-sm leading-6 text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]">
                    Remove this planned timebox if you no longer want it in the
                    calendar.
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)] hover:bg-[var(--ui-danger-soft)]"
                    pending={deleting}
                    pendingLabel="Deleting"
                    onClick={() =>
                      void (async () => {
                        setSubmitError(null);
                        setDeleting(true);
                        try {
                          await onDeleteTimebox(editingTimebox.id);
                          onOpenChange(false);
                        } catch (error) {
                          setSubmitError(
                            error instanceof Error
                              ? error.message
                              : "Forge could not delete this timebox."
                          );
                        } finally {
                          setDeleting(false);
                        }
                      })()
                    }
                  >
                    Delete timebox
                  </Button>
                </div>
              ) : null}
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
                  onChange={(event) =>
                    setValue({
                      preferredDate: event.target.value,
                      selectedTimeboxId: ""
                    })
                  }
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
                      description:
                        "Forge proposes slots that fit the task rules and the selected day."
                    },
                    {
                      value: "manual",
                      label: "Set it manually",
                      description:
                        "You choose the exact start and end time yourself."
                    }
                  ]}
                />
              </FlowField>
            </div>
            <div className="rounded-[28px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
                    Selected day
                  </div>
                  <div className="mt-2 font-display text-[1.3rem] leading-tight text-[var(--ui-ink-strong)]">
                    {value.preferredDate
                      ? new Date(
                          `${value.preferredDate}T12:00:00`
                        ).toLocaleDateString([], {
                          weekday: "long",
                          month: "long",
                          day: "numeric"
                        })
                      : "Choose a day"}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge className={SOFT_BADGE_CLASS}>
                    {dayEvents.length} events
                  </Badge>
                  <Badge className={SOFT_BADGE_CLASS}>
                    {dayBlocks.length} work blocks
                  </Badge>
                  <Badge className={SOFT_BADGE_CLASS}>
                    {dayTimeboxes.length} timeboxes
                  </Badge>
                  <Badge className={SOFT_BADGE_CLASS}>
                    {formatLifeForceAp(selectedDayPressureAp)} pressure
                  </Badge>
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
                This is the context Forge will use while recommending a slot.
                You can still place the block manually if you want something
                more exact.
              </p>
              {calendarDayQuery.isLoading ? (
                <div className="mt-4 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-4 text-sm text-[var(--ui-ink-soft)]">
                  Loading the selected day…
                </div>
              ) : calendarDayQuery.isError ? (
                <div
                  className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-[color-mix(in_srgb,var(--danger)_24%,var(--ui-border-subtle)_76%)] bg-[var(--ui-danger-soft)] px-4 py-4 text-sm text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]"
                  role="alert"
                >
                  <span>
                    Forge could not load this day. No placement will be saved
                    until the calendar context is available.
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void calendarDayQuery.refetch()}
                  >
                    <RefreshCcw className="size-3.5" />
                    Retry day
                  </Button>
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
                      <WorkBlockCard
                        key={block.id}
                        block={block}
                        timeZone={planningTimeZone}
                      />
                    ))}
                  </CalendarContextColumn>
                  <CalendarContextColumn
                    title="Planned timeboxes"
                    subtitle="Existing owned work already placed there."
                    emptyLabel="No other planned timeboxes yet."
                  >
                    {dayTimeboxes.slice(0, 4).map((timebox) => (
                      <TimeboxCard
                        key={timebox.id}
                        timebox={timebox}
                        timeZone={planningTimeZone}
                      />
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
                    onChange={(event) =>
                      setValue({ preferredDate: event.target.value })
                    }
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
                  error={manualTimeResolutionError}
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
              {manualConflicts.length > 0 ? (
                <div
                  className="rounded-[20px] border border-[color-mix(in_srgb,var(--warning)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-warning-soft)] px-4 py-4 text-sm text-[var(--ui-ink-strong)]"
                  role="status"
                  aria-live="polite"
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
                    <div className="min-w-0">
                      <div className="font-medium">
                        This placement overlaps {manualConflicts.length} item
                        {manualConflicts.length === 1 ? "" : "s"}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {manualConflicts.slice(0, 5).map((conflict) => (
                          <Badge
                            key={`${conflict.kind}:${conflict.id}`}
                            className={SOFT_BADGE_CLASS}
                          >
                            {conflict.title} · {conflict.kind}
                          </Badge>
                        ))}
                      </div>
                      <p className="mt-2 leading-6 text-[var(--ui-ink-soft)]">
                        Choose another time or state why this overlap is
                        intentional. Forge will verify the full task rules again
                        before saving.
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
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
                description={
                  manualConflicts.length > 0
                    ? "Required for this overlapping placement. State the concrete reason it is still valid."
                    : "Optional. Add a short reason only when you are intentionally overriding the normal rules or calendar shape."
                }
                error={
                  manualConflicts.length > 0 &&
                  value.overrideReason.trim().length === 0
                    ? "Add an override reason or choose a non-overlapping time."
                    : null
                }
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
                    className={SELECT_CLASS}
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
              <div className={`${PANEL_CLASS} p-4`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-[var(--ui-ink-strong)]">
                      {value.manualTitle ||
                        selectedTask?.title ||
                        "Manual timebox"}
                    </div>
                    <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
                      {manualStart && manualEnd
                        ? `${formatDateInTimeZone(
                            manualStart.toISOString(),
                            planningTimeZone
                          )} · ${formatClockRange(
                            manualStart.toISOString(),
                            manualEnd.toISOString(),
                            planningTimeZone
                          )}`
                        : "Choose a start and end time."}
                    </div>
                  </div>
                  <Badge className={SOFT_BADGE_CLASS}>manual</Badge>
                </div>
                {manualPreview ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge className={SOFT_BADGE_CLASS}>
                      {formatLifeForceRate(manualPreview.rateApPerHour)}
                    </Badge>
                    <Badge className={SOFT_BADGE_CLASS}>
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
          return (
            <div className="text-sm text-[var(--ui-ink-soft)]">
              Looking for valid slots on the selected day…
            </div>
          );
        }
        if (suggestionQuery.isError) {
          return (
            <div className="grid gap-3" role="alert">
              <div className="rounded-[24px] border border-[color-mix(in_srgb,var(--danger)_24%,var(--ui-border-subtle)_76%)] bg-[var(--ui-danger-soft)] px-4 py-4 text-sm leading-6 text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]">
                Forge could not calculate suggestions. The task and calendar are
                unchanged.
              </div>
              <Button
                variant="secondary"
                onClick={() => void suggestionQuery.refetch()}
              >
                <RefreshCcw className="size-4" />
                Retry suggestions
              </Button>
            </div>
          );
        }
        if (!suggestions.length) {
          return (
            <div className="grid gap-3">
              <div className="rounded-[24px] border border-[color-mix(in_srgb,var(--warning)_24%,var(--ui-border-subtle)_76%)] bg-[var(--ui-warning-soft)] px-4 py-4 text-sm leading-6 text-[color-mix(in_srgb,var(--warning)_72%,var(--ui-ink-strong)_28%)]">
                Forge could not find a valid slot on this day. Try another day,
                adjust the task rules, or switch to manual placement if you
                already know the right block.
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => void suggestionQuery.refetch()}
                >
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
                <div
                  key={timebox.id}
                  className={`rounded-[24px] border px-4 py-4 transition ${
                    active
                      ? "border-[color-mix(in_srgb,var(--primary)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)] shadow-[var(--ui-shadow-soft)]"
                      : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)] hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]"
                  }`}
                >
                  <button
                    type="button"
                    aria-pressed={active}
                    aria-label={`${active ? "Selected" : "Select"} ${timebox.title}, ${formatContextTime(timebox.startsAt, timebox.endsAt, planningTimeZone)}`}
                    onClick={() => setValue({ selectedTimeboxId: timebox.id })}
                    className="block w-full rounded-[18px] text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ui-surface-2)]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="font-medium">{timebox.title}</div>
                      <Badge className={SOFT_BADGE_CLASS}>
                        {timebox.source}
                      </Badge>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                      {formatContextTime(
                        timebox.startsAt,
                        timebox.endsAt,
                        planningTimeZone
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge className={SOFT_BADGE_CLASS}>
                        {formatLifeForceRate(actionPointLoad.rateApPerHour)}
                      </Badge>
                      <Badge className={SOFT_BADGE_CLASS}>
                        {formatLifeForceAp(actionPointLoad.totalAp)}
                      </Badge>
                    </div>
                  </button>
                  {active ? (
                    <div
                      className="mt-4 grid gap-4 border-t border-[var(--ui-border-subtle)] pt-4 md:grid-cols-2"
                      aria-label={`Action Point profile for ${timebox.title}`}
                    >
                      <FlowField label="Activity profile">
                        <select
                          value={value.activityPresetKey ?? "task_inherited"}
                          onChange={(event) =>
                            setValue({
                              activityPresetKey: event.target.value
                            })
                          }
                          className={SELECT_CLASS}
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
                </div>
              );
            })}
          </div>
        );
      }
    }
  ];

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
      draftPersistenceKey={
        editingTimebox
          ? `calendar.timebox.${editingTimebox.id}`
          : `calendar.timebox.new.${selectedTask?.id ?? "unscoped"}`
      }
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
          if (calendarDayQuery.isError) {
            setSubmitError(
              "Reload the selected day before placing a manual timebox."
            );
            return;
          }
          if (manualTimeResolutionError) {
            setSubmitError(manualTimeResolutionError);
            return;
          }
          if (!manualStart || !manualEnd) {
            setSubmitError("Choose a valid manual start and end time.");
            return;
          }
          if (manualEnd <= manualStart) {
            setSubmitError(
              "The manual timebox needs an end time after the start time."
            );
            return;
          }
          if (
            manualConflicts.length > 0 &&
            draft.overrideReason.trim().length === 0
          ) {
            setSubmitError(
              "This placement overlaps existing calendar pressure. Add a specific override reason or choose another time."
            );
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
          setSubmitError(
            "Pick one suggested slot before scheduling the timebox."
          );
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
