import { useEffect, useMemo, useState } from "react";
import {
  FlowField,
  QuestionFlowDialog
} from "@/components/flows/question-flow-dialog";
import type { QuestionFlowStep } from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createWorkTransmissionPreview,
  requestWorkTransmissionApproval,
  recordWorkVerifiedSubmission
} from "@/lib/work-api";
import type { JobApplication, WorkRecord } from "@/lib/work-api";
import {
  lines,
  keyValue,
  localDateTime,
  isoOrNull,
  message,
  idempotencyKey,
  recordValue,
  Select
} from "./work-operational-dialog-shared";
import type { TransmissionDraft } from "./work-application-dialogs";

export function TransmissionPreviewDialog({
  open,
  onOpenChange,
  userIds,
  application,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  application: JobApplication;
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<TransmissionDraft>({
    destinationName: "",
    destinationUrl: "",
    fields: "",
    representations: "",
    unresolvedGates: "",
    expiresInMinutes: "60"
  });
  const [created, setCreated] = useState<WorkRecord | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setCreated(null);
      setError(null);
      setDraft({
        destinationName: "",
        destinationUrl: "",
        fields: "",
        representations: "",
        unresolvedGates: "",
        expiresInMinutes: "60"
      });
    }
  }, [open]);
  const exactArtifacts = (application.artifactUses ?? [])
    .filter(
      (use) =>
        typeof use.artifactId === "string" &&
        typeof use.contentSha256 === "string" &&
        ["approved", "sealed"].includes(String(use.approvalState))
    )
    .map((use) => ({
      artifactId: use.artifactId,
      artifactVersionId: use.artifactVersionId ?? null,
      contentSha256: use.contentSha256
    }));
  const approvedAnswers = (application.questions ?? [])
    .filter(
      (question) =>
        question.reviewState === "approved" && question.approvedAnswer
    )
    .map((question) => ({
      questionId: question.id,
      exactQuestion: question.exactQuestion,
      answer: question.approvedAnswer
    }));
  const steps = useMemo<Array<QuestionFlowStep<TransmissionDraft>>>(
    () => [
      {
        id: "preview",
        eyebrow: "External transmission",
        title: created
          ? "Review the locked preview"
          : "Build a submission preview",
        description:
          "Approval applies only to this exact destination, set of files, and answers. It does not mean the application was sent.",
        render: (value, setValue) =>
          created ? (
            <div className="grid gap-4">
              <div className="rounded-[20px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
                <div className="mt-3 text-sm text-[var(--ui-ink-soft)]">
                  {String(
                    recordValue(created.destination).name ?? "Destination"
                  )}{" "}
                  · {exactArtifacts.length} exact file version
                  {exactArtifacts.length === 1 ? "" : "s"} ·{" "}
                  {approvedAnswers.length} approved answer
                  {approvedAnswers.length === 1 ? "" : "s"}
                </div>
                <details className="mt-3 text-xs text-[var(--ui-ink-faint)]">
                  <summary className="cursor-pointer">
                    Technical details
                  </summary>
                  <div className="mt-2 break-all font-mono">
                    Preview digest {String(created.previewDigest)}
                  </div>
                </details>
              </div>
              {Array.isArray(created.unresolvedGates) &&
              created.unresolvedGates.length ? (
                <div className="rounded-[18px] border border-[color-mix(in_srgb,var(--warning)_35%,var(--ui-border-subtle))] p-4 text-sm text-[var(--ui-ink-medium)]">
                  Resolve everything listed before requesting approval:{" "}
                  {created.unresolvedGates
                    .map((gate) =>
                      String(recordValue(gate).label ?? "Unresolved item")
                    )
                    .join(", ")}
                  .
                </div>
              ) : (
                <p className="text-sm leading-6 text-[var(--ui-ink-soft)]">
                  Requesting approval starts a final safety review. The
                  destination, files, answers, and statements cannot change
                  after approval.
                </p>
              )}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <FlowField label="Destination name">
                <Input
                  value={value.destinationName}
                  onChange={(event) =>
                    setValue({ destinationName: event.target.value })
                  }
                  autoFocus
                />
              </FlowField>
              <FlowField label="Destination URL">
                <Input
                  type="url"
                  value={value.destinationUrl}
                  onChange={(event) =>
                    setValue({ destinationUrl: event.target.value })
                  }
                />
              </FlowField>
              <FlowField
                label="Fields to transmit"
                hint="key=value, one per line"
                className="md:col-span-2"
              >
                <Textarea
                  rows={5}
                  value={value.fields}
                  onChange={(event) => setValue({ fields: event.target.value })}
                />
              </FlowField>
              <FlowField
                label="Representations and declarations"
                hint="key=value, one per line"
                className="md:col-span-2"
              >
                <Textarea
                  rows={4}
                  value={value.representations}
                  onChange={(event) =>
                    setValue({ representations: event.target.value })
                  }
                />
              </FlowField>
              <FlowField
                label="Unresolved gates"
                hint="One per line; approval is blocked until empty"
                className="md:col-span-2"
              >
                <Textarea
                  rows={4}
                  value={value.unresolvedGates}
                  onChange={(event) =>
                    setValue({ unresolvedGates: event.target.value })
                  }
                />
              </FlowField>
              <FlowField label="Expires in minutes">
                <Input
                  type="number"
                  min="5"
                  max="1440"
                  value={value.expiresInMinutes}
                  onChange={(event) =>
                    setValue({ expiresInMinutes: event.target.value })
                  }
                />
              </FlowField>
              <div className="rounded-[18px] bg-[var(--ui-surface-2)] p-4 text-sm text-[var(--ui-ink-soft)]">
                {exactArtifacts.length} pinned Artifact version
                {exactArtifacts.length === 1 ? "" : "s"} and{" "}
                {approvedAnswers.length} approved answer
                {approvedAnswers.length === 1 ? "" : "s"} will be included.
              </div>
            </div>
          )
      }
    ],
    [approvedAnswers.length, created, exactArtifacts.length]
  );
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Work · Application"
      title="Application transmission"
      description="Preview, approve, transmit externally, then record direct evidence as separate steps."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={
        created ? "Request central approval" : "Create exact preview"
      }
      pending={pending}
      error={error}
      onSubmit={async () => {
        setPending(true);
        setError(null);
        try {
          if (!created) {
            const result = await createWorkTransmissionPreview(userIds, {
              applicationId: application.id,
              destination: {
                name: draft.destinationName,
                url: draft.destinationUrl,
                channel: "web_portal"
              },
              fields: keyValue(draft.fields),
              answers: approvedAnswers,
              artifactVersions: exactArtifacts,
              representations: keyValue(draft.representations),
              unresolvedGates: lines(draft.unresolvedGates).map((label) => ({
                label
              })),
              expiresInMinutes: Number(draft.expiresInMinutes),
              idempotencyKey: idempotencyKey("work-transmission-preview")
            });
            setCreated(result.preview);
          } else {
            if (
              Array.isArray(created.unresolvedGates) &&
              created.unresolvedGates.length
            )
              throw new Error(
                "Resolve every user-only, legal, compensation, and duplicate gate before requesting approval."
              );
            await requestWorkTransmissionApproval(userIds, created.id, {
              idempotencyKey: idempotencyKey("work-transmission-approval")
            });
            onOpenChange(false);
            await onSaved();
          }
        } catch (caught) {
          setError(message(caught));
        } finally {
          setPending(false);
        }
      }}
    />
  );
}

