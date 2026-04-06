import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Plus, Sparkles, StickyNote } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { EntityLinkMultiSelect, type EntityLinkOption } from "@/components/psyche/entity-link-multiselect";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import { NoteTagsInput } from "@/components/notes/note-tags-input";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { SheetScaffold } from "@/components/experience/sheet-scaffold";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { EntityBadge } from "@/components/ui/entity-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/page-state";
import { Textarea } from "@/components/ui/textarea";
import { UserBadge } from "@/components/ui/user-badge";
import { UserSelectField } from "@/components/ui/user-select-field";
import { CalendarWeekToolbar } from "@/components/calendar/calendar-week-toolbar";
import {
  createNote,
  getPsycheObservationCalendar,
  listBehaviorPatterns,
  listTriggerReports,
  patchNote
} from "@/lib/api";
import { addDays, buildWeekDays, formatHourLabel, formatWeekday, startOfWeek } from "@/lib/calendar-ui";
import { parseDateTimeLocalToIso } from "@/lib/note-memory-tags";
import type { Note } from "@/lib/types";
import type { BehaviorPattern, PsycheObservationEntry, TriggerReport } from "@/lib/psyche-types";
import {
  formatOwnerSelectDefaultLabel,
  formatUserSummaryLine,
  getSingleSelectedUserId
} from "@/lib/user-ownership";

type ObservationDraft = {
  noteId: string | null;
  contentMarkdown: string;
  author: string;
  tags: string[];
  userId: string | null;
  observedAtInput: string;
  linkedPatternIds: string[];
  linkedTriggerReportId: string | null;
  preservedLinks: Note["links"];
};

const EMPTY_DRAFT: ObservationDraft = {
  noteId: null,
  contentMarkdown: "",
  author: "",
  tags: [],
  userId: null,
  observedAtInput: "",
  linkedPatternIds: [],
  linkedTriggerReportId: null,
  preservedLinks: []
};

function formatLocalDateTimeInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function formatLocalDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatClock(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function summarizeNote(note: Note) {
  const text = (note.contentPlain || note.contentMarkdown).replace(/\s+/g, " ").trim();
  if (text.length <= 120) {
    return text;
  }
  return `${text.slice(0, 117).trimEnd()}...`;
}

function moveObservedAtToSlot(sourceIso: string, day: Date, hour: number) {
  const source = new Date(sourceIso);
  const next = new Date(day);
  next.setHours(
    hour,
    Number.isNaN(source.getTime()) ? 0 : source.getMinutes(),
    0,
    0
  );
  return next.toISOString();
}

function buildDraftFromObservation(
  observation: PsycheObservationEntry | null,
  defaultUserId: string | null
): ObservationDraft {
  if (!observation) {
    return { ...EMPTY_DRAFT, userId: defaultUserId };
  }

  const preservedLinks = observation.note.links.filter(
    (link) =>
      link.entityType !== "behavior_pattern" &&
      link.entityType !== "trigger_report"
  );

  return {
    noteId: observation.note.id,
    contentMarkdown: observation.note.contentMarkdown,
    author: observation.note.author ?? "",
    tags: observation.note.tags ?? [],
    userId: observation.note.userId ?? defaultUserId,
    observedAtInput: formatLocalDateTimeInput(observation.observedAt),
    linkedPatternIds: observation.linkedPatterns.map((pattern) => pattern.id),
    linkedTriggerReportId: observation.linkedReports[0]?.id ?? null,
    preservedLinks
  };
}

function buildPatternOptions(patterns: BehaviorPattern[]) {
  return patterns.map((pattern) => ({
    value: pattern.id,
    label: pattern.title,
    description: `${pattern.targetBehavior || pattern.preferredResponse || "Pattern"}${pattern.user ? ` · ${formatUserSummaryLine(pattern.user)}` : ""}`,
    searchText: `${pattern.title} ${pattern.targetBehavior} ${pattern.description} ${pattern.preferredResponse}`.toLowerCase(),
    kind: "pattern"
  })) satisfies EntityLinkOption[];
}

function buildReportOptions(reports: TriggerReport[]) {
  return reports.map((report) => ({
    value: report.id,
    label: report.title,
    description: `${report.customEventType || report.eventSituation || "Trigger report"}${report.user ? ` · ${formatUserSummaryLine(report.user)}` : ""}`,
    searchText: `${report.title} ${report.customEventType} ${report.eventSituation}`.toLowerCase(),
    kind: "report"
  })) satisfies EntityLinkOption[];
}

export function PsycheSelfObservationPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const shell = useForgeShell();
  const selectedUserIds = Array.isArray(shell.selectedUserIds)
    ? shell.selectedUserIds
    : [];
  const defaultUserId = getSingleSelectedUserId(selectedUserIds);
  const [weekStart, setWeekStart] = useState(() => startOfWeek());
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [authorFilter, setAuthorFilter] = useState("");
  const [onlyHumanOwned, setOnlyHumanOwned] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<ObservationDraft>({
    ...EMPTY_DRAFT,
    userId: defaultUserId
  });
  const [draggedObservationId, setDraggedObservationId] = useState<string | null>(null);

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const days = useMemo(() => buildWeekDays(weekStart), [weekStart]);
  const hours = useMemo(() => Array.from({ length: 24 }, (_, index) => index), []);

  const observationQuery = useQuery({
    queryKey: [
      "forge-psyche-self-observation-calendar",
      weekStart.toISOString(),
      ...selectedUserIds
    ],
    queryFn: () =>
      getPsycheObservationCalendar({
        from: weekStart.toISOString(),
        to: weekEnd.toISOString(),
        userIds: selectedUserIds
      })
  });
  const patternsQuery = useQuery({
    queryKey: ["forge-psyche-patterns", ...selectedUserIds],
    queryFn: () => listBehaviorPatterns(selectedUserIds)
  });
  const reportsQuery = useQuery({
    queryKey: ["forge-psyche-reports", ...selectedUserIds],
    queryFn: () => listTriggerReports(selectedUserIds)
  });

  const saveObservationMutation = useMutation({
    mutationFn: async (value: ObservationDraft) => {
      const observedAt =
        parseDateTimeLocalToIso(value.observedAtInput) ?? new Date().toISOString();
      const links = [
        ...value.preservedLinks,
        ...value.linkedPatternIds.map((patternId) => ({
          entityType: "behavior_pattern" as const,
          entityId: patternId,
          anchorKey: null
        })),
        ...(value.linkedTriggerReportId
          ? [
              {
                entityType: "trigger_report" as const,
                entityId: value.linkedTriggerReportId,
                anchorKey: null
              }
            ]
          : [])
      ];

      if (value.noteId) {
        return patchNote(value.noteId, {
          contentMarkdown: value.contentMarkdown.trim(),
          author: value.author.trim() || null,
          tags: value.tags,
          userId: value.userId,
          frontmatter: {
            observedAt
          },
          links
        });
      }

      return createNote({
        contentMarkdown: value.contentMarkdown.trim(),
        author: value.author.trim() || null,
        tags: value.tags,
        userId: value.userId,
        frontmatter: {
          observedAt
        },
        links
      });
    },
    onSuccess: async () => {
      setSheetOpen(false);
      setDraft({ ...EMPTY_DRAFT, userId: defaultUserId });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["forge-psyche-self-observation-calendar"]
        }),
        queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-overview"] })
      ]);
    }
  });

  const moveObservationMutation = useMutation({
    mutationFn: async ({
      noteId,
      frontmatter
    }: {
      noteId: string;
      frontmatter: Record<string, unknown>;
    }) => patchNote(noteId, { frontmatter }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["forge-psyche-self-observation-calendar"]
      });
    }
  });

  const availableTags = observationQuery.data?.calendar.availableTags ?? [];
  const patternOptions = useMemo(
    () => buildPatternOptions(patternsQuery.data?.patterns ?? []),
    [patternsQuery.data?.patterns]
  );
  const reportOptions = useMemo(
    () => buildReportOptions(reportsQuery.data?.reports ?? []),
    [reportsQuery.data?.reports]
  );
  const scopeUsers = shell.snapshot.users.filter((user) =>
    selectedUserIds.includes(user.id)
  );
  const scopeSummary =
    selectedUserIds.length === 0
      ? "All owners in scope"
      : selectedUserIds.length === 1
        ? formatUserSummaryLine(scopeUsers[0] ?? null)
        : `${selectedUserIds.length} owners selected`;

  const visibleObservations = useMemo(() => {
    const observations = observationQuery.data?.calendar.observations ?? [];
    return observations.filter((observation) => {
      if (onlyHumanOwned && observation.note.user?.kind !== "human") {
        return false;
      }
      if (
        authorFilter.trim() &&
        !(observation.note.author ?? "")
          .toLowerCase()
          .includes(authorFilter.trim().toLowerCase())
      ) {
        return false;
      }
      if (
        selectedTags.length > 0 &&
        !selectedTags.every((tag) =>
          (observation.note.tags ?? []).some(
            (noteTag) => noteTag.toLowerCase() === tag.toLowerCase()
          )
        )
      ) {
        return false;
      }
      return true;
    });
  }, [
    authorFilter,
    observationQuery.data?.calendar.observations,
    onlyHumanOwned,
    selectedTags
  ]);

  const observationsBySlot = useMemo(() => {
    const map = new Map<string, PsycheObservationEntry[]>();
    for (const observation of visibleObservations) {
      const observedAt = new Date(observation.observedAt);
      const slotKey = `${formatLocalDayKey(observedAt)}:${observedAt.getHours()}`;
      const current = map.get(slotKey) ?? [];
      current.push(observation);
      map.set(slotKey, current);
    }
    for (const entries of map.values()) {
      entries.sort((left, right) => left.observedAt.localeCompare(right.observedAt));
    }
    return map;
  }, [visibleObservations]);

  const openComposerForSlot = (day: Date, hour: number) => {
    const seed = new Date(day);
    seed.setHours(hour, 0, 0, 0);
    setDraft({
      ...EMPTY_DRAFT,
      userId: defaultUserId,
      observedAtInput: formatLocalDateTimeInput(seed.toISOString())
    });
    setSheetOpen(true);
  };

  const openComposerForObservation = (observation: PsycheObservationEntry) => {
    setDraft(buildDraftFromObservation(observation, defaultUserId));
    setSheetOpen(true);
  };

  const handleDrop = async (
    observation: PsycheObservationEntry,
    day: Date,
    hour: number
  ) => {
    await moveObservationMutation.mutateAsync({
      noteId: observation.note.id,
      frontmatter: {
        ...observation.note.frontmatter,
        observedAt: moveObservedAtToSlot(observation.observedAt, day, hour)
      }
    });
  };

  if (observationQuery.isLoading) {
    return <SurfaceSkeleton />;
  }

  if (observationQuery.isError) {
    return (
      <ErrorState
        eyebrow="Self Observation"
        error={observationQuery.error}
        onRetry={() => void observationQuery.refetch()}
      />
    );
  }

  return (
    <div className="grid gap-5">
      <PageHero
        title="Self Observation"
        titleText="Self Observation"
        description="Map notes onto the real week by hour, then link the pattern and trigger report that belong to that moment."
        badge={`${visibleObservations.length} visible`}
        actions={
          <Button
            onClick={() => openComposerForSlot(new Date(), new Date().getHours())}
          >
            <Plus className="size-4" />
            Add observation
          </Button>
        }
      />

      <PsycheSectionNav />

      <Card className="grid gap-4 rounded-[32px] border border-white/8 bg-[linear-gradient(180deg,rgba(18,31,34,0.96),rgba(13,24,27,0.94))]">
        <CalendarWeekToolbar
          eyebrow="Observation week"
          description="Every note can live at the hour it actually happened. Filter the field, move through weeks, and keep pattern plus trigger links visible on the same card."
          weekStart={weekStart}
          badges={
            <>
              <Badge className="bg-white/[0.08] text-white/74">{scopeSummary}</Badge>
              <Badge className="bg-[rgba(110,231,183,0.14)] text-[var(--tertiary)]">
                {onlyHumanOwned ? "Human-owned only" : "All note owners"}
              </Badge>
            </>
          }
          onPrevious={() => setWeekStart(addDays(weekStart, -7))}
          onCurrent={() => setWeekStart(startOfWeek())}
          onNext={() => setWeekStart(addDays(weekStart, 7))}
        />

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)_auto]">
          <Input
            value={authorFilter}
            onChange={(event) => setAuthorFilter(event.target.value)}
            placeholder="Filter by free-text author"
          />
          <NoteTagsInput
            value={selectedTags}
            onChange={setSelectedTags}
            availableTags={availableTags}
            placeholder="Filter by note tag"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant={onlyHumanOwned ? "secondary" : "primary"}
              onClick={() => setOnlyHumanOwned(false)}
            >
              All notes
            </Button>
            <Button
              variant={onlyHumanOwned ? "primary" : "ghost"}
              onClick={() => setOnlyHumanOwned(true)}
            >
              Human only
            </Button>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden rounded-[32px] border border-white/8 bg-[linear-gradient(180deg,rgba(16,26,34,0.98),rgba(10,18,27,0.96))] p-0">
        <div className="hidden overflow-x-auto lg:block">
          <div className="min-w-[76rem]">
            <div className="grid grid-cols-[5rem_repeat(7,minmax(10rem,1fr))] border-b border-white/8 bg-[rgba(10,17,29,0.96)]">
              <div className="border-r border-white/8 px-3 py-4 text-[11px] uppercase tracking-[0.18em] text-white/34">
                Hour
              </div>
              {days.map((day) => (
                <div
                  key={day.toISOString()}
                  className="border-r border-white/8 px-3 py-4 last:border-r-0"
                >
                  <div className="text-sm font-medium text-white">
                    {formatWeekday(day)}
                  </div>
                  <div className="mt-1 text-xs text-white/42">
                    {formatLocalDayKey(day)}
                  </div>
                </div>
              ))}
            </div>

            {hours.map((hour) => (
              <div
                key={hour}
                className="grid grid-cols-[5rem_repeat(7,minmax(10rem,1fr))] border-b border-white/6 last:border-b-0"
              >
                <div className="border-r border-white/8 bg-[rgba(8,14,24,0.8)] px-3 py-4 text-sm text-white/52">
                  {formatHourLabel(hour)}
                </div>
                {days.map((day) => {
                  const dayKey = formatLocalDayKey(day);
                  const slotKey = `${dayKey}:${hour}`;
                  const slotObservations = observationsBySlot.get(slotKey) ?? [];
                  return (
                    <button
                      key={slotKey}
                      type="button"
                      data-self-observation-slot={slotKey}
                      className="min-h-[7rem] border-r border-white/6 px-2 py-2 text-left align-top last:border-r-0"
                      onClick={() => openComposerForSlot(day, hour)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const noteId =
                          event.dataTransfer.getData("text/forge-self-observation-id") ||
                          draggedObservationId;
                        if (!noteId) {
                          return;
                        }
                        const observation = visibleObservations.find(
                          (entry) => entry.note.id === noteId
                        );
                        if (!observation) {
                          return;
                        }
                        void handleDrop(observation, day, hour);
                        setDraggedObservationId(null);
                      }}
                    >
                      <div className="grid gap-2">
                        {slotObservations.map((observation) => (
                          <article
                            key={observation.id}
                            draggable
                            data-self-observation-card={observation.note.id}
                            onDragStart={(event) => {
                              setDraggedObservationId(observation.note.id);
                              event.dataTransfer.setData(
                                "text/forge-self-observation-id",
                                observation.note.id
                              );
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                              openComposerForObservation(observation);
                            }}
                            className="rounded-[22px] border border-white/10 bg-[rgba(110,231,183,0.08)] p-3 text-white transition hover:border-white/18 hover:bg-[rgba(110,231,183,0.12)]"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="text-xs uppercase tracking-[0.16em] text-[rgba(110,231,183,0.82)]">
                                {formatClock(observation.observedAt)}
                              </div>
                              <UserBadge user={observation.note.user} compact />
                            </div>
                            <div className="mt-2 line-clamp-3 text-sm leading-6 text-white/78">
                              {summarizeNote(observation.note)}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {observation.note.author ? (
                                <Badge className="bg-white/[0.08] text-white/72">
                                  {observation.note.author}
                                </Badge>
                              ) : null}
                              {(observation.note.tags ?? []).slice(0, 2).map((tag) => (
                                <Badge
                                  key={`${observation.id}-${tag}`}
                                  className="bg-cyan-400/10 text-cyan-50"
                                >
                                  {tag}
                                </Badge>
                              ))}
                              {observation.linkedPatterns.slice(0, 2).map((pattern) => (
                                <EntityBadge
                                  key={pattern.id}
                                  kind="pattern"
                                  label={pattern.title}
                                  compact
                                  gradient={false}
                                />
                              ))}
                              {observation.linkedReports.slice(0, 1).map((report) => (
                                <EntityBadge
                                  key={report.id}
                                  kind="report"
                                  label={report.title}
                                  compact
                                  gradient={false}
                                />
                              ))}
                            </div>
                          </article>
                        ))}
                        {slotObservations.length === 0 ? (
                          <div className="rounded-[18px] border border-dashed border-white/8 px-3 py-4 text-sm text-white/34">
                            Add observation
                          </div>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 p-4 lg:hidden">
          {days.map((day) => {
            const dayKey = formatLocalDayKey(day);
            return (
              <div
                key={dayKey}
                className="rounded-[24px] border border-white/8 bg-white/[0.03] p-3"
              >
                <div className="flex items-center justify-between gap-3 rounded-[18px] bg-[rgba(10,16,30,0.96)] px-3 py-3">
                  <div>
                    <div className="text-sm font-medium text-white">
                      {formatWeekday(day)}
                    </div>
                    <div className="mt-1 text-xs text-white/42">{dayKey}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => openComposerForSlot(day, new Date().getHours())}
                  >
                    <Plus className="size-4" />
                    Add
                  </Button>
                </div>
                <div className="mt-3 grid gap-2">
                  {hours.map((hour) => {
                    const slotKey = `${dayKey}:${hour}`;
                    const slotObservations = observationsBySlot.get(slotKey) ?? [];
                    return (
                      <button
                        key={slotKey}
                        type="button"
                        data-self-observation-slot-mobile={slotKey}
                        className="rounded-[18px] border border-white/6 bg-white/[0.03] px-3 py-3 text-left"
                        onClick={() => openComposerForSlot(day, hour)}
                      >
                        <div className="text-xs uppercase tracking-[0.16em] text-white/34">
                          {formatHourLabel(hour)}
                        </div>
                        <div className="mt-2 grid gap-2">
                          {slotObservations.length === 0 ? (
                            <div className="text-sm text-white/38">Add observation</div>
                          ) : (
                            slotObservations.map((observation) => (
                              <div
                                key={observation.id}
                                className="rounded-[16px] bg-[rgba(110,231,183,0.1)] p-3"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <UserBadge user={observation.note.user} compact />
                                  {observation.linkedPatterns.slice(0, 1).map((pattern) => (
                                    <EntityBadge
                                      key={pattern.id}
                                      kind="pattern"
                                      label={pattern.title}
                                      compact
                                      gradient={false}
                                    />
                                  ))}
                                </div>
                                <div className="mt-2 text-sm leading-6 text-white/78">
                                  {summarizeNote(observation.note)}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <SheetScaffold
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        eyebrow="Self Observation"
        title={draft.noteId ? "Edit observation" : "Add observation"}
        description="Capture the note, set the exact observation time, then attach the pattern and trigger report that belong to that moment."
      >
        <div className="grid gap-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <UserSelectField
              value={draft.userId}
              users={shell.snapshot.users}
              onChange={(userId) => setDraft((current) => ({ ...current, userId }))}
              defaultLabel={formatOwnerSelectDefaultLabel(
                shell.snapshot.users.find((user) => user.id === defaultUserId) ??
                  null,
                "Choose observation owner"
              )}
              help="Observation notes stay multi-user aware just like the rest of Forge."
            />
            <label className="grid gap-2">
              <span className="text-sm font-medium text-white">Author</span>
              <Input
                value={draft.author}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, author: event.target.value }))
                }
                placeholder="Albert"
              />
            </label>
          </div>

          <label className="grid gap-2">
            <span className="text-sm font-medium text-white">Observed at</span>
            <Input
              type="datetime-local"
              value={draft.observedAtInput}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  observedAtInput: event.target.value
                }))
              }
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium text-white">Observation note</span>
            <Textarea
              value={draft.contentMarkdown}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  contentMarkdown: event.target.value
                }))
              }
              className="min-h-[14rem]"
              placeholder="What happened in this hour, what did you notice, and what mattered?"
            />
          </label>

          <NoteTagsInput
            value={draft.tags}
            onChange={(tags) => setDraft((current) => ({ ...current, tags }))}
            availableTags={availableTags}
            placeholder="Add note tags for the observation"
          />

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="grid gap-2">
              <div className="text-sm font-medium text-white">Linked patterns</div>
              <EntityLinkMultiSelect
                options={patternOptions}
                selectedValues={draft.linkedPatternIds}
                onChange={(linkedPatternIds) =>
                  setDraft((current) => ({ ...current, linkedPatternIds }))
                }
                placeholder="Search patterns in scope"
                emptyMessage="No patterns in scope yet."
              />
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-white">
                  Trigger report
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1.5 text-xs text-white/72 transition hover:bg-white/[0.1] hover:text-white"
                  onClick={() => {
                    const search = new URLSearchParams();
                    search.set("create", "1");
                    if (draft.observedAtInput) {
                      search.set(
                        "occurredAt",
                        parseDateTimeLocalToIso(draft.observedAtInput) ??
                          new Date().toISOString()
                      );
                    }
                    if (draft.userId) {
                      search.set("userId", draft.userId);
                    }
                    navigate(`/psyche/reports?${search.toString()}`);
                    setSheetOpen(false);
                  }}
                >
                  <Sparkles className="size-3.5" />
                  Create report from time
                </button>
              </div>
              <EntityLinkMultiSelect
                options={reportOptions}
                selectedValues={draft.linkedTriggerReportId ? [draft.linkedTriggerReportId] : []}
                onChange={(values) =>
                  setDraft((current) => ({
                    ...current,
                    linkedTriggerReportId: values.at(-1) ?? null
                  }))
                }
                placeholder="Search trigger reports in scope"
                emptyMessage="No trigger reports in scope yet."
              />
            </div>
          </div>

          <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-white/70">
              <StickyNote className="size-4 text-[var(--tertiary)]" />
              Cards appear in the hourly week grid at the exact observation time.
            </div>
            <div className="mt-2 text-sm leading-6 text-white/52">
              Move them later by drag-and-drop or edit the timestamp directly
              here when the observation belonged to a different hour than the
              note creation moment.
            </div>
          </div>

          <div className="flex flex-wrap justify-between gap-3">
            {draft.linkedTriggerReportId ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-2 text-sm text-white/72 transition hover:bg-white/[0.1] hover:text-white"
                onClick={() => navigate(`/psyche/reports/${draft.linkedTriggerReportId}`)}
              >
                <ArrowUpRight className="size-4" />
                Open linked report
              </button>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setSheetOpen(false)}>
                Cancel
              </Button>
              <Button
                pending={saveObservationMutation.isPending}
                pendingLabel="Saving"
                disabled={draft.contentMarkdown.trim().length === 0}
                onClick={() => void saveObservationMutation.mutateAsync(draft)}
              >
                Save observation
              </Button>
            </div>
          </div>
        </div>
      </SheetScaffold>
    </div>
  );
}
