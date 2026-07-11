import { describe, expect, it } from "vitest";
import {
  buildDefaultCalendarEventTiming,
  calendarEventOverlapsDate,
  calendarEventTimeLabelForDate,
  formatWeekday,
  moveCalendarSpanToDate
} from "./calendar-ui";

describe("calendar date and timezone behavior", () => {
  it("creates the default event at 09:00 in the selected timezone", () => {
    expect(
      buildDefaultCalendarEventTiming("2026-09-12", "America/Los_Angeles")
    ).toEqual({
      startAt: "2026-09-12T16:00:00.000Z",
      endAt: "2026-09-12T17:00:00.000Z"
    });
  });

  it("keeps abstract calendar day headings on their UTC date key", () => {
    expect(
      formatWeekday(new Date("2026-09-14T00:00:00.000Z"), "UTC")
    ).toBe("Mon, Sep 14");
  });

  it("preserves a flight's local wall time and absolute duration when moved", () => {
    expect(
      moveCalendarSpanToDate(
        {
          startAt: "2026-09-13T02:35:00.000Z",
          endAt: "2026-09-13T15:55:00.000Z",
          timezone: "America/Los_Angeles"
        },
        "2026-09-15"
      )
    ).toEqual({
      startAt: "2026-09-16T02:35:00.000Z",
      endAt: "2026-09-16T15:55:00.000Z"
    });
  });

  it("keeps all-day spans on local midnights across daylight saving time", () => {
    expect(
      moveCalendarSpanToDate(
        {
          startAt: "2026-10-30T23:00:00.000Z",
          endAt: "2026-11-01T23:00:00.000Z",
          timezone: "Europe/Zurich",
          isAllDay: true
        },
        "2026-03-28"
      )
    ).toEqual({
      startAt: "2026-03-27T23:00:00.000Z",
      endAt: "2026-03-29T22:00:00.000Z"
    });
  });

  it("renders multi-day and all-day events on every applicable day", () => {
    const timed = {
      startAt: "2026-09-12T18:00:00.000Z",
      endAt: "2026-09-14T07:00:00.000Z",
      timezone: "Europe/Zurich"
    };
    expect(calendarEventOverlapsDate(timed, "2026-09-13")).toBe(true);
    expect(calendarEventTimeLabelForDate(timed, "2026-09-13")).toBe(
      "Continues"
    );

    const allDay = {
      startAt: "2026-09-11T22:00:00.000Z",
      endAt: "2026-09-13T22:00:00.000Z",
      timezone: "Europe/Zurich",
      isAllDay: true
    };
    expect(calendarEventOverlapsDate(allDay, "2026-09-12")).toBe(true);
    expect(calendarEventOverlapsDate(allDay, "2026-09-13")).toBe(true);
    expect(calendarEventOverlapsDate(allDay, "2026-09-14")).toBe(false);
    expect(calendarEventTimeLabelForDate(allDay, "2026-09-12")).toBe("All day");
  });
});
