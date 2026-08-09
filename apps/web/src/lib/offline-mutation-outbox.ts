import type { MutationReceipt } from "@/lib/mutation-receipts";
import type {
  OfflineTaskMutationReceipt,
  OfflineTaskStatus,
  TaskStatus
} from "@/lib/types";

export const OFFLINE_MUTATION_OUTBOX_VERSION = 1 as const;
export const OFFLINE_MUTATION_OUTBOX_MAX_ENTRIES = 500;
export const OFFLINE_MUTATION_OUTBOX_MAX_BYTES = 5 * 1024 * 1024;

const DATABASE_NAME = "forge-offline-mutations";
const DATABASE_VERSION = 1;
const STORE_NAME = "task-status-mutations";
const FORBIDDEN_PERSISTED_KEYS = new Set([
  "authentication",
  "authorization",
  "cookie",
  "credential",
  "csrftoken",
  "password",
  "secret",
  "token"
]);
const OUTBOX_ENTRY_KEYS = new Set([
  "id",
  "version",
  "sessionId",
  "idempotencyKey",
  "action",
  "taskId",
  "taskLabel",
  "expectedUpdatedAt",
  "desiredStatus",
  "state",
  "summary",
  "current",
  "mutationReceipt",
  "replayed",
  "attemptCount",
  "lastAttemptAt",
  "createdAt",
  "updatedAt"
]);
const CURRENT_TASK_KEYS = new Set(["status", "updatedAt"]);
const MUTATION_RECEIPT_KEYS = new Set([
  "id",
  "operation",
  "targetType",
  "targetId",
  "targetLabel",
  "ownerUserId",
  "summary",
  "status",
  "reversible",
  "explanation",
  "expiresAt",
  "createdAt",
  "undoneAt"
]);

export type OfflineMutationOutboxState =
  | "queued"
  | "sending"
  | "accepted"
  | "conflicted"
  | "needs_decision"
  | "rejected";

export interface OfflineMutationOutboxEntry {
  id: string;
  version: 1;
  sessionId: string;
  idempotencyKey: string;
  action: "task_status";
  taskId: string;
  taskLabel: string;
  expectedUpdatedAt: string;
  desiredStatus: OfflineTaskStatus;
  state: OfflineMutationOutboxState;
  summary: string;
  current: {
    status: TaskStatus;
    updatedAt: string;
  } | null;
  mutationReceipt: MutationReceipt | null;
  replayed: boolean;
  attemptCount: number;
  lastAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OfflineMutationOutboxStore {
  list(): Promise<OfflineMutationOutboxEntry[]>;
  save(
    entry: OfflineMutationOutboxEntry,
    options?: { replaceId?: string }
  ): Promise<void>;
  delete(id: string): Promise<void>;
  clearSettled(): Promise<void>;
  takeRepairNotice?(): string | null;
}

export type OfflineMutationOutboxErrorCode =
  | "offline_outbox_unavailable"
  | "offline_outbox_full"
  | "offline_task_already_queued";

export class OfflineMutationOutboxError extends Error {
  readonly code: OfflineMutationOutboxErrorCode;

  constructor(code: OfflineMutationOutboxErrorCode, message: string) {
    super(message);
    this.name = "OfflineMutationOutboxError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return ["backlog", "focus", "in_progress", "blocked", "done"].includes(
    String(value)
  );
}

function isOfflineTaskStatus(value: unknown): value is OfflineTaskStatus {
  return ["backlog", "focus", "in_progress", "blocked"].includes(String(value));
}

function isOutboxState(value: unknown): value is OfflineMutationOutboxState {
  return [
    "queued",
    "sending",
    "accepted",
    "conflicted",
    "needs_decision",
    "rejected"
  ].includes(String(value));
}

function containsForbiddenPersistedKey(
  value: unknown,
  seen = new WeakSet<object>()
): boolean {
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((entry) => containsForbiddenPersistedKey(entry, seen));
  }
  if (!isRecord(value)) {
    return false;
  }
  return Object.entries(value).some(([key, nested]) => {
    const normalizedKey = key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
    return (
      FORBIDDEN_PERSISTED_KEYS.has(normalizedKey) ||
      normalizedKey.endsWith("token") ||
      normalizedKey.includes("password") ||
      normalizedKey.includes("secret") ||
      containsForbiddenPersistedKey(nested, seen)
    );
  });
}

