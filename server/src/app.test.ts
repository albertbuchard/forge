import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { getCrudEntityCapabilityMatrix } from "./services/entity-crud.js";
import type { StartupTaskRunRecoverySummary } from "./services/run-recovery.js";

async function issueOperatorSessionCookie(app: Awaited<ReturnType<typeof buildServer>>) {
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
  const app = await buildServer({ dataRoot: rootDir });

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
    assert.ok(body.executionBuckets.some((bucket) => bucket.id === "focus_now"));
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
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
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
    const createdTask = (created.json() as { task: { id: string; status: string } }).task;
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
    const movedTask = (moved.json() as { task: { status: string; completedAt: string | null } }).task;
    assert.equal(movedTask.status, "done");
    assert.ok(movedTask.completedAt);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("goal detail, operator context, and retroactive work logging are available on the versioned API", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-operator-context-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const goalsResponse = await app.inject({ method: "GET", url: "/api/v1/goals" });
    const goals = (goalsResponse.json() as { goals: Array<{ id: string }> }).goals;
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
    const context = (operatorContext.json() as {
      context: {
        activeProjects: Array<{ id: string }>;
        currentBoard: { backlog: Array<unknown>; focus: Array<unknown>; inProgress: Array<unknown>; blocked: Array<unknown>; done: Array<unknown> };
        xp: { profile: { level: number } };
      };
    }).context;
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
    const overview = (operatorOverview.json() as {
      overview: {
        snapshot: { goals: Array<{ id: string }> };
        operator: { focusTasks: Array<unknown> };
        routeGuide: { preferredStart: string; mainRoutes: Array<{ id: string }> };
        onboarding: { openApiUrl: string; webAppUrl: string };
      };
    }).overview;
    assert.ok(overview.snapshot.goals.length >= 1);
    assert.ok(Array.isArray(overview.operator.focusTasks));
    assert.equal(overview.routeGuide.preferredStart, "/api/v1/operator/overview");
    assert.ok(overview.routeGuide.mainRoutes.some((route) => route.id === "psyche_overview"));
    assert.equal(overview.onboarding.openApiUrl, "http://127.0.0.1:4317/api/v1/openapi.json");
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

test("built frontend assets are served correctly from the /forge base path", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-web-basepath-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const indexResponse = await app.inject({
      method: "GET",
      url: "/forge/"
    });
    assert.equal(indexResponse.statusCode, 200);
    assert.match(indexResponse.headers["content-type"] ?? "", /text\/html/);
    assert.match(indexResponse.body, /\/forge\/assets\//);

    const assetMatch = indexResponse.body.match(/src="(\/forge\/assets\/[^"]+\.js)"/);
    assert.ok(assetMatch);

    const assetResponse = await app.inject({
      method: "GET",
      url: assetMatch[1]!
    });
    assert.equal(assetResponse.statusCode, 200);
    assert.match(assetResponse.headers["content-type"] ?? "", /application\/javascript/);

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
  const app = await buildServer({ dataRoot: rootDir });

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
    const rules = (rulesResponse.json() as { rules: Array<{ id: string; active: boolean }> }).rules;
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
    const updatedRule = (updatedResponse.json() as { rule: { id: string; active: boolean; description: string } }).rule;
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
    const bonus = (bonusResponse.json() as {
      reward: { deltaXp: number; reasonTitle: string };
      metrics: { recentLedger: Array<{ reasonTitle: string }> };
    });
    assert.equal(bonus.reward.deltaXp, 12);
    assert.equal(bonus.reward.reasonTitle, "Operator bonus");
    assert.ok(bonus.metrics.recentLedger.some((entry) => entry.reasonTitle === "Operator bonus"));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("versioned goal creation and updates persist through the API", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-goal-v1-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
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
    const createdGoal = (created.json() as { goal: { id: string; title: string; tagIds: string[] } }).goal;
    assert.equal(createdGoal.title, "Build resilient energy for the next quarter");
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
    const goal = (updated.json() as { goal: { title: string; status: string; targetPoints: number; tagIds: string[] } }).goal;
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
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
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
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
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
    const task = (updated.json() as {
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
    }).task;
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
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-v1-task-context-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
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
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-v1-agent-surface-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const goalsResponse = await app.inject({ method: "GET", url: "/api/v1/goals" });
    assert.equal(goalsResponse.statusCode, 200);
    const goalsBody = goalsResponse.json() as { goals: Array<{ id: string }> };
    assert.ok(goalsBody.goals.length >= 1);

    const tagsResponse = await app.inject({ method: "GET", url: "/api/v1/tags" });
    assert.equal(tagsResponse.statusCode, 200);
    const tagsBody = tagsResponse.json() as { tags: Array<{ id: string }> };
    assert.ok(tagsBody.tags.length >= 1);

    const metricsResponse = await app.inject({ method: "GET", url: "/api/v1/metrics" });
    assert.equal(metricsResponse.statusCode, 200);
    const metricsBody = metricsResponse.json() as {
      metrics: { profile: { level: number }; achievements: Array<{ id: string }>; milestoneRewards: Array<{ id: string }> };
    };
    assert.ok(metricsBody.metrics.profile.level >= 1);
    assert.ok(metricsBody.metrics.achievements.length >= 1);
    assert.ok(metricsBody.metrics.milestoneRewards.length >= 1);

    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
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
    const agentToken = (tokenResponse.json() as { token: { token: string } }).token.token;
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
    const claimBody = claim.json() as { taskRun: { id: string; status: string } };
    assert.equal(claimBody.taskRun.status, "active");

    const taskRunsResponse = await app.inject({ method: "GET", url: "/api/v1/task-runs?active=true&limit=5" });
    assert.equal(taskRunsResponse.statusCode, 200);
    const taskRunsBody = taskRunsResponse.json() as { taskRuns: Array<{ id: string }> };
    assert.ok(taskRunsBody.taskRuns.some((taskRun) => taskRun.id === claimBody.taskRun.id));

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

    const activityResponse = await app.inject({ method: "GET", url: "/api/v1/activity?entityType=task_run&limit=5" });
    assert.equal(activityResponse.statusCode, 200);
    const activityBody = activityResponse.json() as { activity: Array<{ entityType: string }> };
    assert.ok(activityBody.activity.some((event) => event.entityType === "task_run"));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("versioned goal, tag, and project surfaces are available without legacy routes", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-v1-goal-tag-project-"));
  const app = await buildServer({ dataRoot: rootDir });

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
    const createdTag = (createdTagResponse.json() as { tag: { id: string } }).tag;

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
    const createdGoal = (createdGoalResponse.json() as { goal: { id: string; title: string } }).goal;

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
    const updatedGoal = (updatedGoalResponse.json() as { goal: { status: string } }).goal;
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
    const createdProject = (createdProjectResponse.json() as { project: { id: string; goalId: string } }).project;
    assert.equal(createdProject.goalId, createdGoal.id);

    const projectsResponse = await app.inject({
      method: "GET",
      url: `/api/v1/projects?goalId=${createdGoal.id}`
    });
    assert.equal(projectsResponse.statusCode, 200);
    const projectsBody = projectsResponse.json() as { projects: Array<{ goalId: string }> };
    assert.ok(Array.isArray(projectsBody.projects));
    assert.ok(projectsBody.projects.some((project) => project.goalId === createdGoal.id));

    const aliasResponse = await app.inject({
      method: "GET",
      url: `/api/v1/campaigns?goalId=${createdGoal.id}`
    });
    assert.equal(aliasResponse.statusCode, 200);
    assert.equal(aliasResponse.headers.deprecation, "true");
    assert.equal(aliasResponse.headers.sunset, "transitional-node");
    assert.equal(aliasResponse.headers.link, "</api/v1/projects>; rel=\"successor-version\"");
    const aliasBody = aliasResponse.json() as { projects: Array<{ goalId: string }> };
    assert.ok(Array.isArray(aliasBody.projects));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("compatibility routes are marked deprecated and event stream metadata is explicit", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-compat-deprecation-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const compatibilityResponse = await app.inject({ method: "GET", url: "/api/goals" });
    assert.equal(compatibilityResponse.statusCode, 200);
    assert.equal(compatibilityResponse.headers.deprecation, "true");

    const eventsMetaResponse = await app.inject({ method: "GET", url: "/api/v1/events/meta" });
    assert.equal(eventsMetaResponse.statusCode, 200);
    const metaBody = eventsMetaResponse.json() as {
      events: { retryMs: number; events: Array<{ name: string }> };
    };
    assert.equal(metaBody.events.retryMs, 3000);
    assert.ok(metaBody.events.events.some((event) => event.name === "activity"));
    assert.ok(metaBody.events.events.some((event) => event.name === "heartbeat"));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("command-center context exposes derived achievements and milestone rewards", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-gamification-signals-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const response = await app.inject({ method: "GET", url: "/api/v1/context" });
    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      dashboard: { achievements: Array<{ id: string }>; milestoneRewards: Array<{ id: string }> };
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
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-project-snapshot-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const response = await app.inject({ method: "GET", url: "/api/v1/context" });
    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      projects: Array<{ id: string; goalId: string }>;
      dashboard: { projects: Array<{ id: string; goalId: string }> };
      overview: { projects: Array<{ id: string; goalId: string }> };
    };

    assert.ok(body.projects.length >= 1);
    assert.ok(body.dashboard.projects.length >= 1);
    assert.ok(body.dashboard.projects.every((project) => project.goalId.length > 0));
    assert.ok(body.overview.projects.length >= 1);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("openapi document exposes schema-backed versioned contracts", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-openapi-contract-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const response = await app.inject({ method: "GET", url: "/api/v1/openapi.json" });
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
    const schemaCatalogEntry = body.components?.schemas?.SchemaCatalogEntry as { properties?: { schemaType?: { enum?: string[] } } };
    assert.deepEqual(schemaCatalogEntry.properties?.schemaType?.enum, ["maladaptive", "adaptive"]);
    assert.ok(body.components?.schemas?.ModeProfile);
    assert.ok(body.components?.schemas?.ModeGuideSession);
    assert.ok(body.components?.schemas?.EventType);
    assert.ok(body.components?.schemas?.EmotionDefinition);
    assert.ok(body.components?.schemas?.TriggerReport);
    assert.ok(body.components?.schemas?.Comment);
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
    assert.ok(body.paths?.["/api/v1/comments"]);
    assert.ok(body.paths?.["/api/v1/comments/{id}"]);
    assert.ok(body.paths?.["/api/v1/tags"]);
    assert.ok(body.paths?.["/api/v1/tags/{id}"]);
    assert.ok(body.paths?.["/api/v1/projects"]);
    assert.ok(body.paths?.["/api/v1/projects/{id}"]);
    assert.ok(body.paths?.["/api/v1/projects/{id}/board"]);
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

test("versioned CRUD routes support get, update, and delete for tags, comments, tasks, projects, and goals", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-versioned-crud-"));
  const app = await buildServer({ dataRoot: rootDir });

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
    const projectId = (projectResponse.json() as { project: { id: string } }).project.id;

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

    const tagGetResponse = await app.inject({ method: "GET", url: `/api/v1/tags/${tagId}` });
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

    const taskAfterTagDelete = await app.inject({ method: "GET", url: `/api/v1/tasks/${taskId}` });
    assert.equal(taskAfterTagDelete.statusCode, 200);
    assert.deepEqual((taskAfterTagDelete.json() as { task: { tagIds: string[] } }).task.tagIds, []);

    const commentResponse = await app.inject({
      method: "POST",
      url: "/api/v1/comments",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        entityType: "task",
        entityId: taskId,
        anchorKey: null,
        body: "CRUD comment body",
        author: "Albert"
      }
    });
    assert.equal(commentResponse.statusCode, 201);
    const commentId = (commentResponse.json() as { comment: { id: string } }).comment.id;

    const commentGetResponse = await app.inject({
      method: "GET",
      url: `/api/v1/comments/${commentId}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(commentGetResponse.statusCode, 200);

    const commentPatchResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/comments/${commentId}`,
      headers: {
        cookie: operatorCookie
      },
      payload: {
        body: "CRUD comment body updated"
      }
    });
    assert.equal(commentPatchResponse.statusCode, 200);

    const commentDeleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/comments/${commentId}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(commentDeleteResponse.statusCode, 200);

    const deletedCommentGet = await app.inject({
      method: "GET",
      url: `/api/v1/comments/${commentId}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(deletedCommentGet.statusCode, 404);

    const taskDeleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/tasks/${taskId}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(taskDeleteResponse.statusCode, 200);

    const deletedTaskGet = await app.inject({ method: "GET", url: `/api/v1/tasks/${taskId}` });
    assert.equal(deletedTaskGet.statusCode, 404);

    const projectDeleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${projectId}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(projectDeleteResponse.statusCode, 200);

    const deletedProjectGet = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}` });
    assert.equal(deletedProjectGet.statusCode, 404);

    const goalDeleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/goals/${goalId}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(goalDeleteResponse.statusCode, 200);

    const deletedGoalGet = await app.inject({ method: "GET", url: `/api/v1/goals/${goalId}` });
    assert.equal(deletedGoalGet.statusCode, 404);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("completed tasks can be reopened and lose their completion XP", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-uncomplete-task-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const tasksResponse = await app.inject({ method: "GET", url: "/api/v1/tasks?limit=1" });
    const taskId = (tasksResponse.json() as { tasks: Array<{ id: string }> }).tasks[0]!.id;

    const completeResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${taskId}`,
      headers: {
        cookie: operatorCookie
      },
      payload: { status: "done" }
    });
    assert.equal(completeResponse.statusCode, 200);

    const metricsAfterComplete = await app.inject({ method: "GET", url: "/api/v1/context" });
    const xpAfterComplete = (metricsAfterComplete.json() as { metrics: { totalXp: number } }).metrics.totalXp;

    const reopenResponse = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${taskId}/uncomplete`,
      headers: {
        cookie: operatorCookie
      },
      payload: {}
    });
    assert.equal(reopenResponse.statusCode, 200);
    const reopenedTask = (reopenResponse.json() as { task: { status: string; completedAt: string | null } }).task;
    assert.notEqual(reopenedTask.status, "done");
    assert.equal(reopenedTask.completedAt, null);

    const metricsAfterReopen = await app.inject({ method: "GET", url: "/api/v1/context" });
    const xpAfterReopen = (metricsAfterReopen.json() as { metrics: { totalXp: number } }).metrics.totalXp;
    assert.ok(xpAfterReopen < xpAfterComplete);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("domains endpoint exposes psyche as a sensitive first-class domain", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-domains-psyche-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const response = await app.inject({ method: "GET", url: "/api/v1/domains" });
    assert.equal(response.statusCode, 200);
    const body = response.json() as { domains: Array<{ slug: string; sensitive: boolean }> };
    assert.ok(body.domains.some((domain) => domain.slug === "psyche" && domain.sensitive === true));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("trigger reports persist structured CBT fields and earn bounded reflection XP", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-trigger-report-"));
  const app = await buildServer({ dataRoot: rootDir });

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
        eventSituation: "I sent an emotionally open message and then saw no reply for several hours.",
        occurredAt: "2026-03-23T19:30:00.000Z",
        emotions: [
          { id: "emotion_1", label: "fear", intensity: 82, note: "tight chest" }
        ],
        thoughts: [
          { id: "thought_1", text: "I am being abandoned", parentMode: "demanding parent", criticMode: "inner critic" }
        ],
        behaviors: [
          { id: "behavior_1", text: "checked the phone repeatedly", mode: "vulnerable child" }
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
    assert.equal(detailBody.report.behaviors[0]?.text, "checked the phone repeatedly");
    assert.ok(detailBody.report.consequences.selfLongTerm.includes("more attachment panic"));

    const rewards = await app.inject({
      method: "GET",
      url: `/api/v1/rewards/ledger?entityType=trigger_report&entityId=${reportId}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(rewards.statusCode, 200);
    const rewardsBody = rewards.json() as { ledger: Array<{ deltaXp: number; reasonTitle: string }> };
    assert.ok(rewardsBody.ledger.some((event) => event.deltaXp > 0 && event.reasonTitle.includes("Psyche reflection captured")));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("psyche comments persist and scoped tokens cannot read psyche without explicit grant", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-psyche-comment-scope-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const reportResponse = await app.inject({
      method: "POST",
      url: "/api/v1/psyche/reports",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        title: "Trigger report for comment scope test",
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
    const reportId = (reportResponse.json() as { report: { id: string } }).report.id;

    const commentResponse = await app.inject({
      method: "POST",
      url: "/api/v1/comments",
      headers: {
        cookie: operatorCookie
      },
      payload: {
        entityType: "trigger_report",
        entityId: reportId,
        body: "Notice the abandonment story before acting on it."
      }
    });
    assert.equal(commentResponse.statusCode, 201);

    const commentList = await app.inject({
      method: "GET",
      url: `/api/v1/comments?entityType=trigger_report&entityId=${reportId}`,
      headers: {
        cookie: operatorCookie
      }
    });
    assert.equal(commentList.statusCode, 200);
    const commentBody = commentList.json() as { comments: Array<{ body: string }> };
    assert.ok(commentBody.comments.some((comment) => comment.body.includes("abandonment story")));

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
    const token = (tokenResponse.json() as { token: { token: string } }).token.token;

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
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-psyche-expanded-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const psycheHeaders = { cookie: operatorCookie };
    const schemasResponse = await app.inject({ method: "GET", url: "/api/v1/psyche/schema-catalog", headers: psycheHeaders });
    assert.equal(schemasResponse.statusCode, 200);
    const schemas = (schemasResponse.json() as { schemas: Array<{ id: string; title: string; schemaType: "maladaptive" | "adaptive" }> }).schemas;
    assert.ok(schemas.some((schema) => schema.schemaType === "adaptive" && schema.title === "Stable Attachment"));
    const schemaId = schemas.find((schema) => schema.schemaType === "maladaptive")!.id;

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
    const eventTypeId = (eventTypeResponse.json() as { eventType: { id: string } }).eventType.id;
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
        description: "Moments where attachment panic rises after distance and silence."
      }
    });
    assert.equal(eventTypePatchResponse.statusCode, 200);
    const eventTypePatchBody = eventTypePatchResponse.json() as { eventType: { description: string } };
    assert.equal(eventTypePatchBody.eventType.description, "Moments where attachment panic rises after distance and silence.");

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
    const emotionId = (emotionResponse.json() as { emotion: { id: string } }).emotion.id;
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
    const emotionPatchBody = emotionPatchResponse.json() as { emotion: { category: string } };
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
    const valueId = (valueResponse.json() as { value: { id: string } }).value.id;

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
    const patternId = (patternResponse.json() as { pattern: { id: string } }).pattern.id;

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
    const behaviorId = (behaviorResponse.json() as { behavior: { id: string } }).behavior.id;

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
        flexibleAlternative: "Silence can mean distance, but it does not prove abandonment.",
        linkedValueIds: [valueId],
        linkedBehaviorIds: [behaviorId],
        linkedModeIds: [modeId],
        linkedReportIds: []
      }
    });
    assert.equal(beliefResponse.statusCode, 201);
    const beliefId = (beliefResponse.json() as { belief: { id: string } }).belief.id;

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
    const guideBody = guideResponse.json() as { session: { id: string; results: Array<{ family: string }> } };
    assert.ok(guideBody.session.results.some((result) => result.family === "child"));
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
    const guidePatchBody = guidePatchResponse.json() as { session: { summary: string } };
    assert.equal(guidePatchBody.session.summary, "Recent rupture-style trigger with stronger freeze response");

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
        emotions: [{ id: "emotion_1", emotionDefinitionId: emotionId, label: "aching tenderness", intensity: 72, note: "chest ache" }],
        thoughts: [{ id: "thought_1", text: "I am being left", parentMode: "demanding parent", criticMode: "punitive critic", beliefId }],
        behaviors: [{ id: "behavior_1", text: "Checked the thread repeatedly", mode: "Tender alarm child", behaviorId }],
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
        modeTimeline: [{ id: "timeline_1", stage: "spark", modeId, label: "Tender alarm child", note: "Alarm rises immediately" }],
        nextMoves: ["Wait before sending a second message"]
      }
    });
    assert.equal(reportResponse.statusCode, 201);
    const reportId = (reportResponse.json() as { report: { id: string } }).report.id;

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
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-psyche-delete-crud-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const psycheHeaders = {
      cookie: operatorCookie
    };

    const schemaResponse = await app.inject({ method: "GET", url: "/api/v1/psyche/schema-catalog", headers: psycheHeaders });
    const schemaId = (schemaResponse.json() as { schemas: Array<{ id: string; schemaType: "maladaptive" | "adaptive" }> }).schemas.find((schema) => schema.schemaType === "maladaptive")!.id;

    const goalResponse = await app.inject({ method: "GET", url: "/api/v1/goals" });
    const goalId = (goalResponse.json() as { goals: Array<{ id: string }> }).goals[0]!.id;
    const projectResponse = await app.inject({ method: "GET", url: `/api/v1/projects?goalId=${goalId}` });
    const projectId = (projectResponse.json() as { projects: Array<{ id: string }> }).projects[0]!.id;
    const taskResponse = await app.inject({ method: "GET", url: `/api/v1/tasks?projectId=${projectId}&limit=1` });
    const taskId = (taskResponse.json() as { tasks: Array<{ id: string }> }).tasks[0]!.id;

    const eventTypeId = (
      (await app.inject({
        method: "POST",
        url: "/api/v1/psyche/event-types",
        headers: psycheHeaders,
        payload: {
          label: "Deletion trigger",
          description: "Custom event type for delete coverage."
        }
      })).json() as { eventType: { id: string } }
    ).eventType.id;

    const emotionId = (
      (await app.inject({
        method: "POST",
        url: "/api/v1/psyche/emotions",
        headers: psycheHeaders,
        payload: {
          label: "Delete-cover emotion",
          description: "Emotion used for delete coverage.",
          category: "test"
        }
      })).json() as { emotion: { id: string } }
    ).emotion.id;

    const valueId = (
      (await app.inject({
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
      })).json() as { value: { id: string } }
    ).value.id;

    const patternId = (
      (await app.inject({
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
      })).json() as { pattern: { id: string } }
    ).pattern.id;

    const modeId = (
      (await app.inject({
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
      })).json() as { mode: { id: string } }
    ).mode.id;

    const behaviorId = (
      (await app.inject({
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
      })).json() as { behavior: { id: string } }
    ).behavior.id;

    const beliefId = (
      (await app.inject({
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
      })).json() as { belief: { id: string } }
    ).belief.id;

    const modeGuideId = (
      (await app.inject({
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
      })).json() as { session: { id: string } }
    ).session.id;

    const reportId = (
      (await app.inject({
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
          emotions: [{ id: "emotion_1", emotionDefinitionId: emotionId, label: "Delete-cover emotion", intensity: 70, note: "" }],
          thoughts: [{ id: "thought_1", text: "I am being left", parentMode: "critic", criticMode: "punitive", beliefId }],
          behaviors: [{ id: "behavior_1", text: "Checked again", mode: "Delete-cover mode", behaviorId }],
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
          modeTimeline: [{ id: "timeline_1", stage: "spark", modeId, label: "Delete-cover mode", note: "" }],
          nextMoves: ["Wait"]
        }
      })).json() as { report: { id: string } }
    ).report.id;

    const reportCommentResponse = await app.inject({
      method: "POST",
      url: "/api/v1/comments",
      headers: psycheHeaders,
      payload: {
        entityType: "trigger_report",
        entityId: reportId,
        anchorKey: null,
        body: "This comment should disappear with the report.",
        author: "Albert"
      }
    });
    assert.equal(reportCommentResponse.statusCode, 201);

    assert.equal((await app.inject({ method: "DELETE", url: `/api/v1/psyche/beliefs/${beliefId}`, headers: psycheHeaders })).statusCode, 200);
    const reportAfterBeliefDelete = await app.inject({ method: "GET", url: `/api/v1/psyche/reports/${reportId}`, headers: psycheHeaders });
    assert.equal(reportAfterBeliefDelete.statusCode, 200);
    const reportAfterBeliefDeleteBody = reportAfterBeliefDelete.json() as {
      report: { linkedBeliefIds: string[]; thoughts: Array<{ beliefId: string | null }> };
    };
    assert.deepEqual(reportAfterBeliefDeleteBody.report.linkedBeliefIds, []);
    assert.equal(reportAfterBeliefDeleteBody.report.thoughts[0]?.beliefId, null);

    assert.equal((await app.inject({ method: "DELETE", url: `/api/v1/psyche/modes/${modeId}`, headers: psycheHeaders })).statusCode, 200);
    const behaviorAfterModeDelete = await app.inject({ method: "GET", url: `/api/v1/psyche/behaviors/${behaviorId}`, headers: psycheHeaders });
    assert.equal(behaviorAfterModeDelete.statusCode, 200);
    assert.deepEqual((behaviorAfterModeDelete.json() as { behavior: { linkedModeIds: string[] } }).behavior.linkedModeIds, []);
    const reportAfterModeDelete = await app.inject({ method: "GET", url: `/api/v1/psyche/reports/${reportId}`, headers: psycheHeaders });
    const reportAfterModeDeleteBody = reportAfterModeDelete.json() as {
      report: { linkedModeIds: string[]; modeTimeline: Array<{ modeId: string | null }> };
    };
    assert.deepEqual(reportAfterModeDeleteBody.report.linkedModeIds, []);
    assert.equal(reportAfterModeDeleteBody.report.modeTimeline[0]?.modeId, null);

    assert.equal((await app.inject({ method: "DELETE", url: `/api/v1/psyche/event-types/${eventTypeId}`, headers: psycheHeaders })).statusCode, 200);
    assert.equal((await app.inject({ method: "DELETE", url: `/api/v1/psyche/emotions/${emotionId}`, headers: psycheHeaders })).statusCode, 200);
    const reportAfterEventEmotionDelete = await app.inject({ method: "GET", url: `/api/v1/psyche/reports/${reportId}`, headers: psycheHeaders });
    const reportAfterEventEmotionDeleteBody = reportAfterEventEmotionDelete.json() as {
      report: { eventTypeId: string | null; emotions: Array<{ emotionDefinitionId: string | null }> };
    };
    assert.equal(reportAfterEventEmotionDeleteBody.report.eventTypeId, null);
    assert.equal(reportAfterEventEmotionDeleteBody.report.emotions[0]?.emotionDefinitionId, null);

    assert.equal((await app.inject({ method: "DELETE", url: `/api/v1/psyche/patterns/${patternId}`, headers: psycheHeaders })).statusCode, 200);
    const behaviorAfterPatternDelete = await app.inject({ method: "GET", url: `/api/v1/psyche/behaviors/${behaviorId}`, headers: psycheHeaders });
    assert.deepEqual((behaviorAfterPatternDelete.json() as { behavior: { linkedPatternIds: string[] } }).behavior.linkedPatternIds, []);

    assert.equal((await app.inject({ method: "DELETE", url: `/api/v1/psyche/values/${valueId}`, headers: psycheHeaders })).statusCode, 200);
    const reportAfterValueDelete = await app.inject({ method: "GET", url: `/api/v1/psyche/reports/${reportId}`, headers: psycheHeaders });
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
    assert.deepEqual(reportAfterValueDeleteBody.report.linkedProjectIds, [projectId]);
    assert.deepEqual(reportAfterValueDeleteBody.report.linkedTaskIds, [taskId]);

    assert.equal((await app.inject({ method: "DELETE", url: `/api/v1/psyche/behaviors/${behaviorId}`, headers: psycheHeaders })).statusCode, 200);
    const reportAfterBehaviorDelete = await app.inject({ method: "GET", url: `/api/v1/psyche/reports/${reportId}`, headers: psycheHeaders });
    const reportAfterBehaviorDeleteBody = reportAfterBehaviorDelete.json() as {
      report: { linkedBehaviorIds: string[]; behaviors: Array<{ behaviorId: string | null }> };
    };
    assert.deepEqual(reportAfterBehaviorDeleteBody.report.linkedBehaviorIds, []);
    assert.equal(reportAfterBehaviorDeleteBody.report.behaviors[0]?.behaviorId, null);

    assert.equal((await app.inject({ method: "DELETE", url: `/api/v1/psyche/mode-guides/${modeGuideId}`, headers: psycheHeaders })).statusCode, 200);
    const deletedModeGuideGet = await app.inject({ method: "GET", url: `/api/v1/psyche/mode-guides/${modeGuideId}`, headers: psycheHeaders });
    assert.equal(deletedModeGuideGet.statusCode, 404);

    assert.equal((await app.inject({ method: "DELETE", url: `/api/v1/psyche/reports/${reportId}`, headers: psycheHeaders })).statusCode, 200);
    const deletedReportGet = await app.inject({ method: "GET", url: `/api/v1/psyche/reports/${reportId}`, headers: psycheHeaders });
    assert.equal(deletedReportGet.statusCode, 404);
    const reportComments = await app.inject({
      method: "GET",
      url: `/api/v1/comments?entityType=trigger_report&entityId=${reportId}`,
      headers: psycheHeaders
    });
    assert.deepEqual((reportComments.json() as { comments: unknown[] }).comments, []);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("activity correction hides removed events from the default archive", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-activity-correction-"));
  const app = await buildServer({ dataRoot: rootDir });

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

    const initialActivity = await app.inject({ method: "GET", url: "/api/v1/activity?limit=1" });
    const eventId = (initialActivity.json() as { activity: Array<{ id: string }> }).activity[0]!.id;

    const removeResponse = await app.inject({
      method: "POST",
      url: `/api/v1/activity/${eventId}/remove`,
      headers: {
        cookie: operatorCookie
      },
      payload: { reason: "User removed this visible log." }
    });
    assert.equal(removeResponse.statusCode, 200);

    const afterRemoval = await app.inject({ method: "GET", url: "/api/v1/activity?limit=100" });
    const visibleIds = (afterRemoval.json() as { activity: Array<{ id: string }> }).activity.map((event) => event.id);
    assert.ok(!visibleIds.includes(eventId));

    const correctedHistory = await app.inject({ method: "GET", url: "/api/v1/activity?limit=100&includeCorrected=true" });
    const correctedIds = (correctedHistory.json() as { activity: Array<{ id: string }> }).activity.map((event) => event.id);
    assert.ok(correctedIds.includes(eventId));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("task creation rejects unknown goal references with a 404 and no partial write", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-task-bad-goal-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const before = await app.inject({ method: "GET", url: "/api/tasks" });
    const beforeCount = (before.json() as { tasks: Array<{ id: string }> }).tasks.length;

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
    const afterCount = (after.json() as { tasks: Array<{ id: string }> }).tasks.length;
    assert.equal(afterCount, beforeCount);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("task-run completion and release endpoints are idempotent for same-actor retries", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-task-run-idempotency-"));
  const app = await buildServer({ dataRoot: rootDir, taskRunWatchdog: false });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const tasksResponse = await app.inject({ method: "GET", url: "/api/tasks?limit=1" });
    const taskId = (tasksResponse.json() as { tasks: Array<{ id: string }> }).tasks[0]!.id;

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
    const claimedRunId = (claimed.json() as { taskRun: { id: string } }).taskRun.id;

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
    const completedRun = (completed.json() as { taskRun: { id: string; status: string; completedAt: string | null } }).taskRun;
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
      (completedRetry.json() as { taskRun: { id: string; status: string; completedAt: string | null } }).taskRun,
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
    const releaseRunId = (claimedForRelease.json() as { taskRun: { id: string } }).taskRun.id;

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
    const releasedRun = (released.json() as { taskRun: { id: string; status: string; releasedAt: string | null } }).taskRun;
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
      (releasedRetry.json() as { taskRun: { id: string; status: string; releasedAt: string | null } }).taskRun,
      releasedRun
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});


test("task creation is idempotent when the same Idempotency-Key is retried", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-task-idempotent-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    const payload = dashboard.json() as {
      goals: Array<{ id: string }>;
      tasks: Array<{ id: string }>;
      tags: Array<{ id: string }>;
    };
    const beforeCount = payload.tasks.length;

    const taskPayload = {
      title: "Retry-safe focus block",
      description: "This should not duplicate when the client retries after a timeout.",
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
    const afterCount = (after.json() as { tasks: Array<{ id: string }> }).tasks.length;
    assert.equal(afterCount, beforeCount + 1);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("task creation rejects reusing an Idempotency-Key with a different payload", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-task-idempotency-conflict-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
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
      error: "Idempotency key was already used for a different task creation payload",
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
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const metricsResponse = await app.inject({ method: "GET", url: "/api/metrics" });
    assert.equal(metricsResponse.statusCode, 200);
    const metrics = (metricsResponse.json() as { metrics: { level: number; totalXp: number; nextLevelXp: number } }).metrics;
    assert.ok(metrics.level >= 1);
    assert.ok(metrics.totalXp >= 0);
    assert.ok(metrics.nextLevelXp > 0);

    const filteredTasksResponse = await app.inject({
      method: "GET",
      url: "/api/tasks?owner=Albert&due=week&limit=3"
    });
    assert.equal(filteredTasksResponse.statusCode, 200);
    const filteredTasks = (filteredTasksResponse.json() as { tasks: Array<{ owner: string }> }).tasks;
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
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
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
    const activity = (activityResponse.json() as {
      activity: Array<{ entityType: string; entityId: string; source: string; title: string }>;
    }).activity;

    assert.ok(activity.some((event) => event.entityType === "task" && event.entityId === taskId && event.source === "openclaw"));
    assert.ok(activity.some((event) => event.entityType === "goal" && event.source === "ui"));
    assert.ok(
      activity.some(
        (event) => event.entityType === "task_run" && (event.title.includes("started") || event.title.includes("claimed"))
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
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
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
    const task = (createdTask.json() as { task: { id: string; goalId: string } }).task;

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
    assert.ok(context.taskRuns.some((entry) => entry.id === claimedRun.id && entry.taskId === task.id));
    assert.ok(context.activity.some((event) => event.entityType === "task" && event.entityId === task.id && event.source === "openclaw"));
    assert.ok(context.activity.some((event) => event.entityType === "task_run" && event.entityId === claimedRun.id));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("goal updates reject unknown tags with a 404", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-goal-bad-tag-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
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
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-insights-review-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const insights = await app.inject({ method: "GET", url: "/api/v1/insights" });
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

    const review = await app.inject({ method: "GET", url: "/api/v1/reviews/weekly" });
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

test("soft delete, restore, hard delete, and the settings bin stay in sync for anchored collaboration", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-soft-delete-bin-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);

    const goalsResponse = await app.inject({ method: "GET", url: "/api/v1/goals" });
    const goalId = (goalsResponse.json() as { goals: Array<{ id: string }> }).goals[0]!.id;

    const commentResponse = await app.inject({
      method: "POST",
      url: "/api/v1/comments",
      headers: { cookie: operatorCookie },
      payload: {
        entityType: "goal",
        entityId: goalId,
        body: "This goal has collaboration attached to it."
      }
    });
    assert.equal(commentResponse.statusCode, 201);
    const commentId = (commentResponse.json() as { comment: { id: string } }).comment.id;

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
        recommendation: "Review the linked project and create one visible next task.",
        rationale: "",
        confidence: 0.78,
        visibility: "visible",
        ctaLabel: "Review insight"
      }
    });
    assert.equal(insightResponse.statusCode, 201);
    const insightId = (insightResponse.json() as { insight: { id: string } }).insight.id;

    const softDeleteGoal = await app.inject({
      method: "DELETE",
      url: `/api/v1/goals/${goalId}`,
      headers: { cookie: operatorCookie }
    });
    assert.equal(softDeleteGoal.statusCode, 200);

    const deletedGoal = await app.inject({ method: "GET", url: `/api/v1/goals/${goalId}` });
    assert.equal(deletedGoal.statusCode, 404);

    const hiddenComments = await app.inject({
      method: "GET",
      url: `/api/v1/comments?entityType=goal&entityId=${goalId}`,
      headers: { cookie: operatorCookie }
    });
    assert.deepEqual((hiddenComments.json() as { comments: unknown[] }).comments, []);

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
    assert.ok(binBody.bin.records.some((record) => record.entityType === "goal" && record.entityId === goalId));
    assert.ok(binBody.bin.records.some((record) => record.entityType === "comment" && record.entityId === commentId));
    assert.ok(binBody.bin.records.some((record) => record.entityType === "insight" && record.entityId === insightId));

    const restored = await app.inject({
      method: "POST",
      url: "/api/v1/entities/restore",
      headers: { cookie: operatorCookie },
      payload: {
        operations: [{ entityType: "goal", id: goalId }]
      }
    });
    assert.equal(restored.statusCode, 200);

    const restoredGoal = await app.inject({ method: "GET", url: `/api/v1/goals/${goalId}` });
    assert.equal(restoredGoal.statusCode, 200);

    const restoredComments = await app.inject({
      method: "GET",
      url: `/api/v1/comments?entityType=goal&entityId=${goalId}`,
      headers: { cookie: operatorCookie }
    });
    assert.ok((restoredComments.json() as { comments: Array<{ id: string }> }).comments.some((comment) => comment.id === commentId));

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
    assert.ok(!binAfterHardDeleteBody.bin.records.some((record) => record.entityType === "insight" && record.entityId === insightId));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("atomic batch create rolls back earlier successes when a later operation fails", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-atomic-batch-create-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const beforeResponse = await app.inject({ method: "GET", url: "/api/v1/goals" });
    const beforeCount = (beforeResponse.json() as { goals: Array<{ id: string }> }).goals.length;

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
      results: Array<{ ok: boolean; clientRef?: string; error?: { code: string } }>;
    };
    assert.equal(createBody.results[0]?.ok, false);
    assert.equal(createBody.results[0]?.error?.code, "rolled_back");
    assert.equal(createBody.results[1]?.ok, false);
    assert.equal(createBody.results[1]?.error?.code, "create_failed");

    const afterResponse = await app.inject({ method: "GET", url: "/api/v1/goals" });
    const afterGoals = (afterResponse.json() as { goals: Array<{ id: string; title: string }> }).goals;
    assert.equal(afterGoals.length, beforeCount);
    assert.ok(!afterGoals.some((goal) => goal.title === "Atomic rollback guardrail"));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("batch entity routes create, update, and search entities through the shared capability matrix", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-batch-entity-routes-"));
  const app = await buildServer({ dataRoot: rootDir });

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
    assert.equal(createBody.results[0]?.entity?.title, "Publish the Forge OpenClaw plugin");
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
              description: "Ship the public plugin package, docs, tests, and release workflow."
            }
          }
        ]
      }
    });

    assert.equal(updateResponse.statusCode, 200);
    const updateBody = updateResponse.json() as {
      results: Array<{ ok: boolean; entity?: { id: string; description: string } }>;
    };
    assert.equal(updateBody.results[0]?.ok, true);
    assert.equal(updateBody.results[0]?.entity?.description, "Ship the public plugin package, docs, tests, and release workflow.");

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
      results: Array<{ ok: boolean; matches?: Array<{ entityType: string; id: string }> }>;
    };
    assert.equal(searchBody.results[0]?.ok, true);
    assert.ok(searchBody.results[0]?.matches?.some((match) => match.entityType === "goal" && match.id === createdGoalId));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("batch entity routes require auth and return validation failures with machine-readable details", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-batch-entity-errors-"));
  const app = await buildServer({ dataRoot: rootDir });

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

test("CRUD capability matrix keeps user-facing delete/bin entities explicit", () => {
  const matrix = getCrudEntityCapabilityMatrix();
  const entityTypes = matrix.map((entry) => entry.entityType).sort();

  assert.deepEqual(entityTypes, [
    "behavior",
    "behavior_pattern",
    "belief_entry",
    "comment",
    "emotion_definition",
    "event_type",
    "goal",
    "insight",
    "mode_guide_session",
    "mode_profile",
    "project",
    "psyche_value",
    "tag",
    "task",
    "trigger_report"
  ]);
  assert.ok(matrix.every((entry) => entry.pluginExposed === true));
  assert.ok(matrix.every((entry) => entry.deleteMode === "soft_default"));
  assert.ok(matrix.every((entry) => entry.inBin === true));
});

test("settings and local agent token management persist through the versioned API", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-settings-api-"));
  const app = await buildServer({ dataRoot: rootDir });

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
        agentTokens: Array<unknown>;
      };
    };
    assert.equal(settingsBody.settings.themePreference, "obsidian");
    assert.equal(settingsBody.settings.execution.maxActiveTasks, 2);
    assert.equal(settingsBody.settings.execution.timeAccountingMode, "split");
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
        }
      }
    });
    assert.equal(updated.statusCode, 200);
    const updatedBody = updated.json() as {
      settings: {
        themePreference: string;
        execution: { maxActiveTasks: number; timeAccountingMode: string };
        profile: { operatorTitle: string };
      };
    };
    assert.equal(updatedBody.settings.themePreference, "solar");
    assert.equal(updatedBody.settings.execution.maxActiveTasks, 3);
    assert.equal(updatedBody.settings.execution.timeAccountingMode, "parallel");
    assert.equal(updatedBody.settings.profile.operatorTitle, "Systems architect");

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
      (settingsViaToken.json() as { settings: { execution: { maxActiveTasks: number } } }).settings.execution.maxActiveTasks,
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
      settings: { execution: { maxActiveTasks: number; timeAccountingMode: string } };
    };
    assert.equal(updatedViaTokenBody.settings.execution.maxActiveTasks, 4);
    assert.equal(updatedViaTokenBody.settings.execution.timeAccountingMode, "primary_only");

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
        tokenRecovery: { rawTokenStoredByForge: boolean; recoveryAction: string };
        conceptModel: { goal: string; taskRun: string; psyche: string };
        psycheSubmoduleModel: { behaviorPattern: string; beliefEntry: string; schemaCatalog: string; triggerReport: string };
        psycheCoachingPlaybooks: Array<{
          focus: string;
          askSequence: string[];
          requiredForCreate: string[];
          exampleQuestions: string[];
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
        verificationPaths: { settingsBin: string; batchSearch: string; psycheSchemaCatalog: string; psycheEventTypes: string; psycheEmotions: string };
        recommendedPluginTools: {
          bootstrap: string[];
          readModels: string[];
          uiWorkflow: string[];
          entityWorkflow: string[];
          workWorkflow: string[];
          insightWorkflow: string[];
        };
        interactionGuidance: {
          saveSuggestionPlacement: string;
          maxQuestionsPerTurn: number;
          duplicateCheckRoute: string;
          uiSuggestionRule: string;
          browserFallbackRule: string;
          writeConsentRule: string;
        };
        mutationGuidance: {
          deleteDefault: string;
          preferredBatchRoutes: { create: string; update: string; delete: string; restore: string; search: string };
          batchingRule: string;
          searchRule: string;
          createRule: string;
          updateRule: string;
          createExample: string;
          updateExample: string;
        };
      };
    };
    assert.equal(onboardingBody.onboarding.forgeBaseUrl, "http://127.0.0.1:4317");
    assert.equal(onboardingBody.onboarding.webAppUrl, "http://127.0.0.1:4317/forge/");
    assert.equal(onboardingBody.onboarding.openApiUrl, "http://127.0.0.1:4317/api/v1/openapi.json");
    assert.equal(onboardingBody.onboarding.defaultConnectionMode, "operator_session");
    assert.deepEqual(onboardingBody.onboarding.recommendedScopes, [
      "read",
      "write",
      "insights",
      "rewards.manage",
      "psyche.read",
      "psyche.write",
      "psyche.comment",
      "psyche.insight",
      "psyche.mode"
    ]);
    assert.equal(onboardingBody.onboarding.recommendedAutonomyMode, "approval_required");
    assert.equal(onboardingBody.onboarding.authModes.operatorSession.tokenRequired, false);
    assert.equal(onboardingBody.onboarding.tokenRecovery.rawTokenStoredByForge, false);
    assert.equal(onboardingBody.onboarding.tokenRecovery.recoveryAction, "rotate_or_issue_new_token");
    assert.match(onboardingBody.onboarding.conceptModel.goal, /Goals anchor projects/);
    assert.match(onboardingBody.onboarding.conceptModel.taskRun, /live work session/);
    assert.match(onboardingBody.onboarding.conceptModel.psyche, /sensitive/);
    assert.match(onboardingBody.onboarding.psycheSubmoduleModel.behaviorPattern, /CBT-style loop/);
    assert.match(onboardingBody.onboarding.psycheSubmoduleModel.beliefEntry, /belief statement/);
    assert.match(onboardingBody.onboarding.psycheSubmoduleModel.schemaCatalog, /reference taxonomy/);
    assert.match(onboardingBody.onboarding.psycheSubmoduleModel.triggerReport, /incident chain/);
    const patternPlaybook = onboardingBody.onboarding.psycheCoachingPlaybooks.find((playbook) => playbook.focus === "behavior_pattern");
    assert.ok(patternPlaybook);
    assert.ok(patternPlaybook.askSequence.some((step) => /short-term payoff/i.test(step)));
    assert.ok(patternPlaybook.exampleQuestions.some((question) => /What usually sets this loop off/i.test(question)));
    const beliefPlaybook = onboardingBody.onboarding.psycheCoachingPlaybooks.find((playbook) => playbook.focus === "belief_entry");
    assert.ok(beliefPlaybook);
    assert.ok(beliefPlaybook.requiredForCreate.includes("statement"));
    assert.ok(beliefPlaybook.requiredForCreate.includes("beliefType"));
    assert.ok(onboardingBody.onboarding.relationshipModel.some((rule) => /Projects belong to one goal/.test(rule)));
    const goalEntity = onboardingBody.onboarding.entityCatalog.find((entity) => entity.entityType === "goal");
    assert.ok(goalEntity);
    assert.ok(goalEntity.minimumCreateFields.includes("title"));
    assert.ok(goalEntity.fieldGuide.some((field) => field.name === "horizon" && field.required === false));
    const beliefEntity = onboardingBody.onboarding.entityCatalog.find((entity) => entity.entityType === "belief_entry");
    assert.ok(beliefEntity);
    assert.ok(beliefEntity.fieldGuide.some((field) => field.name === "statement" && field.required));
    assert.ok(beliefEntity.fieldGuide.some((field) => field.name === "beliefType" && field.required));
    const eventTypeEntity = onboardingBody.onboarding.entityCatalog.find((entity) => entity.entityType === "event_type");
    assert.ok(eventTypeEntity);
    assert.ok(eventTypeEntity.minimumCreateFields.includes("label"));
    const emotionEntity = onboardingBody.onboarding.entityCatalog.find((entity) => entity.entityType === "emotion_definition");
    assert.ok(emotionEntity);
    assert.ok(emotionEntity.fieldGuide.some((field) => field.name === "category"));
    const modeGuideEntity = onboardingBody.onboarding.entityCatalog.find((entity) => entity.entityType === "mode_guide_session");
    assert.ok(modeGuideEntity);
    assert.ok(modeGuideEntity.minimumCreateFields.includes("answers"));
    assert.ok(modeGuideEntity.minimumCreateFields.includes("results"));
    const triggerReportEntity = onboardingBody.onboarding.entityCatalog.find((entity) => entity.entityType === "trigger_report");
    assert.ok(triggerReportEntity);
    assert.ok(triggerReportEntity.fieldGuide.some((field) => field.name === "emotions"));
    const createTool = onboardingBody.onboarding.toolInputCatalog.find((tool) => tool.toolName === "forge_create_entities");
    assert.ok(createTool);
    assert.ok(createTool.requiredFields.includes("operations[].data"));
    assert.match(createTool.inputShape, /operations/);
    const startRunTool = onboardingBody.onboarding.toolInputCatalog.find((tool) => tool.toolName === "forge_start_task_run");
    assert.ok(startRunTool);
    assert.ok(startRunTool.requiredFields.includes("taskId"));
    assert.ok(startRunTool.requiredFields.includes("actor"));
    assert.equal(onboardingBody.onboarding.verificationPaths.settingsBin, "/api/v1/settings/bin");
    assert.equal(onboardingBody.onboarding.verificationPaths.batchSearch, "/api/v1/entities/search");
    assert.equal(onboardingBody.onboarding.verificationPaths.psycheSchemaCatalog, "/api/v1/psyche/schema-catalog");
    assert.equal(onboardingBody.onboarding.verificationPaths.psycheEventTypes, "/api/v1/psyche/event-types");
    assert.equal(onboardingBody.onboarding.verificationPaths.psycheEmotions, "/api/v1/psyche/emotions");
    assert.deepEqual(onboardingBody.onboarding.recommendedPluginTools.bootstrap, ["forge_get_operator_overview"]);
    assert.deepEqual(onboardingBody.onboarding.recommendedPluginTools.readModels, [
      "forge_get_operator_context",
      "forge_get_current_work",
      "forge_get_psyche_overview",
      "forge_get_xp_metrics",
      "forge_get_weekly_review"
    ]);
    assert.deepEqual(onboardingBody.onboarding.recommendedPluginTools.uiWorkflow, ["forge_get_ui_entrypoint"]);
    assert.deepEqual(onboardingBody.onboarding.recommendedPluginTools.entityWorkflow, [
      "forge_search_entities",
      "forge_create_entities",
      "forge_update_entities",
      "forge_delete_entities",
      "forge_restore_entities"
    ]);
    assert.deepEqual(onboardingBody.onboarding.recommendedPluginTools.workWorkflow, [
      "forge_log_work",
      "forge_start_task_run",
      "forge_heartbeat_task_run",
      "forge_focus_task_run",
      "forge_complete_task_run",
      "forge_release_task_run"
    ]);
    assert.deepEqual(onboardingBody.onboarding.recommendedPluginTools.insightWorkflow, ["forge_post_insight"]);
    assert.equal(onboardingBody.onboarding.interactionGuidance.saveSuggestionPlacement, "end_of_message");
    assert.equal(onboardingBody.onboarding.interactionGuidance.maxQuestionsPerTurn, 3);
    assert.equal(onboardingBody.onboarding.interactionGuidance.duplicateCheckRoute, "/api/v1/entities/search");
    assert.equal(onboardingBody.onboarding.interactionGuidance.uiSuggestionRule, "offer_visual_ui_when_review_or_editing_would_be_easier");
    assert.match(onboardingBody.onboarding.interactionGuidance.browserFallbackRule, /Do not open the Forge UI or a browser/);
    assert.match(onboardingBody.onboarding.interactionGuidance.writeConsentRule, /Only write after explicit save intent/);
    assert.equal(onboardingBody.onboarding.mutationGuidance.deleteDefault, "soft");
    assert.equal(onboardingBody.onboarding.mutationGuidance.preferredBatchRoutes.create, "/api/v1/entities/create");
    assert.equal(onboardingBody.onboarding.mutationGuidance.preferredBatchRoutes.update, "/api/v1/entities/update");
    assert.equal(onboardingBody.onboarding.mutationGuidance.preferredBatchRoutes.delete, "/api/v1/entities/delete");
    assert.equal(onboardingBody.onboarding.mutationGuidance.preferredBatchRoutes.restore, "/api/v1/entities/restore");
    assert.equal(onboardingBody.onboarding.mutationGuidance.preferredBatchRoutes.search, "/api/v1/entities/search");
    assert.match(onboardingBody.onboarding.mutationGuidance.batchingRule, /accept operations as arrays/);
    assert.match(onboardingBody.onboarding.mutationGuidance.searchRule, /accepts searches as an array/);
    assert.match(onboardingBody.onboarding.mutationGuidance.createRule, /entityType and full data/);
    assert.match(onboardingBody.onboarding.mutationGuidance.updateRule, /entityType, id, and patch/);
    assert.match(onboardingBody.onboarding.mutationGuidance.createExample, /\"operations\":\[/);
    assert.match(onboardingBody.onboarding.mutationGuidance.updateExample, /\"patch\":/);

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
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const goalsResponse = await app.inject({ method: "GET", url: "/api/v1/goals" });
    const goalId = (goalsResponse.json() as { goals: Array<{ id: string }> }).goals[0]!.id;

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
        recommendation: "Create another concrete project so the arc stays active.",
        rationale: "Balanced progress is part of Forge's operating model.",
        confidence: 0.84,
        ctaLabel: "Review insight",
        evidence: []
      }
    });
    assert.equal(insightResponse.statusCode, 201);
    const insightId = (insightResponse.json() as { insight: { id: string } }).insight.id;

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

    const xpResponse = await app.inject({ method: "GET", url: "/api/v1/metrics/xp" });
    assert.equal(xpResponse.statusCode, 200);
    const xpBody = xpResponse.json() as { metrics: { recentLedger: Array<{ reasonTitle: string }> } };
    assert.ok(xpBody.metrics.recentLedger.some((entry) => entry.reasonTitle === "Insight applied"));

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
    const approvalBody = approvalResponse.json() as { approvalRequest: { status: string } };
    assert.equal(approvalBody.approvalRequest.status, "executed");

    const projectsResponse = await app.inject({ method: "GET", url: `/api/v1/projects?goalId=${goalId}` });
    const projectsBody = projectsResponse.json() as { projects: Array<{ title: string }> };
    assert.ok(projectsBody.projects.some((project) => project.title === "Second Path"));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("session events and reward endpoints expose bounded ambient XP", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-session-rewards-"));
  const app = await buildServer({ dataRoot: rootDir });

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
    assert.ok(rewardsBody.ledger.some((entry) => entry.reasonTitle === "Active dwell milestone"));

    const eventsResponse = await app.inject({ method: "GET", url: "/api/v1/events?limit=10" });
    assert.equal(eventsResponse.statusCode, 200);
    const eventsBody = eventsResponse.json() as { events: Array<{ eventKind: string }> };
    assert.ok(eventsBody.events.some((entry) => entry.eventKind === "session.dwell_120_seconds"));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});


test("task timers can be started, heartbeated, focused, and completed", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-task-runs-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    const taskId = (dashboard.json() as { tasks: Array<{ id: string }> }).tasks[0]!.id;

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
    const claimedRun = (claimed.json() as {
      taskRun: {
        id: string;
        actor: string;
        status: string;
        timerMode: string;
        plannedDurationSeconds: number | null;
        isCurrent: boolean;
        creditedSeconds: number;
      };
    }).taskRun;
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
    const heartbeated = (heartbeat.json() as { taskRun: { note: string; leaseTtlSeconds: number } }).taskRun;
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
    assert.equal((focused.json() as { taskRun: { isCurrent: boolean } }).taskRun.isCurrent, true);

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
    const completedRun = (completed.json() as { taskRun: { status: string; completedAt: string | null } }).taskRun;
    assert.equal(completedRun.status, "completed");
    assert.ok(completedRun.completedAt);

    const taskContext = await app.inject({
      method: "GET",
      url: `/api/tasks/${taskId}/context`
    });
    assert.equal(taskContext.statusCode, 200);
    const taskContextBody = taskContext.json() as {
      task: { status: string; completedAt: string | null };
      activity: Array<{ entityType: string; eventType: string; actor: string | null }>;
    };

    assert.equal(taskContextBody.task.status, "done");
    assert.ok(taskContextBody.task.completedAt);
    assert.ok(
      taskContextBody.activity.some(
        (event) => event.entityType === "task" && event.eventType === "task_completed" && event.actor === "Aurel"
      )
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("task run conflicts return structured lease details for recovery", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-task-run-conflict-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    const taskId = (dashboard.json() as { tasks: Array<{ id: string }> }).tasks[0]!.id;

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
    const claimedRun = (claimed.json() as {
      taskRun: { id: string; actor: string; status: string; taskId: string; leaseTtlSeconds: number };
    }).taskRun;

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
      taskRun: { id: string; actor: string; status: string; taskId: string; leaseTtlSeconds: number };
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
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    const taskIds = (dashboard.json() as { tasks: Array<{ id: string }> }).tasks.slice(0, 3).map((task) => task.id);
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
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-task-run-inactive-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    const taskId = (dashboard.json() as { tasks: Array<{ id: string }> }).tasks[1]!.id;

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
    const recover = await app.inject({ method: "POST", url: "/api/task-runs/recover", payload: { limit: 10 } });
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
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-task-run-timeout-"));
  const app = await buildServer({ dataRoot: rootDir });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    const taskId = (dashboard.json() as { tasks: Array<{ id: string }> }).tasks[1]!.id;

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
    const timedOutRuns = (recovered.json() as { timedOutRuns: Array<{ id: string; status: string; timedOutAt: string | null }> }).timedOutRuns;
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
    const activeRuns = await app.inject({ method: "GET", url: "/api/task-runs?active=true" });
    const activePayload = activeRuns.json() as { taskRuns: Array<{ taskId: string; actor: string; status: string }> };
    assert.ok(activePayload.taskRuns.some((run) => run.taskId === taskId && run.actor === "Albert" && run.status === "active"));
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});


test("watchdog reconcile endpoint lets operators force recovery and inspect status", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-watchdog-reconcile-"));
  const app = await buildServer({
    dataRoot: rootDir,
    taskRunWatchdog: {
      intervalMs: 60_000
    }
  });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    const taskId = (dashboard.json() as { tasks: Array<{ id: string }> }).tasks[0]!.id;

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
      watchdog: { totalRecoveredCount: number; lastRecovery: { recoveredRunIds: string[] } | null };
    };
    assert.equal(reconcileBody.recovery.recoveredCount, 1);
    assert.deepEqual(reconcileBody.recovery.recoveredRunIds, [runId]);
    assert.equal(reconcileBody.watchdog.totalRecoveredCount, 1);
    assert.deepEqual(reconcileBody.watchdog.lastRecovery?.recoveredRunIds, [runId]);

    const runs = await app.inject({
      method: "GET",
      url: `/api/task-runs?taskId=${taskId}`
    });
    assert.equal(runs.statusCode, 200);
    const recoveredRun = (runs.json() as { taskRuns: Array<{ id: string; status: string; timedOutAt: string | null }> }).taskRuns.find(
      (entry) => entry.id === runId
    );
    assert.equal(recoveredRun?.status, "timed_out");
    assert.ok(recoveredRun?.timedOutAt);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});


test("v1 health reports degraded status when watchdog recovery fails", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-watchdog-health-"));
  let calls = 0;
  const app = await buildServer({
    dataRoot: rootDir,
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
        status: { consecutiveFailures: number; lastError: string | null } | null;
      };
    };
    assert.equal(payload.ok, false);
    assert.equal(payload.watchdog.enabled, true);
    assert.equal(payload.watchdog.healthy, false);
    assert.equal(payload.watchdog.state, "degraded");
    assert.equal(payload.watchdog.reason, "simulated watchdog failure");
    assert.equal(payload.watchdog.status?.consecutiveFailures, 1);
    assert.equal(payload.watchdog.status?.lastError, "simulated watchdog failure");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
