import {
  chmod,
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  NATIVE_SOURCE_MANIFEST_FILE,
  TRUSTED_NATIVE_SOURCE_KEYS,
  UNSIGNED_INTEGRATION_COMMIT_SHA,
  UNSIGNED_INTEGRATION_SIGNING_KEY_ID,
  createNativeSourceManifest,
  serializeNativeSourceManifest,
  serializeNativeSourceSignature,
  signNativeSourceManifest
} from "../../../packages/forge-memory/lib/native-source-manifest.mjs";
import { readNativeSourceSigningKey } from "./native-source-signing-key.mjs";
import {
  patchCompiledJsSpecifiers,
  removeCompiledTests
} from "../../../scripts/build/compiled-server-specifiers.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const pluginDistDir = path.join(packageRoot, "dist");
const pluginServerDir = path.join(packageRoot, "server");
const codexRuntimeRoot = path.join(repoRoot, "plugins", "codex", "runtime");
const codexRuntimeDistDir = path.join(codexRuntimeRoot, "dist");
const codexRuntimeMigrationsDir = path.join(
  codexRuntimeRoot,
  "server",
  "migrations"
);
const repoWebDistDir = path.join(repoRoot, "dist");
const repoMigrationsDir = path.join(repoRoot, "apps", "api", "migrations");
const repoCourseCatalogDir = path.join(
  repoRoot,
  "apps",
  "api",
  "src",
  "course-catalog"
);
const companionIrohRoot = path.join(repoRoot, "packages", "companion-iroh");
const companionIrohManifest = path.join(companionIrohRoot, "Cargo.toml");
const companionIrohBinaryName =
  process.platform === "win32"
    ? "forge-companion-iroh.exe"
    : "forge-companion-iroh";
const companionIrohPlatformKey = `${process.platform}-${process.arch}`;
const companionIrohPrebuiltDir = (
  process.env.FORGE_COMPANION_IROH_PREBUILT_DIR ?? ""
).trim();
const companionIrohPackageMode = (
  process.env.FORGE_COMPANION_IROH_PACKAGE_MODE ?? "source-only"
)
  .trim()
  .toLowerCase();
const forgePeerRoot = path.join(repoRoot, "packages", "forge-peer");
const nativeSourceSigningKeyPath = (
  process.env.FORGE_NATIVE_SOURCE_SIGNING_KEY_PATH ?? ""
).trim();
const requireSignedNativeSource =
  process.env.FORGE_REQUIRE_SIGNED_NATIVE_SOURCE === "1" ||
  process.env.FORGE_RELEASE_MODE === "publish-from-tag";
const pluginServerEntrySource = `import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const builtRuntimeEntry = path.join(packageRoot, "dist", "server", "apps", "api", "src", "index.js");
const devRuntimeEntry = path.join(repoRoot, "apps", "api", "src", "index.ts");
const devDataRootWrapper = path.join(
  repoRoot,
  "scripts",
  "dev",
  "with-openclaw-plugin-data-root.mjs"
);
const tsxCliEntry = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const devModeFlag = (process.env.FORGE_OPENCLAW_DEV ?? "").trim().toLowerCase();
const useDevRuntime = devModeFlag === "1" || devModeFlag === "true" || devModeFlag === "yes";

if (!useDevRuntime) {
  process.chdir(packageRoot);
  await import(pathToFileURL(builtRuntimeEntry).href);
} else {
  if (!existsSync(devRuntimeEntry) || !existsSync(devDataRootWrapper) || !existsSync(tsxCliEntry)) {
    throw new Error(
      "FORGE_OPENCLAW_DEV is enabled, but the Forge repo dev runtime was not found. " +
        "Run this from the Forge repository checkout or disable FORGE_OPENCLAW_DEV."
    );
  }

  console.log("[forge-openclaw-plugin] starting source-backed dev runtime on port", process.env.PORT ?? "4317");

  const child = spawn(
    process.execPath,
    [devDataRootWrapper, process.execPath, tsxCliEntry, "watch", devRuntimeEntry],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        FORGE_DEV_WEB_ORIGIN:
          process.env.FORGE_DEV_WEB_ORIGIN ?? "http://127.0.0.1:3027/forge/",
        HOST: process.env.HOST ?? "0.0.0.0",
        PORT: process.env.PORT ?? "4317"
      }
    }
  );

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on("SIGINT", forwardSignal);
  process.on("SIGTERM", forwardSignal);

  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        process.exitCode = signal === "SIGINT" || signal === "SIGTERM" ? 0 : 1;
        resolve();
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(\`Forge OpenClaw dev runtime exited with code \${code ?? "unknown"}.\`));
    });
  });
}
`;

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: process.env
    });
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`
        )
      );
    });
    child.once("error", reject);
  });
}

function runCaptured(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("exit", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8").trim());
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "unknown"}: ${Buffer.concat(stderr).toString("utf8").trim()}`
        )
      );
    });
    child.once("error", reject);
  });
}

