import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

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
  const { t } = useI18n();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgba(4,8,18,0.72)] backdrop-blur-xl" />
        <Dialog.Content className="fixed inset-x-4 bottom-4 top-4 z-50 mx-auto flex max-w-xl flex-col overflow-hidden rounded-[32px] border border-white/8 bg-[linear-gradient(180deg,rgba(20,28,42,0.98),rgba(12,17,30,0.98))] shadow-[0_32px_90px_rgba(3,8,18,0.45)]">
          <div className="border-b border-white/8 px-5 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="type-label text-white/46">{eyebrow}</div>
                <Dialog.Title className="mt-2 type-display-section text-white">{title}</Dialog.Title>
                {description ? <Dialog.Description className="mt-3 type-body text-white/64">{description}</Dialog.Description> : null}
              </div>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                {t("common.actions.close")}
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
