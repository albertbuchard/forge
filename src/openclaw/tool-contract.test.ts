import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  calendarOverviewQuerySchema,
  createCalendarConnectionSchema
} from "../../server/src/types";
import { buildServer } from "../../server/src/app";
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

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

async function loadOnboardingRouteKeys() {
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
    .specializedDomainSurfaces as Record<string, { routeKeys: string[] }>;
  return {
    movement: [...surfaces.movement.routeKeys].sort(),
    lifeForce: [...surfaces.lifeForce.routeKeys].sort(),
    workbench: [...surfaces.workbench.routeKeys].sort()
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
    const onboardingRouteKeys = await loadOnboardingRouteKeys();
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

    expect(movementRouteKeys).toEqual(onboardingRouteKeys.movement);
    expect(lifeForceRouteKeys).toEqual(onboardingRouteKeys.lifeForce);
    expect(workbenchRouteKeys).toEqual(onboardingRouteKeys.workbench);

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
        "flowById",
        "flowBySlug",
        "createFlow",
        "updateFlow",
        "deleteFlow",
        "runFlow",
        "runByPayload",
        "chatFlow",
        "publishedOutput",
        "runs",
        "runDetail",
        "runNodes",
        "nodeResult",
        "latestNodeOutput"
      ])
    );

    for (const tool of [movement, lifeForce, workbench]) {
      expect(tool.parameters?.required).toEqual(["routeKey"]);
      expect(tool.description ?? "").toMatch(/dedicated/i);
      expect(tool.description ?? "").toMatch(
        /Do not use.*batch CRUD|normal stored entities.*batch CRUD/i
      );
    }

    expect(readPropertyDescription(movement.parameters ?? {}, "routeKey")).toMatch(
      /day: GET \/api\/v1\/movement\/day[\s\S]*userBoxCreate: POST \/api\/v1\/movement\/user-boxes[\s\S]*tripPointDelete: DELETE \/api\/v1\/movement\/trips\/:id\/points\/:pointId/
    );
    expect(readPropertyDescription(lifeForce.parameters ?? {}, "routeKey")).toMatch(
      /overview: GET \/api\/v1\/life-force[\s\S]*weekdayTemplate: PUT \/api\/v1\/life-force\/templates\/:weekday/
    );
    expect(readPropertyDescription(workbench.parameters ?? {}, "routeKey")).toMatch(
      /listFlows: GET \/api\/v1\/workbench\/flows[\s\S]*runFlow: POST \/api\/v1\/workbench\/flows\/:id\/run[\s\S]*latestNodeOutput: GET \/api\/v1\/workbench\/flows\/:id\/nodes\/:nodeId\/output/
    );

    for (const tool of [movement, lifeForce, workbench]) {
      expect(readPropertyDescription(tool.parameters ?? {}, "routeKey")).toMatch(
        /fill pathParams with that exact placeholder name[\s\S]*do not put raw paths or ids into routeKey/i
      );
      expect(readPropertyDescription(tool.parameters ?? {}, "pathParams")).toMatch(
        /Use the exact :placeholder names shown in the routeKey description/i
      );
    }
  });
});
