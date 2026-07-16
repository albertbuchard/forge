import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import {
  createTriggerReport,
  listTriggerReports
} from "./repositories/psyche.js";

test("internal trigger report consumers can read across public page boundaries", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-trigger-report-internal-list-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: false,
    devrageMetricSync: false
  });

  try {
    const createdIds = new Set<string>();
    for (let index = 0; index < 105; index += 1) {
      const report = createTriggerReport(
        {
          title: `Internal report ${String(index).padStart(3, "0")}`,
          userId: "user_operator"
        },
        { source: "system", actor: "trigger-report-internal-list-test" }
      );
      createdIds.add(report.id);
    }

    const reports = listTriggerReports(105);
    assert.equal(reports.length, 105);
    assert.deepEqual(new Set(reports.map((report) => report.id)), createdIds);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
