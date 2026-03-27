import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { configureDatabase, configureDatabaseSeeding } from "./db.js";
import { HttpError, isHttpError, type ValidationIssue } from "./errors.js";
import { listActivityEvents, listActivityEventsForTask, removeActivityEvent } from "./repositories/activity-events.js";
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
import { createGoal, getGoalById, listGoals, updateGoal } from "./repositories/goals.js";
import { createComment, getCommentById, listComments, updateComment } from "./repositories/comments.js";
import { listDomains } from "./repositories/domains.js";
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
  createManualRewardGrant,
  getDailyAmbientXp,
  getRewardRuleById,
  listRewardLedger,
  listRewardRules,
  recordSessionEvent,
  updateRewardRule
} from "./repositories/rewards.js";
import { listAgentIdentities, getSettings, isPsycheAuthRequired, updateSettings, verifyAgentToken } from "./repositories/settings.js";
import { createTag, getTagById, listTags, updateTag } from "./repositories/tags.js";
import { claimTaskRun, completeTaskRun, focusTaskRun, heartbeatTaskRun, listTaskRuns, recoverTimedOutTaskRuns, releaseTaskRun } from "./repositories/task-runs.js";
import { createTask, createTaskWithIdempotency, getTaskById, listTasks, uncompleteTask, updateTask } from "./repositories/tasks.js";
import { getDashboard } from "./services/dashboard.js";
import { getOverviewContext, getRiskContext, getTodayContext } from "./services/context.js";
import { buildGamificationOverview, buildGamificationProfile, buildXpMomentumPulse } from "./services/gamification.js";
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
import { getProjectBoard, listProjectSummaries } from "./services/projects.js";
import { getWeeklyReviewPayload } from "./services/reviews.js";
import { createTaskRunWatchdog, type TaskRunWatchdogOptions } from "./services/task-run-watchdog.js";
import { suggestTags } from "./services/tagging.js";
import {
  PSYCHE_ENTITY_TYPES,
  createBehaviorSchema,
  commentListQuerySchema,
  createBeliefEntrySchema,
  createBehaviorPatternSchema,
  createCommentSchema,
  createEmotionDefinitionSchema,
  createEventTypeSchema,
  createModeGuideSessionSchema,
  createModeProfileSchema,
  createPsycheValueSchema,
  createTriggerReportSchema,
  updateBehaviorSchema,
  updateBeliefEntrySchema,
  updateBehaviorPatternSchema,
  updateCommentSchema,
  updateEmotionDefinitionSchema,
  updateEventTypeSchema,
  updateModeGuideSessionSchema,
  updateModeProfileSchema,
  updatePsycheValueSchema,
  updateTriggerReportSchema
} from "./psyche-types.js";
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
  createProjectSchema,
  createManualRewardGrantSchema,
  createSessionEventSchema,
  createTagSchema,
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
  updateInsightSchema,
  updateProjectSchema,
  updateRewardRuleSchema,
  updateTaskSchema
} from "./types.js";
import { buildOpenApiDocument } from "./openapi.js";
import { registerWebRoutes } from "./web.js";
import { createManagerRuntime } from "./managers/runtime.js";
import { isManagerError } from "./managers/type-guards.js";

const COMPATIBILITY_SUNSET = "transitional-node";

function markCompatibilityRoute(reply: { header: (name: string, value: string) => unknown }) {
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
        description: "Initial connection payload carrying the latest activity watermark.",
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
        description: "Emitted when approvals, insights, or agent actions change.",
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
  const protocol = readSingleForwardedHeader(request.headers["x-forwarded-proto"]) ?? request.protocol ?? "http";
  const host =
    readSingleForwardedHeader(request.headers["x-forwarded-host"]) ??
    readSingleForwardedHeader(request.headers.host) ??
    request.hostname;

  return `${protocol}://${host}`;
}

