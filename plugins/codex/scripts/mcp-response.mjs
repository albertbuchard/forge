import process from "node:process";
import { TextDecoder, TextEncoder } from "node:util";

const DEFAULT_TEXT_CONTENT_LIMIT_BYTES = 1_500_000;
const DEFAULT_STRUCTURED_CONTENT_LIMIT_BYTES = 750_000;
const PREVIEW_BYTES = 24_000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function byteLength(value) {
  return encoder.encode(value).byteLength;
}

function safeStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return JSON.stringify(
      {
        error: "Forge MCP could not serialize this response.",
        reason: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    );
  }
}

function truncateUtf8(value, limitBytes) {
  const encoded = encoder.encode(value);
  if (encoded.byteLength <= limitBytes) {
    return value;
  }
  return decoder.decode(encoded.slice(0, Math.max(0, limitBytes)));
}

function normalizeLimit(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveMcpResponseLimits(env = process.env) {
  return {
    textContentLimitBytes: normalizeLimit(
      env.FORGE_MCP_TEXT_CONTENT_LIMIT_BYTES,
      DEFAULT_TEXT_CONTENT_LIMIT_BYTES
    ),
    structuredContentLimitBytes: normalizeLimit(
      env.FORGE_MCP_STRUCTURED_CONTENT_LIMIT_BYTES,
      DEFAULT_STRUCTURED_CONTENT_LIMIT_BYTES
    )
  };
}

export function createTruncatedMcpPayload({ kind, value, limitBytes }) {
  const serialized = typeof value === "string" ? value : safeStringify(value);
  return {
    forgeMcpResponseTruncated: true,
    kind,
    approximateBytes: byteLength(serialized),
    limitBytes,
    preview: truncateUtf8(serialized, Math.min(PREVIEW_BYTES, limitBytes)),
    guidance:
      "The Forge MCP bridge truncated this response before writing to stdio. Narrow the request, lower the limit, or fetch one specific wiki page/result."
  };
}

export function toMcpContent(result, limits = resolveMcpResponseLimits()) {
  const source =
    Array.isArray(result?.content) && result.content.length > 0
      ? result.content
      : [{ type: "text", text: safeStringify(result?.details ?? null) }];

  return source.map((item) => {
    if (
      item &&
      typeof item === "object" &&
      item.type === "audio" &&
      typeof item.data === "string" &&
      typeof item.mimeType === "string" &&
      item.data.length > 0 &&
      item.mimeType.startsWith("audio/")
    ) {
      return {
        type: "audio",
        data: item.data,
        mimeType: item.mimeType
      };
    }
    const text =
      item && typeof item === "object" && item.type === "text" && "text" in item
        ? typeof item.text === "string"
          ? item.text
          : safeStringify(item.text ?? null)
        : safeStringify(item);

    if (byteLength(text) <= limits.textContentLimitBytes) {
      return { type: "text", text };
    }

    return {
      type: "text",
      text: safeStringify(
        createTruncatedMcpPayload({
          kind: "content",
          value: text,
          limitBytes: limits.textContentLimitBytes
        })
      )
    };
  });
}

export function maybeStructuredContent(
  details,
  limits = resolveMcpResponseLimits()
) {
  if (typeof details !== "object" || details === null) {
    return undefined;
  }

  const serialized = safeStringify(details);
  if (byteLength(serialized) <= limits.structuredContentLimitBytes) {
    return details;
  }

  return createTruncatedMcpPayload({
    kind: "structuredContent",
    value: serialized,
    limitBytes: limits.structuredContentLimitBytes
  });
}
