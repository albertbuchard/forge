import type { ButtonHTMLAttributes } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function ModalCloseButton({
  className,
  "aria-label": ariaLabel = "Close dialog",
  title = "Close",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title}
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/45",
        className
      )}
      {...props}
    >
      <X className="size-[1.05rem]" />
    </button>
  );
}
