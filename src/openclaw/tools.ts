import { Type, type TObject, type TProperties } from "@sinclair/typebox";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import {
  callConfiguredForgeApi,
  expectForgeSuccess,
  requireApiToken,
  type ForgePluginConfig
} from "./api-client.js";
import type { ForgePluginToolApi } from "./plugin-sdk-types.js";

type StaticLike<T> =
  T extends TObject<infer _P> ? Record<string, unknown> : never;

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
const scopedReadSchema = Type.Object({
  userIds: Type.Optional(Type.Array(Type.String()))
});
const optionalString = () => Type.Optional(Type.String());
const optionalNullableString = () =>
  Type.Optional(Type.Union([Type.String(), Type.Null()]));
const optionalDeleteMode = () =>
  Type.Optional(Type.Union([Type.Literal("soft"), Type.Literal("hard")]));
const optionalBoolean = () => Type.Optional(Type.Boolean());
const optionalInteger = (minimum?: number, maximum?: number) =>
  Type.Optional(
    Type.Integer({
      ...(typeof minimum === "number" ? { minimum } : {}),
      ...(typeof maximum === "number" ? { maximum } : {})
    })
  );
const calendarOverviewReadSchema = Type.Object({
  from: optionalString(),
  to: optionalString(),
  userIds: Type.Optional(Type.Array(Type.String()))
});
const calendarConnectionParametersSchema = Type.Object({
  provider: Type.Union([
    Type.Literal("google"),
    Type.Literal("apple"),
    Type.Literal("caldav"),
    Type.Literal("microsoft"),
    Type.Literal("macos_local")
  ]),
  label: Type.String({ minLength: 1 }),
  username: optionalString(),
  password: optionalString(),
  serverUrl: optionalString(),
  authSessionId: optionalString(),
  sourceId: optionalString(),
  selectedCalendarUrls: Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1
  }),
  forgeCalendarUrl: optionalString(),
  createForgeCalendar: optionalBoolean(),
  replaceConnectionIds: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }))
  )
});
const healthLinkInputSchema = () =>
  Type.Object({
    entityType: Type.String({ minLength: 1 }),
    entityId: Type.String({ minLength: 1 }),
    relationshipType: Type.Optional(Type.String({ minLength: 1 }))
  });
const noteInputSchema = () =>
  Type.Object({
    contentMarkdown: Type.String({ minLength: 1 }),
    author: optionalNullableString(),
    tags: Type.Optional(Type.Array(Type.String())),
    destroyAt: optionalNullableString(),
    links: Type.Optional(
      Type.Array(
        Type.Object({
          entityType: Type.String({ minLength: 1 }),
          entityId: Type.String({ minLength: 1 }),
          anchorKey: optionalNullableString()
        })
      )
    )
  });

const wikiPageMutationSchema = () =>
  Type.Object({
    pageId: optionalString(),
    kind: Type.Optional(
      Type.Union([Type.Literal("wiki"), Type.Literal("evidence")])
    ),
    title: Type.String({ minLength: 1 }),
    slug: optionalString(),
    summary: optionalString(),
    aliases: Type.Optional(Type.Array(Type.String())),
    contentMarkdown: Type.String({ minLength: 1 }),
    author: optionalNullableString(),
    tags: Type.Optional(Type.Array(Type.String())),
    spaceId: optionalString(),
    frontmatter: Type.Optional(Type.Record(Type.String(), Type.Any())),
    links: Type.Optional(
      Type.Array(
        Type.Object({
          entityType: Type.String({ minLength: 1 }),
          entityId: Type.String({ minLength: 1 }),
          anchorKey: optionalNullableString()
        })
      )
    )
  });

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

function withUserIds(path: string, userIds: string[] | undefined) {
  if (!userIds || userIds.length === 0) {
    return path;
  }
  const search = new URLSearchParams();
  for (const userId of userIds) {
    if (userId.trim()) {
      search.append("userIds", userId.trim());
    }
  }
  return search.size > 0 ? `${path}?${search.toString()}` : path;
}

function withQueryParams(
  path: string,
  params: Record<string, unknown>,
  allowedKeys: string[]
) {
  const search = new URLSearchParams();
  for (const key of allowedKeys) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) {
      search.set(key, value.trim());
    } else if (typeof value === "number" && Number.isFinite(value)) {
      search.set(key, String(value));
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) {
          search.append(key, item.trim());
        }
      }
    }
  }
  return search.size > 0 ? `${path}?${search.toString()}` : path;
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
      return jsonResult(
        await runRead(config, options.path((params ?? {}) as StaticLike<T>))
      );
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

