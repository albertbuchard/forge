import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "../app.js";
import { closeDatabase } from "../db.js";
import { createAgentToken } from "../repositories/settings.js";
import { createAgentTokenSchema } from "../types.js";

test("legacy credentials are direct-loopback-only and proxy headers cannot restore remote bearer access", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-legacy-transport-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    taskRunWatchdog: false,
    peerRuntime: false,
    devrageMetricSync: false,
    canonicalExternalOrigin: "https://forge-device.example.ts.net"
  });
  try {
    const narrow = createAgentToken(
      createAgentTokenSchema.parse({
        label: "Narrow transport migration",
        agentLabel: "Narrow transport migration",
        scopes: ["read"],
        scopePolicy: {
          userIds: ["user_operator"],
          projectIds: [],
          tagIds: []
        }
      })
    );
    const narrowAuthorization = {
      authorization: `Bearer ${narrow.token}`
    };
    const direct = await app.inject({
      method: "GET",
      url: "/api/v1/context",
      remoteAddress: "127.0.0.1",
      headers: narrowAuthorization
    });
    assert.equal(direct.statusCode, 200, direct.body);

    const tailnet = await app.inject({
      method: "GET",
      url: "/api/v1/context",
      remoteAddress: "127.0.0.1",
      headers: {
        ...narrowAuthorization,
        host: "forge-device.example.ts.net",
        "x-forwarded-for": "100.64.10.20",
        "x-forwarded-proto": "https"
      }
    });
    assert.equal(tailnet.statusCode, 401, tailnet.body);

    const otherNetwork = await app.inject({
      method: "GET",
      url: "/api/v1/context",
      remoteAddress: "192.0.2.20",
      headers: narrowAuthorization
    });
    assert.equal(otherNetwork.statusCode, 426, otherNetwork.body);

    const broad = createAgentToken(
      createAgentTokenSchema.parse({
        label: "Broad transport migration",
        agentLabel: "Broad transport migration",
        scopes: ["read", "write"],
        scopePolicy: { userIds: [], projectIds: [], tagIds: [] }
      })
    );
    const broadDirect = await app.inject({
      method: "GET",
      url: "/api/v1/context",
      remoteAddress: "127.0.0.1",
      headers: { authorization: `Bearer ${broad.token}` }
    });
    assert.equal(broadDirect.statusCode, 200, broadDirect.body);
    const broadTailnet = await app.inject({
      method: "GET",
      url: "/api/v1/context",
      remoteAddress: "127.0.0.1",
      headers: {
        authorization: `Bearer ${broad.token}`,
        host: "forge-device.example.ts.net",
        "x-forwarded-for": "100.64.10.20",
        "x-forwarded-proto": "https"
      }
    });
    assert.equal(broadTailnet.statusCode, 401, broadTailnet.body);

    const unmapped = createAgentToken(
      createAgentTokenSchema.parse({
        label: "Unmapped tailnet migration",
        agentLabel: "Unmapped tailnet migration",
        scopes: ["read"],
        scopePolicy: {
          userIds: ["user_operator"],
          projectIds: [],
          tagIds: []
        }
      })
    );
    const unmappedTailnet = await app.inject({
      method: "GET",
      url: "/api/v1/context",
      remoteAddress: "127.0.0.1",
      headers: {
        authorization: `Bearer ${unmapped.token}`,
        host: "forge-device.example.ts.net",
        "x-forwarded-for": "100.64.10.20",
        "x-forwarded-proto": "https"
      }
    });
    assert.equal(unmappedTailnet.statusCode, 401, unmappedTailnet.body);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});
