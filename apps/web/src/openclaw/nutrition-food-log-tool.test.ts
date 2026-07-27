import { afterEach, describe, expect, it, vi } from "vitest";
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
  parameters?: {
    additionalProperties?: boolean;
    required?: string[];
    properties?: Record<string, Record<string, unknown>>;
  };
  execute?: (
    toolCallId: string,
    params: Record<string, unknown>
  ) => Promise<unknown>;
};

const mockedCallConfiguredForgeApi = vi.mocked(callConfiguredForgeApi);

function collectTools(options: { baseUrl?: string; apiToken?: string } = {}) {
  const tools: RegisteredTool[] = [];
  const baseUrl = options.baseUrl ?? "http://127.0.0.1:4317";
  registerForgePluginTools(
    {
      registerTool(tool: unknown) {
        if (typeof tool !== "function") {
          tools.push(tool as RegisteredTool);
        }
      }
    } as never,
    {
      origin: baseUrl,
      port: 4317,
      baseUrl,
      webAppUrl: `${baseUrl}/forge/`,
      portSource: "default",
      dataRoot: "",
      apiToken: options.apiToken ?? "fg_scoped_test",
      actorLabel: "Codex",
      injectBootstrapContext: true,
      timeoutMs: 15_000
    }
  );
  return tools;
}

function requireUpdateTool(options?: { baseUrl?: string; apiToken?: string }) {
  const tool = collectTools(options).find(
    (entry) => entry.name === "forge_update_food_log"
  );
  expect(tool).toBeDefined();
  return tool as RegisteredTool;
}

afterEach(() => {
  mockedCallConfiguredForgeApi.mockReset();
});

describe("nutrition food-log edit tool", () => {
  it("requires one exact log id while keeping all patch fields optional", () => {
    const schema = requireUpdateTool().parameters;

    expect(schema?.additionalProperties).toBe(false);
    expect(schema?.required).toEqual(["foodLogId"]);
    expect(schema?.properties?.foodLogId).toMatchObject({
      type: "string",
      minLength: 1
    });
    expect(schema?.properties?.items).toMatchObject({
      type: "array",
      minItems: 1
    });
    expect(schema?.properties?.dayKey).toBeDefined();
    expect(schema?.properties?.parserProvenance).toBeDefined();
    expect(schema?.properties?.satietyScore).toBeUndefined();
  });

  it("sends a scoped PATCH to only the exact encoded food-log id", async () => {
    mockedCallConfiguredForgeApi.mockResolvedValue({
      status: 200,
      body: {
        log: {
          id: "meal/123",
          mealLabel: "Corrected lunch"
        }
      }
    });
    const tool = requireUpdateTool();

    await expect(
      tool.execute?.("edit-food-log", {
        foodLogId: " meal/123 ",
        userIds: ["user_albert"],
        mealLabel: "Corrected lunch",
        notes: "Corrected after reviewing the original log"
      })
    ).resolves.toBeDefined();

    expect(mockedCallConfiguredForgeApi).toHaveBeenCalledWith(
      expect.objectContaining({ apiToken: "fg_scoped_test" }),
      {
        method: "PATCH",
        path: "/api/v1/health/weight-loss/food-logs/meal%2F123?userIds=user_albert",
        body: {
          mealLabel: "Corrected lunch",
          notes: "Corrected after reviewing the original log"
        }
      }
    );
  });

  it("rejects an unpaired remote edit before any API request", async () => {
    const tool = requireUpdateTool({
      baseUrl: "https://forge.example.test",
      apiToken: ""
    });

    await expect(
      tool.execute?.("edit-food-log", {
        foodLogId: "meal_123",
        mealLabel: "Corrected lunch"
      })
    ).rejects.toMatchObject({
      code: "forge_plugin_token_required"
    });
    expect(mockedCallConfiguredForgeApi).not.toHaveBeenCalled();
  });
});
