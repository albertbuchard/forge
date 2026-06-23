import { useMemo, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { EntityBadge } from "@/components/ui/entity-badge";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ProjectSearchTokenKind =
  | "goal"
  | "task"
  | "tag"
  | "status"
  | "type"
  | "user";

export type ProjectSearchTokenOption = {
  id: string;
  kind: ProjectSearchTokenKind;
  value: string;
  label: string;
  description?: string;
  searchText?: string;
};

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function renderTokenBadge(
  option: ProjectSearchTokenOption,
  _compact = false
): ReactNode {
  switch (option.kind) {
    case "goal":
      return (
        <EntityBadge
          kind="goal"
          label={option.label}
          compact
          gradient={false}
        />
      );
    case "task":
      return (
        <EntityBadge
          kind="task"
          label={option.label}
          compact
          gradient={false}
        />
      );
    case "tag":
      return (
        <Badge className="bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
          {option.label}
        </Badge>
      );
    case "status":
      return (
        <Badge className="bg-[var(--ui-accent-soft)] text-[color-mix(in_srgb,var(--primary)_72%,var(--ui-ink-strong)_28%)]">
          {option.label}
        </Badge>
      );
    case "type":
      return (
        <Badge className="bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_76%,var(--ui-ink-strong)_24%)]">
          {option.label}
        </Badge>
      );
    case "user":
      return (
        <Badge className="bg-[var(--ui-success-soft)] text-[color-mix(in_srgb,var(--success)_76%,var(--ui-ink-strong)_24%)]">
          {option.label}
        </Badge>
      );
    default:
      return option.label;
  }
}

export function ProjectSearchBar({
  query,
  onQueryChange,
  options,
  selectedOptionIds,
  onSelectedOptionIdsChange,
  resultSummary
}: {
  query: string;
  onQueryChange: (value: string) => void;
  options: ProjectSearchTokenOption[];
  selectedOptionIds: string[];
  onSelectedOptionIdsChange: (value: string[]) => void;
  resultSummary: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const selectedOptions = useMemo(
    () =>
      selectedOptionIds
        .map((id) => options.find((option) => option.id === id))
        .filter(Boolean) as ProjectSearchTokenOption[],
    [options, selectedOptionIds]
  );

  const normalizedQuery = normalize(query);
  const filteredOptions = useMemo(() => {
    const pool = options.filter(
      (option) => !selectedOptionIds.includes(option.id)
    );
    if (!normalizedQuery) {
      return pool.slice(0, 10);
    }
    return pool
      .filter((option) => {
        const haystack =
          `${option.label} ${option.description ?? ""} ${option.searchText ?? ""}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .slice(0, 10);
  }, [normalizedQuery, options, selectedOptionIds]);

  const addOption = (optionId: string) => {
    if (selectedOptionIds.includes(optionId)) {
      return;
    }
    onSelectedOptionIdsChange([...selectedOptionIds, optionId]);
    onQueryChange("");
    setHighlightedIndex(0);
    setOpen(false);
  };

  const removeOption = (optionId: string) => {
    onSelectedOptionIdsChange(
      selectedOptionIds.filter((id) => id !== optionId)
    );
  };

  const clearFilters = () => {
    onQueryChange("");
    onSelectedOptionIdsChange([]);
    setHighlightedIndex(0);
    setOpen(false);
  };

  return (
    <div className="grid gap-3">
      <div className="rounded-[28px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-4 shadow-[var(--ui-shadow-soft)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-label text-[11px] uppercase tracking-[0.2em] text-[var(--ui-ink-muted)]">
              Project search
            </div>
            <div className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ui-ink-soft)]">
              Search with free text, then pin matching goals, tasks, tags, human
              users, bot users, statuses, or project-type chips as you narrow
              the list.
            </div>
          </div>
          {query.trim().length > 0 || selectedOptionIds.length > 0 ? (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-3 py-2 text-sm text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
            >
              Clear search
            </button>
          ) : null}
        </div>

        <div className="mt-4 rounded-[24px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] px-4 py-3">
          {selectedOptions.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {selectedOptions.map((option) => (
                <span
                  key={option.id}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-2.5 py-1.5"
                >
                  {renderTokenBadge(option, true)}
                  <button
                    type="button"
                    className="rounded-full text-[var(--ui-ink-soft)] transition hover:text-[var(--ui-ink-strong)]"
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
              <Search className="size-4 text-[var(--ui-ink-muted)]" />
              <input
                value={query}
                onChange={(event) => {
                  onQueryChange(event.target.value);
                  setOpen(true);
                  setHighlightedIndex(0);
                }}
                onFocus={() => setOpen(true)}
                onBlur={() => {
                  window.setTimeout(() => setOpen(false), 120);
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Backspace" &&
                    !query &&
                    selectedOptionIds.length > 0
                  ) {
                    removeOption(
                      selectedOptionIds[selectedOptionIds.length - 1]!
                    );
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

                  if (
                    event.key === "Enter" &&
                    filteredOptions[highlightedIndex]
                  ) {
                    event.preventDefault();
                    addOption(filteredOptions[highlightedIndex]!.id);
                  }
                }}
                placeholder="Type a project, goal, task, human, bot, user, or tag"
                className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ui-ink-strong)] placeholder:text-[var(--ui-ink-muted)] focus:outline-none"
              />
            </div>

            {open ? (
              <div className="absolute top-full z-20 mt-2 w-full rounded-[22px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-popover)] p-2 shadow-[var(--ui-shadow-strong)] backdrop-blur-xl">
                {filteredOptions.length > 0 ? (
                  filteredOptions.map((option, index) => (
                    <button
                      key={option.id}
                      type="button"
                      className={cn(
                        "flex w-full items-start justify-between gap-3 rounded-[18px] px-3 py-2.5 text-left transition",
                        index === highlightedIndex
                          ? "bg-[var(--ui-surface-active)] text-[var(--ui-ink-strong)]"
                          : "text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                      )}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => addOption(option.id)}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {renderTokenBadge(option)}
                        </div>
                        {option.description ? (
                          <div className="mt-1 text-xs leading-5 text-[var(--ui-ink-soft)]">
                            {option.description}
                          </div>
                        ) : null}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2.5 text-sm text-[var(--ui-ink-muted)]">
                    Keep typing to search by free text, or select a suggested
                    goal, task, human or bot owner, tag, status, or type chip
                    when it appears.
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-3 text-sm text-[var(--ui-ink-soft)]">
          {resultSummary}
        </div>
      </div>
    </div>
  );
}
