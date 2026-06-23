import { randomUUID } from "node:crypto";
import { getDatabase } from "../db.js";
import { recordActivityEvent } from "./activity-events.js";
import { decorateOwnedEntity, setEntityOwner } from "./entity-ownership.js";
import {
  filterDeletedEntities,
  getDeletedEntityRecord,
  clearDeletedEntityRecord,
  isEntityDeleted,
  upsertDeletedEntityRecord
} from "./deleted-entities.js";
import { recordEventLog } from "./event-log.js";
import {
  noteSchema,
  notesListQuerySchema,
  createNoteSchema,
  updateNoteSchema,
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

function normalizeAnchorKey(anchorKey: string): string | null {
  return anchorKey.trim().length > 0 ? anchorKey : null;
}

function normalizeLinks(
  links: CreateNoteInput["links"]
): CreateNoteInput["links"] {
  if (!links) {
    return [];
  }
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

function noteMatchesTextTerm(note: Note, term: string): boolean {
  const normalized = term.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return note.tags.some((tag) => tag.toLowerCase().includes(normalized));
}

function filterNotesByOwnerIds(notes: Note[], userIds?: string[]) {
  if (!userIds || userIds.length === 0) {
    return notes;
  }
  const allowed = new Set(userIds);
  return notes.filter(
    (note) => note.userId !== null && allowed.has(note.userId)
  );
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

function cleanupExpiredNotes() {
  const expiredRows = getDatabase()
    .prepare(
      `SELECT id
       FROM notes
       WHERE destroy_at IS NOT NULL
         AND destroy_at != ''
         AND destroy_at <= ?`
    )
    .all(new Date().toISOString()) as Array<{ id: string }>;

  for (const row of expiredRows) {
    deleteNoteInternal(
      row.id,
      { source: "system", actor: null },
      "Ephemeral note expired"
    );
  }
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

function describeNote(note: Pick<Note, "contentPlain" | "contentMarkdown">) {
  const plain = note.contentPlain.trim() || stripMarkdown(note.contentMarkdown);
  const compact = plain.replace(/\s+/g, " ").trim();
  const title = compact.slice(0, 72) || "Note";
  const subtitle = compact.length > 72 ? compact.slice(72, 168).trim() : "";
  return { title, subtitle };
}

function buildFtsQuery(query: string): string | null {
  const tokens = query
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/["*']/g, "").trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }
  return tokens.map((token) => `${token}*`).join(" AND ");
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
  return noteSchema.parse(decorateOwnedEntity("note", {
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
  }));
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
    .run(noteId, contentPlain, author ?? "");
}

function deleteSearchRow(noteId: string) {
  getDatabase().prepare(`DELETE FROM notes_fts WHERE note_id = ?`).run(noteId);
}

function listAllNoteRows(): NoteRow[] {
  return getDatabase()
    .prepare(
      `SELECT id, kind, title, slug, space_id, aliases_json, summary, content_markdown, content_plain, author, source, tags_json, destroy_at,
              source_path, frontmatter_json, revision_hash, last_synced_at, parent_slug, index_order, show_in_index, created_at, updated_at
       FROM notes
       ORDER BY created_at DESC`
    )
    .all() as NoteRow[];
}

function listActiveNotes(): Note[] {
  const rows = listAllNoteRows();
  const linksByNoteId = new Map<string, NoteLinkRow[]>();
  for (const link of listLinkRowsForNotes(rows.map((row) => row.id))) {
    const current = linksByNoteId.get(link.note_id) ?? [];
    current.push(link);
    linksByNoteId.set(link.note_id, current);
  }

  return filterDeletedEntities(
    "note",
    rows.map((row) => mapNote(row, linksByNoteId.get(row.id) ?? []))
  );
}

function findMatchingNoteIds(query: string): Set<string> {
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) {
    return new Set();
  }
  const rows = getDatabase()
    .prepare(`SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?`)
    .all(ftsQuery) as Array<{ note_id: string }>;
  return new Set(rows.map((row) => row.note_id));
}

function findMatchingNoteIdsForTextTerms(terms: string[]): Set<string> | null {
  const normalizedTerms = terms.map((term) => term.trim()).filter(Boolean);
  if (normalizedTerms.length === 0) {
    return null;
  }
  const matches = new Set<string>();
  for (const term of normalizedTerms) {
    for (const noteId of findMatchingNoteIds(term)) {
      matches.add(noteId);
    }
  }
  return matches;
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
  for (const link of note.links) {
    recordActivityEvent({
      entityType: link.entityType,
      entityId: link.entityId,
      eventType,
      title,
      description: note.contentPlain,
      actor: note.author ?? context.actor ?? null,
      source: context.source,
      metadata: {
        noteId: note.id,
        anchorKey: link.anchorKey ?? ""
      }
    });
    recordEventLog({
      eventKind: eventType,
      entityType: link.entityType,
      entityId: link.entityId,
      actor: note.author ?? context.actor ?? null,
      source: context.source,
      metadata: {
        noteId: note.id,
        anchorKey: link.anchorKey ?? ""
      }
    });
  }
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
    return [];
  }
  const matchingIds = findMatchingNoteIdsForTextTerms([
    ...(parsed.query ? [parsed.query] : []),
    ...parsed.textTerms
  ]);
  return filterNotesByOwnerIds(
    listActiveNotes()
      .filter((note) =>
        parsed.kind ? note.kind === parsed.kind : true
      )
      .filter((note) =>
        parsed.spaceId ? note.spaceId === parsed.spaceId : true
      )
      .filter((note) =>
        parsed.slug
          ? note.slug.toLowerCase() === parsed.slug.toLowerCase()
          : true
      )
      .filter((note) =>
        parsed.author
          ? (note.author ?? "")
              .toLowerCase()
              .includes(parsed.author.toLowerCase())
          : true
      )
      .filter((note) => {
        if (!matchingIds) {
          return true;
        }
        return (
          matchingIds.has(note.id) ||
          parsed.textTerms.some((term) => noteMatchesTextTerm(note, term)) ||
          (parsed.query ? noteMatchesTextTerm(note, parsed.query) : false)
        );
      })
      .filter((note) =>
        linkedFilters.length > 0
          ? note.links.some((link) =>
              linkedFilters.some(
                (filter) =>
                  link.entityType === filter.entityType &&
                  link.entityId === filter.entityId &&
                  (parsed.anchorKey === undefined
                    ? true
                    : (link.anchorKey ?? null) === parsed.anchorKey)
              )
            )
          : true
      )
      .filter((note) =>
        parsed.tags.length > 0
          ? parsed.tags.every((filterTag) =>
              note.tags.some(
                (noteTag) => noteTag.toLowerCase() === filterTag.toLowerCase()
              )
            )
          : true
      )
      .filter((note) => {
        if (!parsed.updatedFrom && !parsed.updatedTo) {
          return true;
        }
        const updatedDate = note.updatedAt.slice(0, 10);
        if (parsed.updatedFrom && updatedDate < parsed.updatedFrom) {
          return false;
        }
        if (parsed.updatedTo && updatedDate > parsed.updatedTo) {
          return false;
        }
        return true;
      })
      .slice(0, parsed.limit ?? 100),
    parsed.userIds
  );
}

export function listNotesByObservedAtRange({
  from,
  to,
  userIds,
  limit = 400
}: {
  from: string;
  to: string;
  userIds?: string[];
  limit?: number;
}) {
  cleanupExpiredNotes();
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return [] as Note[];
  }

  return filterNotesByOwnerIds(listActiveNotes(), userIds)
    .map((note) => ({
      note,
      observedAt: resolveNoteObservedAt(note)
    }))
    .filter(({ observedAt }) => {
      const observedAtMs = Date.parse(observedAt);
      return (
        !Number.isNaN(observedAtMs) &&
        observedAtMs >= fromMs &&
        observedAtMs < toMs
      );
    })
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt))
    .slice(0, limit)
    .map(({ note }) => note);
}

