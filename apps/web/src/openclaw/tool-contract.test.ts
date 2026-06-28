import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  calendarOverviewQuerySchema,
  createCalendarConnectionSchema
} from "../../../../apps/api/src/types";
import { buildServer } from "../../../../apps/api/src/app";
import { collectSupportedPluginApiRouteKeys, makeApiRouteKey } from "./parity";
import { collectMirroredApiRouteKeys } from "./routes";
import { registerForgePluginTools } from "./tools";

type RegisteredTool = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
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
  return {
    movement: surfaces.movement,
    lifeForce: surfaces.lifeForce,
    workbench: surfaces.workbench,
    artifact: {
      routeKeys: specializedCrudEntities.artifact?.routeKeys ?? [],
      methodRoutes: artifactMethodRoutes
    }
  };
}

function collectRegisteredTools() {
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
    TEST_CONFIG
  );
  return tools;
}

function requireTool(tools: RegisteredTool[], name: string) {
  const tool = tools.find((entry) => entry.name === name);
  expect(tool, `Expected tool ${name} to be registered`).toBeDefined();
  return tool as RegisteredTool;
}

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
  expect(guide, "routeKey description should publish exact route guide").toBeTruthy();

  return Object.fromEntries(
    guide!.split("; ").map((entry) => {
      const match = /^([^:]+):\s+([A-Z]+)\s+(\/api\/v1\/\S+)$/.exec(entry);
      expect(match, `route guide entry should be parseable: ${entry}`).toBeTruthy();
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
  expect(start, `${constantName} should exist in Hermes catalog`).toBeGreaterThanOrEqual(
    0
  );
  const bodyStart = source.indexOf("{", start);
  expect(bodyStart, `${constantName} should open a dict`).toBeGreaterThanOrEqual(0);

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
    [...body.matchAll(/"([^"]+)":\s*\{"method":\s*"([A-Z]+)",\s*"path":\s*"([^"]+)"/g)].map(
      (match) => [match[1], `${match[2]} ${match[3]}`]
    )
  );
}

describe("openclaw tool contracts", () => {
  it("keeps current-work and calendar tools backed by mirrored curated routes", () => {
    const supportedRoutes = collectSupportedPluginApiRouteKeys();
    const mirroredRoutes = collectMirroredApiRouteKeys();
    const expectedToolRoutes = [
      makeApiRouteKey("GET", "/api/v1/operator/context"),
      makeApiRouteKey("GET", "/api/v1/calendar/overview"),
      makeApiRouteKey("POST", "/api/v1/calendar/connections"),
      makeApiRouteKey("POST", "/api/v1/calendar/connections/:id/sync"),
      makeApiRouteKey("POST", "/api/v1/calendar/work-block-templates"),
      makeApiRouteKey("POST", "/api/v1/calendar/timeboxes/recommend"),
      makeApiRouteKey("POST", "/api/v1/calendar/timeboxes")
    ];

    expect(expectedToolRoutes.every((route) => supportedRoutes.has(route))).toBe(
      true
    );
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
    const backendProperties = Object.keys(calendarOverviewQuerySchema.shape).sort();

    expect(parameterProperties).toEqual(backendProperties);
  });

  it("matches the backend calendar provider enum and requires selected calendars", () => {
    const tools = collectRegisteredTools();
    const connectCalendar = requireTool(tools, "forge_connect_calendar_provider");
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

  it("publishes dedicated route-key tools for specialized domain surfaces", async () => {
    const tools = collectRegisteredTools();
    const movement = requireTool(tools, "forge_call_movement_route");
    const lifeForce = requireTool(tools, "forge_call_life_force_route");
    const workbench = requireTool(tools, "forge_call_workbench_route");
    const artifact = requireTool(tools, "forge_call_artifact_route");
    const onboardingSurfaces = await loadOnboardingRouteContracts();
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
    const artifactRouteKeys = readTypeBoxUnionValues(
      artifact.parameters ?? {},
      "routeKey"
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
    expect(artifactRouteKeys).toEqual(
      [...onboardingSurfaces.artifact.routeKeys].sort()
    );
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
        readPropertyDescription(artifact.parameters ?? {}, "routeKey")
      )
    ).toEqual(onboardingSurfaces.artifact.methodRoutes);

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

    for (const tool of [movement, lifeForce, workbench, artifact]) {
      expect(tool.parameters?.required).toEqual(["routeKey"]);
      expect(tool.description ?? "").toMatch(/dedicated/i);
    }
    for (const tool of [movement, lifeForce, workbench]) {
      expect(tool.description ?? "").toMatch(
        /Do not use.*batch CRUD|normal stored entities.*batch CRUD/i
      );
    }
    expect(artifact.description ?? "").toMatch(/Do not expose download/i);
    expect(artifact.description ?? "").toMatch(/generic entity-link/i);

    expect(readPropertyDescription(movement.parameters ?? {}, "routeKey")).toMatch(
      /day: GET \/api\/v1\/movement\/day[\s\S]*userBoxCreate: POST \/api\/v1\/movement\/user-boxes[\s\S]*tripPointDelete: DELETE \/api\/v1\/movement\/trips\/:id\/points\/:pointId/
    );
    expect(readPropertyDescription(lifeForce.parameters ?? {}, "routeKey")).toMatch(
      /overview: GET \/api\/v1\/life-force[\s\S]*weekdayTemplate: PUT \/api\/v1\/life-force\/templates\/:weekday/
    );
    expect(readPropertyDescription(workbench.parameters ?? {}, "routeKey")).toMatch(
      /listFlows: GET \/api\/v1\/workbench\/flows[\s\S]*runFlow: POST \/api\/v1\/workbench\/flows\/:id\/run[\s\S]*latestNodeOutput: GET \/api\/v1\/workbench\/flows\/:id\/nodes\/:nodeId\/output/
    );
    expect(readPropertyDescription(artifact.parameters ?? {}, "routeKey")).toMatch(
      /list: GET \/api\/v1\/artifacts[\s\S]*createWithBytes: POST \/api\/v1\/artifacts[\s\S]*replaceGenericLinks: POST \/api\/v1\/artifacts\/:id\/links[\s\S]*audit: GET \/api\/v1\/artifacts\/:id\/audit/
    );
    expect(readPropertyDescription(artifact.parameters ?? {}, "routeKey")).not.toMatch(
      /download/i
    );

    for (const tool of [movement, lifeForce, workbench, artifact]) {
      expect(readPropertyDescription(tool.parameters ?? {}, "routeKey")).toMatch(
        /fill pathParams with that exact placeholder name[\s\S]*do not put raw paths or ids into routeKey/i
      );
      expect(readPropertyDescription(tool.parameters ?? {}, "pathParams")).toMatch(
        /Use the exact :placeholder names shown in the routeKey description/i
      );
    }
  });

  it("keeps Hermes specialized route specs aligned with live onboarding", async () => {
    const onboardingSurfaces = await loadOnboardingRouteContracts();

    expect(readHermesRouteSpecs("MOVEMENT_ROUTE_SPECS")).toEqual(
      onboardingSurfaces.movement.methodRoutes
    );
    expect(readHermesRouteSpecs("LIFE_FORCE_ROUTE_SPECS")).toEqual(
      onboardingSurfaces.lifeForce.methodRoutes
    );
    expect(readHermesRouteSpecs("WORKBENCH_ROUTE_SPECS")).toEqual(
      onboardingSurfaces.workbench.methodRoutes
    );
    expect(readHermesRouteSpecs("ARTIFACT_ROUTE_SPECS")).toEqual(
      onboardingSurfaces.artifact.methodRoutes
    );
  });
});
