import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckCheck,
  CircleAlert,
  CircleX,
  Pencil,
  Frown,
  Meh,
  PartyPopper,
  ShieldBan,
  Smile,
  Sparkles,
  TriangleAlert,
  X,
  Trash2
} from "lucide-react";
import { EntityNoteCountLink } from "@/components/notes/entity-note-count-link";
import { NoteMarkdown } from "@/components/notes/note-markdown";
import { GamificationMiniHud } from "@/components/gamification/gamification-widgets";
import {
  psycheFocusClass,
  usePsycheFocusTarget
} from "@/components/psyche/use-psyche-focus-target";
import { PageHero } from "@/components/shell/page-hero";
import { HabitDialog } from "@/components/habit-dialog";
import { PlanningRecordDeleteDialog } from "@/components/planning/planning-record-delete-dialog";
import { useForgeShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/page-state";
import { EntityName } from "@/components/ui/entity-name";
import { SelectMenu, type SelectMenuOption } from "@/components/ui/select-menu";
import { Textarea } from "@/components/ui/textarea";
import { UserBadge } from "@/components/ui/user-badge";
import {
  createHabit,
  createHabitCheckIn,
  deleteHabitCheckIn,
  deleteHabit,
  getLifeForce,
  getPsycheOverview,
  listHabits,
  patchHabit
} from "@/lib/api";
import {
  estimateHabitCheckInActionPointLoad,
  estimateHabitGeneratedWorkoutActionPointLoad,
  formatLifeForceAp,
  formatLifeForceRate
} from "@/lib/life-force-display";
import type { HabitMutationInput } from "@/lib/schemas";
import type { Habit } from "@/lib/types";
import { ForgeApiError } from "@/lib/api-error";
import { getRuntimeTimeZone } from "@/lib/date-keys";
import { getEntityNotesSummary } from "@/lib/note-helpers";
import {
  coerceSelectedUserIds,
  getSingleSelectedUserId
} from "@/lib/user-ownership";
import { cn } from "@/lib/utils";
import { useSearchParams } from "react-router-dom";

const WEEKDAY_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat"
] as const;

const DAILY_HISTORY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;
type HabitOrderBy =
  | "needs_attention"
  | "name"
  | "streak"
  | "created_at"
  | "updated_at";

const HABIT_ORDER_OPTIONS: SelectMenuOption<HabitOrderBy>[] = [
  {
    value: "name",
    label: "Name A-Z",
    description: "Keep the list stable alphabetically."
  },
  {
    value: "needs_attention",
    label: "Needs attention",
    description: "Bubble up habits still waiting on today."
  },
  {
    value: "streak",
    label: "Longest streak",
    description: "Put the strongest current streaks first."
  },
  {
    value: "created_at",
    label: "Newest created",
    description: "Show the most recently created habits first."
  },
  {
    value: "updated_at",
    label: "Recently updated",
    description: "Sort by the most recently changed habits."
  }
];

function formatHabitCadence(habit: Habit) {
  if (habit.frequency === "daily") {
    return `${habit.targetCount}x daily`;
  }
  return `${habit.targetCount}x weekly · ${habit.weekDays.map((day) => WEEKDAY_LABELS[day]).join(", ")}`;
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfLocalWeek(date: Date) {
  const start = startOfLocalDay(date);
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);
  return start;
}

function formatUtcShortDate(value: Date | string) {
  const date = typeof value === "string" ? parseDateKey(value) : value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
  }).format(date);
}

function isAlignedCheckIn(
  habit: Habit,
  status: Habit["checkIns"][number]["status"]
) {
  return (
    (habit.polarity === "positive" && status === "done") ||
    (habit.polarity === "negative" && status === "missed")
  );
}

function getCheckInLabel(
  habit: Habit,
  status: Habit["checkIns"][number]["status"]
) {
  if (habit.polarity === "positive") {
    return status === "done" ? "Done" : "Missed";
  }
  return status === "done" ? "Performed" : "Resisted";
}

function getHabitVisualState(habit: Habit) {
  const todayKey = habit.currentDateKey;
  const todayCheckIn =
    habit.checkIns.find((checkIn) => checkIn.dateKey === todayKey) ?? null;

  if (habit.dueToday) {
    return {
      tone: "pending" as const,
      label:
        habit.frequency === "daily"
          ? "Waiting for today"
          : "Awaiting this week's check-in",
      cardClass:
        "border-[color-mix(in_srgb,var(--warning)_28%,var(--ui-border-subtle)_72%)] shadow-[var(--ui-shadow-soft)]",
      overlayClass:
        "bg-[radial-gradient(circle_at_top_right,color-mix(in_srgb,var(--warning)_18%,transparent),transparent_44%)]",
      pillClass:
        "border border-[color-mix(in_srgb,var(--warning)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]"
    };
  }

  if (todayCheckIn) {
    const aligned = isAlignedCheckIn(habit, todayCheckIn.status);
    return aligned
      ? {
          tone: "aligned" as const,
          label: `${getCheckInLabel(habit, todayCheckIn.status)} today`,
          cardClass:
            "border-[color-mix(in_srgb,var(--success)_24%,var(--ui-border-subtle)_76%)] shadow-[var(--ui-shadow-soft)]",
          overlayClass:
            "bg-[radial-gradient(circle_at_top_right,color-mix(in_srgb,var(--success)_16%,transparent),transparent_44%)]",
          pillClass:
            "border border-[color-mix(in_srgb,var(--success)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)]"
        }
      : {
          tone: "unaligned" as const,
          label: `${getCheckInLabel(habit, todayCheckIn.status)} today`,
          cardClass:
            "border-[color-mix(in_srgb,var(--danger)_24%,var(--ui-border-subtle)_76%)] shadow-[var(--ui-shadow-soft)]",
          overlayClass:
            "bg-[radial-gradient(circle_at_top_right,color-mix(in_srgb,var(--danger)_16%,transparent),transparent_44%)]",
          pillClass:
            "border border-[color-mix(in_srgb,var(--danger)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-danger-soft)] text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]"
        };
  }

  return habit.polarity === "positive"
    ? {
        tone: "neutral" as const,
        label: "No update due right now",
        cardClass: "",
        overlayClass:
          "bg-[radial-gradient(circle_at_top_right,color-mix(in_srgb,var(--success)_9%,transparent),transparent_40%)]",
        pillClass:
          "border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]"
      }
    : {
        tone: "neutral" as const,
        label: "No update due right now",
        cardClass: "",
        overlayClass:
          "bg-[radial-gradient(circle_at_top_right,color-mix(in_srgb,var(--danger)_9%,transparent),transparent_40%)]",
        pillClass:
          "border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]"
      };
}

