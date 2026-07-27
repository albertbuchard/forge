import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { buildServer } from "../app.js";
import { closeDatabase, getDatabase } from "../db.js";
import { createAgentToken } from "../repositories/settings.js";
import { createAgentTokenSchema } from "../types.js";

test("scheduled privileged effects persist unique system attempts with bounded capabilities", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-scheduled-authority-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: false,
    taskRunWatchdog: false,
    peerRuntime: false,
    devrageMetricSync: false
  });
  try {
    const rows = getDatabase()
      .prepare(
        `SELECT job_id, principal_json, action, resource, budget_json
         FROM security_background_job_authorizations
         WHERE action IN (
           'data_backup.automatic.execute',
           'devrage.sync.execute'
         )
         ORDER BY action`
      )
      .all() as Array<{
      job_id: string;
      principal_json: string;
      action: string;
      resource: string;
      budget_json: string;
    }>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.action, "data_backup.automatic.execute");
    for (const row of rows) {
      const principal = JSON.parse(row.principal_json) as { kind: string };
      const budget = JSON.parse(row.budget_json) as {
        maximumRuntimeMilliseconds: number;
        maximumEffectInvocations: number;
        capabilities: string[];
      };
      assert.equal(principal.kind, "system");
      assert.ok(budget.maximumRuntimeMilliseconds > 0);
      assert.equal(budget.maximumEffectInvocations, 1);
      assert.deepEqual(budget.capabilities, [row.action]);
    }
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("wiki background work persists its verified principal and never substitutes system authority after restart", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-background-principal-")
  );
  let app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    taskRunWatchdog: false,
    peerRuntime: false,
    devrageMetricSync: false
  });
  const issued = createAgentToken(
    createAgentTokenSchema.parse({
      label: "Background persistence integration",
      agentLabel: "Background persistence integration",
      trustLevel: "trusted",
      scopes: ["read", "write"]
    })
  );
  const authorization = `Bearer ${issued.token}`;
  let jobId = "";

  try {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/ingest-jobs",
      remoteAddress: "127.0.0.1",
      headers: { authorization },
      payload: {
        titleHint: "Persisted authority",
        sourceKind: "raw_text",
        sourceText: "A synthetic background authorization fixture.",
        parseStrategy: "text_only",
        entityProposalMode: "none"
      }
    });
    assert.equal(created.statusCode, 201, created.body);
    jobId = (
      created.json() as {
        job: { job: { id: string } };
      }
    ).job.job.id;

    const persisted = getDatabase()
      .prepare(
        `SELECT principal_json, action, resource, policy_version,
                origin_request_id, origin_connection_id
         FROM security_background_job_authorizations
         WHERE job_id = ?`
      )
      .get(jobId) as {
      principal_json: string;
      action: string;
      resource: string;
      policy_version: string;
      origin_request_id: string | null;
      origin_connection_id: string | null;
    };
    const principal = JSON.parse(persisted.principal_json) as {
      kind: string;
      clientId: string;
    };
    assert.equal(principal.kind, "legacy_agent_token");
    assert.equal(principal.clientId, issued.tokenSummary.id);
    assert.equal(persisted.action, "wiki.ingest.execute");
    assert.equal(persisted.resource, `wiki_ingest_job:${jobId}`);
    assert.equal(persisted.policy_version, "forge-access-gateway/1");
    assert.ok(persisted.origin_request_id);
    assert.equal(persisted.origin_connection_id, null);
    assert.equal(persisted.principal_json.includes(issued.token), false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const correlatedAudit = getDatabase()
      .prepare(
        `SELECT request_id, job_id, reason
           FROM security_audit_events
          WHERE job_id = ?
          ORDER BY sequence`
      )
      .all(jobId) as Array<{
      request_id: string | null;
      job_id: string | null;
      reason: string;
    }>;
    assert.ok(correlatedAudit.length >= 2);
    assert.ok(
      correlatedAudit.every(
        (event) =>
          event.request_id === persisted.origin_request_id &&
          event.job_id === jobId
      )
    );
    assert.ok(
      correlatedAudit.some((event) => event.reason === "background_job_enqueued")
    );
  } finally {
    await app.close();
    closeDatabase();
  }

  const rawDatabase = new DatabaseSync(path.join(rootDir, "forge.sqlite"));
  try {
    rawDatabase
      .prepare(
        `UPDATE wiki_ingest_jobs
         SET status = 'queued', phase = 'queued', completed_at = NULL,
             error_message = '', updated_at = ?
         WHERE id = ?`
      )
      .run("2026-07-26T18:30:00.000Z", jobId);
    rawDatabase
      .prepare(
        `DELETE FROM security_background_job_authorizations
         WHERE job_id = ?`
      )
      .run(jobId);
  } finally {
    rawDatabase.close();
  }

  app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    taskRunWatchdog: false,
    peerRuntime: false,
    devrageMetricSync: false
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    const untouched = getDatabase()
      .prepare(
        `SELECT status FROM wiki_ingest_jobs
         WHERE id = ?`
      )
      .get(jobId) as { status: string };
    assert.equal(untouched.status, "queued");
    const missingAuthorization = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM security_background_job_authorizations
         WHERE job_id = ?`
      )
      .get(jobId) as { count: number };
    assert.equal(missingAuthorization.count, 0);

    const resumed = await app.inject({
      method: "POST",
      url: `/api/v1/wiki/ingest-jobs/${jobId}/resume`,
      headers: { authorization }
    });
    assert.equal(resumed.statusCode, 200, resumed.body);
    const resumedPrincipal = getDatabase()
      .prepare(
        `SELECT principal_json
         FROM security_background_job_authorizations
         WHERE job_id = ?`
      )
      .get(jobId) as { principal_json: string };
    assert.equal(
      (JSON.parse(resumedPrincipal.principal_json) as { kind: string }).kind,
      "legacy_agent_token"
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
