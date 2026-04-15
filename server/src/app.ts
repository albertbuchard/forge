import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { CronExpressionParser } from "cron-parser";
import { z, ZodError } from "zod";
import {
  configureDatabase,
  configureDatabaseSeeding,
  getEffectiveDataRoot,
  resolveDataDir,
  resolveDatabasePathForDataRoot,
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
import {
  createAiConnector,
  deleteAiConnector,
  getAiConnectorById,
  getAiConnectorRunById,
  getAiConnectorRunNodeResult,
  getAiConnectorRunNodeResults,
  getLatestAiConnectorNodeOutput,
  getAiConnectorBySlug,
  getAiConnectorConversationForConnector,
  listAiConnectorRuns,
  listAiConnectors,
  runAiConnector,
  updateAiConnector
} from "./repositories/ai-connectors.js";
import {
  createAiProcessor,
  createAiProcessorLink,
  deleteAiProcessor,
  deleteAiProcessorLink,
  getAiProcessorById,
  getAiProcessorBySlug,
  listAiProcessors,
  getSurfaceProcessorGraph,
  runAiProcessor,
  updateAiProcessor
} from "./repositories/ai-processors.js";
import { listEventLog } from "./repositories/event-log.js";
import {
  createDiagnosticMessage,
  DIAGNOSTIC_LOG_RETENTION_SWEEP_INTERVAL_MS,
  enforceDiagnosticLogRetention,
  listDiagnosticLogs,
  normalizeDiagnosticSource,
  recordDiagnosticLog,
  serializeDiagnosticError
} from "./repositories/diagnostic-logs.js";
import {
  createGoal,
  getGoalById,
  listGoals,
  updateGoal
} from "./repositories/goals.js";
import {
  getSurfaceLayout,
  resetSurfaceLayout,
  saveSurfaceLayout
} from "./repositories/surface-layouts.js";
import {
  buildConnectorOutputCatalogEntry,
  listForgeBoxCatalog
} from "./connectors/box-registry.js";
import {
  createHabit,
  createHabitCheckIn,
  deleteHabitCheckIn,
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
  createUploadedWikiIngestJob,
  createWikiSpace,
  createWikiSpaceSchema,
  deleteWikiIngestJob,
  deleteWikiProfile,
  getWikiHealth,
  getWikiIngestJob,
  getWikiHomePageDetail,
  getWikiPageDetail,
  getWikiPageDetailBySlug,
  getWikiSettingsPayload,
  ingestWikiSource,
  listWikiIngestJobs,
  listWikiLlmProfiles,
  listWikiPageTree,
  listWikiPages,
  listWikiSpaces,
  processWikiIngestJob,
  reindexWikiEmbeddings,
  reindexWikiEmbeddingsSchema,
  rerunWikiIngestJob,
  reviewWikiIngestJob,
  reviewWikiIngestJobSchema,
  searchWikiPages,
  syncWikiVaultFromDisk,
  syncWikiVaultSchema,
  testWikiLlmProfileSchema,
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
import {
  cloneQuestionnaireInstrument,
  completeQuestionnaireRun,
  createQuestionnaireInstrument,
  deleteQuestionnaireInstrument,
  ensureQuestionnaireDraftVersion,
  getQuestionnaireInstrumentDetail,
  getQuestionnaireRunDetail,
  listQuestionnaireInstruments,
  publishQuestionnaireDraftVersion,
  startQuestionnaireRun,
  updateQuestionnaireInstrument,
  updateQuestionnaireInstrumentSchema,
  updateQuestionnaireDraftVersion,
  updateQuestionnaireRun
} from "./repositories/questionnaires.js";
import { createProject, updateProject } from "./repositories/projects.js";
import {
  createPreferenceCatalog,
  createPreferenceCatalogItem,
  createPreferenceContext,
  createPreferenceItem,
  createPreferenceItemFromEntity,
  deletePreferenceCatalog,
  deletePreferenceCatalogItem,
  deletePreferenceContext,
  deletePreferenceItem,
  getPreferenceCatalogById,
  getPreferenceCatalogItemById,
  getPreferenceContextById,
  getPreferenceItemById,
  getPreferenceWorkspace,
  listPreferenceCatalogItems,
  listPreferenceCatalogs,
  listPreferenceContexts,
  listPreferenceItems,
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
  buildKnowledgeGraph,
  buildKnowledgeGraphFocus
} from "./services/knowledge-graph.js";
import type {
  KnowledgeGraphEntityType,
  KnowledgeGraphQuery
} from "../../src/lib/knowledge-graph-types.js";
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
  getSettingsFileStatus,
  listAgentIdentities,
  getSettings,
  isPsycheAuthRequired,
  mirrorSettingsFileFromCurrentState,
  updateSettings,
  verifyAgentToken
} from "./repositories/settings.js";
import {
  deleteAiModelConnection,
  getAiModelConnectionById,
  readModelConnectionCredential,
  upsertAiModelConnection
} from "./repositories/model-settings.js";
import {
  createTag,
  getTagById,
  listTags,
  updateTag
} from "./repositories/tags.js";
import {
  createUser,
  ensureSystemUsers,
  getDefaultUser,
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
  splitTask,
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
  getTaskTimeboxById,
  getWorkBlockTemplateById,
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
  buildLifeForcePayload,
  createFatigueSignal,
  listLifeForceTemplates,
  resolveLifeForceUser,
  updateLifeForceProfile,
  updateLifeForceTemplate
} from "./services/life-force.js";
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
  exportPsycheObservationCalendar,
  getPsycheObservationCalendar
} from "./services/psyche-observation-calendar.js";
import {
  getProjectBoard,
  getProjectSummary,
  listProjectSummaries
} from "./services/projects.js";
import {
  createDataBackup,
  exportData,
  getDataManagementState,
  maybeRunAutomaticBackup,
  restoreDataBackup,
  scanForDataRecoveryCandidates,
  switchDataRoot,
  updateDataManagementSettings
} from "./services/data-management.js";
import { getWeeklyReviewPayload } from "./services/reviews.js";
import { finalizeWeeklyReviewClosure } from "./repositories/weekly-reviews.js";
import {
  createTaskRunWatchdog,
  type TaskRunWatchdogOptions
} from "./services/task-run-watchdog.js";
import { suggestTags } from "./services/tagging.js";
import {
  CalendarConnectionConflictError,
  CalendarConnectionOverlapError,
  completeGoogleCalendarOauth,
  completeMicrosoftCalendarOauth,
  createCalendarConnection,
  discoverMacOSLocalCalendarSources,
  deleteCalendarEventProjection,
  discoverCalendarConnection,
  discoverExistingCalendarConnection,
  getGoogleCalendarOauthSession,
  getMacOSLocalCalendarAccessStatus,
  getMicrosoftCalendarOauthSession,
  listConnectedCalendarConnections,
  removeCalendarConnection,
  requestMacOSLocalCalendarAccess,
  pushCalendarEventUpdate,
  readCalendarOverview,
  syncCalendarConnection,
  startGoogleCalendarOauth,
  startMicrosoftCalendarOauth,
  testMicrosoftCalendarOauthConfiguration,
  listCalendarProviderMetadata,
  updateCalendarConnectionSelection
} from "./services/calendar-runtime.js";
import {
  consumeOpenAiCodexOauthCredentials,
  getOpenAiCodexOauthSession,
  startOpenAiCodexOauthSession,
  submitOpenAiCodexOauthManualInput
} from "./services/openai-codex-oauth.js";
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
  createQuestionnaireInstrumentSchema,
  publishQuestionnaireVersionSchema,
  startQuestionnaireRunSchema,
  updateQuestionnaireRunSchema,
  updateQuestionnaireVersionSchema
} from "./questionnaire-types.js";
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
  createDataBackupSchema,
  dataExportQuerySchema,
  restoreDataBackupSchema,
  switchDataRootSchema,
  updateDataManagementSettingsSchema
} from "./data-management-types.js";
import {
  activityListQuerySchema,
  activitySourceSchema,
  createAgentActionSchema,
  createAgentTokenSchema,
  createAiConnectorSchema,
  createAiProcessorLinkSchema,
  createAiProcessorSchema,
  runAiConnectorSchema,
  writeSurfaceLayoutSchema,
  upsertAiModelConnectionSchema,
  testAiModelConnectionSchema,
  submitOpenAiCodexOauthManualCodeSchema,
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
  createDiagnosticLogSchema,
  discoverCalendarConnectionSchema,
  startGoogleCalendarOauthSchema,
  startMicrosoftCalendarOauthSchema,
  testMicrosoftCalendarOauthConfigurationSchema,
  createHabitSchema,
  createTaskTimeboxSchema,
  createWorkBlockTemplateSchema,
  createSessionEventSchema,
  createWorkAdjustmentSchema,
  createTagSchema,
  calendarOverviewQuerySchema,
  psycheObservationCalendarExportQuerySchema,
  notesListQuerySchema,
  updateTagSchema,
  createTaskSchema,
  diagnosticLogListQuerySchema,
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
  taskSplitCreateSchema,
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
  lifeForceProfilePatchSchema,
  lifeForceTemplateUpdateSchema,
  fatigueSignalCreateSchema,
  updateUserAccessGrantSchema,
  updateWorkBlockTemplateSchema,
  updateAiConnectorSchema,
  updateAiProcessorSchema,
  runAiProcessorSchema,
  workAdjustmentResultSchema,
  finalizeWeeklyReviewResultSchema,
  goalListQuerySchema,
  recommendTaskTimeboxesSchema,
  strategyListQuerySchema,
  type Note,
  type CrudEntityType,
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
  createSleepSession,
  createSleepSessionSchema,
  createWorkoutSession,
  createWorkoutSessionSchema,
  deleteSleepSession,
  deleteWorkoutSession,
  getCompanionPairingSessionById,
  getCompanionOverview,
  getFitnessViewData,
  getSleepSessionById,
  getSleepSessionDetailById,
  getSleepViewData,
  getVitalsViewData,
  getWorkoutSessionById,
  ingestMobileHealthSync,
  mobileHealthSyncSchema,
  patchCompanionPairingSourceState,
  patchCompanionPairingSourceStateSchema,
  companionSourceKeySchema,
  requireValidPairing,
  revokeAllCompanionPairingSessions,
  revokeAllCompanionPairingSessionsSchema,
  revokeCompanionPairingSession,
  updateMobileCompanionSourceState,
  updateMobileCompanionSourceStateSchema,
  verifyCompanionPairing,
  verifyCompanionPairingSchema,
  updateSleepMetadata,
  updateSleepMetadataSchema,
  updateWorkoutMetadata,
  updateWorkoutMetadataSchema
} from "./health.js";
import {
  analyzeMovementUserBoxPreflight,
  createMovementUserBox,
  createMovementPlace,
  deleteMovementUserBox,
  getMovementAllTimeSummary,
  getMovementBoxDetail,
  getMovementDayDetail,
  getMovementMobileBootstrap,
  getMovementTimeline,
  getMovementSelectionAggregate,
  getMovementSettings,
  getMovementTripDetail,
  getMovementMonthSummary,
  invalidateAutomaticMovementBox,
  listMovementPlaces,
  movementAutomaticBoxInvalidateSchema,
  movementMobileBootstrapSchema,
  movementMobilePlaceMutationSchema,
  movementMobileUserBoxCreateSchema,
  movementMobileUserBoxPreflightSchema,
  movementMobileUserBoxPatchSchema,
  movementMobileAutomaticBoxInvalidateSchema,
  movementMobileTimelineSchema,
  movementPlaceMutationSchema,
  movementPlacePatchSchema,
  movementSelectionAggregateSchema,
  movementStayPatchSchema,
  movementTripPatchSchema,
  movementUserBoxCreateSchema,
  movementUserBoxPreflightSchema,
  movementUserBoxPatchSchema,
  movementSettingsPatchSchema,
  movementTimelineQuerySchema,
  movementTripPointPatchSchema,
  deleteMovementStay,
  deleteMovementTrip,
  deleteMovementTripPoint,
  updateMovementPlace,
  updateMovementSettings,
  updateMovementStay,
  updateMovementTrip,
  updateMovementUserBox,
  updateMovementTripPoint,
  resolveMovementTimelineSegmentForBox
} from "./movement.js";
import {
  getScreenTimeAllTimeSummary,
  getScreenTimeDayDetail,
  getScreenTimeMonthSummary,
  getScreenTimeSettings,
  screenTimeSettingsPatchSchema,
  updateScreenTimeSettings
} from "./screen-time.js";
import {
  assertWatchReady,
  buildWatchBootstrap,
  ingestWatchCaptureBatch,
  mobileWatchBootstrapSchema,
  mobileWatchCaptureBatchSchema,
  mobileWatchHabitCheckInSchema
} from "./watch-mobile.js";

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
      return `${url.origin}/api/v1`;
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

