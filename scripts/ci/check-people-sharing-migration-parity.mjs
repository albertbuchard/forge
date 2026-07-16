#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "../..");

export const peopleMigrationNames = Object.freeze([
  "087_people_and_peer_sharing.sql",
  "088_people_peer_identity_hardening.sql",
  "094_people_peer_authorization_and_companion_v2.sql",
  "099_people_owner_partition_identity.sql",
  "100_people_read_model_revision.sql",
  "102_people_outbox_claim_order_indexes.sql"
]);

export const peopleMigrationDestinations = Object.freeze([
  "plugins/openclaw/server/migrations",
  "plugins/openclaw/dist/server/apps/api/migrations",
  "plugins/codex/runtime/server/migrations",
  "plugins/codex/runtime/dist/server/apps/api/migrations",
  "plugins/hermes/forge_hermes/runtime/apps/api/migrations",
  "plugins/hermes/forge_hermes/runtime/dist/server/apps/api/migrations"
]);

const archiveSurfaceContracts = Object.freeze({
  openclaw: Object.freeze({
    filePattern: /^forge-openclaw-plugin-.*\.tgz$/,
    kind: "tgz",
    migrationRoots: Object.freeze([
      "package/server/migrations",
      "package/dist/server/apps/api/migrations"
    ])
  }),
  codex: Object.freeze({
    filePattern: /^forge-codex-runtime-.*\.tgz$/,
    kind: "tgz",
    migrationRoots: Object.freeze([
      "package/server/migrations",
      "package/dist/server/apps/api/migrations"
    ])
  }),
  hermes: Object.freeze({
    filePattern: /^forge[_-]hermes[_-]plugin-.*\.whl$/,
    kind: "wheel",
    migrationRoots: Object.freeze([
      "forge_hermes/runtime/apps/api/migrations",
      "forge_hermes/runtime/dist/server/apps/api/migrations"
    ])
  })
});

