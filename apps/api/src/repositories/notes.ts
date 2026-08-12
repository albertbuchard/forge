import { randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import { recordActivityEvent } from "./activity-events.js";
import {
  clearEntityOwner,
  decorateOwnedEntities,
  decorateOwnedEntity,
  getEntityOwnerId,
  setEntityOwner
} from "./entity-ownership.js";
import {
  getDeletedEntityRecord,
  clearDeletedEntityRecord,
  isEntityDeleted
} from "./deleted-entities.js";
import { recordEventLog } from "./event-log.js";
import {
  noteSchema,
  notesListQuerySchema,
  createNoteSchema,
  updateNoteSchema,
  type ActivityEvent,
  type ActivitySource,
  type CrudEntityType,
  type CreateNoteInput,
  type NestedCreateNoteInput,
  type Note,
  type NoteLink,
  type NotesListQuery,
  type NotesSummaryByEntity,
  type UpdateNoteInput
} from "../types.js";
import {
  deleteNoteWikiArtifacts,
  prepareNoteWikiFields,
  syncNoteWikiArtifacts
} from "./wiki-memory.js";
import { PSYCHE_ENTITY_TYPES } from "../psyche-types.js";

type NoteRow = {
  id: string;
  kind: Note["kind"];
  title: string;
  slug: string;
  space_id: string;
  parent_slug: string | null;
  index_order: number;
  show_in_index: number;
  aliases_json: string;
  summary: string;
  content_markdown: string;
  content_plain: string;
  author: string | null;
  source: ActivitySource;
  tags_json: string;
  destroy_at: string | null;
  source_path: string;
  frontmatter_json: string;
  revision_hash: string;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

type NoteLinkRow = {
  note_id: string;
  entity_type: CrudEntityType;
  entity_id: string;
  anchor_key: string;
  created_at: string;
};

type NoteContext = {
  source: ActivitySource;
  actor?: string | null;
};

export type CreateNoteOptions = {
  id?: string;
};

type NotesPageQuery = NotesListQuery & {
  cursor?: string;
  observedFrom?: string;
  observedTo?: string;
  ids?: readonly string[];
};

export type NotesPageScope = {
  accessibleSpaceIds?: readonly string[];
  includePsyche?: boolean;
};

export type NoteReadScope = NotesPageScope & {
  userIds?: readonly string[];
};

export type NotesPage = {
  notes: Note[];
  total: number;
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
};

type NotesCursor = {
  version: 1;
  createdAt: string;
  id: string;
};

const DEFAULT_NOTES_PAGE_LIMIT = 40;
const MAX_NOTES_PAGE_LIMIT = 100;
export const EXPIRED_NOTE_CLEANUP_BATCH_SIZE = 100;
const PSYCHE_NOTE_LINK_TYPES = PSYCHE_ENTITY_TYPES;
const NOTE_ACTIVITY_VISIBILITY_METADATA_KEY = "noteVisibility";

type NoteActivityVisibilityMetadata = {
  ownerUserId: string | null;
  assigneeUserIds: string[];
  spaceId: string;
  kind: Note["kind"];
  includesPsyche: boolean;
};

export function noteHasPsycheLink(note: Pick<Note, "links">) {
  return (
    Array.isArray(note.links) &&
    note.links.some((link) =>
      PSYCHE_NOTE_LINK_TYPES.includes(
        link.entityType as (typeof PSYCHE_NOTE_LINK_TYPES)[number]
      )
    )
  );
}

function normalizeAnchorKey(anchorKey: string): string | null {
  const normalized = anchorKey.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeLinks(
  links: CreateNoteInput["links"]
): CreateNoteInput["links"] {
  if (!links) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: CreateNoteInput["links"] = [];
  for (const link of links) {
    const next = {
      ...link,
      anchorKey: normalizeAnchorKey(link.anchorKey ?? "")
    };
    const key = JSON.stringify([
      next.entityType,
      next.entityId,
      next.anchorKey
    ]);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(next);
  }
  return normalized;
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) {
    return [];
  }
  const seen = new Set<string>();
  return tags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag) => {
      const normalized = tag.toLowerCase();
      if (seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    });
}

function canonicalNoteSourcePath() {
  return "";
}

function parseTagsJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? normalizeTags(
          parsed.filter((value): value is string => typeof value === "string")
        )
      : [];
  } catch {
    return [];
  }
}

function parseAliasesJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? Array.from(
          new Set(
            parsed
              .filter((value): value is string => typeof value === "string")
              .map((value) => value.trim())
              .filter(Boolean)
          )
        )
      : [];
  } catch {
    return [];
  }
}

function parseFrontmatterJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function resolveNoteObservedAt(
  note: Pick<Note, "frontmatter" | "createdAt">
) {
  const observedAt =
    typeof note.frontmatter.observedAt === "string"
      ? note.frontmatter.observedAt.trim()
      : "";
  if (observedAt.length > 0 && !Number.isNaN(Date.parse(observedAt))) {
    return new Date(observedAt).toISOString();
  }
  return note.createdAt;
}

export function cleanupExpiredNotes(now = new Date()) {
  const expiresOnOrBefore = now.toISOString();
  return runInTransaction(() => {
    const expiredRows = getDatabase()
      .prepare(
        `SELECT id
         FROM notes
         WHERE destroy_at IS NOT NULL
           AND destroy_at != ''
           AND destroy_at <= ?
         ORDER BY destroy_at ASC, id ASC
         LIMIT ?`
      )
      .all(expiresOnOrBefore, EXPIRED_NOTE_CLEANUP_BATCH_SIZE) as Array<{
      id: string;
    }>;

    const readDestroyAt = getDatabase().prepare(
      `SELECT destroy_at
       FROM notes
       WHERE id = ?`
    );
    let deletedCount = 0;
    for (const row of expiredRows) {
      const current = readDestroyAt.get(row.id) as
        | { destroy_at: string | null }
        | undefined;
      if (!current?.destroy_at || current.destroy_at > expiresOnOrBefore) {
        continue;
      }
      if (
        deleteNoteInternal(
          row.id,
          { source: "system", actor: null },
          "Ephemeral note expired"
        )
      ) {
        deletedCount += 1;
      }
    }
    return deletedCount;
  });
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, "").trim())
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\r/g, "")
    .trim();
}