type VerifiedDraft = {
  previewId: string;
  confirmationReceipt: string;
  trackingIdentifier: string;
  evidenceArtifactId: string;
  description: string;
  occurredAt: string;
};

export function VerifiedSubmissionDialog({
  open,
  onOpenChange,
  userIds,
  application,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  application: JobApplication;
  onSaved: () => Promise<void> | void;
}) {
  const authorized = useMemo(
    () =>
      (application.transmissionPreviews ?? []).filter(
        (preview) =>
          preview.status === "authorized" &&
          preview.authorizationIdentity &&
          preview.previewDigest
      ),
    [application.transmissionPreviews]
  );
  const defaultPreviewId = String(authorized[0]?.id ?? "");
  const [draft, setDraft] = useState<VerifiedDraft>({
    previewId: "",
    confirmationReceipt: "",
    trackingIdentifier: "",
    evidenceArtifactId: "",
    description:
      "The application was submitted and the destination confirmed receipt.",
    occurredAt: localDateTime(new Date().toISOString())
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open)
      setDraft({
        previewId: defaultPreviewId,
        confirmationReceipt: "",
        trackingIdentifier: "",
        evidenceArtifactId: "",
        description:
          "The application was submitted and the destination confirmed receipt.",
        occurredAt: localDateTime(new Date().toISOString())
      });
  }, [application.updatedAt, defaultPreviewId, open]);
  const steps = useMemo<Array<QuestionFlowStep<VerifiedDraft>>>(
    () => [
      {
        id: "evidence",
        eyebrow: "Direct submission evidence",
        title: "Record a verified submission",
        description:
          "Record direct proof such as a receipt, tracking reference, or evidence file. At least one is required.",
        render: (value, setValue) => (
          <div className="grid gap-4">
            <Select
              label="Authorized transmission"
              value={value.previewId}
              onChange={(previewId) => setValue({ previewId })}
            >
              <option value="">Choose an authorization</option>
              {authorized.map((preview) => (
                <option key={preview.id} value={preview.id}>
                  Approved {String(preview.authorizedAt ?? "")}
                </option>
              ))}
            </Select>
            <div className="grid gap-4 md:grid-cols-2">
              <FlowField label="Confirmation receipt">
                <Input
                  value={value.confirmationReceipt}
                  onChange={(event) =>
                    setValue({ confirmationReceipt: event.target.value })
                  }
                />
              </FlowField>
              <FlowField label="Applicant tracking identifier">
                <Input
                  value={value.trackingIdentifier}
                  onChange={(event) =>
                    setValue({ trackingIdentifier: event.target.value })
                  }
                />
              </FlowField>
              <details className="rounded-[16px] border border-[var(--ui-border-subtle)] p-3">
                <summary className="cursor-pointer text-sm font-medium text-[var(--ui-ink-medium)]">
                  Technical details
                </summary>
                <FlowField label="Evidence file ID">
                  <Input
                    value={value.evidenceArtifactId}
                    onChange={(event) =>
                      setValue({ evidenceArtifactId: event.target.value })
                    }
                  />
                </FlowField>
              </details>
              <FlowField label="Occurred at">
                <Input
                  type="datetime-local"
                  value={value.occurredAt}
                  onChange={(event) =>
                    setValue({ occurredAt: event.target.value })
                  }
                />
              </FlowField>
            </div>
            <FlowField label="Factual description">
              <Textarea
                rows={5}
                value={value.description}
                onChange={(event) =>
                  setValue({ description: event.target.value })
                }
              />
            </FlowField>
          </div>
        )
      }
    ],
    [authorized]
  );
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Work · Application"
      title="Verify submission"
      description="Consume one exact authorization using direct evidence."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel="Record verified submission"
      pending={pending}
      error={error}
      onSubmit={async () => {
        const preview = authorized.find((item) => item.id === draft.previewId);
        if (!preview) {
          setError("Choose an authorized transmission.");
          return;
        }
        if (
          !draft.confirmationReceipt.trim() &&
          !draft.trackingIdentifier.trim() &&
          !draft.evidenceArtifactId.trim()
        ) {
          setError(
            "Add a confirmation receipt, tracking identifier, or evidence Artifact."
          );
          return;
        }
        setPending(true);
        setError(null);
        try {
          await recordWorkVerifiedSubmission(userIds, {
            authorizationIdentity: preview.authorizationIdentity,
            previewDigest: preview.previewDigest,
            evidenceArtifactId: draft.evidenceArtifactId || null,
            confirmationReceipt: draft.confirmationReceipt,
            trackingIdentifier: draft.trackingIdentifier,
            factualDescription: draft.description,
            occurredAt: isoOrNull(draft.occurredAt) ?? undefined,
            idempotencyKey: idempotencyKey("work-verified-submission")
          });
          onOpenChange(false);
          await onSaved();
        } catch (caught) {
          setError(message(caught));
        } finally {
          setPending(false);
        }
      }}
    />
  );
}
