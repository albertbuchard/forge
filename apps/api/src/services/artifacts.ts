import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  link,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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
  getEntityOwnerId,
  setEntityOwner
} from "../repositories/entity-ownership.js";
import {
  recordEventLog,
  type EventLogInput
} from "../repositories/event-log.js";
import { resolveUserForMutation } from "../repositories/users.js";
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

export const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024;
const MAX_TEXT_EXTRACTION_CHARS = 80_000;
const MAX_LLM_CONTEXT_CHARS = 24_000;
const MAX_ZIP_ENTRY_COUNT = 5000;
const MAX_ZIP_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;
const MAX_ZIP_RATIO = 100;
const MAX_PENDING_ARTIFACT_BLOB_CLEANUPS = 25;

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

export const artifactIdempotencyKeySchema = trimmedString
  .min(8)
  .max(200)
  .regex(
    /^[A-Za-z0-9._:-]+$/,
    "Idempotency keys may contain letters, numbers, dots, underscores, colons, and hyphens."
  );

export const MAX_ARTIFACT_ENTITY_LINKS = 100;
export const DEFAULT_ARTIFACT_HISTORY_LIMIT = 50;
export const MAX_ARTIFACT_HISTORY_LIMIT = 100;

export const entityLinkInputSchema = z.object({
  entityType: z.string().trim().min(1).max(64),
  entityId: z.string().trim().min(1).max(512),
  anchorKey: z.string().trim().max(256).optional().default(""),
  relationship: z.string().trim().max(64).optional().default("related")
});

const artifactEntityLinksSchema = z
  .array(entityLinkInputSchema)
  .max(MAX_ARTIFACT_ENTITY_LINKS);

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
  idempotencyKey: artifactIdempotencyKeySchema.optional(),
  title: trimmedString.optional(),
  shortDescription: optionalTrimmedString,
  description: optionalTrimmedString,
  originalFileName: trimmedString.min(1),
  declaredMimeType: optionalTrimmedString,
  contentBase64: z.string(),
  sourceKind: artifactSourceKindSchema.optional(),
  sourceLabel: optionalTrimmedString,
  uploadedByUserId: nullableId,
  uploadedByAgentId: nullableId,
  actingForUserId: nullableId,
  downloadPolicy: artifactDownloadPolicySchema.optional().default("human_only"),
  links: artifactEntityLinksSchema.optional().default([]),
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
  links: artifactEntityLinksSchema.optional().default([]),
  metadata: z.record(z.string(), z.unknown()).optional().default({})
});

export const artifactMetadataPatchSchema = z.object({
  title: trimmedString.min(1).optional(),
  shortDescription: trimmedString.optional(),
  description: trimmedString.optional(),
  sourceLabel: trimmedString.optional(),
  links: artifactEntityLinksSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const artifactHistoryQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_ARTIFACT_HISTORY_LIMIT)
    .optional()
    .default(DEFAULT_ARTIFACT_HISTORY_LIMIT),
  offset: z.coerce.number().int().min(0).optional().default(0)
});

export const artifactListQuerySchema = z.object({
  query: trimmedString.max(200).optional(),
  artifactState: artifactStateSchema.optional(),
  dangerLevel: artifactDangerLevelSchema.optional(),
  formatFamily: artifactFormatFamilySchema.optional(),
  linkedEntityType: z.string().trim().optional(),
  linkedEntityId: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(100),
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
  extractedTextAvailable: boolean;
  extractedTextTruncated: boolean;
};

type InternalArtifactScanResult = Omit<
  ArtifactScanResult,
  "extractedTextAvailable"
> & {
  extractedTextSample: string;
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
  scanResults: Record<string, unknown>;
  enrichmentResults: Record<string, unknown>;
  metadata: Record<string, unknown>;
  links: EntityLink[];
  createdAt: string;
  updatedAt: string;
};

export type ArtifactSummary = Pick<
  Artifact,
  | "id"
  | "title"
  | "shortDescription"
  | "originalFileName"
  | "byteSize"
  | "contentProtection"
  | "detectedExtension"
  | "formatFamily"
  | "sourceKind"
  | "sourceLabel"
  | "artifactState"
  | "dangerScore"
  | "dangerLevel"
  | "downloadPolicy"
  | "links"
  | "createdAt"
  | "updatedAt"
>;

export type ArtifactContext = {
  source: ActivitySource;
  actor?: string | null;
  userIds?: readonly string[];
  projectIds?: readonly string[];
  tagIds?: readonly string[];
  token?: {
    id: string;
    agentId: string | null;
    agentLabel: string | null;
    trustLevel: string;
    scopes: string[];
    scopePolicy?: {
      userIds: string[];
      projectIds: string[];
      tagIds: string[];
    };
  } | null;
};

type ArtifactScope = {
  userIds: readonly string[];
  projectIds: readonly string[];
  tagIds: readonly string[];
};

function artifactScope(context?: ArtifactContext): ArtifactScope {
  const tokenScope = context?.token?.scopePolicy;
  return {
    userIds: tokenScope?.userIds ?? context?.userIds ?? [],
    projectIds: tokenScope?.projectIds ?? context?.projectIds ?? [],
    tagIds: tokenScope?.tagIds ?? context?.tagIds ?? []
  };
}

function artifactHasExactLinkScope(
  artifactId: string,
  entityType: "project" | "tag",
  allowedIds: readonly string[]
) {
  if (allowedIds.length === 0) {
    return true;
  }
  const placeholders = allowedIds.map(() => "?").join(", ");
  const allowedLink = getDatabase()
    .prepare(
      `SELECT 1
       FROM entity_links
       WHERE source_entity_type = 'artifact'
         AND source_entity_id = ?
         AND target_entity_type = ?
         AND target_entity_id IN (${placeholders})
       LIMIT 1`
    )
    .get(artifactId, entityType, ...allowedIds);
  if (!allowedLink) {
    return false;
  }
  const disallowedLink = getDatabase()
    .prepare(
      `SELECT 1
       FROM entity_links
       WHERE source_entity_type = 'artifact'
         AND source_entity_id = ?
         AND target_entity_type = ?
         AND target_entity_id NOT IN (${placeholders})
       LIMIT 1`
    )
    .get(artifactId, entityType, ...allowedIds);
  return !disallowedLink;
}

export function canAccessArtifact(
  artifactId: string,
  context: ArtifactContext
): boolean {
  const scope = artifactScope(context);
  if (scope.userIds.length > 0) {
    const ownerUserId = getEntityOwnerId("artifact", artifactId);
    if (ownerUserId === null || !scope.userIds.includes(ownerUserId)) {
      return false;
    }
  }
  return (
    artifactHasExactLinkScope(artifactId, "project", scope.projectIds) &&
    artifactHasExactLinkScope(artifactId, "tag", scope.tagIds)
  );
}

const ARTIFACT_FAILURE_CODE = "artifact_llm_enrichment_failed";

function isStableArtifactFailureCode(value: unknown): value is string {
  return (
    typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(value)
  );
}

function isSensitiveArtifactMetadata(key: string, value: unknown): boolean {
  const normalizedKey = key.replaceAll(/[^a-z]/gi, "").toLowerCase();
  if (
    [
      "storagepath",
      "storagekey",
      "blobpath",
      "blobkey",
      "filepath",
      "temporarypath",
      "temppath",
      "responsebody",
      "rawresponsebody",
      "rawproviderbody",
      "rawprovideroutput",
      "providerresponsebody"
    ].includes(normalizedKey)
  ) {
    return true;
  }
  return (
    normalizedKey.endsWith("path") &&
    typeof value === "string" &&
    path.isAbsolute(value)
  );
}

function isRawArtifactFailureKey(normalizedKey: string) {
  return [
    "error",
    "errormessage",
    "errorcontext",
    "errordetail",
    "errordetails",
    "rawerrorcontext",
    "providererror",
    "providerexception",
    "providercontext",
    "providerresponse",
    "providerresponsebody",
    "providerdetails",
    "exception",
    "stack",
    "stacktrace",
    "cause",
    "responsebody",
    "rawresponsebody",
    "rawproviderbody",
    "rawprovideroutput"
  ].includes(normalizedKey);
}

function redactArtifactPublicValue(
  value: unknown,
  insideFailureContext = false
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      redactArtifactPublicValue(entry, insideFailureContext)
    );
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const source = value as Record<string, unknown>;
  const redacted: Record<string, unknown> = {};
  let extractedTextAvailable = source.extractedTextAvailable === true;
  let hasExtractedTextField = "extractedTextAvailable" in source;
  let failureContextRedacted = false;
  const operationError =
    source.ok === false &&
    typeof source.entityType === "string" &&
    source.error !== null &&
    typeof source.error === "object" &&
    isStableArtifactFailureCode((source.error as Record<string, unknown>).code);
  const objectIsFailureContext =
    insideFailureContext ||
    source.status === "failed" ||
    Object.keys(source).some((key) =>
      isRawArtifactFailureKey(key.replaceAll(/[^a-z]/gi, "").toLowerCase())
    );
  for (const [key, entry] of Object.entries(source)) {
    const normalizedKey = key.replaceAll(/[^a-z]/gi, "").toLowerCase();
    if (normalizedKey === "error" && operationError) {
      redacted[key] = redactArtifactPublicValue(entry);
      continue;
    }
    if (normalizedKey === "extractedtextsample") {
      hasExtractedTextField = true;
      extractedTextAvailable =
        extractedTextAvailable ||
        (typeof entry === "string" && entry.length > 0);
      continue;
    }
    if (
      isRawArtifactFailureKey(normalizedKey) ||
      (objectIsFailureContext &&
        [
          "message",
          "detail",
          "details",
          "body",
          "response",
          "context"
        ].includes(normalizedKey))
    ) {
      failureContextRedacted = true;
      continue;
    }
    if (
      normalizedKey === "extractedtextavailable" ||
      isSensitiveArtifactMetadata(key, entry)
    ) {
      continue;
    }
    redacted[key] = redactArtifactPublicValue(entry, objectIsFailureContext);
  }
  if (hasExtractedTextField) {
    redacted.extractedTextAvailable = extractedTextAvailable;
  }
  if (failureContextRedacted) {
    redacted.errorCode = ARTIFACT_FAILURE_CODE;
  } else if (
    source.status === "failed" &&
    !isStableArtifactFailureCode(redacted.errorCode)
  ) {
    redacted.errorCode = ARTIFACT_FAILURE_CODE;
  }
  return redacted;
}

