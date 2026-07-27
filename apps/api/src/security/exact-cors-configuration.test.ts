import assert from "node:assert/strict";
import test from "node:test";

import { ConfigurationManager } from "../managers/platform/configuration-manager.js";

test("CORS admits only exact built-in development and explicitly configured origins", () => {
  const manager = new ConfigurationManager({
    FORGE_DEV_WEB_ORIGIN: "http://127.0.0.1:4027/forge/",
    FORGE_ALLOWED_ORIGINS:
      "https://forge-device.example.ts.net, https://FORGE.EXAMPLE:443"
  });
  const config = manager.readRuntimeConfig();

  assert.deepEqual(config.allowedOrigins, [
    "http://127.0.0.1:3027",
    "http://localhost:3027",
    "http://[::1]:3027",
    "http://127.0.0.1:4027",
    "https://forge-device.example.ts.net",
    "https://forge.example"
  ]);
  assert.equal(config.allowedOrigins.includes("http://127.0.0.1:9999"), false);
  assert.equal(config.allowedOrigins.includes("https://other.ts.net"), false);
  assert.equal(config.allowedOrigins.includes("http://100.64.0.10"), false);
});

test("invalid or credential-bearing explicit CORS origins fail startup configuration", () => {
  for (const value of [
    "not-an-origin",
    "file:///tmp/forge",
    "https://user:password@forge.example"
  ]) {
    assert.throws(
      () =>
        new ConfigurationManager({
          FORGE_ALLOWED_ORIGINS: value
        }).readRuntimeConfig(),
      /FORGE_ALLOWED_ORIGINS/
    );
  }
});
