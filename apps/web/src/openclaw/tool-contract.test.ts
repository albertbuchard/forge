import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calendarOverviewQuerySchema,
  createCalendarConnectionSchema
} from "../../../../apps/api/src/types";
import {
  AGENT_ONBOARDING_TOOL_INPUT_CATALOG,
  buildServer
} from "../../../../apps/api/src/app";
import { buildOpenApiDocument } from "../../../../apps/api/src/openapi";
import {
  enqueueEntityPreferenceItemSchema,
  mergePreferenceContextsSchema,
  preferenceDomainSchema,
  preferenceItemStatusSchema,
  preferenceJudgmentOutcomeSchema,
  preferenceSignalTypeSchema,
  startPreferenceGameSchema,
  submitAbsoluteSignalSchema,
  submitPairwiseJudgmentSchema,
  updatePreferenceScoreSchema
} from "../../../../apps/api/src/preferences-types";
import { collectSupportedPluginApiRouteKeys, makeApiRouteKey } from "./parity";
import { collectMirroredApiRouteKeys } from "./routes";
import { callConfiguredForgeApi } from "./api-client";
import { registerForgePluginTools } from "./tools";

vi.mock("./api-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api-client.js")>();
  return {
    ...actual,
    callConfiguredForgeApi: vi.fn()
  };
});

type RegisteredTool = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  execute?: (toolCallId: string, params: unknown) => Promise<unknown>;
};

const TEST_CONFIG = {
  origin: "http://127.0.0.1",
  port: 4317,
  baseUrl: "http://127.0.0.1:4317",
  webAppUrl: "http://127.0.0.1:4317/forge/",
  portSource: "default",
  dataRoot: "",
  apiToken: "fg_live_test",
  actorLabel: "aurel",
  injectBootstrapContext: true,
  timeoutMs: 15000
} as const;

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

async function loadOnboardingRouteContracts() {
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), "forge-tool-contract-"));
  tempRoots.push(dataRoot);
  const app = await buildServer({ dataRoot, taskRunWatchdog: false });
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/agents/onboarding"
  });
  expect(response.statusCode).toBe(200);
  await app.close();

  const surfaces = response.json().onboarding.entityRouteModel
    .specializedDomainSurfaces as Record<
    string,
    { routeKeys: string[]; methodRoutes: Record<string, string> }
  >;
  const specializedCrudEntities = response.json().onboarding.entityRouteModel
    .specializedCrudEntities as Record<
    string,
    {
      routeKeys?: string[];
      methodRoutes?: Record<string, string | { method: string; path: string }>;
    }
  >;
  const artifactMethodRoutes = Object.fromEntries(
    Object.entries(specializedCrudEntities.artifact?.methodRoutes ?? {}).map(
      ([routeKey, route]) => [
        routeKey,
        typeof route === "string" ? route : `${route.method} ${route.path}`
      ]
    )
  );
  const calendarConnectionMethodRoutes = Object.fromEntries(
    Object.entries(
      specializedCrudEntities.calendar_connection?.methodRoutes ?? {}
    ).map(([routeKey, route]) => [
      routeKey,
      typeof route === "string" ? route : `${route.method} ${route.path}`
    ])
  );
  const wikiMethodRoutes = Object.fromEntries(
    Object.entries(specializedCrudEntities.wiki_page?.methodRoutes ?? {}).map(
      ([routeKey, route]) => [
        routeKey,
        typeof route === "string" ? route : `${route.method} ${route.path}`
      ]
    )
  );
  return {
    attention: surfaces.attention,
    entityNavigation: surfaces.entityNavigation,
    movement: surfaces.movement,
    lifeForce: surfaces.lifeForce,
    workbench: surfaces.workbench,
    courses: surfaces.courses,
    lifeEvents: surfaces.lifeEvents,
    calendarConnection: {
      routeKeys: specializedCrudEntities.calendar_connection?.routeKeys ?? [],
      methodRoutes: calendarConnectionMethodRoutes
    },
    wiki: {
      routeKeys: specializedCrudEntities.wiki_page?.routeKeys ?? [],
      methodRoutes: wikiMethodRoutes
    },
    artifact: {
      routeKeys: specializedCrudEntities.artifact?.routeKeys ?? [],
      methodRoutes: artifactMethodRoutes
    }
  };
}

function collectRegisteredTools(apiToken: string = TEST_CONFIG.apiToken) {
  const tools: RegisteredTool[] = [];
  registerForgePluginTools(
    {
      registerTool(tool: unknown) {
        if (typeof tool === "function") {
          return;
        }
        tools.push(tool as RegisteredTool);
      }
    } as never,
    { ...TEST_CONFIG, apiToken }
  );
  return tools;
}

function requireTool(tools: RegisteredTool[], name: string) {
  const tool = tools.find((entry) => entry.name === name);
  expect(tool, `Expected tool ${name} to be registered`).toBeDefined();
  return tool as RegisteredTool;
}

const mockedCallConfiguredForgeApi = vi.mocked(callConfiguredForgeApi);

describe("batch entity tool contract", () => {
  it("matches server operation bounds, search limit, and retry fields", () => {
    const tools = collectRegisteredTools();
    const expected = {
      forge_create_entities: ["operations", 100],
      forge_update_entities: ["operations", 100],
      forge_delete_entities: ["operations", 100],
      forge_restore_entities: ["operations", 100],
      forge_search_entities: ["searches", 50]
    } as const;

    for (const [toolName, [arrayName, maxItems]] of Object.entries(expected)) {
      const schema = requireTool(tools, toolName).parameters as {
        properties: Record<
          string,
          {
            minItems?: number;
            maxItems?: number;
            items?: { properties?: Record<string, Record<string, unknown>> };
          }
        >;
      };
      expect(schema.properties[arrayName]?.minItems).toBe(1);
      expect(schema.properties[arrayName]?.maxItems).toBe(maxItems);
    }

    const create = requireTool(tools, "forge_create_entities").parameters as {
      properties: {
        operations: {
          items: { properties: { idempotencyKey: { maxLength: number } } };
        };
      };
    };
    expect(
      create.properties.operations.items.properties.idempotencyKey.maxLength
    ).toBe(128);

    const search = requireTool(tools, "forge_search_entities").parameters as {
      properties: {
        searches: {
          items: {
            properties: {
              limit: { maximum: number };
              userIds: { type: string; items: { type: string } };
            };
          };
        };
      };
    };
    expect(search.properties.searches.items.properties.limit.maximum).toBe(200);
    expect(search.properties.searches.items.properties.userIds).toMatchObject({
      type: "array",
      items: { type: "string" }
    });
  });
});

