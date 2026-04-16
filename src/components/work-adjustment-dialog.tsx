import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getXpMetrics } from "@/lib/api";
import { workAdjustmentMutationSchema } from "@/lib/schemas";
import type { WorkAdjustmentEntityType } from "@/lib/types";

type WorkAdjustmentDraft = {
  mode: "add" | "remove";
  minutes: number;
  note: string;
};

const QUICK_MINUTES = [10, 15, 30, 45, 60];

function buildInitialDraft(): WorkAdjustmentDraft {
  return {
    mode: "add",
    minutes: 15,
    note: ""
  };
}

export function WorkAdjustmentDialog({
  open,
  onOpenChange,
  entityType,
  entityId,
  targetLabel,
  currentCreditedSeconds,
  pending = false,
  onSubmit
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: WorkAdjustmentEntityType;
  entityId: string;
  targetLabel: string;
  currentCreditedSeconds: number;
  pending?: boolean;
  onSubmit: (input: {
    entityType: WorkAdjustmentEntityType;
    entityId: string;
    deltaMinutes: number;
    note?: string;
  }) => Promise<void>;
}) {
  const [draft, setDraft] = useState<WorkAdjustmentDraft>(buildInitialDraft);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(buildInitialDraft());
      setSubmitError(null);
    }
  }, [open]);

  const xpMetricsQuery = useQuery({
    queryKey: ["forge-xp-metrics"],
    queryFn: getXpMetrics,
    enabled: open
  });

  const cadence = useMemo(() => {
    const rule = xpMetricsQuery.data?.metrics.rules.find(
      (entry) => entry.code === "task_run_progress"
    );
    const intervalMinutes = Math.max(
      1,
      Number(rule?.config.intervalMinutes ?? 10)
    );
    const fixedXp = Number(rule?.config.fixedXp ?? 4);
    return {
      intervalMinutes,
      fixedXp,
      intervalSeconds: intervalMinutes * 60
    };
  }, [xpMetricsQuery.data]);

  const preview = useMemo(() => {
    const safeMinutes = Math.max(0, Math.trunc(draft.minutes || 0));
    const requestedDeltaMinutes =
      draft.mode === "add" ? safeMinutes : -safeMinutes;
    const maxRemovableMinutes = Math.max(
      0,
      Math.floor(currentCreditedSeconds / 60)
    );
    const appliedDeltaMinutes =
      requestedDeltaMinutes >= 0
        ? requestedDeltaMinutes
        : -Math.min(Math.abs(requestedDeltaMinutes), maxRemovableMinutes);
    const nextCreditedSeconds = Math.max(
      0,
      currentCreditedSeconds + appliedDeltaMinutes * 60
    );
    const previousBuckets = Math.floor(
      Math.max(0, currentCreditedSeconds) / cadence.intervalSeconds
    );
    const nextBuckets = Math.floor(
      nextCreditedSeconds / cadence.intervalSeconds
    );
    const bucketDelta = nextBuckets - previousBuckets;
    return {
      requestedDeltaMinutes,
      appliedDeltaMinutes,
      nextCreditedSeconds,
      bucketDelta,
      xpDelta: bucketDelta * cadence.fixedXp,
      maxRemovableMinutes
    };
  }, [
    cadence.fixedXp,
    cadence.intervalSeconds,
    currentCreditedSeconds,
    draft.minutes,
    draft.mode
  ]);

  const steps: Array<QuestionFlowStep<WorkAdjustmentDraft>> = [
    {
      id: "adjustment",
      eyebrow: entityType === "task" ? "Task work" : "Project work",
      title: `Adjust tracked work for ${targetLabel}`,
      description:
        "Use this for retrospective minute corrections. Forge will add or remove tracked minutes and adjust progress XP automatically when a reward bucket is crossed.",
      render: (value, setValue) => (
        <>
          <FlowField
            label="Mode"
            labelHelp="Add minutes when work happened off-timer. Remove minutes when the tracked total needs a correction."
          >
            <FlowChoiceGrid
              value={value.mode}
              onChange={(next) =>
                setValue({ mode: next as WorkAdjustmentDraft["mode"] })
              }
              options={[
                {
                  value: "add",
                  label: "Add minutes",
                  description: "Record extra work that already happened."
                },
                {
                  value: "remove",
                  label: "Remove minutes",
                  description:
                    "Correct tracked time without deleting the work history."
                }
              ]}
            />
          </FlowField>

          <FlowField
            label="Minutes"
            description={`Currently tracked: ${Math.floor(currentCreditedSeconds / 60)} minutes.`}
            hint={
              value.mode === "remove"
                ? `You can remove up to ${preview.maxRemovableMinutes} whole minutes from the current credited total.`
                : undefined
            }
          >
            <div className="flex flex-wrap items-center gap-3">
              <Input
                type="number"
                min={1}
                className="w-36"
                value={value.minutes}
                onChange={(event) =>
                  setValue({ minutes: Number(event.target.value) || 0 })
                }
              />
              <div className="flex flex-wrap gap-2">
                {QUICK_MINUTES.map((minutes) => (
                  <Button
                    key={minutes}
                    type="button"
                    variant={
                      value.minutes === minutes ? "primary" : "secondary"
                    }
                    onClick={() => setValue({ minutes })}
                  >
                    {minutes} min
                  </Button>
                ))}
              </div>
            </div>
          </FlowField>

          <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">
              Preview
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="rounded-[18px] bg-white/[0.03] px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                  Applied minutes
                </div>
                <div className="mt-2 text-lg text-white">
                  {preview.appliedDeltaMinutes > 0 ? "+" : ""}
                  {preview.appliedDeltaMinutes}
                </div>
              </div>
              <div className="rounded-[18px] bg-white/[0.03] px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                  XP delta
                </div>
                <div className="mt-2 text-lg text-white">
                  {preview.xpDelta > 0 ? "+" : ""}
                  {preview.xpDelta}
                </div>
              </div>
              <div className="rounded-[18px] bg-white/[0.03] px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/42">
                  New tracked total
                </div>
                <div className="mt-2 text-lg text-white">
                  {Math.floor(preview.nextCreditedSeconds / 60)} min
                </div>
              </div>
            </div>
            <div className="mt-3 text-sm leading-6 text-white/58">
              Reward cadence: {cadence.fixedXp} XP every{" "}
              {cadence.intervalMinutes} credited minutes.{" "}
              {preview.bucketDelta === 0
                ? "This change does not cross a reward bucket."
                : `This change crosses ${Math.abs(preview.bucketDelta)} reward bucket${Math.abs(preview.bucketDelta) === 1 ? "" : "s"}.`}
            </div>
          </div>

          <FlowField
            label="Note"
            description="Optional context for why this correction is being added. The note stays attached to the adjustment metadata."
          >
            <Textarea
              className="min-h-28"
              value={value.note}
              onChange={(event) => setValue({ note: event.target.value })}
              placeholder="Captured the review session that happened away from the live timer."
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
      eyebrow={
        entityType === "task" ? "Adjust task work" : "Adjust project work"
      }
      title={`Adjust work for ${targetLabel}`}
      description="Add or remove tracked minutes without creating a live task run."
      value={draft}
      onChange={setDraft}
      draftPersistenceKey={`work-adjustment.${entityType}.${entityId}`}
      steps={steps}
      submitLabel="Save adjustment"
      pending={pending}
      pendingLabel="Saving adjustment..."
      error={submitError}
      onSubmit={async () => {
        setSubmitError(null);
        const safeMinutes = Math.max(0, Math.trunc(draft.minutes || 0));
        const deltaMinutes = draft.mode === "add" ? safeMinutes : -safeMinutes;
        const parsed = workAdjustmentMutationSchema.safeParse({
          entityType,
          entityId,
          deltaMinutes,
          note: draft.note
        });

        if (!parsed.success) {
          setSubmitError(
            parsed.error.issues[0]?.message ??
              "Enter a valid minute adjustment."
          );
          return;
        }

        try {
          await onSubmit({
            entityType,
            entityId,
            deltaMinutes: parsed.data.deltaMinutes,
            note: parsed.data.note || undefined
          });
          onOpenChange(false);
        } catch (error) {
          setSubmitError(
            error instanceof Error
              ? error.message
              : "Could not save the work adjustment right now."
          );
        }
      }}
    />
  );
}
