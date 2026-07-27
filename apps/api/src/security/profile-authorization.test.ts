import assert from "node:assert/strict";
import test from "node:test";

import { defaultGatewayAuthorization } from "./access-gateway.js";
import type { ForgePrincipal } from "./contracts.js";
import {
  REVIEWED_ORDINARY_SENSITIVE_ROUTES,
  profileAllowsRoute,
  requiredProfileForRoute,
  routeAuthorizationRisk
} from "./profile-authorization.js";
import { resolveRouteSecurityContract } from "./route-contract.js";

function principal(
  profile: ForgePrincipal["profile"],
  kind: ForgePrincipal["kind"] = "paired_client"
): ForgePrincipal {
  return {
    kind,
    subjectId: "profile-test-subject",
    ownerId: "profile-test-owner",
    clientId: "profile-test-client",
    installationId: "profile-test-installation",
    audience: "urn:forge:profile-test:api",
    scopes:
      kind === "legacy_agent_token"
        ? ["read", "write"]
        : [`profile:${profile}`],
    profile,
    ownerSecurityEpoch: 1,
    clientSecurityEpoch: 1,
    authenticatedAt: "2026-07-26T18:00:00.000Z"
  };
}

function contract(method: string, routePath: string) {
  return resolveRouteSecurityContract({ method, routePath });
}

function authorize(input: {
  principal: ForgePrincipal;
  method: string;
  routePath: string;
}) {
  return () =>
    defaultGatewayAuthorization.authorize({
      request: {} as never,
      contract: contract(input.method, input.routePath),
      authentication: {
        principal: input.principal,
        mode:
          input.principal.kind === "legacy_agent_token"
            ? "legacy_agent_token"
            : "access_credential",
        csrfSatisfied: false
      },
      phase: "early"
    });
}

test("profile rules keep ordinary workflows available while isolating execution and administration", () => {
  const foodEdit = contract(
    "PATCH",
    "/api/v1/health/weight-loss/food-logs/:id"
  );
  assert.equal(routeAuthorizationRisk(foodEdit), "ordinary");
  assert.equal(
    profileAllowsRoute(principal("trusted_personal_assistant"), foodEdit),
    true
  );

  const processorRun = contract("POST", "/api/v1/ai-processors/:id/run");
  assert.equal(routeAuthorizationRisk(processorRun), "executor");
  assert.equal(requiredProfileForRoute(processorRun), "executor");
  assert.equal(
    profileAllowsRoute(principal("trusted_personal_assistant"), processorRun),
    false
  );
  assert.equal(profileAllowsRoute(principal("executor"), processorRun), true);

  for (const sensitive of [
    contract("GET", "/api/v1/settings/data/export"),
    contract("POST", "/api/v1/settings/tokens/:id/revoke"),
    contract("PATCH", "/api/v1/users/access-grants/:id"),
    contract("POST", "/api/v1/peers/invitations"),
    contract("POST", "/api/v1/wiki/settings/llm-profiles"),
    contract("PATCH", "/api/v1/wiki/settings/embedding-profiles/:id")
  ]) {
    assert.equal(routeAuthorizationRisk(sensitive), "operator_administration");
    assert.equal(requiredProfileForRoute(sensitive), "operator");
    assert.equal(profileAllowsRoute(principal("executor"), sensitive), false);
    assert.equal(profileAllowsRoute(principal("operator"), sensitive), true);
  }

  for (const execution of [
    contract("POST", "/api/v1/workbench/run"),
    contract("POST", "/api/v1/workbench/flows/:id/run"),
    contract("POST", "/api/v1/workbench/flows/:id/chat")
  ]) {
    assert.equal(routeAuthorizationRisk(execution), "executor");
    assert.equal(
      profileAllowsRoute(principal("trusted_personal_assistant"), execution),
      false
    );
    assert.equal(profileAllowsRoute(principal("executor"), execution), true);
  }

  for (const ordinaryRestore of [
    contract("POST", "/api/v1/entities/restore"),
    contract("POST", "/api/v1/attention-inbox/:id/restore")
  ]) {
    assert.equal(routeAuthorizationRisk(ordinaryRestore), "ordinary");
    assert.equal(
      profileAllowsRoute(
        principal("trusted_personal_assistant"),
        ordinaryRestore
      ),
      true
    );
    assert.equal(
      profileAllowsRoute(principal("viewer"), ordinaryRestore),
      false
    );
  }
  assert.deepEqual([...REVIEWED_ORDINARY_SENSITIVE_ROUTES].sort(), [
    "POST /api/v1/attention-inbox/:id/restore",
    "POST /api/v1/entities/restore"
  ]);
  assert.equal(
    routeAuthorizationRisk(
      contract("POST", "/api/v1/settings/data/backups/:id/restore")
    ),
    "operator_administration"
  );
});

test("the gateway enforces paired-client profiles without breaking the bounded legacy bridge", () => {
  assert.doesNotThrow(
    authorize({
      principal: principal("trusted_personal_assistant"),
      method: "PATCH",
      routePath: "/api/v1/health/weight-loss/food-logs/:id"
    })
  );
  for (const routePath of [
    "/api/v1/entities/restore",
    "/api/v1/attention-inbox/:id/restore"
  ]) {
    assert.doesNotThrow(
      authorize({
        principal: principal("trusted_personal_assistant"),
        method: "POST",
        routePath
      })
    );
    assert.throws(
      authorize({
        principal: principal("viewer"),
        method: "POST",
        routePath
      }),
      /verified Forge client profile/i
    );
  }
  assert.throws(
    authorize({
      principal: principal("trusted_personal_assistant"),
      method: "POST",
      routePath: "/api/v1/ai-processors/:id/run"
    }),
    (error: unknown) =>
      Boolean(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "gateway_profile_forbidden"
      )
  );
  assert.doesNotThrow(
    authorize({
      principal: principal("executor"),
      method: "POST",
      routePath: "/api/v1/ai-processors/:id/run"
    })
  );
  assert.throws(
    authorize({
      principal: principal("executor"),
      method: "GET",
      routePath: "/api/v1/settings/data/export"
    }),
    /verified Forge client profile/i
  );
  assert.throws(
    authorize({
      principal: principal("trusted_personal_assistant", "legacy_agent_token"),
      method: "POST",
      routePath: "/api/v1/settings/tokens/:id/revoke"
    }),
    /verified Forge client profile/i
  );
});
