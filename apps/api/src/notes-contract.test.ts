import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  closeDatabase,
  configureDatabase,
  configureLegacyWikiAutoImport,
  getDatabase,
  initializeDatabase
} from "./db.js";
import { HttpError } from "./errors.js";
import { listActivityEvents } from "./repositories/activity-events.js";
import { getDeletedEntityRecord } from "./repositories/deleted-entities.js";
import {
  EXPIRED_NOTE_CLEANUP_BATCH_SIZE,
  buildNotesSummaryByEntity,
  cleanupExpiredNotes,
  createNote,
  filterNoteActivityEventsForScope,
  getNoteById,
  listNotesPage,
  noteMatchesSearchQuery,
  updateNote
} from "./repositories/notes.js";
import { deleteEntity, restoreEntity } from "./services/entity-crud.js";

const context = { source: "ui" as const, actor: "Notes contract test" };

async function withTemporaryDatabase(
  operation: (rootDir: string) => void | Promise<void>
): Promise<void> {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-notes-contract-")
  );
  configureDatabase({ dataRoot: rootDir, seedDemoData: false });
  configureLegacyWikiAutoImport(false);
  await initializeDatabase();
  try {
    await operation(rootDir);
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
}

function createTestNote(input: {
  contentMarkdown: string;
  title?: string;
  summary?: string;
  author?: string;
  tags?: string[];
  observedAt?: string;
  userId?: string;
  links?: Array<{
    entityType: "goal" | "project" | "note" | "psyche_value";
    entityId: string;
    anchorKey?: string | null;
  }>;
}) {
  return createNote(
    {
      kind: "evidence",
      contentMarkdown: input.contentMarkdown,
      title: input.title,
      slug: "",
      indexOrder: 0,
      aliases: [],
      summary: input.summary ?? "",
      author: input.author ?? "Albert",
      tags: input.tags ?? [],
      destroyAt: null,
      sourcePath: "",
      frontmatter: input.observedAt ? { observedAt: input.observedAt } : {},
      revisionHash: "",
      userId: input.userId ?? "user_operator",
      links: (input.links ?? []).map((link) => ({
        ...link,
        anchorKey: link.anchorKey ?? null
      }))
    },
    context
  );
}

function insertWikiMediaAsset(input: {
  id: string;
  spaceId: string;
  noteId?: string | null;
  transcriptNoteId?: string | null;
}) {
  const now = "2026-07-16T12:00:00.000Z";
  getDatabase()
    .prepare(
      `INSERT INTO wiki_media_assets (
         id, space_id, note_id, label, mime_type, file_name, file_path,
         size_bytes, checksum, transcript_note_id, metadata_json, created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, 'text/plain', ?, ?, 8, ?, ?, '{}', ?, ?)`
    )
    .run(
      input.id,
      input.spaceId,
      input.noteId ?? null,
      input.id,
      `${input.id}.txt`,
      `/tmp/${input.id}.txt`,
      `${input.id}-checksum`,
      input.transcriptNoteId ?? null,
      now,
      now
    );
}

