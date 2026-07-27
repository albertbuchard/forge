import assert from "node:assert/strict";
import test from "node:test";

import { evaluateNpmAuditReport } from "./npm-audit-policy.js";

const activeDate = new Date("2026-07-27T00:00:00.000Z");

test("accepts only the documented React Router advisory and its dependency chain", () => {
  const result = evaluateNpmAuditReport(
    {
      vulnerabilities: {
        "react-router": {
          severity: "high",
          via: [
            {
              url: "https://github.com/advisories/GHSA-qwww-vcr4-c8h2"
            }
          ]
        },
        "react-router-dom": {
          severity: "high",
          via: ["react-router"]
        }
      }
    },
    activeDate
  );

  assert.equal(result.rejected.length, 0);
  assert.deepEqual(result.accepted.map((entry) => entry.packageName).sort(), [
    "react-router",
    "react-router-dom"
  ]);
});

test("rejects an unapproved advisory even when another exception is valid", () => {
  const result = evaluateNpmAuditReport(
    {
      vulnerabilities: {
        "react-router": {
          severity: "high",
          via: [
            {
              url: "https://github.com/advisories/GHSA-qwww-vcr4-c8h2"
            },
            {
              url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc"
            }
          ]
        }
      }
    },
    activeDate
  );

  assert.equal(result.accepted.length, 0);
  assert.deepEqual(result.rejected[0]?.advisoryIds, [
    "GHSA-AAAA-BBBB-CCCC",
    "GHSA-QWWW-VCR4-C8H2"
  ]);
});

test("rejects unresolved audit chains and expired exception policy", () => {
  const unresolved = evaluateNpmAuditReport(
    {
      vulnerabilities: {
        mystery: { severity: "moderate", via: ["missing-parent"] }
      }
    },
    activeDate
  );
  assert.equal(unresolved.rejected.length, 1);
  assert.throws(
    () =>
      evaluateNpmAuditReport(
        { vulnerabilities: {} },
        new Date("2026-08-09T00:00:00.000Z")
      ),
    /expired/u
  );
});
