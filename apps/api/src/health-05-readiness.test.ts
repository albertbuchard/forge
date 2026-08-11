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

type VitalMetricInput = {
  metric: string;
  label: string;
  category: string;
  unit: string;
  displayUnit: string;
  aggregation: "discrete" | "cumulative";
  average?: number;
  minimum?: number;
  maximum?: number;
  latest?: number;
  total?: number;
  sampleCount: number;
  latestSampleAt: string;
};

function discreteMetric(
  metric: string,
  label: string,
  category: string,
  unit: string,
  value: number,
  latestSampleAt: string
): VitalMetricInput {
  return {
    metric,
    label,
    category,
    unit,
    displayUnit: unit,
    aggregation: "discrete",
    average: value,
    minimum: value,
    maximum: value,
    latest: value,
    sampleCount: 1,
    latestSampleAt
  };
}

test("HEALTH-05 preserves comparable vital units and exposes source-quality decisions", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-health-05-"));
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: false,
    devrageMetricSync: false
  });

  try {
    const operatorCookie = issueTestOperatorSessionCookie(app);
    const pairingResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: { cookie: operatorCookie, host: "127.0.0.1:4317" },
      payload: { userId: "user_operator" }
    });
    assert.equal(pairingResponse.statusCode, 201, pairingResponse.body);
    const pairing = (
      pairingResponse.json() as {
        qrPayload: { sessionId: string; pairingToken: string };
      }
    ).qrPayload;

    const syncVitals = async (
      daySummaries: Array<{
        dateKey: string;
        sourceTimezone: string;
        metrics: VitalMetricInput[];
      }>
    ) => {
      const payload = {
        sessionId: pairing.sessionId,
        pairingToken: pairing.pairingToken,
        device: {
          name: "Test iPhone",
          platform: "ios",
          appVersion: "1.0",
          sourceDevice: "Apple Watch Ultra"
        },
        permissions: {
          healthKitAuthorized: true,
          backgroundRefreshEnabled: true,
          motionReady: false,
          locationReady: false,
          screenTimeReady: false
        },
        vitals: { daySummaries }
      };
      const requestPath = "/api/v1/mobile/healthkit/sync";
      const issuedAt = new Date().toISOString();
      const nonce = randomUUID().replaceAll("-", "");
      const bodySha256 = createHash("sha256")
        .update(JSON.stringify(payload), "utf8")
        .digest("hex");
      return app.inject({
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
    };

    const accepted = await syncVitals([
      {
        dateKey: "2026-04-10",
        sourceTimezone: "Europe/Zurich",
        metrics: [
          discreteMetric(
            "bodyMass",
            "Body mass",
            "composition",
            "kg",
            70,
            "2026-04-10T07:00:00.000Z"
          ),
          discreteMetric(
            "bodyTemperature",
            "Body temperature",
            "temperature",
            "°C",
            37,
            "2026-04-10T07:00:00.000Z"
          ),
          discreteMetric(
            "oxygenSaturation",
            "Oxygen saturation",
            "breathing",
            "%",
            98,
            "2026-04-10T07:00:00.000Z"
          )
        ]
      },
      {
        dateKey: "2026-04-11",
        sourceTimezone: "Europe/Zurich",
        metrics: [
          discreteMetric(
            "bodyMass",
            "Body mass",
            "composition",
            "lb",
            154.323_583_529,
            "2026-04-11T07:00:00.000Z"
          ),
          discreteMetric(
            "bodyTemperature",
            "Body temperature",
            "temperature",
            "°F",
            98.6,
            "2026-04-11T07:00:00.000Z"
          ),
          discreteMetric(
            "oxygenSaturation",
            "Oxygen saturation",
            "breathing",
            "fraction",
            0.98,
            "2026-04-11T07:00:00.000Z"
          ),
          discreteMetric(
            "respiratoryRate",
            "Respiratory rate",
            "breathing",
            "br/min",
            100,
            "2026-04-11T07:00:00.000Z"
          )
        ]
      },
      {
        dateKey: "2026-04-12",
        sourceTimezone: "Europe/Zurich",
        metrics: [
          discreteMetric(
            "oxygenSaturation",
            "Oxygen saturation",
            "breathing",
            "%",
            101,
            "2026-04-12T07:00:00.000Z"
          ),
          discreteMetric(
            "respiratoryRate",
            "Respiratory rate",
            "breathing",
            "br/min",
            100.1,
            "2026-04-12T07:00:00.000Z"
          )
        ]
      }
    ]);
    assert.equal(accepted.statusCode, 200, accepted.body);

    const vitalsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/health/vitals",
      headers: { cookie: operatorCookie }
    });
    assert.equal(vitalsResponse.statusCode, 200, vitalsResponse.body);
    const vitals = (
      vitalsResponse.json() as {
        vitals: {
          summary: {
            sourceQuality: {
              sourceSystems: string[];
              sourceDevices: string[];
              convertedMetricDays: number;
              outlierMetricDays: number;
              duplicatePolicy: string;
            };
          };
          metrics: Array<{
            metric: string;
            unit: string;
            latestValue: number | null;
            baselineValue: number | null;
            deltaValue: number | null;
            sourceQuality: {
              inputUnits: string[];
              convertedDayCount: number;
              outlierDayCount: number;
            };
            days: Array<{
              dateKey: string;
              latest: number | null;
              qualityFlags: string[];
              sourceSystems: string[];
              sourceDevices: string[];
              inputUnits: string[];
              unitNormalizations: string[];
            }>;
          }>;
        };
      }
    ).vitals;

    assert.deepEqual(vitals.summary.sourceQuality, {
      sourceSystems: ["apple_health"],
      sourceDevices: ["Apple Watch Ultra"],
      convertedMetricDays: 3,
      outlierMetricDays: 2,
      unrecognizedMetricDays: 0,
      duplicatePolicy: "reject_same_metric_per_day"
    });

    const bodyMass = vitals.metrics.find(
      (metric) => metric.metric === "bodyMass"
    );
    assert.ok(bodyMass);
    assert.equal(bodyMass.unit, "kg");
    assert.equal(bodyMass.latestValue, 70);
    assert.equal(bodyMass.baselineValue, 70);
    assert.equal(bodyMass.deltaValue, 0);
    assert.deepEqual(bodyMass.sourceQuality, {
      sourceSystems: ["apple_health"],
      sourceDevices: ["Apple Watch Ultra"],
      inputUnits: ["kg", "lb"],
      convertedDayCount: 1,
      outlierDayCount: 0,
      unrecognizedDayCount: 0,
      duplicatePolicy: "reject_same_metric_per_day"
    });
    assert.deepEqual(bodyMass.days.at(-1), {
      dateKey: "2026-04-11",
      average: 70,
      minimum: 70,
      maximum: 70,
      latest: 70,
      total: null,
      sampleCount: 1,
      latestSampleAt: "2026-04-11T07:00:00.000Z",
      qualityFlags: [],
      sourceSystems: ["apple_health"],
      sourceDevices: ["Apple Watch Ultra"],
      inputUnits: ["lb"],
      unitNormalizations: ["converted"]
    });

    const bodyTemperature = vitals.metrics.find(
      (metric) => metric.metric === "bodyTemperature"
    );
    assert.ok(bodyTemperature);
    assert.equal(bodyTemperature.unit, "°C");
    assert.equal(bodyTemperature.latestValue, 37);
    assert.equal(bodyTemperature.deltaValue, 0);

    const oxygen = vitals.metrics.find(
      (metric) => metric.metric === "oxygenSaturation"
    );
    assert.ok(oxygen);
    assert.equal(oxygen.latestValue, 101);
    assert.equal(oxygen.baselineValue, 98);
    assert.equal(oxygen.deltaValue, null);
    assert.equal(oxygen.sourceQuality.outlierDayCount, 1);
    assert.deepEqual(oxygen.days.at(-1)?.qualityFlags, [
      "outside_expected_range"
    ]);

    const respiratory = vitals.metrics.find(
      (metric) => metric.metric === "respiratoryRate"
    );
    assert.ok(respiratory);
    assert.deepEqual(respiratory.days[0]?.qualityFlags, []);
    assert.deepEqual(respiratory.days[1]?.qualityFlags, [
      "outside_expected_range"
    ]);

    const duplicate = await syncVitals([
      {
        dateKey: "2026-04-13",
        sourceTimezone: "Europe/Zurich",
        metrics: [
          discreteMetric(
            "bodyMass",
            "Body mass",
            "composition",
            "kg",
            70,
            "2026-04-13T07:00:00.000Z"
          ),
          discreteMetric(
            "bodyMass",
            "Body mass",
            "composition",
            "lb",
            154.323_583_529,
            "2026-04-13T07:00:00.000Z"
          )
        ]
      }
    ]);
    assert.equal(duplicate.statusCode, 400, duplicate.body);
    assert.equal(
      (duplicate.json() as { code: string }).code,
      "vital_metric_duplicate"
    );

    const duplicateDate = await syncVitals([
      {
        dateKey: "2026-04-15",
        sourceTimezone: "Europe/Zurich",
        metrics: [
          discreteMetric(
            "bodyMass",
            "Body mass",
            "composition",
            "kg",
            70,
            "2026-04-15T07:00:00.000Z"
          )
        ]
      },
      {
        dateKey: "2026-04-15",
        sourceTimezone: "Europe/Zurich",
        metrics: [
          discreteMetric(
            "oxygenSaturation",
            "Oxygen saturation",
            "breathing",
            "%",
            98,
            "2026-04-15T07:00:00.000Z"
          )
        ]
      }
    ]);
    assert.equal(duplicateDate.statusCode, 400, duplicateDate.body);
    assert.equal(
      (duplicateDate.json() as { code: string }).code,
      "vital_day_summary_duplicate"
    );

    const unsupported = await syncVitals([
      {
        dateKey: "2026-04-14",
        sourceTimezone: "Europe/Zurich",
        metrics: [
          discreteMetric(
            "bodyMass",
            "Body mass",
            "composition",
            "stone",
            11,
            "2026-04-14T07:00:00.000Z"
          )
        ]
      }
    ]);
    assert.equal(unsupported.statusCode, 400, unsupported.body);
    assert.equal(
      (unsupported.json() as { code: string }).code,
      "vital_metric_unit_unsupported"
    );

    const rejectedRows = getDatabase()
      .prepare(
        `SELECT date_key
         FROM health_daily_summaries
         WHERE user_id = 'user_operator'
           AND summary_type = 'vitals'
           AND date_key IN ('2026-04-13', '2026-04-14', '2026-04-15')`
      )
      .all();
    assert.equal(rejectedRows.length, 0);

    const storedSources = getDatabase()
      .prepare(
        `SELECT DISTINCT source
         FROM health_daily_summaries
         WHERE user_id = 'user_operator' AND summary_type = 'vitals'`
      )
      .all() as Array<{ source: string }>;
    assert.equal(storedSources.length, 1);
    assert.equal(storedSources[0]?.source, "apple_health");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
