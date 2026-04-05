import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import {
  configureDatabase,
  configureDatabaseSeeding,
  runInTransaction
} from "./db.js";
import { HttpError, isHttpError, type ValidationIssue } from "./errors.js";
import {
  listActivityEvents,
  listActivityEventsForTask,
  recordActivityEvent,
  removeActivityEvent
} from "./repositories/activity-events.js";
import {
  approveApprovalRequest,
  createAgentAction,
  createInsight,
  createInsightFeedback,
  deleteInsight,
  getInsightById,
  listAgentActions,
  listApprovalRequests,
  listInsights,
  rejectApprovalRequest,
  updateInsight
} from "./repositories/collaboration.js";
import { listEventLog } from "./repositories/event-log.js";
import {
  createGoal,
  getGoalById,
  listGoals,
  updateGoal
} from "./repositories/goals.js";
import {
  createHabit,
  createHabitCheckIn,
  deleteHabit,
  getHabitById,
  listHabits,
  updateHabit
} from "./repositories/habits.js";
import { listDomains } from "./repositories/domains.js";
import {
  buildNotesSummaryByEntity,
  createNote,
  getNoteById,
  listNotes,
  updateNote
} from "./repositories/notes.js";
import {
  createWikiIngestJobSchema,
  createWikiSpace,
  createWikiSpaceSchema,
  deleteWikiProfile,
  getWikiHealth,
  getWikiIngestJob,
  getWikiHomePageDetail,
  getWikiPageDetail,
  getWikiPageDetailBySlug,
  getWikiSettingsPayload,
  ingestWikiSource,
  listWikiPageTree,
  listWikiPages,
  listWikiSpaces,
  reindexWikiEmbeddings,
  reindexWikiEmbeddingsSchema,
  searchWikiPages,
  syncWikiVaultFromDisk,
  syncWikiVaultSchema,
  upsertWikiEmbeddingProfile,
  upsertWikiEmbeddingProfileSchema,
  upsertWikiLlmProfile,
  upsertWikiLlmProfileSchema,
  wikiSearchQuerySchema
} from "./repositories/wiki-memory.js";
import {
  filterOwnedEntities,
  setEntityOwner
} from "./repositories/entity-ownership.js";
import {
  createBehavior,
  createBehaviorPattern,
  createBeliefEntry,
  createEmotionDefinition,
  createEventType,
  createModeGuideSession,
  createModeProfile,
  createPsycheValue,
  createTriggerReport,
  getBehaviorById,
  getBehaviorPatternById,
  getBeliefEntryById,
  getEmotionDefinitionById,
  getEventTypeById,
  getModeGuideSessionById,
  getModeProfileById,
  getPsycheValueById,
  getTriggerReportById,
  listBehaviors,
  listBehaviorPatterns,
  listBeliefEntries,
  listEmotionDefinitions,
  listEventTypes,
  listModeGuideSessions,
  listModeProfiles,
  listPsycheValues,
  listSchemaCatalog,
  listTriggerReports,
  updateBehavior,
  updateBehaviorPattern,
  updateBeliefEntry,
  updateEmotionDefinition,
  updateEventType,
  updateModeGuideSession,
  updateModeProfile,
  updatePsycheValue,
  updateTriggerReport
} from "./repositories/psyche.js";
import { createProject, updateProject } from "./repositories/projects.js";
import {
  createPreferenceCatalog,
  createPreferenceCatalogItem,
  createPreferenceContext,
  createPreferenceItem,
  createPreferenceItemFromEntity,
  deletePreferenceCatalog,
  deletePreferenceCatalogItem,
  getPreferenceWorkspace,
  mergePreferenceContexts,
  startPreferenceGame,
  submitAbsoluteSignal,
  submitPairwiseJudgment,
  updatePreferenceCatalog,
  updatePreferenceCatalogItem,
  updatePreferenceContext,
  updatePreferenceItem,
  updatePreferenceScore
} from "./repositories/preferences.js";
import {
  createStrategy,
  deleteStrategy,
  getStrategyById,
  listStrategies,
  updateStrategy
} from "./repositories/strategies.js";
import {
  createManualRewardGrant,
  getDailyAmbientXp,
  getRewardRuleById,
  listRewardLedger,
  listRewardRules,
  recordWorkAdjustmentReward,
  recordSessionEvent,
  updateRewardRule
} from "./repositories/rewards.js";
import {
  listAgentIdentities,
  getSettings,
  isPsycheAuthRequired,
  updateSettings,
  verifyAgentToken
} from "./repositories/settings.js";
import {
  createTag,
  getTagById,
  listTags,
  updateTag
} from "./repositories/tags.js";
import {
  createUser,
  ensureSystemUsers,
  getUserById,
  listUserAccessGrants,
  listUserOwnershipSummaries,
  listUserXpSummaries,
  listUsers,
  resolveUserForMutation,
  updateUserAccessGrant,
  updateUser
} from "./repositories/users.js";
import {
  claimTaskRun,
  completeTaskRun,
  focusTaskRun,
  heartbeatTaskRun,
  listTaskRuns,
  recoverTimedOutTaskRuns,
  releaseTaskRun
} from "./repositories/task-runs.js";
import {
  createTask,
  createTaskWithIdempotency,
  getTaskById,
  listTasks,
  uncompleteTask,
  updateTask
} from "./repositories/tasks.js";
import { createWorkAdjustment } from "./repositories/work-adjustments.js";
import {
  createCalendarEvent,
  createTaskTimebox,
  createWorkBlockTemplate,
  deleteCalendarEvent,
  deleteTaskTimebox,
  deleteWorkBlockTemplate,
  getCalendarConnectionById,
  getCalendarEventById,
  listCalendars,
  listCalendarEvents,
  listTaskTimeboxes,
  suggestTaskTimeboxes,
  listWorkBlockInstances,
  listWorkBlockTemplates,
  updateCalendarEvent,
  updateCalendarConnectionRecord,
  updateTaskTimebox,
  updateWorkBlockTemplate
} from "./repositories/calendar.js";
import { getDashboard } from "./services/dashboard.js";
import {
  getOverviewContext,
  getRiskContext,
  getTodayContext
} from "./services/context.js";
import {
  buildGamificationOverview,
  buildGamificationProfile,
  buildXpMomentumPulse
} from "./services/gamification.js";
import { getInsightsPayload } from "./services/insights.js";
import {
  createEntities,
  deleteEntities,
  deleteEntity,
  getSettingsBinPayload,
  restoreEntities,
  searchEntities,
  updateEntities
} from "./services/entity-crud.js";
import { getPsycheOverview } from "./services/psyche.js";
import {
  getProjectBoard,
  getProjectSummary,
  listProjectSummaries
} from "./services/projects.js";
import { getWeeklyReviewPayload } from "./services/reviews.js";
import { finalizeWeeklyReviewClosure } from "./repositories/weekly-reviews.js";
import {
  createTaskRunWatchdog,
  type TaskRunWatchdogOptions
} from "./services/task-run-watchdog.js";
import { suggestTags } from "./services/tagging.js";
import {
  CalendarConnectionConflictError,
  completeMicrosoftCalendarOauth,
  createCalendarConnection,
  deleteCalendarEventProjection,
  discoverCalendarConnection,
  discoverExistingCalendarConnection,
  getMicrosoftCalendarOauthSession,
  listConnectedCalendarConnections,
  removeCalendarConnection,
  pushCalendarEventUpdate,
  readCalendarOverview,
  syncCalendarConnection,
  startMicrosoftCalendarOauth,
  testMicrosoftCalendarOauthConfiguration,
  listCalendarProviderMetadata,
  updateCalendarConnectionSelection
} from "./services/calendar-runtime.js";
import {
  PSYCHE_ENTITY_TYPES,
  createBehaviorSchema,
  createBeliefEntrySchema,
  createBehaviorPatternSchema,
  createEmotionDefinitionSchema,
  createEventTypeSchema,
  createModeGuideSessionSchema,
  createModeProfileSchema,
  createPsycheValueSchema,
  createTriggerReportSchema,
  updateBehaviorSchema,
  updateBeliefEntrySchema,
  updateBehaviorPatternSchema,
  updateEmotionDefinitionSchema,
  updateEventTypeSchema,
  updateModeGuideSessionSchema,
  updateModeProfileSchema,
  updatePsycheValueSchema,
  updateTriggerReportSchema
} from "./psyche-types.js";
import {
  createPreferenceCatalogItemSchema,
  createPreferenceCatalogSchema,
  createPreferenceContextSchema,
  createPreferenceItemSchema,
  enqueueEntityPreferenceItemSchema,
  mergePreferenceContextsSchema,
  preferenceWorkspaceQuerySchema,
  startPreferenceGameSchema,
  submitAbsoluteSignalSchema,
  submitPairwiseJudgmentSchema,
  updatePreferenceCatalogItemSchema,
  updatePreferenceCatalogSchema,
  updatePreferenceContextSchema,
  updatePreferenceItemSchema,
  updatePreferenceScoreSchema
} from "./preferences-types.js";
import {
  activityListQuerySchema,
  activitySourceSchema,
  createAgentActionSchema,
  createAgentTokenSchema,
  batchCreateEntitiesSchema,
  batchDeleteEntitiesSchema,
  batchRestoreEntitiesSchema,
  batchSearchEntitiesSchema,
  batchUpdateEntitiesSchema,
  createGoalSchema,
  createInsightFeedbackSchema,
  createInsightSchema,
  createStrategySchema,
  createUserSchema,
  createNoteSchema,
  createProjectSchema,
  createManualRewardGrantSchema,
  createCalendarEventSchema,
  createHabitCheckInSchema,
  createCalendarConnectionSchema,
  discoverCalendarConnectionSchema,
  startMicrosoftCalendarOauthSchema,
  testMicrosoftCalendarOauthConfigurationSchema,
  createHabitSchema,
  createTaskTimeboxSchema,
  createWorkBlockTemplateSchema,
  createSessionEventSchema,
  createWorkAdjustmentSchema,
  createTagSchema,
  calendarOverviewQuerySchema,
  notesListQuerySchema,
  updateTagSchema,
  createTaskSchema,
  eventsListQuerySchema,
  operatorLogWorkSchema,
  projectBoardPayloadSchema,
  projectListQuerySchema,
  entityDeleteQuerySchema,
  removeActivityEventSchema,
  resolveApprovalRequestSchema,
  rewardsLedgerQuerySchema,
  habitListQuerySchema,
  taskContextPayloadSchema,
  taskRunClaimSchema,
  taskRunFocusSchema,
  taskRunFinishSchema,
  taskRunHeartbeatSchema,
  taskRunListQuerySchema,
  taskListQuerySchema,
  tagSuggestionRequestSchema,
  uncompleteTaskSchema,
  updateSettingsSchema,
  updateGoalSchema,
  updateHabitSchema,
  updateInsightSchema,
  updateStrategySchema,
  updateUserSchema,
  updateCalendarConnectionSchema,
  updateCalendarEventSchema,
  updateNoteSchema,
  updateProjectSchema,
  updateRewardRuleSchema,
  updateTaskTimeboxSchema,
  updateTaskSchema,
  updateUserAccessGrantSchema,
  updateWorkBlockTemplateSchema,
  workAdjustmentResultSchema,
  finalizeWeeklyReviewResultSchema,
  goalListQuerySchema,
  recommendTaskTimeboxesSchema,
  strategyListQuerySchema,
  type Note,
  type TaskTimeSummary,
  type WorkAdjustmentEntityType
} from "./types.js";
import { buildOpenApiDocument } from "./openapi.js";
import { registerWebRoutes } from "./web.js";
import { createManagerRuntime } from "./managers/runtime.js";
import { isManagerError } from "./managers/type-guards.js";
import {
  createCompanionPairingSession,
  createCompanionPairingSessionSchema,
  getCompanionOverview,
  getFitnessViewData,
  getSleepViewData,
  ingestMobileHealthSync,
  mobileHealthSyncSchema,
  revokeCompanionPairingSession,
  verifyCompanionPairing,
  verifyCompanionPairingSchema,
  updateSleepMetadata,
  updateSleepMetadataSchema,
  updateWorkoutMetadata,
  updateWorkoutMetadataSchema
} from "./health.js";

const COMPATIBILITY_SUNSET = "transitional-node";

function markCompatibilityRoute(reply: {
  header: (name: string, value: string) => unknown;
}) {
  reply.header("Deprecation", "true");
  reply.header("Sunset", COMPATIBILITY_SUNSET);
  reply.header("Link", '</api/v1/openapi.json>; rel="successor-version"');
}

function markDeprecatedAliasRoute(
  reply: { header: (name: string, value: string) => unknown },
  successorPath: string
) {
  reply.header("Deprecation", "true");
  reply.header("Sunset", COMPATIBILITY_SUNSET);
  reply.header("Link", `<${successorPath}>; rel="successor-version"`);
}

function buildEventStreamMeta() {
  return {
    transport: "sse" as const,
    endpoint: "/api/v1/events/stream",
    retryMs: 3000,
    heartbeatIntervalMs: 15000,
    pollIntervalMs: 3000,
    events: [
      {
        name: "snapshot",
        description:
          "Initial connection payload carrying the latest activity watermark.",
        payload: {
          generatedAt: "date-time",
          latestActivityId: "string|null"
        }
      },
      {
        name: "activity",
        description: "Emitted when a newer activity event becomes visible.",
        payload: "ActivityEvent"
      },
      {
        name: "collaboration",
        description:
          "Emitted when approvals, insights, or agent actions change.",
        payload: {
          entityType: "string",
          entityId: "string"
        }
      },
      {
        name: "reward",
        description: "Emitted when XP or reward-ledger state changes.",
        payload: {
          deltaXp: "integer",
          entityType: "string",
          entityId: "string"
        }
      },
      {
        name: "heartbeat",
        description: "Keepalive pulse used to keep the connection warm.",
        payload: {
          now: "date-time"
        }
      }
    ],
    reconnect: {
      strategy: "client-reconnect",
      lastEventSupport: false
    }
  };
}

function buildApiBaseUrl(request: {
  protocol: string;
  headers: Record<string, unknown>;
}) {
  const referer =
    typeof request.headers.referer === "string"
      ? request.headers.referer.trim()
      : "";
  if (referer) {
    try {
      const url = new URL(referer);
      const forgeMounted = url.pathname.startsWith("/forge/");
      return `${url.origin}${forgeMounted ? "/forge" : ""}/api/v1`;
    } catch {
      // Fall through to host-based resolution.
    }
  }
  const host =
    typeof request.headers.host === "string" &&
    request.headers.host.trim().length > 0
      ? request.headers.host.trim()
      : "127.0.0.1:4317";
  const forwardedPrefix =
    typeof request.headers["x-forwarded-prefix"] === "string"
      ? request.headers["x-forwarded-prefix"].trim()
      : "";
  const basePath = forwardedPrefix.replace(/\/$/, "");
  return `${request.protocol}://${host}${basePath}/api/v1`;
}

function readSingleForwardedHeader(value: unknown): string | null {
  if (Array.isArray(value)) {
    return value[0]?.split(",")[0]?.trim() || null;
  }
  if (typeof value === "string") {
    return value.split(",")[0]?.trim() || null;
  }
  return null;
}

function getRequestOrigin(request: {
  protocol: string;
  hostname: string;
  headers: Record<string, unknown>;
}): string {
  const protocol =
    readSingleForwardedHeader(request.headers["x-forwarded-proto"]) ??
    request.protocol ??
    "http";
  const host =
    readSingleForwardedHeader(request.headers["x-forwarded-host"]) ??
    readSingleForwardedHeader(request.headers.host) ??
    request.hostname;

  return `${protocol}://${host}`;
}

