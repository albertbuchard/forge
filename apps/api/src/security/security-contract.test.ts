import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  CAPABILITY_INVENTORY,
  PERSISTENT_TRANSPORT_INVENTORY
} from "./surface-inventory.js";
import {
  materializeRouteSecurityContracts,
  resolveRouteSecurityContract,
  reviewedBodyLimitOverrides,
  reviewedLegacyScopeCompatibility
} from "./route-contract.js";
import { discoverSourceRouteInventory } from "./source-route-inventory.js";
import { SUPPLY_CHAIN_INVENTORY } from "./supply-chain-inventory.js";
import {
  REVIEWED_ORDINARY_SENSITIVE_ROUTES,
  routeAuthorizationRisk
} from "./profile-authorization.js";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../.."
);
const API_SOURCE_ROOT = path.join(REPOSITORY_ROOT, "apps/api/src");

test("the source route inventory is fully resolvable and default-deny", async () => {
  const inventory = await discoverSourceRouteInventory(API_SOURCE_ROOT);

  assert.equal(
    inventory.unresolved.length,
    0,
    `Unresolved Fastify registrations:\n${inventory.unresolved
      .map(
        (entry) =>
          `${entry.sourceFile}:${entry.sourceLine} ${entry.method} ${entry.expression}`
      )
      .join("\n")}`
  );
  assert.ok(
    inventory.routes.length >= 450,
    `Expected a broad Forge route inventory, found ${inventory.routes.length}.`
  );

  const contracts = materializeRouteSecurityContracts(inventory.routes);
  assert.ok(contracts.size >= 450);
  assert.equal(
    contracts.size,
    new Set(
      inventory.routes.map(
        (route) => `${route.method.toUpperCase()} ${route.routePath}`
      )
    ).size
  );
  for (const contract of contracts.values()) {
    assert.ok(contract.action);
    assert.ok(contract.resource);
    assert.ok(contract.maximumBodyBytes >= 0);
    if (contract.allowsAnonymousAdmission) {
      assert.ok(
        contract.securityClass === "public_static_or_health" ||
          contract.securityClass === "bounded_auth_protocol"
      );
    }
    if (contract.securityClass === "verified_protocol") {
      assert.notEqual(contract.protocolVerifier, "none");
    }
    assert.equal(
      new Set(contract.acceptedLegacyScopes).size,
      contract.acceptedLegacyScopes.length
    );
  }
  for (const key of reviewedLegacyScopeCompatibility().keys()) {
    assert.ok(contracts.has(key), `Stale legacy-scope route: ${key}`);
  }
});

test("every source route receives a stable operation action and exact resource template", async () => {
  const inventory = await discoverSourceRouteInventory(API_SOURCE_ROOT);
  const contracts = materializeRouteSecurityContracts(inventory.routes);
  for (const [key, contract] of contracts) {
    assert.match(
      contract.action,
      /^[a-z0-9_.]+$/,
      `${key} must have a typed action identifier`
    );
    assert.match(
      contract.resource,
      /^forge:\/\/route\//,
      `${key} must have an exact route resource template`
    );
    assert.equal(
      contract.resource.slice("forge://route/".length).includes(":"),
      false,
      `${key} must use canonical resource placeholders`
    );
  }

  const read = contracts.get("GET /api/v1/artifacts/:id");
  const download = contracts.get("GET /api/v1/artifacts/:id/download");
  const trust = contracts.get("POST /api/v1/artifacts/:id/trust");
  assert.ok(read && download && trust);
  assert.notEqual(read.action, download.action);
  assert.notEqual(read.resource, download.resource);
  assert.notEqual(read.action, trust.action);
});

test("companion bootstrap has a stable exact route action", () => {
  const contract = resolveRouteSecurityContract({
    method: "POST",
    routePath: "/api/v1/health/pairing-sessions"
  });
  assert.equal(contract.securityClass, "protected");
  assert.equal(contract.action, "companion.pair");
  assert.equal(contract.allowsAnonymousAdmission, false);
});

