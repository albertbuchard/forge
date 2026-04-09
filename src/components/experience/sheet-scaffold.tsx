import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { ModalCloseButton } from "@/components/ui/modal-close-button";

export function SheetScaffold({
  open,
  onOpenChange,
  eyebrow,
  title,
  description,
  children
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="surface-overlay fixed inset-0 z-40 backdrop-blur-xl" />
        <Dialog.Content className="surface-modal-panel fixed inset-x-4 bottom-4 top-4 z-50 mx-auto flex max-w-xl flex-col overflow-hidden rounded-[32px] border">
          <div className="border-b border-[var(--ui-border-subtle)] px-5 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="type-label text-[var(--ui-ink-faint)]">{eyebrow}</div>
                <Dialog.Title className="mt-2 type-display-section text-[var(--ui-ink-strong)]">{title}</Dialog.Title>
                {description ? <Dialog.Description className="mt-3 type-body text-[var(--ui-ink-soft)]">{description}</Dialog.Description> : null}
              </div>
              <Dialog.Close asChild>
                <ModalCloseButton />
              </Dialog.Close>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
