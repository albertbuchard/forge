import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import Fastify, { type FastifyRequest } from "fastify";

import { HttpError } from "../errors.js";
import {
  installAccessGateway,
  requireGatewayPrincipal,
  type GatewayAuthentication
} from "./access-gateway.js";
import type { ForgePrincipal, RouteSecurityContract } from "./contracts.js";
import { InMemorySecurityRateLimiter } from "./security-rate-limiter.js";

function principal(
  kind: ForgePrincipal["kind"],
  scopes: readonly string[],
  profile: ForgePrincipal["profile"] = "trusted_personal_assistant"
): ForgePrincipal {
  const isClient = kind === "paired_client" || kind === "legacy_agent_token";
  return {
    kind,
    subjectId: `${kind}_subject`,
    ownerId: "owner_gateway_test",
    clientId: isClient ? `${kind}_client` : null,
    installationId: isClient ? "gateway_test_installation" : null,
    audience: "https://forge.test/api",
    scopes,
    profile,
    ownerSecurityEpoch: 1,
    clientSecurityEpoch: isClient ? 1 : null,
    authenticatedAt: "2026-07-25T20:00:00.000Z"
  };
}

function header(request: FastifyRequest, name: string) {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function gatewayAuthentication(
  request: FastifyRequest
): GatewayAuthentication | null {
  const authorization = header(request, "authorization");
  if (authorization === "Bearer paired") {
    return {
      principal: principal("paired_client", [
        "profile:trusted_personal_assistant"
      ]),
      mode: "access_credential",
      csrfSatisfied: false
    };
  }
  if (authorization === "Bearer viewer") {
    return {
      principal: principal("paired_client", ["profile:viewer"], "viewer"),
      mode: "access_credential",
      csrfSatisfied: false
    };
  }
  if (authorization === "Bearer paired-generic") {
    return {
      principal: principal("paired_client", ["read", "write"]),
      mode: "access_credential",
      csrfSatisfied: false
    };
  }
  if (authorization === "Bearer legacy-artifact-read") {
    return {
      principal: principal("legacy_agent_token", ["artifact.readMetadata"]),
      mode: "access_credential",
      csrfSatisfied: false
    };
  }
  if (authorization === "Bearer legacy-generic-read") {
    return {
      principal: principal("legacy_agent_token", ["read"]),
      mode: "access_credential",
      csrfSatisfied: false
    };
  }
  if (authorization === "Bearer legacy-viewer-star") {
    return {
      principal: principal("legacy_agent_token", ["*"], "viewer"),
      mode: "access_credential",
      csrfSatisfied: false
    };
  }
  if (authorization !== undefined) {
    throw new HttpError(
      401,
      "test_credential_invalid",
      "The test credential is invalid."
    );
  }
  if (header(request, "cookie") === "forge_test_session=valid") {
    return {
      principal: principal("operator_session", ["*"], "operator"),
      mode: "browser_session",
      csrfSatisfied: header(request, "x-forge-csrf") === "valid-csrf"
    };
  }
  return null;
}

function createGatewayApp() {
  const app = Fastify({ logger: false });
  let parserEntries = 0;
  let handlerEntries = 0;
  const protocolProofs = new Set<string>();
  const audit: Array<{
    outcome: string;
    reason: string;
    principalKind: string;
  }> = [];

  app.addContentTypeParser(
    "application/x-forge-gateway-test",
    { parseAs: "string" },
    (_request, body, done) => {
      parserEntries += 1;
      done(null, JSON.parse(body as string));
    }
  );

  const controller = installAccessGateway(app, {
    credentials: {
      authenticate: gatewayAuthentication,
      verifyProtocolEarly: (
        request: FastifyRequest,
        contract: RouteSecurityContract
      ) => {
        assert.equal(contract.protocolVerifier, "companion_pairing");
        const proof = header(request, "x-test-protocol-proof");
        if (typeof proof !== "string" || proof !== "valid-proof") {
          return null;
        }
        if (protocolProofs.has(proof)) {
          throw new HttpError(
            409,
            "test_protocol_replay",
            "The protocol proof was replayed."
          );
        }
        protocolProofs.add(proof);
        return {
          principal: principal("companion_session", ["companion"]),
          mode: "verified_protocol",
          csrfSatisfied: false,
          verifyBody(verifiedRequest) {
            if (
              (verifiedRequest.body as { proof?: unknown } | undefined)
                ?.proof !== proof
            ) {
              throw new HttpError(
                401,
                "test_protocol_body_mismatch",
                "The protocol body did not match its proof."
              );
            }
          }
        };
      }
    },
    audit: {
      record(event) {
        audit.push({
          outcome: event.outcome,
          reason: event.reason,
          principalKind: event.principalKind
        });
      }
    },
    payloadReceiveTimeoutMilliseconds: 1_000
  });

  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/v1/data", async (request) => {
    handlerEntries += 1;
    return { subject: requireGatewayPrincipal(request).subjectId };
  });
  app.post("/api/v1/write", async (request) => {
    handlerEntries += 1;
    return { subject: requireGatewayPrincipal(request).subjectId };
  });
  app.post("/api/v1/auth/device", async () => {
    handlerEntries += 1;
    return { started: true };
  });
  app.post("/api/v1/auth/local/browser/exchange", async () => {
    handlerEntries += 1;
    return { exchanged: true };
  });
  app.post("/api/v1/mobile/movement/bootstrap", async (request) => {
    handlerEntries += 1;
    return { subject: requireGatewayPrincipal(request).subjectId };
  });
  app.get("/api/v1/events/stream", async () => {
    handlerEntries += 1;
    return "stream";
  });
  app.post("/api/v1/mcp/tools/call", async () => {
    handlerEntries += 1;
    return { ok: true };
  });
  app.get("/api/v1/artifacts", async () => {
    handlerEntries += 1;
    return { ok: true };
  });
  app.get("/api/v1/artifacts/:id", async () => {
    handlerEntries += 1;
    return { ok: true };
  });
  app.get("/api/v1/artifacts/:id/download", async () => {
    handlerEntries += 1;
    return { ok: true };
  });
  app.get("/api/v1/context", async () => {
    handlerEntries += 1;
    return { ok: true };
  });
  app.get("/api/v1/openapi.json", async () => {
    handlerEntries += 1;
    return { ok: true };
  });
  app.get("/api/v1/settings", async () => {
    handlerEntries += 1;
    return { ok: true };
  });
  app.patch("/api/v1/settings", async () => {
    handlerEntries += 1;
    return { ok: true };
  });
  app.get("/api/v1/peers/human-presence", async () => {
    handlerEntries += 1;
    return { ok: true };
  });
  app.get("/", async () => "<!doctype html>");
  app.get("/*", async () => "static");

  return {
    app,
    audit,
    controller,
    counters: {
      parserEntries: () => parserEntries,
      handlerEntries: () => handlerEntries
    }
  };
}