function fail(message) {
  throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readRequiredFile(root, relativePath, failures) {
  const absolutePath = path.join(root, relativePath);
  try {
    const metadata = lstatSync(absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      failures.push(`${relativePath}: expected a regular file`);
      return null;
    }
    return readFileSync(absolutePath);
  } catch (error) {
    failures.push(`${relativePath}: ${error.message}`);
    return null;
  }
}

function formatFailures(label, failures) {
  return `${label} failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`;
}

export function verifyPeopleMigrationParity({
  repoRoot = defaultRepoRoot,
  migrationNames = peopleMigrationNames,
  destinations = peopleMigrationDestinations
} = {}) {
  const failures = [];
  let checkedCopies = 0;

  for (const migrationName of migrationNames) {
    const canonicalPath = `apps/api/migrations/${migrationName}`;
    const canonical = readRequiredFile(repoRoot, canonicalPath, failures);
    if (!canonical) continue;
    for (const destination of destinations) {
      const packagedPath = `${destination}/${migrationName}`;
      const packaged = readRequiredFile(repoRoot, packagedPath, failures);
      if (!packaged) continue;
      checkedCopies += 1;
      if (!packaged.equals(canonical)) {
        failures.push(
          `${packagedPath}: bytes differ from ${canonicalPath} (${sha256(packaged)} != ${sha256(canonical)})`
        );
      }
    }
  }

  if (failures.length > 0) {
    fail(formatFailures("People migration parity", failures));
  }
  return Object.freeze({
    checkedCopies,
    destinationCount: destinations.length,
    migrationCount: migrationNames.length
  });
}

function tarString(block, start, length) {
  const end = block.indexOf(0, start);
  return block
    .subarray(start, end === -1 || end > start + length ? start + length : end)
    .toString("utf8")
    .trim();
}

function tarSize(block) {
  const value = tarString(block, 124, 12).replaceAll(/\0/g, "").trim();
  if (!/^[0-7]+$/.test(value)) fail(`Invalid tar entry size: ${value}`);
  return Number.parseInt(value, 8);
}

function paxPath(payload) {
  const source = payload.toString("utf8");
  for (const line of source.split("\n")) {
    const separator = line.indexOf(" ");
    if (separator < 0) continue;
    const record = line.slice(separator + 1);
    if (record.startsWith("path=")) return record.slice("path=".length);
  }
  return null;
}

export function readNpmTarballEntries(archivePath, expectedPaths = null) {
  const archive = gunzipSync(readFileSync(archivePath));
  const entries = new Map();
  const expected = expectedPaths ? new Set(expectedPaths) : null;
  let offset = 0;
  let pendingPath = null;

  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const headerPath = prefix ? `${prefix}/${name}` : name;
    const size = tarSize(header);
    const type = String.fromCharCode(header[156] || 48);
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    if (contentEnd > archive.length) fail(`Truncated tar entry: ${headerPath}`);
    const payload = archive.subarray(contentStart, contentEnd);

    if (type === "L") {
      pendingPath = payload.toString("utf8").replace(/\0+$/, "");
    } else if (type === "x") {
      pendingPath = paxPath(payload) ?? pendingPath;
    } else if (type === "0" || type === "\0") {
      const entryPath = pendingPath ?? headerPath;
      if (!expected || expected.has(entryPath)) {
        entries.set(entryPath, Buffer.from(payload));
      }
      pendingPath = null;
    } else {
      pendingPath = null;
    }
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function readWheelEntryDigests(archivePath, expectedPaths) {
  const script = String.raw`
import hashlib
import json
import sys
import zipfile

expected = set(json.loads(sys.argv[2]))
with zipfile.ZipFile(sys.argv[1], "r") as archive:
    result = {
        info.filename: hashlib.sha256(archive.read(info.filename)).hexdigest()
        for info in archive.infolist()
        if not info.is_dir() and info.filename in expected
    }
print(json.dumps(result, sort_keys=True))
`;
  const result = spawnSync(
    "python3",
    ["-c", script, archivePath, JSON.stringify(expectedPaths)],
    {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(
      `Could not inspect Hermes wheel ${archivePath}: ${result.stderr.trim()}`
    );
  }
  return new Map(Object.entries(JSON.parse(result.stdout)));
}

function archiveEntryDigests(archivePath, kind, expectedPaths) {
  if (kind === "tgz") {
    return new Map(
      [...readNpmTarballEntries(archivePath, expectedPaths)].map(
        ([entryPath, content]) => [entryPath, sha256(content)]
      )
    );
  }
  if (kind === "wheel") {
    return readWheelEntryDigests(archivePath, expectedPaths);
  }
  fail(`Unsupported People archive kind: ${kind}`);
}

function discoverPeopleArchives(artifactRoot, failures) {
  if (!existsSync(artifactRoot)) {
    failures.push(`Archive root does not exist: ${artifactRoot}`);
    return new Map();
  }
  const metadata = lstatSync(artifactRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    failures.push(`Archive root must be a real directory: ${artifactRoot}`);
    return new Map();
  }

  const discovered = new Map();
  for (const fileName of readdirSync(artifactRoot).sort()) {
    for (const [surface, contract] of Object.entries(archiveSurfaceContracts)) {
      if (!contract.filePattern.test(fileName)) continue;
      if (discovered.has(surface)) {
        failures.push(
          `Archive root contains multiple ${surface} packages: ${path.basename(discovered.get(surface))}, ${fileName}`
        );
      } else {
        discovered.set(surface, path.join(artifactRoot, fileName));
      }
    }
  }
  return discovered;
}

export function verifyPeopleMigrationArchives({
  artifactRoot,
  repoRoot = defaultRepoRoot,
  requiredSurfaces = []
}) {
  const failures = [];
  const unknownRequired = requiredSurfaces.filter(
    (surface) => !(surface in archiveSurfaceContracts)
  );
  if (unknownRequired.length > 0) {
    fail(`Unknown People archive surfaces: ${unknownRequired.join(", ")}`);
  }
  const discovered = discoverPeopleArchives(artifactRoot, failures);
  for (const surface of requiredSurfaces) {
    if (!discovered.has(surface)) {
      failures.push(`Required ${surface} package archive is missing`);
    }
  }

  const canonicalDigests = new Map();
  for (const migrationName of peopleMigrationNames) {
    const relativePath = `apps/api/migrations/${migrationName}`;
    const content = readRequiredFile(repoRoot, relativePath, failures);
    if (content) canonicalDigests.set(migrationName, sha256(content));
  }

  let checkedEntries = 0;
  for (const [surface, archivePath] of discovered) {
    const contract = archiveSurfaceContracts[surface];
    const expectedPaths = contract.migrationRoots.flatMap((migrationRoot) =>
      peopleMigrationNames.map(
        (migrationName) => `${migrationRoot}/${migrationName}`
      )
    );
    let entries;
    try {
      entries = archiveEntryDigests(archivePath, contract.kind, expectedPaths);
    } catch (error) {
      failures.push(`${path.basename(archivePath)}: ${error.message}`);
      continue;
    }
    for (const migrationRoot of contract.migrationRoots) {
      for (const migrationName of peopleMigrationNames) {
        const entryPath = `${migrationRoot}/${migrationName}`;
        const digest = entries.get(entryPath);
        if (!digest) {
          failures.push(`${path.basename(archivePath)}: missing ${entryPath}`);
          continue;
        }
        checkedEntries += 1;
        if (digest !== canonicalDigests.get(migrationName)) {
          failures.push(
            `${path.basename(archivePath)}: ${entryPath} differs from canonical migration bytes`
          );
        }
      }
    }
  }

  if (failures.length > 0) {
    fail(formatFailures("People migration archive parity", failures));
  }
  return Object.freeze({
    archiveCount: discovered.size,
    checkedEntries,
    surfaces: Object.freeze([...discovered.keys()].sort())
  });
}

function parseArguments(argv) {
  const options = { requiredSurfaces: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--archive-root") {
      const value = argv[++index];
      if (!value) fail("--archive-root requires a path.");
      options.artifactRoot = path.resolve(value);
    } else if (argument.startsWith("--archive-root=")) {
      options.artifactRoot = path.resolve(
        argument.slice("--archive-root=".length)
      );
    } else if (argument === "--require-archives") {
      const value = argv[++index];
      if (!value) fail("--require-archives requires a comma-separated value.");
      options.requiredSurfaces = value.split(",").filter(Boolean);
    } else if (argument.startsWith("--require-archives=")) {
      options.requiredSurfaces = argument
        .slice("--require-archives=".length)
        .split(",")
        .filter(Boolean);
    } else {
      fail(`Unknown argument: ${argument}`);
    }
  }
  if (options.requiredSurfaces.length > 0 && !options.artifactRoot) {
    fail("--require-archives also requires --archive-root.");
  }
  return options;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const repository = verifyPeopleMigrationParity();
  let archives = { archiveCount: 0, checkedEntries: 0, surfaces: [] };
  if (options.artifactRoot) {
    archives = verifyPeopleMigrationArchives({
      artifactRoot: options.artifactRoot,
      requiredSurfaces: options.requiredSurfaces
    });
  }
  process.stdout.write(
    `People migration parity passed: ${repository.checkedCopies} runtime copies and ${archives.checkedEntries} archive entries across ${archives.archiveCount} archives.\n`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `ERROR: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