const AGENT_ONBOARDING_ENTITY_CATALOG = [
  {
    entityType: "goal",
    purpose:
      "A long-horizon outcome or direction. Goals anchor projects and tasks.",
    minimumCreateFields: ["title"],
    relationshipRules: [
      "Goals sit above projects and tasks.",
      "Projects should usually link to one goal through goalId.",
      "Tasks can link directly to a goal when no project exists yet."
    ],
    searchHints: [
      "Search by title before creating a new goal.",
      "Use status filters when looking for paused or completed goals."
    ],
    examples: [
      '{"title":"Create meaningfully","horizon":"lifetime","description":"Make work that is honest, beautiful, and published."}',
      '{"title":"Build a beautiful family","horizon":"lifetime","description":"Invest in love, stability, and shared rituals."}'
    ],
    fieldGuide: [
      {
        name: "title",
        type: "string",
        required: true,
        description: "Human-readable goal name."
      },
      {
        name: "description",
        type: "string",
        required: false,
        description:
          "Markdown description for why the goal matters or what success looks like.",
        defaultValue: ""
      },
      {
        name: "horizon",
        type: "quarter|year|lifetime",
        required: false,
        description: "How far out the goal is meant to live.",
        enumValues: ["quarter", "year", "lifetime"],
        defaultValue: "year"
      },
      {
        name: "status",
        type: "active|paused|completed",
        required: false,
        description: "Current lifecycle state for the goal.",
        enumValues: ["active", "paused", "completed"],
        defaultValue: "active"
      },
      {
        name: "userId",
        type: "string|null",
        required: false,
        description:
          "Owning human or bot user id. Omit it to use Forge's default owner.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "targetPoints",
        type: "integer",
        required: false,
        description: "Approximate XP/point target for the goal.",
        defaultValue: 400
      },
      {
        name: "themeColor",
        type: "hex-color",
        required: false,
        description: "Visual color used in the UI.",
        defaultValue: "#c8a46b"
      },
      {
        name: "tagIds",
        type: "string[]",
        required: false,
        description: "Existing tag ids linked to the goal.",
        defaultValue: []
      },
      {
        name: "notes",
        type: "Array<{ contentMarkdown, author?, tags?, destroyAt?, links? }>",
        required: false,
        description:
          "Optional nested notes that will auto-link to the new goal.",
        defaultValue: []
      }
    ]
  },
  {
    entityType: "project",
    purpose: "A concrete multi-step workstream under a goal.",
    minimumCreateFields: ["goalId", "title"],
    relationshipRules: [
      "Every project belongs to a goal through goalId.",
      "Tasks can link to a project through projectId.",
      "Projects inherit strategic meaning from their parent goal."
    ],
    searchHints: [
      "Search by title inside the target goal before creating a new project."
    ],
    examples: [
      '{"goalId":"goal_create_meaningfully","title":"Launch the public Forge plugin","description":"Ship a real public release that people can install."}'
    ],
    fieldGuide: [
      {
        name: "goalId",
        type: "string",
        required: true,
        description: "Existing parent goal id."
      },
      {
        name: "title",
        type: "string",
        required: true,
        description: "Project name."
      },
      {
        name: "description",
        type: "string",
        required: false,
        description: "Markdown description for the desired outcome or scope.",
        defaultValue: ""
      },
      {
        name: "status",
        type: "active|paused|completed",
        required: false,
        description: "Lifecycle state.",
        enumValues: ["active", "paused", "completed"],
        defaultValue: "active"
      },
      {
        name: "userId",
        type: "string|null",
        required: false,
        description:
          "Owning human or bot user id. Omit it to use Forge's default owner.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "targetPoints",
        type: "integer",
        required: false,
        description: "Approximate XP/point target for the project.",
        defaultValue: 240
      },
      {
        name: "themeColor",
        type: "hex-color",
        required: false,
        description: "Visual color used in the UI.",
        defaultValue: "#c0c1ff"
      },
      {
        name: "notes",
        type: "Array<{ contentMarkdown, author?, tags?, destroyAt?, links? }>",
        required: false,
        description:
          "Optional nested notes that will auto-link to the new project.",
        defaultValue: []
      }
    ]
  },
  {
    entityType: "strategy",
    purpose:
      "A directed, non-loopy execution plan that connects current work to target goals or projects.",
    minimumCreateFields: ["title", "graph"],
    relationshipRules: [
      "Strategies can target one or many goals or projects.",
      "Graph nodes must reference existing projects or tasks.",
      "Graph edges must remain directed and acyclic.",
      "linkedEntities is for related context that should stay visible without becoming part of the main sequence."
    ],
    searchHints: [
      "Search by title or linked target before creating a duplicate strategy.",
      "Use userIds when you want strategies owned by specific humans or bots."
    ],
    examples: [
      '{"title":"Ship multi-user Forge","overview":"Separate humans and bots, then connect the systems with shared strategies.","endStateDescription":"Forge supports human and bot users across all routes and views.","targetGoalIds":["goal_123"],"targetProjectIds":["project_123"],"graph":{"nodes":[{"id":"node_a","entityType":"project","entityId":"project_123","title":"Multi-user backend","branchLabel":"Core","notes":"Land ownership and route scope first."},{"id":"node_b","entityType":"task","entityId":"task_123","title":"Strategy UI polish","branchLabel":"UI","notes":"Surface alignment and graph editing in the app."}],"edges":[{"from":"node_a","to":"node_b","label":"after backend lands","condition":""}]}}'
    ],
    fieldGuide: [
      {
        name: "title",
        type: "string",
        required: true,
        description: "Strategy name."
      },
      {
        name: "overview",
        type: "string",
        required: false,
        description: "What this strategy is for and why it matters.",
        defaultValue: ""
      },
      {
        name: "endStateDescription",
        type: "string",
        required: false,
        description: "What done looks like when the strategy lands.",
        defaultValue: ""
      },
      {
        name: "status",
        type: "active|paused|completed",
        required: false,
        description: "Lifecycle state.",
        enumValues: ["active", "paused", "completed"],
        defaultValue: "active"
      },
      {
        name: "userId",
        type: "string|null",
        required: false,
        description:
          "Owning human or bot user id. Omit it to use Forge's default owner.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "targetGoalIds",
        type: "string[]",
        required: false,
        description: "Goal ids this strategy is meant to land.",
        defaultValue: []
      },
      {
        name: "targetProjectIds",
        type: "string[]",
        required: false,
        description: "Project ids this strategy is meant to land.",
        defaultValue: []
      },
      {
        name: "linkedEntities",
        type: "Array<{ entityType, entityId }>",
        required: false,
        description:
          "Related entities that should stay visible in the strategy context.",
        defaultValue: []
      },
      {
        name: "graph",
        type: "StrategyGraph",
        required: true,
        description:
          "Directed acyclic graph with nodes referencing projects/tasks and edges defining the flow order."
      }
    ]
  },
  {
    entityType: "task",
    purpose:
      "A concrete actionable work item. Tasks are what the user actually does.",
    minimumCreateFields: ["title"],
    relationshipRules: [
      "A task can link to a goal, a project, both, or neither.",
      "Live work is tracked by task runs, not by task status alone.",
      "A task status of in_progress does not guarantee a live active run."
    ],
    searchHints: [
      "Search by title before creating a duplicate task.",
      "Use linkedTo filters when you know the parent goal or project."
    ],
    examples: [
      '{"title":"Write the plugin release notes","projectId":"project_forge_plugin_launch","status":"focus","priority":"high"}'
    ],
    fieldGuide: [
      {
        name: "title",
        type: "string",
        required: true,
        description: "Concrete action label."
      },
      {
        name: "description",
        type: "string",
        required: false,
        description: "Markdown context, constraints, or acceptance notes.",
        defaultValue: ""
      },
      {
        name: "status",
        type: "backlog|focus|in_progress|blocked|done",
        required: false,
        description: "Board lane or completion state.",
        enumValues: ["backlog", "focus", "in_progress", "blocked", "done"],
        defaultValue: "backlog"
      },
      {
        name: "priority",
        type: "low|medium|high|critical",
        required: false,
        description: "Relative urgency.",
        enumValues: ["low", "medium", "high", "critical"],
        defaultValue: "medium"
      },
      {
        name: "owner",
        type: "string",
        required: false,
        description: "Human-facing owner label.",
        defaultValue: "Albert"
      },
      {
        name: "userId",
        type: "string|null",
        required: false,
        description:
          "Owning human or bot user id. Omit it to use Forge's default owner.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "goalId",
        type: "string|null",
        required: false,
        description: "Linked goal id.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "projectId",
        type: "string|null",
        required: false,
        description: "Linked project id.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "dueDate",
        type: "YYYY-MM-DD|null",
        required: false,
        description: "Optional due date.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "effort",
        type: "light|deep|marathon",
        required: false,
        description: "How heavy the task feels.",
        enumValues: ["light", "deep", "marathon"],
        defaultValue: "deep"
      },
      {
        name: "energy",
        type: "low|steady|high",
        required: false,
        description: "Energy demand.",
        enumValues: ["low", "steady", "high"],
        defaultValue: "steady"
      },
      {
        name: "points",
        type: "integer",
        required: false,
        description: "Reward value for the task.",
        defaultValue: 40
      },
      {
        name: "sortOrder",
        type: "integer",
        required: false,
        description: "Lane ordering hint when set explicitly."
      },
      {
        name: "tagIds",
        type: "string[]",
        required: false,
        description: "Existing tag ids linked to the task.",
        defaultValue: []
      },
      {
        name: "notes",
        type: "Array<{ contentMarkdown, author?, tags?, destroyAt?, links? }>",
        required: false,
        description:
          "Optional nested notes that will auto-link to the new task.",
        defaultValue: []
      }
    ]
  },
  {
    entityType: "calendar_event",
    purpose:
      "A canonical Forge calendar event that can live locally first and then project to connected provider calendars.",
    minimumCreateFields: ["title", "startAt", "endAt"],
    relationshipRules: [
      "Forge stores the canonical event first; provider copies are downstream projections.",
      "Use links to connect the event to goals, projects, tasks, habits, notes, or Psyche entities.",
      "If preferredCalendarId is omitted, Forge uses the default writable connected calendar when one exists.",
      "Set preferredCalendarId to null only when the user explicitly wants Forge-only storage."
    ],
    searchHints: [
      "Search by title or linked entity before creating a duplicate event.",
      "Use linkedTo when you know the goal, project, task, or habit the event should already reference."
    ],
    examples: [
      '{"title":"Weekly research supervision","startAt":"2026-04-06T06:00:00.000Z","endAt":"2026-04-06T07:00:00.000Z","timezone":"Europe/Zurich","links":[{"entityType":"project","entityId":"project_123","relationshipType":"meeting_for"}]}'
    ],
    fieldGuide: [
      {
        name: "title",
        type: "string",
        required: true,
        description: "Human-readable event title."
      },
      {
        name: "description",
        type: "string",
        required: false,
        description: "Longer event description.",
        defaultValue: ""
      },
      {
        name: "location",
        type: "string",
        required: false,
        description: "Location or meeting place.",
        defaultValue: ""
      },
      {
        name: "startAt",
        type: "ISO datetime",
        required: true,
        description: "Start instant in ISO-8601 form."
      },
      {
        name: "endAt",
        type: "ISO datetime",
        required: true,
        description: "End instant in ISO-8601 form."
      },
      {
        name: "timezone",
        type: "string",
        required: false,
        description: "IANA timezone label.",
        defaultValue: "UTC"
      },
      {
        name: "isAllDay",
        type: "boolean",
        required: false,
        description: "Whether this is an all-day event.",
        defaultValue: false
      },
      {
        name: "availability",
        type: "busy|free",
        required: false,
        description: "Availability state exposed to scheduling rules.",
        enumValues: ["busy", "free"],
        defaultValue: "busy"
      },
      {
        name: "eventType",
        type: "string",
        required: false,
        description: "Optional event category label used by scheduling rules.",
        defaultValue: ""
      },
      {
        name: "categories",
        type: "string[]",
        required: false,
        description: "Optional provider-style categories.",
        defaultValue: []
      },
      {
        name: "preferredCalendarId",
        type: "string|null",
        required: false,
        description:
          "Writable connected calendar to project into. Omit it to use the default writable connected calendar. Set null only to force Forge-only storage.",
        defaultValue: "default writable connected calendar when available",
        nullable: true
      },
      {
        name: "links",
        type: "Array<{ entityType, entityId, relationshipType? }>",
        required: false,
        description: "Forge entities linked to this event.",
        defaultValue: []
      }
    ]
  },
  {
    entityType: "work_block_template",
    purpose:
      "A recurring work-availability template such as Main Activity, Secondary Activity, Third Activity, Rest, Holiday, or Custom.",
    minimumCreateFields: [
      "title",
      "kind",
      "timezone",
      "weekDays",
      "startMinute",
      "endMinute",
      "blockingState"
    ],
    relationshipRules: [
      "Work block templates derive visible calendar instances for the requested range instead of storing one repeated event per day.",
      "startsOn and endsOn are optional active-date bounds. Leaving endsOn null makes the block repeat indefinitely.",
      "They are Forge-owned scheduling structures, not mirrored provider events."
    ],
    searchHints: [
      "Search by title or kind before creating a duplicate recurring block."
    ],
    examples: [
      '{"title":"Main Activity","kind":"main_activity","color":"#f97316","timezone":"Europe/Zurich","weekDays":[1,2,3,4,5],"startMinute":480,"endMinute":720,"startsOn":"2026-04-06","endsOn":null,"blockingState":"blocked"}',
      '{"title":"Summer holiday","kind":"holiday","color":"#14b8a6","timezone":"Europe/Zurich","weekDays":[0,1,2,3,4,5,6],"startMinute":0,"endMinute":1440,"startsOn":"2026-08-01","endsOn":"2026-08-16","blockingState":"blocked"}'
    ],
    fieldGuide: [
      {
        name: "title",
        type: "string",
        required: true,
        description: "Display name for the recurring block."
      },
      {
        name: "kind",
        type: "main_activity|secondary_activity|third_activity|rest|holiday|custom",
        required: true,
        description: "Preset or custom block type.",
        enumValues: [
          "main_activity",
          "secondary_activity",
          "third_activity",
          "rest",
          "holiday",
          "custom"
        ]
      },
      {
        name: "color",
        type: "hex-color",
        required: false,
        description: "UI color for generated instances.",
        defaultValue: "#60a5fa"
      },
      {
        name: "timezone",
        type: "string",
        required: true,
        description: "IANA timezone that defines the recurring window."
      },
      {
        name: "weekDays",
        type: "integer[]",
        required: true,
        description: "Weekday numbers where Sunday is 0 and Saturday is 6."
      },
      {
        name: "startMinute",
        type: "integer",
        required: true,
        description: "Minute from midnight where the block starts."
      },
      {
        name: "endMinute",
        type: "integer",
        required: true,
        description: "Minute from midnight where the block ends."
      },
      {
        name: "startsOn",
        type: "YYYY-MM-DD|null",
        required: false,
        description: "Optional first active date for the recurring block.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "endsOn",
        type: "YYYY-MM-DD|null",
        required: false,
        description:
          "Optional last active date. Null means repeat indefinitely.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "blockingState",
        type: "allowed|blocked",
        required: true,
        description: "Whether this block generally allows or blocks work.",
        enumValues: ["allowed", "blocked"]
      }
    ]
  },
  {
    entityType: "task_timebox",
    purpose: "A planned or live calendar slot attached to a task.",
    minimumCreateFields: ["taskId", "title", "startsAt", "endsAt"],
    relationshipRules: [
      "Task timeboxes belong to a task and can optionally carry the parent project id.",
      "Live task runs can attach to matching timeboxes later; creating a timebox does not start work by itself."
    ],
    searchHints: [
      "Search by task linkage or title before creating another slot for the same work block."
    ],
    examples: [
      '{"taskId":"task_123","projectId":"project_456","title":"Draft the methods section","startsAt":"2026-04-03T08:00:00.000Z","endsAt":"2026-04-03T09:30:00.000Z","source":"suggested"}'
    ],
    fieldGuide: [
      {
        name: "taskId",
        type: "string",
        required: true,
        description: "Linked task id."
      },
      {
        name: "projectId",
        type: "string|null",
        required: false,
        description: "Optional parent project id.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "title",
        type: "string",
        required: true,
        description: "Timebox title shown on the calendar."
      },
      {
        name: "startsAt",
        type: "ISO datetime",
        required: true,
        description: "Start instant in ISO-8601 form."
      },
      {
        name: "endsAt",
        type: "ISO datetime",
        required: true,
        description: "End instant in ISO-8601 form."
      },
      {
        name: "source",
        type: "manual|suggested|live_run",
        required: false,
        description: "How the timebox was created.",
        enumValues: ["manual", "suggested", "live_run"],
        defaultValue: "manual"
      },
      {
        name: "status",
        type: "planned|active|completed|cancelled",
        required: false,
        description: "Current timebox state.",
        enumValues: ["planned", "active", "completed", "cancelled"],
        defaultValue: "planned"
      },
      {
        name: "overrideReason",
        type: "string|null",
        required: false,
        description:
          "Audited reason when the slot overrides a blocked context.",
        defaultValue: null,
        nullable: true
      }
    ]
  },
  {
    entityType: "habit",
    purpose:
      "A recurring commitment or recurring slip with explicit cadence, graph links, and XP consequences.",
    minimumCreateFields: ["title"],
    relationshipRules: [
      "Habits can link directly to goals, projects, tasks, values, patterns, behaviors, beliefs, modes, and trigger reports.",
      "Habits are recurring records, not task variants, and they participate in search, notes, delete/restore, and XP.",
      "linkedBehaviorId remains a compatibility alias; linkedBehaviorIds is the canonical array form."
    ],
    searchHints: [
      "Search by title before creating a duplicate habit.",
      "Use linkedTo when the habit should already be attached to a goal, project, task, or Psyche entity."
    ],
    examples: [
      '{"title":"Morning training","frequency":"daily","polarity":"positive","linkedGoalIds":["goal_train_body"],"linkedValueIds":["value_steadiness"],"linkedBehaviorIds":["behavior_regulating_walk"]}'
    ],
    fieldGuide: [
      {
        name: "title",
        type: "string",
        required: true,
        description: "Concrete recurring behavior label."
      },
      {
        name: "description",
        type: "string",
        required: false,
        description:
          "Markdown definition of what counts as success or failure for this habit.",
        defaultValue: ""
      },
      {
        name: "status",
        type: "active|paused|archived",
        required: false,
        description: "Lifecycle state.",
        enumValues: ["active", "paused", "archived"],
        defaultValue: "active"
      },
      {
        name: "polarity",
        type: "positive|negative",
        required: false,
        description: "Whether doing the behavior is aligned or misaligned.",
        enumValues: ["positive", "negative"],
        defaultValue: "positive"
      },
      {
        name: "frequency",
        type: "daily|weekly",
        required: false,
        description: "Recurrence cadence.",
        enumValues: ["daily", "weekly"],
        defaultValue: "daily"
      },
      {
        name: "targetCount",
        type: "integer",
        required: false,
        description: "How many repetitions define the cadence window.",
        defaultValue: 1
      },
      {
        name: "weekDays",
        type: "integer[]",
        required: false,
        description:
          "Weekday numbers for weekly habits where Monday is 1 and Sunday is 0.",
        defaultValue: []
      },
      {
        name: "linkedGoalIds",
        type: "string[]",
        required: false,
        description: "Linked goal ids.",
        defaultValue: []
      },
      {
        name: "linkedProjectIds",
        type: "string[]",
        required: false,
        description: "Linked project ids.",
        defaultValue: []
      },
      {
        name: "linkedTaskIds",
        type: "string[]",
        required: false,
        description: "Linked task ids.",
        defaultValue: []
      },
      {
        name: "linkedValueIds",
        type: "string[]",
        required: false,
        description: "Linked value ids.",
        defaultValue: []
      },
      {
        name: "linkedPatternIds",
        type: "string[]",
        required: false,
        description: "Linked pattern ids.",
        defaultValue: []
      },
      {
        name: "linkedBehaviorIds",
        type: "string[]",
        required: false,
        description: "Canonical linked behavior ids.",
        defaultValue: []
      },
      {
        name: "linkedBehaviorId",
        type: "string|null",
        required: false,
        description: "Compatibility alias for the first linked behavior id.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "linkedBeliefIds",
        type: "string[]",
        required: false,
        description: "Linked belief ids.",
        defaultValue: []
      },
      {
        name: "linkedModeIds",
        type: "string[]",
        required: false,
        description: "Linked mode ids.",
        defaultValue: []
      },
      {
        name: "linkedReportIds",
        type: "string[]",
        required: false,
        description: "Linked trigger report ids.",
        defaultValue: []
      },
      {
        name: "rewardXp",
        type: "integer",
        required: false,
        description: "XP granted on aligned check-ins.",
        defaultValue: 12
      },
      {
        name: "penaltyXp",
        type: "integer",
        required: false,
        description: "XP removed on misaligned check-ins.",
        defaultValue: 8
      }
    ]
  },
  {
    entityType: "note",
    purpose:
      "A first-class Markdown note entity that can link to one or many Forge entities.",
    minimumCreateFields: ["contentMarkdown", "links"],
    relationshipRules: [
      "Notes can link to goals, projects, tasks, Psyche records, and other supported Forge entities.",
      "When nested under another create flow, notes auto-link to that new entity and can optionally include extra links.",
      "Agents can also create standalone notes directly through forge_create_entities with entityType note."
    ],
    searchHints: [
      "Search by Markdown content, author, or linked entity before creating a duplicate note."
    ],
    examples: [
      '{"contentMarkdown":"Finished the review pass and captured the remaining edge cases.","links":[{"entityType":"task","entityId":"task_123"}]}',
      '{"contentMarkdown":"Observed a stronger protector response after the meeting.","author":"forge-agent","tags":["Short-term memory","therapy"],"links":[{"entityType":"trigger_report","entityId":"report_123"},{"entityType":"behavior_pattern","entityId":"pattern_123"}]}',
      '{"contentMarkdown":"Scratch capture for what I am actively holding in mind.","tags":["Working memory","handoff"],"destroyAt":"2026-04-04T12:00:00.000Z","links":[{"entityType":"task","entityId":"task_123"}]}'
    ],
    fieldGuide: [
      {
        name: "contentMarkdown",
        type: "string",
        required: true,
        description: "Markdown body of the note."
      },
      {
        name: "author",
        type: "string|null",
        required: false,
        description: "Optional display author for the note.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "tags",
        type: "string[]",
        required: false,
        description:
          "Optional note-owned tags such as Working memory, Short-term memory, Episodic memory, Semantic memory, Procedural memory, or custom labels.",
        defaultValue: []
      },
      {
        name: "destroyAt",
        type: "ISO datetime|null",
        required: false,
        description:
          "Optional auto-destroy timestamp. If set, Forge deletes the note after that time as ephemeral memory.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "links",
        type: "Array<{ entityType, entityId, anchorKey? }>",
        required: true,
        description: "Entities this note should link to."
      }
    ]
  },
  {
    entityType: "insight",
    purpose:
      "An agent-authored observation or recommendation grounded in Forge data.",
    minimumCreateFields: ["title", "summary", "recommendation"],
    relationshipRules: [
      "Insights can optionally point at one entity through entityType and entityId.",
      "Use insights for interpretation or advice, not as a replacement for goals, tasks, or trigger reports."
    ],
    searchHints: [
      "Search recent insights before posting a new one if the same pattern may already be captured."
    ],
    examples: [
      '{"entityType":"goal","entityId":"goal_create_meaningfully","title":"Admin drag is masking momentum","summary":"Creative progress is happening, but admin cleanup keeps interrupting it.","recommendation":"Protect one clean creative block and isolate admin into a separate recurring task."}'
    ],
    fieldGuide: [
      {
        name: "entityType",
        type: "string|null",
        required: false,
        description: "Optional linked entity type.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "entityId",
        type: "string|null",
        required: false,
        description: "Optional linked entity id.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "timeframeLabel",
        type: "string|null",
        required: false,
        description: "Optional time window label.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "title",
        type: "string",
        required: true,
        description: "Insight title."
      },
      {
        name: "summary",
        type: "string",
        required: true,
        description: "Short explanation of the pattern or tension."
      },
      {
        name: "recommendation",
        type: "string",
        required: true,
        description: "Actionable next move or reframing."
      },
      {
        name: "rationale",
        type: "string",
        required: false,
        description: "Why this insight is grounded in the data.",
        defaultValue: ""
      },
      {
        name: "confidence",
        type: "number",
        required: false,
        description: "Confidence from 0 to 1.",
        defaultValue: 0.7
      },
      {
        name: "visibility",
        type: "string",
        required: false,
        description: "Visibility mode for the insight.",
        defaultValue: "visible"
      },
      {
        name: "ctaLabel",
        type: "string",
        required: false,
        description: "CTA shown in the UI.",
        defaultValue: "Review insight"
      }
    ]
  },
  {
    entityType: "event_type",
    purpose:
      "A reusable event taxonomy label for trigger reports, such as criticism, conflict, rupture, or overload.",
    minimumCreateFields: ["label"],
    relationshipRules: [
      "Trigger reports can reference one event type through eventTypeId.",
      "Use event types to normalize repeated report categories instead of inventing new wording every time."
    ],
    searchHints: [
      "Search by label before creating a new event type.",
      "Prefer existing event types when one clearly fits the situation."
    ],
    fieldGuide: [
      {
        name: "label",
        type: "string",
        required: true,
        description: "Human-readable event type label."
      },
      {
        name: "description",
        type: "string",
        required: false,
        description: "What kind of incident this event type represents.",
        defaultValue: ""
      }
    ]
  },
  {
    entityType: "emotion_definition",
    purpose:
      "A reusable emotion vocabulary item for trigger reports, such as shame, anger, grief, or relief.",
    minimumCreateFields: ["label"],
    relationshipRules: [
      "Trigger report emotions can reference an emotion definition through emotionDefinitionId.",
      "Use emotion definitions to normalize repeated emotional labels across reports."
    ],
    searchHints: [
      "Search by label before creating a new emotion definition.",
      "Prefer an existing emotion definition when the label already captures the feeling well."
    ],
    fieldGuide: [
      {
        name: "label",
        type: "string",
        required: true,
        description: "Emotion label."
      },
      {
        name: "description",
        type: "string",
        required: false,
        description: "What this emotion label is meant to capture.",
        defaultValue: ""
      },
      {
        name: "category",
        type: "string",
        required: false,
        description:
          "Optional grouping such as threat, grief, anger, or connection.",
        defaultValue: ""
      }
    ]
  },
  {
    entityType: "psyche_value",
    purpose: "An ACT-style value or direction the user wants to orient toward.",
    minimumCreateFields: ["title"],
    relationshipRules: [
      "Values can link to goals, projects, and tasks.",
      "Patterns, behaviors, beliefs, and reports can all point back to values."
    ],
    searchHints: [
      "Search by title before creating a new value.",
      "Use linkedTo if the value should already be attached to a goal or task."
    ],
    examples: [
      '{"title":"Steadiness","valuedDirection":"Respond calmly instead of collapsing or reacting fast.","whyItMatters":"I want to stay grounded in relationships and work."}'
    ],
    fieldGuide: [
      {
        name: "title",
        type: "string",
        required: true,
        description: "Value name."
      },
      {
        name: "description",
        type: "string",
        required: false,
        description: "What the value means in practice.",
        defaultValue: ""
      },
      {
        name: "valuedDirection",
        type: "string",
        required: false,
        description:
          "How the user wants to live or act when guided by this value.",
        defaultValue: ""
      },
      {
        name: "whyItMatters",
        type: "string",
        required: false,
        description: "Why the value matters to the user.",
        defaultValue: ""
      },
      {
        name: "linkedGoalIds",
        type: "string[]",
        required: false,
        description: "Linked goal ids.",
        defaultValue: []
      },
      {
        name: "linkedProjectIds",
        type: "string[]",
        required: false,
        description: "Linked project ids.",
        defaultValue: []
      },
      {
        name: "linkedTaskIds",
        type: "string[]",
        required: false,
        description: "Linked task ids.",
        defaultValue: []
      },
      {
        name: "committedActions",
        type: "string[]",
        required: false,
        description: "Small concrete actions that enact the value.",
        defaultValue: []
      }
    ]
  },
  {
    entityType: "behavior_pattern",
    purpose: "A recurring loop or trigger-response pattern.",
    minimumCreateFields: ["title"],
    relationshipRules: [
      "Patterns can link to values, beliefs, and modes.",
      "Trigger reports can link back to patterns they instantiate."
    ],
    searchHints: [
      "Search by title or by trigger language before creating a new pattern."
    ],
    examples: [
      '{"title":"Late-night father text freeze","cueContexts":["Father texts late at night"],"targetBehavior":"Freeze, avoid replying, and doomscroll","shortTermPayoff":"Avoids immediate overwhelm","longTermCost":"Sleep loss, guilt, and dread","preferredResponse":"Pause, regulate, and reply on my own terms the next morning"}'
    ],
    fieldGuide: [
      {
        name: "title",
        type: "string",
        required: true,
        description: "Short pattern name."
      },
      {
        name: "description",
        type: "string",
        required: false,
        description: "What usually happens in this loop.",
        defaultValue: ""
      },
      {
        name: "targetBehavior",
        type: "string",
        required: false,
        description: "The visible behavior this pattern tends to produce.",
        defaultValue: ""
      },
      {
        name: "cueContexts",
        type: "string[]",
        required: false,
        description: "Typical cues, contexts, or triggers.",
        defaultValue: []
      },
      {
        name: "shortTermPayoff",
        type: "string",
        required: false,
        description: "What the loop gives immediately.",
        defaultValue: ""
      },
      {
        name: "longTermCost",
        type: "string",
        required: false,
        description: "What the loop costs later.",
        defaultValue: ""
      },
      {
        name: "preferredResponse",
        type: "string",
        required: false,
        description: "Preferred alternative response.",
        defaultValue: ""
      },
      {
        name: "linkedValueIds",
        type: "string[]",
        required: false,
        description: "Linked value ids.",
        defaultValue: []
      },
      {
        name: "linkedSchemaLabels",
        type: "string[]",
        required: false,
        description: "Schema labels involved in the pattern.",
        defaultValue: []
      },
      {
        name: "linkedModeLabels",
        type: "string[]",
        required: false,
        description: "Mode labels involved in the pattern.",
        defaultValue: []
      },
      {
        name: "linkedModeIds",
        type: "string[]",
        required: false,
        description: "Linked mode ids.",
        defaultValue: []
      },
      {
        name: "linkedBeliefIds",
        type: "string[]",
        required: false,
        description: "Linked belief ids.",
        defaultValue: []
      }
    ]
  },
  {
    entityType: "behavior",
    purpose:
      "A concrete behavior pattern element or habit worth tracking directly.",
    minimumCreateFields: ["kind", "title"],
    relationshipRules: [
      "Behaviors can connect to behavior patterns, values, schemas, and modes.",
      "Trigger reports can link to behaviors they contained."
    ],
    searchHints: ["Search by title and kind before creating a new behavior."],
    examples: [
      '{"kind":"away","title":"Doomscroll after conflict cue","commonCues":["Received a critical text"],"shortTermPayoff":"Numbs the anxiety","longTermCost":"Loses time and deepens shame","replacementMove":"Put phone down and take one slow lap outside"}'
    ],
    fieldGuide: [
      {
        name: "kind",
        type: "away|committed|recovery",
        required: true,
        description:
          "Whether the behavior moves away from values, toward them, or repairs after rupture.",
        enumValues: ["away", "committed", "recovery"]
      },
      {
        name: "title",
        type: "string",
        required: true,
        description: "Behavior label."
      },
      {
        name: "description",
        type: "string",
        required: false,
        description: "What the behavior looks like.",
        defaultValue: ""
      },
      {
        name: "commonCues",
        type: "string[]",
        required: false,
        description: "Typical cues for this behavior.",
        defaultValue: []
      },
      {
        name: "urgeStory",
        type: "string",
        required: false,
        description: "What the inner urge or story feels like.",
        defaultValue: ""
      },
      {
        name: "shortTermPayoff",
        type: "string",
        required: false,
        description: "Immediate payoff.",
        defaultValue: ""
      },
      {
        name: "longTermCost",
        type: "string",
        required: false,
        description: "Longer-term cost.",
        defaultValue: ""
      },
      {
        name: "replacementMove",
        type: "string",
        required: false,
        description: "Preferred replacement move.",
        defaultValue: ""
      },
      {
        name: "repairPlan",
        type: "string",
        required: false,
        description: "Repair plan after the behavior occurs.",
        defaultValue: ""
      },
      {
        name: "linkedPatternIds",
        type: "string[]",
        required: false,
        description: "Linked behavior pattern ids.",
        defaultValue: []
      },
      {
        name: "linkedValueIds",
        type: "string[]",
        required: false,
        description: "Linked value ids.",
        defaultValue: []
      },
      {
        name: "linkedSchemaIds",
        type: "string[]",
        required: false,
        description: "Linked schema ids.",
        defaultValue: []
      },
      {
        name: "linkedModeIds",
        type: "string[]",
        required: false,
        description: "Linked mode ids.",
        defaultValue: []
      }
    ]
  },
  {
    entityType: "belief_entry",
    purpose: "A belief or schema-linked statement worth tracking and testing.",
    minimumCreateFields: ["statement", "beliefType"],
    relationshipRules: [
      "Beliefs can link to values, behaviors, modes, and trigger reports.",
      "Behavior patterns can point to beliefs that keep the loop alive."
    ],
    searchHints: [
      "Search by statement or known schema theme before creating a new belief entry."
    ],
    examples: [
      '{"statement":"If I disappoint people, they will leave me.","beliefType":"conditional","confidence":82,"evidenceFor":["People got cold when I failed them before"],"evidenceAgainst":["Some people stayed with me even after conflict"],"flexibleAlternative":"Disappointing someone can strain a relationship, but it does not automatically mean abandonment."}'
    ],
    fieldGuide: [
      {
        name: "schemaId",
        type: "string|null",
        required: false,
        description: "Optional linked schema catalog id.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "statement",
        type: "string",
        required: true,
        description: "Belief statement in the user's own words."
      },
      {
        name: "beliefType",
        type: "absolute|conditional",
        required: true,
        description: "Whether the belief is absolute or if-then shaped.",
        enumValues: ["absolute", "conditional"]
      },
      {
        name: "originNote",
        type: "string",
        required: false,
        description: "Where the belief seems to come from.",
        defaultValue: ""
      },
      {
        name: "confidence",
        type: "integer",
        required: false,
        description: "How strongly the belief feels true from 0 to 100.",
        defaultValue: 60
      },
      {
        name: "evidenceFor",
        type: "string[]",
        required: false,
        description: "Evidence that seems to support the belief.",
        defaultValue: []
      },
      {
        name: "evidenceAgainst",
        type: "string[]",
        required: false,
        description: "Evidence that weakens the belief.",
        defaultValue: []
      },
      {
        name: "flexibleAlternative",
        type: "string",
        required: false,
        description: "More flexible alternative belief.",
        defaultValue: ""
      },
      {
        name: "linkedValueIds",
        type: "string[]",
        required: false,
        description: "Linked value ids.",
        defaultValue: []
      },
      {
        name: "linkedBehaviorIds",
        type: "string[]",
        required: false,
        description: "Linked behavior ids.",
        defaultValue: []
      },
      {
        name: "linkedModeIds",
        type: "string[]",
        required: false,
        description: "Linked mode ids.",
        defaultValue: []
      },
      {
        name: "linkedReportIds",
        type: "string[]",
        required: false,
        description: "Linked trigger report ids.",
        defaultValue: []
      }
    ]
  },
  {
    entityType: "mode_profile",
    purpose:
      "A schema-mode profile such as critic, child, coping, or healthy adult parts.",
    minimumCreateFields: ["family", "title"],
    relationshipRules: [
      "Modes can link to patterns, behaviors, and values.",
      "Trigger reports can include linkedModeIds and modeOverlays that reference modes."
    ],
    searchHints: [
      "Search by title or family before creating a new mode profile."
    ],
    examples: [
      '{"family":"coping","title":"Cold controller","fear":"If I soften, I will be humiliated or lose control.","protectiveJob":"Stay hyper-competent and unreachable when threatened."}'
    ],
    fieldGuide: [
      {
        name: "family",
        type: "coping|child|critic_parent|healthy_adult|happy_child",
        required: true,
        description: "Mode family.",
        enumValues: [
          "coping",
          "child",
          "critic_parent",
          "healthy_adult",
          "happy_child"
        ]
      },
      {
        name: "title",
        type: "string",
        required: true,
        description: "Mode title."
      },
      {
        name: "archetype",
        type: "string",
        required: false,
        description: "Optional archetype label.",
        defaultValue: ""
      },
      {
        name: "persona",
        type: "string",
        required: false,
        description: "Narrative or felt sense of the mode.",
        defaultValue: ""
      },
      {
        name: "imagery",
        type: "string",
        required: false,
        description: "Imagery associated with the mode.",
        defaultValue: ""
      },
      {
        name: "symbolicForm",
        type: "string",
        required: false,
        description: "Symbolic form or metaphor.",
        defaultValue: ""
      },
      {
        name: "facialExpression",
        type: "string",
        required: false,
        description: "Typical facial expression or posture.",
        defaultValue: ""
      },
      {
        name: "fear",
        type: "string",
        required: false,
        description: "Core fear carried by the mode.",
        defaultValue: ""
      },
      {
        name: "burden",
        type: "string",
        required: false,
        description: "Burden or pain the mode carries.",
        defaultValue: ""
      },
      {
        name: "protectiveJob",
        type: "string",
        required: false,
        description: "What job the mode thinks it is doing.",
        defaultValue: ""
      },
      {
        name: "originContext",
        type: "string",
        required: false,
        description: "Where the mode seems to come from.",
        defaultValue: ""
      },
      {
        name: "firstAppearanceAt",
        type: "string|null",
        required: false,
        description: "Optional first-seen marker.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "linkedPatternIds",
        type: "string[]",
        required: false,
        description: "Linked pattern ids.",
        defaultValue: []
      },
      {
        name: "linkedBehaviorIds",
        type: "string[]",
        required: false,
        description: "Linked behavior ids.",
        defaultValue: []
      },
      {
        name: "linkedValueIds",
        type: "string[]",
        required: false,
        description: "Linked value ids.",
        defaultValue: []
      }
    ]
  },
  {
    entityType: "mode_guide_session",
    purpose:
      "A guided mode-mapping session that stores structured answers and candidate mode interpretations.",
    minimumCreateFields: ["summary", "answers"],
    relationshipRules: [
      "Mode guide sessions help the user reason toward likely modes before or alongside mode profiles.",
      "Use mode guide sessions for guided interpretation, not as a replacement for durable mode profiles."
    ],
    searchHints: [
      "Search by summary when revisiting a prior guided mode session."
    ],
    examples: [
      '{"summary":"Mapping the part that takes over under criticism","answers":[{"questionKey":"felt_shift","value":"I go cold and rigid"}],"results":[{"family":"coping","archetype":"detached_protector","label":"Cold controller","confidence":0.74,"reasoning":"It distances from shame and tries to stay untouchable."}]}'
    ],
    fieldGuide: [
      {
        name: "summary",
        type: "string",
        required: true,
        description: "Short summary of what the guided session explored."
      },
      {
        name: "answers",
        type: "array",
        required: true,
        description:
          "List of { questionKey, value } items capturing the user's guided answers."
      },
      {
        name: "results",
        type: "array",
        required: false,
        description:
          "List of { family, archetype, label, confidence 0-1, reasoning } candidate mode interpretations."
      }
    ]
  },
  {
    entityType: "trigger_report",
    purpose:
      "A structured reflective incident report that ties situation, emotions, thoughts, behaviors, consequences, and next moves together.",
    minimumCreateFields: ["title"],
    relationshipRules: [
      "Trigger reports can link to values, goals, projects, tasks, patterns, behaviors, beliefs, and modes.",
      "A report is the best container for one specific emotionally meaningful episode.",
      "Use reports when you need one event chain, not just a generic pattern."
    ],
    searchHints: [
      "Search by title, event wording, or linked entities before creating a duplicate report."
    ],
    examples: [
      '{"title":"Partner said we need to talk and I spiraled","customEventType":"relationship threat","eventSituation":"My partner texted that we needed to talk tonight.","emotions":[{"label":"fear","intensity":85},{"label":"shame","intensity":60}],"thoughts":[{"text":"This means I messed everything up."}],"behaviors":[{"text":"Paced, catastrophized, and checked my phone repeatedly"}],"nextMoves":["Wait until we speak before predicting the outcome","Write down the facts I actually know"]}'
    ],
    fieldGuide: [
      {
        name: "title",
        type: "string",
        required: true,
        description: "Short name for the incident."
      },
      {
        name: "status",
        type: "draft|reviewed|integrated",
        required: false,
        description: "Reflection progress state.",
        enumValues: ["draft", "reviewed", "integrated"],
        defaultValue: "draft"
      },
      {
        name: "eventTypeId",
        type: "string|null",
        required: false,
        description: "Known event type id if already cataloged.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "customEventType",
        type: "string",
        required: false,
        description: "Free-text event type when no existing type fits.",
        defaultValue: ""
      },
      {
        name: "eventSituation",
        type: "string",
        required: false,
        description: "What happened in the situation.",
        defaultValue: ""
      },
      {
        name: "occurredAt",
        type: "string|null",
        required: false,
        description: "When it happened.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "emotions",
        type: "array",
        required: false,
        description:
          "List of { emotionDefinitionId|null, label, intensity 0-100, note } items.",
        defaultValue: []
      },
      {
        name: "thoughts",
        type: "array",
        required: false,
        description:
          "List of { text, parentMode, criticMode, beliefId|null } items.",
        defaultValue: []
      },
      {
        name: "behaviors",
        type: "array",
        required: false,
        description: "List of { text, mode, behaviorId|null } items.",
        defaultValue: []
      },
      {
        name: "consequences",
        type: "object",
        required: false,
        description:
          "Object with selfShortTerm, selfLongTerm, othersShortTerm, othersLongTerm string arrays."
      },
      {
        name: "linkedPatternIds",
        type: "string[]",
        required: false,
        description: "Linked pattern ids.",
        defaultValue: []
      },
      {
        name: "linkedValueIds",
        type: "string[]",
        required: false,
        description: "Linked value ids.",
        defaultValue: []
      },
      {
        name: "linkedGoalIds",
        type: "string[]",
        required: false,
        description: "Linked goal ids.",
        defaultValue: []
      },
      {
        name: "linkedProjectIds",
        type: "string[]",
        required: false,
        description: "Linked project ids.",
        defaultValue: []
      },
      {
        name: "linkedTaskIds",
        type: "string[]",
        required: false,
        description: "Linked task ids.",
        defaultValue: []
      },
      {
        name: "linkedBehaviorIds",
        type: "string[]",
        required: false,
        description: "Linked behavior ids.",
        defaultValue: []
      },
      {
        name: "linkedBeliefIds",
        type: "string[]",
        required: false,
        description: "Linked belief ids.",
        defaultValue: []
      },
      {
        name: "linkedModeIds",
        type: "string[]",
        required: false,
        description: "Linked mode ids.",
        defaultValue: []
      },
      {
        name: "modeOverlays",
        type: "string[]",
        required: false,
        description: "Extra mode labels noticed during the incident.",
        defaultValue: []
      },
      {
        name: "schemaLinks",
        type: "string[]",
        required: false,
        description:
          "Schema names or themes that seem related to the incident.",
        defaultValue: []
      },
      {
        name: "modeTimeline",
        type: "array",
        required: false,
        description:
          "List of { stage, modeId|null, label, note } items describing the sequence of modes.",
        defaultValue: []
      },
      {
        name: "nextMoves",
        type: "string[]",
        required: false,
        description: "Concrete next steps or repair moves.",
        defaultValue: []
      }
    ]
  }
] as const;

