import { randomUUID } from "node:crypto";
import { getDatabase } from "../db.js";
import { recordActivityEvent } from "./activity-events.js";
import { filterDeletedEntities, getDeletedEntityRecord, clearDeletedEntityRecord, isEntityDeleted, upsertDeletedEntityRecord } from "./deleted-entities.js";
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

type NoteRow = {
  id: string;
  content_markdown: string;
  content_plain: string;
  author: string | null;
  source: ActivitySource;
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

function normalizeLinks(links: CreateNoteInput["links"]): CreateNoteInput["links"] {
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
      `SELECT id, content_markdown, content_plain, author, source, created_at, updated_at
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
  return noteSchema.parse({
    id: row.id,
    contentMarkdown: row.content_markdown,
    contentPlain: row.content_plain,
    author: row.author,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    links: mapLinks(linkRows)
  });
}

function upsertSearchRow(noteId: string, contentPlain: string, author: string | null) {
  getDatabase().prepare(`DELETE FROM notes_fts WHERE note_id = ?`).run(noteId);
  getDatabase()
    .prepare(`INSERT INTO notes_fts (note_id, content_plain, author) VALUES (?, ?, ?)`)
    .run(noteId, contentPlain, author ?? "");
}

function deleteSearchRow(noteId: string) {
  getDatabase().prepare(`DELETE FROM notes_fts WHERE note_id = ?`).run(noteId);
}

function listAllNoteRows(): NoteRow[] {
  return getDatabase()
    .prepare(
      `SELECT id, content_markdown, content_plain, author, source, created_at, updated_at
       FROM notes
       ORDER BY created_at DESC`
    )
    .all() as NoteRow[];
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

function insertLinks(noteId: string, links: CreateNoteInput["links"], createdAt: string) {
  const statement = getDatabase().prepare(
    `INSERT OR IGNORE INTO note_links (note_id, entity_type, entity_id, anchor_key, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const link of links) {
    statement.run(noteId, link.entityType, link.entityId, link.anchorKey ?? "", createdAt);
  }
}

function replaceLinks(noteId: string, links: CreateNoteInput["links"], createdAt: string) {
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

function recordNoteActivity(note: Note, eventType: "note.created" | "note.updated" | "note.deleted", title: string, context: NoteContext) {
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

export function getNoteById(noteId: string): Note | undefined {
  if (isEntityDeleted("note", noteId)) {
    return undefined;
  }
  const row = getNoteRow(noteId);
  if (!row) {
    return undefined;
  }
  return mapNote(row, listNoteLinks(noteId));
}

export function getNoteByIdIncludingDeleted(noteId: string): Note | undefined {
  const row = getNoteRow(noteId);
  if (!row) {
    const deleted = getDeletedEntityRecord("note", noteId);
    return deleted?.snapshot as Note | undefined;
  }
  return mapNote(row, listNoteLinks(noteId));
}

export function listNotes(query: NotesListQuery = {}): Note[] {
  const parsed = notesListQuerySchema.parse(query);
  const linkedFilters = [
    ...(parsed.linkedEntityType && parsed.linkedEntityId
      ? [{ entityType: parsed.linkedEntityType, entityId: parsed.linkedEntityId }]
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
  const rows = listAllNoteRows();
  const linksByNoteId = new Map<string, NoteLinkRow[]>();
  for (const link of listLinkRowsForNotes(rows.map((row) => row.id))) {
    const current = linksByNoteId.get(link.note_id) ?? [];
    current.push(link);
    linksByNoteId.set(link.note_id, current);
  }

  return filterDeletedEntities(
    "note",
    rows
      .filter((row) => (matchingIds ? matchingIds.has(row.id) : true))
      .filter((row) => (parsed.author ? (row.author ?? "").toLowerCase().includes(parsed.author.toLowerCase()) : true))
      .map((row) => mapNote(row, linksByNoteId.get(row.id) ?? []))
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
      .slice(0, parsed.limit ?? 100)
  );
}

export function createNote(input: CreateNoteInput, context: NoteContext): Note {
  const parsed = createNoteSchema.parse({
    ...input,
    links: normalizeLinks(input.links)
  });
  const now = new Date().toISOString();
  const id = `note_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const contentPlain = stripMarkdown(parsed.contentMarkdown);

  getDatabase()
    .prepare(
      `INSERT INTO notes (id, content_markdown, content_plain, author, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, parsed.contentMarkdown, contentPlain, parsed.author ?? context.actor ?? null, context.source, now, now);
  insertLinks(id, parsed.links, now);
  clearDeletedEntityRecord("note", id);
  upsertSearchRow(id, contentPlain, parsed.author ?? context.actor ?? null);

  const note = getNoteById(id)!;
  recordNoteActivity(note, "note.created", "Note added", context);
  return note;
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
        contentMarkdown: note.contentMarkdown,
        author: note.author,
        links: [entityLink, ...note.links]
      },
      context
    )
  );
}

export function updateNote(noteId: string, input: UpdateNoteInput, context: NoteContext): Note | undefined {
  const existing = getNoteByIdIncludingDeleted(noteId);
  if (!existing) {
    return undefined;
  }
  const patch = updateNoteSchema.parse({
    ...input,
    links: input.links ? normalizeLinks(input.links) : undefined
  });
  const nextMarkdown = patch.contentMarkdown ?? existing.contentMarkdown;
  const nextPlain = stripMarkdown(nextMarkdown);
  const nextAuthor = patch.author === undefined ? existing.author : patch.author;
  const updatedAt = new Date().toISOString();

  getDatabase()
    .prepare(
      `UPDATE notes
       SET content_markdown = ?, content_plain = ?, author = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(nextMarkdown, nextPlain, nextAuthor, updatedAt, noteId);

  if (patch.links) {
    replaceLinks(noteId, patch.links, updatedAt);
  }

  const note = getNoteByIdIncludingDeleted(noteId)!;
  if (note.links.length > 0) {
    clearDeletedEntityRecord("note", noteId);
  } else {
    const details = describeNote(note);
    upsertDeletedEntityRecord({
      entityType: "note",
      entityId: note.id,
      title: details.title,
      subtitle: details.subtitle,
      snapshot: note,
      deleteReason: "Note no longer has any linked entities.",
      context
    });
  }
  upsertSearchRow(noteId, nextPlain, nextAuthor);
  recordNoteActivity(note, "note.updated", "Note updated", context);
  return getNoteById(noteId);
}

export function deleteNote(noteId: string, context: NoteContext): Note | undefined {
  const existing = getNoteByIdIncludingDeleted(noteId);
  if (!existing) {
    return undefined;
  }
  getDatabase().prepare(`DELETE FROM note_links WHERE note_id = ?`).run(noteId);
  getDatabase().prepare(`DELETE FROM notes WHERE id = ?`).run(noteId);
  deleteSearchRow(noteId);
  recordNoteActivity(existing, "note.deleted", "Note deleted", context);
  return existing;
}

export function buildNotesSummaryByEntity(): NotesSummaryByEntity {
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
       ORDER BY notes.created_at DESC`
    )
    .all() as Array<{
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

export function unlinkNotesForEntity(entityType: CrudEntityType, entityId: string, context: NoteContext) {
  const noteIds = getDatabase()
    .prepare(`SELECT DISTINCT note_id FROM note_links WHERE entity_type = ? AND entity_id = ?`)
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
    const note = getNoteByIdIncludingDeleted(row.note_id);
    if (!note) {
      continue;
    }
    const details = describeNote(note);
    upsertDeletedEntityRecord({
      entityType: "note",
      entityId: note.id,
      title: details.title,
      subtitle: details.subtitle,
      snapshot: { ...note, links: [] },
      deleteReason: `All links were removed when ${entityType} ${entityId} was deleted.`,
      context
    });
  }
}
