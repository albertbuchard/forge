import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import {
  ArrowUpRight,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  NoteEditorFlowDialog,
  resolveNoteDraftDestroyAt,
  resolveNoteDraftFrontmatter,
  resolveNoteDraftLinks,
  type NoteEditorDraft
} from "@/components/notes/note-editor-flow-dialog";
import { PlanningRecordDeleteDialog } from "@/components/planning/planning-record-delete-dialog";
import { NoteFilterInput } from "@/components/notes/note-filter-input";
import { NoteMarkdownDisclosure } from "@/components/notes/note-markdown";
import { NoteTagsInput } from "@/components/notes/note-tags-input";
import { PageHero } from "@/components/shell/page-hero";
import { useForgeShell } from "@/components/shell/app-shell";
import {
  NoteFiltersBox,
  NotesLibraryBox
} from "@/components/workbench-boxes/notes/notes-boxes";
import {
  FloatingActionMenu,
  type FloatingActionMenuItem
} from "@/components/ui/floating-action-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState } from "@/components/ui/page-state";
import { invalidateForgeSnapshot } from "@/store/api/invalidate-forge-snapshot";
import {
  createNote,
  deleteNote,
  getNote,
  getLifeForce,
  listNotes,
  patchNote
} from "@/lib/api";
import { getEntityKindForCrudEntityType } from "@/lib/entity-visuals";
import {
  estimateQuickNoteActionPointLoad,
  formatLifeForceAp,
  formatLifeForceRate
} from "@/lib/life-force-display";
import { normalizeNoteTags } from "@/lib/note-memory-tags";
import {
  countNotesCreatedOnLocalDate,
  formatAnchorKeyLabel,
  formatEntityTypeLabel,
  getEntityRoute,
  getPrimaryNavigableLink
} from "@/lib/note-helpers";
import {
  buildFallbackNoteLinkOptions,
  decodeNoteLinkOptionValue,
  encodeNoteLinkOptionValue,
  mergeNoteLinkOptions,
  resolveSelectedNoteLinkOptions,
  searchNoteLinkOptions,
  type NoteLinkOption
} from "@/lib/note-link-options";
import type { CrudEntityType, Note } from "@/lib/types";
import {
  buildOwnedEntitySearchText,
  formatOwnedEntityDescription
} from "@/lib/user-ownership";

const NOTES_PAGE_SIZE = 40;
const NOTES_MAX_VISIBLE = 400;

function parseLinkedValues(searchParams: URLSearchParams) {
  const values = searchParams.getAll("linkedTo");
  const legacyEntityType = searchParams.get("entityType");
  const legacyEntityId = searchParams.get("entityId");
  if (legacyEntityType && legacyEntityId) {
    const legacyValue = `${legacyEntityType}:${legacyEntityId}`;
    if (decodeNoteLinkOptionValue(legacyValue)) {
      values.unshift(legacyValue);
    }
  }
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter((value) => decodeNoteLinkOptionValue(value) !== null)
    )
  ).slice(0, 24);
}

function parseTextTerms(searchParams: URLSearchParams) {
  return Array.from(
    new Set(
      searchParams
        .getAll("textTerms")
        .map((value) => value.trim())
        .filter((value) => value.length > 0 && value.length <= 160)
    )
  ).slice(0, 12);
}

function parseTagTerms(searchParams: URLSearchParams) {
  return normalizeNoteTags(searchParams.getAll("tags"))
    .filter((tag) => tag.length <= 80)
    .slice(0, 24);
}