function tokenizeNoteSearch(query: string): string[] {
  return (
    query
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}_]+/gu) ?? []
  );
}

function normalizeNoteSearchValue(value: unknown) {
  return typeof value === "string" ? value.normalize("NFKC").toLowerCase() : "";
}

export function noteMatchesSearchQuery(
  note: Pick<
    Note,
    "title" | "summary" | "contentPlain" | "author" | "tags" | "links"
  >,
  query: string | undefined
) {
  if (!query?.trim()) {
    return true;
  }
  const queryTokens = tokenizeNoteSearch(query);
  if (queryTokens.length === 0) {
    return false;
  }
  const searchableValues = [
    note.title,
    note.summary,
    note.contentPlain,
    note.author,
    ...(Array.isArray(note.tags) ? note.tags : []),
    ...(Array.isArray(note.links)
      ? note.links.flatMap((link) => [
          link.entityType,
          link.entityId,
          link.anchorKey
        ])
      : [])
  ].map(normalizeNoteSearchValue);
  return queryTokens.every((token) =>
    searchableValues.some((value) => value.includes(token))
  );
}

export function resolveNoteMutationUserId(
  requestedUserId: string | null | undefined,
  allowedUserIds: readonly string[]
): string | null {
  const requested = requestedUserId?.trim() || null;
  const allowed = Array.from(
    new Set(allowedUserIds.map((userId) => userId.trim()).filter(Boolean))
  );
  if (requested) {
    if (allowed.length > 0 && !allowed.includes(requested)) {
      throw new HttpError(
        403,
        "user_scope_forbidden",
        "The requested user scope is outside this token's allowed users."
      );
    }
    return requested;
  }
  if (allowed.length === 1) {
    return allowed[0]!;
  }
  if (allowed.length > 1) {
    throw new HttpError(
      400,
      "note_user_selection_required",
      "Choose one allowed userId for this note mutation."
    );
  }
  return null;
}

function buildFtsTokenQuery(token: string) {
  return `"${token.replaceAll('"', '""')}"*`;
}

function escapeSqlLike(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

function hasAsciiControlCharacter(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
}

function encodeNotesCursor(row: Pick<NoteRow, "created_at" | "id">) {
  const cursor: NotesCursor = {
    version: 1,
    createdAt: row.created_at,
    id: row.id
  };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeNotesCursor(raw: string | undefined): NotesCursor | null {
  const value = raw?.trim();
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as Partial<NotesCursor>;
    const createdAt = parsed.createdAt;
    const id = parsed.id;
    if (
      parsed.version !== 1 ||
      typeof createdAt !== "string" ||
      createdAt.length === 0 ||
      createdAt.length > 64 ||
      createdAt !== createdAt.trim() ||
      hasAsciiControlCharacter(createdAt) ||
      Number.isNaN(Date.parse(createdAt)) ||
      typeof id !== "string" ||
      id.length === 0 ||
      id.length > 256 ||
      id !== id.trim() ||
      hasAsciiControlCharacter(id)
    ) {
      throw new Error("Invalid note cursor payload");
    }
    return {
      version: 1,
      createdAt,
      id
    };
  } catch {
    throw new HttpError(
      400,
      "invalid_note_cursor",
      "The note page cursor is invalid or no longer supported. Start again from the first page."
    );
  }
}

function getNoteRow(noteId: string): NoteRow | undefined {
  return getDatabase()
    .prepare(
      `SELECT id, kind, title, slug, space_id, aliases_json, summary, content_markdown, content_plain, author, source, tags_json, destroy_at,
              source_path, frontmatter_json, revision_hash, last_synced_at, parent_slug, index_order, show_in_index, created_at, updated_at
       FROM notes
       WHERE id = ?`
    )
    .get(noteId) as NoteRow | undefined;
}

function listLinkRowsForNotes(noteIds: string[]): NoteLinkRow[] {
  if (noteIds.length === 0) {
    return [];
  }
  const placeholders = noteIds.map(() => "?").join(", ");
  return getDatabase()
    .prepare(
      `SELECT note_id, entity_type, entity_id, anchor_key, created_at
       FROM note_links
       WHERE note_id IN (${placeholders})
       ORDER BY created_at ASC`
    )
    .all(...noteIds) as NoteLinkRow[];
}

function mapLinks(rows: NoteLinkRow[]): NoteLink[] {
  return rows.map((row) => ({
    entityType: row.entity_type,
    entityId: row.entity_id,
    anchorKey: normalizeAnchorKey(row.anchor_key)
  }));
}

function mapNote(row: NoteRow, linkRows: NoteLinkRow[]): Note {
  return noteSchema.parse(
    decorateOwnedEntity("note", mapUnownedNote(row, linkRows))
  );
}

function mapUnownedNote(row: NoteRow, linkRows: NoteLinkRow[]): Note {
  return noteSchema.parse({
    id: row.id,
    kind: row.kind,
    title: row.title,
    slug: row.slug,
    spaceId: row.space_id,
    parentSlug: row.parent_slug,
    indexOrder: row.index_order,
    showInIndex: row.show_in_index === 1,
    aliases: parseAliasesJson(row.aliases_json),
    summary: row.summary,
    contentMarkdown: row.content_markdown,
    contentPlain: row.content_plain,
    author: row.author,
    source: row.source,
    sourcePath: row.source_path,
    frontmatter: parseFrontmatterJson(row.frontmatter_json),
    revisionHash: row.revision_hash,
    lastSyncedAt: row.last_synced_at,
    tags: parseTagsJson(row.tags_json),
    destroyAt: row.destroy_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    links: mapLinks(linkRows)
  });
}

function mapNotes(rows: NoteRow[], linkRows: NoteLinkRow[]): Note[] {
  const linksByNoteId = new Map<string, NoteLinkRow[]>();
  for (const link of linkRows) {
    const current = linksByNoteId.get(link.note_id) ?? [];
    current.push(link);
    linksByNoteId.set(link.note_id, current);
  }
  return decorateOwnedEntities(
    "note",
    rows.map((row) => mapUnownedNote(row, linksByNoteId.get(row.id) ?? []))
  ).map((note) => noteSchema.parse(note));
}

export function projectNoteLinksForRead(
  note: Note,
  canReadLink: (link: NoteLink) => boolean
): Note {
  const visibleLinks = note.links.filter(canReadLink);
  const visibleLinkIdentities = new Set(
    visibleLinks.map(
      (link) =>
        `${link.entityType}\u0000${link.entityId}\u0000${link.anchorKey ?? ""}`
    )
  );
  const linkedEntities = note.frontmatter.linkedEntities;
  const frontmatter = Array.isArray(linkedEntities)
    ? {
        ...note.frontmatter,
        linkedEntities: linkedEntities.filter((value) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            return false;
          }
          const link = value as Record<string, unknown>;
          if (
            typeof link.entityType !== "string" ||
            typeof link.entityId !== "string"
          ) {
            return false;
          }
          const anchorKey =
            typeof link.anchorKey === "string" ? link.anchorKey : "";
          return visibleLinkIdentities.has(
            `${link.entityType}\u0000${link.entityId}\u0000${anchorKey}`
          );
        })
      }
    : note.frontmatter;
  return noteSchema.parse({
    ...note,
    links: visibleLinks,
    frontmatter,
    unavailableLinkCount:
      (note.unavailableLinkCount ?? 0) +
      (note.links.length - visibleLinks.length)
  });
}

