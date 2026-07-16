import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { summarizeDurations } from "./people-performance-contract.mjs";

const configPath = process.env.FORGE_PEOPLE_SCALE_WORKER_CONFIG;
const resultPath = process.env.FORGE_PEOPLE_SCALE_WORKER_RESULT;

if (!configPath || !resultPath) {
  throw new Error(
    "People scale worker requires explicit config and result paths."
  );
}

async function main() {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (
    typeof config.dataRoot !== "string" ||
    !Number.isInteger(config.warmups) ||
    !Number.isInteger(config.samples) ||
    !Number.isInteger(config.batchSize)
  ) {
    throw new Error("People scale worker config is malformed.");
  }

  const [{ closeDatabase, configureDatabase, getDatabase }, delivery] =
    await Promise.all([
      import("../../apps/api/src/db.ts"),
      import("../../apps/api/src/repositories/peer-delivery.ts")
    ]);
  configureDatabase({ dataRoot: config.dataRoot, seedDemoData: false });
  const database = getDatabase();
  const fixedNow = new Date("2026-07-16T12:00:00.000Z");
  const total = config.warmups + config.samples;
  const measured = [];
  const memory = [];
  let claimedRows = 0;
  try {
    if (typeof globalThis.gc === "function") globalThis.gc();
    memory.push({ label: "baseline", ...process.memoryUsage() });
    for (let index = 0; index < total; index += 1) {
      const startedAt = performance.now();
      const claimed = delivery.claimDuePeerOutbox({
        ownerUserId: config.ownerUserId,
        limit: config.batchSize,
        now: fixedNow,
        leaseMs: 60_000
      });
      const durationMs = performance.now() - startedAt;
      if (claimed.length !== config.batchSize) {
        throw new Error(
          `Outbox claim ${index + 1}/${total} returned ${claimed.length}/${config.batchSize} rows.`
        );
      }
      claimedRows += claimed.length;
      if (index >= config.warmups) measured.push(durationMs);
      memory.push({ label: `claim_${index + 1}`, ...process.memoryUsage() });
    }
    if (typeof globalThis.gc === "function") globalThis.gc();
    memory.push({ label: "final_after_gc", ...process.memoryUsage() });
    const stateCounts = Object.fromEntries(
      database
        .prepare(
          `SELECT status, COUNT(*) AS count
           FROM peer_outbox
           WHERE owner_user_id = ?
           GROUP BY status ORDER BY status`
        )
        .all(config.ownerUserId)
        .map((row) => [row.status, row.count])
    );
    const rssValues = memory.map((sample) => sample.rss);
    const heapValues = memory.map((sample) => sample.heapUsed);
    return {
      status: "pass",
      protocol: {
        implementation:
          "apps/api/src/repositories/peer-delivery.ts#claimDuePeerOutbox",
        warmups: config.warmups,
        measuredClaims: config.samples,
        batchSize: config.batchSize,
        percentileMethod: "nearest_rank",
        fixedNow: fixedNow.toISOString()
      },
      summary: summarizeDurations(measured),
      samplesMs: measured,
      claimedRows,
      stateCounts,
      memory: {
        rssMaxBytes: Math.max(...rssValues),
        heapUsedMaxBytes: Math.max(...heapValues),
        rssRetainedBytes: Math.max(0, rssValues.at(-1) - rssValues[0]),
        heapRetainedBytes: Math.max(0, heapValues.at(-1) - heapValues[0]),
        samples: memory
      }
    };
  } finally {
    closeDatabase();
  }
}

try {
  const result = await main();
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
} catch (error) {
  await writeFile(
    resultPath,
    `${JSON.stringify(
      {
        status: "error",
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error)
        }
      },
      null,
      2
    )}\n`,
    { encoding: "utf8", mode: 0o600 }
  ).catch(() => {});
  throw error;
}
