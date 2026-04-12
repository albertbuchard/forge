import {
  psycheObservationCalendarPayloadSchema,
  type PsycheObservationActivityEntry,
  type PsycheObservationCalendarPayload,
  type PsycheObservationEntry
} from "../psyche-types.js";
import { listActivityEvents } from "../repositories/activity-events.js";
import { filterOwnedEntities } from "../repositories/entity-ownership.js";
import {
  listNotesByObservedAtRange,
  resolveNoteObservedAt
} from "../repositories/notes.js";
import {
  listBehaviorPatterns,
  listTriggerReports
} from "../repositories/psyche.js";
import type {
  ActivityEntityType,
  ActivityEvent,
  ActivitySource,
  PsycheObservationCalendarExportFormat,
  PsycheObservationCalendarExportQuery
} from "../types.js";

const SELF_OBSERVATION_TAG = "Self-observation";
const FORGE_ACTIVITY_TAG = "Forge activity";
const ENTITY_TAG_PREFIX = "Entity · ";
const SOURCE_TAG_PREFIX = "Source · ";

const ACTIVITY_ENTITY_LABELS: Record<ActivityEntityType, string> = {
  system: "System",
  goal: "Goal",
  project: "Project",
  task: "Task",
  strategy: "Strategy",
  task_run: "Task run",
  habit: "Habit",
  tag: "Tag",
  note: "Note",
  insight: "Insight",
  psyche_value: "Psyche value",
  behavior_pattern: "Pattern",
  behavior: "Behavior",
  belief_entry: "Belief",
  mode_profile: "Mode",
  trigger_report: "Trigger report",
  calendar_event: "Calendar event",
  work_block: "Work block",
  task_timebox: "Task timebox",
  preference_catalog: "Preference catalog",
  preference_catalog_item: "Preference concept",
  preference_context: "Preference context",
  preference_item: "Preference item",
  questionnaire_instrument: "Questionnaire",
  sleep_session: "Sleep",
  workout_session: "Workout"
};

const ACTIVITY_SOURCE_LABELS: Record<ActivitySource, string> = {
  ui: "UI",
  openclaw: "OpenClaw",
  agent: "Agent",
  system: "System"
};

type CalendarFilterOptions = {
  tags?: string[];
  includeObservations?: boolean;
  includeActivity?: boolean;
  onlyHumanOwned?: boolean;
  search?: string;
};

type CalendarExportResult = {
  body: Buffer;
  fileName: string;
  mimeType: string;
};

type TimelineExportEntry =
  | {
      kind: "observation";
      observedAt: string;
      tags: string[];
      ownerLabel: string;
      title: string;
      description: string;
      observation: PsycheObservationEntry;
    }
  | {
      kind: "activity";
      observedAt: string;
      tags: string[];
      ownerLabel: string;
      title: string;
      description: string;
      activity: PsycheObservationActivityEntry;
    };

function normalizeTags(tags: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const rawTag of tags) {
    const tag = rawTag.trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(tag);
  }
  return normalized;
}

function compareIso(left: { observedAt: string }, right: { observedAt: string }) {
  return left.observedAt.localeCompare(right.observedAt);
}

function buildObservationTags(noteTags: string[] = []) {
  return normalizeTags([SELF_OBSERVATION_TAG, ...noteTags]);
}

function buildActivityTags(event: ActivityEvent) {
  return normalizeTags([
    FORGE_ACTIVITY_TAG,
    `${ENTITY_TAG_PREFIX}${ACTIVITY_ENTITY_LABELS[event.entityType] ?? event.entityType}`,
    `${SOURCE_TAG_PREFIX}${ACTIVITY_SOURCE_LABELS[event.source] ?? event.source}`
  ]);
}

function collectAvailableTags(
  observations: PsycheObservationCalendarPayload["observations"],
  activity: PsycheObservationCalendarPayload["activity"]
) {
  const tags = normalizeTags([
    ...observations.flatMap((observation) => observation.tags),
    ...activity.flatMap((entry) => entry.tags)
  ]);
  return tags.sort((left, right) => left.localeCompare(right));
}

