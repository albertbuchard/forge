import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  closeDatabase,
  configureDatabase,
  configureLegacyWikiAutoImport,
  getDatabase,
  initializeDatabase
} from "../server/src/db.ts";
import { getWikiSettingsPayload } from "../server/src/repositories/wiki-memory.ts";
import { migrateWikiMarkdownToSqlite } from "./migrate-wiki-markdown-to-sqlite.ts";

async function withTempForgeDataRoot(
  prefix: string,
  operation: (rootDir: string) => Promise<void>
) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await operation(rootDir);
  } finally {
    configureLegacyWikiAutoImport(true);
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
}

async function writeWikiMarkdown(
  rootDir: string,
  relativePath: string,
  markdown: string
) {
  const filePath = path.join(rootDir, "wiki", relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, markdown);
  return filePath;
}

test("wiki markdown migration imports a missing page into SQLite and deletes the file when applied", async () => {
  await withTempForgeDataRoot("forge-wiki-md-missing-", async (rootDir) => {
    const filePath = await writeWikiMarkdown(
      rootDir,
      "shared/shared/pages/imported-page.md",
      `---
id: "note_imported_page"
title: "Imported Page"
slug: "imported-page"
spaceId: "wiki_space_shared"
tags: ["migration"]
---
# Imported Page

This page only existed on disk before the migration.
`
    );

    const dryRun = await migrateWikiMarkdownToSqlite({ dataRoot: rootDir });
    assert.deepEqual(
      {
        scanned: dryRun.scanned,
        inserted: dryRun.inserted,
        updated: dryRun.updated,
        deleted: dryRun.deleted
      },
      { scanned: 1, inserted: 1, updated: 0, deleted: 0 }
    );
    assert.equal(existsSync(filePath), true);

    const applied = await migrateWikiMarkdownToSqlite({
      dataRoot: rootDir,
      apply: true,
      deleteFiles: true
    });
    assert.equal(applied.inserted, 1);
    assert.equal(applied.deleted, 1);
    assert.equal(existsSync(filePath), false);

    configureDatabase({ dataRoot: rootDir, seedDemoData: false });
    const row = getDatabase()
      .prepare("SELECT title, source_path, content_markdown FROM notes WHERE id = ?")
      .get("note_imported_page") as
      | { title: string; source_path: string; content_markdown: string }
      | undefined;
    assert.equal(row?.title, "Imported Page");
    assert.equal(row?.source_path, "");
    assert.match(row?.content_markdown ?? "", /only existed on disk/);
  });
});

test("wiki markdown migration recognizes an existing SQLite page without duplicating it", async () => {
  await withTempForgeDataRoot("forge-wiki-md-existing-", async (rootDir) => {
    configureDatabase({ dataRoot: rootDir, seedDemoData: false });
    await initializeDatabase();
    getDatabase()
      .prepare(
        `INSERT INTO notes (
          id, kind, title, slug, space_id, parent_slug, index_order, show_in_index,
          aliases_json, summary, content_markdown, content_plain, author, source,
          tags_json, destroy_at, source_path, frontmatter_json, revision_hash,
          last_synced_at, created_at, updated_at
        ) VALUES (?, 'wiki', ?, ?, 'wiki_space_shared', NULL, 0, 1, '[]', '',
          ?, ?, NULL, 'system', '[]', NULL, '', '{}', '', NULL, ?, ?)`
      )
      .run(
        "note_existing_page",
        "Existing Page",
        "existing-page",
        "Old body",
        "Old body",
        new Date().toISOString(),
        new Date().toISOString()
      );
    closeDatabase();

    await writeWikiMarkdown(
      rootDir,
      "shared/shared/pages/existing-page.md",
      `---
id: "note_existing_page"
title: "Existing Page Updated"
slug: "existing-page"
spaceId: "wiki_space_shared"
---
# Existing Page Updated

Updated from disk.
`
    );

    const result = await migrateWikiMarkdownToSqlite({ dataRoot: rootDir });
    assert.equal(result.scanned, 1);
    assert.equal(result.inserted, 0);
    assert.equal(result.updated, 1);

    configureDatabase({ dataRoot: rootDir, seedDemoData: false });
    const count = getDatabase()
      .prepare("SELECT COUNT(*) as count FROM notes WHERE slug = ?")
      .get("existing-page") as { count: number };
    assert.equal(count.count, 1);
  });
});

