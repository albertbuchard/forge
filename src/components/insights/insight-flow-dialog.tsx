import { useEffect, useMemo, useState } from "react";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { EntityBadge } from "@/components/ui/entity-badge";
import { FieldHint } from "@/components/ui/info-tooltip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createInsightSchema, type CreateInsightInput } from "@/lib/schemas";
import type { EntityKind } from "@/lib/entity-visuals";

type InsightTargetKind =
  | "general"
  | "goal"
  | "project"
  | "task"
  | "trigger_report";

type InsightFlowValue = CreateInsightInput & {
  targetKind: InsightTargetKind;
};

export type InsightEntityCandidate = {
  entityType: Exclude<InsightTargetKind, "general">;
  entityId: string;
  kind: EntityKind;
  label: string;
  description?: string;
};

function buildInitialValue(
  initialValue: Partial<CreateInsightInput> | undefined,
  lockedEntity: InsightEntityCandidate | undefined
): InsightFlowValue {
  return {
    originType: initialValue?.originType ?? "user",
    originAgentId: initialValue?.originAgentId ?? "",
    originLabel: initialValue?.originLabel ?? "",
    entityType: lockedEntity?.entityType ?? initialValue?.entityType ?? "",
    entityId: lockedEntity?.entityId ?? initialValue?.entityId ?? "",
    timeframeLabel: initialValue?.timeframeLabel ?? "This week",
    title: initialValue?.title ?? "",
    summary: initialValue?.summary ?? "",
    recommendation: initialValue?.recommendation ?? "",
    rationale: initialValue?.rationale ?? "",
    confidence: initialValue?.confidence ?? 0.72,
    ctaLabel: initialValue?.ctaLabel ?? "Review insight",
    targetKind:
      lockedEntity?.entityType ??
      (initialValue?.entityType as InsightTargetKind | undefined) ??
      "general"
  };
}