export function serializeArtifactPublicPayload<T>(value: T): T {
  return redactArtifactPublicValue(value) as T;
}

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

type BlobIntegrityMismatch = {
  expectedStoredByteSize: number;
  actualStoredByteSize: number | null;
  expectedStoredContentSha256: string;
  actualStoredContentSha256: string | null;
};

type ArtifactBlobReadPhase =
  | "reuse"
  | "replay"
  | "download"
  | "ticket_import"
  | "enrichment"
  | "encryption"
  | "scan";

function detectBlobIntegrityMismatch(
  bytes: Buffer,
  expectedStoredByteSize: number,
  expectedStoredContentSha256: string
): BlobIntegrityMismatch | null {
  const actualStoredContentSha256 = sha256(bytes);
  if (
    bytes.byteLength === expectedStoredByteSize &&
    actualStoredContentSha256 === expectedStoredContentSha256
  ) {
    return null;
  }
  return {
    expectedStoredByteSize,
    actualStoredByteSize: bytes.byteLength,
    expectedStoredContentSha256,
    actualStoredContentSha256
  };
}

function blockArtifactsForBlobIntegrityMismatch(input: {
  storageKey: string;
  phase: ArtifactBlobReadPhase;
  mismatch: BlobIntegrityMismatch;
  context: ArtifactContext;
}) {
  const affected = getDatabase()
    .prepare(
      `SELECT id, artifact_state
       FROM artifacts
       WHERE storage_key = ?`
    )
    .all(input.storageKey) as Array<{
    id: string;
    artifact_state: ArtifactState;
  }>;
  const metadata = {
    phase: input.phase,
    ...input.mismatch,
    artifactDataPreserved: true,
    deletionAttempted: false
  };

  runInTransaction(() => {
    const updatedAt = nowIso();
    for (const artifact of affected) {
      getDatabase()
        .prepare(
          `UPDATE artifacts
           SET artifact_state = 'blocked', updated_at = ?
           WHERE id = ?`
        )
        .run(updatedAt, artifact.id);
      recordArtifactAudit(
        artifact.id,
        "artifact.blob_integrity_mismatch",
        input.context,
        {
          ...metadata,
          previousArtifactState: artifact.artifact_state,
          blockedArtifactState: "blocked"
        }
      );
    }
    if (affected.length === 0) {
      recordEventLog({
        eventKind: "artifact.blob_integrity_mismatch",
        entityType: "artifact" as CrudEntityType,
        entityId: `blob:${input.mismatch.expectedStoredContentSha256}`,
        actor: input.context.actor ?? input.context.token?.agentLabel ?? null,
        source: input.context.source,
        metadata: toEventMetadata(metadata)
      });
    }
  });
}

function throwBlobIntegrityMismatch(input: {
  storageKey: string;
  phase: ArtifactBlobReadPhase;
  mismatch: BlobIntegrityMismatch;
  context: ArtifactContext;
}): never {
  blockArtifactsForBlobIntegrityMismatch(input);
  throw new HttpError(
    409,
    "artifact_blob_integrity_mismatch",
    "Stored artifact bytes do not match their recorded size and SHA-256. The data was preserved and referenced artifacts were blocked.",
    {
      phase: input.phase,
      ...input.mismatch,
      artifactDataPreserved: true
    }
  );
}

async function readVerifiedStoredBlob(input: {
  storageKey: string;
  expectedStoredByteSize: number;
  expectedStoredContentSha256: string;
  phase: ArtifactBlobReadPhase;
  context: ArtifactContext;
}) {
  const storagePath = resolveStoragePath(input.storageKey);
  let bytes: Buffer;
  try {
    bytes = await readFile(storagePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    throwBlobIntegrityMismatch({
      storageKey: input.storageKey,
      phase: input.phase,
      context: input.context,
      mismatch: {
        expectedStoredByteSize: input.expectedStoredByteSize,
        actualStoredByteSize: null,
        expectedStoredContentSha256: input.expectedStoredContentSha256,
        actualStoredContentSha256: null
      }
    });
  }
  const mismatch = detectBlobIntegrityMismatch(
    bytes,
    input.expectedStoredByteSize,
    input.expectedStoredContentSha256
  );
  if (mismatch) {
    throwBlobIntegrityMismatch({
      storageKey: input.storageKey,
      phase: input.phase,
      mismatch,
      context: input.context
    });
  }
  return bytes;
}

function verifyPlaintextIdentityOrThrow(
  artifact: Artifact,
  plaintext: Buffer,
  context: ArtifactContext
) {
  const actualContentSha256 = sha256(plaintext);
  if (
    plaintext.byteLength === artifact.byteSize &&
    actualContentSha256 === artifact.contentSha256
  ) {
    return;
  }
  const metadata = {
    expectedByteSize: artifact.byteSize,
    actualByteSize: plaintext.byteLength,
    expectedContentSha256: artifact.contentSha256,
    actualContentSha256,
    previousArtifactState: artifact.artifactState,
    blockedArtifactState: "blocked",
    artifactDataPreserved: true,
    deletionAttempted: false
  };
  plaintext.fill(0);
  runInTransaction(() => {
    getDatabase()
      .prepare(
        `UPDATE artifacts
         SET artifact_state = 'blocked', updated_at = ?
         WHERE id = ?`
      )
      .run(nowIso(), artifact.id);
    recordArtifactAudit(
      artifact.id,
      "artifact.plaintext_identity_mismatch",
      context,
      metadata
    );
  });
  throw new HttpError(
    409,
    "artifact_plaintext_identity_mismatch",
    "The plaintext artifact bytes do not match their recorded size and SHA-256. The data was preserved and the artifact was blocked.",
    { artifactId: artifact.id, ...metadata }
  );
}

type ArtifactServiceDependencies = {
  llm?: LlmManager;
  removeArtifactUploadFile?: (storagePath: string) => Promise<void>;
  removeEncryptedUploadFile?: (storagePath: string) => Promise<void>;
  beforeArtifactMetadataCommit?: (input: {
    artifactId: string;
    cleanupId: string;
  }) => void;
};

type PendingArtifactBlobCleanup = {
  id: string;
  artifactId: string;
  contentSha256: string;
  storageKey: string;
  storedContentSha256: string;
  storedByteSize: number;
  blobCreatedByOperation: boolean;
};

type StoredArtifactBlob = PendingArtifactBlobCleanup & {
  storagePath: string;
  plaintextByteSize: number;
  detectedMimeType: string;
  contentProtectionMode: ArtifactContentProtectionMode;
  createdAt: string;
  releaseLock: () => Promise<void>;
};

const ARTIFACT_BLOB_LOCK_WAIT_MS = 25;
const ARTIFACT_BLOB_LOCK_TIMEOUT_MS = 60_000;
const ARTIFACT_BLOB_LOCK_OWNER_GRACE_MS = 2_000;

type ArtifactBlobLockOwner = {
  pid: number;
  hostname: string;
  acquiredAt: string;
};

function artifactBlobLockPath(storageKey: string) {
  const lockId = sha256(Buffer.from(storageKey, "utf8")).slice(0, 32);
  return path.join(resolveDataDir(), "artifacts", "locks", `${lockId}.lock`);
}

function processIsAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function removeStaleArtifactBlobLock(lockPath: string) {
  const ownerPath = path.join(lockPath, "owner.json");
  let owner: ArtifactBlobLockOwner | null = null;
  try {
    owner = JSON.parse(
      await readFile(ownerPath, "utf8")
    ) as ArtifactBlobLockOwner;
  } catch {
    // A new owner may still be writing owner.json. The age guard handles it.
  }
  const lockStat = await stat(lockPath).catch(() => null);
  if (
    !lockStat ||
    Date.now() - lockStat.mtimeMs < ARTIFACT_BLOB_LOCK_OWNER_GRACE_MS
  ) {
    return false;
  }
  if (owner && (owner.hostname !== hostname() || processIsAlive(owner.pid))) {
    return false;
  }
  const stalePath = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
  try {
    await rename(lockPath, stalePath);
  } catch (error) {
    if (
      ["ENOENT", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")
    ) {
      return false;
    }
    throw error;
  }
  await rm(stalePath, { recursive: true, force: true });
  return true;
}

async function acquireArtifactBlobLock(storageKey: string) {
  const lockPath = artifactBlobLockPath(storageKey);
  await mkdir(path.dirname(lockPath), { recursive: true });
  const startedAt = Date.now();
  while (true) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      if (await removeStaleArtifactBlobLock(lockPath)) {
        continue;
      }
      if (Date.now() - startedAt >= ARTIFACT_BLOB_LOCK_TIMEOUT_MS) {
        throw new HttpError(
          503,
          "artifact_blob_lock_timeout",
          "Artifact storage is busy. Retry this operation with the same idempotency key."
        );
      }
      await delay(ARTIFACT_BLOB_LOCK_WAIT_MS);
    }
  }
  try {
    await writeFile(
      path.join(lockPath, "owner.json"),
      JSON.stringify({
        pid: process.pid,
        hostname: hostname(),
        acquiredAt: nowIso()
      } satisfies ArtifactBlobLockOwner),
      { flag: "wx" }
    );
  } catch (error) {
    await rm(lockPath, { recursive: true, force: true });
    throw error;
  }
  let released = false;
  return async () => {
    if (released) {
      return;
    }
    released = true;
    await rm(lockPath, { recursive: true, force: true });
  };
}

