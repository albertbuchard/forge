import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  tone = "default",
  size = "md",
  wrap = false,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: "default" | "meta" | "signal"; size?: "sm" | "md"; wrap?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-full border border-white/8 bg-white/6 font-medium text-white/78",
        wrap ? "whitespace-normal break-words [overflow-wrap:anywhere]" : "overflow-hidden text-ellipsis whitespace-nowrap",
        size === "sm" ? "min-h-7 px-2.5 py-1 text-[12px]" : "min-h-8 px-3 py-1.5 text-[12px]",
        tone === "meta" && "bg-white/[0.04] text-white/58",
        tone === "signal" && "bg-[rgba(192,193,255,0.12)] text-white/86",
        className
      )}
      {...props}
    />
  );
}
