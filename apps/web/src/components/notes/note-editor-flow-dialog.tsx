import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import {
  EntityLinkMultiSelect,
  type EntityLinkOption
} from "@/components/psyche/entity-link-multiselect";
import { NoteMarkdown } from "@/components/notes/note-markdown";
import { NoteTagsInput } from "@/components/notes/note-tags-input";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  buildDestroyAtFromDelay,
  formatNoteDestroyAtInput,
  normalizeNoteTags,
  parseDateTimeLocalToIso,
  type NoteDestroyDelayUnit
} from "@/lib/note-memory-tags";
import type { CrudEntityType, Note, NoteLink } from "@/lib/types";

const QUESTION_FLOW_DRAFT_STORAGE_PREFIX = "forge.question-flow-draft";
const EMPTY_LINK_VALUES: string[] = [];
const EMPTY_NOTE_LINKS: NoteLink[] = [];
const EMPTY_TAG_VALUES: string[] = [];

export type NoteEditorDraft = {
  title: string;
  contentMarkdown: string;
  author: string;
  linkedValues: string[];
  linkAnchors: Record<string, Array<string | null>>;
  tags: string[];
  observedAtInput: string;
  destroyAtInput: string;
  destroyDelayValue: string;
  destroyDelayUnit: NoteDestroyDelayUnit;
  baseRevisionHash: string | null;
};

type NoteEditorSource = Pick<Note, "id" | "title"> &
  Partial<
    Pick<
      Note,
      | "contentMarkdown"
      | "author"
      | "links"
      | "tags"
      | "frontmatter"
      | "destroyAt"
      | "revisionHash"
    >
  >;

function uniqueValues(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean))
  );
}

function encodeNoteLinkValue(link: Pick<NoteLink, "entityType" | "entityId">) {
  return `${link.entityType}:${link.entityId}`;
}

export function resolveNoteDraftLinks(draft: NoteEditorDraft): NoteLink[] {
  return uniqueValues(draft.linkedValues).flatMap((value) => {
    const separatorIndex = value.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex >= value.length - 1) {
      return [];
    }
    const anchors = draft.linkAnchors?.[value] ?? [null];
    return anchors.map((anchorKey) => ({
      entityType: value.slice(0, separatorIndex) as CrudEntityType,
      entityId: value.slice(separatorIndex + 1),
      anchorKey
    }));
  });
}

function observedAtFromNote(note: NoteEditorSource | null) {
  const observedAt = note?.frontmatter?.observedAt;
  return typeof observedAt === "string"
    ? formatNoteDestroyAtInput(observedAt)
    : "";
}

export function buildNoteEditorDraft(
  note: NoteEditorSource | null,
  initialLinkedValues: string[] = []
): NoteEditorDraft {
  return {
    title: note?.title ?? "",
    contentMarkdown: note?.contentMarkdown ?? "",
    author: note?.author ?? "",
    linkedValues: uniqueValues(
      note ? (note.links ?? []).map(encodeNoteLinkValue) : initialLinkedValues
    ),
    linkAnchors: Object.fromEntries(
      uniqueValues((note?.links ?? []).map(encodeNoteLinkValue)).map(
        (value) => [
          value,
          (note?.links ?? [])
            .filter((link) => encodeNoteLinkValue(link) === value)
            .map((link) => link.anchorKey ?? null)
        ]
      )
    ),
    tags: normalizeNoteTags(note?.tags ?? []),
    observedAtInput: observedAtFromNote(note),
    destroyAtInput: formatNoteDestroyAtInput(note?.destroyAt ?? null),
    destroyDelayValue: "",
    destroyDelayUnit: "days",
    baseRevisionHash: note?.revisionHash ?? null
  };
}

export function resolveNoteDraftDestroyAt(draft: NoteEditorDraft) {
  return (
    parseDateTimeLocalToIso(draft.destroyAtInput) ??
    buildDestroyAtFromDelay(draft.destroyDelayValue, draft.destroyDelayUnit)
  );
}