function upsertSearchRow(
  noteId: string,
  contentPlain: string,
  author: string | null
) {
  getDatabase().prepare(`DELETE FROM notes_fts WHERE note_id = ?`).run(noteId);
  getDatabase()
    .prepare(
      `INSERT INTO notes_fts (note_id, content_plain, author) VALUES (?, ?, ?)`
    )
    .run(
      noteId,
      contentPlain.normalize("NFKC").toLowerCase(),
      (author ?? "").normalize("NFKC").toLowerCase()
    );
}

function deleteSearchRow(noteId: string) {
  getDatabase().prepare(`DELETE FROM notes_fts WHERE note_id = ?`).run(noteId);
}

function appendTextTokenCondition(
  clauses: string[],
  parameters: Array<string | number | null>,
  token: string
) {
  const like = `%${escapeSqlLike(token)}%`;
  clauses.push(`(
    notes.id IN (
      SELECT note_id
      FROM notes_fts
      WHERE notes_fts MATCH ?
    )
    OR forge_nfkc_lower(notes.content_plain) LIKE ? ESCAPE '\\'
    OR forge_nfkc_lower(COALESCE(notes.author, '')) LIKE ? ESCAPE '\\'
    OR forge_nfkc_lower(notes.title) LIKE ? ESCAPE '\\'
    OR forge_nfkc_lower(notes.summary) LIKE ? ESCAPE '\\'
    OR EXISTS (
      SELECT 1
      FROM json_each(
        CASE WHEN json_valid(notes.tags_json) THEN notes.tags_json ELSE '[]' END
      ) AS note_tag
      WHERE forge_nfkc_lower(CAST(note_tag.value AS TEXT)) LIKE ? ESCAPE '\\'
    )
    OR EXISTS (
      SELECT 1
      FROM note_links AS search_note_link
      WHERE search_note_link.note_id = notes.id
        AND (
          forge_nfkc_lower(search_note_link.entity_type) LIKE ? ESCAPE '\\'
          OR forge_nfkc_lower(search_note_link.entity_id) LIKE ? ESCAPE '\\'
          OR forge_nfkc_lower(COALESCE(search_note_link.anchor_key, '')) LIKE ? ESCAPE '\\'
        )
    )
  )`);
  parameters.push(
    buildFtsTokenQuery(token),
    like,
    like,
    like,
    like,
    like,
    like,
    like,
    like
  );
}

function appendNoteReadScopeConditions(
  clauses: string[],
  parameters: Array<string | number | null>,
  scope: NoteReadScope,
  noteAlias = "notes"
) {
  if (scope.accessibleSpaceIds !== undefined) {
    if (scope.accessibleSpaceIds.length === 0) {
      clauses.push("0 = 1");
    } else {
      clauses.push(
        `${noteAlias}.space_id IN (${scope.accessibleSpaceIds.map(() => "?").join(", ")})`
      );
      parameters.push(...scope.accessibleSpaceIds);
    }
  }

  if (scope.userIds && scope.userIds.length > 0) {
    const ownerPlaceholders = scope.userIds.map(() => "?").join(", ");
    const accessibleWikiClause =
      scope.accessibleSpaceIds && scope.accessibleSpaceIds.length > 0
        ? `
      OR (
        ${noteAlias}.kind = 'wiki'
        AND ${noteAlias}.space_id IN (${scope.accessibleSpaceIds.map(() => "?").join(", ")})
      )`
        : "";
    clauses.push(`(
      EXISTS (
        SELECT 1
        FROM entity_owners AS note_owner
        WHERE note_owner.entity_type = 'note'
          AND note_owner.entity_id = ${noteAlias}.id
          AND note_owner.user_id IN (${ownerPlaceholders})
      )
      OR EXISTS (
        SELECT 1
        FROM entity_assignments AS note_assignment
        WHERE note_assignment.entity_type = 'note'
          AND note_assignment.entity_id = ${noteAlias}.id
          AND note_assignment.role = 'assignee'
          AND note_assignment.user_id IN (${ownerPlaceholders})
      )
      ${accessibleWikiClause}
    )`);
    parameters.push(...scope.userIds, ...scope.userIds);
    if (accessibleWikiClause && scope.accessibleSpaceIds) {
      parameters.push(...scope.accessibleSpaceIds);
    }
  }

  if (scope.includePsyche === false) {
    clauses.push(`NOT EXISTS (
      SELECT 1
      FROM note_links AS psyche_note_link
      WHERE psyche_note_link.note_id = ${noteAlias}.id
        AND psyche_note_link.entity_type IN (${PSYCHE_NOTE_LINK_TYPES.map(() => "?").join(", ")})
    )`);
    parameters.push(...PSYCHE_NOTE_LINK_TYPES);
  }
}