test("gateway is default-deny despite spoofed local, Tailscale, proxy, actor, and source headers", async () => {
  const { app, audit, counters } = createGatewayApp();
  try {
    for (const headers of [
      { host: "127.0.0.1:4317" },
      { origin: "http://localhost:3027" },
      { host: "forge-device.example.ts.net" },
      {
        "x-forwarded-for": "127.0.0.1",
        "x-forwarded-proto": "https"
      },
      {
        "x-forwarded-host": "localhost:4317",
        "x-forwarded-proto": "https"
      },
      { "x-forge-actor": "Local Operator", "x-forge-source": "system" }
    ]) {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/data",
        headers
      });
      assert.equal(response.statusCode, 401);
    }
    assert.equal(counters.handlerEntries(), 0);
    assert.equal(audit.filter((entry) => entry.outcome === "denied").length, 6);
    assert.ok(
      audit
        .filter((entry) => entry.outcome === "denied")
        .every((entry) => entry.principalKind === "anonymous")
    );
  } finally {
    await app.close();
  }
});

test("gateway rate admission is transparent until a bounded retry response", async () => {
  const app = Fastify({ logger: false });
  installAccessGateway(app, {
    credentials: { authenticate: gatewayAuthentication },
    rateLimiter: new InMemorySecurityRateLimiter({
      policies: {
        request: { capacity: 2, refillPerSecond: 0.01 }
      }
    })
  });
  app.get("/api/v1/data", async () => ({ ok: true }));
  try {
    for (const expectedStatus of [200, 200, 429]) {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/data",
        headers: { authorization: "Bearer paired" }
      });
      assert.equal(response.statusCode, expectedStatus);
      if (expectedStatus === 429) {
        assert.equal(response.headers["retry-after"], "100");
      }
    }
  } finally {
    await app.close();
  }
});

