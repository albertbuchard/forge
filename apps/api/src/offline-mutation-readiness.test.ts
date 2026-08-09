import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type {
  InjectPayload,
  Response as InjectResponse
} from "light-my-request";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase, initializeDatabase } from "./db.js";
import { buildOpenApiDocument } from "./openapi.js";
import { createTask, getTaskById, listTasks } from "./repositories/tasks.js";
import type { ApplicationSecurityRuntime } from "./security/application-security-runtime.js";
import { resolveRouteSecurityContract } from "./security/route-contract.js";
import {
  MAX_OFFLINE_MUTATIONS_PER_SESSION,
  OFFLINE_MUTATION_HISTORY_DAYS,
  readOfflineTaskMutationOutcome,
  recordOfflineTaskMutationOutcome
} from "./services/offline-mutations.js";
import type {
  OfflineTaskMutationInput,
  OfflineTaskMutationResponse,
  OfflineTaskStatus,
  Task
} from "./types.js";

type TestApp = Awaited<ReturnType<typeof buildServer>>;
type Authority = {
  sessionId: string;
  sessionToken: string;
  cookie: string;
  csrf: string;
};

function issueOperatorSession(security: ApplicationSecurityRuntime): Authority {
  const ownerSecurityEpoch =
    security.store.readOwnerSecurityEpoch("user_operator");
  assert.ok(ownerSecurityEpoch);
  const issued = security.browserSessions.create({
    kind: "operator_session",
    subjectId: "user_operator",
    ownerId: "user_operator",
    clientId: null,
    installationId: null,
    audience: security.audience,
    scopes: ["*"],
    profile: "operator",
    ownerSecurityEpoch,
    clientSecurityEpoch: null,
    authenticatedAt: new Date().toISOString()
  });
  return {
    sessionId: issued.sessionId,
    sessionToken: issued.sessionToken,
    cookie: `forge_session=${encodeURIComponent(issued.sessionToken)}`,
    csrf: issued.csrfToken
  };
}

function payload(
  authority: Authority,
  task: Task,
  idempotencyKey: string,
  status: OfflineTaskStatus
): OfflineTaskMutationInput {
  return {
    version: 1,
    sessionId: authority.sessionId,
    idempotencyKey,
    action: "task_status",
    taskId: task.id,
    expectedUpdatedAt: task.updatedAt,
    status
  };
}

function nextStatus(status: Task["status"]): OfflineTaskStatus {
  return status === "focus" ? "blocked" : "focus";
}

async function submit(
  app: TestApp,
  authority: Authority,
  body: InjectPayload
): Promise<InjectResponse> {
  return app.inject({
    method: "POST",
    url: "/api/v1/offline-mutations/task-status",
    remoteAddress: "127.0.0.1",
    headers: {
      cookie: authority.cookie,
      "x-forge-csrf": authority.csrf
    },
    payload: body
  });
}

function createFixtureTask(label: string) {
  const base = listTasks()[0];
  assert.ok(base?.projectId);
  return createTask({
    title: `SYS-21 ${label}`,
    projectId: base.projectId,
    goalId: base.goalId,
    userId: "user_operator"
  });
}

test(
  "SYS-21 migration 125 upgrades populated data, rolls back interruption, and retries safely",
  { concurrency: false },
  async () => {
    const dataRoot = await mkdtemp(
      path.join(os.tmpdir(), "forge-sys21-migration-")
    );
    const app = await buildServer({
      dataRoot,
      seedDemoData: true,
      devrageMetricSync: false
    });
    let appClosed = false;
    try {
      const marker = createFixtureTask("migration-preserved");
      const database = getDatabase();
      database.exec("DROP TABLE offline_mutation_outbox");
      database
        .prepare("DELETE FROM migrations WHERE id = ?")
        .run("125_offline_mutation_outbox.sql");
      database.exec(`
        CREATE TRIGGER sys21_fail_migration_record
        BEFORE INSERT ON migrations
        WHEN NEW.id = '125_offline_mutation_outbox.sql'
        BEGIN
          SELECT RAISE(ABORT, 'forced SYS-21 migration record failure');
        END;
      `);
      await app.close();
      appClosed = true;
      closeDatabase();

      await assert.rejects(
        initializeDatabase(),
        /forced SYS-21 migration record failure/
      );
      const failedDatabase = getDatabase();
      assert.equal(getTaskById(marker.id)?.title, marker.title);
      assert.equal(
        failedDatabase
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'offline_mutation_outbox'"
          )
          .get(),
        undefined
      );
      assert.equal(
        failedDatabase
          .prepare(
            "SELECT id FROM migrations WHERE id = '125_offline_mutation_outbox.sql'"
          )
          .get(),
        undefined
      );

      failedDatabase.exec("DROP TRIGGER sys21_fail_migration_record");
      await initializeDatabase();
      assert.equal(getTaskById(marker.id)?.title, marker.title);
      assert.ok(
        failedDatabase
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'offline_mutation_outbox'"
          )
          .get()
      );
      assert.ok(
        failedDatabase
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'offline_mutation_outbox_session_created'"
          )
          .get()
      );

      await initializeDatabase();
      const migrationRows = failedDatabase
        .prepare(
          "SELECT COUNT(*) AS count FROM migrations WHERE id = '125_offline_mutation_outbox.sql'"
        )
        .get() as { count: number };
      assert.equal(migrationRows.count, 1);
      // Application rollback is compatible: migration 125 is additive and
      // leaves the existing task schema and populated task records untouched.
      assert.equal(getTaskById(marker.id)?.title, marker.title);
    } finally {
      if (!appClosed) await app.close();
      closeDatabase();
      await rm(dataRoot, { recursive: true, force: true });
    }
  }
);