export function createNote(input: CreateNoteInput, context: NoteContext): Note {
  cleanupExpiredNotes();
  const parsed = createNoteSchema.parse({
    ...input,
    links: normalizeLinks(input.links),
    tags: normalizeTags(input.tags)
  });
  const now = new Date().toISOString();
  const id = `note_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
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
  setEntityOwner("note", id, parsed.userId, parsed.author ?? context.actor ?? null);
  clearDeletedEntityRecord("note", id);
  upsertSearchRow(id, contentPlain, parsed.author ?? context.actor ?? null);

  const note = getNoteById(id, { skipCleanup: true })!;
  syncNoteWikiArtifacts(note);
  recordNoteActivity(note, "note.created", "Note added", context);
  return getNoteById(id, { skipCleanup: true })!;
}

export function createLinkedNotes(
  notes: NestedCreateNoteInput[] | undefined,
  entityLink: NoteLink,
  context: NoteContext
): Note[] {
  if (!notes || notes.length === 0) {
    return [];
  }

  return notes.map((note) =>
    createNote(
      {
        kind: "evidence",
        title: "",
        slug: "",
        spaceId: "",
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
        revisionHash: ""
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

  getDatabase()
    .prepare(
      `UPDATE notes
       SET kind = ?, title = ?, slug = ?, space_id = ?, parent_slug = ?, index_order = ?, show_in_index = ?, aliases_json = ?, summary = ?, content_markdown = ?, content_plain = ?, author = ?,
           tags_json = ?, destroy_at = ?, source_path = ?, frontmatter_json = ?, revision_hash = ?, last_synced_at = ?, updated_at = ?
       WHERE id = ?`
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
      noteId
    );

  if (patch.links) {
    replaceLinks(noteId, patch.links, updatedAt);
  }
  if (patch.userId !== undefined) {
    setEntityOwner("note", noteId, patch.userId, nextAuthor ?? context.actor ?? null);
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
  recordNoteActivity(note, "note.updated", "Note updated", context);
  return getNoteById(noteId);
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
  clearDeletedEntityRecord("note", noteId);
  getDatabase().prepare(`DELETE FROM note_links WHERE note_id = ?`).run(noteId);
  getDatabase().prepare(`DELETE FROM notes WHERE id = ?`).run(noteId);
  deleteSearchRow(noteId);
  deleteNoteWikiArtifacts(existing);
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

export function buildNotesSummaryByEntity(): NotesSummaryByEntity {
  cleanupExpiredNotes();
  const rows = getDatabase()
    .prepare(
      `SELECT
         note_links.entity_type AS entity_type,
         note_links.entity_id AS entity_id,
         notes.id AS note_id,
         notes.created_at AS created_at
       FROM note_links
       INNER JOIN notes ON notes.id = note_links.note_id
       LEFT JOIN deleted_entities
         ON deleted_entities.entity_type = 'note'
        AND deleted_entities.entity_id = notes.id
       WHERE deleted_entities.entity_id IS NULL
         AND (notes.destroy_at IS NULL OR notes.destroy_at = '' OR notes.destroy_at > ?)
       ORDER BY notes.created_at DESC`
    )
    .all(new Date().toISOString()) as Array<{
    entity_type: string;
    entity_id: string;
    note_id: string;
    created_at: string;
  }>;

  return rows.reduce<NotesSummaryByEntity>((acc, row) => {
    const key = `${row.entity_type}:${row.entity_id}`;
    const current = acc[key];
    if (!current) {
      acc[key] = {
        count: 1,
        latestNoteId: row.note_id,
        latestCreatedAt: row.created_at
      };
      return acc;
    }
    current.count += 1;
    if (!current.latestCreatedAt || row.created_at > current.latestCreatedAt) {
      current.latestCreatedAt = row.created_at;
      current.latestNoteId = row.note_id;
    }
    return acc;
  }, {});
}

export function unlinkNotesForEntity(
  entityType: CrudEntityType,
  entityId: string,
  context: NoteContext
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
