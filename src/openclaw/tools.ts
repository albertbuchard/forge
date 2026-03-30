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

async function resolveCurrentWork(config: ForgePluginConfig) {
  const payload = await runRead(config, "/api/v1/operator/context");
  const context =
    typeof payload === "object" && payload !== null && "context" in payload && typeof payload.context === "object" && payload.context !== null
      ? (payload.context as Record<string, unknown>)
      : null;

  const recentTaskRuns = Array.isArray(context?.recentTaskRuns) ? context.recentTaskRuns : [];
  const activeTaskRuns = recentTaskRuns.filter(
    (run) => typeof run === "object" && run !== null && "status" in run && run.status === "active"
  );
  const focusTasks = Array.isArray(context?.focusTasks) ? context.focusTasks : [];

  return {
    generatedAt: typeof context?.generatedAt === "string" ? context.generatedAt : new Date().toISOString(),
    activeTaskRuns,
    focusTasks,
    recommendedNextTask: context?.recommendedNextTask ?? null,
    xp: context?.xp ?? null
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
    description: "Start here for most Forge work. Read the one-shot operator overview with current priorities, momentum, and onboarding guidance before searching or mutating.",
    path: () => "/api/v1/operator/overview"
  });

  registerReadTool(api, config, {
    name: "forge_get_operator_context",
    label: "Forge Operator Context",
    description: "Read the current operational task board, focus queue, recent task runs, and XP state. Use this for current-work questions and work runtime decisions.",
    path: () => "/api/v1/operator/context"
  });

  registerReadTool(api, config, {
    name: "forge_get_agent_onboarding",
    label: "Forge Agent Onboarding",
    description: "Fetch the live Forge onboarding contract with the exact Forge tool list, batch payload rules, UI handoff rules, and verification guidance.",
    path: () => "/api/v1/agents/onboarding"
  });

  api.registerTool({
    name: "forge_get_ui_entrypoint",
    label: "Forge UI Entrypoint",
    description: "Get the live Forge web UI URL and plugin redirect route. Use this only when visual review or editing is genuinely easier, not as a substitute for normal batch entity creation or updates.",
    parameters: emptyObjectSchema,
    async execute() {
      return jsonResult(await resolveUiEntrypoint(config));
    }
  });

  registerReadTool(api, config, {
    name: "forge_get_psyche_overview",
    label: "Forge Psyche Overview",
    description: "Read the aggregate Psyche state across values, patterns, behaviors, beliefs, modes, and trigger reports before making Psyche recommendations or updates.",
    path: () => "/api/v1/psyche/overview"
  });

  registerReadTool(api, config, {
    name: "forge_get_xp_metrics",
    label: "Forge XP Metrics",
    description: "Read the live XP, level, streak, momentum, and reward metrics.",
    path: () => "/api/v1/metrics/xp"
  });

  registerReadTool(api, config, {
    name: "forge_get_weekly_review",
    label: "Forge Weekly Review",
    description: "Read the current weekly review payload with wins, trends, and reward framing.",
    path: () => "/api/v1/reviews/weekly"
  });

  api.registerTool({
    name: "forge_get_current_work",
    label: "Forge Current Work",
    description: "Get the current live-work picture: active task runs, focus tasks, the recommended next task, and current XP state.",
    parameters: emptyObjectSchema,
    async execute() {
      return jsonResult(await resolveCurrentWork(config));
    }
  });

  registerWriteTool(api, config, {
    name: "forge_search_entities",
    label: "Search Forge Entities",
    description: "Search Forge entities before creating or updating to avoid duplicates. Pass `searches` as an array, even for one search.",
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
    description: "Create one or more Forge entities through the ordered batch workflow. Pass `operations` as an array. Each operation must include `entityType` and full `data`. Batch several creates together in one call when possible.",
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
    description: "Update one or more Forge entities through the ordered batch workflow. Pass `operations` as an array. Each operation must include `entityType`, `id`, and `patch`.",
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
    description: "Delete Forge entities in one batch request. Pass `operations` as an array with `entityType` and `id`. Delete defaults to soft mode unless hard is requested explicitly.",
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
    description: "Restore soft-deleted Forge entities from the settings bin through the batch workflow. Pass `operations` as an array with `entityType` and `id`.",
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
    name: "forge_grant_reward_bonus",
    label: "Forge Grant Reward Bonus",
    description: "Grant an explicit manual XP bonus or penalty with provenance. Use only for auditable operator judgement beyond the normal task-run and habit reward flows.",
    parameters: Type.Object({
      entityType: Type.String({ minLength: 1 }),
      entityId: Type.String({ minLength: 1 }),
      deltaXp: Type.Number(),
      reasonTitle: Type.String({ minLength: 1 }),
      reasonSummary: optionalString(),
      metadata: Type.Optional(Type.Record(Type.String(), Type.Any()))
    }),
    method: "POST",
    path: "/api/v1/rewards/bonus"
  });

  registerWriteTool(api, config, {
    name: "forge_adjust_work_minutes",
    label: "Forge Adjust Work Minutes",
    description: "Add or remove tracked work minutes on an existing task or project without creating a live task run. Forge applies symmetric XP changes when the total crosses reward buckets.",
    parameters: Type.Object({
      entityType: Type.Union([Type.Literal("task"), Type.Literal("project")]),
      entityId: Type.String({ minLength: 1 }),
      deltaMinutes: Type.Integer(),
      note: optionalString()
    }),
    method: "POST",
    path: "/api/v1/work-adjustments"
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

  registerWriteTool(api, config, {
    name: "forge_log_work",
    label: "Forge Log Work",
    description: "Log retroactive work or mark an existing task as completed through the operator work-log flow. Use this when the user already did the work and wants truthful evidence plus XP.",
    parameters: Type.Object({
      taskId: optionalString(),
      title: optionalString(),
      description: optionalString(),
      summary: Type.Optional(Type.String()),
      goalId: optionalNullableString(),
      projectId: optionalNullableString(),
      owner: optionalString(),
      status: optionalString(),
      priority: optionalString(),
      dueDate: optionalNullableString(),
      effort: optionalString(),
      energy: optionalString(),
      points: Type.Optional(Type.Integer({ minimum: 5, maximum: 500 })),
      tagIds: Type.Optional(Type.Array(Type.String()))
    }),
    method: "POST",
    path: "/api/v1/operator/log-work"
  });

  api.registerTool({
    name: "forge_start_task_run",
    label: "Forge Start Task Run",
    description: "Start real live work on a task. This creates or reuses a task run and is the truthful way to start work, not just changing task status.",
    parameters: Type.Object({
      taskId: Type.String({ minLength: 1 }),
      actor: Type.String({ minLength: 1 }),
      timerMode: Type.Optional(Type.Union([Type.Literal("planned"), Type.Literal("unlimited")])),
      plannedDurationSeconds: Type.Optional(Type.Union([Type.Integer({ minimum: 60, maximum: 86400 }), Type.Null()])),
      isCurrent: Type.Optional(Type.Boolean()),
      leaseTtlSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 14400 })),
      note: Type.Optional(Type.String())
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: `/api/v1/tasks/${typed.taskId as string}/runs`,
          body: {
            actor: typed.actor,
            timerMode: typed.timerMode,
            plannedDurationSeconds: typed.plannedDurationSeconds,
            isCurrent: typed.isCurrent,
            leaseTtlSeconds: typed.leaseTtlSeconds,
            note: typed.note
          }
        })
      );
    }
  });

  api.registerTool({
    name: "forge_heartbeat_task_run",
    label: "Forge Heartbeat Task Run",
    description: "Refresh the lease on an active task run while work is continuing.",
    parameters: Type.Object({
      taskRunId: Type.String({ minLength: 1 }),
      actor: optionalString(),
      leaseTtlSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 14400 })),
      note: Type.Optional(Type.String())
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: `/api/v1/task-runs/${typed.taskRunId as string}/heartbeat`,
          body: {
            actor: typed.actor,
            leaseTtlSeconds: typed.leaseTtlSeconds,
            note: typed.note
          }
        })
      );
    }
  });

  api.registerTool({
    name: "forge_focus_task_run",
    label: "Forge Focus Task Run",
    description: "Mark an active task run as the current focused run when several runs exist.",
    parameters: Type.Object({
      taskRunId: Type.String({ minLength: 1 }),
      actor: optionalString()
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: `/api/v1/task-runs/${typed.taskRunId as string}/focus`,
          body: {
            actor: typed.actor
          }
        })
      );
    }
  });

  api.registerTool({
    name: "forge_complete_task_run",
    label: "Forge Complete Task Run",
    description: "Finish an active task run as completed work and let Forge award the appropriate completion rewards.",
    parameters: Type.Object({
      taskRunId: Type.String({ minLength: 1 }),
      actor: optionalString(),
      note: Type.Optional(Type.String())
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: `/api/v1/task-runs/${typed.taskRunId as string}/complete`,
          body: {
            actor: typed.actor,
            note: typed.note
          }
        })
      );
    }
  });

  api.registerTool({
    name: "forge_release_task_run",
    label: "Forge Release Task Run",
    description: "Stop an active task run without completing it. Use this to truthfully stop current work.",
    parameters: Type.Object({
      taskRunId: Type.String({ minLength: 1 }),
      actor: optionalString(),
      note: Type.Optional(Type.String())
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: `/api/v1/task-runs/${typed.taskRunId as string}/release`,
          body: {
            actor: typed.actor,
            note: typed.note
          }
        })
      );
    }
  });
}
