import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeOpenAiCodexOauthCredentials,
  getOpenAiCodexOauthSession,
  startOpenAiCodexOauthSession,
  submitOpenAiCodexOauthManualInput
} from "./services/openai-codex-oauth.js";

test("openai codex oauth start waits for auth url when login reaches browser step", async () => {
  const session = await startOpenAiCodexOauthSession({
    login: async ({ onAuth }) => {
      onAuth({ url: "https://auth.openai.com/oauth/authorize?state=test" });
      await new Promise(() => {});
      return {
        access: "unused",
        refresh: "unused",
        expires: Date.now() + 60_000,
        accountId: "acct_unused"
      };
    }
  });

  assert.equal(session.status, "awaiting_browser");
  assert.equal(
    session.authUrl,
    "https://auth.openai.com/oauth/authorize?state=test"
  );
});

test("openai codex oauth manual flow authorizes and can be consumed", async () => {
  const session = await startOpenAiCodexOauthSession({
    login: async ({ onAuth, onManualCodeInput }) => {
      onAuth({ url: "https://auth.openai.com/oauth/authorize?state=test" });
      const code = await onManualCodeInput?.();
      assert.equal(code, "http://127.0.0.1:1455/auth/callback?code=abc&state=test");
      return {
        access: "acc_token",
        refresh: "ref_token",
        expires: 1_800_000_000_000,
        accountId: "acct_123"
      };
    }
  });

  assert.equal(
    getOpenAiCodexOauthSession(session.id).status,
    "awaiting_manual_input"
  );
  submitOpenAiCodexOauthManualInput(
    session.id,
    "http://127.0.0.1:1455/auth/callback?code=abc&state=test"
  );

  await new Promise((resolve) => setTimeout(resolve, 10));

  const authorized = getOpenAiCodexOauthSession(session.id);
  assert.equal(authorized.status, "authorized");
  assert.equal(authorized.accountLabel, "acct_123");

  const credentials = consumeOpenAiCodexOauthCredentials(session.id);
  assert.equal(credentials.access, "acc_token");
  assert.equal(credentials.provider, "openai-codex");
  assert.equal(getOpenAiCodexOauthSession(session.id).status, "consumed");
});