function buildNotesWhere(
  parsed: ReturnType<typeof notesListQuerySchema.parse>,
  query: NotesPageQuery,
  scope: NotesPageScope,
  options: { includeCursor: boolean }
) {
  const clauses = [
    `NOT EXISTS (
      SELECT 1
      FROM deleted_entities
      WHERE deleted_entities.entity_type = 'note'
        AND deleted_entities.entity_id = notes.id
    )`,
    `(notes.destroy_at IS NULL OR notes.destroy_at = '' OR notes.destroy_at > ?)`
  ];
  const parameters: Array<string | number | null> = [new Date().toISOString()];

  if (parsed.kind) {
    clauses.push("notes.kind = ?");
    parameters.push(parsed.kind);
  }
  if (parsed.spaceId) {
    clauses.push("notes.space_id = ?");
    parameters.push(parsed.spaceId);
  }
  if (parsed.slug) {
    clauses.push("lower(notes.slug) = lower(?)");
    parameters.push(parsed.slug);
  }
  if (parsed.author) {
    clauses.push("lower(COALESCE(notes.author, '')) LIKE ? ESCAPE '\\'");
    parameters.push(`%${escapeSqlLike(parsed.author.toLowerCase())}%`);
  }
  if (query.ids !== undefined) {
    if (query.ids.length === 0) {
      clauses.push("0 = 1");
    } else {
      clauses.push(`notes.id IN (${query.ids.map(() => "?").join(", ")})`);
      parameters.push(...query.ids);
    }
  }

  const queryTokens = parsed.query ? tokenizeNoteSearch(parsed.query) : [];
  if (parsed.query && queryTokens.length === 0) {
    clauses.push("0 = 1");
  } else {
    for (const token of queryTokens) {
      appendTextTokenCondition(clauses, parameters, token);
    }
  }

  const textTermGroups = parsed.textTerms
    .map((term) => tokenizeNoteSearch(term))
    .filter((tokens) => tokens.length > 0);
  if (parsed.textTerms.length > 0 && textTermGroups.length === 0) {
    clauses.push("0 = 1");
  } else if (textTermGroups.length > 0) {
    const termClauses: string[] = [];
    for (const tokens of textTermGroups) {
      const tokenClauses: string[] = [];
      for (const token of tokens) {
        appendTextTokenCondition(tokenClauses, parameters, token);
      }
      termClauses.push(`(${tokenClauses.join(" AND ")})`);
    }
    clauses.push(`(${termClauses.join(" OR ")})`);
  }

  const linkedFilters = [
    ...(parsed.linkedEntityType && parsed.linkedEntityId
      ? [
          {
            entityType: parsed.linkedEntityType,
            entityId: parsed.linkedEntityId
          }
        ]
      : []),
    ...parsed.linkedTo
  ];
  if (linkedFilters.length > 0) {
    const linkedClauses = linkedFilters.map(
      () =>
        `(note_link.entity_type = ? AND note_link.entity_id = ?${
          parsed.anchorKey === undefined
            ? ""
            : parsed.includeAnchorless
              ? " AND (COALESCE(NULLIF(note_link.anchor_key, ''), '') = ? OR COALESCE(NULLIF(note_link.anchor_key, ''), '') = '')"
              : " AND COALESCE(NULLIF(note_link.anchor_key, ''), '') = ?"
        })`
    );
    clauses.push(`EXISTS (
      SELECT 1
      FROM note_links AS note_link
      WHERE note_link.note_id = notes.id
        AND (${linkedClauses.join(" OR ")})
    )`);
    for (const filter of linkedFilters) {
      parameters.push(filter.entityType, filter.entityId);
      if (parsed.anchorKey !== undefined) {
        parameters.push(parsed.anchorKey ?? "");
      }
    }
  }

  for (const tag of parsed.tags) {
    clauses.push(`EXISTS (
      SELECT 1
      FROM json_each(
        CASE WHEN json_valid(notes.tags_json) THEN notes.tags_json ELSE '[]' END
      ) AS exact_note_tag
      WHERE lower(CAST(exact_note_tag.value AS TEXT)) = lower(?)
    )`);
    parameters.push(tag);
  }

  if (parsed.updatedFrom) {
    clauses.push("substr(notes.updated_at, 1, 10) >= ?");
    parameters.push(parsed.updatedFrom);
  }
  if (parsed.updatedTo) {
    clauses.push("substr(notes.updated_at, 1, 10) <= ?");
    parameters.push(parsed.updatedTo);
  }
  const observedFrom = query.observedFrom?.trim();
  const observedTo = query.observedTo?.trim();
  const observedDateSql = `date(COALESCE(
    CASE
      WHEN json_valid(notes.frontmatter_json)
      THEN json_extract(notes.frontmatter_json, '$.observedAt')
      ELSE NULL
    END,
    notes.created_at
  ))`;
  if (observedFrom) {
    clauses.push(`${observedDateSql} >= date(?)`);
    parameters.push(observedFrom);
  }
  if (observedTo) {
    clauses.push(`${observedDateSql} <= date(?)`);
    parameters.push(observedTo);
  }

  appendNoteReadScopeConditions(clauses, parameters, {
    ...scope,
    userIds: parsed.userIds
  });

  if (options.includeCursor) {
    const cursor = decodeNotesCursor(query.cursor);
    if (cursor) {
      clauses.push(
        "(notes.created_at < ? OR (notes.created_at = ? AND notes.id < ?))"
      );
      parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
  }

  return { sql: clauses.join(" AND "), parameters };
}

function insertLinks(
  noteId: string,
  links: CreateNoteInput["links"],
  createdAt: string
) {
  const statement = getDatabase().prepare(
    `INSERT OR IGNORE INTO note_links (note_id, entity_type, entity_id, anchor_key, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const link of links) {
    statement.run(
      noteId,
      link.entityType,
      link.entityId,
      link.anchorKey ?? "",
      createdAt
    );
  }
}

function replaceLinks(
  noteId: string,
  links: CreateNoteInput["links"],
  createdAt: string
) {
  getDatabase().prepare(`DELETE FROM note_links WHERE note_id = ?`).run(noteId);
  insertLinks(noteId, links, createdAt);
}

function listNoteLinks(noteId: string): NoteLinkRow[] {
  return getDatabase()
    .prepare(
      `SELECT note_id, entity_type, entity_id, anchor_key, created_at
       FROM note_links
       WHERE note_id = ?
       ORDER BY created_at ASC`
    )
    .all(noteId) as NoteLinkRow[];
}

function recordNoteActivity(
  note: Note,
  eventType: "note.created" | "note.updated" | "note.deleted",
  title: string,
  context: NoteContext
) {
  const description =
    eventType === "note.created"
      ? "A linked note was added."
      : eventType === "note.updated"
        ? "A linked note was updated."
        : "A linked note was deleted.";
  const linksByTarget = new Map<string, NoteLink[]>();
  for (const link of note.links) {
    const key = JSON.stringify([link.entityType, link.entityId]);
    const links = linksByTarget.get(key) ?? [];
    links.push(link);
    linksByTarget.set(key, links);
  }
  const visibility: NoteActivityVisibilityMetadata = {
    ownerUserId: note.userId ?? null,
    assigneeUserIds: note.assigneeUserIds ?? [],
    spaceId: note.spaceId,
    kind: note.kind,
    includesPsyche: noteHasPsycheLink(note)
  };
  for (const links of linksByTarget.values()) {
    const link = links[0]!;
    const anchorKeys = Array.from(
      new Set(links.map((entry) => entry.anchorKey ?? ""))
    );
    recordActivityEvent({
      entityType: link.entityType,
      entityId: link.entityId,
      eventType,
      title,
      description,
      actor: context.actor ?? null,
      source: context.source,
      metadata: {
        noteId: note.id,
        anchorKey: anchorKeys[0] ?? "",
        anchorKeys,
        [NOTE_ACTIVITY_VISIBILITY_METADATA_KEY]: visibility
      }
    });
    recordEventLog({
      eventKind: eventType,
      entityType: link.entityType,
      entityId: link.entityId,
      actor: context.actor ?? null,
      source: context.source,
      metadata: {
        noteId: note.id,
        anchorKey: anchorKeys[0] ?? "",
        anchorKeys
      }
    });
  }
}

function parseNoteActivityVisibilityMetadata(
  value: unknown
): NoteActivityVisibilityMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const metadata = value as Record<string, unknown>;
  if (
    (metadata.ownerUserId !== null &&
      typeof metadata.ownerUserId !== "string") ||
    !Array.isArray(metadata.assigneeUserIds) ||
    !metadata.assigneeUserIds.every((userId) => typeof userId === "string") ||
    typeof metadata.spaceId !== "string" ||
    (metadata.kind !== "evidence" && metadata.kind !== "wiki") ||
    typeof metadata.includesPsyche !== "boolean"
  ) {
    return null;
  }
  return {
    ownerUserId: metadata.ownerUserId as string | null,
    assigneeUserIds: metadata.assigneeUserIds as string[],
    spaceId: metadata.spaceId,
    kind: metadata.kind,
    includesPsyche: metadata.includesPsyche
  };
}

function isNoteActivityVisibilityMetadataVisible(
  metadata: NoteActivityVisibilityMetadata,
  scope: NoteReadScope
) {
  if (
    scope.accessibleSpaceIds !== undefined &&
    !scope.accessibleSpaceIds.includes(metadata.spaceId)
  ) {
    return false;
  }
  if (scope.includePsyche === false && metadata.includesPsyche) {
    return false;
  }
  if (!scope.userIds || scope.userIds.length === 0) {
    return true;
  }
  const allowed = new Set(scope.userIds);
  return (
    (metadata.ownerUserId !== null && allowed.has(metadata.ownerUserId)) ||
    metadata.assigneeUserIds.some((userId) => allowed.has(userId)) ||
    (metadata.kind === "wiki" &&
      scope.accessibleSpaceIds?.includes(metadata.spaceId) === true)
  );
}

function redactNoteActivityVisibilityMetadata(event: ActivityEvent) {
  if (!(NOTE_ACTIVITY_VISIBILITY_METADATA_KEY in event.metadata)) {
    return event;
  }
  const metadata = { ...event.metadata };
  delete metadata[NOTE_ACTIVITY_VISIBILITY_METADATA_KEY];
  return { ...event, metadata };
}

export function isNoteVisibleToScope(note: Note, scope: NoteReadScope) {
  if (
    scope.accessibleSpaceIds !== undefined &&
    !scope.accessibleSpaceIds.includes(note.spaceId)
  ) {
    return false;
  }
  if (scope.userIds && scope.userIds.length > 0) {
    const allowed = new Set(scope.userIds);
    const accessibleWikiNote =
      note.kind === "wiki" &&
      scope.accessibleSpaceIds?.includes(note.spaceId) === true;
    if (
      !accessibleWikiNote &&
      (!note.userId || !allowed.has(note.userId)) &&
      !(note.assigneeUserIds ?? []).some((userId) => allowed.has(userId))
    ) {
      return false;
    }
  }
  return scope.includePsyche !== false || !noteHasPsycheLink(note);
}

export function filterNoteActivityEventsForScope(
  events: readonly ActivityEvent[],
  scope: NoteReadScope
) {
  const visibility = new Map<string, boolean>();
  const visibleEvents: ActivityEvent[] = [];
  for (const event of events) {
    if (
      scope.includePsyche === false &&
      PSYCHE_NOTE_LINK_TYPES.includes(
        event.entityType as (typeof PSYCHE_NOTE_LINK_TYPES)[number]
      )
    ) {
      continue;
    }
    const metadataNoteId =
      typeof event.metadata.noteId === "string"
        ? event.metadata.noteId.trim()
        : "";
    const noteId =
      metadataNoteId || (event.entityType === "note" ? event.entityId : "");
    if (!noteId) {
      if (
        scope.userIds &&
        scope.userIds.length > 0 &&
        (!event.userId || !scope.userIds.includes(event.userId))
      ) {
        continue;
      }
      visibleEvents.push(redactNoteActivityVisibilityMetadata(event));
      continue;
    }
    const note = getNoteByIdIncludingDeleted(noteId, { skipCleanup: true });
    const cached = note ? visibility.get(noteId) : undefined;
    const storedVisibility = note
      ? null
      : parseNoteActivityVisibilityMetadata(
          event.metadata[NOTE_ACTIVITY_VISIBILITY_METADATA_KEY]
        );
    const visible =
      cached ??
      (note
        ? isNoteVisibleToScope(note, scope)
        : storedVisibility
          ? isNoteActivityVisibilityMetadataVisible(storedVisibility, scope)
          : false);
    if (note && cached === undefined) {
      visibility.set(noteId, visible);
    }
    if (visible) {
      visibleEvents.push(redactNoteActivityVisibilityMetadata(event));
    }
  }
  return visibleEvents;
}

export function getNoteById(
  noteId: string,
  options: { skipCleanup?: boolean } = {}
): Note | undefined {
  if (!options.skipCleanup) {
    cleanupExpiredNotes();
  }
  if (isEntityDeleted("note", noteId)) {
    return undefined;
  }
  const row = getNoteRow(noteId);
  if (!row) {
    return undefined;
  }
  return mapNote(row, listNoteLinks(noteId));
}

export function getNoteByIdIncludingDeleted(
  noteId: string,
  options: { skipCleanup?: boolean } = {}
): Note | undefined {
  if (!options.skipCleanup) {
    cleanupExpiredNotes();
  }
  const row = getNoteRow(noteId);
  if (!row) {
    const deleted = getDeletedEntityRecord("note", noteId);
    return deleted?.snapshot as Note | undefined;
  }
  return mapNote(row, listNoteLinks(noteId));
}

export function listNotes(query: NotesListQuery = {}): Note[] {
  const parsed = notesListQuerySchema.parse(query);
  return listNotesPage(
    {
      ...parsed,
      limit: parsed.limit ?? 100
    },
    {}
  ).notes;
}

export function listNotesPage(
  query: NotesPageQuery = {},
  scope: NotesPageScope = {}
): NotesPage {
  cleanupExpiredNotes();
  const parsed = notesListQuerySchema.parse(query);
  const linkedFilters = [
    ...(parsed.linkedEntityType && parsed.linkedEntityId
      ? [
          {
            entityType: parsed.linkedEntityType,
            entityId: parsed.linkedEntityId
          }
        ]
      : []),
    ...parsed.linkedTo
  ];
  if (
    linkedFilters.some((filter) =>
      isEntityDeleted(filter.entityType, filter.entityId)
    )
  ) {
    return {
      notes: [],
      total: 0,
      limit: Math.min(
        parsed.limit ?? DEFAULT_NOTES_PAGE_LIMIT,
        MAX_NOTES_PAGE_LIMIT
      ),
      nextCursor: null,
      hasMore: false
    };
  }

  const limit = Math.min(
    parsed.limit ?? DEFAULT_NOTES_PAGE_LIMIT,
    MAX_NOTES_PAGE_LIMIT
  );
  const countWhere = buildNotesWhere(parsed, query, scope, {
    includeCursor: false
  });
  const totalRow = getDatabase()
    .prepare(`SELECT COUNT(*) AS count FROM notes WHERE ${countWhere.sql}`)
    .get(...countWhere.parameters) as { count: number };

  const pageWhere = buildNotesWhere(parsed, query, scope, {
    includeCursor: true
  });
  const rows = getDatabase()
    .prepare(
      `SELECT id, kind, title, slug, space_id, aliases_json, summary, content_markdown, content_plain, author, source, tags_json, destroy_at,
              source_path, frontmatter_json, revision_hash, last_synced_at, parent_slug, index_order, show_in_index, created_at, updated_at
       FROM notes
       WHERE ${pageWhere.sql}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(...pageWhere.parameters, limit + 1) as NoteRow[];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = pageRows.at(-1);

  return {
    notes: mapNotes(
      pageRows,
      listLinkRowsForNotes(pageRows.map((row) => row.id))
    ),
    total: totalRow.count,
    limit,
    nextCursor: hasMore && lastRow ? encodeNotesCursor(lastRow) : null,
    hasMore
  };
}

export function listNotesByObservedAtRange(
  {
    from,
    to,
    userIds,
    limit = 400
  }: {
    from: string;
    to: string;
    userIds?: string[];
    limit?: number;
  },
  scope: NotesPageScope = {}
) {
  cleanupExpiredNotes();
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return [] as Note[];
  }

  const matches: Array<{ note: Note; observedAt: string }> = [];
  let cursor: string | undefined;
  let pageCount = 0;
  do {
    const page = listNotesPage(
      {
        userIds,
        observedFrom: new Date(fromMs).toISOString().slice(0, 10),
        observedTo: new Date(Math.max(fromMs, toMs - 1))
          .toISOString()
          .slice(0, 10),
        limit: MAX_NOTES_PAGE_LIMIT,
        cursor
      },
      scope
    );
    for (const note of page.notes) {
      const observedAt = resolveNoteObservedAt(note);
      const observedAtMs = Date.parse(observedAt);
      if (
        !Number.isNaN(observedAtMs) &&
        observedAtMs >= fromMs &&
        observedAtMs < toMs
      ) {
        matches.push({ note, observedAt });
      }
    }
    cursor = page.nextCursor ?? undefined;
    pageCount += 1;
    if (!page.hasMore || matches.length >= limit || pageCount >= 100) {
      break;
    }
  } while (cursor);

  return matches
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt))
    .slice(0, limit)
    .map(({ note }) => note);
}

