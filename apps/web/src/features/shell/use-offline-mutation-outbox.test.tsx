import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  BrowserOfflineMutationOutboxStore,
  InMemoryOfflineMutationOutboxStore,
  createOfflineTaskMutationEntry,
  type OfflineMutationOutboxStore
} from "@/lib/offline-mutation-outbox";
import type {
  OfflineTaskMutationInput,
  OfflineTaskMutationResponse
} from "@/lib/types";
import { useOfflineMutationOutbox } from "@/features/shell/use-offline-mutation-outbox";

function response(
  input: OfflineTaskMutationInput,
  status: "accepted" | "conflicted" | "rejected" = "accepted"
): OfflineTaskMutationResponse {
  const updatedAt = "2026-08-09T12:01:00.000Z";
  return {
    replayed: false,
    receipt: {
      version: 1,
      idempotencyKey: input.idempotencyKey,
      action: "task_status",
      status,
      summary:
        status === "accepted"
          ? "Moved Example task to Focus."
          : status === "conflicted"
            ? "Example task changed before this move could be applied."
            : "Forge could not apply this move.",
      task:
        status === "accepted"
          ? {
              id: input.taskId,
              title: "Example task",
              status: input.status,
              updatedAt
            }
          : null,
      current:
        status === "conflicted"
          ? { status: "blocked", updatedAt }
          : status === "accepted"
            ? { status: input.status, updatedAt }
            : null,
      mutationReceipt: null,
      receivedAt: updatedAt
    }
  };
}

const move = {
  taskId: "task_1",
  taskLabel: "Example task",
  expectedUpdatedAt: "2026-08-09T12:00:00.000Z",
  desiredStatus: "focus" as const
};

function failingIndexedDbFactory(error: DOMException) {
  return {
    open: () => {
      const request = {
        result: undefined,
        error,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null
      } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => request.onerror?.(new Event("error")));
      return request;
    }
  } as unknown as IDBFactory;
}

