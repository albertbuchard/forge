import { useEffect, useState } from "react";
import { FlowChoiceGrid, FlowField, QuestionFlowDialog, type QuestionFlowStep } from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { goalMutationSchema, type GoalMutationInput } from "@/lib/schemas";
import type { DashboardGoal, Tag } from "@/lib/types";

export const defaultGoalValues: GoalMutationInput = {
  title: "",
  description: "",
  horizon: "year",
  status: "active",
  targetPoints: 400,
  themeColor: "#c8a46b",
  tagIds: []
};

export function goalToFormValues(goal: DashboardGoal): GoalMutationInput {
  return {
    title: goal.title,
    description: goal.description,
    horizon: goal.horizon,
    status: goal.status,
    targetPoints: goal.targetPoints,
    themeColor: goal.themeColor,
    tagIds: goal.tagIds
  };
}

export function GoalDialog({
  open,
  pending = false,
  editingGoal,
  tags,
  onOpenChange,
  onSubmit
}: {
  open: boolean;
  pending?: boolean;
  editingGoal: DashboardGoal | null;
  tags: Tag[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: GoalMutationInput, goalId?: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<GoalMutationInput>(defaultGoalValues);
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
    setDraft(editingGoal ? goalToFormValues(editingGoal) : defaultGoalValues);
  }, [editingGoal, open]);

  const steps: Array<QuestionFlowStep<GoalMutationInput>> = [
    {
      id: "intent",
      eyebrow: "Direction",
      title: "Name the arc and why it matters",
      description: "Start with the long-horizon direction itself. We can refine cadence, tags, and visual tone after the intent is clear.",
      render: (value, setValue) => (
        <>
          <FlowField label={t("common.dialogs.goal.title")} error={fieldErrors.title ?? null}>
            <Input value={value.title} onChange={(event) => setValue({ title: event.target.value })} placeholder="Build a durable body and calm energy" />
          </FlowField>
          <FlowField label={t("common.dialogs.goal.descriptionLabel")}>
            <Textarea
              value={value.description}
              onChange={(event) => setValue({ description: event.target.value })}
              placeholder="Describe the direction in plain language so projects can attach to it later."
            />
          </FlowField>
        </>
      )
    },
    {
      id: "cadence",
      eyebrow: "Cadence",
      title: "Choose the horizon and current posture",
      description: "Keep this simple: how long does this arc run, and is it currently active, paused, or already complete?",
      render: (value, setValue) => (
        <>
          <FlowField label={t("common.dialogs.goal.horizon")}>
            <FlowChoiceGrid
              value={value.horizon}
              onChange={(next) => setValue({ horizon: next as GoalMutationInput["horizon"] })}
              options={[
                { value: "quarter", label: t("common.enums.goalHorizon.quarter"), description: "Tight strategic push for the coming months." },
                { value: "year", label: t("common.enums.goalHorizon.year"), description: "A full-cycle objective for this year." },
                { value: "lifetime", label: t("common.enums.goalHorizon.lifetime"), description: "A long-running life arc that projects can keep serving." }
              ]}
              columns={3}
            />
          </FlowField>
          <FlowField label={t("common.dialogs.goal.status")}>
            <FlowChoiceGrid
              value={value.status}
              onChange={(next) => setValue({ status: next as GoalMutationInput["status"] })}
              options={[
                { value: "active", label: t("common.enums.projectStatus.active"), description: "This is live right now." },
                { value: "paused", label: t("common.enums.projectStatus.paused"), description: "Keep it visible, but do not push it right now." },
                { value: "completed", label: t("common.enums.projectStatus.completed"), description: "You have already fulfilled this arc." }
              ]}
            />
          </FlowField>
        </>
      )
    },
    {
      id: "signal",
      eyebrow: "Signal",
      title: "Set the target and visual signature",
      description: "Give Forge enough signal to show progress and make this arc recognizable throughout the app.",
      render: (value, setValue) => (
        <>
          <FlowField label={t("common.dialogs.goal.targetXp")} error={fieldErrors.targetPoints ?? null}>
            <Input type="number" value={value.targetPoints} onChange={(event) => setValue({ targetPoints: Number(event.target.value) || 0 })} />
          </FlowField>
          <FlowField label={t("common.dialogs.goal.themeColor")} error={fieldErrors.themeColor ?? null}>
            <div className="flex items-center gap-3 rounded-[22px] border border-white/8 bg-white/6 px-4 py-3">
              <input className="h-10 w-12 rounded-lg border border-white/10 bg-transparent" type="color" value={value.themeColor} onChange={(event) => setValue({ themeColor: event.target.value })} />
              <Input className="border-none bg-transparent px-0 py-0" value={value.themeColor} onChange={(event) => setValue({ themeColor: event.target.value })} />
            </div>
          </FlowField>
          <FlowField label={t("common.dialogs.goal.tags")}>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
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
      eyebrow={t("common.dialogs.goal.eyebrow")}
      title={editingGoal ? t("common.dialogs.goal.editTitle") : t("common.dialogs.goal.createTitle")}
      description={t("common.dialogs.goal.description")}
      value={draft}
      onChange={setDraft}
      steps={steps}
      pending={pending}
      pendingLabel={editingGoal ? t("common.dialogs.goal.save") : t("common.dialogs.goal.create")}
      submitLabel={editingGoal ? t("common.dialogs.goal.save") : t("common.dialogs.goal.create")}
      error={submitError}
      onSubmit={async () => {
        setSubmitError(null);
        const parsed = goalMutationSchema.safeParse(draft);
        if (!parsed.success) {
          updateFieldErrors(parsed.error.flatten().fieldErrors);
          setSubmitError("Some answers still need attention before this goal arc can be saved.");
          return;
        }

        setFieldErrors({});

        try {
          await onSubmit(parsed.data, editingGoal?.id);
          setDraft(defaultGoalValues);
          onOpenChange(false);
        } catch (error) {
          setSubmitError(error instanceof Error ? error.message : t("common.dialogs.goal.submitError"));
        }
      }}
    />
  );
}
