import { useMemo, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type FacetedTokenOption = {
  id: string;
  label: string;
  description?: string;
  searchText?: string;
  badge?: ReactNode;
};

function normalize(text: string) {
  return text.trim().toLowerCase();
}

export function FacetedTokenSearch({
  title,
  description,
  query,
  onQueryChange,
  onQuerySubmit,
  options,
  selectedOptionIds,
  onSelectedOptionIdsChange,
  resultSummary,
  clearLabel = "Clear filters",
  submitLabel = "Search",
  placeholder = "Search title, alias, domain, source, or filter chip",
  emptyStateMessage = "Keep typing to search the library or pick one of the suggested filter chips.",
  compact = false,
  minimal = false,
  hideSummary = false
}: {
  title: string;
  description: string;
  query: string;
  onQueryChange: (value: string) => void;
  onQuerySubmit?: (value: string) => void;
  options: FacetedTokenOption[];
  selectedOptionIds: string[];
  onSelectedOptionIdsChange: (value: string[]) => void;
  resultSummary: string;
  clearLabel?: string;
  submitLabel?: string;
  placeholder?: string;
  emptyStateMessage?: string;
  compact?: boolean;
  minimal?: boolean;
  hideSummary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const selectedOptions = useMemo(
    () =>
      selectedOptionIds
        .map((id) => options.find((option) => option.id === id))
        .filter(Boolean) as FacetedTokenOption[],
    [options, selectedOptionIds]
  );

  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalize(query);
    const pool = options.filter((option) => !selectedOptionIds.includes(option.id));
    if (!normalizedQuery) {
      return pool.slice(0, 12);
    }
    return pool
      .filter((option) =>
        `${option.label} ${option.description ?? ""} ${option.searchText ?? ""}`
          .toLowerCase()
          .includes(normalizedQuery)
      )
      .slice(0, 12);
  }, [options, query, selectedOptionIds]);

  const addOption = (optionId: string) => {
    if (selectedOptionIds.includes(optionId)) {
      return;
    }
    onSelectedOptionIdsChange([...selectedOptionIds, optionId]);
    onQueryChange("");
    setOpen(false);
    setHighlightedIndex(0);
  };

  const removeOption = (optionId: string) => {
    onSelectedOptionIdsChange(selectedOptionIds.filter((id) => id !== optionId));
  };

  const clearFilters = () => {
    onQueryChange("");
    onSelectedOptionIdsChange([]);
    setHighlightedIndex(0);
    setOpen(false);
  };

  return (
    <div
      className={cn(
        "rounded-[28px] border border-white/8 bg-[linear-gradient(135deg,rgba(19,30,42,0.92),rgba(9,15,24,0.98))] shadow-[0_30px_80px_rgba(3,8,18,0.28)]",
        minimal
          ? "overflow-hidden rounded-full border-white/10 bg-[rgba(8,12,20,0.82)] px-3 py-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.26)] backdrop-blur"
          : compact
            ? "rounded-[24px] p-2.5"
            : "p-4 sm:p-5"
      )}
    >
      <div className={cn("flex flex-wrap items-start justify-between gap-3", minimal && "hidden")}>
        <div>
          {title.trim().length > 0 ? (
            <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/42">
              {title}
            </div>
          ) : null}
          {description.trim().length > 0 ? (
            <div className="mt-2 max-w-3xl text-sm leading-6 text-white/62">
              {description}
            </div>
          ) : null}
        </div>
        {selectedOptionIds.length > 0 || query.trim().length > 0 ? (
          <button
            type="button"
            onClick={clearFilters}
            className={cn(
              "rounded-full border border-white/8 bg-white/[0.04] text-white/62 transition hover:bg-white/[0.08] hover:text-white",
              compact ? "px-2.5 py-1.5 text-[11px]" : "px-3 py-2 text-sm"
            )}
          >
            {clearLabel}
          </button>
        ) : null}
      </div>

      <div
        className={cn(
          "rounded-[24px] border border-white/8 bg-white/[0.04]",
          minimal
            ? "rounded-full border-0 bg-transparent px-0 py-0"
            : compact
              ? "mt-1.5 rounded-[18px] px-2.5 py-2"
              : "mt-4 px-4 py-3"
        )}
      >
        {selectedOptions.length > 0 ? (
          <div className={cn("flex flex-wrap gap-2", minimal ? "mb-0 mr-2 inline-flex max-w-[38%] flex-nowrap items-center gap-1 overflow-hidden" : compact ? "mb-2" : "mb-3")}>
            {selectedOptions.map((option) => (
              <span
                key={option.id}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.06]",
                  minimal ? "max-w-full shrink-0 border-white/10 bg-white/[0.08] px-2 py-0.5" : compact ? "px-2 py-0.5" : "px-2.5 py-1.5"
                )}
              >
                {option.badge ?? (
                  <span className="text-sm text-white/78">{option.label}</span>
                )}
                <button
                  type="button"
                  className="rounded-full text-white/52 transition hover:text-white"
                  onClick={() => removeOption(option.id)}
                  aria-label={`Remove ${option.label}`}
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="relative">
              <div className={cn("flex items-center", minimal ? "gap-2 whitespace-nowrap" : compact ? "gap-2" : "gap-3")}>
                <Search className={cn("text-white/36", compact ? "size-3.5" : "size-4")} />
                <input
              value={query}
              onChange={(event) => {
                onQueryChange(event.target.value);
                setOpen(true);
                setHighlightedIndex(0);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => window.setTimeout(() => setOpen(false), 120)}
              onKeyDown={(event) => {
                if (event.key === "Backspace" && !query && selectedOptionIds.length > 0) {
                  removeOption(selectedOptionIds[selectedOptionIds.length - 1]!);
                  return;
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setOpen(true);
                  setHighlightedIndex((current) =>
                    filteredOptions.length === 0
                      ? 0
                      : Math.min(filteredOptions.length - 1, current + 1)
                  );
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
                if (event.key === "Enter" && onQuerySubmit) {
                  event.preventDefault();
                  onQuerySubmit(query);
                  setOpen(false);
                  return;
                }
                if (event.key === "Enter" && filteredOptions[highlightedIndex]) {
                  event.preventDefault();
                  addOption(filteredOptions[highlightedIndex]!.id);
                }
              }}
              placeholder={placeholder}
                  className={cn(
                    "min-w-0 flex-1 bg-transparent text-white placeholder:text-white/34 focus:outline-none",
                    minimal ? "text-[12px]" : compact ? "text-[12px]" : "text-sm"
                  )}
                />
                {minimal && (selectedOptionIds.length > 0 || query.trim().length > 0) ? (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="inline-flex size-6 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/62 transition hover:text-white"
                    aria-label={clearLabel}
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
                {onQuerySubmit ? (
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onQuerySubmit(query);
                      setOpen(false);
                    }}
                    className={cn(
                      "inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.08] text-white/72 transition hover:bg-white/[0.14] hover:text-white",
                      minimal ? "size-6" : compact ? "size-7" : "size-8"
                    )}
                    aria-label={submitLabel}
                    title={submitLabel}
                  >
                    <Search className={cn(compact ? "size-3.5" : "size-4")} />
                  </button>
                ) : null}
              </div>

          {open ? (
            <div className={cn(
              "absolute top-full z-20 w-full border border-white/8 bg-[rgba(8,13,24,0.96)] shadow-[0_26px_60px_rgba(4,8,18,0.32)] backdrop-blur-xl",
              compact ? "mt-1.5 rounded-[18px] p-1.5" : "mt-2 rounded-[22px] p-2"
            )}>
              {filteredOptions.length > 0 ? (
                filteredOptions.map((option, index) => (
                  <button
                    key={option.id}
                    type="button"
                    className={cn(
                      "flex w-full items-start justify-between gap-3 text-left transition",
                      compact ? "rounded-[14px] px-2.5 py-2" : "rounded-[18px] px-3 py-2.5",
                      index === highlightedIndex
                        ? "bg-white/[0.1] text-white"
                        : "text-white/70 hover:bg-white/[0.06] hover:text-white"
                    )}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => addOption(option.id)}
                  >
                    <div className="min-w-0">
                      <div className={cn("truncate font-medium", compact ? "text-[12px]" : "text-sm")}>
                        {option.badge ?? option.label}
                      </div>
                      {option.description ? (
                        <div className={cn("mt-1 text-white/46", compact ? "text-[11px] leading-[1.125rem]" : "text-xs leading-5")}>
                          {option.description}
                        </div>
                      ) : null}
                    </div>
                  </button>
                ))
              ) : (
                <div className={cn("text-white/42", compact ? "px-2.5 py-2 text-[12px]" : "px-3 py-2.5 text-sm")}>
                  {emptyStateMessage}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {!hideSummary ? (
        <div className={cn("text-white/52", compact ? "mt-2 text-xs" : "mt-3 text-sm")}>
          {resultSummary}
        </div>
      ) : null}
    </div>
  );
}
