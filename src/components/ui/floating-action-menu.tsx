import { useEffect, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type FloatingActionMenuItem = {
  id: string;
  label: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  disabled?: boolean;
  tone?: "default" | "danger";
  onSelect: () => void;
};

export function FloatingActionMenu({
  open,
  title,
  subtitle,
  items,
  position,
  onClose
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  items: FloatingActionMenuItem[];
  position: { x: number; y: number } | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }

    let active = false;
    const enableInteractions = window.setTimeout(() => {
      active = true;
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const onPointerDown = () => {
      if (!active) {
        return;
      }
      onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.clearTimeout(enableInteractions);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose, open]);

  if (!open || !position || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70]"
      aria-hidden="true"
    >
      <div
        className="fixed z-[71] w-[min(22rem,calc(100vw-1.5rem))] rounded-[26px] border border-white/10 bg-[rgba(10,15,27,0.97)] p-2 shadow-[0_28px_80px_rgba(4,8,18,0.4)] backdrop-blur-xl"
        style={{
          left: Math.min(position.x, window.innerWidth - 24 - 352),
          top: Math.min(position.y, window.innerHeight - 24 - 320)
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 rounded-[20px] bg-white/[0.03] px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-white">{title}</div>
            {subtitle ? <div className="mt-1 text-xs leading-5 text-white/50">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            className="rounded-full bg-white/[0.04] p-2 text-white/55 transition hover:bg-white/[0.08] hover:text-white"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-2 grid gap-1">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) {
                    return;
                  }
                  item.onSelect();
                  onClose();
                }}
                className={cn(
                  "flex w-full items-start gap-3 rounded-[20px] px-4 py-3 text-left transition",
                  item.disabled
                    ? "cursor-not-allowed bg-white/[0.02] text-white/28"
                    : item.tone === "danger"
                      ? "bg-rose-400/[0.05] text-rose-100 hover:bg-rose-400/[0.12]"
                      : "bg-white/[0.03] text-white/76 hover:bg-white/[0.08] hover:text-white"
                )}
              >
                {Icon ? (
                  <span
                    className={cn(
                      "mt-0.5 rounded-[14px] p-2",
                      item.disabled
                        ? "bg-white/[0.03] text-white/28"
                        : item.tone === "danger"
                          ? "bg-rose-400/[0.12] text-rose-100"
                          : "bg-[var(--primary)]/12 text-[var(--primary)]"
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                ) : null}
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{item.label}</span>
                  {item.description ? (
                    <span className="mt-1 block text-xs leading-5 text-white/48">
                      {item.description}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}