function safeArtifactFailureCode(error: unknown, fallback: string) {
  const candidate =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  return /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(candidate)
    ? candidate
    : fallback;
}

function registerPendingArtifactBlobCleanup(
  input: PendingArtifactBlobCleanup,
  createdAt: string
) {
  runInTransaction(() => {
    getDatabase()
      .prepare(
        `INSERT INTO artifact_pending_blob_cleanups (
           id, artifact_id, content_sha256, storage_key,
           stored_content_sha256, stored_byte_size, attempt_count,
           last_error_code, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 0, '', ?, ?)`
      )
      .run(
        input.id,
        input.artifactId,
        input.contentSha256,
        input.storageKey,
        input.storedContentSha256,
        input.storedByteSize,
        createdAt,
        createdAt
      );
    getDatabase()
      .prepare(
        `INSERT INTO artifact_pending_blob_cleanup_provenance (
           cleanup_id, blob_created_by_operation, recorded_at
         ) VALUES (?, ?, ?)`
      )
      .run(input.id, input.blobCreatedByOperation ? 1 : 0, createdAt);
  });
}

function markPendingArtifactBlobCreated(cleanupId: string) {
  getDatabase()
    .prepare(
      `UPDATE artifact_pending_blob_cleanup_provenance
       SET blob_created_by_operation = 1, recorded_at = ?
       WHERE cleanup_id = ?`
    )
    .run(nowIso(), cleanupId);
}

function clearPendingArtifactBlobCleanup(cleanupId: string) {
  runInTransaction(() => {
    getDatabase()
      .prepare(
        "DELETE FROM artifact_pending_blob_cleanup_provenance WHERE cleanup_id = ?"
      )
      .run(cleanupId);
    getDatabase()
      .prepare("DELETE FROM artifact_pending_blob_cleanups WHERE id = ?")
      .run(cleanupId);
  });
}

function registerArtifactBlob(blob: StoredArtifactBlob) {
  getDatabase()
    .prepare(
      // artifact_blobs is keyed by plaintext identity. These physical columns
      // describe its first canonical representation, not every ciphertext.
      `INSERT OR IGNORE INTO artifact_blobs (
        content_sha256, storage_key, byte_size, detected_mime_type, created_at,
        stored_content_sha256, stored_byte_size, content_protection_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      blob.contentSha256,
      blob.storageKey,
      blob.plaintextByteSize,
      blob.detectedMimeType,
      blob.createdAt,
      blob.storedContentSha256,
      blob.storedByteSize,
      blob.contentProtectionMode
    );
}

async function ensureBlobStored(input: {
  artifactId: string;
  contentSha256: string;
  plaintextByteSize: number;
  storedBuffer: Buffer;
  detectedMimeType: string;
  contentProtectionMode: ArtifactContentProtectionMode;
  context: ArtifactContext;
  services: ArtifactServiceDependencies;
}): Promise<StoredArtifactBlob> {
  const storedContentSha256 = sha256(input.storedBuffer);
  const storageKey = storageKeyForHash(storedContentSha256);
  const storagePath = resolveStoragePath(storageKey);
  const createdAt = nowIso();
  const cleanup: PendingArtifactBlobCleanup = {
    id: `artifact_cleanup_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    artifactId: input.artifactId,
    contentSha256: input.contentSha256,
    storageKey,
    storedContentSha256,
    storedByteSize: input.storedBuffer.byteLength,
    blobCreatedByOperation: false
  };
  const releaseLock = await acquireArtifactBlobLock(storageKey);

  try {
    registerPendingArtifactBlobCleanup(cleanup, createdAt);
    let blobCreatedByOperation = false;
    if (!existsSync(storagePath)) {
      await mkdir(path.dirname(storagePath), { recursive: true });
      const tmpPath = `${storagePath}.${process.pid}.${Date.now()}.tmp`;
      try {
        await writeFile(tmpPath, input.storedBuffer, { flag: "wx" });
        try {
          await link(tmpPath, storagePath);
          blobCreatedByOperation = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
            throw error;
          }
        }
        if (blobCreatedByOperation) {
          markPendingArtifactBlobCreated(cleanup.id);
        }
      } finally {
        await rm(tmpPath, { force: true }).catch(() => undefined);
      }
    }
    const verified = await readVerifiedStoredBlob({
      storageKey,
      expectedStoredByteSize: input.storedBuffer.byteLength,
      expectedStoredContentSha256: storedContentSha256,
      phase: "reuse",
      context: input.context
    });
    verified.fill(0);

    return {
      ...cleanup,
      blobCreatedByOperation,
      storagePath,
      plaintextByteSize: input.plaintextByteSize,
      detectedMimeType: input.detectedMimeType,
      contentProtectionMode: input.contentProtectionMode,
      createdAt,
      releaseLock
    };
  } catch (error) {
    await reconcilePendingArtifactBlobCleanup(cleanup, input.services, true);
    await releaseLock();
    throw error;
  }
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
  scanResults: InternalArtifactScanResult;
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
    scanResults: serializeArtifactPublicPayload(
      artifactScanResultsForResponse(parseJsonObject(row.scan_results_json))
    ),
    enrichmentResults: serializeArtifactPublicPayload(
      parseJsonObject(row.enrichment_results_json)
    ),
    metadata: serializeArtifactPublicPayload(
      parseJsonObject(row.metadata_json)
    ),
    links,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapArtifactSummary(
  row: ArtifactRow,
  links: EntityLink[] = []
): ArtifactSummary {
  return {
    id: row.id,
    title: row.title,
    shortDescription: row.short_description,
    originalFileName: row.original_file_name,
    byteSize: row.byte_size,
    contentProtection: safeContentProtection({
      mode: row.content_protection_mode,
      encryptedAt: row.encrypted_at,
      encryptionJson: row.content_encryption_json,
      passwordHint: row.content_password_hint
    }),
    detectedExtension: row.detected_extension,
    formatFamily: row.format_family,
    sourceKind: row.source_kind,
    sourceLabel: row.source_label,
    artifactState: row.artifact_state,
    dangerScore: row.danger_score,
    dangerLevel: row.danger_level,
    downloadPolicy: row.download_policy,
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

const ARTIFACT_SUMMARY_SELECT_COLUMNS = `id, title, short_description, '' AS description,
              original_file_name, '' AS storage_key, '' AS storage_path,
              '' AS content_sha256, byte_size, '' AS stored_content_sha256,
              byte_size AS stored_byte_size, content_protection_mode,
              content_encryption_json, encrypted_at, NULL AS encrypted_by_actor,
              '' AS encrypted_source, content_password_hint, detected_extension,
              '' AS declared_mime_type, '' AS detected_mime_type, format_family,
              source_kind, source_label, NULL AS uploaded_by_user_id,
              NULL AS uploaded_by_agent_id, NULL AS acting_for_user_id,
              artifact_state, danger_score, danger_level, download_policy,
              '{}' AS scan_results_json, '{}' AS enrichment_results_json,
              '{}' AS metadata_json, created_at, updated_at`;

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
  parsed: z.infer<typeof artifactListQuerySchema>,
  options: {
    ownerUserIds?: readonly string[];
    projectIds?: readonly string[];
    tagIds?: readonly string[];
    artifactIds?: readonly string[];
  } = {}
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

  if (options.ownerUserIds && options.ownerUserIds.length > 0) {
    const placeholders = options.ownerUserIds.map(() => "?").join(", ");
    clauses.push(`EXISTS (
      SELECT 1
      FROM entity_owners artifact_owner_filter
      WHERE artifact_owner_filter.entity_type = 'artifact'
        AND artifact_owner_filter.entity_id = artifacts.id
        AND artifact_owner_filter.user_id IN (${placeholders})
    )`);
    params.push(...options.ownerUserIds);
  }
  for (const [entityType, allowedIds] of [
    ["project", options.projectIds],
    ["tag", options.tagIds]
  ] as const) {
    if (!allowedIds || allowedIds.length === 0) {
      continue;
    }
    const placeholders = allowedIds.map(() => "?").join(", ");
    clauses.push(`EXISTS (
      SELECT 1
      FROM entity_links artifact_scope_link
      WHERE artifact_scope_link.source_entity_type = 'artifact'
        AND artifact_scope_link.source_entity_id = artifacts.id
        AND artifact_scope_link.target_entity_type = ?
        AND artifact_scope_link.target_entity_id IN (${placeholders})
    )`);
    params.push(entityType, ...allowedIds);
    clauses.push(`NOT EXISTS (
      SELECT 1
      FROM entity_links artifact_scope_escape
      WHERE artifact_scope_escape.source_entity_type = 'artifact'
        AND artifact_scope_escape.source_entity_id = artifacts.id
        AND artifact_scope_escape.target_entity_type = ?
        AND artifact_scope_escape.target_entity_id NOT IN (${placeholders})
    )`);
    params.push(entityType, ...allowedIds);
  }
  if (options.artifactIds && options.artifactIds.length > 0) {
    const placeholders = options.artifactIds.map(() => "?").join(", ");
    clauses.push(`artifacts.id IN (${placeholders})`);
    params.push(...options.artifactIds);
  }

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
    const terms = parsed.query
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .match(/[\p{L}\p{N}_]+/gu);
    if (!terms || terms.length === 0) {
      clauses.push("0 = 1");
    } else {
      const ftsQuery = terms
        .slice(0, 12)
        .map((term) => `"${term.replaceAll('"', '""')}"*`)
        .join(" AND ");
      clauses.push(`artifacts.rowid IN (
        SELECT rowid
        FROM artifact_search
        WHERE artifact_search MATCH ?
      )`);
      params.push(ftsQuery);
    }
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
  const safeMetadata = serializeArtifactPublicPayload(metadata);
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
      JSON.stringify(safeMetadata),
      createdAt
    );
  recordEventLog({
    eventKind: eventType,
    entityType: "artifact" as CrudEntityType,
    entityId: artifactId,
    actor: context.actor ?? context.token?.agentLabel ?? null,
    source: context.source,
    metadata: toEventMetadata(safeMetadata)
  });
}

