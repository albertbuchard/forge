import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

async function issueScopedToken(
  app: Awaited<ReturnType<typeof buildServer>>,
  cookie: string,
  userIds: string[]
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/settings/tokens",
    headers: { cookie },
    payload: {
      label: "Contextual note creation test",
      scopes: ["read", "write"],
      scopePolicy: { userIds, projectIds: [], tagIds: [] }
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { token: { token: string } }).token.token;
}

test("contextual note creation validates one live authorized source and rolls back failures", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-contextual-note-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: false,
    devrageMetricSync: false
  });

  try {
    const cookie = await issueTestOperatorSessionCookie(app);
    const createGoal = async (title: string, userId: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/goals",
        headers: { cookie },
        payload: { title, userId }
      });
      assert.equal(response.statusCode, 201, response.body);
      return (response.json() as { goal: { id: string } }).goal.id;
    };
    const sourceGoalId = await createGoal("Context source", "user_operator");
    const foreignGoalId = await createGoal(
      "Foreign source sentinel",
      "user_forge_bot"
    );
    const sourceProjectResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { cookie },
      payload: {
        goalId: sourceGoalId,
        title: "Strategy context project",
        userId: "user_operator"
      }
    });
    assert.equal(sourceProjectResponse.statusCode, 201, sourceProjectResponse.body);
    const sourceProjectId = (
      sourceProjectResponse.json() as { project: { id: string } }
    ).project.id;
    const token = await issueScopedToken(app, cookie, ["user_operator"]);
    const headers = { authorization: `Bearer ${token}` };
    const payloadFor = (sourceEntityId: string) => ({
      title: "Related evidence",
      contentMarkdown: "The source relationship remains explicit.",
      links: [
        {
          entityType: "goal",
          entityId: sourceEntityId,
          anchorKey: null
        }
      ],
      createContext: {
        version: 1,
        sourceEntityType: "goal",
        sourceEntityId,
        anchorKey: null
      }
    });
    const batchCreate = async (data: Record<string, unknown>) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/entities/create",
        headers,
        payload: {
          atomic: true,
          operations: [{ entityType: "note", data }]
        }
      });
      assert.equal(response.statusCode, 200, response.body);
      return (
        response.json() as {
          results: Array<{
            ok: boolean;
            error?: { code: string; message: string };
          }>;
        }
      ).results[0]!;
    };

    const valid = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers,
      payload: payloadFor(sourceGoalId)
    });
    assert.equal(valid.statusCode, 201, valid.body);
    const validNote = (valid.json() as { note: { links: unknown[] } }).note;
    assert.equal(validNote.links.length, 1);

    const plainDurations: number[] = [];
    const contextualDurations: number[] = [];
    const measureCreate = async (contextual: boolean, index: number) => {
      const startedAt = performance.now();
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/notes",
        headers,
        payload: {
          ...payloadFor(sourceGoalId),
          title: `${contextual ? "Contextual" : "Plain"} performance note ${index}`,
          ...(contextual ? {} : { createContext: undefined })
        }
      });
      const duration = performance.now() - startedAt;
      assert.equal(response.statusCode, 201, response.body);
      return duration;
    };
    for (let index = 0; index < 63; index += 1) {
      const plainFirst = index % 2 === 0;
      const firstDuration = await measureCreate(!plainFirst, index);
      const secondDuration = await measureCreate(plainFirst, index);
      const plainDuration = plainFirst ? firstDuration : secondDuration;
      const contextualDuration = plainFirst ? secondDuration : firstDuration;

      if (index >= 3) {
        plainDurations.push(plainDuration);
        contextualDurations.push(contextualDuration);
      }
    }
    const p95 = (values: number[]) => {
      const sorted = values.slice().sort((left, right) => left - right);
      return sorted[Math.ceil(sorted.length * 0.95) - 1]!;
    };
    const plainP95 = p95(plainDurations);
    const contextualP95 = p95(contextualDurations);
    const relativeP95Budget = plainP95 * 1.1;
    const lowLatencyJitterBudget = plainP95 + 2;
    const contextualP95Budget = Math.max(
      relativeP95Budget,
      lowLatencyJitterBudget
    );
    assert.ok(contextualP95 <= 400, `contextual p95 ${contextualP95}ms`);
    assert.ok(
      contextualP95 <= contextualP95Budget,
      `contextual p95 ${contextualP95}ms exceeded plain p95 ${plainP95}ms beyond both the 10% relative budget and 2ms low-latency jitter allowance`
    );
    console.log(
      `contextual note create p95 ${contextualP95.toFixed(2)}ms; matched plain note p95 ${plainP95.toFixed(2)}ms`
    );

    const countNotes = async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/notes",
        headers
      });
      assert.equal(response.statusCode, 200, response.body);
      return (response.json() as { total: number }).total;
    };
    const countBeforeFailures = await countNotes();

    const ambiguous = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers,
      payload: {
        ...payloadFor(sourceGoalId),
        links: [
          { entityType: "goal", entityId: sourceGoalId, anchorKey: null },
          { entityType: "goal", entityId: sourceGoalId, anchorKey: "review" }
        ]
      }
    });
    assert.equal(ambiguous.statusCode, 400, ambiguous.body);
    assert.equal(
      (ambiguous.json() as { code: string }).code,
      "note_create_context_ambiguous"
    );
    assert.equal(await countNotes(), countBeforeFailures);

    const batchAmbiguous = await batchCreate({
      ...payloadFor(sourceGoalId),
      links: [
        { entityType: "goal", entityId: sourceGoalId, anchorKey: null },
        { entityType: "goal", entityId: sourceGoalId, anchorKey: "review" }
      ]
    });
    assert.equal(batchAmbiguous.ok, false);
    assert.equal(batchAmbiguous.error?.code, "note_create_context_ambiguous");
    assert.equal(await countNotes(), countBeforeFailures);

    const unauthorized = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers,
      payload: payloadFor(foreignGoalId)
    });
    assert.equal(unauthorized.statusCode, 404, unauthorized.body);
    assert.equal(
      (unauthorized.json() as { code: string }).code,
      "note_create_context_not_found"
    );
    assert.doesNotMatch(unauthorized.body, /foreign source sentinel/i);
    assert.equal(await countNotes(), countBeforeFailures);

    const batchUnauthorized = await batchCreate(payloadFor(foreignGoalId));
    assert.equal(batchUnauthorized.ok, false);
    assert.equal(
      batchUnauthorized.error?.code,
      "note_create_context_not_found"
    );
    assert.doesNotMatch(
      batchUnauthorized.error?.message ?? "",
      /foreign source sentinel/i
    );
    assert.equal(await countNotes(), countBeforeFailures);

    const stale = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers,
      payload: payloadFor("goal_missing_context")
    });
    assert.equal(stale.statusCode, 404, stale.body);
    assert.equal(await countNotes(), countBeforeFailures);

    const requirePsycheScope = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: { cookie },
      payload: { security: { psycheAuthRequired: true } }
    });
    assert.equal(requirePsycheScope.statusCode, 200, requirePsycheScope.body);
    const mixedScope = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers,
      payload: {
        ...payloadFor(sourceGoalId),
        links: [
          { entityType: "goal", entityId: sourceGoalId, anchorKey: null },
          {
            entityType: "trigger_report",
            entityId: "report_scope_probe",
            anchorKey: null
          }
        ]
      }
    });
    assert.equal(mixedScope.statusCode, 403, mixedScope.body);
    assert.equal(await countNotes(), countBeforeFailures);

    const createStrategyResponse = await app.inject({
      method: "POST",
      url: "/api/v1/strategies",
      headers: { cookie },
      payload: {
        title: "Deleted context strategy",
        overview: "",
        endStateDescription: "",
        status: "active",
        userId: "user_operator",
        targetGoalIds: [sourceGoalId],
        targetProjectIds: [sourceProjectId],
        linkedEntities: [],
        graph: {
          nodes: [
            {
              id: "node_context_source",
              entityType: "project",
              entityId: sourceProjectId,
              title: "Strategy context project",
              branchLabel: "",
              notes: ""
            }
          ],
          edges: []
        }
      }
    });
    assert.equal(
      createStrategyResponse.statusCode,
      201,
      createStrategyResponse.body
    );
    const deletedStrategyId = (
      createStrategyResponse.json() as { strategy: { id: string } }
    ).strategy.id;
    const deleteStrategyResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/strategies/${deletedStrategyId}`,
      headers: { cookie }
    });
    assert.equal(deleteStrategyResponse.statusCode, 200);
    const deletedStrategyPayload = {
      ...payloadFor(sourceGoalId),
      links: [
        {
          entityType: "strategy",
          entityId: deletedStrategyId,
          anchorKey: null
        }
      ],
      createContext: {
        version: 1,
        sourceEntityType: "strategy",
        sourceEntityId: deletedStrategyId,
        anchorKey: null
      }
    };
    const deletedStrategy = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers,
      payload: deletedStrategyPayload
    });
    assert.equal(deletedStrategy.statusCode, 404, deletedStrategy.body);
    const batchDeletedStrategy = await batchCreate(deletedStrategyPayload);
    assert.equal(batchDeletedStrategy.ok, false);
    assert.equal(
      batchDeletedStrategy.error?.code,
      "note_create_context_not_found"
    );
    assert.equal(await countNotes(), countBeforeFailures);

    const removeSource = await app.inject({
      method: "DELETE",
      url: `/api/v1/goals/${sourceGoalId}`,
      headers: { cookie }
    });
    assert.equal(removeSource.statusCode, 200, removeSource.body);
    const countAfterSourceDeletion = await countNotes();
    const deleted = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers,
      payload: payloadFor(sourceGoalId)
    });
    assert.equal(deleted.statusCode, 404, deleted.body);
    assert.equal(await countNotes(), countAfterSourceDeletion);

    const unsupportedVersion = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers,
      payload: {
        ...payloadFor(sourceGoalId),
        createContext: {
          version: 2,
          sourceEntityType: "goal",
          sourceEntityId: sourceGoalId,
          anchorKey: null
        }
      }
    });
    assert.equal(unsupportedVersion.statusCode, 400, unsupportedVersion.body);
    assert.equal(await countNotes(), countAfterSourceDeletion);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
