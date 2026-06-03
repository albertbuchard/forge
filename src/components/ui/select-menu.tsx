import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SelectMenuOption<TValue extends string> = {
  value: TValue;
  label: string;
  description?: string;
};

export function SelectMenu<TValue extends string>({
  label,
  value,
  options,
  onChange,
  className,
  triggerClassName,
  menuClassName
}: {
  label: string;
  value: TValue;
  options: SelectMenuOption<TValue>[];
  onChange: (value: TValue) => void;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listboxId = useId();

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? options[0],
    [options, value]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={cn("relative min-w-0 max-w-full", className)} ref={rootRef}>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
        {label}
      </div>
      <button
        ref={buttonRef}
        type="button"
        className={cn(
          "flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-2.5 text-left shadow-[var(--ui-shadow-soft)] transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_45%,transparent)] sm:min-w-[15rem]",
          triggerClassName
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[var(--ui-ink-strong)]">
            {selectedOption?.label ?? value}
          </div>
          {selectedOption?.description ? (
            <div className="truncate text-xs text-[var(--ui-ink-faint)]">
              {selectedOption.description}
            </div>
          ) : null}
        </div>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-[var(--ui-ink-faint)] transition",
            open && "rotate-180 text-[var(--ui-ink-medium)]"
          )}
        />
      </button>

      {open ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={label}
          className={cn(
            "absolute left-0 top-[calc(100%+0.6rem)] z-30 w-full overflow-hidden rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-modal)] p-2 shadow-[var(--ui-shadow-floating)] backdrop-blur-xl",
            menuClassName
          )}
        >
          <div className="grid gap-1">
            {options.map((option) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={cn(
                    "flex w-full items-start justify-between gap-3 rounded-[16px] px-3 py-2.5 text-left transition",
                    selected
                      ? "bg-[var(--ui-surface-active)] text-[var(--ui-ink-strong)]"
                      : "text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                  )}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{option.label}</div>
                    {option.description ? (
                      <div className="mt-0.5 text-xs text-[var(--ui-ink-faint)]">
                        {option.description}
                      </div>
                    ) : null}
                  </div>
                  <Check
                    className={cn(
                      "mt-0.5 size-4 shrink-0 transition",
                      selected ? "text-[var(--ui-ink-strong)]" : "opacity-0"
                    )}
                  />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
