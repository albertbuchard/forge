import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase, runInTransaction } from "./db.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

test("MOVE-01 returns an empty timeline and bounds a 10,000-box timeline page", async (context) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-move-01-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const cookie = issueTestOperatorSessionCookie(app);
    const empty = await app.inject({
      method: "GET",
      url: "/api/v1/movement/timeline?limit=360&userIds=user_operator",
      headers: { cookie }
    });
    assert.equal(empty.statusCode, 200, empty.body);
    assert.deepEqual(empty.json().movement, {
      segments: [],
      nextCursor: null,
      hasMore: false,
      invalidSegmentCount: 0,
      sleepOverlays: []
    });

    const database = getDatabase();
    const insert = database.prepare(
      `INSERT INTO movement_boxes (
         id, user_id, kind, source_kind, origin, started_at, ended_at,
         title, subtitle, created_at, updated_at
       ) VALUES (?, ?, ?, 'automatic', 'recorded', ?, ?, ?, '', ?, ?)`
    );
    runInTransaction(() => {
      const baseMs = Date.UTC(2026, 0, 1);
      for (let index = 0; index < 10_000; index += 1) {
        const startedAt = new Date(baseMs + index * 60_000).toISOString();
        const endedAt = new Date(baseMs + (index + 1) * 60_000).toISOString();
        const kind = index % 2 === 0 ? "stay" : "trip";
        insert.run(
          `move01_${String(index).padStart(5, "0")}`,
          "user_operator",
          kind,
          startedAt,
          endedAt,
          `Segment ${index}`,
          startedAt,
          startedAt
        );
      }
    });

    const samples: number[] = [];
    let response: Awaited<ReturnType<typeof app.inject>> | null = null;
    for (let sample = 0; sample < 3; sample += 1) {
      const started = performance.now();
      response = await app.inject({
        method: "GET",
        url: "/api/v1/movement/timeline?limit=360&userIds=user_operator",
        headers: { cookie }
      });
      samples.push(performance.now() - started);
    }
    assert.ok(response);
    assert.equal(response.statusCode, 200, response.body);
    const movement = response.json().movement as {
      segments: Array<{ id: string; kind: string; laneSide: string }>;
      nextCursor: string | null;
      hasMore: boolean;
      invalidSegmentCount: number;
    };
    assert.equal(movement.segments.length, 360);
    assert.equal(
      new Set(movement.segments.map((segment) => segment.id)).size,
      360
    );
    assert.equal(movement.hasMore, true);
    assert.ok(movement.nextCursor);
    assert.equal(movement.invalidSegmentCount, 0);
    assert.ok(
      movement.segments.every(
        (segment) => segment.laneSide === "left" || segment.laneSide === "right"
      )
    );
    const p95Ms = Math.max(...samples);
    context.diagnostic(
      `10,000-box timeline samples: ${samples.map((sample) => `${sample.toFixed(2)}ms`).join(", ")}; conservative p95 ${p95Ms.toFixed(2)}ms`
    );
    assert.ok(
      p95Ms < 1_000,
      `Expected the 10,000-box timeline page under 1000ms; observed ${p95Ms.toFixed(2)}ms from ${samples.map((sample) => sample.toFixed(2)).join(", ")}`
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
