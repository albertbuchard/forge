import { writeFile, readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { tsImport } from "tsx/esm/api";
import {
  allChecksPass,
  evaluateCeiling,
  evaluateFloor,
  sha256,
  summarizeDurations
} from "./people-performance-contract.mjs";
import { PEOPLE_FIXTURE_OWNER_ID } from "./people-performance-fixture.mjs";
import { verifyPeopleScalePerformanceFixture } from "./people-performance-scale-fixture.mjs";
import {
  requestJson,
  runCheckedSubprocess,
  startPeoplePerformanceServer
} from "./people-performance-runtime.mjs";

const MEBIBYTE = 1024 * 1024;
const QUERY_NOW = "2026-07-16T12:00:00.000Z";

function queryPlan(database, definition) {
  const rows = database
    .prepare(`EXPLAIN QUERY PLAN ${definition.sql}`)
    .all(...definition.parameters);
  const details = rows.map((row) => String(row.detail));
  const missingIndexes = (definition.requiredIndexes ?? []).filter(
    (index) => !details.some((detail) => detail.includes(index))
  );
  const fullTableScans = details.filter((detail) => {
    return (definition.tables ?? []).some((table) => {
      const scan = new RegExp(`\\bSCAN ${table}\\b`, "u");
      return scan.test(detail) && !/USING (?:COVERING )?INDEX/u.test(detail);
    });
  });
  const temporaryOrder = details.filter((detail) =>
    detail.includes("USE TEMP B-TREE")
  );
  return {
    id: definition.id,
    source: definition.source ?? "people-performance-harness",
    statementSha256: sha256(definition.sql),
    status:
      missingIndexes.length === 0 &&
      fullTableScans.length === 0 &&
      (!definition.forbidTemporaryOrder || temporaryOrder.length === 0)
        ? "pass"
        : "fail",
    requiredIndexes: definition.requiredIndexes ?? [],
    missingIndexes,
    fullTableScans,
    temporaryOrder,
    details
  };
}

async function loadProductionOutboxCandidateStatements(repositoryRoot) {
  const sourcePath = path.join(
    repositoryRoot,
    "apps/api/src/repositories/peer-delivery.ts"
  );
  const module = await tsImport(sourcePath, import.meta.url);
  const statements = module.PEER_OUTBOX_CANDIDATE_STATEMENTS;
  if (
    !statements ||
    typeof statements.due !== "string" ||
    typeof statements.inFlight !== "string"
  ) {
    throw new Error(
      "Production peer delivery did not export both outbox candidate statements."
    );
  }
  return statements;
}

function collectCriticalQueryPlans(dataRoot, outboxStatements) {
  const database = new DatabaseSync(path.join(dataRoot, "forge.sqlite"), {
    readOnly: true
  });
  try {
    return [
      queryPlan(database, {
        id: "people_owner_cursor_page",
        sql: `SELECT id, normalized_display_name
              FROM people
              WHERE user_id = ? AND deleted_at IS NULL
              ORDER BY normalized_display_name, id LIMIT 101`,
        parameters: [PEOPLE_FIXTURE_OWNER_ID],
        requiredIndexes: ["idx_people_owner_active_name"],
        tables: ["people"]
      }),
      queryPlan(database, {
        id: "peer_relationship_owner_state",
        sql: `SELECT id
              FROM peer_relationships
              WHERE owner_user_id = ? AND status = 'active'
              ORDER BY updated_at DESC LIMIT 101`,
        parameters: [PEOPLE_FIXTURE_OWNER_ID],
        requiredIndexes: ["idx_peer_relationships_owner_state"],
        tables: ["peer_relationships"]
      }),
      queryPlan(database, {
        id: "remote_projection_exact_query",
        sql: `SELECT id, source_record_id
              FROM peer_remote_records
              WHERE owner_user_id = ? AND relationship_id = ?
                AND projection_id = 'calendar.availability.v1'
                AND query_hash = ? AND cache_state = 'current'
              ORDER BY received_at DESC, id DESC LIMIT 101`,
        parameters: [
          PEOPLE_FIXTURE_OWNER_ID,
          "relationship_perf_scale_000",
          "1".padStart(64, "0")
        ],
        requiredIndexes: ["idx_peer_remote_records_exact_query"],
        tables: ["peer_remote_records"]
      }),
      queryPlan(database, {
        id: "production_outbox_due_candidates",
        source:
          "apps/api/src/repositories/peer-delivery.ts#PEER_OUTBOX_CANDIDATE_STATEMENTS.due",
        sql: outboxStatements.due,
        parameters: [PEOPLE_FIXTURE_OWNER_ID, QUERY_NOW, QUERY_NOW, 50],
        requiredIndexes: ["idx_peer_outbox_due_claim_order"],
        forbidTemporaryOrder: true,
        tables: ["peer_outbox"]
      }),
      queryPlan(database, {
        id: "production_outbox_in_flight_candidates",
        source:
          "apps/api/src/repositories/peer-delivery.ts#PEER_OUTBOX_CANDIDATE_STATEMENTS.inFlight",
        sql: outboxStatements.inFlight,
        parameters: [PEOPLE_FIXTURE_OWNER_ID, QUERY_NOW, QUERY_NOW, 50],
        requiredIndexes: ["idx_peer_outbox_in_flight_claim_order"],
        forbidTemporaryOrder: true,
        tables: ["peer_outbox"]
      })
    ];
  } finally {
    database.close();
  }
}

async function measureRestarts({ repositoryRoot, dataRoot, samples, signal }) {
  const startupMs = [];
  const memory = [];
  for (let index = 0; index < samples; index += 1) {
    signal?.throwIfAborted();
    const server = await startPeoplePerformanceServer({
      repositoryRoot,
      dataRoot,
      startupTimeoutMs: 120_000,
      signal
    });
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const health = await requestJson(
        agent,
        server.origin,
        "/api/v1/health",
        {},
        signal
      );
      if (health.status !== 200 || health.body.ok !== true) {
        throw new Error(
          `People scale restart ${index + 1} health check failed with ${health.status}.`
        );
      }
      startupMs.push(server.ready.startupMs);
      const sample = await server.sampleMemory({ collect: true });
      memory.push({
        sample: index + 1,
        pid: server.ready.pid,
        startupMs: server.ready.startupMs,
        rssBytes: sample.memory.rss,
        heapUsedBytes: sample.memory.heapUsed,
        heapTotalBytes: sample.memory.heapTotal
      });
    } finally {
      agent.destroy();
      await server.stop();
    }
  }
  return {
    protocol: {
      samples,
      process: "fresh assembled Fastify process per sample",
      readiness: "server listen plus GET /api/v1/health = 200/status ok",
      shutdown: "IPC graceful close with SIGTERM/SIGKILL fallback"
    },
    summary: summarizeDurations(startupMs),
    samplesMs: startupMs,
    memory: {
      rssMaxBytes: Math.max(...memory.map((sample) => sample.rssBytes)),
      heapUsedMaxBytes: Math.max(
        ...memory.map((sample) => sample.heapUsedBytes)
      ),
      samples: memory
    }
  };
}