test("gateway exempts only a verified one-time development proxy assertion from ordinary rate admission", async () => {
  const app = Fastify({ logger: false });
  const consumed = new Set<string>();
  const admissions: Array<{ principalId: string | null }> = [];
  installAccessGateway(app, {
    credentials: {
      authenticate(request) {
        const assertion = header(request, "x-forge-dev-proxy-assertion");
        if (typeof assertion === "string") {
          const target = header(request, "x-forge-dev-proxy-target");
          if (
            assertion !== "valid-one-time-assertion" ||
            target !== "/forge/src/main.tsx" ||
            consumed.has(assertion)
          ) {
            throw new HttpError(
              401,
              "gateway_dev_proxy_assertion_invalid",
              "The development asset assertion is invalid, expired, or already used."
            );
          }
          consumed.add(assertion);
          return {
            principal: principal("operator_session", ["*"], "operator"),
            mode: "dev_proxy_assertion",
            csrfSatisfied: true
          };
        }
        if (header(request, "cookie") === "forge_test_session=valid") {
          return {
            principal: principal("operator_session", ["*"], "operator"),
            mode: "browser_session",
            csrfSatisfied: true
          };
        }
        return null;
      }
    },
    rateLimiter: {
      admit(request) {
        admissions.push({ principalId: request.principalId });
        return { allowed: true, remaining: 100 };
      }
    }
  });
  app.get("/api/v1/security/dev-session-check", async () => ({ ok: true }));

  try {
    const assertionHeaders = {
      "x-forge-dev-proxy-assertion": "valid-one-time-assertion",
      "x-forge-dev-proxy-target": "/forge/src/main.tsx"
    };
    const admitted = await app.inject({
      method: "GET",
      url: "/api/v1/security/dev-session-check",
      headers: assertionHeaders
    });
    assert.equal(admitted.statusCode, 200, admitted.body);
    assert.deepEqual(admissions, []);

    const replayed = await app.inject({
      method: "GET",
      url: "/api/v1/security/dev-session-check",
      headers: assertionHeaders
    });
    assert.equal(replayed.statusCode, 401, replayed.body);
    assert.deepEqual(admissions, [{ principalId: null }]);

    const invalid = await app.inject({
      method: "GET",
      url: "/api/v1/security/dev-session-check",
      headers: {
        ...assertionHeaders,
        "x-forge-dev-proxy-assertion": "invalid-assertion"
      }
    });
    assert.equal(invalid.statusCode, 401, invalid.body);
    assert.deepEqual(admissions, [
      { principalId: null },
      { principalId: null }
    ]);

    const browserSession = await app.inject({
      method: "GET",
      url: "/api/v1/security/dev-session-check",
      headers: { cookie: "forge_test_session=valid" }
    });
    assert.equal(browserSession.statusCode, 200, browserSession.body);
    assert.deepEqual(admissions, [
      { principalId: null },
      { principalId: null },
      { principalId: null },
      { principalId: "verified-owner:owner_gateway_test" }
    ]);
  } finally {
    await app.close();
  }
});