function replaceEntityLinksForArtifact(
  artifactId: string,
  links: EntityLinkInput[],
  context: ArtifactContext
) {
  const scope = artifactScope(context);
  const allowedProjectIds = new Set(scope.projectIds);
  const allowedTagIds = new Set(scope.tagIds);
  const scopedTargetMissing = () =>
    new HttpError(
      404,
      "artifact_link_target_not_found",
      "One artifact link target was not found in the allowed scope."
    );
  for (const link of links) {
    if (link.entityType === "project" || link.entityType === "tag") {
      const table = link.entityType === "project" ? "projects" : "tags";
      const exists = getDatabase()
        .prepare(`SELECT 1 FROM ${table} WHERE id = ? LIMIT 1`)
        .get(link.entityId);
      if (!exists || isEntityDeleted(link.entityType, link.entityId)) {
        throw scopedTargetMissing();
      }
      const allowedIds =
        link.entityType === "project" ? allowedProjectIds : allowedTagIds;
      if (allowedIds.size > 0 && !allowedIds.has(link.entityId)) {
        throw scopedTargetMissing();
      }
    }
    const targetOwnerUserId = getEntityOwnerId(link.entityType, link.entityId);
    if (
      scope.userIds.length > 0 &&
      targetOwnerUserId !== null &&
      !scope.userIds.includes(targetOwnerUserId)
    ) {
      throw scopedTargetMissing();
    }
  }
  if (
    (allowedProjectIds.size > 0 &&
      !links.some(
        (link) =>
          link.entityType === "project" && allowedProjectIds.has(link.entityId)
      )) ||
    (allowedTagIds.size > 0 &&
      !links.some(
        (link) => link.entityType === "tag" && allowedTagIds.has(link.entityId)
      ))
  ) {
    throw scopedTargetMissing();
  }
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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const CANONICAL_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function canonicalBase64DecodedByteLength(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export function decodeArtifactUploadBase64(
  value: string,
  maxBytes = MAX_ARTIFACT_BYTES
) {
  if (value.length === 0 || !CANONICAL_BASE64_PATTERN.test(value)) {
    throw new HttpError(
      400,
      "artifact_invalid_base64",
      "contentBase64 must contain a non-empty canonical base64 payload without whitespace."
    );
  }

  const decodedByteLength = canonicalBase64DecodedByteLength(value);
  if (decodedByteLength > maxBytes) {
    throw new HttpError(
      413,
      "artifact_size_limit_exceeded",
      `Artifact files may not exceed ${MAX_ARTIFACT_BYTES} bytes.`,
      { maxBytes: MAX_ARTIFACT_BYTES, decodedByteLength }
    );
  }

  const buffer = Buffer.from(value, "base64");
  if (buffer.byteLength === 0 || buffer.toString("base64") !== value) {
    buffer.fill(0);
    throw new HttpError(
      400,
      "artifact_invalid_base64",
      "contentBase64 must contain a non-empty canonical base64 payload without whitespace."
    );
  }
  return buffer;
}

function artifactScanResultsForResponse(
  scanResults: Record<string, unknown>
): Record<string, unknown> {
  const response = { ...scanResults };
  const extractedTextSample = response.extractedTextSample;
  const extractedTextAvailable =
    response.extractedTextAvailable === true ||
    (typeof extractedTextSample === "string" && extractedTextSample.length > 0);
  delete response.extractedTextSample;
  return {
    ...response,
    extractedTextAvailable
  };
}

function artifactScanResultsForEncryptedStorage(
  scanResults: Record<string, unknown>
): Record<string, unknown> {
  const encrypted = { ...scanResults };
  delete encrypted.extractedTextSample;
  return {
    ...encrypted,
    extractedTextAvailable: false
  };
}

function artifactUploadActorScope(context: ArtifactContext) {
  if (context.token) {
    return `agent:${context.token.id}`;
  }
  return "human:operator";
}

function artifactIdForIdempotencyKey(
  idempotencyKey: string,
  context: ArtifactContext
) {
  const digest = sha256(
    Buffer.from(
      `artifact-upload-v1\0${artifactUploadActorScope(context)}\0${idempotencyKey}`,
      "utf8"
    )
  );
  return `artifact_${digest.slice(0, 16)}`;
}

function artifactUploadPayloadFingerprint(
  parsed: ArtifactUploadInput,
  contentSha256: string
) {
  const protection = parsed.contentProtection;
  const fingerprintPayload = {
    ...parsed,
    idempotencyKey: undefined,
    contentBase64: undefined,
    contentSha256,
    contentProtection: protection
      ? {
          mode: protection.mode ?? "plaintext",
          ...(protection.mode === "password_encrypted"
            ? { passwordHint: protection.passwordHint }
            : {})
        }
      : { mode: "plaintext" }
  };
  return sha256(Buffer.from(canonicalJson(fingerprintPayload), "utf8"));
}

function readArtifactCreatedFingerprint(artifactId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT metadata_json
       FROM artifact_audit_events
       WHERE artifact_id = ? AND event_type = 'artifact.created'
       ORDER BY created_at ASC, id ASC
       LIMIT 1`
    )
    .get(artifactId) as { metadata_json: string } | undefined;
  const metadata = row ? parseJsonObject(row.metadata_json) : {};
  return typeof metadata.uploadPayloadFingerprint === "string"
    ? metadata.uploadPayloadFingerprint
    : null;
}

function artifactWrongPasswordError(artifactId: string) {
  return new HttpError(
    403,
    "artifact_wrong_password",
    "The password did not decrypt this artifact.",
    { artifactId }
  );
}

async function verifyEncryptedArtifactReplayPassword(
  artifact: Artifact,
  password: string,
  context: ArtifactContext
) {
  if (artifact.contentProtection.mode !== "password_encrypted") {
    return;
  }
  const storedBytes = await readVerifiedStoredBlob({
    storageKey: artifact.storageKey,
    expectedStoredByteSize: artifact.storedByteSize,
    expectedStoredContentSha256: artifact.storedContentSha256,
    phase: "replay",
    context
  });
  try {
    const decrypted = await decryptArtifactBytes({
      ciphertext: storedBytes,
      password,
      envelope: parseArtifactEncryptionEnvelope(artifact)
    });
    try {
      verifyPlaintextIdentityOrThrow(artifact, decrypted.plaintext, context);
    } finally {
      decrypted.plaintext.fill(0);
    }
  } catch (error) {
    if (error instanceof ArtifactDecryptionError) {
      throw artifactWrongPasswordError(artifact.id);
    }
    throw error;
  }
}

async function resolveArtifactUploadReplay(
  artifactId: string,
  payloadFingerprint: string,
  password: string,
  context: ArtifactContext
) {
  const row = getArtifactRow(artifactId);
  if (!row) {
    return null;
  }
  const recordedFingerprint = readArtifactCreatedFingerprint(artifactId);
  if (recordedFingerprint !== payloadFingerprint) {
    throw new HttpError(
      409,
      "artifact_idempotency_conflict",
      "This artifact upload idempotency key was already used with a different payload.",
      { artifactId }
    );
  }
  if (isEntityDeleted("artifact", artifactId)) {
    throw new HttpError(
      409,
      "artifact_idempotency_target_deleted",
      "This artifact upload was already committed and later deleted. Restore the existing metadata or use a new idempotency key.",
      { artifactId }
    );
  }
  const artifact = mapArtifact(
    row,
    listEntityLinksForSources("artifact", [artifactId]).map(mapLink)
  );
  await verifyEncryptedArtifactReplayPassword(artifact, password, context);
  return artifact;
}

function readPendingArtifactBlobCleanup(id: string) {
  return getDatabase()
    .prepare(
      `SELECT cleanup.id, cleanup.artifact_id, cleanup.content_sha256,
              cleanup.storage_key, cleanup.stored_content_sha256,
              cleanup.stored_byte_size,
              COALESCE(provenance.blob_created_by_operation, 0)
                AS blob_created_by_operation
       FROM artifact_pending_blob_cleanups AS cleanup
       LEFT JOIN artifact_pending_blob_cleanup_provenance AS provenance
         ON provenance.cleanup_id = cleanup.id
       WHERE cleanup.id = ?`
    )
    .get(id) as
    | {
        id: string;
        artifact_id: string;
        content_sha256: string;
        storage_key: string;
        stored_content_sha256: string;
        stored_byte_size: number;
        blob_created_by_operation: number;
      }
    | undefined;
}

function mapPendingArtifactBlobCleanup(
  row: NonNullable<ReturnType<typeof readPendingArtifactBlobCleanup>>
): PendingArtifactBlobCleanup {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    contentSha256: row.content_sha256,
    storageKey: row.storage_key,
    storedContentSha256: row.stored_content_sha256,
    storedByteSize: row.stored_byte_size,
    blobCreatedByOperation: row.blob_created_by_operation === 1
  };
}

async function reconcilePendingArtifactBlobCleanup(
  pending: PendingArtifactBlobCleanup,
  services: ArtifactServiceDependencies,
  lockHeld = false
) {
  const releaseLock = lockHeld
    ? null
    : await acquireArtifactBlobLock(pending.storageKey);
  try {
    const currentRow = readPendingArtifactBlobCleanup(pending.id);
    if (!currentRow) {
      return "already_resolved" as const;
    }
    const current = mapPendingArtifactBlobCleanup(currentRow);
    const expectedStorageKey = storageKeyForHash(current.storedContentSha256);
    if (current.storageKey !== expectedStorageKey) {
      throw Object.assign(
        new Error(
          "Artifact cleanup journal entry is not bound to its content hash."
        ),
        { code: "artifact_cleanup_binding_invalid" }
      );
    }

    const referenced = getDatabase()
      .prepare(
        `SELECT 1
         FROM artifacts
         WHERE storage_key = ?
         UNION ALL
         SELECT 1
         FROM artifact_versions
         WHERE storage_key = ?
         LIMIT 1`
      )
      .get(current.storageKey, current.storageKey);
    if (referenced) {
      clearPendingArtifactBlobCleanup(current.id);
      return "referenced" as const;
    }

    const retained = getDatabase()
      .prepare(
        `SELECT 1
         FROM artifact_blob_retentions
         WHERE storage_key = ?
         LIMIT 1`
      )
      .get(current.storageKey);
    if (retained) {
      clearPendingArtifactBlobCleanup(current.id);
      return "retained" as const;
    }

    if (!current.blobCreatedByOperation) {
      const storagePath = resolveStoragePath(current.storageKey);
      clearPendingArtifactBlobCleanup(current.id);
      return existsSync(storagePath)
        ? ("preexisting_preserved" as const)
        : ("missing" as const);
    }

    const delegated = getDatabase()
      .prepare(
        `SELECT 1
         FROM artifact_pending_blob_cleanups
         WHERE storage_key = ? AND id <> ?
         LIMIT 1`
      )
      .get(current.storageKey, current.id);
    if (delegated) {
      clearPendingArtifactBlobCleanup(current.id);
      return "delegated" as const;
    }

    const storagePath = resolveStoragePath(current.storageKey);
    const existed = existsSync(storagePath);
    const removeFile =
      services.removeArtifactUploadFile ??
      services.removeEncryptedUploadFile ??
      ((target: string) => rm(target, { force: true }));
    await removeFile(storagePath);
    runInTransaction(() => {
      const referenceAfterRemoval = getDatabase()
        .prepare(
          `SELECT 1
           FROM artifacts
           WHERE storage_key = ?
           UNION ALL
           SELECT 1
           FROM artifact_versions
           WHERE storage_key = ?
           LIMIT 1`
        )
        .get(current.storageKey, current.storageKey);
      if (referenceAfterRemoval) {
        throw Object.assign(
          new Error("Artifact blob became referenced during cleanup."),
          { code: "artifact_cleanup_reference_race" }
        );
      }
      getDatabase()
        .prepare(
          `DELETE FROM artifact_blobs
           WHERE storage_key = ?
             AND NOT EXISTS (
               SELECT 1 FROM artifacts WHERE storage_key = ?
             )
             AND NOT EXISTS (
               SELECT 1 FROM artifact_versions WHERE storage_key = ?
             )`
        )
        .run(current.storageKey, current.storageKey, current.storageKey);
      clearPendingArtifactBlobCleanup(current.id);
    });
    return existed ? ("removed" as const) : ("missing" as const);
  } catch (error) {
    getDatabase()
      .prepare(
        `UPDATE artifact_pending_blob_cleanups
         SET attempt_count = attempt_count + 1,
             last_error_code = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        safeArtifactFailureCode(error, "artifact_cleanup_failed"),
        nowIso(),
        pending.id
      );
    return "pending" as const;
  } finally {
    await releaseLock?.();
  }
}

