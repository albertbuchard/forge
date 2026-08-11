import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

test("LF-04 applies one current intensity-scaled signal and rejects future evidence", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-lf-04-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const postSignal = (payload: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: "/api/v1/life-force/fatigue-signals",
        headers: { cookie },
        payload
      });

    const future = await postSignal({
      signalType: "tired",
      intensity: 10,
      observedAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      note: "This timestamp has not happened yet."
    });
    assert.equal(future.statusCode, 409, future.body);
    assert.equal(future.json().code, "fatigue_signal_future_observation");

    const expired = await postSignal({
      signalType: "tired",
      intensity: 10,
      observedAt: new Date(Date.now() - 5 * 60 * 60 * 1_000).toISOString(),
      note: "A difficult period that is no longer current."
    });
    assert.equal(expired.statusCode, 200, expired.body);
    assert.equal(expired.json().lifeForce.fatigueBufferApPerHour, 0);

    const tiredInstant = Date.now() - 30 * 60 * 1_000;
    const tiredOffsetLocal = new Date(tiredInstant - 7 * 60 * 60 * 1_000)
      .toISOString()
      .replace("Z", "-07:00");
    const tired = await postSignal({
      signalType: "tired",
      intensity: 8,
      observedAt: tiredOffsetLocal,
      note: "Poor sleep and a demanding morning."
    });
    assert.equal(tired.statusCode, 200, tired.body);
    assert.equal(tired.json().lifeForce.fatigueBufferApPerHour, 6.4);

    const repeated = await postSignal({
      signalType: "tired",
      intensity: 3,
      note: "The strain is now milder."
    });
    assert.equal(repeated.statusCode, 200, repeated.body);
    assert.equal(repeated.json().lifeForce.fatigueBufferApPerHour, 2.4);

    const recovered = await postSignal({
      signalType: "okay_again",
      intensity: 7,
      note: "Recovered after food and a quiet break."
    });
    assert.equal(recovered.statusCode, 200, recovered.body);
    assert.equal(recovered.json().lifeForce.fatigueBufferApPerHour, 0);

    const rows = getDatabase()
      .prepare(
        `SELECT signal_type, intensity, note, delta, observed_at
         FROM fatigue_signals
         ORDER BY created_at ASC, id ASC`
      )
      .all() as Array<{
      signal_type: string;
      intensity: number;
      note: string;
      delta: number;
      observed_at: string;
    }>;
    assert.equal(rows.length, 4);
    const rowsByNote = new Map(rows.map((row) => [row.note, row] as const));
    assert.deepEqual(
      [
        rowsByNote.get("A difficult period that is no longer current."),
        rowsByNote.get("Poor sleep and a demanding morning."),
        rowsByNote.get("The strain is now milder."),
        rowsByNote.get("Recovered after food and a quiet break.")
      ].map((row) => [row?.signal_type, row?.intensity, row?.delta]),
      [
        ["tired", 10, 8],
        ["tired", 8, 6.4],
        ["tired", 3, 2.4],
        ["okay_again", 7, -5.6]
      ]
    );
    assert.equal(
      rowsByNote.get("Poor sleep and a demanding morning.")?.observed_at,
      new Date(tiredInstant).toISOString()
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
