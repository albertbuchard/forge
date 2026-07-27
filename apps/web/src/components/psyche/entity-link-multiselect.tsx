import {
  useEffect,
  useId,
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

const MAX_VISIBLE_OPTIONS = 50;

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

function getOptionId(listboxId: string, value: string) {
  return `${listboxId}-option-${encodeURIComponent(value)}`;
}

export function EntityLinkMultiSelect({
  options,
  selectedValues,
  onChange,
  placeholder = "Search or create…",
  emptyMessage = "No matching entries yet.",
  createLabel = "Create",
  onCreate,
  onSearch,
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
  onSearch?: (query: string) => Promise<EntityLinkOption[]>;
  className?: string;
  variant?: "default" | "action-bar";
}) {
  const instanceId = useId();
  const comboboxId = `${instanceId}-combobox`;
  const listboxId = `${instanceId}-listbox`;
  const statusId = `${instanceId}-status`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [pendingCreate, setPendingCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdOptions, setCreatedOptions] = useState<EntityLinkOption[]>([]);
  const [remoteOptions, setRemoteOptions] = useState<EntityLinkOption[]>([]);
  const [searchPending, setSearchPending] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const safeOptions = useMemo(() => options ?? [], [options]);
  const safeSelectedValues = useMemo(
    () => selectedValues ?? [],
    [selectedValues]
  );
  const actionBarVariant = variant === "action-bar";
  const menuStyle = useAnchoredOverlayPosition(rootRef, open, {
    offset: 6,
    preferredMaxHeight: 320,
    minHeight: 160
  });

  const mergedOptions = useMemo(() => {
    const map = new Map<string, EntityLinkOption>();
    [...createdOptions, ...remoteOptions, ...safeOptions].forEach((option) => {
      map.set(option.value, option);
    });
    return Array.from(map.values());
  }, [createdOptions, remoteOptions, safeOptions]);

  useEffect(() => {
    const normalized = query.trim();
    if (!open || !onSearch || normalized.length < 2) {
      setSearchPending(false);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    setSearchPending(true);
    setSearchError(null);
    const timer = window.setTimeout(() => {
      void onSearch(normalized)
        .then((options) => {
          if (!cancelled) {
            setRemoteOptions(options);
          }
        })
        .catch((error) => {
          if (!cancelled) {
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
  }, [onSearch, open, query]);

  const selectedOptions = useMemo(
    () =>
      safeSelectedValues.map(
        (value) =>
          mergedOptions.find((option) => option.value === value) ?? {
            value,
            label: value
          }
      ),
    [mergedOptions, safeSelectedValues]
  );

  const normalizedQuery = normalize(query);
  const filteredOptions = useMemo(() => {
    const pool = mergedOptions.filter(
      (option) => !safeSelectedValues.includes(option.value)
    );
    if (!normalizedQuery) {
      return pool.slice(0, MAX_VISIBLE_OPTIONS);
    }
    return pool
      .filter((option) => {
        const haystack =
          `${option.label} ${option.description ?? ""} ${option.searchText ?? ""}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .slice(0, MAX_VISIBLE_OPTIONS);
  }, [mergedOptions, normalizedQuery, safeSelectedValues]);

  const hasExactMatch = mergedOptions.some(
    (option) => normalize(option.label) === normalizedQuery
  );
  const activeOption = open ? filteredOptions[highlightedIndex] : undefined;
  const showEmptyStatus =
    open && !searchPending && !searchError && filteredOptions.length === 0;
  const hasSearchStatus =
    searchPending || Boolean(searchError) || showEmptyStatus;

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        rootRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!activeOption) {
      return;
    }

    document
      .getElementById(getOptionId(listboxId, activeOption.value))
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activeOption, listboxId]);

  const restoreInputFocus = () => {
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const selectValue = (value: string) => {
    onChange(appendUnique(safeSelectedValues, value));
    setQuery("");
    setCreateError(null);
    setHighlightedIndex(0);
    setOpen(true);
    restoreInputFocus();
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
      setCreatedOptions((current) =>
        current.some((entry) => entry.value === option.value)
          ? current
          : [option, ...current]
      );
      onChange(appendUnique(safeSelectedValues, option.value));
      setQuery("");
      setCreateError(null);
      setHighlightedIndex(0);
      setOpen(true);
      restoreInputFocus();
    } catch (error) {
      setCreateError(
        error instanceof Error
          ? error.message
          : "Unable to create that link right now."
      );
    } finally {
      setPendingCreate(false);
    }
  };

  return (
    <div
      className={cn("relative grid gap-2", className)}
      data-forge-escape-scope="entity-link-multiselect"
      ref={rootRef}
    >
      <div
        className={cn(
          "rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]",
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
              <span
                key={option.value}
                className="inline-flex min-w-0 max-w-full items-center gap-2"
              >
                {option.kind ? (
                  <EntityBadge
                    kind={option.kind}
                    label={option.label}
                    compact
                    wrap
                    gradient={false}
                    className="max-w-full"
                  />
                ) : option.badge ? (
                  option.badge
                ) : (
                  <span
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm",
                      actionBarVariant
                        ? "border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]"
                        : "border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]"
                    )}
                  >
                    <span className="max-w-full break-words whitespace-normal [overflow-wrap:anywhere]">
                      {option.label}
                    </span>
                  </span>
                )}
                <button
                  type="button"
                  className={cn(
                    "rounded-full transition",
                    actionBarVariant
                      ? "text-[var(--ui-ink-faint)] hover:text-[var(--ui-ink-strong)]"
                      : "text-[var(--ui-ink-faint)] hover:text-[var(--ui-ink-strong)]"
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
                : "text-[var(--ui-ink-faint)]"
            )}
          />
          <input
            ref={inputRef}
            id={comboboxId}
            type="text"
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
            onChange={(event) => {
              setQuery(event.target.value);
              setCreateError(null);
              setOpen(true);
              setHighlightedIndex(0);
            }}
            onFocus={() => {
              setOpen(true);
              setHighlightedIndex((current) =>
                filteredOptions.length === 0 ? 0 : Math.max(0, current)
              );
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Backspace" &&
                !query &&
                safeSelectedValues.length > 0
              ) {
                removeValue(safeSelectedValues[safeSelectedValues.length - 1]!);
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
                  setHighlightedIndex(Math.max(0, filteredOptions.length - 1));
                  return;
                }
                setHighlightedIndex((current) => Math.max(0, current - 1));
                return;
              }

              if (event.key === "Home" && open && filteredOptions.length > 0) {
                event.preventDefault();
                setHighlightedIndex(0);
                return;
              }

              if (event.key === "End" && open && filteredOptions.length > 0) {
                event.preventDefault();
                setHighlightedIndex(filteredOptions.length - 1);
                return;
              }

              if (event.key === "Escape" && open) {
                event.preventDefault();
                event.stopPropagation();
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

              const exact = mergedOptions.find(
                (option) => normalize(option.label) === normalizedQuery
              );
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
                : "text-[var(--ui-ink-strong)] placeholder:text-[var(--ui-ink-faint)]"
            )}
          />
        </div>
      </div>

      {open && menuStyle && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              className={cn(
                "pointer-events-auto z-[80] overflow-y-auto overscroll-contain rounded-[22px] p-2 [webkit-overflow-scrolling:touch]",
                actionBarVariant
                  ? "border border-[var(--ui-border-subtle)] bg-[color-mix(in_srgb,var(--ui-surface-1)_94%,transparent)] shadow-[var(--ui-shadow-floating)]"
                  : "border border-[var(--ui-border-subtle)] bg-[color-mix(in_srgb,var(--ui-surface-1)_96%,transparent)] shadow-[var(--ui-shadow-floating)]",
                "backdrop-blur-xl"
              )}
              style={menuStyle}
            >
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
                        ? actionBarVariant
                          ? "bg-[var(--ui-surface-3)] text-[var(--ui-ink-strong)]"
                          : "bg-[var(--ui-surface-3)] text-[var(--ui-ink-strong)]"
                        : actionBarVariant
                          ? "text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                          : "text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                    )}
                    onMouseEnter={() => setHighlightedIndex(index)}
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
                              : "text-[var(--ui-ink-soft)]"
                          )}
                        >
                          {option.description}
                        </div>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>

              {searchPending ? (
                <div
                  id={statusId}
                  role="status"
                  aria-live="polite"
                  className="px-3 py-2.5 text-sm text-[var(--ui-ink-soft)]"
                >
                  Searching Forge records…
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

              {!hasExactMatch && normalizedQuery && onCreate ? (
                <button
                  type="button"
                  disabled={pendingCreate}
                  className={cn(
                    "mt-1 flex w-full items-center gap-2 rounded-[18px] px-3 py-2.5 text-left text-sm transition disabled:opacity-50",
                    actionBarVariant
                      ? "text-[var(--secondary)] hover:bg-[var(--ui-surface-hover)]"
                      : "text-[var(--secondary)] hover:bg-[var(--ui-surface-hover)]"
                  )}
                  onClick={() => void createValue()}
                >
                  <Plus className="size-4" />
                  <span className="truncate">
                    {pendingCreate
                      ? "Creating…"
                      : `${createLabel} "${query.trim()}"`}
                  </span>
                </button>
              ) : null}

              {showEmptyStatus ? (
                <div
                  id={statusId}
                  role="status"
                  aria-live="polite"
                  className={cn(
                    "px-3 py-2.5 text-sm",
                    actionBarVariant
                      ? "text-[var(--ui-ink-soft)]"
                      : "text-[var(--ui-ink-soft)]"
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
        <div
          role="alert"
          className="text-sm text-[color-mix(in_srgb,var(--danger)_74%,var(--ui-ink-strong)_26%)]"
        >
          {createError}
        </div>
      ) : null}
    </div>
  );
}