test("gateway publishes bounded Retry-After for request, stream, MCP, AI, and machine admission", async () => {
  const app = Fastify({ logger: false });
  const buckets: string[] = [];
  installAccessGateway(app, {
    credentials: { authenticate: gatewayAuthentication },
    rateLimiter: {
      admit(request) {
        buckets.push(request.bucket);
        return {
          allowed: false,
          retryAfterSeconds: 1.2,
          reason: "synthetic_limit"
        };
      }
    }
  });
  app.get("/api/v1/data", async () => ({ ok: true }));
  app.get("/api/v1/events/stream", async () => "stream");
  app.post("/api/v1/mcp/tools/call", async () => ({ ok: true }));
  app.post("/api/v1/ai/generate", async () => ({ ok: true }));
  app.post("/api/v1/machine/execute", async () => ({ ok: true }));
  try {
    for (const request of [
      { method: "GET" as const, url: "/api/v1/data" },
      { method: "GET" as const, url: "/api/v1/events/stream" },
      { method: "POST" as const, url: "/api/v1/mcp/tools/call" },
      { method: "POST" as const, url: "/api/v1/ai/generate" },
      { method: "POST" as const, url: "/api/v1/machine/execute" }
    ]) {
      const response = await app.inject({
        ...request,
        headers: { authorization: "Bearer paired" }
      });
      assert.equal(response.statusCode, 429, request.url);
      assert.equal(response.headers["retry-after"], "2", request.url);
    }
    assert.deepEqual(buckets, [
      "request",
      "request",
      "mcp_tool",
      "ai_cost",
      "machine_execution"
    ]);
  } finally {
    await app.close();
  }
});

test("gateway rate-limits rotating local sessions by a namespaced verified owner without changing audit attribution", async () => {
  const app = Fastify({ logger: false });
  const admissions: Array<{
    principalId: string | null;
    installationId: string | null;
  }> = [];
  const auditSubjects: Array<string | null> = [];
  installAccessGateway(app, {
    credentials: {
      authenticate(request) {
        const authorization = header(request, "authorization");
        if (authorization === "Bearer paired-owner-string") {
          return {
            principal: {
              ...principal("paired_client", [
                "profile:trusted_personal_assistant"
              ]),
              subjectId: "owner_rate_identity"
            },
            mode: "access_credential",
            csrfSatisfied: false
          };
        }
        const sessionId =
          authorization === "Bearer local-one"
            ? "ses_local_one"
            : authorization === "Bearer local-two"
              ? "ses_local_two"
              : authorization === "Bearer operator-one"
                ? "ses_operator_one"
                : authorization === "Bearer operator-two"
                  ? "ses_operator_two"
                  : null;
        if (!sessionId) return null;
        const isOperator = sessionId.startsWith("ses_operator_");
        return {
          principal: {
            ...principal(
              isOperator ? "operator_session" : "local_service",
              ["*"],
              "operator"
            ),
            subjectId: sessionId,
            ownerId: "owner_rate_identity",
            installationId: isOperator ? null : "installation_rate_identity"
          },
          mode: "browser_session",
          csrfSatisfied: true
        };
      }
    },
    rateLimiter: {
      admit(request) {
        if (request.principalId !== null) {
          admissions.push({
            principalId: request.principalId,
            installationId: request.installationId
          });
        }
        return { allowed: true, remaining: 100 };
      }
    },
    audit: {
      record(event) {
        if (event.outcome === "admitted") {
          auditSubjects.push(event.subjectId);
        }
      }
    }
  });
  app.get("/api/v1/data", async () => ({ ok: true }));

  try {
    for (const authorization of [
      "Bearer local-one",
      "Bearer local-two",
      "Bearer operator-one",
      "Bearer operator-two",
      "Bearer paired-owner-string"
    ]) {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/data",
        headers: { authorization }
      });
      assert.equal(response.statusCode, 200);
    }
    assert.deepEqual(admissions, [
      {
        principalId: "verified-owner:owner_rate_identity",
        installationId: "installation_rate_identity"
      },
      {
        principalId: "verified-owner:owner_rate_identity",
        installationId: "installation_rate_identity"
      },
      {
        principalId: "verified-owner:owner_rate_identity",
        installationId: null
      },
      {
        principalId: "verified-owner:owner_rate_identity",
        installationId: null
      },
      {
        principalId: "owner_rate_identity",
        installationId: "gateway_test_installation"
      }
    ]);
    assert.deepEqual(auditSubjects, [
      "ses_local_one",
      "ses_local_two",
      "ses_operator_one",
      "ses_operator_two",
      "owner_rate_identity"
    ]);
  } finally {
    await app.close();
  }
});

