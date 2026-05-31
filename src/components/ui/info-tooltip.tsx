import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";

export type FieldHelpDefinition = {
  label?: string;
  description: string;
};

export function FieldHint({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("text-sm leading-6 text-white/50", className)}>
      {children}
    </div>
  );
}

export function InfoTooltip({
  content,
  title,
  label = "Explain this field",
  className,
  panelClassName
}: {
  content: ReactNode;
  title?: string;
  label?: string;
  className?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const tooltipId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <span
      ref={containerRef}
      className={cn("relative inline-flex items-center", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        className="inline-flex size-5 items-center justify-center rounded-full text-white/42 transition hover:bg-white/[0.06] hover:text-white/78 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(192,193,255,0.35)]"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      >
        <CircleHelp className="size-3.5" />
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        aria-hidden={!open}
        data-state={open ? "open" : "closed"}
        className={cn(
          "pointer-events-none absolute right-0 top-[calc(100%+0.55rem)] z-40 grid w-[min(20rem,calc(100vw-2.5rem))] max-w-[calc(100vw-2.5rem)] gap-1 rounded-[8px] border border-white/10 bg-[rgba(12,17,30,0.97)] px-3 py-2.5 text-left text-sm leading-6 text-white/74 shadow-[0_18px_48px_rgba(3,8,18,0.42)] transition",
          open ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
          panelClassName
        )}
      >
        {title ? (
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/58">
            {title}
          </span>
        ) : null}
        <span>{content}</span>
      </span>
    </span>
  );
}