const AGENT_ONBOARDING_CONVERSATION_RULES = [
  "Ask only for what is missing or unclear instead of walking the user through every optional field.",
  "Use a progression of concrete example or intent, working name, purpose or meaning, placement in Forge, operational details, and linked context.",
  "Ask one to three focused questions at a time. One is usually best when the user is uncertain or emotionally loaded.",
  "Before saving, briefly summarize the working formulation in the user's own language when that would reduce ambiguity.",
  "When updating an entity, start with what is changing, what should stay true, and what prompted the update now."
] as const;

const AGENT_ONBOARDING_ENTITY_CONVERSATION_PLAYBOOKS = [
  {
    focus: "goal",
    openingQuestion: "What direction are you trying to hold onto here?",
    coachingGoal:
      "Clarify the direction and why it matters, not just produce a title.",
    askSequence: [
      "Ask what direction or outcome the user wants to keep in view.",
      "Ask why it matters now.",
      "Distinguish the goal from a project or task.",
      "Clarify horizon and status only after the meaning is clear."
    ]
  },
  {
    focus: "project",
    openingQuestion:
      "If this becomes a project, what would you want it to be called and what should it accomplish?",
    coachingGoal:
      "Turn an intention into a bounded workstream with a clear outcome.",
    askSequence: [
      "Ask what this piece of work should be called.",
      "Ask what outcome would make the project feel real or complete for now.",
      "Ask which goal it belongs under.",
      "Clarify status, owner, and notes only after the scope is clear."
    ]
  },
  {
    focus: "strategy",
    openingQuestion:
      "What future state is this strategy supposed to make real?",
    coachingGoal:
      "Turn a vague plan into a deliberate sequence toward a real end state.",
    askSequence: [
      "Ask what end state the strategy is trying to land.",
      "Ask which goals or projects are the true targets.",
      "Ask what the major steps or nodes are.",
      "Ask about order, dependencies, and anything that must not be skipped."
    ]
  },
  {
    focus: "task",
    openingQuestion:
      "What is the next concrete move you want to remember or do?",
    coachingGoal:
      "Identify the next concrete move, not just capture a vague obligation.",
    askSequence: [
      "Ask what the next concrete action is.",
      "Ask where it belongs: project, goal, both, or standalone.",
      "Ask what would make it easier to do: due date, priority, owner, or brief context."
    ]
  },
  {
    focus: "habit",
    openingQuestion:
      "What is the recurring behavior you want Forge to keep track of?",
    coachingGoal:
      "Define the recurring behavior and cadence clearly enough for honest later check-ins.",
    askSequence: [
      "Ask what the recurring behavior is in plain language.",
      "Ask whether doing it is aligned or a slip.",
      "Ask about cadence and what counts as success in practice.",
      "Ask about links only if they will help later review."
    ]
  },
  {
    focus: "note",
    openingQuestion:
      "What do you want this note to preserve, and what should it stay attached to?",
    coachingGoal:
      "Preserve the useful context and link it to the right places without turning the note into a dump.",
    askSequence: [
      "Ask what the note needs to preserve.",
      "Ask what entities it should stay attached to.",
      "Ask whether it should be durable or temporary.",
      "Ask about tags or author only if they help retrieval or handoff."
    ]
  },
  {
    focus: "insight",
    openingQuestion:
      "What observation or recommendation do you want Forge to remember?",
    coachingGoal:
      "Capture one grounded observation or recommendation clearly enough that it remains useful later.",
    askSequence: [
      "Ask what pattern, tension, or observation should be remembered.",
      "Ask what entity or timeframe it belongs to, if any.",
      "Ask what recommendation, caution, or invitation should remain explicit."
    ]
  },
  {
    focus: "calendar_event",
    openingQuestion:
      "What is the event, and when should it happen in your local time?",
    coachingGoal:
      "Make the event legible as a real commitment in time, with the right timezone and links.",
    askSequence: [
      "Ask what the event is.",
      "Ask when it starts and ends in local time.",
      "Ask where it belongs or what it supports.",
      "Ask whether it should stay Forge-only only if that choice matters."
    ]
  },
  {
    focus: "work_block_template",
    openingQuestion:
      "What recurring block do you want to set up, and when should it repeat?",
    coachingGoal:
      "Define a reusable availability rule rather than a one-off event.",
    askSequence: [
      "Ask what kind of block it is and what it should be called.",
      "Ask on which days and at what local times it should repeat.",
      "Ask whether it allows or blocks work.",
      "Ask whether it has a start or end date."
    ]
  },
  {
    focus: "task_timebox",
    openingQuestion:
      "Which task are you trying to make time for, and when should the slot be?",
    coachingGoal:
      "Reserve real time for one task without confusing planned work with completed work.",
    askSequence: [
      "Ask which task the slot belongs to.",
      "Ask when the slot should start and end.",
      "Ask about source or override reason only when that context matters."
    ]
  },
  {
    focus: "event_type",
    openingQuestion: "What kind of incident should this category stand for?",
    coachingGoal:
      "Create a reusable incident category that will actually help future reports stay consistent.",
    askSequence: [
      "Ask what category the label should capture.",
      "Ask how narrow or broad it should be.",
      "Ask for a short description only if the label could be ambiguous later."
    ]
  },
  {
    focus: "emotion_definition",
    openingQuestion:
      "What emotion label do you want to keep reusable in Forge?",
    coachingGoal:
      "Create a reusable emotion label with enough clarity to use consistently later.",
    askSequence: [
      "Ask what emotion label the user wants to preserve.",
      "Ask what distinguishes it from nearby emotions.",
      "Ask for a broader category only if it will help later browsing or reporting."
    ]
  }
] as const;

const AGENT_ONBOARDING_PSYCHE_PLAYBOOKS = [
  {
    focus: "psyche_value",
    useWhen:
      "Use for a lived direction, quality of being, or way of showing up that matters to the user and should guide actions rather than just describe an outcome.",
    coachingGoal:
      "Clarify the value as a chosen direction, distinguish it from a goal, and gather one concrete way the user wants to embody it now.",
    askSequence: [
      "Start with what matters and why it matters now.",
      "Ask for one concrete example of what living this value would look like in ordinary life.",
      "Separate the value direction from any specific outcome or achievement goal.",
      "Notice tensions, barriers, or situations where the value gets lost.",
      "Name one small committed action that would move toward the value."
    ],
    requiredForCreate: ["title"],
    highValueOptionalFields: [
      "description",
      "valuedDirection",
      "whyItMatters",
      "committedActions",
      "linkedGoalIds",
      "linkedProjectIds",
      "linkedTaskIds"
    ],
    exampleQuestions: [
      "What feels deeply important about this to you?",
      "If you were living this value a little more this week, what would someone be able to see?",
      "What goal or area of life does this value belong to most clearly?",
      "When this value is hard to live, what tends to get in the way?",
      "What is one small action that would express it in practice?"
    ],
    notes: [
      "Use an ACT-style values clarification stance: values are directions to live toward, not boxes to complete.",
      "Ask one or two questions at a time, reflect back the user's language, and only then move toward naming committed actions or linked work items.",
      "If the user says they want to understand it first, start with one orienting question before offering a formulation or save suggestion."
    ]
  },
  {
    focus: "behavior_pattern",
    useWhen:
      "Use for a recurring loop that shows up across multiple situations and can be described as cue -> response -> payoff -> cost -> preferred response.",
    coachingGoal:
      "Help the user build a CBT-style functional analysis with active listening instead of just naming the problem vaguely.",
    askSequence: [
      "Start from one recent concrete example before generalizing the loop.",
      "Identify the typical cue, vulnerability, or context that makes the loop more likely.",
      "Reflect back the sequence of thoughts, feelings, body state, and visible behavior once it starts.",
      "Clarify the short-term payoff, protection, or escape function.",
      "Clarify the long-term cost to the self, relationships, work, or values.",
      "Ask what a slightly more workable response would look like.",
      "Notice adjacent beliefs, schema themes, modes, or values that should be linked or saved separately."
    ],
    requiredForCreate: ["title"],
    highValueOptionalFields: [
      "description",
      "targetBehavior",
      "cueContexts",
      "shortTermPayoff",
      "longTermCost",
      "preferredResponse",
      "linkedBeliefIds",
      "linkedModeIds",
      "linkedValueIds"
    ],
    exampleQuestions: [
      "Can we slow this down using one recent example first?",
      "What usually sets this loop off, and what was going on just before it started?",
      "What do you notice in your thoughts, body, and actions once it gets going?",
      "What does that move do for you immediately?",
      "What does it cost you later?",
      "What belief, rule, or vulnerable part seems to get activated inside this loop?",
      "If this loop loosened a little, what response would you want to make instead?"
    ],
    notes: [
      "A pattern is usually the best Psyche container for functional analysis.",
      "If the user is describing one specific episode rather than a repeated loop, prefer a trigger report.",
      "Reflect before the next question, and avoid interrogating through the schema fields in order.",
      "If the user asks to understand the loop first, do not lead with a finished working diagnosis or title before asking at least one clarifying question."
    ]
  },
  {
    focus: "behavior",
    useWhen:
      "Use for one recurring move, coping action, or regulating action that the user wants to understand more clearly and possibly link to a broader pattern.",
    coachingGoal:
      "Describe the behavior in plain language, understand its function, classify whether it moves away, toward, or back into repair, and identify a more workable move when relevant.",
    askSequence: [
      "Start with a recent example of the behavior in context.",
      "Name what the user actually does or tends to do.",
      "Clarify what cues, urges, or situations pull the behavior online.",
      "Clarify the short-term payoff or relief.",
      "Clarify the long-term cost or price.",
      "Decide whether the behavior is away, committed, or recovery.",
      "Identify a replacement move or repair plan if the user wants one."
    ],
    requiredForCreate: ["kind", "title"],
    highValueOptionalFields: [
      "description",
      "commonCues",
      "urgeStory",
      "shortTermPayoff",
      "longTermCost",
      "replacementMove",
      "repairPlan",
      "linkedPatternIds",
      "linkedValueIds",
      "linkedSchemaIds",
      "linkedModeIds"
    ],
    exampleQuestions: [
      "What does this behavior actually look like when it happens?",
      "What usually pulls you toward it?",
      "What does it do for you in the moment?",
      "What cost shows up later?",
      "Would you call this an away move, a committed move, or a recovery move?",
      "If you wanted another option available, what would it be?"
    ],
    notes: [
      "Keep the user close to observable behavior rather than jumping straight to labels.",
      "When the behavior clearly belongs inside a larger loop, suggest linking or also mapping the related behavior_pattern.",
      "If the user asks for understanding before storage, ask about the recent example and function of the move before classifying it."
    ]
  },
  {
    focus: "belief_entry",
    useWhen:
      "Use for a belief, rule, or self-statement that keeps showing up in reactions, especially when the user can phrase it as a sentence.",
    coachingGoal:
      "Turn implicit self-talk or a likely schema theme into one explicit belief statement that can be tested and linked to patterns, reports, and modes without forcing the user into a debate too early.",
    askSequence: [
      "Reflect the likely belief in the user's own words and ask for confirmation or correction.",
      "Decide whether it is absolute or conditional.",
      "Estimate how true it feels from 0 to 100.",
      "Collect evidence for and evidence against.",
      "Notice where the belief may have been learned or reinforced.",
      "Offer a more flexible alternative belief.",
      "Link a schemaId only when a real schema catalog match is known."
    ],
    requiredForCreate: ["statement", "beliefType"],
    highValueOptionalFields: [
      "schemaId",
      "confidence",
      "originNote",
      "evidenceFor",
      "evidenceAgainst",
      "flexibleAlternative",
      "linkedReportIds",
      "linkedBehaviorIds",
      "linkedModeIds"
    ],
    exampleQuestions: [
      "If we turned that reaction into one sentence, what would it sound like?",
      "Is it more of an always/never belief, or an if-then rule?",
      "How true does it feel right now from 0 to 100?",
      "What seems to support it, and what weakens it?",
      "Where do you think you learned or rehearsed that rule?",
      "What would a more flexible alternative sound like?"
    ],
    notes: [
      "Schema catalog entries are reference concepts; belief_entry is the user-owned record.",
      "If no schema catalog match is known, omit schemaId rather than inventing one.",
      "Do not argue the user out of the belief. Reflect it, understand its function, and then collaboratively test for flexibility."
    ]
  },
  {
    focus: "mode_profile",
    useWhen:
      "Use when the user is describing a recurring part-state, protector, critic, vulnerable child state, or healthy adult stance.",
    coachingGoal:
      "Help the user describe how the mode shows up, what it is trying to do, what it fears, and what burden it carries, rather than reducing it to a label only.",
    askSequence: [
      "Start with a recent moment when this part-state took over.",
      "Choose the mode family once the lived description is clearer.",
      "Name the mode in the user's language.",
      "Describe the felt persona, body posture, imagery, or symbolic form.",
      "Clarify its fear, burden, and protective job.",
      "Explore when it first became necessary or familiar.",
      "Notice linked patterns, behaviors, values, and what a healthy-adult response would need to do."
    ],
    requiredForCreate: ["family", "title"],
    highValueOptionalFields: [
      "archetype",
      "persona",
      "imagery",
      "symbolicForm",
      "facialExpression",
      "fear",
      "burden",
      "protectiveJob",
      "originContext",
      "linkedPatternIds",
      "linkedBehaviorIds",
      "linkedValueIds"
    ],
    exampleQuestions: [
      "When this part shows up, what is it like from the inside?",
      "What kind of part does this feel like: coping, child, critic-parent, healthy-adult, or happy-child?",
      "If you gave this mode a name, what would it be?",
      "What is it afraid would happen if it stopped doing its job?",
      "What burden or pain does it seem to carry?",
      "When do you remember needing this way of coping or surviving?"
    ],
    notes: [
      "Mode profiles are durable parts descriptions.",
      "Mode guide sessions are the guided reasoning process that can lead toward a mode profile.",
      "Do not overpathologize. The point is to understand the part's job and cost, then increase choice.",
      "If the user asks to understand the mode first, start from a recent moment and ask what the part is trying to do before you name it."
    ]
  },
  {
    focus: "mode_guide_session",
    useWhen:
      "Use when the user is in a live reaction or is unsure which mode is active and needs a gentle structured exploration before committing to a durable mode profile.",
    coachingGoal:
      "Guide a present-moment inquiry that names the likely active mode, gathers the user's answers cleanly, and leaves a traceable bridge toward later mode work.",
    askSequence: [
      "Anchor the exploration in one current or recent situation.",
      "Ask what the part is feeling, saying, trying to stop, or trying to make happen.",
      "Ask what the part fears and what it seems to need.",
      "Reflect the answers back in plain language before suggesting any candidate mode labels.",
      "Offer one or two candidate interpretations only after enough evidence is present."
    ],
    requiredForCreate: ["summary", "answers"],
    highValueOptionalFields: [],
    exampleQuestions: [
      "What just happened that brought this up right now?",
      "If this part had a voice, what would it be saying?",
      "What is it trying to protect you from?",
      "What does it seem to need from you or from someone else?",
      "Would it be helpful if I suggest one or two possible mode labels, with reasons?"
    ],
    notes: [
      "A mode_guide_session is the exploration worksheet, not the final identity claim.",
      "Store the user's answers faithfully and keep interpretations tentative unless the user wants a durable mode_profile."
    ]
  },
  {
    focus: "trigger_report",
    useWhen:
      "Use for one specific emotionally meaningful incident that should be mapped from situation through emotions, thoughts, behaviors, consequences, and next moves.",
    coachingGoal:
      "Help the user build a clear incident chain with enough structure to learn from one episode while staying grounded and not rushing past the user's felt experience.",
    askSequence: [
      "Name the incident briefly and anchor it in one concrete sequence.",
      "Describe what happened in the situation.",
      "Capture emotions and intensity.",
      "Capture thoughts, meanings, or belief-linked interpretations.",
      "Capture behaviors and immediate coping moves.",
      "Capture short-term and long-term consequences.",
      "Identify next moves and linked patterns, beliefs, modes, values, or tasks."
    ],
    requiredForCreate: ["title"],
    highValueOptionalFields: [
      "eventTypeId",
      "customEventType",
      "eventSituation",
      "occurredAt",
      "emotions",
      "thoughts",
      "behaviors",
      "consequences",
      "modeTimeline",
      "nextMoves",
      "linkedPatternIds",
      "linkedBeliefIds",
      "linkedModeIds",
      "linkedValueIds"
    ],
    exampleQuestions: [
      "What happened, as concretely as you can say it?",
      "What emotions were there, and how intense were they?",
      "What thoughts or meanings showed up?",
      "What did you do next?",
      "What did that do for you short term, and what did it cost later?",
      "What pattern, belief, or part do you think was most active here?",
      "What would be the next good move now?"
    ],
    notes: [
      "Use eventTypeId only when a known event taxonomy item fits; otherwise use customEventType.",
      "Use emotionDefinitionId only when a known emotion definition fits; otherwise keep the raw label.",
      "If the user becomes overwhelmed, slow down, summarize, and return to one segment of the chain at a time instead of pushing for the full report in one turn."
    ]
  }
] as const;

