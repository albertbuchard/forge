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
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">
          {eyebrow}
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">
          {description}
        </p>
        {status ? <div className="mt-3">{status}</div> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge className="bg-[var(--primary)]/14 text-[var(--primary)]">
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
