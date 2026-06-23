import type { ReactNode } from "react";
import { CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatWeekday } from "@/lib/calendar-ui";

export function CalendarWeekToolbar({
  eyebrow = "Week view",
  description,
  weekStart,
  status,
  badges,
  onPrevious,
  onCurrent,
  onNext
}: {
  eyebrow?: string;
  description: string;
  weekStart: Date;
  status?: ReactNode;
  badges?: ReactNode;
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
          Week of {formatWeekday(weekStart)}
        </Badge>
        {badges}
        <Button variant="secondary" onClick={onPrevious}>
          Previous
        </Button>
        <Button variant="secondary" onClick={onCurrent}>
          This week
        </Button>
        <Button variant="secondary" onClick={onNext}>
          Next
        </Button>
      </div>
    </div>
  );
}
