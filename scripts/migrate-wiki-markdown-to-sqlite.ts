import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  closeDatabase,
  configureDatabase,
  configureLegacyWikiAutoImport,
  getDatabase,
  initializeDatabase
} from "../server/src/db.ts";
import { getNoteById } from "../server/src/repositories/notes.ts";
import { syncNoteWikiArtifacts } from "../server/src/repositories/wiki-memory.ts";

type ParsedMarkdownFile = {
  frontmatter: Record<string, unknown>;
  body: string;
};

export type WikiMarkdownMigrationOptions = {
  dataRoot?: string;
  apply?: boolean;
  deleteFiles?: boolean;
};

export type WikiMarkdownMigrationResult = {
  dataRoot: string;
  scanned: number;
  wouldApply: boolean;
  wouldDelete: boolean;
  inserted: number;
  updated: number;
  deleted: number;
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDataRoot = path.resolve(projectRoot, "..", "..", "data", "forge");

function parseArgs(argv: string[]) {
  const options = {
    dataRoot: defaultDataRoot,
    apply: false,
    deleteFiles: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--delete") {
      options.deleteFiles = true;
      continue;
    }
    if (arg === "--data-root") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--data-root requires a path.");
      }
      options.dataRoot = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function parseFrontmatter(markdown: string): ParsedMarkdownFile {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: normalized };
  }
  const frontmatter: Record<string, unknown> = {};
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
    } catch {
      frontmatter[key] = rawValue.replace(/^"(.*)"$/, "$1");
    }
  }
  return { frontmatter, body: match[2] };
}

function slugify(value: string) {
  const normalized = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
  return normalized || "imported-page";
}

function stripMarkdown(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_\-~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferTitle(markdown: string, fallback: string) {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) {
    return heading;
  }
  return fallback.trim() || "Imported wiki page";
}

function inferSummary(markdown: string) {
  return stripMarkdown(markdown).slice(0, 240);
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function normalizeLinkedEntities(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.entityType !== "string" ||
      typeof record.entityId !== "string"
    ) {
      return [];
    }
    return [
      {
        entityType: record.entityType,
        entityId: record.entityId,
        anchorKey:
          typeof record.anchorKey === "string" ? record.anchorKey : ""
      }
    ];
  });
}

