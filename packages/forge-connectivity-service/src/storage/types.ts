export interface StoredHttpResponse<T extends Record<string, unknown>> {
  body: T;
  replayed: boolean;
  statusCode: number;
}

export interface IdempotentMutation {
  channelHash: string;
  expiresAt: number;
  key: string;
  maxChannelRecords: number;
  maxGlobalRecords: number;
  nowMs: number;
  requestDigest: string;
  scope: string;
}

export interface PresenceRecord {
  ciphertext: Buffer;
  expiresAt: number;
  updatedAt: number;
}

export interface EnvelopeRecord {
  ciphertext: Buffer;
  createdAt: number;
  expiresAt: number;
  messageId: string;
  rowId: number;
}

export interface EnvelopePage {
  records: EnvelopeRecord[];
}

export interface KeyPackageRecord {
  ciphertext: Buffer;
  createdAt: number;
  expiresAt: number;
  packageId: string;
  rowId: number;
}

export interface KeyPackagePage {
  records: KeyPackageRecord[];
}

export interface UsageSnapshot {
  channel: {
    envelopeBytes: number;
    envelopeCount: number;
    idempotencyCount: number;
    keyPackageBytes: number;
    keyPackageCount: number;
    nonceCount: number;
    presenceBytes: number;
    retainedEnvelopeCount: number;
  };
  globalBytes: number;
  globalIdempotencyCount: number;
  globalKeyPackageCount: number;
  globalNonceCount: number;
  globalPresenceCount: number;
  globalRetainedEnvelopeCount: number;
}

export interface CleanupResult {
  envelopesExpired: number;
  idempotencyPurged: number;
  keyPackagesExpired: number;
  noncesPurged: number;
  presenceExpired: number;
  tombstonesPurged: number;
}

export interface ConnectivityStore {
  readonly schemaVersion: number;

  ackEnvelopes(
    channelHash: string,
    messageIds: readonly string[],
    nowMs: number,
    replayRetentionMs: number
  ): { acknowledged: number; alreadyFinalized: number; unknown: number };
  checkpoint(): void;
  claimNonce(input: {
    channelHash: string;
    expiresAt: number;
    maxChannelRecords: number;
    maxGlobalRecords: number;
    nonceHash: string;
    nowMs: number;
  }): boolean;
  cleanupExpired(nowMs: number, batchSize: number): CleanupResult;
  close(): void;
  deletePresence(channelHash: string): boolean;
  getPresence(channelHash: string, nowMs: number): PresenceRecord | undefined;
  getUsage(channelHash: string): UsageSnapshot;
  healthCheck(): { ok: boolean; schemaVersion: number };
  listEnvelopes(
    channelHash: string,
    afterRowId: number,
    limit: number,
    nowMs: number
  ): EnvelopePage;
  listKeyPackages(
    channelHash: string,
    afterRowId: number,
    limit: number,
    nowMs: number
  ): KeyPackagePage;
  putEnvelope(input: {
    channelHash: string;
    ciphertext: Buffer;
    contentDigest: string;
    expiresAt: number;
    maxChannelBytes: number;
    maxChannelCount: number;
    maxChannelRetainedCount: number;
    maxGlobalBytes: number;
    maxGlobalRetainedCount: number;
    messageId: string;
    nowMs: number;
    replayRetentionMs: number;
  }): {
    accepted: boolean;
    duplicate: boolean;
    expiresAt: number;
    state: "acked" | "expired" | "pending";
  };
  putKeyPackage(input: {
    channelHash: string;
    ciphertext: Buffer;
    contentDigest: string;
    expiresAt: number;
    maxChannelBytes: number;
    maxChannelCount: number;
    maxGlobalBytes: number;
    maxGlobalCount: number;
    nowMs: number;
    packageId: string;
  }): { created: boolean; duplicate: boolean; expiresAt: number };
  putPresence(input: {
    channelHash: string;
    ciphertext: Buffer;
    contentDigest: string;
    expiresAt: number;
    maxGlobalBytes: number;
    maxGlobalCount: number;
    nowMs: number;
  }): { created: boolean; expiresAt: number };
  runIdempotent<T extends Record<string, unknown>>(
    input: IdempotentMutation,
    operation: () => Omit<StoredHttpResponse<T>, "replayed">
  ): StoredHttpResponse<T>;
}
