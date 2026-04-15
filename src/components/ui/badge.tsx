import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  tone = "default",
  size = "md",
  wrap = false,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: "default" | "meta" | "signal";
  size?: "xs" | "sm" | "md";
  wrap?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] font-medium text-[var(--ui-ink-medium)]",
        wrap ? "whitespace-normal break-words [overflow-wrap:anywhere]" : "overflow-hidden text-ellipsis whitespace-nowrap",
        size === "xs"
          ? "min-h-5 px-2 py-0.5 text-[10px]"
          : size === "sm"
            ? "min-h-7 px-2.5 py-1 text-[12px]"
            : "min-h-8 px-3 py-1.5 text-[12px]",
        tone === "meta" && "bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)]",
        tone === "signal" && "border-[var(--primary)]/14 bg-[var(--ui-accent-soft)] text-[var(--ui-ink-on-accent)]",
        className
      )}
      {...props}
    />
  );
}
