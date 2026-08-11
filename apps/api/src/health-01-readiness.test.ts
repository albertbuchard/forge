import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

type SleepEntity = {
  id: string;
  localDateKey: string;
  regularityScore: number;
  startedAt: string;
  endedAt: string;
};

test("HEALTH-01 keeps after-midnight regularity and manual wake dates correct across DST", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-health-01-"));
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: false,
    devrageMetricSync: false
  });

  try {
    const operatorCookie = issueTestOperatorSessionCookie(app);
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie: operatorCookie },
      payload: {
        operations: [
          {
            entityType: "sleep_session",
            clientRef: "dst-night",
            data: {
              sourceTimezone: "Europe/Zurich",
              startedAt: "2026-03-28T23:30:00.000Z",
              endedAt: "2026-03-29T06:30:00.000Z"
            }
          }
        ]
      }
    });

    assert.equal(createResponse.statusCode, 200, createResponse.body);
    const created = (
      createResponse.json() as {
        results: Array<{ ok: boolean; entity?: SleepEntity }>;
      }
    ).results[0];
    assert.equal(created?.ok, true);
    assert.ok(created?.entity);
    assert.equal(created.entity.localDateKey, "2026-03-29");
    assert.equal(created.entity.regularityScore, 60);

    const updateResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/update",
      headers: { cookie: operatorCookie },
      payload: {
        operations: [
          {
            entityType: "sleep_session",
            id: created.entity.id,
            patch: {
              startedAt: "2026-03-29T21:00:00.000Z",
              endedAt: "2026-03-30T05:00:00.000Z"
            }
          }
        ]
      }
    });

    assert.equal(updateResponse.statusCode, 200, updateResponse.body);
    const updated = (
      updateResponse.json() as {
        results: Array<{ ok: boolean; entity?: SleepEntity }>;
      }
    ).results[0];
    assert.equal(updated?.ok, true);
    assert.ok(updated?.entity);
    assert.equal(updated.entity.localDateKey, "2026-03-30");
    assert.equal(updated.entity.regularityScore, 90);
    assert.equal(updated.entity.startedAt, "2026-03-29T21:00:00.000Z");
    assert.equal(updated.entity.endedAt, "2026-03-30T05:00:00.000Z");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
