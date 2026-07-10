import { useEffect, useState } from "react";
import {
  CheckCheck,
  PauseCircle,
  Play,
  RefreshCw,
  Timer,
  TimerReset
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/utils";
import type {
  Task,
  TaskRun,
  TaskRunFinishInput,
  TaskRunHeartbeatInput,
  TaskRunClaimInput
} from "@/lib/types";

type TaskRunControlsProps = {
  task: Task;
  activeTaskRun: TaskRun | null;
  pending: boolean;
  errorMessage: string | null;
  onClaim: (input: TaskRunClaimInput) => Promise<void>;
  onHeartbeat: (runId: string, input: TaskRunHeartbeatInput) => Promise<void>;
  onComplete: (runId: string, input: TaskRunFinishInput) => Promise<void>;
  onRelease: (runId: string, input: TaskRunFinishInput) => Promise<void>;
  onFocus?: (runId: string, input: { actor?: string }) => Promise<void>;
};

function toLeaseMinutes(leaseTtlSeconds: number): string {
  return String(Math.max(1, Math.round(leaseTtlSeconds / 60)));
}

function toPlannedMinutes(plannedDurationSeconds: number | null): string {
  return plannedDurationSeconds === null
    ? "45"
    : String(Math.max(1, Math.round(plannedDurationSeconds / 60)));
}

function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function TaskRunControls({
  task,
  activeTaskRun,
  pending,
  errorMessage,
  onClaim,
  onHeartbeat,
  onComplete,
  onRelease,
  onFocus
}: TaskRunControlsProps) {
  const [actor, setActor] = useState(activeTaskRun?.actor ?? task.owner);
  const [note, setNote] = useState(activeTaskRun?.note ?? "");
  const [leaseMinutes, setLeaseMinutes] = useState(
    toLeaseMinutes(activeTaskRun?.leaseTtlSeconds ?? 900)
  );
  const [timerMode, setTimerMode] = useState<TaskRunClaimInput["timerMode"]>(
    activeTaskRun?.timerMode ?? "unlimited"
  );
  const [plannedMinutes, setPlannedMinutes] = useState(
    toPlannedMinutes(activeTaskRun?.plannedDurationSeconds ?? null)
  );

  useEffect(() => {
    setActor(activeTaskRun?.actor ?? task.owner);
    setNote(activeTaskRun?.note ?? "");
    setLeaseMinutes(toLeaseMinutes(activeTaskRun?.leaseTtlSeconds ?? 900));
    setTimerMode(activeTaskRun?.timerMode ?? "unlimited");
    setPlannedMinutes(
      toPlannedMinutes(activeTaskRun?.plannedDurationSeconds ?? null)
    );
  }, [activeTaskRun, task.id, task.owner]);

  const leaseTtlSeconds = Math.max(
    60,
    Number.parseInt(leaseMinutes, 10) * 60 || 900
  );
  const plannedDurationSeconds =
    timerMode === "planned"
      ? Math.max(60, Number.parseInt(plannedMinutes, 10) * 60 || 2700)
      : null;

  return (
    <div className="rounded-[24px] bg-[linear-gradient(180deg,var(--ui-accent-soft),var(--ui-surface-1))] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="type-label text-[var(--ui-ink-faint)]">
            Task timer
          </div>
          <div className="mt-2 type-title-lg text-[var(--ui-ink-strong)]">
            {activeTaskRun ? "Live work session" : "Start live work"}
          </div>
        </div>
        <Badge
          className={
            activeTaskRun?.isCurrent
              ? "text-[var(--success)]"
              : "text-[var(--ui-ink-soft)]"
          }
        >
          {activeTaskRun
            ? activeTaskRun.isCurrent
              ? "current"
              : "active"
            : "idle"}
        </Badge>
      </div>

      <p className="mt-3 text-sm leading-6 text-[var(--ui-ink-soft)]">
        {activeTaskRun
          ? `${activeTaskRun.actor} is on this task. Credited ${formatDuration(activeTaskRun.creditedSeconds)} over ${formatDuration(activeTaskRun.elapsedWallSeconds)} wall time.`
          : "Choose a planned session or go unlimited. Forge will track credited time separately from raw wall time when you multitask."}
      </p>

      <div className="mt-4 grid gap-3">
        <label className="grid gap-2">
          <span className="type-label text-[var(--ui-ink-faint)]">Actor</span>
          <Input
            aria-label="Actor"
            value={actor}
            onChange={(event) => setActor(event.target.value)}
            placeholder="Albert"
          />
        </label>

        {!activeTaskRun ? (
          <div className="grid gap-2">
            <span className="type-label text-[var(--ui-ink-faint)]">
              Timer mode
            </span>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  {
                    value: "planned",
                    label: "Planned session",
                    detail:
                      "Aim for a target duration, then roll into overtime."
                  },
                  {
                    value: "unlimited",
                    label: "Unlimited",
                    detail: "Track until you stop without a planned target."
                  }
                ] as const
              ).map((option) => {
                const selected = timerMode === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`rounded-[18px] border p-4 text-left transition ${selected ? "border-[color-mix(in_srgb,var(--primary)_30%,var(--ui-border-subtle)_70%)] bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)]" : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)]"}`}
                    onClick={() => setTimerMode(option.value)}
                  >
                    <div className="font-medium">{option.label}</div>
                    <div className="mt-2 text-sm leading-6 text-inherit/80">
                      {option.detail}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {timerMode === "planned" ? (
          <label className="grid gap-2">
            <span className="type-label text-[var(--ui-ink-faint)]">
              Planned minutes
            </span>
            <Input
              aria-label="Planned minutes"
              type="number"
              min={1}
              max={1440}
              value={plannedMinutes}
              onChange={(event) => setPlannedMinutes(event.target.value)}
            />
          </label>
        ) : null}

        <label className="grid gap-2">
          <span className="type-label text-[var(--ui-ink-faint)]">
            Heartbeat window (minutes)
          </span>
          <Input
            aria-label="Heartbeat window"
            type="number"
            min={1}
            max={240}
            value={leaseMinutes}
            onChange={(event) => setLeaseMinutes(event.target.value)}
          />
        </label>

        <label className="grid gap-2">
          <span className="type-label text-[var(--ui-ink-faint)]">
            Session note
          </span>
          <Textarea
            aria-label="Session note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What are you doing in this block?"
          />
        </label>
      </div>

      {activeTaskRun ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[18px] bg-[var(--ui-surface-1)] p-3">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
              Credited
            </div>
            <div className="mt-2 font-display text-xl text-[var(--ui-ink-strong)]">
              {formatDuration(activeTaskRun.creditedSeconds)}
            </div>
          </div>
          <div className="rounded-[18px] bg-[var(--ui-surface-1)] p-3">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
              Wall time
            </div>
            <div className="mt-2 font-display text-xl text-[var(--ui-ink-strong)]">
              {formatDuration(activeTaskRun.elapsedWallSeconds)}
            </div>
          </div>
          <div className="rounded-[18px] bg-[var(--ui-surface-1)] p-3">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
              {activeTaskRun.timerMode === "planned" ? "Remaining" : "Mode"}
            </div>
            <div className="mt-2 font-display text-xl text-[var(--ui-ink-strong)]">
              {activeTaskRun.timerMode === "planned"
                ? activeTaskRun.overtimeSeconds > 0
                  ? `+${formatDuration(activeTaskRun.overtimeSeconds)}`
                  : formatDuration(activeTaskRun.remainingSeconds ?? 0)
                : "Unlimited"}
            </div>
          </div>
          <div className="rounded-[18px] bg-[var(--ui-surface-1)] p-3">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
              Lease
            </div>
            <div className="mt-2 font-display text-xl text-[var(--ui-ink-strong)]">
              {Math.round(activeTaskRun.leaseTtlSeconds / 60)} min
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {activeTaskRun ? (
          <>
            {!activeTaskRun.isCurrent && onFocus ? (
              <Button
                variant="secondary"
                pending={pending}
                pendingLabel="Switching"
                onClick={async () => onFocus(activeTaskRun.id, { actor })}
              >
                <Timer className="mr-2 size-3.5" />
                Make current
              </Button>
            ) : null}
            <Button
              variant="secondary"
              pending={pending}
              pendingLabel="Sending"
              onClick={async () =>
                onHeartbeat(activeTaskRun.id, { actor, leaseTtlSeconds, note })
              }
            >
              <RefreshCw className="mr-2 size-3.5" />
              Keep alive
            </Button>
            <Button
              pending={pending}
              pendingLabel="Completing"
              onClick={async () =>
                onComplete(activeTaskRun.id, { actor, note })
              }
            >
              <CheckCheck className="mr-2 size-3.5" />
              Complete task
            </Button>
            <Button
              variant="ghost"
              pending={pending}
              pendingLabel="Pausing"
              onClick={async () => onRelease(activeTaskRun.id, { actor, note })}
            >
              <PauseCircle className="mr-2 size-3.5" />
              Pause timer
            </Button>
          </>
        ) : (
          <Button
            pending={pending}
            pendingLabel="Starting"
            onClick={async () =>
              onClaim({
                actor,
                timerMode,
                plannedDurationSeconds,
                isCurrent: true,
                leaseTtlSeconds,
                note
              })
            }
          >
            <Play className="mr-2 size-3.5" />
            Start timer
          </Button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-[12px] text-[var(--ui-ink-faint)]">
        <div className="rounded-full bg-[var(--ui-surface-1)] px-3 py-2">
          {task.owner} default owner
        </div>
        <div className="rounded-full bg-[var(--ui-surface-1)] px-3 py-2">
          {timerMode === "planned"
            ? `${plannedMinutes} min target`
            : "Unlimited session"}
        </div>
        <div className="rounded-full bg-[var(--ui-surface-1)] px-3 py-2">
          Structured provenance required
        </div>
      </div>

      {errorMessage ? (
        <div className="mt-4 rounded-[18px] bg-[var(--ui-danger-soft)] px-4 py-3 text-sm leading-6 text-[var(--danger)]">
          {errorMessage}
        </div>
      ) : null}

      {activeTaskRun?.status === "active" ? (
        <div className="mt-4 flex items-center gap-2 text-[12px] text-[var(--ui-ink-faint)]">
          <TimerReset className="size-3.5" />
          Last heartbeat {formatDateTime(activeTaskRun.heartbeatAt)}
        </div>
      ) : null}
    </div>
  );
}
