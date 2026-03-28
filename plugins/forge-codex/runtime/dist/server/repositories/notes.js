import { randomUUID } from "node:crypto";
import { getDatabase } from "../db.js";
import { recordActivityEvent } from "./activity-events.js";
import { filterDeletedEntities, getDeletedEntityRecord, clearDeletedEntityRecord, isEntityDeleted, upsertDeletedEntityRecord } from "./deleted-entities.js";
import { recordEventLog } from "./event-log.js";
import { noteSchema, notesListQuerySchema, createNoteSchema, updateNoteSchema } from "../types.js";
function normalizeAnchorKey(anchorKey) {
    return anchorKey.trim().length > 0 ? anchorKey : null;
}
function normalizeLinks(links) {
    const seen = new Set();
    return links.filter((link) => {
        const key = `${link.entityType}:${link.entityId}:${link.anchorKey ?? ""}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}
function stripMarkdown(markdown) {
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
function describeNote(note) {
    const plain = note.contentPlain.trim() || stripMarkdown(note.contentMarkdown);
    const compact = plain.replace(/\s+/g, " ").trim();
    const title = compact.slice(0, 72) || "Note";
    const subtitle = compact.length > 72 ? compact.slice(72, 168).trim() : "";
    return { title, subtitle };
}
function buildFtsQuery(query) {
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
function getNoteRow(noteId) {
    return getDatabase()
        .prepare(`SELECT id, content_markdown, content_plain, author, source, created_at, updated_at
       FROM notes
       WHERE id = ?`)
        .get(noteId);
}
function listLinkRowsForNotes(noteIds) {
    if (noteIds.length === 0) {
        return [];
    }
    const placeholders = noteIds.map(() => "?").join(", ");
    return getDatabase()
        .prepare(`SELECT note_id, entity_type, entity_id, anchor_key, created_at
       FROM note_links
       WHERE note_id IN (${placeholders})
       ORDER BY created_at ASC`)
        .all(...noteIds);
}
function mapLinks(rows) {
    return rows.map((row) => ({
        entityType: row.entity_type,
        entityId: row.entity_id,
        anchorKey: normalizeAnchorKey(row.anchor_key)
    }));
}
function mapNote(row, linkRows) {
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
function upsertSearchRow(noteId, contentPlain, author) {
    getDatabase().prepare(`DELETE FROM notes_fts WHERE note_id = ?`).run(noteId);
    getDatabase()
        .prepare(`INSERT INTO notes_fts (note_id, content_plain, author) VALUES (?, ?, ?)`)
        .run(noteId, contentPlain, author ?? "");
}
function deleteSearchRow(noteId) {
    getDatabase().prepare(`DELETE FROM notes_fts WHERE note_id = ?`).run(noteId);
}
function listAllNoteRows() {
    return getDatabase()
        .prepare(`SELECT id, content_markdown, content_plain, author, source, created_at, updated_at
       FROM notes
       ORDER BY created_at DESC`)
        .all();
}
function findMatchingNoteIds(query) {
    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) {
        return new Set();
    }
    const rows = getDatabase()
        .prepare(`SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?`)
        .all(ftsQuery);
    return new Set(rows.map((row) => row.note_id));
}
function insertLinks(noteId, links, createdAt) {
    const statement = getDatabase().prepare(`INSERT OR IGNORE INTO note_links (note_id, entity_type, entity_id, anchor_key, created_at)
     VALUES (?, ?, ?, ?, ?)`);
    for (const link of links) {
        statement.run(noteId, link.entityType, link.entityId, link.anchorKey ?? "", createdAt);
    }
}
function replaceLinks(noteId, links, createdAt) {
    getDatabase().prepare(`DELETE FROM note_links WHERE note_id = ?`).run(noteId);
    insertLinks(noteId, links, createdAt);
}
function listNoteLinks(noteId) {
    return getDatabase()
        .prepare(`SELECT note_id, entity_type, entity_id, anchor_key, created_at
       FROM note_links
       WHERE note_id = ?
       ORDER BY created_at ASC`)
        .all(noteId);
}
function recordNoteActivity(note, eventType, title, context) {
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
export function getNoteById(noteId) {
    if (isEntityDeleted("note", noteId)) {
        return undefined;
    }
    const row = getNoteRow(noteId);
    if (!row) {
        return undefined;
    }
    return mapNote(row, listNoteLinks(noteId));
}
export function getNoteByIdIncludingDeleted(noteId) {
    const row = getNoteRow(noteId);
    if (!row) {
        const deleted = getDeletedEntityRecord("note", noteId);
        return deleted?.snapshot;
    }
    return mapNote(row, listNoteLinks(noteId));
}
export function listNotes(query = {}) {
    const parsed = notesListQuerySchema.parse(query);
    if (parsed.linkedEntityType &&
        parsed.linkedEntityId &&
        isEntityDeleted(parsed.linkedEntityType, parsed.linkedEntityId)) {
        return [];
    }
    const matchingIds = parsed.query ? findMatchingNoteIds(parsed.query) : null;
    const rows = listAllNoteRows();
    const linksByNoteId = new Map();
    for (const link of listLinkRowsForNotes(rows.map((row) => row.id))) {
        const current = linksByNoteId.get(link.note_id) ?? [];
        current.push(link);
        linksByNoteId.set(link.note_id, current);
    }
    return filterDeletedEntities("note", rows
        .filter((row) => (matchingIds ? matchingIds.has(row.id) : true))
        .filter((row) => (parsed.author ? (row.author ?? "").toLowerCase().includes(parsed.author.toLowerCase()) : true))
        .map((row) => mapNote(row, linksByNoteId.get(row.id) ?? []))
        .filter((note) => parsed.linkedEntityType && parsed.linkedEntityId
        ? note.links.some((link) => link.entityType === parsed.linkedEntityType &&
            link.entityId === parsed.linkedEntityId &&
            (parsed.anchorKey === undefined ? true : (link.anchorKey ?? null) === parsed.anchorKey))
        : true)
        .slice(0, parsed.limit ?? 100));
}
export function createNote(input, context) {
    const parsed = createNoteSchema.parse({
        ...input,
        links: normalizeLinks(input.links)
    });
    const now = new Date().toISOString();
    const id = `note_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const contentPlain = stripMarkdown(parsed.contentMarkdown);
    getDatabase()
        .prepare(`INSERT INTO notes (id, content_markdown, content_plain, author, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(id, parsed.contentMarkdown, contentPlain, parsed.author ?? context.actor ?? null, context.source, now, now);
    insertLinks(id, parsed.links, now);
    clearDeletedEntityRecord("note", id);
    upsertSearchRow(id, contentPlain, parsed.author ?? context.actor ?? null);
    const note = getNoteById(id);
    recordNoteActivity(note, "note.created", "Note added", context);
    return note;
}
export function createLinkedNotes(notes, entityLink, context) {
    if (!notes || notes.length === 0) {
        return [];
    }
    return notes.map((note) => createNote({
        contentMarkdown: note.contentMarkdown,
        author: note.author,
        links: [entityLink, ...note.links]
    }, context));
}
export function updateNote(noteId, input, context) {
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
        .prepare(`UPDATE notes
       SET content_markdown = ?, content_plain = ?, author = ?, updated_at = ?
       WHERE id = ?`)
        .run(nextMarkdown, nextPlain, nextAuthor, updatedAt, noteId);
    if (patch.links) {
        replaceLinks(noteId, patch.links, updatedAt);
    }
    const note = getNoteByIdIncludingDeleted(noteId);
    if (note.links.length > 0) {
        clearDeletedEntityRecord("note", noteId);
    }
    else {
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
export function deleteNote(noteId, context) {
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
export function buildNotesSummaryByEntity() {
    const rows = getDatabase()
        .prepare(`SELECT
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
       ORDER BY notes.created_at DESC`)
        .all();
    return rows.reduce((acc, row) => {
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
export function unlinkNotesForEntity(entityType, entityId, context) {
    const noteIds = getDatabase()
        .prepare(`SELECT DISTINCT note_id FROM note_links WHERE entity_type = ? AND entity_id = ?`)
        .all(entityType, entityId);
    if (noteIds.length === 0) {
        return;
    }
    getDatabase()
        .prepare(`DELETE FROM note_links WHERE entity_type = ? AND entity_id = ?`)
        .run(entityType, entityId);
    for (const row of noteIds) {
        const remaining = getDatabase()
            .prepare(`SELECT COUNT(*) AS count FROM note_links WHERE note_id = ?`)
            .get(row.note_id);
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
