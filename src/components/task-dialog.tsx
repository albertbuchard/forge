import { useEffect, useMemo, useState } from "react";
import { FlowChoiceGrid, FlowField, QuestionFlowDialog, type QuestionFlowStep } from "@/components/flows/question-flow-dialog";
import { EntityBadge } from "@/components/ui/entity-badge";
import { EntityName } from "@/components/ui/entity-name";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { quickTaskSchema, type QuickTaskInput } from "@/lib/schemas";
import type { Goal, ProjectSummary, Tag, Task } from "@/lib/types";

export const defaultTaskValues: QuickTaskInput = {
  title: "",
  description: "",
  owner: "Albert",
  goalId: "",
  projectId: "",
  priority: "medium",
  status: "focus",
  effort: "deep",
  energy: "steady",
  dueDate: "",
  points: 60,
  tagIds: []
};

function taskToFormValues(task: Task): QuickTaskInput {
  return {
    title: task.title,
    description: task.description,
    owner: task.owner,
    goalId: task.goalId ?? "",
    projectId: task.projectId ?? "",
    priority: task.priority,
    status: task.status,
    effort: task.effort,
    energy: task.energy,
    dueDate: task.dueDate ?? "",
    points: task.points,
    tagIds: task.tagIds
  };
}

export function TaskDialog({
  open,
  goals,
  projects,
  tags,
  editingTask,
  initialProjectId,
  onOpenChange,
  onSubmit
}: {
  open: boolean;
  goals: Goal[];
  projects: ProjectSummary[];
  tags: Tag[];
  editingTask: Task | null;
  initialProjectId?: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: QuickTaskInput, taskId?: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const safeGoals = goals ?? [];
  const safeProjects = projects ?? [];
  const safeTags = tags ?? [];
  const [draft, setDraft] = useState<QuickTaskInput>(defaultTaskValues);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});

  const updateFieldErrors = (errors: Record<string, string[] | undefined>) => {
    setFieldErrors(Object.fromEntries(Object.entries(errors).map(([key, value]) => [key, value?.[0]])));
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    setSubmitError(null);
    setFieldErrors({});

    setDraft(
      editingTask
        ? taskToFormValues(editingTask)
        : {
            ...defaultTaskValues,
            projectId: initialProjectId ?? "",
            goalId: safeProjects.find((project) => project.id === initialProjectId)?.goalId ?? ""
          }
    );
  }, [editingTask, initialProjectId, open, safeProjects]);

  const selectedProject = useMemo(
    () => safeProjects.find((project) => project.id === draft.projectId) ?? null,
    [draft.projectId, safeProjects]
  );

  useEffect(() => {
    if (!selectedProject) {
      return;
    }
    if (draft.goalId !== selectedProject.goalId) {
      setDraft((current) => ({ ...current, goalId: selectedProject.goalId }));
    }
  }, [draft.goalId, selectedProject]);

  const steps: Array<QuestionFlowStep<QuickTaskInput>> = [
    {
      id: "anchor",
      eyebrow: "Placement",
      title: "Choose where this task belongs",
      description: "Link the task to the right project so the board, life goal, and rewards stay connected.",
      render: (value, setValue) => (
        <>
          <FlowField
            label={t("common.dialogs.task.project")}
            labelHelp="Projects are the main home for tasks. Pick the stream of work this task belongs to."
            error={fieldErrors.projectId ?? null}
          >
            <div className="grid gap-3">
              {safeProjects.map((project) => {
                const selected = project.id === value.projectId;
                return (
                  <button
                    key={project.id}
                    type="button"
                    className={`rounded-[22px] border px-4 py-4 text-left transition ${
                      selected ? "border-[rgba(192,193,255,0.28)] bg-[rgba(192,193,255,0.14)] text-white" : "border-white/8 bg-white/[0.04] text-white/72 hover:bg-white/[0.07]"
                    }`}
                  onClick={() => setValue({ projectId: project.id, goalId: project.goalId })}
                >
                  <div className="flex items-center justify-between gap-3">
                    <EntityName kind="project" label={project.title} className="min-w-0" showIcon={false} />
                    <EntityBadge kind="goal" label={project.goalTitle} compact gradient={false} />
                  </div>
                  <div className="mt-2 text-sm leading-6 text-white/54">{project.description}</div>
                </button>
                );
              })}
            </div>
          </FlowField>
          <FlowField
            label={t("common.dialogs.task.goal")}
            labelHelp="The life goal is shown automatically from the project so you can still see the bigger reason this task matters."
          >
            <Input readOnly value={selectedProject ? safeGoals.find((goal) => goal.id === selectedProject.goalId)?.title ?? "" : ""} placeholder="The linked life goal will appear here." />
          </FlowField>
        </>
      )
    },
    {
      id: "shape",
      eyebrow: "Shape",
      title: "Define the next concrete move",
      description: "Keep the task small enough to be actionable and strong enough to clearly move the project forward.",
      render: (value, setValue) => (
        <>
          <FlowField label={t("common.dialogs.task.title")} error={fieldErrors.title ?? null}>
            <Input value={value.title} onChange={(event) => setValue({ title: event.target.value })} placeholder="Draft the first mode atlas sketch" />
          </FlowField>
          <FlowField label={t("common.dialogs.task.descriptionLabel")}>
            <Textarea value={value.description} onChange={(event) => setValue({ description: event.target.value })} placeholder="Describe the outcome or boundary conditions for this move." />
          </FlowField>
          <FlowField label={t("common.dialogs.task.owner")} labelHelp="The owner is the person or role expected to carry this task." error={fieldErrors.owner ?? null}>
            <Input value={value.owner} onChange={(event) => setValue({ owner: event.target.value })} placeholder="Albert" />
          </FlowField>
        </>
      )
    },
    {
      id: "execution",
      eyebrow: "Execution",
      title: "Set priority, status, effort, and energy",
      description: "This is the minimum the execution engine needs in order to place the task well and show the right next move.",
      render: (value, setValue) => (
        <>
          <FlowField label={t("common.dialogs.task.priority")} labelHelp="Priority controls how strongly Forge should surface this task in the board and daily views.">
            <FlowChoiceGrid
              value={value.priority}
              onChange={(next) => setValue({ priority: next as QuickTaskInput["priority"] })}
              options={[
                { value: "low", label: t("common.enums.priority.low") },
                { value: "medium", label: t("common.enums.priority.medium") },
                { value: "high", label: t("common.enums.priority.high") },
                { value: "critical", label: t("common.enums.priority.critical") }
              ]}
            />
          </FlowField>
          <FlowField label={t("common.dialogs.task.status")} labelHelp="Status tells Forge whether the task is waiting, ready for focus, active, blocked, or done.">
            <FlowChoiceGrid
              value={value.status}
              onChange={(next) => setValue({ status: next as QuickTaskInput["status"] })}
              options={[
                { value: "backlog", label: t("common.enums.taskStatus.backlog") },
                { value: "focus", label: t("common.enums.taskStatus.focus") },
                { value: "in_progress", label: t("common.enums.taskStatus.in_progress") },
                { value: "blocked", label: t("common.enums.taskStatus.blocked") }
              ]}
            />
          </FlowField>
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label={t("common.dialogs.task.effort")} labelHelp="Effort describes how much concentration and time this task usually needs.">
              <FlowChoiceGrid
                value={value.effort}
                onChange={(next) => setValue({ effort: next as QuickTaskInput["effort"] })}
                options={[
                  { value: "light", label: t("common.enums.effort.light") },
                  { value: "deep", label: t("common.enums.effort.deep") },
                  { value: "marathon", label: t("common.enums.effort.marathon") }
                ]}
              />
            </FlowField>
            <FlowField label={t("common.dialogs.task.energy")} labelHelp="Energy helps you match this task to a low-energy, steady, or high-energy moment.">
              <FlowChoiceGrid
                value={value.energy}
                onChange={(next) => setValue({ energy: next as QuickTaskInput["energy"] })}
                options={[
                  { value: "low", label: t("common.enums.energy.low") },
                  { value: "steady", label: t("common.enums.energy.steady") },
                  { value: "high", label: t("common.enums.energy.high") }
                ]}
              />
            </FlowField>
          </div>
        </>
      )
    },
    {
      id: "signal",
      eyebrow: "Reward and timing",
      title: "Set the reward and timing details",
      description: "This keeps the daily surfaces honest without forcing you through a bloated last-mile form.",
      render: (value, setValue) => (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label={t("common.dialogs.task.xp")} labelHelp="XP is the reward weight for finishing this task. Higher XP should mean more meaningful work." error={fieldErrors.points ?? null}>
              <Input type="number" value={value.points} onChange={(event) => setValue({ points: Number(event.target.value) || 0 })} placeholder="60" />
            </FlowField>
            <FlowField label={t("common.dialogs.task.dueDate")} labelHelp="Only add a due date when timing really matters for this task.">
              <Input type="date" value={value.dueDate} onChange={(event) => setValue({ dueDate: event.target.value })} />
            </FlowField>
          </div>
          <FlowField label={t("common.dialogs.task.tags")}>
            <div className="flex flex-wrap gap-2">
              {safeTags.map((tag) => {
                const selected = value.tagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    className={`rounded-full px-3 py-2 text-sm transition ${selected ? "bg-white/16 text-white" : "bg-white/6 text-white/58 hover:bg-white/10 hover:text-white"}`}
                    onClick={() =>
                      setValue({
                        tagIds: selected ? value.tagIds.filter((entry) => entry !== tag.id) : [...value.tagIds, tag.id]
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
      )
    }
  ];

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow={t("common.dialogs.task.eyebrow")}
      title={editingTask ? t("common.dialogs.task.editTitle") : t("common.dialogs.task.createTitle")}
      description={t("common.dialogs.task.description")}
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={editingTask ? t("common.dialogs.task.save") : t("common.dialogs.task.create")}
      error={submitError}
      onSubmit={async () => {
        setSubmitError(null);
        const parsed = quickTaskSchema.safeParse(draft);
        if (!parsed.success) {
          updateFieldErrors(parsed.error.flatten().fieldErrors);
          setSubmitError("A few task details still need attention before this move can be saved.");
          return;
        }

        setFieldErrors({});

        try {
          await onSubmit(parsed.data, editingTask?.id);
          onOpenChange(false);
        } catch (error) {
          setSubmitError(error instanceof Error ? error.message : "Unable to save this task right now.");
        }
      }}
    />
  );
}
