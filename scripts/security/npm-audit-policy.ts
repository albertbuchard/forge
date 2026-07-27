#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  assertActiveSupplyChainSecurityExceptions,
  SUPPLY_CHAIN_SECURITY_EXCEPTIONS
} from "../../apps/api/src/security/supply-chain-inventory.js";

type AuditVia =
  | string
  | {
      url?: string;
    };

type AuditVulnerability = {
  severity?: string;
  via?: readonly AuditVia[];
};

type AuditReport = {
  vulnerabilities?: Record<string, AuditVulnerability>;
};

function advisoryIdFromUrl(value: string | undefined) {
  return value?.match(/\bGHSA-[a-z0-9-]+\b/iu)?.[0].toUpperCase() ?? null;
}

export function evaluateNpmAuditReport(
  report: AuditReport,
  now: Date = new Date()
) {
  assertActiveSupplyChainSecurityExceptions(now);
  const vulnerabilities = report.vulnerabilities ?? {};
  const advisoryIdsByPackage = new Map<string, ReadonlySet<string>>();

  function resolveAdvisoryIds(
    packageName: string,
    visited: ReadonlySet<string> = new Set()
  ): ReadonlySet<string> {
    const cached = advisoryIdsByPackage.get(packageName);
    if (cached) return cached;
    if (visited.has(packageName)) return new Set();
    const nextVisited = new Set(visited);
    nextVisited.add(packageName);
    const advisoryIds = new Set<string>();
    for (const via of vulnerabilities[packageName]?.via ?? []) {
      if (typeof via === "string") {
        for (const advisoryId of resolveAdvisoryIds(via, nextVisited)) {
          advisoryIds.add(advisoryId);
        }
        continue;
      }
      const advisoryId = advisoryIdFromUrl(via.url);
      if (advisoryId) advisoryIds.add(advisoryId);
    }
    advisoryIdsByPackage.set(packageName, advisoryIds);
    return advisoryIds;
  }

  const accepted: Array<{
    packageName: string;
    advisoryIds: readonly string[];
  }> = [];
  const rejected: Array<{
    packageName: string;
    severity: string;
    advisoryIds: readonly string[];
  }> = [];

  for (const [packageName, vulnerability] of Object.entries(vulnerabilities)) {
    const advisoryIds = [...resolveAdvisoryIds(packageName)].sort();
    const covered =
      advisoryIds.length > 0 &&
      advisoryIds.every((advisoryId) =>
        SUPPLY_CHAIN_SECURITY_EXCEPTIONS.some(
          (exception) =>
            exception.advisoryId.toUpperCase() === advisoryId &&
            exception.packages.includes(packageName)
        )
      );
    if (covered) {
      accepted.push({ packageName, advisoryIds });
    } else {
      rejected.push({
        packageName,
        severity: vulnerability.severity ?? "unknown",
        advisoryIds
      });
    }
  }

  return { accepted, rejected };
}

function parseAuditArguments(argv: readonly string[]) {
  const args: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--prefix") {
      const prefix = argv[index + 1];
      if (!prefix || prefix.startsWith("-")) {
        throw new Error("--prefix requires a repository-relative path.");
      }
      args.push("--prefix", prefix);
      index += 1;
      continue;
    }
    if (argument === "--omit=dev" || argument === "--omit=peer") {
      args.push(argument);
      continue;
    }
    throw new Error(`Unsupported npm audit policy option: ${argument}`);
  }
  return args;
}

export function runNpmAuditPolicy(argv: readonly string[]) {
  const npmArguments = parseAuditArguments(argv);
  const result = spawnSync("npm", [...npmArguments, "audit", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error) throw result.error;
  let report: AuditReport;
  try {
    report = JSON.parse(result.stdout) as AuditReport;
  } catch {
    throw new Error(
      `npm audit did not return valid JSON (exit ${result.status ?? "unknown"}).`
    );
  }
  const evaluation = evaluateNpmAuditReport(report);
  if (evaluation.rejected.length > 0) {
    const details = evaluation.rejected
      .map(
        (entry) =>
          `${entry.packageName} (${entry.severity}; ${entry.advisoryIds.join(", ") || "unresolved advisory"})`
      )
      .join("; ");
    throw new Error(`npm audit found unapproved vulnerabilities: ${details}`);
  }
  if ((result.status ?? 1) > 1) {
    throw new Error(`npm audit failed with exit ${result.status}.`);
  }
  if (evaluation.accepted.length === 0 && result.status !== 0) {
    throw new Error(
      `npm audit failed with exit ${result.status} without a reviewable vulnerability report.`
    );
  }
  return evaluation;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const evaluation = runNpmAuditPolicy(process.argv.slice(2));
    if (evaluation.accepted.length === 0) {
      process.stdout.write("npm audit passed with no vulnerabilities.\n");
    } else {
      const advisories = [
        ...new Set(evaluation.accepted.flatMap((entry) => entry.advisoryIds))
      ].sort();
      process.stdout.write(
        `npm audit passed with active, bounded exceptions: ${advisories.join(", ")}.\n`
      );
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
