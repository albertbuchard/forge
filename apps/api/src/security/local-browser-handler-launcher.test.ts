import assert from "node:assert/strict";
import test from "node:test";

import { createMacosLocalBrowserHandlerLauncher } from "./local-browser-handler-launcher.js";

const handlerUrl =
  "forge://local-auth?apiOrigin=http%3A%2F%2F127.0.0.1%3A4317&browserOrigin=http%3A%2F%2F127.0.0.1%3A3027&transactionId=local_1234567890abcdef&browserNonce=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

test("macOS local-browser launch targets the exact verified app without a shell", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const appPath =
    "/Users/test/.forge/native/macos-browser-owner/Forge Local Owner.app";
  const launcher = createMacosLocalBrowserHandlerLauncher({
    appPath,
    platform: "darwin",
    runCommand: async (command, args) => {
      calls.push({ command, args });
    }
  });

  assert.ok(launcher);
  await launcher(handlerUrl);
  assert.deepEqual(calls, [
    {
      command: "/usr/bin/open",
      args: ["-a", appPath, handlerUrl]
    }
  ]);
});

test("local-browser launch is unavailable off macOS or without an absolute app bundle", () => {
  assert.equal(
    createMacosLocalBrowserHandlerLauncher({
      appPath: "/tmp/Forge Local Owner.app",
      platform: "linux"
    }),
    null
  );
  assert.equal(
    createMacosLocalBrowserHandlerLauncher({
      appPath: "Forge Local Owner.app",
      platform: "darwin"
    }),
    null
  );
  assert.equal(
    createMacosLocalBrowserHandlerLauncher({
      appPath: "/tmp/Forge Local Owner",
      platform: "darwin"
    }),
    null
  );
});

test("local-browser launch rejects another scheme before invoking macOS", async () => {
  let invoked = false;
  const launcher = createMacosLocalBrowserHandlerLauncher({
    appPath: "/tmp/Forge Local Owner.app",
    platform: "darwin",
    runCommand: async () => {
      invoked = true;
    }
  });

  assert.ok(launcher);
  await assert.rejects(
    launcher("https://example.test/local-auth"),
    /invalid local owner handler URL/
  );
  assert.equal(invoked, false);
});
