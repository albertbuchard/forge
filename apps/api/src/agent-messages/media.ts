import { createHash } from "node:crypto";
import path from "node:path";
import { parseBuffer } from "music-metadata";
import { HttpError } from "../errors.js";
import {
  AGENT_MESSAGE_MAX_VOICE_BYTES,
  AGENT_MESSAGE_MAX_VOICE_DURATION_MS
} from "./types.js";

export const AGENT_MESSAGE_MEDIA_PARSER = "music-metadata";
export const AGENT_MESSAGE_MEDIA_PARSER_VERSION = "11.14.0";

const acceptedMedia = {
  m4a: { mimeType: "audio/mp4", containers: ["M4A", "M4A/M4P"] },
  aac: { mimeType: "audio/aac", containers: ["ADTS", "M4A", "M4A/M4P"] },
  mp3: { mimeType: "audio/mpeg", containers: ["MPEG", "MP3"] },
  wav: { mimeType: "audio/wav", containers: ["WAVE"] },
  webm: { mimeType: "audio/webm", containers: ["EBML/webm", "WebM"] },
  ogg: { mimeType: "audio/ogg", containers: ["Ogg"] }
} as const;

function extensionFromFileName(fileName: string) {
  return path.extname(path.basename(fileName)).replace(/^\./u, "").toLowerCase();
}

function signatureMatches(buffer: Buffer, extension: string) {
  if (extension === "wav") {
    return (
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WAVE"
    );
  }
  if (extension === "ogg") {
    return buffer.subarray(0, 4).toString("ascii") === "OggS";
  }
  if (extension === "webm") {
    return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  }
  if (extension === "m4a") {
    return buffer.subarray(4, 8).toString("ascii") === "ftyp";
  }
  if (extension === "aac") {
    return (
      buffer.subarray(4, 8).toString("ascii") === "ftyp" ||
      (buffer[0] === 0xff && ((buffer[1] ?? 0) & 0xf6) === 0xf0)
    );
  }
  if (extension === "mp3") {
    return (
      buffer.subarray(0, 3).toString("ascii") === "ID3" ||
      (buffer[0] === 0xff && ((buffer[1] ?? 0) & 0xe0) === 0xe0)
    );
  }
  return false;
}

export type VerifiedAgentMessageMedia = {
  extension: keyof typeof acceptedMedia;
  mimeType: string;
  container: string;
  codec: string;
  byteSize: number;
  contentSha256: string;
  durationMs: number;
  parserName: typeof AGENT_MESSAGE_MEDIA_PARSER;
  parserVersion: typeof AGENT_MESSAGE_MEDIA_PARSER_VERSION;
};

export async function verifyAgentMessageMedia(input: {
  buffer: Buffer;
  originalFileName: string;
  declaredMimeType: string;
  declaredDurationMs: number;
}): Promise<VerifiedAgentMessageMedia> {
  if (
    input.buffer.byteLength === 0 ||
    input.buffer.byteLength > AGENT_MESSAGE_MAX_VOICE_BYTES
  ) {
    throw new HttpError(
      413,
      "agent_message_voice_size_invalid",
      `Agent Message voice notes must contain 1 to ${AGENT_MESSAGE_MAX_VOICE_BYTES} bytes.`
    );
  }
  const extension = extensionFromFileName(input.originalFileName);
  const policy = acceptedMedia[extension as keyof typeof acceptedMedia];
  if (!policy || !signatureMatches(input.buffer, extension)) {
    throw new HttpError(
      400,
      "agent_message_voice_format_invalid",
      "The voice note does not have a supported audio extension and container signature."
    );
  }
  if (input.declaredMimeType.toLowerCase() !== policy.mimeType) {
    throw new HttpError(
      400,
      "agent_message_voice_mime_mismatch",
      `The declared MIME type must be ${policy.mimeType} for .${extension}.`
    );
  }

  let parsed: Awaited<ReturnType<typeof parseBuffer>>;
  try {
    parsed = await parseBuffer(
      input.buffer,
      { mimeType: policy.mimeType, size: input.buffer.byteLength },
      { duration: true, skipCovers: true }
    );
  } catch {
    throw new HttpError(
      400,
      "agent_message_voice_unverifiable",
      "Forge could not verify this audio container and duration."
    );
  }
  const seconds = parsed.format.duration;
  if (!Number.isFinite(seconds) || !seconds || seconds <= 0) {
    throw new HttpError(
      400,
      "agent_message_voice_duration_unverifiable",
      "Forge could not verify a finite positive voice-note duration."
    );
  }
  const durationMs = Math.round(seconds * 1000);
  if (durationMs > AGENT_MESSAGE_MAX_VOICE_DURATION_MS) {
    throw new HttpError(
      413,
      "agent_message_voice_duration_exceeded",
      "Agent Message voice notes may not exceed ten minutes.",
      { maxDurationMs: AGENT_MESSAGE_MAX_VOICE_DURATION_MS, durationMs }
    );
  }
  const container = parsed.format.container ?? "";
  const codec = parsed.format.codec ?? parsed.format.codecProfile ?? "";
  const containerAccepted = policy.containers.some((candidate) =>
    container.toLowerCase().includes(candidate.toLowerCase())
  );
  if (!containerAccepted || !codec.trim()) {
    throw new HttpError(
      400,
      "agent_message_voice_codec_invalid",
      "Forge did not detect a supported audio container and codec."
    );
  }
  return {
    extension: extension as keyof typeof acceptedMedia,
    mimeType: policy.mimeType,
    container,
    codec,
    byteSize: input.buffer.byteLength,
    contentSha256: createHash("sha256").update(input.buffer).digest("hex"),
    durationMs,
    parserName: AGENT_MESSAGE_MEDIA_PARSER,
    parserVersion: AGENT_MESSAGE_MEDIA_PARSER_VERSION
  };
}
