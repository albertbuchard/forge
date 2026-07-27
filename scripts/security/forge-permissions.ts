#!/usr/bin/env node

import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  inspectPermissionTree,
  PermissionMaintenance
} from "../../apps/api/src/security/filesystem-permission-doctor.js";

const SENSITIVE_RUNTIME_PATHS = [
  ".",
  "forge.sqlite",
  "forge.sqlite-wal",
  "forge.sqlite-shm",
  "forge.json",
  ".forge-secrets.key",
  ".forge-security-signing-key.json",
  "backups",
  "wiki-ingest",
  "security-audit-anchor.json",
  "security-audit-retention.json"
] as const;

type PermissionCommand = "inspect" | "repair" | "rollback";

function usage() {
  return [
    "Usage:",
    "  node --import tsx scripts/security/forge-permissions.ts inspect --data-root /absolute/path",
    "  node --import tsx scripts/security/forge-permissions.ts repair --data-root /absolute/path --apply",
    "  node --import tsx scripts/security/forge-permissions.ts rollback --data-root /absolute/path --apply",
    "",
    "Inspection is read-only. Repair and rollback require the explicit --apply flag."
  ].join("\n");
}

function parseArguments(argv: readonly string[]) {
  const command = argv[0] as PermissionCommand | undefined;
  const rootIndex = argv.indexOf("--data-root");
  const dataRoot = rootIndex >= 0 ? argv[rootIndex + 1] : undefined;
  if (
    !command ||
    !["inspect", "repair", "rollback"].includes(command) ||
    !dataRoot ||
    !path.isAbsolute(dataRoot)
  ) {
    throw new Error(usage());
  }
  if (command !== "inspect" && !argv.includes("--apply")) {
    throw new Error(
      `${command} changes filesystem modes and requires --apply.\n\n${usage()}`
    );
  }
  return { command, dataRoot: path.resolve(dataRoot) };
}

function existingSensitivePaths(dataRoot: string) {
  return SENSITIVE_RUNTIME_PATHS.filter((relativePath) =>
    existsSync(path.resolve(dataRoot, relativePath))
  );
}

export async function runPermissionCommand(argv: readonly string[]) {
  const { command, dataRoot } = parseArguments(argv);
  const sensitivePaths = existingSensitivePaths(dataRoot);
  if (!sensitivePaths.includes(".")) {
    throw new Error("The selected Forge data root does not exist.");
  }
  const maintenanceDirectory = path.join(dataRoot, ".forge-maintenance");
  const maintenance = new PermissionMaintenance({
    root: dataRoot,
    sensitivePaths,
    journalPath: path.join(maintenanceDirectory, "permission-journal.json"),
    receiptPath: path.join(maintenanceDirectory, "permission-receipt.json")
  });
  if (command === "inspect") {
    return inspectPermissionTree({ root: dataRoot, sensitivePaths });
  }
  if (command === "repair") {
    return maintenance.repair();
  }
  return maintenance.rollback();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runPermissionCommand(process.argv.slice(2))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exitCode = 1;
    });
}
