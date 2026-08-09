import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { executePairingDecision } from "../lib/pairing-command.mjs";

const packageRoot = path.resolve(import.meta.dirname, "..");
const bin = path.join(packageRoot, "bin", "forge-memory.mjs");

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: packageRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => {
      if (status !== 0) {
        reject(
          new Error(
            `forge-memory ${args.join(" ")} failed\nstdout:\n${stdout}\nstderr:\n${stderr}`
          )
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

test("pairing --json lists requests through authenticated Forge without making a decision", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "forge-pairing-cli-"));
  const calls = [];
  const server = http.createServer((request, response) => {
    calls.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization
    });
    response.writeHead(200, { "content-type": "application/json" });
    if (request.url === "/api/health") {
      response.end(
        JSON.stringify({
          ok: true,
          app: "forge",
          security: "credential-required"
        })
      );
      return;
    }
    if (request.url === "/api/v1/health") {
      response.end(
        JSON.stringify({
          ok: true,
          app: "forge",
          backend: "forge-node-runtime",
          runtime: { storageRoot: path.join(home, ".forge") }
        })
      );
      return;
    }
    response.end(
      JSON.stringify({
        requests: [
          {
            requestId: "pair_12345678-1234-1234-1234-123456789012",
            clientName: "Forge Companion on iPhone",
            clientType: "api",
            requestedScopes: ["companion.pair"],
            requestedProfile: "trusted_personal_assistant",
            status: "pending",
            expiresAt: "2026-07-28T14:30:00.000Z",
            endpoint: { origin: null }
          }
        ]
      })
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const result = await runCli(["pairing", "--json"], {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      FORGE_ORIGIN: "http://127.0.0.1",
      FORGE_PORT: String(address.port),
      FORGE_DATA_ROOT: path.join(home, ".forge"),
      FORGE_API_TOKEN: "synthetic-test-token"
    });
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.requests.length, 1);
    assert.equal(parsed.requests[0].clientName, "Forge Companion on iPhone");
    const decisionCalls = calls.filter(
      ({ url }) => url !== "/api/health" && url !== "/api/v1/health"
    );
    assert.deepEqual(
      decisionCalls.map(({ method, url }) => ({ method, url })),
      [{ method: "GET", url: "/api/v1/auth/device/requests" }]
    );
    assert.match(decisionCalls[0].authorization ?? "", /^Bearer /);
  } finally {
    server.close();
    await rm(home, { recursive: true, force: true });
  }
});

const request = {
  requestId: "pair_12345678-1234-1234-1234-123456789012",
  clientName: "Forge Companion on iPhone",
  requestedProfile: "trusted_personal_assistant",
  requestedScopes: ["companion.pair"]
};

test("pairing command approves the exact request with the entered code", async () => {
  const calls = [];
  const opened = [];
  const result = await executePairingDecision({
    selected: request,
    decision: "approve",
    promptCode: async () => "bcdf-ghjk",
    callApi: async (input) => {
      calls.push(input);
      return { status: 200, body: { requestId: request.requestId } };
    },
    openAgents: async (url) => opened.push(url),
    agentsUrl: "http://127.0.0.1:3027/forge/settings/agents#pending-pairings"
  });

  assert.deepEqual(result, { status: "approved" });
  assert.deepEqual(calls, [
    {
      method: "POST",
      path: `/api/v1/auth/device/requests/${request.requestId}/approve`,
      body: { userCode: "BCDF-GHJK" }
    }
  ]);
  assert.deepEqual(opened, []);
});

test("pairing command denies the exact request without collecting a code", async () => {
  const calls = [];
  let codePrompted = false;
  const result = await executePairingDecision({
    selected: request,
    decision: "deny",
    promptCode: async () => {
      codePrompted = true;
      return "SHOULD-NOT-BE-USED";
    },
    callApi: async (input) => {
      calls.push(input);
      return { status: 200, body: { denied: true } };
    },
    openAgents: async () => {},
    agentsUrl: "http://127.0.0.1:3027/forge/settings/agents#pending-pairings"
  });

  assert.deepEqual(result, { status: "denied" });
  assert.equal(codePrompted, false);
  assert.deepEqual(calls, [
    {
      method: "POST",
      path: `/api/v1/auth/device/requests/${request.requestId}/deny`,
      body: {}
    }
  ]);
});

test("pairing command hands elevated approval to the exact browser list", async () => {
  const calls = [];
  const opened = [];
  const agentsUrl =
    "http://127.0.0.1:3027/forge/settings/agents#pending-pairings";
  const result = await executePairingDecision({
    selected: {
      ...request,
      requestedProfile: "executor",
      requestedScopes: ["machine.execute"]
    },
    decision: "approve",
    promptCode: async () => "SHOULD-NOT-BE-USED",
    callApi: async (input) => {
      calls.push(input);
      return { status: 200 };
    },
    openAgents: async (url) => opened.push(url),
    agentsUrl
  });

  assert.deepEqual(result, { status: "opened_step_up" });
  assert.deepEqual(opened, [agentsUrl]);
  assert.deepEqual(calls, []);
});