function buildObservationSearchText(observation: PsycheObservationEntry) {
  return [
    observation.note.contentPlain,
    observation.note.contentMarkdown,
    observation.note.author ?? "",
    observation.tags.join(" "),
    observation.linkedPatterns.map((pattern) => pattern.title).join(" "),
    observation.linkedReports.map((report) => report.title).join(" "),
    observation.note.links
      .map((link) => `${link.entityType} ${link.entityId}`)
      .join(" ")
  ]
    .join(" ")
    .toLowerCase();
}

function buildActivitySearchText(entry: PsycheObservationActivityEntry) {
  return [
    entry.event.title,
    entry.event.description,
    entry.event.actor ?? "",
    entry.event.eventType,
    entry.event.entityType,
    ACTIVITY_ENTITY_LABELS[entry.event.entityType] ?? entry.event.entityType,
    ACTIVITY_SOURCE_LABELS[entry.event.source] ?? entry.event.source,
    entry.tags.join(" ")
  ]
    .join(" ")
    .toLowerCase();
}

function matchesSelectedTags(tags: string[], selectedTags: string[]) {
  if (selectedTags.length === 0) {
    return true;
  }
  const normalizedEntryTags = new Set(tags.map((tag) => tag.toLowerCase()));
  return selectedTags.some((tag) => normalizedEntryTags.has(tag.toLowerCase()));
}

function summarizeText(value: string, limit = 96) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function buildCalendarPayload({
  from,
  to,
  userIds
}: {
  from: string;
  to: string;
  userIds?: string[];
}) {
  const patterns = filterOwnedEntities(
    "behavior_pattern",
    listBehaviorPatterns(),
    userIds
  );
  const reports = filterOwnedEntities(
    "trigger_report",
    listTriggerReports(200),
    userIds
  );
  const notes = listNotesByObservedAtRange({ from, to, userIds, limit: 600 });
  const activityEvents = listActivityEvents({ from, to, userIds, limit: 1200 });

  const patternsById = new Map(patterns.map((pattern) => [pattern.id, pattern]));
  const reportsById = new Map(reports.map((report) => [report.id, report]));

  const observations = notes
    .map((note) => ({
      id: note.id,
      observedAt: resolveNoteObservedAt(note),
      tags: buildObservationTags(note.tags ?? []),
      note,
      linkedPatterns: note.links
        .filter((link) => link.entityType === "behavior_pattern")
        .map((link) => patternsById.get(link.entityId) ?? null)
        .filter((pattern): pattern is NonNullable<typeof pattern> => pattern !== null),
      linkedReports: note.links
        .filter((link) => link.entityType === "trigger_report")
        .map((link) => reportsById.get(link.entityId) ?? null)
        .filter((report): report is NonNullable<typeof report> => report !== null)
    }))
    .sort(compareIso);

  const activity = activityEvents
    .map((event) => ({
      id: event.id,
      observedAt: event.createdAt,
      tags: buildActivityTags(event),
      event
    }))
    .sort(compareIso);

  return {
    generatedAt: new Date().toISOString(),
    from,
    to,
    observations,
    activity,
    availableTags: collectAvailableTags(observations, activity)
  };
}

export function getPsycheObservationCalendar({
  from,
  to,
  userIds
}: {
  from: string;
  to: string;
  userIds?: string[];
}): PsycheObservationCalendarPayload {
  return psycheObservationCalendarPayloadSchema.parse(
    buildCalendarPayload({ from, to, userIds })
  );
}

export function filterPsycheObservationCalendar(
  payload: PsycheObservationCalendarPayload,
  filters: CalendarFilterOptions
): PsycheObservationCalendarPayload {
  const selectedTags = normalizeTags(filters.tags ?? []);
  const includeObservations = filters.includeObservations ?? true;
  const includeActivity = filters.includeActivity ?? true;
  const search = filters.search?.trim().toLowerCase() ?? "";

  const observations = (includeObservations ? payload.observations : []).filter(
    (observation) => {
      if (filters.onlyHumanOwned && observation.note.user?.kind !== "human") {
        return false;
      }
      if (!matchesSelectedTags(observation.tags, selectedTags)) {
        return false;
      }
      if (search && !buildObservationSearchText(observation).includes(search)) {
        return false;
      }
      return true;
    }
  );

  const activity = (includeActivity ? payload.activity : []).filter((entry) => {
    if (filters.onlyHumanOwned && entry.event.user?.kind !== "human") {
      return false;
    }
    if (!matchesSelectedTags(entry.tags, selectedTags)) {
      return false;
    }
    if (search && !buildActivitySearchText(entry).includes(search)) {
      return false;
    }
    return true;
  });

  return psycheObservationCalendarPayloadSchema.parse({
    ...payload,
    observations,
    activity,
    availableTags: collectAvailableTags(observations, activity)
  });
}

