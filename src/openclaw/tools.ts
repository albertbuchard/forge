import { Type, type TObject, type TProperties } from "@sinclair/typebox";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { callForgeApi, expectForgeSuccess, requireApiToken, type ForgePluginConfig } from "./api-client.js";
import type { ForgePluginToolApi } from "./plugin-sdk-types.js";

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
  const result = await callForgeApi({
    baseUrl: config.baseUrl,
    apiToken: config.apiToken,
    actorLabel: config.actorLabel,
    timeoutMs: config.timeoutMs,
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
  const result = await callForgeApi({
    baseUrl: config.baseUrl,
    apiToken: config.apiToken,
    actorLabel: config.actorLabel,
    timeoutMs: config.timeoutMs,
    method: options.method,
    path: options.path,
    body: options.body
  });
  return expectForgeSuccess(result);
}

type ToolProperties = TProperties;

const emptyObjectSchema = Type.Object({});
const optionalString = () => Type.Optional(Type.String());
const optionalNullableString = () => Type.Optional(Type.Union([Type.String(), Type.Null()]));
const stringArray = () => Type.Array(Type.String());
const optionalStringArray = () => Type.Optional(stringArray());
const optionalDeleteMode = () => Type.Optional(Type.Union([Type.Literal("soft"), Type.Literal("hard")]));
const taskTimerModeSchema = Type.Union([Type.Literal("planned"), Type.Literal("unlimited")]);
const timeAccountingModeSchema = Type.Union([
  Type.Literal("split"),
  Type.Literal("parallel"),
  Type.Literal("primary_only")
]);

function withId(properties: ToolProperties) {
  return Type.Object({
    id: Type.String({ minLength: 1 }),
    ...properties
  });
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
    path: (params: StaticLike<T>) => string;
    body?: (params: StaticLike<T>) => unknown;
    bodyless?: boolean;
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
          path: options.path(typed),
          body: options.bodyless ? undefined : options.body ? options.body(typed) : typed
        })
      );
    }
  });
}

function buildQuery(params: Record<string, unknown>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value.trim().length > 0) {
      search.set(key, value.trim());
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      search.set(key, String(value));
    }
  }
  return search.toString();
}

function buildQueryPath(path: string, params: Record<string, unknown>) {
  const suffix = buildQuery(params);
  return suffix ? `${path}?${suffix}` : path;
}

function buildDeletePath(path: string, params: Record<string, unknown>) {
  return buildQueryPath(path, {
    mode: params.mode,
    reason: params.reason
  });
}

type StaticLike<T> = T extends TObject<infer _P> ? Record<string, unknown> : never;

function registerPsycheCrudTools(
  api: ForgePluginToolApi,
  config: ForgePluginConfig,
  options: {
    pluralName: string;
    singularName: string;
    label: string;
    createShape: ToolProperties;
    updateShape: ToolProperties;
  }
) {
  const basePath = `/api/v1/psyche/${options.pluralName}`;
  const singularLabel = options.label;

  registerReadTool(api, config, {
    name: `forge_list_psyche_${options.pluralName.replaceAll("-", "_")}`,
    label: `Forge ${singularLabel}`,
    description: `List Forge Psyche ${options.pluralName}.`,
    parameters: emptyObjectSchema,
    path: () => basePath
  });

  registerReadTool(api, config, {
    name: `forge_get_psyche_${options.singularName.replaceAll("-", "_")}`,
    label: `Forge ${singularLabel} Detail`,
    description: `Fetch one Forge Psyche ${options.singularName}.`,
    parameters: withId({}),
    path: (params) => `${basePath}/${encodeURIComponent(String(params.id))}`
  });

  registerWriteTool(api, config, {
    name: `forge_create_psyche_${options.singularName.replaceAll("-", "_")}`,
    label: `Create ${singularLabel}`,
    description: `Create a Forge Psyche ${options.singularName}.`,
    parameters: Type.Object(options.createShape),
    method: "POST",
    path: () => basePath
  });

  registerWriteTool(api, config, {
    name: `forge_update_psyche_${options.singularName.replaceAll("-", "_")}`,
    label: `Update ${singularLabel}`,
    description: `Update a Forge Psyche ${options.singularName}.`,
    parameters: withId(options.updateShape),
    method: "PATCH",
    path: (params) => `${basePath}/${encodeURIComponent(String(params.id))}`,
    body: (params) => {
      const { id, ...body } = params;
      return body;
    }
  });

  registerWriteTool(api, config, {
    name: `forge_delete_psyche_${options.singularName.replaceAll("-", "_")}`,
    label: `Delete ${singularLabel}`,
    description: `Delete a Forge Psyche ${options.singularName}.`,
    parameters: withId({
      mode: optionalDeleteMode(),
      reason: optionalString()
    }),
    method: "DELETE",
    path: (params) => buildDeletePath(`${basePath}/${encodeURIComponent(String(params.id))}`, params),
    bodyless: true
  });
}