test("wiki markdown migration fails loudly on malformed frontmatter before deletion", async () => {
  await withTempForgeDataRoot("forge-wiki-md-malformed-", async (rootDir) => {
    const filePath = await writeWikiMarkdown(
      rootDir,
      "shared/shared/pages/bad.md",
      `---
id "missing colon"
---
# Broken
`
    );

    await assert.rejects(
      migrateWikiMarkdownToSqlite({
        dataRoot: rootDir,
        apply: true,
        deleteFiles: true
      }),
      /Malformed frontmatter line/
    );
    assert.equal(existsSync(filePath), true);
  });
});

test("database startup automatically backs up and imports legacy wiki markdown without deleting files", async () => {
  await withTempForgeDataRoot("forge-wiki-md-startup-", async (rootDir) => {
    const filePath = await writeWikiMarkdown(
      rootDir,
      "shared/shared/pages/albert-buchard.md",
      `---
id: "note_albert_buchard"
title: "Albert Buchard"
slug: "albert-buchard"
spaceId: "wiki_space_shared"
---
# Albert Buchard

Recovered person page that must survive plugin upgrades.
`
    );

    configureDatabase({ dataRoot: rootDir, seedDemoData: false });
    configureLegacyWikiAutoImport(true);
    await initializeDatabase();

    const row = getDatabase()
      .prepare(
        "SELECT title, kind, content_markdown FROM notes WHERE slug = ?"
      )
      .get("albert-buchard") as
      | { title: string; kind: string; content_markdown: string }
      | undefined;
    assert.equal(row?.title, "Albert Buchard");
    assert.equal(row?.kind, "wiki");
    assert.match(row?.content_markdown ?? "", /survive plugin upgrades/);
    assert.equal(existsSync(filePath), true);
    assert.equal(
      existsSync(
        path.join(
          rootDir,
          "backups",
          "legacy-wiki-markdown-pre-sqlite-import",
          "wiki",
          "shared",
          "shared",
          "pages",
          "albert-buchard.md"
        )
      ),
      true
    );

    getDatabase()
      .prepare("UPDATE notes SET content_markdown = ? WHERE slug = ?")
      .run("# Albert Buchard\n\nEdited in SQLite after upgrade.", "albert-buchard");
    closeDatabase();

    configureDatabase({ dataRoot: rootDir, seedDemoData: false });
    configureLegacyWikiAutoImport(true);
    await initializeDatabase();

    const editedRow = getDatabase()
      .prepare("SELECT content_markdown FROM notes WHERE slug = ?")
      .get("albert-buchard") as { content_markdown: string } | undefined;
    assert.match(editedRow?.content_markdown ?? "", /Edited in SQLite/);
    assert.doesNotMatch(editedRow?.content_markdown ?? "", /survive plugin upgrades/);
  });
});

test("wiki settings list the shared populated space before personal spaces", async () => {
  await withTempForgeDataRoot("forge-wiki-md-shared-first-", async (rootDir) => {
    configureDatabase({ dataRoot: rootDir, seedDemoData: false });
    configureLegacyWikiAutoImport(false);
    await initializeDatabase();
    getDatabase()
      .prepare(
        `INSERT INTO wiki_spaces (id, slug, label, description, owner_user_id, visibility, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "wiki_space_user_user-operator",
        "user-user-operator",
        "user_operator Wiki",
        "Personal Forge wiki space.",
        "user_operator",
        "personal",
        "2099-01-01T00:00:00.000Z",
        "2099-01-01T00:00:00.000Z"
      );

    const settings = getWikiSettingsPayload();
    assert.equal(settings.spaces[0]?.id, "wiki_space_shared");
    assert.equal(settings.spaces[1]?.id, "wiki_space_user_user-operator");
  });
});
