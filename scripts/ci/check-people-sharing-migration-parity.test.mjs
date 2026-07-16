import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  peopleMigrationDestinations,
  peopleMigrationNames,
  verifyPeopleMigrationArchives,
  verifyPeopleMigrationParity
} from "./check-people-sharing-migration-parity.mjs";

function migrationBytes(migrationName) {
  return Buffer.from(
    `-- exact fixture for ${migrationName}\nSELECT 1;\n`,
    "utf8"
  );
}

function writeRepositoryFixture(root) {
  for (const migrationName of peopleMigrationNames) {
    const content = migrationBytes(migrationName);
    const canonical = path.join(root, "apps/api/migrations", migrationName);
    mkdirSync(path.dirname(canonical), { recursive: true });
    writeFileSync(canonical, content);
    for (const destination of peopleMigrationDestinations) {
      const packaged = path.join(root, destination, migrationName);
      mkdirSync(path.dirname(packaged), { recursive: true });
      writeFileSync(packaged, content);
    }
  }
}

function archiveEntries(migrationRoots, mutate = null) {
  const entries = [];
  for (const migrationRoot of migrationRoots) {
    for (const migrationName of peopleMigrationNames) {
      const content =
        mutate === `${migrationRoot}/${migrationName}`
          ? Buffer.from("changed\n", "utf8")
          : migrationBytes(migrationName);
      entries.push([`${migrationRoot}/${migrationName}`, content]);
    }
  }
  return entries;
}

function writeNpmPackage(
  packageRoot,
  packageName,
  migrationRoots,
  mutate = null
) {
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        files: ["server", "dist"],
        name: packageName,
        version: "1.0.0"
      },
      null,
      2
    )}\n`
  );
  for (const [entryPath, content] of archiveEntries(migrationRoots, mutate)) {
    const filePath = path.join(
      packageRoot,
      entryPath.replace(/^package\//, "")
    );
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
}

function packNpmPackage(packageRoot, artifactRoot) {
  const result = spawnSync(
    "npm",
    ["pack", packageRoot, "--pack-destination", artifactRoot, "--silent"],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
}

function writeWheel(archivePath, entries) {
  const payload = Object.fromEntries(
    entries.map(([entryPath, content]) => [
      entryPath,
      content.toString("base64")
    ])
  );
  const script = String.raw`
import base64
import json
import sys
import zipfile

entries = json.loads(sys.argv[2])
with zipfile.ZipFile(sys.argv[1], "w", compression=zipfile.ZIP_STORED) as archive:
    for name, encoded in entries.items():
        archive.writestr(name, base64.b64decode(encoded))
`;
  const result = spawnSync(
    "python3",
    ["-c", script, archivePath, JSON.stringify(payload)],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
}

test("repository parity checks exact bytes across all six package destinations", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-people-parity-"));
  writeRepositoryFixture(root);
  assert.deepEqual(verifyPeopleMigrationParity({ repoRoot: root }), {
    checkedCopies:
      peopleMigrationNames.length * peopleMigrationDestinations.length,
    destinationCount: 6,
    migrationCount: peopleMigrationNames.length
  });

  const divergent = path.join(
    root,
    peopleMigrationDestinations[4],
    peopleMigrationNames[1]
  );
  writeFileSync(divergent, "-- divergent migration\n");
  assert.throws(
    () => verifyPeopleMigrationParity({ repoRoot: root }),
    new RegExp(
      `${peopleMigrationDestinations[4]}/${peopleMigrationNames[1]}: bytes differ`
    )
  );
});

test("repository parity fails closed when a required migration copy is absent", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-people-missing-"));
  const canonical = path.join(
    root,
    "apps/api/migrations",
    peopleMigrationNames[0]
  );
  mkdirSync(path.dirname(canonical), { recursive: true });
  writeFileSync(canonical, migrationBytes(peopleMigrationNames[0]));
  assert.throws(
    () =>
      verifyPeopleMigrationParity({
        repoRoot: root,
        migrationNames: [peopleMigrationNames[0]],
        destinations: [peopleMigrationDestinations[0]]
      }),
    /ENOENT/
  );
});

test("archive parity executes against npm tarballs and a Hermes wheel", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-people-archives-"));
  writeRepositoryFixture(root);
  const artifactRoot = path.join(root, "artifacts");
  mkdirSync(artifactRoot);

  const npmRoots = [
    "package/server/migrations",
    "package/dist/server/apps/api/migrations"
  ];
  const openClawPackage = path.join(root, "openclaw-package");
  writeNpmPackage(openClawPackage, "forge-openclaw-plugin", npmRoots);
  packNpmPackage(openClawPackage, artifactRoot);
  const codexPackage = path.join(root, "codex-package");
  writeNpmPackage(codexPackage, "forge-codex-runtime", npmRoots);
  packNpmPackage(codexPackage, artifactRoot);
  writeWheel(
    path.join(artifactRoot, "forge_hermes_plugin-1.0.0-py3-none-any.whl"),
    archiveEntries([
      "forge_hermes/runtime/apps/api/migrations",
      "forge_hermes/runtime/dist/server/apps/api/migrations"
    ])
  );

  assert.deepEqual(
    verifyPeopleMigrationArchives({
      artifactRoot,
      repoRoot: root,
      requiredSurfaces: ["openclaw", "codex", "hermes"]
    }),
    {
      archiveCount: 3,
      checkedEntries: peopleMigrationNames.length * 2 * 3,
      surfaces: ["codex", "hermes", "openclaw"]
    }
  );
});

test("archive parity rejects divergent bytes and missing required archives", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "forge-people-archive-bad-"));
  writeRepositoryFixture(root);
  const artifactRoot = path.join(root, "artifacts");
  mkdirSync(artifactRoot);
  const migrationRoots = [
    "package/server/migrations",
    "package/dist/server/apps/api/migrations"
  ];
  const divergentPath = `${migrationRoots[1]}/${peopleMigrationNames[2]}`;
  const openClawPackage = path.join(root, "openclaw-package");
  writeNpmPackage(
    openClawPackage,
    "forge-openclaw-plugin",
    migrationRoots,
    divergentPath
  );
  packNpmPackage(openClawPackage, artifactRoot);
  assert.throws(
    () =>
      verifyPeopleMigrationArchives({
        artifactRoot,
        repoRoot: root,
        requiredSurfaces: ["openclaw", "codex"]
      }),
    (error) => {
      assert.match(error.message, /differs from canonical migration bytes/);
      assert.match(error.message, /Required codex package archive is missing/);
      return true;
    }
  );
});
