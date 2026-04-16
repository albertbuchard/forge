import { useEffect, useMemo, useState } from "react";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { EntityBadge } from "@/components/ui/entity-badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UserSelectField } from "@/components/ui/user-select-field";
import { formatOwnerSelectDefaultLabel } from "@/lib/user-ownership";
import { habitMutationSchema, type HabitMutationInput } from "@/lib/schemas";
import type {
  Behavior,
  BehaviorPattern,
  BeliefEntry,
  ModeProfile,
  PsycheValue,
  TriggerReport
} from "@/lib/psyche-types";
import type {
  DashboardGoal,
  Habit,
  ProjectSummary,
  Task,
  UserSummary
} from "@/lib/types";

export const defaultHabitValues: HabitMutationInput = {
  title: "",
  description: "",
  status: "active",
  userId: null,
  polarity: "positive",
  frequency: "daily",
  targetCount: 1,
  weekDays: [],
  linkedGoalIds: [],
  linkedProjectIds: [],
  linkedTaskIds: [],
  linkedValueIds: [],
  linkedPatternIds: [],
  linkedBehaviorIds: [],
  linkedBeliefIds: [],
  linkedModeIds: [],
  linkedReportIds: [],
  linkedBehaviorId: "",
  rewardXp: 12,
  penaltyXp: 8,
  generatedHealthEventTemplate: {
    enabled: false,
    workoutType: "workout",
    title: "",
    durationMinutes: 45,
    xpReward: 0,
    tags: [],
    links: [],
    notesTemplate: ""
  }
};

const WEEKDAY_OPTIONS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" }
] as const;

function habitToFormValues(habit: Habit): HabitMutationInput {
  return {
    title: habit.title,
    description: habit.description,
    status: habit.status,
    userId: habit.userId ?? null,
    polarity: habit.polarity,
    frequency: habit.frequency,
    targetCount: habit.targetCount,
    weekDays: habit.weekDays,
    linkedGoalIds: habit.linkedGoalIds,
    linkedProjectIds: habit.linkedProjectIds,
    linkedTaskIds: habit.linkedTaskIds,
    linkedValueIds: habit.linkedValueIds,
    linkedPatternIds: habit.linkedPatternIds,
    linkedBehaviorIds: habit.linkedBehaviorIds,
    linkedBeliefIds: habit.linkedBeliefIds,
    linkedModeIds: habit.linkedModeIds,
    linkedReportIds: habit.linkedReportIds,
    linkedBehaviorId: habit.linkedBehaviorId ?? "",
    rewardXp: habit.rewardXp,
    penaltyXp: habit.penaltyXp,
    generatedHealthEventTemplate: habit.generatedHealthEventTemplate
  };
}

