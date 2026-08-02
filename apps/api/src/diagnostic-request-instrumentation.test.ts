import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { listDiagnosticLogs } from "./repositories/diagnostic-logs.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

test("automatic diagnostics skip internal dev checks and successful web assets while preserving API failures", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-diagnostic-instrumentation-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    devrageMetricSync: false,
    taskRunWatchdog: false,
    peerRuntime: false
  });

  try {
    const cookie = await issueTestOperatorSessionCookie(app);
    const authenticatedHeaders = {
      cookie,
      host: "127.0.0.1:4317"
    };
    const admittedCheck = await app.inject({
      method: "GET",
      url: "/api/v1/security/dev-session-check",
      headers: authenticatedHeaders
    });
    const deniedCheck = await app.inject({
      method: "GET",
      url: "/api/v1/security/dev-session-check",
      headers: { host: "127.0.0.1:4317" }
    });
    const webShell = await app.inject({
      method: "GET",
      url: "/forge/",
      headers: authenticatedHeaders
    });
    const missingCourse = await app.inject({
      method: "GET",
      url: "/api/v1/courses/missing-course/learn",
      headers: authenticatedHeaders
    });

    assert.equal(admittedCheck.statusCode, 200);
    assert.equal(deniedCheck.statusCode, 401);
    assert.equal(webShell.statusCode, 200);
    assert.equal(missingCourse.statusCode, 404);
    assert.equal(
      listDiagnosticLogs({
        route: "/api/v1/security/dev-session-check",
        limit: 100
      }).logs.length,
      0
    );
    assert.equal(
      listDiagnosticLogs({ route: "/*", limit: 100 }).logs.length,
      0
    );

    const courseFailureLogs = listDiagnosticLogs({
      route: "/api/v1/courses/:courseId/learn",
      limit: 100
    }).logs;
    assert.ok(courseFailureLogs.length >= 1);
    assert.ok(
      courseFailureLogs.some(
        (entry) =>
          entry.scope === "api_request" &&
          (entry.details as { statusCode?: number }).statusCode === 404
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});
