import { useEffect, useMemo, useState } from "react";
import {
  FlowField,
  QuestionFlowDialog
} from "@/components/flows/question-flow-dialog";
import type { QuestionFlowStep } from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createWorkSupportingRecord,
  recordJobApplicationEvent,
  updateJobApplication
} from "@/lib/work-api";
import type { JobApplication, WorkRecord } from "@/lib/work-api";
import {
  provenance,
  lines,
  keyValue,
  localDateTime,
  isoOrNull,
  message,
  idempotencyKey,
  recordValue,
  Select
} from "./work-operational-dialog-shared";
import { ArtifactVersionPicker } from "./work-response-question-dialogs";
import type { ArtifactUseDraft } from "./work-document-profile-dialogs";

export function ApplicationArtifactDialog({
  open,
  onOpenChange,
  userIds,
  applicationId,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  applicationId: string;
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<ArtifactUseDraft>({
    references: [],
    useKind: "preparation",
    approvalState: "reviewed"
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open)
      setDraft({
        references: [],
        useKind: "preparation",
        approvalState: "reviewed"
      });
  }, [open]);
  const steps = useMemo<Array<QuestionFlowStep<ArtifactUseDraft>>>(
    () => [
      {
        id: "artifact",
        eyebrow: "Exact application material",
        title: "Link an Artifact version",
        description:
          "This immutable record preserves the exact checksum and intended use. It is not proof that anything was submitted.",
        render: (value, setValue) => (
          <div className="grid gap-4">
            <ArtifactVersionPicker
              single
              value={value.references}
              onChange={(references) => setValue({ references })}
            />
            <div className="grid gap-4 md:grid-cols-2">
              <Select
                label="Use"
                value={value.useKind}
                onChange={(useKind) => setValue({ useKind })}
              >
                {[
                  "preparation",
                  "review",
                  "transmission",
                  "verified_submission"
                ].map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </Select>
              <Select
                label="Approval state"
                value={value.approvalState}
                onChange={(approvalState) => setValue({ approvalState })}
              >
                {["draft", "reviewed", "approved", "sealed"].map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </Select>
            </div>
          </div>
        )
      }
    ],
    []
  );
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Work · Application"
      title="Link exact application material"
      description="Pin a curriculum vitae, cover letter, portfolio, answer set, or receipt to one exact Artifact version."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel="Link exact version"
      pending={pending}
      error={error}
      resolveContinueBlocker={() => null}
      onSubmit={async () => {
        const reference = draft.references[0];
        if (!reference) {
          setError("Choose one exact Artifact version.");
          return;
        }
        setPending(true);
        setError(null);
        const data = {
          artifactId: reference.artifactId,
          artifactVersionId: reference.artifactVersionId,
          contentSha256: reference.contentSha256,
          useKind: draft.useKind,
          approvalState: draft.approvalState,
          usedAt: new Date().toISOString(),
          transmissionPreviewId: null,
          provenance
        };
        try {
          await createWorkSupportingRecord(
            userIds,
            "artifactUse",
            { data },
            applicationId
          );
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

type ApplicationWorkspaceDraft = {
  routeName: string;
  routeUrl: string;
  accountReference: string;
  nextAction: string;
  ownerLabel: string;
  blocker: string;
  priority: string;
  referralState: string;
  privateContacts: string;
  positioningProfileId: string;
  documentSetId: string;
  representations: string;
  unresolvedUserFacts: string;
  lastContactAt: string;
  nextFollowUpAt: string;
  decisionDeadline: string;
  expectedResponseAt: string;
  employerReason: string;
  inferredExplanation: string;
  lessons: string;
  reapplicationDate: string;
};

function applicationWorkspaceDraft(
  application: JobApplication
): ApplicationWorkspaceDraft {
  const route = recordValue(application.applicationRoute);
  const representations =
    application.representations &&
    typeof application.representations === "object"
      ? Object.entries(application.representations)
          .map(([key, value]) => `${key}=${String(value)}`)
          .join("\n")
      : "";
  return {
    routeName: String(route.name ?? route.channel ?? ""),
    routeUrl: String(route.url ?? ""),
    accountReference: String(application.accountReference ?? ""),
    nextAction: String(application.nextAction ?? ""),
    ownerLabel: String(application.ownerLabel ?? ""),
    blocker: String(application.blocker ?? ""),
    priority: String(application.priority ?? "normal"),
    referralState: String(application.referralState ?? "none"),
    privateContacts: (application.privateContacts ?? [])
      .map((contact) =>
        String(contact.personId ?? contact.label ?? contact.value ?? "")
      )
      .filter(Boolean)
      .join("\n"),
    positioningProfileId: String(application.positioningProfileId ?? ""),
    documentSetId: String(application.documentSetId ?? ""),
    representations,
    unresolvedUserFacts: (application.unresolvedUserFacts ?? [])
      .map((fact) => String(fact.fact ?? fact.label ?? fact.value ?? ""))
      .filter(Boolean)
      .join("\n"),
    lastContactAt: localDateTime(application.lastContactAt),
    nextFollowUpAt: localDateTime(application.nextFollowUpAt),
    decisionDeadline: localDateTime(application.decisionDeadline),
    expectedResponseAt: localDateTime(application.expectedResponseAt),
    employerReason: String(application.employerReason ?? ""),
    inferredExplanation: String(application.inferredExplanation ?? ""),
    lessons: String(application.lessons ?? ""),
    reapplicationDate: String(application.reapplicationDate ?? "")
  };
}

type ApplicationEventDraft = {
  eventType: string;
  occurredAt: string;
  factualDescription: string;
  outcome: string;
  nextAction: string;
  nextFollowUpAt: string;
  dueAt: string;
  sourceArtifactId: string;
};

export function ApplicationEventDialog({
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
  const fresh = (): ApplicationEventDraft => ({
    eventType: "email",
    occurredAt: localDateTime(new Date().toISOString()),
    factualDescription: "",
    outcome: "",
    nextAction: application.nextAction ?? "",
    nextFollowUpAt: localDateTime(application.nextFollowUpAt),
    dueAt: "",
    sourceArtifactId: ""
  });
  const [draft, setDraft] = useState<ApplicationEventDraft>(fresh);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setDraft(fresh());
      setError(null);
    }
  }, [open, application.id, application.revision]);
  const steps = useMemo<Array<QuestionFlowStep<ApplicationEventDraft>>>(
    () => [
      {
        id: "activity",
        eyebrow: "Immutable application history",
        title: "What happened?",
        description:
          "Record factual activity without inventing a lifecycle change. Use the separate stage control when the application stage actually changed.",
        render: (value, setValue) => (
          <div className="grid gap-4 md:grid-cols-2">
            <Select
              label="Activity type"
              value={value.eventType}
              onChange={(eventType) => setValue({ eventType })}
            >
              {[
                "email",
                "acknowledgement",
                "call",
                "interview",
                "assessment",
                "information_request",
                "follow_up",
                "withdrawal",
                "offer",
                "rejection",
                "correction",
                "note"
              ].map((kind) => (
                <option key={kind} value={kind}>
                  {kind.replaceAll("_", " ")}
                </option>
              ))}
            </Select>
            <FlowField label="Occurred at">
              <Input
                type="datetime-local"
                value={value.occurredAt}
                onChange={(event) =>
                  setValue({ occurredAt: event.target.value })
                }
              />
            </FlowField>
            <FlowField
              label="What is directly known?"
              className="md:col-span-2"
            >
              <Textarea
                autoFocus
                rows={5}
                value={value.factualDescription}
                onChange={(event) =>
                  setValue({ factualDescription: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Outcome">
              <Textarea
                rows={3}
                value={value.outcome}
                onChange={(event) => setValue({ outcome: event.target.value })}
              />
            </FlowField>
            <FlowField label="Next action">
              <Textarea
                rows={3}
                value={value.nextAction}
                onChange={(event) =>
                  setValue({ nextAction: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Next follow-up">
              <Input
                type="datetime-local"
                value={value.nextFollowUpAt}
                onChange={(event) =>
                  setValue({ nextFollowUpAt: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Event due date">
              <Input
                type="datetime-local"
                value={value.dueAt}
                onChange={(event) => setValue({ dueAt: event.target.value })}
              />
            </FlowField>
            <FlowField
              label="Source Artifact ID"
              hint="Optional email, screenshot, receipt, or other direct evidence"
            >
              <Input
                value={value.sourceArtifactId}
                onChange={(event) =>
                  setValue({ sourceArtifactId: event.target.value })
                }
              />
            </FlowField>
          </div>
        )
      }
    ],
    [application.id, application.revision]
  );
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Work · Application"
      title="Record application activity"
      description="Append an evidence-backed event while keeping stage and activity history distinct."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel="Record activity"
      pending={pending}
      error={error}
      resolveContinueBlocker={() =>
        !draft.factualDescription.trim()
          ? "Describe the directly known event."
          : null
      }
      onSubmit={async () => {
        setPending(true);
        setError(null);
        try {
          await recordJobApplicationEvent(userIds, application.id, {
            expectedRevision: Number(application.revision),
            eventType: draft.eventType,
            occurredAt: isoOrNull(draft.occurredAt) ?? undefined,
            sourceArtifactId: draft.sourceArtifactId || null,
            factualDescription: draft.factualDescription,
            outcome: draft.outcome,
            nextAction: draft.nextAction,
            nextFollowUpAt: isoOrNull(draft.nextFollowUpAt),
            dueAt: isoOrNull(draft.dueAt),
            confidence: 1,
            provenance,
            idempotencyKey: idempotencyKey("work-application-event")
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

export function ApplicationWorkspaceDialog({
  open,
  onOpenChange,
  userIds,
  application,
  profiles,
  documentSets,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  application: JobApplication;
  profiles: WorkRecord[];
  documentSets: WorkRecord[];
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(() =>
    applicationWorkspaceDraft(application)
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setDraft(applicationWorkspaceDraft(application));
      setError(null);
    }
  }, [application, open]);
  const steps = useMemo<Array<QuestionFlowStep<ApplicationWorkspaceDraft>>>(
    () => [
      {
        id: "workspace",
        eyebrow: "Application workspace",
        title: "Update preparation facts",
        description:
          "Keep the application route, exact positioning, unresolved user-only facts, ownership, blocker, and next action current. This does not change stage or claim submission.",
        render: (value, setValue) => (
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label="Application route">
              <Input
                value={value.routeName}
                onChange={(event) =>
                  setValue({ routeName: event.target.value })
                }
                autoFocus
              />
            </FlowField>
            <FlowField label="Application URL">
              <Input
                type="url"
                value={value.routeUrl}
                onChange={(event) => setValue({ routeUrl: event.target.value })}
              />
            </FlowField>
            <FlowField
              label="Account identity reference"
              hint="A label or identifier only; never store a password or token."
            >
              <Input
                value={value.accountReference}
                onChange={(event) =>
                  setValue({ accountReference: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Owner">
              <Input
                value={value.ownerLabel}
                onChange={(event) =>
                  setValue({ ownerLabel: event.target.value })
                }
              />
            </FlowField>
            <Select
              label="Priority"
              value={value.priority}
              onChange={(priority) => setValue({ priority })}
            >
              {["low", "normal", "high", "critical"].map((option) => (
                <option key={option}>{option}</option>
              ))}
            </Select>
            <FlowField label="Referral state">
              <Input
                value={value.referralState}
                onChange={(event) =>
                  setValue({ referralState: event.target.value })
                }
              />
            </FlowField>
            <Select
              label="Positioning profile"
              value={value.positioningProfileId}
              onChange={(positioningProfileId) =>
                setValue({ positioningProfileId })
              }
            >
              <option value="">No profile selected</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {String(profile.title ?? profile.id)}
                </option>
              ))}
            </Select>
            <Select
              label="Exact document set"
              value={value.documentSetId}
              onChange={(documentSetId) => setValue({ documentSetId })}
            >
              <option value="">No document set selected</option>
              {documentSets.map((document) => (
                <option key={document.id} value={document.id}>
                  {String(document.title ?? document.id)} · version{" "}
                  {String(document.version ?? 1)}
                </option>
              ))}
            </Select>
            <FlowField label="Last contact">
              <Input
                type="datetime-local"
                value={value.lastContactAt}
                onChange={(event) =>
                  setValue({ lastContactAt: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Next follow-up">
              <Input
                type="datetime-local"
                value={value.nextFollowUpAt}
                onChange={(event) =>
                  setValue({ nextFollowUpAt: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Decision deadline">
              <Input
                type="datetime-local"
                value={value.decisionDeadline}
                onChange={(event) =>
                  setValue({ decisionDeadline: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Expected response">
              <Input
                type="datetime-local"
                value={value.expectedResponseAt}
                onChange={(event) =>
                  setValue({ expectedResponseAt: event.target.value })
                }
              />
            </FlowField>
            <FlowField
              label="Private contacts"
              hint="One existing Person ID or reviewed label per line"
            >
              <Textarea
                rows={4}
                value={value.privateContacts}
                onChange={(event) =>
                  setValue({ privateContacts: event.target.value })
                }
              />
            </FlowField>
            <FlowField
              label="Representations supplied"
              hint="key=value, one per line"
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
              label="Unresolved user-only facts"
              hint="One question or missing fact per line"
            >
              <Textarea
                rows={5}
                value={value.unresolvedUserFacts}
                onChange={(event) =>
                  setValue({ unresolvedUserFacts: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Blocker">
              <Textarea
                rows={5}
                value={value.blocker}
                onChange={(event) => setValue({ blocker: event.target.value })}
              />
            </FlowField>
            <FlowField
              label="Employer reason"
              hint="Only a reason the employer actually supplied"
            >
              <Textarea
                rows={4}
                value={value.employerReason}
                onChange={(event) =>
                  setValue({ employerReason: event.target.value })
                }
              />
            </FlowField>
            <FlowField
              label="Possible explanation"
              hint="Kept explicitly separate from known employer facts"
            >
              <Textarea
                rows={4}
                value={value.inferredExplanation}
                onChange={(event) =>
                  setValue({ inferredExplanation: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Lessons">
              <Textarea
                rows={5}
                value={value.lessons}
                onChange={(event) => setValue({ lessons: event.target.value })}
              />
            </FlowField>
            <FlowField label="Future reapplication date">
              <Input
                type="date"
                value={value.reapplicationDate}
                onChange={(event) =>
                  setValue({ reapplicationDate: event.target.value })
                }
              />
            </FlowField>
            <FlowField label="Next action" className="md:col-span-2">
              <Textarea
                rows={4}
                value={value.nextAction}
                onChange={(event) =>
                  setValue({ nextAction: event.target.value })
                }
              />
            </FlowField>
            <p className="text-xs leading-5 text-[var(--ui-ink-faint)] md:col-span-2">
              These private application fields require Work transmission
              authority. Credentials, passwords, secret tokens, and protected
              demographic answers do not belong here.
            </p>
          </div>
        )
      }
    ],
    [documentSets, profiles]
  );
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Work · Application"
      title="Edit application workspace"
      description="Update permissioned preparation facts without changing the evidence-backed stage timeline."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel="Save application facts"
      pending={pending}
      error={error}
      draftPersistenceKey={`work-application-${application.id}`}
      onSubmit={async () => {
        setPending(true);
        setError(null);
        try {
          await updateJobApplication(userIds, application.id, {
            expectedRevision: Number(application.revision),
            applicationRoute: {
              name: draft.routeName,
              url: draft.routeUrl || null,
              channel: "unknown",
              instructions: ""
            },
            accountReference: draft.accountReference,
            nextAction: draft.nextAction,
            ownerLabel: draft.ownerLabel,
            blocker: draft.blocker,
            priority: draft.priority,
            referralState: draft.referralState,
            privateContacts: lines(draft.privateContacts).map((value) => ({
              value
            })),
            positioningProfileId: draft.positioningProfileId || null,
            documentSetId: draft.documentSetId || null,
            representations: keyValue(draft.representations),
            unresolvedUserFacts: lines(draft.unresolvedUserFacts).map(
              (fact) => ({ fact })
            ),
            lastContactAt: isoOrNull(draft.lastContactAt),
            nextFollowUpAt: isoOrNull(draft.nextFollowUpAt),
            decisionDeadline: isoOrNull(draft.decisionDeadline),
            expectedResponseAt: isoOrNull(draft.expectedResponseAt),
            employerReason: draft.employerReason,
            inferredExplanation: draft.inferredExplanation,
            lessons: draft.lessons,
            reapplicationDate: draft.reapplicationDate || null,
            provenance
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

export type TransmissionDraft = {
  destinationName: string;
  destinationUrl: string;
  fields: string;
  representations: string;
  unresolvedGates: string;
  expiresInMinutes: string;
};
