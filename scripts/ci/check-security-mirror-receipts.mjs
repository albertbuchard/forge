#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

const migrationMirrors = [
  "plugins/codex/runtime/server/migrations",
  "plugins/codex/runtime/dist/server/apps/api/migrations",
  "plugins/hermes/forge_hermes/runtime/apps/api/migrations",
  "plugins/hermes/forge_hermes/runtime/dist/server/apps/api/migrations",
  "plugins/openclaw/server/migrations",
  "plugins/openclaw/dist/server/apps/api/migrations"
];

const compiledDatabaseMirrors = [
  "plugins/codex/runtime/dist/server/apps/api/src/db.js",
  "plugins/hermes/forge_hermes/runtime/dist/server/apps/api/src/db.js",
  "plugins/openclaw/dist/server/apps/api/src/db.js"
];

const compiledDatabaseCompatibilityMarkers = [
  "120_security_pairing_metadata_compatibility.sql",
  "function backfillLegacyPairingClientMetadata(database)",
  "INSERT OR IGNORE INTO security_pairing_client_metadata",
  "backfillLegacyPairingClientMetadata(database);"
];

const compiledDataManagementMirrors = [
  "plugins/codex/runtime/dist/server/apps/api/src/services/data-management.js",
  "plugins/hermes/forge_hermes/runtime/dist/server/apps/api/src/services/data-management.js",
  "plugins/openclaw/dist/server/apps/api/src/services/data-management.js"
];

const compiledDataManagementSecurityMarkers = [
  "addReadStreamLazy",
  "fromFdPromise",
  "openReadOnlyDescriptor",
  "MAX_BACKUP_ARCHIVE_ENTRIES",
  "MAX_BACKUP_ARCHIVE_TOTAL_BYTES"
];

const migrationFilePattern = /^\d{3}_.+\.sql$/u;

const exactFileMirrors = [
  {
    canonicalRoot: "packages/companion-iroh",
    mirrorRoots: [
      "plugins/codex/runtime/dist/companion-iroh-src",
      "plugins/hermes/forge_hermes/runtime/dist/companion-iroh-src",
      "plugins/openclaw/dist/companion-iroh-src"
    ],
    files: ["Cargo.toml", "Cargo.lock"]
  },
  {
    canonicalRoot: "packages/forge-peer/fuzz",
    mirrorRoots: [
      "plugins/codex/runtime/dist/forge-peer-src/fuzz",
      "plugins/hermes/forge_hermes/runtime/dist/forge-peer-src/fuzz",
      "plugins/openclaw/dist/forge-peer-src/fuzz"
    ],
    files: ["Cargo.lock"]
  }
];

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function assertExactFile(canonicalPath, mirrorPath) {
  const [canonical, mirror] = await Promise.all([
    readFile(path.join(repoRoot, canonicalPath)),
    readFile(path.join(repoRoot, mirrorPath))
  ]);
  if (!canonical.equals(mirror)) {
    throw new Error(
      `Generated security mirror differs: ${mirrorPath} != ${canonicalPath}`
    );
  }
  return {
    canonical: canonicalPath,
    mirror: mirrorPath,
    sha256: digest(canonical)
  };
}

export async function verifySecurityMirrorReceipts() {
  const receipts = [];
  const canonicalMigrationRoot = "apps/api/migrations";
  const migrationNames = (
    await readdir(path.join(repoRoot, canonicalMigrationRoot))
  )
    .filter((name) => migrationFilePattern.test(name))
    .sort();
  if (migrationNames.length === 0) {
    throw new Error(
      `No canonical Forge migrations were found in ${canonicalMigrationRoot}.`
    );
  }
  for (const mirrorRoot of migrationMirrors) {
    const mirrorMigrationNames = (
      await readdir(path.join(repoRoot, mirrorRoot))
    )
      .filter((name) => migrationFilePattern.test(name))
      .sort();
    if (
      JSON.stringify(mirrorMigrationNames) !== JSON.stringify(migrationNames)
    ) {
      throw new Error(
        `Generated migration inventory differs: ${mirrorRoot} != ${canonicalMigrationRoot}`
      );
    }
    for (const migrationName of migrationNames) {
      receipts.push(
        await assertExactFile(
          path.join(canonicalMigrationRoot, migrationName),
          path.join(mirrorRoot, migrationName)
        )
      );
    }
  }
  for (const group of exactFileMirrors) {
    for (const mirrorRoot of group.mirrorRoots) {
      for (const fileName of group.files) {
        receipts.push(
          await assertExactFile(
            path.join(group.canonicalRoot, fileName),
            path.join(mirrorRoot, fileName)
          )
        );
      }
    }
  }
  const compiledDatabaseFiles = await Promise.all(
    compiledDatabaseMirrors.map((filePath) =>
      readFile(path.join(repoRoot, filePath))
    )
  );
  for (const [index, compiledDatabase] of compiledDatabaseFiles.entries()) {
    for (const marker of compiledDatabaseCompatibilityMarkers) {
      if (!compiledDatabase.includes(Buffer.from(marker))) {
        throw new Error(
          `Generated database runtime omits migration 120 compatibility marker ${JSON.stringify(marker)}: ${compiledDatabaseMirrors[index]}`
        );
      }
    }
  }
  for (const mirrorPath of compiledDatabaseMirrors.slice(1)) {
    receipts.push(
      await assertExactFile(compiledDatabaseMirrors[0], mirrorPath)
    );
  }
  const compiledDataManagementFiles = await Promise.all(
    compiledDataManagementMirrors.map((filePath) =>
      readFile(path.join(repoRoot, filePath))
    )
  );
  for (const [
    index,
    compiledDataManagement
  ] of compiledDataManagementFiles.entries()) {
    for (const marker of compiledDataManagementSecurityMarkers) {
      if (!compiledDataManagement.includes(Buffer.from(marker))) {
        throw new Error(
          `Generated data-management runtime omits streaming archive security marker ${JSON.stringify(marker)}: ${compiledDataManagementMirrors[index]}`
        );
      }
    }
  }
  for (const mirrorPath of compiledDataManagementMirrors.slice(1)) {
    receipts.push(
      await assertExactFile(compiledDataManagementMirrors[0], mirrorPath)
    );
  }
  return receipts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  verifySecurityMirrorReceipts()
    .then((receipts) => {
      process.stdout.write(
        `${JSON.stringify({
          verified: true,
          receiptCount: receipts.length,
          receipts
        })}\n`
      );
    })
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exitCode = 1;
    });
}
