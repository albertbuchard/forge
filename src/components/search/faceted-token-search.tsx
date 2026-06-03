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
        "rounded-[28px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-section)] shadow-[var(--card-shadow)]",
        minimal
          ? "overflow-hidden rounded-full border-[var(--ui-border-subtle)] bg-[color-mix(in_srgb,var(--ui-surface-1)_88%,transparent)] px-3 py-1.5 shadow-[var(--ui-shadow-soft)] backdrop-blur"
          : compact
            ? "rounded-[24px] p-2.5"
            : "p-4 sm:p-5"
      )}
    >
      <div className={cn("flex flex-wrap items-start justify-between gap-3", minimal && "hidden")}>
        <div className="min-w-0">
          {title.trim().length > 0 ? (
            <div className="break-words font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-faint)] [overflow-wrap:anywhere]">
              {title}
            </div>
          ) : null}
          {description.trim().length > 0 ? (
            <div className="mt-2 max-w-3xl break-words text-sm leading-6 text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
              {description}
            </div>
          ) : null}
        </div>
        {selectedOptionIds.length > 0 || query.trim().length > 0 ? (
          <button
            type="button"
            onClick={clearFilters}
            className={cn(
              "rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]",
              compact ? "px-2.5 py-1.5 text-[11px]" : "px-3 py-2 text-sm"
            )}
          >
            {clearLabel}
          </button>
        ) : null}
      </div>

      <div
        className={cn(
          "rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]",
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
                  "inline-flex min-w-0 items-center gap-2 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)]",
                  minimal ? "max-w-full shrink-0 px-2 py-0.5" : compact ? "px-2 py-0.5" : "px-2.5 py-1.5"
                )}
              >
                {option.badge ?? (
                  <span className="min-w-0 break-words text-sm text-[var(--ui-ink-medium)] [overflow-wrap:anywhere]">{option.label}</span>
                )}
                <button
                  type="button"
                  className="shrink-0 rounded-full text-[var(--ui-ink-faint)] transition hover:text-[var(--ui-ink-strong)]"
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
                <Search className={cn("text-[var(--ui-ink-faint)]", compact ? "size-3.5" : "size-4")} />
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
                    "min-w-0 flex-1 bg-transparent text-[var(--ui-ink-strong)] placeholder:text-[var(--ui-ink-faint)] focus:outline-none",
                    minimal ? "text-[12px]" : compact ? "text-[12px]" : "text-sm"
                  )}
                />
                {minimal && (selectedOptionIds.length > 0 || query.trim().length > 0) ? (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="inline-flex size-6 items-center justify-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)] transition hover:text-[var(--ui-ink-strong)]"
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
                      "inline-flex items-center justify-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]",
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
              "absolute top-full z-20 w-full border border-[var(--ui-border-subtle)] bg-[color-mix(in_srgb,var(--ui-surface-1)_96%,transparent)] shadow-[var(--ui-shadow-floating)] backdrop-blur-xl",
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
                        ? "bg-[var(--ui-surface-3)] text-[var(--ui-ink-strong)]"
                        : "text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                    )}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => addOption(option.id)}
                  >
                    <div className="min-w-0">
                      <div className={cn("break-words font-medium [overflow-wrap:anywhere]", compact ? "text-[12px]" : "text-sm")}>
                        {option.badge ?? option.label}
                      </div>
                      {option.description ? (
                        <div className={cn("mt-1 break-words text-[var(--ui-ink-faint)] [overflow-wrap:anywhere]", compact ? "text-[11px] leading-[1.125rem]" : "text-xs leading-5")}>
                          {option.description}
                        </div>
                      ) : null}
                    </div>
                  </button>
                ))
              ) : (
                <div className={cn("break-words text-[var(--ui-ink-faint)] [overflow-wrap:anywhere]", compact ? "px-2.5 py-2 text-[12px]" : "px-3 py-2.5 text-sm")}>
                  {emptyStateMessage}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {!hideSummary ? (
        <div className={cn("break-words text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]", compact ? "mt-2 text-xs" : "mt-3 text-sm")}>
          {resultSummary}
        </div>
      ) : null}
    </div>
  );
}
