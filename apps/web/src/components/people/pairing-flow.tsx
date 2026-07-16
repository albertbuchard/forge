import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Ban, ShieldCheck } from "lucide-react";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { usePeopleGateway } from "@/components/people/people-gateway";
import {
  PeopleStateBanner,
  formatPeopleDateTime
} from "@/components/people/people-status";
import type {
  PairingInvitation,
  PairingReview,
  PersonContext
} from "@/components/people/people-types";

type PairingDraft = {
  mode: "create" | "scan";
  expiresInMinutes: number;
  qrPayload: string;
  identityConfirmed: boolean;
  invitation: PairingInvitation | null;
  review: PairingReview | null;
};

const PAIRING_QR_FOREGROUND = "#111827";
const PAIRING_QR_BACKGROUND = "#ffffff";

function emptyPairingDraft(): PairingDraft {
  return {
    mode: "create",
    expiresInMinutes: 10,
    qrPayload: "",
    identityConfirmed: false,
    invitation: null,
    review: null
  };
}

function PairingQrCode({ invitation }: { invitation: PairingInvitation }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setDataUrl(null);
    setQrError(null);
    if (!invitation.qrPayload) {
      setQrError(
        "Forge could not create a QR code for this invitation. Compare the fingerprint through another trusted channel."
      );
      return () => {
        active = false;
      };
    }
    void QRCode.toDataURL(invitation.qrPayload, {
      width: 280,
      margin: 2,
      color: {
        dark: PAIRING_QR_FOREGROUND,
        light: PAIRING_QR_BACKGROUND
      }
    })
      .then((value) => {
        if (active) {
          setDataUrl(value);
        }
      })
      .catch(() => {
        if (active) {
          setQrError(
            "The pairing QR code could not be prepared. Close this flow and create a new invitation."
          );
        }
      });
    return () => {
      active = false;
    };
  }, [invitation]);

  return (
    <div
      data-sensitive="pairing-invitation"
      className="grid justify-items-center gap-3 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 text-center"
    >
      {dataUrl ? (
        <img
          src={dataUrl}
          alt="One-use Forge pairing invitation QR code"
          width={280}
          height={280}
          decoding="async"
          className="aspect-square w-full max-w-[17.5rem] rounded-lg object-contain p-2"
          style={{ backgroundColor: PAIRING_QR_BACKGROUND }}
        />
      ) : qrError ? (
        <div
          role="alert"
          className="grid aspect-square w-full max-w-[17.5rem] place-items-center rounded-lg border border-[color-mix(in_srgb,var(--danger)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-danger-soft)] p-5 text-sm leading-6 text-[var(--ui-ink-medium)]"
        >
          {qrError}
        </div>
      ) : (
        <div
          role="status"
          className="grid aspect-square w-full max-w-[17.5rem] place-items-center rounded-lg border border-[var(--ui-border-subtle)] text-sm"
          style={{
            backgroundColor: PAIRING_QR_BACKGROUND,
            color: PAIRING_QR_FOREGROUND
          }}
        >
          Preparing QR code...
        </div>
      )}
      {invitation.verificationPhrase ? (
        <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
          Verification phrase: {invitation.verificationPhrase}
        </div>
      ) : null}
      <div className="break-all font-mono text-xs text-[var(--ui-ink-muted)]">
        Invitation fingerprint: {invitation.fingerprint}
      </div>
      <p className="text-sm leading-6 text-[var(--ui-ink-muted)]">
        One use only. Expires {formatPeopleDateTime(invitation.expiresAt)}.
      </p>
    </div>
  );
}