async function startLockedExpiryExtension(input: {
  databasePath: string;
  noteId: string;
  destroyAt: string;
}) {
  const workerScript = `
    import { DatabaseSync } from "node:sqlite";
    const database = new DatabaseSync(process.env.FORGE_RACE_DATABASE_PATH);
    database.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE;");
    database.prepare("UPDATE notes SET destroy_at = ? WHERE id = ?").run(
      process.env.FORGE_RACE_DESTROY_AT,
      process.env.FORGE_RACE_NOTE_ID
    );
    process.stdout.write("locked\\n");
    setTimeout(() => {
      database.exec("COMMIT");
      database.close();
    }, 250);
  `;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", workerScript],
    {
      env: {
        ...process.env,
        FORGE_RACE_DATABASE_PATH: input.databasePath,
        FORGE_RACE_NOTE_ID: input.noteId,
        FORGE_RACE_DESTROY_AT: input.destroyAt
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const completed = new Promise<number | null>((resolve) => {
    child.once("close", resolve);
  });
  await new Promise<void>((resolve, reject) => {
    const poll = () => {
      if (stdout.includes("locked\n")) {
        resolve();
        return;
      }
      if (child.exitCode !== null) {
        reject(
          new Error(
            `Expiry race worker exited before locking (${child.exitCode}): ${stderr}`
          )
        );
        return;
      }
      setTimeout(poll, 5);
    };
    child.once("error", reject);
    poll();
  });
  return {
    child,
    async waitForCompletion() {
      const exitCode = await completed;
      assert.equal(exitCode, 0, stderr);
    }
  };
}

function seedAuxiliaryNotePersistence(note: { id: string; spaceId: string }) {
  const now = "2026-07-16T12:00:00.000Z";
  const suffix = note.id.replaceAll("-", "_");
  getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO wiki_embedding_profiles (
         id, label, provider, base_url, model, dimensions, chunk_size,
         chunk_overlap, enabled, metadata_json, created_at, updated_at
       ) VALUES (?, 'Contract profile', 'local', '', 'contract-model', 3, 1200,
                 200, 1, '{}', ?, ?)`
    )
    .run(`profile_${suffix}`, now, now);
  getDatabase()
    .prepare(
      `INSERT INTO wiki_embedding_chunks (
         id, note_id, space_id, profile_id, chunk_key, heading_path,
         content_text, vector_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'chunk-1', '', 'contract evidence', '[0,0,0]', ?, ?)`
    )
    .run(
      `chunk_${suffix}`,
      note.id,
      note.spaceId,
      `profile_${suffix}`,
      now,
      now
    );
  getDatabase()
    .prepare(
      `INSERT INTO wiki_media_assets (
         id, space_id, note_id, label, mime_type, file_name, file_path,
         size_bytes, checksum, transcript_note_id, metadata_json, created_at,
         updated_at
       ) VALUES (?, ?, ?, 'Contract media', 'text/plain', 'contract.txt', ?,
                 8, 'contract-checksum', ?, '{}', ?, ?)`
    )
    .run(
      `media_${suffix}`,
      note.spaceId,
      note.id,
      `/tmp/${suffix}.txt`,
      note.id,
      now,
      now
    );
  getDatabase()
    .prepare(
      `INSERT INTO wiki_link_edges (
         source_note_id, target_type, target_entity_type, target_entity_id,
         label, raw_target, is_embed, created_at, updated_at
       ) VALUES (?, 'entity', 'goal', ?, 'Contract goal', ?, 0, ?, ?)`
    )
    .run(note.id, `goal_${suffix}`, `goal:${suffix}`, now, now);
  getDatabase()
    .prepare(
      `INSERT INTO entity_assignments (
         entity_type, entity_id, user_id, role, created_at, updated_at
       ) VALUES ('note', ?, 'user_forge_bot', 'assignee', ?, ?)`
    )
    .run(note.id, now, now);
}

function notePersistenceCounts(noteId: string) {
  const count = (sql: string, ...parameters: string[]) =>
    (
      getDatabase()
        .prepare(sql)
        .get(...parameters) as { count: number }
    ).count;
  return {
    notes: count(`SELECT COUNT(*) AS count FROM notes WHERE id = ?`, noteId),
    links: count(
      `SELECT COUNT(*) AS count FROM note_links WHERE note_id = ?`,
      noteId
    ),
    owners: count(
      `SELECT COUNT(*) AS count FROM entity_owners
       WHERE entity_type = 'note' AND entity_id = ?`,
      noteId
    ),
    assignments: count(
      `SELECT COUNT(*) AS count FROM entity_assignments
       WHERE entity_type = 'note' AND entity_id = ?`,
      noteId
    ),
    search: count(
      `SELECT COUNT(*) AS count FROM notes_fts WHERE note_id = ?`,
      noteId
    ),
    wikiSearch: count(
      `SELECT COUNT(*) AS count FROM wiki_pages_fts WHERE note_id = ?`,
      noteId
    ),
    wikiEdges: count(
      `SELECT COUNT(*) AS count FROM wiki_link_edges
       WHERE source_note_id = ? OR target_note_id = ?`,
      noteId,
      noteId
    ),
    embeddingChunks: count(
      `SELECT COUNT(*) AS count FROM wiki_embedding_chunks WHERE note_id = ?`,
      noteId
    ),
    mediaAssets: count(
      `SELECT COUNT(*) AS count FROM wiki_media_assets
       WHERE note_id = ? OR transcript_note_id = ?`,
      noteId,
      noteId
    ),
    deletedEntities: count(
      `SELECT COUNT(*) AS count FROM deleted_entities
       WHERE entity_type = 'note' AND entity_id = ?`,
      noteId
    )
  };
}

test("note search applies exact filters and authorization scope before the page bound", async () => {
  await withTemporaryDatabase(() => {
    const matching = createTestNote({
      title: "Alpine thesis plan",
      contentMarkdown: "# Evidence\n\nRobust inference for the final analysis.",
      author: "Albert Buchard",
      tags: ["Research", "Priority"],
      observedAt: "2026-07-12T09:30:00.000Z",
      links: [{ entityType: "goal", entityId: "goal_thesis" }]
    });
    createTestNote({
      title: "Alpine travel",
      contentMarkdown: "Cinema plans after the train.",
      tags: ["Research"],
      observedAt: "2026-07-12T12:00:00.000Z",
      links: [{ entityType: "goal", entityId: "goal_holiday" }]
    });
    const foreign = createTestNote({
      title: "Alpine thesis plan from another owner",
      contentMarkdown: "Robust inference should not leak across owner scope.",
      tags: ["Research", "Priority"],
      observedAt: "2026-07-12T10:00:00.000Z",
      userId: "user_forge_bot",
      links: [{ entityType: "goal", entityId: "goal_thesis" }]
    });
    createTestNote({
      title: "Private Psyche evidence",
      contentMarkdown: "Robust inference for a sensitive belief.",
      tags: ["Research", "Priority"],
      observedAt: "2026-07-12T10:00:00.000Z",
      links: [{ entityType: "psyche_value", entityId: "value_private" }]
    });

    const page = listNotesPage(
      {
        query: "alpine inference",
        tags: ["research", "PRIORITY"],
        linkedTo: [{ entityType: "goal", entityId: "goal_thesis" }],
        observedFrom: "2026-07-12",
        observedTo: "2026-07-12",
        userIds: ["user_operator"],
        limit: 20
      },
      {
        accessibleSpaceIds: [matching.spaceId, foreign.spaceId],
        includePsyche: false
      }
    );

    assert.equal(page.total, 1);
    assert.deepEqual(
      page.notes.map((note) => note.id),
      [matching.id]
    );
    assert.equal(page.hasMore, false);
    assert.equal(page.nextCursor, null);

    const orTerms = listNotesPage({
      textTerms: ["cinema", "does-not-exist"],
      userIds: ["user_operator"],
      limit: 20
    });
    assert.equal(orTerms.total, 1);
    assert.equal(orTerms.notes[0]?.title, "Alpine travel");

    const inaccessible = listNotesPage(
      { userIds: ["user_operator"] },
      { accessibleSpaceIds: [] }
    );
    assert.equal(inaccessible.total, 0);
  });
});

test("live and deleted Note search share one NFKC infix contract", async () => {
  await withTemporaryDatabase(() => {
    const note = createTestNote({
      title: "ＫＮＯＷＴｉｔｌｅＳｅｎｔｉｎｅｌ",
      summary: "BeforeSummaryInfixAfter",
      contentMarkdown: "ContentPrefixSentinel and BeforeContentInfixAfter.",
      author: "AuthorPrefixSentinel BeforeAuthorInfixAfter",
      tags: ["TagSearchSentinel"],
      links: [
        {
          entityType: "goal",
          entityId: "goal_LinkSearchSentinel",
          anchorKey: "AnchorSearchSentinel"
        }
      ]
    });
    const queries = [
      "knowtitlesentinel",
      "summaryinfix",
      "contentprefix",
      "contentinfix",
      "authorprefix",
      "authorinfix",
      "tagsearchsentinel",
      "linksearchsentinel",
      "anchorsearchsentinel"
    ];

    for (const query of queries) {
      assert.deepEqual(
        listNotesPage({ query, limit: 20 }).notes.map((match) => match.id),
        [note.id],
        `live Note query ${query}`
      );
    }

    assert.equal(deleteEntity("note", note.id, {}, context)?.id, note.id);
    const deletedRecord = getDeletedEntityRecord("note", note.id);
    assert.ok(deletedRecord);
    const deletedNote = deletedRecord.snapshot as Parameters<
      typeof noteMatchesSearchQuery
    >[0];
    for (const query of queries) {
      assert.equal(
        noteMatchesSearchQuery(deletedNote, query),
        true,
        `deleted Note query ${query}`
      );
      assert.equal(listNotesPage({ query, limit: 20 }).total, 0);
    }
  });
});

test("anchored note pages include only the requested anchor and optional anchorless notes", async () => {
  await withTemporaryDatabase(() => {
    const anchored = createTestNote({
      title: "Spark evidence",
      contentMarkdown: "Evidence for the spark stage.",
      links: [
        {
          entityType: "goal",
          entityId: "goal_anchored",
          anchorKey: "spark"
        }
      ]
    });
    const anchorless = createTestNote({
      title: "Whole-goal evidence",
      contentMarkdown: "Evidence for the whole goal.",
      links: [{ entityType: "goal", entityId: "goal_anchored" }]
    });
    createTestNote({
      title: "Different stage evidence",
      contentMarkdown: "Evidence for another stage.",
      links: [
        {
          entityType: "goal",
          entityId: "goal_anchored",
          anchorKey: "pivot"
        }
      ]
    });

    const exact = listNotesPage({
      linkedEntityType: "goal",
      linkedEntityId: "goal_anchored",
      anchorKey: "spark"
    });
    assert.equal(exact.total, 1);
    assert.deepEqual(
      exact.notes.map((note) => note.id),
      [anchored.id]
    );

    const withAnchorless = listNotesPage({
      linkedEntityType: "goal",
      linkedEntityId: "goal_anchored",
      anchorKey: "spark",
      includeAnchorless: true
    });
    assert.equal(withAnchorless.total, 2);
    assert.deepEqual(
      new Set(withAnchorless.notes.map((note) => note.id)),
      new Set([anchored.id, anchorless.id])
    );
  });
});

test("note pagination is stable, non-overlapping, bounded, and owner-correct", async () => {
  await withTemporaryDatabase(() => {
    const operatorIds: string[] = [];
    for (let index = 0; index < 105; index += 1) {
      const note = createTestNote({
        title: `Bounded operator note ${index}`,
        contentMarkdown: `Pagination evidence ${index}`,
        tags: ["pagination"]
      });
      operatorIds.push(note.id);
      getDatabase()
        .prepare(`UPDATE notes SET created_at = ?, updated_at = ? WHERE id = ?`)
        .run(
          `2026-07-${String(1 + Math.floor(index / 24)).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
          `2026-07-${String(1 + Math.floor(index / 24)).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
          note.id
        );
    }
    for (let index = 0; index < 45; index += 1) {
      const note = createTestNote({
        title: `Newer foreign note ${index}`,
        contentMarkdown: `Foreign pagination evidence ${index}`,
        tags: ["pagination"],
        userId: "user_forge_bot"
      });
      getDatabase()
        .prepare(`UPDATE notes SET created_at = ?, updated_at = ? WHERE id = ?`)
        .run(
          `2027-01-01T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
          `2027-01-01T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
          note.id
        );
    }

    const first = listNotesPage({
      tags: ["pagination"],
      userIds: ["user_operator"],
      limit: 40
    });
    assert.equal(first.notes.length, 40);
    assert.equal(first.total, 105);
    assert.equal(first.hasMore, true);
    assert.ok(first.nextCursor);

    const second = listNotesPage({
      tags: ["pagination"],
      userIds: ["user_operator"],
      limit: 40,
      cursor: first.nextCursor ?? undefined
    });
    const third = listNotesPage({
      tags: ["pagination"],
      userIds: ["user_operator"],
      limit: 40,
      cursor: second.nextCursor ?? undefined
    });
    assert.equal(second.notes.length, 40);
    assert.equal(third.notes.length, 25);
    assert.equal(third.hasMore, false);
    assert.equal(third.nextCursor, null);

    const pagedIds = [...first.notes, ...second.notes, ...third.notes].map(
      (note) => note.id
    );
    assert.equal(new Set(pagedIds).size, 105);
    assert.deepEqual(new Set(pagedIds), new Set(operatorIds));

    assert.throws(
      () => listNotesPage({ cursor: "not-a-supported-cursor" }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 400 &&
        error.code === "invalid_note_cursor"
    );
  });
});

test("note pagination preserves legacy SQLite timestamp sort keys", async () => {
  await withTemporaryDatabase(() => {
    const timestamps = [
      "2026-07-15T12:00:00.000Z",
      "2026-07-15T11:00:00.000Z",
      "2026-07-15 10:00:00",
      "2026-07-15 09:00:00",
      "2026-07-15 08:00:00",
      "2026-07-14T23:00:00.000Z"
    ];
    const expectedIds = timestamps.map((timestamp, index) => {
      const note = createTestNote({
        title: `Mixed timestamp note ${index}`,
        contentMarkdown: `Mixed timestamp evidence ${index}`,
        tags: ["mixed-timestamps"]
      });
      getDatabase()
        .prepare(`UPDATE notes SET created_at = ?, updated_at = ? WHERE id = ?`)
        .run(timestamp, timestamp, note.id);
      return note.id;
    });

    const first = listNotesPage({ tags: ["mixed-timestamps"], limit: 3 });
    assert.equal(first.notes.length, 3);
    assert.equal(first.total, 6);
    assert.ok(first.nextCursor);

    const second = listNotesPage({
      tags: ["mixed-timestamps"],
      limit: 3,
      cursor: first.nextCursor ?? undefined
    });
    assert.equal(second.notes.length, 3);
    assert.equal(second.hasMore, false);
    assert.equal(second.nextCursor, null);

    const pagedIds = [...first.notes, ...second.notes].map((note) => note.id);
    assert.deepEqual(pagedIds, expectedIds);
    assert.equal(new Set(pagedIds).size, expectedIds.length);
  });
});

test("note revisions reject stale edits and soft deletion remains restorable", async () => {
  await withTemporaryDatabase(() => {
    const linked = createTestNote({
      title: "Durable linked note",
      contentMarkdown: "Initial durable content",
      tags: ["durable"],
      links: [{ entityType: "goal", entityId: "goal_durable" }]
    });
    assert.ok(linked.revisionHash);

    const updated = updateNote(
      linked.id,
      {
        contentMarkdown: "Updated durable content",
        expectedRevisionHash: linked.revisionHash,
        links: [
          {
            entityType: "goal",
            entityId: "goal_durable",
            anchorKey: null
          },
          { entityType: "note", entityId: "note_related", anchorKey: null }
        ]
      },
      context
    );
    assert.ok(updated);
    assert.notEqual(updated?.revisionHash, linked.revisionHash);
    assert.equal(updated?.links.length, 2);

    assert.throws(
      () =>
        updateNote(
          linked.id,
          {
            contentMarkdown: "Stale overwrite",
            expectedRevisionHash: linked.revisionHash
          },
          context
        ),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 409 &&
        error.code === "note_revision_conflict"
    );
    assert.equal(
      getNoteById(linked.id)?.contentMarkdown,
      "Updated durable content"
    );

    seedAuxiliaryNotePersistence(updated!);
    const beforeSoftDelete = notePersistenceCounts(linked.id);
    assert.deepEqual(beforeSoftDelete, {
      notes: 1,
      links: 2,
      owners: 1,
      assignments: 1,
      search: 1,
      wikiSearch: 1,
      wikiEdges: 1,
      embeddingChunks: 1,
      mediaAssets: 1,
      deletedEntities: 0
    });

    const deleted = deleteEntity("note", linked.id, {}, context);
    assert.equal(deleted?.id, linked.id);
    assert.equal(getNoteById(linked.id), undefined);
    assert.equal(
      (
        getDatabase()
          .prepare(`SELECT COUNT(*) AS count FROM notes WHERE id = ?`)
          .get(linked.id) as { count: number }
      ).count,
      1
    );
    assert.deepEqual(notePersistenceCounts(linked.id), {
      ...beforeSoftDelete,
      deletedEntities: 1
    });

    const restored = restoreEntity("note", linked.id, context);
    assert.equal(restored?.id, linked.id);
    assert.equal(
      getNoteById(linked.id)?.contentMarkdown,
      "Updated durable content"
    );
    assert.deepEqual(notePersistenceCounts(linked.id), beforeSoftDelete);

    const hardDeleted = deleteEntity(
      "note",
      linked.id,
      { mode: "hard", reason: "Contract test cleanup" },
      context
    );
    assert.equal(hardDeleted?.id, linked.id);
    assert.equal(getNoteById(linked.id), undefined);
    assert.deepEqual(notePersistenceCounts(linked.id), {
      notes: 0,
      links: 0,
      owners: 0,
      assignments: 0,
      search: 0,
      wikiSearch: 0,
      wikiEdges: 0,
      embeddingChunks: 0,
      mediaAssets: 0,
      deletedEntities: 0
    });
  });
});

test("hard Note deletion removes exact associated wiki media IDs only", async () => {
  await withTemporaryDatabase(() => {
    const target = createTestNote({
      title: "Media deletion target",
      contentMarkdown: "Delete only media associated with this Note."
    });
    const unrelated = createTestNote({
      title: "Unrelated media owner",
      contentMarkdown: "This Note and its media must survive."
    });
    const associatedMediaIds = [
      "media_target_note",
      "media_target_transcript",
      "media_target_both"
    ];
    insertWikiMediaAsset({
      id: associatedMediaIds[0]!,
      spaceId: target.spaceId,
      noteId: target.id
    });
    insertWikiMediaAsset({
      id: associatedMediaIds[1]!,
      spaceId: target.spaceId,
      noteId: unrelated.id,
      transcriptNoteId: target.id
    });
    insertWikiMediaAsset({
      id: associatedMediaIds[2]!,
      spaceId: target.spaceId,
      noteId: target.id,
      transcriptNoteId: target.id
    });
    insertWikiMediaAsset({
      id: "media_unrelated",
      spaceId: unrelated.spaceId,
      noteId: unrelated.id,
      transcriptNoteId: unrelated.id
    });

    assert.equal(
      deleteEntity(
        "note",
        target.id,
        { mode: "hard", reason: "Exact media deletion contract" },
        context
      )?.id,
      target.id
    );
    const remainingMedia = getDatabase()
      .prepare(
        `SELECT id, note_id, transcript_note_id
         FROM wiki_media_assets
         ORDER BY id ASC`
      )
      .all() as Array<{
      id: string;
      note_id: string | null;
      transcript_note_id: string | null;
    }>;
    assert.deepEqual(
      remainingMedia.map((media) => ({ ...media })),
      [
        {
          id: "media_unrelated",
          note_id: unrelated.id,
          transcript_note_id: unrelated.id
        }
      ]
    );
    for (const mediaId of associatedMediaIds) {
      assert.equal(
        remainingMedia.some((media) => media.id === mediaId),
        false,
        mediaId
      );
    }
  });
});

test("note creation rolls back every linked persistence surface after a late failure", async () => {
  await withTemporaryDatabase(() => {
    const count = (table: string, where = "") =>
      (
        getDatabase()
          .prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`)
          .get() as { count: number }
      ).count;
    const before = {
      notes: count("notes"),
      links: count("note_links"),
      owners: count("entity_owners", "WHERE entity_type = 'note'"),
      search: count("notes_fts"),
      wikiSearch: count("wiki_pages_fts"),
      wikiEdges: count("wiki_link_edges"),
      activity: count("activity_events"),
      eventLog: count("event_log")
    };

    getDatabase().exec(`
      CREATE TEMP TRIGGER reject_note_activity
      BEFORE INSERT ON activity_events
      WHEN NEW.event_type = 'note.created'
      BEGIN
        SELECT RAISE(ABORT, 'injected late note failure');
      END;
    `);

    assert.throws(
      () =>
        createTestNote({
          title: "Atomic rollback sentinel",
          contentMarkdown: "No partial note may survive this failure.",
          links: [{ entityType: "goal", entityId: "goal_atomic" }]
        }),
      /injected late note failure/
    );
    getDatabase().exec(`DROP TRIGGER reject_note_activity`);

    assert.deepEqual(
      {
        notes: count("notes"),
        links: count("note_links"),
        owners: count("entity_owners", "WHERE entity_type = 'note'"),
        search: count("notes_fts"),
        wikiSearch: count("wiki_pages_fts"),
        wikiEdges: count("wiki_link_edges"),
        activity: count("activity_events"),
        eventLog: count("event_log")
      },
      before
    );
  });
});

