import assert from "node:assert/strict";
import test from "node:test";

import { evaluateNpmAuditReport } from "./npm-audit-policy.js";

const activeDate = new Date("2026-07-27T00:00:00.000Z");

test("accepts a production graph with no vulnerabilities", () => {
  const result = evaluateNpmAuditReport({ vulnerabilities: {} }, activeDate);

  assert.equal(result.rejected.length, 0);
  assert.equal(result.accepted.length, 0);
});

test("rejects every npm advisory when no npm exception is active", () => {
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

test("rejects unresolved audit chains and an expired global exception policy", () => {
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
        new Date("2026-09-09T00:00:00.000Z")
      ),
    /expired/u
  );
});
