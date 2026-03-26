import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCrudEntityCapabilityMatrix } from "../../server/src/services/entity-crud";
import rootPackageJson from "../../package.json";
import packageManifest from "../../openclaw-plugin/openclaw.plugin.json";
import publicPackageJson from "../../openclaw-plugin/package.json";
import pluginEntry, { forgePluginConfigSchema, registerForgePlugin, resolveForgePluginConfig } from "./index";
import legacyPluginEntry from "./index.legacy";
import { FORGE_PLUGIN_ROUTE_GROUPS } from "./routes";

type RouteCall = {
  path: string;
  match?: "exact" | "prefix";
  auth: "plugin" | "gateway";
  handler: (request: never, response: never) => Promise<boolean | void> | boolean | void;
};

type ToolCall = {
  name?: string;
};

type MockCommand = {
  name: string;
  children: MockCommand[];
  descriptions: string[];
  actions: Array<() => Promise<void> | void>;
  command(name: string): MockCommand;
  description(text: string): MockCommand;
  action(handler: () => Promise<void> | void): MockCommand;
};

function createCommand(name: string): MockCommand {
  return {
    name,
    children: [],
    descriptions: [] as string[],
    actions: [] as Array<() => Promise<void> | void>,
    command(childName: string) {
      const child = createCommand(childName);
      this.children.push(child);
      return child;
    },
    description(text: string) {
      this.descriptions.push(text);
      return this;
    },
    action(handler: () => Promise<void> | void) {
      this.actions.push(handler);
      return this;
    }
  };
}

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: "",
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(chunk?: string) {
      this.body = chunk ?? "";
    }
  };
}

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectTypeScriptFiles(fullPath);
    }
    return entry.isFile() && fullPath.endsWith(".ts") ? [fullPath] : [];
  });
}

const DELETE_TOOL_BY_ENTITY = {
  goal: "forge_delete_goal",
  project: "forge_delete_project",
  task: "forge_delete_task",
  tag: "forge_delete_tag",
  comment: "forge_delete_comment",
  insight: "forge_delete_insight",
  psyche_value: "forge_delete_psyche_value",
  behavior_pattern: "forge_delete_psyche_pattern",
  behavior: "forge_delete_psyche_behavior",
  belief_entry: "forge_delete_psyche_belief",
  mode_profile: "forge_delete_psyche_mode",
  mode_guide_session: "forge_delete_psyche_mode_guide",
  event_type: "forge_delete_psyche_event_type",
  emotion_definition: "forge_delete_psyche_emotion",
  trigger_report: "forge_delete_psyche_report"
} as const;

