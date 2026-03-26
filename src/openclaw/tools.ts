import { Type, type TObject, type TProperties } from "@sinclair/typebox";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { callConfiguredForgeApi, expectForgeSuccess, requireApiToken, type ForgePluginConfig } from "./api-client.js";
import type { ForgePluginToolApi } from "./plugin-sdk-types.js";

type StaticLike<T> = T extends TObject<infer _P> ? Record<string, unknown> : never;

function jsonResult<T>(payload: T): AgentToolResult<T> {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ],
    details: payload
  };
}

async function runRead(config: ForgePluginConfig, path: string) {
  const result = await callConfiguredForgeApi(config, {
    method: "GET",
    path
  });
  return expectForgeSuccess(result);
}

async function runWrite(
  config: ForgePluginConfig,
  options: {
    method: "POST" | "PATCH" | "DELETE";
    path: string;
    body?: unknown;
  }
) {
  requireApiToken(config);
  const result = await callConfiguredForgeApi(config, {
    method: options.method,
    path: options.path,
    body: options.body
  });
  return expectForgeSuccess(result);
}

const emptyObjectSchema = Type.Object({});
const optionalString = () => Type.Optional(Type.String());
const optionalNullableString = () => Type.Optional(Type.Union([Type.String(), Type.Null()]));
const optionalDeleteMode = () => Type.Optional(Type.Union([Type.Literal("soft"), Type.Literal("hard")]));

async function resolveUiEntrypoint(config: ForgePluginConfig) {
  let webAppUrl = config.webAppUrl;

  try {
    const onboarding = await runRead(config, "/api/v1/agents/onboarding");
    if (
      typeof onboarding === "object" &&
      onboarding !== null &&
      "onboarding" in onboarding &&
      typeof onboarding.onboarding === "object" &&
      onboarding.onboarding !== null &&
      "webAppUrl" in onboarding.onboarding &&
      typeof onboarding.onboarding.webAppUrl === "string" &&
      onboarding.onboarding.webAppUrl.trim().length > 0
    ) {
      webAppUrl = onboarding.onboarding.webAppUrl;
    }
  } catch {
    // Fall back to the derived UI URL from config when onboarding is unavailable.
  }

  return {
    webAppUrl,
    pluginUiRoute: "/forge/v1/ui",
    note: "You can continue directly in the Forge UI when a visual workflow is easier for review, Kanban, or Psyche exploration."
  };
}

function registerReadTool<T extends TObject<TProperties>>(
  api: ForgePluginToolApi,
  config: ForgePluginConfig,
  options: {
    name: string;
    label: string;
    description: string;
    parameters?: T;
    path: (params: StaticLike<T>) => string;
  }
) {
  api.registerTool({
    name: options.name,
    label: options.label,
    description: options.description,
    parameters: options.parameters ?? emptyObjectSchema,
    async execute(_toolCallId, params) {
      return jsonResult(await runRead(config, options.path((params ?? {}) as StaticLike<T>)));
    }
  });
}

function registerWriteTool<T extends TObject<TProperties>>(
  api: ForgePluginToolApi,
  config: ForgePluginConfig,
  options: {
    name: string;
    label: string;
    description: string;
    parameters: T;
    method: "POST" | "PATCH" | "DELETE";
    path: string;
    body?: (params: StaticLike<T>) => unknown;
  }
) {
  api.registerTool({
    name: options.name,
    label: options.label,
    description: options.description,
    parameters: options.parameters,
    async execute(_toolCallId, params) {
      const typed = params as StaticLike<T>;
      return jsonResult(
        await runWrite(config, {
          method: options.method,
          path: options.path,
          body: options.body ? options.body(typed) : typed
        })
      );
    }
  });
}

