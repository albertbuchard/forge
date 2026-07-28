#!/usr/bin/env node

import fs from "node:fs";
import { pathToFileURL } from "node:url";

const numericIdentifier = "(?:0|[1-9]\\d*)";
const nonNumericIdentifier =
  "(?:[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)";
const prereleaseIdentifier = `(?:${numericIdentifier}|${nonNumericIdentifier})`;
const exactVersionPattern = new RegExp(
  `^(${numericIdentifier})\\.(${numericIdentifier})\\.(${numericIdentifier})` +
    `(?:-(${prereleaseIdentifier}(?:\\.${prereleaseIdentifier})*))?` +
    "(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$"
);

function parseExactVersion(value, label) {
  const match = exactVersionPattern.exec(value);
  if (!match) {
    throw new Error(`${label} must be one exact valid version.`);
  }
  return {
    core: match.slice(1, 4),
    prerelease: match[4]?.split(".") ?? []
  };
}

function compareNumericIdentifiers(left, right) {
  if (left.length !== right.length) {
    return left.length - right.length;
  }
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareExactVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) {
      return compareNumericIdentifiers(left.core[index], right.core[index]);
    }
  }

  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length
      ? 0
      : left.prerelease.length === 0
        ? 1
        : -1;
  }

  const identifierCount = Math.max(
    left.prerelease.length,
    right.prerelease.length
  );
  for (let index = 0; index < identifierCount; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === rightIdentifier
        ? 0
        : leftIdentifier === undefined
          ? -1
          : 1;
    }
    if (leftIdentifier === rightIdentifier) {
      continue;
    }
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return compareNumericIdentifiers(leftIdentifier, rightIdentifier);
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }

  return 0;
}

export function verifyOpenClawHostFloor({
  forgePackage,
  pluginPackage,
  safeHostRange
}) {
  const productionHost = forgePackage.dependencies?.openclaw;
  const developmentHost = forgePackage.devDependencies?.openclaw;
  const pluginPeer = pluginPackage.peerDependencies?.openclaw;
  const pluginMinimum = pluginPackage.openclaw?.install?.minHostVersion;

  if (productionHost !== undefined) {
    throw new Error(
      `Forge must not bundle the OpenClaw host as a production dependency; found ${productionHost}.`
    );
  }
  if (typeof developmentHost !== "string") {
    throw new Error(
      "Forge must pin an OpenClaw development host for compatibility testing."
    );
  }
  if (pluginPeer !== safeHostRange || pluginMinimum !== safeHostRange) {
    throw new Error(
      `OpenClaw published host ranges must both equal ${safeHostRange}; found peer=${pluginPeer ?? "missing"} and minHostVersion=${pluginMinimum ?? "missing"}.`
    );
  }

  const rangeMatch = /^>=(.+)$/.exec(safeHostRange);
  if (!rangeMatch) {
    throw new Error("OpenClaw minimum host must use one inclusive >= range.");
  }
  const testedVersion = parseExactVersion(
    developmentHost,
    "OpenClaw development host"
  );
  const minimumVersion = parseExactVersion(
    rangeMatch[1],
    "OpenClaw minimum host"
  );
  if (compareExactVersions(testedVersion, minimumVersion) < 0) {
    throw new Error(
      `OpenClaw development host ${developmentHost} is older than the published minimum ${safeHostRange}.`
    );
  }

  return {
    developmentHost,
    pluginMinimum,
    pluginPeer
  };
}

export function verifyOpenClawHostFloorFiles(
  forgePackagePath,
  pluginPackagePath,
  safeHostRange
) {
  const forgePackage = JSON.parse(fs.readFileSync(forgePackagePath, "utf8"));
  const pluginPackage = JSON.parse(fs.readFileSync(pluginPackagePath, "utf8"));
  return verifyOpenClawHostFloor({
    forgePackage,
    pluginPackage,
    safeHostRange
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [forgePackagePath, pluginPackagePath, safeHostRange] =
    process.argv.slice(2);
  if (!forgePackagePath || !pluginPackagePath || !safeHostRange) {
    console.error(
      "Usage: check-openclaw-host-floor.mjs <forge-package.json> <plugin-package.json> <minimum-range>"
    );
    process.exit(2);
  }

  try {
    const result = verifyOpenClawHostFloorFiles(
      forgePackagePath,
      pluginPackagePath,
      safeHostRange
    );
    console.log(`OpenClaw host compatibility passed: ${JSON.stringify(result)}`);
  } catch (error) {
    console.error(`OpenClaw host compatibility failed: ${error.message}`);
    process.exit(1);
  }
}
