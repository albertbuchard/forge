import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({
  className,
  size: _size,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  size?: "md" | "lg";
}) {
  return (
    <input
      {...props}
      className={cn(
        "interactive-tap w-full rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3 text-[15px] text-[var(--ui-ink-strong)] outline-none ring-0 placeholder:text-[var(--ui-ink-faint)] transition focus:border-[var(--primary)]/35 focus:bg-[var(--ui-surface-3)]",
        className
      )}
    />
  );
}