test("expired-note cleanup is bounded, atomic, and expired rows remain invisible", async () => {
  await withTemporaryDatabase(() => {
    const notes = Array.from(
      { length: EXPIRED_NOTE_CLEANUP_BATCH_SIZE + 5 },
      (_, index) =>
        createTestNote({
          title: `Expired note ${index}`,
          contentMarkdown: `Expired cleanup evidence ${index}`,
          tags: ["expired-cleanup"]
        })
    );
    const ids = notes.map((note) => note.id);
    const placeholders = ids.map(() => "?").join(", ");
    const cleanupOrder = [...notes].sort((left, right) =>
      left.id.localeCompare(right.id)
    );
    const cleanedProbe = cleanupOrder[0]!;
    const retainedProbe = cleanupOrder[EXPIRED_NOTE_CLEANUP_BATCH_SIZE]!;
    seedAuxiliaryNotePersistence(cleanedProbe);
    seedAuxiliaryNotePersistence(retainedProbe);
    const retainedPersistence = notePersistenceCounts(retainedProbe.id);
    getDatabase()
      .prepare(
        `UPDATE notes
         SET destroy_at = '2026-01-01T00:00:00.000Z'
         WHERE id IN (${placeholders})`
      )
      .run(...ids);

    assert.equal(
      cleanupExpiredNotes(new Date("2026-07-16T12:00:00.000Z")),
      EXPIRED_NOTE_CLEANUP_BATCH_SIZE
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count
             FROM notes
             WHERE id IN (${placeholders})`
          )
          .get(...ids) as { count: number }
      ).count,
      5
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count
             FROM entity_owners
             WHERE entity_type = 'note'
               AND entity_id IN (${placeholders})`
          )
          .get(...ids) as { count: number }
      ).count,
      5
    );
    assert.deepEqual(notePersistenceCounts(cleanedProbe.id), {
      notes: 0,
      links: 0,
      owners: 0,
      assignments: 0,
      search: 0,
      wikiSearch: 0,
      wikiEdges: 0,
      embeddingChunks: 0,
      mediaAssets: 0,
      deletedEntities: 0
    });
    assert.deepEqual(
      notePersistenceCounts(retainedProbe.id),
      retainedPersistence
    );

    const visible = listNotesPage({
      tags: ["expired-cleanup"],
      limit: 100
    });
    assert.equal(visible.total, 0);
    assert.deepEqual(visible.notes, []);
  });
});

