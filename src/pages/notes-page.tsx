import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  EntityLinkMultiSelect,
  type EntityLinkOption
} from "@/components/psyche/entity-link-multiselect";
import { NoteFilterInput } from "@/components/notes/note-filter-input";
import { NoteMarkdown } from "@/components/notes/note-markdown";
import { NoteTagsInput } from "@/components/notes/note-tags-input";
import { PageHero } from "@/components/shell/page-hero";
import { useForgeShell } from "@/components/shell/app-shell";
import {
  NoteComposerBox,
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
import { Textarea } from "@/components/ui/textarea";
import { invalidateForgeSnapshot } from "@/store/api/invalidate-forge-snapshot";
import {
  createNote,
  getLifeForce,
  listBehaviors,
  listBehaviorPatterns,
  listBeliefs,
  listModes,
  listNotes,
  listPsycheValues,
  listTriggerReports,
  patchNote,
  deleteNote
} from "@/lib/api";
import { getEntityKindForCrudEntityType } from "@/lib/entity-visuals";
import {
  estimateQuickNoteActionPointLoad,
  formatLifeForceAp,
  formatLifeForceRate
} from "@/lib/life-force-display";
import {
  buildDestroyAtFromDelay,
  formatNoteDestroyAtInput,
  normalizeNoteTags,
  parseDateTimeLocalToIso,
  type NoteDestroyDelayUnit
} from "@/lib/note-memory-tags";
import {
  formatAnchorKeyLabel,
  formatEntityTypeLabel,
  getEntityRoute,
  getPrimaryNavigableLink
} from "@/lib/note-helpers";
import type { CrudEntityType, Note, NoteLink } from "@/lib/types";
import {
  buildOwnedEntitySearchText,
  formatOwnedEntityDescription
} from "@/lib/user-ownership";

const FILTERABLE_ENTITY_TYPES = new Set<CrudEntityType>([
  "goal",
  "project",
  "task",
  "strategy",
  "habit",
  "tag",
  "psyche_value",
  "behavior_pattern",
  "behavior",
  "belief_entry",
  "mode_profile",
  "trigger_report"
]);

type EditableNoteDraft = {
  contentMarkdown: string;
  author: string;
  linkedValues: string[];
  tags: string[];
  destroyAtInput: string;
  destroyDelayValue: string;
  destroyDelayUnit: NoteDestroyDelayUnit;
};

function isCrudEntityType(value: string): value is CrudEntityType {
  return FILTERABLE_ENTITY_TYPES.has(value as CrudEntityType);
}

function encodeLinkedValue(entityType: CrudEntityType, entityId: string) {
  return `${entityType}:${entityId}`;
}

function decodeLinkedValue(
  value: string
): { entityType: CrudEntityType; entityId: string } | null {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) {
    return null;
  }
  const entityType = value.slice(0, separatorIndex);
  if (!isCrudEntityType(entityType)) {
    return null;
  }
  return {
    entityType,
    entityId: value.slice(separatorIndex + 1)
  };
}

function isLinkedEntityRef(
  value: { entityType: CrudEntityType; entityId: string } | null
): value is { entityType: CrudEntityType; entityId: string } {
  return value !== null;
}

function parseLinkedValues(searchParams: URLSearchParams) {
  const values = searchParams.getAll("linkedTo");
  const legacyEntityType = searchParams.get("entityType");
  const legacyEntityId = searchParams.get("entityId");
  if (
    legacyEntityType &&
    legacyEntityId &&
    isCrudEntityType(legacyEntityType)
  ) {
    values.unshift(encodeLinkedValue(legacyEntityType, legacyEntityId));
  }
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean))
  );
}