function isMutationReceiptOperation(
  value: unknown
): value is MutationReceipt["operation"] {
  return [
    "entity_update",
    "entity_soft_delete",
    "entity_hard_delete",
    "task_update",
    "attention_state"
  ].includes(String(value));
}

function isMutationReceiptStatus(
  value: unknown
): value is MutationReceipt["status"] {
  return [
    "available",
    "undone",
    "expired",
    "conflicted",
    "not_reversible"
  ].includes(String(value));
}

function sanitizeMutationReceipt(value: unknown): MutationReceipt | null {
  if (!isRecord(value) || !hasOnlyKeys(value, MUTATION_RECEIPT_KEYS)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    !isMutationReceiptOperation(value.operation) ||
    typeof value.targetType !== "string" ||
    typeof value.targetId !== "string" ||
    typeof value.targetLabel !== "string" ||
    (value.ownerUserId !== null && typeof value.ownerUserId !== "string") ||
    typeof value.summary !== "string" ||
    !isMutationReceiptStatus(value.status) ||
    typeof value.reversible !== "boolean" ||
    typeof value.explanation !== "string" ||
    (value.expiresAt !== null && typeof value.expiresAt !== "string") ||
    typeof value.createdAt !== "string" ||
    (value.undoneAt !== null && typeof value.undoneAt !== "string")
  ) {
    return null;
  }
  return {
    id: value.id,
    operation: value.operation,
    targetType: value.targetType,
    targetId: value.targetId,
    targetLabel: value.targetLabel,
    ownerUserId: value.ownerUserId,
    summary: value.summary,
    status: value.status,
    reversible: value.reversible,
    explanation: value.explanation,
    expiresAt: value.expiresAt,
    createdAt: value.createdAt,
    undoneAt: value.undoneAt
  };
}

function sanitizeCurrent(
  value: unknown
): OfflineMutationOutboxEntry["current"] {
  if (!isRecord(value) || !hasOnlyKeys(value, CURRENT_TASK_KEYS)) return null;
  if (!isTaskStatus(value.status) || typeof value.updatedAt !== "string") {
    return null;
  }
  return { status: value.status, updatedAt: value.updatedAt };
}

export function sanitizeOfflineMutationOutboxEntry(
  value: unknown
): OfflineMutationOutboxEntry | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, OUTBOX_ENTRY_KEYS) ||
    containsForbiddenPersistedKey(value)
  ) {
    return null;
  }
  const current = sanitizeCurrent(value.current);
  const mutationReceipt = sanitizeMutationReceipt(value.mutationReceipt);
  if (
    value.version !== OFFLINE_MUTATION_OUTBOX_VERSION ||
    value.action !== "task_status" ||
    typeof value.id !== "string" ||
    typeof value.sessionId !== "string" ||
    typeof value.idempotencyKey !== "string" ||
    typeof value.taskId !== "string" ||
    typeof value.taskLabel !== "string" ||
    typeof value.expectedUpdatedAt !== "string" ||
    !isOfflineTaskStatus(value.desiredStatus) ||
    !isOutboxState(value.state) ||
    typeof value.summary !== "string" ||
    (value.current !== null && !current) ||
    (value.mutationReceipt !== null && !mutationReceipt) ||
    typeof value.replayed !== "boolean" ||
    typeof value.attemptCount !== "number" ||
    !Number.isSafeInteger(value.attemptCount) ||
    value.attemptCount < 0 ||
    (value.lastAttemptAt !== null && typeof value.lastAttemptAt !== "string") ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    version: 1,
    sessionId: value.sessionId,
    idempotencyKey: value.idempotencyKey,
    action: "task_status",
    taskId: value.taskId,
    taskLabel: value.taskLabel,
    expectedUpdatedAt: value.expectedUpdatedAt,
    desiredStatus: value.desiredStatus,
    state: value.state,
    summary: value.summary,
    current,
    mutationReceipt,
    replayed: value.replayed,
    attemptCount: value.attemptCount,
    lastAttemptAt: value.lastAttemptAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  };
}

export function isUnresolvedOfflineMutation(entry: OfflineMutationOutboxEntry) {
  return ["queued", "sending", "conflicted", "needs_decision"].includes(
    entry.state
  );
}

export function offlineMutationOutboxBytes(
  entries: OfflineMutationOutboxEntry[]
) {
  return new TextEncoder().encode(JSON.stringify(entries)).byteLength;
}

