import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  closeDatabase,
  configureDatabase,
  configureLegacyWikiAutoImport,
  getDatabase,
  initializeDatabase
} from "./db.js";
import { recordActivityEvent } from "./repositories/activity-events.js";
import { createGoal } from "./repositories/goals.js";
import { createProject } from "./repositories/projects.js";
import { createTask } from "./repositories/tasks.js";
import {
  getWeeklyReviewDateRange,
  getWeeklyReviewPayload
} from "./services/reviews.js";

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

test("weekly review keeps completed work and evidence inside the selected local week", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-weekly-review-boundary-")
  );
  configureDatabase({ dataRoot: rootDir, seedDemoData: false });
  configureLegacyWikiAutoImport(false);
  await initializeDatabase();

  try {
    const goal = createGoal({
      title: "Weekly boundary goal",
      description: "",
      horizon: "quarter",
      status: "active",
      targetPoints: 100,
      themeColor: "#336699",
      tagIds: [],
      notes: [],
      userId: "user_operator"
    });
    const project = createProject({
      goalId: goal.id,
      title: "Weekly boundary project",
      userId: "user_operator"
    });
    const taskFixtures = [
      {
        title: "Completed before the week",
        points: 11,
        completedAt: "2026-08-02T21:59:59.999Z",
        updatedAt: "2026-08-05T12:00:00.000Z"
      },
      {
        title: "Completed at the week start",
        points: 13,
        completedAt: "2026-08-02T22:00:00.000Z",
        updatedAt: "2026-08-10T12:00:00.000Z"
      },
      {
        title: "Completed at the week end",
        points: 17,
        completedAt: "2026-08-09T21:59:59.999Z",
        updatedAt: "2026-08-09T21:59:59.999Z"
      },
      {
        title: "Completed after the week",
        points: 19,
        completedAt: "2026-08-09T22:00:00.000Z",
        updatedAt: "2026-08-05T12:00:00.000Z"
      }
    ].map((fixture) => {
      const task = createTask({
        title: fixture.title,
        goalId: goal.id,
        projectId: project.id,
        userId: "user_operator",
        owner: "Operator",
        status: "done",
        points: fixture.points
      });
      getDatabase()
        .prepare(
          `UPDATE tasks
           SET completed_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(fixture.completedAt, fixture.updatedAt, task.id);
      return { ...fixture, taskId: task.id };
    });

    const activityFixtures = [
      {
        title: "Evidence before the week",
        at: "2026-08-02T21:59:59.999Z"
      },
      {
        title: "Evidence at the week start",
        at: "2026-08-02T22:00:00.000Z"
      },
      {
        title: "Evidence at the week end",
        at: "2026-08-09T21:59:59.999Z"
      },
      {
        title: "Evidence after the week",
        at: "2026-08-09T22:00:00.000Z"
      }
    ];
    for (const [index, fixture] of activityFixtures.entries()) {
      recordActivityEvent(
        {
          entityType: "task",
          entityId: taskFixtures[index]!.taskId,
          eventType: "weekly_boundary_evidence",
          title: fixture.title,
          description: fixture.title,
          actor: "Boundary test",
          source: "ui",
          metadata: { points: index + 1 }
        },
        new Date(fixture.at)
      );
    }

    const review = getWeeklyReviewPayload(
      new Date("2026-08-05T12:00:00.000Z"),
      "Europe/Zurich"
    );

    assert.equal(review.weekStartDate, "2026-08-03");
    assert.equal(review.weekEndDate, "2026-08-09");
    assert.equal(review.momentumSummary.totalXp, 30);
    assert.equal(review.chart[0]?.xp, 13);
    assert.equal(review.chart[6]?.xp, 17);
    assert.deepEqual(
      review.wins.map((win) => win.title),
      ["Evidence at the week end", "Evidence at the week start"]
    );
  } finally {
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