describe("work block template helper contract", () => {
  it("matches the server minimum while keeping recurrence details optional", async () => {
    mockedCallConfiguredForgeApi.mockReset();
    mockedCallConfiguredForgeApi.mockResolvedValue({
      status: 201,
      body: { template: { id: "work_block_123" } }
    });
    const tool = requireTool(
      collectRegisteredTools(""),
      "forge_create_work_block_template"
    );
    const schema = tool.parameters as {
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties?: boolean;
    };

    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual([
      "title",
      "weekDays",
      "startMinute",
      "endMinute"
    ]);
    expect(Object.keys(schema.properties).sort()).toEqual(
      [
        "title",
        "kind",
        "color",
        "timezone",
        "weekDays",
        "startMinute",
        "endMinute",
        "startsOn",
        "endsOn",
        "exclusionDates",
        "blockingState",
        "activityPresetKey",
        "customSustainRateApPerHour",
        "userId"
      ].sort()
    );

    const payload = {
      title: "Protected writing",
      weekDays: [1, 3],
      startMinute: 1320,
      endMinute: 60
    };
    await tool.execute?.("create", payload);
    expect(mockedCallConfiguredForgeApi).toHaveBeenCalledWith(
      expect.objectContaining({ apiToken: "" }),
      {
        method: "POST",
        path: "/api/v1/calendar/work-block-templates",
        body: payload
      }
    );
  });
});

describe("task timebox recommendation tool contract", () => {
  it("is a read-only POST with the server limit and timezone payload", async () => {
    mockedCallConfiguredForgeApi.mockReset();
    mockedCallConfiguredForgeApi.mockResolvedValue({
      status: 200,
      body: { suggestions: [] }
    });

    const tool = requireTool(
      collectRegisteredTools(""),
      "forge_recommend_task_timeboxes"
    );
    const schema = tool.parameters as {
      properties: {
        limit: { maximum: number };
        timezone: { anyOf?: unknown[]; type?: string };
      };
    };
    expect(schema.properties.limit.maximum).toBe(12);
    expect(schema.properties.timezone).toBeDefined();

    await tool.execute?.("recommend", {
      taskId: "task_123",
      from: "2026-07-16T08:00:00.000Z",
      to: "2026-07-16T18:00:00.000Z",
      limit: 12,
      timezone: "Europe/Zurich"
    });

    expect(mockedCallConfiguredForgeApi).toHaveBeenCalledWith(
      expect.objectContaining({ apiToken: "" }),
      {
        method: "POST",
        path: "/api/v1/calendar/timeboxes/recommend",
        body: {
          taskId: "task_123",
          from: "2026-07-16T08:00:00.000Z",
          to: "2026-07-16T18:00:00.000Z",
          limit: 12,
          timezone: "Europe/Zurich"
        }
      }
    );
  });

  it("keeps direct create aligned with the closed server mutation contract", async () => {
    mockedCallConfiguredForgeApi.mockReset();
    mockedCallConfiguredForgeApi.mockResolvedValue({
      status: 201,
      body: { timebox: { id: "timebox_123" } }
    });
    const tool = requireTool(
      collectRegisteredTools(""),
      "forge_create_task_timebox"
    );
    const schema = tool.parameters as {
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties?: boolean;
    };
    expect(schema.required).toEqual(["taskId", "title", "startsAt", "endsAt"]);
    expect(Object.keys(schema.properties).sort()).toEqual(
      [
        "taskId",
        "projectId",
        "title",
        "startsAt",
        "endsAt",
        "source",
        "status",
        "overrideReason",
        "activityPresetKey",
        "customSustainRateApPerHour",
        "userId"
      ].sort()
    );
    expect(
      readTypeBoxUnionValues(
        tool.parameters as Record<string, unknown>,
        "status"
      )
    ).toEqual(["active", "cancelled", "completed", "planned"]);
    expect(
      readTypeBoxUnionValues(
        tool.parameters as Record<string, unknown>,
        "activityPresetKey"
      )
    ).toEqual(
      [
        "deep_work",
        "admin",
        "maintenance",
        "meeting",
        "recovery_break",
        "holiday_leisure",
        "light_context",
        "task_inherited"
      ].sort()
    );

    const payload = {
      taskId: "task_123",
      projectId: "project_123",
      title: "Focused block",
      startsAt: "2026-07-16T08:00:00.000Z",
      endsAt: "2026-07-16T09:00:00.000Z",
      source: "suggested",
      status: "planned",
      overrideReason: "Deadline protection",
      activityPresetKey: "deep_work",
      customSustainRateApPerHour: 15,
      userId: "user_123"
    };
    await tool.execute?.("create", payload);
    expect(mockedCallConfiguredForgeApi).toHaveBeenCalledWith(
      expect.objectContaining({ apiToken: "" }),
      {
        method: "POST",
        path: "/api/v1/calendar/timeboxes",
        body: payload
      }
    );
  });
});

