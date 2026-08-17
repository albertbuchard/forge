import assert from "node:assert/strict";
import test from "node:test";

import { AuthenticationManager } from "../managers/platform/authentication-manager.js";
import type { SessionManager } from "../managers/platform/session-manager.js";
import type { TokenManager } from "../managers/platform/token-manager.js";
import type { ForgePrincipal } from "./contracts.js";

const verifiedToken = {
  id: "token-label-test",
  agentId: "agent-label-test",
  agentLabel: "Verified Agent",
  scopes: ["read"],
  trustLevel: "trusted",
  autonomyMode: "approval_required",
  approvalMode: "approval_by_default",
  bootstrapPolicy: {
    mode: "disabled" as const,
    goalsLimit: 0,
    projectsLimit: 0,
    tasksLimit: 0,
    habitsLimit: 0,
    strategiesLimit: 0,
    peoplePageLimit: 0,
    includePeoplePages: false
  },
  scopePolicy: {
    userIds: [],
    projectIds: [],
    tagIds: []
  }
};

test("caller actor and source headers cannot replace verified token identity", () => {
  const manager = new AuthenticationManager(
    {
      readSessionFromHeaders: () => null
    } as unknown as SessionManager,
    {
      verifyBearerToken: (token: string) =>
        token === "verified-token" ? verifiedToken : null
    } as unknown as TokenManager
  );
  const authenticated = manager.authenticate({
    authorization: "Bearer verified-token",
    "x-forge-actor": "Forged Operator",
    "x-forge-source": "system"
  });

  assert.equal(authenticated.actor, "Verified Agent");
  assert.equal(authenticated.source, "agent");
  assert.equal(authenticated.token?.id, "token-label-test");
});

test("caller actor and source headers cannot replace verified browser identity", () => {
  const manager = new AuthenticationManager(
    {
      readSessionFromHeaders: () => ({
        id: "session-label-test",
        actorLabel: "Verified Owner",
        expiresAt: "2026-07-26T20:00:00.000Z"
      })
    } as unknown as SessionManager,
    {
      verifyBearerToken: () => null
    } as unknown as TokenManager
  );
  const authenticated = manager.authenticate({
    "x-forge-actor": "Forged Agent",
    "x-forge-source": "openclaw"
  });

  assert.equal(authenticated.actor, "Verified Owner");
  assert.equal(authenticated.source, "ui");
  assert.equal(authenticated.session?.id, "session-label-test");
});

test("verified principals preserve selected-user authority with legacy empty-owner semantics", () => {
  const manager = new AuthenticationManager(
    { readSessionFromHeaders: () => null } as unknown as SessionManager,
    { verifyBearerToken: () => null } as unknown as TokenManager
  );
  const principal = {
    kind: "paired_client",
    subjectId: "pair_selected_user_test",
    ownerId: "owner_selected_user_test",
    clientId: "client_selected_user_test",
    installationId: "installation_selected_user_test",
    audience: "urn:forge:selected-user-test",
    scopes: ["read", "write"],
    selectedUserIds: ["user_selected", "user_selected"],
    clientType: "browser",
    profile: "viewer",
    ownerSecurityEpoch: 1,
    clientSecurityEpoch: 1,
    authenticatedAt: "2026-08-18T08:00:00.000Z"
  } satisfies ForgePrincipal;
  const selectedHeaders = {};
  manager.bindVerifiedPrincipal(selectedHeaders, principal);
  const selected = manager.authenticate(selectedHeaders);
  assert.deepEqual(selected.token?.scopePolicy.userIds, ["user_selected"]);
  assert.deepEqual(selected.scope.userIds, ["user_selected"]);

  const legacyHeaders = {};
  manager.bindVerifiedPrincipal(legacyHeaders, {
    ...principal,
    selectedUserIds: []
  });
  const legacy = manager.authenticate(legacyHeaders);
  assert.deepEqual(legacy.token?.scopePolicy.userIds, [principal.ownerId]);
  assert.deepEqual(legacy.scope.userIds, [principal.ownerId]);
});
