import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function text(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("desktop release requires signing, notarization, and a pinned updater key", async () => {
  const [workflow, config, writer] = await Promise.all([
    text(".github/workflows/release-desktop.yml"),
    text("apps/desktop-tauri/tauri.conf.json"),
    text("scripts/release/write-tauri-release-config.mjs")
  ]);
  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY/u);
  assert.match(workflow, /APPLE_CERTIFICATE/u);
  assert.match(workflow, /APPLE_ID/u);
  assert.match(workflow, /notar/u);
  assert.match(writer, /TAURI_UPDATER_PUBLIC_KEY is required/u);
  assert.match(writer, /pubkey: publicKey/u);
  assert.match(config, /createUpdaterArtifacts/u);
  assert.match(config, /"beforeBuildCommand": "cd \.\.\/\.\. && npm run build"/u);
  assert.match(config, /"beforeDevCommand": "cd \.\.\/\.\. && npm run dev"/u);
});

test("Android release creates a signed review artifact and reports background sync truthfully", async () => {
  const [workflow, build, viewModel, health, worker] = await Promise.all([
    text(".github/workflows/release-android-companion.yml"),
    text("apps/android-companion/app/build.gradle.kts"),
    text("apps/android-companion/app/src/main/java/com/aurel/forge/companion/MainViewModel.kt"),
    text("apps/android-companion/app/src/main/java/com/aurel/forge/companion/HealthSync.kt"),
    text("apps/android-companion/app/src/main/java/com/aurel/forge/companion/SyncWorker.kt")
  ]);
  for (const secret of [
    "FORGE_ANDROID_KEYSTORE",
    "FORGE_ANDROID_KEYSTORE_PASSWORD",
    "FORGE_ANDROID_KEY_ALIAS",
    "FORGE_ANDROID_KEY_PASSWORD"
  ]) {
    assert.match(workflow, new RegExp(secret, "u"));
    assert.match(build, new RegExp(secret, "u"));
  }
  assert.match(workflow, /app-release\.aab/u);
  assert.match(viewModel, /selectedCategories: Set<HealthCategory> = emptySet\(\)/u);
  assert.match(viewModel, /queue\.clear\(\)/u);
  assert.match(health, /build\(categories: Set<HealthCategory>, backgroundRefreshEnabled: Boolean\)/u);
  assert.match(health, /put\("backgroundRefreshEnabled", backgroundRefreshEnabled\)/u);
  assert.match(viewModel, /mutableState\.value\.syncEnabled/u);
  assert.match(worker, /build\(categories, true\)/u);
});

test("public demo release publishes only the isolated gateway image and documents external TLS and secret gates", async () => {
  const [workflow, dockerfile, gateway] = await Promise.all([
    text(".github/workflows/release-public-demo.yml"),
    text("apps/demo-runtime/Dockerfile"),
    text("apps/demo-runtime/gateway.ts")
  ]);
  assert.match(workflow, /FORGE_DEMO_SESSION_SECRET/u);
  assert.match(workflow, /TLS reverse proxy required/u);
  assert.match(dockerfile, /demo:public/u);
  assert.match(gateway, /maxSessions = 20/u);
  assert.match(gateway, /sessionTtlMs = 30 \* 60_000/u);
  assert.match(gateway, /idleTtlMs = 15 \* 60_000/u);
});
