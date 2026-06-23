import { cn } from "@/lib/utils";
import type { ProjectCollectionStatusFilter } from "@/lib/project-collections";

const FILTER_LABELS: Record<ProjectCollectionStatusFilter, string> = {
  active: "Active",
  paused: "Suspended",
  completed: "Finished",
  all: "All"
};

export function ProjectCollectionFilters({
  value,
  counts,
  onChange,
  className
}: {
  value: ProjectCollectionStatusFilter;
  counts: Record<ProjectCollectionStatusFilter, number>;
  onChange: (value: ProjectCollectionStatusFilter) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {(Object.keys(FILTER_LABELS) as ProjectCollectionStatusFilter[]).map((filter) => {
        const active = filter === value;
        return (
          <button
            key={filter}
            type="button"
            onClick={() => onChange(filter)}
            className={cn(
              "inline-flex min-h-10 items-center gap-2 rounded-full border px-4 py-2 text-sm transition",
              active
                ? "border-[var(--ui-border-strong)] bg-[var(--ui-accent-soft)] text-[var(--ui-ink-strong)] shadow-[var(--ui-shadow-soft)]"
                : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-2)] hover:text-[var(--ui-ink-strong)]"
            )}
          >
            <span>{FILTER_LABELS[filter]}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px]", active ? "bg-[var(--ui-surface-active)] text-[var(--ui-ink-strong)]" : "bg-[var(--ui-surface-2)] text-[var(--ui-ink-soft)]")}>
              {counts[filter]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