async function walkMarkdownFiles(root: string) {
  const results: string[] = [];
  async function visit(directory: string) {
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

function findSpaceForFile(dataRoot: string, filePath: string, parsed: ParsedMarkdownFile) {
  const explicitSpaceId =
    typeof parsed.frontmatter.spaceId === "string"
      ? parsed.frontmatter.spaceId
      : "";
  if (explicitSpaceId) {
    const row = getDatabase()
      .prepare("SELECT id FROM wiki_spaces WHERE id = ?")
      .get(explicitSpaceId) as { id: string } | undefined;
    if (row) {
      return row.id;
    }
  }

  const relative = path.relative(path.join(dataRoot, "wiki"), filePath);
  const parts = relative.split(path.sep);
  if (parts[0] === "shared" && parts[1]) {
    const row = getDatabase()
      .prepare("SELECT id FROM wiki_spaces WHERE visibility = 'shared' AND slug = ?")
      .get(parts[1]) as { id: string } | undefined;
    if (row) {
      return row.id;
    }
  }
  if (parts[0] === "users" && parts[1]) {
    const row = getDatabase()
      .prepare("SELECT id FROM wiki_spaces WHERE owner_user_id = ? OR slug = ?")
      .get(parts[1], parts[1]) as { id: string } | undefined;
    if (row) {
      return row.id;
    }
  }
  return "wiki_space_shared";
}

function findExistingNote(input: {
  id: string;
  spaceId: string;
  slug: string;
}) {
  if (input.id) {
    const byId = getDatabase()
      .prepare("SELECT id FROM notes WHERE id = ?")
      .get(input.id) as { id: string } | undefined;
    if (byId) {
      return byId.id;
    }
  }
  const bySlug = getDatabase()
    .prepare("SELECT id FROM notes WHERE space_id = ? AND slug = ?")
    .get(input.spaceId, input.slug) as { id: string } | undefined;
  return bySlug?.id ?? null;
}

function upsertLinks(noteId: string, links: ReturnType<typeof normalizeLinkedEntities>) {
  getDatabase().prepare("DELETE FROM note_links WHERE note_id = ?").run(noteId);
  const createdAt = new Date().toISOString();
  const statement = getDatabase().prepare(
    `INSERT OR IGNORE INTO note_links (note_id, entity_type, entity_id, anchor_key, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const link of links) {
    statement.run(noteId, link.entityType, link.entityId, link.anchorKey, createdAt);
  }
}

export async function migrateWikiMarkdownToSqlite(
  input: WikiMarkdownMigrationOptions = {}
): Promise<WikiMarkdownMigrationResult> {
  const options = {
    dataRoot: path.resolve(input.dataRoot ?? defaultDataRoot),
    apply: input.apply ?? false,
    deleteFiles: input.deleteFiles ?? false
  };
  const wikiRoot = path.join(options.dataRoot, "wiki");
  configureDatabase({ dataRoot: options.dataRoot, seedDemoData: false });
  configureLegacyWikiAutoImport(false);
  await initializeDatabase();

  let scanned = 0;
  let inserted = 0;
  let updated = 0;
  let deleted = 0;
  const files = await walkMarkdownFiles(wikiRoot);

  try {
    for (const filePath of files) {
      scanned += 1;
      const parsed = parseFrontmatter(await readFile(filePath, "utf8"));
      const kind = filePath.includes(`${path.sep}pages${path.sep}`)
        ? "wiki"
        : "evidence";
      const spaceId = findSpaceForFile(options.dataRoot, filePath, parsed);
      const markdown = parsed.body.trim();
      const id =
        typeof parsed.frontmatter.id === "string" && parsed.frontmatter.id.trim()
          ? parsed.frontmatter.id.trim()
          : `note_${createHash("sha1").update(filePath).digest("hex").slice(0, 10)}`;
      const title =
        typeof parsed.frontmatter.title === "string"
          ? parsed.frontmatter.title
          : inferTitle(markdown, path.basename(filePath, ".md"));
      const slug =
        typeof parsed.frontmatter.slug === "string"
          ? parsed.frontmatter.slug
          : slugify(path.basename(filePath, ".md"));
      const aliases = normalizeStringArray(parsed.frontmatter.aliases);
      const tags = normalizeStringArray(parsed.frontmatter.tags);
      const summary =
        typeof parsed.frontmatter.summary === "string"
          ? parsed.frontmatter.summary
          : inferSummary(markdown);
      const contentPlain = stripMarkdown(markdown);
      const links = normalizeLinkedEntities(parsed.frontmatter.linkedEntities);
      const noteId = findExistingNote({ id, spaceId, slug });
      const now = new Date().toISOString();

      if (options.apply) {
        if (noteId) {
          getDatabase()
            .prepare(
              `UPDATE notes
               SET kind = ?, title = ?, slug = ?, space_id = ?, parent_slug = ?, index_order = ?, show_in_index = ?,
                   aliases_json = ?, summary = ?, content_markdown = ?, content_plain = ?, tags_json = ?,
                   source_path = '', frontmatter_json = ?, updated_at = ?
               WHERE id = ?`
            )
            .run(
              kind,
              title,
              slug,
              spaceId,
              typeof parsed.frontmatter.parentSlug === "string"
                ? parsed.frontmatter.parentSlug
                : null,
              typeof parsed.frontmatter.indexOrder === "number"
                ? Math.trunc(parsed.frontmatter.indexOrder)
                : 0,
              parsed.frontmatter.showInIndex === false ? 0 : 1,
              JSON.stringify(aliases),
              summary,
              markdown,
              contentPlain,
              JSON.stringify(tags),
              JSON.stringify(parsed.frontmatter),
              now,
              noteId
            );
          upsertLinks(noteId, links);
          const note = getNoteById(noteId, { skipCleanup: true });
          if (note) {
            syncNoteWikiArtifacts(note);
          }
          updated += 1;
        } else {
          getDatabase()
            .prepare(
              `INSERT INTO notes (
                id, kind, title, slug, space_id, parent_slug, index_order, show_in_index, aliases_json, summary,
                content_markdown, content_plain, author, source, tags_json, destroy_at, source_path, frontmatter_json,
                revision_hash, last_synced_at, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, '', NULL, ?, ?)`
            )
            .run(
              id,
              kind,
              title,
              slug,
              spaceId,
              typeof parsed.frontmatter.parentSlug === "string"
                ? parsed.frontmatter.parentSlug
                : null,
              typeof parsed.frontmatter.indexOrder === "number"
                ? Math.trunc(parsed.frontmatter.indexOrder)
                : 0,
              parsed.frontmatter.showInIndex === false ? 0 : 1,
              JSON.stringify(aliases),
              summary,
              markdown,
              contentPlain,
              typeof parsed.frontmatter.author === "string"
                ? parsed.frontmatter.author
                : null,
              "system",
              JSON.stringify(tags),
              null,
              JSON.stringify(parsed.frontmatter),
              now,
              now
            );
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
      } else if (noteId) {
        updated += 1;
      } else {
        inserted += 1;
      }
    }

    return {
      dataRoot: options.dataRoot,
      scanned,
      wouldApply: options.apply,
      wouldDelete: options.deleteFiles,
      inserted,
      updated,
      deleted
    };
  } finally {
    closeDatabase();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrateWikiMarkdownToSqlite(parseArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error);
      closeDatabase();
      process.exit(1);
    });
}
