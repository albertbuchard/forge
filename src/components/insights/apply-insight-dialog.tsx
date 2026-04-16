import { useEffect, useMemo, useState } from "react";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import {
  buildInsightGoalDefaults,
  buildInsightNoteMarkdown,
  buildInsightProjectDefaults,
  buildInsightTaskDefaults,
  getAvailableApplyKinds,
  getInsightSourceLink,
  getRecommendedApplyKind,
  type ApplyInsightKind
} from "@/components/insights/insight-apply-helpers";
import { EntityBadge } from "@/components/ui/entity-badge";
import { FieldHint } from "@/components/ui/info-tooltip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  goalMutationSchema,
  projectMutationSchema,
  quickTaskSchema,
  type GoalMutationInput,
  type ProjectMutationInput,
  type QuickTaskInput
} from "@/lib/schemas";
import type { Goal, Insight, ProjectSummary, Tag, Task } from "@/lib/types";

type ApplyInsightDraft = {
  kind: ApplyInsightKind;
  task: QuickTaskInput;
  project: ProjectMutationInput;
  goal: GoalMutationInput;
  noteMarkdown: string;
};

export type ApplyInsightSubmission =
  | { kind: "task"; input: QuickTaskInput }
  | { kind: "project"; input: ProjectMutationInput }
  | { kind: "goal"; input: GoalMutationInput }
  | { kind: "note"; input: { contentMarkdown: string } };

function buildInitialDraft(
  insight: Insight,
  goals: Goal[],
  projects: ProjectSummary[],
  tasks: Task[]
): ApplyInsightDraft {
  return {
    kind: getRecommendedApplyKind(insight, goals, projects),
    task: buildInsightTaskDefaults(insight, projects, tasks),
    project: buildInsightProjectDefaults(insight, goals, projects, tasks),
    goal: buildInsightGoalDefaults(insight),
    noteMarkdown: buildInsightNoteMarkdown(insight)
  };
}

function getApplyChoiceCopy(kind: ApplyInsightKind) {
  switch (kind) {
    case "task":
      return {
        label: "Task",
        description: "Turn the recommendation into one concrete next move."
      };
    case "project":
      return {
        label: "Project",
        description:
          "Start a larger initiative when the insight needs a stream of work."
      };
    case "goal":
      return {
        label: "Goal",
        description:
          "Capture a new long-term direction when this changes strategy."
      };
    case "note":
      return {
        label: "Linked note",
        description:
          "Attach the recommendation as durable evidence without creating new work."
      };
  }
}

