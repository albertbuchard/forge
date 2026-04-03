import { useMemo, useState } from "react";
import { Search, Type, X } from "lucide-react";
import { EntityBadge } from "@/components/ui/entity-badge";
import { Badge } from "@/components/ui/badge";
import type { EntityKind } from "@/lib/entity-visuals";
import { cn } from "@/lib/utils";

export type NoteFilterEntityOption = {
  value: string;
  label: string;
  entityType: string;
  entityId: string;
  description?: string;
  searchText?: string;
  kind?: EntityKind;
};

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function appendUnique(values: string[], next: string) {
  return values.includes(next) ? values : [...values, next];
}

export function NoteFilterInput({
  entityOptions,
  selectedEntityValues,
  onSelectedEntityValuesChange,
  selectedTextTerms,
  onSelectedTextTermsChange,
  placeholder = "Filter by linked entity or add free text"
}: {
  entityOptions: NoteFilterEntityOption[];
  selectedEntityValues: string[];
  onSelectedEntityValuesChange: (values: string[]) => void;
  selectedTextTerms: string[];
  onSelectedTextTermsChange: (values: string[]) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const normalizedQuery = normalize(query);

  const selectedEntityOptions = useMemo(
    () =>
      selectedEntityValues
        .map((value) => entityOptions.find((option) => option.value === value))
        .filter(Boolean) as NoteFilterEntityOption[],
    [entityOptions, selectedEntityValues]
  );

  const filteredOptions = useMemo(() => {
    const pool = entityOptions.filter((option) => !selectedEntityValues.includes(option.value));
    if (!normalizedQuery) {
      return pool.slice(0, 8);
    }
    return pool
      .filter((option) => {
        const haystack = `${option.label} ${option.description ?? ""} ${option.searchText ?? ""}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .slice(0, 8);
  }, [entityOptions, normalizedQuery, selectedEntityValues]);

  const canAddFreeText = query.trim().length > 0 && !selectedTextTerms.includes(query.trim());

  const addEntity = (value: string) => {
    onSelectedEntityValuesChange(appendUnique(selectedEntityValues, value));
    setQuery("");
    setHighlightedIndex(0);
    setOpen(false);
  };

  const addFreeText = (rawValue = query) => {
    const value = rawValue.trim();
    if (!value || selectedTextTerms.includes(value)) {
      return;
    }
    onSelectedTextTermsChange([...selectedTextTerms, value]);
    setQuery("");
    setHighlightedIndex(0);
    setOpen(false);
  };

  const removeEntity = (value: string) => {
    onSelectedEntityValuesChange(selectedEntityValues.filter((entry) => entry !== value));
  };

  const removeTextTerm = (value: string) => {
    onSelectedTextTermsChange(selectedTextTerms.filter((entry) => entry !== value));
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] uppercase tracking-[0.16em] text-white/40">
        <span>Search hints: entity chips match linked records, free-text chips match note body or author.</span>
        <button
          type="button"
          onClick={() => addFreeText()}
          disabled={!canAddFreeText}
          className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-[10px] tracking-[0.14em] text-white/62 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Free text
        </button>
      </div>

      <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(135deg,rgba(19,28,48,0.88),rgba(10,14,26,0.98))] px-4 py-3 shadow-[0_24px_70px_rgba(3,8,18,0.2)]">
        {selectedEntityOptions.length > 0 || selectedTextTerms.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {selectedEntityOptions.map((option) => (
              <span key={option.value} className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/8 bg-white/[0.06] px-2.5 py-1.5">
                {option.kind ? (
                  <EntityBadge kind={option.kind} label={option.label} compact gradient={false} className="max-w-[16rem]" />
                ) : (
                  <Badge className="bg-white/[0.08] text-white/78">{option.label}</Badge>
                )}
                <button
                  type="button"
                  className="rounded-full text-white/50 transition hover:text-white"
                  onClick={() => removeEntity(option.value)}
                  aria-label={`Remove ${option.label}`}
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))}

            {selectedTextTerms.map((term) => (
              <span key={term} className="inline-flex max-w-full items-center gap-2 rounded-full border border-cyan-300/16 bg-cyan-400/10 px-2.5 py-1.5 text-sm text-cyan-50">
                <span className="inline-flex items-center gap-1.5">
                  <Type className="size-3.5" />
                  <span className="max-w-[16rem] truncate">{term}</span>
                </span>
                <button
                  type="button"
                  className="rounded-full text-cyan-100/70 transition hover:text-white"
                  onClick={() => removeTextTerm(term)}
                  aria-label={`Remove free-text filter ${term}`}
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {selectedTextTerms.length > 1 ? (
          <div className="mb-3 text-xs text-white/42">Free-text chips are combined with OR.</div>
        ) : null}

        <div className="relative">
          <div className="flex items-center gap-3">
            <Search className="size-4 text-white/34" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setOpen(true);
                setHighlightedIndex(0);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => {
                window.setTimeout(() => setOpen(false), 120);
              }}
              onKeyDown={(event) => {
                if (event.key === "Backspace" && !query) {
                  if (selectedTextTerms.length > 0) {
                    removeTextTerm(selectedTextTerms[selectedTextTerms.length - 1]!);
                    return;
                  }
                  if (selectedEntityValues.length > 0) {
                    removeEntity(selectedEntityValues[selectedEntityValues.length - 1]!);
                  }
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
                  addEntity(highlighted.value);
                  return;
                }
                addFreeText();
              }}
              placeholder={placeholder}
              className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/34 focus:outline-none"
            />
          </div>

          {open ? (
            <div className="absolute top-full z-20 mt-2 w-full rounded-[22px] border border-white/8 bg-[rgba(8,13,24,0.96)] p-2 shadow-[0_26px_60px_rgba(4,8,18,0.32)] backdrop-blur-xl">
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
                  onClick={() => addEntity(option.value)}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {option.kind ? (
                        <EntityBadge kind={option.kind} label={option.label} compact gradient={false} />
                      ) : (
                        option.label
                      )}
                    </div>
                    {option.description ? <div className="mt-1 text-xs leading-5 text-white/46">{option.description}</div> : null}
                  </div>
                </button>
              ))}

              {canAddFreeText ? (
                <button
                  type="button"
                  className="mt-1 flex w-full items-center gap-2 rounded-[18px] px-3 py-2.5 text-left text-sm text-cyan-100 transition hover:bg-white/[0.06]"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addFreeText()}
                >
                  <Type className="size-4" />
                  <span className="truncate">Add free text &quot;{query.trim()}&quot;</span>
                </button>
              ) : null}

              {filteredOptions.length === 0 && !canAddFreeText ? (
                <div className="px-3 py-2.5 text-sm text-white/42">
                  Keep typing to find a linked entity, or press Enter to add a free-text badge.
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
