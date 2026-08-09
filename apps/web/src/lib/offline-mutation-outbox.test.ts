import { describe, expect, it } from "vitest";

import {
  InMemoryOfflineMutationOutboxStore,
  OFFLINE_MUTATION_OUTBOX_MAX_BYTES,
  OfflineMutationOutboxError,
  applyOfflineMutationReceipt,
  createOfflineTaskMutationEntry,
  normalizeOfflineMutationOutboxStorageError,
  offlineMutationOutboxBytes,
  readAndRepairOfflineMutationRows,
  sanitizeOfflineMutationOutboxEntry
} from "@/lib/offline-mutation-outbox";

function entry(
  taskId = "task_1",
  sessionId = "session_1",
  date = new Date("2026-08-09T12:00:00.000Z")
) {
  return createOfflineTaskMutationEntry({
    sessionId,
    taskId,
    taskLabel: `Task ${taskId}`,
    expectedUpdatedAt: "2026-08-09T11:59:00.000Z",
    desiredStatus: "focus",
    now: date
  });
}

describe("offline mutation outbox storage", () => {
  it("persists only the allowlisted mutation envelope", () => {
    const queued = entry();
    expect(sanitizeOfflineMutationOutboxEntry(queued)).toEqual(queued);
    expect(
      sanitizeOfflineMutationOutboxEntry({
        ...queued,
        authorization: "Bearer private"
      })
    ).toBeNull();
    expect(
      sanitizeOfflineMutationOutboxEntry({
        ...queued,
        nested: { csrf_token: "private" }
      })
    ).toBeNull();
    expect(
      sanitizeOfflineMutationOutboxEntry({
        ...queued,
        nested: { accessToken: "private" }
      })
    ).toBeNull();
  });

  it("deletes malformed physical rows and reports storage failures consistently", async () => {
    const valid = entry();
    const invalid = { ...entry("task_invalid"), accessToken: "private" };
    const rows = [valid, invalid];
    const deleted: unknown[] = [];
    let request!: IDBRequest<IDBCursorWithValue | null>;
    let index = 0;
    const advance = () => {
      const row = rows[index];
      index += 1;
      (request as { result: IDBCursorWithValue | null }).result = row
        ? ({
            value: row,
            delete: () => {
              deleted.push(row);
              return {} as IDBRequest<undefined>;
            },
            continue: () => queueMicrotask(advance)
          } as IDBCursorWithValue)
        : null;
      request.onsuccess?.(new Event("success"));
    };
    const store = {
      transaction: { abort: () => undefined } as IDBTransaction,
      openCursor: () => {
        request = {
          result: null,
          error: null,
          onsuccess: null,
          onerror: null
        } as unknown as IDBRequest<IDBCursorWithValue | null>;
        queueMicrotask(advance);
        return request;
      }
    };

    await expect(readAndRepairOfflineMutationRows(store)).resolves.toEqual({
      entries: [valid],
      repairedCount: 1
    });
    expect(deleted).toEqual([invalid]);

    for (const name of [
      "QuotaExceededError",
      "InvalidStateError",
      "AbortError",
      "UnknownError"
    ]) {
      expect(
        normalizeOfflineMutationOutboxStorageError(
          new DOMException("IndexedDB failed", name)
        )
      ).toMatchObject({ code: "offline_outbox_unavailable" });
    }
  });

  it("blocks a second unresolved move for the same task", async () => {
    const store = new InMemoryOfflineMutationOutboxStore();
    const first = entry();
    await store.save(first);

    await expect(store.save(entry())).rejects.toMatchObject({
      code: "offline_task_already_queued"
    });

    const replacement = {
      ...entry(),
      desiredStatus: "blocked" as const
    };
    await expect(
      store.save(replacement, { replaceId: first.id })
    ).resolves.toBeUndefined();
    expect(await store.list()).toEqual([replacement]);
  });

  it("fails closed at the five MiB storage boundary", async () => {
    const queued = entry();
    const oversized = {
      ...queued,
      summary: "x".repeat(OFFLINE_MUTATION_OUTBOX_MAX_BYTES)
    };
    expect(offlineMutationOutboxBytes([oversized])).toBeGreaterThan(
      OFFLINE_MUTATION_OUTBOX_MAX_BYTES
    );

    const store = new InMemoryOfflineMutationOutboxStore();
    await expect(store.save(oversized)).rejects.toBeInstanceOf(
      OfflineMutationOutboxError
    );
    await expect(store.save(oversized)).rejects.toMatchObject({
      code: "offline_outbox_full"
    });

    const fullStore = new InMemoryOfflineMutationOutboxStore(
      Array.from({ length: 500 }, (_, index) => entry(`task_${index}`))
    );
    await expect(fullStore.save(entry("task_501"))).rejects.toMatchObject({
      code: "offline_outbox_full"
    });
  });

  it("keeps compact terminal truth and clears only settled entries", async () => {
    const queued = entry();
    const accepted = applyOfflineMutationReceipt(
      queued,
      {
        version: 1,
        idempotencyKey: queued.idempotencyKey,
        action: "task_status",
        status: "accepted",
        summary: "Moved Task task_1 to Focus.",
        task: {
          id: queued.taskId,
          title: queued.taskLabel,
          status: "focus",
          updatedAt: "2026-08-09T12:01:00.000Z"
        },
        current: {
          status: "focus",
          updatedAt: "2026-08-09T12:01:00.000Z"
        },
        mutationReceipt: null,
        receivedAt: "2026-08-09T12:01:00.000Z"
      },
      false,
      new Date("2026-08-09T12:01:00.000Z")
    );
    const conflicted = {
      ...entry("task_2"),
      state: "conflicted" as const,
      summary: "This task changed before the queued move could be applied."
    };
    const store = new InMemoryOfflineMutationOutboxStore([
      accepted,
      conflicted
    ]);

    await store.clearSettled();

    expect(await store.list()).toEqual([conflicted]);
  });
});