const AGENT_ONBOARDING_ENTITY_CATALOG = [
  {
    entityType: "goal",
    purpose: "A long-horizon outcome or direction. Goals anchor projects and tasks.",
    minimumCreateFields: ["title"],
    relationshipRules: [
      "Goals sit above projects and tasks.",
      "Projects should usually link to one goal through goalId.",
      "Tasks can link directly to a goal when no project exists yet."
    ],
    searchHints: ["Search by title before creating a new goal.", "Use status filters when looking for paused or completed goals."],
    examples: [
      '{"title":"Create meaningfully","horizon":"lifetime","description":"Make work that is honest, beautiful, and published."}',
      '{"title":"Build a beautiful family","horizon":"lifetime","description":"Invest in love, stability, and shared rituals."}'
    ],
    fieldGuide: [
      { name: "title", type: "string", required: true, description: "Human-readable goal name." },
      { name: "description", type: "string", required: false, description: "Why the goal matters or what success looks like.", defaultValue: "" },
      { name: "horizon", type: "quarter|year|lifetime", required: false, description: "How far out the goal is meant to live.", enumValues: ["quarter", "year", "lifetime"], defaultValue: "year" },
      { name: "status", type: "active|paused|completed", required: false, description: "Current lifecycle state for the goal.", enumValues: ["active", "paused", "completed"], defaultValue: "active" },
      { name: "targetPoints", type: "integer", required: false, description: "Approximate XP/point target for the goal.", defaultValue: 400 },
      { name: "themeColor", type: "hex-color", required: false, description: "Visual color used in the UI.", defaultValue: "#c8a46b" },
      { name: "tagIds", type: "string[]", required: false, description: "Existing tag ids linked to the goal.", defaultValue: [] }
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
    searchHints: ["Search by title inside the target goal before creating a new project."],
    examples: ['{"goalId":"goal_create_meaningfully","title":"Launch the public Forge plugin","description":"Ship a real public release that people can install."}'],
    fieldGuide: [
      { name: "goalId", type: "string", required: true, description: "Existing parent goal id." },
      { name: "title", type: "string", required: true, description: "Project name." },
      { name: "description", type: "string", required: false, description: "Desired outcome or scope.", defaultValue: "" },
      { name: "status", type: "active|paused|completed", required: false, description: "Lifecycle state.", enumValues: ["active", "paused", "completed"], defaultValue: "active" },
      { name: "targetPoints", type: "integer", required: false, description: "Approximate XP/point target for the project.", defaultValue: 240 },
      { name: "themeColor", type: "hex-color", required: false, description: "Visual color used in the UI.", defaultValue: "#c0c1ff" }
    ]
  },
  {
    entityType: "task",
    purpose: "A concrete actionable work item. Tasks are what the user actually does.",
    minimumCreateFields: ["title"],
    relationshipRules: [
      "A task can link to a goal, a project, both, or neither.",
      "Live work is tracked by task runs, not by task status alone.",
      "A task status of in_progress does not guarantee a live active run."
    ],
    searchHints: ["Search by title before creating a duplicate task.", "Use linkedTo filters when you know the parent goal or project."],
    examples: ['{"title":"Write the plugin release notes","projectId":"project_forge_plugin_launch","status":"focus","priority":"high"}'],
    fieldGuide: [
      { name: "title", type: "string", required: true, description: "Concrete action label." },
      { name: "description", type: "string", required: false, description: "Helpful context or acceptance notes.", defaultValue: "" },
      { name: "status", type: "backlog|focus|in_progress|blocked|done", required: false, description: "Board lane or completion state.", enumValues: ["backlog", "focus", "in_progress", "blocked", "done"], defaultValue: "backlog" },
      { name: "priority", type: "low|medium|high|critical", required: false, description: "Relative urgency.", enumValues: ["low", "medium", "high", "critical"], defaultValue: "medium" },
      { name: "owner", type: "string", required: false, description: "Human-facing owner label.", defaultValue: "Albert" },
      { name: "goalId", type: "string|null", required: false, description: "Linked goal id.", defaultValue: null, nullable: true },
      { name: "projectId", type: "string|null", required: false, description: "Linked project id.", defaultValue: null, nullable: true },
      { name: "dueDate", type: "YYYY-MM-DD|null", required: false, description: "Optional due date.", defaultValue: null, nullable: true },
      { name: "effort", type: "light|deep|marathon", required: false, description: "How heavy the task feels.", enumValues: ["light", "deep", "marathon"], defaultValue: "deep" },
      { name: "energy", type: "low|steady|high", required: false, description: "Energy demand.", enumValues: ["low", "steady", "high"], defaultValue: "steady" },
      { name: "points", type: "integer", required: false, description: "Reward value for the task.", defaultValue: 40 },
      { name: "sortOrder", type: "integer", required: false, description: "Lane ordering hint when set explicitly." },
      { name: "tagIds", type: "string[]", required: false, description: "Existing tag ids linked to the task.", defaultValue: [] }
    ]
  },
  {
    entityType: "insight",
    purpose: "An agent-authored observation or recommendation grounded in Forge data.",
    minimumCreateFields: ["title", "summary", "recommendation"],
    relationshipRules: [
      "Insights can optionally point at one entity through entityType and entityId.",
      "Use insights for interpretation or advice, not as a replacement for goals, tasks, or trigger reports."
    ],
    searchHints: ["Search recent insights before posting a new one if the same pattern may already be captured."],
    examples: ['{"entityType":"goal","entityId":"goal_create_meaningfully","title":"Admin drag is masking momentum","summary":"Creative progress is happening, but admin cleanup keeps interrupting it.","recommendation":"Protect one clean creative block and isolate admin into a separate recurring task."}'],
    fieldGuide: [
      { name: "entityType", type: "string|null", required: false, description: "Optional linked entity type.", defaultValue: null, nullable: true },
      { name: "entityId", type: "string|null", required: false, description: "Optional linked entity id.", defaultValue: null, nullable: true },
      { name: "timeframeLabel", type: "string|null", required: false, description: "Optional time window label.", defaultValue: null, nullable: true },
      { name: "title", type: "string", required: true, description: "Insight title." },
      { name: "summary", type: "string", required: true, description: "Short explanation of the pattern or tension." },
      { name: "recommendation", type: "string", required: true, description: "Actionable next move or reframing." },
      { name: "rationale", type: "string", required: false, description: "Why this insight is grounded in the data.", defaultValue: "" },
      { name: "confidence", type: "number", required: false, description: "Confidence from 0 to 1.", defaultValue: 0.7 },
      { name: "visibility", type: "string", required: false, description: "Visibility mode for the insight.", defaultValue: "visible" },
      { name: "ctaLabel", type: "string", required: false, description: "CTA shown in the UI.", defaultValue: "Review insight" }
    ]
  },
  {
    entityType: "event_type",
    purpose: "A reusable event taxonomy label for trigger reports, such as criticism, conflict, rupture, or overload.",
    minimumCreateFields: ["label"],
    relationshipRules: [
      "Trigger reports can reference one event type through eventTypeId.",
      "Use event types to normalize repeated report categories instead of inventing new wording every time."
    ],
    searchHints: ["Search by label before creating a new event type.", "Prefer existing event types when one clearly fits the situation."],
    fieldGuide: [
      { name: "label", type: "string", required: true, description: "Human-readable event type label." },
      { name: "description", type: "string", required: false, description: "What kind of incident this event type represents.", defaultValue: "" }
    ]
  },
  {
    entityType: "emotion_definition",
    purpose: "A reusable emotion vocabulary item for trigger reports, such as shame, anger, grief, or relief.",
    minimumCreateFields: ["label"],
    relationshipRules: [
      "Trigger report emotions can reference an emotion definition through emotionDefinitionId.",
      "Use emotion definitions to normalize repeated emotional labels across reports."
    ],
    searchHints: ["Search by label before creating a new emotion definition.", "Prefer an existing emotion definition when the label already captures the feeling well."],
    fieldGuide: [
      { name: "label", type: "string", required: true, description: "Emotion label." },
      { name: "description", type: "string", required: false, description: "What this emotion label is meant to capture.", defaultValue: "" },
      { name: "category", type: "string", required: false, description: "Optional grouping such as threat, grief, anger, or connection.", defaultValue: "" }
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
    searchHints: ["Search by title before creating a new value.", "Use linkedTo if the value should already be attached to a goal or task."],
    examples: ['{"title":"Steadiness","valuedDirection":"Respond calmly instead of collapsing or reacting fast.","whyItMatters":"I want to stay grounded in relationships and work."}'],
    fieldGuide: [
      { name: "title", type: "string", required: true, description: "Value name." },
      { name: "description", type: "string", required: false, description: "What the value means in practice.", defaultValue: "" },
      { name: "valuedDirection", type: "string", required: false, description: "How the user wants to live or act when guided by this value.", defaultValue: "" },
      { name: "whyItMatters", type: "string", required: false, description: "Why the value matters to the user.", defaultValue: "" },
      { name: "linkedGoalIds", type: "string[]", required: false, description: "Linked goal ids.", defaultValue: [] },
      { name: "linkedProjectIds", type: "string[]", required: false, description: "Linked project ids.", defaultValue: [] },
      { name: "linkedTaskIds", type: "string[]", required: false, description: "Linked task ids.", defaultValue: [] },
      { name: "committedActions", type: "string[]", required: false, description: "Small concrete actions that enact the value.", defaultValue: [] }
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
    searchHints: ["Search by title or by trigger language before creating a new pattern."],
    examples: ['{"title":"Late-night father text freeze","cueContexts":["Father texts late at night"],"targetBehavior":"Freeze, avoid replying, and doomscroll","shortTermPayoff":"Avoids immediate overwhelm","longTermCost":"Sleep loss, guilt, and dread","preferredResponse":"Pause, regulate, and reply on my own terms the next morning"}'],
    fieldGuide: [
      { name: "title", type: "string", required: true, description: "Short pattern name." },
      { name: "description", type: "string", required: false, description: "What usually happens in this loop.", defaultValue: "" },
      { name: "targetBehavior", type: "string", required: false, description: "The visible behavior this pattern tends to produce.", defaultValue: "" },
      { name: "cueContexts", type: "string[]", required: false, description: "Typical cues, contexts, or triggers.", defaultValue: [] },
      { name: "shortTermPayoff", type: "string", required: false, description: "What the loop gives immediately.", defaultValue: "" },
      { name: "longTermCost", type: "string", required: false, description: "What the loop costs later.", defaultValue: "" },
      { name: "preferredResponse", type: "string", required: false, description: "Preferred alternative response.", defaultValue: "" },
      { name: "linkedValueIds", type: "string[]", required: false, description: "Linked value ids.", defaultValue: [] },
      { name: "linkedSchemaLabels", type: "string[]", required: false, description: "Schema labels involved in the pattern.", defaultValue: [] },
      { name: "linkedModeLabels", type: "string[]", required: false, description: "Mode labels involved in the pattern.", defaultValue: [] },
      { name: "linkedModeIds", type: "string[]", required: false, description: "Linked mode ids.", defaultValue: [] },
      { name: "linkedBeliefIds", type: "string[]", required: false, description: "Linked belief ids.", defaultValue: [] }
    ]
  },
  {
    entityType: "behavior",
    purpose: "A concrete behavior pattern element or habit worth tracking directly.",
    minimumCreateFields: ["kind", "title"],
    relationshipRules: [
      "Behaviors can connect to behavior patterns, values, schemas, and modes.",
      "Trigger reports can link to behaviors they contained."
    ],
    searchHints: ["Search by title and kind before creating a new behavior."],
    examples: ['{"kind":"away","title":"Doomscroll after conflict cue","commonCues":["Received a critical text"],"shortTermPayoff":"Numbs the anxiety","longTermCost":"Loses time and deepens shame","replacementMove":"Put phone down and take one slow lap outside"}'],
    fieldGuide: [
      { name: "kind", type: "away|committed|recovery", required: true, description: "Whether the behavior moves away from values, toward them, or repairs after rupture.", enumValues: ["away", "committed", "recovery"] },
      { name: "title", type: "string", required: true, description: "Behavior label." },
      { name: "description", type: "string", required: false, description: "What the behavior looks like.", defaultValue: "" },
      { name: "commonCues", type: "string[]", required: false, description: "Typical cues for this behavior.", defaultValue: [] },
      { name: "urgeStory", type: "string", required: false, description: "What the inner urge or story feels like.", defaultValue: "" },
      { name: "shortTermPayoff", type: "string", required: false, description: "Immediate payoff.", defaultValue: "" },
      { name: "longTermCost", type: "string", required: false, description: "Longer-term cost.", defaultValue: "" },
      { name: "replacementMove", type: "string", required: false, description: "Preferred replacement move.", defaultValue: "" },
      { name: "repairPlan", type: "string", required: false, description: "Repair plan after the behavior occurs.", defaultValue: "" },
      { name: "linkedPatternIds", type: "string[]", required: false, description: "Linked behavior pattern ids.", defaultValue: [] },
      { name: "linkedValueIds", type: "string[]", required: false, description: "Linked value ids.", defaultValue: [] },
      { name: "linkedSchemaIds", type: "string[]", required: false, description: "Linked schema ids.", defaultValue: [] },
      { name: "linkedModeIds", type: "string[]", required: false, description: "Linked mode ids.", defaultValue: [] }
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
    searchHints: ["Search by statement or known schema theme before creating a new belief entry."],
    examples: ['{"statement":"If I disappoint people, they will leave me.","beliefType":"conditional","confidence":82,"evidenceFor":["People got cold when I failed them before"],"evidenceAgainst":["Some people stayed with me even after conflict"],"flexibleAlternative":"Disappointing someone can strain a relationship, but it does not automatically mean abandonment."}'],
    fieldGuide: [
      { name: "schemaId", type: "string|null", required: false, description: "Optional linked schema catalog id.", defaultValue: null, nullable: true },
      { name: "statement", type: "string", required: true, description: "Belief statement in the user's own words." },
      { name: "beliefType", type: "absolute|conditional", required: true, description: "Whether the belief is absolute or if-then shaped.", enumValues: ["absolute", "conditional"] },
      { name: "originNote", type: "string", required: false, description: "Where the belief seems to come from.", defaultValue: "" },
      { name: "confidence", type: "integer", required: false, description: "How strongly the belief feels true from 0 to 100.", defaultValue: 60 },
      { name: "evidenceFor", type: "string[]", required: false, description: "Evidence that seems to support the belief.", defaultValue: [] },
      { name: "evidenceAgainst", type: "string[]", required: false, description: "Evidence that weakens the belief.", defaultValue: [] },
      { name: "flexibleAlternative", type: "string", required: false, description: "More flexible alternative belief.", defaultValue: "" },
      { name: "linkedValueIds", type: "string[]", required: false, description: "Linked value ids.", defaultValue: [] },
      { name: "linkedBehaviorIds", type: "string[]", required: false, description: "Linked behavior ids.", defaultValue: [] },
      { name: "linkedModeIds", type: "string[]", required: false, description: "Linked mode ids.", defaultValue: [] },
      { name: "linkedReportIds", type: "string[]", required: false, description: "Linked trigger report ids.", defaultValue: [] }
    ]
  },
  {
    entityType: "mode_profile",
    purpose: "A schema-mode profile such as critic, child, coping, or healthy adult parts.",
    minimumCreateFields: ["family", "title"],
    relationshipRules: [
      "Modes can link to patterns, behaviors, and values.",
      "Trigger reports can include linkedModeIds and modeOverlays that reference modes."
    ],
    searchHints: ["Search by title or family before creating a new mode profile."],
    examples: ['{"family":"coping","title":"Cold controller","fear":"If I soften, I will be humiliated or lose control.","protectiveJob":"Stay hyper-competent and unreachable when threatened."}'],
    fieldGuide: [
      { name: "family", type: "coping|child|critic_parent|healthy_adult|happy_child", required: true, description: "Mode family.", enumValues: ["coping", "child", "critic_parent", "healthy_adult", "happy_child"] },
      { name: "title", type: "string", required: true, description: "Mode title." },
      { name: "archetype", type: "string", required: false, description: "Optional archetype label.", defaultValue: "" },
      { name: "persona", type: "string", required: false, description: "Narrative or felt sense of the mode.", defaultValue: "" },
      { name: "imagery", type: "string", required: false, description: "Imagery associated with the mode.", defaultValue: "" },
      { name: "symbolicForm", type: "string", required: false, description: "Symbolic form or metaphor.", defaultValue: "" },
      { name: "facialExpression", type: "string", required: false, description: "Typical facial expression or posture.", defaultValue: "" },
      { name: "fear", type: "string", required: false, description: "Core fear carried by the mode.", defaultValue: "" },
      { name: "burden", type: "string", required: false, description: "Burden or pain the mode carries.", defaultValue: "" },
      { name: "protectiveJob", type: "string", required: false, description: "What job the mode thinks it is doing.", defaultValue: "" },
      { name: "originContext", type: "string", required: false, description: "Where the mode seems to come from.", defaultValue: "" },
      { name: "firstAppearanceAt", type: "string|null", required: false, description: "Optional first-seen marker.", defaultValue: null, nullable: true },
      { name: "linkedPatternIds", type: "string[]", required: false, description: "Linked pattern ids.", defaultValue: [] },
      { name: "linkedBehaviorIds", type: "string[]", required: false, description: "Linked behavior ids.", defaultValue: [] },
      { name: "linkedValueIds", type: "string[]", required: false, description: "Linked value ids.", defaultValue: [] }
    ]
  },
  {
    entityType: "mode_guide_session",
    purpose: "A guided mode-mapping session that stores structured answers and candidate mode interpretations.",
    minimumCreateFields: ["summary", "answers", "results"],
    relationshipRules: [
      "Mode guide sessions help the user reason toward likely modes before or alongside mode profiles.",
      "Use mode guide sessions for guided interpretation, not as a replacement for durable mode profiles."
    ],
    searchHints: ["Search by summary when revisiting a prior guided mode session."],
    examples: ['{"summary":"Mapping the part that takes over under criticism","answers":[{"questionKey":"felt_shift","value":"I go cold and rigid"}],"results":[{"family":"coping","archetype":"detached_protector","label":"Cold controller","confidence":0.74,"reasoning":"It distances from shame and tries to stay untouchable."}]}'],
    fieldGuide: [
      { name: "summary", type: "string", required: true, description: "Short summary of what the guided session explored." },
      { name: "answers", type: "array", required: true, description: "List of { questionKey, value } items capturing the user's guided answers." },
      { name: "results", type: "array", required: true, description: "List of { family, archetype, label, confidence 0-1, reasoning } candidate mode interpretations." }
    ]
  },
  {
    entityType: "trigger_report",
    purpose: "A structured reflective incident report that ties situation, emotions, thoughts, behaviors, consequences, and next moves together.",
    minimumCreateFields: ["title"],
    relationshipRules: [
      "Trigger reports can link to values, goals, projects, tasks, patterns, behaviors, beliefs, and modes.",
      "A report is the best container for one specific emotionally meaningful episode.",
      "Use reports when you need one event chain, not just a generic pattern."
    ],
    searchHints: ["Search by title, event wording, or linked entities before creating a duplicate report."],
    examples: ['{"title":"Partner said we need to talk and I spiraled","customEventType":"relationship threat","eventSituation":"My partner texted that we needed to talk tonight.","emotions":[{"label":"fear","intensity":85},{"label":"shame","intensity":60}],"thoughts":[{"text":"This means I messed everything up."}],"behaviors":[{"text":"Paced, catastrophized, and checked my phone repeatedly"}],"nextMoves":["Wait until we speak before predicting the outcome","Write down the facts I actually know"]}'],
    fieldGuide: [
      { name: "title", type: "string", required: true, description: "Short name for the incident." },
      { name: "status", type: "draft|reviewed|integrated", required: false, description: "Reflection progress state.", enumValues: ["draft", "reviewed", "integrated"], defaultValue: "draft" },
      { name: "eventTypeId", type: "string|null", required: false, description: "Known event type id if already cataloged.", defaultValue: null, nullable: true },
      { name: "customEventType", type: "string", required: false, description: "Free-text event type when no existing type fits.", defaultValue: "" },
      { name: "eventSituation", type: "string", required: false, description: "What happened in the situation.", defaultValue: "" },
      { name: "occurredAt", type: "string|null", required: false, description: "When it happened.", defaultValue: null, nullable: true },
      { name: "emotions", type: "array", required: false, description: "List of { emotionDefinitionId|null, label, intensity 0-100, note } items.", defaultValue: [] },
      { name: "thoughts", type: "array", required: false, description: "List of { text, parentMode, criticMode, beliefId|null } items.", defaultValue: [] },
      { name: "behaviors", type: "array", required: false, description: "List of { text, mode, behaviorId|null } items.", defaultValue: [] },
      { name: "consequences", type: "object", required: false, description: "Object with selfShortTerm, selfLongTerm, othersShortTerm, othersLongTerm string arrays." },
      { name: "linkedPatternIds", type: "string[]", required: false, description: "Linked pattern ids.", defaultValue: [] },
      { name: "linkedValueIds", type: "string[]", required: false, description: "Linked value ids.", defaultValue: [] },
      { name: "linkedGoalIds", type: "string[]", required: false, description: "Linked goal ids.", defaultValue: [] },
      { name: "linkedProjectIds", type: "string[]", required: false, description: "Linked project ids.", defaultValue: [] },
      { name: "linkedTaskIds", type: "string[]", required: false, description: "Linked task ids.", defaultValue: [] },
      { name: "linkedBehaviorIds", type: "string[]", required: false, description: "Linked behavior ids.", defaultValue: [] },
      { name: "linkedBeliefIds", type: "string[]", required: false, description: "Linked belief ids.", defaultValue: [] },
      { name: "linkedModeIds", type: "string[]", required: false, description: "Linked mode ids.", defaultValue: [] },
      { name: "modeOverlays", type: "string[]", required: false, description: "Extra mode labels noticed during the incident.", defaultValue: [] },
      { name: "schemaLinks", type: "string[]", required: false, description: "Schema names or themes that seem related to the incident.", defaultValue: [] },
      { name: "modeTimeline", type: "array", required: false, description: "List of { stage, modeId|null, label, note } items describing the sequence of modes.", defaultValue: [] },
      { name: "nextMoves", type: "string[]", required: false, description: "Concrete next steps or repair moves.", defaultValue: [] }
    ]
  }
] as const;

const AGENT_ONBOARDING_PSYCHE_PLAYBOOKS = [
  {
    focus: "behavior_pattern",
    useWhen: "Use for a recurring loop that shows up across multiple situations and can be described as cue -> response -> payoff -> cost -> preferred response.",
    coachingGoal: "Help the user build a CBT-style functional analysis instead of just naming the problem vaguely.",
    askSequence: [
      "Name the loop in plain language.",
      "Identify the typical cue or context.",
      "Describe the visible behavior or sequence once it starts.",
      "Clarify the short-term payoff or protection.",
      "Clarify the long-term cost.",
      "Name the preferred alternative response."
    ],
    requiredForCreate: ["title"],
    highValueOptionalFields: ["description", "targetBehavior", "cueContexts", "shortTermPayoff", "longTermCost", "preferredResponse", "linkedBeliefIds", "linkedModeIds", "linkedValueIds"],
    exampleQuestions: [
      "What usually sets this loop off?",
      "What do you tend to do next, outwardly or inwardly?",
      "What does that move do for you immediately?",
      "What does it cost you later?",
      "If this loop loosened a little, what response would you want to make instead?"
    ],
    notes: [
      "A pattern is usually the best Psyche container for functional analysis.",
      "If the user is describing one specific episode rather than a repeated loop, prefer a trigger report."
    ]
  },
  {
    focus: "belief_entry",
    useWhen: "Use for a belief, rule, or self-statement that keeps showing up in reactions, especially when the user can phrase it as a sentence.",
    coachingGoal: "Turn implicit self-talk or a likely schema theme into one explicit belief statement that can be tested and linked to patterns, reports, and modes.",
    askSequence: [
      "Capture the belief in the user's own words.",
      "Decide whether it is absolute or conditional.",
      "Estimate how true it feels from 0 to 100.",
      "Collect evidence for and evidence against.",
      "Offer a more flexible alternative belief.",
      "Link a schemaId only when a real schema catalog match is known."
    ],
    requiredForCreate: ["statement", "beliefType"],
    highValueOptionalFields: ["schemaId", "confidence", "originNote", "evidenceFor", "evidenceAgainst", "flexibleAlternative", "linkedReportIds", "linkedBehaviorIds", "linkedModeIds"],
    exampleQuestions: [
      "What is the sentence your mind seems to be pushing here?",
      "Is it more of an always/never belief, or an if-then rule?",
      "How true does it feel right now from 0 to 100?",
      "What seems to support it, and what weakens it?",
      "What would a more flexible alternative sound like?"
    ],
    notes: [
      "Schema catalog entries are reference concepts; belief_entry is the user-owned record.",
      "If no schema catalog match is known, omit schemaId rather than inventing one."
    ]
  },
  {
    focus: "mode_profile",
    useWhen: "Use when the user is describing a recurring part-state, protector, critic, vulnerable child state, or healthy adult stance.",
    coachingGoal: "Help the user describe what the mode is trying to do, what it fears, and how it presents, rather than reducing it to a label only.",
    askSequence: [
      "Choose the mode family first.",
      "Name the mode.",
      "Describe the felt persona or imagery.",
      "Clarify its fear, burden, and protective job.",
      "Optionally note origin context and linked patterns or behaviors."
    ],
    requiredForCreate: ["family", "title"],
    highValueOptionalFields: ["persona", "imagery", "fear", "burden", "protectiveJob", "originContext", "linkedPatternIds", "linkedBehaviorIds", "linkedValueIds"],
    exampleQuestions: [
      "What kind of part does this feel like: coping, child, critic-parent, healthy-adult, or happy-child?",
      "If you gave this mode a name, what would it be?",
      "What is it afraid would happen if it stopped doing its job?",
      "What burden or pain does it seem to carry?"
    ],
    notes: [
      "Mode profiles are durable parts descriptions.",
      "Mode guide sessions are the guided reasoning process that can lead toward a mode profile."
    ]
  },
  {
    focus: "trigger_report",
    useWhen: "Use for one specific emotionally meaningful incident that should be mapped from situation through emotions, thoughts, behaviors, consequences, and next moves.",
    coachingGoal: "Help the user build a clear incident chain with enough structure to learn from one episode.",
    askSequence: [
      "Name the incident briefly.",
      "Describe what happened in the situation.",
      "Capture emotions and intensity.",
      "Capture thoughts or belief-linked interpretations.",
      "Capture behaviors and immediate coping moves.",
      "Capture short-term and long-term consequences.",
      "Identify next moves and linked patterns, beliefs, modes, values, or tasks."
    ],
    requiredForCreate: ["title"],
    highValueOptionalFields: ["eventTypeId", "customEventType", "eventSituation", "occurredAt", "emotions", "thoughts", "behaviors", "consequences", "modeTimeline", "nextMoves", "linkedPatternIds", "linkedBeliefIds", "linkedModeIds", "linkedValueIds"],
    exampleQuestions: [
      "What happened, as concretely as you can say it?",
      "What emotions were there, and how intense were they?",
      "What thoughts or meanings showed up?",
      "What did you do next?",
      "What did that do for you short term, and what did it cost later?",
      "What would be the next good move now?"
    ],
    notes: [
      "Use eventTypeId only when a known event taxonomy item fits; otherwise use customEventType.",
      "Use emotionDefinitionId only when a known emotion definition fits; otherwise keep the raw label."
    ]
  }
] as const;

const AGENT_ONBOARDING_TOOL_INPUT_CATALOG = [
  {
    toolName: "forge_search_entities",
    summary: "Search Forge entities before create or update.",
    whenToUse: "Use when duplicate risk exists or when you need ids before mutating.",
    inputShape: "{ searches: Array<{ entityTypes?: CrudEntityType[], query?: string, ids?: string[], status?: string[], linkedTo?: { entityType, id }, includeDeleted?: boolean, limit?: number, clientRef?: string }> }",
    requiredFields: ["searches"],
    notes: [
      "searches is always an array, even for a single search.",
      "linkedTo is useful when looking for items under one parent entity."
    ],
    example: '{"searches":[{"entityTypes":["goal"],"query":"Create meaningfully","limit":10,"clientRef":"goal-search-1"}]}'
  },
  {
    toolName: "forge_create_entities",
    summary: "Create one or more entities in one ordered batch.",
    whenToUse: "Use after explicit save intent and after duplicate checks when needed.",
    inputShape: "{ atomic?: boolean, operations: Array<{ entityType: CrudEntityType, clientRef?: string, data: object }> }",
    requiredFields: ["operations", "operations[].entityType", "operations[].data"],
    notes: [
      "entityType alone is never enough; full data is required.",
      "Batch multiple related creates together when they come from one user ask."
    ],
    example: '{"operations":[{"entityType":"goal","data":{"title":"Create meaningfully","horizon":"lifetime"},"clientRef":"goal-1"},{"entityType":"project","data":{"goalId":"goal_123","title":"Launch the first public Forge plugin build"},"clientRef":"project-1"}]}'
  },
  {
    toolName: "forge_update_entities",
    summary: "Patch one or more entities in one ordered batch.",
    whenToUse: "Use when ids are known and the user explicitly wants a change persisted.",
    inputShape: "{ atomic?: boolean, operations: Array<{ entityType: CrudEntityType, id: string, clientRef?: string, patch: object }> }",
    requiredFields: ["operations", "operations[].entityType", "operations[].id", "operations[].patch"],
    notes: ["patch is partial; only send the fields that should change."],
    example: '{"operations":[{"entityType":"task","id":"task_123","patch":{"status":"focus","priority":"high"},"clientRef":"task-patch-1"}]}'
  },
  {
    toolName: "forge_delete_entities",
    summary: "Delete one or more entities through the batch delete flow.",
    whenToUse: "Use for explicit delete intent only.",
    inputShape: "{ atomic?: boolean, operations: Array<{ entityType: CrudEntityType, id: string, clientRef?: string, mode?: \"soft\"|\"hard\", reason?: string }> }",
    requiredFields: ["operations", "operations[].entityType", "operations[].id"],
    notes: ["Delete defaults to soft.", "Use mode=hard only for explicit permanent removal."],
    example: '{"operations":[{"entityType":"task","id":"task_123","mode":"soft","reason":"Merged into another task"}]}'
  },
  {
    toolName: "forge_restore_entities",
    summary: "Restore soft-deleted entities from the settings bin.",
    whenToUse: "Use when the user wants an entity brought back after a soft delete.",
    inputShape: "{ atomic?: boolean, operations: Array<{ entityType: CrudEntityType, id: string, clientRef?: string }> }",
    requiredFields: ["operations", "operations[].entityType", "operations[].id"],
    notes: ["Restore only works for soft-deleted entities."],
    example: '{"operations":[{"entityType":"goal","id":"goal_123","clientRef":"goal-restore-1"}]}'
  },
  {
    toolName: "forge_post_insight",
    summary: "Store an agent-authored insight.",
    whenToUse: "Use when you have a data-grounded observation or recommendation worth keeping visible in Forge.",
    inputShape: "{ entityType?: string|null, entityId?: string|null, timeframeLabel?: string|null, title: string, summary: string, recommendation: string, rationale?: string, confidence?: number, visibility?: string, ctaLabel?: string }",
    requiredFields: ["title", "summary", "recommendation"],
    notes: ["Insights are for interpretation and advice, not for replacing user-owned goals or tasks."],
    example: '{"entityType":"goal","entityId":"goal_123","title":"Admin drag is masking momentum","summary":"Creative progress is happening, but admin cleanup keeps interrupting it.","recommendation":"Protect one clean creative block and isolate admin into a separate recurring task.","confidence":0.82}'
  },
  {
    toolName: "forge_log_work",
    summary: "Log work that already happened.",
    whenToUse: "Use for retroactive work, not for starting a live session.",
    inputShape: "{ taskId?: string, title?: string, description?: string, summary?: string, goalId?: string|null, projectId?: string|null, owner?: string, status?: TaskStatus, priority?: TaskPriority, dueDate?: string|null, effort?: TaskEffort, energy?: TaskEnergy, points?: number, tagIds?: string[] }",
    requiredFields: ["taskId or title"],
    notes: ["Use taskId when logging work against an existing task.", "Use title when a new completed work item should be created and logged."],
    example: '{"taskId":"task_123","summary":"Finished the review draft and cleaned the notes.","points":40}'
  },
  {
    toolName: "forge_start_task_run",
    summary: "Start truthful live work on a task.",
    whenToUse: "Use when the user wants to begin working now.",
    inputShape: "{ taskId: string, actor: string, timerMode?: \"planned\"|\"unlimited\", plannedDurationSeconds?: number|null, isCurrent?: boolean, leaseTtlSeconds?: number, note?: string }",
    requiredFields: ["taskId", "actor"],
    notes: ["If timerMode is planned, plannedDurationSeconds is required.", "If timerMode is unlimited, plannedDurationSeconds must be null or omitted."],
    example: '{"taskId":"task_123","actor":"aurel","timerMode":"planned","plannedDurationSeconds":1500,"isCurrent":true,"leaseTtlSeconds":900,"note":"Starting focused writing block"}'
  },
  {
    toolName: "forge_heartbeat_task_run",
    summary: "Refresh an active run lease while work continues.",
    whenToUse: "Use periodically during ongoing live work.",
    inputShape: "{ taskRunId: string, actor?: string, leaseTtlSeconds?: number, note?: string }",
    requiredFields: ["taskRunId"],
    notes: ["Heartbeat extends the lease and can update the note."],
    example: '{"taskRunId":"run_123","actor":"aurel","leaseTtlSeconds":900,"note":"Still in the block"}'
  },
  {
    toolName: "forge_focus_task_run",
    summary: "Mark one active run as the current focus.",
    whenToUse: "Use when several runs exist and one should be the visible current run.",
    inputShape: "{ taskRunId: string, actor?: string }",
    requiredFields: ["taskRunId"],
    notes: ["This does not complete or release a run; it just changes current focus."],
    example: '{"taskRunId":"run_123","actor":"aurel"}'
  },
  {
    toolName: "forge_complete_task_run",
    summary: "Finish an active run as completed work.",
    whenToUse: "Use when the user has finished the live work block.",
    inputShape: "{ taskRunId: string, actor?: string, note?: string }",
    requiredFields: ["taskRunId"],
    notes: ["This is the truthful way to finish live work and award completion effects."],
    example: '{"taskRunId":"run_123","actor":"aurel","note":"Finished the review draft"}'
  },
  {
    toolName: "forge_release_task_run",
    summary: "Stop an active run without marking the task complete.",
    whenToUse: "Use when the user is stopping or pausing work without completion.",
    inputShape: "{ taskRunId: string, actor?: string, note?: string }",
    requiredFields: ["taskRunId"],
    notes: ["Use this instead of faking a stop by only changing task status."],
    example: '{"taskRunId":"run_123","actor":"aurel","note":"Stopping for now; blocked on feedback"}'
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
      "psyche.comment",
      "psyche.insight",
      "psyche.mode"
    ],
    recommendedTrustLevel: "trusted" as const,
    recommendedAutonomyMode: "approval_required" as const,
    recommendedApprovalMode: "approval_by_default" as const,
    authModes: {
      operatorSession: {
        label: "Quick connect",
        summary: "Recommended for localhost and Tailscale. No token is required up front; Forge can bootstrap an operator session automatically.",
        tokenRequired: false,
        trustedTargets: ["localhost", "127.0.0.1", "*.ts.net", "100.64.0.0/10"]
      },
      managedToken: {
        label: "Managed token",
        summary: "Use a long-lived token when you want explicit scoped auth, remote non-Tailscale access, or durable agent credentials.",
        tokenRequired: true
      }
    },
    tokenRecovery: {
      rawTokenStoredByForge: false,
      recoveryAction: "rotate_or_issue_new_token",
      rotationSummary: "Forge reveals raw tokens once. If you lose one, rotate it or issue a new token from Settings and update the plugin config.",
      settingsSummary: "Token creation, rotation, and revocation all live under Forge Settings so recovery is explicit and operator-controlled."
    },
    requiredHeaders: {
      authorization: "Authorization: Bearer <forge-api-token>",
      source: "X-Forge-Source: agent",
      actor: "X-Forge-Actor: <agent-label>"
    },
    conceptModel: {
      goal: "Long-horizon direction or outcome. Goals anchor projects and sometimes tasks directly.",
      project: "A multi-step workstream under one goal. Projects organize related tasks.",
      task: "A concrete actionable work item. Task status is board state, not proof of live work.",
      taskRun: "A live work session attached to a task. Start, heartbeat, focus, complete, and release runs instead of faking work with status alone.",
      insight: "An agent-authored observation or recommendation grounded in Forge data.",
      psyche:
        "Forge Psyche is the reflective domain for values, patterns, behaviors, beliefs, modes, and trigger reports. It is sensitive and should be handled deliberately."
    },
    psycheSubmoduleModel: {
      value: "A value is the direction the user wants to move toward. Values orient action and can link back to goals, projects, tasks, and Psyche records.",
      behaviorPattern: "A behavior pattern is the recurring CBT-style loop: cue/context, visible response, short-term payoff, long-term cost, and preferred response.",
      behavior: "A behavior record is one trackable move or tendency, classified as away, committed, or recovery.",
      beliefEntry: "A belief entry is the user's own trackable belief statement, including beliefType, confidence, evidence, and a more flexible alternative.",
      schemaCatalog: "The schema catalog is the reference taxonomy of maladaptive and adaptive schemas. Belief entries can optionally point to one schema by schemaId, but the schema catalog is not itself the user's belief record.",
      modeProfile: "A mode profile is a durable description of a recurring part-state or strategy, including family, fear, burden, protective job, and origin context.",
      modeGuideSession: "A mode guide session is the guided reasoning worksheet that stores answers and candidate mode interpretations before or alongside a durable mode profile.",
      eventType: "An event type is reusable incident taxonomy for trigger reports, such as criticism, conflict, rupture, or overload.",
      emotionDefinition: "An emotion definition is reusable emotion vocabulary for trigger reports. Reports can either reference one or fall back to raw labels.",
      triggerReport: "A trigger report is the one-episode incident chain: situation, emotions, thoughts, behaviors, consequences, extra mode labels, schema themes, and next moves."
    },
    psycheCoachingPlaybooks: AGENT_ONBOARDING_PSYCHE_PLAYBOOKS,
    relationshipModel: [
      "Goals are the top-level strategic layer.",
      "Projects belong to one goal through goalId.",
      "Tasks can belong to a goal, a project, both, or neither.",
      "Task runs represent live work sessions on tasks and are separate from task status.",
      "Psyche values can link to goals, projects, and tasks.",
      "Behavior patterns, behaviors, beliefs, modes, and trigger reports cross-link to describe one reflective model rather than isolated records.",
      "Insights can point at one entity, but they exist to capture interpretation or advice rather than raw work items."
    ],
    entityCatalog: AGENT_ONBOARDING_ENTITY_CATALOG,
    toolInputCatalog: AGENT_ONBOARDING_TOOL_INPUT_CATALOG,
    verificationPaths: {
      context: "/api/v1/context",
      xpMetrics: "/api/v1/metrics/xp",
      weeklyReview: "/api/v1/reviews/weekly",
      settingsBin: "/api/v1/settings/bin",
      batchSearch: "/api/v1/entities/search",
      psycheSchemaCatalog: "/api/v1/psyche/schema-catalog",
      psycheEventTypes: "/api/v1/psyche/event-types",
      psycheEmotions: "/api/v1/psyche/emotions"
    },
    recommendedPluginTools: {
      bootstrap: ["forge_get_operator_overview"],
      readModels: [
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
      workWorkflow: [
        "forge_log_work",
        "forge_start_task_run",
        "forge_heartbeat_task_run",
        "forge_focus_task_run",
        "forge_complete_task_run",
        "forge_release_task_run"
      ],
      insightWorkflow: ["forge_post_insight"]
    },
    interactionGuidance: {
      conversationMode: "continue_main_discussion_first",
      saveSuggestionPlacement: "end_of_message",
      saveSuggestionTone: "gentle_optional",
      maxQuestionsPerTurn: 3,
      duplicateCheckRoute: "/api/v1/entities/search",
      uiSuggestionRule: "offer_visual_ui_when_review_or_editing_would_be_easier",
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
      restoreSummary: "Restore soft-deleted entities through the restore route or the settings bin.",
      entityDeleteSummary: "Entity DELETE routes default to soft delete. Pass mode=hard only when permanent removal is intended.",
      batchingRule:
        "forge_create_entities, forge_update_entities, forge_delete_entities, and forge_restore_entities all accept operations as arrays. Batch multiple related mutations together in one request when possible.",
      searchRule: "forge_search_entities accepts searches as an array. Search before create or update when duplicate risk exists.",
      createRule: "Each create operation must include entityType and full data. entityType alone is not enough.",
      updateRule: "Each update operation must include entityType, id, and patch.",
      createExample:
        '{"operations":[{"entityType":"goal","data":{"title":"Create meaningfully"},"clientRef":"goal-create-1"},{"entityType":"goal","data":{"title":"Build a beautiful family"},"clientRef":"goal-create-2"}]}',
      updateExample:
        '{"operations":[{"entityType":"task","id":"task_123","patch":{"status":"focus","priority":"high"},"clientRef":"task-update-1"}]}'
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

function parseOptionalActorHeader(headers: Record<string, unknown>): string | null {
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
    rawSource === undefined ? "ui" : activitySourceSchema.parse(typeof rawSource === "string" ? rawSource.trim() : rawSource);
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

function hasTokenScope(token: { scopes: string[] } | null, scope: string): boolean {
  return Boolean(token?.scopes.includes(scope));
}

function isPsycheEntityType(entityType: string | null | undefined): entityType is (typeof PSYCHE_ENTITY_TYPES)[number] {
  return Boolean(entityType && PSYCHE_ENTITY_TYPES.includes(entityType as (typeof PSYCHE_ENTITY_TYPES)[number]));
}

function getWatchdogHealth(taskRunWatchdog: ReturnType<typeof createTaskRunWatchdog> | null) {
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
    state: status.running ? "healthy" as const : "idle" as const,
    reason: null,
    status
  };
}

function buildHealthPayload(taskRunWatchdog: ReturnType<typeof createTaskRunWatchdog> | null, extras: Record<string, unknown> = {}) {
  const watchdog = getWatchdogHealth(taskRunWatchdog);
  return {
    ok: watchdog.healthy,
    app: "forge",
    now: new Date().toISOString(),
    watchdog,
    ...extras
  };
}

function buildV1Context() {
  return {
    meta: {
      apiVersion: "v1" as const,
      transport: "rest+sse" as const,
      generatedAt: new Date().toISOString(),
      backend: "forge-node-runtime",
      mode: "transitional-node" as const
    },
    metrics: buildGamificationProfile(listGoals(), listTasks()),
    dashboard: getDashboard(),
    overview: getOverviewContext(),
    today: getTodayContext(),
    risk: getRiskContext(),
    goals: listGoals(),
    projects: listProjectSummaries(),
    tags: listTags(),
    tasks: listTasks(),
    activeTaskRuns: listTaskRuns({ active: true, limit: 25 }),
    activity: listActivityEvents({ limit: 25 })
  };
}

function buildXpMetricsPayload() {
  const goals = listGoals();
  const tasks = listTasks();
  const rules = listRewardRules();
  const gamificationOverview = buildGamificationOverview(goals, tasks);
  const dailyAmbientCap = rules
    .filter((rule) => rule.family === "ambient")
    .reduce((max, rule) => Math.max(max, Number(rule.config.dailyCap ?? 0)), 0) || 12;

  return {
    profile: gamificationOverview.profile,
    achievements: gamificationOverview.achievements,
    milestoneRewards: gamificationOverview.milestoneRewards,
    momentumPulse: buildXpMomentumPulse(goals, tasks),
    recentLedger: listRewardLedger({ limit: 25 }),
    rules,
    dailyAmbientXp: getDailyAmbientXp(new Date().toISOString().slice(0, 10)),
    dailyAmbientCap
  };
}

function buildOperatorContext() {
  const tasks = listTasks();
  const activeProjects = listProjectSummaries({ status: "active" }).filter(
    (project) => project.activeTaskCount > 0 || project.completedTaskCount > 0
  );
  const focusTasks = tasks.filter((task) => task.status === "focus" || task.status === "in_progress");
  const recommendedNextTask =
    focusTasks[0] ??
    tasks.find((task) => task.status === "backlog") ??
    tasks.find((task) => task.status === "blocked") ??
    null;

  return {
    generatedAt: new Date().toISOString(),
    activeProjects: activeProjects.slice(0, 8),
    focusTasks: focusTasks.slice(0, 12),
    currentBoard: {
      backlog: tasks.filter((task) => task.status === "backlog").slice(0, 20),
      focus: tasks.filter((task) => task.status === "focus").slice(0, 20),
      inProgress: tasks.filter((task) => task.status === "in_progress").slice(0, 20),
      blocked: tasks.filter((task) => task.status === "blocked").slice(0, 20),
      done: tasks.filter((task) => task.status === "done").slice(0, 20)
    },
    recentActivity: listActivityEvents({ limit: 20 }),
    recentTaskRuns: listTaskRuns({ limit: 12 }),
    recommendedNextTask,
    xp: buildXpMetricsPayload()
  };
}

function buildOperatorOverviewRouteGuide() {
  return {
    preferredStart: "/api/v1/operator/overview",
    mainRoutes: [
      {
        id: "context",
        path: "/api/v1/context",
        summary: "Full Forge shell snapshot with goals, projects, tasks, activity, and derived overview blocks.",
        requiredScope: null
      },
      {
        id: "operator_context",
        path: "/api/v1/operator/context",
        summary: "Operational task board, focus queue, recent activity, and XP state for assistant workflows.",
        requiredScope: null
      },
      {
        id: "psyche_overview",
        path: "/api/v1/psyche/overview",
        summary: "Aggregate Psyche state across values, patterns, behaviors, beliefs, modes, and trigger reports.",
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
        summary: "Weekly reflection read model with wins, chart, and reward framing.",
        requiredScope: null
      },
      {
        id: "events",
        path: "/api/v1/events",
        summary: "Canonical event-log inspection for audit and provenance tracing.",
        requiredScope: null
      },
      {
        id: "agent_onboarding",
        path: "/api/v1/agents/onboarding",
        summary: "Live onboarding contract describing headers, scopes, verification probes, and plugin defaults.",
        requiredScope: null
      },
      {
        id: "settings_bin",
        path: "/api/v1/settings/bin",
        summary: "Deleted-items bin grouped by entity type with restore and permanent-delete actions.",
        requiredScope: "write"
      },
      {
        id: "entity_batch_search",
        path: "/api/v1/entities/search",
        summary: "Batch search route for mixed-entity lookup, linked-entity matching, and optional deleted-item visibility.",
        requiredScope: "write"
      },
      {
        id: "entity_batch_mutation",
        path: "/api/v1/entities/{create|update|delete|restore}",
        summary: "Preferred multi-entity mutation surface for agents. Delete defaults to soft delete and restore reverses soft deletion.",
        requiredScope: "write"
      },
      {
        id: "operator_log_work",
        path: "/api/v1/operator/log-work",
        summary: "Retroactively log real work and receive updated XP without pretending a live task run happened.",
        requiredScope: "write"
      },
      {
        id: "task_runs",
        path: "/api/v1/tasks/:id/runs + /api/v1/task-runs/*",
        summary: "Canonical live-work surface for starting, refreshing, focusing, completing, and releasing active task runs.",
        requiredScope: "write"
      }
    ]
  };
}

function buildOperatorOverview(request: {
  protocol: string;
  hostname: string;
  headers: Record<string, unknown>;
}) {
  const auth = parseRequestAuth(request.headers);
  const canReadPsyche = auth.token ? hasTokenScope(auth.token, "psyche.read") : true;
  const warnings = canReadPsyche ? [] : ["Psyche summary omitted because the active token does not include psyche.read."];

  return {
    generatedAt: new Date().toISOString(),
    snapshot: buildV1Context(),
    operator: buildOperatorContext(),
    domains: listDomains(),
    psyche: canReadPsyche ? getPsycheOverview() : null,
    onboarding: buildAgentOnboardingPayload(request),
    capabilities: {
      tokenPresent: Boolean(auth.token),
      scopes: auth.token?.scopes ?? [],
      canReadPsyche,
      canWritePsyche: auth.token ? hasTokenScope(auth.token, "psyche.write") : true,
      canManageModes: auth.token ? hasTokenScope(auth.token, "psyche.mode") : true,
      canManageRewards: auth.token ? hasTokenScope(auth.token, "rewards.manage") : true
    },
    warnings,
    routeGuide: buildOperatorOverviewRouteGuide()
  };
}

export async function buildServer(options: { dataRoot?: string; seedDemoData?: boolean; taskRunWatchdog?: false | TaskRunWatchdogOptions } = {}) {
  const managers = createManagerRuntime({ dataRoot: options.dataRoot });
  const runtimeConfig = managers.configuration.readRuntimeConfig({ dataRoot: options.dataRoot });
  configureDatabase({ dataRoot: runtimeConfig.dataRoot ?? undefined });
  configureDatabaseSeeding(options.seedDemoData ?? false);
  await managers.migration.initialize();
  const app = Fastify({
    logger: false,
    rewriteUrl: (request) => rewriteMountPath(request.url ?? "/")
  });
  const taskRunWatchdog = options.taskRunWatchdog === false ? null : createTaskRunWatchdog(options.taskRunWatchdog);

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, runtimeConfig.allowedOrigins.some((pattern) => pattern.test(origin)));
    },
    credentials: true
  });
  app.addHook("onClose", async () => {
    taskRunWatchdog?.stop();
  });

  app.setErrorHandler((error, _request, reply) => {
    const validationIssues = error instanceof ZodError ? formatValidationIssues(error) : undefined;
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
      error: validationIssues ? "Request validation failed" : getErrorMessage(error),
      statusCode,
      ...(validationIssues ? { details: validationIssues } : {}),
      ...(isHttpError(error) && error.details ? error.details : {}),
      ...(isManagerError(error) && error.details ? error.details : {})
    });
  });

  const authenticateRequest = (headers: Record<string, unknown>) => managers.authentication.authenticate(headers);
  const toActivityContext = (context: ReturnType<typeof authenticateRequest>) =>
    ({
      actor: context.actor,
      source: context.source
    }) as const;
  const requireOperatorSession = (headers: Record<string, unknown>, detail?: Record<string, unknown>) => {
    const context = authenticateRequest(headers);
    managers.authorization.requireAuthenticatedOperator(context, detail);
    return context;
  };
  const requireAuthenticatedActor = (headers: Record<string, unknown>, detail?: Record<string, unknown>) => {
    const context = authenticateRequest(headers);
    managers.authorization.requireAuthenticatedActor(context, detail);
    return context;
  };
  const requireScopedAccess = (headers: Record<string, unknown>, scopes: string[], detail?: Record<string, unknown>) => {
    const context = authenticateRequest(headers);
    managers.authorization.requireAnyTokenScope(context, scopes, detail);
    return context;
  };
  const requirePsycheScopedAccess = (headers: Record<string, unknown>, scopes: string[], detail?: Record<string, unknown>) => {
    const context = authenticateRequest(headers);
    if (isPsycheAuthRequired()) {
      managers.authorization.requireAnyTokenScope(context, scopes, detail);
    }
    return context;
  };
  const requireCommentAccess = (
    headers: Record<string, unknown>,
    entityType: string | null | undefined,
    detail?: Record<string, unknown>
  ) => {
    const context = authenticateRequest(headers);
    if (isPsycheEntityType(entityType)) {
      if (isPsycheAuthRequired()) {
        managers.authorization.requireAuthenticatedActor(context, detail);
        managers.authorization.requireTokenScope(context, "psyche.comment", {
          entityType,
          ...(detail ?? {})
        });
      }
      return context;
    }
    managers.authorization.requireAuthenticatedActor(context, detail);
    managers.authorization.requireAnyTokenScope(context, ["write", "insights"], detail);
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
    managers.authorization.requireAnyTokenScope(context, ["write", "insights"], detail);
    return context;
  };

  app.get("/api/health", async () => buildHealthPayload(taskRunWatchdog));

  app.get("/api/v1/health", async () =>
    buildHealthPayload(taskRunWatchdog, {
      apiVersion: "v1",
      backend: "forge-node-runtime"
    })
  );

  app.get("/api/v1/auth/operator-session", async (request, reply) => ({
    session: managers.session.ensureLocalOperatorSession(request.headers as Record<string, unknown>, reply)
  }));
  app.delete("/api/v1/auth/operator-session", async (request, reply) => ({
    revoked: managers.session.revokeCurrentSession(request.headers as Record<string, unknown>, reply)
  }));
  app.get("/api/v1/openapi.json", async () => buildOpenApiDocument());
  app.get("/api/v1/context", async () => buildV1Context());
  app.get("/api/v1/operator/context", async (request) => {
    requireOperatorSession(request.headers as Record<string, unknown>, { route: "/api/v1/operator/context" });
    return {
      context: buildOperatorContext()
    };
  });
  app.get("/api/v1/operator/overview", async (request) => {
    requireOperatorSession(request.headers as Record<string, unknown>, { route: "/api/v1/operator/overview" });
    return {
      overview: buildOperatorOverview(request)
    };
  });
  app.get("/api/v1/domains", async () => ({
    domains: listDomains()
  }));
  app.get("/api/v1/psyche/overview", async (request) => {
    requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.read"], { route: "/api/v1/psyche/overview" });
    return { overview: getPsycheOverview() };
  });
  app.get("/api/v1/psyche/values", async (request) => {
    requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.read"], { route: "/api/v1/psyche/values" });
    return { values: listPsycheValues() };
  });
  app.post("/api/v1/psyche/values", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.write"], { route: "/api/v1/psyche/values" });
    const value = createPsycheValue(createPsycheValueSchema.parse(request.body ?? {}), toActivityContext(auth));
    reply.code(201);
    return { value };
  });
  app.get("/api/v1/psyche/values/:id", async (request, reply) => {
    requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.read"], { route: "/api/v1/psyche/values/:id" });
    const { id } = request.params as { id: string };
    const value = getPsycheValueById(id);
    if (!value) {
      reply.code(404);
      return { error: "Psyche value not found" };
    }
    return { value };
  });
  app.patch("/api/v1/psyche/values/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.write"], { route: "/api/v1/psyche/values/:id" });
    const { id } = request.params as { id: string };
    const value = updatePsycheValue(id, updatePsycheValueSchema.parse(request.body ?? {}), toActivityContext(auth));
    if (!value) {
      reply.code(404);
      return { error: "Psyche value not found" };
    }
    return { value };
  });
  app.delete("/api/v1/psyche/values/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.write"], { route: "/api/v1/psyche/values/:id" });
    const { id } = request.params as { id: string };
    const value = deleteEntity("psyche_value", id, entityDeleteQuerySchema.parse(request.query ?? {}), toActivityContext(auth));
    if (!value) {
      reply.code(404);
      return { error: "Psyche value not found" };
    }
    return { value };
  });
  app.get("/api/v1/psyche/patterns", async (request) => {
    requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.read"], { route: "/api/v1/psyche/patterns" });
    return { patterns: listBehaviorPatterns() };
  });
  app.post("/api/v1/psyche/patterns", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.write"], { route: "/api/v1/psyche/patterns" });
    const pattern = createBehaviorPattern(createBehaviorPatternSchema.parse(request.body ?? {}), toActivityContext(auth));
    reply.code(201);
    return { pattern };
  });
  app.get("/api/v1/psyche/patterns/:id", async (request, reply) => {
    requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.read"], { route: "/api/v1/psyche/patterns/:id" });
    const { id } = request.params as { id: string };
    const pattern = getBehaviorPatternById(id);
    if (!pattern) {
      reply.code(404);
      return { error: "Behavior pattern not found" };
    }
    return { pattern };
  });
  app.patch("/api/v1/psyche/patterns/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.write"], { route: "/api/v1/psyche/patterns/:id" });
    const { id } = request.params as { id: string };
    const pattern = updateBehaviorPattern(id, updateBehaviorPatternSchema.parse(request.body ?? {}), toActivityContext(auth));
    if (!pattern) {
      reply.code(404);
      return { error: "Behavior pattern not found" };
    }
    return { pattern };
  });
  app.delete("/api/v1/psyche/patterns/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.write"], { route: "/api/v1/psyche/patterns/:id" });
    const { id } = request.params as { id: string };
    const pattern = deleteEntity("behavior_pattern", id, entityDeleteQuerySchema.parse(request.query ?? {}), toActivityContext(auth));
    if (!pattern) {
      reply.code(404);
      return { error: "Behavior pattern not found" };
    }
    return { pattern };
  });
  app.get("/api/v1/psyche/behaviors", async (request) => {
    requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.read"], { route: "/api/v1/psyche/behaviors" });
    return { behaviors: listBehaviors() };
  });
  app.post("/api/v1/psyche/behaviors", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.write"], { route: "/api/v1/psyche/behaviors" });
    const behavior = createBehavior(createBehaviorSchema.parse(request.body ?? {}), toActivityContext(auth));
    reply.code(201);
    return { behavior };
  });
  app.get("/api/v1/psyche/behaviors/:id", async (request, reply) => {
    requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.read"], { route: "/api/v1/psyche/behaviors/:id" });
    const { id } = request.params as { id: string };
    const behavior = getBehaviorById(id);
    if (!behavior) {
      reply.code(404);
      return { error: "Behavior not found" };
    }
    return { behavior };
  });
  app.patch("/api/v1/psyche/behaviors/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.write"], { route: "/api/v1/psyche/behaviors/:id" });
    const { id } = request.params as { id: string };
    const behavior = updateBehavior(id, updateBehaviorSchema.parse(request.body ?? {}), toActivityContext(auth));
    if (!behavior) {
      reply.code(404);
      return { error: "Behavior not found" };
    }
    return { behavior };
  });
  app.delete("/api/v1/psyche/behaviors/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.write"], { route: "/api/v1/psyche/behaviors/:id" });
    const { id } = request.params as { id: string };
    const behavior = deleteEntity("behavior", id, entityDeleteQuerySchema.parse(request.query ?? {}), toActivityContext(auth));
    if (!behavior) {
      reply.code(404);
      return { error: "Behavior not found" };
    }
    return { behavior };
  });
  app.get("/api/v1/psyche/schema-catalog", async (request) => {
    requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.read"], { route: "/api/v1/psyche/schema-catalog" });
    return { schemas: listSchemaCatalog() };
  });
  app.get("/api/v1/psyche/beliefs", async (request) => {
    requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.read"], { route: "/api/v1/psyche/beliefs" });
    return { beliefs: listBeliefEntries() };
  });
  app.post("/api/v1/psyche/beliefs", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.write"], { route: "/api/v1/psyche/beliefs" });
    const belief = createBeliefEntry(createBeliefEntrySchema.parse(request.body ?? {}), toActivityContext(auth));
    reply.code(201);
    return { belief };
  });
  app.get("/api/v1/psyche/beliefs/:id", async (request, reply) => {
    requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.read"], { route: "/api/v1/psyche/beliefs/:id" });
    const { id } = request.params as { id: string };
    const belief = getBeliefEntryById(id);
    if (!belief) {
      reply.code(404);
      return { error: "Belief not found" };
    }
    return { belief };
  });
  app.patch("/api/v1/psyche/beliefs/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.write"], { route: "/api/v1/psyche/beliefs/:id" });
    const { id } = request.params as { id: string };
    const belief = updateBeliefEntry(id, updateBeliefEntrySchema.parse(request.body ?? {}), toActivityContext(auth));
    if (!belief) {
      reply.code(404);
      return { error: "Belief not found" };
    }
    return { belief };
  });
  app.delete("/api/v1/psyche/beliefs/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.write"], { route: "/api/v1/psyche/beliefs/:id" });
    const { id } = request.params as { id: string };
    const belief = deleteEntity("belief_entry", id, entityDeleteQuerySchema.parse(request.query ?? {}), toActivityContext(auth));
    if (!belief) {
      reply.code(404);
      return { error: "Belief not found" };
    }
    return { belief };
  });
  app.get("/api/v1/psyche/modes", async (request) => {
    requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.read"], { route: "/api/v1/psyche/modes" });
    return { modes: listModeProfiles() };
  });
  app.post("/api/v1/psyche/modes", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.mode"], { route: "/api/v1/psyche/modes" });
    const mode = createModeProfile(createModeProfileSchema.parse(request.body ?? {}), toActivityContext(auth));
    reply.code(201);
    return { mode };
  });
  app.get("/api/v1/psyche/modes/:id", async (request, reply) => {
    requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.read"], { route: "/api/v1/psyche/modes/:id" });
    const { id } = request.params as { id: string };
    const mode = getModeProfileById(id);
    if (!mode) {
      reply.code(404);
      return { error: "Mode not found" };
    }
    return { mode };
  });
  app.patch("/api/v1/psyche/modes/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.mode"], { route: "/api/v1/psyche/modes/:id" });
    const { id } = request.params as { id: string };
    const mode = updateModeProfile(id, updateModeProfileSchema.parse(request.body ?? {}), toActivityContext(auth));
    if (!mode) {
      reply.code(404);
      return { error: "Mode not found" };
    }
    return { mode };
  });
  app.delete("/api/v1/psyche/modes/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.mode"], { route: "/api/v1/psyche/modes/:id" });
    const { id } = request.params as { id: string };
    const mode = deleteEntity("mode_profile", id, entityDeleteQuerySchema.parse(request.query ?? {}), toActivityContext(auth));
    if (!mode) {
      reply.code(404);
      return { error: "Mode not found" };
    }
    return { mode };
  });
  app.get("/api/v1/psyche/mode-guides", async (request) => {
    requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.mode"], { route: "/api/v1/psyche/mode-guides" });
    return { sessions: listModeGuideSessions() };
  });
  app.post("/api/v1/psyche/mode-guides", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.mode"], { route: "/api/v1/psyche/mode-guides" });
    const session = createModeGuideSession(createModeGuideSessionSchema.parse(request.body ?? {}), toActivityContext(auth));
    reply.code(201);
    return { session };
  });
  app.get("/api/v1/psyche/mode-guides/:id", async (request, reply) => {
    requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.mode"], { route: "/api/v1/psyche/mode-guides/:id" });
    const { id } = request.params as { id: string };
    const session = getModeGuideSessionById(id);
    if (!session) {
      reply.code(404);
      return { error: "Mode guide session not found" };
    }
    return { session };
  });
  app.patch("/api/v1/psyche/mode-guides/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.mode"], { route: "/api/v1/psyche/mode-guides/:id" });
    const { id } = request.params as { id: string };
    const session = updateModeGuideSession(id, updateModeGuideSessionSchema.parse(request.body ?? {}), toActivityContext(auth));
    if (!session) {
      reply.code(404);
      return { error: "Mode guide session not found" };
    }
    return { session };
  });
  app.delete("/api/v1/psyche/mode-guides/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.mode"], { route: "/api/v1/psyche/mode-guides/:id" });
    const { id } = request.params as { id: string };
    const session = deleteEntity("mode_guide_session", id, entityDeleteQuerySchema.parse(request.query ?? {}), toActivityContext(auth));
    if (!session) {
      reply.code(404);
      return { error: "Mode guide session not found" };
    }
    return { session };
  });
  app.get("/api/v1/psyche/event-types", async (request) => {
    requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.read"], { route: "/api/v1/psyche/event-types" });
    return { eventTypes: listEventTypes() };
  });
  app.post("/api/v1/psyche/event-types", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.write"], { route: "/api/v1/psyche/event-types" });
    const eventType = createEventType(createEventTypeSchema.parse(request.body ?? {}), toActivityContext(auth));
    reply.code(201);
    return { eventType };
  });
  app.get("/api/v1/psyche/event-types/:id", async (request, reply) => {
    requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.read"], { route: "/api/v1/psyche/event-types/:id" });
    const { id } = request.params as { id: string };
    const eventType = getEventTypeById(id);
    if (!eventType) {
      reply.code(404);
      return { error: "Event type not found" };
    }
    return { eventType };
  });
  app.patch("/api/v1/psyche/event-types/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.write"], { route: "/api/v1/psyche/event-types/:id" });
    const { id } = request.params as { id: string };
    const eventType = updateEventType(id, updateEventTypeSchema.parse(request.body ?? {}), toActivityContext(auth));
    if (!eventType) {
      reply.code(404);
      return { error: "Event type not found" };
    }
    return { eventType };
  });
  app.delete("/api/v1/psyche/event-types/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.write"], { route: "/api/v1/psyche/event-types/:id" });
    const { id } = request.params as { id: string };
    const eventType = deleteEntity("event_type", id, entityDeleteQuerySchema.parse(request.query ?? {}), toActivityContext(auth));
    if (!eventType) {
      reply.code(404);
      return { error: "Event type not found" };
    }
    return { eventType };
  });
  app.get("/api/v1/psyche/emotions", async (request) => {
    requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.read"], { route: "/api/v1/psyche/emotions" });
    return { emotions: listEmotionDefinitions() };
  });
  app.post("/api/v1/psyche/emotions", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.write"], { route: "/api/v1/psyche/emotions" });
    const emotion = createEmotionDefinition(createEmotionDefinitionSchema.parse(request.body ?? {}), toActivityContext(auth));
    reply.code(201);
    return { emotion };
  });
  app.get("/api/v1/psyche/emotions/:id", async (request, reply) => {
    requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.read"], { route: "/api/v1/psyche/emotions/:id" });
    const { id } = request.params as { id: string };
    const emotion = getEmotionDefinitionById(id);
    if (!emotion) {
      reply.code(404);
      return { error: "Emotion definition not found" };
    }
    return { emotion };
  });
  app.patch("/api/v1/psyche/emotions/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.write"], { route: "/api/v1/psyche/emotions/:id" });
    const { id } = request.params as { id: string };
    const emotion = updateEmotionDefinition(id, updateEmotionDefinitionSchema.parse(request.body ?? {}), toActivityContext(auth));
    if (!emotion) {
      reply.code(404);
      return { error: "Emotion definition not found" };
    }
    return { emotion };
  });
  app.delete("/api/v1/psyche/emotions/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.write"], { route: "/api/v1/psyche/emotions/:id" });
    const { id } = request.params as { id: string };
    const emotion = deleteEntity("emotion_definition", id, entityDeleteQuerySchema.parse(request.query ?? {}), toActivityContext(auth));
    if (!emotion) {
      reply.code(404);
      return { error: "Emotion definition not found" };
    }
    return { emotion };
  });
  app.get("/api/v1/psyche/reports", async (request) => {
    requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.read"], { route: "/api/v1/psyche/reports" });
    return { reports: listTriggerReports() };
  });
  app.post("/api/v1/psyche/reports", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.write"], { route: "/api/v1/psyche/reports" });
    const report = createTriggerReport(createTriggerReportSchema.parse(request.body ?? {}), toActivityContext(auth));
    reply.code(201);
    return { report };
  });
  app.get("/api/v1/psyche/reports/:id", async (request, reply) => {
    requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.read"], { route: "/api/v1/psyche/reports/:id" });
    const { id } = request.params as { id: string };
    const report = getTriggerReportById(id);
    if (!report) {
      reply.code(404);
      return { error: "Trigger report not found" };
    }
    return {
      report,
      comments: listComments({ entityType: "trigger_report", entityId: id }),
      insights: listInsights({ entityType: "trigger_report", entityId: id, limit: 50 })
    };
  });
  app.patch("/api/v1/psyche/reports/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.write"], { route: "/api/v1/psyche/reports/:id" });
    const { id } = request.params as { id: string };
    const report = updateTriggerReport(id, updateTriggerReportSchema.parse(request.body ?? {}), toActivityContext(auth));
    if (!report) {
      reply.code(404);
      return { error: "Trigger report not found" };
    }
    return { report };
  });
  app.delete("/api/v1/psyche/reports/:id", async (request, reply) => {
    const auth = requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.write"], { route: "/api/v1/psyche/reports/:id" });
    const { id } = request.params as { id: string };
    const report = deleteEntity("trigger_report", id, entityDeleteQuerySchema.parse(request.query ?? {}), toActivityContext(auth));
    if (!report) {
      reply.code(404);
      return { error: "Trigger report not found" };
    }
    return { report };
  });
  app.get("/api/v1/comments", async (request) => {
    const query = commentListQuerySchema.parse(request.query ?? {});
    if (isPsycheEntityType(query.entityType)) {
      requirePsycheScopedAccess(request.headers as Record<string, unknown>, ["psyche.read"], { route: "/api/v1/comments", entityType: query.entityType });
    }
    return { comments: listComments(query) };
  });
  app.post("/api/v1/comments", async (request, reply) => {
    const input = createCommentSchema.parse(request.body ?? {});
    const auth = requireCommentAccess(request.headers as Record<string, unknown>, input.entityType, {
      route: "/api/v1/comments",
      entityType: input.entityType
    });
    const comment = createComment(input, toActivityContext(auth));
    reply.code(201);
    return { comment };
  });
  app.get("/api/v1/comments/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = getCommentById(id);
    const auth = requireCommentAccess(request.headers as Record<string, unknown>, current?.entityType, {
      route: "/api/v1/comments/:id",
      entityType: current?.entityType ?? null
    });
    void auth;
    if (!current) {
      reply.code(404);
      return { error: "Comment not found" };
    }
    return { comment: current };
  });
  app.patch("/api/v1/comments/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const patch = updateCommentSchema.parse(request.body ?? {});
    const current = getCommentById(id);
    const auth = requireCommentAccess(request.headers as Record<string, unknown>, current?.entityType, {
      route: "/api/v1/comments/:id",
      entityType: current?.entityType ?? null
    });
    const comment = updateComment(id, patch, toActivityContext(auth));
    if (!comment) {
      reply.code(404);
      return { error: "Comment not found" };
    }
    return { comment };
  });
  app.delete("/api/v1/comments/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = getCommentById(id);
    const auth = requireCommentAccess(request.headers as Record<string, unknown>, current?.entityType, {
      route: "/api/v1/comments/:id",
      entityType: current?.entityType ?? null
    });
    const comment = deleteEntity("comment", id, entityDeleteQuerySchema.parse(request.query ?? {}), toActivityContext(auth));
    if (!comment) {
      reply.code(404);
      return { error: "Comment not found" };
    }
    return { comment };
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
  app.get("/api/v1/goals", async () => ({ goals: listGoals() }));
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
    return { tasks: listTasks(query) };
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
  app.get("/api/v1/tags", async () => ({ tags: listTags() }));
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
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/activity/:id/remove" });
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
    metrics: buildGamificationOverview(listGoals(), listTasks())
  }));
  app.get("/api/v1/metrics/xp", async () => ({
    metrics: buildXpMetricsPayload()
  }));
  app.get("/api/v1/insights", async () => ({
    insights: getInsightsPayload()
  }));
  app.post("/api/v1/insights", async (request, reply) => {
    const input = createInsightSchema.parse(request.body ?? {});
    const auth = requireInsightAccess(request.headers as Record<string, unknown>, input.entityType, {
      route: "/api/v1/insights",
      entityType: input.entityType
    });
    const insight = createInsight(
      input,
      { actor: auth.actor, source: auth.source }
    );
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
    const auth = requireInsightAccess(request.headers as Record<string, unknown>, current?.entityType, {
      route: "/api/v1/insights/:id",
      entityType: current?.entityType ?? null
    });
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
    const auth = requireInsightAccess(request.headers as Record<string, unknown>, current?.entityType, {
      route: "/api/v1/insights/:id",
      entityType: current?.entityType ?? null
    });
    const query = entityDeleteQuerySchema.parse(request.query ?? {});
    const insight =
      query.mode === "hard"
        ? deleteInsight(id, { actor: auth.actor, source: auth.source })
        : deleteEntity("insight", id, query, { actor: auth.actor, source: auth.source });
    if (!insight) {
      reply.code(404);
      return { error: "Insight not found" };
    }
    return { insight };
  });
  app.post("/api/v1/insights/:id/feedback", async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = getInsightById(id);
    const auth = requireInsightAccess(request.headers as Record<string, unknown>, current?.entityType, {
      route: "/api/v1/insights/:id/feedback",
      entityType: current?.entityType ?? null
    });
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
    requireOperatorSession(request.headers as Record<string, unknown>, { route: "/api/v1/approval-requests" });
    const query = request.query as { status?: string } | undefined;
    return { approvalRequests: listApprovalRequests(query?.status as never) };
  });
  app.post("/api/v1/approval-requests/:id/approve", async (request, reply) => {
    const context = requireOperatorSession(request.headers as Record<string, unknown>, { route: "/api/v1/approval-requests/:id/approve" });
    const { id } = request.params as { id: string };
    const body = resolveApprovalRequestSchema.parse(request.body ?? {});
    const approvalRequest = approveApprovalRequest(id, body.note, body.actor ?? context.actor ?? parseOptionalActorHeader(request.headers as Record<string, unknown>));
    if (!approvalRequest) {
      reply.code(404);
      return { error: "Approval request not found" };
    }
    return { approvalRequest };
  });
  app.post("/api/v1/approval-requests/:id/reject", async (request, reply) => {
    const context = requireOperatorSession(request.headers as Record<string, unknown>, { route: "/api/v1/approval-requests/:id/reject" });
    const { id } = request.params as { id: string };
    const body = resolveApprovalRequestSchema.parse(request.body ?? {});
    const approvalRequest = rejectApprovalRequest(id, body.note, body.actor ?? context.actor ?? parseOptionalActorHeader(request.headers as Record<string, unknown>));
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
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/agent-actions" });
    const input = createAgentActionSchema.parse(request.body ?? {});
    const idempotencyKey = parseIdempotencyKey(request.headers as Record<string, unknown>);
    const result = createAgentAction(
      input,
      { actor: auth.actor, source: auth.source, token: auth.token ? managers.token.getTokenById(auth.token.id) : null },
      idempotencyKey
    );
    reply.code(result.approvalRequest ? 202 : 201);
    return result;
  });
  app.get("/api/v1/rewards/rules", async (request) => {
    requireOperatorSession(request.headers as Record<string, unknown>, { route: "/api/v1/rewards/rules" });
    return { rules: listRewardRules() };
  });
  app.get("/api/v1/rewards/rules/:id", async (request, reply) => {
    requireOperatorSession(request.headers as Record<string, unknown>, { route: "/api/v1/rewards/rules/:id" });
    const { id } = request.params as { id: string };
    const rule = getRewardRuleById(id);
    if (!rule) {
      reply.code(404);
      return { error: "Reward rule not found" };
    }
    return { rule };
  });
  app.patch("/api/v1/rewards/rules/:id", async (request, reply) => {
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["rewards.manage", "write"], { route: "/api/v1/rewards/rules/:id" });
    const { id } = request.params as { id: string };
    const rule = updateRewardRule(id, updateRewardRuleSchema.parse(request.body ?? {}), toActivityContext(auth));
    if (!rule) {
      reply.code(404);
      return { error: "Reward rule not found" };
    }
    return { rule };
  });
  app.get("/api/v1/rewards/ledger", async (request) => {
    requireOperatorSession(request.headers as Record<string, unknown>, { route: "/api/v1/rewards/ledger" });
    const query = rewardsLedgerQuerySchema.parse(request.query ?? {});
    return { ledger: listRewardLedger(query) };
  });
  app.post("/api/v1/rewards/bonus", async (request, reply) => {
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["rewards.manage", "write"], { route: "/api/v1/rewards/bonus" });
    const reward = createManualRewardGrant(createManualRewardGrantSchema.parse(request.body ?? {}), toActivityContext(auth));
    reply.code(201);
    return { reward, metrics: buildXpMetricsPayload() };
  });
  app.post("/api/v1/session-events", async (request, reply) => {
    const auth = requireAuthenticatedActor(request.headers as Record<string, unknown>, { route: "/api/v1/session-events" });
    const payload = createSessionEventSchema.parse(request.body ?? {});
    const event = recordSessionEvent(payload, { actor: auth.actor, source: auth.source });
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
  app.get("/api/v1/settings", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["read", "write"], { route: "/api/v1/settings" });
    return { settings: getSettings() };
  });
  app.get("/api/v1/settings/bin", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["read", "write"], { route: "/api/v1/settings/bin" });
    return { bin: getSettingsBinPayload() };
  });
  app.post("/api/v1/projects", async (request, reply) => {
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/projects" });
    const project = createProject(createProjectSchema.parse(request.body ?? {}), toActivityContext(auth));
    reply.code(201);
    return { project };
  });
  app.patch("/api/v1/projects/:id", async (request, reply) => {
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/projects/:id" });
    const { id } = request.params as { id: string };
    const project = updateProject(id, updateProjectSchema.parse(request.body ?? {}), toActivityContext(auth));
    if (!project) {
      reply.code(404);
      return { error: "Project not found" };
    }
    return { project };
  });
  app.delete("/api/v1/projects/:id", async (request, reply) => {
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/projects/:id" });
    const { id } = request.params as { id: string };
    const project = deleteEntity("project", id, entityDeleteQuerySchema.parse(request.query ?? {}), toActivityContext(auth));
    if (!project) {
      reply.code(404);
      return { error: "Project not found" };
    }
    return { project };
  });
  app.patch("/api/v1/settings", async (request) => {
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/settings" });
    return {
      settings: updateSettings(updateSettingsSchema.parse(request.body ?? {}), toActivityContext(auth))
    };
  });
  app.post("/api/v1/settings/tokens", async (request, reply) => {
    const auth = requireOperatorSession(request.headers as Record<string, unknown>, { route: "/api/v1/settings/tokens" });
    const token = managers.token.issueLocalAgentToken(createAgentTokenSchema.parse(request.body ?? {}), auth);
    reply.code(201);
    return { token };
  });
  app.post("/api/v1/settings/tokens/:id/rotate", async (request, reply) => {
    const auth = requireOperatorSession(request.headers as Record<string, unknown>, { route: "/api/v1/settings/tokens/:id/rotate" });
    const { id } = request.params as { id: string };
    const token = managers.token.rotateLocalAgentToken(id, auth);
    if (!token) {
      reply.code(404);
      return { error: "Agent token not found" };
    }
    return { token };
  });
  app.post("/api/v1/settings/tokens/:id/revoke", async (request, reply) => {
    const auth = requireOperatorSession(request.headers as Record<string, unknown>, { route: "/api/v1/settings/tokens/:id/revoke" });
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
      metrics: buildGamificationProfile(listGoals(), listTasks())
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
      metrics: buildGamificationProfile(listGoals(), listTasks()),
      dashboard: getDashboard(),
      overview: getOverviewContext(),
      today: getTodayContext(),
      risk: getRiskContext(),
      goals: listGoals(),
      projects: listProjectSummaries(),
      tags: listTags(),
      tasks: listTasks(query),
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
      goal: task.goalId ? getGoalById(task.goalId) ?? null : null,
      project: task.projectId ? listProjectSummaries().find((project) => project.id === task.projectId) ?? null : null,
      activeTaskRun: taskRuns.find((run) => run.status === "active") ?? null,
      taskRuns,
      activity: listActivityEventsForTask(id, 20)
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
      goal: task.goalId ? getGoalById(task.goalId) ?? null : null,
      project: task.projectId ? listProjectSummaries().find((project) => project.id === task.projectId) ?? null : null,
      activeTaskRun: taskRuns.find((run) => run.status === "active") ?? null,
      taskRuns,
      activity: listActivityEventsForTask(id, 20)
    });
  });

  app.post("/api/goals", async (request, reply) => {
    markCompatibilityRoute(reply);
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/goals" });
    const goal = createGoal(createGoalSchema.parse(request.body ?? {}), toActivityContext(auth));
    reply.code(201);
    return { goal };
  });
  app.post("/api/v1/goals", async (request, reply) => {
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/goals" });
    const goal = createGoal(createGoalSchema.parse(request.body ?? {}), toActivityContext(auth));
    reply.code(201);
    return { goal };
  });

  app.patch("/api/goals/:id", async (request, reply) => {
    markCompatibilityRoute(reply);
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/goals/:id" });
    const { id } = request.params as { id: string };
    const goal = updateGoal(id, updateGoalSchema.parse(request.body ?? {}), toActivityContext(auth));
    if (!goal) {
      reply.code(404);
      return { error: "Goal not found" };
    }
    return { goal };
  });
  app.patch("/api/v1/goals/:id", async (request, reply) => {
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/goals/:id" });
    const { id } = request.params as { id: string };
    const goal = updateGoal(id, updateGoalSchema.parse(request.body ?? {}), toActivityContext(auth));
    if (!goal) {
      reply.code(404);
      return { error: "Goal not found" };
    }
    return { goal };
  });
  app.delete("/api/v1/goals/:id", async (request, reply) => {
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/goals/:id" });
    const { id } = request.params as { id: string };
    const goal = deleteEntity("goal", id, entityDeleteQuerySchema.parse(request.query ?? {}), toActivityContext(auth));
    if (!goal) {
      reply.code(404);
      return { error: "Goal not found" };
    }
    return { goal };
  });

  app.post("/api/tags", async (request, reply) => {
    markCompatibilityRoute(reply);
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/tags" });
    const tag = createTag(createTagSchema.parse(request.body ?? {}), toActivityContext(auth));
    reply.code(201);
    return { tag };
  });
  app.post("/api/v1/tags", async (request, reply) => {
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/tags" });
    const tag = createTag(createTagSchema.parse(request.body ?? {}), toActivityContext(auth));
    reply.code(201);
    return { tag };
  });
  app.patch("/api/v1/tags/:id", async (request, reply) => {
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/tags/:id" });
    const { id } = request.params as { id: string };
    const tag = updateTag(id, updateTagSchema.parse(request.body ?? {}), toActivityContext(auth));
    if (!tag) {
      reply.code(404);
      return { error: "Tag not found" };
    }
    return { tag };
  });
  app.delete("/api/v1/tags/:id", async (request, reply) => {
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/tags/:id" });
    const { id } = request.params as { id: string };
    const tag = deleteEntity("tag", id, entityDeleteQuerySchema.parse(request.query ?? {}), toActivityContext(auth));
    if (!tag) {
      reply.code(404);
      return { error: "Tag not found" };
    }
    return { tag };
  });

  app.post("/api/tasks", async (request, reply) => {
    markCompatibilityRoute(reply);
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/tasks" });
    const input = createTaskSchema.parse(request.body ?? {});
    const idempotencyKey = parseIdempotencyKey(request.headers as Record<string, unknown>);
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
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/tasks" });
    const input = createTaskSchema.parse(request.body ?? {});
    const idempotencyKey = parseIdempotencyKey(request.headers as Record<string, unknown>);
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
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/tasks/:id/runs" });
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
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/tasks/:id/runs" });
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
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/tasks/:id" });
    const { id } = request.params as { id: string };
    const task = updateTask(id, updateTaskSchema.parse(request.body ?? {}), toActivityContext(auth));
    if (!task) {
      reply.code(404);
      return { error: "Task not found" };
    }
    return { task };
  });
  app.patch("/api/v1/tasks/:id", async (request, reply) => {
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/tasks/:id" });
    const { id } = request.params as { id: string };
    const task = updateTask(id, updateTaskSchema.parse(request.body ?? {}), toActivityContext(auth));
    if (!task) {
      reply.code(404);
      return { error: "Task not found" };
    }
    return { task };
  });
  app.delete("/api/v1/tasks/:id", async (request, reply) => {
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/tasks/:id" });
    const { id } = request.params as { id: string };
    const task = deleteEntity("task", id, entityDeleteQuerySchema.parse(request.query ?? {}), toActivityContext(auth));
    if (!task) {
      reply.code(404);
      return { error: "Task not found" };
    }
    return { task };
  });
  app.post("/api/v1/operator/log-work", async (request, reply) => {
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write", "rewards.manage"], { route: "/api/v1/operator/log-work" });
    const input = operatorLogWorkSchema.parse(request.body ?? {});

    if (input.taskId) {
      const task = updateTask(
        input.taskId,
        {
          title: input.title && input.title.trim().length > 0 ? input.title : undefined,
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
          tagIds: input.tagIds
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
        tagIds: input.tagIds ?? []
      }),
      toActivityContext(auth)
    );

    reply.code(201);
    return { task, xp: buildXpMetricsPayload() };
  });
  app.post("/api/v1/tasks/:id/uncomplete", async (request, reply) => {
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/tasks/:id/uncomplete" });
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
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/entities/create" });
    return createEntities(batchCreateEntitiesSchema.parse(request.body ?? {}), toActivityContext(auth));
  });
  app.post("/api/v1/entities/update", async (request) => {
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/entities/update" });
    return updateEntities(batchUpdateEntitiesSchema.parse(request.body ?? {}), toActivityContext(auth));
  });
  app.post("/api/v1/entities/delete", async (request) => {
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/entities/delete" });
    return deleteEntities(batchDeleteEntitiesSchema.parse(request.body ?? {}), toActivityContext(auth));
  });
  app.post("/api/v1/entities/restore", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/entities/restore" });
    return restoreEntities(batchRestoreEntitiesSchema.parse(request.body ?? {}));
  });
  app.post("/api/v1/entities/search", async (request) => {
    requireScopedAccess(request.headers as Record<string, unknown>, ["read", "write"], { route: "/api/v1/entities/search" });
    return searchEntities(batchSearchEntitiesSchema.parse(request.body ?? {}));
  });

  app.post("/api/task-runs/recover", async (request, reply) => {
    markCompatibilityRoute(reply);
    const payload = taskRunListQuerySchema.pick({ limit: true }).parse(request.body ?? {});
    return { timedOutRuns: recoverTimedOutTaskRuns({ limit: payload.limit }) };
  });

  app.post("/api/task-runs/:id/heartbeat", async (request, reply) => {
    markCompatibilityRoute(reply);
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/task-runs/:id/heartbeat" });
    const { id } = request.params as { id: string };
    const input = taskRunHeartbeatSchema.parse(request.body ?? {});
    return { taskRun: heartbeatTaskRun(id, input, new Date(), toActivityContext(auth)) };
  });
  app.post("/api/v1/task-runs/:id/heartbeat", async (request) => {
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/task-runs/:id/heartbeat" });
    const { id } = request.params as { id: string };
    const input = taskRunHeartbeatSchema.parse(request.body ?? {});
    return { taskRun: heartbeatTaskRun(id, input, new Date(), toActivityContext(auth)) };
  });

  app.post("/api/task-runs/:id/focus", async (request, reply) => {
    markCompatibilityRoute(reply);
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/task-runs/:id/focus" });
    const { id } = request.params as { id: string };
    const input = taskRunFocusSchema.parse(request.body ?? {});
    return { taskRun: focusTaskRun(id, input, new Date(), toActivityContext(auth)) };
  });
  app.post("/api/v1/task-runs/:id/focus", async (request) => {
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/task-runs/:id/focus" });
    const { id } = request.params as { id: string };
    const input = taskRunFocusSchema.parse(request.body ?? {});
    return { taskRun: focusTaskRun(id, input, new Date(), toActivityContext(auth)) };
  });

  app.post("/api/task-runs/:id/complete", async (request, reply) => {
    markCompatibilityRoute(reply);
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/task-runs/:id/complete" });
    const { id } = request.params as { id: string };
    const input = taskRunFinishSchema.parse(request.body ?? {});
    return { taskRun: completeTaskRun(id, input, new Date(), toActivityContext(auth)) };
  });
  app.post("/api/v1/task-runs/:id/complete", async (request) => {
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/task-runs/:id/complete" });
    const { id } = request.params as { id: string };
    const input = taskRunFinishSchema.parse(request.body ?? {});
    return { taskRun: completeTaskRun(id, input, new Date(), toActivityContext(auth)) };
  });

  app.post("/api/task-runs/:id/release", async (request, reply) => {
    markCompatibilityRoute(reply);
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/task-runs/:id/release" });
    const { id } = request.params as { id: string };
    const input = taskRunFinishSchema.parse(request.body ?? {});
    return { taskRun: releaseTaskRun(id, input, new Date(), toActivityContext(auth)) };
  });
  app.post("/api/v1/task-runs/:id/release", async (request) => {
    const auth = requireScopedAccess(request.headers as Record<string, unknown>, ["write"], { route: "/api/v1/task-runs/:id/release" });
    const { id } = request.params as { id: string };
    const input = taskRunFinishSchema.parse(request.body ?? {});
    return { taskRun: releaseTaskRun(id, input, new Date(), toActivityContext(auth)) };
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
