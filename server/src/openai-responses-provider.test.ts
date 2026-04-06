import test from "node:test";
import assert from "node:assert/strict";
import { OpenAiResponsesProvider } from "./managers/platform/openai-responses-provider.js";

test("wiki ingest response schema is strict and fully required for nested proposal objects", async () => {
  const provider = new OpenAiResponsesProvider();
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | null = null;

  globalThis.fetch = (async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    return new Response(
      JSON.stringify({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  title: "Imported source",
                  summary: "",
                  markdown: "# Imported source",
                  tags: [],
                  entityProposals: [],
                  pageUpdateSuggestions: [],
                  articleCandidates: []
                })
              }
            ]
          }
        ]
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );
  }) as typeof fetch;

  try {
    await provider.compile({
      apiKey: "test-key",
      profile: {
        provider: "openai-responses",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.4-mini",
        systemPrompt: "",
        secretId: null,
        metadata: {}
      },
      input: {
        titleHint: "Chat import",
        rawText: "Example source text",
        binary: null,
        mimeType: "text/plain",
        parseStrategy: "auto"
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(capturedBody);
  const text = capturedBody.text as {
    format?: { schema?: Record<string, unknown> };
  };
  const schema = text.format?.schema as Record<string, unknown>;
  const entityProposalItems = (
    (schema.properties as Record<string, unknown>).entityProposals as {
      items?: Record<string, unknown>;
    }
  ).items as Record<string, unknown>;
  const pageUpdateItems = (
    (schema.properties as Record<string, unknown>).pageUpdateSuggestions as {
      items?: Record<string, unknown>;
    }
  ).items as Record<string, unknown>;
  const articleCandidateItems = (
    (schema.properties as Record<string, unknown>).articleCandidates as {
      items?: Record<string, unknown>;
    }
  ).items as Record<string, unknown>;
  const suggestedFields = (
    entityProposalItems.properties as Record<string, unknown>
  ).suggestedFields as Record<string, unknown>;
  const linkedEntities = (
    (suggestedFields.properties as Record<string, unknown>).linkedEntities as {
      items?: Record<string, unknown>;
    }
  ).items as Record<string, unknown>;
  const articleCandidateProperties =
    articleCandidateItems.properties as Record<string, unknown>;
  const suggestedFieldPropertyNames = Object.keys(
    suggestedFields.properties as Record<string, unknown>
  );

  assert.equal(entityProposalItems.additionalProperties, false);
  assert.equal(pageUpdateItems.additionalProperties, false);
  assert.equal(articleCandidateItems.additionalProperties, false);
  assert.equal(suggestedFields.additionalProperties, false);
  assert.equal(linkedEntities.additionalProperties, false);
  assert.deepEqual(
    suggestedFields.required,
    suggestedFieldPropertyNames,
    "all suggestedFields keys should be required for OpenAI structured outputs"
  );
  assert.ok(articleCandidateProperties.markdown);
  assert.ok(articleCandidateProperties.parentSlug);
  assert.ok(articleCandidateProperties.aliases);
  assert.equal(capturedBody.temperature, undefined);
});
