import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMacOSCalendarHelperLaunchArgs,
  waitForMacOSCalendarHelperResponse
} from "./services/macos-calendar-helper.js";

test("macOS Calendar Helper launch does not use open's racy wait mode", () => {
  const args = buildMacOSCalendarHelperLaunchArgs({
    appPath: "/tmp/ForgeMacOSCalendarHelper.app",
    encodedRequest: "encoded",
    responsePath: "/tmp/response.json"
  });

  assert.deepEqual(args, [
    "-n",
    "/tmp/ForgeMacOSCalendarHelper.app",
    "--args",
    "--request-base64",
    "encoded",
    "--response-file",
    "/tmp/response.json"
  ]);
  assert.equal(args.includes("-W"), false);
});

test("macOS Calendar Helper waits for its atomic response file", async () => {
  let attempts = 0;
  const response = await waitForMacOSCalendarHelperResponse<{
    status: string;
  }>("/tmp/response.json", {
    timeoutMs: 100,
    pollIntervalMs: 1,
    now: () => 0,
    wait: async () => undefined,
    readText: async () => {
      attempts += 1;
      if (attempts < 3) {
        throw Object.assign(new Error("not ready"), { code: "ENOENT" });
      }
      return JSON.stringify({ ok: true, status: "full_access" });
    }
  });

  assert.equal(attempts, 3);
  assert.deepEqual(response, { ok: true, status: "full_access" });
});

test("macOS Calendar Helper surfaces helper errors", async () => {
  await assert.rejects(
    waitForMacOSCalendarHelperResponse("/tmp/response.json", {
      readText: async () =>
        JSON.stringify({ ok: false, error: "Calendar access denied" })
    }),
    /Calendar access denied/
  );
});

test("macOS Calendar Helper stops waiting after its bounded timeout", async () => {
  let now = 0;

  await assert.rejects(
    waitForMacOSCalendarHelperResponse("/tmp/response.json", {
      timeoutMs: 100,
      pollIntervalMs: 25,
      now: () => now,
      wait: async (delayMs) => {
        now += delayMs;
      },
      readText: async () => {
        throw Object.assign(new Error("not ready"), { code: "ENOENT" });
      }
    }),
    /did not respond within 100 milliseconds/
  );
  assert.equal(now, 100);
});
