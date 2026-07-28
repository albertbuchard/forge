import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";
import { readNativeSourceSigningKey } from "../../../plugins/openclaw/scripts/native-source-signing-key.mjs";

const forgeRoot = path.resolve(import.meta.dirname, "..", "..", "..");

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "forge-signing-key-test-"));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  const repositoryRoot = path.join(root, "repository");
  const outsideRoot = path.join(root, "outside");
  await mkdir(repositoryRoot, { mode: 0o700 });
  await mkdir(outsideRoot, { mode: 0o700 });
  const keyPath = path.join(outsideRoot, "release-key.pem");
  await writeFile(keyPath, "private test key bytes\n", { mode: 0o600 });
  await chmod(keyPath, 0o600);
  return { root, repositoryRoot, outsideRoot, keyPath };
}

test("loads an owner-only release key stored outside the repository", async (t) => {
  const value = await fixture(t);
  const bytes = await readNativeSourceSigningKey({
    keyPath: value.keyPath,
    repositoryRoot: value.repositoryRoot
  });
  assert.equal(bytes.toString("utf8"), "private test key bytes\n");
});

test("rejects a relative release key path", async (t) => {
  const value = await fixture(t);
  await assert.rejects(
    readNativeSourceSigningKey({
      keyPath: "release-key.pem",
      repositoryRoot: value.repositoryRoot
    }),
    /must be absolute/
  );
});

test(
  "rejects a release key readable by group or other users",
  { skip: process.platform === "win32" },
  async (t) => {
    const value = await fixture(t);
    await chmod(value.keyPath, 0o644);
    await assert.rejects(
      readNativeSourceSigningKey({
        keyPath: value.keyPath,
        repositoryRoot: value.repositoryRoot
      }),
      /must not be accessible to group or other users/
    );
  }
);

test(
  "rejects a symbolic link to a release key",
  { skip: process.platform === "win32" },
  async (t) => {
    const value = await fixture(t);
    const linkedPath = path.join(value.outsideRoot, "linked-key.pem");
    await symlink(value.keyPath, linkedPath);
    await assert.rejects(
      readNativeSourceSigningKey({
        keyPath: linkedPath,
        repositoryRoot: value.repositoryRoot
      }),
      /bounded regular file/
    );
  }
);

test("rejects a release key stored inside the repository", async (t) => {
  const value = await fixture(t);
  const inRepositoryKey = path.join(value.repositoryRoot, "release-key.pem");
  await writeFile(inRepositoryKey, "private test key bytes\n", { mode: 0o600 });
  await chmod(inRepositoryKey, 0o600);
  await assert.rejects(
    readNativeSourceSigningKey({
      keyPath: inRepositoryKey,
      repositoryRoot: value.repositoryRoot
    }),
    /must be stored outside/
  );
});

test("rejects an oversized release key", async (t) => {
  const value = await fixture(t);
  await assert.rejects(
    readNativeSourceSigningKey({
      keyPath: value.keyPath,
      repositoryRoot: value.repositoryRoot,
      maximumBytes: 4
    }),
    /bounded regular file/
  );
});

function workflow(fileName) {
  return YAML.parse(
    requireText(path.join(forgeRoot, ".github", "workflows", fileName))
  );
}

function requireText(filePath) {
  return readFileSync(filePath, "utf8");
}

function assertSignedReleaseWorkflow(fileName, jobName, releaseStepName) {
  const document = workflow(fileName);
  const steps = document.jobs[jobName].steps;
  const prepare = steps.find(
    (step) => step.name === "Prepare native source signing key"
  );
  const release = steps.find((step) => step.name === releaseStepName);
  const cleanup = steps.find(
    (step) => step.name === "Remove native source signing key"
  );
  assert.match(
    prepare.env.FORGE_NATIVE_SOURCE_ED25519_PRIVATE_KEY,
    /secrets\.FORGE_NATIVE_SOURCE_ED25519_PRIVATE_KEY/
  );
  assert.match(prepare.run, /umask 077/);
  assert.match(prepare.run, /chmod 600/);
  assert.equal(release.env.FORGE_REQUIRE_SIGNED_NATIVE_SOURCE, "1");
  assert.match(
    release.env.FORGE_NATIVE_SOURCE_SIGNING_KEY_PATH,
    /runner\.temp/
  );
  assert.equal(cleanup.if, "always()");
  assert.match(cleanup.run, /rm -f/);
}

test("release workflows require and clean up the native signing key", () => {
  assertSignedReleaseWorkflow(
    "release-openclaw-plugin.yml",
    "publish",
    "Publish release from tag"
  );
  assertSignedReleaseWorkflow(
    "release-hermes-plugin.yml",
    "build",
    "Build and verify release artifacts from tag"
  );
});

