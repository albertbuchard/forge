import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { listActivityEvents } from "./repositories/activity-events.js";
import { createGoal } from "./repositories/goals.js";
import { createProject } from "./repositories/projects.js";
import { listRewardLedger } from "./repositories/rewards.js";
import { createAgentToken } from "./repositories/settings.js";
import { createTag } from "./repositories/tags.js";
import { createTask } from "./repositories/tasks.js";
import { createUser } from "./repositories/users.js";
import { listWorkAdjustmentsForEntity } from "./repositories/work-adjustments.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import { createAgentTokenSchema } from "./types.js";

type AdjustmentResponse = {
  adjustment: {
    id: string;
    entityType: "task" | "project";
    entityId: string;
    requestedDeltaMinutes: number;
    appliedDeltaMinutes: number;
    actor: string | null;
    source: string;
  };
  target: {
    entityType: "task" | "project";
    entityId: string;
    time: {
      totalCreditedSeconds: number;
      manualAdjustedSeconds: number;
    };
  };
  reward: {
    id: string;
    actor: string | null;
    source: string;
    deltaXp: number;
  } | null;
  metrics: { profile: { totalXp: number } };
};

function createPlanningFixture(label: string) {
  const user = createUser({
    kind: "human",
    handle: `plan09-${label}`,
    displayName: `PLAN-09 ${label}`,
    description: "",
    accentColor: "#336699"
  });
  const goal = createGoal({
    title: `PLAN-09 ${label} goal`,
    description: "",
    horizon: "year",
    status: "active",
    targetPoints: 100,
    themeColor: "#336699",
    tagIds: [],
    notes: [],
    userId: user.id
  });
  const project = createProject({
    goalId: goal.id,
    title: `PLAN-09 ${label} project`,
    userId: user.id
  });
  const tag = createTag({
    name: `plan09-${label}`,
    kind: "execution",
    color: "#336699",
    description: "",
    userId: user.id
  });
  const task = createTask({
    title: `PLAN-09 ${label} task`,
    userId: user.id,
    owner: user.displayName,
    goalId: goal.id,
    projectId: project.id,
    tagIds: [tag.id]
  });
  return { user, goal, project, tag, task };
}

function issueScopedAdjustmentToken(input: {
  label: string;
  userIds: string[];
  projectIds?: string[];
  tagIds?: string[];
}) {
  return createAgentToken(
    createAgentTokenSchema.parse({
      label: `PLAN-09 ${input.label}`,
      agentLabel: `PLAN-09 ${input.label}`,
      scopes: ["read", "write", "rewards.manage"],
      scopePolicy: {
        userIds: input.userIds,
        projectIds: input.projectIds ?? [],
        tagIds: input.tagIds ?? []
      }
    }),
    { actor: "PLAN-09 test", source: "system" }
  ).token;
}