describe("task-run closeout tool contract", () => {
  it("matches the bounded completion body and keeps release evidence-free", () => {
    const tools = collectRegisteredTools();
    const complete = requireTool(tools, "forge_complete_task_run");
    const release = requireTool(tools, "forge_release_task_run");
    const completeSchema = complete.parameters as {
      additionalProperties?: boolean;
      required?: string[];
      properties: Record<string, Record<string, unknown>>;
    };
    const releaseSchema = release.parameters as {
      additionalProperties?: boolean;
      required?: string[];
      properties: Record<string, Record<string, unknown>>;
    };

    expect(completeSchema.additionalProperties).toBe(false);
    expect(completeSchema.required).toEqual(["taskRunId"]);
    expect(Object.keys(completeSchema.properties).sort()).toEqual(
      [
        "taskRunId",
        "actor",
        "note",
        "completionReport",
        "gitRefs",
        "closeoutNote"
      ].sort()
    );
    expect(releaseSchema.additionalProperties).toBe(false);
    expect(releaseSchema.required).toEqual(["taskRunId"]);
    expect(Object.keys(releaseSchema.properties).sort()).toEqual(
      ["taskRunId", "actor", "note", "closeoutNote"].sort()
    );
    expect(completeSchema.properties.actor).toMatchObject({
      type: "string",
      minLength: 1,
      maxLength: 160
    });
    expect(completeSchema.properties.note).toMatchObject({
      type: "string",
      maxLength: 4_000
    });
    expect(releaseSchema.properties.actor).toEqual(
      completeSchema.properties.actor
    );
    expect(releaseSchema.properties.note).toEqual(
      completeSchema.properties.note
    );

    const report = completeSchema.properties.completionReport as {
      additionalProperties?: boolean;
      properties: Record<string, Record<string, unknown>>;
    };
    expect(report.additionalProperties).toBe(false);
    expect(Object.keys(report.properties).sort()).toEqual(
      ["modifiedFiles", "workSummary", "linkedGitRefIds"].sort()
    );
    expect(report.properties.modifiedFiles).toMatchObject({
      type: "array",
      maxItems: 256,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 512 }
    });
    expect(report.properties.workSummary).toMatchObject({
      type: "string",
      maxLength: 8_000,
      default: ""
    });
    expect(report.properties.linkedGitRefIds).toMatchObject({
      type: "array",
      maxItems: 64,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 128 }
    });

    const gitRefs = completeSchema.properties.gitRefs as {
      maxItems?: number;
      items: {
        additionalProperties?: boolean;
        required?: string[];
        properties: Record<string, Record<string, unknown>>;
      };
    };
    expect(gitRefs.maxItems).toBe(64);
    expect(gitRefs.items.additionalProperties).toBe(false);
    expect(gitRefs.items.required).toEqual(["refType", "refValue"]);
    expect(Object.keys(gitRefs.items.properties).sort()).toEqual(
      [
        "id",
        "refType",
        "provider",
        "repository",
        "refValue",
        "url",
        "displayTitle"
      ].sort()
    );
    expect(gitRefs.items.properties.id).toMatchObject({
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"
    });
    expect(
      readTypeBoxUnionValues(
        gitRefs.items as unknown as Record<string, unknown>,
        "refType"
      )
    ).toEqual(["branch", "commit", "pull_request"]);
    expect(gitRefs.items.properties.provider).toMatchObject({
      type: "string",
      maxLength: 64,
      default: "git"
    });
    expect(gitRefs.items.properties.repository).toMatchObject({
      type: "string",
      maxLength: 255,
      default: ""
    });
    expect(gitRefs.items.properties.refValue).toMatchObject({
      type: "string",
      minLength: 1,
      maxLength: 512
    });
    expect(gitRefs.items.properties.url).toMatchObject({
      anyOf: [
        {
          type: "string",
          format: "uri",
          pattern: "^https?://",
          maxLength: 2_048
        },
        { type: "null" }
      ]
    });
    expect(gitRefs.items.properties.displayTitle).toMatchObject({
      type: "string",
      maxLength: 512,
      default: ""
    });

    const openApi = buildOpenApiDocument() as {
      components: {
        schemas: Record<
          string,
          { properties?: Record<string, Record<string, unknown>> }
        >;
      };
    };
    expect(
      Object.keys(
        openApi.components.schemas.TaskRunCompleteInput.properties ?? {}
      ).sort()
    ).toEqual(
      Object.keys(completeSchema.properties)
        .filter((key) => key !== "taskRunId")
        .sort()
    );
    expect(
      Object.keys(
        openApi.components.schemas.TaskRunReleaseInput.properties ?? {}
      ).sort()
    ).toEqual(
      Object.keys(releaseSchema.properties)
        .filter((key) => key !== "taskRunId")
        .sort()
    );
    expect(complete.description).toMatch(
      /exact terminal replay is idempotent/i
    );
    expect(complete.description).toMatch(
      /changed closeout evidence conflicts/i
    );
    expect(complete.description).toMatch(/closeoutState deferred/i);
    expect(release.description).toMatch(
      /never accepts completionReport or gitRefs/i
    );
  });

  it("forwards every completion field and only release fields", async () => {
    mockedCallConfiguredForgeApi.mockReset();
    mockedCallConfiguredForgeApi.mockResolvedValue({
      status: 200,
      body: { taskRun: { id: "run_123" } }
    });
    const tools = collectRegisteredTools();
    const complete = requireTool(tools, "forge_complete_task_run");
    const release = requireTool(tools, "forge_release_task_run");
    const completionBody = {
      actor: "Albert",
      note: "Completed",
      completionReport: {
        modifiedFiles: ["apps/web/src/openclaw/tools.ts"],
        workSummary: "Forwarded the complete PLAN-17 evidence contract.",
        linkedGitRefIds: ["commit_abc123"]
      },
      gitRefs: [
        {
          id: "commit_abc123",
          refType: "commit",
          provider: "github",
          repository: "albertbuchard/forge",
          refValue: "abc123",
          url: "https://github.com/albertbuchard/forge/commit/abc123",
          displayTitle: "PLAN-17 closeout"
        }
      ],
      closeoutNote: {
        contentMarkdown: "Closeout evidence is linked to the task.",
        tags: ["closeout"]
      }
    };

    await complete.execute?.("complete", {
      taskRunId: "run_123",
      ...completionBody
    });
    expect(mockedCallConfiguredForgeApi).toHaveBeenLastCalledWith(
      expect.objectContaining({ apiToken: TEST_CONFIG.apiToken }),
      {
        method: "POST",
        path: "/api/v1/task-runs/run_123/complete",
        body: completionBody
      }
    );

    const releaseBody = {
      actor: "Albert",
      note: "Paused for review",
      closeoutNote: { contentMarkdown: "Resume after review." }
    };
    await release.execute?.("release", {
      taskRunId: "run_123",
      ...releaseBody
    });
    expect(mockedCallConfiguredForgeApi).toHaveBeenLastCalledWith(
      expect.objectContaining({ apiToken: TEST_CONFIG.apiToken }),
      {
        method: "POST",
        path: "/api/v1/task-runs/run_123/release",
        body: releaseBody
      }
    );
  });
});

function readTypeBoxUnionValues(schema: Record<string, unknown>, key: string) {
  const property = (schema.properties as Record<string, unknown> | undefined)?.[
    key
  ] as
    | {
        anyOf?: Array<{ const?: string }>;
      }
    | undefined;
  return (property?.anyOf ?? [])
    .map((entry) => entry.const)
    .filter((value): value is string => typeof value === "string")
    .sort();
}

function readPropertyDescription(schema: Record<string, unknown>, key: string) {
  const property = (schema.properties as Record<string, unknown> | undefined)?.[
    key
  ] as { description?: string } | undefined;
  return property?.description ?? "";
}

function readRouteGuideFromDescription(description: string) {
  const guide = /Exact routes: ([\s\S]+?)\. For any /.exec(description)?.[1];
  expect(
    guide,
    "routeKey description should publish exact route guide"
  ).toBeTruthy();

  return Object.fromEntries(
    guide!.split("; ").map((entry) => {
      const match = /^([^:]+):\s+([A-Z]+)\s+(\/api\/v1\/\S+)$/.exec(entry);
      expect(
        match,
        `route guide entry should be parseable: ${entry}`
      ).toBeTruthy();
      return [match![1], `${match![2]} ${match![3]}`];
    })
  );
}

function readHermesRouteSpecs(constantName: string) {
  const source = readFileSync(
    path.join(repoRoot, "plugins/hermes/forge_hermes/catalog.py"),
    "utf8"
  );
  const start = source.indexOf(`${constantName}:`);
  expect(
    start,
    `${constantName} should exist in Hermes catalog`
  ).toBeGreaterThanOrEqual(0);
  const bodyStart = source.indexOf("{", start);
  expect(
    bodyStart,
    `${constantName} should open a dict`
  ).toBeGreaterThanOrEqual(0);

  let depth = 0;
  let bodyEnd = -1;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        bodyEnd = index;
        break;
      }
    }
  }
  expect(bodyEnd, `${constantName} should close its dict`).toBeGreaterThan(
    bodyStart
  );

  const body = source.slice(bodyStart, bodyEnd + 1);
  return Object.fromEntries(
    [
      ...body.matchAll(
        /"([^"]+)":\s*\{\s*"method":\s*"([A-Z]+)",\s*"path":\s*"([^"]+)"/g
      )
    ].map((match) => [match[1], `${match[2]} ${match[3]}`])
  );
}

