import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { createGoal } from "./repositories/goals.js";

const issueOperatorSessionCookie = issueTestOperatorSessionCookie;

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
      label: "Preference entity CRUD regression",
      agentLabel: "PREF entity CRUD test",
      scopes: ["read", "write"],
      scopePolicy: { userIds: [userId], projectIds: [], tagIds: [] }
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { token: { token: string } }).token.token;
}

function batchResult(response: {
  statusCode: number;
  body: string;
  json: () => unknown;
}) {
  assert.equal(response.statusCode, 200, response.body);
  return (
    response.json() as {
      results: Array<{
        ok: boolean;
        id?: string;
        entity?: Record<string, unknown>;
        error?: { code: string; message: string };
      }>;
    }
  ).results[0]!;
}

function preferenceItemData(
  label: string,
  source?: { entityType: string; entityId: string }
) {
  return {
    userId: "user_operator",
    domain: "projects",
    label,
    description: "Preference source ACL regression fixture.",
    tags: [],
    featureWeights: {},
    metadata: {},
    queueForCompare: false,
    ...(source
      ? {
          sourceEntityType: source.entityType,
          sourceEntityId: source.entityId
        }
      : {})
  };
}

test("batch preference item source links reuse source ACLs on create and update", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-pref-entity-source-acl-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: true,
    devrageMetricSync: false
  });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const token = await issueScopedToken(app, cookie, "user_operator");
    const headers = { authorization: `Bearer ${token}` };
    const createSpace = async (
      label: string,
      visibility: "personal" | "shared"
    ) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/wiki/spaces",
        headers: { cookie },
        payload: { label, ownerUserId: "user_forge_bot", visibility }
      });
      assert.equal(response.statusCode, 201, response.body);
      return response.json().space.id as string;
    };
    const createPage = async (spaceId: string, title: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/wiki/pages",
        headers: { cookie },
        payload: {
          spaceId,
          title,
          contentMarkdown: `# ${title}`,
          summary: `${title} summary`,
          links: []
        }
      });
      assert.equal(response.statusCode, 201, response.body);
      return response.json().page.id as string;
    };
    const privatePageId = await createPage(
      await createSpace("PREF private source", "personal"),
      "PREF private source"
    );
    const sharedCreatePageId = await createPage(
      await createSpace("PREF shared create source", "shared"),
      "PREF shared create source"
    );
    const sharedUpdatePageId = await createPage(
      await createSpace("PREF shared update source", "shared"),
      "PREF shared update source"
    );
    const foreignGoal = createGoal({
      title: "PREF foreign source goal",
      description: "Private to another Forge user.",
      horizon: "quarter",
      status: "active",
      targetPoints: 100,
      themeColor: "#446688",
      tagIds: [],
      notes: [],
      userId: "user_forge_bot"
    });

    const createLinkedItem = async (
      label: string,
      source: { entityType: string; entityId: string }
    ) =>
      batchResult(
        await app.inject({
          method: "POST",
          url: "/api/v1/entities/create",
          headers,
          payload: {
            atomic: true,
            operations: [
              {
                entityType: "preference_item",
                data: preferenceItemData(label, source)
              }
            ]
          }
        })
      );

    const privateCreate = await createLinkedItem("Denied private create", {
      entityType: "note",
      entityId: privatePageId
    });
    const missingNoteCreate = await createLinkedItem("Denied missing create", {
      entityType: "note",
      entityId: "note_missing_pref_acl"
    });
    assert.equal(privateCreate.ok, false);
    assert.deepEqual(privateCreate.error, missingNoteCreate.error);
    assert.equal(privateCreate.error?.code, "note_not_found");

    const foreignCreate = await createLinkedItem("Denied foreign create", {
      entityType: "goal",
      entityId: foreignGoal.id
    });
    const missingGoalCreate = await createLinkedItem("Denied missing goal", {
      entityType: "goal",
      entityId: "goal_missing_pref_acl"
    });
    assert.equal(foreignCreate.ok, false);
    assert.deepEqual(foreignCreate.error, missingGoalCreate.error);
    assert.equal(
      foreignCreate.error?.code,
      "preferences_source_entity_not_found"
    );

    const allowedCreate = await createLinkedItem("Allowed shared create", {
      entityType: "note",
      entityId: sharedCreatePageId
    });
    assert.equal(allowedCreate.ok, true);

    const updateTarget = batchResult(
      await app.inject({
        method: "POST",
        url: "/api/v1/entities/create",
        headers,
        payload: {
          atomic: true,
          operations: [
            {
              entityType: "preference_item",
              data: preferenceItemData("PREF source update target")
            }
          ]
        }
      })
    );
    assert.equal(updateTarget.ok, true);
    const updateTargetId = String(updateTarget.id);
    const updateSource = async (entityType: string, entityId: string) =>
      batchResult(
        await app.inject({
          method: "POST",
          url: "/api/v1/entities/update",
          headers,
          payload: {
            atomic: true,
            operations: [
              {
                entityType: "preference_item",
                id: updateTargetId,
                patch: {
                  sourceEntityType: entityType,
                  sourceEntityId: entityId
                }
              }
            ]
          }
        })
      );

    const privateUpdate = await updateSource("note", privatePageId);
    const missingNoteUpdate = await updateSource(
      "note",
      "note_missing_pref_update_acl"
    );
    assert.equal(privateUpdate.ok, false);
    assert.deepEqual(privateUpdate.error, missingNoteUpdate.error);
    assert.equal(privateUpdate.error?.code, "note_not_found");

    const foreignUpdate = await updateSource("goal", foreignGoal.id);
    const missingGoalUpdate = await updateSource(
      "goal",
      "goal_missing_pref_update_acl"
    );
    assert.equal(foreignUpdate.ok, false);
    assert.deepEqual(foreignUpdate.error, missingGoalUpdate.error);
    assert.equal(
      foreignUpdate.error?.code,
      "preferences_source_entity_not_found"
    );

    const unchanged = getDatabase()
      .prepare(
        `SELECT source_entity_type, source_entity_id
         FROM preference_items
         WHERE id = ?`
      )
      .get(updateTargetId) as {
      source_entity_type: string | null;
      source_entity_id: string | null;
    };
    assert.equal(unchanged.source_entity_type, null);
    assert.equal(unchanged.source_entity_id, null);

    const allowedUpdate = await updateSource("note", sharedUpdatePageId);
    assert.equal(allowedUpdate.ok, true);
    assert.equal(allowedUpdate.entity?.sourceEntityType, "note");
    assert.equal(allowedUpdate.entity?.sourceEntityId, sharedUpdatePageId);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("catalog hard delete atomically purges archived descendant bin records", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-pref-catalog-descendant-bin-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: true,
    devrageMetricSync: false
  });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const catalogResponse = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/catalogs",
      headers: { cookie },
      payload: {
        userId: "user_operator",
        domain: "projects",
        title: "PREF descendant tombstone catalog",
        description: "Atomic hard-delete regression fixture.",
        scopeIn: "Catalog descendants.",
        scopeOut: "Unrelated records.",
        links: []
      }
    });
    assert.equal(catalogResponse.statusCode, 201, catalogResponse.body);
    const catalogId = catalogResponse.json().catalog.id as string;
    const itemIds: string[] = [];
    for (const label of ["Independently archived", "Parent archived"]) {
      const itemResponse = await app.inject({
        method: "POST",
        url: "/api/v1/preferences/catalog-items",
        headers: { cookie },
        payload: { catalogId, label }
      });
      assert.equal(itemResponse.statusCode, 201, itemResponse.body);
      itemIds.push(itemResponse.json().item.id as string);
    }

    const archivedItem = await app.inject({
      method: "DELETE",
      url: `/api/v1/preferences/catalog-items/${itemIds[0]}`,
      headers: { cookie }
    });
    assert.equal(archivedItem.statusCode, 200, archivedItem.body);
    const independentlyArchivedItemCount = () =>
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count
             FROM deleted_entities
             WHERE entity_type = 'preference_catalog_item'
               AND entity_id = ?`
          )
          .get(itemIds[0]) as { count: number }
      ).count;
    assert.equal(
      independentlyArchivedItemCount(),
      1,
      "the child must have its own bin record before the parent is archived"
    );
    const archivedCatalog = await app.inject({
      method: "DELETE",
      url: `/api/v1/preferences/catalogs/${catalogId}`,
      headers: { cookie }
    });
    assert.equal(archivedCatalog.statusCode, 200, archivedCatalog.body);

    const deletedCount = () =>
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count
             FROM deleted_entities
             WHERE (entity_type = 'preference_catalog' AND entity_id = ?)
                OR (entity_type = 'preference_catalog_item' AND entity_id = ?)`
          )
          .get(catalogId, itemIds[0]) as { count: number }
      ).count;
    assert.equal(deletedCount(), 2);

    getDatabase().exec(
      `CREATE TRIGGER pref_catalog_delete_regression_block
       BEFORE DELETE ON preference_catalogs
       BEGIN
         SELECT RAISE(ABORT, 'blocked by atomicity regression');
       END`
    );
    const blockedDelete = batchResult(
      await app.inject({
        method: "POST",
        url: "/api/v1/entities/delete",
        headers: { cookie },
        payload: {
          atomic: true,
          operations: [
            { entityType: "preference_catalog", id: catalogId, mode: "hard" }
          ]
        }
      })
    );
    assert.equal(blockedDelete.ok, false);
    assert.equal(
      deletedCount(),
      2,
      "failed hard delete must restore tombstones"
    );
    assert.equal(
      independentlyArchivedItemCount(),
      1,
      "failed hard delete must retain the independently archived child"
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count FROM preference_catalogs WHERE id = ?`
          )
          .get(catalogId) as { count: number }
      ).count,
      1
    );

    getDatabase().exec(`DROP TRIGGER pref_catalog_delete_regression_block`);
    const hardDelete = batchResult(
      await app.inject({
        method: "POST",
        url: "/api/v1/entities/delete",
        headers: { cookie },
        payload: {
          atomic: true,
          operations: [
            { entityType: "preference_catalog", id: catalogId, mode: "hard" }
          ]
        }
      })
    );
    assert.equal(hardDelete.ok, true);
    assert.equal(deletedCount(), 0);
    const finalState = getDatabase()
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM preference_catalogs WHERE id = ?) AS catalogs,
           (SELECT COUNT(*) FROM preference_catalog_items WHERE catalog_id = ?) AS items,
           (SELECT COUNT(*) FROM deleted_entities
             WHERE entity_type = 'preference_catalog_item'
               AND entity_id IN (?, ?)) AS descendant_bin_records`
      )
      .get(catalogId, catalogId, itemIds[0], itemIds[1]) as {
      catalogs: number;
      items: number;
      descendant_bin_records: number;
    };
    assert.deepEqual(
      { ...finalState },
      {
        catalogs: 0,
        items: 0,
        descendant_bin_records: 0
      }
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});
