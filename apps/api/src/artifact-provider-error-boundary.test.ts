import assert from "node:assert/strict";
import test from "node:test";
import {
  OpenAiResponsesProvider,
  OpenAiTextPromptError
} from "./managers/platform/openai-responses-provider.js";

test("OpenAI Artifact text failures discard raw response bodies", async () => {
  const provider = new OpenAiResponsesProvider();
  const originalFetch = globalThis.fetch;
  const rawProviderBody = "private-upstream-error-body-57291";
  const diagnostics: unknown[] = [];
  globalThis.fetch = (async () =>
    new Response(rawProviderBody, {
      status: 429,
      headers: { "content-type": "text/plain" }
    })) as typeof fetch;
  try {
    await assert.rejects(
      provider.runText!({
        apiKey: "test-key",
        profile: {
          provider: "openai",
          baseUrl: "https://api.openai.com",
          model: "gpt-5.4-mini",
          systemPrompt: "",
          secretId: null,
          metadata: {}
        },
        systemPrompt: "Summarize safely.",
        prompt: "Describe this artifact.",
        logger: (entry) => diagnostics.push(entry)
      }),
      (error: unknown) => {
        assert.ok(error instanceof OpenAiTextPromptError);
        assert.equal(error.code, "openai_text_prompt_failed");
        assert.equal(error.statusCode, 429);
        assert.equal(error.message.includes(rawProviderBody), false);
        return true;
      }
    );
    assert.equal(JSON.stringify(diagnostics).includes(rawProviderBody), false);
    assert.equal(
      JSON.stringify(diagnostics).includes("responseBodyPersisted"),
      true
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAI Artifact text failures discard raw Codex failure events", async () => {
  const provider = new OpenAiResponsesProvider();
  const originalFetch = globalThis.fetch;
  const rawProviderBody = "private-codex-failure-event-61943";
  const codexTokenPayload = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": { chatgpt_account_id: "test-account" }
    })
  ).toString("base64url");
  const codexAccessToken = `e30.${codexTokenPayload}.test-signature`;
  const diagnostics: unknown[] = [];
  globalThis.fetch = (async () =>
    new Response(
      `data: ${JSON.stringify({
        type: "response.failed",
        response: { error: { message: rawProviderBody } }
      })}\n\n`,
      {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      }
    )) as typeof fetch;
  try {
    await assert.rejects(
      provider.runText!({
        apiKey: codexAccessToken,
        profile: {
          provider: "openai-codex",
          baseUrl: "https://chatgpt.com/backend-api/codex",
          model: "gpt-5.4-mini",
          systemPrompt: "",
          secretId: null,
          metadata: {}
        },
        systemPrompt: "Summarize safely.",
        prompt: "Describe this artifact.",
        logger: (entry) => diagnostics.push(entry)
      }),
      (error: unknown) => {
        assert.ok(error instanceof OpenAiTextPromptError);
        assert.equal(error.code, "openai_text_prompt_failed");
        assert.equal(error.statusCode, 200);
        assert.equal(error.message.includes(rawProviderBody), false);
        return true;
      }
    );
    assert.equal(JSON.stringify(diagnostics).includes(rawProviderBody), false);
    assert.equal(
      JSON.stringify(diagnostics).includes("responseBodyPersisted"),
      true
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
