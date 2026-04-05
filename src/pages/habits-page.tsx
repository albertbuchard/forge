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
  Trash2
} from "lucide-react";
import { EntityNoteCountLink } from "@/components/notes/entity-note-count-link";
import { NoteMarkdown } from "@/components/notes/note-markdown";
import { SheetScaffold } from "@/components/experience/sheet-scaffold";
import { PageHero } from "@/components/shell/page-hero";
import { HabitDialog } from "@/components/habit-dialog";
import { useForgeShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/page-state";
import { EntityName } from "@/components/ui/entity-name";
import { Textarea } from "@/components/ui/textarea";
import { UserBadge } from "@/components/ui/user-badge";
import {
  createHabit,
  createHabitCheckIn,
  deleteHabit,
  getPsycheOverview,
  listHabits,
  patchHabit
} from "@/lib/api";
import type { HabitMutationInput } from "@/lib/schemas";
import type { Habit } from "@/lib/types";
import { ForgeApiError } from "@/lib/api-error";
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

function formatHabitCadence(habit: Habit) {
  if (habit.frequency === "daily") {
    return `${habit.targetCount}x daily`;
  }
  return `${habit.targetCount}x weekly · ${habit.weekDays.map((day) => WEEKDAY_LABELS[day]).join(", ")}`;
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function startOfUtcDay(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfUtcWeek(date: Date) {
  const start = startOfUtcDay(date);
  const offset = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - offset);
  return start;
}

function formatUtcShortDate(value: Date | string) {
  const date = typeof value === "string" ? parseDateKey(value) : value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function formatRecentCheckInDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
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
  const todayKey = formatDateKey(new Date());
  const todayCheckIn =
    habit.checkIns.find((checkIn) => checkIn.dateKey === todayKey) ?? null;

  if (habit.dueToday) {
    return {
      tone: "pending" as const,
      label:
        habit.frequency === "daily"
          ? "Waiting for today"
          : "Awaiting this week's check-in",
      cardClass: "border-amber-300/24 shadow-[0_0_0_1px_rgba(251,191,36,0.12)]",
      overlayClass:
        "bg-[radial-gradient(circle_at_top_right,rgba(251,191,36,0.18),transparent_44%)]",
      pillClass: "border border-amber-300/16 bg-amber-300/12 text-amber-100"
    };
  }

  if (todayCheckIn) {
    const aligned = isAlignedCheckIn(habit, todayCheckIn.status);
    return aligned
      ? {
          tone: "aligned" as const,
          label: `${getCheckInLabel(habit, todayCheckIn.status)} today`,
          cardClass:
            "border-emerald-300/20 shadow-[0_0_0_1px_rgba(52,211,153,0.08)]",
          overlayClass:
            "bg-[radial-gradient(circle_at_top_right,rgba(52,211,153,0.16),transparent_44%)]",
          pillClass:
            "border border-emerald-300/16 bg-emerald-300/12 text-emerald-100"
        }
      : {
          tone: "unaligned" as const,
          label: `${getCheckInLabel(habit, todayCheckIn.status)} today`,
          cardClass:
            "border-rose-300/20 shadow-[0_0_0_1px_rgba(251,113,133,0.08)]",
          overlayClass:
            "bg-[radial-gradient(circle_at_top_right,rgba(251,113,133,0.16),transparent_44%)]",
          pillClass: "border border-rose-300/16 bg-rose-300/12 text-rose-100"
        };
  }

  return habit.polarity === "positive"
    ? {
        tone: "neutral" as const,
        label: "No update due right now",
        cardClass: "",
        overlayClass:
          "bg-[radial-gradient(circle_at_top_right,rgba(52,211,153,0.09),transparent_40%)]",
        pillClass: "border border-white/10 bg-white/[0.06] text-white/62"
      }
    : {
        tone: "neutral" as const,
        label: "No update due right now",
        cardClass: "",
        overlayClass:
          "bg-[radial-gradient(circle_at_top_right,rgba(251,113,133,0.09),transparent_40%)]",
        pillClass: "border border-white/10 bg-white/[0.06] text-white/62"
      };
}

function getStreakPresentation(streak: number) {
  if (streak >= 10) {
    return {
      Icon: PartyPopper,
      className:
        "border border-amber-300/20 bg-amber-300/10 text-amber-100 shadow-[0_16px_32px_rgba(251,191,36,0.14)]",
      iconClass: "text-amber-200",
      valueClass: "text-amber-50",
      label: "Celebration pace"
    };
  }
  if (streak >= 5) {
    return {
      Icon: Smile,
      className:
        "border border-emerald-300/20 bg-emerald-300/10 text-emerald-100 shadow-[0_16px_32px_rgba(52,211,153,0.12)]",
      iconClass: "text-emerald-200",
      valueClass: "text-emerald-50",
      label: "Locked in"
    };
  }
  if (streak >= 1) {
    return {
      Icon: Meh,
      className:
        "border border-sky-300/18 bg-sky-300/10 text-sky-100 shadow-[0_16px_32px_rgba(125,211,252,0.1)]",
      iconClass: "text-sky-200",
      valueClass: "text-sky-50",
      label: "Building rhythm"
    };
  }
  return {
    Icon: Frown,
    className:
      "border border-white/10 bg-white/[0.04] text-white/72 shadow-[0_16px_32px_rgba(15,23,42,0.16)]",
    iconClass: "text-white/55",
    valueClass: "text-white",
    label: "Cold start"
  };
}

function getAlignmentBadgeClass(completionRate: number) {
  if (completionRate >= 80) {
    return "bg-emerald-400/12 text-emerald-100";
  }
  if (completionRate >= 50) {
    return "bg-amber-300/12 text-amber-100";
  }
  return "bg-rose-400/12 text-rose-100";
}

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
  const now = new Date();

  if (habit.frequency === "daily") {
    const today = startOfUtcDay(now);
    const cells: HabitHistoryCell[] = [];

    for (let offset = -6; offset <= 0; offset += 1) {
      const date = addUtcDays(today, offset);
      const dateKey = formatDateKey(date);
      const checkIn =
        habit.checkIns.find((entry) => entry.dateKey === dateKey) ?? null;
      const label = DAILY_HISTORY_LABELS[date.getUTCDay()];
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

  const thisWeek = startOfUtcWeek(now);
  const weekBuckets = new Map<string, Habit["checkIns"]>();

  for (const checkIn of habit.checkIns) {
    const weekStart = formatDateKey(
      startOfUtcWeek(parseDateKey(checkIn.dateKey))
    );
    const entries = weekBuckets.get(weekStart) ?? [];
    entries.push(checkIn);
    weekBuckets.set(weekStart, entries);
  }

  const cells: HabitHistoryCell[] = [];

  for (let offset = -6; offset <= 0; offset += 1) {
    const weekStart = addUtcDays(thisWeek, offset * 7);
    const weekKey = formatDateKey(weekStart);
    const entries = weekBuckets.get(weekKey) ?? [];
    const scheduledWeekDay =
      habit.weekDays.length > 0
        ? [...habit.weekDays].sort((left, right) => right - left)[0]
        : 0;
    const fallbackDateKey = formatDateKey(
      addUtcDays(weekStart, scheduledWeekDay)
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
          : alignedCount >= unalignedCount
            ? "aligned"
            : "unaligned",
      title: `${formatUtcShortDate(weekStart)} week · ${entries.length === 0 ? "Not informed" : alignedCount >= unalignedCount ? "Mostly aligned" : "Mostly off track"}`
    });
  }

  return {
    caption: "7-week rhythm",
    rangeLabel: "Past 7 weeks",
    showLabels: false,
    startLabel: formatUtcShortDate(addUtcDays(thisWeek, -42)),
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
      "border-emerald-300/20 bg-emerald-300/75 shadow-[0_8px_18px_rgba(52,211,153,0.18)]",
    state === "unaligned" &&
      "border-rose-300/20 bg-rose-300/75 shadow-[0_8px_18px_rgba(251,113,133,0.18)]",
    state === "unknown" && "border-white/8 bg-white/[0.08]",
    current && "shadow-[0_0_0_1px_rgba(255,255,255,0.16)]"
  );
}

function HabitHistoryStrip({
  habit,
  noteCount,
  onSelectCell
}: {
  habit: Habit;
  noteCount: number;
  onSelectCell: (habit: Habit, cell: HabitHistoryCell) => void;
}) {
  const history = buildHabitHistory(habit);
  const visualState = getHabitVisualState(habit);

  return (
    <div className="w-full rounded-[18px] border border-white/8 bg-black/10 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="shrink-0">
          <div className="font-label text-[10px] uppercase tracking-[0.16em] text-white/34">
            {history.caption}
          </div>
          <div className="text-[11px] text-white/46">{history.rangeLabel}</div>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {history.cells.map((cell) => (
            <button
              key={cell.id}
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1"
              onClick={() => onSelectCell(habit, cell)}
              title={`Log check-in for ${cell.actionLabel}`}
              aria-label={`Log check-in for ${cell.actionLabel}`}
            >
              <div
                className={cn(
                  getHistoryCellClass(cell.state, cell.current),
                  "h-6 min-w-0 flex-1 rounded-[8px] hover:opacity-90"
                )}
              />
              {history.showLabels ? (
                <span className="hidden text-[9px] uppercase tracking-[0.14em] text-white/26 sm:inline">
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

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-[11px] text-white/42">
        <EntityNoteCountLink
          entityType="habit"
          entityId={habit.id}
          count={noteCount}
        />
        <span>
          {habit.lastCheckInAt && habit.lastCheckInStatus
            ? `Latest ${getCheckInLabel(habit, habit.lastCheckInStatus).toLowerCase()} · ${formatRecentCheckInDate(habit.lastCheckInAt)}`
            : "No recent check-ins"}
        </span>
        {!history.showLabels ? (
          <span className="text-[10px] uppercase tracking-[0.14em] text-white/26">
            {history.startLabel} - {history.endLabel}
          </span>
        ) : null}
      </div>
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

export function HabitsPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [historyEditor, setHistoryEditor] = useState<HistoryEditorState | null>(
    null
  );
  const [historyStatus, setHistoryStatus] = useState<"done" | "missed">("done");
  const [historyNote, setHistoryNote] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const selectedUserIds = coerceSelectedUserIds(shell.selectedUserIds);
  const defaultUserId = getSingleSelectedUserId(selectedUserIds);

  const habitsQuery = useQuery({
    queryKey: ["forge-habits", ...selectedUserIds],
    queryFn: async () =>
      (
        await listHabits({
          userIds: selectedUserIds
        })
      ).habits
  });
  const psycheOverviewQuery = useQuery({
    queryKey: ["forge-psyche-overview", ...selectedUserIds],
    queryFn: async () => (await getPsycheOverview(selectedUserIds)).overview
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
    }) => createHabitCheckIn(habitId, { status, dateKey, note }),
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
    onSuccess: async () => {
      setErrorMessage(null);
      await refreshHabits();
    },
    onError: (error) => {
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
  const prioritizedHabits = useMemo(
    () =>
      [...activeHabits].sort((left, right) => {
        if (left.dueToday !== right.dueToday) {
          return Number(right.dueToday) - Number(left.dueToday);
        }
        if (left.dueToday && right.dueToday) {
          return (
            new Date(left.lastCheckInAt ?? 0).getTime() -
            new Date(right.lastCheckInAt ?? 0).getTime()
          );
        }
        return left.title.localeCompare(right.title);
      }),
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
      setHistoryStatus("done");
      setHistoryNote("");
      return;
    }

    setHistoryStatus(selectedHistoryCheckIn?.status ?? "done");
    setHistoryNote(selectedHistoryCheckIn?.note ?? "");
  }, [historyEditor, selectedHistoryCheckIn]);

  if (habitsQuery.error) {
    throw habitsQuery.error;
  }

  const historyCopy = historyEditor
    ? getHistoryOptionCopy(historyEditor.habit)
    : null;

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
          <Button
            onClick={() => {
              setEditingHabit(null);
              setDialogOpen(true);
            }}
          >
            <Sparkles className="size-4" />
            New habit
          </Button>
        }
      />

      {errorMessage ? (
        <Card className="border-rose-400/22 bg-rose-400/8 text-rose-100">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <div>{errorMessage}</div>
          </div>
        </Card>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="border-amber-300/16 shadow-[0_0_0_1px_rgba(251,191,36,0.08)]">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Due today
          </div>
          <div className="mt-3 font-display text-4xl text-[var(--primary)]">
            {dueHabits.length}
          </div>
          <div className="mt-2 text-sm text-white/58">
            Habits that still need a check-in today.
          </div>
        </Card>
        <Card className="border-emerald-300/16 shadow-[0_0_0_1px_rgba(52,211,153,0.08)]">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Best streak
          </div>
          <div className="mt-3 font-display text-4xl text-emerald-50">
            {Math.max(0, ...activeHabits.map((habit) => habit.streakCount))}
          </div>
          <div className="mt-2 text-sm text-white/58">
            Longest current aligned streak across active habits.
          </div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Average alignment
          </div>
          <div className="mt-3 font-display text-4xl text-white">
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
          <div className="mt-2 text-sm text-white/58">
            Share of recent habit check-ins that matched the intended direction.
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
        <div className="grid gap-4 xl:grid-cols-2">
          {prioritizedHabits.map((habit) => {
            const visualState = getHabitVisualState(habit);
            const streak = getStreakPresentation(habit.streakCount);
            const StreakIcon = streak.Icon;
            const noteCount = getEntityNotesSummary(
              shell.snapshot.dashboard.notesSummaryByEntity,
              "habit",
              habit.id
            ).count;
            const alignedAction =
              habit.polarity === "positive"
                ? {
                    label: "Done",
                    status: "done" as const,
                    Icon: CheckCheck,
                    className:
                      "border-emerald-300/18 bg-emerald-300/14 text-emerald-50 shadow-[0_14px_28px_rgba(52,211,153,0.14)] hover:bg-emerald-300/20"
                  }
                : {
                    label: "Resisted",
                    status: "missed" as const,
                    Icon: ShieldBan,
                    className:
                      "border-emerald-300/18 bg-emerald-300/14 text-emerald-50 shadow-[0_14px_28px_rgba(52,211,153,0.14)] hover:bg-emerald-300/20"
                  };
            const unalignedAction =
              habit.polarity === "positive"
                ? {
                    label: "Missed",
                    status: "missed" as const,
                    Icon: CircleX,
                    className:
                      "border-rose-300/18 bg-rose-300/14 text-rose-50 shadow-[0_14px_28px_rgba(251,113,133,0.14)] hover:bg-rose-300/20"
                  }
                : {
                    label: "Performed",
                    status: "done" as const,
                    Icon: TriangleAlert,
                    className:
                      "border-rose-300/18 bg-rose-300/14 text-rose-50 shadow-[0_14px_28px_rgba(251,113,133,0.14)] hover:bg-rose-300/20"
                  };

            return (
              <Card
                key={habit.id}
                className={cn(
                  "relative overflow-hidden",
                  visualState.cardClass
                )}
              >
                <div
                  className={cn(
                    "pointer-events-none absolute inset-0 opacity-100",
                    visualState.overlayClass
                  )}
                />
                <div className="relative z-10">
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
                        <Badge className="bg-white/[0.08] text-white/72">
                          {habit.status}
                        </Badge>
                        <Badge
                          className={
                            habit.polarity === "positive"
                              ? "bg-emerald-400/12 text-emerald-200"
                              : "bg-rose-400/12 text-rose-200"
                          }
                        >
                          {habit.polarity === "positive"
                            ? "Positive"
                            : "Negative"}
                        </Badge>
                        {habit.dueToday ? (
                          <Badge className="bg-amber-300/12 text-amber-100">
                            Needs check-in
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-3 text-sm leading-6 text-white/60">
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
                    <div className="min-w-[9.5rem] text-right">
                      <div
                        className={cn(
                          "ml-auto inline-flex flex-col rounded-[22px] px-4 py-3 text-right",
                          streak.className
                        )}
                      >
                        <div className="flex items-center justify-end gap-2 text-[11px] uppercase tracking-[0.16em]">
                          <span>Streak</span>
                          <StreakIcon
                            className={cn("size-4 shrink-0", streak.iconClass)}
                          />
                        </div>
                        <div
                          className={cn(
                            "mt-2 font-display text-[2rem] leading-none",
                            streak.valueClass
                          )}
                        >
                          {habit.streakCount}
                        </div>
                        <div className="mt-1 text-xs text-white/68">
                          {streak.label}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge className="bg-white/[0.08] text-white/72">
                      <CalendarDays className="mr-1 size-3.5" />
                      {formatHabitCadence(habit)}
                    </Badge>
                    <Badge
                      className={cn(
                        "border-0",
                        getAlignmentBadgeClass(habit.completionRate)
                      )}
                    >
                      Alignment {habit.completionRate}%
                    </Badge>
                    <Badge className="bg-white/[0.08] text-white/72">
                      {habit.polarity === "positive"
                        ? `+${habit.rewardXp} XP done`
                        : `+${habit.rewardXp} XP resisted`}
                    </Badge>
                    <Badge className="bg-white/[0.08] text-white/72">
                      {habit.polarity === "positive"
                        ? `-${habit.penaltyXp} XP missed`
                        : `-${habit.penaltyXp} XP performed`}
                    </Badge>
                    {habit.linkedBehaviorTitles
                      .slice(0, 2)
                      .map((behaviorTitle) => (
                        <Badge
                          key={behaviorTitle}
                          className="bg-orange-400/12 text-orange-100"
                        >
                          <ShieldBan className="mr-1 size-3.5" />
                          {behaviorTitle}
                        </Badge>
                      ))}
                    {habit.linkedGoalIds.slice(0, 2).map((goalId) => {
                      const goal = shell.snapshot.goals.find(
                        (entry) => entry.id === goalId
                      );
                      return goal ? (
                        <Badge
                          key={goal.id}
                          className="bg-amber-400/12 text-amber-100"
                        >
                          Goal · {goal.title}
                        </Badge>
                      ) : null;
                    })}
                    {habit.linkedProjectIds.slice(0, 2).map((projectId) => {
                      const project = shell.snapshot.dashboard.projects.find(
                        (entry) => entry.id === projectId
                      );
                      return project ? (
                        <Badge
                          key={project.id}
                          className="bg-sky-400/12 text-sky-100"
                        >
                          Project · {project.title}
                        </Badge>
                      ) : null;
                    })}
                    {habit.linkedTaskIds.slice(0, 2).map((taskId) => {
                      const task = shell.snapshot.tasks.find(
                        (entry) => entry.id === taskId
                      );
                      return task ? (
                        <Badge
                          key={task.id}
                          className="bg-indigo-400/12 text-indigo-100"
                        >
                          Task · {task.title}
                        </Badge>
                      ) : null;
                    })}
                    {habit.linkedValueIds.slice(0, 2).map((valueId) => {
                      const valueEntry = psycheOverviewQuery.data?.values.find(
                        (entry) => entry.id === valueId
                      );
                      return valueEntry ? (
                        <Badge
                          key={valueEntry.id}
                          className="bg-emerald-400/12 text-emerald-100"
                        >
                          Value · {valueEntry.title}
                        </Badge>
                      ) : null;
                    })}
                    {habit.linkedPatternIds.slice(0, 2).map((patternId) => {
                      const pattern = psycheOverviewQuery.data?.patterns.find(
                        (entry) => entry.id === patternId
                      );
                      return pattern ? (
                        <Badge
                          key={pattern.id}
                          className="bg-cyan-400/12 text-cyan-100"
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
                          className="bg-rose-400/12 text-rose-100"
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
                          className="bg-violet-400/12 text-violet-100"
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
                          className="bg-fuchsia-400/12 text-fuchsia-100"
                        >
                          Report · {report.title}
                        </Badge>
                      ) : null;
                    })}
                  </div>

                  <div className="mt-5 grid gap-4">
                    <HabitHistoryStrip
                      habit={habit}
                      noteCount={noteCount}
                      onSelectCell={(selectedHabit, cell) => {
                        setHistoryEditor({ habit: selectedHabit, cell });
                        setErrorMessage(null);
                      }}
                    />
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
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
                            status: alignedAction.status
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
                            status: unalignedAction.status
                          })
                        }
                      >
                        <unalignedAction.Icon className="size-4" />
                        {unalignedAction.label}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 w-10 rounded-[14px] border border-white/8 bg-white/[0.04] px-0 text-white/72 hover:bg-white/[0.08] hover:text-white"
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
                        className="h-10 w-10 rounded-[14px] border border-white/8 bg-white/[0.04] px-0 text-white/72 hover:bg-white/[0.08] hover:text-white"
                        disabled={deleteHabitMutation.isPending}
                        onClick={() => {
                          if (
                            !window.confirm(`Delete habit "${habit.title}"?`)
                          ) {
                            return;
                          }
                          void deleteHabitMutation.mutateAsync(habit.id);
                        }}
                        aria-label={`Delete ${habit.title}`}
                        title="Delete habit"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
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
      <SheetScaffold
        open={historyEditor !== null}
        onOpenChange={(open) => {
          if (!open) {
            setHistoryEditor(null);
          }
        }}
        eyebrow="Habit history"
        title={
          historyEditor
            ? `${historyEditor.habit.title} · ${historyEditor.cell.actionLabel}`
            : "Habit history"
        }
        description={
          historyEditor
            ? historyEditor.habit.frequency === "daily"
              ? "Log or revise the check-in for this specific day."
              : "Log or revise the representative check-in for this week."
            : undefined
        }
      >
        {historyEditor && historyCopy ? (
          <div className="grid gap-4">
            <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-label text-[11px] uppercase tracking-[0.16em] text-white/40">
                    Target
                  </div>
                  <div className="mt-1 text-sm text-white/76">
                    {historyEditor.cell.actionLabel}
                  </div>
                </div>
                {selectedHistoryCheckIn ? (
                  <Badge className="bg-white/[0.08] text-white/72">
                    Current:{" "}
                    {getCheckInLabel(
                      historyEditor.habit,
                      selectedHistoryCheckIn.status
                    )}
                  </Badge>
                ) : (
                  <Badge className="bg-white/[0.08] text-white/58">
                    No logged value yet
                  </Badge>
                )}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <button
                type="button"
                className={cn(
                  "rounded-[22px] border px-4 py-4 text-left transition",
                  historyStatus === "done"
                    ? "border-emerald-300/24 bg-emerald-300/14 text-white shadow-[0_16px_36px_rgba(52,211,153,0.14)]"
                    : "border-white/8 bg-white/[0.04] text-white/72 hover:bg-white/[0.07]"
                )}
                onClick={() => setHistoryStatus("done")}
              >
                <div className="flex items-center gap-2 text-base font-medium">
                  <CheckCheck className="size-4" />
                  {historyCopy.alignedLabel}
                </div>
                <div className="mt-2 text-sm leading-6 text-white/56">
                  {historyCopy.alignedDescription}
                </div>
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-[22px] border px-4 py-4 text-left transition",
                  historyStatus === "missed"
                    ? "border-rose-300/24 bg-rose-300/14 text-white shadow-[0_16px_36px_rgba(251,113,133,0.14)]"
                    : "border-white/8 bg-white/[0.04] text-white/72 hover:bg-white/[0.07]"
                )}
                onClick={() => setHistoryStatus("missed")}
              >
                <div className="flex items-center gap-2 text-base font-medium">
                  <CircleX className="size-4" />
                  {historyCopy.unalignedLabel}
                </div>
                <div className="mt-2 text-sm leading-6 text-white/56">
                  {historyCopy.unalignedDescription}
                </div>
              </button>
            </div>

            <label className="grid gap-2">
              <span className="text-sm font-medium text-white">
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
                pending={checkInMutation.isPending}
                pendingLabel="Saving"
                onClick={async () => {
                  await checkInMutation.mutateAsync({
                    habitId: historyEditor.habit.id,
                    status: historyStatus,
                    dateKey: historyEditor.cell.actionDateKey,
                    note: historyNote.trim() || undefined
                  });
                  setHistoryEditor(null);
                }}
              >
                Save check-in
              </Button>
            </div>
          </div>
        ) : null}
      </SheetScaffold>
    </div>
  );
}