function assertOutboxWrite(
  entries: OfflineMutationOutboxEntry[],
  entry: OfflineMutationOutboxEntry,
  replaceId?: string
) {
  if (containsForbiddenPersistedKey(entry)) {
    throw new OfflineMutationOutboxError(
      "offline_outbox_unavailable",
      "Forge refused to store private authentication data in the offline queue."
    );
  }
  const retained = entries.filter(
    (candidate) => candidate.id !== entry.id && candidate.id !== replaceId
  );
  if (
    isUnresolvedOfflineMutation(entry) &&
    retained.some(
      (candidate) =>
        candidate.sessionId === entry.sessionId &&
        candidate.taskId === entry.taskId &&
        isUnresolvedOfflineMutation(candidate)
    )
  ) {
    throw new OfflineMutationOutboxError(
      "offline_task_already_queued",
      `Forge already has a pending move for ${entry.taskLabel}. Reconnect or decide what to do with that move first.`
    );
  }
  const next = [...retained, entry];
  if (
    next.length > OFFLINE_MUTATION_OUTBOX_MAX_ENTRIES ||
    offlineMutationOutboxBytes(next) > OFFLINE_MUTATION_OUTBOX_MAX_BYTES
  ) {
    throw new OfflineMutationOutboxError(
      "offline_outbox_full",
      "The offline queue is full. Reconnect or clear accepted and rejected changes before adding another move."
    );
  }
}

