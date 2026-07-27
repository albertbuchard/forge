import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "../app.js";
import { closeDatabase, getDatabase } from "../db.js";
import {
  createAgentToken,
  revokeAgentToken
} from "../repositories/settings.js";
import { createAgentTokenSchema } from "../types.js";
import type { ApplicationSecurityRuntime } from "./application-security-runtime.js";
import { issueTestOperatorSessionCookie } from "./test-operator-authority.js";

test("the application gateway denies every protected surface until a credential is verified", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-security-gateway-")
  );
  let securityRuntime!: ApplicationSecurityRuntime;
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    taskRunWatchdog: false,
    peerRuntime: false,
    devrageMetricSync: false,
    onSecurityRuntimeReady(runtime) {
      securityRuntime = runtime;
    }
  });
  app.get("/api/v1/security/test-internal-error", async () => {
    throw new Error("never-expose-this-internal-marker");
  });

  try {
    const health = await app.inject({
      method: "GET",
      url: "/api/health"
    });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.json(), {
      ok: true,
      app: "forge",
      security: "credential-required"
    });
    assert.equal(health.headers["x-content-type-options"], "nosniff");
    assert.equal(health.headers["x-frame-options"], "DENY");

    const rejectedCors = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/context",
      headers: {
        origin: "https://unpaired-device.example.ts.net",
        "access-control-request-method": "GET"
      }
    });
    assert.equal(
      rejectedCors.headers["access-control-allow-origin"],
      undefined
    );

    const exactDevelopmentCors = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/context",
      headers: {
        origin: "http://127.0.0.1:3027",
        "access-control-request-method": "GET"
      }
    });
    assert.equal(
      exactDevelopmentCors.headers["access-control-allow-origin"],
      "http://127.0.0.1:3027"
    );

    for (const url of [
      "/api/v1/context",
      "/api/v1/health",
      "/api/v1/openapi.json",
      "/api/v1/events/meta",
      "/api/v1/events/stream",
      "/api/v1/auth/operator-session",
      "/api/v1/not-a-real-route"
    ]) {
      const response = await app.inject({
        method: "GET",
        url,
        headers: {
          host: "127.0.0.1:4317",
          origin: "http://localhost:3027",
          "x-forwarded-for": "127.0.0.1",
          "x-forwarded-host": "localhost:4317",
          "x-forwarded-proto": "https",
          "x-forge-actor": "Local Operator",
          "x-forge-source": "system"
        }
      });
      assert.equal(response.statusCode, 401, url);
    }

    const rawRemoteBearer = await app.inject({
      method: "GET",
      url: "/api/v1/context",
      remoteAddress: "100.64.10.20",
      headers: {
        authorization: "Bearer must-not-cross-raw-http"
      }
    });
    assert.equal(rawRemoteBearer.statusCode, 426);
    assert.equal(
      rawRemoteBearer.json().code,
      "gateway_secure_transport_required"
    );

    const staleBrowserSession = await app.inject({
      method: "GET",
      url: "/api/v1/context",
      headers: { cookie: "forge_session=expired-session" }
    });
    assert.equal(staleBrowserSession.statusCode, 401);
    assert.equal(
      staleBrowserSession.json().code,
      "gateway_authentication_required"
    );

    const devProxyPrincipal = {
      kind: "operator_session" as const,
      subjectId: "browser-session-dev-proxy-test",
      ownerId: "user_operator",
      clientId: null,
      installationId: securityRuntime.installationId,
      audience: securityRuntime.audience,
      scopes: ["*"],
      profile: "operator" as const,
      ownerSecurityEpoch: 1,
      clientSecurityEpoch: null,
      authenticatedAt: new Date().toISOString()
    };
    const devTarget = "/forge/src/main.tsx";
    const devProxyAssertion = securityRuntime.devAssetProxyAssertions.issue(
      devProxyPrincipal,
      devTarget
    );
    const admittedDevProxy = await app.inject({
      method: "GET",
      url: "/api/v1/security/dev-session-check",
      headers: {
        "x-forge-dev-proxy-assertion": devProxyAssertion,
        "x-forge-dev-proxy-target": devTarget
      }
    });
    assert.equal(admittedDevProxy.statusCode, 200, admittedDevProxy.body);
    const replayedDevProxy = await app.inject({
      method: "GET",
      url: "/api/v1/security/dev-session-check",
      headers: {
        "x-forge-dev-proxy-assertion": devProxyAssertion,
        "x-forge-dev-proxy-target": devTarget
      }
    });
    assert.equal(replayedDevProxy.statusCode, 401);

    const issued = createAgentToken(
      createAgentTokenSchema.parse({
        label: "Gateway integration test",
        agentLabel: "Gateway integration test",
        trustLevel: "trusted",
        scopes: ["read", "write"]
      })
    );
    const authorization = `Bearer ${issued.token}`;

    const admittedThroughHttpsLoopbackProxy = await app.inject({
      method: "GET",
      url: "/api/v1/context",
      headers: {
        authorization,
        "x-forwarded-for": "100.64.10.20",
        "x-forwarded-host": "forge.example.ts.net",
        "x-forwarded-proto": "https"
      }
    });
    assert.equal(
      admittedThroughHttpsLoopbackProxy.statusCode,
      401,
      admittedThroughHttpsLoopbackProxy.body
    );

    const admitted = await app.inject({
      method: "GET",
      url: "/api/v1/context?pairingToken=must-not-persist",
      headers: {
        authorization,
        "x-forge-actor": "Spoofed Operator",
        "x-forge-source": "system"
      }
    });
    assert.equal(admitted.statusCode, 200);
    const requestDiagnostic = getDatabase()
      .prepare(
        `SELECT source, details_json AS details
         FROM diagnostic_logs
         WHERE route = '/api/v1/context' AND scope = 'api_request'
         ORDER BY created_at DESC LIMIT 1`
      )
      .get() as { source: string; details: string } | undefined;
    assert.ok(requestDiagnostic);
    assert.equal(requestDiagnostic.source, "agent");
    assert.equal(requestDiagnostic.details.includes("must-not-persist"), false);
    assert.equal(requestDiagnostic.details.includes("rawUrl"), false);

    const internalFailure = await app.inject({
      method: "GET",
      url: "/api/v1/security/test-internal-error",
      headers: { cookie: issueTestOperatorSessionCookie(app) }
    });
    assert.equal(internalFailure.statusCode, 500);
    assert.equal(
      internalFailure.json().error,
      "Forge could not complete the request."
    );
    assert.equal(
      internalFailure.body.includes("never-expose-this-internal-marker"),
      false
    );

    const unknownWithCredential = await app.inject({
      method: "GET",
      url: "/api/v1/not-a-real-route",
      headers: { authorization }
    });
    assert.equal(unknownWithCredential.statusCode, 403);
    assert.equal(unknownWithCredential.json().code, "gateway_scope_forbidden");

    assert.ok(revokeAgentToken(issued.tokenSummary.id));
    const revoked = await app.inject({
      method: "GET",
      url: "/api/v1/context",
      headers: { authorization }
    });
    assert.equal(revoked.statusCode, 401);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
