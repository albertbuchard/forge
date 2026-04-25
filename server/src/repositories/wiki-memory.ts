import { createHash, randomUUID } from "node:crypto";
import AdmZip, { type AdmZipEntry } from "adm-zip";
import {
  accessSync,
  existsSync,
  readdirSync,
  unlinkSync,
  rmSync
} from "node:fs";
import {
  access,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { resolveDataDir, getDatabase } from "../db.js";
import { decorateOwnedEntity } from "./entity-ownership.js";
import {
  createNoteLinkSchema,
  crudEntityTypeSchema,
  noteKindSchema,
  noteSchema as persistedNoteSchema,
  wikiSearchModeSchema,
  wikiSpaceVisibilitySchema,
  type CreateNoteInput,
  type CrudEntityType,
  type Note,
  type NoteKind
} from "../types.js";
import {
  deleteEncryptedSecret,
  readEncryptedSecret,
  storeEncryptedSecret
} from "./calendar.js";
import { isEntityDeleted } from "./deleted-entities.js";
import { recordDiagnosticLog } from "./diagnostic-logs.js";
import type { SecretsManager } from "../managers/platform/secrets-manager.js";
import type { LlmManager } from "../managers/platform/llm-manager.js";

type NoteRow = {
  id: string;
  kind: NoteKind;
  title: string;
  slug: string;
  space_id: string;
  parent_slug: string | null;
  index_order: number;
  show_in_index: number;
  aliases_json: string;
  summary: string;
  content_markdown: string;
  content_plain: string;
  author: string | null;
  source: Note["source"];
  tags_json: string;
  destroy_at: string | null;
  source_path: string;
  frontmatter_json: string;
  revision_hash: string;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

type NoteLinkRow = {
  note_id: string;
  entity_type: CrudEntityType;
  entity_id: string;
  anchor_key: string;
  created_at: string;
};

type WikiSpaceRow = {
  id: string;
  slug: string;
  label: string;
  description: string;
  owner_user_id: string | null;
  visibility: "personal" | "shared";
  created_at: string;
  updated_at: string;
};

type StoredSecretPayload = {
  apiKey: string;
};

const wikiSpaceSchema = z.object({
  id: z.string(),
  slug: z.string(),
  label: z.string(),
  description: z.string(),
  ownerUserId: z.string().nullable(),
  visibility: wikiSpaceVisibilitySchema,
  createdAt: z.string(),
  updatedAt: z.string()
});

const wikiLinkEdgeSchema = z.object({
  sourceNoteId: z.string(),
  targetType: z.enum(["page", "entity", "unresolved"]),
  targetNoteId: z.string().nullable(),
  targetEntityType: crudEntityTypeSchema.nullable(),
  targetEntityId: z.string().nullable(),
  label: z.string(),
  rawTarget: z.string(),
  isEmbed: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});

const wikiMediaAssetSchema = z.object({
  id: z.string(),
  spaceId: z.string(),
  noteId: z.string().nullable(),
  label: z.string(),
  mimeType: z.string(),
  fileName: z.string(),
  filePath: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  checksum: z.string(),
  transcriptNoteId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string()
});

const wikiLlmProfileSchema = z.object({
  id: z.string(),
  label: z.string(),
  provider: z.string(),
  baseUrl: z.string(),
  model: z.string(),
  secretId: z.string().nullable(),
  systemPrompt: z.string(),
  enabled: z.boolean(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string()
});

const wikiEmbeddingProfileSchema = z.object({
  id: z.string(),
  label: z.string(),
  provider: z.string(),
  baseUrl: z.string(),
  model: z.string(),
  secretId: z.string().nullable(),
  dimensions: z.number().int().positive().nullable(),
  chunkSize: z.number().int().positive(),
  chunkOverlap: z.number().int().nonnegative(),
  enabled: z.boolean(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string()
});

const wikiSettingsPayloadSchema = z.object({
  spaces: z.array(wikiSpaceSchema),
  llmProfiles: z.array(wikiLlmProfileSchema),
  embeddingProfiles: z.array(wikiEmbeddingProfileSchema)
});

type WikiPageTreeNode = {
  page: z.infer<typeof persistedNoteSchema>;
  children: WikiPageTreeNode[];
};

const wikiPageTreeNodeSchema: z.ZodType<
  WikiPageTreeNode,
  z.ZodTypeDef,
  unknown
> = z.lazy(
  (): z.ZodType<WikiPageTreeNode, z.ZodTypeDef, unknown> =>
    z.object({
      page: persistedNoteSchema,
      children: z.array(wikiPageTreeNodeSchema)
    })
);

const wikiHealthPayloadSchema = z.object({
  space: wikiSpaceSchema,
  indexPath: z.string(),
  rawDirectoryPath: z.string(),
  pageCount: z.number().int().nonnegative(),
  wikiPageCount: z.number().int().nonnegative(),
  evidencePageCount: z.number().int().nonnegative(),
  assetCount: z.number().int().nonnegative(),
  rawSourceCount: z.number().int().nonnegative(),
  unresolvedLinks: z.array(
    z.object({
      sourceNoteId: z.string(),
      sourceSlug: z.string(),
      sourceTitle: z.string(),
      rawTarget: z.string(),
      updatedAt: z.string()
    })
  ),
  orphanPages: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      title: z.string(),
      kind: noteKindSchema,
      updatedAt: z.string()
    })
  ),
  missingSummaries: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      title: z.string(),
      updatedAt: z.string()
    })
  ),
  enabledEmbeddingProfiles: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      model: z.string()
    })
  ),
  enabledLlmProfiles: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      model: z.string()
    })
  )
});

const wikiIngestJobLogSchema = z.object({
  id: z.string(),
  level: z.string(),
  message: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string()
});

const wikiIngestJobAssetSchema = z.object({
  id: z.string(),
  status: z.string(),
  sourceKind: z.string(),
  sourceLocator: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  filePath: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  checksum: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string()
});

const wikiIngestJobCandidateSchema = z.object({
  id: z.string(),
  sourceAssetId: z.string().nullable(),
  candidateType: z.string(),
  status: z.string(),
  title: z.string(),
  summary: z.string(),
  targetKey: z.string(),
  payload: z.record(z.string(), z.unknown()),
  publishedNoteId: z.string().nullable(),
  publishedEntityType: z.string().nullable(),
  publishedEntityId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

const wikiIngestJobPayloadSchema = z.object({
  job: z.object({
    id: z.string(),
    spaceId: z.string(),
    llmProfileId: z.string().nullable(),
    status: z.string(),
    phase: z.string(),
    progressPercent: z.number().int().nonnegative(),
    totalFiles: z.number().int().nonnegative(),
    processedFiles: z.number().int().nonnegative(),
    createdPageCount: z.number().int().nonnegative(),
    createdEntityCount: z.number().int().nonnegative(),
    acceptedCount: z.number().int().nonnegative(),
    rejectedCount: z.number().int().nonnegative(),
    latestMessage: z.string(),
    sourceKind: z.string(),
    sourceLocator: z.string(),
    mimeType: z.string(),
    titleHint: z.string(),
    summary: z.string(),
    pageNoteId: z.string().nullable(),
    createdByActor: z.string().nullable(),
    errorMessage: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    completedAt: z.string().nullable()
  }),
  items: z.array(
    z.object({
      id: z.string(),
      itemType: z.string(),
      status: z.string(),
      noteId: z.string().nullable(),
      mediaAssetId: z.string().nullable(),
      payload: z.record(z.string(), z.unknown()),
      createdAt: z.string(),
      updatedAt: z.string()
    })
  ),
  logs: z.array(wikiIngestJobLogSchema),
  assets: z.array(wikiIngestJobAssetSchema),
  candidates: z.array(wikiIngestJobCandidateSchema)
});

const listWikiIngestJobsQuerySchema = z.object({
  spaceId: z.string().trim().optional(),
  limit: z.coerce.number().int().positive().max(200).default(20)
});

export const reviewWikiIngestJobSchema = z.object({
  decisions: z
    .array(
      z
        .object({
          candidateId: z.string().trim().min(1),
          keep: z.boolean().optional(),
          action: z
            .enum(["keep", "discard", "map_existing", "merge_existing"])
            .optional(),
          mappedEntityType: crudEntityTypeSchema.optional(),
          mappedEntityId: z.string().trim().min(1).optional(),
          targetNoteId: z.string().trim().min(1).optional()
        })
        .superRefine((value, context) => {
          if (value.action === "map_existing") {
            if (!value.mappedEntityType) {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["mappedEntityType"],
                message:
                  "mappedEntityType is required when action is map_existing"
              });
            }
            if (!value.mappedEntityId) {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["mappedEntityId"],
                message:
                  "mappedEntityId is required when action is map_existing"
              });
            }
          }
          if (value.action === "merge_existing" && !value.targetNoteId) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["targetNoteId"],
              message: "targetNoteId is required when action is merge_existing"
            });
          }
          if (value.action === undefined && value.keep === undefined) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["action"],
              message: "Either keep or action is required"
            });
          }
        })
    )
    .min(1)
});

export const createWikiSpaceSchema = z.object({
  label: z.string().trim().min(1),
  slug: z.string().trim().optional(),
  description: z.string().trim().default(""),
  ownerUserId: z.string().trim().nullable().optional(),
  visibility: wikiSpaceVisibilitySchema.default("personal")
});

const wikiLlmReasoningEffortSchema = z.enum([
  "none",
  "low",
  "medium",
  "high",
  "xhigh"
]);

const wikiLlmVerbositySchema = z.enum(["low", "medium", "high"]);

