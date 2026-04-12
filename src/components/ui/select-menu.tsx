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
    <div className={cn("relative", className)} ref={rootRef}>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-white/42">
        {label}
      </div>
      <button
        ref={buttonRef}
        type="button"
        className={cn(
          "flex min-h-11 w-full min-w-[15rem] items-center justify-between gap-3 rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] px-4 py-2.5 text-left shadow-[0_16px_32px_rgba(15,23,42,0.18)] transition hover:border-white/14 hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.11),rgba(255,255,255,0.05))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(192,193,255,0.45)]",
          triggerClassName
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-white">
            {selectedOption?.label ?? value}
          </div>
          {selectedOption?.description ? (
            <div className="truncate text-xs text-white/48">
              {selectedOption.description}
            </div>
          ) : null}
        </div>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-white/48 transition",
            open && "rotate-180 text-white/72"
          )}
        />
      </button>

      {open ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={label}
          className={cn(
            "absolute left-0 top-[calc(100%+0.6rem)] z-30 w-full overflow-hidden rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(20,28,42,0.98),rgba(12,17,30,0.98))] p-2 shadow-[0_28px_64px_rgba(3,8,18,0.42)] backdrop-blur-xl",
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
                      ? "bg-[rgba(192,193,255,0.14)] text-white"
                      : "text-white/74 hover:bg-white/[0.06] hover:text-white"
                  )}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{option.label}</div>
                    {option.description ? (
                      <div className="mt-0.5 text-xs text-white/44">
                        {option.description}
                      </div>
                    ) : null}
                  </div>
                  <Check
                    className={cn(
                      "mt-0.5 size-4 shrink-0 transition",
                      selected ? "text-white" : "opacity-0"
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