export function createNoteWithinTransaction(
  input: CreateNoteInput,
  context: NoteContext,
  options: CreateNoteOptions = {}
): Note {
  cleanupExpiredNotes();
  const parsed = createNoteSchema.parse({
    ...input,
    links: normalizeLinks(input.links),
    tags: normalizeTags(input.tags)
  });
  const now = new Date().toISOString();
  const id =
    options.id ?? `note_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  if (!/^note_[a-z0-9]{10,64}$/u.test(id)) {
    throw new HttpError(
      400,
      "note_internal_id_invalid",
      "The requested internal Note identity is invalid."
    );
  }
  const wikiFields = prepareNoteWikiFields({
    id,
    contentMarkdown: parsed.contentMarkdown,
    kind: parsed.kind,
    title: parsed.title,
    slug: parsed.slug,
    spaceId: parsed.spaceId,
    parentSlug: parsed.parentSlug,
    indexOrder: parsed.indexOrder,
    showInIndex: parsed.showInIndex,
    aliases: parsed.aliases,
    summary: parsed.summary,
    userId: parsed.userId ?? null
  });
  const contentPlain = stripMarkdown(parsed.contentMarkdown);

  getDatabase()
    .prepare(
      `INSERT INTO notes (
           id, kind, title, slug, space_id, parent_slug, index_order, show_in_index, aliases_json, summary, content_markdown, content_plain, author, source, tags_json, destroy_at,
           source_path, frontmatter_json, revision_hash, last_synced_at, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      wikiFields.kind,
      wikiFields.title,
      wikiFields.slug,
      wikiFields.spaceId,
      wikiFields.parentSlug,
      wikiFields.indexOrder,
      wikiFields.showInIndex ? 1 : 0,
      JSON.stringify(wikiFields.aliases),
      wikiFields.summary,
      parsed.contentMarkdown,
      contentPlain,
      parsed.author ?? context.actor ?? null,
      context.source,
      JSON.stringify(parsed.tags),
      parsed.destroyAt,
      canonicalNoteSourcePath(),
      JSON.stringify(parsed.frontmatter),
      parsed.revisionHash,
      parsed.lastSyncedAt ?? null,
      now,
      now
    );
  insertLinks(id, parsed.links, now);
  setEntityOwner("note", id, parsed.userId, null);
  clearDeletedEntityRecord("note", id);
  upsertSearchRow(id, contentPlain, parsed.author ?? context.actor ?? null);

  const note = getNoteById(id, { skipCleanup: true })!;
  syncNoteWikiArtifacts(note);
  recordNoteActivity(note, "note.created", "Note added", context);
  return getNoteById(id, { skipCleanup: true })!;
}

