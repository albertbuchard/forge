import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const releaseScriptUrl = new URL(
  "./release-forge-openclaw-plugin.sh",
  import.meta.url
);
const releaseWorkflowUrl = new URL(
  "../../.github/workflows/release-openclaw-plugin.yml",
  import.meta.url
);
const forgePackageUrl = new URL("../../package.json", import.meta.url);
const openclawPackageUrl = new URL(
  "../../plugins/openclaw/package.json",
  import.meta.url
);

test("publishes the pinned Agent Messages media parser with the runtime", async () => {
  const [forgePackage, openclawPackage] = await Promise.all(
    [forgePackageUrl, openclawPackageUrl].map(async (url) =>
      JSON.parse(await readFile(url, "utf8"))
    )
  );

  assert.equal(forgePackage.dependencies["music-metadata"], "11.14.0");
  assert.equal(
    openclawPackage.dependencies["music-metadata"],
    forgePackage.dependencies["music-metadata"]
  );
});

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

test("hardens the ephemeral runner home before packed owner authentication", async () => {
  const source = await readFile(releaseWorkflowUrl, "utf8");
  const hardeningStep = "Harden local-owner verification path";
  const ownerCheck = "hardened.st_mode & 0o022";
  const publishStep = "Publish release from tag";
  const hardeningPosition = source.indexOf(hardeningStep);
  const ownerCheckPosition = source.indexOf(ownerCheck);
  const publishPosition = source.indexOf(publishStep);

  assert.notEqual(hardeningPosition, -1);
  assert.notEqual(ownerCheckPosition, -1);
  assert.notEqual(publishPosition, -1);
  assert.ok(hardeningPosition < ownerCheckPosition);
  assert.ok(ownerCheckPosition < publishPosition);
});
