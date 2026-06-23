import type { Dispatch, SetStateAction } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { ModalCloseButton } from "@/components/ui/modal-close-button";

export type TaskCompletionPromptState = {
  taskId: string;
  title: string;
  status: "done";
  customMinutes: string;
  error: string | null;
};

export function TaskCompletionWorkLogDialog({
  prompt,
  setPrompt,
  onSubmit
}: {
  prompt: TaskCompletionPromptState | null;
  setPrompt: Dispatch<SetStateAction<TaskCompletionPromptState | null>>;
  onSubmit: (completedTodayWorkSeconds: number) => void;
}) {
  return (
    <Dialog.Root
      open={prompt !== null}
      onOpenChange={(open) => {
        if (!open) {
          setPrompt(null);
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-[var(--ui-overlay-backdrop)] backdrop-blur-xl" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[71] w-[min(92vw,34rem)] -translate-x-1/2 -translate-y-1/2 rounded-[28px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-modal)] p-6 shadow-[var(--ui-shadow-floating)]">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Dialog.Title className="font-display text-[1.35rem] leading-tight text-[var(--ui-ink-strong)]">
                Log today&apos;s work before closing
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm leading-6 text-[var(--ui-ink-medium)]">
                Forge closes tasks from actual time worked today, not from the
                checkbox itself. Add the time you spent on{" "}
                <span className="font-medium text-[var(--ui-ink-strong)]">
                  {prompt?.title ?? "this task"}
                </span>{" "}
                today, or confirm that you did not work on it today.
              </Dialog.Description>
            </div>
            <ModalCloseButton onClick={() => setPrompt(null)} />
          </div>

          <div className="mt-5">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
              Quick amounts
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { label: "5m", seconds: 5 * 60 },
                { label: "15m", seconds: 15 * 60 },
                { label: "30m", seconds: 30 * 60 },
                { label: "1h", seconds: 60 * 60 },
                { label: "2h", seconds: 2 * 60 * 60 }
              ].map((entry) => (
                <Button
                  key={entry.label}
                  variant="secondary"
                  onClick={() => onSubmit(entry.seconds)}
                >
                  {entry.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-3 rounded-[20px] bg-[var(--ui-surface-1)] p-4">
            <label className="grid gap-2 text-sm text-[var(--ui-ink-medium)]">
              <span className="text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-faint)]">
                Custom minutes
              </span>
              <input
                type="number"
                min={0}
                step={5}
                value={prompt?.customMinutes ?? ""}
                onChange={(event) => {
                  setPrompt((current) =>
                    current
                      ? {
                          ...current,
                          customMinutes: event.target.value,
                          error: null
                        }
                      : current
                  );
                }}
                className="h-11 rounded-[16px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 text-sm text-[var(--ui-ink-strong)] outline-none transition focus:border-[color-mix(in_srgb,var(--primary)_40%,transparent)] focus:bg-[var(--ui-surface-2)]"
                placeholder="45"
              />
            </label>
            {prompt?.error ? (
              <div className="text-sm text-[var(--danger)]">{prompt.error}</div>
            ) : null}
          </div>

          <div className="mt-5 flex flex-wrap justify-end gap-3">
            <Button variant="secondary" onClick={() => setPrompt(null)}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={() => onSubmit(0)}>
              No work today
            </Button>
            <Button
              onClick={() => {
                if (!prompt) {
                  return;
                }
                const minutes = Number(prompt.customMinutes);
                if (!Number.isFinite(minutes) || minutes < 0) {
                  setPrompt((current) =>
                    current
                      ? {
                          ...current,
                          error: "Enter a valid number of minutes."
                        }
                      : current
                  );
                  return;
                }
                onSubmit(Math.round(minutes * 60));
              }}
            >
              Close with logged time
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
