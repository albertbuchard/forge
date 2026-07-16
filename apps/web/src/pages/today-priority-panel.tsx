import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  Clock3,
  Play,
  RefreshCcw
} from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TodayEvidenceState, TodayPriorityDecision } from "@/lib/types";
import { cn } from "@/lib/utils";

const evidenceIcon = {
  urgency: AlertTriangle,
  schedule: CalendarClock,
  capacity: CircleGauge,
  "active-context": Activity
} as const;

const evidenceStateLabel: Record<TodayEvidenceState, string> = {
  fresh: "Current",
  stale: "Stale",
  missing: "Missing",
  loading: "Loading",
  error: "Error"
};

function evidenceTone(state: TodayEvidenceState) {
  switch (state) {
    case "fresh":
      return "text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)]";
    case "stale":
    case "loading":
      return "text-[color-mix(in_srgb,var(--warning)_78%,var(--ui-ink-strong)_22%)]";
    case "error":
      return "text-[color-mix(in_srgb,var(--danger)_78%,var(--ui-ink-strong)_22%)]";
    default:
      return "text-[var(--ui-ink-faint)]";
  }
}

function DecisionBadge({ decision }: { decision: TodayPriorityDecision }) {
  const label =
    decision.mode === "continue-active"
      ? "Active now"
      : decision.mode === "unresolved-active"
        ? "Active run needs review"
        : decision.mode === "overloaded"
          ? "Capacity overloaded"
          : decision.mode === "capacity-limited"
            ? "No task fits capacity"
            : decision.mode === "no-work"
              ? "No startable work"
              : decision.confidence === "full"
                ? "Ready"
                : "Check inputs";
  const className =
    decision.mode === "overloaded" || decision.mode === "unresolved-active"
      ? "border-[color-mix(in_srgb,var(--danger)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-danger-soft)] text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]"
      : decision.mode === "continue-active"
        ? "border-[color-mix(in_srgb,var(--success)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)]"
        : decision.mode === "capacity-limited" ||
            decision.confidence === "limited"
          ? "border-[color-mix(in_srgb,var(--warning)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-warning-soft)] text-[color-mix(in_srgb,var(--warning)_76%,var(--ui-ink-strong)_24%)]"
          : "border-[color-mix(in_srgb,var(--primary)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-accent-soft)] text-[var(--primary)]";
  return (
    <Badge className={className} aria-label={`Today decision: ${label}`}>
      {label}
    </Badge>
  );
}

