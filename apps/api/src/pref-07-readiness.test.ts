import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

test("PREF-07 keeps one general backlink for a linked preference candidate", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "forge-pref-07-"));
  const app = await buildServer({
    dataRoot,
    seedDemoData: true,
    devrageMetricSync: false
  });

  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const goalsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/goals",
      headers: { cookie }
    });
    assert.equal(goalsResponse.statusCode, 200, goalsResponse.body);
    const goalId = (goalsResponse.json() as { goals: Array<{ id: string }> })
      .goals[0]?.id;
    assert.ok(goalId);
    const projectsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: { cookie }
    });
    assert.equal(projectsResponse.statusCode, 200, projectsResponse.body);
    const projectId = (
      projectsResponse.json() as { projects: Array<{ id: string }> }
    ).projects[0]?.id;
    assert.ok(projectId);

    const payload = {
      userId: "user_operator",
      domain: "projects",
      entityType: "goal",
      entityId: goalId,
      tags: []
    };
    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/items/from-entity",
      headers: { cookie },
      payload
    });
    assert.equal(firstResponse.statusCode, 201, firstResponse.body);
    const itemId = (firstResponse.json() as { item: { id: string } }).item.id;

    const replayResponse = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/items/from-entity",
      headers: { cookie },
      payload
    });
    assert.equal(replayResponse.statusCode, 201, replayResponse.body);
    assert.equal(
      (replayResponse.json() as { item: { id: string } }).item.id,
      itemId
    );

    const readSourceLinks = () =>
      (
        getDatabase()
          .prepare(
            `SELECT source_entity_type, source_entity_id, target_entity_type,
                    target_entity_id, relationship
             FROM entity_links
             WHERE source_entity_type = 'preference_item'
               AND source_entity_id = ?`
          )
          .all(itemId) as Array<{
          source_entity_type: string;
          source_entity_id: string;
          target_entity_type: string;
          target_entity_id: string;
          relationship: string;
        }>
      ).map((link) => ({ ...link }));
    assert.deepEqual(readSourceLinks(), [
      {
        source_entity_type: "preference_item",
        source_entity_id: itemId,
        target_entity_type: "goal",
        target_entity_id: goalId,
        relationship: "source"
      }
    ]);

    const relinkResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/preferences/items/${itemId}`,
      headers: { cookie },
      payload: {
        sourceEntityType: "project",
        sourceEntityId: projectId
      }
    });
    assert.equal(relinkResponse.statusCode, 200, relinkResponse.body);
    assert.deepEqual(readSourceLinks(), [
      {
        source_entity_type: "preference_item",
        source_entity_id: itemId,
        target_entity_type: "project",
        target_entity_id: projectId,
        relationship: "source"
      }
    ]);

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/preferences/items/${itemId}`,
      headers: { cookie }
    });
    assert.equal(deleteResponse.statusCode, 200, deleteResponse.body);
    const remainingLinkCount = (
      getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count
           FROM entity_links
           WHERE source_entity_type = 'preference_item'
             AND source_entity_id = ?`
        )
        .get(itemId) as { count: number }
    ).count;
    assert.equal(remainingLinkCount, 0);

    const insightResponse = await app.inject({
      method: "POST",
      url: "/api/v1/insights",
      headers: { cookie },
      payload: {
        originType: "user",
        originAgentId: null,
        originLabel: "PREF-07 fixture",
        entityType: "goal",
        entityId: goalId,
        timeframeLabel: "Now",
        title: "Deleted source fixture",
        summary: "A source that will move to the Bin before enqueue.",
        recommendation: "Do not create a candidate from this record.",
        rationale: "",
        confidence: 1,
        visibility: "visible",
        ctaLabel: "Review"
      }
    });
    assert.equal(insightResponse.statusCode, 201, insightResponse.body);
    const insightId = (insightResponse.json() as { insight: { id: string } })
      .insight.id;
    const deleteInsightResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: { cookie },
      payload: {
        atomic: true,
        operations: [{ entityType: "insight", id: insightId }]
      }
    });
    assert.equal(
      deleteInsightResponse.statusCode,
      200,
      deleteInsightResponse.body
    );
    assert.equal(deleteInsightResponse.json().results[0]?.ok, true);

    const bypassResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie },
      payload: {
        atomic: true,
        operations: [
          {
            entityType: "preference_item",
            clientRef: "deleted-source-bypass",
            data: {
              userId: "user_operator",
              domain: "projects",
              label: "Deleted source bypass",
              sourceEntityType: "insight",
              sourceEntityId: insightId
            }
          }
        ]
      }
    });
    assert.equal(bypassResponse.statusCode, 404, bypassResponse.body);
    assert.equal(
      (bypassResponse.json() as { code: string }).code,
      "preferences_source_entity_not_found"
    );
    const bypassItemCount = (
      getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count
           FROM preference_items
           WHERE source_entity_type = 'insight'
             AND source_entity_id = ?`
        )
        .get(insightId) as { count: number }
    ).count;
    assert.equal(bypassItemCount, 0);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});
