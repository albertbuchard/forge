import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { callConfiguredForgeApi } from "./api-client";
import { FORGE_PLUGIN_ROUTE_GROUPS } from "./routes";
import { registerForgePluginTools, WORK_ROUTE_SPECS } from "./tools";

vi.mock("./api-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api-client.js")>();
  return { ...actual, callConfiguredForgeApi: vi.fn() };
});

type RegisteredTool = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  execute?: (toolCallId: string, params: unknown) => Promise<unknown>;
};

const testConfig = {
  origin: "http://127.0.0.1",
  port: 4317,
  baseUrl: "http://127.0.0.1:4317",
  webAppUrl: "http://127.0.0.1:4317/forge/",
  portSource: "default",
  dataRoot: "",
  apiToken: "fg_live_work_contract_test",
  actorLabel: "Work contract test",
  injectBootstrapContext: true,
  timeoutMs: 15000
} as const;

function registeredWorkTool(apiToken: string = testConfig.apiToken) {
  const tools: RegisteredTool[] = [];
  registerForgePluginTools(
    {
      registerTool(tool: unknown) {
        if (typeof tool !== "function") tools.push(tool as RegisteredTool);
      }
    } as never,
    { ...testConfig, apiToken }
  );
  const work = tools.find((tool) => tool.name === "forge_call_work_route");
  expect(work).toBeDefined();
  return work as RegisteredTool;
}

function substitutedPath(template: string) {
  return template.replaceAll(/:([A-Za-z0-9_]+)/g, (_match, key: string) =>
    key === "kind"
      ? "offer"
      : key === "entityType"
        ? "work_engagement"
        : `${key}_test`
  );
}

