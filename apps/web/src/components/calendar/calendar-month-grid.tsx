import { useMemo } from "react";
import { CalendarDays, Clock3 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { calendarEventOverlapsDate, WEEKDAY_LABELS } from "@/lib/calendar-ui";
import { localDateKeyInTimeZone } from "@/lib/timezone-datetime";
import type {
  CalendarEvent,
  LifeEvent,
  TaskTimebox,
  WorkBlockInstance
} from "@/lib/types";

type MonthItem = {
  id: string;
  title: string;
  startsAt: string;
  kind: "event" | "life event" | "work block" | "timebox";
};

export function buildCalendarMonthItemIndex(input: {
  days: Date[];
  events: CalendarEvent[];
  lifeEvents: LifeEvent[];
  workBlocks: WorkBlockInstance[];
  timeboxes: TaskTimebox[];
  timeZone: string;
}) {
  const dayKeys = input.days.map((day) => day.toISOString().slice(0, 10));
  const itemsByDay = new Map<string, MonthItem[]>(
    dayKeys.map((dayKey) => [dayKey, []])
  );
  const append = (dayKey: string, item: MonthItem) => {
    itemsByDay.get(dayKey)?.push(item);
  };
  const appendSpanningItem = (
    entry: Pick<CalendarEvent, "startAt" | "endAt" | "timezone" | "isAllDay">,
    item: MonthItem
  ) => {
    const startKey = localDateKeyInTimeZone(entry.startAt, entry.timezone);
    const endKey = localDateKeyInTimeZone(entry.endAt, entry.timezone);
    if (!startKey || !endKey) {
      return;
    }
    for (const dayKey of dayKeys) {
      if (dayKey < startKey || dayKey > endKey) {
        continue;
      }
      if (dayKey === endKey && !calendarEventOverlapsDate(entry, dayKey)) {
        continue;
      }
      append(dayKey, item);
    }
  };

  for (const event of input.events) {
    if (event.deletedAt) {
      continue;
    }
    appendSpanningItem(event, {
      id: event.id,
      title: event.title,
      startsAt: event.startAt,
      kind: "event"
    });
  }
  for (const lifeEvent of input.lifeEvents) {
    if (lifeEvent.deletedAt) {
      continue;
    }
    appendSpanningItem(
      {
        startAt: lifeEvent.startsAt,
        endAt: lifeEvent.endsAt,
        timezone: lifeEvent.timezone,
        isAllDay: lifeEvent.isAllDay
      },
      {
        id: lifeEvent.id,
        title: lifeEvent.title,
        startsAt: lifeEvent.startsAt,
        kind: "life event"
      }
    );
  }
  for (const block of input.workBlocks) {
    append(block.dateKey, {
      id: block.id,
      title: block.title,
      startsAt: block.startAt,
      kind: "work block"
    });
  }
  for (const timebox of input.timeboxes) {
    append(localDateKeyInTimeZone(timebox.startsAt, input.timeZone), {
      id: timebox.id,
      title: timebox.title,
      startsAt: timebox.startsAt,
      kind: "timebox"
    });
  }
  for (const items of itemsByDay.values()) {
    items.sort(
      (left, right) =>
        Date.parse(left.startsAt) - Date.parse(right.startsAt) ||
        left.kind.localeCompare(right.kind) ||
        left.id.localeCompare(right.id)
    );
  }
  return itemsByDay;
}

export function CalendarMonthGrid({
  days,
  month,
  events,
  lifeEvents,
  workBlocks,
  timeboxes,
  timeZone,
  onSelectDay
}: {
  days: Date[];
  month: Date;
  events: CalendarEvent[];
  lifeEvents: LifeEvent[];
  workBlocks: WorkBlockInstance[];
  timeboxes: TaskTimebox[];
  timeZone: string;
  onSelectDay: (day: Date) => void;
}) {
  const currentMonth = month.getUTCMonth();
  const todayKey = localDateKeyInTimeZone(new Date().toISOString(), timeZone);
  const itemsByDay = useMemo(
    () =>
      buildCalendarMonthItemIndex({
        days,
        events,
        lifeEvents,
        workBlocks,
        timeboxes,
        timeZone
      }),
    [days, events, lifeEvents, timeZone, timeboxes, workBlocks]
  );

  return (
    <div
      className="max-w-full overflow-x-auto pb-2"
      data-testid="calendar-month-grid"
    >
      <div className="grid min-w-[46rem] grid-cols-7 gap-2">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="px-2 py-1 text-center text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--ui-ink-muted)]"
          >
            {label}
          </div>
        ))}
        {days.map((day) => {
          const dayKey = day.toISOString().slice(0, 10);
          const items = itemsByDay.get(dayKey) ?? [];
          const outsideMonth = day.getUTCMonth() !== currentMonth;
          return (
            <button
              key={dayKey}
              type="button"
              onClick={() => onSelectDay(day)}
              aria-label={`${day.toLocaleDateString("en", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
                timeZone: "UTC"
              })}: ${items.length} scheduled item${items.length === 1 ? "" : "s"}. Open week.`}
              className={`min-h-32 min-w-0 rounded-[20px] border p-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/45 ${
                dayKey === todayKey
                  ? "border-[color-mix(in_srgb,var(--primary)_54%,var(--ui-border-subtle)_46%)] bg-[var(--ui-accent-soft)]"
                  : "border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-surface-hover)]"
              } ${outsideMonth ? "opacity-55" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-[var(--ui-ink-strong)]">
                  {day.getUTCDate()}
                </span>
                {items.length > 0 ? (
                  <Badge
                    size="sm"
                    className="bg-[var(--ui-surface-1)] text-[var(--ui-ink-medium)]"
                  >
                    {items.length}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-2 grid gap-1.5">
                {items.slice(0, 3).map((item) => (
                  <div
                    key={`${item.kind}:${item.id}`}
                    className="min-w-0 rounded-[10px] bg-[var(--ui-surface-1)] px-2 py-1.5"
                  >
                    <div className="truncate text-xs font-medium text-[var(--ui-ink-strong)]">
                      {item.title}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--ui-ink-muted)]">
                      {item.kind === "event" || item.kind === "life event" ? (
                        <CalendarDays className="size-3" aria-hidden="true" />
                      ) : (
                        <Clock3 className="size-3" aria-hidden="true" />
                      )}
                      {item.kind}
                    </div>
                  </div>
                ))}
                {items.length > 3 ? (
                  <div className="px-1 text-[10px] font-medium text-[var(--primary)]">
                    +{items.length - 3} more
                  </div>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
