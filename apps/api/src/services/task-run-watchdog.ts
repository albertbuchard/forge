import { reconcileExpiredTaskRuns, type StartupTaskRunRecoverySummary } from "./run-recovery.js";

export type TaskRunWatchdogOptions = {
  intervalMs?: number;
  limit?: number;
  now?: () => Date;
  reconcile?: (options: { now: Date; limit?: number }) => StartupTaskRunRecoverySummary | Promise<StartupTaskRunRecoverySummary>;
};

export type TaskRunWatchdogStatus = {
  intervalMs: number;
  limit: number | null;
  running: boolean;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastSuccessfulAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  lastRecovery: StartupTaskRunRecoverySummary | null;
  totalRecoveredCount: number;
  consecutiveFailures: number;
};

const DEFAULT_INTERVAL_MS = 15_000;

function createInitialStatus(intervalMs: number, limit?: number): TaskRunWatchdogStatus {
  return {
    intervalMs,
    limit: limit ?? null,
    running: false,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastSuccessfulAt: null,
    lastErrorAt: null,
    lastError: null,
    lastRecovery: null,
    totalRecoveredCount: 0,
    consecutiveFailures: 0
  };
}

export function createTaskRunWatchdog(options: TaskRunWatchdogOptions = {}) {
  const intervalMs = Math.max(1_000, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  const now = options.now ?? (() => new Date());
  const reconcile =
    options.reconcile ??
    ((input: { now: Date; limit?: number }) =>
      reconcileExpiredTaskRuns({
        now: input.now,
        limit: input.limit
      }));
  const status = createInitialStatus(intervalMs, options.limit);
  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<StartupTaskRunRecoverySummary> | null = null;

  const reconcileNow = async (): Promise<StartupTaskRunRecoverySummary> => {
    if (inFlight) {
      return inFlight;
    }

    status.lastStartedAt = now().toISOString();
    inFlight = Promise.resolve().then(() =>
      reconcile({
        now: now(),
        limit: options.limit
      })
    );

    try {
      const summary = await inFlight;
      status.lastCompletedAt = summary.recoveredAt;
      status.lastSuccessfulAt = summary.recoveredAt;
      status.lastRecovery = summary;
      status.totalRecoveredCount += summary.recoveredCount;
      status.consecutiveFailures = 0;
      status.lastError = null;
      status.lastErrorAt = null;
      return summary;
    } catch (error) {
      const errorAt = now().toISOString();
      status.lastCompletedAt = errorAt;
      status.lastErrorAt = errorAt;
      status.lastError = error instanceof Error ? error.message : String(error);
      status.consecutiveFailures += 1;
      throw error;
    } finally {
      inFlight = null;
    }
  };

  const start = async (): Promise<StartupTaskRunRecoverySummary> => {
    if (timer) {
      return status.lastRecovery ?? reconcileNow();
    }

    status.running = true;
    const summary = await reconcileNow();
    timer = setInterval(() => {
      void reconcileNow().catch(() => {
        // Preserve error details in watchdog status without crashing the server loop.
      });
    }, intervalMs);
    timer.unref?.();
    return summary;
  };

  const stop = (): void => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    status.running = false;
  };

  const getStatus = (): TaskRunWatchdogStatus => ({
    ...status,
    running: timer !== null
  });

  return {
    start,
    stop,
    reconcileNow,
    getStatus
  };
}

export type TaskRunWatchdog = ReturnType<typeof createTaskRunWatchdog>;