export async function reconcilePendingArtifactBlobCleanups(
  services: ArtifactServiceDependencies = {},
  limit = MAX_PENDING_ARTIFACT_BLOB_CLEANUPS
) {
  const boundedLimit = Math.max(
    1,
    Math.min(MAX_PENDING_ARTIFACT_BLOB_CLEANUPS, Math.trunc(limit))
  );
  const rows = getDatabase()
    .prepare(
      `SELECT cleanup.id, cleanup.artifact_id, cleanup.content_sha256,
              cleanup.storage_key, cleanup.stored_content_sha256,
              cleanup.stored_byte_size,
              COALESCE(provenance.blob_created_by_operation, 0)
                AS blob_created_by_operation
       FROM artifact_pending_blob_cleanups AS cleanup
       LEFT JOIN artifact_pending_blob_cleanup_provenance AS provenance
         ON provenance.cleanup_id = cleanup.id
       ORDER BY created_at ASC, id ASC
       LIMIT ?`
    )
    .all(boundedLimit) as Array<
    NonNullable<ReturnType<typeof readPendingArtifactBlobCleanup>>
  >;
  const dispositions: Array<{ id: string; disposition: string }> = [];
  for (const row of rows) {
    const pending = mapPendingArtifactBlobCleanup(row);
    dispositions.push({
      id: pending.id,
      disposition: await reconcilePendingArtifactBlobCleanup(pending, services)
    });
  }
  return dispositions;
}

function normalizeArtifactUploadProvenance(
  parsed: ArtifactUploadInput,
  context: ArtifactContext
) {
  const allowedUserIds = context.token?.scopePolicy?.userIds ?? [];
  const resolveOwnerUserId = (
    actingForUserId: string | null,
    uploadedByUserId: string | null
  ) => {
    const requestedOwnerUserId = actingForUserId ?? uploadedByUserId;
    if (
      context.token &&
      allowedUserIds.length > 1 &&
      requestedOwnerUserId === null
    ) {
      throw new HttpError(
        400,
        "artifact_owner_required",
        "An artifact owner is required when an agent token can act for multiple users.",
        { allowedUserIds }
      );
    }
    let ownerUserId: string;
    try {
      ownerUserId = resolveUserForMutation(requestedOwnerUserId).id;
    } catch {
      throw new HttpError(
        400,
        "artifact_owner_invalid",
        "The requested artifact owner does not exist.",
        { requestedOwnerUserId }
      );
    }
    if (
      context.token &&
      allowedUserIds.length > 0 &&
      !allowedUserIds.includes(ownerUserId)
    ) {
      throw new HttpError(
        403,
        "artifact_user_scope_forbidden",
        "The requested artifact owner is outside this token's allowed users.",
        { requestedUserId: ownerUserId }
      );
    }
    return ownerUserId;
  };

  if (!context.token) {
    if (parsed.sourceKind === "agent_upload" || parsed.uploadedByAgentId) {
      throw new HttpError(
        400,
        "artifact_provenance_conflict",
        "Human uploads cannot claim agent-upload provenance.",
        { sourceKind: parsed.sourceKind ?? null }
      );
    }
    const actingForUserId = parsed.actingForUserId;
    const uploadedByUserId = parsed.uploadedByUserId;
    return {
      sourceKind: parsed.sourceKind ?? ("upload" as const),
      uploadedByAgentId: null,
      uploadedByUserId,
      actingForUserId,
      ownerUserId: resolveOwnerUserId(actingForUserId, uploadedByUserId)
    };
  }

  if (parsed.sourceKind && parsed.sourceKind !== "agent_upload") {
    throw new HttpError(
      403,
      "artifact_agent_provenance_required",
      "Agent uploads must retain agent-upload provenance.",
      { sourceKind: parsed.sourceKind }
    );
  }
  if (
    parsed.uploadedByAgentId &&
    parsed.uploadedByAgentId !== context.token.agentId
  ) {
    throw new HttpError(
      403,
      "artifact_agent_identity_mismatch",
      "An agent cannot attribute an artifact upload to another agent.",
      { uploadedByAgentId: parsed.uploadedByAgentId }
    );
  }
  for (const requestedUserId of [
    parsed.uploadedByUserId,
    parsed.actingForUserId
  ]) {
    if (
      requestedUserId &&
      allowedUserIds.length > 0 &&
      !allowedUserIds.includes(requestedUserId)
    ) {
      throw new HttpError(
        403,
        "artifact_user_scope_forbidden",
        "The requested artifact provenance user is outside this token's allowed users.",
        { requestedUserId }
      );
    }
  }
  const actingForUserId =
    parsed.actingForUserId ??
    (allowedUserIds.length === 1 ? allowedUserIds[0]! : null);
  const uploadedByUserId = parsed.uploadedByUserId;
  return {
    sourceKind: "agent_upload" as const,
    uploadedByAgentId: context.token.agentId,
    uploadedByUserId,
    actingForUserId,
    ownerUserId: resolveOwnerUserId(actingForUserId, uploadedByUserId)
  };
}

export type ArtifactUploadCreationResult = {
  artifact: Artifact;
  replayed: boolean;
};