export const upsertWikiLlmProfileSchema = z.object({
  id: z.string().trim().optional(),
  label: z.string().trim().min(1),
  provider: z.string().trim().min(1).default("openai-responses"),
  baseUrl: z.string().trim().default("https://api.openai.com/v1"),
  model: z.string().trim().min(1),
  apiKey: z.string().trim().optional(),
  secretId: z.string().trim().nullable().optional(),
  systemPrompt: z.string().trim().default(""),
  reasoningEffort: wikiLlmReasoningEffortSchema.optional(),
  verbosity: wikiLlmVerbositySchema.optional(),
  enabled: z.boolean().default(true),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const testWikiLlmProfileSchema = z.object({
  profileId: z.string().trim().optional(),
  provider: z.string().trim().min(1).default("openai-responses"),
  baseUrl: z.string().trim().default("https://api.openai.com/v1"),
  model: z.string().trim().min(1),
  apiKey: z.string().trim().optional(),
  reasoningEffort: wikiLlmReasoningEffortSchema.optional(),
  verbosity: wikiLlmVerbositySchema.optional()
});

export const upsertWikiEmbeddingProfileSchema = z.object({
  id: z.string().trim().optional(),
  label: z.string().trim().min(1),
  provider: z.string().trim().min(1).default("openai-compatible"),
  baseUrl: z.string().trim().default("https://api.openai.com/v1"),
  model: z.string().trim().min(1).default("text-embedding-3-small"),
  dimensions: z.number().int().positive().nullable().optional(),
  chunkSize: z.number().int().positive().default(1200),
  chunkOverlap: z.number().int().nonnegative().default(200),
  apiKey: z.string().trim().optional(),
  enabled: z.boolean().default(true),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const wikiSearchQuerySchema = z.object({
  spaceId: z.string().trim().optional(),
  kind: noteKindSchema.optional(),
  mode: wikiSearchModeSchema.default("hybrid"),
  query: z.string().trim().default(""),
  profileId: z.string().trim().optional(),
  linkedEntity: z
    .object({
      entityType: crudEntityTypeSchema,
      entityId: z.string().trim().min(1)
    })
    .optional(),
  limit: z.coerce.number().int().positive().max(50).default(20)
});

export const syncWikiVaultSchema = z.object({
  spaceId: z.string().trim().optional()
});

export const reindexWikiEmbeddingsSchema = z.object({
  spaceId: z.string().trim().optional(),
  profileId: z.string().trim().optional()
});

export const createWikiIngestJobSchema = z.object({
  spaceId: z.string().trim().optional(),
  titleHint: z.string().trim().default(""),
  sourceKind: z.enum(["raw_text", "local_path", "url"]),
  sourceText: z.string().default(""),
  sourcePath: z.string().trim().optional(),
  sourceUrl: z.string().trim().optional(),
  mimeType: z.string().trim().default(""),
  llmProfileId: z.string().trim().optional(),
  parseStrategy: z.enum(["auto", "text_only", "multimodal"]).default("auto"),
  entityProposalMode: z.enum(["none", "suggest"]).default("suggest"),
  userId: z.string().trim().nullable().optional(),
  createAsKind: noteKindSchema.default("wiki"),
  linkedEntityHints: z.array(createNoteLinkSchema).default([])
});

export type WikiSpace = z.infer<typeof wikiSpaceSchema>;
export type WikiLinkEdge = z.infer<typeof wikiLinkEdgeSchema>;
export type WikiMediaAsset = z.infer<typeof wikiMediaAssetSchema>;
export type WikiLlmProfile = z.infer<typeof wikiLlmProfileSchema>;
export type WikiEmbeddingProfile = z.infer<typeof wikiEmbeddingProfileSchema>;
export type WikiSettingsPayload = z.infer<typeof wikiSettingsPayloadSchema>;
export type WikiHealthPayload = z.infer<typeof wikiHealthPayloadSchema>;
export type WikiIngestJobPayload = z.infer<typeof wikiIngestJobPayloadSchema>;
export type WikiIngestJobCandidate = z.infer<
  typeof wikiIngestJobCandidateSchema
>;

type PreparedNoteWikiFields = {
  kind: NoteKind;
  title: string;
  slug: string;
  spaceId: string;
  parentSlug: string | null;
  indexOrder: number;
  showInIndex: boolean;
  aliases: string[];
  summary: string;
};

function nowIso() {
  return new Date().toISOString();
}

const WIKI_STARTER_PAGES = [
  {
    slug: "index",
    title: "Home",
    parentSlug: null,
    indexOrder: 0,
    summary: "Top-level home page for this wiki space."
  },
  {
    slug: "people",
    title: "People",
    parentSlug: "index",
    indexOrder: 10,
    summary: "People, collaborators, and relationship context."
  },
  {
    slug: "projects",
    title: "Projects",
    parentSlug: "index",
    indexOrder: 20,
    summary: "Active projects, initiatives, and workstreams."
  },
  {
    slug: "concepts",
    title: "Concepts",
    parentSlug: "index",
    indexOrder: 30,
    summary: "Ideas, themes, philosophies, and operating concepts."
  },
  {
    slug: "sources",
    title: "Sources",
    parentSlug: "index",
    indexOrder: 40,
    summary: "Raw materials, references, imports, and citations."
  },
  {
    slug: "chronicle",
    title: "Chronicle",
    parentSlug: "index",
    indexOrder: 50,
    summary: "Timeline-style notes, field logs, and ongoing narrative."
  }
] as const;

function normalizeAnchorKey(anchorKey: string) {
  return anchorKey.trim().length > 0 ? anchorKey.trim() : null;
}

function normalizeTags(tags: string[] | undefined) {
  if (!tags) {
    return [];
  }
  const seen = new Set<string>();
  return tags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag) => {
      const normalized = tag.toLowerCase();
      if (seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    });
}

function normalizeAliases(aliases: string[] | undefined) {
  if (!aliases) {
    return [];
  }
  const seen = new Set<string>();
  return aliases
    .map((alias) => alias.trim())
    .filter(Boolean)
    .filter((alias) => {
      const normalized = alias.toLowerCase();
      if (seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    });
}

function parseJsonRecord(raw: string | null | undefined) {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseJsonStringArray(raw: string | null | undefined) {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function readStringRecordValue(
  record: Record<string, unknown>,
  key: string
) {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function listLinkRowsForNotes(noteIds: string[]) {
  if (noteIds.length === 0) {
    return [];
  }
  const placeholders = noteIds.map(() => "?").join(", ");
  return getDatabase()
    .prepare(
      `SELECT note_id, entity_type, entity_id, anchor_key, created_at
       FROM note_links
       WHERE note_id IN (${placeholders})
       ORDER BY created_at ASC`
    )
    .all(...noteIds) as NoteLinkRow[];
}

function mapLinks(rows: NoteLinkRow[]) {
  return rows.map((row) => ({
    entityType: row.entity_type,
    entityId: row.entity_id,
    anchorKey: normalizeAnchorKey(row.anchor_key)
  }));
}

function mapNoteRow(row: NoteRow, linkRows: NoteLinkRow[]) {
  return persistedNoteSchema.parse(
    decorateOwnedEntity("note", {
      id: row.id,
      kind: row.kind,
      title: row.title,
      slug: row.slug,
      spaceId: row.space_id,
      parentSlug: row.parent_slug,
      indexOrder: row.index_order,
      showInIndex: row.show_in_index === 1,
      aliases: normalizeAliases(parseJsonStringArray(row.aliases_json)),
      summary: row.summary,
      contentMarkdown: row.content_markdown,
      contentPlain: row.content_plain,
      author: row.author,
      source: row.source,
      sourcePath: row.source_path,
      frontmatter: parseJsonRecord(row.frontmatter_json),
      revisionHash: row.revision_hash,
      lastSyncedAt: row.last_synced_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      links: mapLinks(linkRows),
      tags: normalizeTags(parseJsonStringArray(row.tags_json)),
      destroyAt: row.destroy_at
    })
  );
}

function getNoteRows(whereClause = "", params: Array<string | number> = []) {
  return getDatabase()
    .prepare(
      `SELECT id, kind, title, slug, space_id, aliases_json, summary, content_markdown, content_plain, author, source,
              tags_json, destroy_at, source_path, frontmatter_json, revision_hash, last_synced_at, parent_slug, index_order, show_in_index, created_at, updated_at
       FROM notes
       ${whereClause}
       ORDER BY updated_at DESC`
    )
    .all(...params) as NoteRow[];
}

function getNoteByIdRaw(noteId: string) {
  return getDatabase()
    .prepare(
      `SELECT id, kind, title, slug, space_id, aliases_json, summary, content_markdown, content_plain, author, source,
              tags_json, destroy_at, source_path, frontmatter_json, revision_hash, last_synced_at, parent_slug, index_order, show_in_index, created_at, updated_at
       FROM notes
       WHERE id = ?`
    )
    .get(noteId) as NoteRow | undefined;
}

function getNoteBySlugRaw(
  spaceId: string,
  slug: string,
  exceptNoteId?: string
) {
  const row = getDatabase()
    .prepare(
      `SELECT id, kind, title, slug, space_id, aliases_json, summary, content_markdown, content_plain, author, source,
              tags_json, destroy_at, source_path, frontmatter_json, revision_hash, last_synced_at, parent_slug, index_order, show_in_index, created_at, updated_at
       FROM notes
       WHERE space_id = ?
         AND lower(slug) = lower(?)
         ${exceptNoteId ? "AND id != ?" : ""}
       LIMIT 1`
    )
    .get(
      ...(exceptNoteId ? [spaceId, slug, exceptNoteId] : [spaceId, slug])
    ) as NoteRow | undefined;
  return row;
}

function getNoteByTitleRaw(
  spaceId: string,
  title: string,
  exceptNoteId?: string
) {
  return getDatabase()
    .prepare(
      `SELECT id, kind, title, slug, space_id, aliases_json, summary, content_markdown, content_plain, author, source,
              tags_json, destroy_at, source_path, frontmatter_json, revision_hash, last_synced_at, parent_slug, index_order, show_in_index, created_at, updated_at
       FROM notes
       WHERE space_id = ?
         AND lower(title) = lower(?)
         ${exceptNoteId ? "AND id != ?" : ""}
       LIMIT 1`
    )
    .get(
      ...(exceptNoteId ? [spaceId, title, exceptNoteId] : [spaceId, title])
    ) as NoteRow | undefined;
}

function listNotesByTitleRaw(
  spaceId: string,
  title: string,
  exceptNoteId?: string
) {
  return getDatabase()
    .prepare(
      `SELECT id, kind, title, slug, space_id, aliases_json, summary, content_markdown, content_plain, author, source,
              tags_json, destroy_at, source_path, frontmatter_json, revision_hash, last_synced_at, parent_slug, index_order, show_in_index, created_at, updated_at
       FROM notes
       WHERE space_id = ?
         AND lower(title) = lower(?)
         ${exceptNoteId ? "AND id != ?" : ""}
       ORDER BY updated_at DESC`
    )
    .all(
      ...(exceptNoteId ? [spaceId, title, exceptNoteId] : [spaceId, title])
    ) as NoteRow[];
}

function getActiveNoteByIdRaw(noteId: string) {
  const row = getNoteByIdRaw(noteId);
  if (!row || isEntityDeleted("note", row.id)) {
    return null;
  }
  return row;
}

function getActiveNoteBySlugRaw(
  spaceId: string,
  slug: string,
  exceptNoteId?: string
) {
  const row = getNoteBySlugRaw(spaceId, slug, exceptNoteId);
  if (!row || isEntityDeleted("note", row.id)) {
    return null;
  }
  return row;
}

function scoreReferenceMatch(reference: string, row: NoteRow) {
  const referenceSlug = slugify(reference);
  const titleSlug = slugify(row.title);

  if (referenceSlug && row.slug === referenceSlug) {
    return 0;
  }
  if (titleSlug && row.slug === titleSlug) {
    return 1;
  }

  const parseSuffix = (base: string) => {
    if (!base || !row.slug.startsWith(`${base}-`)) {
      return null;
    }
    const suffix = Number(row.slug.slice(base.length + 1));
    return Number.isFinite(suffix) ? suffix : null;
  };

  const referenceSuffix = parseSuffix(referenceSlug);
  if (referenceSuffix !== null) {
    return 100 + referenceSuffix;
  }

  const titleSuffix = parseSuffix(titleSlug);
  if (titleSuffix !== null) {
    return 200 + titleSuffix;
  }

  return 10_000;
}

function chooseBestActiveReferenceMatch(reference: string, rows: NoteRow[]) {
  const activeRows = rows.filter((row) => !isEntityDeleted("note", row.id));
  if (activeRows.length === 0) {
    return null;
  }
  return [...activeRows].sort((left, right) => {
    const leftScore = scoreReferenceMatch(reference, left);
    const rightScore = scoreReferenceMatch(reference, right);
    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }
    if (left.updated_at !== right.updated_at) {
      return right.updated_at.localeCompare(left.updated_at);
    }
    return left.id.localeCompare(right.id);
  })[0]!;
}

function getActiveNoteByReferenceRaw(
  spaceId: string,
  reference: string,
  exceptNoteId?: string
) {
  const normalized = reference.trim();
  if (!normalized) {
    return null;
  }

  const slugMatch = getActiveNoteBySlugRaw(spaceId, normalized, exceptNoteId);
  if (slugMatch) {
    return slugMatch;
  }

  const titleMatch = chooseBestActiveReferenceMatch(
    normalized,
    listNotesByTitleRaw(spaceId, normalized, exceptNoteId)
  );
  if (titleMatch) {
    return titleMatch;
  }

  const lowered = normalized.toLowerCase();
  const aliasMatch = chooseBestActiveReferenceMatch(
    normalized,
    getNoteRows("WHERE space_id = ?", [spaceId]).filter(
      (row) =>
        row.id !== exceptNoteId &&
        parseJsonStringArray(row.aliases_json).some(
          (alias) => alias.trim().toLowerCase() === lowered
        )
    )
  );
  return aliasMatch ?? null;
}

function buildContentPlain(markdown: string) {
  return markdown
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, "").trim())
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(
      /\[\[([^\]|]+)\|?([^\]]*)\]\]/g,
      (_match, left: string, right: string) => (right || left).trim()
    )
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\r/g, "")
    .trim();
}

function inferTitle(markdown: string, fallback: string) {
  const headingMatch = markdown.match(/^#{1,6}\s+(.+)$/m);
  if (headingMatch?.[1]?.trim()) {
    return headingMatch[1].trim().slice(0, 160);
  }
  const plain = buildContentPlain(markdown);
  if (plain.trim()) {
    return plain.trim().split("\n")[0]!.slice(0, 160);
  }
  return fallback;
}

function inferSummary(markdown: string) {
  const plain = buildContentPlain(markdown).replace(/\s+/g, " ").trim();
  return plain.slice(0, 240);
}

function stripLeadingHeading(markdown: string, title: string) {
  const normalizedTitle = title.trim().toLowerCase();
  const trimmed = markdown.trim();
  const match = trimmed.match(/^#\s+(.+?)\n+/);
  if (!match) {
    return trimmed;
  }
  const heading = match[1]?.trim().toLowerCase() ?? "";
  if (heading !== normalizedTitle) {
    return trimmed;
  }
  return trimmed.slice(match[0].length).trim();
}

function mergeWikiPageContent(targetMarkdown: string, incoming: {
  title: string;
  markdown: string;
}) {
  const mergedBody =
    stripLeadingHeading(incoming.markdown, incoming.title) ||
    incoming.markdown.trim();
  return [
    targetMarkdown.trim(),
    "",
    `## ${incoming.title}`,
    "",
    mergedBody
  ]
    .filter((part) => part.trim().length > 0)
    .join("\n");
}

function slugify(value: string) {
  const normalized = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
  return normalized || `page-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
}

function buildUniqueSlug(
  spaceId: string,
  requestedSlug: string,
  noteId: string
) {
  const base = slugify(requestedSlug);
  let candidate = base;
  let suffix = 2;
  while (getNoteBySlugRaw(spaceId, candidate, noteId)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function mapWikiSpace(row: WikiSpaceRow) {
  return wikiSpaceSchema.parse({
    id: row.id,
    slug: row.slug,
    label: row.label,
    description: row.description,
    ownerUserId: row.owner_user_id,
    visibility: row.visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function getWikiRootDir() {
  return path.join(resolveDataDir(), "wiki-ingest");
}

function getSpaceStorageDir(space: WikiSpace) {
  if (space.visibility === "shared") {
    return path.join(getWikiRootDir(), "shared", space.slug);
  }
  return path.join(getWikiRootDir(), "users", space.ownerUserId ?? space.slug);
}

function getSpaceRawDir(space: WikiSpace) {
  return path.join(getSpaceStorageDir(space), "raw");
}

function buildNoteFrontmatter(note: Note) {
  return {
    ...note.frontmatter,
    id: note.id,
    kind: note.kind,
    title: note.title,
    slug: note.slug,
    spaceId: note.spaceId,
    parentSlug: note.parentSlug,
    indexOrder: note.indexOrder,
    showInIndex: note.showInIndex,
    aliases: note.aliases,
    summary: note.summary,
    tags: note.tags ?? [],
    linkedEntities: note.links.map((link) => ({
      entityType: link.entityType,
      entityId: link.entityId,
      anchorKey: link.anchorKey
    })),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    lastSyncedAt: note.lastSyncedAt,
    author: note.author
  };
}

function hashContent(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hashBuffer(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function buildLinkedEntityTokens(note: Note) {
  return note.links
    .map((link) => `${link.entityType}:${link.entityId}`)
    .join(" ");
}

function buildWikiFtsQuery(query: string) {
  const tokens = query
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/["*']/g, "").trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }
  return tokens.map((token) => `${token}*`).join(" AND ");
}

function deleteWikiSearchRow(noteId: string) {
  getDatabase()
    .prepare(`DELETE FROM wiki_pages_fts WHERE note_id = ?`)
    .run(noteId);
}

function chunkHeadingAware(
  markdown: string,
  chunkSize: number,
  chunkOverlap: number
) {
  const stripped = markdown
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/\r/g, "");
  const sections: Array<{ headingPath: string; text: string }> = [];
  const lines = stripped.split("\n");
  let currentHeading = "Document";
  let currentLines: string[] = [];
  const flush = () => {
    const text = currentLines.join("\n").trim();
    if (text) {
      sections.push({ headingPath: currentHeading, text });
    }
    currentLines = [];
  };

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      flush();
      currentHeading = match[2].trim();
      continue;
    }
    currentLines.push(line);
  }
  flush();

  const chunks: Array<{
    key: string;
    headingPath: string;
    contentText: string;
  }> = [];
  sections.forEach((section, sectionIndex) => {
    const content = section.text.replace(/\s+/g, " ").trim();
    if (!content) {
      return;
    }
    if (content.length <= chunkSize) {
      chunks.push({
        key: `${sectionIndex}-0`,
        headingPath: section.headingPath,
        contentText: content
      });
      return;
    }
    let offset = 0;
    let partIndex = 0;
    while (offset < content.length) {
      const slice = content.slice(offset, offset + chunkSize).trim();
      if (slice) {
        chunks.push({
          key: `${sectionIndex}-${partIndex}`,
          headingPath: section.headingPath,
          contentText: slice
        });
      }
      if (offset + chunkSize >= content.length) {
        break;
      }
      offset += Math.max(1, chunkSize - chunkOverlap);
      partIndex += 1;
    }
  });
  return chunks;
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length !== right.length || left.length === 0) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftNorm += left[index]! * left[index]!;
    rightNorm += right[index]! * right[index]!;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

async function getFetchedContent(
  sourceKind: "raw_text" | "local_path" | "url",
  options: {
    sourceText: string;
    sourcePath?: string;
    sourceUrl?: string;
    mimeType?: string;
  }
) {
  if (sourceKind === "raw_text") {
    return {
      locator: "raw_text",
      contentText: options.sourceText,
      mimeType: options.mimeType || "text/plain",
      fileName: "inline.txt",
      binary: null as Buffer | null
    };
  }

  if (sourceKind === "local_path") {
    const filePath = options.sourcePath?.trim();
    if (!filePath) {
      throw new Error("sourcePath is required for local_path ingest.");
    }
    const payload = await readFile(filePath);
    const fileName = path.basename(filePath);
    const mimeType =
      options.mimeType?.trim() || inferMimeTypeFromPath(fileName);
    return {
      locator: filePath,
      contentText:
        mimeType.startsWith("text/") ||
        mimeType === "application/json" ||
        mimeType === "text/markdown"
          ? payload.toString("utf8")
          : "",
      mimeType,
      fileName,
      binary: payload
    };
  }

  const sourceUrl = options.sourceUrl?.trim();
  if (!sourceUrl) {
    throw new Error("sourceUrl is required for url ingest.");
  }
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Could not fetch ${sourceUrl}: ${response.status}`);
  }
  const mimeType =
    options.mimeType?.trim() ||
    response.headers.get("content-type")?.split(";")[0]?.trim() ||
    "application/octet-stream";
  const arrayBuffer = await response.arrayBuffer();
  const binary = Buffer.from(arrayBuffer);
  const fileName =
    sourceUrl.split("/").pop()?.split("?")[0]?.trim() || "remote-source.bin";
  return {
    locator: sourceUrl,
    contentText:
      mimeType.startsWith("text/") ||
      mimeType === "application/json" ||
      mimeType === "text/markdown"
        ? binary.toString("utf8")
        : "",
    mimeType,
    fileName,
    binary
  };
}

function inferExtensionFromMimeType(mimeType: string) {
  switch (mimeType) {
    case "text/markdown":
      return ".md";
    case "text/plain":
      return ".txt";
    case "text/html":
      return ".html";
    case "application/json":
      return ".json";
    case "application/pdf":
      return ".pdf";
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "audio/mpeg":
      return ".mp3";
    case "audio/wav":
      return ".wav";
    case "audio/mp4":
      return ".m4a";
    case "video/mp4":
      return ".mp4";
    case "video/quicktime":
      return ".mov";
    default:
      return "";
  }
}

function inferMimeTypeFromPath(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  switch (extension) {
    case ".md":
    case ".markdown":
      return "text/markdown";
    case ".txt":
      return "text/plain";
    case ".html":
    case ".htm":
      return "text/html";
    case ".json":
      return "application/json";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".m4a":
      return "audio/mp4";
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

async function readSecretApiKey(
  secretId: string | null | undefined,
  secrets: SecretsManager
) {
  if (!secretId) {
    return null;
  }
  const cipherText = readEncryptedSecret(secretId);
  if (!cipherText) {
    return null;
  }
  const payload = secrets.openJson<StoredSecretPayload>(cipherText);
  return payload.apiKey || null;
}

async function compileTextWithLlm(
  profile: WikiLlmProfile,
  secrets: SecretsManager,
  input: { titleHint: string; rawText: string; mimeType: string }
) {
  const apiKey = await readSecretApiKey(profile.secretId, secrets);
  if (!apiKey) {
    return null;
  }

  const prompt = [
    "You compile user-provided source material into a local wiki page.",
    "Return JSON with keys title, summary, markdown, tags, entityProposals, pageUpdateSuggestions, articleCandidates.",
    "The markdown should be concise, structured, and agent-readable.",
    "entityProposals should be an array of objects with entityType, title, summary, rationale, confidence, and suggestedFields.",
    "pageUpdateSuggestions should be an array of objects with targetSlug, rationale, and patchSummary.",
    "articleCandidates should be an array of objects with title, slug, rationale, and summary.",
    profile.systemPrompt.trim()
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch(
    `${profile.baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: profile.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: prompt
          },
          {
            role: "user",
            content: `Title hint: ${input.titleHint || "none"}\nMime type: ${input.mimeType}\n\nSource:\n${input.rawText.slice(0, 24_000)}`
          }
        ]
      })
    }
  );
  if (!response.ok) {
    throw new Error(`LLM compilation failed: ${response.status}`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{
      message?: { content?: string };
    }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    return null;
  }
  try {
    const parsed = JSON.parse(content) as {
      title?: string;
      summary?: string;
      markdown?: string;
      tags?: string[];
      entityProposals?: Array<Record<string, unknown>>;
      pageUpdateSuggestions?: Array<Record<string, unknown>>;
      articleCandidates?: Array<Record<string, unknown>>;
    };
    return {
      title: parsed.title?.trim() || input.titleHint || "Imported source",
      summary: parsed.summary?.trim() || "",
      markdown: parsed.markdown?.trim() || input.rawText.trim(),
      tags: normalizeTags(parsed.tags),
      entityProposals: Array.isArray(parsed.entityProposals)
        ? parsed.entityProposals.filter(
            (entry): entry is Record<string, unknown> =>
              entry !== null && typeof entry === "object"
          )
        : [],
      pageUpdateSuggestions: Array.isArray(parsed.pageUpdateSuggestions)
        ? parsed.pageUpdateSuggestions.filter(
            (entry): entry is Record<string, unknown> =>
              entry !== null && typeof entry === "object"
          )
        : [],
      articleCandidates: Array.isArray(parsed.articleCandidates)
        ? parsed.articleCandidates.filter(
            (entry): entry is Record<string, unknown> =>
              entry !== null && typeof entry === "object"
          )
        : []
    };
  } catch {
    return null;
  }
}

async function compileImageWithLlm(
  profile: WikiLlmProfile,
  secrets: SecretsManager,
  input: { titleHint: string; binary: Buffer; mimeType: string }
) {
  const apiKey = await readSecretApiKey(profile.secretId, secrets);
  if (!apiKey) {
    return null;
  }

  const prompt = [
    "You compile a user-provided image into a local wiki page.",
    "Return JSON with keys title, summary, markdown, tags, entityProposals, pageUpdateSuggestions, articleCandidates.",
    "Describe the image, capture useful extracted text when visible, and keep the markdown structured for an agent memory wiki.",
    "entityProposals should be an array of objects with entityType, title, summary, rationale, confidence, and suggestedFields.",
    "pageUpdateSuggestions should be an array of objects with targetSlug, rationale, and patchSummary.",
    "articleCandidates should be an array of objects with title, slug, rationale, and summary.",
    profile.systemPrompt.trim()
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch(
    `${profile.baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: profile.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: prompt
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Title hint: ${input.titleHint || "none"}\nMime type: ${input.mimeType}`
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${input.mimeType};base64,${input.binary.toString("base64")}`,
                  detail: "low"
                }
              }
            ]
          }
        ]
      })
    }
  );
  if (!response.ok) {
    throw new Error(`LLM image compilation failed: ${response.status}`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{
      message?: { content?: string };
    }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    return null;
  }
  try {
    const parsed = JSON.parse(content) as {
      title?: string;
      summary?: string;
      markdown?: string;
      tags?: string[];
      entityProposals?: Array<Record<string, unknown>>;
      pageUpdateSuggestions?: Array<Record<string, unknown>>;
      articleCandidates?: Array<Record<string, unknown>>;
    };
    return {
      title: parsed.title?.trim() || input.titleHint || "Imported image",
      summary: parsed.summary?.trim() || "",
      markdown:
        parsed.markdown?.trim() ||
        `# ${parsed.title?.trim() || input.titleHint || "Imported image"}\n\nImage imported into Forge wiki memory.\n`,
      tags: normalizeTags(parsed.tags),
      entityProposals: Array.isArray(parsed.entityProposals)
        ? parsed.entityProposals.filter(
            (entry): entry is Record<string, unknown> =>
              entry !== null && typeof entry === "object"
          )
        : [],
      pageUpdateSuggestions: Array.isArray(parsed.pageUpdateSuggestions)
        ? parsed.pageUpdateSuggestions.filter(
            (entry): entry is Record<string, unknown> =>
              entry !== null && typeof entry === "object"
          )
        : [],
      articleCandidates: Array.isArray(parsed.articleCandidates)
        ? parsed.articleCandidates.filter(
            (entry): entry is Record<string, unknown> =>
              entry !== null && typeof entry === "object"
          )
        : []
    };
  } catch {
    return null;
  }
}

