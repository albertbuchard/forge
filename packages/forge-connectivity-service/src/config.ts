import path from "node:path";

import { z } from "zod";

const ENV_PREFIX = "FORGE_CONNECTIVITY_";
const MAX_REQUEST_BODY_LIMIT_BYTES = 8_388_608;
const MAX_STORAGE_BYTES = 1_099_511_627_776;
const DEFAULT_GLOBAL_BURST_REQUESTS = 100;
const DEFAULT_CHANNEL_BURST_REQUESTS = 30;
const DEFAULT_CURSOR_PAGE_SIZE = 50;

const environmentSchema = z
  .object({
    FORGE_CONNECTIVITY_HOST: z.string().min(1).default("127.0.0.1"),
    FORGE_CONNECTIVITY_PORT: z.coerce
      .number()
      .int()
      .min(1)
      .max(65_535)
      .default(8_787),
    FORGE_CONNECTIVITY_DATABASE_PATH: z
      .string()
      .min(1)
      .default(path.resolve(process.cwd(), "data/connectivity.sqlite")),
    FORGE_CONNECTIVITY_REQUEST_BODY_LIMIT_BYTES: z.coerce
      .number()
      .int()
      .min(65_536)
      .max(MAX_REQUEST_BODY_LIMIT_BYTES)
      .default(400_000),
    FORGE_CONNECTIVITY_BUSY_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(60_000)
      .default(5_000),
    FORGE_CONNECTIVITY_CLEANUP_INTERVAL_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(3_600)
      .default(60),
    FORGE_CONNECTIVITY_CLEANUP_BATCH_SIZE: z.coerce
      .number()
      .int()
      .min(10)
      .max(100_000)
      .default(1_000),
    FORGE_CONNECTIVITY_SHUTDOWN_TIMEOUT_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(120)
      .default(10),
    FORGE_CONNECTIVITY_CLOCK_SKEW_SECONDS: z.coerce
      .number()
      .int()
      .min(5)
      .max(900)
      .default(300),
    FORGE_CONNECTIVITY_NONCE_RETENTION_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(86_400)
      .default(600),
    FORGE_CONNECTIVITY_IDEMPOTENCY_RETENTION_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(604_800)
      .default(86_400),
    FORGE_CONNECTIVITY_REPLAY_RETENTION_SECONDS: z.coerce
      .number()
      .int()
      .min(3_600)
      .max(2_592_000)
      .default(604_800),
    FORGE_CONNECTIVITY_MAX_PRESENCE_BYTES: z.coerce
      .number()
      .int()
      .min(32)
      .max(1_048_576)
      .default(16_384),
    FORGE_CONNECTIVITY_MAX_ENVELOPE_BYTES: z.coerce
      .number()
      .int()
      .min(32)
      .max(4_194_304)
      .default(262_144),
    FORGE_CONNECTIVITY_MAX_KEY_PACKAGE_BYTES: z.coerce
      .number()
      .int()
      .min(32)
      .max(1_048_576)
      .default(65_536),
    FORGE_CONNECTIVITY_DEFAULT_PRESENCE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(30)
      .default(300),
    FORGE_CONNECTIVITY_MAX_PRESENCE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(30)
      .max(86_400)
      .default(900),
    FORGE_CONNECTIVITY_DEFAULT_ENVELOPE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .default(86_400),
    FORGE_CONNECTIVITY_MAX_ENVELOPE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(2_592_000)
      .default(604_800),
    FORGE_CONNECTIVITY_DEFAULT_KEY_PACKAGE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .default(86_400),
    FORGE_CONNECTIVITY_MAX_KEY_PACKAGE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(2_592_000)
      .default(604_800),
    FORGE_CONNECTIVITY_MAX_CHANNEL_ENVELOPE_COUNT: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000_000)
      .default(1_000),
    FORGE_CONNECTIVITY_MAX_CHANNEL_RETAINED_ENVELOPE_COUNT: z.coerce
      .number()
      .int()
      .min(1)
      .max(10_000_000)
      .default(100_000),
    FORGE_CONNECTIVITY_MAX_CHANNEL_ENVELOPE_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(MAX_STORAGE_BYTES)
      .default(67_108_864),
    FORGE_CONNECTIVITY_MAX_CHANNEL_KEY_PACKAGE_COUNT: z.coerce
      .number()
      .int()
      .min(1)
      .max(10_000)
      .default(64),
    FORGE_CONNECTIVITY_MAX_CHANNEL_KEY_PACKAGE_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(MAX_STORAGE_BYTES)
      .default(4_194_304),
    FORGE_CONNECTIVITY_MAX_GLOBAL_PRESENCE_COUNT: z.coerce
      .number()
      .int()
      .min(1)
      .max(10_000_000)
      .default(100_000),
    FORGE_CONNECTIVITY_MAX_GLOBAL_KEY_PACKAGE_COUNT: z.coerce
      .number()
      .int()
      .min(1)
      .max(50_000_000)
      .default(500_000),
    FORGE_CONNECTIVITY_MAX_GLOBAL_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(MAX_STORAGE_BYTES)
      .default(1_073_741_824),
    FORGE_CONNECTIVITY_MAX_GLOBAL_RETAINED_ENVELOPE_COUNT: z.coerce
      .number()
      .int()
      .min(1)
      .max(100_000_000)
      .default(2_000_000),
    FORGE_CONNECTIVITY_MAX_CHANNEL_IDEMPOTENCY_RECORDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(10_000_000)
      .default(100_000),
    FORGE_CONNECTIVITY_MAX_GLOBAL_IDEMPOTENCY_RECORDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(100_000_000)
      .default(2_000_000),
    FORGE_CONNECTIVITY_MAX_CHANNEL_NONCE_RECORDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000_000)
      .default(10_000),
    FORGE_CONNECTIVITY_MAX_GLOBAL_NONCE_RECORDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(10_000_000)
      .default(100_000),
    FORGE_CONNECTIVITY_GLOBAL_REQUESTS_PER_MINUTE: z.coerce
      .number()
      .int()
      .min(1)
      .max(10_000_000)
      .default(6_000),
    FORGE_CONNECTIVITY_GLOBAL_BURST_REQUESTS: z.coerce
      .number()
      .int()
      .min(1)
      .max(100_000)
      .optional(),
    FORGE_CONNECTIVITY_CHANNEL_REQUESTS_PER_MINUTE: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000_000)
      .default(600),
    FORGE_CONNECTIVITY_CHANNEL_BURST_REQUESTS: z.coerce
      .number()
      .int()
      .min(1)
      .max(10_000)
      .optional(),
    FORGE_CONNECTIVITY_RATE_LIMIT_TRACKED_CHANNELS: z.coerce
      .number()
      .int()
      .min(100)
      .max(1_000_000)
      .default(10_000),
    FORGE_CONNECTIVITY_MAX_CURSOR_PAGE_SIZE: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000)
      .default(100),
    FORGE_CONNECTIVITY_MAX_LONG_POLL_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(60)
      .default(25),
    FORGE_CONNECTIVITY_MAX_GLOBAL_LONG_POLLS: z.coerce
      .number()
      .int()
      .min(1)
      .max(100_000)
      .default(256),
    FORGE_CONNECTIVITY_MAX_CHANNEL_LONG_POLLS: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(2),
    FORGE_CONNECTIVITY_LOG_LEVEL: z
      .enum(["silent", "info", "warn", "error"])
      .default("info")
  })
  .strict()
  .superRefine((value, context) => {
    const maximumCiphertextBytes = Math.max(
      value.FORGE_CONNECTIVITY_MAX_ENVELOPE_BYTES,
      value.FORGE_CONNECTIVITY_MAX_KEY_PACKAGE_BYTES,
      value.FORGE_CONNECTIVITY_MAX_PRESENCE_BYTES
    );
    const encodedEnvelopeLength =
      Math.ceil((maximumCiphertextBytes * 4) / 3) + 4_096;
    if (
      value.FORGE_CONNECTIVITY_REQUEST_BODY_LIMIT_BYTES < encodedEnvelopeLength
    ) {
      context.addIssue({
        code: "custom",
        path: ["FORGE_CONNECTIVITY_REQUEST_BODY_LIMIT_BYTES"],
        message: "must fit one base64url-encoded maximum-size ciphertext"
      });
    }

    const ttlPairs: [number, number][] = [
      [
        value.FORGE_CONNECTIVITY_DEFAULT_PRESENCE_TTL_SECONDS,
        value.FORGE_CONNECTIVITY_MAX_PRESENCE_TTL_SECONDS
      ],
      [
        value.FORGE_CONNECTIVITY_DEFAULT_ENVELOPE_TTL_SECONDS,
        value.FORGE_CONNECTIVITY_MAX_ENVELOPE_TTL_SECONDS
      ],
      [
        value.FORGE_CONNECTIVITY_DEFAULT_KEY_PACKAGE_TTL_SECONDS,
        value.FORGE_CONNECTIVITY_MAX_KEY_PACKAGE_TTL_SECONDS
      ]
    ];
    if (ttlPairs.some(([defaultTtl, maximumTtl]) => defaultTtl > maximumTtl)) {
      context.addIssue({
        code: "custom",
        message: "default TTL values must not exceed their maximums"
      });
    }

    if (
      value.FORGE_CONNECTIVITY_NONCE_RETENTION_SECONDS <
      value.FORGE_CONNECTIVITY_CLOCK_SKEW_SECONDS * 2
    ) {
      context.addIssue({
        code: "custom",
        path: ["FORGE_CONNECTIVITY_NONCE_RETENTION_SECONDS"],
        message:
          "must cover both sides of the accepted request clock-skew window"
      });
    }

    if (
      value.FORGE_CONNECTIVITY_MAX_GLOBAL_BYTES <
      value.FORGE_CONNECTIVITY_MAX_CHANNEL_ENVELOPE_BYTES
    ) {
      context.addIssue({
        code: "custom",
        path: ["FORGE_CONNECTIVITY_MAX_GLOBAL_BYTES"],
        message: "must be at least the per-channel envelope byte quota"
      });
    }
    if (
      value.FORGE_CONNECTIVITY_MAX_CHANNEL_ENVELOPE_BYTES <
      value.FORGE_CONNECTIVITY_MAX_ENVELOPE_BYTES
    ) {
      context.addIssue({
        code: "custom",
        path: ["FORGE_CONNECTIVITY_MAX_CHANNEL_ENVELOPE_BYTES"],
        message: "must fit one maximum-size envelope"
      });
    }
    if (
      value.FORGE_CONNECTIVITY_MAX_CHANNEL_RETAINED_ENVELOPE_COUNT <
      value.FORGE_CONNECTIVITY_MAX_CHANNEL_ENVELOPE_COUNT
    ) {
      context.addIssue({
        code: "custom",
        path: ["FORGE_CONNECTIVITY_MAX_CHANNEL_RETAINED_ENVELOPE_COUNT"],
        message: "must be at least the pending-envelope count quota"
      });
    }
    if (
      value.FORGE_CONNECTIVITY_MAX_CHANNEL_KEY_PACKAGE_BYTES <
      value.FORGE_CONNECTIVITY_MAX_KEY_PACKAGE_BYTES
    ) {
      context.addIssue({
        code: "custom",
        path: ["FORGE_CONNECTIVITY_MAX_CHANNEL_KEY_PACKAGE_BYTES"],
        message: "must fit one maximum-size key package"
      });
    }
    if (
      value.FORGE_CONNECTIVITY_MAX_GLOBAL_BYTES <
      value.FORGE_CONNECTIVITY_MAX_CHANNEL_KEY_PACKAGE_BYTES
    ) {
      context.addIssue({
        code: "custom",
        path: ["FORGE_CONNECTIVITY_MAX_GLOBAL_BYTES"],
        message: "must be at least the per-channel key-package byte quota"
      });
    }
    if (
      value.FORGE_CONNECTIVITY_MAX_GLOBAL_BYTES <
      value.FORGE_CONNECTIVITY_MAX_PRESENCE_BYTES
    ) {
      context.addIssue({
        code: "custom",
        path: ["FORGE_CONNECTIVITY_MAX_GLOBAL_BYTES"],
        message: "must fit one maximum-size presence descriptor"
      });
    }
    if (
      value.FORGE_CONNECTIVITY_MAX_GLOBAL_RETAINED_ENVELOPE_COUNT <
      value.FORGE_CONNECTIVITY_MAX_CHANNEL_RETAINED_ENVELOPE_COUNT
    ) {
      context.addIssue({
        code: "custom",
        path: ["FORGE_CONNECTIVITY_MAX_GLOBAL_RETAINED_ENVELOPE_COUNT"],
        message: "must be at least the per-channel retained-envelope quota"
      });
    }
    if (
      value.FORGE_CONNECTIVITY_MAX_GLOBAL_IDEMPOTENCY_RECORDS <
      value.FORGE_CONNECTIVITY_MAX_CHANNEL_IDEMPOTENCY_RECORDS
    ) {
      context.addIssue({
        code: "custom",
        path: ["FORGE_CONNECTIVITY_MAX_GLOBAL_IDEMPOTENCY_RECORDS"],
        message: "must be at least the per-channel idempotency-record quota"
      });
    }
    if (
      value.FORGE_CONNECTIVITY_MAX_GLOBAL_KEY_PACKAGE_COUNT <
      value.FORGE_CONNECTIVITY_MAX_CHANNEL_KEY_PACKAGE_COUNT
    ) {
      context.addIssue({
        code: "custom",
        path: ["FORGE_CONNECTIVITY_MAX_GLOBAL_KEY_PACKAGE_COUNT"],
        message: "must be at least the per-channel key-package count quota"
      });
    }
    if (
      value.FORGE_CONNECTIVITY_MAX_GLOBAL_NONCE_RECORDS <
      value.FORGE_CONNECTIVITY_MAX_CHANNEL_NONCE_RECORDS
    ) {
      context.addIssue({
        code: "custom",
        path: ["FORGE_CONNECTIVITY_MAX_GLOBAL_NONCE_RECORDS"],
        message: "must be at least the per-channel nonce-record quota"
      });
    }
    if (
      value.FORGE_CONNECTIVITY_GLOBAL_BURST_REQUESTS !== undefined &&
      value.FORGE_CONNECTIVITY_GLOBAL_BURST_REQUESTS >
        value.FORGE_CONNECTIVITY_GLOBAL_REQUESTS_PER_MINUTE
    ) {
      context.addIssue({
        code: "custom",
        path: ["FORGE_CONNECTIVITY_GLOBAL_BURST_REQUESTS"],
        message: "must not exceed the global requests-per-minute limit"
      });
    }
    if (
      value.FORGE_CONNECTIVITY_CHANNEL_BURST_REQUESTS !== undefined &&
      value.FORGE_CONNECTIVITY_CHANNEL_BURST_REQUESTS >
        value.FORGE_CONNECTIVITY_CHANNEL_REQUESTS_PER_MINUTE
    ) {
      context.addIssue({
        code: "custom",
        path: ["FORGE_CONNECTIVITY_CHANNEL_BURST_REQUESTS"],
        message: "must not exceed the channel requests-per-minute limit"
      });
    }
  });

