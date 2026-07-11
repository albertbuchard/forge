import { useEffect, useState } from "react";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";
import type { AiConnectorKind } from "@/lib/types";

export type WorkbenchCreateFlowInput = {
  title: string;
  description: string;
  kind: AiConnectorKind;
  homeSurfaceId?: string;
};

type WorkbenchCreateFlowDraft = {
  title: string;
  description: string;
  kind: AiConnectorKind;
  homeSurfaceId: string;
};

function initialDraft(
  kind: AiConnectorKind,
  preferredSurface?: string | null
): WorkbenchCreateFlowDraft {
  return {
    title: "",
    description: "",
    kind,
    homeSurfaceId: preferredSurface?.trim() ?? ""
  };
}

export function WorkbenchCreateFlowDialog({
  open,
  onOpenChange,
  initialKind,
  preferredSurface,
  pending,
  onSubmit
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialKind: AiConnectorKind;
  preferredSurface?: string | null;
  pending: boolean;
  onSubmit: (input: WorkbenchCreateFlowInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() =>
    initialDraft(initialKind, preferredSurface)
  );
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setDraft(initialDraft(initialKind, preferredSurface));
    setSubmitError(null);
  }, [initialKind, open, preferredSurface]);

  const steps: Array<QuestionFlowStep<WorkbenchCreateFlowDraft>> = [
    {
      id: "identity",
      eyebrow: "Flow identity",
      title: "What should this flow do?",
      description:
        "Name the reusable operation and choose whether each execution stands alone or continues as a conversation.",
      render: (value, setValue) => (
        <div className="grid gap-4">
          <FlowField label="Flow type">
            <FlowChoiceGrid
              value={value.kind}
              onChange={(kind) => setValue({ kind: kind as AiConnectorKind })}
              options={[
                {
                  value: "functor",
                  label: "Functor flow",
                  description: "Run one stable transformation at a time."
                },
                {
                  value: "chat",
                  label: "Chat flow",
                  description:
                    "Keep saved flow context across follow-up messages."
                }
              ]}
            />
          </FlowField>
          <FlowField label="Flow title">
            <Input
              autoFocus
              value={value.title}
              onChange={(event) => setValue({ title: event.target.value })}
              placeholder="Summarize weekly project risk"
            />
          </FlowField>
        </div>
      )
    },
    {
      id: "context",
      eyebrow: "Placement",
      title: "Where should this flow live?",
      description:
        "Add enough context to make the catalog entry understandable. A home surface is optional and does not change the flow contract.",
      render: (value, setValue) => (
        <div className="grid gap-4">
          <FlowField label="Description">
            <textarea
              rows={5}
              value={value.description}
              onChange={(event) =>
                setValue({ description: event.target.value })
              }
              placeholder="Explain the expected input, transformation, and useful output."
              className="w-full rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 py-3 text-sm text-[var(--ui-ink-strong)] outline-none transition placeholder:text-[var(--ui-ink-faint)] focus:border-[var(--ui-border-strong)]"
            />
          </FlowField>
          <FlowField
            label="Home surface"
            description="Optional existing Forge surface id, such as overview or projects."
          >
            <Input
              value={value.homeSurfaceId}
              onChange={(event) =>
                setValue({ homeSurfaceId: event.target.value })
              }
              placeholder="overview"
            />
          </FlowField>
        </div>
      )
    }
  ];

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Workbench"
      title="Create a flow"
      description="Define the catalog identity first. The graph editor opens after Forge creates the saved flow."
      value={draft}
      onChange={setDraft}
      draftPersistenceKey="workbench.flow.new"
      steps={steps}
      submitLabel="Create flow"
      pending={pending}
      pendingLabel="Creating"
      error={submitError}
      resolveContinueNudge={(stepId, value) =>
        stepId === "identity" && !value.title.trim()
          ? "Add a flow title before continuing."
          : null
      }
      onSubmit={async () => {
        const title = draft.title.trim();
        if (!title) {
          setSubmitError("Add a flow title before creating the flow.");
          return;
        }
        setSubmitError(null);
        try {
          await onSubmit({
            title,
            description: draft.description.trim(),
            kind: draft.kind,
            homeSurfaceId: draft.homeSurfaceId.trim() || undefined
          });
          onOpenChange(false);
        } catch (error) {
          setSubmitError(
            error instanceof Error
              ? error.message
              : "Forge could not create the flow. Try again."
          );
        }
      }}
    />
  );
}
