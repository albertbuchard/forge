import assert from "node:assert/strict";
import test from "node:test";

import type { ForgePrincipal } from "./contracts.js";
import { DevAssetProxyAssertionService } from "./dev-asset-proxy-assertion.js";

function browserPrincipal(): ForgePrincipal {
  return {
    kind: "operator_session",
    subjectId: "browser-session-1",
    ownerId: "owner-1",
    clientId: null,
    installationId: "installation-1",
    audience: "urn:forge:test:api",
    scopes: ["*"],
    profile: "operator",
    ownerSecurityEpoch: 1,
    clientSecurityEpoch: null,
    authenticatedAt: "2026-07-26T00:00:00.000Z"
  };
}

test("development asset assertions are opaque, target-bound, expiring, and single-use", () => {
  let now = 1_000;
  const assertions = new DevAssetProxyAssertionService(() => now, 500, 2);
  const principal = browserPrincipal();

  const wrongTarget = assertions.issue(principal, "/forge/src/main.tsx");
  assert.equal(assertions.consume(wrongTarget, "/forge/src/other.tsx"), null);
  assert.equal(assertions.consume(wrongTarget, "/forge/src/main.tsx"), null);

  const accepted = assertions.issue(principal, "/forge/@vite/client");
  assert.equal(
    assertions.consume(accepted, "/forge/@vite/client")?.subjectId,
    principal.subjectId
  );
  assert.equal(assertions.consume(accepted, "/forge/@vite/client"), null);

  const expired = assertions.issue(principal, "/forge/src/main.tsx");
  now += 501;
  assert.equal(assertions.consume(expired, "/forge/src/main.tsx"), null);

  assert.throws(
    () => assertions.issue(principal, "https://attacker.example/source"),
    /bounded development asset target/
  );
});
