import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Download,
  Plus,
  Sparkles,
  StickyNote,
  Trash2
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  EntityLinkMultiSelect,
  type EntityLinkOption
} from "@/components/psyche/entity-link-multiselect";
import { NoteTagsInput } from "@/components/notes/note-tags-input";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { SheetScaffold } from "@/components/experience/sheet-scaffold";
import { PsycheSectionNav } from "@/components/psyche/psyche-section-nav";
import { useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";
import { CalendarWeekToolbar } from "@/components/calendar/calendar-week-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/page-state";
import { SelectMenu, type SelectMenuOption } from "@/components/ui/select-menu";
import { Textarea } from "@/components/ui/textarea";
import { EntityBadge } from "@/components/ui/entity-badge";
import { UserBadge } from "@/components/ui/user-badge";
import { UserSelectField } from "@/components/ui/user-select-field";
import {
  createNote,
  deleteNote,
  exportPsycheObservationCalendar,
  getPsycheObservationCalendar,
  listBehaviors,
  listBehaviorPatterns,
  listBeliefs,
  listModes,
  listPsycheValues,
  listTriggerReports,
  patchNote
} from "@/lib/api";
import {
  addDays,
  buildWeekDays,
  formatHourLabel,
  formatWeekday,
  startOfWeek
} from "@/lib/calendar-ui";
import {
  getActivityEventCtaLabel,
  getActivityEventHref
} from "@/lib/entity-links";
import {
  normalizeNoteTags,
  parseDateTimeLocalToIso
} from "@/lib/note-memory-tags";
import { formatEntityTypeLabel } from "@/lib/note-helpers";
import { cn } from "@/lib/utils";
import type {
  Behavior,
  BehaviorPattern,
  BeliefEntry,
  ModeProfile,
  PsycheObservationActivityEntry,
  PsycheObservationEntry,
  PsycheValue,
  TriggerReport
} from "@/lib/psyche-types";
import type { ActivityEvent, CrudEntityType, Note, NoteLink } from "@/lib/types";
import {
  buildOwnedEntitySearchText,
  formatOwnedEntityDescription,
  formatOwnerSelectDefaultLabel,
  formatUserSummaryLine,
  getSingleSelectedUserId
} from "@/lib/user-ownership";

const SELF_OBSERVATION_TAG = "Self-observation";
const FORGE_ACTIVITY_TAG = "Forge activity";
const ENTITY_TAG_PREFIX = "Entity · ";
const ALL_ENTITY_FILTER = "all";

type CalendarExportFormat = "markdown" | "csv" | "json" | "ics";
type ObservationViewMode = "compact" | "informative" | "extended";

const OBSERVATION_VIEW_OPTIONS: SelectMenuOption<ObservationViewMode>[] = [
  {
    value: "compact",
    label: "Compact",
    description: "One row per entry: time, entity, title."
  },
  {
    value: "informative",
    label: "Informative",
    description: "Adds one short preview line and key context."
  },
  {
    value: "extended",
    label: "Extended",
    description: "Adds a little more context with a hard text cap."
  }
];

const CALENDAR_EXPORT_OPTIONS: SelectMenuOption<CalendarExportFormat>[] = [
  {
    value: "markdown",
    label: "Markdown brief",
    description: "Readable weekly notes for sharing with a therapist."
  },
  {
    value: "csv",
    label: "CSV table",
    description: "Structured rows for spreadsheet review."
  },
  {
    value: "json",
    label: "JSON archive",
    description: "Full structured payload with filters and metadata."
  },
  {
    value: "ics",
    label: "Calendar file",
    description: "Importable weekly timeline in calendar apps."
  }
];

const LINKABLE_ENTITY_TYPES = new Set<CrudEntityType>([
  "goal",
  "project",
  "task",
  "strategy",
  "habit",
  "tag",
  "psyche_value",
  "behavior",
  "belief_entry",
  "mode_profile"
]);

type ObservationDraft = {
  noteId: string | null;
  contentMarkdown: string;
  author: string;
  tags: string[];
  userId: string | null;
  observedAtInput: string;
  linkedPatternIds: string[];
  linkedTriggerReportId: string | null;
  linkedEntityValues: string[];
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
  linkedEntityValues: []
};

function seedObservationTags(tags: string[] = []) {
  return normalizeNoteTags([SELF_OBSERVATION_TAG, ...tags]);
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
  if (!LINKABLE_ENTITY_TYPES.has(entityType as CrudEntityType)) {
    return null;
  }
  return {
    entityType: entityType as CrudEntityType,
    entityId: value.slice(separatorIndex + 1)
  };
}

function isLinkedEntityRef(
  value: { entityType: CrudEntityType; entityId: string } | null
): value is { entityType: CrudEntityType; entityId: string } {
  return value !== null;
}

function dedupeNoteLinks(links: NoteLink[]) {
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

function truncateText(value: string, maxChars: number) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function summarizeNote(note: Note, maxChars = 120) {
  return truncateText(note.contentPlain || note.contentMarkdown, maxChars);
}

function isMovementObservation(observation: PsycheObservationEntry) {
  const movement = observation.note.frontmatter.movement;
  return !!movement && typeof movement === "object" && !Array.isArray(movement);
}

type TimelineEntry =
  | {
      kind: "observation";
      id: string;
      observedAt: string;
      tags: string[];
      observation: PsycheObservationEntry;
    }
  | {
      kind: "activity";
      id: string;
      observedAt: string;
      tags: string[];
      activity: PsycheObservationActivityEntry;
    };

function isObservationEntry(
  entry: TimelineEntry
): entry is Extract<TimelineEntry, { kind: "observation" }> {
  return entry.kind === "observation";
}

function getTimelineOwner(entry: TimelineEntry) {
  return isObservationEntry(entry)
    ? entry.observation.note.user
    : entry.activity.event.user;
}

function getTimelineSearchText(entry: TimelineEntry) {
  if (isObservationEntry(entry)) {
    const observation = entry.observation;
    return [
      observation.note.contentPlain,
      observation.note.contentMarkdown,
      observation.note.author ?? "",
      observation.tags.join(" "),
      observation.linkedPatterns.map((pattern) => pattern.title).join(" "),
      observation.linkedReports.map((report) => report.title).join(" ")
    ]
      .join(" ")
      .toLowerCase();
  }

  const event = entry.activity.event;
  return [
    event.title,
    event.description,
    event.actor ?? "",
    event.eventType,
    event.entityType,
    entry.tags.join(" ")
  ]
    .join(" ")
    .toLowerCase();
}

function matchesSelectedTags(entryTags: string[], selectedTags: string[]) {
  if (selectedTags.length === 0) {
    return true;
  }
  const normalizedEntryTags = new Set(
    entryTags.map((tag) => tag.toLowerCase())
  );
  return selectedTags.some((tag) => normalizedEntryTags.has(tag.toLowerCase()));
}

function summarizeActivityEvent(event: ActivityEvent, maxChars = 160) {
  const summary = [event.title, event.description].filter(Boolean).join(". ");
  return truncateText(summary, maxChars);
}

function getObservationTitle(
  observation: PsycheObservationEntry,
  maxChars: number
) {
  const text = observation.note.contentPlain || observation.note.contentMarkdown;
  return truncateText(text || "Observation", maxChars);
}

function getObservationEntityLabel(observation: PsycheObservationEntry) {
  if (isMovementObservation(observation)) {
    return "Movement";
  }
  const linkedEntity = observation.note.links.find(
    (link) =>
      link.entityType !== "behavior_pattern" &&
      link.entityType !== "trigger_report"
  );
  if (linkedEntity) {
    return formatEntityTypeLabel(linkedEntity.entityType);
  }
  if (observation.linkedPatterns.length > 0) {
    return "Pattern";
  }
  if (observation.linkedReports.length > 0) {
    return "Trigger report";
  }
  return "Observation";
}

function getActivityEntityLabel(activity: PsycheObservationActivityEntry) {
  const taggedEntity = activity.tags.find((tag) =>
    tag.startsWith(ENTITY_TAG_PREFIX)
  );
  if (taggedEntity) {
    return taggedEntity.replace(`${ENTITY_TAG_PREFIX}`, "");
  }
  return truncateText(activity.event.entityType || "Activity", 32);
}

function buildEntityFilterOptions(
  availableTags: string[]
): SelectMenuOption<string>[] {
  const entityTags = availableTags
    .filter((tag) => tag.startsWith(ENTITY_TAG_PREFIX))
    .sort((left, right) => left.localeCompare(right));

  return [
    {
      value: ALL_ENTITY_FILTER,
      label: "All entities",
      description: "Show every entity kind across the week."
    },
    ...entityTags.map((tag) => ({
      value: tag,
      label: tag.replace(`${ENTITY_TAG_PREFIX}`, ""),
      description: `Only entries tagged ${tag}.`
    }))
  ];
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
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
    return {
      ...EMPTY_DRAFT,
      tags: seedObservationTags(),
      userId: defaultUserId
    };
  }

  return {
    noteId: observation.note.id,
    contentMarkdown: observation.note.contentMarkdown,
    author: observation.note.author ?? "",
    tags: normalizeNoteTags(observation.note.tags ?? []),
    userId: observation.note.userId ?? defaultUserId,
    observedAtInput: formatLocalDateTimeInput(observation.observedAt),
    linkedPatternIds: observation.linkedPatterns.map((pattern) => pattern.id),
    linkedTriggerReportId: observation.linkedReports[0]?.id ?? null,
    linkedEntityValues: observation.note.links
      .filter(
        (link) =>
          link.entityType !== "behavior_pattern" &&
          link.entityType !== "trigger_report" &&
          LINKABLE_ENTITY_TYPES.has(link.entityType)
      )
      .map((link) => encodeLinkedValue(link.entityType, link.entityId))
  };
}

function buildPatternOptions(patterns: BehaviorPattern[]) {
  return patterns.map((pattern) => ({
    value: pattern.id,
    label: pattern.title,
    description: `${pattern.targetBehavior || pattern.preferredResponse || "Pattern"}${pattern.user ? ` · ${formatUserSummaryLine(pattern.user)}` : ""}`,
    searchText:
      `${pattern.title} ${pattern.targetBehavior} ${pattern.description} ${pattern.preferredResponse}`.toLowerCase(),
    kind: "pattern"
  })) satisfies EntityLinkOption[];
}

function buildReportOptions(reports: TriggerReport[]) {
  return reports.map((report) => ({
    value: report.id,
    label: report.title,
    description: `${report.customEventType || report.eventSituation || "Trigger report"}${report.user ? ` · ${formatUserSummaryLine(report.user)}` : ""}`,
    searchText:
      `${report.title} ${report.customEventType} ${report.eventSituation}`.toLowerCase(),
    kind: "report"
  })) satisfies EntityLinkOption[];
}

function buildGenericLinkOptions({
  goals,
  projects,
  tasks,
  strategies,
  habits,
  tags,
  values,
  behaviors,
  beliefs,
  modes
}: {
  goals: Array<{
    id: string;
    title: string;
    description?: string | null;
    user?: Note["user"];
  }>;
  projects: Array<{
    id: string;
    title: string;
    description?: string | null;
    user?: Note["user"];
  }>;
  tasks: Array<{
    id: string;
    title: string;
    description?: string | null;
    owner?: string | null;
    user?: Note["user"];
  }>;
  strategies: Array<{
    id: string;
    title: string;
    overview?: string | null;
    endStateDescription?: string | null;
    user?: Note["user"];
  }>;
  habits: Array<{
    id: string;
    title: string;
    description?: string | null;
    user?: Note["user"];
  }>;
  tags: Array<{
    id: string;
    name: string;
    kind?: string | null;
    description?: string | null;
    user?: Note["user"];
  }>;
  values: PsycheValue[];
  behaviors: Behavior[];
  beliefs: BeliefEntry[];
  modes: ModeProfile[];
}) {
  const options = [
    ...goals.map((goal) => ({
      value: encodeLinkedValue("goal", goal.id),
      label: goal.title,
      description: formatOwnedEntityDescription(
        goal.description,
        goal.user,
        "Goal"
      ),
      searchText: buildOwnedEntitySearchText(
        [goal.title, goal.description ?? ""],
        goal
      ),
      kind: "goal"
    })),
    ...projects.map((project) => ({
      value: encodeLinkedValue("project", project.id),
      label: project.title,
      description: formatOwnedEntityDescription(
        project.description,
        project.user,
        "Project"
      ),
      searchText: buildOwnedEntitySearchText(
        [project.title, project.description ?? ""],
        project
      ),
      kind: "project"
    })),
    ...tasks.map((task) => ({
      value: encodeLinkedValue("task", task.id),
      label: task.title,
      description: formatOwnedEntityDescription(
        task.description,
        task.user,
        task.owner ?? undefined
      ),
      searchText: buildOwnedEntitySearchText(
        [task.title, task.description ?? "", task.owner ?? ""],
        task
      ),
      kind: "task"
    })),
    ...strategies.map((strategy) => ({
      value: encodeLinkedValue("strategy", strategy.id),
      label: strategy.title,
      description: formatOwnedEntityDescription(
        strategy.overview,
        strategy.user,
        "Strategy"
      ),
      searchText: buildOwnedEntitySearchText(
        [
          strategy.title,
          strategy.overview ?? "",
          strategy.endStateDescription ?? ""
        ],
        strategy
      ),
      kind: "strategy"
    })),
    ...habits.map((habit) => ({
      value: encodeLinkedValue("habit", habit.id),
      label: habit.title,
      description: formatOwnedEntityDescription(
        habit.description,
        habit.user,
        "Habit"
      ),
      searchText: buildOwnedEntitySearchText(
        [habit.title, habit.description ?? ""],
        habit
      ),
      kind: "habit"
    })),
    ...tags.map((tag) => ({
      value: encodeLinkedValue("tag", tag.id),
      label: tag.name,
      description: formatOwnedEntityDescription(
        tag.description,
        tag.user,
        tag.kind ?? undefined
      ),
      searchText: buildOwnedEntitySearchText(
        [tag.name, tag.kind ?? "", tag.description ?? ""],
        tag
      )
    })),
    ...values.map((value) => ({
      value: encodeLinkedValue("psyche_value", value.id),
      label: value.title,
      description: formatOwnedEntityDescription(
        value.description,
        value.user,
        "Psyche value"
      ),
      searchText: buildOwnedEntitySearchText(
        [value.title, value.description, value.valuedDirection],
        value
      ),
      kind: "value"
    })),
    ...behaviors.map((behavior) => ({
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
      kind: "behavior"
    })),
    ...beliefs.map((belief) => ({
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
      kind: "belief"
    })),
    ...modes.map((mode) => ({
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
      kind: "mode"
    }))
  ] satisfies EntityLinkOption[];

  return [...options].sort((left, right) =>
    left.label.localeCompare(right.label)
  );
}

function renderOtherLinkBadges(observation: PsycheObservationEntry) {
  return observation.note.links
    .filter(
      (link) =>
        link.entityType !== "behavior_pattern" &&
        link.entityType !== "trigger_report"
    )
    .slice(0, 2)
    .map((link) => (
      <Badge
        key={`${observation.note.id}-${link.entityType}-${link.entityId}`}
        className="bg-white/[0.08] text-white/68"
      >
        {formatEntityTypeLabel(link.entityType)}
      </Badge>
    ));
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
  const [entityFilter, setEntityFilter] = useState<string>(ALL_ENTITY_FILTER);
  const [searchFilter, setSearchFilter] = useState("");
  const [onlyHumanOwned, setOnlyHumanOwned] = useState(false);
  const [showObservations, setShowObservations] = useState(true);
  const [showActivity, setShowActivity] = useState(true);
  const [viewMode, setViewMode] =
    useState<ObservationViewMode>("informative");
  const [exportFormat, setExportFormat] =
    useState<CalendarExportFormat>("markdown");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<ObservationDraft>({
    ...EMPTY_DRAFT,
    tags: seedObservationTags(),
    userId: defaultUserId
  });
  const [draggedObservationId, setDraggedObservationId] = useState<
    string | null
  >(null);

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const days = useMemo(() => buildWeekDays(weekStart), [weekStart]);
  const hours = useMemo(
    () => Array.from({ length: 24 }, (_, index) => index),
    []
  );

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
  const valuesQuery = useQuery({
    queryKey: ["forge-psyche-values", ...selectedUserIds],
    queryFn: () => listPsycheValues(selectedUserIds)
  });
  const patternsQuery = useQuery({
    queryKey: ["forge-psyche-patterns", ...selectedUserIds],
    queryFn: () => listBehaviorPatterns(selectedUserIds)
  });
  const behaviorsQuery = useQuery({
    queryKey: ["forge-psyche-behaviors", ...selectedUserIds],
    queryFn: () => listBehaviors(selectedUserIds)
  });
  const beliefsQuery = useQuery({
    queryKey: ["forge-psyche-beliefs", ...selectedUserIds],
    queryFn: () => listBeliefs(selectedUserIds)
  });
  const modesQuery = useQuery({
    queryKey: ["forge-psyche-modes", ...selectedUserIds],
    queryFn: () => listModes(selectedUserIds)
  });
  const reportsQuery = useQuery({
    queryKey: ["forge-psyche-reports", ...selectedUserIds],
    queryFn: () => listTriggerReports(selectedUserIds)
  });

  const exportCalendarMutation = useMutation({
    mutationFn: () =>
      exportPsycheObservationCalendar({
        from: weekStart.toISOString(),
        to: weekEnd.toISOString(),
        userIds: selectedUserIds,
        tags: normalizeNoteTags(
          entityFilter === ALL_ENTITY_FILTER
            ? selectedTags
            : [...selectedTags, entityFilter]
        ),
        includeObservations: showObservations,
        includeActivity: showActivity,
        onlyHumanOwned,
        search: searchFilter.trim(),
        format: exportFormat
      }),
    onSuccess: (result) => {
      downloadBlob(
        result.blob,
        result.fileName ?? `forge-self-observation.${exportFormat}`
      );
    }
  });

  const saveObservationMutation = useMutation({
    mutationFn: async (value: ObservationDraft) => {
      const observedAt =
        parseDateTimeLocalToIso(value.observedAtInput) ??
        new Date().toISOString();
      const links = dedupeNoteLinks([
        ...value.linkedEntityValues
          .map((entry) => decodeLinkedValue(entry))
          .filter(isLinkedEntityRef)
          .map((entry) => ({
            entityType: entry.entityType,
            entityId: entry.entityId,
            anchorKey: null
          })),
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
      ]);

      if (value.noteId) {
        return patchNote(value.noteId, {
          contentMarkdown: value.contentMarkdown.trim(),
          author: value.author.trim() || null,
          tags: normalizeNoteTags(value.tags),
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
        tags: normalizeNoteTags(value.tags),
        userId: value.userId,
        frontmatter: {
          observedAt
        },
        links
      });
    },
    onSuccess: async () => {
      setSheetOpen(false);
      setDraft({
        ...EMPTY_DRAFT,
        tags: seedObservationTags(),
        userId: defaultUserId
      });
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

  const deleteObservationMutation = useMutation({
    mutationFn: (noteId: string) => deleteNote(noteId),
    onSuccess: async (_result, noteId) => {
      if (draft.noteId === noteId) {
        setSheetOpen(false);
        setDraft({
          ...EMPTY_DRAFT,
          tags: seedObservationTags(),
          userId: defaultUserId
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["forge-psyche-self-observation-calendar"]
        }),
        queryClient.invalidateQueries({ queryKey: ["forge-snapshot"] }),
        queryClient.invalidateQueries({ queryKey: ["forge-psyche-overview"] })
      ]);
    }
  });

  const availableTags = useMemo(
    () =>
      normalizeNoteTags([
        SELF_OBSERVATION_TAG,
        FORGE_ACTIVITY_TAG,
        ...(observationQuery.data?.calendar.availableTags ?? [])
      ]),
    [observationQuery.data?.calendar.availableTags]
  );
  const patternOptions = useMemo(
    () => buildPatternOptions(patternsQuery.data?.patterns ?? []),
    [patternsQuery.data?.patterns]
  );
  const entityFilterOptions = useMemo(
    () => buildEntityFilterOptions(availableTags),
    [availableTags]
  );
  const reportOptions = useMemo(
    () => buildReportOptions(reportsQuery.data?.reports ?? []),
    [reportsQuery.data?.reports]
  );
  const genericLinkOptions = useMemo(
    () =>
      buildGenericLinkOptions({
        goals: shell.snapshot.goals,
        projects: shell.snapshot.dashboard.projects,
        tasks: shell.snapshot.tasks,
        strategies: shell.snapshot.strategies,
        habits: shell.snapshot.habits,
        tags: shell.snapshot.tags,
        values: valuesQuery.data?.values ?? [],
        behaviors: behaviorsQuery.data?.behaviors ?? [],
        beliefs: beliefsQuery.data?.beliefs ?? [],
        modes: modesQuery.data?.modes ?? []
      }),
    [
      behaviorsQuery.data?.behaviors,
      beliefsQuery.data?.beliefs,
      modesQuery.data?.modes,
      shell.snapshot.dashboard.projects,
      shell.snapshot.goals,
      shell.snapshot.habits,
      shell.snapshot.strategies,
      shell.snapshot.tags,
      shell.snapshot.tasks,
      valuesQuery.data?.values
    ]
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

  const visibleEntries = useMemo(() => {
    const activeTagFilters = normalizeNoteTags(
      entityFilter === ALL_ENTITY_FILTER
        ? selectedTags
        : [...selectedTags, entityFilter]
    );
    const entries: TimelineEntry[] = [
      ...(observationQuery.data?.calendar.observations ?? []).map(
        (observation) => ({
          kind: "observation" as const,
          id: observation.note.id,
          observedAt: observation.observedAt,
          tags: observation.tags,
          observation
        })
      ),
      ...(observationQuery.data?.calendar.activity ?? []).map((activity) => ({
        kind: "activity" as const,
        id: activity.id,
        observedAt: activity.observedAt,
        tags: activity.tags,
        activity
      }))
    ];

    return entries
      .filter((entry) => {
        if (isObservationEntry(entry) && !showObservations) {
          return false;
        }
        if (!isObservationEntry(entry) && !showActivity) {
          return false;
        }
        if (onlyHumanOwned && getTimelineOwner(entry)?.kind !== "human") {
          return false;
        }
        if (!matchesSelectedTags(entry.tags, activeTagFilters)) {
          return false;
        }
        const trimmedSearch = searchFilter.trim().toLowerCase();
        if (trimmedSearch && !getTimelineSearchText(entry).includes(trimmedSearch)) {
          return false;
        }
        return true;
      })
      .sort((left, right) => left.observedAt.localeCompare(right.observedAt));
  }, [
    entityFilter,
    observationQuery.data?.calendar.activity,
    observationQuery.data?.calendar.observations,
    onlyHumanOwned,
    searchFilter,
    selectedTags,
    showActivity,
    showObservations
  ]);

  const visibleObservationCount = useMemo(
    () => visibleEntries.filter(isObservationEntry).length,
    [visibleEntries]
  );
  const visibleActivityCount = useMemo(
    () => visibleEntries.filter((entry) => !isObservationEntry(entry)).length,
    [visibleEntries]
  );

  const entriesBySlot = useMemo(() => {
    const map = new Map<string, TimelineEntry[]>();
    for (const entry of visibleEntries) {
      const observedAt = new Date(entry.observedAt);
      const slotKey = `${formatLocalDayKey(observedAt)}:${observedAt.getHours()}`;
      const current = map.get(slotKey) ?? [];
      current.push(entry);
      map.set(slotKey, current);
    }
    for (const entries of map.values()) {
      entries.sort((left, right) => left.observedAt.localeCompare(right.observedAt));
    }
    return map;
  }, [visibleEntries]);

  const renderObservationCard = (observation: PsycheObservationEntry) => {
    const compact = viewMode === "compact";
    const extended = viewMode === "extended";
    const title = getObservationTitle(
      observation,
      compact ? 92 : extended ? 144 : 112
    );
    const preview = compact
      ? ""
      : summarizeNote(observation.note, extended ? 220 : 120);
    const entityLabel = getObservationEntityLabel(observation);
    const visibleTagCount = extended ? 4 : 2;

    return (
      <div
        key={observation.id}
        draggable={!compact}
      data-self-observation-card={observation.note.id}
      onDragStart={(event) => {
        if (compact) {
          return;
        }
        setDraggedObservationId(observation.note.id);
        event.dataTransfer.setData(
          "text/forge-self-observation-id",
          observation.note.id
        );
      }}
      onDragEnd={() => setDraggedObservationId(null)}
      className={cn(
        "rounded-[22px] border p-3 text-white transition hover:border-white/18",
        isMovementObservation(observation)
          ? "border-[rgba(126,229,255,0.14)] bg-[rgba(126,229,255,0.08)] hover:bg-[rgba(126,229,255,0.12)]"
          : "border-white/10 bg-[rgba(110,231,183,0.08)] hover:bg-[rgba(110,231,183,0.12)]",
        compact && "rounded-[16px] px-2.5 py-2"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => openComposerForObservation(observation)}
        >
          {compact ? (
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="shrink-0 text-[11px] uppercase tracking-[0.16em] text-[rgba(110,231,183,0.82)]">
                {formatClock(observation.observedAt)}
              </div>
              <Badge className="shrink-0 bg-cyan-400/12 text-cyan-100">
                {entityLabel}
              </Badge>
              <div className="min-w-0 truncate text-sm font-medium text-white/86">
                {title}
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-xs uppercase tracking-[0.16em] text-[rgba(110,231,183,0.82)]">
                    {formatClock(observation.observedAt)}
                  </div>
                  <Badge className="bg-cyan-400/12 text-cyan-100">
                    {entityLabel}
                  </Badge>
                  <UserBadge user={observation.note.user} compact />
                </div>
              </div>
              <div className="mt-2 text-sm font-medium text-white">{title}</div>
              <div
                className={cn(
                  "mt-1 text-sm leading-6 text-white/72",
                  extended ? "line-clamp-3" : "line-clamp-1"
                )}
              >
                {preview}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {observation.note.author ? (
                  <Badge className="bg-white/[0.08] text-white/72">
                    {observation.note.author}
                  </Badge>
                ) : null}
                {observation.tags.slice(0, visibleTagCount).map((tag) => (
                  <Badge
                    key={`${observation.id}-${tag}`}
                    className="bg-cyan-400/10 text-cyan-50"
                  >
                    {tag}
                  </Badge>
                ))}
                {renderOtherLinkBadges(observation)}
                {observation.linkedPatterns
                  .slice(0, extended ? 2 : 1)
                  .map((pattern) => (
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
            </>
          )}
        </button>
        {!compact ? (
          <button
            type="button"
            className="rounded-full border border-white/8 bg-white/[0.04] p-2 text-white/54 transition hover:bg-rose-500/18 hover:text-rose-100"
            aria-label={`Delete observation ${observation.note.id}`}
            onClick={(event) => {
              event.stopPropagation();
              void deleteObservationMutation.mutateAsync(observation.note.id);
            }}
          >
            <Trash2 className="size-3.5" />
          </button>
        ) : null}
      </div>
    </div>
    );
  };

  const renderActivityCard = (activity: PsycheObservationActivityEntry) => {
    const compact = viewMode === "compact";
    const extended = viewMode === "extended";
    const href = getActivityEventHref(activity.event);
    const ctaLabel = getActivityEventCtaLabel(activity.event);
    const title = truncateText(
      activity.event.title || "Forge activity",
      compact ? 92 : extended ? 144 : 112
    );
    const summary = compact
      ? ""
      : summarizeActivityEvent(activity.event, extended ? 220 : 120);
    const visibleTagCount = extended ? 4 : 2;
    return (
      <div
        key={activity.id}
        role={compact && href ? "button" : undefined}
        tabIndex={compact && href ? 0 : undefined}
        className={cn(
          "rounded-[22px] border border-white/8 bg-[rgba(255,255,255,0.04)] p-3 text-white/80",
          compact && "rounded-[16px] px-2.5 py-2",
          compact && href && "cursor-pointer"
        )}
        onClick={compact && href ? () => navigate(href) : undefined}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {compact ? (
              <div className="flex items-center gap-2 overflow-hidden">
                <div className="shrink-0 text-[11px] uppercase tracking-[0.16em] text-white/42">
                  {formatClock(activity.observedAt)}
                </div>
                <Badge className="shrink-0 bg-amber-300/12 text-amber-100">
                  {getActivityEntityLabel(activity)}
                </Badge>
                <div className="min-w-0 truncate text-sm font-medium text-white">
                  {title}
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-xs uppercase tracking-[0.16em] text-white/42">
                    {formatClock(activity.observedAt)}
                  </div>
                  <Badge className="bg-amber-300/12 text-amber-100">
                    {getActivityEntityLabel(activity)}
                  </Badge>
                  <UserBadge user={activity.event.user} compact />
                </div>
                <div className="mt-2 text-sm font-medium text-white">
                  {title}
                </div>
                {activity.event.description ? (
                  <div
                    className={cn(
                      "mt-1 text-sm leading-6 text-white/60",
                      extended ? "line-clamp-3" : "line-clamp-1"
                    )}
                  >
                    {summary}
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {activity.tags.slice(0, visibleTagCount).map((tag) => (
                    <Badge
                      key={`${activity.id}-${tag}`}
                      className="bg-white/[0.08] text-white/68"
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </>
            )}
          </div>
          {!compact && href && ctaLabel ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => navigate(href)}
              className="shrink-0"
            >
              <ArrowUpRight className="size-4" />
              {ctaLabel}
            </Button>
          ) : null}
        </div>
      </div>
    );
  };

  const resetDraft = (seedDate?: Date) => {
    setDraft({
      ...EMPTY_DRAFT,
      userId: defaultUserId,
      tags: seedObservationTags(),
      observedAtInput: seedDate
        ? formatLocalDateTimeInput(seedDate.toISOString())
        : ""
    });
  };

  const openComposerForSlot = (day: Date, hour: number) => {
    const seed = new Date(day);
    seed.setHours(hour, 0, 0, 0);
    resetDraft(seed);
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

  const handleCreatePatternFromObservation = async () => {
    const result = await saveObservationMutation.mutateAsync(draft);
    const search = new URLSearchParams();
    search.set("create", "1");
    search.set("sourceObservationNoteId", result.note.id);
    if (result.note.userId) {
      search.set("userId", result.note.userId);
    }
    navigate(`/psyche/patterns?${search.toString()}`);
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
        description="Map handwritten reflections and lower-priority Forge activity onto the real week by hour, so the calendar shows both what you noticed and what the system recorded you doing."
        badge={`${visibleEntries.length} visible this week`}
        actions={
          <Button
            onClick={() =>
              openComposerForSlot(new Date(), new Date().getHours())
            }
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
          description="True self-observation stays primary. Forge activity sits underneath it as supporting context, so you can review the week as lived evidence and export exactly the slice you want to share."
          weekStart={weekStart}
          badges={
            <>
              <Badge className="bg-white/[0.08] text-white/74">
                {scopeSummary}
              </Badge>
              <Badge className="bg-[rgba(110,231,183,0.14)] text-[var(--tertiary)]">
                {visibleObservationCount} observations
              </Badge>
              <Badge className="bg-amber-300/14 text-amber-100">
                {visibleActivityCount} activity
              </Badge>
              <Badge className="bg-white/[0.08] text-white/62">
                {onlyHumanOwned ? "Human-owned only" : "All owners"}
              </Badge>
            </>
          }
          onPrevious={() => setWeekStart(addDays(weekStart, -7))}
          onCurrent={() => setWeekStart(startOfWeek())}
          onNext={() => setWeekStart(addDays(weekStart, 7))}
        />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
          <div className="grid gap-3 rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/42">
                Filter timeline
              </div>
              <div className="mt-1 text-sm text-white/58">
                Search the week, focus a specific entity kind, switch density,
                and narrow the timeline before you review it.
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(15rem,0.8fr)_minmax(15rem,0.8fr)]">
              <Input
                value={searchFilter}
                onChange={(event) => setSearchFilter(event.target.value)}
                placeholder="Search notes, authors, activity, or entity labels"
              />
              <SelectMenu
                label="Entity kind"
                value={entityFilter}
                options={entityFilterOptions}
                onChange={setEntityFilter}
              />
              <SelectMenu
                label="Entry view"
                value={viewMode}
                options={OBSERVATION_VIEW_OPTIONS}
                onChange={setViewMode}
              />
            </div>

            <div className="grid gap-2">
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/42">
                Extra tags
              </div>
              <div className="text-xs text-white/48">
                Add narrower filters like `focus`, `Forge activity`, or `Source · UI`.
              </div>
              <NoteTagsInput
                value={selectedTags}
                onChange={setSelectedTags}
                availableTags={availableTags}
                placeholder="Filter by tag"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant={showObservations ? "primary" : "ghost"}
                onClick={() => setShowObservations((current) => !current)}
              >
                {showObservations ? "Hide observations" : "Show observations"}
              </Button>
              <Button
                variant={showActivity ? "secondary" : "ghost"}
                onClick={() => setShowActivity((current) => !current)}
              >
                {showActivity ? "Hide Forge activity" : "Show Forge activity"}
              </Button>
              <Button
                variant={onlyHumanOwned ? "secondary" : "primary"}
                onClick={() => setOnlyHumanOwned(false)}
              >
                All owners
              </Button>
              <Button
                variant={onlyHumanOwned ? "primary" : "ghost"}
                onClick={() => setOnlyHumanOwned(true)}
              >
                Human only
              </Button>
            </div>
          </div>

          <div className="grid gap-3 rounded-[24px] border border-white/8 bg-[rgba(255,255,255,0.035)] p-4">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/42">
                Export week
              </div>
              <div className="mt-1 text-sm text-white/58">
                Export respects the current search, entity, tag, owner, and
                observation/activity filters.
              </div>
            </div>
            <SelectMenu
              label="Export format"
              value={exportFormat}
              options={CALENDAR_EXPORT_OPTIONS}
              onChange={setExportFormat}
            />
            <Button
              variant="secondary"
              pending={exportCalendarMutation.isPending}
              pendingLabel="Exporting"
              onClick={() => void exportCalendarMutation.mutateAsync()}
            >
              <Download className="size-4" />
              Export week
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
                  const slotEntries = entriesBySlot.get(slotKey) ?? [];
                  return (
                    <div
                      key={slotKey}
                      data-self-observation-slot={slotKey}
                      className={cn(
                        "border-r border-white/6 px-2 py-2 last:border-r-0",
                        viewMode === "compact"
                          ? "min-h-[4.25rem]"
                          : viewMode === "extended"
                            ? "min-h-[7rem]"
                            : "min-h-[5.5rem]"
                      )}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const noteId =
                          event.dataTransfer.getData(
                            "text/forge-self-observation-id"
                          ) || draggedObservationId;
                        if (!noteId) {
                          return;
                        }
                        const observationEntry = visibleEntries.find(
                          (entry) =>
                            isObservationEntry(entry) &&
                            entry.observation.note.id === noteId
                        );
                        if (
                          !observationEntry ||
                          !isObservationEntry(observationEntry)
                        ) {
                          return;
                        }
                        void handleDrop(observationEntry.observation, day, hour);
                        setDraggedObservationId(null);
                      }}
                    >
                      <div className="grid gap-2">
                        {slotEntries.length > 0 ? (
                          <div className="flex justify-end">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-full border border-white/8 bg-white/[0.04] px-2 py-1 text-[11px] text-white/58 transition hover:bg-white/[0.08] hover:text-white"
                              onClick={() => openComposerForSlot(day, hour)}
                            >
                              <Plus className="size-3.5" />
                              Add
                            </button>
                          </div>
                        ) : null}

                        {slotEntries.map((entry) =>
                          isObservationEntry(entry)
                            ? renderObservationCard(entry.observation)
                            : renderActivityCard(entry.activity)
                        )}

                        {slotEntries.length === 0 ? (
                          <button
                            type="button"
                            className={cn(
                              "rounded-[18px] border border-dashed border-white/8 text-left text-sm text-white/34 transition hover:border-white/16 hover:text-white/56",
                              viewMode === "compact"
                                ? "px-3 py-2"
                                : "px-3 py-4"
                            )}
                            onClick={() => openComposerForSlot(day, hour)}
                          >
                            {viewMode === "compact" ? "Add" : "Add observation"}
                          </button>
                        ) : null}
                      </div>
                    </div>
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
                    onClick={() =>
                      openComposerForSlot(day, new Date().getHours())
                    }
                  >
                    <Plus className="size-4" />
                    Add
                  </Button>
                </div>
                <div className="mt-3 grid gap-2">
                  {hours.map((hour) => {
                    const slotKey = `${dayKey}:${hour}`;
                    const slotEntries = entriesBySlot.get(slotKey) ?? [];
                    return (
                      <div
                        key={slotKey}
                        data-self-observation-slot-mobile={slotKey}
                        className="rounded-[18px] border border-white/6 bg-white/[0.03] px-3 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs uppercase tracking-[0.16em] text-white/34">
                            {formatHourLabel(hour)}
                          </div>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-full border border-white/8 bg-white/[0.04] px-2 py-1 text-[11px] text-white/58 transition hover:bg-white/[0.08] hover:text-white"
                            onClick={() => openComposerForSlot(day, hour)}
                          >
                            <Plus className="size-3.5" />
                            Add
                          </button>
                        </div>
                        <div className="mt-2 grid gap-2">
                          {slotEntries.length === 0 ? (
                            <button
                              type="button"
                              className={cn(
                                "rounded-[16px] border border-dashed border-white/8 text-left text-sm text-white/38 transition hover:border-white/16 hover:text-white/56",
                                viewMode === "compact"
                                  ? "px-3 py-2"
                                  : "px-3 py-3"
                              )}
                              onClick={() => openComposerForSlot(day, hour)}
                            >
                              {viewMode === "compact" ? "Add" : "Add observation"}
                            </button>
                          ) : (
                            slotEntries.map((entry) =>
                              isObservationEntry(entry)
                                ? renderObservationCard(entry.observation)
                                : renderActivityCard(entry.activity)
                            )
                          )}
                        </div>
                      </div>
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
        description="Capture the note, set the exact observation time, then attach the pattern, trigger report, and any other Forge records that belong to that moment."
      >
        <div className="grid gap-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <UserSelectField
              value={draft.userId}
              users={shell.snapshot.users}
              onChange={(userId) =>
                setDraft((current) => ({ ...current, userId }))
              }
              defaultLabel={formatOwnerSelectDefaultLabel(
                shell.snapshot.users.find(
                  (user) => user.id === defaultUserId
                ) ?? null,
                "Choose observation owner"
              )}
              help="Observation notes stay multi-user aware just like the rest of Forge."
            />
            <label className="grid gap-2">
              <span className="text-sm font-medium text-white">Author</span>
              <Input
                value={draft.author}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    author: event.target.value
                  }))
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
            <span className="text-sm font-medium text-white">
              Observation note
            </span>
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
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-white">
                  Linked patterns
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1.5 text-xs text-white/72 transition hover:bg-white/[0.1] hover:text-white"
                  onClick={() => void handleCreatePatternFromObservation()}
                  disabled={
                    saveObservationMutation.isPending ||
                    draft.contentMarkdown.trim().length === 0
                  }
                >
                  <Sparkles className="size-3.5" />
                  Create pattern from observation
                </button>
              </div>
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
                selectedValues={
                  draft.linkedTriggerReportId
                    ? [draft.linkedTriggerReportId]
                    : []
                }
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

          <div className="grid gap-2">
            <div className="text-sm font-medium text-white">Linked records</div>
            <EntityLinkMultiSelect
              options={genericLinkOptions}
              selectedValues={draft.linkedEntityValues}
              onChange={(linkedEntityValues) =>
                setDraft((current) => ({ ...current, linkedEntityValues }))
              }
              placeholder="Link goals, projects, tasks, values, beliefs, modes, or other Forge records"
              emptyMessage="No linked records in scope yet."
            />
          </div>

          <div className="rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-white/70">
              <StickyNote className="size-4 text-[var(--tertiary)]" />
              Cards appear in the hourly week grid at the exact observation
              time, whether they came from deliberate reflection or rolling
              movement sync.
            </div>
            <div className="mt-2 text-sm leading-6 text-white/52">
              Move them later by drag-and-drop, edit the timestamp directly
              here, or delete them from the card itself when the observation
              should not stay on the calendar.
            </div>
          </div>

          <div className="flex flex-wrap justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {draft.noteId ? (
                <Button
                  variant="secondary"
                  pending={deleteObservationMutation.isPending}
                  pendingLabel="Deleting"
                  onClick={() =>
                    draft.noteId
                      ? void deleteObservationMutation.mutateAsync(draft.noteId)
                      : undefined
                  }
                >
                  <Trash2 className="size-4" />
                  Delete observation
                </Button>
              ) : null}
              {draft.linkedTriggerReportId ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-2 text-sm text-white/72 transition hover:bg-white/[0.1] hover:text-white"
                  onClick={() =>
                    navigate(`/psyche/reports/${draft.linkedTriggerReportId}`)
                  }
                >
                  <ArrowUpRight className="size-4" />
                  Open linked report
                </button>
              ) : null}
            </div>
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