export function InsightFlowDialog({
  open,
  onOpenChange,
  title = "Store insight",
  description = "Capture a clear observation, its recommendation, and where it belongs without dropping into a raw admin form.",
  eyebrow = "Insight",
  pending = false,
  submitLabel = "Store insight",
  initialValue,
  lockedEntity,
  entityCandidates = [],
  onSubmit
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  eyebrow?: string;
  pending?: boolean;
  submitLabel?: string;
  initialValue?: Partial<CreateInsightInput>;
  lockedEntity?: InsightEntityCandidate;
  entityCandidates?: InsightEntityCandidate[];
  onSubmit: (value: CreateInsightInput) => Promise<void>;
}) {
  const [value, setValue] = useState<InsightFlowValue>(() =>
    buildInitialValue(initialValue, lockedEntity)
  );
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(buildInitialValue(initialValue, lockedEntity));
      setSubmitError(null);
    }
  }, [initialValue, lockedEntity, open]);

  const availableKinds = useMemo(() => {
    const set = new Set<InsightTargetKind>(["general"]);
    entityCandidates.forEach((candidate) => set.add(candidate.entityType));
    if (lockedEntity) {
      set.add(lockedEntity.entityType);
    }
    return Array.from(set);
  }, [entityCandidates, lockedEntity]);

  const visibleCandidates = entityCandidates.filter(
    (candidate) => candidate.entityType === value.targetKind
  );

  const steps: Array<QuestionFlowStep<InsightFlowValue>> = [
    {
      id: "focus",
      eyebrow: "Focus",
      title: "Name the insight and place it in the right context",
      description:
        "Start with the main observation, then decide whether this belongs to a specific entity or should stay general.",
      render: (draft, patch) => (
        <>
          <FlowField
            label="Insight title"
            description="Write the main idea as a clear headline."
            labelHelp="The title should sound like the recommendation or realization you want to remember, not like an internal database field."
          >
            <Input
              value={draft.title}
              onChange={(event) => patch({ title: event.target.value })}
              placeholder="Weekly review needs a tighter end ritual"
            />
          </FlowField>
          <FlowField
            label="Timeframe"
            description="Keep the horizon short and readable."
          >
            <Input
              value={draft.timeframeLabel}
              onChange={(event) =>
                patch({ timeframeLabel: event.target.value })
              }
              placeholder="This week"
            />
          </FlowField>
          <FlowField
            label="Where should this insight live?"
            description="Use a specific entity when the insight is about one goal, project, task, or report. Keep it general when it applies to the wider system."
          >
            {lockedEntity ? (
              <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
                <EntityBadge
                  kind={lockedEntity.kind}
                  label={lockedEntity.label}
                />
                {lockedEntity.description ? (
                  <FieldHint className="mt-2">
                    {lockedEntity.description}
                  </FieldHint>
                ) : null}
              </div>
            ) : (
              <>
                <FlowChoiceGrid
                  value={draft.targetKind}
                  onChange={(nextKind) =>
                    patch({
                      targetKind: nextKind as InsightTargetKind,
                      entityType: nextKind === "general" ? "" : nextKind,
                      entityId: nextKind === "general" ? "" : ""
                    })
                  }
                  options={availableKinds.map((kind) => ({
                    value: kind,
                    label:
                      kind === "general"
                        ? "General insight"
                        : kind === "trigger_report"
                          ? "Report"
                          : kind.charAt(0).toUpperCase() + kind.slice(1),
                    description:
                      kind === "general"
                        ? "Store it in the broader insight feed."
                        : `Attach it to a specific ${kind === "trigger_report" ? "report" : kind}.`
                  }))}
                  columns={availableKinds.length >= 3 ? 3 : 2}
                />
                {draft.targetKind !== "general" ? (
                  visibleCandidates.length > 0 ? (
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {visibleCandidates.map((candidate) => {
                        const selected =
                          draft.entityType === candidate.entityType &&
                          draft.entityId === candidate.entityId;
                        return (
                          <button
                            key={`${candidate.entityType}:${candidate.entityId}`}
                            type="button"
                            className={`rounded-[22px] border px-4 py-4 text-left transition ${selected ? "border-[rgba(192,193,255,0.28)] bg-[rgba(192,193,255,0.14)] text-white" : "border-white/8 bg-white/[0.04] text-white/72 hover:bg-white/[0.07]"}`}
                            onClick={() =>
                              patch({
                                entityType: candidate.entityType,
                                entityId: candidate.entityId
                              })
                            }
                          >
                            <EntityBadge
                              kind={candidate.kind}
                              label={candidate.label}
                              compact
                            />
                            {candidate.description ? (
                              <div className="mt-2 text-sm leading-6 text-white/54">
                                {candidate.description}
                              </div>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <FieldHint className="mt-4">
                      No{" "}
                      {draft.targetKind === "trigger_report"
                        ? "reports"
                        : `${draft.targetKind}s`}{" "}
                      are ready to attach here yet.
                    </FieldHint>
                  )
                ) : null}
              </>
            )}
          </FlowField>
        </>
      )
    },
    {
      id: "observation",
      eyebrow: "Observation",
      title: "Capture what you are seeing clearly",
      description:
        "Keep the summary plain and useful. Add the why only if it helps the next action make sense.",
      render: (draft, patch) => (
        <>
          <FlowField
            label="Summary"
            description="Describe the pattern, problem, or opportunity in plain language."
            labelHelp="Write what is actually happening, not a slogan and not a long essay."
          >
            <Textarea
              value={draft.summary}
              onChange={(event) => patch({ summary: event.target.value })}
              placeholder="The weekly review loses energy because the close-out is vague, so finished work never turns into clear next moves."
            />
          </FlowField>
          <FlowField
            label="Why this matters"
            description="Optional context that helps explain the recommendation."
          >
            <Textarea
              value={draft.rationale}
              onChange={(event) => patch({ rationale: event.target.value })}
              placeholder="When the close-out is loose, important wins disappear from memory and the next week starts without momentum."
            />
          </FlowField>
        </>
      )
    },
    {
      id: "move",
      eyebrow: "Next move",
      title: "Turn the insight into a recommendation",
      description:
        "Finish with the recommendation you want the user or agent to actually act on.",
      render: (draft, patch) => (
        <>
          <FlowField
            label="Recommendation"
            description="Write the concrete move this insight points toward."
            labelHelp="A recommendation should be actionable. If the user read only this line, they should know what to do next."
          >
            <Textarea
              value={draft.recommendation}
              onChange={(event) =>
                patch({ recommendation: event.target.value })
              }
              placeholder="Add a fixed five-minute close-out block that turns finished tasks into one sentence of evidence and one next move."
            />
          </FlowField>
          <FlowField
            label="Confidence"
            description="Choose how strongly this recommendation holds up right now."
          >
            <FlowChoiceGrid
              value={String(draft.confidence)}
              onChange={(next) => patch({ confidence: Number(next) })}
              options={[
                {
                  value: "0.55",
                  label: "Low",
                  description: "Useful hunch, still early."
                },
                {
                  value: "0.72",
                  label: "Medium",
                  description: "Solid pattern, worth acting on."
                },
                {
                  value: "0.88",
                  label: "High",
                  description: "Clear enough to trust strongly."
                }
              ]}
              columns={3}
            />
          </FlowField>
        </>
      )
    }
  ];

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow={eyebrow}
      title={title}
      description={description}
      value={value}
      onChange={setValue}
      draftPersistenceKey="insights.flow"
      steps={steps}
      submitLabel={submitLabel}
      pending={pending}
      error={submitError}
      onSubmit={async () => {
        setSubmitError(null);
        const payload = createInsightSchema.safeParse({
          originType: value.originType,
          originAgentId: value.originAgentId,
          originLabel: value.originLabel,
          entityType: value.targetKind === "general" ? "" : value.entityType,
          entityId: value.targetKind === "general" ? "" : value.entityId,
          timeframeLabel: value.timeframeLabel,
          title: value.title,
          summary: value.summary,
          recommendation: value.recommendation,
          rationale: value.rationale,
          confidence: value.confidence,
          ctaLabel: value.ctaLabel
        });

        if (!payload.success) {
          setSubmitError(
            "This insight still needs a title, a summary, and a recommendation before it can be stored."
          );
          return;
        }

        try {
          await onSubmit(payload.data);
          onOpenChange(false);
        } catch (error) {
          setSubmitError(
            error instanceof Error
              ? error.message
              : "Unable to store this insight right now."
          );
        }
      }}
    />
  );
}