test("gateway separates direct local-owner authentication from proxied and remote pairing budgets", async () => {
  const app = Fastify({ logger: false });
  const admissions: Array<{
    bucket: string;
    networkId: string | null;
  }> = [];
  installAccessGateway(app, {
    credentials: { authenticate: gatewayAuthentication },
    rateLimiter: {
      admit(request) {
        admissions.push({
          bucket: request.bucket,
          networkId: request.networkId
        });
        return { allowed: true, remaining: 100 };
      }
    }
  });
  app.post("/api/v1/auth/local/browser/exchange", async () => ({
    exchanged: true
  }));
  app.post("/api/v1/auth/device", async () => ({ paired: true }));

  try {
    const direct = await app.inject({
      method: "POST",
      url: "/api/v1/auth/local/browser/exchange",
      payload: {}
    });
    assert.equal(direct.statusCode, 200);

    const proxied = await app.inject({
      method: "POST",
      url: "/api/v1/auth/local/browser/exchange",
      headers: {
        "x-forwarded-for": "100.64.0.10",
        "x-forwarded-proto": "https"
      },
      payload: {}
    });
    assert.equal(proxied.statusCode, 200);

    const remotePairing = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device",
      headers: { "x-forwarded-proto": "https" },
      payload: {}
    });
    assert.equal(remotePairing.statusCode, 200);

    assert.deepEqual(admissions, [
      {
        bucket: "local_owner_auth",
        networkId: "direct:127.0.0.1"
      },
      {
        bucket: "local_owner_auth",
        networkId: "proxied:127.0.0.1"
      },
      {
        bucket: "pairing_attempt",
        networkId: "127.0.0.1"
      }
    ]);
  } finally {
    await app.close();
  }
});

