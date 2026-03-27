import { recoverTimedOutTaskRuns } from "../repositories/task-runs.js";
export function reconcileExpiredTaskRuns(options = {}) {
    const now = options.now ?? new Date();
    const recoveredRuns = recoverTimedOutTaskRuns({ now, limit: options.limit });
    return {
        recoveredAt: now.toISOString(),
        recoveredCount: recoveredRuns.length,
        recoveredRunIds: recoveredRuns.map((run) => run.id)
    };
}
export function recoverExpiredTaskRunsOnStartup(options = {}) {
    return reconcileExpiredTaskRuns(options);
}
