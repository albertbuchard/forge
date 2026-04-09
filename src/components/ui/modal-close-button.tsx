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
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/72 transition hover:bg-white/[0.1] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(192,193,255,0.45)]",
        className
      )}
      {...props}
    >
      <X className="size-[1.05rem]" />
    </button>
  );
}