function getStreakPresentation(streak: number) {
  if (streak >= 10) {
    return {
      Icon: PartyPopper,
      className:
        "border border-[color-mix(in_srgb,var(--warning)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)] shadow-[var(--ui-shadow-soft)]",
      iconClass:
        "text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]",
      valueClass: "text-[var(--ui-ink-strong)]",
      label: "Celebration pace"
    };
  }
  if (streak >= 5) {
    return {
      Icon: Smile,
      className:
        "border border-[color-mix(in_srgb,var(--success)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)] shadow-[var(--ui-shadow-soft)]",
      iconClass:
        "text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)]",
      valueClass: "text-[var(--ui-ink-strong)]",
      label: "Locked in"
    };
  }
  if (streak >= 1) {
    return {
      Icon: Meh,
      className:
        "border border-[color-mix(in_srgb,var(--info)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_76%,var(--ui-ink-strong)_24%)] shadow-[var(--ui-shadow-soft)]",
      iconClass:
        "text-[color-mix(in_srgb,var(--info)_76%,var(--ui-ink-strong)_24%)]",
      valueClass: "text-[var(--ui-ink-strong)]",
      label: "Building rhythm"
    };
  }
  return {
    Icon: Frown,
    className:
      "border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)] shadow-[var(--ui-shadow-soft)]",
    iconClass: "text-[var(--ui-ink-soft)]",
    valueClass: "text-[var(--ui-ink-strong)]",
    label: "Cold start"
  };
}

function getAlignmentBadgeClass(completionRate: number) {
  if (completionRate >= 80) {
    return "border-[color-mix(in_srgb,var(--success)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)]";
  }
  if (completionRate >= 50) {
    return "border-[color-mix(in_srgb,var(--warning)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]";
  }
  return "border-[color-mix(in_srgb,var(--danger)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-danger-soft)] text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]";
}

const habitNeutralBadgeClass =
  "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]";
const habitSuccessBadgeClass =
  "border-[color-mix(in_srgb,var(--success)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)]";
const habitDangerBadgeClass =
  "border-[color-mix(in_srgb,var(--danger)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-danger-soft)] text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]";
const habitWarningBadgeClass =
  "border-[color-mix(in_srgb,var(--warning)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]";
const habitInfoBadgeClass =
  "border-[color-mix(in_srgb,var(--info)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_76%,var(--ui-ink-strong)_24%)]";
const habitAccentBadgeClass =
  "border-[color-mix(in_srgb,var(--primary)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-accent-soft)] text-[color-mix(in_srgb,var(--primary)_72%,var(--ui-ink-strong)_28%)]";

type HabitHistoryCell = {
  id: string;
  label: string;
  title: string;
  state: "aligned" | "unaligned" | "unknown";
  current: boolean;
  actionDateKey: string;
  actionLabel: string;
};

function buildHabitHistory(habit: Habit) {
  const now = parseDateKey(habit.currentDateKey);

  if (habit.frequency === "daily") {
    const today = startOfLocalDay(now);
    const cells: HabitHistoryCell[] = [];

    for (let offset = -6; offset <= 0; offset += 1) {
      const date = addLocalDays(today, offset);
      const dateKey = formatDateKey(date);
      const checkIn =
        habit.checkIns.find((entry) => entry.dateKey === dateKey) ?? null;
      const label = DAILY_HISTORY_LABELS[date.getDay()];
      const current = offset === 0;

      cells.push({
        id: dateKey,
        label,
        current,
        actionDateKey: dateKey,
        actionLabel: formatUtcShortDate(date),
        state: checkIn
          ? isAlignedCheckIn(habit, checkIn.status)
            ? "aligned"
            : "unaligned"
          : "unknown",
        title: `${formatUtcShortDate(date)} · ${checkIn ? getCheckInLabel(habit, checkIn.status) : "Not informed"}`
      });
    }

    return {
      caption: "7-day rhythm",
      rangeLabel: "Past 7 days",
      showLabels: true,
      startLabel: "",
      endLabel: "",
      cells
    };
  }

  const thisWeek = startOfLocalWeek(now);
  const weekBuckets = new Map<string, Habit["checkIns"]>();

  for (const checkIn of habit.checkIns) {
    const weekStart = formatDateKey(
      startOfLocalWeek(parseDateKey(checkIn.dateKey))
    );
    const entries = weekBuckets.get(weekStart) ?? [];
    entries.push(checkIn);
    weekBuckets.set(weekStart, entries);
  }

  const cells: HabitHistoryCell[] = [];

  for (let offset = -6; offset <= 0; offset += 1) {
    const weekStart = addLocalDays(thisWeek, offset * 7);
    const weekKey = formatDateKey(weekStart);
    const entries = weekBuckets.get(weekKey) ?? [];
    const scheduledWeekDay =
      habit.weekDays.length > 0
        ? [...habit.weekDays].sort((left, right) => left - right)[0]
        : 1;
    const scheduledOffset =
      scheduledWeekDay === 0 ? 6 : scheduledWeekDay - 1;
    const fallbackDateKey = formatDateKey(
      addLocalDays(weekStart, scheduledOffset)
    );
    const targetDateKey = entries[0]?.dateKey ?? fallbackDateKey;
    const alignedCount = entries.filter((entry) =>
      isAlignedCheckIn(habit, entry.status)
    ).length;
    const unalignedCount = entries.length - alignedCount;

    cells.push({
      id: weekKey,
      label: "",
      current: offset === 0,
      actionDateKey: targetDateKey,
      actionLabel: `Week of ${formatUtcShortDate(weekStart)}`,
      state:
        entries.length === 0
          ? "unknown"
          : alignedCount >= habit.targetCount
            ? "aligned"
            : unalignedCount > 0
              ? "unaligned"
              : "unknown",
      title: `${formatUtcShortDate(weekStart)} week · ${entries.length === 0 ? "Not informed" : alignedCount >= habit.targetCount ? "Target met" : unalignedCount > 0 ? "Off track" : `${alignedCount}/${habit.targetCount} aligned`}`
    });
  }

  return {
    caption: "7-week rhythm",
    rangeLabel: "Past 7 weeks",
    showLabels: false,
    startLabel: formatUtcShortDate(addLocalDays(thisWeek, -42)),
    endLabel: "This week",
    cells
  };
}

