import { useEffect, useRef, useState } from "react";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { InlineNoteFields } from "@/components/notes/inline-note-fields";
import { EntityName } from "@/components/ui/entity-name";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UserSelectField } from "@/components/ui/user-select-field";
import { UserBadge } from "@/components/ui/user-badge";
import { useI18n } from "@/lib/i18n";
import {
  projectMutationSchema,
  type ProjectMutationInput
} from "@/lib/schemas";
import type { Goal, ProjectSummary, UserSummary } from "@/lib/types";
import { formatOwnerSelectDefaultLabel } from "@/lib/user-ownership";

export const defaultProjectValues: ProjectMutationInput = {
  goalId: "",
  title: "",
  description: "",
  status: "active",
  workflowStatus: "backlog",
  userId: null,
  assigneeUserIds: [],
  targetPoints: 240,
  themeColor: "#c0c1ff",
  productRequirementsDocument: "",
  notes: []
};

function projectToFormValues(project: ProjectSummary): ProjectMutationInput {
  return {
    goalId: project.goalId,
    title: project.title,
    description: project.description,
    status: project.status,
    workflowStatus: project.workflowStatus,
    userId: project.userId ?? null,
    assigneeUserIds: project.assigneeUserIds ?? [],
    targetPoints: project.targetPoints,
    themeColor: project.themeColor,
    productRequirementsDocument: project.productRequirementsDocument,
    notes: []
  };
}

