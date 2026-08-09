import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  Cloud,
  CloudOff,
  RefreshCw,
  Trash2
} from "lucide-react";
import { Link } from "react-router-dom";

import { MutationReceiptBanner } from "@/components/mutation-receipt-banner";
import {
  shellDialogContentClassName,
  shellDialogDescriptionClassName,
  shellDialogOverlayClassName,
  shellDialogTitleClassName
} from "@/components/shell/shell-style-tokens";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import type { OfflineMutationOutboxController } from "@/features/shell/use-offline-mutation-outbox";
import type {
  OfflineMutationOutboxEntry,
  OfflineMutationOutboxState
} from "@/lib/offline-mutation-outbox";
import { cn, formatDateTime } from "@/lib/utils";

const STATUS_LABELS: Record<OfflineMutationOutboxState, string> = {
  queued: "Queued",
  sending: "Sending",
  accepted: "Accepted",
  conflicted: "Needs your decision",
  needs_decision: "Needs your decision",
  rejected: "Not accepted"
};

const TASK_STATUS_LABELS = {
  backlog: "Backlog",
  focus: "Focus",
  in_progress: "Ongoing",
  blocked: "Blocked",
  done: "Done"
} as const;

function statusTone(state: OfflineMutationOutboxState) {
  if (state === "accepted") return "signal" as const;
  if (["conflicted", "needs_decision", "rejected"].includes(state)) {
    return "default" as const;
  }
  return "meta" as const;
}

export function ShellMutationReceiptTrigger({
  controller,
  onOpen,
  compact = false
}: {
  controller: OfflineMutationOutboxController;
  onOpen: () => void;
  compact?: boolean;
}) {
  const count = controller.queuedCount + controller.decisionCount;
  const Icon = controller.isOnline ? Cloud : CloudOff;
  const label =
    count > 0
      ? `${count} offline ${count === 1 ? "change" : "changes"}`
      : "Offline changes";
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className={cn(
        "min-h-11 min-w-11 gap-2",
        compact ? "size-11 rounded-full p-0" : "px-3"
      )}
      onClick={onOpen}
      aria-label={label}
      title={label}
    >
      <Icon className="size-4" aria-hidden="true" />
      {!compact ? <span>Offline changes</span> : null}
      {count > 0 ? (
        <Badge
          size="xs"
          tone={controller.decisionCount > 0 ? "signal" : "meta"}
        >
          {count}
        </Badge>
      ) : null}
    </Button>
  );
}

function EntryActions({
  entry,
  controller,
  onOpenChange
}: {
  entry: OfflineMutationOutboxEntry;
  controller: OfflineMutationOutboxController;
  onOpenChange: (open: boolean) => void;
}) {
  if (entry.state === "sending") return null;
  if (entry.state === "accepted" && entry.mutationReceipt) {
    return (
      <MutationReceiptBanner
        receipt={entry.mutationReceipt}
        onReceiptChange={(receipt) =>
          void controller.updateMutationReceipt(entry.id, receipt)
        }
        onUndone={async () => {
          await controller.refresh();
        }}
      />
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {entry.state === "queued" ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="min-h-11"
          disabled={!controller.isOnline || controller.isDraining}
          onClick={() => void controller.retryQueued()}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Try now
        </Button>
      ) : null}
      {entry.state === "conflicted" && entry.current ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="min-h-11"
          disabled={!controller.isOnline || controller.isDraining}
          onClick={() => void controller.retryConflict(entry.id)}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Move to {TASK_STATUS_LABELS[entry.desiredStatus]} now
        </Button>
      ) : null}
      {["conflicted", "needs_decision", "rejected"].includes(entry.state) ? (
        <Link
          to={`/tasks/${encodeURIComponent(entry.taskId)}`}
          onClick={() => onOpenChange(false)}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-4 text-sm font-medium text-[var(--ui-ink-strong)] transition hover:bg-[var(--ui-surface-hover)]"
        >
          <ArrowUpRight className="size-4" aria-hidden="true" />
          Open task
        </Link>
      ) : null}
      {entry.state !== "accepted" ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="min-h-11"
          onClick={() => void controller.discard(entry.id)}
        >
          <Trash2 className="size-4" aria-hidden="true" />
          Discard queued move
        </Button>
      ) : null}
    </div>
  );
}

