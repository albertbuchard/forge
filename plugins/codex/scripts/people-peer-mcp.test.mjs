import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(`${JSON.stringify(payload)}\n`);
}

test(
  "Codex MCP exposes and calls only agent-safe People routes",
  { timeout: 30_000 },
  async () => {
    const requests = [];
    const testRoot = mkdtempSync(
      path.join(os.tmpdir(), "forge-codex-people-mcp-")
    );
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      requests.push({
        method: request.method,
        path: url.pathname,
        authorization: request.headers.authorization ?? null
      });
      if (url.pathname === "/api/v1/health") {
        sendJson(response, 200, {
          ok: true,
          runtime: {
            pid: process.pid,
            storageRoot: testRoot,
            basePath: "/forge/"
          }
        });
        return;
      }
      if (url.pathname === "/api/v1/agents/sessions") {
        sendJson(response, 200, {
          session: { id: "session_codex_people_test" }
        });
        return;
      }
      if (url.pathname.startsWith("/api/v1/agents/sessions")) {
        sendJson(response, 200, { ok: true });
        return;
      }
      if (url.pathname === "/api/v1/people") {
        sendJson(response, 200, {
          items: [],
          page: { limit: 1, hasMore: false, nextCursor: null }
        });
        return;
      }
      if (url.pathname === "/api/v1/peers/relationships") {
        sendJson(response, 200, {
          items: [],
          page: { limit: 1, hasMore: false, nextCursor: null }
        });
        return;
      }
      sendJson(response, 404, {
        ok: false,
        error: { code: "unexpected_test_route", message: url.pathname }
      });
    });

    const address = await listen(server);
    assert.ok(address && typeof address === "object");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["plugins/codex/scripts/forge-codex-mcp.mjs"],
      cwd: process.cwd(),
      stderr: "pipe",
      env: {
        ...process.env,
        HOME: testRoot,
        FORGE_ORIGIN: "http://127.0.0.1",
        FORGE_PORT: String(address.port),
        FORGE_DATA_ROOT: testRoot,
        FORGE_API_TOKEN: "codex-people-test-token",
        FORGE_ACTOR_LABEL: "Forge Codex test"
      }
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    const client = new Client({
      name: "forge-codex-people-test",
      version: "1.0.0"
    });

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      const names = new Set(listed.tools.map((tool) => tool.name));
      assert.ok(names.has("forge_call_people_route"));
      assert.ok(names.has("forge_call_peer_route"));

      const peopleTool = listed.tools.find(
        (tool) => tool.name === "forge_call_people_route"
      );
      const peerTool = listed.tools.find(
        (tool) => tool.name === "forge_call_peer_route"
      );
      assert.equal(peopleTool?.inputSchema.type, "object");
      assert.equal(peerTool?.inputSchema.type, "object");

      const operationIds = (tool) =>
        new Set(
          (tool?.inputSchema.anyOf ?? []).map(
            (variant) => variant.properties.routeKey.const
          )
        );
      assert.deepEqual(
        operationIds(peopleTool),
        new Set([
          "listPeopleReadModel",
          "getPersonContext",
          "scanPeopleWikiCandidates",
          "previewPeopleWikiAssociations",
          "applyPeopleWikiAssociations",
          "interpretPersonQuestion",
          "executePersonQuestion",
          "listPersonQuestionHistory"
        ])
      );
      assert.deepEqual(
        operationIds(peerTool),
        new Set([
          "listPeerRequests",
          "listPeerRelationships",
          "getPeerRelationship",
          "listPeerDevices",
          "listPeerGrants",
          "getPeerSyncStatus",
          "getPeerDiagnostics"
        ])
      );

      const applyVariant = (peopleTool?.inputSchema.anyOf ?? []).find(
        (variant) =>
          variant.properties.routeKey.const === "applyPeopleWikiAssociations"
      );
      const decisionVariants =
        applyVariant?.properties.body.properties.decisions.items.anyOf ?? [];
      assert.deepEqual(
        decisionVariants.map((variant) => variant.properties.action.const),
        ["associate", "create_person", "skip"]
      );
      assert.deepEqual(
        decisionVariants.map((variant) => variant.required),
        [
          [
            "wikiPageId",
            "action",
            "personId",
            "expectedWikiVersion",
            "expectedPersonVersion"
          ],
          ["wikiPageId", "action", "displayName", "expectedWikiVersion"],
          ["wikiPageId", "action", "expectedWikiVersion"]
        ]
      );

      const serializedSchemas = JSON.stringify(
        listed.tools
          .filter(
            (tool) =>
              tool.name === "forge_call_people_route" ||
              tool.name === "forge_call_peer_route"
          )
          .map((tool) => tool.inputSchema)
      );
      for (const forbiddenOperation of [
        "createPeerInvitation",
        "acceptScannedPeerPairing",
        "acceptPeerRequest",
        "proposePeerGrant",
        "revokePeerGrant",
        "approvePeerDevice",
        "requestPeerResync"
      ]) {
        assert.ok(
          !serializedSchemas.includes(forbiddenOperation),
          forbiddenOperation
        );
      }

      const peopleResult = await client.callTool({
        name: "forge_call_people_route",
        arguments: { routeKey: "listPeopleReadModel", query: { limit: 1 } }
      });
      assert.notEqual(peopleResult.isError, true, JSON.stringify(peopleResult));

      const peerResult = await client.callTool({
        name: "forge_call_peer_route",
        arguments: { routeKey: "listPeerRelationships", query: { limit: 1 } }
      });
      assert.notEqual(peerResult.isError, true, JSON.stringify(peerResult));

      for (const expectedPath of [
        "/api/v1/people",
        "/api/v1/peers/relationships"
      ]) {
        assert.ok(
          requests.some(
            (request) =>
              request.path === expectedPath &&
              request.authorization === "Bearer codex-people-test-token"
          ),
          expectedPath
        );
      }
    } finally {
      await client.close().catch(() => undefined);
      await closeServer(server);
    }

    assert.equal(stderr, "");
  }
);
