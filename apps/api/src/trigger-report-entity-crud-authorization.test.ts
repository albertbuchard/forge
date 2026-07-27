import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { getDeletedEntityRecord } from "./repositories/deleted-entities.js";
import {
  clearEntityOwner,
  getEntityOwnerId,
  setEntityOwner
} from "./repositories/entity-ownership.js";
import { getTriggerReportById } from "./repositories/psyche.js";

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
      label: "Trigger report entity CRUD authorization",
      agentLabel: "PSY-10 authorization test",
      scopes: ["read", "write", "psyche.read", "psyche.write"],
      scopePolicy: { userIds: [userId], projectIds: [], tagIds: [] }
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { token: { token: string } }).token.token;
}

function reportPayload(title: string, userId: string) {
  return {
    title,
    status: "draft",
    eventSituation: "A scoped event used to verify non-disclosing access.",
    occurredAt: "2026-07-15T08:30:00.000Z",
    bodyCues: ["Tight shoulders"],
    memoryClarity: "clear",
    reflection: "The report remains private to its owner.",
    hypothesis: "",
    hypothesisFit: "not_reviewed",
    interpretationConsent: false,
    nextMoves: [],
    userId
  };
}

async function createReport(
  app: Awaited<ReturnType<typeof buildServer>>,
  cookie: string,
  title: string,
  userId: string
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/psyche/reports",
    headers: { cookie },
    payload: reportPayload(title, userId)
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { report: { id: string } }).report.id;
}

function operationResult(response: {
  statusCode: number;
  body: string;
  json: () => unknown;
}) {
  assert.equal(response.statusCode, 200, response.body);
  return (
    response.json() as {
      results: Array<{
        ok: boolean;
        error?: { code: string; message: string };
      }>;
    }
  ).results[0]!;
}

test("batch trigger report delete and restore do not disclose or mutate another owner's report", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-trigger-report-entity-crud-auth-")
  );
  const app = await buildServer({
    dataRoot,
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
    const ownId = await createReport(
      app,
      cookie,
      "PSY-10 bounded owner search 6f40a6",
      "user_operator"
    );
    const foreignId = await createReport(
      app,
      cookie,
      "PSY-10 bounded foreign search 6f40a6",
      "user_forge_bot"
    );

    const search = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: scopedHeaders,
      payload: {
        searches: [{ query: "6f40a6", limit: 1 }]
      }
    });
    assert.equal(search.statusCode, 200, search.body);
    const matches = (
      search.json() as {
        results: Array<{
          matches: Array<{ entityType: string; id: string }>;
        }>;
      }
    ).results[0]!.matches;
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.entityType, "trigger_report");
    assert.equal(matches[0]?.id, ownId);
    assert.ok(!matches.some((match) => match.id === foreignId));

    const missingRevision = operationResult(
      await app.inject({
        method: "POST",
        url: "/api/v1/entities/update",
        headers: scopedHeaders,
        payload: {
          operations: [
            {
              entityType: "trigger_report",
              id: ownId,
              patch: { reflection: "This update is not revision-bound." }
            }
          ]
        }
      })
    );
    assert.equal(missingRevision.ok, false);
    assert.equal(missingRevision.error?.code, "validation_failed");

    const revisionBound = operationResult(
      await app.inject({
        method: "POST",
        url: "/api/v1/entities/update",
        headers: scopedHeaders,
        payload: {
          operations: [
            {
              entityType: "trigger_report",
              id: ownId,
              patch: {
                expectedRevision: 1,
                reflection: "This update is bound to the loaded revision."
              }
            }
          ]
        }
      })
    );
    assert.equal(revisionBound.ok, true);
    assert.equal(getTriggerReportById(ownId)?.revision, 2);

    const staleRevision = operationResult(
      await app.inject({
        method: "POST",
        url: "/api/v1/entities/update",
        headers: scopedHeaders,
        payload: {
          operations: [
            {
              entityType: "trigger_report",
              id: ownId,
              patch: {
                expectedRevision: 1,
                reflection: "This stale update must not be applied."
              }
            }
          ]
        }
      })
    );
    assert.equal(staleRevision.ok, false);
    assert.equal(staleRevision.error?.code, "trigger_report_revision_conflict");
    assert.equal(
      getTriggerReportById(ownId)?.reflection,
      "This update is bound to the loaded revision."
    );

    for (const mode of ["soft", "hard"] as const) {
      const denied = operationResult(
        await app.inject({
          method: "POST",
          url: "/api/v1/entities/delete",
          headers: scopedHeaders,
          payload: {
            operations: [{ entityType: "trigger_report", id: foreignId, mode }]
          }
        })
      );
      assert.equal(denied.ok, false);
      assert.equal(denied.error?.code, "not_found");
      assert.ok(getTriggerReportById(foreignId));
      assert.equal(
        getDeletedEntityRecord("trigger_report", foreignId),
        undefined
      );
    }

    const authorizedSoftDelete = operationResult(
      await app.inject({
        method: "POST",
        url: "/api/v1/entities/delete",
        headers: { cookie },
        payload: {
          operations: [{ entityType: "trigger_report", id: foreignId }]
        }
      })
    );
    assert.equal(authorizedSoftDelete.ok, true);
    assert.ok(getDeletedEntityRecord("trigger_report", foreignId));
    clearEntityOwner("trigger_report", foreignId);
    assert.equal(getEntityOwnerId("trigger_report", foreignId), null);

    const deniedRestore = operationResult(
      await app.inject({
        method: "POST",
        url: "/api/v1/entities/restore",
        headers: scopedHeaders,
        payload: {
          operations: [{ entityType: "trigger_report", id: foreignId }]
        }
      })
    );
    assert.equal(deniedRestore.ok, false);
    assert.equal(deniedRestore.error?.code, "not_found");
    assert.ok(getDeletedEntityRecord("trigger_report", foreignId));

    const deniedDeletedHardDelete = operationResult(
      await app.inject({
        method: "POST",
        url: "/api/v1/entities/delete",
        headers: scopedHeaders,
        payload: {
          operations: [
            { entityType: "trigger_report", id: foreignId, mode: "hard" }
          ]
        }
      })
    );
    assert.equal(deniedDeletedHardDelete.ok, false);
    assert.equal(deniedDeletedHardDelete.error?.code, "not_found");
    assert.ok(getDeletedEntityRecord("trigger_report", foreignId));

    setEntityOwner("trigger_report", foreignId, "user_forge_bot");
    const authorizedRestore = operationResult(
      await app.inject({
        method: "POST",
        url: "/api/v1/entities/restore",
        headers: { cookie },
        payload: {
          operations: [{ entityType: "trigger_report", id: foreignId }]
        }
      })
    );
    assert.equal(authorizedRestore.ok, true);
    assert.ok(getTriggerReportById(foreignId));

    const ownSoftDelete = operationResult(
      await app.inject({
        method: "POST",
        url: "/api/v1/entities/delete",
        headers: scopedHeaders,
        payload: {
          operations: [{ entityType: "trigger_report", id: ownId }]
        }
      })
    );
    assert.equal(ownSoftDelete.ok, true);
    assert.ok(getDeletedEntityRecord("trigger_report", ownId));

    const ownRestore = operationResult(
      await app.inject({
        method: "POST",
        url: "/api/v1/entities/restore",
        headers: scopedHeaders,
        payload: {
          operations: [{ entityType: "trigger_report", id: ownId }]
        }
      })
    );
    assert.equal(ownRestore.ok, true);
    assert.ok(getTriggerReportById(ownId, { userIds: ["user_operator"] }));
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});
