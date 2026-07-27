import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { buildOpenApiDocument } from "./openapi.js";
import {
  listEntityLinksForSources,
  replaceEntityLinksForSource
} from "./repositories/entity-links.js";

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
      label: "Trigger report contract test",
      agentLabel: "Trigger report test agent",
      scopes: [
        "read",
        "write",
        "psyche.read",
        "psyche.write",
        "psyche.note",
        "psyche.insight"
      ],
      scopePolicy: { userIds: [userId], projectIds: [], tagIds: [] }
    }
  });
  assert.equal(response.statusCode, 201);
  return (response.json() as { token: { token: string } }).token.token;
}

function reportPayload(title: string, userId = "user_operator") {
  return {
    title,
    status: "draft",
    eventSituation: "A concrete moment that can be reviewed safely.",
    occurredAt: "2026-07-15T08:30:00.000Z",
    bodyCues: ["Tight chest", "Warm face"],
    memoryClarity: "partial",
    reflection: "The reaction rose quickly after uncertainty.",
    hypothesis:
      "The reaction may be predicting rejection and trying to prevent exposure.",
    hypothesisFit: "fits",
    interpretationConsent: true,
    nextMoves: ["Pause and check what is known before responding."],
    userId
  };
}

test("trigger report routes enforce owner scope, idempotency, revisions, and bounded pages", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-trigger-report-contract-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    devrageMetricSync: false
  });

  try {
    const cookie = await issueOperatorSessionCookie(app);
    const token = await issueScopedToken(app, cookie, "user_operator");
    const scopedHeaders = {
      authorization: `Bearer ${token}`,
      "x-forge-source": "agent"
    };

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/reports",
      headers: {
        ...scopedHeaders,
        "idempotency-key": "trigger-create-1"
      },
      payload: reportPayload("Scoped episode")
    });
    assert.equal(create.statusCode, 201);
    const createdReport = (create.json() as { report: Record<string, unknown> })
      .report;
    const created = createdReport as {
      id: string;
      revision: number;
      bodyCues: string[];
      memoryClarity: string;
    };
    assert.equal(created.revision, 1);
    assert.deepEqual(created.bodyCues, ["Tight chest", "Warm face"]);
    assert.equal(created.memoryClarity, "partial");
    const openApi = buildOpenApiDocument() as {
      components: {
        schemas: Record<
          string,
          {
            properties: Record<string, unknown>;
            required: string[];
          }
        >;
      };
    };
    const triggerReportContract = openApi.components.schemas.TriggerReport!;
    assert.deepEqual(
      Object.keys(createdReport).sort(),
      Object.keys(triggerReportContract.properties).sort()
    );
    for (const requiredField of triggerReportContract.required) {
      assert.ok(
        Object.hasOwn(createdReport, requiredField),
        `runtime report.${requiredField}`
      );
    }

    const { memoryClarity: _omittedMemoryClarity, ...unratedMemoryPayload } =
      reportPayload("Unrated memory episode");
    const unratedMemory = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/reports",
      headers: {
        ...scopedHeaders,
        "idempotency-key": "trigger-create-unrated-memory"
      },
      payload: unratedMemoryPayload
    });
    assert.equal(unratedMemory.statusCode, 201);
    assert.equal(unratedMemory.json().report.memoryClarity, "unspecified");

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/reports",
      headers: {
        ...scopedHeaders,
        "idempotency-key": "trigger-create-1"
      },
      payload: reportPayload("Scoped episode")
    });
    assert.equal(replay.statusCode, 201);
    assert.equal(replay.json().report.id, created.id);

    const idempotencyConflict = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/reports",
      headers: {
        ...scopedHeaders,
        "idempotency-key": "trigger-create-1"
      },
      payload: reportPayload("Different episode")
    });
    assert.equal(idempotencyConflict.statusCode, 409);
    assert.equal(idempotencyConflict.json().code, "idempotency_conflict");

    const managedLinks = listEntityLinksForSources("trigger_report", [
      created.id
    ]).map((link) => ({
      entityType: link.targetEntityType,
      entityId: link.targetEntityId,
      anchorKey: link.anchorKey,
      relationship: link.relationship
    }));
    replaceEntityLinksForSource({
      sourceEntityType: "trigger_report",
      sourceEntityId: created.id,
      links: [
        ...managedLinks,
        {
          entityType: "note",
          entityId: "note_preserved_general_link",
          relationship: "supporting_context"
        }
      ],
      actor: "trigger-report-contract-test"
    });

    const revised = await app.inject({
      method: "PATCH",
      url: `/api/v1/psyche/reports/${created.id}`,
      headers: scopedHeaders,
      payload: {
        expectedRevision: 1,
        reflection: "The uncertainty activated a fast rejection prediction."
      }
    });
    assert.equal(revised.statusCode, 200);
    assert.equal(revised.json().report.revision, 2);
    const preservedGeneralLink = listEntityLinksForSources("trigger_report", [
      created.id
    ]).find(
      (link) =>
        link.targetEntityType === "note" &&
        link.targetEntityId === "note_preserved_general_link" &&
        link.relationship === "supporting_context"
    );
    assert.equal(
      preservedGeneralLink?.createdByActor,
      "trigger-report-contract-test"
    );

    const stale = await app.inject({
      method: "PATCH",
      url: `/api/v1/psyche/reports/${created.id}`,
      headers: scopedHeaders,
      payload: {
        expectedRevision: 1,
        reflection: "This stale edit must not overwrite the newer report."
      }
    });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().code, "trigger_report_revision_conflict");

    const foreign = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/reports",
      headers: { cookie },
      payload: reportPayload("Bot private episode", "user_forge_bot")
    });
    assert.equal(foreign.statusCode, 201);
    const foreignId = foreign.json().report.id as string;

    const foreignGoal = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: { cookie },
      payload: {
        title: "Bot private goal",
        description: "Must not be linkable from the scoped report token.",
        horizon: "year",
        status: "active",
        userId: "user_forge_bot",
        targetPoints: 100,
        themeColor: "#336699",
        tagIds: [],
        notes: []
      }
    });
    assert.equal(foreignGoal.statusCode, 201);
    const foreignGoalId = foreignGoal.json().goal.id as string;

    const forbiddenCreate = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/reports",
      headers: scopedHeaders,
      payload: reportPayload("Scope escape", "user_forge_bot")
    });
    assert.equal(forbiddenCreate.statusCode, 403);

    const forbiddenLink = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/reports",
      headers: scopedHeaders,
      payload: {
        ...reportPayload("Foreign link attempt"),
        linkedGoalIds: [foreignGoalId]
      }
    });
    assert.equal(forbiddenLink.statusCode, 404);
    assert.equal(forbiddenLink.json().code, "trigger_report_link_not_found");

    for (const method of ["GET", "PATCH", "DELETE"] as const) {
      const response = await app.inject({
        method,
        url: `/api/v1/psyche/reports/${foreignId}`,
        headers: scopedHeaders,
        ...(method === "PATCH"
          ? { payload: { expectedRevision: 1, title: "Forbidden" } }
          : {})
      });
      assert.equal(response.statusCode, 404, method);
    }

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/psyche/reports?limit=1",
      headers: scopedHeaders
    });
    assert.equal(list.statusCode, 200);
    const firstPage = list.json() as {
      reports: Array<{ id: string; userId: string | null }>;
      total: number;
      nextCursor: string | null;
      hasMore: boolean;
    };
    assert.ok(
      firstPage.reports.every((report) => report.userId === "user_operator")
    );
    assert.ok(firstPage.total >= 1);
    if (firstPage.hasMore) {
      assert.ok(firstPage.nextCursor);
      const second = await app.inject({
        method: "GET",
        url: `/api/v1/psyche/reports?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
        headers: scopedHeaders
      });
      assert.equal(second.statusCode, 200);
      assert.notEqual(second.json().reports[0]?.id, firstPage.reports[0]?.id);
    }

    const invalidCursor = await app.inject({
      method: "GET",
      url: "/api/v1/psyche/reports?cursor=not-a-trigger-cursor",
      headers: scopedHeaders
    });
    assert.equal(invalidCursor.statusCode, 400);
    assert.equal(invalidCursor.json().code, "trigger_report_cursor_invalid");

    const invalidLink = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/reports",
      headers: scopedHeaders,
      payload: {
        ...reportPayload("Invalid linked record"),
        linkedGoalIds: ["goal_missing"]
      }
    });
    assert.equal(invalidLink.statusCode, 400);
    assert.equal(invalidLink.json().code, "trigger_report_link_invalid");

    const unconfirmedHypothesis = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/reports",
      headers: scopedHeaders,
      payload: {
        ...reportPayload("Unconfirmed interpretation"),
        interpretationConsent: false
      }
    });
    assert.equal(unconfirmedHypothesis.statusCode, 400);
    assert.equal(
      unconfirmedHypothesis.json().code,
      "trigger_report_interpretation_consent_required"
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
