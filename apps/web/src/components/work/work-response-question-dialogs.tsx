import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FlowField,
  QuestionFlowDialog
} from "@/components/flows/question-flow-dialog";
import type { QuestionFlowStep } from "@/components/flows/question-flow-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getArtifact, listArtifacts, listArtifactVersions } from "@/lib/api";
import type { ArtifactSummary, ArtifactVersion } from "@/lib/types";
import {
  createWorkSupportingRecord,
  updateWorkSupportingRecord
} from "@/lib/work-api";
import type { WorkRecord } from "@/lib/work-api";
import {
  provenance,
  message,
  recordValue,
  Select
} from "./work-operational-dialog-shared";
import {
  evidenceReferences,
  evidenceReferenceText,
  evidenceReferenceError
} from "./work-document-profile-dialogs";

type ResponseDraft = {
  exactQuestion: string;
  category: string;
  answer: string;
  evidenceReferences: string;
  limitKind: string;
  maximum: string;
  language: string;
  sensitivity: string;
  reviewState: string;
};

function responseDraft(value?: WorkRecord): ResponseDraft {
  const limit = recordValue(value?.limit);
  return {
    exactQuestion: String(value?.exactQuestion ?? ""),
    category: String(value?.normalizedCategory ?? ""),
    answer: String(value?.answer ?? ""),
    evidenceReferences: evidenceReferenceText(value?.evidenceLinks),
    limitKind: String(limit.kind ?? "none"),
    maximum: limit.maximum == null ? "" : String(limit.maximum),
    language: String(value?.language ?? "en"),
    sensitivity: String(value?.sensitivity ?? "normal"),
    reviewState: String(value?.reviewState ?? "draft")
  };
}

