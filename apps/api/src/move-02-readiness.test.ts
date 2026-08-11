import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import {
  createMovementPlace,
  ingestMovementSync,
  resolveMovementEvidenceConfidence
} from "./movement.js";

test("MOVE-02 explains confidence from recorded, inferred, user-authored, and missing evidence", () => {
  assert.deepEqual(
    resolveMovementEvidenceConfidence({
      kind: "stay",
      sourceKind: "automatic",
      origin: "recorded",
      stay: { sampleCount: 6, radiusMeters: 40 }
    }),
    {
      level: "high",
      basis: "recorded_samples",
      reason: "6 recorded samples within a 40 m stay radius."
    }
  );
  assert.equal(
    resolveMovementEvidenceConfidence({
      kind: "stay",
      sourceKind: "automatic",
      origin: "recorded",
      stay: { sampleCount: 2, radiusMeters: 180 }
    }).level,
    "medium"
  );
  assert.equal(
    resolveMovementEvidenceConfidence({
      kind: "stay",
      sourceKind: "automatic",
      origin: "recorded",
      stay: { sampleCount: 1, radiusMeters: 400 }
    }).level,
    "low"
  );
  assert.deepEqual(
    resolveMovementEvidenceConfidence({
      kind: "trip",
      sourceKind: "automatic",
      origin: "recorded",
      trip: {
        points: [8, 12, 18, 22].map((accuracyMeters) => ({ accuracyMeters }))
      }
    }),
    {
      level: "high",
      basis: "recorded_points",
      reason: "4 recorded location points with 15 m median reported accuracy."
    }
  );
  assert.equal(
    resolveMovementEvidenceConfidence({
      kind: "trip",
      sourceKind: "automatic",
      origin: "recorded",
      trip: { points: [{ accuracyMeters: 40 }, { accuracyMeters: 60 }] }
    }).level,
    "medium"
  );
  assert.equal(
    resolveMovementEvidenceConfidence({
      kind: "trip",
      sourceKind: "automatic",
      origin: "recorded",
      trip: { points: [{ accuracyMeters: null }] }
    }).level,
    "low"
  );
  assert.equal(
    resolveMovementEvidenceConfidence({
      kind: "trip",
      sourceKind: "automatic",
      origin: "recorded",
      trip: { points: [] }
    }).level,
    "unknown"
  );
  assert.deepEqual(
    [
      resolveMovementEvidenceConfidence({
        kind: "stay",
        sourceKind: "automatic",
        origin: "continued_stay"
      }),
      resolveMovementEvidenceConfidence({
        kind: "trip",
        sourceKind: "automatic",
        origin: "repaired_gap"
      }),
      resolveMovementEvidenceConfidence({
        kind: "missing",
        sourceKind: "automatic",
        origin: "missing"
      }),
      resolveMovementEvidenceConfidence({
        kind: "stay",
        sourceKind: "user_defined",
        origin: "user_defined"
      })
    ].map(({ level, basis }) => ({ level, basis })),
    [
      { level: "medium", basis: "inferred" },
      { level: "low", basis: "inferred" },
      { level: "unknown", basis: "missing" },
      { level: "high", basis: "user_authored" }
    ]
  );
  assert.match(
    resolveMovementEvidenceConfidence({
      kind: "stay",
      sourceKind: "user_defined",
      origin: "user_defined"
    }).reason,
    /not independently verified by movement sensors/i
  );
  assert.equal(
    resolveMovementEvidenceConfidence({
      kind: "trip",
      sourceKind: "automatic",
      origin: "recorded",
      isInvalid: true,
      trip: {
        points: [5, 5, 5, 5].map((accuracyMeters) => ({ accuracyMeters }))
      }
    }).level,
    "low"
  );
});

test("MOVE-02 respects the configured place radius while preserving explicit source identity", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-move-02-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const place = createMovementPlace(
      {
        userId: "user_operator",
        source: "user",
        label: "Small clinic building",
        latitude: 0,
        longitude: 0,
        radiusMeters: 25
      },
      { actor: "Test operator", source: "ui" }
    );
    const now = new Date().toISOString();
    getDatabase()
      .prepare(
        `INSERT INTO companion_pairing_sessions (
           id, user_id, label, pairing_token, status, capability_flags_json,
           api_base_url, expires_at, created_at, updated_at
         ) VALUES (?, ?, 'MOVE-02 fixture', ?, 'paired', '[]', '', ?, ?, ?)`
      )
      .run(
        "pairing_move_02",
        "user_operator",
        "move-02-pairing-token",
        "2099-01-01T00:00:00.000Z",
        now,
        now
      );

    ingestMovementSync(
      { id: "pairing_move_02", user_id: "user_operator" },
      {
        stays: [
          {
            externalUid: "stay_outside_radius",
            startedAt: "2026-08-10T08:00:00.000Z",
            endedAt: "2026-08-10T09:00:00.000Z",
            centerLatitude: 0.0007,
            centerLongitude: 0,
            radiusMeters: 10
          },
          {
            externalUid: "stay_inside_radius",
            startedAt: "2026-08-10T10:00:00.000Z",
            endedAt: "2026-08-10T11:00:00.000Z",
            centerLatitude: 0.0001,
            centerLongitude: 0,
            radiusMeters: 10
          },
          {
            externalUid: "stay_explicit_identity",
            startedAt: "2026-08-10T12:00:00.000Z",
            endedAt: "2026-08-10T13:00:00.000Z",
            centerLatitude: 0.01,
            centerLongitude: 0,
            radiusMeters: 10,
            placeExternalUid: place.externalUid
          }
        ]
      }
    );

    const rows = getDatabase()
      .prepare(
        `SELECT external_uid, place_id
         FROM movement_stays
         WHERE user_id = ?
         ORDER BY started_at ASC`
      )
      .all("user_operator") as Array<{
      external_uid: string;
      place_id: string | null;
    }>;
    assert.deepEqual(
      rows.map((row) => ({ ...row })),
      [
        { external_uid: "stay_outside_radius", place_id: null },
        { external_uid: "stay_inside_radius", place_id: place.id },
        { external_uid: "stay_explicit_identity", place_id: place.id }
      ]
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