export function registerForgePluginTools(api: ForgePluginToolApi, config: ForgePluginConfig) {
  registerReadTool(api, config, {
    name: "forge_get_operator_overview",
    label: "Forge Operator Overview",
    description: "Read the one-shot Forge operator overview with current priorities, momentum, and onboarding guidance.",
    path: () => "/api/v1/operator/overview"
  });

  registerReadTool(api, config, {
    name: "forge_get_agent_onboarding",
    label: "Forge Agent Onboarding",
    description: "Fetch the live Forge onboarding contract with UI URL, recommended workflow, and verification guidance.",
    path: () => "/api/v1/agents/onboarding"
  });

  api.registerTool({
    name: "forge_get_ui_entrypoint",
    label: "Forge UI Entrypoint",
    description: "Get the live Forge web UI URL and the plugin redirect route so the user can continue directly in the visual interface.",
    parameters: emptyObjectSchema,
    async execute() {
      return jsonResult(await resolveUiEntrypoint(config));
    }
  });

  registerWriteTool(api, config, {
    name: "forge_search_entities",
    label: "Search Forge Entities",
    description: "Search Forge entities in one batch request before creating or updating to avoid duplicates.",
    parameters: Type.Object({
      searches: Type.Array(
        Type.Object({
          entityTypes: Type.Optional(Type.Array(Type.String())),
          query: optionalString(),
          ids: Type.Optional(Type.Array(Type.String())),
          status: Type.Optional(Type.Array(Type.String())),
          linkedTo: Type.Optional(
            Type.Object({
              entityType: Type.String({ minLength: 1 }),
              id: Type.String({ minLength: 1 })
            })
          ),
          includeDeleted: Type.Optional(Type.Boolean()),
          limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
          clientRef: optionalString()
        })
      )
    }),
    method: "POST",
    path: "/api/v1/entities/search"
  });

  registerWriteTool(api, config, {
    name: "forge_create_entities",
    label: "Create Forge Entities",
    description: "Create one or more Forge entities through the ordered batch entity workflow.",
    parameters: Type.Object({
      atomic: Type.Optional(Type.Boolean()),
      operations: Type.Array(
        Type.Object({
          entityType: Type.String({ minLength: 1 }),
          data: Type.Record(Type.String(), Type.Any()),
          clientRef: optionalString()
        })
      )
    }),
    method: "POST",
    path: "/api/v1/entities/create"
  });

  registerWriteTool(api, config, {
    name: "forge_update_entities",
    label: "Update Forge Entities",
    description: "Update one or more Forge entities through the ordered batch entity workflow.",
    parameters: Type.Object({
      atomic: Type.Optional(Type.Boolean()),
      operations: Type.Array(
        Type.Object({
          entityType: Type.String({ minLength: 1 }),
          id: Type.String({ minLength: 1 }),
          patch: Type.Record(Type.String(), Type.Any()),
          clientRef: optionalString()
        })
      )
    }),
    method: "POST",
    path: "/api/v1/entities/update"
  });

  registerWriteTool(api, config, {
    name: "forge_delete_entities",
    label: "Delete Forge Entities",
    description: "Delete Forge entities in one batch request. Delete defaults to soft mode unless hard is requested explicitly.",
    parameters: Type.Object({
      atomic: Type.Optional(Type.Boolean()),
      operations: Type.Array(
        Type.Object({
          entityType: Type.String({ minLength: 1 }),
          id: Type.String({ minLength: 1 }),
          mode: optionalDeleteMode(),
          reason: optionalString(),
          clientRef: optionalString()
        })
      )
    }),
    method: "POST",
    path: "/api/v1/entities/delete"
  });

  registerWriteTool(api, config, {
    name: "forge_restore_entities",
    label: "Restore Forge Entities",
    description: "Restore soft-deleted Forge entities from the settings bin through the batch entity workflow.",
    parameters: Type.Object({
      atomic: Type.Optional(Type.Boolean()),
      operations: Type.Array(
        Type.Object({
          entityType: Type.String({ minLength: 1 }),
          id: Type.String({ minLength: 1 }),
          clientRef: optionalString()
        })
      )
    }),
    method: "POST",
    path: "/api/v1/entities/restore"
  });

  registerWriteTool(api, config, {
    name: "forge_post_insight",
    label: "Forge Post Insight",
    description: "Post a structured Forge insight after reading the overview. This stores an agent-authored observation or recommendation with provenance.",
    parameters: Type.Object({
      entityType: optionalNullableString(),
      entityId: optionalNullableString(),
      timeframeLabel: optionalNullableString(),
      title: Type.String({ minLength: 1 }),
      summary: Type.String({ minLength: 1 }),
      recommendation: Type.String({ minLength: 1 }),
      rationale: optionalString(),
      confidence: Type.Optional(Type.Number()),
      visibility: optionalString(),
      ctaLabel: optionalString()
    }),
    method: "POST",
    path: "/api/v1/insights",
    body: (params) => ({
      originType: "agent",
      originAgentId: null,
      originLabel: config.actorLabel || "OpenClaw",
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
      timeframeLabel: params.timeframeLabel ?? null,
      title: params.title,
      summary: params.summary,
      recommendation: params.recommendation,
      rationale: typeof params.rationale === "string" ? params.rationale : "",
      confidence: params.confidence,
      visibility: params.visibility,
      ctaLabel: typeof params.ctaLabel === "string" ? params.ctaLabel : "Review insight"
    })
  });
}
