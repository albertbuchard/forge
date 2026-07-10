import { useEffect, useRef, type ComponentType } from "react";
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
  const menuRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    let active = false;
    const enableInteractions = window.setTimeout(() => {
      active = true;
      menuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
        ?.focus();
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (
        event.key !== "ArrowDown" &&
        event.key !== "ArrowUp" &&
        event.key !== "Home" &&
        event.key !== "End"
      ) {
        return;
      }
      const menuItems = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"]:not(:disabled)'
        ) ?? []
      );
      if (menuItems.length === 0) {
        return;
      }
      event.preventDefault();
      const currentIndex = menuItems.findIndex(
        (item) => item === document.activeElement
      );
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? menuItems.length - 1
            : event.key === "ArrowUp"
              ? (currentIndex - 1 + menuItems.length) % menuItems.length
              : (currentIndex + 1) % menuItems.length;
      menuItems[nextIndex]?.focus();
    };

    const onPointerDown = () => {
      if (!active) {
        return;
      }
      onCloseRef.current();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.clearTimeout(enableInteractions);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open || !position || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[70]" role="presentation">
      <div
        ref={menuRef}
        role="menu"
        aria-label={title}
        className="fixed z-[71] flex max-h-[min(34rem,calc(100dvh-1.5rem))] w-[min(22rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[26px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-modal)] p-2 shadow-[var(--ui-shadow-floating)] backdrop-blur-xl"
        style={{
          left: Math.min(position.x, window.innerWidth - 24 - 352),
          top: Math.min(position.y, window.innerHeight - 24 - 544)
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 rounded-[20px] bg-[var(--ui-surface-1)] px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--ui-ink-strong)]">
              {title}
            </div>
            {subtitle ? (
              <div className="mt-1 text-xs leading-5 text-[var(--ui-ink-soft)]">
                {subtitle}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Close menu"
            className="rounded-full bg-[var(--ui-surface-2)] p-2 text-[var(--ui-ink-medium)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-2 min-h-0 overflow-y-auto overscroll-contain pr-1">
          <div className="grid gap-1">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
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
                      ? "cursor-not-allowed bg-[var(--ui-surface-1)] text-[var(--ui-ink-faint)] opacity-55"
                      : item.tone === "danger"
                        ? "bg-[var(--ui-danger-soft)] text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)] hover:bg-[color-mix(in_srgb,var(--danger)_22%,var(--ui-surface-hover)_78%)]"
                        : "bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                  )}
                >
                  {Icon ? (
                    <span
                      className={cn(
                        "mt-0.5 rounded-[14px] p-2",
                        item.disabled
                          ? "bg-[var(--ui-surface-2)] text-[var(--ui-ink-faint)]"
                          : item.tone === "danger"
                            ? "bg-[color-mix(in_srgb,var(--danger)_18%,var(--ui-surface-1)_82%)] text-[color-mix(in_srgb,var(--danger)_76%,var(--ui-ink-strong)_24%)]"
                            : "bg-[var(--primary)]/12 text-[var(--primary)]"
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                  ) : null}
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {item.label}
                    </span>
                    {item.description ? (
                      <span className="mt-1 block text-xs leading-5 text-[var(--ui-ink-soft)]">
                        {item.description}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
