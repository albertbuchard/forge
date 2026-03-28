import type { CrudEntityType, Note, NotesSummaryByEntity } from "./types";

const ANCHOR_KEY_LABELS: Partial<Record<string, string>> = {
  spark: "Spark stage",
  story: "Story stage",
  state: "State stage",
  lens: "Lens stage",
  pivot: "Pivot stage"
};

export function getNotesSummaryKey(entityType: CrudEntityType, entityId: string) {
  return `${entityType}:${entityId}`;
}

export function getEntityNotesSummary(summaryByEntity: NotesSummaryByEntity | undefined, entityType: CrudEntityType, entityId: string) {
  return summaryByEntity?.[getNotesSummaryKey(entityType, entityId)] ?? { count: 0, latestNoteId: null, latestCreatedAt: null };
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

export function getAnchorKeyHelpText(entityType: CrudEntityType, anchorKey: string | null | undefined) {
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
  switch (entityType) {
    case "goal":
      return `/goals/${entityId}`;
    case "project":
      return `/projects/${entityId}`;
    case "task":
      return `/tasks/${entityId}`;
    case "psyche_value":
      return `/psyche/values?focus=${entityId}#values-atlas`;
    case "behavior_pattern":
      return `/psyche/patterns?focus=${entityId}#pattern-lanes`;
    case "behavior":
      return `/psyche/behaviors?focus=${entityId}#behavior-columns`;
    case "belief_entry":
      return `/psyche/schemas-beliefs?focus=${entityId}`;
    case "mode_profile":
      return `/psyche/modes?focus=${entityId}`;
    case "trigger_report":
      return `/psyche/reports/${entityId}`;
    default:
      return null;
  }
}

export function getEntityNotesHref(entityType: CrudEntityType, entityId: string) {
  switch (entityType) {
    case "goal":
    case "project":
    case "task":
    case "trigger_report": {
      const route = getEntityRoute(entityType, entityId);
      return route ? `${route}#notes` : null;
    }
    default:
      return `/notes?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`;
  }
}

export function getPrimaryNavigableLink(note: Note) {
  return note.links.find((link) => getEntityRoute(link.entityType, link.entityId) !== null) ?? note.links[0] ?? null;
}
