import { recoverTimedOutTaskRuns } from "../repositories/task-runs.js";
import type { TaskRun } from "../types.js";

export type StartupTaskRunRecoverySummary = {
  recoveredAt: string;
  recoveredCount: number;
  recoveredRunIds: string[];
};

export function reconcileExpiredTaskRuns(options: { now?: Date; limit?: number } = {}): StartupTaskRunRecoverySummary {
  const now = options.now ?? new Date();
  const recoveredRuns = recoverTimedOutTaskRuns({ now, limit: options.limit });

  return {
    recoveredAt: now.toISOString(),
    recoveredCount: recoveredRuns.length,
    recoveredRunIds: recoveredRuns.map((run: TaskRun) => run.id)
  };
}

export function recoverExpiredTaskRunsOnStartup(options: { now?: Date; limit?: number } = {}): StartupTaskRunRecoverySummary {
  return reconcileExpiredTaskRuns(options);
}
