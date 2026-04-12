import { describe, expect, it } from "vitest";
import {
  estimateCalendarEventActionPointLoad,
  getCalendarActivityPresetOptions,
  estimateHabitCheckInActionPointLoad,
  estimateHabitGeneratedWorkoutActionPointLoad,
  estimateMovementTripActionPointLoad,
  estimateQuickNoteActionPointLoad,
  estimateTaskTimeboxActionPointLoad,
  estimateWorkBlockActionPointLoad,
  estimateWorkBlockTemplateActionPointLoad,
  formatLifeForceAp,
  formatLifeForceRate
} from "./life-force-display";

describe("life-force display estimators", () => {
  it("formats AP totals and rates consistently", () => {
    expect(formatLifeForceAp(4.166)).toBe("4.2 AP");
    expect(formatLifeForceRate(13)).toBe("13 AP/h");
    expect(formatLifeForceAp(undefined)).toBe("0 AP");
    expect(formatLifeForceRate(undefined)).toBe("0 AP/h");
  });

  it("estimates task timeboxes on the default 100 AP per day task shape", () => {
    expect(
      estimateTaskTimeboxActionPointLoad({
        startsAt: "2026-04-11T10:00:00.000Z",
        endsAt: "2026-04-11T12:00:00.000Z"
      })
    ).toEqual({
      rateApPerHour: 4.17,
      totalAp: 8.33
    });
  });

  it("estimates work blocks, meetings, and movement trips with Forge AP heuristics", () => {
    expect(
      estimateWorkBlockActionPointLoad({
        kind: "main_activity",
        startAt: "2026-04-11T08:00:00.000Z",
        endAt: "2026-04-11T10:00:00.000Z"
      })
    ).toEqual({
      rateApPerHour: 14,
      totalAp: 28
    });

    expect(
      estimateWorkBlockActionPointLoad({
        kind: "rest",
        startAt: "2026-04-11T12:00:00.000Z",
        endAt: "2026-04-11T13:00:00.000Z"
      })
    ).toEqual({
      rateApPerHour: 3,
      totalAp: 3
    });

    expect(
      estimateWorkBlockActionPointLoad({
        kind: "holiday",
        startAt: "2026-04-11T12:00:00.000Z",
        endAt: "2026-04-11T14:00:00.000Z"
      })
    ).toEqual({
      rateApPerHour: 4,
      totalAp: 8
    });

    expect(
      estimateWorkBlockTemplateActionPointLoad({
        kind: "main_activity",
        startMinute: 8 * 60,
        endMinute: 12 * 60
      })
    ).toEqual({
      rateApPerHour: 14,
      totalAp: 56
    });

    expect(
      estimateCalendarEventActionPointLoad({
        title: "Hiring meeting",
        eventType: "meeting",
        availability: "busy",
        startAt: "2026-04-11T13:00:00.000Z",
        endAt: "2026-04-11T14:00:00.000Z"
      })
    ).toEqual({
      rateApPerHour: 13,
      totalAp: 13
    });

    expect(
      estimateCalendarEventActionPointLoad({
        title: "Lunch",
        eventType: "",
        availability: "free",
        startAt: "2026-04-11T12:00:00.000Z",
        endAt: "2026-04-11T13:00:00.000Z"
      })
    ).toEqual({
      rateApPerHour: 3,
      totalAp: 3
    });

    expect(
      estimateMovementTripActionPointLoad({
        startedAt: "2026-04-11T08:00:00.000Z",
        endedAt: "2026-04-11T08:30:00.000Z",
        expectedMet: 3.2
      })
    ).toEqual({
      rateApPerHour: 12.8,
      totalAp: 6.4
    });
  });

  it("estimates habit check-ins and workout-linked habits in AP", () => {
    expect(
      estimateHabitCheckInActionPointLoad({
        polarity: "positive"
      })
    ).toEqual({
      totalAp: 3,
      rateApPerHour: 0
    });

    expect(
      estimateHabitGeneratedWorkoutActionPointLoad({
        generatedHealthEventTemplate: {
          enabled: true,
          durationMinutes: 45
        }
      } as never)
    ).toEqual({
      rateApPerHour: 24,
      totalAp: 18
    });
  });

  it("treats a standalone quick note as a tiny AP impulse", () => {
    expect(estimateQuickNoteActionPointLoad()).toEqual({
      totalAp: 1,
      rateApPerHour: 0
    });
  });

  it("prefers stored action profiles and exposes calendar activity presets", () => {
    expect(
      estimateTaskTimeboxActionPointLoad({
        startsAt: "2026-04-11T10:00:00.000Z",
        endsAt: "2026-04-11T12:00:00.000Z",
        actionProfile: {
          id: "timebox_profile",
          profileKey: "timebox_profile",
          title: "Custom timebox",
          entityType: "task_timebox",
          mode: "container",
          startupAp: 0,
          totalCostAp: 0,
          expectedDurationSeconds: 7200,
          sustainRateApPerHour: 11,
          demandWeights: {
            activation: 0.1,
            focus: 0.4,
            vigor: 0.1,
            composure: 0.1,
            flow: 0.3
          },
          doubleCountPolicy: "container_only",
          sourceMethod: "manual",
          costBand: "light",
          recoveryEffect: 0,
          metadata: {
            activityPresetKey: "admin",
            customSustainRateApPerHour: 11
          },
          createdAt: "2026-04-11T10:00:00.000Z",
          updatedAt: "2026-04-11T10:00:00.000Z"
        }
      })
    ).toEqual({
      rateApPerHour: 11,
      totalAp: 22
    });

    expect(
      getCalendarActivityPresetOptions().find((preset) => preset.key === "holiday_leisure")
    ).toMatchObject({
      label: "Holiday",
      defaultRateApPerHour: 4
    });
  });
});
