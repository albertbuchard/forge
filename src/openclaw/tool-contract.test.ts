import { describe, expect, it } from "vitest";
import {
  calendarOverviewQuerySchema,
  createCalendarConnectionSchema
} from "../../server/src/types";
import { collectSupportedPluginApiRouteKeys, makeApiRouteKey } from "./parity";
import { collectMirroredApiRouteKeys } from "./routes";
import { registerForgePluginTools } from "./tools";

type RegisteredTool = {
  name: string;
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
});
