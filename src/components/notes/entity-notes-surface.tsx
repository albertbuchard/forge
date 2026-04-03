import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Pencil, Plus, Search, Trash2 } from "lucide-react";
import {
  createNote,
  deleteNote,
  listBehaviors,
  listBehaviorPatterns,
  listBeliefs,
  listModes,
  listNotes,
  listPsycheValues,
  listTriggerReports,
  patchNote
} from "@/lib/api";
import {
  formatAnchorKeyLabel,
  formatEntityTypeLabel,
  formatNotesCountLabel,
  getAnchorKeyHelpText
} from "@/lib/note-helpers";
import type { CrudEntityType, Note, NoteLink } from "@/lib/types";
import { useForgeShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { NoteMarkdown } from "./note-markdown";
import { NoteTagsInput } from "./note-tags-input";
import {
  buildDestroyAtFromDelay,
  formatNoteDestroyAtInput,
  normalizeNoteTags,
  parseDateTimeLocalToIso,
  type NoteDestroyDelayUnit
} from "@/lib/note-memory-tags";

type LinkDraft = {
  entityType: CrudEntityType;
  entityId: string;
};

function describeLinkedEntities(
  note: Note,
  currentEntityType: CrudEntityType,
  currentEntityId: string
) {
  return note.links.filter(
    (link) =>
      !(
        link.entityType === currentEntityType &&
        link.entityId === currentEntityId
      )
  );
}

function sameLink(left: NoteLink, right: NoteLink) {
  return (
    left.entityType === right.entityType &&
    left.entityId === right.entityId &&
    (left.anchorKey ?? null) === (right.anchorKey ?? null)
  );
}

function dedupeLinks(links: NoteLink[]) {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = `${link.entityType}:${link.entityId}:${link.anchorKey ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function resolveDestroyAt(
  destroyAtInput: string,
  destroyDelayValue: string,
  destroyDelayUnit: NoteDestroyDelayUnit
) {
  return (
    parseDateTimeLocalToIso(destroyAtInput) ??
    buildDestroyAtFromDelay(destroyDelayValue, destroyDelayUnit)
  );
}

export function EntityNotesSurface({
  entityType,
  entityId,
  anchorKey,
  includeAnchorlessWhenAnchored = false,
  title = "Notes",
  description = "Markdown notes linked to this entity stay searchable, editable, and visible alongside the work.",
  invalidateQueryKeys = [],
  compact = false
}: {
  entityType: CrudEntityType;
  entityId: string;
  anchorKey?: string | null;
  includeAnchorlessWhenAnchored?: boolean;
  title?: string;
  description?: string;
  invalidateQueryKeys?: Array<readonly unknown[]>;
  compact?: boolean;
}) {
  const shell = useForgeShell();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerValue, setComposerValue] = useState("");
  const [composerPreviewOpen, setComposerPreviewOpen] = useState(false);
  const [composerLinkDraft, setComposerLinkDraft] = useState<LinkDraft>({
    entityType: "goal",
    entityId: ""
  });
  const [composerExtraLinks, setComposerExtraLinks] = useState<NoteLink[]>([]);
  const [composerTags, setComposerTags] = useState<string[]>([]);
  const [composerDestroyAtInput, setComposerDestroyAtInput] = useState("");
  const [composerDestroyDelayValue, setComposerDestroyDelayValue] =
    useState("");
  const [composerDestroyDelayUnit, setComposerDestroyDelayUnit] =
    useState<NoteDestroyDelayUnit>("days");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [editingPreviewOpen, setEditingPreviewOpen] = useState(false);
  const [editingLinks, setEditingLinks] = useState<NoteLink[]>([]);
  const [editingLinkDraft, setEditingLinkDraft] = useState<LinkDraft>({
    entityType: "goal",
    entityId: ""
  });
  const [editingTags, setEditingTags] = useState<string[]>([]);
  const [editingDestroyAtInput, setEditingDestroyAtInput] = useState("");
  const [editingDestroyDelayValue, setEditingDestroyDelayValue] = useState("");
  const [editingDestroyDelayUnit, setEditingDestroyDelayUnit] =
    useState<NoteDestroyDelayUnit>("days");
  const currentAnchorLabel = formatAnchorKeyLabel(anchorKey);
  const currentAnchorHelp = getAnchorKeyHelpText(entityType, anchorKey);

  const notesQuery = useQuery({
    queryKey: ["notes", entityType, entityId],
    queryFn: () =>
      listNotes({
        linkedEntityType: entityType,
        linkedEntityId: entityId,
        limit: 100
      })
  });
  const valuesQuery = useQuery({
    queryKey: ["forge-psyche-values"],
    queryFn: listPsycheValues
  });
  const patternsQuery = useQuery({
    queryKey: ["forge-psyche-patterns"],
    queryFn: listBehaviorPatterns
  });
  const behaviorsQuery = useQuery({
    queryKey: ["forge-psyche-behaviors"],
    queryFn: listBehaviors
  });
  const beliefsQuery = useQuery({
    queryKey: ["forge-psyche-beliefs"],
    queryFn: listBeliefs
  });
  const modesQuery = useQuery({
    queryKey: ["forge-psyche-modes"],
    queryFn: listModes
  });
  const reportsQuery = useQuery({
    queryKey: ["forge-psyche-reports"],
    queryFn: listTriggerReports
  });

  const entityOptionsByType = useMemo(
    () => ({
      goal: shell.snapshot.goals.map((goal) => ({
        id: goal.id,
        label: goal.title
      })),
      project: shell.snapshot.dashboard.projects.map((project) => ({
        id: project.id,
        label: project.title
      })),
      task: shell.snapshot.tasks.map((task) => ({
        id: task.id,
        label: task.title
      })),
      habit: shell.snapshot.habits.map((habit) => ({
        id: habit.id,
        label: habit.title
      })),
      tag: shell.snapshot.tags.map((tag) => ({ id: tag.id, label: tag.name })),
      note: (notesQuery.data?.notes ?? []).map((note) => ({
        id: note.id,
        label: note.contentPlain || note.contentMarkdown
      })),
      insight: [],
      psyche_value: (valuesQuery.data?.values ?? []).map((value) => ({
        id: value.id,
        label: value.title
      })),
      behavior_pattern: (patternsQuery.data?.patterns ?? []).map((pattern) => ({
        id: pattern.id,
        label: pattern.title
      })),
      behavior: (behaviorsQuery.data?.behaviors ?? []).map((behavior) => ({
        id: behavior.id,
        label: behavior.title
      })),
      belief_entry: (beliefsQuery.data?.beliefs ?? []).map((belief) => ({
        id: belief.id,
        label: belief.statement
      })),
      mode_profile: (modesQuery.data?.modes ?? []).map((mode) => ({
        id: mode.id,
        label: mode.title
      })),
      mode_guide_session: [],
      event_type: [],
      emotion_definition: [],
      trigger_report: (reportsQuery.data?.reports ?? []).map((report) => ({
        id: report.id,
        label: report.title
      })),
      calendar_event: [],
      work_block_template: [],
      task_timebox: []
    }),
    [
      behaviorsQuery.data?.behaviors,
      beliefsQuery.data?.beliefs,
      modesQuery.data?.modes,
      notesQuery.data?.notes,
      patternsQuery.data?.patterns,
      reportsQuery.data?.reports,
      shell.snapshot.dashboard.projects,
      shell.snapshot.goals,
      shell.snapshot.habits,
      shell.snapshot.tags,
      shell.snapshot.tasks,
      valuesQuery.data?.values
    ]
  );

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["notes", entityType, entityId]
      }),
      queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] }),
      ...invalidateQueryKeys.map((key) =>
        queryClient.invalidateQueries({ queryKey: key })
      )
    ]);
  };

  const createMutation = useMutation({
    mutationFn: async (contentMarkdown: string) =>
      createNote({
        contentMarkdown,
        tags: normalizeNoteTags(composerTags),
        destroyAt: resolveDestroyAt(
          composerDestroyAtInput,
          composerDestroyDelayValue,
          composerDestroyDelayUnit
        ),
        links: dedupeLinks([
          { entityType, entityId, anchorKey: anchorKey ?? null },
          ...composerExtraLinks
        ])
      }),
    onSuccess: async () => {
      setComposerValue("");
      setComposerPreviewOpen(false);
      setComposerExtraLinks([]);
      setComposerLinkDraft({ entityType: "goal", entityId: "" });
      setComposerTags([]);
      setComposerDestroyAtInput("");
      setComposerDestroyDelayValue("");
      setComposerDestroyDelayUnit("days");
      await invalidateAll();
    }
  });

  const patchMutation = useMutation({
    mutationFn: async ({
      noteId,
      contentMarkdown,
      links,
      tags,
      destroyAt
    }: {
      noteId: string;
      contentMarkdown: string;
      links: NoteLink[];
      tags: string[];
      destroyAt: string | null;
    }) => patchNote(noteId, { contentMarkdown, links, tags, destroyAt }),
    onSuccess: async () => {
      setEditingNoteId(null);
      setEditingValue("");
      setEditingPreviewOpen(false);
      setEditingLinks([]);
      setEditingLinkDraft({ entityType: "goal", entityId: "" });
      setEditingTags([]);
      setEditingDestroyAtInput("");
      setEditingDestroyDelayValue("");
      setEditingDestroyDelayUnit("days");
      await invalidateAll();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (noteId: string) => deleteNote(noteId),
    onSuccess: invalidateAll
  });

  const visibleNotes = useMemo(() => {
    const notes = notesQuery.data?.notes ?? [];
    return notes
      .filter((note) => {
        if (anchorKey === undefined) {
          return true;
        }
        return note.links.some(
          (link) =>
            link.entityType === entityType &&
            link.entityId === entityId &&
            ((link.anchorKey ?? null) === anchorKey ||
              (includeAnchorlessWhenAnchored &&
                (link.anchorKey ?? null) === null))
        );
      })
      .filter((note) => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) {
          return true;
        }
        return `${note.contentPlain} ${note.author ?? ""} ${(note.tags ?? []).join(" ")}`
          .toLowerCase()
          .includes(normalized);
      });
  }, [
    anchorKey,
    entityId,
    entityType,
    includeAnchorlessWhenAnchored,
    notesQuery.data?.notes,
    query
  ]);

  const addDraftLink = (
    draft: LinkDraft,
    setter: (links: NoteLink[]) => void,
    links: NoteLink[]
  ) => {
    const entityIdValue = draft.entityId.trim();
    if (!entityIdValue) {
      return false;
    }
    setter(
      dedupeLinks([
        ...links,
        {
          entityType: draft.entityType,
          entityId: entityIdValue,
          anchorKey: null
        }
      ])
    );
    return true;
  };

  const getLinkLabel = (link: NoteLink) => {
    const matched = entityOptionsByType[link.entityType]?.find(
      (option) => option.id === link.entityId
    );
    if (matched?.label?.trim()) {
      return matched.label.trim();
    }
    return `Deleted ${formatEntityTypeLabel(link.entityType)}`;
  };

  const renderLinksEditor = (
    links: NoteLink[],
    setLinks: (links: NoteLink[]) => void,
    draft: LinkDraft,
    setDraft: (draft: LinkDraft) => void,
    optionsPrefix: string
  ) => (
    <div className="rounded-[20px] bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
          Linked entities
        </div>
        <Badge className="bg-white/[0.08] text-white/68">
          {links.length} linked
        </Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {links.map((link) => {
          const removable = links.length > 1;
          return (
            <div
              key={`${optionsPrefix}-${link.entityType}-${link.entityId}-${link.anchorKey ?? ""}`}
              className="inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-3 py-2 text-sm text-white/72"
            >
              <span>
                {formatEntityTypeLabel(link.entityType)} · {getLinkLabel(link)}
              </span>
              {link.anchorKey ? (
                <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[11px] text-white/54">
                  {formatAnchorKeyLabel(link.anchorKey)}
                </span>
              ) : null}
              <button
                type="button"
                disabled={!removable}
                className="text-white/44 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                onClick={() =>
                  setLinks(
                    links.filter((candidate) => !sameLink(candidate, link))
                  )
                }
                aria-label={`Remove ${formatEntityTypeLabel(link.entityType)} link to ${getLinkLabel(link)}`}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto]">
        <select
          className="rounded-[14px] bg-white/[0.06] px-3 py-3 text-white"
          value={draft.entityType}
          onChange={(event) =>
            setDraft({
              ...draft,
              entityType: event.target.value as CrudEntityType,
              entityId: ""
            })
          }
        >
          {(
            [
              "goal",
              "project",
              "task",
              "habit",
              "tag",
              "note",
              "psyche_value",
              "behavior_pattern",
              "behavior",
              "belief_entry",
              "mode_profile",
              "mode_guide_session",
              "event_type",
              "emotion_definition",
              "trigger_report"
            ] as const
          ).map((option) => (
            <option key={option} value={option}>
              {formatEntityTypeLabel(option)}
            </option>
          ))}
        </select>
        <select
          className="min-w-0 rounded-[14px] bg-white/[0.06] px-3 py-3 text-white"
          value={draft.entityId}
          onChange={(event) =>
            setDraft({ ...draft, entityId: event.target.value })
          }
        >
          <option value="">
            {(entityOptionsByType[draft.entityType] ?? []).length > 0
              ? "Choose linked item"
              : "No linked items available"}
          </option>
          {(entityOptionsByType[draft.entityType] ?? []).map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          disabled={!draft.entityId}
          onClick={() => {
            const added = addDraftLink(draft, setLinks, links);
            if (added) {
              setDraft({ ...draft, entityId: "" });
            }
          }}
        >
          Add link
        </Button>
      </div>
    </div>
  );

  return (
    <Card
      id="notes"
      className={
        compact ? "min-w-0 overflow-hidden p-0" : "min-w-0 overflow-hidden"
      }
    >
      <div className={compact ? "p-4" : undefined}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
              {title}
            </div>
            <div className="mt-2 text-sm leading-6 text-white/60">
              {description}
            </div>
            {currentAnchorLabel ? (
              <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/[0.05] px-3 py-2 text-xs text-white/64">
                <span>Pinned to {currentAnchorLabel}</span>
                {currentAnchorHelp ? (
                  <InfoTooltip
                    content={currentAnchorHelp}
                    label={`Explain ${currentAnchorLabel}`}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-white/[0.08] text-white/72">
              {formatNotesCountLabel(visibleNotes.length)}
            </Badge>
            {!composerOpen ? (
              <Button
                type="button"
                size="sm"
                onClick={() => setComposerOpen(true)}
              >
                <Plus className="size-4" />
                Add note
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-[22px] border border-white/8 bg-white/[0.04] px-3 py-3">
          <Search className="size-4 text-white/34" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search notes by content, author, or note tag"
            className="border-0 bg-transparent px-0 py-0"
          />
        </div>

        {composerOpen ? (
          <div className="mt-4 rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-white/70">
                <Plus className="size-4 text-[var(--secondary)]" />
                Add note
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="gap-2"
                onClick={() => setComposerPreviewOpen((current) => !current)}
              >
                <Eye className="size-4" />
                {composerPreviewOpen ? "Back to editor" : "Preview"}
              </Button>
            </div>
            <div className="mt-3">
              {composerPreviewOpen ? (
                <div className="rounded-[20px] bg-[rgba(9,14,25,0.78)] p-4">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
                    Preview
                  </div>
                  <div className="mt-3">
                    {composerValue.trim() ? (
                      <NoteMarkdown markdown={composerValue} />
                    ) : (
                      <div className="text-sm leading-6 text-white/42">
                        Markdown preview appears here once you have note
                        content.
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <Textarea
                  value={composerValue}
                  onChange={(event) => setComposerValue(event.target.value)}
                  placeholder="Write in Markdown. Summaries, blockers, what changed, and why all work well here."
                  className="min-h-[12rem]"
                />
              )}
            </div>
            <div className="mt-3">
              {renderLinksEditor(
                dedupeLinks([
                  { entityType, entityId, anchorKey: anchorKey ?? null },
                  ...composerExtraLinks
                ]),
                (links) =>
                  setComposerExtraLinks(
                    links.filter(
                      (link) =>
                        !(
                          link.entityType === entityType &&
                          link.entityId === entityId &&
                          (link.anchorKey ?? null) === (anchorKey ?? null)
                        )
                    )
                  ),
                composerLinkDraft,
                setComposerLinkDraft,
                "composer-note-links"
              )}
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
              <NoteTagsInput value={composerTags} onChange={setComposerTags} />
              <div className="grid gap-3 rounded-[20px] bg-white/[0.03] p-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
                    Ephemeral auto-destroy
                  </div>
                  <div className="mt-2 text-xs leading-5 text-white/46">
                    Set an exact destroy time or a relative delay. Leaving both
                    blank keeps the note durable.
                  </div>
                </div>
                <Input
                  type="datetime-local"
                  value={composerDestroyAtInput}
                  onChange={(event) =>
                    setComposerDestroyAtInput(event.target.value)
                  }
                />
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem]">
                  <Input
                    type="number"
                    min="1"
                    value={composerDestroyDelayValue}
                    onChange={(event) =>
                      setComposerDestroyDelayValue(event.target.value)
                    }
                    placeholder="Destroy after"
                  />
                  <select
                    className="rounded-[14px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
                    value={composerDestroyDelayUnit}
                    onChange={(event) =>
                      setComposerDestroyDelayUnit(
                        event.target.value as NoteDestroyDelayUnit
                      )
                    }
                  >
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setComposerOpen(false);
                  setComposerPreviewOpen(false);
                  setComposerValue("");
                  setComposerExtraLinks([]);
                  setComposerLinkDraft({ entityType: "goal", entityId: "" });
                  setComposerTags([]);
                  setComposerDestroyAtInput("");
                  setComposerDestroyDelayValue("");
                  setComposerDestroyDelayUnit("days");
                }}
              >
                Cancel
              </Button>
              <Button
                pending={createMutation.isPending}
                pendingLabel="Saving"
                disabled={composerValue.trim().length === 0}
                onClick={async () => {
                  await createMutation.mutateAsync(composerValue.trim());
                  setComposerOpen(false);
                }}
              >
                Save note
              </Button>
            </div>
          </div>
        ) : null}

        <div className="mt-4 grid gap-3">
          {notesQuery.isLoading ? (
            <div className="rounded-[20px] bg-white/[0.04] p-4 text-sm text-white/56">
              Loading notes…
            </div>
          ) : null}
          {!notesQuery.isLoading && visibleNotes.length === 0 ? (
            <div className="rounded-[20px] bg-white/[0.04] p-4 text-sm text-white/56">
              No notes are linked here yet.
            </div>
          ) : null}
          {visibleNotes.map((note) => {
            const editing = editingNoteId === note.id;
            const linkedElsewhere = describeLinkedEntities(
              note,
              entityType,
              entityId
            );
            return (
              <article
                key={note.id}
                className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-[0.16em] text-white/38">
                      {(note.author ?? "Unknown author").toString()} •{" "}
                      {new Date(note.updatedAt).toLocaleString()}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {linkedElsewhere.map((link) => (
                        <Badge
                          key={`${note.id}-${link.entityType}-${link.entityId}-${link.anchorKey ?? ""}`}
                          className="bg-white/[0.08] text-white/68"
                          wrap
                        >
                          {formatEntityTypeLabel(link.entityType)} ·{" "}
                          {getLinkLabel(link)}
                          {link.anchorKey
                            ? ` · ${formatAnchorKeyLabel(link.anchorKey)}`
                            : ""}
                        </Badge>
                      ))}
                      {(note.tags ?? []).map((tag) => (
                        <Badge
                          key={`${note.id}-tag-${tag}`}
                          className="bg-cyan-400/10 text-cyan-50"
                          wrap
                        >
                          {tag}
                        </Badge>
                      ))}
                      {note.destroyAt ? (
                        <Badge className="bg-amber-400/10 text-amber-100" wrap>
                          Ephemeral · deletes{" "}
                          {new Date(note.destroyAt).toLocaleString()}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex size-9 items-center justify-center rounded-full bg-white/[0.06] text-white/60 transition hover:bg-white/[0.1] hover:text-white"
                      onClick={() => {
                        setEditingNoteId(note.id);
                        setEditingValue(note.contentMarkdown);
                        setEditingPreviewOpen(false);
                        setEditingLinks(note.links);
                        setEditingLinkDraft({
                          entityType: "goal",
                          entityId: ""
                        });
                        setEditingTags(normalizeNoteTags(note.tags ?? []));
                        setEditingDestroyAtInput(
                          formatNoteDestroyAtInput(note.destroyAt ?? null)
                        );
                        setEditingDestroyDelayValue("");
                        setEditingDestroyDelayUnit("days");
                      }}
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      type="button"
                      className="inline-flex size-9 items-center justify-center rounded-full bg-rose-500/10 text-rose-200 transition hover:bg-rose-500/16"
                      onClick={() => {
                        void deleteMutation.mutateAsync(note.id);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>

                {editing ? (
                  <div className="mt-4">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="gap-2"
                        onClick={() =>
                          setEditingPreviewOpen((current) => !current)
                        }
                      >
                        <Eye className="size-4" />
                        {editingPreviewOpen ? "Back to editor" : "Preview"}
                      </Button>
                    </div>
                    <div className="mt-3">
                      {editingPreviewOpen ? (
                        <div className="rounded-[20px] bg-[rgba(9,14,25,0.78)] p-4">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
                            Preview
                          </div>
                          <div className="mt-3">
                            {editingValue.trim() ? (
                              <NoteMarkdown markdown={editingValue} />
                            ) : (
                              <div className="text-sm text-white/42">
                                No content yet.
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <Textarea
                          value={editingValue}
                          onChange={(event) =>
                            setEditingValue(event.target.value)
                          }
                          className="min-h-[12rem]"
                        />
                      )}
                    </div>
                    <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                      <NoteTagsInput
                        value={editingTags}
                        onChange={setEditingTags}
                      />
                      <div className="grid gap-3 rounded-[20px] bg-white/[0.03] p-4">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">
                            Ephemeral auto-destroy
                          </div>
                          <div className="mt-2 text-xs leading-5 text-white/46">
                            Set an exact destroy time or a relative delay.
                            Leaving both blank keeps the note durable.
                          </div>
                        </div>
                        <Input
                          type="datetime-local"
                          value={editingDestroyAtInput}
                          onChange={(event) =>
                            setEditingDestroyAtInput(event.target.value)
                          }
                        />
                        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem]">
                          <Input
                            type="number"
                            min="1"
                            value={editingDestroyDelayValue}
                            onChange={(event) =>
                              setEditingDestroyDelayValue(event.target.value)
                            }
                            placeholder="Destroy after"
                          />
                          <select
                            className="rounded-[14px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
                            value={editingDestroyDelayUnit}
                            onChange={(event) =>
                              setEditingDestroyDelayUnit(
                                event.target.value as NoteDestroyDelayUnit
                              )
                            }
                          >
                            <option value="hours">Hours</option>
                            <option value="days">Days</option>
                          </select>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3">
                      {renderLinksEditor(
                        editingLinks,
                        setEditingLinks,
                        editingLinkDraft,
                        setEditingLinkDraft,
                        `edit-note-links-${note.id}`
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setEditingNoteId(null);
                          setEditingPreviewOpen(false);
                          setEditingTags([]);
                          setEditingDestroyAtInput("");
                          setEditingDestroyDelayValue("");
                          setEditingDestroyDelayUnit("days");
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        pending={patchMutation.isPending}
                        pendingLabel="Saving"
                        disabled={
                          editingValue.trim().length === 0 ||
                          editingLinks.length === 0
                        }
                        onClick={async () => {
                          await patchMutation.mutateAsync({
                            noteId: note.id,
                            contentMarkdown: editingValue.trim(),
                            links: editingLinks,
                            tags: normalizeNoteTags(editingTags),
                            destroyAt: resolveDestroyAt(
                              editingDestroyAtInput,
                              editingDestroyDelayValue,
                              editingDestroyDelayUnit
                            )
                          });
                        }}
                      >
                        Save changes
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4">
                    <NoteMarkdown markdown={note.contentMarkdown} />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