export async function createArtifactFromUpload(
  input: z.input<typeof artifactUploadSchema>,
  context: ArtifactContext,
  services: ArtifactServiceDependencies = {}
): Promise<ArtifactUploadCreationResult> {
  const parsed = artifactUploadSchema.parse(input);
  await reconcilePendingArtifactBlobCleanups(services);
  const buffer = decodeArtifactUploadBase64(parsed.contentBase64);
  let storedBuffer = buffer;
  try {
    const requestedProtection = parsed.contentProtection;
    const encryptContent = requestedProtection?.mode === "password_encrypted";
    if (encryptContent && context.token) {
      throw new HttpError(
        403,
        "artifact_password_rejected_for_agent",
        "Artifact content passwords are accepted only from human operator flows.",
        { route: "/api/v1/artifacts" }
      );
    }
    const plaintextSha256 = sha256(buffer);
    const payloadFingerprint = artifactUploadPayloadFingerprint(
      parsed,
      plaintextSha256
    );
    const id = parsed.idempotencyKey
      ? artifactIdForIdempotencyKey(parsed.idempotencyKey, context)
      : artifactId();
    if (parsed.idempotencyKey) {
      let replay: Artifact | null;
      try {
        replay = await resolveArtifactUploadReplay(
          id,
          payloadFingerprint,
          requestedProtection?.mode === "password_encrypted"
            ? requestedProtection.password
            : "",
          context
        );
      } catch (error) {
        buffer.fill(0);
        throw error;
      }
      if (replay) {
        buffer.fill(0);
        return { artifact: replay, replayed: true };
      }
    }
    const provenance = normalizeArtifactUploadProvenance(parsed, context);
    const scan = scanArtifactBytes({
      buffer,
      originalFileName: parsed.originalFileName,
      declaredMimeType: parsed.declaredMimeType
    });
    const versionId = artifactVersionId();
    const createdAt = nowIso();
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
      storedBuffer = encrypted.ciphertext;
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
      encryptionEnvelope = encrypted.envelope;
      contentProtectionMode = "password_encrypted";
    }
    const blob = await ensureBlobStored({
      artifactId: id,
      contentSha256: plaintextSha256,
      plaintextByteSize: buffer.byteLength,
      storedBuffer,
      detectedMimeType: scan.detectedMimeType,
      contentProtectionMode,
      context,
      services
    });
    let blobSettled = false;
    const settleBlob = async () => {
      if (blobSettled) {
        return;
      }
      blobSettled = true;
      try {
        await reconcilePendingArtifactBlobCleanup(blob, services, true);
      } finally {
        await blob.releaseLock();
      }
    };
    const metadata = {
      ...parsed.metadata,
      safeHandling:
        "Forge stores and serves this file for human download only; it must not be executed by agents."
    };
    const initialEnrichment = {
      generated: false,
      status: parsed.useLlmEnrichment ? "pending" : "not_requested"
    };
    const persistedScanResults = encryptContent
      ? artifactScanResultsForEncryptedStorage(scan.scanResults)
      : artifactScanResultsForResponse(scan.scanResults);

    try {
      services.beforeArtifactMetadataCommit?.({
        artifactId: id,
        cleanupId: blob.id
      });
      runInTransaction(() => {
        registerArtifactBlob(blob);
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
            parsed.title?.trim() ||
              deriveFallbackTitle(parsed.originalFileName),
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
            provenance.sourceKind,
            parsed.sourceLabel,
            provenance.uploadedByUserId,
            provenance.uploadedByAgentId,
            provenance.actingForUserId,
            scan.artifactState,
            scan.dangerScore,
            scan.dangerLevel,
            parsed.downloadPolicy,
            JSON.stringify(persistedScanResults),
            JSON.stringify(initialEnrichment),
            JSON.stringify(metadata),
            createdAt,
            createdAt
          );
        setEntityOwner("artifact", id, provenance.ownerUserId);
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
          scanResults: persistedScanResults,
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
          sourceKind: provenance.sourceKind,
          ownerUserId: provenance.ownerUserId,
          uploadPayloadFingerprint: payloadFingerprint,
          idempotencyKeyHash: parsed.idempotencyKey
            ? sha256(Buffer.from(parsed.idempotencyKey, "utf8"))
            : null
        });
      });
      await settleBlob();
    } catch (error) {
      if (parsed.idempotencyKey) {
        let replay: Artifact | null;
        try {
          replay = await resolveArtifactUploadReplay(
            id,
            payloadFingerprint,
            requestedProtection?.mode === "password_encrypted"
              ? requestedProtection.password
              : "",
            context
          );
        } catch (replayError) {
          await settleBlob();
          throw replayError;
        }
        if (replay) {
          await settleBlob();
          if (storedBuffer !== buffer) {
            storedBuffer.fill(0);
          }
          buffer.fill(0);
          return { artifact: replay, replayed: true };
        }
      }
      await settleBlob();
      if (storedBuffer !== buffer) {
        storedBuffer.fill(0);
      }
      buffer.fill(0);
      throw error;
    }
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
      ).catch(() => undefined);
    }

    return { artifact: getArtifactById(id, context)!, replayed: false };
  } finally {
    if (storedBuffer !== buffer) {
      storedBuffer.fill(0);
    }
    buffer.fill(0);
  }
}

export function createArtifactMetadata(): never {
  throw new Error(
    "Use POST /api/v1/artifacts for artifact creation. Batch CRUD may search, link, update metadata, delete, and restore artifact records, but it must not create file artifacts."
  );
}