test("expiry selection revalidates destroy_at after acquiring BEGIN IMMEDIATE", async () => {
  await withTemporaryDatabase(async (rootDir) => {
    const note = createTestNote({
      title: "Expiry extension race",
      contentMarkdown: "An extension committed first must prevent deletion."
    });
    getDatabase()
      .prepare(`UPDATE notes SET destroy_at = ? WHERE id = ?`)
      .run("2026-01-01T00:00:00.000Z", note.id);

    const extendedDestroyAt = "2099-01-01T00:00:00.000Z";
    const worker = await startLockedExpiryExtension({
      databasePath: path.join(rootDir, "forge.sqlite"),
      noteId: note.id,
      destroyAt: extendedDestroyAt
    });
    let deletedCount = -1;
    try {
      deletedCount = cleanupExpiredNotes(new Date("2026-07-16T12:00:00.000Z"));
      await worker.waitForCompletion();
    } finally {
      if (worker.child.exitCode === null) {
        worker.child.kill();
      }
    }

    assert.equal(deletedCount, 0);
    const persisted = getDatabase()
      .prepare(`SELECT id, destroy_at FROM notes WHERE id = ?`)
      .get(note.id) as { id: string; destroy_at: string };
    assert.deepEqual(
      { ...persisted },
      { id: note.id, destroy_at: extendedDestroyAt }
    );
  });
});

