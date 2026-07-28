import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import {
  closeDatabase,
  configureDatabase,
  configureLegacyWikiAutoImport,
  getDatabase,
  getEffectiveDataRoot,
  initializeDatabase
} from "./db.js";

const migrationName = "120_security_pairing_metadata_compatibility.sql";

test("migration 120 repairs a recorded migration 113 legacy client_type shape", async () => {
  const originalDataRoot = getEffectiveDataRoot();
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-pairing-metadata-")
  );
  configureLegacyWikiAutoImport(false);
  configureDatabase({ dataRoot });

  try {
    await initializeDatabase();
    const database = getDatabase();
    database.exec(`
      DROP TABLE security_pairing_client_metadata;
      ALTER TABLE security_pairing_requests
        ADD COLUMN client_type TEXT NOT NULL DEFAULT 'api'
        CHECK (client_type IN ('api', 'browser'));
    `);
    database
      .prepare(
        `INSERT INTO security_owners (
           owner_id, security_epoch, created_at, recovered_at
         ) VALUES (?, 1, ?, NULL)`
      )
      .run("user_operator", "2026-07-27T00:00:00.000Z");
    database
      .prepare(
        `INSERT INTO security_installation (
           singleton, installation_id, created_at
         ) VALUES (1, ?, ?)`
      )
      .run("install_0123456789abcdef", "2026-07-27T00:00:00.000Z");
    database
      .prepare(
        `INSERT INTO security_pairing_requests (
           id, owner_id, owner_epoch, installation_id, client_name,
           client_key_thumbprint, audience, requested_scopes_json,
           requested_profile, device_digest, user_code_digest, status,
           poll_interval_seconds, next_poll_at, expires_at, approval_json,
           created_at, updated_at, client_type
         ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 5, ?, ?, NULL, ?, ?, ?)`
      )
      .run(
        "pair_legacy_browser",
        "user_operator",
        "install_0123456789abcdef",
        "Legacy browser",
        "thumbprint-legacy",
        "urn:forge:test:api",
        JSON.stringify(["read", "write"]),
        "trusted_personal_assistant",
        "device-digest-legacy",
        "user-code-digest-legacy",
        "2026-07-27T00:00:05.000Z",
        "2026-07-27T00:03:00.000Z",
        "2026-07-27T00:00:00.000Z",
        "2026-07-27T00:00:00.000Z",
        "browser"
      );
    database.prepare("DELETE FROM migrations WHERE id = ?").run(migrationName);
    closeDatabase();

    await initializeDatabase();
    const repaired = getDatabase()
      .prepare(
        `SELECT client_type
         FROM security_pairing_client_metadata
         WHERE pairing_request_id = ?`
      )
      .get("pair_legacy_browser") as { client_type: string } | undefined;
    assert.equal(repaired?.client_type, "browser");
    assert.ok(
      getDatabase()
        .prepare("SELECT 1 FROM migrations WHERE id = ?")
        .get(migrationName)
    );
    closeDatabase();

    const app = await buildServer({
      dataRoot,
      seedDemoData: false,
      taskRunWatchdog: false,
      devrageMetricSync: false,
      peerRuntime: false
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/device",
        headers: { host: "127.0.0.1" },
        payload: {
          clientName: "Recovered browser",
          clientType: "browser",
          clientKeyThumbprint: createHash("sha256")
            .update("recovered-browser-key")
            .digest("base64url"),
          requestedScopes: ["read", "write"],
          requestedProfile: "trusted_personal_assistant"
        }
      });
      assert.equal(response.statusCode, 200, response.body);
      const requestId = response.json<{ requestId: string }>().requestId;
      const metadata = getDatabase()
        .prepare(
          `SELECT client_type
           FROM security_pairing_client_metadata
           WHERE pairing_request_id = ?`
        )
        .get(requestId) as { client_type: string } | undefined;
      assert.equal(metadata?.client_type, "browser");
    } finally {
      await app.close();
    }
  } finally {
    closeDatabase();
    configureDatabase({ dataRoot: originalDataRoot });
    configureLegacyWikiAutoImport(true);
    await rm(dataRoot, { recursive: true, force: true });
  }
});
