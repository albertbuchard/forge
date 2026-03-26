import { useEffect, useState } from "react";
import { FlowChoiceGrid, FlowField, QuestionFlowDialog, type QuestionFlowStep } from "@/components/flows/question-flow-dialog";
import { EntityName } from "@/components/ui/entity-name";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { projectMutationSchema, type ProjectMutationInput } from "@/lib/schemas";
import type { Goal, ProjectSummary } from "@/lib/types";

export const defaultProjectValues: ProjectMutationInput = {
  goalId: "",
  title: "",
  description: "",
  status: "active",
  targetPoints: 240,
  themeColor: "#c0c1ff"
};

function projectToFormValues(project: ProjectSummary): ProjectMutationInput {
  return {
    goalId: project.goalId,
    title: project.title,
    description: project.description,
    status: project.status,
    targetPoints: project.targetPoints,
    themeColor: project.themeColor
  };
}

export function ProjectDialog({
  open,
  goals,
  editingProject,
  initialGoalId,
  onOpenChange,
  onSubmit
}: {
  open: boolean;
  goals: Goal[];
  editingProject: ProjectSummary | null;
  initialGoalId?: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: ProjectMutationInput, projectId?: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<ProjectMutationInput>(defaultProjectValues);
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
      editingProject
        ? projectToFormValues(editingProject)
        : {
            ...defaultProjectValues,
            goalId: initialGoalId ?? ""
          }
    );
  }, [editingProject, initialGoalId, open]);

  const steps: Array<QuestionFlowStep<ProjectMutationInput>> = [
    {
      id: "anchor",
      eyebrow: "Anchor",
      title: "Attach the project to the right goal",
      description: "Projects should serve one clear life-goal arc, so start by picking the direction this initiative belongs to.",
      render: (value, setValue) => (
        <FlowField label={t("common.dialogs.project.goal")} error={fieldErrors.goalId ?? null}>
          <div className="grid gap-3">
            {goals.map((goal) => {
              const selected = goal.id === value.goalId;
              return (
                <button
                  key={goal.id}
                  type="button"
                  className={`rounded-[22px] border px-4 py-4 text-left transition ${
                    selected ? "border-[rgba(192,193,255,0.28)] bg-[rgba(192,193,255,0.14)] text-white" : "border-white/8 bg-white/[0.04] text-white/72 hover:bg-white/[0.07]"
                  }`}
                  onClick={() => setValue({ goalId: goal.id })}
                >
                  <EntityName kind="goal" label={goal.title} className="max-w-full" />
                  <div className="mt-2 text-sm leading-6 text-white/54">{goal.description || "No strategic note attached yet."}</div>
                </button>
              );
            })}
          </div>
        </FlowField>
      )
    },
    {
      id: "shape",
      eyebrow: "Shape",
      title: "Name the initiative and the work it will make possible",
      description: "Keep the project concrete. The title should sound like something you can actually move forward this season.",
      render: (value, setValue) => (
        <>
          <FlowField label={t("common.dialogs.project.title")} error={fieldErrors.title ?? null}>
            <Input value={value.title} onChange={(event) => setValue({ title: event.target.value })} placeholder="Launch the new creative practice system" />
          </FlowField>
          <FlowField label={t("common.dialogs.project.descriptionLabel")}>
            <Textarea value={value.description} onChange={(event) => setValue({ description: event.target.value })} placeholder="Describe the outcome and the kind of work this project will contain." />
          </FlowField>
        </>
      )
    },
    {
      id: "signal",
      eyebrow: "Signal",
      title: "Set the project's posture and progress target",
      description: "This keeps the board, reward system, and detail views aligned without forcing you through a giant settings form.",
      render: (value, setValue) => (
        <>
          <FlowField label={t("common.dialogs.project.status")}>
            <FlowChoiceGrid
              value={value.status}
              onChange={(next) => setValue({ status: next as ProjectMutationInput["status"] })}
              options={[
                { value: "active", label: t("common.enums.projectStatus.active"), description: "Push this initiative now." },
                { value: "paused", label: t("common.enums.projectStatus.paused"), description: "Keep it available without active pressure." },
                { value: "completed", label: t("common.enums.projectStatus.completed"), description: "This initiative has landed." }
              ]}
            />
          </FlowField>
          <FlowField label={t("common.dialogs.project.targetXp")} error={fieldErrors.targetPoints ?? null}>
            <Input type="number" value={value.targetPoints} onChange={(event) => setValue({ targetPoints: Number(event.target.value) || 0 })} />
          </FlowField>
          <FlowField label={t("common.dialogs.project.themeColor")} error={fieldErrors.themeColor ?? null}>
            <div className="flex items-center gap-3 rounded-[22px] border border-white/8 bg-white/6 px-4 py-3">
              <input className="h-10 w-12 rounded-lg border border-white/10 bg-transparent" type="color" value={value.themeColor} onChange={(event) => setValue({ themeColor: event.target.value })} />
              <Input className="border-none bg-transparent px-0 py-0" value={value.themeColor} onChange={(event) => setValue({ themeColor: event.target.value })} />
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
      eyebrow={t("common.dialogs.project.eyebrow")}
      title={editingProject ? t("common.dialogs.project.editTitle") : t("common.dialogs.project.createTitle")}
      description={t("common.dialogs.project.description")}
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={editingProject ? t("common.dialogs.project.save") : t("common.dialogs.project.create")}
      error={submitError}
      onSubmit={async () => {
        setSubmitError(null);
        const parsed = projectMutationSchema.safeParse(draft);
        if (!parsed.success) {
          updateFieldErrors(parsed.error.flatten().fieldErrors);
          setSubmitError("A couple of answers still need attention before this project can be saved.");
          return;
        }

        setFieldErrors({});

        try {
          await onSubmit(parsed.data, editingProject?.id);
          onOpenChange(false);
        } catch (error) {
          setSubmitError(error instanceof Error ? error.message : t("common.dialogs.project.submitError"));
        }
      }}
    />
  );
}
