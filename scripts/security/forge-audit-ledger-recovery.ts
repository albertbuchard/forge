import { lstatSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { SecretsManager } from "../../apps/api/src/managers/platform/secrets-manager.js";
import { TamperEvidentGatewayAuditLedger } from "../../apps/api/src/security/security-audit-ledger.js";

type RecoveryCommand = "inspect" | "recover";

function usage() {
  return [
    "Usage:",
    "  forge-audit-ledger-recovery inspect --data-root /absolute/path",
    "  forge-audit-ledger-recovery recover --data-root /absolute/path --apply"
  ].join("\n");
}

function parseArguments(argv: readonly string[]) {
  const [commandValue, ...rest] = argv;
  if (commandValue !== "inspect" && commandValue !== "recover") {
    throw new Error(usage());
  }
  const command: RecoveryCommand = commandValue;
  let dataRoot: string | null = null;
  let apply = false;
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--data-root") {
      dataRoot = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}\n${usage()}`);
  }
  if (!dataRoot || !path.isAbsolute(dataRoot)) {
    throw new Error(`--data-root must be an absolute path.\n${usage()}`);
  }
  if ((command === "recover") !== apply) {
    throw new Error(
      command === "recover"
        ? `recover requires --apply.\n${usage()}`
        : `inspect does not accept --apply.\n${usage()}`
    );
  }
  return { command, dataRoot: path.resolve(dataRoot) };
}

function assertPrivateOwnedPath(
  targetPath: string,
  label: string,
  expected: "directory" | "file"
) {
  const metadata = lstatSync(targetPath);
  const expectedType =
    expected === "directory" ? metadata.isDirectory() : metadata.isFile();
  if (metadata.isSymbolicLink() || !expectedType) {
    throw new Error(`${label} must be a real ${expected}, not a link.`);
  }
  if (
    process.platform === "win32" ||
    !process.getuid ||
    metadata.uid !== process.getuid() ||
    (metadata.mode & 0o077) !== 0
  ) {
    throw new Error(
      `${label} must be owned by the current user and inaccessible to other users.`
    );
  }
}

function assertNoOutstandingSqliteJournal(databasePath: string) {
  for (const suffix of ["-wal", "-journal"]) {
    const journalPath = `${databasePath}${suffix}`;
    try {
      const metadata = lstatSync(journalPath);
      if (
        metadata.isSymbolicLink() ||
        !metadata.isFile() ||
        metadata.size > 0
      ) {
        throw new Error(
          "Forge audit recovery requires a quiescent, fully checkpointed SQLite database with no outstanding write-ahead log or rollback journal."
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
  }
}

export function runSecurityAuditLedgerRecovery(argv: readonly string[]) {
  const { command, dataRoot } = parseArguments(argv);
  assertPrivateOwnedPath(dataRoot, "The Forge data root", "directory");
  const databasePath = path.join(dataRoot, "forge.sqlite");
  assertPrivateOwnedPath(databasePath, "The Forge database", "file");
  assertNoOutstandingSqliteJournal(databasePath);

  const secrets = new SecretsManager();
  secrets.configure(dataRoot);
  const key = secrets.deriveExistingCanonicalKey("security-audit-ledger/v1");
  const immutableDatabaseUrl = `${pathToFileURL(databasePath).href}?immutable=1`;
  const database = new DatabaseSync(immutableDatabaseUrl, { readOnly: true });
  try {
    const ledger = new TamperEvidentGatewayAuditLedger(
      database,
      key,
      dataRoot,
      {
        forkRecoveryMode: command === "inspect" ? "inspect" : "apply"
      }
    );
    const inspection = ledger.getForkInspection();
    if (!inspection) {
      throw new Error("Forge could not inspect the security audit ledger.");
    }
    return {
      command,
      entries: inspection.entries,
      lastSequence: inspection.lastSequence,
      forkSequences: inspection.forkSequences,
      recoveryRequired: inspection.recoveryRequired,
      recoveryReceiptExists: inspection.recoveryReceiptExists
    };
  } finally {
    database.close();
  }
}

const executablePath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (
  executablePath === import.meta.url &&
  path.basename(process.argv[1] ?? "").startsWith("forge-audit-ledger-recovery")
) {
  try {
    process.stdout.write(
      `${JSON.stringify(runSecurityAuditLedgerRecovery(process.argv.slice(2)))}\n`
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