export function HabitDialog({
  open,
  pending = false,
  editingHabit,
  values,
  patterns,
  behaviors,
  beliefs,
  modes,
  reports,
  goals,
  projects,
  tasks,
  users,
  defaultUserId = null,
  onOpenChange,
  onSubmit
}: {
  open: boolean;
  pending?: boolean;
  editingHabit: Habit | null;
  values: PsycheValue[];
  patterns: BehaviorPattern[];
  behaviors: Behavior[];
  beliefs: BeliefEntry[];
  modes: ModeProfile[];
  reports: TriggerReport[];
  goals: DashboardGoal[];
  projects: ProjectSummary[];
  tasks: Task[];
  users: UserSummary[];
  defaultUserId?: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: HabitMutationInput, habitId?: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<HabitMutationInput>(defaultHabitValues);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string | undefined>
  >({});

  useEffect(() => {
    if (!open) {
      return;
    }
    setDraft(
      editingHabit
        ? habitToFormValues(editingHabit)
        : { ...defaultHabitValues, userId: defaultUserId }
    );
    setSubmitError(null);
    setFieldErrors({});
  }, [defaultUserId, editingHabit, open]);

  const suggestedUser = users.find((user) => user.id === defaultUserId) ?? null;

  const behaviorOptions = useMemo(
    () =>
      behaviors
        .slice()
        .sort((left, right) => left.title.localeCompare(right.title)),
    [behaviors]
  );
  const syncLinkedBehaviorAlias = (nextBehaviorIds: string[]) => ({
    linkedBehaviorIds: nextBehaviorIds,
    linkedBehaviorId: nextBehaviorIds[0] ?? ""
  });

  const toggleId = (values: string[], id: string) =>
    values.includes(id)
      ? values.filter((entry) => entry !== id)
      : [...values, id];

  const steps: Array<QuestionFlowStep<HabitMutationInput>> = [
    {
      id: "intent",
      eyebrow: "Habit",
      title: "Name the recurring move",
      description:
        "Use habits for recurring commitments and recurring slips. Keep the title concrete so the daily check-in never needs interpretation.",
      render: (value, setValue) => (
        <>
          <FlowField label="Title" error={fieldErrors.title ?? null}>
            <Input
              value={value.title}
              onChange={(event) => setValue({ title: event.target.value })}
              placeholder="Train lower body"
            />
          </FlowField>
          <FlowField label="Description">
            <Textarea
              value={value.description}
              onChange={(event) =>
                setValue({ description: event.target.value })
              }
              placeholder="Write the habit description in Markdown. Define what counts, edge cases, and examples."
            />
          </FlowField>
          <UserSelectField
            value={value.userId}
            users={users}
            onChange={(userId) => setValue({ userId })}
            label="Owner user"
            defaultLabel={formatOwnerSelectDefaultLabel(suggestedUser)}
            help="Habits can be owned by humans or bots. When one scoped user is active, Forge uses that as the default."
          />
        </>
      )
    },
    {
      id: "shape",
      eyebrow: "Shape",
      title: "Set direction and cadence",
      description:
        "Forge uses polarity to decide whether doing the habit is good or bad, and cadence to know when it should show up.",
      render: (value, setValue) => (
        <>
          <FlowField label="Polarity">
            <FlowChoiceGrid
              value={value.polarity}
              onChange={(next) =>
                setValue({ polarity: next as HabitMutationInput["polarity"] })
              }
              options={[
                {
                  value: "positive",
                  label: "Positive",
                  description: "Doing it is aligned and should award XP."
                },
                {
                  value: "negative",
                  label: "Negative",
                  description: "Doing it is a slip and should cost XP."
                }
              ]}
              columns={2}
            />
          </FlowField>
          <FlowField label="Frequency">
            <FlowChoiceGrid
              value={value.frequency}
              onChange={(next) =>
                setValue({ frequency: next as HabitMutationInput["frequency"] })
              }
              options={[
                {
                  value: "daily",
                  label: "Daily",
                  description: "Track against each day."
                },
                {
                  value: "weekly",
                  label: "Weekly",
                  description: "Track only on the selected weekdays."
                }
              ]}
              columns={2}
            />
          </FlowField>
          {value.frequency === "weekly" ? (
            <FlowField label="Weekdays" error={fieldErrors.weekDays ?? null}>
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_OPTIONS.map((day) => {
                  const selected = value.weekDays.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      className={`rounded-full px-3 py-2 text-sm transition ${selected ? "bg-white/16 text-white" : "bg-white/6 text-white/58 hover:bg-white/10 hover:text-white"}`}
                      onClick={() =>
                        setValue({
                          weekDays: selected
                            ? value.weekDays.filter(
                                (entry) => entry !== day.value
                              )
                            : [...value.weekDays, day.value].sort()
                        })
                      }
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            </FlowField>
          ) : null}
          <FlowField label="Status">
            <FlowChoiceGrid
              value={value.status}
              onChange={(next) =>
                setValue({ status: next as HabitMutationInput["status"] })
              }
              options={[
                {
                  value: "active",
                  label: "Active",
                  description: "Show it in the daily operating flow."
                },
                {
                  value: "paused",
                  label: "Paused",
                  description: "Keep it visible but not currently due."
                },
                {
                  value: "archived",
                  label: "Archived",
                  description: "Keep the record but retire it from active work."
                }
              ]}
            />
          </FlowField>
        </>
      )
    },
    {
      id: "generation",
      eyebrow: "Generation",
      title: "Decide whether this habit should create a workout record",
      description:
        "Use this when a completed habit should generate a structured sports or recovery session in Forge, then reconcile with HealthKit later if the same session gets imported.",
      render: (value, setValue) => (
        <>
          <FlowField label="Generate workout record">
            <FlowChoiceGrid
              value={
                value.generatedHealthEventTemplate.enabled
                  ? "enabled"
                  : "disabled"
              }
              onChange={(next) =>
                setValue({
                  generatedHealthEventTemplate: {
                    ...value.generatedHealthEventTemplate,
                    enabled: next === "enabled"
                  }
                })
              }
              options={[
                {
                  value: "disabled",
                  label: "Disabled",
                  description: "This habit only affects the habit ledger."
                },
                {
                  value: "enabled",
                  label: "Enabled",
                  description:
                    "A completed check-in creates a workout or recovery session."
                }
              ]}
              columns={2}
            />
          </FlowField>
          {value.generatedHealthEventTemplate.enabled ? (
            <>
              <FlowField label="Workout type">
                <Input
                  value={value.generatedHealthEventTemplate.workoutType}
                  onChange={(event) =>
                    setValue({
                      generatedHealthEventTemplate: {
                        ...value.generatedHealthEventTemplate,
                        workoutType: event.target.value
                      }
                    })
                  }
                  placeholder="mobility, walk, strength, recovery"
                />
              </FlowField>
              <div className="grid gap-4 md:grid-cols-2">
                <FlowField label="Duration (minutes)">
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    value={value.generatedHealthEventTemplate.durationMinutes}
                    onChange={(event) =>
                      setValue({
                        generatedHealthEventTemplate: {
                          ...value.generatedHealthEventTemplate,
                          durationMinutes: Number(event.target.value) || 45
                        }
                      })
                    }
                  />
                </FlowField>
                <FlowField label="Workout XP">
                  <Input
                    type="number"
                    min={0}
                    max={500}
                    value={value.generatedHealthEventTemplate.xpReward}
                    onChange={(event) =>
                      setValue({
                        generatedHealthEventTemplate: {
                          ...value.generatedHealthEventTemplate,
                          xpReward: Number(event.target.value) || 0
                        }
                      })
                    }
                  />
                </FlowField>
              </div>
              <FlowField label="Generated session note">
                <Textarea
                  value={value.generatedHealthEventTemplate.notesTemplate}
                  onChange={(event) =>
                    setValue({
                      generatedHealthEventTemplate: {
                        ...value.generatedHealthEventTemplate,
                        notesTemplate: event.target.value
                      }
                    })
                  }
                  placeholder="Morning routine session generated from habit completion."
                />
              </FlowField>
            </>
          ) : null}
        </>
      )
    },
    {
      id: "links",
      eyebrow: "Links",
      title: "Connect the habit to real Forge work",
      description:
        "Link habits to the goals, projects, and tasks they support so they stay anchored in the same operating graph as everything else.",
      render: (value, setValue) => (
        <>
          <FlowField label="Goals">
            <div className="flex flex-wrap gap-2">
              {goals.map((goal) => {
                const selected = value.linkedGoalIds.includes(goal.id);
                return (
                  <button
                    key={goal.id}
                    type="button"
                    onClick={() =>
                      setValue({
                        linkedGoalIds: toggleId(value.linkedGoalIds, goal.id)
                      })
                    }
                  >
                    <EntityBadge
                      kind="goal"
                      label={goal.title}
                      gradient={selected}
                      className={selected ? "" : "opacity-75"}
                    />
                  </button>
                );
              })}
            </div>
          </FlowField>
          <FlowField label="Projects">
            <div className="flex flex-wrap gap-2">
              {projects.map((project) => {
                const selected = value.linkedProjectIds.includes(project.id);
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() =>
                      setValue({
                        linkedProjectIds: toggleId(
                          value.linkedProjectIds,
                          project.id
                        )
                      })
                    }
                  >
                    <EntityBadge
                      kind="project"
                      label={project.title}
                      gradient={selected}
                      className={selected ? "" : "opacity-75"}
                    />
                  </button>
                );
              })}
            </div>
          </FlowField>
          <FlowField label="Tasks">
            <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
              {tasks.map((task) => {
                const selected = value.linkedTaskIds.includes(task.id);
                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() =>
                      setValue({
                        linkedTaskIds: toggleId(value.linkedTaskIds, task.id)
                      })
                    }
                  >
                    <EntityBadge
                      kind="task"
                      label={task.title}
                      gradient={selected}
                      className={selected ? "" : "opacity-75"}
                      wrap
                    />
                  </button>
                );
              })}
            </div>
          </FlowField>
          <FlowField label="Values">
            <div className="flex flex-wrap gap-2">
              {values.map((valueEntry) => {
                const selected = value.linkedValueIds.includes(valueEntry.id);
                return (
                  <button
                    key={valueEntry.id}
                    type="button"
                    onClick={() =>
                      setValue({
                        linkedValueIds: toggleId(
                          value.linkedValueIds,
                          valueEntry.id
                        )
                      })
                    }
                  >
                    <EntityBadge
                      kind="value"
                      label={valueEntry.title}
                      gradient={selected}
                      className={selected ? "" : "opacity-75"}
                    />
                  </button>
                );
              })}
            </div>
          </FlowField>
          <FlowField label="Patterns">
            <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto">
              {patterns.map((pattern) => {
                const selected = value.linkedPatternIds.includes(pattern.id);
                return (
                  <button
                    key={pattern.id}
                    type="button"
                    onClick={() =>
                      setValue({
                        linkedPatternIds: toggleId(
                          value.linkedPatternIds,
                          pattern.id
                        )
                      })
                    }
                  >
                    <EntityBadge
                      kind="pattern"
                      label={pattern.title}
                      gradient={selected}
                      className={selected ? "" : "opacity-75"}
                      wrap
                    />
                  </button>
                );
              })}
            </div>
          </FlowField>
        </>
      )
    },
    {
      id: "reward",
      eyebrow: "Reward",
      title: "Link the behavior and XP logic",
      description:
        "Habits can point back to a Psyche behavior. Reward XP is granted for aligned outcomes; penalty XP is applied for misaligned ones.",
      render: (value, setValue) => (
        <>
          <FlowField label="Linked behavior">
            <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto">
              {behaviorOptions.map((behavior) => {
                const selected = value.linkedBehaviorIds.includes(behavior.id);
                return (
                  <button
                    key={behavior.id}
                    type="button"
                    onClick={() =>
                      setValue(
                        syncLinkedBehaviorAlias(
                          toggleId(value.linkedBehaviorIds, behavior.id)
                        )
                      )
                    }
                  >
                    <EntityBadge
                      kind="behavior"
                      label={behavior.title}
                      gradient={selected}
                      className={selected ? "" : "opacity-75"}
                      wrap
                    />
                  </button>
                );
              })}
            </div>
          </FlowField>
          <FlowField label="Beliefs">
            <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto">
              {beliefs.map((belief) => {
                const selected = value.linkedBeliefIds.includes(belief.id);
                return (
                  <button
                    key={belief.id}
                    type="button"
                    onClick={() =>
                      setValue({
                        linkedBeliefIds: toggleId(
                          value.linkedBeliefIds,
                          belief.id
                        )
                      })
                    }
                  >
                    <EntityBadge
                      kind="belief"
                      label={belief.statement}
                      gradient={selected}
                      className={selected ? "" : "opacity-75"}
                      wrap
                    />
                  </button>
                );
              })}
            </div>
          </FlowField>
          <FlowField label="Modes">
            <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto">
              {modes.map((mode) => {
                const selected = value.linkedModeIds.includes(mode.id);
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() =>
                      setValue({
                        linkedModeIds: toggleId(value.linkedModeIds, mode.id)
                      })
                    }
                  >
                    <EntityBadge
                      kind="mode"
                      label={mode.title}
                      gradient={selected}
                      className={selected ? "" : "opacity-75"}
                      wrap
                    />
                  </button>
                );
              })}
            </div>
          </FlowField>
          <FlowField label="Reports">
            <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto">
              {reports.map((report) => {
                const selected = value.linkedReportIds.includes(report.id);
                return (
                  <button
                    key={report.id}
                    type="button"
                    onClick={() =>
                      setValue({
                        linkedReportIds: toggleId(
                          value.linkedReportIds,
                          report.id
                        )
                      })
                    }
                  >
                    <EntityBadge
                      kind="report"
                      label={report.title}
                      gradient={selected}
                      className={selected ? "" : "opacity-75"}
                      wrap
                    />
                  </button>
                );
              })}
            </div>
          </FlowField>
          <div className="grid gap-4 sm:grid-cols-3">
            <FlowField
              label="Target count"
              error={fieldErrors.targetCount ?? null}
            >
              <Input
                type="number"
                value={value.targetCount}
                onChange={(event) =>
                  setValue({ targetCount: Number(event.target.value) || 1 })
                }
              />
            </FlowField>
            <FlowField label="Reward XP" error={fieldErrors.rewardXp ?? null}>
              <Input
                type="number"
                value={value.rewardXp}
                onChange={(event) =>
                  setValue({ rewardXp: Number(event.target.value) || 1 })
                }
              />
            </FlowField>
            <FlowField label="Penalty XP" error={fieldErrors.penaltyXp ?? null}>
              <Input
                type="number"
                value={value.penaltyXp}
                onChange={(event) =>
                  setValue({ penaltyXp: Number(event.target.value) || 1 })
                }
              />
            </FlowField>
          </div>
        </>
      )
    }
  ];

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Habit"
      title={editingHabit ? "Edit habit" : "Create habit"}
      description="Habits are recurring commitments or recurring slips with explicit XP consequences."
      value={draft}
      onChange={setDraft}
      draftPersistenceKey={
        editingHabit ? `habit.${editingHabit.id}` : "habit.new"
      }
      steps={steps}
      pending={pending}
      pendingLabel={editingHabit ? "Save habit" : "Create habit"}
      submitLabel={editingHabit ? "Save habit" : "Create habit"}
      error={submitError}
      onSubmit={async () => {
        setSubmitError(null);
        const parsed = habitMutationSchema.safeParse(draft);
        if (!parsed.success) {
          setFieldErrors(
            Object.fromEntries(
              Object.entries(parsed.error.flatten().fieldErrors).map(
                ([key, value]) => [key, value?.[0]]
              )
            )
          );
          setSubmitError("Some habit fields still need attention.");
          return;
        }
        setFieldErrors({});
        try {
          await onSubmit(parsed.data, editingHabit?.id);
          setDraft(defaultHabitValues);
          onOpenChange(false);
        } catch (error) {
          setSubmitError(
            error instanceof Error ? error.message : "Habit update failed."
          );
        }
      }}
    />
  );
}
