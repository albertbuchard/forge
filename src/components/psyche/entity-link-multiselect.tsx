import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { Plus, Search, X } from "lucide-react";
import { EntityBadge } from "@/components/ui/entity-badge";
import { useAnchoredOverlayPosition } from "@/components/ui/use-anchored-overlay-position";
import type { EntityKind } from "@/lib/entity-visuals";
import { cn } from "@/lib/utils";

export type EntityLinkOption = {
  value: string;
  label: string;
  description?: string;
  searchText?: string;
  kind?: EntityKind;
  badge?: ReactNode;
  menuBadge?: ReactNode;
};

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function appendUnique(values: string[], next: string) {
  return values.includes(next) ? values : [...values, next];
}

export function EntityLinkMultiSelect({
  options,
  selectedValues,
  onChange,
  placeholder = "Search or create…",
  emptyMessage = "No matching entries yet.",
  createLabel = "Create",
  onCreate,
  className,
  variant = "default"
}: {
  options?: EntityLinkOption[];
  selectedValues?: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  emptyMessage?: string;
  createLabel?: string;
  onCreate?: (query: string) => Promise<EntityLinkOption>;
  className?: string;
  variant?: "default" | "action-bar";
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [pendingCreate, setPendingCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdOptions, setCreatedOptions] = useState<EntityLinkOption[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const safeOptions = options ?? [];
  const safeSelectedValues = selectedValues ?? [];
  const actionBarVariant = variant === "action-bar";
  const menuStyle = useAnchoredOverlayPosition(rootRef, open, {
    offset: 6,
    preferredMaxHeight: 320,
    minHeight: 160
  });

  const mergedOptions = useMemo(() => {
    const map = new Map<string, EntityLinkOption>();
    [...createdOptions, ...safeOptions].forEach((option) => {
      map.set(option.value, option);
    });
    return Array.from(map.values());
  }, [createdOptions, safeOptions]);

  const selectedOptions = useMemo(
    () =>
      safeSelectedValues.map((value) => mergedOptions.find((option) => option.value === value) ?? { value, label: value }),
    [mergedOptions, safeSelectedValues]
  );

  const normalizedQuery = normalize(query);
  const filteredOptions = useMemo(() => {
    const pool = mergedOptions.filter((option) => !safeSelectedValues.includes(option.value));
    if (!normalizedQuery) {
      return pool.slice(0, 8);
    }
    return pool
      .filter((option) => {
        const haystack = `${option.label} ${option.description ?? ""} ${option.searchText ?? ""}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .slice(0, 8);
  }, [mergedOptions, normalizedQuery, safeSelectedValues]);

  const hasExactMatch = mergedOptions.some((option) => normalize(option.label) === normalizedQuery);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selectValue = (value: string) => {
    onChange(appendUnique(safeSelectedValues, value));
    setQuery("");
    setCreateError(null);
    setHighlightedIndex(0);
    setOpen(false);
  };

  const removeValue = (value: string) => {
    onChange(safeSelectedValues.filter((entry) => entry !== value));
  };

  const createValue = async () => {
    const nextValue = query.trim();
    if (!onCreate || !nextValue) {
      return;
    }

    setPendingCreate(true);
    try {
      const option = await onCreate(nextValue);
      setCreatedOptions((current) => (current.some((entry) => entry.value === option.value) ? current : [option, ...current]));
      onChange(appendUnique(safeSelectedValues, option.value));
      setQuery("");
      setCreateError(null);
      setHighlightedIndex(0);
      setOpen(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Unable to create that link right now.");
    } finally {
      setPendingCreate(false);
    }
  };

  return (
    <div className={cn("relative grid gap-2", className)} ref={rootRef}>
      <div
        className={cn(
          "rounded-[22px] border border-white/10 bg-white/[0.04]",
          actionBarVariant
            ? "rounded-[20px] border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3.5 py-3 shadow-[inset_0_1px_0_var(--ui-border-subtle)]"
            : "px-3 py-3"
        )}
      >
        {selectedOptions.length > 0 ? (
          <div
            className={cn(
              "flex flex-wrap gap-2",
              actionBarVariant ? "mb-2.5" : "mb-2"
            )}
          >
            {selectedOptions.map((option) => (
              <span key={option.value} className="inline-flex min-w-0 max-w-full items-center gap-2">
                {option.kind ? (
                  <EntityBadge
                    kind={option.kind}
                    label={option.label}
                    compact
                    gradient={false}
                    className="max-w-[16rem]"
                  />
                ) : option.badge ? (
                  option.badge
                ) : (
                  <span
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm",
                      actionBarVariant
                        ? "border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]"
                        : "bg-white/[0.08] text-white/78"
                    )}
                  >
                    <span className="max-w-[16rem] truncate">{option.label}</span>
                  </span>
                )}
                <button
                  type="button"
                  className={cn(
                    "rounded-full transition",
                    actionBarVariant
                      ? "text-[var(--ui-ink-faint)] hover:text-[var(--ui-ink-strong)]"
                      : "text-white/50 hover:text-white"
                  )}
                  aria-label={`Remove ${option.label}`}
                  onClick={() => removeValue(option.value)}
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Search
            className={cn(
              "size-4",
              actionBarVariant
                ? "text-[var(--ui-ink-faint)]"
                : "text-white/34"
            )}
          />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCreateError(null);
              setOpen(true);
              setHighlightedIndex(0);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Backspace" && !query && safeSelectedValues.length > 0) {
                removeValue(safeSelectedValues[safeSelectedValues.length - 1]!);
                return;
              }

              if (event.key === "ArrowDown") {
                event.preventDefault();
                setOpen(true);
                setHighlightedIndex((current) => (filteredOptions.length === 0 ? 0 : Math.min(filteredOptions.length - 1, current + 1)));
                return;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlightedIndex((current) => Math.max(0, current - 1));
                return;
              }

              if (event.key === "Escape") {
                setOpen(false);
                return;
              }

              if (event.key !== "Enter") {
                return;
              }

              event.preventDefault();

              const highlighted = filteredOptions[highlightedIndex];
              if (highlighted) {
                selectValue(highlighted.value);
                return;
              }

              const exact = mergedOptions.find((option) => normalize(option.label) === normalizedQuery);
              if (exact && !safeSelectedValues.includes(exact.value)) {
                selectValue(exact.value);
                return;
              }

              void createValue();
            }}
            placeholder={placeholder}
            className={cn(
              "min-w-0 flex-1 bg-transparent text-sm focus:outline-none",
              actionBarVariant
                ? "text-[var(--ui-ink-strong)] placeholder:text-[var(--ui-ink-faint)]"
                : "text-white placeholder:text-white/34"
            )}
          />
        </div>
      </div>

      {open && menuStyle && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              aria-multiselectable="true"
              className={cn(
                "z-[80] overflow-y-auto overscroll-contain rounded-[22px] p-2 [webkit-overflow-scrolling:touch]",
                actionBarVariant
                  ? "border border-[var(--ui-border-subtle)] bg-[color-mix(in_srgb,var(--ui-surface-1)_94%,transparent)] shadow-[0_24px_56px_rgba(4,8,18,0.16)]"
                  : "border border-white/10 bg-[rgba(10,15,27,0.96)] shadow-[0_26px_60px_rgba(4,8,18,0.32)]",
                "backdrop-blur-xl"
              )}
              style={menuStyle}
            >
          {filteredOptions.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={false}
              className={cn(
                "flex w-full items-start justify-between gap-3 rounded-[18px] px-3 py-2.5 text-left transition",
                index === highlightedIndex
                  ? actionBarVariant
                    ? "bg-[var(--ui-surface-3)] text-[var(--ui-ink-strong)]"
                    : "bg-white/[0.1] text-white"
                  : actionBarVariant
                    ? "text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                    : "text-white/70 hover:bg-white/[0.06] hover:text-white"
              )}
              onMouseEnter={() => setHighlightedIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectValue(option.value)}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {option.kind ? (
                    <EntityBadge
                      kind={option.kind}
                      label={option.label}
                      compact
                      gradient={false}
                    />
                  ) : option.menuBadge ? (
                    option.menuBadge
                  ) : option.badge ? (
                    option.badge
                  ) : (
                    option.label
                  )}
                </div>
                {option.description ? (
                  <div
                    className={cn(
                      "mt-1 text-xs leading-5",
                      actionBarVariant
                        ? "text-[var(--ui-ink-soft)]"
                        : "text-white/46"
                    )}
                  >
                    {option.description}
                  </div>
                ) : null}
              </div>
            </button>
          ))}

          {!hasExactMatch && normalizedQuery && onCreate ? (
            <button
              type="button"
              disabled={pendingCreate}
              className={cn(
                "mt-1 flex w-full items-center gap-2 rounded-[18px] px-3 py-2.5 text-left text-sm transition disabled:opacity-50",
                actionBarVariant
                  ? "text-[var(--secondary)] hover:bg-[var(--ui-surface-hover)]"
                  : "text-[var(--secondary)] hover:bg-white/[0.06]"
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void createValue()}
            >
              <Plus className="size-4" />
              <span className="truncate">
                {pendingCreate ? "Creating…" : `${createLabel} "${query.trim()}"`}
              </span>
            </button>
          ) : null}

          {filteredOptions.length === 0 && (!normalizedQuery || hasExactMatch || !onCreate) ? (
            <div
              className={cn(
                "px-3 py-2.5 text-sm",
                actionBarVariant
                  ? "text-[var(--ui-ink-soft)]"
                  : "text-white/42"
              )}
            >
              {emptyMessage}
            </div>
          ) : null}
            </div>,
            document.body
          )
        : null}

      {createError ? (
        <div className="text-sm text-rose-300">{createError}</div>
      ) : null}
    </div>
  );
}
