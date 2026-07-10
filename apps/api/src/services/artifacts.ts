import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { z } from "zod";
import { getDatabase, resolveDataDir, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import { isEntityDeleted } from "../repositories/deleted-entities.js";
import {
  listEntityLinksForSources,
  replaceEntityLinksForSource,
  type EntityLinkRecord
} from "../repositories/entity-links.js";
import {
  recordEventLog,
  type EventLogInput
} from "../repositories/event-log.js";
import { listWikiLlmProfiles } from "../repositories/wiki-memory.js";
import type { LlmManager } from "../managers/platform/llm-manager.js";
import type { ActivitySource, CrudEntityType } from "../types.js";
import {
  ArtifactDecryptionError,
  decryptArtifactBytes,
  encryptArtifactBytes,
  safeContentProtectionFromEnvelope,
  verifyArtifactEncryptionRoundTrip,
  type ArtifactEncryptionEnvelope,
  type SafeArtifactContentProtection
} from "./artifact-encryption.js";

const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024;
const MAX_TEXT_EXTRACTION_CHARS = 80_000;
const MAX_LLM_CONTEXT_CHARS = 24_000;
const MAX_ZIP_ENTRY_COUNT = 5000;
const MAX_ZIP_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;
const MAX_ZIP_RATIO = 100;

const ALLOWED_EXTENSIONS = [
  "xlsx",
  "xlsm",
  "docx",
  "pptx",
  "pdf",
  "csv",
  "tsv",
  "txt",
  "md",
  "json",
  "yaml",
  "yml",
  "png",
  "jpg",
  "jpeg",
  "webp"
] as const;

const extensionToFormatFamily: Record<string, ArtifactFormatFamily> = {
  xlsx: "spreadsheet",
  xlsm: "spreadsheet",
  csv: "spreadsheet",
  tsv: "spreadsheet",
  docx: "document",
  pptx: "presentation",
  pdf: "pdf",
  txt: "text",
  md: "text",
  json: "structured_text",
  yaml: "structured_text",
  yml: "structured_text",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image"
};

export const artifactStateSchema = z.enum([
  "active",
  "quarantined",
  "blocked",
  "archived",
  "metadata_only"
]);
export const artifactDangerLevelSchema = z.enum([
  "low",
  "moderate",
  "high",
  "blocked"
]);
export const artifactDownloadPolicySchema = z.enum(["human_only", "disabled"]);
export const artifactFormatFamilySchema = z.enum([
  "spreadsheet",
  "document",
  "presentation",
  "pdf",
  "text",
  "structured_text",
  "image"
]);
export const artifactSourceKindSchema = z.enum([
  "upload",
  "agent_upload",
  "wiki_ingest",
  "external_reference",
  "manual"
]);
export const artifactContentProtectionModeSchema = z.enum([
  "plaintext",
  "password_encrypted"
]);

const trimmedString = z.string().trim();
const optionalTrimmedString = trimmedString.optional().default("");
const nullableId = trimmedString.nullable().optional().default(null);

export const entityLinkInputSchema = z.object({
  entityType: z.string().trim().min(1),
  entityId: z.string().trim().min(1),
  anchorKey: z.string().trim().optional().default(""),
  relationship: z.string().trim().optional().default("related")
});

export const artifactUploadContentProtectionSchema = z
  .union([
    z.object({
      mode: z.literal("plaintext").optional().default("plaintext")
    }),
    z.object({
      mode: z.literal("password_encrypted"),
      password: z.string().min(1),
      passwordHint: optionalTrimmedString
    })
  ])
  .optional();

export const artifactUploadSchema = z.object({
  title: trimmedString.optional(),
  shortDescription: optionalTrimmedString,
  description: optionalTrimmedString,
  originalFileName: trimmedString.min(1),
  declaredMimeType: optionalTrimmedString,
  contentBase64: z.string().min(1),
  sourceKind: artifactSourceKindSchema.optional(),
  sourceLabel: optionalTrimmedString,
  uploadedByUserId: nullableId,
  uploadedByAgentId: nullableId,
  actingForUserId: nullableId,
  downloadPolicy: artifactDownloadPolicySchema.optional().default("human_only"),
  links: z.array(entityLinkInputSchema).optional().default([]),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  contentProtection: artifactUploadContentProtectionSchema,
  useLlmEnrichment: z.boolean().optional().default(false),
  llmProfileId: z.string().trim().optional()
});

export const artifactMetadataCreateSchema = z.object({
  title: trimmedString.min(1),
  shortDescription: optionalTrimmedString,
  description: optionalTrimmedString,
  originalFileName: trimmedString.optional().default("metadata-only"),
  sourceKind: artifactSourceKindSchema.optional().default("manual"),
  sourceLabel: optionalTrimmedString,
  uploadedByUserId: nullableId,
  uploadedByAgentId: nullableId,
  actingForUserId: nullableId,
  links: z.array(entityLinkInputSchema).optional().default([]),
  metadata: z.record(z.string(), z.unknown()).optional().default({})
});

export const artifactMetadataPatchSchema = z.object({
  title: trimmedString.min(1).optional(),
  shortDescription: trimmedString.optional(),
  description: trimmedString.optional(),
  sourceLabel: trimmedString.optional(),
  artifactState: artifactStateSchema.optional(),
  downloadPolicy: artifactDownloadPolicySchema.optional(),
  links: z.array(entityLinkInputSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const artifactListQuerySchema = z.object({
  query: trimmedString.optional(),
  artifactState: artifactStateSchema.optional(),
  dangerLevel: artifactDangerLevelSchema.optional(),
  formatFamily: artifactFormatFamilySchema.optional(),
  linkedEntityType: z.string().trim().optional(),
  linkedEntityId: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0)
});

export const artifactTrustPatchSchema = z.object({
  artifactState: artifactStateSchema,
  reason: trimmedString.min(1),
  downloadPolicy: artifactDownloadPolicySchema.optional()
});

export const artifactEnrichmentRequestSchema = z.object({
  llmProfileId: z.string().trim().optional(),
  fillMissingOnly: z.boolean().optional().default(true),
  explicitApiKey: z.string().trim().optional()
});

export const artifactEncryptRequestSchema = z.object({
  password: z.string().min(1),
  passwordHint: optionalTrimmedString
});

export const artifactPasswordDownloadSchema = z.object({
  password: z.string().optional().default("")
});

export type ArtifactState = z.infer<typeof artifactStateSchema>;
export type ArtifactDangerLevel = z.infer<typeof artifactDangerLevelSchema>;
export type ArtifactFormatFamily = z.infer<typeof artifactFormatFamilySchema>;
export type ArtifactDownloadPolicy = z.infer<
  typeof artifactDownloadPolicySchema
>;
export type ArtifactSourceKind = z.infer<typeof artifactSourceKindSchema>;
export type ArtifactContentProtectionMode = z.infer<
  typeof artifactContentProtectionModeSchema
>;
export type ArtifactUploadInput = z.infer<typeof artifactUploadSchema>;
export type ArtifactMetadataPatchInput = z.infer<
  typeof artifactMetadataPatchSchema
>;
export type EntityLinkInput = z.infer<typeof entityLinkInputSchema>;

export type ArtifactFindingSeverity =
  | "info"
  | "low"
  | "moderate"
  | "high"
  | "blocked";

export type ArtifactScanFinding = {
  code: string;
  severity: ArtifactFindingSeverity;
  message: string;
};

export type ArtifactScanResult = {
  scannedAt: string;
  scannerVersion: string;
  declaredExtension: string;
  detectedMimeType: string;
  extensionAllowed: boolean;
  byteSize: number;
  findings: ArtifactScanFinding[];
  extractedTextSample: string;
  extractedTextTruncated: boolean;
};

export type EntityLink = {
  sourceEntityType: string;
  sourceEntityId: string;
  targetEntityType: string;
  targetEntityId: string;
  anchorKey: string | null;
  relationship: string;
  createdByActor: string | null;
  createdAt: string;
};

export type ArtifactAuditEvent = {
  id: string;
  artifactId: string;
  eventType: string;
  actor: string | null;
  source: ActivitySource;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ArtifactVersion = {
  id: string;
  artifactId: string;
  versionNumber: number;
  contentSha256: string;
  storageKey: string;
  byteSize: number;
  storedContentSha256: string;
  storedByteSize: number;
  contentProtection: SafeArtifactContentProtection;
  originalFileName: string;
  scanResults: Record<string, unknown>;
  enrichmentResults: Record<string, unknown>;
  createdByActor: string | null;
  createdAt: string;
};

export type Artifact = {
  id: string;
  title: string;
  shortDescription: string;
  description: string;
  originalFileName: string;
  storageKey: string;
  storagePath: string;
  contentSha256: string;
  byteSize: number;
  storedContentSha256: string;
  storedByteSize: number;
  contentProtection: SafeArtifactContentProtection;
  detectedExtension: string;
  declaredMimeType: string;
  detectedMimeType: string;
  formatFamily: ArtifactFormatFamily;
  sourceKind: ArtifactSourceKind;
  sourceLabel: string;
  uploadedByUserId: string | null;
  uploadedByAgentId: string | null;
  actingForUserId: string | null;
  artifactState: ArtifactState;
  dangerScore: number;
  dangerLevel: ArtifactDangerLevel;
  downloadPolicy: ArtifactDownloadPolicy;
  scanResults: ArtifactScanResult | Record<string, unknown>;
  enrichmentResults: Record<string, unknown>;
  metadata: Record<string, unknown>;
  links: EntityLink[];
  createdAt: string;
  updatedAt: string;
};

type ArtifactContext = {
  source: ActivitySource;
  actor?: string | null;
  token?: {
    agentId: string | null;
    agentLabel: string | null;
    trustLevel: string;
    scopes: string[];
  } | null;
};

type ArtifactRow = {
  id: string;
  title: string;
  short_description: string;
  description: string;
  original_file_name: string;
  storage_key: string;
  storage_path: string;
  content_sha256: string;
  byte_size: number;
  stored_content_sha256: string;
  stored_byte_size: number;
  content_protection_mode: ArtifactContentProtectionMode;
  content_encryption_json: string;
  encrypted_at: string | null;
  encrypted_by_actor: string | null;
  encrypted_source: string;
  content_password_hint: string;
  detected_extension: string;
  declared_mime_type: string;
  detected_mime_type: string;
  format_family: ArtifactFormatFamily;
  source_kind: ArtifactSourceKind;
  source_label: string;
  uploaded_by_user_id: string | null;
  uploaded_by_agent_id: string | null;
  acting_for_user_id: string | null;
  artifact_state: ArtifactState;
  danger_score: number;
  danger_level: ArtifactDangerLevel;
  download_policy: ArtifactDownloadPolicy;
  scan_results_json: string;
  enrichment_results_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type ArtifactVersionRow = {
  id: string;
  artifact_id: string;
  version_number: number;
  content_sha256: string;
  storage_key: string;
  byte_size: number;
  stored_content_sha256: string;
  stored_byte_size: number;
  content_protection_mode: ArtifactContentProtectionMode;
  content_encryption_json: string;
  encrypted_at: string | null;
  content_password_hint: string;
  original_file_name: string;
  scan_results_json: string;
  enrichment_results_json: string;
  created_by_actor: string | null;
  created_at: string;
};

type ArtifactAuditEventRow = {
  id: string;
  artifact_id: string;
  event_type: string;
  actor: string | null;
  source: ActivitySource;
  metadata_json: string;
  created_at: string;
};

type AdmZipEntryWithHeader = ReturnType<AdmZip["getEntries"]>[number] & {
  header?: {
    size?: number;
    compressedSize?: number;
  };
};

function nowIso() {
  return new Date().toISOString();
}

function artifactId() {
  return `artifact_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function artifactVersionId() {
  return `artifact_version_${randomUUID().replaceAll("-", "").slice(0, 14)}`;
}

function auditId() {
  return `artifact_audit_${randomUUID().replaceAll("-", "").slice(0, 14)}`;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function safeContentProtection(input: {
  mode: ArtifactContentProtectionMode;
  encryptedAt: string | null;
  encryptionJson: string;
  passwordHint: string;
}): SafeArtifactContentProtection {
  if (input.mode !== "password_encrypted") {
    return safeContentProtectionFromEnvelope({
      mode: "plaintext",
      encryptedAt: null,
      envelope: {},
      passwordHint: ""
    });
  }
  return safeContentProtectionFromEnvelope({
    mode: "password_encrypted",
    encryptedAt: input.encryptedAt,
    envelope: parseJsonObject(input.encryptionJson),
    passwordHint: input.passwordHint
  });
}

function sanitizeFileName(fileName: string) {
  return path
    .basename(fileName)
    .replace(/[^\w.\- ()[\]]+/g, "_")
    .slice(0, 180);
}

function extensionFromFileName(fileName: string) {
  return path
    .extname(sanitizeFileName(fileName))
    .replace(/^\./, "")
    .toLowerCase();
}

function formatFamilyForExtension(
  extension: string
): ArtifactFormatFamily | null {
  return extensionToFormatFamily[extension] ?? null;
}

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function detectMimeType(buffer: Buffer, extension: string) {
  if (buffer.subarray(0, 4).toString("utf8") === "%PDF") {
    return "application/pdf";
  }
  if (buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) {
    return "image/png";
  }
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return "image/jpeg";
  }
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.subarray(0, 2).toString("ascii") === "PK") {
    if (extension === "docx") {
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }
    if (extension === "pptx") {
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    }
    if (extension === "xlsx") {
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }
    if (extension === "xlsm") {
      return "application/vnd.ms-excel.sheet.macroEnabled.12";
    }
    return "application/zip";
  }
  if (extension === "json") {
    return "application/json";
  }
  if (extension === "csv") {
    return "text/csv";
  }
  if (extension === "tsv") {
    return "text/tab-separated-values";
  }
  if (extension === "md") {
    return "text/markdown";
  }
  if (extension === "yaml" || extension === "yml") {
    return "application/yaml";
  }
  return "text/plain";
}

function blobRoot() {
  return path.join(resolveDataDir(), "artifacts", "blobs");
}

function storageKeyForHash(hash: string) {
  return `sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.bin`;
}

function resolveStoragePath(storageKey: string) {
  const root = path.resolve(blobRoot());
  const resolved = path.resolve(root, storageKey);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Artifact storage key resolved outside the artifact root.");
  }
  return resolved;
}

async function ensureBlobStored(input: {
  contentSha256: string;
  plaintextByteSize: number;
  storedBuffer: Buffer;
  detectedMimeType: string;
  contentProtectionMode: ArtifactContentProtectionMode;
}) {
  const storedContentSha256 = sha256(input.storedBuffer);
  const storageKey = storageKeyForHash(storedContentSha256);
  const storagePath = resolveStoragePath(storageKey);
  const createdAt = nowIso();

  if (!existsSync(storagePath)) {
    await mkdir(path.dirname(storagePath), { recursive: true });
    const tmpPath = `${storagePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(tmpPath, input.storedBuffer, { flag: "wx" });
      await rename(tmpPath, storagePath);
    } catch (error) {
      await rm(tmpPath, { force: true }).catch(() => undefined);
      if (!existsSync(storagePath)) {
        throw error;
      }
    }
  }

  getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO artifact_blobs (
        content_sha256, storage_key, byte_size, detected_mime_type, created_at,
        stored_content_sha256, stored_byte_size, content_protection_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.contentSha256,
      storageKey,
      input.plaintextByteSize,
      input.detectedMimeType,
      createdAt,
      storedContentSha256,
      input.storedBuffer.byteLength,
      input.contentProtectionMode
    );

  return {
    contentSha256: input.contentSha256,
    storedContentSha256,
    storedByteSize: input.storedBuffer.byteLength,
    storageKey,
    storagePath
  };
}

function addFinding(
  findings: ArtifactScanFinding[],
  severity: ArtifactFindingSeverity,
  code: string,
  message: string
) {
  findings.push({ severity, code, message });
}

function severityScore(severity: ArtifactFindingSeverity) {
  switch (severity) {
    case "blocked":
      return 100;
    case "high":
      return 75;
    case "moderate":
      return 45;
    case "low":
      return 15;
    default:
      return 0;
  }
}

function computeDanger(findings: ArtifactScanFinding[]) {
  const score = Math.min(
    100,
    findings.reduce(
      (max, finding) => Math.max(max, severityScore(finding.severity)),
      0
    ) +
      Math.max(0, findings.length - 1) * 4
  );
  const level: ArtifactDangerLevel =
    score >= 90
      ? "blocked"
      : score >= 70
        ? "high"
        : score >= 35
          ? "moderate"
          : "low";
  return { score, level };
}

function safeUtf8(buffer: Buffer, limit = MAX_TEXT_EXTRACTION_CHARS) {
  return (
    buffer
      .subarray(0, limit)
      .toString("utf8")
      // Binary uploads can contain null bytes even after UTF-8 decoding.
      // eslint-disable-next-line no-control-regex
      .replace(/\u0000/g, "")
      .trim()
  );
}

function stripXml(xml: string) {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function zipEntryText(zip: AdmZip, name: string) {
  const entry = zip
    .getEntries()
    .find((candidate) => candidate.entryName === name);
  return entry ? entry.getData().toString("utf8") : "";
}

function extractOfficeText(zip: AdmZip, extension: string) {
  if (extension === "docx") {
    return stripXml(zipEntryText(zip, "word/document.xml")).slice(
      0,
      MAX_TEXT_EXTRACTION_CHARS
    );
  }
  if (extension === "pptx") {
    return zip
      .getEntries()
      .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.entryName))
      .map((entry) => stripXml(entry.getData().toString("utf8")))
      .join("\n")
      .slice(0, MAX_TEXT_EXTRACTION_CHARS);
  }
  if (extension === "xlsx" || extension === "xlsm") {
    const sharedStrings = stripXml(zipEntryText(zip, "xl/sharedStrings.xml"));
    const sheetText = zip
      .getEntries()
      .filter((entry) =>
        /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.entryName)
      )
      .slice(0, 5)
      .map((entry) => stripXml(entry.getData().toString("utf8")))
      .join("\n");
    return [sharedStrings, sheetText]
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_TEXT_EXTRACTION_CHARS);
  }
  return "";
}

function scanOfficeZip(
  buffer: Buffer,
  extension: string,
  findings: ArtifactScanFinding[]
) {
  let extractedTextSample = "";
  try {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries() as AdmZipEntryWithHeader[];
    const totalUncompressed = entries.reduce(
      (sum, entry) => sum + Math.max(0, entry.header?.size ?? 0),
      0
    );
    const totalCompressed = entries.reduce(
      (sum, entry) => sum + Math.max(1, entry.header?.compressedSize ?? 1),
      0
    );
    const ratio = totalUncompressed / Math.max(1, totalCompressed);

    if (entries.length > MAX_ZIP_ENTRY_COUNT) {
      addFinding(
        findings,
        "blocked",
        "zip_entry_limit",
        "The archive has too many entries for safe static inspection."
      );
    }
    if (
      totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES ||
      ratio > MAX_ZIP_RATIO
    ) {
      addFinding(
        findings,
        "blocked",
        "zip_bomb_indicator",
        "The archive has unsafe compressed-to-uncompressed size characteristics."
      );
    }
    if (entries.some((entry) => entry.entryName.endsWith("EncryptedPackage"))) {
      addFinding(
        findings,
        "high",
        "office_encrypted_package",
        "The Office document appears encrypted and cannot be inspected fully."
      );
    }
    if (entries.some((entry) => /vbaProject\.bin$/i.test(entry.entryName))) {
      addFinding(
        findings,
        extension === "xlsm" ? "high" : "blocked",
        "office_macro_project",
        "The Office document contains a VBA macro project."
      );
    }
    if (
      entries.some((entry) => /oleObject|embeddings\//i.test(entry.entryName))
    ) {
      addFinding(
        findings,
        "high",
        "office_embedded_object",
        "The Office document contains embedded objects or OLE payloads."
      );
    }
    const relationshipText = entries
      .filter((entry) => entry.entryName.endsWith(".rels"))
      .map((entry) => entry.getData().toString("utf8"))
      .join("\n");
    if (/TargetMode\s*=\s*["']External["']/i.test(relationshipText)) {
      addFinding(
        findings,
        "moderate",
        "office_external_relationship",
        "The Office document references external resources."
      );
    }
    if (extension === "xlsx" || extension === "xlsm") {
      const workbookXml = zipEntryText(zip, "xl/workbook.xml");
      if (/state\s*=\s*["'](?:hidden|veryHidden)["']/i.test(workbookXml)) {
        addFinding(
          findings,
          "moderate",
          "spreadsheet_hidden_sheet",
          "The workbook contains hidden sheets."
        );
      }
      if (
        entries.some((entry) => /^xl\/externalLinks\//.test(entry.entryName))
      ) {
        addFinding(
          findings,
          "moderate",
          "spreadsheet_external_link",
          "The workbook contains external workbook links."
        );
      }
      if (
        entries
          .filter((entry) =>
            /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.entryName)
          )
          .some((entry) => /<f(?:\s|>)/i.test(entry.getData().toString("utf8")))
      ) {
        addFinding(
          findings,
          "moderate",
          "spreadsheet_formulas",
          "The workbook contains formulas. Forge records this but does not evaluate them."
        );
      }
    }
    extractedTextSample = extractOfficeText(zip, extension);
  } catch {
    addFinding(
      findings,
      "high",
      "zip_parse_error",
      "The Office archive could not be parsed safely."
    );
  }
  return extractedTextSample;
}

function scanPdf(buffer: Buffer, findings: ArtifactScanFinding[]) {
  const text = buffer
    .subarray(0, Math.min(buffer.byteLength, 2_000_000))
    .toString("latin1");
  if (/\/JavaScript|\/JS\b/i.test(text)) {
    addFinding(
      findings,
      "high",
      "pdf_javascript",
      "The PDF contains JavaScript actions."
    );
  }
  if (/\/OpenAction|\/AA\b/i.test(text)) {
    addFinding(
      findings,
      "moderate",
      "pdf_auto_action",
      "The PDF contains automatic document actions."
    );
  }
  if (/\/EmbeddedFile|\/Filespec/i.test(text)) {
    addFinding(
      findings,
      "high",
      "pdf_embedded_file",
      "The PDF contains embedded file references."
    );
  }
  return (
    text
      // Keep printable ASCII plus tab and line endings for safe metadata samples.
      // eslint-disable-next-line no-control-regex
      .replace(/[^\x09\x0a\x0d\x20-\x7e]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TEXT_EXTRACTION_CHARS)
  );
}

function scanDelimitedText(text: string, findings: ArtifactScanFinding[]) {
  if (/^[=+\-@]/m.test(text) || /[,;\t][=+\-@]/.test(text)) {
    addFinding(
      findings,
      "moderate",
      "spreadsheet_formula_like_text",
      "The delimited text contains formula-like cells. Forge does not evaluate them."
    );
  }
}

function scanStructuredText(
  extension: string,
  text: string,
  findings: ArtifactScanFinding[]
) {
  if (extension === "json") {
    try {
      JSON.parse(text);
    } catch {
      addFinding(
        findings,
        "low",
        "json_parse_error",
        "The JSON file did not parse as valid JSON."
      );
    }
  }
}

export function scanArtifactBytes(input: {
  buffer: Buffer;
  originalFileName: string;
  declaredMimeType?: string;
}): {
  detectedExtension: string;
  detectedMimeType: string;
  formatFamily: ArtifactFormatFamily;
  scanResults: ArtifactScanResult;
  dangerScore: number;
  dangerLevel: ArtifactDangerLevel;
  artifactState: ArtifactState;
} {
  const detectedExtension = extensionFromFileName(input.originalFileName);
  const detectedMimeType = detectMimeType(input.buffer, detectedExtension);
  const formatFamily = formatFamilyForExtension(detectedExtension);
  const findings: ArtifactScanFinding[] = [];

  if (
    !formatFamily ||
    !(ALLOWED_EXTENSIONS as readonly string[]).includes(detectedExtension)
  ) {
    addFinding(
      findings,
      "blocked",
      "unsupported_extension",
      `Files with extension .${detectedExtension || "unknown"} are not allowed.`
    );
  }
  if (input.buffer.byteLength > MAX_ARTIFACT_BYTES) {
    addFinding(
      findings,
      "blocked",
      "size_limit_exceeded",
      "The file exceeds Forge's artifact size limit."
    );
  }
  if (
    input.declaredMimeType?.trim() &&
    input.declaredMimeType !== detectedMimeType
  ) {
    addFinding(
      findings,
      "low",
      "mime_mismatch",
      "The declared MIME type differs from static file detection."
    );
  }

  let extractedTextSample = "";
  if (
    formatFamily === "document" ||
    formatFamily === "presentation" ||
    formatFamily === "spreadsheet"
  ) {
    if (["docx", "pptx", "xlsx", "xlsm"].includes(detectedExtension)) {
      extractedTextSample = scanOfficeZip(
        input.buffer,
        detectedExtension,
        findings
      );
    } else {
      extractedTextSample = safeUtf8(input.buffer);
      scanDelimitedText(extractedTextSample, findings);
    }
  } else if (formatFamily === "pdf") {
    extractedTextSample = scanPdf(input.buffer, findings);
  } else if (formatFamily === "text" || formatFamily === "structured_text") {
    extractedTextSample = safeUtf8(input.buffer);
    scanDelimitedText(extractedTextSample, findings);
    scanStructuredText(detectedExtension, extractedTextSample, findings);
  }

  if (findings.length === 0) {
    addFinding(
      findings,
      "info",
      "static_scan_clean",
      "Static inspection found no configured danger signal."
    );
  }

  const danger = computeDanger(findings);
  const artifactState: ArtifactState =
    danger.level === "blocked"
      ? "blocked"
      : danger.level === "high"
        ? "quarantined"
        : "active";
  return {
    detectedExtension,
    detectedMimeType,
    formatFamily: formatFamily ?? "text",
    dangerScore: danger.score,
    dangerLevel: danger.level,
    artifactState,
    scanResults: {
      scannedAt: nowIso(),
      scannerVersion: "artifact-static-scan-v1",
      declaredExtension: detectedExtension,
      detectedMimeType,
      extensionAllowed: Boolean(formatFamily),
      byteSize: input.buffer.byteLength,
      findings,
      extractedTextSample: extractedTextSample.slice(0, MAX_LLM_CONTEXT_CHARS),
      extractedTextTruncated: extractedTextSample.length > MAX_LLM_CONTEXT_CHARS
    }
  };
}

function mapLink(row: EntityLinkRecord): EntityLink {
  return {
    sourceEntityType: row.sourceEntityType,
    sourceEntityId: row.sourceEntityId,
    targetEntityType: row.targetEntityType,
    targetEntityId: row.targetEntityId,
    anchorKey: row.anchorKey,
    relationship: row.relationship,
    createdByActor: row.createdByActor,
    createdAt: row.createdAt
  };
}

function mapArtifact(row: ArtifactRow, links: EntityLink[] = []): Artifact {
  return {
    id: row.id,
    title: row.title,
    shortDescription: row.short_description,
    description: row.description,
    originalFileName: row.original_file_name,
    storageKey: row.storage_key,
    storagePath: row.storage_path,
    contentSha256: row.content_sha256,
    byteSize: row.byte_size,
    storedContentSha256: row.stored_content_sha256 || row.content_sha256,
    storedByteSize: row.stored_byte_size || row.byte_size,
    contentProtection: safeContentProtection({
      mode: row.content_protection_mode,
      encryptedAt: row.encrypted_at,
      encryptionJson: row.content_encryption_json,
      passwordHint: row.content_password_hint
    }),
    detectedExtension: row.detected_extension,
    declaredMimeType: row.declared_mime_type,
    detectedMimeType: row.detected_mime_type,
    formatFamily: row.format_family,
    sourceKind: row.source_kind,
    sourceLabel: row.source_label,
    uploadedByUserId: row.uploaded_by_user_id,
    uploadedByAgentId: row.uploaded_by_agent_id,
    actingForUserId: row.acting_for_user_id,
    artifactState: row.artifact_state,
    dangerScore: row.danger_score,
    dangerLevel: row.danger_level,
    downloadPolicy: row.download_policy,
    scanResults: parseJsonObject(row.scan_results_json),
    enrichmentResults: parseJsonObject(row.enrichment_results_json),
    metadata: parseJsonObject(row.metadata_json),
    links,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const ARTIFACT_SELECT_COLUMNS = `id, title, short_description, description, original_file_name,
              storage_key, storage_path, content_sha256, byte_size,
              stored_content_sha256, stored_byte_size, content_protection_mode,
              content_encryption_json, encrypted_at, encrypted_by_actor,
              encrypted_source, content_password_hint,
              detected_extension, declared_mime_type, detected_mime_type,
              format_family, source_kind, source_label, uploaded_by_user_id,
              uploaded_by_agent_id, acting_for_user_id, artifact_state,
              danger_score, danger_level, download_policy, scan_results_json,
              enrichment_results_json, metadata_json, created_at, updated_at`;

function getArtifactRow(id: string): ArtifactRow | undefined {
  return getDatabase()
    .prepare(
      `SELECT ${ARTIFACT_SELECT_COLUMNS}
       FROM artifacts
       WHERE id = ?`
    )
    .get(id) as ArtifactRow | undefined;
}

function buildArtifactListWhere(
  parsed: z.infer<typeof artifactListQuerySchema>
): { sql: string; params: Array<string | number> } {
  const clauses = [
    `NOT EXISTS (
       SELECT 1
       FROM deleted_entities
       WHERE deleted_entities.entity_type = 'artifact'
         AND deleted_entities.entity_id = artifacts.id
     )`
  ];
  const params: Array<string | number> = [];

  if (parsed.artifactState) {
    clauses.push("artifacts.artifact_state = ?");
    params.push(parsed.artifactState);
  }
  if (parsed.dangerLevel) {
    clauses.push("artifacts.danger_level = ?");
    params.push(parsed.dangerLevel);
  }
  if (parsed.formatFamily) {
    clauses.push("artifacts.format_family = ?");
    params.push(parsed.formatFamily);
  }
  if (parsed.query) {
    const needle = `%${parsed.query.toLowerCase()}%`;
    clauses.push(`(
      LOWER(COALESCE(artifacts.title, '')) LIKE ?
      OR LOWER(COALESCE(artifacts.short_description, '')) LIKE ?
      OR LOWER(COALESCE(artifacts.description, '')) LIKE ?
      OR LOWER(COALESCE(artifacts.original_file_name, '')) LIKE ?
      OR LOWER(COALESCE(artifacts.source_label, '')) LIKE ?
      OR LOWER(COALESCE(artifacts.metadata_json, '')) LIKE ?
    )`);
    params.push(needle, needle, needle, needle, needle, needle);
  }
  if (parsed.linkedEntityType && parsed.linkedEntityId) {
    clauses.push(`EXISTS (
      SELECT 1
      FROM entity_links artifact_link_filter
      WHERE artifact_link_filter.source_entity_type = 'artifact'
        AND artifact_link_filter.source_entity_id = artifacts.id
        AND artifact_link_filter.target_entity_type = ?
        AND artifact_link_filter.target_entity_id = ?
    )`);
    params.push(parsed.linkedEntityType, parsed.linkedEntityId);
  }

  return { sql: clauses.join(" AND "), params };
}

function toEventMetadata(
  metadata: Record<string, unknown>
): NonNullable<EventLogInput["metadata"]> {
  const normalized: NonNullable<EventLogInput["metadata"]> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      normalized[key] = value;
      continue;
    }
    normalized[key] = JSON.stringify(value);
  }
  return normalized;
}

function recordArtifactAudit(
  artifactId: string,
  eventType: string,
  context: ArtifactContext,
  metadata: Record<string, unknown> = {}
) {
  const createdAt = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO artifact_audit_events (
        id, artifact_id, event_type, actor, source, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      auditId(),
      artifactId,
      eventType,
      context.actor ?? context.token?.agentLabel ?? null,
      context.source,
      JSON.stringify(metadata),
      createdAt
    );
  recordEventLog({
    eventKind: eventType,
    entityType: "artifact" as CrudEntityType,
    entityId: artifactId,
    actor: context.actor ?? context.token?.agentLabel ?? null,
    source: context.source,
    metadata: toEventMetadata(metadata)
  });
}

function replaceEntityLinksForArtifact(
  artifactId: string,
  links: EntityLinkInput[],
  context: ArtifactContext
) {
  replaceEntityLinksForSource({
    sourceEntityType: "artifact",
    sourceEntityId: artifactId,
    links,
    actor: context.actor ?? context.token?.agentLabel ?? null
  });
}

function insertArtifactVersion(input: {
  id?: string;
  artifactId: string;
  contentSha256: string;
  storageKey: string;
  byteSize: number;
  storedContentSha256: string;
  storedByteSize: number;
  contentProtectionMode: ArtifactContentProtectionMode;
  encryptionEnvelope?: ArtifactEncryptionEnvelope | null;
  encryptedAt?: string | null;
  passwordHint?: string;
  originalFileName: string;
  scanResults: Record<string, unknown>;
  enrichmentResults: Record<string, unknown>;
  context: ArtifactContext;
}) {
  const row = getDatabase()
    .prepare(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS nextVersion
       FROM artifact_versions
       WHERE artifact_id = ?`
    )
    .get(input.artifactId) as { nextVersion: number };
  getDatabase()
    .prepare(
      `INSERT INTO artifact_versions (
        id, artifact_id, version_number, content_sha256, storage_key, byte_size,
        stored_content_sha256, stored_byte_size, content_protection_mode,
        content_encryption_json, encrypted_at, content_password_hint,
        original_file_name, scan_results_json, enrichment_results_json,
        created_by_actor, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id ?? artifactVersionId(),
      input.artifactId,
      row.nextVersion,
      input.contentSha256,
      input.storageKey,
      input.byteSize,
      input.storedContentSha256,
      input.storedByteSize,
      input.contentProtectionMode,
      JSON.stringify(input.encryptionEnvelope ?? {}),
      input.encryptedAt ?? null,
      input.passwordHint ?? "",
      input.originalFileName,
      JSON.stringify(input.scanResults),
      JSON.stringify(input.enrichmentResults),
      input.context.actor ?? input.context.token?.agentLabel ?? null,
      nowIso()
    );
}

function deriveFallbackTitle(originalFileName: string) {
  const sanitized = sanitizeFileName(originalFileName);
  return (
    sanitized
      .replace(/\.[^.]+$/, "")
      .replace(/[_-]+/g, " ")
      .trim() || "Artifact"
  );
}

export async function createArtifactFromUpload(
  input: ArtifactUploadInput,
  context: ArtifactContext,
  services: { llm?: LlmManager } = {}
) {
  const parsed = artifactUploadSchema.parse(input);
  const buffer = Buffer.from(parsed.contentBase64, "base64");
  if (buffer.byteLength === 0) {
    throw new Error("Artifact upload content is empty or invalid base64.");
  }
  const requestedProtection = parsed.contentProtection;
  const encryptContent =
    requestedProtection?.mode === "password_encrypted";
  if (encryptContent && context.token) {
    throw new HttpError(
      403,
      "artifact_password_rejected_for_agent",
      "Artifact content passwords are accepted only from human operator flows.",
      { route: "/api/v1/artifacts" }
    );
  }
  const scan = scanArtifactBytes({
    buffer,
    originalFileName: parsed.originalFileName,
    declaredMimeType: parsed.declaredMimeType
  });
  const id = artifactId();
  const versionId = artifactVersionId();
  const createdAt = nowIso();
  const plaintextSha256 = sha256(buffer);
  let storedBuffer = buffer;
  let encryptionEnvelope: ArtifactEncryptionEnvelope | null = null;
  let encryptedAt: string | null = null;
  let passwordHint = "";
  let contentProtectionMode: ArtifactContentProtectionMode = "plaintext";
  if (encryptContent) {
    encryptedAt = createdAt;
    passwordHint = requestedProtection.passwordHint;
    const encrypted = await encryptArtifactBytes({
      plaintext: buffer,
      password: requestedProtection.password,
      originalFileName: sanitizeFileName(parsed.originalFileName),
      detectedMimeType: scan.detectedMimeType,
      artifactId: id,
      versionId,
      encryptedAt
    });
    const roundTripOk = await verifyArtifactEncryptionRoundTrip({
      ciphertext: encrypted.ciphertext,
      password: requestedProtection.password,
      envelope: encrypted.envelope,
      expectedPlaintextSha256: plaintextSha256,
      expectedPlaintextByteSize: buffer.byteLength
    });
    if (!roundTripOk) {
      encrypted.ciphertext.fill(0);
      throw new Error("Encrypted artifact verification failed.");
    }
    storedBuffer = encrypted.ciphertext;
    encryptionEnvelope = encrypted.envelope;
    contentProtectionMode = "password_encrypted";
  }
  const blob = await ensureBlobStored({
    contentSha256: plaintextSha256,
    plaintextByteSize: buffer.byteLength,
    storedBuffer,
    detectedMimeType: scan.detectedMimeType,
    contentProtectionMode
  });
  const sourceKind =
    parsed.sourceKind ??
    (context.source === "agent" ? "agent_upload" : "upload");
  const uploadedByAgentId =
    parsed.uploadedByAgentId ?? context.token?.agentId ?? null;
  const metadata = {
    ...parsed.metadata,
    safeHandling:
      "Forge stores and serves this file for human download only; it must not be executed by agents."
  };
  const initialEnrichment = {
    generated: false,
    status: parsed.useLlmEnrichment ? "pending" : "not_requested"
  };

  runInTransaction(() => {
    getDatabase()
      .prepare(
        `INSERT INTO artifacts (
          id, title, short_description, description, original_file_name,
          storage_key, storage_path, content_sha256, byte_size, detected_extension,
          stored_content_sha256, stored_byte_size, content_protection_mode,
          content_encryption_json, encrypted_at, encrypted_by_actor,
          encrypted_source, content_password_hint,
          declared_mime_type, detected_mime_type, format_family, source_kind,
          source_label, uploaded_by_user_id, uploaded_by_agent_id, acting_for_user_id,
          artifact_state, danger_score, danger_level, download_policy,
          scan_results_json, enrichment_results_json, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        parsed.title?.trim() || deriveFallbackTitle(parsed.originalFileName),
        parsed.shortDescription,
        parsed.description,
        sanitizeFileName(parsed.originalFileName),
        blob.storageKey,
        blob.storagePath,
        plaintextSha256,
        buffer.byteLength,
        scan.detectedExtension,
        blob.storedContentSha256,
        blob.storedByteSize,
        contentProtectionMode,
        JSON.stringify(encryptionEnvelope ?? {}),
        encryptedAt,
        encryptContent ? (context.actor ?? null) : null,
        encryptContent ? context.source : "",
        passwordHint,
        parsed.declaredMimeType,
        scan.detectedMimeType,
        scan.formatFamily,
        sourceKind,
        parsed.sourceLabel,
        parsed.uploadedByUserId,
        uploadedByAgentId,
        parsed.actingForUserId,
        scan.artifactState,
        scan.dangerScore,
        scan.dangerLevel,
        parsed.downloadPolicy,
        JSON.stringify(scan.scanResults),
        JSON.stringify(initialEnrichment),
        JSON.stringify(metadata),
        createdAt,
        createdAt
      );
    replaceEntityLinksForArtifact(id, parsed.links, context);
    insertArtifactVersion({
      id: versionId,
      artifactId: id,
      contentSha256: plaintextSha256,
      storageKey: blob.storageKey,
      byteSize: buffer.byteLength,
      storedContentSha256: blob.storedContentSha256,
      storedByteSize: blob.storedByteSize,
      contentProtectionMode,
      encryptionEnvelope,
      encryptedAt,
      passwordHint,
      originalFileName: sanitizeFileName(parsed.originalFileName),
      scanResults: scan.scanResults,
      enrichmentResults: initialEnrichment,
      context
    });
    recordArtifactAudit(id, "artifact.created", context, {
      contentSha256: plaintextSha256,
      storedContentSha256: blob.storedContentSha256,
      contentProtectionMode,
      encrypted: encryptContent,
      hasPasswordHint: passwordHint.length > 0,
      dangerScore: scan.dangerScore,
      dangerLevel: scan.dangerLevel,
      sourceKind
    });
  });
  if (storedBuffer !== buffer) {
    storedBuffer.fill(0);
  }
  buffer.fill(0);

  if (parsed.useLlmEnrichment) {
    await enrichArtifactWithLlm(
      id,
      {
        llmProfileId: parsed.llmProfileId,
        fillMissingOnly: true
      },
      context,
      services
    ).catch((error) => {
      runInTransaction(() => {
        updateArtifactEnrichment(id, {
          generated: false,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          generatedAt: nowIso()
        });
        recordArtifactAudit(id, "artifact.enrichment_failed", context, {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    });
  }

  return getArtifactById(id)!;
}

export function createArtifactMetadata(): never {
  throw new Error(
    "Use POST /api/v1/artifacts for artifact creation. Batch CRUD may search, link, update metadata, delete, and restore artifact records, but it must not create file artifacts."
  );
}

export function listArtifactsPage(
  input: z.input<typeof artifactListQuerySchema> = {}
) {
  const parsed = artifactListQuerySchema.parse(input);
  const where = buildArtifactListWhere(parsed);
  const totalRow = getDatabase()
    .prepare(`SELECT COUNT(*) AS total FROM artifacts WHERE ${where.sql}`)
    .get(...where.params) as { total: number } | undefined;
  const rows = getDatabase()
    .prepare(
      `SELECT ${ARTIFACT_SELECT_COLUMNS}
       FROM artifacts
       WHERE ${where.sql}
       ORDER BY updated_at DESC, id ASC
       LIMIT ? OFFSET ?`
    )
    .all(...where.params, parsed.limit, parsed.offset) as ArtifactRow[];
  const linksByArtifactId = new Map<string, EntityLink[]>();
  for (const linkRow of listEntityLinksForSources(
    "artifact",
    rows.map((row) => row.id)
  )) {
    const current = linksByArtifactId.get(linkRow.sourceEntityId) ?? [];
    current.push(mapLink(linkRow));
    linksByArtifactId.set(linkRow.sourceEntityId, current);
  }
  const artifacts = rows.map((row) =>
    mapArtifact(row, linksByArtifactId.get(row.id) ?? [])
  );
  const total = totalRow?.total ?? 0;
  return {
    artifacts,
    total,
    limit: parsed.limit,
    offset: parsed.offset,
    hasMore: parsed.offset + artifacts.length < total
  };
}

export function listArtifacts(
  input: z.input<typeof artifactListQuerySchema> = {}
) {
  return listArtifactsPage(input).artifacts;
}

export function getArtifactById(id: string): Artifact | undefined {
  if (isEntityDeleted("artifact", id)) {
    return undefined;
  }
  const row = getArtifactRow(id);
  if (!row) {
    return undefined;
  }
  return mapArtifact(
    row,
    listEntityLinksForSources("artifact", [id]).map(mapLink)
  );
}

export function updateArtifactMetadata(
  id: string,
  input: ArtifactMetadataPatchInput,
  context: ArtifactContext
) {
  const existing = getArtifactById(id);
  if (!existing) {
    return undefined;
  }
  const parsed = artifactMetadataPatchSchema.parse(input);
  const updatedAt = nowIso();
  const nextMetadata = parsed.metadata
    ? { ...existing.metadata, ...parsed.metadata }
    : existing.metadata;
  const nextLinks =
    parsed.links ??
    existing.links.map((link) => ({
      entityType: link.targetEntityType,
      entityId: link.targetEntityId,
      anchorKey: link.anchorKey ?? "",
      relationship: link.relationship
    }));

  runInTransaction(() => {
    getDatabase()
      .prepare(
        `UPDATE artifacts
         SET title = ?, short_description = ?, description = ?, source_label = ?,
             artifact_state = ?, download_policy = ?, metadata_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        parsed.title ?? existing.title,
        parsed.shortDescription ?? existing.shortDescription,
        parsed.description ?? existing.description,
        parsed.sourceLabel ?? existing.sourceLabel,
        parsed.artifactState ?? existing.artifactState,
        parsed.downloadPolicy ?? existing.downloadPolicy,
        JSON.stringify(nextMetadata),
        updatedAt,
        id
      );
    if (parsed.links) {
      replaceEntityLinksForArtifact(id, nextLinks, context);
    }
    recordArtifactAudit(id, "artifact.metadata_updated", context, {
      fields: Object.keys(parsed)
    });
  });
  return getArtifactById(id);
}

export function deleteArtifactMetadata(id: string, context: ArtifactContext) {
  const existing = getArtifactById(id);
  if (!existing) {
    return undefined;
  }
  runInTransaction(() => {
    replaceEntityLinksForSource({
      sourceEntityType: "artifact",
      sourceEntityId: id,
      links: [],
      actor: context.actor ?? context.token?.agentLabel ?? null
    });
    getDatabase().prepare("DELETE FROM artifacts WHERE id = ?").run(id);
    recordEventLog({
      eventKind: "artifact.metadata_deleted",
      entityType: "artifact" as CrudEntityType,
      entityId: id,
      actor: context.actor ?? context.token?.agentLabel ?? null,
      source: context.source,
      metadata: toEventMetadata({
        contentSha256: existing.contentSha256,
        storageKey: existing.storageKey,
        blobPreserved: true,
        entityLinksRemoved: true
      })
    });
  });
  return existing;
}

function parseArtifactEncryptionEnvelope(artifact: Artifact) {
  const row = getArtifactRow(artifact.id);
  if (!row) {
    return {};
  }
  return parseJsonObject(row.content_encryption_json);
}

export async function readArtifactDownload(id: string, password = "") {
  const artifact = getArtifactById(id);
  if (!artifact) {
    return null;
  }
  if (
    artifact.downloadPolicy !== "human_only" ||
    artifact.artifactState === "blocked"
  ) {
    throw new Error("This artifact is not downloadable in its current state.");
  }
  const storagePath = resolveStoragePath(artifact.storageKey);
  const storedBytes = await readFile(storagePath);
  if (artifact.contentProtection.mode === "password_encrypted") {
    if (!password.trim()) {
      throw new HttpError(
        409,
        "artifact_password_required",
        "This artifact is encrypted. Enter its password to download the file.",
        { artifactId: artifact.id }
      );
    }
    try {
      const decrypted = await decryptArtifactBytes({
        ciphertext: storedBytes,
        password,
        envelope: parseArtifactEncryptionEnvelope(artifact)
      });
      return {
        artifact,
        bytes: decrypted.plaintext
      };
    } catch (error) {
      if (error instanceof ArtifactDecryptionError) {
        throw new HttpError(
          403,
          "artifact_wrong_password",
          "The password did not decrypt this artifact.",
          { artifactId: artifact.id }
        );
      }
      throw error;
    }
  }
  return {
    artifact,
    bytes: storedBytes
  };
}

export async function encryptExistingArtifact(
  id: string,
  input: z.input<typeof artifactEncryptRequestSchema>,
  context: ArtifactContext
) {
  const artifact = getArtifactById(id);
  if (!artifact) {
    return undefined;
  }
  const parsed = artifactEncryptRequestSchema.parse(input);
  if (artifact.contentProtection.mode === "password_encrypted") {
    throw new HttpError(
      409,
      "artifact_already_encrypted",
      "This artifact is already password encrypted.",
      { artifactId: id }
    );
  }
  const storagePath = resolveStoragePath(artifact.storageKey);
  if (!existsSync(storagePath)) {
    runInTransaction(() => {
      recordArtifactAudit(id, "artifact.encryption_failed", context, {
        reason: "blob_missing",
        storageKey: artifact.storageKey
      });
    });
    throw new Error("Artifact blob is missing from local storage.");
  }
  const plaintext = await readFile(storagePath);
  const plaintextSha256 = sha256(plaintext);
  if (
    plaintext.byteLength !== artifact.byteSize ||
    plaintextSha256 !== artifact.contentSha256
  ) {
    plaintext.fill(0);
    throw new HttpError(
      409,
      "artifact_plaintext_identity_mismatch",
      "The stored artifact bytes no longer match the artifact metadata.",
      { artifactId: id }
    );
  }

  const latestVersion = getDatabase()
    .prepare(
      `SELECT id, storage_key
       FROM artifact_versions
       WHERE artifact_id = ?
       ORDER BY version_number DESC
       LIMIT 1`
    )
    .get(id) as { id: string; storage_key: string } | undefined;
  const encryptedAt = nowIso();
  const versionId = latestVersion?.id ?? artifactVersionId();
  const encrypted = await encryptArtifactBytes({
    plaintext,
    password: parsed.password,
    originalFileName: artifact.originalFileName,
    detectedMimeType: artifact.detectedMimeType,
    artifactId: id,
    versionId,
    encryptedAt
  });
  const roundTripOk = await verifyArtifactEncryptionRoundTrip({
    ciphertext: encrypted.ciphertext,
    password: parsed.password,
    envelope: encrypted.envelope,
    expectedPlaintextSha256: artifact.contentSha256,
    expectedPlaintextByteSize: artifact.byteSize
  });
  if (!roundTripOk) {
    plaintext.fill(0);
    encrypted.ciphertext.fill(0);
    throw new Error("Encrypted artifact verification failed.");
  }
  const blob = await ensureBlobStored({
    contentSha256: artifact.contentSha256,
    plaintextByteSize: artifact.byteSize,
    storedBuffer: encrypted.ciphertext,
    detectedMimeType: artifact.detectedMimeType,
    contentProtectionMode: "password_encrypted"
  });
  const retainedPlaintextReference = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM (
         SELECT storage_key FROM artifacts WHERE storage_key = ?
         UNION ALL
         SELECT storage_key FROM artifact_versions WHERE storage_key = ?
       )`
    )
    .get(artifact.storageKey, artifact.storageKey) as { count: number };

  runInTransaction(() => {
    getDatabase()
      .prepare(
        `UPDATE artifacts
         SET storage_key = ?, storage_path = ?, stored_content_sha256 = ?,
             stored_byte_size = ?, content_protection_mode = ?,
             content_encryption_json = ?, encrypted_at = ?,
             encrypted_by_actor = ?, encrypted_source = ?,
             content_password_hint = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        blob.storageKey,
        blob.storagePath,
        blob.storedContentSha256,
        blob.storedByteSize,
        "password_encrypted",
        JSON.stringify(encrypted.envelope),
        encryptedAt,
        context.actor ?? null,
        context.source,
        parsed.passwordHint,
        encryptedAt,
        id
      );
    if (latestVersion) {
      getDatabase()
        .prepare(
          `UPDATE artifact_versions
           SET storage_key = ?, stored_content_sha256 = ?, stored_byte_size = ?,
               content_protection_mode = ?, content_encryption_json = ?,
               encrypted_at = ?, content_password_hint = ?
           WHERE id = ?`
        )
        .run(
          blob.storageKey,
          blob.storedContentSha256,
          blob.storedByteSize,
          "password_encrypted",
          JSON.stringify(encrypted.envelope),
          encryptedAt,
          parsed.passwordHint,
          latestVersion.id
        );
    } else {
      insertArtifactVersion({
        id: versionId,
        artifactId: id,
        contentSha256: artifact.contentSha256,
        storageKey: blob.storageKey,
        byteSize: artifact.byteSize,
        storedContentSha256: blob.storedContentSha256,
        storedByteSize: blob.storedByteSize,
        contentProtectionMode: "password_encrypted",
        encryptionEnvelope: encrypted.envelope,
        encryptedAt,
        passwordHint: parsed.passwordHint,
        originalFileName: artifact.originalFileName,
        scanResults: artifact.scanResults,
        enrichmentResults: artifact.enrichmentResults,
        context
      });
    }
    recordArtifactAudit(id, "artifact.encrypted", context, {
      contentSha256: artifact.contentSha256,
      storedContentSha256: blob.storedContentSha256,
      plaintextBlobPreserved: true,
      plaintextBlobDeletionAttempted: false,
      plaintextBlobReferenceCountBeforeSwitch: retainedPlaintextReference.count,
      hasPasswordHint: parsed.passwordHint.length > 0
    });
  });
  plaintext.fill(0);
  encrypted.ciphertext.fill(0);
  return getArtifactById(id)!;
}

export async function rescanArtifact(id: string, context: ArtifactContext) {
  const artifact = getArtifactById(id);
  if (!artifact) {
    return undefined;
  }
  if (artifact.contentProtection.mode === "password_encrypted") {
    runInTransaction(() => {
      recordArtifactAudit(id, "artifact.scan_skipped", context, {
        reason: "content_encrypted",
        existingScanPreserved: true
      });
    });
    throw new HttpError(
      409,
      "artifact_content_encrypted",
      "Artifact content is encrypted. The existing scan result remains available; password-gated rescan is not implemented yet.",
      { artifactId: id }
    );
  }
  const storagePath = resolveStoragePath(artifact.storageKey);
  if (!existsSync(storagePath)) {
    runInTransaction(() => {
      recordArtifactAudit(id, "artifact.scan_failed", context, {
        reason: "blob_missing",
        storageKey: artifact.storageKey
      });
    });
    throw new Error("Artifact blob is missing from local storage.");
  }
  const buffer = await readFile(storagePath);
  const scan = scanArtifactBytes({
    buffer,
    originalFileName: artifact.originalFileName,
    declaredMimeType: artifact.declaredMimeType
  });
  const updatedAt = nowIso();
  runInTransaction(() => {
    getDatabase()
      .prepare(
        `UPDATE artifacts
         SET detected_extension = ?, detected_mime_type = ?, format_family = ?,
             artifact_state = ?, danger_score = ?, danger_level = ?,
             scan_results_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        scan.detectedExtension,
        scan.detectedMimeType,
        scan.formatFamily,
        scan.artifactState,
        scan.dangerScore,
        scan.dangerLevel,
        JSON.stringify(scan.scanResults),
        updatedAt,
        id
      );
    recordArtifactAudit(id, "artifact.scanned", context, {
      dangerScore: scan.dangerScore,
      dangerLevel: scan.dangerLevel
    });
  });
  return getArtifactById(id)!;
}

function updateArtifactEnrichment(
  id: string,
  enrichment: Record<string, unknown>
) {
  getDatabase()
    .prepare(
      `UPDATE artifacts
       SET enrichment_results_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(JSON.stringify(enrichment), nowIso(), id);
}

function extractJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return {};
  }
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function compactArtifactForPrompt(artifact: Artifact) {
  const scan = artifact.scanResults as ArtifactScanResult;
  const encrypted = artifact.contentProtection.mode === "password_encrypted";
  return {
    title: artifact.title,
    shortDescription: artifact.shortDescription,
    description: artifact.description,
    originalFileName: artifact.originalFileName,
    detectedExtension: artifact.detectedExtension,
    declaredMimeType: artifact.declaredMimeType,
    detectedMimeType: artifact.detectedMimeType,
    formatFamily: artifact.formatFamily,
    byteSize: artifact.byteSize,
    deterministicDangerScore: artifact.dangerScore,
    deterministicDangerLevel: artifact.dangerLevel,
    contentProtectionMode: artifact.contentProtection.mode,
    encryptedContent: encrypted,
    findings: Array.isArray(scan.findings) ? scan.findings : [],
    extractedTextSample:
      !encrypted && typeof scan.extractedTextSample === "string"
        ? scan.extractedTextSample.slice(0, MAX_LLM_CONTEXT_CHARS)
        : ""
  };
}

export async function enrichArtifactWithLlm(
  id: string,
  input: z.input<typeof artifactEnrichmentRequestSchema>,
  context: ArtifactContext,
  services: { llm?: LlmManager } = {}
) {
  const artifact = getArtifactById(id);
  if (!artifact) {
    return undefined;
  }
  const parsed = artifactEnrichmentRequestSchema.parse(input);
  const profile = parsed.llmProfileId
    ? listWikiLlmProfiles().find((entry) => entry.id === parsed.llmProfileId)
    : listWikiLlmProfiles().find((entry) => entry.enabled);

  if (!services.llm || !profile) {
    const enrichment = {
      generated: false,
      status: "skipped",
      reason: "No enabled LLM profile is connected.",
      generatedAt: nowIso()
    };
    runInTransaction(() => {
      updateArtifactEnrichment(id, enrichment);
      recordArtifactAudit(id, "artifact.enrichment_skipped", context, {
        reason: "no_llm_profile"
      });
    });
    return getArtifactById(id)!;
  }

  const prompt = [
    "You are enriching metadata for a Forge artifact store.",
    "Do not infer executable behavior and do not lower deterministic safety findings.",
    "Return only JSON with keys: title, shortDescription, description, documentType, keywords, suggestedForgeLinks, safetySummary, dangerReasons, dangerScoreAdjustment.",
    JSON.stringify(compactArtifactForPrompt(artifact), null, 2)
  ].join("\n\n");
  const result = await services.llm.runTextPrompt(
    profile,
    {
      explicitApiKey: parsed.explicitApiKey,
      systemPrompt:
        "You summarize stored files from static, non-executed text only. You never say a file is safe if deterministic scanning found risk.",
      prompt
    },
    (log) => {
      recordArtifactAudit(id, "artifact.enrichment_log", context, {
        level: log.level,
        message: log.message
      });
    }
  );
  const generated = extractJsonObject(result.outputText);
  const proposedScore =
    typeof generated.dangerScoreAdjustment === "number"
      ? generated.dangerScoreAdjustment
      : artifact.dangerScore;
  const nextDangerScore = Math.max(
    artifact.dangerScore,
    Math.min(100, proposedScore)
  );
  const enrichment = {
    generated: true,
    status: "completed",
    provider: profile.provider,
    model: profile.model,
    generatedAt: nowIso(),
    output: {
      ...generated,
      dangerScore: nextDangerScore,
      deterministicDangerScorePreserved: artifact.dangerScore
    }
  };
  const title =
    !parsed.fillMissingOnly || !artifact.title.trim()
      ? typeof generated.title === "string" && generated.title.trim()
        ? generated.title.trim()
        : artifact.title
      : artifact.title;
  const shortDescription =
    !parsed.fillMissingOnly || !artifact.shortDescription.trim()
      ? typeof generated.shortDescription === "string"
        ? generated.shortDescription.trim()
        : artifact.shortDescription
      : artifact.shortDescription;
  const description =
    !parsed.fillMissingOnly || !artifact.description.trim()
      ? typeof generated.description === "string"
        ? generated.description.trim()
        : artifact.description
      : artifact.description;

  runInTransaction(() => {
    getDatabase()
      .prepare(
        `UPDATE artifacts
         SET title = ?, short_description = ?, description = ?,
             danger_score = MAX(danger_score, ?), enrichment_results_json = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        title,
        shortDescription,
        description,
        nextDangerScore,
        JSON.stringify(enrichment),
        nowIso(),
        id
      );
    recordArtifactAudit(id, "artifact.enriched_with_llm", context, {
      provider: profile.provider,
      model: profile.model,
      dangerScore: nextDangerScore
    });
  });
  return getArtifactById(id)!;
}

export function replaceArtifactEntityLinks(
  id: string,
  links: EntityLinkInput[],
  context: ArtifactContext
) {
  const artifact = getArtifactById(id);
  if (!artifact) {
    return undefined;
  }
  runInTransaction(() => {
    replaceEntityLinksForArtifact(id, links, context);
    getDatabase()
      .prepare("UPDATE artifacts SET updated_at = ? WHERE id = ?")
      .run(nowIso(), id);
    recordArtifactAudit(id, "artifact.links_updated", context, {
      linkCount: links.length
    });
  });
  return getArtifactById(id)!;
}

export function patchArtifactTrust(
  id: string,
  input: z.input<typeof artifactTrustPatchSchema>,
  context: ArtifactContext
) {
  const artifact = getArtifactById(id);
  if (!artifact) {
    return undefined;
  }
  const parsed = artifactTrustPatchSchema.parse(input);
  getDatabase()
    .prepare(
      `UPDATE artifacts
       SET artifact_state = ?, download_policy = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      parsed.artifactState,
      parsed.downloadPolicy ?? artifact.downloadPolicy,
      nowIso(),
      id
    );
  recordArtifactAudit(id, "artifact.trust_state_updated", context, {
    from: artifact.artifactState,
    to: parsed.artifactState,
    reason: parsed.reason
  });
  return getArtifactById(id)!;
}

export function listArtifactVersions(id: string) {
  return getDatabase()
    .prepare(
      `SELECT id, artifact_id, version_number, content_sha256, storage_key,
              byte_size, stored_content_sha256, stored_byte_size,
              content_protection_mode, content_encryption_json, encrypted_at,
              content_password_hint, original_file_name, scan_results_json,
              enrichment_results_json, created_by_actor, created_at
       FROM artifact_versions
       WHERE artifact_id = ?
       ORDER BY version_number DESC`
    )
    .all(id)
    .map((row) => {
      const version = row as ArtifactVersionRow;
      return {
        id: version.id,
        artifactId: version.artifact_id,
        versionNumber: version.version_number,
        contentSha256: version.content_sha256,
        storageKey: version.storage_key,
        byteSize: version.byte_size,
        storedContentSha256:
          version.stored_content_sha256 || version.content_sha256,
        storedByteSize: version.stored_byte_size || version.byte_size,
        contentProtection: safeContentProtection({
          mode: version.content_protection_mode,
          encryptedAt: version.encrypted_at,
          encryptionJson: version.content_encryption_json,
          passwordHint: version.content_password_hint
        }),
        originalFileName: version.original_file_name,
        scanResults: parseJsonObject(version.scan_results_json),
        enrichmentResults: parseJsonObject(version.enrichment_results_json),
        createdByActor: version.created_by_actor,
        createdAt: version.created_at
      } satisfies ArtifactVersion;
    });
}

export function listArtifactAuditEvents(id: string) {
  return getDatabase()
    .prepare(
      `SELECT id, artifact_id, event_type, actor, source, metadata_json, created_at
       FROM artifact_audit_events
       WHERE artifact_id = ?
       ORDER BY created_at DESC`
    )
    .all(id)
    .map((row) => {
      const event = row as ArtifactAuditEventRow;
      return {
        id: event.id,
        artifactId: event.artifact_id,
        eventType: event.event_type,
        actor: event.actor,
        source: event.source,
        metadata: parseJsonObject(event.metadata_json),
        createdAt: event.created_at
      } satisfies ArtifactAuditEvent;
    });
}
