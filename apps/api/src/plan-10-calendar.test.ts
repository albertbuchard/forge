import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { HttpError } from "./errors.js";
import {
  createCalendarEvent,
  createTaskTimebox,
  deleteTaskTimebox,
  listTaskTimeboxes,
  suggestTaskTimeboxes,
  updateTaskTimebox
} from "./repositories/calendar.js";
import { getEntityOwnerId } from "./repositories/entity-ownership.js";
import { createGoal } from "./repositories/goals.js";
import { createProject } from "./repositories/projects.js";
import { createTask } from "./repositories/tasks.js";
import { createUser } from "./repositories/users.js";
import { selectTaskTimeboxesForConnectionProjection } from "./services/calendar-runtime.js";

async function withIsolatedForge(
  run: () => Promise<void> | void
): Promise<void> {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "forge-plan-10-"));
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    devrageMetricSync: false
  });
  try {
    await run();
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
}

function createPlanningFixture(label: string) {
  const user = createUser({
    kind: "human",
    handle: `plan-${label}`,
    displayName: `Planner ${label}`,
    description: "",
    accentColor: "#336699"
  });
  const goal = createGoal({
    title: `Goal ${label}`,
    description: "",
    horizon: "year",
    status: "active",
    targetPoints: 400,
    themeColor: "#c8a46b",
    tagIds: [],
    notes: [],
    userId: user.id
  });
  const project = createProject({
    goalId: goal.id,
    title: `Project ${label}`,
    userId: user.id
  });
  const task = createTask({
    title: `Task ${label}`,
    projectId: project.id,
    goalId: goal.id,
    userId: user.id,
    owner: user.displayName,
    plannedDurationSeconds: 60 * 60
  });
  return { user, goal, project, task };
}

function assertHttpCode(expectedCode: string) {
  return (error: unknown) =>
    error instanceof HttpError && error.code === expectedCode;
}

function createBusyEvent(input: {
  title: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  userId: string;
}) {
  return createCalendarEvent({
    title: input.title,
    description: "",
    location: "",
    place: {
      label: "",
      address: "",
      timezone: input.timeZone,
      latitude: null,
      longitude: null,
      source: "",
      externalPlaceId: ""
    },
    startAt: input.startAt,
    endAt: input.endAt,
    timezone: input.timeZone,
    isAllDay: false,
    availability: "busy",
    eventType: "",
    categories: [],
    preferredCalendarId: null,
    userId: input.userId,
    links: []
  });
}

test("PLAN-10 keeps timebox task, project, owner, and merged timing invariants", async () => {
  await withIsolatedForge(() => {
    const alpha = createPlanningFixture("alpha");
    const beta = createPlanningFixture("beta");

    assert.throws(
      () =>
        createTaskTimebox({
          taskId: alpha.task.id,
          projectId: beta.project.id,
          userId: alpha.user.id,
          title: "Wrong project",
          startsAt: "2027-01-04T09:00:00.000Z",
          endsAt: "2027-01-04T10:00:00.000Z",
          status: "planned",
          source: "manual",
          overrideReason: null
        }),
      assertHttpCode("calendar_timebox_project_mismatch")
    );
    assert.throws(
      () =>
        createTaskTimebox({
          taskId: alpha.task.id,
          projectId: alpha.project.id,
          userId: beta.user.id,
          title: "Wrong owner",
          startsAt: "2027-01-04T09:00:00.000Z",
          endsAt: "2027-01-04T10:00:00.000Z",
          status: "planned",
          source: "manual",
          overrideReason: null
        }),
      assertHttpCode("calendar_timebox_owner_mismatch")
    );

    const timebox = createTaskTimebox({
      taskId: alpha.task.id,
      projectId: alpha.project.id,
      userId: alpha.user.id,
      title: "Valid plan",
      startsAt: "2027-01-04T09:00:00.000Z",
      endsAt: "2027-01-04T10:00:00.000Z",
      status: "planned",
      source: "manual",
      overrideReason: null
    });
    assert.equal(timebox.userId, alpha.user.id);
    assert.throws(
      () =>
        updateTaskTimebox(timebox.id, {
          startsAt: "2027-01-04T11:00:00.000Z"
        }),
      assertHttpCode("calendar_timebox_window_invalid")
    );
    assert.equal(
      listTaskTimeboxes({
        from: "2027-01-04T00:00:00.000Z",
        to: "2027-01-05T00:00:00.000Z",
        userIds: [beta.user.id]
      }).length,
      0
    );
    assert.equal(
      listTaskTimeboxes({
        from: "2027-01-04T00:00:00.000Z",
        to: "2027-01-05T00:00:00.000Z",
        userIds: [alpha.user.id]
      })[0]?.id,
      timebox.id
    );

    deleteTaskTimebox(timebox.id);
    assert.equal(getEntityOwnerId("task_timebox", timebox.id), null);
  });
});