function sameValues(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function NotesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const shell = useForgeShell();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusedNoteId = searchParams.get("focus")?.trim() || null;
  const [selectedEntityValues, setSelectedEntityValues] = useState<string[]>(
    () => parseLinkedValues(searchParams)
  );
  const [selectedTagValues, setSelectedTagValues] = useState<string[]>(() =>
    parseTagTerms(searchParams)
  );
  const [selectedTextTerms, setSelectedTextTerms] = useState<string[]>(() =>
    parseTextTerms(searchParams)
  );
  const [author, setAuthor] = useState(searchParams.get("author") ?? "");
  const [updatedFrom, setUpdatedFrom] = useState(
    searchParams.get("updatedFrom") ?? ""
  );
  const [updatedTo, setUpdatedTo] = useState(
    searchParams.get("updatedTo") ?? ""
  );
  const [observedFrom, setObservedFrom] = useState(
    searchParams.get("observedFrom") ?? ""
  );
  const [observedTo, setObservedTo] = useState(
    searchParams.get("observedTo") ?? ""
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [notePendingDelete, setNotePendingDelete] = useState<Note | null>(null);
  const [menuState, setMenuState] = useState<{
    noteId: string;
    position: { x: number; y: number };
  } | null>(null);
  const selectedUserIds = useMemo(
    () => (Array.isArray(shell.selectedUserIds) ? shell.selectedUserIds : []),
    [shell.selectedUserIds]
  );
  const selectedUserIdsKey = selectedUserIds.join("|");
  const lifeForceQuery = useQuery({
    queryKey: ["forge-life-force", ...selectedUserIds],
    queryFn: async () => (await getLifeForce(selectedUserIds)).lifeForce
  });
  const searchParamsKey = searchParams.toString();
  const syncingFromLocationRef = useRef(false);

  useEffect(() => {
    const locationParams = new URLSearchParams(searchParamsKey);
    const nextEntityValues = parseLinkedValues(locationParams);
    const nextTagValues = parseTagTerms(locationParams);
    const nextTextTerms = parseTextTerms(locationParams);
    const nextAuthor = locationParams.get("author") ?? "";
    const nextUpdatedFrom = locationParams.get("updatedFrom") ?? "";
    const nextUpdatedTo = locationParams.get("updatedTo") ?? "";
    const nextObservedFrom = locationParams.get("observedFrom") ?? "";
    const nextObservedTo = locationParams.get("observedTo") ?? "";
    syncingFromLocationRef.current = true;
    setSelectedEntityValues((current) =>
      sameValues(current, nextEntityValues) ? current : nextEntityValues
    );
    setSelectedTagValues((current) =>
      sameValues(current, nextTagValues) ? current : nextTagValues
    );
    setSelectedTextTerms((current) =>
      sameValues(current, nextTextTerms) ? current : nextTextTerms
    );
    setAuthor((current) => (current === nextAuthor ? current : nextAuthor));
    setUpdatedFrom((current) =>
      current === nextUpdatedFrom ? current : nextUpdatedFrom
    );
    setUpdatedTo((current) =>
      current === nextUpdatedTo ? current : nextUpdatedTo
    );
    setObservedFrom((current) =>
      current === nextObservedFrom ? current : nextObservedFrom
    );
    setObservedTo((current) =>
      current === nextObservedTo ? current : nextObservedTo
    );
  }, [searchParamsKey]);

  useEffect(() => {
    if (syncingFromLocationRef.current) {
      syncingFromLocationRef.current = false;
      return;
    }
    const next = new URLSearchParams();
    for (const value of selectedEntityValues) {
      next.append("linkedTo", value);
    }
    for (const value of selectedTagValues) {
      next.append("tags", value);
    }
    for (const term of selectedTextTerms) {
      next.append("textTerms", term);
    }
    if (author.trim()) {
      next.set("author", author.trim());
    }
    if (updatedFrom) {
      next.set("updatedFrom", updatedFrom);
    }
    if (updatedTo) {
      next.set("updatedTo", updatedTo);
    }
    if (observedFrom) {
      next.set("observedFrom", observedFrom);
    }
    if (observedTo) {
      next.set("observedTo", observedTo);
    }
    if (focusedNoteId) {
      next.set("focus", focusedNoteId);
    }
    if (next.toString() !== searchParamsKey) {
      setSearchParams(next, { replace: true });
    }
  }, [
    author,
    focusedNoteId,
    observedFrom,
    observedTo,
    searchParamsKey,
    selectedEntityValues,
    selectedTagValues,
    selectedTextTerms,
    setSearchParams,
    updatedFrom,
    updatedTo
  ]);

  const shellEntityLinkOptions = useMemo<NoteLinkOption[]>(
    () => [
      ...shell.snapshot.goals.map((goal) => ({
        value: encodeNoteLinkOptionValue("goal", goal.id),
        label: goal.title,
        description: formatOwnedEntityDescription(
          goal.description,
          goal.user,
          "Goal"
        ),
        searchText: buildOwnedEntitySearchText(
          [goal.title, goal.description],
          goal
        ),
        kind: getEntityKindForCrudEntityType("goal") ?? undefined
      })),
      ...shell.snapshot.dashboard.projects.map((project) => ({
        value: encodeNoteLinkOptionValue("project", project.id),
        label: project.title,
        description: formatOwnedEntityDescription(
          `${project.description}${project.description ? " · " : ""}${project.goalTitle}`,
          project.user,
          project.goalTitle
        ),
        searchText: buildOwnedEntitySearchText(
          [project.title, project.description, project.goalTitle],
          project
        ),
        kind: getEntityKindForCrudEntityType("project") ?? undefined
      })),
      ...shell.snapshot.tasks.map((task) => ({
        value: encodeNoteLinkOptionValue("task", task.id),
        label: task.title,
        description: formatOwnedEntityDescription(
          `${task.description}${task.description ? " · " : ""}${task.owner}`,
          task.user,
          task.owner
        ),
        searchText: buildOwnedEntitySearchText(
          [task.title, task.description, task.owner],
          task
        ),
        kind: getEntityKindForCrudEntityType("task") ?? undefined
      })),
      ...shell.snapshot.strategies.map((strategy) => ({
        value: encodeNoteLinkOptionValue("strategy", strategy.id),
        label: strategy.title,
        description: formatOwnedEntityDescription(
          strategy.overview,
          strategy.user,
          "Strategy"
        ),
        searchText: buildOwnedEntitySearchText(
          [strategy.title, strategy.overview, strategy.endStateDescription],
          strategy
        ),
        kind: getEntityKindForCrudEntityType("strategy") ?? undefined
      })),
      ...shell.snapshot.habits.map((habit) => ({
        value: encodeNoteLinkOptionValue("habit", habit.id),
        label: habit.title,
        description: formatOwnedEntityDescription(
          habit.description,
          habit.user,
          "Habit"
        ),
        searchText: buildOwnedEntitySearchText(
          [habit.title, habit.description],
          habit
        ),
        kind: getEntityKindForCrudEntityType("habit") ?? undefined
      })),
      ...shell.snapshot.tags.map((tag) => ({
        value: encodeNoteLinkOptionValue("tag", tag.id),
        label: tag.name,
        description: formatOwnedEntityDescription(
          tag.description,
          tag.user,
          tag.kind
        ),
        searchText: buildOwnedEntitySearchText(
          [tag.name, tag.kind, tag.description],
          tag
        ),
        kind: getEntityKindForCrudEntityType("tag") ?? undefined
      }))
    ],
    [
      shell.snapshot.dashboard.projects,
      shell.snapshot.goals,
      shell.snapshot.habits,
      shell.snapshot.strategies,
      shell.snapshot.tags,
      shell.snapshot.tasks
    ]
  );
  const selectedLinkOptionValues = useMemo(
    () =>
      Array.from(
        new Set([
          ...selectedEntityValues,
          ...(editingNote?.links ?? []).map((link) =>
            encodeNoteLinkOptionValue(link.entityType, link.entityId)
          )
        ])
      ),
    [editingNote?.links, selectedEntityValues]
  );
  const selectedLinkOptionsQuery = useQuery({
    queryKey: [
      "note-link-selection",
      selectedUserIdsKey,
      selectedLinkOptionValues.join("|")
    ],
    queryFn: () =>
      resolveSelectedNoteLinkOptions(selectedLinkOptionValues, selectedUserIds),
    enabled: selectedLinkOptionValues.length > 0,
    retry: false
  });
  const entityLinkOptions = useMemo(
    () =>
      mergeNoteLinkOptions(
        buildFallbackNoteLinkOptions(selectedLinkOptionValues),
        shellEntityLinkOptions,
        selectedLinkOptionsQuery.data ?? []
      ),
    [
      selectedLinkOptionValues,
      selectedLinkOptionsQuery.data,
      shellEntityLinkOptions
    ]
  );
  const searchEntityLinkOptions = useCallback(
    (query: string) => searchNoteLinkOptions(query, selectedUserIds),
    [selectedUserIds]
  );
  const searchEntityFilterOptions = useCallback(
    async (query: string) =>
      (await searchNoteLinkOptions(query, selectedUserIds)).flatMap(
        (option) => {
          const decoded = decodeNoteLinkOptionValue(option.value);
          return decoded
            ? [
                {
                  ...option,
                  entityType: decoded.entityType,
                  entityId: decoded.entityId
                }
              ]
            : [];
        }
      ),
    [selectedUserIds]
  );

  const entityFilterOptions = useMemo(
    () =>
      entityLinkOptions.map((option) => {
        const decoded = decodeNoteLinkOptionValue(option.value);
        return {
          value: option.value,
          label: option.label,
          description: option.description,
          searchText: option.searchText,
          kind: option.kind,
          entityType: decoded?.entityType ?? "goal",
          entityId: decoded?.entityId ?? ""
        };
      }),
    [entityLinkOptions]
  );

  const selectedEntityFilters = useMemo(
    () =>
      selectedEntityValues
        .map((value) => decodeNoteLinkOptionValue(value))
        .filter(Boolean) as Array<{
        entityType: CrudEntityType;
        entityId: string;
      }>,
    [selectedEntityValues]
  );

  const notesQuery = useInfiniteQuery({
    queryKey: [
      "notes-index",
      selectedEntityValues.join("|"),
      selectedTagValues.join("|"),
      selectedTextTerms.join("|"),
      author.trim(),
      updatedFrom,
      updatedTo,
      observedFrom,
      observedTo,
      selectedUserIds.join("|")
    ],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      listNotes({
        linkedTo: selectedEntityFilters,
        tags: selectedTagValues,
        textTerms: selectedTextTerms,
        author: author.trim() || undefined,
        userIds: selectedUserIds,
        updatedFrom: updatedFrom || undefined,
        updatedTo: updatedTo || undefined,
        observedFrom: observedFrom || undefined,
        observedTo: observedTo || undefined,
        limit: NOTES_PAGE_SIZE,
        cursor: pageParam ?? undefined
      }),
    getNextPageParam: (lastPage, pages) => {
      const loadedCount = pages.reduce(
        (count, page) => count + page.notes.length,
        0
      );
      if (
        loadedCount >= NOTES_MAX_VISIBLE ||
        !lastPage.hasMore ||
        !lastPage.nextCursor
      ) {
        return undefined;
      }
      return lastPage.nextCursor;
    },
    retry: false
  });
  const matchingNotes = useMemo(
    () => notesQuery.data?.pages.flatMap((page) => page.notes) ?? [],
    [notesQuery.data?.pages]
  );
  const matchingTotal = notesQuery.data?.pages[0]?.total ?? 0;
  const focusedNoteInList = focusedNoteId
    ? matchingNotes.find((note) => note.id === focusedNoteId)
    : undefined;
  const focusedNoteQuery = useQuery({
    queryKey: ["notes-focus", focusedNoteId],
    enabled: Boolean(
      focusedNoteId && notesQuery.isSuccess && !focusedNoteInList
    ),
    queryFn: async () => (await getNote(focusedNoteId!)).note,
    retry: false
  });

  const invalidateNotes = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["notes-index"] }),
      invalidateForgeSnapshot(queryClient)
    ]);
  };

  const createMutation = useMutation({
    mutationFn: async (draft: NoteEditorDraft) =>
      createNote({
        title: draft.title || undefined,
        contentMarkdown: draft.contentMarkdown.trim(),
        author: draft.author.trim() || null,
        tags: normalizeNoteTags(draft.tags),
        destroyAt: resolveNoteDraftDestroyAt(draft),
        frontmatter: resolveNoteDraftFrontmatter(draft),
        userId: selectedUserIds.length === 1 ? selectedUserIds[0] : undefined,
        links: resolveNoteDraftLinks(draft)
      }),
    onSuccess: invalidateNotes
  });

  const patchMutation = useMutation({
    mutationFn: async ({
      noteId,
      draft
    }: {
      noteId: string;
      draft: NoteEditorDraft;
    }) =>
      patchNote(noteId, {
        title: draft.title || undefined,
        contentMarkdown: draft.contentMarkdown.trim(),
        author: draft.author.trim() || null,
        tags: normalizeNoteTags(draft.tags),
        destroyAt: resolveNoteDraftDestroyAt(draft),
        frontmatter: resolveNoteDraftFrontmatter(
          draft,
          editingNote?.frontmatter ?? {}
        ),
        expectedRevisionHash: draft.baseRevisionHash ?? undefined,
        links: resolveNoteDraftLinks(draft)
      }),
    onSuccess: invalidateNotes
  });

  const deleteMutation = useMutation({
    mutationFn: (noteId: string) => deleteNote(noteId),
    onSuccess: invalidateNotes
  });

  const visibleNotes = useMemo(() => {
    const notes = matchingNotes;
    const focusedNote = focusedNoteQuery.data;
    if (!focusedNote || notes.some((note) => note.id === focusedNote.id)) {
      return notes;
    }
    return [focusedNote, ...notes];
  }, [focusedNoteQuery.data, matchingNotes]);
  const noteEditorOptions = useMemo(
    () =>
      mergeNoteLinkOptions(
        entityLinkOptions,
        visibleNotes
          .filter((note) => note.id !== editingNote?.id)
          .map((note) => ({
            value: encodeNoteLinkOptionValue("note", note.id),
            label: note.title,
            description: note.contentPlain.slice(0, 120) || "Markdown note",
            searchText: `${note.title} ${note.contentPlain} ${(note.tags ?? []).join(" ")}`,
            kind: getEntityKindForCrudEntityType("note") ?? undefined
          }))
      ),
    [editingNote?.id, entityLinkOptions, visibleNotes]
  );
  useEffect(() => {
    if (!focusedNoteId) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`forge-note-${focusedNoteId}`);
      if (typeof target?.scrollIntoView === "function") {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedNoteId, visibleNotes]);
  const todayNoteAp =
    countNotesCreatedOnLocalDate(visibleNotes) *
    estimateQuickNoteActionPointLoad().totalAp;
  const activeMenuNote = menuState
    ? (visibleNotes.find((note) => note.id === menuState.noteId) ?? null)
    : null;
  const activeMenuPrimaryLink = activeMenuNote
    ? getPrimaryNavigableLink(activeMenuNote)
    : null;
  const activeMenuHref = activeMenuPrimaryLink
    ? getEntityRoute(
        activeMenuPrimaryLink.entityType,
        activeMenuPrimaryLink.entityId
      )
    : null;

  const activeMenuItems = useMemo<FloatingActionMenuItem[]>(() => {
    if (!activeMenuNote) {
      return [];
    }
    return [
      {
        id: "open-linked",
        label: "Open linked record",
        description: activeMenuHref
          ? "Jump back into the main entity this note is attached to."
          : "This note has no navigable linked record yet.",
        icon: ArrowUpRight,
        disabled: !activeMenuHref,
        onSelect: () => {
          if (activeMenuHref) {
            navigate(activeMenuHref);
          }
        }
      },
      {
        id: "edit-note",
        label: "Edit note",
        description:
          "Update the Markdown body, note tags, expiry, or connected entity links.",
        icon: Pencil,
        onSelect: () => {
          setEditingNote(activeMenuNote);
          setEditorOpen(true);
        }
      },
      {
        id: "delete-note",
        label: "Delete note",
        description: "Soft-delete this note from the main workspace.",
        icon: Trash2,
        tone: "danger",
        disabled: deleteMutation.isPending,
        onSelect: () => {
          setNotePendingDelete(activeMenuNote);
          setMenuState(null);
        }
      }
    ];
  }, [activeMenuHref, activeMenuNote, deleteMutation, navigate]);

  const mutationError = deleteMutation.error;
  const canLoadOlderNotes =
    Boolean(notesQuery.hasNextPage) && matchingNotes.length < NOTES_MAX_VISIBLE;
  const reachedSafetyCap =
    matchingNotes.length >= NOTES_MAX_VISIBLE &&
    matchingTotal > matchingNotes.length;

  if (notesQuery.isError && !notesQuery.data) {
    return (
      <ErrorState
        eyebrow="Notes"
        error={notesQuery.error}
        onRetry={() => void notesQuery.refetch()}
      />
    );
  }

  return (
    <div className="grid gap-5">
      <PageHero
        title="Notes"
        titleText="Notes"
        description="Notes are first-class Markdown entities in Forge. Search them by linked records, note tags, date, or free text, then create durable or ephemeral notes that stay connected to the rest of the graph."
        badge={`${matchingTotal} matching`}
        actions={
          <Button
            onClick={() => {
              setEditingNote(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="size-4" />
            New note
          </Button>
        }
      />

      <section className="grid gap-4 lg:grid-cols-4">
        <Card className="border-[var(--primary)]/16 shadow-[var(--card-shadow)]">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
            Quick note default
          </div>
          <div className="mt-3 font-display text-4xl text-[var(--primary)]">
            {formatLifeForceAp(estimateQuickNoteActionPointLoad().totalAp)}
          </div>
          <div className="mt-2 text-sm text-[var(--ui-ink-soft)]">
            Standalone notes count as a tiny Action Point impulse unless a
            richer active work context already covers them.
          </div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
            Notes created today
          </div>
          <div className="mt-3 font-display text-4xl text-[var(--ui-ink-strong)]">
            {formatLifeForceAp(todayNoteAp)}
          </div>
          <div className="mt-2 text-sm text-[var(--ui-ink-soft)]">
            Visible notes created today in this workspace at the default quick
            note cost.
          </div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
            Life Force sync
          </div>
          <div className="mt-3 text-2xl font-display text-[var(--ui-ink-strong)]">
            {lifeForceQuery.isError
              ? "Unavailable"
              : lifeForceQuery.data
                ? `${formatLifeForceAp(lifeForceQuery.data.spentTodayAp)} / ${formatLifeForceAp(lifeForceQuery.data.dailyBudgetAp)}`
                : "Loading..."}
          </div>
          <div className="mt-2 text-sm text-[var(--ui-ink-soft)]">
            Notes participate in the same Action Point ledger as tasks, habits,
            movement, and calendar work.
          </div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
            Instant headroom
          </div>
          <div className="mt-3 text-2xl font-display text-[var(--ui-ink-strong)]">
            {lifeForceQuery.isError
              ? "Unavailable"
              : lifeForceQuery.data
                ? formatLifeForceRate(lifeForceQuery.data.instantFreeApPerHour)
                : "Loading..."}
          </div>
          <div className="mt-2 text-sm text-[var(--ui-ink-soft)]">
            Useful when deciding whether to just capture a quick note or stay
            inside a heavier work stream.
          </div>
        </Card>
      </section>

      <NoteFiltersBox>
        <Card className="grid gap-4">
          <NoteFilterInput
            entityOptions={entityFilterOptions}
            selectedEntityValues={selectedEntityValues}
            onSelectedEntityValuesChange={setSelectedEntityValues}
            selectedTextTerms={selectedTextTerms}
            onSelectedTextTermsChange={setSelectedTextTerms}
            onSearchEntityOptions={searchEntityFilterOptions}
          />

          <NoteTagsInput
            value={selectedTagValues}
            onChange={setSelectedTagValues}
            placeholder="Filter by memory tag or custom note tag"
          />

          <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="grid min-w-0 gap-1.5 text-xs text-[var(--ui-ink-soft)]">
              <span>Author</span>
              <Input
                value={author}
                maxLength={160}
                onChange={(event) => setAuthor(event.target.value)}
                placeholder="Any author"
              />
            </label>
            <label className="grid min-w-0 gap-1.5 text-xs text-[var(--ui-ink-soft)]">
              <span>Updated from</span>
              <Input
                type="date"
                value={updatedFrom}
                onChange={(event) => setUpdatedFrom(event.target.value)}
              />
            </label>
            <label className="grid min-w-0 gap-1.5 text-xs text-[var(--ui-ink-soft)]">
              <span>Updated to</span>
              <Input
                type="date"
                value={updatedTo}
                onChange={(event) => setUpdatedTo(event.target.value)}
              />
            </label>
            <label className="grid min-w-0 gap-1.5 text-xs text-[var(--ui-ink-soft)]">
              <span>Observed from</span>
              <Input
                type="date"
                value={observedFrom}
                onChange={(event) => setObservedFrom(event.target.value)}
              />
            </label>
            <label className="grid min-w-0 gap-1.5 text-xs text-[var(--ui-ink-soft)]">
              <span>Observed to</span>
              <Input
                type="date"
                value={observedTo}
                onChange={(event) => setObservedTo(event.target.value)}
              />
            </label>
          </div>
        </Card>
      </NoteFiltersBox>

      {mutationError ? (
        <div
          role="alert"
          className="rounded-[18px] border border-[color-mix(in_srgb,var(--danger)_24%,var(--ui-border-subtle)_76%)] bg-[var(--ui-danger-soft)] px-4 py-3 text-sm text-[var(--danger)]"
        >
          {mutationError instanceof Error
            ? mutationError.message
            : "Forge could not move the note to the bin."}
        </div>
      ) : null}

      {focusedNoteQuery.isError ? (
        <div
          role="alert"
          className="rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-sm text-[var(--ui-ink-soft)]"
        >
          The linked note could not be opened. The matching note list remains
          available.
        </div>
      ) : null}

      {notesQuery.isFetchNextPageError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-[color-mix(in_srgb,var(--danger)_24%,var(--ui-border-subtle)_76%)] bg-[var(--ui-danger-soft)] px-4 py-3 text-sm text-[var(--danger)]"
        >
          <span>
            Older notes could not be loaded. The pages above are intact.
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            pending={notesQuery.isFetchingNextPage}
            pendingLabel="Retrying"
            onClick={() => void notesQuery.fetchNextPage()}
          >
            Retry older notes
          </Button>
        </div>
      ) : null}

      {notesQuery.isLoading ? (
        <Card
          role="status"
          aria-live="polite"
          className="text-sm text-[var(--ui-ink-soft)]"
        >
          Loading notes…
        </Card>
      ) : visibleNotes.length === 0 ? (
        <EmptyState
          eyebrow="Notes"
          title="No matching notes yet"
          description="Try broader linked-entity filters, remove a date bound, or add the first durable note from the button above."
        />
      ) : (
        <NotesLibraryBox>
          <div className="grid gap-3">
            {visibleNotes.map((note) => {
              const primaryLink = getPrimaryNavigableLink(note);
              const href = primaryLink
                ? getEntityRoute(primaryLink.entityType, primaryLink.entityId)
                : null;
              const observedAt =
                typeof note.frontmatter.observedAt === "string"
                  ? note.frontmatter.observedAt
                  : null;
              return (
                <Card
                  key={note.id}
                  id={`forge-note-${note.id}`}
                  role="article"
                  aria-labelledby={`forge-note-title-${note.id}`}
                  aria-current={focusedNoteId === note.id ? "true" : undefined}
                  className={`min-w-0 overflow-hidden p-5 ${
                    focusedNoteId === note.id
                      ? "border-[color-mix(in_srgb,var(--info)_34%,var(--ui-border-subtle)_66%)] bg-[color-mix(in_srgb,var(--info)_10%,var(--ui-surface-1)_90%)] shadow-[var(--ui-shadow-soft)]"
                      : ""
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2
                        id={`forge-note-title-${note.id}`}
                        className="break-words text-base font-semibold text-[var(--ui-ink-strong)] [overflow-wrap:anywhere]"
                      >
                        {note.title}
                      </h2>
                      <div className="mt-1 break-words text-xs text-[var(--ui-ink-faint)] [overflow-wrap:anywhere]">
                        {(note.author ?? "Unknown author").toString()} •{" "}
                        {new Date(note.updatedAt).toLocaleString()}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge
                          className="bg-[var(--primary)]/12 text-[var(--primary)]"
                          wrap
                        >
                          {formatLifeForceAp(
                            estimateQuickNoteActionPointLoad(note).totalAp
                          )}{" "}
                          quick note
                        </Badge>
                        {note.links.map((link) => (
                          <Badge
                            key={`${note.id}-${link.entityType}-${link.entityId}-${link.anchorKey ?? ""}`}
                            className="bg-[var(--ui-surface-3)] text-[var(--ui-ink-soft)]"
                            wrap
                          >
                            {formatEntityTypeLabel(link.entityType)}
                            {link.anchorKey
                              ? ` · ${formatAnchorKeyLabel(link.anchorKey)}`
                              : ""}
                          </Badge>
                        ))}
                        {(note.tags ?? []).map((tag) => (
                          <Badge
                            key={`${note.id}-tag-${tag}`}
                            className="border-[var(--info)]/20 bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_78%,var(--ui-ink-strong)_22%)]"
                            wrap
                          >
                            {tag}
                          </Badge>
                        ))}
                        {observedAt ? (
                          <Badge
                            className="border-[var(--secondary)]/20 bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]"
                            wrap
                          >
                            Observed {new Date(observedAt).toLocaleString()}
                          </Badge>
                        ) : null}
                        {note.destroyAt ? (
                          <Badge
                            className="border-[var(--warning)]/20 bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]"
                            wrap
                          >
                            Ephemeral · deletes{" "}
                            {new Date(note.destroyAt).toLocaleString()}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-2 text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-3)] hover:text-[var(--ui-ink-strong)]"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const rect =
                          event.currentTarget.getBoundingClientRect();
                        setMenuState({
                          noteId: note.id,
                          position: {
                            x: rect.right - 8,
                            y: rect.bottom + 8
                          }
                        });
                      }}
                      aria-label={`Open actions for ${note.title}`}
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                  </div>

                  <div className="mt-4 min-w-0 max-w-full overflow-hidden">
                    <NoteMarkdownDisclosure
                      markdown={note.contentMarkdown}
                      plainText={note.contentPlain}
                      title={note.title}
                      className="line-clamp-none"
                    />
                  </div>
                  {href ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-4"
                      onClick={() => navigate(href)}
                    >
                      <ArrowUpRight className="size-4" />
                      Open linked record
                    </Button>
                  ) : null}
                </Card>
              );
            })}
            <div
              className="flex flex-col items-center gap-2 py-2 text-center text-xs text-[var(--ui-ink-faint)] sm:flex-row sm:justify-center"
              aria-live="polite"
            >
              <span>
                Showing the newest {matchingNotes.length} of {matchingTotal}{" "}
                matching notes.
              </span>
              {canLoadOlderNotes ? (
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
              ) : reachedSafetyCap ? (
                <span>
                  Refine the filters to search beyond the 400-note display cap.
                </span>
              ) : null}
            </div>
          </div>
        </NotesLibraryBox>
      )}

      <NoteEditorFlowDialog
        open={editorOpen}
        note={editingNote}
        initialLinkedValues={editingNote ? undefined : selectedEntityValues}
        entityOptions={noteEditorOptions}
        onSearchEntityOptions={searchEntityLinkOptions}
        availableTags={Array.from(
          new Set(visibleNotes.flatMap((note) => note.tags ?? []))
        )}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) {
            setEditingNote(null);
          }
        }}
        onSubmit={async (draft) => {
          if (editingNote) {
            await patchMutation.mutateAsync({
              noteId: editingNote.id,
              draft
            });
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

      <FloatingActionMenu
        open={Boolean(menuState)}
        title="Note actions"
        subtitle={
          activeMenuNote
            ? activeMenuNote.contentPlain.slice(0, 80) || "Markdown note"
            : undefined
        }
        items={activeMenuItems}
        position={menuState?.position ?? null}
        onClose={() => setMenuState(null)}
      />
    </div>
  );
}
