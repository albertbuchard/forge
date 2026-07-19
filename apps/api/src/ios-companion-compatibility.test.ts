import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";

const LAST_SHIPPED_TESTFLIGHT_VERSION = "1.0.152";

test("the last shipped iOS companion contract remains accepted additively", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-ios-1-0-152-compatibility-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorResponse = await app.inject({
      method: "GET",
      url: "/api/v1/auth/operator-session",
      headers: { host: "127.0.0.1:4317" }
    });
    assert.equal(operatorResponse.statusCode, 200, operatorResponse.body);
    const operatorCookie = operatorResponse.cookies[0];
    assert.ok(operatorCookie);

    const pairingResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: {
        cookie: `${operatorCookie.name}=${operatorCookie.value}`,
        host: "127.0.0.1:4317"
      },
      payload: {
        userId: "user_operator",
        label: "iOS 1.0.152 compatibility",
        transportMode: "manual-http",
        publicUrl: "http://127.0.0.1:4317"
      }
    });
    assert.equal(pairingResponse.statusCode, 201, pairingResponse.body);
    const pairing = (
      pairingResponse.json() as {
        qrPayload: { sessionId: string; pairingToken: string };
      }
    ).qrPayload;
    const device = {
      name: "Compatibility iPhone",
      platform: "ios",
      appVersion: LAST_SHIPPED_TESTFLIGHT_VERSION,
      sourceDevice: "iPhone"
    };

    const heartbeatResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/pairing/heartbeat",
      payload: {
        sessionId: pairing.sessionId,
        pairingToken: pairing.pairingToken,
        device
      }
    });
    assert.equal(heartbeatResponse.statusCode, 200, heartbeatResponse.body);

    const sourceStates = {
      health: {
        desiredEnabled: true,
        appliedEnabled: true,
        authorizationStatus: "approved",
        syncEligible: true,
        lastObservedAt: "2026-06-12T18:00:00.000Z",
        metadata: {}
      },
      movement: {
        desiredEnabled: true,
        appliedEnabled: true,
        authorizationStatus: "approved",
        syncEligible: true,
        lastObservedAt: "2026-06-12T18:00:00.000Z",
        metadata: {}
      },
      screenTime: {
        desiredEnabled: false,
        appliedEnabled: false,
        authorizationStatus: "disabled",
        syncEligible: false,
        lastObservedAt: "2026-06-12T18:00:00.000Z",
        metadata: {}
      }
    };
    const requestedFamilies = [
      "sleep_nights",
      "sleep_segments",
      "sleep_raw_records",
      "workout_summaries",
      "workout_archive",
      "workout_time_series",
      "workout_routes",
      "workout_tombstones",
      "vitals",
      "movement",
      "screen_time"
    ];

    const startResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/healthkit/sync-sessions",
      payload: {
        sessionId: pairing.sessionId,
        pairingToken: pairing.pairingToken,
        device,
        permissions: {
          healthKitAuthorized: true,
          backgroundRefreshEnabled: true,
          motionReady: true,
          locationReady: true,
          screenTimeReady: false
        },
        sourceStates,
        schemaVersion: "healthkit-sync-v2",
        requestedFamilies,
        expectedCounts: {},
        metadata: {
          clientMode: "chunked",
          clientPlatform: "ios",
          clientChunkingVersion: "healthkit-chunk-v2",
          resumeSyncSessionId: ""
        }
      }
    });
    assert.equal(startResponse.statusCode, 200, startResponse.body);
    const upload = (
      startResponse.json() as {
        upload: {
          syncSessionId: string;
          schemaVersion: string;
          chunkPayloadEncoding: string;
          acceptedFamilies: string[];
        };
      }
    ).upload;
    assert.equal(upload.schemaVersion, "healthkit-sync-v2");
    assert.equal(upload.chunkPayloadEncoding, "payload_json_base64");
    assert.deepEqual(upload.acceptedFamilies, requestedFamilies);

    const movementPayload = { movement: {} };
    const movementPayloadBytes = Buffer.from(
      JSON.stringify(movementPayload),
      "utf8"
    );
    const chunkResponse = await app.inject({
      method: "POST",
      url: `/api/v1/mobile/healthkit/sync-sessions/${upload.syncSessionId}/chunks`,
      payload: {
        chunkId: "ios-1-0-152-movement-empty",
        sequence: 0,
        family: "movement",
        recordCount: 0,
        byteCount: movementPayloadBytes.length,
        checksumSha256: createHash("sha256")
          .update(movementPayloadBytes)
          .digest("hex"),
        payloadJsonBase64: movementPayloadBytes.toString("base64")
      }
    });
    assert.equal(chunkResponse.statusCode, 200, chunkResponse.body);

    const statusResponse = await app.inject({
      method: "GET",
      url:
        `/api/v1/mobile/healthkit/sync-sessions/${upload.syncSessionId}` +
        `?sessionId=${pairing.sessionId}` +
        `&pairingToken=${pairing.pairingToken}` +
        "&includeReceivedChunkIds=true" +
        "&includeWorkoutImportExternalUids=true" +
        "&includeWorkoutImportState=true"
    });
    assert.equal(statusResponse.statusCode, 200, statusResponse.body);

    const completeResponse = await app.inject({
      method: "POST",
      url: `/api/v1/mobile/healthkit/sync-sessions/${upload.syncSessionId}/complete`,
      payload: { finalCursor: {}, expectedCounts: {} }
    });
    assert.equal(completeResponse.statusCode, 200, completeResponse.body);

    const legacySyncResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/healthkit/sync",
      payload: {
        sessionId: pairing.sessionId,
        pairingToken: pairing.pairingToken,
        device,
        permissions: {
          healthKitAuthorized: true,
          backgroundRefreshEnabled: true,
          motionReady: true,
          locationReady: true,
          screenTimeReady: false
        },
        sourceStates,
        movement: {},
        screenTime: {}
      }
    });
    assert.equal(legacySyncResponse.statusCode, 200, legacySyncResponse.body);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
