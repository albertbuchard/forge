import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { formatLocalDateKey } from "../../src/lib/date-keys.js";
import { buildServer } from "./app.js";
import { closeDatabase, configureDatabase, getDatabase } from "./db.js";
import { BackgroundJobManager } from "./managers/platform/background-job-manager.js";
import { recordActivityEvent } from "./repositories/activity-events.js";
import { createCalendarEvent } from "./repositories/calendar.js";
import { upsertDeletedEntityRecord } from "./repositories/deleted-entities.js";
import {
  DIAGNOSTIC_LOG_RETENTION_DAYS,
  enforceDiagnosticLogRetention,
  recordDiagnosticLog
} from "./repositories/diagnostic-logs.js";
import { createHabit } from "./repositories/habits.js";
import {
  createUploadedWikiIngestJob,
  processWikiIngestJob
} from "./repositories/wiki-memory.js";
import { getCrudEntityCapabilityMatrix } from "./services/entity-crud.js";
import type { StartupTaskRunRecoverySummary } from "./services/run-recovery.js";

async function issueOperatorSessionCookie(
  app: Awaited<ReturnType<typeof buildServer>>
) {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/auth/operator-session",
    headers: {
      host: "127.0.0.1:4317"
    }
  });
  assert.equal(response.statusCode, 200);
  const cookie = response.cookies[0];
  assert.ok(cookie);
  return `${cookie.name}=${cookie.value}`;
}

type WikiIngestJobPollPayload = {
  job: { status: string };
  candidates: Array<{
    id: string;
    candidateType: string;
    title?: string;
    publishedEntityId?: string | null;
    publishedNoteId?: string | null;
  }>;
};

type SharedMovementFixtureScenario = {
  id: string;
  projectedTimeline: Array<{
    id: string;
    kind: "stay" | "trip" | "missing";
    sourceKind: "automatic" | "user_defined";
    origin:
      | "recorded"
      | "continued_stay"
      | "repaired_gap"
      | "missing"
      | "user_defined"
      | "user_invalidated";
    editable: boolean;
    startedAt: string;
    endedAt: string;
    overrideCount: number;
  }>;
};

async function loadSharedMovementFixture(id: string) {
  const fixturePath = new URL("../../test-fixtures/movement-canonical-box-fixtures.json", import.meta.url);
  const parsed = JSON.parse(
    await readFile(fixturePath, "utf8")
  ) as { scenarios: SharedMovementFixtureScenario[] };
  const scenario = parsed.scenarios.find((entry) => entry.id === id);
  assert.ok(scenario, `Missing shared movement fixture: ${id}`);
  return scenario!;
}

test("companion pairings collapse stale duplicates and support bulk revoke", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-companion-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const createPairing = async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/health/pairing-sessions",
        headers: {
          cookie: operatorCookie,
          host: "127.0.0.1:4317"
        },
        payload: {
          userId: "user_operator"
        }
      });
      assert.equal(response.statusCode, 201);
      return response.json() as {
        session: { id: string; status: string };
        qrPayload: {
          sessionId: string;
          pairingToken: string;
        };
      };
    };

    const verifyPairing = async (sessionId: string, pairingToken: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/mobile/pairing/verify",
        payload: {
          sessionId,
          pairingToken,
          device: {
            name: "Omar iPhone",
            platform: "ios",
            appVersion: "1.0",
            sourceDevice: "iPhone"
          }
        }
      });
      assert.equal(response.statusCode, 200);
      return response.json() as {
        pairing: {
          pairingSession: { id: string; status: string };
        };
      };
    };

    const first = await createPairing();
    const second = await createPairing();
    let rows: Array<{
      id: string;
      status: string;
      device_name: string | null;
    }> = (
      getDatabase()
        .prepare(
          `SELECT id, status
         FROM companion_pairing_sessions
         ORDER BY created_at ASC`
        )
        .all() as Array<{ id: string; status: string }>
    ).map((row) => ({
      id: row.id,
      status: row.status,
      device_name: null
    }));
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.id, first.session.id);
    assert.equal(rows[0]?.status, "revoked");
    assert.equal(rows[1]?.id, second.session.id);
    assert.equal(rows[1]?.status, "pending");

    const secondVerify = await verifyPairing(
      second.qrPayload.sessionId,
      second.qrPayload.pairingToken
    );
    assert.equal(secondVerify.pairing.pairingSession.status, "paired");

    const third = await createPairing();
    const thirdVerify = await verifyPairing(
      third.qrPayload.sessionId,
      third.qrPayload.pairingToken
    );
    assert.equal(thirdVerify.pairing.pairingSession.status, "paired");

    rows = getDatabase()
      .prepare(
        `SELECT id, status, device_name
         FROM companion_pairing_sessions
         ORDER BY created_at ASC`
      )
      .all() as Array<{
      id: string;
      status: string;
      device_name: string | null;
    }>;
    assert.equal(rows.length, 3);
    assert.equal(rows[1]?.id, second.session.id);
    assert.equal(rows[1]?.status, "revoked");
    assert.equal(rows[2]?.id, third.session.id);
    assert.equal(rows[2]?.status, "paired");
    assert.equal(rows[2]?.device_name, "Omar iPhone");

    const revokeAllResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions/revoke-all",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        userIds: ["user_operator"]
      }
    });
    assert.equal(revokeAllResponse.statusCode, 200);
    const revokeAllPayload = revokeAllResponse.json() as {
      revokedCount: number;
      sessions: Array<{ id: string; status: string }>;
    };
    assert.equal(revokeAllPayload.revokedCount, 1);
    assert.equal(revokeAllPayload.sessions[0]?.id, third.session.id);
    assert.equal(revokeAllPayload.sessions[0]?.status, "revoked");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("verified companion pairings are promoted to a long-lived device session", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-companion-long-lived-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        userId: "user_operator"
      }
    });
    assert.equal(createResponse.statusCode, 201);
    const created = createResponse.json() as {
      qrPayload: {
        sessionId: string;
        pairingToken: string;
        expiresAt: string;
      };
    };

    const pendingExpiry = Date.parse(created.qrPayload.expiresAt);
    assert.ok(pendingExpiry > Date.now());

    const verifyResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/pairing/verify",
      payload: {
        sessionId: created.qrPayload.sessionId,
        pairingToken: created.qrPayload.pairingToken,
        device: {
          name: "Omar iPhone",
          platform: "ios",
          appVersion: "1.0",
          sourceDevice: "iPhone"
        }
      }
    });
    assert.equal(verifyResponse.statusCode, 200);

    const verifiedRow = getDatabase()
      .prepare(
        `SELECT status, expires_at
         FROM companion_pairing_sessions
         WHERE id = ?`
      )
      .get(created.qrPayload.sessionId) as
      | { status: string; expires_at: string }
      | undefined;

    assert.ok(verifiedRow);
    assert.equal(verifiedRow?.status, "paired");
    assert.ok(Date.parse(verifiedRow!.expires_at) > pendingExpiry + 365 * 24 * 60 * 60 * 1000);
  } finally {
    await app.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("companion source routes reconcile desired and applied state and reject invalid source params", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-companion-source-state-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const pairingResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        userId: "user_operator"
      }
    });
    assert.equal(pairingResponse.statusCode, 201);
    const pairingPayload = pairingResponse.json() as {
      session: { id: string };
      qrPayload: { sessionId: string; pairingToken: string };
    };

    const verifyResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/pairing/verify",
      payload: {
        sessionId: pairingPayload.qrPayload.sessionId,
        pairingToken: pairingPayload.qrPayload.pairingToken,
        device: {
          name: "Omar iPhone",
          platform: "ios",
          appVersion: "1.0",
          sourceDevice: "iPhone"
        }
      }
    });
    assert.equal(verifyResponse.statusCode, 200);

    const patchSourceResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/health/pairing-sessions/${pairingPayload.session.id}/sources/movement`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        desiredEnabled: false
      }
    });
    assert.equal(patchSourceResponse.statusCode, 200);
    const patchedSession = patchSourceResponse.json() as {
      session: {
        sourceStates: {
          movement: {
            desiredEnabled: boolean;
            appliedEnabled: boolean;
          };
        };
      };
    };
    assert.equal(
      patchedSession.session.sourceStates.movement.desiredEnabled,
      false
    );
    assert.equal(
      patchedSession.session.sourceStates.movement.appliedEnabled,
      false
    );

    const invalidSourceResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/health/pairing-sessions/${pairingPayload.session.id}/sources/focus`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        desiredEnabled: true
      }
    });
    assert.equal(invalidSourceResponse.statusCode, 400);

    const mobileStateResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/source-state",
      payload: {
        sessionId: pairingPayload.qrPayload.sessionId,
        pairingToken: pairingPayload.qrPayload.pairingToken,
        source: "movement",
        desiredEnabled: true,
        appliedEnabled: false,
        authorizationStatus: "pending",
        syncEligible: false,
        lastObservedAt: "2026-04-12T08:00:00.000Z",
        metadata: {
          source: "test"
        }
      }
    });
    assert.equal(mobileStateResponse.statusCode, 200);
    const mobileState = mobileStateResponse.json() as {
      pairingSession: {
        sourceStates: {
          movement: {
            desiredEnabled: boolean;
            appliedEnabled: boolean;
            authorizationStatus: string;
            syncEligible: boolean;
            lastObservedAt: string | null;
          };
        };
      };
    };
    assert.equal(
      mobileState.pairingSession.sourceStates.movement.desiredEnabled,
      true
    );
    assert.equal(
      mobileState.pairingSession.sourceStates.movement.appliedEnabled,
      false
    );
    assert.equal(
      mobileState.pairingSession.sourceStates.movement.authorizationStatus,
      "pending"
    );
    assert.equal(
      mobileState.pairingSession.sourceStates.movement.syncEligible,
      false
    );
    assert.equal(
      mobileState.pairingSession.sourceStates.movement.lastObservedAt,
      "2026-04-12T08:00:00.000Z"
    );

    const overviewResponse = await app.inject({
      method: "GET",
      url: "/api/v1/health/overview",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(overviewResponse.statusCode, 200);
    const overview = overviewResponse.json() as {
      overview: {
        pairings: Array<{
          id: string;
          sourceStates: {
            health: object;
            movement: {
              desiredEnabled: boolean;
              appliedEnabled: boolean;
              authorizationStatus: string;
            };
            screenTime: object;
          };
        }>;
      };
    };
    const pairing = overview.overview.pairings.find(
      (entry) => entry.id === pairingPayload.session.id
    );
    assert.ok(pairing);
    assert.equal(pairing?.sourceStates.movement.desiredEnabled, true);
    assert.equal(pairing?.sourceStates.movement.appliedEnabled, false);
    assert.equal(pairing?.sourceStates.movement.authorizationStatus, "pending");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("life force routes return stable stats and accept profile, template, and fatigue updates", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-life-force-routes-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const initial = await app.inject({
      method: "GET",
      url: "/api/v1/life-force",
      headers: { cookie: operatorCookie }
    });
    assert.equal(initial.statusCode, 200);
    const initialBody = initial.json() as {
      lifeForce: {
        stats: Array<{ key: string }>;
        warnings: Array<{ id: string }>;
        currentCurve: Array<{ minuteOfDay: number; rateApPerHour: number }>;
      };
      templates: Array<{
        weekday: number;
        points: Array<{ minuteOfDay: number }>;
      }>;
    };
    assert.equal(initialBody.lifeForce.stats.length, 6);
    assert.equal(initialBody.templates.length, 7);

    const profilePatch = await app.inject({
      method: "PATCH",
      url: "/api/v1/life-force/profile",
      headers: { cookie: operatorCookie },
      payload: {
        baseDailyAp: 230,
        readinessMultiplier: 1.05,
        stats: {
          life_force: 3,
          activation: 2,
          focus: 4,
          vigor: 2,
          composure: 2,
          flow: 3
        }
      }
    });
    assert.equal(profilePatch.statusCode, 200);
    const patchedProfile = profilePatch.json() as {
      lifeForce: {
        baselineDailyAp: number;
        readinessMultiplier: number;
        stats: Array<{ key: string; level: number }>;
      };
    };
    assert.equal(patchedProfile.lifeForce.baselineDailyAp, 230);
    assert.equal(patchedProfile.lifeForce.readinessMultiplier, 1.05);
    assert.equal(
      patchedProfile.lifeForce.stats.find((entry) => entry.key === "focus")
        ?.level,
      4
    );

    const templateUpdate = await app.inject({
      method: "PUT",
      url: `/api/v1/life-force/templates/${new Date().getUTCDay()}`,
      headers: { cookie: operatorCookie },
      payload: {
        points: [
          { minuteOfDay: 0, rateApPerHour: 0 },
          { minuteOfDay: 8 * 60, rateApPerHour: 8 },
          { minuteOfDay: 12 * 60, rateApPerHour: 12 },
          { minuteOfDay: 18 * 60, rateApPerHour: 8 },
          { minuteOfDay: 24 * 60, rateApPerHour: 0 }
        ]
      }
    });
    assert.equal(templateUpdate.statusCode, 200);
    const templateBody = templateUpdate.json() as {
      weekday: number;
      points: Array<{ minuteOfDay: number; rateApPerHour: number }>;
    };
    assert.equal(templateBody.points.length, 5);

    const fatigueResponse = await app.inject({
      method: "POST",
      url: "/api/v1/life-force/fatigue-signals",
      headers: { cookie: operatorCookie },
      payload: { signalType: "tired" }
    });
    assert.equal(fatigueResponse.statusCode, 200);
    const fatigueBody = fatigueResponse.json() as {
      lifeForce: {
        fatigueBufferApPerHour: number;
        warnings: Array<{ id: string }>;
      };
    };
    assert.ok(fatigueBody.lifeForce.fatigueBufferApPerHour >= 4);
    assert.ok(Array.isArray(fatigueBody.lifeForce.warnings));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("task close flow requires a work log and split route marks the parent without completion rewards", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-life-force-task-close-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const snapshotResponse = await app.inject({
      method: "GET",
      url: "/api/v1/context",
      headers: { cookie: operatorCookie }
    });
    assert.equal(snapshotResponse.statusCode, 200);
    const snapshot = snapshotResponse.json() as {
      dashboard: { projects: Array<{ id: string; goalId: string }> };
    };
    const project = snapshot.dashboard.projects[0]!;

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: { cookie: operatorCookie },
      payload: {
        title: "Close-flow life force task",
        description: "",
        status: "focus",
        priority: "medium",
        owner: "Albert",
        userId: "user_operator",
        goalId: project.goalId,
        projectId: project.id,
        dueDate: null,
        effort: "deep",
        energy: "steady",
        points: 60,
        plannedDurationSeconds: 86_400,
        tagIds: [],
        actionCostBand: "standard",
        notes: []
      }
    });
    assert.equal(createResponse.statusCode, 201);
    const createdTask = createResponse.json() as { task: { id: string } };

    const deniedClose = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${createdTask.task.id}`,
      headers: { cookie: operatorCookie },
      payload: { status: "done", enforceTodayWorkLog: true }
    });
    assert.equal(deniedClose.statusCode, 409);
    const deniedBody = deniedClose.json() as { code: string };
    assert.equal(deniedBody.code, "task_completion_work_log_required");

    const completedClose = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${createdTask.task.id}`,
      headers: { cookie: operatorCookie },
      payload: {
        status: "done",
        completedTodayWorkSeconds: 30 * 60
      }
    });
    assert.equal(completedClose.statusCode, 200);
    const completedTask = completedClose.json() as {
      task: {
        status: string;
        actionPointSummary: { spentTodayAp: number };
      };
    };
    assert.equal(completedTask.task.status, "done");
    assert.ok(completedTask.task.actionPointSummary.spentTodayAp > 0);

    const splitCreateResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: { cookie: operatorCookie },
      payload: {
        title: "Split-flow life force task",
        description: "",
        status: "focus",
        priority: "medium",
        owner: "Albert",
        userId: "user_operator",
        goalId: project.goalId,
        projectId: project.id,
        dueDate: null,
        effort: "deep",
        energy: "steady",
        points: 90,
        plannedDurationSeconds: 86_400,
        tagIds: [],
        actionCostBand: "standard",
        notes: []
      }
    });
    assert.equal(splitCreateResponse.statusCode, 201);
    const splitTaskCreated = splitCreateResponse.json() as {
      task: { id: string };
    };

    const splitResponse = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${splitTaskCreated.task.id}/split`,
      headers: { cookie: operatorCookie },
      payload: {
        firstTitle: "Split child one",
        secondTitle: "Split child two",
        remainingRatio: 0.6
      }
    });
    assert.equal(splitResponse.statusCode, 200);
    const splitBody = splitResponse.json() as {
      parent: { id: string; resolutionKind: string | null; status: string };
      children: Array<{
        splitParentTaskId: string | null;
        actionPointSummary: { totalCostAp: number };
      }>;
    };
    assert.equal(splitBody.parent.status, "done");
    assert.equal(splitBody.parent.resolutionKind, "split");
    assert.equal(splitBody.children.length, 2);
    assert.ok(
      splitBody.children.every(
        (child) => child.splitParentTaskId === splitBody.parent.id
      )
    );

    const rewardCount = (
      getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count
           FROM reward_ledger
           WHERE entity_type = 'task'
             AND entity_id = ?
             AND reversed_by_reward_id IS NULL`
        )
        .get(splitBody.parent.id) as { count: number }
    ).count;
    assert.equal(rewardCount, 0);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("dashboard bootstraps goals, tasks, tags, and premium stats", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-dashboard-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/dashboard"
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      goals: Array<{ id: string }>;
      tasks: Array<{ id: string }>;
      tags: Array<{ id: string }>;
      owners: string[];
      executionBuckets: Array<{ id: string; tasks: Array<{ id: string }> }>;
      stats: { totalPoints: number; overdueTasks: number; dueThisWeek: number };
    };

    assert.ok(body.goals.length >= 3);
    assert.ok(body.tasks.length >= 5);
    assert.ok(body.tags.length >= 6);
    assert.ok(body.owners.includes("Albert"));
    assert.equal(body.executionBuckets.length, 4);
    assert.ok(
      body.executionBuckets.some((bucket) => bucket.id === "focus_now")
    );
    assert.ok(body.stats.totalPoints >= 55);
    assert.ok(body.stats.overdueTasks >= 0);
    assert.ok(body.stats.dueThisWeek >= 0);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("task creation and column movement persist through the API", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-task-move-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard"
    });
    const payload = dashboard.json() as {
      goals: Array<{ id: string }>;
      tags: Array<{ id: string; kind: string }>;
    };
    const goalId = payload.goals[0]!.id;
    const tagIds = payload.tags.slice(0, 2).map((tag) => tag.id);

    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Ship the evening focus sprint",
        description: "One concentrated block tied directly to a life goal.",
        status: "focus",
        priority: "high",
        owner: "Albert",
        goalId,
        dueDate: "2026-03-25",
        effort: "deep",
        energy: "high",
        points: 80,
        tagIds
      }
    });

    assert.equal(created.statusCode, 201);
    const createdTask = (
      created.json() as { task: { id: string; status: string } }
    ).task;
    assert.equal(createdTask.status, "focus");

    const moved = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${createdTask.id}`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        status: "done"
      }
    });

    assert.equal(moved.statusCode, 200);
    const movedTask = (
      moved.json() as { task: { status: string; completedAt: string | null } }
    ).task;
    assert.equal(movedTask.status, "done");
    assert.ok(movedTask.completedAt);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("task completion API supports retroactive completion without burning today's AP", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-task-retro-complete-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard"
    });
    const dashboardPayload = dashboard.json() as {
      goals: Array<{ id: string }>;
    };
    const goalId = dashboardPayload.goals[0]!.id;
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Retroactive closeout",
        description: "Backdated completion should not burn today's AP.",
        status: "focus",
        priority: "high",
        owner: "Albert",
        goalId,
        dueDate: "2026-04-15",
        effort: "deep",
        energy: "high",
        points: 60
      }
    });

    assert.equal(created.statusCode, 201);
    const createdTask = (created.json() as { task: { id: string } }).task;

    const addWork = await app.inject({
      method: "POST",
      url: "/api/v1/work-adjustments",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        entityType: "task",
        entityId: createdTask.id,
        deltaMinutes: 60,
        note: "Logged today before realizing the work finished yesterday."
      }
    });

    assert.equal(addWork.statusCode, 201);

    const initialCompletion = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${createdTask.id}`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        status: "done"
      }
    });

    assert.equal(initialCompletion.statusCode, 200);

    const retroCompletedAt = "2026-04-10T18:30:00.000Z";
    const moved = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${createdTask.id}`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        status: "done",
        completedAt: retroCompletedAt,
        completedTodayWorkSeconds: 0
      }
    });

    assert.equal(moved.statusCode, 200);
    const movedTask = (
      moved.json() as { task: { status: string; completedAt: string | null } }
    ).task;
    assert.equal(movedTask.status, "done");
    assert.equal(movedTask.completedAt, retroCompletedAt);

    const taskContext = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${createdTask.id}/context`
    });

    assert.equal(taskContext.statusCode, 200);
    const taskBody = taskContext.json() as {
      task: {
        time: { totalCreditedSeconds: number };
        actionPointSummary: { spentTodayAp: number };
      };
    };
    assert.equal(taskBody.task.time.totalCreditedSeconds, 0);
    assert.equal(taskBody.task.actionPointSummary.spentTodayAp, 0);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("knowledge graph routes return a unified graph and focused neighborhood", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-knowledge-graph-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const graphResponse = await app.inject({
      method: "GET",
      url: "/api/v1/knowledge-graph"
    });

    assert.equal(graphResponse.statusCode, 200);
    const graphPayload = graphResponse.json() as {
      graph: {
        nodes: Array<{
          id: string;
          entityType: string;
          entityId: string;
          entityKind: string;
          graphHref: string;
          iconName: string | null;
          accentToken: string | null;
        }>;
        edges: Array<{
          id: string;
          source: string;
          target: string;
          family: string;
        }>;
      };
    };

    assert.ok(graphPayload.graph.nodes.length > 0);
    assert.ok(graphPayload.graph.edges.length > 0);
    assert.ok(
      graphPayload.graph.nodes.some((node) => node.entityType === "tag")
    );
    assert.ok(
      graphPayload.graph.nodes.some(
        (node) =>
          node.entityType === "workbench_surface" &&
          node.entityId === "workbench"
      )
    );
    assert.ok(
      graphPayload.graph.nodes.every(
        (node) =>
          node.graphHref.startsWith("/knowledge-graph?focus=") && node.iconName
      )
    );
    assert.ok(
      graphPayload.graph.edges.some((edge) => edge.family === "structural")
    );

    const focusCandidate =
      graphPayload.graph.nodes.find((node) => node.entityType === "goal") ??
      graphPayload.graph.nodes[0];

    assert.ok(focusCandidate);

    const focusResponse = await app.inject({
      method: "GET",
      url: `/api/v1/knowledge-graph/focus?entityType=${encodeURIComponent(
        focusCandidate.entityType
      )}&entityId=${encodeURIComponent(focusCandidate.entityId)}`
    });

    assert.equal(focusResponse.statusCode, 200);
    const focusPayload = focusResponse.json() as {
      focus: {
        focusNode: { id: string } | null;
        firstRingNodes: Array<{ id: string }>;
        neighborhoodEdges: Array<{ source: string; target: string }>;
        familyGroups: Array<{ family: string }>;
      };
    };

    assert.equal(focusPayload.focus.focusNode?.id, focusCandidate.id);
    assert.ok(focusPayload.focus.firstRingNodes.length > 0);
    assert.ok(focusPayload.focus.neighborhoodEdges.length > 0);
    assert.ok(focusPayload.focus.familyGroups.length > 0);
    assert.ok(
      focusPayload.focus.neighborhoodEdges.every(
        (edge) =>
          edge.source === focusCandidate.id || edge.target === focusCandidate.id
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("goal detail, operator context, and retroactive work logging are available on the versioned API", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-operator-context-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const goalsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/goals"
    });
    const goals = (goalsResponse.json() as { goals: Array<{ id: string }> })
      .goals;
    const goalId = goals[0]!.id;

    const goalResponse = await app.inject({
      method: "GET",
      url: `/api/v1/goals/${goalId}`
    });
    assert.equal(goalResponse.statusCode, 200);
    const goal = (goalResponse.json() as { goal: { id: string } }).goal;
    assert.equal(goal.id, goalId);

    const operatorContext = await app.inject({
      method: "GET",
      url: "/api/v1/operator/context",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(operatorContext.statusCode, 200);
    const context = (
      operatorContext.json() as {
        context: {
          activeProjects: Array<{ id: string }>;
          currentBoard: {
            backlog: Array<unknown>;
            focus: Array<unknown>;
            inProgress: Array<unknown>;
            blocked: Array<unknown>;
            done: Array<unknown>;
          };
          xp: { profile: { level: number } };
        };
      }
    ).context;
    assert.ok(context.activeProjects.length >= 1);
    assert.ok(Array.isArray(context.currentBoard.backlog));
    assert.ok(typeof context.xp.profile.level === "number");

    const today = new Date();
    const todayAt = (hour: number) =>
      new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
        hour,
        0,
        0,
        0
      ).toISOString();
    for (let index = 0; index < 14; index += 1) {
      createCalendarEvent({
        title: `Operator overview calendar event ${index + 1}`,
        description: `Calendar event ${index + 1} should appear in the compact operator overview.`,
        location: "",
        place: {
          label: "",
          address: "",
          timezone: "",
          latitude: null,
          longitude: null,
          source: "",
          externalPlaceId: ""
        },
        startAt: todayAt(6 + index),
        endAt: todayAt(7 + index),
        timezone: "Europe/Zurich",
        isAllDay: false,
        availability: "busy",
        eventType: "",
        categories: [],
        links: []
      });
    }

    const operatorOverview = await app.inject({
      method: "GET",
      url: "/api/v1/operator/overview",
      headers: {
        host: "127.0.0.1:4317",
        cookie: operatorCookie
      }
    });
    assert.equal(operatorOverview.statusCode, 200);
    const overview = (
      operatorOverview.json() as {
        overview: {
          detailMode: string;
          signalMatrix: Array<unknown>;
          snapshot: { goals: Array<{ id: string }> };
          operator: { focusTasks: Array<unknown> };
          calendar: {
            today: {
              events: Array<{ title: string }>;
            };
            counts: {
              todayEvents: number;
            };
          };
          notes: { notes: Array<unknown> };
          sleep: {
            summary: {
              totalSleepSeconds: number;
              averageSleepSeconds: number;
              latestBedtime: string | null;
              latestWakeTime: string | null;
            };
            latestNight: { id: string } | null;
            sessions: Array<{ id: string }>;
          };
          routeGuide: {
            preferredStart: string;
            mainRoutes: Array<{ id: string }>;
          };
          onboarding: { openApiUrl: string; webAppUrl: string };
        };
      }
    ).overview;
    assert.ok(overview.snapshot.goals.length >= 1);
    assert.ok(Array.isArray(overview.operator.focusTasks));
    assert.ok(typeof overview.sleep.summary.totalSleepSeconds === "number");
    assert.ok(typeof overview.sleep.summary.averageSleepSeconds === "number");
    assert.ok(Array.isArray(overview.sleep.sessions));
    if (overview.sleep.latestNight) {
      assert.ok(typeof overview.sleep.latestNight.id === "string");
      assert.ok(
        typeof overview.sleep.summary.latestBedtime === "string" ||
          overview.sleep.summary.latestBedtime === null
      );
      assert.ok(
        typeof overview.sleep.summary.latestWakeTime === "string" ||
          overview.sleep.summary.latestWakeTime === null
      );
    }
    assert.equal(
      overview.routeGuide.preferredStart,
      "/api/v1/operator/overview"
    );
    assert.ok(
      overview.routeGuide.mainRoutes.some(
        (route) => route.id === "psyche_overview"
      )
    );
    assert.equal(
      overview.onboarding.openApiUrl,
      "http://127.0.0.1:4317/api/v1/openapi.json"
    );
    assert.equal(overview.onboarding.webAppUrl, "http://127.0.0.1:4317/forge/");
    assert.equal(overview.detailMode, "compact");
    assert.ok(Array.isArray(overview.signalMatrix));
    assert.ok(overview.calendar.today.events.length >= 14);
    assert.equal(
      overview.calendar.counts.todayEvents,
      overview.calendar.today.events.length
    );
    assert.ok(
      overview.calendar.today.events.some(
        (event) => event.title === "Operator overview calendar event 14"
      )
    );
    assert.ok(Array.isArray(overview.notes.notes));
    assert.ok(
      operatorOverview.body.length < 200_000,
      `operator overview should stay compact, got ${operatorOverview.body.length} characters`
    );
    assert.ok(
      !operatorOverview.body.includes("contentMarkdown"),
      "operator overview should expose note IDs/titles/previews, not full note bodies"
    );

    const logged = await app.inject({
      method: "POST",
      url: "/api/v1/operator/log-work",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Retroactively capture completed teacher preparation work",
        goalId,
        summary: "Work already happened and should be recorded truthfully.",
        status: "done",
        points: 55
      }
    });

    assert.equal(logged.statusCode, 201);
    const loggedBody = logged.json() as {
      task: { id: string; status: string; goalId: string | null };
      xp: { recentLedger: Array<{ reasonTitle: string }> };
    };
    assert.equal(loggedBody.task.status, "done");
    assert.equal(loggedBody.task.goalId, goalId);
    assert.ok(loggedBody.xp.recentLedger.length >= 1);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("scoped context returns bot-owned goals and strategies when userIds are requested", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-multi-user-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const createdGoalResponse = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Bot-owned roadmap",
        description: "A bot-specific execution arc.",
        horizon: "year",
        status: "active",
        userId: "user_forge_bot",
        targetPoints: 400,
        themeColor: "#22d3ee",
        tagIds: [],
        notes: []
      }
    });
    assert.equal(createdGoalResponse.statusCode, 201);
    const createdGoal = (
      createdGoalResponse.json() as {
        goal: { id: string; userId: string | null };
      }
    ).goal;
    assert.equal(createdGoal.userId, "user_forge_bot");

    const createdProjectResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        goalId: createdGoal.id,
        title: "Bot execution lane",
        description: "Project owned by the bot user.",
        status: "active",
        userId: "user_forge_bot",
        targetPoints: 240,
        themeColor: "#22d3ee",
        notes: []
      }
    });
    assert.equal(createdProjectResponse.statusCode, 201);
    const createdProject = (
      createdProjectResponse.json() as {
        project: { id: string; userId: string | null };
      }
    ).project;
    assert.equal(createdProject.userId, "user_forge_bot");

    const createdStrategyResponse = await app.inject({
      method: "POST",
      url: "/api/v1/strategies",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Bot orchestration strategy",
        overview: "Keep the bot workstream aligned.",
        endStateDescription: "Bot-owned work is sequenced cleanly.",
        status: "active",
        userId: "user_forge_bot",
        targetGoalIds: [createdGoal.id],
        targetProjectIds: [createdProject.id],
        linkedEntities: [
          {
            entityType: "goal",
            entityId: createdGoal.id
          }
        ],
        graph: {
          nodes: [
            {
              id: "node_backend",
              entityType: "project",
              entityId: createdProject.id,
              title: "Bot execution lane",
              branchLabel: "core",
              notes: "Ship the owner-aware project first."
            }
          ],
          edges: []
        }
      }
    });
    assert.equal(createdStrategyResponse.statusCode, 201);
    const createdStrategy = (
      createdStrategyResponse.json() as {
        strategy: { id: string; userId: string | null };
      }
    ).strategy;
    assert.equal(createdStrategy.userId, "user_forge_bot");

    const scopedContextResponse = await app.inject({
      method: "GET",
      url: "/api/v1/context?userIds=user_forge_bot"
    });
    assert.equal(scopedContextResponse.statusCode, 200);
    const scopedContext = scopedContextResponse.json() as {
      goals: Array<{ id: string; userId: string | null }>;
      strategies: Array<{ id: string; userId: string | null }>;
      userScope: { selectedUserIds: string[] };
    };

    assert.ok(
      scopedContext.goals.some(
        (goal) => goal.id === createdGoal.id && goal.userId === "user_forge_bot"
      )
    );
    assert.ok(
      scopedContext.strategies.some(
        (strategy) =>
          strategy.id === createdStrategy.id &&
          strategy.userId === "user_forge_bot"
      )
    );
    assert.deepEqual(scopedContext.userScope.selectedUserIds, [
      "user_forge_bot"
    ]);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("managed tokens apply default scoped reads to operator context and overview without widening", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-agent-default-scope-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const createdGoalResponse = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: { cookie: operatorCookie },
      payload: {
        title: "Bot-scoped goal",
        description: "Work visible only to the bot-scoped token.",
        horizon: "year",
        status: "active",
        userId: "user_forge_bot",
        targetPoints: 200,
        themeColor: "#60a5fa",
        tagIds: [],
        notes: []
      }
    });
    assert.equal(createdGoalResponse.statusCode, 201);
    const createdGoalId = (
      createdGoalResponse.json() as { goal: { id: string } }
    ).goal.id;

    const createdProjectResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { cookie: operatorCookie },
      payload: {
        goalId: createdGoalId,
        title: "Bot-scoped project",
        description: "Project for scoped-read verification.",
        status: "active",
        userId: "user_forge_bot",
        targetPoints: 120,
        themeColor: "#60a5fa",
        notes: []
      }
    });
    assert.equal(createdProjectResponse.statusCode, 201);
    const createdProjectId = (
      createdProjectResponse.json() as {
        project: { id: string; userId: string | null };
      }
    ).project.id;

    const createdTaskResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: { cookie: operatorCookie },
      payload: {
        title: "Bot-scoped focus task",
        description: "Focus task for default scoped reads.",
        status: "focus",
        priority: "medium",
        owner: "Forge Bot",
        userId: "user_forge_bot",
        goalId: createdGoalId,
        projectId: createdProjectId,
        dueDate: null,
        effort: "deep",
        energy: "steady",
        points: 40,
        plannedDurationSeconds: 1800,
        tagIds: [],
        actionCostBand: "standard",
        notes: []
      }
    });
    assert.equal(createdTaskResponse.statusCode, 201);
    const createdTaskId = (
      createdTaskResponse.json() as { task: { id: string } }
    ).task.id;

    const tokenResponse = await app.inject({
      method: "POST",
      url: "/api/v1/settings/tokens",
      headers: { cookie: operatorCookie },
      payload: {
        label: "Bot scoped token",
        scopes: ["read"],
        scopePolicy: {
          userIds: ["user_forge_bot"],
          projectIds: [],
          tagIds: []
        }
      }
    });
    assert.equal(tokenResponse.statusCode, 201);
    const token = (
      tokenResponse.json() as { token: { token: string } }
    ).token.token;

    const scopedContextResponse = await app.inject({
      method: "GET",
      url: "/api/v1/operator/context",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    assert.equal(scopedContextResponse.statusCode, 200);
    const scopedContext = (
      scopedContextResponse.json() as {
        context: {
          activeProjects: Array<{ id: string; userId: string | null }>;
          focusTasks: Array<{ id: string; userId: string | null }>;
        };
      }
    ).context;
    assert.ok(
      scopedContext.activeProjects.some(
        (project) =>
          project.id === createdProjectId && project.userId === "user_forge_bot"
      )
    );
    assert.ok(
      scopedContext.focusTasks.some(
        (task) => task.id === createdTaskId && task.userId === "user_forge_bot"
      )
    );
    assert.ok(
      scopedContext.focusTasks.every((task) => task.userId === "user_forge_bot")
    );

    const overviewResponse = await app.inject({
      method: "GET",
      url: "/api/v1/operator/overview?userIds=user_operator,user_forge_bot",
      headers: {
        authorization: `Bearer ${token}`,
        host: "127.0.0.1:4317"
      }
    });
    assert.equal(overviewResponse.statusCode, 200);
    const overview = (
      overviewResponse.json() as {
        overview: {
          snapshot: {
            userScope: { selectedUserIds: string[] };
            goals: Array<{ userId: string | null }>;
          };
          onboarding: {
            effectiveScopePolicy: {
              userIds: string[];
              projectIds: string[];
              tagIds: string[];
            };
          };
        };
      }
    ).overview;
    assert.deepEqual(overview.snapshot.userScope.selectedUserIds, [
      "user_forge_bot"
    ]);
    assert.ok(
      overview.snapshot.goals.every((goal) => goal.userId === "user_forge_bot")
    );
    assert.deepEqual(overview.onboarding.effectiveScopePolicy, {
      userIds: ["user_forge_bot"],
      projectIds: [],
      tagIds: []
    });

    const narrowedToNoneResponse = await app.inject({
      method: "GET",
      url: "/api/v1/operator/context?userIds=user_operator",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    assert.equal(narrowedToNoneResponse.statusCode, 200);
    const narrowedToNone = (
      narrowedToNoneResponse.json() as {
        context: {
          activeProjects: Array<unknown>;
          focusTasks: Array<unknown>;
          currentBoard: {
            backlog: Array<unknown>;
            focus: Array<unknown>;
            inProgress: Array<unknown>;
            blocked: Array<unknown>;
            done: Array<unknown>;
          };
          recentActivity: Array<unknown>;
          recentTaskRuns: Array<unknown>;
        };
      }
    ).context;
    assert.equal(narrowedToNone.activeProjects.length, 0);
    assert.equal(narrowedToNone.focusTasks.length, 0);
    assert.equal(narrowedToNone.currentBoard.backlog.length, 0);
    assert.equal(narrowedToNone.currentBoard.focus.length, 0);
    assert.equal(narrowedToNone.currentBoard.inProgress.length, 0);
    assert.equal(narrowedToNone.currentBoard.blocked.length, 0);
    assert.equal(narrowedToNone.currentBoard.done.length, 0);
    assert.equal(narrowedToNone.recentActivity.length, 0);
    assert.equal(narrowedToNone.recentTaskRuns.length, 0);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("mobile health sync builds richer summaries and reconciles habit-generated workouts", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-mobile-health-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const goalsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/goals"
    });
    const goalId = (goalsResponse.json() as { goals: Array<{ id: string }> })
      .goals[0]!.id;

    const habitResponse = await app.inject({
      method: "POST",
      url: "/api/v1/habits",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Morning sport routine",
        description: "Generate a recovery walk session on completion.",
        status: "active",
        polarity: "positive",
        frequency: "daily",
        targetCount: 1,
        weekDays: [],
        linkedGoalIds: [goalId],
        linkedProjectIds: [],
        linkedTaskIds: [],
        linkedValueIds: [],
        linkedPatternIds: [],
        linkedBehaviorIds: [],
        linkedBeliefIds: [],
        linkedModeIds: [],
        linkedReportIds: [],
        linkedBehaviorId: null,
        rewardXp: 12,
        penaltyXp: 8,
        generatedHealthEventTemplate: {
          enabled: true,
          workoutType: "walk",
          title: "Morning walk",
          durationMinutes: 45,
          xpReward: 25,
          tags: ["morning", "recovery"],
          links: [],
          notesTemplate: "Habit-generated recovery walk."
        }
      }
    });
    assert.equal(habitResponse.statusCode, 201);
    const habitId = (habitResponse.json() as { habit: { id: string } }).habit
      .id;

    const checkInResponse = await app.inject({
      method: "POST",
      url: `/api/v1/habits/${habitId}/check-ins`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        dateKey: "2026-04-05",
        status: "done",
        note: "Completed before work."
      }
    });
    assert.equal(checkInResponse.statusCode, 200);

    const pairingResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        userId: "user_operator"
      }
    });
    assert.equal(pairingResponse.statusCode, 201);
    const qrPayload = (
      pairingResponse.json() as {
        qrPayload: {
          sessionId: string;
          pairingToken: string;
        };
      }
    ).qrPayload;

    const syncResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/healthkit/sync",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        device: {
          name: "Omar iPhone",
          platform: "ios",
          appVersion: "1.0",
          sourceDevice: "iPhone"
        },
        permissions: {
          healthKitAuthorized: true,
          backgroundRefreshEnabled: true,
          motionReady: false,
          locationReady: false,
          screenTimeReady: true
        },
        screenTime: {
          settings: {
            trackingEnabled: true,
            syncEnabled: true,
            authorizationStatus: "approved",
            captureState: "ready",
            lastCapturedDayKey: "2026-04-05",
            lastCaptureStartedAt: "2026-04-05T07:00:00.000Z",
            lastCaptureEndedAt: "2026-04-05T09:00:00.000Z",
            metadata: {
              source: "test_fixture"
            }
          },
          daySummaries: [
            {
              dateKey: "2026-04-05",
              totalActivitySeconds: 5400,
              pickupCount: 14,
              notificationCount: 8,
              firstPickupAt: "2026-04-05T07:12:00.000Z",
              longestActivitySeconds: 2100,
              topAppBundleIdentifiers: [
                "com.apple.mobilesafari",
                "com.apple.MobileSMS"
              ],
              topCategoryLabels: ["Productivity", "Social"],
              metadata: {
                capture: "hourly_backfill"
              }
            }
          ],
          hourlySegments: [
            {
              dateKey: "2026-04-05",
              hourIndex: 7,
              startedAt: "2026-04-05T07:00:00.000Z",
              endedAt: "2026-04-05T08:00:00.000Z",
              totalActivitySeconds: 2700,
              pickupCount: 6,
              notificationCount: 3,
              firstPickupAt: "2026-04-05T07:12:00.000Z",
              longestActivityStartedAt: "2026-04-05T07:18:00.000Z",
              longestActivityEndedAt: "2026-04-05T07:45:00.000Z",
              metadata: {
                source: "test_fixture"
              },
              apps: [
                {
                  bundleIdentifier: "com.apple.mobilesafari",
                  displayName: "Safari",
                  categoryLabel: "Productivity",
                  totalActivitySeconds: 1800,
                  pickupCount: 4,
                  notificationCount: 0
                },
                {
                  bundleIdentifier: "com.apple.MobileSMS",
                  displayName: "Messages",
                  categoryLabel: "Social",
                  totalActivitySeconds: 600,
                  pickupCount: 2,
                  notificationCount: 3
                }
              ],
              categories: [
                {
                  categoryLabel: "Productivity",
                  totalActivitySeconds: 1800
                },
                {
                  categoryLabel: "Social",
                  totalActivitySeconds: 600
                }
              ]
            },
            {
              dateKey: "2026-04-05",
              hourIndex: 8,
              startedAt: "2026-04-05T08:00:00.000Z",
              endedAt: "2026-04-05T09:00:00.000Z",
              totalActivitySeconds: 2700,
              pickupCount: 8,
              notificationCount: 5,
              firstPickupAt: "2026-04-05T08:05:00.000Z",
              longestActivityStartedAt: "2026-04-05T08:10:00.000Z",
              longestActivityEndedAt: "2026-04-05T08:45:00.000Z",
              metadata: {
                source: "test_fixture"
              },
              apps: [
                {
                  bundleIdentifier: "com.apple.MobileSMS",
                  displayName: "Messages",
                  categoryLabel: "Social",
                  totalActivitySeconds: 1200,
                  pickupCount: 5,
                  notificationCount: 5
                },
                {
                  bundleIdentifier: "com.apple.mobilesafari",
                  displayName: "Safari",
                  categoryLabel: "Productivity",
                  totalActivitySeconds: 900,
                  pickupCount: 3,
                  notificationCount: 0
                }
              ],
              categories: [
                {
                  categoryLabel: "Social",
                  totalActivitySeconds: 1200
                },
                {
                  categoryLabel: "Productivity",
                  totalActivitySeconds: 900
                }
              ]
            }
          ]
        },
        sleepSessions: [
          {
            externalUid: "sleep-2026-04-04",
            startedAt: "2026-04-04T22:45:00.000Z",
            endedAt: "2026-04-05T06:30:00.000Z",
            timeInBedSeconds: 29400,
            asleepSeconds: 27000,
            awakeSeconds: 900,
            stageBreakdown: [
              { stage: "deep", seconds: 5400 },
              { stage: "rem", seconds: 6000 },
              { stage: "core", seconds: 15600 }
            ],
            recoveryMetrics: {
              sleepWindowStart: "2026-04-04T22:45:00.000Z"
            },
            links: [
              {
                entityType: "goal",
                entityId: goalId,
                relationshipType: "context"
              }
            ],
            annotations: {
              qualitySummary: "Solid night before a structured day.",
              notes: "Low rumination and good wind-down.",
              tags: ["routine"]
            }
          }
        ],
        workouts: [
          {
            externalUid: "workout-2026-04-05",
            workoutType: "walk",
            startedAt: "2026-04-05T07:15:00.000Z",
            endedAt: "2026-04-05T07:58:00.000Z",
            activeEnergyKcal: 220,
            totalEnergyKcal: 240,
            distanceMeters: 4100,
            stepCount: 5200,
            exerciseMinutes: 43,
            averageHeartRate: 118,
            maxHeartRate: 141,
            sourceDevice: "Apple Watch",
            links: [
              {
                entityType: "goal",
                entityId: goalId,
                relationshipType: "context"
              }
            ],
            annotations: {
              moodBefore: "flat",
              moodAfter: "steady",
              meaningText:
                "Used this walk to protect recovery and sleep rhythm.",
              tags: ["sleep-support"]
            }
          }
        ],
        vitals: {
          daySummaries: [
            {
              dateKey: "2026-04-05",
              sourceTimezone: "Europe/Zurich",
              metrics: [
                {
                  metric: "restingHeartRate",
                  label: "Resting heart rate",
                  category: "recovery",
                  unit: "bpm",
                  displayUnit: "bpm",
                  aggregation: "discrete",
                  average: 54,
                  minimum: 52,
                  maximum: 58,
                  latest: 55,
                  sampleCount: 6,
                  latestSampleAt: "2026-04-05T06:40:00.000Z"
                },
                {
                  metric: "heartRateVariabilitySDNN",
                  label: "HRV (SDNN)",
                  category: "recovery",
                  unit: "ms",
                  displayUnit: "ms",
                  aggregation: "discrete",
                  average: 61,
                  minimum: 58,
                  maximum: 66,
                  latest: 63,
                  sampleCount: 4,
                  latestSampleAt: "2026-04-05T06:40:00.000Z"
                },
                {
                  metric: "vo2Max",
                  label: "VO2 max",
                  category: "cardio",
                  unit: "ml/kg/min",
                  displayUnit: "ml/kg/min",
                  aggregation: "discrete",
                  average: 47.2,
                  minimum: 47.2,
                  maximum: 47.2,
                  latest: 47.2,
                  sampleCount: 1,
                  latestSampleAt: "2026-04-05T07:58:00.000Z"
                },
                {
                  metric: "stepCount",
                  label: "Steps",
                  category: "activity",
                  unit: "steps",
                  displayUnit: "steps",
                  aggregation: "cumulative",
                  total: 9420,
                  latest: 9420,
                  sampleCount: 184,
                  latestSampleAt: "2026-04-05T20:55:00.000Z"
                }
              ]
            }
          ]
        }
      }
    });
    assert.equal(syncResponse.statusCode, 200);
    const syncBody = syncResponse.json() as {
      sync: { imported: { mergedCount: number } };
    };
    assert.equal(syncBody.sync.imported.mergedCount, 1);

    const overviewResponse = await app.inject({
      method: "GET",
      url: "/api/v1/health/overview"
    });
    assert.equal(overviewResponse.statusCode, 200);
    const overview = (
      overviewResponse.json() as {
        overview: {
          healthState: string;
          counts: {
            reflectiveSleepSessions: number;
            reconciledWorkouts: number;
            vitalsDaySummaries?: number;
            vitalsMetricEntries?: number;
            screenTimeDaySummaries?: number;
            screenTimeHourlySegments?: number;
          };
          permissions: {
            healthKitAuthorized: boolean;
            backgroundRefreshEnabled: boolean;
            screenTimeReady?: boolean;
          };
        };
      }
    ).overview;
    assert.equal(overview.healthState, "healthy_sync");
    assert.equal(overview.counts.reflectiveSleepSessions, 1);
    assert.equal(overview.counts.reconciledWorkouts, 1);
    assert.equal(overview.counts.vitalsDaySummaries, 1);
    assert.equal(overview.counts.vitalsMetricEntries, 4);
    assert.equal(overview.counts.screenTimeDaySummaries, 1);
    assert.equal(overview.counts.screenTimeHourlySegments, 2);
    assert.equal(overview.permissions.healthKitAuthorized, true);
    assert.equal(overview.permissions.backgroundRefreshEnabled, true);
    assert.equal(overview.permissions.screenTimeReady, true);

    const vitalsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/health/vitals"
    });
    assert.equal(vitalsResponse.statusCode, 200);
    const vitals = (
      vitalsResponse.json() as {
        vitals: {
          summary: {
            trackedDays: number;
            metricCount: number;
          };
          metrics: Array<{
            metric: string;
            latestValue: number | null;
            coverageDays: number;
          }>;
        };
      }
    ).vitals;
    assert.equal(vitals.summary.trackedDays, 1);
    assert.equal(vitals.summary.metricCount, 4);
    assert.equal(
      vitals.metrics.find((metric) => metric.metric === "restingHeartRate")
        ?.latestValue,
      55
    );
    assert.equal(
      vitals.metrics.find((metric) => metric.metric === "stepCount")
        ?.latestValue,
      9420
    );

    const sleepResponse = await app.inject({
      method: "GET",
      url: "/api/v1/health/sleep"
    });
    assert.equal(sleepResponse.statusCode, 200);
    const sleep = (
      sleepResponse.json() as {
        sleep: {
          summary: {
            averageEfficiency: number;
            averageRestorativeShare: number;
            reflectiveNightCount: number;
          };
          stageAverages: Array<{ stage: string; averageSeconds: number }>;
        };
      }
    ).sleep;
    assert.ok(sleep.summary.averageEfficiency > 0.8);
    assert.ok(sleep.summary.averageRestorativeShare > 0.3);
    assert.equal(sleep.summary.reflectiveNightCount, 1);
    assert.ok(
      sleep.stageAverages.some(
        (stage) => stage.stage === "deep" && stage.averageSeconds > 0
      )
    );

    const fitnessResponse = await app.inject({
      method: "GET",
      url: "/api/v1/health/fitness"
    });
    assert.equal(fitnessResponse.statusCode, 200);
    const fitness = (
      fitnessResponse.json() as {
        fitness: {
          summary: {
            reconciledSessionCount: number;
            topWorkoutType: string | null;
            linkedSessionCount: number;
          };
          typeBreakdown: Array<{ workoutType: string; totalMinutes: number }>;
        };
      }
    ).fitness;
    assert.equal(fitness.summary.reconciledSessionCount, 1);
    assert.equal(fitness.summary.topWorkoutType, "walk");
    assert.equal(fitness.summary.linkedSessionCount, 1);
    assert.ok(
      fitness.typeBreakdown.some(
        (entry) => entry.workoutType === "walk" && entry.totalMinutes >= 40
      )
    );

    const screenTimeSettingsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/screen-time/settings"
    });
    assert.equal(screenTimeSettingsResponse.statusCode, 200);
    const screenTimeSettings = (
      screenTimeSettingsResponse.json() as {
        settings: {
          authorizationStatus: string;
          captureState: string;
          trackingEnabled: boolean;
          syncEnabled: boolean;
          captureFreshness: string;
          capturedDayCount: number;
          capturedHourCount: number;
        };
      }
    ).settings;
    assert.equal(screenTimeSettings.authorizationStatus, "approved");
    assert.equal(screenTimeSettings.captureState, "ready");
    assert.equal(screenTimeSettings.trackingEnabled, true);
    assert.equal(screenTimeSettings.syncEnabled, true);
    assert.equal(screenTimeSettings.captureFreshness, "stale");
    assert.equal(screenTimeSettings.capturedDayCount, 1);
    assert.equal(screenTimeSettings.capturedHourCount, 2);

    const screenTimeDayResponse = await app.inject({
      method: "GET",
      url: "/api/v1/screen-time/day?date=2026-04-05"
    });
    assert.equal(screenTimeDayResponse.statusCode, 200);
    const screenTimeDay = (
      screenTimeDayResponse.json() as {
        screenTime: {
          summary: {
            totalActivitySeconds: number;
            pickupCount: number;
            notificationCount: number;
            activeHourCount: number;
          };
          topApps: Array<{
            displayName: string;
            totalActivitySeconds: number;
          }>;
        };
      }
    ).screenTime;
    assert.equal(screenTimeDay.summary.totalActivitySeconds, 5400);
    assert.equal(screenTimeDay.summary.pickupCount, 14);
    assert.equal(screenTimeDay.summary.notificationCount, 8);
    assert.equal(screenTimeDay.summary.activeHourCount, 2);
    assert.ok(
      screenTimeDay.topApps.some(
        (app) =>
          app.displayName === "Safari" && app.totalActivitySeconds >= 1800
      )
    );
    assert.ok(
      screenTimeDay.topApps.some(
        (app) =>
          app.displayName === "Messages" && app.totalActivitySeconds >= 1800
      )
    );

    const screenTimeMonthResponse = await app.inject({
      method: "GET",
      url: "/api/v1/screen-time/month?month=2026-04"
    });
    assert.equal(screenTimeMonthResponse.statusCode, 200);
    const screenTimeMonth = (
      screenTimeMonthResponse.json() as {
        screenTime: {
          totals: {
            totalActivitySeconds: number;
            pickupCount: number;
            notificationCount: number;
            activeDays: number;
          };
        };
      }
    ).screenTime;
    assert.equal(screenTimeMonth.totals.totalActivitySeconds, 5400);
    assert.equal(screenTimeMonth.totals.pickupCount, 14);
    assert.equal(screenTimeMonth.totals.notificationCount, 8);
    assert.equal(screenTimeMonth.totals.activeDays, 1);

    const screenTimeAllTimeResponse = await app.inject({
      method: "GET",
      url: "/api/v1/screen-time/all-time"
    });
    assert.equal(screenTimeAllTimeResponse.statusCode, 200);
    const screenTimeAllTime = (
      screenTimeAllTimeResponse.json() as {
        screenTime: {
          summary: {
            dayCount: number;
            totalActivitySeconds: number;
            totalPickups: number;
          };
          topCategories: Array<{
            categoryLabel: string;
          }>;
        };
      }
    ).screenTime;
    assert.equal(screenTimeAllTime.summary.dayCount, 1);
    assert.equal(screenTimeAllTime.summary.totalActivitySeconds, 5400);
    assert.equal(screenTimeAllTime.summary.totalPickups, 14);
    assert.ok(
      screenTimeAllTime.topCategories.some(
        (category) => category.categoryLabel === "Productivity"
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("mobile health sync exposes structured apple health workout descriptors and details", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-mobile-health-workout-adapter-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const pairingResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        userId: "user_operator"
      }
    });
    assert.equal(pairingResponse.statusCode, 201);
    const qrPayload = (
      pairingResponse.json() as {
        qrPayload: {
          sessionId: string;
          pairingToken: string;
        };
      }
    ).qrPayload;

    const syncResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/healthkit/sync",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        device: {
          name: "Omar iPhone",
          platform: "ios",
          appVersion: "1.0",
          sourceDevice: "iPhone"
        },
        permissions: {
          healthKitAuthorized: true,
          backgroundRefreshEnabled: true,
          motionReady: false,
          locationReady: false,
          screenTimeReady: false
        },
        sleepSessions: [],
        workouts: [
          {
            externalUid: "hk-workout-activity-52",
            workoutType: "activity_52",
            startedAt: "2026-04-07T07:15:00.000Z",
            endedAt: "2026-04-07T08:00:00.000Z",
            activeEnergyKcal: 210,
            totalEnergyKcal: 230,
            distanceMeters: 3800,
            stepCount: 4800,
            exerciseMinutes: 45,
            averageHeartRate: 116,
            maxHeartRate: 138,
            sourceDevice: "Apple Watch",
            sourceSystem: "apple_health",
            sourceBundleIdentifier: "com.apple.health",
            sourceProductType: "Watch7,5",
            activity: {
              sourceSystem: "apple_health",
              providerActivityType: "hk_workout_activity_type",
              providerRawValue: 52,
              canonicalKey: "walking",
              canonicalLabel: "Walking",
              familyKey: "cardio",
              familyLabel: "Cardio",
              isFallback: false
            },
            details: {
              sourceSystem: "apple_health",
              metrics: [
                {
                  key: "average_speed",
                  label: "Average speed",
                  category: "cardio",
                  unit: "km/h",
                  statistic: "average",
                  value: 5.1
                },
                {
                  key: "time_in_zone_2_minutes",
                  label: "Time in zone 2",
                  category: "heart_rate",
                  unit: "min",
                  statistic: "total",
                  value: 24
                }
              ],
              events: [
                {
                  type: "pause",
                  label: "Pause",
                  startedAt: "2026-04-07T07:33:00.000Z",
                  endedAt: "2026-04-07T07:35:00.000Z",
                  durationSeconds: 120,
                  metadata: {}
                }
              ],
              components: [
                {
                  externalUid: "hk-workout-activity-52-segment-1",
                  startedAt: "2026-04-07T07:50:00.000Z",
                  endedAt: "2026-04-07T08:00:00.000Z",
                  durationSeconds: 600,
                  activity: {
                    sourceSystem: "apple_health",
                    providerActivityType: "hk_workout_activity_type",
                    providerRawValue: 80,
                    canonicalKey: "cooldown",
                    canonicalLabel: "Cooldown",
                    familyKey: "mobility",
                    familyLabel: "Mobility",
                    isFallback: false
                  },
                  metrics: [],
                  metadata: {}
                }
              ],
              metadata: {
                indoorWorkout: false
              }
            },
            links: [],
            annotations: {}
          }
        ],
        vitals: {
          daySummaries: []
        }
      }
    });
    assert.equal(syncResponse.statusCode, 200);

    const fitnessResponse = await app.inject({
      method: "GET",
      url: "/api/v1/health/fitness"
    });
    assert.equal(fitnessResponse.statusCode, 200);
    const fitness = (
      fitnessResponse.json() as {
        fitness: {
          summary: {
            topWorkoutType: string | null;
            topWorkoutTypeLabel?: string | null;
          };
          typeBreakdown: Array<{
            workoutType: string;
            workoutTypeLabel?: string;
            activityFamily?: string;
            activityFamilyLabel?: string;
          }>;
          sessions: Array<{
            sourceSystem?: string;
            sourceBundleIdentifier?: string | null;
            sourceProductType?: string | null;
            workoutType: string;
            workoutTypeLabel?: string;
            activityFamily?: string;
            activityFamilyLabel?: string;
            activity?: {
              providerRawValue?: number | null;
            };
            details?: {
              metrics: Array<{ key: string }>;
              events: Array<{ type: string }>;
              components: Array<{
                activity: { canonicalLabel: string };
              }>;
            };
          }>;
        };
      }
    ).fitness;

    assert.equal(fitness.summary.topWorkoutType, "walking");
    assert.equal(fitness.summary.topWorkoutTypeLabel, "Walking");
    assert.equal(fitness.typeBreakdown[0]?.workoutType, "walking");
    assert.equal(fitness.typeBreakdown[0]?.workoutTypeLabel, "Walking");
    assert.equal(fitness.typeBreakdown[0]?.activityFamily, "cardio");
    assert.equal(fitness.typeBreakdown[0]?.activityFamilyLabel, "Cardio");

    const session = fitness.sessions[0];
    assert.ok(session);
    assert.equal(session.sourceSystem, "apple_health");
    assert.equal(session.sourceBundleIdentifier, "com.apple.health");
    assert.equal(session.sourceProductType, "Watch7,5");
    assert.equal(session.workoutType, "walking");
    assert.equal(session.workoutTypeLabel, "Walking");
    assert.equal(session.activityFamily, "cardio");
    assert.equal(session.activityFamilyLabel, "Cardio");
    assert.equal(session.activity?.providerRawValue, 52);
    assert.deepEqual(
      session.details?.metrics.map((metric) => metric.key),
      ["average_speed", "time_in_zone_2_minutes"]
    );
    assert.deepEqual(
      session.details?.events.map((event) => event.type),
      ["pause"]
    );
    assert.deepEqual(
      session.details?.components.map((component) => component.activity.canonicalLabel),
      ["Cooldown"]
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("context ignores invalid scoped user ids instead of blanking the board", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-user-scope-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/context?userIds=user_missing"
    });
    assert.equal(response.statusCode, 200);
    const context = response.json() as {
      goals: Array<{ id: string }>;
      tasks: Array<{ id: string }>;
      userScope: { selectedUserIds: string[] };
    };

    assert.equal(context.userScope.selectedUserIds.length, 0);
    assert.ok(context.goals.length > 0);
    assert.ok(context.tasks.length > 0);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("mobile health sync accepts screen time warning paths and records warning diagnostics", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-mobile-health-screen-time-warning-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const pairingResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        userId: "user_operator"
      }
    });
    assert.equal(pairingResponse.statusCode, 201);
    const qrPayload = (
      pairingResponse.json() as {
        qrPayload: {
          sessionId: string;
          pairingToken: string;
        };
      }
    ).qrPayload;

    const approvedEmptyResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/healthkit/sync",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        device: {
          name: "Omar iPhone",
          platform: "ios",
          appVersion: "1.0",
          sourceDevice: "iPhone"
        },
        permissions: {
          healthKitAuthorized: true,
          backgroundRefreshEnabled: true,
          motionReady: false,
          locationReady: false,
          screenTimeReady: true
        },
        sleepSessions: [],
        workouts: [],
        screenTime: {
          settings: {
            trackingEnabled: true,
            syncEnabled: true,
            authorizationStatus: "approved",
            captureState: "ready",
            lastCapturedDayKey: "2026-04-11",
            lastCaptureStartedAt: "2026-04-11T08:00:00.000Z",
            lastCaptureEndedAt: "2026-04-11T08:00:00.000Z",
            metadata: {
              source: "warning_test"
            }
          },
          daySummaries: [],
          hourlySegments: []
        }
      }
    });
    assert.equal(approvedEmptyResponse.statusCode, 200);

    const unavailableResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/healthkit/sync",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        device: {
          name: "Omar iPhone",
          platform: "ios",
          appVersion: "1.0",
          sourceDevice: "iPhone"
        },
        permissions: {
          healthKitAuthorized: true,
          backgroundRefreshEnabled: true,
          motionReady: false,
          locationReady: false,
          screenTimeReady: false
        },
        sleepSessions: [],
        workouts: [],
        screenTime: {
          settings: {
            trackingEnabled: true,
            syncEnabled: false,
            authorizationStatus: "unavailable",
            captureState: "needs_authorization",
            lastCapturedDayKey: null,
            lastCaptureStartedAt: null,
            lastCaptureEndedAt: null,
            metadata: {
              source: "warning_test"
            }
          },
          daySummaries: [],
          hourlySegments: []
        }
      }
    });
    assert.equal(unavailableResponse.statusCode, 200);

    const logsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/diagnostics/logs?scope=screen_time_sync&limit=20",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(logsResponse.statusCode, 200);
    const logsBody = logsResponse.json() as {
      logs: Array<{
        eventKey: string;
        level: string;
        message: string;
      }>;
    };

    assert.ok(
      logsBody.logs.some(
        (entry) =>
          entry.eventKey === "screen_time_capture_empty" &&
          entry.level === "warning"
      )
    );
    assert.ok(
      logsBody.logs.some(
        (entry) =>
          entry.eventKey === "screen_time_sync_ingested" &&
          entry.level === "warning" &&
          entry.message.includes("unavailable")
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("mobile health sync stores canonical sleep nights with raw segments and exposes raw sleep detail", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-mobile-health-sleep-nights-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const pairingResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        userId: "user_operator"
      }
    });
    assert.equal(pairingResponse.statusCode, 201);
    const qrPayload = (
      pairingResponse.json() as {
        qrPayload: { sessionId: string; pairingToken: string };
      }
    ).qrPayload;

    const syncResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/healthkit/sync",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        device: {
          name: "Omar iPhone",
          platform: "ios",
          appVersion: "1.0",
          sourceDevice: "iPhone"
        },
        permissions: {
          healthKitAuthorized: true,
          backgroundRefreshEnabled: true,
          motionReady: false,
          locationReady: false,
          screenTimeReady: false
        },
        sleepSessions: [],
        sleepNights: [
          {
            externalUid: "night_2026_04_05",
            startedAt: "2026-04-04T22:40:00.000Z",
            endedAt: "2026-04-05T06:35:00.000Z",
            sourceTimezone: "Europe/Zurich",
            localDateKey: "2026-04-05",
            timeInBedSeconds: 28_500,
            asleepSeconds: 26_700,
            awakeSeconds: 1_800,
            rawSegmentCount: 4,
            stageBreakdown: [
              { stage: "core", seconds: 14_400 },
              { stage: "deep", seconds: 5_400 },
              { stage: "rem", seconds: 6_900 }
            ],
            recoveryMetrics: {
              sleepWindowStart: "2026-04-04T22:40:00.000Z"
            },
            sourceMetrics: {
              hasInBedSamples: true,
              inferredGapSeconds: 0
            },
            links: [],
            annotations: {
              qualitySummary: "Recovered after a long day.",
              notes: "Canonical night should keep raw segments attached.",
              tags: ["apple-health"]
            }
          }
        ],
        sleepSegments: [
          {
            externalUid: "seg_1",
            startedAt: "2026-04-04T22:40:00.000Z",
            endedAt: "2026-04-05T06:35:00.000Z",
            sourceTimezone: "Europe/Zurich",
            localDateKey: "2026-04-05",
            stage: "in_bed",
            bucket: "in_bed",
            sourceValue: 0,
            metadata: { source: "test" }
          },
          {
            externalUid: "seg_2",
            startedAt: "2026-04-04T22:55:00.000Z",
            endedAt: "2026-04-05T02:55:00.000Z",
            sourceTimezone: "Europe/Zurich",
            localDateKey: "2026-04-05",
            stage: "core",
            bucket: "asleep",
            sourceValue: 3,
            metadata: { source: "test" }
          },
          {
            externalUid: "seg_3",
            startedAt: "2026-04-05T02:55:00.000Z",
            endedAt: "2026-04-05T04:25:00.000Z",
            sourceTimezone: "Europe/Zurich",
            localDateKey: "2026-04-05",
            stage: "deep",
            bucket: "asleep",
            sourceValue: 4,
            metadata: { source: "test" }
          },
          {
            externalUid: "seg_4",
            startedAt: "2026-04-05T04:25:00.000Z",
            endedAt: "2026-04-05T06:20:00.000Z",
            sourceTimezone: "Europe/Zurich",
            localDateKey: "2026-04-05",
            stage: "rem",
            bucket: "asleep",
            sourceValue: 5,
            metadata: { source: "test" }
          }
        ],
        sleepRawRecords: [
          {
            externalUid: "seg_1",
            startedAt: "2026-04-04T22:40:00.000Z",
            endedAt: "2026-04-05T06:35:00.000Z",
            sourceTimezone: "Europe/Zurich",
            localDateKey: "2026-04-05",
            providerRecordType: "healthkit_sleep_sample",
            rawStage: "in_bed",
            rawValue: 0,
            payload: { source: "test" },
            metadata: { origin: "raw" }
          },
          {
            externalUid: "seg_2",
            startedAt: "2026-04-04T22:55:00.000Z",
            endedAt: "2026-04-05T02:55:00.000Z",
            sourceTimezone: "Europe/Zurich",
            localDateKey: "2026-04-05",
            providerRecordType: "healthkit_sleep_sample",
            rawStage: "core",
            rawValue: 3,
            payload: { source: "test" },
            metadata: { origin: "raw" }
          },
          {
            externalUid: "seg_3",
            startedAt: "2026-04-05T02:55:00.000Z",
            endedAt: "2026-04-05T04:25:00.000Z",
            sourceTimezone: "Europe/Zurich",
            localDateKey: "2026-04-05",
            providerRecordType: "healthkit_sleep_sample",
            rawStage: "deep",
            rawValue: 4,
            payload: { source: "test" },
            metadata: { origin: "raw" }
          },
          {
            externalUid: "seg_4",
            startedAt: "2026-04-05T04:25:00.000Z",
            endedAt: "2026-04-05T06:20:00.000Z",
            sourceTimezone: "Europe/Zurich",
            localDateKey: "2026-04-05",
            providerRecordType: "healthkit_sleep_sample",
            rawStage: "rem",
            rawValue: 5,
            payload: { source: "test" },
            metadata: { origin: "raw" }
          }
        ],
        workouts: []
      }
    });
    assert.equal(syncResponse.statusCode, 200);
    const sync = (
      syncResponse.json() as {
        sync: {
          imported: {
            sleepSessions: number;
            sleepNights: number;
            sleepSegments: number;
            sleepRawRecords: number;
          };
        };
      }
    ).sync;
    assert.equal(sync.imported.sleepSessions, 0);
    assert.equal(sync.imported.sleepNights, 1);
    assert.equal(sync.imported.sleepSegments, 4);
    assert.equal(sync.imported.sleepRawRecords, 4);

    const sleepResponse = await app.inject({
      method: "GET",
      url: "/api/v1/health/sleep"
    });
    assert.equal(sleepResponse.statusCode, 200);
    const sleep = (
      sleepResponse.json() as {
        sleep: {
          latestNight: {
            sleepId: string;
            weeklyAverageSleepSeconds: number;
            stageBreakdown: Array<{ stage: string; percentage: number }>;
          } | null;
          calendarDays: Array<{
            dateKey: string;
            sleepId: string;
            hasRawSegments: boolean;
          }>;
          sessions: Array<{
            id: string;
            localDateKey: string;
            sourceTimezone: string;
            rawSegmentCount: number;
          }>;
        };
      }
    ).sleep;
    assert.equal(sleep.sessions.length, 1);
    assert.equal(sleep.sessions[0]?.localDateKey, "2026-04-05");
    assert.equal(sleep.sessions[0]?.sourceTimezone, "Europe/Zurich");
    assert.equal(sleep.sessions[0]?.rawSegmentCount, 4);
    assert.equal(sleep.latestNight?.sleepId, sleep.sessions[0]?.id);
    assert.equal(sleep.calendarDays.length, 1);
    assert.equal(sleep.calendarDays[0]?.dateKey, "2026-04-05");
    assert.equal(sleep.calendarDays[0]?.hasRawSegments, true);
    assert.ok(
      (sleep.latestNight?.weeklyAverageSleepSeconds ?? 0) > 0
    );
    assert.ok(
      sleep.latestNight?.stageBreakdown.some(
        (stage) => stage.stage === "deep" && stage.percentage > 0
      )
    );

    const rawDetailResponse = await app.inject({
      method: "GET",
      url: `/api/v1/health/sleep/${sleep.sessions[0]?.id}/raw`
    });
    assert.equal(rawDetailResponse.statusCode, 200);
    const rawDetail = rawDetailResponse.json() as {
      sleep: { id: string };
      rawDataStatus: string;
      phaseTimeline: {
        hasSleepStageData: boolean;
        blocks: Array<{ lane: string; stage: string }>;
      };
      segments: Array<{
        stage: string;
        bucket: string;
        sourceValue: number | null;
        qualityKind: string;
      }>;
      sourceRecords: Array<{ rawStage: string; rawValue: number | null; qualityKind: string }>;
      auditLogs: Array<unknown>;
    };
    assert.equal(rawDetail.sleep.id, sleep.sessions[0]?.id);
    assert.equal(rawDetail.rawDataStatus, "provider_raw");
    assert.equal(rawDetail.phaseTimeline.hasSleepStageData, true);
    assert.deepEqual(
      rawDetail.phaseTimeline.blocks.map((block) => `${block.lane}:${block.stage}`),
      ["in_bed:in_bed", "sleep:core", "sleep:deep", "sleep:rem"]
    );
    assert.equal(rawDetail.segments.length, 4);
    assert.deepEqual(
      rawDetail.segments.map((segment) => segment.stage),
      ["in_bed", "core", "deep", "rem"]
    );
    assert.deepEqual(
      rawDetail.segments.map((segment) => segment.bucket),
      ["in_bed", "asleep", "asleep", "asleep"]
    );
    assert.equal(rawDetail.segments[1]?.sourceValue, 3);
    assert.equal(rawDetail.segments[1]?.qualityKind, "provider_native");
    assert.equal(rawDetail.sourceRecords.length, 4);
    assert.deepEqual(
      rawDetail.sourceRecords.map((record) => record.rawStage),
      ["in_bed", "core", "deep", "rem"]
    );
    assert.equal(rawDetail.sourceRecords[1]?.rawValue, 3);
    assert.equal(rawDetail.auditLogs.length, 0);

    const overviewResponse = await app.inject({
      method: "GET",
      url: "/api/v1/health/overview"
    });
    assert.equal(overviewResponse.statusCode, 200);
    const overview = (
      overviewResponse.json() as {
        overview: {
          counts: {
            sleepSessions: number;
            sleepSegments: number;
            sleepRawRecords: number;
            sleepRawLogs: number;
          };
        };
      }
    ).overview;
    assert.equal(overview.counts.sleepSessions, 1);
    assert.equal(overview.counts.sleepSegments, 4);
    assert.equal(overview.counts.sleepRawRecords, 4);
    assert.equal(overview.counts.sleepRawLogs, 0);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("sleep view collapses duplicate localDateKey nights into one calendar day and keeps the strongest representative", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-mobile-health-sleep-calendar-dedupe-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const pairingResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        userId: "user_operator"
      }
    });
    assert.equal(pairingResponse.statusCode, 201);
    const qrPayload = (
      pairingResponse.json() as {
        qrPayload: { sessionId: string; pairingToken: string };
      }
    ).qrPayload;

    const syncResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/healthkit/sync",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        device: {
          name: "Omar iPhone",
          platform: "ios",
          appVersion: "1.0",
          sourceDevice: "iPhone"
        },
        permissions: {
          healthKitAuthorized: true,
          backgroundRefreshEnabled: true,
          motionReady: false,
          locationReady: false,
          screenTimeReady: false
        },
        sleepSessions: [],
        sleepNights: [
          {
            externalUid: "night_long",
            startedAt: "2026-04-04T22:20:00.000Z",
            endedAt: "2026-04-05T06:40:00.000Z",
            sourceTimezone: "Europe/Zurich",
            localDateKey: "2026-04-05",
            timeInBedSeconds: 30_000,
            asleepSeconds: 28_200,
            awakeSeconds: 1_800,
            rawSegmentCount: 4,
            stageBreakdown: [
              { stage: "core", seconds: 15_000 },
              { stage: "deep", seconds: 5_400 },
              { stage: "rem", seconds: 7_800 }
            ],
            recoveryMetrics: {},
            sourceMetrics: {},
            links: [],
            annotations: {}
          },
          {
            externalUid: "night_short",
            startedAt: "2026-04-05T09:00:00.000Z",
            endedAt: "2026-04-05T10:15:00.000Z",
            sourceTimezone: "Europe/Zurich",
            localDateKey: "2026-04-05",
            timeInBedSeconds: 4_500,
            asleepSeconds: 4_200,
            awakeSeconds: 300,
            rawSegmentCount: 0,
            stageBreakdown: [{ stage: "core", seconds: 4_200 }],
            recoveryMetrics: {},
            sourceMetrics: {},
            links: [],
            annotations: {
              qualitySummary: "Nap-like duplicate day row"
            }
          }
        ],
        sleepSegments: [],
        workouts: []
      }
    });
    assert.equal(syncResponse.statusCode, 200);

    const sleepResponse = await app.inject({
      method: "GET",
      url: "/api/v1/health/sleep"
    });
    assert.equal(sleepResponse.statusCode, 200);
    const sleep = (
      sleepResponse.json() as {
        sleep: {
          latestNight: { sleepId: string; dateKey: string; asleepSeconds: number } | null;
          calendarDays: Array<{ sleepId: string; dateKey: string; sleepHours: number }>;
          sessions: Array<{ id: string }>;
        };
      }
    ).sleep;

    assert.equal(sleep.sessions.length, 1);
    assert.equal(sleep.calendarDays.length, 1);
    assert.equal(sleep.calendarDays[0]?.dateKey, "2026-04-05");
    assert.equal(sleep.latestNight?.dateKey, "2026-04-05");
    assert.equal(sleep.latestNight?.asleepSeconds, 28_200);
    assert.equal(sleep.sessions[0]?.id, sleep.latestNight?.sleepId);
    assert.equal(sleep.latestNight?.sleepId, sleep.calendarDays[0]?.sleepId);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("historical repaired sleep nights expose historical raw data, normalized segments, and inferred timezone", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-mobile-health-historical-sleep-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const now = new Date().toISOString();
    getDatabase()
      .prepare(
        `INSERT INTO health_sleep_sessions (
           id, external_uid, pairing_session_id, user_id, source, source_type, source_device, source_timezone, local_date_key,
           started_at, ended_at, time_in_bed_seconds, asleep_seconds, awake_seconds, raw_segment_count, sleep_score, regularity_score,
           bedtime_consistency_minutes, wake_consistency_minutes, stage_breakdown_json, recovery_metrics_json, source_metrics_json,
           links_json, annotations_json, provenance_json, derived_json, created_at, updated_at
         )
         VALUES (?, ?, NULL, 'user_operator', 'apple_health', 'healthkit', 'Omar iPhone', 'UTC', '', ?, ?, 0, ?, 0, 0, NULL, NULL, NULL, NULL, ?, '{}', '{}', '[]', '{}', '{}', '{}', ?, ?)`
      )
      .run(
        "legacy_sleep_1",
        "legacy_sleep_1",
        "2026-04-15T00:18:18.465Z",
        "2026-04-15T04:15:52.844Z",
        14_254,
        JSON.stringify([{ stage: "asleep_unspecified", seconds: 14_254 }]),
        now,
        now
      );
    getDatabase()
      .prepare(
        `INSERT INTO health_sleep_sessions (
           id, external_uid, pairing_session_id, user_id, source, source_type, source_device, source_timezone, local_date_key,
           started_at, ended_at, time_in_bed_seconds, asleep_seconds, awake_seconds, raw_segment_count, sleep_score, regularity_score,
           bedtime_consistency_minutes, wake_consistency_minutes, stage_breakdown_json, recovery_metrics_json, source_metrics_json,
           links_json, annotations_json, provenance_json, derived_json, created_at, updated_at
         )
         VALUES (?, ?, NULL, 'user_operator', 'apple_health', 'healthkit', 'Omar iPhone', 'UTC', '', ?, ?, 0, ?, 0, 0, NULL, NULL, NULL, NULL, ?, '{}', '{}', '[]', '{}', '{}', '{}', ?, ?)`
      )
      .run(
        "legacy_sleep_2",
        "legacy_sleep_2",
        "2026-04-15T04:15:52.844Z",
        "2026-04-15T07:09:48.112Z",
        10_436,
        JSON.stringify([{ stage: "asleep_unspecified", seconds: 10_436 }]),
        now,
        now
      );

    const sleepResponse = await app.inject({
      method: "GET",
      url: "/api/v1/health/sleep"
    });
    assert.equal(sleepResponse.statusCode, 200);
    const sleep = (
      sleepResponse.json() as {
        sleep: {
          sessions: Array<{
            id: string;
            sourceType: string;
            sourceTimezone: string;
            localDateKey: string;
          }>;
        };
      }
    ).sleep;
    const repairedSession = sleep.sessions.find(
      (session) =>
        session.sourceType === "healthkit_repaired" &&
        session.localDateKey === "2026-04-15"
    );
    assert.ok(repairedSession);
    const runtimeTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    if (runtimeTimeZone !== "UTC") {
      assert.equal(repairedSession.sourceTimezone, runtimeTimeZone);
    }

    const rawDetailResponse = await app.inject({
      method: "GET",
      url: `/api/v1/health/sleep/${repairedSession.id}/raw`
    });
    assert.equal(rawDetailResponse.statusCode, 200);
    const rawDetail = rawDetailResponse.json() as {
      rawDataStatus: string;
      segments: Array<{ qualityKind: string; stage: string }>;
      sourceRecords: Array<{ qualityKind: string; providerRecordType: string }>;
      auditLogs: Array<unknown>;
    };
    assert.equal(rawDetail.rawDataStatus, "historical_raw");
    assert.equal(rawDetail.segments.length, 2);
    assert.ok(
      rawDetail.segments.every((segment) => segment.qualityKind === "historical_import")
    );
    assert.equal(rawDetail.sourceRecords.length, 2);
    assert.ok(
      rawDetail.sourceRecords.every(
        (record) =>
          record.qualityKind === "historical_import" &&
          record.providerRecordType === "historical_import_interval"
      )
    );
    assert.equal(rawDetail.auditLogs.length, 2);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("provider-backed sleep import replaces reconstructed historical nights for the same wake date", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-mobile-health-replace-historical-sleep-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const now = new Date().toISOString();
    getDatabase()
      .prepare(
        `INSERT INTO health_sleep_sessions (
           id, external_uid, pairing_session_id, user_id, source, source_type, source_device, source_timezone, local_date_key,
           started_at, ended_at, time_in_bed_seconds, asleep_seconds, awake_seconds, raw_segment_count, sleep_score, regularity_score,
           bedtime_consistency_minutes, wake_consistency_minutes, stage_breakdown_json, recovery_metrics_json, source_metrics_json,
           links_json, annotations_json, provenance_json, derived_json, created_at, updated_at
         )
         VALUES (?, ?, NULL, 'user_operator', 'apple_health', 'healthkit', 'Omar iPhone', 'UTC', '', ?, ?, 0, ?, 0, 0, NULL, NULL, NULL, NULL, ?, '{}', '{}', '[]', '{}', '{}', '{}', ?, ?)`
      )
      .run(
        "legacy_sleep_replace_1",
        "legacy_sleep_replace_1",
        "2026-04-15T00:18:18.465Z",
        "2026-04-15T07:09:48.112Z",
        24_208,
        JSON.stringify([{ stage: "asleep_unspecified", seconds: 24_208 }]),
        now,
        now
      );

    const initialSleepResponse = await app.inject({
      method: "GET",
      url: "/api/v1/health/sleep"
    });
    assert.equal(initialSleepResponse.statusCode, 200);

    const operatorCookie = await issueOperatorSessionCookie(app);
    const pairingResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        userId: "user_operator"
      }
    });
    assert.equal(pairingResponse.statusCode, 201);
    const qrPayload = (
      pairingResponse.json() as {
        qrPayload: { sessionId: string; pairingToken: string };
      }
    ).qrPayload;

    const syncResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/healthkit/sync",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        device: {
          name: "Omar iPhone",
          platform: "ios",
          appVersion: "1.0",
          sourceDevice: "iPhone"
        },
        permissions: {
          healthKitAuthorized: true,
          backgroundRefreshEnabled: true,
          motionReady: false,
          locationReady: false,
          screenTimeReady: false
        },
        sleepSessions: [],
        sleepNights: [
          {
            externalUid: "night_2026_04_15_provider",
            startedAt: "2026-04-15T00:18:18.465Z",
            endedAt: "2026-04-15T07:09:48.112Z",
            sourceTimezone: "Europe/Zurich",
            localDateKey: "2026-04-15",
            timeInBedSeconds: 24_690,
            asleepSeconds: 24_208,
            awakeSeconds: 482,
            rawSegmentCount: 2,
            stageBreakdown: [
              { stage: "core", seconds: 16_000 },
              { stage: "rem", seconds: 8_208 }
            ],
            recoveryMetrics: {},
            sourceMetrics: {},
            links: [],
            annotations: {}
          }
        ],
        sleepSegments: [
          {
            externalUid: "provider_seg_1",
            startedAt: "2026-04-15T00:18:18.465Z",
            endedAt: "2026-04-15T04:15:52.844Z",
            sourceTimezone: "Europe/Zurich",
            localDateKey: "2026-04-15",
            stage: "core",
            bucket: "asleep",
            sourceValue: 3,
            metadata: {}
          },
          {
            externalUid: "provider_seg_2",
            startedAt: "2026-04-15T04:15:52.844Z",
            endedAt: "2026-04-15T07:09:48.112Z",
            sourceTimezone: "Europe/Zurich",
            localDateKey: "2026-04-15",
            stage: "rem",
            bucket: "asleep",
            sourceValue: 5,
            metadata: {}
          }
        ],
        sleepRawRecords: [
          {
            externalUid: "provider_seg_1",
            startedAt: "2026-04-15T00:18:18.465Z",
            endedAt: "2026-04-15T04:15:52.844Z",
            sourceTimezone: "Europe/Zurich",
            localDateKey: "2026-04-15",
            providerRecordType: "healthkit_sleep_sample",
            rawStage: "core",
            rawValue: 3,
            payload: {},
            metadata: {}
          },
          {
            externalUid: "provider_seg_2",
            startedAt: "2026-04-15T04:15:52.844Z",
            endedAt: "2026-04-15T07:09:48.112Z",
            sourceTimezone: "Europe/Zurich",
            localDateKey: "2026-04-15",
            providerRecordType: "healthkit_sleep_sample",
            rawStage: "rem",
            rawValue: 5,
            payload: {},
            metadata: {}
          }
        ],
        workouts: []
      }
    });
    assert.equal(syncResponse.statusCode, 200);

    const sleepResponse = await app.inject({
      method: "GET",
      url: "/api/v1/health/sleep"
    });
    assert.equal(sleepResponse.statusCode, 200);
    const sleep = (
      sleepResponse.json() as {
        sleep: {
          sessions: Array<{ id: string; sourceType: string; localDateKey: string }>;
        };
      }
    ).sleep;
    assert.equal(sleep.sessions.length, 1);
    assert.equal(sleep.sessions[0]?.sourceType, "healthkit");
    assert.equal(sleep.sessions[0]?.localDateKey, "2026-04-15");

    const rawDetailResponse = await app.inject({
      method: "GET",
      url: `/api/v1/health/sleep/${sleep.sessions[0]?.id}/raw`
    });
    assert.equal(rawDetailResponse.statusCode, 200);
    const rawDetail = rawDetailResponse.json() as {
      rawDataStatus: string;
      sourceRecords: Array<{ qualityKind: string }>;
    };
    assert.equal(rawDetail.rawDataStatus, "provider_raw");
    assert.equal(rawDetail.sourceRecords.length, 2);
    assert.ok(
      rawDetail.sourceRecords.every((record) => record.qualityKind === "provider_native")
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("mobile health sync accepts waiting_for_snapshot screen time capture state", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-screen-time-waiting-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const pairingResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        userId: "user_operator"
      }
    });
    assert.equal(pairingResponse.statusCode, 201);
    const qrPayload = (
      pairingResponse.json() as {
        qrPayload: {
          sessionId: string;
          pairingToken: string;
        };
      }
    ).qrPayload;

    const syncResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/healthkit/sync",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        device: {
          name: "Omar iPhone",
          platform: "ios",
          appVersion: "1.0",
          sourceDevice: "iPhone"
        },
        permissions: {
          healthKitAuthorized: true,
          backgroundRefreshEnabled: true,
          motionReady: false,
          locationReady: false,
          screenTimeReady: false
        },
        sleepSessions: [],
        workouts: [],
        stays: [],
        trips: [],
        screenTime: {
          settings: {
            trackingEnabled: true,
            syncEnabled: true,
            authorizationStatus: "approved",
            captureState: "waiting_for_snapshot",
            lastCapturedDayKey: null,
            lastCaptureStartedAt: null,
            lastCaptureEndedAt: null,
            metadata: {
              source: "waiting_for_snapshot_test"
            }
          },
          daySummaries: [],
          hourlySegments: []
        }
      }
    });
    assert.equal(syncResponse.statusCode, 200);

    const settingsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/screen-time/settings",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(settingsResponse.statusCode, 200);
    const settingsPayload = settingsResponse.json() as {
      settings: { captureState: string };
    };
    assert.equal(settingsPayload.settings.captureState, "waiting_for_snapshot");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("diagnostic log schema accepts warn as a warning alias", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-diagnostic-warn-alias-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/diagnostics/logs",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        level: "warn",
        scope: "diagnostic_alias_test",
        eventKey: "warn_alias",
        message: "Legacy warn payload should normalize to warning.",
        details: {}
      }
    });

    assert.equal(response.statusCode, 201);
    const body = response.json() as {
      log: {
        level: string;
      };
    };
    assert.equal(body.log.level, "warning");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("movement sync stores places, stays, trips, and serves the movement workspace routes", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-movement-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const pairingResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        userId: "user_operator"
      }
    });
    assert.equal(pairingResponse.statusCode, 201);
    const qrPayload = (
      pairingResponse.json() as {
        qrPayload: {
          sessionId: string;
          pairingToken: string;
        };
      }
    ).qrPayload;

    const syncResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/healthkit/sync",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        device: {
          name: "Omar iPhone",
          platform: "ios",
          appVersion: "1.0",
          sourceDevice: "iPhone"
        },
        permissions: {
          healthKitAuthorized: true,
          backgroundRefreshEnabled: true,
          motionReady: true,
          locationReady: true,
          screenTimeReady: true
        },
        sleepSessions: [],
        workouts: [],
        screenTime: {
          settings: {
            trackingEnabled: true,
            syncEnabled: true,
            authorizationStatus: "approved",
            captureState: "ready",
            lastCapturedDayKey: "2026-04-06",
            lastCaptureStartedAt: "2026-04-06T08:00:00.000Z",
            lastCaptureEndedAt: "2026-04-06T09:00:00.000Z",
            metadata: {
              source: "movement_test_fixture"
            }
          },
          daySummaries: [
            {
              dateKey: "2026-04-06",
              totalActivitySeconds: 2400,
              pickupCount: 6,
              notificationCount: 2,
              firstPickupAt: "2026-04-06T08:04:00.000Z",
              longestActivitySeconds: 1200,
              topAppBundleIdentifiers: ["com.apple.mobilesafari"],
              topCategoryLabels: ["Navigation"],
              metadata: {}
            }
          ],
          hourlySegments: [
            {
              dateKey: "2026-04-06",
              hourIndex: 8,
              startedAt: "2026-04-06T08:00:00.000Z",
              endedAt: "2026-04-06T09:00:00.000Z",
              totalActivitySeconds: 2400,
              pickupCount: 6,
              notificationCount: 2,
              firstPickupAt: "2026-04-06T08:04:00.000Z",
              longestActivityStartedAt: "2026-04-06T08:08:00.000Z",
              longestActivityEndedAt: "2026-04-06T08:28:00.000Z",
              metadata: {},
              apps: [
                {
                  bundleIdentifier: "com.apple.mobilesafari",
                  displayName: "Safari",
                  categoryLabel: "Navigation",
                  totalActivitySeconds: 1800,
                  pickupCount: 5,
                  notificationCount: 0
                },
                {
                  bundleIdentifier: "com.apple.MobileSMS",
                  displayName: "Messages",
                  categoryLabel: "Social",
                  totalActivitySeconds: 600,
                  pickupCount: 1,
                  notificationCount: 2
                }
              ],
              categories: [
                {
                  categoryLabel: "Navigation",
                  totalActivitySeconds: 1800
                },
                {
                  categoryLabel: "Social",
                  totalActivitySeconds: 600
                }
              ]
            }
          ]
        },
        movement: {
          settings: {
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            locationPermissionStatus: "always",
            motionPermissionStatus: "ready",
            backgroundTrackingReady: true,
            metadata: {}
          },
          knownPlaces: [
            {
              externalUid: "place_home",
              label: "Home",
              aliases: ["Flat"],
              latitude: 46.5191,
              longitude: 6.6323,
              radiusMeters: 120,
              categoryTags: ["Home", "Gym", "Parents house"],
              visibility: "shared",
              wikiNoteId: null,
              linkedEntities: [],
              linkedPeople: [],
              metadata: {}
            },
            {
              externalUid: "place_grocery",
              label: "Corner Grocery",
              aliases: [],
              latitude: 46.5214,
              longitude: 6.6407,
              radiusMeters: 90,
              categoryTags: ["grocery"],
              visibility: "shared",
              wikiNoteId: null,
              linkedEntities: [],
              linkedPeople: [],
              metadata: {}
            }
          ],
          stays: [
            {
              externalUid: "stay_home_morning",
              label: "Home",
              status: "completed",
              classification: "stationary",
              startedAt: "2026-04-06T07:00:00.000Z",
              endedAt: "2026-04-06T08:00:00.000Z",
              centerLatitude: 46.5191,
              centerLongitude: 6.6323,
              radiusMeters: 100,
              sampleCount: 10,
              placeExternalUid: "place_home",
              placeLabel: "Home",
              tags: ["home"],
              metadata: {}
            },
            {
              externalUid: "stay_grocery_after",
              label: "Corner Grocery",
              status: "active",
              classification: "stationary",
              startedAt: "2026-04-06T08:20:00.000Z",
              endedAt: "2026-04-06T09:00:00.000Z",
              centerLatitude: 46.5214,
              centerLongitude: 6.6407,
              radiusMeters: 85,
              sampleCount: 6,
              placeExternalUid: "place_grocery",
              placeLabel: "Corner Grocery",
              tags: ["grocery", "errand"],
              metadata: {}
            }
          ],
          trips: [
            {
              externalUid: "trip_home_grocery",
              label: "Home to grocery",
              status: "completed",
              travelMode: "travel",
              activityType: "walking",
              startedAt: "2026-04-06T08:00:00.000Z",
              endedAt: "2026-04-06T08:20:00.000Z",
              startPlaceExternalUid: "place_home",
              endPlaceExternalUid: "place_grocery",
              distanceMeters: 2100,
              movingSeconds: 900,
              idleSeconds: 120,
              averageSpeedMps: 1.9,
              maxSpeedMps: 2.5,
              caloriesKcal: 120,
              expectedMet: 3.2,
              tags: ["grocery"],
              linkedEntities: [],
              linkedPeople: [],
              metadata: {},
              points: [
                {
                  externalUid: "trip_home_grocery_p0",
                  recordedAt: "2026-04-06T08:00:00.000Z",
                  latitude: 46.5191,
                  longitude: 6.6323,
                  accuracyMeters: 8,
                  altitudeMeters: null,
                  speedMps: 1.2,
                  isStopAnchor: false
                },
                {
                  externalUid: "trip_home_grocery_p1",
                  recordedAt: "2026-04-06T08:10:00.000Z",
                  latitude: 46.5201,
                  longitude: 6.6361,
                  accuracyMeters: 8,
                  altitudeMeters: null,
                  speedMps: 1.8,
                  isStopAnchor: false
                },
                {
                  externalUid: "trip_home_grocery_p2",
                  recordedAt: "2026-04-06T08:20:00.000Z",
                  latitude: 46.5214,
                  longitude: 6.6407,
                  accuracyMeters: 8,
                  altitudeMeters: null,
                  speedMps: 1.4,
                  isStopAnchor: true
                }
              ],
              stops: [
                {
                  externalUid: "stop_wait_crossing",
                  label: "Crossing",
                  startedAt: "2026-04-06T08:08:00.000Z",
                  endedAt: "2026-04-06T08:12:00.000Z",
                  latitude: 46.5201,
                  longitude: 6.6361,
                  radiusMeters: 40,
                  placeExternalUid: "",
                  metadata: {}
                }
              ]
            }
          ]
        }
      }
    });
    assert.equal(syncResponse.statusCode, 200);

    const firstObservationCalendarResponse = await app.inject({
      method: "GET",
      url:
        "/api/v1/psyche/self-observation/calendar" +
        "?from=2026-04-06T00:00:00.000Z&to=2026-04-07T00:00:00.000Z"
    });
    assert.equal(firstObservationCalendarResponse.statusCode, 200);
    const firstObservationCalendar =
      firstObservationCalendarResponse.json() as {
        calendar: {
          observations: Array<{
            note: {
              id: string;
              tags: string[];
              contentMarkdown: string;
              frontmatter: Record<string, unknown>;
            };
          }>;
        };
      };
    assert.equal(firstObservationCalendar.calendar.observations.length, 3);
    const firstGroceryStayObservation =
      firstObservationCalendar.calendar.observations.find((entry) =>
        entry.note.contentMarkdown.includes(
          "Currently staying at **Corner Grocery**."
        )
      );
    assert.ok(firstGroceryStayObservation);
    assert.ok(firstGroceryStayObservation?.note.tags.includes("movement"));
    const rollingStayNoteId = firstGroceryStayObservation?.note.id ?? "";
    assert.ok(rollingStayNoteId);

    const secondSyncResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/healthkit/sync",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        device: {
          name: "Omar iPhone",
          platform: "ios",
          appVersion: "1.0",
          sourceDevice: "iPhone"
        },
        permissions: {
          healthKitAuthorized: true,
          backgroundRefreshEnabled: true,
          motionReady: true,
          locationReady: true,
          screenTimeReady: true
        },
        sleepSessions: [],
        workouts: [],
        movement: {
          settings: {
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            locationPermissionStatus: "always",
            motionPermissionStatus: "ready",
            backgroundTrackingReady: true,
            metadata: {}
          },
          knownPlaces: [],
          stays: [
            {
              externalUid: "stay_grocery_after",
              label: "Corner Grocery",
              status: "completed",
              classification: "stationary",
              startedAt: "2026-04-06T08:20:00.000Z",
              endedAt: "2026-04-06T09:15:00.000Z",
              centerLatitude: 46.5214,
              centerLongitude: 6.6407,
              radiusMeters: 85,
              sampleCount: 8,
              placeExternalUid: "place_grocery",
              placeLabel: "Corner Grocery",
              tags: ["grocery", "errand"],
              metadata: {}
            }
          ],
          trips: [
            {
              externalUid: "trip_grocery_home",
              label: "Grocery to home",
              status: "active",
              travelMode: "travel",
              activityType: "walking",
              startedAt: "2026-04-06T09:15:00.000Z",
              endedAt: "2026-04-06T09:35:00.000Z",
              startPlaceExternalUid: "place_grocery",
              endPlaceExternalUid: "place_home",
              distanceMeters: 2050,
              movingSeconds: 860,
              idleSeconds: 90,
              averageSpeedMps: 1.8,
              maxSpeedMps: 2.3,
              caloriesKcal: 110,
              expectedMet: 3.1,
              tags: ["grocery", "return"],
              linkedEntities: [],
              linkedPeople: [],
              metadata: {},
              points: [
                {
                  externalUid: "trip_grocery_home_p0",
                  recordedAt: "2026-04-06T09:15:00.000Z",
                  latitude: 46.5214,
                  longitude: 6.6407,
                  accuracyMeters: 8,
                  altitudeMeters: null,
                  speedMps: 1.3,
                  isStopAnchor: false
                },
                {
                  externalUid: "trip_grocery_home_p1",
                  recordedAt: "2026-04-06T09:35:00.000Z",
                  latitude: 46.5191,
                  longitude: 6.6323,
                  accuracyMeters: 8,
                  altitudeMeters: null,
                  speedMps: 1.6,
                  isStopAnchor: true
                }
              ],
              stops: []
            }
          ]
        }
      }
    });
    assert.equal(secondSyncResponse.statusCode, 200);

    const dayResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/day?date=2026-04-06"
    });
    assert.equal(dayResponse.statusCode, 200);
    const day = (
      dayResponse.json() as {
        movement: {
          summary: {
            tripCount: number;
            stayCount: number;
            estimatedScreenTimeSeconds: number;
          };
          places: Array<{ label: string }>;
          trips: Array<{
            id: string;
            externalUid: string;
            label: string;
            distanceMeters: number;
            estimatedScreenTimeSeconds: number;
            topApps: Array<{ displayName: string }>;
          }>;
          stays: Array<{
            id: string;
            label: string;
            estimatedScreenTimeSeconds: number;
          }>;
        };
      }
    ).movement;
    assert.equal(day.summary.tripCount, 2);
    assert.equal(day.summary.stayCount, 2);
    assert.ok(day.summary.estimatedScreenTimeSeconds > 0);
    assert.ok(day.places.some((place) => place.label === "Home"));
    const homePlace = day.places.find((place) => place.label === "Home") as
      | { label: string; categoryTags?: string[] }
      | undefined;
    assert.ok(homePlace);
    const outboundTripId = day.trips.find(
      (trip) => trip.externalUid === "trip_home_grocery"
    )?.id;
    assert.ok(outboundTripId);

    const tripResponse = await app.inject({
      method: "GET",
      url: `/api/v1/movement/trips/${outboundTripId}`
    });
    assert.equal(tripResponse.statusCode, 200);
    const tripDetail = (
      tripResponse.json() as {
        movement: {
          trip: {
            id: string;
            externalUid: string;
            estimatedScreenTimeSeconds: number;
            topApps: Array<{
              displayName: string;
            }>;
            points: Array<{
              id: string;
              externalUid: string;
              latitude: number;
            }>;
          };
        };
      }
    ).movement;

    const placesResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/places"
    });
    assert.equal(placesResponse.statusCode, 200);
    const places = (
      placesResponse.json() as {
        places: Array<{ label: string; categoryTags: string[] }>;
      }
    ).places;
    const syncedHomePlace = places.find((place) => place.label === "Home");
    assert.ok(syncedHomePlace?.categoryTags.includes("home"));
    assert.ok(syncedHomePlace?.categoryTags.includes("gym"));
    assert.ok(syncedHomePlace?.categoryTags.includes("parents-house"));
    assert.ok(day.trips.some((trip) => trip.estimatedScreenTimeSeconds > 0));
    assert.ok(
      day.trips.some((trip) =>
        trip.topApps.some((app) => app.displayName === "Safari")
      )
    );
    assert.ok(day.stays.some((stay) => stay.estimatedScreenTimeSeconds > 0));
    assert.ok(tripDetail.trip.estimatedScreenTimeSeconds > 0);
    assert.ok(
      tripDetail.trip.topApps.some((app) => app.displayName === "Safari")
    );

    const timelineResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/timeline?limit=2"
    });
    assert.equal(timelineResponse.statusCode, 200);
    const timeline = timelineResponse.json() as {
      movement: {
        segments: Array<{
          id: string;
          boxId?: string | null;
          kind: "stay" | "trip" | "missing";
          laneSide: "left" | "right";
          connectorFromLane: "left" | "right";
          connectorToLane: "left" | "right";
          cursor: string;
          stay: { label: string } | null;
          trip: { label: string } | null;
        }>;
        nextCursor: string | null;
        hasMore: boolean;
      };
    };
    assert.equal(timeline.movement.segments.length, 2);
    assert.ok(
      timeline.movement.segments.some((segment) => segment.kind === "trip")
    );
    assert.equal(timeline.movement.hasMore, true);
    assert.ok(timeline.movement.nextCursor);

    const olderTimelineResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/movement/timeline",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        before: timeline.movement.nextCursor,
        limit: 2
      }
    });
    assert.equal(olderTimelineResponse.statusCode, 200);
    const olderTimeline = olderTimelineResponse.json() as {
      movement: {
        segments: Array<{
          kind: "stay" | "trip" | "missing";
          stay: { label: string } | null;
        }>;
      };
    };
    assert.equal(olderTimeline.movement.segments.length, 2);
    assert.ok(
      olderTimeline.movement.segments.some((segment) => segment.kind === "trip")
    );

    const canonicalTimelineResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/timeline?limit=20"
    });
    assert.equal(canonicalTimelineResponse.statusCode, 200);
    const canonicalTimeline = canonicalTimelineResponse.json() as {
      movement: {
        segments: Array<{
          boxId?: string | null;
          kind: "stay" | "trip" | "missing";
        }>;
      };
    };
    const stayBoxId = canonicalTimeline.movement.segments.find(
      (segment) => segment.kind === "stay"
    )?.boxId;
    assert.ok(stayBoxId);

    const boxDetailResponse = await app.inject({
      method: "GET",
      url: `/api/v1/movement/boxes/${stayBoxId}`
    });
    assert.equal(boxDetailResponse.statusCode, 200);
    const boxDetail = (
      boxDetailResponse.json() as {
        movement: {
          segment: { kind: "stay" | "trip" | "missing" };
          stayDetail: {
            positions: Array<{ latitude: number; longitude: number }>;
            averagePosition: { latitude: number; longitude: number } | null;
          } | null;
        };
      }
    ).movement;
    assert.equal(boxDetail.segment.kind, "stay");
    assert.ok(boxDetail.stayDetail);
    assert.ok((boxDetail.stayDetail?.positions.length ?? 0) > 0);
    assert.ok(boxDetail.stayDetail?.averagePosition);

    const mobileBoxDetailResponse = await app.inject({
      method: "POST",
      url: `/api/v1/mobile/movement/boxes/${stayBoxId}/detail`,
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken
      }
    });
    assert.equal(mobileBoxDetailResponse.statusCode, 200);
    const mobileBoxDetail = (
      mobileBoxDetailResponse.json() as {
        movement: {
          segment: { kind: "stay" | "trip" | "missing" };
        };
      }
    ).movement;
    assert.equal(mobileBoxDetail.segment.kind, "stay");

    const createUserBoxResponse = await app.inject({
      method: "POST",
      url: "/api/v1/movement/user-boxes",
      headers: { cookie: operatorCookie },
      payload: {
        kind: "missing",
        startedAt: "2026-04-06T08:08:00.000Z",
        endedAt: "2026-04-06T08:12:00.000Z",
        title: "User invalidated crossing gap",
        subtitle: "Manual override from the canonical box layer.",
        placeLabel: "Crossing",
        tags: ["user-defined", "missing-data"]
      }
    });
    assert.equal(createUserBoxResponse.statusCode, 201);
    const createdUserBox = (
      createUserBoxResponse.json() as {
        box: { id: string; kind: string; sourceKind: string; origin: string };
      }
    ).box;
    assert.equal(createdUserBox.kind, "missing");
    assert.equal(createdUserBox.sourceKind, "user_defined");
    assert.equal(createdUserBox.origin, "user_invalidated");

    const bootstrapAfterUserBoxMutation = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/movement/bootstrap",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken
      }
    });
    assert.equal(bootstrapAfterUserBoxMutation.statusCode, 200);
    const bootstrapProjectedBoxes = (
      bootstrapAfterUserBoxMutation.json() as {
        movement: {
          projectedBoxes: Array<{
            id: string;
            kind: "stay" | "trip" | "missing";
            sourceKind: "automatic" | "user_defined";
            origin:
              | "recorded"
              | "continued_stay"
              | "repaired_gap"
              | "missing"
              | "user_defined"
              | "user_invalidated";
          }>;
        };
      }
    ).movement.projectedBoxes;
    assert.ok(
      bootstrapProjectedBoxes.some(
        (segment) =>
          segment.id === createdUserBox.id &&
          segment.kind === "missing" &&
          segment.sourceKind === "user_defined" &&
          segment.origin === "user_invalidated"
      )
    );

    const allTimeResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/all-time"
    });
    assert.equal(allTimeResponse.statusCode, 200);
    const allTime = (
      allTimeResponse.json() as {
        movement: { summary: { tripCount: number; knownPlaceCount: number } };
      }
    ).movement;
    assert.equal(allTime.summary.tripCount, 2);
    assert.equal(allTime.summary.knownPlaceCount, 2);

    const createMobilePlaceResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/movement/places",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        place: {
          externalUid: "",
          label: "Champel Station",
          aliases: [],
          latitude: 46.19279962751144,
          longitude: 6.153637079935969,
          radiusMeters: 100,
          categoryTags: [],
          visibility: "shared",
          wikiNoteId: null,
          linkedEntities: [],
          linkedPeople: [],
          metadata: {}
        }
      }
    });
    assert.equal(createMobilePlaceResponse.statusCode, 201);
    const createdMobilePlace = (
      createMobilePlaceResponse.json() as {
        place: { label: string; externalUid: string };
      }
    ).place;
    assert.equal(createdMobilePlace.label, "Champel Station");
    assert.ok(createdMobilePlace.externalUid.length > 0);

    const homeStay = getDatabase()
      .prepare(
        `SELECT id
         FROM movement_stays
         WHERE external_uid = 'stay_home_morning'`
      )
      .get() as { id: string };
    const mobileStayPatchResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/mobile/movement/stays/${homeStay.id}`,
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        patch: {
          placeExternalUid: createdMobilePlace.externalUid,
          placeLabel: createdMobilePlace.label
        }
      }
    });
    assert.equal(mobileStayPatchResponse.statusCode, 200);
    const patchedMobileStay = mobileStayPatchResponse.json() as {
      place: {
        externalUid: string;
        label: string;
        metadata: Record<string, string>;
        latitude: number;
        longitude: number;
      } | null;
    };
    assert.equal(patchedMobileStay.place?.externalUid, createdMobilePlace.externalUid);
    assert.equal(patchedMobileStay.place?.label, "Champel Station");
    assert.equal(patchedMobileStay.place?.metadata.distributionSampleCount, "2");
    assert.ok((patchedMobileStay.place?.latitude ?? 0) > 46.19);
    assert.ok((patchedMobileStay.place?.longitude ?? 0) > 6.15);

    const secondObservationCalendarResponse = await app.inject({
      method: "GET",
      url:
        "/api/v1/psyche/self-observation/calendar" +
        "?from=2026-04-06T00:00:00.000Z&to=2026-04-07T00:00:00.000Z"
    });
    assert.equal(secondObservationCalendarResponse.statusCode, 200);
    const secondObservationCalendar =
      secondObservationCalendarResponse.json() as {
        calendar: {
          observations: Array<{
            note: {
              id: string;
              tags: string[];
              contentMarkdown: string;
              frontmatter: Record<string, unknown>;
            };
          }>;
        };
      };
    assert.equal(secondObservationCalendar.calendar.observations.length, 4);
    const updatedStayObservation =
      secondObservationCalendar.calendar.observations.find(
        (entry) => entry.note.id === rollingStayNoteId
      );
    assert.ok(updatedStayObservation);
    assert.match(
      updatedStayObservation?.note.contentMarkdown ?? "",
      /Stayed at \*\*Corner Grocery\*\*\./
    );
    const updatedMovementFrontmatter = updatedStayObservation?.note.frontmatter
      .movement as
      | {
          state?: string;
          endedAt?: string;
          durationSeconds?: number;
        }
      | undefined;
    assert.equal(updatedMovementFrontmatter?.state, "closed");
    assert.equal(
      updatedMovementFrontmatter?.endedAt,
      "2026-04-06T09:15:00.000Z"
    );
    assert.equal(updatedMovementFrontmatter?.durationSeconds, 3300);

    const deleteUserBoxResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/movement/user-boxes/${createdUserBox.id}`,
      headers: { cookie: operatorCookie }
    });
    assert.equal(deleteUserBoxResponse.statusCode, 200);

    const bootstrapAfterUserBoxDelete = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/movement/bootstrap",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken
      }
    });
    assert.equal(bootstrapAfterUserBoxDelete.statusCode, 200);
    const projectedBoxesAfterDelete = (
      bootstrapAfterUserBoxDelete.json() as {
        movement: {
          projectedBoxes: Array<{ id: string }>;
        };
      }
    ).movement.projectedBoxes;
    assert.equal(
      projectedBoxesAfterDelete.some((segment) => segment.id === createdUserBox.id),
      false
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("movement timeline hides overlapping stays and trips and flags them invalid", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-movement-overlap-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const pairingResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        userId: "user_operator"
      }
    });
    assert.equal(pairingResponse.statusCode, 201);
    const qrPayload = (
      pairingResponse.json() as {
        qrPayload: {
          sessionId: string;
          pairingToken: string;
        };
      }
    ).qrPayload;

    const syncResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/healthkit/sync",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        device: {
          name: "Omar iPhone",
          platform: "ios",
          appVersion: "1.0",
          sourceDevice: "iPhone"
        },
        permissions: {
          healthKitAuthorized: true,
          backgroundRefreshEnabled: true,
          motionReady: true,
          locationReady: true
        },
        sleepSessions: [],
        workouts: [],
        movement: {
          settings: {
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            locationPermissionStatus: "always",
            motionPermissionStatus: "ready",
            backgroundTrackingReady: true,
            metadata: {}
          },
          knownPlaces: [
            {
              externalUid: "place_home_overlap",
              label: "Home",
              aliases: [],
              latitude: 46.5191,
              longitude: 6.6323,
              radiusMeters: 120,
              categoryTags: ["home"],
              visibility: "shared",
              wikiNoteId: null,
              linkedEntities: [],
              linkedPeople: [],
              metadata: {}
            },
            {
              externalUid: "place_shop_overlap",
              label: "Shop",
              aliases: [],
              latitude: 46.5214,
              longitude: 6.6407,
              radiusMeters: 90,
              categoryTags: ["grocery"],
              visibility: "shared",
              wikiNoteId: null,
              linkedEntities: [],
              linkedPeople: [],
              metadata: {}
            }
          ],
          stays: [
            {
              externalUid: "stay_valid_before_overlap",
              label: "Home",
              status: "completed",
              classification: "stationary",
              startedAt: "2026-04-05T07:00:00.000Z",
              endedAt: "2026-04-05T08:00:00.000Z",
              centerLatitude: 46.5191,
              centerLongitude: 6.6323,
              radiusMeters: 100,
              sampleCount: 10,
              placeExternalUid: "place_home_overlap",
              placeLabel: "Home",
              tags: ["home"],
              metadata: {}
            },
            {
              externalUid: "stay_invalid_overlap",
              label: "Home",
              status: "completed",
              classification: "stationary",
              startedAt: "2026-04-05T08:30:00.000Z",
              endedAt: "2026-04-05T09:30:00.000Z",
              centerLatitude: 46.5191,
              centerLongitude: 6.6323,
              radiusMeters: 100,
              sampleCount: 10,
              placeExternalUid: "place_home_overlap",
              placeLabel: "Home",
              tags: ["home"],
              metadata: {}
            }
          ],
          trips: [
            {
              externalUid: "trip_invalid_overlap",
              label: "trip",
              status: "completed",
              travelMode: "travel",
              activityType: "walking",
              startedAt: "2026-04-05T09:00:00.000Z",
              endedAt: "2026-04-05T10:00:00.000Z",
              startPlaceExternalUid: "place_home_overlap",
              endPlaceExternalUid: "place_shop_overlap",
              distanceMeters: 1500,
              movingSeconds: 1800,
              idleSeconds: 120,
              averageSpeedMps: 1.5,
              maxSpeedMps: 2.2,
              caloriesKcal: 80,
              expectedMet: 2.8,
              tags: ["movement"],
              linkedEntities: [],
              linkedPeople: [],
              metadata: {},
              points: [
                {
                  recordedAt: "2026-04-05T09:00:00.000Z",
                  latitude: 46.5191,
                  longitude: 6.6323,
                  accuracyMeters: 8,
                  altitudeMeters: null,
                  speedMps: 1.2,
                  isStopAnchor: false
                },
                {
                  recordedAt: "2026-04-05T10:00:00.000Z",
                  latitude: 46.5214,
                  longitude: 6.6407,
                  accuracyMeters: 8,
                  altitudeMeters: null,
                  speedMps: 1.4,
                  isStopAnchor: true
                }
              ],
              stops: []
            }
          ]
        }
      }
    });
    assert.equal(syncResponse.statusCode, 200);

    const timelineResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/timeline"
    });
    assert.equal(timelineResponse.statusCode, 200);
    const timeline = timelineResponse.json() as {
      movement: {
        invalidSegmentCount: number;
        segments: Array<{ id: string; kind: string }>;
      };
    };
    assert.equal(timeline.movement.invalidSegmentCount, 0);
    assert.ok(timeline.movement.segments.length >= 1);
    assert.ok(
      timeline.movement.segments.every((segment) => segment.kind !== "trip")
    );

    const timelineWithInvalidResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/timeline?includeInvalid=true"
    });
    assert.equal(timelineWithInvalidResponse.statusCode, 200);
    const timelineWithInvalid = timelineWithInvalidResponse.json() as {
      movement: {
        invalidSegmentCount: number;
        segments: Array<{
          kind: "stay" | "trip" | "missing";
          origin?: "recorded" | "continued_stay" | "repaired_gap" | "missing";
          isInvalid: boolean;
          stay: { label: string } | null;
          trip: { label: string } | null;
        }>;
      };
    };
    assert.equal(timelineWithInvalid.movement.invalidSegmentCount, 0);
    assert.ok(timelineWithInvalid.movement.segments.length >= 1);
    assert.ok(
      timelineWithInvalid.movement.segments.every(
        (segment) => segment.kind !== "trip"
      )
    );

    const invalidStay = getDatabase()
      .prepare(
        `SELECT id, metadata_json
         FROM movement_stays
         WHERE external_uid = 'stay_invalid_overlap'`
      )
      .get() as { id: string; metadata_json: string };
    const invalidTrip = getDatabase()
      .prepare(
        `SELECT id, metadata_json
         FROM movement_trips
         WHERE external_uid = 'trip_invalid_overlap'`
      )
      .get() as { id: string; metadata_json: string };
    const stayMetadata = JSON.parse(invalidStay.metadata_json) as {
      validation?: { invalidOverlap?: boolean; overlapIssues?: string[] };
    };
    const tripMetadata = JSON.parse(invalidTrip.metadata_json) as {
      validation?: { invalidOverlap?: boolean; overlapIssues?: string[] };
    };
    assert.equal(stayMetadata.validation?.invalidOverlap, true);
    assert.equal(tripMetadata.validation?.invalidOverlap, true);
    assert.ok((stayMetadata.validation?.overlapIssues?.length ?? 0) > 0);
    assert.ok((tripMetadata.validation?.overlapIssues?.length ?? 0) > 0);

    const resolveOverlapResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/movement/stays/${invalidStay.id}`,
      headers: { cookie: operatorCookie },
      payload: {
        endedAt: "2026-04-05T08:55:00.000Z"
      }
    });
    assert.equal(resolveOverlapResponse.statusCode, 200);

    const healedTimelineResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/timeline"
    });
    assert.equal(healedTimelineResponse.statusCode, 200);
    const healedTimeline = healedTimelineResponse.json() as {
      movement: {
        invalidSegmentCount: number;
        segments: Array<{
          id: string;
          kind: "stay" | "trip" | "missing";
          sourceKind: "automatic" | "user_defined";
          origin?:
            | "recorded"
            | "repaired_gap"
            | "missing"
            | "user_defined"
            | "user_invalidated";
        }>;
      };
    };
    assert.equal(healedTimeline.movement.invalidSegmentCount, 0);
    assert.ok(healedTimeline.movement.segments.length >= 2);
    assert.ok(
      healedTimeline.movement.segments.some(
        (segment) =>
          segment.kind === "stay" &&
          (segment.origin === "repaired_gap" || segment.sourceKind === "user_defined")
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("movement timeline returns sleep overlays for overlapping sessions on web and mobile routes", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-movement-sleep-overlay-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const pairingResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        userId: "user_operator"
      }
    });
    assert.equal(pairingResponse.statusCode, 201);
    const qrPayload = (
      pairingResponse.json() as {
        qrPayload: {
          sessionId: string;
          pairingToken: string;
        };
      }
    ).qrPayload;
    const syncResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/healthkit/sync",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        device: {
          name: "Omar iPhone",
          platform: "ios",
          appVersion: "1.0",
          sourceDevice: "iPhone"
        },
        permissions: {
          healthKitAuthorized: true,
          backgroundRefreshEnabled: true,
          motionReady: true,
          locationReady: true
        },
        sleepSessions: [],
        workouts: [],
        movement: {
          settings: {
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            locationPermissionStatus: "always",
            motionPermissionStatus: "ready",
            backgroundTrackingReady: true,
            metadata: {}
          },
          knownPlaces: [
            {
              externalUid: "place_home_overlay",
              label: "Home",
              aliases: [],
              latitude: 46.5191,
              longitude: 6.6323,
              radiusMeters: 120,
              categoryTags: ["home"],
              visibility: "shared",
              wikiNoteId: null,
              linkedEntities: [],
              linkedPeople: [],
              metadata: {}
            },
            {
              externalUid: "place_shop_overlay",
              label: "Shop",
              aliases: [],
              latitude: 46.5214,
              longitude: 6.6407,
              radiusMeters: 90,
              categoryTags: ["grocery"],
              visibility: "shared",
              wikiNoteId: null,
              linkedEntities: [],
              linkedPeople: [],
              metadata: {}
            }
          ],
          stays: [
            {
              externalUid: "stay_home_overlay",
              label: "Home",
              status: "completed",
              classification: "stationary",
              startedAt: "2026-04-06T07:00:00.000Z",
              endedAt: "2026-04-06T08:00:00.000Z",
              centerLatitude: 46.5191,
              centerLongitude: 6.6323,
              radiusMeters: 100,
              sampleCount: 10,
              placeExternalUid: "place_home_overlay",
              placeLabel: "Home",
              tags: ["home"],
              metadata: {}
            },
            {
              externalUid: "stay_shop_overlay",
              label: "Shop",
              status: "completed",
              classification: "stationary",
              startedAt: "2026-04-06T08:20:00.000Z",
              endedAt: "2026-04-06T09:10:00.000Z",
              centerLatitude: 46.5214,
              centerLongitude: 6.6407,
              radiusMeters: 85,
              sampleCount: 6,
              placeExternalUid: "place_shop_overlay",
              placeLabel: "Shop",
              tags: ["grocery"],
              metadata: {}
            }
          ],
          trips: [
            {
              externalUid: "trip_home_shop_overlay",
              label: "Home to shop",
              status: "completed",
              travelMode: "travel",
              activityType: "walking",
              startedAt: "2026-04-06T08:00:00.000Z",
              endedAt: "2026-04-06T08:20:00.000Z",
              startPlaceExternalUid: "place_home_overlay",
              endPlaceExternalUid: "place_shop_overlay",
              distanceMeters: 2100,
              movingSeconds: 900,
              idleSeconds: 120,
              averageSpeedMps: 1.9,
              maxSpeedMps: 2.5,
              caloriesKcal: 120,
              expectedMet: 3.2,
              tags: ["grocery"],
              linkedEntities: [],
              linkedPeople: [],
              metadata: {},
              points: [
                {
                  externalUid: "trip_home_shop_overlay_p0",
                  recordedAt: "2026-04-06T08:00:00.000Z",
                  latitude: 46.5191,
                  longitude: 6.6323,
                  accuracyMeters: 9,
                  altitudeMeters: 410,
                  speedMps: 0,
                  isStopAnchor: true
                },
                {
                  externalUid: "trip_home_shop_overlay_p1",
                  recordedAt: "2026-04-06T08:20:00.000Z",
                  latitude: 46.5214,
                  longitude: 6.6407,
                  accuracyMeters: 8,
                  altitudeMeters: 415,
                  speedMps: 2.1,
                  isStopAnchor: true
                }
              ]
            }
          ]
        }
      }
    });
    assert.equal(syncResponse.statusCode, 200);

    const baselineTimelineResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/timeline?limit=20"
    });
    assert.equal(baselineTimelineResponse.statusCode, 200);
    const baselineTimeline = baselineTimelineResponse.json() as {
      movement: {
        segments: Array<{
          startedAt: string;
          endedAt: string;
        }>;
      };
    };
    const anchorSegment = baselineTimeline.movement.segments
      .map((segment) => ({
        ...segment,
        durationMs: Date.parse(segment.endedAt) - Date.parse(segment.startedAt)
      }))
      .sort((left, right) => right.durationMs - left.durationMs)[0];
    assert.ok(anchorSegment);
    const overlayStartMs = Date.parse(anchorSegment.startedAt) + 60 * 1_000;
    const overlayEndMs = Math.min(
      Date.parse(anchorSegment.endedAt) - 60 * 1_000,
      overlayStartMs + 30 * 60 * 1_000
    );
    assert.ok(overlayEndMs > overlayStartMs);

    const createSleep = await app.inject({
      method: "POST",
      url: "/api/v1/health/sleep",
      headers: { cookie: operatorCookie },
      payload: {
        startedAt: new Date(overlayStartMs).toISOString(),
        endedAt: new Date(overlayEndMs).toISOString(),
        qualitySummary: "Sleep overlay regression",
        tags: ["overlay"]
      }
    });
    assert.equal(createSleep.statusCode, 201);

    const webTimelineResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/timeline?limit=20"
    });
    assert.equal(webTimelineResponse.statusCode, 200);
    const webTimeline = webTimelineResponse.json() as {
      movement: {
        sleepOverlays: Array<{
          id: string;
          startedAt: string;
          endedAt: string;
          asleepSeconds: number | null;
        }>;
      };
    };
    assert.equal(webTimeline.movement.sleepOverlays.length, 1);
    assert.equal(
      webTimeline.movement.sleepOverlays[0]?.startedAt,
      new Date(overlayStartMs).toISOString()
    );
    assert.equal(
      webTimeline.movement.sleepOverlays[0]?.endedAt,
      new Date(overlayEndMs).toISOString()
    );
    assert.equal(
      webTimeline.movement.sleepOverlays[0]?.asleepSeconds,
      Math.round((overlayEndMs - overlayStartMs) / 1_000)
    );

    const mobileTimelineResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/movement/timeline",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        limit: 20
      }
    });
    assert.equal(mobileTimelineResponse.statusCode, 200);
    const mobileTimeline = mobileTimelineResponse.json() as {
      movement: {
        sleepOverlays: Array<{
          id: string;
          startedAt: string;
          endedAt: string;
        }>;
      };
    };
    assert.equal(mobileTimeline.movement.sleepOverlays.length, 1);
    assert.equal(
      mobileTimeline.movement.sleepOverlays[0]?.startedAt,
      new Date(overlayStartMs).toISOString()
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("movement timeline hides tiny trips under the minimum distance or duration", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-movement-tiny-trip-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const pairingResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        userId: "user_operator"
      }
    });
    assert.equal(pairingResponse.statusCode, 201);
    const qrPayload = (
      pairingResponse.json() as {
        qrPayload: {
          sessionId: string;
          pairingToken: string;
        };
      }
    ).qrPayload;

    const syncResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/healthkit/sync",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        device: {
          name: "Omar iPhone",
          platform: "ios",
          appVersion: "1.0",
          sourceDevice: "iPhone"
        },
        permissions: {
          healthKitAuthorized: true,
          backgroundRefreshEnabled: true,
          motionReady: true,
          locationReady: true
        },
        sleepSessions: [],
        workouts: [],
        movement: {
          settings: {
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            locationPermissionStatus: "always",
            motionPermissionStatus: "ready",
            backgroundTrackingReady: true,
            metadata: {}
          },
          knownPlaces: [],
          stays: [],
          trips: [
            {
              externalUid: "trip_tiny_invalid",
              label: "trip",
              status: "completed",
              travelMode: "travel",
              activityType: "walking",
              startedAt: "2026-04-05T09:00:00.000Z",
              endedAt: "2026-04-05T09:03:00.000Z",
              startPlaceExternalUid: "",
              endPlaceExternalUid: "",
              distanceMeters: 80,
              movingSeconds: 120,
              idleSeconds: 20,
              averageSpeedMps: 1.1,
              maxSpeedMps: 1.3,
              caloriesKcal: 10,
              expectedMet: 2,
              tags: ["movement"],
              linkedEntities: [],
              linkedPeople: [],
              metadata: {},
              points: [
                {
                  recordedAt: "2026-04-05T09:00:00.000Z",
                  latitude: 46.5191,
                  longitude: 6.6323,
                  accuracyMeters: 8,
                  altitudeMeters: null,
                  speedMps: 1.1,
                  isStopAnchor: false
                },
                {
                  recordedAt: "2026-04-05T09:03:00.000Z",
                  latitude: 46.5196,
                  longitude: 6.6327,
                  accuracyMeters: 8,
                  altitudeMeters: null,
                  speedMps: 1.1,
                  isStopAnchor: true
                }
              ],
              stops: []
            }
          ]
        }
      }
    });
    assert.equal(syncResponse.statusCode, 200);

    const timelineResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/timeline"
    });
    assert.equal(timelineResponse.statusCode, 200);
    const timeline = timelineResponse.json() as {
      movement: {
        invalidSegmentCount: number;
        segments: Array<{ id: string; kind: string }>;
      };
    };
    assert.equal(timeline.movement.invalidSegmentCount, 0);
    assert.equal(
      timeline.movement.segments.some((segment) => segment.kind === "trip"),
      false
    );

    const invalidTrip = getDatabase()
      .prepare(
        `SELECT metadata_json
         FROM movement_trips
         WHERE external_uid = 'trip_tiny_invalid'`
      )
      .get() as { metadata_json: string };
    const tripMetadata = JSON.parse(invalidTrip.metadata_json) as {
      validation?: {
        invalid?: boolean;
        invalidTinyMove?: boolean;
        tinyMoveIssues?: string[];
      };
    };
    assert.equal(tripMetadata.validation?.invalid, true);
    assert.equal(tripMetadata.validation?.invalidTinyMove, true);
    assert.ok((tripMetadata.validation?.tinyMoveIssues?.length ?? 0) >= 1);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("movement timeline keeps cumulative-distance loop trips even when they end near the start", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-movement-loop-trip-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const pairingResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        userId: "user_operator"
      }
    });
    assert.equal(pairingResponse.statusCode, 201);
    const qrPayload = (
      pairingResponse.json() as {
        qrPayload: {
          sessionId: string;
          pairingToken: string;
        };
      }
    ).qrPayload;

    const syncResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/healthkit/sync",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        device: {
          name: "Loop Test iPhone",
          platform: "ios",
          appVersion: "1.0",
          sourceDevice: "iPhone"
        },
        permissions: {
          healthKitAuthorized: true,
          backgroundRefreshEnabled: true,
          motionReady: true,
          locationReady: true
        },
        sleepSessions: [],
        workouts: [],
        movement: {
          settings: {
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            locationPermissionStatus: "always",
            motionPermissionStatus: "ready",
            backgroundTrackingReady: true,
            metadata: {}
          },
          knownPlaces: [],
          stays: [],
          trips: [
            {
              externalUid: "trip_loop_valid",
              label: "Loop walk",
              status: "completed",
              travelMode: "travel",
              activityType: "walking",
              startedAt: "2026-04-05T09:00:00.000Z",
              endedAt: "2026-04-05T09:08:00.000Z",
              startPlaceExternalUid: "",
              endPlaceExternalUid: "",
              distanceMeters: 340,
              movingSeconds: 420,
              idleSeconds: 30,
              averageSpeedMps: 1.1,
              maxSpeedMps: 1.5,
              caloriesKcal: 10,
              expectedMet: 2,
              tags: ["movement"],
              linkedEntities: [],
              linkedPeople: [],
              metadata: {},
              points: [
                {
                  recordedAt: "2026-04-05T09:00:00.000Z",
                  latitude: 46.5191,
                  longitude: 6.6323,
                  accuracyMeters: 8,
                  altitudeMeters: null,
                  speedMps: 1.0,
                  isStopAnchor: false
                },
                {
                  recordedAt: "2026-04-05T09:04:00.000Z",
                  latitude: 46.5218,
                  longitude: 6.6376,
                  accuracyMeters: 8,
                  altitudeMeters: null,
                  speedMps: 1.3,
                  isStopAnchor: false
                },
                {
                  recordedAt: "2026-04-05T09:08:00.000Z",
                  latitude: 46.5191,
                  longitude: 6.6323,
                  accuracyMeters: 8,
                  altitudeMeters: null,
                  speedMps: 1.0,
                  isStopAnchor: true
                }
              ],
              stops: []
            }
          ]
        }
      }
    });
    assert.equal(syncResponse.statusCode, 200);

    const timelineResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/timeline"
    });
    assert.equal(timelineResponse.statusCode, 200);
    const timeline = timelineResponse.json() as {
      movement: {
        invalidSegmentCount: number;
        segments: Array<{ kind: string; origin?: string; title: string }>;
      };
    };
    assert.equal(timeline.movement.invalidSegmentCount, 0);
    assert.ok(
      timeline.movement.segments.some(
        (segment) => segment.kind === "trip" && segment.origin === "recorded"
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("movement day and timeline classify short gaps into repaired stays, repaired trips, and missing spans", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-movement-gap-classifier-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const pairingResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        userId: "user_operator"
      }
    });
    assert.equal(pairingResponse.statusCode, 201);
    const qrPayload = (
      pairingResponse.json() as {
        qrPayload: {
          sessionId: string;
          pairingToken: string;
        };
      }
    ).qrPayload;

    const syncResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/healthkit/sync",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        device: {
          name: "Gap Test iPhone",
          platform: "ios",
          appVersion: "1.0",
          sourceDevice: "iPhone"
        },
        permissions: {
          healthKitAuthorized: true,
          backgroundRefreshEnabled: true,
          motionReady: true,
          locationReady: true
        },
        sleepSessions: [],
        workouts: [],
        movement: {
          settings: {
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            locationPermissionStatus: "always",
            motionPermissionStatus: "ready",
            backgroundTrackingReady: true,
            metadata: {}
          },
          knownPlaces: [
            {
              externalUid: "place_home_classifier",
              label: "Home",
              aliases: [],
              latitude: 46.5191,
              longitude: 6.6323,
              radiusMeters: 100,
              categoryTags: ["home"],
              visibility: "shared",
              wikiNoteId: null,
              linkedEntities: [],
              linkedPeople: [],
              metadata: {}
            },
            {
              externalUid: "place_cafe_classifier",
              label: "Cafe",
              aliases: [],
              latitude: 46.5218,
              longitude: 6.6418,
              radiusMeters: 90,
              categoryTags: ["cafe"],
              visibility: "shared",
              wikiNoteId: null,
              linkedEntities: [],
              linkedPeople: [],
              metadata: {}
            }
          ],
          stays: [
            {
              externalUid: "stay_home_1",
              label: "Home",
              status: "completed",
              classification: "stationary",
              startedAt: "2026-04-05T07:00:00.000Z",
              endedAt: "2026-04-05T08:00:00.000Z",
              centerLatitude: 46.5191,
              centerLongitude: 6.6323,
              radiusMeters: 100,
              sampleCount: 8,
              placeExternalUid: "place_home_classifier",
              placeLabel: "Home",
              tags: ["home"],
              metadata: {}
            },
            {
              externalUid: "stay_home_2",
              label: "Home",
              status: "completed",
              classification: "stationary",
              startedAt: "2026-04-05T08:20:00.000Z",
              endedAt: "2026-04-05T08:40:00.000Z",
              centerLatitude: 46.51911,
              centerLongitude: 6.63228,
              radiusMeters: 100,
              sampleCount: 6,
              placeExternalUid: "place_home_classifier",
              placeLabel: "Home",
              tags: ["home"],
              metadata: {}
            },
            {
              externalUid: "stay_cafe",
              label: "Cafe",
              status: "completed",
              classification: "stationary",
              startedAt: "2026-04-05T09:30:00.000Z",
              endedAt: "2026-04-05T10:00:00.000Z",
              centerLatitude: 46.5218,
              centerLongitude: 6.6418,
              radiusMeters: 90,
              sampleCount: 5,
              placeExternalUid: "place_cafe_classifier",
              placeLabel: "Cafe",
              tags: ["cafe"],
              metadata: {}
            }
          ],
          trips: [
            {
              externalUid: "trip_repaired_gap_case",
              label: "Office to park",
              status: "completed",
              travelMode: "travel",
              activityType: "walking",
              startedAt: "2026-04-05T08:44:00.000Z",
              endedAt: "2026-04-05T09:10:00.000Z",
              startPlaceExternalUid: "",
              endPlaceExternalUid: "",
              distanceMeters: 1600,
              movingSeconds: 1300,
              idleSeconds: 60,
              averageSpeedMps: 1.3,
              maxSpeedMps: 2.1,
              caloriesKcal: 78,
              expectedMet: 2.7,
              tags: ["movement"],
              linkedEntities: [],
              linkedPeople: [],
              metadata: {},
              points: [
                {
                  recordedAt: "2026-04-05T08:44:00.000Z",
                  latitude: 46.5252,
                  longitude: 6.6492,
                  accuracyMeters: 10,
                  altitudeMeters: null,
                  speedMps: 1.2,
                  isStopAnchor: false
                },
                {
                  recordedAt: "2026-04-05T09:10:00.000Z",
                  latitude: 46.5236,
                  longitude: 6.6458,
                  accuracyMeters: 10,
                  altitudeMeters: null,
                  speedMps: 1.5,
                  isStopAnchor: true
                }
              ],
              stops: []
            }
          ]
        }
      }
    });
    assert.equal(syncResponse.statusCode, 200);

    const dayResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/day?date=2026-04-05"
    });
    assert.equal(dayResponse.statusCode, 200);
    const day = dayResponse.json() as {
      movement: {
        summary: {
          repairedGapCount: number;
          repairedGapDurationSeconds: number;
          continuedStayCount: number;
          continuedStayDurationSeconds: number;
          missingCount: number;
          missingDurationSeconds: number;
        };
        segments: Array<{
          kind: "stay" | "trip" | "missing";
          origin: "recorded" | "continued_stay" | "repaired_gap" | "missing";
          editable: boolean;
          startedAt: string;
          endedAt: string;
          subtitle: string;
        }>;
      };
    };
    assert.ok(day.movement.summary.repairedGapCount >= 1);
    assert.ok(day.movement.summary.repairedGapDurationSeconds > 0);
    assert.ok(day.movement.summary.continuedStayCount >= 0);
    assert.ok(day.movement.summary.continuedStayDurationSeconds >= 0);
    assert.ok(day.movement.summary.missingCount >= 1);
    assert.ok(day.movement.summary.missingDurationSeconds > 0);
    assert.equal(
      day.movement.segments.filter(
        (segment) =>
          segment.origin === "repaired_gap" && segment.kind === "stay"
      ).length,
      1
    );
    assert.equal(
      day.movement.segments.filter(
        (segment) =>
          segment.origin === "repaired_gap" && segment.kind === "trip"
      ).length,
      1
    );
    assert.ok(
      day.movement.segments.some(
        (segment) => segment.kind === "missing" && segment.origin === "missing"
      )
    );
    assert.ok(
      day.movement.segments.some((segment) =>
        segment.subtitle.includes("suppressed into stay continuity")
      )
    );
    assert.ok(day.movement.segments.every((segment) => !segment.editable));
    const dayCoverage = [...day.movement.segments].sort((left, right) =>
      left.startedAt.localeCompare(right.startedAt)
    );
    assert.equal(dayCoverage[0]?.startedAt, "2026-04-05T00:00:00.000Z");
    assert.equal(
      dayCoverage[dayCoverage.length - 1]?.endedAt,
      "2026-04-05T23:59:59.999Z"
    );
    for (let index = 1; index < dayCoverage.length; index += 1) {
      assert.equal(
        dayCoverage[index - 1]?.endedAt,
        dayCoverage[index]?.startedAt
      );
    }
    assert.ok(
      dayCoverage
        .filter((segment) => segment.kind === "missing")
        .every(
          (segment) =>
            Math.round(
              (Date.parse(segment.endedAt) - Date.parse(segment.startedAt)) / 1000
            ) >=
            60 * 60
        )
    );

    const timelineResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/timeline?includeInvalid=true"
    });
    assert.equal(timelineResponse.statusCode, 200);
    const timeline = timelineResponse.json() as {
      movement: {
        segments: Array<{
          kind: "stay" | "trip" | "missing";
          origin: "recorded" | "continued_stay" | "repaired_gap" | "missing";
          editable: boolean;
        }>;
      };
    };
    assert.ok(
      timeline.movement.segments.filter(
        (segment) =>
          segment.origin === "repaired_gap" && segment.kind === "stay"
      ).length >= 1
    );
    assert.equal(
      timeline.movement.segments.filter(
        (segment) =>
          segment.origin === "repaired_gap" && segment.kind === "trip"
      ).length,
      1
    );
    assert.ok(timeline.movement.segments.every((segment) => !segment.editable));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("movement timeline makes long overnight gaps explicit instead of leaving blank coverage", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-movement-gap-coverage-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const pairingResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        userId: "user_operator"
      }
    });
    assert.equal(pairingResponse.statusCode, 201);
    const qrPayload = (
      pairingResponse.json() as {
        qrPayload: {
          sessionId: string;
          pairingToken: string;
        };
      }
    ).qrPayload;

    const syncResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/healthkit/sync",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        device: {
          name: "Coverage Test iPhone",
          platform: "ios",
          appVersion: "1.0",
          sourceDevice: "iPhone"
        },
        permissions: {
          healthKitAuthorized: true,
          backgroundRefreshEnabled: true,
          motionReady: true,
          locationReady: true
        },
        sleepSessions: [],
        workouts: [],
        movement: {
          settings: {
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            locationPermissionStatus: "always",
            motionPermissionStatus: "ready",
            backgroundTrackingReady: true,
            metadata: {}
          },
          knownPlaces: [
            {
              externalUid: "place_home_coverage",
              label: "Home",
              aliases: [],
              latitude: 46.5191,
              longitude: 6.6323,
              radiusMeters: 100,
              categoryTags: ["home"],
              visibility: "shared",
              wikiNoteId: null,
              linkedEntities: [],
              linkedPeople: [],
              metadata: {}
            }
          ],
          stays: [
            {
              externalUid: "stay_home_evening",
              label: "Home",
              status: "completed",
              classification: "stationary",
              startedAt: "2026-04-05T21:15:00.000Z",
              endedAt: "2026-04-05T21:30:00.000Z",
              centerLatitude: 46.5191,
              centerLongitude: 6.6323,
              radiusMeters: 100,
              sampleCount: 5,
              placeExternalUid: "place_home_coverage",
              placeLabel: "Home",
              tags: ["home"],
              metadata: {}
            }
          ],
          trips: [
            {
              externalUid: "trip_night_move",
              label: "Night move",
              status: "completed",
              travelMode: "travel",
              activityType: "walking",
              startedAt: "2026-04-06T02:34:00.000Z",
              endedAt: "2026-04-06T02:40:00.000Z",
              startPlaceExternalUid: "",
              endPlaceExternalUid: "",
              distanceMeters: 650,
              movingSeconds: 300,
              idleSeconds: 60,
              averageSpeedMps: 1.8,
              maxSpeedMps: 2.5,
              caloriesKcal: 36,
              expectedMet: 2.0,
              tags: ["movement"],
              linkedEntities: [],
              linkedPeople: [],
              metadata: {},
              points: [
                {
                  recordedAt: "2026-04-06T02:34:00.000Z",
                  latitude: 46.5216,
                  longitude: 6.6404,
                  accuracyMeters: 10,
                  altitudeMeters: null,
                  speedMps: 1.6,
                  isStopAnchor: false
                },
                {
                  recordedAt: "2026-04-06T02:40:00.000Z",
                  latitude: 46.5226,
                  longitude: 6.6424,
                  accuracyMeters: 10,
                  altitudeMeters: null,
                  speedMps: 1.9,
                  isStopAnchor: true
                }
              ],
              stops: []
            }
          ]
        }
      }
    });
    assert.equal(syncResponse.statusCode, 200);

    const timelineResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/timeline?limit=12"
    });
    assert.equal(timelineResponse.statusCode, 200);
    const timeline = timelineResponse.json() as {
      movement: {
        segments: Array<{
          kind: "stay" | "trip" | "missing";
          origin: "recorded" | "continued_stay" | "repaired_gap" | "missing";
          startedAt: string;
          endedAt: string;
        }>;
      };
    };
    const expected = await loadSharedMovementFixture("overnight_gap_before_move");
    const relevant = [...timeline.movement.segments]
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
      .filter(
        (segment) =>
          segment.startedAt >= "2026-04-05T21:15:00.000Z" &&
          segment.endedAt <= "2026-04-06T02:40:00.000Z"
      );

    assert.deepEqual(
      relevant.map((segment) => ({
        kind: segment.kind,
        origin: segment.origin,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt
      })),
      expected.projectedTimeline.map((segment) => ({
        kind: segment.kind,
        origin: segment.origin,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt
      }))
    );
    for (let index = 1; index < relevant.length; index += 1) {
      assert.equal(relevant[index - 1]?.endedAt, relevant[index]?.startedAt);
    }
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("user-defined movement boxes override automatic boxes without mutating raw movement data", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-movement-user-boxes-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const pairingResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        userId: "user_operator"
      }
    });
    assert.equal(pairingResponse.statusCode, 201);
    const qrPayload = (
      pairingResponse.json() as {
        qrPayload: {
          sessionId: string;
          pairingToken: string;
        };
      }
    ).qrPayload;

    const syncResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/healthkit/sync",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        device: {
          name: "Override Test iPhone",
          platform: "ios",
          appVersion: "1.0",
          sourceDevice: "iPhone"
        },
        permissions: {
          healthKitAuthorized: true,
          backgroundRefreshEnabled: true,
          motionReady: true,
          locationReady: true
        },
        sleepSessions: [],
        workouts: [],
        movement: {
          settings: {
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            locationPermissionStatus: "always",
            motionPermissionStatus: "ready",
            backgroundTrackingReady: true,
            metadata: {}
          },
          knownPlaces: [
            {
              externalUid: "place_home_user_box",
              label: "Home",
              aliases: [],
              latitude: 46.5191,
              longitude: 6.6323,
              radiusMeters: 100,
              categoryTags: ["home"],
              visibility: "shared",
              wikiNoteId: null,
              linkedEntities: [],
              linkedPeople: [],
              metadata: {}
            }
          ],
          stays: [
            {
              externalUid: "stay_home_override_window",
              label: "Home",
              status: "completed",
              classification: "stationary",
              startedAt: "2026-04-05T08:00:00.000Z",
              endedAt: "2026-04-05T10:00:00.000Z",
              centerLatitude: 46.5191,
              centerLongitude: 6.6323,
              radiusMeters: 100,
              sampleCount: 10,
              placeExternalUid: "place_home_user_box",
              placeLabel: "Home",
              tags: ["home"],
              metadata: {}
            }
          ],
          trips: []
        }
      }
    });
    assert.equal(syncResponse.statusCode, 200);

    const createBoxResponse = await app.inject({
      method: "POST",
      url: "/api/v1/movement/user-boxes",
      headers: { cookie: operatorCookie },
      payload: {
        kind: "missing",
        startedAt: "2026-04-05T08:30:00.000Z",
        endedAt: "2026-04-05T09:00:00.000Z",
        title: "User-defined missing data",
        subtitle: "Override this automatic interval.",
        placeLabel: "Home",
        tags: ["user-defined", "missing-data"]
      }
    });
    assert.equal(createBoxResponse.statusCode, 201);
    const createdBox = createBoxResponse.json() as {
      box: {
        id: string;
        boxId: string;
        laneSide: string;
        connectorFromLane: string;
      };
    };
    assert.equal(createdBox.box.boxId, createdBox.box.id);
    assert.ok(createdBox.box.laneSide.length > 0);

    const expected = await loadSharedMovementFixture("user_defined_missing_override");

    const dayResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/day?date=2026-04-05"
    });
    assert.equal(dayResponse.statusCode, 200);
    const day = dayResponse.json() as {
      movement: {
        segments: Array<{
          id: string;
          kind: "stay" | "trip" | "missing";
          sourceKind: "automatic" | "user_defined";
          origin:
            | "recorded"
            | "continued_stay"
            | "repaired_gap"
            | "missing"
            | "user_defined"
            | "user_invalidated";
          overrideCount: number;
          startedAt: string;
          endedAt: string;
          editable: boolean;
        }>;
      };
    };
    const projectedWindow = day.movement.segments
      .filter((segment) => segment.startedAt >= "2026-04-05T08:00:00.000Z")
      .filter((segment) => segment.endedAt <= "2026-04-05T10:00:00.000Z")
      .map((segment) => ({
        kind: segment.kind,
        sourceKind: segment.sourceKind,
        origin: segment.origin,
        editable: segment.editable,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
        overrideCount: segment.overrideCount
      }));
    assert.deepEqual(
      projectedWindow,
      expected.projectedTimeline.map((segment) => ({
        kind: segment.kind,
        sourceKind: segment.sourceKind,
        origin: segment.origin,
        editable: segment.editable,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
        overrideCount: segment.overrideCount
      }))
    );
    const userMissing = day.movement.segments.find(
      (segment) =>
        segment.id === "user_missing_override_fixture" ||
        (
          segment.sourceKind === "user_defined" &&
          segment.kind === "missing" &&
          segment.startedAt === "2026-04-05T08:30:00.000Z" &&
          segment.endedAt === "2026-04-05T09:00:00.000Z"
        )
    );
    assert.ok(userMissing);
    assert.equal(userMissing?.origin, "user_invalidated");
    assert.equal(userMissing?.editable, true);
    assert.equal(userMissing?.overrideCount, 1);
    assert.equal(
      day.movement.segments.some(
        (segment) =>
          segment.sourceKind === "automatic" &&
          segment.kind === "stay" &&
          segment.startedAt === "2026-04-05T08:30:00.000Z"
      ),
      false
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("movement user-box preflight and save allow overlapping manual boxes with last-write-wins projection", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-movement-user-box-preflight-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const firstCreate = await app.inject({
      method: "POST",
      url: "/api/v1/movement/user-boxes",
      headers: { cookie: operatorCookie },
      payload: {
        kind: "stay",
        startedAt: "2026-04-05T14:00:00.000Z",
        endedAt: "2026-04-05T20:00:00.000Z",
        title: "Home",
        subtitle: "Manual stay.",
        placeLabel: "Home",
        tags: ["user-defined", "stay"]
      }
    });
    assert.equal(firstCreate.statusCode, 201);
    const firstBoxId = (firstCreate.json() as { box: { boxId: string } }).box.boxId;

    const preflight = await app.inject({
      method: "POST",
      url: "/api/v1/movement/user-boxes/preflight",
      headers: { cookie: operatorCookie },
      payload: {
        kind: "missing",
        startedAt: "2026-04-05T16:00:00.000Z",
        endedAt: "2026-04-05T18:00:00.000Z",
        title: "User-defined missing data",
        subtitle: "Manual override.",
        placeLabel: "Home",
        tags: ["missing-data"]
      }
    });
    assert.equal(preflight.statusCode, 200);
    const preflightBody = preflight.json() as {
      preflight: {
        overlapsAnything: boolean;
        affectedUserBoxIds: string[];
        trimmedUserBoxIds: string[];
      };
    };
    assert.equal(preflightBody.preflight.overlapsAnything, true);
    assert.deepEqual(preflightBody.preflight.affectedUserBoxIds, [firstBoxId]);
    assert.deepEqual(preflightBody.preflight.trimmedUserBoxIds, [firstBoxId]);

    const secondCreate = await app.inject({
      method: "POST",
      url: "/api/v1/movement/user-boxes",
      headers: { cookie: operatorCookie },
      payload: {
        kind: "missing",
        startedAt: "2026-04-05T16:00:00.000Z",
        endedAt: "2026-04-05T18:00:00.000Z",
        title: "User-defined missing data",
        subtitle: "Manual override.",
        placeLabel: "Home",
        tags: ["missing-data"]
      }
    });
    assert.equal(secondCreate.statusCode, 201);

    const timelineResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/timeline?limit=20"
    });
    assert.equal(timelineResponse.statusCode, 200);
    const timeline = timelineResponse.json() as {
      movement: {
        segments: Array<{
          boxId: string;
          sourceKind: "automatic" | "user_defined";
          kind: "stay" | "trip" | "missing";
          startedAt: string;
          endedAt: string;
        }>;
      };
    };

    const visibleFirstBoxFragments = timeline.movement.segments.filter(
      (segment) => segment.sourceKind === "user_defined" && segment.boxId === firstBoxId
    );
    assert.equal(visibleFirstBoxFragments.length, 2);
    assert.deepEqual(
      visibleFirstBoxFragments
        .map((segment) => ({
          kind: segment.kind,
          startedAt: segment.startedAt,
          endedAt: segment.endedAt
        }))
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt)),
      [
        {
          kind: "stay",
          startedAt: "2026-04-05T14:00:00.000Z",
          endedAt: "2026-04-05T16:00:00.000Z"
        },
        {
          kind: "stay",
          startedAt: "2026-04-05T18:00:00.000Z",
          endedAt: "2026-04-05T20:00:00.000Z"
        }
      ]
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("watch bootstrap serves compact habit state and watch habit check-ins preserve canonical streak semantics", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-watch-bootstrap-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  const currentDateKey = formatLocalDateKey();

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const positiveHabitResponse = await app.inject({
      method: "POST",
      url: "/api/v1/habits",
      headers: { cookie: operatorCookie },
      payload: {
        title: "Morning planning",
        description: "Open the day clearly.",
        status: "active",
        polarity: "positive",
        frequency: "daily",
        targetCount: 1,
        weekDays: [],
        linkedGoalIds: [],
        linkedProjectIds: [],
        linkedTaskIds: [],
        linkedValueIds: [],
        linkedPatternIds: [],
        linkedBehaviorIds: [],
        linkedBeliefIds: [],
        linkedModeIds: [],
        linkedReportIds: [],
        linkedBehaviorId: null,
        rewardXp: 12,
        penaltyXp: 8,
        generatedHealthEventTemplate: {
          enabled: false,
          workoutType: "walk",
          title: "",
          durationMinutes: 30,
          xpReward: 0,
          tags: [],
          links: [],
          notesTemplate: ""
        }
      }
    });
    assert.equal(positiveHabitResponse.statusCode, 201);
    const positiveHabitId = (
      positiveHabitResponse.json() as { habit: { id: string } }
    ).habit.id;

    const negativeHabitResponse = await app.inject({
      method: "POST",
      url: "/api/v1/habits",
      headers: { cookie: operatorCookie },
      payload: {
        title: "Doomscrolling",
        description: "Do not sink into reactive scrolling.",
        status: "active",
        polarity: "negative",
        frequency: "daily",
        targetCount: 1,
        weekDays: [],
        linkedGoalIds: [],
        linkedProjectIds: [],
        linkedTaskIds: [],
        linkedValueIds: [],
        linkedPatternIds: [],
        linkedBehaviorIds: [],
        linkedBeliefIds: [],
        linkedModeIds: [],
        linkedReportIds: [],
        linkedBehaviorId: null,
        rewardXp: 12,
        penaltyXp: 8,
        generatedHealthEventTemplate: {
          enabled: false,
          workoutType: "walk",
          title: "",
          durationMinutes: 30,
          xpReward: 0,
          tags: [],
          links: [],
          notesTemplate: ""
        }
      }
    });
    assert.equal(negativeHabitResponse.statusCode, 201);
    const negativeHabitId = (
      negativeHabitResponse.json() as { habit: { id: string } }
    ).habit.id;

    const pairingResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        userId: "user_operator",
        capabilities: ["watch-ready"]
      }
    });
    assert.equal(pairingResponse.statusCode, 201);
    const qrPayload = (
      pairingResponse.json() as {
        qrPayload: { sessionId: string; pairingToken: string };
      }
    ).qrPayload;

    const bootstrapResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/watch/bootstrap",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken
      }
    });
    assert.equal(bootstrapResponse.statusCode, 200);
    const initialBootstrap = (
      bootstrapResponse.json() as {
        watch: {
          habits: Array<{
            id: string;
            dueToday: boolean;
            alignedActionLabel: string;
            unalignedActionLabel: string;
            last7History: Array<{
              current: boolean;
              periodKey: string;
              state: string;
            }>;
          }>;
        };
      }
    ).watch;
    assert.ok(initialBootstrap.habits.length >= 2);
    assert.equal(initialBootstrap.habits[0]?.dueToday, true);
    assert.equal(
      initialBootstrap.habits.find((habit) => habit.id === positiveHabitId)
        ?.alignedActionLabel,
      "Done"
    );
    assert.equal(
      initialBootstrap.habits.find((habit) => habit.id === negativeHabitId)
        ?.alignedActionLabel,
      "Resisted"
    );

    const positiveCheckInResponse = await app.inject({
      method: "POST",
      url: `/api/v1/mobile/watch/habits/${positiveHabitId}/check-ins`,
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        dedupeKey: "watch-positive-1",
        dateKey: currentDateKey,
        status: "done",
        note: "Checked in from the watch.",
        description: "Start the day by opening the plan before reacting."
      }
    });
    assert.equal(positiveCheckInResponse.statusCode, 200);
    const positiveCheckIn = positiveCheckInResponse.json() as {
      habit: {
        description: string;
        streakCount: number;
        lastCheckInStatus: string | null;
      };
      watch: {
        habits: Array<{
          id: string;
          currentPeriodStatus: string;
          last7History: Array<{
            current: boolean;
            periodKey: string;
            state: string;
          }>;
        }>;
      };
    };
    assert.equal(
      positiveCheckIn.habit.description,
      "Start the day by opening the plan before reacting."
    );
    assert.equal(positiveCheckIn.habit.lastCheckInStatus, "done");
    assert.equal(positiveCheckIn.habit.streakCount, 1);
    assert.equal(
      positiveCheckIn.watch.habits.find((habit) => habit.id === positiveHabitId)
        ?.currentPeriodStatus,
      "aligned"
    );
    const positiveWatchHabit = positiveCheckIn.watch.habits.find(
      (habit) => habit.id === positiveHabitId
    );
    assert.equal(positiveWatchHabit?.last7History.at(-1)?.current, true);
    assert.equal(positiveWatchHabit?.last7History.at(-1)?.periodKey, currentDateKey);
    assert.equal(positiveWatchHabit?.last7History.at(-1)?.state, "aligned");

    const negativeCheckInResponse = await app.inject({
      method: "POST",
      url: `/api/v1/mobile/watch/habits/${negativeHabitId}/check-ins`,
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        dedupeKey: "watch-negative-1",
        dateKey: currentDateKey,
        status: "missed",
        note: "Resisted on the watch."
      }
    });
    assert.equal(negativeCheckInResponse.statusCode, 200);

    const habitsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/habits",
      headers: { cookie: operatorCookie }
    });
    assert.equal(habitsResponse.statusCode, 200);
    const habits = (
      habitsResponse.json() as {
        habits: Array<{
          id: string;
          streakCount: number;
          lastCheckInStatus: string | null;
          dueToday: boolean;
        }>;
      }
    ).habits;
    assert.equal(
      habits.find((habit) => habit.id === positiveHabitId)?.streakCount,
      1
    );
    assert.equal(
      habits.find((habit) => habit.id === negativeHabitId)?.lastCheckInStatus,
      "missed"
    );
    assert.equal(
      habits.find((habit) => habit.id === negativeHabitId)?.dueToday,
      false
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("watch capture batch stores raw events, dedupes repeats, and projects exact-target updates", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-watch-capture-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const pairingResponse = await app.inject({
      method: "POST",
      url: "/api/v1/health/pairing-sessions",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        userId: "user_operator",
        capabilities: ["watch-ready", "location-ready"]
      }
    });
    assert.equal(pairingResponse.statusCode, 201);
    const qrPayload = (
      pairingResponse.json() as {
        qrPayload: { sessionId: string; pairingToken: string };
      }
    ).qrPayload;

    const syncResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/healthkit/sync",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        device: {
          name: "Omar iPhone",
          platform: "ios",
          appVersion: "1.0",
          sourceDevice: "iPhone"
        },
        permissions: {
          healthKitAuthorized: true,
          backgroundRefreshEnabled: true,
          motionReady: true,
          locationReady: true
        },
        sleepSessions: [],
        workouts: [
          {
            externalUid: "watch-workout-1",
            workoutType: "walk",
            startedAt: "2026-04-07T07:15:00.000Z",
            endedAt: "2026-04-07T07:55:00.000Z",
            activeEnergyKcal: 210,
            totalEnergyKcal: 230,
            distanceMeters: 3800,
            stepCount: 4800,
            exerciseMinutes: 40,
            averageHeartRate: 116,
            maxHeartRate: 138,
            sourceDevice: "Apple Watch",
            links: [],
            annotations: {}
          }
        ],
        movement: {
          settings: {
            trackingEnabled: true,
            publishMode: "auto_publish",
            retentionMode: "aggregates_only",
            locationPermissionStatus: "always",
            motionPermissionStatus: "ready",
            backgroundTrackingReady: true,
            metadata: {}
          },
          knownPlaces: [
            {
              externalUid: "watch_place_unknown",
              label: "Unknown corner",
              aliases: [],
              latitude: 46.5191,
              longitude: 6.6323,
              radiusMeters: 90,
              categoryTags: [],
              visibility: "shared",
              wikiNoteId: null,
              linkedEntities: [],
              linkedPeople: [],
              metadata: {}
            }
          ],
          stays: [],
          trips: []
        }
      }
    });
    assert.equal(syncResponse.statusCode, 200);

    const movementBootstrap = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/movement/bootstrap",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken
      }
    });
    assert.equal(movementBootstrap.statusCode, 200);
    const placeId = (
      movementBootstrap.json() as {
        movement: { places: Array<{ id: string; label: string }> };
      }
    ).movement.places[0]?.id;
    assert.ok(placeId);

    const fitnessResponse = await app.inject({
      method: "GET",
      url: "/api/v1/health/fitness"
    });
    assert.equal(fitnessResponse.statusCode, 200);
    const workoutId = (
      fitnessResponse.json() as {
        fitness: {
          sessions: Array<{ id: string; subjectiveEffort: number | null }>;
        };
      }
    ).fitness.sessions[0]?.id;
    assert.ok(workoutId);

    const captureResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/watch/capture-events:batch",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        device: {
          name: "Omar Watch",
          platform: "watchos",
          appVersion: "1.0",
          sourceDevice: "Apple Watch"
        },
        events: [
          {
            dedupeKey: "watch-place-1",
            eventType: "place_label",
            recordedAt: "2026-04-07T08:00:00.000Z",
            linkedContext: {
              placeId
            },
            payload: {
              label: "Lake walk corner",
              categoryTags: ["Gym", "Parents House"]
            }
          },
          {
            dedupeKey: "watch-workout-1",
            eventType: "workout_annotation",
            recordedAt: "2026-04-07T08:01:00.000Z",
            linkedContext: {
              workoutId
            },
            payload: {
              subjectiveEffort: 6,
              moodAfter: "restorative",
              tags: ["watch", "recovery"]
            }
          }
        ]
      }
    });
    assert.equal(captureResponse.statusCode, 200);
    const captureBody = captureResponse.json() as {
      receipt: {
        receivedCount: number;
        storedCount: number;
        duplicateCount: number;
        projectedCount: number;
      };
    };
    assert.equal(captureBody.receipt.receivedCount, 2);
    assert.equal(captureBody.receipt.storedCount, 2);
    assert.equal(captureBody.receipt.duplicateCount, 0);
    assert.equal(captureBody.receipt.projectedCount, 2);

    const placesResponse = await app.inject({
      method: "GET",
      url: "/api/v1/movement/places"
    });
    assert.equal(placesResponse.statusCode, 200);
    const updatedPlace = (
      placesResponse.json() as {
        places: Array<{ id: string; label: string; categoryTags: string[] }>;
      }
    ).places.find((place) => place.id === placeId);
    assert.equal(updatedPlace?.label, "Lake walk corner");
    assert.ok(updatedPlace?.categoryTags.includes("gym"));
    assert.ok(updatedPlace?.categoryTags.includes("parents-house"));

    const updatedFitnessResponse = await app.inject({
      method: "GET",
      url: "/api/v1/health/fitness"
    });
    assert.equal(updatedFitnessResponse.statusCode, 200);
    const updatedWorkout = (
      updatedFitnessResponse.json() as {
        fitness: {
          sessions: Array<{
            id: string;
            subjectiveEffort: number | null;
            moodAfter: string;
            tags: string[];
          }>;
        };
      }
    ).fitness.sessions.find((session) => session.id === workoutId);
    assert.equal(updatedWorkout?.subjectiveEffort, 6);
    assert.equal(updatedWorkout?.moodAfter, "restorative");
    assert.ok(updatedWorkout?.tags.includes("watch"));

    const duplicateResponse = await app.inject({
      method: "POST",
      url: "/api/v1/mobile/watch/capture-events:batch",
      payload: {
        sessionId: qrPayload.sessionId,
        pairingToken: qrPayload.pairingToken,
        device: {
          name: "Omar Watch",
          platform: "watchos",
          appVersion: "1.0",
          sourceDevice: "Apple Watch"
        },
        events: [
          {
            dedupeKey: "watch-place-1",
            eventType: "place_label",
            recordedAt: "2026-04-07T08:00:00.000Z",
            linkedContext: {
              placeId
            },
            payload: {
              label: "Lake walk corner",
              category: "Nature"
            }
          }
        ]
      }
    });
    assert.equal(duplicateResponse.statusCode, 200);
    const duplicateBody = duplicateResponse.json() as {
      receipt: { storedCount: number; duplicateCount: number };
    };
    assert.equal(duplicateBody.receipt.storedCount, 0);
    assert.equal(duplicateBody.receipt.duplicateCount, 1);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("strategy lock rejects drafts that are missing targets or narrative", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-strategy-lock-guard-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const contextResponse = await app.inject({
      method: "GET",
      url: "/api/v1/context"
    });
    assert.equal(contextResponse.statusCode, 200);
    const context = contextResponse.json() as {
      goals: Array<{ id: string }>;
      tasks: Array<{ id: string }>;
    };
    const taskId = context.tasks[0]?.id;
    assert.ok(taskId);
    const goalId = context.goals[0]?.id;
    assert.ok(goalId);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/strategies",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Loose draft strategy",
        overview: "",
        endStateDescription: "",
        status: "active",
        targetGoalIds: [],
        targetProjectIds: [],
        linkedEntities: [],
        graph: {
          nodes: [
            {
              id: "draft_node",
              entityType: "task",
              entityId: taskId,
              title: "Draft node",
              branchLabel: "",
              notes: ""
            }
          ],
          edges: []
        }
      }
    });

    assert.equal(createResponse.statusCode, 201);
    const strategyId = (createResponse.json() as { strategy: { id: string } })
      .strategy.id;

    const lockResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/strategies/${strategyId}`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        isLocked: true
      }
    });

    assert.equal(lockResponse.statusCode, 400);
    const lockBody = lockResponse.json() as {
      code: string;
      error: string;
    };
    assert.equal(lockBody.code, "strategy_contract_invalid");
    assert.match(lockBody.error, /target at least one goal or project/i);

    const narrativeDraftResponse = await app.inject({
      method: "POST",
      url: "/api/v1/strategies",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Untold contract draft",
        overview: "",
        endStateDescription: "",
        status: "active",
        targetGoalIds: [goalId],
        targetProjectIds: [],
        linkedEntities: [],
        graph: {
          nodes: [
            {
              id: "narrative_node",
              entityType: "task",
              entityId: taskId,
              title: "Draft node",
              branchLabel: "",
              notes: ""
            }
          ],
          edges: []
        }
      }
    });
    assert.equal(narrativeDraftResponse.statusCode, 201);
    const narrativeStrategyId = (
      narrativeDraftResponse.json() as { strategy: { id: string } }
    ).strategy.id;

    const narrativeLockResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/strategies/${narrativeStrategyId}`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        isLocked: true
      }
    });
    assert.equal(narrativeLockResponse.statusCode, 400);
    const narrativeLockBody = narrativeLockResponse.json() as {
      code: string;
      error: string;
    };
    assert.equal(narrativeLockBody.code, "strategy_contract_invalid");
    assert.match(narrativeLockBody.error, /overview or end-state description/i);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("user directory exposes permissive grants and ownership summaries for new users", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-user-directory-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const createUserResponse = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        kind: "bot",
        handle: "planner_bot",
        displayName: "Planner Bot",
        description: "Cross-user planning bot",
        accentColor: "#22d3ee"
      }
    });
    assert.equal(createUserResponse.statusCode, 201);
    const createdUser = (
      createUserResponse.json() as {
        user: { id: string };
      }
    ).user;

    const directoryResponse = await app.inject({
      method: "GET",
      url: "/api/v1/users/directory"
    });
    assert.equal(directoryResponse.statusCode, 200);
    const directory = (
      directoryResponse.json() as {
        directory: {
          users: Array<{ id: string }>;
          grants: Array<{
            subjectUserId: string;
            targetUserId: string;
            accessLevel: string;
          }>;
          ownership: Array<{ userId: string; totalOwnedEntities: number }>;
          xp: Array<{ userId: string; totalXp: number; weeklyXp: number }>;
          posture: { accessModel: string; futureReady: boolean };
        };
      }
    ).directory;

    assert.ok(directory.users.some((user) => user.id === createdUser.id));
    assert.ok(
      directory.grants.some(
        (grant) =>
          grant.subjectUserId === createdUser.id &&
          grant.accessLevel === "manage" &&
          grant.targetUserId === createdUser.id
      )
    );
    assert.ok(
      directory.grants.some(
        (grant) =>
          grant.subjectUserId === "user_operator" &&
          grant.targetUserId === createdUser.id &&
          grant.accessLevel === "manage"
      )
    );
    assert.ok(
      directory.ownership.some(
        (entry) =>
          entry.userId === createdUser.id && entry.totalOwnedEntities === 0
      )
    );
    assert.ok(
      directory.xp.some(
        (entry) =>
          entry.userId === createdUser.id &&
          entry.totalXp === 0 &&
          entry.weeklyXp === 0
      )
    );
    assert.equal(directory.posture.accessModel, "directional_graph");
    assert.equal(directory.posture.futureReady, true);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("calendar overview accepts timezone offsets and plain dates", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-calendar-query-flexibility-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const offsetResponse = await app.inject({
      method: "GET",
      url: "/api/v1/calendar/overview?from=2026-04-05T00:00:00%2B02:00&to=2026-04-06T00:00:00%2B02:00"
    });
    assert.equal(offsetResponse.statusCode, 200);
    const offsetBody = offsetResponse.json() as {
      calendar: { generatedAt: string; events: unknown[] };
    };
    assert.equal(typeof offsetBody.calendar.generatedAt, "string");
    assert.ok(Array.isArray(offsetBody.calendar.events));

    const dateOnlyResponse = await app.inject({
      method: "GET",
      url: "/api/v1/calendar/overview?from=2026-04-05&to=2026-04-06"
    });
    assert.equal(dateOnlyResponse.statusCode, 200);
    const dateOnlyBody = dateOnlyResponse.json() as {
      calendar: { generatedAt: string; events: unknown[] };
    };
    assert.equal(typeof dateOnlyBody.calendar.generatedAt, "string");
    assert.ok(Array.isArray(dateOnlyBody.calendar.events));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("native Forge calendar events can be created, linked, updated, and removed without a provider connection", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-native-calendar-events-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const snapshotResponse = await app.inject({
      method: "GET",
      url: "/api/v1/context"
    });
    const snapshot = snapshotResponse.json() as {
      goals: Array<{ id: string; title: string }>;
      projects: Array<{ id: string; title: string }>;
    };

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/calendar/events",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Forge-native planning block",
        description:
          "A local-first event that should still work without Google or Apple.",
        location: "Deep work room",
        startAt: "2026-04-06T08:00:00.000Z",
        endAt: "2026-04-06T09:30:00.000Z",
        timezone: "Europe/Zurich",
        availability: "busy",
        categories: ["planning", "native"],
        links: [
          {
            entityType: "goal",
            entityId: snapshot.goals[0]!.id,
            relationshipType: "context"
          }
        ]
      }
    });

    assert.equal(created.statusCode, 201);
    const createdEvent = (
      created.json() as {
        event: {
          id: string;
          originType: string;
          links: Array<{ entityType: string; entityId: string }>;
          sourceMappings: unknown[];
        };
      }
    ).event;
    assert.equal(createdEvent.originType, "native");
    assert.equal(createdEvent.links.length, 1);
    assert.equal(createdEvent.sourceMappings.length, 0);

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/v1/calendar/events/${createdEvent.id}`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Forge-native planning review",
        links: [
          {
            entityType: "project",
            entityId: snapshot.projects[0]!.id,
            relationshipType: "meeting_for"
          }
        ]
      }
    });

    assert.equal(updated.statusCode, 200);
    const updatedEvent = (
      updated.json() as {
        event: {
          title: string;
          links: Array<{
            entityType: string;
            entityId: string;
            relationshipType: string;
          }>;
        };
      }
    ).event;
    assert.equal(updatedEvent.title, "Forge-native planning review");
    assert.equal(updatedEvent.links.length, 1);
    assert.equal(updatedEvent.links[0]?.entityType, "project");
    assert.equal(updatedEvent.links[0]?.entityId, snapshot.projects[0]!.id);
    assert.equal(updatedEvent.links[0]?.relationshipType, "meeting_for");

    const overview = await app.inject({
      method: "GET",
      url: "/api/v1/calendar/overview?from=2026-04-06T00:00:00.000Z&to=2026-04-07T00:00:00.000Z"
    });
    assert.equal(overview.statusCode, 200);
    const overviewBody = overview.json() as {
      calendar: {
        events: Array<{ id: string; title: string; originType: string }>;
      };
    };
    assert.ok(
      overviewBody.calendar.events.some(
        (event) =>
          event.id === createdEvent.id &&
          event.title === "Forge-native planning review" &&
          event.originType === "native"
      )
    );

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/v1/calendar/events/${createdEvent.id}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(removed.statusCode, 200);

    const afterDelete = await app.inject({
      method: "GET",
      url: "/api/v1/calendar/overview?from=2026-04-06T00:00:00.000Z&to=2026-04-07T00:00:00.000Z"
    });
    const afterDeleteBody = afterDelete.json() as {
      calendar: {
        events: Array<{ id: string }>;
      };
    };
    assert.ok(
      afterDeleteBody.calendar.events.every(
        (event) => event.id !== createdEvent.id
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("calendar resource listing normalizes blank timezones to UTC", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-calendar-resource-timezone-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const database = getDatabase();
    database
      .prepare(
        `INSERT INTO stored_secrets (id, cipher_text, description, created_at, updated_at)
         VALUES (?, ?, '', ?, ?)`
      )
      .run(
        "secret_calendar_test",
        "cipher",
        "2026-04-03T00:00:00.000Z",
        "2026-04-03T00:00:00.000Z"
      );
    database
      .prepare(
        `INSERT INTO calendar_connections (
           id, provider, label, account_label, status, config_json, credentials_secret_id, forge_calendar_id, last_synced_at, last_sync_error, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`
      )
      .run(
        "conn_calendar_test",
        "apple",
        "Apple Calendar",
        "albert@example.com",
        "connected",
        "{}",
        "secret_calendar_test",
        "2026-04-03T00:00:00.000Z",
        "2026-04-03T00:00:00.000Z"
      );
    database
      .prepare(
        `INSERT INTO calendar_calendars (
           id, connection_id, remote_id, title, description, color, timezone, is_primary, can_write, forge_managed, selected_for_sync, last_synced_at, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, '', ?, '', 0, 1, 0, 1, NULL, ?, ?)`
      )
      .run(
        "calendar_blank_timezone",
        "conn_calendar_test",
        "https://caldav.icloud.com/example/calendars/blank/",
        "Work",
        "#7dd3fc",
        "2026-04-03T00:00:00.000Z",
        "2026-04-03T00:00:00.000Z"
      );

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/calendar/calendars"
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      calendars: Array<{ id: string; timezone: string }>;
    };
    assert.equal(body.calendars[0]?.id, "calendar_blank_timezone");
    assert.equal(body.calendars[0]?.timezone, "UTC");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("calendar connection metadata exposes Exchange Online as read only and macOS local as writable", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-calendar-providers-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/calendar/connections"
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      providers: Array<{
        provider: string;
        label: string;
        supportsDedicatedForgeCalendar: boolean;
        connectionHelp: string;
      }>;
    };
    const exchangeProvider = body.providers.find(
      (provider) => provider.provider === "microsoft"
    );
    assert.ok(exchangeProvider);
    assert.equal(exchangeProvider?.label, "Exchange Online");
    assert.equal(exchangeProvider?.supportsDedicatedForgeCalendar, false);
    assert.match(
      exchangeProvider?.connectionHelp ?? "",
      /microsoft client id|sign-in flow/i
    );
    const macosProvider = body.providers.find(
      (provider) => provider.provider === "macos_local"
    );
    assert.ok(macosProvider);
    assert.equal(macosProvider?.label, "Calendars On This Mac");
    assert.equal(macosProvider?.supportsDedicatedForgeCalendar, true);
    assert.match(
      macosProvider?.connectionHelp ?? "",
      /eventkit|configured on this mac|duplicate/i
    );
    assert.deepEqual(
      body.providers.map((provider) => provider.provider),
      ["google", "apple", "microsoft", "caldav", "macos_local"]
    );
  } finally {
    await app.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("macOS local connection replacement rehomes Forge-owned references and blocks superseded sync", async () => {
  const previousMock = process.env.FORGE_MACOS_LOCAL_MOCK_JSON;
  process.env.FORGE_MACOS_LOCAL_MOCK_JSON = JSON.stringify({
    status: "full_access",
    granted: true,
    sources: [
      {
        sourceId: "source_work",
        sourceTitle: "Work",
        sourceType: "exchange",
        accountLabel: "Work",
        calendars: [
          {
            sourceId: "source_work",
            sourceTitle: "Work",
            sourceType: "exchange",
            calendarId: "cal_work",
            title: "Work",
            description: "Main work calendar",
            color: "#7dd3fc",
            timezone: "Europe/Zurich",
            calendarType: "exchange",
            isPrimary: true,
            canWrite: true
          },
          {
            sourceId: "source_work",
            sourceTitle: "Work",
            sourceType: "exchange",
            calendarId: "cal_forge",
            title: "Forge",
            description: "Forge write calendar",
            color: "#22c55e",
            timezone: "Europe/Zurich",
            calendarType: "exchange",
            isPrimary: false,
            canWrite: true
          }
        ]
      }
    ],
    events: []
  });

  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-macos-local-replace-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const database = getDatabase();
    const now = "2026-04-03T00:00:00.000Z";

    database
      .prepare(
        `INSERT INTO stored_secrets (id, cipher_text, description, created_at, updated_at)
         VALUES (?, ?, '', ?, ?)`
      )
      .run("secret_calendar_old", "cipher", now, now);

    database
      .prepare(
        `INSERT INTO calendar_connections (
           id, provider, label, account_label, status, config_json, credentials_secret_id, forge_calendar_id, last_synced_at, last_sync_error, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .run(
        "conn_google_old",
        "google",
        "Primary Google",
        "Work",
        "connected",
        JSON.stringify({
          accountIdentityKey: "exchange:work",
          forgeCalendarUrl: "https://google.example/forge/"
        }),
        "secret_calendar_old",
        null,
        now,
        now,
        now
      );

    database
      .prepare(
        `INSERT INTO tasks (
           id, title, description, status, priority, owner, goal_id, project_id, due_date, effort, energy, points, sort_order, completed_at, created_at, updated_at
         )
         VALUES (?, ?, '', 'todo', 'medium', 'Albert', NULL, NULL, NULL, 'medium', 'medium', 10, 0, NULL, ?, ?)`
      )
      .run("task_replace_test", "Replacement test task", now, now);

    database
      .prepare(
        `INSERT INTO calendar_calendars (
           id, connection_id, remote_id, title, description, color, timezone, is_primary, can_write, selected_for_sync, forge_managed,
           source_id, source_title, source_type, calendar_type, host_calendar_id, canonical_key, last_synced_at, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, '', ?, ?, 0, 1, 1, 0, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`
      )
      .run(
        "calendar_old_work",
        "conn_google_old",
        "https://google.example/work/",
        "Work",
        "#7dd3fc",
        "Europe/Zurich",
        "exchange:work:work",
        now,
        now,
        now
      );

    database
      .prepare(
        `INSERT INTO calendar_calendars (
           id, connection_id, remote_id, title, description, color, timezone, is_primary, can_write, selected_for_sync, forge_managed,
           source_id, source_title, source_type, calendar_type, host_calendar_id, canonical_key, last_synced_at, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, '', ?, ?, 0, 1, 0, 1, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`
      )
      .run(
        "calendar_old_forge",
        "conn_google_old",
        "https://google.example/forge/",
        "Forge",
        "#22c55e",
        "Europe/Zurich",
        "exchange:work:forge",
        now,
        now,
        now
      );

    database
      .prepare(
        `INSERT INTO forge_events (
           id, preferred_connection_id, preferred_calendar_id, ownership, origin_type, status, title, description, location,
           place_label, place_address, place_timezone, place_latitude, place_longitude, place_source, place_external_id,
           start_at, end_at, timezone, is_all_day, availability, event_type, categories_json, deleted_at, created_at, updated_at
         )
         VALUES (?, ?, ?, 'forge', 'native', 'confirmed', ?, '', '', '', '', '', NULL, NULL, '', '', ?, ?, ?, 0, 'busy', 'general', '[]', NULL, ?, ?)`
      )
      .run(
        "calevent_replace_test",
        "conn_google_old",
        "calendar_old_forge",
        "Focus block",
        "2026-04-04T09:00:00.000Z",
        "2026-04-04T10:00:00.000Z",
        "Europe/Zurich",
        now,
        now
      );

    database
      .prepare(
        `INSERT INTO forge_event_sources (
           id, forge_event_id, provider, connection_id, calendar_id, remote_calendar_id, remote_event_id, remote_uid,
           recurrence_instance_id, is_master_recurring, remote_href, remote_etag, sync_state, raw_payload_json, last_synced_at, created_at, updated_at
         )
         VALUES (?, ?, 'google', ?, ?, ?, ?, ?, NULL, 0, NULL, NULL, 'synced', '{}', ?, ?, ?)`
      )
      .run(
        "evsrc_replace_test",
        "calevent_replace_test",
        "conn_google_old",
        "calendar_old_forge",
        "https://google.example/forge/",
        "remote_old_event",
        "remote_old_event",
        now,
        now,
        now
      );

    database
      .prepare(
        `INSERT INTO task_timeboxes (
           id, task_id, project_id, connection_id, calendar_id, remote_event_id, linked_task_run_id, status, source, title,
           starts_at, ends_at, override_reason, created_at, updated_at
         )
         VALUES (?, ?, NULL, ?, ?, ?, NULL, 'planned', 'manual', ?, ?, ?, NULL, ?, ?)`
      )
      .run(
        "timebox_replace_test",
        "task_replace_test",
        "conn_google_old",
        "calendar_old_forge",
        "remote_old_timebox",
        "Focus block",
        "2026-04-04T09:00:00.000Z",
        "2026-04-04T10:00:00.000Z",
        now,
        now
      );

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/calendar/connections",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        provider: "macos_local",
        label: "Calendars On This Mac",
        sourceId: "source_work",
        selectedCalendarUrls: [
          "forge-macos-local://calendar/source_work/cal_work/"
        ],
        forgeCalendarUrl: "forge-macos-local://calendar/source_work/cal_forge/",
        createForgeCalendar: false,
        replaceConnectionIds: ["conn_google_old"]
      }
    });

    assert.equal(createResponse.statusCode, 201);
    const createdConnection = (
      createResponse.json() as { connection: { id: string; provider: string } }
    ).connection;
    assert.equal(createdConnection.provider, "macos_local");

    const oldConnectionRow = database
      .prepare(
        `SELECT config_json
         FROM calendar_connections
         WHERE id = ?`
      )
      .get("conn_google_old") as { config_json: string };
    const oldConfig = JSON.parse(oldConnectionRow.config_json) as Record<string, unknown>;
    assert.equal(oldConfig.replacedByConnectionId, createdConnection.id);

    const newForgeCalendar = database
      .prepare(
        `SELECT id
         FROM calendar_calendars
         WHERE connection_id = ? AND forge_managed = 1
         LIMIT 1`
      )
      .get(createdConnection.id) as { id: string };
    assert.ok(newForgeCalendar);

    const rehomedEvent = database
      .prepare(
        `SELECT preferred_connection_id, preferred_calendar_id
         FROM forge_events
         WHERE id = ?`
      )
      .get("calevent_replace_test") as {
      preferred_connection_id: string | null;
      preferred_calendar_id: string | null;
    };
    assert.equal(rehomedEvent.preferred_connection_id, createdConnection.id);
    assert.equal(rehomedEvent.preferred_calendar_id, newForgeCalendar.id);

    const oldForgeSources = database
      .prepare(
        `SELECT COUNT(*) as count
         FROM forge_event_sources
         WHERE connection_id = ? AND forge_event_id = ?`
      )
      .get("conn_google_old", "calevent_replace_test") as { count: number };
    assert.equal(oldForgeSources.count, 0);

    const rehomedTimebox = database
      .prepare(
        `SELECT connection_id, calendar_id, remote_event_id
         FROM task_timeboxes
         WHERE id = ?`
      )
      .get("timebox_replace_test") as {
      connection_id: string | null;
      calendar_id: string | null;
      remote_event_id: string | null;
    };
    assert.equal(rehomedTimebox.connection_id, createdConnection.id);
    assert.equal(rehomedTimebox.calendar_id, newForgeCalendar.id);
    assert.equal(rehomedTimebox.remote_event_id, null);

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/v1/calendar/connections"
    });
    assert.equal(listResponse.statusCode, 200);
    const listedConnections = (
      listResponse.json() as { connections: Array<{ id: string }> }
    ).connections;
    assert.equal(
      listedConnections.some((connection) => connection.id === "conn_google_old"),
      false
    );
    assert.equal(
      listedConnections.some((connection) => connection.id === createdConnection.id),
      true
    );

    const syncOldResponse = await app.inject({
      method: "POST",
      url: "/api/v1/calendar/connections/conn_google_old/sync",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      }
    });
    assert.equal(syncOldResponse.statusCode, 409);
    assert.equal(
      (syncOldResponse.json() as { code: string }).code,
      "calendar_connection_superseded"
    );
  } finally {
    if (previousMock === undefined) {
      delete process.env.FORGE_MACOS_LOCAL_MOCK_JSON;
    } else {
      process.env.FORGE_MACOS_LOCAL_MOCK_JSON = previousMock;
    }
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("new writable connections can reuse the existing shared Forge write target without creating another one", async () => {
  const previousMock = process.env.FORGE_MACOS_LOCAL_MOCK_JSON;
  process.env.FORGE_MACOS_LOCAL_MOCK_JSON = JSON.stringify({
    status: "full_access",
    granted: true,
    sources: [
      {
        sourceId: "source_work",
        sourceTitle: "Work",
        sourceType: "exchange",
        accountLabel: "Work",
        calendars: [
          {
            sourceId: "source_work",
            sourceTitle: "Work",
            sourceType: "exchange",
            calendarId: "cal_work",
            title: "Work",
            description: "Main work calendar",
            color: "#7dd3fc",
            timezone: "Europe/Zurich",
            calendarType: "exchange",
            isPrimary: true,
            canWrite: true
          },
          {
            sourceId: "source_work",
            sourceTitle: "Work",
            sourceType: "exchange",
            calendarId: "cal_forge",
            title: "Forge",
            description: "Forge write calendar",
            color: "#22c55e",
            timezone: "Europe/Zurich",
            calendarType: "exchange",
            isPrimary: false,
            canWrite: true
          }
        ]
      }
    ],
    events: []
  });

  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-shared-write-target-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const database = getDatabase();
    const now = "2026-04-03T00:00:00.000Z";

    database
      .prepare(
        `INSERT INTO stored_secrets (id, cipher_text, description, created_at, updated_at)
         VALUES (?, ?, '', ?, ?)`
      )
      .run("secret_calendar_existing", "cipher", now, now);

    database
      .prepare(
        `INSERT INTO calendar_connections (
           id, provider, label, account_label, status, config_json, credentials_secret_id, forge_calendar_id, last_synced_at, last_sync_error, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .run(
        "conn_apple_existing",
        "apple",
        "Primary Apple",
        "albert.buchard@gmail.com",
        "connected",
        JSON.stringify({
          forgeCalendarUrl: "https://caldav.icloud.com/calendars/forge/",
          selectedCalendarCount: 2
        }),
        "secret_calendar_existing",
        null,
        now,
        now,
        now
      );

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/calendar/connections",
      headers: {
        cookie: operatorCookie,
        host: "127.0.0.1:4317"
      },
      payload: {
        provider: "macos_local",
        label: "Calendars On This Mac",
        sourceId: "source_work",
        selectedCalendarUrls: [
          "forge-macos-local://calendar/source_work/cal_work/"
        ]
      }
    });

    assert.equal(createResponse.statusCode, 201);
    const createdConnection = (
      createResponse.json() as { connection: { id: string; provider: string; forgeCalendarId: string | null } }
    ).connection;
    assert.equal(createdConnection.provider, "macos_local");
    assert.equal(createdConnection.forgeCalendarId, null);

    const createdRow = database
      .prepare(
        `SELECT config_json, forge_calendar_id
         FROM calendar_connections
         WHERE id = ?`
      )
      .get(createdConnection.id) as {
      config_json: string;
      forge_calendar_id: string | null;
    };
    const createdConfig = JSON.parse(createdRow.config_json) as Record<string, unknown>;
    assert.equal(createdConfig.forgeCalendarUrl, null);
    assert.equal(createdRow.forge_calendar_id, null);

    const forgeManagedCalendars = database
      .prepare(
        `SELECT COUNT(*) as count
         FROM calendar_calendars
         WHERE connection_id = ? AND forge_managed = 1`
      )
      .get(createdConnection.id) as { count: number };
    assert.equal(forgeManagedCalendars.count, 0);
  } finally {
    if (previousMock === undefined) {
      delete process.env.FORGE_MACOS_LOCAL_MOCK_JSON;
    } else {
      process.env.FORGE_MACOS_LOCAL_MOCK_JSON = previousMock;
    }
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("microsoft local auth config can be validated without env secrets", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-microsoft-config-test-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/calendar/oauth/microsoft/test-config",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        clientId: "00000000-0000-0000-0000-000000000000",
        tenantId: "common",
        redirectUri:
          "http://127.0.0.1:4317/api/v1/calendar/oauth/microsoft/callback"
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      result: {
        ok: boolean;
        message: string;
        normalizedConfig: {
          clientId: string;
          redirectUri: string;
          usesClientSecret: boolean;
          readOnly: boolean;
        };
      };
    };
    assert.equal(body.result.ok, true);
    assert.equal(
      body.result.normalizedConfig.clientId,
      "00000000-0000-0000-0000-000000000000"
    );
    assert.equal(
      body.result.normalizedConfig.redirectUri,
      "http://127.0.0.1:4317/api/v1/calendar/oauth/microsoft/callback"
    );
    assert.equal(body.result.normalizedConfig.usesClientSecret, false);
    assert.equal(body.result.normalizedConfig.readOnly, true);
    assert.match(body.result.message, /final verification/i);
  } finally {
    await app.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("health probe can expose the effective runtime storage root for OpenClaw runtime checks", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-health-probe-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: {
        "x-forge-runtime-probe": "1"
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      ok: boolean;
      runtime?: {
        pid: number;
        storageRoot: string;
        basePath: string;
      };
    };
    assert.equal(body.ok, true);
    assert.equal(body.runtime?.pid, process.pid);
    assert.equal(body.runtime?.storageRoot, rootDir);
    assert.equal(body.runtime?.basePath, "/forge/");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("health probe reports the effective database root even when FORGE_DATA_ROOT is implicit", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-health-implicit-root-")
  );
  configureDatabase({ dataRoot: rootDir, seedDemoData: true });
  const app = await buildServer();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: {
        "x-forge-runtime-probe": "1"
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      ok: boolean;
      runtime?: {
        pid: number;
        storageRoot: string;
        basePath: string;
      };
    };
    assert.equal(body.ok, true);
    assert.equal(body.runtime?.pid, process.pid);
    assert.equal(body.runtime?.storageRoot, rootDir);
    assert.equal(body.runtime?.basePath, "/forge/");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("work adjustments add and remove signed minutes on tasks and projects with symmetric XP", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-work-adjustments-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const snapshotResponse = await app.inject({
      method: "GET",
      url: "/api/v1/context"
    });
    const snapshot = snapshotResponse.json() as {
      tasks: Array<{ id: string; title: string; projectId: string | null }>;
      metrics: { totalXp: number };
    };
    const task = snapshot.tasks[0]!;
    assert.ok(task?.projectId);

    const addTaskAdjustment = await app.inject({
      method: "POST",
      url: "/api/v1/work-adjustments",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        entityType: "task",
        entityId: task.id,
        deltaMinutes: 25,
        note: "Captured a real review block that happened off-timer."
      }
    });

    assert.equal(addTaskAdjustment.statusCode, 201);
    const addTaskBody = addTaskAdjustment.json() as {
      adjustment: { appliedDeltaMinutes: number };
      reward: { deltaXp: number } | null;
      target: { time: { totalCreditedSeconds: number } };
    };
    assert.equal(addTaskBody.adjustment.appliedDeltaMinutes, 25);
    assert.equal(addTaskBody.reward?.deltaXp, 8);
    assert.equal(addTaskBody.target.time.totalCreditedSeconds, 1500);

    const taskContextAfterAdd = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${task.id}/context`
    });
    const taskContextBody = taskContextAfterAdd.json() as {
      activity: Array<{
        eventType: string;
        metadata: { appliedDeltaMinutes?: number };
      }>;
    };
    assert.ok(
      taskContextBody.activity.some(
        (event) =>
          event.eventType === "work_adjusted" &&
          event.metadata.appliedDeltaMinutes === 25
      )
    );

    const removeTaskAdjustment = await app.inject({
      method: "POST",
      url: "/api/v1/work-adjustments",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        entityType: "task",
        entityId: task.id,
        deltaMinutes: -30,
        note: "Corrected an overcounted estimate."
      }
    });

    assert.equal(removeTaskAdjustment.statusCode, 201);
    const removeTaskBody = removeTaskAdjustment.json() as {
      adjustment: {
        requestedDeltaMinutes: number;
        appliedDeltaMinutes: number;
      };
      reward: { deltaXp: number } | null;
      target: { time: { totalCreditedSeconds: number } };
    };
    assert.equal(removeTaskBody.adjustment.requestedDeltaMinutes, -30);
    assert.equal(removeTaskBody.adjustment.appliedDeltaMinutes, -25);
    assert.equal(removeTaskBody.reward?.deltaXp, -8);
    assert.equal(removeTaskBody.target.time.totalCreditedSeconds, 0);

    const addProjectAdjustment = await app.inject({
      method: "POST",
      url: "/api/v1/work-adjustments",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        entityType: "project",
        entityId: task.projectId,
        deltaMinutes: 15,
        note: "Captured project-level planning time."
      }
    });

    assert.equal(addProjectAdjustment.statusCode, 201);
    const addProjectBody = addProjectAdjustment.json() as {
      reward: { deltaXp: number } | null;
      target: { time: { totalCreditedSeconds: number } };
      metrics: { profile: { totalXp: number } };
    };
    assert.equal(addProjectBody.reward?.deltaXp, 4);
    assert.equal(addProjectBody.target.time.totalCreditedSeconds, 900);
    assert.equal(
      addProjectBody.metrics.profile.totalXp,
      snapshot.metrics.totalXp + 4
    );

    const projectBoard = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${task.projectId}/board`
    });
    const projectBoardBody = projectBoard.json() as {
      activity: Array<{ entityType: string; eventType: string }>;
    };
    assert.ok(
      projectBoardBody.activity.some(
        (event) =>
          event.entityType === "project" && event.eventType === "work_adjusted"
      )
    );

    const onboarding = await app.inject({
      method: "GET",
      url: "/api/v1/agents/onboarding"
    });
    const onboardingBody = onboarding.json() as {
      onboarding: {
        toolInputCatalog: Array<{ toolName: string }>;
        recommendedPluginTools: { workWorkflow: string[] };
      };
    };
    assert.ok(
      onboardingBody.onboarding.toolInputCatalog.some(
        (tool) => tool.toolName === "forge_adjust_work_minutes"
      )
    );
    assert.ok(
      onboardingBody.onboarding.recommendedPluginTools.workWorkflow.includes(
        "forge_adjust_work_minutes"
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("built frontend assets are served correctly from the /forge base path", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-web-basepath-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const indexResponse = await app.inject({
      method: "GET",
      url: "/forge/"
    });
    assert.equal(indexResponse.statusCode, 200);
    assert.match(indexResponse.headers["content-type"] ?? "", /text\/html/);
    assert.match(indexResponse.body, /\/forge\/assets\//);

    const assetMatch = indexResponse.body.match(
      /src="(\/forge\/assets\/[^"]+\.js)"/
    );
    assert.ok(assetMatch);

    const assetResponse = await app.inject({
      method: "GET",
      url: assetMatch[1]!
    });
    assert.equal(assetResponse.statusCode, 200);
    assert.match(
      assetResponse.headers["content-type"] ?? "",
      /application\/javascript/
    );

    const spaRouteResponse = await app.inject({
      method: "GET",
      url: "/forge/activity"
    });
    assert.equal(spaRouteResponse.statusCode, 200);
    assert.match(spaRouteResponse.headers["content-type"] ?? "", /text\/html/);
    assert.match(spaRouteResponse.body, /<div id="root"><\/div>/);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("dev web origin proxies /forge routes through the backend", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-web-dev-redirect-")
  );
  const previousDevWebOrigin = process.env.FORGE_DEV_WEB_ORIGIN;
  const previousDevWebAutostart = process.env.FORGE_DEV_WEB_AUTOSTART;
  const devServer = http.createServer((request, response) => {
    response.statusCode = 200;
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<html><body>proxied ${request.url}</body></html>`);
  });
  await new Promise<void>((resolve) =>
    devServer.listen(0, "127.0.0.1", resolve)
  );
  const address = devServer.address();
  assert.ok(address && typeof address !== "string");
  process.env.FORGE_DEV_WEB_ORIGIN = `http://127.0.0.1:${address.port}/forge/`;
  process.env.FORGE_DEV_WEB_AUTOSTART = "0";
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/forge/settings/calendar?view=debug"
    });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"] ?? "", /text\/html/);
    assert.match(
      response.body,
      /proxied \/forge\/settings\/calendar\?view=debug/
    );
  } finally {
    if (previousDevWebOrigin === undefined) {
      delete process.env.FORGE_DEV_WEB_ORIGIN;
    } else {
      process.env.FORGE_DEV_WEB_ORIGIN = previousDevWebOrigin;
    }
    if (previousDevWebAutostart === undefined) {
      delete process.env.FORGE_DEV_WEB_AUTOSTART;
    } else {
      process.env.FORGE_DEV_WEB_AUTOSTART = previousDevWebAutostart;
    }
    await app.close();
    closeDatabase();
    await new Promise<void>((resolve, reject) =>
      devServer.close((error) => (error ? reject(error) : resolve()))
    );
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("reward rules can be updated and manual bonus XP stays explainable", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-reward-ops-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const rulesResponse = await app.inject({
      method: "GET",
      url: "/api/v1/rewards/rules",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(rulesResponse.statusCode, 200);
    const rules = (
      rulesResponse.json() as { rules: Array<{ id: string; active: boolean }> }
    ).rules;
    const ruleId = rules[0]!.id;

    const updatedResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/rewards/rules/${ruleId}`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        active: false,
        description: "Temporarily disabled in test."
      }
    });
    assert.equal(updatedResponse.statusCode, 200);
    const updatedRule = (
      updatedResponse.json() as {
        rule: { id: string; active: boolean; description: string };
      }
    ).rule;
    assert.equal(updatedRule.id, ruleId);
    assert.equal(updatedRule.active, false);
    assert.equal(updatedRule.description, "Temporarily disabled in test.");

    const bonusResponse = await app.inject({
      method: "POST",
      url: "/api/v1/rewards/bonus",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        entityType: "system",
        entityId: "manual_bonus_demo",
        deltaXp: 12,
        reasonTitle: "Operator bonus",
        reasonSummary: "Tested the manual reward grant path."
      }
    });
    assert.equal(bonusResponse.statusCode, 201);
    const bonus = bonusResponse.json() as {
      reward: { deltaXp: number; reasonTitle: string };
      metrics: { recentLedger: Array<{ reasonTitle: string }> };
    };
    assert.equal(bonus.reward.deltaXp, 12);
    assert.equal(bonus.reward.reasonTitle, "Operator bonus");
    assert.ok(
      bonus.metrics.recentLedger.some(
        (entry) => entry.reasonTitle === "Operator bonus"
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("versioned goal creation and updates persist through the API", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-goal-v1-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard"
    });
    const payload = dashboard.json() as {
      goals: Array<{ id: string; tagIds: string[] }>;
      tags: Array<{ id: string }>;
    };
    const nextTagIds = payload.tags.slice(1, 4).map((tag) => tag.id);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Build resilient energy for the next quarter",
        description: "Sharper training and recovery planning.",
        horizon: "quarter",
        status: "active",
        targetPoints: 610,
        themeColor: "#44aa88",
        tagIds: nextTagIds
      }
    });

    assert.equal(created.statusCode, 201);
    const createdGoal = (
      created.json() as {
        goal: { id: string; title: string; tagIds: string[] };
      }
    ).goal;
    assert.equal(
      createdGoal.title,
      "Build resilient energy for the next quarter"
    );
    assert.deepEqual([...createdGoal.tagIds].sort(), [...nextTagIds].sort());

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/v1/goals/${createdGoal.id}`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Build resilient energy for the next season",
        status: "paused",
        targetPoints: 720,
        tagIds: nextTagIds
      }
    });

    assert.equal(updated.statusCode, 200);
    const goal = (
      updated.json() as {
        goal: {
          title: string;
          status: string;
          targetPoints: number;
          tagIds: string[];
        };
      }
    ).goal;
    assert.equal(goal.title, "Build resilient energy for the next season");
    assert.equal(goal.status, "paused");
    assert.equal(goal.targetPoints, 720);
    assert.deepEqual([...goal.tagIds].sort(), [...nextTagIds].sort());
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("smart tag suggestions use text cues and goal context", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-tag-suggest-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const dashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard"
    });
    const payload = dashboard.json() as {
      goals: Array<{ id: string }>;
    };

    const response = await app.inject({
      method: "POST",
      url: "/api/tags/suggestions",
      payload: {
        title: "Draft next workout review",
        description: "Write the health review and training adjustments.",
        goalId: payload.goals[0]!.id,
        selectedTagIds: []
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as { suggestions: Array<{ name: string }> };
    assert.ok(body.suggestions.some((tag) => tag.name === "Vitality"));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("task updates persist metadata and tag edits through the API", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-task-update-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard"
    });
    const payload = dashboard.json() as {
      goals: Array<{ id: string }>;
      tasks: Array<{ id: string }>;
      tags: Array<{ id: string }>;
    };
    const taskId = payload.tasks[0]!.id;
    const goalId = payload.goals[1]!.id;
    const tagIds = payload.tags.slice(2, 5).map((tag) => tag.id);

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Rewrite the weekly review for clarity",
        description: "Update the goal link and tags to match the new focus.",
        owner: "Aurel",
        goalId,
        status: "blocked",
        priority: "critical",
        dueDate: "2026-04-02",
        effort: "marathon",
        energy: "high",
        points: 120,
        tagIds
      }
    });

    assert.equal(updated.statusCode, 200);
    const task = (
      updated.json() as {
        task: {
          title: string;
          owner: string;
          goalId: string | null;
          status: string;
          priority: string;
          dueDate: string | null;
          effort: string;
          energy: string;
          points: number;
          tagIds: string[];
        };
      }
    ).task;
    assert.equal(task.title, "Rewrite the weekly review for clarity");
    assert.equal(task.owner, "Aurel");
    assert.equal(task.goalId, goalId);
    assert.equal(task.status, "blocked");
    assert.equal(task.priority, "critical");
    assert.equal(task.dueDate, "2026-04-02");
    assert.equal(task.effort, "marathon");
    assert.equal(task.energy, "high");
    assert.equal(task.points, 120);
    assert.deepEqual([...task.tagIds].sort(), [...tagIds].sort());
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("versioned task context exposes evidence and task-run state for inspection", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-v1-task-context-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard"
    });
    const payload = dashboard.json() as {
      tasks: Array<{ id: string }>;
    };
    const taskId = payload.tasks[0]!.id;

    const claimed = await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/runs`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        actor: "Aurel",
        leaseTtlSeconds: 900,
        note: "Inspecting the task from the command center."
      }
    });
    assert.equal(claimed.statusCode, 201);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${taskId}/context`
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      task: { id: string };
      activeTaskRun: { actor: string; status: string } | null;
      taskRuns: Array<{ id: string }>;
      activity: Array<{ id: string }>;
    };

    assert.equal(body.task.id, taskId);
    assert.equal(body.activeTaskRun?.actor, "Aurel");
    assert.equal(body.activeTaskRun?.status, "active");
    assert.ok(body.taskRuns.length >= 1);
    assert.ok(body.activity.length >= 1);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("versioned API exposes stable reads and task-run writes for agents", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-v1-agent-surface-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const goalsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/goals"
    });
    assert.equal(goalsResponse.statusCode, 200);
    const goalsBody = goalsResponse.json() as { goals: Array<{ id: string }> };
    assert.ok(goalsBody.goals.length >= 1);

    const tagsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/tags"
    });
    assert.equal(tagsResponse.statusCode, 200);
    const tagsBody = tagsResponse.json() as { tags: Array<{ id: string }> };
    assert.ok(tagsBody.tags.length >= 1);

    const metricsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/metrics"
    });
    assert.equal(metricsResponse.statusCode, 200);
    const metricsBody = metricsResponse.json() as {
      metrics: {
        profile: { level: number };
        achievements: Array<{ id: string }>;
        milestoneRewards: Array<{ id: string }>;
      };
    };
    assert.ok(metricsBody.metrics.profile.level >= 1);
    assert.ok(metricsBody.metrics.achievements.length >= 1);
    assert.ok(metricsBody.metrics.milestoneRewards.length >= 1);

    const dashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard"
    });
    const payload = dashboard.json() as {
      tasks: Array<{ id: string }>;
    };
    const taskId = payload.tasks[0]!.id;
    const tokenResponse = await app.inject({
      method: "POST",
      url: "/api/v1/settings/tokens",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        label: "Agent surface token",
        agentLabel: "Surface Agent",
        agentType: "assistant",
        description: "Scoped write token for agent route coverage.",
        trustLevel: "trusted",
        autonomyMode: "scoped_write",
        approvalMode: "high_impact_only",
        scopes: ["read", "write"]
      }
    });
    assert.equal(tokenResponse.statusCode, 201);
    const agentToken = (tokenResponse.json() as { token: { token: string } })
      .token.token;
    const agentHeaders = {
      authorization: `Bearer ${agentToken}`,
      "x-forge-source": "agent",
      "x-forge-actor": "Surface Agent"
    };

    const claim = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${taskId}/runs`,
      headers: agentHeaders,
      payload: {
        actor: "Agent",
        leaseTtlSeconds: 900,
        note: "Claimed via versioned API."
      }
    });
    assert.equal(claim.statusCode, 201);
    const claimBody = claim.json() as {
      taskRun: { id: string; status: string };
    };
    assert.equal(claimBody.taskRun.status, "active");

    const taskRunsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/task-runs?active=true&limit=5"
    });
    assert.equal(taskRunsResponse.statusCode, 200);
    const taskRunsBody = taskRunsResponse.json() as {
      taskRuns: Array<{ id: string }>;
    };
    assert.ok(
      taskRunsBody.taskRuns.some(
        (taskRun) => taskRun.id === claimBody.taskRun.id
      )
    );

    const heartbeat = await app.inject({
      method: "POST",
      url: `/api/v1/task-runs/${claimBody.taskRun.id}/heartbeat`,
      headers: agentHeaders,
      payload: {
        actor: "Agent",
        leaseTtlSeconds: 900,
        note: "Still working."
      }
    });
    assert.equal(heartbeat.statusCode, 200);

    const release = await app.inject({
      method: "POST",
      url: `/api/v1/task-runs/${claimBody.taskRun.id}/release`,
      headers: agentHeaders,
      payload: {
        actor: "Agent",
        note: "Handing off."
      }
    });
    assert.equal(release.statusCode, 200);
    const releaseBody = release.json() as { taskRun: { status: string } };
    assert.equal(releaseBody.taskRun.status, "released");

    const activityResponse = await app.inject({
      method: "GET",
      url: "/api/v1/activity?entityType=task_run&limit=5"
    });
    assert.equal(activityResponse.statusCode, 200);
    const activityBody = activityResponse.json() as {
      activity: Array<{ entityType: string }>;
    };
    assert.ok(
      activityBody.activity.some((event) => event.entityType === "task_run")
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("versioned goal, tag, and project surfaces are available without legacy routes", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-v1-goal-tag-project-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const createdTagResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tags",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        name: "Project Layer",
        kind: "execution",
        color: "#4455aa",
        description: "Tag created through the versioned surface."
      }
    });
    assert.equal(createdTagResponse.statusCode, 201);
    const createdTag = (createdTagResponse.json() as { tag: { id: string } })
      .tag;

    const createdGoalResponse = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Ship the thesis workbench",
        description: "Create a life goal with a clear project path beneath it.",
        horizon: "quarter",
        status: "active",
        targetPoints: 480,
        themeColor: "#6688cc",
        tagIds: [createdTag.id]
      }
    });
    assert.equal(createdGoalResponse.statusCode, 201);
    const createdGoal = (
      createdGoalResponse.json() as { goal: { id: string; title: string } }
    ).goal;

    const updatedGoalResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/goals/${createdGoal.id}`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        status: "paused"
      }
    });
    assert.equal(updatedGoalResponse.statusCode, 200);
    const updatedGoal = (
      updatedGoalResponse.json() as { goal: { status: string } }
    ).goal;
    assert.equal(updatedGoal.status, "paused");

    const createdProjectResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        goalId: createdGoal.id,
        title: "Research System",
        description: "A concrete project path under the life goal.",
        status: "active",
        targetPoints: 220,
        themeColor: "#5566cc"
      }
    });
    assert.equal(createdProjectResponse.statusCode, 201);
    const createdProject = (
      createdProjectResponse.json() as {
        project: { id: string; goalId: string };
      }
    ).project;
    assert.equal(createdProject.goalId, createdGoal.id);

    const projectsResponse = await app.inject({
      method: "GET",
      url: `/api/v1/projects?goalId=${createdGoal.id}`
    });
    assert.equal(projectsResponse.statusCode, 200);
    const projectsBody = projectsResponse.json() as {
      projects: Array<{ goalId: string }>;
    };
    assert.ok(Array.isArray(projectsBody.projects));
    assert.ok(
      projectsBody.projects.some((project) => project.goalId === createdGoal.id)
    );

    const aliasResponse = await app.inject({
      method: "GET",
      url: `/api/v1/campaigns?goalId=${createdGoal.id}`
    });
    assert.equal(aliasResponse.statusCode, 200);
    assert.equal(aliasResponse.headers.deprecation, "true");
    assert.equal(aliasResponse.headers.sunset, "transitional-node");
    assert.equal(
      aliasResponse.headers.link,
      '</api/v1/projects>; rel="successor-version"'
    );
    const aliasBody = aliasResponse.json() as {
      projects: Array<{ goalId: string }>;
    };
    assert.ok(Array.isArray(aliasBody.projects));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("compatibility routes are marked deprecated and event stream metadata is explicit", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-compat-deprecation-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const compatibilityResponse = await app.inject({
      method: "GET",
      url: "/api/goals"
    });
    assert.equal(compatibilityResponse.statusCode, 200);
    assert.equal(compatibilityResponse.headers.deprecation, "true");

    const eventsMetaResponse = await app.inject({
      method: "GET",
      url: "/api/v1/events/meta"
    });
    assert.equal(eventsMetaResponse.statusCode, 200);
    const metaBody = eventsMetaResponse.json() as {
      events: { retryMs: number; events: Array<{ name: string }> };
    };
    assert.equal(metaBody.events.retryMs, 3000);
    assert.ok(
      metaBody.events.events.some((event) => event.name === "activity")
    );
    assert.ok(
      metaBody.events.events.some((event) => event.name === "heartbeat")
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("command-center context exposes derived achievements and milestone rewards", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-gamification-signals-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/context"
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      dashboard: {
        achievements: Array<{ id: string }>;
        milestoneRewards: Array<{ id: string }>;
      };
      overview: { achievements: Array<{ id: string }> };
      today: { milestoneRewards: Array<{ id: string }> };
    };

    assert.ok(body.dashboard.achievements.length >= 1);
    assert.ok(body.dashboard.milestoneRewards.length >= 1);
    assert.ok(body.overview.achievements.length >= 1);
    assert.ok(body.today.milestoneRewards.length >= 1);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("command-center context exposes first-class projects across dashboard and overview", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-project-snapshot-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/context"
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      projects: Array<{ id: string; goalId: string }>;
      dashboard: { projects: Array<{ id: string; goalId: string }> };
      overview: { projects: Array<{ id: string; goalId: string }> };
    };

    assert.ok(body.projects.length >= 1);
    assert.ok(body.dashboard.projects.length >= 1);
    assert.ok(
      body.dashboard.projects.every((project) => project.goalId.length > 0)
    );
    assert.ok(body.overview.projects.length >= 1);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("openapi document exposes schema-backed versioned contracts", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-openapi-contract-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/openapi.json"
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      openapi: string;
      components?: { schemas?: Record<string, unknown> };
      paths?: Record<string, unknown>;
    };

    assert.equal(body.openapi, "3.1.0");
    assert.ok(body.components?.schemas?.ForgeSnapshot);
    assert.ok(body.components?.schemas?.TaskContextPayload);
    assert.ok(body.components?.schemas?.ProjectSummary);
    assert.ok(body.components?.schemas?.ProjectBoardPayload);
    assert.ok(body.components?.schemas?.Habit);
    assert.ok(body.components?.schemas?.HabitCheckIn);
    assert.ok(body.components?.schemas?.InsightsPayload);
    assert.ok(body.components?.schemas?.WeeklyReviewPayload);
    assert.ok(body.components?.schemas?.SettingsPayload);
    assert.ok(body.components?.schemas?.AgentIdentity);
    assert.ok(body.components?.schemas?.AgentRuntimeReconnectPlan);
    assert.ok(body.components?.schemas?.AgentRuntimeSessionEvent);
    assert.ok(body.components?.schemas?.AgentRuntimeSession);
    assert.ok(body.components?.schemas?.AgentRuntimeSessionHistory);
    assert.ok(body.components?.schemas?.Insight);
    assert.ok(body.components?.schemas?.Domain);
    assert.ok(body.components?.schemas?.PsycheValue);
    assert.ok(body.components?.schemas?.BehaviorPattern);
    assert.ok(body.components?.schemas?.Behavior);
    assert.ok(body.components?.schemas?.BeliefEntry);
    assert.ok(body.components?.schemas?.SchemaCatalogEntry);
    const schemaCatalogEntry = body.components?.schemas?.SchemaCatalogEntry as {
      properties?: { schemaType?: { enum?: string[] } };
    };
    assert.deepEqual(schemaCatalogEntry.properties?.schemaType?.enum, [
      "maladaptive",
      "adaptive"
    ]);
    assert.ok(body.components?.schemas?.ModeProfile);
    assert.ok(body.components?.schemas?.ModeGuideSession);
    assert.ok(body.components?.schemas?.EventType);
    assert.ok(body.components?.schemas?.EmotionDefinition);
    assert.ok(body.components?.schemas?.TriggerReport);
    assert.ok(body.components?.schemas?.Note);
    assert.ok(body.components?.schemas?.PsycheOverviewPayload);
    assert.ok(body.components?.schemas?.ApprovalRequest);
    assert.ok(body.components?.schemas?.RewardLedgerEvent);
    assert.ok(body.components?.schemas?.XpMetricsPayload);
    assert.ok(body.paths?.["/api/v1/context"]);
    assert.ok(body.paths?.["/api/v1/operator/context"]);
    assert.ok(body.paths?.["/api/v1/operator/overview"]);
    assert.ok(body.paths?.["/api/v1/agents/sessions"]);
    assert.ok(body.paths?.["/api/v1/agents/sessions/heartbeat"]);
    assert.ok(body.paths?.["/api/v1/agents/sessions/events"]);
    assert.ok(body.paths?.["/api/v1/agents/sessions/{id}/history"]);
    assert.ok(body.paths?.["/api/v1/agents/sessions/{id}/reconnect"]);
    assert.ok(body.paths?.["/api/v1/agents/sessions/{id}/disconnect"]);
    assert.ok(body.paths?.["/api/v1/domains"]);
    assert.ok(body.paths?.["/api/v1/psyche/overview"]);
    assert.ok(body.paths?.["/api/v1/psyche/values"]);
    assert.ok(body.paths?.["/api/v1/psyche/values/{id}"]);
    assert.ok(body.paths?.["/api/v1/psyche/patterns"]);
    assert.ok(body.paths?.["/api/v1/psyche/patterns/{id}"]);
    assert.ok(body.paths?.["/api/v1/psyche/behaviors"]);
    assert.ok(body.paths?.["/api/v1/psyche/behaviors/{id}"]);
    assert.ok(body.paths?.["/api/v1/psyche/schema-catalog"]);
    assert.ok(body.paths?.["/api/v1/psyche/beliefs"]);
    assert.ok(body.paths?.["/api/v1/psyche/beliefs/{id}"]);
    assert.ok(body.paths?.["/api/v1/psyche/modes"]);
    assert.ok(body.paths?.["/api/v1/psyche/modes/{id}"]);
    assert.ok(body.paths?.["/api/v1/psyche/mode-guides"]);
    assert.ok(body.paths?.["/api/v1/psyche/mode-guides/{id}"]);
    assert.ok(body.paths?.["/api/v1/psyche/event-types"]);
    assert.ok(body.paths?.["/api/v1/psyche/event-types/{id}"]);
    assert.ok(body.paths?.["/api/v1/psyche/emotions"]);
    assert.ok(body.paths?.["/api/v1/psyche/emotions/{id}"]);
    assert.ok(body.paths?.["/api/v1/psyche/reports"]);
    assert.ok(body.paths?.["/api/v1/psyche/reports/{id}"]);
    assert.ok(body.paths?.["/api/v1/life-force"]);
    assert.ok(body.paths?.["/api/v1/movement/day"]);
    assert.ok(body.paths?.["/api/v1/movement/timeline"]);
    assert.ok(body.paths?.["/api/v1/workbench/flows"]);
    assert.ok(body.paths?.["/api/v1/notes"]);
    assert.ok(body.paths?.["/api/v1/notes/{id}"]);
    assert.ok(body.paths?.["/api/v1/health/sleep"]);
    assert.ok(body.paths?.["/api/v1/health/sleep/{id}"]);
    assert.ok(body.paths?.["/api/v1/health/fitness"]);
    assert.ok(body.paths?.["/api/v1/health/workouts"]);
    assert.ok(body.paths?.["/api/v1/health/workouts/{id}"]);
    assert.ok(body.paths?.["/api/v1/habits"]);
    assert.ok(body.paths?.["/api/v1/habits/{id}"]);
    assert.ok(body.paths?.["/api/v1/habits/{id}/check-ins"]);
    assert.ok(body.paths?.["/api/v1/habits/{id}/check-ins/{dateKey}"]);
    const habitCheckInOperation = body.paths?.["/api/v1/habits/{id}/check-ins"] as
      | {
          post?: {
            requestBody?: {
              content?: {
                "application/json"?: { schema?: { $ref?: string } };
              };
            };
          };
        }
      | undefined;
    assert.equal(
      habitCheckInOperation?.post?.requestBody?.content?.["application/json"]
        ?.schema?.$ref,
      "#/components/schemas/HabitCheckInInput"
    );
    const habitCheckInInputSchema = body.components?.schemas?.HabitCheckInInput as
      | { properties?: Record<string, { description?: string }> }
      | undefined;
    assert.match(
      habitCheckInInputSchema?.properties?.description?.description ?? "",
      /overwrites habit\.description/
    );
    assert.ok(body.paths?.["/api/v1/tags"]);
    assert.ok(body.paths?.["/api/v1/tags/{id}"]);
    assert.ok(body.paths?.["/api/v1/projects"]);
    assert.ok(body.paths?.["/api/v1/projects/{id}"]);
    assert.ok(body.paths?.["/api/v1/projects/{id}/board"]);
    const projectPatchOperation = body.paths?.["/api/v1/projects/{id}"] as {
      patch?: { description?: string };
      delete?: { description?: string };
    };
    assert.match(
      projectPatchOperation.patch?.description ?? "",
      /status-driven/
    );
    assert.match(
      projectPatchOperation.patch?.description ?? "",
      /auto-completes linked unfinished tasks/
    );
    assert.match(
      projectPatchOperation.delete?.description ?? "",
      /soft delete/
    );
    const lifeForceGet = body.paths?.["/api/v1/life-force"] as
      | { get?: { tags?: string[] } }
      | undefined;
    const movementDayGet = body.paths?.["/api/v1/movement/day"] as
      | { get?: { tags?: string[] } }
      | undefined;
    const workbenchFlows = body.paths?.["/api/v1/workbench/flows"] as
      | { get?: { tags?: string[] }; post?: { tags?: string[] } }
      | undefined;
    assert.deepEqual(lifeForceGet?.get?.tags, ["Life Force"]);
    assert.deepEqual(movementDayGet?.get?.tags, ["Movement"]);
    assert.deepEqual(workbenchFlows?.get?.tags, ["Workbench"]);
    assert.deepEqual(workbenchFlows?.post?.tags, ["Workbench"]);
    assert.ok(body.paths?.["/api/v1/tasks/{id}/context"]);
    assert.ok(body.paths?.["/api/v1/tasks/{id}/uncomplete"]);
    assert.ok(body.paths?.["/api/v1/activity/{id}/remove"]);
    assert.ok(body.paths?.["/api/v1/metrics"]);
    assert.ok(body.paths?.["/api/v1/metrics/xp"]);
    assert.ok(body.paths?.["/api/v1/insights"]);
    assert.ok(body.paths?.["/api/v1/insights/{id}"]);
    assert.ok(body.paths?.["/api/v1/insights/{id}/feedback"]);
    assert.ok(body.paths?.["/api/v1/settings/bin"]);
    assert.ok(body.paths?.["/api/v1/entities/create"]);
    assert.ok(body.paths?.["/api/v1/entities/update"]);
    assert.ok(body.paths?.["/api/v1/entities/delete"]);
    assert.ok(body.paths?.["/api/v1/entities/restore"]);
    assert.ok(body.paths?.["/api/v1/entities/search"]);
    assert.ok(body.paths?.["/api/v1/calendar/events"]);
    assert.ok(body.paths?.["/api/v1/calendar/events/{id}"]);
    assert.ok(body.paths?.["/api/v1/calendar/work-block-templates/{id}"]);
    assert.ok(body.paths?.["/api/v1/calendar/timeboxes/{id}"]);
    assert.ok(body.paths?.["/api/v1/preferences/catalogs"]);
    assert.ok(body.paths?.["/api/v1/preferences/catalogs/{id}"]);
    assert.ok(body.paths?.["/api/v1/preferences/catalog-items"]);
    assert.ok(body.paths?.["/api/v1/preferences/catalog-items/{id}"]);
    assert.ok(body.paths?.["/api/v1/preferences/contexts"]);
    assert.ok(body.paths?.["/api/v1/preferences/contexts/{id}"]);
    assert.ok(body.paths?.["/api/v1/preferences/items"]);
    assert.ok(body.paths?.["/api/v1/preferences/items/{id}"]);
    assert.ok(body.paths?.["/api/v1/psyche/questionnaires/{id}"]);
    assert.ok(body.paths?.["/api/v1/approval-requests"]);
    assert.ok(body.paths?.["/api/v1/agent-actions"]);
    assert.ok(body.paths?.["/api/v1/rewards/rules"]);
    assert.ok(body.paths?.["/api/v1/rewards/ledger"]);
    assert.ok(body.paths?.["/api/v1/events"]);
    assert.ok(body.paths?.["/api/v1/session-events"]);
    assert.ok(body.paths?.["/api/v1/reviews/weekly"]);
    assert.ok(body.paths?.["/api/v1/settings"]);
    assert.ok(body.paths?.["/api/v1/settings/tokens"]);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("versioned CRUD routes support get, update, and delete for tags, notes, tasks, projects, and goals", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-versioned-crud-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const goalResponse = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Delete-me goal",
        description: "Exercise the full CRUD API surface.",
        horizon: "quarter",
        status: "active",
        targetPoints: 240,
        themeColor: "#5d88aa",
        tagIds: []
      }
    });
    assert.equal(goalResponse.statusCode, 201);
    const goalId = (goalResponse.json() as { goal: { id: string } }).goal.id;

    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        goalId,
        title: "Delete-me project",
        description: "Project scoped to CRUD coverage.",
        status: "active",
        targetPoints: 180,
        themeColor: "#6688cc"
      }
    });
    assert.equal(projectResponse.statusCode, 201);
    const projectId = (projectResponse.json() as { project: { id: string } })
      .project.id;

    const tagResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tags",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        name: "CRUD tag",
        kind: "execution",
        color: "#556677",
        description: "Used to verify tag CRUD."
      }
    });
    assert.equal(tagResponse.statusCode, 201);
    const tagId = (tagResponse.json() as { tag: { id: string } }).tag.id;

    const tagGetResponse = await app.inject({
      method: "GET",
      url: `/api/v1/tags/${tagId}`
    });
    assert.equal(tagGetResponse.statusCode, 200);

    const tagPatchResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/tags/${tagId}`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        description: "Updated tag description."
      }
    });
    assert.equal(tagPatchResponse.statusCode, 200);

    const taskResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Delete-me task",
        description: "Task scoped to CRUD coverage.",
        status: "focus",
        priority: "medium",
        owner: "Albert",
        goalId,
        projectId,
        dueDate: null,
        effort: "deep",
        energy: "steady",
        points: 35,
        tagIds: [tagId]
      }
    });
    assert.equal(taskResponse.statusCode, 201);
    const taskId = (taskResponse.json() as { task: { id: string } }).task.id;

    const tagDeleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/tags/${tagId}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(tagDeleteResponse.statusCode, 200);

    const taskAfterTagDelete = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${taskId}`
    });
    assert.equal(taskAfterTagDelete.statusCode, 200);
    assert.deepEqual(
      (taskAfterTagDelete.json() as { task: { tagIds: string[] } }).task.tagIds,
      []
    );

    const noteResponse = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        contentMarkdown: "CRUD note body",
        author: "Albert",
        links: [{ entityType: "task", entityId: taskId, anchorKey: null }]
      }
    });
    assert.equal(noteResponse.statusCode, 201);
    const noteId = (noteResponse.json() as { note: { id: string } }).note.id;

    const noteGetResponse = await app.inject({
      method: "GET",
      url: `/api/v1/notes/${noteId}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(noteGetResponse.statusCode, 200);

    const notePatchResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/notes/${noteId}`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        contentMarkdown: "CRUD note body updated"
      }
    });
    assert.equal(notePatchResponse.statusCode, 200);

    const noteDeleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/notes/${noteId}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(noteDeleteResponse.statusCode, 200);

    const deletedNoteGet = await app.inject({
      method: "GET",
      url: `/api/v1/notes/${noteId}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(deletedNoteGet.statusCode, 404);

    const taskDeleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/tasks/${taskId}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(taskDeleteResponse.statusCode, 200);

    const deletedTaskGet = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${taskId}`
    });
    assert.equal(deletedTaskGet.statusCode, 404);

    const projectDeleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${projectId}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(projectDeleteResponse.statusCode, 200);

    const deletedProjectGet = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}`
    });
    assert.equal(deletedProjectGet.statusCode, 404);

    const goalDeleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/goals/${goalId}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(goalDeleteResponse.statusCode, 200);

    const deletedGoalGet = await app.inject({
      method: "GET",
      url: `/api/v1/goals/${goalId}`
    });
    assert.equal(deletedGoalGet.statusCode, 404);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("project lifecycle patching suspends, finishes, restarts, and keeps finish idempotent", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-project-lifecycle-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const goalResponse = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: { cookie: operatorCookie },
      payload: {
        title: "Ship a durable project lifecycle",
        description: "Verify suspend, finish, and restart behavior.",
        horizon: "quarter",
        status: "active",
        targetPoints: 300,
        themeColor: "#4f7cd8",
        tagIds: []
      }
    });
    const goalId = (goalResponse.json() as { goal: { id: string } }).goal.id;

    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { cookie: operatorCookie },
      payload: {
        goalId,
        title: "Lifecycle coverage project",
        description: "A project used to verify lifecycle side effects.",
        status: "active",
        targetPoints: 180,
        themeColor: "#5577cc"
      }
    });
    assert.equal(projectResponse.statusCode, 201);
    const projectId = (projectResponse.json() as { project: { id: string } })
      .project.id;

    const createTask = async (title: string, status: "backlog" | "focus") => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/tasks",
        headers: { cookie: operatorCookie },
        payload: {
          title,
          description: "Project-linked task for lifecycle coverage.",
          status,
          priority: "medium",
          owner: "Aurel",
          goalId,
          projectId,
          dueDate: null,
          effort: "deep",
          energy: "steady",
          points: 25,
          tagIds: []
        }
      });
      assert.equal(response.statusCode, 201);
      return (response.json() as { task: { id: string } }).task.id;
    };

    const taskOneId = await createTask("Lifecycle task one", "focus");
    const taskTwoId = await createTask("Lifecycle task two", "backlog");

    const pauseResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: operatorCookie },
      payload: { status: "paused" }
    });
    assert.equal(pauseResponse.statusCode, 200);
    assert.equal(
      (pauseResponse.json() as { project: { status: string } }).project.status,
      "paused"
    );

    const pausedTask = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${taskOneId}`
    });
    const pausedTaskBody = pausedTask.json() as { task: { status: string } };
    assert.equal(pausedTaskBody.task.status, "focus");

    const finishResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: operatorCookie },
      payload: { status: "completed" }
    });
    assert.equal(finishResponse.statusCode, 200);
    assert.equal(
      (finishResponse.json() as { project: { status: string } }).project.status,
      "completed"
    );

    const finishedTaskOne = (
      await app.inject({ method: "GET", url: `/api/v1/tasks/${taskOneId}` })
    ).json() as {
      task: { status: string; completedAt: string | null };
    };
    const finishedTaskTwo = (
      await app.inject({ method: "GET", url: `/api/v1/tasks/${taskTwoId}` })
    ).json() as {
      task: { status: string; completedAt: string | null };
    };
    assert.equal(finishedTaskOne.task.status, "done");
    assert.equal(finishedTaskTwo.task.status, "done");
    assert.ok(finishedTaskOne.task.completedAt);
    assert.ok(finishedTaskTwo.task.completedAt);

    const activityAfterFinish = await app.inject({
      method: "GET",
      url: "/api/v1/activity?limit=100"
    });
    const activityAfterFinishBody = activityAfterFinish.json() as {
      activity: Array<{
        entityType: string;
        entityId: string;
        eventType: string;
      }>;
    };
    const taskCompletionEventsAfterFinish =
      activityAfterFinishBody.activity.filter(
        (event) =>
          event.entityType === "task" &&
          event.eventType === "task_completed" &&
          (event.entityId === taskOneId || event.entityId === taskTwoId)
      );
    assert.equal(taskCompletionEventsAfterFinish.length, 2);

    const finishAgainResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: operatorCookie },
      payload: { status: "completed" }
    });
    assert.equal(finishAgainResponse.statusCode, 200);

    const activityAfterSecondFinish = await app.inject({
      method: "GET",
      url: "/api/v1/activity?limit=100"
    });
    const activityAfterSecondFinishBody = activityAfterSecondFinish.json() as {
      activity: Array<{
        entityType: string;
        entityId: string;
        eventType: string;
      }>;
    };
    const taskCompletionEventsAfterSecondFinish =
      activityAfterSecondFinishBody.activity.filter(
        (event) =>
          event.entityType === "task" &&
          event.eventType === "task_completed" &&
          (event.entityId === taskOneId || event.entityId === taskTwoId)
      );
    assert.equal(taskCompletionEventsAfterSecondFinish.length, 2);

    const restartResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${projectId}`,
      headers: { cookie: operatorCookie },
      payload: { status: "active" }
    });
    assert.equal(restartResponse.statusCode, 200);
    assert.equal(
      (restartResponse.json() as { project: { status: string } }).project
        .status,
      "active"
    );

    const restartedTask = await app.inject({
      method: "GET",
      url: `/api/v1/tasks/${taskOneId}`
    });
    const restartedTaskBody = restartedTask.json() as {
      task: { status: string };
    };
    assert.equal(restartedTaskBody.task.status, "done");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("project delete routes support soft delete, restore, and hard delete", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-project-delete-modes-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const goalResponse = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: { cookie: operatorCookie },
      payload: {
        title: "Delete mode goal",
        description: "Exercise project delete modes.",
        horizon: "quarter",
        status: "active",
        targetPoints: 300,
        themeColor: "#4d79b8",
        tagIds: []
      }
    });
    const goalId = (goalResponse.json() as { goal: { id: string } }).goal.id;

    const createProject = async (title: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/projects",
        headers: { cookie: operatorCookie },
        payload: {
          goalId,
          title,
          description: "Delete mode coverage project.",
          status: "active",
          targetPoints: 120,
          themeColor: "#5d83cc"
        }
      });
      assert.equal(response.statusCode, 201);
      return (response.json() as { project: { id: string } }).project.id;
    };

    const softProjectId = await createProject("Soft delete project");
    const hardProjectId = await createProject("Hard delete project");

    const softDeleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${softProjectId}`,
      headers: { cookie: operatorCookie }
    });
    assert.equal(softDeleteResponse.statusCode, 200);

    const hardDeleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${hardProjectId}?mode=hard`,
      headers: { cookie: operatorCookie }
    });
    assert.equal(hardDeleteResponse.statusCode, 200);

    const binResponse = await app.inject({
      method: "GET",
      url: "/api/v1/settings/bin",
      headers: { cookie: operatorCookie }
    });
    assert.equal(binResponse.statusCode, 200);
    const binBody = binResponse.json() as {
      bin: { records: Array<{ entityType: string; entityId: string }> };
    };
    assert.ok(
      binBody.bin.records.some(
        (record) =>
          record.entityType === "project" && record.entityId === softProjectId
      )
    );
    assert.ok(
      !binBody.bin.records.some(
        (record) =>
          record.entityType === "project" && record.entityId === hardProjectId
      )
    );

    const restoreResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/restore",
      headers: { cookie: operatorCookie },
      payload: {
        operations: [{ entityType: "project", id: softProjectId }]
      }
    });
    assert.equal(restoreResponse.statusCode, 200);
    const restoredProject = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${softProjectId}`
    });
    assert.equal(restoredProject.statusCode, 200);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("habit soft delete hides the habit from list and direct reads while keeping it in the bin", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-habit-delete-modes-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const habitId = createHabit({
      title: "Sleep before 11",
      description: "Delete coverage habit.",
      status: "active",
      polarity: "positive",
      frequency: "daily",
      targetCount: 1,
      weekDays: [],
      linkedGoalIds: [],
      linkedProjectIds: [],
      linkedTaskIds: [],
      linkedValueIds: [],
      linkedPatternIds: [],
      linkedBehaviorIds: [],
      linkedBehaviorId: null,
      linkedBeliefIds: [],
      linkedModeIds: [],
      linkedReportIds: [],
      rewardXp: 5,
      penaltyXp: 2,
      generatedHealthEventTemplate: {
        enabled: false,
        workoutType: "workout",
        title: "",
        durationMinutes: 45,
        xpReward: 0,
        tags: [],
        links: [],
        notesTemplate: ""
      }
    }).id;

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/habits/${habitId}`,
      headers: { cookie: operatorCookie }
    });
    assert.equal(deleteResponse.statusCode, 200);

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/v1/habits"
    });
    assert.equal(listResponse.statusCode, 200);
    const listBody = listResponse.json() as {
      habits: Array<{ id: string }>;
    };
    assert.equal(
      listBody.habits.some((habit) => habit.id === habitId),
      false
    );

    const getResponse = await app.inject({
      method: "GET",
      url: `/api/v1/habits/${habitId}`
    });
    assert.equal(getResponse.statusCode, 404);

    const binResponse = await app.inject({
      method: "GET",
      url: "/api/v1/settings/bin",
      headers: { cookie: operatorCookie }
    });
    assert.equal(binResponse.statusCode, 200);
    const binBody = binResponse.json() as {
      bin: { records: Array<{ entityType: string; entityId: string }> };
    };
    assert.ok(
      binBody.bin.records.some(
        (record) => record.entityType === "habit" && record.entityId === habitId
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("completed tasks can be reopened and lose their completion XP", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-uncomplete-task-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const tasksResponse = await app.inject({
      method: "GET",
      url: "/api/v1/tasks?limit=1"
    });
    const taskId = (tasksResponse.json() as { tasks: Array<{ id: string }> })
      .tasks[0]!.id;

    const completeResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${taskId}`,
      headers: {
        cookie: operatorCookie
      },
      payload: { status: "done" }
    });
    assert.equal(completeResponse.statusCode, 200);

    const metricsAfterComplete = await app.inject({
      method: "GET",
      url: "/api/v1/context"
    });
    const xpAfterComplete = (
      metricsAfterComplete.json() as { metrics: { totalXp: number } }
    ).metrics.totalXp;

    const reopenResponse = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${taskId}/uncomplete`,
      headers: {
        cookie: operatorCookie
      },
      payload: {}
    });
    assert.equal(reopenResponse.statusCode, 200);
    const reopenedTask = (
      reopenResponse.json() as {
        task: { status: string; completedAt: string | null };
      }
    ).task;
    assert.notEqual(reopenedTask.status, "done");
    assert.equal(reopenedTask.completedAt, null);

    const metricsAfterReopen = await app.inject({
      method: "GET",
      url: "/api/v1/context"
    });
    const xpAfterReopen = (
      metricsAfterReopen.json() as { metrics: { totalXp: number } }
    ).metrics.totalXp;
    assert.ok(xpAfterReopen < xpAfterComplete);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("domains endpoint exposes psyche as a sensitive first-class domain", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-domains-psyche-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/domains"
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      domains: Array<{ slug: string; sensitive: boolean }>;
    };
    assert.ok(
      body.domains.some(
        (domain) => domain.slug === "psyche" && domain.sensitive === true
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("trigger reports persist structured CBT fields and earn bounded reflection XP", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-trigger-report-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/reports",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Silence after a vulnerable message",
        status: "draft",
        eventSituation:
          "I sent an emotionally open message and then saw no reply for several hours.",
        occurredAt: "2026-03-23T19:30:00.000Z",
        emotions: [
          { id: "emotion_1", label: "fear", intensity: 82, note: "tight chest" }
        ],
        thoughts: [
          {
            id: "thought_1",
            text: "I am being abandoned",
            parentMode: "demanding parent",
            criticMode: "inner critic"
          }
        ],
        behaviors: [
          {
            id: "behavior_1",
            text: "checked the phone repeatedly",
            mode: "vulnerable child"
          }
        ],
        consequences: {
          selfShortTerm: ["temporary monitoring relief"],
          selfLongTerm: ["more attachment panic"],
          othersShortTerm: ["pressure in the interaction"],
          othersLongTerm: ["less trust and spontaneity"]
        },
        linkedPatternIds: [],
        linkedValueIds: [],
        linkedGoalIds: [],
        linkedProjectIds: [],
        linkedTaskIds: [],
        modeOverlays: ["vulnerable child"],
        schemaLinks: ["abandonment"],
        nextMoves: ["wait thirty minutes before reopening the thread"]
      }
    });

    assert.equal(created.statusCode, 201);
    const reportId = (created.json() as { report: { id: string } }).report.id;

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/psyche/reports/${reportId}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(detail.statusCode, 200);
    const detailBody = detail.json() as {
      report: {
        emotions: Array<{ label: string; intensity: number }>;
        thoughts: Array<{ text: string }>;
        behaviors: Array<{ text: string }>;
        consequences: { selfLongTerm: string[] };
      };
    };

    assert.equal(detailBody.report.emotions[0]?.label, "fear");
    assert.equal(detailBody.report.emotions[0]?.intensity, 82);
    assert.equal(detailBody.report.thoughts[0]?.text, "I am being abandoned");
    assert.equal(
      detailBody.report.behaviors[0]?.text,
      "checked the phone repeatedly"
    );
    assert.ok(
      detailBody.report.consequences.selfLongTerm.includes(
        "more attachment panic"
      )
    );

    const rewards = await app.inject({
      method: "GET",
      url: `/api/v1/rewards/ledger?entityType=trigger_report&entityId=${reportId}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(rewards.statusCode, 200);
    const rewardsBody = rewards.json() as {
      ledger: Array<{ deltaXp: number; reasonTitle: string }>;
    };
    assert.ok(
      rewardsBody.ledger.some(
        (event) =>
          event.deltaXp > 0 &&
          event.reasonTitle.includes("Psyche reflection captured")
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("habits persist with check-ins and XP updates through the versioned API", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-habits-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const goalId = await app
      .inject({ method: "GET", url: "/api/v1/goals" })
      .then(
        (response) =>
          (response.json() as { goals: Array<{ id: string }> }).goals[0]!.id
      );
    const projectId = await app
      .inject({ method: "GET", url: "/api/v1/projects" })
      .then(
        (response) =>
          (response.json() as { projects: Array<{ id: string }> }).projects[0]!
            .id
      );
    const taskId = await app
      .inject({ method: "GET", url: "/api/v1/tasks?limit=1" })
      .then(
        (response) =>
          (response.json() as { tasks: Array<{ id: string }> }).tasks[0]!.id
      );

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/habits",
      headers: { cookie: operatorCookie },
      payload: {
        title: "Phone stays outside the bed zone",
        description: "Treat bedtime as a protected recovery habit.",
        polarity: "positive",
        frequency: "daily",
        targetCount: 1,
        linkedGoalIds: [goalId],
        linkedProjectIds: [projectId],
        linkedTaskIds: [taskId],
        generatedHealthEventTemplate: {
          enabled: true,
          workoutType: "recovery_walk",
          title: "Morning sport routine",
          durationMinutes: 35,
          xpReward: 11,
          tags: ["habit-generated", "recovery"],
          links: [],
          notesTemplate: "Generated from the morning sport routine habit."
        },
        rewardXp: 14,
        penaltyXp: 9
      }
    });

    assert.equal(created.statusCode, 201);
    const createdHabit = (
      created.json() as {
        habit: {
          id: string;
          linkedBehaviorId: string | null;
          linkedGoalIds: string[];
          linkedProjectIds: string[];
          linkedTaskIds: string[];
        };
      }
    ).habit;
    assert.equal(createdHabit.linkedBehaviorId, null);
    assert.deepEqual(createdHabit.linkedGoalIds, [goalId]);
    assert.deepEqual(createdHabit.linkedProjectIds, [projectId]);
    assert.deepEqual(createdHabit.linkedTaskIds, [taskId]);

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/v1/habits/${createdHabit.id}`,
      headers: { cookie: operatorCookie },
      payload: {
        frequency: "weekly",
        weekDays: [1, 3, 5],
        linkedTaskIds: []
      }
    });
    assert.equal(updated.statusCode, 200);
    const updatedHabit = (
      updated.json() as {
        habit: {
          frequency: string;
          weekDays: number[];
          linkedTaskIds: string[];
        };
      }
    ).habit;
    assert.equal(updatedHabit.frequency, "weekly");
    assert.deepEqual(updatedHabit.weekDays, [1, 3, 5]);
    assert.deepEqual(updatedHabit.linkedTaskIds, []);

    const checkIn = await app.inject({
      method: "POST",
      url: `/api/v1/habits/${createdHabit.id}/check-ins`,
      headers: { cookie: operatorCookie },
      payload: {
        dateKey: "2026-03-30",
        status: "done",
        description: "Bedtime means the phone stays in another room."
      }
    });
    assert.equal(checkIn.statusCode, 200);
    const checkInBody = checkIn.json() as {
      habit: {
        description: string;
        lastCheckInStatus: string | null;
        completionRate: number;
        checkIns: Array<{ dateKey: string; deltaXp: number }>;
      };
      metrics: {
        recentLedger: Array<{
          entityType: string;
          entityId: string;
          deltaXp: number;
        }>;
      };
    };
    assert.equal(
      checkInBody.habit.description,
      "Bedtime means the phone stays in another room."
    );
    assert.equal(checkInBody.habit.lastCheckInStatus, "done");
    assert.ok(checkInBody.habit.completionRate >= 100);
    assert.equal(checkInBody.habit.checkIns[0]?.dateKey, "2026-03-30");
    assert.ok(checkInBody.habit.checkIns[0]?.deltaXp > 0);
    assert.ok(
      checkInBody.metrics.recentLedger.some(
        (entry) =>
          entry.entityType === "habit" && entry.entityId === createdHabit.id
      )
    );
    assert.ok(
      checkInBody.metrics.recentLedger.some(
        (entry) =>
          entry.entityType === "habit" &&
          entry.entityId === createdHabit.id &&
          entry.deltaXp === 11
      )
    );

    const deletedCheckIn = await app.inject({
      method: "DELETE",
      url: `/api/v1/habits/${createdHabit.id}/check-ins/2026-03-30`,
      headers: { cookie: operatorCookie }
    });
    assert.equal(deletedCheckIn.statusCode, 200);
    const deletedCheckInBody = deletedCheckIn.json() as {
      habit: {
        checkIns: Array<{ dateKey: string }>;
      };
      metrics: {
        recentLedger: Array<{
          entityType: string;
          entityId: string;
          deltaXp: number;
        }>;
      };
    };
    assert.equal(deletedCheckInBody.habit.checkIns.length, 0);
    assert.ok(
      deletedCheckInBody.metrics.recentLedger.some(
        (entry) =>
          entry.entityType === "habit" &&
          entry.entityId === createdHabit.id &&
          entry.deltaXp < 0
      )
    );

    const fitness = await app.inject({
      method: "GET",
      url: "/api/v1/health/fitness"
    });
    assert.equal(fitness.statusCode, 200);
    const fitnessBody = fitness.json() as {
      fitness: {
        sessions: Array<{
          workoutType: string;
          source: string;
          reconciliationStatus: string;
          generatedFromHabitId: string | null;
        }>;
      };
    };
    assert.ok(
      fitnessBody.fitness.sessions.some(
        (session) =>
          session.workoutType === "recovery_walk" &&
          session.source === "forge_habit" &&
          session.reconciliationStatus === "awaiting_import_match" &&
          session.generatedFromHabitId === createdHabit.id
      )
    );

    const listed = await app.inject({ method: "GET", url: "/api/v1/habits" });
    assert.equal(listed.statusCode, 200);
    const listedBody = listed.json() as { habits: Array<{ id: string }> };
    assert.ok(listedBody.habits.some((habit) => habit.id === createdHabit.id));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("misaligned habit penalties do not break the context payload", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-habit-context-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/habits",
      headers: { cookie: operatorCookie },
      payload: {
        title: "Avoid late-night doomscrolling",
        description: "Treat late-night scrolling as a recovery risk.",
        polarity: "positive",
        frequency: "daily",
        targetCount: 1,
        rewardXp: 3,
        penaltyXp: 11
      }
    });

    assert.equal(created.statusCode, 201);
    const habitId = (created.json() as { habit: { id: string } }).habit.id;

    const checkIn = await app.inject({
      method: "POST",
      url: `/api/v1/habits/${habitId}/check-ins`,
      headers: { cookie: operatorCookie },
      payload: {
        dateKey: "2026-04-06",
        status: "missed"
      }
    });

    assert.equal(checkIn.statusCode, 200);
    const checkInBody = checkIn.json() as {
      habit: {
        checkIns: Array<{ deltaXp: number }>;
      };
      metrics: {
        profile: {
          totalXp: number;
          weeklyXp: number;
        };
        recentLedger: Array<{
          entityType: string;
          entityId: string;
          deltaXp: number;
        }>;
      };
    };
    assert.equal(checkInBody.habit.checkIns[0]?.deltaXp, -11);
    assert.equal(checkInBody.metrics.profile.totalXp, 0);
    assert.equal(checkInBody.metrics.profile.weeklyXp, 0);
    assert.ok(
      checkInBody.metrics.recentLedger.some(
        (entry) =>
          entry.entityType === "habit" &&
          entry.entityId === habitId &&
          entry.deltaXp === -11
      )
    );

    const contextResponse = await app.inject({
      method: "GET",
      url: "/api/v1/context",
      headers: { cookie: operatorCookie }
    });

    assert.equal(contextResponse.statusCode, 200);
    const contextBody = contextResponse.json() as {
      metrics: {
        totalXp: number;
        weeklyXp: number;
      };
    };
    assert.equal(contextBody.metrics.totalXp, 0);
    assert.equal(contextBody.metrics.weeklyXp, 0);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("habit list supports explicit ordering modes", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-habit-ordering-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const alphaResponse = await app.inject({
      method: "POST",
      url: "/api/v1/habits",
      headers: { cookie: operatorCookie },
      payload: {
        title: "Alpha stretch",
        frequency: "daily",
        polarity: "positive",
        targetCount: 1
      }
    });
    assert.equal(alphaResponse.statusCode, 201);
    const alphaHabit = (alphaResponse.json() as { habit: { id: string } })
      .habit;

    const zenResponse = await app.inject({
      method: "POST",
      url: "/api/v1/habits",
      headers: { cookie: operatorCookie },
      payload: {
        title: "Zen walk",
        frequency: "daily",
        polarity: "positive",
        targetCount: 1
      }
    });
    assert.equal(zenResponse.statusCode, 201);
    const zenHabit = (zenResponse.json() as { habit: { id: string } }).habit;

    const orderByName = await app.inject({
      method: "GET",
      url: "/api/v1/habits?orderBy=name"
    });
    assert.equal(orderByName.statusCode, 200);
    const orderByNameBody = orderByName.json() as {
      habits: Array<{ id: string; title: string }>;
    };
    assert.deepEqual(
      orderByNameBody.habits.slice(0, 2).map((habit) => habit.title),
      ["Alpha stretch", "Zen walk"]
    );

    await app.inject({
      method: "POST",
      url: `/api/v1/habits/${zenHabit.id}/check-ins`,
      headers: { cookie: operatorCookie },
      payload: {
        dateKey: "2026-04-10",
        status: "done"
      }
    });

    const orderByAttention = await app.inject({
      method: "GET",
      url: "/api/v1/habits?orderBy=needs_attention"
    });
    assert.equal(orderByAttention.statusCode, 200);
    const orderByAttentionBody = orderByAttention.json() as {
      habits: Array<{ id: string }>;
    };
    assert.equal(orderByAttentionBody.habits[0]?.id, alphaHabit.id);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("habit streaks use consecutive cadence windows instead of raw aligned check-in counts", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-habit-streak-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });
  const RealDate = Date;
  const fixedNow = new RealDate("2026-04-09T12:00:00.000Z");

  class MockDate extends RealDate {
    constructor(
      ...value:
        | []
        | [string | number | Date]
        | [number, number, number?, number?, number?, number?, number?]
    ) {
      if (value.length === 0) {
        super(fixedNow.toISOString());
      } else if (value.length === 1) {
        super(value[0]);
      } else {
        const [year, month, date, hours, minutes, seconds, ms] = value;
        switch (value.length) {
          case 2:
            super(year, month);
            break;
          case 3:
            super(year, month, date);
            break;
          case 4:
            super(year, month, date, hours);
            break;
          case 5:
            super(year, month, date, hours, minutes);
            break;
          case 6:
            super(year, month, date, hours, minutes, seconds);
            break;
          default:
            super(year, month, date, hours, minutes, seconds, ms);
        }
      }
    }

    static now() {
      return fixedNow.getTime();
    }
  }

  // Keep streak expectations stable regardless of the machine's real date.
  globalThis.Date = MockDate as DateConstructor;

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const createHabitResponse = async (
      title: string,
      polarity: "positive" | "negative",
      frequency: "daily" | "weekly",
      targetCount: number,
      weekDays: number[] = []
    ) =>
      app.inject({
        method: "POST",
        url: "/api/v1/habits",
        headers: { cookie: operatorCookie },
        payload: {
          title,
          description: "Regression test for true consecutive streaks.",
          status: "active",
          polarity,
          frequency,
          targetCount,
          weekDays,
          rewardXp: 3,
          penaltyXp: 2
        }
      });

    const dailyPositiveResponse = await createHabitResponse(
      "Hyrox daily strength",
      "positive",
      "daily",
      1
    );
    assert.equal(dailyPositiveResponse.statusCode, 201);
    const dailyPositiveId = (
      dailyPositiveResponse.json() as { habit: { id: string } }
    ).habit.id;

    const dailyNegativeResponse = await createHabitResponse(
      "No doomscrolling",
      "negative",
      "daily",
      1
    );
    assert.equal(dailyNegativeResponse.statusCode, 201);
    const dailyNegativeId = (
      dailyNegativeResponse.json() as { habit: { id: string } }
    ).habit.id;

    const weeklyPositiveResponse = await createHabitResponse(
      "Hyrox sessions",
      "positive",
      "weekly",
      2,
      [1, 3, 5]
    );
    assert.equal(weeklyPositiveResponse.statusCode, 201);
    const weeklyPositiveId = (
      weeklyPositiveResponse.json() as { habit: { id: string } }
    ).habit.id;

    for (const dateKey of [
      "2026-04-08",
      "2026-04-07",
      "2026-04-06",
      "2026-04-05",
      "2026-04-03",
      "2026-04-02",
      "2026-04-01"
    ]) {
      const positiveCheckIn = await app.inject({
        method: "POST",
        url: `/api/v1/habits/${dailyPositiveId}/check-ins`,
        headers: { cookie: operatorCookie },
        payload: { dateKey, status: "done" }
      });
      assert.equal(positiveCheckIn.statusCode, 200);

      const negativeCheckIn = await app.inject({
        method: "POST",
        url: `/api/v1/habits/${dailyNegativeId}/check-ins`,
        headers: { cookie: operatorCookie },
        payload: { dateKey, status: "missed" }
      });
      assert.equal(negativeCheckIn.statusCode, 200);
    }

    for (const dateKey of [
      "2026-04-06",
      "2026-04-08",
      "2026-03-30",
      "2026-04-01",
      "2026-03-16",
      "2026-03-18"
    ]) {
      const weeklyCheckIn = await app.inject({
        method: "POST",
        url: `/api/v1/habits/${weeklyPositiveId}/check-ins`,
        headers: { cookie: operatorCookie },
        payload: { dateKey, status: "done" }
      });
      assert.equal(weeklyCheckIn.statusCode, 200);
    }

    const habitsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/habits",
      headers: { cookie: operatorCookie }
    });
    assert.equal(habitsResponse.statusCode, 200);
    const habits = (
      habitsResponse.json() as {
        habits: Array<{ id: string; streakCount: number }>;
      }
    ).habits;

    assert.equal(
      habits.find((habit) => habit.id === dailyPositiveId)?.streakCount,
      4
    );
    assert.equal(
      habits.find((habit) => habit.id === dailyNegativeId)?.streakCount,
      4
    );
    assert.equal(
      habits.find((habit) => habit.id === weeklyPositiveId)?.streakCount,
      2
    );
  } finally {
    globalThis.Date = RealDate;
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("psyche notes persist and scoped tokens cannot read psyche without explicit grant", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-psyche-note-scope-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const reportResponse = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/reports",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Trigger report for note scope test",
        status: "draft",
        eventSituation: "A short delay triggered spiraling prediction.",
        occurredAt: null,
        emotions: [],
        thoughts: [],
        behaviors: [],
        consequences: {
          selfShortTerm: [],
          selfLongTerm: [],
          othersShortTerm: [],
          othersLongTerm: []
        },
        linkedPatternIds: [],
        linkedValueIds: [],
        linkedGoalIds: [],
        linkedProjectIds: [],
        linkedTaskIds: [],
        modeOverlays: [],
        schemaLinks: [],
        nextMoves: []
      }
    });
    const reportId = (reportResponse.json() as { report: { id: string } })
      .report.id;

    const noteResponse = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        contentMarkdown: "Notice the abandonment story before acting on it.",
        links: [
          { entityType: "trigger_report", entityId: reportId, anchorKey: null }
        ]
      }
    });
    assert.equal(noteResponse.statusCode, 201);

    const noteList = await app.inject({
      method: "GET",
      url: `/api/v1/notes?linkedEntityType=trigger_report&linkedEntityId=${reportId}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(noteList.statusCode, 200);
    const noteBody = noteList.json() as {
      notes: Array<{ contentMarkdown: string }>;
    };
    assert.ok(
      noteBody.notes.some((entry) =>
        entry.contentMarkdown.includes("abandonment story")
      )
    );

    const tokenResponse = await app.inject({
      method: "POST",
      url: "/api/v1/settings/tokens",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        label: "Read-only agent",
        agentLabel: "Scope Tester",
        agentType: "assistant",
        description: "No psyche access",
        trustLevel: "standard",
        autonomyMode: "approval_required",
        approvalMode: "approval_by_default",
        scopes: ["read", "write", "insights"]
      }
    });
    const token = (tokenResponse.json() as { token: { token: string } }).token
      .token;

    const securePsyche = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        security: {
          psycheAuthRequired: true
        }
      }
    });
    assert.equal(securePsyche.statusCode, 200);

    const blocked = await app.inject({
      method: "GET",
      url: "/api/v1/psyche/overview",
      headers: {
        authorization: `Bearer ${token}`,
        "x-forge-source": "agent",
        "x-forge-actor": "Scope Tester"
      }
    });
    assert.equal(blocked.statusCode, 403);
    const blockedBody = blocked.json() as { code: string };
    assert.equal(blockedBody.code, "insufficient_scope");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("psyche behaviors, beliefs, modes, and custom taxonomies persist through the versioned API", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-psyche-expanded-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const psycheHeaders = { cookie: operatorCookie };
    const schemasResponse = await app.inject({
      method: "GET",
      url: "/api/v1/psyche/schema-catalog",
      headers: psycheHeaders
    });
    assert.equal(schemasResponse.statusCode, 200);
    const schemas = (
      schemasResponse.json() as {
        schemas: Array<{
          id: string;
          title: string;
          schemaType: "maladaptive" | "adaptive";
        }>;
      }
    ).schemas;
    assert.ok(
      schemas.some(
        (schema) =>
          schema.schemaType === "adaptive" &&
          schema.title === "Stable Attachment"
      )
    );
    const schemaId = schemas.find(
      (schema) => schema.schemaType === "maladaptive"
    )!.id;

    const eventTypeResponse = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/event-types",
      headers: psycheHeaders,
      payload: {
        label: "romantic rupture",
        description: "Moments where attachment panic rises after distance."
      }
    });
    assert.equal(eventTypeResponse.statusCode, 201);
    const eventTypeId = (
      eventTypeResponse.json() as { eventType: { id: string } }
    ).eventType.id;
    const eventTypeDetailResponse = await app.inject({
      method: "GET",
      url: `/api/v1/psyche/event-types/${eventTypeId}`,
      headers: psycheHeaders
    });
    assert.equal(eventTypeDetailResponse.statusCode, 200);
    const eventTypePatchResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/psyche/event-types/${eventTypeId}`,
      headers: psycheHeaders,
      payload: {
        description:
          "Moments where attachment panic rises after distance and silence."
      }
    });
    assert.equal(eventTypePatchResponse.statusCode, 200);
    const eventTypePatchBody = eventTypePatchResponse.json() as {
      eventType: { description: string };
    };
    assert.equal(
      eventTypePatchBody.eventType.description,
      "Moments where attachment panic rises after distance and silence."
    );

    const emotionResponse = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/emotions",
      headers: psycheHeaders,
      payload: {
        label: "aching tenderness",
        description: "A soft ache mixed with longing.",
        category: "attachment"
      }
    });
    assert.equal(emotionResponse.statusCode, 201);
    const emotionId = (emotionResponse.json() as { emotion: { id: string } })
      .emotion.id;
    const emotionDetailResponse = await app.inject({
      method: "GET",
      url: `/api/v1/psyche/emotions/${emotionId}`,
      headers: psycheHeaders
    });
    assert.equal(emotionDetailResponse.statusCode, 200);
    const emotionPatchResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/psyche/emotions/${emotionId}`,
      headers: psycheHeaders,
      payload: {
        category: "attachment-longing"
      }
    });
    assert.equal(emotionPatchResponse.statusCode, 200);
    const emotionPatchBody = emotionPatchResponse.json() as {
      emotion: { category: string };
    };
    assert.equal(emotionPatchBody.emotion.category, "attachment-longing");

    const valueResponse = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/values",
      headers: psycheHeaders,
      payload: {
        title: "Relate with steadiness",
        description: "Stay warm without panic-driven overreach.",
        valuedDirection: "Steady and courageous intimacy",
        whyItMatters: "I want closeness without self-abandonment.",
        linkedGoalIds: [],
        linkedProjectIds: [],
        linkedTaskIds: [],
        committedActions: ["Pause before sending a follow-up text"]
      }
    });
    const valueId = (valueResponse.json() as { value: { id: string } }).value
      .id;

    const patternResponse = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/patterns",
      headers: psycheHeaders,
      payload: {
        title: "Phone checking spiral",
        description: "The urge to monitor when uncertainty rises.",
        targetBehavior: "Compulsive checking and reassurance seeking",
        cueContexts: ["No answer after vulnerable message"],
        shortTermPayoff: "Temporary certainty",
        longTermCost: "More panic and less trust",
        preferredResponse: "Ground first, then choose one clear message",
        linkedValueIds: [valueId],
        linkedSchemaLabels: ["abandonment"],
        linkedModeLabels: ["vulnerable child"]
      }
    });
    const patternId = (patternResponse.json() as { pattern: { id: string } })
      .pattern.id;

    const modeResponse = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/modes",
      headers: psycheHeaders,
      payload: {
        family: "child",
        archetype: "vulnerable",
        title: "Tender alarm child",
        persona: "A frightened younger self who expects rupture.",
        imagery: "Small figure holding a glowing phone",
        symbolicForm: "Glass bird",
        facialExpression: "Wide-eyed and pleading",
        fear: "Being left alone",
        burden: "Carries the old loneliness",
        protectiveJob: "Pull for immediate reassurance",
        originContext: "Early attachment ruptures",
        firstAppearanceAt: "2026-03-22T10:00:00.000Z",
        linkedPatternIds: [patternId],
        linkedBehaviorIds: [],
        linkedValueIds: [valueId]
      }
    });
    assert.equal(modeResponse.statusCode, 201);
    const modeId = (modeResponse.json() as { mode: { id: string } }).mode.id;

    const behaviorResponse = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/behaviors",
      headers: psycheHeaders,
      payload: {
        kind: "away",
        title: "Refresh the thread again",
        description: "Repeated monitoring instead of tolerating uncertainty.",
        commonCues: ["Unread message", "Late-night comparison"],
        urgeStory: "If I check one more time I will feel safer.",
        shortTermPayoff: "A hit of certainty seeking",
        longTermCost: "More dependence on reassurance",
        replacementMove: "Take three breaths and wait ten minutes",
        repairPlan: "Name the slip and return to one grounded action",
        linkedPatternIds: [patternId],
        linkedValueIds: [valueId],
        linkedSchemaIds: [schemaId],
        linkedModeIds: [modeId]
      }
    });
    assert.equal(behaviorResponse.statusCode, 201);
    const behaviorId = (behaviorResponse.json() as { behavior: { id: string } })
      .behavior.id;

    const beliefResponse = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/beliefs",
      headers: psycheHeaders,
      payload: {
        schemaId,
        statement: "If they go quiet, I am about to be left.",
        beliefType: "absolute",
        originNote: "Core abandonment prediction",
        confidence: 86,
        evidenceFor: ["Silence has preceded rupture before"],
        evidenceAgainst: ["People also go quiet when tired or busy"],
        flexibleAlternative:
          "Silence can mean distance, but it does not prove abandonment.",
        linkedValueIds: [valueId],
        linkedBehaviorIds: [behaviorId],
        linkedModeIds: [modeId],
        linkedReportIds: []
      }
    });
    assert.equal(beliefResponse.statusCode, 201);
    const beliefId = (beliefResponse.json() as { belief: { id: string } })
      .belief.id;

    const guideResponse = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/mode-guides",
      headers: psycheHeaders,
      payload: {
        summary: "Recent rupture-style trigger",
        answers: [
          { questionKey: "coping_response", value: "freeze" },
          { questionKey: "child_state", value: "vulnerable" },
          { questionKey: "critic_style", value: "punitive" },
          { questionKey: "healthy_contact", value: "present" }
        ]
      }
    });
    assert.equal(guideResponse.statusCode, 201);
    const guideBody = guideResponse.json() as {
      session: { id: string; results: Array<{ family: string }> };
    };
    assert.ok(
      guideBody.session.results.some((result) => result.family === "child")
    );
    const guideId = guideBody.session.id;
    const guideDetailResponse = await app.inject({
      method: "GET",
      url: `/api/v1/psyche/mode-guides/${guideId}`,
      headers: psycheHeaders
    });
    assert.equal(guideDetailResponse.statusCode, 200);
    const guidePatchResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/psyche/mode-guides/${guideId}`,
      headers: psycheHeaders,
      payload: {
        summary: "Recent rupture-style trigger with stronger freeze response"
      }
    });
    assert.equal(guidePatchResponse.statusCode, 200);
    const guidePatchBody = guidePatchResponse.json() as {
      session: { summary: string };
    };
    assert.equal(
      guidePatchBody.session.summary,
      "Recent rupture-style trigger with stronger freeze response"
    );

    const reportResponse = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/reports",
      headers: psycheHeaders,
      payload: {
        title: "Attachment trigger with expanded links",
        status: "draft",
        eventTypeId,
        customEventType: "",
        eventSituation: "Several hours passed after an intimate message.",
        occurredAt: "2026-03-23T19:30:00.000Z",
        emotions: [
          {
            id: "emotion_1",
            emotionDefinitionId: emotionId,
            label: "aching tenderness",
            intensity: 72,
            note: "chest ache"
          }
        ],
        thoughts: [
          {
            id: "thought_1",
            text: "I am being left",
            parentMode: "demanding parent",
            criticMode: "punitive critic",
            beliefId
          }
        ],
        behaviors: [
          {
            id: "behavior_1",
            text: "Checked the thread repeatedly",
            mode: "Tender alarm child",
            behaviorId
          }
        ],
        consequences: {
          selfShortTerm: ["Temporary monitoring relief"],
          selfLongTerm: ["More panic"],
          othersShortTerm: ["More pressure in the exchange"],
          othersLongTerm: ["Less spontaneity"]
        },
        linkedPatternIds: [patternId],
        linkedValueIds: [valueId],
        linkedGoalIds: [],
        linkedProjectIds: [],
        linkedTaskIds: [],
        linkedBehaviorIds: [behaviorId],
        linkedBeliefIds: [beliefId],
        linkedModeIds: [modeId],
        modeOverlays: ["Tender alarm child"],
        schemaLinks: ["abandonment"],
        modeTimeline: [
          {
            id: "timeline_1",
            stage: "spark",
            modeId,
            label: "Tender alarm child",
            note: "Alarm rises immediately"
          }
        ],
        nextMoves: ["Wait before sending a second message"]
      }
    });
    assert.equal(reportResponse.statusCode, 201);
    const reportId = (reportResponse.json() as { report: { id: string } })
      .report.id;

    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/v1/psyche/reports/${reportId}`,
      headers: psycheHeaders
    });
    assert.equal(detailResponse.statusCode, 200);
    const detailBody = detailResponse.json() as {
      report: {
        eventTypeId: string | null;
        linkedBehaviorIds: string[];
        linkedBeliefIds: string[];
        linkedModeIds: string[];
        modeTimeline: Array<{ modeId: string | null }>;
      };
    };
    assert.equal(detailBody.report.eventTypeId, eventTypeId);
    assert.ok(detailBody.report.linkedBehaviorIds.includes(behaviorId));
    assert.ok(detailBody.report.linkedBeliefIds.includes(beliefId));
    assert.ok(detailBody.report.linkedModeIds.includes(modeId));
    assert.equal(detailBody.report.modeTimeline[0]?.modeId, modeId);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("psyche delete routes prune linked references instead of leaving stale ids behind", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-psyche-delete-crud-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const psycheHeaders = {
      cookie: operatorCookie
    };

    const schemaResponse = await app.inject({
      method: "GET",
      url: "/api/v1/psyche/schema-catalog",
      headers: psycheHeaders
    });
    const schemaId = (
      schemaResponse.json() as {
        schemas: Array<{ id: string; schemaType: "maladaptive" | "adaptive" }>;
      }
    ).schemas.find((schema) => schema.schemaType === "maladaptive")!.id;

    const goalResponse = await app.inject({
      method: "GET",
      url: "/api/v1/goals"
    });
    const goalId = (goalResponse.json() as { goals: Array<{ id: string }> })
      .goals[0]!.id;
    const projectResponse = await app.inject({
      method: "GET",
      url: `/api/v1/projects?goalId=${goalId}`
    });
    const projectId = (
      projectResponse.json() as { projects: Array<{ id: string }> }
    ).projects[0]!.id;
    const taskResponse = await app.inject({
      method: "GET",
      url: `/api/v1/tasks?projectId=${projectId}&limit=1`
    });
    const taskId = (taskResponse.json() as { tasks: Array<{ id: string }> })
      .tasks[0]!.id;

    const eventTypeId = (
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/psyche/event-types",
          headers: psycheHeaders,
          payload: {
            label: "Deletion trigger",
            description: "Custom event type for delete coverage."
          }
        })
      ).json() as { eventType: { id: string } }
    ).eventType.id;

    const emotionId = (
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/psyche/emotions",
          headers: psycheHeaders,
          payload: {
            label: "Delete-cover emotion",
            description: "Emotion used for delete coverage.",
            category: "test"
          }
        })
      ).json() as { emotion: { id: string } }
    ).emotion.id;

    const valueId = (
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/psyche/values",
          headers: psycheHeaders,
          payload: {
            title: "Stay grounded",
            description: "Delete coverage value.",
            valuedDirection: "Grounded action",
            whyItMatters: "Avoid stale references.",
            linkedGoalIds: [goalId],
            linkedProjectIds: [projectId],
            linkedTaskIds: [taskId],
            committedActions: ["Pause"]
          }
        })
      ).json() as { value: { id: string } }
    ).value.id;

    const patternId = (
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/psyche/patterns",
          headers: psycheHeaders,
          payload: {
            title: "Delete-cover pattern",
            description: "Pattern used for delete coverage.",
            targetBehavior: "Checking",
            cueContexts: ["Uncertainty"],
            shortTermPayoff: "Relief",
            longTermCost: "More panic",
            preferredResponse: "Ground first",
            linkedValueIds: [valueId],
            linkedSchemaLabels: ["abandonment"],
            linkedModeLabels: ["vulnerable child"]
          }
        })
      ).json() as { pattern: { id: string } }
    ).pattern.id;

    const modeId = (
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/psyche/modes",
          headers: psycheHeaders,
          payload: {
            family: "child",
            archetype: "vulnerable",
            title: "Delete-cover mode",
            persona: "An alarmed younger self",
            imagery: "Phone glow",
            symbolicForm: "Glass orb",
            facialExpression: "Worried",
            fear: "Abandonment",
            burden: "Loneliness",
            protectiveJob: "Seek certainty",
            originContext: "Old rupture",
            firstAppearanceAt: "2026-03-24T10:00:00.000Z",
            linkedPatternIds: [patternId],
            linkedBehaviorIds: [],
            linkedValueIds: [valueId]
          }
        })
      ).json() as { mode: { id: string } }
    ).mode.id;

    const behaviorId = (
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/psyche/behaviors",
          headers: psycheHeaders,
          payload: {
            kind: "away",
            title: "Delete-cover behavior",
            description: "Behavior used for delete coverage.",
            commonCues: ["Silence"],
            urgeStory: "Check again",
            shortTermPayoff: "Certainty",
            longTermCost: "More dependence",
            replacementMove: "Wait ten minutes",
            repairPlan: "Return to grounded action",
            linkedPatternIds: [patternId],
            linkedValueIds: [valueId],
            linkedSchemaIds: [schemaId],
            linkedModeIds: [modeId]
          }
        })
      ).json() as { behavior: { id: string } }
    ).behavior.id;

    const beliefId = (
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/psyche/beliefs",
          headers: psycheHeaders,
          payload: {
            schemaId,
            statement: "Silence means I am about to be left.",
            beliefType: "absolute",
            originNote: "Delete coverage belief",
            confidence: 75,
            evidenceFor: ["Past ruptures"],
            evidenceAgainst: ["People get busy"],
            flexibleAlternative: "Silence is data, not proof.",
            linkedValueIds: [valueId],
            linkedBehaviorIds: [behaviorId],
            linkedModeIds: [modeId],
            linkedReportIds: []
          }
        })
      ).json() as { belief: { id: string } }
    ).belief.id;

    const modeGuideId = (
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/psyche/mode-guides",
          headers: psycheHeaders,
          payload: {
            summary: "Delete coverage mode guide",
            answers: [
              { questionKey: "coping_response", value: "freeze" },
              { questionKey: "child_state", value: "vulnerable" }
            ]
          }
        })
      ).json() as { session: { id: string } }
    ).session.id;

    const reportId = (
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/psyche/reports",
          headers: psycheHeaders,
          payload: {
            title: "Delete coverage report",
            status: "draft",
            eventTypeId,
            customEventType: "",
            eventSituation: "A long silence after a message.",
            occurredAt: "2026-03-24T20:00:00.000Z",
            emotions: [
              {
                id: "emotion_1",
                emotionDefinitionId: emotionId,
                label: "Delete-cover emotion",
                intensity: 70,
                note: ""
              }
            ],
            thoughts: [
              {
                id: "thought_1",
                text: "I am being left",
                parentMode: "critic",
                criticMode: "punitive",
                beliefId
              }
            ],
            behaviors: [
              {
                id: "behavior_1",
                text: "Checked again",
                mode: "Delete-cover mode",
                behaviorId
              }
            ],
            consequences: {
              selfShortTerm: ["Relief"],
              selfLongTerm: ["More panic"],
              othersShortTerm: ["Pressure"],
              othersLongTerm: ["Distance"]
            },
            linkedPatternIds: [patternId],
            linkedValueIds: [valueId],
            linkedGoalIds: [goalId],
            linkedProjectIds: [projectId],
            linkedTaskIds: [taskId],
            linkedBehaviorIds: [behaviorId],
            linkedBeliefIds: [beliefId],
            linkedModeIds: [modeId],
            modeOverlays: ["Delete-cover mode"],
            schemaLinks: ["abandonment"],
            modeTimeline: [
              {
                id: "timeline_1",
                stage: "spark",
                modeId,
                label: "Delete-cover mode",
                note: ""
              }
            ],
            nextMoves: ["Wait"]
          }
        })
      ).json() as { report: { id: string } }
    ).report.id;

    const reportNoteResponse = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers: psycheHeaders,
      payload: {
        contentMarkdown: "This note should disappear with the report.",
        author: "Albert",
        links: [
          { entityType: "trigger_report", entityId: reportId, anchorKey: null }
        ]
      }
    });
    assert.equal(reportNoteResponse.statusCode, 201);

    assert.equal(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/v1/psyche/beliefs/${beliefId}`,
          headers: psycheHeaders
        })
      ).statusCode,
      200
    );
    const reportAfterBeliefDelete = await app.inject({
      method: "GET",
      url: `/api/v1/psyche/reports/${reportId}`,
      headers: psycheHeaders
    });
    assert.equal(reportAfterBeliefDelete.statusCode, 200);
    const reportAfterBeliefDeleteBody = reportAfterBeliefDelete.json() as {
      report: {
        linkedBeliefIds: string[];
        thoughts: Array<{ beliefId: string | null }>;
      };
    };
    assert.deepEqual(reportAfterBeliefDeleteBody.report.linkedBeliefIds, []);
    assert.equal(
      reportAfterBeliefDeleteBody.report.thoughts[0]?.beliefId,
      null
    );

    assert.equal(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/v1/psyche/modes/${modeId}`,
          headers: psycheHeaders
        })
      ).statusCode,
      200
    );
    const behaviorAfterModeDelete = await app.inject({
      method: "GET",
      url: `/api/v1/psyche/behaviors/${behaviorId}`,
      headers: psycheHeaders
    });
    assert.equal(behaviorAfterModeDelete.statusCode, 200);
    assert.deepEqual(
      (
        behaviorAfterModeDelete.json() as {
          behavior: { linkedModeIds: string[] };
        }
      ).behavior.linkedModeIds,
      []
    );
    const reportAfterModeDelete = await app.inject({
      method: "GET",
      url: `/api/v1/psyche/reports/${reportId}`,
      headers: psycheHeaders
    });
    const reportAfterModeDeleteBody = reportAfterModeDelete.json() as {
      report: {
        linkedModeIds: string[];
        modeTimeline: Array<{ modeId: string | null }>;
      };
    };
    assert.deepEqual(reportAfterModeDeleteBody.report.linkedModeIds, []);
    assert.equal(
      reportAfterModeDeleteBody.report.modeTimeline[0]?.modeId,
      null
    );

    assert.equal(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/v1/psyche/event-types/${eventTypeId}`,
          headers: psycheHeaders
        })
      ).statusCode,
      200
    );
    assert.equal(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/v1/psyche/emotions/${emotionId}`,
          headers: psycheHeaders
        })
      ).statusCode,
      200
    );
    const reportAfterEventEmotionDelete = await app.inject({
      method: "GET",
      url: `/api/v1/psyche/reports/${reportId}`,
      headers: psycheHeaders
    });
    const reportAfterEventEmotionDeleteBody =
      reportAfterEventEmotionDelete.json() as {
        report: {
          eventTypeId: string | null;
          emotions: Array<{ emotionDefinitionId: string | null }>;
        };
      };
    assert.equal(reportAfterEventEmotionDeleteBody.report.eventTypeId, null);
    assert.equal(
      reportAfterEventEmotionDeleteBody.report.emotions[0]?.emotionDefinitionId,
      null
    );

    assert.equal(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/v1/psyche/patterns/${patternId}`,
          headers: psycheHeaders
        })
      ).statusCode,
      200
    );
    const behaviorAfterPatternDelete = await app.inject({
      method: "GET",
      url: `/api/v1/psyche/behaviors/${behaviorId}`,
      headers: psycheHeaders
    });
    assert.deepEqual(
      (
        behaviorAfterPatternDelete.json() as {
          behavior: { linkedPatternIds: string[] };
        }
      ).behavior.linkedPatternIds,
      []
    );

    assert.equal(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/v1/psyche/values/${valueId}`,
          headers: psycheHeaders
        })
      ).statusCode,
      200
    );
    const reportAfterValueDelete = await app.inject({
      method: "GET",
      url: `/api/v1/psyche/reports/${reportId}`,
      headers: psycheHeaders
    });
    const reportAfterValueDeleteBody = reportAfterValueDelete.json() as {
      report: {
        linkedValueIds: string[];
        linkedGoalIds: string[];
        linkedProjectIds: string[];
        linkedTaskIds: string[];
      };
    };
    assert.deepEqual(reportAfterValueDeleteBody.report.linkedValueIds, []);
    assert.deepEqual(reportAfterValueDeleteBody.report.linkedGoalIds, [goalId]);
    assert.deepEqual(reportAfterValueDeleteBody.report.linkedProjectIds, [
      projectId
    ]);
    assert.deepEqual(reportAfterValueDeleteBody.report.linkedTaskIds, [taskId]);

    assert.equal(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/v1/psyche/behaviors/${behaviorId}`,
          headers: psycheHeaders
        })
      ).statusCode,
      200
    );
    const reportAfterBehaviorDelete = await app.inject({
      method: "GET",
      url: `/api/v1/psyche/reports/${reportId}`,
      headers: psycheHeaders
    });
    const reportAfterBehaviorDeleteBody = reportAfterBehaviorDelete.json() as {
      report: {
        linkedBehaviorIds: string[];
        behaviors: Array<{ behaviorId: string | null }>;
      };
    };
    assert.deepEqual(
      reportAfterBehaviorDeleteBody.report.linkedBehaviorIds,
      []
    );
    assert.equal(
      reportAfterBehaviorDeleteBody.report.behaviors[0]?.behaviorId,
      null
    );

    assert.equal(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/v1/psyche/mode-guides/${modeGuideId}`,
          headers: psycheHeaders
        })
      ).statusCode,
      200
    );
    const deletedModeGuideGet = await app.inject({
      method: "GET",
      url: `/api/v1/psyche/mode-guides/${modeGuideId}`,
      headers: psycheHeaders
    });
    assert.equal(deletedModeGuideGet.statusCode, 404);

    assert.equal(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/v1/psyche/reports/${reportId}`,
          headers: psycheHeaders
        })
      ).statusCode,
      200
    );
    const deletedReportGet = await app.inject({
      method: "GET",
      url: `/api/v1/psyche/reports/${reportId}`,
      headers: psycheHeaders
    });
    assert.equal(deletedReportGet.statusCode, 404);
    const reportNotes = await app.inject({
      method: "GET",
      url: `/api/v1/notes?linkedEntityType=trigger_report&linkedEntityId=${reportId}`,
      headers: psycheHeaders
    });
    assert.deepEqual((reportNotes.json() as { notes: unknown[] }).notes, []);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("activity correction hides removed events from the default archive", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-activity-correction-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const createdGoalResponse = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Create a removable activity log",
        description: "This goal exists to create one visible archive event.",
        horizon: "quarter",
        status: "active",
        targetPoints: 300,
        themeColor: "#4477aa",
        tagIds: []
      }
    });
    assert.equal(createdGoalResponse.statusCode, 201);

    const initialActivity = await app.inject({
      method: "GET",
      url: "/api/v1/activity?limit=1"
    });
    const eventId = (
      initialActivity.json() as { activity: Array<{ id: string }> }
    ).activity[0]!.id;

    const removeResponse = await app.inject({
      method: "POST",
      url: `/api/v1/activity/${eventId}/remove`,
      headers: {
        cookie: operatorCookie
      },
      payload: { reason: "User removed this visible log." }
    });
    assert.equal(removeResponse.statusCode, 200);

    const afterRemoval = await app.inject({
      method: "GET",
      url: "/api/v1/activity?limit=100"
    });
    const visibleIds = (
      afterRemoval.json() as { activity: Array<{ id: string }> }
    ).activity.map((event) => event.id);
    assert.ok(!visibleIds.includes(eventId));

    const correctedHistory = await app.inject({
      method: "GET",
      url: "/api/v1/activity?limit=100&includeCorrected=true"
    });
    const correctedIds = (
      correctedHistory.json() as { activity: Array<{ id: string }> }
    ).activity.map((event) => event.id);
    assert.ok(correctedIds.includes(eventId));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("task creation rejects unknown goal references with a 404 and no partial write", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-task-bad-goal-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const before = await app.inject({ method: "GET", url: "/api/tasks" });
    const beforeCount = (before.json() as { tasks: Array<{ id: string }> })
      .tasks.length;

    const response = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Broken relation",
        goalId: "goal_missing",
        tagIds: []
      }
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), {
      code: "goal_not_found",
      error: "Goal goal_missing does not exist",
      statusCode: 404
    });

    const after = await app.inject({ method: "GET", url: "/api/tasks" });
    const afterCount = (after.json() as { tasks: Array<{ id: string }> }).tasks
      .length;
    assert.equal(afterCount, beforeCount);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("task status updates survive soft-deleted goal links and preserve project context", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-task-stale-goal-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    upsertDeletedEntityRecord({
      entityType: "goal",
      entityId: "goal_be_a_good_person",
      title: "Be a good person",
      snapshot: {
        id: "goal_be_a_good_person",
        title: "Be a good person"
      },
      context: {
        source: "system",
        actor: null
      }
    });

    const moved = await app.inject({
      method: "PATCH",
      url: "/api/v1/tasks/task_weekly_review",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        status: "focus"
      }
    });

    assert.equal(moved.statusCode, 200);
    const movedTask = (
      moved.json() as {
        task: {
          status: string;
          goalId: string | null;
          projectId: string | null;
        };
      }
    ).task;
    assert.equal(movedTask.status, "focus");
    assert.equal(movedTask.goalId, null);
    assert.equal(movedTask.projectId, "project_relationships_ritual");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("entity creation can include nested notes that auto-link to the new parent", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-nested-notes-create-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Nested note goal",
        description: "Goal created with automatic note linking.",
        notes: [
          {
            contentMarkdown: "Initial goal note from nested create.",
            author: "OpenClaw"
          }
        ]
      }
    });

    assert.equal(created.statusCode, 201);
    const goalId = (created.json() as { goal: { id: string } }).goal.id;

    const notes = await app.inject({
      method: "GET",
      url: `/api/v1/notes?linkedEntityType=goal&linkedEntityId=${goalId}`,
      headers: {
        cookie: operatorCookie
      }
    });

    assert.equal(notes.statusCode, 200);
    const notesBody = notes.json() as {
      notes: Array<{
        contentMarkdown: string;
        links: Array<{ entityType: string; entityId: string }>;
      }>;
    };
    assert.ok(
      notesBody.notes.some((entry) =>
        entry.contentMarkdown.includes("nested create")
      )
    );
    assert.ok(
      notesBody.notes.some((entry) =>
        entry.links.some(
          (link) => link.entityType === "goal" && link.entityId === goalId
        )
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("notes list supports linked entity arrays, free-text chips, and updated date bounds", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-notes-query-filters-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const today = new Date().toISOString().slice(0, 10);

    const firstNote = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        contentMarkdown: "Release note edge cases collected in one place.",
        author: "Forge Agent",
        links: [
          {
            entityType: "task",
            entityId: "task_plugin_surface",
            anchorKey: null
          }
        ]
      }
    });
    assert.equal(firstNote.statusCode, 201);

    const secondNote = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        contentMarkdown: "Handoff wiki page for the mobile project.",
        author: "Albert",
        links: [
          {
            entityType: "project",
            entityId: "project_forge_mobile",
            anchorKey: null
          }
        ]
      }
    });
    assert.equal(secondNote.statusCode, 201);

    const filtered = await app.inject({
      method: "GET",
      url:
        `/api/v1/notes?linkedTo=task:task_plugin_surface&linkedTo=project:project_forge_mobile` +
        `&textTerms=release&textTerms=handoff&updatedFrom=${today}&updatedTo=${today}`,
      headers: {
        cookie: operatorCookie
      }
    });

    assert.equal(filtered.statusCode, 200);
    const body = filtered.json() as {
      notes: Array<{ contentMarkdown: string }>;
    };
    assert.equal(body.notes.length, 2);
    assert.ok(
      body.notes.some((entry) =>
        entry.contentMarkdown.includes("Release note edge cases")
      )
    );
    assert.ok(
      body.notes.some((entry) =>
        entry.contentMarkdown.includes("Handoff wiki page")
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("notes support custom and memory tags plus ephemeral auto-destruction", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-note-tags-expiry-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const durableNote = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        contentMarkdown: "Keep the active plugin session state visible.",
        author: "Albert",
        tags: ["Working memory", "release-handoff"],
        destroyAt: null,
        links: [
          {
            entityType: "task",
            entityId: "task_plugin_surface",
            anchorKey: null
          }
        ]
      }
    });
    assert.equal(durableNote.statusCode, 201);
    const durableBody = durableNote.json() as {
      note: { id: string; tags: string[]; destroyAt: string | null };
    };
    assert.deepEqual(durableBody.note.tags, [
      "Working memory",
      "release-handoff"
    ]);
    assert.equal(durableBody.note.destroyAt, null);

    const expiringNote = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        contentMarkdown:
          "This should self-destruct after the immediate handoff.",
        author: "Albert",
        tags: ["Short-term memory"],
        destroyAt: new Date(Date.now() - 60_000).toISOString(),
        links: [
          {
            entityType: "project",
            entityId: "project_forge_mobile",
            anchorKey: null
          }
        ]
      }
    });
    assert.equal(expiringNote.statusCode, 201);
    const expiringBody = expiringNote.json() as { note: { id: string } };

    const filtered = await app.inject({
      method: "GET",
      url: "/api/v1/notes?tags=working%20memory",
      headers: {
        cookie: operatorCookie
      }
    });

    assert.equal(filtered.statusCode, 200);
    const filteredBody = filtered.json() as {
      notes: Array<{ id: string; tags: string[] }>;
    };
    assert.equal(filteredBody.notes.length, 1);
    assert.equal(filteredBody.notes[0]?.id, durableBody.note.id);
    assert.deepEqual(filteredBody.notes[0]?.tags, [
      "Working memory",
      "release-handoff"
    ]);

    const expiredGet = await app.inject({
      method: "GET",
      url: `/api/v1/notes/${expiringBody.note.id}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(expiredGet.statusCode, 404);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("wiki pages are SQLite-backed, searchable, backlink-aware, and ingestable", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-wiki-memory-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const starterTree = await app.inject({
      method: "GET",
      url: "/api/v1/wiki/tree",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(starterTree.statusCode, 200);
    const starterTreeBody = starterTree.json() as {
      tree: Array<{
        page: { slug: string };
        children: Array<{ page: { slug: string } }>;
      }>;
    };
    assert.equal(starterTreeBody.tree[0]?.page.slug, "index");
    assert.deepEqual(
      starterTreeBody.tree[0]?.children.map((entry) => entry.page.slug),
      ["people", "projects", "concepts", "sources", "chronicle"]
    );

    const evidenceNote = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        contentMarkdown: "Daily Forge Checkup Note - Evening",
        sourcePath: "/tmp/legacy-wiki/evidence/checkup.md",
        links: [],
        tags: []
      }
    });
    assert.equal(evidenceNote.statusCode, 201);
    const evidenceNoteBody = evidenceNote.json() as {
      note: { id: string; sourcePath: string };
    };
    assert.equal(evidenceNoteBody.note.sourcePath, "");

    const treeAfterEvidence = await app.inject({
      method: "GET",
      url: "/api/v1/wiki/tree",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(treeAfterEvidence.statusCode, 200);
    const treeAfterEvidenceBody = treeAfterEvidence.json() as {
      tree: Array<{
        page: { slug: string };
        children: Array<{ page: { slug: string } }>;
      }>;
    };
    assert.equal(treeAfterEvidenceBody.tree.length, 1);
    assert.equal(treeAfterEvidenceBody.tree[0]?.page.slug, "index");
    assert.deepEqual(
      treeAfterEvidenceBody.tree[0]?.children.map((entry) => entry.page.slug),
      ["people", "projects", "concepts", "sources", "chronicle"]
    );

    const home = await app.inject({
      method: "GET",
      url: "/api/v1/wiki/home",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(home.statusCode, 200);
    const homeBody = home.json() as {
      page: { id: string; slug: string; title: string };
    };
    assert.equal(homeBody.page.slug, "index");
    assert.equal(homeBody.page.title, "Home");

    const releasePlaybook = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/pages",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Release playbook",
        slug: "release-playbook",
        summary: "Shared checklist for shipping the plugin surface safely.",
        aliases: ["ship checklist", "launch checklist"],
        contentMarkdown:
          "# Release playbook\n\nCapture the release checklist, rollback protocol, and launch owner.",
        links: []
      }
    });
    assert.equal(releasePlaybook.statusCode, 201);
    const releaseBody = releasePlaybook.json() as {
      page: { id: string; slug: string; kind: string; sourcePath: string };
    };
    assert.equal(releaseBody.page.slug, "release-playbook");
    assert.equal(releaseBody.page.kind, "wiki");
    assert.equal(releaseBody.page.sourcePath, "");
    assert.equal(
      (
        getDatabase()
          .prepare("SELECT content_markdown FROM notes WHERE id = ?")
          .get(releaseBody.page.id) as { content_markdown: string } | undefined
      )?.content_markdown,
      "# Release playbook\n\nCapture the release checklist, rollback protocol, and launch owner."
    );

    const releaseSourcePathPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/notes/${releaseBody.page.id}`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        sourcePath: "/tmp/legacy-wiki/pages/release-playbook.md"
      }
    });
    assert.equal(releaseSourcePathPatch.statusCode, 200);
    const releaseSourcePathPatchBody = releaseSourcePathPatch.json() as {
      note: { sourcePath: string };
    };
    assert.equal(releaseSourcePathPatchBody.note.sourcePath, "");
    assert.equal(
      (
        getDatabase()
          .prepare("SELECT source_path FROM notes WHERE id = ?")
          .get(releaseBody.page.id) as { source_path: string } | undefined
      )?.source_path,
      ""
    );

    const launchLog = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/pages",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Launch log",
        summary: "Field notes from the final rehearsal before launch.",
        contentMarkdown:
          "# Launch log\n\nWe rehearsed the release against [[release-playbook]] and confirmed the fallback path.\n\n[[forge:task:task_plugin_surface|Plugin surface task]] stays the operational anchor.",
        links: [
          {
            entityType: "task",
            entityId: "task_plugin_surface",
            anchorKey: null
          }
        ]
      }
    });
    assert.equal(launchLog.statusCode, 201);
    const launchBody = launchLog.json() as {
      page: { id: string; slug: string };
    };

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/wiki/pages/${releaseBody.page.id}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(detail.statusCode, 200);
    const detailBody = detail.json() as {
      backlinks: Array<{ sourceNoteId: string; rawTarget: string }>;
      backlinksBySourceId: Record<string, { slug: string } | null>;
    };
    assert.ok(
      detailBody.backlinks.some(
        (entry) =>
          entry.sourceNoteId === launchBody.page.id &&
          entry.rawTarget === "release-playbook"
      )
    );
    assert.equal(
      detailBody.backlinksBySourceId[launchBody.page.id]?.slug,
      launchBody.page.slug
    );

    const detailBySlug = await app.inject({
      method: "GET",
      url: "/api/v1/wiki/by-slug/release-playbook",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(detailBySlug.statusCode, 200);
    const detailBySlugBody = detailBySlug.json() as {
      page: { id: string; slug: string };
    };
    assert.equal(detailBySlugBody.page.id, releaseBody.page.id);
    assert.equal(detailBySlugBody.page.slug, "release-playbook");

    const detailByAlias = await app.inject({
      method: "GET",
      url: "/api/v1/wiki/by-slug/ship%20checklist",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(detailByAlias.statusCode, 200);
    const detailByAliasBody = detailByAlias.json() as {
      page: { id: string; slug: string };
    };
    assert.equal(detailByAliasBody.page.id, releaseBody.page.id);
    assert.equal(detailByAliasBody.page.slug, "release-playbook");

    const personPage = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/pages",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Albert Buchard",
        slug: "albert-buchard",
        summary: "Person page resolved by exact-title wiki links.",
        contentMarkdown:
          "# Albert Buchard\n\nGeneva psychiatrist and researcher.",
        links: []
      }
    });
    assert.equal(personPage.statusCode, 201);
    const personBody = personPage.json() as {
      page: { id: string; slug: string };
    };

    const detailByTitle = await app.inject({
      method: "GET",
      url: "/api/v1/wiki/by-slug/Albert%20Buchard",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(detailByTitle.statusCode, 200);
    const detailByTitleBody = detailByTitle.json() as {
      page: { id: string; slug: string };
    };
    assert.equal(detailByTitleBody.page.id, personBody.page.id);
    assert.equal(detailByTitleBody.page.slug, "albert-buchard");

    const duplicatePersonPage = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/pages",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Albert Buchard",
        slug: "albert-buchard",
        summary:
          "Deleted duplicate should not shadow the canonical title route.",
        contentMarkdown: "# Albert Buchard\n\nDuplicate candidate.\n",
        links: []
      }
    });
    assert.equal(duplicatePersonPage.statusCode, 201);
    const duplicatePersonBody = duplicatePersonPage.json() as {
      page: { id: string; slug: string };
    };
    assert.equal(duplicatePersonBody.page.slug, "albert-buchard-2");

    const deleteDuplicatePerson = await app.inject({
      method: "DELETE",
      url: `/api/v1/wiki/pages/${duplicatePersonBody.page.id}?spaceId=wiki_space_shared`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(deleteDuplicatePerson.statusCode, 200);

    const detailByTitleAfterDeletedDuplicate = await app.inject({
      method: "GET",
      url: "/api/v1/wiki/by-slug/Albert%20Buchard",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(detailByTitleAfterDeletedDuplicate.statusCode, 200);
    const detailByTitleAfterDeletedDuplicateBody =
      detailByTitleAfterDeletedDuplicate.json() as {
        page: { id: string; slug: string };
      };
    assert.equal(
      detailByTitleAfterDeletedDuplicateBody.page.id,
      personBody.page.id
    );
    assert.equal(
      detailByTitleAfterDeletedDuplicateBody.page.slug,
      "albert-buchard"
    );

    const titleLinkedPage = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/pages",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "People log",
        summary: "Uses a title-based wiki link instead of a slug.",
        contentMarkdown:
          "# People log\n\nWe should keep [[Albert Buchard]] easy to find from the wiki.",
        links: []
      }
    });
    assert.equal(titleLinkedPage.statusCode, 201);
    const titleLinkedBody = titleLinkedPage.json() as {
      page: { id: string };
    };

    const personDetail = await app.inject({
      method: "GET",
      url: `/api/v1/wiki/pages/${personBody.page.id}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(personDetail.statusCode, 200);
    const personDetailBody = personDetail.json() as {
      backlinks: Array<{ sourceNoteId: string; rawTarget: string }>;
    };
    assert.ok(
      personDetailBody.backlinks.some(
        (entry) =>
          entry.sourceNoteId === titleLinkedBody.page.id &&
          entry.rawTarget === "Albert Buchard"
      )
    );

    const textSearch = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/search",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        mode: "text",
        query: "final rehearsal"
      }
    });
    assert.equal(textSearch.statusCode, 200);
    const textSearchBody = textSearch.json() as {
      results: Array<{ page: { id: string } }>;
    };
    assert.ok(
      textSearchBody.results.some(
        (entry) => entry.page.id === launchBody.page.id
      )
    );

    const entitySearch = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/search",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        mode: "entity",
        linkedEntity: {
          entityType: "task",
          entityId: "task_plugin_surface"
        }
      }
    });
    assert.equal(entitySearch.statusCode, 200);
    const entitySearchBody = entitySearch.json() as {
      results: Array<{ page: { id: string } }>;
    };
    assert.ok(
      entitySearchBody.results.some(
        (entry) => entry.page.id === launchBody.page.id
      )
    );

    const compatibilityList = await app.inject({
      method: "GET",
      url: "/api/v1/notes?kind=wiki&slug=release-playbook",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(compatibilityList.statusCode, 200);
    const compatibilityBody = compatibilityList.json() as {
      notes: Array<{ id: string }>;
    };
    assert.equal(compatibilityBody.notes.length, 1);
    assert.equal(compatibilityBody.notes[0]?.id, releaseBody.page.id);

    const blockHomeDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/wiki/pages/${homeBody.page.id}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(blockHomeDelete.statusCode, 400);

    const deleteReleasePlaybook = await app.inject({
      method: "DELETE",
      url: `/api/v1/wiki/pages/${releaseBody.page.id}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(deleteReleasePlaybook.statusCode, 200);
    const deleteReleaseBody = deleteReleasePlaybook.json() as {
      deleted: { id: string };
    };
    assert.equal(deleteReleaseBody.deleted.id, releaseBody.page.id);

    const deletedPageLookup = await app.inject({
      method: "GET",
      url: `/api/v1/wiki/pages/${releaseBody.page.id}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(deletedPageLookup.statusCode, 404);

    const treeAfterDelete = await app.inject({
      method: "GET",
      url: "/api/v1/wiki/tree",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(treeAfterDelete.statusCode, 200);
    const treeAfterDeleteBody = treeAfterDelete.json() as {
      tree: Array<{
        page: { slug: string };
        children: Array<{ page: { slug: string } }>;
      }>;
    };
    const rootSlugs = treeAfterDeleteBody.tree.map((entry) => entry.page.slug);
    assert.ok(!rootSlugs.includes("release-playbook"));

    const ingest = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/ingest-jobs",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        sourceKind: "raw_text",
        titleHint: "Imported field notes",
        sourceText:
          "Farza-style personal wiki entries should stay explicit, navigable, and reusable by any agent over files.",
        linkedEntityHints: []
      }
    });
    assert.equal(ingest.statusCode, 201);
    const ingestBody = ingest.json() as {
      job: {
        job: { id: string; status: string; pageNoteId: string | null };
        items: Array<{ itemType: string }>;
      } | null;
      page: { id: string; title: string; kind: string } | null;
    };
    assert.equal(ingestBody.job?.job.status, "queued");
    assert.equal(ingestBody.page, null);
    assert.ok(
      ingestBody.job?.items.some((item) => item.itemType === "raw_source")
    );

    let reviewedJob: {
      job: {
        job: {
          status: string;
          phase: string;
          pageNoteId: string | null;
          acceptedCount: number;
          rejectedCount: number;
        };
        candidates: Array<{
          id: string;
          candidateType: string;
          status: string;
        }>;
      };
    } | null = null;

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const poll: Awaited<ReturnType<typeof app.inject>> = await app.inject({
        method: "GET",
        url: `/api/v1/wiki/ingest-jobs/${ingestBody.job?.job.id}`,
        headers: {
          cookie: operatorCookie
        }
      });
      assert.equal(poll.statusCode, 200);
      const pollBody = poll.json() as {
        job: { status: string; pageNoteId: string | null };
        candidates: Array<{ id: string; candidateType: string }>;
      };
      if (pollBody.job.status === "completed") {
        const review = await app.inject({
          method: "POST",
          url: `/api/v1/wiki/ingest-jobs/${ingestBody.job?.job.id}/review`,
          headers: {
            cookie: operatorCookie
          },
          payload: {
            decisions: pollBody.candidates.map((candidate) => ({
              candidateId: candidate.id,
              keep: candidate.candidateType === "page"
            }))
          }
        });
        assert.equal(review.statusCode, 200);
        reviewedJob = review.json() as {
          job: {
            job: {
              status: string;
              phase: string;
              pageNoteId: string | null;
              acceptedCount: number;
              rejectedCount: number;
            };
            candidates: Array<{
              id: string;
              candidateType: string;
              status: string;
            }>;
          };
        };
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    assert.ok(reviewedJob);
    assert.equal(reviewedJob.job.job.status, "completed");
    assert.equal(reviewedJob.job.job.phase, "reviewed");
    assert.ok(reviewedJob.job.job.acceptedCount >= 0);
    assert.ok(reviewedJob.job.job.rejectedCount >= 0);
    assert.ok(Array.isArray(reviewedJob.job.candidates));
    if (
      reviewedJob.job.candidates.some(
        (candidate) =>
          candidate.candidateType === "page" && candidate.status === "applied"
      )
    ) {
      assert.ok(reviewedJob.job.job.pageNoteId);
    }

    const health = await app.inject({
      method: "GET",
      url: "/api/v1/wiki/health",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(health.statusCode, 200);
    const healthBody = health.json() as {
      health: {
        pageCount: number;
        rawSourceCount: number;
        indexPath: string;
      };
    };
    assert.ok(healthBody.health.pageCount >= 3);
    assert.ok(healthBody.health.rawSourceCount >= 1);
    assert.equal(healthBody.health.indexPath, "");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("wiki ingest review can map an entity proposal onto an existing Forge entity", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-wiki-ingest-map-existing-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST" && url.endsWith("/responses")) {
      return new Response(
        JSON.stringify({
          id: "resp_map_existing",
          status: "queued"
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }
    return new Response(
      JSON.stringify({
        id: "resp_map_existing",
        status: "completed",
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  title: "Arthur chat overview",
                  summary: "Durable summary for Forge review.",
                  markdown:
                    "# Arthur chat overview\n\nThis source suggests a durable goal relationship page and one existing goal mapping.\n",
                  tags: ["relationship"],
                  entityProposals: [
                    {
                      entityType: "goal",
                      title: "Map existing ingest goal",
                      summary: "Keep Arthur connection warm and explicit.",
                      rationale:
                        "The chat repeatedly points toward one durable relationship goal.",
                      confidence: 0.88,
                      suggestedFields: {
                        goalId: null,
                        projectId: null,
                        horizon: "year",
                        status: "active",
                        priority: null,
                        dueDate: null,
                        themeColor: "#c8a46b",
                        polarity: null,
                        frequency: null,
                        endStateDescription: null,
                        valuedDirection: null,
                        whyItMatters: null,
                        userId: null,
                        targetPoints: 300,
                        estimatedMinutes: null,
                        targetCount: null,
                        rewardXp: null,
                        penaltyXp: null,
                        linkedGoalIds: [],
                        linkedProjectIds: [],
                        linkedTaskIds: [],
                        linkedValueIds: [],
                        targetGoalIds: [],
                        targetProjectIds: [],
                        weekDays: [],
                        linkedEntities: [],
                        committedActions: [],
                        notes: [],
                        tags: []
                      }
                    }
                  ],
                  pageUpdateSuggestions: [],
                  articleCandidates: []
                })
              }
            ]
          }
        ]
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );
  }) as typeof fetch;

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const goalCreate = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Map existing ingest goal",
        description: "Existing goal that the ingest review should reuse.",
        horizon: "year",
        status: "active",
        targetPoints: 300,
        themeColor: "#c8a46b",
        tagIds: [],
        notes: []
      }
    });
    assert.equal(goalCreate.statusCode, 201);
    const goalCreateBody = goalCreate.json() as { goal: { id: string } };
    const existingGoalId = goalCreateBody.goal.id;

    const createProfile = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/settings/llm-profiles",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        label: "Forge wiki ingest",
        provider: "openai-responses",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.4-mini",
        apiKey: "sk-test-map-existing",
        reasoningEffort: "medium",
        verbosity: "medium",
        systemPrompt: "Keep entity proposals conservative."
      }
    });
    assert.equal(createProfile.statusCode, 201);
    const createProfileBody = createProfile.json() as {
      profile: { id: string };
    };

    const ingest = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/ingest-jobs",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        sourceKind: "raw_text",
        titleHint: "Arthur chat",
        sourceText:
          "Arthur and Albert keep discussing staying close and protecting the friendship as an explicit long-term priority.",
        mimeType: "text/plain",
        llmProfileId: createProfileBody.profile.id,
        linkedEntityHints: []
      }
    });
    assert.equal(ingest.statusCode, 201);
    const ingestBody = ingest.json() as {
      job: { job: { id: string } } | null;
    };
    const jobId = ingestBody.job?.job.id ?? "";
    assert.ok(jobId);

    let jobPayload: WikiIngestJobPollPayload | null = null;
    for (let attempt = 0; attempt < 160; attempt += 1) {
      const poll = await app.inject({
        method: "GET",
        url: `/api/v1/wiki/ingest-jobs/${jobId}`,
        headers: {
          cookie: operatorCookie
        }
      });
      assert.equal(poll.statusCode, 200);
      jobPayload = poll.json() as WikiIngestJobPollPayload;
      if (jobPayload?.job.status === "completed") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    assert.ok(jobPayload);
    const resolvedJobPayload = jobPayload as WikiIngestJobPollPayload;
    const entityCandidate = resolvedJobPayload.candidates.find(
      (candidate: WikiIngestJobPollPayload["candidates"][number]) =>
        candidate.candidateType === "entity"
    );
    assert.ok(entityCandidate);

    const review = await app.inject({
      method: "POST",
      url: `/api/v1/wiki/ingest-jobs/${jobId}/review`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        decisions: resolvedJobPayload.candidates.map(
          (candidate: WikiIngestJobPollPayload["candidates"][number]) =>
            candidate.id === entityCandidate?.id
              ? {
                  candidateId: candidate.id,
                  action: "map_existing",
                  mappedEntityType: "goal",
                  mappedEntityId: existingGoalId
                }
              : {
                  candidateId: candidate.id,
                  action: "discard"
                }
        )
      }
    });
    assert.equal(review.statusCode, 200);
    const reviewBody = review.json() as {
      job: {
        job: {
          acceptedCount: number;
          rejectedCount: number;
        };
        candidates: Array<{
          id: string;
          candidateType: string;
          status: string;
          publishedEntityId: string | null;
          publishedEntityType: string | null;
        }>;
      };
    };
    assert.equal(reviewBody.job.job.acceptedCount, 1);
    assert.ok(reviewBody.job.job.rejectedCount >= 1);
    const reviewedEntityCandidate = reviewBody.job.candidates.find(
      (candidate) => candidate.id === entityCandidate?.id
    );
    assert.equal(reviewedEntityCandidate?.status, "applied");
    assert.equal(reviewedEntityCandidate?.publishedEntityType, "goal");
    assert.equal(reviewedEntityCandidate?.publishedEntityId, existingGoalId);

    const goalCountRow = getDatabase()
      .prepare(`SELECT COUNT(*) as count FROM goals WHERE title = ?`)
      .get("Map existing ingest goal") as { count: number };
    assert.equal(goalCountRow.count, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("wiki ingest recovery does not reuse one OpenAI response across duplicate file names", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-wiki-ingest-duplicate-file-names-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const createProfile = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/settings/llm-profiles",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        label: "Forge wiki ingest",
        provider: "openai-responses",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.4-mini",
        apiKey: "sk-test-duplicate-filenames",
        reasoningEffort: "medium",
        verbosity: "medium",
        systemPrompt: "Keep each file separate."
      }
    });
    assert.equal(createProfile.statusCode, 201);
    const createProfileBody = createProfile.json() as {
      profile: { id: string };
    };

    const created = await createUploadedWikiIngestJob(
      {
        llmProfileId: createProfileBody.profile.id,
        parseStrategy: "auto",
        createAsKind: "wiki",
        userId: "user_operator"
      },
      [
        {
          fileName: "_chat.txt",
          mimeType: "text/plain",
          payload: Buffer.from("Alpha transcript", "utf8")
        },
        {
          fileName: "_chat.txt",
          mimeType: "text/plain",
          payload: Buffer.from("Beta transcript", "utf8")
        }
      ],
      {
        actor: "user_operator"
      }
    );
    const jobId = created.job?.job.id ?? "";
    assert.ok(jobId);

    const assets = getDatabase()
      .prepare(
        `SELECT id, file_name
         FROM wiki_ingest_job_assets
         WHERE job_id = ?
         ORDER BY created_at ASC`
      )
      .all(jobId) as Array<{ id: string; file_name: string }>;
    assert.equal(assets.length, 2);

    const firstAsset = assets[0];
    const secondAsset = assets[1];
    assert.ok(firstAsset);
    assert.ok(secondAsset);

    const now = new Date().toISOString();
    getDatabase()
      .prepare(
        `INSERT INTO wiki_ingest_job_logs (
          id, job_id, level, message, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        "wiki_ingest_log_duplicate_filename_seed",
        jobId,
        "info",
        "Seeded OpenAI background response for the first duplicate file.",
        JSON.stringify({
          scope: "wiki_llm",
          eventKey: "llm_compile_background_started",
          responseId: "resp_first_duplicate_file",
          sourceAssetId: firstAsset.id,
          currentFileName: firstAsset.file_name
        }),
        now
      );

    const resumeResponseIds: Array<string | null> = [];
    let callIndex = 0;
    await processWikiIngestJob(jobId, {
      llm: {
        compileWikiIngest: async (
          _profile: unknown,
          input: { rawText: string },
          options: { resumeResponseId?: string | null }
        ) => {
          resumeResponseIds.push(options.resumeResponseId ?? null);
          callIndex += 1;
          return {
            title: `Imported page ${callIndex}`,
            summary: input.rawText,
            markdown: `# Imported page ${callIndex}\n\n${input.rawText}`,
            tags: [],
            entityProposals: [],
            pageUpdateSuggestions: [],
            articleCandidates: []
          };
        }
      } as any
    });

    assert.deepEqual(resumeResponseIds, ["resp_first_duplicate_file", null]);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("wiki ingest review can merge a page candidate into an existing wiki page", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-wiki-ingest-merge-page-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const existingPageResponse = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/pages",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Arthur knowledge",
        slug: "arthur-knowledge",
        summary: "Existing durable page for Arthur.",
        contentMarkdown:
          "# Arthur knowledge\n\nBaseline context that should stay at the top.",
        links: []
      }
    });
    assert.equal(existingPageResponse.statusCode, 201);
    const existingPageBody = existingPageResponse.json() as {
      page: { id: string };
    };
    const existingPageId = existingPageBody.page.id;

    const noteCountBeforeReview = (
      getDatabase().prepare(`SELECT COUNT(*) as count FROM notes`).get() as {
        count: number;
      }
    ).count;

    const createIngest = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/ingest-jobs",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        titleHint: "Arthur chat supplement",
        sourceKind: "raw_text",
        sourceText:
          "# Arthur chat supplement\n\nNew durable detail about how Arthur and Albert keep the relationship warm over distance.",
        mimeType: "text/plain",
        parseStrategy: "text_only",
        createAsKind: "wiki"
      }
    });
    assert.equal(createIngest.statusCode, 201);
    const createIngestBody = createIngest.json() as {
      job: { job: { id: string } } | null;
    };
    const jobId = createIngestBody.job?.job.id ?? "";
    assert.ok(jobId);

    let jobPayload: WikiIngestJobPollPayload | null = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const jobResponse = await app.inject({
        method: "GET",
        url: `/api/v1/wiki/ingest-jobs/${jobId}`,
        headers: {
          cookie: operatorCookie
        }
      });
      assert.equal(jobResponse.statusCode, 200);
      jobPayload = jobResponse.json() as WikiIngestJobPollPayload;
      if (
        jobPayload &&
        !["queued", "processing"].includes(jobPayload.job.status)
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    assert.ok(jobPayload);
    const resolvedJobPayload = jobPayload as WikiIngestJobPollPayload;
    const pageCandidate = resolvedJobPayload.candidates.find(
      (candidate: WikiIngestJobPollPayload["candidates"][number]) =>
        candidate.candidateType === "page"
    );
    assert.ok(pageCandidate);

    const review = await app.inject({
      method: "POST",
      url: `/api/v1/wiki/ingest-jobs/${jobId}/review`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        decisions: [
          {
            candidateId: pageCandidate?.id,
            action: "merge_existing",
            targetNoteId: existingPageId
          }
        ]
      }
    });
    assert.equal(review.statusCode, 200);
    const reviewBody = review.json() as {
      job: {
        job: {
          acceptedCount: number;
          rejectedCount: number;
        };
        candidates: Array<{
          id: string;
          status: string;
          publishedNoteId: string | null;
        }>;
      };
    };
    assert.equal(reviewBody.job.job.acceptedCount, 1);
    assert.equal(reviewBody.job.job.rejectedCount, 0);
    const reviewedCandidate = reviewBody.job.candidates.find(
      (candidate) => candidate.id === pageCandidate?.id
    );
    assert.equal(reviewedCandidate?.status, "applied");
    assert.equal(reviewedCandidate?.publishedNoteId, existingPageId);

    const noteCountAfterReview = (
      getDatabase().prepare(`SELECT COUNT(*) as count FROM notes`).get() as {
        count: number;
      }
    ).count;
    assert.equal(noteCountAfterReview, noteCountBeforeReview);

    const repeatReview = await app.inject({
      method: "POST",
      url: `/api/v1/wiki/ingest-jobs/${jobId}/review`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        decisions: [
          {
            candidateId: pageCandidate?.id,
            action: "merge_existing",
            targetNoteId: existingPageId
          }
        ]
      }
    });
    assert.equal(repeatReview.statusCode, 200);
    const repeatReviewBody = repeatReview.json() as {
      job: {
        job: {
          acceptedCount: number;
          rejectedCount: number;
        };
      };
    };
    assert.equal(repeatReviewBody.job.job.acceptedCount, 0);
    assert.equal(repeatReviewBody.job.job.rejectedCount, 0);

    const noteCountAfterRepeatReview = (
      getDatabase().prepare(`SELECT COUNT(*) as count FROM notes`).get() as {
        count: number;
      }
    ).count;
    assert.equal(noteCountAfterRepeatReview, noteCountBeforeReview);

    const mergedPage = getDatabase()
      .prepare(`SELECT content_markdown FROM notes WHERE id = ?`)
      .get(existingPageId) as { content_markdown: string } | undefined;
    assert.ok(mergedPage);
    assert.match(
      mergedPage?.content_markdown ?? "",
      /Baseline context that should stay at the top\./
    );
    assert.match(
      mergedPage?.content_markdown ?? "",
      /## Arthur chat supplement/
    );
    assert.match(
      mergedPage?.content_markdown ?? "",
      /keep the relationship warm over distance/
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("wiki settings can test a saved OpenAI ingest profile", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-wiki-llm-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init });
    return new Response(
      JSON.stringify({
        output: [
          {
            content: [{ type: "output_text", text: "ok" }]
          }
        ]
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }
    );
  }) as typeof fetch;

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const createProfile = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/settings/llm-profiles",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        label: "Forge wiki ingest",
        provider: "openai-responses",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.4-mini",
        apiKey: "sk-test-123",
        reasoningEffort: "high",
        verbosity: "high",
        systemPrompt: "Keep wiki pages structured."
      }
    });
    assert.equal(createProfile.statusCode, 201);
    const createProfileBody = createProfile.json() as {
      profile: { id: string; secretId: string | null };
    };
    assert.ok(createProfileBody.profile.secretId);

    const testConnection = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/settings/llm-profiles/test",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        profileId: createProfileBody.profile.id,
        model: "gpt-5.4-mini",
        baseUrl: "https://api.openai.com/v1",
        provider: "openai-responses",
        reasoningEffort: "xhigh",
        verbosity: "low"
      }
    });
    assert.equal(testConnection.statusCode, 200);
    const testConnectionBody = testConnection.json() as {
      result: {
        model: string;
        reasoningEffort: string | null;
        verbosity: string | null;
        usingStoredKey: boolean;
        outputPreview: string;
      };
    };
    assert.equal(testConnectionBody.result.model, "gpt-5.4-mini");
    assert.equal(testConnectionBody.result.reasoningEffort, "xhigh");
    assert.equal(testConnectionBody.result.verbosity, "low");
    assert.equal(testConnectionBody.result.usingStoredKey, true);
    assert.equal(testConnectionBody.result.outputPreview, "ok");

    assert.equal(fetchCalls.length, 1);
    const request = fetchCalls[0];
    assert.ok(request);
    assert.equal(request.url, "https://api.openai.com/v1/responses");
    assert.equal(
      (request.init?.headers as Record<string, string>).authorization,
      "Bearer sk-test-123"
    );
    const payload = JSON.parse(String(request.init?.body)) as {
      model: string;
      reasoning?: { effort?: string };
      text?: { verbosity?: string };
    };
    assert.equal(payload.model, "gpt-5.4-mini");
    assert.equal(payload.reasoning?.effort, "xhigh");
    assert.equal(payload.text?.verbosity, "low");
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("wiki ingest history entries can be deleted without deleting published notes", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-wiki-ingest-delete-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const createIngest = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/ingest-jobs",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        titleHint: "Preserved ingest page",
        sourceKind: "raw_text",
        sourceText:
          "Forge should keep the published wiki page after the ingest history entry is deleted.",
        mimeType: "text/plain",
        parseStrategy: "text_only",
        createAsKind: "wiki"
      }
    });
    assert.equal(createIngest.statusCode, 201);
    const createIngestBody = createIngest.json() as {
      job: { job: { id: string } } | null;
    };
    const jobId = createIngestBody.job?.job.id;
    assert.ok(jobId);

    let jobPayload: WikiIngestJobPollPayload | null = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const jobResponse: Awaited<ReturnType<typeof app.inject>> =
        await app.inject({
          method: "GET",
          url: `/api/v1/wiki/ingest-jobs/${jobId}`,
          headers: {
            cookie: operatorCookie
          }
        });
      assert.equal(jobResponse.statusCode, 200);
      jobPayload = jobResponse.json() as WikiIngestJobPollPayload;
      if (
        jobPayload &&
        !["queued", "processing"].includes(jobPayload.job.status)
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(jobPayload);
    const resolvedJobPayload = jobPayload as WikiIngestJobPollPayload;
    const pageCandidateIds =
      resolvedJobPayload.candidates
        .filter(
          (candidate: WikiIngestJobPollPayload["candidates"][number]) =>
            candidate.candidateType === "page"
        )
        .map(
          (candidate: WikiIngestJobPollPayload["candidates"][number]) =>
            candidate.id
        ) ?? [];
    assert.ok(pageCandidateIds.length > 0);

    const review = await app.inject({
      method: "POST",
      url: `/api/v1/wiki/ingest-jobs/${jobId}/review`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        decisions: pageCandidateIds.map((candidateId: string) => ({
          candidateId,
          keep: true
        }))
      }
    });
    assert.equal(review.statusCode, 200);
    const publishedNoteRow = getDatabase()
      .prepare(
        `SELECT id
         FROM notes
         WHERE title = ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get("Preserved ingest page") as { id: string } | undefined;
    const publishedNoteId = publishedNoteRow?.id ?? null;
    assert.ok(publishedNoteId);

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/wiki/ingest-jobs/${jobId}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(deleteResponse.statusCode, 200);

    const deletedJob = await app.inject({
      method: "GET",
      url: `/api/v1/wiki/ingest-jobs/${jobId}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(deletedJob.statusCode, 404);

    const noteRow = getDatabase()
      .prepare(`SELECT id FROM notes WHERE id = ?`)
      .get(publishedNoteId) as { id: string } | undefined;
    assert.equal(noteRow?.id, publishedNoteId);

    await assert.rejects(() =>
      access(path.join(rootDir, "data", "wiki-ingest", jobId))
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("task-run completion and release endpoints are idempotent for same-actor retries", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-task-run-idempotency-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    taskRunWatchdog: false
  });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const tasksResponse = await app.inject({
      method: "GET",
      url: "/api/tasks?limit=1"
    });
    const taskId = (tasksResponse.json() as { tasks: Array<{ id: string }> })
      .tasks[0]!.id;

    const claimed = await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/runs`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        actor: "OpenClaw",
        leaseTtlSeconds: 300,
        note: "First execution lease."
      }
    });

    assert.equal(claimed.statusCode, 201);
    const claimedRunId = (claimed.json() as { taskRun: { id: string } }).taskRun
      .id;

    const completed = await app.inject({
      method: "POST",
      url: `/api/task-runs/${claimedRunId}/complete`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        actor: "OpenClaw",
        note: "Finished cleanly."
      }
    });

    assert.equal(completed.statusCode, 200);
    const completedRun = (
      completed.json() as {
        taskRun: { id: string; status: string; completedAt: string | null };
      }
    ).taskRun;
    assert.equal(completedRun.status, "completed");
    assert.ok(completedRun.completedAt);

    const completedRetry = await app.inject({
      method: "POST",
      url: `/api/task-runs/${claimedRunId}/complete`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        actor: "OpenClaw",
        note: "Duplicate finish after network retry."
      }
    });

    assert.equal(completedRetry.statusCode, 200);
    assert.deepEqual(
      (
        completedRetry.json() as {
          taskRun: { id: string; status: string; completedAt: string | null };
        }
      ).taskRun,
      completedRun
    );

    const claimedForRelease = await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/runs`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        actor: "OpenClaw",
        leaseTtlSeconds: 300,
        note: "Second execution lease."
      }
    });

    assert.equal(claimedForRelease.statusCode, 201);
    const releaseRunId = (
      claimedForRelease.json() as { taskRun: { id: string } }
    ).taskRun.id;

    const released = await app.inject({
      method: "POST",
      url: `/api/task-runs/${releaseRunId}/release`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        actor: "OpenClaw",
        note: "Releasing ownership."
      }
    });

    assert.equal(released.statusCode, 200);
    const releasedRun = (
      released.json() as {
        taskRun: { id: string; status: string; releasedAt: string | null };
      }
    ).taskRun;
    assert.equal(releasedRun.status, "released");
    assert.ok(releasedRun.releasedAt);

    const releasedRetry = await app.inject({
      method: "POST",
      url: `/api/task-runs/${releaseRunId}/release`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        actor: "OpenClaw"
      }
    });

    assert.equal(releasedRetry.statusCode, 200);
    assert.deepEqual(
      (
        releasedRetry.json() as {
          taskRun: { id: string; status: string; releasedAt: string | null };
        }
      ).taskRun,
      releasedRun
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("task-run completion can persist a closeout note linked to the task", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-task-run-closeout-note-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    taskRunWatchdog: false
  });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const tasksResponse = await app.inject({
      method: "GET",
      url: "/api/v1/tasks?limit=1"
    });
    const taskId = (tasksResponse.json() as { tasks: Array<{ id: string }> })
      .tasks[0]!.id;

    const claimed = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${taskId}/runs`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        actor: "OpenClaw",
        leaseTtlSeconds: 300,
        note: "Starting closeout-note coverage."
      }
    });

    assert.equal(claimed.statusCode, 201);
    const runId = (claimed.json() as { taskRun: { id: string } }).taskRun.id;

    const completed = await app.inject({
      method: "POST",
      url: `/api/v1/task-runs/${runId}/complete`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        actor: "OpenClaw",
        note: "Run finished.",
        closeoutNote: {
          contentMarkdown: "Wrapped the work and captured the handoff.",
          author: "OpenClaw"
        }
      }
    });

    assert.equal(completed.statusCode, 200);

    const notes = await app.inject({
      method: "GET",
      url: `/api/v1/notes?linkedEntityType=task&linkedEntityId=${taskId}`,
      headers: {
        cookie: operatorCookie
      }
    });

    assert.equal(notes.statusCode, 200);
    const notesBody = notes.json() as {
      notes: Array<{ contentMarkdown: string }>;
    };
    assert.ok(
      notesBody.notes.some((entry) =>
        entry.contentMarkdown.includes("captured the handoff")
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("task creation is idempotent when the same Idempotency-Key is retried", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-task-idempotent-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard"
    });
    const payload = dashboard.json() as {
      goals: Array<{ id: string }>;
      tasks: Array<{ id: string }>;
      tags: Array<{ id: string }>;
    };
    const beforeCount = payload.tasks.length;

    const taskPayload = {
      title: "Retry-safe focus block",
      description:
        "This should not duplicate when the client retries after a timeout.",
      status: "focus",
      priority: "high",
      owner: "Albert",
      goalId: payload.goals[0]!.id,
      dueDate: "2026-03-27",
      effort: "deep",
      energy: "high",
      points: 75,
      tagIds: payload.tags.slice(0, 2).map((tag) => tag.id)
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: {
        cookie: operatorCookie,
        "idempotency-key": "task-create-retry-1"
      },
      payload: taskPayload
    });
    assert.equal(first.statusCode, 201);

    const replay = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: {
        cookie: operatorCookie,
        "idempotency-key": "task-create-retry-1"
      },
      payload: taskPayload
    });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.headers["idempotency-replayed"], "true");

    const firstTask = (first.json() as { task: { id: string } }).task;
    const replayTask = (replay.json() as { task: { id: string } }).task;
    assert.equal(replayTask.id, firstTask.id);

    const after = await app.inject({ method: "GET", url: "/api/tasks" });
    const afterCount = (after.json() as { tasks: Array<{ id: string }> }).tasks
      .length;
    assert.equal(afterCount, beforeCount + 1);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("task creation rejects reusing an Idempotency-Key with a different payload", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-task-idempotency-conflict-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard"
    });
    const payload = dashboard.json() as {
      goals: Array<{ id: string }>;
      tags: Array<{ id: string }>;
    };

    const firstPayload = {
      title: "Retry-safe planning block",
      goalId: payload.goals[0]!.id,
      tagIds: payload.tags.slice(0, 1).map((tag) => tag.id)
    };
    const conflictingPayload = {
      title: "Different payload under same key",
      goalId: payload.goals[0]!.id,
      tagIds: payload.tags.slice(1, 2).map((tag) => tag.id)
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: {
        cookie: operatorCookie,
        "idempotency-key": "task-create-retry-2"
      },
      payload: firstPayload
    });
    assert.equal(first.statusCode, 201);

    const conflict = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: {
        cookie: operatorCookie,
        "idempotency-key": "task-create-retry-2"
      },
      payload: conflictingPayload
    });

    assert.equal(conflict.statusCode, 409);
    assert.deepEqual(conflict.json(), {
      code: "idempotency_conflict",
      error:
        "Idempotency key was already used for a different task creation payload",
      statusCode: 409
    });
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("metrics and programmable task filters are exposed for OpenClaw", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-openclaw-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const metricsResponse = await app.inject({
      method: "GET",
      url: "/api/metrics"
    });
    assert.equal(metricsResponse.statusCode, 200);
    const metrics = (
      metricsResponse.json() as {
        metrics: { level: number; totalXp: number; nextLevelXp: number };
      }
    ).metrics;
    assert.ok(metrics.level >= 1);
    assert.ok(metrics.totalXp >= 0);
    assert.ok(metrics.nextLevelXp > 0);

    const filteredTasksResponse = await app.inject({
      method: "GET",
      url: "/api/tasks?owner=Albert&due=week&limit=3"
    });
    assert.equal(filteredTasksResponse.statusCode, 200);
    const filteredTasks = (
      filteredTasksResponse.json() as { tasks: Array<{ owner: string }> }
    ).tasks;
    assert.ok(filteredTasks.length >= 1);
    assert.ok(filteredTasks.every((task) => task.owner === "Albert"));

    const contextResponse = await app.inject({
      method: "GET",
      url: "/api/openclaw/context?status=focus"
    });
    assert.equal(contextResponse.statusCode, 200);
    const context = contextResponse.json() as {
      metrics: { level: number };
      dashboard: { gamification: { level: number } };
      tasks: Array<{ status: string }>;
    };
    assert.equal(context.metrics.level, context.dashboard.gamification.level);
    assert.ok(context.tasks.every((task) => task.status === "focus"));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("activity endpoints capture mutations with source attribution", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-activity-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard"
    });
    const payload = dashboard.json() as {
      goals: Array<{ id: string }>;
      tasks: Array<{ id: string }>;
    };

    const createdTask = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: {
        cookie: operatorCookie,
        "x-forge-source": "openclaw",
        "x-forge-actor": "OpenClaw"
      },
      payload: {
        title: "Programmatic evidence test",
        goalId: payload.goals[0]!.id
      }
    });
    assert.equal(createdTask.statusCode, 201);
    const taskId = (createdTask.json() as { task: { id: string } }).task.id;

    const updatedGoal = await app.inject({
      method: "PATCH",
      url: `/api/goals/${payload.goals[0]!.id}`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        status: "paused"
      }
    });
    assert.equal(updatedGoal.statusCode, 200);

    const runClaim = await app.inject({
      method: "POST",
      url: `/api/tasks/${payload.tasks[0]!.id}/runs`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        actor: "Aurel",
        leaseTtlSeconds: 30,
        note: "Activity feed test run."
      }
    });
    assert.equal(runClaim.statusCode, 201);

    const activityResponse = await app.inject({
      method: "GET",
      url: "/api/activity?limit=10"
    });
    assert.equal(activityResponse.statusCode, 200);
    const activity = (
      activityResponse.json() as {
        activity: Array<{
          entityType: string;
          entityId: string;
          source: string;
          title: string;
        }>;
      }
    ).activity;

    assert.ok(
      activity.some(
        (event) =>
          event.entityType === "task" &&
          event.entityId === taskId &&
          event.source === "openclaw"
      )
    );
    assert.ok(
      activity.some(
        (event) => event.entityType === "goal" && event.source === "ui"
      )
    );
    assert.ok(
      activity.some(
        (event) =>
          event.entityType === "task_run" &&
          (event.title.includes("started") || event.title.includes("claimed"))
      )
    );

    const contextResponse = await app.inject({
      method: "GET",
      url: "/api/openclaw/context"
    });
    assert.equal(contextResponse.statusCode, 200);
    const context = contextResponse.json() as {
      activity: Array<{ entityId: string }>;
      dashboard: { recentActivity: Array<{ entityId: string }> };
    };
    assert.ok(context.activity.length >= 3);
    assert.ok(context.dashboard.recentActivity.length >= 3);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("task context bundles goal linkage, run state, and task-scoped evidence", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-task-context-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard"
    });
    const payload = dashboard.json() as {
      goals: Array<{ id: string; title: string }>;
    };

    const createdTask = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: {
        cookie: operatorCookie,
        "x-forge-source": "openclaw",
        "x-forge-actor": "OpenClaw"
      },
      payload: {
        title: "Investigate lease resilience",
        description: "Gather one-shot task context for operator review.",
        goalId: payload.goals[0]!.id,
        status: "focus",
        owner: "Albert",
        points: 70,
        tagIds: []
      }
    });
    assert.equal(createdTask.statusCode, 201);
    const task = (
      createdTask.json() as { task: { id: string; goalId: string } }
    ).task;

    const runClaim = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/runs`,
      headers: {
        cookie: operatorCookie,
        "x-forge-source": "openclaw"
      },
      payload: {
        actor: "OpenClaw",
        leaseTtlSeconds: 120,
        note: "Reviewing task context contract."
      }
    });
    assert.equal(runClaim.statusCode, 201);
    const claimedRun = (runClaim.json() as { taskRun: { id: string } }).taskRun;

    const contextResponse = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}/context`
    });
    assert.equal(contextResponse.statusCode, 200);
    const context = contextResponse.json() as {
      task: { id: string; goalId: string | null };
      goal: { id: string; title: string } | null;
      activeTaskRun: { id: string; status: string } | null;
      taskRuns: Array<{ id: string; taskId: string }>;
      activity: Array<{ entityType: string; entityId: string; source: string }>;
    };

    assert.equal(context.task.id, task.id);
    assert.equal(context.task.goalId, payload.goals[0]!.id);
    assert.equal(context.goal?.id, payload.goals[0]!.id);
    assert.equal(context.goal?.title, payload.goals[0]!.title);
    assert.equal(context.activeTaskRun?.id, claimedRun.id);
    assert.equal(context.activeTaskRun?.status, "active");
    assert.ok(
      context.taskRuns.some(
        (entry) => entry.id === claimedRun.id && entry.taskId === task.id
      )
    );
    assert.ok(
      context.activity.some(
        (event) =>
          event.entityType === "task" &&
          event.entityId === task.id &&
          event.source === "openclaw"
      )
    );
    assert.ok(
      context.activity.some(
        (event) =>
          event.entityType === "task_run" && event.entityId === claimedRun.id
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("goal updates reject unknown tags with a 404", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-goal-bad-tag-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard"
    });
    const payload = dashboard.json() as {
      goals: Array<{ id: string; tagIds: string[] }>;
    };

    const response = await app.inject({
      method: "PATCH",
      url: `/api/goals/${payload.goals[0]!.id}`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        tagIds: ["tag_missing"]
      }
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), {
      code: "tag_not_found",
      error: "Unknown tag ids: tag_missing",
      statusCode: 404
    });
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("insights and weekly review read models are exposed for the routed shell", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-insights-review-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const insights = await app.inject({
      method: "GET",
      url: "/api/v1/insights"
    });
    assert.equal(insights.statusCode, 200);
    const insightsBody = insights.json() as {
      insights: {
        momentumHeatmap: Array<unknown>;
        executionTrends: Array<unknown>;
        coaching: { title: string };
      };
    };
    assert.equal(insightsBody.insights.momentumHeatmap.length, 30);
    assert.ok(insightsBody.insights.executionTrends.length >= 1);
    assert.ok(insightsBody.insights.coaching.title.length > 0);

    const review = await app.inject({
      method: "GET",
      url: "/api/v1/reviews/weekly"
    });
    assert.equal(review.statusCode, 200);
    const reviewBody = review.json() as {
      review: {
        chart: Array<unknown>;
        wins: Array<unknown>;
        reward: { rewardXp: number };
      };
    };
    assert.equal(reviewBody.review.chart.length, 7);
    assert.ok(reviewBody.review.wins.length >= 1);
    assert.equal(reviewBody.review.reward.rewardXp, 250);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("weekly review finalization is idempotent and updates the review payload", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-weekly-review-finalize-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const initialReview = await app.inject({
      method: "GET",
      url: "/api/v1/reviews/weekly"
    });
    assert.equal(initialReview.statusCode, 200);
    const initialBody = initialReview.json() as {
      review: {
        weekKey: string;
        reward: { rewardXp: number };
        completion: { finalized: boolean };
      };
    };
    assert.equal(initialBody.review.completion.finalized, false);

    const firstFinalize = await app.inject({
      method: "POST",
      url: "/api/v1/reviews/weekly/finalize",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(firstFinalize.statusCode, 201);
    const firstBody = firstFinalize.json() as {
      closure: { id: string; weekKey: string; rewardId: string };
      reward: {
        id: string;
        deltaXp: number;
        entityType: string;
        entityId: string;
      };
      review: {
        completion: { finalized: boolean; finalizedAt: string | null };
      };
      metrics: { recentLedger: Array<{ id: string; deltaXp: number }> };
    };
    assert.equal(firstBody.closure.weekKey, initialBody.review.weekKey);
    assert.equal(firstBody.reward.id, firstBody.closure.rewardId);
    assert.equal(firstBody.reward.deltaXp, initialBody.review.reward.rewardXp);
    assert.equal(firstBody.reward.entityType, "system");
    assert.equal(firstBody.reward.entityId, initialBody.review.weekKey);
    assert.equal(firstBody.review.completion.finalized, true);
    assert.ok(firstBody.review.completion.finalizedAt);
    assert.ok(
      firstBody.metrics.recentLedger.some(
        (entry) =>
          entry.id === firstBody.reward.id &&
          entry.deltaXp === firstBody.reward.deltaXp
      )
    );

    const secondFinalize = await app.inject({
      method: "POST",
      url: "/api/v1/reviews/weekly/finalize",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(secondFinalize.statusCode, 200);
    const secondBody = secondFinalize.json() as {
      closure: { id: string; rewardId: string };
      reward: { id: string; deltaXp: number };
    };
    assert.equal(secondBody.closure.id, firstBody.closure.id);
    assert.equal(secondBody.closure.rewardId, firstBody.closure.rewardId);
    assert.equal(secondBody.reward.id, firstBody.reward.id);
    assert.equal(secondBody.reward.deltaXp, firstBody.reward.deltaXp);

    const reviewAfterFinalize = await app.inject({
      method: "GET",
      url: "/api/v1/reviews/weekly"
    });
    assert.equal(reviewAfterFinalize.statusCode, 200);
    const reviewAfterBody = reviewAfterFinalize.json() as {
      review: {
        completion: {
          finalized: boolean;
          finalizedAt: string | null;
          finalizedBy: string | null;
        };
      };
    };
    assert.equal(reviewAfterBody.review.completion.finalized, true);
    assert.ok(reviewAfterBody.review.completion.finalizedBy);
    assert.ok(reviewAfterBody.review.completion.finalizedAt);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("soft delete, restore, hard delete, and the settings bin stay in sync for anchored collaboration", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-soft-delete-bin-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const goalsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/goals"
    });
    const goalId = (goalsResponse.json() as { goals: Array<{ id: string }> })
      .goals[0]!.id;

    const noteResponse = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers: { cookie: operatorCookie },
      payload: {
        contentMarkdown: "This goal has collaboration attached to it.",
        links: [{ entityType: "goal", entityId: goalId, anchorKey: null }]
      }
    });
    assert.equal(noteResponse.statusCode, 201);
    const noteId = (noteResponse.json() as { note: { id: string } }).note.id;

    const insightResponse = await app.inject({
      method: "POST",
      url: "/api/v1/insights",
      headers: { cookie: operatorCookie },
      payload: {
        originType: "agent",
        originAgentId: null,
        originLabel: "OpenClaw",
        entityType: "goal",
        entityId: goalId,
        timeframeLabel: "This week",
        title: "Protect the goal from drift",
        summary: "The goal needs one concrete project pulse this week.",
        recommendation:
          "Review the linked project and create one visible next task.",
        rationale: "",
        confidence: 0.78,
        visibility: "visible",
        ctaLabel: "Review insight"
      }
    });
    assert.equal(insightResponse.statusCode, 201);
    const insightId = (insightResponse.json() as { insight: { id: string } })
      .insight.id;

    const softDeleteGoal = await app.inject({
      method: "DELETE",
      url: `/api/v1/goals/${goalId}`,
      headers: { cookie: operatorCookie }
    });
    assert.equal(softDeleteGoal.statusCode, 200);

    const deletedGoal = await app.inject({
      method: "GET",
      url: `/api/v1/goals/${goalId}`
    });
    assert.equal(deletedGoal.statusCode, 404);

    const hiddenNotes = await app.inject({
      method: "GET",
      url: `/api/v1/notes?linkedEntityType=goal&linkedEntityId=${goalId}`,
      headers: { cookie: operatorCookie }
    });
    assert.deepEqual((hiddenNotes.json() as { notes: unknown[] }).notes, []);

    const hiddenInsight = await app.inject({
      method: "GET",
      url: `/api/v1/insights/${insightId}`,
      headers: { cookie: operatorCookie }
    });
    assert.equal(hiddenInsight.statusCode, 404);

    const binResponse = await app.inject({
      method: "GET",
      url: "/api/v1/settings/bin",
      headers: { cookie: operatorCookie }
    });
    assert.equal(binResponse.statusCode, 200);
    const binBody = binResponse.json() as {
      bin: {
        records: Array<{ entityType: string; entityId: string }>;
      };
    };
    assert.ok(
      binBody.bin.records.some(
        (record) => record.entityType === "goal" && record.entityId === goalId
      )
    );
    assert.ok(
      binBody.bin.records.some(
        (record) => record.entityType === "note" && record.entityId === noteId
      )
    );
    assert.ok(
      binBody.bin.records.some(
        (record) =>
          record.entityType === "insight" && record.entityId === insightId
      )
    );

    const restored = await app.inject({
      method: "POST",
      url: "/api/v1/entities/restore",
      headers: { cookie: operatorCookie },
      payload: {
        operations: [{ entityType: "goal", id: goalId }]
      }
    });
    assert.equal(restored.statusCode, 200);

    const restoredGoal = await app.inject({
      method: "GET",
      url: `/api/v1/goals/${goalId}`
    });
    assert.equal(restoredGoal.statusCode, 200);

    const restoredNotes = await app.inject({
      method: "GET",
      url: `/api/v1/notes?linkedEntityType=goal&linkedEntityId=${goalId}`,
      headers: { cookie: operatorCookie }
    });
    assert.ok(
      (restoredNotes.json() as { notes: Array<{ id: string }> }).notes.some(
        (entry) => entry.id === noteId
      )
    );

    const restoredInsight = await app.inject({
      method: "GET",
      url: `/api/v1/insights/${insightId}`,
      headers: { cookie: operatorCookie }
    });
    assert.equal(restoredInsight.statusCode, 200);

    const hardDeletedInsight = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: { cookie: operatorCookie },
      payload: {
        operations: [{ entityType: "insight", id: insightId, mode: "hard" }]
      }
    });
    assert.equal(hardDeletedInsight.statusCode, 200);

    const insightAfterHardDelete = await app.inject({
      method: "GET",
      url: `/api/v1/insights/${insightId}`,
      headers: { cookie: operatorCookie }
    });
    assert.equal(insightAfterHardDelete.statusCode, 404);

    const binAfterHardDelete = await app.inject({
      method: "GET",
      url: "/api/v1/settings/bin",
      headers: { cookie: operatorCookie }
    });
    const binAfterHardDeleteBody = binAfterHardDelete.json() as {
      bin: {
        records: Array<{ entityType: string; entityId: string }>;
      };
    };
    assert.ok(
      !binAfterHardDeleteBody.bin.records.some(
        (record) =>
          record.entityType === "insight" && record.entityId === insightId
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("atomic batch create rolls back earlier successes when a later operation fails", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-atomic-batch-create-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const beforeResponse = await app.inject({
      method: "GET",
      url: "/api/v1/goals"
    });
    const beforeCount = (
      beforeResponse.json() as { goals: Array<{ id: string }> }
    ).goals.length;

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie: operatorCookie },
      payload: {
        atomic: true,
        operations: [
          {
            entityType: "goal",
            clientRef: "goal-a",
            data: {
              title: "Atomic rollback guardrail",
              description: "Should not persist if the batch fails."
            }
          },
          {
            entityType: "task",
            clientRef: "task-b",
            data: {
              title: ""
            }
          }
        ]
      }
    });

    assert.equal(createResponse.statusCode, 200);
    const createBody = createResponse.json() as {
      results: Array<{
        ok: boolean;
        clientRef?: string;
        error?: { code: string };
      }>;
    };
    assert.equal(createBody.results[0]?.ok, false);
    assert.equal(createBody.results[0]?.error?.code, "rolled_back");
    assert.equal(createBody.results[1]?.ok, false);
    assert.equal(createBody.results[1]?.error?.code, "validation_failed");

    const afterResponse = await app.inject({
      method: "GET",
      url: "/api/v1/goals"
    });
    const afterGoals = (
      afterResponse.json() as { goals: Array<{ id: string; title: string }> }
    ).goals;
    assert.equal(afterGoals.length, beforeCount);
    assert.ok(
      !afterGoals.some((goal) => goal.title === "Atomic rollback guardrail")
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("direct health CRUD routes create, read, and delete manual sleep and workout sessions", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-direct-health-crud-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const createSleep = await app.inject({
      method: "POST",
      url: "/api/v1/health/sleep",
      headers: { cookie: operatorCookie },
      payload: {
        startedAt: "2026-04-10T22:45:00.000Z",
        endedAt: "2026-04-11T06:45:00.000Z",
        qualitySummary: "Slept cleanly after a light evening.",
        tags: ["recovered"]
      }
    });
    assert.equal(createSleep.statusCode, 201);
    const createSleepBody = createSleep.json() as {
      sleep: {
        id: string;
        externalUid: string;
        source: string;
        sourceType: string;
        timeInBedSeconds: number;
        asleepSeconds: number;
      };
    };
    assert.equal(createSleepBody.sleep.source, "manual");
    assert.equal(createSleepBody.sleep.sourceType, "manual");
    assert.ok(createSleepBody.sleep.externalUid.length > 0);
    assert.equal(createSleepBody.sleep.timeInBedSeconds, 8 * 60 * 60);
    assert.equal(createSleepBody.sleep.asleepSeconds, 8 * 60 * 60);

    const getSleep = await app.inject({
      method: "GET",
      url: `/api/v1/health/sleep/${createSleepBody.sleep.id}`
    });
    assert.equal(getSleep.statusCode, 200);
    const getSleepBody = getSleep.json() as {
      sleep: { id: string; annotations?: { qualitySummary?: string } };
    };
    assert.equal(getSleepBody.sleep.id, createSleepBody.sleep.id);
    assert.equal(
      getSleepBody.sleep.annotations?.qualitySummary,
      "Slept cleanly after a light evening."
    );

    const deleteSleep = await app.inject({
      method: "DELETE",
      url: `/api/v1/health/sleep/${createSleepBody.sleep.id}`,
      headers: { cookie: operatorCookie }
    });
    assert.equal(deleteSleep.statusCode, 200);

    const missingSleep = await app.inject({
      method: "GET",
      url: `/api/v1/health/sleep/${createSleepBody.sleep.id}`
    });
    assert.equal(missingSleep.statusCode, 404);

    const createWorkout = await app.inject({
      method: "POST",
      url: "/api/v1/health/workouts",
      headers: { cookie: operatorCookie },
      payload: {
        workoutType: "walk",
        startedAt: "2026-04-11T10:00:00.000Z",
        endedAt: "2026-04-11T10:45:00.000Z",
        subjectiveEffort: 6,
        meaningText: "Reset after a long planning block."
      }
    });
    assert.equal(createWorkout.statusCode, 201);
    const createWorkoutBody = createWorkout.json() as {
      workout: {
        id: string;
        externalUid: string;
        source: string;
        sourceType: string;
        durationSeconds: number;
      };
    };
    assert.equal(createWorkoutBody.workout.source, "manual");
    assert.equal(createWorkoutBody.workout.sourceType, "manual");
    assert.ok(createWorkoutBody.workout.externalUid.length > 0);
    assert.equal(createWorkoutBody.workout.durationSeconds, 45 * 60);

    const getWorkout = await app.inject({
      method: "GET",
      url: `/api/v1/health/workouts/${createWorkoutBody.workout.id}`
    });
    assert.equal(getWorkout.statusCode, 200);
    const getWorkoutBody = getWorkout.json() as {
      workout: { id: string; meaningText: string };
    };
    assert.equal(getWorkoutBody.workout.id, createWorkoutBody.workout.id);
    assert.equal(
      getWorkoutBody.workout.meaningText,
      "Reset after a long planning block."
    );

    const deleteWorkout = await app.inject({
      method: "DELETE",
      url: `/api/v1/health/workouts/${createWorkoutBody.workout.id}`,
      headers: { cookie: operatorCookie }
    });
    assert.equal(deleteWorkout.statusCode, 200);

    const missingWorkout = await app.inject({
      method: "GET",
      url: `/api/v1/health/workouts/${createWorkoutBody.workout.id}`
    });
    assert.equal(missingWorkout.statusCode, 404);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("direct calendar get routes list and fetch events, work blocks, and timeboxes", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-direct-calendar-get-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const taskId = (
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/tasks"
        })
      ).json() as { tasks: Array<{ id: string }> }
    ).tasks[0]!.id;
    const projectId = (
      (
        await app.inject({
          method: "GET",
          url: "/api/v1/projects"
        })
      ).json() as { projects: Array<{ id: string }> }
    ).projects[0]!.id;

    const templateResponse = await app.inject({
      method: "POST",
      url: "/api/v1/calendar/work-block-templates",
      headers: { cookie: operatorCookie },
      payload: {
        title: "Secondary Activity",
        kind: "secondary_activity",
        color: "#38bdf8",
        timezone: "Europe/Zurich",
        weekDays: [1, 3, 5],
        startMinute: 780,
        endMinute: 1020,
        blockingState: "allowed"
      }
    });
    assert.equal(templateResponse.statusCode, 201);
    const templateId = (templateResponse.json() as { template: { id: string } })
      .template.id;

    const timeboxResponse = await app.inject({
      method: "POST",
      url: "/api/v1/calendar/timeboxes",
      headers: { cookie: operatorCookie },
      payload: {
        taskId,
        projectId,
        title: "Draft the paper outline",
        startsAt: "2026-04-07T09:30:00.000Z",
        endsAt: "2026-04-07T10:30:00.000Z",
        source: "suggested"
      }
    });
    assert.equal(timeboxResponse.statusCode, 201);
    const timeboxId = (timeboxResponse.json() as { timebox: { id: string } })
      .timebox.id;

    const eventResponse = await app.inject({
      method: "POST",
      url: "/api/v1/calendar/events",
      headers: { cookie: operatorCookie },
      payload: {
        title: "Generic batch planning review",
        startAt: "2026-04-07T08:00:00.000Z",
        endAt: "2026-04-07T09:00:00.000Z",
        timezone: "Europe/Zurich",
        links: [
          {
            entityType: "project",
            entityId: projectId,
            relationshipType: "meeting_for"
          }
        ]
      }
    });
    assert.equal(eventResponse.statusCode, 201);
    const eventId = (eventResponse.json() as { event: { id: string } }).event
      .id;

    const listEvents = await app.inject({
      method: "GET",
      url: "/api/v1/calendar/events?from=2026-04-06T00:00:00.000Z&to=2026-04-08T00:00:00.000Z"
    });
    assert.equal(listEvents.statusCode, 200);
    const listEventsBody = listEvents.json() as {
      events: Array<{ id: string }>;
    };
    assert.ok(listEventsBody.events.some((event) => event.id === eventId));

    const getEvent = await app.inject({
      method: "GET",
      url: `/api/v1/calendar/events/${eventId}`
    });
    assert.equal(getEvent.statusCode, 200);
    assert.equal(
      (getEvent.json() as { event: { id: string } }).event.id,
      eventId
    );

    const getTemplate = await app.inject({
      method: "GET",
      url: `/api/v1/calendar/work-block-templates/${templateId}`
    });
    assert.equal(getTemplate.statusCode, 200);
    assert.equal(
      (getTemplate.json() as { template: { id: string } }).template.id,
      templateId
    );

    const getTimebox = await app.inject({
      method: "GET",
      url: `/api/v1/calendar/timeboxes/${timeboxId}`
    });
    assert.equal(getTimebox.statusCode, 200);
    assert.equal(
      (getTimebox.json() as { timebox: { id: string } }).timebox.id,
      timeboxId
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("direct preferences list and get routes work, and questionnaire instruments patch and delete through the direct route", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-direct-preferences-questionnaires-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const createCatalog = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/catalogs",
      headers: { cookie: operatorCookie },
      payload: {
        userId: "user_operator",
        domain: "food",
        title: "Cafe shortlist",
        description: "Places to compare for breakfast meetings.",
        slug: "cafe-shortlist"
      }
    });
    assert.equal(createCatalog.statusCode, 201);
    const catalogId = (createCatalog.json() as { catalog: { id: string } })
      .catalog.id;

    const createCatalogItem = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/catalog-items",
      headers: { cookie: operatorCookie },
      payload: {
        catalogId,
        label: "Neighborhood bakery",
        description: "A comparison candidate.",
        tags: ["bakery"],
        featureWeights: {
          novelty: 0.2,
          simplicity: 0.4,
          rigor: 0,
          aesthetics: 0.3,
          depth: 0,
          structure: 0.1,
          familiarity: 0.6,
          surprise: 0.1
        },
        position: 0
      }
    });
    assert.equal(createCatalogItem.statusCode, 201);
    const catalogItemId = (createCatalogItem.json() as { item: { id: string } })
      .item.id;

    const createContext = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/contexts",
      headers: { cookie: operatorCookie },
      payload: {
        userId: "user_operator",
        domain: "food",
        name: "Work breakfasts",
        description: "Preference slice for work-day breakfast choices.",
        shareMode: "blended",
        active: true,
        isDefault: false,
        decayDays: 60
      }
    });
    assert.equal(createContext.statusCode, 201);
    const contextId = (createContext.json() as { context: { id: string } })
      .context.id;

    const createItem = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/items",
      headers: { cookie: operatorCookie },
      payload: {
        userId: "user_operator",
        domain: "food",
        label: "Flat white",
        description: "Reliable coffee choice.",
        tags: ["coffee"],
        featureWeights: {
          novelty: 0,
          simplicity: 0.7,
          rigor: 0,
          aesthetics: 0.1,
          depth: 0,
          structure: 0.2,
          familiarity: 0.9,
          surprise: -0.3
        }
      }
    });
    assert.equal(createItem.statusCode, 201);
    const itemId = (createItem.json() as { item: { id: string } }).item.id;

    const listCatalogs = await app.inject({
      method: "GET",
      url: "/api/v1/preferences/catalogs"
    });
    assert.equal(listCatalogs.statusCode, 200);
    assert.ok(
      (
        listCatalogs.json() as { catalogs: Array<{ id: string }> }
      ).catalogs.some((catalog) => catalog.id === catalogId)
    );

    const listCatalogItems = await app.inject({
      method: "GET",
      url: "/api/v1/preferences/catalog-items"
    });
    assert.equal(listCatalogItems.statusCode, 200);
    assert.ok(
      (listCatalogItems.json() as { items: Array<{ id: string }> }).items.some(
        (item) => item.id === catalogItemId
      )
    );

    const listContexts = await app.inject({
      method: "GET",
      url: "/api/v1/preferences/contexts"
    });
    assert.equal(listContexts.statusCode, 200);
    assert.ok(
      (
        listContexts.json() as { contexts: Array<{ id: string }> }
      ).contexts.some((context) => context.id === contextId)
    );

    const listItems = await app.inject({
      method: "GET",
      url: "/api/v1/preferences/items"
    });
    assert.equal(listItems.statusCode, 200);
    assert.ok(
      (listItems.json() as { items: Array<{ id: string }> }).items.some(
        (item) => item.id === itemId
      )
    );

    const getCatalog = await app.inject({
      method: "GET",
      url: `/api/v1/preferences/catalogs/${catalogId}`
    });
    assert.equal(getCatalog.statusCode, 200);

    const getCatalogItem = await app.inject({
      method: "GET",
      url: `/api/v1/preferences/catalog-items/${catalogItemId}`
    });
    assert.equal(getCatalogItem.statusCode, 200);

    const getContext = await app.inject({
      method: "GET",
      url: `/api/v1/preferences/contexts/${contextId}`
    });
    assert.equal(getContext.statusCode, 200);

    const getItem = await app.inject({
      method: "GET",
      url: `/api/v1/preferences/items/${itemId}`
    });
    assert.equal(getItem.statusCode, 200);

    const createQuestionnaire = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/questionnaires",
      headers: { cookie: operatorCookie },
      payload: {
        title: "Tiny check-in",
        subtitle: "Custom",
        description: "One question custom instrument.",
        aliases: [],
        symptomDomains: ["check-in"],
        tags: ["custom"],
        sourceClass: "secondary_verified",
        availability: "custom",
        isSelfReport: true,
        userId: "user_operator",
        versionLabel: "Draft 1",
        definition: {
          locale: "en",
          instructions: "Rate how present this feels today.",
          completionNote: "",
          presentationMode: "single_question",
          responseStyle: "four_point_frequency",
          itemIds: ["check_1"],
          items: [
            {
              id: "check_1",
              prompt: "I feel grounded.",
              shortLabel: "",
              description: "",
              helperText: "",
              required: true,
              tags: [],
              options: [
                { key: "0", label: "Not at all", value: 0, description: "" },
                { key: "1", label: "A little", value: 1, description: "" },
                { key: "2", label: "Mostly", value: 2, description: "" },
                { key: "3", label: "Strongly", value: 3, description: "" }
              ]
            }
          ],
          sections: [
            {
              id: "check",
              title: "Check",
              description: "",
              itemIds: ["check_1"]
            }
          ],
          pageSize: null
        },
        scoring: {
          scores: [
            {
              key: "total",
              label: "Total",
              description: "",
              valueType: "number",
              expression: { kind: "sum", itemIds: ["check_1"] },
              dependsOnItemIds: ["check_1"],
              missingPolicy: { mode: "require_all" },
              bands: [{ label: "Strong", min: 3, max: 3, severity: "" }],
              roundTo: null,
              unitLabel: ""
            }
          ]
        },
        provenance: {
          retrievalDate: "2026-04-06",
          sourceClass: "secondary_verified",
          scoringNotes: "Sum the one item.",
          sources: [
            {
              label: "Local draft",
              url: "https://example.com/draft",
              citation: "Local draft questionnaire",
              notes: ""
            }
          ]
        }
      }
    });
    assert.equal(createQuestionnaire.statusCode, 201);
    const questionnaireId = (
      createQuestionnaire.json() as { instrument: { id: string } }
    ).instrument.id;

    const patchQuestionnaire = await app.inject({
      method: "PATCH",
      url: `/api/v1/psyche/questionnaires/${questionnaireId}`,
      headers: { cookie: operatorCookie },
      payload: {
        title: "Tiny weekly check-in"
      }
    });
    assert.equal(patchQuestionnaire.statusCode, 200);
    assert.equal(
      (patchQuestionnaire.json() as { instrument: { title: string } })
        .instrument.title,
      "Tiny weekly check-in"
    );

    const deleteQuestionnaire = await app.inject({
      method: "DELETE",
      url: `/api/v1/psyche/questionnaires/${questionnaireId}`,
      headers: { cookie: operatorCookie }
    });
    assert.equal(deleteQuestionnaire.statusCode, 200);
    assert.equal(
      (deleteQuestionnaire.json() as { instrument: { id: string } }).instrument
        .id,
      questionnaireId
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("batch entity routes create, update, and search entities through the shared capability matrix", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-batch-entity-routes-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie: operatorCookie },
      payload: {
        operations: [
          {
            entityType: "goal",
            clientRef: "goal-release",
            data: {
              title: "Publish the Forge OpenClaw plugin",
              description: "Ship the public plugin package, docs, and tests."
            }
          }
        ]
      }
    });

    assert.equal(createResponse.statusCode, 200);
    const createBody = createResponse.json() as {
      results: Array<{ ok: boolean; entity?: { id: string; title: string } }>;
    };
    assert.equal(createBody.results[0]?.ok, true);
    assert.equal(
      createBody.results[0]?.entity?.title,
      "Publish the Forge OpenClaw plugin"
    );
    const createdGoalId = createBody.results[0]?.entity?.id;
    assert.ok(createdGoalId);

    const updateResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/update",
      headers: { cookie: operatorCookie },
      payload: {
        operations: [
          {
            entityType: "goal",
            id: createdGoalId,
            patch: {
              description:
                "Ship the public plugin package, docs, tests, and release workflow."
            }
          }
        ]
      }
    });

    assert.equal(updateResponse.statusCode, 200);
    const updateBody = updateResponse.json() as {
      results: Array<{
        ok: boolean;
        entity?: { id: string; description: string };
      }>;
    };
    assert.equal(updateBody.results[0]?.ok, true);
    assert.equal(
      updateBody.results[0]?.entity?.description,
      "Ship the public plugin package, docs, tests, and release workflow."
    );

    const searchResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: { cookie: operatorCookie },
      payload: {
        searches: [
          {
            entityTypes: ["goal"],
            query: "OpenClaw plugin",
            limit: 5
          }
        ]
      }
    });

    assert.equal(searchResponse.statusCode, 200);
    const searchBody = searchResponse.json() as {
      results: Array<{
        ok: boolean;
        matches?: Array<{ entityType: string; id: string }>;
      }>;
    };
    assert.equal(searchBody.results[0]?.ok, true);
    assert.ok(
      searchBody.results[0]?.matches?.some(
        (match) => match.entityType === "goal" && match.id === createdGoalId
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("batch habit updates can record official habit outcomes through patch.checkIn", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-batch-habit-check-in-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie: operatorCookie },
      payload: {
        operations: [
          {
            entityType: "habit",
            data: {
              title: "Resist doomscrolling",
              description: "Treat late-night doomscrolling as a resisted slip.",
              polarity: "negative",
              frequency: "daily"
            }
          }
        ]
      }
    });

    assert.equal(createResponse.statusCode, 200);
    const createdHabitId = (
      createResponse.json() as {
        results: Array<{ entity?: { id: string } }>;
      }
    ).results[0]?.entity?.id;
    assert.ok(createdHabitId);

    const updateResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/update",
      headers: { cookie: operatorCookie },
      payload: {
        operations: [
          {
            entityType: "habit",
            id: createdHabitId,
            patch: {
              checkIn: {
                status: "missed",
                dateKey: "2026-04-22",
                note: "Resisted the urge after dinner.",
                description: "85 sec reset"
              }
            }
          }
        ]
      }
    });

    assert.equal(updateResponse.statusCode, 200);
    const updatedHabit = (
      updateResponse.json() as {
        results: Array<{
          ok: boolean;
          entity?: {
            description: string;
            lastCheckInStatus: string | null;
            checkIns: Array<{ dateKey: string; status: string; note: string }>;
          };
        }>;
      }
    ).results[0];
    assert.equal(updatedHabit?.ok, true);
    assert.equal(updatedHabit?.entity?.description, "85 sec reset");
    assert.equal(updatedHabit?.entity?.lastCheckInStatus, "missed");
    assert.equal(updatedHabit?.entity?.checkIns[0]?.dateKey, "2026-04-22");
    assert.equal(updatedHabit?.entity?.checkIns[0]?.status, "missed");
    assert.equal(
      updatedHabit?.entity?.checkIns[0]?.note,
      "Resisted the urge after dinner."
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("calendar entities work through the generic batch routes and keep calendar-specific side effects", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-batch-calendar-entities-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const tasksResponse = await app.inject({
      method: "GET",
      url: "/api/v1/tasks"
    });
    const projectsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/projects"
    });
    const taskId = (tasksResponse.json() as { tasks: Array<{ id: string }> })
      .tasks[0]!.id;
    const projectId = (
      projectsResponse.json() as { projects: Array<{ id: string }> }
    ).projects[0]!.id;

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie: operatorCookie },
      payload: {
        operations: [
          {
            entityType: "calendar_event",
            clientRef: "event-a",
            data: {
              title: "Generic batch planning review",
              startAt: "2026-04-07T08:00:00.000Z",
              endAt: "2026-04-07T09:00:00.000Z",
              timezone: "Europe/Zurich",
              preferredCalendarId: null,
              links: [
                {
                  entityType: "project",
                  entityId: projectId,
                  relationshipType: "meeting_for"
                }
              ]
            }
          },
          {
            entityType: "work_block_template",
            clientRef: "block-a",
            data: {
              title: "Secondary Activity",
              kind: "secondary_activity",
              color: "#38bdf8",
              timezone: "Europe/Zurich",
              weekDays: [1, 3, 5],
              startMinute: 780,
              endMinute: 1020,
              blockingState: "allowed"
            }
          },
          {
            entityType: "task_timebox",
            clientRef: "timebox-a",
            data: {
              taskId,
              projectId,
              title: "Draft the paper outline",
              startsAt: "2026-04-07T09:30:00.000Z",
              endsAt: "2026-04-07T10:30:00.000Z",
              source: "suggested"
            }
          }
        ]
      }
    });

    assert.equal(createResponse.statusCode, 200);
    const createBody = createResponse.json() as {
      results: Array<{
        ok: boolean;
        entityType?: string;
        entity?: { id: string; title: string; originType?: string };
      }>;
    };
    assert.equal(
      createBody.results.every((result) => result.ok),
      true
    );
    const createdEvent = createBody.results.find(
      (result) => result.entityType === "calendar_event"
    )?.entity;
    const createdBlock = createBody.results.find(
      (result) => result.entityType === "work_block_template"
    )?.entity;
    const createdTimebox = createBody.results.find(
      (result) => result.entityType === "task_timebox"
    )?.entity;
    assert.ok(createdEvent?.id);
    assert.equal(createdEvent?.originType, "native");
    assert.ok(createdBlock?.id);
    assert.ok(createdTimebox?.id);

    const updateResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/update",
      headers: { cookie: operatorCookie },
      payload: {
        operations: [
          {
            entityType: "calendar_event",
            id: createdEvent!.id,
            patch: {
              title: "Generic batch planning review moved",
              startAt: "2026-04-07T08:30:00.000Z",
              endAt: "2026-04-07T09:30:00.000Z"
            }
          },
          {
            entityType: "work_block_template",
            id: createdBlock!.id,
            patch: {
              title: "Secondary Activity Updated"
            }
          },
          {
            entityType: "task_timebox",
            id: createdTimebox!.id,
            patch: {
              status: "active"
            }
          }
        ]
      }
    });

    assert.equal(updateResponse.statusCode, 200);
    const updateBody = updateResponse.json() as {
      results: Array<{
        ok: boolean;
        entityType?: string;
        entity?: { title?: string; status?: string };
      }>;
    };
    assert.equal(
      updateBody.results.every((result) => result.ok),
      true
    );
    assert.equal(
      updateBody.results.find(
        (result) => result.entityType === "calendar_event"
      )?.entity?.title,
      "Generic batch planning review moved"
    );
    assert.equal(
      updateBody.results.find(
        (result) => result.entityType === "work_block_template"
      )?.entity?.title,
      "Secondary Activity Updated"
    );
    assert.equal(
      updateBody.results.find((result) => result.entityType === "task_timebox")
        ?.entity?.status,
      "active"
    );

    const deleteResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/delete",
      headers: { cookie: operatorCookie },
      payload: {
        operations: [
          { entityType: "calendar_event", id: createdEvent!.id },
          { entityType: "work_block_template", id: createdBlock!.id },
          { entityType: "task_timebox", id: createdTimebox!.id }
        ]
      }
    });

    assert.equal(deleteResponse.statusCode, 200);
    const deleteBody = deleteResponse.json() as {
      results: Array<{
        ok: boolean;
        entityType?: string;
        entity?: { id: string };
      }>;
    };
    assert.equal(
      deleteBody.results.every((result) => result.ok),
      true
    );

    const overviewAfterDelete = await app.inject({
      method: "GET",
      url: "/api/v1/calendar/overview?from=2026-04-06T00:00:00.000Z&to=2026-04-08T00:00:00.000Z"
    });
    const overviewBody = overviewAfterDelete.json() as {
      calendar: {
        events: Array<{ id: string }>;
        workBlockTemplates: Array<{ id: string }>;
        timeboxes: Array<{ id: string }>;
      };
    };
    assert.ok(
      !overviewBody.calendar.events.some(
        (event) => event.id === createdEvent!.id
      )
    );
    assert.ok(
      !overviewBody.calendar.workBlockTemplates.some(
        (template) => template.id === createdBlock!.id
      )
    );
    assert.ok(
      !overviewBody.calendar.timeboxes.some(
        (timebox) => timebox.id === createdTimebox!.id
      )
    );

    const binResponse = await app.inject({
      method: "GET",
      url: "/api/v1/settings/bin",
      headers: { cookie: operatorCookie }
    });
    const binBody = binResponse.json() as {
      bin: {
        records: Array<{ entityType: string; entityId: string }>;
      };
    };
    assert.ok(
      !binBody.bin.records.some(
        (record) =>
          record.entityType === "calendar_event" &&
          record.entityId === createdEvent!.id
      )
    );
    assert.ok(
      !binBody.bin.records.some(
        (record) =>
          record.entityType === "work_block_template" &&
          record.entityId === createdBlock!.id
      )
    );
    assert.ok(
      !binBody.bin.records.some(
        (record) =>
          record.entityType === "task_timebox" &&
          record.entityId === createdTimebox!.id
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("calendar events omit preferredCalendarId to use the default writable calendar", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-calendar-default-writable-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const database = getDatabase();
    database
      .prepare(
        `INSERT INTO stored_secrets (id, cipher_text, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        "secret_default_write",
        "{}",
        "default writable calendar test secret",
        "2026-04-03T00:00:00.000Z",
        "2026-04-03T00:00:00.000Z"
      );
    database
      .prepare(
        `INSERT INTO calendar_connections (
           id, provider, label, account_label, status, config_json, credentials_secret_id, forge_calendar_id, last_synced_at, last_sync_error, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, 'connected', ?, ?, NULL, NULL, NULL, ?, ?)`
      )
      .run(
        "calconn_default_write",
        "caldav",
        "Default write calendar",
        "operator@example.com",
        "{}",
        "secret_default_write",
        "2026-04-03T00:00:00.000Z",
        "2026-04-03T00:00:00.000Z"
      );
    database
      .prepare(
        `INSERT INTO calendar_calendars (
           id, connection_id, remote_id, title, description, color, timezone, is_primary, can_write, forge_managed, selected_for_sync, last_synced_at, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, NULL, ?, ?)`
      )
      .run(
        "calendar_default_write",
        "calconn_default_write",
        "https://caldav.example.com/calendars/forge/",
        "Forge",
        "Dedicated Forge calendar",
        "#7dd3fc",
        "Europe/Zurich",
        "2026-04-03T00:00:00.000Z",
        "2026-04-03T00:00:00.000Z"
      );
    database
      .prepare(
        `UPDATE calendar_connections
         SET forge_calendar_id = ?
         WHERE id = ?`
      )
      .run("calendar_default_write", "calconn_default_write");

    const syncedEvent = createCalendarEvent({
      title: "Auto-sync event",
      description: "",
      location: "",
      place: {
        label: "",
        address: "",
        timezone: "",
        latitude: null,
        longitude: null,
        source: "",
        externalPlaceId: ""
      },
      startAt: "2026-04-08T11:00:00.000Z",
      endAt: "2026-04-08T12:00:00.000Z",
      timezone: "Europe/Zurich",
      isAllDay: false,
      availability: "busy",
      eventType: "",
      categories: [],
      links: []
    });

    assert.equal(syncedEvent.calendarId, "calendar_default_write");
    assert.equal(syncedEvent.connectionId, "calconn_default_write");

    const forgeOnlyEvent = createCalendarEvent({
      title: "Explicit Forge-only event",
      description: "",
      location: "",
      place: {
        label: "",
        address: "",
        timezone: "",
        latitude: null,
        longitude: null,
        source: "",
        externalPlaceId: ""
      },
      startAt: "2026-04-08T13:00:00.000Z",
      endAt: "2026-04-08T14:00:00.000Z",
      timezone: "Europe/Zurich",
      isAllDay: false,
      availability: "busy",
      eventType: "",
      categories: [],
      preferredCalendarId: null,
      links: []
    });

    assert.equal(forgeOnlyEvent.calendarId, null);
    assert.equal(forgeOnlyEvent.connectionId, null);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("preferences workspace supports items, entity enqueue, judgments, signals, and contexts", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-preferences-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const userDirectoryResponse = await app.inject({
      method: "GET",
      url: "/api/v1/users",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(userDirectoryResponse.statusCode, 200);
    const userId = (
      userDirectoryResponse.json() as {
        users: Array<{ id: string }>;
      }
    ).users[0]?.id;
    assert.ok(userId);

    const workspaceResponse = await app.inject({
      method: "GET",
      url: `/api/v1/preferences/workspace?userId=${userId}&domain=projects`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(workspaceResponse.statusCode, 200);
    const initialWorkspace = (
      workspaceResponse.json() as {
        workspace: {
          selectedContext: { id: string };
          contexts: Array<{ id: string; name: string }>;
          summary: { totalItems: number };
        };
      }
    ).workspace;
    assert.ok(initialWorkspace.contexts.length >= 1);

    const createItemResponse = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/items",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        userId,
        domain: "projects",
        label: "Narrative operating style",
        description: "Preference for deep, structured project execution.",
        tags: ["writing", "focus"],
        featureWeights: {
          novelty: -0.1,
          simplicity: 0.2,
          rigor: 0.85,
          aesthetics: 0.35,
          depth: 0.9,
          structure: 0.8,
          familiarity: 0.15,
          surprise: -0.2
        },
        queueForCompare: true
      }
    });
    assert.equal(createItemResponse.statusCode, 201);
    const createdItemId = (
      createItemResponse.json() as { item: { id: string } }
    ).item.id;

    const goalsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/goals"
    });
    const goalId = (goalsResponse.json() as { goals: Array<{ id: string }> })
      .goals[0]?.id;
    assert.ok(goalId);

    const enqueueEntityResponse = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/items/from-entity",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        userId,
        domain: "projects",
        entityType: "goal",
        entityId: goalId
      }
    });
    assert.equal(enqueueEntityResponse.statusCode, 201);
    const linkedItemId = (
      enqueueEntityResponse.json() as { item: { id: string } }
    ).item.id;

    const createContextResponse = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/contexts",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        userId,
        domain: "projects",
        name: "Deep work",
        description: "Preference state for deliberate project work.",
        shareMode: "isolated",
        active: true,
        isDefault: false,
        decayDays: 45
      }
    });
    assert.equal(createContextResponse.statusCode, 201);
    const createdContext = (
      createContextResponse.json() as { context: { id: string; name: string } }
    ).context;
    assert.equal(createdContext.name, "Deep work");

    const judgmentResponse = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/judgments",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        userId,
        domain: "projects",
        contextId: initialWorkspace.selectedContext.id,
        leftItemId: createdItemId,
        rightItemId: linkedItemId,
        outcome: "left",
        strength: 1.5
      }
    });
    assert.equal(judgmentResponse.statusCode, 201);

    const signalResponse = await app.inject({
      method: "POST",
      url: "/api/v1/preferences/signals",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        userId,
        domain: "projects",
        contextId: initialWorkspace.selectedContext.id,
        itemId: createdItemId,
        signalType: "favorite",
        strength: 1
      }
    });
    assert.equal(signalResponse.statusCode, 201);

    const scoreResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/preferences/items/${createdItemId}/score`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        userId,
        domain: "projects",
        contextId: initialWorkspace.selectedContext.id,
        manualStatus: "favorite",
        bookmarked: true,
        compareLater: false
      }
    });
    assert.equal(scoreResponse.statusCode, 200);
    const patchedWorkspace = (
      scoreResponse.json() as {
        workspace: {
          contexts: Array<{ id: string; name: string }>;
          history: {
            judgments: Array<{ id: string }>;
            signals: Array<{ id: string }>;
          };
          scores: Array<{
            itemId: string;
            manualStatus: string | null;
            bookmarked: boolean;
          }>;
        };
      }
    ).workspace;
    assert.ok(
      patchedWorkspace.contexts.some((context) => context.name === "Deep work")
    );
    assert.ok(patchedWorkspace.history.judgments.length >= 1);
    assert.ok(patchedWorkspace.history.signals.length >= 1);
    const patchedScore = patchedWorkspace.scores.find(
      (score) => score.itemId === createdItemId
    );
    assert.equal(patchedScore?.manualStatus, "favorite");
    assert.equal(patchedScore?.bookmarked, true);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("batch entity routes require auth and return validation failures with machine-readable details", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-batch-entity-errors-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const unauthenticated = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      payload: {
        searches: [{ entityTypes: ["goal"], query: "plugin", limit: 5 }]
      }
    });

    assert.equal(unauthenticated.statusCode, 401);
    const unauthenticatedBody = unauthenticated.json() as {
      code: string;
      route: string;
      requiredScopes: string[];
    };
    assert.equal(unauthenticatedBody.code, "auth_required");
    assert.equal(unauthenticatedBody.route, "/api/v1/entities/search");
    assert.deepEqual(unauthenticatedBody.requiredScopes, ["read", "write"]);

    const operatorCookie = await issueOperatorSessionCookie(app);
    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: { cookie: operatorCookie },
      payload: {
        operations: [{ entityType: "goal", query: "plugin" }]
      }
    });

    assert.equal(invalid.statusCode, 400);
    const invalidBody = invalid.json() as {
      code: string;
      error: string;
      route: string;
      validationSummary: string;
      details: Array<{ path: string; message: string }>;
      expectedShape: {
        toolName: string;
        inputShape: string;
        requiredFields: string[];
        example: string | null;
        notes: string[];
      };
    };
    assert.equal(invalidBody.code, "invalid_request");
    assert.equal(invalidBody.route, "/api/v1/entities/search");
    assert.match(
      invalidBody.error,
      /Request validation failed for POST \/api\/v1\/entities\/search/
    );
    assert.match(invalidBody.validationSummary, /searches/);
    assert.ok(invalidBody.details.some((detail) => detail.path === "searches"));
    assert.equal(invalidBody.expectedShape.toolName, "forge_search_entities");
    assert.match(invalidBody.expectedShape.inputShape, /searches:/);
    assert.ok(invalidBody.expectedShape.requiredFields.includes("searches"));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("work blocks support holiday ranges without storing repeated daily rows", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-work-block-ranges-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const instanceTable = getDatabase()
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'work_block_instances'`
      )
      .get() as { name: string } | undefined;
    assert.equal(instanceTable, undefined);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/calendar/work-block-templates",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Summer holiday",
        kind: "holiday",
        color: "#14b8a6",
        timezone: "Europe/Zurich",
        weekDays: [0, 1, 2, 3, 4, 5, 6],
        startMinute: 0,
        endMinute: 1440,
        startsOn: "2026-08-01",
        endsOn: "2026-08-16",
        blockingState: "blocked"
      }
    });

    assert.equal(created.statusCode, 201);
    const createdTemplate = (
      created.json() as {
        template: {
          id: string;
          kind: string;
          startsOn: string | null;
          endsOn: string | null;
        };
      }
    ).template;
    assert.equal(createdTemplate.kind, "holiday");
    assert.equal(createdTemplate.startsOn, "2026-08-01");
    assert.equal(createdTemplate.endsOn, "2026-08-16");

    const overview = await app.inject({
      method: "GET",
      url: "/api/v1/calendar/overview?from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z"
    });
    assert.equal(overview.statusCode, 200);
    const overviewBody = overview.json() as {
      calendar: {
        workBlockInstances: Array<{
          templateId: string;
          dateKey: string;
          kind: string;
        }>;
      };
    };
    assert.equal(overviewBody.calendar.workBlockInstances.length, 16);
    assert.ok(
      overviewBody.calendar.workBlockInstances.every(
        (instance) =>
          instance.templateId === createdTemplate.id &&
          instance.kind === "holiday" &&
          instance.dateKey >= "2026-08-01" &&
          instance.dateKey <= "2026-08-16"
      )
    );

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/calendar/work-block-templates/${createdTemplate.id}`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Summer holiday extended",
        endsOn: null
      }
    });
    assert.equal(patched.statusCode, 200);
    const patchedTemplate = (
      patched.json() as {
        template: { title: string; endsOn: string | null };
      }
    ).template;
    assert.equal(patchedTemplate.title, "Summer holiday extended");
    assert.equal(patchedTemplate.endsOn, null);

    const futureOverview = await app.inject({
      method: "GET",
      url: "/api/v1/calendar/overview?from=2026-09-01T00:00:00.000Z&to=2026-09-04T00:00:00.000Z"
    });
    assert.equal(futureOverview.statusCode, 200);
    const futureBody = futureOverview.json() as {
      calendar: {
        workBlockInstances: Array<{ dateKey: string }>;
      };
    };
    assert.equal(futureBody.calendar.workBlockInstances.length, 3);
    assert.deepEqual(
      futureBody.calendar.workBlockInstances.map(
        (instance) => instance.dateKey
      ),
      ["2026-09-01", "2026-09-02", "2026-09-03"]
    );

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/calendar/work-block-templates/${createdTemplate.id}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(deleted.statusCode, 200);

    const afterDelete = await app.inject({
      method: "GET",
      url: "/api/v1/calendar/work-block-templates"
    });
    assert.equal(afterDelete.statusCode, 200);
    assert.equal(
      (
        afterDelete.json() as { templates: Array<{ id: string }> }
      ).templates.some((template) => template.id === createdTemplate.id),
      false
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("CRUD capability matrix keeps user-facing delete/bin entities explicit", () => {
  const matrix = getCrudEntityCapabilityMatrix();
  const entityTypes = matrix.map((entry) => entry.entityType).sort();

  assert.deepEqual(entityTypes, [
    "behavior",
    "behavior_pattern",
    "belief_entry",
    "calendar_event",
    "emotion_definition",
    "event_type",
    "goal",
    "habit",
    "insight",
    "mode_guide_session",
    "mode_profile",
    "note",
    "preference_catalog",
    "preference_catalog_item",
    "preference_context",
    "preference_item",
    "project",
    "psyche_value",
    "questionnaire_instrument",
    "sleep_session",
    "strategy",
    "tag",
    "task",
    "task_timebox",
    "trigger_report",
    "work_block_template",
    "workout_session"
  ]);
  assert.ok(matrix.every((entry) => entry.pluginExposed === true));
  const immediateDeleteTypes = matrix
    .filter((entry) => entry.deleteMode === "immediate")
    .map((entry) => entry.entityType)
    .sort();
  assert.deepEqual(immediateDeleteTypes, [
    "calendar_event",
    "preference_catalog",
    "preference_catalog_item",
    "preference_context",
    "preference_item",
    "questionnaire_instrument",
    "sleep_session",
    "task_timebox",
    "work_block_template",
    "workout_session"
  ]);
  const binTypes = matrix
    .filter((entry) => entry.inBin)
    .map((entry) => entry.entityType);
  assert.ok(!binTypes.includes("calendar_event"));
  assert.ok(!binTypes.includes("work_block_template"));
  assert.ok(!binTypes.includes("task_timebox"));
  assert.ok(!binTypes.includes("sleep_session"));
  assert.ok(!binTypes.includes("workout_session"));
  assert.equal(
    matrix.find((entry) => entry.entityType === "sleep_session")?.routeBase,
    "/api/v1/health/sleep"
  );
  assert.equal(
    matrix.find((entry) => entry.entityType === "workout_session")?.routeBase,
    "/api/v1/health/workouts"
  );
});

test("settings and local agent token management persist through the versioned API", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-settings-api-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const settings = await app.inject({
      method: "GET",
      url: "/api/v1/settings",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(settings.statusCode, 200);
    const settingsBody = settings.json() as {
      settings: {
        themePreference: string;
        execution: { maxActiveTasks: number; timeAccountingMode: string };
        calendarProviders: {
          google: {
            clientId: string;
            clientSecret: string;
            appBaseUrl: string;
            redirectUri: string;
            isConfigured: boolean;
          };
          microsoft: {
            clientId: string;
            tenantId: string;
            redirectUri: string;
            isReadyForSignIn: boolean;
          };
        };
        agentTokens: Array<unknown>;
      };
    };
    assert.equal(settingsBody.settings.themePreference, "obsidian");
    assert.equal(settingsBody.settings.execution.maxActiveTasks, 2);
    assert.equal(settingsBody.settings.execution.timeAccountingMode, "split");
    assert.match(
      settingsBody.settings.calendarProviders.google.clientId,
      /\.apps\.googleusercontent\.com$/
    );
    assert.ok(
      settingsBody.settings.calendarProviders.google.clientSecret.length > 0
    );
    assert.equal(
      settingsBody.settings.calendarProviders.google.appBaseUrl,
      "http://127.0.0.1:4317"
    );
    assert.equal(
      settingsBody.settings.calendarProviders.google.redirectUri,
      "http://127.0.0.1:4317/api/v1/calendar/oauth/google/callback"
    );
    assert.equal(
      settingsBody.settings.calendarProviders.google.isConfigured,
      true
    );
    assert.equal(
      settingsBody.settings.calendarProviders.microsoft.clientId,
      ""
    );
    assert.equal(
      settingsBody.settings.calendarProviders.microsoft.tenantId,
      "common"
    );
    assert.equal(
      settingsBody.settings.calendarProviders.microsoft.redirectUri,
      "http://127.0.0.1:4317/api/v1/calendar/oauth/microsoft/callback"
    );
    assert.equal(
      settingsBody.settings.calendarProviders.microsoft.isReadyForSignIn,
      false
    );
    assert.equal(settingsBody.settings.agentTokens.length, 0);

    const updated = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        themePreference: "solar",
        execution: {
          maxActiveTasks: 3,
          timeAccountingMode: "parallel"
        },
        profile: {
          operatorName: "Albert",
          operatorEmail: "albert@example.com",
          operatorTitle: "Systems architect"
        },
        calendarProviders: {
          google: {
            clientId: "google-client-id-from-settings",
            clientSecret: "google-client-secret-from-settings"
          },
          microsoft: {
            clientId: "00000000-0000-0000-0000-000000000000",
            tenantId: "common",
            redirectUri:
              "http://127.0.0.1:4317/api/v1/calendar/oauth/microsoft/callback"
          }
        }
      }
    });
    assert.equal(updated.statusCode, 200);
    const updatedBody = updated.json() as {
      settings: {
        themePreference: string;
        execution: { maxActiveTasks: number; timeAccountingMode: string };
        profile: { operatorTitle: string };
        calendarProviders: {
          google: {
            clientId: string;
            clientSecret: string;
            isConfigured: boolean;
          };
          microsoft: { clientId: string; isReadyForSignIn: boolean };
        };
      };
    };
    assert.equal(updatedBody.settings.themePreference, "solar");
    assert.equal(updatedBody.settings.execution.maxActiveTasks, 3);
    assert.equal(updatedBody.settings.execution.timeAccountingMode, "parallel");
    assert.equal(
      updatedBody.settings.profile.operatorTitle,
      "Systems architect"
    );
    assert.equal(
      updatedBody.settings.calendarProviders.google.clientId,
      "google-client-id-from-settings"
    );
    assert.equal(
      updatedBody.settings.calendarProviders.google.clientSecret,
      "google-client-secret-from-settings"
    );
    assert.equal(
      updatedBody.settings.calendarProviders.google.isConfigured,
      true
    );
    assert.equal(
      updatedBody.settings.calendarProviders.microsoft.clientId,
      "00000000-0000-0000-0000-000000000000"
    );
    assert.equal(
      updatedBody.settings.calendarProviders.microsoft.isReadyForSignIn,
      true
    );

    const createdToken = await app.inject({
      method: "POST",
      url: "/api/v1/settings/tokens",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        label: "Forge Pilot",
        scopes: ["read", "write"],
        scopePolicy: {
          userIds: ["user_operator", "user_forge_bot"],
          projectIds: [],
          tagIds: []
        }
      }
    });
    assert.equal(createdToken.statusCode, 201);
    const createdTokenBody = createdToken.json() as {
      token: {
        token: string;
        tokenSummary: {
          id: string;
          status: string;
          bootstrapPolicy: {
            mode: string;
            projectsLimit: number;
            tasksLimit: number;
          };
          scopePolicy: {
            userIds: string[];
            projectIds: string[];
            tagIds: string[];
          };
        };
      };
    };
    assert.ok(createdTokenBody.token.token.startsWith("fg_live_"));
    assert.equal(createdTokenBody.token.tokenSummary.status, "active");
    assert.equal(
      createdTokenBody.token.tokenSummary.bootstrapPolicy.mode,
      "active_only"
    );
    assert.equal(
      createdTokenBody.token.tokenSummary.bootstrapPolicy.projectsLimit,
      8
    );
    assert.deepEqual(createdTokenBody.token.tokenSummary.scopePolicy, {
      userIds: ["user_operator", "user_forge_bot"],
      projectIds: [],
      tagIds: []
    });

    const settingsViaToken = await app.inject({
      method: "GET",
      url: "/api/v1/settings",
      headers: {
        authorization: `Bearer ${createdTokenBody.token.token}`
      }
    });
    assert.equal(settingsViaToken.statusCode, 200);
    assert.equal(
      (
        settingsViaToken.json() as {
          settings: { execution: { maxActiveTasks: number } };
        }
      ).settings.execution.maxActiveTasks,
      3
    );

    const updatedViaToken = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: {
        authorization: `Bearer ${createdTokenBody.token.token}`
      },
      payload: {
        execution: {
          maxActiveTasks: 4,
          timeAccountingMode: "primary_only"
        }
      }
    });
    assert.equal(updatedViaToken.statusCode, 200);
    const updatedViaTokenBody = updatedViaToken.json() as {
      settings: {
        execution: { maxActiveTasks: number; timeAccountingMode: string };
      };
    };
    assert.equal(updatedViaTokenBody.settings.execution.maxActiveTasks, 4);
    assert.equal(
      updatedViaTokenBody.settings.execution.timeAccountingMode,
      "primary_only"
    );

    const onboarding = await app.inject({
      method: "GET",
      url: "/api/v1/agents/onboarding",
      headers: {
        host: "127.0.0.1:4317"
      }
    });
    assert.equal(onboarding.statusCode, 200);
    const onboardingBody = onboarding.json() as {
      onboarding: {
        forgeBaseUrl: string;
        webAppUrl: string;
        openApiUrl: string;
        defaultConnectionMode: string;
        recommendedScopes: string[];
        recommendedAutonomyMode: string;
        defaultBootstrapPolicy: {
          mode: string;
          projectsLimit: number;
          tasksLimit: number;
        };
        effectiveBootstrapPolicy: {
          mode: string;
          projectsLimit: number;
          tasksLimit: number;
        };
        defaultScopePolicy: {
          userIds: string[];
          projectIds: string[];
          tagIds: string[];
        };
        effectiveScopePolicy: {
          userIds: string[];
          projectIds: string[];
          tagIds: string[];
        };
        authModes: { operatorSession: { tokenRequired: boolean } };
        tokenRecovery: {
          rawTokenStoredByForge: boolean;
          recoveryAction: string;
        };
        conceptModel: {
          goal: string;
          taskRun: string;
          note: string;
          sleepSession: string;
          workoutSession: string;
          preferences: string;
          questionnaire: string;
          selfObservation: string;
          movement: string;
          lifeForce: string;
          workbench: string;
          psyche: string;
        };
        psycheSubmoduleModel: {
          behaviorPattern: string;
          beliefEntry: string;
          schemaCatalog: string;
          triggerReport: string;
        };
        psycheCoachingPlaybooks: Array<{
          focus: string;
          askSequence: string[];
          requiredForCreate: string[];
          exampleQuestions: string[];
          notes: string[];
        }>;
        conversationRules: string[];
        entityConversationPlaybooks: Array<{
          focus: string;
          openingQuestion: string;
          coachingGoal: string;
          askSequence: string[];
        }>;
        relationshipModel: string[];
        entityCatalog: Array<{
          entityType: string;
          classification?: string;
          preferredMutationPath?: string;
          preferredReadPath?: string | null;
          preferredMutationTool?: string | null;
          minimumCreateFields: string[];
          relationshipRules: string[];
          fieldGuide: Array<{ name: string; required: boolean }>;
        }>;
        entityRouteModel: {
          batchCrudEntities: string[];
          specializedCrudEntities: Record<string, Record<string, string>>;
          actionEntities: Record<string, unknown>;
          specializedDomainSurfaces: Record<
            string,
            {
              summary: string;
              readRoutes: Record<string, string>;
              writeRoutes: Record<string, string>;
              notes: string[];
            }
          >;
          readModelOnlySurfaces: Record<string, string>;
        };
        toolInputCatalog: Array<{
          toolName: string;
          requiredFields: string[];
          inputShape: string;
        }>;
        verificationPaths: Record<string, string>;
        recommendedPluginTools: {
          bootstrap: string[];
          readModels: string[];
          uiWorkflow: string[];
          entityWorkflow: string[];
          healthWorkflow?: string[];
          calendarWorkflow: string[];
          workWorkflow: string[];
          insightWorkflow: string[];
        };
        interactionGuidance: {
          saveSuggestionPlacement: string;
          maxQuestionsPerTurn: number;
          psycheExplorationRule: string;
          psycheOpeningQuestionRule: string;
          duplicateCheckRoute: string;
          uiSuggestionRule: string;
          browserFallbackRule: string;
          writeConsentRule: string;
        };
        mutationGuidance: {
          deleteDefault: string;
          preferredBatchRoutes: {
            create: string;
            update: string;
            delete: string;
            restore: string;
            search: string;
          };
          batchingRule: string;
          searchRule: string;
          createRule: string;
          updateRule: string;
          createExample: string;
          updateExample: string;
        };
      };
    };
    assert.equal(
      onboardingBody.onboarding.forgeBaseUrl,
      "http://127.0.0.1:4317"
    );
    assert.equal(
      onboardingBody.onboarding.webAppUrl,
      "http://127.0.0.1:4317/forge/"
    );
    assert.equal(
      onboardingBody.onboarding.openApiUrl,
      "http://127.0.0.1:4317/api/v1/openapi.json"
    );
    assert.equal(
      onboardingBody.onboarding.defaultConnectionMode,
      "operator_session"
    );
    assert.equal(
      onboardingBody.onboarding.defaultBootstrapPolicy.mode,
      "active_only"
    );
    assert.equal(
      onboardingBody.onboarding.effectiveBootstrapPolicy.mode,
      "active_only"
    );
    assert.deepEqual(onboardingBody.onboarding.defaultScopePolicy, {
      userIds: [],
      projectIds: [],
      tagIds: []
    });
    assert.deepEqual(onboardingBody.onboarding.effectiveScopePolicy, {
      userIds: [],
      projectIds: [],
      tagIds: []
    });
    assert.deepEqual(onboardingBody.onboarding.recommendedScopes, [
      "read",
      "write",
      "insights",
      "rewards.manage",
      "psyche.read",
      "psyche.write",
      "psyche.note",
      "psyche.insight",
      "psyche.mode"
    ]);
    assert.equal(
      onboardingBody.onboarding.recommendedAutonomyMode,
      "approval_required"
    );
    assert.equal(
      onboardingBody.onboarding.authModes.operatorSession.tokenRequired,
      false
    );
    assert.equal(
      onboardingBody.onboarding.tokenRecovery.rawTokenStoredByForge,
      false
    );
    assert.equal(
      onboardingBody.onboarding.tokenRecovery.recoveryAction,
      "rotate_or_issue_new_token"
    );

    const onboardingViaToken = await app.inject({
      method: "GET",
      url: "/api/v1/agents/onboarding",
      headers: {
        authorization: `Bearer ${createdTokenBody.token.token}`,
        host: "127.0.0.1:4317"
      }
    });
    assert.equal(onboardingViaToken.statusCode, 200);
    assert.equal(
      (
        onboardingViaToken.json() as {
        onboarding: {
            effectiveBootstrapPolicy: { mode: string; tasksLimit: number };
            effectiveScopePolicy: {
              userIds: string[];
              projectIds: string[];
              tagIds: string[];
            };
          };
        }
      ).onboarding.effectiveBootstrapPolicy.mode,
      "active_only"
    );
    assert.deepEqual(
      (
        onboardingViaToken.json() as {
          onboarding: {
            effectiveBootstrapPolicy: { mode: string; tasksLimit: number };
            effectiveScopePolicy: {
              userIds: string[];
              projectIds: string[];
              tagIds: string[];
            };
          };
        }
      ).onboarding.effectiveScopePolicy,
      {
        userIds: ["user_operator", "user_forge_bot"],
        projectIds: [],
        tagIds: []
      }
    );
    assert.match(
      onboardingBody.onboarding.conceptModel.goal,
      /Goals anchor projects/
    );
    assert.match(
      onboardingBody.onboarding.conceptModel.taskRun,
      /live work session/
    );
    assert.match(
      onboardingBody.onboarding.conceptModel.note,
      /Markdown work note/
    );
    assert.match(
      onboardingBody.onboarding.conceptModel.sleepSession,
      /first-class health record/i
    );
    assert.match(
      onboardingBody.onboarding.conceptModel.workoutSession,
      /first-class sports record/i
    );
    assert.match(
      onboardingBody.onboarding.conceptModel.preferences,
      /pairwise judgments/i
    );
    assert.match(
      onboardingBody.onboarding.conceptModel.questionnaire,
      /structured reusable instruments/i
    );
    assert.match(
      onboardingBody.onboarding.conceptModel.selfObservation,
      /backed by observed notes/i
    );
    assert.match(
      onboardingBody.onboarding.conceptModel.movement,
      /first-class mobility surface/i
    );
    assert.match(
      onboardingBody.onboarding.conceptModel.lifeForce,
      /energy-budget and fatigue model/i
    );
    assert.match(
      onboardingBody.onboarding.conceptModel.workbench,
      /graph-flow execution system/i
    );
    assert.match(onboardingBody.onboarding.conceptModel.psyche, /sensitive/);
    assert.match(
      onboardingBody.onboarding.psycheSubmoduleModel.behaviorPattern,
      /CBT-style loop/
    );
    assert.match(
      onboardingBody.onboarding.psycheSubmoduleModel.beliefEntry,
      /belief statement/
    );
    assert.match(
      onboardingBody.onboarding.psycheSubmoduleModel.schemaCatalog,
      /reference taxonomy/
    );
    assert.match(
      onboardingBody.onboarding.psycheSubmoduleModel.triggerReport,
      /incident chain/
    );
    assert.ok(
      onboardingBody.onboarding.conversationRules.some((rule) =>
        /missing or unclear/i.test(rule)
      )
    );
    assert.ok(
      onboardingBody.onboarding.conversationRules.some((rule) =>
        /one missing thing you are trying to clarify/i.test(rule)
      )
    );
    assert.ok(
      onboardingBody.onboarding.conversationRules.some((rule) =>
        /tentative title or formulation/i.test(rule)
      )
    );
    assert.ok(
      onboardingBody.onboarding.conversationRules.some((rule) =>
        /what the record is becoming/i.test(rule)
      )
    );
    assert.ok(
      onboardingBody.onboarding.conversationRules.some((rule) =>
        /add, update, review, compare, navigate, link, or run/i.test(rule)
      )
    );
    assert.ok(
      onboardingBody.onboarding.conversationRules.some((rule) =>
        /distinction or decision the record should help with/i.test(rule)
      )
    );
    assert.ok(
      onboardingBody.onboarding.conversationRules.some((rule) =>
        /One focused question is the default/i.test(rule)
      )
    );
    assert.ok(
      onboardingBody.onboarding.conversationRules.some((rule) =>
        /name, define, and connect the record/i.test(rule)
      )
    );
    assert.ok(
      onboardingBody.onboarding.conversationRules.some((rule) =>
        /move to the write instead of reopening the intake/i.test(rule)
      )
    );
    const goalConversationPlaybook =
      onboardingBody.onboarding.entityConversationPlaybooks.find(
        (playbook) => playbook.focus === "goal"
      );
    assert.ok(goalConversationPlaybook);
    assert.match(
      goalConversationPlaybook.openingQuestion,
      /trying to keep hold of here/i
    );
    const taskConversationPlaybook =
      onboardingBody.onboarding.entityConversationPlaybooks.find(
        (playbook) => playbook.focus === "task"
      );
    assert.ok(taskConversationPlaybook);
    assert.ok(
      taskConversationPlaybook.askSequence.some((step) =>
        /next concrete action/i.test(step)
      )
    );
    const noteConversationPlaybook =
      onboardingBody.onboarding.entityConversationPlaybooks.find(
        (playbook) => playbook.focus === "note"
      );
    assert.ok(noteConversationPlaybook);
    assert.match(
      noteConversationPlaybook.openingQuestion,
      /worth preserving in a note/i
    );
    assert.ok(
      noteConversationPlaybook.askSequence.some((step) =>
        /durable or temporary/i.test(step)
      )
    );
    const wikiConversationPlaybook =
      onboardingBody.onboarding.entityConversationPlaybooks.find(
        (playbook) => playbook.focus === "wiki_page"
      );
    assert.ok(wikiConversationPlaybook);
    assert.match(
      wikiConversationPlaybook.openingQuestion,
      /remember or reuse later/i
    );
    const insightConversationPlaybook =
      onboardingBody.onboarding.entityConversationPlaybooks.find(
        (playbook) => playbook.focus === "insight"
      );
    assert.ok(insightConversationPlaybook);
    assert.match(
      insightConversationPlaybook.openingQuestion,
      /future-you or the agent/i
    );
    const tagConversationPlaybook =
      onboardingBody.onboarding.entityConversationPlaybooks.find(
        (playbook) => playbook.focus === "tag"
      );
    assert.ok(tagConversationPlaybook);
    assert.match(
      tagConversationPlaybook.openingQuestion,
      /notice or find again later/i
    );
    const taskRunConversationPlaybook =
      onboardingBody.onboarding.entityConversationPlaybooks.find(
        (playbook) => playbook.focus === "task_run"
      );
    assert.ok(taskRunConversationPlaybook);
    assert.ok(
      taskRunConversationPlaybook.askSequence.some((step) =>
        /Start the run instead of turning it into a longer intake/i.test(step)
      )
    );
    assert.ok(
      taskRunConversationPlaybook.askSequence.some((step) =>
        /dedicated task-run tool/i.test(step)
      )
    );
    const calendarConnectionConversationPlaybook =
      onboardingBody.onboarding.entityConversationPlaybooks.find(
        (playbook) => playbook.focus === "calendar_connection"
      );
    assert.ok(calendarConnectionConversationPlaybook);
    assert.ok(
      calendarConnectionConversationPlaybook.askSequence.some((step) =>
        /read-only visibility, writable planning, or both/i.test(step)
      )
    );
    const selfObservationConversationPlaybook =
      onboardingBody.onboarding.entityConversationPlaybooks.find(
        (playbook) => playbook.focus === "self_observation"
      );
    assert.ok(selfObservationConversationPlaybook);
    assert.match(
      selfObservationConversationPlaybook.openingQuestion,
      /what happened in the situation/i
    );
    assert.ok(
      /situation[\s\S]*cue[\s\S]*emotion[\s\S]*thought[\s\S]*behavior[\s\S]*consequence/i.test(
        selfObservationConversationPlaybook.askSequence.join(" ")
      )
    );
    const sleepConversationPlaybook =
      onboardingBody.onboarding.entityConversationPlaybooks.find(
        (playbook) => playbook.focus === "sleep_session"
      );
    assert.ok(sleepConversationPlaybook);
    assert.ok(
      sleepConversationPlaybook.askSequence.some((step) =>
        /quality, pattern, context, meaning, or links/i.test(step)
      )
    );
    const workoutConversationPlaybook =
      onboardingBody.onboarding.entityConversationPlaybooks.find(
        (playbook) => playbook.focus === "workout_session"
      );
    assert.ok(workoutConversationPlaybook);
    assert.match(
      workoutConversationPlaybook.openingQuestion,
      /workout feels most worth remembering or connecting/i
    );
    const preferenceCatalogConversationPlaybook =
      onboardingBody.onboarding.entityConversationPlaybooks.find(
        (playbook) => playbook.focus === "preference_catalog"
      );
    assert.ok(preferenceCatalogConversationPlaybook);
    assert.match(
      preferenceCatalogConversationPlaybook.openingQuestion,
      /decision or taste question/i
    );
    const preferenceContextConversationPlaybook =
      onboardingBody.onboarding.entityConversationPlaybooks.find(
        (playbook) => playbook.focus === "preference_context"
      );
    assert.ok(preferenceContextConversationPlaybook);
    assert.ok(
      preferenceContextConversationPlaybook.askSequence.some((step) =>
        /decisions or comparisons should feel different/i.test(step)
      )
    );
    const preferenceItemConversationPlaybook =
      onboardingBody.onboarding.entityConversationPlaybooks.find(
        (playbook) => playbook.focus === "preference_item"
      );
    assert.ok(preferenceItemConversationPlaybook);
    assert.ok(
      preferenceItemConversationPlaybook.askSequence.some((step) =>
        /favorite, veto, or compare-later/i.test(step)
      )
    );
    const questionnaireConversationPlaybook =
      onboardingBody.onboarding.entityConversationPlaybooks.find(
        (playbook) => playbook.focus === "questionnaire_instrument"
      );
    assert.ok(questionnaireConversationPlaybook);
    assert.match(
      questionnaireConversationPlaybook.openingQuestion,
      /help someone notice or track/i
    );
    assert.ok(
      questionnaireConversationPlaybook.askSequence.some((step) =>
        /practical use case back in plain language/i.test(step)
      )
    );
    const questionnaireRunConversationPlaybook =
      onboardingBody.onboarding.entityConversationPlaybooks.find(
        (playbook) => playbook.focus === "questionnaire_run"
      );
    assert.ok(questionnaireRunConversationPlaybook);
    assert.match(
      questionnaireRunConversationPlaybook.openingQuestion,
      /start, continue, review, or finish/i
    );
    const valuePlaybook =
      onboardingBody.onboarding.psycheCoachingPlaybooks.find(
        (playbook) => playbook.focus === "psyche_value"
      );
    assert.ok(valuePlaybook);
    assert.ok(
      valuePlaybook.askSequence.some((step) => /committed action/i.test(step))
    );
    assert.ok(
      valuePlaybook.notes.some((note) =>
        /ACT-style values clarification/i.test(note)
      )
    );
    const patternPlaybook =
      onboardingBody.onboarding.psycheCoachingPlaybooks.find(
        (playbook) => playbook.focus === "behavior_pattern"
      );
    assert.ok(patternPlaybook);
    assert.ok(
      patternPlaybook.askSequence.some((step) =>
        /short-term payoff/i.test(step)
      )
    );
    assert.ok(
      patternPlaybook.exampleQuestions.some((question) =>
        /What usually sets this loop off/i.test(question)
      )
    );
    assert.ok(
      patternPlaybook.askSequence.some((step) =>
        /beliefs, schema themes, modes, or values/i.test(step)
      )
    );
    const beliefPlaybook =
      onboardingBody.onboarding.psycheCoachingPlaybooks.find(
        (playbook) => playbook.focus === "belief_entry"
      );
    assert.ok(beliefPlaybook);
    assert.ok(beliefPlaybook.requiredForCreate.includes("statement"));
    assert.ok(beliefPlaybook.requiredForCreate.includes("beliefType"));
    const modeGuidePlaybook =
      onboardingBody.onboarding.psycheCoachingPlaybooks.find(
        (playbook) => playbook.focus === "mode_guide_session"
      );
    assert.ok(modeGuidePlaybook);
    assert.ok(modeGuidePlaybook.requiredForCreate.includes("summary"));
    assert.ok(modeGuidePlaybook.requiredForCreate.includes("answers"));
    assert.ok(
      onboardingBody.onboarding.relationshipModel.some((rule) =>
        /Projects belong to one goal/.test(rule)
      )
    );
    const goalEntity = onboardingBody.onboarding.entityCatalog.find(
      (entity) => entity.entityType === "goal"
    );
    assert.ok(goalEntity);
    assert.ok(goalEntity.minimumCreateFields.includes("title"));
    assert.ok(
      goalEntity.fieldGuide.some(
        (field) => field.name === "horizon" && field.required === false
      )
    );
    const beliefEntity = onboardingBody.onboarding.entityCatalog.find(
      (entity) => entity.entityType === "belief_entry"
    );
    assert.ok(beliefEntity);
    assert.ok(
      beliefEntity.fieldGuide.some(
        (field) => field.name === "statement" && field.required
      )
    );
    assert.ok(
      beliefEntity.fieldGuide.some(
        (field) => field.name === "beliefType" && field.required
      )
    );
    const eventTypeEntity = onboardingBody.onboarding.entityCatalog.find(
      (entity) => entity.entityType === "event_type"
    );
    assert.ok(eventTypeEntity);
    assert.ok(eventTypeEntity.minimumCreateFields.includes("label"));
    const eventTypePlaybook =
      onboardingBody.onboarding.entityConversationPlaybooks.find(
        (playbook) => playbook.focus === "event_type"
      );
    assert.ok(eventTypePlaybook);
    assert.ok(
      eventTypePlaybook.askSequence.some((step) =>
        /repeated moment back in plain language/i.test(step)
      )
    );
    const calendarEventEntity = onboardingBody.onboarding.entityCatalog.find(
      (entity) => entity.entityType === "calendar_event"
    );
    assert.ok(calendarEventEntity);
    assert.equal(calendarEventEntity.classification, "batch_crud_entity");
    assert.match(
      calendarEventEntity.preferredMutationPath ?? "",
      /\/api\/v1\/entities\/create/
    );
    assert.ok(calendarEventEntity.minimumCreateFields.includes("title"));
    assert.ok(
      calendarEventEntity.fieldGuide.some(
        (field) => field.name === "preferredCalendarId"
      )
    );
    const workBlockEntity = onboardingBody.onboarding.entityCatalog.find(
      (entity) => entity.entityType === "work_block_template"
    );
    assert.ok(workBlockEntity);
    assert.ok(workBlockEntity.minimumCreateFields.includes("weekDays"));
    const timeboxEntity = onboardingBody.onboarding.entityCatalog.find(
      (entity) => entity.entityType === "task_timebox"
    );
    assert.ok(timeboxEntity);
    assert.ok(timeboxEntity.minimumCreateFields.includes("taskId"));
    const emotionEntity = onboardingBody.onboarding.entityCatalog.find(
      (entity) => entity.entityType === "emotion_definition"
    );
    assert.ok(emotionEntity);
    assert.ok(
      emotionEntity.fieldGuide.some((field) => field.name === "category")
    );
    const emotionPlaybook =
      onboardingBody.onboarding.entityConversationPlaybooks.find(
        (playbook) => playbook.focus === "emotion_definition"
      );
    assert.ok(emotionPlaybook);
    assert.ok(
      emotionPlaybook.askSequence.some((step) =>
        /felt signature back in plain language/i.test(step)
      )
    );
    const sleepEntity = onboardingBody.onboarding.entityCatalog.find(
      (entity) => entity.entityType === "sleep_session"
    );
    assert.ok(sleepEntity);
    assert.equal(sleepEntity.classification, "batch_crud_entity");
    assert.deepEqual(sleepEntity.minimumCreateFields, ["startedAt", "endedAt"]);
    assert.match(
      sleepEntity.preferredMutationPath ?? "",
      /\/api\/v1\/entities\/create/
    );
    const workoutEntity = onboardingBody.onboarding.entityCatalog.find(
      (entity) => entity.entityType === "workout_session"
    );
    assert.ok(workoutEntity);
    assert.equal(workoutEntity.classification, "batch_crud_entity");
    assert.deepEqual(workoutEntity.minimumCreateFields, [
      "workoutType",
      "startedAt",
      "endedAt"
    ]);
    assert.match(
      workoutEntity.preferredMutationPath ?? "",
      /\/api\/v1\/entities\/create/
    );
    const preferenceCatalogEntity =
      onboardingBody.onboarding.entityCatalog.find(
        (entity) => entity.entityType === "preference_catalog"
      );
    assert.ok(preferenceCatalogEntity);
    assert.equal(preferenceCatalogEntity.classification, "batch_crud_entity");
    assert.ok(preferenceCatalogEntity.minimumCreateFields.includes("userId"));
    const questionnaireEntity = onboardingBody.onboarding.entityCatalog.find(
      (entity) => entity.entityType === "questionnaire_instrument"
    );
    assert.ok(questionnaireEntity);
    assert.equal(questionnaireEntity.classification, "batch_crud_entity");
    assert.match(
      questionnaireEntity.preferredMutationPath ?? "",
      /\/api\/v1\/entities\/create/
    );
    const modeGuideEntity = onboardingBody.onboarding.entityCatalog.find(
      (entity) => entity.entityType === "mode_guide_session"
    );
    assert.ok(modeGuideEntity);
    assert.ok(modeGuideEntity.minimumCreateFields.includes("answers"));
    assert.ok(modeGuideEntity.minimumCreateFields.includes("summary"));
    assert.ok(
      modeGuideEntity.fieldGuide.some(
        (field) => field.name === "results" && !field.required
      )
    );
    const triggerReportEntity = onboardingBody.onboarding.entityCatalog.find(
      (entity) => entity.entityType === "trigger_report"
    );
    assert.ok(triggerReportEntity);
    assert.ok(
      triggerReportEntity.fieldGuide.some((field) => field.name === "emotions")
    );
    const taskRunEntity = onboardingBody.onboarding.entityCatalog.find(
      (entity) => entity.entityType === "task_run"
    );
    assert.ok(taskRunEntity);
    assert.equal(taskRunEntity.classification, "action_workflow_entity");
    assert.match(
      taskRunEntity.preferredMutationTool ?? "",
      /forge_start_task_run/
    );
    const movementEntity = onboardingBody.onboarding.entityCatalog.find(
      (entity) => entity.entityType === "movement"
    );
    assert.ok(movementEntity);
    assert.equal(movementEntity.classification, "specialized_domain_surface");
    assert.match(
      movementEntity.preferredMutationTool ?? "",
      /specializedDomainSurfaces/
    );
    const lifeForceEntity = onboardingBody.onboarding.entityCatalog.find(
      (entity) => entity.entityType === "life_force"
    );
    assert.ok(lifeForceEntity);
    assert.equal(
      lifeForceEntity.classification,
      "specialized_domain_surface"
    );
    const workbenchEntity = onboardingBody.onboarding.entityCatalog.find(
      (entity) => entity.entityType === "workbench"
    );
    assert.ok(workbenchEntity);
    assert.equal(workbenchEntity.classification, "specialized_domain_surface");
    const createTool = onboardingBody.onboarding.toolInputCatalog.find(
      (tool) => tool.toolName === "forge_create_entities"
    );
    assert.ok(createTool);
    assert.ok(createTool.requiredFields.includes("operations[].data"));
    assert.match(createTool.inputShape, /operations/);
    const createToolNotes = (createTool as { notes?: string[] }).notes ?? [];
    assert.match(createToolNotes.join(" "), /calendar_event/);
    const updateTool = onboardingBody.onboarding.toolInputCatalog.find(
      (tool) => tool.toolName === "forge_update_entities"
    );
    assert.ok(updateTool);
    const updateToolNotes = (updateTool as { notes?: string[] }).notes ?? [];
    assert.match(updateToolNotes.join(" "), /status-driven/);
    assert.match(
      updateToolNotes.join(" "),
      /auto-completes linked unfinished tasks/
    );
    assert.match(updateToolNotes.join(" "), /calendar_event/);
    const deleteTool = onboardingBody.onboarding.toolInputCatalog.find(
      (tool) => tool.toolName === "forge_delete_entities"
    );
    assert.ok(deleteTool);
    const deleteToolNotes = (deleteTool as { notes?: string[] }).notes ?? [];
    assert.match(deleteToolNotes.join(" "), /calendar_event/);
    assert.ok(
      !onboardingBody.onboarding.toolInputCatalog.some(
        (tool) => tool.toolName === "forge_create_calendar_event"
      )
    );
    const startRunTool = onboardingBody.onboarding.toolInputCatalog.find(
      (tool) => tool.toolName === "forge_start_task_run"
    );
    assert.ok(startRunTool);
    assert.ok(startRunTool.requiredFields.includes("taskId"));
    assert.ok(startRunTool.requiredFields.includes("actor"));
    assert.equal(
      onboardingBody.onboarding.verificationPaths.settingsBin,
      "/api/v1/settings/bin"
    );
    assert.equal(
      onboardingBody.onboarding.verificationPaths.batchSearch,
      "/api/v1/entities/search"
    );
    assert.equal(
      onboardingBody.onboarding.verificationPaths.psycheSchemaCatalog,
      "/api/v1/psyche/schema-catalog"
    );
    assert.equal(
      onboardingBody.onboarding.verificationPaths.psycheEventTypes,
      "/api/v1/psyche/event-types"
    );
    assert.equal(
      onboardingBody.onboarding.verificationPaths.psycheEmotions,
      "/api/v1/psyche/emotions"
    );
    assert.equal(
      onboardingBody.onboarding.verificationPaths.lifeForce,
      "/api/v1/life-force"
    );
    assert.equal(
      onboardingBody.onboarding.verificationPaths.lifeForceProfile,
      "/api/v1/life-force/profile"
    );
    assert.equal(
      onboardingBody.onboarding.verificationPaths.lifeForceWeekdayTemplate,
      "/api/v1/life-force/templates/:weekday"
    );
    assert.equal(
      onboardingBody.onboarding.verificationPaths.lifeForceFatigueSignals,
      "/api/v1/life-force/fatigue-signals"
    );
    assert.equal(
      onboardingBody.onboarding.verificationPaths.movementDay,
      "/api/v1/movement/day"
    );
    assert.equal(
      onboardingBody.onboarding.verificationPaths.movementMonth,
      "/api/v1/movement/month"
    );
    assert.equal(
      onboardingBody.onboarding.verificationPaths.movementTimeline,
      "/api/v1/movement/timeline"
    );
    assert.equal(
      onboardingBody.onboarding.verificationPaths.movementAllTime,
      "/api/v1/movement/all-time"
    );
    assert.equal(
      onboardingBody.onboarding.verificationPaths.movementPlaces,
      "/api/v1/movement/places"
    );
    assert.equal(
      onboardingBody.onboarding.verificationPaths.movementTripDetail,
      "/api/v1/movement/trips/:id"
    );
    assert.equal(
      onboardingBody.onboarding.verificationPaths.movementSelection,
      "/api/v1/movement/selection"
    );
    assert.equal(
      onboardingBody.onboarding.verificationPaths.movementUserBoxPreflight,
      "/api/v1/movement/user-boxes/preflight"
    );
    assert.equal(
      onboardingBody.onboarding.verificationPaths.workbenchFlows,
      "/api/v1/workbench/flows"
    );
    assert.equal(
      onboardingBody.onboarding.verificationPaths.workbenchFlowBySlug,
      "/api/v1/workbench/flows/by-slug/:slug"
    );
    assert.equal(
      onboardingBody.onboarding.verificationPaths.workbenchPublishedOutput,
      "/api/v1/workbench/flows/:id/output"
    );
    assert.equal(
      onboardingBody.onboarding.verificationPaths.workbenchRunDetail,
      "/api/v1/workbench/flows/:id/runs/:runId"
    );
    assert.equal(
      onboardingBody.onboarding.verificationPaths.workbenchNodeResult,
      "/api/v1/workbench/flows/:id/runs/:runId/nodes/:nodeId"
    );
    assert.equal(
      onboardingBody.onboarding.verificationPaths.workbenchLatestNodeOutput,
      "/api/v1/workbench/flows/:id/nodes/:nodeId/output"
    );
    const movementSurface =
      onboardingBody.onboarding.entityRouteModel.specializedDomainSurfaces
        .movement;
    assert.ok(movementSurface);
    assert.match(movementSurface.summary, /movement workspace API/i);
    assert.equal(movementSurface.readRoutes.day, "/api/v1/movement/day");
    assert.equal(
      movementSurface.readRoutes.timeline,
      "/api/v1/movement/timeline"
    );
    assert.equal(
      movementSurface.writeRoutes.userBoxPreflight,
      "/api/v1/movement/user-boxes/preflight"
    );
    assert.ok(
      movementSurface.notes.some((note) => /batch CRUD entity family/i.test(note))
    );
    const movementPlaybook =
      onboardingBody.onboarding.entityConversationPlaybooks.find(
        (playbook) => playbook.focus === "movement"
      );
    assert.ok(movementPlaybook);
    assert.ok(
      movementPlaybook.askSequence.some((step) =>
        /Skip the meta lane question/i.test(step)
      )
    );
    const lifeForceSurface =
      onboardingBody.onboarding.entityRouteModel.specializedDomainSurfaces
        .lifeForce;
    assert.ok(lifeForceSurface);
    assert.match(lifeForceSurface.summary, /life-force API/i);
    assert.equal(lifeForceSurface.readRoutes.overview, "/api/v1/life-force");
    assert.equal(
      lifeForceSurface.writeRoutes.profile,
      "/api/v1/life-force/profile"
    );
    assert.equal(
      lifeForceSurface.writeRoutes.weekdayTemplate,
      "/api/v1/life-force/templates/:weekday"
    );
    assert.ok(
      lifeForceSurface.notes.some((note) => /current overview payload/i.test(note))
    );
    const lifeForcePlaybook =
      onboardingBody.onboarding.entityConversationPlaybooks.find(
        (playbook) => playbook.focus === "life_force"
      );
    assert.ok(lifeForcePlaybook);
    assert.ok(
      lifeForcePlaybook.askSequence.some((step) =>
        /specific weekday, profile field, or signal/i.test(step)
      )
    );
    const workbenchSurface =
      onboardingBody.onboarding.entityRouteModel.specializedDomainSurfaces
        .workbench;
    assert.ok(workbenchSurface);
    assert.match(workbenchSurface.summary, /graph-flow API/i);
    assert.equal(
      workbenchSurface.readRoutes.listFlows,
      "/api/v1/workbench/flows"
    );
    assert.equal(
      workbenchSurface.readRoutes.latestNodeOutput,
      "/api/v1/workbench/flows/:id/nodes/:nodeId/output"
    );
    assert.equal(
      workbenchSurface.writeRoutes.runFlow,
      "/api/v1/workbench/flows/:id/run"
    );
    assert.equal(
      workbenchSurface.writeRoutes.runByPayload,
      "/api/v1/workbench/run"
    );
    assert.ok(
      workbenchSurface.notes.some((note) =>
        /node-result routes over reverse-engineering raw traces/i.test(note)
      )
    );
    const workbenchPlaybook =
      onboardingBody.onboarding.entityConversationPlaybooks.find(
        (playbook) => playbook.focus === "workbench"
      );
    assert.ok(workbenchPlaybook);
    assert.ok(
      workbenchPlaybook.askSequence.some((step) =>
        /skip the meta lane question/i.test(step)
      )
    );
    assert.deepEqual(
      onboardingBody.onboarding.recommendedPluginTools.bootstrap,
      ["forge_get_operator_overview"]
    );
    assert.deepEqual(
      onboardingBody.onboarding.recommendedPluginTools.readModels,
      [
        "forge_get_user_directory",
        "forge_get_operator_context",
        "forge_get_current_work",
        "forge_get_psyche_overview",
        "forge_get_sleep_overview",
        "forge_get_sports_overview",
        "forge_get_xp_metrics",
        "forge_get_weekly_review"
      ]
    );
    assert.deepEqual(
      onboardingBody.onboarding.recommendedPluginTools.uiWorkflow,
      ["forge_get_ui_entrypoint"]
    );
    assert.deepEqual(
      onboardingBody.onboarding.recommendedPluginTools.entityWorkflow,
      [
        "forge_search_entities",
        "forge_create_entities",
        "forge_update_entities",
        "forge_delete_entities",
        "forge_restore_entities"
      ]
    );
    assert.deepEqual(
      onboardingBody.onboarding.recommendedPluginTools.healthWorkflow,
      [
        "forge_get_sleep_overview",
        "forge_get_sports_overview",
        "forge_update_sleep_session",
        "forge_update_workout_session"
      ]
    );
    assert.deepEqual(
      onboardingBody.onboarding.recommendedPluginTools.calendarWorkflow,
      [
        "forge_get_calendar_overview",
        "forge_connect_calendar_provider",
        "forge_sync_calendar_connection",
        "forge_create_work_block_template",
        "forge_recommend_task_timeboxes",
        "forge_create_task_timebox"
      ]
    );
    assert.deepEqual(
      onboardingBody.onboarding.recommendedPluginTools.workWorkflow,
      [
        "forge_adjust_work_minutes",
        "forge_log_work",
        "forge_start_task_run",
        "forge_heartbeat_task_run",
        "forge_focus_task_run",
        "forge_complete_task_run",
        "forge_release_task_run"
      ]
    );
    assert.deepEqual(
      onboardingBody.onboarding.recommendedPluginTools.insightWorkflow,
      ["forge_post_insight"]
    );
    assert.equal(
      onboardingBody.onboarding.interactionGuidance.saveSuggestionPlacement,
      "end_of_message"
    );
    assert.equal(
      onboardingBody.onboarding.interactionGuidance.maxQuestionsPerTurn,
      1
    );
    assert.match(
      onboardingBody.onboarding.interactionGuidance.psycheExplorationRule,
      /one exploratory question/i
    );
    assert.match(
      onboardingBody.onboarding.interactionGuidance.psycheExplorationRule,
      /wait for the user's answer before offering a fuller formulation/i
    );
    assert.match(
      onboardingBody.onboarding.interactionGuidance.psycheExplorationRule,
      /stop deepening and help the user name it cleanly/i
    );
    assert.match(
      onboardingBody.onboarding.interactionGuidance.psycheOpeningQuestionRule,
      /hold the adjacent ones lightly until the main container is clear/i
    );
    assert.equal(
      onboardingBody.onboarding.interactionGuidance.duplicateCheckRoute,
      "/api/v1/entities/search"
    );
    assert.equal(
      onboardingBody.onboarding.interactionGuidance.uiSuggestionRule,
      "offer_visual_ui_when_review_or_editing_would_be_easier"
    );
    assert.match(
      onboardingBody.onboarding.interactionGuidance.browserFallbackRule,
      /Do not open the Forge UI or a browser/
    );
    assert.match(
      onboardingBody.onboarding.interactionGuidance.browserFallbackRule,
      /Batch CRUD is the default for simple entities/i
    );
    assert.match(
      onboardingBody.onboarding.interactionGuidance.browserFallbackRule,
      /one-route-per-entity mental model/i
    );
    assert.match(
      onboardingBody.onboarding.interactionGuidance.writeConsentRule,
      /Only write after explicit save intent/
    );
    assert.equal(
      onboardingBody.onboarding.mutationGuidance.deleteDefault,
      "soft"
    );
    assert.equal(
      onboardingBody.onboarding.mutationGuidance.preferredBatchRoutes.create,
      "/api/v1/entities/create"
    );
    assert.equal(
      onboardingBody.onboarding.mutationGuidance.preferredBatchRoutes.update,
      "/api/v1/entities/update"
    );
    assert.equal(
      onboardingBody.onboarding.mutationGuidance.preferredBatchRoutes.delete,
      "/api/v1/entities/delete"
    );
    assert.equal(
      onboardingBody.onboarding.mutationGuidance.preferredBatchRoutes.restore,
      "/api/v1/entities/restore"
    );
    assert.equal(
      onboardingBody.onboarding.mutationGuidance.preferredBatchRoutes.search,
      "/api/v1/entities/search"
    );
    assert.match(
      onboardingBody.onboarding.mutationGuidance.batchingRule,
      /accept operations as arrays/
    );
    assert.match(
      onboardingBody.onboarding.mutationGuidance.batchingRule,
      /Batch CRUD is the default for simple entities/i
    );
    assert.match(
      onboardingBody.onboarding.mutationGuidance.searchRule,
      /accepts searches as an array/
    );
    assert.match(
      onboardingBody.onboarding.mutationGuidance.createRule,
      /entityType and full data/
    );
    assert.match(
      onboardingBody.onboarding.mutationGuidance.createRule,
      /calendar_event/
    );
    assert.match(
      onboardingBody.onboarding.mutationGuidance.createRule,
      /sleep_session/
    );
    assert.match(
      onboardingBody.onboarding.mutationGuidance.createRule,
      /workout_session/
    );
    assert.match(
      onboardingBody.onboarding.mutationGuidance.updateRule,
      /entityType, id, and patch/
    );
    assert.match(
      onboardingBody.onboarding.mutationGuidance.updateRule,
      /status patches/
    );
    assert.match(
      onboardingBody.onboarding.mutationGuidance.updateRule,
      /Calendar-event updates/
    );
    assert.match(
      onboardingBody.onboarding.mutationGuidance.updateRule,
      /health-session field edits belong on the batch route by default/i
    );
    assert.ok(
      onboardingBody.onboarding.entityRouteModel.batchCrudEntities.includes(
        "sleep_session"
      )
    );
    assert.ok(
      onboardingBody.onboarding.entityRouteModel.batchCrudEntities.includes(
        "workout_session"
      )
    );
    assert.ok(
      onboardingBody.onboarding.entityRouteModel.batchCrudEntities.includes(
        "preference_catalog"
      )
    );
    assert.ok(
      onboardingBody.onboarding.entityRouteModel.batchCrudEntities.includes(
        "questionnaire_instrument"
      )
    );
    assert.equal(
      onboardingBody.onboarding.entityRouteModel.readModelOnlySurfaces
        .sleepOverview,
      "/api/v1/health/sleep"
    );
    assert.equal(
      onboardingBody.onboarding.entityRouteModel.readModelOnlySurfaces
        .sportsOverview,
      "/api/v1/health/fitness"
    );
    assert.equal(
      onboardingBody.onboarding.entityRouteModel.specializedCrudEntities
        .wiki_page?.create,
      "/api/v1/wiki/pages"
    );
    assert.match(
      onboardingBody.onboarding.mutationGuidance.createExample,
      /\"operations\":\[/
    );
    assert.match(
      onboardingBody.onboarding.mutationGuidance.updateExample,
      /\"paused\"/
    );

    const rotated = await app.inject({
      method: "POST",
      url: `/api/v1/settings/tokens/${createdTokenBody.token.tokenSummary.id}/rotate`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(rotated.statusCode, 200);
    const rotatedBody = rotated.json() as {
      token: { token: string };
    };
    assert.ok(rotatedBody.token.token.startsWith("fg_live_"));

    const revoked = await app.inject({
      method: "POST",
      url: `/api/v1/settings/tokens/${createdTokenBody.token.tokenSummary.id}/revoke`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(revoked.statusCode, 200);
    const revokedBody = revoked.json() as {
      token: { status: string };
    };
    assert.equal(revokedBody.token.status, "revoked");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("settings API rejects incomplete Google OAuth override pairs", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-settings-google-pair-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        calendarProviders: {
          google: {
            clientId: "only-client-id.apps.googleusercontent.com",
            clientSecret: ""
          }
        }
      }
    });

    assert.equal(response.statusCode, 400);
    assert.match(
      response.body,
      /provide both the client ID and client secret together, or clear both fields together/i
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("google oauth start generates a PKCE auth url for local localhost flow", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-google-oauth-start-")
  );
  const previousEnv = {
    APP_BASE_URL: process.env.APP_BASE_URL,
    APP_URL: process.env.APP_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    GOOGLE_ALLOWED_ORIGINS: process.env.GOOGLE_ALLOWED_ORIGINS
  };
  process.env.APP_BASE_URL = "http://127.0.0.1:4317";
  delete process.env.GOOGLE_REDIRECT_URI;
  delete process.env.GOOGLE_ALLOWED_ORIGINS;
  process.env.GOOGLE_CLIENT_ID = "google-client-id";
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/calendar/oauth/google/start",
      headers: {
        cookie: operatorCookie,
        origin: "http://127.0.0.1:3027",
        "x-forwarded-proto": "http",
        "x-forwarded-host": "127.0.0.1:4317"
      },
      payload: {
        label: "Primary Google",
        browserOrigin: "http://127.0.0.1:3027"
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      session: { sessionId: string; authUrl: string | null };
    };
    assert.ok(body.session.sessionId);
    assert.ok(body.session.authUrl);

    const authUrl = new URL(body.session.authUrl!);
    assert.equal(authUrl.origin, "https://accounts.google.com");
    assert.equal(authUrl.pathname, "/o/oauth2/v2/auth");
    assert.equal(authUrl.searchParams.get("client_id"), "google-client-id");
    assert.equal(
      authUrl.searchParams.get("redirect_uri"),
      "http://127.0.0.1:4317/api/v1/calendar/oauth/google/callback"
    );
    assert.equal(authUrl.searchParams.get("response_type"), "code");
    assert.equal(authUrl.searchParams.get("access_type"), "offline");
    assert.equal(authUrl.searchParams.get("prompt"), "consent");
    assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
    assert.ok(authUrl.searchParams.get("state"));
    assert.ok(authUrl.searchParams.get("code_challenge"));
  } finally {
    if (previousEnv.APP_BASE_URL === undefined) {
      delete process.env.APP_BASE_URL;
    } else {
      process.env.APP_BASE_URL = previousEnv.APP_BASE_URL;
    }
    if (previousEnv.APP_URL === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = previousEnv.APP_URL;
    }
    if (previousEnv.GOOGLE_CLIENT_ID === undefined) {
      delete process.env.GOOGLE_CLIENT_ID;
    } else {
      process.env.GOOGLE_CLIENT_ID = previousEnv.GOOGLE_CLIENT_ID;
    }
    if (previousEnv.GOOGLE_REDIRECT_URI === undefined) {
      delete process.env.GOOGLE_REDIRECT_URI;
    } else {
      process.env.GOOGLE_REDIRECT_URI = previousEnv.GOOGLE_REDIRECT_URI;
    }
    if (previousEnv.GOOGLE_ALLOWED_ORIGINS === undefined) {
      delete process.env.GOOGLE_ALLOWED_ORIGINS;
    } else {
      process.env.GOOGLE_ALLOWED_ORIGINS = previousEnv.GOOGLE_ALLOWED_ORIGINS;
    }
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("google oauth start prefers the saved Forge client ID over the runtime default", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-google-oauth-settings-override-")
  );
  const previousEnv = {
    APP_BASE_URL: process.env.APP_BASE_URL,
    APP_URL: process.env.APP_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    GOOGLE_ALLOWED_ORIGINS: process.env.GOOGLE_ALLOWED_ORIGINS
  };
  process.env.APP_BASE_URL = "http://127.0.0.1:4317";
  delete process.env.GOOGLE_REDIRECT_URI;
  delete process.env.GOOGLE_ALLOWED_ORIGINS;
  process.env.GOOGLE_CLIENT_ID = "google-client-id-from-env";
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const updated = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        calendarProviders: {
          google: {
            clientId: "google-client-id-from-settings",
            clientSecret: "google-client-secret-from-settings"
          }
        }
      }
    });
    assert.equal(updated.statusCode, 200);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/calendar/oauth/google/start",
      headers: {
        cookie: operatorCookie,
        origin: "http://127.0.0.1:3027",
        "x-forwarded-proto": "http",
        "x-forwarded-host": "127.0.0.1:4317"
      },
      payload: {
        label: "Primary Google",
        browserOrigin: "http://127.0.0.1:3027"
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      session: { authUrl: string | null };
    };
    assert.ok(body.session.authUrl);
    const authUrl = new URL(body.session.authUrl!);
    assert.equal(
      authUrl.searchParams.get("client_id"),
      "google-client-id-from-settings"
    );
  } finally {
    if (previousEnv.APP_BASE_URL === undefined) {
      delete process.env.APP_BASE_URL;
    } else {
      process.env.APP_BASE_URL = previousEnv.APP_BASE_URL;
    }
    if (previousEnv.APP_URL === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = previousEnv.APP_URL;
    }
    if (previousEnv.GOOGLE_CLIENT_ID === undefined) {
      delete process.env.GOOGLE_CLIENT_ID;
    } else {
      process.env.GOOGLE_CLIENT_ID = previousEnv.GOOGLE_CLIENT_ID;
    }
    if (previousEnv.GOOGLE_REDIRECT_URI === undefined) {
      delete process.env.GOOGLE_REDIRECT_URI;
    } else {
      process.env.GOOGLE_REDIRECT_URI = previousEnv.GOOGLE_REDIRECT_URI;
    }
    if (previousEnv.GOOGLE_ALLOWED_ORIGINS === undefined) {
      delete process.env.GOOGLE_ALLOWED_ORIGINS;
    } else {
      process.env.GOOGLE_ALLOWED_ORIGINS = previousEnv.GOOGLE_ALLOWED_ORIGINS;
    }
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("google oauth start rejects a remote browser origin when the callback is localhost", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-google-oauth-remote-loopback-")
  );
  const previousEnv = {
    APP_BASE_URL: process.env.APP_BASE_URL,
    APP_URL: process.env.APP_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    GOOGLE_ALLOWED_ORIGINS: process.env.GOOGLE_ALLOWED_ORIGINS
  };
  delete process.env.APP_BASE_URL;
  delete process.env.APP_URL;
  delete process.env.GOOGLE_REDIRECT_URI;
  delete process.env.GOOGLE_ALLOWED_ORIGINS;
  process.env.GOOGLE_CLIENT_ID = "google-client-id";
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/calendar/oauth/google/start",
      headers: {
        cookie: operatorCookie,
        origin: "https://macbook-pro--de-francis-lalanne.tail47ba04.ts.net",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "macbook-pro--de-francis-lalanne.tail47ba04.ts.net"
      },
      payload: {
        label: "Primary Google",
        browserOrigin:
          "https://macbook-pro--de-francis-lalanne.tail47ba04.ts.net"
      }
    });

    assert.equal(response.statusCode, 500);
    assert.match(response.body, /Forge is running as a localhost app/i);
    assert.match(response.body, /browser must also be on localhost/i);
  } finally {
    if (previousEnv.APP_BASE_URL === undefined) {
      delete process.env.APP_BASE_URL;
    } else {
      process.env.APP_BASE_URL = previousEnv.APP_BASE_URL;
    }
    if (previousEnv.APP_URL === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = previousEnv.APP_URL;
    }
    if (previousEnv.GOOGLE_CLIENT_ID === undefined) {
      delete process.env.GOOGLE_CLIENT_ID;
    } else {
      process.env.GOOGLE_CLIENT_ID = previousEnv.GOOGLE_CLIENT_ID;
    }
    if (previousEnv.GOOGLE_REDIRECT_URI === undefined) {
      delete process.env.GOOGLE_REDIRECT_URI;
    } else {
      process.env.GOOGLE_REDIRECT_URI = previousEnv.GOOGLE_REDIRECT_URI;
    }
    if (previousEnv.GOOGLE_ALLOWED_ORIGINS === undefined) {
      delete process.env.GOOGLE_ALLOWED_ORIGINS;
    } else {
      process.env.GOOGLE_ALLOWED_ORIGINS = previousEnv.GOOGLE_ALLOWED_ORIGINS;
    }
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("google oauth callback rejects an invalid state", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-google-oauth-invalid-state-")
  );
  const previousEnv = {
    APP_BASE_URL: process.env.APP_BASE_URL,
    APP_URL: process.env.APP_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    GOOGLE_ALLOWED_ORIGINS: process.env.GOOGLE_ALLOWED_ORIGINS
  };
  delete process.env.APP_BASE_URL;
  delete process.env.APP_URL;
  delete process.env.GOOGLE_REDIRECT_URI;
  delete process.env.GOOGLE_ALLOWED_ORIGINS;
  process.env.GOOGLE_CLIENT_ID = "google-client-id";
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/calendar/oauth/google/callback?state=not-a-real-state&code=demo-code"
    });

    assert.equal(response.statusCode, 500);
    assert.match(response.body, /Google sign-in state is invalid or expired/i);
  } finally {
    if (previousEnv.APP_BASE_URL === undefined) {
      delete process.env.APP_BASE_URL;
    } else {
      process.env.APP_BASE_URL = previousEnv.APP_BASE_URL;
    }
    if (previousEnv.APP_URL === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = previousEnv.APP_URL;
    }
    if (previousEnv.GOOGLE_CLIENT_ID === undefined) {
      delete process.env.GOOGLE_CLIENT_ID;
    } else {
      process.env.GOOGLE_CLIENT_ID = previousEnv.GOOGLE_CLIENT_ID;
    }
    if (previousEnv.GOOGLE_REDIRECT_URI === undefined) {
      delete process.env.GOOGLE_REDIRECT_URI;
    } else {
      process.env.GOOGLE_REDIRECT_URI = previousEnv.GOOGLE_REDIRECT_URI;
    }
    if (previousEnv.GOOGLE_ALLOWED_ORIGINS === undefined) {
      delete process.env.GOOGLE_ALLOWED_ORIGINS;
    } else {
      process.env.GOOGLE_ALLOWED_ORIGINS = previousEnv.GOOGLE_ALLOWED_ORIGINS;
    }
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("google oauth callback explains when the configured client still needs a server client secret", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-google-oauth-client-secret-required-")
  );
  const previousEnv = {
    APP_BASE_URL: process.env.APP_BASE_URL,
    APP_URL: process.env.APP_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    GOOGLE_ALLOWED_ORIGINS: process.env.GOOGLE_ALLOWED_ORIGINS
  };
  process.env.APP_BASE_URL = "http://127.0.0.1:4317";
  delete process.env.APP_URL;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REDIRECT_URI;
  delete process.env.GOOGLE_ALLOWED_ORIGINS;
  process.env.GOOGLE_CLIENT_ID = "google-client-id";
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      return new Response(
        JSON.stringify({
          error: "invalid_client",
          error_description: "client_secret is missing."
        }),
        {
          status: 400,
          headers: { "content-type": "application/json" }
        }
      );
    }
    throw new Error(
      `Unexpected fetch during Google OAuth callback test: ${url}`
    );
  }) as typeof fetch;

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const startResponse = await app.inject({
      method: "POST",
      url: "/api/v1/calendar/oauth/google/start",
      headers: {
        cookie: operatorCookie,
        origin: "http://127.0.0.1:3027",
        "x-forwarded-proto": "http",
        "x-forwarded-host": "127.0.0.1:4317"
      },
      payload: {
        label: "Primary Google",
        browserOrigin: "http://127.0.0.1:3027"
      }
    });

    assert.equal(startResponse.statusCode, 200);
    const startBody = startResponse.json() as {
      session: { authUrl: string | null };
    };
    const state = new URL(startBody.session.authUrl ?? "").searchParams.get(
      "state"
    );
    assert.ok(state);

    const callbackResponse = await app.inject({
      method: "GET",
      url: `/api/v1/calendar/oauth/google/callback?state=${encodeURIComponent(state!)}&code=demo-code`
    });

    assert.equal(callbackResponse.statusCode, 200);
    assert.match(callbackResponse.body, /requires a client secret/i);
    assert.match(callbackResponse.body, /GOOGLE_CLIENT_SECRET/);
    assert.match(callbackResponse.body, /Desktop app client/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousEnv.APP_BASE_URL === undefined) {
      delete process.env.APP_BASE_URL;
    } else {
      process.env.APP_BASE_URL = previousEnv.APP_BASE_URL;
    }
    if (previousEnv.APP_URL === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = previousEnv.APP_URL;
    }
    if (previousEnv.GOOGLE_CLIENT_ID === undefined) {
      delete process.env.GOOGLE_CLIENT_ID;
    } else {
      process.env.GOOGLE_CLIENT_ID = previousEnv.GOOGLE_CLIENT_ID;
    }
    if (previousEnv.GOOGLE_CLIENT_SECRET === undefined) {
      delete process.env.GOOGLE_CLIENT_SECRET;
    } else {
      process.env.GOOGLE_CLIENT_SECRET = previousEnv.GOOGLE_CLIENT_SECRET;
    }
    if (previousEnv.GOOGLE_REDIRECT_URI === undefined) {
      delete process.env.GOOGLE_REDIRECT_URI;
    } else {
      process.env.GOOGLE_REDIRECT_URI = previousEnv.GOOGLE_REDIRECT_URI;
    }
    if (previousEnv.GOOGLE_ALLOWED_ORIGINS === undefined) {
      delete process.env.GOOGLE_ALLOWED_ORIGINS;
    } else {
      process.env.GOOGLE_ALLOWED_ORIGINS = previousEnv.GOOGLE_ALLOWED_ORIGINS;
    }
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("google oauth callback includes the server client secret in the token exchange when configured", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-google-oauth-client-secret-body-")
  );
  const previousEnv = {
    APP_BASE_URL: process.env.APP_BASE_URL,
    APP_URL: process.env.APP_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    GOOGLE_ALLOWED_ORIGINS: process.env.GOOGLE_ALLOWED_ORIGINS
  };
  process.env.APP_BASE_URL = "http://127.0.0.1:4317";
  delete process.env.APP_URL;
  process.env.GOOGLE_CLIENT_ID = "google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
  delete process.env.GOOGLE_REDIRECT_URI;
  delete process.env.GOOGLE_ALLOWED_ORIGINS;
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  const originalFetch = globalThis.fetch;
  const tokenRequestBodies: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      tokenRequestBodies.push(String(init?.body ?? ""));
      return new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Code was already redeemed."
        }),
        {
          status: 400,
          headers: { "content-type": "application/json" }
        }
      );
    }
    throw new Error(
      `Unexpected fetch during Google OAuth callback secret test: ${url}`
    );
  }) as typeof fetch;

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const startResponse = await app.inject({
      method: "POST",
      url: "/api/v1/calendar/oauth/google/start",
      headers: {
        cookie: operatorCookie,
        origin: "http://127.0.0.1:3027",
        "x-forwarded-proto": "http",
        "x-forwarded-host": "127.0.0.1:4317"
      },
      payload: {
        label: "Primary Google",
        browserOrigin: "http://127.0.0.1:3027"
      }
    });

    assert.equal(startResponse.statusCode, 200);
    const startBody = startResponse.json() as {
      session: { authUrl: string | null };
    };
    const state = new URL(startBody.session.authUrl ?? "").searchParams.get(
      "state"
    );
    assert.ok(state);

    const callbackResponse = await app.inject({
      method: "GET",
      url: `/api/v1/calendar/oauth/google/callback?state=${encodeURIComponent(state!)}&code=demo-code`
    });

    assert.equal(callbackResponse.statusCode, 200);
    assert.equal(tokenRequestBodies.length, 1);
    assert.match(
      tokenRequestBodies[0] ?? "",
      /client_secret=google-client-secret/
    );
    assert.match(tokenRequestBodies[0] ?? "", /client_id=google-client-id/);
    assert.match(tokenRequestBodies[0] ?? "", /code_verifier=/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousEnv.APP_BASE_URL === undefined) {
      delete process.env.APP_BASE_URL;
    } else {
      process.env.APP_BASE_URL = previousEnv.APP_BASE_URL;
    }
    if (previousEnv.APP_URL === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = previousEnv.APP_URL;
    }
    if (previousEnv.GOOGLE_CLIENT_ID === undefined) {
      delete process.env.GOOGLE_CLIENT_ID;
    } else {
      process.env.GOOGLE_CLIENT_ID = previousEnv.GOOGLE_CLIENT_ID;
    }
    if (previousEnv.GOOGLE_CLIENT_SECRET === undefined) {
      delete process.env.GOOGLE_CLIENT_SECRET;
    } else {
      process.env.GOOGLE_CLIENT_SECRET = previousEnv.GOOGLE_CLIENT_SECRET;
    }
    if (previousEnv.GOOGLE_REDIRECT_URI === undefined) {
      delete process.env.GOOGLE_REDIRECT_URI;
    } else {
      process.env.GOOGLE_REDIRECT_URI = previousEnv.GOOGLE_REDIRECT_URI;
    }
    if (previousEnv.GOOGLE_ALLOWED_ORIGINS === undefined) {
      delete process.env.GOOGLE_ALLOWED_ORIGINS;
    } else {
      process.env.GOOGLE_ALLOWED_ORIGINS = previousEnv.GOOGLE_ALLOWED_ORIGINS;
    }
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("collaboration routes persist insights, feedback, and approval-gated agent actions", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-collab-api-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const goalsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/goals"
    });
    const goalId = (goalsResponse.json() as { goals: Array<{ id: string }> })
      .goals[0]!.id;

    const createdToken = await app.inject({
      method: "POST",
      url: "/api/v1/settings/tokens",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        label: "OpenClaw token",
        agentLabel: "OpenClaw",
        agentType: "assistant",
        description: "Collaborative planning agent",
        trustLevel: "trusted",
        autonomyMode: "approval_required",
        approvalMode: "approval_by_default",
        scopes: ["read", "write", "insights"]
      }
    });
    assert.equal(createdToken.statusCode, 201);
    const tokenBody = createdToken.json() as {
      token: {
        token: string;
        tokenSummary: { agentId: string; id: string };
      };
    };
    const agentHeaders = {
      authorization: `Bearer ${tokenBody.token.token}`,
      "x-forge-source": "agent",
      "x-forge-actor": "OpenClaw"
    };

    const insightResponse = await app.inject({
      method: "POST",
      url: "/api/v1/insights",
      headers: agentHeaders,
      payload: {
        originType: "agent",
        originAgentId: tokenBody.token.tokenSummary.agentId,
        originLabel: "OpenClaw",
        entityType: "goal",
        entityId: goalId,
        timeframeLabel: "This week",
        title: "Protect the lead goal",
        summary: "Recent activity is concentrated in one goal.",
        recommendation:
          "Create another concrete project so the arc stays active.",
        rationale: "Balanced progress is part of Forge's operating model.",
        confidence: 0.84,
        ctaLabel: "Review insight",
        evidence: []
      }
    });
    assert.equal(insightResponse.statusCode, 201);
    const insightId = (insightResponse.json() as { insight: { id: string } })
      .insight.id;

    const feedbackResponse = await app.inject({
      method: "POST",
      url: `/api/v1/insights/${insightId}/feedback`,
      headers: agentHeaders,
      payload: {
        feedbackType: "applied",
        note: "Applying the recommendation."
      }
    });
    assert.equal(feedbackResponse.statusCode, 200);

    const xpResponse = await app.inject({
      method: "GET",
      url: "/api/v1/metrics/xp"
    });
    assert.equal(xpResponse.statusCode, 200);
    const xpBody = xpResponse.json() as {
      metrics: { recentLedger: Array<{ reasonTitle: string }> };
    };
    assert.ok(
      xpBody.metrics.recentLedger.some(
        (entry) => entry.reasonTitle === "Insight applied"
      )
    );

    const actionResponse = await app.inject({
      method: "POST",
      url: "/api/v1/agent-actions",
      headers: {
        ...agentHeaders,
        "Idempotency-Key": "agent-action-create-project"
      },
      payload: {
        actionType: "create_project",
        riskLevel: "medium",
        title: "Create second project path",
        summary: "Add a second concrete project under the goal.",
        agentId: tokenBody.token.tokenSummary.agentId,
        tokenId: tokenBody.token.tokenSummary.id,
        payload: {
          goalId,
          title: "Second Path",
          description: "A new project created through the approval workflow.",
          status: "active",
          targetPoints: 220,
          themeColor: "#7788cc"
        }
      }
    });
    assert.equal(actionResponse.statusCode, 202);
    const actionBody = actionResponse.json() as {
      approvalRequest: { id: string; status: string } | null;
    };
    assert.equal(actionBody.approvalRequest?.status, "pending");

    const approvalResponse = await app.inject({
      method: "POST",
      url: `/api/v1/approval-requests/${actionBody.approvalRequest!.id}/approve`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        note: "Safe to execute."
      }
    });
    assert.equal(approvalResponse.statusCode, 200);
    const approvalBody = approvalResponse.json() as {
      approvalRequest: { status: string };
    };
    assert.equal(approvalBody.approvalRequest.status, "executed");

    const projectsResponse = await app.inject({
      method: "GET",
      url: `/api/v1/projects?goalId=${goalId}`
    });
    const projectsBody = projectsResponse.json() as {
      projects: Array<{ title: string }>;
    };
    assert.ok(
      projectsBody.projects.some((project) => project.title === "Second Path")
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("session events and reward endpoints expose bounded ambient XP", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-session-rewards-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const firstEvent = await app.inject({
      method: "POST",
      url: "/api/v1/session-events",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        sessionId: "session_alpha",
        eventType: "dwell_120_seconds",
        metrics: {
          visible: true,
          interacted: true
        }
      }
    });
    assert.equal(firstEvent.statusCode, 201);
    const firstBody = firstEvent.json() as {
      rewardEvent: { deltaXp: number } | null;
    };
    assert.equal(firstBody.rewardEvent?.deltaXp, 2);

    const rewardsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/rewards/ledger?limit=10",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(rewardsResponse.statusCode, 200);
    const rewardsBody = rewardsResponse.json() as {
      ledger: Array<{ reasonTitle: string }>;
    };
    assert.ok(
      rewardsBody.ledger.some(
        (entry) => entry.reasonTitle === "Active dwell milestone"
      )
    );

    const eventsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/events?limit=10"
    });
    assert.equal(eventsResponse.statusCode, 200);
    const eventsBody = eventsResponse.json() as {
      events: Array<{ eventKind: string }>;
    };
    assert.ok(
      eventsBody.events.some(
        (entry) => entry.eventKind === "session.dwell_120_seconds"
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("agent runtime sessions register, heartbeat, and expose reconnect history", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-agent-runtime-sessions-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const registerResponse = await app.inject({
      method: "POST",
      url: "/api/v1/agents/sessions",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        provider: "codex",
        agentLabel: "Forge Codex",
        agentType: "codex",
        actorLabel: "Albert",
        sessionKey: "codex-test-session",
        sessionLabel: "Forge MCP server",
        connectionMode: "mcp",
        baseUrl: "http://127.0.0.1:4317",
        webUrl: "http://127.0.0.1:4317/forge/",
        externalSessionId: "codex-instance-a",
        metadata: {
          pid: 12345,
          singleton: true
        }
      }
    });
    assert.equal(registerResponse.statusCode, 200);
    const registerBody = registerResponse.json() as {
      session: { id: string; status: string };
    };
    assert.equal(registerBody.session.status, "connected");

    const createTokenResponse = await app.inject({
      method: "POST",
      url: "/api/v1/settings/tokens",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        label: "Codex runtime token",
        agentLabel: "Forge Codex",
        agentType: "codex",
        scopes: ["write"],
        autonomyMode: "scoped_write",
        approvalMode: "none"
      }
    });
    assert.equal(createTokenResponse.statusCode, 201);
    const createTokenBody = createTokenResponse.json() as {
      token: { token: string };
    };

    const heartbeatResponse = await app.inject({
      method: "POST",
      url: "/api/v1/agents/sessions/heartbeat",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        provider: "codex",
        sessionKey: "codex-test-session",
        externalSessionId: "codex-instance-a",
        summary: "Heartbeat from MCP test."
      }
    });
    assert.equal(heartbeatResponse.statusCode, 200);

    const eventResponse = await app.inject({
      method: "POST",
      url: "/api/v1/agents/sessions/events",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        provider: "codex",
        sessionKey: "codex-test-session",
        externalSessionId: "codex-instance-a",
        eventType: "tool_call",
        title: "Tool call: forge_get_operator_overview",
        summary: "Requested the operator overview."
      }
    });
    assert.equal(eventResponse.statusCode, 200);

    const actionResponse = await app.inject({
      method: "POST",
      url: "/api/v1/agent-actions",
      headers: {
        authorization: `Bearer ${createTokenBody.token.token}`
      },
      payload: {
        actionType: "session_history_probe",
        riskLevel: "low",
        title: "Session history probe",
        summary: "Record one action so the runtime history can expose it.",
        payload: {
          provider: "codex"
        }
      }
    });
    assert.equal(actionResponse.statusCode, 201);

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/v1/agents/sessions",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(listResponse.statusCode, 200);
    const listBody = listResponse.json() as {
      sessions: Array<{
        id: string;
        provider: string;
        actionCount: number;
        recentEvents: Array<{ title: string }>;
      }>;
    };
    assert.equal(listBody.sessions[0]?.provider, "codex");
    assert.equal(listBody.sessions[0]?.actionCount, 1);
    assert.ok(
      listBody.sessions[0]?.recentEvents.some((event) =>
        event.title.includes("forge_get_operator_overview")
      )
    );

    const reconnectResponse = await app.inject({
      method: "POST",
      url: `/api/v1/agents/sessions/${registerBody.session.id}/reconnect`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        note: "Reconnect this MCP bridge."
      }
    });
    assert.equal(reconnectResponse.statusCode, 200);
    const reconnectBody = reconnectResponse.json() as {
      session: { status: string; reconnectPlan: { commands: string[] } };
    };
    assert.equal(reconnectBody.session.status, "reconnecting");
    assert.ok(reconnectBody.session.reconnectPlan.commands.length > 0);

    const historyResponse = await app.inject({
      method: "GET",
      url: `/api/v1/agents/sessions/${registerBody.session.id}/history`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(historyResponse.statusCode, 200);
    const historyBody = historyResponse.json() as {
      events: Array<{ eventType: string }>;
      actions: Array<{ actionType: string; title: string }>;
    };
    assert.ok(
      historyBody.events.some((event) => event.eventType === "reconnect_requested")
    );
    assert.ok(
      historyBody.actions.some(
        (action) =>
          action.actionType === "session_history_probe" &&
          action.title === "Session history probe"
      )
    );

    const disconnectResponse = await app.inject({
      method: "POST",
      url: `/api/v1/agents/sessions/${registerBody.session.id}/disconnect`,
      headers: {
        authorization: `Bearer ${createTokenBody.token.token}`
      },
      payload: {
        note: "Disconnect through the managed runtime token.",
        externalSessionId: "codex-instance-a"
      }
    });
    assert.equal(disconnectResponse.statusCode, 200);
    const disconnectBody = disconnectResponse.json() as {
      session: { status: string; endedAt: string | null };
    };
    assert.equal(disconnectBody.session.status, "disconnected");
    assert.ok(disconnectBody.session.endedAt);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("singleton codex runtime sessions supersede older bridges and ignore stale disconnects", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-agent-runtime-singleton-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const firstRegister = await app.inject({
      method: "POST",
      url: "/api/v1/agents/sessions",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        provider: "codex",
        agentLabel: "Forge Codex",
        agentType: "codex",
        actorLabel: "Albert",
        sessionKey: "codex-shared-bridge",
        sessionLabel: "Forge Codex bridge",
        connectionMode: "mcp",
        baseUrl: "http://127.0.0.1:4317",
        webUrl: "http://127.0.0.1:4317/forge/",
        externalSessionId: "codex-instance-a",
        metadata: {
          singleton: true
        }
      }
    });
    assert.equal(firstRegister.statusCode, 200);
    const firstBody = firstRegister.json() as {
      session: { id: string; status: string };
    };

    const secondRegister = await app.inject({
      method: "POST",
      url: "/api/v1/agents/sessions",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        provider: "codex",
        agentLabel: "Forge Codex",
        agentType: "codex",
        actorLabel: "Albert",
        sessionKey: "codex-shared-bridge",
        sessionLabel: "Forge Codex bridge",
        connectionMode: "mcp",
        baseUrl: "http://127.0.0.1:4317",
        webUrl: "http://127.0.0.1:4317/forge/",
        externalSessionId: "codex-instance-b",
        metadata: {
          singleton: true
        }
      }
    });
    assert.equal(secondRegister.statusCode, 200);

    const staleDisconnect = await app.inject({
      method: "POST",
      url: `/api/v1/agents/sessions/${firstBody.session.id}/disconnect`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        note: "Old bridge shutting down.",
        externalSessionId: "codex-instance-a"
      }
    });
    assert.equal(staleDisconnect.statusCode, 200);
    const staleDisconnectBody = staleDisconnect.json() as {
      session: { status: string; endedAt: string | null; externalSessionId: string | null };
    };
    assert.equal(staleDisconnectBody.session.status, "connected");
    assert.equal(staleDisconnectBody.session.endedAt, null);
    assert.equal(staleDisconnectBody.session.externalSessionId, "codex-instance-b");

    const historyResponse = await app.inject({
      method: "GET",
      url: `/api/v1/agents/sessions/${firstBody.session.id}/history`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(historyResponse.statusCode, 200);
    const historyBody = historyResponse.json() as {
      events: Array<{ eventType: string }>;
    };
    assert.ok(
      historyBody.events.some((event) => event.eventType === "session_registered")
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("agent runtime identities stay stable across volatile session keys and labels", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-agent-runtime-identity-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    for (const payload of [
      {
        provider: "openclaw",
        agentLabel: "Forge OpenClaw",
        agentType: "openclaw",
        sessionKey: "agent:main:cron:111",
        externalSessionId: "agent:main:cron:111"
      },
      {
        provider: "openclaw",
        agentLabel: "aurel",
        agentType: "openclaw",
        sessionKey: "agent:main:whatsapp:direct:+4474",
        externalSessionId: "agent:main:whatsapp:direct:+4474"
      },
      {
        provider: "hermes",
        agentLabel: "Forge Hermes Auth Probe",
        agentType: "hermes",
        sessionKey: "auth-probe",
        externalSessionId: "auth-probe"
      },
      {
        provider: "hermes",
        agentLabel: "Forge Hermes",
        agentType: "hermes",
        sessionKey: "20260424_052517_b0f6bfff",
        externalSessionId: "20260424_052517_b0f6bfff"
      }
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/agents/sessions",
        headers: {
          cookie: operatorCookie
        },
        payload: {
          ...payload,
          actorLabel: "Albert",
          connectionMode: "operator_session",
          baseUrl: "http://127.0.0.1:4317",
          webUrl: "http://127.0.0.1:4317/forge/",
          dataRoot: rootDir,
          machineKey: "test-machine",
          personaKey: "default",
          metadata: {
            singleton: true
          }
        }
      });
      assert.equal(response.statusCode, 200);
    }

    const sessionsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/agents/sessions",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(sessionsResponse.statusCode, 200);
    const sessionsBody = sessionsResponse.json() as {
      sessions: Array<{ provider: string; agentId: string | null }>;
    };
    const openclawAgentIds = new Set(
      sessionsBody.sessions
        .filter((session) => session.provider === "openclaw")
        .map((session) => session.agentId)
    );
    const hermesAgentIds = new Set(
      sessionsBody.sessions
        .filter((session) => session.provider === "hermes")
        .map((session) => session.agentId)
    );
    assert.equal(openclawAgentIds.size, 1);
    assert.equal(hermesAgentIds.size, 1);

    const agentsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/agents",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(agentsResponse.statusCode, 200);
    const agentsBody = agentsResponse.json() as {
      agents: Array<{
        label: string;
        provider: string | null;
        activeTokenCount: number;
        identityKey: string | null;
        linkedUsers: Array<{ userId: string }>;
      }>;
    };
    const openclawAgents = agentsBody.agents.filter(
      (agent) => agent.provider === "openclaw"
    );
    const hermesAgents = agentsBody.agents.filter(
      (agent) => agent.provider === "hermes"
    );
    assert.equal(openclawAgents.length, 1);
    assert.equal(hermesAgents.length, 1);
    assert.equal(openclawAgents[0]?.label, "Forge OpenClaw");
    assert.equal(hermesAgents[0]?.label, "Forge Hermes");
    assert.equal(openclawAgents[0]?.activeTokenCount, 0);
    assert.ok(openclawAgents[0]?.identityKey?.includes("test_machine"));
    assert.ok(
      openclawAgents[0]?.linkedUsers.some(
        (link) => link.userId === "user_agent_openclaw"
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("failed wiki ingests can be rerun into a fresh job", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-wiki-ingest-rerun-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const createProfileResponse = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/settings/llm-profiles",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        label: "Missing key profile",
        provider: "openai-responses",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.4-mini",
        enabled: true,
        systemPrompt: ""
      }
    });
    assert.equal(createProfileResponse.statusCode, 201);
    const createProfileBody = createProfileResponse.json() as {
      profile: { id: string };
    };

    const createJobResponse = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/ingest-jobs",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        titleHint: "Rerunnable ingest",
        sourceKind: "raw_text",
        sourceText: "Forge should be able to rerun this failed ingest.",
        mimeType: "text/plain",
        llmProfileId: createProfileBody.profile.id,
        parseStrategy: "auto",
        entityProposalMode: "suggest",
        createAsKind: "wiki",
        linkedEntityHints: []
      }
    });
    assert.equal(createJobResponse.statusCode, 201);
    const createJobBody = createJobResponse.json() as {
      job: { job: { id: string } };
    };
    const originalJobId = createJobBody.job.job.id;

    let originalStatus = "queued";
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const jobResponse = await app.inject({
        method: "GET",
        url: `/api/v1/wiki/ingest-jobs/${originalJobId}`,
        headers: {
          cookie: operatorCookie
        }
      });
      assert.equal(jobResponse.statusCode, 200);
      const jobBody = jobResponse.json() as {
        job: { status: string };
      };
      originalStatus = jobBody.job.status;
      if (!["queued", "processing"].includes(originalStatus)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(originalStatus, "failed");

    const rerunResponse = await app.inject({
      method: "POST",
      url: `/api/v1/wiki/ingest-jobs/${originalJobId}/rerun`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(rerunResponse.statusCode, 201);
    const rerunBody = rerunResponse.json() as {
      job: { job: { id: string } } | null;
    };
    const rerunJobId = rerunBody.job?.job.id;
    assert.ok(rerunJobId);
    assert.notEqual(rerunJobId, originalJobId);

    let rerunStatus = "queued";
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const jobResponse: Awaited<ReturnType<typeof app.inject>> =
        await app.inject({
          method: "GET",
          url: `/api/v1/wiki/ingest-jobs/${rerunJobId}`,
          headers: {
            cookie: operatorCookie
          }
        });
      assert.equal(jobResponse.statusCode, 200);
      const jobBody = jobResponse.json() as {
        job: { status: string };
        logs: Array<{ eventKey?: string; metadata?: Record<string, unknown> }>;
      };
      rerunStatus = jobBody.job.status;
      if (!["queued", "processing"].includes(rerunStatus)) {
        assert.ok(
          jobBody.logs.some(
            (entry) =>
              entry.metadata?.eventKey === "wiki_ingest_rerun" &&
              entry.metadata?.sourceJobId === originalJobId
          )
        );
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(rerunStatus, "failed");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("diagnostic logs capture UI-published entries plus backend request and error traces", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-diagnostics-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const contextResponse = await app.inject({
      method: "GET",
      url: "/api/v1/context",
      headers: {
        cookie: operatorCookie,
        "x-forge-source": "ui"
      }
    });
    assert.equal(contextResponse.statusCode, 200);

    const unauthorizedRewards = await app.inject({
      method: "GET",
      url: "/api/v1/rewards/ledger?limit=10",
      headers: {
        "x-forge-source": "ui"
      }
    });
    assert.equal(unauthorizedRewards.statusCode, 401);

    const published = await app.inject({
      method: "POST",
      url: "/api/v1/diagnostics/logs",
      headers: {
        "x-forge-source": "ui"
      },
      payload: {
        level: "error",
        scope: "frontend_runtime",
        eventKey: "manual_ui_error",
        message: "Widget exploded in the browser.",
        route: "/wiki",
        jobId: "wiki_ingest_demo",
        details: {
          component: "WikiComposer",
          statusCode: 400
        }
      }
    });
    assert.equal(published.statusCode, 201);

    const logsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/diagnostics/logs?limit=50",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(logsResponse.statusCode, 200);
    const logsBody = logsResponse.json() as {
      logs: Array<{
        scope: string;
        eventKey: string;
        message: string;
        source: string;
        route: string | null;
        level: string;
        jobId: string | null;
      }>;
    };

    assert.ok(
      logsBody.logs.some(
        (entry) =>
          entry.scope === "frontend_runtime" &&
          entry.eventKey === "manual_ui_error" &&
          entry.source === "ui" &&
          entry.jobId === "wiki_ingest_demo"
      )
    );
    assert.ok(
      logsBody.logs.some(
        (entry) =>
          entry.scope === "api_request" &&
          entry.route === "/api/v1/context" &&
          entry.source === "ui"
      )
    );
    assert.ok(
      logsBody.logs.some(
        (entry) =>
          entry.scope === "api_error" &&
          entry.route === "/api/v1/rewards/ledger" &&
          entry.level === "warning"
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("diagnostic log retention prunes expired entries before the store grows indefinitely", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-diagnostic-retention-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const staleTimestamp = new Date(
      Date.now() - (DIAGNOSTIC_LOG_RETENTION_DAYS + 2) * 24 * 60 * 60 * 1_000
    );

    recordDiagnosticLog(
      {
        level: "info",
        source: "server",
        scope: "retention_probe",
        eventKey: "stale_log",
        message: "This old diagnostic entry should be removed.",
        details: {}
      },
      staleTimestamp
    );
    recordDiagnosticLog({
      level: "info",
      source: "server",
      scope: "retention_probe",
      eventKey: "fresh_log",
      message: "This recent diagnostic entry should remain visible.",
      details: {}
    });

    const retention = enforceDiagnosticLogRetention({ force: true });
    assert.ok(retention.ran);
    assert.ok(retention.prunedCount >= 1);

    const logsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/diagnostics/logs?scope=retention_probe&limit=20",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(logsResponse.statusCode, 200);
    const logsBody = logsResponse.json() as {
      logs: Array<{ eventKey: string }>;
    };

    assert.ok(logsBody.logs.some((entry) => entry.eventKey === "fresh_log"));
    assert.ok(!logsBody.logs.some((entry) => entry.eventKey === "stale_log"));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("background job diagnostics capture enqueue, success, and failure lifecycle events", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-background-logs-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });
  const manager = new BackgroundJobManager();

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    await new Promise<void>((resolve) => {
      manager.enqueue({
        id: "bg_success_demo",
        label: "Successful job",
        handler: async () => {
          resolve();
        }
      });
    });

    await new Promise<void>((resolve) => {
      manager.enqueue({
        id: "bg_failure_demo",
        label: "Failing job",
        handler: async () => {
          resolve();
          throw new Error("Simulated background failure");
        }
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    const logsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/diagnostics/logs?scope=background_job&limit=20",
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(logsResponse.statusCode, 200);
    const logsBody = logsResponse.json() as {
      logs: Array<{
        eventKey: string;
        source: string;
        jobId: string | null;
        level: string;
      }>;
    };

    assert.ok(
      logsBody.logs.some(
        (entry) =>
          entry.eventKey === "background_job_enqueued" &&
          entry.source === "system" &&
          entry.jobId === "bg_success_demo"
      )
    );
    assert.ok(
      logsBody.logs.some(
        (entry) =>
          entry.eventKey === "background_job_completed" &&
          entry.source === "system" &&
          entry.jobId === "bg_success_demo"
      )
    );
    assert.ok(
      logsBody.logs.some(
        (entry) =>
          entry.eventKey === "background_job_failed" &&
          entry.level === "error" &&
          entry.jobId === "bg_failure_demo"
      )
    );
  } finally {
    await manager.stop();
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("background job manager can run multiple jobs at the same time", async () => {
  const manager = new BackgroundJobManager(2);
  let activeCount = 0;
  let maxSeenActiveCount = 0;
  let releaseFirst: (() => void) | null = null;
  let releaseSecond: (() => void) | null = null;

  const firstStarted = new Promise<void>((resolve) => {
    manager.enqueue({
      id: "bg_parallel_one",
      label: "Parallel one",
      handler: async () => {
        activeCount += 1;
        maxSeenActiveCount = Math.max(maxSeenActiveCount, activeCount);
        resolve();
        await new Promise<void>((innerResolve) => {
          releaseFirst = innerResolve;
        });
        activeCount -= 1;
      }
    });
  });

  const secondStarted = new Promise<void>((resolve) => {
    manager.enqueue({
      id: "bg_parallel_two",
      label: "Parallel two",
      handler: async () => {
        activeCount += 1;
        maxSeenActiveCount = Math.max(maxSeenActiveCount, activeCount);
        resolve();
        await new Promise<void>((innerResolve) => {
          releaseSecond = innerResolve;
        });
        activeCount -= 1;
      }
    });
  });

  await Promise.all([firstStarted, secondStarted]);
  assert.equal(maxSeenActiveCount, 2);
  assert.ok(manager.isActive("bg_parallel_one"));
  assert.ok(manager.isActive("bg_parallel_two"));

  const releaseFirstFn = releaseFirst;
  const releaseSecondFn = releaseSecond;
  assert.ok(releaseFirstFn);
  assert.ok(releaseSecondFn);
  (releaseFirstFn as () => void)();
  (releaseSecondFn as () => void)();
  await manager.stop();
});

test("wiki ingest diagnostics explain missing llm api key and background job execution", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-wiki-llm-logs-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const createProfileResponse = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/settings/llm-profiles",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        label: "Missing key profile",
        provider: "openai-responses",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.4-mini",
        enabled: true,
        systemPrompt: ""
      }
    });
    assert.equal(createProfileResponse.statusCode, 201);
    const createProfileBody = createProfileResponse.json() as {
      profile: { id: string };
    };

    const createJobResponse = await app.inject({
      method: "POST",
      url: "/api/v1/wiki/ingest-jobs",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        titleHint: "Missing key ingest",
        sourceKind: "raw_text",
        sourceText: "Short note about a meeting.",
        mimeType: "text/plain",
        llmProfileId: createProfileBody.profile.id,
        parseStrategy: "auto",
        entityProposalMode: "suggest",
        createAsKind: "wiki",
        linkedEntityHints: []
      }
    });
    assert.equal(createJobResponse.statusCode, 201);
    const createJobBody = createJobResponse.json() as {
      job: { job: { id: string } };
    };
    const jobId = createJobBody.job.job.id;

    let jobStatus = "queued";
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const jobResponse = await app.inject({
        method: "GET",
        url: `/api/v1/wiki/ingest-jobs/${jobId}`,
        headers: {
          cookie: operatorCookie
        }
      });
      assert.equal(jobResponse.statusCode, 200);
      const jobBody = jobResponse.json() as {
        job: { status: string };
      };
      jobStatus = jobBody.job.status;
      if (!["queued", "processing"].includes(jobStatus)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    assert.equal(jobStatus, "failed");

    const logsResponse = await app.inject({
      method: "GET",
      url: `/api/v1/diagnostics/logs?jobId=${jobId}&limit=50`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(logsResponse.statusCode, 200);
    const logsBody = logsResponse.json() as {
      logs: Array<{
        scope: string;
        eventKey: string;
        message: string;
        jobId: string | null;
      }>;
    };

    assert.ok(
      logsBody.logs.some(
        (entry) =>
          entry.scope === "background_job" &&
          entry.eventKey === "background_job_enqueued" &&
          entry.jobId === jobId
      )
    );
    assert.ok(
      logsBody.logs.some(
        (entry) =>
          entry.scope === "background_job" &&
          entry.eventKey === "background_job_completed" &&
          entry.jobId === jobId
      )
    );
    assert.ok(
      logsBody.logs.some(
        (entry) =>
          entry.scope === "wiki_llm" &&
          entry.eventKey === "llm_api_key_missing" &&
          entry.jobId === jobId
      )
    );
    assert.ok(
      logsBody.logs.some(
        (entry) =>
          entry.scope === "wiki_ingest" &&
          entry.message.includes(
            "The LLM did not produce structured draft candidates"
          ) &&
          entry.jobId === jobId
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("task timers can be started, heartbeated, focused, and completed", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-task-runs-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard"
    });
    const taskId = (dashboard.json() as { tasks: Array<{ id: string }> })
      .tasks[0]!.id;

    const claimed = await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/runs`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        actor: "Aurel",
        leaseTtlSeconds: 60,
        timerMode: "planned",
        plannedDurationSeconds: 1500,
        note: "Starting the execution pass."
      }
    });

    assert.equal(claimed.statusCode, 201);
    const claimedRun = (
      claimed.json() as {
        taskRun: {
          id: string;
          actor: string;
          status: string;
          timerMode: string;
          plannedDurationSeconds: number | null;
          isCurrent: boolean;
          creditedSeconds: number;
        };
      }
    ).taskRun;
    assert.equal(claimedRun.actor, "Aurel");
    assert.equal(claimedRun.status, "active");
    assert.equal(claimedRun.timerMode, "planned");
    assert.equal(claimedRun.plannedDurationSeconds, 1500);
    assert.equal(claimedRun.isCurrent, true);
    assert.ok(claimedRun.creditedSeconds >= 0);

    const conflict = await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/runs`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        actor: "Albert",
        leaseTtlSeconds: 60
      }
    });

    assert.equal(conflict.statusCode, 409);

    const heartbeat = await app.inject({
      method: "POST",
      url: `/api/task-runs/${claimedRun.id}/heartbeat`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        actor: "Aurel",
        leaseTtlSeconds: 120,
        note: "Still working."
      }
    });

    assert.equal(heartbeat.statusCode, 200);
    const heartbeated = (
      heartbeat.json() as { taskRun: { note: string; leaseTtlSeconds: number } }
    ).taskRun;
    assert.equal(heartbeated.note, "Still working.");
    assert.equal(heartbeated.leaseTtlSeconds, 120);

    const focused = await app.inject({
      method: "POST",
      url: `/api/v1/task-runs/${claimedRun.id}/focus`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        actor: "Aurel"
      }
    });
    assert.equal(focused.statusCode, 200);
    assert.equal(
      (focused.json() as { taskRun: { isCurrent: boolean } }).taskRun.isCurrent,
      true
    );

    const completed = await app.inject({
      method: "POST",
      url: `/api/task-runs/${claimedRun.id}/complete`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        actor: "Aurel",
        note: "Execution finished cleanly."
      }
    });

    assert.equal(completed.statusCode, 200);
    const completedRun = (
      completed.json() as {
        taskRun: { status: string; completedAt: string | null };
      }
    ).taskRun;
    assert.equal(completedRun.status, "completed");
    assert.ok(completedRun.completedAt);

    const taskContext = await app.inject({
      method: "GET",
      url: `/api/tasks/${taskId}/context`
    });
    assert.equal(taskContext.statusCode, 200);
    const taskContextBody = taskContext.json() as {
      task: { status: string; completedAt: string | null };
      activity: Array<{
        entityType: string;
        eventType: string;
        actor: string | null;
      }>;
    };

    assert.equal(taskContextBody.task.status, "done");
    assert.ok(taskContextBody.task.completedAt);
    assert.ok(
      taskContextBody.activity.some(
        (event) =>
          event.entityType === "task" &&
          event.eventType === "task_completed" &&
          event.actor === "Aurel"
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("task run conflicts return structured lease details for recovery", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-task-run-conflict-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard"
    });
    const taskId = (dashboard.json() as { tasks: Array<{ id: string }> })
      .tasks[0]!.id;

    const claimed = await app.inject({
      method: "POST",
      url: "/api/tasks/" + taskId + "/runs",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        actor: "Aurel",
        leaseTtlSeconds: 60,
        note: "Holding the task lease."
      }
    });
    assert.equal(claimed.statusCode, 201);
    const claimedRun = (
      claimed.json() as {
        taskRun: {
          id: string;
          actor: string;
          status: string;
          taskId: string;
          leaseTtlSeconds: number;
        };
      }
    ).taskRun;

    const conflict = await app.inject({
      method: "POST",
      url: "/api/tasks/" + taskId + "/runs",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        actor: "Albert",
        leaseTtlSeconds: 45,
        note: "Retry after timeout."
      }
    });

    assert.equal(conflict.statusCode, 409);
    const conflictBody = conflict.json() as {
      code: string;
      error: string;
      statusCode: number;
      requestedActor: string;
      retryAfterSeconds: number;
      taskRun: {
        id: string;
        actor: string;
        status: string;
        taskId: string;
        leaseTtlSeconds: number;
      };
    };
    assert.equal(conflictBody.code, "task_run_conflict");
    assert.equal(conflictBody.requestedActor, "Albert");
    assert.ok(conflictBody.retryAfterSeconds >= 1);
    assert.equal(conflictBody.taskRun.id, claimedRun.id);
    assert.equal(conflictBody.taskRun.actor, "Aurel");
    assert.equal(conflictBody.taskRun.status, "active");
    assert.equal(conflictBody.taskRun.taskId, taskId);
    assert.equal(conflictBody.taskRun.leaseTtlSeconds, 60);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("task run validation failures return route-aware expected shape hints", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-task-run-validation-help-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard"
    });
    const taskId = (dashboard.json() as { tasks: Array<{ id: string }> })
      .tasks[0]!.id;

    const invalid = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${taskId}/runs`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        actor: "Aurel",
        timerMode: "unlimited",
        plannedDurationSeconds: 1200
      }
    });

    assert.equal(invalid.statusCode, 400);
    const invalidBody = invalid.json() as {
      code: string;
      error: string;
      route: string;
      validationSummary: string;
      details: Array<{ path: string; message: string }>;
      expectedShape: {
        toolName: string;
        inputShape: string;
        requiredFields: string[];
        example: string | null;
        notes: string[];
      };
    };
    assert.equal(invalidBody.code, "invalid_request");
    assert.equal(invalidBody.route, "/api/v1/tasks/:id/runs");
    assert.match(
      invalidBody.error,
      /Request validation failed for POST \/api\/v1\/tasks\/:id\/runs/
    );
    assert.match(invalidBody.validationSummary, /plannedDurationSeconds/);
    assert.ok(
      invalidBody.details.some(
        (detail) => detail.path === "plannedDurationSeconds"
      )
    );
    assert.equal(invalidBody.expectedShape.toolName, "forge_start_task_run");
    assert.match(invalidBody.expectedShape.inputShape, /taskId: string/);
    assert.ok(invalidBody.expectedShape.requiredFields.includes("taskId"));
    assert.ok(invalidBody.expectedShape.requiredFields.includes("actor"));
    assert.ok(
      invalidBody.expectedShape.notes.some((note) =>
        note.includes("plannedDurationSeconds must be null or omitted")
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("task timer starts respect the max active task setting", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-task-run-cap-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard"
    });
    const taskIds = (dashboard.json() as { tasks: Array<{ id: string }> }).tasks
      .slice(0, 3)
      .map((task) => task.id);
    assert.equal(taskIds.length, 3);

    for (const taskId of taskIds.slice(0, 2)) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/tasks/${taskId}/runs`,
        headers: {
          cookie: operatorCookie
        },
        payload: {
          actor: "Aurel",
          timerMode: "unlimited"
        }
      });
      assert.equal(response.statusCode, 201);
    }

    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${taskIds[2]}/runs`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        actor: "Aurel",
        timerMode: "unlimited"
      }
    });

    assert.equal(rejected.statusCode, 409);
    const rejectedBody = rejected.json() as {
      code: string;
      limit: number;
      activeRuns: Array<{ id: string; status: string }>;
    };
    assert.equal(rejectedBody.code, "task_run_limit_exceeded");
    assert.equal(rejectedBody.limit, 2);
    assert.equal(rejectedBody.activeRuns.length, 2);
    assert.ok(rejectedBody.activeRuns.every((run) => run.status === "active"));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("inactive task run mutations return the current run state", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-task-run-inactive-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard"
    });
    const taskId = (dashboard.json() as { tasks: Array<{ id: string }> })
      .tasks[1]!.id;

    const claimed = await app.inject({
      method: "POST",
      url: "/api/tasks/" + taskId + "/runs",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        actor: "Aurel",
        leaseTtlSeconds: 1,
        note: "Short lease for inactive-state test."
      }
    });
    assert.equal(claimed.statusCode, 201);
    const runId = (claimed.json() as { taskRun: { id: string } }).taskRun.id;

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const recover = await app.inject({
      method: "POST",
      url: "/api/task-runs/recover",
      payload: { limit: 10 }
    });
    assert.equal(recover.statusCode, 200);

    const heartbeat = await app.inject({
      method: "POST",
      url: "/api/task-runs/" + runId + "/heartbeat",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        actor: "Aurel",
        leaseTtlSeconds: 30,
        note: "Should fail because the run already timed out."
      }
    });

    assert.equal(heartbeat.statusCode, 409);
    const heartbeatBody = heartbeat.json() as {
      code: string;
      taskRun: { id: string; status: string; timedOutAt: string | null };
    };
    assert.equal(heartbeatBody.code, "task_run_not_active");
    assert.equal(heartbeatBody.taskRun.id, runId);
    assert.equal(heartbeatBody.taskRun.status, "timed_out");
    assert.ok(heartbeatBody.taskRun.timedOutAt);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("expired task runs recover cleanly after their lease lapses", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-task-run-timeout-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard"
    });
    const taskId = (dashboard.json() as { tasks: Array<{ id: string }> })
      .tasks[1]!.id;

    const claimed = await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/runs`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        actor: "Aurel",
        leaseTtlSeconds: 1,
        note: "Short lease for timeout test."
      }
    });

    assert.equal(claimed.statusCode, 201);
    const runId = (claimed.json() as { taskRun: { id: string } }).taskRun.id;

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const recovered = await app.inject({
      method: "POST",
      url: "/api/task-runs/recover",
      payload: {
        limit: 10
      }
    });

    assert.equal(recovered.statusCode, 200);
    const timedOutRuns = (
      recovered.json() as {
        timedOutRuns: Array<{
          id: string;
          status: string;
          timedOutAt: string | null;
        }>;
      }
    ).timedOutRuns;
    assert.equal(timedOutRuns.length, 1);
    assert.equal(timedOutRuns[0]!.id, runId);
    assert.equal(timedOutRuns[0]!.status, "timed_out");
    assert.ok(timedOutRuns[0]!.timedOutAt);

    const reclaimed = await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/runs`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        actor: "Albert",
        leaseTtlSeconds: 30,
        note: "Recovered after timeout."
      }
    });

    assert.equal(reclaimed.statusCode, 201);
    const activeRuns = await app.inject({
      method: "GET",
      url: "/api/task-runs?active=true"
    });
    const activePayload = activeRuns.json() as {
      taskRuns: Array<{ taskId: string; actor: string; status: string }>;
    };
    assert.ok(
      activePayload.taskRuns.some(
        (run) =>
          run.taskId === taskId &&
          run.actor === "Albert" &&
          run.status === "active"
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("watchdog reconcile endpoint lets operators force recovery and inspect status", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-watchdog-reconcile-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    taskRunWatchdog: {
      intervalMs: 60_000
    }
  });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard"
    });
    const taskId = (dashboard.json() as { tasks: Array<{ id: string }> })
      .tasks[0]!.id;

    const claimed = await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/runs`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        actor: "OpenClaw",
        leaseTtlSeconds: 1,
        note: "Manual recovery control should reclaim this stale lease."
      }
    });
    assert.equal(claimed.statusCode, 201);
    const runId = (claimed.json() as { taskRun: { id: string } }).taskRun.id;

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const reconcile = await app.inject({
      method: "POST",
      url: "/api/task-runs/watchdog/reconcile"
    });
    assert.equal(reconcile.statusCode, 200);

    const reconcileBody = reconcile.json() as {
      recovery: { recoveredCount: number; recoveredRunIds: string[] };
      watchdog: {
        totalRecoveredCount: number;
        lastRecovery: { recoveredRunIds: string[] } | null;
      };
    };
    assert.equal(reconcileBody.recovery.recoveredCount, 1);
    assert.deepEqual(reconcileBody.recovery.recoveredRunIds, [runId]);
    assert.equal(reconcileBody.watchdog.totalRecoveredCount, 1);
    assert.deepEqual(reconcileBody.watchdog.lastRecovery?.recoveredRunIds, [
      runId
    ]);

    const runs = await app.inject({
      method: "GET",
      url: `/api/task-runs?taskId=${taskId}`
    });
    assert.equal(runs.statusCode, 200);
    const recoveredRun = (
      runs.json() as {
        taskRuns: Array<{
          id: string;
          status: string;
          timedOutAt: string | null;
        }>;
      }
    ).taskRuns.find((entry) => entry.id === runId);
    assert.equal(recoveredRun?.status, "timed_out");
    assert.ok(recoveredRun?.timedOutAt);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("v1 health reports degraded status when watchdog recovery fails", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-watchdog-health-")
  );
  let calls = 0;
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    taskRunWatchdog: {
      intervalMs: 60_000,
      reconcile: ({ now }) => {
        calls += 1;
        if (calls === 1) {
          return {
            recoveredAt: now.toISOString(),
            recoveredCount: 0,
            recoveredRunIds: []
          } satisfies StartupTaskRunRecoverySummary;
        }
        throw new Error("simulated watchdog failure");
      }
    }
  });

  try {
    const before = await app.inject({ method: "GET", url: "/api/v1/health" });
    assert.equal(before.statusCode, 200);
    assert.equal((before.json() as { ok: boolean }).ok, true);

    const reconcile = await app.inject({
      method: "POST",
      url: "/api/task-runs/watchdog/reconcile"
    });
    assert.equal(reconcile.statusCode, 500);

    const after = await app.inject({ method: "GET", url: "/api/v1/health" });
    assert.equal(after.statusCode, 200);
    const payload = after.json() as {
      ok: boolean;
      watchdog: {
        enabled: boolean;
        healthy: boolean;
        state: string;
        reason: string | null;
        status: {
          consecutiveFailures: number;
          lastError: string | null;
        } | null;
      };
    };
    assert.equal(payload.ok, false);
    assert.equal(payload.watchdog.enabled, true);
    assert.equal(payload.watchdog.healthy, false);
    assert.equal(payload.watchdog.state, "degraded");
    assert.equal(payload.watchdog.reason, "simulated watchdog failure");
    assert.equal(payload.watchdog.status?.consecutiveFailures, 1);
    assert.equal(
      payload.watchdog.status?.lastError,
      "simulated watchdog failure"
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("notes list respects explicit userIds owner filtering", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-notes-user-scope-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const humanResponse = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers: { cookie: operatorCookie },
      payload: {
        contentMarkdown: "Human scoped note",
        author: "Albert",
        userId: "user_operator",
        links: [
          { entityType: "goal", entityId: "goal_health", anchorKey: null }
        ]
      }
    });
    assert.equal(humanResponse.statusCode, 201);

    const botResponse = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers: { cookie: operatorCookie },
      payload: {
        contentMarkdown: "Bot scoped note",
        author: "Forge Bot",
        userId: "user_forge_bot",
        links: [
          { entityType: "goal", entityId: "goal_health", anchorKey: null }
        ]
      }
    });
    assert.equal(botResponse.statusCode, 201);

    const filtered = await app.inject({
      method: "GET",
      url: "/api/v1/notes?userIds=user_forge_bot",
      headers: { cookie: operatorCookie }
    });
    assert.equal(filtered.statusCode, 200);
    const body = filtered.json() as {
      notes: Array<{ contentMarkdown: string; userId: string | null }>;
    };
    assert.equal(body.notes.length, 1);
    assert.equal(body.notes[0]?.contentMarkdown, "Bot scoped note");
    assert.equal(body.notes[0]?.userId, "user_forge_bot");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("self observation calendar returns observed notes with linked psyche context", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-self-observation-calendar-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const patternResponse = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/patterns",
      headers: { cookie: operatorCookie },
      payload: {
        title: "Withdrawal loop",
        description: "Pulling back under perceived pressure.",
        targetBehavior: "Withdraw",
        cueContexts: ["silence"],
        shortTermPayoff: "Protection",
        longTermCost: "Distance",
        preferredResponse: "Stay and name the fear",
        linkedValueIds: [],
        linkedSchemaLabels: [],
        linkedModeIds: [],
        linkedBeliefIds: [],
        userId: "user_operator"
      }
    });
    assert.equal(patternResponse.statusCode, 201);
    const patternId = (patternResponse.json() as { pattern: { id: string } })
      .pattern.id;

    const reportResponse = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/reports",
      headers: { cookie: operatorCookie },
      payload: {
        title: "Meeting spiral",
        status: "draft",
        eventSituation: "Silence after vulnerability triggered a retreat.",
        occurredAt: "2026-04-06T09:10:00.000Z",
        emotions: [],
        thoughts: [],
        behaviors: [],
        consequences: {
          selfShortTerm: [],
          selfLongTerm: [],
          othersShortTerm: [],
          othersLongTerm: []
        },
        linkedPatternIds: [],
        linkedValueIds: [],
        linkedGoalIds: [],
        linkedProjectIds: [],
        linkedTaskIds: [],
        linkedBehaviorIds: [],
        linkedBeliefIds: [],
        linkedModeIds: [],
        modeOverlays: [],
        schemaLinks: [],
        nextMoves: [],
        userId: "user_operator"
      }
    });
    assert.equal(reportResponse.statusCode, 201);
    const reportId = (reportResponse.json() as { report: { id: string } })
      .report.id;

    const noteResponse = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      headers: { cookie: operatorCookie },
      payload: {
        contentMarkdown: "Noticed the retreat impulse immediately.",
        author: "Albert",
        userId: "user_operator",
        tags: ["focus"],
        frontmatter: {
          observedAt: "2026-04-06T09:15:00.000Z"
        },
        links: [
          {
            entityType: "behavior_pattern",
            entityId: patternId,
            anchorKey: null
          },
          { entityType: "trigger_report", entityId: reportId, anchorKey: null }
        ]
      }
    });
    assert.equal(noteResponse.statusCode, 201);

    const habitId = createHabit({
      title: "Doomscrolling",
      description: "Do not sink into reactive scrolling.",
      status: "active",
      polarity: "negative",
      frequency: "daily",
      targetCount: 1,
      weekDays: [],
      linkedGoalIds: [],
      linkedProjectIds: [],
      linkedTaskIds: [],
      linkedValueIds: [],
      linkedPatternIds: [],
      linkedBehaviorIds: [],
      linkedBeliefIds: [],
      linkedModeIds: [],
      linkedReportIds: [],
      linkedBehaviorId: null,
      rewardXp: 12,
      penaltyXp: 8,
      userId: "user_operator",
      generatedHealthEventTemplate: {
        enabled: false,
        workoutType: "walk",
        title: "",
        durationMinutes: 30,
        xpReward: 0,
        tags: [],
        links: [],
        notesTemplate: ""
      }
    }).id;

    recordActivityEvent(
      {
        entityType: "habit",
        entityId: habitId,
        eventType: "habit_check_in_created",
        title: "Resisted Doomscrolling",
        description: "Resisted the pull and stayed present.",
        actor: "operator",
        source: "ui"
      },
      new Date("2026-04-06T09:20:00.000Z")
    );

    const calendarResponse = await app.inject({
      method: "GET",
      url:
        "/api/v1/psyche/self-observation/calendar" +
        "?from=2026-04-06T00:00:00.000Z&to=2026-04-07T00:00:00.000Z&userIds=user_operator",
      headers: { cookie: operatorCookie }
    });
    assert.equal(calendarResponse.statusCode, 200);
    const body = calendarResponse.json() as {
      calendar: {
        observations: Array<{
          observedAt: string;
          tags: string[];
          note: { contentMarkdown: string; userId: string | null };
          linkedPatterns: Array<{ id: string }>;
          linkedReports: Array<{ id: string }>;
        }>;
        activity: Array<{
          observedAt: string;
          tags: string[];
          event: { title: string; entityType: string };
        }>;
        availableTags: string[];
      };
    };
    assert.equal(body.calendar.observations.length, 1);
    assert.equal(body.calendar.activity.length, 1);
    assert.equal(
      body.calendar.observations[0]?.note.contentMarkdown,
      "Noticed the retreat impulse immediately."
    );
    assert.equal(
      body.calendar.observations[0]?.observedAt,
      "2026-04-06T09:15:00.000Z"
    );
    assert.equal(
      body.calendar.observations[0]?.linkedPatterns[0]?.id,
      patternId
    );
    assert.equal(body.calendar.observations[0]?.linkedReports[0]?.id, reportId);
    assert.equal(
      body.calendar.activity[0]?.event.title,
      "Resisted Doomscrolling"
    );
    assert.equal(body.calendar.activity[0]?.event.entityType, "habit");
    assert.ok(body.calendar.activity[0]?.tags.includes("Forge activity"));
    assert.ok(body.calendar.observations[0]?.tags.includes("Self-observation"));
    assert.deepEqual(body.calendar.availableTags, [
      "Entity · Habit",
      "focus",
      "Forge activity",
      "Self-observation",
      "Source · UI"
    ]);

    const exportResponse = await app.inject({
      method: "GET",
      url:
        "/api/v1/psyche/self-observation/calendar/export" +
        "?from=2026-04-06T00:00:00.000Z&to=2026-04-07T00:00:00.000Z&userIds=user_operator&tags=Forge%20activity&format=markdown",
      headers: { cookie: operatorCookie }
    });
    assert.equal(exportResponse.statusCode, 200);
    assert.match(
      exportResponse.headers["content-type"] ?? "",
      /text\/markdown/
    );
    assert.match(exportResponse.body, /Forge activity/);
    assert.match(exportResponse.body, /Resisted Doomscrolling/);
    assert.doesNotMatch(
      exportResponse.body,
      /Noticed the retreat impulse immediately\./
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
