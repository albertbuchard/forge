import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { listPreferenceCatalogHardDeleteDescendants } from "./repositories/preferences.js";

async function issueOperatorSessionCookie(
  app: Awaited<ReturnType<typeof buildServer>>
) {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/auth/operator-session",
    headers: { host: "127.0.0.1:4317" }
  });
  assert.equal(response.statusCode, 200);
  const cookie = response.cookies[0];
  assert.ok(cookie);
  return `${cookie.name}=${cookie.value}`;
}

async function issueScopedToken(
  app: Awaited<ReturnType<typeof buildServer>>,
  cookie: string,
  userId: string
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie },
    payload: {
      label: "Preference catalog scope test",
      scopes: ["read", "write"],
      scopePolicy: { userIds: [userId], projectIds: [], tagIds: [] }
    }
  });
  assert.equal(response.statusCode, 201);
  return (response.json() as { token: { token: string } }).token.token;
}

function catalogPayload(
  title: string,
  userId = "user_operator",
  links: Array<{
    entityType: "goal";
    entityId: string;
    relationship: string;
  }> = []
) {
  return {
    userId,
    domain: "food",
    title,
    description: "Compare practical breakfast meeting options.",
    scopeIn: "Quiet cafes serving breakfast within walking distance.",
    scopeOut: "Takeaway-only counters and dinner-only restaurants.",
    links
  };
}

function firstSeededGoalLink() {
  const target = getDatabase()
    .prepare(`SELECT id FROM goals ORDER BY created_at ASC LIMIT 1`)
    .get() as { id: string } | undefined;
  assert.ok(target);
  return [
    {
      entityType: "goal" as const,
      entityId: target.id,
      relationship: "supports"
    }
  ];
}