function readHermesCatalogToolNames() {
  const source = readFileSync(
    path.join(repoRoot, "plugins/hermes/forge_hermes/catalog.py"),
    "utf8"
  );
  const start = source.indexOf("TOOL_CATALOG");
  expect(start, "Hermes TOOL_CATALOG should exist").toBeGreaterThanOrEqual(0);
  return [...source.slice(start).matchAll(/"name":\s*"([^"]+)"/g)]
    .map((match) => match[1])
    .sort();
}

function readHermesManifestToolNames() {
  const source = readFileSync(
    path.join(repoRoot, "plugins/hermes/plugin.yaml"),
    "utf8"
  );
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "provides_tools:");
  expect(
    start,
    "Hermes plugin.yaml should list provides_tools"
  ).toBeGreaterThanOrEqual(0);
  const tools: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("  - ")) {
      tools.push(line.slice(4).trim());
      continue;
    }
    if (line.trim() && !line.startsWith(" ")) {
      break;
    }
  }
  return tools.sort();
}

describe("openclaw tool contracts", () => {
  it("keeps every onboarding input guide callable in both OpenClaw and Hermes", () => {
    const openclawToolNames = new Set(
      collectRegisteredTools().map((tool) => tool.name)
    );
    const hermesToolNames = new Set(readHermesCatalogToolNames());

    for (const guide of AGENT_ONBOARDING_TOOL_INPUT_CATALOG) {
      for (const toolName of guide.toolName.split(" | ")) {
        expect(
          openclawToolNames.has(toolName),
          `${toolName} should be registered by OpenClaw`
        ).toBe(true);
        expect(
          hermesToolNames.has(toolName),
          `${toolName} should be registered by Hermes`
        ).toBe(true);
      }
    }
  });

  it("reads the bounded canonical Today decision with explicit scope and timezone", async () => {
    mockedCallConfiguredForgeApi.mockReset();
    mockedCallConfiguredForgeApi.mockResolvedValue({
      status: 200,
      body: { decision: { contractVersion: 1, mode: "ready" } }
    });
    const tool = requireTool(
      collectRegisteredTools(""),
      "forge_get_today_priority"
    );
    const schema = tool.parameters as {
      properties: {
        timeZone: { maxLength: number };
        candidateLimit: {
          minimum: number;
          maximum: number;
          default: number;
        };
      };
    };
    expect(schema.properties.timeZone.maxLength).toBe(100);
    expect(schema.properties.candidateLimit).toMatchObject({
      minimum: 1,
      maximum: 100,
      default: 24
    });

    await tool.execute?.("today", {
      userIds: ["user_operator", "user_coach"],
      timeZone: "Europe/Zurich",
      candidateLimit: 12
    });

    expect(mockedCallConfiguredForgeApi).toHaveBeenCalledWith(
      expect.objectContaining({ apiToken: "" }),
      {
        method: "GET",
        path: "/api/v1/today/priority?userIds=user_operator&userIds=user_coach&timeZone=Europe%2FZurich&candidateLimit=12"
      }
    );
  });

  it("keeps current-work and calendar tools backed by mirrored curated routes", () => {
    const supportedRoutes = collectSupportedPluginApiRouteKeys();
    const mirroredRoutes = collectMirroredApiRouteKeys();
    const expectedToolRoutes = [
      makeApiRouteKey("GET", "/api/v1/operator/context"),
      makeApiRouteKey("GET", "/api/v1/today/priority"),
      makeApiRouteKey("GET", "/api/v1/calendar/overview"),
      makeApiRouteKey("POST", "/api/v1/calendar/connections"),
      makeApiRouteKey("POST", "/api/v1/calendar/connections/:id/sync"),
      makeApiRouteKey("POST", "/api/v1/calendar/work-block-templates"),
      makeApiRouteKey("POST", "/api/v1/calendar/timeboxes/recommend"),
      makeApiRouteKey("POST", "/api/v1/calendar/timeboxes")
    ];

    expect(
      expectedToolRoutes.every((route) => supportedRoutes.has(route))
    ).toBe(true);
    expect(expectedToolRoutes.every((route) => mirroredRoutes.has(route))).toBe(
      true
    );
  });

  it("matches the backend calendar overview query contract", () => {
    const tools = collectRegisteredTools();
    const calendarOverview = requireTool(tools, "forge_get_calendar_overview");
    const parameterProperties = Object.keys(
      (calendarOverview.parameters?.properties as Record<string, unknown>) ?? {}
    ).sort();
    const backendProperties = Object.keys(
      calendarOverviewQuerySchema.shape
    ).sort();

    expect(parameterProperties).toEqual(backendProperties);
  });

  it("matches the backend calendar provider enum and requires selected calendars", () => {
    const tools = collectRegisteredTools();
    const connectCalendar = requireTool(
      tools,
      "forge_connect_calendar_provider"
    );
    const providerValues = readTypeBoxUnionValues(
      connectCalendar.parameters ?? {},
      "provider"
    );
    const backendProviderValues = createCalendarConnectionSchema.options
      .map((option) => option.shape.provider.value)
      .sort();
    const required = Array.isArray(connectCalendar.parameters?.required)
      ? [...connectCalendar.parameters.required].sort()
      : [];

    expect(providerValues).toEqual(backendProviderValues);
    expect(required).toEqual(["label", "provider", "selectedCalendarUrls"]);
  });

  it("keeps the preference-context merge body aligned across server, OpenAPI, and plugins", () => {
    const tools = collectRegisteredTools();
    const mergeContexts = requireTool(
      tools,
      "forge_merge_preferences_contexts"
    );
    const expectedFields = Object.keys(
      mergePreferenceContextsSchema.shape
    ).sort();
    const toolFields = Object.keys(
      (mergeContexts.parameters?.properties as Record<string, unknown>) ?? {}
    ).sort();
    const toolRequired = Array.isArray(mergeContexts.parameters?.required)
      ? [...mergeContexts.parameters.required].sort()
      : [];

    const openApi = buildOpenApiDocument() as {
      paths: Record<
        string,
        {
          post?: {
            requestBody?: {
              content?: Record<
                string,
                {
                  schema?: {
                    properties?: Record<string, unknown>;
                    required?: string[];
                  };
                }
              >;
            };
          };
        }
      >;
    };
    const openApiSchema =
      openApi.paths["/api/v1/preferences/contexts/merge"]?.post?.requestBody
        ?.content?.["application/json"]?.schema;
    const openApiFields = Object.keys(openApiSchema?.properties ?? {}).sort();

    expect(toolFields).toEqual(expectedFields);
    expect(toolRequired).toEqual(expectedFields);
    expect(openApiFields).toEqual(expectedFields);
    expect([...(openApiSchema?.required ?? [])].sort()).toEqual(expectedFields);
    expect(mergeContexts.description).toMatch(/one source[\s\S]*one target/i);

    const toolInputGuide = AGENT_ONBOARDING_TOOL_INPUT_CATALOG.find(
      (entry) => entry.toolName === "forge_merge_preferences_contexts"
    );
    expect(toolInputGuide?.inputShape).toBe(
      "{ sourceContextId: string, targetContextId: string }"
    );
    expect(toolInputGuide?.requiredFields).toEqual([
      "sourceContextId",
      "targetContextId"
    ]);
    expect(toolInputGuide?.notes.join(" ")).toMatch(
      /judgments and signals[\s\S]*deactivates the source[\s\S]*recomputes the target/i
    );

    const hermesCatalog = readFileSync(
      path.join(repoRoot, "plugins/hermes/forge_hermes/catalog.py"),
      "utf8"
    );
    const hermesMergeStart = hermesCatalog.indexOf(
      '"name": "forge_merge_preferences_contexts"'
    );
    const hermesMergeEnd = hermesCatalog.indexOf(
      '"name": "forge_enqueue_preferences_item_from_entity"',
      hermesMergeStart
    );
    const hermesMergeBlock = hermesCatalog.slice(
      hermesMergeStart,
      hermesMergeEnd
    );
    expect(hermesMergeBlock).toMatch(/sourceContextId/);
    expect(hermesMergeBlock).toMatch(/targetContextId/);
    expect(hermesMergeBlock).not.toMatch(/sourceContextIds/);
  });

  it("keeps every Preferences action body aligned across server, OpenAPI, onboarding, and plugins", () => {
    const tools = collectRegisteredTools();
    type OpenApiActionSchema = {
      $ref?: string;
      properties?: Record<
        string,
        { enum?: string[]; anyOf?: Array<{ const?: string }> }
      >;
      required?: string[];
    };
    const openApi = buildOpenApiDocument() as {
      components: { schemas: Record<string, OpenApiActionSchema> };
      paths: Record<
        string,
        Record<
          string,
          {
            requestBody?: {
              content?: Record<
                string,
                {
                  schema?: OpenApiActionSchema;
                }
              >;
            };
          }
        >
      >;
    };
    const resolveOpenApiSchema = (schema: OpenApiActionSchema | undefined) => {
      const referencedSchemaName = schema?.$ref?.replace(
        "#/components/schemas/",
        ""
      );
      return referencedSchemaName
        ? openApi.components.schemas[referencedSchemaName]
        : schema;
    };
    const contracts = [
      {
        toolName: "forge_start_preferences_game",
        method: "post",
        path: "/api/v1/preferences/game/start",
        schema: startPreferenceGameSchema,
        pathFields: [] as string[]
      },
      {
        toolName: "forge_enqueue_preferences_item_from_entity",
        method: "post",
        path: "/api/v1/preferences/items/from-entity",
        schema: enqueueEntityPreferenceItemSchema,
        pathFields: [] as string[]
      },
      {
        toolName: "forge_submit_preferences_judgment",
        method: "post",
        path: "/api/v1/preferences/judgments",
        schema: submitPairwiseJudgmentSchema,
        pathFields: [] as string[]
      },
      {
        toolName: "forge_submit_preferences_signal",
        method: "post",
        path: "/api/v1/preferences/signals",
        schema: submitAbsoluteSignalSchema,
        pathFields: [] as string[]
      },
      {
        toolName: "forge_update_preferences_score",
        method: "patch",
        path: "/api/v1/preferences/items/{id}/score",
        schema: updatePreferenceScoreSchema,
        pathFields: ["itemId"]
      }
    ] as const;

    for (const contract of contracts) {
      const shape = contract.schema.shape as Record<
        string,
        { isOptional: () => boolean }
      >;
      const bodyFields = Object.keys(shape).sort();
      const bodyRequired = Object.entries(shape)
        .filter(([, field]) => !field.isOptional())
        .map(([name]) => name)
        .sort();
      const expectedToolFields = [...bodyFields, ...contract.pathFields].sort();
      const expectedToolRequired = [
        ...bodyRequired,
        ...contract.pathFields
      ].sort();
      const tool = requireTool(tools, contract.toolName);
      const toolFields = Object.keys(
        (tool.parameters?.properties as Record<string, unknown>) ?? {}
      ).sort();
      const toolRequired = Array.isArray(tool.parameters?.required)
        ? [...tool.parameters.required].sort()
        : [];
      const requestSchema =
        openApi.paths[contract.path]?.[contract.method]?.requestBody?.content?.[
          "application/json"
        ]?.schema;
      const openApiSchema = resolveOpenApiSchema(requestSchema);

      expect(toolFields, `${contract.toolName} fields`).toEqual(
        expectedToolFields
      );
      expect(toolRequired, `${contract.toolName} required`).toEqual(
        expectedToolRequired
      );
      expect(
        Object.keys(openApiSchema?.properties ?? {}).sort(),
        `${contract.path} OpenAPI fields`
      ).toEqual(bodyFields);
      expect(
        [...(openApiSchema?.required ?? [])].sort(),
        `${contract.path} OpenAPI required`
      ).toEqual(bodyRequired);

      const toolInputGuide = AGENT_ONBOARDING_TOOL_INPUT_CATALOG.find(
        (entry) => entry.toolName === contract.toolName
      );
      expect(
        toolInputGuide,
        `${contract.toolName} onboarding input guide`
      ).toBeDefined();
      expect(toolInputGuide?.requiredFields.slice().sort()).toEqual(
        expectedToolRequired
      );
      expect(toolInputGuide?.inputShape).not.toBe("{}");
    }

    const domainValues = preferenceDomainSchema.options.slice().sort();
    for (const contract of contracts) {
      const tool = requireTool(tools, contract.toolName);
      expect(readTypeBoxUnionValues(tool.parameters ?? {}, "domain")).toEqual(
        domainValues
      );
      const domainSchema = resolveOpenApiSchema(
        openApi.paths[contract.path]?.[contract.method]?.requestBody?.content?.[
          "application/json"
        ]?.schema
      )?.properties?.domain;
      expect([...(domainSchema?.enum ?? [])].sort()).toEqual(domainValues);
    }
    expect(
      readTypeBoxUnionValues(
        requireTool(tools, "forge_submit_preferences_judgment").parameters ??
          {},
        "outcome"
      )
    ).toEqual(preferenceJudgmentOutcomeSchema.options.slice().sort());
    expect(
      readTypeBoxUnionValues(
        requireTool(tools, "forge_submit_preferences_signal").parameters ?? {},
        "signalType"
      )
    ).toEqual(preferenceSignalTypeSchema.options.slice().sort());
    expect(
      readTypeBoxUnionValues(
        requireTool(tools, "forge_update_preferences_score").parameters ?? {},
        "manualStatus"
      )
    ).toEqual(preferenceItemStatusSchema.options.slice().sort());

    const workspaceGuide = AGENT_ONBOARDING_TOOL_INPUT_CATALOG.find(
      (entry) => entry.toolName === "forge_get_preferences_workspace"
    );
    expect(workspaceGuide?.inputShape).toMatch(
      /userId\?: string[\s\S]*domain\?: PreferenceDomain[\s\S]*contextId\?: string/i
    );

    const hermesCatalog = readFileSync(
      path.join(repoRoot, "plugins/hermes/forge_hermes/catalog.py"),
      "utf8"
    );
    const judgmentStart = hermesCatalog.indexOf(
      '"name": "forge_submit_preferences_judgment"'
    );
    const judgmentEnd = hermesCatalog.indexOf(
      '"name": "forge_submit_preferences_signal"',
      judgmentStart
    );
    const signalEnd = hermesCatalog.indexOf(
      '"name": "forge_update_preferences_score"',
      judgmentEnd
    );
    const judgmentBlock = hermesCatalog.slice(judgmentStart, judgmentEnd);
    const signalBlock = hermesCatalog.slice(judgmentEnd, signalEnd);
    for (const block of [judgmentBlock, signalBlock]) {
      expect(block).toMatch(/"userId"/);
      expect(block).toMatch(/"domain"/);
      expect(block).toMatch(/"contextId"/);
      expect(block).not.toMatch(/"profileId"/);
      expect(block).not.toMatch(/"source"\s*:/);
    }
    expect(requireTool(tools, "forge_delete_entities").description).toMatch(
      /preference_catalog and preference_catalog_item use reversible soft deletion/i
    );
    expect(hermesCatalog).toMatch(
      /preference_catalog and preference_catalog_item use reversible soft deletion/i
    );
  });

  it("publishes the Psyche schema catalog as a read-only reference tool", () => {
    const tools = collectRegisteredTools();
    const schemaCatalog = requireTool(tools, "forge_get_psyche_schema_catalog");

    expect(schemaCatalog.description).toMatch(
      /read-only Psyche schema catalog/i
    );
    expect(schemaCatalog.description).toMatch(/schemaId/i);
    expect(schemaCatalog.description).toMatch(/not user-owned belief records/i);
    expect(collectSupportedPluginApiRouteKeys()).toContain(
      makeApiRouteKey("GET", "/api/v1/psyche/schema-catalog")
    );
    expect(collectMirroredApiRouteKeys()).toContain(
      makeApiRouteKey("GET", "/api/v1/psyche/schema-catalog")
    );
  });

  it("publishes dedicated route-key tools for specialized domain surfaces", async () => {
    const tools = collectRegisteredTools();
    const attention = requireTool(tools, "forge_call_attention_route");
    const entityNavigation = requireTool(
      tools,
      "forge_call_entity_navigation_route"
    );
    const calendarConnection = requireTool(
      tools,
      "forge_call_calendar_connection_route"
    );
    const wiki = requireTool(tools, "forge_call_wiki_route");
    const movement = requireTool(tools, "forge_call_movement_route");
    const lifeForce = requireTool(tools, "forge_call_life_force_route");
    const workbench = requireTool(tools, "forge_call_workbench_route");
    const courses = requireTool(tools, "forge_call_course_route");
    const artifact = requireTool(tools, "forge_call_artifact_route");
    const lifeEvents = requireTool(tools, "forge_call_life_event_route");
    const onboardingSurfaces = await loadOnboardingRouteContracts();
    const attentionRouteKeys = readTypeBoxUnionValues(
      attention.parameters ?? {},
      "routeKey"
    );
    const entityNavigationRouteKeys = readTypeBoxUnionValues(
      entityNavigation.parameters ?? {},
      "routeKey"
    );
    const calendarConnectionRouteKeys = readTypeBoxUnionValues(
      calendarConnection.parameters ?? {},
      "routeKey"
    );
    const wikiRouteKeys = readTypeBoxUnionValues(
      wiki.parameters ?? {},
      "routeKey"
    );
    const movementRouteKeys = readTypeBoxUnionValues(
      movement.parameters ?? {},
      "routeKey"
    );
    const lifeForceRouteKeys = readTypeBoxUnionValues(
      lifeForce.parameters ?? {},
      "routeKey"
    );
    const workbenchRouteKeys = readTypeBoxUnionValues(
      workbench.parameters ?? {},
      "routeKey"
    );
    const courseRouteKeys = readTypeBoxUnionValues(
      courses.parameters ?? {},
      "routeKey"
    );
    const artifactRouteKeys = readTypeBoxUnionValues(
      artifact.parameters ?? {},
      "routeKey"
    );
    const lifeEventRouteKeys = readTypeBoxUnionValues(
      lifeEvents.parameters ?? {},
      "routeKey"
    );

    expect(attentionRouteKeys).toEqual(
      [...onboardingSurfaces.attention.routeKeys].sort()
    );
    expect(entityNavigationRouteKeys).toEqual(
      [...onboardingSurfaces.entityNavigation.routeKeys].sort()
    );
    expect(calendarConnectionRouteKeys).toEqual(
      [...onboardingSurfaces.calendarConnection.routeKeys].sort()
    );
    expect(wikiRouteKeys).toEqual(
      [...onboardingSurfaces.wiki.routeKeys].sort()
    );
    expect(movementRouteKeys).toEqual(
      [...onboardingSurfaces.movement.routeKeys].sort()
    );
    expect(lifeForceRouteKeys).toEqual(
      [...onboardingSurfaces.lifeForce.routeKeys].sort()
    );
    expect(workbenchRouteKeys).toEqual(
      [...onboardingSurfaces.workbench.routeKeys].sort()
    );
    expect(courseRouteKeys).toEqual(
      [...onboardingSurfaces.courses.routeKeys].sort()
    );
    expect(artifactRouteKeys).toEqual(
      [...onboardingSurfaces.artifact.routeKeys].sort()
    );
    expect(lifeEventRouteKeys).toEqual(
      [...onboardingSurfaces.lifeEvents.routeKeys].sort()
    );
    expect(
      readRouteGuideFromDescription(
        readPropertyDescription(attention.parameters ?? {}, "routeKey")
      )
    ).toEqual(onboardingSurfaces.attention.methodRoutes);
    expect(
      readRouteGuideFromDescription(
        readPropertyDescription(entityNavigation.parameters ?? {}, "routeKey")
      )
    ).toEqual(onboardingSurfaces.entityNavigation.methodRoutes);
    expect(
      readRouteGuideFromDescription(
        readPropertyDescription(calendarConnection.parameters ?? {}, "routeKey")
      )
    ).toEqual(onboardingSurfaces.calendarConnection.methodRoutes);
    expect(
      readRouteGuideFromDescription(
        readPropertyDescription(wiki.parameters ?? {}, "routeKey")
      )
    ).toEqual(onboardingSurfaces.wiki.methodRoutes);
    expect(
      readRouteGuideFromDescription(
        readPropertyDescription(movement.parameters ?? {}, "routeKey")
      )
    ).toEqual(onboardingSurfaces.movement.methodRoutes);
    expect(
      readRouteGuideFromDescription(
        readPropertyDescription(lifeForce.parameters ?? {}, "routeKey")
      )
    ).toEqual(onboardingSurfaces.lifeForce.methodRoutes);
    expect(
      readRouteGuideFromDescription(
        readPropertyDescription(workbench.parameters ?? {}, "routeKey")
      )
    ).toEqual(onboardingSurfaces.workbench.methodRoutes);
    expect(
      readRouteGuideFromDescription(
        readPropertyDescription(courses.parameters ?? {}, "routeKey")
      )
    ).toEqual(onboardingSurfaces.courses.methodRoutes);
    expect(
      readRouteGuideFromDescription(
        readPropertyDescription(artifact.parameters ?? {}, "routeKey")
      )
    ).toEqual(onboardingSurfaces.artifact.methodRoutes);
    expect(
      readRouteGuideFromDescription(
        readPropertyDescription(lifeEvents.parameters ?? {}, "routeKey")
      )
    ).toEqual(onboardingSurfaces.lifeEvents.methodRoutes);

    expect(attentionRouteKeys).toEqual([
      "dismiss",
      "list",
      "restore",
      "snooze"
    ]);
    expect(entityNavigationRouteKeys).toEqual(["list", "touch"]);
    expect(calendarConnectionRouteKeys).toEqual([
      "create",
      "delete",
      "discover",
      "discoverMacOSLocal",
      "list",
      "rediscover",
      "sync",
      "update"
    ]);
    expect(wikiRouteKeys).toEqual([
      "create",
      "delete",
      "health",
      "ingest",
      "list",
      "read",
      "readBySlug",
      "reindex",
      "search",
      "sync",
      "update"
    ]);
    expect(movementRouteKeys).toEqual(
      expect.arrayContaining([
        "day",
        "month",
        "allTime",
        "timeline",
        "places",
        "boxDetail",
        "tripDetail",
        "selection",
        "settings",
        "settingsUpdate",
        "placeCreate",
        "placeUpdate",
        "userBoxPreflight",
        "userBoxCreate",
        "userBoxUpdate",
        "userBoxDelete",
        "automaticBoxInvalidate",
        "stayUpdate",
        "stayDelete",
        "tripUpdate",
        "tripDelete",
        "tripPointUpdate",
        "tripPointDelete"
      ])
    );
    expect(lifeForceRouteKeys).toEqual([
      "fatigueSignal",
      "overview",
      "profile",
      "weekdayTemplate"
    ]);
    expect(workbenchRouteKeys).toEqual(
      expect.arrayContaining([
        "boxCatalog",
        "listFlows",
        "flowDetail",
        "flowById",
        "flowBySlug",
        "createFlow",
        "updateFlow",
        "deleteFlow",
        "runFlow",
        "runByPayload",
        "chatFlow",
        "publishedOutput",
        "runHistory",
        "runs",
        "runDetail",
        "runNodes",
        "nodeResult",
        "latestNodeOutput"
      ])
    );
    expect(courseRouteKeys).toEqual([
      "conceptDetail",
      "courseDetail",
      "exportCourse",
      "importCourse",
      "learningSession",
      "listConcepts",
      "listCourses",
      "submitAttempt"
    ]);
    expect(artifactRouteKeys).toEqual([
      "audit",
      "createWithBytes",
      "enrichWithLlm",
      "list",
      "readMetadata",
      "replaceGenericLinks",
      "rescan",
      "trustState",
      "updateMetadata",
      "versions"
    ]);
    expect(artifactRouteKeys).not.toContain("humanDownloadOnly");
    expect(lifeEventRouteKeys).toEqual([
      "calendarSync",
      "fromCalendarEvent",
      "importTicket",
      "read",
      "timeline",
      "travelStatus"
    ]);

    for (const tool of [
      attention,
      entityNavigation,
      calendarConnection,
      wiki,
      movement,
      lifeForce,
      workbench,
      courses,
      artifact,
      lifeEvents
    ]) {
      expect(tool.parameters?.required).toEqual(["routeKey"]);
      expect(tool.description ?? "").toMatch(/dedicated/i);
    }
    for (const tool of [movement, lifeForce, workbench, courses]) {
      expect(tool.description ?? "").toMatch(
        /Do not use.*batch CRUD|normal stored entities.*batch CRUD/i
      );
    }
    expect(artifact.description ?? "").toMatch(/Do not expose download/i);
    expect(artifact.description ?? "").toMatch(/password/i);
    expect(artifact.description ?? "").toMatch(/decrypt/i);
    expect(artifact.description ?? "").toMatch(/generic entity-link/i);
    expect(artifact.description ?? "").toMatch(
      /stable per-file idempotencyKey/i
    );
    expect(artifact.description ?? "").toMatch(/normalizes agent provenance/i);
    expect(artifact.description ?? "").toMatch(/changed-payload key reuse/i);
    expect(lifeEvents.description ?? "").toMatch(/shared batch CRUD/i);
    expect(lifeEvents.description ?? "").toMatch(/generic entity_links/i);
    expect(attention.description ?? "").toMatch(/stable item id/i);
    expect(attention.description ?? "").toMatch(/derived queue/i);
    expect(entityNavigation.description ?? "").toMatch(/Human pin and unpin/i);
    expect(calendarConnection.description ?? "").toMatch(
      /complete|lifecycle|list.*discovery/i
    );
    expect(calendarConnection.description ?? "").toMatch(/batch CRUD/i);
    expect(wiki.description ?? "").toMatch(/id or slug read/i);
    expect(wiki.description ?? "").toMatch(/batch CRUD/i);

    expect(
      readPropertyDescription(attention.parameters ?? {}, "routeKey")
    ).toMatch(
      /list: GET \/api\/v1\/attention-inbox[\s\S]*snooze: POST \/api\/v1\/attention-inbox\/:id\/snooze[\s\S]*restore: POST \/api\/v1\/attention-inbox\/:id\/restore/
    );
    expect(
      readPropertyDescription(entityNavigation.parameters ?? {}, "routeKey")
    ).toMatch(
      /list: GET \/api\/v1\/entity-navigation[\s\S]*touch: POST \/api\/v1\/entity-navigation\/touch/
    );
    expect(
      readPropertyDescription(calendarConnection.parameters ?? {}, "routeKey")
    ).toMatch(
      /list: GET \/api\/v1\/calendar\/connections[\s\S]*discover: POST \/api\/v1\/calendar\/discovery[\s\S]*update: PATCH \/api\/v1\/calendar\/connections\/:id[\s\S]*delete: DELETE \/api\/v1\/calendar\/connections\/:id/
    );
    expect(readPropertyDescription(wiki.parameters ?? {}, "routeKey")).toMatch(
      /list: GET \/api\/v1\/wiki\/pages[\s\S]*readBySlug: GET \/api\/v1\/wiki\/by-slug\/:slug[\s\S]*delete: DELETE \/api\/v1\/wiki\/pages\/:id[\s\S]*ingest: POST \/api\/v1\/wiki\/ingest-jobs/
    );
    expect(
      readPropertyDescription(movement.parameters ?? {}, "routeKey")
    ).toMatch(
      /day: GET \/api\/v1\/movement\/day[\s\S]*userBoxCreate: POST \/api\/v1\/movement\/user-boxes[\s\S]*tripPointDelete: DELETE \/api\/v1\/movement\/trips\/:id\/points\/:pointId/
    );
    expect(
      readPropertyDescription(lifeForce.parameters ?? {}, "routeKey")
    ).toMatch(
      /overview: GET \/api\/v1\/life-force[\s\S]*weekdayTemplate: PUT \/api\/v1\/life-force\/templates\/:weekday/
    );
    expect(
      readPropertyDescription(workbench.parameters ?? {}, "routeKey")
    ).toMatch(
      /listFlows: GET \/api\/v1\/workbench\/flows[\s\S]*runFlow: POST \/api\/v1\/workbench\/flows\/:id\/run[\s\S]*latestNodeOutput: GET \/api\/v1\/workbench\/flows\/:id\/nodes\/:nodeId\/output/
    );
    expect(
      readPropertyDescription(courses.parameters ?? {}, "routeKey")
    ).toMatch(
      /listCourses: GET \/api\/v1\/courses[\s\S]*learningSession: GET \/api\/v1\/courses\/:courseId\/learn[\s\S]*submitAttempt: POST \/api\/v1\/courses\/:courseId\/lessons\/:lessonId\/activities\/:activityId\/attempts[\s\S]*conceptDetail: GET \/api\/v1\/concepts\/:conceptId/
    );
    expect(
      readPropertyDescription(artifact.parameters ?? {}, "routeKey")
    ).toMatch(
      /list: GET \/api\/v1\/artifacts[\s\S]*createWithBytes: POST \/api\/v1\/artifacts[\s\S]*replaceGenericLinks: POST \/api\/v1\/artifacts\/:id\/links[\s\S]*audit: GET \/api\/v1\/artifacts\/:id\/audit/
    );
    expect(
      readPropertyDescription(artifact.parameters ?? {}, "routeKey")
    ).not.toMatch(/download/i);
    expect(
      readPropertyDescription(lifeEvents.parameters ?? {}, "routeKey")
    ).toMatch(
      /timeline: GET \/api\/v1\/life-events\/timeline[\s\S]*calendarSync: POST \/api\/v1\/life-events\/:id\/calendar-sync[\s\S]*importTicket: POST \/api\/v1\/life-events\/import-ticket[\s\S]*travelStatus: GET \/api\/v1\/life-events\/:id\/travel-status/
    );

    for (const tool of [
      attention,
      entityNavigation,
      calendarConnection,
      wiki,
      movement,
      lifeForce,
      workbench,
      courses,
      artifact,
      lifeEvents
    ]) {
      expect(
        readPropertyDescription(tool.parameters ?? {}, "routeKey")
      ).toMatch(
        /fill pathParams with that exact placeholder name[\s\S]*do not put raw paths or ids into routeKey/i
      );
      expect(
        readPropertyDescription(tool.parameters ?? {}, "pathParams")
      ).toMatch(
        /Use the exact :placeholder names shown in the routeKey description/i
      );
    }
  });

  it("keeps Hermes specialized route specs aligned with live onboarding", async () => {
    const onboardingSurfaces = await loadOnboardingRouteContracts();

    expect(readHermesRouteSpecs("ATTENTION_ROUTE_SPECS")).toEqual(
      onboardingSurfaces.attention.methodRoutes
    );
    expect(readHermesRouteSpecs("CALENDAR_CONNECTION_ROUTE_SPECS")).toEqual(
      onboardingSurfaces.calendarConnection.methodRoutes
    );
    expect(readHermesRouteSpecs("WIKI_ROUTE_SPECS")).toEqual(
      onboardingSurfaces.wiki.methodRoutes
    );
    expect(readHermesRouteSpecs("MOVEMENT_ROUTE_SPECS")).toEqual(
      onboardingSurfaces.movement.methodRoutes
    );
    expect(readHermesRouteSpecs("LIFE_FORCE_ROUTE_SPECS")).toEqual(
      onboardingSurfaces.lifeForce.methodRoutes
    );
    expect(readHermesRouteSpecs("WORKBENCH_ROUTE_SPECS")).toEqual(
      onboardingSurfaces.workbench.methodRoutes
    );
    expect(readHermesRouteSpecs("COURSE_ROUTE_SPECS")).toEqual(
      onboardingSurfaces.courses.methodRoutes
    );
    expect(readHermesRouteSpecs("ARTIFACT_ROUTE_SPECS")).toEqual(
      onboardingSurfaces.artifact.methodRoutes
    );
    expect(readHermesRouteSpecs("LIFE_EVENT_ROUTE_SPECS")).toEqual(
      onboardingSurfaces.lifeEvents.methodRoutes
    );
  });

  it("publishes bounded paginated wiki browse and search tool inputs", () => {
    const tools = collectRegisteredTools();
    const list = requireTool(tools, "forge_list_wiki_pages");
    const search = requireTool(tools, "forge_search_wiki");
    const listProperties = (list.parameters?.properties ?? {}) as Record<
      string,
      { maximum?: number; maxLength?: number }
    >;
    const searchProperties = (search.parameters?.properties ?? {}) as Record<
      string,
      { maximum?: number; maxLength?: number }
    >;

    expect(listProperties.limit?.maximum).toBe(500);
    expect(listProperties.offset?.maximum).toBe(9_999);
    expect(searchProperties.limit?.maximum).toBe(50);
    expect(searchProperties.offset?.maximum).toBe(999);
    expect(searchProperties.query?.maxLength).toBe(500);
    expect(search.description).toMatch(/title, alias, content/i);
    expect(search.description).toMatch(/offset pagination/i);
  });

  it("keeps Hermes plugin.yaml provides_tools aligned with the registered catalog", () => {
    expect(readHermesManifestToolNames()).toEqual(readHermesCatalogToolNames());
  });
});
