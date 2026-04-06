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
  options,
  selectedOptionIds,
  onSelectedOptionIdsChange,
  resultSummary,
  clearLabel = "Clear filters"
}: {
  title: string;
  description: string;
  query: string;
  onQueryChange: (value: string) => void;
  options: FacetedTokenOption[];
  selectedOptionIds: string[];
  onSelectedOptionIdsChange: (value: string[]) => void;
  resultSummary: string;
  clearLabel?: string;
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
    <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(135deg,rgba(19,30,42,0.92),rgba(9,15,24,0.98))] p-4 shadow-[0_30px_80px_rgba(3,8,18,0.28)] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-label text-[11px] uppercase tracking-[0.2em] text-white/42">
            {title}
          </div>
          <div className="mt-2 max-w-3xl text-sm leading-6 text-white/62">
            {description}
          </div>
        </div>
        {selectedOptionIds.length > 0 || query.trim().length > 0 ? (
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-2 text-sm text-white/62 transition hover:bg-white/[0.08] hover:text-white"
          >
            {clearLabel}
          </button>
        ) : null}
      </div>

      <div className="mt-4 rounded-[24px] border border-white/8 bg-white/[0.04] px-4 py-3">
        {selectedOptions.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {selectedOptions.map((option) => (
              <span
                key={option.id}
                className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.06] px-2.5 py-1.5"
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
          <div className="flex items-center gap-3">
            <Search className="size-4 text-white/36" />
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
                if (event.key === "Enter" && filteredOptions[highlightedIndex]) {
                  event.preventDefault();
                  addOption(filteredOptions[highlightedIndex]!.id);
                }
              }}
              placeholder="Search questionnaire title, alias, domain, source, response style, or filter chip"
              className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/34 focus:outline-none"
            />
          </div>

          {open ? (
            <div className="absolute top-full z-20 mt-2 w-full rounded-[22px] border border-white/8 bg-[rgba(8,13,24,0.96)] p-2 shadow-[0_26px_60px_rgba(4,8,18,0.32)] backdrop-blur-xl">
              {filteredOptions.length > 0 ? (
                filteredOptions.map((option, index) => (
                  <button
                    key={option.id}
                    type="button"
                    className={cn(
                      "flex w-full items-start justify-between gap-3 rounded-[18px] px-3 py-2.5 text-left transition",
                      index === highlightedIndex
                        ? "bg-white/[0.1] text-white"
                        : "text-white/70 hover:bg-white/[0.06] hover:text-white"
                    )}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => addOption(option.id)}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {option.badge ?? option.label}
                      </div>
                      {option.description ? (
                        <div className="mt-1 text-xs leading-5 text-white/46">
                          {option.description}
                        </div>
                      ) : null}
                    </div>
                  </button>
                ))
              ) : (
                <div className="px-3 py-2.5 text-sm text-white/42">
                  Keep typing to search the library or pick one of the suggested filter chips.
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 text-sm text-white/52">{resultSummary}</div>
    </div>
  );
}
