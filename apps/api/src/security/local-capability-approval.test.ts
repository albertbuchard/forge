import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { ForgePrincipal } from "./contracts.js";
import {
  LOCAL_OWNER_LEGACY_WARNING_VERSION,
  LocalCapabilityApprovalError,
  LocalCapabilityApprovalService
} from "./local-capability-approval.js";

function operator(
  authenticatedAt = "2026-07-26T20:00:00.000Z"
): ForgePrincipal {
  return {
    kind: "operator_session",
    subjectId: "owner-session",
    ownerId: "owner",
    clientId: null,
    installationId: null,
    audience: "urn:forge:test",
    scopes: ["*"],
    profile: "operator",
    ownerSecurityEpoch: 1,
    clientSecurityEpoch: null,
    authenticatedAt
  };
}

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE security_local_capability_approvals (
      owner_id TEXT NOT NULL,
      installation_id TEXT NOT NULL,
      capability_id TEXT NOT NULL,
      warning_version INTEGER NOT NULL,
      warning_sha256 TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      approved_by_subject_id TEXT NOT NULL,
      revoked_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (owner_id, installation_id, capability_id)
    );
  `);
  return db;
}

test("local legacy execution is default-off and needs fresh direct owner acknowledgement", () => {
  const db = database();
  try {
    const service = new LocalCapabilityApprovalService(
      db,
      "owner",
      "installation",
      { now: () => new Date("2026-07-26T20:01:00.000Z") }
    );
    assert.equal(service.read().enabled, false);
    assert.throws(
      () =>
        service.approve({
          principal: operator(),
          directOwnerChannel: false,
          warningVersion: LOCAL_OWNER_LEGACY_WARNING_VERSION,
          acknowledged: true
        }),
      LocalCapabilityApprovalError
    );
    assert.throws(
      () =>
        service.approve({
          principal: operator("2026-07-26T19:00:00.000Z"),
          directOwnerChannel: true,
          warningVersion: LOCAL_OWNER_LEGACY_WARNING_VERSION,
          acknowledged: true
        }),
      LocalCapabilityApprovalError
    );
    assert.throws(
      () =>
        service.approve({
          principal: operator(),
          directOwnerChannel: true,
          warningVersion: LOCAL_OWNER_LEGACY_WARNING_VERSION,
          acknowledged: false
        }),
      LocalCapabilityApprovalError
    );
    assert.equal(
      service.approve({
        principal: operator(),
        directOwnerChannel: true,
        warningVersion: LOCAL_OWNER_LEGACY_WARNING_VERSION,
        acknowledged: true
      }).enabled,
      true
    );
  } finally {
    db.close();
  }
});

test("approval is installation-bound and local owner revocation is immediate", () => {
  const db = database();
  try {
    const clock = () => new Date("2026-07-26T20:01:00.000Z");
    const service = new LocalCapabilityApprovalService(
      db,
      "owner",
      "installation",
      { now: clock }
    );
    service.approve({
      principal: operator(),
      directOwnerChannel: true,
      warningVersion: LOCAL_OWNER_LEGACY_WARNING_VERSION,
      acknowledged: true
    });
    assert.equal(
      new LocalCapabilityApprovalService(db, "owner", "other-installation", {
        now: clock
      }).read().enabled,
      false
    );
    assert.throws(
      () =>
        service.revoke({
          principal: { ...operator(), kind: "paired_client" },
          directOwnerChannel: true
        }),
      LocalCapabilityApprovalError
    );
    assert.equal(
      service.revoke({
        principal: operator(),
        directOwnerChannel: true
      }).enabled,
      false
    );
  } finally {
    db.close();
  }
});