function buildTimelineEntries(
  payload: PsycheObservationCalendarPayload
): TimelineExportEntry[] {
  return [
    ...payload.observations.map((observation) => ({
      kind: "observation" as const,
      observedAt: observation.observedAt,
      tags: observation.tags,
      ownerLabel: observation.note.user?.displayName ?? observation.note.author ?? "",
      title: summarizeText(
        observation.note.contentPlain || observation.note.contentMarkdown || "Observation"
      ),
      description: [
        observation.note.author ? `Author: ${observation.note.author}` : "",
        observation.linkedPatterns.length > 0
          ? `Patterns: ${observation.linkedPatterns.map((pattern) => pattern.title).join(", ")}`
          : "",
        observation.linkedReports.length > 0
          ? `Trigger reports: ${observation.linkedReports.map((report) => report.title).join(", ")}`
          : "",
        summarizeText(observation.note.contentPlain || observation.note.contentMarkdown, 240)
      ]
        .filter(Boolean)
        .join("\n"),
      observation
    })),
    ...payload.activity.map((activity) => ({
      kind: "activity" as const,
      observedAt: activity.observedAt,
      tags: activity.tags,
      ownerLabel: activity.event.user?.displayName ?? activity.event.actor ?? "",
      title: activity.event.title,
      description: [
        activity.event.description,
        `Entity: ${ACTIVITY_ENTITY_LABELS[activity.event.entityType] ?? activity.event.entityType}`,
        `Source: ${ACTIVITY_SOURCE_LABELS[activity.event.source] ?? activity.event.source}`,
        activity.event.actor ? `Actor: ${activity.event.actor}` : ""
      ]
        .filter(Boolean)
        .join("\n"),
      activity
    }))
  ].sort(compareIso);
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function toIcsDate(value: string) {
  return value.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function addMinutes(value: string, minutes: number) {
  return new Date(new Date(value).getTime() + minutes * 60 * 1000).toISOString();
}

function buildMarkdownExport(
  payload: PsycheObservationCalendarPayload,
  entries: TimelineExportEntry[],
  filters: CalendarFilterOptions
) {
  const sections: string[] = [
    "# Forge self observation calendar",
    "",
    `Range: ${payload.from} to ${payload.to}`,
    `Included observations: ${filters.includeObservations ?? true ? "yes" : "no"}`,
    `Included Forge activity: ${filters.includeActivity ?? true ? "yes" : "no"}`,
    filters.onlyHumanOwned ? "Ownership filter: human-only" : "Ownership filter: all owners",
    filters.tags && filters.tags.length > 0
      ? `Tag filter: ${normalizeTags(filters.tags).join(", ")}`
      : "Tag filter: none",
    filters.search?.trim() ? `Search filter: ${filters.search.trim()}` : "Search filter: none",
    ""
  ];

  let currentDay = "";
  for (const entry of entries) {
    const dayKey = entry.observedAt.slice(0, 10);
    if (dayKey !== currentDay) {
      currentDay = dayKey;
      sections.push(`## ${dayKey}`, "");
    }
    sections.push(
      `### ${entry.observedAt.slice(11, 16)} · ${entry.kind === "observation" ? "Observation" : "Forge activity"}`,
      `- Title: ${entry.title}`,
      entry.ownerLabel ? `- Owner: ${entry.ownerLabel}` : "- Owner: ",
      `- Tags: ${entry.tags.join(", ") || "None"}`,
      `- Details: ${entry.description.replace(/\n+/g, " | ")}`,
      ""
    );
  }

  if (entries.length === 0) {
    sections.push("No entries matched the selected filters.", "");
  }

  return sections.join("\n");
}

function buildCsvExport(entries: TimelineExportEntry[]) {
  const rows = [
    [
      "observedAt",
      "kind",
      "title",
      "description",
      "owner",
      "tags",
      "entityType",
      "eventType",
      "source"
    ].join(","),
    ...entries.map((entry) => {
      const activity =
        entry.kind === "activity" ? entry.activity.event : null;
      return [
        csvEscape(entry.observedAt),
        csvEscape(entry.kind),
        csvEscape(entry.title),
        csvEscape(entry.description),
        csvEscape(entry.ownerLabel),
        csvEscape(entry.tags.join(" | ")),
        csvEscape(activity?.entityType ?? ""),
        csvEscape(activity?.eventType ?? ""),
        csvEscape(activity?.source ?? "")
      ].join(",");
    })
  ];
  return rows.join("\n");
}

function buildIcsExport(entries: TimelineExportEntry[]) {
  const now = toIcsDate(new Date().toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Forge//Self Observation Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH"
  ];

  for (const entry of entries) {
    const summaryPrefix =
      entry.kind === "observation" ? "Observation" : "Forge activity";
    lines.push(
      "BEGIN:VEVENT",
      `UID:${entry.kind}-${entry.kind === "observation" ? entry.observation.id : entry.activity.id}@forge`,
      `DTSTAMP:${now}`,
      `DTSTART:${toIcsDate(entry.observedAt)}`,
      `DTEND:${toIcsDate(addMinutes(entry.observedAt, 15))}`,
      `SUMMARY:${escapeIcsText(`${summaryPrefix}: ${entry.title}`)}`,
      `DESCRIPTION:${escapeIcsText(entry.description)}`,
      `CATEGORIES:${escapeIcsText(entry.tags.join(","))}`,
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function buildExportFileName(
  format: PsycheObservationCalendarExportFormat,
  from: string
) {
  const datePrefix = from.slice(0, 10);
  const extension =
    format === "markdown"
      ? "md"
      : format === "json"
        ? "json"
        : format === "csv"
          ? "csv"
          : "ics";
  return `forge-self-observation-${datePrefix}.${extension}`;
}

export function exportPsycheObservationCalendar(
  input: {
    from: string;
    to: string;
    userIds?: string[];
  } & Pick<
    PsycheObservationCalendarExportQuery,
    | "format"
    | "tags"
    | "includeObservations"
    | "includeActivity"
    | "onlyHumanOwned"
    | "search"
  >
): CalendarExportResult {
  const payload = filterPsycheObservationCalendar(
    getPsycheObservationCalendar({
      from: input.from,
      to: input.to,
      userIds: input.userIds
    }),
    {
      tags: input.tags,
      includeObservations: input.includeObservations,
      includeActivity: input.includeActivity,
      onlyHumanOwned: input.onlyHumanOwned,
      search: input.search
    }
  );
  const entries = buildTimelineEntries(payload);
  const format = input.format ?? "markdown";
  const fileName = buildExportFileName(format, input.from);

  if (format === "json") {
    return {
      body: Buffer.from(
        JSON.stringify(
          {
            filters: {
              tags: normalizeTags(input.tags ?? []),
              includeObservations: input.includeObservations ?? true,
              includeActivity: input.includeActivity ?? true,
              onlyHumanOwned: input.onlyHumanOwned ?? false,
              search: input.search?.trim() || ""
            },
            calendar: payload
          },
          null,
          2
        ),
        "utf8"
      ),
      fileName,
      mimeType: "application/json; charset=utf-8"
    };
  }

  if (format === "csv") {
    return {
      body: Buffer.from(buildCsvExport(entries), "utf8"),
      fileName,
      mimeType: "text/csv; charset=utf-8"
    };
  }

  if (format === "ics") {
    return {
      body: Buffer.from(buildIcsExport(entries), "utf8"),
      fileName,
      mimeType: "text/calendar; charset=utf-8"
    };
  }

  return {
    body: Buffer.from(
      buildMarkdownExport(payload, entries, {
        tags: input.tags,
        includeObservations: input.includeObservations,
        includeActivity: input.includeActivity,
        onlyHumanOwned: input.onlyHumanOwned,
        search: input.search
      }),
      "utf8"
    ),
    fileName,
    mimeType: "text/markdown; charset=utf-8"
  };
}