export function registerForgePluginTools(api: ForgePluginToolApi, config: ForgePluginConfig) {
  registerReadTool(api, config, {
    name: "forge_get_context",
    label: "Forge Context",
    description: "Read the live Forge operating context through the plugin bridge.",
    path: () => "/api/v1/context"
  });

  registerReadTool(api, config, {
    name: "forge_list_domains",
    label: "Forge Domains",
    description: "List Forge first-class domains, including sensitive ones such as Psyche.",
    path: () => "/api/v1/domains"
  });

  registerReadTool(api, config, {
    name: "forge_get_operator_context",
    label: "Forge Operator Context",
    description: "Read the agent-focused Forge operator context with active projects, focus tasks, board lanes, and XP state.",
    path: () => "/api/v1/operator/context"
  });

  registerReadTool(api, config, {
    name: "forge_get_operator_overview",
    label: "Forge Operator Overview",
    description: "Read the one-shot Forge operator overview with full current state, route guidance, onboarding, and optional Psyche summary.",
    path: () => "/api/v1/operator/overview"
  });

  registerReadTool(api, config, {
    name: "forge_get_agent_onboarding",
    label: "Forge Agent Onboarding",
    description: "Fetch the Forge onboarding contract with recommended scopes, headers, and verification guidance.",
    path: () => "/api/v1/agents/onboarding"
  });

  registerReadTool(api, config, {
    name: "forge_get_settings",
    label: "Forge Settings",
    description: "Read Forge operator settings, including execution policy for multitasking and timer accounting.",
    path: () => "/api/v1/settings"
  });

  registerReadTool(api, config, {
    name: "forge_get_settings_bin",
    label: "Forge Deleted Items",
    description: "Read Forge deleted items grouped in the settings bin.",
    path: () => "/api/v1/settings/bin"
  });

  registerWriteTool(api, config, {
    name: "forge_update_settings",
    label: "Update Forge Settings",
    description: "Update Forge settings such as operator profile, notifications, max active tasks, theme, locale, and time accounting mode.",
    parameters: Type.Object({
      profile: Type.Optional(
        Type.Object({
          operatorName: optionalString(),
          operatorEmail: optionalString(),
          operatorTitle: optionalString()
        })
      ),
      notifications: Type.Optional(
        Type.Object({
          goalDriftAlerts: Type.Optional(Type.Boolean()),
          dailyQuestReminders: Type.Optional(Type.Boolean()),
          achievementCelebrations: Type.Optional(Type.Boolean())
        })
      ),
      execution: Type.Optional(
        Type.Object({
          maxActiveTasks: Type.Optional(Type.Number({ minimum: 1, maximum: 8 })),
          timeAccountingMode: Type.Optional(timeAccountingModeSchema)
        })
      ),
      themePreference: Type.Optional(Type.Union([Type.Literal("obsidian"), Type.Literal("solar"), Type.Literal("system")])),
      localePreference: Type.Optional(Type.Union([Type.Literal("en"), Type.Literal("fr")]))
    }),
    method: "PATCH",
    path: () => "/api/v1/settings"
  });

  registerReadTool(api, config, {
    name: "forge_get_xp_metrics",
    label: "Forge XP Metrics",
    description: "Read current Forge XP metrics, reward rules, and recent reward reasons.",
    path: () => "/api/v1/metrics/xp"
  });

  registerReadTool(api, config, {
    name: "forge_list_reward_ledger",
    label: "Forge Reward Ledger",
    description: "Inspect recent Forge reward ledger events.",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200 }))
    }),
    path: (params) => buildQueryPath("/api/v1/rewards/ledger", params)
  });

  registerReadTool(api, config, {
    name: "forge_list_goals",
    label: "Forge Goals",
    description: "List Forge life goals.",
    path: () => "/api/v1/goals"
  });

  registerReadTool(api, config, {
    name: "forge_get_goal",
    label: "Forge Goal",
    description: "Fetch one Forge life goal.",
    parameters: withId({}),
    path: (params) => `/api/v1/goals/${encodeURIComponent(String(params.id))}`
  });

  registerWriteTool(api, config, {
    name: "forge_create_goal",
    label: "Create Goal",
    description: "Create a Forge life goal.",
    parameters: Type.Object({
      title: Type.String({ minLength: 1 }),
      description: optionalString(),
      horizon: optionalString(),
      status: optionalString(),
      targetPoints: Type.Optional(Type.Number()),
      themeColor: optionalString(),
      tagIds: optionalStringArray()
    }),
    method: "POST",
    path: () => "/api/v1/goals"
  });

  registerWriteTool(api, config, {
    name: "forge_update_goal",
    label: "Update Goal",
    description: "Update a Forge life goal, including renaming it.",
    parameters: withId({
      title: optionalString(),
      description: optionalString(),
      horizon: optionalString(),
      status: optionalString(),
      targetPoints: Type.Optional(Type.Number()),
      themeColor: optionalString(),
      tagIds: optionalStringArray()
    }),
    method: "PATCH",
    path: (params) => `/api/v1/goals/${encodeURIComponent(String(params.id))}`,
    body: (params) => {
      const { id, ...body } = params;
      return body;
    }
  });

  registerWriteTool(api, config, {
    name: "forge_delete_goal",
    label: "Delete Goal",
    description: "Delete a Forge life goal.",
    parameters: withId({
      mode: optionalDeleteMode(),
      reason: optionalString()
    }),
    method: "DELETE",
    path: (params) => buildDeletePath(`/api/v1/goals/${encodeURIComponent(String(params.id))}`, params),
    bodyless: true
  });

  registerReadTool(api, config, {
    name: "forge_list_projects",
    label: "Forge Projects",
    description: "List Forge projects.",
    parameters: Type.Object({
      goalId: optionalString(),
      status: optionalString(),
      limit: Type.Optional(Type.Number())
    }),
    path: (params) => buildQueryPath("/api/v1/projects", params)
  });

  registerReadTool(api, config, {
    name: "forge_get_project",
    label: "Forge Project",
    description: "Fetch one Forge project.",
    parameters: withId({}),
    path: (params) => `/api/v1/projects/${encodeURIComponent(String(params.id))}`
  });

  registerReadTool(api, config, {
    name: "forge_get_project_board",
    label: "Forge Project Board",
    description: "Fetch a Forge project board with tasks and evidence.",
    parameters: withId({}),
    path: (params) => `/api/v1/projects/${encodeURIComponent(String(params.id))}/board`
  });

  registerWriteTool(api, config, {
    name: "forge_create_project",
    label: "Create Project",
    description: "Create a Forge project under a life goal.",
    parameters: Type.Object({
      goalId: Type.String({ minLength: 1 }),
      title: Type.String({ minLength: 1 }),
      description: optionalString(),
      status: optionalString(),
      targetPoints: Type.Optional(Type.Number()),
      themeColor: optionalString()
    }),
    method: "POST",
    path: () => "/api/v1/projects"
  });

  registerWriteTool(api, config, {
    name: "forge_update_project",
    label: "Update Project",
    description: "Update a Forge project.",
    parameters: withId({
      goalId: optionalString(),
      title: optionalString(),
      description: optionalString(),
      status: optionalString(),
      targetPoints: Type.Optional(Type.Number()),
      themeColor: optionalString()
    }),
    method: "PATCH",
    path: (params) => `/api/v1/projects/${encodeURIComponent(String(params.id))}`,
    body: (params) => {
      const { id, ...body } = params;
      return body;
    }
  });

  registerWriteTool(api, config, {
    name: "forge_delete_project",
    label: "Delete Project",
    description: "Delete a Forge project.",
    parameters: withId({
      mode: optionalDeleteMode(),
      reason: optionalString()
    }),
    method: "DELETE",
    path: (params) => buildDeletePath(`/api/v1/projects/${encodeURIComponent(String(params.id))}`, params),
    bodyless: true
  });

  registerReadTool(api, config, {
    name: "forge_list_tasks",
    label: "Forge Tasks",
    description: "List Forge tasks with optional filters.",
    parameters: Type.Object({
      status: optionalString(),
      goalId: optionalString(),
      projectId: optionalString(),
      due: optionalString(),
      owner: optionalString()
    }),
    path: (params) => buildQueryPath("/api/v1/tasks", params)
  });

  registerReadTool(api, config, {
    name: "forge_get_task",
    label: "Forge Task",
    description: "Fetch one Forge task.",
    parameters: withId({}),
    path: (params) => `/api/v1/tasks/${encodeURIComponent(String(params.id))}`
  });

  registerWriteTool(api, config, {
    name: "forge_create_task",
    label: "Forge Create Task",
    description: "Create a Forge task through the versioned API.",
    parameters: Type.Object({
      title: Type.String({ minLength: 1 }),
      projectId: optionalNullableString(),
      goalId: optionalNullableString(),
      description: optionalString(),
      status: optionalString(),
      priority: optionalString(),
      owner: optionalString(),
      dueDate: optionalNullableString(),
      effort: optionalString(),
      energy: optionalString(),
      points: Type.Optional(Type.Number()),
      tagIds: optionalStringArray()
    }),
    method: "POST",
    path: () => "/api/v1/tasks"
  });

  registerWriteTool(api, config, {
    name: "forge_update_task",
    label: "Forge Update Task",
    description: "Update an existing Forge task.",
    parameters: withId({
      title: optionalString(),
      description: optionalString(),
      status: optionalString(),
      priority: optionalString(),
      owner: optionalString(),
      goalId: optionalNullableString(),
      projectId: optionalNullableString(),
      dueDate: optionalNullableString(),
      effort: optionalString(),
      energy: optionalString(),
      points: Type.Optional(Type.Number()),
      tagIds: optionalStringArray()
    }),
    method: "PATCH",
    path: (params) => `/api/v1/tasks/${encodeURIComponent(String(params.id))}`,
    body: (params) => {
      const { id, ...body } = params;
      return body;
    }
  });

  registerWriteTool(api, config, {
    name: "forge_delete_task",
    label: "Delete Task",
    description: "Delete a Forge task.",
    parameters: withId({
      mode: optionalDeleteMode(),
      reason: optionalString()
    }),
    method: "DELETE",
    path: (params) => buildDeletePath(`/api/v1/tasks/${encodeURIComponent(String(params.id))}`, params),
    bodyless: true
  });

  registerWriteTool(api, config, {
    name: "forge_move_task",
    label: "Move Task",
    description: "Move a Forge task across kanban states.",
    parameters: Type.Object({
      id: Type.String({ minLength: 1 }),
      status: Type.String({ minLength: 1 }),
      sortOrder: Type.Optional(Type.Number())
    }),
    method: "PATCH",
    path: (params) => `/api/v1/tasks/${encodeURIComponent(String(params.id))}`,
    body: (params) => ({
      status: params.status,
      sortOrder: params.sortOrder
    })
  });

  registerWriteTool(api, config, {
    name: "forge_complete_task",
    label: "Complete Task",
    description: "Mark a Forge task done.",
    parameters: Type.Object({
      id: Type.String({ minLength: 1 })
    }),
    method: "PATCH",
    path: (params) => `/api/v1/tasks/${encodeURIComponent(String(params.id))}`,
    body: () => ({ status: "done" })
  });

  registerWriteTool(api, config, {
    name: "forge_uncomplete_task",
    label: "Reopen Task",
    description: "Reopen a completed Forge task.",
    parameters: Type.Object({
      id: Type.String({ minLength: 1 }),
      status: optionalString()
    }),
    method: "POST",
    path: (params) => `/api/v1/tasks/${encodeURIComponent(String(params.id))}/uncomplete`,
    body: (params) => ({
      status: params.status ?? "focus"
    })
  });

  registerWriteTool(api, config, {
    name: "forge_log_work",
    label: "Log Work",
    description: "Log work that already happened by creating or updating a task and returning the XP view.",
    parameters: Type.Object({
      taskId: optionalString(),
      title: optionalString(),
      description: optionalString(),
      summary: optionalString(),
      goalId: optionalNullableString(),
      projectId: optionalNullableString(),
      owner: optionalString(),
      status: optionalString(),
      priority: optionalString(),
      dueDate: optionalNullableString(),
      effort: optionalString(),
      energy: optionalString(),
      points: Type.Optional(Type.Number()),
      tagIds: optionalStringArray()
    }),
    method: "POST",
    path: () => "/api/v1/operator/log-work"
  });

  registerWriteTool(api, config, {
    name: "forge_claim_task_run",
    label: "Start Task Timer",
    description: "Start or renew a live Forge task timer with either a planned duration or unlimited mode.",
    parameters: Type.Object({
      taskId: Type.String({ minLength: 1 }),
      actor: optionalString(),
      leaseTtlSeconds: Type.Optional(Type.Number()),
      timerMode: Type.Optional(taskTimerModeSchema),
      plannedDurationSeconds: Type.Optional(Type.Union([Type.Number({ minimum: 60, maximum: 86400 }), Type.Null()])),
      isCurrent: Type.Optional(Type.Boolean()),
      note: optionalString()
    }),
    method: "POST",
    path: (params) => `/api/v1/tasks/${encodeURIComponent(String(params.taskId))}/runs`,
    body: (params) => ({
      actor: params.actor ?? config.actorLabel,
      leaseTtlSeconds: params.leaseTtlSeconds,
      timerMode: params.timerMode,
      plannedDurationSeconds: params.plannedDurationSeconds,
      isCurrent: params.isCurrent,
      note: params.note ?? ""
    })
  });

  registerWriteTool(api, config, {
    name: "forge_focus_task_run",
    label: "Focus Task Timer",
    description: "Mark one active Forge task timer as the current highlighted timer without stopping the others.",
    parameters: Type.Object({
      runId: Type.String({ minLength: 1 }),
      actor: optionalString()
    }),
    method: "POST",
    path: (params) => `/api/v1/task-runs/${encodeURIComponent(String(params.runId))}/focus`,
    body: (params) => ({
      actor: params.actor ?? config.actorLabel
    })
  });

  registerWriteTool(api, config, {
    name: "forge_complete_task_run",
    label: "Complete Task Run",
    description: "Complete a claimed task run.",
    parameters: Type.Object({
      runId: Type.String({ minLength: 1 }),
      actor: optionalString(),
      note: optionalString()
    }),
    method: "POST",
    path: (params) => `/api/v1/task-runs/${encodeURIComponent(String(params.runId))}/complete`,
    body: (params) => ({
      actor: params.actor ?? config.actorLabel,
      note: params.note ?? ""
    })
  });

  registerReadTool(api, config, {
    name: "forge_list_task_runs",
    label: "Forge Task Runs",
    description: "List task runs with optional task and status filters.",
    parameters: Type.Object({
      taskId: optionalString(),
      status: optionalString(),
      active: Type.Optional(Type.Boolean()),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200 }))
    }),
    path: (params) => buildQueryPath("/api/v1/task-runs", params)
  });

  registerReadTool(api, config, {
    name: "forge_list_active_timers",
    label: "Forge Active Timers",
    description: "List active Forge task timers, including multitasking state and current timer focus.",
    parameters: Type.Object({
      taskId: optionalString(),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200 }))
    }),
    path: (params) => buildQueryPath("/api/v1/task-runs", { ...params, active: true })
  });

  registerWriteTool(api, config, {
    name: "forge_release_task_run",
    label: "Release Task Run",
    description: "Release a claimed task run without marking the task complete.",
    parameters: Type.Object({
      runId: Type.String({ minLength: 1 }),
      actor: optionalString(),
      note: optionalString()
    }),
    method: "POST",
    path: (params) => `/api/v1/task-runs/${encodeURIComponent(String(params.runId))}/release`,
    body: (params) => ({
      actor: params.actor ?? config.actorLabel,
      note: params.note ?? ""
    })
  });

  registerReadTool(api, config, {
    name: "forge_list_comments",
    label: "Forge Comments",
    description: "List comments for a Forge entity or report anchor.",
    parameters: Type.Object({
      entityType: Type.String({ minLength: 1 }),
      entityId: Type.String({ minLength: 1 }),
      anchorId: optionalString()
    }),
    path: (params) =>
      buildQueryPath("/api/v1/comments", {
        entityType: params.entityType,
        entityId: params.entityId,
        anchorId: params.anchorId
      })
  });

  registerWriteTool(api, config, {
    name: "forge_add_comment",
    label: "Forge Add Comment",
    description: "Add a user or agent comment to a Forge entity or report anchor.",
    parameters: Type.Object({
      entityType: Type.String({ minLength: 1 }),
      entityId: Type.String({ minLength: 1 }),
      body: Type.String({ minLength: 1 }),
      anchorId: optionalString()
    }),
    method: "POST",
    path: () => "/api/v1/comments"
  });

  registerWriteTool(api, config, {
    name: "forge_update_comment",
    label: "Forge Update Comment",
    description: "Update an existing Forge comment.",
    parameters: Type.Object({
      id: Type.String({ minLength: 1 }),
      body: Type.String({ minLength: 1 })
    }),
    method: "PATCH",
    path: (params) => `/api/v1/comments/${encodeURIComponent(String(params.id))}`,
    body: (params) => ({
      body: params.body
    })
  });

  registerReadTool(api, config, {
    name: "forge_get_comment",
    label: "Forge Comment",
    description: "Fetch one Forge comment.",
    parameters: withId({}),
    path: (params) => `/api/v1/comments/${encodeURIComponent(String(params.id))}`
  });

  registerWriteTool(api, config, {
    name: "forge_delete_comment",
    label: "Delete Comment",
    description: "Delete an existing Forge comment.",
    parameters: withId({
      mode: optionalDeleteMode(),
      reason: optionalString()
    }),
    method: "DELETE",
    path: (params) => buildDeletePath(`/api/v1/comments/${encodeURIComponent(String(params.id))}`, params),
    bodyless: true
  });

  registerReadTool(api, config, {
    name: "forge_list_tags",
    label: "Forge Tags",
    description: "List Forge tags across value, category, and execution kinds.",
    path: () => "/api/v1/tags"
  });

  registerReadTool(api, config, {
    name: "forge_get_tag",
    label: "Forge Tag",
    description: "Fetch one Forge tag.",
    parameters: withId({}),
    path: (params) => `/api/v1/tags/${encodeURIComponent(String(params.id))}`
  });

  registerWriteTool(api, config, {
    name: "forge_create_tag",
    label: "Create Tag",
    description: "Create a Forge tag.",
    parameters: Type.Object({
      name: Type.String({ minLength: 1 }),
      kind: optionalString(),
      color: optionalString(),
      description: optionalString()
    }),
    method: "POST",
    path: () => "/api/v1/tags"
  });

  registerWriteTool(api, config, {
    name: "forge_update_tag",
    label: "Update Tag",
    description: "Update a Forge tag.",
    parameters: withId({
      name: optionalString(),
      kind: optionalString(),
      color: optionalString(),
      description: optionalString()
    }),
    method: "PATCH",
    path: (params) => `/api/v1/tags/${encodeURIComponent(String(params.id))}`,
    body: (params) => {
      const { id, ...body } = params;
      return body;
    }
  });

  registerWriteTool(api, config, {
    name: "forge_delete_tag",
    label: "Delete Tag",
    description: "Delete a Forge tag.",
    parameters: withId({
      mode: optionalDeleteMode(),
      reason: optionalString()
    }),
    method: "DELETE",
    path: (params) => buildDeletePath(`/api/v1/tags/${encodeURIComponent(String(params.id))}`, params),
    bodyless: true
  });

  registerReadTool(api, config, {
    name: "forge_list_insights",
    label: "Forge Insights",
    description: "List structured Forge insights.",
    path: () => "/api/v1/insights"
  });

  registerWriteTool(api, config, {
    name: "forge_post_insight",
    label: "Forge Post Insight",
    description: "Post a structured Forge insight after reading the one-shot overview. This tool stamps the insight as agent-originated automatically.",
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
    path: () => "/api/v1/insights",
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
      rationale: params.rationale ?? "",
      confidence: params.confidence,
      visibility: params.visibility,
      ctaLabel: params.ctaLabel ?? "Review insight"
    })
  });

  registerWriteTool(api, config, {
    name: "forge_update_insight",
    label: "Forge Update Insight",
    description: "Update a structured Forge insight.",
    parameters: withId({
      title: optionalString(),
      summary: optionalString(),
      recommendation: optionalString(),
      rationale: optionalString(),
      confidence: Type.Optional(Type.Number()),
      visibility: optionalString(),
      status: optionalString()
    }),
    method: "PATCH",
    path: (params) => `/api/v1/insights/${encodeURIComponent(String(params.id))}`,
    body: (params) => {
      const { id, ...body } = params;
      return body;
    }
  });

  registerWriteTool(api, config, {
    name: "forge_delete_insight",
    label: "Delete Insight",
    description: "Delete a structured Forge insight. Default is soft delete unless mode=hard is set explicitly.",
    parameters: withId({
      mode: optionalDeleteMode(),
      reason: optionalString()
    }),
    method: "DELETE",
    path: (params) => buildDeletePath(`/api/v1/insights/${encodeURIComponent(String(params.id))}`, params),
    bodyless: true
  });

  registerWriteTool(api, config, {
    name: "forge_create_entities",
    label: "Create Forge Entities",
    description: "Create multiple Forge entities in one ordered batch request.",
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
    path: () => "/api/v1/entities/create"
  });

  registerWriteTool(api, config, {
    name: "forge_update_entities",
    label: "Update Forge Entities",
    description: "Update multiple Forge entities in one ordered batch request.",
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
    path: () => "/api/v1/entities/update"
  });

  registerWriteTool(api, config, {
    name: "forge_delete_entities",
    label: "Delete Forge Entities",
    description: "Delete multiple Forge entities in one ordered batch request. Delete defaults to soft mode unless hard is requested explicitly.",
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
    path: () => "/api/v1/entities/delete"
  });

  registerWriteTool(api, config, {
    name: "forge_restore_entities",
    label: "Restore Forge Entities",
    description: "Restore soft-deleted Forge entities from the settings bin.",
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
    path: () => "/api/v1/entities/restore"
  });

  registerWriteTool(api, config, {
    name: "forge_search_entities",
    label: "Search Forge Entities",
    description: "Search multiple Forge entity groups in one call, including optional deleted-item visibility.",
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
    path: () => "/api/v1/entities/search"
  });

  registerReadTool(api, config, {
    name: "forge_list_approval_requests",
    label: "Forge Approval Requests",
    description: "Inspect Forge approval requests.",
    path: () => "/api/v1/approval-requests"
  });

  registerWriteTool(api, config, {
    name: "forge_approve_request",
    label: "Approve Request",
    description: "Approve a pending Forge approval request.",
    parameters: Type.Object({
      id: Type.String({ minLength: 1 }),
      note: optionalString(),
      actor: optionalNullableString()
    }),
    method: "POST",
    path: (params) => `/api/v1/approval-requests/${encodeURIComponent(String(params.id))}/approve`,
    body: (params) => ({
      note: params.note ?? "",
      actor: params.actor ?? null
    })
  });

  registerWriteTool(api, config, {
    name: "forge_reject_request",
    label: "Reject Request",
    description: "Reject a pending Forge approval request.",
    parameters: Type.Object({
      id: Type.String({ minLength: 1 }),
      note: optionalString(),
      actor: optionalNullableString()
    }),
    method: "POST",
    path: (params) => `/api/v1/approval-requests/${encodeURIComponent(String(params.id))}/reject`,
    body: (params) => ({
      note: params.note ?? "",
      actor: params.actor ?? null
    })
  });

  registerReadTool(api, config, {
    name: "forge_list_agents",
    label: "Forge Agents",
    description: "List registered Forge agents and their trust posture.",
    path: () => "/api/v1/agents"
  });

  registerReadTool(api, config, {
    name: "forge_list_agent_actions",
    label: "Forge Agent Actions",
    description: "Inspect actions associated with a Forge agent.",
    parameters: withId({}),
    path: (params) => `/api/v1/agents/${encodeURIComponent(String(params.id))}/actions`
  });

  registerReadTool(api, config, {
    name: "forge_list_reward_rules",
    label: "Reward Rules",
    description: "List Forge reward rules.",
    path: () => "/api/v1/rewards/rules"
  });

  registerWriteTool(api, config, {
    name: "forge_update_reward_rule",
    label: "Update Reward Rule",
    description: "Update a Forge reward rule configuration.",
    parameters: withId({
      title: optionalString(),
      description: optionalString(),
      active: Type.Optional(Type.Boolean()),
      config: Type.Optional(Type.Record(Type.String(), Type.Any()))
    }),
    method: "PATCH",
    path: (params) => `/api/v1/rewards/rules/${encodeURIComponent(String(params.id))}`,
    body: (params) => {
      const { id, ...body } = params;
      return body;
    }
  });

  registerWriteTool(api, config, {
    name: "forge_award_xp_bonus",
    label: "Award XP Bonus",
    description: "Create a manual, explainable XP bonus in the Forge reward ledger.",
    parameters: Type.Object({
      entityType: Type.String({ minLength: 1 }),
      entityId: Type.String({ minLength: 1 }),
      deltaXp: Type.Number(),
      reasonTitle: Type.String({ minLength: 1 }),
      reasonSummary: optionalString(),
      metadata: Type.Optional(Type.Record(Type.String(), Type.Any()))
    }),
    method: "POST",
    path: () => "/api/v1/rewards/bonus"
  });

  registerReadTool(api, config, {
    name: "forge_get_psyche_overview",
    label: "Forge Psyche Overview",
    description: "Read the current Psyche operating picture.",
    path: () => "/api/v1/psyche/overview"
  });

  registerPsycheCrudTools(api, config, {
    pluralName: "values",
    singularName: "value",
    label: "Psyche Values",
    createShape: {
      title: Type.String({ minLength: 1 }),
      description: optionalString(),
      valuedDirection: optionalString(),
      whyItMatters: optionalString(),
      linkedGoalIds: optionalStringArray(),
      linkedProjectIds: optionalStringArray(),
      linkedTaskIds: optionalStringArray(),
      committedActions: Type.Optional(Type.Array(Type.String()))
    },
    updateShape: {
      title: optionalString(),
      description: optionalString(),
      valuedDirection: optionalString(),
      whyItMatters: optionalString(),
      linkedGoalIds: optionalStringArray(),
      linkedProjectIds: optionalStringArray(),
      linkedTaskIds: optionalStringArray(),
      committedActions: Type.Optional(Type.Array(Type.String()))
    }
  });

  registerPsycheCrudTools(api, config, {
    pluralName: "patterns",
    singularName: "pattern",
    label: "Psyche Patterns",
    createShape: {
      title: Type.String({ minLength: 1 }),
      description: optionalString(),
      targetBehavior: optionalString(),
      cueContexts: Type.Optional(Type.Array(Type.String())),
      shortTermPayoff: optionalString(),
      longTermCost: optionalString(),
      preferredResponse: optionalString(),
      linkedValueIds: optionalStringArray(),
      linkedSchemaLabels: Type.Optional(Type.Array(Type.String())),
      linkedModeLabels: Type.Optional(Type.Array(Type.String()))
    },
    updateShape: {
      title: optionalString(),
      description: optionalString(),
      targetBehavior: optionalString(),
      cueContexts: Type.Optional(Type.Array(Type.String())),
      shortTermPayoff: optionalString(),
      longTermCost: optionalString(),
      preferredResponse: optionalString(),
      linkedValueIds: optionalStringArray(),
      linkedSchemaLabels: Type.Optional(Type.Array(Type.String())),
      linkedModeLabels: Type.Optional(Type.Array(Type.String()))
    }
  });

  registerPsycheCrudTools(api, config, {
    pluralName: "behaviors",
    singularName: "behavior",
    label: "Psyche Behaviors",
    createShape: {
      kind: Type.String({ minLength: 1 }),
      title: Type.String({ minLength: 1 }),
      description: optionalString(),
      commonCues: Type.Optional(Type.Array(Type.String())),
      urgeStory: optionalString(),
      shortTermPayoff: optionalString(),
      longTermCost: optionalString(),
      replacementMove: optionalString(),
      repairPlan: optionalString(),
      linkedPatternIds: optionalStringArray(),
      linkedValueIds: optionalStringArray(),
      linkedSchemaIds: optionalStringArray(),
      linkedModeIds: optionalStringArray()
    },
    updateShape: {
      kind: optionalString(),
      title: optionalString(),
      description: optionalString(),
      commonCues: Type.Optional(Type.Array(Type.String())),
      urgeStory: optionalString(),
      shortTermPayoff: optionalString(),
      longTermCost: optionalString(),
      replacementMove: optionalString(),
      repairPlan: optionalString(),
      linkedPatternIds: optionalStringArray(),
      linkedValueIds: optionalStringArray(),
      linkedSchemaIds: optionalStringArray(),
      linkedModeIds: optionalStringArray()
    }
  });

  registerPsycheCrudTools(api, config, {
    pluralName: "beliefs",
    singularName: "belief",
    label: "Psyche Beliefs",
    createShape: {
      statement: Type.String({ minLength: 1 }),
      schemaId: optionalNullableString(),
      beliefType: optionalString(),
      originNote: optionalString(),
      confidence: Type.Optional(Type.Number()),
      evidenceFor: Type.Optional(Type.Array(Type.String())),
      evidenceAgainst: Type.Optional(Type.Array(Type.String())),
      flexibleAlternative: optionalString(),
      linkedValueIds: optionalStringArray(),
      linkedBehaviorIds: optionalStringArray(),
      linkedModeIds: optionalStringArray(),
      linkedReportIds: optionalStringArray()
    },
    updateShape: {
      statement: optionalString(),
      schemaId: optionalNullableString(),
      beliefType: optionalString(),
      originNote: optionalString(),
      confidence: Type.Optional(Type.Number()),
      evidenceFor: Type.Optional(Type.Array(Type.String())),
      evidenceAgainst: Type.Optional(Type.Array(Type.String())),
      flexibleAlternative: optionalString(),
      linkedValueIds: optionalStringArray(),
      linkedBehaviorIds: optionalStringArray(),
      linkedModeIds: optionalStringArray(),
      linkedReportIds: optionalStringArray()
    }
  });

  registerReadTool(api, config, {
    name: "forge_list_psyche_schema_catalog",
    label: "Psyche Schema Catalog",
    description: "List the fixed schema-therapy catalog used by Forge Psyche.",
    path: () => "/api/v1/psyche/schema-catalog"
  });

  registerReadTool(api, config, {
    name: "forge_list_psyche_reports",
    label: "Psyche Reports",
    description: "List Forge Psyche trigger reports.",
    path: () => "/api/v1/psyche/reports"
  });

  registerReadTool(api, config, {
    name: "forge_get_psyche_report",
    label: "Forge Psyche Report",
    description: "Fetch a detailed Psyche trigger report.",
    parameters: withId({}),
    path: (params) => `/api/v1/psyche/reports/${encodeURIComponent(String(params.id))}`
  });

  registerWriteTool(api, config, {
    name: "forge_create_psyche_report",
    label: "Create Psyche Report",
    description: "Create a Forge Psyche trigger report.",
    parameters: Type.Object({
      title: Type.String({ minLength: 1 }),
      status: optionalString(),
      eventTypeId: optionalNullableString(),
      customEventType: optionalString(),
      eventSituation: optionalString(),
      occurredAt: optionalNullableString(),
      emotions: Type.Optional(Type.Array(Type.Any())),
      thoughts: Type.Optional(Type.Array(Type.Any())),
      behaviors: Type.Optional(Type.Array(Type.Any())),
      consequences: Type.Optional(Type.Any()),
      linkedPatternIds: optionalStringArray(),
      linkedValueIds: optionalStringArray(),
      linkedGoalIds: optionalStringArray(),
      linkedProjectIds: optionalStringArray(),
      linkedTaskIds: optionalStringArray(),
      linkedBehaviorIds: optionalStringArray(),
      linkedBeliefIds: optionalStringArray(),
      linkedModeIds: optionalStringArray(),
      modeOverlays: Type.Optional(Type.Array(Type.String())),
      schemaLinks: Type.Optional(Type.Array(Type.String())),
      modeTimeline: Type.Optional(Type.Array(Type.Any())),
      nextMoves: Type.Optional(Type.Array(Type.String()))
    }),
    method: "POST",
    path: () => "/api/v1/psyche/reports"
  });

  registerWriteTool(api, config, {
    name: "forge_update_psyche_report",
    label: "Forge Update Psyche Report",
    description: "Update a Psyche trigger report through the versioned API.",
    parameters: withId({
      title: optionalString(),
      status: optionalString(),
      eventTypeId: optionalNullableString(),
      customEventType: optionalString(),
      eventSituation: optionalString(),
      occurredAt: optionalNullableString(),
      emotions: Type.Optional(Type.Array(Type.Any())),
      thoughts: Type.Optional(Type.Array(Type.Any())),
      behaviors: Type.Optional(Type.Array(Type.Any())),
      consequences: Type.Optional(Type.Any()),
      linkedPatternIds: optionalStringArray(),
      linkedValueIds: optionalStringArray(),
      linkedGoalIds: optionalStringArray(),
      linkedProjectIds: optionalStringArray(),
      linkedTaskIds: optionalStringArray(),
      linkedBehaviorIds: optionalStringArray(),
      linkedBeliefIds: optionalStringArray(),
      linkedModeIds: optionalStringArray(),
      modeOverlays: Type.Optional(Type.Array(Type.String())),
      schemaLinks: Type.Optional(Type.Array(Type.String())),
      modeTimeline: Type.Optional(Type.Array(Type.Any())),
      nextMoves: Type.Optional(Type.Array(Type.String()))
    }),
    method: "PATCH",
    path: (params) => `/api/v1/psyche/reports/${encodeURIComponent(String(params.id))}`,
    body: (params) => {
      const { id, ...body } = params;
      return body;
    }
  });

  registerWriteTool(api, config, {
    name: "forge_delete_psyche_report",
    label: "Delete Psyche Report",
    description: "Delete a Forge Psyche trigger report.",
    parameters: withId({}),
    method: "DELETE",
    path: (params) => `/api/v1/psyche/reports/${encodeURIComponent(String(params.id))}`,
    bodyless: true
  });

  registerPsycheCrudTools(api, config, {
    pluralName: "modes",
    singularName: "mode",
    label: "Psyche Modes",
    createShape: {
      family: Type.String({ minLength: 1 }),
      archetype: optionalString(),
      title: Type.String({ minLength: 1 }),
      persona: optionalString(),
      imagery: optionalString(),
      symbolicForm: optionalString(),
      facialExpression: optionalString(),
      fear: optionalString(),
      burden: optionalString(),
      protectiveJob: optionalString(),
      originContext: optionalString(),
      firstAppearanceAt: optionalNullableString(),
      linkedPatternIds: optionalStringArray(),
      linkedBehaviorIds: optionalStringArray(),
      linkedValueIds: optionalStringArray()
    },
    updateShape: {
      family: optionalString(),
      archetype: optionalString(),
      title: optionalString(),
      persona: optionalString(),
      imagery: optionalString(),
      symbolicForm: optionalString(),
      facialExpression: optionalString(),
      fear: optionalString(),
      burden: optionalString(),
      protectiveJob: optionalString(),
      originContext: optionalString(),
      firstAppearanceAt: optionalNullableString(),
      linkedPatternIds: optionalStringArray(),
      linkedBehaviorIds: optionalStringArray(),
      linkedValueIds: optionalStringArray()
    }
  });

  registerPsycheCrudTools(api, config, {
    pluralName: "event-types",
    singularName: "event_type",
    label: "Psyche Event Types",
    createShape: {
      label: Type.String({ minLength: 1 }),
      description: optionalString()
    },
    updateShape: {
      label: optionalString(),
      description: optionalString()
    }
  });

  registerPsycheCrudTools(api, config, {
    pluralName: "emotions",
    singularName: "emotion",
    label: "Psyche Emotions",
    createShape: {
      label: Type.String({ minLength: 1 }),
      description: optionalString(),
      category: optionalString()
    },
    updateShape: {
      label: optionalString(),
      description: optionalString(),
      category: optionalString()
    }
  });

  registerPsycheCrudTools(api, config, {
    pluralName: "mode-guides",
    singularName: "mode_guide",
    label: "Psyche Mode Guides",
    createShape: {
      summary: Type.String({ minLength: 1 }),
      answers: Type.Array(Type.Any())
    },
    updateShape: {
      summary: optionalString(),
      answers: Type.Optional(Type.Array(Type.Any()))
    }
  });
}