function markdownSection(source: string, heading: string) {
  const marker = `## ${heading}`;
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf("\n## ", start + marker.length);
  return source.slice(start, next < 0 ? source.length : next).trim();
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("Work MCP and plugin contract", () => {
  it("publishes every bounded agent route while keeping private imports operator-only", () => {
    const keys = Object.keys(WORK_ROUTE_SPECS);
    expect(keys).toEqual([
      "overview",
      "context",
      "settings",
      "updateOpportunitySearch",
      "listOrganizations",
      "createOrganization",
      "organizationDetail",
      "updateOrganization",
      "listEngagements",
      "createEngagement",
      "engagementDetail",
      "updateEngagement",
      "metricDefinitions",
      "createMetricDefinition",
      "recordCheckIn",
      "metricTrends",
      "listCampaigns",
      "createCampaign",
      "campaignDetail",
      "updateCampaign",
      "createCriteriaVersion",
      "listOpportunities",
      "upsertOpportunity",
      "opportunityDetail",
      "updateOpportunity",
      "evaluateOpportunity",
      "listApplications",
      "createApplication",
      "applicationDetail",
      "updateApplication",
      "transitionApplication",
      "recordApplicationEvent",
      "listSupporting",
      "createSupporting",
      "supportingDetail",
      "updateSupporting",
      "listSearchRuns",
      "recordSearchRun",
      "searchRunDetail",
      "acceptOffer",
      "listRelationships",
      "replaceRelationships",
      "archive",
      "restore",
      "createTransmissionPreview",
      "requestTransmissionApproval",
      "recordVerifiedSubmission"
    ]);
    expect(
      Object.values(WORK_ROUTE_SPECS).every(
        (route) =>
          route.requiresAgentToken === true &&
          route.path.startsWith("/api/v1/work")
      )
    ).toBe(true);
    expect(
      Object.values(WORK_ROUTE_SPECS).some((route) =>
        route.path.includes("/imports/")
      )
    ).toBe(false);
  });

  it("mirrors each agent route through the plugin without changing method, path, query, or body semantics", () => {
    const workGroup = FORGE_PLUGIN_ROUTE_GROUPS.find(
      (group) => group.path === "/forge/v1/work"
    );
    expect(workGroup?.match).toBe("prefix");
    expect(workGroup?.operations).toHaveLength(
      Object.keys(WORK_ROUTE_SPECS).length
    );

    for (const spec of Object.values(WORK_ROUTE_SPECS)) {
      const apiPath = substitutedPath(spec.path);
      const pluginPath = apiPath.replace("/api/v1/work", "/forge/v1/work");
      const operation = workGroup?.operations.find(
        (candidate) =>
          candidate.kind !== "ui_redirect" &&
          candidate.method === spec.method &&
          candidate.pattern.test(pluginPath)
      );
      expect(operation, `${spec.method} ${pluginPath}`).toBeDefined();
      if (!operation || operation.kind === "ui_redirect") continue;
      const url = new URL(`http://127.0.0.1${pluginPath}?userId=user_operator`);
      const match = pluginPath.match(operation.pattern);
      expect(match).not.toBeNull();
      expect(operation.target(match!, url)).toBe(
        `${apiPath}?userId=user_operator`
      );
      expect(operation.requiresToken).toBe(true);
      expect(operation.requestBody).toBe(
        spec.method === "GET" ? undefined : "json"
      );
    }
  });

  it("registers one collision-free compound tool and forwards typed paths safely", async () => {
    const mockedCall = vi.mocked(callConfiguredForgeApi);
    mockedCall.mockResolvedValue({ status: 200, body: { ok: true } });
    const tool = registeredWorkTool();
    expect(tool.description).toMatch(/permanent|current or planned/i);
    expect(tool.description).toMatch(/Never claim submission/i);
    expect(tool.description).toMatch(/work\.transmit/i);

    const schema = tool.parameters as {
      required: string[];
      properties: { routeKey: { anyOf: Array<{ const: string }> } };
    };
    expect(schema.required).toContain("routeKey");
    expect(
      schema.properties.routeKey.anyOf.map((entry) => entry.const)
    ).toEqual(Object.keys(WORK_ROUTE_SPECS));

    await tool.execute?.("work-context", {
      routeKey: "context",
      query: { userIds: ["user_operator"], trendWindowDays: 90 }
    });
    expect(mockedCall).toHaveBeenLastCalledWith(
      expect.objectContaining({ apiToken: testConfig.apiToken }),
      {
        method: "GET",
        path: "/api/v1/work/context?userIds=user_operator&trendWindowDays=90",
        body: undefined
      }
    );

    await tool.execute?.("work-evaluation", {
      routeKey: "evaluateOpportunity",
      pathParams: {
        campaignId: "campaign/encoded",
        opportunityId: "opportunity 1"
      },
      body: { criteriaVersionId: "criteria_1" }
    });
    expect(mockedCall).toHaveBeenLastCalledWith(
      expect.objectContaining({ apiToken: testConfig.apiToken }),
      {
        method: "POST",
        path: "/api/v1/work/campaigns/campaign%2Fencoded/opportunities/opportunity%201/evaluations",
        body: { criteriaVersionId: "criteria_1" }
      }
    );
  });

  it("refuses the compound Work tool when no scoped agent token is configured", async () => {
    const tool = registeredWorkTool("");
    await expect(
      tool.execute?.("work-without-token", { routeKey: "context" })
    ).rejects.toThrow(/requires a configured Forge agent token/i);
    expect(callConfiguredForgeApi).not.toHaveBeenCalled();
  });

  it("keeps the Work conversation playbook identical across Codex, Hermes, and OpenClaw source packages", () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../..");
    const sourcePaths = [
      "plugins/codex/skills/forge-codex/entity_conversation_playbooks.md",
      "plugins/hermes/forge_hermes/entity_conversation_playbooks.md",
      "plugins/openclaw/skills/forge-openclaw/entity_conversation_playbooks.md"
    ];
    const sections = sourcePaths.map((relativePath) =>
      markdownSection(
        readFileSync(path.join(repoRoot, relativePath), "utf8"),
        "Work and opportunities"
      )
    );
    expect(sections[1]).toBe(sections[0]);
    expect(sections[2]).toBe(sections[0]);
    expect(sections[0]).toMatch(/concurrent Work Engagements/i);
    expect(sections[0]).toMatch(/criteria version/i);
    expect(sections[0]).toMatch(/exact transmission preview/i);
    expect(sections[0]).toMatch(/direct completion evidence/i);
  });

  it("keeps the generated Hermes package synchronized with its reviewed source playbook", () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../..");
    const source = readFileSync(
      path.join(
        repoRoot,
        "plugins/hermes/forge_hermes/entity_conversation_playbooks.md"
      ),
      "utf8"
    );
    const generated = readFileSync(
      path.join(
        repoRoot,
        "plugins/hermes/build/lib/forge_hermes/entity_conversation_playbooks.md"
      ),
      "utf8"
    );
    expect(generated).toBe(source);
  });
});
