import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveGoogleCalendarOauthPrivateConfig,
  resolveGoogleCalendarOauthPublicConfig
} from "./google-calendar-oauth-config.js";

test("Google OAuth public configuration reports secret state without returning secret values", () => {
  const sentinel = "forge-synthetic-google-secret";
  const config = resolveGoogleCalendarOauthPublicConfig(
    {
      APP_BASE_URL: "http://127.0.0.1:4317"
    },
    {
      clientId: "synthetic.apps.googleusercontent.com",
      clientSecret: sentinel,
      clientSecretStorage: "encrypted"
    }
  );

  assert.equal(config.hasStoredClientSecret, true);
  assert.equal(config.hasEffectiveClientSecret, true);
  assert.equal(config.clientSecretStorage, "encrypted");
  assert.equal("clientSecret" in config, false);
  assert.equal("storedClientSecret" in config, false);
  assert.equal(JSON.stringify(config).includes(sentinel), false);
});

test("Google OAuth private configuration retains the backend-only secret", () => {
  const sentinel = "forge-synthetic-google-secret";
  const config = resolveGoogleCalendarOauthPrivateConfig(
    {
      APP_BASE_URL: "http://127.0.0.1:4317"
    },
    {
      clientId: "synthetic.apps.googleusercontent.com",
      clientSecret: sentinel,
      clientSecretStorage: "legacy_quarantined"
    }
  );

  assert.equal(config.clientSecret, sentinel);
  assert.equal(config.storedClientSecret, sentinel);
  assert.equal(config.clientSecretStorage, "legacy_quarantined");
});
