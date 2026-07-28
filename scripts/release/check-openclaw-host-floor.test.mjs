import assert from "node:assert/strict";
import test from "node:test";

import { verifyOpenClawHostFloor } from "./check-openclaw-host-floor.mjs";

const safeHostRange = ">=2026.6.9";

function fixture() {
  return {
    forgePackage: {
      dependencies: {},
      devDependencies: {
        openclaw: "2026.7.1-2"
      }
    },
    pluginPackage: {
      openclaw: {
        install: {
          minHostVersion: safeHostRange
        }
      },
      peerDependencies: {
        openclaw: safeHostRange
      }
    },
    safeHostRange
  };
}

test("accepts an unbundled tested host at or above the published floor", () => {
  assert.deepEqual(verifyOpenClawHostFloor(fixture()), {
    developmentHost: "2026.7.1-2",
    pluginMinimum: safeHostRange,
    pluginPeer: safeHostRange
  });
});

test("rejects bundling the OpenClaw host in Forge production dependencies", () => {
  const input = fixture();
  input.forgePackage.dependencies.openclaw = "2026.7.1-2";
  assert.throws(
    () => verifyOpenClawHostFloor(input),
    /must not bundle the OpenClaw host/
  );
});

test("rejects a missing or older development compatibility host", () => {
  const missing = fixture();
  delete missing.forgePackage.devDependencies.openclaw;
  assert.throws(
    () => verifyOpenClawHostFloor(missing),
    /must pin an OpenClaw development host/
  );

  const older = fixture();
  older.forgePackage.devDependencies.openclaw = "2026.6.8";
  assert.throws(
    () => verifyOpenClawHostFloor(older),
    /is older than the published minimum/
  );
});

test("requires an exact tested host and applies prerelease precedence", () => {
  for (const invalidVersion of [
    ">=2026.7.1",
    "^2026.7.1",
    "2026.6.9 malicious",
    "2026.07.1",
    "2026.6.9-01"
  ]) {
    const input = fixture();
    input.forgePackage.devDependencies.openclaw = invalidVersion;
    assert.throws(
      () => verifyOpenClawHostFloor(input),
      /must be one exact valid version/
    );
  }

  const prerelease = fixture();
  prerelease.forgePackage.devDependencies.openclaw = "2026.6.9-rc.1";
  assert.throws(
    () => verifyOpenClawHostFloor(prerelease),
    /is older than the published minimum/
  );

  const newerPrerelease = fixture();
  newerPrerelease.forgePackage.devDependencies.openclaw = "2026.7.1-2";
  assert.equal(
    verifyOpenClawHostFloor(newerPrerelease).developmentHost,
    "2026.7.1-2"
  );

  const asciiLower = fixture();
  asciiLower.safeHostRange = ">=2026.6.9-a";
  asciiLower.pluginPackage.peerDependencies.openclaw =
    asciiLower.safeHostRange;
  asciiLower.pluginPackage.openclaw.install.minHostVersion =
    asciiLower.safeHostRange;
  asciiLower.forgePackage.devDependencies.openclaw = "2026.6.9-Z";
  assert.throws(
    () => verifyOpenClawHostFloor(asciiLower),
    /is older than the published minimum/
  );
});

test("rejects disagreement between published peer and installer ranges", () => {
  const peerMismatch = fixture();
  peerMismatch.pluginPackage.peerDependencies.openclaw = ">=2026.7.0";
  assert.throws(
    () => verifyOpenClawHostFloor(peerMismatch),
    /published host ranges must both equal/
  );

  const installerMismatch = fixture();
  installerMismatch.pluginPackage.openclaw.install.minHostVersion =
    ">=2026.7.0";
  assert.throws(
    () => verifyOpenClawHostFloor(installerMismatch),
    /published host ranges must both equal/
  );
});
