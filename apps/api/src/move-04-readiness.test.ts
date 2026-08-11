import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { HttpError } from "./errors.js";
import {
  analyzeMovementUserBoxPreflight,
  createMovementPlace,
  updateMovementPlace
} from "./movement.js";

test("MOVE-04 prevents duplicate known places and rejects impossible repair preflights", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-move-04-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const context = { actor: "MOVE-04 fixture", source: "ui" as const };
    const home = createMovementPlace(
      {
        userId: "user_operator",
        source: "user",
        externalUid: "move_04_home",
        label: "Lausanne Home",
        aliases: ["Flat"],
        latitude: 46.5191,
        longitude: 6.6323,
        radiusMeters: 80
      },
      context
    );
    const replayed = createMovementPlace(
      {
        userId: "user_operator",
        source: "user",
        externalUid: "move_04_home",
        label: "Lausanne Home",
        aliases: ["Flat", "Primary home"],
        latitude: 46.5191,
        longitude: 6.6323,
        radiusMeters: 80
      },
      context
    );
    assert.equal(replayed.id, home.id);
    assert.equal(
      (
        getDatabase()
          .prepare(`SELECT COUNT(*) AS count FROM movement_places`)
          .get() as { count: number }
      ).count,
      1
    );

    const activityCountBeforeRejectedCreate = (
      getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count
           FROM activity_events
           WHERE event_type = 'movement_place_created'`
        )
        .get() as { count: number }
    ).count;
    assert.throws(
      () =>
        createMovementPlace(
          {
            userId: "user_operator",
            source: "user",
            externalUid: "move_04_duplicate",
            label: "Flat",
            latitude: 46.5192,
            longitude: 6.6323,
            radiusMeters: 50
          },
          context
        ),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 409);
        assert.equal(error.code, "movement_place_possible_duplicate");
        assert.deepEqual(
          (error.details?.candidates as Array<{ id: string }>).map(
            (candidate) => candidate.id
          ),
          [home.id]
        );
        return true;
      }
    );
    assert.equal(
      (
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS count
             FROM activity_events
             WHERE event_type = 'movement_place_created'`
          )
          .get() as { count: number }
      ).count,
      activityCountBeforeRejectedCreate
    );

    assert.throws(
      () =>
        createMovementPlace(
          {
            userId: "user_operator",
            source: "user",
            externalUid: "move_04_overlapping_radius",
            label: "Lausanne Home",
            latitude: 46.52,
            longitude: 6.6323,
            radiusMeters: 25
          },
          context
        ),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.code, "movement_place_possible_duplicate");
        return true;
      }
    );

    const distantFlat = createMovementPlace(
      {
        userId: "user_operator",
        source: "user",
        externalUid: "move_04_distant_flat",
        label: "Flat",
        latitude: 47.3769,
        longitude: 8.5417,
        radiusMeters: 50
      },
      context
    );
    assert.notEqual(distantFlat.id, home.id);
    assert.throws(
      () =>
        updateMovementPlace(
          distantFlat.id,
          {
            latitude: 46.51915,
            longitude: 6.6323
          },
          context,
          { userId: "user_operator" }
        ),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.code, "movement_place_possible_duplicate");
        return true;
      }
    );
    const unchanged = getDatabase()
      .prepare(
        `SELECT latitude, longitude
         FROM movement_places
         WHERE id = ?`
      )
      .get(distantFlat.id) as { latitude: number; longitude: number };
    assert.equal(unchanged.latitude, 47.3769);
    assert.equal(unchanged.longitude, 8.5417);

    assert.throws(
      () =>
        analyzeMovementUserBoxPreflight({
          userId: "user_operator",
          kind: "stay",
          startedAt: "2026-08-10T12:00:00.000Z",
          endedAt: "2026-08-10T11:00:00.000Z"
        }),
      /must end after it starts/i
    );
    assert.throws(
      () =>
        analyzeMovementUserBoxPreflight({
          userId: "user_operator",
          kind: "stay",
          startedAt: "2026-08-10T11:00:00.000Z",
          endedAt: "2026-08-10T12:00:00.000Z",
          rangeStart: "2026-08-10T10:00:00.000Z"
        }),
      /requires both range boundaries/i
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