test("note summaries are target-bounded, deduplicate anchors, and activity prose is bounded", async () => {
  await withTemporaryDatabase(() => {
    const longBody = "Sensitive linked prose ".repeat(80).trim();
    const first = createTestNote({
      title: "Requested summary note",
      contentMarkdown: longBody,
      links: [
        { entityType: "goal", entityId: "goal_requested", anchorKey: "state" },
        { entityType: "goal", entityId: "goal_requested", anchorKey: "story" }
      ]
    });
    createTestNote({
      title: "Second requested summary note",
      contentMarkdown: "Another requested note.",
      links: [{ entityType: "goal", entityId: "goal_requested" }]
    });
    createTestNote({
      title: "Unrelated summary note",
      contentMarkdown: "This target must not enter the payload.",
      links: [{ entityType: "project", entityId: "project_unrelated" }]
    });

    const summary = buildNotesSummaryByEntity([
      { entityType: "goal", entityId: "goal_requested" }
    ]);
    assert.deepEqual(Object.keys(summary), ["goal:goal_requested"]);
    assert.equal(summary["goal:goal_requested"]?.count, 2);
    assert.ok(summary["goal:goal_requested"]?.latestNoteId);

    const foreign = createTestNote({
      title: "Foreign summary secret",
      contentMarkdown: "Foreign note prose must not enter scoped context.",
      userId: "user_forge_bot",
      links: [{ entityType: "goal", entityId: "goal_requested" }]
    });
    const psyche = createTestNote({
      title: "Private Psyche summary secret",
      contentMarkdown: "Psyche note prose must require Psyche read scope.",
      links: [
        { entityType: "psyche_value", entityId: "value_private" },
        { entityType: "goal", entityId: "goal_requested" }
      ]
    });
    const noteScope = {
      userIds: ["user_operator"],
      accessibleSpaceIds: [first.spaceId],
      includePsyche: false
    };
    const scopedSummary = buildNotesSummaryByEntity(
      [{ entityType: "goal", entityId: "goal_requested" }],
      noteScope
    );
    assert.equal(scopedSummary["goal:goal_requested"]?.count, 2);
    assert.deepEqual(
      buildNotesSummaryByEntity(
        [{ entityType: "goal", entityId: "goal_requested" }],
        { ...noteScope, accessibleSpaceIds: [] }
      ),
      {}
    );

    const scopedActivity = filterNoteActivityEventsForScope(
      listActivityEvents({
        entityType: "goal",
        entityId: "goal_requested",
        limit: 20
      }),
      noteScope
    );
    const scopedNoteIds = new Set(
      scopedActivity.map((event) => String(event.metadata.noteId ?? ""))
    );
    assert.equal(scopedNoteIds.has(first.id), true);
    assert.equal(scopedNoteIds.has(foreign.id), false);
    assert.equal(scopedNoteIds.has(psyche.id), false);

    const activity = getDatabase()
      .prepare(
        `SELECT description, metadata_json
         FROM activity_events
         WHERE event_type = 'note.created'
           AND json_extract(metadata_json, '$.noteId') = ?
         LIMIT 1`
      )
      .get(first.id) as { description: string; metadata_json: string };
    assert.equal(activity.description, "A linked note was added.");
    assert.doesNotMatch(activity.description, /Sensitive linked prose/);
    assert.deepEqual(JSON.parse(activity.metadata_json).anchorKeys, [
      "state",
      "story"
    ]);
    const rawEvent = getDatabase()
      .prepare(
        `SELECT metadata_json
         FROM event_log
         WHERE event_kind = 'note.created'
           AND json_extract(metadata_json, '$.noteId') = ?
         LIMIT 1`
      )
      .get(first.id) as { metadata_json: string };
    assert.deepEqual(JSON.parse(rawEvent.metadata_json).anchorKeys, [
      "state",
      "story"
    ]);
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count
             FROM activity_events
             WHERE event_type = 'note.created'
               AND json_extract(metadata_json, '$.noteId') = ?
               AND entity_type = 'goal'
               AND entity_id = 'goal_requested'`
          )
          .get(first.id) as { count: number }
      ).count,
      1
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count
             FROM event_log
             WHERE event_kind = 'note.created'
               AND json_extract(metadata_json, '$.noteId') = ?
               AND entity_type = 'goal'
               AND entity_id = 'goal_requested'`
          )
          .get(first.id) as { count: number }
      ).count,
      1
    );
  });
});
