import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "../app.js";
import { closeDatabase } from "../db.js";
import type { ApplicationSecurityRuntime } from "./application-security-runtime.js";
import { LOCAL_OWNER_LEGACY_WARNING_VERSION } from "./local-capability-approval.js";

test("local legacy execution approval is explicit, local-only, persistent, and immediately revocable", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "forge-local-capability-route-")
  );
  let runtime!: ApplicationSecurityRuntime;
  const app = await buildServer({
    dataRoot: root,
    seedDemoData: true,
    taskRunWatchdog: false,
    peerRuntime: false,
    devrageMetricSync: false,
    onSecurityRuntimeReady(value) {
      runtime = value;
    }
  });
  const ownerEpoch = runtime.store.readOwnerSecurityEpoch("user_operator");
  assert.ok(ownerEpoch);
  const session = runtime.browserSessions.create({
    kind: "operator_session",
    subjectId: "local-capability-owner",
    ownerId: "user_operator",
    clientId: null,
    installationId: null,
    audience: runtime.audience,
    scopes: ["*"],
    profile: "operator",
    ownerSecurityEpoch: ownerEpoch,
    clientSecurityEpoch: null,
    authenticatedAt: new Date().toISOString()
  });
  const headers = {
    cookie: `forge_session=${encodeURIComponent(session.sessionToken)}`,
    "x-forge-csrf": session.csrfToken
  };
  try {
    const initial = await app.inject({
      method: "GET",
      url: "/api/v1/auth/local/legacy-host-execution",
      headers
    });
    assert.equal(initial.statusCode, 200, initial.body);
    assert.equal(initial.json().enabled, false);

    const remote = await app.inject({
      method: "GET",
      url: "/api/v1/auth/local/legacy-host-execution",
      remoteAddress: "100.64.10.20",
      headers
    });
    assert.notEqual(remote.statusCode, 200);

    const approved = await app.inject({
      method: "POST",
      url: "/api/v1/auth/local/legacy-host-execution",
      headers,
      payload: {
        warningVersion: LOCAL_OWNER_LEGACY_WARNING_VERSION,
        acknowledged: true
      }
    });
    assert.equal(approved.statusCode, 200, approved.body);
    assert.equal(approved.json().enabled, true);

    const revoked = await app.inject({
      method: "DELETE",
      url: "/api/v1/auth/local/legacy-host-execution",
      headers
    });
    assert.equal(revoked.statusCode, 200, revoked.body);
    assert.equal(revoked.json().enabled, false);
  } finally {
    await app.close();
    closeDatabase();
    await rm(root, { recursive: true, force: true });
  }
});
