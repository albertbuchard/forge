import { Clock3, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  createMutationReceiptUndoKey,
  undoMutationReceipt
} from "@/lib/api";
import { ForgeApiError } from "@/lib/api-error";
import type { MutationReceipt } from "@/lib/mutation-receipts";
import { formatDateTime } from "@/lib/utils";

type MutationReceiptBannerProps = {
  receipt: MutationReceipt | null;
  onReceiptChange?: (receipt: MutationReceipt) => void;
  onUndone?: () => Promise<void> | void;
};

function receiptFromError(error: unknown): MutationReceipt | null {
  if (!(error instanceof ForgeApiError) || !error.response) return null;
  const response = error.response as Record<string, unknown>;
  const receipt = response.receipt;
  return receipt && typeof receipt === "object"
    ? (receipt as MutationReceipt)
    : null;
}

export function MutationReceiptBanner({
  receipt,
  onReceiptChange,
  onUndone
}: MutationReceiptBannerProps) {
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const undoKey = useMemo(
    () => (receipt ? createMutationReceiptUndoKey() : null),
    [receipt?.id]
  );

  useEffect(() => {
    setErrorMessage(null);
  }, [receipt?.id]);

  useEffect(() => {
    if (receipt?.status !== "available" || !receipt.expiresAt) {
      setExpired(false);
      return;
    }
    const deadline = Date.parse(receipt.expiresAt);
    if (!Number.isFinite(deadline) || deadline <= Date.now()) {
      setExpired(true);
      return;
    }
    setExpired(false);
    const timer = window.setTimeout(
      () => setExpired(true),
      Math.min(deadline - Date.now(), 2_147_483_647)
    );
    return () => window.clearTimeout(timer);
  }, [receipt?.expiresAt, receipt?.id, receipt?.status]);

  if (!receipt) return null;

  const undoAvailable = receipt.status === "available" && !expired;
  const explanation = expired
    ? "The Undo window expired. Forge left the current data unchanged."
    : receipt.explanation;

  const undo = async () => {
    if (!undoKey) return;
    setPending(true);
    setErrorMessage(null);
    try {
      const result = await undoMutationReceipt(receipt.id, undoKey);
      onReceiptChange?.(result.receipt);
      await onUndone?.();
    } catch (error) {
      const terminalReceipt = receiptFromError(error);
      if (terminalReceipt) onReceiptChange?.(terminalReceipt);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Forge could not undo this change."
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-4 sm:flex-row sm:items-center sm:justify-between"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="min-w-0 space-y-1">
        <p className="font-medium text-[var(--ui-ink-strong)]">
          {receipt.summary}
        </p>
        <p className="flex items-start gap-2 text-sm text-[var(--ui-ink-muted)]">
          <Clock3 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            {undoAvailable && receipt.expiresAt
              ? `Undo is available until ${formatDateTime(receipt.expiresAt)}.`
              : explanation}
          </span>
        </p>
        {errorMessage ? (
          <p role="alert" className="text-sm text-[var(--ui-danger)]">
            {errorMessage}
          </p>
        ) : null}
      </div>
      {undoAvailable ? (
        <Button
          type="button"
          size="lg"
          variant="secondary"
          className="w-full shrink-0 sm:w-auto"
          pending={pending}
          pendingLabel="Undoing…"
          onClick={() => void undo()}
          aria-label={`Undo: ${receipt.summary}`}
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          Undo
        </Button>
      ) : null}
    </section>
  );
}
