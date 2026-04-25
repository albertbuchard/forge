import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { getDatabase, getEffectiveDataRoot } from "../db.js";
import { getNoteById } from "../repositories/notes.js";
import { syncNoteWikiArtifacts } from "../repositories/wiki-memory.js";
const startupImportMarkerId = "runtime:legacy-wiki-markdown-import:v1";
function parseFrontmatter(markdown) {
    const normalized = markdown.replace(/\r\n/g, "\n");
    const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) {
        return { frontmatter: {}, body: normalized };
    }
    const frontmatter = {};
    for (const line of match[1].split("\n")) {
        const separatorIndex = line.indexOf(":");
        if (separatorIndex <= 0) {
            throw new Error(`Malformed frontmatter line: ${line}`);
        }
        const key = line.slice(0, separatorIndex).trim();
        const rawValue = line.slice(separatorIndex + 1).trim();
        if (!key) {
            throw new Error(`Malformed empty frontmatter key: ${line}`);
        }
        try {
            frontmatter[key] = JSON.parse(rawValue);
        }
        catch {
            frontmatter[key] = rawValue.replace(/^"(.*)"$/, "$1");
        }
    }
    return { frontmatter, body: match[2] };
}
function slugify(value) {
    const normalized = value
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/[\s_]+/g, "-")
        .replace(/-+/g, "-");
    return normalized || "imported-page";
}
function stripMarkdown(markdown) {
    return markdown
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/[#>*_\-~]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function inferTitle(markdown, fallback) {
    const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
    return heading || fallback.trim() || "Imported wiki page";
}
function inferSummary(markdown) {
    return stripMarkdown(markdown).slice(0, 240);
}
function normalizeStringArray(value) {
    return Array.isArray(value)
        ? value.filter((entry) => typeof entry === "string")
        : [];
}
function normalizeLinkedEntities(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return [];
        }
        const record = entry;
        if (typeof record.entityType !== "string" ||
            typeof record.entityId !== "string") {
            return [];
        }
        return [
            {
                entityType: record.entityType,
                entityId: record.entityId,
                anchorKey: typeof record.anchorKey === "string" ? record.anchorKey : ""
            }
        ];
    });
}
async function walkMarkdownFiles(root) {
    const results = [];
    async function visit(directory) {
        if (!existsSync(directory)) {
            return;
        }
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                await visit(entryPath);
                continue;
            }
            if (entry.isFile() && entry.name.endsWith(".md")) {
                results.push(entryPath);
            }
        }
    }
    await visit(root);
    return results.sort();
}
function findSpaceForFile(dataRoot, filePath, parsed) {
    const explicitSpaceId = typeof parsed.frontmatter.spaceId === "string"
        ? parsed.frontmatter.spaceId
        : "";
    if (explicitSpaceId) {
        const row = getDatabase()
            .prepare("SELECT id FROM wiki_spaces WHERE id = ?")
            .get(explicitSpaceId);
        if (row) {
            return row.id;
        }
    }
    const relative = path.relative(path.join(dataRoot, "wiki"), filePath);
    const parts = relative.split(path.sep);
    if (parts[0] === "shared" && parts[1]) {
        const row = getDatabase()
            .prepare("SELECT id FROM wiki_spaces WHERE visibility = 'shared' AND slug = ?")
            .get(parts[1]);
        if (row) {
            return row.id;
        }
    }
    if (parts[0] === "users" && parts[1]) {
        const row = getDatabase()
            .prepare("SELECT id FROM wiki_spaces WHERE owner_user_id = ? OR slug = ?")
            .get(parts[1], parts[1]);
        if (row) {
            return row.id;
        }
        return ensurePersonalWikiSpaceForLegacyUser(parts[1]);
    }
    return "wiki_space_shared";
}
function findExistingNote(input) {
    if (input.id) {
        const byId = getDatabase()
            .prepare("SELECT id FROM notes WHERE id = ?")
            .get(input.id);
        if (byId) {
            return byId.id;
        }
    }
    const bySlug = getDatabase()
        .prepare("SELECT id FROM notes WHERE space_id = ? AND slug = ?")
        .get(input.spaceId, input.slug);
    return bySlug?.id ?? null;
}
function ensurePersonalWikiSpaceForLegacyUser(userId) {
    const row = getDatabase()
        .prepare(`SELECT id FROM wiki_spaces
       WHERE owner_user_id = ? OR slug = ? OR slug = ? OR id = ?
       ORDER BY created_at ASC
       LIMIT 1`)
        .get(userId, userId, `user-${slugify(userId)}`, `wiki_space_user_${slugify(userId)}`);
    if (row) {
        return row.id;
    }
    const now = new Date().toISOString();
    const id = `wiki_space_user_${slugify(userId)}`;
    getDatabase()
        .prepare(`INSERT INTO wiki_spaces (id, slug, label, description, owner_user_id, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`)
        .run(id, `user-${slugify(userId)}`, `${userId} Wiki`, "Personal Forge wiki space recovered from legacy wiki files.", userId, "personal", now, now);
    const inserted = getDatabase()
        .prepare("SELECT id FROM wiki_spaces WHERE id = ?")
        .get(id);
    return inserted?.id ?? "wiki_space_shared";
}
function upsertLinks(noteId, links) {
    getDatabase().prepare("DELETE FROM note_links WHERE note_id = ?").run(noteId);
    const createdAt = new Date().toISOString();
    const statement = getDatabase().prepare(`INSERT OR IGNORE INTO note_links (note_id, entity_type, entity_id, anchor_key, created_at)
     VALUES (?, ?, ?, ?, ?)`);
    for (const link of links) {
        statement.run(noteId, link.entityType, link.entityId, link.anchorKey, createdAt);
    }
}
function legacyBackupPath(dataRoot, backupLabel) {
    return path.join(dataRoot, "backups", backupLabel, "wiki");
}
async function backupWikiRootOnce(input) {
    const backupPath = legacyBackupPath(input.dataRoot, input.backupLabel);
    if (existsSync(backupPath)) {
        return { backupPath, backedUp: false };
    }
    await mkdir(path.dirname(backupPath), { recursive: true });
    await cp(input.wikiRoot, backupPath, { recursive: true, force: false });
    return { backupPath, backedUp: true };
}
export async function importLegacyWikiMarkdownToSqlite(input = {}) {
    const options = {
        dataRoot: path.resolve(input.dataRoot ?? getEffectiveDataRoot()),
        apply: input.apply ?? false,
        deleteFiles: input.deleteFiles ?? false,
        backupBeforeApply: input.backupBeforeApply ?? false,
        backupLabel: input.backupLabel ?? "legacy-wiki-markdown-pre-sqlite-import",
        preserveExistingNotes: input.preserveExistingNotes ?? false
    };
    const wikiRoot = path.join(options.dataRoot, "wiki");
    const files = await walkMarkdownFiles(wikiRoot);
    let scanned = 0;
    let inserted = 0;
    let updated = 0;
    let deleted = 0;
    let backupPath = legacyBackupPath(options.dataRoot, options.backupLabel);
    let backedUp = false;
    if (options.apply && options.backupBeforeApply && files.length > 0) {
        const backup = await backupWikiRootOnce({
            wikiRoot,
            dataRoot: options.dataRoot,
            backupLabel: options.backupLabel
        });
        backupPath = backup.backupPath;
        backedUp = backup.backedUp;
    }
    for (const filePath of files) {
        scanned += 1;
        const parsed = parseFrontmatter(await readFile(filePath, "utf8"));
        const kind = filePath.includes(`${path.sep}pages${path.sep}`)
            ? "wiki"
            : "evidence";
        const spaceId = findSpaceForFile(options.dataRoot, filePath, parsed);
        const markdown = parsed.body.trim();
        const id = typeof parsed.frontmatter.id === "string" && parsed.frontmatter.id.trim()
            ? parsed.frontmatter.id.trim()
            : `note_${createHash("sha1").update(filePath).digest("hex").slice(0, 10)}`;
        const title = typeof parsed.frontmatter.title === "string"
            ? parsed.frontmatter.title
            : inferTitle(markdown, path.basename(filePath, ".md"));
        const slug = typeof parsed.frontmatter.slug === "string"
            ? parsed.frontmatter.slug
            : slugify(path.basename(filePath, ".md"));
        const aliases = normalizeStringArray(parsed.frontmatter.aliases);
        const tags = normalizeStringArray(parsed.frontmatter.tags);
        const summary = typeof parsed.frontmatter.summary === "string"
            ? parsed.frontmatter.summary
            : inferSummary(markdown);
        const contentPlain = stripMarkdown(markdown);
        const links = normalizeLinkedEntities(parsed.frontmatter.linkedEntities);
        const noteId = findExistingNote({ id, spaceId, slug });
        const now = new Date().toISOString();
        if (!options.apply) {
            if (noteId) {
                updated += 1;
            }
            else {
                inserted += 1;
            }
            continue;
        }
        if (noteId) {
            const existingNote = getNoteById(noteId, { skipCleanup: true });
            if (options.preserveExistingNotes &&
                existingNote &&
                existingNote.contentMarkdown.trim().length > 0) {
                getDatabase()
                    .prepare("UPDATE notes SET source_path = '' WHERE id = ? AND source_path <> ''")
                    .run(noteId);
                syncNoteWikiArtifacts(existingNote);
                updated += 1;
                continue;
            }
            getDatabase()
                .prepare(`UPDATE notes
           SET kind = ?, title = ?, slug = ?, space_id = ?, parent_slug = ?, index_order = ?, show_in_index = ?,
               aliases_json = ?, summary = ?, content_markdown = ?, content_plain = ?, tags_json = ?,
               source_path = '', frontmatter_json = ?, updated_at = ?
           WHERE id = ?`)
                .run(kind, title, slug, spaceId, typeof parsed.frontmatter.parentSlug === "string"
                ? parsed.frontmatter.parentSlug
                : null, typeof parsed.frontmatter.indexOrder === "number"
                ? Math.trunc(parsed.frontmatter.indexOrder)
                : 0, parsed.frontmatter.showInIndex === false ? 0 : 1, JSON.stringify(aliases), summary, markdown, contentPlain, JSON.stringify(tags), JSON.stringify(parsed.frontmatter), now, noteId);
            upsertLinks(noteId, links);
            const note = getNoteById(noteId, { skipCleanup: true });
            if (note) {
                syncNoteWikiArtifacts(note);
            }
            updated += 1;
        }
        else {
            getDatabase()
                .prepare(`INSERT INTO notes (
            id, kind, title, slug, space_id, parent_slug, index_order, show_in_index, aliases_json, summary,
            content_markdown, content_plain, author, source, tags_json, destroy_at, source_path, frontmatter_json,
            revision_hash, last_synced_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, '', NULL, ?, ?)`)
                .run(id, kind, title, slug, spaceId, typeof parsed.frontmatter.parentSlug === "string"
                ? parsed.frontmatter.parentSlug
                : null, typeof parsed.frontmatter.indexOrder === "number"
                ? Math.trunc(parsed.frontmatter.indexOrder)
                : 0, parsed.frontmatter.showInIndex === false ? 0 : 1, JSON.stringify(aliases), summary, markdown, contentPlain, typeof parsed.frontmatter.author === "string"
                ? parsed.frontmatter.author
                : null, "system", JSON.stringify(tags), null, JSON.stringify(parsed.frontmatter), now, now);
            upsertLinks(id, links);
            const note = getNoteById(id, { skipCleanup: true });
            if (note) {
                syncNoteWikiArtifacts(note);
            }
            inserted += 1;
        }
        if (options.deleteFiles) {
            await rm(filePath, { force: true });
            deleted += 1;
        }
    }
    return {
        dataRoot: options.dataRoot,
        scanned,
        wouldApply: options.apply,
        wouldDelete: options.deleteFiles,
        inserted,
        updated,
        deleted,
        backupPath,
        backedUp,
        skippedAlreadyImported: false
    };
}
function hasStartupImportMarker() {
    const row = getDatabase()
        .prepare("SELECT id FROM migrations WHERE id = ?")
        .get(startupImportMarkerId);
    return Boolean(row);
}
function markStartupImportComplete() {
    getDatabase()
        .prepare("INSERT OR IGNORE INTO migrations (id, applied_at) VALUES (?, ?)")
        .run(startupImportMarkerId, new Date().toISOString());
}
export async function importLegacyWikiMarkdownOnStartup(dataRoot = getEffectiveDataRoot()) {
    if (hasStartupImportMarker()) {
        return {
            dataRoot: path.resolve(dataRoot),
            scanned: 0,
            wouldApply: true,
            wouldDelete: false,
            inserted: 0,
            updated: 0,
            deleted: 0,
            backupPath: legacyBackupPath(path.resolve(dataRoot), "legacy-wiki-markdown-pre-sqlite-import"),
            backedUp: false,
            skippedAlreadyImported: true
        };
    }
    const result = await importLegacyWikiMarkdownToSqlite({
        dataRoot,
        apply: true,
        deleteFiles: false,
        backupBeforeApply: true,
        preserveExistingNotes: true
    });
    markStartupImportComplete();
    return result;
}