const AGENT_ONBOARDING_TOOL_INPUT_CATALOG = [
  {
    toolName: "forge_get_user_directory",
    summary:
      "Read the live human/bot directory and directional relationship graph.",
    whenToUse:
      "Use before multi-user planning, cross-owner linking, or user-aware search so you know which humans and bots exist and what the current edge rights look like.",
    inputShape: "{}",
    requiredFields: [],
    notes: [
      "The relationship graph is directional: subject -> target describes what the subject can see or do to the target.",
      "The current default is permissive, but agents should still inspect the graph before assuming future narrower access."
    ],
    example: "{}"
  },
  {
    toolName: "forge_search_entities",
    summary: "Search Forge entities before create or update.",
    whenToUse:
      "Use when duplicate risk exists or when you need ids before mutating.",
    inputShape:
      "{ searches: Array<{ entityTypes?: CrudEntityType[], query?: string, ids?: string[], status?: string[], linkedTo?: { entityType, id }, includeDeleted?: boolean, limit?: number, clientRef?: string }> }",
    requiredFields: ["searches"],
    notes: [
      "searches is always an array, even for a single search.",
      "linkedTo is useful when looking for items under one parent entity."
    ],
    example:
      '{"searches":[{"entityTypes":["goal"],"query":"Create meaningfully","limit":10,"clientRef":"goal-search-1"}]}'
  },
  {
    toolName: "forge_create_entities",
    summary: "Create one or more entities in one ordered batch.",
    whenToUse:
      "Use after explicit save intent and after duplicate checks when needed.",
    inputShape:
      "{ atomic?: boolean, operations: Array<{ entityType: CrudEntityType, clientRef?: string, data: object }> }",
    requiredFields: [
      "operations",
      "operations[].entityType",
      "operations[].data"
    ],
    notes: [
      "entityType alone is never enough; full data is required.",
      "Batch multiple related creates together when they come from one user ask.",
      "Goal, project, and task creates can include notes: [{ contentMarkdown, author?, tags?, destroyAt?, links? }] and Forge will auto-link those notes to the newly created entity.",
      "The same batch create route also handles calendar_event, work_block_template, and task_timebox. Calendar-event creates still trigger downstream projection sync when a writable provider calendar is selected."
    ],
    example:
      '{"operations":[{"entityType":"task","data":{"title":"Write the public release notes","projectId":"project_123","status":"focus","notes":[{"contentMarkdown":"Starting from the changelog draft and the last QA pass."}]},"clientRef":"task-1"}]}'
  },
  {
    toolName: "forge_update_entities",
    summary: "Patch one or more entities in one ordered batch.",
    whenToUse:
      "Use when ids are known and the user explicitly wants a change persisted.",
    inputShape:
      "{ atomic?: boolean, operations: Array<{ entityType: CrudEntityType, id: string, clientRef?: string, patch: object }> }",
    requiredFields: [
      "operations",
      "operations[].entityType",
      "operations[].id",
      "operations[].patch"
    ],
    notes: [
      "patch is partial; only send the fields that should change.",
      "Project lifecycle is status-driven: patch project.status to active, paused, or completed instead of looking for separate suspend, restart, or finish routes.",
      "Setting project.status to completed finishes the project and auto-completes linked unfinished tasks through the normal task completion path.",
      "Task and project scheduling rules stay on these same entity patches. Update task.schedulingRules, task.plannedDurationSeconds, or project.schedulingRules here.",
      "Use this same route to move or relink calendar_event records and to edit work_block_template or task_timebox records without switching to narrower calendar CRUD tools."
    ],
    example:
      '{"operations":[{"entityType":"project","id":"project_123","patch":{"status":"completed"},"clientRef":"project-finish-1"}]}'
  },
  {
    toolName: "forge_delete_entities",
    summary: "Delete one or more entities through the batch delete flow.",
    whenToUse: "Use for explicit delete intent only.",
    inputShape:
      '{ atomic?: boolean, operations: Array<{ entityType: CrudEntityType, id: string, clientRef?: string, mode?: "soft"|"hard", reason?: string }> }',
    requiredFields: [
      "operations",
      "operations[].entityType",
      "operations[].id"
    ],
    notes: [
      "Delete defaults to soft.",
      "Use mode=hard only for explicit permanent removal.",
      "Restoration is only possible after soft delete.",
      "calendar_event, work_block_template, and task_timebox are immediate calendar-domain deletions: calendar events delete remote projections too, and these records do not go through the settings bin."
    ],
    example:
      '{"operations":[{"entityType":"task","id":"task_123","mode":"soft","reason":"Merged into another task"}]}'
  },
  {
    toolName: "forge_restore_entities",
    summary: "Restore soft-deleted entities from the settings bin.",
    whenToUse:
      "Use when the user wants an entity brought back after a soft delete.",
    inputShape:
      "{ atomic?: boolean, operations: Array<{ entityType: CrudEntityType, id: string, clientRef?: string }> }",
    requiredFields: [
      "operations",
      "operations[].entityType",
      "operations[].id"
    ],
    notes: ["Restore only works for soft-deleted entities."],
    example:
      '{"operations":[{"entityType":"goal","id":"goal_123","clientRef":"goal-restore-1"}]}'
  },
  {
    toolName: "forge_get_wiki_settings",
    summary:
      "Read the current wiki spaces plus enabled LLM and embedding profiles.",
    whenToUse:
      "Use before semantic wiki search, ingest, or wiki writes so the agent knows which spaces and profiles exist.",
    inputShape: "{}",
    requiredFields: [],
    notes: [
      "Semantic search is optional and profile-driven.",
      "The wiki is file-first, so spaces map to local vault directories."
    ],
    example: "{}"
  },
  {
    toolName: "forge_list_wiki_pages",
    summary: "List wiki and evidence pages inside one space.",
    whenToUse:
      "Use when browsing a space catalog, choosing a page to open, or building a crawl plan without ranking search results yet.",
    inputShape: '{ spaceId?: string, kind?: "wiki"|"evidence", limit?: integer }',
    requiredFields: [],
    notes: [
      "This returns the explicit page catalog, not a search-ranked result list.",
      "Use forge_search_wiki when recall or ranking matters."
    ],
    example: '{"spaceId":"wiki_space_shared","kind":"wiki","limit":100}'
  },
  {
    toolName: "forge_get_wiki_page",
    summary:
      "Read one wiki page with backlinks, source notes, and attached assets.",
    whenToUse:
      "Use after page discovery when an agent needs the full wiki context for one page.",
    inputShape: "{ pageId: string }",
    requiredFields: ["pageId"],
    notes: [
      "The detail payload includes backlinks and linked media assets.",
      "Forge entity links remain on the page.links field."
    ],
    example: '{"pageId":"note_123"}'
  },
  {
    toolName: "forge_search_wiki",
    summary:
      "Search the wiki with text, entity, semantic, or hybrid retrieval.",
    whenToUse:
      "Use when the agent needs recall across the explicit wiki memory surface instead of only structured entities.",
    inputShape:
      '{ spaceId?: string, kind?: "wiki"|"evidence", mode?: "text"|"semantic"|"entity"|"hybrid", query?: string, profileId?: string, linkedEntity?: { entityType, entityId }, limit?: integer }',
    requiredFields: [],
    notes: [
      "Hybrid search combines exact slug or title matches, FTS, entity links, and optional embeddings.",
      "If no embedding profile is configured, semantic and hybrid fall back to non-vector signals."
    ],
    example:
      '{"spaceId":"wiki_space_shared","mode":"hybrid","query":"landing page inspiration","limit":12}'
  },
  {
    toolName: "forge_upsert_wiki_page",
    summary:
      "Create a new wiki page or update an existing one through the file-backed wiki surface.",
    whenToUse:
      "Use when the user explicitly wants wiki memory persisted or reorganized.",
    inputShape:
      '{ pageId?: string, kind?: "wiki"|"evidence", title: string, slug?: string, summary?: string, aliases?: string[], contentMarkdown: string, author?: string|null, tags?: string[], spaceId?: string, frontmatter?: object, links?: Array<{ entityType, entityId, anchorKey? }> }',
    requiredFields: ["title", "contentMarkdown"],
    notes: [
      "When pageId is omitted, Forge creates a new page.",
      "When pageId is present, Forge patches the existing page and rewrites the canonical file."
    ],
    example:
      '{"title":"Taste map","contentMarkdown":"# Taste map\\n\\n[[forge:goal:goal_123|Core goal]] influences this page.","spaceId":"wiki_space_shared"}'
  },
  {
    toolName: "forge_get_wiki_health",
    summary:
      "Read wiki maintenance signals such as unresolved links, orphan pages, missing summaries, raw-source counts, and the generated index path.",
    whenToUse:
      "Use for memory quality checks, cleanup passes, or before asking an LLM to lint the wiki.",
    inputShape: "{ spaceId?: string }",
    requiredFields: [],
    notes: [
      "This is the explicit health surface for the file-first wiki vault.",
      "Use it before proposing cleanup work or auto-maintenance."
    ],
    example: '{"spaceId":"wiki_space_shared"}'
  },
  {
    toolName: "forge_sync_wiki_vault",
    summary:
      "Resync Markdown files from the local wiki vault into Forge metadata.",
    whenToUse:
      "Use after out-of-band file edits or imported file changes that should be reflected back in Forge.",
    inputShape: "{ spaceId?: string }",
    requiredFields: [],
    notes: [
      "Forge treats the vault as a first-class local artifact, so this route is the bridge back into app metadata."
    ],
    example: '{"spaceId":"wiki_space_shared"}'
  },
  {
    toolName: "forge_reindex_wiki_embeddings",
    summary:
      "Recompute wiki embedding chunks for one space and optional profile.",
    whenToUse:
      "Use after large wiki edits or when a new embedding profile is enabled.",
    inputShape: "{ spaceId?: string, profileId?: string }",
    requiredFields: [],
    notes: [
      "Only enabled embedding profiles are indexed.",
      "Reindexing does not modify the markdown files themselves."
    ],
    example: '{"spaceId":"wiki_space_shared","profileId":"wiki_embed_123"}'
  },
  {
    toolName: "forge_ingest_wiki_source",
    summary:
      "Ingest raw text, local files, or URLs into the wiki, preserving a raw source artifact and returning page plus proposal outputs.",
    whenToUse:
      "Use when the operator wants source material compiled into file-first wiki memory and optional Forge-entity proposals.",
    inputShape:
      '{ spaceId?: string, titleHint?: string, sourceKind: "raw_text"|"local_path"|"url", sourceText?: string, sourcePath?: string, sourceUrl?: string, mimeType?: string, llmProfileId?: string, parseStrategy?: "auto"|"text_only"|"multimodal", entityProposalMode?: "none"|"suggest", createAsKind?: "wiki"|"evidence", linkedEntityHints?: Array<{ entityType, entityId, anchorKey? }> }',
    requiredFields: ["sourceKind", "sourceText/sourcePath/sourceUrl"],
    notes: [
      "Forge preserves a raw artifact under the wiki space's raw directory.",
      "Entity proposals are suggestions only; they are not auto-applied."
    ],
    example:
      '{"sourceKind":"url","sourceUrl":"https://example.com/article","titleHint":"Research import","parseStrategy":"auto","entityProposalMode":"suggest"}'
  },
  {
    toolName: "forge_get_calendar_overview",
    summary:
      "Read connected calendars, Forge-native events, mirrored events, recurring work blocks, and task timeboxes together.",
    whenToUse:
      "Use before calendar-aware planning, slot selection, or scheduling diagnostics.",
    inputShape: "{ from?: string, to?: string }",
    requiredFields: [],
    notes: [
      "Use ISO datetimes.",
      "The response includes provider metadata, live connections, mirrored external events, derived work-block instances, and task timeboxes."
    ],
    example:
      '{"from":"2026-04-02T00:00:00.000Z","to":"2026-04-09T00:00:00.000Z"}'
  },
  {
    toolName: "forge_connect_calendar_provider",
    summary:
      "Create a Forge calendar connection for Google, Apple, Exchange Online, or custom CalDAV.",
    whenToUse:
      "Use only when the operator explicitly wants Forge connected to an external calendar provider.",
    inputShape:
      '{ provider: "google"|"apple"|"caldav"|"microsoft", label: string, username?: string, clientId?: string, clientSecret?: string, refreshToken?: string, password?: string, serverUrl?: string, authSessionId?: string, selectedCalendarUrls: string[], forgeCalendarUrl?: string, createForgeCalendar?: boolean }',
    requiredFields: ["provider", "label", "provider-specific credentials"],
    notes: [
      "Google uses OAuth client credentials plus a refresh token.",
      "Apple starts from https://caldav.icloud.com and autodiscovers the principal plus calendars after authentication.",
      "Exchange Online uses Microsoft Graph. In the current Forge implementation it is read-only: Forge mirrors the selected calendars but does not publish work blocks or timeboxes back to Microsoft.",
      "In the current self-hosted local runtime, Exchange Online now uses an interactive Microsoft public-client sign-in flow with PKCE after the operator has saved the Microsoft client ID, tenant, and redirect URI in Settings -> Calendar. Non-interactive callers should treat Microsoft connection setup as a Settings-owned operator action unless a completed authSessionId already exists.",
      "Custom CalDAV uses an account-level server URL, not a single calendar collection URL.",
      "Writable providers publish Forge work blocks and timeboxes to the dedicated Forge calendar for that connection."
    ],
    example:
      '{"provider":"apple","label":"Primary Apple","username":"operator@example.com","password":"app-password","selectedCalendarUrls":["https://caldav.icloud.com/.../Family/"],"forgeCalendarUrl":"https://caldav.icloud.com/.../Forge/","createForgeCalendar":false}'
  },
  {
    toolName: "forge_create_work_block_template",
    summary:
      "Create a recurring half-day, holiday, or custom work-block template.",
    whenToUse:
      "Use when the operator wants recurring time windows such as Main Activity, Secondary Activity, Third Activity, Rest, Holiday, or a custom block.",
    inputShape:
      '{ title: string, kind: "main_activity"|"secondary_activity"|"third_activity"|"rest"|"holiday"|"custom", color: string, timezone: string, weekDays: integer[], startMinute: integer, endMinute: integer, startsOn?: "YYYY-MM-DD"|null, endsOn?: "YYYY-MM-DD"|null, blockingState: "allowed"|"blocked" }',
    requiredFields: [
      "title",
      "kind",
      "timezone",
      "weekDays",
      "startMinute",
      "endMinute",
      "blockingState"
    ],
    notes: [
      "Minutes are measured from midnight in the selected timezone.",
      "startsOn and endsOn are optional date bounds. Leaving endsOn null makes the block repeat indefinitely.",
      "Use kind=holiday with weekDays [0,1,2,3,4,5,6] and minutes 0-1440 for vacations or other full-day blocked ranges.",
      "Derived instances appear in calendar overview responses immediately after creation.",
      "This is a convenience helper; agents can also create work_block_template through forge_create_entities."
    ],
    example:
      '{"title":"Summer holiday","kind":"holiday","color":"#14b8a6","timezone":"Europe/Zurich","weekDays":[0,1,2,3,4,5,6],"startMinute":0,"endMinute":1440,"startsOn":"2026-08-01","endsOn":"2026-08-16","blockingState":"blocked"}'
  },
  {
    toolName: "forge_recommend_task_timeboxes",
    summary:
      "Suggest future task slots that fit the current calendar rules and schedule.",
    whenToUse: "Use when preparing focused work in advance.",
    inputShape:
      "{ taskId: string, from?: string, to?: string, limit?: integer }",
    requiredFields: ["taskId"],
    notes: [
      "Recommendations consider mirrored calendar events, recurring work blocks, task or project scheduling rules, and the task's planned duration when available.",
      "Confirm a suggested slot by creating a task timebox."
    ],
    example:
      '{"taskId":"task_123","from":"2026-04-02T00:00:00.000Z","to":"2026-04-09T00:00:00.000Z","limit":6}'
  },
  {
    toolName: "forge_create_task_timebox",
    summary: "Create a planned task timebox in the Forge calendar domain.",
    whenToUse:
      "Use after choosing a valid future slot or when creating a manual timebox directly.",
    inputShape:
      '{ taskId: string, projectId?: string|null, title: string, startsAt: string, endsAt: string, source?: "manual"|"suggested"|"live_run" }',
    requiredFields: ["taskId", "title", "startsAt", "endsAt"],
    notes: [
      "Forge publishes these into the dedicated Forge calendar during provider sync.",
      "Live task runs can later attach to matching timeboxes.",
      "This is a convenience helper; agents can also create task_timebox through forge_create_entities."
    ],
    example:
      '{"taskId":"task_123","projectId":"project_456","title":"Draft the methods section","startsAt":"2026-04-03T08:00:00.000Z","endsAt":"2026-04-03T09:30:00.000Z","source":"suggested"}'
  },
  {
    toolName: "forge_grant_reward_bonus",
    summary:
      "Grant an explicit manual XP bonus or penalty with clear provenance.",
    whenToUse:
      "Use when the user or operator explicitly wants an auditable reward adjustment beyond the automatic task and habit reward paths.",
    inputShape:
      "{ entityType: RewardableEntityType, entityId: string, deltaXp: integer, reasonTitle: string, reasonSummary?: string, metadata?: object }",
    requiredFields: ["entityType", "entityId", "deltaXp", "reasonTitle"],
    notes: [
      "Requires rewards.manage and write scopes.",
      "Use this for explicit operator judgement, not as a substitute for normal task_run or habit check-in rewards."
    ],
    example:
      '{"entityType":"habit","entityId":"habit_morning_training","deltaXp":18,"reasonTitle":"Operator bonus","reasonSummary":"Stayed with the habit through unusual travel friction.","metadata":{"manual":true,"source":"agent"}}'
  },
  {
    toolName: "forge_post_insight",
    summary: "Store an agent-authored insight.",
    whenToUse:
      "Use when you have a data-grounded observation or recommendation worth keeping visible in Forge.",
    inputShape:
      "{ entityType?: string|null, entityId?: string|null, timeframeLabel?: string|null, title: string, summary: string, recommendation: string, rationale?: string, confidence?: number, visibility?: string, ctaLabel?: string }",
    requiredFields: ["title", "summary", "recommendation"],
    notes: [
      "Insights are for interpretation and advice, not for replacing user-owned goals or tasks."
    ],
    example:
      '{"entityType":"goal","entityId":"goal_123","title":"Admin drag is masking momentum","summary":"Creative progress is happening, but admin cleanup keeps interrupting it.","recommendation":"Protect one clean creative block and isolate admin into a separate recurring task.","confidence":0.82}'
  },
  {
    toolName: "forge_adjust_work_minutes",
    summary:
      "Add or remove tracked work minutes on a task or project without creating a live task run.",
    whenToUse:
      "Use for truthful retrospective minute corrections. Use this instead of forge_log_work when the task or project already exists and only tracked minutes need adjusting.",
    inputShape:
      '{ entityType: "task"|"project", entityId: string, deltaMinutes: integer, note?: string }',
    requiredFields: ["entityType", "entityId", "deltaMinutes"],
    notes: [
      "Positive deltaMinutes add tracked minutes and may award XP when a progress bucket is crossed.",
      "Negative deltaMinutes remove tracked minutes and may reverse XP symmetrically when a progress bucket is crossed downward.",
      "Requires rewards.manage and write scopes."
    ],
    example:
      '{"entityType":"task","entityId":"task_123","deltaMinutes":25,"note":"Captured the off-timer review pass from this morning."}'
  },
  {
    toolName: "forge_log_work",
    summary: "Log work that already happened.",
    whenToUse:
      "Use for completion-style retroactive work, not for starting a live session or adjusting minutes on an existing record.",
    inputShape:
      "{ taskId?: string, title?: string, description?: string, summary?: string, goalId?: string|null, projectId?: string|null, owner?: string, status?: TaskStatus, priority?: TaskPriority, dueDate?: string|null, effort?: TaskEffort, energy?: TaskEnergy, points?: number, tagIds?: string[], closeoutNote?: { contentMarkdown: string, author?: string|null, tags?: string[], destroyAt?: string|null, links?: Array<{ entityType, entityId, anchorKey? }> } }",
    requiredFields: ["taskId or title"],
    notes: [
      "Use taskId when logging work against an existing task.",
      "Use title when a new completed work item should be created and logged.",
      "Use forge_adjust_work_minutes for signed minute corrections on existing tasks or projects.",
      "closeoutNote persists the work summary as a real linked note."
    ],
    example:
      '{"taskId":"task_123","summary":"Finished the review draft and cleaned the notes.","points":40,"closeoutNote":{"contentMarkdown":"Finished the review draft, cleaned the note structure, and left one follow-up for QA."}}'
  },
  {
    toolName: "forge_start_task_run",
    summary: "Start truthful live work on a task.",
    whenToUse: "Use when the user wants to begin working now.",
    inputShape:
      '{ taskId: string, actor: string, timerMode?: "planned"|"unlimited", plannedDurationSeconds?: number|null, overrideReason?: string|null, isCurrent?: boolean, leaseTtlSeconds?: number, note?: string }',
    requiredFields: ["taskId", "actor"],
    notes: [
      "If timerMode is planned, plannedDurationSeconds is required.",
      "If timerMode is unlimited, plannedDurationSeconds must be null or omitted.",
      "If calendar rules currently block the task, pass an explicit overrideReason to proceed and keep the exception auditable."
    ],
    example:
      '{"taskId":"task_123","actor":"aurel","timerMode":"planned","plannedDurationSeconds":1500,"overrideReason":"Protected creative block after clinic hours.","isCurrent":true,"leaseTtlSeconds":900,"note":"Starting focused writing block"}'
  },
  {
    toolName: "forge_heartbeat_task_run",
    summary: "Refresh an active run lease while work continues.",
    whenToUse: "Use periodically during ongoing live work.",
    inputShape:
      "{ taskRunId: string, actor?: string, leaseTtlSeconds?: number, note?: string }",
    requiredFields: ["taskRunId"],
    notes: ["Heartbeat extends the lease and can update the note."],
    example:
      '{"taskRunId":"run_123","actor":"aurel","leaseTtlSeconds":900,"note":"Still in the block"}'
  },
  {
    toolName: "forge_focus_task_run",
    summary: "Mark one active run as the current focus.",
    whenToUse:
      "Use when several runs exist and one should be the visible current run.",
    inputShape: "{ taskRunId: string, actor?: string }",
    requiredFields: ["taskRunId"],
    notes: [
      "This does not complete or release a run; it just changes current focus."
    ],
    example: '{"taskRunId":"run_123","actor":"aurel"}'
  },
  {
    toolName: "forge_complete_task_run",
    summary: "Finish an active run as completed work.",
    whenToUse: "Use when the user has finished the live work block.",
    inputShape:
      "{ taskRunId: string, actor?: string, note?: string, closeoutNote?: { contentMarkdown: string, author?: string|null, tags?: string[], destroyAt?: string|null, links?: Array<{ entityType, entityId, anchorKey? }> } }",
    requiredFields: ["taskRunId"],
    notes: [
      "This is the truthful way to finish live work and award completion effects.",
      "closeoutNote persists a real linked note instead of only updating the transient run note."
    ],
    example:
      '{"taskRunId":"run_123","actor":"aurel","note":"Finished the review draft","closeoutNote":{"contentMarkdown":"Completed the draft review and listed the follow-up fixes."}}'
  },
  {
    toolName: "forge_release_task_run",
    summary: "Stop an active run without marking the task complete.",
    whenToUse:
      "Use when the user is stopping or pausing work without completion.",
    inputShape:
      "{ taskRunId: string, actor?: string, note?: string, closeoutNote?: { contentMarkdown: string, author?: string|null, tags?: string[], destroyAt?: string|null, links?: Array<{ entityType, entityId, anchorKey? }> } }",
    requiredFields: ["taskRunId"],
    notes: [
      "Use this instead of faking a stop by only changing task status.",
      "closeoutNote is useful for documenting blockers or handoff context."
    ],
    example:
      '{"taskRunId":"run_123","actor":"aurel","note":"Stopping for now; blocked on feedback","closeoutNote":{"contentMarkdown":"Blocked on feedback from design before I can continue."}}'
  }
] as const;

function buildAgentOnboardingPayload(request: {
  protocol: string;
  hostname: string;
  headers: Record<string, unknown>;
}) {
  const origin = getRequestOrigin(request);

  return {
    forgeBaseUrl: origin,
    webAppUrl: `${origin}/forge/`,
    apiBaseUrl: `${origin}/api/v1`,
    openApiUrl: `${origin}/api/v1/openapi.json`,
    healthUrl: `${origin}/api/v1/health`,
    settingsUrl: `${origin}/api/v1/settings`,
    tokenCreateUrl: `${origin}/api/v1/settings/tokens`,
    pluginBasePath: "/forge/v1",
    defaultConnectionMode: "operator_session" as const,
    defaultActorLabel: "aurel",
    defaultTimeoutMs: 15_000,
    recommendedScopes: [
      "read",
      "write",
      "insights",
      "rewards.manage",
      "psyche.read",
      "psyche.write",
      "psyche.note",
      "psyche.insight",
      "psyche.mode"
    ],
    recommendedTrustLevel: "trusted" as const,
    recommendedAutonomyMode: "approval_required" as const,
    recommendedApprovalMode: "approval_by_default" as const,
    authModes: {
      operatorSession: {
        label: "Quick connect",
        summary:
          "Recommended for localhost and Tailscale. No token is required up front; Forge can bootstrap an operator session automatically.",
        tokenRequired: false,
        trustedTargets: ["localhost", "127.0.0.1", "*.ts.net", "100.64.0.0/10"]
      },
      managedToken: {
        label: "Managed token",
        summary:
          "Use a long-lived token when you want explicit scoped auth, remote non-Tailscale access, or durable agent credentials.",
        tokenRequired: true
      }
    },
    tokenRecovery: {
      rawTokenStoredByForge: false,
      recoveryAction: "rotate_or_issue_new_token",
      rotationSummary:
        "Forge reveals raw tokens once. If you lose one, rotate it or issue a new token from Settings and update the plugin config.",
      settingsSummary:
        "Token creation, rotation, and revocation all live under Forge Settings so recovery is explicit and operator-controlled."
    },
    requiredHeaders: {
      authorization: "Authorization: Bearer <forge-api-token>",
      source: "X-Forge-Source: agent",
      actor: "X-Forge-Actor: <agent-label>"
    },
    conceptModel: {
      goal: "Long-horizon direction or outcome. Goals anchor projects and sometimes tasks directly.",
      project:
        "A multi-step workstream under one goal. Projects organize related tasks. Project lifecycle is driven by status: active means in play, paused means suspended, and completed means finished. Setting a project to completed auto-completes linked unfinished tasks.",
      task: "A concrete actionable work item. Task status is board state, not proof of live work.",
      taskRun:
        "A live work session attached to a task. Start, heartbeat, focus, complete, and release runs instead of faking work with status alone.",
      note: "A Markdown work note that can link to one or many entities. Use notes for progress evidence, context, and close-out summaries.",
      wiki:
        "Forge Wiki is the file-first memory layer: local Markdown pages plus media, backlinks, optional embeddings, explicit spaces, and structured links back to Forge entities.",
      insight:
        "An agent-authored observation or recommendation grounded in Forge data.",
      calendar:
        "A connected calendar source mirrored into Forge. Calendar state combines provider events, recurring work blocks, and task timeboxes.",
      workBlock:
        "A recurring half-day or custom time window such as Main Activity, Secondary Activity, Third Activity, Rest, Holiday, or Custom. Work blocks can allow or block work by default, can define active date bounds, and remain editable through the calendar surface.",
      taskTimebox:
        "A planned or live calendar slot tied to a task. Timeboxes can be suggested in advance or created automatically from active task runs.",
      psyche:
        "Forge Psyche is the reflective domain for values, patterns, behaviors, beliefs, modes, and trigger reports. It is sensitive and should be handled deliberately."
    },
    psycheSubmoduleModel: {
      value:
        "A value is the direction the user wants to move toward. Values orient action and can link back to goals, projects, tasks, and Psyche records.",
      behaviorPattern:
        "A behavior pattern is the recurring CBT-style loop: cue/context, visible response, short-term payoff, long-term cost, and preferred response.",
      behavior:
        "A behavior record is one trackable move or tendency, classified as away, committed, or recovery.",
      beliefEntry:
        "A belief entry is the user's own trackable belief statement, including beliefType, confidence, evidence, and a more flexible alternative.",
      schemaCatalog:
        "The schema catalog is the reference taxonomy of maladaptive and adaptive schemas. Belief entries can optionally point to one schema by schemaId, but the schema catalog is not itself the user's belief record.",
      modeProfile:
        "A mode profile is a durable description of a recurring part-state or strategy, including family, fear, burden, protective job, and origin context.",
      modeGuideSession:
        "A mode guide session is the guided reasoning worksheet that stores answers and candidate mode interpretations before or alongside a durable mode profile.",
      eventType:
        "An event type is reusable incident taxonomy for trigger reports, such as criticism, conflict, rupture, or overload.",
      emotionDefinition:
        "An emotion definition is reusable emotion vocabulary for trigger reports. Reports can either reference one or fall back to raw labels.",
      triggerReport:
        "A trigger report is the one-episode incident chain: situation, emotions, thoughts, behaviors, consequences, extra mode labels, schema themes, and next moves."
    },
    psycheCoachingPlaybooks: AGENT_ONBOARDING_PSYCHE_PLAYBOOKS,
    conversationRules: AGENT_ONBOARDING_CONVERSATION_RULES,
    entityConversationPlaybooks: AGENT_ONBOARDING_ENTITY_CONVERSATION_PLAYBOOKS,
    relationshipModel: [
      "Every Forge record belongs to one typed user owner: either human or bot.",
      "Read routes may scope to one user with userId or to several users with repeated userIds.",
      "Ownership and linkage are separate: a human-owned project can link to bot-owned tasks, strategies, notes, or insights.",
      "Goals are the top-level strategic layer.",
      "Projects belong to one goal through goalId.",
      "Tasks can belong to a goal, a project, both, or neither.",
      "Strategies can target one or many goals or projects while sequencing project and task nodes through a directed acyclic graph.",
      "A strategy remains editable until it is locked. Once locked, the plan becomes a contract and graph-shape edits should stop until the strategy is explicitly unlocked.",
      "Habits are recurring records that can connect directly to goals, projects, tasks, and durable Psyche entities.",
      "Task runs represent live work sessions on tasks and are separate from task status.",
      "Notes can link to one or many entities and are the canonical place for Markdown progress context or close-out evidence.",
      "Psyche values can link to goals, projects, and tasks.",
      "Behavior patterns, behaviors, beliefs, modes, and trigger reports cross-link to describe one reflective model rather than isolated records.",
      "Insights can point at one entity, but they exist to capture interpretation or advice rather than raw work items."
    ],
    multiUserModel: {
      summary:
        "Forge is multi-user by default. Humans and bots share one entity graph, with explicit ownership on every record and directional relationship settings between every pair of users.",
      defaultUserScopeBehavior:
        "If no user scope is provided, Forge returns all visible users. Use userId or repeated userIds when an agent should focus on one owner namespace or on a specific human/bot slice.",
      routeScoping: [
        "List and overview routes accept userId or repeated userIds to narrow the response to one or many owners.",
        "Entity detail routes remain globally addressable by id because ownership is metadata, not a separate table namespace.",
        "Mixed-entity search should include userIds whenever duplicate risk depends on owner identity."
      ],
      relationshipGraphDefaults: [
        "The directional user graph starts fully open: all users can discover, read, search, coordinate with, link to, and affect each other.",
        "Each edge is directional. A -> B defines what A can see or do to B, while B -> A is configured separately.",
        "Each directional edge now explicitly carries see, message, share-context, plan, and affect rights so the UI can tighten one lane without rewriting the entity model."
      ]
    },
    strategyContractModel: {
      draftSummary:
        "Strategies begin as editable drafts. Agents may save and refine incomplete drafts while the plan is still being negotiated.",
      lockSummary:
        "Setting isLocked to true turns the strategy into a contract. Locking now requires a real target plus an overview or end-state description, and then the sequencing graph, targets, linked entities, and descriptive plan fields should be treated as frozen until explicitly unlocked.",
      unlockSummary:
        "Unlocking a strategy reopens normal editing. Use this only when the human wants to renegotiate the plan rather than merely update execution status.",
      alignmentSummary:
        "Alignment is about executing the agreed strategy faithfully, not merely finishing isolated work. Forge therefore scores coverage, order, scope discipline, and quality separately before producing one alignment score.",
      metricBreakdown: [
        "Agreed work moving: are the planned steps being done at all, regardless of order",
        "Order respected: are steps happening in the agreed sequence instead of jumping ahead",
        "Scope held: is other unagreed work leaking into the strategy scope",
        "End-state satisfaction: are the targets landing cleanly without too many blocked nodes",
        "Target progress plus off-plan counts: is the contract actually reaching the intended end state"
      ]
    },
    entityCatalog: AGENT_ONBOARDING_ENTITY_CATALOG,
    toolInputCatalog: AGENT_ONBOARDING_TOOL_INPUT_CATALOG,
    connectionGuides: {
      openclaw: {
        label: "OpenClaw",
        installSteps: [
          "Install the Forge plugin from the repo or published package.",
          "Restart the OpenClaw gateway so the tool surface and UI proxy routes refresh.",
          "Open Forge Settings -> Agents to issue or rotate a managed token when remote scoped auth is needed."
        ],
        verifyCommands: [
          `curl -s ${origin}/api/v1/health`,
          "openclaw plugins install ./projects/forge",
          "openclaw gateway restart"
        ],
        configNotes: [
          "Localhost and Tailscale targets can usually use the operator-session path without a long-lived token.",
          "Create each agent as a Forge bot user, then use userId or userIds in tool inputs whenever the agent should focus on one human, one bot, or a specific collaboration slice."
        ]
      },
      hermes: {
        label: "Hermes",
        installSteps: [
          "Install forge-hermes-plugin into the Python environment Hermes actually runs.",
          "Let Hermes load the Forge plugin and bundled skill pack on startup.",
          "Use Forge Settings -> Agents if Hermes needs a managed token for remote or durable access."
        ],
        verifyCommands: [
          "python -m pip show forge-hermes-plugin",
          "~/.hermes/hermes-agent/venv/bin/python -m pip show forge-hermes-plugin",
          `curl -s ${origin}/api/v1/health`
        ],
        configNotes: [
          "Hermes keeps its durable Forge config under ~/.hermes/forge/config.json.",
          "Hermes uses the same multi-user scoping rules and should pass userIds intentionally when working across humans and bots.",
          "The Forge relationship graph still decides whether Hermes may see, message, plan for, or affect another owner."
        ]
      }
    },
    verificationPaths: {
      context: "/api/v1/context",
      xpMetrics: "/api/v1/metrics/xp",
      weeklyReview: "/api/v1/reviews/weekly",
      wikiSettings: "/api/v1/wiki/settings",
      wikiSearch: "/api/v1/wiki/search",
      wikiHealth: "/api/v1/wiki/health",
      calendarOverview: "/api/v1/calendar/overview",
      settingsBin: "/api/v1/settings/bin",
      batchSearch: "/api/v1/entities/search",
      psycheSchemaCatalog: "/api/v1/psyche/schema-catalog",
      psycheEventTypes: "/api/v1/psyche/event-types",
      psycheEmotions: "/api/v1/psyche/emotions"
    },
    recommendedPluginTools: {
      bootstrap: ["forge_get_operator_overview"],
      readModels: [
        "forge_get_user_directory",
        "forge_get_operator_context",
        "forge_get_current_work",
        "forge_get_psyche_overview",
        "forge_get_xp_metrics",
        "forge_get_weekly_review"
      ],
      uiWorkflow: ["forge_get_ui_entrypoint"],
      entityWorkflow: [
        "forge_search_entities",
        "forge_create_entities",
        "forge_update_entities",
        "forge_delete_entities",
        "forge_restore_entities"
      ],
      wikiWorkflow: [
        "forge_get_wiki_settings",
        "forge_list_wiki_pages",
        "forge_get_wiki_page",
        "forge_search_wiki",
        "forge_upsert_wiki_page",
        "forge_get_wiki_health",
        "forge_sync_wiki_vault",
        "forge_reindex_wiki_embeddings",
        "forge_ingest_wiki_source"
      ],
      rewardWorkflow: ["forge_grant_reward_bonus"],
      workWorkflow: [
        "forge_adjust_work_minutes",
        "forge_log_work",
        "forge_start_task_run",
        "forge_heartbeat_task_run",
        "forge_focus_task_run",
        "forge_complete_task_run",
        "forge_release_task_run"
      ],
      calendarWorkflow: [
        "forge_get_calendar_overview",
        "forge_connect_calendar_provider",
        "forge_sync_calendar_connection",
        "forge_create_work_block_template",
        "forge_recommend_task_timeboxes",
        "forge_create_task_timebox"
      ],
      insightWorkflow: ["forge_post_insight"]
    },
    interactionGuidance: {
      conversationMode: "continue_main_discussion_first",
      saveSuggestionPlacement: "end_of_message",
      saveSuggestionTone: "gentle_optional",
      maxQuestionsPerTurn: 1,
      psycheExplorationRule:
        "When a Psyche entity needs understanding first, begin with one exploratory question before any working formulation, replacement belief, suggested title, or save pitch. Keep the opening reflection to one or two short sentences, stay in plain prose instead of bullets or numbered lists, keep that first reply short, do not mention Forge search or save structure yet, avoid colons or list-shaped phrasing, and wait for the user's answer before offering a fuller formulation.",
      psycheOpeningQuestionRule:
        "Prefer a concrete opening question tied to the entity: ask when the value mattered, what happened the last time the pattern appeared, what felt threatened before the behavior, what the feared outcome is inside the belief, what the mode is protecting, what the part says to do, or where the shift began in the incident.",
      duplicateCheckRoute: "/api/v1/entities/search",
      uiSuggestionRule:
        "offer_visual_ui_when_review_or_editing_would_be_easier",
      browserFallbackRule:
        "Do not open the Forge UI or a browser just to create or update normal entities when the batch entity tools can do the job.",
      writeConsentRule:
        "If an entity is only implied, keep helping in the main conversation and offer Forge lightly at the end. Only write after explicit save intent or after the user accepts the Forge save offer."
    },
    mutationGuidance: {
      preferredBatchRoutes: {
        create: "/api/v1/entities/create",
        update: "/api/v1/entities/update",
        delete: "/api/v1/entities/delete",
        restore: "/api/v1/entities/restore",
        search: "/api/v1/entities/search"
      },
      deleteDefault: "soft",
      hardDeleteRequiresExplicitMode: true,
      restoreSummary:
        "Restore soft-deleted entities through the restore route or the settings bin. Calendar-domain deletes for calendar_event, work_block_template, and task_timebox are immediate and do not enter the bin.",
      entityDeleteSummary:
        "Entity DELETE routes default to soft delete. Pass mode=hard only when permanent removal is intended. Calendar-event deletes still remove remote projections downstream.",
      batchingRule:
        "forge_create_entities, forge_update_entities, forge_delete_entities, and forge_restore_entities all accept operations as arrays. Batch multiple related mutations together in one request when possible.",
      searchRule:
        "forge_search_entities accepts searches as an array. Search before create or update when duplicate risk exists.",
      createRule:
        "Each create operation must include entityType and full data. entityType alone is not enough. This includes calendar_event, work_block_template, and task_timebox alongside the usual planning and Psyche entities.",
      updateRule:
        "Each update operation must include entityType, id, and patch. For projects, lifecycle changes are status patches: active to restart, paused to suspend, completed to finish. Keep task and project scheduling rules on those same patch payloads. Calendar-event updates still run downstream provider projection sync.",
      createExample:
        '{"operations":[{"entityType":"goal","data":{"title":"Create meaningfully"},"clientRef":"goal-create-1"},{"entityType":"goal","data":{"title":"Build a beautiful family"},"clientRef":"goal-create-2"}]}',
      updateExample:
        '{"operations":[{"entityType":"project","id":"project_123","patch":{"status":"paused","schedulingRules":{"blockWorkBlockKinds":["main_activity"],"allowWorkBlockKinds":["secondary_activity"]}},"clientRef":"project-suspend-1"},{"entityType":"task","id":"task_456","patch":{"plannedDurationSeconds":5400,"schedulingRules":{"allowEventKeywords":["creative"],"blockEventKeywords":["clinic"]}},"clientRef":"task-scheduling-1"}]}'
    }
  };
}