export function ApplyInsightDialog({
  open,
  onOpenChange,
  insight,
  goals,
  projects,
  tasks,
  tags,
  pending = false,
  onSubmit
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  insight: Insight;
  goals: Goal[];
  projects: ProjectSummary[];
  tasks: Task[];
  tags: Tag[];
  pending?: boolean;
  onSubmit: (submission: ApplyInsightSubmission) => Promise<void>;
}) {
  const availableKinds = useMemo(
    () => getAvailableApplyKinds(insight, goals, projects),
    [goals, insight, projects]
  );
  const sourceLink = useMemo(() => getInsightSourceLink(insight), [insight]);
  const [draft, setDraft] = useState<ApplyInsightDraft>(() =>
    buildInitialDraft(insight, goals, projects, tasks)
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string | undefined>
  >({});

  useEffect(() => {
    if (!open) {
      return;
    }

    setDraft(buildInitialDraft(insight, goals, projects, tasks));
    setSubmitError(null);
    setFieldErrors({});
  }, [goals, insight, open, projects, tasks]);

  const selectedProject = draft.task.projectId
    ? (projects.find((project) => project.id === draft.task.projectId) ?? null)
    : null;

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    if (draft.task.goalId !== selectedProject.goalId) {
      setDraft((current) => ({
        ...current,
        task: {
          ...current.task,
          goalId: selectedProject.goalId
        }
      }));
    }
  }, [draft.task.goalId, selectedProject]);

  const selectedGoal = draft.project.goalId
    ? (goals.find((goal) => goal.id === draft.project.goalId) ?? null)
    : null;
  const linkedTargetLabel = useMemo(() => {
    if (!sourceLink) {
      return null;
    }

    switch (sourceLink.entityType) {
      case "goal":
        return (
          goals.find((goal) => goal.id === sourceLink.entityId)?.title ??
          "Linked goal"
        );
      case "project":
        return (
          projects.find((project) => project.id === sourceLink.entityId)
            ?.title ?? "Linked project"
        );
      case "task":
        return (
          tasks.find((task) => task.id === sourceLink.entityId)?.title ??
          "Linked task"
        );
      default:
        return `${sourceLink.entityType.replaceAll("_", " ")}`;
    }
  }, [goals, projects, sourceLink, tasks]);

  const steps: Array<QuestionFlowStep<ApplyInsightDraft>> = [
    {
      id: "kind",
      eyebrow: "Apply",
      title: "Choose what this insight should become",
      description:
        "Accept means you agree with the recommendation. Apply means you turn it into a real record right now.",
      render: (value, patch) => (
        <FlowField
          label="Apply as"
          description="Pick the kind of record Forge should create from this recommendation."
          hint="Task is the best default when the insight points to a concrete next move."
        >
          <FlowChoiceGrid
            value={value.kind}
            onChange={(next) => patch({ kind: next as ApplyInsightKind })}
            options={availableKinds.map((kind) => ({
              value: kind,
              ...getApplyChoiceCopy(kind)
            }))}
            columns={availableKinds.length >= 3 ? 3 : 2}
          />
        </FlowField>
      )
    },
    {
      id: "details",
      eyebrow: "Details",
      title: "Review the record Forge will create",
      description:
        "The fields are prefilled from the insight, but you can tighten them before saving.",
      render: (value, patch) => {
        if (value.kind === "task") {
          return (
            <>
              <FlowField label="Task title" error={fieldErrors.title ?? null}>
                <Input
                  value={value.task.title}
                  onChange={(event) =>
                    patch({
                      task: { ...value.task, title: event.target.value }
                    })
                  }
                  placeholder="Turn the recommendation into a task"
                />
              </FlowField>
              <FlowField label="Description">
                <Textarea
                  value={value.task.description}
                  onChange={(event) =>
                    patch({
                      task: { ...value.task, description: event.target.value }
                    })
                  }
                  placeholder="Add the operational context for this task."
                />
              </FlowField>
              <FlowField label="Project" error={fieldErrors.projectId ?? null}>
                <div className="grid gap-3">
                  {projects.map((project) => {
                    const selected = project.id === value.task.projectId;
                    return (
                      <button
                        key={project.id}
                        type="button"
                        className={`rounded-[22px] border px-4 py-4 text-left transition ${selected ? "border-[rgba(192,193,255,0.28)] bg-[rgba(192,193,255,0.14)] text-white" : "border-white/8 bg-white/[0.04] text-white/72 hover:bg-white/[0.07]"}`}
                        onClick={() =>
                          patch({
                            task: {
                              ...value.task,
                              projectId: project.id,
                              goalId: project.goalId
                            }
                          })
                        }
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium">{project.title}</span>
                          <EntityBadge
                            kind="goal"
                            label={project.goalTitle}
                            compact
                            gradient={false}
                          />
                        </div>
                        <div className="mt-2 text-sm leading-6 text-white/54">
                          {project.description ||
                            "No project note attached yet."}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </FlowField>
              <FlowField label="Owner" error={fieldErrors.owner ?? null}>
                <Input
                  value={value.task.owner}
                  onChange={(event) =>
                    patch({
                      task: { ...value.task, owner: event.target.value }
                    })
                  }
                  placeholder="Albert"
                />
              </FlowField>
              <FlowField label="Tags">
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => {
                    const selected = value.task.tagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        className={`rounded-full px-3 py-2 text-sm transition ${selected ? "bg-white/16 text-white" : "bg-white/6 text-white/58 hover:bg-white/10 hover:text-white"}`}
                        onClick={() =>
                          patch({
                            task: {
                              ...value.task,
                              tagIds: selected
                                ? value.task.tagIds.filter(
                                    (entry) => entry !== tag.id
                                  )
                                : [...value.task.tagIds, tag.id]
                            }
                          })
                        }
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </FlowField>
            </>
          );
        }

        if (value.kind === "project") {
          return (
            <>
              <FlowField
                label="Project title"
                error={fieldErrors.title ?? null}
              >
                <Input
                  value={value.project.title}
                  onChange={(event) =>
                    patch({
                      project: { ...value.project, title: event.target.value }
                    })
                  }
                  placeholder="Turn the insight into a project"
                />
              </FlowField>
              <FlowField label="Description">
                <Textarea
                  value={value.project.description}
                  onChange={(event) =>
                    patch({
                      project: {
                        ...value.project,
                        description: event.target.value
                      }
                    })
                  }
                  placeholder="Describe the initiative this insight points to."
                />
              </FlowField>
              <FlowField label="Goal" error={fieldErrors.goalId ?? null}>
                <div className="grid gap-3">
                  {goals.map((goal) => {
                    const selected = goal.id === value.project.goalId;
                    return (
                      <button
                        key={goal.id}
                        type="button"
                        className={`rounded-[22px] border px-4 py-4 text-left transition ${selected ? "border-[rgba(192,193,255,0.28)] bg-[rgba(192,193,255,0.14)] text-white" : "border-white/8 bg-white/[0.04] text-white/72 hover:bg-white/[0.07]"}`}
                        onClick={() =>
                          patch({
                            project: { ...value.project, goalId: goal.id }
                          })
                        }
                      >
                        <div className="font-medium">{goal.title}</div>
                        <div className="mt-2 text-sm leading-6 text-white/54">
                          {goal.description ||
                            "No strategic note attached yet."}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </FlowField>
              {selectedGoal ? (
                <FieldHint>
                  This project will sit under the “{selectedGoal.title}” goal.
                </FieldHint>
              ) : null}
            </>
          );
        }

        if (value.kind === "goal") {
          return (
            <>
              <FlowField label="Goal title" error={fieldErrors.title ?? null}>
                <Input
                  value={value.goal.title}
                  onChange={(event) =>
                    patch({
                      goal: { ...value.goal, title: event.target.value }
                    })
                  }
                  placeholder="Turn the insight into a life goal"
                />
              </FlowField>
              <FlowField label="Description">
                <Textarea
                  value={value.goal.description}
                  onChange={(event) =>
                    patch({
                      goal: { ...value.goal, description: event.target.value }
                    })
                  }
                  placeholder="Describe the strategic direction this insight suggests."
                />
              </FlowField>
              <FlowField label="Tags">
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => {
                    const selected = value.goal.tagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        className={`rounded-full px-3 py-2 text-sm transition ${selected ? "bg-white/16 text-white" : "bg-white/6 text-white/58 hover:bg-white/10 hover:text-white"}`}
                        onClick={() =>
                          patch({
                            goal: {
                              ...value.goal,
                              tagIds: selected
                                ? value.goal.tagIds.filter(
                                    (entry) => entry !== tag.id
                                  )
                                : [...value.goal.tagIds, tag.id]
                            }
                          })
                        }
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </FlowField>
            </>
          );
        }

        return (
          <>
            <FlowField
              label="Linked note"
              description="This stores the insight as durable Markdown evidence on the linked entity instead of creating a new work item."
              hint={
                linkedTargetLabel
                  ? `This note will attach to ${linkedTargetLabel}.`
                  : undefined
              }
            >
              <Textarea
                value={value.noteMarkdown}
                onChange={(event) =>
                  patch({ noteMarkdown: event.target.value })
                }
                placeholder="Write the applied note content in Markdown"
                className="min-h-64"
              />
            </FlowField>
            {linkedTargetLabel ? (
              <div className="rounded-[18px] border border-white/8 bg-white/[0.04] px-4 py-3 text-sm text-white/70">
                Linked target:{" "}
                <span className="font-medium text-white">
                  {linkedTargetLabel}
                </span>
              </div>
            ) : null}
          </>
        );
      }
    }
  ];

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Apply insight"
      title="Turn this insight into a real record"
      description="Apply should create something concrete inside Forge, not just change the status label."
      value={draft}
      onChange={setDraft}
      draftPersistenceKey="insights.apply"
      steps={steps}
      submitLabel="Apply insight"
      pending={pending}
      error={submitError}
      onSubmit={async () => {
        setSubmitError(null);
        setFieldErrors({});

        try {
          if (draft.kind === "task") {
            const parsed = quickTaskSchema.safeParse(draft.task);
            if (!parsed.success) {
              setFieldErrors(
                Object.fromEntries(
                  Object.entries(parsed.error.flatten().fieldErrors).map(
                    ([key, value]) => [key, value?.[0]]
                  )
                )
              );
              setSubmitError(
                "This applied task still needs a valid title, project, and owner."
              );
              return;
            }
            await onSubmit({ kind: "task", input: parsed.data });
            onOpenChange(false);
            return;
          }

          if (draft.kind === "project") {
            const parsed = projectMutationSchema.safeParse(draft.project);
            if (!parsed.success) {
              setFieldErrors(
                Object.fromEntries(
                  Object.entries(parsed.error.flatten().fieldErrors).map(
                    ([key, value]) => [key, value?.[0]]
                  )
                )
              );
              setSubmitError(
                "This applied project still needs a valid title and goal."
              );
              return;
            }
            await onSubmit({ kind: "project", input: parsed.data });
            onOpenChange(false);
            return;
          }

          if (draft.kind === "goal") {
            const parsed = goalMutationSchema.safeParse(draft.goal);
            if (!parsed.success) {
              setFieldErrors(
                Object.fromEntries(
                  Object.entries(parsed.error.flatten().fieldErrors).map(
                    ([key, value]) => [key, value?.[0]]
                  )
                )
              );
              setSubmitError(
                "This applied goal still needs a valid title and target."
              );
              return;
            }
            await onSubmit({ kind: "goal", input: parsed.data });
            onOpenChange(false);
            return;
          }

          if (!draft.noteMarkdown.trim()) {
            setSubmitError(
              "The linked note needs Markdown content before it can be saved."
            );
            return;
          }

          if (!sourceLink) {
            setSubmitError(
              "This insight is not attached to a specific entity yet, so Forge cannot place a linked note for it."
            );
            return;
          }

          await onSubmit({
            kind: "note",
            input: {
              contentMarkdown: draft.noteMarkdown.trim()
            }
          });
          onOpenChange(false);
        } catch (error) {
          setSubmitError(
            error instanceof Error
              ? error.message
              : "Unable to apply this insight right now."
          );
        }
      }}
    />
  );
}