describe("useOfflineMutationOutbox", () => {
  it("queues offline, then drains once after the browser reconnects", async () => {
    const store = new InMemoryOfflineMutationOutboxStore();
    let online = false;
    const submit = vi.fn(async (input: OfflineTaskMutationInput) =>
      response(input)
    );
    const onAccepted = vi.fn();
    const { result } = renderHook(() =>
      useOfflineMutationOutbox({
        sessionId: "session_1",
        store,
        submit,
        online: () => online,
        onAccepted
      })
    );

    await act(async () => {
      await result.current.queueTaskStatusMove(move);
    });
    expect(submit).not.toHaveBeenCalled();
    expect(result.current.entries[0]).toMatchObject({ state: "queued" });

    online = true;
    act(() => window.dispatchEvent(new Event("online")));

    await waitFor(() => {
      expect(result.current.entries[0]).toMatchObject({ state: "accepted" });
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(onAccepted).toHaveBeenCalledTimes(1);
  });

  it("drains a second online enqueue that arrives after the active drain snapshot", async () => {
    const store = new InMemoryOfflineMutationOutboxStore();
    let settleFirst!: (value: OfflineTaskMutationResponse) => void;
    const firstResponse = new Promise<OfflineTaskMutationResponse>(
      (resolve) => {
        settleFirst = resolve;
      }
    );
    const submit = vi.fn(async (input: OfflineTaskMutationInput) => {
      if (input.taskId === "task_1") return firstResponse;
      return response(input);
    });
    const { result } = renderHook(() =>
      useOfflineMutationOutbox({
        sessionId: "session_1",
        store,
        submit,
        online: () => true
      })
    );

    let firstMove!: ReturnType<typeof result.current.queueTaskStatusMove>;
    act(() => {
      firstMove = result.current.queueTaskStatusMove(move);
    });
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));

    let secondMove!: ReturnType<typeof result.current.queueTaskStatusMove>;
    act(() => {
      secondMove = result.current.queueTaskStatusMove({
        ...move,
        taskId: "task_2",
        taskLabel: "Second task"
      });
    });
    await waitFor(async () => {
      expect(
        (await store.list()).some((entry) => entry.taskId === "task_2")
      ).toBe(true);
    });

    await act(async () => {
      settleFirst(response(submit.mock.calls[0]![0]));
      await Promise.all([firstMove, secondMove]);
    });

    expect(submit).toHaveBeenCalledTimes(2);
    expect(await store.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskId: "task_1", state: "accepted" }),
        expect.objectContaining({ taskId: "task_2", state: "accepted" })
      ])
    );
  });

  it("starts the replacement session drain after an older session drain settles", async () => {
    const store = new InMemoryOfflineMutationOutboxStore();
    let settleOldSession!: (value: OfflineTaskMutationResponse) => void;
    const oldSessionResponse = new Promise<OfflineTaskMutationResponse>(
      (resolve) => {
        settleOldSession = resolve;
      }
    );
    const submit = vi.fn(async (input: OfflineTaskMutationInput) => {
      if (input.sessionId === "old_session") return oldSessionResponse;
      return response(input);
    });
    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) =>
        useOfflineMutationOutbox({
          sessionId,
          store,
          submit,
          online: () => true
        }),
      { initialProps: { sessionId: "old_session" } }
    );

    let oldMove!: ReturnType<typeof result.current.queueTaskStatusMove>;
    act(() => {
      oldMove = result.current.queueTaskStatusMove(move);
    });
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    await store.save(
      createOfflineTaskMutationEntry({
        sessionId: "new_session",
        taskId: "task_2",
        taskLabel: "New-session task",
        expectedUpdatedAt: move.expectedUpdatedAt,
        desiredStatus: "focus",
        now: new Date("2026-08-09T12:00:01.000Z")
      })
    );
    rerender({ sessionId: "new_session" });

    await act(async () => {
      settleOldSession(response(submit.mock.calls[0]![0]));
      await oldMove;
    });
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1]?.[0]).toMatchObject({
      sessionId: "new_session",
      taskId: "task_2"
    });
  });

  it("keeps a move queued when the connection fails after an online signal", async () => {
    const store = new InMemoryOfflineMutationOutboxStore();
    const submit = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { result } = renderHook(() =>
      useOfflineMutationOutbox({
        sessionId: "session_1",
        store,
        submit,
        online: () => true
      })
    );

    await act(async () => {
      await result.current.queueTaskStatusMove(move);
    });

    expect(result.current.entries[0]).toMatchObject({
      state: "queued",
      attemptCount: 1
    });
    expect(result.current.errorMessage).toMatch(/still queued/i);
  });

  it("requires a decision for a stale revision and uses a new key on retry", async () => {
    const store = new InMemoryOfflineMutationOutboxStore();
    const inputs: OfflineTaskMutationInput[] = [];
    const submit = vi.fn(async (input: OfflineTaskMutationInput) => {
      inputs.push(input);
      return response(input, inputs.length === 1 ? "conflicted" : "accepted");
    });
    const { result } = renderHook(() =>
      useOfflineMutationOutbox({
        sessionId: "session_1",
        store,
        submit,
        online: () => true
      })
    );

    let conflictedId = "";
    await act(async () => {
      const conflicted = await result.current.queueTaskStatusMove(move);
      conflictedId = conflicted.id;
    });
    expect(result.current.entries[0]).toMatchObject({ state: "conflicted" });

    await act(async () => {
      await result.current.retryConflict(conflictedId);
    });

    expect(result.current.entries[0]).toMatchObject({ state: "accepted" });
    expect(inputs).toHaveLength(2);
    expect(inputs[1]?.expectedUpdatedAt).toBe("2026-08-09T12:01:00.000Z");
    expect(inputs[1]?.idempotencyKey).not.toBe(inputs[0]?.idempotencyKey);
  });

  it("does not replay a queued move under a replacement session", async () => {
    const queued = createOfflineTaskMutationEntry({
      sessionId: "old_session",
      ...move,
      now: new Date("2026-08-09T12:00:00.000Z")
    });
    const store = new InMemoryOfflineMutationOutboxStore([queued]);
    const submit = vi.fn(async (input: OfflineTaskMutationInput) =>
      response(input)
    );
    const { result } = renderHook(() =>
      useOfflineMutationOutbox({
        sessionId: "new_session",
        store,
        submit,
        online: () => true
      })
    );

    await waitFor(() => {
      expect(result.current.entries[0]).toMatchObject({
        state: "needs_decision"
      });
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it("keeps online task moves working when this browser cannot store an offline queue", async () => {
    const store = new BrowserOfflineMutationOutboxStore(
      failingIndexedDbFactory(
        new DOMException(
          "The IndexedDB quota is unavailable.",
          "QuotaExceededError"
        )
      )
    );
    const submit = vi.fn(async (input: OfflineTaskMutationInput) =>
      response(input)
    );
    const { result } = renderHook(() =>
      useOfflineMutationOutbox({
        sessionId: "session_1",
        store,
        submit,
        online: () => true
      })
    );

    await waitFor(() => expect(result.current.available).toBe(false));
    let acceptedState = "";
    await act(async () => {
      acceptedState = (await result.current.queueTaskStatusMove(move)).state;
    });

    expect(acceptedState).toBe("accepted");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(result.current.entries[0]).toMatchObject({ state: "accepted" });
  });

  it("surfaces a bounded notice after corrupt offline rows are removed", async () => {
    const takeRepairNotice = vi
      .fn<() => string | null>()
      .mockReturnValueOnce(
        "Forge removed 1 invalid offline record before continuing."
      )
      .mockReturnValue(null);
    const store: OfflineMutationOutboxStore = {
      list: vi.fn(async () => []),
      save: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      clearSettled: vi.fn(async () => undefined),
      takeRepairNotice
    };
    const { result } = renderHook(() =>
      useOfflineMutationOutbox({
        sessionId: "session_1",
        store,
        online: () => false
      })
    );

    await waitFor(() =>
      expect(result.current.errorMessage).toMatch(
        /removed 1 invalid offline record/i
      )
    );
  });

  it("keeps offline enqueue interaction p95 below 100 milliseconds", async () => {
    const store = new InMemoryOfflineMutationOutboxStore();
    const { result } = renderHook(() =>
      useOfflineMutationOutbox({
        sessionId: "session_1",
        store,
        online: () => false
      })
    );
    const durations: number[] = [];

    for (let index = 0; index < 33; index += 1) {
      const startedAt = performance.now();
      await act(async () => {
        await result.current.queueTaskStatusMove({
          ...move,
          taskId: `task_${index}`,
          taskLabel: `Task ${index}`
        });
      });
      const duration = performance.now() - startedAt;
      if (index >= 3) durations.push(duration);
    }
    const sorted = durations.slice().sort((left, right) => left - right);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Infinity;
    expect(p95).toBeLessThanOrEqual(100);
    console.log(`offline enqueue in-memory p95 ${p95.toFixed(2)}ms`);
  });
});
