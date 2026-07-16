import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";

import {
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { describeApiError } from "@/lib/api-error";

type DeleteFlowValue = Record<string, never>;

export function PreferenceCatalogItemDeleteDialog({
  open,
  itemLabel,
  catalogTitle,
  onOpenChange,
  onConfirm
}: {
  open: boolean;
  itemLabel: string;
  catalogTitle: string;
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
      eyebrow: "Reversible concept removal",
      title: `Move "${itemLabel}" to the bin?`,
      description: `The concept will leave ${catalogTitle} and can be restored from Settings. Its Forge links and preference evidence remain attached.`,
      render: () => (
        <div className="rounded-[20px] border border-[color-mix(in_srgb,var(--danger)_24%,var(--ui-border-subtle)_76%)] bg-[var(--ui-danger-soft)] p-4 text-sm leading-6 text-[var(--ui-ink-medium)]">
          <div className="flex items-start gap-3">
            <Trash2 className="mt-0.5 size-4 shrink-0 text-[var(--danger)]" />
            <span>
              Existing scored items, judgments, signals, scores, ownership, and
              linked records are preserved.
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
      eyebrow="Concept lifecycle"
      title="Move catalog concept to bin"
      description={`Confirm reversible removal of ${itemLabel}.`}
      value={value}
      onChange={setValue}
      steps={steps}
      pending={pending}
      pendingLabel="Moving concept"
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
          setError(describeApiError(nextError).description);
        } finally {
          inFlightRef.current = false;
          setPending(false);
        }
      }}
    />
  );
}
