import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase, initializeDatabase } from "./db.js";

const issueOperatorSessionCookie = issueTestOperatorSessionCookie;

async function issuePreferenceToken(
  app: Awaited<ReturnType<typeof buildServer>>,
  cookie: string,
  userIds: string[]
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie },
    payload: {
      label: "Preference owner resolution test",
      agentLabel: "Preference owner resolver",
      scopes: ["read", "write"],
      scopePolicy: { userIds, projectIds: [], tagIds: [] }
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { token: { token: string } }).token.token;
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
    const goals = await app.inject({
      method: "GET",
      url: "/api/v1/goals",
      headers: { cookie }
    });
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

test("preference catalog reads remove links after source ACL revocation", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-preference-link-revocation-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const cookie = await issueOperatorSessionCookie(app);
    const token = await issuePreferenceToken(app, cookie, ["user_operator"]);
    const tokenHeaders = { authorization: `Bearer ${token}` };
    const createSpace = async (
      label: string,
      visibility: "personal" | "shared"
    ) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/wiki/spaces",
        headers: { cookie },
        payload: {
          label,
          ownerUserId: "user_forge_bot",
          visibility
        }
      });
      assert.equal(response.statusCode, 201, response.body);
      return response.json().space.id as string;
    };
    const sharedSpaceId = await createSpace(
      "Preference link initially shared",
      "shared"
    );
    const privateSpaceId = await createSpace(
      "Preference link revoked",
      "personal"
    );
    const pageResponse = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/pages",
      headers: { cookie },
      payload: {
        spaceId: sharedSpaceId,
        title: "Revocable preference source",
        contentMarkdown: "# Revocable preference source",
        links: []
      }
    });
    assert.equal(pageResponse.statusCode, 201, pageResponse.body);
    const page = pageResponse.json().page as {
      id: string;
      revisionHash: string;
    };

    const catalogResponse = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/catalogs",
      headers: tokenHeaders,
      payload: {
        userId: "user_operator",
        domain: "projects",
        title: "Revocable source catalog",
        links: [
          {
            entityType: "note",
            entityId: page.id,
            relationship: "related"
          }
        ]
      }
    });
    assert.equal(catalogResponse.statusCode, 201, catalogResponse.body);
    const catalogId = catalogResponse.json().catalog.id as string;
    assert.equal(catalogResponse.json().catalog.links.length, 1);

    const revokeResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/wiki/pages/${page.id}`,
      headers: { cookie },
      payload: {
        spaceId: privateSpaceId,
        expectedRevisionHash: page.revisionHash
      }
    });
    assert.equal(revokeResponse.statusCode, 200, revokeResponse.body);
    const revokedSource = await app.inject({
      method: "GET",
      url: `/api/v1/wiki/pages/${page.id}`,
      headers: tokenHeaders
    });
    assert.equal(revokedSource.statusCode, 404);

    const directRead = await app.inject({
      method: "GET",
      url: `/api/v1/preferences/catalogs/${catalogId}`,
      headers: tokenHeaders
    });
    assert.equal(directRead.statusCode, 200, directRead.body);
    assert.deepEqual(directRead.json().catalog.links, []);

    const listRead = await app.inject({
      method: "GET",
      url: "/api/v1/preferences/catalogs?domain=projects",
      headers: tokenHeaders
    });
    assert.equal(listRead.statusCode, 200, listRead.body);
    const listedCatalog = listRead
      .json()
      .catalogs.find((catalog: { id: string }) => catalog.id === catalogId);
    assert.ok(listedCatalog);
    assert.deepEqual(listedCatalog.links, []);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("preference routes use preference-specific single-owner errors", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-preference-owner-resolution-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const cookie = await issueOperatorSessionCookie(app);
    const token = await issuePreferenceToken(app, cookie, [
      "user_operator",
      "user_forge_bot"
    ]);
    const headers = { authorization: `Bearer ${token}` };

    const required = await app.inject({
      method: "GET",
      url: "/api/v1/preferences/workspace?domain=projects",
      headers
    });
    assert.equal(required.statusCode, 400);
    assert.deepEqual(required.json(), {
      code: "preferences_user_selection_required",
      error:
        "This token can read preferences for several Forge users; select exactly one user.",
      statusCode: 400
    });

    const conflict = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/game/start?userId=user_operator",
      headers,
      payload: { userId: "user_forge_bot", domain: "projects" }
    });
    assert.equal(conflict.statusCode, 400);
    assert.deepEqual(conflict.json(), {
      code: "preferences_user_selection_conflict",
      error:
        "The selected query user and body userId must identify the same Forge user for Preferences.",
      statusCode: 400
    });

    const ambiguous = await app.inject({
      method: "POST",
      url:
        "/api/v1/preferences/catalogs" +
        "?userIds=user_operator&userIds=user_forge_bot",
      headers,
      payload: {
        userId: "user_operator",
        domain: "projects",
        title: "Ambiguous owner catalog"
      }
    });
    assert.equal(ambiguous.statusCode, 400);
    assert.deepEqual(ambiguous.json(), {
      code: "preferences_user_selection_ambiguous",
      error: "Preference operations require exactly one selected Forge user.",
      statusCode: 400
    });

    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/workspace/refresh",
      headers: { cookie },
      payload: { userId: "user_missing", domain: "projects" }
    });
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(missing.json(), {
      code: "preferences_user_not_found",
      error: "Forge user user_missing does not exist.",
      statusCode: 404
    });
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
    const initializeResponse = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/workspace/refresh",
      headers: { cookie },
      payload: { userId: seededUser.id, domain: "projects" }
    });
    assert.equal(initializeResponse.statusCode, 200, initializeResponse.body);
    const readOnlyCounts = () =>
      database
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM preference_profiles) AS profiles,
             (SELECT COUNT(*) FROM preference_contexts) AS contexts,
             (SELECT COUNT(*) FROM preference_snapshots) AS snapshots`
        )
        .get() as { profiles: number; contexts: number; snapshots: number };
    const countsBeforeRead = readOnlyCounts();
    const workspaceResponse = await app.inject({
      method: "GET",
      url: `/api/v1/preferences/workspace?userId=${seededUser.id}&domain=projects`,
      headers: { cookie }
    });
    assert.equal(workspaceResponse.statusCode, 200);
    assert.deepEqual(readOnlyCounts(), countsBeforeRead);
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