test("source routes with restore vocabulary cannot silently become ordinary without explicit review", async () => {
  const inventory = await discoverSourceRouteInventory(API_SOURCE_ROOT);
  const ordinaryRestoreRoutes = inventory.routes
    .filter((route) => /restore/i.test(route.routePath))
    .filter(
      (route) =>
        routeAuthorizationRisk(
          resolveRouteSecurityContract({
            method: route.method,
            routePath: route.routePath
          })
        ) === "ordinary"
    )
    .map((route) => `${route.method.toUpperCase()} ${route.routePath}`)
    .sort();
  assert.deepEqual(
    ordinaryRestoreRoutes,
    [...REVIEWED_ORDINARY_SENSITIVE_ROUTES].sort()
  );
});

test("network-looking headers and addresses are absent from the route contract", () => {
  const protectedContract = resolveRouteSecurityContract({
    method: "GET",
    routePath: "/api/v1/context"
  });
  assert.equal(protectedContract.securityClass, "protected");
  assert.equal(protectedContract.allowsAnonymousAdmission, false);

  const tailscaleLookingContract = resolveRouteSecurityContract({
    method: "GET",
    routePath: "/api/v1/context"
  });
  assert.deepEqual(tailscaleLookingContract, protectedContract);
});

test("only exact data-free shell routes, liveness, CORS, and bounded auth protocols admit anonymous requests", () => {
  assert.equal(
    resolveRouteSecurityContract({
      method: "GET",
      routePath: "/api/health"
    }).securityClass,
    "public_static_or_health"
  );
  assert.equal(
    resolveRouteSecurityContract({
      method: "GET",
      routePath: "/api/v1/health"
    }).securityClass,
    "protected"
  );
  assert.equal(
    resolveRouteSecurityContract({
      method: "GET",
      routePath: "/api/v1/auth/operator-session"
    }).securityClass,
    "protected"
  );
  for (const routePath of [
    "/",
    "/*",
    "/__forge-ui-root-redirect",
    "/__forge-ui-base-redirect"
  ]) {
    const contract = resolveRouteSecurityContract({
      method: "GET",
      routePath
    });
    assert.equal(contract.securityClass, "public_static_or_health");
    assert.equal(contract.action, "ui.static.read");
  }
  assert.equal(
    resolveRouteSecurityContract({
      method: "GET",
      routePath: "/api/*"
    }).securityClass,
    "protected"
  );
  assert.equal(
    resolveRouteSecurityContract({
      method: "OPTIONS",
      routePath: "/api/*"
    }).action,
    "system.cors.preflight"
  );
  for (const routePath of [
    "/api/v1/auth/device/approve",
    "/api/v1/auth/device/deny"
  ]) {
    const contract = resolveRouteSecurityContract({
      method: "POST",
      routePath
    });
    assert.equal(contract.securityClass, "protected");
    assert.equal(contract.allowsAnonymousAdmission, false);
  }
  assert.equal(
    resolveRouteSecurityContract({
      method: "POST",
      routePath: "/api/v1/mobile/pairing/verify"
    }).securityClass,
    "bounded_auth_protocol"
  );
  assert.equal(
    resolveRouteSecurityContract({
      method: "POST",
      routePath: "/api/v1/mobile/movement/bootstrap"
    }).securityClass,
    "verified_protocol"
  );
  assert.equal(
    resolveRouteSecurityContract({
      method: "POST",
      routePath: "/api/v1/mobile/future-unreviewed-route"
    }).securityClass,
    "protected"
  );
  assert.equal(
    resolveRouteSecurityContract({
      method: "GET",
      routePath: "/api/v1/mobile/movement/bootstrap"
    }).securityClass,
    "protected"
  );
  assert.equal(
    resolveRouteSecurityContract({
      method: "GET",
      routePath: "/api/v1/peers/human-presence"
    }).protocolVerifier,
    "peer_signature"
  );
  assert.equal(
    resolveRouteSecurityContract({
      method: "POST",
      routePath: "/api/v1/peers/companion-enrollments/options"
    }).securityClass,
    "protected"
  );
});

