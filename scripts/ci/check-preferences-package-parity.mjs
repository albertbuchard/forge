import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

import { buildOpenApiDocument } from "../../apps/api/src/openapi.ts";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "../..");

export const PREFERENCE_OPENAPI_COPIES = [
  "plugins/openclaw/docs/openapi.json",
  "plugins/openclaw/docs/api/openapi.json"
];

export const PREFERENCE_MIGRATION_NAMES = [
  "086_preference_catalog_contract.sql",
  "089_preference_owner_scope.sql",
  "090_preference_adversarial_hardening.sql",
  "101_preference_integrity_and_signal_idempotency.sql"
];

export const PREFERENCE_REQUIRED_MIGRATION_DESTINATIONS = [
  "plugins/codex/runtime/server/migrations",
  "plugins/hermes/forge_hermes/runtime/apps/api/migrations"
];

export const PREFERENCE_GENERATED_MIGRATION_DESTINATIONS = [
  "plugins/openclaw/server/migrations",
  "plugins/openclaw/dist/server/apps/api/migrations",
  "plugins/codex/runtime/dist/server/apps/api/migrations",
  "plugins/hermes/forge_hermes/runtime/dist/server/apps/api/migrations"
];

function collectComponentReferences(value, references) {
  if (Array.isArray(value)) {
    for (const entry of value) collectComponentReferences(entry, references);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (
      key === "$ref" &&
      typeof entry === "string" &&
      entry.startsWith("#/components/")
    ) {
      references.add(entry);
    } else {
      collectComponentReferences(entry, references);
    }
  }
}

export function preferenceOpenApiSlice(document, failures = []) {
  const paths = Object.fromEntries(
    Object.entries(document.paths ?? {}).filter(([route]) =>
      route.startsWith("/api/v1/preferences/")
    )
  );
  const references = new Set();
  collectComponentReferences(paths, references);
  const components = {};
  const visited = new Set();
  while (references.size > 0) {
    const reference = references.values().next().value;
    references.delete(reference);
    if (visited.has(reference)) continue;
    visited.add(reference);
    const [, , section, ...nameParts] = reference.split("/");
    const name = nameParts.join("/");
    const component = document.components?.[section]?.[name];
    if (!component) {
      failures.push(`OpenAPI source has an unresolved component: ${reference}`);
      continue;
    }
    components[section] ??= {};
    components[section][name] = component;
    collectComponentReferences(component, references);
  }
  return { paths, components };
}

async function readJson(repoRoot, relativePath, failures) {
  try {
    return JSON.parse(
      await readFile(path.join(repoRoot, relativePath), "utf8")
    );
  } catch (error) {
    failures.push(`${relativePath}: ${error.message}`);
    return null;
  }
}

export async function checkPreferenceOpenApiCopies({
  repoRoot,
  sourceDocument,
  copies = PREFERENCE_OPENAPI_COPIES
}) {
  const failures = [];
  const sourceOpenApi = preferenceOpenApiSlice(sourceDocument, failures);
  let checked = 0;
  for (const relativePath of copies) {
    const packaged = await readJson(repoRoot, relativePath, failures);
    if (!packaged) continue;
    checked += 1;
    if (
      !isDeepStrictEqual(
        preferenceOpenApiSlice(packaged, failures),
        sourceOpenApi
      )
    ) {
      failures.push(
        `[HELD generated synchronization] ${relativePath}: Preferences routes or referenced components differ from apps/api/src/openapi.ts`
      );
    }
  }
  return { failures, checked };
}

export async function checkPreferenceMigrationCopies({
  repoRoot,
  trackedPaths,
  checkGeneratedOutputs = false,
  migrationNames = PREFERENCE_MIGRATION_NAMES,
  requiredDestinations = PREFERENCE_REQUIRED_MIGRATION_DESTINATIONS,
  generatedDestinations = PREFERENCE_GENERATED_MIGRATION_DESTINATIONS
}) {
  const failures = [];
  let checked = 0;
  let skippedGenerated = 0;

  for (const migrationName of migrationNames) {
    const sourcePath = `apps/api/migrations/${migrationName}`;
    let source;
    try {
      source = await readFile(path.join(repoRoot, sourcePath));
    } catch (error) {
      failures.push(`${sourcePath}: ${error.message}`);
      continue;
    }

    for (const destination of requiredDestinations) {
      const packagedPath = `${destination}/${migrationName}`;
      let packaged;
      try {
        packaged = await readFile(path.join(repoRoot, packagedPath));
      } catch (error) {
        failures.push(
          `${packagedPath}: required source-runtime migration is missing (${error.message})`
        );
        continue;
      }
      checked += 1;
      if (!packaged.equals(source)) {
        failures.push(`${packagedPath}: content differs from ${sourcePath}`);
      }
    }

    for (const destination of generatedDestinations) {
      const packagedPath = `${destination}/${migrationName}`;
      const tracked = trackedPaths.has(packagedPath);
      if (!tracked && !checkGeneratedOutputs) {
        skippedGenerated += 1;
        continue;
      }

      let packaged;
      try {
        packaged = await readFile(path.join(repoRoot, packagedPath));
      } catch (error) {
        const kind = tracked ? "tracked package mirror" : "generated output";
        failures.push(`${packagedPath}: ${kind} is missing (${error.message})`);
        continue;
      }
      checked += 1;
      if (!packaged.equals(source)) {
        failures.push(
          `${packagedPath}: content differs from ${sourcePath}${tracked ? "" : " [generated output]"}`
        );
      }
    }
  }

  return { failures, checked, skippedGenerated };
}

export async function listTrackedPaths(repoRoot) {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  return new Set(stdout.split("\0").filter(Boolean));
}

export async function runPreferencePackageParity({
  repoRoot = defaultRepoRoot,
  checkGeneratedOutputs = false
} = {}) {
  const trackedPaths = await listTrackedPaths(repoRoot);
  const openApi = await checkPreferenceOpenApiCopies({
    repoRoot,
    sourceDocument: buildOpenApiDocument()
  });
  const migrations = await checkPreferenceMigrationCopies({
    repoRoot,
    trackedPaths,
    checkGeneratedOutputs
  });
  return {
    failures: [...openApi.failures, ...migrations.failures],
    checkedOpenApi: openApi.checked,
    checkedMigrations: migrations.checked,
    skippedGenerated: migrations.skippedGenerated
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const checkGeneratedOutputs = process.argv.includes("--check-generated");
  const result = await runPreferencePackageParity({ checkGeneratedOutputs });
  if (result.skippedGenerated > 0) {
    console.warn(
      `Preferences package parity skipped ${result.skippedGenerated} generated-only runtime migration outputs that are not tracked in a clean checkout. Build the package runtimes, then pass --check-generated to verify them explicitly.`
    );
  }
  if (result.failures.length > 0) {
    console.error("Preferences package parity failed:");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(
      `Preferences package parity passed: ${result.checkedOpenApi} tracked OpenAPI documents and ${result.checkedMigrations} tracked migration mirrors checked.`
    );
  }
}
