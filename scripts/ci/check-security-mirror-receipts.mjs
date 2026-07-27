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
    .filter((name) => /^(?:10[7-9]|11[0-9])_.*\.sql$/u.test(name))
    .sort();
  if (migrationNames.length !== 13) {
    throw new Error(
      `Expected migrations 107 through 119; found ${migrationNames.join(", ")}`
    );
  }
  for (const mirrorRoot of migrationMirrors) {
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
