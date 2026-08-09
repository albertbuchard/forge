#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  assertActiveSupplyChainSecurityExceptions,
  SUPPLY_CHAIN_SECURITY_EXCEPTIONS
} from "../../apps/api/src/security/supply-chain-inventory.js";

type CargoAuditFinding = {
  advisory?: { id?: string };
  package?: { name?: string; version?: string };
};

type CargoAuditReport = {
  vulnerabilities?: {
    list?: readonly CargoAuditFinding[];
  };
};

function normalizeLockfile(value: string) {
  if (!value || value.startsWith("-")) {
    throw new Error("--file requires a repository-relative Cargo.lock path.");
  }
  const repositoryRoot = path.resolve(process.cwd());
  const absolutePath = path.resolve(repositoryRoot, value);
  if (
    absolutePath !== repositoryRoot &&
    !absolutePath.startsWith(`${repositoryRoot}${path.sep}`)
  ) {
    throw new Error("Cargo audit lockfile must stay inside the repository.");
  }
  return path.relative(repositoryRoot, absolutePath).split(path.sep).join("/");
}

function parseCargoAuditArguments(argv: readonly string[]) {
  if (argv.length !== 2 || argv[0] !== "--file") {
    throw new Error(
      "Usage: cargo-audit-policy.ts --file <repository-relative Cargo.lock>"
    );
  }
  return normalizeLockfile(argv[1] ?? "");
}

export function evaluateCargoAuditReport(
  report: CargoAuditReport,
  lockfile: string,
  now: Date = new Date()
) {
  assertActiveSupplyChainSecurityExceptions(now);
  const accepted: CargoAuditFinding[] = [];
  const rejected: CargoAuditFinding[] = [];

  for (const finding of report.vulnerabilities?.list ?? []) {
    const advisoryId = finding.advisory?.id?.toUpperCase();
    const packageName = finding.package?.name;
    const packageVersion = finding.package?.version;
    const covered = SUPPLY_CHAIN_SECURITY_EXCEPTIONS.some(
      (exception) =>
        exception.scope === lockfile &&
        exception.advisoryId.toUpperCase() === advisoryId &&
        packageName !== undefined &&
        exception.packages.includes(packageName) &&
        packageVersion !== undefined &&
        exception.affectedVersions.includes(packageVersion)
    );
    (covered ? accepted : rejected).push(finding);
  }

  return { accepted, rejected };
}

function describeFinding(finding: CargoAuditFinding) {
  return `${finding.advisory?.id ?? "unknown advisory"} for ${finding.package?.name ?? "unknown package"}@${finding.package?.version ?? "unknown version"}`;
}

export function runCargoAuditPolicy(argv: readonly string[]) {
  const lockfile = parseCargoAuditArguments(argv);
  const result = spawnSync(
    "cargo",
    ["audit", "--file", lockfile, "--format", "json"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024
    }
  );
  if (result.error) throw result.error;

  let report: CargoAuditReport;
  try {
    report = JSON.parse(result.stdout) as CargoAuditReport;
  } catch {
    throw new Error(
      `cargo audit did not return valid JSON (exit ${result.status ?? "unknown"}).`
    );
  }

  const evaluation = evaluateCargoAuditReport(report, lockfile);
  if (evaluation.rejected.length > 0) {
    throw new Error(
      `cargo audit found unapproved vulnerabilities: ${evaluation.rejected.map(describeFinding).join("; ")}`
    );
  }
  if ((result.status ?? 2) > 1) {
    throw new Error(`cargo audit failed with exit ${result.status}.`);
  }
  if (evaluation.accepted.length > 0 && result.status !== 1) {
    throw new Error(
      `cargo audit reported approved vulnerabilities but exited with ${result.status ?? "unknown"}.`
    );
  }
  if (evaluation.accepted.length === 0 && result.status !== 0) {
    throw new Error(
      `cargo audit failed with exit ${result.status ?? "unknown"} without a reviewable vulnerability report.`
    );
  }
  return evaluation;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const evaluation = runCargoAuditPolicy(process.argv.slice(2));
    if (evaluation.accepted.length === 0) {
      process.stdout.write("cargo audit passed with no vulnerabilities.\n");
    } else {
      process.stdout.write(
        `cargo audit passed with active, bounded exceptions: ${evaluation.accepted.map(describeFinding).join("; ")}.\n`
      );
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
