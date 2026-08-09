import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { submitOfflineTaskStatusMutation } from "@/lib/api";
import { ForgeApiError } from "@/lib/api-error";
import type { MutationReceipt } from "@/lib/mutation-receipts";
import {
  OfflineMutationOutboxError,
  applyOfflineMutationReceipt,
  createBrowserOfflineMutationOutboxStore,
  createOfflineTaskMutationEntry,
  isUnresolvedOfflineMutation,
  type OfflineMutationOutboxEntry,
  type OfflineMutationOutboxStore
} from "@/lib/offline-mutation-outbox";
import type {
  OfflineTaskMutationInput,
  OfflineTaskMutationResponse,
  OfflineTaskStatus
} from "@/lib/types";

type SubmitOfflineMutation = (
  input: OfflineTaskMutationInput
) => Promise<OfflineTaskMutationResponse>;

function browserIsOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function currentDate() {
  return new Date();
}

function isSessionDecisionError(error: unknown) {
  return (
    error instanceof ForgeApiError &&
    (error.status === 401 || error.status === 403 || error.status === 409)
  );
}

function isRetryableConnectionError(error: unknown) {
  if (error instanceof ForgeApiError) {
    return error.status === 0 || error.status >= 500;
  }
  return error instanceof TypeError;
}

function nextAttempt(
  entry: OfflineMutationOutboxEntry,
  now: Date
): OfflineMutationOutboxEntry {
  const attemptedAt = now.toISOString();
  return {
    ...entry,
    state: "sending",
    summary: `Checking whether Forge can move ${entry.taskLabel}.`,
    attemptCount: entry.attemptCount + 1,
    lastAttemptAt: attemptedAt,
    updatedAt: attemptedAt
  };
}

function queuedAfterConnectionFailure(
  entry: OfflineMutationOutboxEntry,
  now: Date
): OfflineMutationOutboxEntry {
  return {
    ...entry,
    state: "queued",
    summary: `Waiting to move ${entry.taskLabel}. Forge will try again after you reconnect.`,
    updatedAt: now.toISOString()
  };
}

function needsSessionDecision(
  entry: OfflineMutationOutboxEntry,
  now: Date,
  message = "Your Forge session changed before this move was accepted. Open the task and decide whether to make the move again."
): OfflineMutationOutboxEntry {
  return {
    ...entry,
    state: "needs_decision",
    summary: message,
    updatedAt: now.toISOString()
  };
}

function rejectedAfterRequest(
  entry: OfflineMutationOutboxEntry,
  error: unknown,
  now: Date
): OfflineMutationOutboxEntry {
  return {
    ...entry,
    state: "rejected",
    summary:
      error instanceof Error
        ? error.message
        : `Forge could not move ${entry.taskLabel}.`,
    updatedAt: now.toISOString()
  };
}

function buildRequest(entry: OfflineMutationOutboxEntry) {
  return {
    version: 1,
    sessionId: entry.sessionId,
    idempotencyKey: entry.idempotencyKey,
    action: "task_status",
    taskId: entry.taskId,
    expectedUpdatedAt: entry.expectedUpdatedAt,
    status: entry.desiredStatus
  } satisfies OfflineTaskMutationInput;
}

