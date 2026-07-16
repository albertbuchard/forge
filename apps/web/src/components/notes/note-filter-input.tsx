import { useEffect, useId, useMemo, useState } from "react";
import { Search, Type, X } from "lucide-react";
import { EntityBadge } from "@/components/ui/entity-badge";
import { Badge } from "@/components/ui/badge";
import type { EntityKind } from "@/lib/entity-visuals";
import { cn } from "@/lib/utils";

const MAX_LINK_FILTERS = 24;
const MAX_TEXT_FILTERS = 12;

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

function getOptionId(listboxId: string, value: string) {
  return `${listboxId}-option-${encodeURIComponent(value)}`;
}

export function NoteFilterInput({
  entityOptions,
  selectedEntityValues,
  onSelectedEntityValuesChange,
  selectedTextTerms,
  onSelectedTextTermsChange,
  onSearchEntityOptions,
  placeholder = "Filter by linked entity or add free text"
}: {
  entityOptions: NoteFilterEntityOption[];
  selectedEntityValues: string[];
  onSelectedEntityValuesChange: (values: string[]) => void;
  selectedTextTerms: string[];
  onSelectedTextTermsChange: (values: string[]) => void;
  onSearchEntityOptions?: (query: string) => Promise<NoteFilterEntityOption[]>;
  placeholder?: string;
}) {
  const instanceId = useId();
  const comboboxId = `${instanceId}-combobox`;
  const listboxId = `${instanceId}-listbox`;
  const statusId = `${instanceId}-status`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [remoteOptions, setRemoteOptions] = useState<NoteFilterEntityOption[]>(
    []
  );
  const [searchPending, setSearchPending] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const normalizedQuery = normalize(query);
  const mergedEntityOptions = useMemo(() => {
    const options = new Map<string, NoteFilterEntityOption>();
    for (const option of [...remoteOptions, ...entityOptions]) {
      options.set(option.value, option);
    }
    return Array.from(options.values());
  }, [entityOptions, remoteOptions]);

  useEffect(() => {
    const normalized = query.trim();
    if (!open || !onSearchEntityOptions || normalized.length < 2) {
      setSearchPending(false);
      setSearchError(null);
      if (normalized.length < 2) {
        setRemoteOptions([]);
      }
      return;
    }

    let cancelled = false;
    setSearchPending(true);
    setSearchError(null);
    const timer = window.setTimeout(() => {
      void onSearchEntityOptions(normalized)
        .then((options) => {
          if (!cancelled) {
            setRemoteOptions(options);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setRemoteOptions([]);
            setSearchError(
              error instanceof Error
                ? error.message
                : "Forge could not search linked records."
            );
          }
        })
        .finally(() => {
          if (!cancelled) {
            setSearchPending(false);
          }
        });
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onSearchEntityOptions, open, query]);

  const selectedEntityOptions = useMemo(
    () =>
      selectedEntityValues
        .map((value) =>
          mergedEntityOptions.find((option) => option.value === value)
        )
        .filter(Boolean) as NoteFilterEntityOption[],
    [mergedEntityOptions, selectedEntityValues]
  );

  const filteredOptions = useMemo(() => {
    if (selectedEntityValues.length >= MAX_LINK_FILTERS) {
      return [];
    }
    const pool = mergedEntityOptions.filter(
      (option) => !selectedEntityValues.includes(option.value)
    );
    if (!normalizedQuery) {
      return pool.slice(0, 8);
    }
    return pool
      .filter((option) => {
        const haystack =
          `${option.label} ${option.description ?? ""} ${option.searchText ?? ""}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .slice(0, 8);
  }, [mergedEntityOptions, normalizedQuery, selectedEntityValues]);

  const canAddFreeText =
    query.trim().length > 0 &&
    query.trim().length <= 160 &&
    selectedTextTerms.length < MAX_TEXT_FILTERS &&
    !selectedTextTerms.includes(query.trim());
  const activeOption = open ? filteredOptions[highlightedIndex] : undefined;
  const showEmptyStatus =
    open && !searchPending && !searchError && filteredOptions.length === 0;
  const emptyStatusMessage =
    onSearchEntityOptions && normalizedQuery.length < 2
      ? "Keep typing to find a linked entity."
      : "No matching linked records found.";
  const hasSearchStatus =
    searchPending || Boolean(searchError) || showEmptyStatus;

  const addEntity = (value: string) => {
    if (selectedEntityValues.length >= MAX_LINK_FILTERS) {
      return;
    }
    onSelectedEntityValuesChange(appendUnique(selectedEntityValues, value));
    setQuery("");
    setHighlightedIndex(0);
    setOpen(false);
  };

  const addFreeText = (rawValue = query) => {
    const value = rawValue.trim();
    if (
      !value ||
      value.length > 160 ||
      selectedTextTerms.length >= MAX_TEXT_FILTERS ||
      selectedTextTerms.includes(value)
    ) {
      return;
    }
    onSelectedTextTermsChange([...selectedTextTerms, value]);
    setQuery("");
    setHighlightedIndex(0);
    setOpen(false);
  };

  const removeEntity = (value: string) => {
    onSelectedEntityValuesChange(
      selectedEntityValues.filter((entry) => entry !== value)
    );
  };

  const removeTextTerm = (value: string) => {
    onSelectedTextTermsChange(
      selectedTextTerms.filter((entry) => entry !== value)
    );
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--ui-ink-muted)]">
        <span>
          Entity chips match linked records. Free-text chips search title,
          content, author, summary, and tags.
        </span>
        <button
          type="button"
          onClick={() => addFreeText()}
          disabled={!canAddFreeText}
          className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-2.5 py-1 text-[10px] tracking-[0.14em] text-[var(--ui-ink-medium)] transition hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-ink-strong)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Free text
        </button>
      </div>

      <div className="rounded-[24px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-section)] px-4 py-3 shadow-[var(--ui-shadow-floating)]">
        {selectedEntityOptions.length > 0 || selectedTextTerms.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {selectedEntityOptions.map((option) => (
              <span
                key={option.value}
                className="inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-2.5 py-1.5"
              >
                {option.kind ? (
                  <EntityBadge
                    kind={option.kind}
                    label={option.label}
                    compact
                    gradient={false}
                    className="max-w-[16rem]"
                  />
                ) : (
                  <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
                    {option.label}
                  </Badge>
                )}
                <button
                  type="button"
                  className="rounded-full text-[var(--ui-ink-muted)] transition hover:text-[var(--ui-ink-strong)]"
                  onClick={() => removeEntity(option.value)}
                  aria-label={`Remove ${option.label}`}
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))}

            {selectedTextTerms.map((term) => (
              <span
                key={term}
                className="inline-flex max-w-full items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--info)_24%,transparent)] bg-[var(--ui-info-soft)] px-2.5 py-1.5 text-sm text-[color-mix(in_srgb,var(--info)_78%,var(--ui-ink-strong)_22%)]"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Type className="size-3.5" />
                  <span className="max-w-[16rem] truncate">{term}</span>
                </span>
                <button
                  type="button"
                  className="rounded-full text-[color-mix(in_srgb,var(--info)_70%,var(--ui-ink-strong)_30%)] transition hover:text-[var(--ui-ink-strong)]"
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
          <div className="mb-3 text-xs text-[var(--ui-ink-muted)]">
            Free-text chips are combined with OR.
          </div>
        ) : null}

        <div className="relative">
          <div className="flex items-center gap-3">
            <Search className="size-4 text-[var(--ui-ink-muted)]" />
            <input
              id={comboboxId}
              role="combobox"
              aria-label={placeholder}
              aria-autocomplete="list"
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-activedescendant={
                activeOption
                  ? getOptionId(listboxId, activeOption.value)
                  : undefined
              }
              aria-describedby={hasSearchStatus ? statusId : undefined}
              value={query}
              maxLength={160}
              onChange={(event) => {
                setQuery(event.target.value);
                setOpen(true);
                setHighlightedIndex(0);
              }}
              onFocus={() => {
                setOpen(true);
                setHighlightedIndex((current) =>
                  filteredOptions.length === 0 ? 0 : Math.max(0, current)
                );
              }}
              onBlur={() => {
                window.setTimeout(() => setOpen(false), 120);
              }}
              onKeyDown={(event) => {
                if (event.key === "Backspace" && !query) {
                  if (selectedTextTerms.length > 0) {
                    removeTextTerm(
                      selectedTextTerms[selectedTextTerms.length - 1]!
                    );
                    return;
                  }
                  if (selectedEntityValues.length > 0) {
                    removeEntity(
                      selectedEntityValues[selectedEntityValues.length - 1]!
                    );
                  }
                  return;
                }

                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  if (!open) {
                    setOpen(true);
                    setHighlightedIndex(0);
                    return;
                  }
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
                  if (!open) {
                    setOpen(true);
                    setHighlightedIndex(
                      Math.max(0, filteredOptions.length - 1)
                    );
                    return;
                  }
                  setHighlightedIndex((current) => Math.max(0, current - 1));
                  return;
                }

                if (
                  event.key === "Home" &&
                  open &&
                  filteredOptions.length > 0
                ) {
                  event.preventDefault();
                  setHighlightedIndex(0);
                  return;
                }

                if (event.key === "End" && open && filteredOptions.length > 0) {
                  event.preventDefault();
                  setHighlightedIndex(filteredOptions.length - 1);
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
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ui-ink-strong)] placeholder:text-[var(--ui-ink-muted)] focus:outline-none"
            />
          </div>

          {open ? (
            <div className="absolute top-full z-20 mt-2 w-full rounded-[22px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-modal)] p-2 shadow-[var(--ui-shadow-floating)] backdrop-blur-xl">
              <div
                id={listboxId}
                role="listbox"
                aria-label={`${placeholder} results`}
                aria-multiselectable="true"
                aria-busy={searchPending}
              >
                {filteredOptions.map((option, index) => (
                  <button
                    key={option.value}
                    id={getOptionId(listboxId, option.value)}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className={cn(
                      "flex w-full items-start justify-between gap-3 rounded-[18px] px-3 py-2.5 text-left transition",
                      index === highlightedIndex
                        ? "bg-[var(--ui-surface-2)] text-[var(--ui-ink-strong)]"
                        : "text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-ink-strong)]"
                    )}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => addEntity(option.value)}
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
                        ) : (
                          option.label
                        )}
                      </div>
                      {option.description ? (
                        <div className="mt-1 text-xs leading-5 text-[var(--ui-ink-muted)]">
                          {option.description}
                        </div>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>

              {canAddFreeText ? (
                <button
                  type="button"
                  className="mt-1 flex w-full items-center gap-2 rounded-[18px] px-3 py-2.5 text-left text-sm text-[color-mix(in_srgb,var(--info)_78%,var(--ui-ink-strong)_22%)] transition hover:bg-[var(--ui-surface-2)]"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addFreeText()}
                >
                  <Type className="size-4" />
                  <span className="truncate">
                    Add free text &quot;{query.trim()}&quot;
                  </span>
                </button>
              ) : null}

              {searchPending ? (
                <div
                  id={statusId}
                  role="status"
                  aria-live="polite"
                  className="px-3 py-2.5 text-sm text-[var(--ui-ink-muted)]"
                >
                  Searching linked records…
                </div>
              ) : null}

              {searchError ? (
                <div
                  id={statusId}
                  role="alert"
                  className="px-3 py-2.5 text-sm text-[var(--danger)]"
                >
                  {searchError}
                </div>
              ) : null}

              {showEmptyStatus ? (
                <div
                  id={statusId}
                  role="status"
                  aria-live="polite"
                  className="px-3 py-2.5 text-sm text-[var(--ui-ink-muted)]"
                >
                  {emptyStatusMessage}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
