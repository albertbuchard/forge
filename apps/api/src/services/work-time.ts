import { getDatabase } from "../db.js";
import { listTaskWorkAdjustmentSecondsMap } from "../repositories/work-adjustments.js";
import type { TaskRun, TaskTimeSummary, TimeAccountingMode } from "../types.js";

type TaskRunTimingRow = {
  id: string;
  task_id: string;
  actor: string;
  status: TaskRun["status"];
  timer_mode: TaskRun["timerMode"];
  planned_duration_seconds: number | null;
  is_current: number;
  claimed_at: string;
  heartbeat_at: string;
  lease_expires_at: string;
  completed_at: string | null;
  released_at: string | null;
  timed_out_at: string | null;
  updated_at: string;
};

type RunTiming = {
  row: TaskRunTimingRow;
  startMs: number;
  endMs: number;
};

type RunMetric = {
  elapsedWallSeconds: number;
  creditedSeconds: number;
  remainingSeconds: number | null;
  overtimeSeconds: number;
  isCurrent: boolean;
};

type TimeComputation = {
  mode: TimeAccountingMode;
  runMetrics: Map<string, RunMetric>;
  taskSummaries: Map<string, TaskTimeSummary>;
};

function readTimeAccountingMode(): TimeAccountingMode {
  try {
    const row = getDatabase()
      .prepare(
        `SELECT time_accounting_mode
         FROM app_settings
         WHERE id = 1`
      )
      .get() as { time_accounting_mode?: string } | undefined;
    if (
      row?.time_accounting_mode === "split" ||
      row?.time_accounting_mode === "parallel" ||
      row?.time_accounting_mode === "primary_only"
    ) {
      return row.time_accounting_mode;
    }
  } catch {
    return "split";
  }
  return "split";
}

function readTaskRunTimingRows(): TaskRunTimingRow[] {
  return getDatabase()
    .prepare(
      `SELECT
         id,
         task_id,
         actor,
         status,
         timer_mode,
         planned_duration_seconds,
         is_current,
         claimed_at,
         heartbeat_at,
         lease_expires_at,
         completed_at,
         released_at,
         timed_out_at,
         updated_at
       FROM task_runs
       ORDER BY claimed_at ASC, id ASC`
    )
    .all() as TaskRunTimingRow[];
}

function roundCreditedSeconds(value: number): number {
  return Math.round(value * 100) / 100;
}

function getRunEndMs(row: TaskRunTimingRow, nowMs: number): number {
  if (row.status === "active") {
    return Math.max(Date.parse(row.claimed_at), Math.min(nowMs, Date.parse(row.lease_expires_at)));
  }

  const terminal =
    row.completed_at ??
    row.released_at ??
    row.timed_out_at ??
    row.updated_at ??
    row.lease_expires_at ??
    row.heartbeat_at;
  return Math.max(Date.parse(row.claimed_at), Date.parse(terminal));
}

function buildRunTimings(rows: TaskRunTimingRow[], now: Date): RunTiming[] {
  const nowMs = now.getTime();
  return rows
    .map((row) => ({
      row,
      startMs: Date.parse(row.claimed_at),
      endMs: getRunEndMs(row, nowMs)
    }))
    .filter((timing) => Number.isFinite(timing.startMs) && Number.isFinite(timing.endMs) && timing.endMs >= timing.startMs);
}

function computeCreditedSecondsByActor(timings: RunTiming[], mode: TimeAccountingMode): Map<string, number> {
  const creditedMs = new Map<string, number>();
  const timingsByActor = new Map<string, RunTiming[]>();

  for (const timing of timings) {
    const list = timingsByActor.get(timing.row.actor) ?? [];
    list.push(timing);
    timingsByActor.set(timing.row.actor, list);
    creditedMs.set(timing.row.id, 0);
  }

  for (const actorTimings of timingsByActor.values()) {
    const boundaries = [...new Set(actorTimings.flatMap((timing) => [timing.startMs, timing.endMs]))].sort((a, b) => a - b);
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const startMs = boundaries[index]!;
      const endMs = boundaries[index + 1]!;
      const sliceMs = endMs - startMs;
      if (sliceMs <= 0) {
        continue;
      }

      const active = actorTimings.filter((timing) => timing.startMs < endMs && timing.endMs > startMs);
      if (active.length === 0) {
        continue;
      }

      if (mode === "parallel") {
        for (const timing of active) {
          creditedMs.set(timing.row.id, (creditedMs.get(timing.row.id) ?? 0) + sliceMs);
        }
        continue;
      }

      if (mode === "primary_only") {
        const current = active.find((timing) => timing.row.is_current === 1);
        if (current) {
          creditedMs.set(current.row.id, (creditedMs.get(current.row.id) ?? 0) + sliceMs);
        }
        continue;
      }

      const shareMs = sliceMs / active.length;
      for (const timing of active) {
        creditedMs.set(timing.row.id, (creditedMs.get(timing.row.id) ?? 0) + shareMs);
      }
    }
  }

  return new Map([...creditedMs.entries()].map(([runId, value]) => [runId, roundCreditedSeconds(value / 1000)]));
}

