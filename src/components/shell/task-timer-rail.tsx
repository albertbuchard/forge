import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCheck, Clock3, PauseCircle, Play, Square, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Task, TaskRun, TimeAccountingMode } from "@/lib/types";

/* ── Shared expand state via context ── */

type RailExpandState = { expanded: boolean; setExpanded: (v: boolean | ((p: boolean) => boolean)) => void };
const RailExpandCtx = createContext<RailExpandState>({ expanded: false, setExpanded: () => {} });

export function TaskTimerRailProvider({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const openedAtMsRef = useRef(0);

  /* Auto-collapse on scroll down */
  useEffect(() => {
    if (!expanded) return;
    openedAtMsRef.current = performance.now();
    let lastY = window.scrollY;
    const handleScroll = () => {
      if (performance.now() - openedAtMsRef.current < 280) {
        lastY = window.scrollY;
        return;
      }
      if (window.scrollY - lastY > 16) setExpanded(false);
      lastY = window.scrollY;
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [expanded]);

  return <RailExpandCtx.Provider value={{ expanded, setExpanded }}>{children}</RailExpandCtx.Provider>;
}

/* ── Types ── */

type TaskTimerRailProps = {
  runs: TaskRun[];
  tasks: Task[];
  generatedAt: string;
  timeAccountingMode: TimeAccountingMode;
  pending: boolean;
  onOpenStartWork: () => void;
  onFocus: (runId: string) => Promise<void>;
  onPause: (runId: string) => Promise<void>;
  onComplete: (runId: string) => Promise<void>;
};

type LiveRunView = {
  run: TaskRun;
  title: string;
  wallSeconds: number;
  creditedSeconds: number;
  remainingSeconds: number | null;
  overtimeSeconds: number;
};

/* ── Helpers ── */

function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function buildLiveRunViews(
  runs: TaskRun[],
  tasks: Task[],
  generatedAt: string,
  timeAccountingMode: TimeAccountingMode,
  nowMs: number
): LiveRunView[] {
  const activeCount = Math.max(1, runs.length);
  const generatedAtMs = Date.parse(generatedAt);
  const deltaSeconds = Number.isFinite(generatedAtMs) ? Math.max(0, Math.floor((nowMs - generatedAtMs) / 1000)) : 0;

  return runs
    .map((run) => {
      const task = tasks.find((entry) => entry.id === run.taskId);
      const wallSeconds = run.status === "active" ? run.elapsedWallSeconds + deltaSeconds : run.elapsedWallSeconds;
      const creditedExtra =
        run.status !== "active"
          ? 0
          : timeAccountingMode === "parallel"
            ? deltaSeconds
            : timeAccountingMode === "split"
              ? deltaSeconds / activeCount
              : run.isCurrent
                ? deltaSeconds
                : 0;
      const creditedSeconds = run.creditedSeconds + creditedExtra;
      const remainingSeconds =
        run.timerMode === "planned" && run.plannedDurationSeconds !== null
          ? Math.max(0, run.plannedDurationSeconds - wallSeconds)
          : null;
      const overtimeSeconds =
        run.timerMode === "planned" && run.plannedDurationSeconds !== null
          ? Math.max(0, wallSeconds - run.plannedDurationSeconds)
          : 0;
      return { run, title: task?.title ?? run.taskTitle, wallSeconds, creditedSeconds, remainingSeconds, overtimeSeconds };
    })
    .sort((left, right) => Number(right.run.isCurrent) - Number(left.run.isCurrent));
}

function useLiveRuns(runs: TaskRun[], tasks: Task[], generatedAt: string, timeAccountingMode: TimeAccountingMode) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (runs.length === 0) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [runs.length]);
  return useMemo(() => buildLiveRunViews(runs, tasks, generatedAt, timeAccountingMode, nowMs), [generatedAt, nowMs, runs, tasks, timeAccountingMode]);
}

/* ────────────────────────────────────────────────────────
 *  TaskTimerRailBar — the compact pill that sits inline
 *  with the page title (same height as sm buttons: 34px)
 * ──────────────────────────────────────────────────────── */

export function TaskTimerRailBar({
  runs, tasks, generatedAt, timeAccountingMode, pending, onOpenStartWork, onPause, onFocus
}: Pick<TaskTimerRailProps, "runs" | "tasks" | "generatedAt" | "timeAccountingMode" | "pending" | "onOpenStartWork" | "onPause" | "onFocus">) {
  const { expanded, setExpanded } = useContext(RailExpandCtx);
  const liveRuns = useLiveRuns(runs, tasks, generatedAt, timeAccountingMode);
  const current = liveRuns.find((e) => e.run.isCurrent) ?? liveRuns[0] ?? null;
  const secondary = current ? liveRuns.filter((e) => e.run.id !== current.run.id) : [];

  /* No active work */
  if (!current) {
    return (
      <div className="flex min-h-[2.125rem] min-w-0 items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.04] py-1 pl-2.5 pr-1">
        <Timer className="size-3.5 shrink-0 text-white/48" />
        <span className="truncate text-[12px] text-white/48">No active work</span>
        <button
          type="button"
          className="ml-auto inline-flex h-[1.5rem] shrink-0 items-center rounded-full bg-white/10 px-2 text-[11px] font-medium text-white transition hover:bg-white/15"
          onClick={onOpenStartWork}
        >
          Start work
        </button>
      </div>
    );
  }

  /* Active work — compact pill.
   * Left side = clickable expand/collapse area (button).
   * Right side = discrete action buttons, each isolated. */
  return (
    <div
      className={cn(
        "flex min-h-[2.125rem] min-w-0 items-center rounded-full border border-white/8 bg-white/[0.04] transition-colors",
        expanded && "border-[var(--primary)]/25 bg-[var(--primary)]/[0.06]"
      )}
    >
      {/* ── Left: expand/collapse toggle ── */}
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse work details" : "Expand work details"}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-l-full py-1 pl-2.5 pr-2 transition-colors hover:bg-white/[0.04]"
        onClick={() => setExpanded((p: boolean) => !p)}
      >
        <Timer className="size-3.5 shrink-0 text-[var(--primary)]" />
        <span className="truncate text-[12px] font-medium text-white">{current.title}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-white/44">{formatDuration(current.creditedSeconds)}</span>
      </button>

      {/* ── Right: action buttons ── */}
      <div className="flex shrink-0 items-center gap-0.5 pr-1">
        {secondary.length > 0 ? (
          <button
            type="button"
            title="Switch to next task"
            disabled={pending}
            className="inline-flex size-6 items-center justify-center rounded-full bg-[var(--primary)]/15 text-[10px] font-bold tabular-nums text-[var(--primary)] transition hover:bg-[var(--primary)]/25 disabled:pointer-events-none disabled:opacity-70"
            onClick={() => void onFocus(secondary[0].run.id)}
          >
            {liveRuns.length}
          </button>
        ) : null}
        <button
          type="button"
          title="Stop"
          disabled={pending}
          className="inline-flex size-6 items-center justify-center rounded-full text-white/50 transition hover:bg-white/[0.1] hover:text-white disabled:pointer-events-none disabled:opacity-70"
          onClick={() => void onPause(current.run.id)}
        >
          <Square className="size-2.5 fill-current" />
        </button>
        <button
          type="button"
          title="Start new work"
          disabled={pending}
          className="inline-flex size-6 items-center justify-center rounded-full text-white/50 transition hover:bg-white/[0.1] hover:text-white disabled:pointer-events-none disabled:opacity-70"
          onClick={() => onOpenStartWork()}
        >
          <Play className="size-2.5 fill-current" />
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────
 *  TaskTimerRailPanel — the expanded detail panel
 *  Render this as a sibling below the header title row
 *  so it spans the full header width.
 * ──────────────────────────────────────────────────────── */

export function TaskTimerRailPanel({
  runs, tasks, generatedAt, timeAccountingMode, pending, onOpenStartWork, onFocus, onPause, onComplete
}: TaskTimerRailProps) {
  const { expanded } = useContext(RailExpandCtx);
  const liveRuns = useLiveRuns(runs, tasks, generatedAt, timeAccountingMode);
  const current = liveRuns.find((e) => e.run.isCurrent) ?? liveRuns[0] ?? null;
  const secondary = current ? liveRuns.filter((e) => e.run.id !== current.run.id) : [];

  const splitHint =
    timeAccountingMode === "split" && liveRuns.length > 1
      ? `Split across ${liveRuns.length} active tasks`
      : timeAccountingMode === "parallel" && liveRuns.length > 1
        ? `Parallel time across ${liveRuns.length} active tasks`
        : timeAccountingMode === "primary_only" && liveRuns.length > 1
          ? "Only the current task is earning credited time"
          : null;

  if (!current) return null;

  return (
    <AnimatePresence initial={false}>
      {expanded ? (
        <motion.div
          key="timer-rail-detail"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="overflow-hidden"
        >
          <div className="mt-2 rounded-2xl border border-white/8 bg-[linear-gradient(180deg,rgba(192,193,255,0.10),rgba(192,193,255,0.03))] p-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="signal" className="text-white/82">Current task</Badge>
                  <Badge tone="meta">{current.run.timerMode === "planned" ? "Planned timer" : "Unlimited timer"}</Badge>
                  {splitHint ? <Badge tone="meta">{splitHint}</Badge> : null}
                </div>
                <div className="mt-3 text-xl font-medium text-white md:text-2xl">{current.title}</div>
                <div className="mt-2 flex flex-wrap gap-4 text-sm text-white/62">
                  <span>{formatDuration(current.creditedSeconds)} credited</span>
                  <span>{formatDuration(current.wallSeconds)} wall time</span>
                  {current.run.timerMode === "planned" ? (
                    current.overtimeSeconds > 0 ? (
                      <span className="text-amber-200">+{formatDuration(current.overtimeSeconds)} overtime</span>
                    ) : (
                      <span>{formatDuration(current.remainingSeconds ?? 0)} remaining</span>
                    )
                  ) : (
                    <span>Unlimited session</span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" pending={pending} pendingLabel="Opening" onClick={onOpenStartWork}>
                  <Timer className="size-4" />
                  Start work
                </Button>
                <Button variant="secondary" pending={pending} pendingLabel="Pausing" onClick={() => void onPause(current.run.id)}>
                  <PauseCircle className="size-4" />
                  Pause
                </Button>
                <Button pending={pending} pendingLabel="Completing" onClick={() => void onComplete(current.run.id)}>
                  <CheckCheck className="size-4" />
                  Complete
                </Button>
              </div>
            </div>

            {secondary.length > 0 ? (
              <div className="mt-4 grid gap-2 lg:grid-cols-2">
                {secondary.map((entry) => (
                  <button
                    key={entry.run.id}
                    type="button"
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-2xl bg-white/[0.04] px-4 py-3 text-left transition hover:bg-white/[0.08]",
                      pending && "pointer-events-none opacity-70"
                    )}
                    onClick={() => void onFocus(entry.run.id)}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-white/88">{entry.title}</div>
                      <div className="mt-1 flex flex-wrap gap-3 text-[12px] text-white/48">
                        <span>{formatDuration(entry.creditedSeconds)} credited</span>
                        <span>{entry.run.timerMode === "planned" ? "planned" : "unlimited"}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[12px] text-white/42">
                      <Clock3 className="size-3.5" />
                      Switch
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