test("reviewed route limits preserve every existing explicit payload capability", async () => {
  const expected = new Map([
    ["POST /api/v1/artifacts", 150 * 1024 * 1024],
    ["POST /api/v1/mobile/healthkit/sync-sessions/:id/chunks", 40_000_000],
    ["POST /api/v1/mobile/healthkit/sync", 8_000_000],
    ["POST /api/v1/courses/import", 12 * 1024 * 1024]
  ]);
  assert.deepEqual(reviewedBodyLimitOverrides(), expected);
  const inventory = await discoverSourceRouteInventory(API_SOURCE_ROOT);
  const discovered = new Map(
    inventory.routes
      .filter((route) => route.explicitBodyLimit !== undefined)
      .map((route) => [
        `${route.method} ${route.routePath}`,
        route.explicitBodyLimit!
      ])
  );
  assert.deepEqual(discovered, expected);
  for (const [key, maximumBodyBytes] of expected) {
    const separator = key.indexOf(" ");
    const contract = resolveRouteSecurityContract({
      method: key.slice(0, separator),
      routePath: key.slice(separator + 1)
    });
    assert.equal(contract.maximumBodyBytes, maximumBodyBytes, key);
    assert.equal(
      materializeRouteSecurityContracts(inventory.routes).get(key)
        ?.maximumBodyBytes,
      maximumBodyBytes,
      `${key} source inventory`
    );
  }
  assert.equal(
    resolveRouteSecurityContract({
      method: "POST",
      routePath: "/api/v1/notes"
    }).maximumBodyBytes,
    1024 * 1024
  );
});

test("persistent transports and privileged capabilities name their boundary and source", async () => {
  assert.ok(PERSISTENT_TRANSPORT_INVENTORY.length >= 7);
  assert.ok(CAPABILITY_INVENTORY.length >= 7);

  for (const entry of [
    ...PERSISTENT_TRANSPORT_INVENTORY,
    ...CAPABILITY_INVENTORY
  ]) {
    assert.ok(entry.sourceLocations.length > 0, entry.id);
    for (const sourceLocation of entry.sourceLocations) {
      await access(path.join(REPOSITORY_ROOT, sourceLocation));
    }
  }

  const machineExec = CAPABILITY_INVENTORY.find(
    (entry) => entry.id === "machine.exec"
  );
  assert.equal(machineExec?.remoteBoundary, "os_isolated_worker");
});

test("every shipped dependency ecosystem has a canonical manifest and an audit plan", async () => {
  const ecosystems = new Set(
    SUPPLY_CHAIN_INVENTORY.map((entry) => entry.ecosystem)
  );
  assert.deepEqual([...ecosystems].sort(), [
    "generated",
    "node",
    "python",
    "ruby",
    "rust",
    "swift"
  ]);

  for (const entry of SUPPLY_CHAIN_INVENTORY) {
    assert.ok(entry.canonicalManifests.length > 0, entry.id);
    assert.ok(entry.auditCommands.length > 0, entry.id);
    for (const manifest of entry.canonicalManifests) {
      await access(path.join(REPOSITORY_ROOT, manifest));
    }
    for (const lockfile of entry.lockfiles) {
      await access(path.join(REPOSITORY_ROOT, lockfile));
    }
  }

  for (const entry of SUPPLY_CHAIN_INVENTORY) {
    if (entry.lockRequiredBeforeRelease) {
      assert.ok(
        (entry.lockfiles as readonly string[]).length > 0,
        `${entry.id} requires a release lockfile`
      );
    }
  }
});