export function createNote(input: CreateNoteInput, context: NoteContext): Note {
  return runInTransaction(() => createNoteWithinTransaction(input, context));
}

export function createLinkedNotes(
  notes: NestedCreateNoteInput[] | undefined,
  entityLink: NoteLink,
  context: NoteContext
): Note[] {
  if (!notes || notes.length === 0) {
    return [];
  }

  const parentNote =
    entityLink.entityType === "note"
      ? getNoteById(entityLink.entityId)
      : undefined;
  const parentUserId =
    parentNote?.userId ??
    getEntityOwnerId(entityLink.entityType, entityLink.entityId);
  return notes.map((note) =>
    createNote(
      {
        kind: "evidence",
        title: "",
        slug: "",
        spaceId: parentNote?.spaceId ?? "",
        parentSlug: null,
        indexOrder: 0,
        showInIndex: false,
        aliases: [],
        summary: "",
        contentMarkdown: note.contentMarkdown,
        author: note.author,
        tags: note.tags,
        destroyAt: note.destroyAt,
        links: [entityLink, ...note.links],
        sourcePath: "",
        frontmatter: {},
        revisionHash: "",
        userId: parentUserId
      },
      context
    )
  );
}

export function updateNote(
  noteId: string,
  input: UpdateNoteInput,
  context: NoteContext
): Note | undefined {
  cleanupExpiredNotes();
  const existing = getNoteByIdIncludingDeleted(noteId, { skipCleanup: true });
  if (!existing) {
    return undefined;
  }
  const patch = updateNoteSchema.parse({
    ...input,
    links: input.links ? normalizeLinks(input.links) : undefined,
    tags: input.tags ? normalizeTags(input.tags) : undefined
  });
  const nextMarkdown = patch.contentMarkdown ?? existing.contentMarkdown;
  const nextPlain = stripMarkdown(nextMarkdown);
  const nextAuthor =
    patch.author === undefined ? existing.author : patch.author;
  const nextTags = patch.tags ?? existing.tags;
  const nextDestroyAt =
    patch.destroyAt === undefined ? existing.destroyAt : patch.destroyAt;
  const wikiFields = prepareNoteWikiFields({
    id: noteId,
    contentMarkdown: nextMarkdown,
    kind: patch.kind ?? existing.kind,
    title: patch.title,
    slug: patch.slug,
    spaceId: patch.spaceId,
    parentSlug: patch.parentSlug,
    indexOrder: patch.indexOrder,
    showInIndex: patch.showInIndex,
    aliases: patch.aliases,
    summary: patch.summary,
    userId: patch.userId ?? existing.userId ?? null,
    existing
  });
  const nextFrontmatter =
    patch.frontmatter === undefined ? existing.frontmatter : patch.frontmatter;
  const nextSourcePath = canonicalNoteSourcePath();
  const nextRevisionHash =
    patch.revisionHash === undefined
      ? existing.revisionHash
      : patch.revisionHash;
  const nextLastSyncedAt =
    patch.lastSyncedAt === undefined
      ? existing.lastSyncedAt
      : patch.lastSyncedAt;
  const updatedAt = new Date().toISOString();

  return runInTransaction(() => {
    const result = getDatabase()
      .prepare(
        `UPDATE notes
         SET kind = ?, title = ?, slug = ?, space_id = ?, parent_slug = ?, index_order = ?, show_in_index = ?, aliases_json = ?, summary = ?, content_markdown = ?, content_plain = ?, author = ?,
             tags_json = ?, destroy_at = ?, source_path = ?, frontmatter_json = ?, revision_hash = ?, last_synced_at = ?, updated_at = ?
         WHERE id = ?
           AND (? IS NULL OR revision_hash = ?)`
      )
      .run(
        wikiFields.kind,
        wikiFields.title,
        wikiFields.slug,
        wikiFields.spaceId,
        wikiFields.parentSlug,
        wikiFields.indexOrder,
        wikiFields.showInIndex ? 1 : 0,
        JSON.stringify(wikiFields.aliases),
        wikiFields.summary,
        nextMarkdown,
        nextPlain,
        nextAuthor,
        JSON.stringify(nextTags),
        nextDestroyAt,
        nextSourcePath,
        JSON.stringify(nextFrontmatter),
        nextRevisionHash,
        nextLastSyncedAt,
        updatedAt,
        noteId,
        patch.expectedRevisionHash ?? null,
        patch.expectedRevisionHash ?? null
      );

    if (result.changes === 0) {
      const current = getNoteByIdIncludingDeleted(noteId, {
        skipCleanup: true
      });
      if (!current) {
        return undefined;
      }
      throw new HttpError(
        409,
        "note_revision_conflict",
        "This note changed after it was opened. Reload the latest revision before saving; the submitted draft was not applied."
      );
    }

    if (patch.links) {
      replaceLinks(noteId, patch.links, updatedAt);
    }
    if (patch.userId !== undefined) {
      setEntityOwner("note", noteId, patch.userId, null);
    }

    const note = getNoteByIdIncludingDeleted(noteId, { skipCleanup: true })!;
    clearDeletedEntityRecord("note", noteId);
    upsertSearchRow(noteId, nextPlain, nextAuthor);
    if (nextDestroyAt && Date.parse(nextDestroyAt) <= Date.now()) {
      deleteNoteInternal(
        noteId,
        { source: "system", actor: null },
        "Ephemeral note expired"
      );
      return undefined;
    }
    syncNoteWikiArtifacts(note);
    const updated = getNoteById(noteId);
    if (updated) {
      recordNoteActivity(updated, "note.updated", "Note updated", context);
    }
    return updated;
  });
}

