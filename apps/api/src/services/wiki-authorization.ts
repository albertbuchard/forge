import { HttpError } from "../errors.js";
import {
  getWikiPageAccessRecord,
  getWikiSpaceById,
  listWikiSpaces,
  resolveWikiSpaceIdForInput,
  type WikiSpace
} from "../repositories/wiki-memory.js";
import type { Note } from "../types.js";

export type WikiAccessMode = "read" | "write";

export type WikiUserScope = {
  userIds?: readonly string[];
};

function scopedUserIds(scope: WikiUserScope) {
  return scope.userIds ?? [];
}

export function canAccessWikiSpace(
  scope: WikiUserScope,
  space: WikiSpace | null | undefined,
  _mode: WikiAccessMode
) {
  if (!space) {
    return false;
  }
  const userIds = scopedUserIds(scope);
  return (
    space.visibility === "shared" ||
    userIds.length === 0 ||
    (Boolean(space.ownerUserId) &&
      userIds.includes(space.ownerUserId as string))
  );
}

export function listAccessibleWikiSpaces(
  scope: WikiUserScope,
  mode: WikiAccessMode
) {
  return listWikiSpaces().filter((space) =>
    canAccessWikiSpace(scope, space, mode)
  );
}

export function requireWikiSpaceAccess(
  scope: WikiUserScope,
  spaceId: string,
  mode: WikiAccessMode
) {
  const space = getWikiSpaceById(spaceId);
  if (!canAccessWikiSpace(scope, space, mode)) {
    throw new HttpError(404, "wiki_space_not_found", "Wiki space not found.");
  }
  return space!;
}

export function requireWikiPageAccess(
  scope: WikiUserScope,
  pageId: string,
  mode: WikiAccessMode
) {
  const access = getWikiPageAccessRecord(pageId);
  if (
    !access ||
    !canAccessWikiSpace(scope, getWikiSpaceById(access.spaceId), mode)
  ) {
    throw new HttpError(404, "wiki_page_not_found", "Wiki page not found.");
  }
  return access;
}

export function requireWikiNoteAccess(
  scope: WikiUserScope,
  note: Pick<Note, "id" | "spaceId"> | null | undefined,
  mode: WikiAccessMode
) {
  if (
    !note ||
    !canAccessWikiSpace(scope, getWikiSpaceById(note.spaceId), mode)
  ) {
    throw new HttpError(404, "note_not_found", "Note not found.");
  }
  return note;
}

export function canAccessWikiNote(
  scope: WikiUserScope,
  note: Pick<Note, "spaceId"> | null | undefined,
  mode: WikiAccessMode
) {
  return Boolean(
    note && canAccessWikiSpace(scope, getWikiSpaceById(note.spaceId), mode)
  );
}

export function filterAccessibleWikiNotes<T extends Pick<Note, "spaceId">>(
  scope: WikiUserScope,
  notes: T[],
  mode: WikiAccessMode = "read"
) {
  const spacesById = new Map(
    listAccessibleWikiSpaces(scope, mode).map((space) => [space.id, space])
  );
  return notes.filter((note) => spacesById.has(note.spaceId));
}

export function requireWikiUserScope(
  scope: WikiUserScope,
  userId: string | null | undefined
) {
  const requestedUserId = userId?.trim();
  const userIds = scopedUserIds(scope);
  if (
    requestedUserId &&
    userIds.length > 0 &&
    !userIds.includes(requestedUserId)
  ) {
    throw new HttpError(
      403,
      "wiki_user_scope_forbidden",
      "The requested wiki user scope is outside this token's allowed users."
    );
  }
}

export function resolveWikiSpaceIdForAccess(
  scope: WikiUserScope,
  requestedSpaceId: string | undefined,
  mode: WikiAccessMode
) {
  const requested = requestedSpaceId?.trim();
  if (requested) {
    return requireWikiSpaceAccess(scope, requested, mode).id;
  }
  const spaces = listAccessibleWikiSpaces(scope, mode);
  const defaultSpace =
    spaces.find((space) => space.visibility === "shared") ?? spaces[0];
  if (!defaultSpace) {
    throw new HttpError(404, "wiki_space_not_found", "Wiki space not found.");
  }
  return defaultSpace.id;
}

export function resolveWikiMutationSpaceId(
  scope: WikiUserScope,
  input: { spaceId?: string; userId?: string | null }
) {
  requireWikiUserScope(scope, input.userId);
  if (input.spaceId?.trim()) {
    return requireWikiSpaceAccess(scope, input.spaceId.trim(), "write").id;
  }
  const resolvedSpaceId = resolveWikiSpaceIdForInput(input);
  return requireWikiSpaceAccess(scope, resolvedSpaceId, "write").id;
}
