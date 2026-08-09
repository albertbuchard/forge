import { useCallback, useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { PlanningRecordDeleteDialog } from "@/components/planning/planning-record-delete-dialog";
import { useForgeShell } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Input } from "@/components/ui/input";
import { createNote, deleteNote, listNotes, patchNote } from "@/lib/api";
import { getEntityKindForCrudEntityType } from "@/lib/entity-visuals";
import { normalizeNoteTags } from "@/lib/note-memory-tags";
import {
  formatAnchorKeyLabel,
  formatEntityTypeLabel,
  formatNotesCountLabel,
  getAnchorKeyHelpText
} from "@/lib/note-helpers";
import {
  buildFallbackNoteLinkOptions,
  encodeNoteLinkOptionValue,
  mergeNoteLinkOptions,
  resolveSelectedNoteLinkOptions,
  searchNoteLinkOptions,
  type NoteLinkOption
} from "@/lib/note-link-options";
import type { CrudEntityType, Note, NoteLink } from "@/lib/types";
import { formatOwnedEntityOptionLabel } from "@/lib/user-ownership";
import { invalidateForgeSnapshot } from "@/store/api/invalidate-forge-snapshot";
import {
  NoteEditorFlowDialog,
  resolveNoteDraftDestroyAt,
  resolveNoteDraftFrontmatter,
  resolveNoteDraftLinks,
  type NoteEditorDraft
} from "./note-editor-flow-dialog";
import { NoteMarkdownDisclosure } from "./note-markdown";

const NOTES_PAGE_SIZE = 40;
const EMBEDDED_NOTES_MAX_VISIBLE = 200;