export function computeWorkTime(now = new Date()): TimeComputation {
  const mode = readTimeAccountingMode();
  const timings = buildRunTimings(readTaskRunTimingRows(), now);
  const creditedByRunId = computeCreditedSecondsByActor(timings, mode);
  const runMetrics = new Map<string, RunMetric>();
  const taskSummaries = new Map<string, TaskTimeSummary>();

  for (const timing of timings) {
    const elapsedWallSeconds = Math.max(0, Math.floor((timing.endMs - timing.startMs) / 1000));
    const creditedSeconds = creditedByRunId.get(timing.row.id) ?? 0;
    const remainingSeconds =
      timing.row.timer_mode === "planned" && timing.row.planned_duration_seconds !== null
        ? Math.max(0, timing.row.planned_duration_seconds - elapsedWallSeconds)
        : null;
    const overtimeSeconds =
      timing.row.timer_mode === "planned" && timing.row.planned_duration_seconds !== null
        ? Math.max(0, elapsedWallSeconds - timing.row.planned_duration_seconds)
        : 0;
    const isCurrent = timing.row.is_current === 1 && timing.row.status === "active";

    runMetrics.set(timing.row.id, {
      elapsedWallSeconds,
      creditedSeconds,
      remainingSeconds,
      overtimeSeconds,
      isCurrent
    });

    const existing = taskSummaries.get(timing.row.task_id) ?? {
      totalTrackedSeconds: 0,
      totalCreditedSeconds: 0,
      liveTrackedSeconds: 0,
      liveCreditedSeconds: 0,
      manualAdjustedSeconds: 0,
      activeRunCount: 0,
      hasCurrentRun: false,
      currentRunId: null
    };

    taskSummaries.set(timing.row.task_id, {
      totalTrackedSeconds: existing.totalTrackedSeconds + elapsedWallSeconds,
      totalCreditedSeconds: roundCreditedSeconds(existing.totalCreditedSeconds + creditedSeconds),
      liveTrackedSeconds: existing.liveTrackedSeconds + elapsedWallSeconds,
      liveCreditedSeconds: roundCreditedSeconds(existing.liveCreditedSeconds + creditedSeconds),
      manualAdjustedSeconds: existing.manualAdjustedSeconds,
      activeRunCount: existing.activeRunCount + (timing.row.status === "active" ? 1 : 0),
      hasCurrentRun: existing.hasCurrentRun || isCurrent,
      currentRunId: isCurrent ? timing.row.id : existing.currentRunId
    });
  }

  const adjustmentSecondsByTaskId = listTaskWorkAdjustmentSecondsMap();
  for (const [taskId, adjustmentSeconds] of adjustmentSecondsByTaskId.entries()) {
    const existing = taskSummaries.get(taskId) ?? emptyTaskTimeSummary();
    taskSummaries.set(taskId, {
      totalTrackedSeconds: Math.max(0, existing.totalTrackedSeconds + adjustmentSeconds),
      totalCreditedSeconds: roundCreditedSeconds(Math.max(0, existing.totalCreditedSeconds + adjustmentSeconds)),
      liveTrackedSeconds: existing.liveTrackedSeconds,
      liveCreditedSeconds: existing.liveCreditedSeconds,
      manualAdjustedSeconds: existing.manualAdjustedSeconds + adjustmentSeconds,
      activeRunCount: existing.activeRunCount,
      hasCurrentRun: existing.hasCurrentRun,
      currentRunId: existing.currentRunId
    });
  }

  return {
    mode,
    runMetrics,
    taskSummaries
  };
}

export function emptyTaskTimeSummary(): TaskTimeSummary {
  return {
    totalTrackedSeconds: 0,
    totalCreditedSeconds: 0,
    liveTrackedSeconds: 0,
    liveCreditedSeconds: 0,
    manualAdjustedSeconds: 0,
    activeRunCount: 0,
    hasCurrentRun: false,
    currentRunId: null
  };
}

export function sumTaskTimeSummaries(taskIds: string[], summaries: Map<string, TaskTimeSummary>): TaskTimeSummary {
  return taskIds.reduce<TaskTimeSummary>(
    (accumulator, taskId) => {
      const summary = summaries.get(taskId);
      if (!summary) {
        return accumulator;
      }

      return {
        totalTrackedSeconds: accumulator.totalTrackedSeconds + summary.totalTrackedSeconds,
        totalCreditedSeconds: roundCreditedSeconds(accumulator.totalCreditedSeconds + summary.totalCreditedSeconds),
        liveTrackedSeconds: accumulator.liveTrackedSeconds + summary.liveTrackedSeconds,
        liveCreditedSeconds: roundCreditedSeconds(accumulator.liveCreditedSeconds + summary.liveCreditedSeconds),
        manualAdjustedSeconds: accumulator.manualAdjustedSeconds + summary.manualAdjustedSeconds,
        activeRunCount: accumulator.activeRunCount + summary.activeRunCount,
        hasCurrentRun: accumulator.hasCurrentRun || summary.hasCurrentRun,
        currentRunId: accumulator.currentRunId ?? summary.currentRunId
      };
    },
    emptyTaskTimeSummary()
  );
}