export function registerForgePluginTools(
  api: ForgePluginToolApi,
  config: ForgePluginConfig
) {
  registerReadTool(api, config, {
    name: "forge_get_operator_overview",
    label: "Forge Operator Overview",
    description:
      "Start here for most Forge work. Read the one-shot operator overview with current priorities, momentum, and onboarding guidance before searching or mutating.",
    parameters: scopedReadSchema,
    path: (params) =>
      withUserIds(
        "/api/v1/operator/overview",
        params.userIds as string[] | undefined
      )
  });

  registerReadTool(api, config, {
    name: "forge_get_operator_context",
    label: "Forge Operator Context",
    description:
      "Read the current operational task board, focus queue, recent task runs, and XP state. Use this for current-work questions and work runtime decisions.",
    parameters: scopedReadSchema,
    path: (params) =>
      withUserIds(
        "/api/v1/operator/context",
        params.userIds as string[] | undefined
      )
  });

  registerReadTool(api, config, {
    name: "forge_get_agent_onboarding",
    label: "Forge Agent Onboarding",
    description:
      "Fetch the live Forge onboarding contract with the exact Forge tool list, batch payload rules, UI handoff rules, and verification guidance.",
    path: () => "/api/v1/agents/onboarding"
  });

  registerReadTool(api, config, {
    name: "forge_get_user_directory",
    label: "Forge User Directory",
    description:
      "Read the current human and bot user directory, ownership counts, and directional relationship graph before doing multi-user planning or cross-owner edits.",
    path: () => "/api/v1/users/directory"
  });

  api.registerTool({
    name: "forge_get_ui_entrypoint",
    label: "Forge UI Entrypoint",
    description:
      "Get the live Forge web UI URL and plugin redirect route. Use this only when visual review or editing is genuinely easier, not as a substitute for normal batch entity creation or updates.",
    parameters: emptyObjectSchema,
    async execute() {
      return jsonResult(await resolveUiEntrypoint(config));
    }
  });

  registerReadTool(api, config, {
    name: "forge_get_psyche_overview",
    label: "Forge Psyche Overview",
    description:
      "Read the aggregate Psyche state across values, patterns, behaviors, beliefs, modes, and trigger reports before making Psyche recommendations or updates.",
    parameters: scopedReadSchema,
    path: (params) =>
      withUserIds(
        "/api/v1/psyche/overview",
        params.userIds as string[] | undefined
      )
  });

  registerReadTool(api, config, {
    name: "forge_get_xp_metrics",
    label: "Forge XP Metrics",
    description:
      "Read the live XP, level, streak, momentum, and reward metrics.",
    path: () => "/api/v1/metrics/xp"
  });

  registerReadTool(api, config, {
    name: "forge_get_weekly_review",
    label: "Forge Weekly Review",
    description:
      "Read the current weekly review payload with wins, trends, and reward framing.",
    parameters: scopedReadSchema,
    path: (params) =>
      withUserIds(
        "/api/v1/reviews/weekly",
        params.userIds as string[] | undefined
      )
  });

  registerReadTool(api, config, {
    name: "forge_get_wiki_settings",
    label: "Forge Wiki Settings",
    description:
      "Read the current wiki spaces plus enabled LLM and embedding profiles before search, ingest, or page writes.",
    path: () => "/api/v1/wiki/settings"
  });

  registerReadTool(api, config, {
    name: "forge_list_wiki_pages",
    label: "Forge List Wiki Pages",
    description:
      "List wiki or evidence pages inside one space without search ranking.",
    parameters: Type.Object({
      spaceId: optionalString(),
      kind: Type.Optional(
        Type.Union([Type.Literal("wiki"), Type.Literal("evidence")])
      ),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 }))
    }),
    path: (params) =>
      withQueryParams("/api/v1/wiki/pages", params as Record<string, unknown>, [
        "spaceId",
        "kind",
        "limit"
      ])
  });

  registerReadTool(api, config, {
    name: "forge_get_wiki_page",
    label: "Forge Get Wiki Page",
    description:
      "Read one wiki page with backlinks, source notes, and attached assets.",
    parameters: Type.Object({
      pageId: Type.String({ minLength: 1 })
    }),
    path: (params) =>
      `/api/v1/wiki/pages/${encodeURIComponent(
        (params as Record<string, unknown>).pageId as string
      )}`
  });

  registerReadTool(api, config, {
    name: "forge_get_wiki_health",
    label: "Forge Wiki Health",
    description:
      "Read unresolved links, orphan pages, missing summaries, raw-source counts, and index-path state for one wiki space.",
    parameters: Type.Object({
      spaceId: optionalString()
    }),
    path: (params) =>
      withQueryParams(
        "/api/v1/wiki/health",
        params as Record<string, unknown>,
        ["spaceId"]
      )
  });

  registerWriteTool(api, config, {
    name: "forge_search_wiki",
    label: "Forge Search Wiki",
    description:
      "Search the wiki with text, semantic, entity, or hybrid retrieval.",
    parameters: Type.Object({
      spaceId: optionalString(),
      kind: Type.Optional(
        Type.Union([Type.Literal("wiki"), Type.Literal("evidence")])
      ),
      mode: Type.Optional(
        Type.Union([
          Type.Literal("text"),
          Type.Literal("semantic"),
          Type.Literal("entity"),
          Type.Literal("hybrid")
        ])
      ),
      query: optionalString(),
      profileId: optionalString(),
      linkedEntity: Type.Optional(
        Type.Object({
          entityType: Type.String({ minLength: 1 }),
          entityId: Type.String({ minLength: 1 })
        })
      ),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 }))
    }),
    method: "POST",
    path: "/api/v1/wiki/search"
  });

  api.registerTool({
    name: "forge_upsert_wiki_page",
    label: "Forge Upsert Wiki Page",
    description:
      "Create a new wiki page or update an existing one through the file-backed wiki surface.",
    parameters: wikiPageMutationSchema(),
    async execute(_toolCallId, params) {
      const typed = (params ?? {}) as Record<string, unknown>;
      const pageId =
        typeof typed.pageId === "string" && typed.pageId.trim()
          ? typed.pageId.trim()
          : null;
      const body = {
        kind: typed.kind,
        title: typed.title,
        slug: typed.slug,
        summary: typed.summary,
        aliases: typed.aliases,
        contentMarkdown: typed.contentMarkdown,
        author: typed.author,
        tags: typed.tags,
        spaceId: typed.spaceId,
        frontmatter: typed.frontmatter,
        links: typed.links
      };
      return jsonResult(
        await runWrite(config, {
          method: pageId ? "PATCH" : "POST",
          path: pageId
            ? `/api/v1/wiki/pages/${encodeURIComponent(pageId)}`
            : "/api/v1/wiki/pages",
          body
        })
      );
    }
  });

  registerWriteTool(api, config, {
    name: "forge_sync_wiki_vault",
    label: "Forge Sync Wiki Vault",
    description:
      "Resync Markdown files from the local wiki vault into Forge metadata.",
    parameters: Type.Object({
      spaceId: optionalString()
    }),
    method: "POST",
    path: "/api/v1/wiki/sync"
  });

  registerWriteTool(api, config, {
    name: "forge_reindex_wiki_embeddings",
    label: "Forge Reindex Wiki Embeddings",
    description:
      "Recompute wiki embedding chunks for one space and optional profile.",
    parameters: Type.Object({
      spaceId: optionalString(),
      profileId: optionalString()
    }),
    method: "POST",
    path: "/api/v1/wiki/reindex"
  });

  registerWriteTool(api, config, {
    name: "forge_ingest_wiki_source",
    label: "Forge Ingest Wiki Source",
    description:
      "Ingest raw text, local files, or URLs into the wiki, preserving a raw source artifact and returning page plus proposal outputs.",
    parameters: Type.Object({
      spaceId: optionalString(),
      titleHint: optionalString(),
      sourceKind: Type.Union([
        Type.Literal("raw_text"),
        Type.Literal("local_path"),
        Type.Literal("url")
      ]),
      sourceText: optionalString(),
      sourcePath: optionalString(),
      sourceUrl: optionalString(),
      mimeType: optionalString(),
      llmProfileId: optionalString(),
      parseStrategy: Type.Optional(
        Type.Union([
          Type.Literal("auto"),
          Type.Literal("text_only"),
          Type.Literal("multimodal")
        ])
      ),
      entityProposalMode: Type.Optional(
        Type.Union([Type.Literal("none"), Type.Literal("suggest")])
      ),
      userId: optionalNullableString(),
      createAsKind: Type.Optional(
        Type.Union([Type.Literal("wiki"), Type.Literal("evidence")])
      ),
      linkedEntityHints: Type.Optional(
        Type.Array(
          Type.Object({
            entityType: Type.String({ minLength: 1 }),
            entityId: Type.String({ minLength: 1 }),
            anchorKey: optionalNullableString()
          })
        )
      )
    }),
    method: "POST",
    path: "/api/v1/wiki/ingest-jobs"
  });

  api.registerTool({
    name: "forge_get_current_work",
    label: "Forge Current Work",
    description:
      "Get the current live-work picture: active task runs, focus tasks, the recommended next task, and current XP state.",
    parameters: scopedReadSchema,
    async execute(_toolCallId, params) {
      const path = withUserIds(
        "/api/v1/operator/context",
        ((params ?? {}) as Record<string, unknown>).userIds as
          | string[]
          | undefined
      );
      const payload = await runRead(config, path);
      const context =
        typeof payload === "object" &&
        payload !== null &&
        "context" in payload &&
        typeof payload.context === "object" &&
        payload.context !== null
          ? (payload.context as Record<string, unknown>)
          : null;

      const recentTaskRuns = Array.isArray(context?.recentTaskRuns)
        ? context.recentTaskRuns
        : [];
      const activeTaskRuns = recentTaskRuns.filter(
        (run) =>
          typeof run === "object" &&
          run !== null &&
          "status" in run &&
          run.status === "active"
      );
      const focusTasks = Array.isArray(context?.focusTasks)
        ? context.focusTasks
        : [];

      return jsonResult({
        generatedAt:
          typeof context?.generatedAt === "string"
            ? context.generatedAt
            : new Date().toISOString(),
        activeTaskRuns,
        focusTasks,
        recommendedNextTask: context?.recommendedNextTask ?? null,
        xp: context?.xp ?? null
      });
    }
  });

  registerReadTool(api, config, {
    name: "forge_get_sleep_overview",
    label: "Forge Sleep Overview",
    description:
      "Read the reflective sleep surface with recent nights, sleep scores, regularity, stage averages, and linked-context counts.",
    parameters: scopedReadSchema,
    path: (params) =>
      withUserIds(
        "/api/v1/health/sleep",
        params.userIds as string[] | undefined
      )
  });

  registerReadTool(api, config, {
    name: "forge_get_sports_overview",
    label: "Forge Sports Overview",
    description:
      "Read the sports and workout surface with training volume, workout types, effort signals, and linked workout sessions.",
    parameters: scopedReadSchema,
    path: (params) =>
      withUserIds(
        "/api/v1/health/fitness",
        params.userIds as string[] | undefined
      )
  });

  api.registerTool({
    name: "forge_update_sleep_session",
    label: "Forge Update Sleep Session",
    description:
      "Patch one sleep session with reflective notes, tags, or linked Forge context after review.",
    parameters: Type.Object({
      sleepId: Type.String({ minLength: 1 }),
      qualitySummary: optionalString(),
      notes: optionalString(),
      tags: Type.Optional(Type.Array(Type.String())),
      links: Type.Optional(Type.Array(healthLinkInputSchema()))
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runWrite(config, {
          method: "PATCH",
          path: `/api/v1/health/sleep/${typed.sleepId as string}`,
          body: {
            qualitySummary: typed.qualitySummary,
            notes: typed.notes,
            tags: typed.tags,
            links: typed.links
          }
        })
      );
    }
  });

  api.registerTool({
    name: "forge_update_workout_session",
    label: "Forge Update Workout Session",
    description:
      "Patch one workout session with effort, mood, meaning, tags, or linked Forge context.",
    parameters: Type.Object({
      workoutId: Type.String({ minLength: 1 }),
      subjectiveEffort: Type.Optional(
        Type.Union([Type.Integer({ minimum: 1, maximum: 10 }), Type.Null()])
      ),
      moodBefore: optionalString(),
      moodAfter: optionalString(),
      meaningText: optionalString(),
      plannedContext: optionalString(),
      socialContext: optionalString(),
      tags: Type.Optional(Type.Array(Type.String())),
      links: Type.Optional(Type.Array(healthLinkInputSchema()))
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runWrite(config, {
          method: "PATCH",
          path: `/api/v1/health/workouts/${typed.workoutId as string}`,
          body: {
            subjectiveEffort: typed.subjectiveEffort,
            moodBefore: typed.moodBefore,
            moodAfter: typed.moodAfter,
            meaningText: typed.meaningText,
            plannedContext: typed.plannedContext,
            socialContext: typed.socialContext,
            tags: typed.tags,
            links: typed.links
          }
        })
      );
    }
  });

  registerReadTool(api, config, {
    name: "forge_get_preferences_workspace",
    label: "Forge Preferences Workspace",
    description:
      "Read Forge's current preference model for one user and domain, including the summary-first landing view, next comparison pair, concept libraries, map, table, and history.",
    parameters: Type.Object({
      userId: optionalString(),
      domain: optionalString(),
      contextId: optionalString()
    }),
    path: (params) =>
      withQueryParams("/api/v1/preferences/workspace", params, [
        "userId",
        "domain",
        "contextId"
      ])
  });

  registerWriteTool(api, config, {
    name: "forge_start_preferences_game",
    label: "Forge Start Preferences Game",
    description:
      "Start the Forge comparison game for one preference domain or context and return the next pair of items to compare.",
    parameters: Type.Object({
      userId: Type.String({ minLength: 1 }),
      domain: Type.String({ minLength: 1 }),
      contextId: optionalString()
    }),
    method: "POST",
    path: "/api/v1/preferences/game/start"
  });

  registerWriteTool(api, config, {
    name: "forge_merge_preferences_contexts",
    label: "Forge Merge Preferences Contexts",
    description:
      "Merge one or more preference contexts into a target context.",
    parameters: Type.Object({
      targetContextId: Type.String({ minLength: 1 }),
      sourceContextIds: Type.Array(Type.String({ minLength: 1 }))
    }),
    method: "POST",
    path: "/api/v1/preferences/contexts/merge"
  });

  registerWriteTool(api, config, {
    name: "forge_enqueue_preferences_item_from_entity",
    label: "Forge Enqueue Preferences Item From Entity",
    description:
      "Queue an existing Forge entity into a preference domain so it can appear in the comparison game.",
    parameters: Type.Object({
      userId: Type.String({ minLength: 1 }),
      domain: Type.String({ minLength: 1 }),
      entityType: Type.String({ minLength: 1 }),
      entityId: Type.String({ minLength: 1 })
    }),
    method: "POST",
    path: "/api/v1/preferences/items/from-entity"
  });

  registerWriteTool(api, config, {
    name: "forge_submit_preferences_judgment",
    label: "Forge Submit Preferences Judgment",
    description:
      "Record one pairwise preference outcome such as left, right, tie, or skip.",
    parameters: Type.Object({
      profileId: Type.String({ minLength: 1 }),
      contextId: Type.String({ minLength: 1 }),
      userId: Type.String({ minLength: 1 }),
      leftItemId: Type.String({ minLength: 1 }),
      rightItemId: Type.String({ minLength: 1 }),
      outcome: Type.String({ minLength: 1 }),
      strength: Type.Optional(Type.Number({ minimum: 0.5, maximum: 2 })),
      responseTimeMs: Type.Optional(
        Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])
      ),
      source: optionalString(),
      reasonTags: Type.Optional(Type.Array(Type.String()))
    }),
    method: "POST",
    path: "/api/v1/preferences/judgments"
  });

  registerWriteTool(api, config, {
    name: "forge_submit_preferences_signal",
    label: "Forge Submit Preferences Signal",
    description:
      "Record a direct non-pairwise preference signal such as favorite, veto, must-have, bookmark, neutral, or compare-later.",
    parameters: Type.Object({
      profileId: Type.String({ minLength: 1 }),
      contextId: Type.String({ minLength: 1 }),
      userId: Type.String({ minLength: 1 }),
      itemId: Type.String({ minLength: 1 }),
      signalType: Type.String({ minLength: 1 }),
      strength: Type.Optional(Type.Number({ minimum: 0.5, maximum: 2 })),
      source: optionalString()
    }),
    method: "POST",
    path: "/api/v1/preferences/signals"
  });

  api.registerTool({
    name: "forge_update_preferences_score",
    label: "Forge Update Preferences Score",
    description:
      "Override or protect the inferred state of one preference item when the user wants explicit correction.",
    parameters: Type.Object({
      itemId: Type.String({ minLength: 1 }),
      manualStatus: optionalNullableString(),
      manualScore: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      confidenceLock: Type.Optional(
        Type.Union([Type.Number({ minimum: 0, maximum: 1 }), Type.Null()])
      ),
      bookmarked: Type.Optional(Type.Boolean()),
      compareLater: Type.Optional(Type.Boolean()),
      frozen: Type.Optional(Type.Boolean())
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runWrite(config, {
          method: "PATCH",
          path: `/api/v1/preferences/items/${typed.itemId as string}/score`,
          body: {
            manualStatus: typed.manualStatus,
            manualScore: typed.manualScore,
            confidenceLock: typed.confidenceLock,
            bookmarked: typed.bookmarked,
            compareLater: typed.compareLater,
            frozen: typed.frozen
          }
        })
      );
    }
  });

  registerReadTool(api, config, {
    name: "forge_list_questionnaires",
    label: "Forge List Questionnaires",
    description:
      "List the Psyche questionnaire library across the selected user scope.",
    parameters: scopedReadSchema,
    path: (params) =>
      withUserIds(
        "/api/v1/psyche/questionnaires",
        params.userIds as string[] | undefined
      )
  });

  api.registerTool({
    name: "forge_get_questionnaire",
    label: "Forge Get Questionnaire",
    description:
      "Read one Psyche questionnaire instrument with versions and scoring detail.",
    parameters: Type.Object({
      questionnaireId: Type.String({ minLength: 1 }),
      userIds: Type.Optional(Type.Array(Type.String()))
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runRead(
          config,
          withQueryParams(
            `/api/v1/psyche/questionnaires/${typed.questionnaireId as string}`,
            typed,
            ["userIds"]
          )
        )
      );
    }
  });

  api.registerTool({
    name: "forge_clone_questionnaire",
    label: "Forge Clone Questionnaire",
    description:
      "Clone one Psyche questionnaire instrument into a new user-owned copy.",
    parameters: Type.Object({
      questionnaireId: Type.String({ minLength: 1 }),
      userId: optionalNullableString()
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: `/api/v1/psyche/questionnaires/${typed.questionnaireId as string}/clone`,
          body: { userId: typed.userId }
        })
      );
    }
  });

  api.registerTool({
    name: "forge_ensure_questionnaire_draft",
    label: "Forge Ensure Questionnaire Draft",
    description:
      "Create or return the editable draft version for one questionnaire instrument.",
    parameters: Type.Object({
      questionnaireId: Type.String({ minLength: 1 })
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: `/api/v1/psyche/questionnaires/${typed.questionnaireId as string}/draft`
        })
      );
    }
  });

  api.registerTool({
    name: "forge_publish_questionnaire_draft",
    label: "Forge Publish Questionnaire Draft",
    description:
      "Publish the current questionnaire draft as the live readable version.",
    parameters: Type.Object({
      questionnaireId: Type.String({ minLength: 1 }),
      label: optionalString()
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: `/api/v1/psyche/questionnaires/${typed.questionnaireId as string}/publish`,
          body: { label: typed.label }
        })
      );
    }
  });

  api.registerTool({
    name: "forge_start_questionnaire_run",
    label: "Forge Start Questionnaire Run",
    description:
      "Start one questionnaire answer session for a specific user.",
    parameters: Type.Object({
      questionnaireId: Type.String({ minLength: 1 }),
      userId: Type.String({ minLength: 1 }),
      author: optionalString()
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: `/api/v1/psyche/questionnaires/${typed.questionnaireId as string}/runs`,
          body: {
            userId: typed.userId,
            author: typed.author
          }
        })
      );
    }
  });

  api.registerTool({
    name: "forge_get_questionnaire_run",
    label: "Forge Get Questionnaire Run",
    description:
      "Read one questionnaire run with answers, scores, and completion state.",
    parameters: Type.Object({
      runId: Type.String({ minLength: 1 }),
      userIds: Type.Optional(Type.Array(Type.String()))
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runRead(
          config,
          withQueryParams(
            `/api/v1/psyche/questionnaire-runs/${typed.runId as string}`,
            typed,
            ["userIds"]
          )
        )
      );
    }
  });

  api.registerTool({
    name: "forge_update_questionnaire_run",
    label: "Forge Update Questionnaire Run",
    description:
      "Patch one questionnaire run while the answers are still being filled.",
    parameters: Type.Object({
      runId: Type.String({ minLength: 1 }),
      answers: Type.Optional(Type.Record(Type.String(), Type.Any())),
      status: optionalString(),
      notes: optionalString()
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runWrite(config, {
          method: "PATCH",
          path: `/api/v1/psyche/questionnaire-runs/${typed.runId as string}`,
          body: {
            answers: typed.answers,
            status: typed.status,
            notes: typed.notes
          }
        })
      );
    }
  });

  api.registerTool({
    name: "forge_complete_questionnaire_run",
    label: "Forge Complete Questionnaire Run",
    description:
      "Complete one questionnaire run and finalize its scoring pass.",
    parameters: Type.Object({
      runId: Type.String({ minLength: 1 })
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: `/api/v1/psyche/questionnaire-runs/${typed.runId as string}/complete`
        })
      );
    }
  });

  registerReadTool(api, config, {
    name: "forge_get_self_observation_calendar",
    label: "Forge Self Observation Calendar",
    description:
      "Read the Psyche self-observation calendar with note-backed observations, linked patterns, linked reports, and available tags.",
    parameters: Type.Object({
      from: optionalString(),
      to: optionalString(),
      userIds: Type.Optional(Type.Array(Type.String()))
    }),
    path: (params) =>
      withQueryParams("/api/v1/psyche/self-observation/calendar", params, [
        "from",
        "to",
        "userIds"
      ])
  });

  registerWriteTool(api, config, {
    name: "forge_search_entities",
    label: "Search Forge Entities",
    description:
      "Search Forge entities before creating or updating to avoid duplicates. Pass `searches` as an array, even for one search.",
    parameters: Type.Object({
      searches: Type.Array(
        Type.Object({
          entityTypes: Type.Optional(Type.Array(Type.String())),
          query: optionalString(),
          ids: Type.Optional(Type.Array(Type.String())),
          userIds: Type.Optional(Type.Array(Type.String())),
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
    description:
      "Create one or more Forge entities through the ordered batch workflow. Pass `operations` as an array. Each operation must include `entityType` and full `data`. This is the preferred create path for planning, Psyche, calendar, preferences basic CRUD, and questionnaire_instrument records.",
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
    description:
      "Update one or more Forge entities through the ordered batch workflow. Pass `operations` as an array. Each operation must include `entityType`, `id`, and `patch`. This is the preferred update path for calendar_event, work_block_template, task_timebox, preferences basic CRUD entities, and questionnaire_instrument too.",
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
    description:
      "Delete Forge entities in one batch request. Pass `operations` as an array with `entityType` and `id`. Delete defaults to soft mode unless hard is requested explicitly. Some entities such as calendar-domain records, preference CRUD entities, and questionnaire_instrument delete immediately by design.",
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
    description:
      "Restore soft-deleted Forge entities from the settings bin through the batch workflow. Pass `operations` as an array with `entityType` and `id`.",
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
    description:
      "Grant an explicit manual XP bonus or penalty with provenance. Use only for auditable operator judgement beyond the normal task-run and habit reward flows.",
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
    description:
      "Add or remove tracked work minutes on an existing task or project without creating a live task run. Forge applies symmetric XP changes when the total crosses reward buckets.",
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
    description:
      "Post a structured Forge insight after reading the overview. This stores an agent-authored observation or recommendation with provenance.",
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
      ctaLabel:
        typeof params.ctaLabel === "string" ? params.ctaLabel : "Review insight"
    })
  });

  registerWriteTool(api, config, {
    name: "forge_log_work",
    label: "Forge Log Work",
    description:
      "Log retroactive work or mark an existing task as completed through the operator work-log flow. Use this when the user already did the work and wants truthful evidence plus XP. Prefer closeoutNote when the summary should survive as a real linked note.",
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
      tagIds: Type.Optional(Type.Array(Type.String())),
      closeoutNote: Type.Optional(noteInputSchema())
    }),
    method: "POST",
    path: "/api/v1/operator/log-work"
  });

  api.registerTool({
    name: "forge_start_task_run",
    label: "Forge Start Task Run",
    description:
      "Start real live work on a task. This creates or reuses a task run and is the truthful way to start work, not just changing task status.",
    parameters: Type.Object({
      taskId: Type.String({ minLength: 1 }),
      actor: Type.String({ minLength: 1 }),
      timerMode: Type.Optional(
        Type.Union([Type.Literal("planned"), Type.Literal("unlimited")])
      ),
      plannedDurationSeconds: Type.Optional(
        Type.Union([Type.Integer({ minimum: 60, maximum: 86400 }), Type.Null()])
      ),
      overrideReason: optionalNullableString(),
      isCurrent: Type.Optional(Type.Boolean()),
      leaseTtlSeconds: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 14400 })
      ),
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
            overrideReason: typed.overrideReason,
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
    description:
      "Refresh the lease on an active task run while work is continuing.",
    parameters: Type.Object({
      taskRunId: Type.String({ minLength: 1 }),
      actor: optionalString(),
      leaseTtlSeconds: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 14400 })
      ),
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
    description:
      "Mark an active task run as the current focused run when several runs exist.",
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
    description:
      "Finish an active task run as completed work and let Forge award the appropriate completion rewards. Prefer closeoutNote when the work summary should become a real linked note.",
    parameters: Type.Object({
      taskRunId: Type.String({ minLength: 1 }),
      actor: optionalString(),
      note: Type.Optional(Type.String()),
      closeoutNote: Type.Optional(noteInputSchema())
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: `/api/v1/task-runs/${typed.taskRunId as string}/complete`,
          body: {
            actor: typed.actor,
            note: typed.note,
            closeoutNote: typed.closeoutNote
          }
        })
      );
    }
  });

  api.registerTool({
    name: "forge_release_task_run",
    label: "Forge Release Task Run",
    description:
      "Stop an active task run without completing it. Use this to truthfully stop current work. Prefer closeoutNote when blockers or handoff context should become a real linked note.",
    parameters: Type.Object({
      taskRunId: Type.String({ minLength: 1 }),
      actor: optionalString(),
      note: Type.Optional(Type.String()),
      closeoutNote: Type.Optional(noteInputSchema())
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: `/api/v1/task-runs/${typed.taskRunId as string}/release`,
          body: {
            actor: typed.actor,
            note: typed.note,
            closeoutNote: typed.closeoutNote
          }
        })
      );
    }
  });

  registerReadTool(api, config, {
    name: "forge_get_calendar_overview",
    label: "Forge Calendar Overview",
    description:
      "Read the calendar domain in one response: provider metadata, connected calendars, Forge-native events, mirrored events, recurring work blocks, and task timeboxes.",
    parameters: calendarOverviewReadSchema,
    path: (params) =>
      withQueryParams(
        "/api/v1/calendar/overview",
        params as Record<string, unknown>,
        ["from", "to", "userIds"]
      )
  });

  registerWriteTool(api, config, {
    name: "forge_connect_calendar_provider",
    label: "Forge Connect Calendar Provider",
    description:
      "Create a Google, Apple, Exchange Online, calendars already configured on this Mac, or custom CalDAV calendar connection. Use this only for explicit provider-connection requests after discovery choices are known.",
    parameters: calendarConnectionParametersSchema,
    method: "POST",
    path: "/api/v1/calendar/connections"
  });

  api.registerTool({
    name: "forge_sync_calendar_connection",
    label: "Forge Sync Calendar Connection",
    description: "Pull and push changes for one connected calendar provider.",
    parameters: Type.Object({
      connectionId: Type.String({ minLength: 1 })
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: `/api/v1/calendar/connections/${typed.connectionId as string}/sync`,
          body: {}
        })
      );
    }
  });

  registerWriteTool(api, config, {
    name: "forge_create_work_block_template",
    label: "Forge Create Work Block",
    description:
      "Create a recurring work-block template such as Main Activity, Secondary Activity, Third Activity, Rest, Holiday, or Custom. This is a planning helper; agents can also use forge_create_entities with entityType work_block_template.",
    parameters: Type.Object({
      title: Type.String({ minLength: 1 }),
      kind: Type.Union([
        Type.Literal("main_activity"),
        Type.Literal("secondary_activity"),
        Type.Literal("third_activity"),
        Type.Literal("rest"),
        Type.Literal("holiday"),
        Type.Literal("custom")
      ]),
      color: Type.String({ minLength: 1 }),
      timezone: Type.String({ minLength: 1 }),
      weekDays: Type.Array(Type.Integer({ minimum: 0, maximum: 6 })),
      startMinute: Type.Integer({ minimum: 0, maximum: 1440 }),
      endMinute: Type.Integer({ minimum: 0, maximum: 1440 }),
      startsOn: Type.Optional(
        Type.Union([Type.String({ minLength: 1 }), Type.Null()])
      ),
      endsOn: Type.Optional(
        Type.Union([Type.String({ minLength: 1 }), Type.Null()])
      ),
      blockingState: Type.Union([
        Type.Literal("allowed"),
        Type.Literal("blocked")
      ])
    }),
    method: "POST",
    path: "/api/v1/calendar/work-block-templates"
  });

  registerWriteTool(api, config, {
    name: "forge_recommend_task_timeboxes",
    label: "Forge Recommend Task Timeboxes",
    description:
      "Suggest future task timeboxes that fit the current calendar rules and current schedule.",
    parameters: Type.Object({
      taskId: Type.String({ minLength: 1 }),
      from: optionalString(),
      to: optionalString(),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 24 }))
    }),
    method: "POST",
    path: "/api/v1/calendar/timeboxes/recommend"
  });

  registerWriteTool(api, config, {
    name: "forge_create_task_timebox",
    label: "Forge Create Task Timebox",
    description:
      "Create a planned task timebox directly in Forge's calendar domain. This is a planning helper; agents can also use forge_create_entities with entityType task_timebox.",
    parameters: Type.Object({
      taskId: Type.String({ minLength: 1 }),
      projectId: optionalNullableString(),
      title: Type.String({ minLength: 1 }),
      startsAt: Type.String({ minLength: 1 }),
      endsAt: Type.String({ minLength: 1 }),
      source: Type.Optional(
        Type.Union([
          Type.Literal("manual"),
          Type.Literal("suggested"),
          Type.Literal("live_run")
        ])
      )
    }),
    method: "POST",
    path: "/api/v1/calendar/timeboxes"
  });
}
