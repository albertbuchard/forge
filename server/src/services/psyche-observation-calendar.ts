import {
  psycheObservationCalendarPayloadSchema,
  type PsycheObservationCalendarPayload
} from "../psyche-types.js";
import {
  listNotesByObservedAtRange,
  resolveNoteObservedAt
} from "../repositories/notes.js";
import { filterOwnedEntities } from "../repositories/entity-ownership.js";
import {
  listBehaviorPatterns,
  listTriggerReports
} from "../repositories/psyche.js";

function collectAvailableTags(
  observations: PsycheObservationCalendarPayload["observations"]
) {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const observation of observations) {
    for (const tag of observation.note.tags ?? []) {
      const normalized = tag.trim().toLowerCase();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      tags.push(tag);
    }
  }
  return tags.sort((left, right) => left.localeCompare(right));
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

  const patternsById = new Map(patterns.map((pattern) => [pattern.id, pattern]));
  const reportsById = new Map(reports.map((report) => [report.id, report]));

  const observations = notes.map((note) => ({
    id: note.id,
    observedAt: resolveNoteObservedAt(note),
    note,
    linkedPatterns: note.links
      .filter((link) => link.entityType === "behavior_pattern")
      .map((link) => patternsById.get(link.entityId) ?? null)
      .filter((pattern): pattern is NonNullable<typeof pattern> => pattern !== null),
    linkedReports: note.links
      .filter((link) => link.entityType === "trigger_report")
      .map((link) => reportsById.get(link.entityId) ?? null)
      .filter((report): report is NonNullable<typeof report> => report !== null)
  }));

  return psycheObservationCalendarPayloadSchema.parse({
    generatedAt: new Date().toISOString(),
    from,
    to,
    observations,
    availableTags: collectAvailableTags(observations)
  });
}
