import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { reconcileOpenClawPluginLoadPaths } from "../lib/openclaw-load-paths.mjs";

const FORGE_PLUGIN_ID = "forge-openclaw-plugin";

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

test("configuration replaces stale Forge load paths and preserves unrelated plugins", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-openclaw-paths-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));

  const staleForge = path.join(root, "stale", "plugins", "openclaw");
  const canonicalForge = path.join(root, "canonical", "plugins", "openclaw");
  const unrelated = path.join(root, "other-plugin");
  writeJson(path.join(staleForge, "package.json"), {
    name: FORGE_PLUGIN_ID,
    version: "0.3.75"
  });
  writeJson(path.join(canonicalForge, "package.json"), {
    name: FORGE_PLUGIN_ID,
    version: "0.3.80"
  });
  writeJson(path.join(unrelated, "package.json"), {
    name: "other-openclaw-plugin",
    version: "1.0.0"
  });

  const reconciled = reconcileOpenClawPluginLoadPaths(
    [staleForge, unrelated, canonicalForge, unrelated, "", null],
    canonicalForge,
    FORGE_PLUGIN_ID
  );

  assert.deepEqual(reconciled, [
    unrelated,
    fs.realpathSync.native(canonicalForge)
  ]);
});

test("the OpenClaw manifest id is sufficient to identify a stale Forge path", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-openclaw-id-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));

  const staleForge = path.join(root, "stale");
  const canonicalForge = path.join(root, "canonical");
  writeJson(path.join(staleForge, "openclaw.plugin.json"), {
    id: FORGE_PLUGIN_ID,
    version: "0.3.74"
  });
  writeJson(path.join(canonicalForge, "openclaw.plugin.json"), {
    id: FORGE_PLUGIN_ID,
    version: "0.3.80"
  });

  assert.deepEqual(
    reconcileOpenClawPluginLoadPaths(
      [staleForge],
      canonicalForge,
      FORGE_PLUGIN_ID
    ),
    [fs.realpathSync.native(canonicalForge)]
  );
});
