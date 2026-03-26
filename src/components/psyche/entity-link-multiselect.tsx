import { useMemo, useState, type ReactNode } from "react";
import { Plus, Search, X } from "lucide-react";
import { EntityBadge } from "@/components/ui/entity-badge";
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
  className
}: {
  options: EntityLinkOption[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  emptyMessage?: string;
  createLabel?: string;
  onCreate?: (query: string) => Promise<EntityLinkOption>;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [pendingCreate, setPendingCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdOptions, setCreatedOptions] = useState<EntityLinkOption[]>([]);

  const mergedOptions = useMemo(() => {
    const map = new Map<string, EntityLinkOption>();
    [...createdOptions, ...options].forEach((option) => {
      map.set(option.value, option);
    });
    return Array.from(map.values());
  }, [createdOptions, options]);

  const selectedOptions = useMemo(
    () =>
      selectedValues.map((value) => mergedOptions.find((option) => option.value === value) ?? { value, label: value }),
    [mergedOptions, selectedValues]
  );

  const normalizedQuery = normalize(query);
  const filteredOptions = useMemo(() => {
    const pool = mergedOptions.filter((option) => !selectedValues.includes(option.value));
    if (!normalizedQuery) {
      return pool.slice(0, 8);
    }
    return pool
      .filter((option) => {
        const haystack = `${option.label} ${option.description ?? ""} ${option.searchText ?? ""}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .slice(0, 8);
  }, [mergedOptions, normalizedQuery, selectedValues]);

  const hasExactMatch = mergedOptions.some((option) => normalize(option.label) === normalizedQuery);

  const selectValue = (value: string) => {
    onChange(appendUnique(selectedValues, value));
    setQuery("");
    setCreateError(null);
    setHighlightedIndex(0);
    setOpen(false);
  };

  const removeValue = (value: string) => {
    onChange(selectedValues.filter((entry) => entry !== value));
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
      onChange(appendUnique(selectedValues, option.value));
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
    <div className={cn("relative grid gap-2", className)}>
      <div className="rounded-[22px] border border-white/10 bg-white/[0.04] px-3 py-3">
        {selectedOptions.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {selectedOptions.map((option) => (
              <span key={option.value} className="inline-flex min-w-0 max-w-full items-center gap-2">
                {option.kind ? (
                  <EntityBadge kind={option.kind} label={option.label} compact className="max-w-[16rem]" />
                ) : option.badge ? (
                  option.badge
                ) : (
                  <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-3 py-1.5 text-sm text-white/78">
                    <span className="max-w-[16rem] truncate">{option.label}</span>
                  </span>
                )}
                <button
                  type="button"
                  className="rounded-full text-white/50 transition hover:text-white"
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
          <Search className="size-4 text-white/34" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCreateError(null);
              setOpen(true);
              setHighlightedIndex(0);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              window.setTimeout(() => setOpen(false), 120);
            }}
            onKeyDown={(event) => {
              if (event.key === "Backspace" && !query && selectedValues.length > 0) {
                removeValue(selectedValues[selectedValues.length - 1]!);
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
              if (exact && !selectedValues.includes(exact.value)) {
                selectValue(exact.value);
                return;
              }

              void createValue();
            }}
            placeholder={placeholder}
            className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/34 focus:outline-none"
          />
        </div>
      </div>

      {open ? (
        <div className="absolute top-full z-20 mt-1.5 max-h-64 w-full overflow-y-auto rounded-[22px] border border-white/10 bg-[rgba(10,15,27,0.96)] p-2 shadow-[0_26px_60px_rgba(4,8,18,0.32)] backdrop-blur-xl">
          {filteredOptions.map((option, index) => (
            <button
              key={option.value}
              type="button"
              className={cn(
                "flex w-full items-start justify-between gap-3 rounded-[18px] px-3 py-2.5 text-left transition",
                index === highlightedIndex ? "bg-white/[0.1] text-white" : "text-white/70 hover:bg-white/[0.06] hover:text-white"
              )}
              onMouseEnter={() => setHighlightedIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectValue(option.value)}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {option.kind ? (
                    <EntityBadge kind={option.kind} label={option.label} compact gradient={false} />
                  ) : option.menuBadge ? (
                    option.menuBadge
                  ) : option.badge ? (
                    option.badge
                  ) : (
                    option.label
                  )}
                </div>
                {option.description ? <div className="mt-1 text-xs leading-5 text-white/46">{option.description}</div> : null}
              </div>
            </button>
          ))}

          {!hasExactMatch && normalizedQuery && onCreate ? (
            <button
              type="button"
              disabled={pendingCreate}
              className="mt-1 flex w-full items-center gap-2 rounded-[18px] px-3 py-2.5 text-left text-sm text-[var(--secondary)] transition hover:bg-white/[0.06] disabled:opacity-50"
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
            <div className="px-3 py-2.5 text-sm text-white/42">{emptyMessage}</div>
          ) : null}
        </div>
      ) : null}

      {createError ? <div className="text-sm text-rose-300">{createError}</div> : null}
    </div>
  );
}