function parseTextTerms(searchParams: URLSearchParams) {
  return Array.from(
    new Set(
      searchParams
        .getAll("textTerms")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function parseTagTerms(searchParams: URLSearchParams) {
  return normalizeNoteTags(searchParams.getAll("tags"));
}

function toDraft(
  note?: Note | null,
  linkedValues: string[] = []
): EditableNoteDraft {
  return {
    contentMarkdown: note?.contentMarkdown ?? "",
    author: note?.author ?? "",
    linkedValues:
      note?.links.map((link) =>
        encodeLinkedValue(link.entityType, link.entityId)
      ) ?? linkedValues,
    tags: normalizeNoteTags(note?.tags ?? []),
    destroyAtInput: formatNoteDestroyAtInput(note?.destroyAt ?? null),
    destroyDelayValue: "",
    destroyDelayUnit: "days"
  };
}

function sortOptions(options: EntityLinkOption[]) {
  return [...options].sort((left, right) =>
    left.label.localeCompare(right.label)
  );
}

function resolveDestroyAt(draft: EditableNoteDraft) {
  return (
    parseDateTimeLocalToIso(draft.destroyAtInput) ??
    buildDestroyAtFromDelay(draft.destroyDelayValue, draft.destroyDelayUnit)
  );
}

export function NotesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const shell = useForgeShell();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerDraft, setComposerDraft] = useState<EditableNoteDraft>(() =>
    toDraft(null, parseLinkedValues(searchParams))
  );
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<EditableNoteDraft | null>(
    null
  );
  const [menuState, setMenuState] = useState<{
    noteId: string;
    position: { x: number; y: number };
  } | null>(null);

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
  const selectedUserIds = Array.isArray(shell.selectedUserIds)
    ? shell.selectedUserIds
    : [];
  const lifeForceQuery = useQuery({
    queryKey: ["forge-life-force", ...selectedUserIds],
    queryFn: async () => (await getLifeForce(selectedUserIds)).lifeForce
  });

  useEffect(() => {
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
    setSearchParams(next, { replace: true });
  }, [
    author,
    selectedEntityValues,
    selectedTagValues,
    selectedTextTerms,
    setSearchParams,
    updatedFrom,
    updatedTo
  ]);

  const entityLinkOptions = useMemo(() => {
    const baseOptions: EntityLinkOption[] = [
      ...shell.snapshot.goals.map((goal) => ({
        value: encodeLinkedValue("goal", goal.id),
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
        value: encodeLinkedValue("project", project.id),
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
        value: encodeLinkedValue("task", task.id),
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
        value: encodeLinkedValue("strategy", strategy.id),
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
        value: encodeLinkedValue("habit", habit.id),
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
        value: encodeLinkedValue("tag", tag.id),
        label: tag.name,
        description: formatOwnedEntityDescription(tag.description, tag.user, tag.kind),
        searchText: buildOwnedEntitySearchText(
          [tag.name, tag.kind, tag.description],
          tag
        ),
        kind: getEntityKindForCrudEntityType("tag") ?? undefined
      })),
      ...((valuesQuery.data?.values ?? []).map((value) => ({
        value: encodeLinkedValue("psyche_value", value.id),
        label: value.title,
        description: formatOwnedEntityDescription(value.description, value.user, "Psyche value"),
        searchText: buildOwnedEntitySearchText(
          [value.title, value.description, value.valuedDirection],
          value
        ),
        kind: getEntityKindForCrudEntityType("psyche_value") ?? undefined
      })) satisfies EntityLinkOption[]),
      ...((patternsQuery.data?.patterns ?? []).map((pattern) => ({
        value: encodeLinkedValue("behavior_pattern", pattern.id),
        label: pattern.title,
        description: formatOwnedEntityDescription(
          pattern.description,
          pattern.user,
          "Behavior pattern"
        ),
        searchText: buildOwnedEntitySearchText(
          [pattern.title, pattern.description, pattern.targetBehavior],
          pattern
        ),
        kind: getEntityKindForCrudEntityType("behavior_pattern") ?? undefined
      })) satisfies EntityLinkOption[]),
      ...((behaviorsQuery.data?.behaviors ?? []).map((behavior) => ({
        value: encodeLinkedValue("behavior", behavior.id),
        label: behavior.title,
        description: formatOwnedEntityDescription(
          behavior.description,
          behavior.user,
          "Behavior"
        ),
        searchText: buildOwnedEntitySearchText(
          [behavior.title, behavior.description, behavior.kind],
          behavior
        ),
        kind: getEntityKindForCrudEntityType("behavior") ?? undefined
      })) satisfies EntityLinkOption[]),
      ...((beliefsQuery.data?.beliefs ?? []).map((belief) => ({
        value: encodeLinkedValue("belief_entry", belief.id),
        label: belief.statement,
        description: formatOwnedEntityDescription(
          belief.flexibleAlternative || belief.originNote,
          belief.user,
          "Belief"
        ),
        searchText: buildOwnedEntitySearchText(
          [belief.statement, belief.flexibleAlternative, belief.originNote],
          belief
        ),
        kind: getEntityKindForCrudEntityType("belief_entry") ?? undefined
      })) satisfies EntityLinkOption[]),
      ...((modesQuery.data?.modes ?? []).map((mode) => ({
        value: encodeLinkedValue("mode_profile", mode.id),
        label: mode.title,
        description: formatOwnedEntityDescription(
          mode.archetype || mode.family,
          mode.user,
          "Mode"
        ),
        searchText: buildOwnedEntitySearchText(
          [mode.title, mode.archetype, mode.family, mode.persona],
          mode
        ),
        kind: getEntityKindForCrudEntityType("mode_profile") ?? undefined
      })) satisfies EntityLinkOption[]),
      ...((reportsQuery.data?.reports ?? []).map((report) => ({
        value: encodeLinkedValue("trigger_report", report.id),
        label: report.title,
        description: formatOwnedEntityDescription(
          report.eventSituation,
          report.user,
          "Trigger report"
        ),
        searchText: buildOwnedEntitySearchText(
          [report.title, report.eventSituation, report.customEventType ?? ""],
          report
        ),
        kind: getEntityKindForCrudEntityType("trigger_report") ?? undefined
      })) satisfies EntityLinkOption[])
    ];

    return sortOptions(baseOptions);
  }, [
    behaviorsQuery.data?.behaviors,
    beliefsQuery.data?.beliefs,
    modesQuery.data?.modes,
    patternsQuery.data?.patterns,
    reportsQuery.data?.reports,
    shell.snapshot.dashboard.projects,
    shell.snapshot.goals,
    shell.snapshot.habits,
    shell.snapshot.strategies,
    shell.snapshot.tags,
    shell.snapshot.tasks,
    valuesQuery.data?.values
  ]);

  const entityFilterOptions = useMemo(
    () =>
      entityLinkOptions.map((option) => {
        const decoded = decodeLinkedValue(option.value);
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
        .map((value) => decodeLinkedValue(value))
        .filter(Boolean) as Array<{
        entityType: CrudEntityType;
        entityId: string;
      }>,
    [selectedEntityValues]
  );

  const notesQuery = useQuery({
    queryKey: [
      "notes-index",
      selectedEntityValues.join("|"),
      selectedTagValues.join("|"),
      selectedTextTerms.join("|"),
      author.trim(),
      updatedFrom,
      updatedTo
    ],
    queryFn: () =>
      listNotes({
        linkedTo: selectedEntityFilters,
        tags: selectedTagValues,
        textTerms: selectedTextTerms,
        author: author.trim() || undefined,
        updatedFrom: updatedFrom || undefined,
        updatedTo: updatedTo || undefined,
        limit: 200
      })
  });

  const invalidateNotes = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["notes-index"] }),
      invalidateForgeSnapshot(queryClient)
    ]);
  };

  const createMutation = useMutation({
    mutationFn: async (draft: EditableNoteDraft) =>
      createNote({
        contentMarkdown: draft.contentMarkdown.trim(),
        author: draft.author.trim() || null,
        tags: normalizeNoteTags(draft.tags),
        destroyAt: resolveDestroyAt(draft),
        links: draft.linkedValues
          .map((value) => decodeLinkedValue(value))
          .filter(isLinkedEntityRef)
          .map((entry) => ({
            entityType: entry.entityType,
            entityId: entry.entityId
          }))
      }),
    onSuccess: async () => {
      setComposerDraft(toDraft(null, selectedEntityValues));
      setComposerOpen(false);
      await invalidateNotes();
    }
  });

  const patchMutation = useMutation({
    mutationFn: async ({
      noteId,
      draft
    }: {
      noteId: string;
      draft: EditableNoteDraft;
    }) =>
      patchNote(noteId, {
        contentMarkdown: draft.contentMarkdown.trim(),
        author: draft.author.trim() || null,
        tags: normalizeNoteTags(draft.tags),
        destroyAt: resolveDestroyAt(draft),
        links: draft.linkedValues
          .map((value) => decodeLinkedValue(value))
          .filter(isLinkedEntityRef)
          .map((entry) => ({
            entityType: entry.entityType,
            entityId: entry.entityId
          }))
      }),
    onSuccess: async () => {
      setEditingNoteId(null);
      setEditingDraft(null);
      await invalidateNotes();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (noteId: string) => deleteNote(noteId),
    onSuccess: invalidateNotes
  });

  const visibleNotes = notesQuery.data?.notes ?? [];
  const todayKey = new Date().toISOString().slice(0, 10);
  const notesCreatedToday = visibleNotes.filter(
    (note) => note.createdAt.slice(0, 10) === todayKey
  );
  const todayNoteAp =
    notesCreatedToday.length * estimateQuickNoteActionPointLoad().totalAp;
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
            navigate(
              activeMenuHref.includes("#")
                ? activeMenuHref
                : `${activeMenuHref}#notes`
            );
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
          setEditingNoteId(activeMenuNote.id);
          setEditingDraft(toDraft(activeMenuNote));
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
          void deleteMutation.mutateAsync(activeMenuNote.id);
        }
      }
    ];
  }, [activeMenuHref, activeMenuNote, deleteMutation, navigate]);

  if (notesQuery.isError) {
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
        badge={`${visibleNotes.length} visible`}
        actions={
          <Button
            onClick={() => {
              setComposerDraft(toDraft(null, selectedEntityValues));
              setComposerOpen(true);
            }}
          >
            <Plus className="size-4" />
            New note
          </Button>
        }
      />

      <section className="grid gap-4 lg:grid-cols-4">
        <Card className="border-[var(--primary)]/16 shadow-[0_0_0_1px_rgba(245,158,11,0.08)]">
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Quick note default
          </div>
          <div className="mt-3 font-display text-4xl text-[var(--primary)]">
            {formatLifeForceAp(estimateQuickNoteActionPointLoad().totalAp)}
          </div>
          <div className="mt-2 text-sm text-white/58">
            Standalone notes count as a tiny Action Point impulse unless a
            richer active work context already covers them.
          </div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Notes created today
          </div>
          <div className="mt-3 font-display text-4xl text-white">
            {formatLifeForceAp(todayNoteAp)}
          </div>
          <div className="mt-2 text-sm text-white/58">
            Visible notes created today in this workspace at the default quick
            note cost.
          </div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Life Force sync
          </div>
          <div className="mt-3 text-2xl font-display text-white">
            {lifeForceQuery.data
              ? `${formatLifeForceAp(lifeForceQuery.data.spentTodayAp)} / ${formatLifeForceAp(lifeForceQuery.data.dailyBudgetAp)}`
              : "Loading..."}
          </div>
          <div className="mt-2 text-sm text-white/58">
            Notes participate in the same Action Point ledger as tasks, habits,
            movement, and calendar work.
          </div>
        </Card>
        <Card>
          <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/45">
            Instant headroom
          </div>
          <div className="mt-3 text-2xl font-display text-white">
            {lifeForceQuery.data
              ? formatLifeForceRate(lifeForceQuery.data.instantFreeApPerHour)
              : "Loading..."}
          </div>
          <div className="mt-2 text-sm text-white/58">
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
        />

        <NoteTagsInput
          value={selectedTagValues}
          onChange={setSelectedTagValues}
          placeholder="Filter by memory tag or custom note tag"
        />

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,0.38fr)_minmax(12rem,0.38fr)]">
          <Input
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
            placeholder="Filter by author"
          />
          <Input
            type="date"
            value={updatedFrom}
            onChange={(event) => setUpdatedFrom(event.target.value)}
          />
          <Input
            type="date"
            value={updatedTo}
            onChange={(event) => setUpdatedTo(event.target.value)}
          />
        </div>
        </Card>
      </NoteFiltersBox>

      {composerOpen ? (
        <NoteComposerBox>
          <Card className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-label text-[11px] uppercase tracking-[0.16em] text-white/42">
                New note
              </div>
              <div className="mt-2 text-sm leading-6 text-white/58">
                Notes are independent Markdown entities. Link them to one or
                more real records, add memory-system or custom tags, and
                optionally make them ephemeral with an automatic destroy time.
                Standalone notes default to{" "}
                {formatLifeForceAp(estimateQuickNoteActionPointLoad().totalAp)}.
              </div>
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                setComposerOpen(false);
                setComposerDraft(toDraft(null, selectedEntityValues));
              }}
            >
              Cancel
            </Button>
          </div>

          <Textarea
            value={composerDraft.contentMarkdown}
            onChange={(event) =>
              setComposerDraft((current) => ({
                ...current,
                contentMarkdown: event.target.value
              }))
            }
            className="min-h-[16rem]"
            placeholder="Write the note in Markdown. This can be as short as a handoff line or as long as a wiki page."
          />

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <Input
              value={composerDraft.author}
              onChange={(event) =>
                setComposerDraft((current) => ({
                  ...current,
                  author: event.target.value
                }))
              }
              placeholder="Optional author"
            />
            <EntityLinkMultiSelect
              options={entityLinkOptions}
              selectedValues={composerDraft.linkedValues}
              onChange={(values) =>
                setComposerDraft((current) => ({
                  ...current,
                  linkedValues: values
                }))
              }
              placeholder="Link this note to strategies, goals, projects, tasks, habits, or human/bot-owned records"
              emptyMessage="No matching entities found yet."
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <NoteTagsInput
              value={composerDraft.tags}
              onChange={(tags) =>
                setComposerDraft((current) => ({ ...current, tags }))
              }
            />
            <div className="grid gap-3 rounded-[22px] bg-white/[0.03] p-4">
              <div>
                <div className="font-label text-[11px] uppercase tracking-[0.16em] text-white/42">
                  Ephemeral auto-destroy
                </div>
                <div className="mt-2 text-xs leading-5 text-white/48">
                  Set an exact destroy time or a relative delay. Leaving both
                  blank keeps the note durable.
                </div>
              </div>
              <Input
                type="datetime-local"
                value={composerDraft.destroyAtInput}
                onChange={(event) =>
                  setComposerDraft((current) => ({
                    ...current,
                    destroyAtInput: event.target.value
                  }))
                }
              />
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem]">
                <Input
                  type="number"
                  min="1"
                  value={composerDraft.destroyDelayValue}
                  onChange={(event) =>
                    setComposerDraft((current) => ({
                      ...current,
                      destroyDelayValue: event.target.value
                    }))
                  }
                  placeholder="Destroy after"
                />
                <select
                  className="rounded-[14px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
                  value={composerDraft.destroyDelayUnit}
                  onChange={(event) =>
                    setComposerDraft((current) => ({
                      ...current,
                      destroyDelayUnit: event.target
                        .value as NoteDestroyDelayUnit
                    }))
                  }
                >
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                </select>
              </div>
            </div>
          </div>

          <div className="rounded-[22px] bg-white/[0.03] p-4">
            <div className="font-label text-[11px] uppercase tracking-[0.16em] text-white/42">
              Preview
            </div>
            <div className="mt-3">
              {composerDraft.contentMarkdown.trim() ? (
                <NoteMarkdown markdown={composerDraft.contentMarkdown} />
              ) : (
                <div className="text-sm text-white/42">
                  Markdown preview appears here.
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              pending={createMutation.isPending}
              pendingLabel="Saving"
              disabled={
                composerDraft.contentMarkdown.trim().length === 0 ||
                composerDraft.linkedValues.length === 0
              }
              onClick={() => void createMutation.mutateAsync(composerDraft)}
            >
              Save note
            </Button>
          </div>
          </Card>
        </NoteComposerBox>
      ) : null}

      {notesQuery.isLoading ? (
        <Card className="text-sm text-white/58">Loading notes…</Card>
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
            const isEditing =
              editingNoteId === note.id && editingDraft !== null;
            return (
              <Card key={note.id} className="min-w-0 overflow-hidden p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-[0.16em] text-white/38">
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
                          className="bg-white/[0.08] text-white/68"
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
                  <button
                    type="button"
                    className="rounded-full border border-white/8 bg-white/[0.04] p-2 text-white/58 transition hover:bg-white/[0.08] hover:text-white"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const rect = event.currentTarget.getBoundingClientRect();
                      setMenuState({
                        noteId: note.id,
                        position: {
                          x: rect.right - 8,
                          y: rect.bottom + 8
                        }
                      });
                    }}
                    aria-label={`Open actions for note ${note.id}`}
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </div>

                {isEditing ? (
                  <div className="mt-4 grid gap-4">
                    <Textarea
                      value={editingDraft.contentMarkdown}
                      onChange={(event) =>
                        setEditingDraft((current) =>
                          current
                            ? {
                                ...current,
                                contentMarkdown: event.target.value
                              }
                            : current
                        )
                      }
                      className="min-h-[14rem]"
                    />

                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                      <Input
                        value={editingDraft.author}
                        onChange={(event) =>
                          setEditingDraft((current) =>
                            current
                              ? { ...current, author: event.target.value }
                              : current
                          )
                        }
                        placeholder="Optional author"
                      />
                      <EntityLinkMultiSelect
                        options={entityLinkOptions}
                        selectedValues={editingDraft.linkedValues}
                        onChange={(values) =>
                          setEditingDraft((current) =>
                            current
                              ? { ...current, linkedValues: values }
                              : current
                          )
                        }
                        placeholder="Update the linked entities"
                        emptyMessage="No matching entities found yet."
                      />
                    </div>

                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                      <NoteTagsInput
                        value={editingDraft.tags}
                        onChange={(tags) =>
                          setEditingDraft((current) =>
                            current ? { ...current, tags } : current
                          )
                        }
                      />
                      <div className="grid gap-3 rounded-[22px] bg-white/[0.03] p-4">
                        <div>
                          <div className="font-label text-[11px] uppercase tracking-[0.16em] text-white/42">
                            Ephemeral auto-destroy
                          </div>
                          <div className="mt-2 text-xs leading-5 text-white/48">
                            Set an exact destroy time or a relative delay.
                            Leaving both blank keeps the note durable.
                          </div>
                        </div>
                        <Input
                          type="datetime-local"
                          value={editingDraft.destroyAtInput}
                          onChange={(event) =>
                            setEditingDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    destroyAtInput: event.target.value
                                  }
                                : current
                            )
                          }
                        />
                        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem]">
                          <Input
                            type="number"
                            min="1"
                            value={editingDraft.destroyDelayValue}
                            onChange={(event) =>
                              setEditingDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      destroyDelayValue: event.target.value
                                    }
                                  : current
                              )
                            }
                            placeholder="Destroy after"
                          />
                          <select
                            className="rounded-[14px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white"
                            value={editingDraft.destroyDelayUnit}
                            onChange={(event) =>
                              setEditingDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      destroyDelayUnit: event.target
                                        .value as NoteDestroyDelayUnit
                                    }
                                  : current
                              )
                            }
                          >
                            <option value="hours">Hours</option>
                            <option value="days">Days</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[22px] bg-white/[0.03] p-4">
                      <div className="font-label text-[11px] uppercase tracking-[0.16em] text-white/42">
                        Preview
                      </div>
                      <div className="mt-3">
                        {editingDraft.contentMarkdown.trim() ? (
                          <NoteMarkdown
                            markdown={editingDraft.contentMarkdown}
                          />
                        ) : (
                          <div className="text-sm text-white/42">
                            No content yet.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setEditingNoteId(null);
                          setEditingDraft(null);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        pending={patchMutation.isPending}
                        pendingLabel="Saving"
                        disabled={
                          editingDraft.contentMarkdown.trim().length === 0 ||
                          editingDraft.linkedValues.length === 0
                        }
                        onClick={() =>
                          void patchMutation.mutateAsync({
                            noteId: note.id,
                            draft: editingDraft
                          })
                        }
                      >
                        Save changes
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="mt-4 w-full text-left"
                      onClick={() => {
                        if (href) {
                          navigate(href.includes("#") ? href : `${href}#notes`);
                        }
                      }}
                      disabled={!href}
                    >
                      <NoteMarkdown
                        markdown={note.contentMarkdown}
                        className="line-clamp-none"
                      />
                    </button>
                    {href ? (
                      <div className="mt-4 inline-flex text-xs uppercase tracking-[0.16em] text-[var(--secondary)]">
                        Open linked record
                      </div>
                    ) : null}
                  </>
                )}
              </Card>
            );
          })}
          </div>
        </NotesLibraryBox>
      )}

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
