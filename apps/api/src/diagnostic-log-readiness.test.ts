import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase, runInTransaction } from "./db.js";
import {
  DIAGNOSTIC_LOG_MAX_ENTRIES,
  DIAGNOSTIC_LOG_RETENTION_DAYS,
  enforceDiagnosticLogRetention,
  listDiagnosticLogs,
  recordDiagnosticLog
} from "./repositories/diagnostic-logs.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

test("diagnostic logs stay operator-only, redact every context field, and expose bounded retention", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-diagnostic-readiness-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });
  const sentinel = "forge-diagnostic-secret-9081726354";

  try {
    const anonymous = await app.inject({
      method: "GET",
      url: "/api/v1/diagnostics/logs?limit=20",
      headers: { "x-forge-test-anonymous": "1" }
    });
    assert.equal(anonymous.statusCode, 401);

    const operatorCookie = issueTestOperatorSessionCookie(app);
    recordDiagnosticLog({
      level: "error",
      source: "ui",
      scope: `authorization=Bearer ${sentinel}`,
      eventKey: `api_key=${sentinel}`,
      message: `password='${sentinel}'`,
      route: `/models?access_token=${sentinel}`,
      functionName: `client_secret=${sentinel}`,
      requestId: `refresh_token=${sentinel}`,
      entityType: `cookie=${sentinel}`,
      entityId: `private_key=${sentinel}`,
      jobId: `passphrase=${sentinel}`,
      details: {
        apiKey: sentinel,
        nested: { authorization: `Bearer ${sentinel}` },
        serialized: JSON.stringify({ client_secret: sentinel })
      }
    });

    getDatabase()
      .prepare(
        `INSERT INTO diagnostic_logs (
          id, level, source, scope, event_key, message, route, function_name,
          request_id, entity_type, entity_id, job_id, details_json, created_at
        ) VALUES (?, 'error', 'server', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "diag_legacy_secret",
        `authorization=Bearer ${sentinel}`,
        `api_key=${sentinel}`,
        `password=${sentinel}`,
        `/legacy?access_token=${sentinel}`,
        `client_secret=${sentinel}`,
        `refresh_token=${sentinel}`,
        `cookie=${sentinel}`,
        `private_key=${sentinel}`,
        `passphrase=${sentinel}`,
        JSON.stringify({ accessToken: sentinel }),
        new Date().toISOString()
      );

    const repositoryPage = listDiagnosticLogs({ limit: 20 });
    assert.equal(repositoryPage.retention.days, DIAGNOSTIC_LOG_RETENTION_DAYS);
    assert.equal(
      repositoryPage.retention.maximumEntries,
      DIAGNOSTIC_LOG_MAX_ENTRIES
    );
    assert.doesNotMatch(
      JSON.stringify(repositoryPage.logs),
      new RegExp(sentinel)
    );
    assert.match(JSON.stringify(repositoryPage.logs), /\[redacted\]/);

    const operatorResponse = await app.inject({
      method: "GET",
      url: "/api/v1/diagnostics/logs?limit=20",
      headers: { cookie: operatorCookie }
    });
    assert.equal(operatorResponse.statusCode, 200);
    assert.deepEqual(
      (operatorResponse.json() as { retention: unknown }).retention,
      { days: 14, maximumEntries: 5_000 }
    );
    assert.doesNotMatch(operatorResponse.body, new RegExp(sentinel));

    const oversized = await app.inject({
      method: "GET",
      url: "/api/v1/diagnostics/logs?limit=501",
      headers: { cookie: operatorCookie }
    });
    assert.equal(oversized.statusCode, 400);

    getDatabase().prepare("DELETE FROM diagnostic_logs").run();
    const insert = getDatabase().prepare(
      `INSERT INTO diagnostic_logs (
        id, level, source, scope, event_key, message, route, function_name,
        request_id, entity_type, entity_id, job_id, details_json, created_at
      ) VALUES (?, 'info', 'server', 'retention', 'probe', ?, NULL, NULL,
        NULL, NULL, NULL, NULL, '{}', ?)`
    );
    const recentBase = Date.now() - 60 * 60 * 1_000;
    runInTransaction(() => {
      insert.run(
        "diag_stale",
        "Expired diagnostic",
        new Date(
          Date.now() - (DIAGNOSTIC_LOG_RETENTION_DAYS + 1) * 86_400_000
        ).toISOString()
      );
      for (let index = 0; index <= DIAGNOSTIC_LOG_MAX_ENTRIES; index += 1) {
        insert.run(
          `diag_recent_${String(index).padStart(5, "0")}`,
          `Recent diagnostic ${index}`,
          new Date(recentBase + index).toISOString()
        );
      }
    });

    const retention = enforceDiagnosticLogRetention({ force: true });
    assert.equal(retention.ran, true);
    assert.equal(retention.prunedCount, 2);
    const retained = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count,
                SUM(CASE WHEN id = 'diag_stale' THEN 1 ELSE 0 END) AS stale,
                SUM(CASE WHEN id = 'diag_recent_00000' THEN 1 ELSE 0 END) AS overflow,
                SUM(CASE WHEN id = 'diag_recent_05000' THEN 1 ELSE 0 END) AS newest
         FROM diagnostic_logs`
      )
      .get() as {
      count: number;
      stale: number;
      overflow: number;
      newest: number;
    };
    assert.equal(retained.count, DIAGNOSTIC_LOG_MAX_ENTRIES);
    assert.equal(retained.stale, 0);
    assert.equal(retained.overflow, 0);
    assert.equal(retained.newest, 1);

    const firstPage = listDiagnosticLogs({ limit: 500 });
    assert.equal(firstPage.logs.length, 500);
    assert.ok(firstPage.nextCursor);
    const secondPage = listDiagnosticLogs({
      limit: 500,
      beforeCreatedAt: firstPage.nextCursor?.beforeCreatedAt,
      beforeId: firstPage.nextCursor?.beforeId
    });
    assert.equal(secondPage.logs.length, 500);
    assert.equal(
      firstPage.logs.some((first) =>
        secondPage.logs.some((second) => second.id === first.id)
      ),
      false
    );

    getDatabase().prepare("DELETE FROM diagnostic_logs").run();
    const burstStartedAt = Date.now();
    for (let index = 0; index <= DIAGNOSTIC_LOG_MAX_ENTRIES; index += 1) {
      recordDiagnosticLog(
        {
          level: "info",
          source: "server",
          scope: "retention",
          eventKey: "burst_probe",
          message: `Burst diagnostic ${index}`,
          details: { sequence: index }
        },
        new Date(burstStartedAt + index)
      );
    }
    const burstRetained = getDatabase()
      .prepare("SELECT COUNT(*) AS count FROM diagnostic_logs")
      .get() as { count: number };
    assert.equal(burstRetained.count, DIAGNOSTIC_LOG_MAX_ENTRIES);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
