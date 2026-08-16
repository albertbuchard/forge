import { z } from "zod";

export const AGENT_MESSAGE_MAX_TEXT_BYTES = 50_000;
export const AGENT_MESSAGE_MAX_VOICE_BYTES = 25 * 1024 * 1024;
export const AGENT_MESSAGE_MAX_VOICE_DURATION_MS = 600_000;
export const AGENT_MESSAGE_DEFAULT_RETENTION_DAYS = 365;
export const AGENT_MESSAGE_RESERVATION_TTL_HOURS = 24;
export const AGENT_MESSAGE_DEFAULT_LEASE_SECONDS = 300;
export const AGENT_MESSAGE_MIN_LEASE_SECONDS = 60;
export const AGENT_MESSAGE_MAX_LEASE_SECONDS = 900;

export const INBOX_ACTIVITY_EVENT_KINDS = [
  "progress",
  "acknowledgement",
  "handled",
  "failed",
  "forwarded"
] as const;

export const agentMessageStatusSchema = z.enum([
  "delivered",
  "claimed",
  "in_progress",
  "acknowledged",
  "handled",
  "failed",
  "forwarded"
]);

export const agentMessageEventKindSchema = z.enum([
  "created",
  "delivered",
  "claimed",
  "lease_renewed",
  "lease_expired_takeover",
  "progress",
  "acknowledgement",
  "lease_revoked",
  "reassigned",
  "retried",
  "handled",
  "failed",
  "forwarded",
  "deleted",
  "retention_purged"
]);

export const operationKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/u);

export const leaseSecretSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43,128}$/u, "Use a base64url-encoded random lease secret.");

export const createVoiceReservationSchema = z
  .object({
    idempotencyKey: operationKeySchema,
    originalFileName: z.string().trim().min(1).max(180),
    declaredMimeType: z.string().trim().min(1).max(200),
    declaredDurationMs: z.number().int().min(0).max(AGENT_MESSAGE_MAX_VOICE_DURATION_MS)
  })
  .strict();

export const activateVoiceReservationSchema = z
  .object({
    idempotencyKey: operationKeySchema,
    contentBase64: z.string().min(1),
    declaredMimeType: z.string().trim().min(1).max(200),
    declaredDurationMs: z.number().int().min(0).max(AGENT_MESSAGE_MAX_VOICE_DURATION_MS)
  })
  .strict();

export const createAgentMessageSchema = z
  .object({
    idempotencyKey: operationKeySchema,
    recipientAgentId: z.string().trim().min(1).max(200).optional(),
    bodyText: z.string().max(50_000).optional().default(""),
    voiceReservationId: z.string().trim().min(1).max(200).optional(),
    retentionDays: z.number().int().min(1).max(3650).optional().default(
      AGENT_MESSAGE_DEFAULT_RETENTION_DAYS
    ),
    forwardedFromMessageId: z.string().trim().min(1).max(200).optional(),
    retriedFromMessageId: z.string().trim().min(1).max(200).optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      Buffer.byteLength(value.bodyText.trim(), "utf8") === 0 &&
      !value.voiceReservationId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A message requires text, an active voice reservation, or both."
      });
    }
    if (Buffer.byteLength(value.bodyText, "utf8") > AGENT_MESSAGE_MAX_TEXT_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bodyText"],
        message: `Message text may not exceed ${AGENT_MESSAGE_MAX_TEXT_BYTES} UTF-8 bytes.`
      });
    }
  });

export const listAgentMessagesQuerySchema = z
  .object({
    box: z.enum(["inbox", "outbox"]).default("outbox"),
    status: agentMessageStatusSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    offset: z.coerce.number().int().min(0).default(0)
  })
  .strict();

export const markAgentMessageReadSchema = z
  .object({
    operationKey: operationKeySchema,
    expectedInboxEventSequence: z.number().int().min(1)
  })
  .strict();

export const claimAgentMessageSchema = z
  .object({
    operationKey: operationKeySchema,
    leaseSecret: leaseSecretSchema,
    leaseSeconds: z
      .number()
      .int()
      .min(AGENT_MESSAGE_MIN_LEASE_SECONDS)
      .max(AGENT_MESSAGE_MAX_LEASE_SECONDS)
      .default(AGENT_MESSAGE_DEFAULT_LEASE_SECONDS)
  })
  .strict();

export const leasedOperationBaseSchema = z.object({
  operationKey: operationKeySchema,
  leaseSecret: leaseSecretSchema,
  claimGeneration: z.number().int().min(1)
});

export const renewAgentMessageLeaseSchema = leasedOperationBaseSchema
  .extend({
    leaseSeconds: z
      .number()
      .int()
      .min(AGENT_MESSAGE_MIN_LEASE_SECONDS)
      .max(AGENT_MESSAGE_MAX_LEASE_SECONDS)
      .default(AGENT_MESSAGE_DEFAULT_LEASE_SECONDS)
  })
  .strict();

export const progressAgentMessageSchema = leasedOperationBaseSchema
  .extend({
    progressSummary: z.string().trim().min(1).max(10_000)
  })
  .strict();

export const acknowledgeAgentMessageSchema = leasedOperationBaseSchema.strict();

export const handleAgentMessageSchema = leasedOperationBaseSchema
  .extend({
    receiptKey: operationKeySchema,
    resultMarkdown: z.string().max(100_000).default(""),
    transcriptText: z.string().max(100_000).default(""),
    transcriptProvider: z.string().trim().max(200).default(""),
    transcriptDisclosure: z.string().trim().max(2_000).default("")
  })
  .strict();

export const failAgentMessageSchema = leasedOperationBaseSchema
  .extend({
    receiptKey: operationKeySchema,
    failureCode: z.string().trim().min(1).max(200),
    failureMessage: z.string().trim().min(1).max(4_000)
  })
  .strict();

export const forwardAgentMessageSchema = leasedOperationBaseSchema
  .extend({
    receiptKey: operationKeySchema,
    recipientAgentId: z.string().trim().min(1).max(200),
    progressSummary: z.string().trim().max(10_000).default("")
  })
  .strict();

export const reassignAgentMessageSchema = z
  .object({
    operationKey: operationKeySchema,
    expectedRevision: z.number().int().min(1),
    recipientAgentId: z.string().trim().min(1).max(200),
    revokeActiveLease: z.boolean().default(false),
    reason: z.string().trim().min(1).max(1_000)
  })
  .strict();

export const retryAgentMessageSchema = z
  .object({
    operationKey: operationKeySchema,
    recipientAgentId: z.string().trim().min(1).max(200).optional()
  })
  .strict();

export const deleteAgentMessageSchema = z
  .object({
    reason: z.string().trim().min(1).max(1_000)
  })
  .strict();

export const agentMessageSettingsPatchSchema = z
  .object({
    defaultAgentId: z.string().trim().min(1).max(200)
  })
  .strict();

export type AgentMessageStatus = z.infer<typeof agentMessageStatusSchema>;
export type AgentMessageEventKind = z.infer<typeof agentMessageEventKindSchema>;