async function compileSourceWithLlm(
  profile: WikiLlmProfile,
  secrets: SecretsManager,
  input: {
    titleHint: string;
    rawText: string;
    binary: Buffer | null;
    mimeType: string;
    parseStrategy: "auto" | "text_only" | "multimodal";
  }
) {
  if (input.rawText.trim()) {
    return compileTextWithLlm(profile, secrets, {
      titleHint: input.titleHint,
      rawText: input.rawText,
      mimeType: input.mimeType
    });
  }
  if (
    input.binary &&
    input.parseStrategy !== "text_only" &&
    input.mimeType.startsWith("image/")
  ) {
    return compileImageWithLlm(profile, secrets, {
      titleHint: input.titleHint,
      binary: input.binary,
      mimeType: input.mimeType
    });
  }
  return null;
}

async function embedTexts(
  profile: WikiEmbeddingProfile,
  secrets: SecretsManager,
  inputs: string[]
) {
  const apiKey = await readSecretApiKey(profile.secretId, secrets);
  if (!apiKey || inputs.length === 0) {
    return [];
  }
  const response = await fetch(
    `${profile.baseUrl.replace(/\/$/, "")}/embeddings`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: profile.model,
        input: inputs,
        ...(profile.dimensions ? { dimensions: profile.dimensions } : {})
      })
    }
  );
  if (!response.ok) {
    throw new Error(`Embedding request failed: ${response.status}`);
  }
  const payload = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  return (
    payload.data?.map((entry) =>
      Array.isArray(entry.embedding) ? entry.embedding : []
    ) ?? []
  );
}

function findExistingSpaceByOwner(ownerUserId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT id, slug, label, description, owner_user_id, visibility, created_at, updated_at
       FROM wiki_spaces
       WHERE owner_user_id = ?
       ORDER BY created_at ASC
       LIMIT 1`
    )
    .get(ownerUserId) as WikiSpaceRow | undefined;
  return row ? mapWikiSpace(row) : null;
}

function getWikiSpaceById(spaceId: string) {
  const row = getDatabase()
    .prepare(
      `SELECT id, slug, label, description, owner_user_id, visibility, created_at, updated_at
       FROM wiki_spaces
       WHERE id = ?`
    )
    .get(spaceId) as WikiSpaceRow | undefined;
  return row ? mapWikiSpace(row) : null;
}

function ensureSharedWikiSpace() {
  const existing = getWikiSpaceById("wiki_space_shared");
  if (existing) {
    ensureWikiSpaceSeedPages(existing.id);
    return existing;
  }
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO wiki_spaces (id, slug, label, description, owner_user_id, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "wiki_space_shared",
      "shared",
      "Shared Forge Memory",
      "Shared wiki space for SQLite-backed Forge knowledge.",
      null,
      "shared",
      now,
      now
    );
  const space = getWikiSpaceById("wiki_space_shared")!;
  ensureWikiSpaceSeedPages(space.id);
  return space;
}

function ensurePersonalWikiSpace(userId: string) {
  const existing = findExistingSpaceByOwner(userId);
  if (existing) {
    ensureWikiSpaceSeedPages(existing.id);
    return existing;
  }
  const now = nowIso();
  const id = `wiki_space_user_${slugify(userId)}`;
  const slug = `user-${slugify(userId)}`;
  getDatabase()
    .prepare(
      `INSERT INTO wiki_spaces (id, slug, label, description, owner_user_id, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      slug,
      `${userId} Wiki`,
      "Personal Forge wiki space.",
      userId,
      "personal",
      now,
      now
    );
  const space = getWikiSpaceById(id)!;
  ensureWikiSpaceSeedPages(space.id);
  return space;
}

function buildStarterPageMarkdown(
  page: (typeof WIKI_STARTER_PAGES)[number],
  space: WikiSpace
) {
  if (page.slug === "index") {
    return [
      `# ${space.label}`,
      "",
      "This wiki is the explicit memory surface for Forge.",
      "",
      "Use it to maintain durable context, connect pages to Forge entities, and keep knowledge readable for both humans and agents.",
      "",
      "## Starting Points",
      "",
      "- [[people]]",
      "- [[projects]]",
      "- [[concepts]]",
      "- [[sources]]",
      "- [[chronicle]]",
      ""
    ].join("\n");
  }

  return [
    `# ${page.title}`,
    "",
    page.summary,
    "",
    `Return to [[index|Home]].`,
    ""
  ].join("\n");
}

function insertSeedNote(
  space: WikiSpace,
  seed: (typeof WIKI_STARTER_PAGES)[number]
): Note {
  const now = nowIso();
  const noteId = `note_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const markdown = buildStarterPageMarkdown(seed, space);
  const contentPlain = buildContentPlain(markdown);
  const note = persistedNoteSchema.parse({
    id: noteId,
    kind: "wiki",
    title: seed.title,
    slug: seed.slug,
    spaceId: space.id,
    parentSlug: seed.parentSlug,
    indexOrder: seed.indexOrder,
    showInIndex: true,
    aliases: [],
    summary: seed.summary,
    contentMarkdown: markdown,
    contentPlain,
    author: null,
    source: "system",
    sourcePath: "",
    frontmatter: {},
    revisionHash: "",
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
    links: [],
    tags: []
  });

  getDatabase()
    .prepare(
      `INSERT INTO notes (
        id, kind, title, slug, space_id, parent_slug, index_order, show_in_index, aliases_json, summary, content_markdown, content_plain, author, source, tags_json, destroy_at,
        source_path, frontmatter_json, revision_hash, last_synced_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      note.id,
      note.kind,
      note.title,
      note.slug,
      note.spaceId,
      note.parentSlug,
      note.indexOrder,
      note.showInIndex ? 1 : 0,
      JSON.stringify(note.aliases),
      note.summary,
      note.contentMarkdown,
      note.contentPlain,
      note.author,
      note.source,
      JSON.stringify(note.tags),
      null,
      "",
      "{}",
      "",
      null,
      now,
      now
    );
  return note;
}

function ensureWikiSpaceSeedPages(spaceId: string) {
  const space = getWikiSpaceById(spaceId);
  if (!space) {
    return;
  }
  const existingSlugs = new Set(
    getNoteRows("WHERE space_id = ?", [spaceId]).map((row) =>
      row.slug.toLowerCase()
    )
  );
  let inserted = false;
  const insertedNotes: Note[] = [];
  for (const seed of WIKI_STARTER_PAGES) {
    if (existingSlugs.has(seed.slug)) {
      continue;
    }
    insertedNotes.push(insertSeedNote(space, seed));
    existingSlugs.add(seed.slug);
    inserted = true;
  }
  if (inserted) {
    for (const note of insertedNotes) {
      syncNoteWikiArtifacts(note);
    }
  }
}

function resolveSpaceId(spaceId: string | undefined, userId?: string | null) {
  if (spaceId?.trim()) {
    const existing = getWikiSpaceById(spaceId.trim());
    if (existing) {
      return existing.id;
    }
  }
  if (userId?.trim()) {
    return ensurePersonalWikiSpace(userId.trim()).id;
  }
  return ensureSharedWikiSpace().id;
}

export function prepareNoteWikiFields(input: {
  id: string;
  contentMarkdown: string;
  kind?: NoteKind;
  title?: string;
  slug?: string;
  spaceId?: string;
  parentSlug?: string | null;
  indexOrder?: number;
  showInIndex?: boolean;
  aliases?: string[];
  summary?: string;
  userId?: string | null;
  existing?: Pick<
    Note,
    | "kind"
    | "title"
    | "slug"
    | "spaceId"
    | "parentSlug"
    | "indexOrder"
    | "showInIndex"
    | "aliases"
    | "summary"
  > | null;
}) {
  const kind = input.kind ?? input.existing?.kind ?? "evidence";
  const spaceId = resolveSpaceId(
    input.spaceId ?? input.existing?.spaceId,
    input.userId
  );
  const title =
    input.title?.trim() ||
    input.existing?.title?.trim() ||
    inferTitle(
      input.contentMarkdown,
      kind === "wiki" ? "Untitled wiki page" : "Untitled note"
    );
  const slug = buildUniqueSlug(
    spaceId,
    input.slug?.trim() || input.existing?.slug || title,
    input.id
  );
  return {
    kind,
    title,
    slug,
    spaceId,
    parentSlug:
      input.parentSlug === undefined
        ? (input.existing?.parentSlug ?? null)
        : input.parentSlug?.trim() || null,
    indexOrder: input.indexOrder ?? input.existing?.indexOrder ?? 0,
    showInIndex:
      input.showInIndex ?? input.existing?.showInIndex ?? kind === "wiki",
    aliases: normalizeAliases(input.aliases ?? input.existing?.aliases),
    summary:
      input.summary?.trim() ||
      input.existing?.summary?.trim() ||
      inferSummary(input.contentMarkdown)
  } satisfies PreparedNoteWikiFields;
}

export function syncNoteWikiArtifacts(note: Note) {
  const frontmatter = buildNoteFrontmatter(note);
  const revisionHash = hashContent(
    JSON.stringify({
      frontmatter,
      contentMarkdown: note.contentMarkdown
    })
  );

  const now = nowIso();
  getDatabase()
    .prepare(
      `UPDATE notes
       SET source_path = ?, frontmatter_json = ?, revision_hash = ?, last_synced_at = ?
       WHERE id = ?`
    )
    .run("", JSON.stringify(frontmatter), revisionHash, now, note.id);

  upsertWikiSearchRow({
    ...note,
    sourcePath: "",
    frontmatter,
    revisionHash,
    lastSyncedAt: now
  });
  rebuildWikiLinkEdges({
    ...note,
    sourcePath: "",
    frontmatter,
    revisionHash,
    lastSyncedAt: now
  });
}

export function deleteNoteWikiArtifacts(note: Note) {
  deleteWikiSearchRow(note.id);
  getDatabase()
    .prepare(`DELETE FROM wiki_link_edges WHERE source_note_id = ?`)
    .run(note.id);
  getDatabase()
    .prepare(`DELETE FROM wiki_embedding_chunks WHERE note_id = ?`)
    .run(note.id);
  getDatabase()
    .prepare(
      `DELETE FROM wiki_media_assets WHERE note_id = ? OR transcript_note_id = ?`
    )
    .run(note.id, note.id);
}

