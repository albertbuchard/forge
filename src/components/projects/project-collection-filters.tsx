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
                ? "border-[rgba(192,193,255,0.28)] bg-[rgba(192,193,255,0.16)] text-white shadow-[0_16px_36px_rgba(8,12,24,0.18)]"
                : "border-white/8 bg-white/[0.04] text-white/62 hover:bg-white/[0.08] hover:text-white"
            )}
          >
            <span>{FILTER_LABELS[filter]}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px]", active ? "bg-white/12 text-white/88" : "bg-white/8 text-white/54")}>
              {counts[filter]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
