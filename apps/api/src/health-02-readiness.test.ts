import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import {
  canonicalMobileRequest,
  MOBILE_REQUEST_PROTOCOL
} from "./security/mobile-companion-request.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

type WorkoutRow = {
  id: string;
  external_uid: string;
  source: string;
  source_type: string;
  generated_from_habit_id: string | null;
  generated_from_check_in_id: string | null;
  reconciliation_status: string;
  distance_meters: number | null;
};

test("HEALTH-02 reconciles one pending habit workout without collapsing a nearby provider workout", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-health-02-"));
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: false,
    devrageMetricSync: false
  });

  try {
    const operatorCookie = issueTestOperatorSessionCookie(app);
    const habitResponse = await app.inject({
      method: "POST",
      url: "/api/v1/habits",
      headers: { cookie: operatorCookie },
      payload: {
        title: "Morning walk",
        description: "Generate a planned walk when this habit is completed.",
        status: "active",
        polarity: "positive",
        frequency: "daily",
        targetCount: 1,
        weekDays: [],
        linkedGoalIds: [],
        linkedProjectIds: [],
        linkedTaskIds: [],
        linkedValueIds: [],
        linkedPatternIds: [],
        linkedBehaviorIds: [],
        linkedBeliefIds: [],
        linkedModeIds: [],
        linkedReportIds: [],
        linkedBehaviorId: null,
        rewardXp: 12,
        penaltyXp: 8,
        generatedHealthEventTemplate: {
          enabled: true,
          workoutType: "walk",
          title: "Morning walk",
          durationMinutes: 45,
          xpReward: 25,
          tags: ["morning"],
          links: [],
          notesTemplate: "Habit-generated walk awaiting provider evidence."
        }
      }
    });
    assert.equal(habitResponse.statusCode, 201, habitResponse.body);
    const habitId = (habitResponse.json() as { habit: { id: string } }).habit
      .id;

    const checkInResponse = await app.inject({
      method: "POST",
      url: `/api/v1/habits/${habitId}/check-ins`,
      headers: { cookie: operatorCookie },
      payload: {
        dateKey: "2026-04-10",
        status: "done",
        note: "Completed before work."
      }
    });
    assert.equal(checkInResponse.statusCode, 200, checkInResponse.body);

    const generatedBeforeSync = getDatabase()
      .prepare(
        `SELECT id, external_uid, source, source_type, generated_from_habit_id,
                generated_from_check_in_id, reconciliation_status, distance_meters
         FROM health_workout_sessions
         WHERE generated_from_habit_id = ?`
      )
      .get(habitId) as WorkoutRow | undefined;
    assert.ok(generatedBeforeSync);
    assert.equal(
      generatedBeforeSync.reconciliation_status,
      "awaiting_import_match"
    );

    const pairingResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: { userId: "user_operator" }
    });
    assert.equal(pairingResponse.statusCode, 201, pairingResponse.body);
    const pairing = (
      pairingResponse.json() as {
        qrPayload: { sessionId: string; pairingToken: string };
      }
    ).qrPayload;

    const syncWorkout = async (input: {
      externalUid: string;
      startedAt: string;
      endedAt: string;
      distanceMeters: number;
    }) => {
      const payload = {
        sessionId: pairing.sessionId,
        pairingToken: pairing.pairingToken,
        device: {
          name: "Test iPhone",
          platform: "ios",
          appVersion: "1.0",
          sourceDevice: "Apple Watch"
        },
        permissions: {
          healthKitAuthorized: true,
          backgroundRefreshEnabled: true,
          motionReady: false,
          locationReady: false,
          screenTimeReady: false
        },
        workouts: [
          {
            ...input,
            workoutType: "walk",
            sourceDevice: "Apple Watch"
          }
        ]
      };
      const requestPath = "/api/v1/mobile/healthkit/sync";
      const issuedAt = new Date().toISOString();
      const nonce = randomUUID().replaceAll("-", "");
      const bodySha256 = createHash("sha256")
        .update(JSON.stringify(payload), "utf8")
        .digest("hex");
      const response = await app.inject({
        method: "POST",
        url: requestPath,
        headers: {
          "x-forge-mobile-request-protocol": MOBILE_REQUEST_PROTOCOL,
          "x-forge-mobile-session-id": pairing.sessionId,
          "x-forge-mobile-request-issued-at": issuedAt,
          "x-forge-mobile-request-nonce": nonce,
          "x-forge-mobile-body-sha256": bodySha256,
          "x-forge-mobile-request-signature": createHmac(
            "sha256",
            pairing.pairingToken
          )
            .update(
              canonicalMobileRequest({
                method: "POST",
                path: requestPath,
                sessionId: pairing.sessionId,
                issuedAt,
                nonce,
                bodySha256
              }),
              "utf8"
            )
            .digest("hex")
        },
        payload
      });
      assert.equal(response.statusCode, 200, response.body);
      return response.json() as {
        sync: {
          imported: {
            createdCount: number;
            updatedCount: number;
            mergedCount: number;
          };
        };
      };
    };

    const firstSync = await syncWorkout({
      externalUid: "apple-walk-primary",
      startedAt: "2026-04-10T07:10:00.000Z",
      endedAt: "2026-04-10T07:55:00.000Z",
      distanceMeters: 4_100
    });
    assert.deepEqual(
      {
        createdCount: firstSync.sync.imported.createdCount,
        updatedCount: firstSync.sync.imported.updatedCount,
        mergedCount: firstSync.sync.imported.mergedCount
      },
      {
        createdCount: 0,
        updatedCount: 0,
        mergedCount: 1
      }
    );

    const secondSync = await syncWorkout({
      externalUid: "apple-walk-nearby",
      startedAt: "2026-04-10T07:20:00.000Z",
      endedAt: "2026-04-10T08:05:00.000Z",
      distanceMeters: 3_800
    });
    assert.deepEqual(
      {
        createdCount: secondSync.sync.imported.createdCount,
        updatedCount: secondSync.sync.imported.updatedCount,
        mergedCount: secondSync.sync.imported.mergedCount
      },
      {
        createdCount: 1,
        updatedCount: 0,
        mergedCount: 0
      }
    );

    const replaySync = await syncWorkout({
      externalUid: "apple-walk-primary",
      startedAt: "2026-04-10T07:10:00.000Z",
      endedAt: "2026-04-10T07:55:00.000Z",
      distanceMeters: 4_250
    });
    assert.deepEqual(
      {
        createdCount: replaySync.sync.imported.createdCount,
        updatedCount: replaySync.sync.imported.updatedCount,
        mergedCount: replaySync.sync.imported.mergedCount
      },
      {
        createdCount: 0,
        updatedCount: 0,
        mergedCount: 1
      }
    );

    const rows = getDatabase()
      .prepare(
        `SELECT id, external_uid, source, source_type, generated_from_habit_id,
                generated_from_check_in_id, reconciliation_status, distance_meters
         FROM health_workout_sessions
         WHERE user_id = 'user_operator'
         ORDER BY external_uid ASC`
      )
      .all() as WorkoutRow[];
    assert.equal(rows.length, 2);

    const reconciled = rows.find(
      (row) => row.external_uid === "apple-walk-primary"
    );
    assert.ok(reconciled);
    assert.equal(reconciled.id, generatedBeforeSync.id);
    assert.equal(reconciled.source, "apple_health");
    assert.equal(reconciled.source_type, "reconciled");
    assert.equal(reconciled.generated_from_habit_id, habitId);
    assert.equal(
      reconciled.generated_from_check_in_id,
      generatedBeforeSync.generated_from_check_in_id
    );
    assert.equal(reconciled.reconciliation_status, "merged");
    assert.equal(reconciled.distance_meters, 4_250);

    const nearby = rows.find((row) => row.external_uid === "apple-walk-nearby");
    assert.ok(nearby);
    assert.notEqual(nearby.id, reconciled.id);
    assert.equal(nearby.source, "apple_health");
    assert.equal(nearby.source_type, "healthkit");
    assert.equal(nearby.generated_from_habit_id, null);
    assert.equal(nearby.generated_from_check_in_id, null);
    assert.equal(nearby.reconciliation_status, "standalone");
    assert.equal(nearby.distance_meters, 3_800);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