export function useOfflineMutationOutbox({
  sessionId,
  store: suppliedStore,
  submit = submitOfflineTaskStatusMutation,
  online = browserIsOnline,
  now = currentDate,
  onAccepted
}: {
  sessionId: string | null;
  store?: OfflineMutationOutboxStore;
  submit?: SubmitOfflineMutation;
  online?: () => boolean;
  now?: () => Date;
  onAccepted?: (entry: OfflineMutationOutboxEntry) => Promise<void> | void;
}) {
  const store = useMemo(
    () => suppliedStore ?? createBrowserOfflineMutationOutboxStore(),
    [suppliedStore]
  );
  const [entries, setEntries] = useState<OfflineMutationOutboxEntry[]>([]);
  const [available, setAvailable] = useState(true);
  const [isOnline, setIsOnline] = useState(online());
  const [isDraining, setIsDraining] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const drainPromiseRef = useRef<Promise<void> | null>(null);
  const connectionRetryBlockedRef = useRef(false);
  const onlineRef = useRef(online);
  const nowRef = useRef(now);
  const submitRef = useRef(submit);
  const onAcceptedRef = useRef(onAccepted);
  onlineRef.current = online;
  nowRef.current = now;
  submitRef.current = submit;
  onAcceptedRef.current = onAccepted;

  const readOnline = useCallback(() => onlineRef.current(), []);
  const readNow = useCallback(() => nowRef.current(), []);
  const submitMutation = useCallback<SubmitOfflineMutation>(
    (input) => submitRef.current(input),
    []
  );
  const notifyAccepted = useCallback(
    (entry: OfflineMutationOutboxEntry) => onAcceptedRef.current?.(entry),
    []
  );

  const refresh = useCallback(async () => {
    try {
      const next = await store.list();
      setEntries(next);
      setAvailable(true);
      const repairNotice = store.takeRepairNotice?.();
      if (repairNotice) setErrorMessage(repairNotice);
      return next;
    } catch (error) {
      if (
        error instanceof OfflineMutationOutboxError &&
        error.code === "offline_outbox_unavailable"
      ) {
        setAvailable(false);
        setErrorMessage(error.message);
        return [];
      }
      throw error;
    }
  }, [store]);

  const persist = useCallback(
    async (
      entry: OfflineMutationOutboxEntry,
      options?: { replaceId?: string }
    ) => {
      await store.save(entry, options);
      await refresh();
    },
    [refresh, store]
  );

  const drain = useCallback(async () => {
    if (!sessionId || !readOnline() || connectionRetryBlockedRef.current) {
      return;
    }
    while (drainPromiseRef.current) {
      await drainPromiseRef.current;
      if (!sessionId || !readOnline() || connectionRetryBlockedRef.current) {
        return;
      }
    }

    const work = (async () => {
      setIsDraining(true);
      setIsOnline(true);
      setErrorMessage(null);
      try {
        const pending = (await store.list())
          .filter(
            (entry) => entry.sessionId === sessionId && entry.state === "queued"
          )
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
        for (const queued of pending) {
          const sending = nextAttempt(queued, readNow());
          await persist(sending);
          try {
            const response = await submitMutation(buildRequest(sending));
            const terminal = applyOfflineMutationReceipt(
              sending,
              response.receipt,
              response.replayed,
              readNow()
            );
            await persist(terminal);
            if (terminal.state === "accepted") {
              await notifyAccepted(terminal);
            }
          } catch (error) {
            if (isSessionDecisionError(error)) {
              await persist(needsSessionDecision(sending, readNow()));
              continue;
            }
            if (isRetryableConnectionError(error)) {
              connectionRetryBlockedRef.current = true;
              await persist(queuedAfterConnectionFailure(sending, readNow()));
              setIsOnline(readOnline());
              setErrorMessage(
                "Forge could not reach the server. The task move is still queued."
              );
              break;
            }
            await persist(rejectedAfterRequest(sending, error, readNow()));
          }
        }
      } finally {
        setIsDraining(false);
        await refresh();
      }
    })();
    drainPromiseRef.current = work;
    try {
      await work;
    } finally {
      if (drainPromiseRef.current === work) {
        drainPromiseRef.current = null;
      }
    }
  }, [
    notifyAccepted,
    persist,
    readNow,
    readOnline,
    refresh,
    sessionId,
    store,
    submitMutation
  ]);

  useEffect(() => {
    let active = true;
    const prepare = async () => {
      const loaded = await refresh();
      if (!active || !sessionId) return;
      for (const entry of loaded) {
        if (!isUnresolvedOfflineMutation(entry)) continue;
        if (entry.sessionId !== sessionId) {
          await store.save(needsSessionDecision(entry, readNow()));
        } else if (entry.state === "sending") {
          await store.save(queuedAfterConnectionFailure(entry, readNow()));
        }
      }
      if (!active) return;
      await refresh();
      if (readOnline()) await drain();
    };
    void prepare().catch((error) => {
      if (!active) return;
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Forge could not read the offline queue."
      );
    });
    return () => {
      active = false;
    };
  }, [drain, readNow, readOnline, refresh, sessionId, store]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOnline = () => {
      connectionRetryBlockedRef.current = false;
      setIsOnline(true);
      void drain();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [drain]);

  const retryQueued = useCallback(async () => {
    connectionRetryBlockedRef.current = false;
    await drain();
  }, [drain]);

  const queueTaskStatusMove = useCallback(
    async (input: {
      taskId: string;
      taskLabel: string;
      expectedUpdatedAt: string;
      desiredStatus: OfflineTaskStatus;
    }) => {
      if (!sessionId) {
        throw new OfflineMutationOutboxError(
          "offline_outbox_unavailable",
          "Forge needs an active browser session before it can queue a task move."
        );
      }
      setErrorMessage(null);
      const queued = createOfflineTaskMutationEntry({
        sessionId,
        ...input,
        now: readNow()
      });
      try {
        await persist(queued);
      } catch (error) {
        if (
          error instanceof OfflineMutationOutboxError &&
          error.code === "offline_outbox_unavailable" &&
          readOnline()
        ) {
          const response = await submitMutation(buildRequest(queued));
          const terminal = applyOfflineMutationReceipt(
            queued,
            response.receipt,
            response.replayed,
            readNow()
          );
          setEntries((current) => [
            terminal,
            ...current.filter((entry) => entry.id !== terminal.id)
          ]);
          if (terminal.state === "accepted") {
            await notifyAccepted(terminal);
          }
          return terminal;
        }
        throw error;
      }
      if (readOnline()) await drain();
      return (
        (await store.list()).find((entry) => entry.id === queued.id) ?? queued
      );
    },
    [
      drain,
      notifyAccepted,
      persist,
      readNow,
      readOnline,
      sessionId,
      store,
      submitMutation
    ]
  );

  const discard = useCallback(
    async (entryId: string) => {
      await store.delete(entryId);
      await refresh();
    },
    [refresh, store]
  );

  const retryConflict = useCallback(
    async (entryId: string) => {
      const currentEntries = await store.list();
      const current = currentEntries.find((entry) => entry.id === entryId);
      if (!current?.current || !sessionId) return null;
      const retry = createOfflineTaskMutationEntry({
        sessionId,
        taskId: current.taskId,
        taskLabel: current.taskLabel,
        expectedUpdatedAt: current.current.updatedAt,
        desiredStatus: current.desiredStatus,
        now: readNow()
      });
      await persist(retry, { replaceId: current.id });
      if (readOnline()) await drain();
      return (
        (await store.list()).find((entry) => entry.id === retry.id) ?? retry
      );
    },
    [drain, persist, readNow, readOnline, sessionId, store]
  );

  const clearSettled = useCallback(async () => {
    await store.clearSettled();
    await refresh();
  }, [refresh, store]);

  const updateMutationReceipt = useCallback(
    async (entryId: string, mutationReceipt: MutationReceipt) => {
      const current = (await store.list()).find(
        (entry) => entry.id === entryId
      );
      if (!current) return;
      await persist({
        ...current,
        mutationReceipt,
        updatedAt: readNow().toISOString()
      });
    },
    [persist, readNow, store]
  );

  const queuedCount = entries.filter((entry) =>
    ["queued", "sending"].includes(entry.state)
  ).length;
  const decisionCount = entries.filter((entry) =>
    ["conflicted", "needs_decision", "rejected"].includes(entry.state)
  ).length;

  return {
    entries,
    available,
    isOnline,
    isDraining,
    errorMessage,
    queuedCount,
    decisionCount,
    queueTaskStatusMove,
    retryQueued,
    retryConflict,
    discard,
    clearSettled,
    updateMutationReceipt,
    refresh
  };
}

export type OfflineMutationOutboxController = ReturnType<
  typeof useOfflineMutationOutbox
>;
