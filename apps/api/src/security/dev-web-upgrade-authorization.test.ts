import assert from "node:assert/strict";
import test from "node:test";

import type { ForgePrincipal } from "./contracts.js";
import { canUseDevWebUpgrade } from "./dev-web-upgrade-authorization.js";

function principal(overrides: Partial<ForgePrincipal> = {}): ForgePrincipal {
  return {
    kind: "paired_client",
    subjectId: "browser-client",
    ownerId: "owner",
    clientId: "browser-client",
    installationId: "installation",
    audience: "forge",
    scopes: ["read", "write"],
    clientType: "browser",
    profile: "operator",
    ownerSecurityEpoch: 1,
    clientSecurityEpoch: 1,
    authenticatedAt: "2026-07-28T00:00:00.000Z",
    ...overrides
  };
}

test("dev web upgrades admit only local owner sessions and paired operator browsers", () => {
  assert.equal(
    canUseDevWebUpgrade(
      principal({
        kind: "operator_session",
        clientType: undefined
      })
    ),
    true
  );
  assert.equal(canUseDevWebUpgrade(principal()), true);
  assert.equal(canUseDevWebUpgrade(principal({ profile: "viewer" })), false);
  assert.equal(canUseDevWebUpgrade(principal({ clientType: "api" })), false);
  assert.equal(
    canUseDevWebUpgrade(principal({ kind: "legacy_agent_token" })),
    false
  );
  assert.equal(canUseDevWebUpgrade(null), false);
});
