import type { ReactNode } from "react";
import { CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatWeekday } from "@/lib/calendar-ui";
import { formatMonthLabel } from "@/lib/calendar-ui";

export function CalendarWeekToolbar({
  eyebrow = "Week view",
  description,
  weekStart,
  view = "week",
  month,
  status,
  badges,
  onViewChange,
  onPrevious,
  onCurrent,
  onNext
}: {
  eyebrow?: string;
  description: string;
  weekStart: Date;
  view?: "week" | "month";
  month?: Date;
  status?: ReactNode;
  badges?: ReactNode;
  onViewChange?: (view: "week" | "month") => void;
  onPrevious: () => void;
  onCurrent: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ui-ink-faint)]">
          {eyebrow}
        </div>
        <p className="mt-2 max-w-3xl break-words text-sm leading-6 text-[var(--ui-ink-soft)] [overflow-wrap:anywhere]">
          {description}
        </p>
        {status ? <div className="mt-3">{status}</div> : null}
      </div>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Badge className="border border-[color-mix(in_srgb,var(--primary)_28%,var(--ui-border-subtle)_72%)] bg-[var(--ui-accent-soft)] text-[var(--primary)]">
          <CalendarDays className="mr-1 size-3.5" />
          {view === "month"
            ? formatMonthLabel(month ?? weekStart)
            : `Week of ${formatWeekday(weekStart, "UTC")}`}
        </Badge>
        {badges}
        {onViewChange ? (
          <div
            className="inline-flex rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-1"
            aria-label="Calendar view"
          >
            {(["week", "month"] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                aria-pressed={view === candidate}
                className={`min-h-11 rounded-[calc(var(--radius-control)-4px)] px-4 text-sm font-medium capitalize transition ${
                  view === candidate
                    ? "bg-[var(--ui-accent-soft)] text-[var(--primary)]"
                    : "text-[var(--ui-ink-soft)] hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
                }`}
                onClick={() => onViewChange(candidate)}
              >
                {candidate}
              </button>
            ))}
          </div>
        ) : null}
        <Button variant="secondary" onClick={onPrevious}>
          Previous
        </Button>
        <Button variant="secondary" onClick={onCurrent}>
          {view === "month" ? "This month" : "This week"}
        </Button>
        <Button variant="secondary" onClick={onNext}>
          Next
        </Button>
      </div>
    </div>
  );
}
