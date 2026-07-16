import { useCallback, useMemo, useState } from "react";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { GitRefPicker, type DraftGitRef } from "@/components/git-ref-picker";
import { EntityLinkMultiSelect } from "@/components/psyche/entity-link-multiselect";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  decodeNoteLinkOptionValue,
  searchNoteLinkOptions
} from "@/lib/note-link-options";
import type {
  NoteLink,
  Task,
  TaskRun,
  TaskRunCompleteInput,
  WorkItemCompletionReport
} from "@/lib/types";

const MAX_CLOSEOUT_FILES = 200;
const MAX_CLOSEOUT_FILE_LENGTH = 512;
const MAX_WORK_SUMMARY_LENGTH = 4_000;
const MAX_CLOSEOUT_NOTE_LENGTH = 16_000;
const MAX_ADDITIONAL_CLOSEOUT_LINKS = 63;
const QUESTION_FLOW_DRAFT_STORAGE_PREFIX = "forge.question-flow-draft";

export type TaskCloseoutMode = "capture_now" | "defer";

export type TaskCloseoutDraft = {
  mode: TaskCloseoutMode;
  workSummary: string;
  modifiedFilesText: string;
  gitRefs: DraftGitRef[];
  noteMode: "none" | "create";
  noteContentMarkdown: string;
  noteAuthor: string;
  linkedValues: string[];
  completedTodayMinutes: string;
};

export type TaskCloseoutSubmission = {
  mode: TaskCloseoutMode;
  completionReport?: WorkItemCompletionReport;
  gitRefs?: DraftGitRef[];
  closeoutNote?: {
    contentMarkdown: string;
    author?: string | null;
    links: NoteLink[];
  };
  completedTodayWorkSeconds?: number;
};

export type TaskCloseoutEvidencePayload = Pick<
  TaskRunCompleteInput,
  "completionReport" | "gitRefs" | "closeoutNote"
>;

export function buildTaskCloseoutEvidencePayload(
  submission: TaskCloseoutSubmission
): TaskCloseoutEvidencePayload {
  if (submission.mode === "defer") {
    return {
      completionReport: {
        modifiedFiles: [],
        workSummary: "",
        linkedGitRefIds: []
      },
      gitRefs: []
    };
  }
  return {
    completionReport: submission.completionReport,
    gitRefs: submission.gitRefs,
    closeoutNote: submission.closeoutNote
  };
}

