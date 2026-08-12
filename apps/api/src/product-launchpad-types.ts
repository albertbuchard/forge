import { z } from "zod";

export const productOutcomeKeySchema = z.enum([
  "plan_week",
  "daily_reflection",
  "research_project"
]);

export const productPackageKindSchema = z.enum([
  "starter_pack",
  "integration"
]);

export const productPackageRecordSchema = z
  .object({
    ref: z.string().trim().min(1).max(80),
    entityType: z.enum(["goal", "project", "task", "habit", "note", "tag"]),
    title: z.string().trim().min(1).max(240),
    description: z.string().trim().max(4_000),
    dependsOn: z.array(z.string().trim().min(1).max(80)).max(4),
    data: z.record(z.string(), z.unknown())
  })
  .strict();

export const productPackageSchema = z
  .object({
    id: z.string().trim().min(3).max(120),
    version: z.string().trim().min(1).max(40),
    kind: productPackageKindSchema,
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(1_000),
    outcomeKey: productOutcomeKeySchema.nullable(),
    author: z.string().trim().min(1).max(120),
    reviewState: z.enum(["forge_reviewed", "external_setup"]),
    compatibility: z.string().trim().min(1).max(120),
    permissions: z.array(z.string().trim().min(1).max(120)).max(32),
    records: z.array(productPackageRecordSchema).max(40),
    setupHref: z.string().trim().max(2_048).nullable(),
    manifestSha256: z.string().regex(/^[0-9a-f]{64}$/u)
  })
  .strict();

export const productOnboardingUpdateSchema = z
  .object({
    ownerUserId: z.string().trim().min(1).max(256),
    outcomeKey: productOutcomeKeySchema.nullable(),
    currentStep: z.enum([
      "choose_outcome",
      "review_pack",
      "install_pack",
      "first_result",
      "complete"
    ]),
    status: z.enum(["not_started", "in_progress", "skipped", "complete"])
  })
  .strict();

export const productPackagePreviewSchema = z
  .object({
    ownerUserId: z.string().trim().min(1).max(256),
    packageId: z.string().trim().min(3).max(120)
  })
  .strict();

export const productPackageInstallSchema = productPackagePreviewSchema.extend({
  manifestSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  idempotencyKey: z
    .string()
    .trim()
    .min(8)
    .max(200)
    .regex(/^[A-Za-z0-9._:-]+$/u)
});

export const productPackageRemoveSchema = z
  .object({
    ownerUserId: z.string().trim().min(1).max(256),
    expectedStatus: z.literal("installed")
  })
  .strict();

export const productImportSourceSchema = z.enum([
  "markdown",
  "obsidian",
  "notion",
  "todoist",
  "apple_reminders",
  "calendar",
  "github_issues",
  "linear"
]);

export const productImportItemSchema = z
  .object({
    sourceId: z.string().trim().min(1).max(512),
    recordType: z.enum(["note", "task", "calendar_event"]),
    title: z.string().trim().min(1).max(240),
    content: z.string().trim().max(24_000).default(""),
    status: z.string().trim().max(80).nullable().default(null),
    dueAt: z.string().datetime().nullable().default(null),
    sourceUrl: z.string().url().max(4_096).nullable().default(null),
    metadata: z.record(z.string(), z.unknown()).default({})
  })
  .strict();

export const productImportPreviewSchema = z
  .object({
    ownerUserId: z.string().trim().min(1).max(256),
    sourceKind: productImportSourceSchema,
    sourceLabel: z.string().trim().min(1).max(240),
    items: z.array(productImportItemSchema).min(1).max(500)
  })
  .strict();

export const productImportCommitSchema = z
  .object({
    ownerUserId: z.string().trim().min(1).max(256),
    previewId: z.string().trim().min(1).max(120),
    payloadFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
    idempotencyKey: z
      .string()
      .trim()
      .min(8)
      .max(200)
      .regex(/^[A-Za-z0-9._:-]+$/u),
    decisions: z
      .array(
        z
          .object({
            sourceId: z.string().trim().min(1).max(512),
            action: z.enum(["create", "skip"])
          })
          .strict()
      )
      .max(500)
  })
  .strict();

export const productImportRollbackSchema = z
  .object({
    ownerUserId: z.string().trim().min(1).max(256),
    expectedStatus: z.literal("committed")
  })
  .strict();

export const productReviewDecisionSchema = z
  .object({
    ownerUserId: z.string().trim().min(1).max(256),
    expectedRevision: z.number().int().positive(),
    decision: z.enum(["accept", "reject"])
  })
  .strict();

export const productFeedbackSettingsSchema = z
  .object({
    ownerUserId: z.string().trim().min(1).max(256),
    enabled: z.boolean(),
    consentVersion: z.literal("privacy-feedback-v1").nullable()
  })
  .strict();

export const productFeedbackEventSchema = z
  .object({
    ownerUserId: z.string().trim().min(1).max(256),
    eventName: z.enum([
      "onboarding_started",
      "onboarding_completed",
      "starter_pack_installed",
      "import_previewed",
      "import_completed",
      "feature_opened"
    ]),
    outcomeKey: productOutcomeKeySchema.nullable().default(null),
    surfaceKey: z.string().trim().min(1).max(80).nullable().default(null),
    success: z.boolean().nullable().default(null),
    durationBucket: z
      .enum(["under_1m", "1m_to_5m", "over_5m"])
      .nullable()
      .default(null)
  })
  .strict();

export type ProductPackage = z.infer<typeof productPackageSchema>;
export type ProductImportItem = z.infer<typeof productImportItemSchema>;
