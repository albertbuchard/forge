import { PSYCHE_ENTITY_TYPES } from "../psyche-types.js";

const PSYCHE_ENTITY_TYPE_SET = new Set<string>(PSYCHE_ENTITY_TYPES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectPsycheLinkTypes(note: unknown, entityTypes: Set<string>) {
  if (!isRecord(note) || !Array.isArray(note.links)) {
    return;
  }

  for (const link of note.links) {
    if (!isRecord(link)) {
      continue;
    }
    const entityType = link.entityType;
    if (
      typeof entityType === "string" &&
      PSYCHE_ENTITY_TYPE_SET.has(entityType)
    ) {
      entityTypes.add(entityType);
    }
  }
}

export function findPsycheNoteLinkEntityTypes(note: unknown): string[] {
  const entityTypes = new Set<string>();
  collectPsycheLinkTypes(note, entityTypes);
  return [...entityTypes];
}

export function findNestedPsycheNoteLinkEntityTypes(
  payload: unknown
): string[] {
  if (!isRecord(payload)) {
    return [];
  }

  const entityTypes = new Set<string>();
  if (Array.isArray(payload.notes)) {
    for (const note of payload.notes) {
      collectPsycheLinkTypes(note, entityTypes);
    }
  }
  collectPsycheLinkTypes(payload.closeoutNote, entityTypes);
  return [...entityTypes];
}
