import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { createCalendarEvent } from "./repositories/calendar.js";
import { upsertDeletedEntityRecord } from "./repositories/deleted-entities.js";
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
          snapshot: { goals: Array<{ id: string }> };
          operator: { focusTasks: Array<unknown> };
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
          locationReady: false
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
        ]
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
          };
          permissions: {
            healthKitAuthorized: boolean;
            backgroundRefreshEnabled: boolean;
          };
        };
      }
    ).overview;
    assert.equal(overview.healthState, "healthy_sync");
    assert.equal(overview.counts.reflectiveSleepSessions, 1);
    assert.equal(overview.counts.reconciledWorkouts, 1);
    assert.equal(overview.permissions.healthKitAuthorized, true);
    assert.equal(overview.permissions.backgroundRefreshEnabled, true);

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

test("calendar connection metadata exposes Exchange Online as read only", async () => {
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
    assert.deepEqual(
      body.providers.map((provider) => provider.provider),
      ["google", "apple", "microsoft", "caldav"]
    );
  } finally {
    await app.close();
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
    assert.ok(body.paths?.["/api/v1/notes"]);
    assert.ok(body.paths?.["/api/v1/notes/{id}"]);
    assert.ok(body.paths?.["/api/v1/health/sleep"]);
    assert.ok(body.paths?.["/api/v1/health/sleep/{id}"]);
    assert.ok(body.paths?.["/api/v1/health/fitness"]);
    assert.ok(body.paths?.["/api/v1/health/workouts/{id}"]);
    assert.ok(body.paths?.["/api/v1/habits"]);
    assert.ok(body.paths?.["/api/v1/habits/{id}"]);
    assert.ok(body.paths?.["/api/v1/habits/{id}/check-ins"]);
    assert.ok(body.paths?.["/api/v1/habits/{id}/check-ins/{dateKey}"]);
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
        status: "done"
      }
    });
    assert.equal(checkIn.statusCode, 200);
    const checkInBody = checkIn.json() as {
      habit: {
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

test("wiki pages are file-backed, searchable, backlink-aware, and ingestable", async () => {
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
        links: [],
        tags: []
      }
    });
    assert.equal(evidenceNote.statusCode, 201);

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
    const homeBody = home.json() as { page: { slug: string; title: string } };
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
    assert.ok(releaseBody.page.sourcePath.endsWith("release-playbook.md"));
    const releaseFile = await readFile(releaseBody.page.sourcePath, "utf8");
    assert.match(releaseFile, /title:\s+"Release playbook"/);
    assert.match(releaseFile, /slug:\s+"release-playbook"/);

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
        job: { status: string; pageNoteId: string | null };
        candidates: Array<{ id: string; candidateType: string }>;
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
        job: {
          job: { status: string; pageNoteId: string | null };
          candidates: Array<{ id: string; candidateType: string }>;
        };
      };
      if (pollBody.job.job.status === "completed") {
        const review = await app.inject({
          method: "POST",
          url: `/api/v1/wiki/ingest-jobs/${ingestBody.job?.job.id}/review`,
          headers: {
            cookie: operatorCookie
          },
          payload: {
            decisions: pollBody.job.candidates.map((candidate) => ({
              candidateId: candidate.id,
              keep: candidate.candidateType === "page"
            }))
          }
        });
        assert.equal(review.statusCode, 200);
        reviewedJob = review.json() as {
          job: {
            job: { status: string; pageNoteId: string | null };
            candidates: Array<{ id: string; candidateType: string }>;
          };
        };
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    assert.ok(reviewedJob);
    assert.equal(reviewedJob.job.job.status, "reviewed");
    assert.ok(reviewedJob.job.job.pageNoteId);

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
    assert.match(healthBody.health.indexPath, /index\.md$/);
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
    assert.equal(createBody.results[1]?.error?.code, "create_failed");

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
      details: Array<{ path: string; message: string }>;
    };
    assert.equal(invalidBody.code, "invalid_request");
    assert.ok(invalidBody.details.some((detail) => detail.path === "searches"));
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
    "project",
    "psyche_value",
    "strategy",
    "tag",
    "task",
    "task_timebox",
    "trigger_report",
    "work_block_template"
  ]);
  assert.ok(matrix.every((entry) => entry.pluginExposed === true));
  const immediateDeleteTypes = matrix
    .filter((entry) => entry.deleteMode === "immediate")
    .map((entry) => entry.entityType)
    .sort();
  assert.deepEqual(immediateDeleteTypes, [
    "calendar_event",
    "task_timebox",
    "work_block_template"
  ]);
  const binTypes = matrix
    .filter((entry) => entry.inBin)
    .map((entry) => entry.entityType);
  assert.ok(!binTypes.includes("calendar_event"));
  assert.ok(!binTypes.includes("work_block_template"));
  assert.ok(!binTypes.includes("task_timebox"));
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
        scopes: ["read", "write"]
      }
    });
    assert.equal(createdToken.statusCode, 201);
    const createdTokenBody = createdToken.json() as {
      token: {
        token: string;
        tokenSummary: { id: string; status: string };
      };
    };
    assert.ok(createdTokenBody.token.token.startsWith("fg_live_"));
    assert.equal(createdTokenBody.token.tokenSummary.status, "active");

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
        authModes: { operatorSession: { tokenRequired: boolean } };
        tokenRecovery: {
          rawTokenStoredByForge: boolean;
          recoveryAction: string;
        };
        conceptModel: {
          goal: string;
          taskRun: string;
          note: string;
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
          minimumCreateFields: string[];
          relationshipRules: string[];
          fieldGuide: Array<{ name: string; required: boolean }>;
        }>;
        toolInputCatalog: Array<{
          toolName: string;
          requiredFields: string[];
          inputShape: string;
        }>;
        verificationPaths: {
          settingsBin: string;
          batchSearch: string;
          psycheSchemaCatalog: string;
          psycheEventTypes: string;
          psycheEmotions: string;
        };
        recommendedPluginTools: {
          bootstrap: string[];
          readModels: string[];
          uiWorkflow: string[];
          entityWorkflow: string[];
          calendarWorkflow: string[];
          workWorkflow: string[];
          insightWorkflow: string[];
        };
        interactionGuidance: {
          saveSuggestionPlacement: string;
          maxQuestionsPerTurn: number;
          psycheExplorationRule: string;
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
    const goalConversationPlaybook =
      onboardingBody.onboarding.entityConversationPlaybooks.find(
        (playbook) => playbook.focus === "goal"
      );
    assert.ok(goalConversationPlaybook);
    assert.match(
      goalConversationPlaybook.openingQuestion,
      /direction are you trying to hold onto/i
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
    assert.ok(
      noteConversationPlaybook.askSequence.some((step) =>
        /durable or temporary/i.test(step)
      )
    );
    const insightConversationPlaybook =
      onboardingBody.onboarding.entityConversationPlaybooks.find(
        (playbook) => playbook.focus === "insight"
      );
    assert.ok(insightConversationPlaybook);
    assert.match(
      insightConversationPlaybook.openingQuestion,
      /observation or recommendation/i
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
    const calendarEventEntity = onboardingBody.onboarding.entityCatalog.find(
      (entity) => entity.entityType === "calendar_event"
    );
    assert.ok(calendarEventEntity);
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
