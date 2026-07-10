import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";

const TOOLTIP_GUTTER_PX = 16;
const TOOLTIP_MAX_WIDTH_PX = 320;
const TOOLTIP_MIN_HEIGHT_BELOW_PX = 180;
const TOOLTIP_ESTIMATED_HEIGHT_PX = 220;

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
    <div
      className={cn("text-sm leading-6 text-[var(--ui-ink-soft)]", className)}
    >
      {children}
    </div>
  );
}

export function InfoTooltip({
  content,
  title,
  label = "Explain this field",
  className,
  panelClassName,
  maxWidthPx = TOOLTIP_MAX_WIDTH_PX
}: {
  content: ReactNode;
  title?: string;
  label?: string;
  className?: string;
  panelClassName?: string;
  maxWidthPx?: number;
}) {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const tooltipId = useId();
  const tooltipPanel =
    !open || typeof document === "undefined"
      ? null
      : createPortal(
          <span
            id={tooltipId}
            role="tooltip"
            data-state="open"
            style={panelStyle}
            className={cn(
              "pointer-events-none fixed z-[9999] grid overflow-y-auto rounded-[8px] border border-[var(--ui-border-subtle)] bg-[var(--surface-glass)] px-3 py-2.5 text-left font-sans text-sm normal-case leading-6 tracking-normal text-[var(--ui-ink-medium)] shadow-[var(--ui-shadow-floating)] backdrop-blur-xl transition",
              "translate-y-0 opacity-100",
              panelClassName
            )}
          >
            {title ? (
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ui-ink-soft)]">
                {title}
              </span>
            ) : null}
            <span className="block min-w-0 whitespace-normal break-words">
              {content}
            </span>
          </span>,
          document.body
        );

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    const positionTooltip = () => {
      const trigger = triggerRef.current;

      if (!trigger) {
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const width =
        window.innerWidth < 480
          ? window.innerWidth - TOOLTIP_GUTTER_PX * 2
          : Math.min(maxWidthPx, window.innerWidth - TOOLTIP_GUTTER_PX * 2);
      const centeredLeft = rect.left + rect.width / 2 - width / 2;
      const maxLeft = window.innerWidth - width - TOOLTIP_GUTTER_PX;
      const left = Math.max(TOOLTIP_GUTTER_PX, Math.min(centeredLeft, maxLeft));
      const availableBelow = window.innerHeight - rect.bottom;
      const top =
        availableBelow >= TOOLTIP_MIN_HEIGHT_BELOW_PX
          ? rect.bottom + 8
          : Math.max(TOOLTIP_GUTTER_PX, rect.top - TOOLTIP_ESTIMATED_HEIGHT_PX);

      setPanelStyle({
        left,
        maxHeight: `calc(100vh - ${top + TOOLTIP_GUTTER_PX}px)`,
        top,
        width
      });
    };

    positionTooltip();
    window.addEventListener("resize", positionTooltip);
    window.addEventListener("scroll", positionTooltip, true);

    return () => {
      window.removeEventListener("resize", positionTooltip);
      window.removeEventListener("scroll", positionTooltip, true);
    };
  }, [maxWidthPx, open]);

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
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        className="inline-flex size-5 items-center justify-center rounded-full text-[var(--ui-ink-faint)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-medium)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/35"
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
      {tooltipPanel}
    </span>
  );
}
