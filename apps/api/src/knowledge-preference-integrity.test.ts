import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase, initializeDatabase } from "./db.js";

async function issueOperatorSessionCookie(
  app: Awaited<ReturnType<typeof buildServer>>
) {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/auth/operator-session",
    headers: { host: "127.0.0.1:4317" }
  });
  const cookie = response.cookies[0];
  assert.ok(cookie);
  return `${cookie.name}=${cookie.value}`;
}

test("wiki page updates compare and swap the persisted revision atomically", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-wiki-cas-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const cookie = await issueOperatorSessionCookie(app);
    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/pages",
      headers: { cookie },
      payload: {
        title: "Concurrent wiki page",
        contentMarkdown: "# Concurrent wiki page\n\nOriginal",
        links: []
      }
    });
    assert.equal(createdResponse.statusCode, 201);
    const created = createdResponse.json() as {
      page: { id: string; revisionHash: string };
    };

    const firstUpdate = await app.inject({
      method: "PATCH",
      url: `/api/v1/wiki/pages/${created.page.id}`,
      headers: { cookie },
      payload: {
        contentMarkdown: "# Concurrent wiki page\n\nFirst writer",
        expectedRevisionHash: created.page.revisionHash
      }
    });
    assert.equal(firstUpdate.statusCode, 200);
    const firstRevision = firstUpdate.json() as {
      page: { revisionHash: string };
    };
    assert.notEqual(firstRevision.page.revisionHash, created.page.revisionHash);

    const staleUpdate = await app.inject({
      method: "PATCH",
      url: `/api/v1/wiki/pages/${created.page.id}`,
      headers: { cookie },
      payload: {
        contentMarkdown: "# Concurrent wiki page\n\nStale writer",
        expectedRevisionHash: created.page.revisionHash
      }
    });
    assert.equal(staleUpdate.statusCode, 409);
    assert.equal(
      (staleUpdate.json() as { code: string }).code,
      "note_revision_conflict"
    );

    const persisted = await app.inject({
      method: "GET",
      url: `/api/v1/wiki/pages/${created.page.id}`,
      headers: { cookie }
    });
    assert.equal(persisted.statusCode, 200);
    assert.match(
      (persisted.json() as { page: { contentMarkdown: string } }).page
        .contentMarkdown,
      /First writer/
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("linked preference identity is reused while direct duplicate labels stay distinct", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-preference-identity-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const cookie = await issueOperatorSessionCookie(app);
    const users = await app.inject({
      method: "GET",
      url: "/api/v1/users",
      headers: { cookie }
    });
    const userId = (users.json() as { users: Array<{ id: string }> }).users[0]
      ?.id;
    assert.ok(userId);
    const goals = await app.inject({ method: "GET", url: "/api/v1/goals" });
    const goalId = (goals.json() as { goals: Array<{ id: string }> }).goals[0]
      ?.id;
    assert.ok(goalId);

    const linkedPayload = {
      userId,
      domain: "projects",
      entityType: "goal",
      entityId: goalId
    };
    const firstLinked = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/items/from-entity",
      headers: { cookie },
      payload: linkedPayload
    });
    const secondLinked = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/items/from-entity",
      headers: { cookie },
      payload: linkedPayload
    });
    assert.equal(firstLinked.statusCode, 201);
    assert.equal(secondLinked.statusCode, 201);
    const linkedId = (firstLinked.json() as { item: { id: string } }).item.id;
    assert.equal(
      (secondLinked.json() as { item: { id: string } }).item.id,
      linkedId
    );
    const linkedCount = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM preference_items
         WHERE source_entity_type = 'goal' AND source_entity_id = ?`
      )
      .get(goalId) as { count: number };
    assert.equal(linkedCount.count, 1);

    const directPayload = {
      userId,
      domain: "projects",
      label: "Same visible label",
      description: "Distinct direct record",
      queueForCompare: false
    };
    const firstDirect = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/items",
      headers: { cookie },
      payload: directPayload
    });
    const secondDirect = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/items",
      headers: { cookie },
      payload: directPayload
    });
    assert.equal(firstDirect.statusCode, 201);
    assert.equal(secondDirect.statusCode, 201);
    assert.notEqual(
      (firstDirect.json() as { item: { id: string } }).item.id,
      (secondDirect.json() as { item: { id: string } }).item.id
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("preference identity migration deterministically repairs duplicates and preserves evidence", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-preference-repair-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  let appClosed = false;
  try {
    const database = getDatabase();
    const seededUser = database
      .prepare("SELECT id FROM users ORDER BY created_at ASC LIMIT 1")
      .get() as { id: string };
    const cookie = await issueOperatorSessionCookie(app);
    const workspaceResponse = await app.inject({
      method: "GET",
      url: `/api/v1/preferences/workspace?userId=${seededUser.id}&domain=projects`,
      headers: { cookie }
    });
    assert.equal(workspaceResponse.statusCode, 200);
    const noteResponse = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/pages",
      headers: { cookie },
      payload: {
        title: "Preference migration linked note",
        contentMarkdown: "# Preference migration linked note",
        links: []
      }
    });
    assert.equal(noteResponse.statusCode, 201);
    const linkedNoteId = (noteResponse.json() as { page: { id: string } }).page
      .id;
    const profile = database
      .prepare(
        `SELECT id, user_id
         FROM preference_profiles
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get() as { id: string; user_id: string };
    const context = database
      .prepare(
        `SELECT id
         FROM preference_contexts
         WHERE profile_id = ?
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get(profile.id) as { id: string };
    const timestamp = "2026-07-11T12:00:00.000Z";
    database.exec("DROP INDEX idx_preference_items_linked_identity");
    database
      .prepare("DELETE FROM migrations WHERE id = ?")
      .run("083_preference_linked_identity.sql");
    database
      .prepare(
        `INSERT INTO preference_items (
           id, profile_id, label, description, tags_json, feature_weights_json,
           source_entity_type, source_entity_id, metadata_json, created_at, updated_at
         ) VALUES (?, ?, ?, '', '[]', '{}', 'goal', 'goal_duplicate_fixture', '{}', ?, ?)`
      )
      .run("pref_survivor", profile.id, "Survivor", timestamp, timestamp);
    database
      .prepare(
        `INSERT INTO preference_items (
           id, profile_id, label, description, tags_json, feature_weights_json,
           source_entity_type, source_entity_id, metadata_json, created_at, updated_at
         ) VALUES (?, ?, ?, '', '[]', '{}', 'goal', 'goal_duplicate_fixture', '{}', ?, ?)`
      )
      .run(
        "pref_duplicate",
        profile.id,
        "Duplicate",
        "2026-07-11T12:01:00.000Z",
        "2026-07-11T12:01:00.000Z"
      );
    database
      .prepare(
        `INSERT INTO preference_item_scores (
           id, profile_id, context_id, item_id, latent_score, confidence, uncertainty,
           evidence_count, pairwise_wins, pairwise_losses, pairwise_ties, signal_count,
           conflict_count, status, dominant_dimensions_json, explanation_json,
           manual_status, manual_score, confidence_lock, bookmarked, compare_later,
           frozen, last_inferred_at, last_judgment_at, updated_at
         ) VALUES (?, ?, ?, ?, 0, 0, 1, 0, 0, 0, 0, 0, 0, 'uncertain', '[]', '[]', ?, ?, NULL, ?, ?, ?, ?, NULL, ?)`
      )
      .run(
        "score_survivor",
        profile.id,
        context.id,
        "pref_survivor",
        null,
        null,
        0,
        0,
        0,
        timestamp,
        timestamp
      );
    database
      .prepare(
        `INSERT INTO preference_item_scores (
           id, profile_id, context_id, item_id, latent_score, confidence, uncertainty,
           evidence_count, pairwise_wins, pairwise_losses, pairwise_ties, signal_count,
           conflict_count, status, dominant_dimensions_json, explanation_json,
           manual_status, manual_score, confidence_lock, bookmarked, compare_later,
           frozen, last_inferred_at, last_judgment_at, updated_at
         ) VALUES (?, ?, ?, ?, 0, 0, 1, 0, 0, 0, 0, 0, 0, 'uncertain', '[]', '[]', ?, ?, NULL, ?, ?, ?, ?, NULL, ?)`
      )
      .run(
        "score_duplicate",
        profile.id,
        context.id,
        "pref_duplicate",
        "liked",
        0.75,
        1,
        1,
        1,
        timestamp,
        "2026-07-11T12:01:00.000Z"
      );
    database
      .prepare(
        `INSERT INTO absolute_signals (
           id, profile_id, context_id, user_id, item_id, signal_type, strength, source, created_at
         ) VALUES ('signal_duplicate', ?, ?, ?, 'pref_duplicate', 'favorite', 1, 'ui', ?)`
      )
      .run(profile.id, context.id, profile.user_id, timestamp);
    database
      .prepare(
        `INSERT INTO note_links (
           note_id, entity_type, entity_id, anchor_key, created_at
         ) VALUES (?, 'preference_item', 'pref_duplicate', '', ?)`
      )
      .run(linkedNoteId, timestamp);
    database
      .prepare(
        `INSERT INTO entity_owners (
           entity_type, entity_id, user_id, role, created_at, updated_at
         ) VALUES ('preference_item', 'pref_duplicate', ?, 'owner', ?, ?)`
      )
      .run(profile.user_id, timestamp, timestamp);

    await app.close();
    appClosed = true;
    closeDatabase();
    await initializeDatabase();

    const repairedItems = getDatabase()
      .prepare(
        `SELECT id
         FROM preference_items
         WHERE profile_id = ?
           AND source_entity_type = 'goal'
           AND source_entity_id = 'goal_duplicate_fixture'`
      )
      .all(profile.id) as Array<{ id: string }>;
    assert.deepEqual(
      repairedItems.map((item) => item.id),
      ["pref_survivor"]
    );
    assert.equal(
      (
        getDatabase()
          .prepare("SELECT item_id FROM absolute_signals WHERE id = ?")
          .get("signal_duplicate") as { item_id: string }
      ).item_id,
      "pref_survivor"
    );
    const mergedScore = getDatabase()
      .prepare(
        `SELECT manual_status, manual_score, bookmarked, compare_later, frozen
         FROM preference_item_scores
         WHERE item_id = 'pref_survivor' AND context_id = ?`
      )
      .get(context.id) as {
      manual_status: string;
      manual_score: number;
      bookmarked: number;
      compare_later: number;
      frozen: number;
    };
    assert.equal(mergedScore.manual_status, "liked");
    assert.equal(mergedScore.manual_score, 0.75);
    assert.equal(mergedScore.bookmarked, 1);
    assert.equal(mergedScore.compare_later, 1);
    assert.equal(mergedScore.frozen, 1);
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT entity_id
             FROM note_links
             WHERE note_id = ? AND entity_type = 'preference_item'`
          )
          .get(linkedNoteId) as { entity_id: string }
      ).entity_id,
      "pref_survivor"
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT entity_id
             FROM entity_owners
             WHERE entity_type = 'preference_item'`
          )
          .get() as { entity_id: string }
      ).entity_id,
      "pref_survivor"
    );
  } finally {
    if (!appClosed) {
      await app.close();
    }
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