function rewriteMountPath(url: string) {
  const queryIndex = url.indexOf("?");
  const pathname = queryIndex >= 0 ? url.slice(0, queryIndex) : url;
  const search = queryIndex >= 0 ? url.slice(queryIndex) : "";

  if (pathname === "/forge") {
    return `/${search}`;
  }

  if (pathname.startsWith("/forge/")) {
    return `${pathname.slice("/forge".length) || "/"}${search}`;
  }

  return url;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function formatValidationIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.map(String).join(".") : "body",
    message: issue.message
  }));
}

function parseIdempotencyKey(headers: Record<string, unknown>): string | null {
  const raw = headers["idempotency-key"];
  if (raw === undefined) {
    return null;
  }
  if (Array.isArray(raw)) {
    throw new Error("Idempotency-Key must be a single header value");
  }
  if (typeof raw !== "string") {
    throw new Error("Idempotency-Key must be a string");
  }
  const key = raw.trim();
  if (!key || key.length > 128) {
    throw new Error("Idempotency-Key must be between 1 and 128 characters");
  }
  return key;
}

function parseOptionalActorHeader(
  headers: Record<string, unknown>
): string | null {
  const raw = headers["x-forge-actor"];
  if (raw === undefined) {
    return null;
  }
  if (Array.isArray(raw)) {
    throw new Error("X-Forge-Actor must be a single header value");
  }
  if (typeof raw !== "string") {
    throw new Error("X-Forge-Actor must be a string");
  }
  const actor = raw.trim();
  return actor.length > 0 ? actor : null;
}

function parseActivityContext(headers: Record<string, unknown>) {
  const rawSource = headers["x-forge-source"];
  if (Array.isArray(rawSource)) {
    throw new Error("X-Forge-Source must be a single header value");
  }
  const source =
    rawSource === undefined
      ? "ui"
      : activitySourceSchema.parse(
          typeof rawSource === "string" ? rawSource.trim() : rawSource
        );
  return {
    source,
    actor: parseOptionalActorHeader(headers)
  } as const;
}

function parseBearerToken(headers: Record<string, unknown>): string | null {
  const raw = headers.authorization;
  if (raw === undefined) {
    return null;
  }
  if (Array.isArray(raw)) {
    throw new Error("Authorization must be a single header value");
  }
  if (typeof raw !== "string") {
    throw new Error("Authorization must be a string");
  }
  const [scheme, token] = raw.trim().split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new Error("Authorization must use Bearer token format");
  }
  return token;
}

function parseRequestAuth(headers: Record<string, unknown>) {
  const bearer = parseBearerToken(headers);
  const token = bearer ? verifyAgentToken(bearer) : null;
  const activity = parseActivityContext(headers);
  const actor = token?.agentLabel ?? activity.actor ?? null;
  const source = token ? "agent" : activity.source;
  return {
    token,
    actor,
    source,
    activity: {
      actor,
      source
    } as const
  };
}

function hasTokenScope(
  token: { scopes: string[] } | null,
  scope: string
): boolean {
  return Boolean(token?.scopes.includes(scope));
}

function isPsycheEntityType(
  entityType: string | null | undefined
): entityType is (typeof PSYCHE_ENTITY_TYPES)[number] {
  return Boolean(
    entityType &&
    PSYCHE_ENTITY_TYPES.includes(
      entityType as (typeof PSYCHE_ENTITY_TYPES)[number]
    )
  );
}

function getWatchdogHealth(
  taskRunWatchdog: ReturnType<typeof createTaskRunWatchdog> | null
) {
  if (!taskRunWatchdog) {
    return {
      enabled: false,
      healthy: true,
      state: "disabled" as const,
      reason: null,
      status: null
    };
  }

  const status = taskRunWatchdog.getStatus();
  if (status.consecutiveFailures > 0) {
    return {
      enabled: true,
      healthy: false,
      state: "degraded" as const,
      reason: status.lastError ?? "Task-run watchdog recovery failed",
      status
    };
  }

  return {
    enabled: true,
    healthy: true,
    state: status.running ? ("healthy" as const) : ("idle" as const),
    reason: null,
    status
  };
}

function buildHealthPayload(
  taskRunWatchdog: ReturnType<typeof createTaskRunWatchdog> | null,
  extras: Record<string, unknown> = {}
) {
  const watchdog = getWatchdogHealth(taskRunWatchdog);
  return {
    ok: watchdog.healthy,
    app: "forge",
    now: new Date().toISOString(),
    watchdog,
    ...extras
  };
}

function shouldIncludeRuntimeProbe(headers: Record<string, unknown>) {
  const probeHeader = headers["x-forge-runtime-probe"];
  if (Array.isArray(probeHeader)) {
    return probeHeader.some(
      (value) => typeof value === "string" && value.trim() === "1"
    );
  }
  return typeof probeHeader === "string" && probeHeader.trim() === "1";
}

function resolveScopedUserIds(
  query: Record<string, unknown> | undefined
): string[] | undefined {
  if (!query) {
    return undefined;
  }
  const values = [];
  const rawUserId = query.userId;
  const rawUserIds = query.userIds;
  if (typeof rawUserId === "string" && rawUserId.trim().length > 0) {
    values.push(rawUserId.trim());
  }
  const pushedRawUserIds = Array.isArray(rawUserIds)
    ? rawUserIds
    : rawUserIds === undefined
      ? []
      : [rawUserIds];
  for (const value of pushedRawUserIds) {
    if (typeof value !== "string") {
      continue;
    }
    for (const item of value.split(",")) {
      const trimmed = item.trim();
      if (trimmed) {
        values.push(trimmed);
      }
    }
  }
  const unique = Array.from(new Set(values));
  return unique.length > 0 ? unique : undefined;
}

function readRequestedUserIdFromBody(body: unknown): string | null | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }
  const value = (body as Record<string, unknown>).userId;
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return undefined;
}

function syncEntityOwnerFromBody(options: {
  entityType: Parameters<typeof setEntityOwner>[0];
  entityId: string;
  body: unknown;
  fallbackLabel?: string | null;
  assignDefaultWhenMissing?: boolean;
}) {
  const requestedUserId = readRequestedUserIdFromBody(options.body);
  if (requestedUserId === undefined && !options.assignDefaultWhenMissing) {
    return;
  }
  const owner = resolveUserForMutation(requestedUserId, options.fallbackLabel);
  setEntityOwner(options.entityType, options.entityId, owner.id);
}

function buildV1Context(userIds?: string[]) {
  const goals = filterOwnedEntities("goal", listGoals(), userIds);
  const tasks = filterOwnedEntities("task", listTasks(), userIds);
  const habits = filterOwnedEntities("habit", listHabits(), userIds);
  const users = listUsers();
  const selectedUsers =
    userIds && userIds.length > 0
      ? users.filter((user) => userIds.includes(user.id))
      : users;
  return {
    meta: {
      apiVersion: "v1" as const,
      transport: "rest+sse" as const,
      generatedAt: new Date().toISOString(),
      backend: "forge-node-runtime",
      mode: "transitional-node" as const
    },
    metrics: buildGamificationProfile(goals, tasks, habits),
    dashboard: getDashboard({ userIds }),
    overview: getOverviewContext(new Date(), { userIds }),
    today: getTodayContext(new Date(), { userIds }),
    risk: getRiskContext(new Date(), { userIds }),
    goals,
    projects: listProjectSummaries({ userIds }),
    tags: listTags(),
    tasks,
    habits,
    users,
    strategies: listStrategies({ userIds }),
    userScope: {
      selectedUserIds: userIds ?? [],
      selectedUsers
    },
    activeTaskRuns: listTaskRuns({ active: true, limit: 25 }),
    activity: getDashboard({ userIds }).recentActivity
  };
}

function buildXpMetricsPayload() {
  const goals = listGoals();
  const tasks = listTasks();
  const habits = listHabits();
  const rules = listRewardRules();
  const gamificationOverview = buildGamificationOverview(goals, tasks, habits);
  const dailyAmbientCap =
    rules
      .filter((rule) => rule.family === "ambient")
      .reduce(
        (max, rule) => Math.max(max, Number(rule.config.dailyCap ?? 0)),
        0
      ) || 12;

  return {
    profile: gamificationOverview.profile,
    achievements: gamificationOverview.achievements,
    milestoneRewards: gamificationOverview.milestoneRewards,
    momentumPulse: buildXpMomentumPulse(goals, tasks, habits),
    recentLedger: listRewardLedger({ limit: 25 }),
    rules,
    dailyAmbientXp: getDailyAmbientXp(new Date().toISOString().slice(0, 10)),
    dailyAmbientCap
  };
}

function resolveWorkAdjustmentTarget(
  entityType: WorkAdjustmentEntityType,
  entityId: string
): {
  entityType: WorkAdjustmentEntityType;
  entityId: string;
  title: string;
  time: TaskTimeSummary;
} | null {
  if (entityType === "task") {
    const task = getTaskById(entityId);
    return task
      ? {
          entityType,
          entityId: task.id,
          title: task.title,
          time: task.time
        }
      : null;
  }

  const project = getProjectSummary(entityId);
  return project
    ? {
        entityType,
        entityId: project.id,
        title: project.title,
        time: project.time
      }
    : null;
}

function clampWorkAdjustmentMinutes(
  deltaMinutes: number,
  currentCreditedSeconds: number
): number {
  if (deltaMinutes >= 0) {
    return deltaMinutes;
  }

  const maxRemovableMinutes = Math.max(
    0,
    Math.floor(currentCreditedSeconds / 60)
  );
  return -Math.min(Math.abs(deltaMinutes), maxRemovableMinutes);
}

function describeWorkAdjustment(input: {
  entityType: WorkAdjustmentEntityType;
  targetTitle: string;
  requestedDeltaMinutes: number;
  appliedDeltaMinutes: number;
}): { title: string; description: string } {
  const entityLabel = input.entityType === "task" ? "Task" : "Project";
  const requestedLabel = `${Math.abs(input.requestedDeltaMinutes)} minute${Math.abs(input.requestedDeltaMinutes) === 1 ? "" : "s"}`;
  const appliedLabel = `${Math.abs(input.appliedDeltaMinutes)} minute${Math.abs(input.appliedDeltaMinutes) === 1 ? "" : "s"}`;
  const direction = input.appliedDeltaMinutes >= 0 ? "added" : "removed";
  const clamped = input.requestedDeltaMinutes !== input.appliedDeltaMinutes;
  return {
    title: `${entityLabel} work adjusted: ${input.targetTitle}`,
    description: clamped
      ? `${requestedLabel} requested, ${appliedLabel} ${direction} after clamping to the currently tracked time.`
      : `${appliedLabel} ${direction} from the tracked work total.`
  };
}

function buildOperatorContext(userIds?: string[]) {
  const tasks = filterOwnedEntities("task", listTasks(), userIds);
  const dueHabits = filterOwnedEntities(
    "habit",
    listHabits({ dueToday: true }),
    userIds
  ).slice(0, 12);
  const activeProjects = listProjectSummaries({
    status: "active",
    userIds
  }).filter(
    (project) => project.activeTaskCount > 0 || project.completedTaskCount > 0
  );
  const focusTasks = tasks.filter(
    (task) => task.status === "focus" || task.status === "in_progress"
  );
  const recommendedNextTask =
    focusTasks[0] ??
    tasks.find((task) => task.status === "backlog") ??
    tasks.find((task) => task.status === "blocked") ??
    null;

  return {
    generatedAt: new Date().toISOString(),
    activeProjects: activeProjects.slice(0, 8),
    focusTasks: focusTasks.slice(0, 12),
    dueHabits,
    currentBoard: {
      backlog: tasks.filter((task) => task.status === "backlog").slice(0, 20),
      focus: tasks.filter((task) => task.status === "focus").slice(0, 20),
      inProgress: tasks
        .filter((task) => task.status === "in_progress")
        .slice(0, 20),
      blocked: tasks.filter((task) => task.status === "blocked").slice(0, 20),
      done: tasks.filter((task) => task.status === "done").slice(0, 20)
    },
    recentActivity: listActivityEvents({ limit: 20, userIds }),
    recentTaskRuns: listTaskRuns({ limit: 12, userIds }),
    recommendedNextTask,
    xp: buildXpMetricsPayload()
  };
}

function buildUserDirectoryPayload() {
  return {
    users: listUsers(),
    grants: listUserAccessGrants(),
    ownership: listUserOwnershipSummaries(),
    xp: listUserXpSummaries(),
    posture: {
      accessModel: "directional_graph" as const,
      summary:
        "Forge now exposes a directional relationship graph between humans and bots. The current default stays maximally permissive: every user can discover, search, link to, view, and affect every other visible user until you narrow those edges.",
      futureReady: true
    }
  };
}

function parseRequestBody<T>(
  parser: { parse: (value: unknown) => T },
  body: unknown
): T {
  let current = body;
  for (let depth = 0; depth < 2; depth += 1) {
    if (typeof current !== "string") {
      break;
    }
    const trimmed = current.trim();
    if (trimmed.length === 0) {
      return parser.parse({});
    }
    try {
      current = JSON.parse(trimmed) as unknown;
    } catch {
      break;
    }
  }
  return parser.parse(current ?? {});
}

function buildOperatorOverviewRouteGuide() {
  return {
    preferredStart: "/api/v1/operator/overview",
    mainRoutes: [
      {
        id: "users_directory",
        path: "/api/v1/users + /api/v1/users/directory",
        summary:
          "User directory, ownership counts, and current human/bot sharing posture for multi-user routing and UI search.",
        requiredScope: null
      },
      {
        id: "context",
        path: "/api/v1/context",
        summary:
          "Full Forge shell snapshot with goals, projects, tasks, activity, and derived overview blocks.",
        requiredScope: null
      },
      {
        id: "operator_context",
        path: "/api/v1/operator/context",
        summary:
          "Operational task board, focus queue, recent activity, and XP state for assistant workflows.",
        requiredScope: null
      },
      {
        id: "psyche_overview",
        path: "/api/v1/psyche/overview",
        summary:
          "Aggregate Psyche state across values, patterns, behaviors, beliefs, modes, and trigger reports.",
        requiredScope: "psyche.read"
      },
      {
        id: "xp_metrics",
        path: "/api/v1/metrics/xp",
        summary: "Reward profile, rule set, and recent reward-ledger events.",
        requiredScope: null
      },
      {
        id: "weekly_review",
        path: "/api/v1/reviews/weekly",
        summary:
          "Weekly reflection read model with wins, chart, and reward framing.",
        requiredScope: null
      },
      {
        id: "events",
        path: "/api/v1/events",
        summary:
          "Canonical event-log inspection for audit and provenance tracing.",
        requiredScope: null
      },
      {
        id: "agent_onboarding",
        path: "/api/v1/agents/onboarding",
        summary:
          "Live onboarding contract describing headers, scopes, verification probes, and plugin defaults.",
        requiredScope: null
      },
      {
        id: "settings_bin",
        path: "/api/v1/settings/bin",
        summary:
          "Deleted-items bin grouped by entity type with restore and permanent-delete actions.",
        requiredScope: "write"
      },
      {
        id: "entity_batch_search",
        path: "/api/v1/entities/search",
        summary:
          "Batch search route for mixed-entity lookup, linked-entity matching, and optional deleted-item visibility.",
        requiredScope: "write"
      },
      {
        id: "entity_batch_mutation",
        path: "/api/v1/entities/{create|update|delete|restore}",
        summary:
          "Preferred multi-entity mutation surface for agents. Delete defaults to soft delete and restore reverses soft deletion.",
        requiredScope: "write"
      },
      {
        id: "work_adjustments",
        path: "/api/v1/work-adjustments",
        summary:
          "Signed retrospective minute adjustments for existing tasks or projects, with symmetric progress-XP updates and clamp protection.",
        requiredScope: "write"
      },
      {
        id: "operator_log_work",
        path: "/api/v1/operator/log-work",
        summary:
          "Retroactively log real work and receive updated XP without pretending a live task run happened.",
        requiredScope: "write"
      },
      {
        id: "task_runs",
        path: "/api/v1/tasks/:id/runs + /api/v1/task-runs/*",
        summary:
          "Canonical live-work surface for starting, refreshing, focusing, completing, and releasing active task runs.",
        requiredScope: "write"
      }
    ]
  };
}

function buildOperatorOverview(request: {
  protocol: string;
  hostname: string;
  headers: Record<string, unknown>;
  query?: Record<string, unknown>;
}) {
  const auth = parseRequestAuth(request.headers);
  const userIds = resolveScopedUserIds(request.query);
  const canReadPsyche = auth.token
    ? hasTokenScope(auth.token, "psyche.read")
    : true;
  const warnings = canReadPsyche
    ? []
    : [
        "Psyche summary omitted because the active token does not include psyche.read."
      ];

  return {
    generatedAt: new Date().toISOString(),
    snapshot: buildV1Context(userIds),
    operator: buildOperatorContext(userIds),
    domains: listDomains(),
    psyche: canReadPsyche ? getPsycheOverview(userIds) : null,
    onboarding: buildAgentOnboardingPayload(request),
    capabilities: {
      tokenPresent: Boolean(auth.token),
      scopes: auth.token?.scopes ?? [],
      canReadPsyche,
      canWritePsyche: auth.token
        ? hasTokenScope(auth.token, "psyche.write")
        : true,
      canManageModes: auth.token
        ? hasTokenScope(auth.token, "psyche.mode")
        : true,
      canManageRewards: auth.token
        ? hasTokenScope(auth.token, "rewards.manage")
        : true
    },
    warnings,
    routeGuide: buildOperatorOverviewRouteGuide()
  };
}

