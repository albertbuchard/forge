import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import {
  createMovementPlace,
  getMovementSelectionAggregate,
  ingestMovementSync
} from "./movement.js";
import { createUser } from "./repositories/users.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

test("MOVE-03 scopes and bounds segment, range, and place aggregates with explicit units", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-move-03-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const otherUser = createUser({
      kind: "human",
      handle: "move-03-other",
      displayName: "MOVE-03 other owner",
      description: "",
      accentColor: "#336699"
    });
    const home = createMovementPlace(
      {
        userId: "user_operator",
        source: "user",
        label: "Lausanne Home",
        aliases: ["Flat", "Primary home"],
        latitude: 46.5191,
        longitude: 6.6323,
        radiusMeters: 80
      },
      { actor: "MOVE-03 fixture", source: "ui" }
    );
    const otherPlace = createMovementPlace(
      {
        userId: otherUser.id,
        source: "user",
        label: "Other private place",
        aliases: ["Do not expose"],
        latitude: 47,
        longitude: 8,
        radiusMeters: 80
      },
      { actor: "MOVE-03 fixture", source: "ui" }
    );
    const now = new Date().toISOString();
    const insertPairing = getDatabase().prepare(
      `INSERT INTO companion_pairing_sessions (
         id, user_id, label, pairing_token, status, capability_flags_json,
         api_base_url, expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'paired', '[]', '', ?, ?, ?)`
    );
    insertPairing.run(
      "pairing_move_03_operator",
      "user_operator",
      "MOVE-03 operator fixture",
      "move-03-operator-pairing-token",
      "2099-01-01T00:00:00.000Z",
      now,
      now
    );
    insertPairing.run(
      "pairing_move_03_other",
      otherUser.id,
      "MOVE-03 other fixture",
      "move-03-other-pairing-token",
      "2099-01-01T00:00:00.000Z",
      now,
      now
    );

    ingestMovementSync(
      { id: "pairing_move_03_operator", user_id: "user_operator" },
      {
        stays: [
          {
            externalUid: "stay_ends_at_range_start",
            startedAt: "2026-08-10T09:00:00.000Z",
            endedAt: "2026-08-10T10:00:00.000Z",
            centerLatitude: 46.5191,
            centerLongitude: 6.6323,
            placeExternalUid: home.externalUid
          },
          {
            externalUid: "stay_inside_range",
            startedAt: "2026-08-10T10:15:00.000Z",
            endedAt: "2026-08-10T10:45:00.000Z",
            centerLatitude: 46.5191,
            centerLongitude: 6.6323,
            placeExternalUid: home.externalUid
          },
          {
            externalUid: "stay_starts_at_range_end",
            startedAt: "2026-08-10T12:00:00.000Z",
            endedAt: "2026-08-10T12:30:00.000Z",
            centerLatitude: 46.5191,
            centerLongitude: 6.6323,
            placeExternalUid: home.externalUid
          }
        ],
        trips: [
          {
            externalUid: "trip_crosses_range_start",
            startedAt: "2026-08-10T09:30:00.000Z",
            endedAt: "2026-08-10T10:30:00.000Z",
            startPlaceExternalUid: home.externalUid,
            endPlaceExternalUid: home.externalUid,
            distanceMeters: 1_000,
            caloriesKcal: 100,
            averageSpeedMps: 4
          },
          {
            externalUid: "trip_inside_range",
            startedAt: "2026-08-10T11:00:00.000Z",
            endedAt: "2026-08-10T11:30:00.000Z",
            startPlaceExternalUid: home.externalUid,
            endPlaceExternalUid: home.externalUid,
            distanceMeters: 300,
            caloriesKcal: 30,
            averageSpeedMps: 2
          }
        ]
      }
    );
    ingestMovementSync(
      { id: "pairing_move_03_other", user_id: otherUser.id },
      {
        stays: [
          {
            externalUid: "foreign_stay",
            startedAt: "2026-08-10T10:20:00.000Z",
            endedAt: "2026-08-10T10:40:00.000Z",
            centerLatitude: 47,
            centerLongitude: 8,
            placeExternalUid: otherPlace.externalUid
          }
        ]
      }
    );
    getDatabase()
      .prepare(
        `UPDATE movement_trips
         SET distance_meters = 300,
             average_speed_mps = 2
         WHERE external_uid = 'trip_inside_range'`
      )
      .run();

    const aggregate = getMovementSelectionAggregate({
      from: "2026-08-10T10:00:00.000Z",
      to: "2026-08-10T12:00:00.000Z",
      placeIds: [home.id],
      userIds: ["user_operator"]
    });
    assert.deepEqual(
      {
        startedAt: aggregate.startedAt,
        endedAt: aggregate.endedAt,
        rangeSemantics: aggregate.rangeSemantics,
        durationSeconds: aggregate.durationSeconds,
        stayCount: aggregate.stayCount,
        tripCount: aggregate.tripCount,
        distanceMeters: aggregate.distanceMeters,
        distanceAttribution: aggregate.distanceAttribution,
        boundaryCrossingTripCount: aggregate.boundaryCrossingTripCount,
        caloriesKcal: aggregate.caloriesKcal,
        averageSpeedMps: aggregate.averageSpeedMps,
        placeLabels: aggregate.placeLabels,
        placeAliases: aggregate.placeAliases,
        units: aggregate.units
      },
      {
        startedAt: "2026-08-10T10:00:00.000Z",
        endedAt: "2026-08-10T12:00:00.000Z",
        rangeSemantics: "start_inclusive_end_exclusive",
        durationSeconds: 7_200,
        stayCount: 1,
        tripCount: 2,
        distanceMeters: 300,
        distanceAttribution: "partial",
        boundaryCrossingTripCount: 1,
        caloriesKcal: 30,
        averageSpeedMps: 2,
        placeLabels: ["Lausanne Home"],
        placeAliases: ["Flat", "Primary home"],
        units: {
          duration: "seconds",
          distance: "meters",
          energy: "kilocalories",
          speed: "meters_per_second"
        }
      }
    );

    const foreignStayId = (
      getDatabase()
        .prepare(`SELECT id FROM movement_stays WHERE external_uid = ?`)
        .get("foreign_stay") as { id: string }
    ).id;
    const scoped = getMovementSelectionAggregate({
      stayIds: [foreignStayId],
      userIds: ["user_operator"]
    });
    assert.equal(scoped.stayCount, 0);
    assert.equal(scoped.taskRunCount, 0);
    assert.equal(scoped.trackedWorkSeconds, 0);
    assert.equal(scoped.estimatedScreenTimeSeconds, 0);
    assert.equal(scoped.pickupCount, 0);
    assert.equal(scoped.notificationCount, 0);
    assert.deepEqual(scoped.placeLabels, []);
    assert.deepEqual(scoped.placeAliases, []);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/movement/selection",
      headers: { cookie },
      payload: { stayIds: [foreignStayId, foreignStayId] }
    });
    assert.equal(duplicate.statusCode, 400, duplicate.body);
    assert.match(duplicate.body, /duplicate IDs/i);

    const oversizedRange = await app.inject({
      method: "POST",
      url: "/api/v1/movement/selection",
      headers: { cookie },
      payload: {
        from: "2025-01-01T00:00:00.000Z",
        to: "2026-08-10T00:00:00.000Z"
      }
    });
    assert.equal(oversizedRange.statusCode, 400, oversizedRange.body);
    assert.match(oversizedRange.body, /cannot exceed 366 days/i);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