async function removePath(targetPath) {
  await rm(targetPath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  });
}

async function removePackagedGamificationAssets() {
  await removePath(path.join(pluginDistDir, "gamification"));
}

async function chmodIfExists(filePath) {
  try {
    await chmod(filePath, 0o755);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function copyPrebuiltCompanionIroh() {
  if (!companionIrohPrebuiltDir) {
    return;
  }

  const prebuiltRoot = path.resolve(repoRoot, companionIrohPrebuiltDir);
  const sourceRoot =
    path.basename(prebuiltRoot) === "companion-iroh"
      ? prebuiltRoot
      : path.join(prebuiltRoot, "companion-iroh");
  let entries;
  try {
    entries = await readdir(sourceRoot, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `FORGE_COMPANION_IROH_PREBUILT_DIR did not contain companion binaries at ${sourceRoot}: ${error.message}`
    );
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const sourcePlatformDir = path.join(sourceRoot, entry.name);
    const targetPlatformDir = path.join(
      pluginDistDir,
      "companion-iroh",
      entry.name
    );
    await cp(sourcePlatformDir, targetPlatformDir, {
      recursive: true,
      force: true
    });
    await chmodIfExists(path.join(targetPlatformDir, "forge-companion-iroh"));
    await chmodIfExists(
      path.join(targetPlatformDir, "forge-companion-iroh.exe")
    );
  }
}

async function packageCompanionIroh() {
  const sourceDir = path.join(pluginDistDir, "companion-iroh-src");
  await removePath(sourceDir);
  await mkdir(sourceDir, { recursive: true });
  await copyFile(
    path.join(companionIrohRoot, "Cargo.toml"),
    path.join(sourceDir, "Cargo.toml")
  );
  await copyFile(
    path.join(companionIrohRoot, "Cargo.lock"),
    path.join(sourceDir, "Cargo.lock")
  );
  await cp(path.join(companionIrohRoot, "src"), path.join(sourceDir, "src"), {
    recursive: true,
    force: true
  });

  if (companionIrohPackageMode === "source-only") {
    return;
  }

  if (
    companionIrohPackageMode !== "local-binary" &&
    companionIrohPackageMode !== "local-and-prebuilt"
  ) {
    throw new Error(
      `Unsupported FORGE_COMPANION_IROH_PACKAGE_MODE ${JSON.stringify(companionIrohPackageMode)}. ` +
        "Use source-only, local-binary, or local-and-prebuilt."
    );
  }

  await run(
    "cargo",
    [
      "build",
      "--release",
      "--manifest-path",
      companionIrohManifest,
      "--bin",
      "forge-companion-iroh"
    ],
    repoRoot
  );

  const binarySource = path.join(
    companionIrohRoot,
    "target",
    "release",
    companionIrohBinaryName
  );
  const binaryDir = path.join(
    pluginDistDir,
    "companion-iroh",
    companionIrohPlatformKey
  );
  await mkdir(binaryDir, { recursive: true });
  await copyFile(binarySource, path.join(binaryDir, companionIrohBinaryName));
  if (process.platform !== "win32") {
    await chmod(path.join(binaryDir, companionIrohBinaryName), 0o755);
  }

  if (companionIrohPackageMode === "local-and-prebuilt") {
    await copyPrebuiltCompanionIroh();
  }
}

function cargoPackageVersion(cargoToml) {
  let inPackageSection = false;
  for (const line of cargoToml.split(/\r?\n/)) {
    if (line.trim() === "[package]") {
      inPackageSection = true;
      continue;
    }
    if (inPackageSection && /^\s*\[/.test(line)) break;
    if (!inPackageSection) continue;
    const match = /^version\s*=\s*"([^"]+)"\s*$/.exec(line);
    if (match) return match[1];
  }
  throw new Error("packages/forge-peer/Cargo.toml has no package version.");
}

function releaseSigningKeyAt(generatedAt) {
  const timestamp = generatedAt.getTime();
  const key = TRUSTED_NATIVE_SOURCE_KEYS.find((candidate) => {
    const notBefore = Date.parse(candidate.notBefore);
    const notAfter =
      candidate.notAfter === null
        ? Number.POSITIVE_INFINITY
        : Date.parse(candidate.notAfter);
    return (
      candidate.revokedAt === null &&
      Number.isFinite(notBefore) &&
      timestamp >= notBefore &&
      timestamp <= notAfter
    );
  });
  if (!key) {
    throw new Error(
      "No pinned native source signing key is valid for this release commit."
    );
  }
  return key;
}

async function assertForgePeerSourceClean() {
  const forgePeerStatus = await runCaptured(
    "git",
    [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      "packages/forge-peer"
    ],
    repoRoot
  );
  if (forgePeerStatus) {
    throw new Error(
      "Signed native source builds require a clean packages/forge-peer tree."
    );
  }
}

async function packageForgePeer(privateKey) {
  const sourceDir = path.join(pluginDistDir, "forge-peer-src");
  await removePath(sourceDir);
  await mkdir(sourceDir, { recursive: true });

  for (const fileName of ["Cargo.toml", "Cargo.lock", "README.md"]) {
    await copyFile(
      path.join(forgePeerRoot, fileName),
      path.join(sourceDir, fileName)
    );
  }
  for (const directoryName of ["src", "tests"]) {
    await cp(
      path.join(forgePeerRoot, directoryName),
      path.join(sourceDir, directoryName),
      { recursive: true, force: true, dereference: false }
    );
  }
  const fuzzSourceRoot = path.join(forgePeerRoot, "fuzz");
  const fuzzTargetRoot = path.join(sourceDir, "fuzz");
  await mkdir(fuzzTargetRoot, { recursive: true });
  for (const fileName of ["Cargo.toml", "Cargo.lock"]) {
    await copyFile(
      path.join(fuzzSourceRoot, fileName),
      path.join(fuzzTargetRoot, fileName)
    );
  }
  await cp(
    path.join(fuzzSourceRoot, "fuzz_targets"),
    path.join(fuzzTargetRoot, "fuzz_targets"),
    { recursive: true, force: true, dereference: false }
  );

  const [pluginPackage, cargoToml] = await Promise.all([
    readFile(path.join(packageRoot, "package.json"), "utf8").then(JSON.parse),
    readFile(path.join(forgePeerRoot, "Cargo.toml"), "utf8")
  ]);
  let commitSha = UNSIGNED_INTEGRATION_COMMIT_SHA;
  let signingKeyId = UNSIGNED_INTEGRATION_SIGNING_KEY_ID;
  let generatedAt = new Date();
  if (privateKey) {
    const [releaseCommitSha, commitTimestamp] = await Promise.all([
      runCaptured("git", ["rev-parse", "HEAD"], repoRoot),
      runCaptured("git", ["show", "-s", "--format=%cI", "HEAD"], repoRoot)
    ]);
    commitSha = releaseCommitSha;
    generatedAt = new Date(commitTimestamp);
    signingKeyId = releaseSigningKeyAt(generatedAt).id;
  }
  if (!Number.isFinite(generatedAt.getTime())) {
    throw new Error("The release commit timestamp is invalid.");
  }
  const manifest = await createNativeSourceManifest({
    sourceRoot: sourceDir,
    packageVersion: cargoPackageVersion(cargoToml),
    runtimePackageVersion: pluginPackage.version,
    commitSha,
    generatedAt,
    signingKeyId
  });
  await writeFile(
    path.join(sourceDir, NATIVE_SOURCE_MANIFEST_FILE),
    serializeNativeSourceManifest(manifest),
    { encoding: "utf8", mode: 0o600, flag: "wx" }
  );

  if (!privateKey) {
    if (requireSignedNativeSource) {
      throw new Error(
        "A signed release build requires FORGE_NATIVE_SOURCE_SIGNING_KEY_PATH."
      );
    }
    return;
  }
  const signature = signNativeSourceManifest(manifest, privateKey);
  await writeFile(
    path.join(sourceDir, "native-source.signature.json"),
    serializeNativeSourceSignature(signature),
    { encoding: "utf8", mode: 0o600, flag: "wx" }
  );
}

const nativeSourcePrivateKey = nativeSourceSigningKeyPath
  ? await readNativeSourceSigningKey({
      keyPath: nativeSourceSigningKeyPath,
      repositoryRoot: repoRoot
    })
  : null;
if (requireSignedNativeSource && !nativeSourcePrivateKey) {
  throw new Error(
    "A signed release build requires FORGE_NATIVE_SOURCE_SIGNING_KEY_PATH."
  );
}
if (nativeSourcePrivateKey) {
  await assertForgePeerSourceClean();
}

await removePath(pluginDistDir);
await removePath(pluginServerDir);
await mkdir(pluginDistDir, { recursive: true });

await run(
  "npm",
  ["exec", "--", "tsc", "-p", "tsconfig.build.json"],
  packageRoot
);
// Package builds need emitted runtime JS even when unrelated repo-wide strict
// type errors exist outside the plugin surface. Keep release verification
// stricter elsewhere, but use no-check emit here so local packaging can run.
await run(
  "npm",
  [
    "exec",
    "--",
    "tsc",
    "-p",
    "apps/api/tsconfig.json",
    "--outDir",
    "plugins/openclaw/dist/server",
    "--noCheck"
  ],
  repoRoot
);
await removeCompiledTests(path.join(pluginDistDir, "server"));
await patchCompiledJsSpecifiers(path.join(pluginDistDir, "server"), {
  emittedWebSrcRoot: path.join(pluginDistDir, "server", "apps", "web", "src")
});
await run("npm", ["run", "build"], repoRoot);

const packagedGamificationRoot = path.join(repoWebDistDir, "gamification");
await cp(repoWebDistDir, pluginDistDir, {
  recursive: true,
  force: true,
  filter(sourcePath) {
    return (
      sourcePath !== packagedGamificationRoot &&
      !sourcePath.startsWith(`${packagedGamificationRoot}${path.sep}`)
    );
  }
});
await removePackagedGamificationAssets();
await packageCompanionIroh();
await packageForgePeer(nativeSourcePrivateKey);
await mkdir(path.join(pluginDistDir, "server", "apps", "api"), {
  recursive: true
});
await cp(
  repoMigrationsDir,
  path.join(pluginDistDir, "server", "apps", "api", "migrations"),
  { recursive: true, force: true }
);
await cp(
  repoCourseCatalogDir,
  path.join(pluginDistDir, "server", "apps", "api", "src", "course-catalog"),
  { recursive: true, force: true }
);
await mkdir(path.join(pluginServerDir), { recursive: true });
await cp(repoMigrationsDir, path.join(pluginServerDir, "migrations"), {
  recursive: true,
  force: true
});
await writeFile(
  path.join(pluginServerDir, "index.js"),
  pluginServerEntrySource,
  "utf8"
);

await removePath(codexRuntimeDistDir);
await removePath(codexRuntimeMigrationsDir);
await mkdir(codexRuntimeRoot, { recursive: true });
await cp(pluginDistDir, codexRuntimeDistDir, { recursive: true, force: true });
await mkdir(path.join(codexRuntimeRoot, "server"), { recursive: true });
await cp(repoMigrationsDir, codexRuntimeMigrationsDir, {
  recursive: true,
  force: true
});
