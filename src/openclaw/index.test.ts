import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getForgeRuntimeStatus, primeForgeRuntime, restartForgeRuntime, startForgeRuntime, stopForgeRuntime } from "./local-runtime";

vi.mock("./local-runtime", () => ({
  ensureForgeRuntimeReady: vi.fn().mockResolvedValue(undefined),
  primeForgeRuntime: vi.fn(),
  startForgeRuntime: vi.fn().mockResolvedValue({
    ok: true,
    started: true,
    managed: true,
    message: "Started the plugin-managed Forge runtime on http://127.0.0.1:4317.",
    pid: 12345,
    baseUrl: "http://127.0.0.1:4317"
  }),
  stopForgeRuntime: vi.fn().mockResolvedValue({
    ok: true,
    stopped: true,
    managed: true,
    message: "Stopped the plugin-managed Forge runtime on http://127.0.0.1:4317.",
    pid: 12345
  }),
  restartForgeRuntime: vi.fn().mockResolvedValue({
    ok: true,
    restarted: true,
    managed: true,
    message: "Restarted the plugin-managed Forge runtime on http://127.0.0.1:4317.",
    pid: 12345,
    baseUrl: "http://127.0.0.1:4317"
  }),
  getForgeRuntimeStatus: vi.fn().mockResolvedValue({
    ok: true,
    running: true,
    healthy: true,
    managed: true,
    message: "Forge is running and healthy on http://127.0.0.1:4317.",
    pid: 12345,
    baseUrl: "http://127.0.0.1:4317"
  })
}));

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

