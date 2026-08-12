import { createHash } from "node:crypto";

import { runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import {
  captureConfirmationSchema,
  captureIntentSchema,
  captureProposalSchema,
  type CaptureConfirmation,
  type CaptureIntent,
  type CaptureProposal,
  type CaptureReceipt
} from "../capture-types.js";
import { getDeletedEntityRecord } from "../repositories/deleted-entities.js";
import {
  createNoteWithinTransaction,
  getNoteById,
  type CreateNoteOptions
} from "../repositories/notes.js";
import { getUserById } from "../repositories/users.js";
import type { CreateNoteInput } from "../types.js";
import {
  artifactIdForIdempotencyKey,
  createArtifactFromUpload,
  getArtifactById,
  type ArtifactContext
} from "./artifacts.js";
import {
  crudEntityIsLiveAndVisible,
  type CrudContext
} from "./entity-crud.js";
import type { LocalSearchResult } from "./local-search.js";

type CaptureContext = ArtifactContext & CrudContext;

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

function truncate(value: string, maximum: number) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`;
}

function titleFromText(text: string, fallback: string) {
  const firstLine = text
    .split(/\r?\n/gu)
    .map((line) => line.replace(/^\s*#+\s*/u, "").trim())
    .find(Boolean);
  return truncate(firstLine || fallback, 240);
}

function escapeMarkdownLabel(value: string) {
  return value.replaceAll(/[\\[\]]/gu, (character) => `\\${character}`);
}

function safeCapturedUrl(raw: string) {
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new HttpError(
      400,
      "capture_url_protocol_unsupported",
      "Capture accepts only HTTP or HTTPS links."
    );
  }
  parsed.username = "";
  parsed.password = "";
  return parsed.toString();
}

function relationshipReason(result: LocalSearchResult) {
  const evidence = result.evidence[0];
  if (!evidence) return "Forge found this authorized record in local search.";
  return evidence.kind === "text"
    ? `Matched ${evidence.label}: “${truncate(evidence.excerpt, 220)}”`
    : `Related through ${evidence.label}: “${truncate(evidence.excerpt, 220)}”`;
}

function relationshipKey(input: { entityType: string; entityId: string }) {
  return `${input.entityType}:${input.entityId}`;
}

export function captureSearchQuery(intentInput: CaptureIntent) {
  const intent = captureIntentSchema.parse(intentInput);
  if (intent.kind === "file") {
    return truncate(`${intent.file.name} ${intent.text}`, 200);
  }
  if (intent.kind === "url") {
    const url = new URL(safeCapturedUrl(intent.url));
    return truncate(`${url.hostname} ${url.pathname} ${intent.text}`, 200);
  }
  return truncate(intent.text, 200);
}

export function buildCaptureProposal(input: {
  intent: CaptureIntent;
  searchResults?: LocalSearchResult[];
}): CaptureProposal {
  const intent = captureIntentSchema.parse(input.intent);
  if (intent.ownerUserId && !getUserById(intent.ownerUserId)) {
    throw new HttpError(
      404,
      "capture_owner_unavailable",
      "The selected capture owner is unavailable."
    );
  }

  let targetType: "note" | "artifact";
  let title: string;
  let contentMarkdown: string | null;
  let description: string | null;
  let classificationReason: string;
  const warnings: string[] = [];

  if (intent.kind === "file") {
    targetType = "artifact";
    title = truncate(intent.file.name.replace(/\.[^.]+$/u, ""), 240);
    contentMarkdown = null;
    description = intent.text || null;
    classificationReason =
      "A file must become an Artifact so Forge can preserve its bytes, provenance, and static safety scan.";
    warnings.push(
      "The file stays in this browser until you confirm. Forge will scan and classify it only while creating the Artifact."
    );
  } else if (intent.kind === "url") {
    targetType = "note";
    const url = new URL(safeCapturedUrl(intent.url));
    title = titleFromText(intent.text, `Link from ${url.hostname}`);
    contentMarkdown = `${intent.text ? `${intent.text}\n\n` : ""}[${escapeMarkdownLabel(url.hostname)}](${url.toString()})`;
    description = null;
    classificationReason =
      "A link with optional context becomes a Note so the original URL remains readable and searchable.";
  } else {
    targetType = "note";
    title = titleFromText(
      intent.text,
      intent.kind === "dictation" ? "Dictated note" : "Captured note"
    );
    contentMarkdown = intent.text;
    description = null;
    classificationReason =
      intent.kind === "dictation"
        ? "Browser dictation produced text, so Forge proposes a Note and preserves dictation as provenance rather than storing audio."
        : "Text becomes a Note so it remains durable, editable, searchable Markdown.";
  }

  const seen = new Set<string>();
  const relationships = (input.searchResults ?? [])
    .filter((result) => {
      const key = relationshipKey(result);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5)
    .map((result) => ({
      entityType: result.entityType,
      entityId: result.entityId,
      title: truncate(result.title, 240),
      sourceHref: result.sourceHref,
      reason: relationshipReason(result)
    }));

  const proposalPayload = {
    version: 1 as const,
    targetType,
    confidence: relationships.length > 0 ? "review_required" : "deterministic",
    classificationReason,
    title,
    contentMarkdown,
    description,
    relationships,
    warnings,
    requiresConfirmation: true as const
  };
  return captureProposalSchema.parse({
    ...proposalPayload,
    proposalId: `capture_proposal_${sha256(
      canonicalJson({ intent, proposal: proposalPayload })
    ).slice(0, 32)}`
  });
}

function selectedRelationships(
  proposal: CaptureProposal,
  confirmation: CaptureConfirmation,
  context: CaptureContext
) {
  const available = new Map(
    proposal.relationships.map((relationship) => [
      relationshipKey(relationship),
      relationship
    ])
  );
  const selected = confirmation.selection.relationshipKeys.map((key) => {
    const relationship = available.get(key);
    if (!relationship) {
      throw new HttpError(
        409,
        "capture_relationship_proposal_changed",
        "A selected relationship is no longer part of this capture proposal. Review the proposal again."
      );
    }
    return relationship;
  });
  if (new Set(selected.map(relationshipKey)).size !== selected.length) {
    throw new HttpError(
      400,
      "capture_relationship_duplicate",
      "Select each proposed relationship at most once."
    );
  }
  const scope = confirmation.intent.ownerUserId
    ? { ...context, userIds: [confirmation.intent.ownerUserId] }
    : context;
  for (const relationship of selected) {
    if (
      !crudEntityIsLiveAndVisible(
        relationship.entityType,
        relationship.entityId,
        scope
      )
    ) {
      throw new HttpError(
        404,
        "capture_relationship_unavailable",
        "A proposed relationship is no longer available. Nothing was created."
      );
    }
  }
  return selected;
}

function noteCaptureMetadata(note: ReturnType<typeof getNoteById>) {
  const metadata = note?.frontmatter.captureReceipt;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : null;
}

function noteIdForCapture(idempotencyKey: string) {
  return `note_${sha256(`capture-note-v1\0operator\0${idempotencyKey}`).slice(0, 24)}`;
}

function confirmationFingerprint(confirmation: CaptureConfirmation) {
  return sha256(
    canonicalJson({
      proposalId: confirmation.proposalId,
      intent: confirmation.intent,
      selection: confirmation.selection
    })
  );
}

function confirmedAtFromMetadata(value: unknown, fallback: string) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? value
    : fallback;
}

export async function confirmCapture(input: {
  confirmation: CaptureConfirmation;
  proposal: CaptureProposal;
  context: CaptureContext;
}): Promise<CaptureReceipt> {
  const confirmation = captureConfirmationSchema.parse(input.confirmation);
  const proposal = captureProposalSchema.parse(input.proposal);
  const fingerprint = confirmationFingerprint(confirmation);
  const now = new Date().toISOString();

  if (confirmation.selection.targetType === "note") {
    const noteId = noteIdForCapture(confirmation.idempotencyKey);
    const replay = getNoteById(noteId);
    if (replay) {
      const receipt = noteCaptureMetadata(replay);
      if (receipt?.payloadFingerprint !== fingerprint) {
        throw new HttpError(
          409,
          "capture_idempotency_conflict",
          "This capture idempotency key was already used with a different confirmed payload."
        );
      }
      return {
        version: 1,
        proposalId: confirmation.proposalId,
        targetType: "note",
        targetId: noteId,
        targetHref: `/notes?focus=${encodeURIComponent(noteId)}`,
        title: replay.title,
        replayed: true,
        confirmedAt: confirmedAtFromMetadata(receipt.confirmedAt, replay.createdAt),
        relationshipCount: replay.links.length
      };
    }
    if (getDeletedEntityRecord("note", noteId)) {
      throw new HttpError(
        409,
        "capture_idempotency_target_deleted",
        "This capture was already confirmed and later deleted. Restore it or use a new capture."
      );
    }
  } else if (confirmation.intent.kind === "file") {
    if (!confirmation.fileContentBase64) {
      throw new HttpError(
        400,
        "capture_file_bytes_required",
        "Choose the reviewed file again before confirming this Artifact."
      );
    }
    const replayBytes = Buffer.from(confirmation.fileContentBase64, "base64");
    const exactBytes =
      replayBytes.byteLength === confirmation.intent.file.byteSize &&
      sha256(replayBytes) === confirmation.intent.file.sha256;
    replayBytes.fill(0);
    if (!exactBytes) {
      throw new HttpError(
        409,
        "capture_file_changed",
        "The selected file changed after review. Review the current file before confirming."
      );
    }
    const artifactId = artifactIdForIdempotencyKey(
      confirmation.idempotencyKey,
      input.context
    );
    const replay = getArtifactById(artifactId, input.context);
    if (replay) {
      const receipt = replay.metadata.captureReceipt;
      if (
        !receipt ||
        typeof receipt !== "object" ||
        Array.isArray(receipt) ||
        (receipt as Record<string, unknown>).payloadFingerprint !== fingerprint
      ) {
        throw new HttpError(
          409,
          "capture_idempotency_conflict",
          "This capture idempotency key was already used with a different confirmed payload."
        );
      }
      const metadata = receipt as Record<string, unknown>;
      return {
        version: 1,
        proposalId: confirmation.proposalId,
        targetType: "artifact",
        targetId: replay.id,
        targetHref: `/artifacts/${encodeURIComponent(replay.id)}`,
        title: replay.title,
        replayed: true,
        confirmedAt: confirmedAtFromMetadata(
          metadata.confirmedAt,
          replay.createdAt
        ),
        relationshipCount: replay.links.length
      };
    }
    if (getDeletedEntityRecord("artifact", artifactId)) {
      throw new HttpError(
        409,
        "capture_idempotency_target_deleted",
        "This capture was already confirmed and later deleted. Restore it or use a new capture."
      );
    }
  }
  if (confirmation.proposalId !== proposal.proposalId) {
    throw new HttpError(
      409,
      "capture_proposal_stale",
      "The capture proposal changed. Review the current proposal before confirming."
    );
  }
  if (confirmation.selection.targetType !== proposal.targetType) {
    throw new HttpError(
      409,
      "capture_target_type_changed",
      "The selected record type does not match the reviewed proposal."
    );
  }
  const relationships = selectedRelationships(
    proposal,
    confirmation,
    input.context
  );
  const idempotencyKeyHash = sha256(confirmation.idempotencyKey);

  if (proposal.targetType === "note") {
    if (!confirmation.selection.contentMarkdown) {
      throw new HttpError(
        400,
        "capture_note_content_required",
        "A captured Note requires Markdown content."
      );
    }
    if (confirmation.fileContentBase64 !== null) {
      throw new HttpError(
        400,
        "capture_file_unexpected",
        "File bytes are accepted only for an Artifact capture."
      );
    }
    const noteId = noteIdForCapture(confirmation.idempotencyKey);
    const noteInput: CreateNoteInput = {
      kind: "evidence",
      title: confirmation.selection.title,
      slug: "",
      spaceId: "",
      parentSlug: null,
      indexOrder: 0,
      showInIndex: false,
      aliases: [],
      summary: "",
      contentMarkdown: confirmation.selection.contentMarkdown,
      author: input.context.actor ?? null,
      links: relationships.map((relationship) => ({
        entityType: relationship.entityType,
        entityId: relationship.entityId,
        anchorKey: null
      })),
      tags: [],
      destroyAt: null,
      sourcePath: "",
      frontmatter: {
        captureReceipt: {
          version: 1,
          proposalId: confirmation.proposalId,
          inputKind: confirmation.intent.kind,
          payloadFingerprint: fingerprint,
          idempotencyKeyHash,
          confirmedAt: now
        }
      },
      revisionHash: "",
      lastSyncedAt: null,
      userId: confirmation.intent.ownerUserId
    };
    const note = runInTransaction(() =>
      createNoteWithinTransaction(noteInput, input.context, {
        id: noteId
      } satisfies CreateNoteOptions)
    );
    return {
      version: 1,
      proposalId: confirmation.proposalId,
      targetType: "note",
      targetId: note.id,
      targetHref: `/notes?focus=${encodeURIComponent(note.id)}`,
      title: note.title,
      replayed: false,
      confirmedAt: now,
      relationshipCount: note.links.length
    };
  }

  if (confirmation.intent.kind !== "file") {
    throw new HttpError(
      409,
      "capture_file_intent_required",
      "An Artifact capture requires the reviewed file intent."
    );
  }
  if (!confirmation.fileContentBase64) {
    throw new HttpError(
      400,
      "capture_file_bytes_required",
      "Choose the reviewed file again before confirming this Artifact."
    );
  }
  const bytes = Buffer.from(confirmation.fileContentBase64, "base64");
  if (
    bytes.byteLength !== confirmation.intent.file.byteSize ||
    sha256(bytes) !== confirmation.intent.file.sha256
  ) {
    bytes.fill(0);
    throw new HttpError(
      409,
      "capture_file_changed",
      "The selected file changed after review. Review the current file before confirming."
    );
  }
  bytes.fill(0);
  const result = await createArtifactFromUpload(
    {
      idempotencyKey: confirmation.idempotencyKey,
      title: confirmation.selection.title,
      shortDescription: "",
      description: confirmation.selection.description ?? "",
      originalFileName: confirmation.intent.file.name,
      declaredMimeType: confirmation.intent.file.declaredMimeType,
      contentBase64: confirmation.fileContentBase64,
      sourceKind: "upload",
      sourceLabel: "Global Capture",
      uploadedByUserId: confirmation.intent.ownerUserId,
      actingForUserId: confirmation.intent.ownerUserId,
      downloadPolicy: "human_only",
      links: relationships.map((relationship) => ({
        entityType: relationship.entityType,
        entityId: relationship.entityId,
        relationship: "related",
        anchorKey: ""
      })),
      metadata: {
        captureReceipt: {
          version: 1,
          proposalId: confirmation.proposalId,
          inputKind: confirmation.intent.kind,
          payloadFingerprint: fingerprint,
          idempotencyKeyHash,
          confirmedAt: now
        }
      },
      useLlmEnrichment: false
    },
    input.context
  );
  const captureReceipt = result.artifact.metadata.captureReceipt;
  const receiptMetadata =
    captureReceipt &&
    typeof captureReceipt === "object" &&
    !Array.isArray(captureReceipt)
      ? (captureReceipt as Record<string, unknown>)
      : {};
  return {
    version: 1,
    proposalId: confirmation.proposalId,
    targetType: "artifact",
    targetId: result.artifact.id,
    targetHref: `/artifacts/${encodeURIComponent(result.artifact.id)}`,
    title: result.artifact.title,
    replayed: result.replayed,
    confirmedAt: confirmedAtFromMetadata(
      receiptMetadata.confirmedAt,
      result.artifact.createdAt
    ),
    relationshipCount: result.artifact.links.length
  };
}
