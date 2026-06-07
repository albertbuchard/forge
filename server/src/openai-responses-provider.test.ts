import test from "node:test";
import assert from "node:assert/strict";
import { OpenAiResponsesProvider } from "./managers/platform/openai-responses-provider.js";

test("wiki ingest response schema is strict and fully required for nested proposal objects", async () => {
  const provider = new OpenAiResponsesProvider();
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | null = null;

  globalThis.fetch = (async (request, init) => {
    const url = String(request);
    if (init?.method === "POST") {
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<
        string,
        unknown
      >;
      return new Response(
        JSON.stringify({
          id: "resp_123",
          status: "queued"
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }
    assert.equal(url, "https://api.openai.com/v1/responses/resp_123");
    return new Response(
      JSON.stringify({
        id: "resp_123",
        status: "completed",
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
  const requestBody = capturedBody as Record<string, unknown>;
  const text = requestBody.text as {
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
  assert.equal(requestBody.temperature, undefined);
  assert.equal(requestBody.background, true);
  assert.equal(requestBody.store, true);
  assert.equal(requestBody.prompt_cache_retention, "in_memory");
  assert.equal(
    requestBody.prompt_cache_key,
    "forge-wiki-ingest:gpt-5.4-mini:auto:text/plain"
  );
});

test("wiki ingest uses background polling and keeps large but valid source text intact", async () => {
  const provider = new OpenAiResponsesProvider();
  const originalFetch = globalThis.fetch;
  const capturedBodies: Array<Record<string, unknown>> = [];
  const requestUrls: string[] = [];

  globalThis.fetch = (async (request, init) => {
    requestUrls.push(String(request));
    if (init?.method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<
        string,
        unknown
      >;
      capturedBodies.push(body);
      return new Response(
        JSON.stringify({
          id: "resp_large",
          status: "queued"
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }
    return new Response(
      JSON.stringify({
        id: "resp_large",
        status: "completed",
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  title: "Large import",
                  summary: "Completed in background",
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
    const result = await provider.compile({
      apiKey: "test-key",
      profile: {
        provider: "openai-responses",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.4",
        systemPrompt: "",
        secretId: null,
        metadata: {}
      },
      input: {
        titleHint: "Chat import",
        rawText: "A".repeat(100_000),
        binary: null,
        mimeType: "text/plain",
        parseStrategy: "auto"
      }
    });
    assert.equal(result?.summary, "Completed in background");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(capturedBodies.length, 1);
  assert.deepEqual(requestUrls, [
    "https://api.openai.com/v1/responses",
    "https://api.openai.com/v1/responses/resp_large"
  ]);
  const firstInputs = capturedBodies[0].input as Array<{
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  const firstSourceText = firstInputs[1]?.content?.find(
    (item) => item.type === "input_text" && item.text?.startsWith("Source:\n")
  )?.text;

  assert.ok(firstSourceText);
  assert.ok(firstSourceText!.length > 100_000);
  assert.equal(capturedBodies[0].prompt_cache_retention, "24h");
  assert.equal(
    capturedBodies[0].prompt_cache_key,
    "forge-wiki-ingest:gpt-5.4:auto:text/plain"
  );
});

test("OpenAI Codex connection tests use the ChatGPT Codex backend and headers", async () => {
  const provider = new OpenAiResponsesProvider();
  const originalFetch = globalThis.fetch;
  type CapturedRequest = {
    url: string;
    headers: Headers;
    body: Record<string, unknown>;
  };
  let capturedRequest: CapturedRequest | undefined;

  const jwtPayload = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_codex_123"
      }
    })
  ).toString("base64url");
  const oauthAccessToken = `header.${jwtPayload}.sig`;

  globalThis.fetch = (async (request, init) => {
    capturedRequest = {
      url: String(request),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
    };
    const eventPayload = {
      type: "response.completed",
      response: {
        status: "completed",
        output: [
          {
            content: [{ type: "output_text", text: "ok" }]
          }
        ]
      }
    };
    return new Response(
      `data: ${JSON.stringify(eventPayload)}\n\ndata: [DONE]\n\n`,
      {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      }
    );
  }) as typeof fetch;

  try {
    const result = await provider.testConnection({
      apiKey: oauthAccessToken,
      profile: {
        provider: "openai-codex",
        baseUrl: "https://chatgpt.com/backend-api",
        model: "gpt-5.4-mini",
        systemPrompt: "",
        secretId: null,
        metadata: {}
      }
    });
    assert.equal(result.outputPreview, "ok");
  } finally {
    globalThis.fetch = originalFetch;
  }

  if (!capturedRequest) {
    throw new Error("Expected Codex test connection to issue one HTTP request.");
  }
  const request = capturedRequest;
  assert.equal(
    request.url,
    "https://chatgpt.com/backend-api/codex/responses"
  );
  assert.equal(
    request.headers.get("authorization"),
    `Bearer ${oauthAccessToken}`
  );
  assert.equal(
    request.headers.get("chatgpt-account-id"),
    "acct_codex_123"
  );
  assert.equal(request.headers.get("originator"), "pi");
  assert.equal(
    request.headers.get("OpenAI-Beta"),
    "responses=experimental"
  );
  assert.equal(request.body.model, "gpt-5.4-mini");
  assert.equal(request.body.instructions, "Reply with the single word ok.");
  assert.equal(request.body.input, "Connection test.");
  assert.equal(request.body.stream, true);
  assert.equal(request.body.store, false);
});

test("OpenAI Codex wiki ingest sends instructions as a top-level field", async () => {
  const provider = new OpenAiResponsesProvider();
  const originalFetch = globalThis.fetch;
  type CapturedRequest = {
    url: string;
    headers: Headers;
    body: Record<string, unknown>;
  };
  const capturedRequests: CapturedRequest[] = [];

  const jwtPayload = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_codex_456"
      }
    })
  ).toString("base64url");
  const oauthAccessToken = `header.${jwtPayload}.sig`;

  globalThis.fetch = (async (request, init) => {
    const body =
      init?.method === "POST"
        ? (JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>)
        : {};
    capturedRequests.push({
      url: String(request),
      headers: new Headers(init?.headers),
      body
    });
    if (init?.method === "POST") {
      const eventPayload = {
        type: "response.completed",
        response: {
          id: "resp_codex_ingest",
          status: "completed",
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    title: "Codex import",
                    summary: "Completed through Codex OAuth",
                    markdown: "# Codex import",
                    tags: [],
                    entityProposals: [],
                    pageUpdateSuggestions: [],
                    articleCandidates: []
                  })
                }
              ]
            }
          ]
        }
      };
      return new Response(
        `data: ${JSON.stringify(eventPayload)}\n\ndata: [DONE]\n\n`,
        {
          status: 200,
          headers: { "content-type": "text/event-stream" }
        }
      );
    }
    return new Response(
      JSON.stringify({
        id: "resp_codex_ingest",
        status: "completed",
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  title: "Codex import",
                  summary: "Completed through Codex OAuth",
                  markdown: "# Codex import",
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
    const result = await provider.compile({
      apiKey: oauthAccessToken,
      profile: {
        provider: "openai-codex",
        baseUrl: "https://chatgpt.com/backend-api",
        model: "gpt-5.4-mini",
        systemPrompt: "",
        secretId: null,
        metadata: {}
      },
      input: {
        titleHint: "Codex OAuth import",
        rawText: "Example source text",
        binary: null,
        mimeType: "text/plain",
        parseStrategy: "auto"
      }
    });
    assert.equal(result?.summary, "Completed through Codex OAuth");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(capturedRequests.length, 1);
  const createRequest = capturedRequests[0];
  assert.equal(
    createRequest.url,
    "https://chatgpt.com/backend-api/codex/responses"
  );
  assert.equal(
    createRequest.headers.get("authorization"),
    `Bearer ${oauthAccessToken}`
  );
  assert.equal(
    createRequest.headers.get("chatgpt-account-id"),
    "acct_codex_456"
  );
  assert.equal(typeof createRequest.body.instructions, "string");
  assert.match(
    String(createRequest.body.instructions),
    /You convert user-provided source material/
  );
  assert.match(
    String(createRequest.body.instructions),
    /wiki page entities and structured operational entities/
  );
  assert.match(
    String(createRequest.body.instructions),
    /Do not leave durable people only as \[\[links\]\]/
  );
  assert.match(
    String(createRequest.body.instructions),
    /Coverage audit before output/
  );
  assert.match(
    String(createRequest.body.instructions),
    /important dated events/
  );
  assert.match(
    String(createRequest.body.instructions),
    /named spouse\/partner/
  );
  const input = createRequest.body.input as Array<{
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  assert.equal(input.length, 1);
  assert.equal(input[0].role, "user");
  assert.match(input[0].content?.[0]?.text ?? "", /Title hint/);
  assert.equal(createRequest.body.stream, true);
  assert.equal(createRequest.body.background, undefined);
  assert.equal(createRequest.body.store, false);
  assert.equal(createRequest.body.prompt_cache_retention, undefined);
  assert.equal(createRequest.body.prompt_cache_key, undefined);
});

test("OpenAI Codex text prompts read event-stream responses", async () => {
  const provider = new OpenAiResponsesProvider();
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | null = null;

  const jwtPayload = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_codex_text"
      }
    })
  ).toString("base64url");
  const oauthAccessToken = `header.${jwtPayload}.sig`;

  globalThis.fetch = (async (_request, init) => {
    capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    const eventPayload = {
      type: "response.output_text.done",
      text: "done"
    };
    return new Response(
      `data: ${JSON.stringify(eventPayload)}\n\ndata: [DONE]\n\n`,
      {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      }
    );
  }) as typeof fetch;

  try {
    const result = await provider.runText?.({
      apiKey: oauthAccessToken,
      profile: {
        provider: "openai-codex",
        baseUrl: "https://chatgpt.com/backend-api",
        model: "gpt-5.4-mini",
        systemPrompt: "",
        secretId: null,
        metadata: {}
      },
      systemPrompt: "Answer briefly.",
      prompt: "Say done."
    });
    assert.equal(result?.outputText, "done");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(capturedBody);
  assert.equal(capturedBody.stream, true);
  assert.equal(capturedBody.store, false);
  assert.equal(capturedBody.instructions, "Answer briefly.");
});
