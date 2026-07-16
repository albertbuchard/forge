import assert from "node:assert/strict";
import test from "node:test";
import {
  PEER_ROUTE_CONTRACTS,
  getPeerRouteContract,
  peerRouteKey
} from "./peer-route-contract.js";

test("People and peer route contracts are unique and operation ids are stable", () => {
  assert.equal(PEER_ROUTE_CONTRACTS.length, 37);
  assert.equal(
    new Set(PEER_ROUTE_CONTRACTS.map(peerRouteKey)).size,
    PEER_ROUTE_CONTRACTS.length
  );
  assert.equal(
    new Set(PEER_ROUTE_CONTRACTS.map((route) => route.operationId)).size,
    PEER_ROUTE_CONTRACTS.length
  );
});

test("secure companion enrollment is operator-only and never agent exposed", () => {
  for (const path of [
    "/api/v1/peers/companion-enrollments/options",
    "/api/v1/peers/companion-enrollments/verify"
  ]) {
    const route = getPeerRouteContract("POST", path);
    assert.ok(route);
    assert.deepEqual(route.principalClasses, ["operator_session"]);
    assert.equal(route.humanOnly, true);
    assert.equal(route.mcpExposed, false);
    assert.deepEqual(route.requiredScopes, ["peer:grants:manage"]);
  }
});

test("grant, pairing, relationship revoke, and device mutations are human-only", () => {
  const sensitiveMutations = PEER_ROUTE_CONTRACTS.filter(
    (route) =>
      route.method !== "GET" &&
      (/\/peers\/(?:human-presence|invitations|pairings|grants|requests)/.test(route.path) ||
        /\/relationships\/.*\/(?:revoke|devices|grants)/.test(route.path))
  );
  assert.ok(sensitiveMutations.length > 0);
  for (const route of sensitiveMutations) {
    assert.equal(route.humanOnly, true, peerRouteKey(route));
    assert.equal(route.mcpExposed, false, peerRouteKey(route));
    assert.equal(route.principalClasses.includes("agent_token"), false, peerRouteKey(route));
    assert.equal(route.principalClasses.includes("peer_device"), false, peerRouteKey(route));
  }
});

test("typed People questions are agent-visible but never generic peer HTTP", () => {
  const execute = getPeerRouteContract(
    "POST",
    "/api/v1/people/:personId/questions/execute"
  );
  assert.ok(execute);
  assert.equal(execute.mcpExposed, true);
  assert.ok(execute.requiredScopes.includes("peer:query"));
  assert.equal(
    PEER_ROUTE_CONTRACTS.some((route) => /proxy|arbitrary|http-request/i.test(route.path)),
    false
  );
});