test("signed work adjustments keep attribution and task, project, and XP aggregates aligned", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-work-adjustment-readiness-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: true,
    devrageMetricSync: false
  });

  try {
    const operatorCookie = issueTestOperatorSessionCookie(app);
    const contextResponse = await app.inject({
      method: "GET",
      url: "/api/v1/context",
      headers: { cookie: operatorCookie }
    });
    assert.equal(contextResponse.statusCode, 200);
    const context = contextResponse.json() as {
      tasks: Array<{
        id: string;
        projectId: string | null;
        time: {
          totalCreditedSeconds: number;
          manualAdjustedSeconds: number;
        };
      }>;
      metrics: { totalXp: number };
    };
    const task = context.tasks.find((candidate) => candidate.projectId);
    assert.ok(task?.projectId);
    const initialTaskSeconds = task.time.totalCreditedSeconds;
    const initialTaskAdjustmentSeconds = task.time.manualAdjustedSeconds;
    const initialXp = context.metrics.totalXp;
    const initialBoardResponse = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${task.projectId}/board`,
      headers: { cookie: operatorCookie }
    });
    assert.equal(initialBoardResponse.statusCode, 200);
    const initialBoard = initialBoardResponse.json() as {
      project: {
        time: {
          totalCreditedSeconds: number;
          manualAdjustedSeconds: number;
        };
      };
    };
    const initialProjectSeconds =
      initialBoard.project.time.totalCreditedSeconds;
    const initialProjectAdjustmentSeconds =
      initialBoard.project.time.manualAdjustedSeconds;

    async function adjust(
      entityType: "task" | "project",
      entityId: string,
      deltaMinutes: number,
      note: string,
      idempotencyKey?: string
    ) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/work-adjustments",
        headers: {
          cookie: operatorCookie,
          ...(idempotencyKey
            ? { "idempotency-key": idempotencyKey }
            : {})
        },
        payload: { entityType, entityId, deltaMinutes, note }
      });
      assert.equal(response.statusCode, 201, response.body);
      return response.json() as AdjustmentResponse;
    }

    const taskAdd = await adjust(
      "task",
      task.id,
      25,
      "Captured off-timer implementation work."
    );
    assert.equal(taskAdd.adjustment.requestedDeltaMinutes, 25);
    assert.equal(taskAdd.adjustment.appliedDeltaMinutes, 25);
    assert.equal(taskAdd.adjustment.source, "ui");
    assert.ok(taskAdd.adjustment.actor);
    assert.equal(taskAdd.reward?.actor, taskAdd.adjustment.actor);
    assert.equal(taskAdd.reward?.source, taskAdd.adjustment.source);
    assert.equal(taskAdd.reward?.deltaXp, 8);
    assert.equal(
      taskAdd.target.time.totalCreditedSeconds,
      initialTaskSeconds + 25 * 60
    );
    assert.equal(
      taskAdd.target.time.manualAdjustedSeconds,
      initialTaskAdjustmentSeconds + 25 * 60
    );
    assert.equal(taskAdd.metrics.profile.totalXp, initialXp + 8);

    const projectAdd = await adjust(
      "project",
      task.projectId,
      15,
      "Captured project planning outside a live run."
    );
    assert.equal(projectAdd.adjustment.requestedDeltaMinutes, 15);
    assert.equal(projectAdd.adjustment.appliedDeltaMinutes, 15);
    assert.equal(projectAdd.adjustment.actor, taskAdd.adjustment.actor);
    assert.equal(projectAdd.adjustment.source, "ui");
    assert.equal(projectAdd.reward?.actor, projectAdd.adjustment.actor);
    assert.equal(projectAdd.reward?.source, projectAdd.adjustment.source);
    assert.equal(projectAdd.reward?.deltaXp, 8);
    assert.equal(
      projectAdd.target.time.totalCreditedSeconds,
      initialProjectSeconds + 40 * 60
    );
    assert.equal(
      projectAdd.target.time.manualAdjustedSeconds,
      initialProjectAdjustmentSeconds + 40 * 60
    );
    assert.equal(projectAdd.metrics.profile.totalXp, initialXp + 16);

    const taskRemove = await adjust(
      "task",
      task.id,
      -10,
      "Removed an overcounted ten-minute block.",
      "task-correction-retry-1"
    );
    assert.equal(taskRemove.adjustment.requestedDeltaMinutes, -10);
    assert.equal(taskRemove.adjustment.appliedDeltaMinutes, -10);
    assert.equal(taskRemove.adjustment.actor, taskAdd.adjustment.actor);
    assert.equal(taskRemove.adjustment.source, "ui");
    assert.equal(taskRemove.reward?.actor, taskRemove.adjustment.actor);
    assert.equal(taskRemove.reward?.source, taskRemove.adjustment.source);
    assert.equal(taskRemove.reward?.deltaXp, -4);
    assert.equal(
      taskRemove.target.time.totalCreditedSeconds,
      initialTaskSeconds + 15 * 60
    );
    assert.equal(
      taskRemove.target.time.manualAdjustedSeconds,
      initialTaskAdjustmentSeconds + 15 * 60
    );
    assert.equal(taskRemove.metrics.profile.totalXp, initialXp + 12);

    const taskAdjustments = listWorkAdjustmentsForEntity("task", task.id);
    const taskAdjustmentsById = new Map(
      taskAdjustments.map((adjustment) => [adjustment.id, adjustment])
    );
    const persistedTaskAdd = taskAdjustmentsById.get(taskAdd.adjustment.id);
    assert.ok(persistedTaskAdd);
    assert.equal(persistedTaskAdd.requestedDeltaMinutes, 25);
    assert.equal(persistedTaskAdd.appliedDeltaMinutes, 25);
    assert.equal(
      persistedTaskAdd.note,
      "Captured off-timer implementation work."
    );
    assert.equal(persistedTaskAdd.actor, taskAdd.adjustment.actor);
    assert.equal(persistedTaskAdd.source, "ui");
    const persistedTaskRemove = taskAdjustmentsById.get(
      taskRemove.adjustment.id
    );
    assert.ok(persistedTaskRemove);
    assert.equal(persistedTaskRemove.requestedDeltaMinutes, -10);
    assert.equal(persistedTaskRemove.appliedDeltaMinutes, -10);
    assert.equal(
      persistedTaskRemove.note,
      "Removed an overcounted ten-minute block."
    );
    assert.equal(persistedTaskRemove.actor, taskAdd.adjustment.actor);
    assert.equal(persistedTaskRemove.source, "ui");

    const projectAdjustments = listWorkAdjustmentsForEntity(
      "project",
      task.projectId
    );
    const persistedProjectAdd = projectAdjustments.find(
      (adjustment) => adjustment.id === projectAdd.adjustment.id
    );
    assert.ok(persistedProjectAdd);
    assert.equal(persistedProjectAdd.requestedDeltaMinutes, 15);
    assert.equal(persistedProjectAdd.appliedDeltaMinutes, 15);
    assert.equal(
      persistedProjectAdd.note,
      "Captured project planning outside a live run."
    );
    assert.equal(persistedProjectAdd.actor, taskAdd.adjustment.actor);
    assert.equal(persistedProjectAdd.source, "ui");

    for (const adjustmentResult of [taskAdd, projectAdd, taskRemove]) {
      assert.ok(adjustmentResult.reward);
      const persistedReward = listRewardLedger({
        entityType: adjustmentResult.adjustment.entityType,
        entityId: adjustmentResult.adjustment.entityId,
        limit: 20
      }).find((reward) => reward.id === adjustmentResult.reward?.id);
      assert.ok(persistedReward);
      assert.equal(persistedReward.actor, adjustmentResult.adjustment.actor);
      assert.equal(persistedReward.source, adjustmentResult.adjustment.source);
      assert.equal(
        persistedReward.metadata.adjustmentId,
        adjustmentResult.adjustment.id
      );
      assert.equal(
        persistedReward.metadata.appliedDeltaMinutes,
        adjustmentResult.adjustment.appliedDeltaMinutes
      );
    }

    const adjustmentEvents = listActivityEvents({
      entityType: "task",
      entityId: task.id,
      includeCorrected: true,
      limit: 20
    }).filter((event) => event.eventType === "work_adjusted");
    const adjustmentEventsById = new Map(
      adjustmentEvents.map((event) => [
        event.metadata.adjustmentId,
        event
      ])
    );
    for (const [adjustmentResult, appliedDeltaMinutes, note] of [
      [taskAdd, 25, "Captured off-timer implementation work."],
      [taskRemove, -10, "Removed an overcounted ten-minute block."]
    ] as const) {
      const adjustment = adjustmentResult.adjustment;
      const event = adjustmentEventsById.get(adjustment.id);
      assert.ok(event);
      assert.equal(event.metadata.appliedDeltaMinutes, appliedDeltaMinutes);
      assert.equal(
        event.metadata.requestedDeltaMinutes,
        adjustment.requestedDeltaMinutes
      );
      assert.equal(event.metadata.rewardId, adjustmentResult.reward?.id);
      assert.equal(
        event.metadata.rewardDeltaXp,
        adjustmentResult.reward?.deltaXp
      );
      assert.equal(event.metadata.note, note);
      assert.equal(event.actor, taskAdd.adjustment.actor);
      assert.equal(event.source, "ui");
    }

    const projectAdjustmentEvent = listActivityEvents({
      entityType: "project",
      entityId: task.projectId,
      includeCorrected: true,
      limit: 20
    }).find(
      (event) =>
        event.eventType === "work_adjusted" &&
        event.metadata.adjustmentId === projectAdd.adjustment.id
    );
    assert.ok(projectAdjustmentEvent);
    assert.equal(projectAdjustmentEvent.metadata.requestedDeltaMinutes, 15);
    assert.equal(projectAdjustmentEvent.metadata.appliedDeltaMinutes, 15);
    assert.equal(projectAdjustmentEvent.metadata.rewardId, projectAdd.reward?.id);
    assert.equal(
      projectAdjustmentEvent.metadata.rewardDeltaXp,
      projectAdd.reward?.deltaXp
    );
    assert.equal(
      projectAdjustmentEvent.metadata.note,
      "Captured project planning outside a live run."
    );
    assert.equal(projectAdjustmentEvent.actor, projectAdd.adjustment.actor);
    assert.equal(projectAdjustmentEvent.source, "ui");

    const boardResponse = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${task.projectId}/board`,
      headers: { cookie: operatorCookie }
    });
    assert.equal(boardResponse.statusCode, 200);
    const board = boardResponse.json() as {
      project: {
        time: {
          totalCreditedSeconds: number;
          manualAdjustedSeconds: number;
        };
      };
    };
    assert.equal(
      board.project.time.totalCreditedSeconds,
      initialProjectSeconds + 30 * 60
    );
    assert.equal(
      board.project.time.manualAdjustedSeconds,
      initialProjectAdjustmentSeconds + 30 * 60
    );

    const replayResponse = await app.inject({
      method: "POST",
      url: "/api/v1/work-adjustments",
      headers: {
        cookie: operatorCookie,
        "idempotency-key": "task-correction-retry-1"
      },
      payload: {
        entityType: "task",
        entityId: task.id,
        deltaMinutes: -10,
        note: "Removed an overcounted ten-minute block."
      }
    });
    assert.equal(replayResponse.statusCode, 200, replayResponse.body);
    assert.equal(replayResponse.headers["idempotency-replayed"], "true");
    assert.deepEqual(replayResponse.json(), taskRemove);

    const conflictingRetry = await app.inject({
      method: "POST",
      url: "/api/v1/work-adjustments",
      headers: {
        cookie: operatorCookie,
        "idempotency-key": "task-correction-retry-1"
      },
      payload: {
        entityType: "task",
        entityId: task.id,
        deltaMinutes: -9,
        note: "Removed an overcounted ten-minute block."
      }
    });
    assert.equal(conflictingRetry.statusCode, 409);
    assert.equal(
      (conflictingRetry.json() as { code: string }).code,
      "work_adjustment_idempotency_conflict"
    );

    assert.equal(listWorkAdjustmentsForEntity("task", task.id).length, 2);
    assert.equal(
      listWorkAdjustmentsForEntity("project", task.projectId).length,
      1
    );
    const knownAdjustmentIds = new Set([
      taskAdd.adjustment.id,
      projectAdd.adjustment.id,
      taskRemove.adjustment.id
    ]);
    assert.equal(
      listRewardLedger({ limit: 200 }).filter((reward) =>
        knownAdjustmentIds.has(String(reward.metadata.adjustmentId))
      ).length,
      3
    );
    assert.equal(
      listActivityEvents({ includeCorrected: true, limit: 200 }).filter(
        (event) =>
          event.eventType === "work_adjusted" &&
          knownAdjustmentIds.has(String(event.metadata.adjustmentId))
      ).length,
      3
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("scoped adjustment tokens cannot write or replay outside their user, project, and tag scope", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-work-adjustment-scope-")
  );
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: false,
    devrageMetricSync: false
  });

  try {
    const operatorCookie = issueTestOperatorSessionCookie(app);
    const allowed = createPlanningFixture("allowed");
    const foreign = createPlanningFixture("foreign");
    const otherProject = createProject({
      goalId: allowed.goal.id,
      title: "PLAN-09 other project",
      userId: allowed.user.id
    });
    const otherTag = createTag({
      name: "plan09-other-tag",
      kind: "execution",
      color: "#884466",
      description: "",
      userId: allowed.user.id
    });
    const wrongProjectTask = createTask({
      title: "PLAN-09 wrong project task",
      userId: allowed.user.id,
      owner: allowed.user.displayName,
      goalId: allowed.goal.id,
      projectId: otherProject.id,
      tagIds: [allowed.tag.id]
    });
    const wrongTagTask = createTask({
      title: "PLAN-09 wrong tag task",
      userId: allowed.user.id,
      owner: allowed.user.displayName,
      goalId: allowed.goal.id,
      projectId: allowed.project.id,
      tagIds: [otherTag.id]
    });
    const restrictedAllowedTask = createTask({
      title: "PLAN-09 fully scoped task",
      userId: allowed.user.id,
      owner: allowed.user.displayName,
      goalId: allowed.goal.id,
      projectId: allowed.project.id,
      tagIds: [allowed.tag.id]
    });

    const foreignAdjustment = await app.inject({
      method: "POST",
      url: "/api/v1/work-adjustments",
      headers: { cookie: operatorCookie },
      payload: {
        entityType: "task",
        entityId: foreign.task.id,
        deltaMinutes: 10,
        note: "Foreign-owner reward must stay outside scoped metrics."
      }
    });
    assert.equal(foreignAdjustment.statusCode, 201, foreignAdjustment.body);

    const userToken = issueScopedAdjustmentToken({
      label: "user scope",
      userIds: [allowed.user.id]
    });
    const userHeaders = {
      authorization: `Bearer ${userToken}`,
      "x-forge-source": "agent",
      "x-forge-actor": "PLAN-09 user-scoped agent"
    };
    const baselineMetricsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/metrics/xp",
      headers: userHeaders
    });
    assert.equal(baselineMetricsResponse.statusCode, 200);
    const baselineTotalXp = (
      baselineMetricsResponse.json() as {
        metrics: { profile: { totalXp: number } };
      }
    ).metrics.profile.totalXp;

    const scopedAdjustmentPayload = {
      entityType: "task" as const,
      entityId: allowed.task.id,
      deltaMinutes: 10,
      note: "Allowed user-scoped correction."
    };
    const scopedAdjustment = await app.inject({
      method: "POST",
      url: "/api/v1/work-adjustments",
      headers: {
        ...userHeaders,
        "idempotency-key": "plan09-user-scope-retry"
      },
      payload: scopedAdjustmentPayload
    });
    assert.equal(scopedAdjustment.statusCode, 201, scopedAdjustment.body);
    const scopedBody = scopedAdjustment.json() as AdjustmentResponse & {
      metrics: {
        profile: { totalXp: number };
        recentLedger: Array<{ entityId: string }>;
      };
    };
    assert.equal(
      scopedBody.metrics.profile.totalXp,
      baselineTotalXp + (scopedBody.reward?.deltaXp ?? 0)
    );
    assert.equal(
      scopedBody.metrics.recentLedger.some(
        (reward) => reward.entityId === foreign.task.id
      ),
      false
    );

    const scopedReplay = await app.inject({
      method: "POST",
      url: "/api/v1/work-adjustments",
      headers: {
        ...userHeaders,
        "idempotency-key": "plan09-user-scope-retry"
      },
      payload: scopedAdjustmentPayload
    });
    assert.equal(scopedReplay.statusCode, 200, scopedReplay.body);
    assert.equal(scopedReplay.headers["idempotency-replayed"], "true");
    assert.deepEqual(scopedReplay.json(), scopedBody);
    assert.equal(
      listWorkAdjustmentsForEntity("task", allowed.task.id).length,
      1
    );

    const foreignCountBefore = listWorkAdjustmentsForEntity(
      "task",
      foreign.task.id
    ).length;
    const deniedForeign = await app.inject({
      method: "POST",
      url: "/api/v1/work-adjustments",
      headers: {
        ...userHeaders,
        "idempotency-key": "plan09-denied-foreign"
      },
      payload: {
        entityType: "task",
        entityId: foreign.task.id,
        deltaMinutes: 10
      }
    });
    assert.equal(deniedForeign.statusCode, 404, deniedForeign.body);
    assert.equal(
      listWorkAdjustmentsForEntity("task", foreign.task.id).length,
      foreignCountBefore
    );

    const planningToken = issueScopedAdjustmentToken({
      label: "planning scope",
      userIds: [allowed.user.id],
      projectIds: [allowed.project.id],
      tagIds: [allowed.tag.id]
    });
    const planningHeaders = {
      authorization: `Bearer ${planningToken}`,
      "x-forge-source": "agent",
      "x-forge-actor": "PLAN-09 planning-scoped agent"
    };
    for (const [entityType, entityId] of [
      ["task", wrongProjectTask.id],
      ["task", wrongTagTask.id],
      ["project", otherProject.id]
    ] as const) {
      const denied = await app.inject({
        method: "POST",
        url: "/api/v1/work-adjustments",
        headers: planningHeaders,
        payload: { entityType, entityId, deltaMinutes: 10 }
      });
      assert.equal(denied.statusCode, 404, denied.body);
      assert.equal(
        listWorkAdjustmentsForEntity(entityType, entityId).length,
        0
      );
    }

    const planningAdjustment = await app.inject({
      method: "POST",
      url: "/api/v1/work-adjustments",
      headers: {
        ...planningHeaders,
        "idempotency-key": "plan09-planning-scope-retry"
      },
      payload: {
        entityType: "task",
        entityId: restrictedAllowedTask.id,
        deltaMinutes: 10,
        note: "Allowed project-and-tag scoped correction."
      }
    });
    assert.equal(planningAdjustment.statusCode, 201, planningAdjustment.body);
    const planningBody = planningAdjustment.json() as AdjustmentResponse & {
      metrics: {
        profile: { totalXp: number };
        recentLedger: Array<unknown>;
      };
    };
    assert.equal(planningBody.metrics.profile.totalXp, 0);
    assert.deepEqual(planningBody.metrics.recentLedger, []);

    const planningReplay = await app.inject({
      method: "POST",
      url: "/api/v1/work-adjustments",
      headers: {
        ...planningHeaders,
        "idempotency-key": "plan09-planning-scope-retry"
      },
      payload: {
        entityType: "task",
        entityId: restrictedAllowedTask.id,
        deltaMinutes: 10,
        note: "Allowed project-and-tag scoped correction."
      }
    });
    assert.equal(planningReplay.statusCode, 200, planningReplay.body);
    assert.deepEqual(planningReplay.json(), planningBody);
    assert.equal(
      listWorkAdjustmentsForEntity("task", restrictedAllowedTask.id).length,
      1
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
