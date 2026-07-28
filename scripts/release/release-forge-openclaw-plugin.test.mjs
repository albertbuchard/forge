import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const releaseScriptUrl = new URL(
  "./release-forge-openclaw-plugin.sh",
  import.meta.url
);

test("builds the plugin runtime before Forge Memory exercises it", async () => {
  const source = await readFile(releaseScriptUrl, "utf8");
  const buildCommand = '"npm run build:openclaw-plugin"';
  const memoryTestCommand = '"npm run test:forge-memory"';
  const buildPosition = source.indexOf(buildCommand);
  const memoryTestPosition = source.indexOf(memoryTestCommand);

  assert.notEqual(buildPosition, -1);
  assert.notEqual(memoryTestPosition, -1);
  assert.ok(buildPosition < memoryTestPosition);
  assert.equal(source.indexOf(buildCommand, buildPosition + 1), -1);
});
