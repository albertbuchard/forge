import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { getGoogleCalendarOauthPrivateConfig } from "./repositories/settings.js";
import type { ApplicationSecurityRuntime } from "./security/application-security-runtime.js";

test("Google OAuth secret writes are encrypted and never echoed by settings responses", async () => {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-google-secret-security-")
  );
  const captured: { security?: ApplicationSecurityRuntime } = {};
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    onSecurityRuntimeReady(runtime) {
      captured.security = runtime;
    }
  });

  try {
    const security = captured.security;
    assert.ok(security);
    const ownerEpoch = security.store.readOwnerSecurityEpoch("user_operator");
    assert.ok(ownerEpoch);
    const session = security.browserSessions.create({
      kind: "operator_session",
      subjectId: "user_operator",
      ownerId: "user_operator",
      clientId: null,
      installationId: null,
      audience: security.audience,
      scopes: ["*"],
      profile: "operator",
      ownerSecurityEpoch: ownerEpoch,
      clientSecurityEpoch: null,
      authenticatedAt: new Date().toISOString()
    });
    const sentinel = "forge-synthetic-google-secret-never-echo";
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: {
        cookie: `forge_session=${encodeURIComponent(session.sessionToken)}`,
        "x-forge-csrf": session.csrfToken
      },
      payload: {
        calendarProviders: {
          google: {
            clientId: "synthetic.apps.googleusercontent.com",
            clientSecret: sentinel
          }
        }
      }
    });

    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.body.includes(sentinel), false);
    const google = response.json<{
      settings: { calendarProviders: { google: Record<string, unknown> } };
    }>().settings.calendarProviders.google;
    assert.equal("clientSecret" in google, false);
    assert.equal("storedClientSecret" in google, false);
    assert.equal(google.hasStoredClientSecret, true);
    assert.equal(google.clientSecretStorage, "encrypted");

    const row = getDatabase()
      .prepare(
        `SELECT google_client_secret, google_client_secret_id
         FROM app_settings
         WHERE id = 1`
      )
      .get() as {
      google_client_secret: string;
      google_client_secret_id: string | null;
    };
    assert.equal(row.google_client_secret, "");
    assert.ok(row.google_client_secret_id);
    const encrypted = getDatabase()
      .prepare(`SELECT cipher_text FROM stored_secrets WHERE id = ?`)
      .get(row.google_client_secret_id) as { cipher_text: string };
    assert.equal(encrypted.cipher_text.includes(sentinel), false);
    assert.equal(
      (await readFile(path.join(dataRoot, "forge.json"), "utf8")).includes(
        sentinel
      ),
      false
    );
    assert.equal(getGoogleCalendarOauthPrivateConfig().clientSecret, sentinel);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});