describe("forge openclaw plugin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("normalizes plugin config defaults", () => {
    expect(resolveForgePluginConfig(undefined)).toEqual({
      origin: "http://127.0.0.1",
      port: 4317,
      baseUrl: "http://127.0.0.1:4317",
      webAppUrl: "http://127.0.0.1:4317/forge/",
      dataRoot: "",
      apiToken: "",
      actorLabel: "aurel",
      timeoutMs: 15000
    });
  });

  it("registers the curated Forge route groups, tools, and CLI commands", () => {
    const routes: RouteCall[] = [];
    const tools: ToolCall[] = [];
    const program = createCommand("root");

    registerForgePlugin({
      pluginConfig: {
        origin: "http://127.0.0.1",
        port: 4317,
        dataRoot: "/tmp/forge-data",
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
    expect(routes.map((route) => route.path)).toEqual([
      "/forge/v1/health",
      "/forge/v1/operator/overview",
      "/forge/v1/operator/context",
      "/forge/v1/agents/onboarding",
      "/forge/v1/psyche/overview",
      "/forge/v1/metrics/xp",
      "/forge/v1/reviews/weekly",
      "/forge/v1/operator/log-work",
      "/forge/v1/insights",
      "/forge/v1/entities",
      "/forge/v1/tasks",
      "/forge/v1/task-runs",
      "/forge/v1/ui"
    ]);
    expect(routes.find((route) => route.path === "/forge/v1/entities")?.match).toBe("prefix");
    expect(routes.find((route) => route.path === "/forge/v1/tasks")?.match).toBe("prefix");
    expect(routes.find((route) => route.path === "/forge/v1/task-runs")?.match).toBe("prefix");

    const toolNames = tools.map((tool) => tool.name).sort();
    expect(toolNames).toEqual([
      "forge_complete_task_run",
      "forge_create_entities",
      "forge_delete_entities",
      "forge_focus_task_run",
      "forge_get_agent_onboarding",
      "forge_get_current_work",
      "forge_get_operator_context",
      "forge_get_operator_overview",
      "forge_get_psyche_overview",
      "forge_get_ui_entrypoint",
      "forge_get_weekly_review",
      "forge_get_xp_metrics",
      "forge_heartbeat_task_run",
      "forge_log_work",
      "forge_post_insight",
      "forge_release_task_run",
      "forge_restore_entities",
      "forge_search_entities",
      "forge_start_task_run",
      "forge_update_entities"
    ]);

    expect(program.children[0]?.name).toBe("forge");
    expect(program.children[0]?.children.map((child: MockCommand) => child.name)).toEqual([
      "health",
      "overview",
      "onboarding",
      "ui",
      "start",
      "stop",
      "restart",
      "status",
      "doctor",
      "route-check"
    ]);
    expect(primeForgeRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "http://127.0.0.1",
        port: 4317,
        dataRoot: "/tmp/forge-data"
      })
    );
  });

  it("exposes forge runtime lifecycle CLI actions for plugin-managed local runtimes", async () => {
    const program = createCommand("root");
    vi.spyOn(console, "log").mockImplementation(() => {});
    registerForgePlugin({
      pluginConfig: {
        origin: "http://127.0.0.1",
        port: 4317
      },
      registerHttpRoute() {},
      registerTool() {},
      registerCli(registrar) {
        registrar({
          program: program as never,
          config: {} as never,
          logger: {} as never
        });
      }
    });

    const forgeCommand = program.children[0];
    const startCommand = forgeCommand?.children.find((child) => child.name === "start");
    const stopCommand = forgeCommand?.children.find((child) => child.name === "stop");
    const restartCommand = forgeCommand?.children.find((child) => child.name === "restart");
    const statusCommand = forgeCommand?.children.find((child) => child.name === "status");
    expect(startCommand).toBeDefined();
    expect(stopCommand).toBeDefined();
    expect(restartCommand).toBeDefined();
    expect(statusCommand).toBeDefined();
    expect(startCommand?.actions).toHaveLength(1);
    expect(stopCommand?.actions).toHaveLength(1);
    expect(restartCommand?.actions).toHaveLength(1);
    expect(statusCommand?.actions).toHaveLength(1);

    await startCommand?.actions[0]?.();

    await stopCommand?.actions[0]?.();
    await restartCommand?.actions[0]?.();
    await statusCommand?.actions[0]?.();

    expect(startForgeRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "http://127.0.0.1",
        port: 4317
      })
    );
    expect(stopForgeRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "http://127.0.0.1",
        port: 4317
      })
    );
    expect(restartForgeRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "http://127.0.0.1",
        port: 4317
      })
    );
    expect(getForgeRuntimeStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "http://127.0.0.1",
        port: 4317
      })
    );
  });

  it("rejects remote mutations when no Forge apiToken is configured", async () => {
    const routes: RouteCall[] = [];
    registerForgePlugin({
      pluginConfig: {
        origin: "https://forge.example.com",
        port: 443
      },
      registerHttpRoute(route) {
        routes.push(route);
      },
      registerTool() {}
    });

    const entitiesRoute = routes.find((route) => route.path === "/forge/v1/entities");
    expect(entitiesRoute).toBeDefined();

    const request = Readable.from([JSON.stringify({ searches: [] })]) as Readable & {
      headers: Record<string, string>;
      method: string;
      url: string;
    };
    request.headers = {};
    request.method = "POST";
    request.url = "/forge/v1/entities/search";

    const response = createMockResponse();
    await entitiesRoute?.handler(request as never, response as never);

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      ok: false,
      error: {
        code: "forge_plugin_token_required",
        message: "Forge apiToken is required for remote plugin mutations when this target cannot use local or Tailscale operator-session bootstrap"
      }
    });
  });

  it("bootstraps a local operator session for entity workflow requests", async () => {
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
        new Response(JSON.stringify({ ok: true, results: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const routes: RouteCall[] = [];
    registerForgePlugin({
      pluginConfig: {
        origin: "http://127.0.0.1",
        port: 4317,
        actorLabel: "aurel"
      },
      registerHttpRoute(route) {
        routes.push(route);
      },
      registerTool() {}
    });

    const entitiesRoute = routes.find((route) => route.path === "/forge/v1/entities");
    const request = Readable.from([JSON.stringify({ searches: [] })]) as Readable & {
      headers: Record<string, string>;
      method: string;
      url: string;
    };
    request.headers = {};
    request.method = "POST";
    request.url = "/forge/v1/entities/search";

    const response = createMockResponse();
    await entitiesRoute?.handler(request as never, response as never);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [bootstrapUrl] = fetchMock.mock.calls[0] as [URL];
    expect(bootstrapUrl.toString()).toBe("http://127.0.0.1:4317/api/v1/auth/operator-session");
    const [writeUrl] = fetchMock.mock.calls[1] as [URL];
    expect(writeUrl.toString()).toBe("http://127.0.0.1:4317/api/v1/entities/search");
    expect(response.statusCode).toBe(200);
  });

  it("redirects the plugin UI route to the live Forge web app URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          onboarding: {
            webAppUrl: "http://127.0.0.1:4317/forge/"
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const routes: RouteCall[] = [];
    registerForgePlugin({
      pluginConfig: {
        origin: "http://127.0.0.1",
        port: 4317,
        apiToken: "fg_live_test",
        actorLabel: "aurel"
      },
      registerHttpRoute(route) {
        routes.push(route);
      },
      registerTool() {}
    });

    const uiRoute = routes.find((route) => route.path === "/forge/v1/ui");
    const request = Readable.from([]) as Readable & {
      headers: Record<string, string>;
      method: string;
      url: string;
    };
    request.headers = {};
    request.method = "GET";
    request.url = "/forge/v1/ui";

    const response = createMockResponse();
    await uiRoute?.handler(request as never, response as never);

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("http://127.0.0.1:4317/forge/");
  });

  it("exports SDK-native and legacy plugin entries with the same metadata", () => {
    expect(pluginEntry).toMatchObject({
      id: "forge-openclaw-plugin",
      name: "Forge",
      description: expect.any(String),
      configSchema: forgePluginConfigSchema,
      register: expect.any(Function)
    });
    expect(legacyPluginEntry).toMatchObject({
      id: "forge-openclaw-plugin",
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

  it("keeps public package metadata aligned with the root plugin manifest", () => {
    expect(publicPackageJson.private).not.toBe(true);
    expect(publicPackageJson.version).toBe(packageManifest.version);
    expect(publicPackageJson.description).toBe(packageManifest.description);
    expect(publicPackageJson.openclaw.extensions).toEqual(["./dist/openclaw/index.js"]);
    expect(publicPackageJson.files).toContain("server");
    expect(rootPackageJson.openclaw.extensions).toEqual(["./src/openclaw/index.legacy.ts"]);
  });
});
