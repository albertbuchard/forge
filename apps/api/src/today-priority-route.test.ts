import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import { buildOpenApiDocument } from "./openapi.js";
import { todayPriorityDecisionSchema } from "./today-priority-types.js";
import { getRuntimeTimeZone } from "@/lib/date-keys.js";

const operatorCookie = issueTestOperatorSessionCookie;

test("Today priority route is authenticated, owner-scoped, and canonical", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-today-priority-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/v1/today/priority"
    });
    assert.equal(unauthenticated.statusCode, 401);

    const cookie = await operatorCookie(app);
    const projectsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: { cookie }
    });
    assert.equal(projectsResponse.statusCode, 200, projectsResponse.body);
    const projectId = (
      projectsResponse.json() as { projects: Array<{ id: string }> }
    ).projects[0]?.id;
    assert.ok(projectId);
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie },
      payload: {
        operations: [
          {
            entityType: "task",
            data: {
              title: "CANONICAL_TODAY_TASK",
              description: "A task used to verify the server decision.",
              status: "focus",
              priority: "critical",
              effort: "light",
              energy: "steady",
              projectId,
              userId: "user_operator"
            }
          },
          {
            entityType: "task",
            data: {
              title: "FOREIGN_TODAY_TASK_SENTINEL",
              description: "Must not enter the scoped decision.",
              status: "focus",
              priority: "critical",
              effort: "light",
              energy: "steady",
              projectId,
              userId: "user_forge_bot"
            }
          }
        ]
      }
    });
    assert.equal(createResponse.statusCode, 200, createResponse.body);
    const createResults = (
      createResponse.json() as {
        results: Array<{ ok: boolean; entity?: { id: string } }>;
      }
    ).results;
    assert.equal(
      createResults.every((result) => result.ok),
      true,
      JSON.stringify(createResults)
    );
    const taskId = createResults[0]?.entity?.id;
    assert.ok(taskId);

    const tokenResponse = await app.inject({
      method: "POST",
      url: "/api/v1/settings/tokens",
      headers: { cookie },
      payload: {
        label: "Today scoped reader",
        scopes: ["read", "write"],
        scopePolicy: {
          userIds: ["user_operator"],
          projectIds: [],
          tagIds: []
        }
      }
    });
    assert.equal(tokenResponse.statusCode, 201);
    const token = (tokenResponse.json() as { token: { token: string } }).token
      .token;
    const authorization = { authorization: `Bearer ${token}` };
    const runtimeTimeZone = encodeURIComponent(getRuntimeTimeZone());

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/today/priority?userIds=user_operator&timeZone=${runtimeTimeZone}&candidateLimit=5`,
      headers: authorization
    });
    assert.equal(response.statusCode, 200, response.body);
    const decision = todayPriorityDecisionSchema.parse(
      (response.json() as { decision: unknown }).decision
    );
    assert.equal(decision.contractVersion, 1);
    assert.equal(decision.decisionUserId, "user_operator");
    assert.ok(decision.rankedCandidates.length <= 5);
    assert.ok(
      decision.rankedCandidates.some(
        (candidate) => candidate.task.id === taskId
      )
    );
    assert.doesNotMatch(response.body, /FOREIGN_TODAY_TASK_SENTINEL/);

    const operatorContextResponse = await app.inject({
      method: "GET",
      url: "/api/v1/operator/context?userIds=user_operator",
      headers: authorization
    });
    assert.equal(
      operatorContextResponse.statusCode,
      200,
      operatorContextResponse.body
    );
    const operatorContext = operatorContextResponse.json() as {
      context: { recommendedNextTask: { id: string } | null };
    };
    assert.equal(
      operatorContext.context.recommendedNextTask?.id ?? null,
      decision.task?.id ?? null
    );

    const forbiddenScope = await app.inject({
      method: "GET",
      url: "/api/v1/today/priority?userIds=user_forge_bot&timeZone=UTC",
      headers: authorization
    });
    assert.equal(forbiddenScope.statusCode, 403);
    assert.doesNotMatch(forbiddenScope.body, /FOREIGN_TODAY_TASK_SENTINEL/);

    const invalidTimeZone = await app.inject({
      method: "GET",
      url: "/api/v1/today/priority?userIds=user_operator&timeZone=not-a-timezone",
      headers: authorization
    });
    assert.equal(invalidTimeZone.statusCode, 400);
    assert.match(invalidTimeZone.body, /valid IANA timezone/i);

    const startResponse = await app.inject({
      method: "POST",
      url: `/api/v1/tasks/${taskId}/runs`,
      headers: authorization,
      payload: { actor: "today-route-test", timerMode: "unlimited" }
    });
    assert.equal(startResponse.statusCode, 201, startResponse.body);

    const activeResponse = await app.inject({
      method: "GET",
      url: `/api/v1/today/priority?userIds=user_operator&timeZone=${runtimeTimeZone}`,
      headers: authorization
    });
    assert.equal(activeResponse.statusCode, 200, activeResponse.body);
    const activeDecision = todayPriorityDecisionSchema.parse(
      (activeResponse.json() as { decision: unknown }).decision
    );
    assert.equal(activeDecision.mode, "continue-active");
    assert.equal(activeDecision.task?.id, taskId);
    assert.equal(activeDecision.activeRun?.taskId, taskId);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("operator context does not recommend blocked work when Today has no startable task", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "forge-today-priority-blocked-")
  );
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const cookie = await operatorCookie(app);
    const goalResponse = await app.inject({
      method: "POST",
      url: "/api/v1/goals",
      headers: { cookie },
      payload: {
        title: "Blocked-only goal",
        description: "Goal used to verify honest Today stop states.",
        horizon: "quarter",
        status: "active",
        targetPoints: 100,
        userId: "user_operator"
      }
    });
    assert.equal(goalResponse.statusCode, 201, goalResponse.body);
    const goalId = (goalResponse.json() as { goal: { id: string } }).goal.id;
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { cookie },
      payload: {
        goalId,
        title: "Blocked-only project",
        description: "Project used to verify honest Today stop states.",
        status: "active",
        targetPoints: 100,
        themeColor: "#5577cc",
        userId: "user_operator"
      }
    });
    assert.equal(projectResponse.statusCode, 201, projectResponse.body);
    const projectId = (projectResponse.json() as { project: { id: string } })
      .project.id;
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: { cookie },
      payload: {
        projectId,
        title: "Blocked work is not a recommendation",
        description: "This task must remain visible without being recommended.",
        status: "blocked",
        priority: "critical",
        effort: "light",
        energy: "steady",
        userId: "user_operator"
      }
    });
    assert.equal(createResponse.statusCode, 201, createResponse.body);

    const priorityResponse = await app.inject({
      method: "GET",
      url: "/api/v1/today/priority?userIds=user_operator&timeZone=UTC",
      headers: { cookie }
    });
    assert.equal(priorityResponse.statusCode, 200, priorityResponse.body);
    const decision = todayPriorityDecisionSchema.parse(
      (priorityResponse.json() as { decision: unknown }).decision
    );
    assert.equal(decision.mode, "no-work");
    assert.equal(decision.task, null);
    assert.equal(decision.blockedTaskCount, 1);

    const operatorContextResponse = await app.inject({
      method: "GET",
      url: "/api/v1/operator/context?userIds=user_operator",
      headers: { cookie }
    });
    assert.equal(
      operatorContextResponse.statusCode,
      200,
      operatorContextResponse.body
    );
    const operatorContext = operatorContextResponse.json() as {
      context: { recommendedNextTask: { id: string } | null };
    };
    assert.equal(operatorContext.context.recommendedNextTask, null);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("OpenAPI publishes the bounded Today priority decision contract", () => {
  const document = buildOpenApiDocument() as unknown as {
    components: {
      schemas: Record<
        string,
        {
          required?: string[];
          properties?: Record<string, unknown>;
        }
      >;
    };
    paths: {
      "/api/v1/today/priority": {
        get: {
          parameters: Array<{
            name: string;
            schema: { maximum?: number; default?: number };
          }>;
          responses: {
            "400": { $ref: string };
            "200": {
              content: {
                "application/json": {
                  schema: {
                    properties: { decision: { $ref: string } };
                  };
                };
              };
            };
          };
        };
      };
    };
  };

  const operation = document.paths["/api/v1/today/priority"].get;
  const candidateLimit = operation.parameters.find(
    (parameter) => parameter.name === "candidateLimit"
  );
  assert.equal(candidateLimit?.schema.maximum, 100);
  assert.equal(candidateLimit?.schema.default, 24);
  assert.equal(operation.responses["400"].$ref, "#/components/responses/Error");
  assert.equal(
    operation.responses["200"].content["application/json"].schema.properties
      .decision.$ref,
    "#/components/schemas/TodayPriorityDecision"
  );
  assert.ok(
    document.components.schemas.TodayPriorityDecision.required?.includes(
      "contractVersion"
    )
  );
  assert.ok(
    document.components.schemas.TodayRankedCandidate.properties?.evidence
  );
});