describe("forge openclaw plugin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("normalizes plugin config defaults", () => {
    expect(resolveForgePluginConfig(undefined)).toEqual({
      baseUrl: "http://127.0.0.1:3017",
      apiToken: "",
      actorLabel: "aurel",
      timeoutMs: 15000
    });
  });

  it("registers the explicit Forge route groups and CLI commands", () => {
    const routes: RouteCall[] = [];
    const tools: ToolCall[] = [];
    const program = createCommand("root");

    registerForgePlugin({
      pluginConfig: {
        baseUrl: "http://127.0.0.1:3017",
        apiToken: "fg_live_test",
        actorLabel: "aurel"
      },
      registerHttpRoute(route) {
        routes.push(route);
      },
      registerTool(tool) {
        tools.push(typeof tool === "function" ? { name: "factory" } : { name: tool.name });
      },
      registerCli(registrar) {
        registrar({
          program: program as never,
          config: {} as never,
          logger: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn()
          } as never
        });
      }
    });

    expect(routes).toHaveLength(FORGE_PLUGIN_ROUTE_GROUPS.length);
    expect(routes.map((route) => route.path)).toEqual(FORGE_PLUGIN_ROUTE_GROUPS.map((route) => route.path));
    expect(routes.find((route) => route.path === "/forge/v1/projects")?.match).toBe("prefix");
    const toolNames = tools.map((tool) => tool.name);
    expect(toolNames).toContain("forge_get_context");
    expect(toolNames).toContain("forge_list_domains");
    expect(toolNames).toContain("forge_get_operator_context");
    expect(toolNames).toContain("forge_get_operator_overview");
    expect(toolNames).toContain("forge_get_agent_onboarding");
    expect(toolNames).toContain("forge_get_settings");
    expect(toolNames).toContain("forge_get_settings_bin");
    expect(toolNames).toContain("forge_update_settings");
    expect(toolNames).toContain("forge_get_xp_metrics");
    expect(toolNames).toContain("forge_list_reward_ledger");
    expect(toolNames).toContain("forge_get_goal");
    expect(toolNames).toContain("forge_update_goal");
    expect(toolNames).toContain("forge_delete_goal");
    expect(toolNames).toContain("forge_create_project");
    expect(toolNames).toContain("forge_delete_project");
    expect(toolNames).toContain("forge_get_project_board");
    expect(toolNames).toContain("forge_move_task");
    expect(toolNames).toContain("forge_delete_task");
    expect(toolNames).toContain("forge_log_work");
    expect(toolNames).toContain("forge_claim_task_run");
    expect(toolNames).toContain("forge_focus_task_run");
    expect(toolNames).toContain("forge_list_task_runs");
    expect(toolNames).toContain("forge_list_active_timers");
    expect(toolNames).toContain("forge_release_task_run");
    expect(toolNames).toContain("forge_list_agents");
    expect(toolNames).toContain("forge_list_agent_actions");
    expect(toolNames).toContain("forge_list_tags");
    expect(toolNames).toContain("forge_delete_tag");
    expect(toolNames).toContain("forge_get_comment");
    expect(toolNames).toContain("forge_update_comment");
    expect(toolNames).toContain("forge_delete_comment");
    expect(toolNames).toContain("forge_delete_insight");
    expect(toolNames).toContain("forge_create_entities");
    expect(toolNames).toContain("forge_update_entities");
    expect(toolNames).toContain("forge_delete_entities");
    expect(toolNames).toContain("forge_restore_entities");
    expect(toolNames).toContain("forge_search_entities");
    expect(toolNames).toContain("forge_update_reward_rule");
    expect(toolNames).toContain("forge_award_xp_bonus");
    expect(toolNames).toContain("forge_create_psyche_value");
    expect(toolNames).toContain("forge_delete_psyche_value");
    expect(toolNames).toContain("forge_update_psyche_pattern");
    expect(toolNames).toContain("forge_create_psyche_behavior");
    expect(toolNames).toContain("forge_update_psyche_belief");
    expect(toolNames).toContain("forge_create_psyche_report");
    expect(toolNames).toContain("forge_delete_psyche_report");
    expect(toolNames).toContain("forge_create_psyche_mode");
    expect(toolNames).toContain("forge_create_psyche_mode_guide");
    expect(toolNames).toContain("forge_get_psyche_mode_guide");
    expect(toolNames).toContain("forge_update_psyche_mode_guide");
    expect(toolNames).toContain("forge_get_psyche_event_type");
    expect(toolNames).toContain("forge_update_psyche_event_type");
    expect(toolNames).toContain("forge_get_psyche_emotion");
    expect(toolNames).toContain("forge_update_psyche_emotion");
    expect(toolNames).toContain("forge_list_psyche_schema_catalog");
    expect(toolNames.length).toBeGreaterThan(66);
    expect(program.children[0]?.name).toBe("forge");
    expect(program.children[0]?.children.map((child: MockCommand) => child.name)).toEqual([
      "health",
      "context",
      "overview",
      "openapi",
      "goals",
      "projects",
      "metrics-xp",
      "doctor",
      "onboarding",
      "comments",
      "psyche-overview",
      "route-check"
    ]);
  });

  it("keeps delete tools aligned with the shared CRUD capability matrix", () => {
    const tools: ToolCall[] = [];

    registerForgePlugin({
      pluginConfig: {
        baseUrl: "http://127.0.0.1:3017",
        apiToken: "fg_live_test",
        actorLabel: "aurel"
      },
      registerHttpRoute() {},
      registerTool(tool) {
        tools.push(typeof tool === "function" ? { name: "factory" } : { name: tool.name });
      }
    });

    const toolNames = new Set(tools.map((tool) => tool.name));
    for (const capability of getCrudEntityCapabilityMatrix()) {
      expect(toolNames.has(DELETE_TOOL_BY_ENTITY[capability.entityType])).toBe(true);
    }
  });

  it("rejects mutating routes when no Forge apiToken is configured for a remote Forge base URL", async () => {
    const routes: RouteCall[] = [];
    registerForgePlugin({
      pluginConfig: {
        baseUrl: "https://forge.example.com"
      },
      registerHttpRoute(route) {
        routes.push(route);
      },
      registerTool() {}
    });

    const tasksRoute = routes.find((route) => route.path === "/forge/v1/tasks");
    expect(tasksRoute).toBeDefined();

    const request = Readable.from([JSON.stringify({ title: "Write docs" })]) as Readable & {
      headers: Record<string, string>;
      method: string;
      url: string;
    };
    request.headers = {};
    request.method = "POST";
    request.url = "/forge/v1/tasks";

    const response = createMockResponse();
    await tasksRoute?.handler(request as never, response as never);

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      ok: false,
      error: {
        code: "forge_plugin_token_required",
        message: "Forge apiToken is required for remote mutating plugin routes that cannot use local or Tailscale operator-session bootstrap"
      }
    });
  });

  it("allows local mutating routes without a token when operator-session bootstrap succeeds", async () => {
    const routes: RouteCall[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ session: { id: "ses_local" } }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": "forge_operator_session=fg_session_cookie; Path=/; HttpOnly"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ task: { id: "task_new" } }), {
          status: 201,
          headers: { "content-type": "application/json" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    registerForgePlugin({
      pluginConfig: {
        baseUrl: "http://127.0.0.1:3017",
        actorLabel: "aurel"
      },
      registerHttpRoute(route) {
        routes.push(route);
      },
      registerTool() {}
    });

    const tasksRoute = routes.find((route) => route.path === "/forge/v1/tasks");
    expect(tasksRoute).toBeDefined();

    const request = Readable.from([JSON.stringify({ title: "Write docs" })]) as Readable & {
      headers: Record<string, string>;
      method: string;
      url: string;
    };
    request.headers = {};
    request.method = "POST";
    request.url = "/forge/v1/tasks";

    const response = createMockResponse();
    await tasksRoute?.handler(request as never, response as never);

    expect(response.statusCode).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [bootstrapUrl] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(bootstrapUrl.toString()).toBe("http://127.0.0.1:3017/api/v1/auth/operator-session");
    const [writeUrl, writeInit] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(writeUrl.toString()).toBe("http://127.0.0.1:3017/api/v1/tasks");
    expect(writeInit.headers).toMatchObject({
      cookie: "forge_operator_session=fg_session_cookie",
      "x-forge-source": "openclaw",
      "x-forge-actor": "aurel",
      "content-type": "application/json"
    });
  });

  it("proxies dynamic project board routes to the live Forge API", async () => {
    const routes: RouteCall[] = [];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ board: { lanes: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    registerForgePlugin({
      pluginConfig: {
        baseUrl: "http://127.0.0.1:3017",
        apiToken: "fg_live_test",
        actorLabel: "aurel"
      },
      registerHttpRoute(route) {
        routes.push(route);
      },
      registerTool() {}
    });

    const projectsRoute = routes.find((route) => route.path === "/forge/v1/projects");
    expect(projectsRoute).toBeDefined();

    const request = Readable.from([]) as Readable & {
      headers: Record<string, string>;
      method: string;
      url: string;
    };
    request.headers = {};
    request.method = "GET";
    request.url = "/forge/v1/projects/project_123/board?lane=doing";

    const response = createMockResponse();
    await projectsRoute?.handler(request as never, response as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.toString()).toBe("http://127.0.0.1:3017/api/v1/projects/project_123/board?lane=doing");
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ board: { lanes: [] } });
  });

  it("proxies batch entity routes through the explicit plugin registry", async () => {
    const routes: RouteCall[] = [];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [{ ok: true }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    registerForgePlugin({
      pluginConfig: {
        baseUrl: "http://127.0.0.1:3017",
        apiToken: "fg_live_test",
        actorLabel: "aurel"
      },
      registerHttpRoute(route) {
        routes.push(route);
      },
      registerTool() {}
    });

    const entitiesRoute = routes.find((route) => route.path === "/forge/v1/entities");
    expect(entitiesRoute).toBeDefined();

    const scenarios = [
      {
        method: "POST",
        url: "/forge/v1/entities/create",
        payload: { operations: [{ entityType: "goal", data: { title: "Ship plugin" } }] },
        upstream: "http://127.0.0.1:3017/api/v1/entities/create"
      },
      {
        method: "POST",
        url: "/forge/v1/entities/update",
        payload: { operations: [{ entityType: "goal", id: "goal_1", data: { title: "Ship public plugin" } }] },
        upstream: "http://127.0.0.1:3017/api/v1/entities/update"
      },
      {
        method: "POST",
        url: "/forge/v1/entities/delete",
        payload: { operations: [{ entityType: "goal", id: "goal_1" }] },
        upstream: "http://127.0.0.1:3017/api/v1/entities/delete"
      },
      {
        method: "POST",
        url: "/forge/v1/entities/restore",
        payload: { operations: [{ entityType: "goal", id: "goal_1" }] },
        upstream: "http://127.0.0.1:3017/api/v1/entities/restore"
      },
      {
        method: "POST",
        url: "/forge/v1/entities/search",
        payload: { searches: [{ entityTypes: ["goal"], query: "plugin", limit: 5 }] },
        upstream: "http://127.0.0.1:3017/api/v1/entities/search"
      }
    ] as const;

    for (const scenario of scenarios) {
      const request = Readable.from([JSON.stringify(scenario.payload)]) as Readable & {
        headers: Record<string, string>;
        method: string;
        url: string;
      };
      request.headers = {};
      request.method = scenario.method;
      request.url = scenario.url;

      const response = createMockResponse();
      await entitiesRoute?.handler(request as never, response as never);
      expect(response.statusCode).toBe(200);
    }

    expect(fetchMock).toHaveBeenCalledTimes(scenarios.length);
    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(calledUrls).toEqual(scenarios.map((scenario) => scenario.upstream));
  });

  it("proxies new Psyche behavior routes through the explicit plugin registry", async () => {
    const routes: RouteCall[] = [];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ behaviors: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    registerForgePlugin({
      pluginConfig: {
        baseUrl: "http://127.0.0.1:3017",
        apiToken: "fg_live_test",
        actorLabel: "aurel"
      },
      registerHttpRoute(route) {
        routes.push(route);
      },
      registerTool() {}
    });

    const psycheRoute = routes.find((route) => route.path === "/forge/v1/psyche");
    expect(psycheRoute).toBeDefined();

    const request = Readable.from([]) as Readable & {
      headers: Record<string, string>;
      method: string;
      url: string;
    };
    request.headers = {};
    request.method = "GET";
    request.url = "/forge/v1/psyche/behaviors?kind=away";

    const response = createMockResponse();
    await psycheRoute?.handler(request as never, response as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.toString()).toBe("http://127.0.0.1:3017/api/v1/psyche/behaviors?kind=away");
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ behaviors: [] });
  });

  it("proxies the operator overview route through the explicit plugin registry", async () => {
    const routes: RouteCall[] = [];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ overview: { generatedAt: "2026-03-24T08:00:00.000Z" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    registerForgePlugin({
      pluginConfig: {
        baseUrl: "http://127.0.0.1:3017",
        apiToken: "fg_live_test",
        actorLabel: "aurel"
      },
      registerHttpRoute(route) {
        routes.push(route);
      },
      registerTool() {}
    });

    const operatorRoute = routes.find((route) => route.path === "/forge/v1/operator");
    expect(operatorRoute).toBeDefined();

    const request = Readable.from([]) as Readable & {
      headers: Record<string, string>;
      method: string;
      url: string;
    };
    request.headers = {};
    request.method = "GET";
    request.url = "/forge/v1/operator/overview";

    const response = createMockResponse();
    await operatorRoute?.handler(request as never, response as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.toString()).toBe("http://127.0.0.1:3017/api/v1/operator/overview");
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ overview: { generatedAt: "2026-03-24T08:00:00.000Z" } });
  });

  it("exports an SDK-native plugin entry with manifest-level metadata", () => {
    expect(pluginEntry).toMatchObject({
      id: "forge",
      name: "Forge",
      description: expect.any(String),
      configSchema: forgePluginConfigSchema,
      register: expect.any(Function)
    });
    expect(forgePluginConfigSchema.jsonSchema).toBeDefined();
    expect(forgePluginConfigSchema.uiHints).toBeDefined();
  });

  it("keeps a separate legacy entry for repo-local fallback installs", () => {
    expect(legacyPluginEntry).toMatchObject({
      id: "forge",
      name: "Forge",
      description: expect.any(String),
      configSchema: forgePluginConfigSchema,
      register: expect.any(Function)
    });
  });

  it("avoids deprecated and broad SDK imports in Forge plugin source", () => {
    const openclawDir = join(process.cwd(), "src/openclaw");
    const sourceFiles = collectTypeScriptFiles(openclawDir);
    expect(sourceFiles.length).toBeGreaterThan(0);

    for (const sourceFile of sourceFiles) {
      const source = readFileSync(sourceFile, "utf8");
      expect(source).not.toMatch(/["']openclaw\/plugin-sdk["']/);
      expect(source).not.toMatch(/["']openclaw\/plugin-sdk\/compat["']/);
      expect(source).not.toMatch(/["']openclaw\/extension-api["']/);
    }
  });

  it("keeps the public package metadata aligned with the root plugin manifest", () => {
    expect(publicPackageJson.private).not.toBe(true);
    expect(publicPackageJson.version).toBe(packageManifest.version);
    expect(publicPackageJson.description).toBe(packageManifest.description);
    expect(publicPackageJson.openclaw.extensions).toEqual(["./dist/openclaw/index.js"]);
    expect(rootPackageJson.openclaw.extensions).toEqual(["./src/openclaw/index.legacy.ts"]);
    expect(publicPackageJson.files).toEqual(expect.arrayContaining(["dist", "skills", "README.md", "openclaw.plugin.json"]));
  });

  it("runs doctor against health, overview, onboarding, and live route parity", async () => {
    const program = createCommand("root");
    const fetchMock = vi.fn(async (url: URL | string) => {
      const href = typeof url === "string" ? url : url.toString();
      if (href.endsWith("/api/v1/health")) {
        return new Response(JSON.stringify({ ok: true, apiVersion: "v1" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (href.endsWith("/api/v1/operator/overview")) {
        return new Response(
          JSON.stringify({
            overview: {
              warnings: ["Psyche summary omitted because the active token does not include psyche.read."],
              capabilities: {
                canReadPsyche: false,
                canManageRewards: true
              }
            }
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }
      if (href.endsWith("/api/v1/agents/onboarding")) {
        return new Response(JSON.stringify({ onboarding: { forgeBaseUrl: "http://127.0.0.1:3017" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (href.endsWith("/api/v1/openapi.json")) {
        return new Response(
          JSON.stringify({
            paths: {
              "/api/v1/health": { get: {} },
              "/api/v1/operator/overview": { get: {} }
            }
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }
      throw new Error(`Unexpected fetch URL: ${href}`);
    });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);

    registerForgePlugin({
      pluginConfig: {
        baseUrl: "http://127.0.0.1:3017",
        apiToken: "fg_live_test",
        actorLabel: "aurel"
      },
      registerHttpRoute() {},
      registerTool() {},
      registerCli(registrar) {
        registrar({
          program: program as never,
          config: {} as never,
          logger: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn()
          } as never
        });
      }
    });

    const forgeCommand = program.children.find((child) => child.name === "forge");
    const doctorCommand = forgeCommand?.children.find((child) => child.name === "doctor");
    expect(doctorCommand).toBeDefined();

    await doctorCommand?.actions[0]?.();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const doctorOutput = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      operatorSessionBootstrapAvailable?: boolean;
      warnings: string[];
      routeParity: { uncovered: string[] };
      overview: { overview: { capabilities: { canReadPsyche: boolean } } };
    };
    expect(doctorOutput.ok).toBe(true);
    expect(doctorOutput.operatorSessionBootstrapAvailable).toBe(true);
    expect(doctorOutput.warnings).toContain("Psyche summary omitted because the active token does not include psyche.read.");
    expect(doctorOutput.warnings).toContain("The configured token cannot read Psyche state. Sensitive reflection routes and summaries will stay partial.");
    expect(doctorOutput.routeParity.uncovered).toEqual([]);
    expect(doctorOutput.overview.overview.capabilities.canReadPsyche).toBe(false);
  });
});