function deleteNoteInternal(
  noteId: string,
  context: NoteContext,
  title: string
): Note | undefined {
  const existing = getNoteRow(noteId)
    ? mapNote(getNoteRow(noteId)!, listNoteLinks(noteId))
    : (getDeletedEntityRecord("note", noteId)?.snapshot as Note | undefined);
  if (!existing) {
    return undefined;
  }
  deleteNoteWikiArtifacts(existing);
  clearDeletedEntityRecord("note", noteId);
  getDatabase().prepare(`DELETE FROM note_links WHERE note_id = ?`).run(noteId);
  getDatabase().prepare(`DELETE FROM notes WHERE id = ?`).run(noteId);
  clearEntityOwner("note", noteId);
  getDatabase()
    .prepare(
      `DELETE FROM entity_assignments WHERE entity_type = 'note' AND entity_id = ?`
    )
    .run(noteId);
  deleteSearchRow(noteId);
  clearDeletedEntityRecord("note", noteId);
  recordNoteActivity(existing, "note.deleted", title, context);
  return existing;
}

export function deleteNote(
  noteId: string,
  context: NoteContext
): Note | undefined {
  cleanupExpiredNotes();
  return deleteNoteInternal(noteId, context, "Note deleted");
}

export function buildNotesSummaryByEntity(
  targets: ReadonlyArray<{
    entityType: CrudEntityType;
    entityId: string;
  }>,
  scope: NoteReadScope = {}
): NotesSummaryByEntity {
  cleanupExpiredNotes();
  const idsByType = new Map<CrudEntityType, Set<string>>();
  for (const target of targets) {
    if (!target.entityId.trim()) {
      continue;
    }
    const ids = idsByType.get(target.entityType) ?? new Set<string>();
    ids.add(target.entityId);
    idsByType.set(target.entityType, ids);
  }

  const summary: NotesSummaryByEntity = {};
  const now = new Date().toISOString();
  for (const [entityType, entityIds] of idsByType) {
    const ids = [...entityIds];
    for (let offset = 0; offset < ids.length; offset += 250) {
      const batch = ids.slice(offset, offset + 250);
      const placeholders = batch.map(() => "?").join(", ");
      const scopeClauses: string[] = [];
      const scopeParameters: Array<string | number | null> = [];
      appendNoteReadScopeConditions(
        scopeClauses,
        scopeParameters,
        scope,
        "notes"
      );
      const scopeSql =
        scopeClauses.length > 0 ? `AND ${scopeClauses.join(" AND ")}` : "";
      const rows = getDatabase()
        .prepare(
          `WITH visible_links AS (
             SELECT DISTINCT
               note_links.entity_type AS entity_type,
               note_links.entity_id AS entity_id,
               notes.id AS note_id,
               notes.created_at AS created_at
             FROM note_links
             INNER JOIN notes ON notes.id = note_links.note_id
             LEFT JOIN deleted_entities
               ON deleted_entities.entity_type = 'note'
              AND deleted_entities.entity_id = notes.id
             WHERE note_links.entity_type = ?
               AND note_links.entity_id IN (${placeholders})
               AND deleted_entities.entity_id IS NULL
               AND (notes.destroy_at IS NULL OR notes.destroy_at = '' OR notes.destroy_at > ?)
               ${scopeSql}
           ), ranked AS (
             SELECT
               entity_type,
               entity_id,
               note_id,
               created_at,
               COUNT(*) OVER (PARTITION BY entity_type, entity_id) AS note_count,
               ROW_NUMBER() OVER (
                 PARTITION BY entity_type, entity_id
                 ORDER BY created_at DESC, note_id DESC
               ) AS note_rank
             FROM visible_links
           )
           SELECT entity_type, entity_id, note_id, created_at, note_count
           FROM ranked
           WHERE note_rank = 1`
        )
        .all(entityType, ...batch, now, ...scopeParameters) as Array<{
        entity_type: string;
        entity_id: string;
        note_id: string;
        created_at: string;
        note_count: number;
      }>;
      for (const row of rows) {
        summary[`${row.entity_type}:${row.entity_id}`] = {
          count: row.note_count,
          latestNoteId: row.note_id,
          latestCreatedAt: row.created_at
        };
      }
    }
  }
  return summary;
}

export function unlinkNotesForEntity(
  entityType: CrudEntityType,
  entityId: string,
  _context: NoteContext
) {
  cleanupExpiredNotes();
  const noteIds = getDatabase()
    .prepare(
      `SELECT DISTINCT note_id FROM note_links WHERE entity_type = ? AND entity_id = ?`
    )
    .all(entityType, entityId) as Array<{ note_id: string }>;

  if (noteIds.length === 0) {
    return;
  }

  getDatabase()
    .prepare(`DELETE FROM note_links WHERE entity_type = ? AND entity_id = ?`)
    .run(entityType, entityId);

  for (const row of noteIds) {
    const remaining = getDatabase()
      .prepare(`SELECT COUNT(*) AS count FROM note_links WHERE note_id = ?`)
      .get(row.note_id) as { count: number };
    if (remaining.count > 0) {
      clearDeletedEntityRecord("note", row.note_id);
      continue;
    }
    clearDeletedEntityRecord("note", row.note_id);
  }
}
