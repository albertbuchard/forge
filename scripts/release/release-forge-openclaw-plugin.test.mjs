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
const hermesRuntimePackageUrl = new URL(
  "../../plugins/hermes/forge_hermes/runtime/package.json",
  import.meta.url
);
const openclawBuildScriptUrl = new URL(
  "../../plugins/openclaw/scripts/build.mjs",
  import.meta.url
);
const openclawServerEntrySourceUrl = new URL(
  "../../plugins/openclaw/scripts/server-entry-source.mjs",
  import.meta.url
);
const openclawServerEntryUrl = new URL(
  "../../plugins/openclaw/server/index.js",
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

test("pins the graph runtime to one clean-install-compatible version", async () => {
  const packages = await Promise.all(
    [forgePackageUrl, openclawPackageUrl, hermesRuntimePackageUrl].map(
      async (url) => JSON.parse(await readFile(url, "utf8"))
    )
  );

  for (const packageManifest of packages) {
    assert.equal(packageManifest.dependencies["@xyflow/react"], "12.10.2");
  }
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

test("builds the packaged server entry from one identity-stamping source", async () => {
  const [buildSource, authoritativeEntry, packagedEntry] = await Promise.all([
    readFile(openclawBuildScriptUrl, "utf8"),
    readFile(openclawServerEntrySourceUrl, "utf8"),
    readFile(openclawServerEntryUrl, "utf8")
  ]);

  assert.equal(packagedEntry, authoritativeEntry);
  assert.match(
    buildSource,
    /copyFile\(pluginServerEntrySource, path\.join\(pluginServerDir, "index\.js"\)\)/u
  );
  assert.match(authoritativeEntry, /FORGE_RUNTIME_PACKAGE_NAME/u);
  assert.match(authoritativeEntry, /FORGE_RUNTIME_PACKAGE_VERSION/u);
  assert.match(authoritativeEntry, /readPackagedRuntimeIdentity/u);
});

test("release rollback does not pass the aliased plugin manifest twice to git restore", async () => {
  const source = await readFile(releaseScriptUrl, "utf8");
  const cleanupStart = source.indexOf("cleanup_release_workspace() {");
  const cleanupEnd = source.indexOf(
    "\n}\n\nrollback_release_state()",
    cleanupStart
  );
  const cleanup = source.slice(cleanupStart, cleanupEnd);

  assert.notEqual(cleanupStart, -1);
  assert.notEqual(cleanupEnd, -1);
  assert.equal(cleanup.match(/\$\{ROOT_MANIFEST\}/g)?.length, 1);
  assert.equal(cleanup.includes("${PLUGIN_MANIFEST}"), false);
  assert.match(cleanup, /ls-files --error-unmatch/u);
  assert.match(cleanup, /tracked_paths/u);
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
