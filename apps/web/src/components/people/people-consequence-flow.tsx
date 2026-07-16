import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Laptop, ShieldX } from "lucide-react";
import {
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { usePeopleGateway } from "@/components/people/people-gateway";
import { PeopleStateBanner } from "@/components/people/people-status";
import type { PersonContext } from "@/components/people/people-types";

export type PeopleConsequenceAction =
  | { kind: "grant"; grantId: string; label: string }
  | { kind: "relationship"; relationshipId: string; label: string }
  | {
      kind: "device";
      relationshipId: string;
      deviceId: string;
      label: string;
    };

type ConsequenceDraft = {
  acknowledged: boolean;
};

export function PeopleConsequenceFlow({
  open,
  action,
  context,
  onOpenChange,
  onUpdated
}: {
  open: boolean;
  action: PeopleConsequenceAction | null;
  context: PersonContext;
  onOpenChange: (open: boolean) => void;
  onUpdated: (context: PersonContext) => void;
}) {
  const gateway = usePeopleGateway();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ConsequenceDraft>({ acknowledged: false });
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setDraft({ acknowledged: false });
    setSubmitError(null);
  }, [action, open]);

  const mutation = useMutation({
    mutationFn: async (nextAction: PeopleConsequenceAction) => {
      if (nextAction.kind === "grant") {
        return gateway.revokeShareGrant({
          grantId: nextAction.grantId,
          acknowledgement: draft.acknowledged
        });
      }
      if (nextAction.kind === "relationship") {
        return gateway.revokeRelationship({
          relationshipId: nextAction.relationshipId,
          acknowledgement: draft.acknowledged
        });
      }
      return gateway.removePeerDevice({
        relationshipId: nextAction.relationshipId,
        deviceId: nextAction.deviceId,
        acknowledgement: draft.acknowledged
      });
    },
    onSuccess: async (nextContext) => {
      queryClient.setQueryData(
        ["people", "context", context.person.id],
        nextContext
      );
      await queryClient.invalidateQueries({
        queryKey: ["people", "collection"]
      });
      onUpdated(nextContext);
      onOpenChange(false);
    }
  });

  const steps = useMemo<Array<QuestionFlowStep<ConsequenceDraft>>>(() => {
    if (!action) {
      return [];
    }
    const isDevice = action.kind === "device";
    return [
      {
        id: "impact",
        title:
          action.kind === "grant"
            ? `Revoke ${action.label}`
            : action.kind === "relationship"
              ? `Revoke ${action.label}`
              : `Remove ${action.label}`,
        description:
          action.kind === "grant"
            ? "This share stops immediately. Forge tells approved devices to remove protected offline copies under the retention rules."
            : action.kind === "relationship"
              ? "This connection ends for every associated device. Future questions and sharing stop."
              : "This device stops receiving shared information and is removed from future encrypted delivery.",
        render: () => (
          <div className="grid gap-4">
            <div className="grid justify-items-center gap-3 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-5 py-6 text-center">
              {isDevice ? (
                <Laptop
                  className="size-8 text-[var(--danger)]"
                  aria-hidden="true"
                />
              ) : action.kind === "relationship" ? (
                <ShieldX
                  className="size-8 text-[var(--danger)]"
                  aria-hidden="true"
                />
              ) : (
                <Ban
                  className="size-8 text-[var(--danger)]"
                  aria-hidden="true"
                />
              )}
              <p className="max-w-lg text-sm leading-6 text-[var(--ui-ink-medium)]">
                {action.kind === "grant"
                  ? "An older sharing version cannot turn access back on. Any conflicting offline change must return as a new request for review."
                  : action.kind === "relationship"
                    ? "Connecting again will require a new verified pairing. Notes you saved about this person stay unchanged."
                    : "Other approved devices remain connected. This device must be verified and approved again before it can receive anything."}
              </p>
            </div>
            <PeopleStateBanner state="warning" title="Limits of revocation">
              Revocation stops future access and tells protected Forge copies to
              follow the deletion policy. It cannot erase what another person
              remembers or copies exported from Forge.
            </PeopleStateBanner>
          </div>
        )
      },
      {
        id: "confirm",
        title: "Confirm the consequence",
        description:
          "Only you can take this security action. Older device or sharing versions cannot undo it.",
        render: (value, setValue) => (
          <label className="flex min-h-11 items-start gap-3 rounded-lg border border-[color-mix(in_srgb,var(--danger)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-danger-soft)] p-4 text-sm leading-6 text-[var(--ui-ink-medium)]">
            <input
              type="checkbox"
              className="mt-1 size-4"
              checked={value.acknowledged}
              onChange={(event) =>
                setValue({ acknowledged: event.target.checked })
              }
            />
            <span>
              I understand that future access stops, protected offline copies
              follow the deletion policy, and information already seen outside
              Forge may remain.
            </span>
          </label>
        )
      }
    ];
  }, [action]);

  const submitLabel =
    action?.kind === "device"
      ? "Remove device"
      : action?.kind === "relationship"
        ? "Revoke connection"
        : "Revoke share";

  if (!action) {
    return null;
  }

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="People security"
      title="Review revocation"
      description="Review what will stop and what may remain before revoking access."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={submitLabel}
      pending={mutation.isPending}
      pendingLabel="Applying"
      error={
        submitError ??
        (mutation.error instanceof Error ? mutation.error.message : null)
      }
      onSubmit={async () => {
        if (!draft.acknowledged) {
          setSubmitError("Confirm that you understand the revocation effects.");
          return;
        }
        setSubmitError(null);
        try {
          await mutation.mutateAsync(action);
        } catch {
          // The mutation error is rendered by the guided flow.
        }
      }}
    />
  );
}