test("the shared release gate installs Forge Memory dependencies", () => {
  const document = workflow("people-sharing-release-gate.yml");
  const install = document.jobs["release-gate"].steps.find(
    (step) => step.name === "Install repository dependencies"
  );
  assert.match(install.run, /npm ci/);
  assert.match(
    install.run,
    /npm --prefix packages\/forge-memory ci --ignore-scripts/
  );
  assert.match(
    install.run,
    /npm --prefix packages\/forge-memory audit --omit=dev/
  );
});

test("the Forge Memory publisher builds its authenticated client before CLI tests", () => {
  const document = workflow("release-forge-memory.yml");
  const steps = document.jobs.publish.steps;
  const repositoryInstall = steps.findIndex(
    (step) => step.name === "Install repository dependencies"
  );
  const runtimeBuild = steps.findIndex(
    (step) => step.name === "Build the authenticated Forge client runtime"
  );
  const memoryInstall = steps.findIndex(
    (step) => step.name === "Install Forge Memory dependencies"
  );
  const memoryTest = steps.findIndex(
    (step) => step.name === "Test Forge Memory"
  );

  assert.ok(repositoryInstall >= 0);
  assert.ok(runtimeBuild > repositoryInstall);
  assert.ok(memoryInstall > runtimeBuild);
  assert.ok(memoryTest > memoryInstall);
  assert.equal(steps[repositoryInstall].run, "npm ci");
  assert.equal(steps[runtimeBuild].run, "npm run build:openclaw-plugin");
});

test("every release workflow supports an exact manual publication dispatch", () => {
  for (const fileName of [
    "release-forge-memory.yml",
    "release-openclaw-plugin.yml",
    "release-hermes-plugin.yml",
    "release-connectivity-service.yml",
    "release-ios-companion.yml"
  ]) {
    const dispatch = workflow(fileName).on.workflow_dispatch;
    assert.equal(dispatch.inputs.release_version.required, true, fileName);
    assert.equal(dispatch.inputs.release_version.type, "string", fileName);
  }
  const iosDispatch = workflow("release-ios-companion.yml").on
    .workflow_dispatch;
  assert.deepEqual(iosDispatch.inputs.release_mode.options, [
    "testflight",
    "app-store"
  ]);
});

test("direct publishing scripts require signing and rebuild from the release commit", () => {
  for (const fileName of [
    "release-forge-openclaw-plugin.sh",
    "release-forge-hermes-plugin.sh"
  ]) {
    const source = requireText(
      path.join(forgeRoot, "scripts", "release", fileName)
    );
    assert.match(
      source,
      /FORGE_NATIVE_SOURCE_SIGNING_KEY_PATH is required for a publishing release/
    );
    assert.match(source, /export FORGE_REQUIRE_SIGNED_NATIVE_SOURCE=1/);
    assert.match(
      source,
      /rebuilding signed publish artifacts against release commit/
    );
  }
});

test("prepare releases use fast gates and unsigned integration smoke without weakening publication", () => {
  const releaseSource = requireText(
    path.join(
      forgeRoot,
      "scripts",
      "release",
      "release-forge-openclaw-plugin.sh"
    )
  );
  const smokeSource = requireText(
    path.join(
      forgeRoot,
      "scripts",
      "smoke",
      "smoke-test-packed-openclaw-runtime.mjs"
    )
  );
  assert.match(
    releaseSource,
    /RELEASE_TEST_PROFILE="\$\{FORGE_RELEASE_TEST_PROFILE:-fast\}"/
  );
  assert.match(releaseSource, /FULL_VERIFY_TESTS=\(\s*"npm run test:server"/);
  assert.match(releaseSource, /npm run test:people-sharing-release-fast/);
  assert.match(
    releaseSource,
    /npm --prefix packages\/forge-memory audit --omit=dev/
  );
  assert.match(
    smokeSource,
    /\["full", "publish-from-tag"\]\.includes\(releaseMode\)/
  );
  assert.doesNotMatch(smokeSource, /\["full", "prepare", "publish-from-tag"\]/);
  assert.match(smokeSource, /resolvePeerRuntimeConfiguration/);
  assert.match(
    smokeSource,
    /socketPath: configuration\.supervisor\.socketPath/
  );
  assert.match(
    smokeSource,
    /FORGE_COMPANION_IROH_BIN: companionIrohBinaryPath/
  );
});

test("release builds fail before packaging when the signing key is absent", () => {
  const environment = {
    ...process.env,
    FORGE_RELEASE_MODE: "publish-from-tag"
  };
  delete environment.FORGE_NATIVE_SOURCE_SIGNING_KEY_PATH;
  const result = spawnSync(
    process.execPath,
    [path.join(forgeRoot, "plugins", "openclaw", "scripts", "build.mjs")],
    {
      cwd: forgeRoot,
      env: environment,
      encoding: "utf8",
      timeout: 5_000
    }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires FORGE_NATIVE_SOURCE_SIGNING_KEY_PATH/);
});
