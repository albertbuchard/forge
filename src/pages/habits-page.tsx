import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CircleAlert, ShieldBan, Sparkles, Trash2 } from "lucide-react";
import { EntityNoteCountLink } from "@/components/notes/entity-note-count-link";
import { PageHero } from "@/components/shell/page-hero";
import { HabitDialog } from "@/components/habit-dialog";
import { useForgeShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/page-state";
import { EntityName } from "@/components/ui/entity-name";
import { createHabit, createHabitCheckIn, deleteHabit, getPsycheOverview, listHabits, patchHabit } from "@/lib/api";
import type { HabitMutationInput } from "@/lib/schemas";
import type { Habit } from "@/lib/types";
import { ForgeApiError } from "@/lib/api-error";
import { getEntityNotesSummary } from "@/lib/note-helpers";
import { cn } from "@/lib/utils";
import { useSearchParams } from "react-router-dom";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function formatHabitCadence(habit: Habit) {
  if (habit.frequency === "daily") {
    return `${habit.targetCount}x daily`;
  }
  return `${habit.targetCount}x weekly · ${habit.weekDays.map((day) => WEEKDAY_LABELS[day]).join(", ")}`;
}

export function HabitsPage() {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const habitsQuery = useQuery({
    queryKey: ["forge-habits"],
    queryFn: async () => (await listHabits()).habits
  });
  const psycheOverviewQuery = useQuery({
    queryKey: ["forge-psyche-overview"],
    queryFn: async () => (await getPsycheOverview()).overview
  });

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setEditingHabit(null);
      setDialogOpen(true);
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete("create");
        return next;
      }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const refreshHabits = async () => {
    await queryClient.invalidateQueries({ queryKey: ["forge-habits"] });
    await shell.refresh();
  };

  const saveHabitMutation = useMutation({
    mutationFn: async ({ input, habitId }: { input: HabitMutationInput; habitId?: string }) =>
      habitId ? (await patchHabit(habitId, input)).habit : (await createHabit(input)).habit,
    onSuccess: async () => {
      setErrorMessage(null);
      await refreshHabits();
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Habit save failed.");
    }
  });

  const checkInMutation = useMutation({
    mutationFn: async ({ habitId, status }: { habitId: string; status: "done" | "missed" }) =>
      createHabitCheckIn(habitId, { status }),
    onSuccess: async () => {
      setErrorMessage(null);
      await refreshHabits();
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Habit check-in failed.");
    }
  });

  const deleteHabitMutation = useMutation({
    mutationFn: async (habitId: string) => deleteHabit(habitId),
    onSuccess: async () => {
      setErrorMessage(null);
      await refreshHabits();
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Habit delete failed.");
    }
  });

  const activeHabits = useMemo(() => (habitsQuery.data ?? []).filter((habit) => habit.status !== "archived"), [habitsQuery.data]);
  const dueHabits = useMemo(() => activeHabits.filter((habit) => habit.dueToday), [activeHabits]);

  if (habitsQuery.error) {
    throw habitsQuery.error;
  }

  return (
    <div className="grid gap-5">
      <PageHero
        entityKind="habit"
        title={<EntityName kind="habit" label="Habits" variant="heading" size="lg" />}
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
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Due today</div>
          <div className="mt-3 font-display text-4xl text-[var(--primary)]">{dueHabits.length}</div>
          <div className="mt-2 text-sm text-white/58">Habits that still need a check-in today.</div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Best streak</div>
          <div className="mt-3 font-display text-4xl text-white">{Math.max(0, ...activeHabits.map((habit) => habit.streakCount))}</div>
          <div className="mt-2 text-sm text-white/58">Longest current aligned streak across active habits.</div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">Average alignment</div>
          <div className="mt-3 font-display text-4xl text-white">
            {activeHabits.length > 0 ? Math.round(activeHabits.reduce((total, habit) => total + habit.completionRate, 0) / activeHabits.length) : 0}%
          </div>
          <div className="mt-2 text-sm text-white/58">Share of recent habit check-ins that matched the intended direction.</div>
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
          {activeHabits.map((habit) => (
            <Card key={habit.id} className={cn("overflow-hidden", habit.dueToday && "border-teal-300/20 shadow-[0_0_0_1px_rgba(45,212,191,0.12)]")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <EntityName kind="habit" label={habit.title} variant="heading" size="sm" />
                    <Badge className="bg-white/[0.08] text-white/72">{habit.status}</Badge>
                    <Badge className={habit.polarity === "positive" ? "bg-emerald-400/12 text-emerald-200" : "bg-rose-400/12 text-rose-200"}>
                      {habit.polarity === "positive" ? "Positive" : "Negative"}
                    </Badge>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-white/60">{habit.description || "No extra notes yet."}</p>
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase tracking-[0.16em] text-white/35">Alignment</div>
                  <div className="mt-1 text-lg font-semibold text-white">{habit.completionRate}%</div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Badge className="bg-white/[0.08] text-white/72">
                  <CalendarDays className="mr-1 size-3.5" />
                  {formatHabitCadence(habit)}
                </Badge>
                <Badge className="bg-white/[0.08] text-white/72">Streak {habit.streakCount}</Badge>
                <Badge className="bg-white/[0.08] text-white/72">
                  {habit.polarity === "positive" ? `+${habit.rewardXp} XP done` : `+${habit.rewardXp} XP resisted`}
                </Badge>
                <Badge className="bg-white/[0.08] text-white/72">
                  {habit.polarity === "positive" ? `-${habit.penaltyXp} XP missed` : `-${habit.penaltyXp} XP performed`}
                </Badge>
                {habit.linkedBehaviorTitles.slice(0, 2).map((behaviorTitle) => (
                  <Badge key={behaviorTitle} className="bg-orange-400/12 text-orange-100">
                    <ShieldBan className="mr-1 size-3.5" />
                    {behaviorTitle}
                  </Badge>
                ))}
                {habit.linkedGoalIds.slice(0, 2).map((goalId) => {
                  const goal = shell.snapshot.goals.find((entry) => entry.id === goalId);
                  return goal ? (
                    <Badge key={goal.id} className="bg-amber-400/12 text-amber-100">
                      Goal · {goal.title}
                    </Badge>
                  ) : null;
                })}
                {habit.linkedProjectIds.slice(0, 2).map((projectId) => {
                  const project = shell.snapshot.dashboard.projects.find((entry) => entry.id === projectId);
                  return project ? (
                    <Badge key={project.id} className="bg-sky-400/12 text-sky-100">
                      Project · {project.title}
                    </Badge>
                  ) : null;
                })}
                {habit.linkedTaskIds.slice(0, 2).map((taskId) => {
                  const task = shell.snapshot.tasks.find((entry) => entry.id === taskId);
                  return task ? (
                    <Badge key={task.id} className="bg-indigo-400/12 text-indigo-100">
                      Task · {task.title}
                    </Badge>
                  ) : null;
                })}
                {habit.linkedValueIds.slice(0, 2).map((valueId) => {
                  const valueEntry = psycheOverviewQuery.data?.values.find((entry) => entry.id === valueId);
                  return valueEntry ? (
                    <Badge key={valueEntry.id} className="bg-emerald-400/12 text-emerald-100">
                      Value · {valueEntry.title}
                    </Badge>
                  ) : null;
                })}
                {habit.linkedPatternIds.slice(0, 2).map((patternId) => {
                  const pattern = psycheOverviewQuery.data?.patterns.find((entry) => entry.id === patternId);
                  return pattern ? (
                    <Badge key={pattern.id} className="bg-cyan-400/12 text-cyan-100">
                      Pattern · {pattern.title}
                    </Badge>
                  ) : null;
                })}
                {habit.linkedBeliefIds.slice(0, 2).map((beliefId) => {
                  const belief = psycheOverviewQuery.data?.beliefs.find((entry) => entry.id === beliefId);
                  return belief ? (
                    <Badge key={belief.id} className="bg-rose-400/12 text-rose-100">
                      Belief · {belief.statement}
                    </Badge>
                  ) : null;
                })}
                {habit.linkedModeIds.slice(0, 2).map((modeId) => {
                  const mode = psycheOverviewQuery.data?.modes.find((entry) => entry.id === modeId);
                  return mode ? (
                    <Badge key={mode.id} className="bg-violet-400/12 text-violet-100">
                      Mode · {mode.title}
                    </Badge>
                  ) : null;
                })}
                {habit.linkedReportIds.slice(0, 2).map((reportId) => {
                  const report = psycheOverviewQuery.data?.reports.find((entry) => entry.id === reportId);
                  return report ? (
                    <Badge key={report.id} className="bg-fuchsia-400/12 text-fuchsia-100">
                      Report · {report.title}
                    </Badge>
                  ) : null;
                })}
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
                <div className="text-sm text-white/58">
                  {habit.lastCheckInAt
                    ? `Last check-in ${habit.lastCheckInStatus === "done" ? "marked done" : "marked missed"} on ${habit.lastCheckInAt.slice(0, 10)}.`
                    : "No check-ins recorded yet."}
                  <div className="mt-3">
                    <EntityNoteCountLink
                      entityType="habit"
                      entityId={habit.id}
                      count={getEntityNotesSummary(shell.snapshot.dashboard.notesSummaryByEntity, "habit", habit.id).count}
                    />
                  </div>
                </div>
                <Button
                  variant={habit.polarity === "positive" ? "primary" : "secondary"}
                  disabled={checkInMutation.isPending}
                  onClick={() => void checkInMutation.mutateAsync({ habitId: habit.id, status: "done" })}
                >
                  {habit.polarity === "positive" ? "Done" : "Performed"}
                </Button>
                <Button
                  variant={habit.polarity === "negative" ? "primary" : "secondary"}
                  disabled={checkInMutation.isPending}
                  onClick={() => void checkInMutation.mutateAsync({ habitId: habit.id, status: "missed" })}
                >
                  {habit.polarity === "positive" ? "Missed" : "Resisted"}
                </Button>
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="secondary"
                    disabled={saveHabitMutation.isPending}
                    onClick={() => {
                      setEditingHabit(habit);
                      setDialogOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={deleteHabitMutation.isPending}
                    onClick={() => {
                      if (!window.confirm(`Delete habit "${habit.title}"?`)) {
                        return;
                      }
                      void deleteHabitMutation.mutateAsync(habit.id);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
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
    </div>
  );
}
