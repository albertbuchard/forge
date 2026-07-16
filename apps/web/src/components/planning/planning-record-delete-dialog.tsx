import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { RotateCcw, Trash2 } from "lucide-react";
import {
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-state";

type DeleteFlowValue = Record<string, never>;

export function PlanningRecordDeleteDialog({
  open,
  recordKind,
  recordTitle,
  onOpenChange,
  onConfirm
}: {
  open: boolean;
  recordKind: string;
  recordTitle: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}) {
  const [value, setValue] = useState<DeleteFlowValue>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!open) {
      inFlightRef.current = false;
      setPending(false);
      setError(null);
    }
  }, [open]);

  const steps: Array<QuestionFlowStep<DeleteFlowValue>> = [
    {
      id: "confirm",
      eyebrow: "Reversible deletion",
      title: `Move "${recordTitle}" to the bin?`,
      description: `The ${recordKind} will leave active Forge views. Its linked context and history stay attached and can be restored from this page.`,
      render: () => (
        <div className="rounded-[20px] border border-[color-mix(in_srgb,var(--danger)_24%,var(--ui-border-subtle)_76%)] bg-[var(--ui-danger-soft)] p-4 text-sm leading-6 text-[var(--ui-ink-medium)]">
          <div className="flex items-start gap-3">
            <Trash2 className="mt-0.5 size-4 shrink-0 text-[var(--danger)]" />
            <span>
              This is a soft delete. Restore remains available unless a later
              explicit permanent deletion removes the record.
            </span>
          </div>
        </div>
      )
    }
  ];

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={onOpenChange}
      eyebrow={`${recordKind} lifecycle`}
      title={`Delete ${recordKind}`}
      description={`Confirm the reversible deletion of ${recordTitle}.`}
      value={value}
      onChange={setValue}
      steps={steps}
      pending={pending}
      pendingLabel="Moving to bin"
      submitLabel="Move to bin"
      error={error}
      onSubmit={async () => {
        if (inFlightRef.current) {
          return;
        }
        inFlightRef.current = true;
        setPending(true);
        setError(null);
        try {
          await onConfirm();
          onOpenChange(false);
        } catch (nextError) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : `Unable to delete this ${recordKind}.`
          );
        } finally {
          inFlightRef.current = false;
          setPending(false);
        }
      }}
    />
  );
}

export function PlanningRecordDeletedState({
  recordKind,
  recordTitle,
  backHref,
  backLabel,
  restoreError,
  restoring,
  onRestore
}: {
  recordKind: string;
  recordTitle: string;
  backHref: string;
  backLabel: string;
  restoreError?: unknown;
  restoring: boolean;
  onRestore: () => Promise<void>;
}) {
  const restoreInFlightRef = useRef(false);
  const errorMessage =
    restoreError instanceof Error
      ? restoreError.message
      : restoreError
        ? `Unable to restore this ${recordKind}.`
        : null;
  const handleRestore = async () => {
    if (restoreInFlightRef.current || restoring) {
      return;
    }
    restoreInFlightRef.current = true;
    try {
      await onRestore();
    } catch {
      // The mutation error is rendered through restoreError.
    } finally {
      restoreInFlightRef.current = false;
    }
  };

  return (
    <EmptyState
      eyebrow="Moved to bin"
      title={`${recordTitle} is no longer active`}
      description={`Forge preserved this ${recordKind} and its linked context. Restore it here or return to the collection.`}
      action={
        <div className="grid max-w-full gap-3">
          {errorMessage ? (
            <div
              role="alert"
              className="max-w-md rounded-[var(--radius-control)] bg-[var(--ui-danger-soft)] px-4 py-3 text-sm text-[var(--danger)]"
            >
              {errorMessage}
            </div>
          ) : null}
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              type="button"
              pending={restoring}
              pendingLabel="Restoring"
              onClick={() => void handleRestore()}
            >
              <RotateCcw className="size-4" />
              Restore {recordKind}
            </Button>
            <Link
              to={backHref}
              className="interactive-tap inline-flex min-h-10 min-w-0 max-w-full items-center justify-center whitespace-nowrap rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-2 text-[13px] font-medium leading-none text-[var(--ui-ink-strong)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_45%,transparent)]"
            >
              {backLabel}
            </Link>
          </div>
        </div>
      }
    />
  );
}