export function PairingFlow({
  open,
  context,
  onOpenChange,
  onPaired
}: {
  open: boolean;
  context: PersonContext;
  onOpenChange: (open: boolean) => void;
  onPaired: (context: PersonContext) => void;
}) {
  const gateway = usePeopleGateway();
  const canAcceptScannedInvitation = gateway.capabilities.pairingAcceptance;
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<PairingDraft>(emptyPairingDraft);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());

  useEffect(() => {
    setDraft(emptyPairingDraft());
    setSubmitError(null);
  }, [open]);

  useEffect(() => {
    if (!open || !draft.invitation || draft.invitation.status !== "active") {
      return;
    }
    setClockNow(Date.now());
    const interval = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [draft.invitation, open]);

  const invitationMutation = useMutation({
    mutationFn: () =>
      gateway.createPairingInvitation({
        personId: context.person.id,
        label: context.person.displayName,
        expiresInMinutes: draft.expiresInMinutes
      }),
    onSuccess: (invitation) => {
      setDraft((current) => ({ ...current, invitation }));
    }
  });

  const cancelInvitationMutation = useMutation({
    mutationFn: (invitation: PairingInvitation) =>
      gateway.cancelPairingInvitation({
        invitationId: invitation.id,
        expectedVersion: invitation.expectedVersion
      }),
    onSuccess: () => {
      setDraft((current) => ({
        ...current,
        invitation: current.invitation
          ? {
              ...current.invitation,
              qrPayload: null,
              status: "canceled"
            }
          : null
      }));
    }
  });

  const inspectMutation = useMutation({
    mutationFn: () =>
      gateway.inspectPairingPayload({
        personId: context.person.id,
        qrPayload: draft.qrPayload
      }),
    onSuccess: (review) => {
      setDraft((current) => ({ ...current, review }));
    }
  });

  const confirmMutation = useMutation({
    mutationFn: (review: PairingReview) =>
      gateway.confirmPairing({
        pairingId: review.pairingId,
        personId: context.person.id,
        identityConfirmed: draft.identityConfirmed
      }),
    onSuccess: async (nextContext) => {
      queryClient.setQueryData(
        ["people", "context", context.person.id],
        nextContext
      );
      await queryClient.invalidateQueries({
        queryKey: ["people", "collection"]
      });
      onPaired(nextContext);
      onOpenChange(false);
    }
  });
  const invitationStatus =
    draft.invitation?.status === "active" &&
    Date.parse(draft.invitation.expiresAt) <= clockNow
      ? "expired"
      : draft.invitation?.status;

  const steps = useMemo<Array<QuestionFlowStep<PairingDraft>>>(
    () => [
      {
        id: "mode",
        title: "How will you connect?",
        description: `Create a short-lived invitation for ${context.person.displayName} to scan, or review an invitation you scanned from them.`,
        render: (value, setValue) => (
          <div className="grid gap-4">
            <FlowChoiceGrid
              value={value.mode}
              onChange={(mode) =>
                setValue({
                  mode: mode as PairingDraft["mode"],
                  invitation: null,
                  review: null,
                  qrPayload: "",
                  identityConfirmed: false
                })
              }
              options={[
                {
                  value: "create",
                  label: "Create invitation",
                  description: `Show a one-use QR code for ${context.person.displayName} to scan.`
                },
                ...(canAcceptScannedInvitation
                  ? [
                      {
                        value: "scan",
                        label: "Use scanned invitation",
                        description: `Review the invitation, then compare its identity phrase and device with ${context.person.displayName}.`
                      }
                    ]
                  : [])
              ]}
            />
            {!canAcceptScannedInvitation ? (
              <PeopleStateBanner
                state="info"
                title="This device cannot accept a scanned invitation"
              >
                This Forge has no approved device available to accept it here.
                You can still create a one-use invitation for the other person
                to scan.
              </PeopleStateBanner>
            ) : null}
          </div>
        )
      },
      {
        id: "pairing",
        title:
          draft.mode === "create"
            ? "Create a short-lived invitation"
            : draft.review
              ? `Verify ${context.person.displayName}'s Forge`
              : "Review the scanned invitation",
        description:
          draft.mode === "create"
            ? "The invitation expires quickly and works only once. Pairing alone shares no information."
            : `Forge checks the invitation first. Compare its fingerprint or phrase with ${context.person.displayName} through another trusted channel before you confirm.`,
        render: (value, setValue) => {
          if (value.mode === "create") {
            if (value.invitation) {
              if (invitationStatus !== "active") {
                return (
                  <div className="grid justify-items-start gap-3">
                    <PeopleStateBanner
                      state={
                        invitationStatus === "expired" ? "warning" : "info"
                      }
                      title={
                        invitationStatus === "expired"
                          ? "Invitation expired"
                          : "Invitation canceled"
                      }
                    >
                      The invitation details are no longer shown or usable.
                      Create a new invitation when you are ready to pair.
                    </PeopleStateBanner>
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-11"
                      onClick={() => setValue({ invitation: null })}
                    >
                      Create another invitation
                    </Button>
                  </div>
                );
              }
              return (
                <div className="grid gap-3">
                  <PairingQrCode invitation={value.invitation} />
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-11 justify-self-center text-[var(--danger)]"
                    pending={cancelInvitationMutation.isPending}
                    onClick={() =>
                      cancelInvitationMutation.mutate(value.invitation!)
                    }
                  >
                    <Ban className="size-4" aria-hidden="true" />
                    Cancel invitation
                  </Button>
                </div>
              );
            }
            return (
              <FlowField label="Invitation lifetime">
                <select
                  value={value.expiresInMinutes}
                  onChange={(event) =>
                    setValue({ expiresInMinutes: Number(event.target.value) })
                  }
                  className="interactive-tap min-h-11 w-full rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 text-[var(--ui-ink-strong)]"
                >
                  <option value={5}>5 minutes</option>
                  <option value={10}>10 minutes</option>
                  <option value={15}>15 minutes</option>
                </select>
              </FlowField>
            );
          }

          if (!value.review) {
            return (
              <FlowField
                label="Scanned Forge invitation"
                description="Paste only the invitation text from a QR scanner you trust."
              >
                <Textarea
                  value={value.qrPayload}
                  onChange={(event) =>
                    setValue({ qrPayload: event.target.value })
                  }
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-sensitive="pairing-payload"
                  placeholder="Paste scanned invitation text"
                />
              </FlowField>
            );
          }

          return (
            <div className="grid gap-4">
              <div className="grid gap-3 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 text-sm">
                <div className="flex items-center gap-2">
                  <ShieldCheck
                    className="size-4 text-[var(--primary)]"
                    aria-hidden="true"
                  />
                  <span className="font-medium text-[var(--ui-ink-strong)]">
                    {value.review.remoteLabel}
                  </span>
                </div>
                <div>
                  <div className="text-[var(--ui-ink-muted)]">Device</div>
                  <div className="mt-1 text-[var(--ui-ink-strong)]">
                    {value.review.deviceLabel}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--ui-ink-muted)]">
                    Identity fingerprint
                  </div>
                  <div className="mt-1 break-all font-mono text-[var(--ui-ink-strong)]">
                    {value.review.identityFingerprint}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--ui-ink-muted)]">
                    Verification phrase
                  </div>
                  <div className="mt-1 font-medium text-[var(--ui-ink-strong)]">
                    {value.review.verificationPhrase ??
                      "Not returned; verify the fingerprint instead"}
                  </div>
                </div>
                <Badge size="sm" tone="meta" wrap>
                  Expires {formatPeopleDateTime(value.review.expiresAt)}
                </Badge>
              </div>
              <label className="flex min-h-11 items-start gap-3 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-info-soft)] p-3 text-sm leading-6 text-[var(--ui-ink-medium)]">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={value.identityConfirmed}
                  onChange={(event) =>
                    setValue({ identityConfirmed: event.target.checked })
                  }
                />
                <span>
                  I verified this fingerprint or phrase with{" "}
                  {context.person.displayName}
                  through a separate trusted channel. Pairing still shares no
                  data by itself.
                </span>
              </label>
            </div>
          );
        }
      }
    ],
    [
      canAcceptScannedInvitation,
      context.person.displayName,
      draft.mode,
      draft.review,
      invitationStatus,
      cancelInvitationMutation
    ]
  );

  const pending =
    invitationMutation.isPending ||
    cancelInvitationMutation.isPending ||
    inspectMutation.isPending ||
    confirmMutation.isPending;
  const mutationError =
    invitationMutation.error ??
    cancelInvitationMutation.error ??
    inspectMutation.error ??
    confirmMutation.error;
  const submitLabel =
    draft.mode === "create"
      ? draft.invitation
        ? "Done"
        : "Create invitation"
      : draft.review
        ? "Confirm pairing"
        : "Inspect invitation";

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Forge pairing"
      title={`Pair with ${context.person.displayName}`}
      description={`Connect after verifying ${context.person.displayName} and their device. Pairing alone shares no information.`}
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={submitLabel}
      pending={pending}
      pendingLabel="Verifying"
      error={
        submitError ??
        (mutationError instanceof Error ? mutationError.message : null)
      }
      resolveContinueBlocker={(stepId, value) =>
        stepId === "pairing" &&
        value.mode === "scan" &&
        value.review &&
        !value.identityConfirmed
          ? "Verify the identity before confirming the pairing."
          : null
      }
      onSubmit={async () => {
        setSubmitError(null);
        try {
          if (draft.mode === "create") {
            if (draft.invitation) {
              onOpenChange(false);
              return;
            }
            await invitationMutation.mutateAsync();
            return;
          }
          if (!draft.review) {
            if (!draft.qrPayload.trim()) {
              setSubmitError("Paste a scanned Forge invitation first.");
              return;
            }
            await inspectMutation.mutateAsync();
            return;
          }
          if (!draft.identityConfirmed) {
            setSubmitError(
              "Verify the identity before confirming the pairing."
            );
            return;
          }
          await confirmMutation.mutateAsync(draft.review);
        } catch {
          // The active mutation error is rendered by the guided flow.
        }
      }}
    />
  );
}
