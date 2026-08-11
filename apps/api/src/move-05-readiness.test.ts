import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { HttpError } from "./errors.js";
import { updateMovementStay, updateMovementTrip } from "./movement.js";

test("MOVE-05 rejects invalid stay and trip corrections without durable partial state", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-move-05-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const database = getDatabase();
    const now = "2026-08-11T10:00:00.000Z";
    database
      .prepare(
        `INSERT INTO movement_stays (
           id, external_uid, user_id, label, started_at, ended_at,
           center_latitude, center_longitude, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "stay_move_05",
        "stay_external_move_05",
        "user_operator",
        "Morning at home",
        "2026-08-11T08:00:00.000Z",
        "2026-08-11T09:00:00.000Z",
        46.5191,
        6.6323,
        now,
        now
      );
    database
      .prepare(
        `INSERT INTO movement_trips (
           id, external_uid, user_id, label, started_at, ended_at,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "trip_move_05",
        "trip_external_move_05",
        "user_operator",
        "Walk to work",
        "2026-08-11T09:00:00.000Z",
        "2026-08-11T09:30:00.000Z",
        now,
        now
      );
    database
      .prepare(
        `INSERT INTO movement_stay_tombstones (
           id, user_id, stay_external_uid, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        "stay_tombstone_move_05",
        "user_operator",
        "stay_external_move_05",
        now,
        now
      );
    database
      .prepare(
        `INSERT INTO movement_trip_tombstones (
           id, user_id, trip_external_uid, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        "trip_tombstone_move_05",
        "user_operator",
        "trip_external_move_05",
        now,
        now
      );

    const context = { actor: "MOVE-05 fixture", source: "ui" as const };
    assert.throws(
      () =>
        updateMovementStay(
          "stay_move_05",
          {
            label: "Invalid stay correction",
            startedAt: "2026-08-11T09:00:00.000Z",
            endedAt: "2026-08-11T09:00:00.000Z"
          },
          context,
          { userId: "user_operator" }
        ),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.code, "invalid_movement_stay_range");
        return true;
      }
    );
    assert.throws(
      () =>
        updateMovementTrip(
          "trip_move_05",
          {
            label: "Invalid trip correction",
            startedAt: "2026-08-11T10:00:00.000Z",
            endedAt: "2026-08-11T09:59:59.000Z"
          },
          context,
          { userId: "user_operator" }
        ),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.code, "invalid_movement_trip_range");
        return true;
      }
    );

    const count = (table: string) =>
      (
        database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
          count: number;
        }
      ).count;
    assert.equal(count("movement_stay_overrides"), 0);
    assert.equal(count("movement_trip_overrides"), 0);
    assert.equal(count("movement_stay_tombstones"), 1);
    assert.equal(count("movement_trip_tombstones"), 1);
    assert.equal(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM activity_events
             WHERE event_type IN ('movement_stay_updated', 'movement_trip_updated')`
          )
          .get() as { count: number }
      ).count,
      0
    );
    const unchangedStay = database
      .prepare(
        `SELECT label, started_at, ended_at FROM movement_stays WHERE id = ?`
      )
      .get("stay_move_05") as {
      label: string;
      started_at: string;
      ended_at: string;
    };
    assert.equal(unchangedStay.label, "Morning at home");
    assert.equal(unchangedStay.started_at, "2026-08-11T08:00:00.000Z");
    assert.equal(unchangedStay.ended_at, "2026-08-11T09:00:00.000Z");

    const updatedStay = updateMovementStay(
      "stay_move_05",
      {
        label: "Corrected morning at home",
        endedAt: "2026-08-11T08:45:00.000Z"
      },
      context,
      { userId: "user_operator" }
    );
    const updatedTrip = updateMovementTrip(
      "trip_move_05",
      {
        label: "Corrected walk to work",
        startedAt: "2026-08-11T08:45:00.000Z"
      },
      context,
      { userId: "user_operator" }
    );
    assert.equal(updatedStay?.label, "Corrected morning at home");
    assert.equal(updatedTrip?.label, "Corrected walk to work");
    assert.equal(count("movement_stay_overrides"), 1);
    assert.equal(count("movement_trip_overrides"), 1);
    assert.equal(count("movement_stay_tombstones"), 0);
    assert.equal(count("movement_trip_tombstones"), 0);
    assert.equal(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM activity_events
             WHERE event_type IN ('movement_stay_updated', 'movement_trip_updated')`
          )
          .get() as { count: number }
      ).count,
      2
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