export interface ConnectivityConfig {
  auth: {
    clockSkewMs: number;
    nonceRetentionMs: number;
  };
  limits: {
    defaultEnvelopeTtlMs: number;
    defaultKeyPackageTtlMs: number;
    defaultPresenceTtlMs: number;
    idempotencyRetentionMs: number;
    maxChannelEnvelopeBytes: number;
    maxChannelEnvelopeCount: number;
    maxChannelIdempotencyRecords: number;
    maxChannelKeyPackageBytes: number;
    maxChannelKeyPackageCount: number;
    maxChannelNonceRecords: number;
    maxChannelRetainedEnvelopeCount: number;
    maxEnvelopeBytes: number;
    maxGlobalBytes: number;
    maxGlobalIdempotencyRecords: number;
    maxGlobalKeyPackageCount: number;
    maxGlobalNonceRecords: number;
    maxGlobalPresenceCount: number;
    maxGlobalRetainedEnvelopeCount: number;
    maxKeyPackageBytes: number;
    maxPresenceBytes: number;
    maxEnvelopeTtlMs: number;
    maxKeyPackageTtlMs: number;
    maxPresenceTtlMs: number;
    replayRetentionMs: number;
  };
  logging: {
    level: "silent" | "info" | "warn" | "error";
  };
  polling: {
    defaultPageSize: number;
    maxChannelConcurrent: number;
    maxGlobalConcurrent: number;
    maxPageSize: number;
    maxWaitMs: number;
  };
  rateLimit: {
    channelBurstRequests: number;
    channelRequestsPerMinute: number;
    globalBurstRequests: number;
    globalRequestsPerMinute: number;
    trackedChannels: number;
  };
  server: {
    host: string;
    port: number;
    requestBodyLimitBytes: number;
    shutdownTimeoutMs: number;
  };
  storage: {
    busyTimeoutMs: number;
    cleanupBatchSize: number;
    cleanupIntervalMs: number;
    databasePath: string;
  };
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env
): ConnectivityConfig {
  const prefixedEntries = Object.entries(environment).filter(([key]) =>
    key.startsWith(ENV_PREFIX)
  );
  const parsed = environmentSchema.parse(Object.fromEntries(prefixedEntries));

  return {
    auth: {
      clockSkewMs: parsed.FORGE_CONNECTIVITY_CLOCK_SKEW_SECONDS * 1_000,
      nonceRetentionMs:
        parsed.FORGE_CONNECTIVITY_NONCE_RETENTION_SECONDS * 1_000
    },
    limits: {
      defaultEnvelopeTtlMs:
        parsed.FORGE_CONNECTIVITY_DEFAULT_ENVELOPE_TTL_SECONDS * 1_000,
      defaultKeyPackageTtlMs:
        parsed.FORGE_CONNECTIVITY_DEFAULT_KEY_PACKAGE_TTL_SECONDS * 1_000,
      defaultPresenceTtlMs:
        parsed.FORGE_CONNECTIVITY_DEFAULT_PRESENCE_TTL_SECONDS * 1_000,
      idempotencyRetentionMs:
        parsed.FORGE_CONNECTIVITY_IDEMPOTENCY_RETENTION_SECONDS * 1_000,
      maxChannelEnvelopeBytes:
        parsed.FORGE_CONNECTIVITY_MAX_CHANNEL_ENVELOPE_BYTES,
      maxChannelEnvelopeCount:
        parsed.FORGE_CONNECTIVITY_MAX_CHANNEL_ENVELOPE_COUNT,
      maxChannelIdempotencyRecords:
        parsed.FORGE_CONNECTIVITY_MAX_CHANNEL_IDEMPOTENCY_RECORDS,
      maxChannelKeyPackageBytes:
        parsed.FORGE_CONNECTIVITY_MAX_CHANNEL_KEY_PACKAGE_BYTES,
      maxChannelKeyPackageCount:
        parsed.FORGE_CONNECTIVITY_MAX_CHANNEL_KEY_PACKAGE_COUNT,
      maxChannelNonceRecords:
        parsed.FORGE_CONNECTIVITY_MAX_CHANNEL_NONCE_RECORDS,
      maxChannelRetainedEnvelopeCount:
        parsed.FORGE_CONNECTIVITY_MAX_CHANNEL_RETAINED_ENVELOPE_COUNT,
      maxEnvelopeBytes: parsed.FORGE_CONNECTIVITY_MAX_ENVELOPE_BYTES,
      maxEnvelopeTtlMs:
        parsed.FORGE_CONNECTIVITY_MAX_ENVELOPE_TTL_SECONDS * 1_000,
      maxGlobalBytes: parsed.FORGE_CONNECTIVITY_MAX_GLOBAL_BYTES,
      maxGlobalIdempotencyRecords:
        parsed.FORGE_CONNECTIVITY_MAX_GLOBAL_IDEMPOTENCY_RECORDS,
      maxGlobalKeyPackageCount:
        parsed.FORGE_CONNECTIVITY_MAX_GLOBAL_KEY_PACKAGE_COUNT,
      maxGlobalNonceRecords: parsed.FORGE_CONNECTIVITY_MAX_GLOBAL_NONCE_RECORDS,
      maxGlobalPresenceCount:
        parsed.FORGE_CONNECTIVITY_MAX_GLOBAL_PRESENCE_COUNT,
      maxGlobalRetainedEnvelopeCount:
        parsed.FORGE_CONNECTIVITY_MAX_GLOBAL_RETAINED_ENVELOPE_COUNT,
      maxKeyPackageBytes: parsed.FORGE_CONNECTIVITY_MAX_KEY_PACKAGE_BYTES,
      maxKeyPackageTtlMs:
        parsed.FORGE_CONNECTIVITY_MAX_KEY_PACKAGE_TTL_SECONDS * 1_000,
      maxPresenceBytes: parsed.FORGE_CONNECTIVITY_MAX_PRESENCE_BYTES,
      maxPresenceTtlMs:
        parsed.FORGE_CONNECTIVITY_MAX_PRESENCE_TTL_SECONDS * 1_000,
      replayRetentionMs:
        parsed.FORGE_CONNECTIVITY_REPLAY_RETENTION_SECONDS * 1_000
    },
    logging: {
      level: parsed.FORGE_CONNECTIVITY_LOG_LEVEL
    },
    polling: {
      defaultPageSize: Math.min(
        DEFAULT_CURSOR_PAGE_SIZE,
        parsed.FORGE_CONNECTIVITY_MAX_CURSOR_PAGE_SIZE
      ),
      maxChannelConcurrent: parsed.FORGE_CONNECTIVITY_MAX_CHANNEL_LONG_POLLS,
      maxGlobalConcurrent: parsed.FORGE_CONNECTIVITY_MAX_GLOBAL_LONG_POLLS,
      maxPageSize: parsed.FORGE_CONNECTIVITY_MAX_CURSOR_PAGE_SIZE,
      maxWaitMs: parsed.FORGE_CONNECTIVITY_MAX_LONG_POLL_SECONDS * 1_000
    },
    rateLimit: {
      channelBurstRequests:
        parsed.FORGE_CONNECTIVITY_CHANNEL_BURST_REQUESTS ??
        Math.min(
          parsed.FORGE_CONNECTIVITY_CHANNEL_REQUESTS_PER_MINUTE,
          DEFAULT_CHANNEL_BURST_REQUESTS
        ),
      channelRequestsPerMinute:
        parsed.FORGE_CONNECTIVITY_CHANNEL_REQUESTS_PER_MINUTE,
      globalBurstRequests:
        parsed.FORGE_CONNECTIVITY_GLOBAL_BURST_REQUESTS ??
        Math.min(
          parsed.FORGE_CONNECTIVITY_GLOBAL_REQUESTS_PER_MINUTE,
          DEFAULT_GLOBAL_BURST_REQUESTS
        ),
      globalRequestsPerMinute:
        parsed.FORGE_CONNECTIVITY_GLOBAL_REQUESTS_PER_MINUTE,
      trackedChannels: parsed.FORGE_CONNECTIVITY_RATE_LIMIT_TRACKED_CHANNELS
    },
    server: {
      host: parsed.FORGE_CONNECTIVITY_HOST,
      port: parsed.FORGE_CONNECTIVITY_PORT,
      requestBodyLimitBytes: parsed.FORGE_CONNECTIVITY_REQUEST_BODY_LIMIT_BYTES,
      shutdownTimeoutMs:
        parsed.FORGE_CONNECTIVITY_SHUTDOWN_TIMEOUT_SECONDS * 1_000
    },
    storage: {
      busyTimeoutMs: parsed.FORGE_CONNECTIVITY_BUSY_TIMEOUT_MS,
      cleanupBatchSize: parsed.FORGE_CONNECTIVITY_CLEANUP_BATCH_SIZE,
      cleanupIntervalMs:
        parsed.FORGE_CONNECTIVITY_CLEANUP_INTERVAL_SECONDS * 1_000,
      databasePath: parsed.FORGE_CONNECTIVITY_DATABASE_PATH
    }
  };
}