function getHistoryCellClass(
  state: HabitHistoryCell["state"],
  current: boolean
) {
  return cn(
    "h-8 w-full rounded-[10px] border transition",
    state === "aligned" &&
      "border-[color-mix(in_srgb,var(--success)_30%,var(--ui-border-subtle)_70%)] bg-[color-mix(in_srgb,var(--success)_58%,var(--ui-surface-1)_42%)] shadow-[var(--ui-shadow-soft)]",
    state === "unaligned" &&
      "border-[color-mix(in_srgb,var(--danger)_30%,var(--ui-border-subtle)_70%)] bg-[color-mix(in_srgb,var(--danger)_54%,var(--ui-surface-1)_46%)] shadow-[var(--ui-shadow-soft)]",
    state === "unknown" &&
      "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)]",
    current && "ring-1 ring-[color-mix(in_srgb,var(--primary)_34%,transparent)]"
  );
}

function HabitHistoryStrip({
  habit,
  onSelectCell
}: {
  habit: Habit;
  onSelectCell: (habit: Habit, cell: HabitHistoryCell) => void;
}) {
  const history = buildHabitHistory(habit);
  const visualState = getHabitVisualState(habit);

  return (
    <div className="w-full rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-2.5 shadow-[var(--ui-shadow-soft)]">
      <div className="flex flex-wrap items-center gap-3">
        <div className="shrink-0">
          <div className="font-label text-[10px] uppercase tracking-[0.16em] text-[var(--ui-ink-muted)]">
            {history.caption}
          </div>
          <div className="text-[11px] text-[var(--ui-ink-soft)]">
            {history.rangeLabel}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {history.cells.map((cell) => (
            <button
              key={cell.id}
              type="button"
              className="group flex min-w-0 flex-1 items-center gap-1 rounded-[10px] transition hover:bg-[var(--ui-surface-hover)]"
              onClick={() => onSelectCell(habit, cell)}
              title={`Log check-in for ${cell.actionLabel}`}
              aria-label={`Log check-in for ${cell.actionLabel}`}
            >
              <div
                className={cn(
                  getHistoryCellClass(cell.state, cell.current),
                  "h-6 min-w-0 flex-1 rounded-[8px] transition duration-150 group-hover:-translate-y-0.5 group-hover:shadow-[var(--ui-shadow-soft)]"
                )}
              />
              {history.showLabels ? (
                <span className="hidden text-[9px] uppercase tracking-[0.14em] text-[var(--ui-ink-muted)] transition group-hover:text-[var(--ui-ink-medium)] sm:inline">
                  {cell.label}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium",
            visualState.pillClass
          )}
        >
          {visualState.label}
        </div>
      </div>

      {!history.showLabels ? (
        <div className="mt-1 text-right text-[10px] uppercase tracking-[0.14em] text-[var(--ui-ink-muted)]">
          {history.startLabel} - {history.endLabel}
        </div>
      ) : null}
    </div>
  );
}

type HistoryEditorState = {
  habit: Habit;
  cell: HabitHistoryCell;
};

function getHistoryOptionCopy(habit: Habit) {
  return habit.polarity === "positive"
    ? {
        alignedLabel: "Done",
        alignedDescription: "Log that the intended habit happened.",
        unalignedLabel: "Missed",
        unalignedDescription: "Log that the habit did not happen."
      }
    : {
        alignedLabel: "Resisted",
        alignedDescription: "Log that the unwanted behavior was resisted.",
        unalignedLabel: "Performed",
        unalignedDescription: "Log that the unwanted behavior happened."
      };
}

function getHabitActionStatus(
  habit: Habit,
  outcome: "aligned" | "unaligned"
): Habit["checkIns"][number]["status"] {
  if (habit.polarity === "positive") {
    return outcome === "aligned" ? "done" : "missed";
  }
  return outcome === "aligned" ? "missed" : "done";
}

function getHabitActionTone(
  habit: Habit,
  status: Habit["checkIns"][number]["status"]
) {
  return isAlignedCheckIn(habit, status) ? "aligned" : "unaligned";
}

export function HabitsPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [historyEditor, setHistoryEditor] = useState<HistoryEditorState | null>(
    null
  );
  const [historyStatus, setHistoryStatus] = useState<"done" | "missed" | null>(
    null
  );
  const [historyNote, setHistoryNote] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmingDeleteHabit, setConfirmingDeleteHabit] =
    useState<Habit | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const focusedHabitId = searchParams.get("focus");
  const habitOrderBy =
    (searchParams.get("orderBy") as HabitOrderBy | null) ?? "name";
  const selectedUserIds = coerceSelectedUserIds(shell.selectedUserIds);
  const defaultUserId = getSingleSelectedUserId(selectedUserIds);
  const habitsQueryKey = ["forge-habits", habitOrderBy, ...selectedUserIds];

  usePsycheFocusTarget(focusedHabitId);

  const habitsQuery = useQuery({
    queryKey: habitsQueryKey,
    queryFn: async () =>
      (
        await listHabits({
          userIds: selectedUserIds,
          orderBy: habitOrderBy,
          timezone: getRuntimeTimeZone()
        })
      ).habits
  });
  const psycheOverviewQuery = useQuery({
    queryKey: ["forge-psyche-overview", ...selectedUserIds],
    queryFn: async () => (await getPsycheOverview(selectedUserIds)).overview
  });
  const lifeForceQuery = useQuery({
    queryKey: ["forge-life-force", ...selectedUserIds],
    queryFn: async () => (await getLifeForce(selectedUserIds)).lifeForce
  });

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setEditingHabit(null);
      setDialogOpen(true);
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete("create");
          return next;
        },
        { replace: true }
      );
    }
  }, [searchParams, setSearchParams]);

  const refreshHabits = async () => {
    await queryClient.invalidateQueries({ queryKey: ["forge-habits"] });
    await shell.refresh();
  };

  const saveHabitMutation = useMutation({
    mutationFn: async ({
      input,
      habitId
    }: {
      input: HabitMutationInput;
      habitId?: string;
    }) =>
      habitId
        ? (await patchHabit(habitId, input)).habit
        : (await createHabit(input)).habit,
    onSuccess: async () => {
      setErrorMessage(null);
      await refreshHabits();
    },
    onError: (error) => {
      setErrorMessage(
        error instanceof Error ? error.message : "Habit save failed."
      );
    }
  });

  const checkInMutation = useMutation({
    mutationFn: async ({
      habitId,
      status,
      dateKey,
      note
    }: {
      habitId: string;
      status: "done" | "missed";
      dateKey?: string;
      note?: string;
    }) =>
      createHabitCheckIn(habitId, {
        status,
        dateKey,
        note,
        timezone: getRuntimeTimeZone()
      }),
    onSuccess: async () => {
      setErrorMessage(null);
      await refreshHabits();
    },
    onError: (error) => {
      setErrorMessage(
        error instanceof Error ? error.message : "Habit check-in failed."
      );
    }
  });

  const deleteHabitMutation = useMutation({
    mutationFn: async (habitId: string) => deleteHabit(habitId),
    onMutate: async (habitId) => {
      await queryClient.cancelQueries({ queryKey: habitsQueryKey });
      const previousHabits = queryClient.getQueryData<Habit[]>(habitsQueryKey);
      queryClient.setQueryData<Habit[]>(
        habitsQueryKey,
        (current) => current?.filter((habit) => habit.id !== habitId) ?? []
      );
      return { previousHabits };
    },
    onSuccess: async () => {
      setErrorMessage(null);
      setConfirmingDeleteHabit(null);
      await refreshHabits();
    },
    onError: (error, _habitId, context) => {
      if (context?.previousHabits) {
        queryClient.setQueryData(habitsQueryKey, context.previousHabits);
      }
      setErrorMessage(
        error instanceof Error ? error.message : "Habit delete failed."
      );
    }
  });

  const activeHabits = useMemo(
    () =>
      (habitsQuery.data ?? []).filter((habit) => habit.status !== "archived"),
    [habitsQuery.data]
  );
  const dueHabits = useMemo(
    () => activeHabits.filter((habit) => habit.dueToday),
    [activeHabits]
  );
  const dueHabitsActionPointLoad = useMemo(
    () =>
      dueHabits.reduce((sum, habit) => {
        const checkInLoad = estimateHabitCheckInActionPointLoad(habit).totalAp;
        const workoutLoad =
          estimateHabitGeneratedWorkoutActionPointLoad(habit)?.totalAp ?? 0;
        return sum + checkInLoad + workoutLoad;
      }, 0),
    [dueHabits]
  );
  const generatedWorkoutLoad = useMemo(
    () =>
      activeHabits.reduce((sum, habit) => {
        return (
          sum +
          (estimateHabitGeneratedWorkoutActionPointLoad(habit)?.totalAp ?? 0)
        );
      }, 0),
    [activeHabits]
  );
  const selectedHistoryCheckIn = useMemo(() => {
    if (!historyEditor) {
      return null;
    }
    return (
      historyEditor.habit.checkIns.find(
        (checkIn) => checkIn.dateKey === historyEditor.cell.actionDateKey
      ) ?? null
    );
  }, [historyEditor]);

  useEffect(() => {
    if (!historyEditor) {
      setHistoryStatus(null);
      setHistoryNote("");
      return;
    }

    setHistoryStatus(selectedHistoryCheckIn?.status ?? null);
    setHistoryNote(selectedHistoryCheckIn?.note ?? "");
  }, [historyEditor, selectedHistoryCheckIn]);

  if (habitsQuery.error) {
    throw habitsQuery.error;
  }

  const handleOrderChange = (nextOrderBy: HabitOrderBy) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (nextOrderBy === "name") {
          next.delete("orderBy");
        } else {
          next.set("orderBy", nextOrderBy);
        }
        return next;
      },
      { replace: true }
    );
  };

  const historyCopy = historyEditor
    ? getHistoryOptionCopy(historyEditor.habit)
    : null;
  const canSaveHistory =
    historyStatus === "done" ||
    historyStatus === "missed" ||
    selectedHistoryCheckIn !== null;

  return (
    <div className="grid gap-5">
      <PageHero
        entityKind="habit"
        title={
          <EntityName kind="habit" label="Habits" variant="heading" size="lg" />
        }
        titleText="Habits"
        description="Habits track recurring commitments and recurring slips with explicit daily consequences, linked behaviors, and real XP movement."
        badge={`${activeHabits.length} habits`}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <GamificationMiniHud metrics={shell.snapshot.metrics} />
            <Button
              onClick={() => {
                setEditingHabit(null);
                setDialogOpen(true);
              }}
            >
              <Sparkles className="size-4" />
              New habit
            </Button>
          </div>
        }
      />

      {errorMessage ? (
        <Card className="border-[color-mix(in_srgb,var(--danger)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-danger-soft)] text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <div>{errorMessage}</div>
          </div>
        </Card>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-4">
        <Card className="border-[color-mix(in_srgb,var(--warning)_22%,var(--ui-border-subtle)_78%)] shadow-[var(--ui-shadow-soft)]">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
            Due today
          </div>
          <div className="mt-3 font-display text-4xl text-[var(--primary)]">
            {dueHabits.length}
          </div>
          <div className="mt-2 text-sm text-[var(--ui-ink-soft)]">
            Habits that still need a check-in today.
          </div>
        </Card>
        <Card className="border-[color-mix(in_srgb,var(--primary)_22%,var(--ui-border-subtle)_78%)] shadow-[var(--ui-shadow-soft)]">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
            Habit AP due
          </div>
          <div className="mt-3 font-display text-4xl text-[var(--primary)]">
            {formatLifeForceAp(dueHabitsActionPointLoad)}
          </div>
          <div className="mt-2 text-sm text-[var(--ui-ink-soft)]">
            Default Action Point load if every due habit is logged today.
          </div>
        </Card>
        <Card className="border-[color-mix(in_srgb,var(--success)_22%,var(--ui-border-subtle)_78%)] shadow-[var(--ui-shadow-soft)]">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
            Best streak
          </div>
          <div className="mt-3 font-display text-4xl text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)]">
            {Math.max(0, ...activeHabits.map((habit) => habit.streakCount))}
          </div>
          <div className="mt-2 text-sm text-[var(--ui-ink-soft)]">
            Longest current aligned streak across active habits.
          </div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
            Average alignment
          </div>
          <div className="mt-3 font-display text-4xl text-[var(--ui-ink-strong)]">
            {activeHabits.length > 0
              ? Math.round(
                  activeHabits.reduce(
                    (total, habit) => total + habit.completionRate,
                    0
                  ) / activeHabits.length
                )
              : 0}
            %
          </div>
          <div className="mt-2 text-sm text-[var(--ui-ink-soft)]">
            Share of recent habit check-ins that matched the intended direction.
          </div>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
            Life Force sync
          </div>
          <div className="mt-3 text-2xl font-display text-[var(--ui-ink-strong)]">
            {lifeForceQuery.data
              ? `${formatLifeForceAp(lifeForceQuery.data.spentTodayAp)} / ${formatLifeForceAp(lifeForceQuery.data.dailyBudgetAp)}`
              : "Loading..."}
          </div>
          <div className="mt-2 text-sm text-[var(--ui-ink-soft)]">
            Habit check-ins debit the same Action Point ledger as work, notes,
            movement, and workouts.
          </div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
            Instant headroom
          </div>
          <div className="mt-3 text-2xl font-display text-[var(--ui-ink-strong)]">
            {lifeForceQuery.data
              ? formatLifeForceRate(lifeForceQuery.data.instantFreeApPerHour)
              : "Loading..."}
          </div>
          <div className="mt-2 text-sm text-[var(--ui-ink-soft)]">
            Use this to tell whether now is a good moment for heavier habits or
            just a light check-in.
          </div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-muted)]">
            Workout-linked load
          </div>
          <div className="mt-3 text-2xl font-display text-[var(--ui-ink-strong)]">
            {formatLifeForceAp(generatedWorkoutLoad)}
          </div>
          <div className="mt-2 text-sm text-[var(--ui-ink-soft)]">
            Habit-generated workout templates stay visible as Action Point cost
            instead of hiding behind the XP reward.
          </div>
        </Card>
      </section>

      {habitsQuery.isLoading ? (
        <Card>Loading habits...</Card>
      ) : activeHabits.length === 0 ? (
        <EmptyState
          eyebrow="Habits"
          title="No recurring habits yet"
          description="Create the recurring commitments or recurring slips you want Forge to track explicitly. Positive habits pay out when completed. Negative habits invert that logic."
          action={
            <Button
              onClick={() => {
                setEditingHabit(null);
                setDialogOpen(true);
              }}
            >
              Create habit
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4">
          <div className="flex flex-col gap-3 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4 shadow-[var(--ui-shadow-soft)] sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-xl">
              <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                Habit list order
              </div>
              <div className="mt-1 text-sm text-[var(--ui-ink-soft)]">
                Choose a stable ordering so the list does not reshuffle while
                you are logging check-ins.
              </div>
            </div>
            <SelectMenu
              label="Order by"
              value={habitOrderBy}
              options={HABIT_ORDER_OPTIONS}
              onChange={handleOrderChange}
              className="w-full sm:w-[19rem]"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {activeHabits.map((habit) => {
              const visualState = getHabitVisualState(habit);
              const streak = getStreakPresentation(habit.streakCount);
              const StreakIcon = streak.Icon;
              const habitActionLoad =
                estimateHabitCheckInActionPointLoad(habit);
              const generatedWorkoutActionLoad =
                estimateHabitGeneratedWorkoutActionPointLoad(habit);
              const noteCount = getEntityNotesSummary(
                shell.snapshot.dashboard.notesSummaryByEntity,
                "habit",
                habit.id
              ).count;
              const alignedAction =
                habit.polarity === "positive"
                  ? {
                      label: "Done",
                      status: getHabitActionStatus(habit, "aligned"),
                      Icon: CheckCheck,
                      className:
                        "border-[color-mix(in_srgb,var(--success)_34%,var(--ui-border-subtle)_66%)] bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)] shadow-[var(--ui-shadow-soft)] hover:bg-[color-mix(in_srgb,var(--success)_24%,var(--ui-surface-hover)_76%)]"
                    }
                  : {
                      label: "Resisted",
                      status: getHabitActionStatus(habit, "aligned"),
                      Icon: ShieldBan,
                      className:
                        "border-[color-mix(in_srgb,var(--success)_34%,var(--ui-border-subtle)_66%)] bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)] shadow-[var(--ui-shadow-soft)] hover:bg-[color-mix(in_srgb,var(--success)_24%,var(--ui-surface-hover)_76%)]"
                    };
              const unalignedAction =
                habit.polarity === "positive"
                  ? {
                      label: "Missed",
                      status: getHabitActionStatus(habit, "unaligned"),
                      Icon: CircleX,
                      className:
                        "border-[color-mix(in_srgb,var(--danger)_34%,var(--ui-border-subtle)_66%)] bg-[var(--ui-danger-soft)] text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)] shadow-[var(--ui-shadow-soft)] hover:bg-[color-mix(in_srgb,var(--danger)_22%,var(--ui-surface-hover)_78%)]"
                    }
                  : {
                      label: "Performed",
                      status: getHabitActionStatus(habit, "unaligned"),
                      Icon: TriangleAlert,
                      className:
                        "border-[color-mix(in_srgb,var(--danger)_34%,var(--ui-border-subtle)_66%)] bg-[var(--ui-danger-soft)] text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)] shadow-[var(--ui-shadow-soft)] hover:bg-[color-mix(in_srgb,var(--danger)_22%,var(--ui-surface-hover)_78%)]"
                    };

              return (
                <Card
                  key={habit.id}
                  className={cn(
                    "relative flex h-full flex-col overflow-hidden",
                    visualState.cardClass,
                    psycheFocusClass(focusedHabitId === habit.id)
                  )}
                  data-psyche-focus-id={habit.id}
                >
                  <div
                    className={cn(
                      "pointer-events-none absolute inset-0 opacity-100",
                      visualState.overlayClass
                    )}
                  />
                  <div className="relative z-10 flex h-full flex-col">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <EntityName
                            kind="habit"
                            label={habit.title}
                            variant="heading"
                            size="sm"
                          />
                          <UserBadge user={habit.user} compact />
                          <Badge className={habitNeutralBadgeClass}>
                            {habit.status}
                          </Badge>
                          <Badge className={habitNeutralBadgeClass}>
                            <CalendarDays className="mr-1 size-3.5" />
                            {formatHabitCadence(habit)}
                          </Badge>
                          <Badge className={habitNeutralBadgeClass}>
                            {habit.dayBoundaryMode === "travel"
                              ? `Travel · ${habit.effectiveTimezone}`
                              : `Fixed · ${habit.timezone}`}
                          </Badge>
                          <Badge
                            className={
                              habit.polarity === "positive"
                                ? habitSuccessBadgeClass
                                : habitDangerBadgeClass
                            }
                          >
                            {habit.polarity === "positive"
                              ? "Positive"
                              : "Negative"}
                          </Badge>
                          {habit.dueToday ? (
                            <Badge className={habitWarningBadgeClass}>
                              Needs check-in
                            </Badge>
                          ) : null}
                          {habit.linkedGoalIds.slice(0, 1).map((goalId) => {
                            const goal = shell.snapshot.goals.find(
                              (entry) => entry.id === goalId
                            );
                            return goal ? (
                              <Badge
                                key={goal.id}
                                className={habitWarningBadgeClass}
                              >
                                Goal · {goal.title}
                              </Badge>
                            ) : null;
                          })}
                          {habit.linkedProjectIds
                            .slice(0, 1)
                            .map((projectId) => {
                              const project =
                                shell.snapshot.dashboard.projects.find(
                                  (entry) => entry.id === projectId
                                );
                              return project ? (
                                <Badge
                                  key={project.id}
                                  className={habitInfoBadgeClass}
                                >
                                  Project · {project.title}
                                </Badge>
                              ) : null;
                            })}
                          {habit.linkedTaskIds.slice(0, 1).map((taskId) => {
                            const task = shell.snapshot.tasks.find(
                              (entry) => entry.id === taskId
                            );
                            return task ? (
                              <Badge
                                key={task.id}
                                className={habitAccentBadgeClass}
                              >
                                Task · {task.title}
                              </Badge>
                            ) : null;
                          })}
                        </div>
                        <div className="mt-3 text-sm leading-6 text-[var(--ui-ink-medium)]">
                          {habit.description ? (
                            <NoteMarkdown
                              markdown={habit.description}
                              className="[&>p]:text-sm [&>p]:leading-6 [&>blockquote]:text-sm [&>ul]:text-sm [&>ol]:text-sm"
                            />
                          ) : (
                            "No extra notes yet."
                          )}
                        </div>
                      </div>
                      <div className="ml-auto inline-flex shrink-0 flex-col items-end gap-2 self-start text-right">
                        <div
                          className={cn(
                            "inline-flex flex-col self-end rounded-[20px] px-3 py-2.5 text-right",
                            streak.className
                          )}
                        >
                          <div className="flex items-center justify-end gap-1.5 text-[10px] uppercase tracking-[0.16em]">
                            <span>Streak</span>
                            <StreakIcon
                              className={cn(
                                "size-3.5 shrink-0",
                                streak.iconClass
                              )}
                            />
                          </div>
                          <div
                            className={cn(
                              "mt-1.5 font-display text-[2.75rem] leading-none",
                              streak.valueClass
                            )}
                          >
                            {habit.streakCount}
                          </div>
                          <div className="mt-1 text-[11px] leading-tight text-[var(--ui-ink-soft)]">
                            {streak.label}
                          </div>
                        </div>
                        <div className="ml-auto grid grid-cols-2 gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 min-w-0 rounded-[11px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                            disabled={saveHabitMutation.isPending}
                            onClick={() => {
                              setEditingHabit(habit);
                              setDialogOpen(true);
                            }}
                            aria-label={`Edit ${habit.title}`}
                            title="Edit habit"
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 min-w-0 rounded-[11px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                            disabled={deleteHabitMutation.isPending}
                            onClick={() => setConfirmingDeleteHabit(habit)}
                            aria-label={`Delete ${habit.title}`}
                            title="Delete habit"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="mt-auto grid gap-4 pt-5">
                      <div className="flex flex-wrap gap-2">
                        <Badge
                          className={cn(
                            "",
                            getAlignmentBadgeClass(habit.completionRate)
                          )}
                        >
                          Alignment {habit.completionRate}%
                        </Badge>
                        <Badge className={habitNeutralBadgeClass}>
                          {habit.polarity === "positive"
                            ? `+${habit.rewardXp} XP done`
                            : `+${habit.rewardXp} XP resisted`}
                        </Badge>
                        <Badge className={habitNeutralBadgeClass}>
                          {habit.polarity === "positive"
                            ? `-${habit.penaltyXp} XP missed`
                            : `-${habit.penaltyXp} XP performed`}
                        </Badge>
                        <Badge className={habitAccentBadgeClass}>
                          {formatLifeForceAp(habitActionLoad.totalAp)} check-in
                        </Badge>
                        {generatedWorkoutActionLoad ? (
                          <Badge className={habitWarningBadgeClass}>
                            {formatLifeForceAp(
                              generatedWorkoutActionLoad.totalAp
                            )}{" "}
                            workout
                          </Badge>
                        ) : null}
                        {generatedWorkoutActionLoad ? (
                          <Badge className={habitNeutralBadgeClass}>
                            {formatLifeForceRate(
                              generatedWorkoutActionLoad.rateApPerHour
                            )}
                          </Badge>
                        ) : null}
                        <EntityNoteCountLink
                          entityType="habit"
                          entityId={habit.id}
                          count={noteCount}
                          className="min-h-8 rounded-full border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-1.5 text-[12px] text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)]"
                        />
                        {habit.linkedBehaviorTitles
                          .slice(0, 2)
                          .map((behaviorTitle) => (
                            <Badge
                              key={behaviorTitle}
                              className={habitWarningBadgeClass}
                            >
                              <ShieldBan className="mr-1 size-3.5" />
                              {behaviorTitle}
                            </Badge>
                          ))}
                        {habit.linkedProjectIds.slice(1, 2).map((projectId) => {
                          const project =
                            shell.snapshot.dashboard.projects.find(
                              (entry) => entry.id === projectId
                            );
                          return project ? (
                            <Badge
                              key={project.id}
                              className={habitInfoBadgeClass}
                            >
                              Project · {project.title}
                            </Badge>
                          ) : null;
                        })}
                        {habit.linkedTaskIds.slice(1, 2).map((taskId) => {
                          const task = shell.snapshot.tasks.find(
                            (entry) => entry.id === taskId
                          );
                          return task ? (
                            <Badge
                              key={task.id}
                              className={habitAccentBadgeClass}
                            >
                              Task · {task.title}
                            </Badge>
                          ) : null;
                        })}
                        {habit.linkedValueIds.slice(0, 2).map((valueId) => {
                          const valueEntry =
                            psycheOverviewQuery.data?.values.find(
                              (entry) => entry.id === valueId
                            );
                          return valueEntry ? (
                            <Badge
                              key={valueEntry.id}
                              className={habitSuccessBadgeClass}
                            >
                              Value · {valueEntry.title}
                            </Badge>
                          ) : null;
                        })}
                        {habit.linkedPatternIds.slice(0, 2).map((patternId) => {
                          const pattern =
                            psycheOverviewQuery.data?.patterns.find(
                              (entry) => entry.id === patternId
                            );
                          return pattern ? (
                            <Badge
                              key={pattern.id}
                              className={habitInfoBadgeClass}
                            >
                              Pattern · {pattern.title}
                            </Badge>
                          ) : null;
                        })}
                        {habit.linkedBeliefIds.slice(0, 2).map((beliefId) => {
                          const belief = psycheOverviewQuery.data?.beliefs.find(
                            (entry) => entry.id === beliefId
                          );
                          return belief ? (
                            <Badge
                              key={belief.id}
                              className={habitDangerBadgeClass}
                            >
                              Belief · {belief.statement}
                            </Badge>
                          ) : null;
                        })}
                        {habit.linkedModeIds.slice(0, 2).map((modeId) => {
                          const mode = psycheOverviewQuery.data?.modes.find(
                            (entry) => entry.id === modeId
                          );
                          return mode ? (
                            <Badge
                              key={mode.id}
                              className={habitAccentBadgeClass}
                            >
                              Mode · {mode.title}
                            </Badge>
                          ) : null;
                        })}
                        {habit.linkedReportIds.slice(0, 2).map((reportId) => {
                          const report = psycheOverviewQuery.data?.reports.find(
                            (entry) => entry.id === reportId
                          );
                          return report ? (
                            <Badge
                              key={report.id}
                              className={habitAccentBadgeClass}
                            >
                              Report · {report.title}
                            </Badge>
                          ) : null;
                        })}
                      </div>

                      <div className="grid gap-4">
                        <HabitHistoryStrip
                          habit={habit}
                          onSelectCell={(selectedHabit, cell) => {
                            setHistoryEditor({ habit: selectedHabit, cell });
                            setErrorMessage(null);
                          }}
                        />
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <Button
                          variant="secondary"
                          className={cn(
                            "h-11 rounded-[16px] border",
                            alignedAction.className
                          )}
                          disabled={checkInMutation.isPending}
                          onClick={() =>
                            void checkInMutation.mutateAsync({
                              habitId: habit.id,
                              status: alignedAction.status,
                              dateKey: habit.currentDateKey
                            })
                          }
                        >
                          <alignedAction.Icon className="size-4" />
                          {alignedAction.label}
                        </Button>
                        <Button
                          variant="secondary"
                          className={cn(
                            "h-11 rounded-[16px] border",
                            unalignedAction.className
                          )}
                          disabled={checkInMutation.isPending}
                          onClick={() =>
                            void checkInMutation.mutateAsync({
                              habitId: habit.id,
                              status: unalignedAction.status,
                              dateKey: habit.currentDateKey
                            })
                          }
                        >
                          <unalignedAction.Icon className="size-4" />
                          {unalignedAction.label}
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <HabitDialog
        open={dialogOpen}
        pending={saveHabitMutation.isPending}
        editingHabit={editingHabit}
        values={psycheOverviewQuery.data?.values ?? []}
        patterns={psycheOverviewQuery.data?.patterns ?? []}
        behaviors={psycheOverviewQuery.data?.behaviors ?? []}
        beliefs={psycheOverviewQuery.data?.beliefs ?? []}
        modes={psycheOverviewQuery.data?.modes ?? []}
        reports={psycheOverviewQuery.data?.reports ?? []}
        goals={shell.snapshot.dashboard.goals}
        projects={shell.snapshot.dashboard.projects}
        tasks={shell.snapshot.tasks}
        users={shell.snapshot.users}
        defaultUserId={editingHabit?.userId ?? defaultUserId}
        onOpenChange={setDialogOpen}
        onSubmit={async (input, habitId) => {
          try {
            await saveHabitMutation.mutateAsync({ input, habitId });
          } catch (error) {
            if (!(error instanceof ForgeApiError)) {
              throw error;
            }
            throw error;
          }
        }}
      />
      <PlanningRecordDeleteDialog
        open={confirmingDeleteHabit !== null}
        recordKind="habit"
        recordTitle={confirmingDeleteHabit?.title ?? "this habit"}
        onOpenChange={(open) => {
          if (!open && !deleteHabitMutation.isPending) {
            setConfirmingDeleteHabit(null);
          }
        }}
        onConfirm={async () => {
          if (confirmingDeleteHabit) {
            await deleteHabitMutation.mutateAsync(confirmingDeleteHabit.id);
          }
        }}
      />
      <Dialog.Root
        open={historyEditor !== null}
        onOpenChange={(open) => {
          if (!open) {
            setHistoryEditor(null);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="surface-overlay fixed inset-0 z-40 backdrop-blur-xl" />
          <Dialog.Content className="surface-modal-panel fixed inset-x-4 top-1/2 z-50 mx-auto w-[min(42rem,calc(100vw-2rem))] max-w-[42rem] -translate-y-1/2 overflow-hidden rounded-[30px] border">
            <Dialog.Title className="sr-only">Habit history</Dialog.Title>
            <Dialog.Description className="sr-only">
              Log or revise a habit check-in for a selected history point.
            </Dialog.Description>
            {historyEditor && historyCopy ? (
              <>
                <div className="border-b border-[var(--ui-border-subtle)] px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
                        Habit history
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <div className="text-lg font-semibold text-[var(--ui-ink-strong)]">
                          {historyEditor.habit.title}
                        </div>
                        <Badge>{historyEditor.cell.actionLabel}</Badge>
                      </div>
                      <div className="mt-3 text-sm text-[var(--ui-ink-soft)]">
                        {historyEditor.habit.frequency === "daily"
                          ? "Log or revise the check-in for this specific day."
                          : "Log or revise the representative check-in for this week."}
                      </div>
                    </div>
                    <Dialog.Close asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 w-10 rounded-[14px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-0 text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                        aria-label="Close history modal"
                        title="Close"
                      >
                        <X className="size-4" />
                      </Button>
                    </Dialog.Close>
                  </div>
                </div>

                <div className="grid gap-4 p-5">
                  <div className="grid gap-3 md:grid-cols-2">
                    <button
                      type="button"
                      aria-pressed={
                        historyStatus !== null &&
                        getHabitActionTone(
                          historyEditor.habit,
                          historyStatus
                        ) === "aligned"
                      }
                      className={cn(
                        "rounded-[22px] border px-4 py-4 text-left transition",
                        historyStatus !== null &&
                          getHabitActionTone(
                            historyEditor.habit,
                            historyStatus
                          ) === "aligned"
                          ? "border-[color-mix(in_srgb,var(--success)_34%,var(--ui-border-subtle)_66%)] bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)] shadow-[var(--ui-shadow-soft)]"
                          : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)]"
                      )}
                      onClick={() =>
                        setHistoryStatus((current) =>
                          current !== null &&
                          getHabitActionTone(historyEditor.habit, current) ===
                            "aligned"
                            ? null
                            : getHabitActionStatus(
                                historyEditor.habit,
                                "aligned"
                              )
                        )
                      }
                    >
                      <div className="flex items-center gap-2 text-base font-medium">
                        <CheckCheck className="size-4" />
                        {historyCopy.alignedLabel}
                      </div>
                      <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                        {historyCopy.alignedDescription}
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-pressed={
                        historyStatus !== null &&
                        getHabitActionTone(
                          historyEditor.habit,
                          historyStatus
                        ) === "unaligned"
                      }
                      className={cn(
                        "rounded-[22px] border px-4 py-4 text-left transition",
                        historyStatus !== null &&
                          getHabitActionTone(
                            historyEditor.habit,
                            historyStatus
                          ) === "unaligned"
                          ? "border-[color-mix(in_srgb,var(--danger)_34%,var(--ui-border-subtle)_66%)] bg-[var(--ui-danger-soft)] text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)] shadow-[var(--ui-shadow-soft)]"
                          : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)]"
                      )}
                      onClick={() =>
                        setHistoryStatus((current) =>
                          current !== null &&
                          getHabitActionTone(historyEditor.habit, current) ===
                            "unaligned"
                            ? null
                            : getHabitActionStatus(
                                historyEditor.habit,
                                "unaligned"
                              )
                        )
                      }
                    >
                      <div className="flex items-center gap-2 text-base font-medium">
                        <CircleX className="size-4" />
                        {historyCopy.unalignedLabel}
                      </div>
                      <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
                        {historyCopy.unalignedDescription}
                      </div>
                    </button>
                  </div>

                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-[var(--ui-ink-strong)]">
                      Optional note
                    </span>
                    <Textarea
                      value={historyNote}
                      onChange={(event) => setHistoryNote(event.target.value)}
                      placeholder="Add context for what happened on this day or week."
                      className="min-h-24"
                    />
                  </label>

                  <div className="flex flex-wrap items-center justify-end gap-3">
                    <Button
                      variant="secondary"
                      onClick={() => setHistoryEditor(null)}
                      disabled={checkInMutation.isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      disabled={checkInMutation.isPending || !canSaveHistory}
                      pending={checkInMutation.isPending}
                      pendingLabel="Saving"
                      onClick={async () => {
                        if (!canSaveHistory) {
                          return;
                        }
                        if (historyStatus === null) {
                          await deleteHabitCheckIn(
                            historyEditor.habit.id,
                            historyEditor.cell.actionDateKey
                          );
                          await refreshHabits();
                        } else {
                          await checkInMutation.mutateAsync({
                            habitId: historyEditor.habit.id,
                            status: historyStatus,
                            dateKey: historyEditor.cell.actionDateKey,
                            note: historyNote.trim() || undefined
                          });
                        }
                        setHistoryEditor(null);
                      }}
                    >
                      Save check-in
                    </Button>
                  </div>
                </div>
              </>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