test("real limiter independently bounds direct, proxied, and remote pairing authentication", async () => {
  const app = Fastify({ logger: false });
  installAccessGateway(app, {
    credentials: { authenticate: gatewayAuthentication },
    rateLimiter: new InMemorySecurityRateLimiter({
      policies: {
        local_owner_auth: { capacity: 1, refillPerSecond: 0.01 },
        pairing_attempt: { capacity: 1, refillPerSecond: 0.01 }
      }
    })
  });
  app.post("/api/v1/auth/local/browser/exchange", async () => ({
    exchanged: true
  }));
  app.post("/api/v1/auth/device", async () => ({ paired: true }));

  try {
    const directFirst = await app.inject({
      method: "POST",
      url: "/api/v1/auth/local/browser/exchange",
      payload: {}
    });
    assert.equal(directFirst.statusCode, 200);
    const directBounded = await app.inject({
      method: "POST",
      url: "/api/v1/auth/local/browser/exchange",
      payload: {}
    });
    assert.equal(directBounded.statusCode, 429);
    assert.equal(directBounded.headers["retry-after"], "100");

    const proxiedFirst = await app.inject({
      method: "POST",
      url: "/api/v1/auth/local/browser/exchange",
      headers: {
        "x-forwarded-for": "100.64.0.10",
        "x-forwarded-proto": "https"
      },
      payload: {}
    });
    assert.equal(proxiedFirst.statusCode, 200);
    const proxiedBounded = await app.inject({
      method: "POST",
      url: "/api/v1/auth/local/browser/exchange",
      headers: {
        "x-forwarded-for": "100.64.0.10",
        "x-forwarded-proto": "https"
      },
      payload: {}
    });
    assert.equal(proxiedBounded.statusCode, 429);
    assert.equal(proxiedBounded.headers["retry-after"], "100");

    const remotePairingStillAvailable = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device",
      payload: {}
    });
    assert.equal(remotePairingStillAvailable.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("gateway bounds stream attempts by network before authentication and by session after authentication", async () => {
  const app = Fastify({ logger: false });
  const admissions: Array<{
    bucket: string;
    principalId: string | null;
    networkId: string | null;
  }> = [];
  let handlerEntries = 0;
  installAccessGateway(app, {
    credentials: { authenticate: gatewayAuthentication },
    rateLimiter: {
      admit(request) {
        admissions.push({
          bucket: request.bucket,
          principalId: request.principalId,
          networkId: request.networkId
        });
        return { allowed: true, remaining: 100 };
      }
    }
  });
  app.get("/api/v1/events/stream", async () => {
    handlerEntries += 1;
    return "stream";
  });
  try {
    const authenticated = await app.inject({
      method: "GET",
      url: "/api/v1/events/stream",
      headers: { authorization: "Bearer paired" }
    });
    assert.equal(authenticated.statusCode, 200);
    assert.deepEqual(admissions, [
      {
        bucket: "request",
        principalId: null,
        networkId: "127.0.0.1"
      },
      {
        bucket: "stream",
        principalId: "paired_client_subject",
        networkId: null
      }
    ]);
    assert.equal(handlerEntries, 1);

    admissions.length = 0;
    const anonymous = await app.inject({
      method: "GET",
      url: "/api/v1/events/stream"
    });
    assert.equal(anonymous.statusCode, 401);
    assert.deepEqual(admissions, [
      {
        bucket: "request",
        principalId: null,
        networkId: "127.0.0.1"
      }
    ]);
    assert.equal(handlerEntries, 1);
  } finally {
    await app.close();
  }
});

test("the authenticated stream limiter remains capped at twenty by default", () => {
  const limiter = new InMemorySecurityRateLimiter();
  for (let index = 0; index < 20; index += 1) {
    assert.equal(
      limiter.admit({
        bucket: "stream",
        principalId: "default-stream-policy",
        clientId: null,
        installationId: null,
        networkId: null,
        action: "events.read",
        cost: 1,
        now: new Date("2026-07-28T00:00:00.000Z")
      }).allowed,
      true
    );
  }
  assert.equal(
    limiter.admit({
      bucket: "stream",
      principalId: "default-stream-policy",
      clientId: null,
      installationId: null,
      networkId: null,
      action: "events.read",
      cost: 1,
      now: new Date("2026-07-28T00:00:00.000Z")
    }).allowed,
    false
  );
});

test("gateway admits only scoped credentials and enforces browser CSRF", async () => {
  const { app } = createGatewayApp();
  try {
    const read = await app.inject({
      method: "GET",
      url: "/api/v1/data",
      headers: { authorization: "Bearer paired" }
    });
    assert.equal(read.statusCode, 200);
    assert.equal(
      (read.json() as { subject: string }).subject,
      "paired_client_subject"
    );
    const genericPairedScope = await app.inject({
      method: "GET",
      url: "/api/v1/data",
      headers: { authorization: "Bearer paired-generic" }
    });
    assert.equal(genericPairedScope.statusCode, 403);
    assert.equal(read.headers["x-content-type-options"], "nosniff");
    assert.equal(read.headers["x-frame-options"], "DENY");
    assert.match(
      String(read.headers["content-security-policy"]),
      /style-src 'self' 'unsafe-inline'/
    );
    assert.match(
      String(read.headers["content-security-policy"]),
      /connect-src 'self' https: http: ws: wss:/
    );
    assert.equal(
      read.headers["cross-origin-opener-policy"],
      "same-origin-allow-popups"
    );
    assert.match(
      String(read.headers["permissions-policy"]),
      /geolocation=\(self\)/
    );
    assert.equal(read.headers["strict-transport-security"], undefined);

    const viewerWrite = await app.inject({
      method: "POST",
      url: "/api/v1/write",
      headers: { authorization: "Bearer viewer" },
      payload: {}
    });
    assert.equal(viewerWrite.statusCode, 403);

    const missingCsrf = await app.inject({
      method: "POST",
      url: "/api/v1/write",
      headers: { cookie: "forge_test_session=valid" },
      payload: {}
    });
    assert.equal(missingCsrf.statusCode, 403);

    const validCsrf = await app.inject({
      method: "POST",
      url: "/api/v1/write",
      headers: {
        cookie: "forge_test_session=valid",
        "x-forge-csrf": "valid-csrf"
      },
      payload: {}
    });
    assert.equal(validCsrf.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("legacy artifact scope is compatible only with exact reviewed routes", async () => {
  const { app } = createGatewayApp();
  try {
    for (const url of ["/api/v1/artifacts", "/api/v1/artifacts/artifact_1"]) {
      const response = await app.inject({
        method: "GET",
        url,
        headers: { authorization: "Bearer legacy-artifact-read" }
      });
      assert.equal(response.statusCode, 200, url);
    }

    for (const url of [
      "/api/v1/context",
      "/api/v1/data",
      "/api/v1/artifacts/artifact_1/download",
      "/api/v1/openapi.json"
    ]) {
      const response = await app.inject({
        method: "GET",
        url,
        headers: { authorization: "Bearer legacy-artifact-read" }
      });
      assert.equal(response.statusCode, 403, url);
      assert.equal(
        (response.json() as { code: string }).code,
        "gateway_scope_forbidden",
        url
      );
    }

    const reviewedContextRead = await app.inject({
      method: "GET",
      url: "/api/v1/context",
      headers: { authorization: "Bearer legacy-generic-read" }
    });
    assert.equal(reviewedContextRead.statusCode, 200);

    const unmappedOpenApiRead = await app.inject({
      method: "GET",
      url: "/api/v1/openapi.json",
      headers: { authorization: "Bearer legacy-generic-read" }
    });
    assert.equal(unmappedOpenApiRead.statusCode, 403);

    const profileEscape = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: { authorization: "Bearer legacy-viewer-star" },
      payload: {}
    });
    assert.equal(profileEscape.statusCode, 403);
    assert.equal(
      (profileEscape.json() as { code: string }).code,
      "gateway_profile_forbidden"
    );
  } finally {
    await app.close();
  }
});

test("mixed peer routes accept operator sessions but reject ordinary client credentials", async () => {
  const { app } = createGatewayApp();
  try {
    const operator = await app.inject({
      method: "GET",
      url: "/api/v1/peers/human-presence",
      headers: { cookie: "forge_test_session=valid" }
    });
    assert.equal(operator.statusCode, 200);

    const pairedClient = await app.inject({
      method: "GET",
      url: "/api/v1/peers/human-presence",
      headers: { authorization: "Bearer paired" }
    });
    assert.equal(pairedClient.statusCode, 403);
    assert.equal(
      (pairedClient.json() as { code: string }).code,
      "gateway_protocol_principal_forbidden"
    );
  } finally {
    await app.close();
  }
});

test("anonymous health and bounded authentication protocols ignore ambient credentials", async () => {
  const { app } = createGatewayApp();
  try {
    const publicHealth = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { authorization: "Bearer invalid" }
    });
    assert.equal(publicHealth.statusCode, 200);

    const browserExchange = await app.inject({
      method: "POST",
      url: "/api/v1/auth/local/browser/exchange",
      headers: { cookie: "forge_test_session=valid" },
      payload: {}
    });
    assert.equal(browserExchange.statusCode, 200);
    assert.equal(
      (browserExchange.json() as { exchanged: boolean }).exchanged,
      true
    );
  } finally {
    await app.close();
  }
});

test("verified protocol routes fail closed on invalid and replayed proof", async () => {
  const { app, counters } = createGatewayApp();
  try {
    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/movement/bootstrap",
      payload: {}
    });
    assert.equal(missing.statusCode, 401);

    const bearerBypass = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/movement/bootstrap",
      headers: { authorization: "Bearer paired" },
      payload: {}
    });
    assert.equal(bearerBypass.statusCode, 401);

    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/movement/bootstrap",
      headers: { "x-test-protocol-proof": "invalid-proof" },
      payload: { proof: "invalid-proof" }
    });
    assert.equal(invalid.statusCode, 401);

    const valid = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/movement/bootstrap",
      headers: { "x-test-protocol-proof": "valid-proof" },
      payload: { proof: "valid-proof" }
    });
    assert.equal(valid.statusCode, 200);
    assert.equal(
      (valid.json() as { subject: string }).subject,
      "companion_session_subject"
    );

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/movement/bootstrap",
      headers: { "x-test-protocol-proof": "valid-proof" },
      payload: { proof: "valid-proof" }
    });
    assert.equal(replay.statusCode, 409);
    assert.equal(counters.handlerEntries(), 1);
  } finally {
    await app.close();
  }
});

