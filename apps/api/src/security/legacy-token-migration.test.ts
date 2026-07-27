import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { AgentTokenSummary } from "../types.js";
import { LegacyTokenMigrationService } from "./legacy-token-migration.js";

function token(overrides: Partial<AgentTokenSummary> = {}): AgentTokenSummary {
  return {
    id: "tok_legacy_test",
    label: "Legacy test",
    tokenPrefix: "forge_test••••",
    scopes: ["read"],
    agentId: "agent_legacy_test",
    agentLabel: "Legacy test",
    trustLevel: "standard",
    autonomyMode: "approval_required",
    approvalMode: "approval_by_default",
    description: "",
    bootstrapPolicy: {
      mode: "disabled",
      goalsLimit: 0,
      projectsLimit: 0,
      tasksLimit: 0,
      habitsLimit: 0,
      strategiesLimit: 0,
      peoplePageLimit: 0,
      includePeoplePages: false
    },
    scopePolicy: {
      userIds: ["owner-legacy-test"],
      projectIds: [],
      tagIds: []
    },
    lastUsedAt: null,
    revokedAt: null,
    createdAt: "2026-07-26T20:00:00.000Z",
    updatedAt: "2026-07-26T20:00:00.000Z",
    status: "active",
    ...overrides
  };
}

function database() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE agent_tokens (id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE security_owners (
      owner_id TEXT PRIMARY KEY,
      security_epoch INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE security_legacy_token_migrations (
      token_id TEXT PRIMARY KEY REFERENCES agent_tokens(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL REFERENCES security_owners(owner_id),
      installation_id TEXT NOT NULL,
      audience TEXT NOT NULL,
      profile TEXT NOT NULL,
      scopes_json TEXT NOT NULL,
      migrated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    ) STRICT;
    INSERT INTO agent_tokens(id) VALUES ('tok_legacy_test');
    INSERT INTO security_owners(
      owner_id, security_epoch, created_at, updated_at
    ) VALUES (
      'owner-legacy-test', 1,
      '2026-07-26T20:00:00.000Z', '2026-07-26T20:00:00.000Z'
    );
  `);
  return database;
}

test("legacy token migration is owner/audience/scope bound and never extends its first deadline", () => {
  const opened = database();
  let now = new Date("2026-07-26T20:00:00.000Z");
  try {
    const service = new LegacyTokenMigrationService(
      opened,
      "owner-legacy-test",
      "install-legacy-test",
      "urn:forge:install-legacy-test:api",
      "local_migration",
      () => now
    );
    const fixture = token();
    service.backfill([fixture]);
    const first = service.read(fixture.id);
    assert.ok(first);
    assert.equal(first.migrated_at, now.toISOString());
    assert.equal(service.authorize(fixture, "direct_loopback"), true);
    assert.equal(
      service.authorize(
        { ...fixture, scopes: ["read", "write"] },
        "direct_loopback"
      ),
      false
    );

    now = new Date("2026-08-01T20:00:00.000Z");
    service.backfill([fixture]);
    assert.equal(service.read(fixture.id)?.expires_at, first.expires_at);

    now = new Date(first.expires_at);
    assert.equal(service.authorize(fixture, "direct_loopback"), false);
  } finally {
    opened.close();
  }
});

test("tailnet and disabled gates reject broad or all legacy credentials without changing local parity", () => {
  const opened = database();
  try {
    const now = () => new Date("2026-07-26T20:00:00.000Z");
    const local = new LegacyTokenMigrationService(
      opened,
      "owner-legacy-test",
      "install-legacy-test",
      "urn:forge:install-legacy-test:api",
      "local_migration",
      now
    );
    const broad = token({
      scopes: ["read", "write"],
      trustLevel: "trusted",
      scopePolicy: { userIds: [], projectIds: [], tagIds: [] }
    });
    local.register(broad);
    assert.equal(local.authorize(broad, "direct_loopback"), true);
    assert.equal(local.authorize(broad, "tailnet_forwarded"), false);
    assert.equal(local.authorize(broad, "other_network"), false);

    const tailnet = new LegacyTokenMigrationService(
      opened,
      "owner-legacy-test",
      "install-legacy-test",
      "urn:forge:install-legacy-test:api",
      "tailnet_gate",
      now
    );
    assert.equal(tailnet.creationEnabled, false);
    assert.equal(tailnet.authorize(broad, "tailnet_forwarded"), false);

    const disabled = new LegacyTokenMigrationService(
      opened,
      "owner-legacy-test",
      "install-legacy-test",
      "urn:forge:install-legacy-test:api",
      "disabled",
      now
    );
    assert.equal(disabled.authorize(broad, "direct_loopback"), false);
    local.revoke(broad.id);
    assert.equal(local.authorize(broad, "direct_loopback"), false);
  } finally {
    opened.close();
  }
});