export async function buildServer(
  options: {
    dataRoot?: string;
    seedDemoData?: boolean;
    taskRunWatchdog?: false | TaskRunWatchdogOptions;
  } = {}
) {
  const managers = createManagerRuntime({ dataRoot: options.dataRoot });
  managers.externalServices.register("google_calendar", {
    provider: "google",
    label: "Google Calendar"
  });
  managers.externalServices.register("microsoft_graph_calendar", {
    provider: "microsoft",
    label: "Exchange Online"
  });
  managers.externalServices.register("caldav", {
    provider: "caldav",
    label: "CalDAV"
  });
  const runtimeConfig = managers.configuration.readRuntimeConfig({
    dataRoot: options.dataRoot
  });
  configureDatabase({ dataRoot: runtimeConfig.dataRoot ?? undefined });
  configureDatabaseSeeding(options.seedDemoData ?? false);
  await managers.migration.initialize();
  ensureSystemUsers();
  const app = Fastify({
    logger: false,
    rewriteUrl: (request) => rewriteMountPath(request.url ?? "/")
  });
  const taskRunWatchdog =
    options.taskRunWatchdog === false
      ? null
      : createTaskRunWatchdog(options.taskRunWatchdog);

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(
        null,
        runtimeConfig.allowedOrigins.some((pattern) => pattern.test(origin))
      );
    },
    credentials: true
  });
  app.addHook("onClose", async () => {
    taskRunWatchdog?.stop();
  });

  app.setErrorHandler((error, _request, reply) => {
    const validationIssues =
      error instanceof ZodError ? formatValidationIssues(error) : undefined;
    const statusCode = isHttpError(error)
      ? error.statusCode
      : isManagerError(error)
        ? error.statusCode
        : error instanceof ZodError
          ? 400
          : 500;
    reply.code(statusCode).send({
      code: isHttpError(error)
        ? error.code
        : isManagerError(error)
          ? error.code
          : statusCode === 400
            ? "invalid_request"
            : "internal_error",
      error: validationIssues
        ? "Request validation failed"
        : getErrorMessage(error),
      statusCode,
      ...(validationIssues ? { details: validationIssues } : {}),
      ...(isHttpError(error) && error.details ? error.details : {}),
      ...(isManagerError(error) && error.details ? error.details : {})
    });
  });

  const authenticateRequest = (headers: Record<string, unknown>) =>
    managers.authentication.authenticate(headers);
  const toActivityContext = (context: ReturnType<typeof authenticateRequest>) =>
    ({
      actor: context.actor,
      source: context.source
    }) as const;
  const applyBatchCalendarEntityEffects = async (
    results: Array<{
      ok: boolean;
      entityType?: string;
      id?: string;
      entity?: unknown;
    }>,
    auth: ReturnType<typeof authenticateRequest>,
    action: "create" | "update" | "delete"
  ) => {
    for (const result of results) {
      if (
        !result.ok ||
        typeof result.entityType !== "string" ||
        typeof result.id !== "string"
      ) {
        continue;
      }

      if (result.entityType === "calendar_event") {
        if (action === "delete") {
          await deleteCalendarEventProjection(result.id, managers.secrets);
          const event = (result.entity ?? {}) as Record<string, unknown>;
          recordActivityEvent({
            entityType: "calendar_event",
            entityId: result.id,
            eventType: "calendar_event_deleted",
            title: `Calendar event deleted: ${typeof event.title === "string" ? event.title : result.id}`,
            description:
              "The Forge calendar event was removed and any projected remote copies were deleted.",
            actor: auth.actor ?? null,
            source: auth.source,
            metadata: {
              calendarId:
                typeof event.calendarId === "string" ? event.calendarId : null,
              originType:
                typeof event.originType === "string" ? event.originType : null
            }
          });
          continue;
        }

        await pushCalendarEventUpdate(result.id, managers.secrets);
        const refreshed = getCalendarEventById(result.id);
        if (!refreshed) {
          continue;
        }
        result.entity = refreshed;
        recordActivityEvent({
          entityType: "calendar_event",
          entityId: refreshed.id,
          eventType:
            action === "create"
              ? "calendar_event_created"
              : "calendar_event_updated",
          title: `Calendar event ${action === "create" ? "created" : "updated"}: ${refreshed.title}`,
          description:
            action === "create"
              ? "A native Forge calendar event was created."
              : "The Forge calendar event was updated and projected to remote calendars when configured.",
          actor: auth.actor ?? null,
          source: auth.source,
          metadata: {
            calendarId: refreshed.calendarId,
            originType: refreshed.originType
          }
        });
        continue;
      }

      if (
        result.entityType === "work_block_template" &&
        result.entity &&
        typeof result.entity === "object"
      ) {
        const template = result.entity as {
          id: string;
          title: string;
          kind?: string;
          blockingState?: string;
        };
        recordActivityEvent({
          entityType: "work_block",
          entityId: template.id,
          eventType:
            action === "create"
              ? "work_block_created"
              : action === "update"
                ? "work_block_updated"
                : "work_block_deleted",
          title: `Work block ${action}: ${template.title}`,
          description:
            action === "create"
              ? "A recurring work block was added to Forge."
              : action === "update"
                ? "The recurring work block was updated."
                : "The recurring work block was removed.",
          actor: auth.actor ?? null,
          source: auth.source,
          metadata: {
            kind: template.kind ?? null,
            blockingState:
              action === "delete" ? null : (template.blockingState ?? null)
          }
        });
        continue;
      }

      if (
        result.entityType === "task_timebox" &&
        result.entity &&
        typeof result.entity === "object"
      ) {
        const timebox = result.entity as {
          id: string;
          title: string;
          taskId?: string;
          status?: string;
        };
        recordActivityEvent({
          entityType: "task_timebox",
          entityId: timebox.id,
          eventType:
            action === "create"
              ? "task_timebox_created"
              : action === "update"
                ? "task_timebox_updated"
                : "task_timebox_deleted",
          title: `Task timebox ${action}: ${timebox.title}`,
          description:
            action === "create"
              ? "A future work slot was planned in Forge."
              : action === "update"
                ? "The planned work slot was updated."
                : "The planned work slot was removed.",
          actor: auth.actor ?? null,
          source: auth.source,
          metadata: {
            taskId: timebox.taskId ?? null,
            status: action === "delete" ? null : (timebox.status ?? null)
          }
        });
      }
    }
  };
  const requireOperatorSession = (
    headers: Record<string, unknown>,
    detail?: Record<string, unknown>
  ) => {
    const context = authenticateRequest(headers);
    managers.authorization.requireAuthenticatedOperator(context, detail);
    return context;
  };
  const requireAuthenticatedActor = (
    headers: Record<string, unknown>,
    detail?: Record<string, unknown>
  ) => {
    const context = authenticateRequest(headers);
    managers.authorization.requireAuthenticatedActor(context, detail);
    return context;
  };
  const requireScopedAccess = (
    headers: Record<string, unknown>,
    scopes: string[],
    detail?: Record<string, unknown>
  ) => {
    const context = authenticateRequest(headers);
    managers.authorization.requireAnyTokenScope(context, scopes, detail);
    return context;
  };
  const requirePsycheScopedAccess = (
    headers: Record<string, unknown>,
    scopes: string[],
    detail?: Record<string, unknown>
  ) => {
    const context = authenticateRequest(headers);
    if (isPsycheAuthRequired()) {
      managers.authorization.requireAnyTokenScope(context, scopes, detail);
    }
    return context;
  };
  const requireNoteAccess = (
    headers: Record<string, unknown>,
    entityType: string | null | undefined,
    detail?: Record<string, unknown>
  ) => {
    const context = authenticateRequest(headers);
    if (isPsycheEntityType(entityType)) {
      if (isPsycheAuthRequired()) {
        managers.authorization.requireAuthenticatedActor(context, detail);
        managers.authorization.requireAnyTokenScope(context, ["psyche.note"], {
          entityType,
          ...(detail ?? {})
        });
      }
      return context;
    }
    managers.authorization.requireAuthenticatedActor(context, detail);
    managers.authorization.requireAnyTokenScope(
      context,
      ["write", "insights"],
      detail
    );
    return context;
  };
  const requireInsightAccess = (
    headers: Record<string, unknown>,
    entityType: string | null | undefined,
    detail?: Record<string, unknown>
  ) => {
    const context = authenticateRequest(headers);
    if (isPsycheEntityType(entityType)) {
      if (isPsycheAuthRequired()) {
        managers.authorization.requireAuthenticatedActor(context, detail);
        managers.authorization.requireTokenScope(context, "psyche.insight", {
          entityType,
          ...(detail ?? {})
        });
      }
      return context;
    }
    managers.authorization.requireAuthenticatedActor(context, detail);
    managers.authorization.requireAnyTokenScope(
      context,
      ["write", "insights"],
      detail
    );
    return context;
  };

  app.get("/api/health", async () => buildHealthPayload(taskRunWatchdog));

  app.get("/api/v1/health", async (request) =>
    buildHealthPayload(taskRunWatchdog, {
      apiVersion: "v1",
      backend: "forge-node-runtime",
      ...(shouldIncludeRuntimeProbe(request.headers as Record<string, unknown>)
        ? {
            runtime: {
              pid: process.pid,
              storageRoot: runtimeConfig.dataRoot ?? process.cwd(),
              basePath: runtimeConfig.basePath
            }
          }
        : {})
    })
  );

  app.get("/api/v1/auth/operator-session", async (request, reply) => ({
    session: managers.session.ensureLocalOperatorSession(
      request.headers as Record<string, unknown>,
      reply
    )
  }));
  app.delete("/api/v1/auth/operator-session", async (request, reply) => ({
    revoked: managers.session.revokeCurrentSession(
      request.headers as Record<string, unknown>,
      reply
    )
  }));
  app.get("/api/v1/openapi.json", async () => buildOpenApiDocument());
  app.get("/api/v1/context", async (request) =>
    buildV1Context(
      resolveScopedUserIds(request.query as Record<string, unknown>)
    )
  );
  app.get("/api/v1/health/overview", async (request) => ({
    overview: getCompanionOverview(
      resolveScopedUserIds(request.query as Record<string, unknown>)
    )
  }));
  app.get("/api/v1/health/sleep", async (request) => ({
    sleep: getSleepViewData(
      resolveScopedUserIds(request.query as Record<string, unknown>)
    )
  }));
  app.get("/api/v1/health/fitness", async (request) => ({
    fitness: getFitnessViewData(
      resolveScopedUserIds(request.query as Record<string, unknown>)
    )
  }));
  app.post("/api/v1/health/pairing-sessions", async (request, reply) => {
    requireOperatorSession(request.headers as Record<string, unknown>, {
      route: "/api/v1/health/pairing-sessions"
    });
    reply.code(201);
    return createCompanionPairingSession(
      buildApiBaseUrl({
        protocol: request.protocol,
        headers: request.headers as Record<string, unknown>
      }),
      createCompanionPairingSessionSchema.parse(request.body ?? {})
    );
  });
  app.delete("/api/v1/health/pairing-sessions/:id", async (request, reply) => {
    const auth = requireOperatorSession(
      request.headers as Record<string, unknown>,
      {
        route: "/api/v1/health/pairing-sessions/:id"
      }
    );
    const { id } = request.params as { id: string };
    const session = revokeCompanionPairingSession(id, {
      actor: auth.actor ?? null,
      source: "ui"
    });
    if (!session) {
      reply.code(404);
      return { error: "Companion pairing session not found" };
    }
    return { session };
  });
  app.post("/api/v1/mobile/pairing/verify", async (request) => ({
    pairing: verifyCompanionPairing(
      verifyCompanionPairingSchema.parse(request.body ?? {})
    )
  }));
  app.post("/api/v1/mobile/healthkit/sync", async (request) => ({
    sync: ingestMobileHealthSync(
      mobileHealthSyncSchema.parse(request.body ?? {})
    )
  }));
  app.patch("/api/v1/health/workouts/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/health/workouts/:id" }
    );
    const { id } = request.params as { id: string };
    const workout = updateWorkoutMetadata(
      id,
      updateWorkoutMetadataSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    if (!workout) {
      reply.code(404);
      return { error: "Workout session not found" };
    }
    return { workout };
  });
  app.patch("/api/v1/health/sleep/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/health/sleep/:id" }
    );
    const { id } = request.params as { id: string };
    const sleep = updateSleepMetadata(
      id,
      updateSleepMetadataSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    if (!sleep) {
      reply.code(404);
      return { error: "Sleep session not found" };
    }
    return { sleep };
  });
  app.get("/api/v1/operator/context", async (request) => {
    requireOperatorSession(request.headers as Record<string, unknown>, {
      route: "/api/v1/operator/context"
    });
    const userIds = resolveScopedUserIds(
      request.query as Record<string, unknown>
    );
    return {
      context: buildOperatorContext(userIds)
    };
  });
  app.get("/api/v1/operator/overview", async (request) => {
    requireOperatorSession(request.headers as Record<string, unknown>, {
      route: "/api/v1/operator/overview"
    });
    return {
      overview: buildOperatorOverview({
        protocol: request.protocol,
        hostname: request.hostname,
        headers: request.headers as Record<string, unknown>,
        query: request.query as Record<string, unknown>
      })
    };
  });
  app.get("/api/v1/domains", async () => ({
    domains: listDomains()
  }));
  app.get("/api/v1/psyche/overview", async (request) => {
    requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.read"],
      { route: "/api/v1/psyche/overview" }
    );
    const userIds = resolveScopedUserIds(
      request.query as Record<string, unknown>
    );
    return { overview: getPsycheOverview(userIds) };
  });
  app.get("/api/v1/psyche/values", async (request) => {
    requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.read"],
      { route: "/api/v1/psyche/values" }
    );
    const userIds = resolveScopedUserIds(
      request.query as Record<string, unknown>
    );
    return {
      values: filterOwnedEntities("psyche_value", listPsycheValues(), userIds)
    };
  });
  app.post("/api/v1/psyche/values", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/values" }
    );
    const value = createPsycheValue(
      createPsycheValueSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    syncEntityOwnerFromBody({
      entityType: "psyche_value",
      entityId: value.id,
      body: request.body,
      fallbackLabel: auth.actor,
      assignDefaultWhenMissing: true
    });
    reply.code(201);
    return { value };
  });
  app.get("/api/v1/psyche/values/:id", async (request, reply) => {
    requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.read"],
      { route: "/api/v1/psyche/values/:id" }
    );
    const { id } = request.params as { id: string };
    const value = getPsycheValueById(id);
    if (!value) {
      reply.code(404);
      return { error: "Psyche value not found" };
    }
    return { value };
  });
  app.patch("/api/v1/psyche/values/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/values/:id" }
    );
    const { id } = request.params as { id: string };
    const value = updatePsycheValue(
      id,
      updatePsycheValueSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    if (!value) {
      reply.code(404);
      return { error: "Psyche value not found" };
    }
    syncEntityOwnerFromBody({
      entityType: "psyche_value",
      entityId: value.id,
      body: request.body
    });
    return { value };
  });
  app.delete("/api/v1/psyche/values/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/values/:id" }
    );
    const { id } = request.params as { id: string };
    const value = deleteEntity(
      "psyche_value",
      id,
      entityDeleteQuerySchema.parse(request.query ?? {}),
      toActivityContext(auth)
    );
    if (!value) {
      reply.code(404);
      return { error: "Psyche value not found" };
    }
    return { value };
  });
  app.get("/api/v1/psyche/patterns", async (request) => {
    requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.read"],
      { route: "/api/v1/psyche/patterns" }
    );
    const userIds = resolveScopedUserIds(
      request.query as Record<string, unknown>
    );
    return {
      patterns: filterOwnedEntities(
        "behavior_pattern",
        listBehaviorPatterns(),
        userIds
      )
    };
  });
  app.post("/api/v1/psyche/patterns", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/patterns" }
    );
    const pattern = createBehaviorPattern(
      createBehaviorPatternSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    syncEntityOwnerFromBody({
      entityType: "behavior_pattern",
      entityId: pattern.id,
      body: request.body,
      fallbackLabel: auth.actor,
      assignDefaultWhenMissing: true
    });
    reply.code(201);
    return { pattern };
  });
  app.get("/api/v1/psyche/patterns/:id", async (request, reply) => {
    requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.read"],
      { route: "/api/v1/psyche/patterns/:id" }
    );
    const { id } = request.params as { id: string };
    const pattern = getBehaviorPatternById(id);
    if (!pattern) {
      reply.code(404);
      return { error: "Behavior pattern not found" };
    }
    syncEntityOwnerFromBody({
      entityType: "behavior_pattern",
      entityId: pattern.id,
      body: request.body
    });
    return { pattern };
  });
  app.patch("/api/v1/psyche/patterns/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/patterns/:id" }
    );
    const { id } = request.params as { id: string };
    const pattern = updateBehaviorPattern(
      id,
      updateBehaviorPatternSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    if (!pattern) {
      reply.code(404);
      return { error: "Behavior pattern not found" };
    }
    return { pattern };
  });
  app.delete("/api/v1/psyche/patterns/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/patterns/:id" }
    );
    const { id } = request.params as { id: string };
    const pattern = deleteEntity(
      "behavior_pattern",
      id,
      entityDeleteQuerySchema.parse(request.query ?? {}),
      toActivityContext(auth)
    );
    if (!pattern) {
      reply.code(404);
      return { error: "Behavior pattern not found" };
    }
    return { pattern };
  });
  app.get("/api/v1/psyche/behaviors", async (request) => {
    requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.read"],
      { route: "/api/v1/psyche/behaviors" }
    );
    const userIds = resolveScopedUserIds(
      request.query as Record<string, unknown>
    );
    return {
      behaviors: filterOwnedEntities("behavior", listBehaviors(), userIds)
    };
  });
  app.post("/api/v1/psyche/behaviors", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/behaviors" }
    );
    const behavior = createBehavior(
      createBehaviorSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    syncEntityOwnerFromBody({
      entityType: "behavior",
      entityId: behavior.id,
      body: request.body,
      fallbackLabel: auth.actor,
      assignDefaultWhenMissing: true
    });
    reply.code(201);
    return { behavior };
  });
  app.get("/api/v1/psyche/behaviors/:id", async (request, reply) => {
    requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.read"],
      { route: "/api/v1/psyche/behaviors/:id" }
    );
    const { id } = request.params as { id: string };
    const behavior = getBehaviorById(id);
    if (!behavior) {
      reply.code(404);
      return { error: "Behavior not found" };
    }
    syncEntityOwnerFromBody({
      entityType: "behavior",
      entityId: behavior.id,
      body: request.body
    });
    return { behavior };
  });
  app.patch("/api/v1/psyche/behaviors/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/behaviors/:id" }
    );
    const { id } = request.params as { id: string };
    const behavior = updateBehavior(
      id,
      updateBehaviorSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    if (!behavior) {
      reply.code(404);
      return { error: "Behavior not found" };
    }
    return { behavior };
  });
  app.delete("/api/v1/psyche/behaviors/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/behaviors/:id" }
    );
    const { id } = request.params as { id: string };
    const behavior = deleteEntity(
      "behavior",
      id,
      entityDeleteQuerySchema.parse(request.query ?? {}),
      toActivityContext(auth)
    );
    if (!behavior) {
      reply.code(404);
      return { error: "Behavior not found" };
    }
    return { behavior };
  });
  app.get("/api/v1/psyche/schema-catalog", async (request) => {
    requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.read"],
      { route: "/api/v1/psyche/schema-catalog" }
    );
    return { schemas: listSchemaCatalog() };
  });
  app.get("/api/v1/psyche/beliefs", async (request) => {
    requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.read"],
      { route: "/api/v1/psyche/beliefs" }
    );
    const userIds = resolveScopedUserIds(
      request.query as Record<string, unknown>
    );
    return {
      beliefs: filterOwnedEntities("belief_entry", listBeliefEntries(), userIds)
    };
  });
  app.post("/api/v1/psyche/beliefs", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/beliefs" }
    );
    const belief = createBeliefEntry(
      createBeliefEntrySchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    syncEntityOwnerFromBody({
      entityType: "belief_entry",
      entityId: belief.id,
      body: request.body,
      fallbackLabel: auth.actor,
      assignDefaultWhenMissing: true
    });
    reply.code(201);
    return { belief };
  });
  app.get("/api/v1/psyche/beliefs/:id", async (request, reply) => {
    requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.read"],
      { route: "/api/v1/psyche/beliefs/:id" }
    );
    const { id } = request.params as { id: string };
    const belief = getBeliefEntryById(id);
    if (!belief) {
      reply.code(404);
      return { error: "Belief not found" };
    }
    syncEntityOwnerFromBody({
      entityType: "belief_entry",
      entityId: belief.id,
      body: request.body
    });
    return { belief };
  });
  app.patch("/api/v1/psyche/beliefs/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/beliefs/:id" }
    );
    const { id } = request.params as { id: string };
    const belief = updateBeliefEntry(
      id,
      updateBeliefEntrySchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    if (!belief) {
      reply.code(404);
      return { error: "Belief not found" };
    }
    return { belief };
  });
  app.delete("/api/v1/psyche/beliefs/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/beliefs/:id" }
    );
    const { id } = request.params as { id: string };
    const belief = deleteEntity(
      "belief_entry",
      id,
      entityDeleteQuerySchema.parse(request.query ?? {}),
      toActivityContext(auth)
    );
    if (!belief) {
      reply.code(404);
      return { error: "Belief not found" };
    }
    return { belief };
  });
  app.get("/api/v1/psyche/modes", async (request) => {
    requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.read"],
      { route: "/api/v1/psyche/modes" }
    );
    const userIds = resolveScopedUserIds(
      request.query as Record<string, unknown>
    );
    return {
      modes: filterOwnedEntities("mode_profile", listModeProfiles(), userIds)
    };
  });
  app.post("/api/v1/psyche/modes", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.mode"],
      { route: "/api/v1/psyche/modes" }
    );
    const mode = createModeProfile(
      createModeProfileSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    syncEntityOwnerFromBody({
      entityType: "mode_profile",
      entityId: mode.id,
      body: request.body,
      fallbackLabel: auth.actor,
      assignDefaultWhenMissing: true
    });
    reply.code(201);
    return { mode };
  });
  app.get("/api/v1/psyche/modes/:id", async (request, reply) => {
    requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.read"],
      { route: "/api/v1/psyche/modes/:id" }
    );
    const { id } = request.params as { id: string };
    const mode = getModeProfileById(id);
    if (!mode) {
      reply.code(404);
      return { error: "Mode not found" };
    }
    syncEntityOwnerFromBody({
      entityType: "mode_profile",
      entityId: mode.id,
      body: request.body
    });
    return { mode };
  });
  app.patch("/api/v1/psyche/modes/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.mode"],
      { route: "/api/v1/psyche/modes/:id" }
    );
    const { id } = request.params as { id: string };
    const mode = updateModeProfile(
      id,
      updateModeProfileSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    if (!mode) {
      reply.code(404);
      return { error: "Mode not found" };
    }
    return { mode };
  });
  app.delete("/api/v1/psyche/modes/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.mode"],
      { route: "/api/v1/psyche/modes/:id" }
    );
    const { id } = request.params as { id: string };
    const mode = deleteEntity(
      "mode_profile",
      id,
      entityDeleteQuerySchema.parse(request.query ?? {}),
      toActivityContext(auth)
    );
    if (!mode) {
      reply.code(404);
      return { error: "Mode not found" };
    }
    return { mode };
  });
  app.get("/api/v1/psyche/mode-guides", async (request) => {
    requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.mode"],
      { route: "/api/v1/psyche/mode-guides" }
    );
    const userIds = resolveScopedUserIds(
      request.query as Record<string, unknown>
    );
    return {
      sessions: filterOwnedEntities(
        "mode_guide_session",
        listModeGuideSessions(),
        userIds
      )
    };
  });
  app.post("/api/v1/psyche/mode-guides", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.mode"],
      { route: "/api/v1/psyche/mode-guides" }
    );
    const session = createModeGuideSession(
      createModeGuideSessionSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    syncEntityOwnerFromBody({
      entityType: "mode_guide_session",
      entityId: session.id,
      body: request.body,
      fallbackLabel: auth.actor,
      assignDefaultWhenMissing: true
    });
    reply.code(201);
    return { session };
  });
  app.get("/api/v1/psyche/mode-guides/:id", async (request, reply) => {
    requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.mode"],
      { route: "/api/v1/psyche/mode-guides/:id" }
    );
    const { id } = request.params as { id: string };
    const session = getModeGuideSessionById(id);
    if (!session) {
      reply.code(404);
      return { error: "Mode guide session not found" };
    }
    syncEntityOwnerFromBody({
      entityType: "mode_guide_session",
      entityId: session.id,
      body: request.body
    });
    return { session };
  });
  app.patch("/api/v1/psyche/mode-guides/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.mode"],
      { route: "/api/v1/psyche/mode-guides/:id" }
    );
    const { id } = request.params as { id: string };
    const session = updateModeGuideSession(
      id,
      updateModeGuideSessionSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    if (!session) {
      reply.code(404);
      return { error: "Mode guide session not found" };
    }
    return { session };
  });
  app.delete("/api/v1/psyche/mode-guides/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.mode"],
      { route: "/api/v1/psyche/mode-guides/:id" }
    );
    const { id } = request.params as { id: string };
    const session = deleteEntity(
      "mode_guide_session",
      id,
      entityDeleteQuerySchema.parse(request.query ?? {}),
      toActivityContext(auth)
    );
    if (!session) {
      reply.code(404);
      return { error: "Mode guide session not found" };
    }
    return { session };
  });
  app.get("/api/v1/psyche/event-types", async (request) => {
    requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.read"],
      { route: "/api/v1/psyche/event-types" }
    );
    const userIds = resolveScopedUserIds(
      request.query as Record<string, unknown>
    );
    return {
      eventTypes: filterOwnedEntities("event_type", listEventTypes(), userIds)
    };
  });
  app.post("/api/v1/psyche/event-types", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/event-types" }
    );
    const eventType = createEventType(
      createEventTypeSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    syncEntityOwnerFromBody({
      entityType: "event_type",
      entityId: eventType.id,
      body: request.body,
      fallbackLabel: auth.actor,
      assignDefaultWhenMissing: true
    });
    reply.code(201);
    return { eventType };
  });
  app.get("/api/v1/psyche/event-types/:id", async (request, reply) => {
    requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.read"],
      { route: "/api/v1/psyche/event-types/:id" }
    );
    const { id } = request.params as { id: string };
    const eventType = getEventTypeById(id);
    if (!eventType) {
      reply.code(404);
      return { error: "Event type not found" };
    }
    syncEntityOwnerFromBody({
      entityType: "event_type",
      entityId: eventType.id,
      body: request.body
    });
    return { eventType };
  });
  app.patch("/api/v1/psyche/event-types/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/event-types/:id" }
    );
    const { id } = request.params as { id: string };
    const eventType = updateEventType(
      id,
      updateEventTypeSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    if (!eventType) {
      reply.code(404);
      return { error: "Event type not found" };
    }
    return { eventType };
  });
  app.delete("/api/v1/psyche/event-types/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/event-types/:id" }
    );
    const { id } = request.params as { id: string };
    const eventType = deleteEntity(
      "event_type",
      id,
      entityDeleteQuerySchema.parse(request.query ?? {}),
      toActivityContext(auth)
    );
    if (!eventType) {
      reply.code(404);
      return { error: "Event type not found" };
    }
    return { eventType };
  });
  app.get("/api/v1/psyche/emotions", async (request) => {
    requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.read"],
      { route: "/api/v1/psyche/emotions" }
    );
    const userIds = resolveScopedUserIds(
      request.query as Record<string, unknown>
    );
    return {
      emotions: filterOwnedEntities(
        "emotion_definition",
        listEmotionDefinitions(),
        userIds
      )
    };
  });
  app.post("/api/v1/psyche/emotions", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/emotions" }
    );
    const emotion = createEmotionDefinition(
      createEmotionDefinitionSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    syncEntityOwnerFromBody({
      entityType: "emotion_definition",
      entityId: emotion.id,
      body: request.body,
      fallbackLabel: auth.actor,
      assignDefaultWhenMissing: true
    });
    reply.code(201);
    return { emotion };
  });
  app.get("/api/v1/psyche/emotions/:id", async (request, reply) => {
    requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.read"],
      { route: "/api/v1/psyche/emotions/:id" }
    );
    const { id } = request.params as { id: string };
    const emotion = getEmotionDefinitionById(id);
    if (!emotion) {
      reply.code(404);
      return { error: "Emotion definition not found" };
    }
    syncEntityOwnerFromBody({
      entityType: "emotion_definition",
      entityId: emotion.id,
      body: request.body
    });
    return { emotion };
  });
  app.patch("/api/v1/psyche/emotions/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/emotions/:id" }
    );
    const { id } = request.params as { id: string };
    const emotion = updateEmotionDefinition(
      id,
      updateEmotionDefinitionSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    if (!emotion) {
      reply.code(404);
      return { error: "Emotion definition not found" };
    }
    return { emotion };
  });
  app.delete("/api/v1/psyche/emotions/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/emotions/:id" }
    );
    const { id } = request.params as { id: string };
    const emotion = deleteEntity(
      "emotion_definition",
      id,
      entityDeleteQuerySchema.parse(request.query ?? {}),
      toActivityContext(auth)
    );
    if (!emotion) {
      reply.code(404);
      return { error: "Emotion definition not found" };
    }
    return { emotion };
  });
  app.get("/api/v1/psyche/reports", async (request) => {
    requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.read"],
      { route: "/api/v1/psyche/reports" }
    );
    const userIds = resolveScopedUserIds(
      request.query as Record<string, unknown>
    );
    return {
      reports: filterOwnedEntities(
        "trigger_report",
        listTriggerReports(),
        userIds
      )
    };
  });
  app.post("/api/v1/psyche/reports", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/reports" }
    );
    const report = createTriggerReport(
      createTriggerReportSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    syncEntityOwnerFromBody({
      entityType: "trigger_report",
      entityId: report.id,
      body: request.body,
      fallbackLabel: auth.actor,
      assignDefaultWhenMissing: true
    });
    reply.code(201);
    return { report };
  });
  app.get("/api/v1/psyche/reports/:id", async (request, reply) => {
    requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.read"],
      { route: "/api/v1/psyche/reports/:id" }
    );
    const { id } = request.params as { id: string };
    const report = getTriggerReportById(id);
    if (!report) {
      reply.code(404);
      return { error: "Trigger report not found" };
    }
    return {
      report,
      notes: listNotes({
        linkedEntityType: "trigger_report",
        linkedEntityId: id,
        limit: 50
      }),
      insights: listInsights({
        entityType: "trigger_report",
        entityId: id,
        limit: 50
      })
    };
  });
  app.patch("/api/v1/psyche/reports/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/reports/:id" }
    );
    const { id } = request.params as { id: string };
    const report = updateTriggerReport(
      id,
      updateTriggerReportSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    if (!report) {
      reply.code(404);
      return { error: "Trigger report not found" };
    }
    syncEntityOwnerFromBody({
      entityType: "trigger_report",
      entityId: report.id,
      body: request.body
    });
    return { report };
  });
  app.delete("/api/v1/psyche/reports/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/reports/:id" }
    );
    const { id } = request.params as { id: string };
    const report = deleteEntity(
      "trigger_report",
      id,
      entityDeleteQuerySchema.parse(request.query ?? {}),
      toActivityContext(auth)
    );
    if (!report) {
      reply.code(404);
      return { error: "Trigger report not found" };
    }
    return { report };
  });
  app.get("/api/v1/notes", async (request) => {
    const query = notesListQuerySchema.parse(request.query ?? {});
    if (isPsycheEntityType(query.linkedEntityType)) {
      requirePsycheScopedAccess(
        request.headers as Record<string, unknown>,
        ["psyche.read"],
        {
          route: "/api/v1/notes",
          entityType: query.linkedEntityType
        }
      );
    }
    return {
      notes: filterOwnedEntities("note", listNotes(query), query.userIds)
    };
  });
  app.post("/api/v1/notes", async (request, reply) => {
    const input = createNoteSchema.parse(request.body ?? {});
    const firstLinkedEntityType = input.links[0]?.entityType;
    const auth = requireNoteAccess(
      request.headers as Record<string, unknown>,
      firstLinkedEntityType,
      {
        route: "/api/v1/notes",
        entityType: firstLinkedEntityType ?? null
      }
    );
    const note = createNote(input, toActivityContext(auth));
    reply.code(201);
    return { note };
  });
  app.get("/api/v1/notes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = getNoteById(id);
    const psycheEntityType = current?.links.find((link) =>
      isPsycheEntityType(link.entityType)
    )?.entityType;
    if (psycheEntityType) {
      requirePsycheScopedAccess(
        request.headers as Record<string, unknown>,
        ["psyche.read"],
        {
          route: "/api/v1/notes/:id",
          entityType: psycheEntityType
        }
      );
    }
    if (!current) {
      reply.code(404);
      return { error: "Note not found" };
    }
    return { note: current };
  });
  app.patch("/api/v1/notes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const patch = updateNoteSchema.parse(request.body ?? {});
    const current = getNoteById(id);
    const linkedEntityType =
      current?.links[0]?.entityType ?? patch.links?.[0]?.entityType ?? null;
    const auth = requireNoteAccess(
      request.headers as Record<string, unknown>,
      linkedEntityType,
      {
        route: "/api/v1/notes/:id",
        entityType: linkedEntityType
      }
    );
    const note = updateNote(id, patch, toActivityContext(auth));
    if (!note) {
      reply.code(404);
      return { error: "Note not found" };
    }
    return { note };
  });
  app.delete("/api/v1/notes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = getNoteById(id);
    const linkedEntityType =
      current?.links.find((link) => isPsycheEntityType(link.entityType))
        ?.entityType ??
      current?.links[0]?.entityType ??
      null;
    const auth = requireNoteAccess(
      request.headers as Record<string, unknown>,
      linkedEntityType,
      {
        route: "/api/v1/notes/:id",
        entityType: linkedEntityType
      }
    );
    const note = deleteEntity(
      "note",
      id,
      entityDeleteQuerySchema.parse(request.query ?? {}),
      toActivityContext(auth)
    );
    if (!note) {
      reply.code(404);
      return { error: "Note not found" };
    }
    return { note };
  });
  app.get("/api/v1/wiki/settings", async (request) => {
    requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["read", "write"],
      { route: "/api/v1/wiki/settings" }
    );
    return { settings: getWikiSettingsPayload() };
  });
  app.post("/api/v1/wiki/settings/llm-profiles", async (request, reply) => {
    requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/wiki/settings/llm-profiles" }
    );
    const profile = upsertWikiLlmProfile(
      upsertWikiLlmProfileSchema.parse(request.body ?? {}),
      managers.secrets
    );
    reply.code(201);
    return { profile };
  });
  app.post(
    "/api/v1/wiki/settings/embedding-profiles",
    async (request, reply) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["write"],
        { route: "/api/v1/wiki/settings/embedding-profiles" }
      );
      const profile = upsertWikiEmbeddingProfile(
        upsertWikiEmbeddingProfileSchema.parse(request.body ?? {}),
        managers.secrets
      );
      reply.code(201);
      return { profile };
    }
  );
  app.delete(
    "/api/v1/wiki/settings/:kind(llm|embedding)-profiles/:id",
    async (request, reply) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["write"],
        { route: "/api/v1/wiki/settings/:kind-profiles/:id" }
      );
      const params = request.params as { kind: "llm" | "embedding"; id: string };
      deleteWikiProfile(params.kind, params.id);
      reply.code(204);
      return null;
    }
  );
  app.get("/api/v1/wiki/spaces", async (request) => {
    requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["read", "write"],
      { route: "/api/v1/wiki/spaces" }
    );
    return { spaces: listWikiSpaces() };
  });
  app.post("/api/v1/wiki/spaces", async (request, reply) => {
    requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/wiki/spaces" }
    );
    const space = createWikiSpace(createWikiSpaceSchema.parse(request.body ?? {}));
    reply.code(201);
    return { space };
  });
  app.get("/api/v1/wiki/pages", async (request) => {
    requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["read", "write"],
      { route: "/api/v1/wiki/pages" }
    );
    const query = request.query as {
      spaceId?: string;
      kind?: Note["kind"];
      limit?: string;
    };
    return {
      pages: listWikiPages({
        spaceId: query.spaceId,
        kind: query.kind,
        limit: query.limit ? Number(query.limit) : undefined
      })
    };
  });
  app.get("/api/v1/wiki/home", async (request, reply) => {
    requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["read", "write"],
      { route: "/api/v1/wiki/home" }
    );
    const query = request.query as { spaceId?: string };
    const payload = getWikiHomePageDetail({ spaceId: query.spaceId });
    if (!payload) {
      reply.code(404);
      return { error: "Wiki home page not found" };
    }
    return payload;
  });
  app.get("/api/v1/wiki/tree", async (request) => {
    requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["read", "write"],
      { route: "/api/v1/wiki/tree" }
    );
    const query = request.query as {
      spaceId?: string;
      kind?: Note["kind"];
    };
    return {
      tree: listWikiPageTree({
        spaceId: query.spaceId,
        kind: query.kind ?? "wiki"
      })
    };
  });
  app.post("/api/v1/wiki/pages", async (request, reply) => {
    const input = createNoteSchema.parse({
      kind: "wiki",
      ...(request.body ?? {})
    });
    const linkedEntityType = input.links[0]?.entityType ?? null;
    const auth = requireNoteAccess(
      request.headers as Record<string, unknown>,
      linkedEntityType,
      {
        route: "/api/v1/wiki/pages",
        entityType: linkedEntityType
      }
    );
    const note = createNote(input, toActivityContext(auth));
    reply.code(201);
    return getWikiPageDetail(note.id);
  });
  app.get("/api/v1/wiki/pages/:id", async (request, reply) => {
    requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["read", "write"],
      { route: "/api/v1/wiki/pages/:id" }
    );
    const { id } = request.params as { id: string };
    const payload = getWikiPageDetail(id);
    if (!payload) {
      reply.code(404);
      return { error: "Wiki page not found" };
    }
    return payload;
  });
  app.get("/api/v1/wiki/by-slug/:slug", async (request, reply) => {
    requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["read", "write"],
      { route: "/api/v1/wiki/by-slug/:slug" }
    );
    const { slug } = request.params as { slug: string };
    const query = request.query as { spaceId?: string };
    const payload = getWikiPageDetailBySlug({ spaceId: query.spaceId, slug });
    if (!payload) {
      reply.code(404);
      return { error: "Wiki page not found" };
    }
    return payload;
  });
  app.patch("/api/v1/wiki/pages/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const patch = updateNoteSchema.parse(request.body ?? {});
    const current = getNoteById(id);
    const linkedEntityType =
      current?.links[0]?.entityType ?? patch.links?.[0]?.entityType ?? null;
    const auth = requireNoteAccess(
      request.headers as Record<string, unknown>,
      linkedEntityType,
      {
        route: "/api/v1/wiki/pages/:id",
        entityType: linkedEntityType
      }
    );
    const note = updateNote(id, patch, toActivityContext(auth));
    if (!note) {
      reply.code(404);
      return { error: "Wiki page not found" };
    }
    return getWikiPageDetail(note.id);
  });
  app.post("/api/v1/wiki/search", async (request) => {
    requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["read", "write"],
      { route: "/api/v1/wiki/search" }
    );
    return searchWikiPages(
      wikiSearchQuerySchema.parse(request.body ?? {}),
      managers.secrets
    );
  });
  app.get("/api/v1/wiki/health", async (request) => {
    requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["read", "write"],
      { route: "/api/v1/wiki/health" }
    );
    return {
      health: getWikiHealth(syncWikiVaultSchema.parse(request.query ?? {}))
    };
  });
  app.post("/api/v1/wiki/sync", async (request) => {
    requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/wiki/sync" }
    );
    return syncWikiVaultFromDisk(syncWikiVaultSchema.parse(request.body ?? {}));
  });
  app.post("/api/v1/wiki/reindex", async (request) => {
    requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/wiki/reindex" }
    );
    return reindexWikiEmbeddings(
      reindexWikiEmbeddingsSchema.parse(request.body ?? {}),
      managers.secrets
    );
  });
  app.post("/api/v1/wiki/ingest-jobs", async (request, reply) => {
    const payload = createWikiIngestJobSchema.parse(request.body ?? {});
    const linkedEntityType = payload.linkedEntityHints[0]?.entityType ?? null;
    const auth = requireNoteAccess(
      request.headers as Record<string, unknown>,
      linkedEntityType,
      {
        route: "/api/v1/wiki/ingest-jobs",
        entityType: linkedEntityType
      }
    );
    const result = await ingestWikiSource(payload, {
      secrets: managers.secrets,
      createNote: (note) => createNote(note, toActivityContext(auth))
    });
    reply.code(201);
    return result;
  });
  app.get("/api/v1/wiki/ingest-jobs/:id", async (request, reply) => {
    requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["read", "write"],
      { route: "/api/v1/wiki/ingest-jobs/:id" }
    );
    const { id } = request.params as { id: string };
    const job = getWikiIngestJob(id);
    if (!job) {
      reply.code(404);
      return { error: "Wiki ingest job not found" };
    }
    return job;
  });
  app.get("/api/v1/projects", async (request) => {
    const query = projectListQuerySchema.parse(request.query ?? {});
    return { projects: listProjectSummaries(query) };
  });
  app.get("/api/v1/campaigns", async (request, reply) => {
    markDeprecatedAliasRoute(reply, "/api/v1/projects");
    const query = projectListQuerySchema.parse(request.query ?? {});
    return { projects: listProjectSummaries(query) };
  });
  app.get("/api/v1/goals", async (request) => {
    const query = goalListQuerySchema.parse(request.query ?? {});
    const goals = filterOwnedEntities("goal", listGoals(), query.userIds)
      .filter((goal) => (query.status ? goal.status === query.status : true))
      .filter((goal) => (query.horizon ? goal.horizon === query.horizon : true))
      .filter((goal) =>
        query.tagId ? goal.tagIds.includes(query.tagId) : true
      )
      .slice(0, query.limit ?? 100);
    return { goals };
  });
  app.get("/api/v1/goals/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const goal = getGoalById(id);
    if (!goal) {
      reply.code(404);
      return { error: "Goal not found" };
    }
    return { goal };
  });
  app.get("/api/v1/tasks", async (request) => {
    const query = taskListQuerySchema.parse(request.query ?? {});
    return {
      tasks: filterOwnedEntities("task", listTasks(query), query.userIds)
    };
  });
  app.get("/api/v1/calendar/overview", async (request) => {
    const query = calendarOverviewQuerySchema.parse(request.query ?? {});
    const now = new Date();
    const from =
      query.from ??
      new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const to =
      query.to ??
      new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000).toISOString();
    return {
      calendar: readCalendarOverview({ from, to, userIds: query.userIds })
    };
  });
  app.get("/api/v1/calendar/agenda", async (request) => {
    const query = calendarOverviewQuerySchema.parse(request.query ?? {});
    const now = new Date();
    const from =
      query.from ??
      new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const to =
      query.to ??
      new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000).toISOString();
    return {
      providers: listCalendarProviderMetadata(),
      calendars: listCalendars(),
      events: listCalendarEvents({ from, to, userIds: query.userIds }),
      workBlocks: listWorkBlockInstances({ from, to, userIds: query.userIds }),
      timeboxes: listTaskTimeboxes({ from, to, userIds: query.userIds })
    };
  });
  app.get("/api/v1/calendar/connections", async () => ({
    providers: listCalendarProviderMetadata(),
    connections: listConnectedCalendarConnections()
  }));
  app.post("/api/v1/calendar/oauth/microsoft/start", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/calendar/oauth/microsoft/start"
    });
    return await startMicrosoftCalendarOauth(
      startMicrosoftCalendarOauthSchema.parse(request.body ?? {}),
      getRequestOrigin(request)
    );
  });
  app.post("/api/v1/calendar/oauth/microsoft/test-config", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/calendar/oauth/microsoft/test-config"
    });
    return {
      result: await testMicrosoftCalendarOauthConfiguration(
        testMicrosoftCalendarOauthConfigurationSchema.parse(request.body ?? {})
      )
    };
  });
  app.get(
    "/api/v1/calendar/oauth/microsoft/session/:id",
    async (request, reply) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["write"],
        { route: "/api/v1/calendar/oauth/microsoft/session/:id" }
      );
      try {
        return getMicrosoftCalendarOauthSession(
          (request.params as { id: string }).id
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("Unknown Microsoft calendar auth session")
        ) {
          reply.code(404);
          return { error: "Microsoft calendar auth session not found" };
        }
        throw error;
      }
    }
  );
  app.get(
    "/api/v1/calendar/oauth/microsoft/callback",
    async (request, reply) => {
      const query = request.query as {
        state?: string;
        code?: string;
        error?: string;
        error_description?: string;
      };
      const result = await completeMicrosoftCalendarOauth({
        state: query.state ?? null,
        code: query.code ?? null,
        error: query.error ?? null,
        errorDescription: query.error_description ?? null
      });
      const session = result.session;
      const escapedOrigin = JSON.stringify(result.openerOrigin || "*");
      const escapedMessage = JSON.stringify({
        type: "forge:microsoft-calendar-auth",
        sessionId: session.sessionId,
        status: session.status
      });
      const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Forge Microsoft sign-in</title>
    <style>
      body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#0b1320;color:#f8fafc;display:grid;place-items:center;min-height:100vh}
      main{max-width:28rem;padding:2rem;border:1px solid rgba(255,255,255,.08);border-radius:24px;background:linear-gradient(180deg,rgba(18,28,38,.98),rgba(11,17,28,.98))}
      h1{margin:0 0 .75rem;font-size:1.15rem}
      p{margin:0;color:rgba(248,250,252,.72);line-height:1.6}
    </style>
  </head>
  <body>
    <main>
      <h1>${session.status === "authorized" ? "Microsoft account connected" : "Microsoft sign-in needs attention"}</h1>
      <p>${session.status === "authorized" ? "Forge received your Microsoft account and sent the result back to the calendar setup flow. You can close this window." : (session.error ?? "Forge could not complete Microsoft sign-in. You can close this window and try again from Settings.")}</p>
    </main>
    <script>
      const message = ${escapedMessage};
      const targetOrigin = ${escapedOrigin};
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(message, targetOrigin);
        }
      } catch {}
      setTimeout(() => window.close(), 180);
    </script>
  </body>