function newMutationId(prefix: string) {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random.replaceAll("-", "")}`;
}

export function createOfflineTaskMutationEntry(input: {
  sessionId: string;
  taskId: string;
  taskLabel: string;
  expectedUpdatedAt: string;
  desiredStatus: OfflineTaskStatus;
  now?: Date;
}): OfflineMutationOutboxEntry {
  const now = (input.now ?? new Date()).toISOString();
  return {
    id: newMutationId("omq"),
    version: 1,
    sessionId: input.sessionId,
    idempotencyKey: newMutationId("omid"),
    action: "task_status",
    taskId: input.taskId,
    taskLabel: input.taskLabel.trim().slice(0, 200) || "this task",
    expectedUpdatedAt: input.expectedUpdatedAt,
    desiredStatus: input.desiredStatus,
    state: "queued",
    summary: `Waiting to move ${input.taskLabel.trim().slice(0, 200) || "this task"}.`,
    current: null,
    mutationReceipt: null,
    replayed: false,
    attemptCount: 0,
    lastAttemptAt: null,
    createdAt: now,
    updatedAt: now
  };
}

export function applyOfflineMutationReceipt(
  entry: OfflineMutationOutboxEntry,
  receipt: OfflineTaskMutationReceipt,
  replayed: boolean,
  now = new Date()
): OfflineMutationOutboxEntry {
  return {
    ...entry,
    state: receipt.status,
    summary: receipt.summary,
    current: receipt.current,
    mutationReceipt: receipt.mutationReceipt,
    replayed,
    updatedAt: now.toISOString()
  };
}

function sortedEntries(entries: OfflineMutationOutboxEntry[]) {
  return entries
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export class InMemoryOfflineMutationOutboxStore implements OfflineMutationOutboxStore {
  private entries = new Map<string, OfflineMutationOutboxEntry>();

  constructor(initial: OfflineMutationOutboxEntry[] = []) {
    for (const entry of initial) this.entries.set(entry.id, entry);
  }

  async list() {
    return sortedEntries([...this.entries.values()]);
  }

  async save(
    entry: OfflineMutationOutboxEntry,
    options: { replaceId?: string } = {}
  ) {
    const current = [...this.entries.values()];
    assertOutboxWrite(current, entry, options.replaceId);
    if (options.replaceId) this.entries.delete(options.replaceId);
    this.entries.set(entry.id, entry);
  }

  async delete(id: string) {
    this.entries.delete(id);
  }

  async clearSettled() {
    for (const [id, entry] of this.entries) {
      if (["accepted", "rejected"].includes(entry.state)) {
        this.entries.delete(id);
      }
    }
  }
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

export function normalizeOfflineMutationOutboxStorageError(error: unknown) {
  if (error instanceof OfflineMutationOutboxError) return error;
  return new OfflineMutationOutboxError(
    "offline_outbox_unavailable",
    "This browser could not safely store offline changes. Online task moves still work."
  );
}

export function readAndRepairOfflineMutationRows(
  store: Pick<IDBObjectStore, "openCursor" | "transaction">,
  onComplete?: (result: {
    entries: OfflineMutationOutboxEntry[];
    repairedCount: number;
  }) => void
) {
  return new Promise<{
    entries: OfflineMutationOutboxEntry[];
    repairedCount: number;
  }>((resolve, reject) => {
    const entries: OfflineMutationOutboxEntry[] = [];
    let repairedCount = 0;
    const request = store.openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      try {
        const cursor = request.result;
        if (!cursor) {
          const result = { entries, repairedCount };
          onComplete?.(result);
          resolve(result);
          return;
        }
        const entry = sanitizeOfflineMutationOutboxEntry(cursor.value);
        if (entry) {
          entries.push(entry);
        } else {
          repairedCount += 1;
          cursor.delete();
        }
        cursor.continue();
      } catch (error) {
        try {
          store.transaction.abort();
        } catch {
          // The transaction may already have failed.
        }
        reject(error);
      }
    };
  });
}

async function openOutboxDatabase(indexedDb: IDBFactory) {
  const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME, { keyPath: "id" });
    }
  };
  return requestResult(request);
}

export class BrowserOfflineMutationOutboxStore implements OfflineMutationOutboxStore {
  private databasePromise: Promise<IDBDatabase> | null = null;
  private repairNotice: string | null = null;

  constructor(private readonly indexedDb: IDBFactory | null) {}

  private database() {
    if (!this.indexedDb) {
      throw new OfflineMutationOutboxError(
        "offline_outbox_unavailable",
        "This browser cannot store offline changes. Online task moves still work."
      );
    }
    this.databasePromise ??= openOutboxDatabase(this.indexedDb);
    return this.databasePromise;
  }

  private async runStorageOperation<T>(operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof OfflineMutationOutboxError)) {
        const failedDatabase = this.databasePromise;
        this.databasePromise = null;
        await failedDatabase
          ?.then((database) => database.close())
          .catch(() => undefined);
      }
      throw normalizeOfflineMutationOutboxStorageError(error);
    }
  }

  private noteRepairs(repairedCount: number) {
    if (repairedCount <= 0) return;
    this.repairNotice = `Forge removed ${repairedCount} invalid offline ${repairedCount === 1 ? "record" : "records"} before continuing.`;
  }

  takeRepairNotice() {
    const notice = this.repairNotice;
    this.repairNotice = null;
    return notice;
  }

  async list() {
    return this.runStorageOperation(async () => {
      const database = await this.database();
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const done = transactionDone(transaction);
      const [repair] = await Promise.all([
        readAndRepairOfflineMutationRows(transaction.objectStore(STORE_NAME)),
        done
      ]);
      this.noteRepairs(repair.repairedCount);
      return sortedEntries(repair.entries);
    });
  }

  async save(
    entry: OfflineMutationOutboxEntry,
    options: { replaceId?: string } = {}
  ) {
    await this.runStorageOperation(async () => {
      const database = await this.database();
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const done = transactionDone(transaction);
      try {
        const [repair] = await Promise.all([
          readAndRepairOfflineMutationRows(store, ({ entries }) => {
            assertOutboxWrite(entries, entry, options.replaceId);
            if (options.replaceId) store.delete(options.replaceId);
            store.put(entry);
          }),
          done
        ]);
        this.noteRepairs(repair.repairedCount);
      } catch (error) {
        try {
          transaction.abort();
        } catch {
          // The transaction may already have failed.
        }
        await done.catch(() => undefined);
        throw error;
      }
    });
  }

  async delete(id: string) {
    await this.runStorageOperation(async () => {
      const database = await this.database();
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const done = transactionDone(transaction);
      const request = transaction.objectStore(STORE_NAME).delete(id);
      await Promise.all([requestResult(request), done]);
    });
  }

  async clearSettled() {
    await this.runStorageOperation(async () => {
      const database = await this.database();
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const done = transactionDone(transaction);
      try {
        const [repair] = await Promise.all([
          readAndRepairOfflineMutationRows(store, ({ entries }) => {
            for (const entry of entries) {
              if (["accepted", "rejected"].includes(entry.state)) {
                store.delete(entry.id);
              }
            }
          }),
          done
        ]);
        this.noteRepairs(repair.repairedCount);
      } catch (error) {
        try {
          transaction.abort();
        } catch {
          // The transaction may already have failed.
        }
        await done.catch(() => undefined);
        throw error;
      }
    });
  }
}

export function createBrowserOfflineMutationOutboxStore() {
  return new BrowserOfflineMutationOutboxStore(
    typeof indexedDB === "undefined" ? null : indexedDB
  );
}