test("PLAN-10 requires a specific override for calendar pressure and preserves it", async () => {
  await withIsolatedForge(() => {
    const fixture = createPlanningFixture("overlap");
    createBusyEvent({
      title: "Provider meeting",
      startAt: "2027-02-01T09:00:00.000Z",
      endAt: "2027-02-01T10:00:00.000Z",
      timeZone: "UTC",
      userId: fixture.user.id
    });

    assert.throws(
      () =>
        createTaskTimebox({
          taskId: fixture.task.id,
          projectId: fixture.project.id,
          userId: fixture.user.id,
          title: "Conflicting focus",
          startsAt: "2027-02-01T09:30:00.000Z",
          endsAt: "2027-02-01T10:30:00.000Z",
          status: "planned",
          source: "manual",
          overrideReason: null
        }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.code === "calendar_timebox_overlap_requires_override" &&
        Array.isArray(error.details?.conflicts) &&
        error.details.conflicts.some(
          (conflict) =>
            typeof conflict === "object" &&
            conflict !== null &&
            (conflict as { kind?: string }).kind === "calendar_event"
        )
    );

    const overridden = createTaskTimebox({
      taskId: fixture.task.id,
      projectId: fixture.project.id,
      userId: fixture.user.id,
      title: "Conflicting focus",
      startsAt: "2027-02-01T09:30:00.000Z",
      endsAt: "2027-02-01T10:30:00.000Z",
      status: "planned",
      source: "manual",
      overrideReason: "The meeting is optional; protect the thesis deadline."
    });
    assert.equal(
      overridden.overrideReason,
      "The meeting is optional; protect the thesis deadline."
    );
  });
});

test("PLAN-10 suggestions are owner-scoped, timezone-aware, bounded, and conflict-free", async () => {
  await withIsolatedForge(() => {
    const owner = createPlanningFixture("suggest-owner");
    const other = createPlanningFixture("suggest-other");
    createBusyEvent({
      title: "Another person's busy day",
      startAt: "2026-03-29T06:00:00.000Z",
      endAt: "2026-03-29T16:00:00.000Z",
      timeZone: "Europe/Zurich",
      userId: other.user.id
    });

    const firstPass = suggestTaskTimeboxes(owner.task.id, {
      from: "2026-03-29T00:00:00.000Z",
      to: "2026-03-29T22:00:00.000Z",
      timeZone: "Europe/Zurich",
      limit: 99
    });
    assert.equal(firstPass.length, 12);
    assert.equal(firstPass[0]?.startsAt, "2026-03-29T06:00:00.000Z");
    assert.ok(
      firstPass.every(
        (slot) =>
          Date.parse(slot.startsAt) >= Date.parse("2026-03-29T00:00:00.000Z") &&
          Date.parse(slot.endsAt) <= Date.parse("2026-03-29T22:00:00.000Z")
      )
    );

    createBusyEvent({
      title: "Owner's first-hour conflict",
      startAt: "2026-03-29T06:00:00.000Z",
      endAt: "2026-03-29T07:00:00.000Z",
      timeZone: "Europe/Zurich",
      userId: owner.user.id
    });
    const secondPass = suggestTaskTimeboxes(owner.task.id, {
      from: "2026-03-29T00:00:00.000Z",
      to: "2026-03-29T22:00:00.000Z",
      timeZone: "Europe/Zurich",
      limit: 2
    });
    assert.equal(secondPass[0]?.startsAt, "2026-03-29T07:00:00.000Z");

    assert.throws(
      () =>
        suggestTaskTimeboxes(owner.task.id, {
          from: "2026-01-01T00:00:00.000Z",
          to: "2026-03-01T00:00:00.000Z"
        }),
      assertHttpCode("calendar_timebox_range_too_large")
    );
    assert.throws(
      () =>
        listTaskTimeboxes({
          from: "2025-01-01T00:00:00.000Z",
          to: "2028-01-01T00:00:00.000Z"
        }),
      assertHttpCode("calendar_timebox_range_too_large")
    );
  });
});

test("PLAN-10 provider selection never reassigns another connection's timebox", async () => {
  await withIsolatedForge(() => {
    const fixture = createPlanningFixture("projection");
    const unassigned = createTaskTimebox({
      taskId: fixture.task.id,
      userId: fixture.user.id,
      title: "Unassigned",
      startsAt: "2027-03-01T08:00:00.000Z",
      endsAt: "2027-03-01T09:00:00.000Z",
      status: "planned",
      source: "manual",
      overrideReason: null
    });
    const assignedHere = {
      ...unassigned,
      id: "timebox_here",
      connectionId: "connection_here"
    };
    const assignedElsewhere = {
      ...unassigned,
      id: "timebox_elsewhere",
      connectionId: "connection_elsewhere"
    };

    assert.deepEqual(
      selectTaskTimeboxesForConnectionProjection(
        [unassigned, assignedHere, assignedElsewhere],
        "connection_here"
      ).map((timebox) => timebox.id),
      [unassigned.id, assignedHere.id]
    );
  });
});
