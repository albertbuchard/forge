import { reconcileExpiredTaskRuns } from "./run-recovery.js";
const DEFAULT_INTERVAL_MS = 15_000;
function createInitialStatus(intervalMs, limit) {
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
export function createTaskRunWatchdog(options = {}) {
    const intervalMs = Math.max(1_000, options.intervalMs ?? DEFAULT_INTERVAL_MS);
    const now = options.now ?? (() => new Date());
    const reconcile = options.reconcile ??
        ((input) => reconcileExpiredTaskRuns({
            now: input.now,
            limit: input.limit
        }));
    const status = createInitialStatus(intervalMs, options.limit);
    let timer = null;
    let inFlight = null;
    const reconcileNow = async () => {
        if (inFlight) {
            return inFlight;
        }
        status.lastStartedAt = now().toISOString();
        inFlight = Promise.resolve().then(() => reconcile({
            now: now(),
            limit: options.limit
        }));
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
        }
        catch (error) {
            const errorAt = now().toISOString();
            status.lastCompletedAt = errorAt;
            status.lastErrorAt = errorAt;
            status.lastError = error instanceof Error ? error.message : String(error);
            status.consecutiveFailures += 1;
            throw error;
        }
        finally {
            inFlight = null;
        }
    };
    const start = async () => {
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
    const stop = () => {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        status.running = false;
    };
    const getStatus = () => ({
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
