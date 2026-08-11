import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import {
  ingestMovementSync,
  resolveMovementDayRange
} from "./movement.js";
import { buildOpenApiDocument } from "./openapi.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

test("MOVE-02 uses DST-aware local-day boundaries and interval overlap", async () => {
  const spring = resolveMovementDayRange({
    date: "2026-03-29",
    timeZone: "Europe/Zurich"
  });
  assert.deepEqual(spring, {
    date: "2026-03-29",
    timeZone: "Europe/Zurich",
    startAt: "2026-03-28T23:00:00.000Z",
    endAt: "2026-03-29T22:00:00.000Z",
    durationSeconds: 23 * 60 * 60
  });
  const autumn = resolveMovementDayRange({
    date: "2026-10-25",
    timeZone: "Europe/Zurich"
  });
  assert.deepEqual(autumn, {
    date: "2026-10-25",
    timeZone: "Europe/Zurich",
    startAt: "2026-10-24T22:00:00.000Z",
    endAt: "2026-10-25T23:00:00.000Z",
    durationSeconds: 25 * 60 * 60
  });

  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-move-02-timezone-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const now = new Date().toISOString();
    getDatabase()
      .prepare(
        `INSERT INTO companion_pairing_sessions (
           id, user_id, label, pairing_token, status, capability_flags_json,
           api_base_url, expires_at, created_at, updated_at
         ) VALUES (?, ?, 'MOVE-02 timezone fixture', ?, 'paired', '[]', '', ?, ?, ?)`
      )
      .run(
        "pairing_move_02_timezone",
        "user_operator",
        "move-02-timezone-pairing-token",
        "2099-01-01T00:00:00.000Z",
        now,
        now
      );

    ingestMovementSync(
      { id: "pairing_move_02_timezone", user_id: "user_operator" },
      {
        stays: [
          {
            externalUid: "previous_day_only",
            startedAt: "2026-03-28T22:00:00.000Z",
            endedAt: "2026-03-28T22:30:00.000Z",
            centerLatitude: 47,
            centerLongitude: 8
          },
          {
            externalUid: "early_local_day",
            startedAt: "2026-03-28T23:30:00.000Z",
            endedAt: "2026-03-29T00:00:00.000Z",
            centerLatitude: 47,
            centerLongitude: 8
          },
          {
            externalUid: "late_local_day",
            startedAt: "2026-03-29T21:15:00.000Z",
            endedAt: "2026-03-29T21:45:00.000Z",
            centerLatitude: 47,
            centerLongitude: 8
          },
          {
            externalUid: "next_day_only",
            startedAt: "2026-03-29T22:00:00.000Z",
            endedAt: "2026-03-29T22:30:00.000Z",
            centerLatitude: 47,
            centerLongitude: 8
          }
        ],
        trips: [
          {
            externalUid: "trip_crosses_local_midnight",
            startedAt: "2026-03-28T22:45:00.000Z",
            endedAt: "2026-03-28T23:15:00.000Z",
            distanceMeters: 1_000,
            movingSeconds: 1_800,
            caloriesKcal: 100,
            expectedMet: 3
          },
          {
            externalUid: "trip_inside_local_day",
            startedAt: "2026-03-29T20:00:00.000Z",
            endedAt: "2026-03-29T20:30:00.000Z",
            distanceMeters: 300,
            movingSeconds: 1_800,
            caloriesKcal: 30,
            expectedMet: 3
          }
        ]
      }
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/movement/day?date=2026-03-29&timeZone=Europe%2FZurich",
      headers: { cookie }
    });
    assert.equal(response.statusCode, 200, response.body);
    const movement = (
      response.json() as {
        movement: {
          date: string;
          timeZone: string;
          dayStartAt: string;
          dayEndAt: string;
          dayDurationSeconds: number;
          summary: {
            boundaryCrossingTripCount: number;
            totalDistanceMeters: number;
            caloriesKcal: number;
          };
          stays: Array<{ externalUid: string }>;
          trips: Array<{ externalUid: string }>;
          segments: Array<{
            startedAt: string;
            endedAt: string;
            durationSeconds: number;
            distanceMeters: number;
            distanceAttribution:
              | "complete"
              | "unavailable_at_day_boundary";
            rawTripIds: string[];
          }>;
          provenance: { completeness: string; statusDetail: string };
        };
      }
    ).movement;
    assert.equal(movement.date, "2026-03-29");
    assert.equal(movement.timeZone, "Europe/Zurich");
    assert.equal(movement.dayStartAt, spring.startAt);
    assert.equal(movement.dayEndAt, spring.endAt);
    assert.equal(movement.dayDurationSeconds, 23 * 60 * 60);
    assert.deepEqual(
      movement.stays.map((stay) => stay.externalUid).sort(),
      ["early_local_day", "late_local_day"]
    );
    assert.deepEqual(
      movement.trips.map((trip) => trip.externalUid).sort(),
      ["trip_crosses_local_midnight", "trip_inside_local_day"]
    );
    assert.equal(movement.summary.boundaryCrossingTripCount, 1);
    assert.equal(movement.provenance.completeness, "partial");
    assert.match(movement.provenance.statusDetail, /cannot be divided exactly/i);
    assert.ok(movement.segments.length > 0);
    assert.ok(
      movement.segments.every(
        (segment) =>
          segment.startedAt >= spring.startAt &&
          segment.endedAt <= spring.endAt &&
          segment.durationSeconds > 0
      )
    );
    assert.ok(movement.summary.totalDistanceMeters < 1_300);
    assert.equal(movement.summary.caloriesKcal, 30);

    const invalidTimeZone = await app.inject({
      method: "GET",
      url: "/api/v1/movement/day?date=2026-03-29&timeZone=Not%2FA_Time_Zone",
      headers: { cookie }
    });
    assert.equal(invalidTimeZone.statusCode, 400, invalidTimeZone.body);
    assert.match(invalidTimeZone.body, /valid IANA timezone/i);
    const invalidDate = await app.inject({
      method: "GET",
      url: "/api/v1/movement/day?date=2026-02-30&timeZone=UTC",
      headers: { cookie }
    });
    assert.equal(invalidDate.statusCode, 400, invalidDate.body);
    assert.match(invalidDate.body, /real calendar date/i);

    const operation = buildOpenApiDocument().paths?.[
      "/api/v1/movement/day"
    ] as
      | { get?: { parameters?: Array<{ name?: string }> } }
      | undefined;
    assert.ok(
      operation?.get?.parameters?.some(
        (parameter) => parameter.name === "timeZone"
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
