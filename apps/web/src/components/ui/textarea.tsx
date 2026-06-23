import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      {...props}
      className={cn(
        "min-h-28 w-full rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-[15px] text-[var(--ui-ink-strong)] outline-none ring-0 placeholder:text-[var(--ui-ink-faint)] transition focus:border-[var(--primary)]/35 focus:bg-[var(--ui-surface-3)]",
        className
      )}
    />
  );
});