function MutationEntry({
  entry,
  controller,
  onOpenChange
}: {
  entry: OfflineMutationOutboxEntry;
  controller: OfflineMutationOutboxController;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <article className="grid gap-3 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium text-[var(--ui-ink-strong)]">
            {entry.taskLabel}
          </h3>
          <p className="mt-1 text-sm text-[var(--ui-ink-muted)]">
            Move to {TASK_STATUS_LABELS[entry.desiredStatus]}
          </p>
        </div>
        <Badge tone={statusTone(entry.state)}>
          {STATUS_LABELS[entry.state]}
        </Badge>
      </div>
      <p
        className="text-sm leading-6 text-[var(--ui-ink-medium)]"
        role={
          ["conflicted", "needs_decision", "rejected"].includes(entry.state)
            ? "alert"
            : undefined
        }
      >
        {entry.summary}
      </p>
      {entry.current && entry.state === "conflicted" ? (
        <p className="text-xs leading-5 text-[var(--ui-ink-faint)]">
          Current server state: {TASK_STATUS_LABELS[entry.current.status]} ·
          updated {formatDateTime(entry.current.updatedAt)}
        </p>
      ) : null}
      {entry.replayed ? (
        <p className="text-xs text-[var(--ui-ink-faint)]">
          Forge recognized this exact retry and returned the first result.
        </p>
      ) : null}
      <EntryActions
        entry={entry}
        controller={controller}
        onOpenChange={onOpenChange}
      />
    </article>
  );
}

export function ShellMutationReceiptCenter({
  open,
  onOpenChange,
  controller
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controller: OfflineMutationOutboxController;
}) {
  const hasSettled = controller.entries.some((entry) =>
    ["accepted", "rejected"].includes(entry.state)
  );
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={shellDialogOverlayClassName} />
        <Dialog.Content
          className={cn(
            shellDialogContentClassName,
            "top-[5vh] max-h-[90vh] w-[min(46rem,calc(100vw-1.25rem))] overflow-hidden"
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Dialog.Title className={shellDialogTitleClassName}>
                Offline changes
              </Dialog.Title>
              <Dialog.Description className={shellDialogDescriptionClassName}>
                Forge can keep supported task moves here while you are offline
                and will show what happened after you reconnect. Completing
                tasks and other changes still need a live connection.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <ModalCloseButton aria-label="Close offline changes" />
            </Dialog.Close>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-y border-[var(--ui-border-subtle)] py-3">
            <div
              className="flex min-h-11 items-center gap-2 text-sm text-[var(--ui-ink-medium)]"
              role="status"
              aria-live="polite"
            >
              {controller.isOnline ? (
                <Cloud
                  className="size-4 text-[var(--success)]"
                  aria-hidden="true"
                />
              ) : (
                <CloudOff
                  className="size-4 text-[var(--warning)]"
                  aria-hidden="true"
                />
              )}
              {controller.isOnline
                ? controller.isDraining
                  ? "Checking queued changes"
                  : "Forge is online"
                : "Forge is offline"}
              {controller.queuedCount > 0
                ? ` · ${controller.queuedCount} waiting`
                : ""}
            </div>
            <div className="flex flex-wrap gap-2">
              {controller.queuedCount > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="min-h-11"
                  disabled={!controller.isOnline || controller.isDraining}
                  onClick={() => void controller.retryQueued()}
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Try queued changes
                </Button>
              ) : null}
              {hasSettled ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="min-h-11"
                  onClick={() => void controller.clearSettled()}
                >
                  Clear accepted and rejected
                </Button>
              ) : null}
            </div>
          </div>

          {!controller.available ? (
            <div
              className="mt-4 flex items-start gap-3 rounded-[20px] bg-[var(--ui-warning-soft)] p-4 text-sm leading-6 text-[var(--ui-ink-medium)]"
              role="alert"
            >
              <CircleAlert className="mt-1 size-4 shrink-0 text-[var(--warning)]" />
              <span>
                This browser cannot store offline changes. Online task moves
                still work.
              </span>
            </div>
          ) : controller.errorMessage ? (
            <div
              className="mt-4 flex items-start gap-3 rounded-[20px] bg-[var(--ui-warning-soft)] p-4 text-sm leading-6 text-[var(--ui-ink-medium)]"
              role="alert"
            >
              <CircleAlert className="mt-1 size-4 shrink-0 text-[var(--warning)]" />
              <span>{controller.errorMessage}</span>
            </div>
          ) : null}

          <div className="mt-4 max-h-[60vh] overflow-y-auto overscroll-contain pr-1">
            {controller.entries.length === 0 ? (
              <div className="grid justify-items-center gap-3 rounded-[24px] border border-dashed border-[var(--ui-border-strong)] px-5 py-10 text-center">
                <CheckCircle2
                  className="size-6 text-[var(--success)]"
                  aria-hidden="true"
                />
                <div>
                  <h3 className="font-medium text-[var(--ui-ink-strong)]">
                    No offline changes
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--ui-ink-muted)]">
                    Supported task moves will appear here if Forge cannot reach
                    the server.
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid gap-3">
                {controller.entries.map((entry) => (
                  <MutationEntry
                    key={entry.id}
                    entry={entry}
                    controller={controller}
                    onOpenChange={onOpenChange}
                  />
                ))}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