test("preference catalog routes enforce auth and preserve provenance, links, duplicates, retries, and pagination", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-pref-catalog-contract-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const cookie = await issueOperatorSessionCookie(app);
    const anonymous = await app.inject({
      method: "GET",
      url: "/api/v1/preferences/catalogs"
    });
    assert.equal(anonymous.statusCode, 401);
    const linkedCatalogPayload = (title: string) =>
      catalogPayload(title, "user_operator", firstSeededGoalLink());

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/catalogs",
      headers: {
        cookie,
        "idempotency-key": "breakfast-catalog-v1",
        "x-forge-actor": "Preference contract test"
      },
      payload: linkedCatalogPayload("Breakfast shortlist")
    });
    assert.equal(create.statusCode, 201);
    const created = (create.json() as { catalog: Record<string, unknown> })
      .catalog;
    assert.equal(created.userId, "user_operator");
    assert.equal(created.createdSource, "ui");
    assert.equal(created.scopeIn, catalogPayload("x").scopeIn);
    assert.equal((created.links as unknown[]).length, 1);

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/catalogs",
      headers: { cookie, "idempotency-key": "breakfast-catalog-v1" },
      payload: linkedCatalogPayload("Breakfast shortlist")
    });
    assert.equal(replay.statusCode, 201);
    assert.equal(
      (replay.json() as { catalog: { id: string } }).catalog.id,
      created.id
    );

    const keyConflict = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/catalogs",
      headers: { cookie, "idempotency-key": "breakfast-catalog-v1" },
      payload: linkedCatalogPayload("Different payload")
    });
    assert.equal(keyConflict.statusCode, 409);

    const malformedKey = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/catalogs",
      headers: { cookie, "idempotency-key": "x".repeat(129) },
      payload: catalogPayload("Malformed retry key")
    });
    assert.equal(malformedKey.statusCode, 400);
    assert.equal(malformedKey.json().code, "invalid_idempotency_key");

    const batchCreatePayload = {
      atomic: true,
      operations: [
        {
          entityType: "preference_catalog",
          idempotencyKey: "batch-breakfast-catalog-v1",
          data: catalogPayload("Batch breakfast shortlist")
        }
      ]
    };
    const batchCreate = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie },
      payload: batchCreatePayload
    });
    const batchReplay = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie },
      payload: batchCreatePayload
    });
    assert.equal(batchCreate.statusCode, 200);
    assert.equal(batchReplay.statusCode, 200);
    assert.equal(batchCreate.json().results[0]?.ok, true);
    assert.equal(
      batchReplay.json().results[0]?.entity?.id,
      batchCreate.json().results[0]?.entity?.id
    );

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/catalogs",
      headers: { cookie, "idempotency-key": "breakfast-catalog-v2" },
      payload: catalogPayload("  breakfast SHORTLIST  ")
    });
    assert.equal(duplicate.statusCode, 409);
    assert.equal(duplicate.json().code, "preferences_catalog_duplicate");

    await app.inject({
      method: "POST",
      url: "/api/v1/preferences/catalogs",
      headers: { cookie, "idempotency-key": "lunch-catalog-v1" },
      payload: catalogPayload("Lunch shortlist")
    });
    const page = await app.inject({
      method: "GET",
      url: "/api/v1/preferences/catalogs?query=shortlist&limit=1&offset=1",
      headers: { cookie }
    });
    assert.equal(page.statusCode, 200);
    assert.equal((page.json() as { catalogs: unknown[] }).catalogs.length, 1);
    assert.equal(page.json().limit, 1);
    assert.equal(page.json().offset, 1);
    assert.equal(page.json().previousOffset, 0);

    const owner = getDatabase()
      .prepare(
        `SELECT user_id FROM entity_owners
         WHERE entity_type = 'preference_catalog' AND entity_id = ?`
      )
      .get(String(created.id)) as { user_id: string } | undefined;
    assert.equal(owner?.user_id, "user_operator");

    const seededItemOwnership = getDatabase()
      .prepare(
        `SELECT
           COUNT(*) AS item_count,
           SUM(CASE WHEN entity_owners.entity_id IS NULL THEN 1 ELSE 0 END) AS missing_owner_count
         FROM preference_catalog_items
         INNER JOIN preference_catalogs
           ON preference_catalogs.id = preference_catalog_items.catalog_id
         LEFT JOIN entity_owners
           ON entity_owners.entity_type = 'preference_catalog_item'
          AND entity_owners.entity_id = preference_catalog_items.id
          AND entity_owners.user_id = ?
         WHERE preference_catalogs.profile_id = ?
           AND preference_catalogs.source = 'seeded'`
      )
      .get("user_operator", String(created.profileId)) as {
      item_count: number;
      missing_owner_count: number;
    };
    assert.ok(seededItemOwnership.item_count > 0);
    assert.equal(seededItemOwnership.missing_owner_count, 0);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("preference catalog owner scope applies to direct and batch routes", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-pref-catalog-scope-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const cookie = await issueOperatorSessionCookie(app);
    const token = await issueScopedToken(app, cookie, "user_forge_bot");
    const headers = { authorization: `Bearer ${token}` };

    const forbidden = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/catalogs",
      headers,
      payload: catalogPayload("Operator-only", "user_operator")
    });
    assert.equal(forbidden.statusCode, 403);

    const allowed = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/catalogs",
      headers,
      payload: catalogPayload("Bot shortlist", "user_forge_bot")
    });
    assert.equal(allowed.statusCode, 201);
    const allowedCatalogId = (allowed.json() as { catalog: { id: string } })
      .catalog.id;

    const forbiddenGame = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/game/start",
      headers,
      payload: { userId: "user_operator", domain: "food" }
    });
    assert.equal(forbiddenGame.statusCode, 403);

    const allowedGame = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/game/start",
      headers,
      payload: {
        userId: "user_forge_bot",
        domain: "food",
        catalogId: allowedCatalogId
      }
    });
    assert.equal(allowedGame.statusCode, 200);

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/preferences/catalogs",
      headers
    });
    assert.equal(list.statusCode, 200);
    assert.ok(
      (list.json() as { catalogs: Array<{ userId: string }> }).catalogs.every(
        (catalog) => catalog.userId === "user_forge_bot"
      )
    );

    const batch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers,
      payload: {
        atomic: false,
        operations: [
          {
            entityType: "preference_catalog",
            data: catalogPayload("Escaped batch", "user_operator")
          },
          {
            entityType: "preference_catalog",
            data: catalogPayload("Allowed batch", "user_forge_bot")
          }
        ]
      }
    });
    assert.equal(batch.statusCode, 200);
    const results = (
      batch.json() as {
        results: Array<{ ok: boolean; error?: { code: string } }>;
      }
    ).results;
    assert.equal(results[0]?.ok, false);
    assert.equal(results[0]?.error?.code, "user_scope_forbidden");
    assert.equal(results[1]?.ok, true);

    const operatorCatalog = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/catalogs",
      headers: { cookie },
      payload: catalogPayload("Operator restore boundary", "user_operator")
    });
    const operatorCatalogId = (
      operatorCatalog.json() as { catalog: { id: string } }
    ).catalog.id;
    const operatorItem = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/catalog-items",
      headers: { cookie },
      payload: {
        catalogId: operatorCatalogId,
        label: "Private operator choice"
      }
    });
    assert.equal(operatorItem.statusCode, 201);
    const operatorItemId = (operatorItem.json() as { item: { id: string } })
      .item.id;

    const ownItem = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers,
      payload: {
        atomic: true,
        operations: [
          {
            entityType: "preference_catalog_item",
            data: { catalogId: allowedCatalogId, label: "Scoped bot choice" }
          }
        ]
      }
    });
    assert.equal(ownItem.statusCode, 200);
    assert.equal(ownItem.json().results[0]?.ok, true);
    const ownItemId = ownItem.json().results[0]?.entity?.id as string;
    const ownItemOwner = getDatabase()
      .prepare(
        `SELECT user_id FROM entity_owners
         WHERE entity_type = 'preference_catalog_item' AND entity_id = ?`
      )
      .get(ownItemId) as { user_id: string } | undefined;
    assert.equal(ownItemOwner?.user_id, "user_forge_bot");

    const scopedItemList = await app.inject({
      method: "GET",
      url: "/api/v1/preferences/catalog-items?limit=200",
      headers
    });
    assert.equal(scopedItemList.statusCode, 200);
    const scopedItems = scopedItemList.json().items as Array<{
      id: string;
      catalogId: string;
    }>;
    assert.ok(scopedItems.some((item) => item.id === ownItemId));
    assert.ok(
      scopedItems.every((item) => item.id !== operatorItemId),
      "owner-scoped catalog item reads must exclude foreign items"
    );

    const ownItemSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers,
      payload: {
        searches: [
          {
            entityTypes: ["preference_catalog_item"],
            ids: [ownItemId],
            userIds: ["user_forge_bot"],
            limit: 1
          }
        ]
      }
    });
    assert.equal(ownItemSearch.statusCode, 200);
    assert.equal(ownItemSearch.json().results[0]?.matches?.length, 1);

    const forbiddenItemMutations = await app.inject({
      method: "POST",
      url: "/api/v1/entities/update",
      headers,
      payload: {
        atomic: false,
        operations: [
          {
            entityType: "preference_catalog_item",
            id: operatorItemId,
            patch: { label: "Scope escape" }
          }
        ]
      }
    });
    assert.equal(forbiddenItemMutations.statusCode, 200);
    assert.equal(forbiddenItemMutations.json().results[0]?.ok, false);
    assert.equal(
      forbiddenItemMutations.json().results[0]?.error?.code,
      "user_scope_forbidden"
    );

    const forbiddenItemCreate = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers,
      payload: {
        atomic: true,
        operations: [
          {
            entityType: "preference_catalog_item",
            data: { catalogId: operatorCatalogId, label: "Scope escape" }
          }
        ]
      }
    });
    assert.equal(forbiddenItemCreate.statusCode, 200);
    assert.equal(forbiddenItemCreate.json().results[0]?.ok, false);
    assert.equal(
      forbiddenItemCreate.json().results[0]?.error?.code,
      "user_scope_forbidden"
    );

    const forbiddenItemDelete = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers,
      payload: {
        atomic: true,
        operations: [
          { entityType: "preference_catalog_item", id: operatorItemId }
        ]
      }
    });
    assert.equal(forbiddenItemDelete.statusCode, 200);
    assert.equal(forbiddenItemDelete.json().results[0]?.ok, false);
    assert.equal(
      forbiddenItemDelete.json().results[0]?.error?.code,
      "user_scope_forbidden"
    );

    const unchangedOperatorItem = await app.inject({
      method: "GET",
      url: `/api/v1/preferences/catalog-items/${operatorItemId}`,
      headers: { cookie }
    });
    assert.equal(unchangedOperatorItem.statusCode, 200);
    assert.equal(
      unchangedOperatorItem.json().item.label,
      "Private operator choice"
    );
    await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: { cookie },
      payload: {
        atomic: true,
        operations: [
          { entityType: "preference_catalog", id: operatorCatalogId }
        ]
      }
    });

    const forbiddenRestore = await app.inject({
      method: "POST",
      url: "/api/v1/entities/restore",
      headers,
      payload: {
        atomic: true,
        operations: [
          { entityType: "preference_catalog", id: operatorCatalogId }
        ]
      }
    });
    assert.equal(forbiddenRestore.statusCode, 200);
    assert.equal(forbiddenRestore.json().results[0]?.ok, false);
    assert.equal(
      forbiddenRestore.json().results[0]?.error?.code,
      "user_scope_forbidden"
    );

    const stillArchived = await app.inject({
      method: "GET",
      url: `/api/v1/preferences/catalogs/${operatorCatalogId}`,
      headers: { cookie }
    });
    assert.equal(stillArchived.statusCode, 404);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("direct preference catalog archive is idempotent and returns a stable archived entity", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-pref-catalog-direct-archive-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const cookie = await issueOperatorSessionCookie(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/catalogs",
      headers: { cookie },
      payload: catalogPayload("Direct archive catalog")
    });
    assert.equal(created.statusCode, 201);
    const catalogId = (created.json() as { catalog: { id: string } }).catalog
      .id;

    const first = await app.inject({
      method: "DELETE",
      url: `/api/v1/preferences/catalogs/${catalogId}`,
      headers: { cookie }
    });
    const second = await app.inject({
      method: "DELETE",
      url: `/api/v1/preferences/catalogs/${catalogId}`,
      headers: { cookie }
    });
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    const firstCatalog = first.json().catalog as {
      id: string;
      archived: boolean;
      updatedAt: string;
    };
    const secondCatalog = second.json().catalog as typeof firstCatalog;
    assert.equal(firstCatalog.id, catalogId);
    assert.equal(firstCatalog.archived, true);
    assert.deepEqual(secondCatalog, firstCatalog);

    const missing = await app.inject({
      method: "DELETE",
      url: "/api/v1/preferences/catalogs/catalog_missing",
      headers: { cookie }
    });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error, "Preferences catalog not found");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("preference catalog archive and restore preserve links and independently deleted concepts", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-pref-catalog-lifecycle-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const cookie = await issueOperatorSessionCookie(app);
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/catalogs",
      headers: { cookie },
      payload: catalogPayload(
        "Lifecycle catalog",
        "user_operator",
        firstSeededGoalLink()
      )
    });
    const catalogId = (create.json() as { catalog: { id: string } }).catalog.id;
    const itemIds: string[] = [];
    for (const label of ["Keep archived", "Restore with parent"]) {
      const item = await app.inject({
        method: "POST",
        url: "/api/v1/preferences/catalog-items",
        headers: { cookie },
        payload: { catalogId, label }
      });
      itemIds.push((item.json() as { item: { id: string } }).item.id);
    }
    getDatabase()
      .prepare(
        `INSERT INTO entity_links (
           source_entity_type, source_entity_id, target_entity_type,
           target_entity_id, anchor_key, relationship, created_by_actor,
           created_at
         ) VALUES (
           'preference_catalog_item', ?, 'goal', 'goal_test', '', 'supports',
           'Preference lifecycle test', ?
         )`
      )
      .run(itemIds[0], new Date().toISOString());
    const deletedConcept = await app.inject({
      method: "DELETE",
      url: `/api/v1/preferences/catalog-items/${itemIds[0]}`,
      headers: { cookie }
    });
    const repeatedConceptDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/preferences/catalog-items/${itemIds[0]}`,
      headers: { cookie }
    });
    assert.equal(deletedConcept.statusCode, 200);
    assert.equal(repeatedConceptDelete.statusCode, 200);
    assert.equal(deletedConcept.json().item.id, itemIds[0]);
    assert.equal(repeatedConceptDelete.json().item.id, itemIds[0]);

    const archived = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: { cookie },
      payload: {
        atomic: true,
        operations: [{ entityType: "preference_catalog", id: catalogId }]
      }
    });
    assert.equal(archived.statusCode, 200);
    assert.equal(archived.json().results[0]?.ok, true);
    assert.equal(archived.json().results[0]?.entity?.archived, true);

    const blockedItemRestore = await app.inject({
      method: "POST",
      url: "/api/v1/entities/restore",
      headers: { cookie },
      payload: {
        atomic: true,
        operations: [{ entityType: "preference_catalog_item", id: itemIds[0] }]
      }
    });
    assert.equal(blockedItemRestore.statusCode, 200);
    assert.equal(blockedItemRestore.json().results[0]?.ok, false);
    assert.equal(
      blockedItemRestore.json().results[0]?.error?.code,
      "preferences_catalog_item_parent_archived"
    );

    const timestamp = new Date().toISOString();
    getDatabase()
      .prepare(
        `INSERT INTO preference_catalog_items (
           id, catalog_id, label, description, tags_json,
           feature_weights_json, position, archived, created_at, updated_at
         ) VALUES (?, ?, 'Restore with parent', '', '[]', '{}', 99, 0, ?, ?)`
      )
      .run("catalog_item_restore_conflict", catalogId, timestamp, timestamp);
    const blockedRestore = await app.inject({
      method: "POST",
      url: "/api/v1/entities/restore",
      headers: { cookie },
      payload: {
        atomic: true,
        operations: [{ entityType: "preference_catalog", id: catalogId }]
      }
    });
    assert.equal(blockedRestore.statusCode, 200);
    assert.equal(blockedRestore.json().results[0]?.ok, false);
    assert.equal(
      blockedRestore.json().results[0]?.error?.code,
      "preferences_catalog_item_restore_conflict"
    );
    assert.equal(
      (
        getDatabase()
          .prepare(`SELECT archived FROM preference_catalogs WHERE id = ?`)
          .get(catalogId) as { archived: number }
      ).archived,
      1,
      "a conflicted restore must leave the full catalog archived"
    );
    getDatabase()
      .prepare(`DELETE FROM preference_catalog_items WHERE id = ?`)
      .run("catalog_item_restore_conflict");

    const restored = await app.inject({
      method: "POST",
      url: "/api/v1/entities/restore",
      headers: { cookie },
      payload: {
        atomic: true,
        operations: [{ entityType: "preference_catalog", id: catalogId }]
      }
    });
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.json().results[0]?.ok, true);

    const firstItem = await app.inject({
      method: "GET",
      url: `/api/v1/preferences/catalog-items/${itemIds[0]}`,
      headers: { cookie }
    });
    const secondItem = await app.inject({
      method: "GET",
      url: `/api/v1/preferences/catalog-items/${itemIds[1]}`,
      headers: { cookie }
    });
    assert.equal(firstItem.statusCode, 404);
    assert.equal(secondItem.statusCode, 200);
    const deletedItemState = getDatabase()
      .prepare(
        `SELECT
           (SELECT archived FROM preference_catalog_items WHERE id = ?) AS archived,
           (SELECT COUNT(*) FROM entity_owners
             WHERE entity_type = 'preference_catalog_item' AND entity_id = ?) AS owner_count,
           (SELECT COUNT(*) FROM entity_links
             WHERE (source_entity_type = 'preference_catalog_item' AND source_entity_id = ?)
                OR (target_entity_type = 'preference_catalog_item' AND target_entity_id = ?)) AS link_count,
           (SELECT COUNT(*) FROM deleted_entities
             WHERE entity_type = 'preference_catalog_item' AND entity_id = ?) AS bin_count`
      )
      .get(itemIds[0], itemIds[0], itemIds[0], itemIds[0], itemIds[0]) as {
      archived: number;
      owner_count: number;
      link_count: number;
      bin_count: number;
    };
    assert.equal(deletedItemState.archived, 1);
    assert.equal(deletedItemState.owner_count, 1);
    assert.equal(deletedItemState.link_count, 1);
    assert.equal(deletedItemState.bin_count, 1);

    const restoredItem = await app.inject({
      method: "POST",
      url: "/api/v1/entities/restore",
      headers: { cookie },
      payload: {
        atomic: true,
        operations: [{ entityType: "preference_catalog_item", id: itemIds[0] }]
      }
    });
    assert.equal(restoredItem.statusCode, 200);
    assert.equal(restoredItem.json().results[0]?.ok, true);
    const visibleRestoredItem = await app.inject({
      method: "GET",
      url: `/api/v1/preferences/catalog-items/${itemIds[0]}`,
      headers: { cookie }
    });
    assert.equal(visibleRestoredItem.statusCode, 200);

    const catalog = await app.inject({
      method: "GET",
      url: `/api/v1/preferences/catalogs/${catalogId}`,
      headers: { cookie }
    });
    assert.equal(
      (catalog.json() as { catalog: { links: unknown[] } }).catalog.links
        .length,
      1
    );

    getDatabase()
      .prepare(
        `INSERT INTO entity_links (
           source_entity_type, source_entity_id, target_entity_type,
           target_entity_id, anchor_key, relationship, created_by_actor,
           created_at
         ) VALUES (
           'preference_catalog_item', ?, 'goal', 'goal_test', '', 'supports',
           'Preference lifecycle test', ?
         )`
      )
      .run(itemIds[1], new Date().toISOString());

    assert.deepEqual(
      listPreferenceCatalogHardDeleteDescendants(catalogId),
      [...itemIds].sort().map((entityId) => ({
        entityType: "preference_catalog_item" as const,
        entityId
      }))
    );

    const hardDeleted = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: { cookie },
      payload: {
        atomic: true,
        operations: [
          { entityType: "preference_catalog", id: catalogId, mode: "hard" }
        ]
      }
    });
    assert.equal(hardDeleted.statusCode, 200);
    assert.equal(hardDeleted.json().results[0]?.ok, true);

    const database = getDatabase();
    const catalogCount = database
      .prepare(`SELECT COUNT(*) AS count FROM preference_catalogs WHERE id = ?`)
      .get(catalogId) as { count: number };
    const linkCount = database
      .prepare(
        `SELECT COUNT(*) AS count FROM entity_links
         WHERE (source_entity_type = 'preference_catalog' AND source_entity_id = ?)
            OR (target_entity_type = 'preference_catalog' AND target_entity_id = ?)
            OR (source_entity_type = 'preference_catalog_item' AND source_entity_id = ?)
            OR (target_entity_type = 'preference_catalog_item' AND target_entity_id = ?)`
      )
      .get(catalogId, catalogId, itemIds[1], itemIds[1]) as { count: number };
    const ownerCount = database
      .prepare(
        `SELECT COUNT(*) AS count FROM entity_owners
         WHERE (entity_type = 'preference_catalog' AND entity_id = ?)
            OR (entity_type = 'preference_catalog_item' AND entity_id = ?)`
      )
      .get(catalogId, itemIds[1]) as { count: number };
    assert.equal(catalogCount.count, 0);
    assert.equal(linkCount.count, 0);
    assert.equal(ownerCount.count, 0);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("preference catalog search filters before limits and bounds embedded items", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-pref-catalog-bounds-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const cookie = await issueOperatorSessionCookie(app);
    const catalog = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/catalogs",
      headers: { cookie },
      payload: catalogPayload("Large bounded catalog")
    });
    assert.equal(catalog.statusCode, 201);
    const catalogId = (catalog.json() as { catalog: { id: string } }).catalog
      .id;
    const strictCreate = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/catalog-items",
      headers: { cookie },
      payload: {
        catalogId,
        label: "Unknown create field",
        archived: false
      }
    });
    assert.equal(strictCreate.statusCode, 400);

    let firstItemId = "";
    let lastItemId = "";
    for (let index = 0; index < 205; index += 1) {
      const item = await app.inject({
        method: "POST",
        url: "/api/v1/preferences/catalog-items",
        headers: { cookie },
        payload: { catalogId, label: `Bounded choice ${index + 1}` }
      });
      assert.equal(item.statusCode, 201);
      lastItemId = (item.json() as { item: { id: string } }).item.id;
      firstItemId ||= lastItemId;
    }

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/preferences/catalogs/${catalogId}`,
      headers: { cookie }
    });
    assert.equal(detail.statusCode, 200);
    const boundedCatalog = detail.json().catalog as {
      itemCount: number;
      itemsTruncated: boolean;
      items: unknown[];
    };
    assert.equal(boundedCatalog.itemCount, 205);
    assert.equal(boundedCatalog.itemsTruncated, true);
    assert.equal(boundedCatalog.items.length, 24);

    const duplicateItem = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/catalog-items",
      headers: { cookie },
      payload: { catalogId, label: "  bounded CHOICE 1  " }
    });
    assert.equal(duplicateItem.statusCode, 409);
    assert.equal(
      duplicateItem.json().code,
      "preferences_catalog_item_duplicate"
    );

    const duplicateUpdate = await app.inject({
      method: "PATCH",
      url: `/api/v1/preferences/catalog-items/${lastItemId}`,
      headers: { cookie },
      payload: { label: "  bounded CHOICE 1  " }
    });
    assert.equal(duplicateUpdate.statusCode, 409);
    assert.equal(
      duplicateUpdate.json().code,
      "preferences_catalog_item_duplicate"
    );

    const strictUpdate = await app.inject({
      method: "PATCH",
      url: `/api/v1/preferences/catalog-items/${lastItemId}`,
      headers: { cookie },
      payload: { description: "Still valid", archived: false }
    });
    assert.equal(strictUpdate.statusCode, 400);

    const firstItemAfterRejectedUpdates = await app.inject({
      method: "GET",
      url: `/api/v1/preferences/catalog-items/${firstItemId}`,
      headers: { cookie }
    });
    const lastItemAfterRejectedUpdates = await app.inject({
      method: "GET",
      url: `/api/v1/preferences/catalog-items/${lastItemId}`,
      headers: { cookie }
    });
    assert.equal(firstItemAfterRejectedUpdates.statusCode, 200);
    assert.equal(lastItemAfterRejectedUpdates.statusCode, 200);
    assert.equal(
      lastItemAfterRejectedUpdates.json().item.label,
      "Bounded choice 205"
    );

    const deepCatalogSearch = await app.inject({
      method: "GET",
      url: "/api/v1/preferences/catalogs?domain=food&query=Bounded%20choice%20205&limit=24",
      headers: { cookie }
    });
    assert.equal(deepCatalogSearch.statusCode, 200);
    assert.equal(deepCatalogSearch.json().catalogs.length, 1);
    assert.equal(deepCatalogSearch.json().catalogs[0]?.id, catalogId);
    assert.equal(deepCatalogSearch.json().catalogs[0]?.matchingItemCount, 1);
    assert.equal(
      deepCatalogSearch.json().catalogs[0]?.items[0]?.id,
      lastItemId
    );

    const titleOnlyCatalogSearch = await app.inject({
      method: "GET",
      url: "/api/v1/preferences/catalogs?domain=food&query=Large%20bounded%20catalog&limit=24",
      headers: { cookie }
    });
    assert.equal(titleOnlyCatalogSearch.statusCode, 200);
    assert.equal(titleOnlyCatalogSearch.json().catalogs.length, 1);
    assert.equal(
      titleOnlyCatalogSearch.json().catalogs[0]?.matchingItemCount,
      0
    );
    assert.equal(titleOnlyCatalogSearch.json().catalogs[0]?.items.length, 0);
    assert.equal(
      titleOnlyCatalogSearch.json().catalogs[0]?.itemsTruncated,
      false
    );

    const nextItemPage = await app.inject({
      method: "GET",
      url: `/api/v1/preferences/catalog-items?catalogId=${catalogId}&limit=5&offset=200`,
      headers: { cookie }
    });
    assert.equal(nextItemPage.statusCode, 200);
    assert.equal(nextItemPage.json().items.length, 5);
    assert.equal(nextItemPage.json().items[4]?.id, lastItemId);
    assert.equal(nextItemPage.json().hasMore, false);
    assert.equal(nextItemPage.json().previousOffset, 195);

    const exactSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: { cookie },
      payload: {
        searches: [
          {
            entityTypes: ["preference_catalog_item"],
            ids: [lastItemId],
            limit: 1
          }
        ]
      }
    });
    assert.equal(exactSearch.statusCode, 200);
    assert.equal(exactSearch.json().results[0]?.matches?.[0]?.id, lastItemId);

    const oversizedBatchFilter = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: { cookie },
      payload: {
        searches: [
          {
            entityTypes: ["preference_catalog_item"],
            ids: Array.from({ length: 201 }, (_, index) => `item-${index}`),
            limit: 1
          }
        ]
      }
    });
    assert.equal(oversizedBatchFilter.statusCode, 400);
    assert.equal(
      oversizedBatchFilter.json().code,
      "preferences_search_filter_limit_exceeded"
    );

    const oversizedBatchQuery = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: { cookie },
      payload: {
        searches: [
          {
            entityTypes: ["preference_catalog"],
            query: "q".repeat(201),
            limit: 1
          }
        ]
      }
    });
    assert.equal(oversizedBatchQuery.statusCode, 400);
    assert.equal(
      oversizedBatchQuery.json().code,
      "preferences_search_query_too_long"
    );

    let lastCatalogId = "";
    for (let index = 0; index < 205; index += 1) {
      const extraCatalog = await app.inject({
        method: "POST",
        url: "/api/v1/preferences/catalogs",
        headers: { cookie },
        payload: catalogPayload(
          index === 204 ? "Far catalog needle" : `Scale catalog ${index + 1}`
        )
      });
      assert.equal(extraCatalog.statusCode, 201);
      lastCatalogId = (extraCatalog.json() as { catalog: { id: string } })
        .catalog.id;
    }
    const catalogSearch = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: { cookie },
      payload: {
        searches: [
          {
            entityTypes: ["preference_catalog"],
            query: "Far catalog needle",
            limit: 1
          }
        ]
      }
    });
    assert.equal(catalogSearch.statusCode, 200);
    assert.equal(
      catalogSearch.json().results[0]?.matches?.[0]?.id,
      lastCatalogId
    );

    const workspace = await app.inject({
      method: "GET",
      url: "/api/v1/preferences/workspace?userId=user_operator&domain=food",
      headers: { cookie }
    });
    assert.equal(workspace.statusCode, 200);
    assert.ok(workspace.json().workspace.catalogs.length <= 24);
    assert.ok(workspace.json().workspace.libraries.totalCatalogs > 24);
    assert.ok(workspace.json().workspace.libraries.totalCatalogItems >= 205);

    const catalogPage = await app.inject({
      method: "GET",
      url: "/api/v1/preferences/catalogs?domain=food",
      headers: { cookie }
    });
    assert.equal(catalogPage.statusCode, 200);
    assert.equal(catalogPage.json().catalogs.length, 24);
    assert.equal(catalogPage.json().hasMore, true);
    assert.equal(catalogPage.json().nextOffset, 24);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("preference catalog cursors are snapshot-stable, query-bound, and reject malformed input", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-pref-catalog-cursor-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  try {
    const cookie = await issueOperatorSessionCookie(app);
    const originalCatalogIds: string[] = [];
    for (const suffix of ["Alpha", "Beta", "Gamma"]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/preferences/catalogs",
        headers: { cookie },
        payload: catalogPayload(`Cursor stable ${suffix}`)
      });
      assert.equal(response.statusCode, 201, response.body);
      originalCatalogIds.push(response.json().catalog.id as string);
    }

    const catalogUrl =
      "/api/v1/preferences/catalogs?domain=food&query=Cursor%20stable&limit=1";
    const firstCatalogPage = await app.inject({
      method: "GET",
      url: catalogUrl,
      headers: { cookie }
    });
    assert.equal(firstCatalogPage.statusCode, 200, firstCatalogPage.body);
    assert.equal(firstCatalogPage.json().catalogs.length, 1);
    assert.equal(typeof firstCatalogPage.json().snapshotAt, "string");
    assert.equal(typeof firstCatalogPage.json().nextCursor, "string");

    const lateCatalog = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/catalogs",
      headers: { cookie },
      payload: catalogPayload("Cursor stable Late")
    });
    assert.equal(lateCatalog.statusCode, 201, lateCatalog.body);
    const lateCatalogId = lateCatalog.json().catalog.id as string;

    const pagedCatalogIds = [firstCatalogPage.json().catalogs[0].id as string];
    let catalogCursor = firstCatalogPage.json().nextCursor as string | null;
    while (catalogCursor) {
      const page = await app.inject({
        method: "GET",
        url: `${catalogUrl}&cursor=${encodeURIComponent(catalogCursor)}`,
        headers: { cookie }
      });
      assert.equal(page.statusCode, 200, page.body);
      pagedCatalogIds.push(
        ...(page.json().catalogs as Array<{ id: string }>).map(
          (catalog) => catalog.id
        )
      );
      catalogCursor = page.json().nextCursor as string | null;
    }
    assert.deepEqual(
      [...pagedCatalogIds].sort(),
      [...originalCatalogIds].sort()
    );
    assert.equal(new Set(pagedCatalogIds).size, pagedCatalogIds.length);
    assert.ok(!pagedCatalogIds.includes(lateCatalogId));

    const malformed = await app.inject({
      method: "GET",
      url: `${catalogUrl}&cursor=not-a-valid-cursor`,
      headers: { cookie }
    });
    assert.equal(malformed.statusCode, 400);
    assert.equal(malformed.json().code, "preferences_invalid_cursor");

    const rebound = await app.inject({
      method: "GET",
      url: `/api/v1/preferences/catalogs?domain=fashion&query=Cursor%20stable&limit=1&cursor=${encodeURIComponent(firstCatalogPage.json().nextCursor as string)}`,
      headers: { cookie }
    });
    assert.equal(rebound.statusCode, 400);
    assert.equal(rebound.json().code, "preferences_invalid_cursor");

    const catalogId = originalCatalogIds[0]!;
    const originalItemIds: string[] = [];
    for (const label of [
      "Cursor item one",
      "Cursor item two",
      "Cursor item three"
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/preferences/catalog-items",
        headers: { cookie },
        payload: { catalogId, label }
      });
      assert.equal(response.statusCode, 201, response.body);
      originalItemIds.push(response.json().item.id as string);
    }

    const itemUrl = `/api/v1/preferences/catalog-items?catalogId=${catalogId}&limit=1`;
    const firstItemPage = await app.inject({
      method: "GET",
      url: itemUrl,
      headers: { cookie }
    });
    assert.equal(firstItemPage.statusCode, 200, firstItemPage.body);
    assert.equal(typeof firstItemPage.json().nextCursor, "string");

    const lateItem = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/catalog-items",
      headers: { cookie },
      payload: { catalogId, label: "Cursor item late" }
    });
    assert.equal(lateItem.statusCode, 201, lateItem.body);
    const lateItemId = lateItem.json().item.id as string;

    const pagedItemIds = [firstItemPage.json().items[0].id as string];
    let itemCursor = firstItemPage.json().nextCursor as string | null;
    while (itemCursor) {
      const page = await app.inject({
        method: "GET",
        url: `${itemUrl}&cursor=${encodeURIComponent(itemCursor)}`,
        headers: { cookie }
      });
      assert.equal(page.statusCode, 200, page.body);
      pagedItemIds.push(
        ...(page.json().items as Array<{ id: string }>).map((item) => item.id)
      );
      itemCursor = page.json().nextCursor as string | null;
    }
    assert.deepEqual([...pagedItemIds].sort(), [...originalItemIds].sort());
    assert.equal(new Set(pagedItemIds).size, pagedItemIds.length);
    assert.ok(!pagedItemIds.includes(lateItemId));

    const mixedPagingModes = await app.inject({
      method: "GET",
      url: `${itemUrl}&offset=1&cursor=${encodeURIComponent(firstItemPage.json().nextCursor as string)}`,
      headers: { cookie }
    });
    assert.equal(mixedPagingModes.statusCode, 400);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
