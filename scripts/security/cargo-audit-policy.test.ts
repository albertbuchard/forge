import assert from "node:assert/strict";
import test from "node:test";

import { evaluateCargoAuditReport } from "./cargo-audit-policy.js";

const lockfile = "apps/desktop-tauri/Cargo.lock";
const activeDate = new Date("2026-08-09T00:00:00.000Z");

function finding(advisoryId: string, name: string, version: string) {
  return {
    advisory: { id: advisoryId },
    package: { name, version }
  };
}

test("accepts the exact active desktop RSA exception", () => {
  const rsaFinding = finding("RUSTSEC-2023-0071", "rsa", "0.9.10");
  const result = evaluateCargoAuditReport(
    { vulnerabilities: { list: [rsaFinding] } },
    lockfile,
    activeDate
  );

  assert.deepEqual(result.accepted, [rsaFinding]);
  assert.deepEqual(result.rejected, []);
});

test("rejects a different advisory, package, version, or lockfile", () => {
  const variants = [
    finding("RUSTSEC-2099-0001", "rsa", "0.9.10"),
    finding("RUSTSEC-2023-0071", "different-package", "0.9.10"),
    finding("RUSTSEC-2023-0071", "rsa", "0.9.11")
  ];
  const result = evaluateCargoAuditReport(
    { vulnerabilities: { list: variants } },
    lockfile,
    activeDate
  );
  const wrongLockfile = evaluateCargoAuditReport(
    {
      vulnerabilities: {
        list: [finding("RUSTSEC-2023-0071", "rsa", "0.9.10")]
      }
    },
    "packages/forge-peer/Cargo.lock",
    activeDate
  );

  assert.deepEqual(result.accepted, []);
  assert.deepEqual(result.rejected, variants);
  assert.equal(wrongLockfile.rejected.length, 1);
});

test("rejects the exception at its exact expiry", () => {
  assert.throws(
    () =>
      evaluateCargoAuditReport(
        { vulnerabilities: { list: [] } },
        lockfile,
        new Date("2026-09-09T00:00:00.000Z")
      ),
    /expired/u
  );
});