function uniqueTrimmedLines(value: string) {
  return Array.from(
    new Set(
      value
        .split("\n")
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

export function getModifiedFileValidationError(value: string) {
  const files = uniqueTrimmedLines(value);
  if (files.length > MAX_CLOSEOUT_FILES) {
    return `Keep the closeout to ${MAX_CLOSEOUT_FILES} modified files or fewer.`;
  }
  const invalidFile = files.find(
    (file) =>
      file.length > MAX_CLOSEOUT_FILE_LENGTH ||
      file.startsWith("/") ||
      file.includes("\\") ||
      file.split("/").includes("..") ||
      Array.from(file).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || codePoint === 127;
      })
  );
  return invalidFile
    ? "Use repository-relative file paths without parent traversal, backslashes, control characters, or paths over 512 characters."
    : null;
}

function initialGitRefs(task: Task): DraftGitRef[] {
  const linkedIds = new Set(task.completionReport?.linkedGitRefIds ?? []);
  const refs =
    linkedIds.size > 0
      ? task.gitRefs.filter((ref) => linkedIds.has(ref.id))
      : [];
  return refs.map((ref) => ({
    id: ref.id,
    workItemId: ref.workItemId,
    refType: ref.refType,
    provider: ref.provider,
    repository: ref.repository,
    refValue: ref.refValue,
    url: ref.url,
    displayTitle: ref.displayTitle
  }));
}

export function buildTaskCloseoutDraft(
  task: Task,
  activeTaskRun: TaskRun | null,
  requireWorkTime: boolean
): TaskCloseoutDraft {
  return {
    mode: "capture_now",
    workSummary: task.completionReport?.workSummary ?? "",
    modifiedFilesText: task.completionReport?.modifiedFiles.join("\n") ?? "",
    gitRefs: initialGitRefs(task),
    noteMode: "none",
    noteContentMarkdown: "",
    noteAuthor: activeTaskRun?.actor ?? task.owner,
    linkedValues: [],
    completedTodayMinutes: requireWorkTime ? "" : "0"
  };
}

function buildCloseoutNoteLinks(taskId: string, values: string[]): NoteLink[] {
  const links = new Map<string, NoteLink>();
  const taskLink: NoteLink = {
    entityType: "task",
    entityId: taskId,
    anchorKey: null
  };
  links.set(`task:${taskId}`, taskLink);
  for (const value of values) {
    const decoded = decodeNoteLinkOptionValue(value);
    if (!decoded) {
      continue;
    }
    links.set(`${decoded.entityType}:${decoded.entityId}`, {
      entityType: decoded.entityType,
      entityId: decoded.entityId,
      anchorKey: null
    });
  }
  return Array.from(links.values());
}

export function buildTaskCloseoutSubmission(
  taskId: string,
  draft: TaskCloseoutDraft,
  requireWorkTime: boolean
): TaskCloseoutSubmission {
  const completedTodayMinutes = Number(draft.completedTodayMinutes);
  const completedTodayWorkSeconds = requireWorkTime
    ? Math.round(completedTodayMinutes * 60)
    : undefined;

  if (draft.mode === "defer") {
    return {
      mode: "defer",
      completedTodayWorkSeconds
    };
  }

  const gitRefs = draft.gitRefs.map((ref) => ({ ...ref }));
  return {
    mode: "capture_now",
    completionReport: {
      modifiedFiles: uniqueTrimmedLines(draft.modifiedFilesText),
      workSummary: draft.workSummary.trim(),
      linkedGitRefIds: gitRefs
        .map((ref) => ref.id?.trim())
        .filter((id): id is string => Boolean(id))
    },
    gitRefs,
    closeoutNote:
      draft.noteMode === "create"
        ? {
            contentMarkdown: draft.noteContentMarkdown.trim(),
            author: draft.noteAuthor.trim() || null,
            links: buildCloseoutNoteLinks(taskId, draft.linkedValues)
          }
        : undefined,
    completedTodayWorkSeconds
  };
}

function clearPersistedDraft(key: string) {
  try {
    window.localStorage.removeItem(
      `${QUESTION_FLOW_DRAFT_STORAGE_PREFIX}.${key}`
    );
  } catch {
    // A completed closeout must not fail because local draft cleanup is blocked.
  }
}

export function TaskCloseoutFlowDialog({
  open,
  task,
  activeTaskRun,
  selectedUserIds,
  requireWorkTime,
  pending,
  error,
  onOpenChange,
  onSubmit
}: {
  open: boolean;
  task: Task;
  activeTaskRun: TaskRun | null;
  selectedUserIds: string[];
  requireWorkTime: boolean;
  pending: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (submission: TaskCloseoutSubmission) => Promise<void>;
}) {
  const baseline = useMemo(
    () => buildTaskCloseoutDraft(task, activeTaskRun, requireWorkTime),
    [activeTaskRun, requireWorkTime, task]
  );
  const [draft, setDraft] = useState<TaskCloseoutDraft>(baseline);
  const draftPersistenceKey = `task-closeout.${task.id}.${activeTaskRun?.id ?? "direct"}`;

  const searchLinks = useCallback(
    (query: string) => searchNoteLinkOptions(query, selectedUserIds),
    [selectedUserIds]
  );

  const steps = useMemo<Array<QuestionFlowStep<TaskCloseoutDraft>>>(() => {
    const nextSteps: Array<QuestionFlowStep<TaskCloseoutDraft>> = [
      {
        id: "decision",
        eyebrow: "Closeout",
        title: "Record the result now or finish without evidence?",
        description:
          "Closing the task is immediate. You can capture the result now or explicitly leave the closeout for later.",
        render: (value, setValue) => (
          <FlowChoiceGrid
            value={value.mode}
            onChange={(mode) => setValue({ mode: mode as TaskCloseoutMode })}
            options={[
              {
                value: "capture_now",
                label: "Capture the result now",
                description:
                  "Save what changed, the relevant files and Git references, and an optional linked note."
              },
              {
                value: "defer",
                label: "Finish and defer evidence",
                description:
                  "Close the task now and mark its closeout as still needing evidence."
              }
            ]}
          />
        )
      }
    ];

    if (draft.mode === "capture_now") {
      nextSteps.push(
        {
          id: "result",
          eyebrow: "Result",
          title: "What is now true because this task is complete?",
          description:
            "Write a concise result that another person or agent can verify without reconstructing the work session.",
          render: (value, setValue) => (
            <FlowField
              label="Work summary"
              hint={`${value.workSummary.length}/${MAX_WORK_SUMMARY_LENGTH} characters`}
            >
              <Textarea
                value={value.workSummary}
                maxLength={MAX_WORK_SUMMARY_LENGTH}
                className="min-h-32"
                onChange={(event) =>
                  setValue({ workSummary: event.target.value })
                }
                placeholder="State the completed result and any important limitation."
              />
            </FlowField>
          )
        },
        {
          id: "evidence",
          eyebrow: "Evidence",
          title: "Which files and Git references support this result?",
          description:
            "Add only the evidence that helps someone inspect or continue the work. Both fields are optional.",
          render: (value, setValue) => (
            <>
              <FlowField
                label="Modified files"
                hint={`${uniqueTrimmedLines(value.modifiedFilesText).length}/${MAX_CLOSEOUT_FILES} files. Use one repository-relative path per line.`}
              >
                <Textarea
                  value={value.modifiedFilesText}
                  className="min-h-40 font-mono text-[13px]"
                  onChange={(event) =>
                    setValue({ modifiedFilesText: event.target.value })
                  }
                  placeholder={
                    "apps/web/src/pages/task-detail-page.tsx\napps/api/src/routes/tasks.ts"
                  }
                />
              </FlowField>
              <div className="grid gap-2">
                <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                  Git references
                </div>
                <GitRefPicker
                  selectedRefs={value.gitRefs}
                  onChange={(gitRefs) => setValue({ gitRefs })}
                />
              </div>
            </>
          )
        },
        {
          id: "note",
          eyebrow: "Memory",
          title: "Should this closeout also become a linked note?",
          description:
            "A note is useful when the result needs explanation, handoff context, or links to other Forge records.",
          render: (value, setValue) => (
            <>
              <FlowChoiceGrid
                value={value.noteMode}
                onChange={(noteMode) =>
                  setValue({
                    noteMode: noteMode as TaskCloseoutDraft["noteMode"]
                  })
                }
                options={[
                  {
                    value: "none",
                    label: "Structured closeout only",
                    description:
                      "Keep the summary, files, and Git references on the task."
                  },
                  {
                    value: "create",
                    label: "Create a linked note",
                    description:
                      "Save durable Markdown context linked to this task and any other selected records."
                  }
                ]}
              />
              {value.noteMode === "create" ? (
                <>
                  <FlowField
                    label="Closeout note"
                    hint={`${value.noteContentMarkdown.length}/${MAX_CLOSEOUT_NOTE_LENGTH} characters. Markdown is supported.`}
                  >
                    <Textarea
                      value={value.noteContentMarkdown}
                      maxLength={MAX_CLOSEOUT_NOTE_LENGTH}
                      className="min-h-48"
                      onChange={(event) =>
                        setValue({ noteContentMarkdown: event.target.value })
                      }
                      placeholder="Capture decisions, limitations, verification, or handoff context."
                    />
                  </FlowField>
                  <div className="grid gap-2">
                    <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                      Linked records
                    </div>
                    <EntityLinkMultiSelect
                      selectedValues={value.linkedValues}
                      onChange={(linkedValues) => setValue({ linkedValues })}
                      onSearch={searchLinks}
                      placeholder="Find goals, projects, artifacts, people, Psyche records, or other Forge records"
                      emptyMessage="No matching Forge records found."
                    />
                  </div>
                  <FlowField label="Author">
                    <Input
                      value={value.noteAuthor}
                      onChange={(event) =>
                        setValue({ noteAuthor: event.target.value })
                      }
                      placeholder={task.owner}
                    />
                  </FlowField>
                </>
              ) : null}
            </>
          )
        }
      );
    }

    if (requireWorkTime) {
      nextSteps.push({
        id: "time",
        eyebrow: "Time",
        title: "How much work should be logged for today?",
        description:
          "Use the time actually worked today. Enter 0 when the work was completed earlier.",
        render: (value, setValue) => (
          <>
            <FlowChoiceGrid
              value={value.completedTodayMinutes}
              onChange={(completedTodayMinutes) =>
                setValue({ completedTodayMinutes })
              }
              columns={3}
              options={[
                { value: "0", label: "No work today" },
                { value: "15", label: "15 minutes" },
                { value: "30", label: "30 minutes" },
                { value: "60", label: "1 hour" },
                { value: "120", label: "2 hours" },
                { value: "", label: "Custom" }
              ]}
            />
            <FlowField label="Minutes worked today">
              <Input
                type="number"
                min={0}
                max={1_440}
                step={5}
                value={value.completedTodayMinutes}
                onChange={(event) =>
                  setValue({ completedTodayMinutes: event.target.value })
                }
                placeholder="45"
              />
            </FlowField>
          </>
        )
      });
    }

    nextSteps.push({
      id: "review",
      eyebrow: "Review",
      title: "Close this task?",
      description:
        "Review the closeout before Forge changes the task and active work session.",
      render: (value) => {
        const files = uniqueTrimmedLines(value.modifiedFilesText);
        return (
          <div className="grid gap-4 text-sm leading-6 text-[var(--ui-ink-soft)]">
            <div className="flex flex-wrap gap-2">
              <Badge>
                {value.mode === "capture_now"
                  ? "Evidence captured"
                  : "Evidence deferred"}
              </Badge>
              {requireWorkTime ? (
                <Badge>{value.completedTodayMinutes || "0"} min today</Badge>
              ) : activeTaskRun ? (
                <Badge>
                  {Math.round(activeTaskRun.creditedSeconds / 60)} min tracked
                </Badge>
              ) : null}
            </div>
            <dl className="grid gap-3">
              <div>
                <dt className="font-medium text-[var(--ui-ink-strong)]">
                  Task
                </dt>
                <dd className="break-words [overflow-wrap:anywhere]">
                  {task.title}
                </dd>
              </div>
              {value.mode === "capture_now" ? (
                <>
                  <div>
                    <dt className="font-medium text-[var(--ui-ink-strong)]">
                      Result
                    </dt>
                    <dd className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {value.workSummary.trim()}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-[var(--ui-ink-strong)]">
                      Evidence
                    </dt>
                    <dd>
                      {files.length} file{files.length === 1 ? "" : "s"},{" "}
                      {value.gitRefs.length} Git reference
                      {value.gitRefs.length === 1 ? "" : "s"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-[var(--ui-ink-strong)]">
                      Linked note
                    </dt>
                    <dd>
                      {value.noteMode === "create"
                        ? `Yes, with ${value.linkedValues.length} additional linked record${value.linkedValues.length === 1 ? "" : "s"}`
                        : "No"}
                    </dd>
                  </div>
                </>
              ) : (
                <div>
                  <dt className="font-medium text-[var(--ui-ink-strong)]">
                    Evidence
                  </dt>
                  <dd>
                    Deferred. Forge will keep the missing closeout visible after
                    the task is closed.
                  </dd>
                </div>
              )}
            </dl>
          </div>
        );
      }
    });

    return nextSteps;
  }, [
    activeTaskRun,
    draft.mode,
    requireWorkTime,
    searchLinks,
    task.owner,
    task.title
  ]);

  const resolveBlocker = (stepId: string, value: TaskCloseoutDraft) => {
    if (
      stepId === "result" &&
      value.mode === "capture_now" &&
      !value.workSummary.trim()
    ) {
      return "Write the completed result before continuing, or go back and defer the evidence.";
    }
    if (
      stepId === "evidence" &&
      getModifiedFileValidationError(value.modifiedFilesText)
    ) {
      return getModifiedFileValidationError(value.modifiedFilesText);
    }
    if (
      stepId === "note" &&
      value.noteMode === "create" &&
      !value.noteContentMarkdown.trim()
    ) {
      return "Write the note, or choose structured closeout only.";
    }
    if (
      stepId === "note" &&
      value.linkedValues.length > MAX_ADDITIONAL_CLOSEOUT_LINKS
    ) {
      return `Keep the closeout note to ${MAX_ADDITIONAL_CLOSEOUT_LINKS} additional linked records or fewer.`;
    }
    if (
      stepId === "time" &&
      (!value.completedTodayMinutes.trim() ||
        !Number.isFinite(Number(value.completedTodayMinutes)) ||
        Number(value.completedTodayMinutes) < 0 ||
        Number(value.completedTodayMinutes) > 1_440)
    ) {
      return "Enter between 0 and 1,440 minutes worked today.";
    }
    return null;
  };

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Task closeout"
      title="Finish the task"
      description={`Close “${task.title}” with an explicit evidence decision.`}
      value={draft}
      onChange={setDraft}
      steps={steps}
      draftPersistenceKey={draftPersistenceKey}
      pending={pending}
      pendingLabel="Closing task"
      error={error}
      resolveContinueBlocker={resolveBlocker}
      submitLabel="Complete task"
      onSubmit={async () => {
        try {
          await onSubmit(
            buildTaskCloseoutSubmission(task.id, draft, requireWorkTime)
          );
        } catch {
          return;
        }
        clearPersistedDraft(draftPersistenceKey);
        setDraft(baseline);
      }}
    />
  );
}
