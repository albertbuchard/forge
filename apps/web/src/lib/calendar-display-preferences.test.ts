import { beforeEach, describe, expect, it } from "vitest";
import {
  buildCalendarDisplayColorMap,
  getFallbackCalendarColor,
  getCalendarPaletteColor,
  readCalendarDisplayPreferences,
  writeCalendarDisplayPreferences
} from "./calendar-display-preferences";

describe("calendar display preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to colors on with no overrides", () => {
    expect(readCalendarDisplayPreferences()).toEqual({
      useCalendarColors: true,
      calendarColors: {}
    });
  });

  it("persists stored display preferences", () => {
    writeCalendarDisplayPreferences({
      useCalendarColors: false,
      calendarColors: {
        calendar_one: "#123456"
      }
    });

    expect(readCalendarDisplayPreferences()).toEqual({
      useCalendarColors: false,
      calendarColors: {
        calendar_one: "#123456"
      }
    });
  });

  it("builds palette-backed display colors with overrides", () => {
    expect(
      buildCalendarDisplayColorMap(
        [
          { id: "calendar_one" },
          { id: "calendar_two" }
        ],
        { calendar_two: "#445566" }
      )
    ).toEqual({
      calendar_one: getCalendarPaletteColor(0),
      calendar_two: "#445566"
    });
  });

  it("derives stable fallback colors for non-calendar-linked events", () => {
    expect(getFallbackCalendarColor("origin:apple")).toBe(getFallbackCalendarColor("origin:apple"));
  });
});