function sameEntityLink(
  link: Pick<NoteLink, "entityType" | "entityId">,
  entityType: CrudEntityType,
  entityId: string
) {
  return link.entityType === entityType && link.entityId === entityId;
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
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [notePendingDelete, setNotePendingDelete] = useState<Note | null>(null);
  const currentAnchorLabel = formatAnchorKeyLabel(anchorKey);
  const currentAnchorHelp = getAnchorKeyHelpText(entityType, anchorKey);
  const selectedUserIds = useMemo(
    () => (Array.isArray(shell.selectedUserIds) ? shell.selectedUserIds : []),
    [shell.selectedUserIds]
  );
  const parentLink = useMemo<NoteLink>(
    () => ({ entityType, entityId, anchorKey: anchorKey ?? null }),
    [anchorKey, entityId, entityType]
  );
  const lockedParentLinks = useMemo(() => {
    const existingParentLinks = editingNote?.links.filter((link) =>
      sameEntityLink(link, entityType, entityId)
    );
    return existingParentLinks && existingParentLinks.length > 0
      ? existingParentLinks
      : [parentLink];
  }, [editingNote?.links, entityId, entityType, parentLink]);

  const notesQuery = useInfiniteQuery({
    queryKey: [
      "notes",
      entityType,
      entityId,
      anchorKey,
      includeAnchorlessWhenAnchored,
      query.trim(),
      selectedUserIds.join("|")
    ],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      listNotes({
        linkedEntityType: entityType,
        linkedEntityId: entityId,
        anchorKey: anchorKey !== undefined ? anchorKey : undefined,
        includeAnchorless:
          anchorKey !== undefined && includeAnchorlessWhenAnchored,
        query: query.trim() || undefined,
        userIds: selectedUserIds,
        limit: NOTES_PAGE_SIZE,
        cursor: pageParam ?? undefined
      }),
    getNextPageParam: (lastPage, pages) => {
      const loadedCount = pages.reduce(
        (count, page) => count + page.notes.length,
        0
      );
      if (
        loadedCount >= EMBEDDED_NOTES_MAX_VISIBLE ||
        !lastPage.hasMore ||
        !lastPage.nextCursor
      ) {
        return undefined;
      }
      return lastPage.nextCursor;
    }
  });
  const loadedNotes = useMemo(
    () => notesQuery.data?.pages.flatMap((page) => page.notes) ?? [],
    [notesQuery.data?.pages]
  );
  const total = notesQuery.data?.pages[0]?.total ?? 0;
  const visibleNotes = loadedNotes;

  const shellEntityOptions = useMemo(() => {
    const options: NoteLinkOption[] = [];
    const add = (
      nextEntityType: CrudEntityType,
      id: string,
      label: string,
      description?: string
    ) => {
      options.push({
        value: encodeNoteLinkOptionValue(nextEntityType, id),
        label,
        description,
        searchText: `${label} ${description ?? ""}`,
        kind: getEntityKindForCrudEntityType(nextEntityType) ?? undefined
      });
    };

    shell.snapshot.goals.forEach((goal) =>
      add(
        "goal",
        goal.id,
        formatOwnedEntityOptionLabel(goal.title, goal.user),
        goal.description
      )
    );
    shell.snapshot.dashboard.projects.forEach((project) =>
      add(
        "project",
        project.id,
        formatOwnedEntityOptionLabel(project.title, project.user),
        project.description
      )
    );
    shell.snapshot.tasks.forEach((task) =>
      add(
        "task",
        task.id,
        formatOwnedEntityOptionLabel(task.title, task.user),
        task.description
      )
    );
    shell.snapshot.strategies.forEach((strategy) =>
      add(
        "strategy",
        strategy.id,
        formatOwnedEntityOptionLabel(strategy.title, strategy.user),
        strategy.overview
      )
    );
    shell.snapshot.habits.forEach((habit) =>
      add(
        "habit",
        habit.id,
        formatOwnedEntityOptionLabel(habit.title, habit.user),
        habit.description
      )
    );
    shell.snapshot.tags.forEach((tag) =>
      add(
        "tag",
        tag.id,
        formatOwnedEntityOptionLabel(tag.name, tag.user),
        tag.description
      )
    );
    loadedNotes
      .filter((note) => note.id !== editingNote?.id)
      .forEach((note) =>
        add("note", note.id, note.title, note.contentPlain.slice(0, 120))
      );

    if (
      !options.some(
        (option) =>
          option.value === encodeNoteLinkOptionValue(entityType, entityId)
      )
    ) {
      add(
        entityType,
        entityId,
        `Current ${formatEntityTypeLabel(entityType)}`,
        "The record this Notes panel belongs to"
      );
    }
    return mergeNoteLinkOptions(options);
  }, [
    editingNote?.id,
    entityId,
    entityType,
    loadedNotes,
    shell.snapshot.dashboard.projects,
    shell.snapshot.goals,
    shell.snapshot.habits,
    shell.snapshot.strategies,
    shell.snapshot.tags,
    shell.snapshot.tasks
  ]);
  const selectedLinkOptionValues = useMemo(
    () =>
      Array.from(
        new Set([
          encodeNoteLinkOptionValue(entityType, entityId),
          ...(editingNote?.links ?? []).map((link) =>
            encodeNoteLinkOptionValue(link.entityType, link.entityId)
          )
        ])
      ),
    [editingNote?.links, entityId, entityType]
  );
  const selectedLinkOptionsQuery = useQuery({
    queryKey: [
      "note-link-selection",
      selectedUserIds.join("|"),
      selectedLinkOptionValues.join("|")
    ],
    queryFn: () =>
      resolveSelectedNoteLinkOptions(selectedLinkOptionValues, selectedUserIds),
    enabled: selectedLinkOptionValues.length > 0,
    retry: false
  });
  const entityOptions = useMemo(
    () =>
      mergeNoteLinkOptions(
        buildFallbackNoteLinkOptions(selectedLinkOptionValues),
        shellEntityOptions,
        selectedLinkOptionsQuery.data ?? []
      ),
    [
      selectedLinkOptionValues,
      selectedLinkOptionsQuery.data,
      shellEntityOptions
    ]
  );
  const searchEntityLinkOptions = useCallback(
    (query: string) => searchNoteLinkOptions(query, selectedUserIds),
    [selectedUserIds]
  );

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["notes", entityType, entityId]
      }),
      queryClient.invalidateQueries({ queryKey: ["notes-index"] }),
      invalidateForgeSnapshot(queryClient),
      ...invalidateQueryKeys.map((key) =>
        queryClient.invalidateQueries({ queryKey: key })
      )
    ]);
  };

  const linksForDraft = (draft: NoteEditorDraft) => {
    const links = resolveNoteDraftLinks(draft);
    return dedupeLinks(
      links.some((link) => sameEntityLink(link, entityType, entityId))
        ? links
        : [parentLink, ...links]
    );
  };
  const createMutation = useMutation({
    mutationFn: (draft: NoteEditorDraft) =>
      createNote({
        title: draft.title || undefined,
        contentMarkdown: draft.contentMarkdown,
        author: draft.author || null,
        tags: normalizeNoteTags(draft.tags),
        destroyAt: resolveNoteDraftDestroyAt(draft),
        frontmatter: resolveNoteDraftFrontmatter(draft),
        userId: selectedUserIds.length === 1 ? selectedUserIds[0] : undefined,
        links: linksForDraft(draft)
      }),
    onSuccess: invalidateAll
  });
  const patchMutation = useMutation({
    mutationFn: ({ note, draft }: { note: Note; draft: NoteEditorDraft }) =>
      patchNote(note.id, {
        title: draft.title || undefined,
        contentMarkdown: draft.contentMarkdown,
        author: draft.author || null,
        tags: normalizeNoteTags(draft.tags),
        destroyAt: resolveNoteDraftDestroyAt(draft),
        frontmatter: resolveNoteDraftFrontmatter(draft, note.frontmatter),
        expectedRevisionHash: draft.baseRevisionHash ?? undefined,
        links: linksForDraft(draft)
      }),
    onSuccess: invalidateAll
  });
  const deleteMutation = useMutation({
    mutationFn: (noteId: string) => deleteNote(noteId),
    onSuccess: invalidateAll
  });
  const canLoadOlder =
    Boolean(notesQuery.hasNextPage) &&
    loadedNotes.length < EMBEDDED_NOTES_MAX_VISIBLE;

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
            <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
              {title}
            </div>
            <div className="mt-2 text-sm leading-6 text-[var(--ui-ink-soft)]">
              {description}
            </div>
            {currentAnchorLabel ? (
              <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full bg-[var(--ui-surface-1)] px-3 py-2 text-xs text-[var(--ui-ink-soft)]">
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
            <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
              {formatNotesCountLabel(total)}
            </Badge>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setEditingNote(null);
                setEditorOpen(true);
              }}
            >
              <Plus className="size-4" />
              Add note
            </Button>
          </div>
        </div>

        <label className="mt-4 flex min-w-0 items-center gap-2 rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-3">
          <Search className="size-4 shrink-0 text-[var(--ui-ink-faint)]" />
          <span className="sr-only">Search linked notes</span>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, content, author, summary, or tags"
            className="min-w-0 border-0 bg-transparent px-0 py-0"
          />
        </label>

        <div className="mt-4 grid gap-3">
          {notesQuery.isLoading ? (
            <div
              role="status"
              aria-live="polite"
              className="rounded-[20px] bg-[var(--ui-surface-1)] p-4 text-sm text-[var(--ui-ink-soft)]"
            >
              Loading notes…
            </div>
          ) : null}
          {notesQuery.isError && !notesQuery.data ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] bg-[var(--ui-danger-soft)] p-4 text-sm text-[var(--danger)]"
            >
              <span>Linked notes could not be loaded.</span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void notesQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : null}
          {!notesQuery.isLoading &&
          !notesQuery.isError &&
          visibleNotes.length === 0 ? (
            <div className="rounded-[20px] bg-[var(--ui-surface-1)] p-4 text-sm text-[var(--ui-ink-soft)]">
              {query.trim()
                ? "No linked notes match this search."
                : "No notes are linked here yet."}
            </div>
          ) : null}
          {visibleNotes.map((note) => {
            const linkedElsewhere = note.links.filter(
              (link) => !sameEntityLink(link, entityType, entityId)
            );
            const observedAt =
              typeof note.frontmatter.observedAt === "string"
                ? note.frontmatter.observedAt
                : null;
            return (
              <article
                key={note.id}
                aria-labelledby={`embedded-note-title-${note.id}`}
                className="min-w-0 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3
                      id={`embedded-note-title-${note.id}`}
                      className="break-words text-sm font-semibold text-[var(--ui-ink-strong)] [overflow-wrap:anywhere]"
                    >
                      {note.title}
                    </h3>
                    <div className="mt-1 break-words text-xs text-[var(--ui-ink-faint)] [overflow-wrap:anywhere]">
                      {(note.author ?? "Unknown author").toString()} ·{" "}
                      {new Date(note.updatedAt).toLocaleString()}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {linkedElsewhere.map((link) => (
                        <Badge
                          key={`${note.id}-${link.entityType}-${link.entityId}-${link.anchorKey ?? ""}`}
                          className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]"
                          wrap
                        >
                          {formatEntityTypeLabel(link.entityType)}
                          {link.anchorKey
                            ? ` · ${formatAnchorKeyLabel(link.anchorKey)}`
                            : ""}
                        </Badge>
                      ))}
                      {(note.unavailableLinkCount ?? 0) > 0 ? (
                        <Badge
                          className="bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]"
                          wrap
                        >
                          {note.unavailableLinkCount} linked record
                          {note.unavailableLinkCount === 1 ? "" : "s"}{" "}
                          unavailable
                        </Badge>
                      ) : null}
                      {(note.tags ?? []).map((tag) => (
                        <Badge
                          key={`${note.id}-tag-${tag}`}
                          className="bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_78%,var(--ui-ink-strong)_22%)]"
                          wrap
                        >
                          {tag}
                        </Badge>
                      ))}
                      {observedAt ? (
                        <Badge
                          className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]"
                          wrap
                        >
                          Observed {new Date(observedAt).toLocaleString()}
                        </Badge>
                      ) : null}
                      {note.destroyAt ? (
                        <Badge
                          className="bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]"
                          wrap
                        >
                          Ephemeral · deletes{" "}
                          {new Date(note.destroyAt).toLocaleString()}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex size-9 items-center justify-center rounded-full bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                      onClick={() => {
                        setEditingNote(note);
                        setEditorOpen(true);
                      }}
                      aria-label={`Edit ${note.title}`}
                      title="Edit note"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      type="button"
                      className="inline-flex size-9 items-center justify-center rounded-full bg-[var(--ui-danger-soft)] text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)] transition hover:bg-[color-mix(in_srgb,var(--danger)_18%,var(--ui-surface-hover)_82%)]"
                      onClick={() => setNotePendingDelete(note)}
                      aria-label={`Delete ${note.title}`}
                      title="Delete note"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
                <div className="mt-4 min-w-0 overflow-hidden">
                  <NoteMarkdownDisclosure
                    markdown={note.contentMarkdown}
                    plainText={note.contentPlain}
                    title={note.title}
                  />
                </div>
              </article>
            );
          })}
          {notesQuery.isFetchNextPageError ? (
            <div role="alert" className="text-sm text-[var(--danger)]">
              Older notes could not be loaded; the visible pages are unchanged.
            </div>
          ) : null}
          {visibleNotes.length > 0 ? (
            <div className="flex flex-wrap items-center justify-center gap-2 text-center text-xs text-[var(--ui-ink-faint)]">
              <span>
                Showing {loadedNotes.length} of {total} linked notes.
              </span>
              {canLoadOlder ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  pending={notesQuery.isFetchingNextPage}
                  pendingLabel="Loading"
                  onClick={() => void notesQuery.fetchNextPage()}
                >
                  Load older notes
                </Button>
              ) : loadedNotes.length >= EMBEDDED_NOTES_MAX_VISIBLE &&
                total > loadedNotes.length ? (
                <span>Refine the search beyond the 200-note display cap.</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <NoteEditorFlowDialog
        open={editorOpen}
        note={editingNote}
        lockedLinks={lockedParentLinks}
        entityOptions={entityOptions}
        onSearchEntityOptions={searchEntityLinkOptions}
        availableTags={Array.from(
          new Set(loadedNotes.flatMap((note) => note.tags ?? []))
        )}
        draftScopeKey={`${entityType}.${entityId}.${anchorKey ?? "root"}`}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) {
            setEditingNote(null);
          }
        }}
        onSubmit={async (draft) => {
          if (editingNote) {
            await patchMutation.mutateAsync({ note: editingNote, draft });
            return;
          }
          await createMutation.mutateAsync(draft);
        }}
      />

      <PlanningRecordDeleteDialog
        open={Boolean(notePendingDelete)}
        recordKind="note"
        recordTitle={notePendingDelete?.title ?? "this note"}
        onOpenChange={(open) => {
          if (!open) {
            setNotePendingDelete(null);
          }
        }}
        onConfirm={async () => {
          if (!notePendingDelete) {
            return;
          }
          await deleteMutation.mutateAsync(notePendingDelete.id);
          setNotePendingDelete(null);
        }}
      />
    </Card>
  );
}