export function ReusableResponseDialog({
  open,
  onOpenChange,
  userIds,
  response,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  response?: WorkRecord;
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(() => responseDraft(response));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setDraft(responseDraft(response));
  }, [open, response]);
  const steps = useMemo<Array<QuestionFlowStep<ResponseDraft>>>(
    () => [
      {
        id: "answer",
        eyebrow: "Reusable application answer",
        title: response
          ? "Update the reviewed answer"
          : "Create a reusable answer",
        description:
          "Store the exact question, approved wording, limits, sensitivity, and evidence state. Company-specific motivation should stay application-specific.",
        render: (value, setValue) => (
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label="Exact question" className="md:col-span-2">
              <Textarea
                rows={4}
                value={value.exactQuestion}
                onChange={(event) =>
                  setValue({ exactQuestion: event.target.value })
                }
                autoFocus
              />
            </FlowField>
            <FlowField label="Normalized category">
              <Input
                value={value.category}
                onChange={(event) => setValue({ category: event.target.value })}
              />
            </FlowField>
            <FlowField label="Language">
              <Input
                value={value.language}
                onChange={(event) => setValue({ language: event.target.value })}
              />
            </FlowField>
            <Select
              label="Limit"
              value={value.limitKind}
              onChange={(limitKind) => setValue({ limitKind })}
            >
              {["none", "characters", "words"].map((option) => (
                <option key={option}>{option}</option>
              ))}
            </Select>
            <FlowField label="Maximum">
              <Input
                type="number"
                min="1"
                disabled={value.limitKind === "none"}
                value={value.maximum}
                onChange={(event) => setValue({ maximum: event.target.value })}
              />
            </FlowField>
            <Select
              label="Sensitivity"
              value={value.sensitivity}
              onChange={(sensitivity) => setValue({ sensitivity })}
            >
              {["normal", "private", "protected"].map((option) => (
                <option key={option}>{option}</option>
              ))}
            </Select>
            <Select
              label="Review state"
              value={value.reviewState}
              onChange={(reviewState) => setValue({ reviewState })}
            >
              {["draft", "reviewed", "approved", "retired"].map((option) => (
                <option key={option}>{option}</option>
              ))}
            </Select>
            <FlowField label="Answer" className="md:col-span-2">
              <Textarea
                rows={10}
                value={value.answer}
                onChange={(event) => setValue({ answer: event.target.value })}
              />
            </FlowField>
            <FlowField
              label="Evidence references"
              hint="Optional; one authoritative entityType:entityId per line"
              className="md:col-span-2"
            >
              <Textarea
                rows={4}
                value={value.evidenceReferences}
                onChange={(event) =>
                  setValue({ evidenceReferences: event.target.value })
                }
              />
            </FlowField>
          </div>
        )
      }
    ],
    [response]
  );
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Work · Documents"
      title={response ? "Edit reusable answer" : "Add reusable answer"}
      description="Keep reusable application wording evidence-aware and reviewable."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={response ? "Save new answer revision" : "Add answer"}
      pending={pending}
      error={error}
      draftPersistenceKey={`work-response-${response?.id ?? "new"}`}
      resolveContinueBlocker={() =>
        evidenceReferenceError(draft.evidenceReferences)
      }
      onSubmit={async () => {
        setPending(true);
        setError(null);
        const data = {
          exactQuestion: draft.exactQuestion,
          normalizedCategory: draft.category,
          answer: draft.answer,
          limit: {
            kind: draft.limitKind,
            maximum: draft.limitKind === "none" ? null : Number(draft.maximum)
          },
          language: draft.language,
          evidenceLinks: evidenceReferences(draft.evidenceReferences),
          sensitivity: draft.sensitivity,
          reviewState: draft.reviewState,
          usageHistory: response?.usageHistory ?? [],
          scopeProjectIds: [],
          scopeTagIds: [],
          provenance
        };
        try {
          if (response)
            await updateWorkSupportingRecord(
              userIds,
              "reusableResponse",
              response.id,
              { expectedRevision: Number(response.revision), data }
            );
          else
            await createWorkSupportingRecord(userIds, "reusableResponse", {
              data
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

type QuestionDraft = {
  exactQuestion: string;
  category: string;
  approvedAnswer: string;
  evidenceReferences: string;
  limitKind: string;
  maximum: string;
  language: string;
  sensitivity: string;
  reusableResponseId: string;
  reviewState: string;
};

export function ApplicationQuestionDialog({
  open,
  onOpenChange,
  userIds,
  applicationId,
  question,
  responses,
  onSaved
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userIds: string[];
  applicationId: string;
  question?: WorkRecord;
  responses: WorkRecord[];
  onSaved: () => Promise<void> | void;
}) {
  const makeDraft = (value?: WorkRecord): QuestionDraft => {
    const limit = recordValue(value?.limit);
    return {
      exactQuestion: String(value?.exactQuestion ?? ""),
      category: String(value?.normalizedCategory ?? ""),
      approvedAnswer: String(value?.approvedAnswer ?? ""),
      evidenceReferences: evidenceReferenceText(value?.evidenceLinks),
      limitKind: String(limit.kind ?? "none"),
      maximum: limit.maximum == null ? "" : String(limit.maximum),
      language: String(value?.language ?? "en"),
      sensitivity: String(value?.sensitivity ?? "normal"),
      reusableResponseId: String(value?.reusableResponseId ?? ""),
      reviewState: String(value?.reviewState ?? "draft")
    };
  };
  const [draft, setDraft] = useState(() => makeDraft(question));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setDraft(makeDraft(question));
  }, [open, question]);
  const selectedTemplate = responses.find(
    (response) => response.id === draft.reusableResponseId
  );
  const steps = useMemo<Array<QuestionFlowStep<QuestionDraft>>>(
    () => [
      {
        id: "question",
        eyebrow: "Application question",
        title: question
          ? "Update the application answer"
          : "Add an application question",
        description:
          "Preserve the employer's exact wording. Reusable material may be adapted, but the final answer remains application-specific and reviewed.",
        render: (value, setValue) => (
          <div className="grid gap-4 md:grid-cols-2">
            <FlowField label="Exact question" className="md:col-span-2">
              <Textarea
                rows={4}
                value={value.exactQuestion}
                onChange={(event) =>
                  setValue({ exactQuestion: event.target.value })
                }
                autoFocus
              />
            </FlowField>
            <FlowField label="Category">
              <Input
                value={value.category}
                onChange={(event) => setValue({ category: event.target.value })}
              />
            </FlowField>
            <Select
              label="Reusable source"
              value={value.reusableResponseId}
              onChange={(reusableResponseId) =>
                setValue({ reusableResponseId })
              }
            >
              <option value="">No reusable source</option>
              {responses.map((response) => (
                <option key={response.id} value={response.id}>
                  {String(
                    response.normalizedCategory ??
                      response.exactQuestion ??
                      response.id
                  )}
                </option>
              ))}
            </Select>
            {selectedTemplate ? (
              <div className="md:col-span-2 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ui-ink-faint)]">
                  Reviewed source wording
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--ui-ink-medium)]">
                  {String(selectedTemplate.answer ?? "")}
                </p>
                <Button
                  className="mt-3"
                  size="sm"
                  variant="secondary"
                  type="button"
                  onClick={() =>
                    setValue({
                      approvedAnswer: String(selectedTemplate.answer ?? ""),
                      evidenceReferences: evidenceReferenceText(
                        selectedTemplate.evidenceLinks
                      )
                    })
                  }
                >
                  Use answer and evidence as editable starting point
                </Button>
              </div>
            ) : null}
            <Select
              label="Limit"
              value={value.limitKind}
              onChange={(limitKind) => setValue({ limitKind })}
            >
              {["none", "characters", "words"].map((option) => (
                <option key={option}>{option}</option>
              ))}
            </Select>
            <FlowField label="Maximum">
              <Input
                type="number"
                min="1"
                disabled={value.limitKind === "none"}
                value={value.maximum}
                onChange={(event) => setValue({ maximum: event.target.value })}
              />
            </FlowField>
            <Select
              label="Sensitivity"
              value={value.sensitivity}
              onChange={(sensitivity) => setValue({ sensitivity })}
            >
              {["normal", "private", "protected"].map((option) => (
                <option key={option}>{option}</option>
              ))}
            </Select>
            <Select
              label="Review state"
              value={value.reviewState}
              onChange={(reviewState) => setValue({ reviewState })}
            >
              {["draft", "reviewed", "approved", "submitted"].map((option) => (
                <option key={option}>{option}</option>
              ))}
            </Select>
            <FlowField
              label="Approved application-specific answer"
              className="md:col-span-2"
            >
              <Textarea
                rows={10}
                value={value.approvedAnswer}
                onChange={(event) =>
                  setValue({ approvedAnswer: event.target.value })
                }
              />
            </FlowField>
            <FlowField
              label="Evidence references"
              hint="Optional; one authoritative entityType:entityId per line"
              className="md:col-span-2"
            >
              <Textarea
                rows={4}
                value={value.evidenceReferences}
                onChange={(event) =>
                  setValue({ evidenceReferences: event.target.value })
                }
              />
            </FlowField>
          </div>
        )
      }
    ],
    [question, responses, selectedTemplate]
  );
  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Work · Application"
      title={question ? "Edit application answer" : "Add application question"}
      description="Store exact employer questions and reviewed answers."
      value={draft}
      onChange={setDraft}
      steps={steps}
      submitLabel={question ? "Save answer revision" : "Add question"}
      pending={pending}
      error={error}
      draftPersistenceKey={`work-question-${question?.id ?? applicationId}`}
      resolveContinueBlocker={() =>
        evidenceReferenceError(draft.evidenceReferences)
      }
      onSubmit={async () => {
        setPending(true);
        setError(null);
        const data = {
          exactQuestion: draft.exactQuestion,
          normalizedCategory: draft.category,
          limit: {
            kind: draft.limitKind,
            maximum: draft.limitKind === "none" ? null : Number(draft.maximum)
          },
          language: draft.language,
          sensitivity: draft.sensitivity,
          reusableResponseId: draft.reusableResponseId || null,
          approvedAnswer: draft.approvedAnswer,
          evidenceLinks: evidenceReferences(draft.evidenceReferences),
          reviewState: draft.reviewState,
          useHistory: question?.useHistory ?? []
        };
        try {
          if (question)
            await updateWorkSupportingRecord(
              userIds,
              "applicationQuestion",
              question.id,
              { expectedRevision: Number(question.revision), data }
            );
          else
            await createWorkSupportingRecord(
              userIds,
              "applicationQuestion",
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

export type WorkArtifactVersionReference = {
  artifactId: string;
  artifactVersionId: string | null;
  contentSha256: string;
  artifactType: string;
  language: string;
  label: string;
  approvalState: "draft" | "reviewed" | "approved" | "sealed";
  sealed: boolean;
  confidentiality: "private" | "restricted" | "shareable";
};

export function asArtifactReference(
  value: unknown
): WorkArtifactVersionReference | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.artifactId !== "string" ||
    typeof candidate.contentSha256 !== "string"
  )
    return null;
  return {
    artifactId: candidate.artifactId,
    artifactVersionId:
      typeof candidate.artifactVersionId === "string" &&
      candidate.artifactVersionId
        ? candidate.artifactVersionId
        : null,
    contentSha256: candidate.contentSha256,
    artifactType: String(candidate.artifactType ?? "other"),
    language: String(candidate.language ?? ""),
    label: String(candidate.label ?? candidate.artifactId),
    approvalState: (["draft", "reviewed", "approved", "sealed"].includes(
      String(candidate.approvalState)
    )
      ? candidate.approvalState
      : "reviewed") as WorkArtifactVersionReference["approvalState"],
    sealed: candidate.sealed === true,
    confidentiality: (["private", "restricted", "shareable"].includes(
      String(candidate.confidentiality)
    )
      ? candidate.confidentiality
      : "private") as WorkArtifactVersionReference["confidentiality"]
  };
}

export function ArtifactVersionPicker({
  value,
  onChange,
  single = false
}: {
  value: WorkArtifactVersionReference[];
  onChange: (next: WorkArtifactVersionReference[]) => void;
  single?: boolean;
}) {
  const artifactList = useQuery({
    queryKey: ["work", "artifact-picker"],
    queryFn: () => listArtifacts({ limit: 50 })
  });
  const [artifactId, setArtifactId] = useState("");
  const [versionId, setVersionId] = useState("");
  const artifactQuery = useQuery({
    queryKey: ["work", "artifact-picker", artifactId],
    queryFn: () => getArtifact(artifactId),
    enabled: Boolean(artifactId)
  });
  const versionsQuery = useQuery({
    queryKey: ["work", "artifact-picker", artifactId, "versions"],
    queryFn: () => listArtifactVersions(artifactId, { limit: 100 }),
    enabled: Boolean(artifactId)
  });
  const artifacts = artifactList.data?.artifacts ?? [];
  const artifact = artifactQuery.data?.artifact;
  const versions = versionsQuery.data?.versions ?? [];
  const selectedVersion = versions.find((version) => version.id === versionId);
  const add = () => {
    if (!artifact) return;
    const reference: WorkArtifactVersionReference = {
      artifactId: artifact.id,
      artifactVersionId: selectedVersion?.id ?? null,
      contentSha256: selectedVersion?.contentSha256 ?? artifact.contentSha256,
      artifactType: artifact.formatFamily,
      language: "",
      label: `${artifact.title}${selectedVersion ? ` · version ${selectedVersion.versionNumber}` : " · current"}`,
      approvalState: "reviewed",
      sealed: false,
      confidentiality: "private"
    };
    const withoutSame = value.filter(
      (entry) =>
        !(
          entry.artifactId === reference.artifactId &&
          entry.artifactVersionId === reference.artifactVersionId
        )
    );
    onChange(single ? [reference] : [...withoutSame, reference]);
  };
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Select
          label="Artifact"
          value={artifactId}
          onChange={(id) => {
            setArtifactId(id);
            setVersionId("");
          }}
        >
          <option value="">Choose an Artifact</option>
          {artifacts.map((item: ArtifactSummary) => (
            <option key={item.id} value={item.id}>
              {item.title || item.originalFileName}
            </option>
          ))}
        </Select>
        <Select label="Exact version" value={versionId} onChange={setVersionId}>
          <option value="">Current content</option>
          {versions.map((version: ArtifactVersion) => (
            <option key={version.id} value={version.id}>
              Version {version.versionNumber} ·{" "}
              {version.contentSha256.slice(0, 10)}
            </option>
          ))}
        </Select>
        <div className="flex items-end">
          <Button
            type="button"
            variant="secondary"
            disabled={!artifact || artifact.artifactState !== "active"}
            onClick={add}
          >
            Add exact version
          </Button>
        </div>
      </div>
      {artifactList.error || artifactQuery.error || versionsQuery.error ? (
        <p className="text-sm text-[var(--danger)]">
          {message(
            artifactList.error ?? artifactQuery.error ?? versionsQuery.error
          )}
        </p>
      ) : null}
      <div className="grid gap-2">
        {value.map((entry) => (
          <div
            key={`${entry.artifactId}:${entry.artifactVersionId ?? "current"}`}
            className="flex flex-col gap-2 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-[var(--ui-ink-strong)]">
                {entry.label}
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-[var(--ui-ink-faint)]">
                SHA-256 {entry.contentSha256}
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                onChange(value.filter((candidate) => candidate !== entry))
              }
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