export function ProjectDialog({
  open,
  goals,
  users,
  editingProject,
  initialGoalId,
  initialStepId,
  defaultUserId = null,
  onOpenChange,
  onSubmit
}: {
  open: boolean;
  goals: Goal[];
  users?: UserSummary[];
  editingProject: ProjectSummary | null;
  initialGoalId?: string | null;
  initialStepId?: string;
  defaultUserId?: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: ProjectMutationInput, projectId?: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const safeUsers = users ?? [];
  const [draft, setDraft] =
    useState<ProjectMutationInput>(defaultProjectValues);
  const [submitting, setSubmitting] = useState(false);
  const submitInFlightRef = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string | undefined>
  >({});
  const selectedGoal = goals.find((goal) => goal.id === draft.goalId) ?? null;
  const suggestedUser =
    safeUsers.find(
      (user) => user.id === (selectedGoal?.userId ?? defaultUserId)
    ) ?? null;

  const updateFieldErrors = (errors: Record<string, string[] | undefined>) => {
    setFieldErrors(
      Object.fromEntries(
        Object.entries(errors).map(([key, value]) => [key, value?.[0]])
      )
    );
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    setSubmitError(null);
    setFieldErrors({});
    setSubmitting(false);
    submitInFlightRef.current = false;
    setDraft(
      editingProject
        ? projectToFormValues(editingProject)
        : {
            ...defaultProjectValues,
            goalId: initialGoalId ?? "",
            userId:
              goals.find((goal) => goal.id === initialGoalId)?.userId ??
              defaultUserId
          }
    );
  }, [defaultUserId, editingProject, goals, initialGoalId, open]);

  const steps: Array<QuestionFlowStep<ProjectMutationInput>> = [
    {
      id: "anchor",
      eyebrow: "Anchor",
      title: "Attach the project to the right goal",
      description:
        "Projects should serve one clear life-goal arc, so start by picking the direction this initiative belongs to.",
      render: (value, setValue) => (
        <FlowField
          label={t("common.dialogs.project.goal")}
          error={fieldErrors.goalId ?? null}
        >
          <div className="grid min-w-0 max-w-full gap-3">
            {goals.length === 0 ? (
              <div
                role="status"
                className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4 text-sm leading-6 text-[var(--ui-ink-soft)]"
              >
                Create an active goal before adding a project. Projects need a
                goal anchor so their outcome, ownership, and execution history
                stay connected.
              </div>
            ) : null}
            {goals.map((goal) => {
              const selected = goal.id === value.goalId;
              return (
                <button
                  key={goal.id}
                  type="button"
                  className={`min-w-0 max-w-full overflow-hidden rounded-[22px] border px-4 py-4 text-left transition ${
                    selected
                      ? "border-[color-mix(in_srgb,var(--primary)_34%,var(--ui-border-subtle)_66%)] bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)]"
                      : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)]"
                  }`}
                  onClick={() => setValue({ goalId: goal.id })}
                >
                  <div className="flex min-w-0 max-w-full flex-wrap items-center justify-between gap-2">
                    <EntityName
                      kind="goal"
                      label={goal.title}
                      className="min-w-0 max-w-full"
                    />
                    <span className="min-w-0 max-w-full">
                      <UserBadge user={goal.user} compact />
                    </span>
                  </div>
                  <div className="mt-2 min-w-0 break-words text-sm leading-6 text-[var(--ui-ink-faint)]">
                    {goal.description || "No strategic note attached yet."}
                  </div>
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
      description:
        "Keep the project concrete. The title should sound like something you can actually move forward this season.",
      render: (value, setValue) => (
        <>
          <FlowField
            label={t("common.dialogs.project.title")}
            error={fieldErrors.title ?? null}
          >
            <Input
              value={value.title}
              onChange={(event) => setValue({ title: event.target.value })}
              placeholder="Launch the new creative practice system"
            />
          </FlowField>
          <FlowField label={t("common.dialogs.project.descriptionLabel")}>
            <Textarea
              value={value.description}
              onChange={(event) =>
                setValue({ description: event.target.value })
              }
              placeholder="Write the project description in Markdown. Use as much detail as the workstream needs."
            />
          </FlowField>
          <FlowField label="Product requirements document">
            <Textarea
              value={value.productRequirementsDocument}
              onChange={(event) =>
                setValue({
                  productRequirementsDocument: event.target.value
                })
              }
              placeholder="Capture the PRD in Markdown so the project view can present it clearly."
            />
          </FlowField>
          <UserSelectField
            value={value.userId}
            users={safeUsers}
            onChange={(userId) => setValue({ userId })}
            label="Owner user"
            defaultLabel={formatOwnerSelectDefaultLabel(suggestedUser)}
            help="Projects can intentionally cross user boundaries, but the linked goal owner is suggested by default."
          />
          <FlowField label="Assignees">
            <select
              multiple
              value={value.assigneeUserIds}
              onChange={(event) =>
                setValue({
                  assigneeUserIds: Array.from(
                    event.target.selectedOptions,
                    (option) => option.value
                  )
                })
              }
              className="min-h-28 rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-2 text-sm text-[var(--ui-ink-strong)] outline-none transition focus:border-[color-mix(in_srgb,var(--primary)_35%,var(--ui-border-strong)_65%)]"
            >
              {safeUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName} · {user.kind}
                </option>
              ))}
            </select>
          </FlowField>
        </>
      )
    },
    {
      id: "signal",
      eyebrow: "Signal",
      title: "Set the project's posture and progress target",
      description:
        "This keeps the board, reward system, and detail views aligned without forcing you through a giant settings form.",
      render: (value, setValue) => (
        <>
          <FlowField label={t("common.dialogs.project.status")}>
            <FlowChoiceGrid
              value={value.status}
              onChange={(next) =>
                setValue({ status: next as ProjectMutationInput["status"] })
              }
              options={[
                {
                  value: "active",
                  label: t("common.enums.projectStatus.active"),
                  description: "Push this initiative now."
                },
                {
                  value: "paused",
                  label: t("common.enums.projectStatus.paused"),
                  description: "Keep it available without active pressure."
                },
                {
                  value: "completed",
                  label: t("common.enums.projectStatus.completed"),
                  description: "This initiative has landed."
                }
              ]}
            />
          </FlowField>
          <FlowField label="Board workflow status">
            <FlowChoiceGrid
              value={value.workflowStatus}
              onChange={(next) =>
                setValue({
                  workflowStatus: next as ProjectMutationInput["workflowStatus"]
                })
              }
              options={[
                { value: "backlog", label: "Backlog" },
                { value: "focus", label: "Focus" },
                { value: "in_progress", label: "In progress" },
                { value: "blocked", label: "Blocked" },
                { value: "done", label: "Done" }
              ]}
            />
          </FlowField>
          <FlowField
            label={t("common.dialogs.project.targetXp")}
            error={fieldErrors.targetPoints ?? null}
          >
            <Input
              type="number"
              value={value.targetPoints}
              onChange={(event) =>
                setValue({ targetPoints: Number(event.target.value) || 0 })
              }
            />
          </FlowField>
          <FlowField
            label={t("common.dialogs.project.themeColor")}
            error={fieldErrors.themeColor ?? null}
          >
            <div className="flex items-center gap-3 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3">
              <input
                className="h-10 w-12 rounded-lg border border-[var(--ui-border-subtle)] bg-transparent"
                type="color"
                value={value.themeColor}
                onChange={(event) =>
                  setValue({ themeColor: event.target.value })
                }
              />
              <Input
                className="border-none bg-transparent px-0 py-0"
                value={value.themeColor}
                onChange={(event) =>
                  setValue({ themeColor: event.target.value })
                }
              />
            </div>
          </FlowField>
        </>
      )
    },
    {
      id: "notes",
      eyebrow: "Evidence",
      title: "Keep the creation context attached to the project from day one",
      description:
        "Use linked Markdown notes when the initiative needs setup context, assumptions, or a handoff summary right away.",
      render: (value, setValue) => (
        <FlowField label="Creation notes">
          <InlineNoteFields
            notes={value.notes}
            onChange={(notes) => setValue({ notes })}
            entityLabel="project"
          />
        </FlowField>
      )
    }
  ];

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow={t("common.dialogs.project.eyebrow")}
      title={
        editingProject
          ? t("common.dialogs.project.editTitle")
          : t("common.dialogs.project.createTitle")
      }
      description={t("common.dialogs.project.description")}
      value={draft}
      onChange={setDraft}
      draftPersistenceKey={
        editingProject ? `project.${editingProject.id}` : "project.new"
      }
      steps={steps}
      initialStepId={initialStepId}
      pending={submitting}
      pendingLabel={
        editingProject
          ? t("common.dialogs.project.save")
          : t("common.dialogs.project.create")
      }
      submitLabel={
        editingProject
          ? t("common.dialogs.project.save")
          : t("common.dialogs.project.create")
      }
      error={submitError}
      onSubmit={async () => {
        if (submitInFlightRef.current) {
          return;
        }
        setSubmitError(null);
        const parsed = projectMutationSchema.safeParse(draft);
        if (!parsed.success) {
          updateFieldErrors(parsed.error.flatten().fieldErrors);
          setSubmitError(
            "A couple of answers still need attention before this project can be saved."
          );
          return;
        }

        setFieldErrors({});
        submitInFlightRef.current = true;
        setSubmitting(true);

        try {
          await onSubmit(parsed.data, editingProject?.id);
          onOpenChange(false);
        } catch (error) {
          setSubmitError(
            error instanceof Error
              ? error.message
              : t("common.dialogs.project.submitError")
          );
        } finally {
          submitInFlightRef.current = false;
          setSubmitting(false);
        }
      }}
    />
  );
}