export function resolveNoteDraftFrontmatter(
  draft: NoteEditorDraft,
  existing: Record<string, unknown> = {}
) {
  const next = { ...existing };
  const observedAt = parseDateTimeLocalToIso(draft.observedAtInput);
  if (observedAt) {
    next.observedAt = observedAt;
  } else {
    delete next.observedAt;
  }
  return next;
}

function clearPersistedDraft(draftPersistenceKey: string) {
  try {
    window.localStorage.removeItem(
      `${QUESTION_FLOW_DRAFT_STORAGE_PREFIX}.${draftPersistenceKey}`
    );
  } catch {
    // Saving the note must not fail because local draft cleanup is unavailable.
  }
}

export function NoteEditorFlowDialog({
  open,
  note,
  initialLinkedValues = EMPTY_LINK_VALUES,
  lockedLinkedValues = EMPTY_LINK_VALUES,
  lockedLinks = EMPTY_NOTE_LINKS,
  entityOptions,
  onSearchEntityOptions,
  availableTags = EMPTY_TAG_VALUES,
  draftScopeKey = "library",
  onOpenChange,
  onSubmit
}: {
  open: boolean;
  note: NoteEditorSource | null;
  initialLinkedValues?: string[];
  lockedLinkedValues?: string[];
  lockedLinks?: NoteLink[];
  entityOptions: EntityLinkOption[];
  onSearchEntityOptions?: (query: string) => Promise<EntityLinkOption[]>;
  availableTags?: string[];
  draftScopeKey?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (draft: NoteEditorDraft) => Promise<void>;
}) {
  const requiredLinks = useMemo(
    () =>
      uniqueValues([
        ...lockedLinkedValues,
        ...lockedLinks.map(encodeNoteLinkValue)
      ]),
    [lockedLinkedValues, lockedLinks]
  );
  const requiredLinkAnchors = useMemo(
    () =>
      Object.fromEntries(
        uniqueValues(lockedLinks.map(encodeNoteLinkValue)).map((value) => [
          value,
          lockedLinks
            .filter((link) => encodeNoteLinkValue(link) === value)
            .map((link) => link.anchorKey ?? null)
        ])
      ),
    [lockedLinks]
  );
  const normalizedInitialLinks = useMemo(
    () => uniqueValues([...initialLinkedValues, ...requiredLinks]),
    [initialLinkedValues, requiredLinks]
  );
  const initialDraft = useMemo(() => {
    const next = buildNoteEditorDraft(note, normalizedInitialLinks);
    next.linkedValues = uniqueValues([...next.linkedValues, ...requiredLinks]);
    next.linkAnchors = {
      ...next.linkAnchors,
      ...requiredLinkAnchors
    };
    return next;
  }, [normalizedInitialLinks, note, requiredLinkAnchors, requiredLinks]);
  const noteId = note?.id ?? "new";
  const draftPersistenceKey = `notes.${draftScopeKey}.${noteId}`;
  const editorIdentityKey = useMemo(
    () =>
      JSON.stringify({
        draftPersistenceKey,
        normalizedInitialLinks,
        requiredLinkAnchors,
        requiredLinks
      }),
    [
      draftPersistenceKey,
      normalizedInitialLinks,
      requiredLinkAnchors,
      requiredLinks
    ]
  );
  const [draft, setDraft] = useState<NoteEditorDraft>(() => initialDraft);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submitInFlightRef = useRef(false);
  const previousEditorIdentityRef = useRef(editorIdentityKey);
  const previousRevisionRef = useRef(note?.revisionHash ?? null);
  const deferredBaselineRefreshRef = useRef(false);

  useEffect(() => {
    const nextRevision = note?.revisionHash ?? null;
    const identityChanged =
      previousEditorIdentityRef.current !== editorIdentityKey;
    const revisionChanged = previousRevisionRef.current !== nextRevision;

    previousEditorIdentityRef.current = editorIdentityKey;
    previousRevisionRef.current = nextRevision;

    if (identityChanged || (revisionChanged && !open)) {
      setDraft(initialDraft);
      setError(null);
      setPending(false);
      submitInFlightRef.current = false;
      deferredBaselineRefreshRef.current = false;
      return;
    }

    if (revisionChanged && open) {
      deferredBaselineRefreshRef.current = true;
      return;
    }

    if (!open && deferredBaselineRefreshRef.current) {
      setDraft(initialDraft);
      setError(null);
      setPending(false);
      submitInFlightRef.current = false;
      deferredBaselineRefreshRef.current = false;
    }
  }, [editorIdentityKey, initialDraft, note?.revisionHash, open]);

  const steps: Array<QuestionFlowStep<NoteEditorDraft>> = [
    {
      id: "write",
      eyebrow: note ? "Edit" : "Capture",
      title: note
        ? "What should this note say now?"
        : "What needs to remain available?",
      description:
        "Write the durable prose first. Forge keeps Markdown as the source and derives the searchable plain-text version.",
      render: (value, setValue) => (
        <>
          <FlowField
            label="Title"
            description="Optional. Forge derives a concise title from the note when this is blank."
          >
            <Input
              value={value.title}
              onChange={(event) => setValue({ title: event.target.value })}
              placeholder="Research handoff"
              autoComplete="off"
            />
          </FlowField>
          <FlowField label="Note" hint="Markdown is supported.">
            <Textarea
              value={value.contentMarkdown}
              onChange={(event) =>
                setValue({ contentMarkdown: event.target.value })
              }
              className="min-h-[18rem] resize-y"
              placeholder="Write what happened, what it means, or what should be remembered."
            />
          </FlowField>
        </>
      )
    },
    {
      id: "context",
      eyebrow: "Connections",
      title: "Where should this note be found again?",
      description:
        "Connect the note to any relevant Forge records. A note can also stand alone and be linked later.",
      render: (value, setValue) => (
        <>
          <FlowField label="Linked records">
            <EntityLinkMultiSelect
              options={entityOptions}
              onSearch={onSearchEntityOptions}
              selectedValues={value.linkedValues}
              onChange={(values) => {
                const linkedValues = uniqueValues([
                  ...values,
                  ...requiredLinks
                ]);
                setValue({
                  linkedValues,
                  linkAnchors: Object.fromEntries(
                    linkedValues.map((linkedValue) => [
                      linkedValue,
                      requiredLinkAnchors[linkedValue] ??
                        value.linkAnchors?.[linkedValue] ?? [null]
                    ])
                  )
                });
              }}
              placeholder="Find goals, projects, people, Psyche records, notes, or other Forge records"
              emptyMessage="No matching Forge records found."
            />
          </FlowField>
          {requiredLinks.length > 0 ? (
            <div className="rounded-[var(--radius-panel)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
              The record you opened this editor from stays linked to the note.
            </div>
          ) : null}
          <FlowField
            label="Author"
            description="Optional display attribution. Forge ownership remains separate."
          >
            <Input
              value={value.author}
              onChange={(event) => setValue({ author: event.target.value })}
              placeholder="Albert"
              autoComplete="off"
            />
          </FlowField>
        </>
      )
    },
    {
      id: "organize",
      eyebrow: "Retrieval",
      title: "How should Forge organize and date it?",
      description:
        "Tags help retrieval. The observed time records when the note is about, which can differ from when it was written.",
      render: (value, setValue) => (
        <>
          <FlowField label="Tags">
            <NoteTagsInput
              value={value.tags}
              availableTags={availableTags}
              onChange={(tags) => setValue({ tags })}
            />
          </FlowField>
          <FlowField
            label="Observed at"
            description="Optional. Leave blank when the note is about the present writing moment."
          >
            <Input
              type="datetime-local"
              value={value.observedAtInput}
              onChange={(event) =>
                setValue({ observedAtInput: event.target.value })
              }
            />
          </FlowField>
          <div className="grid min-w-0 gap-4 rounded-[var(--radius-panel)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4">
            <div>
              <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
                Automatic deletion
              </div>
              <div className="mt-1 text-sm leading-6 text-[var(--ui-ink-soft)]">
                Leave both fields blank for a durable note. Setting either field
                makes it ephemeral.
              </div>
            </div>
            <FlowField label="Delete at">
              <Input
                type="datetime-local"
                value={value.destroyAtInput}
                onChange={(event) =>
                  setValue({ destroyAtInput: event.target.value })
                }
              />
            </FlowField>
            <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <FlowField label="Or delete after">
                <Input
                  type="number"
                  min="1"
                  value={value.destroyDelayValue}
                  onChange={(event) =>
                    setValue({ destroyDelayValue: event.target.value })
                  }
                  placeholder="Amount"
                />
              </FlowField>
              <FlowField label="Unit">
                <select
                  className="min-h-11 w-full rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-2 text-sm text-[var(--ui-ink-strong)] outline-none transition focus:border-[var(--ui-border-strong)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_42%,transparent)]"
                  value={value.destroyDelayUnit}
                  onChange={(event) =>
                    setValue({
                      destroyDelayUnit: event.target
                        .value as NoteDestroyDelayUnit
                    })
                  }
                >
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                </select>
              </FlowField>
            </div>
          </div>
        </>
      )
    },
    {
      id: "review",
      eyebrow: "Review",
      title: "Check the note before saving",
      description:
        "The editor draft is saved locally while this flow is open or closed. Saving writes the canonical Forge record.",
      render: (value) => (
        <div className="grid min-w-0 gap-4">
          <div className="min-w-0 max-w-full overflow-hidden rounded-[var(--radius-panel)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
            <div className="min-w-0 max-w-full break-words whitespace-normal text-base font-semibold text-[var(--ui-ink-strong)] [overflow-wrap:anywhere]">
              {value.title.trim() || "Title will be inferred"}
            </div>
            <div className="mt-4 min-w-0">
              <NoteMarkdown markdown={value.contentMarkdown} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
              {value.linkedValues.length} linked
            </Badge>
            <Badge className="bg-[var(--ui-info-soft)] text-[var(--ui-ink-medium)]">
              {value.tags.length} tags
            </Badge>
            <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
              {resolveNoteDraftDestroyAt(value) ? "Ephemeral" : "Durable"}
            </Badge>
          </div>
        </div>
      )
    }
  ];

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow="Notes"
      title={note ? "Edit note" : "Create note"}
      description="Write, connect, organize, and review a Markdown note."
      value={draft}
      onChange={(next) => {
        setDraft({
          ...next,
          linkedValues: uniqueValues([...next.linkedValues, ...requiredLinks]),
          linkAnchors: {
            ...(next.linkAnchors ?? {}),
            ...requiredLinkAnchors
          }
        });
      }}
      steps={steps}
      draftPersistenceKey={draftPersistenceKey}
      submitLabel={note ? "Save changes" : "Create note"}
      pending={pending}
      pendingLabel="Saving"
      error={error}
      resolveContinueBlocker={(stepId, value) =>
        stepId === "write" && !value.contentMarkdown.trim()
          ? "Write the note before continuing."
          : null
      }
      onSubmit={async () => {
        if (submitInFlightRef.current) {
          return;
        }
        if (!draft.contentMarkdown.trim()) {
          setError("Write the note before saving.");
          return;
        }
        submitInFlightRef.current = true;
        setPending(true);
        setError(null);
        try {
          await onSubmit({
            ...draft,
            title: draft.title.trim(),
            contentMarkdown: draft.contentMarkdown.trim(),
            author: draft.author.trim(),
            linkedValues: uniqueValues([
              ...draft.linkedValues,
              ...requiredLinks
            ]),
            linkAnchors: {
              ...(draft.linkAnchors ?? {}),
              ...requiredLinkAnchors
            },
            tags: normalizeNoteTags(draft.tags)
          });
          clearPersistedDraft(draftPersistenceKey);
          onOpenChange(false);
        } catch (nextError) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Forge could not save this note. Your local draft is still available."
          );
        } finally {
          submitInFlightRef.current = false;
          setPending(false);
        }
      }}
    />
  );
}
