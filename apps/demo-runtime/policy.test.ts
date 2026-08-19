import assert from "node:assert/strict";
import test from "node:test";

import {
  DEMO_CAPABILITY_HEADER,
  DEMO_CAPABILITY_VALUE,
  decodeDemoSessionToken,
  demoRouteAllowed,
  encodeDemoSessionToken,
  markDemoProxyResponse
} from "./policy.js";

const secret = "a-demo-secret-that-is-at-least-thirty-two-bytes";

test("demo session tokens are opaque, integrity protected, and reject tampering", () => {
  const token = encodeDemoSessionToken(secret, "session-1", 1_786_510_800_000);
  assert.deepEqual(decodeDemoSessionToken(secret, token), {
    id: "session-1",
    createdAt: 1_786_510_800_000
  });
  assert.equal(decodeDemoSessionToken(secret, `${token.slice(0, -1)}x`), null);
  assert.equal(decodeDemoSessionToken(`${secret}-other`, token), null);
  assert.equal(decodeDemoSessionToken(secret, "bad.token"), null);
});

test("demo policy permits sample reads and task-state changes while denying private and broad writes", () => {
  const allowedRead = new URL("https://demo.example/forge/api/v1/tasks");
  allowedRead.pathname = "/api/v1/tasks";
  assert.equal(demoRouteAllowed("GET", allowedRead, Buffer.alloc(0)), true);

  for (const path of [
    "/api/v1/settings",
    "/api/v1/agents/sessions",
    "/api/v1/mobile/pairing",
    "/api/v1/artifacts/artifact-1/download",
    "/api/v1/notes/note-1/raw"
  ]) {
    assert.equal(
      demoRouteAllowed(
        "GET",
        new URL(path, "https://demo.example"),
        Buffer.alloc(0)
      ),
      false,
      path
    );
  }

  const taskUrl = new URL("/api/v1/tasks/task-1", "https://demo.example");
  assert.equal(
    demoRouteAllowed(
      "PATCH",
      taskUrl,
      Buffer.from(JSON.stringify({ status: "focus" }))
    ),
    true
  );
  assert.equal(
    demoRouteAllowed(
      "PATCH",
      taskUrl,
      Buffer.from(JSON.stringify({ status: "done", title: "Changed" }))
    ),
    false
  );
  assert.equal(demoRouteAllowed("PATCH", taskUrl, Buffer.from("{")), false);
  assert.equal(
    demoRouteAllowed(
      "POST",
      new URL("/api/v1/tasks", "https://demo.example"),
      Buffer.from("{}")
    ),
    false
  );
});

test("demo proxy responses carry the isolated capability marker without dropping upstream headers", () => {
  const headers = markDemoProxyResponse({
    "content-type": "application/json",
    "set-cookie": ["forge_session=opaque"]
  });

  assert.equal(headers[DEMO_CAPABILITY_HEADER], DEMO_CAPABILITY_VALUE);
  assert.equal(headers["cache-control"], "no-store");
  assert.equal(headers["content-type"], "application/json");
  assert.deepEqual(headers["set-cookie"], ["forge_session=opaque"]);
});
