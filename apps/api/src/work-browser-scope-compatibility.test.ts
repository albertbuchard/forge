import assert from "node:assert/strict";
import test from "node:test";

import {
  applicationScopesForVerifiedPrincipal,
  AuthenticationManager
} from "./managers/platform/authentication-manager.js";
import type { SessionManager } from "./managers/platform/session-manager.js";
import type { TokenManager } from "./managers/platform/token-manager.js";
import type { ForgePrincipal } from "./security/contracts.js";

function principal(overrides: Partial<ForgePrincipal> = {}): ForgePrincipal {
  return {
    kind: "paired_client",
    subjectId: "legacy-paired-browser",
    ownerId: "user_operator",
    clientId: "client_legacy_browser",
    installationId: "installation_1",
    audience: "forge",
    scopes: ["profile:trusted_personal_assistant", "read", "write"],
    clientType: "browser",
    profile: "trusted_personal_assistant",
    ownerSecurityEpoch: 1,
    clientSecurityEpoch: 1,
    authenticatedAt: "2026-08-25T18:00:00.000Z",
    ...overrides
  };
}

test("existing trusted browser grants inherit ordinary Work access without re-pairing", () => {
  const existingPrincipal = principal();
  const scopes = applicationScopesForVerifiedPrincipal(existingPrincipal);
  assert.deepEqual(scopes, [
    "profile:trusted_personal_assistant",
    "read",
    "work.read",
    "work.write",
    "write"
  ]);
  assert.equal(scopes.includes("work.compensation.read"), false);
  assert.equal(scopes.includes("work.transmit"), false);

  const manager = new AuthenticationManager(
    {} as SessionManager,
    {} as TokenManager
  );
  const headers = {};
  manager.bindVerifiedPrincipal(headers, existingPrincipal);
  assert.deepEqual(manager.authenticate(headers).token?.scopes, scopes);
});

test("Work compatibility does not widen API clients, viewers, or read-only browsers", () => {
  assert.deepEqual(
    applicationScopesForVerifiedPrincipal(principal({ clientType: "api" })),
    ["profile:trusted_personal_assistant", "read", "write"]
  );
  assert.deepEqual(
    applicationScopesForVerifiedPrincipal(
      principal({ profile: "viewer", scopes: ["profile:viewer", "read"] })
    ),
    ["profile:viewer", "read"]
  );
  assert.deepEqual(
    applicationScopesForVerifiedPrincipal(
      principal({
        scopes: ["profile:trusted_personal_assistant", "read"]
      })
    ),
    ["profile:trusted_personal_assistant", "read", "work.read"]
  );
});
