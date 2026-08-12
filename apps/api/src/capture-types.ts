import { z } from "zod";

import { crudEntityTypeSchema } from "./types.js";

export const CAPTURE_MAX_TEXT_CHARACTERS = 24_000;
export const CAPTURE_MAX_RELATIONSHIPS = 5;
export const CAPTURE_MAX_FILE_BYTES = 100 * 1024 * 1024;

const captureTextSchema = z.string().trim().max(CAPTURE_MAX_TEXT_CHARACTERS);
const captureOwnerSchema = z.string().trim().min(1).max(256).nullable().default(null);

export const captureFileDescriptorSchema = z
  .object({
    name: z.string().trim().min(1).max(512),
    declaredMimeType: z.string().trim().max(240).default(""),
    byteSize: z.number().int().min(1).max(CAPTURE_MAX_FILE_BYTES),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u)
  })
  .strict();

export const captureIntentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      version: z.literal(1),
      kind: z.literal("text"),
      text: captureTextSchema.min(1),
      ownerUserId: captureOwnerSchema
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      kind: z.literal("dictation"),
      text: captureTextSchema.min(1),
      ownerUserId: captureOwnerSchema
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      kind: z.literal("url"),
      url: z.string().trim().url().max(4_096),
      text: captureTextSchema.default(""),
      ownerUserId: captureOwnerSchema
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      kind: z.literal("file"),
      file: captureFileDescriptorSchema,
      text: captureTextSchema.default(""),
      ownerUserId: captureOwnerSchema
    })
    .strict()
]);

export const captureRelationshipSchema = z
  .object({
    entityType: crudEntityTypeSchema,
    entityId: z.string().trim().min(1).max(512),
    title: z.string().trim().min(1).max(240),
    sourceHref: z.string().trim().min(1).max(2_048),
    reason: z.string().trim().min(1).max(500)
  })
  .strict();

export const captureProposalSchema = z
  .object({
    version: z.literal(1),
    proposalId: z.string().regex(/^capture_proposal_[0-9a-f]{32}$/u),
    targetType: z.enum(["note", "artifact"]),
    confidence: z.enum(["deterministic", "review_required"]),
    classificationReason: z.string().trim().min(1).max(500),
    title: z.string().trim().min(1).max(240),
    contentMarkdown: z.string().max(CAPTURE_MAX_TEXT_CHARACTERS).nullable(),
    description: z.string().max(CAPTURE_MAX_TEXT_CHARACTERS).nullable(),
    relationships: z
      .array(captureRelationshipSchema)
      .max(CAPTURE_MAX_RELATIONSHIPS),
    warnings: z.array(z.string().trim().min(1).max(500)).max(8),
    requiresConfirmation: z.literal(true)
  })
  .strict();

export const captureProposalRequestSchema = z
  .object({ intent: captureIntentSchema })
  .strict();

export const captureConfirmationSchema = z
  .object({
    proposalId: z.string().regex(/^capture_proposal_[0-9a-f]{32}$/u),
    idempotencyKey: z
      .string()
      .trim()
      .min(8)
      .max(200)
      .regex(/^[A-Za-z0-9._:-]+$/u),
    intent: captureIntentSchema,
    selection: z
      .object({
        targetType: z.enum(["note", "artifact"]),
        title: z.string().trim().min(1).max(240),
        contentMarkdown: z
          .string()
          .trim()
          .min(1)
          .max(CAPTURE_MAX_TEXT_CHARACTERS)
          .nullable(),
        description: z
          .string()
          .trim()
          .max(CAPTURE_MAX_TEXT_CHARACTERS)
          .nullable(),
        relationshipKeys: z
          .array(z.string().trim().min(3).max(640))
          .max(CAPTURE_MAX_RELATIONSHIPS)
      })
      .strict(),
    fileContentBase64: z.string().nullable().default(null)
  })
  .strict();

export const captureReceiptSchema = z
  .object({
    version: z.literal(1),
    proposalId: z.string(),
    targetType: z.enum(["note", "artifact"]),
    targetId: z.string(),
    targetHref: z.string(),
    title: z.string(),
    replayed: z.boolean(),
    confirmedAt: z.string(),
    relationshipCount: z.number().int().nonnegative()
  })
  .strict();

export type CaptureIntent = z.infer<typeof captureIntentSchema>;
export type CaptureProposal = z.infer<typeof captureProposalSchema>;
export type CaptureConfirmation = z.infer<typeof captureConfirmationSchema>;
export type CaptureReceipt = z.infer<typeof captureReceiptSchema>;