export function TodayPriorityPanel({
  decision,
  onStartTask,
  onRefresh,
  refreshing = false
}: {
  decision: TodayPriorityDecision;
  onStartTask: (taskId: string) => Promise<void>;
  onRefresh: () => Promise<unknown>;
  refreshing?: boolean;
}) {
  const [starting, setStarting] = useState(false);
  const [refreshingEvidence, setRefreshingEvidence] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const selected = decision.selectedCandidate;
  const selectedTask = selected?.task ?? null;
  const title =
    decision.mode === "unresolved-active"
      ? "Resolve active work"
      : decision.mode === "overloaded"
        ? "Pause before adding work"
        : decision.mode === "capacity-limited"
          ? "Choose smaller work"
          : decision.mode === "no-work"
            ? "No daily runway yet"
            : (selectedTask?.title ?? "No next task selected");

  const startSelectedTask = async () => {
    if (!selectedTask || starting) {
      return;
    }
    setActionError(null);
    setStarting(true);
    try {
      await onStartTask(selectedTask.id);
    } catch {
      setActionError(
        "The task could not be started. Refresh Today and try again."
      );
    } finally {
      setStarting(false);
    }
  };

  const refreshEvidence = async () => {
    if (refreshing || refreshingEvidence) {
      return;
    }
    setActionError(null);
    setRefreshingEvidence(true);
    try {
      await onRefresh();
    } catch {
      setActionError(
        "Today could not refresh all evidence. Try again shortly."
      );
    } finally {
      setRefreshingEvidence(false);
    }
  };

  return (
    <section
      aria-labelledby="today-priority-title"
      aria-busy={decision.isLoading || refreshing || refreshingEvidence}
      className="grid min-w-0 gap-5"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
            Today decision
          </div>
          <h2
            id="today-priority-title"
            className="mt-1 break-words text-xl font-semibold text-[var(--ui-ink-strong)]"
          >
            Next useful work
          </h2>
        </div>
        <div
          className="flex max-w-full flex-wrap items-center justify-end gap-2"
          aria-live="polite"
        >
          <DecisionBadge decision={decision} />
          {decision.needsRefresh ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              pending={refreshing || refreshingEvidence}
              pendingLabel="Refreshing"
              onClick={() => void refreshEvidence()}
            >
              <RefreshCcw className="size-3.5" />
              Refresh evidence
            </Button>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "min-w-0 border-l-4 px-4 py-3",
          decision.mode === "overloaded" ||
            decision.mode === "unresolved-active"
            ? "border-[var(--danger)] bg-[var(--ui-danger-soft)]"
            : decision.mode === "capacity-limited"
              ? "border-[var(--warning)] bg-[var(--ui-warning-soft)]"
              : decision.mode === "continue-active"
                ? "border-[var(--success)] bg-[var(--ui-success-soft)]"
                : "border-[var(--primary)] bg-[var(--ui-accent-soft)]"
        )}
      >
        <div className="break-words text-base font-semibold text-[var(--ui-ink-strong)]">
          {title}
        </div>
        <p className="mt-1 break-words text-sm leading-6 text-[var(--ui-ink-soft)]">
          {decision.summary}
        </p>
        {selected ? (
          <p className="mt-2 break-words text-sm leading-6 text-[var(--ui-ink-medium)]">
            <span className="font-medium text-[var(--ui-ink-strong)]">
              Why first:
            </span>{" "}
            {selected.reason}
          </p>
        ) : null}

        <div className="mt-3 flex max-w-full flex-wrap gap-2">
          {decision.mode === "ready" && selectedTask ? (
            <Button
              type="button"
              size="sm"
              pending={starting}
              pendingLabel="Starting"
              onClick={() => void startSelectedTask()}
            >
              <Play className="size-3.5" />
              Start now
            </Button>
          ) : null}
          {selectedTask ? (
            <Link
              to={`/tasks/${selectedTask.id}`}
              className="inline-flex min-h-[2.125rem] max-w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-2.5 py-[0.4375rem] text-[13px] font-medium text-[var(--ui-ink-strong)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]"
            >
              Open task
              <ChevronRight className="size-3.5 shrink-0" />
            </Link>
          ) : null}
          {decision.mode === "overloaded" ||
          decision.mode === "capacity-limited" ? (
            <Link
              to="/life-force"
              className="inline-flex min-h-[2.125rem] max-w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-2.5 py-[0.4375rem] text-[13px] font-medium text-[var(--ui-ink-strong)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]"
            >
              Review capacity
              <ChevronRight className="size-3.5 shrink-0" />
            </Link>
          ) : null}
          {decision.mode === "no-work" ? (
            <>
              <Link
                to="/kanban"
                className="inline-flex min-h-[2.125rem] max-w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-2.5 py-[0.4375rem] text-[13px] font-medium text-[var(--ui-ink-strong)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]"
              >
                Review work
                <ChevronRight className="size-3.5 shrink-0" />
              </Link>
              <Link
                to="/goals"
                className="inline-flex min-h-[2.125rem] max-w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-2.5 py-[0.4375rem] text-[13px] font-medium text-[var(--ui-ink-strong)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]"
              >
                Open life goals
                <ChevronRight className="size-3.5 shrink-0" />
              </Link>
            </>
          ) : null}
        </div>
        {actionError ? (
          <div
            role="alert"
            className="mt-3 text-sm text-[color-mix(in_srgb,var(--danger)_78%,var(--ui-ink-strong)_22%)]"
          >
            {actionError}
          </div>
        ) : null}
      </div>

      <dl className="grid min-w-0 overflow-hidden rounded-lg border border-[var(--ui-border-subtle)] sm:grid-cols-2 xl:grid-cols-4">
        {decision.evidence.map((evidence, index) => {
          const Icon = evidenceIcon[evidence.key];
          return (
            <div
              key={evidence.key}
              className={cn(
                "min-w-0 px-3 py-3",
                index > 0 && "border-t border-[var(--ui-border-subtle)]",
                index === 1 && "sm:border-t-0 sm:border-l",
                index === 2 && "xl:border-t-0 xl:border-l",
                index === 3 && "sm:border-l xl:border-t-0"
              )}
            >
              <dt className="flex min-w-0 items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                <Icon
                  className={cn(
                    "size-3.5 shrink-0",
                    evidenceTone(evidence.state)
                  )}
                />
                <span className="truncate">{evidence.label}</span>
                <span
                  className={cn(
                    "ml-auto shrink-0 normal-case tracking-normal",
                    evidenceTone(evidence.state)
                  )}
                >
                  {evidenceStateLabel[evidence.state]}
                </span>
              </dt>
              <dd className="mt-2 break-words text-sm leading-5 text-[var(--ui-ink-soft)]">
                {evidence.detail}
              </dd>
            </div>
          );
        })}
      </dl>

      {decision.alternatives.length > 0 ? (
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
            {decision.mode === "overloaded" ||
            decision.mode === "unresolved-active" ? (
              <AlertTriangle className="size-3.5 text-[var(--warning)]" />
            ) : (
              <Clock3 className="size-3.5" />
            )}
            {decision.mode === "unresolved-active"
              ? "Other work after resolving the live run"
              : decision.mode === "overloaded" ||
                  decision.mode === "capacity-limited"
                ? "Candidates after recovery or replanning"
                : "Next candidates"}
          </div>
          <ol className="mt-2 divide-y divide-[var(--ui-border-subtle)] overflow-hidden rounded-lg border border-[var(--ui-border-subtle)]">
            {decision.alternatives.map((candidate, index) => (
              <li key={candidate.task.id} className="min-w-0">
                <Link
                  to={`/tasks/${candidate.task.id}`}
                  className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-3 py-3 transition hover:bg-[var(--ui-surface-hover)]"
                >
                  <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--ui-surface-2)] text-xs font-semibold text-[var(--ui-ink-medium)]">
                    {index + (decision.selectedCandidate ? 2 : 1)}
                  </span>
                  <span className="min-w-0">
                    <span className="block break-words text-sm font-medium text-[var(--ui-ink-strong)]">
                      {candidate.task.title}
                    </span>
                    <span className="mt-1 block line-clamp-2 break-words text-xs leading-5 text-[var(--ui-ink-soft)]">
                      {candidate.reason}
                    </span>
                  </span>
                  {candidate.capacityFit === true ? (
                    <CheckCircle2
                      className="mt-0.5 size-4 shrink-0 text-[var(--success)]"
                      aria-label="Fits current capacity"
                    />
                  ) : (
                    <ChevronRight className="mt-0.5 size-4 shrink-0 text-[var(--ui-ink-faint)]" />
                  )}
                </Link>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