test("unauthenticated data, stream, and MCP paths are denied while only data-free shell and health remain public", async () => {
  const { app, controller } = createGatewayApp();
  try {
    for (const url of [
      "/api/v1/data",
      "/api/v1/events/stream",
      "/api/v1/mcp/tools/call"
    ]) {
      const response = await app.inject({
        method: url.includes("mcp") ? "POST" : "GET",
        url,
        payload: url.includes("mcp") ? {} : undefined
      });
      assert.equal(response.statusCode, 401, url);
    }
    assert.equal(
      (await app.inject({ method: "GET", url: "/api/health" })).statusCode,
      200
    );
    assert.equal(
      (await app.inject({ method: "GET", url: "/" })).statusCode,
      200
    );
    assert.ok(controller.registeredContracts.size >= 8);
    assert.ok(
      [...controller.registeredContracts.values()].every(
        (contract) => contract.action && contract.resource
      )
    );
  } finally {
    await app.close();
  }
});

test("large, encoded, and multipart-looking unauthenticated bodies are rejected before parsing or handler entry", async () => {
  const { app, counters } = createGatewayApp();
  try {
    for (const headers of [
      {
        "content-type": "application/x-forge-gateway-test",
        "content-length": String(2 * 1024 * 1024)
      },
      {
        "content-type": "application/x-forge-gateway-test",
        "content-encoding": "gzip"
      },
      {
        "content-type": "multipart/form-data; boundary=forge-security-boundary"
      }
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/write",
        headers,
        payload: "{}"
      });
      assert.equal(response.statusCode, 401);
    }
    assert.equal(counters.parserEntries(), 0);
    assert.equal(counters.handlerEntries(), 0);

    const boundedProtocolOverflow = await app.inject({
      method: "POST",
      url: "/api/v1/auth/device",
      headers: {
        "content-type": "application/x-forge-gateway-test",
        "content-length": String(32 * 1024)
      },
      payload: "{}"
    });
    assert.equal(boundedProtocolOverflow.statusCode, 413);
    assert.equal(counters.parserEntries(), 0);
    assert.equal(counters.handlerEntries(), 0);
  } finally {
    await app.close();
  }
});

test("oversized chunked unauthenticated requests are denied before parser and handler work on a random port", async () => {
  const { app, counters } = createGatewayApp();
  await app.listen({ host: "127.0.0.1", port: 0 });
  try {
    const address = app.server.address() as AddressInfo;
    const statusCode = await new Promise<number>((resolve, reject) => {
      const request = http.request(
        {
          host: "127.0.0.1",
          port: address.port,
          method: "POST",
          path: "/api/v1/write",
          headers: {
            "content-type": "application/x-forge-gateway-test",
            "transfer-encoding": "chunked"
          }
        },
        (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode ?? 0));
        }
      );
      request.once("error", reject);
      request.write("x".repeat(1024 * 1024));
      request.end("x".repeat(1024));
    });
    assert.equal(statusCode, 401);
    assert.equal(counters.parserEntries(), 0);
    assert.equal(counters.handlerEntries(), 0);
  } finally {
    await app.close();
  }
});
