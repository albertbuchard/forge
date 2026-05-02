import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import AdmZip from "adm-zip";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageRoot, "..");
const repoSkillDir = path.join(repoRoot, "skills", "forge-openclaw");
const packageSkillDir = path.join(packageRoot, "skills", "forge-openclaw");
const pluginDistDir = path.join(packageRoot, "dist");
const pluginServerDir = path.join(packageRoot, "server");
const codexRuntimeRoot = path.join(repoRoot, "plugins", "forge-codex", "runtime");
const codexRuntimeDistDir = path.join(codexRuntimeRoot, "dist");
const codexRuntimeMigrationsDir = path.join(codexRuntimeRoot, "server", "migrations");
const packageGamificationSpritesDir = path.join(
  packageRoot,
  "assets",
  "gamification",
  "sprites.zip"
);
const packagedGamificationThemes = [
  "dark-fantasy",
  "dramatic-smithie",
  "mind-locksmith"
];
const packagedGamificationSpriteSizes = [256, 512];
const repoWebDistDir = path.join(repoRoot, "dist");
const repoMigrationsDir = path.join(repoRoot, "server", "migrations");
const pluginServerEntrySource = `import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "..");
const builtRuntimeEntry = path.join(packageRoot, "dist", "server", "server", "src", "index.js");
const devRuntimeEntry = path.join(repoRoot, "server", "src", "index.ts");
const devDataRootWrapper = path.join(repoRoot, "scripts", "with-openclaw-plugin-data-root.mjs");
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
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
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

async function removeCompiledTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await removeCompiledTests(fullPath);
      continue;
    }
    if (entry.isFile() && /\.test\.js$/.test(entry.name)) {
      await rm(fullPath, { force: true });
    }
  }
}

function normalizeRelativeJsSpecifier(specifier) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return specifier;
  }
  if (specifier.endsWith("/")) {
    return `${specifier}index.js`;
  }
  return path.extname(specifier) ? specifier : `${specifier}.js`;
}

function rewriteRelativeJsSpecifiers(source) {
  return source
    .replace(/((?:import|export)\s[^"'\n]*?\sfrom\s+["'])(\.\.?\/[^"']+)(["'])/g, (_match, prefix, specifier, suffix) =>
      `${prefix}${normalizeRelativeJsSpecifier(specifier)}${suffix}`
    )
    .replace(/(import\s*\(\s*["'])(\.\.?\/[^"']+)(["']\s*\))/g, (_match, prefix, specifier, suffix) =>
      `${prefix}${normalizeRelativeJsSpecifier(specifier)}${suffix}`
    );
}

function resolveAliasJsSpecifier(filePath, specifier) {
  if (!specifier.startsWith("@/")) {
    return specifier;
  }

  const serverSrcRoot = path.join(pluginDistDir, "server", "src");
  const targetPath = path.join(serverSrcRoot, specifier.slice(2));
  const relativePath = path.relative(
    path.dirname(filePath),
    path.extname(targetPath) ? targetPath : `${targetPath}.js`
  );
  const normalized = relativePath.split(path.sep).join("/");
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

function rewriteAliasJsSpecifiers(filePath, source) {
  return source
    .replace(/((?:import|export)\s[^"'\n]*?\sfrom\s+["'])(@\/[^"']+)(["'])/g, (_match, prefix, specifier, suffix) =>
      `${prefix}${resolveAliasJsSpecifier(filePath, specifier)}${suffix}`
    )
    .replace(/(import\s*\(\s*["'])(@\/[^"']+)(["']\s*\))/g, (_match, prefix, specifier, suffix) =>
      `${prefix}${resolveAliasJsSpecifier(filePath, specifier)}${suffix}`
    );
}

async function patchCompiledJsSpecifiers(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await patchCompiledJsSpecifiers(fullPath);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".js")) {
      continue;
    }

    const source = await readFile(fullPath, "utf8");
    const rewritten = rewriteAliasJsSpecifiers(
      fullPath,
      rewriteRelativeJsSpecifiers(source)
    );
    if (rewritten !== source) {
      await writeFile(fullPath, rewritten, "utf8");
    }
  }
}

async function stagePackagedGamificationAssets() {
  const gamificationDistDir = path.join(pluginDistDir, "gamification");
  const sourceThemesDir = path.join(gamificationDistDir, "source", "themes");
  const spritesDir = path.join(gamificationDistDir, "sprites");
  const spritesArchivePath = path.join(gamificationDistDir, "sprites.zip");
  const catalogModule = await import(
    pathToFileURL(
      path.join(pluginDistDir, "server", "src", "lib", "gamification-catalog.js")
    ).href
  );
  const itemAssetKeys = [
    ...new Set(catalogModule.GAMIFICATION_CATALOG.map((item) => item.assetKey))
  ];
  const mascotAssetKeys = catalogModule.GAMIFICATION_MASCOT_KEYS;
  const expectedSpritePaths = [];
  for (const theme of packagedGamificationThemes) {
    for (const size of packagedGamificationSpriteSizes) {
      for (const key of itemAssetKeys) {
        expectedSpritePaths.push(
          path.join("themes", theme, "items", `${key}-${size}.webp`)
        );
      }
      for (const key of mascotAssetKeys) {
        expectedSpritePaths.push(
          path.join("themes", theme, "mascots", `${key}-${size}.webp`)
        );
      }
    }
  }

  // The packaged web UI only references transparent 256/512 WEBP sprites.
  // Keep local repo source assets for future regridding, but do not ship
  // multi-hundred-MB atlas/source payloads, reserve sprites, PNGs, or 1024 variants.
  await removePath(sourceThemesDir);
  await removePath(spritesDir);
  await cp(packageGamificationSpritesDir, spritesArchivePath);

  const expectedEntries = new Set(expectedSpritePaths.map((entry) => entry.split(path.sep).join("/")));
  const archive = new AdmZip(spritesArchivePath);
  const archiveEntries = archive
    .getEntries()
    .filter((entry) => !entry.isDirectory)
    .map((entry) => entry.entryName);
  const missingEntries = [...expectedEntries].filter((entry) => !archiveEntries.includes(entry));
  const unexpectedEntries = archiveEntries.filter((entry) => !expectedEntries.has(entry));
  if (missingEntries.length > 0 || unexpectedEntries.length > 0) {
    throw new Error(
      `Invalid gamification sprite archive. Missing ${missingEntries.length}, unexpected ${unexpectedEntries.length}.`
    );
  }
}

await removePath(pluginDistDir);
await removePath(pluginServerDir);
await mkdir(pluginDistDir, { recursive: true });
await removePath(packageSkillDir);
await cp(repoSkillDir, packageSkillDir, { recursive: true, force: true });

await run("npm", ["exec", "--", "tsc", "-p", "tsconfig.build.json"], packageRoot);
// Package builds need emitted runtime JS even when unrelated repo-wide strict
// type errors exist outside the plugin surface. Keep release verification
// stricter elsewhere, but use no-check emit here so local packaging can run.
await run(
  "npm",
  ["exec", "--", "tsc", "-p", "../server/tsconfig.json", "--outDir", "./dist/server", "--noCheck"],
  packageRoot
);
await removeCompiledTests(path.join(pluginDistDir, "server"));
await patchCompiledJsSpecifiers(path.join(pluginDistDir, "server"));
await run("npm", ["run", "build"], repoRoot);

await cp(repoWebDistDir, pluginDistDir, { recursive: true, force: true });
await stagePackagedGamificationAssets();
await mkdir(path.join(pluginDistDir, "server", "server"), { recursive: true });
await cp(repoMigrationsDir, path.join(pluginDistDir, "server", "server", "migrations"), { recursive: true, force: true });
await mkdir(path.join(pluginServerDir), { recursive: true });
await cp(repoMigrationsDir, path.join(pluginServerDir, "migrations"), { recursive: true, force: true });
await writeFile(
  path.join(pluginServerDir, "index.js"),
  `${pluginServerEntrySource}\n`,
  "utf8"
);

await removePath(codexRuntimeDistDir);
await removePath(codexRuntimeMigrationsDir);
await mkdir(codexRuntimeRoot, { recursive: true });
await cp(pluginDistDir, codexRuntimeDistDir, { recursive: true, force: true });
await mkdir(path.join(codexRuntimeRoot, "server"), { recursive: true });
await cp(repoMigrationsDir, codexRuntimeMigrationsDir, { recursive: true, force: true });