async function runOutboxClaimWorker({
  repositoryRoot,
  dataRoot,
  runRoot,
  profile,
  signal
}) {
  const configPath = path.join(runRoot, "people-scale-worker-config.json");
  const resultPath = path.join(runRoot, "people-scale-worker-result.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        dataRoot,
        ownerUserId: PEOPLE_FIXTURE_OWNER_ID,
        warmups: profile.scale.claimWarmups,
        samples: profile.scale.claimSamples,
        batchSize: profile.scale.claimBatchSize
      },
      null,
      2
    )}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  const worker = path.join(
    repositoryRoot,
    "scripts",
    "perf",
    "people-performance-scale-worker.mjs"
  );
  const processResult = await runCheckedSubprocess({
    command: process.execPath,
    args: ["--expose-gc", "--import", "tsx", worker],
    cwd: repositoryRoot,
    env: {
      ...process.env,
      FORGE_DATA_ROOT: dataRoot,
      FORGE_PEOPLE_SCALE_WORKER_CONFIG: configPath,
      FORGE_PEOPLE_SCALE_WORKER_RESULT: resultPath
    },
    timeoutMs: profile.mode === "release" ? 10 * 60_000 : 120_000,
    signal
  });
  const result = JSON.parse(await readFile(resultPath, "utf8"));
  if (result.status !== "pass") {
    throw new Error(
      `People scale outbox worker did not pass: ${JSON.stringify(result)}`
    );
  }
  return {
    ...result,
    runner: {
      exitCode: processResult.code,
      signal: processResult.signal,
      stderrTail: processResult.stderr.slice(-2_000)
    }
  };
}