export function listArtifactsPage(
  input: z.input<typeof artifactListQuerySchema> = {},
  context?: ArtifactContext
) {
  const parsed = artifactListQuerySchema.parse(input);
  const scope = artifactScope(context);
  const where = buildArtifactListWhere(parsed, {
    ownerUserIds: scope.userIds,
    projectIds: scope.projectIds,
    tagIds: scope.tagIds
  });
  const totalRow = getDatabase()
    .prepare(`SELECT COUNT(*) AS total FROM artifacts WHERE ${where.sql}`)
    .get(...where.params) as { total: number } | undefined;
  const rows = getDatabase()
    .prepare(
      `SELECT ${ARTIFACT_SUMMARY_SELECT_COLUMNS}
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
    mapArtifactSummary(row, linksByArtifactId.get(row.id) ?? [])
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
  input: z.input<typeof artifactListQuerySchema> = {},
  context?: ArtifactContext
) {
  const parsed = artifactListQuerySchema.parse(input);
  const scope = artifactScope(context);
  const where = buildArtifactListWhere(parsed, {
    ownerUserIds: scope.userIds,
    projectIds: scope.projectIds,
    tagIds: scope.tagIds
  });
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
  return rows.map((row) =>
    mapArtifact(row, linksByArtifactId.get(row.id) ?? [])
  );
}

export function searchArtifactsForEntityCrud(input: {
  ids?: string[];
  query?: string;
  linkedTo?: { entityType: string; id: string };
  userIds?: string[];
  projectIds?: string[];
  tagIds?: string[];
  limit: number;
}) {
  const parsed = artifactListQuerySchema.parse({
    query: input.query,
    linkedEntityType: input.linkedTo?.entityType,
    linkedEntityId: input.linkedTo?.id,
    limit: input.limit,
    offset: 0
  });
  const where = buildArtifactListWhere(parsed, {
    ownerUserIds: input.userIds,
    projectIds: input.projectIds,
    tagIds: input.tagIds,
    artifactIds: input.ids
  });
  const rows = getDatabase()
    .prepare(
      `SELECT ${ARTIFACT_SELECT_COLUMNS}
       FROM artifacts
       WHERE ${where.sql}
       ORDER BY updated_at DESC, id ASC
       LIMIT ?`
    )
    .all(...where.params, parsed.limit) as ArtifactRow[];
  const linksByArtifactId = new Map<string, EntityLink[]>();
  for (const linkRow of listEntityLinksForSources(
    "artifact",
    rows.map((row) => row.id)
  )) {
    const current = linksByArtifactId.get(linkRow.sourceEntityId) ?? [];
    current.push(mapLink(linkRow));
    linksByArtifactId.set(linkRow.sourceEntityId, current);
  }
  return rows.map((row) =>
    mapArtifact(row, linksByArtifactId.get(row.id) ?? [])
  );
}

export function getArtifactById(
  id: string,
  context?: ArtifactContext
): Artifact | undefined {
  if (isEntityDeleted("artifact", id)) {
    return undefined;
  }
  if (context && !canAccessArtifact(id, context)) {
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
  const existing = getArtifactById(id, context);
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
             metadata_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        parsed.title ?? existing.title,
        parsed.shortDescription ?? existing.shortDescription,
        parsed.description ?? existing.description,
        parsed.sourceLabel ?? existing.sourceLabel,
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
  return getArtifactById(id, context);
}

function retainArtifactBlobsForHardDeletedMetadata(artifactId: string) {
  const retainedAt = nowIso();
  const rows = getDatabase()
    .prepare(
      `SELECT storage_key, content_sha256
       FROM artifacts
       WHERE id = ?
       UNION
       SELECT storage_key, content_sha256
       FROM artifact_versions
       WHERE artifact_id = ?`
    )
    .all(artifactId, artifactId) as Array<{
    storage_key: string;
    content_sha256: string;
  }>;
  const insert = getDatabase().prepare(
    `INSERT OR IGNORE INTO artifact_blob_retentions (
       storage_key, artifact_id, content_sha256, reason, retained_at
     ) VALUES (?, ?, ?, 'hard_deleted_metadata_blob_preserved', ?)`
  );
  let retainedBlobCount = 0;
  for (const row of rows) {
    if (!row.storage_key) {
      continue;
    }
    insert.run(row.storage_key, artifactId, row.content_sha256, retainedAt);
    retainedBlobCount += 1;
  }
  return retainedBlobCount;
}

export function deleteArtifactMetadata(id: string, context: ArtifactContext) {
  if (!canAccessArtifact(id, context)) {
    return undefined;
  }
  const row = getArtifactRow(id);
  if (!row) {
    return undefined;
  }
  const existing = mapArtifact(
    row,
    listEntityLinksForSources("artifact", [id]).map(mapLink)
  );
  runInTransaction(() => {
    const retainedBlobCount = retainArtifactBlobsForHardDeletedMetadata(id);
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
        blobPreserved: true,
        retainedBlobCount,
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

export async function readArtifactDownload(
  id: string,
  password: string,
  context: ArtifactContext
) {
  const artifact = getArtifactById(id, context);
  if (!artifact) {
    return null;
  }
  if (
    artifact.downloadPolicy !== "human_only" ||
    artifact.artifactState === "blocked"
  ) {
    throw new HttpError(
      409,
      "artifact_download_unavailable",
      "This artifact is not downloadable in its current state.",
      {
        artifactId: artifact.id,
        artifactState: artifact.artifactState,
        downloadPolicy: artifact.downloadPolicy
      }
    );
  }
  const storedBytes = await readVerifiedStoredBlob({
    storageKey: artifact.storageKey,
    expectedStoredByteSize: artifact.storedByteSize,
    expectedStoredContentSha256: artifact.storedContentSha256,
    phase: "download",
    context
  });
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
      verifyPlaintextIdentityOrThrow(artifact, decrypted.plaintext, context);
      return {
        artifact,
        bytes: decrypted.plaintext
      };
    } catch (error) {
      if (error instanceof ArtifactDecryptionError) {
        throw artifactWrongPasswordError(artifact.id);
      }
      throw error;
    }
  }
  verifyPlaintextIdentityOrThrow(artifact, storedBytes, context);
  return {
    artifact,
    bytes: storedBytes
  };
}

export async function readTrustedArtifactTicketText(
  id: string,
  context: ArtifactContext
) {
  const artifact = getArtifactById(id, context);
  if (!artifact) {
    return undefined;
  }
  if (
    artifact.artifactState !== "active" ||
    artifact.dangerLevel === "blocked"
  ) {
    throw new HttpError(
      409,
      "artifact_ticket_import_untrusted",
      "Ticket import requires an active, non-quarantined Artifact with trusted scanner state.",
      { artifactId: artifact.id }
    );
  }
  if (artifact.contentProtection.mode !== "plaintext") {
    throw new HttpError(
      409,
      "artifact_ticket_content_unavailable",
      "Ticket import requires scanner-readable plaintext content and does not accept artifact passwords.",
      { artifactId: artifact.id }
    );
  }
  const bytes = await readVerifiedStoredBlob({
    storageKey: artifact.storageKey,
    expectedStoredByteSize: artifact.storedByteSize,
    expectedStoredContentSha256: artifact.storedContentSha256,
    phase: "ticket_import",
    context
  });
  try {
    verifyPlaintextIdentityOrThrow(artifact, bytes, context);
    const scan = scanArtifactBytes({
      buffer: bytes,
      originalFileName: artifact.originalFileName,
      declaredMimeType: artifact.declaredMimeType
    });
    if (scan.artifactState !== "active" || scan.dangerLevel === "blocked") {
      throw new HttpError(
        409,
        "artifact_ticket_import_untrusted",
        "Ticket import requires content that passes the current static scanner without quarantine or blocking.",
        { artifactId: artifact.id }
      );
    }
    const extractedText = scan.scanResults.extractedTextSample.trim();
    if (!extractedText) {
      throw new HttpError(
        409,
        "artifact_ticket_content_unavailable",
        "The verified artifact content did not provide scanner-approved ticket text.",
        { artifactId: artifact.id }
      );
    }
    return { artifact, extractedText };
  } finally {
    bytes.fill(0);
  }
}

export async function encryptExistingArtifact(
  id: string,
  input: z.input<typeof artifactEncryptRequestSchema>,
  context: ArtifactContext,
  services: ArtifactServiceDependencies = {}
) {
  const artifact = getArtifactById(id, context);
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
  const plaintext = await readVerifiedStoredBlob({
    storageKey: artifact.storageKey,
    expectedStoredByteSize: artifact.storedByteSize,
    expectedStoredContentSha256: artifact.storedContentSha256,
    phase: "encryption",
    context
  });
  let encryptedCiphertext: Buffer | null = null;
  let blob: StoredArtifactBlob | null = null;
  const settleBlob = async () => {
    if (!blob) {
      return;
    }
    const current = blob;
    blob = null;
    try {
      await reconcilePendingArtifactBlobCleanup(current, services, true);
    } finally {
      await current.releaseLock();
    }
  };
  try {
    verifyPlaintextIdentityOrThrow(artifact, plaintext, context);

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
    encryptedCiphertext = encrypted.ciphertext;
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
    blob = await ensureBlobStored({
      artifactId: id,
      contentSha256: artifact.contentSha256,
      plaintextByteSize: artifact.byteSize,
      storedBuffer: encrypted.ciphertext,
      detectedMimeType: artifact.detectedMimeType,
      contentProtectionMode: "password_encrypted",
      context,
      services
    });
    const encryptedBlob = blob;
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
    const rawArtifactScanResults = parseJsonObject(
      getArtifactRow(id)?.scan_results_json ?? "{}"
    );
    const encryptedArtifactScanResults = artifactScanResultsForEncryptedStorage(
      rawArtifactScanResults
    );
    const versionScanResults = getDatabase()
      .prepare(
        `SELECT id, scan_results_json
       FROM artifact_versions
       WHERE artifact_id = ?`
      )
      .all(id) as Array<{ id: string; scan_results_json: string }>;
    const persistedTextSampleCount =
      (typeof rawArtifactScanResults.extractedTextSample === "string" &&
      rawArtifactScanResults.extractedTextSample.length > 0
        ? 1
        : 0) +
      versionScanResults.filter((version) => {
        const scan = parseJsonObject(version.scan_results_json);
        return (
          typeof scan.extractedTextSample === "string" &&
          scan.extractedTextSample.length > 0
        );
      }).length;

    services.beforeArtifactMetadataCommit?.({
      artifactId: id,
      cleanupId: encryptedBlob.id
    });
    runInTransaction(() => {
      registerArtifactBlob(encryptedBlob);
      const encryptionUpdate = getDatabase()
        .prepare(
          `UPDATE artifacts
         SET storage_key = ?, storage_path = ?, stored_content_sha256 = ?,
             stored_byte_size = ?, content_protection_mode = ?,
             content_encryption_json = ?, encrypted_at = ?,
             encrypted_by_actor = ?, encrypted_source = ?,
             content_password_hint = ?, scan_results_json = ?, updated_at = ?
         WHERE id = ?
           AND content_protection_mode = 'plaintext'
           AND storage_key = ?
           AND stored_content_sha256 = ?
           AND stored_byte_size = ?`
        )
        .run(
          encryptedBlob.storageKey,
          encryptedBlob.storagePath,
          encryptedBlob.storedContentSha256,
          encryptedBlob.storedByteSize,
          "password_encrypted",
          JSON.stringify(encrypted.envelope),
          encryptedAt,
          context.actor ?? null,
          context.source,
          parsed.passwordHint,
          JSON.stringify(encryptedArtifactScanResults),
          encryptedAt,
          id,
          artifact.storageKey,
          artifact.storedContentSha256,
          artifact.storedByteSize
        );
      if (encryptionUpdate.changes !== 1) {
        const current = getDatabase()
          .prepare(
            `SELECT content_protection_mode, storage_key,
                    stored_content_sha256, stored_byte_size
             FROM artifacts
             WHERE id = ?`
          )
          .get(id) as
          | {
              content_protection_mode: ArtifactContentProtectionMode;
              storage_key: string;
              stored_content_sha256: string;
              stored_byte_size: number;
            }
          | undefined;
        if (current?.content_protection_mode === "password_encrypted") {
          throw new HttpError(
            409,
            "artifact_already_encrypted",
            "This artifact was encrypted by another request. Refresh its metadata before continuing.",
            { artifactId: id }
          );
        }
        throw new HttpError(
          409,
          "artifact_encryption_conflict",
          "The artifact bytes changed while encryption was in progress. No encryption change was applied; refresh the artifact before retrying.",
          {
            artifactId: id,
            currentContentProtectionMode:
              current?.content_protection_mode ?? null
          }
        );
      }
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
            encryptedBlob.storageKey,
            encryptedBlob.storedContentSha256,
            encryptedBlob.storedByteSize,
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
          storageKey: encryptedBlob.storageKey,
          byteSize: artifact.byteSize,
          storedContentSha256: encryptedBlob.storedContentSha256,
          storedByteSize: encryptedBlob.storedByteSize,
          contentProtectionMode: "password_encrypted",
          encryptionEnvelope: encrypted.envelope,
          encryptedAt,
          passwordHint: parsed.passwordHint,
          originalFileName: artifact.originalFileName,
          scanResults: encryptedArtifactScanResults,
          enrichmentResults: artifact.enrichmentResults,
          context
        });
      }
      const updateVersionScan = getDatabase().prepare(
        `UPDATE artifact_versions
       SET scan_results_json = ?
       WHERE id = ?`
      );
      for (const version of versionScanResults) {
        updateVersionScan.run(
          JSON.stringify(
            artifactScanResultsForEncryptedStorage(
              parseJsonObject(version.scan_results_json)
            )
          ),
          version.id
        );
      }
      recordArtifactAudit(id, "artifact.encrypted", context, {
        contentSha256: artifact.contentSha256,
        storedContentSha256: encryptedBlob.storedContentSha256,
        plaintextBlobPreserved: true,
        plaintextBlobDeletionAttempted: false,
        plaintextBlobReferenceCountBeforeSwitch:
          retainedPlaintextReference.count,
        persistedTextSamplesRemoved: persistedTextSampleCount,
        hasPasswordHint: parsed.passwordHint.length > 0
      });
    });
    await settleBlob();
    plaintext.fill(0);
    encrypted.ciphertext.fill(0);
    return getArtifactById(id, context)!;
  } catch (error) {
    await settleBlob();
    throw error;
  } finally {
    plaintext.fill(0);
    encryptedCiphertext?.fill(0);
  }
}

export async function rescanArtifact(id: string, context: ArtifactContext) {
  const artifact = getArtifactById(id, context);
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
  const buffer = await readVerifiedStoredBlob({
    storageKey: artifact.storageKey,
    expectedStoredByteSize: artifact.storedByteSize,
    expectedStoredContentSha256: artifact.storedContentSha256,
    phase: "scan",
    context
  });
  try {
    verifyPlaintextIdentityOrThrow(artifact, buffer, context);
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
          JSON.stringify(artifactScanResultsForResponse(scan.scanResults)),
          updatedAt,
          id
        );
      recordArtifactAudit(id, "artifact.scanned", context, {
        dangerScore: scan.dangerScore,
        dangerLevel: scan.dangerLevel
      });
    });
    return getArtifactById(id, context)!;
  } finally {
    buffer.fill(0);
  }
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

function sanitizeArtifactEnrichmentOutput(
  value: Record<string, unknown>,
  extractedTextSample: string
): Record<string, unknown> {
  const isSafeGeneratedString = (entry: unknown): entry is string =>
    typeof entry === "string" &&
    (extractedTextSample.length === 0 || !entry.includes(extractedTextSample));
  const output: Record<string, unknown> = {};
  for (const key of [
    "title",
    "shortDescription",
    "description",
    "documentType",
    "safetySummary"
  ]) {
    if (isSafeGeneratedString(value[key])) {
      output[key] = value[key];
    }
  }
  for (const key of ["keywords", "dangerReasons"]) {
    if (Array.isArray(value[key])) {
      output[key] = value[key].filter(isSafeGeneratedString);
    }
  }
  if (Array.isArray(value.suggestedForgeLinks)) {
    output.suggestedForgeLinks = value.suggestedForgeLinks.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return {};
      }
      const link = entry as Record<string, unknown>;
      return Object.fromEntries(
        ["entityType", "entityId", "relationship", "reason", "label"]
          .filter((key) => isSafeGeneratedString(link[key]))
          .map((key) => [key, link[key]])
      );
    });
  }
  if (
    typeof value.dangerScoreAdjustment === "number" &&
    Number.isFinite(value.dangerScoreAdjustment)
  ) {
    output.dangerScoreAdjustment = value.dangerScoreAdjustment;
  }
  return output;
}

function compactArtifactForPrompt(
  artifact: Artifact,
  scanResults: Record<string, unknown>
) {
  const scan = scanResults as unknown as InternalArtifactScanResult;
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

async function scanArtifactForEnrichment(
  artifact: Artifact,
  context: ArtifactContext
): Promise<Record<string, unknown>> {
  if (artifact.contentProtection.mode === "password_encrypted") {
    return parseJsonObject(
      getArtifactRow(artifact.id)?.scan_results_json ?? "{}"
    );
  }
  const buffer = await readVerifiedStoredBlob({
    storageKey: artifact.storageKey,
    expectedStoredByteSize: artifact.storedByteSize,
    expectedStoredContentSha256: artifact.storedContentSha256,
    phase: "enrichment",
    context
  });
  try {
    verifyPlaintextIdentityOrThrow(artifact, buffer, context);
    return scanArtifactBytes({
      buffer,
      originalFileName: artifact.originalFileName,
      declaredMimeType: artifact.declaredMimeType
    }).scanResults;
  } finally {
    buffer.fill(0);
  }
}

function persistArtifactEnrichmentFailure(
  id: string,
  _error: unknown,
  context: ArtifactContext
) {
  const errorCode = ARTIFACT_FAILURE_CODE;
  runInTransaction(() => {
    updateArtifactEnrichment(id, {
      generated: false,
      status: "failed",
      errorCode,
      generatedAt: nowIso()
    });
    recordArtifactAudit(id, "artifact.enrichment_failed", context, {
      errorCode
    });
  });
}

export async function enrichArtifactWithLlm(
  id: string,
  input: z.input<typeof artifactEnrichmentRequestSchema>,
  context: ArtifactContext,
  services: { llm?: LlmManager } = {}
) {
  const artifact = getArtifactById(id, context);
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
    return getArtifactById(id, context)!;
  }

  try {
    const internalScanResults = await scanArtifactForEnrichment(
      artifact,
      context
    );
    const prompt = [
      "You are enriching metadata for a Forge artifact store.",
      "Do not infer executable behavior and do not lower deterministic safety findings.",
      "Return only JSON with keys: title, shortDescription, description, documentType, keywords, suggestedForgeLinks, safetySummary, dangerReasons, dangerScoreAdjustment.",
      JSON.stringify(
        compactArtifactForPrompt(artifact, internalScanResults),
        null,
        2
      )
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
          messageAvailable: log.message.length > 0,
          messagePersisted: false
        });
      }
    );
    const generated = sanitizeArtifactEnrichmentOutput(
      extractJsonObject(result.outputText),
      typeof internalScanResults.extractedTextSample === "string"
        ? internalScanResults.extractedTextSample
        : ""
    );
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
    return getArtifactById(id, context)!;
  } catch (error) {
    persistArtifactEnrichmentFailure(id, error, context);
    throw error;
  }
}

export function replaceArtifactEntityLinks(
  id: string,
  links: EntityLinkInput[],
  context: ArtifactContext
) {
  const artifact = getArtifactById(id, context);
  if (!artifact) {
    return undefined;
  }
  const parsedLinks = artifactEntityLinksSchema.parse(links);
  runInTransaction(() => {
    replaceEntityLinksForArtifact(id, parsedLinks, context);
    getDatabase()
      .prepare("UPDATE artifacts SET updated_at = ? WHERE id = ?")
      .run(nowIso(), id);
    recordArtifactAudit(id, "artifact.links_updated", context, {
      linkCount: parsedLinks.length
    });
  });
  return getArtifactById(id, context)!;
}

export function patchArtifactTrust(
  id: string,
  input: z.input<typeof artifactTrustPatchSchema>,
  context: ArtifactContext
) {
  const artifact = getArtifactById(id, context);
  if (!artifact) {
    return undefined;
  }
  const parsed = artifactTrustPatchSchema.parse(input);
  const nextDownloadPolicy = parsed.downloadPolicy ?? artifact.downloadPolicy;
  runInTransaction(() => {
    getDatabase()
      .prepare(
        `UPDATE artifacts
         SET artifact_state = ?, download_policy = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(parsed.artifactState, nextDownloadPolicy, nowIso(), id);
    recordArtifactAudit(id, "artifact.trust_state_updated", context, {
      from: artifact.artifactState,
      to: parsed.artifactState,
      fromDownloadPolicy: artifact.downloadPolicy,
      toDownloadPolicy: nextDownloadPolicy,
      reason: parsed.reason
    });
  });
  return getArtifactById(id, context)!;
}