</html>`;
      reply.type("text/html; charset=utf-8");
      return body;
    }
  );
  app.post("/api/v1/calendar/discovery", async (request) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/calendar/discovery" }
    );
    const discovery = await discoverCalendarConnection(
      discoverCalendarConnectionSchema.parse(request.body ?? {})
    );
    recordActivityEvent({
      entityType: "calendar_connection",
      entityId: "calendar_discovery",
      eventType: "calendar_connection_discovered",
      title: `Calendar discovery completed for ${discovery.provider}`,
      description:
        "Forge discovered provider calendars before connection setup.",
      actor: auth.actor ?? null,
      source: auth.source,
      metadata: {
        provider: discovery.provider,
        calendars: discovery.calendars.length
      }
    });
    return { discovery };
  });
  app.get("/api/v1/calendar/calendars", async () => ({
    calendars: listCalendars()
  }));
  app.get(
    "/api/v1/calendar/connections/:id/discovery",
    async (request, reply) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["write"],
        { route: "/api/v1/calendar/connections/:id/discovery" }
      );
      const { id } = request.params as { id: string };
      try {
        const discovery = await discoverExistingCalendarConnection(
          id,
          managers.secrets
        );
        return { discovery };
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("Unknown calendar connection")
        ) {
          reply.code(404);
          return { error: "Calendar connection not found" };
        }
        throw error;
      }
    }
  );
  app.get("/api/v1/habits", async (request) => {
    const query = habitListQuerySchema.parse(request.query ?? {});
    return {
      habits: filterOwnedEntities("habit", listHabits(query), query.userIds)
    };
  });
  app.get("/api/v1/habits/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const habit = getHabitById(id);
    if (!habit) {
      reply.code(404);
      return { error: "Habit not found" };
    }
    return { habit };
  });
  app.get("/api/v1/projects/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = listProjectSummaries().find((entry) => entry.id === id);
    if (!project) {
      reply.code(404);
      return { error: "Project not found" };
    }
    return { project };
  });
  app.get("/api/v1/projects/:id/board", async (request, reply) => {
    const { id } = request.params as { id: string };
    const payload = getProjectBoard(id);
    if (!payload) {
      reply.code(404);
      return { error: "Project not found" };
    }
    return projectBoardPayloadSchema.parse(payload);
  });
  app.get("/api/v1/users", async () => ({ users: listUsers() }));
  app.get("/api/v1/users/directory", async () => ({
    directory: buildUserDirectoryPayload()
  }));
  app.patch("/api/v1/users/access-grants/:id", async (request, reply) => {
    requireScopedAccess(request.headers, ["write"], {
      route: "/api/v1/users/access-grants/:id"
    });
    const { id } = request.params as { id: string };
    const grant = updateUserAccessGrant(
      id,
      updateUserAccessGrantSchema.parse(request.body ?? {})
    );
    if (!grant) {
      reply.code(404);
      return { error: "User access grant not found." };
    }
    return { grant };
  });
  app.post("/api/v1/users", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/users"
    });
    const user = createUser(createUserSchema.parse(request.body ?? {}));
    reply.code(201);
    return { user };
  });
  app.patch("/api/v1/users/:id", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/users/:id"
    });
    const { id } = request.params as { id: string };
    const user = updateUser(id, updateUserSchema.parse(request.body ?? {}));
    if (!user) {
      reply.code(404);
      return { error: "User not found" };
    }
    return { user };
  });
  app.get("/api/v1/users/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = getUserById(id);
    if (!user) {
      reply.code(404);
      return { error: "User not found" };
    }
    return { user };
  });
  app.get("/api/v1/preferences/workspace", async (request) => {
    requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["read", "write"],
      { route: "/api/v1/preferences/workspace" }
    );
    return {
      workspace: getPreferenceWorkspace(
        preferenceWorkspaceQuerySchema.parse(request.query ?? {})
      )
    };
  });
  app.post("/api/v1/preferences/game/start", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/preferences/game/start"
    });
    return {
      workspace: startPreferenceGame(
        startPreferenceGameSchema.parse(request.body ?? {})
      )
    };
  });
  app.post("/api/v1/preferences/catalogs", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/preferences/catalogs"
    });
    const catalog = createPreferenceCatalog(
      createPreferenceCatalogSchema.parse(request.body ?? {})
    );
    reply.code(201);
    return { catalog };
  });
  app.patch("/api/v1/preferences/catalogs/:id", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/preferences/catalogs/:id"
    });
    const { id } = request.params as { id: string };
    return {
      catalog: updatePreferenceCatalog(
        id,
        updatePreferenceCatalogSchema.parse(request.body ?? {})
      )
    };
  });
  app.delete("/api/v1/preferences/catalogs/:id", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/preferences/catalogs/:id"
    });
    const { id } = request.params as { id: string };
    return { catalog: deletePreferenceCatalog(id) };
  });
  app.post("/api/v1/preferences/catalog-items", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/preferences/catalog-items"
    });
    const item = createPreferenceCatalogItem(
      createPreferenceCatalogItemSchema.parse(request.body ?? {})
    );
    reply.code(201);
    return { item };
  });
  app.patch("/api/v1/preferences/catalog-items/:id", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/preferences/catalog-items/:id"
    });
    const { id } = request.params as { id: string };
    return {
      item: updatePreferenceCatalogItem(
        id,
        updatePreferenceCatalogItemSchema.parse(request.body ?? {})
      )
    };
  });
  app.delete("/api/v1/preferences/catalog-items/:id", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/preferences/catalog-items/:id"
    });
    const { id } = request.params as { id: string };
    return { item: deletePreferenceCatalogItem(id) };
  });
  app.post("/api/v1/preferences/contexts", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/preferences/contexts"
    });
    const context = createPreferenceContext(
      createPreferenceContextSchema.parse(request.body ?? {})
    );
    reply.code(201);
    return { context };
  });
  app.patch("/api/v1/preferences/contexts/:id", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/preferences/contexts/:id"
    });
    const { id } = request.params as { id: string };
    return {
      context: updatePreferenceContext(
        id,
        updatePreferenceContextSchema.parse(request.body ?? {})
      )
    };
  });
  app.post("/api/v1/preferences/contexts/merge", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/preferences/contexts/merge"
    });
    return {
      merge: mergePreferenceContexts(
        mergePreferenceContextsSchema.parse(request.body ?? {})
      )
    };
  });
  app.post("/api/v1/preferences/items", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/preferences/items"
    });
    const item = createPreferenceItem(
      createPreferenceItemSchema.parse(request.body ?? {})
    );
    reply.code(201);
    return { item };
  });
  app.patch("/api/v1/preferences/items/:id", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/preferences/items/:id"
    });
    const { id } = request.params as { id: string };
    return {
      item: updatePreferenceItem(
        id,
        updatePreferenceItemSchema.parse(request.body ?? {})
      )
    };
  });
  app.post("/api/v1/preferences/items/from-entity", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/preferences/items/from-entity"
    });
    const item = createPreferenceItemFromEntity(
      enqueueEntityPreferenceItemSchema.parse(request.body ?? {})
    );
    reply.code(201);
    return { item };
  });
  app.post("/api/v1/preferences/judgments", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/preferences/judgments"
    });
    const judgment = submitPairwiseJudgment(
      submitPairwiseJudgmentSchema.parse(request.body ?? {})
    );
    reply.code(201);
    return { judgment };
  });
  app.post("/api/v1/preferences/signals", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/preferences/signals"
    });
    const signal = submitAbsoluteSignal(
      submitAbsoluteSignalSchema.parse(request.body ?? {})
    );
    reply.code(201);
    return { signal };
  });
  app.patch("/api/v1/preferences/items/:id/score", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/preferences/items/:id/score"
    });
    const { id } = request.params as { id: string };
    return {
      workspace: updatePreferenceScore(
        id,
        updatePreferenceScoreSchema.parse(request.body ?? {})
      )
    };
  });
  app.get("/api/v1/strategies", async (request) => {
    const query = strategyListQuerySchema.parse(request.query ?? {});
    return { strategies: listStrategies(query) };
  });
  app.get("/api/v1/strategies/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const strategy = getStrategyById(id);
    if (!strategy) {
      reply.code(404);
      return { error: "Strategy not found" };
    }
    return { strategy };
  });
  app.get("/api/v1/tags", async (request) => {
    const userIds = resolveScopedUserIds(
      request.query as Record<string, unknown>
    );
    return { tags: filterOwnedEntities("tag", listTags(), userIds) };
  });
  app.get("/api/v1/tags/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const tag = getTagById(id);
    if (!tag) {
      reply.code(404);
      return { error: "Tag not found" };
    }
    return { tag };
  });
  app.get("/api/v1/activity", async (request) => {
    const query = activityListQuerySchema.parse(request.query ?? {});
    return { activity: listActivityEvents(query) };
  });
  app.post("/api/v1/activity/:id/remove", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/activity/:id/remove"
    });
    const { id } = request.params as { id: string };
    const event = removeActivityEvent(
      id,
      removeActivityEventSchema.parse(request.body ?? {}),
      parseActivityContext(request.headers as Record<string, unknown>)
    );
    if (!event) {
      reply.code(404);
      return { error: "Activity event not found" };
    }
    return { event };
  });
  app.get("/api/v1/metrics", async () => ({
    metrics: buildGamificationOverview(listGoals(), listTasks(), listHabits())
  }));
  app.get("/api/v1/metrics/xp", async () => ({
    metrics: buildXpMetricsPayload()
  }));
  app.get("/api/v1/insights", async (request) => ({
    insights: getInsightsPayload(new Date(), {
      userIds: resolveScopedUserIds(request.query as Record<string, unknown>)
    })
  }));
  app.post("/api/v1/insights", async (request, reply) => {
    const input = createInsightSchema.parse(request.body ?? {});
    const auth = requireInsightAccess(
      request.headers as Record<string, unknown>,
      input.entityType,
      {
        route: "/api/v1/insights",
        entityType: input.entityType
      }
    );
    const insight = createInsight(input, {
      actor: auth.actor,
      source: auth.source
    });
    reply.code(201);
    return { insight };
  });
  app.get("/api/v1/insights/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const insight = getInsightById(id);
    if (!insight) {
      reply.code(404);
      return { error: "Insight not found" };
    }
    return { insight };
  });
  app.patch("/api/v1/insights/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = getInsightById(id);
    const auth = requireInsightAccess(
      request.headers as Record<string, unknown>,
      current?.entityType,
      {
        route: "/api/v1/insights/:id",
        entityType: current?.entityType ?? null
      }
    );
    const insight = updateInsight(
      id,
      updateInsightSchema.parse(request.body ?? {}),
      { actor: auth.actor, source: auth.source }
    );
    if (!insight) {
      reply.code(404);
      return { error: "Insight not found" };
    }
    return { insight };
  });
  app.delete("/api/v1/insights/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = getInsightById(id);
    const auth = requireInsightAccess(
      request.headers as Record<string, unknown>,
      current?.entityType,
      {
        route: "/api/v1/insights/:id",
        entityType: current?.entityType ?? null
      }
    );
    const query = entityDeleteQuerySchema.parse(request.query ?? {});
    const insight =
      query.mode === "hard"
        ? deleteInsight(id, { actor: auth.actor, source: auth.source })
        : deleteEntity("insight", id, query, {
            actor: auth.actor,
            source: auth.source
          });
    if (!insight) {
      reply.code(404);
      return { error: "Insight not found" };
    }
    return { insight };
  });
  app.post("/api/v1/insights/:id/feedback", async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = getInsightById(id);
    const auth = requireInsightAccess(
      request.headers as Record<string, unknown>,
      current?.entityType,
      {
        route: "/api/v1/insights/:id/feedback",
        entityType: current?.entityType ?? null
      }
    );
    const feedback = createInsightFeedback(
      id,
      createInsightFeedbackSchema.parse(request.body ?? {}),
      { actor: auth.actor, source: auth.source }
    );
    if (!feedback) {
      reply.code(404);
      return { error: "Insight not found" };
    }
    return { feedback };
  });
  app.get("/api/v1/approval-requests", async (request) => {
    requireOperatorSession(request.headers as Record<string, unknown>, {
      route: "/api/v1/approval-requests"
    });
    const query = request.query as { status?: string } | undefined;
    return { approvalRequests: listApprovalRequests(query?.status as never) };
  });
  app.post("/api/v1/approval-requests/:id/approve", async (request, reply) => {
    const context = requireOperatorSession(
      request.headers as Record<string, unknown>,
      { route: "/api/v1/approval-requests/:id/approve" }
    );
    const { id } = request.params as { id: string };
    const body = resolveApprovalRequestSchema.parse(request.body ?? {});
    const approvalRequest = approveApprovalRequest(
      id,
      body.note,
      body.actor ??
        context.actor ??
        parseOptionalActorHeader(request.headers as Record<string, unknown>)
    );
    if (!approvalRequest) {
      reply.code(404);
      return { error: "Approval request not found" };
    }
    return { approvalRequest };
  });
  app.post("/api/v1/approval-requests/:id/reject", async (request, reply) => {
    const context = requireOperatorSession(
      request.headers as Record<string, unknown>,
      { route: "/api/v1/approval-requests/:id/reject" }
    );
    const { id } = request.params as { id: string };
    const body = resolveApprovalRequestSchema.parse(request.body ?? {});
    const approvalRequest = rejectApprovalRequest(
      id,
      body.note,
      body.actor ??
        context.actor ??
        parseOptionalActorHeader(request.headers as Record<string, unknown>)
    );
    if (!approvalRequest) {
      reply.code(404);
      return { error: "Approval request not found" };
    }
    return { approvalRequest };
  });
  app.get("/api/v1/agents", async () => ({
    agents: listAgentIdentities()
  }));
  app.get("/api/v1/agents/onboarding", async (request) => ({
    onboarding: buildAgentOnboardingPayload(request)
  }));
  app.get("/api/v1/agents/:id/actions", async (request) => {
    const { id } = request.params as { id: string };
    return { actions: listAgentActions(id) };
  });
  app.post("/api/v1/agent-actions", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/agent-actions" }
    );
    const input = createAgentActionSchema.parse(request.body ?? {});
    const idempotencyKey = parseIdempotencyKey(
      request.headers as Record<string, unknown>
    );
    const result = createAgentAction(
      input,
      {
        actor: auth.actor,
        source: auth.source,
        token: auth.token ? managers.token.getTokenById(auth.token.id) : null
      },
      idempotencyKey
    );
    reply.code(result.approvalRequest ? 202 : 201);
    return result;
  });
  app.get("/api/v1/rewards/rules", async (request) => {
    requireOperatorSession(request.headers as Record<string, unknown>, {
      route: "/api/v1/rewards/rules"
    });
    return { rules: listRewardRules() };
  });
  app.get("/api/v1/rewards/rules/:id", async (request, reply) => {
    requireOperatorSession(request.headers as Record<string, unknown>, {
      route: "/api/v1/rewards/rules/:id"
    });
    const { id } = request.params as { id: string };
    const rule = getRewardRuleById(id);
    if (!rule) {
      reply.code(404);
      return { error: "Reward rule not found" };
    }
    return { rule };
  });
  app.patch("/api/v1/rewards/rules/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["rewards.manage", "write"],
      { route: "/api/v1/rewards/rules/:id" }
    );
    const { id } = request.params as { id: string };
    const rule = updateRewardRule(
      id,
      updateRewardRuleSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    if (!rule) {
      reply.code(404);
      return { error: "Reward rule not found" };
    }
    return { rule };
  });
  app.get("/api/v1/rewards/ledger", async (request) => {
    requireOperatorSession(request.headers as Record<string, unknown>, {
      route: "/api/v1/rewards/ledger"
    });
    const query = rewardsLedgerQuerySchema.parse(request.query ?? {});
    return { ledger: listRewardLedger(query) };
  });
  app.post("/api/v1/rewards/bonus", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["rewards.manage", "write"],
      { route: "/api/v1/rewards/bonus" }
    );
    const reward = createManualRewardGrant(
      createManualRewardGrantSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    reply.code(201);
    return { reward, metrics: buildXpMetricsPayload() };
  });
  app.post("/api/v1/session-events", async (request, reply) => {
    const auth = requireAuthenticatedActor(
      request.headers as Record<string, unknown>,
      { route: "/api/v1/session-events" }
    );
    const payload = createSessionEventSchema.parse(request.body ?? {});
    const event = recordSessionEvent(payload, {
      actor: auth.actor,
      source: auth.source
    });
    reply.code(201);
    return event;
  });
  app.get("/api/v1/events", async (request) => {
    const query = eventsListQuerySchema.parse(request.query ?? {});
    return { events: listEventLog(query) };
  });
  app.get("/api/v1/reviews/weekly", async () => ({
    review: getWeeklyReviewPayload()
  }));
  app.post("/api/v1/reviews/weekly/finalize", async (request, reply) => {
    const auth = requireAuthenticatedActor(
      request.headers as Record<string, unknown>,
      { route: "/api/v1/reviews/weekly/finalize" }
    );
    const currentReview = getWeeklyReviewPayload();
    const finalized = finalizeWeeklyReviewClosure({
      weekKey: currentReview.weekKey,
      weekStartDate: currentReview.weekStartDate,
      weekEndDate: currentReview.weekEndDate,
      windowLabel: currentReview.windowLabel,
      rewardXp: currentReview.reward.rewardXp,
      actor: auth.actor,
      source: auth.source
    });
    const result = finalizeWeeklyReviewResultSchema.parse({
      closure: finalized.closure,
      reward: finalized.reward,
      review: getWeeklyReviewPayload(),
      metrics: buildXpMetricsPayload()
    });
    reply.code(finalized.created ? 201 : 200);
    return result;
  });
  app.get("/api/v1/settings", async (request) => {
    requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["read", "write"],
      { route: "/api/v1/settings" }
    );
    return { settings: getSettings() };
  });
  app.get("/api/v1/settings/bin", async (request) => {
    requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["read", "write"],
      { route: "/api/v1/settings/bin" }
    );
    return { bin: getSettingsBinPayload() };
  });
  app.post("/api/v1/projects", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/projects" }
    );
    const project = createProject(
      createProjectSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    reply.code(201);
    return { project };
  });
  app.post("/api/v1/strategies", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/strategies"
    });
    const strategy = createStrategy(
      createStrategySchema.parse(request.body ?? {})
    );
    reply.code(201);
    return { strategy };
  });
  app.post("/api/v1/calendar/connections", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/calendar/connections" }
    );
    try {
      const connection = await createCalendarConnection(
        createCalendarConnectionSchema.parse(request.body ?? {}),
        managers.secrets,
        toActivityContext(auth)
      );
      reply.code(201);
      return { connection };
    } catch (error) {
      if (error instanceof CalendarConnectionConflictError) {
        reply.code(409);
        return {
          code: "calendar_connection_duplicate",
          error: error.message,
          existingConnectionId: error.connectionId
        };
      }
      throw error;
    }
  });
  app.patch("/api/v1/calendar/connections/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/calendar/connections/:id" }
    );
    const { id } = request.params as { id: string };
    const patch = updateCalendarConnectionSchema.parse(request.body ?? {});
    try {
      const connection =
        patch.label !== undefined || patch.selectedCalendarUrls !== undefined
          ? await updateCalendarConnectionSelection(
              id,
              {
                label: patch.label,
                selectedCalendarUrls: patch.selectedCalendarUrls
              },
              managers.secrets,
              toActivityContext(auth)
            )
          : getCalendarConnectionById(id);
      if (!connection) {
        reply.code(404);
        return { error: "Calendar connection not found" };
      }
      return {
        connection: listConnectedCalendarConnections().find(
          (entry) => entry.id === id
        )
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Unknown calendar connection")
      ) {
        reply.code(404);
        return { error: "Calendar connection not found" };
      }
      throw error;
    }
  });
  app.post("/api/v1/calendar/connections/:id/sync", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/calendar/connections/:id/sync" }
    );
    const { id } = request.params as { id: string };
    const connection = await syncCalendarConnection(
      id,
      managers.secrets,
      toActivityContext(auth)
    );
    if (!connection) {
      reply.code(404);
      return { error: "Calendar connection not found" };
    }
    return {
      connection: listConnectedCalendarConnections().find(
        (entry) => entry.id === id
      )
    };
  });
  app.delete("/api/v1/calendar/connections/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/calendar/connections/:id" }
    );
    const { id } = request.params as { id: string };
    const connection = await removeCalendarConnection(
      id,
      managers.secrets,
      toActivityContext(auth)
    );
    if (!connection) {
      reply.code(404);
      return { error: "Calendar connection not found" };
    }
    return { connection };
  });
  app.get("/api/v1/calendar/work-block-templates", async (request) => ({
    templates: listWorkBlockTemplates({
      userIds: resolveScopedUserIds(request.query as Record<string, unknown>)
    })
  }));
  app.post("/api/v1/calendar/work-block-templates", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/calendar/work-block-templates" }
    );
    const template = createWorkBlockTemplate(
      createWorkBlockTemplateSchema.parse(request.body ?? {})
    );
    recordActivityEvent({
      entityType: "work_block",
      entityId: template.id,
      eventType: "work_block_created",
      title: `Work block created: ${template.title}`,
      description: "A recurring work block was added to Forge.",
      actor: auth.actor ?? null,
      source: auth.source,
      metadata: {
        kind: template.kind,
        blockingState: template.blockingState
      }
    });
    reply.code(201);
    return { template };
  });
  app.patch(
    "/api/v1/calendar/work-block-templates/:id",
    async (request, reply) => {
      const auth = requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["write"],
        { route: "/api/v1/calendar/work-block-templates/:id" }
      );
      const { id } = request.params as { id: string };
      const template = updateWorkBlockTemplate(
        id,
        updateWorkBlockTemplateSchema.parse(request.body ?? {})
      );
      if (!template) {
        reply.code(404);
        return { error: "Work block template not found" };
      }
      recordActivityEvent({
        entityType: "work_block",
        entityId: template.id,
        eventType: "work_block_updated",
        title: `Work block updated: ${template.title}`,
        description: "The recurring work block was updated.",
        actor: auth.actor ?? null,
        source: auth.source,
        metadata: {
          kind: template.kind,
          blockingState: template.blockingState
        }
      });
      return { template };
    }
  );
  app.delete(
    "/api/v1/calendar/work-block-templates/:id",
    async (request, reply) => {
      const auth = requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["write"],
        { route: "/api/v1/calendar/work-block-templates/:id" }
      );
      const { id } = request.params as { id: string };
      const template = deleteWorkBlockTemplate(id);
      if (!template) {
        reply.code(404);
        return { error: "Work block template not found" };
      }
      recordActivityEvent({
        entityType: "work_block",
        entityId: template.id,
        eventType: "work_block_deleted",
        title: `Work block deleted: ${template.title}`,
        description: "The recurring work block was removed.",
        actor: auth.actor ?? null,
        source: auth.source,
        metadata: {
          kind: template.kind
        }
      });
      return { template };
    }
  );
  app.get("/api/v1/calendar/timeboxes", async (request) => {
    const query = calendarOverviewQuerySchema.parse(request.query ?? {});
    const now = new Date();
    const from =
      query.from ??
      new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const to =
      query.to ??
      new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000).toISOString();
    return {
      timeboxes: listTaskTimeboxes({ from, to, userIds: query.userIds })
    };
  });
  app.post("/api/v1/calendar/timeboxes", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/calendar/timeboxes" }
    );
    const timebox = createTaskTimebox(
      createTaskTimeboxSchema.parse(request.body ?? {})
    );
    recordActivityEvent({
      entityType: "task_timebox",
      entityId: timebox.id,
      eventType: "task_timebox_created",
      title: `Task timebox created: ${timebox.title}`,
      description: "A future work slot was planned in Forge.",
      actor: auth.actor ?? null,
      source: auth.source,
      metadata: {
        taskId: timebox.taskId,
        status: timebox.status
      }
    });
    reply.code(201);
    return { timebox };
  });
  app.patch("/api/v1/calendar/timeboxes/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/calendar/timeboxes/:id" }
    );
    const { id } = request.params as { id: string };
    const timebox = updateTaskTimebox(
      id,
      updateTaskTimeboxSchema.parse(request.body ?? {})
    );
    if (!timebox) {
      reply.code(404);
      return { error: "Task timebox not found" };
    }
    recordActivityEvent({
      entityType: "task_timebox",
      entityId: timebox.id,
      eventType: "task_timebox_updated",
      title: `Task timebox updated: ${timebox.title}`,
      description: "The planned work slot was updated.",
      actor: auth.actor ?? null,
      source: auth.source,
      metadata: {
        taskId: timebox.taskId,
        status: timebox.status
      }
    });
    return { timebox };
  });
  app.delete("/api/v1/calendar/timeboxes/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/calendar/timeboxes/:id" }
    );
    const { id } = request.params as { id: string };
    const timebox = deleteTaskTimebox(id);
    if (!timebox) {
      reply.code(404);
      return { error: "Task timebox not found" };
    }
    recordActivityEvent({
      entityType: "task_timebox",
      entityId: timebox.id,
      eventType: "task_timebox_deleted",
      title: `Task timebox deleted: ${timebox.title}`,
      description: "The planned work slot was removed.",
      actor: auth.actor ?? null,
      source: auth.source,
      metadata: {
        taskId: timebox.taskId
      }
    });
    return { timebox };
  });
  app.post("/api/v1/calendar/timeboxes/recommend", async (request) => {
    const input = recommendTaskTimeboxesSchema.parse(request.body ?? {});
    return {
      timeboxes: suggestTaskTimeboxes(input.taskId, {
        from: input.from,
        to: input.to,
        limit: input.limit
      })
    };
  });
  app.post("/api/v1/calendar/events", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/calendar/events" }
    );
    const event = createCalendarEvent(
      createCalendarEventSchema.parse(request.body ?? {})
    );
    await pushCalendarEventUpdate(event.id, managers.secrets);
    const refreshed = getCalendarEventById(event.id)!;
    recordActivityEvent({
      entityType: "calendar_event",
      entityId: refreshed.id,
      eventType: "calendar_event_created",
      title: `Calendar event created: ${refreshed.title}`,
      description: "A native Forge calendar event was created.",
      actor: auth.actor ?? null,
      source: auth.source,
      metadata: {
        calendarId: refreshed.calendarId,
        originType: refreshed.originType
      }
    });
    reply.code(201);
    return { event: refreshed };
  });
  app.patch("/api/v1/calendar/events/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/calendar/events/:id" }
    );
    const { id } = request.params as { id: string };
    const event = updateCalendarEvent(
      id,
      updateCalendarEventSchema.parse(request.body ?? {})
    );
    if (!event) {
      reply.code(404);
      return { error: "Calendar event not found" };
    }
    await pushCalendarEventUpdate(id, managers.secrets);
    const refreshed = getCalendarEventById(id)!;
    recordActivityEvent({
      entityType: "calendar_event",
      entityId: refreshed.id,
      eventType: "calendar_event_updated",
      title: `Calendar event updated: ${refreshed.title}`,
      description:
        "The Forge calendar event was updated and projected to remote calendars when configured.",
      actor: auth.actor ?? null,
      source: auth.source,
      metadata: {
        calendarId: refreshed.calendarId,
        originType: refreshed.originType
      }
    });
    return { event: refreshed };
  });
  app.delete("/api/v1/calendar/events/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/calendar/events/:id" }
    );
    const { id } = request.params as { id: string };
    const event = deleteCalendarEvent(id);
    if (!event) {
      reply.code(404);
      return { error: "Calendar event not found" };
    }
    await deleteCalendarEventProjection(id, managers.secrets);
    recordActivityEvent({
      entityType: "calendar_event",
      entityId: event.id,
      eventType: "calendar_event_deleted",
      title: `Calendar event deleted: ${event.title}`,
      description:
        "The Forge calendar event was removed and any projected remote copies were deleted.",
      actor: auth.actor ?? null,
      source: auth.source,
      metadata: {
        calendarId: event.calendarId,
        originType: event.originType
      }
    });
    return { event };
  });
  app.post("/api/v1/habits", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/habits" }
    );
    const habit = createHabit(
      parseRequestBody(createHabitSchema, request.body),
      toActivityContext(auth)
    );
    reply.code(201);
    return { habit };
  });
  app.patch("/api/v1/projects/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/projects/:id" }
    );
    const { id } = request.params as { id: string };
    const project = updateProject(
      id,
      updateProjectSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    if (!project) {
      reply.code(404);
      return { error: "Project not found" };
    }
    return { project };
  });
  app.delete("/api/v1/projects/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/projects/:id" }
    );
    const { id } = request.params as { id: string };
    const project = deleteEntity(
      "project",
      id,
      entityDeleteQuerySchema.parse(request.query ?? {}),
      toActivityContext(auth)
    );
    if (!project) {
      reply.code(404);
      return { error: "Project not found" };
    }
    return { project };
  });
  app.patch("/api/v1/strategies/:id", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/strategies/:id"
    });
    const { id } = request.params as { id: string };
    const strategy = updateStrategy(
      id,
      updateStrategySchema.parse(request.body ?? {})
    );
    if (!strategy) {
      reply.code(404);
      return { error: "Strategy not found" };
    }
    return { strategy };
  });
  app.delete("/api/v1/strategies/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/strategies/:id" }
    );
    const { id } = request.params as { id: string };
    const strategy = deleteEntity(
      "strategy",
      id,
      entityDeleteQuerySchema.parse(request.query ?? {}),
      toActivityContext(auth)
    );
    if (!strategy) {
      reply.code(404);
      return { error: "Strategy not found" };
    }
    return { strategy };
  });
  app.patch("/api/v1/habits/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/habits/:id" }
    );
    const { id } = request.params as { id: string };
    const habit = updateHabit(
      id,
      parseRequestBody(updateHabitSchema, request.body),
      toActivityContext(auth)
    );
    if (!habit) {
      reply.code(404);
      return { error: "Habit not found" };
    }
    return { habit };
  });
  app.delete("/api/v1/habits/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/habits/:id" }
    );
    const { id } = request.params as { id: string };
    const habit = deleteEntity(
      "habit",
      id,
      entityDeleteQuerySchema.parse(request.query ?? {}),
      toActivityContext(auth)
    );
    if (!habit) {
      reply.code(404);
      return { error: "Habit not found" };
    }
    return { habit };
  });
  app.post("/api/v1/habits/:id/check-ins", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/habits/:id/check-ins" }
    );
    const { id } = request.params as { id: string };
    const habit = createHabitCheckIn(
      id,
      parseRequestBody(createHabitCheckInSchema, request.body),
      toActivityContext(auth)
    );
    if (!habit) {
      reply.code(404);
      return { error: "Habit not found" };
    }
    return { habit, metrics: buildXpMetricsPayload() };
  });
  app.patch("/api/v1/settings", async (request) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/settings" }
    );
    return {
      settings: updateSettings(
        updateSettingsSchema.parse(request.body ?? {}),
        toActivityContext(auth)
      )
    };
  });
  app.post("/api/v1/settings/tokens", async (request, reply) => {
    const auth = requireOperatorSession(
      request.headers as Record<string, unknown>,
      { route: "/api/v1/settings/tokens" }
    );
    const token = managers.token.issueLocalAgentToken(
      createAgentTokenSchema.parse(request.body ?? {}),
      auth
    );
    reply.code(201);
    return { token };
  });
  app.post("/api/v1/settings/tokens/:id/rotate", async (request, reply) => {
    const auth = requireOperatorSession(
      request.headers as Record<string, unknown>,
      { route: "/api/v1/settings/tokens/:id/rotate" }
    );
    const { id } = request.params as { id: string };
    const token = managers.token.rotateLocalAgentToken(id, auth);
    if (!token) {
      reply.code(404);
      return { error: "Agent token not found" };
    }
    return { token };
  });
  app.post("/api/v1/settings/tokens/:id/revoke", async (request, reply) => {
    const auth = requireOperatorSession(
      request.headers as Record<string, unknown>,
      { route: "/api/v1/settings/tokens/:id/revoke" }
    );
    const { id } = request.params as { id: string };
    const token = managers.token.revokeLocalAgentToken(id, auth);
    if (!token) {
      reply.code(404);
      return { error: "Agent token not found" };
    }
    return { token };
  });
  app.get("/api/v1/task-runs", async (request) => {
    const query = taskRunListQuerySchema.parse(request.query ?? {});
    return { taskRuns: listTaskRuns(query) };
  });
  app.get("/api/v1/events/meta", async () => ({
    events: buildEventStreamMeta()
  }));
  app.get("/api/v1/events/stream", async (request, reply) => {
    reply.hijack();
    reply.raw.write(`retry: 3000\n`);
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    let lastActivityId = listActivityEvents({ limit: 1 })[0]?.id ?? null;
    const emit = (event: string, payload: unknown) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    emit("snapshot", {
      generatedAt: new Date().toISOString(),
      latestActivityId: lastActivityId
    });

    const heartbeat = setInterval(() => {
      emit("heartbeat", { now: new Date().toISOString() });
    }, 15_000);

    const poll = setInterval(() => {
      const latest = listActivityEvents({ limit: 1 })[0] ?? null;
      if (!latest || latest.id === lastActivityId) {
        return;
      }
      lastActivityId = latest.id;
      emit("activity", latest);
    }, 3_000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      clearInterval(poll);
      reply.raw.end();
    });
  });

  app.get("/api/dashboard", async () => getDashboard());
  app.get("/api/context/overview", async (_request, reply) => {
    markCompatibilityRoute(reply);
    return getOverviewContext();
  });
  app.get("/api/context/today", async (_request, reply) => {
    markCompatibilityRoute(reply);
    return getTodayContext();
  });
  app.get("/api/context/risk", async (_request, reply) => {
    markCompatibilityRoute(reply);
    return getRiskContext();
  });
  app.get("/api/goals", async (_request, reply) => {
    markCompatibilityRoute(reply);
    return { goals: listGoals() };
  });
  app.get("/api/tasks", async (request, reply) => {
    markCompatibilityRoute(reply);
    const query = taskListQuerySchema.parse(request.query ?? {});
    return { tasks: listTasks(query) };
  });
  app.get("/api/activity", async (request, reply) => {
    markCompatibilityRoute(reply);
    const query = activityListQuerySchema.parse(request.query ?? {});
    return { activity: listActivityEvents(query) };
  });
  app.get("/api/tags", async (_request, reply) => {
    markCompatibilityRoute(reply);
    return { tags: listTags() };
  });
  app.get("/api/metrics", async (_request, reply) => {
    markCompatibilityRoute(reply);
    return {
      metrics: buildGamificationProfile(listGoals(), listTasks(), listHabits())
    };
  });
  app.get("/api/task-runs", async (request, reply) => {
    markCompatibilityRoute(reply);
    const query = taskRunListQuerySchema.parse(request.query ?? {});
    return { taskRuns: listTaskRuns(query) };
  });
  app.get("/api/task-runs/watchdog", async () => ({
    watchdog: taskRunWatchdog?.getStatus() ?? null
  }));
  app.post("/api/task-runs/watchdog/reconcile", async (_request, reply) => {
    if (!taskRunWatchdog) {
      reply.code(409);
      return {
        code: "task_run_watchdog_disabled",
        error: "Task-run watchdog is disabled for this server instance",
        statusCode: 409
      };
    }

    const recovery = await taskRunWatchdog.reconcileNow();
    return {
      recovery,
      watchdog: taskRunWatchdog.getStatus()
    };
  });
  app.get("/api/openclaw/context", async (request, reply) => {
    markCompatibilityRoute(reply);
    const query = taskListQuerySchema.parse(request.query ?? {});
    return {
      metrics: buildGamificationProfile(listGoals(), listTasks(), listHabits()),
      dashboard: getDashboard(),
      overview: getOverviewContext(),
      today: getTodayContext(),
      risk: getRiskContext(),
      goals: listGoals(),
      projects: listProjectSummaries(),
      tags: listTags(),
      tasks: listTasks(query),
      habits: listHabits(),
      activeTaskRuns: listTaskRuns({ active: true, limit: 25 }),
      activity: listActivityEvents({ limit: 25 })
    };
  });

  app.get("/api/tasks/:id", async (request, reply) => {
    markCompatibilityRoute(reply);
    const { id } = request.params as { id: string };
    const task = getTaskById(id);
    if (!task) {
      reply.code(404);
      return { error: "Task not found" };
    }
    return { task };
  });
  app.get("/api/v1/tasks/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = getTaskById(id);
    if (!task) {
      reply.code(404);
      return { error: "Task not found" };
    }
    return { task };
  });

  app.get("/api/tasks/:id/context", async (request, reply) => {
    markCompatibilityRoute(reply);
    const { id } = request.params as { id: string };
    const task = getTaskById(id);
    if (!task) {
      reply.code(404);
      return { error: "Task not found" };
    }

    const taskRuns = listTaskRuns({ taskId: id, limit: 10 });
    return taskContextPayloadSchema.parse({
      task,
      goal: task.goalId ? (getGoalById(task.goalId) ?? null) : null,
      project: task.projectId
        ? (listProjectSummaries().find(
            (project) => project.id === task.projectId
          ) ?? null)
        : null,
      activeTaskRun: taskRuns.find((run) => run.status === "active") ?? null,
      taskRuns,
      activity: listActivityEventsForTask(id, 20),
      notesSummaryByEntity: buildNotesSummaryByEntity()
    });
  });
  app.get("/api/v1/tasks/:id/context", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = getTaskById(id);
    if (!task) {
      reply.code(404);
      return { error: "Task not found" };
    }

    const taskRuns = listTaskRuns({ taskId: id, limit: 10 });
    return taskContextPayloadSchema.parse({
      task,
      goal: task.goalId ? (getGoalById(task.goalId) ?? null) : null,
      project: task.projectId
        ? (listProjectSummaries().find(
            (project) => project.id === task.projectId
          ) ?? null)
        : null,
      activeTaskRun: taskRuns.find((run) => run.status === "active") ?? null,
      taskRuns,
      activity: listActivityEventsForTask(id, 20),
      notesSummaryByEntity: buildNotesSummaryByEntity()
    });
  });

  app.post("/api/goals", async (request, reply) => {
    markCompatibilityRoute(reply);
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/goals" }
    );
    const goal = createGoal(
      createGoalSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    reply.code(201);
    return { goal };
  });
  app.post("/api/v1/goals", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/goals" }
    );
    const goal = createGoal(
      createGoalSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    reply.code(201);
    return { goal };
  });

  app.patch("/api/goals/:id", async (request, reply) => {
    markCompatibilityRoute(reply);
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/goals/:id" }
    );
    const { id } = request.params as { id: string };
    const goal = updateGoal(
      id,
      updateGoalSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    if (!goal) {
      reply.code(404);
      return { error: "Goal not found" };
    }
    return { goal };
  });
  app.patch("/api/v1/goals/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/goals/:id" }
    );
    const { id } = request.params as { id: string };
    const goal = updateGoal(
      id,
      updateGoalSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    if (!goal) {
      reply.code(404);
      return { error: "Goal not found" };
    }
    return { goal };
  });
  app.delete("/api/v1/goals/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/goals/:id" }
    );
    const { id } = request.params as { id: string };
    const goal = deleteEntity(
      "goal",
      id,
      entityDeleteQuerySchema.parse(request.query ?? {}),
      toActivityContext(auth)
    );
    if (!goal) {
      reply.code(404);
      return { error: "Goal not found" };
    }
    return { goal };
  });

  app.post("/api/tags", async (request, reply) => {
    markCompatibilityRoute(reply);
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/tags" }
    );
    const tag = createTag(
      createTagSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    reply.code(201);
    return { tag };
  });
  app.post("/api/v1/tags", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/tags" }
    );
    const tag = createTag(
      createTagSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    reply.code(201);
    return { tag };
  });
  app.patch("/api/v1/tags/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/tags/:id" }
    );
    const { id } = request.params as { id: string };
    const tag = updateTag(
      id,
      updateTagSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    if (!tag) {
      reply.code(404);
      return { error: "Tag not found" };
    }
    return { tag };
  });
  app.delete("/api/v1/tags/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/tags/:id" }
    );
    const { id } = request.params as { id: string };
    const tag = deleteEntity(
      "tag",
      id,
      entityDeleteQuerySchema.parse(request.query ?? {}),
      toActivityContext(auth)
    );
    if (!tag) {
      reply.code(404);
      return { error: "Tag not found" };
    }
    return { tag };
  });

  app.post("/api/tasks", async (request, reply) => {
    markCompatibilityRoute(reply);
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/tasks" }
    );
    const input = createTaskSchema.parse(request.body ?? {});
    const idempotencyKey = parseIdempotencyKey(
      request.headers as Record<string, unknown>
    );
    const activity = toActivityContext(auth);
    const result = idempotencyKey
      ? createTaskWithIdempotency(input, idempotencyKey, activity)
      : { task: createTask(input, activity), replayed: false };
    if (result.replayed) {
      reply.code(200).header("Idempotency-Replayed", "true");
    } else {
      reply.code(201);
    }
    return { task: result.task };
  });
  app.post("/api/v1/tasks", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/tasks" }
    );
    const input = createTaskSchema.parse(request.body ?? {});
    const idempotencyKey = parseIdempotencyKey(
      request.headers as Record<string, unknown>
    );
    const activity = toActivityContext(auth);
    const result = idempotencyKey
      ? createTaskWithIdempotency(input, idempotencyKey, activity)
      : { task: createTask(input, activity), replayed: false };
    if (result.replayed) {
      reply.code(200).header("Idempotency-Replayed", "true");
    } else {
      reply.code(201);
    }
    return { task: result.task };
  });

  app.post("/api/tasks/:id/runs", async (request, reply) => {
    markCompatibilityRoute(reply);
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/tasks/:id/runs" }
    );
    const { id } = request.params as { id: string };
    const input = taskRunClaimSchema.parse(request.body ?? {});
    const result = claimTaskRun(id, input, new Date(), toActivityContext(auth));
    reply.code(result.replayed ? 200 : 201);
    if (result.replayed) {
      reply.header("Task-Run-Replayed", "true");
    }
    return { taskRun: result.run };
  });
  app.post("/api/v1/tasks/:id/runs", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/tasks/:id/runs" }
    );
    const { id } = request.params as { id: string };
    const input = taskRunClaimSchema.parse(request.body ?? {});
    const result = claimTaskRun(id, input, new Date(), toActivityContext(auth));
    reply.code(result.replayed ? 200 : 201);
    if (result.replayed) {
      reply.header("Task-Run-Replayed", "true");
    }
    return { taskRun: result.run };
  });

  app.patch("/api/tasks/:id", async (request, reply) => {
    markCompatibilityRoute(reply);
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/tasks/:id" }
    );
    const { id } = request.params as { id: string };
    const task = updateTask(
      id,
      updateTaskSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    if (!task) {
      reply.code(404);
      return { error: "Task not found" };
    }
    return { task };
  });
  app.patch("/api/v1/tasks/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/tasks/:id" }
    );
    const { id } = request.params as { id: string };
    const task = updateTask(
      id,
      updateTaskSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    if (!task) {
      reply.code(404);
      return { error: "Task not found" };
    }
    return { task };
  });
  app.delete("/api/v1/tasks/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/tasks/:id" }
    );
    const { id } = request.params as { id: string };
    const task = deleteEntity(
      "task",
      id,
      entityDeleteQuerySchema.parse(request.query ?? {}),
      toActivityContext(auth)
    );
    if (!task) {
      reply.code(404);
      return { error: "Task not found" };
    }
    return { task };
  });
  app.post("/api/v1/operator/log-work", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write", "rewards.manage"],
      { route: "/api/v1/operator/log-work" }
    );
    const input = operatorLogWorkSchema.parse(request.body ?? {});

    if (input.taskId) {
      const task = updateTask(
        input.taskId,
        {
          title:
            input.title && input.title.trim().length > 0
              ? input.title
              : undefined,
          description:
            typeof input.description === "string"
              ? input.description
              : input.summary.trim().length > 0
                ? input.summary
                : undefined,
          goalId: input.goalId,
          projectId: input.projectId,
          owner: input.owner,
          status: input.status ?? "done",
          priority: input.priority,
          dueDate: input.dueDate,
          effort: input.effort,
          energy: input.energy,
          points: input.points,
          tagIds: input.tagIds,
          notes: input.closeoutNote ? [input.closeoutNote] : undefined
        },
        toActivityContext(auth)
      );
      if (!task) {
        reply.code(404);
        return { error: "Task not found" };
      }
      return { task, xp: buildXpMetricsPayload() };
    }

    const task = createTask(
      createTaskSchema.parse({
        title: input.title,
        description:
          typeof input.description === "string"
            ? input.description
            : input.summary.trim().length > 0
              ? input.summary
              : "",
        goalId: input.goalId ?? null,
        projectId: input.projectId ?? null,
        owner: input.owner ?? "Albert",
        status: input.status ?? "done",
        priority: input.priority ?? "medium",
        dueDate: input.dueDate ?? null,
        effort: input.effort ?? "deep",
        energy: input.energy ?? "steady",
        points: input.points ?? 40,
        tagIds: input.tagIds ?? [],
        notes: input.closeoutNote ? [input.closeoutNote] : []
      }),
      toActivityContext(auth)
    );

    reply.code(201);
    return { task, xp: buildXpMetricsPayload() };
  });
  app.post("/api/v1/work-adjustments", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write", "rewards.manage"],
      { route: "/api/v1/work-adjustments" }
    );
    const input = createWorkAdjustmentSchema.parse(request.body ?? {});
    const currentTarget = resolveWorkAdjustmentTarget(
      input.entityType,
      input.entityId
    );

    if (!currentTarget) {
      reply.code(404);
      return {
        error: `${input.entityType === "task" ? "Task" : "Project"} not found`
      };
    }

    const appliedDeltaMinutes = clampWorkAdjustmentMinutes(
      input.deltaMinutes,
      currentTarget.time.totalCreditedSeconds
    );
    const nextCreditedSeconds = Math.max(
      0,
      currentTarget.time.totalCreditedSeconds + appliedDeltaMinutes * 60
    );

    const result = runInTransaction(() => {
      const adjustment = createWorkAdjustment(
        {
          ...input,
          appliedDeltaMinutes
        },
        toActivityContext(auth)
      );
      const reward = recordWorkAdjustmentReward({
        entityType: input.entityType,
        entityId: input.entityId,
        targetTitle: currentTarget.title,
        actor: auth.actor ?? null,
        source: auth.source,
        requestedDeltaMinutes: input.deltaMinutes,
        appliedDeltaMinutes,
        previousCreditedSeconds: currentTarget.time.totalCreditedSeconds,
        nextCreditedSeconds,
        adjustmentId: adjustment.id
      });
      const copy = describeWorkAdjustment({
        entityType: input.entityType,
        targetTitle: currentTarget.title,
        requestedDeltaMinutes: input.deltaMinutes,
        appliedDeltaMinutes
      });
      recordActivityEvent({
        entityType: input.entityType,
        entityId: input.entityId,
        eventType: "work_adjusted",
        title: copy.title,
        description: copy.description,
        actor: auth.actor ?? null,
        source: auth.source,
        metadata: {
          adjustmentId: adjustment.id,
          requestedDeltaMinutes: input.deltaMinutes,
          appliedDeltaMinutes,
          rewardDeltaXp: reward?.deltaXp ?? 0,
          rewardId: reward?.id ?? null,
          note: input.note || null
        }
      });

      return { adjustment, reward };
    });

    const updatedTarget = resolveWorkAdjustmentTarget(
      input.entityType,
      input.entityId
    );
    if (!updatedTarget) {
      throw new HttpError(
        500,
        "work_adjustment_target_missing",
        `Could not reload ${input.entityType} ${input.entityId} after adjustment`
      );
    }

    reply.code(201);
    return workAdjustmentResultSchema.parse({
      adjustment: result.adjustment,
      target: updatedTarget,
      reward: result.reward,
      metrics: buildXpMetricsPayload()
    });
  });
  app.post("/api/v1/tasks/:id/uncomplete", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/tasks/:id/uncomplete" }
    );
    const { id } = request.params as { id: string };
    uncompleteTaskSchema.parse(request.body ?? {});
    const task = uncompleteTask(id, toActivityContext(auth));
    if (!task) {
      reply.code(404);
      return { error: "Task not found" };
    }
    return { task };
  });
  app.post("/api/v1/entities/create", async (request) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/entities/create" }
    );
    const result = createEntities(
      batchCreateEntitiesSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    await applyBatchCalendarEntityEffects(result.results, auth, "create");
    return result;
  });
  app.post("/api/v1/entities/update", async (request) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/entities/update" }
    );
    const result = updateEntities(
      batchUpdateEntitiesSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    await applyBatchCalendarEntityEffects(result.results, auth, "update");
    return result;
  });
  app.post("/api/v1/entities/delete", async (request) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/entities/delete" }
    );
    const result = deleteEntities(
      batchDeleteEntitiesSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    await applyBatchCalendarEntityEffects(result.results, auth, "delete");
    return result;
  });
  app.post("/api/v1/entities/restore", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/entities/restore"
    });
    return restoreEntities(
      batchRestoreEntitiesSchema.parse(request.body ?? {})
    );
  });
  app.post("/api/v1/entities/search", async (request) => {
    requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["read", "write"],
      { route: "/api/v1/entities/search" }
    );
    return searchEntities(batchSearchEntitiesSchema.parse(request.body ?? {}));
  });

  app.post("/api/task-runs/recover", async (request, reply) => {
    markCompatibilityRoute(reply);
    const payload = taskRunListQuerySchema
      .pick({ limit: true })
      .parse(request.body ?? {});
    return { timedOutRuns: recoverTimedOutTaskRuns({ limit: payload.limit }) };
  });

  app.post("/api/task-runs/:id/heartbeat", async (request, reply) => {
    markCompatibilityRoute(reply);
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/task-runs/:id/heartbeat" }
    );
    const { id } = request.params as { id: string };
    const input = taskRunHeartbeatSchema.parse(request.body ?? {});
    return {
      taskRun: heartbeatTaskRun(id, input, new Date(), toActivityContext(auth))
    };
  });
  app.post("/api/v1/task-runs/:id/heartbeat", async (request) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/task-runs/:id/heartbeat" }
    );
    const { id } = request.params as { id: string };
    const input = taskRunHeartbeatSchema.parse(request.body ?? {});
    return {
      taskRun: heartbeatTaskRun(id, input, new Date(), toActivityContext(auth))
    };
  });

  app.post("/api/task-runs/:id/focus", async (request, reply) => {
    markCompatibilityRoute(reply);
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/task-runs/:id/focus" }
    );
    const { id } = request.params as { id: string };
    const input = taskRunFocusSchema.parse(request.body ?? {});
    return {
      taskRun: focusTaskRun(id, input, new Date(), toActivityContext(auth))
    };
  });
  app.post("/api/v1/task-runs/:id/focus", async (request) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/task-runs/:id/focus" }
    );
    const { id } = request.params as { id: string };
    const input = taskRunFocusSchema.parse(request.body ?? {});
    return {
      taskRun: focusTaskRun(id, input, new Date(), toActivityContext(auth))
    };
  });

  app.post("/api/task-runs/:id/complete", async (request, reply) => {
    markCompatibilityRoute(reply);
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/task-runs/:id/complete" }
    );
    const { id } = request.params as { id: string };
    const input = taskRunFinishSchema.parse(request.body ?? {});
    return {
      taskRun: completeTaskRun(id, input, new Date(), toActivityContext(auth))
    };
  });
  app.post("/api/v1/task-runs/:id/complete", async (request) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/task-runs/:id/complete" }
    );
    const { id } = request.params as { id: string };
    const input = taskRunFinishSchema.parse(request.body ?? {});
    return {
      taskRun: completeTaskRun(id, input, new Date(), toActivityContext(auth))
    };
  });

  app.post("/api/task-runs/:id/release", async (request, reply) => {
    markCompatibilityRoute(reply);
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/task-runs/:id/release" }
    );
    const { id } = request.params as { id: string };
    const input = taskRunFinishSchema.parse(request.body ?? {});
    return {
      taskRun: releaseTaskRun(id, input, new Date(), toActivityContext(auth))
    };
  });
  app.post("/api/v1/task-runs/:id/release", async (request) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/task-runs/:id/release" }
    );
    const { id } = request.params as { id: string };
    const input = taskRunFinishSchema.parse(request.body ?? {});
    return {
      taskRun: releaseTaskRun(id, input, new Date(), toActivityContext(auth))
    };
  });

  app.post("/api/tags/suggestions", async (request, reply) => {
    markCompatibilityRoute(reply);
    const payload = tagSuggestionRequestSchema.parse(request.body ?? {});
    return {
      suggestions: suggestTags(payload)
    };
  });

  await registerWebRoutes(app);
  await taskRunWatchdog?.start();
  return app;
}