export async function runPeopleScalePerformanceProtocol({
  repositoryRoot,
  dataRoot,
  runRoot,
  profile,
  budgets,
  signal = null
}) {
  const before = await verifyPeopleScalePerformanceFixture({
    dataRoot,
    repositoryRoot,
    profile,
    signal
  });
  const outboxStatements =
    await loadProductionOutboxCandidateStatements(repositoryRoot);
  const queryPlans = collectCriticalQueryPlans(dataRoot, outboxStatements);
  const restart = await measureRestarts({
    repositoryRoot,
    dataRoot,
    samples: profile.scale.restartSamples,
    signal
  });
  const outboxClaim = await runOutboxClaimWorker({
    repositoryRoot,
    dataRoot,
    runRoot,
    profile,
    signal
  });
  const after = await verifyPeopleScalePerformanceFixture({
    dataRoot,
    repositoryRoot,
    profile,
    signal
  });
  const expectedClaimedRows =
    (profile.scale.claimWarmups + profile.scale.claimSamples) *
    profile.scale.claimBatchSize;
  const checks = [
    evaluateCeiling({
      id: "scale.startup.first",
      actual: restart.samplesMs[0],
      ceiling: budgets.scale.startupP95Ms,
      unit: "ms"
    }),
    evaluateCeiling({
      id: "scale.restart.p95",
      actual: restart.summary.p95Ms,
      ceiling: budgets.scale.restartP95Ms,
      unit: "ms"
    }),
    evaluateCeiling({
      id: "scale.outbox_claim.p95",
      actual: outboxClaim.summary.p95Ms,
      ceiling: budgets.scale.outboxClaimP95Ms,
      unit: "ms"
    }),
    evaluateCeiling({
      id: "scale.outbox_claim.row_accounting",
      actual: Math.abs(outboxClaim.claimedRows - expectedClaimedRows),
      ceiling: 0,
      unit: "row_difference"
    }),
    evaluateCeiling({
      id: "scale.server.rss_max",
      actual: restart.memory.rssMaxBytes / MEBIBYTE,
      ceiling: budgets.memory.serverRssMaxMiB,
      unit: "MiB"
    }),
    evaluateCeiling({
      id: "scale.server.heap_max",
      actual: restart.memory.heapUsedMaxBytes / MEBIBYTE,
      ceiling: budgets.memory.serverHeapMaxMiB,
      unit: "MiB"
    }),
    evaluateCeiling({
      id: "scale.claim_worker.rss_max",
      actual: outboxClaim.memory.rssMaxBytes / MEBIBYTE,
      ceiling: budgets.memory.serverRssMaxMiB,
      unit: "MiB"
    }),
    evaluateCeiling({
      id: "scale.claim_worker.rss_retained",
      actual: outboxClaim.memory.rssRetainedBytes / MEBIBYTE,
      ceiling: budgets.memory.serverRssRetainedMiB,
      unit: "MiB"
    }),
    evaluateCeiling({
      id: "scale.claim_worker.heap_max",
      actual: outboxClaim.memory.heapUsedMaxBytes / MEBIBYTE,
      ceiling: budgets.memory.serverHeapMaxMiB,
      unit: "MiB"
    }),
    evaluateCeiling({
      id: "scale.claim_worker.heap_retained",
      actual: outboxClaim.memory.heapRetainedBytes / MEBIBYTE,
      ceiling: budgets.memory.serverHeapRetainedMiB,
      unit: "MiB"
    }),
    evaluateFloor({
      id: "scale.sqlite_integrity",
      actual:
        before.sqliteIntegrity === "ok" && after.sqliteIntegrity === "ok"
          ? 1
          : 0,
      floor: 1,
      unit: "boolean"
    }),
    evaluateCeiling({
      id: "scale.sqlite_foreign_keys",
      actual: before.foreignKeyViolations + after.foreignKeyViolations,
      ceiling: 0,
      unit: "violation"
    }),
    ...queryPlans.map((plan) => ({
      id: `scale.query_plan.${plan.id}`,
      status: plan.status,
      actual: plan.status === "pass" ? 1 : 0,
      floor: 1,
      unit: "boolean",
      ...(plan.status === "fail"
        ? {
            reason: "missing_required_index_or_full_table_scan",
            missingIndexes: plan.missingIndexes,
            fullTableScans: plan.fullTableScans
          }
        : {})
    }))
  ];
  return {
    status: allChecksPass(checks) ? "pass" : "fail",
    methodology: {
      fixtureBoundary:
        "separate isolated backend database; browser never renders the million-row outbox",
      outboxClaim:
        "production claimDuePeerOutbox repository function with real transactions and hydration",
      restart: "fresh API process and health response for every sample",
      queryPlans:
        "SQLite EXPLAIN QUERY PLAN against the populated scale database"
    },
    fixtureCounts: before.counts,
    restart,
    outboxClaim,
    queryPlans,
    checks
  };
}