export function listArtifactVersionsPage(
  id: string,
  input: z.input<typeof artifactHistoryQuerySchema> = {},
  context?: ArtifactContext
) {
  if (context && !getArtifactById(id, context)) {
    return undefined;
  }
  const parsed = artifactHistoryQuerySchema.parse(input);
  const total = (
    getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM artifact_versions
         WHERE artifact_id = ?`
      )
      .get(id) as { count: number }
  ).count;
  const versions = getDatabase()
    .prepare(
      `SELECT id, artifact_id, version_number, content_sha256, storage_key,
              byte_size, stored_content_sha256, stored_byte_size,
              content_protection_mode, content_encryption_json, encrypted_at,
              content_password_hint, original_file_name, scan_results_json,
              enrichment_results_json, created_by_actor, created_at
       FROM artifact_versions
       WHERE artifact_id = ?
       ORDER BY version_number DESC
       LIMIT ? OFFSET ?`
    )
    .all(id, parsed.limit, parsed.offset)
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
        scanResults: serializeArtifactPublicPayload(
          artifactScanResultsForResponse(
            parseJsonObject(version.scan_results_json)
          )
        ),
        enrichmentResults: serializeArtifactPublicPayload(
          parseJsonObject(version.enrichment_results_json)
        ),
        createdByActor: version.created_by_actor,
        createdAt: version.created_at
      } satisfies ArtifactVersion;
    });
  return {
    versions,
    total,
    limit: parsed.limit,
    offset: parsed.offset,
    hasMore: parsed.offset + versions.length < total
  };
}

export function listArtifactVersions(
  id: string,
  input: z.input<typeof artifactHistoryQuerySchema> = {},
  context?: ArtifactContext
) {
  return listArtifactVersionsPage(id, input, context)?.versions ?? [];
}

export function listArtifactAuditEventsPage(
  id: string,
  input: z.input<typeof artifactHistoryQuerySchema> = {},
  context?: ArtifactContext
) {
  if (context && !getArtifactById(id, context)) {
    return undefined;
  }
  const parsed = artifactHistoryQuerySchema.parse(input);
  const total = (
    getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM artifact_audit_events
         WHERE artifact_id = ?`
      )
      .get(id) as { count: number }
  ).count;
  const events = getDatabase()
    .prepare(
      `SELECT id, artifact_id, event_type, actor, source, metadata_json, created_at
       FROM artifact_audit_events
       WHERE artifact_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(id, parsed.limit, parsed.offset)
    .map((row) => {
      const event = row as ArtifactAuditEventRow;
      return {
        id: event.id,
        artifactId: event.artifact_id,
        eventType: event.event_type,
        actor: event.actor,
        source: event.source,
        metadata: serializeArtifactPublicPayload(
          parseJsonObject(event.metadata_json)
        ),
        createdAt: event.created_at
      } satisfies ArtifactAuditEvent;
    });
  return {
    events,
    total,
    limit: parsed.limit,
    offset: parsed.offset,
    hasMore: parsed.offset + events.length < total
  };
}

export function listArtifactAuditEvents(
  id: string,
  input: z.input<typeof artifactHistoryQuerySchema> = {},
  context?: ArtifactContext
) {
  return listArtifactAuditEventsPage(id, input, context)?.events ?? [];
}