function upsertWikiSearchRow(note: Note) {
  deleteWikiSearchRow(note.id);
  getDatabase()
    .prepare(
      `INSERT INTO wiki_pages_fts (note_id, title, slug, aliases, summary, content_plain, linked_entities)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      note.id,
      note.title,
      note.slug,
      JSON.stringify(note.aliases ?? []),
      note.summary ?? "",
      note.contentPlain,
      buildLinkedEntityTokens(note)
    );
}

function rebuildWikiLinkEdges(note: Note) {
  const now = nowIso();
  getDatabase()
    .prepare(`DELETE FROM wiki_link_edges WHERE source_note_id = ?`)
    .run(note.id);

  const matches = [...note.contentMarkdown.matchAll(/(!)?\[\[([^[\]]+)\]\]/g)];
  const insert = getDatabase().prepare(
    `INSERT INTO wiki_link_edges (
      source_note_id, target_type, target_note_id, target_entity_type, target_entity_id, label, raw_target, is_embed, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const match of matches) {
    const isEmbed = Boolean(match[1]);
    const token = (match[2] ?? "").trim();
    if (!token) {
      continue;
    }
    const [left, right] = token.split("|");
    const label = right?.trim() || left.trim();

    if (left.startsWith("forge:")) {
      const parts = left.split(":");
      const entityType = parts[1];
      const entityId = parts.slice(2).join(":");
      const parsedEntityType = crudEntityTypeSchema.safeParse(entityType);
      if (parsedEntityType.success && entityId.trim()) {
        insert.run(
          note.id,
          "entity",
          null,
          parsedEntityType.data,
          entityId.trim(),
          label,
          left,
          isEmbed ? 1 : 0,
          now,
          now
        );
        continue;
      }
    }

    const targetNote = getActiveNoteByReferenceRaw(
      note.spaceId,
      left.trim(),
      note.id
    );
    if (targetNote) {
      insert.run(
        note.id,
        "page",
        targetNote.id,
        null,
        null,
        label,
        left.trim(),
        isEmbed ? 1 : 0,
        now,
        now
      );
      continue;
    }

    insert.run(
      note.id,
      "unresolved",
      null,
      null,
      null,
      label,
      left.trim(),
      isEmbed ? 1 : 0,
      now,
      now
    );
  }
}

function loadNotesByIds(noteIds: string[]) {
  if (noteIds.length === 0) {
    return [];
  }
  const placeholders = noteIds.map(() => "?").join(", ");
  const rows = getDatabase()
    .prepare(
      `SELECT id, kind, title, slug, space_id, aliases_json, summary, content_markdown, content_plain, author, source,
              tags_json, destroy_at, source_path, frontmatter_json, revision_hash, last_synced_at, parent_slug, index_order, show_in_index, created_at, updated_at
       FROM notes
       WHERE id IN (${placeholders})`
    )
    .all(...noteIds) as NoteRow[];
  const links = listLinkRowsForNotes(noteIds);
  const linksByNoteId = new Map<string, NoteLinkRow[]>();
  for (const link of links) {
    const current = linksByNoteId.get(link.note_id) ?? [];
    current.push(link);
    linksByNoteId.set(link.note_id, current);
  }
  return rows.map((row) => mapNoteRow(row, linksByNoteId.get(row.id) ?? []));
}

function listAllNotes() {
  const rows = getNoteRows();
  const links = listLinkRowsForNotes(rows.map((row) => row.id));
  const linksByNoteId = new Map<string, NoteLinkRow[]>();
  for (const link of links) {
    const current = linksByNoteId.get(link.note_id) ?? [];
    current.push(link);
    linksByNoteId.set(link.note_id, current);
  }
  return rows
    .filter((row) => !isEntityDeleted("note", row.id))
    .map((row) => mapNoteRow(row, linksByNoteId.get(row.id) ?? []));
}

export function listWikiSpaces() {
  ensureSharedWikiSpace();
  const rows = getDatabase()
    .prepare(
      `SELECT id, slug, label, description, owner_user_id, visibility, created_at, updated_at
       FROM wiki_spaces
       ORDER BY CASE WHEN visibility = 'shared' THEN 0 ELSE 1 END, updated_at DESC`
    )
    .all() as WikiSpaceRow[];
  const spaces = rows.map(mapWikiSpace);
  for (const space of spaces) {
    ensureWikiSpaceSeedPages(space.id);
  }
  return spaces;
}

export function createWikiSpace(input: z.input<typeof createWikiSpaceSchema>) {
  const parsed = createWikiSpaceSchema.parse(input);
  const now = nowIso();
  const id = `wiki_space_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const slug = slugify(parsed.slug || parsed.label);
  getDatabase()
    .prepare(
      `INSERT INTO wiki_spaces (id, slug, label, description, owner_user_id, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      slug,
      parsed.label,
      parsed.description,
      parsed.ownerUserId ?? null,
      parsed.visibility,
      now,
      now
    );
  ensureWikiSpaceSeedPages(id);
  return getWikiSpaceById(id)!;
}

function compareWikiPageOrder(left: Note, right: Note) {
  if ((left.parentSlug ?? "") !== (right.parentSlug ?? "")) {
    return (left.parentSlug ?? "").localeCompare(right.parentSlug ?? "");
  }
  if (left.indexOrder !== right.indexOrder) {
    return left.indexOrder - right.indexOrder;
  }
  return left.title.localeCompare(right.title);
}

export function listWikiPages(query: {
  spaceId?: string;
  kind?: NoteKind;
  limit?: number;
}) {
  const spaceId = resolveSpaceId(query.spaceId, null);
  ensureWikiSpaceSeedPages(spaceId);
  return listAllNotes()
    .filter((note) => note.spaceId === spaceId)
    .filter((note) => (query.kind ? note.kind === query.kind : true))
    .sort(compareWikiPageOrder)
    .slice(0, query.limit ?? 100);
}

export function listWikiPageTree(query: { spaceId?: string; kind?: NoteKind }) {
  const pages = listWikiPages({ ...query, limit: 10_000 }).filter(
    (page) => page.kind === "wiki" && page.showInIndex
  );
  const childrenByParent = new Map<string | null, Note[]>();
  for (const page of pages) {
    const key = page.parentSlug ?? null;
    const current = childrenByParent.get(key) ?? [];
    current.push(page);
    childrenByParent.set(key, current);
  }
  const build = (
    parentSlug: string | null
  ): Array<{ page: Note; children: unknown[] }> =>
    (childrenByParent.get(parentSlug) ?? [])
      .sort(compareWikiPageOrder)
      .map((page) => ({
        page,
        children: build(page.slug)
      }));

  return z.array(wikiPageTreeNodeSchema).parse(build(null));
}

export function getWikiHomePageDetail(input: { spaceId?: string } = {}) {
  const spaceId = resolveSpaceId(input.spaceId, null);
  ensureWikiSpaceSeedPages(spaceId);
  const home = getActiveNoteBySlugRaw(spaceId, "index");
  if (!home) {
    return null;
  }
  return getWikiPageDetail(home.id);
}

export function getWikiPageDetailBySlug(input: {
  spaceId?: string;
  slug: string;
}) {
  const spaceId = resolveSpaceId(input.spaceId, null);
  ensureWikiSpaceSeedPages(spaceId);
  const row = getActiveNoteByReferenceRaw(spaceId, input.slug.trim());
  if (!row) {
    return null;
  }
  return getWikiPageDetail(row.id);
}

export function getWikiPageDetail(noteId: string) {
  const row = getActiveNoteByIdRaw(noteId);
  if (!row) {
    return null;
  }
  const note = mapNoteRow(row, listLinkRowsForNotes([row.id]));
  const backlinkRows = getDatabase()
    .prepare(
      `SELECT source_note_id, target_type, target_note_id, target_entity_type, target_entity_id, label, raw_target, is_embed, created_at, updated_at
       FROM wiki_link_edges
       WHERE target_note_id = ?
       ORDER BY updated_at DESC`
    )
    .all(noteId) as Array<{
    source_note_id: string;
    target_type: "page" | "entity" | "unresolved";
    target_note_id: string | null;
    target_entity_type: CrudEntityType | null;
    target_entity_id: string | null;
    label: string;
    raw_target: string;
    is_embed: number;
    created_at: string;
    updated_at: string;
  }>;
  const assets = getDatabase()
    .prepare(
      `SELECT id, space_id, note_id, label, mime_type, file_name, file_path, size_bytes, checksum, transcript_note_id, metadata_json, created_at, updated_at
       FROM wiki_media_assets
       WHERE note_id = ? OR transcript_note_id = ?
       ORDER BY updated_at DESC`
    )
    .all(noteId, noteId) as Array<{
    id: string;
    space_id: string;
    note_id: string | null;
    label: string;
    mime_type: string;
    file_name: string;
    file_path: string;
    size_bytes: number;
    checksum: string;
    transcript_note_id: string | null;
    metadata_json: string;
    created_at: string;
    updated_at: string;
  }>;

  const backlinkSourceNotes = loadNotesByIds(
    Array.from(new Set(backlinkRows.map((row) => row.source_note_id)))
  );
  const backlinkSourceById = new Map(
    backlinkSourceNotes.map((entry) => [entry.id, entry])
  );

  return {
    page: note,
    backlinks: backlinkRows.map((row) =>
      wikiLinkEdgeSchema.parse({
        sourceNoteId: row.source_note_id,
        targetType: row.target_type,
        targetNoteId: row.target_note_id,
        targetEntityType: row.target_entity_type,
        targetEntityId: row.target_entity_id,
        label: row.label,
        rawTarget: row.raw_target,
        isEmbed: row.is_embed === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })
    ),
    backlinkSourceNotes,
    assets: assets.map((row) =>
      wikiMediaAssetSchema.parse({
        id: row.id,
        spaceId: row.space_id,
        noteId: row.note_id,
        label: row.label,
        mimeType: row.mime_type,
        fileName: row.file_name,
        filePath: row.file_path,
        sizeBytes: row.size_bytes,
        checksum: row.checksum,
        transcriptNoteId: row.transcript_note_id,
        metadata: parseJsonRecord(row.metadata_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })
    ),
    backlinksBySourceId: Object.fromEntries(
      backlinkRows.map((row) => [
        row.source_note_id,
        backlinkSourceById.get(row.source_note_id) ?? null
      ])
    )
  };
}

export async function syncWikiVaultFromDisk(
  input: z.input<typeof syncWikiVaultSchema>
) {
  const parsed = syncWikiVaultSchema.parse(input);
  const spaces = parsed.spaceId
    ? [getWikiSpaceById(parsed.spaceId)].filter(
        (entry): entry is WikiSpace => entry !== null
      )
    : listWikiSpaces();

  let updated = 0;
  for (const space of spaces) {
    for (const note of listWikiPages({ spaceId: space.id, limit: 10_000 })) {
      syncNoteWikiArtifacts(note);
      updated += 1;
    }
  }

  return { updated };
}

function findMatchingWikiNoteIds(query: string) {
  const ftsQuery = buildWikiFtsQuery(query);
  if (!ftsQuery) {
    return new Set<string>();
  }
  const rows = getDatabase()
    .prepare(`SELECT note_id FROM wiki_pages_fts WHERE wiki_pages_fts MATCH ?`)
    .all(ftsQuery) as Array<{ note_id: string }>;
  return new Set(rows.map((row) => row.note_id));
}

export async function searchWikiPages(
  input: z.input<typeof wikiSearchQuerySchema>,
  secrets?: SecretsManager
) {
  const parsed = wikiSearchQuerySchema.parse(input);
  const pages = listAllNotes()
    .filter((page) => (parsed.spaceId ? page.spaceId === parsed.spaceId : true))
    .filter((page) => (parsed.kind ? page.kind === parsed.kind : true));

  const scores = new Map<string, number>();
  const addScore = (noteId: string, value: number) => {
    scores.set(noteId, (scores.get(noteId) ?? 0) + value);
  };

  if (
    parsed.mode === "text" ||
    parsed.mode === "hybrid" ||
    parsed.mode === "entity"
  ) {
    if (parsed.query) {
      for (const noteId of findMatchingWikiNoteIds(parsed.query)) {
        addScore(noteId, 4);
      }
    }
  }

  if (parsed.linkedEntity) {
    for (const page of pages) {
      if (
        page.links.some(
          (link) =>
            link.entityType === parsed.linkedEntity?.entityType &&
            link.entityId === parsed.linkedEntity?.entityId
        )
      ) {
        addScore(page.id, 6);
      }
    }
  }

  if (
    secrets &&
    parsed.query &&
    (parsed.mode === "semantic" || parsed.mode === "hybrid")
  ) {
    const profile =
      listWikiEmbeddingProfiles().find(
        (entry) =>
          entry.enabled && (!parsed.profileId || entry.id === parsed.profileId)
      ) ?? null;
    if (profile) {
      const [queryVector] = await embedTexts(profile, secrets, [parsed.query]);
      if (queryVector && queryVector.length > 0) {
        const chunkRows = getDatabase()
          .prepare(
            `SELECT note_id, vector_json
             FROM wiki_embedding_chunks
             WHERE profile_id = ?
               ${parsed.spaceId ? "AND space_id = ?" : ""}
             ORDER BY updated_at DESC`
          )
          .all(
            ...(parsed.spaceId ? [profile.id, parsed.spaceId] : [profile.id])
          ) as Array<{ note_id: string; vector_json: string }>;
        for (const row of chunkRows) {
          try {
            const score = cosineSimilarity(
              JSON.parse(row.vector_json) as number[],
              queryVector
            );
            if (score > 0) {
              addScore(row.note_id, score * 5);
            }
          } catch {
            continue;
          }
        }
      }
    }
  }

  if (parsed.query) {
    const normalizedQuery = parsed.query.toLowerCase();
    for (const page of pages) {
      if (page.slug.toLowerCase() === normalizedQuery) {
        addScore(page.id, 12);
      } else if (page.title.toLowerCase() === normalizedQuery) {
        addScore(page.id, 10);
      } else if (page.title.toLowerCase().includes(normalizedQuery)) {
        addScore(page.id, 2);
      }
    }
  }

  const ranked = [...pages]
    .filter((page) => {
      if (!parsed.query && !parsed.linkedEntity) {
        return true;
      }
      return scores.has(page.id);
    })
    .sort((left, right) => {
      const scoreDelta =
        (scores.get(right.id) ?? 0) - (scores.get(left.id) ?? 0);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return right.updatedAt.localeCompare(left.updatedAt);
    })
    .slice(0, parsed.limit);

  return {
    mode: parsed.mode,
    profileId: parsed.profileId ?? null,
    results: ranked.map((page) => ({
      page,
      score: Number((scores.get(page.id) ?? 0).toFixed(4))
    }))
  };
}

export function listWikiLlmProfiles() {
  const rows = getDatabase()
    .prepare(
      `SELECT id, label, provider, base_url, model, secret_id, system_prompt, enabled, metadata_json, created_at, updated_at
       FROM wiki_llm_profiles
       ORDER BY updated_at DESC`
    )
    .all() as Array<{
    id: string;
    label: string;
    provider: string;
    base_url: string;
    model: string;
    secret_id: string | null;
    system_prompt: string;
    enabled: number;
    metadata_json: string;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map((row) =>
    wikiLlmProfileSchema.parse({
      id: row.id,
      label: row.label,
      provider: row.provider,
      baseUrl: row.base_url,
      model: row.model,
      secretId: row.secret_id,
      systemPrompt: row.system_prompt,
      enabled: row.enabled === 1,
      metadata: parseJsonRecord(row.metadata_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })
  );
}

export function listWikiEmbeddingProfiles() {
  const rows = getDatabase()
    .prepare(
      `SELECT id, label, provider, base_url, model, secret_id, dimensions, chunk_size, chunk_overlap, enabled, metadata_json, created_at, updated_at
       FROM wiki_embedding_profiles
       ORDER BY updated_at DESC`
    )
    .all() as Array<{
    id: string;
    label: string;
    provider: string;
    base_url: string;
    model: string;
    secret_id: string | null;
    dimensions: number | null;
    chunk_size: number;
    chunk_overlap: number;
    enabled: number;
    metadata_json: string;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map((row) =>
    wikiEmbeddingProfileSchema.parse({
      id: row.id,
      label: row.label,
      provider: row.provider,
      baseUrl: row.base_url,
      model: row.model,
      secretId: row.secret_id,
      dimensions: row.dimensions,
      chunkSize: row.chunk_size,
      chunkOverlap: row.chunk_overlap,
      enabled: row.enabled === 1,
      metadata: parseJsonRecord(row.metadata_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })
  );
}

export function getWikiSettingsPayload() {
  return wikiSettingsPayloadSchema.parse({
    spaces: listWikiSpaces(),
    llmProfiles: listWikiLlmProfiles(),
    embeddingProfiles: listWikiEmbeddingProfiles()
  });
}

export function getWikiHealth(input: { spaceId?: string } = {}) {
  const spaceId = resolveSpaceId(input.spaceId, null);
  const space = getWikiSpaceById(spaceId) ?? ensureSharedWikiSpace();
  const pages = listWikiPages({ spaceId, limit: 10_000 });
  const noteIds = pages.map((page) => page.id);
  const noteIdSet = new Set(noteIds);
  const rawDirectoryPath = getSpaceRawDir(space);

  const edgeRows = getDatabase()
    .prepare(
      `SELECT e.source_note_id, e.target_type, e.target_note_id, e.raw_target, e.updated_at, n.slug AS source_slug, n.title AS source_title
       FROM wiki_link_edges e
       JOIN notes n ON n.id = e.source_note_id
       WHERE n.space_id = ?
       ORDER BY e.updated_at DESC`
    )
    .all(spaceId) as Array<{
    source_note_id: string;
    target_type: "page" | "entity" | "unresolved";
    target_note_id: string | null;
    raw_target: string;
    updated_at: string;
    source_slug: string;
    source_title: string;
  }>;

  const backlinkCounts = new Map<string, number>();
  const outboundCounts = new Map<string, number>();
  const unresolvedLinks = edgeRows
    .filter((row) => row.target_type === "unresolved")
    .map((row) => ({
      sourceNoteId: row.source_note_id,
      sourceSlug: row.source_slug,
      sourceTitle: row.source_title,
      rawTarget: row.raw_target,
      updatedAt: row.updated_at
    }));

  for (const row of edgeRows) {
    outboundCounts.set(
      row.source_note_id,
      (outboundCounts.get(row.source_note_id) ?? 0) + 1
    );
    if (row.target_note_id && noteIdSet.has(row.target_note_id)) {
      backlinkCounts.set(
        row.target_note_id,
        (backlinkCounts.get(row.target_note_id) ?? 0) + 1
      );
    }
  }

  let rawSourceCount = 0;
  try {
    rawSourceCount = readdirSync(rawDirectoryPath).length;
  } catch {
    rawSourceCount = 0;
  }

  const assetCount = (
    getDatabase()
      .prepare(
        `SELECT COUNT(*) AS count
         FROM wiki_media_assets
         WHERE space_id = ?`
      )
      .get(spaceId) as { count: number }
  ).count;

  return wikiHealthPayloadSchema.parse({
    space,
    indexPath: "",
    rawDirectoryPath,
    pageCount: pages.length,
    wikiPageCount: pages.filter((page) => page.kind === "wiki").length,
    evidencePageCount: pages.filter((page) => page.kind === "evidence").length,
    assetCount,
    rawSourceCount,
    unresolvedLinks,
    orphanPages: pages
      .filter((page) => page.kind === "wiki")
      .filter(
        (page) =>
          (backlinkCounts.get(page.id) ?? 0) === 0 &&
          (outboundCounts.get(page.id) ?? 0) === 0
      )
      .map((page) => ({
        id: page.id,
        slug: page.slug,
        title: page.title,
        kind: page.kind,
        updatedAt: page.updatedAt
      }))
      .slice(0, 50),
    missingSummaries: pages
      .filter((page) => !page.summary.trim())
      .map((page) => ({
        id: page.id,
        slug: page.slug,
        title: page.title,
        updatedAt: page.updatedAt
      }))
      .slice(0, 50),
    enabledEmbeddingProfiles: listWikiEmbeddingProfiles()
      .filter((profile) => profile.enabled)
      .map((profile) => ({
        id: profile.id,
        label: profile.label,
        model: profile.model
      })),
    enabledLlmProfiles: listWikiLlmProfiles()
      .filter((profile) => profile.enabled)
      .map((profile) => ({
        id: profile.id,
        label: profile.label,
        model: profile.model
      }))
  });
}

async function persistWikiRawSource(options: {
  space: WikiSpace;
  jobId: string;
  fetched: Awaited<ReturnType<typeof getFetchedContent>>;
}) {
  const rawDir = getSpaceRawDir(options.space);
  await mkdir(rawDir, { recursive: true });
  const extension =
    path.extname(options.fetched.fileName) ||
    inferExtensionFromMimeType(options.fetched.mimeType) ||
    (options.fetched.contentText ? ".txt" : ".bin");
  const baseName = sanitizeFileName(
    path.basename(
      options.fetched.fileName,
      path.extname(options.fetched.fileName)
    ) || options.jobId
  );
  const rawPath = path.join(rawDir, `${options.jobId}-${baseName}${extension}`);
  const payload =
    options.fetched.binary ?? Buffer.from(options.fetched.contentText, "utf8");
  await writeFile(rawPath, payload);
  return {
    filePath: rawPath,
    sizeBytes: payload.byteLength,
    checksum: hashBuffer(payload)
  };
}

export function upsertWikiLlmProfile(
  input: z.input<typeof upsertWikiLlmProfileSchema>,
  secrets: SecretsManager
) {
  const parsed = upsertWikiLlmProfileSchema.parse(input);
  const now = nowIso();
  const id =
    parsed.id?.trim() ||
    `wiki_llm_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  let secretId: string | null =
    parsed.secretId ??
    listWikiLlmProfiles().find((entry) => entry.id === id)?.secretId ??
    null;
  if (parsed.apiKey?.trim()) {
    secretId =
      secretId ??
      `wiki_llm_secret_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    storeEncryptedSecret(
      secretId,
      secrets.sealJson({ apiKey: parsed.apiKey.trim() }),
      `${parsed.label} wiki LLM profile`
    );
  }
  const metadata = {
    ...parsed.metadata
  };
  if (parsed.reasoningEffort) {
    metadata.reasoningEffort = parsed.reasoningEffort;
  } else {
    delete metadata.reasoningEffort;
  }
  if (parsed.verbosity) {
    metadata.verbosity = parsed.verbosity;
  } else {
    delete metadata.verbosity;
  }
  getDatabase()
    .prepare(
      `INSERT INTO wiki_llm_profiles (id, label, provider, base_url, model, secret_id, system_prompt, enabled, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         label = excluded.label,
         provider = excluded.provider,
         base_url = excluded.base_url,
         model = excluded.model,
         secret_id = excluded.secret_id,
         system_prompt = excluded.system_prompt,
         enabled = excluded.enabled,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`
    )
    .run(
      id,
      parsed.label,
      parsed.provider,
      parsed.baseUrl,
      parsed.model,
      secretId,
      parsed.systemPrompt,
      parsed.enabled ? 1 : 0,
      JSON.stringify(metadata),
      now,
      now
    );
  return listWikiLlmProfiles().find((entry) => entry.id === id)!;
}

export function upsertWikiEmbeddingProfile(
  input: z.input<typeof upsertWikiEmbeddingProfileSchema>,
  secrets: SecretsManager
) {
  const parsed = upsertWikiEmbeddingProfileSchema.parse(input);
  const now = nowIso();
  const id =
    parsed.id?.trim() ||
    `wiki_embed_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  let secretId: string | null =
    listWikiEmbeddingProfiles().find((entry) => entry.id === id)?.secretId ??
    null;
  if (parsed.apiKey?.trim()) {
    secretId =
      secretId ??
      `wiki_embed_secret_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    storeEncryptedSecret(
      secretId,
      secrets.sealJson({ apiKey: parsed.apiKey.trim() }),
      `${parsed.label} wiki embedding profile`
    );
  }
  getDatabase()
    .prepare(
      `INSERT INTO wiki_embedding_profiles (
        id, label, provider, base_url, model, secret_id, dimensions, chunk_size, chunk_overlap, enabled, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        provider = excluded.provider,
        base_url = excluded.base_url,
        model = excluded.model,
        secret_id = excluded.secret_id,
        dimensions = excluded.dimensions,
        chunk_size = excluded.chunk_size,
        chunk_overlap = excluded.chunk_overlap,
        enabled = excluded.enabled,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at`
    )
    .run(
      id,
      parsed.label,
      parsed.provider,
      parsed.baseUrl,
      parsed.model,
      secretId,
      parsed.dimensions ?? null,
      parsed.chunkSize,
      parsed.chunkOverlap,
      parsed.enabled ? 1 : 0,
      JSON.stringify(parsed.metadata),
      now,
      now
    );
  return listWikiEmbeddingProfiles().find((entry) => entry.id === id)!;
}

export function deleteWikiProfile(
  kind: "llm" | "embedding",
  profileId: string
) {
  if (kind === "llm") {
    const profile = listWikiLlmProfiles().find(
      (entry) => entry.id === profileId
    );
    if (profile?.secretId) {
      deleteEncryptedSecret(profile.secretId);
    }
    getDatabase()
      .prepare(`DELETE FROM wiki_llm_profiles WHERE id = ?`)
      .run(profileId);
    return;
  }
  const profile = listWikiEmbeddingProfiles().find(
    (entry) => entry.id === profileId
  );
  if (profile?.secretId) {
    deleteEncryptedSecret(profile.secretId);
  }
  getDatabase()
    .prepare(`DELETE FROM wiki_embedding_profiles WHERE id = ?`)
    .run(profileId);
  getDatabase()
    .prepare(`DELETE FROM wiki_embedding_chunks WHERE profile_id = ?`)
    .run(profileId);
}

export async function reindexWikiEmbeddings(
  input: z.input<typeof reindexWikiEmbeddingsSchema>,
  secrets: SecretsManager
) {
  const parsed = reindexWikiEmbeddingsSchema.parse(input);
  const profiles = listWikiEmbeddingProfiles().filter(
    (entry) =>
      entry.enabled && (!parsed.profileId || entry.id === parsed.profileId)
  );
  const pages = listWikiPages({ spaceId: parsed.spaceId, limit: 10_000 });
  let chunkCount = 0;

  for (const profile of profiles) {
    for (const page of pages) {
      getDatabase()
        .prepare(
          `DELETE FROM wiki_embedding_chunks WHERE note_id = ? AND profile_id = ?`
        )
        .run(page.id, profile.id);
      const chunks = chunkHeadingAware(
        page.contentMarkdown,
        profile.chunkSize,
        profile.chunkOverlap
      );
      if (chunks.length === 0) {
        continue;
      }
      const vectors = await embedTexts(
        profile,
        secrets,
        chunks.map((chunk) => chunk.contentText)
      );
      const insert = getDatabase().prepare(
        `INSERT INTO wiki_embedding_chunks (
          id, note_id, space_id, profile_id, chunk_key, heading_path, content_text, vector_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const now = nowIso();
      chunks.forEach((chunk, index) => {
        const vector = vectors[index];
        if (!vector || vector.length === 0) {
          return;
        }
        insert.run(
          `wiki_chunk_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
          page.id,
          page.spaceId,
          profile.id,
          chunk.key,
          chunk.headingPath,
          chunk.contentText,
          JSON.stringify(vector),
          now,
          now
        );
        chunkCount += 1;
      });
    }
  }

  return {
    profilesIndexed: profiles.length,
    pagesIndexed: pages.length,
    chunkCount
  };
}

type WikiIngestJobRow = {
  id: string;
  space_id: string;
  llm_profile_id: string | null;
  status: string;
  phase: string;
  progress_percent: number;
  total_files: number;
  processed_files: number;
  created_page_count: number;
  created_entity_count: number;
  accepted_count: number;
  rejected_count: number;
  latest_message: string;
  source_kind: string;
  source_locator: string;
  mime_type: string;
  title_hint: string;
  summary: string;
  page_note_id: string | null;
  created_by_actor: string | null;
  error_message: string;
  input_json: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type WikiIngestAssetRow = {
  id: string;
  status: string;
  source_kind: string;
  source_locator: string;
  file_name: string;
  mime_type: string;
  file_path: string;
  size_bytes: number;
  checksum: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type WikiIngestCandidateRow = {
  id: string;
  source_asset_id: string | null;
  candidate_type: string;
  status: string;
  title: string;
  summary: string;
  target_key: string;
  payload_json: string;
  published_note_id: string | null;
  published_entity_type: string | null;
  published_entity_id: string | null;
  created_at: string;
  updated_at: string;
};

function getWikiIngestJobDir(jobId: string) {
  return path.join(resolveDataDir(), "wiki-ingest", jobId);
}

function getWikiIngestUploadsDir(jobId: string) {
  return path.join(getWikiIngestJobDir(jobId), "uploads");
}

function readWikiIngestJobRow(jobId: string) {
  return getDatabase()
    .prepare(
      `SELECT id, space_id, llm_profile_id, status, phase, progress_percent, total_files, processed_files,
              created_page_count, created_entity_count, accepted_count, rejected_count, latest_message,
              source_kind, source_locator, mime_type, title_hint, summary, page_note_id, created_by_actor,
              error_message, input_json, created_at, updated_at, completed_at
       FROM wiki_ingest_jobs
       WHERE id = ?`
    )
    .get(jobId) as WikiIngestJobRow | undefined;
}

function mapWikiIngestJobRow(job: WikiIngestJobRow) {
  return {
    id: job.id,
    spaceId: job.space_id,
    llmProfileId: job.llm_profile_id,
    status: job.status,
    phase: job.phase,
    progressPercent: job.progress_percent,
    totalFiles: job.total_files,
    processedFiles: job.processed_files,
    createdPageCount: job.created_page_count,
    createdEntityCount: job.created_entity_count,
    acceptedCount: job.accepted_count,
    rejectedCount: job.rejected_count,
    latestMessage: job.latest_message,
    sourceKind: job.source_kind,
    sourceLocator: job.source_locator,
    mimeType: job.mime_type,
    titleHint: job.title_hint,
    summary: job.summary,
    pageNoteId: job.page_note_id,
    createdByActor: job.created_by_actor,
    errorMessage: job.error_message,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    completedAt: job.completed_at
  };
}

function listWikiIngestJobLogsInternal(jobId: string) {
  return getDatabase()
    .prepare(
      `SELECT id, level, message, metadata_json, created_at
       FROM wiki_ingest_job_logs
       WHERE job_id = ?
       ORDER BY created_at ASC`
    )
    .all(jobId) as Array<{
    id: string;
    level: string;
    message: string;
    metadata_json: string;
    created_at: string;
  }>;
}

function listWikiIngestJobAssetsInternal(jobId: string) {
  return getDatabase()
    .prepare(
      `SELECT id, status, source_kind, source_locator, file_name, mime_type, file_path,
              size_bytes, checksum, metadata_json, created_at, updated_at
       FROM wiki_ingest_job_assets
       WHERE job_id = ?
       ORDER BY created_at ASC`
    )
    .all(jobId) as WikiIngestAssetRow[];
}

function listWikiIngestCandidatesInternal(jobId: string) {
  return getDatabase()
    .prepare(
      `SELECT id, source_asset_id, candidate_type, status, title, summary, target_key,
              payload_json, published_note_id, published_entity_type, published_entity_id,
              created_at, updated_at
       FROM wiki_ingest_job_candidates
       WHERE job_id = ?
       ORDER BY created_at ASC`
    )
    .all(jobId) as WikiIngestCandidateRow[];
}

function updateWikiIngestJob(
  jobId: string,
  patch: Partial<{
    status: string;
    phase: string;
    progressPercent: number;
    totalFiles: number;
    processedFiles: number;
    createdPageCount: number;
    createdEntityCount: number;
    acceptedCount: number;
    rejectedCount: number;
    latestMessage: string;
    sourceLocator: string;
    mimeType: string;
    summary: string;
    pageNoteId: string | null;
    errorMessage: string;
    completedAt: string | null;
  }>
) {
  const current = readWikiIngestJobRow(jobId);
  if (!current) {
    return null;
  }
  const next = {
    status: patch.status ?? current.status,
    phase: patch.phase ?? current.phase,
    progressPercent: patch.progressPercent ?? current.progress_percent,
    totalFiles: patch.totalFiles ?? current.total_files,
    processedFiles: patch.processedFiles ?? current.processed_files,
    createdPageCount: patch.createdPageCount ?? current.created_page_count,
    createdEntityCount:
      patch.createdEntityCount ?? current.created_entity_count,
    acceptedCount: patch.acceptedCount ?? current.accepted_count,
    rejectedCount: patch.rejectedCount ?? current.rejected_count,
    latestMessage: patch.latestMessage ?? current.latest_message,
    sourceLocator: patch.sourceLocator ?? current.source_locator,
    mimeType: patch.mimeType ?? current.mime_type,
    summary: patch.summary ?? current.summary,
    pageNoteId:
      patch.pageNoteId === undefined ? current.page_note_id : patch.pageNoteId,
    errorMessage: patch.errorMessage ?? current.error_message,
    completedAt:
      patch.completedAt === undefined
        ? current.completed_at
        : patch.completedAt,
    updatedAt: nowIso()
  };

  getDatabase()
    .prepare(
      `UPDATE wiki_ingest_jobs
       SET status = ?, phase = ?, progress_percent = ?, total_files = ?, processed_files = ?,
           created_page_count = ?, created_entity_count = ?, accepted_count = ?, rejected_count = ?,
           latest_message = ?, source_locator = ?, mime_type = ?, summary = ?, page_note_id = ?,
           error_message = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      next.status,
      next.phase,
      next.progressPercent,
      next.totalFiles,
      next.processedFiles,
      next.createdPageCount,
      next.createdEntityCount,
      next.acceptedCount,
      next.rejectedCount,
      next.latestMessage,
      next.sourceLocator,
      next.mimeType,
      next.summary,
      next.pageNoteId,
      next.errorMessage,
      next.completedAt,
      next.updatedAt,
      jobId
    );
  return getWikiIngestJob(jobId);
}

function createWikiIngestLog(
  jobId: string,
  message: string,
  level: "info" | "warning" | "error" = "info",
  metadata: Record<string, unknown> = {},
  options: {
    aggregateKey?: string;
    recordDiagnostic?: boolean;
  } = {}
) {
  const createdAt = nowIso();
  const logMetadata = options.aggregateKey
    ? { ...metadata, aggregateKey: options.aggregateKey }
    : metadata;
  const aggregateKey = options.aggregateKey?.trim() || null;
  if (aggregateKey) {
    const current = [...listWikiIngestJobLogsInternal(jobId)]
      .reverse()
      .find((entry) => {
        const parsed = parseJsonRecord(entry.metadata_json);
        return parsed.aggregateKey === aggregateKey;
      });
    if (current) {
      getDatabase()
        .prepare(
          `UPDATE wiki_ingest_job_logs
           SET level = ?, message = ?, metadata_json = ?, created_at = ?
           WHERE id = ?`
        )
        .run(
          level,
          message,
          JSON.stringify(logMetadata),
          createdAt,
          current.id
        );
    } else {
      getDatabase()
        .prepare(
          `INSERT INTO wiki_ingest_job_logs (id, job_id, level, message, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          `wiki_ingest_log_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
          jobId,
          level,
          message,
          JSON.stringify(logMetadata),
          createdAt
        );
    }
  } else {
    getDatabase()
      .prepare(
        `INSERT INTO wiki_ingest_job_logs (id, job_id, level, message, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        `wiki_ingest_log_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
        jobId,
        level,
        message,
        JSON.stringify(logMetadata),
        createdAt
      );
  }
  if (options.recordDiagnostic !== false) {
    recordDiagnosticLog({
      level,
      source: "server",
      scope:
        typeof metadata.scope === "string" && metadata.scope.trim()
          ? metadata.scope
          : "wiki_ingest",
      eventKey:
        typeof metadata.eventKey === "string" && metadata.eventKey.trim()
          ? metadata.eventKey
          : "wiki_ingest_log",
      message,
      functionName: "createWikiIngestLog",
      entityType: "wiki_ingest_job",
      entityId: jobId,
      jobId,
      details: logMetadata
    });
  }
}

function findOpenAiResponseIdForJobAsset(input: {
  jobId: string;
  assetId: string;
  fileName: string;
  sourceLocator: string;
  checksum: string;
}) {
  const normalizedFileName = input.fileName.trim().toLowerCase();
  const normalizedSourceLocator = input.sourceLocator.trim().toLowerCase();
  const normalizedChecksum = input.checksum.trim().toLowerCase();
  const sameNamedAssets = listWikiIngestJobAssetsInternal(input.jobId).filter(
    (asset) => asset.file_name.trim().toLowerCase() === normalizedFileName
  ).length;
  const logs = [...listWikiIngestJobLogsInternal(input.jobId)].reverse();
  for (const entry of logs) {
    const metadata = parseJsonRecord(entry.metadata_json);
    const responseId = readStringRecordValue(metadata, "responseId");
    if (!responseId) {
      continue;
    }
    const loggedAssetId =
      readStringRecordValue(metadata, "sourceAssetId") ??
      readStringRecordValue(metadata, "assetId");
    if (loggedAssetId) {
      if (loggedAssetId === input.assetId) {
        return responseId;
      }
      continue;
    }
    const loggedSourceLocator = readStringRecordValue(metadata, "sourceLocator");
    if (loggedSourceLocator) {
      if (
        loggedSourceLocator.trim().toLowerCase() === normalizedSourceLocator
      ) {
        return responseId;
      }
      continue;
    }
    const loggedChecksum = readStringRecordValue(metadata, "checksum");
    if (loggedChecksum) {
      if (loggedChecksum.trim().toLowerCase() === normalizedChecksum) {
        return responseId;
      }
      continue;
    }
    const loggedFileName =
      readStringRecordValue(metadata, "currentFileName") ??
      readStringRecordValue(metadata, "fileName");
    if (!loggedFileName) {
      return responseId;
    }
    if (
      sameNamedAssets === 1 &&
      loggedFileName.trim().toLowerCase() === normalizedFileName
    ) {
      return responseId;
    }
  }
  return null;
}

function createWikiIngestAssetRecord(input: {
  jobId: string;
  status?: string;
  sourceKind: string;
  sourceLocator: string;
  fileName: string;
  mimeType: string;
  filePath: string;
  sizeBytes: number;
  checksum: string;
  metadata?: Record<string, unknown>;
}) {
  const id = `wiki_ingest_asset_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO wiki_ingest_job_assets (
        id, job_id, status, source_kind, source_locator, file_name, mime_type, file_path,
        size_bytes, checksum, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.jobId,
      input.status ?? "queued",
      input.sourceKind,
      input.sourceLocator,
      input.fileName,
      input.mimeType,
      input.filePath,
      input.sizeBytes,
      input.checksum,
      JSON.stringify(input.metadata ?? {}),
      now,
      now
    );
  return id;
}

function updateWikiIngestAsset(
  assetId: string,
  patch: Partial<{
    status: string;
    filePath: string;
    mimeType: string;
    sizeBytes: number;
    checksum: string;
    metadata: Record<string, unknown>;
  }>
) {
  const current = getDatabase()
    .prepare(
      `SELECT file_path, mime_type, size_bytes, checksum, metadata_json, status
       FROM wiki_ingest_job_assets
       WHERE id = ?`
    )
    .get(assetId) as
    | {
        file_path: string;
        mime_type: string;
        size_bytes: number;
        checksum: string;
        metadata_json: string;
        status: string;
      }
    | undefined;
  if (!current) {
    return;
  }
  getDatabase()
    .prepare(
      `UPDATE wiki_ingest_job_assets
       SET status = ?, file_path = ?, mime_type = ?, size_bytes = ?, checksum = ?, metadata_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      patch.status ?? current.status,
      patch.filePath ?? current.file_path,
      patch.mimeType ?? current.mime_type,
      patch.sizeBytes ?? current.size_bytes,
      patch.checksum ?? current.checksum,
      JSON.stringify(patch.metadata ?? parseJsonRecord(current.metadata_json)),
      nowIso(),
      assetId
    );
}

function createWikiIngestCandidate(input: {
  jobId: string;
  sourceAssetId?: string | null;
  candidateType: "page" | "entity" | "page_update";
  title?: string;
  summary?: string;
  targetKey?: string;
  payload: Record<string, unknown>;
}) {
  const existing = listWikiIngestCandidatesInternal(input.jobId).find(
    (candidate) =>
      candidate.source_asset_id === (input.sourceAssetId ?? null) &&
      candidate.candidate_type === input.candidateType &&
      candidate.title === (input.title ?? "") &&
      candidate.summary === (input.summary ?? "") &&
      candidate.target_key === (input.targetKey ?? "") &&
      candidate.payload_json === JSON.stringify(input.payload)
  );
  if (existing) {
    return existing.id;
  }
  const id = `wiki_ingest_candidate_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO wiki_ingest_job_candidates (
        id, job_id, source_asset_id, candidate_type, status, title, summary, target_key,
        payload_json, published_note_id, published_entity_type, published_entity_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.jobId,
      input.sourceAssetId ?? null,
      input.candidateType,
      "suggested",
      input.title ?? "",
      input.summary ?? "",
      input.targetKey ?? "",
      JSON.stringify(input.payload),
      null,
      null,
      null,
      now,
      now
    );
  return id;
}

function updateWikiIngestCandidate(
  candidateId: string,
  patch: Partial<{
    status: string;
    publishedNoteId: string | null;
    publishedEntityType: string | null;
    publishedEntityId: string | null;
    payload: Record<string, unknown>;
  }>
) {
  const current = getDatabase()
    .prepare(
      `SELECT payload_json, status, published_note_id, published_entity_type, published_entity_id
       FROM wiki_ingest_job_candidates
       WHERE id = ?`
    )
    .get(candidateId) as
    | {
        payload_json: string;
        status: string;
        published_note_id: string | null;
        published_entity_type: string | null;
        published_entity_id: string | null;
      }
    | undefined;
  if (!current) {
    return;
  }
  getDatabase()
    .prepare(
      `UPDATE wiki_ingest_job_candidates
       SET status = ?, payload_json = ?, published_note_id = ?, published_entity_type = ?, published_entity_id = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      patch.status ?? current.status,
      JSON.stringify(patch.payload ?? parseJsonRecord(current.payload_json)),
      patch.publishedNoteId === undefined
        ? current.published_note_id
        : patch.publishedNoteId,
      patch.publishedEntityType === undefined
        ? current.published_entity_type
        : patch.publishedEntityType,
      patch.publishedEntityId === undefined
        ? current.published_entity_id
        : patch.publishedEntityId,
      nowIso(),
      candidateId
    );
}

function calculateProgress(totalFiles: number, processedFiles: number) {
  if (totalFiles <= 0) {
    return 0;
  }
  return Math.max(
    0,
    Math.min(100, Math.round((processedFiles / totalFiles) * 100))
  );
}

async function persistIngestUpload(options: {
  jobId: string;
  fileName: string;
  mimeType: string;
  payload: Buffer;
}) {
  const uploadDir = getWikiIngestUploadsDir(options.jobId);
  await mkdir(uploadDir, { recursive: true });
  const safeName = sanitizeFileName(options.fileName || "upload.bin");
  const nextPath = path.join(
    uploadDir,
    `${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`
  );
  await writeFile(nextPath, options.payload);
  return {
    filePath: nextPath,
    sizeBytes: options.payload.byteLength,
    checksum: hashBuffer(options.payload)
  };
}

function readWikiIngestInput(jobId: string) {
  const row = readWikiIngestJobRow(jobId);
  if (!row) {
    return null;
  }
  const payload = parseJsonRecord(row.input_json);
  return createWikiIngestJobSchema.parse({
    spaceId: row.space_id,
    titleHint:
      typeof payload.titleHint === "string"
        ? payload.titleHint
        : row.title_hint,
    sourceKind:
      payload.sourceKind === "local_path" || payload.sourceKind === "url"
        ? payload.sourceKind
        : "raw_text",
    sourceText:
      typeof payload.sourceText === "string" ? payload.sourceText : "",
    sourcePath:
      typeof payload.sourcePath === "string" ? payload.sourcePath : undefined,
    sourceUrl:
      typeof payload.sourceUrl === "string" ? payload.sourceUrl : undefined,
    mimeType:
      typeof payload.mimeType === "string" ? payload.mimeType : row.mime_type,
    llmProfileId:
      typeof payload.llmProfileId === "string"
        ? payload.llmProfileId
        : (row.llm_profile_id ?? undefined),
    parseStrategy:
      payload.parseStrategy === "text_only" ||
      payload.parseStrategy === "multimodal"
        ? payload.parseStrategy
        : "auto",
    entityProposalMode:
      payload.entityProposalMode === "none" ? "none" : "suggest",
    userId:
      typeof payload.userId === "string"
        ? payload.userId
        : payload.userId === null
          ? null
          : row.created_by_actor,
    createAsKind: payload.createAsKind === "evidence" ? "evidence" : "wiki",
    linkedEntityHints: Array.isArray(payload.linkedEntityHints)
      ? payload.linkedEntityHints
      : []
  });
}

export async function createUploadedWikiIngestJob(
  input: {
    spaceId?: string;
    titleHint?: string;
    llmProfileId?: string;
    parseStrategy?: "auto" | "text_only" | "multimodal";
    entityProposalMode?: "none" | "suggest";
    userId?: string | null;
    createAsKind?: NoteKind;
    linkedEntityHints?: Array<{
      entityType: CrudEntityType;
      entityId: string;
      anchorKey?: string | null;
    }>;
  },
  files: Array<{
    fileName: string;
    mimeType: string;
    payload: Buffer;
  }>,
  options: {
    actor?: string | null;
  } = {}
) {
  const parsed = createWikiIngestJobSchema.parse({
    ...input,
    sourceKind: "raw_text",
    sourceText: "",
    mimeType: ""
  });
  const spaceId = resolveSpaceId(parsed.spaceId, parsed.userId);
  const now = nowIso();
  const jobId = `wiki_ingest_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  getDatabase()
    .prepare(
      `INSERT INTO wiki_ingest_jobs (
        id, space_id, llm_profile_id, status, phase, progress_percent, total_files, processed_files,
        created_page_count, created_entity_count, accepted_count, rejected_count, latest_message,
        source_kind, source_locator, mime_type, title_hint, summary, page_note_id, created_by_actor,
        error_message, input_json, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      jobId,
      spaceId,
      parsed.llmProfileId ?? null,
      "queued",
      "queued",
      0,
      files.length,
      0,
      0,
      0,
      0,
      0,
      files.length === 1
        ? "Waiting to ingest 1 uploaded file"
        : `Waiting to ingest ${files.length} uploaded files`,
      "upload",
      "",
      "",
      parsed.titleHint,
      "",
      null,
      options.actor ?? parsed.userId ?? null,
      "",
      JSON.stringify({
        ...parsed,
        sourceKind: "upload"
      }),
      now,
      now,
      null
    );

  for (const file of files) {
    const persisted = await persistIngestUpload({
      jobId,
      fileName: file.fileName,
      mimeType: file.mimeType || inferMimeTypeFromPath(file.fileName),
      payload: file.payload
    });
    createWikiIngestAssetRecord({
      jobId,
      sourceKind: "upload",
      sourceLocator: file.fileName,
      fileName: file.fileName,
      mimeType: file.mimeType || inferMimeTypeFromPath(file.fileName),
      filePath: persisted.filePath,
      sizeBytes: persisted.sizeBytes,
      checksum: persisted.checksum
    });
  }
  createWikiIngestLog(
    jobId,
    files.length === 1
      ? "Queued 1 uploaded file for Forge wiki ingestion."
      : `Queued ${files.length} uploaded files for Forge wiki ingestion.`
  );
  return {
    job: getWikiIngestJob(jobId),
    page: null
  };
}

export async function ingestWikiSource(
  input: z.input<typeof createWikiIngestJobSchema>,
  options: {
    actor?: string | null;
  } = {}
) {
  const parsed = createWikiIngestJobSchema.parse(input);
  const spaceId = resolveSpaceId(parsed.spaceId, parsed.userId);
  const now = nowIso();
  const jobId = `wiki_ingest_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  let filePath = "";
  let sizeBytes = 0;
  let checksum = "";
  let sourceLocator = "";
  let fileName = "source.bin";
  let mimeType = parsed.mimeType;

  if (parsed.sourceKind === "raw_text") {
    const payload = Buffer.from(parsed.sourceText, "utf8");
    const persisted = await persistIngestUpload({
      jobId,
      fileName: "inline.txt",
      mimeType: parsed.mimeType || "text/plain",
      payload
    });
    filePath = persisted.filePath;
    sizeBytes = persisted.sizeBytes;
    checksum = persisted.checksum;
    sourceLocator = "raw_text";
    fileName = "inline.txt";
    mimeType = parsed.mimeType || "text/plain";
  } else if (parsed.sourceKind === "local_path") {
    const sourcePath = parsed.sourcePath?.trim();
    if (!sourcePath) {
      throw new Error("sourcePath is required for local_path ingest.");
    }
    const payload = await readFile(sourcePath);
    const persisted = await persistIngestUpload({
      jobId,
      fileName: path.basename(sourcePath),
      mimeType: parsed.mimeType || inferMimeTypeFromPath(sourcePath),
      payload
    });
    filePath = persisted.filePath;
    sizeBytes = persisted.sizeBytes;
    checksum = persisted.checksum;
    sourceLocator = sourcePath;
    fileName = path.basename(sourcePath);
    mimeType = parsed.mimeType || inferMimeTypeFromPath(sourcePath);
  } else {
    sourceLocator = parsed.sourceUrl?.trim() || "";
    fileName =
      sourceLocator.split("/").pop()?.split("?")[0]?.trim() ||
      "remote-source.bin";
    mimeType = parsed.mimeType || "application/octet-stream";
  }

  getDatabase()
    .prepare(
      `INSERT INTO wiki_ingest_jobs (
        id, space_id, llm_profile_id, status, phase, progress_percent, total_files, processed_files,
        created_page_count, created_entity_count, accepted_count, rejected_count, latest_message,
        source_kind, source_locator, mime_type, title_hint, summary, page_note_id, created_by_actor,
        error_message, input_json, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      jobId,
      spaceId,
      parsed.llmProfileId ?? null,
      "queued",
      "queued",
      0,
      1,
      0,
      0,
      0,
      0,
      0,
      "Waiting to ingest source",
      parsed.sourceKind,
      sourceLocator,
      mimeType,
      parsed.titleHint,
      "",
      null,
      options.actor ?? parsed.userId ?? null,
      "",
      JSON.stringify(parsed),
      now,
      now,
      null
    );

  createWikiIngestAssetRecord({
    jobId,
    sourceKind: parsed.sourceKind,
    sourceLocator,
    fileName,
    mimeType,
    filePath,
    sizeBytes,
    checksum
  });
  createWikiIngestLog(jobId, "Queued source for Forge wiki ingestion.");
  return {
    job: getWikiIngestJob(jobId),
    page: null
  };
}

function createPageCandidatePayload(input: {
  title: string;
  summary: string;
  markdown: string;
  sourceLocator: string;
  createAsKind: NoteKind;
  aliases?: string[];
  parentSlug?: string | null;
  tags?: string[];
  linkedEntityHints: Array<{
    entityType: CrudEntityType;
    entityId: string;
    anchorKey?: string | null;
  }>;
}) {
  return {
    title: input.title,
    summary: input.summary,
    contentMarkdown: input.markdown,
    kind: input.createAsKind,
    aliases: normalizeTags(input.aliases),
    parentSlug:
      typeof input.parentSlug === "string" && input.parentSlug.trim().length > 0
        ? input.parentSlug.trim()
        : null,
    sourceLocator: input.sourceLocator,
    links: input.linkedEntityHints,
    tags: normalizeTags(input.tags)
  };
}

export async function processWikiIngestJob(
  jobId: string,
  options: {
    llm: LlmManager;
  }
) {
  const job = readWikiIngestJobRow(jobId);
  if (!job) {
    return null;
  }
  const parsed = readWikiIngestInput(jobId);
  if (!parsed) {
    return null;
  }
  const llmProfile = parsed.llmProfileId
    ? (listWikiLlmProfiles().find(
        (entry) => entry.id === parsed.llmProfileId
      ) ?? null)
    : null;
  const space = getWikiSpaceById(job.space_id) ?? ensureSharedWikiSpace();

  if (parsed.llmProfileId && !llmProfile) {
    updateWikiIngestJob(jobId, {
      status: "failed",
      phase: "failed",
      latestMessage: "The selected LLM profile could not be found.",
      errorMessage: "The selected LLM profile could not be found.",
      completedAt: nowIso()
    });
    createWikiIngestLog(
      jobId,
      "The selected LLM profile could not be found.",
      "error"
    );
    return getWikiIngestJob(jobId);
  }

  updateWikiIngestJob(jobId, {
    status: "processing",
    phase: "processing",
    latestMessage: "Processing queued wiki ingest sources.",
    errorMessage: "",
    completedAt: null
  });
  createWikiIngestLog(jobId, "Started background wiki ingestion.");
  let currentAssetContext: {
    assetId: string;
    fileName: string;
    sourceLocator: string;
    checksum: string;
    fileIndex: number;
    totalFiles: number;
    chunkIndex: number;
    chunkCount: number;
  } | null = null;
  let currentPollCount = 0;
  const updateCurrentAssetMetadata = (patch: Record<string, unknown>) => {
    if (!currentAssetContext) {
      return;
    }
    const asset = listWikiIngestJobAssetsInternal(jobId).find(
      (entry) => entry.id === currentAssetContext?.assetId
    );
    if (!asset) {
      return;
    }
    updateWikiIngestAsset(asset.id, {
      metadata: {
        ...parseJsonRecord(asset.metadata_json),
        ...patch
      }
    });
  };
  const llmDiagnosticLogger = ({
    level,
    message,
    details = {}
  }: {
    level: "debug" | "info" | "warning" | "error";
    message: string;
    details?: Record<string, unknown>;
  }) => {
    const enrichedDetails = {
      ...details,
      sourceAssetId: currentAssetContext?.assetId ?? null,
      currentFileName: currentAssetContext?.fileName ?? null,
      sourceLocator: currentAssetContext?.sourceLocator ?? null,
      checksum: currentAssetContext?.checksum ?? null,
      currentFileIndex: currentAssetContext?.fileIndex ?? null,
      currentFileTotal: currentAssetContext?.totalFiles ?? null,
      chunkIndex:
        typeof details.chunkIndex === "number"
          ? details.chunkIndex
          : currentAssetContext?.chunkIndex ?? null,
      chunkCount:
        typeof details.chunkCount === "number"
          ? details.chunkCount
          : currentAssetContext?.chunkCount ?? null
    } satisfies Record<string, unknown>;
    const eventKey =
      typeof details.eventKey === "string" ? details.eventKey : "";
    if (eventKey === "llm_compile_background_started") {
      currentPollCount = 0;
      updateCurrentAssetMetadata({
        openAiResponseId:
          typeof details.responseId === "string" ? details.responseId : null,
        openAiResponseStatus:
          typeof details.status === "string" ? details.status : "queued",
        openAiLastPolledAt: nowIso()
      });
    }
    if (eventKey === "llm_compile_background_polled") {
      currentPollCount += 1;
      const pollStatus =
        typeof details.status === "string" ? details.status : "in_progress";
      const chunkSuffix =
        (currentAssetContext?.chunkCount ?? 1) > 1
          ? ` · chunk ${currentAssetContext?.chunkIndex ?? 1}/${currentAssetContext?.chunkCount ?? 1}`
          : "";
      const fileLabel = currentAssetContext?.fileName ?? "current source";
      const progressMessage = `Waiting for OpenAI on ${fileLabel}${chunkSuffix}. Poll ${currentPollCount} · ${pollStatus}.`;
      updateWikiIngestJob(jobId, {
        latestMessage: progressMessage
      });
      updateCurrentAssetMetadata({
        openAiResponseId:
          typeof details.responseId === "string" ? details.responseId : null,
        openAiResponseStatus: pollStatus,
        openAiLastPolledAt: nowIso(),
        openAiPollCount: currentPollCount
      });
      createWikiIngestLog(
        jobId,
        progressMessage,
        "info",
        {
          ...enrichedDetails,
          pollCount: currentPollCount,
          status: pollStatus
        },
        {
          aggregateKey: `llm_compile_background_polled:${
            currentAssetContext?.assetId ?? "job"
          }`,
          recordDiagnostic: false
        }
      );
      return;
    }
    if (
      eventKey === "llm_compile_success" ||
      eventKey === "llm_compile_unparseable" ||
      eventKey === "llm_compile_background_terminal_error"
    ) {
      updateCurrentAssetMetadata({
        openAiResponseId:
          typeof details.responseId === "string" ? details.responseId : null,
        openAiResponseStatus:
          eventKey === "llm_compile_background_terminal_error"
            ? typeof details.status === "string"
              ? details.status
              : "failed"
            : "completed",
        openAiLastPolledAt: nowIso(),
        openAiPollCount: currentPollCount
      });
    }
    createWikiIngestLog(
      jobId,
      message,
      level === "debug" ? "info" : level,
      {
        scope: "wiki_llm",
        eventKey: "wiki_llm_event",
        ...enrichedDetails
      }
    );
  };

  const refreshCounts = () => {
    const candidates = listWikiIngestCandidatesInternal(jobId);
    const pageCount = candidates.filter(
      (candidate) => candidate.candidate_type === "page"
    ).length;
    const entityCount = candidates.filter(
      (candidate) => candidate.candidate_type === "entity"
    ).length;
    return { pageCount, entityCount };
  };

  const assetQueue = () =>
    listWikiIngestJobAssetsInternal(jobId).filter((asset) =>
      ["queued", "processing"].includes(asset.status)
    );

  const initialAssets = listWikiIngestJobAssetsInternal(jobId);
  let processedFiles = initialAssets.filter(
    (asset) => asset.status === "completed"
  ).length;
  let totalFiles = Math.max(job.total_files, initialAssets.length);
  let hadSuccess = false;

  while (assetQueue().length > 0) {
    const nextAsset = assetQueue().find((asset) =>
      ["processing", "queued"].includes(asset.status)
    );
    if (!nextAsset) {
      break;
    }

    if (
      nextAsset.file_name.toLowerCase().endsWith(".zip") ||
      nextAsset.mime_type === "application/zip"
    ) {
      updateWikiIngestAsset(nextAsset.id, { status: "processing" });
      try {
        const archive = new AdmZip(nextAsset.file_path);
        const entries = archive
          .getEntries()
          .filter((entry: AdmZipEntry) => !entry.isDirectory);
        for (const entry of entries) {
          const payload = entry.getData();
          const fileName = path.basename(entry.entryName);
          const mimeType = inferMimeTypeFromPath(fileName);
          const persisted = await persistIngestUpload({
            jobId,
            fileName,
            mimeType,
            payload
          });
          createWikiIngestAssetRecord({
            jobId,
            sourceKind: "upload",
            sourceLocator: entry.entryName,
            fileName,
            mimeType,
            filePath: persisted.filePath,
            sizeBytes: persisted.sizeBytes,
            checksum: persisted.checksum,
            metadata: {
              parentAssetId: nextAsset.id
            }
          });
        }
        totalFiles = Math.max(0, totalFiles - 1 + entries.length);
        updateWikiIngestAsset(nextAsset.id, {
          status: "completed",
          metadata: {
            ...(parseJsonRecord(nextAsset.metadata_json) ?? {}),
            extractedCount: entries.length
          }
        });
        updateWikiIngestJob(jobId, {
          totalFiles,
          latestMessage:
            entries.length === 1
              ? "Expanded 1 file from ZIP archive."
              : `Expanded ${entries.length} files from ZIP archive.`
        });
        createWikiIngestLog(
          jobId,
          entries.length === 1
            ? "Expanded 1 file from ZIP archive."
            : `Expanded ${entries.length} files from ZIP archive.`
        );
      } catch (error) {
        updateWikiIngestAsset(nextAsset.id, { status: "failed" });
        createWikiIngestLog(
          jobId,
          error instanceof Error ? error.message : "ZIP extraction failed.",
          "error"
        );
      }
      continue;
    }

    updateWikiIngestAsset(nextAsset.id, { status: "processing" });
    currentAssetContext = {
      assetId: nextAsset.id,
      fileName: nextAsset.file_name || nextAsset.source_locator || "Source",
      sourceLocator: nextAsset.source_locator,
      checksum: nextAsset.checksum,
      fileIndex: Math.min(totalFiles, processedFiles + 1),
      totalFiles,
      chunkIndex: 1,
      chunkCount: 1
    };
    currentPollCount = 0;
    createWikiIngestLog(
      jobId,
      `Processing ${currentAssetContext.fileName} (${currentAssetContext.fileIndex}/${currentAssetContext.totalFiles}).`,
      "info",
      {
        sourceAssetId: currentAssetContext.assetId,
        fileName: currentAssetContext.fileName,
        sourceLocator: currentAssetContext.sourceLocator,
        checksum: currentAssetContext.checksum,
        fileIndex: currentAssetContext.fileIndex,
        totalFiles: currentAssetContext.totalFiles,
        chunkIndex: currentAssetContext.chunkIndex,
        chunkCount: currentAssetContext.chunkCount
      }
    );
    try {
      const fetched =
        nextAsset.source_kind === "url"
          ? await getFetchedContent("url", {
              sourceText: "",
              sourceUrl: nextAsset.source_locator,
              mimeType: nextAsset.mime_type
            })
          : await getFetchedContent("local_path", {
              sourceText: "",
              sourcePath: nextAsset.file_path,
              mimeType: nextAsset.mime_type
            });
      const rawSource = await persistWikiRawSource({
        space,
        jobId,
        fetched
      });
      const existingAssetMetadata = parseJsonRecord(nextAsset.metadata_json);
      const resumeResponseId =
        readStringRecordValue(existingAssetMetadata, "openAiResponseId") ??
        findOpenAiResponseIdForJobAsset({
          jobId,
          assetId: nextAsset.id,
          fileName: nextAsset.file_name,
          sourceLocator: nextAsset.source_locator,
          checksum: nextAsset.checksum
        });
      const compiled =
        llmProfile && parsed.parseStrategy !== "text_only"
          ? await options.llm.compileWikiIngest(llmProfile, {
              titleHint: parsed.titleHint,
              rawText: fetched.contentText,
              binary: fetched.binary,
              mimeType: fetched.mimeType,
              parseStrategy: parsed.parseStrategy
            }, {
              resumeResponseId
            }, llmDiagnosticLogger)
          : llmProfile && fetched.contentText
            ? await options.llm.compileWikiIngest(llmProfile, {
                titleHint: parsed.titleHint,
                rawText: fetched.contentText,
                binary: fetched.binary,
                mimeType: fetched.mimeType,
                parseStrategy: "text_only"
              }, {
                resumeResponseId
              }, llmDiagnosticLogger)
            : null;

      if (llmProfile && !compiled) {
        throw new Error(
          "The LLM did not produce structured draft candidates. Check the OpenAI settings and try again."
        );
      }

      const title =
        compiled?.title ||
        parsed.titleHint ||
        inferTitle(fetched.contentText || fetched.fileName, "Imported source");
      const summary =
        compiled?.summary ||
        (fetched.contentText ? inferSummary(fetched.contentText) : "");
      const markdown = compiled?.markdown
        ? compiled.markdown
        : fetched.contentText
          ? `# ${title}\n\n${fetched.contentText.trim()}\n`
          : `# ${title}\n\nImported media asset \`${fetched.fileName}\` (${fetched.mimeType}).\n`;

      createWikiIngestCandidate({
        jobId,
        sourceAssetId: nextAsset.id,
        candidateType: "page",
        title,
        summary,
        targetKey: "",
        payload: createPageCandidatePayload({
          title,
          summary,
          markdown,
          sourceLocator: fetched.locator,
          createAsKind: parsed.createAsKind,
          tags: compiled?.tags,
          linkedEntityHints: parsed.linkedEntityHints
        })
      });

      if (parsed.entityProposalMode === "suggest") {
        for (const proposal of compiled?.entityProposals ?? []) {
          createWikiIngestCandidate({
            jobId,
            sourceAssetId: nextAsset.id,
            candidateType: "entity",
            title:
              typeof proposal.title === "string"
                ? proposal.title
                : "Entity proposal",
            summary:
              typeof proposal.summary === "string" ? proposal.summary : "",
            targetKey:
              typeof proposal.entityType === "string"
                ? proposal.entityType
                : "",
            payload: proposal
          });
        }
      }

      for (const suggestion of compiled?.pageUpdateSuggestions ?? []) {
        const patchSummary =
          typeof suggestion.patchSummary === "string"
            ? suggestion.patchSummary
            : "";
        createWikiIngestCandidate({
          jobId,
          sourceAssetId: nextAsset.id,
          candidateType: "page_update",
          title:
            typeof suggestion.targetSlug === "string"
              ? suggestion.targetSlug
              : "Page update",
          summary:
            typeof suggestion.rationale === "string"
              ? suggestion.rationale
              : patchSummary,
          targetKey:
            typeof suggestion.targetSlug === "string"
              ? suggestion.targetSlug
              : "",
          payload: {
            ...suggestion,
            patchSummary
          }
        });
      }

      for (const candidate of compiled?.articleCandidates ?? []) {
        const articleTitle =
          typeof candidate.title === "string" &&
          candidate.title.trim().length > 0
            ? candidate.title.trim()
            : "Suggested article";
        const articleSummary =
          typeof candidate.summary === "string" ? candidate.summary : "";
        const articleRationale =
          typeof candidate.rationale === "string" ? candidate.rationale : "";
        createWikiIngestCandidate({
          jobId,
          sourceAssetId: nextAsset.id,
          candidateType: "page",
          title: articleTitle,
          summary: articleSummary,
          targetKey: typeof candidate.slug === "string" ? candidate.slug : "",
          payload: createPageCandidatePayload({
            title: articleTitle,
            summary: articleSummary,
            markdown:
              typeof candidate.markdown === "string" &&
              candidate.markdown.trim().length > 0
                ? candidate.markdown
                : `# ${articleTitle}\n\n${articleSummary}\n\n${
                    articleRationale
                      ? `## Why this page\n\n${articleRationale}\n`
                      : ""
                  }`,
            sourceLocator: fetched.locator,
            createAsKind: "wiki",
            aliases: Array.isArray(candidate.aliases)
              ? candidate.aliases.filter(
                  (alias): alias is string => typeof alias === "string"
                )
              : [],
            parentSlug:
              typeof candidate.parentSlug === "string"
                ? candidate.parentSlug
                : null,
            tags: Array.isArray(candidate.tags)
              ? candidate.tags.filter(
                  (tag): tag is string => typeof tag === "string"
                )
              : [],
            linkedEntityHints: parsed.linkedEntityHints
          })
        });
      }

      updateWikiIngestAsset(nextAsset.id, {
        status: "completed",
        filePath: rawSource.filePath,
        mimeType: fetched.mimeType,
        sizeBytes: rawSource.sizeBytes,
        checksum: rawSource.checksum,
        metadata: {
          ...(parseJsonRecord(nextAsset.metadata_json) ?? {}),
          rawSourcePath: rawSource.filePath,
          openAiResponseStatus: llmProfile ? "completed" : null,
          openAiLastPolledAt: llmProfile ? nowIso() : null
        }
      });
      hadSuccess = true;
      processedFiles += 1;
      const counts = refreshCounts();
      updateWikiIngestJob(jobId, {
        processedFiles,
        totalFiles,
        progressPercent: calculateProgress(totalFiles, processedFiles),
        createdPageCount: counts.pageCount,
        createdEntityCount: counts.entityCount,
        sourceLocator: fetched.locator,
        mimeType: fetched.mimeType,
        summary,
        latestMessage: `Prepared candidates from ${fetched.fileName}.`
      });
      createWikiIngestLog(
        jobId,
        `Prepared candidates from ${fetched.fileName}.`,
        "info",
        {
          fileName: currentAssetContext?.fileName ?? fetched.fileName,
          sourceAssetId: currentAssetContext?.assetId ?? null,
          fileIndex: currentAssetContext?.fileIndex ?? processedFiles,
          totalFiles: currentAssetContext?.totalFiles ?? totalFiles,
          pageCandidates: counts.pageCount,
          entityCandidates: counts.entityCount
        }
      );
      currentAssetContext = null;
      currentPollCount = 0;
    } catch (error) {
      processedFiles += 1;
      updateWikiIngestAsset(nextAsset.id, { status: "failed" });
      updateCurrentAssetMetadata({
        openAiResponseStatus: "failed",
        openAiLastPolledAt: nowIso(),
        openAiPollCount: currentPollCount
      });
      updateWikiIngestJob(jobId, {
        processedFiles,
        totalFiles,
        progressPercent: calculateProgress(totalFiles, processedFiles),
        latestMessage:
          error instanceof Error ? error.message : "Source ingest failed."
      });
      createWikiIngestLog(
        jobId,
        error instanceof Error ? error.message : "Source ingest failed.",
        "error",
        {
          fileName: currentAssetContext?.fileName ?? null,
          fileIndex: currentAssetContext?.fileIndex ?? null,
          totalFiles: currentAssetContext?.totalFiles ?? totalFiles,
          pollCount: currentPollCount
        }
      );
      currentAssetContext = null;
      currentPollCount = 0;
    }
  }

  const counts = refreshCounts();
  updateWikiIngestJob(jobId, {
    status: hadSuccess ? "completed" : "failed",
    phase: hadSuccess ? "review" : "failed",
    progressPercent: 100,
    totalFiles,
    processedFiles: Math.max(processedFiles, totalFiles),
    createdPageCount: counts.pageCount,
    createdEntityCount: counts.entityCount,
    latestMessage: hadSuccess
      ? "Ingest finished. Review the proposed pages and entities."
      : "Ingest failed before any candidates could be prepared.",
    errorMessage: hadSuccess ? "" : "No candidates were produced.",
    completedAt: nowIso()
  });
  createWikiIngestLog(
    jobId,
    hadSuccess
      ? "Background wiki ingestion completed and is ready for review."
      : "Background wiki ingestion failed.",
    hadSuccess ? "info" : "error"
  );
  return getWikiIngestJob(jobId);
}

export function listWikiIngestJobs(
  input: z.input<typeof listWikiIngestJobsQuerySchema> = {}
) {
  const parsed = listWikiIngestJobsQuerySchema.parse(input);
  const rows = getDatabase()
    .prepare(
      `SELECT id
       FROM wiki_ingest_jobs
       WHERE (? IS NULL OR space_id = ?)
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(
      parsed.spaceId ?? null,
      parsed.spaceId ?? null,
      parsed.limit
    ) as Array<{
    id: string;
  }>;
  return rows
    .map((row) => getWikiIngestJob(row.id))
    .filter((job): job is WikiIngestJobPayload => job !== null);
}

export async function rerunWikiIngestJob(
  jobId: string,
  options: {
    actor?: string | null;
  } = {}
) {
  const job = readWikiIngestJobRow(jobId);
  if (!job) {
    return null;
  }
  if (["queued", "processing"].includes(job.status)) {
    throw new Error("Wiki ingest jobs can only be rerun after processing ends.");
  }

  const ingestInput = readWikiIngestInput(jobId);
  if (!ingestInput) {
    throw new Error("Wiki ingest input could not be restored.");
  }

  const rootAssets = listWikiIngestJobAssetsInternal(jobId).filter((asset) => {
    const metadata = parseJsonRecord(asset.metadata_json);
    return !metadata?.parentAssetId && asset.source_kind !== "url";
  });

  const replayResult =
    rootAssets.length > 0
      ? await createUploadedWikiIngestJob(
          {
            spaceId: ingestInput.spaceId,
            titleHint: ingestInput.titleHint,
            llmProfileId: ingestInput.llmProfileId,
            parseStrategy: ingestInput.parseStrategy,
            entityProposalMode: ingestInput.entityProposalMode,
            userId: ingestInput.userId ?? null,
            createAsKind: ingestInput.createAsKind,
            linkedEntityHints: ingestInput.linkedEntityHints
          },
          await Promise.all(
            rootAssets.map(async (asset) => ({
              fileName: asset.file_name,
              mimeType: asset.mime_type,
              payload: await readFile(asset.file_path)
            }))
          ),
          {
            actor: options.actor ?? job.created_by_actor ?? null
          }
        )
      : await ingestWikiSource(ingestInput, {
          actor: options.actor ?? job.created_by_actor ?? null
        });

  const nextJobId = replayResult.job?.job.id ?? null;
  if (nextJobId) {
    createWikiIngestLog(
      nextJobId,
      `Reran ingest from ${jobId}.`,
      "info",
      {
        scope: "wiki_ingest",
        eventKey: "wiki_ingest_rerun",
        sourceJobId: jobId
      }
    );
    createWikiIngestLog(
      jobId,
      `Created rerun job ${nextJobId}.`,
      "info",
      {
        scope: "wiki_ingest",
        eventKey: "wiki_ingest_rerun_requested",
        rerunJobId: nextJobId
      }
    );
  }

  return replayResult;
}

export function deleteWikiIngestJob(jobId: string) {
  const job = readWikiIngestJobRow(jobId);
  if (!job) {
    return null;
  }
  if (["queued", "processing"].includes(job.status)) {
    throw new Error("Wiki ingest jobs can only be deleted after processing ends.");
  }

  const candidates = listWikiIngestCandidatesInternal(jobId);
  const assets = listWikiIngestJobAssetsInternal(jobId);
  const preservedAssetIds = new Set(
    candidates
      .filter((candidate) => candidate.status === "applied")
      .map((candidate) => candidate.source_asset_id)
      .filter((assetId): assetId is string => typeof assetId === "string")
  );

  for (const asset of assets) {
    if (preservedAssetIds.has(asset.id)) {
      continue;
    }
    const metadata = parseJsonRecord(asset.metadata_json);
    const rawSourcePath =
      typeof metadata?.rawSourcePath === "string"
        ? metadata.rawSourcePath
        : null;
    if (rawSourcePath && existsSync(rawSourcePath)) {
      unlinkSync(rawSourcePath);
    }
  }

  const jobDir = getWikiIngestJobDir(jobId);
  if (existsSync(jobDir)) {
    rmSync(jobDir, { recursive: true, force: true });
  }

  getDatabase()
    .prepare(`DELETE FROM wiki_ingest_jobs WHERE id = ?`)
    .run(jobId);

  return {
    id: jobId
  };
}

export async function reviewWikiIngestJob(
  jobId: string,
  input: z.input<typeof reviewWikiIngestJobSchema>,
  options: {
    createNote: (note: CreateNoteInput) => Note;
    updateNote: (
      noteId: string,
      patch: Record<string, unknown>
    ) => Note | undefined;
    publishEntity: (proposal: Record<string, unknown>) => {
      entityType: string;
      entityId: string;
    };
    resolveMappedEntity: (
      entityType: CrudEntityType,
      entityId: string
    ) =>
      | {
          entityType: CrudEntityType;
          entityId: string;
        }
      | null;
  }
) {
  const parsed = reviewWikiIngestJobSchema.parse(input);
  const job = readWikiIngestJobRow(jobId);
  if (!job) {
    return null;
  }
  const ingestInput = readWikiIngestInput(jobId);
  if (!ingestInput) {
    return null;
  }
  const candidates = listWikiIngestCandidatesInternal(jobId);
  let acceptedCount = 0;
  let mappedCount = 0;
  let rejectedCount = 0;
  let firstPublishedPageId: string | null = null;

  for (const decision of parsed.decisions) {
    const candidate = candidates.find(
      (entry) => entry.id === decision.candidateId
    );
    if (!candidate) {
      continue;
    }
    if (candidate.status === "applied") {
      continue;
    }
    const action =
      decision.action ??
      (decision.keep === false ? "discard" : "keep");
    if (action === "discard") {
      rejectedCount += 1;
      updateWikiIngestCandidate(candidate.id, { status: "rejected" });
      continue;
    }

    try {
        const payload = parseJsonRecord(candidate.payload_json);
        if (candidate.candidate_type === "page") {
          if (action === "merge_existing") {
            const target =
              decision.targetNoteId
                ? (getWikiPageDetail(decision.targetNoteId)?.page ?? null)
                : null;
            if (!target || target.spaceId !== job.space_id) {
              throw new Error("Merge target page was not found.");
            }
            const incomingTitle =
              typeof payload.title === "string" ? payload.title : candidate.title;
            const incomingMarkdown =
              typeof payload.contentMarkdown === "string"
                ? payload.contentMarkdown
                : `# ${candidate.title}\n`;
            const mergedContentMarkdown = mergeWikiPageContent(
              target.contentMarkdown,
              {
                title: incomingTitle,
                markdown: incomingMarkdown
              }
            );
            const mergedSummary = inferSummary(mergedContentMarkdown);
            const updated = options.updateNote(target.id, {
              contentMarkdown: mergedContentMarkdown,
              summary: mergedSummary
            });
            if (!updated) {
              throw new Error("Merge target page could not be updated.");
            }
            acceptedCount += 1;
            firstPublishedPageId = firstPublishedPageId ?? updated.id;
            updateWikiIngestCandidate(candidate.id, {
              status: "applied",
              publishedNoteId: updated.id
            });
          } else {
            const note = options.createNote({
              kind: payload.kind === "evidence" ? "evidence" : "wiki",
              title:
                typeof payload.title === "string"
                  ? payload.title
                  : candidate.title,
              slug: "",
              indexOrder: 0,
              aliases: Array.isArray(payload.aliases)
                ? payload.aliases.filter(
                    (alias): alias is string => typeof alias === "string"
                  )
                : [],
              summary:
                typeof payload.summary === "string"
                  ? payload.summary
                  : candidate.summary,
              sourcePath: "",
              frontmatter: {},
              revisionHash: "",
              spaceId: job.space_id,
              parentSlug:
                typeof payload.parentSlug === "string"
                  ? payload.parentSlug
                  : null,
              contentMarkdown:
                typeof payload.contentMarkdown === "string"
                  ? payload.contentMarkdown
                  : `# ${candidate.title}\n`,
              author: ingestInput.userId ?? null,
              links: Array.isArray(payload.links)
                ? (payload.links as CreateNoteInput["links"])
                : ingestInput.linkedEntityHints,
              tags: Array.isArray(payload.tags)
                ? payload.tags.filter(
                    (tag): tag is string => typeof tag === "string"
                  )
                : [],
              destroyAt: null,
              userId: ingestInput.userId ?? null
            });
            acceptedCount += 1;
            firstPublishedPageId = firstPublishedPageId ?? note.id;
            updateWikiIngestCandidate(candidate.id, {
              status: "applied",
              publishedNoteId: note.id
            });
          }
        } else if (candidate.candidate_type === "page_update") {
        const targetSlug =
          typeof payload.targetSlug === "string"
            ? payload.targetSlug
            : candidate.target_key;
        const target =
          targetSlug.trim().length > 0
            ? (getWikiPageDetailBySlug({
                slug: targetSlug,
                spaceId: job.space_id
              })?.page ?? null)
            : null;
        if (target) {
          const patchSummary =
            typeof payload.patchSummary === "string"
              ? payload.patchSummary
              : "";
          const rationale =
            typeof payload.rationale === "string" ? payload.rationale : "";
          options.updateNote(target.id, {
            contentMarkdown: `${target.contentMarkdown.trim()}\n\n## Imported update\n\n${patchSummary}\n${
              rationale ? `\n${rationale}\n` : ""
            }`,
            summary:
              target.summary || (typeof rationale === "string" ? rationale : "")
          });
          acceptedCount += 1;
          updateWikiIngestCandidate(candidate.id, {
            status: "applied",
            publishedNoteId: target.id
          });
        } else {
          updateWikiIngestCandidate(candidate.id, { status: "failed" });
        }
      } else if (candidate.candidate_type === "entity") {
        if (action === "map_existing") {
          const proposedType =
            typeof payload.entityType === "string" ? payload.entityType : "";
          if (decision.mappedEntityType !== proposedType) {
            throw new Error(
              "Mapped entity type must match the proposed entity type."
            );
          }
          const mapped = options.resolveMappedEntity(
            decision.mappedEntityType,
            decision.mappedEntityId!
          );
          if (!mapped) {
            throw new Error("Mapped entity was not found.");
          }
          acceptedCount += 1;
          mappedCount += 1;
          updateWikiIngestCandidate(candidate.id, {
            status: "applied",
            publishedEntityType: mapped.entityType,
            publishedEntityId: mapped.entityId
          });
        } else {
          const result = options.publishEntity(payload);
          acceptedCount += 1;
          updateWikiIngestCandidate(candidate.id, {
            status: "applied",
            publishedEntityType: result.entityType,
            publishedEntityId: result.entityId
          });
        }
      }
    } catch {
      updateWikiIngestCandidate(candidate.id, { status: "failed" });
    }
  }

  updateWikiIngestJob(jobId, {
    phase: "reviewed",
    acceptedCount,
    rejectedCount,
    pageNoteId: firstPublishedPageId,
    latestMessage:
      acceptedCount > 0 || rejectedCount > 0
        ? `Review saved with ${acceptedCount} kept${
            mappedCount > 0 ? ` (${mappedCount} mapped)` : ""
          } and ${rejectedCount} discarded.`
        : "Review saved."
  });
  createWikiIngestLog(
    jobId,
    `Review saved with ${acceptedCount} kept${
      mappedCount > 0 ? ` (${mappedCount} mapped)` : ""
    } and ${rejectedCount} discarded.`
  );
  return getWikiIngestJob(jobId);
}

export function getWikiIngestJob(jobId: string) {
  const job = readWikiIngestJobRow(jobId);
  if (!job) {
    return null;
  }
  const items = getDatabase()
    .prepare(
      `SELECT id, job_id, item_type, status, note_id, media_asset_id, payload_json, created_at, updated_at
       FROM wiki_ingest_job_items
       WHERE job_id = ?
       ORDER BY created_at ASC`
    )
    .all(jobId) as Array<{
    id: string;
    item_type: string;
    status: string;
    note_id: string | null;
    media_asset_id: string | null;
    payload_json: string;
    created_at: string;
    updated_at: string;
  }>;
  const assets = listWikiIngestJobAssetsInternal(jobId);
  const normalizedItems =
    items.length > 0
      ? items.map((item) => ({
          id: item.id,
          itemType: item.item_type,
          status: item.status,
          noteId: item.note_id,
          mediaAssetId: item.media_asset_id,
          payload: parseJsonRecord(item.payload_json),
          createdAt: item.created_at,
          updatedAt: item.updated_at
        }))
      : assets.map((asset) => ({
          id: asset.id,
          itemType: "raw_source",
          status: asset.status,
          noteId: null,
          mediaAssetId: null,
          payload: {
            sourceKind: asset.source_kind,
            sourceLocator: asset.source_locator,
            fileName: asset.file_name,
            mimeType: asset.mime_type,
            filePath: asset.file_path,
            sizeBytes: asset.size_bytes,
            checksum: asset.checksum,
            ...(parseJsonRecord(asset.metadata_json) ?? {})
          },
          createdAt: asset.created_at,
          updatedAt: asset.updated_at
        }));
  return wikiIngestJobPayloadSchema.parse({
    job: mapWikiIngestJobRow(job),
    items: normalizedItems,
    logs: listWikiIngestJobLogsInternal(jobId).map((log) => ({
      id: log.id,
      level: log.level,
      message: log.message,
      metadata: parseJsonRecord(log.metadata_json),
      createdAt: log.created_at
    })),
    assets: assets.map((asset) => ({
      id: asset.id,
      status: asset.status,
      sourceKind: asset.source_kind,
      sourceLocator: asset.source_locator,
      fileName: asset.file_name,
      mimeType: asset.mime_type,
      filePath: asset.file_path,
      sizeBytes: asset.size_bytes,
      checksum: asset.checksum,
      metadata: parseJsonRecord(asset.metadata_json),
      createdAt: asset.created_at,
      updatedAt: asset.updated_at
    })),
    candidates: listWikiIngestCandidatesInternal(jobId).map((candidate) => ({
      id: candidate.id,
      sourceAssetId: candidate.source_asset_id,
      candidateType: candidate.candidate_type,
      status: candidate.status,
      title: candidate.title,
      summary: candidate.summary,
      targetKey: candidate.target_key,
      payload: parseJsonRecord(candidate.payload_json),
      publishedNoteId: candidate.published_note_id,
      publishedEntityType: candidate.published_entity_type,
      publishedEntityId: candidate.published_entity_id,
      createdAt: candidate.created_at,
      updatedAt: candidate.updated_at
    }))
  });
}