const AGENT_ONBOARDING_ENTITY_CATALOG_BASE = [
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

const AGENT_ONBOARDING_BATCH_ROUTE_BASES = {
  goal: "/api/v1/goals",
  project: "/api/v1/projects",
  task: "/api/v1/tasks",
  strategy: "/api/v1/strategies",
  habit: "/api/v1/habits",
  tag: "/api/v1/tags",
  note: "/api/v1/notes",
  insight: "/api/v1/insights",
  calendar_event: "/api/v1/calendar/events",
  work_block_template: "/api/v1/calendar/work-block-templates",
  task_timebox: "/api/v1/calendar/timeboxes",
  sleep_session: "/api/v1/health/sleep",
  workout_session: "/api/v1/health/workouts",
  psyche_value: "/api/v1/psyche/values",
  behavior_pattern: "/api/v1/psyche/patterns",
  behavior: "/api/v1/psyche/behaviors",
  belief_entry: "/api/v1/psyche/beliefs",
  mode_profile: "/api/v1/psyche/modes",
  mode_guide_session: "/api/v1/psyche/mode-guides",
  event_type: "/api/v1/psyche/event-types",
  emotion_definition: "/api/v1/psyche/emotions",
  trigger_report: "/api/v1/psyche/reports",
  preference_catalog: "/api/v1/preferences/catalogs",
  preference_catalog_item: "/api/v1/preferences/catalog-items",
  preference_context: "/api/v1/preferences/contexts",
  preference_item: "/api/v1/preferences/items",
  questionnaire_instrument: "/api/v1/psyche/questionnaires"
} as const satisfies Record<string, string>;

type OnboardingEntityClassification =
  | "batch_crud_entity"
  | "specialized_crud_entity"
  | "action_workflow_entity"
  | "specialized_domain_surface"
  | "read_model_only_surface";

function classifyOnboardingEntity(
  entityType: string
): OnboardingEntityClassification {
  if (entityType in AGENT_ONBOARDING_BATCH_ROUTE_BASES) {
    return "batch_crud_entity";
  }
  if (entityType === "wiki_page" || entityType === "calendar_connection") {
    return "specialized_crud_entity";
  }
  if (
    entityType === "movement" ||
    entityType === "life_force" ||
    entityType === "workbench"
  ) {
    return "specialized_domain_surface";
  }
  if (
    entityType === "task_run" ||
    entityType === "questionnaire_run" ||
    entityType === "preference_judgment" ||
    entityType === "preference_signal" ||
    entityType === "work_adjustment"
  ) {
    return "action_workflow_entity";
  }
  return "read_model_only_surface";
}

function buildPreferredMutationPath(entityType: string) {
  if (entityType in AGENT_ONBOARDING_BATCH_ROUTE_BASES) {
    return "/api/v1/entities/create | /api/v1/entities/update | /api/v1/entities/delete | /api/v1/entities/search";
  }
  switch (entityType) {
    case "wiki_page":
      return "Use /api/v1/wiki/pages with POST or PATCH for page CRUD.";
    case "calendar_connection":
      return "Use /api/v1/calendar/connections plus provider-specific setup flows.";
    case "task_run":
      return "Use the task-run action routes to start, heartbeat, focus, complete, or release live work.";
    case "questionnaire_run":
      return "Use the questionnaire-run action routes to start, patch answers, and complete the run.";
    case "preference_judgment":
      return "Use /api/v1/preferences/judgments to record one pairwise comparison.";
    case "preference_signal":
      return "Use /api/v1/preferences/signals to record one direct signal such as favorite or veto.";
    case "work_adjustment":
      return "Use /api/v1/work-adjustments to apply an explicit operator adjustment.";
    case "movement":
      return "Use the dedicated Movement route family for day, month, all-time, timeline, places, trip detail, selection aggregates, overlays, and repair actions.";
    case "life_force":
      return "Use the dedicated Life Force route family for overview, profile edits, weekday templates, and fatigue signals.";
    case "workbench":
      return "Use the dedicated Workbench route family for flow CRUD, execution, run history, published outputs, node results, and latest-node-output reads.";
    case "self_observation":
      return "Read the calendar surface; mutate it by creating or updating note-backed observations with frontmatter.observedAt.";
    case "sleep_overview":
      return "Read-only surface. Use batch CRUD for sleep_session records or the review enrichment route for reflective notes.";
    case "sports_overview":
      return "Read-only surface. Use batch CRUD for workout_session records or the review enrichment route for reflective notes.";
    default:
      return "Read-only surface.";
  }
}

function buildPreferredReadPath(entityType: string) {
  if (entityType in AGENT_ONBOARDING_BATCH_ROUTE_BASES) {
    return AGENT_ONBOARDING_BATCH_ROUTE_BASES[
      entityType as keyof typeof AGENT_ONBOARDING_BATCH_ROUTE_BASES
    ];
  }
  switch (entityType) {
    case "wiki_page":
      return "/api/v1/wiki/pages/:id";
    case "calendar_connection":
      return "/api/v1/calendar/connections";
    case "task_run":
      return "/api/v1/operator/context";
    case "questionnaire_run":
      return "/api/v1/psyche/questionnaire-runs/:id";
    case "preference_judgment":
    case "preference_signal":
      return "/api/v1/preferences/workspace";
    case "work_adjustment":
      return "/api/v1/operator/context";
    case "movement":
      return "/api/v1/movement/timeline";
    case "life_force":
      return "/api/v1/life-force";
    case "workbench":
      return "/api/v1/workbench/flows";
    case "self_observation":
      return "/api/v1/psyche/self-observation/calendar";
    case "sleep_overview":
      return "/api/v1/health/sleep";
    case "sports_overview":
      return "/api/v1/health/fitness";
    default:
      return null;
  }
}

function enrichOnboardingEntityGuide<
  T extends {
    entityType: string;
    purpose: string;
    minimumCreateFields: readonly string[];
    relationshipRules: readonly string[];
    searchHints: readonly string[];
    fieldGuide: readonly unknown[];
    examples?: readonly string[];
  }
>(entry: T) {
  const classification = classifyOnboardingEntity(entry.entityType);
  return {
    ...entry,
    classification,
    routeBase:
      classification === "batch_crud_entity"
        ? AGENT_ONBOARDING_BATCH_ROUTE_BASES[
            entry.entityType as keyof typeof AGENT_ONBOARDING_BATCH_ROUTE_BASES
          ]
        : null,
    preferredMutationPath: buildPreferredMutationPath(entry.entityType),
    preferredReadPath: buildPreferredReadPath(entry.entityType),
    preferredMutationTool:
      classification === "batch_crud_entity"
        ? "forge_create_entities | forge_update_entities | forge_delete_entities | forge_search_entities"
        : classification === "specialized_domain_surface"
          ? "Follow forge_get_agent_onboarding.entityRouteModel.specializedDomainSurfaces for the dedicated route family."
        : null
  };
}

const AGENT_ONBOARDING_ENTITY_CATALOG = [
  ...AGENT_ONBOARDING_ENTITY_CATALOG_BASE.map(enrichOnboardingEntityGuide),
  enrichOnboardingEntityGuide({
    entityType: "tag",
    purpose:
      "A shared classification label used across Forge entities and notes.",
    minimumCreateFields: ["label"],
    relationshipRules: [
      "Tags are simple reusable labels, not a substitute for richer entity links.",
      "They use batch CRUD like other simple entities."
    ],
    searchHints: ["Search by label before creating a near-duplicate tag."],
    examples: ['{"label":"Deep work","kind":"execution"}'],
    fieldGuide: [
      {
        name: "label",
        type: "string",
        required: true,
        description: "Human-readable tag label."
      },
      {
        name: "kind",
        type: "value|category|execution",
        required: false,
        description: "Optional tag family.",
        enumValues: ["value", "category", "execution"],
        defaultValue: "category"
      }
    ]
  }),
  enrichOnboardingEntityGuide({
    entityType: "sleep_session",
    purpose:
      "A first-class health record for one night with timing, derived sleep scores, optional stage detail, and reflective links back into Forge.",
    minimumCreateFields: ["startedAt", "endedAt"],
    relationshipRules: [
      "Use batch CRUD for ordinary sleep_session create, update, delete, and search work.",
      "The direct PATCH route is still available when enriching an existing night with reflective notes after review.",
      "Sleep deletions are immediate and do not go through the settings bin."
    ],
    searchHints: [
      "Search by linked entities or date window before creating a duplicate manual night."
    ],
    examples: [
      '{"startedAt":"2026-04-10T22:45:00.000Z","endedAt":"2026-04-11T06:45:00.000Z","qualitySummary":"Slept cleanly after a light evening.","links":[{"entityType":"habit","entityId":"habit_sleep_hygiene","relationshipType":"supports"}]}'
    ],
    fieldGuide: [
      {
        name: "startedAt",
        type: "ISO datetime",
        required: true,
        description: "Sleep start timestamp."
      },
      {
        name: "endedAt",
        type: "ISO datetime",
        required: true,
        description: "Sleep end timestamp."
      },
      {
        name: "timeInBedSeconds",
        type: "integer",
        required: false,
        description: "Defaults from startedAt and endedAt when omitted."
      },
      {
        name: "asleepSeconds",
        type: "integer",
        required: false,
        description: "Defaults to timeInBedSeconds when omitted."
      },
      {
        name: "awakeSeconds",
        type: "integer",
        required: false,
        description:
          "Defaults to the residual between timeInBedSeconds and asleepSeconds."
      },
      {
        name: "stageBreakdown",
        type: "array",
        required: false,
        description: "Optional list of { stage, seconds } items.",
        defaultValue: []
      },
      {
        name: "recoveryMetrics",
        type: "object",
        required: false,
        description: "Optional metric bag attached to the night.",
        defaultValue: {}
      },
      {
        name: "qualitySummary",
        type: "string",
        required: false,
        description: "Optional reflection summary.",
        defaultValue: ""
      },
      {
        name: "notes",
        type: "string",
        required: false,
        description: "Optional longer reflective note.",
        defaultValue: ""
      },
      {
        name: "tags",
        type: "string[]",
        required: false,
        description: "Optional review tags.",
        defaultValue: []
      },
      {
        name: "links",
        type: "array",
        required: false,
        description: "Linked Forge entities for context or support.",
        defaultValue: []
      }
    ]
  }),
  enrichOnboardingEntityGuide({
    entityType: "workout_session",
    purpose:
      "A first-class sports record with workout type, timing, optional effort or biometric detail, and linked Forge context.",
    minimumCreateFields: ["workoutType", "startedAt", "endedAt"],
    relationshipRules: [
      "Use batch CRUD for ordinary workout_session create, update, delete, and search work.",
      "The direct PATCH route remains useful for reflective enrichment after reviewing an existing imported or habit-generated workout.",
      "Workout deletions are immediate and do not go through the settings bin."
    ],
    searchHints: [
      "Search by workoutType, linked entity, or nearby timestamps before creating another manual workout."
    ],
    examples: [
      '{"workoutType":"walk","startedAt":"2026-04-11T10:00:00.000Z","endedAt":"2026-04-11T10:45:00.000Z","subjectiveEffort":6,"meaningText":"Reset after a long planning block."}'
    ],
    fieldGuide: [
      {
        name: "workoutType",
        type: "string",
        required: true,
        description:
          "Canonical workout label such as walk, run, ride, or mobility."
      },
      {
        name: "startedAt",
        type: "ISO datetime",
        required: true,
        description: "Workout start timestamp."
      },
      {
        name: "endedAt",
        type: "ISO datetime",
        required: true,
        description: "Workout end timestamp."
      },
      {
        name: "activeEnergyKcal",
        type: "number|null",
        required: false,
        description: "Optional active calories.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "totalEnergyKcal",
        type: "number|null",
        required: false,
        description: "Optional total calories.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "distanceMeters",
        type: "number|null",
        required: false,
        description: "Optional distance.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "exerciseMinutes",
        type: "number|null",
        required: false,
        description: "Optional exercise minutes.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "subjectiveEffort",
        type: "integer|null",
        required: false,
        description: "Optional subjective effort 1-10.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "meaningText",
        type: "string",
        required: false,
        description: "Optional reflective meaning or context.",
        defaultValue: ""
      },
      {
        name: "tags",
        type: "string[]",
        required: false,
        description: "Optional workout tags.",
        defaultValue: []
      },
      {
        name: "links",
        type: "array",
        required: false,
        description: "Linked Forge entities for context or support.",
        defaultValue: []
      }
    ]
  }),
  enrichOnboardingEntityGuide({
    entityType: "preference_catalog",
    purpose:
      "A reusable concept list inside one preference domain, used to seed or organize comparison candidates.",
    minimumCreateFields: ["userId", "domain", "title"],
    relationshipRules: [
      "Preference catalogs are simple entities and should default to batch CRUD.",
      "Catalog items belong to one preference_catalog through catalogId."
    ],
    searchHints: [
      "Search by title and domain before creating another concept list."
    ],
    examples: [
      '{"userId":"user_operator","domain":"food","title":"Cafe shortlist"}'
    ],
    fieldGuide: [
      {
        name: "userId",
        type: "string",
        required: true,
        description: "Owner user id."
      },
      {
        name: "domain",
        type: "string",
        required: true,
        description: "Preference domain such as food, places, tools, or custom."
      },
      {
        name: "title",
        type: "string",
        required: true,
        description: "Catalog display title."
      },
      {
        name: "description",
        type: "string",
        required: false,
        description: "Optional catalog summary.",
        defaultValue: ""
      },
      {
        name: "slug",
        type: "string",
        required: false,
        description: "Optional stable slug.",
        defaultValue: ""
      }
    ]
  }),
  enrichOnboardingEntityGuide({
    entityType: "preference_catalog_item",
    purpose: "One comparable candidate inside a preference catalog.",
    minimumCreateFields: ["catalogId", "label"],
    relationshipRules: [
      "Catalog items belong to a preference_catalog and use batch CRUD.",
      "They are concept seeds, not judgments or inferred scores."
    ],
    searchHints: [
      "Search inside the catalog before creating another near-duplicate concept item."
    ],
    examples: ['{"catalogId":"preference_catalog_123","label":"Flat white"}'],
    fieldGuide: [
      {
        name: "catalogId",
        type: "string",
        required: true,
        description: "Parent catalog id."
      },
      {
        name: "label",
        type: "string",
        required: true,
        description: "Candidate label."
      },
      {
        name: "description",
        type: "string",
        required: false,
        description: "Optional description.",
        defaultValue: ""
      },
      {
        name: "tags",
        type: "string[]",
        required: false,
        description: "Optional tags.",
        defaultValue: []
      },
      {
        name: "featureWeights",
        type: "object",
        required: false,
        description: "Optional interpretable feature weight hints.",
        defaultValue: {}
      }
    ]
  }),
  enrichOnboardingEntityGuide({
    entityType: "preference_context",
    purpose:
      "A named preference mode such as Work, Personal, or Discovery under one user and domain.",
    minimumCreateFields: ["userId", "domain", "name"],
    relationshipRules: [
      "Preference contexts are simple entities and should default to batch CRUD.",
      "Use the merge action only when the operator explicitly wants context consolidation."
    ],
    searchHints: ["Search by name and domain before creating another context."],
    examples: [
      '{"userId":"user_operator","domain":"food","name":"Work breakfasts","shareMode":"blended"}'
    ],
    fieldGuide: [
      {
        name: "userId",
        type: "string",
        required: true,
        description: "Owner user id."
      },
      {
        name: "domain",
        type: "string",
        required: true,
        description: "Preference domain."
      },
      {
        name: "name",
        type: "string",
        required: true,
        description: "Context display name."
      },
      {
        name: "description",
        type: "string",
        required: false,
        description: "Optional summary.",
        defaultValue: ""
      },
      {
        name: "shareMode",
        type: "shared|isolated|blended",
        required: false,
        description: "How this context mixes evidence with others.",
        enumValues: ["shared", "isolated", "blended"],
        defaultValue: "blended"
      },
      {
        name: "active",
        type: "boolean",
        required: false,
        description: "Whether the context is active.",
        defaultValue: true
      }
    ]
  }),
  enrichOnboardingEntityGuide({
    entityType: "preference_item",
    purpose:
      "One modeled preference candidate that may stand alone or point back to another Forge entity.",
    minimumCreateFields: ["userId", "domain", "label"],
    relationshipRules: [
      "Preference items are simple entities and should default to batch CRUD.",
      "They can optionally point back to another Forge entity through sourceEntityType and sourceEntityId."
    ],
    searchHints: [
      "Search by label, domain, or linked source entity before creating another preference item."
    ],
    examples: [
      '{"userId":"user_operator","domain":"tools","label":"Mechanical keyboard"}'
    ],
    fieldGuide: [
      {
        name: "userId",
        type: "string",
        required: true,
        description: "Owner user id."
      },
      {
        name: "domain",
        type: "string",
        required: true,
        description: "Preference domain."
      },
      {
        name: "label",
        type: "string",
        required: true,
        description: "Item display label."
      },
      {
        name: "description",
        type: "string",
        required: false,
        description: "Optional description.",
        defaultValue: ""
      },
      {
        name: "sourceEntityType",
        type: "string|null",
        required: false,
        description: "Optional linked Forge entity type.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "sourceEntityId",
        type: "string|null",
        required: false,
        description: "Optional linked Forge entity id.",
        defaultValue: null,
        nullable: true
      },
      {
        name: "tags",
        type: "string[]",
        required: false,
        description: "Optional tags.",
        defaultValue: []
      }
    ]
  }),
  enrichOnboardingEntityGuide({
    entityType: "questionnaire_instrument",
    purpose:
      "A reusable Psyche questionnaire instrument with versions, scoring rules, and provenance.",
    minimumCreateFields: [
      "title",
      "sourceClass",
      "availability",
      "isSelfReport",
      "versionLabel",
      "definition",
      "scoring",
      "provenance"
    ],
    relationshipRules: [
      "Questionnaire instruments now default to batch CRUD for normal create, update, delete, and search work.",
      "Clone, ensure draft, and publish remain specialized actions because they operate on instrument version state."
    ],
    searchHints: [
      "Search by title or key before creating a new custom instrument."
    ],
    examples: [
      '{"title":"Tiny weekly check-in","sourceClass":"secondary_verified","availability":"custom","isSelfReport":true,"versionLabel":"Draft 1","definition":{"locale":"en","instructions":"Rate how present this feels today.","completionNote":"","presentationMode":"single_question","responseStyle":"four_point_frequency","itemIds":[],"items":[],"sections":[],"pageSize":null},"scoring":{"scores":[]},"provenance":{"retrievalDate":"2026-04-06","sourceClass":"secondary_verified","scoringNotes":"","sources":[]}}'
    ],
    fieldGuide: [
      {
        name: "title",
        type: "string",
        required: true,
        description: "Instrument title."
      },
      {
        name: "sourceClass",
        type: "string",
        required: true,
        description: "Evidence or provenance class."
      },
      {
        name: "availability",
        type: "string",
        required: true,
        description: "System or custom availability mode."
      },
      {
        name: "isSelfReport",
        type: "boolean",
        required: true,
        description: "Whether the instrument is self-report."
      },
      {
        name: "versionLabel",
        type: "string",
        required: true,
        description: "Initial draft version label on create."
      },
      {
        name: "definition",
        type: "object",
        required: true,
        description: "Questionnaire definition payload."
      },
      {
        name: "scoring",
        type: "object",
        required: true,
        description: "Scoring payload."
      },
      {
        name: "provenance",
        type: "object",
        required: true,
        description: "Provenance payload."
      }
    ]
  }),
  enrichOnboardingEntityGuide({
    entityType: "task_run",
    purpose: "A live timed work session attached to a task.",
    minimumCreateFields: [],
    relationshipRules: [
      "Task runs are action-heavy records. Do not model them as ordinary CRUD entities.",
      "Start, focus, heartbeat, complete, or release them through the dedicated task-run routes."
    ],
    searchHints: [
      "Read operator context before starting or altering live work."
    ],
    fieldGuide: []
  }),
  enrichOnboardingEntityGuide({
    entityType: "work_adjustment",
    purpose:
      "A truthful signed minute correction on an existing task or project when work happened outside a live run.",
    minimumCreateFields: [],
    relationshipRules: [
      "Work adjustments are action-heavy corrections, not normal CRUD entities.",
      "Use forge_adjust_work_minutes when the target task or project already exists and only tracked minutes need to change."
    ],
    searchHints: [
      "Confirm the target task or project first, then apply only the signed minute delta that is actually true."
    ],
    fieldGuide: []
  }),
  enrichOnboardingEntityGuide({
    entityType: "questionnaire_run",
    purpose:
      "One user-owned answer session against a questionnaire instrument version.",
    minimumCreateFields: [],
    relationshipRules: [
      "Questionnaire runs are action-heavy records with a lifecycle of start, patch answers, and complete.",
      "Use the run routes instead of batch CRUD."
    ],
    searchHints: [
      "Read the run detail when continuing or reviewing an in-flight answer session."
    ],
    fieldGuide: []
  }),
  enrichOnboardingEntityGuide({
    entityType: "preference_judgment",
    purpose:
      "One pairwise preference outcome between two items inside a domain and context.",
    minimumCreateFields: [],
    relationshipRules: [
      "Preference judgments are action-heavy records, not batch CRUD entities.",
      "Use the dedicated judgment route so the profile, evidence, and comparison history stay aligned."
    ],
    searchHints: [
      "Confirm the left and right items, the outcome, and the active context before storing a new judgment."
    ],
    fieldGuide: []
  }),
  enrichOnboardingEntityGuide({
    entityType: "preference_signal",
    purpose:
      "One direct preference signal such as favorite, veto, bookmark, neutral, or compare-later.",
    minimumCreateFields: [],
    relationshipRules: [
      "Preference signals are action-heavy records, not batch CRUD entities.",
      "Use the dedicated signal route so the profile and evidence model stay aligned."
    ],
    searchHints: [
      "Confirm the item, signal type, and context before storing a new direct signal."
    ],
    fieldGuide: []
  }),
  enrichOnboardingEntityGuide({
    entityType: "calendar_connection",
    purpose:
      "A stored external calendar provider connection and its selected calendars.",
    minimumCreateFields: [],
    relationshipRules: [
      "Calendar connections use specialized setup and sync flows rather than batch CRUD.",
      "Provider auth and writable Forge-calendar selection are part of the same specialized surface."
    ],
    searchHints: [
      "Read the calendar overview before changing connections or sync state."
    ],
    fieldGuide: []
  }),
  enrichOnboardingEntityGuide({
    entityType: "wiki_page",
    purpose: "A file-backed Forge wiki page or evidence page.",
    minimumCreateFields: ["title", "contentMarkdown"],
    relationshipRules: [
      "Wiki pages live on the wiki surface and use specialized page upsert routes rather than batch CRUD.",
      "Entity links remain explicit inside the page link model."
    ],
    searchHints: [
      "Search or list wiki pages before creating another page with the same topic."
    ],
    fieldGuide: [
      {
        name: "title",
        type: "string",
        required: true,
        description: "Page title."
      },
      {
        name: "contentMarkdown",
        type: "string",
        required: true,
        description: "Markdown body."
      }
    ]
  }),
  enrichOnboardingEntityGuide({
    entityType: "movement",
    purpose:
      "The specialized Movement surface for day, month, all-time, timeline, trip, place, selection, and manual overlay work.",
    minimumCreateFields: [],
    relationshipRules: [
      "Movement is a specialized domain surface, not a normal batch CRUD entity family.",
      "Read and mutate it through the dedicated movement routes published under specializedDomainSurfaces."
    ],
    searchHints: [
      "Clarify whether the user wants a behavioral query, one trip or place, a missing-gap overlay, a manual add or update, or a link before choosing the route."
    ],
    fieldGuide: []
  }),
  enrichOnboardingEntityGuide({
    entityType: "life_force",
    purpose:
      "The specialized Life Force surface for the current energy overview, profile edits, weekday templates, and fatigue signals.",
    minimumCreateFields: [],
    relationshipRules: [
      "Life Force is a specialized domain surface, not a normal batch CRUD entity family.",
      "Use the dedicated overview, profile, weekday-template, and fatigue-signal routes."
    ],
    searchHints: [
      "Clarify whether the user wants explanation, durable model changes, or a real-time tired or recovered signal before choosing the route."
    ],
    fieldGuide: []
  }),
  enrichOnboardingEntityGuide({
    entityType: "workbench",
    purpose:
      "The specialized Workbench surface for flow catalog work, flow CRUD, execution, run history, published outputs, node results, and latest-node-output reads.",
    minimumCreateFields: [],
    relationshipRules: [
      "Workbench is a specialized execution surface, not a normal batch CRUD entity family.",
      "Use the dedicated workbench flow, run, output, and node-result routes."
    ],
    searchHints: [
      "Clarify whether the user wants flow discovery, editing, execution, published output, run inspection, or node-level output before choosing the route."
    ],
    fieldGuide: []
  }),
  enrichOnboardingEntityGuide({
    entityType: "self_observation",
    purpose:
      "The note-backed Psyche self-observation calendar surface for observed events and reflections.",
    minimumCreateFields: [],
    relationshipRules: [
      "This is a read model, not a standalone CRUD entity.",
      "Mutate it by creating or updating a note with frontmatter.observedAt."
    ],
    searchHints: [
      "Read the self-observation calendar before proposing new reflected notes or edits."
    ],
    fieldGuide: []
  }),
  enrichOnboardingEntityGuide({
    entityType: "sleep_overview",
    purpose:
      "The read-model sleep workspace that summarizes recent sleep sessions, trends, and stage averages.",
    minimumCreateFields: [],
    relationshipRules: [
      "Use this surface for review.",
      "Create, update, delete, or search the underlying sleep_session records through batch CRUD by default."
    ],
    searchHints: [
      "Read this surface before suggesting reflective edits or health-planning follow-up."
    ],
    fieldGuide: []
  }),
  enrichOnboardingEntityGuide({
    entityType: "sports_overview",
    purpose:
      "The read-model sports workspace that summarizes recent workout sessions and training load.",
    minimumCreateFields: [],
    relationshipRules: [
      "Use this surface for review.",
      "Create, update, delete, or search the underlying workout_session records through batch CRUD by default."
    ],
    searchHints: [
      "Read this surface before suggesting workout reflections or recovery follow-up."
    ],
    fieldGuide: []
  })
] as const;

const AGENT_ONBOARDING_CONVERSATION_RULES = [
  "Ask only for what is missing or unclear instead of walking the user through every optional field.",
  "Start by saying what seems to matter here or what the record is becoming, then ask the next useful question.",
  "Whenever possible, make the direction of the intake visible before the question by naming what you think the user is trying to preserve, clarify, decide, schedule, or make easier.",
  "When the user's operation is not already explicit, identify the job first: add, update, review, compare, navigate, link, or run.",
  "Before each question, decide the one missing thing you are trying to clarify and why it matters for the record.",
  "The first question should usually clarify whether the user is trying to understand, preserve, decide, schedule, or change something, not just which field or provider they want.",
  "Use a progression of concrete example or intent, working name, purpose or meaning, placement in Forge, operational details, and linked context.",
  "Ask one to three focused questions at a time. One is usually best when the user is uncertain or emotionally loaded.",
  "One focused question is the default. Only stack a second question when both serve the same clarification job and the user is steady enough for it.",
  "When the user wants review, comparison, or navigation around an existing record, ask what they are trying to understand first and route to the read path before reopening create or update intake.",
  "If the user already answered the normal opening question, do not repeat it. Move to the next missing clarification.",
  "Do not over-therapize logistical entities. For tasks, calendar events, work blocks, timeboxes, and task runs, one brief confirming sentence plus one question is usually enough.",
  "After each substantive answer, briefly say what is becoming clearer and ask only for the next thing that still changes the record shape or usefulness.",
  "For strategic, reflective, or emotionally meaningful non-Psyche records, ask what feels important to keep true before you ask for labels, dates, or taxonomy.",
  "For reusable records such as tags, event types, emotion definitions, preference contexts, or questionnaires, ask what distinction or decision the record should help with before you ask for wording.",
  "When useful, help the user name, define, and connect the record in that order: offer a working label, clarify what belongs inside it, then ask about links only after the record itself feels steady.",
  "When the meaning is clearer than the wording, offer a tentative title or formulation yourself and invite correction instead of forcing the user to wordsmith alone.",
  "Before saving, briefly summarize the working formulation in the user's own language when that would reduce ambiguity.",
  "Once the record is clear enough to name, stop exploring broadly and ask only for the last structural detail that still matters.",
  "If the record is already clear enough to save, save it instead of performing a ceremonial extra question.",
  "If the user accepts the wording or record shape, move to the write instead of reopening the intake.",
  "When updating an entity, start with what is changing, what should stay true, and what prompted the update now.",
  "For action-heavy flows such as work adjustments, preference judgments, preference signals, and specialized Movement, Life Force, or Workbench work, first ask what the user is trying to understand, change, add, update, link, or run, then choose the dedicated action or surface route instead of forcing the request into generic CRUD.",
  "For specialized surfaces, ask what would make the answer or change useful before you ask route-shaped details such as provider, weekday, flow id, run id, or trip id.",
  "For Movement specifically, treat missing-data corrections as user-defined overlay boxes unless the user is editing an already-recorded stay or trip. When the user already gave a clear instruction like 'that missing block was home', act after only the last ambiguity is resolved."
] as const;

const AGENT_ONBOARDING_ENTITY_CONVERSATION_PLAYBOOKS = [
  {
    focus: "goal",
    openingQuestion: "What direction are you trying to keep hold of here?",
    coachingGoal:
      "Clarify the direction and why it matters, not just produce a title.",
    askSequence: [
      "Ask what direction or outcome the user wants to keep in view.",
      "Reflect the deeper stake in plain language before moving on.",
      "Ask why it matters now.",
      "Distinguish the goal from a project or task.",
      "Clarify horizon and status only after the meaning is clear."
    ]
  },
  {
    focus: "project",
    openingQuestion:
      "If this became a real project, what would you be trying to make true in your life or work?",
    coachingGoal:
      "Turn an intention into a bounded workstream with a clear outcome.",
    askSequence: [
      "Ask what this piece of work is trying to make true.",
      "Reflect the emerging boundary so the user can hear what is in scope.",
      "Ask what outcome would make the project feel real or complete for now.",
      "Ask what belongs inside the boundary and what can stay out if the scope still feels muddy.",
      "Ask which goal it belongs under.",
      "Land on a working name once the scope is clear.",
      "Clarify status, owner, and notes only after the scope is clear."
    ]
  },
  {
    focus: "strategy",
    openingQuestion:
      "What future state are you actually trying to arrive at with this strategy?",
    coachingGoal:
      "Turn a vague plan into a deliberate sequence toward a real end state.",
    askSequence: [
      "Ask what end state the strategy is trying to land.",
      "Reflect the destination in plain language so the user can correct it early.",
      "Ask which goals or projects are the true targets.",
      "Ask what the major steps or nodes are.",
      "Ask about order, dependencies, and anything that must not be skipped."
    ]
  },
  {
    focus: "task",
    openingQuestion: "What is the next concrete move here?",
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
      "What recurring move are you trying to strengthen or interrupt?",
    coachingGoal:
      "Define the recurring behavior and cadence clearly enough for honest later check-ins.",
    askSequence: [
      "Ask what the recurring behavior is in plain language.",
      "Ask whether doing it is aligned or a slip.",
      "Ask what an honest hit or miss would look like in an ordinary week.",
      "Ask about cadence and what counts as an honest check-in in practice.",
      "Ask about links only if they will help later review."
    ]
  },
  {
    focus: "tag",
    openingQuestion:
      "What do you want this tag to help you notice or find again later?",
    coachingGoal:
      "Create a label that helps later retrieval or grouping instead of another vague bucket.",
    askSequence: [
      "Ask what the tag should help the user notice, group, or find later.",
      "Ask what kinds of records should belong under it and what should stay outside it.",
      "Offer a concise label if the grouping meaning is clearer than the wording.",
      "Ask about color, kind, or parent grouping only if that changes how the tag will be used."
    ]
  },
  {
    focus: "note",
    openingQuestion: "What about this feels worth preserving in a note?",
    coachingGoal:
      "Preserve the useful context and link it to the right places without turning the note into a dump.",
    askSequence: [
      "Ask what the note needs to preserve.",
      "Ask what sentence future-you would need to recover from this note later.",
      "Ask what entities it should stay attached to.",
      "Ask whether it should be durable or temporary.",
      "Ask about tags or author only if they help retrieval or handoff."
    ]
  },
  {
    focus: "wiki_page",
    openingQuestion: "What should this page become the main reference for?",
    coachingGoal:
      "Create a durable reference page with a clear scope instead of dumping raw notes into the wiki.",
    askSequence: [
      "Ask what topic this page should become the canonical place for.",
      "Ask whether it is a durable wiki page or supporting evidence.",
      "Ask what future lookup, decision, or collaboration this page should support.",
      "Ask about linked entities, aliases, or tags only if they will make the page more navigable later."
    ]
  },
  {
    focus: "insight",
    openingQuestion:
      "What is the clearest thing you want future-you or the agent to remember from this?",
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
    focus: "calendar_connection",
    openingQuestion:
      "Which calendar provider are you trying to connect, and what do you want Forge to do with it?",
    coachingGoal:
      "Connect the right provider deliberately without turning setup into a credential dump.",
    askSequence: [
      "Ask which provider the user wants to connect and what they want Forge to do with it.",
      "Ask whether the goal is read-only visibility, writable planning, or both.",
      "Ask what workflow they are trying to unlock so the connection stays grounded in a real use case.",
      "Ask only for the next provider-specific step that still matters, such as auth flow, label, or calendar selection.",
      "Move into the actual connection flow once the setup goal is clear."
    ]
  },
  {
    focus: "task_run",
    openingQuestion: "Which task should I start?",
    coachingGoal:
      "Start truthful live work with as little friction as possible while still knowing what is being worked on and by whom.",
    askSequence: [
      "Confirm the task.",
      "Confirm the actor only if it is not already obvious.",
      "Ask whether the run should be planned or unlimited only if that changes the action.",
      "Start the run instead of turning it into a longer intake."
    ]
  },
  {
    focus: "work_adjustment",
    openingQuestion:
      "Which task or project should this time correction belong to?",
    coachingGoal:
      "Correct tracked minutes truthfully without pretending a live run happened.",
    askSequence: [
      "Ask what existing task or project the minutes belong to.",
      "Ask whether time should be added or removed.",
      "Ask what real work or correction the adjustment is meant to capture.",
      "Ask for a short audit note only if the reason would otherwise be unclear later."
    ]
  },
  {
    focus: "self_observation",
    openingQuestion: "What did you notice most clearly in that moment?",
    coachingGoal:
      "Capture one observation clearly enough that it can support later reflection without pretending it is already a full interpretation.",
    askSequence: [
      "Ask what was observed.",
      "Reflect the moment without pretending it is already a finished interpretation.",
      "Ask what felt most important to name before it gets smoothed over or forgotten.",
      "Ask for the smallest concrete slice if the observation still feels vague or global.",
      "Ask when it happened or became noticeable unless timing is already clear.",
      "Ask what it may connect to: pattern, belief, value, mode, task, project, or note.",
      "Ask for tags or extra context only if that will help later review."
    ]
  },
  {
    focus: "sleep_session",
    openingQuestion:
      "What about this night feels important enough to remember or connect?",
    coachingGoal:
      "Enrich one night's record with reflective context instead of treating it like a generic note.",
    askSequence: [
      "Ask what about the night feels worth capturing.",
      "Ask whether the main point is quality, pattern, context, meaning, or links.",
      "Ask what goal, project, task, habit, or Psyche record it should stay connected to.",
      "Ask about tags only if they will help later review."
    ]
  },
  {
    focus: "workout_session",
    openingQuestion:
      "What about this workout feels most worth remembering or connecting?",
    coachingGoal:
      "Enrich one workout with subjective effort, mood, meaning, or linked context.",
    askSequence: [
      "Ask what about the session the user wants to preserve.",
      "Ask whether the key layer is effort, mood, meaning, social context, or links.",
      "Ask what it connects to in Forge if links matter.",
      "Ask about tags only if they help later retrieval."
    ]
  },
  {
    focus: "preference_catalog",
    openingQuestion:
      "What decision or taste question should this catalog help with?",
    coachingGoal:
      "Define a useful comparison pool rather than a list with no decision purpose.",
    askSequence: [
      "Ask what preference question this catalog is meant to support.",
      "Ask what domain or concept area it belongs to.",
      "Ask what kinds of items should be included or excluded.",
      "Offer a working catalog name once the purpose is clear."
    ]
  },
  {
    focus: "preference_catalog_item",
    openingQuestion: "What makes this option meaningfully worth comparing?",
    coachingGoal:
      "Add one candidate in a way that will make later comparisons feel clear and fair.",
    askSequence: [
      "Ask what makes this item worth including in the catalog.",
      "Ask what catalog or domain it belongs to if that is still unclear.",
      "Ask what would make the comparison confusing or unfair if the label stayed as-is.",
      "Ask for a short clarifying description only if the label would be ambiguous later.",
      "Ask about aliases or tags only if they help retrieval."
    ]
  },
  {
    focus: "preference_context",
    openingQuestion:
      "In what situation should Forge treat your preferences differently here?",
    coachingGoal:
      "Define a real operating mode for preferences instead of a decorative label.",
    askSequence: [
      "Ask what situation or mode this context is meant to represent.",
      "Ask what decisions or comparisons should feel different inside that context.",
      "Ask what should count inside that context and what should stay outside it.",
      "Ask whether it should be active, default, or kept separate from other evidence.",
      "Offer a concise name if the mode is clearer than the wording."
    ]
  },
  {
    focus: "preference_item",
    openingQuestion:
      "What preference are you trying to make clearer by saving this item?",
    coachingGoal:
      "Save one concrete preference candidate or signal without losing the context that makes it meaningful.",
    askSequence: [
      "Ask what preference or taste question this item belongs to.",
      "Ask what domain or context it should live in.",
      "Ask whether the user is saving a comparison candidate or a direct signal such as favorite, veto, or compare-later.",
      "Ask what makes the item distinct enough to compare usefully only if it is still a comparison candidate."
    ]
  },
  {
    focus: "preference_judgment",
    openingQuestion: "What comparison are you actually trying to settle here?",
    coachingGoal:
      "Capture one pairwise preference decision with the right context instead of only logging a left-versus-right click.",
    askSequence: [
      "Ask what comparison the user is actually trying to settle.",
      "Ask which context or domain this judgment belongs to.",
      "Ask whether the result is left, right, tie, or skip.",
      "Ask for reason tags or strength only if they will improve later interpretation."
    ]
  },
  {
    focus: "preference_signal",
    openingQuestion:
      "What do you want Forge to remember about this item right now?",
    coachingGoal:
      "Store a direct preference signal such as favorite, veto, bookmark, or compare-later with enough context to interpret it later.",
    askSequence: [
      "Ask what item the user wants to mark.",
      "Ask what signal they want to give it.",
      "Ask what domain or context this belongs to if that is still unclear.",
      "Ask about strength only if the user is expressing a gradient rather than a simple mark."
    ]
  },
  {
    focus: "questionnaire_instrument",
    openingQuestion:
      "What would this questionnaire help someone notice or track?",
    coachingGoal:
      "Clarify whether the user is authoring a reusable questionnaire and what the instrument is for.",
    askSequence: [
      "Ask what the questionnaire is meant to measure or surface.",
      "Ask who it is for and when it should be used.",
      "Ask what kind of honest moment or decision it should help someone answer before getting into item wording.",
      "Reflect the practical use case back in plain language.",
      "Ask what would make the instrument distinct instead of redundant if a near-duplicate risk is visible.",
      "Move to draft creation once the purpose is clear."
    ]
  },
  {
    focus: "questionnaire_run",
    openingQuestion:
      "Do you want to start, continue, review, or finish a questionnaire run?",
    coachingGoal:
      "Clarify whether the user wants to start, continue, or complete one answer session.",
    askSequence: [
      "Ask what the user wants from the run right now: start, continue, review, or finish.",
      "Ask which questionnaire or existing run this is about.",
      "If the user wants to continue or finish, ask what feels most stuck, unfinished, or important before asking for more content.",
      "If answering is still in progress, ask only for the next answer or note that matters."
    ]
  },
  {
    focus: "movement",
    openingQuestion:
      "Are you trying to understand where you stayed and traveled, change one stay or trip, or answer a question about your movement behavior?",
    coachingGoal:
      "Clarify whether the user wants a time-in-place query, travel-history review, a missing-gap overlay, one stay or trip change, one place summary, or a link before choosing the dedicated movement route.",
    askSequence: [
      "Ask whether the user is trying to query behavior, add something manually, update an existing movement item, or link movement to another Forge entity.",
      "Ask whether the focus is a stay, a trip, a place, a timeline window, or a selected span.",
      "Ask for the time window, place, or movement item that makes the question concrete.",
      "Ask what they are trying to notice, preserve, or answer through that movement context.",
      "Skip the meta lane question when the user already named the exact correction or review target and only one ambiguity remains.",
      "If the request is filling a missing-data gap, use a user-defined movement box rather than a raw stay or trip patch.",
      "If the request is repairing already-saved movement data, use the repair route that matches the saved object instead of treating it like a missing span.",
      "When the user already gave a concrete correction like 'I stayed home during that missing block', confirm only the interval or place if needed, then create the overlay and read the timeline back."
    ]
  },
  {
    focus: "life_force",
    openingQuestion:
      "Do you want to understand the current energy picture, change how Forge models it, or log how you feel right now?",
    coachingGoal:
      "Clarify whether the job is overview, profile change, weekday-template editing, or a real-time fatigue signal before choosing the dedicated life-force route.",
    askSequence: [
      "Ask whether the job is overview, profile change, weekday-template change, or fatigue signaling.",
      "Ask what part of the current energy picture feels most important or inaccurate.",
      "Ask what should stay true if they are changing profile or template assumptions.",
      "Ask whether the user is describing a stable weekly shape or just how today feels when the lane is still blurred.",
      "If the user already named the life-force lane clearly, skip the meta lane question and ask only for the specific weekday, profile field, or signal that still matters.",
      "Route to the dedicated life-force path once the lane is clear."
    ]
  },
  {
    focus: "workbench",
    openingQuestion:
      "Are you trying to inspect a flow, change it, run it, or inspect one run's outputs?",
    coachingGoal:
      "Clarify whether the user wants flow discovery, editing, execution, run history, published outputs, or node-level inspection before using the dedicated workbench route family.",
    askSequence: [
      "Ask whether the job is flow discovery, one flow edit, execution, run history, published output, node-level inspection, or latest-node-output lookup.",
      "Ask which flow, slug, run, or node the request is about.",
      "Ask whether they need the flow contract, a run result, a published output, or a node result.",
      "Ask what the user is trying to learn, repair, or publish through that flow.",
      "If the user already named the flow and action clearly, skip the meta lane question and ask only for the missing run, node, or output scope.",
      "Route to the dedicated workbench route family once the execution lane is clear."
    ]
  },
  {
    focus: "event_type",
    openingQuestion:
      "What kind of moment keeps happening that you want future reports to name the same way each time?",
    coachingGoal:
      "Create a reusable incident category that will actually help future reports stay consistent.",
    askSequence: [
      "Ask what kind of moment or incident this label should capture in lived terms.",
      "Reflect the repeated moment back in plain language before narrowing the wording.",
      "Ask how narrow or broad it should be.",
      "Ask what would count as inside versus outside the category if that boundary is still fuzzy.",
      "Offer a concise label if the lived meaning is clearer than the wording.",
      "Ask for a short description only if the label could be ambiguous later."
    ]
  },
  {
    focus: "emotion_definition",
    openingQuestion:
      "When this feeling is present, what tells you it is this feeling and not a nearby one?",
    coachingGoal:
      "Create a reusable emotion label with enough clarity to use consistently later.",
    askSequence: [
      "Ask what this feeling is like in lived terms when the user says it.",
      "Reflect the felt signature back in plain language before you settle the label.",
      "Ask what distinguishes it from nearby emotions if that matters.",
      "Offer a concise label if the felt meaning is clearer than the wording.",
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
      "Reflect the pain, longing, or importance that makes the value alive before narrowing to action.",
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
      "If the user asks to understand the loop first, do not lead with a finished working diagnosis or title before asking at least one clarifying question.",
      "Before you ask how to change the loop, ask what it is protecting, preventing, or managing for the user."
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
      "If the user asks for understanding before storage, ask about the recent example and function of the move before classifying it.",
      "Ask what the move is trying to do for the user before moving into replacement planning.",
      "Name the immediate protective job before discussing costs or alternatives."
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
      "When that reaction hits, what does it start telling you?",
      "Is it more of an always/never belief, or an if-then rule?",
      "How true does it feel right now from 0 to 100?",
      "What seems to support it, and what weakens it?",
      "Where do you think you learned or rehearsed that rule?",
      "What would a more flexible alternative sound like?"
    ],
    notes: [
      "Schema catalog entries are reference concepts; belief_entry is the user-owned record.",
      "If no schema catalog match is known, omit schemaId rather than inventing one.",
      "Do not argue the user out of the belief. Reflect it, understand its function, and then collaboratively test for flexibility.",
      "When the wording is nearly there, ask whether it feels true enough before you move into confidence, evidence, or alternative-belief details."
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
      "When this part takes over, what is it trying to protect?",
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
      "What just happened before this part came online?",
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
      "Use after explicit save intent and after duplicate checks when needed. This is the default create path for simple Forge entities; do not spray one-off direct mutation routes when the batch contract already covers the record.",
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
      "The same batch create route also handles calendar_event, work_block_template, task_timebox, sleep_session, workout_session, preference_catalog, preference_catalog_item, preference_context, preference_item, and questionnaire_instrument.",
      "Calendar-event creates still trigger downstream projection sync when a writable provider calendar is selected."
    ],
    example:
      '{"operations":[{"entityType":"task","data":{"title":"Write the public release notes","projectId":"project_123","status":"focus","notes":[{"contentMarkdown":"Starting from the changelog draft and the last QA pass."}]},"clientRef":"task-1"}]}'
  },
  {
    toolName: "forge_update_entities",
    summary: "Patch one or more entities in one ordered batch.",
    whenToUse:
      "Use when ids are known and the user explicitly wants a change persisted. This is the default update path for simple Forge entities, including manual health-session CRUD.",
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
      "Use this same route to move or relink calendar_event records, edit work_block_template, task_timebox, sleep_session, or workout_session records, and do normal field updates on preference_catalog, preference_catalog_item, preference_context, preference_item, and questionnaire_instrument."
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
      "calendar_event, work_block_template, task_timebox, sleep_session, and workout_session are immediate deletions: calendar events delete remote projections too, and these records do not go through the settings bin."
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
    inputShape:
      '{ spaceId?: string, kind?: "wiki"|"evidence", limit?: integer }',
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
    toolName: "forge_get_sleep_overview",
    summary:
      "Read the sleep surface with recent nights, scores, regularity, stage averages, and linked reflective context.",
    whenToUse:
      "Use when the operator wants to review sleep patterns or when an agent needs sleep context before planning or coaching.",
    inputShape: "{ userIds?: string[] }",
    requiredFields: [],
    notes: [
      "Sleep sessions are first-class Forge health records and can link back to goals, projects, tasks, habits, notes, and Psyche entities.",
      "This read model is multi-user aware through userIds."
    ],
    example: '{"userIds":["user_operator","user_hermes"]}'
  },
  {
    toolName: "forge_get_sports_overview",
    summary:
      "Read the sports surface with workout volume, workout types, effort signals, and linked session context.",
    whenToUse:
      "Use when the operator wants training context, habit-generated workout visibility, or workout review before planning.",
    inputShape: "{ userIds?: string[] }",
    requiredFields: [],
    notes: [
      "The API path stays /api/v1/health/fitness even though the UI route is /sports.",
      "Habit-generated and imported workouts reconcile into the same workout record model."
    ],
    example: '{"userIds":["user_operator"]}'
  },
  {
    toolName: "forge_update_sleep_session",
    summary:
      "Patch one sleep session with reflective notes, tags, or linked Forge context.",
    whenToUse:
      "Use after reviewing a specific night when the operator wants richer context stored on that sleep record. Do not use this as the primary CRUD path when batch entity mutation already fits the job.",
    inputShape:
      "{ sleepId: string, qualitySummary?: string, notes?: string, tags?: string[], links?: Array<{ entityType, entityId, relationshipType? }> }",
    requiredFields: ["sleepId"],
    notes: [
      "Use this to attach the night to goals, projects, habits, notes, or Psyche context without editing the raw imported timestamps.",
      "Links keep sleep review connected to the broader Forge graph."
    ],
    example:
      '{"sleepId":"sleep_123","qualitySummary":"Fell asleep late after travel but recovered well.","tags":["travel","recovery"],"links":[{"entityType":"habit","entityId":"habit_sleep_hygiene","relationshipType":"supports"}]}'
  },
  {
    toolName: "forge_update_workout_session",
    summary:
      "Patch one workout session with subjective effort, mood, meaning, tags, or linked Forge context.",
    whenToUse:
      "Use after reviewing one sports session when the operator wants the workout record to carry narrative or planning context. Do not use this as the primary CRUD path when batch entity mutation already fits the job.",
    inputShape:
      "{ workoutId: string, subjectiveEffort?: integer|null, moodBefore?: string, moodAfter?: string, meaningText?: string, plannedContext?: string, socialContext?: string, tags?: string[], links?: Array<{ entityType, entityId, relationshipType? }> }",
    requiredFields: ["workoutId"],
    notes: [
      "Use this for subjective or linked-context metadata, not for rewriting the raw imported workout duration or calories.",
      "This is the correct path for both imported HealthKit workouts and habit-generated sports sessions."
    ],
    example:
      '{"workoutId":"workout_123","subjectiveEffort":7,"meaningText":"Protected recovery and sleep rhythm after a heavy workday.","tags":["recovery","sleep-support"],"links":[{"entityType":"project","entityId":"project_endurance_reset","relationshipType":"supports"}]}'
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
      "Create a Forge calendar connection for Google, Apple, Exchange Online, calendars already configured on this Mac, or custom CalDAV.",
    whenToUse:
      "Use only when the operator explicitly wants Forge connected to an external calendar provider.",
    inputShape:
      '{ provider: "google"|"apple"|"caldav"|"microsoft"|"macos_local", label: string, username?: string, password?: string, serverUrl?: string, authSessionId?: string, sourceId?: string, selectedCalendarUrls: string[], forgeCalendarUrl?: string, createForgeCalendar?: boolean, replaceConnectionIds?: string[] }',
    requiredFields: ["provider", "label", "provider-specific credentials"],
    notes: [
      "Google now uses an interactive localhost Authorization Code + PKCE flow. The user signs in interactively on the same machine running Forge, Forge exchanges the authorization code on the backend, and forge_connect_calendar_provider should only be used after a completed Google authSessionId exists.",
      "Apple starts from https://caldav.icloud.com and autodiscovers the principal plus calendars after authentication.",
      "Exchange Online uses Microsoft Graph. In the current Forge implementation it is read-only: Forge mirrors the selected calendars but does not publish work blocks or timeboxes back to Microsoft.",
      "In the current self-hosted local runtime, Exchange Online now uses an interactive Microsoft public-client sign-in flow with PKCE after the operator has saved the Microsoft client ID, tenant, and redirect URI in Settings -> Calendar. Non-interactive callers should treat Microsoft connection setup as a Settings-owned operator action unless a completed authSessionId already exists.",
      "macos_local uses EventKit to read and write the calendars already configured on the host Mac. Discovery is grouped by host calendar source, and Forge replaces overlapping remote connections for the same account instead of keeping duplicate copies.",
      "Custom CalDAV uses an account-level server URL, not a single calendar collection URL.",
      "Writable providers publish Forge work blocks and timeboxes through one shared Forge write target. A new connection only needs its own write calendar when the runtime does not already have one."
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
    whenToUse:
      "Use when preparing focused work in advance and the agent wants Forge to propose candidate slots instead of picking one manually.",
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
      "Use after choosing a valid future slot or, preferably, when the agent has already reasoned over the live calendar and wants to place a manual timebox directly.",
    inputShape:
      '{ taskId: string, projectId?: string|null, title: string, startsAt: string, endsAt: string, source?: "manual"|"suggested"|"live_run", overrideReason?: string|null, activityPresetKey?: string|null, customSustainRateApPerHour?: number|null, userId?: string|null }',
    requiredFields: ["taskId", "title", "startsAt", "endsAt"],
    notes: [
      "Manual timeboxing is the main direct path when the agent already understands the calendar and wants to choose the slot itself.",
      "Forge publishes these through the shared Forge write target during provider sync.",
      "Live task runs can later attach to matching timeboxes.",
      "This is a convenience helper; agents can also create task_timebox through forge_create_entities."
    ],
    example:
      '{"taskId":"task_123","projectId":"project_456","title":"Draft the methods section","startsAt":"2026-04-03T08:00:00.000Z","endsAt":"2026-04-03T09:30:00.000Z","source":"manual","overrideReason":"Protected writing block before clinic.","activityPresetKey":"deep_work","customSustainRateApPerHour":6.5}'
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
      wiki: "Forge Wiki is the file-first memory layer: local Markdown pages plus media, backlinks, optional embeddings, explicit spaces, and structured links back to Forge entities.",
      sleepSession:
        "A sleep session is a first-class health record with timing, sleep and bed duration, stage breakdown, recovery metrics, annotations, and Forge links back to planning or Psyche context.",
      workoutSession:
        "A workout session is a first-class sports record imported from HealthKit or generated from a habit. It holds workout type, timing, energy or distance when available, subjective effort, narrative context, and Forge links.",
      preferences:
        "Forge Preferences is the explicit taste-modeling domain. It has workspaces, contexts, concept libraries, direct items, pairwise judgments, direct signals, and inferred scores.",
      questionnaire:
        "Forge Psyche questionnaires are structured reusable instruments with provenance, scoring, draft and published versions, and user-owned answer runs.",
      selfObservation:
        "Forge self-observation is a dedicated Psyche calendar view backed by observed notes timestamped by frontmatter.observedAt, including deliberate reflection notes and rolling movement notes from the companion.",
      insight:
        "An agent-authored observation or recommendation grounded in Forge data.",
      calendar:
        "A connected calendar source mirrored into Forge. Calendar state combines provider events, recurring work blocks, and task timeboxes.",
      workBlock:
        "A recurring half-day or custom time window such as Main Activity, Secondary Activity, Third Activity, Rest, Holiday, or Custom. Work blocks can allow or block work by default, can define active date bounds, and remain editable through the calendar surface.",
      taskTimebox:
        "A planned or live calendar slot tied to a task. Timeboxes can be suggested in advance or created automatically from active task runs.",
      workAdjustment:
        "A work adjustment is a truthful signed minute correction on an existing task or project when real work happened but no live run was active.",
      movement:
        "Forge Movement is the first-class mobility surface. It is a timeline of stays and trips: stays capture time spent in the same place, and trips capture travel between places. Use it for time-in-place questions, travel-history review, specific stay or trip edits, selected-span aggregates, known places, and links to other Forge records rather than pretending stays and trips are normal batch CRUD entities.",
      lifeForce:
        "Life Force is Forge's energy-budget and fatigue model. Read it through the dedicated life-force payload and update it through focused profile, weekday-template, and fatigue-signal routes rather than generic entity CRUD.",
      workbench:
        "Workbench is Forge's graph-flow execution system. Treat flows, runs, published outputs, node results, and latest-node-output reads as a dedicated API family instead of a normal entity-batch surface.",
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
    entityRouteModel: {
      batchCrudEntities: [
        "goal",
        "project",
        "task",
        "strategy",
        "habit",
        "tag",
        "note",
        "insight",
        "calendar_event",
        "work_block_template",
        "task_timebox",
        "psyche_value",
        "behavior_pattern",
        "behavior",
        "belief_entry",
        "mode_profile",
        "mode_guide_session",
        "event_type",
        "emotion_definition",
        "trigger_report",
        "preference_catalog",
        "preference_catalog_item",
        "preference_context",
        "preference_item",
        "questionnaire_instrument",
        "sleep_session",
        "workout_session"
      ],
      batchRoutes: {
        search: "/api/v1/entities/search",
        create: "/api/v1/entities/create",
        update: "/api/v1/entities/update",
        delete: "/api/v1/entities/delete",
        restore: "/api/v1/entities/restore"
      },
      specializedCrudEntities: {
        wiki_page: {
          create: "/api/v1/wiki/pages",
          update: "/api/v1/wiki/pages/:id",
          read: "/api/v1/wiki/pages/:id"
        },
        calendar_connection: {
          list: "/api/v1/calendar/connections",
          create: "/api/v1/calendar/connections",
          update: "/api/v1/calendar/connections/:id",
          delete: "/api/v1/calendar/connections/:id"
        }
      },
      actionEntities: {
        task_run: {
          readModel: "/api/v1/operator/context",
          actions: {
            start: "/api/v1/tasks/:taskId/runs",
            heartbeat: "/api/v1/task-runs/:id/heartbeat",
            focus: "/api/v1/task-runs/:id/focus",
            complete: "/api/v1/task-runs/:id/complete",
            release: "/api/v1/task-runs/:id/release"
          }
        },
        questionnaire_run: {
          read: "/api/v1/psyche/questionnaire-runs/:id",
          actions: {
            start: "/api/v1/psyche/questionnaires/:id/runs",
            update: "/api/v1/psyche/questionnaire-runs/:id",
            complete: "/api/v1/psyche/questionnaire-runs/:id/complete"
          }
        },
        preferences: {
          workspace: "/api/v1/preferences/workspace",
          actions: {
            startGame: "/api/v1/preferences/game/start",
            mergeContexts: "/api/v1/preferences/contexts/merge",
            enqueueFromEntity: "/api/v1/preferences/items/from-entity",
            submitJudgment: "/api/v1/preferences/judgments",
            submitSignal: "/api/v1/preferences/signals",
            overrideScore: "/api/v1/preferences/items/:id/score"
          }
        },
        questionnaires: {
          list: "/api/v1/psyche/questionnaires",
          detail: "/api/v1/psyche/questionnaires/:id",
          actions: {
            clone: "/api/v1/psyche/questionnaires/:id/clone",
            ensureDraft: "/api/v1/psyche/questionnaires/:id/draft",
            publishDraft: "/api/v1/psyche/questionnaires/:id/publish"
          }
        },
        selfObservation: {
          read: "/api/v1/psyche/self-observation/calendar",
          writeModel:
            "Create or update an observed note with frontmatter.observedAt. Manual reflections usually carry the Self-observation tag, while movement sync can also publish rolling observed notes tagged movement."
        }
      },
      specializedDomainSurfaces: {
        movement: {
          summary:
            "Dedicated movement workspace API. Use these routes for stays, trips, time-in-place questions, visited places, trip detail, selection aggregates, user-defined overlays, and repair actions on already-recorded movement data.",
          readRoutes: {
            day: "/api/v1/movement/day",
            month: "/api/v1/movement/month",
            allTime: "/api/v1/movement/all-time",
            timeline: "/api/v1/movement/timeline",
            places: "/api/v1/movement/places",
            tripDetail: "/api/v1/movement/trips/:id",
            selection: "/api/v1/movement/selection",
            settings: "/api/v1/movement/settings"
          },
          writeRoutes: {
            placeCreate: "/api/v1/movement/places",
            placeUpdate: "/api/v1/movement/places/:id",
            userBoxCreate: "/api/v1/movement/user-boxes",
            userBoxPreflight: "/api/v1/movement/user-boxes/preflight",
            userBoxUpdate: "/api/v1/movement/user-boxes/:id",
            automaticBoxInvalidate:
              "/api/v1/movement/automatic-boxes/:id/invalidate",
            stayUpdate: "/api/v1/movement/stays/:id",
            tripUpdate: "/api/v1/movement/trips/:id",
            tripPointUpdate: "/api/v1/movement/trips/:id/points/:pointId"
          },
          notes: [
            "Movement is not a normal batch CRUD entity family. It is a dedicated record of stays and trips: a stay means the user remained in the same place for a span of time, and a trip means they traveled between places.",
            "Use /api/v1/movement/day, /month, /all-time, /timeline, or /selection when the user wants behavioral answers such as how long they stayed at home, when they traveled, which places dominated a period, or what happened across a selected span.",
            "Use the movement write routes when the user wants to add a place or manual overlay, update a specific stay or trip, repair one recorded movement span, or attach movement context to another Forge record. If the user is filling a missing-data gap, the usual write path is a user-defined overlay box rather than a raw stay or trip patch.",
            "For an explicit statement like 'that missing block was me staying home', do not reopen broad intake. Preflight only if timing overlap is unclear, then create a user-defined `stay` box for that interval and read the updated timeline back."
          ]
        },
        lifeForce: {
          summary:
            "Dedicated life-force API. Use it to read the current energy budget, drains, recommendations, and warnings, then patch only the parts that are meant to be user-controlled.",
          readRoutes: {
            overview: "/api/v1/life-force"
          },
          writeRoutes: {
            profile: "/api/v1/life-force/profile",
            weekdayTemplate: "/api/v1/life-force/templates/:weekday",
            fatigueSignal: "/api/v1/life-force/fatigue-signals"
          },
          notes: [
            "Life Force is a focused domain surface, not a batch CRUD entity type.",
            "Use GET /api/v1/life-force for the current overview payload with stats, drains, recommendations, and current-curve state.",
            "Patch the profile only for durable personal settings, update weekday templates only for the curve itself, and post fatigue signals for real-time tired or recovered observations."
          ]
        },
        workbench: {
          summary:
            "Dedicated graph-flow API. Use it for flow catalog reads, flow CRUD, execution, run history, published outputs, node results, and latest successful node outputs.",
          readRoutes: {
            listFlows: "/api/v1/workbench/flows",
            flowById: "/api/v1/workbench/flows/:id",
            flowBySlug: "/api/v1/workbench/flows/by-slug/:slug",
            publishedOutput: "/api/v1/workbench/flows/:id/output",
            runs: "/api/v1/workbench/flows/:id/runs",
            runDetail: "/api/v1/workbench/flows/:id/runs/:runId",
            runNodes: "/api/v1/workbench/flows/:id/runs/:runId/nodes",
            nodeResult:
              "/api/v1/workbench/flows/:id/runs/:runId/nodes/:nodeId",
            latestNodeOutput:
              "/api/v1/workbench/flows/:id/nodes/:nodeId/output",
            boxCatalog: "/api/v1/workbench/catalog/boxes"
          },
          writeRoutes: {
            createFlow: "/api/v1/workbench/flows",
            updateFlow: "/api/v1/workbench/flows/:id",
            deleteFlow: "/api/v1/workbench/flows/:id",
            runFlow: "/api/v1/workbench/flows/:id/run",
            runByPayload: "/api/v1/workbench/run",
            chatFlow: "/api/v1/workbench/flows/:id/chat"
          },
          notes: [
            "Workbench is a dedicated execution surface, not a batch CRUD entity family.",
            "Use the flow routes when the agent needs stable public input contracts, published outputs, node-level results, or reusable execution history.",
            "Prefer the dedicated output and node-result routes over reverse-engineering raw traces."
          ]
        }
      },
      readModelOnlySurfaces: {
        sleepOverview: "/api/v1/health/sleep",
        sportsOverview: "/api/v1/health/fitness",
        selfObservation: "/api/v1/psyche/self-observation/calendar",
        calendarOverview: "/api/v1/calendar/overview",
        operatorOverview: "/api/v1/operator/overview",
        operatorContext: "/api/v1/operator/context"
      }
    },
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
          "Use a distinct actor label such as Albert (claw) so OpenClaw-originated work stays obvious in Forge provenance.",
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
          "Use a distinct actor label such as Albert (hermes) so Hermes-originated work stays obvious in Forge provenance.",
          "Hermes uses the same multi-user scoping rules and should pass userIds intentionally when working across humans and bots.",
          "The Forge relationship graph still decides whether Hermes may see, message, plan for, or affect another owner."
        ]
      }
    },
    verificationPaths: {
      context: "/api/v1/context",
      xpMetrics: "/api/v1/metrics/xp",
      weeklyReview: "/api/v1/reviews/weekly",
      sleepOverview: "/api/v1/health/sleep",
      sportsOverview: "/api/v1/health/fitness",
      lifeForce: "/api/v1/life-force",
      lifeForceProfile: "/api/v1/life-force/profile",
      lifeForceWeekdayTemplate: "/api/v1/life-force/templates/:weekday",
      lifeForceFatigueSignals: "/api/v1/life-force/fatigue-signals",
      movementDay: "/api/v1/movement/day",
      movementMonth: "/api/v1/movement/month",
      movementTimeline: "/api/v1/movement/timeline",
      movementAllTime: "/api/v1/movement/all-time",
      movementPlaces: "/api/v1/movement/places",
      movementTripDetail: "/api/v1/movement/trips/:id",
      movementSelection: "/api/v1/movement/selection",
      movementUserBoxPreflight: "/api/v1/movement/user-boxes/preflight",
      movementUserBoxUpdate: "/api/v1/movement/user-boxes/:id",
      movementAutomaticBoxInvalidate:
        "/api/v1/movement/automatic-boxes/:id/invalidate",
      movementStayUpdate: "/api/v1/movement/stays/:id",
      movementTripUpdate: "/api/v1/movement/trips/:id",
      movementTripPointUpdate: "/api/v1/movement/trips/:id/points/:pointId",
      workbenchFlows: "/api/v1/workbench/flows",
      workbenchFlowBySlug: "/api/v1/workbench/flows/by-slug/:slug",
      workbenchPublishedOutput: "/api/v1/workbench/flows/:id/output",
      workbenchRunDetail: "/api/v1/workbench/flows/:id/runs/:runId",
      workbenchNodeResult:
        "/api/v1/workbench/flows/:id/runs/:runId/nodes/:nodeId",
      workbenchLatestNodeOutput:
        "/api/v1/workbench/flows/:id/nodes/:nodeId/output",
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
        "forge_get_sleep_overview",
        "forge_get_sports_overview",
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
      healthWorkflow: [
        "forge_get_sleep_overview",
        "forge_get_sports_overview",
        "forge_update_sleep_session",
        "forge_update_workout_session"
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
        "When a Psyche entity needs understanding first, begin with one exploratory question before any working formulation, replacement belief, suggested title, or save pitch. Keep the opening reflection to one or two short sentences, stay in plain prose instead of bullets or numbered lists, keep that first reply short, do not mention Forge search or save structure yet, avoid colons or list-shaped phrasing, prefer what/when/how over why until the experience is grounded, wait for the user's answer before offering a fuller formulation, ask permission before moving from charged exploration into naming or challenge when needed, do not widen into adjacent entities until the current one has a working sentence the user recognizes, and once the lived experience is coherent stop deepening and help the user name it cleanly. If the user accepts the wording, move toward the save instead of reopening deeper exploration.",
      psycheOpeningQuestionRule:
        "Prefer a concrete opening question tied to the entity: ask when the value mattered, what happened the last time the pattern appeared, what cue or body signal came first before the behavior, what the belief starts saying about self or outcome, what feels most at risk inside the mode, what the part is trying to get the user to do or stop doing, or where the shift began in the incident. Reflect briefly before the question, choose one follow-up lane at a time, say what is becoming clearer before the next deeper question, and if several Psyche entities are visible hold the adjacent ones lightly until the main container is clear.",
      duplicateCheckRoute: "/api/v1/entities/search",
      uiSuggestionRule:
        "offer_visual_ui_when_review_or_editing_would_be_easier",
      browserFallbackRule:
        "Do not open the Forge UI or a browser just to create or update normal entities when the batch entity tools can do the job. Batch CRUD is the default for simple entities; avoid spamming the agent with a large one-route-per-entity mental model.",
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
        "Restore soft-deleted entities through the restore route or the settings bin. Immediate-delete entities such as calendar_event, work_block_template, task_timebox, sleep_session, and workout_session do not enter the bin.",
      entityDeleteSummary:
        "Entity DELETE routes default to soft delete. Pass mode=hard only when permanent removal is intended. Immediate-delete entities skip the bin, and calendar-event deletes still remove remote projections downstream.",
      batchingRule:
        "forge_create_entities, forge_update_entities, forge_delete_entities, and forge_restore_entities all accept operations as arrays. Batch CRUD is the default for simple entities, so batch multiple related mutations together instead of reaching for a long list of entity-specific routes.",
      searchRule:
        "forge_search_entities accepts searches as an array. Search before create or update when duplicate risk exists.",
      createRule:
        "Each create operation must include entityType and full data. entityType alone is not enough. This includes calendar_event, work_block_template, task_timebox, sleep_session, workout_session, preference CRUD entities, and questionnaire_instrument alongside the usual planning and Psyche entities.",
      updateRule:
        "Each update operation must include entityType, id, and patch. For projects, lifecycle changes are status patches: active to restart, paused to suspend, completed to finish. Keep task and project scheduling rules on those same patch payloads. Calendar-event updates still run downstream provider projection sync, and manual health-session field edits belong on the batch route by default rather than on the reflective review helpers.",
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
  const dashboard = getDashboard({ userIds });
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
    dashboard,
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
    activity: dashboard.recentActivity,
    lifeForce: buildLifeForcePayload(new Date(), userIds)
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
  getSettings();
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
  await app.register(multipart);
  enforceDiagnosticLogRetention({ force: true });
  const diagnosticRetentionTimer = setInterval(() => {
    try {
      enforceDiagnosticLogRetention({ force: true });
    } catch {
      // Diagnostics cleanup should never bring down the server loop.
    }
  }, DIAGNOSTIC_LOG_RETENTION_SWEEP_INTERVAL_MS);
  diagnosticRetentionTimer.unref?.();
  const activeCronRuns = new Set<string>();
  const cronSchedulerTimer = setInterval(() => {
    const now = new Date();
    for (const processor of listAiProcessors()) {
      if (
        processor.triggerMode !== "cron" ||
        !processor.endpointEnabled ||
        !processor.cronExpression.trim() ||
        activeCronRuns.has(processor.id)
      ) {
        continue;
      }
      try {
        const interval = CronExpressionParser.parse(processor.cronExpression, {
          currentDate:
            processor.lastRunAt &&
            Number.isFinite(Date.parse(processor.lastRunAt))
              ? processor.lastRunAt
              : new Date(now.getTime() - 60_000).toISOString()
        });
        const nextDueAt = interval.next().toDate();
        if (nextDueAt.getTime() > now.getTime()) {
          continue;
        }
        activeCronRuns.add(processor.id);
        void runAiProcessor(
          processor.id,
          { input: "", context: {}, widgetSnapshots: {} },
          {
            llm: managers.llm,
            secrets: managers.secrets
          },
          { trigger: "cron" }
        ).finally(() => {
          activeCronRuns.delete(processor.id);
        });
      } catch {
        continue;
      }
    }
  }, 30_000);
  cronSchedulerTimer.unref?.();
  const dataBackupTimer = setInterval(
    () => {
      void maybeRunAutomaticBackup().catch(() => {
        // Automatic backup sweeps should never crash the runtime loop.
      });
    },
    5 * 60 * 1000
  );
  dataBackupTimer.unref?.();
  void maybeRunAutomaticBackup().catch(() => {
    // Ignore startup backup failures; the Data settings surface exposes recovery.
  });
  app.addHook("onClose", async () => {
    clearInterval(diagnosticRetentionTimer);
    clearInterval(cronSchedulerTimer);
    clearInterval(dataBackupTimer);
    taskRunWatchdog?.stop();
    await managers.backgroundJobs.stop();
  });

  const enqueueWikiIngestJob = (jobId: string) => {
    managers.backgroundJobs.enqueue({
      id: jobId,
      label: `Wiki ingest ${jobId}`,
      handler: async () => {
        await processWikiIngestJob(jobId, { llm: managers.llm });
      }
    });
  };

  for (const pendingJob of listWikiIngestJobs({ limit: 100 })) {
    if (["queued", "processing"].includes(pendingJob.job.status)) {
      enqueueWikiIngestJob(pendingJob.job.id);
    }
  }

  const shouldSkipAutomaticDiagnosticRoute = (url: string | undefined) => {
    if (!url) {
      return false;
    }
    return (
      url.startsWith("/api/v1/diagnostics/logs") ||
      url === "/api/health" ||
      url === "/api/v1/health" ||
      url.startsWith("/api/v1/events/meta")
    );
  };

  app.addHook("onRequest", async (request) => {
    (
      request as typeof request & { diagnosticStartedAt?: bigint }
    ).diagnosticStartedAt = process.hrtime.bigint();
  });

  app.addHook("onResponse", async (request, reply) => {
    const routeUrl = request.routeOptions.url || request.url;
    if (shouldSkipAutomaticDiagnosticRoute(routeUrl)) {
      return;
    }

    const startedAt = (
      request as typeof request & { diagnosticStartedAt?: bigint }
    ).diagnosticStartedAt;
    const durationMs =
      typeof startedAt === "bigint"
        ? Number(process.hrtime.bigint() - startedAt) / 1_000_000
        : null;
    const source = normalizeDiagnosticSource(request.headers["x-forge-source"]);

    try {
      recordDiagnosticLog({
        level:
          reply.statusCode >= 500
            ? "error"
            : reply.statusCode >= 400
              ? "warning"
              : "debug",
        source,
        scope: "api_request",
        eventKey: `http_${request.method.toLowerCase()}`,
        message: createDiagnosticMessage({
          method: request.method,
          route: routeUrl,
          statusCode: reply.statusCode
        }),
        route: routeUrl,
        requestId: request.id,
        details: {
          method: request.method,
          rawUrl: request.url,
          statusCode: reply.statusCode,
          durationMs:
            typeof durationMs === "number"
              ? Number(durationMs.toFixed(2))
              : null,
          userAgent:
            typeof request.headers["user-agent"] === "string"
              ? request.headers["user-agent"]
              : null
        }
      });
    } catch {
      // Avoid surfacing diagnostics failures as request failures.
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const validationIssues =
      error instanceof ZodError ? formatValidationIssues(error) : undefined;
    const statusCode = isHttpError(error)
      ? error.statusCode
      : isManagerError(error)
        ? error.statusCode
        : error instanceof ZodError
          ? 400
          : 500;
    const routeUrl = request.routeOptions.url || request.url;
    if (!shouldSkipAutomaticDiagnosticRoute(routeUrl)) {
      try {
        recordDiagnosticLog({
          level: statusCode >= 500 ? "error" : "warning",
          source: normalizeDiagnosticSource(request.headers["x-forge-source"]),
          scope: "api_error",
          eventKey: isHttpError(error)
            ? error.code
            : isManagerError(error)
              ? error.code
              : statusCode === 400
                ? "invalid_request"
                : "internal_error",
          message: getErrorMessage(error),
          route: routeUrl,
          functionName: "setErrorHandler",
          requestId: request.id,
          details: {
            statusCode,
            validationIssues:
              validationIssues?.map((issue) => ({
                path: issue.path,
                message: issue.message
              })) ?? [],
            error: serializeDiagnosticError(error)
          }
        });
      } catch {
        // Avoid cascading on the error path.
      }
    }
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
              storageRoot: getEffectiveDataRoot(),
              basePath: runtimeConfig.basePath
            }
          }
        : {})
    })
  );
  app.get("/api/v1/doctor", async (request) => {
    requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["read", "write"],
      { route: "/api/v1/doctor" }
    );
    const settings = getSettings();
    const settingsFile = getSettingsFileStatus();
    const runtime = {
      pid: process.pid,
      storageRoot: getEffectiveDataRoot(),
      dataDir: resolveDataDir(),
      databasePath: resolveDatabasePathForDataRoot(),
      basePath: runtimeConfig.basePath,
      devWebOrigin: process.env.FORGE_DEV_WEB_ORIGIN?.trim() || null
    };
    const health = buildHealthPayload(taskRunWatchdog, {
      apiVersion: "v1",
      backend: "forge-node-runtime",
      runtime
    });
    const warnings: string[] = [];
    if (!settingsFile.valid) {
      warnings.push(
        `forge.json is invalid at ${settingsFile.path}. Forge ignored file precedence until the JSON is repaired or rewritten.`
      );
    }
    if (settingsFile.syncState === "applied_file_overrides") {
      warnings.push(
        "forge.json overrode one or more persisted database settings on this run."
      );
    }
    if (health.ok === false) {
      warnings.push("The task-run watchdog reported degraded health.");
    }
    return {
      doctor: {
        ok: health.ok && settingsFile.valid,
        now: new Date().toISOString(),
        runtime,
        health,
        settingsFile,
        settingsSummary: {
          themePreference: settings.themePreference,
          localePreference: settings.localePreference,
          operatorName: settings.profile.operatorName,
          maxActiveTasks: settings.execution.maxActiveTasks,
          timeAccountingMode: settings.execution.timeAccountingMode,
          psycheAuthRequired: settings.security.psycheAuthRequired,
          webAppUrl: `http://127.0.0.1:${runtimeConfig.port}${runtimeConfig.basePath}`
        },
        warnings
      }
    };
  });

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
  app.get("/api/v1/life-force", async (request) => ({
    lifeForce: buildLifeForcePayload(
      new Date(),
      resolveScopedUserIds(request.query as Record<string, unknown>)
    ),
    templates: listLifeForceTemplates(
      resolveLifeForceUser(
        resolveScopedUserIds(request.query as Record<string, unknown>)
      ).id
    )
  }));
  app.patch("/api/v1/life-force/profile", async (request) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/life-force/profile" }
    );
    const userId = resolveLifeForceUser(
      resolveScopedUserIds(request.query as Record<string, unknown>)
    ).id;
    return {
      lifeForce: updateLifeForceProfile(
        userId,
        lifeForceProfilePatchSchema.parse(request.body ?? {})
      ),
      actor: auth.session?.actorLabel ?? auth.actor ?? "Forge"
    };
  });
  app.put("/api/v1/life-force/templates/:weekday", async (request) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/life-force/templates/:weekday" }
    );
    const weekday = Number((request.params as { weekday: string }).weekday);
    return {
      weekday,
      points: updateLifeForceTemplate(
        resolveLifeForceUser(
          resolveScopedUserIds(request.query as Record<string, unknown>)
        ).id,
        weekday,
        lifeForceTemplateUpdateSchema.parse(request.body ?? {})
      ),
      actor: auth.session?.actorLabel ?? auth.actor ?? "Forge"
    };
  });
  app.post("/api/v1/life-force/fatigue-signals", async (request) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/life-force/fatigue-signals" }
    );
    return {
      lifeForce: createFatigueSignal(
        resolveLifeForceUser(
          resolveScopedUserIds(request.query as Record<string, unknown>)
        ).id,
        fatigueSignalCreateSchema.parse(request.body ?? {})
      ),
      actor: auth.session?.actorLabel ?? auth.actor ?? "Forge"
    };
  });
  app.get("/api/v1/knowledge-graph", async (request) => {
    const query = request.query as Record<string, unknown>;
    const readString = (value: unknown) =>
      typeof value === "string" ? value.trim() : "";
    const readList = (key: string) => {
      const value = query[key];
      const values = Array.isArray(value) ? value : [value];
      return values
        .flatMap((entry) => (typeof entry === "string" ? entry.split(",") : []))
        .map((entry) => entry.trim())
        .filter(Boolean);
    };
    const limitRaw = readString(query.limit);
    const limit =
      limitRaw.length > 0 && Number.isFinite(Number(limitRaw))
        ? Math.max(1, Math.min(2000, Math.round(Number(limitRaw))))
        : null;

    return {
      graph: buildKnowledgeGraph(resolveScopedUserIds(query), {
        q: readString(query.q) || null,
        entityKinds: readList(
          "entityKind"
        ) as KnowledgeGraphQuery["entityKinds"],
        relationKinds: readList(
          "relationKind"
        ) as KnowledgeGraphQuery["relationKinds"],
        tags: readList("tag"),
        owners: readList("owner"),
        updatedFrom: readString(query.updatedFrom) || null,
        updatedTo: readString(query.updatedTo) || null,
        limit,
        focusNodeId: readString(query.focusNodeId) || null
      })
    };
  });
  app.get("/api/v1/knowledge-graph/focus", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const entityType =
      typeof query.entityType === "string" ? query.entityType.trim() : "";
    const entityId =
      typeof query.entityId === "string" ? query.entityId.trim() : "";

    if (!entityType || !entityId) {
      reply.code(400);
      return {
        error: "entityType and entityId are required."
      };
    }

    return {
      focus: buildKnowledgeGraphFocus(
        entityType as KnowledgeGraphEntityType,
        entityId,
        resolveScopedUserIds(query)
      )
    };
  });
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
  app.post("/api/v1/health/sleep", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/health/sleep" }
    );
    const sleep = createSleepSession(
      createSleepSessionSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    reply.code(201);
    return { sleep };
  });
  app.get("/api/v1/health/sleep/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const sleep = getSleepSessionById(id);
    if (!sleep) {
      reply.code(404);
      return { error: "Sleep session not found" };
    }
    return { sleep };
  });
  app.get("/api/v1/health/sleep/:id/raw", async (request, reply) => {
    const { id } = request.params as { id: string };
    const detail = getSleepSessionDetailById(id);
    if (!detail) {
      reply.code(404);
      return { error: "Sleep session not found" };
    }
    return detail;
  });
  app.get("/api/v1/health/fitness", async (request) => ({
    fitness: getFitnessViewData(
      resolveScopedUserIds(request.query as Record<string, unknown>)
    )
  }));
  app.get("/api/v1/health/vitals", async (request) => ({
    vitals: getVitalsViewData(
      resolveScopedUserIds(request.query as Record<string, unknown>)
    )
  }));
  app.post("/api/v1/health/workouts", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/health/workouts" }
    );
    const workout = createWorkoutSession(
      createWorkoutSessionSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    reply.code(201);
    return { workout };
  });
  app.get("/api/v1/health/workouts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const workout = getWorkoutSessionById(id);
    if (!workout) {
      reply.code(404);
      return { error: "Workout session not found" };
    }
    return { workout };
  });
  app.get("/api/v1/movement/day", async (request) => {
    const query = request.query as Record<string, unknown>;
    return {
      movement: getMovementDayDetail({
        date: typeof query.date === "string" ? query.date : undefined,
        userIds: resolveScopedUserIds(query)
      })
    };
  });
  app.get("/api/v1/movement/month", async (request) => {
    const query = request.query as Record<string, unknown>;
    return {
      movement: getMovementMonthSummary({
        month: typeof query.month === "string" ? query.month : undefined,
        userIds: resolveScopedUserIds(query)
      })
    };
  });
  app.get("/api/v1/movement/all-time", async (request) => ({
    movement: getMovementAllTimeSummary(
      resolveScopedUserIds(request.query as Record<string, unknown>)
    )
  }));
  app.get("/api/v1/screen-time/day", async (request) => {
    const query = request.query as Record<string, unknown>;
    return {
      screenTime: getScreenTimeDayDetail({
        date: typeof query.date === "string" ? query.date : undefined,
        userIds: resolveScopedUserIds(query)
      })
    };
  });
  app.get("/api/v1/screen-time/month", async (request) => {
    const query = request.query as Record<string, unknown>;
    return {
      screenTime: getScreenTimeMonthSummary({
        month: typeof query.month === "string" ? query.month : undefined,
        userIds: resolveScopedUserIds(query)
      })
    };
  });
  app.get("/api/v1/screen-time/all-time", async (request) => ({
    screenTime: getScreenTimeAllTimeSummary(
      resolveScopedUserIds(request.query as Record<string, unknown>)
    )
  }));
  app.get("/api/v1/screen-time/settings", async (request) => ({
    settings: getScreenTimeSettings(
      resolveScopedUserIds(request.query as Record<string, unknown>)
    )
  }));
  app.patch("/api/v1/screen-time/settings", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/screen-time/settings"
    });
    const userId =
      resolveScopedUserIds(request.query as Record<string, unknown>)?.[0] ??
      getDefaultUser().id;
    return {
      settings: updateScreenTimeSettings(
        userId,
        screenTimeSettingsPatchSchema.parse(request.body ?? {})
      )
    };
  });
  app.get("/api/v1/movement/timeline", async (request) => {
    const parsed = movementTimelineQuerySchema.parse(request.query ?? {});
    return {
      movement: getMovementTimeline({
        ...parsed,
        userIds:
          parsed.userIds.length > 0
            ? parsed.userIds
            : (resolveScopedUserIds(request.query as Record<string, unknown>) ??
              [])
      })
    };
  });
  app.get("/api/v1/movement/settings", async (request) => ({
    settings: getMovementSettings(
      resolveScopedUserIds(request.query as Record<string, unknown>)
    )
  }));
  app.patch("/api/v1/movement/settings", async (request) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/movement/settings" }
    );
    const userId =
      resolveScopedUserIds(request.query as Record<string, unknown>)?.[0] ??
      getDefaultUser().id;
    return {
      settings: updateMovementSettings(
        userId,
        movementSettingsPatchSchema.parse(request.body ?? {}),
        toActivityContext(auth)
      )
    };
  });
  app.get("/api/v1/movement/places", async (request) => ({
    places: listMovementPlaces(
      resolveScopedUserIds(request.query as Record<string, unknown>)
    )
  }));
  app.post("/api/v1/movement/places", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/movement/places" }
    );
    const userId =
      resolveScopedUserIds(request.query as Record<string, unknown>)?.[0] ??
      getDefaultUser().id;
    reply.code(201);
    return {
      place: createMovementPlace(
        {
          ...movementPlaceMutationSchema.parse(request.body ?? {}),
          userId,
          source: "user"
        },
        toActivityContext(auth)
      )
    };
  });
  app.patch("/api/v1/movement/places/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/movement/places/:id" }
    );
    const { id } = request.params as { id: string };
    const place = updateMovementPlace(
      id,
      movementPlacePatchSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    if (!place) {
      reply.code(404);
      return { error: "Movement place not found" };
    }
    return { place };
  });
  app.post("/api/v1/movement/user-boxes", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/movement/user-boxes" }
    );
    const userId =
      resolveScopedUserIds(request.query as Record<string, unknown>)?.[0] ??
      getDefaultUser().id;
    reply.code(201);
    const created = createMovementUserBox(
      {
        ...movementUserBoxCreateSchema.parse(request.body ?? {}),
        userId
      },
      toActivityContext(auth)
    );
    return {
      box: resolveMovementTimelineSegmentForBox(userId, created.id) ?? created
    };
  });
  app.post("/api/v1/movement/user-boxes/preflight", async (request) => {
    requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/movement/user-boxes/preflight" }
    );
    const userId =
      resolveScopedUserIds(request.query as Record<string, unknown>)?.[0] ??
      getDefaultUser().id;
    return {
      preflight: analyzeMovementUserBoxPreflight({
        ...movementUserBoxPreflightSchema.parse(request.body ?? {}),
        userId
      })
    };
  });
  app.patch("/api/v1/movement/user-boxes/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/movement/user-boxes/:id" }
    );
    const userId =
      resolveScopedUserIds(request.query as Record<string, unknown>)?.[0] ??
      getDefaultUser().id;
    const { id } = request.params as { id: string };
    const box = updateMovementUserBox(
      id,
      movementUserBoxPatchSchema.parse(request.body ?? {}),
      toActivityContext(auth),
      { userId }
    );
    if (!box) {
      reply.code(404);
      return { error: "Movement user box not found" };
    }
    return {
      box: resolveMovementTimelineSegmentForBox(userId, box.id) ?? box
    };
  });
  app.delete("/api/v1/movement/user-boxes/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/movement/user-boxes/:id" }
    );
    const userId =
      resolveScopedUserIds(request.query as Record<string, unknown>)?.[0] ??
      getDefaultUser().id;
    const { id } = request.params as { id: string };
    const result = deleteMovementUserBox(id, toActivityContext(auth), { userId });
    if (!result) {
      reply.code(404);
      return { error: "Movement user box not found" };
    }
    return result;
  });
  app.post(
    "/api/v1/movement/automatic-boxes/:id/invalidate",
    async (request, reply) => {
      const auth = requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["write"],
        { route: "/api/v1/movement/automatic-boxes/:id/invalidate" }
      );
      const userId =
        resolveScopedUserIds(request.query as Record<string, unknown>)?.[0] ??
        getDefaultUser().id;
      const { id } = request.params as { id: string };
      const result = invalidateAutomaticMovementBox(
        id,
        movementAutomaticBoxInvalidateSchema.parse(request.body ?? {}),
        toActivityContext(auth),
        { userId }
      );
      if (!result) {
        reply.code(404);
        return { error: "Automatic movement box not found" };
      }
      reply.code(201);
      return {
        box: resolveMovementTimelineSegmentForBox(userId, result.box.id) ?? result.box
      };
    }
  );
  app.patch("/api/v1/movement/stays/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/movement/stays/:id" }
    );
    const { id } = request.params as { id: string };
    const stay = updateMovementStay(
      id,
      movementStayPatchSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    if (!stay) {
      reply.code(404);
      return { error: "Movement stay not found" };
    }
    return { stay };
  });
  app.delete("/api/v1/movement/stays/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/movement/stays/:id" }
    );
    const { id } = request.params as { id: string };
    const result = deleteMovementStay(id, toActivityContext(auth));
    if (!result) {
      reply.code(404);
      return { error: "Movement stay not found" };
    }
    return result;
  });
  app.patch("/api/v1/movement/trips/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/movement/trips/:id" }
    );
    const { id } = request.params as { id: string };
    const trip = updateMovementTrip(
      id,
      movementTripPatchSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    if (!trip) {
      reply.code(404);
      return { error: "Movement trip not found" };
    }
    return { trip };
  });
  app.delete("/api/v1/movement/trips/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/movement/trips/:id" }
    );
    const { id } = request.params as { id: string };
    const result = deleteMovementTrip(id, toActivityContext(auth));
    if (!result) {
      reply.code(404);
      return { error: "Movement trip not found" };
    }
    return result;
  });
  app.patch(
    "/api/v1/movement/trips/:id/points/:pointId",
    async (request, reply) => {
      const auth = requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["write"],
        { route: "/api/v1/movement/trips/:id/points/:pointId" }
      );
      const { id, pointId } = request.params as { id: string; pointId: string };
      const result = updateMovementTripPoint(
        id,
        pointId,
        movementTripPointPatchSchema.parse(request.body ?? {}),
        toActivityContext(auth)
      );
      if (!result) {
        reply.code(404);
        return { error: "Movement datapoint not found" };
      }
      return result;
    }
  );
  app.delete(
    "/api/v1/movement/trips/:id/points/:pointId",
    async (request, reply) => {
      const auth = requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["write"],
        { route: "/api/v1/movement/trips/:id/points/:pointId" }
      );
      const { id, pointId } = request.params as { id: string; pointId: string };
      const result = deleteMovementTripPoint(
        id,
        pointId,
        toActivityContext(auth)
      );
      if (!result) {
        reply.code(404);
        return { error: "Movement datapoint not found" };
      }
      return result;
    }
  );
  app.get("/api/v1/movement/trips/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const movement = getMovementTripDetail(id);
    if (!movement) {
      reply.code(404);
      return { error: "Movement trip not found" };
    }
    return { movement };
  });
  app.get("/api/v1/movement/boxes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const movement = getMovementBoxDetail(
      id,
      resolveScopedUserIds(request.query as Record<string, unknown>) ?? []
    );
    if (!movement) {
      reply.code(404);
      return { error: "Movement box not found" };
    }
    return { movement };
  });
  app.post("/api/v1/movement/selection", async (request) => ({
    movement: getMovementSelectionAggregate(
      movementSelectionAggregateSchema.parse(request.body ?? {})
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
  app.patch(
    "/api/v1/health/pairing-sessions/:id/sources/:source",
    async (request, reply) => {
      requireOperatorSession(request.headers as Record<string, unknown>, {
        route: "/api/v1/health/pairing-sessions/:id/sources/:source"
      });
      const params = z
        .object({
          id: z.string().trim().min(1),
          source: companionSourceKeySchema
        })
        .parse(request.params ?? {});
      const session = patchCompanionPairingSourceState(
        params.id,
        params.source,
        patchCompanionPairingSourceStateSchema.parse(request.body ?? {})
      );
      if (!session) {
        reply.code(404);
        return { error: "Companion pairing session not found" };
      }
      return { session };
    }
  );
  app.post("/api/v1/health/pairing-sessions/revoke-all", async (request) => {
    const auth = requireOperatorSession(
      request.headers as Record<string, unknown>,
      {
        route: "/api/v1/health/pairing-sessions/revoke-all"
      }
    );
    return revokeAllCompanionPairingSessions(
      revokeAllCompanionPairingSessionsSchema.parse(request.body ?? {}),
      {
        actor: auth.actor ?? null,
        source: "ui"
      }
    );
  });
  app.post("/api/v1/mobile/pairing/verify", async (request) => ({
    pairing: verifyCompanionPairing(
      verifyCompanionPairingSchema.parse(request.body ?? {})
    )
  }));
  app.post("/api/v1/mobile/movement/bootstrap", async (request) => {
    const parsed = movementMobileBootstrapSchema.parse(request.body ?? {});
    const pairing = requireValidPairing(parsed.sessionId, parsed.pairingToken);
    return {
      pairingSession: getCompanionPairingSessionById(pairing.id),
      movement: getMovementMobileBootstrap(pairing)
    };
  });
  app.post("/api/v1/mobile/source-state", async (request) => ({
    pairingSession: updateMobileCompanionSourceState(
      updateMobileCompanionSourceStateSchema.parse(request.body ?? {})
    )
  }));
  app.post("/api/v1/mobile/movement/places", async (request, reply) => {
    const parsed = movementMobilePlaceMutationSchema.parse(request.body ?? {});
    const pairing = requireValidPairing(parsed.sessionId, parsed.pairingToken);
    reply.code(201);
    return {
      place: createMovementPlace(
        {
          ...parsed.place,
          userId: pairing.user_id,
          source: "companion"
        },
        {
          actor: "Forge Companion",
          source: "system"
        }
      )
    };
  });
  app.post("/api/v1/mobile/movement/timeline", async (request) => {
    const parsed = movementMobileTimelineSchema.parse(request.body ?? {});
    const pairing = requireValidPairing(parsed.sessionId, parsed.pairingToken);
    return {
      movement: getMovementTimeline({
        before: parsed.before,
        limit: parsed.limit,
        userIds: [pairing.user_id]
      })
    };
  });
  app.post("/api/v1/mobile/movement/boxes/:id/detail", async (request, reply) => {
    const parsed = movementMobileBootstrapSchema.parse(request.body ?? {});
    const pairing = requireValidPairing(parsed.sessionId, parsed.pairingToken);
    const { id } = request.params as { id: string };
    const movement = getMovementBoxDetail(id, [pairing.user_id]);
    if (!movement) {
      reply.code(404);
      return { error: "Movement box not found" };
    }
    return { movement };
  });
  app.post("/api/v1/mobile/movement/user-boxes", async (request, reply) => {
    const parsed = movementMobileUserBoxCreateSchema.parse(request.body ?? {});
    const pairing = requireValidPairing(parsed.sessionId, parsed.pairingToken);
    reply.code(201);
    const created = createMovementUserBox(
      {
        ...parsed.box,
        userId: pairing.user_id
      },
      {
        actor: "Forge Companion",
        source: "system"
      }
    );
    return {
      box:
        resolveMovementTimelineSegmentForBox(pairing.user_id, created.id) ?? created
    };
  });
  app.post("/api/v1/mobile/movement/user-boxes/preflight", async (request) => {
    const parsed = movementMobileUserBoxPreflightSchema.parse(request.body ?? {});
    const pairing = requireValidPairing(parsed.sessionId, parsed.pairingToken);
    return {
      preflight: analyzeMovementUserBoxPreflight({
        ...parsed.draft,
        userId: pairing.user_id
      })
    };
  });
  app.patch("/api/v1/mobile/movement/user-boxes/:id", async (request, reply) => {
    const parsed = movementMobileUserBoxPatchSchema.parse(request.body ?? {});
    const pairing = requireValidPairing(parsed.sessionId, parsed.pairingToken);
    const { id } = request.params as { id: string };
    const box = updateMovementUserBox(
      id,
      parsed.patch,
      {
        actor: "Forge Companion",
        source: "system"
      },
      { userId: pairing.user_id }
    );
    if (!box) {
      reply.code(404);
      return { error: "Movement user box not found" };
    }
    return {
      box: resolveMovementTimelineSegmentForBox(pairing.user_id, box.id) ?? box
    };
  });
  app.delete("/api/v1/mobile/movement/user-boxes/:id", async (request, reply) => {
    const parsed = movementMobileBootstrapSchema.parse(request.body ?? {});
    const pairing = requireValidPairing(parsed.sessionId, parsed.pairingToken);
    const { id } = request.params as { id: string };
    const result = deleteMovementUserBox(
      id,
      {
        actor: "Forge Companion",
        source: "system"
      },
      { userId: pairing.user_id }
    );
    if (!result) {
      reply.code(404);
      return { error: "Movement user box not found" };
    }
    return result;
  });
  app.post(
    "/api/v1/mobile/movement/automatic-boxes/:id/invalidate",
    async (request, reply) => {
      const parsed = movementMobileAutomaticBoxInvalidateSchema.parse(
        request.body ?? {}
      );
      const pairing = requireValidPairing(parsed.sessionId, parsed.pairingToken);
      const { id } = request.params as { id: string };
      const result = invalidateAutomaticMovementBox(
        id,
        parsed.invalidate,
        {
          actor: "Forge Companion",
          source: "system"
        },
        { userId: pairing.user_id }
      );
      if (!result) {
        reply.code(404);
        return { error: "Automatic movement box not found" };
      }
      reply.code(201);
      return {
        box:
          resolveMovementTimelineSegmentForBox(pairing.user_id, result.box.id) ??
          result.box
      };
    }
  );
  app.patch("/api/v1/mobile/movement/stays/:id", async (request, reply) => {
    reply.code(409);
    return {
      error:
        "Recorded stays are immutable in product UI. Create or edit a user-defined movement box instead."
    };
  });
  app.patch("/api/v1/mobile/movement/trips/:id", async (request, reply) => {
    reply.code(409);
    return {
      error:
        "Recorded moves are immutable in product UI. Create or edit a user-defined movement box instead."
    };
  });
  app.post("/api/v1/mobile/watch/bootstrap", async (request) => {
    const parsed = mobileWatchBootstrapSchema.parse(request.body ?? {});
    const pairing = requireValidPairing(parsed.sessionId, parsed.pairingToken);
    assertWatchReady(pairing);
    return {
      watch: buildWatchBootstrap(pairing)
    };
  });
  app.post(
    "/api/v1/mobile/watch/habits/:id/check-ins",
    async (request, reply) => {
      const parsed = mobileWatchHabitCheckInSchema.parse(request.body ?? {});
      const pairing = requireValidPairing(
        parsed.sessionId,
        parsed.pairingToken
      );
      assertWatchReady(pairing);
      const { id } = request.params as { id: string };
      const habit = createHabitCheckIn(
        id,
        {
          dateKey: parsed.dateKey,
          status: parsed.status,
          note: parsed.note
        },
        { source: "system", actor: `watch:${parsed.dedupeKey}` }
      );
      if (!habit) {
        reply.code(404);
        return { error: "Habit not found" };
      }
      return {
        habit,
        metrics: buildXpMetricsPayload(),
        watch: buildWatchBootstrap(pairing, {
          anchorDateKey: parsed.dateKey
        })
      };
    }
  );
  app.post("/api/v1/mobile/watch/capture-events:batch", async (request) => {
    const parsed = mobileWatchCaptureBatchSchema.parse(request.body ?? {});
    const pairing = requireValidPairing(parsed.sessionId, parsed.pairingToken);
    assertWatchReady(pairing);
    return {
      receipt: ingestWatchCaptureBatch(pairing, parsed),
      watch: buildWatchBootstrap(pairing)
    };
  });
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
  app.delete("/api/v1/health/workouts/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/health/workouts/:id" }
    );
    const { id } = request.params as { id: string };
    const workout = deleteWorkoutSession(id, toActivityContext(auth));
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
  app.delete("/api/v1/health/sleep/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/health/sleep/:id" }
    );
    const { id } = request.params as { id: string };
    const sleep = deleteSleepSession(id, toActivityContext(auth));
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
  app.get("/api/v1/psyche/questionnaires", async (request) => {
    requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.read"],
      { route: "/api/v1/psyche/questionnaires" }
    );
    const userIds = resolveScopedUserIds(
      request.query as Record<string, unknown>
    );
    return listQuestionnaireInstruments({ userIds });
  });
  app.post("/api/v1/psyche/questionnaires", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/questionnaires" }
    );
    const result = createQuestionnaireInstrument(
      createQuestionnaireInstrumentSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    reply.code(201);
    return result;
  });
  app.get("/api/v1/psyche/questionnaires/:id", async (request) => {
    requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.read"],
      { route: "/api/v1/psyche/questionnaires/:id" }
    );
    const { id } = request.params as { id: string };
    const userIds = resolveScopedUserIds(
      request.query as Record<string, unknown>
    );
    return getQuestionnaireInstrumentDetail(id, { userIds });
  });
  app.patch("/api/v1/psyche/questionnaires/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/questionnaires/:id" }
    );
    const { id } = request.params as { id: string };
    const instrument = updateQuestionnaireInstrument(
      id,
      updateQuestionnaireInstrumentSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    if (!instrument) {
      reply.code(404);
      return { error: "Questionnaire instrument not found" };
    }
    return { instrument };
  });
  app.delete("/api/v1/psyche/questionnaires/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/questionnaires/:id" }
    );
    const { id } = request.params as { id: string };
    const instrument = deleteQuestionnaireInstrument(
      id,
      toActivityContext(auth)
    );
    if (!instrument) {
      reply.code(404);
      return { error: "Questionnaire instrument not found" };
    }
    return { instrument };
  });
  app.post(
    "/api/v1/psyche/questionnaires/:id/clone",
    async (request, reply) => {
      const auth = requirePsycheScopedAccess(
        request.headers as Record<string, unknown>,
        ["psyche.write"],
        { route: "/api/v1/psyche/questionnaires/:id/clone" }
      );
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as Record<string, unknown>;
      const userId =
        typeof body.userId === "string" && body.userId.trim().length > 0
          ? body.userId.trim()
          : null;
      const result = cloneQuestionnaireInstrument(
        id,
        { userId },
        toActivityContext(auth)
      );
      reply.code(201);
      return result;
    }
  );
  app.post("/api/v1/psyche/questionnaires/:id/draft", async (request) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/questionnaires/:id/draft" }
    );
    const { id } = request.params as { id: string };
    return ensureQuestionnaireDraftVersion(id, toActivityContext(auth));
  });
  app.patch("/api/v1/psyche/questionnaires/:id/draft", async (request) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/questionnaires/:id/draft" }
    );
    const { id } = request.params as { id: string };
    return updateQuestionnaireDraftVersion(
      id,
      updateQuestionnaireVersionSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
  });
  app.post("/api/v1/psyche/questionnaires/:id/publish", async (request) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/questionnaires/:id/publish" }
    );
    const { id } = request.params as { id: string };
    return publishQuestionnaireDraftVersion(
      id,
      publishQuestionnaireVersionSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
  });
  app.post("/api/v1/psyche/questionnaires/:id/runs", async (request, reply) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write", "psyche.read"],
      { route: "/api/v1/psyche/questionnaires/:id/runs" }
    );
    const { id } = request.params as { id: string };
    const result = startQuestionnaireRun(
      id,
      startQuestionnaireRunSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    reply.code(201);
    return result;
  });
  app.get("/api/v1/psyche/questionnaire-runs/:id", async (request) => {
    requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.read"],
      { route: "/api/v1/psyche/questionnaire-runs/:id" }
    );
    const { id } = request.params as { id: string };
    const userIds = resolveScopedUserIds(
      request.query as Record<string, unknown>
    );
    return getQuestionnaireRunDetail(id, { userIds });
  });
  app.patch("/api/v1/psyche/questionnaire-runs/:id", async (request) => {
    const auth = requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.write"],
      { route: "/api/v1/psyche/questionnaire-runs/:id" }
    );
    const { id } = request.params as { id: string };
    return updateQuestionnaireRun(
      id,
      updateQuestionnaireRunSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
  });
  app.post(
    "/api/v1/psyche/questionnaire-runs/:id/complete",
    async (request) => {
      const auth = requirePsycheScopedAccess(
        request.headers as Record<string, unknown>,
        ["psyche.write"],
        { route: "/api/v1/psyche/questionnaire-runs/:id/complete" }
      );
      const { id } = request.params as { id: string };
      return completeQuestionnaireRun(id, toActivityContext(auth));
    }
  );
  app.get("/api/v1/psyche/self-observation/calendar", async (request) => {
    requirePsycheScopedAccess(
      request.headers as Record<string, unknown>,
      ["psyche.read"],
      { route: "/api/v1/psyche/self-observation/calendar" }
    );
    const query = calendarOverviewQuerySchema.parse(request.query ?? {});
    const now = new Date();
    const from =
      query.from ??
      new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const to =
      query.to ??
      new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000).toISOString();
    return {
      calendar: getPsycheObservationCalendar({
        from,
        to,
        userIds: query.userIds
      })
    };
  });
  app.get(
    "/api/v1/psyche/self-observation/calendar/export",
    async (request, reply) => {
      requirePsycheScopedAccess(
        request.headers as Record<string, unknown>,
        ["psyche.read"],
        { route: "/api/v1/psyche/self-observation/calendar/export" }
      );
      const query = psycheObservationCalendarExportQuerySchema.parse(
        request.query ?? {}
      );
      const now = new Date();
      const from =
        query.from ??
        new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const to =
        query.to ??
        new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000).toISOString();
      const exported = exportPsycheObservationCalendar({
        from,
        to,
        userIds: query.userIds,
        format: query.format,
        tags: query.tags,
        includeObservations: query.includeObservations,
        includeActivity: query.includeActivity,
        onlyHumanOwned: query.onlyHumanOwned,
        search: query.search
      });
      reply.header(
        "Content-Disposition",
        `attachment; filename="${exported.fileName}"`
      );
      reply.type(exported.mimeType);
      return reply.send(exported.body);
    }
  );
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
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/wiki/settings/llm-profiles"
    });
    const profile = upsertWikiLlmProfile(
      upsertWikiLlmProfileSchema.parse(request.body ?? {}),
      managers.secrets
    );
    reply.code(201);
    return { profile };
  });
  app.post(
    "/api/v1/wiki/settings/llm-profiles/test",
    async (request, reply) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["write"],
        { route: "/api/v1/wiki/settings/llm-profiles/test" }
      );
      const parsed = testWikiLlmProfileSchema.parse(request.body ?? {});
      const existingProfile = parsed.profileId
        ? (listWikiLlmProfiles().find(
            (entry) => entry.id === parsed.profileId
          ) ?? null)
        : null;
      const profile = {
        provider: parsed.provider,
        baseUrl: parsed.baseUrl,
        model: parsed.model,
        systemPrompt: existingProfile?.systemPrompt ?? "",
        secretId: existingProfile?.secretId ?? null,
        metadata: {
          ...(existingProfile?.metadata ?? {}),
          ...(parsed.reasoningEffort
            ? { reasoningEffort: parsed.reasoningEffort }
            : {}),
          ...(parsed.verbosity ? { verbosity: parsed.verbosity } : {})
        }
      };
      const result = await managers.llm.testWikiConnection(
        profile,
        parsed.apiKey ?? null,
        ({ level, message, details = {} }) => {
          recordDiagnosticLog({
            level,
            source: normalizeDiagnosticSource(
              request.headers["x-forge-source"]
            ),
            scope:
              typeof details.scope === "string" ? details.scope : "wiki_llm",
            eventKey:
              typeof details.eventKey === "string"
                ? details.eventKey
                : "llm_connection_test",
            message,
            route: "/api/v1/wiki/settings/llm-profiles/test",
            functionName: "testWikiConnection",
            details
          });
        }
      );
      reply.code(200);
      return { result };
    }
  );
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
      const params = request.params as {
        kind: "llm" | "embedding";
        id: string;
      };
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
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/wiki/spaces"
    });
    const space = createWikiSpace(
      createWikiSpaceSchema.parse(request.body ?? {})
    );
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
  app.delete("/api/v1/wiki/pages/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = getNoteById(id);
    if (!current || (current.kind !== "wiki" && current.kind !== "evidence")) {
      reply.code(404);
      return { error: "Wiki page not found" };
    }
    if (current.slug === "index") {
      reply.code(400);
      return { error: "The wiki home page cannot be deleted." };
    }
    const linkedEntityType = current.links[0]?.entityType ?? null;
    const auth = requireNoteAccess(
      request.headers as Record<string, unknown>,
      linkedEntityType,
      {
        route: "/api/v1/wiki/pages/:id",
        entityType: linkedEntityType
      }
    );
    const deleted = deleteEntity(
      "note",
      id,
      entityDeleteQuerySchema.parse(request.query ?? {}),
      toActivityContext(auth)
    );
    if (!deleted) {
      reply.code(404);
      return { error: "Wiki page not found" };
    }
    return {
      deleted: {
        id: deleted.id
      }
    };
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
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/wiki/sync"
    });
    return syncWikiVaultFromDisk(syncWikiVaultSchema.parse(request.body ?? {}));
  });
  app.post("/api/v1/wiki/reindex", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/wiki/reindex"
    });
    return reindexWikiEmbeddings(
      reindexWikiEmbeddingsSchema.parse(request.body ?? {}),
      managers.secrets
    );
  });
  const readStringField = (
    record: Record<string, unknown>,
    key: string,
    fallback = ""
  ) => (typeof record[key] === "string" ? (record[key] as string) : fallback);
  const readStringArrayField = (
    record: Record<string, unknown>,
    key: string
  ) =>
    Array.isArray(record[key])
      ? (record[key] as unknown[]).filter(
          (entry): entry is string =>
            typeof entry === "string" && entry.trim().length > 0
        )
      : [];
  const resolveMappedIngestEntity = (
    entityType: CrudEntityType,
    entityId: string
  ) => {
    const result = searchEntities({
      searches: [
        {
          entityTypes: [entityType],
          ids: [entityId],
          includeDeleted: false,
          limit: 1
        }
      ]
    }).results[0] as
      | {
          ok?: boolean;
          matches?: Array<{
            entityType?: CrudEntityType;
            id?: string;
          }>;
        }
      | undefined;
    if (!result?.ok) {
      return null;
    }
    const match = result.matches?.find(
      (entry) => entry.entityType === entityType && entry.id === entityId
    );
    return match
      ? {
          entityType,
          entityId
        }
      : null;
  };
  const publishIngestProposalEntity = (
    proposal: Record<string, unknown>,
    auth: ReturnType<typeof authenticateRequest>
  ) => {
    const suggestedFields =
      proposal.suggestedFields &&
      typeof proposal.suggestedFields === "object" &&
      !Array.isArray(proposal.suggestedFields)
        ? (proposal.suggestedFields as Record<string, unknown>)
        : {};
    const entityType = readStringField(proposal, "entityType").trim();
    const title =
      readStringField(proposal, "title").trim() || "Imported candidate";
    const summary = readStringField(proposal, "summary").trim();

    switch (entityType) {
      case "goal": {
        const goal = createGoal(
          {
            title,
            description: summary,
            horizon:
              readStringField(suggestedFields, "horizon", "year") === "quarter"
                ? "quarter"
                : readStringField(suggestedFields, "horizon", "year") ===
                    "lifetime"
                  ? "lifetime"
                  : "year",
            status:
              readStringField(suggestedFields, "status", "active") === "paused"
                ? "paused"
                : readStringField(suggestedFields, "status", "active") ===
                    "completed"
                  ? "completed"
                  : "active",
            targetPoints: Number(suggestedFields.targetPoints ?? 400) || 400,
            themeColor: readStringField(
              suggestedFields,
              "themeColor",
              "#c8a46b"
            ),
            tagIds: readStringArrayField(suggestedFields, "tagIds"),
            notes: [],
            userId:
              typeof suggestedFields.userId === "string"
                ? (suggestedFields.userId as string)
                : null
          },
          toActivityContext(auth)
        );
        return { entityType: "goal", entityId: goal.id };
      }
      case "project": {
        const goalId =
          readStringField(suggestedFields, "goalId").trim() ||
          readStringArrayField(suggestedFields, "targetGoalIds")[0] ||
          readStringArrayField(suggestedFields, "linkedGoalIds")[0] ||
          "";
        if (!goalId) {
          throw new Error("Project proposals need a goalId to publish.");
        }
        const project = createProject(
          {
            goalId,
            title,
            description: summary,
            status:
              readStringField(suggestedFields, "status", "active") === "paused"
                ? "paused"
                : readStringField(suggestedFields, "status", "active") ===
                    "completed"
                  ? "completed"
                  : "active",
            targetPoints: Number(suggestedFields.targetPoints ?? 240) || 240,
            themeColor: readStringField(
              suggestedFields,
              "themeColor",
              "#c0c1ff"
            ),
            schedulingRules: {
              allowWorkBlockKinds: [],
              blockWorkBlockKinds: [],
              allowCalendarIds: [],
              blockCalendarIds: [],
              allowEventTypes: [],
              blockEventTypes: [],
              allowEventKeywords: [],
              blockEventKeywords: [],
              allowAvailability: [],
              blockAvailability: []
            },
            notes: [],
            userId:
              typeof suggestedFields.userId === "string"
                ? (suggestedFields.userId as string)
                : null
          },
          toActivityContext(auth)
        );
        return { entityType: "project", entityId: project.id };
      }
      case "task": {
        const task = createTask(
          {
            title,
            description: summary,
            status: "backlog",
            priority: "medium",
            owner: auth.actor ?? "Forge",
            userId:
              typeof suggestedFields.userId === "string"
                ? (suggestedFields.userId as string)
                : null,
            goalId: readStringField(suggestedFields, "goalId").trim() || null,
            projectId:
              readStringField(suggestedFields, "projectId").trim() || null,
            dueDate: null,
            effort: "deep",
            energy: "steady",
            points: Number(suggestedFields.points ?? 40) || 40,
            plannedDurationSeconds: null,
            schedulingRules: null,
            tagIds: readStringArrayField(suggestedFields, "tagIds"),
            actionCostBand: "standard",
            notes: []
          },
          toActivityContext(auth)
        );
        return { entityType: "task", entityId: task.id };
      }
      case "habit": {
        const habit = createHabit(
          {
            title,
            description: summary,
            status: "active",
            polarity:
              readStringField(suggestedFields, "polarity", "positive") ===
              "negative"
                ? "negative"
                : "positive",
            frequency:
              readStringField(suggestedFields, "frequency", "daily") ===
              "weekly"
                ? "weekly"
                : "daily",
            targetCount: Number(suggestedFields.targetCount ?? 1) || 1,
            weekDays: Array.isArray(suggestedFields.weekDays)
              ? (suggestedFields.weekDays as number[])
              : [],
            linkedGoalIds: readStringArrayField(
              suggestedFields,
              "linkedGoalIds"
            ),
            linkedProjectIds: readStringArrayField(
              suggestedFields,
              "linkedProjectIds"
            ),
            linkedTaskIds: readStringArrayField(
              suggestedFields,
              "linkedTaskIds"
            ),
            linkedValueIds: [],
            linkedPatternIds: [],
            linkedBehaviorIds: [],
            linkedBeliefIds: [],
            linkedModeIds: [],
            linkedReportIds: [],
            linkedBehaviorId: null,
            rewardXp: Number(suggestedFields.rewardXp ?? 12) || 12,
            penaltyXp: Number(suggestedFields.penaltyXp ?? 8) || 8,
            generatedHealthEventTemplate: {
              enabled: false,
              workoutType: "workout",
              title: "",
              durationMinutes: 45,
              xpReward: 0,
              tags: [],
              links: [],
              notesTemplate: ""
            },
            userId:
              typeof suggestedFields.userId === "string"
                ? (suggestedFields.userId as string)
                : null
          },
          toActivityContext(auth)
        );
        return { entityType: "habit", entityId: habit.id };
      }
      case "psyche_value": {
        const value = createPsycheValue(
          {
            title,
            description: summary,
            valuedDirection: readStringField(
              suggestedFields,
              "valuedDirection"
            ),
            whyItMatters: readStringField(suggestedFields, "whyItMatters"),
            linkedGoalIds: readStringArrayField(
              suggestedFields,
              "linkedGoalIds"
            ),
            linkedProjectIds: readStringArrayField(
              suggestedFields,
              "linkedProjectIds"
            ),
            linkedTaskIds: readStringArrayField(
              suggestedFields,
              "linkedTaskIds"
            ),
            committedActions: readStringArrayField(
              suggestedFields,
              "committedActions"
            ),
            userId:
              typeof suggestedFields.userId === "string"
                ? (suggestedFields.userId as string)
                : null
          },
          toActivityContext(auth)
        );
        return { entityType: "psyche_value", entityId: value.id };
      }
      case "strategy": {
        const targetProjectIds = readStringArrayField(
          suggestedFields,
          "targetProjectIds"
        );
        const linkedEntities =
          Array.isArray(suggestedFields.linkedEntities) &&
          suggestedFields.linkedEntities.every(
            (entry) =>
              entry &&
              typeof entry === "object" &&
              typeof (entry as { entityType?: unknown }).entityType ===
                "string" &&
              typeof (entry as { entityId?: unknown }).entityId === "string"
          )
            ? (suggestedFields.linkedEntities as Array<{
                entityType: string;
                entityId: string;
              }>)
            : [];
        const firstProjectId =
          targetProjectIds[0] ||
          linkedEntities.find((entry) => entry.entityType === "project")
            ?.entityId ||
          "";
        const firstTaskId =
          linkedEntities.find((entry) => entry.entityType === "task")
            ?.entityId || "";
        const graphNodeId = firstProjectId || firstTaskId;
        if (!graphNodeId) {
          throw new Error(
            "Strategy proposals need at least one linked project or task to publish."
          );
        }
        const strategy = createStrategy({
          title,
          overview: summary,
          endStateDescription: readStringField(
            suggestedFields,
            "endStateDescription",
            summary
          ),
          status: "active",
          targetGoalIds: readStringArrayField(suggestedFields, "targetGoalIds"),
          targetProjectIds,
          linkedEntities: linkedEntities.filter(
            (entry): entry is { entityType: any; entityId: string } =>
              entry.entityType !== "goal" &&
              entry.entityType !== "note" &&
              typeof entry.entityId === "string"
          ) as Array<{ entityType: "task" | "project"; entityId: string }>,
          graph: {
            nodes: [
              {
                id: `seed_${graphNodeId}`,
                entityType: firstProjectId ? "project" : "task",
                entityId: graphNodeId,
                title,
                branchLabel: "",
                notes: summary
              }
            ],
            edges: []
          },
          userId:
            typeof suggestedFields.userId === "string"
              ? (suggestedFields.userId as string)
              : null,
          isLocked: false,
          lockedByUserId: null
        });
        return { entityType: "strategy", entityId: strategy.id };
      }
      case "note": {
        const note = createNote(
          {
            kind: "evidence",
            title,
            slug: "",
            spaceId: "",
            parentSlug: null,
            indexOrder: 0,
            showInIndex: false,
            aliases: [],
            summary,
            contentMarkdown: `# ${title}\n\n${summary}\n`,
            author: auth.actor ?? null,
            tags: [],
            destroyAt: null,
            links: [],
            sourcePath: "",
            frontmatter: {},
            revisionHash: "",
            userId: null
          },
          toActivityContext(auth)
        );
        return { entityType: "note", entityId: note.id };
      }
      default:
        throw new Error(
          `Unsupported ingest proposal entity type: ${entityType}`
        );
    }
  };
  app.get("/api/v1/wiki/ingest-jobs", async (request) => {
    requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["read", "write"],
      { route: "/api/v1/wiki/ingest-jobs" }
    );
    return {
      jobs: listWikiIngestJobs(request.query ?? {})
    };
  });
  app.post("/api/v1/wiki/ingest-jobs/uploads", async (request, reply) => {
    const parts = request.parts();
    const fields = new Map<string, string>();
    const files: Array<{
      fileName: string;
      mimeType: string;
      payload: Buffer;
    }> = [];

    for await (const part of parts) {
      if (part.type === "file") {
        files.push({
          fileName: part.filename || "upload.bin",
          mimeType: part.mimetype || "application/octet-stream",
          payload: await part.toBuffer()
        });
      } else {
        fields.set(part.fieldname, String(part.value ?? ""));
      }
    }

    const linkedEntityHints = (() => {
      try {
        return JSON.parse(fields.get("linkedEntityHints") || "[]");
      } catch {
        return [];
      }
    })();
    const linkedEntityType = linkedEntityHints[0]?.entityType ?? null;
    const auth = requireNoteAccess(
      request.headers as Record<string, unknown>,
      linkedEntityType,
      {
        route: "/api/v1/wiki/ingest-jobs/uploads",
        entityType: linkedEntityType
      }
    );

    const result = await createUploadedWikiIngestJob(
      {
        spaceId: fields.get("spaceId") || undefined,
        titleHint: fields.get("titleHint") || undefined,
        llmProfileId: fields.get("llmProfileId") || undefined,
        parseStrategy:
          fields.get("parseStrategy") === "text_only" ||
          fields.get("parseStrategy") === "multimodal"
            ? (fields.get("parseStrategy") as "text_only" | "multimodal")
            : "auto",
        entityProposalMode:
          fields.get("entityProposalMode") === "none" ? "none" : "suggest",
        userId: null,
        createAsKind:
          fields.get("createAsKind") === "evidence" ? "evidence" : "wiki",
        linkedEntityHints
      },
      files,
      {
        actor: auth.actor ?? null
      }
    );

    const jobId = result.job?.job.id;
    if (jobId) {
      enqueueWikiIngestJob(jobId);
    }
    reply.code(201);
    return result;
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
      actor: auth.actor ?? null
    });
    const jobId = result.job?.job.id;
    if (jobId) {
      enqueueWikiIngestJob(jobId);
    }
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
  app.post("/api/v1/wiki/ingest-jobs/:id/rerun", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/wiki/ingest-jobs/:id/rerun"
    });
    const { id } = request.params as { id: string };
    try {
      const result = await rerunWikiIngestJob(id, {
        actor:
          requireAuthenticatedActor(
            request.headers as Record<string, unknown>,
            { route: "/api/v1/wiki/ingest-jobs/:id/rerun" }
          ).actor ?? null
      });
      if (!result) {
        reply.code(404);
        return { error: "Wiki ingest job not found" };
      }
      const nextJobId = result.job?.job.id;
      if (nextJobId) {
        enqueueWikiIngestJob(nextJobId);
      }
      reply.code(201);
      return result;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("can only be rerun")
      ) {
        reply.code(409);
        return { error: error.message };
      }
      throw error;
    }
  });
  app.post("/api/v1/wiki/ingest-jobs/:id/resume", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/wiki/ingest-jobs/:id/resume"
    });
    const { id } = request.params as { id: string };
    const job = getWikiIngestJob(id);
    if (!job) {
      reply.code(404);
      return { error: "Wiki ingest job not found" };
    }
    const hasRecoverableOpenAiResponse =
      job.logs.some((entry) => typeof entry.metadata.responseId === "string") ||
      job.assets.some(
        (asset) =>
          typeof asset.metadata.openAiResponseId === "string" ||
          asset.status === "processing"
      );
    const canResume =
      ["queued", "processing"].includes(job.job.status) ||
      (job.job.status === "failed" && hasRecoverableOpenAiResponse);
    if (!canResume) {
      reply.code(409);
      return {
        error:
          "Only active wiki ingest jobs, or failed jobs with a recoverable OpenAI background response, can be resumed.",
        job,
        resumed: false
      };
    }
    const alreadyActive = managers.backgroundJobs.has(id);
    if (!alreadyActive) {
      enqueueWikiIngestJob(id);
    }
    return {
      job: getWikiIngestJob(id),
      resumed: !alreadyActive
    };
  });
  app.delete("/api/v1/wiki/ingest-jobs/:id", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/wiki/ingest-jobs/:id"
    });
    const { id } = request.params as { id: string };
    try {
      const deleted = deleteWikiIngestJob(id);
      if (!deleted) {
        reply.code(404);
        return { error: "Wiki ingest job not found" };
      }
      return { deleted };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("can only be deleted")
      ) {
        reply.code(409);
        return { error: error.message };
      }
      throw error;
    }
  });
  app.post("/api/v1/wiki/ingest-jobs/:id/review", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/wiki/ingest-jobs/:id/review" }
    );
    const { id } = request.params as { id: string };
    const reviewed = await reviewWikiIngestJob(
      id,
      reviewWikiIngestJobSchema.parse(request.body ?? {}),
      {
        createNote: (note) => createNote(note, toActivityContext(auth)),
        updateNote: (noteId, patch) =>
          updateNote(noteId, patch as any, toActivityContext(auth)),
        publishEntity: (proposal) =>
          publishIngestProposalEntity(proposal, auth),
        resolveMappedEntity: (entityType, entityId) =>
          resolveMappedIngestEntity(entityType, entityId)
      }
    );
    if (!reviewed) {
      reply.code(404);
      return { error: "Wiki ingest job not found" };
    }
    return { job: reviewed };
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
  app.get("/api/v1/work-items", async (request) => {
    const query = taskListQuerySchema.parse(request.query ?? {});
    return {
      workItems: filterOwnedEntities("task", listTasks(query), query.userIds)
    };
  });
  app.get("/api/v1/work-items/board", async (request) => {
    const query = taskListQuerySchema.parse(request.query ?? {});
    const userIds = query.userIds;
    return {
      goals: filterOwnedEntities("goal", listGoals(), userIds),
      strategies: listStrategies({ userIds }),
      projects: listProjectSummaries({ userIds }),
      workItems: filterOwnedEntities("task", listTasks(query), userIds)
    };
  });
  app.get("/api/v1/work-items/hierarchy", async (request) => {
    const query = taskListQuerySchema.parse(request.query ?? {});
    const userIds = query.userIds;
    return {
      goals: filterOwnedEntities("goal", listGoals(), userIds),
      strategies: listStrategies({ userIds }),
      projects: listProjectSummaries({ userIds }),
      workItems: filterOwnedEntities("task", listTasks(query), userIds)
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
  app.get("/api/v1/calendar/macos-local/status", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/calendar/macos-local/status"
    });
    return await getMacOSLocalCalendarAccessStatus();
  });
  app.post("/api/v1/calendar/macos-local/request-access", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/calendar/macos-local/request-access"
    });
    return await requestMacOSLocalCalendarAccess();
  });
  app.get("/api/v1/calendar/macos-local/discovery", async (request) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/calendar/macos-local/discovery" }
    );
    const discovery = await discoverMacOSLocalCalendarSources();
    recordActivityEvent({
      entityType: "calendar_connection",
      entityId: "calendar_discovery_macos_local",
      eventType: "calendar_connection_discovered",
      title: "Calendar discovery completed for macOS local calendars",
      description:
        "Forge discovered the calendars already configured on this Mac before connection setup.",
      actor: auth.actor ?? null,
      source: auth.source,
      metadata: {
        provider: "macos_local",
        sources: discovery.sources.length
      }
    });
    return { discovery };
  });
  app.post("/api/v1/calendar/oauth/google/start", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/calendar/oauth/google/start"
    });
    return await startGoogleCalendarOauth(
      startGoogleCalendarOauthSchema.parse(request.body ?? {}),
      {
        browserOrigin:
          typeof (request.body as { browserOrigin?: unknown } | null)
            ?.browserOrigin === "string"
            ? (request.body as { browserOrigin: string }).browserOrigin
            : null,
        openerOrigin:
          typeof request.headers.origin === "string"
            ? request.headers.origin
            : typeof request.headers.referer === "string"
              ? request.headers.referer
              : null,
        requestBaseOrigin: getRequestOrigin(request)
      }
    );
  });
  app.get(
    "/api/v1/calendar/oauth/google/session/:id",
    async (request, reply) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["write"],
        { route: "/api/v1/calendar/oauth/google/session/:id" }
      );
      try {
        return getGoogleCalendarOauthSession(
          (request.params as { id: string }).id
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("Unknown Google calendar auth session")
        ) {
          reply.code(404);
          return { error: "Google calendar auth session not found" };
        }
        throw error;
      }
    }
  );
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
  app.get("/api/v1/calendar/oauth/google/callback", async (request, reply) => {
    const query = request.query as {
      state?: string;
      code?: string;
      error?: string;
      error_description?: string;
    };
    const result = await completeGoogleCalendarOauth({
      state: query.state ?? null,
      code: query.code ?? null,
      error: query.error ?? null,
      errorDescription: query.error_description ?? null
    });
    const session = result.session;
    const escapedOrigin = JSON.stringify(result.openerOrigin || "*");
    const escapedMessage = JSON.stringify({
      type: "forge:google-calendar-auth",
      sessionId: session.sessionId,
      status: session.status
    });
    const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Forge Google sign-in</title>
    <style>
      body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#0b1320;color:#f8fafc;display:grid;place-items:center;min-height:100vh}
      main{max-width:30rem;padding:2rem;border:1px solid rgba(255,255,255,.08);border-radius:24px;background:linear-gradient(180deg,rgba(18,28,38,.98),rgba(11,17,28,.98))}
      h1{margin:0 0 .75rem;font-size:1.15rem}
      p{margin:0;color:rgba(248,250,252,.72);line-height:1.6}
    </style>
  </head>
  <body>
    <main>
      <h1>${session.status === "authorized" ? "Google account connected" : "Google sign-in needs attention"}</h1>
      <p>${session.status === "authorized" ? "Forge received your Google account and sent the result back to the calendar setup flow. You can close this window." : (session.error ?? "Forge could not complete Google sign-in. You can close this window and try again from Settings.")}</p>
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
  });
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
  app.get("/api/v1/preferences/catalogs", async () => ({
    catalogs: listPreferenceCatalogs()
  }));
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
  app.get("/api/v1/preferences/catalogs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const catalog = getPreferenceCatalogById(id);
    if (!catalog) {
      reply.code(404);
      return { error: "Preferences catalog not found" };
    }
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
  app.get("/api/v1/preferences/catalog-items", async () => ({
    items: listPreferenceCatalogItems()
  }));
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
  app.get("/api/v1/preferences/catalog-items/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const item = getPreferenceCatalogItemById(id);
    if (!item) {
      reply.code(404);
      return { error: "Preferences catalog item not found" };
    }
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
  app.get("/api/v1/preferences/contexts", async () => ({
    contexts: listPreferenceContexts()
  }));
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
  app.get("/api/v1/preferences/contexts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const context = getPreferenceContextById(id);
    if (!context) {
      reply.code(404);
      return { error: "Preferences context not found" };
    }
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
  app.delete("/api/v1/preferences/contexts/:id", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/preferences/contexts/:id"
    });
    const { id } = request.params as { id: string };
    return { context: deletePreferenceContext(id) };
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
  app.get("/api/v1/preferences/items", async () => ({
    items: listPreferenceItems()
  }));
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
  app.get("/api/v1/preferences/items/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const item = getPreferenceItemById(id);
    if (!item) {
      reply.code(404);
      return { error: "Preferences item not found" };
    }
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
  app.delete("/api/v1/preferences/items/:id", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/preferences/items/:id"
    });
    const { id } = request.params as { id: string };
    return { item: deletePreferenceItem(id) };
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
  app.post("/api/v1/diagnostics/logs", async (request, reply) => {
    const payload = createDiagnosticLogSchema.parse(request.body ?? {});
    const entry = recordDiagnosticLog({
      ...payload,
      source:
        payload.source ??
        normalizeDiagnosticSource(request.headers["x-forge-source"])
    });
    reply.code(201);
    return { log: entry };
  });
  app.get("/api/v1/diagnostics/logs", async (request) => {
    requireOperatorSession(request.headers as Record<string, unknown>, {
      route: "/api/v1/diagnostics/logs"
    });
    const query = diagnosticLogListQuerySchema.parse(request.query ?? {});
    return listDiagnosticLogs(query);
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
  app.get("/api/v1/settings/data", async (request) => {
    requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["read", "write"],
      { route: "/api/v1/settings/data" }
    );
    return { data: await getDataManagementState() };
  });
  app.patch("/api/v1/settings/data", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/settings/data"
    });
    return {
      settings: await updateDataManagementSettings(
        updateDataManagementSettingsSchema.parse(request.body ?? {})
      ),
      data: await getDataManagementState()
    };
  });
  app.post("/api/v1/settings/data/scan", async (request) => {
    requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["read", "write"],
      { route: "/api/v1/settings/data/scan" }
    );
    return { candidates: await scanForDataRecoveryCandidates() };
  });
  app.post("/api/v1/settings/data/backups", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/settings/data/backups"
    });
    const backup = await createDataBackup(
      createDataBackupSchema.parse(request.body ?? {})
    );
    reply.code(201);
    return {
      backup,
      data: await getDataManagementState()
    };
  });
  app.post("/api/v1/settings/data/backups/:id/restore", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/settings/data/backups/:id/restore"
    });
    const { id } = request.params as { id: string };
    return {
      data: await restoreDataBackup(
        id,
        restoreDataBackupSchema.parse(request.body ?? {}),
        { secretsManager: managers.secrets }
      )
    };
  });
  app.post("/api/v1/settings/data/switch-root", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/settings/data/switch-root"
    });
    return {
      data: await switchDataRoot(
        switchDataRootSchema.parse(request.body ?? {}),
        { secretsManager: managers.secrets }
      )
    };
  });
  app.get("/api/v1/settings/data/export", async (request, reply) => {
    requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["read", "write"],
      { route: "/api/v1/settings/data/export" }
    );
    const query = dataExportQuerySchema.parse(request.query ?? {});
    const exported = await exportData(query.format);
    reply.header(
      "Content-Disposition",
      `attachment; filename="${exported.fileName}"`
    );
    reply.type(exported.mimeType);
    return reply.send(exported.body);
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
      if (error instanceof CalendarConnectionOverlapError) {
        reply.code(409);
        return {
          code: "calendar_connection_overlap",
          error: error.message,
          overlappingConnectionIds: error.connectionIds
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
    try {
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
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("replaced by a newer canonical connection")
      ) {
        reply.code(409);
        return {
          code: "calendar_connection_superseded",
          error: error.message
        };
      }
      throw error;
    }
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
  app.get(
    "/api/v1/calendar/work-block-templates/:id",
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const template = getWorkBlockTemplateById(id);
      if (!template) {
        reply.code(404);
        return { error: "Work block template not found" };
      }
      return { template };
    }
  );
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
  app.get("/api/v1/calendar/timeboxes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const timebox = getTaskTimeboxById(id);
    if (!timebox) {
      reply.code(404);
      return { error: "Task timebox not found" };
    }
    return { timebox };
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
  app.get("/api/v1/calendar/events", async (request) => {
    const query = calendarOverviewQuerySchema.parse(request.query ?? {});
    const now = new Date();
    const from =
      query.from ??
      new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const to =
      query.to ??
      new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000).toISOString();
    return {
      events: listCalendarEvents({ from, to, userIds: query.userIds })
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
  app.get("/api/v1/calendar/events/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const event = getCalendarEventById(id);
    if (!event) {
      reply.code(404);
      return { error: "Calendar event not found" };
    }
    return { event };
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
  app.delete(
    "/api/v1/habits/:id/check-ins/:dateKey",
    async (request, reply) => {
      const auth = requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["write"],
        { route: "/api/v1/habits/:id/check-ins/:dateKey" }
      );
      const { id, dateKey } = request.params as { id: string; dateKey: string };
      const habit = deleteHabitCheckIn(id, dateKey, toActivityContext(auth));
      if (!habit) {
        reply.code(404);
        return { error: "Habit not found" };
      }
      return { habit, metrics: buildXpMetricsPayload() };
    }
  );
  app.patch("/api/v1/settings", async (request) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/settings" }
    );
    return {
      settings: updateSettings(updateSettingsSchema.parse(request.body ?? {}), {
        activity: toActivityContext(auth),
        secrets: managers.secrets
      })
    };
  });
  app.post("/api/v1/settings/models/connections", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/settings/models/connections"
    });
    const parsed = upsertAiModelConnectionSchema.parse(request.body ?? {});
    const oauthCredential = parsed.oauthSessionId?.trim()
      ? consumeOpenAiCodexOauthCredentials(parsed.oauthSessionId.trim())
      : null;
    const connection = upsertAiModelConnection(parsed, managers.secrets, {
      oauthCredential
    });
    const currentSettings = getSettings();
    const selectedWikiConnectionId =
      currentSettings.modelSettings.forgeAgent.wiki.connectionId;
    if (selectedWikiConnectionId === connection.id) {
      updateSettings(
        {
          modelSettings: {
            forgeAgent: {
              wiki: {
                connectionId: connection.id,
                model: parsed.model
              }
            }
          }
        },
        { secrets: managers.secrets }
      );
    }
    mirrorSettingsFileFromCurrentState();
    reply.code(201);
    return { connection };
  });
  app.delete(
    "/api/v1/settings/models/connections/:id",
    async (request, reply) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["write"],
        { route: "/api/v1/settings/models/connections/:id" }
      );
      const deletedId = deleteAiModelConnection(
        (request.params as { id: string }).id,
        managers.secrets
      );
      if (!deletedId) {
        reply.code(404);
        return { error: "AI model connection not found" };
      }
      mirrorSettingsFileFromCurrentState();
      return { deletedId };
    }
  );
  app.post(
    "/api/v1/settings/models/connections/test",
    async (request, reply) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["write"],
        { route: "/api/v1/settings/models/connections/test" }
      );
      const parsed = testAiModelConnectionSchema.parse(request.body ?? {});
      const existing = parsed.connectionId
        ? getAiModelConnectionById(parsed.connectionId)
        : null;
      const credential = parsed.connectionId
        ? readModelConnectionCredential(parsed.connectionId, managers.secrets)
        : null;
      const explicitApiKey =
        parsed.apiKey?.trim() ||
        (credential?.kind === "api_key"
          ? credential.apiKey
          : credential?.kind === "oauth"
            ? credential.access
            : null);
      const result = await managers.llm.testWikiConnection(
        {
          provider: parsed.provider ?? existing?.provider ?? "openai-api",
          baseUrl:
            parsed.baseUrl?.trim() ||
            existing?.baseUrl ||
            "https://api.openai.com/v1",
          model: parsed.model,
          systemPrompt: "",
          secretId: null,
          metadata: {}
        },
        explicitApiKey,
        ({ level, message, details = {} }) => {
          recordDiagnosticLog({
            level,
            source: normalizeDiagnosticSource(
              request.headers["x-forge-source"]
            ),
            scope:
              typeof details.scope === "string"
                ? details.scope
                : "model_settings",
            eventKey:
              typeof details.eventKey === "string"
                ? details.eventKey
                : "model_connection_test",
            message,
            route: "/api/v1/settings/models/connections/test",
            functionName: "testModelConnection",
            details
          });
        }
      );
      reply.code(200);
      return { result };
    }
  );
  app.post(
    "/api/v1/settings/models/oauth/openai-codex/start",
    async (request) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["write"],
        {
          route: "/api/v1/settings/models/oauth/openai-codex/start"
        }
      );
      return { session: await startOpenAiCodexOauthSession() };
    }
  );
  app.get(
    "/api/v1/settings/models/oauth/openai-codex/session/:id",
    async (request, reply) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["write"],
        { route: "/api/v1/settings/models/oauth/openai-codex/session/:id" }
      );
      try {
        return {
          session: getOpenAiCodexOauthSession(
            (request.params as { id: string }).id
          )
        };
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("Unknown OpenAI Codex OAuth session")
        ) {
          reply.code(404);
          return { error: "OpenAI Codex OAuth session not found" };
        }
        throw error;
      }
    }
  );
  app.post(
    "/api/v1/settings/models/oauth/openai-codex/session/:id/manual",
    async (request) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["write"],
        {
          route: "/api/v1/settings/models/oauth/openai-codex/session/:id/manual"
        }
      );
      return {
        session: submitOpenAiCodexOauthManualInput(
          (request.params as { id: string }).id,
          submitOpenAiCodexOauthManualCodeSchema.parse(request.body ?? {})
            .codeOrUrl
        )
      };
    }
  );
  app.get("/api/v1/surfaces/:surfaceId/ai-processors", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["read"], {
      route: "/api/v1/surfaces/:surfaceId/ai-processors"
    });
    return {
      graph: getSurfaceProcessorGraph(
        (request.params as { surfaceId: string }).surfaceId
      )
    };
  });
  app.get("/api/v1/surfaces/:surfaceId/layout", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["read"], {
      route: "/api/v1/surfaces/:surfaceId/layout"
    });
    return {
      layout: getSurfaceLayout(
        (request.params as { surfaceId: string }).surfaceId
      )
    };
  });
  app.put("/api/v1/surfaces/:surfaceId/layout", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/surfaces/:surfaceId/layout"
    });
    const surfaceId = (request.params as { surfaceId: string }).surfaceId;
    return {
      layout: saveSurfaceLayout(
        surfaceId,
        writeSurfaceLayoutSchema.parse(request.body ?? {})
      )
    };
  });
  app.post("/api/v1/surfaces/:surfaceId/layout/reset", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/surfaces/:surfaceId/layout/reset"
    });
    return {
      layout: resetSurfaceLayout(
        (request.params as { surfaceId: string }).surfaceId
      )
    };
  });
  app.post(
    "/api/v1/surfaces/:surfaceId/ai-processors",
    async (request, reply) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["write"],
        {
          route: "/api/v1/surfaces/:surfaceId/ai-processors"
        }
      );
      const body = createAiProcessorSchema.parse({
        ...((request.body as Record<string, unknown>) ?? {}),
        surfaceId: (request.params as { surfaceId: string }).surfaceId
      });
      const processor = createAiProcessor({
        ...body
      });
      reply.code(201);
      return { processor };
    }
  );
  app.patch("/api/v1/ai-processors/:id", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/ai-processors/:id"
    });
    const processor = updateAiProcessor(
      (request.params as { id: string }).id,
      updateAiProcessorSchema.parse(request.body ?? {})
    );
    if (!processor) {
      reply.code(404);
      return { error: "AI processor not found" };
    }
    return { processor };
  });
  app.delete("/api/v1/ai-processors/:id", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/ai-processors/:id"
    });
    const processor = deleteAiProcessor((request.params as { id: string }).id);
    if (!processor) {
      reply.code(404);
      return { error: "AI processor not found" };
    }
    return { processor };
  });
  app.post("/api/v1/ai-processor-links", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/ai-processor-links"
    });
    const link = createAiProcessorLink(
      createAiProcessorLinkSchema.parse(request.body ?? {})
    );
    reply.code(201);
    return { link };
  });
  app.delete("/api/v1/ai-processor-links/:id", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/ai-processor-links/:id"
    });
    const link = deleteAiProcessorLink((request.params as { id: string }).id);
    if (!link) {
      reply.code(404);
      return { error: "AI processor link not found" };
    }
    return { link };
  });
  app.post("/api/v1/ai-processors/:id/run", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/ai-processors/:id/run"
    });
    const processor = getAiProcessorById((request.params as { id: string }).id);
    if (!processor) {
      reply.code(404);
      return { error: "AI processor not found" };
    }
    return await runAiProcessor(
      processor.id,
      runAiProcessorSchema.parse(request.body ?? {}),
      {
        llm: managers.llm,
        secrets: managers.secrets
      },
      { trigger: "manual" }
    );
  });
  app.get("/api/v1/aiproc/:slug", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["read"], {
      route: "/api/v1/aiproc/:slug"
    });
    const processor = getAiProcessorBySlug(
      (request.params as { slug: string }).slug
    );
    if (!processor) {
      reply.code(404);
      return { error: "AI processor not found" };
    }
    return { processor };
  });
  app.post("/api/v1/aiproc/:slug/run", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/aiproc/:slug/run"
    });
    const processor = getAiProcessorBySlug(
      (request.params as { slug: string }).slug
    );
    if (!processor) {
      reply.code(404);
      return { error: "AI processor not found" };
    }
    return await runAiProcessor(
      processor.id,
      runAiProcessorSchema.parse(request.body ?? {}),
      {
        llm: managers.llm,
        secrets: managers.secrets
      },
      { trigger: "route" }
    );
  });
  const registerFlowApiRoutes = (
    basePath: string,
    noun: string,
    options?: {
      collectionKey?: "connectors" | "flows";
      singularKey?: "connector" | "flow";
      catalogPath?: string;
    }
  ) => {
    const collectionKey = options?.collectionKey ?? "connectors";
    const singularKey = options?.singularKey ?? "connector";
    const catalogPath = options?.catalogPath ?? `${basePath}/catalog/boxes`;
    app.get(catalogPath, async (request) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["read"],
        {
          route: catalogPath
        }
      );
      return {
        boxes: [
          ...listForgeBoxCatalog(),
          ...listAiConnectors().flatMap((connector) =>
            connector.publishedOutputs.map((output) =>
              buildConnectorOutputCatalogEntry({
                connectorId: connector.id,
                title: connector.title,
                outputId: output.id
              })
            )
          )
        ]
      };
    });
    app.get(basePath, async (request) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["read"],
        {
          route: basePath
        }
      );
      return {
        [collectionKey]: listAiConnectors()
      };
    });
    app.post(basePath, async (request, reply) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["write"],
        {
          route: basePath
        }
      );
      const connector = createAiConnector(
        createAiConnectorSchema.parse(request.body ?? {})
      );
      reply.code(201);
      return { [singularKey]: connector };
    });
    app.get(`${basePath}/:id`, async (request, reply) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["read"],
        {
          route: `${basePath}/:id`
        }
      );
      const connector = getAiConnectorById(
        (request.params as { id: string }).id
      );
      if (!connector) {
        reply.code(404);
        return { error: `${noun} not found` };
      }
      return {
        [singularKey]: connector,
        runs: listAiConnectorRuns(connector.id),
        conversation: getAiConnectorConversationForConnector(connector.id)
      };
    });
    app.patch(`${basePath}/:id`, async (request, reply) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["write"],
        {
          route: `${basePath}/:id`
        }
      );
      const connector = updateAiConnector(
        (request.params as { id: string }).id,
        updateAiConnectorSchema.parse(request.body ?? {})
      );
      if (!connector) {
        reply.code(404);
        return { error: `${noun} not found` };
      }
      return { [singularKey]: connector };
    });
    app.delete(`${basePath}/:id`, async (request, reply) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["write"],
        {
          route: `${basePath}/:id`
        }
      );
      const connector = deleteAiConnector(
        (request.params as { id: string }).id
      );
      if (!connector) {
        reply.code(404);
        return { error: `${noun} not found` };
      }
      return { [singularKey]: connector };
    });
    app.post(`${basePath}/:id/run`, async (request, reply) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["write"],
        {
          route: `${basePath}/:id/run`
        }
      );
      const connector = getAiConnectorById(
        (request.params as { id: string }).id
      );
      if (!connector) {
        reply.code(404);
        return { error: `${noun} not found` };
      }
      const execution = await runAiConnector(
        connector.id,
        runAiConnectorSchema.parse(request.body ?? {}),
        {
          llm: managers.llm,
          secrets: managers.secrets
        },
        "run"
      );
      return {
        [singularKey]: execution.connector,
        run: execution.run,
        conversation: execution.conversation
      };
    });
    app.post(`${basePath}/:id/chat`, async (request, reply) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["write"],
        {
          route: `${basePath}/:id/chat`
        }
      );
      const connector = getAiConnectorById(
        (request.params as { id: string }).id
      );
      if (!connector) {
        reply.code(404);
        return { error: `${noun} not found` };
      }
      const execution = await runAiConnector(
        connector.id,
        runAiConnectorSchema.parse(request.body ?? {}),
        {
          llm: managers.llm,
          secrets: managers.secrets
        },
        "chat"
      );
      return {
        [singularKey]: execution.connector,
        run: execution.run,
        conversation: execution.conversation
      };
    });
    app.get(`${basePath}/:id/output`, async (request, reply) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["read"],
        {
          route: `${basePath}/:id/output`
        }
      );
      const connector = getAiConnectorById(
        (request.params as { id: string }).id
      );
      if (!connector) {
        reply.code(404);
        return { error: `${noun} not found` };
      }
      return {
        [singularKey]: connector,
        output: connector.lastRun?.result ?? null
      };
    });
    app.get(`${basePath}/:id/runs`, async (request, reply) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["read"],
        {
          route: `${basePath}/:id/runs`
        }
      );
      const connector = getAiConnectorById(
        (request.params as { id: string }).id
      );
      if (!connector) {
        reply.code(404);
        return { error: `${noun} not found` };
      }
      return {
        runs: listAiConnectorRuns(connector.id)
      };
    });
    app.get(`${basePath}/:id/runs/:runId`, async (request, reply) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["read"],
        {
          route: `${basePath}/:id/runs/:runId`
        }
      );
      const params = request.params as { id: string; runId: string };
      const connector = getAiConnectorById(params.id);
      if (!connector) {
        reply.code(404);
        return { error: `${noun} not found` };
      }
      const run = getAiConnectorRunById(connector.id, params.runId);
      if (!run) {
        reply.code(404);
        return { error: `${noun} run not found` };
      }
      return {
        [singularKey]: connector,
        run
      };
    });
    app.get(`${basePath}/:id/runs/:runId/nodes`, async (request, reply) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["read"],
        {
          route: `${basePath}/:id/runs/:runId/nodes`
        }
      );
      const params = request.params as { id: string; runId: string };
      const connector = getAiConnectorById(params.id);
      if (!connector) {
        reply.code(404);
        return { error: `${noun} not found` };
      }
      const nodeResults = getAiConnectorRunNodeResults(
        connector.id,
        params.runId
      );
      if (!nodeResults) {
        reply.code(404);
        return { error: `${noun} run not found` };
      }
      return {
        [singularKey]: connector,
        nodeResults
      };
    });
    app.get(
      `${basePath}/:id/runs/:runId/nodes/:nodeId`,
      async (request, reply) => {
        requireScopedAccess(
          request.headers as Record<string, unknown>,
          ["read"],
          {
            route: `${basePath}/:id/runs/:runId/nodes/:nodeId`
          }
        );
        const params = request.params as {
          id: string;
          runId: string;
          nodeId: string;
        };
        const connector = getAiConnectorById(params.id);
        if (!connector) {
          reply.code(404);
          return { error: `${noun} not found` };
        }
        const nodeResult = getAiConnectorRunNodeResult(
          connector.id,
          params.runId,
          params.nodeId
        );
        if (!nodeResult) {
          reply.code(404);
          return { error: `${noun} node result not found` };
        }
        return {
          [singularKey]: connector,
          nodeResult
        };
      }
    );
    app.get(`${basePath}/:id/nodes/:nodeId/output`, async (request, reply) => {
      requireScopedAccess(
        request.headers as Record<string, unknown>,
        ["read"],
        {
          route: `${basePath}/:id/nodes/:nodeId/output`
        }
      );
      const params = request.params as { id: string; nodeId: string };
      const connector = getAiConnectorById(params.id);
      if (!connector) {
        reply.code(404);
        return { error: `${noun} not found` };
      }
      const latest = getLatestAiConnectorNodeOutput(
        connector.id,
        params.nodeId
      );
      if (!latest) {
        reply.code(404);
        return { error: `${noun} node output not found` };
      }
      return {
        [singularKey]: connector,
        run: latest.run,
        nodeResult: latest.nodeResult
      };
    });
  };
  registerFlowApiRoutes("/api/v1/workbench/flows", "Workbench flow", {
    collectionKey: "flows",
    singularKey: "flow",
    catalogPath: "/api/v1/workbench/catalog/boxes"
  });
  app.post("/api/v1/workbench/run", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], {
      route: "/api/v1/workbench/run"
    });
    const payload = runAiConnectorSchema
      .extend({
        flowId: z.string().trim().min(1)
      })
      .parse(request.body ?? {});
    const flow = getAiConnectorById(payload.flowId);
    if (!flow) {
      reply.code(404);
      return { error: "Workbench flow not found" };
    }
    const { flowId, ...runInput } = payload;
    const execution = await runAiConnector(
      flow.id,
      runInput,
      {
        llm: managers.llm,
        secrets: managers.secrets
      },
      "run"
    );
    return {
      flow: execution.connector,
      run: execution.run,
      conversation: execution.conversation
    };
  });
  app.get("/api/v1/workbench/flows/by-slug/:slug", async (request, reply) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["read"], {
      route: "/api/v1/workbench/flows/by-slug/:slug"
    });
    const connector = getAiConnectorBySlug(
      (request.params as { slug: string }).slug
    );
    if (!connector) {
      reply.code(404);
      return { error: "Workbench flow not found" };
    }
    return { flow: connector };
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
  app.get("/api/v1/work-items/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const workItem = getTaskById(id);
    if (!workItem) {
      reply.code(404);
      return { error: "Work item not found" };
    }
    return { workItem };
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
  app.get("/api/v1/work-items/:id/context", async (request, reply) => {
    const { id } = request.params as { id: string };
    const workItem = getTaskById(id);
    if (!workItem) {
      reply.code(404);
      return { error: "Work item not found" };
    }

    const taskRuns = listTaskRuns({ taskId: id, limit: 10 });
    return taskContextPayloadSchema.parse({
      task: workItem,
      goal: workItem.goalId ? (getGoalById(workItem.goalId) ?? null) : null,
      project: workItem.projectId
        ? (listProjectSummaries().find(
            (project) => project.id === workItem.projectId
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
  app.post("/api/v1/work-items", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/work-items" }
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
    return { workItem: result.task };
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
  app.patch("/api/v1/work-items/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/work-items/:id" }
    );
    const { id } = request.params as { id: string };
    const workItem = updateTask(
      id,
      updateTaskSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    if (!workItem) {
      reply.code(404);
      return { error: "Work item not found" };
    }
    return { workItem };
  });
  app.post("/api/v1/tasks/:id/split", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/tasks/:id/split" }
    );
    const { id } = request.params as { id: string };
    const result = splitTask(
      id,
      taskSplitCreateSchema.parse(request.body ?? {}),
      toActivityContext(auth)
    );
    if (!result) {
      reply.code(404);
      return { error: "Task not found" };
    }
    return result;
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
  app.delete("/api/v1/work-items/:id", async (request, reply) => {
    const auth = requireScopedAccess(
      request.headers as Record<string, unknown>,
      ["write"],
      { route: "/api/v1/work-items/:id" }
    );
    const { id } = request.params as { id: string };
    const workItem = deleteEntity(
      "task",
      id,
      entityDeleteQuerySchema.parse(request.query ?? {}),
      toActivityContext(auth)
    );
    if (!workItem) {
      reply.code(404);
      return { error: "Work item not found" };
    }
    return { workItem };
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
