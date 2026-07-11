import assert from "node:assert/strict";
import test from "node:test";
import { getWeeklyReviewDateRange } from "./services/reviews.js";

test("weekly review uses the Europe/Zurich calendar week", () => {
  const range = getWeeklyReviewDateRange(
    new Date("2026-03-29T22:30:00.000Z"),
    "Europe/Zurich"
  );

  assert.deepEqual(range, {
    timeZone: "Europe/Zurich",
    weekStartDate: "2026-03-30",
    weekEndDate: "2026-04-05"
  });
});
