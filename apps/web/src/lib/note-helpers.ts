import type { CrudEntityType, Note, NotesSummaryByEntity } from "./types";
import { formatLocalDateKey } from "./date-keys";

const ANCHOR_KEY_LABELS: Partial<Record<string, string>> = {
  spark: "Spark stage",
  story: "Story stage",
  state: "State stage",
  lens: "Lens stage",
  pivot: "Pivot stage"
};

export function getNotesSummaryKey(
  entityType: CrudEntityType,
  entityId: string
) {
  return `${entityType}:${entityId}`;
}

export function getEntityNotesSummary(
  summaryByEntity: NotesSummaryByEntity | undefined,
  entityType: CrudEntityType,
  entityId: string
) {
  return (
    summaryByEntity?.[getNotesSummaryKey(entityType, entityId)] ?? {
      count: 0,
      latestNoteId: null,
      latestCreatedAt: null
    }
  );
}

export function formatNotesCountLabel(count: number) {
  return `${count} Note${count === 1 ? "" : "s"}`;
}

export function formatEntityTypeLabel(entityType: CrudEntityType) {
  return entityType.replaceAll("_", " ");
}

export function formatAnchorKeyLabel(anchorKey: string | null | undefined) {
  if (!anchorKey) {
    return null;
  }
  const normalized = anchorKey.trim().toLowerCase();
  const mapped = ANCHOR_KEY_LABELS[normalized];
  if (mapped) {
    return mapped;
  }
  return normalized
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getAnchorKeyHelpText(
  entityType: CrudEntityType,
  anchorKey: string | null | undefined
) {
  const label = formatAnchorKeyLabel(anchorKey);
  if (!label) {
    return null;
  }
  if (entityType === "trigger_report") {
    return `This note is pinned to the ${label.toLowerCase()} of the report, so it stays attached to that part of the reflective chain.`;
  }
  return `This note is pinned to the "${label}" section of the ${formatEntityTypeLabel(entityType)} instead of only the whole entity.`;
}

export function getEntityRoute(entityType: CrudEntityType, entityId: string) {
  const encodedId = encodeURIComponent(entityId);
  switch (entityType) {
    case "goal":
      return `/goals/${encodedId}`;
    case "project":
      return `/projects/${encodedId}`;
    case "task":
      return `/tasks/${encodedId}`;
    case "strategy":
      return `/strategies/${encodedId}`;
    case "artifact":
      return `/artifacts/${encodedId}`;
    case "person":
      return `/people/${encodedId}`;
    case "life_event":
      return `/life-events?focus=${encodedId}`;
    case "task_timebox":
      return `/calendar?timeboxId=${encodedId}`;
    case "note":
      return `/notes?focus=${encodedId}`;
    case "psyche_value":
      return `/psyche/values?focus=${encodedId}#values-atlas`;
    case "behavior_pattern":
      return `/psyche/patterns?focus=${encodedId}#pattern-lanes`;
    case "behavior":
      return `/psyche/behaviors?focus=${encodedId}#behavior-columns`;
    case "belief_entry":
      return `/psyche/schemas-beliefs?focus=${encodedId}`;
    case "mode_profile":
      return `/psyche/modes?focus=${encodedId}`;
    case "flashcard":
      return `/psyche/flashcards?focus=${encodedId}`;
    case "trigger_report":
      return `/psyche/reports/${encodedId}`;
    case "event_type":
      return `/psyche/reports?vocabulary=event_type&focusVocabulary=${encodedId}`;
    case "emotion_definition":
      return `/psyche/reports?vocabulary=emotion_definition&focusVocabulary=${encodedId}`;
    case "preference_catalog":
      return `/preferences?focusCatalog=${encodedId}`;
    case "preference_catalog_item":
      return `/preferences?focusCatalogItem=${encodedId}`;
    case "preference_context":
      return `/preferences?focusContext=${encodedId}`;
    case "preference_item":
      return `/preferences?focusItem=${encodedId}`;
    case "questionnaire_instrument":
      return `/psyche/questionnaires/${encodedId}`;
    case "sleep_session":
      return `/sleep?focus=${encodedId}`;
    case "workout_session":
      return `/sports/workouts/${encodedId}`;
    default:
      return null;
  }
}

export function countNotesCreatedOnLocalDate(
  notes: Array<Pick<Note, "createdAt">>,
  now = new Date()
) {
  const todayKey = formatLocalDateKey(now);
  return notes.filter(
    (note) => formatLocalDateKey(new Date(note.createdAt)) === todayKey
  ).length;
}

export function getEntityNotesHref(
  entityType: CrudEntityType,
  entityId: string
) {
  switch (entityType) {
    case "goal":
    case "project":
    case "task":
    case "strategy":
    case "trigger_report": {
      const route = getEntityRoute(entityType, entityId);
      return route ? `${route}#notes` : null;
    }
    default:
      return `/notes?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`;
  }
}

export function getPrimaryNavigableLink(note: Note) {
  return (
    note.links.find(
      (link) => getEntityRoute(link.entityType, link.entityId) !== null
    ) ??
    note.links[0] ??
    null
  );
}
