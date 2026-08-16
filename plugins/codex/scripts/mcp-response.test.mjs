import assert from "node:assert/strict";
import { test } from "node:test";
import {
  maybeStructuredContent,
  resolveMcpResponseLimits,
  toMcpContent
} from "./mcp-response.mjs";

test("small MCP responses pass through unchanged", () => {
  const result = {
    content: [{ type: "text", text: "wiki result" }],
    details: { ok: true, pageId: "note_123" }
  };
  const limits = {
    textContentLimitBytes: 1000,
    structuredContentLimitBytes: 1000
  };

  assert.deepEqual(toMcpContent(result, limits), [
    { type: "text", text: "wiki result" }
  ]);
  assert.deepEqual(
    maybeStructuredContent(result.details, limits),
    result.details
  );
});

test("large text content is replaced with a transport-safe diagnostic payload", () => {
  const result = {
    content: [{ type: "text", text: "x".repeat(200) }],
    details: { ok: true }
  };

  const content = toMcpContent(result, {
    textContentLimitBytes: 40,
    structuredContentLimitBytes: 1000
  });
  const parsed = JSON.parse(content[0].text);

  assert.equal(parsed.forgeMcpResponseTruncated, true);
  assert.equal(parsed.kind, "content");
  assert.equal(parsed.limitBytes, 40);
  assert.match(parsed.guidance, /Forge MCP bridge truncated/);
});

test("large structured content is compacted without throwing away tool content", () => {
  const details = {
    rows: Array.from({ length: 20 }, (_, index) => ({
      index,
      text: "x".repeat(20)
    }))
  };

  const structured = maybeStructuredContent(details, {
    textContentLimitBytes: 1000,
    structuredContentLimitBytes: 80
  });

  assert.equal(structured.forgeMcpResponseTruncated, true);
  assert.equal(structured.kind, "structuredContent");
  assert.equal(structured.limitBytes, 80);
  assert.match(structured.preview, /rows/);
});

test("response limits can be configured with environment variables", () => {
  assert.deepEqual(
    resolveMcpResponseLimits({
      FORGE_MCP_TEXT_CONTENT_LIMIT_BYTES: "123",
      FORGE_MCP_STRUCTURED_CONTENT_LIMIT_BYTES: "456"
    }),
    {
      textContentLimitBytes: 123,
      structuredContentLimitBytes: 456
    }
  );
});

test("Agent Message audio remains one native MCP audio block without JSON duplication", () => {
  const audio = Buffer.from("RIFF forge voice fixture", "utf8").toString("base64");
  const result = {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          artifactId: "artifact_voice_1",
          runtimeAudioUnderstanding: "runtime-dependent"
        })
      },
      { type: "audio", data: audio, mimeType: "audio/wav" }
    ],
    details: {
      artifactId: "artifact_voice_1",
      runtimeAudioUnderstanding: "runtime-dependent"
    }
  };

  const content = toMcpContent(result, {
    textContentLimitBytes: 10_000,
    structuredContentLimitBytes: 10_000
  });

  assert.deepEqual(content[1], {
    type: "audio",
    data: audio,
    mimeType: "audio/wav"
  });
  assert.equal(content.filter((item) => item.type === "audio").length, 1);
  assert.equal(content[0].text.includes(audio), false);
  assert.equal(JSON.stringify(maybeStructuredContent(result.details)).includes(audio), false);
});

test("invalid audio-shaped content is serialized as text instead of crossing the binary boundary", () => {
  const content = toMcpContent(
    {
      content: [{ type: "audio", data: "not-audio", mimeType: "text/plain" }]
    },
    { textContentLimitBytes: 10_000, structuredContentLimitBytes: 10_000 }
  );

  assert.equal(content[0].type, "text");
  assert.match(content[0].text, /text\/plain/);
});