test("SYS-21 offline task-status mutations are safe, idempotent, and fast", async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "forge-sys21-"));
  let security!: ApplicationSecurityRuntime;
  const app = await buildServer({
    dataRoot,
    seedDemoData: true,
    devrageMetricSync: false,
    onSecurityRuntimeReady(runtime) {
      security = runtime;
    }
  });
  const first = issueOperatorSession(security);
  const second = issueOperatorSession(security);

  try {
    await t.test("publishes an operator-only write contract", () => {
      const contract = resolveRouteSecurityContract({
        method: "POST",
        routePath: "/api/v1/offline-mutations/task-status"
      });
      assert.equal(contract.securityClass, "protected");
      assert.equal(contract.action, "offline_mutations.task_status.update");
      assert.equal(contract.allowsAnonymousAdmission, false);
      assert.deepEqual(contract.acceptedLegacyScopes, []);
      assert.equal(contract.maximumBodyBytes, 16 * 1024);

      const document = buildOpenApiDocument() as {
        components?: { schemas?: Record<string, unknown> };
        paths?: Record<string, Record<string, unknown>>;
      };
      assert.ok(document.components?.schemas?.OfflineTaskMutationInput);
      assert.ok(document.components?.schemas?.OfflineTaskMutationReceipt);
      const operation = document.paths?.[
        "/api/v1/offline-mutations/task-status"
      ]?.post as { security?: unknown };
      assert.deepEqual(operation.security, [{ operatorSession: [] }]);
    });

    await t.test("bounds terminal history by age and browser session", () => {
      const sessionId = "sys21-retention-session";
      const baseTime = Date.parse("2026-08-09T12:00:00.000Z");
      for (
        let index = 0;
        index <= MAX_OFFLINE_MUTATIONS_PER_SESSION;
        index += 1
      ) {
        const receivedAt = new Date(baseTime + index).toISOString();
        recordOfflineTaskMutationOutcome({
          sessionId,
          idempotencyKey: `retention-${String(index).padStart(3, "0")}`,
          requestFingerprint: String(index).padStart(64, "0"),
          receipt: {
            version: 1,
            idempotencyKey: `retention-${String(index).padStart(3, "0")}`,
            action: "task_status",
            status: "rejected",
            summary: "Forge could not apply this offline edit.",
            task: null,
            current: null,
            mutationReceipt: null,
            receivedAt
          },
          now: new Date(receivedAt)
        });
      }
      const retained = getDatabase()
        .prepare(
          "SELECT COUNT(*) AS count FROM offline_mutation_outbox WHERE session_id = ?"
        )
        .get(sessionId) as { count: number };
      assert.equal(retained.count, MAX_OFFLINE_MUTATIONS_PER_SESSION);

      const oldSessionId = "sys21-expired-session";
      const oldReceivedAt = new Date(
        baseTime - (OFFLINE_MUTATION_HISTORY_DAYS + 1) * 24 * 60 * 60 * 1_000
      ).toISOString();
      recordOfflineTaskMutationOutcome({
        sessionId: oldSessionId,
        idempotencyKey: "expired-receipt",
        requestFingerprint: "f".repeat(64),
        receipt: {
          version: 1,
          idempotencyKey: "expired-receipt",
          action: "task_status",
          status: "rejected",
          summary: "Forge could not apply this offline edit.",
          task: null,
          current: null,
          mutationReceipt: null,
          receivedAt: oldReceivedAt
        },
        now: new Date(oldReceivedAt)
      });
      assert.equal(
        readOfflineTaskMutationOutcome({
          sessionId: oldSessionId,
          idempotencyKey: "expired-receipt",
          requestFingerprint: "f".repeat(64),
          now: new Date(baseTime)
        }),
        null
      );
    });

    await t.test(
      "accepts once and replays without a duplicate receipt",
      async () => {
        const task = createFixtureTask("accepted");
        const request = payload(
          first,
          task,
          "sys21-accepted",
          nextStatus(task.status)
        );
        const accepted = await submit(app, first, request);
        assert.equal(accepted.statusCode, 200, accepted.body);
        const acceptedBody = accepted.json() as OfflineTaskMutationResponse;
        assert.equal(acceptedBody.replayed, false);
        assert.equal(acceptedBody.receipt.status, "accepted");
        assert.equal(acceptedBody.receipt.task?.status, request.status);
        assert.equal(
          acceptedBody.receipt.current?.updatedAt,
          getTaskById(task.id)?.updatedAt
        );
        assert.equal(
          acceptedBody.receipt.mutationReceipt?.operation,
          "task_update"
        );

        const replay = await submit(app, first, request);
        assert.equal(replay.statusCode, 200, replay.body);
        assert.equal(replay.headers["idempotency-replayed"], "true");
        const replayBody = replay.json() as OfflineTaskMutationResponse;
        assert.equal(replayBody.replayed, true);
        assert.deepEqual(replayBody.receipt, acceptedBody.receipt);
        const receiptCount = getDatabase()
          .prepare(
            "SELECT COUNT(*) AS count FROM mutation_receipts WHERE target_id = ?"
          )
          .get(task.id) as { count: number };
        assert.equal(receiptCount.count, 1);

        const changed = await submit(app, first, {
          ...request,
          status: request.status === "focus" ? "blocked" : "focus"
        });
        assert.equal(changed.statusCode, 409, changed.body);
        assert.equal(
          changed.json().code,
          "offline_mutation_idempotency_conflict"
        );
      }
    );

    await t.test(
      "stores stale conflicts independently for two sessions",
      async () => {
        const task = createFixtureTask("stale-two-session");
        const stale = await submit(app, first, {
          ...payload(first, task, "sys21-two-session", nextStatus(task.status)),
          expectedUpdatedAt: "2000-01-01T00:00:00.000Z"
        });
        assert.equal(stale.statusCode, 200, stale.body);
        const staleBody = stale.json() as OfflineTaskMutationResponse;
        assert.equal(staleBody.receipt.status, "conflicted");
        assert.equal(staleBody.receipt.task, null);
        assert.deepEqual(staleBody.receipt.current, {
          status: task.status,
          updatedAt: task.updatedAt
        });
        assert.equal(getTaskById(task.id)?.status, task.status);

        const accepted = await submit(
          app,
          second,
          payload(second, task, "sys21-two-session", nextStatus(task.status))
        );
        assert.equal(accepted.statusCode, 200, accepted.body);
        assert.equal(
          (accepted.json() as OfflineTaskMutationResponse).receipt.status,
          "accepted"
        );
        const rows = getDatabase()
          .prepare(
            "SELECT COUNT(*) AS count FROM offline_mutation_outbox WHERE idempotency_key = ?"
          )
          .get("sys21-two-session") as { count: number };
        assert.equal(rows.count, 2);
      }
    );

    await t.test(
      "rejects session mismatch and revoked authority before lookup",
      async () => {
        const task = createFixtureTask("authority");
        const mismatched = await submit(
          app,
          first,
          payload(second, task, "sys21-mismatch", nextStatus(task.status))
        );
        assert.equal(mismatched.statusCode, 409, mismatched.body);
        assert.equal(
          mismatched.json().code,
          "offline_mutation_session_mismatch"
        );

        const revoked = issueOperatorSession(security);
        assert.equal(
          security.browserSessions.revoke(revoked.sessionToken),
          true
        );
        const revokedResponse = await submit(
          app,
          revoked,
          payload(revoked, task, "sys21-revoked", nextStatus(task.status))
        );
        assert.equal(revokedResponse.statusCode, 401, revokedResponse.body);
        assert.equal(getTaskById(task.id)?.status, task.status);
        const stored = getDatabase()
          .prepare(
            "SELECT COUNT(*) AS count FROM offline_mutation_outbox WHERE idempotency_key IN (?, ?)"
          )
          .get("sys21-mismatch", "sys21-revoked") as { count: number };
        assert.equal(stored.count, 0);
      }
    );

    await t.test(
      "returns the same bounded rejection for deleted and missing tasks",
      async () => {
        const task = createFixtureTask("deleted");
        const deleted = await app.inject({
          method: "DELETE",
          url: `/api/v1/tasks/${task.id}`,
          remoteAddress: "127.0.0.1",
          headers: { cookie: first.cookie, "x-forge-csrf": first.csrf }
        });
        assert.equal(deleted.statusCode, 200, deleted.body);

        const deletedResult = await submit(
          app,
          first,
          payload(first, task, "sys21-deleted", nextStatus(task.status))
        );
        const missingResult = await submit(app, first, {
          ...payload(first, task, "sys21-missing", nextStatus(task.status)),
          taskId: "task_that_never_existed"
        });
        assert.equal(deletedResult.statusCode, 200, deletedResult.body);
        assert.equal(missingResult.statusCode, 200, missingResult.body);
        const deletedReceipt = (
          deletedResult.json() as OfflineTaskMutationResponse
        ).receipt;
        const missingReceipt = (
          missingResult.json() as OfflineTaskMutationResponse
        ).receipt;
        assert.equal(deletedReceipt.status, "rejected");
        assert.equal(deletedReceipt.summary, missingReceipt.summary);
        assert.equal(deletedReceipt.task, null);
        assert.equal(deletedReceipt.current, null);
        assert.equal(missingReceipt.task, null);
        assert.equal(missingReceipt.current, null);
      }
    );

    await t.test(
      "rejects unsupported done status and schema versions",
      async () => {
        const task = createFixtureTask("schema");
        const base = payload(
          first,
          task,
          "sys21-schema",
          nextStatus(task.status)
        );
        const done = await submit(app, first, { ...base, status: "done" });
        const version = await submit(app, first, { ...base, version: 2 });
        assert.equal(done.statusCode, 400, done.body);
        assert.equal(version.statusCode, 400, version.body);
        assert.equal(getTaskById(task.id)?.status, task.status);
      }
    );

    await t.test(
      "keeps every completed-task reopening move online-only",
      async () => {
        const task = createFixtureTask("completed-source");
        const completedResponse = await app.inject({
          method: "PATCH",
          url: `/api/v1/tasks/${task.id}`,
          remoteAddress: "127.0.0.1",
          headers: { cookie: first.cookie, "x-forge-csrf": first.csrf },
          payload: { status: "done" }
        });
        assert.equal(completedResponse.statusCode, 200, completedResponse.body);
        const completed = getTaskById(task.id);
        assert.equal(completed?.status, "done");
        assert.ok(completed);

        for (const status of [
          "backlog",
          "focus",
          "in_progress",
          "blocked"
        ] as const) {
          const response = await submit(
            app,
            first,
            payload(first, completed, `sys21-reopen-${status}`, status)
          );
          assert.equal(response.statusCode, 200, response.body);
          const body = response.json() as OfflineTaskMutationResponse;
          assert.equal(body.receipt.status, "rejected");
          assert.equal(body.receipt.current?.status, "done");
          assert.match(body.receipt.summary, /live connection/i);
          assert.equal(getTaskById(task.id)?.status, "done");
        }
      }
    );

    await t.test(
      "rolls back the task update when outcome persistence fails",
      async () => {
        const task = createFixtureTask("atomicity");
        getDatabase().exec(
          `CREATE TRIGGER sys21_fail_outcome
         BEFORE INSERT ON offline_mutation_outbox
         BEGIN
           SELECT RAISE(ABORT, 'forced SYS-21 outcome failure');
         END;`
        );
        try {
          const response = await submit(
            app,
            first,
            payload(first, task, "sys21-atomicity", nextStatus(task.status))
          );
          assert.equal(response.statusCode, 500, response.body);
        } finally {
          getDatabase().exec("DROP TRIGGER sys21_fail_outcome");
        }
        assert.equal(getTaskById(task.id)?.status, task.status);
        const taskReceipts = getDatabase()
          .prepare(
            "SELECT COUNT(*) AS count FROM mutation_receipts WHERE target_id = ?"
          )
          .get(task.id) as { count: number };
        assert.equal(taskReceipts.count, 0);
      }
    );

    await t.test(
      "keeps frozen endpoint p95 at or below 273.142 ms",
      async (t) => {
        const task = createFixtureTask("performance");
        const request = payload(
          first,
          task,
          "sys21-performance",
          nextStatus(task.status)
        );
        const initial = await submit(app, first, request);
        assert.equal(initial.statusCode, 200, initial.body);
        for (let index = 0; index < 3; index += 1) {
          const warmup = await submit(app, first, request);
          assert.equal(warmup.statusCode, 200, warmup.body);
        }
        const durations: number[] = [];
        for (let index = 0; index < 30; index += 1) {
          const startedAt = performance.now();
          const measured = await submit(app, first, request);
          durations.push(performance.now() - startedAt);
          assert.equal(measured.statusCode, 200, measured.body);
        }
        durations.sort((left, right) => left - right);
        const p95 = durations[Math.ceil(durations.length * 0.95) - 1]!;
        t.diagnostic(
          `SYS-21 offline mutation p95=${p95.toFixed(3)}ms; measured=${durations.length}; warmups=3; threshold=273.142ms`
        );
        assert.equal(durations.length >= 30, true);
        assert.ok(
          p95 <= 273.142,
          `Expected p95 <= 273.142ms, received ${p95}ms`
        );
      }
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
});
