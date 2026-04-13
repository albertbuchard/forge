function arrayOf(items: Record<string, unknown>) {
  return {
    type: "array",
    items
  };
}

function nullable(schema: Record<string, unknown>) {
  return {
    anyOf: [schema, { type: "null" }]
  };
}

function jsonResponse(schema: Record<string, unknown>, description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema
      }
    }
  };
}

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head"
]);

const API_TAGS = [
  {
    name: "Meta",
    description: "OpenAPI discovery and route-level API metadata."
  },
  {
    name: "Health",
    description: "Runtime health, sleep, sports, workout, and mobile sync surfaces."
  },
  {
    name: "Movement",
    description:
      "Movement overviews, timeline history, known places, stays, trips, selection aggregates, and user-defined overlay routes."
  },
  {
    name: "Life Force",
    description:
      "Energy-budget, fatigue, and action-point modeling routes."
  },
  {
    name: "Auth",
    description: "Operator session bootstrapping for trusted local usage."
  },
  {
    name: "Platform",
    description: "Top-level runtime context and canonical Forge domain catalogs."
  },
  {
    name: "Operator",
    description: "Current work, overview, and operator-facing runtime state."
  },
  {
    name: "Users",
    description: "Forge user directory, ownership, and multi-user runtime surfaces."
  },
  {
    name: "Settings",
    description: "Local runtime settings, settings bin, and token management."
  },
  {
    name: "Agents",
    description: "Agent onboarding, registry, and action feeds."
  },
  {
    name: "Approvals",
    description: "Approval workflows for deferred or gated agent actions."
  },
  {
    name: "Entity Batch",
    description: "Batch create, update, delete, restore, and search operations across entity types."
  },
  {
    name: "Goals",
    description: "Long-horizon life goals."
  },
  {
    name: "Projects",
    description: "Project execution surfaces and project summaries."
  },
  {
    name: "Strategies",
    description: "Directed planning structures that sit above project execution."
  },
  {
    name: "Tasks",
    description: "Task CRUD, task context, and execution-adjacent task routes."
  },
  {
    name: "Task Runs",
    description: "Live task timer and timed work-session operations."
  },
  {
    name: "Habits",
    description: "Recurring commitments and habit check-ins."
  },
  {
    name: "Calendar",
    description: "Calendar connections, work blocks, timeboxes, and native Forge events."
  },
  {
    name: "Notes",
    description: "Markdown evidence records linked to one or more Forge entities."
  },
  {
    name: "Tags",
    description: "Tag CRUD for shared Forge classification."
  },
  {
    name: "Wiki",
    description: "File-first wiki settings, pages, ingest, sync, health, and search."
  },
  {
    name: "Preferences",
    description: "Preference profiles, comparisons, concepts, contexts, and learned scores."
  },
  {
    name: "Psyche",
    description: "Values, patterns, behaviors, beliefs, modes, reports, and related Psyche surfaces."
  },
  {
    name: "Questionnaires",
    description: "Psyche questionnaire libraries, runs, scoring, and self-observation calendar integration."
  },
  {
    name: "Insights",
    description: "Stored insights and structured feedback on them."
  },
  {
    name: "Workbench",
    description:
      "Graph-flow catalog, execution, published outputs, and node-result routes."
  },
  {
    name: "Metrics",
    description: "XP, reward-ledger, and runtime metric surfaces."
  },
  {
    name: "Reviews",
    description: "Weekly review and review-finalization operations."
  },
  {
    name: "Activity",
    description: "Activity feeds, event logs, and ambient session events."
  },
  {
    name: "Diagnostics",
    description: "Runtime diagnostics and operational logging routes."
  }
] as const;

const API_TAG_GROUPS = [
  {
    name: "Runtime",
    tags: ["Meta", "Auth", "Platform", "Operator", "Diagnostics"]
  },
  {
    name: "Embodied Context",
    tags: ["Health", "Movement", "Life Force"]
  },
  {
    name: "Core Work",
    tags: [
      "Goals",
      "Projects",
      "Strategies",
      "Tasks",
      "Task Runs",
      "Habits",
      "Calendar",
      "Notes",
      "Tags",
      "Activity",
      "Metrics",
      "Reviews",
      "Insights",
      "Workbench"
    ]
  },
  {
    name: "Knowledge And Reflection",
    tags: ["Wiki", "Preferences", "Psyche", "Questionnaires"]
  },
  {
    name: "Platform And Agents",
    tags: ["Users", "Settings", "Agents", "Approvals", "Entity Batch"]
  }
] as const;

function resolveTagsForPath(path: string) {
  if (path === "/api/v1/openapi.json") {
    return ["Meta"];
  }
  if (path.startsWith("/api/v1/diagnostics")) {
    return ["Diagnostics"];
  }
  if (path.startsWith("/api/v1/auth")) {
    return ["Auth"];
  }
  if (
    path.startsWith("/api/v1/health") ||
    path.startsWith("/api/v1/mobile")
  ) {
    return ["Health"];
  }
  if (path.startsWith("/api/v1/movement")) {
    return ["Movement"];
  }
  if (path.startsWith("/api/v1/life-force")) {
    return ["Life Force"];
  }
  if (path.startsWith("/api/v1/workbench")) {
    return ["Workbench"];
  }
  if (path.startsWith("/api/v1/screen-time")) {
    return ["Health"];
  }
  if (path === "/api/v1/context" || path.startsWith("/api/v1/domains")) {
    return ["Platform"];
  }
  if (path.startsWith("/api/v1/operator")) {
    return ["Operator"];
  }
  if (path.startsWith("/api/v1/users")) {
    return ["Users"];
  }
  if (path.startsWith("/api/v1/settings")) {
    return ["Settings"];
  }
  if (path.startsWith("/api/v1/approval-requests")) {
    return ["Approvals"];
  }
  if (
    path.startsWith("/api/v1/agents") ||
    path.startsWith("/api/v1/agent-actions")
  ) {
    return ["Agents"];
  }
  if (path.startsWith("/api/v1/entities")) {
    return ["Entity Batch"];
  }
  if (path.startsWith("/api/v1/wiki")) {
    return ["Wiki"];
  }
  if (path.startsWith("/api/v1/preferences")) {
    return ["Preferences"];
  }
  if (
    path.startsWith("/api/v1/psyche/questionnaires") ||
    path.startsWith("/api/v1/psyche/questionnaire-runs") ||
    path.startsWith("/api/v1/psyche/self-observation")
  ) {
    return ["Questionnaires", "Psyche"];
  }
  if (path.startsWith("/api/v1/psyche")) {
    return ["Psyche"];
  }
  if (path.startsWith("/api/v1/notes")) {
    return ["Notes"];
  }
  if (path.startsWith("/api/v1/strategies")) {
    return ["Strategies"];
  }
  if (path.startsWith("/api/v1/projects") || path.startsWith("/api/v1/campaigns")) {
    return ["Projects"];
  }
  if (path.startsWith("/api/v1/goals")) {
    return ["Goals"];
  }
  if (path.startsWith("/api/v1/habits")) {
    return ["Habits"];
  }
  if (path.startsWith("/api/v1/tags")) {
    return ["Tags"];
  }
  if (path.startsWith("/api/v1/task-runs")) {
    return ["Task Runs"];
  }
  if (
    path.startsWith("/api/v1/tasks") ||
    path.startsWith("/api/v1/work-adjustments")
  ) {
    return ["Tasks"];
  }
  if (path.startsWith("/api/v1/calendar")) {
    return ["Calendar"];
  }
  if (
    path.startsWith("/api/v1/activity") ||
    path.startsWith("/api/v1/events") ||
    path.startsWith("/api/v1/session-events")
  ) {
    return ["Activity"];
  }
  if (
    path.startsWith("/api/v1/metrics") ||
    path.startsWith("/api/v1/rewards")
  ) {
    return ["Metrics"];
  }
  if (path.startsWith("/api/v1/reviews")) {
    return ["Reviews"];
  }
  if (path.startsWith("/api/v1/insights")) {
    return ["Insights"];
  }
  return ["Platform"];
}

function toOperationId(method: string, path: string) {
  return `${method}${path
    .replace(/^\/api\/v1\//, "_")
    .replace(/[{}]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")}`;
}

function annotateOpenApiDocument(document: Record<string, unknown>) {
  const paths = document.paths as
    | Record<string, Record<string, Record<string, unknown>>>
    | undefined;

  document.tags = [...API_TAGS];
  document["x-tagGroups"] = [...API_TAG_GROUPS];

  if (!paths) {
    return document;
  }

  for (const [path, pathItem] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) {
        continue;
      }
      operation.tags ??= resolveTagsForPath(path);
      operation.operationId ??= toOperationId(method, path);
    }
  }

  return document;
}

export function buildOpenApiDocument() {
  const validationIssue = {
    type: "object",
    additionalProperties: false,
    required: ["path", "message"],
    properties: {
      path: { type: "string" },
      message: { type: "string" }
    }
  };

  const errorResponse = {
    type: "object",
    additionalProperties: true,
    required: ["code", "error", "statusCode"],
    properties: {
      code: { type: "string" },
      error: { type: "string" },
      statusCode: { type: "integer" },
      details: arrayOf({ $ref: "#/components/schemas/ValidationIssue" })
    }
  };

  const tag = {
    type: "object",
    additionalProperties: false,
    required: ["id", "name", "kind", "color", "description"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      kind: { type: "string", enum: ["value", "category", "execution"] },
      color: { type: "string" },
      description: { type: "string" }
    }
  };

  const goal = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "title",
      "description",
      "horizon",
      "status",
      "targetPoints",
      "themeColor",
      "createdAt",
      "updatedAt",
      "tagIds"
    ],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      horizon: { type: "string", enum: ["quarter", "year", "lifetime"] },
      status: { type: "string", enum: ["active", "paused", "completed"] },
      targetPoints: { type: "integer" },
      themeColor: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      tagIds: arrayOf({ type: "string" })
    }
  };

  const dashboardGoal = {
    allOf: [
      { $ref: "#/components/schemas/Goal" },
      {
        type: "object",
        additionalProperties: false,
        required: [
          "progress",
          "totalTasks",
          "completedTasks",
          "earnedPoints",
          "momentumLabel",
          "tags"
        ],
        properties: {
          progress: { type: "number" },
          totalTasks: { type: "integer" },
          completedTasks: { type: "integer" },
          earnedPoints: { type: "integer" },
          momentumLabel: { type: "string" },
          tags: arrayOf({ $ref: "#/components/schemas/Tag" })
        }
      }
    ]
  };

  const project = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "goalId",
      "title",
      "description",
      "status",
      "targetPoints",
      "themeColor",
      "schedulingRules",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      goalId: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      status: { type: "string", enum: ["active", "paused", "completed"] },
      targetPoints: { type: "integer" },
      themeColor: { type: "string" },
      schedulingRules: { $ref: "#/components/schemas/CalendarSchedulingRules" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const taskTimeSummary = {
    type: "object",
    additionalProperties: false,
    required: [
      "totalTrackedSeconds",
      "totalCreditedSeconds",
      "liveTrackedSeconds",
      "liveCreditedSeconds",
      "manualAdjustedSeconds",
      "activeRunCount",
      "hasCurrentRun",
      "currentRunId"
    ],
    properties: {
      totalTrackedSeconds: { type: "integer" },
      totalCreditedSeconds: { type: "number" },
      liveTrackedSeconds: { type: "integer" },
      liveCreditedSeconds: { type: "number" },
      manualAdjustedSeconds: { type: "integer" },
      activeRunCount: { type: "integer" },
      hasCurrentRun: { type: "boolean" },
      currentRunId: nullable({ type: "string" })
    }
  };

  const projectSummary = {
    allOf: [
      { $ref: "#/components/schemas/Project" },
      {
        type: "object",
        additionalProperties: false,
        required: [
          "goalTitle",
          "activeTaskCount",
          "completedTaskCount",
          "totalTasks",
          "earnedPoints",
          "progress",
          "nextTaskId",
          "nextTaskTitle",
          "momentumLabel",
          "time"
        ],
        properties: {
          goalTitle: { type: "string" },
          activeTaskCount: { type: "integer" },
          completedTaskCount: { type: "integer" },
          totalTasks: { type: "integer" },
          earnedPoints: { type: "integer" },
          progress: { type: "number" },
          nextTaskId: nullable({ type: "string" }),
          nextTaskTitle: nullable({ type: "string" }),
          momentumLabel: { type: "string" },
          time: { $ref: "#/components/schemas/TaskTimeSummary" }
        }
      }
    ]
  };

  const task = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "title",
      "description",
      "status",
      "priority",
      "owner",
      "goalId",
      "projectId",
      "dueDate",
      "effort",
      "energy",
      "points",
      "plannedDurationSeconds",
      "schedulingRules",
      "sortOrder",
      "completedAt",
      "createdAt",
      "updatedAt",
      "tagIds",
      "time"
    ],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      status: {
        type: "string",
        enum: ["backlog", "focus", "in_progress", "blocked", "done"]
      },
      priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
      owner: { type: "string" },
      goalId: nullable({ type: "string" }),
      projectId: nullable({ type: "string" }),
      dueDate: nullable({ type: "string", format: "date" }),
      effort: { type: "string", enum: ["light", "deep", "marathon"] },
      energy: { type: "string", enum: ["low", "steady", "high"] },
      points: { type: "integer" },
      plannedDurationSeconds: nullable({ type: "integer" }),
      schedulingRules: nullable({
        $ref: "#/components/schemas/CalendarSchedulingRules"
      }),
      sortOrder: { type: "integer" },
      completedAt: nullable({ type: "string", format: "date-time" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      tagIds: arrayOf({ type: "string" }),
      time: { $ref: "#/components/schemas/TaskTimeSummary" }
    }
  };

  const taskRun = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "taskId",
      "taskTitle",
      "actor",
      "status",
      "note",
      "leaseTtlSeconds",
      "claimedAt",
      "heartbeatAt",
      "leaseExpiresAt",
      "completedAt",
      "releasedAt",
      "timedOutAt",
      "updatedAt",
      "timerMode",
      "plannedDurationSeconds",
      "elapsedWallSeconds",
      "creditedSeconds",
      "remainingSeconds",
      "overtimeSeconds",
      "isCurrent",
      "overrideReason"
    ],
    properties: {
      id: { type: "string" },
      taskId: { type: "string" },
      taskTitle: { type: "string" },
      actor: { type: "string" },
      status: {
        type: "string",
        enum: ["active", "completed", "released", "timed_out"]
      },
      note: { type: "string" },
      leaseTtlSeconds: { type: "integer" },
      claimedAt: { type: "string", format: "date-time" },
      heartbeatAt: { type: "string", format: "date-time" },
      leaseExpiresAt: { type: "string", format: "date-time" },
      completedAt: nullable({ type: "string", format: "date-time" }),
      releasedAt: nullable({ type: "string", format: "date-time" }),
      timedOutAt: nullable({ type: "string", format: "date-time" }),
      updatedAt: { type: "string", format: "date-time" },
      timerMode: { type: "string", enum: ["planned", "unlimited"] },
      plannedDurationSeconds: nullable({ type: "integer" }),
      elapsedWallSeconds: { type: "integer" },
      creditedSeconds: { type: "number" },
      remainingSeconds: nullable({ type: "integer" }),
      overtimeSeconds: { type: "integer" },
      isCurrent: { type: "boolean" },
      overrideReason: nullable({ type: "string" })
    }
  };

  const calendarSchedulingRules = {
    type: "object",
    additionalProperties: false,
    required: [
      "allowWorkBlockKinds",
      "blockWorkBlockKinds",
      "allowCalendarIds",
      "blockCalendarIds",
      "allowEventTypes",
      "blockEventTypes",
      "allowEventKeywords",
      "blockEventKeywords",
      "allowAvailability",
      "blockAvailability"
    ],
    properties: {
      allowWorkBlockKinds: arrayOf({
        type: "string",
        enum: [
          "main_activity",
          "secondary_activity",
          "third_activity",
          "rest",
          "holiday",
          "custom"
        ]
      }),
      blockWorkBlockKinds: arrayOf({
        type: "string",
        enum: [
          "main_activity",
          "secondary_activity",
          "third_activity",
          "rest",
          "holiday",
          "custom"
        ]
      }),
      allowCalendarIds: arrayOf({ type: "string" }),
      blockCalendarIds: arrayOf({ type: "string" }),
      allowEventTypes: arrayOf({ type: "string" }),
      blockEventTypes: arrayOf({ type: "string" }),
      allowEventKeywords: arrayOf({ type: "string" }),
      blockEventKeywords: arrayOf({ type: "string" }),
      allowAvailability: arrayOf({ type: "string", enum: ["busy", "free"] }),
      blockAvailability: arrayOf({ type: "string", enum: ["busy", "free"] })
    }
  };

  const calendarConnection = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "provider",
      "label",
      "accountLabel",
      "status",
      "config",
      "forgeCalendarId",
      "lastSyncedAt",
      "lastSyncError",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      provider: { type: "string", enum: ["google", "apple", "caldav"] },
      label: { type: "string" },
      accountLabel: { type: "string" },
      status: {
        type: "string",
        enum: ["connected", "needs_attention", "error"]
      },
      config: { type: "object", additionalProperties: true },
      forgeCalendarId: nullable({ type: "string" }),
      lastSyncedAt: nullable({ type: "string", format: "date-time" }),
      lastSyncError: nullable({ type: "string" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const calendarResource = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "connectionId",
      "remoteId",
      "title",
      "description",
      "color",
      "timezone",
      "isPrimary",
      "canWrite",
      "forgeManaged",
      "lastSyncedAt",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      connectionId: { type: "string" },
      remoteId: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      color: { type: "string" },
      timezone: { type: "string" },
      isPrimary: { type: "boolean" },
      canWrite: { type: "boolean" },
      forgeManaged: { type: "boolean" },
      lastSyncedAt: nullable({ type: "string", format: "date-time" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const calendarEventSource = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "provider",
      "connectionId",
      "calendarId",
      "remoteCalendarId",
      "remoteEventId",
      "remoteUid",
      "recurrenceInstanceId",
      "isMasterRecurring",
      "remoteHref",
      "remoteEtag",
      "syncState",
      "lastSyncedAt",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      provider: { type: "string", enum: ["google", "apple", "caldav"] },
      connectionId: nullable({ type: "string" }),
      calendarId: nullable({ type: "string" }),
      remoteCalendarId: nullable({ type: "string" }),
      remoteEventId: { type: "string" },
      remoteUid: nullable({ type: "string" }),
      recurrenceInstanceId: nullable({ type: "string" }),
      isMasterRecurring: { type: "boolean" },
      remoteHref: nullable({ type: "string" }),
      remoteEtag: nullable({ type: "string" }),
      syncState: {
        type: "string",
        enum: [
          "pending_create",
          "pending_update",
          "pending_delete",
          "synced",
          "error",
          "deleted"
        ]
      },
      lastSyncedAt: nullable({ type: "string", format: "date-time" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const calendarEventLink = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "entityType",
      "entityId",
      "relationshipType",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      entityType: { $ref: "#/components/schemas/CrudEntityType" },
      entityId: { type: "string" },
      relationshipType: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const calendarEvent = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "connectionId",
      "calendarId",
      "remoteId",
      "ownership",
      "originType",
      "status",
      "title",
      "description",
      "location",
      "startAt",
      "endAt",
      "timezone",
      "isAllDay",
      "availability",
      "eventType",
      "categories",
      "sourceMappings",
      "links",
      "remoteUpdatedAt",
      "deletedAt",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      connectionId: nullable({ type: "string" }),
      calendarId: nullable({ type: "string" }),
      remoteId: nullable({ type: "string" }),
      ownership: { type: "string", enum: ["external", "forge"] },
      originType: {
        type: "string",
        enum: ["native", "google", "apple", "caldav", "derived"]
      },
      status: { type: "string", enum: ["confirmed", "tentative", "cancelled"] },
      title: { type: "string" },
      description: { type: "string" },
      location: { type: "string" },
      startAt: { type: "string", format: "date-time" },
      endAt: { type: "string", format: "date-time" },
      timezone: { type: "string" },
      isAllDay: { type: "boolean" },
      availability: { type: "string", enum: ["busy", "free"] },
      eventType: { type: "string" },
      categories: arrayOf({ type: "string" }),
      sourceMappings: arrayOf({
        $ref: "#/components/schemas/CalendarEventSource"
      }),
      links: arrayOf({ $ref: "#/components/schemas/CalendarEventLink" }),
      remoteUpdatedAt: nullable({ type: "string", format: "date-time" }),
      deletedAt: nullable({ type: "string", format: "date-time" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const workBlockTemplate = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "title",
      "kind",
      "color",
      "timezone",
      "weekDays",
      "startMinute",
      "endMinute",
      "startsOn",
      "endsOn",
      "blockingState",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      kind: {
        type: "string",
        enum: [
          "main_activity",
          "secondary_activity",
          "third_activity",
          "rest",
          "holiday",
          "custom"
        ]
      },
      color: { type: "string" },
      timezone: { type: "string" },
      weekDays: arrayOf({ type: "integer", minimum: 0, maximum: 6 }),
      startMinute: { type: "integer" },
      endMinute: { type: "integer" },
      startsOn: nullable({ type: "string", format: "date" }),
      endsOn: nullable({ type: "string", format: "date" }),
      blockingState: { type: "string", enum: ["allowed", "blocked"] },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const workBlockInstance = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "templateId",
      "dateKey",
      "startAt",
      "endAt",
      "title",
      "kind",
      "color",
      "blockingState",
      "calendarEventId",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      templateId: { type: "string" },
      dateKey: { type: "string", format: "date" },
      startAt: { type: "string", format: "date-time" },
      endAt: { type: "string", format: "date-time" },
      title: { type: "string" },
      kind: {
        type: "string",
        enum: [
          "main_activity",
          "secondary_activity",
          "third_activity",
          "rest",
          "holiday",
          "custom"
        ]
      },
      color: { type: "string" },
      blockingState: { type: "string", enum: ["allowed", "blocked"] },
      calendarEventId: nullable({ type: "string" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const taskTimebox = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "taskId",
      "projectId",
      "connectionId",
      "calendarId",
      "remoteEventId",
      "linkedTaskRunId",
      "status",
      "source",
      "title",
      "startsAt",
      "endsAt",
      "overrideReason",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      taskId: { type: "string" },
      projectId: nullable({ type: "string" }),
      connectionId: nullable({ type: "string" }),
      calendarId: nullable({ type: "string" }),
      remoteEventId: nullable({ type: "string" }),
      linkedTaskRunId: nullable({ type: "string" }),
      status: {
        type: "string",
        enum: ["planned", "active", "completed", "cancelled"]
      },
      source: { type: "string", enum: ["manual", "suggested", "live_run"] },
      title: { type: "string" },
      startsAt: { type: "string", format: "date-time" },
      endsAt: { type: "string", format: "date-time" },
      overrideReason: nullable({ type: "string" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const calendarOverviewPayload = {
    type: "object",
    additionalProperties: false,
    required: [
      "generatedAt",
      "providers",
      "connections",
      "calendars",
      "events",
      "workBlockTemplates",
      "workBlockInstances",
      "timeboxes"
    ],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      providers: arrayOf({
        type: "object",
        additionalProperties: false,
        required: [
          "provider",
          "label",
          "supportsDedicatedForgeCalendar",
          "connectionHelp"
        ],
        properties: {
          provider: { type: "string", enum: ["google", "apple", "caldav"] },
          label: { type: "string" },
          supportsDedicatedForgeCalendar: { type: "boolean" },
          connectionHelp: { type: "string" }
        }
      }),
      connections: arrayOf({ $ref: "#/components/schemas/CalendarConnection" }),
      calendars: arrayOf({ $ref: "#/components/schemas/CalendarResource" }),
      events: arrayOf({ $ref: "#/components/schemas/CalendarEvent" }),
      workBlockTemplates: arrayOf({
        $ref: "#/components/schemas/WorkBlockTemplate"
      }),
      workBlockInstances: arrayOf({
        $ref: "#/components/schemas/WorkBlockInstance"
      }),
      timeboxes: arrayOf({ $ref: "#/components/schemas/TaskTimebox" })
    }
  };

  const habitCheckIn = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "habitId",
      "dateKey",
      "status",
      "note",
      "deltaXp",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      habitId: { type: "string" },
      dateKey: { type: "string", format: "date" },
      status: { type: "string", enum: ["done", "missed"] },
      note: { type: "string" },
      deltaXp: { type: "integer" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const habit = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "title",
      "description",
      "status",
      "polarity",
      "frequency",
      "targetCount",
      "weekDays",
      "linkedGoalIds",
      "linkedProjectIds",
      "linkedTaskIds",
      "linkedValueIds",
      "linkedPatternIds",
      "linkedBehaviorIds",
      "linkedBeliefIds",
      "linkedModeIds",
      "linkedReportIds",
      "linkedBehaviorId",
      "linkedBehaviorTitle",
      "linkedBehaviorTitles",
      "rewardXp",
      "penaltyXp",
      "createdAt",
      "updatedAt",
      "lastCheckInAt",
      "lastCheckInStatus",
      "streakCount",
      "completionRate",
      "dueToday",
      "checkIns"
    ],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      status: { type: "string", enum: ["active", "paused", "archived"] },
      polarity: { type: "string", enum: ["positive", "negative"] },
      frequency: { type: "string", enum: ["daily", "weekly"] },
      targetCount: { type: "integer" },
      weekDays: arrayOf({ type: "integer" }),
      linkedGoalIds: arrayOf({ type: "string" }),
      linkedProjectIds: arrayOf({ type: "string" }),
      linkedTaskIds: arrayOf({ type: "string" }),
      linkedValueIds: arrayOf({ type: "string" }),
      linkedPatternIds: arrayOf({ type: "string" }),
      linkedBehaviorIds: arrayOf({ type: "string" }),
      linkedBeliefIds: arrayOf({ type: "string" }),
      linkedModeIds: arrayOf({ type: "string" }),
      linkedReportIds: arrayOf({ type: "string" }),
      linkedBehaviorId: nullable({ type: "string" }),
      linkedBehaviorTitle: nullable({ type: "string" }),
      linkedBehaviorTitles: arrayOf({ type: "string" }),
      rewardXp: { type: "integer" },
      penaltyXp: { type: "integer" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      lastCheckInAt: nullable({ type: "string", format: "date-time" }),
      lastCheckInStatus: nullable({ type: "string", enum: ["done", "missed"] }),
      streakCount: { type: "integer" },
      completionRate: { type: "number" },
      dueToday: { type: "boolean" },
      checkIns: arrayOf({ $ref: "#/components/schemas/HabitCheckIn" })
    }
  };

  const activityEvent = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "entityType",
      "entityId",
      "eventType",
      "title",
      "description",
      "actor",
      "source",
      "metadata",
      "createdAt"
    ],
    properties: {
      id: { type: "string" },
      entityType: {
        type: "string",
        enum: [
          "task",
          "habit",
          "goal",
          "project",
          "domain",
          "psyche_value",
          "behavior_pattern",
          "behavior",
          "belief_entry",
          "mode_profile",
          "mode_guide_session",
          "trigger_report",
          "note",
          "tag",
          "task_run",
          "system",
          "insight",
          "approval_request",
          "agent_action",
          "reward",
          "session",
          "event_type",
          "emotion_definition"
        ]
      },
      entityId: { type: "string" },
      eventType: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      actor: nullable({ type: "string" }),
      source: { type: "string", enum: ["ui", "openclaw", "agent", "system"] },
      metadata: {
        type: "object",
        additionalProperties: {
          anyOf: [
            { type: "string" },
            { type: "number" },
            { type: "boolean" },
            { type: "null" }
          ]
        }
      },
      createdAt: { type: "string", format: "date-time" }
    }
  };

  const gamificationProfile = {
    type: "object",
    additionalProperties: false,
    required: [
      "totalXp",
      "level",
      "currentLevelXp",
      "nextLevelXp",
      "weeklyXp",
      "streakDays",
      "comboMultiplier",
      "momentumScore",
      "topGoalId",
      "topGoalTitle"
    ],
    properties: {
      totalXp: { type: "integer" },
      level: { type: "integer" },
      currentLevelXp: { type: "integer" },
      nextLevelXp: { type: "integer" },
      weeklyXp: { type: "integer" },
      streakDays: { type: "integer" },
      comboMultiplier: { type: "number" },
      momentumScore: { type: "integer" },
      topGoalId: nullable({ type: "string" }),
      topGoalTitle: nullable({ type: "string" })
    }
  };

  const noteLink = {
    type: "object",
    additionalProperties: false,
    required: ["entityType", "entityId", "anchorKey"],
    properties: {
      entityType: { type: "string" },
      entityId: { type: "string" },
      anchorKey: nullable({ type: "string" })
    }
  };

  const note = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "contentMarkdown",
      "contentPlain",
      "author",
      "source",
      "createdAt",
      "updatedAt",
      "links",
      "tags",
      "destroyAt"
    ],
    properties: {
      id: { type: "string" },
      contentMarkdown: { type: "string" },
      contentPlain: { type: "string" },
      author: nullable({ type: "string" }),
      source: { type: "string", enum: ["ui", "openclaw", "agent", "system"] },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      links: arrayOf({ $ref: "#/components/schemas/NoteLink" }),
      tags: arrayOf({ type: "string" }),
      destroyAt: nullable({ type: "string", format: "date-time" })
    }
  };

  const noteSummary = {
    type: "object",
    additionalProperties: false,
    required: ["count", "latestNoteId", "latestCreatedAt"],
    properties: {
      count: { type: "integer" },
      latestNoteId: nullable({ type: "string" }),
      latestCreatedAt: nullable({ type: "string", format: "date-time" })
    }
  };

  const notesSummaryByEntity = {
    type: "object",
    additionalProperties: { $ref: "#/components/schemas/NoteSummary" }
  };

  const achievementSignal = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "title",
      "summary",
      "tier",
      "progressLabel",
      "unlocked",
      "unlockedAt"
    ],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      summary: { type: "string" },
      tier: { type: "string", enum: ["bronze", "silver", "gold", "platinum"] },
      progressLabel: { type: "string" },
      unlocked: { type: "boolean" },
      unlockedAt: nullable({ type: "string", format: "date-time" })
    }
  };

  const milestoneReward = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "title",
      "summary",
      "rewardLabel",
      "progressLabel",
      "current",
      "target",
      "completed"
    ],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      summary: { type: "string" },
      rewardLabel: { type: "string" },
      progressLabel: { type: "string" },
      current: { type: "integer" },
      target: { type: "integer" },
      completed: { type: "boolean" }
    }
  };

  const dashboardPayload = {
    type: "object",
    additionalProperties: false,
    required: [
      "stats",
      "goals",
      "projects",
      "tasks",
      "habits",
      "tags",
      "suggestedTags",
      "owners",
      "executionBuckets",
      "gamification",
      "achievements",
      "milestoneRewards",
      "recentActivity",
      "notesSummaryByEntity"
    ],
    properties: {
      stats: {
        type: "object",
        additionalProperties: false,
        required: [
          "totalPoints",
          "completedThisWeek",
          "activeGoals",
          "alignmentScore",
          "focusTasks",
          "overdueTasks",
          "dueThisWeek"
        ],
        properties: {
          totalPoints: { type: "integer" },
          completedThisWeek: { type: "integer" },
          activeGoals: { type: "integer" },
          alignmentScore: { type: "integer" },
          focusTasks: { type: "integer" },
          overdueTasks: { type: "integer" },
          dueThisWeek: { type: "integer" }
        }
      },
      goals: arrayOf({ $ref: "#/components/schemas/DashboardGoal" }),
      projects: arrayOf({ $ref: "#/components/schemas/ProjectSummary" }),
      tasks: arrayOf({ $ref: "#/components/schemas/Task" }),
      habits: arrayOf({ $ref: "#/components/schemas/Habit" }),
      tags: arrayOf({ $ref: "#/components/schemas/Tag" }),
      suggestedTags: arrayOf({ $ref: "#/components/schemas/Tag" }),
      owners: arrayOf({ type: "string" }),
      executionBuckets: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "summary", "tone", "tasks"],
        properties: {
          id: {
            type: "string",
            enum: ["overdue", "due_soon", "focus_now", "recently_completed"]
          },
          label: { type: "string" },
          summary: { type: "string" },
          tone: {
            type: "string",
            enum: ["urgent", "accent", "neutral", "success"]
          },
          tasks: arrayOf({ $ref: "#/components/schemas/Task" })
        }
      }),
      gamification: { $ref: "#/components/schemas/GamificationProfile" },
      achievements: arrayOf({ $ref: "#/components/schemas/AchievementSignal" }),
      milestoneRewards: arrayOf({
        $ref: "#/components/schemas/MilestoneReward"
      }),
      recentActivity: arrayOf({ $ref: "#/components/schemas/ActivityEvent" }),
      notesSummaryByEntity: {
        $ref: "#/components/schemas/NotesSummaryByEntity"
      }
    }
  };

  const overviewContext = {
    type: "object",
    additionalProperties: false,
    required: [
      "generatedAt",
      "strategicHeader",
      "projects",
      "activeGoals",
      "topTasks",
      "dueHabits",
      "recentEvidence",
      "achievements",
      "domainBalance",
      "neglectedGoals"
    ],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      strategicHeader: {
        type: "object",
        additionalProperties: false,
        required: [
          "streakDays",
          "level",
          "totalXp",
          "currentLevelXp",
          "nextLevelXp",
          "momentumScore",
          "focusTasks",
          "overdueTasks"
        ],
        properties: {
          streakDays: { type: "integer" },
          level: { type: "integer" },
          totalXp: { type: "integer" },
          currentLevelXp: { type: "integer" },
          nextLevelXp: { type: "integer" },
          momentumScore: { type: "integer" },
          focusTasks: { type: "integer" },
          overdueTasks: { type: "integer" }
        }
      },
      projects: arrayOf({ $ref: "#/components/schemas/ProjectSummary" }),
      activeGoals: arrayOf({ $ref: "#/components/schemas/DashboardGoal" }),
      topTasks: arrayOf({ $ref: "#/components/schemas/Task" }),
      dueHabits: arrayOf({ $ref: "#/components/schemas/Habit" }),
      recentEvidence: arrayOf({ $ref: "#/components/schemas/ActivityEvent" }),
      achievements: arrayOf({ $ref: "#/components/schemas/AchievementSignal" }),
      domainBalance: arrayOf({
        type: "object",
        additionalProperties: false,
        required: [
          "tagId",
          "label",
          "color",
          "goalCount",
          "activeTaskCount",
          "completedPoints",
          "momentumLabel"
        ],
        properties: {
          tagId: { type: "string" },
          label: { type: "string" },
          color: { type: "string" },
          goalCount: { type: "integer" },
          activeTaskCount: { type: "integer" },
          completedPoints: { type: "integer" },
          momentumLabel: { type: "string" }
        }
      }),
      neglectedGoals: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["goalId", "title", "summary", "risk"],
        properties: {
          goalId: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          risk: { type: "string", enum: ["low", "medium", "high"] }
        }
      })
    }
  };

  const todayContext = {
    type: "object",
    additionalProperties: false,
    required: [
      "generatedAt",
      "directive",
      "timeline",
      "dueHabits",
      "dailyQuests",
      "milestoneRewards",
      "recentHabitRewards",
      "momentum"
    ],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      directive: {
        type: "object",
        additionalProperties: false,
        required: ["task", "goalTitle", "rewardXp", "sessionLabel"],
        properties: {
          task: nullable({ $ref: "#/components/schemas/Task" }),
          goalTitle: nullable({ type: "string" }),
          rewardXp: { type: "integer" },
          sessionLabel: { type: "string" }
        }
      },
      timeline: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "tasks"],
        properties: {
          id: {
            type: "string",
            enum: ["completed", "active", "upcoming", "deferred"]
          },
          label: { type: "string" },
          tasks: arrayOf({ $ref: "#/components/schemas/Task" })
        }
      }),
      dueHabits: arrayOf({ $ref: "#/components/schemas/Habit" }),
      dailyQuests: arrayOf({
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "title",
          "summary",
          "rewardXp",
          "progressLabel",
          "completed"
        ],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          rewardXp: { type: "integer" },
          progressLabel: { type: "string" },
          completed: { type: "boolean" }
        }
      }),
      milestoneRewards: arrayOf({
        $ref: "#/components/schemas/MilestoneReward"
      }),
      recentHabitRewards: arrayOf({
        $ref: "#/components/schemas/RewardLedgerEvent"
      }),
      momentum: {
        type: "object",
        additionalProperties: false,
        required: ["streakDays", "momentumScore", "recoveryHint"],
        properties: {
          streakDays: { type: "integer" },
          momentumScore: { type: "integer" },
          recoveryHint: { type: "string" }
        }
      }
    }
  };

  const riskContext = {
    type: "object",
    additionalProperties: false,
    required: [
      "generatedAt",
      "overdueTasks",
      "blockedTasks",
      "neglectedGoals",
      "summary"
    ],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      overdueTasks: arrayOf({ $ref: "#/components/schemas/Task" }),
      blockedTasks: arrayOf({ $ref: "#/components/schemas/Task" }),
      neglectedGoals: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["goalId", "title", "summary", "risk"],
        properties: {
          goalId: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          risk: { type: "string", enum: ["low", "medium", "high"] }
        }
      }),
      summary: { type: "string" }
    }
  };

  const forgeSnapshot = {
    type: "object",
    additionalProperties: false,
    required: [
      "meta",
      "metrics",
      "dashboard",
      "overview",
      "today",
      "risk",
      "goals",
      "projects",
      "tags",
      "tasks",
      "habits",
      "activeTaskRuns",
      "activity"
    ],
    properties: {
      meta: {
        type: "object",
        additionalProperties: false,
        required: ["apiVersion", "transport", "generatedAt", "backend", "mode"],
        properties: {
          apiVersion: { type: "string", const: "v1" },
          transport: { type: "string" },
          generatedAt: { type: "string", format: "date-time" },
          backend: { type: "string" },
          mode: { type: "string" }
        }
      },
      metrics: { $ref: "#/components/schemas/GamificationProfile" },
      dashboard: { $ref: "#/components/schemas/DashboardPayload" },
      overview: { $ref: "#/components/schemas/OverviewContext" },
      today: { $ref: "#/components/schemas/TodayContext" },
      risk: { $ref: "#/components/schemas/RiskContext" },
      goals: arrayOf({ $ref: "#/components/schemas/Goal" }),
      projects: arrayOf({ $ref: "#/components/schemas/ProjectSummary" }),
      tags: arrayOf({ $ref: "#/components/schemas/Tag" }),
      tasks: arrayOf({ $ref: "#/components/schemas/Task" }),
      habits: arrayOf({ $ref: "#/components/schemas/Habit" }),
      activeTaskRuns: arrayOf({ $ref: "#/components/schemas/TaskRun" }),
      activity: arrayOf({ $ref: "#/components/schemas/ActivityEvent" })
    }
  };

  const taskContextPayload = {
    type: "object",
    additionalProperties: false,
    required: [
      "task",
      "goal",
      "project",
      "activeTaskRun",
      "taskRuns",
      "activity",
      "notesSummaryByEntity"
    ],
    properties: {
      task: { $ref: "#/components/schemas/Task" },
      goal: nullable({ $ref: "#/components/schemas/Goal" }),
      project: nullable({ $ref: "#/components/schemas/ProjectSummary" }),
      activeTaskRun: nullable({ $ref: "#/components/schemas/TaskRun" }),
      taskRuns: arrayOf({ $ref: "#/components/schemas/TaskRun" }),
      activity: arrayOf({ $ref: "#/components/schemas/ActivityEvent" }),
      notesSummaryByEntity: {
        $ref: "#/components/schemas/NotesSummaryByEntity"
      }
    }
  };

  const projectBoardPayload = {
    type: "object",
    additionalProperties: false,
    required: ["project", "goal", "tasks", "activity", "notesSummaryByEntity"],
    properties: {
      project: { $ref: "#/components/schemas/ProjectSummary" },
      goal: { $ref: "#/components/schemas/Goal" },
      tasks: arrayOf({ $ref: "#/components/schemas/Task" }),
      activity: arrayOf({ $ref: "#/components/schemas/ActivityEvent" }),
      notesSummaryByEntity: {
        $ref: "#/components/schemas/NotesSummaryByEntity"
      }
    }
  };

  const insightsPayload = {
    type: "object",
    additionalProperties: false,
    required: [
      "generatedAt",
      "status",
      "momentumHeatmap",
      "executionTrends",
      "domainBalance",
      "coaching",
      "evidenceDigest",
      "feed",
      "openCount"
    ],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      status: {
        type: "object",
        additionalProperties: false,
        required: ["systemStatus", "streakDays", "momentumScore"],
        properties: {
          systemStatus: { type: "string" },
          streakDays: { type: "integer" },
          momentumScore: { type: "integer" }
        }
      },
      momentumHeatmap: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "completed", "focus", "intensity"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          completed: { type: "integer" },
          focus: { type: "integer" },
          intensity: { type: "integer" }
        }
      }),
      executionTrends: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["label", "xp", "focusScore"],
        properties: {
          label: { type: "string" },
          xp: { type: "integer" },
          focusScore: { type: "integer" }
        }
      }),
      domainBalance: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["label", "value", "color", "note"],
        properties: {
          label: { type: "string" },
          value: { type: "integer" },
          color: { type: "string" },
          note: { type: "string" }
        }
      }),
      coaching: {
        type: "object",
        additionalProperties: false,
        required: ["title", "summary", "recommendation", "ctaLabel"],
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          recommendation: { type: "string" },
          ctaLabel: { type: "string" }
        }
      },
      evidenceDigest: arrayOf({ $ref: "#/components/schemas/ActivityEvent" }),
      feed: arrayOf({ $ref: "#/components/schemas/Insight" }),
      openCount: { type: "integer" }
    }
  };

  const weeklyReviewPayload = {
    type: "object",
    additionalProperties: false,
    required: [
      "generatedAt",
      "windowLabel",
      "weekKey",
      "weekStartDate",
      "weekEndDate",
      "momentumSummary",
      "chart",
      "wins",
      "calibration",
      "reward",
      "completion"
    ],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      windowLabel: { type: "string" },
      weekKey: { type: "string" },
      weekStartDate: { type: "string" },
      weekEndDate: { type: "string" },
      momentumSummary: {
        type: "object",
        additionalProperties: false,
        required: ["totalXp", "focusHours", "efficiencyScore", "peakWindow"],
        properties: {
          totalXp: { type: "integer" },
          focusHours: { type: "integer" },
          efficiencyScore: { type: "integer" },
          peakWindow: { type: "string" }
        }
      },
      chart: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["label", "xp", "focusHours"],
        properties: {
          label: { type: "string" },
          xp: { type: "integer" },
          focusHours: { type: "integer" }
        }
      }),
      wins: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "summary", "rewardXp"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          rewardXp: { type: "integer" }
        }
      }),
      calibration: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "mode", "note"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          mode: { type: "string", enum: ["accelerate", "maintain", "recover"] },
          note: { type: "string" }
        }
      }),
      reward: {
        type: "object",
        additionalProperties: false,
        required: ["title", "summary", "rewardXp"],
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          rewardXp: { type: "integer" }
        }
      },
      completion: {
        type: "object",
        additionalProperties: false,
        required: ["finalized", "finalizedAt", "finalizedBy"],
        properties: {
          finalized: { type: "boolean" },
          finalizedAt: nullable({ type: "string", format: "date-time" }),
          finalizedBy: nullable({ type: "string" })
        }
      }
    }
  };

  const agentTokenSummary = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "label",
      "tokenPrefix",
      "scopes",
      "agentId",
      "agentLabel",
      "trustLevel",
      "autonomyMode",
      "approvalMode",
      "description",
      "lastUsedAt",
      "revokedAt",
      "createdAt",
      "updatedAt",
      "status"
    ],
    properties: {
      id: { type: "string" },
      label: { type: "string" },
      tokenPrefix: { type: "string" },
      scopes: arrayOf({ type: "string" }),
      agentId: nullable({ type: "string" }),
      agentLabel: nullable({ type: "string" }),
      trustLevel: {
        type: "string",
        enum: ["standard", "trusted", "autonomous"]
      },
      autonomyMode: {
        type: "string",
        enum: ["approval_required", "scoped_write", "autonomous"]
      },
      approvalMode: {
        type: "string",
        enum: ["approval_by_default", "high_impact_only", "none"]
      },
      description: { type: "string" },
      lastUsedAt: nullable({ type: "string", format: "date-time" }),
      revokedAt: nullable({ type: "string", format: "date-time" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      status: { type: "string", enum: ["active", "revoked"] }
    }
  };

  const executionSettings = {
    type: "object",
    additionalProperties: false,
    required: ["maxActiveTasks", "timeAccountingMode"],
    properties: {
      maxActiveTasks: { type: "integer", minimum: 1, maximum: 8 },
      timeAccountingMode: {
        type: "string",
        enum: ["split", "parallel", "primary_only"]
      }
    }
  };

  const taskRunClaimInput = {
    type: "object",
    additionalProperties: false,
    required: ["actor"],
    properties: {
      actor: { type: "string" },
      timerMode: {
        type: "string",
        enum: ["planned", "unlimited"],
        default: "unlimited"
      },
      plannedDurationSeconds: nullable({
        type: "integer",
        minimum: 60,
        maximum: 86400
      }),
      overrideReason: nullable({ type: "string" }),
      isCurrent: { type: "boolean", default: true },
      leaseTtlSeconds: {
        type: "integer",
        minimum: 1,
        maximum: 14400,
        default: 900
      },
      note: { type: "string", default: "" }
    }
  };

  const taskRunHeartbeatInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      actor: { type: "string" },
      leaseTtlSeconds: {
        type: "integer",
        minimum: 1,
        maximum: 14400,
        default: 900
      },
      note: { type: "string" }
    }
  };

  const taskRunFinishInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      actor: { type: "string" },
      note: { type: "string", default: "" },
      closeoutNote: {
        type: "object",
        additionalProperties: false,
        required: ["contentMarkdown"],
        properties: {
          contentMarkdown: { type: "string" },
          author: nullable({ type: "string" }),
          links: arrayOf({ $ref: "#/components/schemas/NoteLink" })
        }
      }
    }
  };

  const taskRunFocusInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      actor: { type: "string" }
    }
  };

  const workAdjustment = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "entityType",
      "entityId",
      "requestedDeltaMinutes",
      "appliedDeltaMinutes",
      "note",
      "actor",
      "source",
      "createdAt"
    ],
    properties: {
      id: { type: "string" },
      entityType: { type: "string", enum: ["task", "project"] },
      entityId: { type: "string" },
      requestedDeltaMinutes: { type: "integer" },
      appliedDeltaMinutes: { type: "integer" },
      note: { type: "string" },
      actor: nullable({ type: "string" }),
      source: { type: "string", enum: ["ui", "openclaw", "agent", "system"] },
      createdAt: { type: "string", format: "date-time" }
    }
  };

  const workAdjustmentTargetSummary = {
    type: "object",
    additionalProperties: false,
    required: ["entityType", "entityId", "title", "time"],
    properties: {
      entityType: { type: "string", enum: ["task", "project"] },
      entityId: { type: "string" },
      title: { type: "string" },
      time: { $ref: "#/components/schemas/TaskTimeSummary" }
    }
  };

  const workAdjustmentInput = {
    type: "object",
    additionalProperties: false,
    required: ["entityType", "entityId", "deltaMinutes"],
    properties: {
      entityType: { type: "string", enum: ["task", "project"] },
      entityId: { type: "string" },
      deltaMinutes: { type: "integer" },
      note: { type: "string", default: "" }
    }
  };

  const workAdjustmentResult = {
    type: "object",
    additionalProperties: false,
    required: ["adjustment", "target", "reward", "metrics"],
    properties: {
      adjustment: { $ref: "#/components/schemas/WorkAdjustment" },
      target: { $ref: "#/components/schemas/WorkAdjustmentTargetSummary" },
      reward: nullable({ $ref: "#/components/schemas/RewardLedgerEvent" }),
      metrics: { $ref: "#/components/schemas/XpMetricsPayload" }
    }
  };

  const settingsUpdateInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      profile: {
        type: "object",
        additionalProperties: false,
        properties: {
          operatorName: { type: "string" },
          operatorEmail: { type: "string" },
          operatorTitle: { type: "string" }
        }
      },
      notifications: {
        type: "object",
        additionalProperties: false,
        properties: {
          goalDriftAlerts: { type: "boolean" },
          dailyQuestReminders: { type: "boolean" },
          achievementCelebrations: { type: "boolean" }
        }
      },
      execution: {
        type: "object",
        additionalProperties: false,
        properties: {
          maxActiveTasks: { type: "integer", minimum: 1, maximum: 8 },
          timeAccountingMode: {
            type: "string",
            enum: ["split", "parallel", "primary_only"]
          }
        }
      },
      themePreference: {
        type: "string",
        enum: ["obsidian", "solar", "aurora", "ember", "paper", "dawn", "atelier", "custom", "system"]
      },
      customTheme: nullable({
        type: "object",
        additionalProperties: false,
        required: [
          "label",
          "primary",
          "secondary",
          "tertiary",
          "canvas",
          "panel",
          "panelHigh",
          "panelLow",
          "ink"
        ],
        properties: {
          label: { type: "string" },
          primary: { type: "string" },
          secondary: { type: "string" },
          tertiary: { type: "string" },
          canvas: { type: "string" },
          panel: { type: "string" },
          panelHigh: { type: "string" },
          panelLow: { type: "string" },
          ink: { type: "string" }
        }
      }),
      localePreference: { type: "string", enum: ["en", "fr"] }
    }
  };

  const agentIdentity = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "label",
      "agentType",
      "trustLevel",
      "autonomyMode",
      "approvalMode",
      "description",
      "tokenCount",
      "activeTokenCount",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      label: { type: "string" },
      agentType: { type: "string" },
      trustLevel: {
        type: "string",
        enum: ["standard", "trusted", "autonomous"]
      },
      autonomyMode: {
        type: "string",
        enum: ["approval_required", "scoped_write", "autonomous"]
      },
      approvalMode: {
        type: "string",
        enum: ["approval_by_default", "high_impact_only", "none"]
      },
      description: { type: "string" },
      tokenCount: { type: "integer" },
      activeTokenCount: { type: "integer" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const insight = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "originType",
      "originAgentId",
      "originLabel",
      "visibility",
      "status",
      "entityType",
      "entityId",
      "timeframeLabel",
      "title",
      "summary",
      "recommendation",
      "rationale",
      "confidence",
      "ctaLabel",
      "evidence",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      originType: { type: "string", enum: ["system", "user", "agent"] },
      originAgentId: nullable({ type: "string" }),
      originLabel: nullable({ type: "string" }),
      visibility: {
        type: "string",
        enum: ["visible", "pending_review", "archived"]
      },
      status: {
        type: "string",
        enum: ["open", "accepted", "dismissed", "snoozed", "applied", "expired"]
      },
      entityType: nullable({ type: "string" }),
      entityId: nullable({ type: "string" }),
      timeframeLabel: nullable({ type: "string" }),
      title: { type: "string" },
      summary: { type: "string" },
      recommendation: { type: "string" },
      rationale: { type: "string" },
      confidence: { type: "number" },
      ctaLabel: { type: "string" },
      evidence: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["entityType", "entityId", "label"],
        properties: {
          entityType: { type: "string" },
          entityId: { type: "string" },
          label: { type: "string" }
        }
      }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const insightFeedback = {
    type: "object",
    additionalProperties: false,
    required: ["id", "insightId", "actor", "feedbackType", "note", "createdAt"],
    properties: {
      id: { type: "string" },
      insightId: { type: "string" },
      actor: nullable({ type: "string" }),
      feedbackType: {
        type: "string",
        enum: ["accepted", "dismissed", "applied", "snoozed"]
      },
      note: { type: "string" },
      createdAt: { type: "string", format: "date-time" }
    }
  };

  const approvalRequest = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "actionType",
      "status",
      "title",
      "summary",
      "entityType",
      "entityId",
      "requestedByAgentId",
      "requestedByTokenId",
      "requestedPayload",
      "approvedBy",
      "approvedAt",
      "rejectedBy",
      "rejectedAt",
      "resolutionNote",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      actionType: { type: "string" },
      status: {
        type: "string",
        enum: ["pending", "approved", "rejected", "cancelled", "executed"]
      },
      title: { type: "string" },
      summary: { type: "string" },
      entityType: nullable({ type: "string" }),
      entityId: nullable({ type: "string" }),
      requestedByAgentId: nullable({ type: "string" }),
      requestedByTokenId: nullable({ type: "string" }),
      requestedPayload: { type: "object", additionalProperties: true },
      approvedBy: nullable({ type: "string" }),
      approvedAt: nullable({ type: "string", format: "date-time" }),
      rejectedBy: nullable({ type: "string" }),
      rejectedAt: nullable({ type: "string", format: "date-time" }),
      resolutionNote: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const agentAction = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "agentId",
      "tokenId",
      "actionType",
      "riskLevel",
      "status",
      "title",
      "summary",
      "payload",
      "idempotencyKey",
      "approvalRequestId",
      "outcome",
      "createdAt",
      "updatedAt",
      "completedAt"
    ],
    properties: {
      id: { type: "string" },
      agentId: nullable({ type: "string" }),
      tokenId: nullable({ type: "string" }),
      actionType: { type: "string" },
      riskLevel: { type: "string", enum: ["low", "medium", "high"] },
      status: {
        type: "string",
        enum: ["pending_approval", "approved", "rejected", "executed"]
      },
      title: { type: "string" },
      summary: { type: "string" },
      payload: { type: "object", additionalProperties: true },
      idempotencyKey: nullable({ type: "string" }),
      approvalRequestId: nullable({ type: "string" }),
      outcome: { type: "object", additionalProperties: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      completedAt: nullable({ type: "string", format: "date-time" })
    }
  };

  const rewardRule = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "family",
      "code",
      "title",
      "description",
      "active",
      "config",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      family: {
        type: "string",
        enum: [
          "completion",
          "consistency",
          "alignment",
          "recovery",
          "collaboration",
          "ambient"
        ]
      },
      code: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      active: { type: "boolean" },
      config: { type: "object", additionalProperties: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const rewardLedgerEvent = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "ruleId",
      "eventLogId",
      "entityType",
      "entityId",
      "actor",
      "source",
      "deltaXp",
      "reasonTitle",
      "reasonSummary",
      "reversibleGroup",
      "reversedByRewardId",
      "metadata",
      "createdAt"
    ],
    properties: {
      id: { type: "string" },
      ruleId: nullable({ type: "string" }),
      eventLogId: nullable({ type: "string" }),
      entityType: { type: "string" },
      entityId: { type: "string" },
      actor: nullable({ type: "string" }),
      source: { type: "string", enum: ["ui", "openclaw", "agent", "system"] },
      deltaXp: { type: "integer" },
      reasonTitle: { type: "string" },
      reasonSummary: { type: "string" },
      reversibleGroup: nullable({ type: "string" }),
      reversedByRewardId: nullable({ type: "string" }),
      metadata: { type: "object", additionalProperties: true },
      createdAt: { type: "string", format: "date-time" }
    }
  };

  const eventLogEntry = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "eventKind",
      "entityType",
      "entityId",
      "actor",
      "source",
      "causedByEventId",
      "metadata",
      "createdAt"
    ],
    properties: {
      id: { type: "string" },
      eventKind: { type: "string" },
      entityType: { type: "string" },
      entityId: { type: "string" },
      actor: nullable({ type: "string" }),
      source: { type: "string", enum: ["ui", "openclaw", "agent", "system"] },
      causedByEventId: nullable({ type: "string" }),
      metadata: { type: "object", additionalProperties: true },
      createdAt: { type: "string", format: "date-time" }
    }
  };

  const xpMomentumPulse = {
    type: "object",
    additionalProperties: false,
    required: [
      "status",
      "headline",
      "detail",
      "celebrationLabel",
      "nextMilestoneId",
      "nextMilestoneLabel"
    ],
    properties: {
      status: { type: "string", enum: ["surging", "steady", "recovering"] },
      headline: { type: "string" },
      detail: { type: "string" },
      celebrationLabel: { type: "string" },
      nextMilestoneId: nullable({ type: "string" }),
      nextMilestoneLabel: { type: "string" }
    }
  };

  const xpMetricsPayload = {
    type: "object",
    additionalProperties: false,
    required: [
      "profile",
      "achievements",
      "milestoneRewards",
      "momentumPulse",
      "recentLedger",
      "rules",
      "dailyAmbientXp",
      "dailyAmbientCap"
    ],
    properties: {
      profile: { $ref: "#/components/schemas/GamificationProfile" },
      achievements: arrayOf({ $ref: "#/components/schemas/AchievementSignal" }),
      milestoneRewards: arrayOf({
        $ref: "#/components/schemas/MilestoneReward"
      }),
      momentumPulse: { $ref: "#/components/schemas/XpMomentumPulse" },
      recentLedger: arrayOf({ $ref: "#/components/schemas/RewardLedgerEvent" }),
      rules: arrayOf({ $ref: "#/components/schemas/RewardRule" }),
      dailyAmbientXp: { type: "integer" },
      dailyAmbientCap: { type: "integer" }
    }
  };

  const operatorContextPayload = {
    type: "object",
    additionalProperties: false,
    required: [
      "generatedAt",
      "activeProjects",
      "focusTasks",
      "dueHabits",
      "currentBoard",
      "recentActivity",
      "recentTaskRuns",
      "recommendedNextTask",
      "xp"
    ],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      activeProjects: arrayOf({ $ref: "#/components/schemas/ProjectSummary" }),
      focusTasks: arrayOf({ $ref: "#/components/schemas/Task" }),
      dueHabits: arrayOf({ $ref: "#/components/schemas/Habit" }),
      currentBoard: {
        type: "object",
        additionalProperties: false,
        required: ["backlog", "focus", "inProgress", "blocked", "done"],
        properties: {
          backlog: arrayOf({ $ref: "#/components/schemas/Task" }),
          focus: arrayOf({ $ref: "#/components/schemas/Task" }),
          inProgress: arrayOf({ $ref: "#/components/schemas/Task" }),
          blocked: arrayOf({ $ref: "#/components/schemas/Task" }),
          done: arrayOf({ $ref: "#/components/schemas/Task" })
        }
      },
      recentActivity: arrayOf({ $ref: "#/components/schemas/ActivityEvent" }),
      recentTaskRuns: arrayOf({ $ref: "#/components/schemas/TaskRun" }),
      recommendedNextTask: nullable({ $ref: "#/components/schemas/Task" }),
      xp: { $ref: "#/components/schemas/XpMetricsPayload" }
    }
  };

  const operatorOverviewPayload = {
    type: "object",
    additionalProperties: false,
    required: [
      "generatedAt",
      "snapshot",
      "operator",
      "domains",
      "psyche",
      "onboarding",
      "capabilities",
      "warnings",
      "routeGuide"
    ],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      snapshot: { $ref: "#/components/schemas/ForgeSnapshot" },
      operator: { $ref: "#/components/schemas/OperatorContextPayload" },
      domains: arrayOf({ $ref: "#/components/schemas/Domain" }),
      psyche: nullable({ $ref: "#/components/schemas/PsycheOverviewPayload" }),
      onboarding: { $ref: "#/components/schemas/AgentOnboardingPayload" },
      capabilities: {
        type: "object",
        additionalProperties: false,
        required: [
          "tokenPresent",
          "scopes",
          "canReadPsyche",
          "canWritePsyche",
          "canManageModes",
          "canManageRewards"
        ],
        properties: {
          tokenPresent: { type: "boolean" },
          scopes: arrayOf({ type: "string" }),
          canReadPsyche: { type: "boolean" },
          canWritePsyche: { type: "boolean" },
          canManageModes: { type: "boolean" },
          canManageRewards: { type: "boolean" }
        }
      },
      warnings: arrayOf({ type: "string" }),
      routeGuide: {
        type: "object",
        additionalProperties: false,
        required: ["preferredStart", "mainRoutes"],
        properties: {
          preferredStart: { type: "string" },
          mainRoutes: arrayOf({
            type: "object",
            additionalProperties: false,
            required: ["id", "path", "summary", "requiredScope"],
            properties: {
              id: { type: "string" },
              path: { type: "string" },
              summary: { type: "string" },
              requiredScope: nullable({ type: "string" })
            }
          })
        }
      }
    }
  };

  const settingsPayload = {
    type: "object",
    additionalProperties: false,
    required: [
      "profile",
      "notifications",
      "execution",
      "themePreference",
      "customTheme",
      "localePreference",
      "security",
      "agents",
      "agentTokens"
    ],
    properties: {
      profile: {
        type: "object",
        additionalProperties: false,
        required: ["operatorName", "operatorEmail", "operatorTitle"],
        properties: {
          operatorName: { type: "string" },
          operatorEmail: { type: "string" },
          operatorTitle: { type: "string" }
        }
      },
      notifications: {
        type: "object",
        additionalProperties: false,
        required: [
          "goalDriftAlerts",
          "dailyQuestReminders",
          "achievementCelebrations"
        ],
        properties: {
          goalDriftAlerts: { type: "boolean" },
          dailyQuestReminders: { type: "boolean" },
          achievementCelebrations: { type: "boolean" }
        }
      },
      execution: { $ref: "#/components/schemas/ExecutionSettings" },
      themePreference: {
        type: "string",
        enum: ["obsidian", "solar", "aurora", "ember", "paper", "dawn", "atelier", "custom", "system"]
      },
      customTheme: nullable({
        type: "object",
        additionalProperties: false,
        required: [
          "label",
          "primary",
          "secondary",
          "tertiary",
          "canvas",
          "panel",
          "panelHigh",
          "panelLow",
          "ink"
        ],
        properties: {
          label: { type: "string" },
          primary: { type: "string" },
          secondary: { type: "string" },
          tertiary: { type: "string" },
          canvas: { type: "string" },
          panel: { type: "string" },
          panelHigh: { type: "string" },
          panelLow: { type: "string" },
          ink: { type: "string" }
        }
      }),
      localePreference: { type: "string", enum: ["en", "fr"] },
      security: {
        type: "object",
        additionalProperties: false,
        required: [
          "integrityScore",
          "lastAuditAt",
          "storageMode",
          "activeSessions",
          "tokenCount"
        ],
        properties: {
          integrityScore: { type: "integer" },
          lastAuditAt: { type: "string", format: "date-time" },
          storageMode: { type: "string", const: "local-first" },
          activeSessions: { type: "integer" },
          tokenCount: { type: "integer" }
        }
      },
      agents: arrayOf({ $ref: "#/components/schemas/AgentIdentity" }),
      agentTokens: arrayOf({ $ref: "#/components/schemas/AgentTokenSummary" })
    }
  };

  const agentOnboardingPayload = {
    type: "object",
    additionalProperties: false,
    required: [
      "forgeBaseUrl",
      "webAppUrl",
      "apiBaseUrl",
      "openApiUrl",
      "healthUrl",
      "settingsUrl",
      "tokenCreateUrl",
      "pluginBasePath",
      "defaultConnectionMode",
      "defaultActorLabel",
      "defaultTimeoutMs",
      "recommendedScopes",
      "recommendedTrustLevel",
      "recommendedAutonomyMode",
      "recommendedApprovalMode",
      "authModes",
      "tokenRecovery",
      "requiredHeaders",
      "conceptModel",
      "psycheSubmoduleModel",
      "psycheCoachingPlaybooks",
      "conversationRules",
      "entityConversationPlaybooks",
      "relationshipModel",
      "entityRouteModel",
      "multiUserModel",
      "strategyContractModel",
      "entityCatalog",
      "toolInputCatalog",
      "connectionGuides",
      "verificationPaths",
      "recommendedPluginTools",
      "interactionGuidance",
      "mutationGuidance"
    ],
    properties: {
      forgeBaseUrl: { type: "string" },
      webAppUrl: { type: "string" },
      apiBaseUrl: { type: "string" },
      openApiUrl: { type: "string" },
      healthUrl: { type: "string" },
      settingsUrl: { type: "string" },
      tokenCreateUrl: { type: "string" },
      pluginBasePath: { type: "string" },
      defaultConnectionMode: {
        type: "string",
        enum: ["operator_session", "managed_token"]
      },
      defaultActorLabel: { type: "string" },
      defaultTimeoutMs: { type: "integer" },
      recommendedScopes: arrayOf({ type: "string" }),
      recommendedTrustLevel: {
        type: "string",
        enum: ["standard", "trusted", "autonomous"]
      },
      recommendedAutonomyMode: {
        type: "string",
        enum: ["approval_required", "scoped_write", "autonomous"]
      },
      recommendedApprovalMode: {
        type: "string",
        enum: ["approval_by_default", "high_impact_only", "none"]
      },
      authModes: {
        type: "object",
        additionalProperties: false,
        required: ["operatorSession", "managedToken"],
        properties: {
          operatorSession: {
            type: "object",
            additionalProperties: false,
            required: ["label", "summary", "tokenRequired", "trustedTargets"],
            properties: {
              label: { type: "string" },
              summary: { type: "string" },
              tokenRequired: { type: "boolean" },
              trustedTargets: arrayOf({ type: "string" })
            }
          },
          managedToken: {
            type: "object",
            additionalProperties: false,
            required: ["label", "summary", "tokenRequired"],
            properties: {
              label: { type: "string" },
              summary: { type: "string" },
              tokenRequired: { type: "boolean" }
            }
          }
        }
      },
      tokenRecovery: {
        type: "object",
        additionalProperties: false,
        required: [
          "rawTokenStoredByForge",
          "recoveryAction",
          "rotationSummary",
          "settingsSummary"
        ],
        properties: {
          rawTokenStoredByForge: { type: "boolean" },
          recoveryAction: { type: "string" },
          rotationSummary: { type: "string" },
          settingsSummary: { type: "string" }
        }
      },
      requiredHeaders: {
        type: "object",
        additionalProperties: false,
        required: ["authorization", "source", "actor"],
        properties: {
          authorization: { type: "string" },
          source: { type: "string" },
          actor: { type: "string" }
        }
      },
      conceptModel: {
        type: "object",
        additionalProperties: false,
        required: [
          "goal",
          "project",
          "task",
          "taskRun",
          "note",
          "wiki",
          "sleepSession",
          "workoutSession",
          "preferences",
          "questionnaire",
          "selfObservation",
          "insight",
          "calendar",
          "workBlock",
          "taskTimebox",
          "workAdjustment",
          "movement",
          "lifeForce",
          "workbench",
          "psyche"
        ],
        properties: {
          goal: { type: "string" },
          project: { type: "string" },
          task: { type: "string" },
          taskRun: { type: "string" },
          note: { type: "string" },
          wiki: { type: "string" },
          sleepSession: { type: "string" },
          workoutSession: { type: "string" },
          preferences: { type: "string" },
          questionnaire: { type: "string" },
          selfObservation: { type: "string" },
          insight: { type: "string" },
          calendar: { type: "string" },
          workBlock: { type: "string" },
          taskTimebox: { type: "string" },
          workAdjustment: { type: "string" },
          movement: { type: "string" },
          lifeForce: { type: "string" },
          workbench: { type: "string" },
          psyche: { type: "string" }
        }
      },
      psycheSubmoduleModel: {
        type: "object",
        additionalProperties: false,
        required: [
          "value",
          "behaviorPattern",
          "behavior",
          "beliefEntry",
          "schemaCatalog",
          "modeProfile",
          "modeGuideSession",
          "eventType",
          "emotionDefinition",
          "triggerReport"
        ],
        properties: {
          value: { type: "string" },
          behaviorPattern: { type: "string" },
          behavior: { type: "string" },
          beliefEntry: { type: "string" },
          schemaCatalog: { type: "string" },
          modeProfile: { type: "string" },
          modeGuideSession: { type: "string" },
          eventType: { type: "string" },
          emotionDefinition: { type: "string" },
          triggerReport: { type: "string" }
        }
      },
      psycheCoachingPlaybooks: arrayOf({
        type: "object",
        additionalProperties: false,
        required: [
          "focus",
          "useWhen",
          "coachingGoal",
          "askSequence",
          "requiredForCreate",
          "highValueOptionalFields",
          "exampleQuestions",
          "notes"
        ],
        properties: {
          focus: { type: "string" },
          useWhen: { type: "string" },
          coachingGoal: { type: "string" },
          askSequence: arrayOf({ type: "string" }),
          requiredForCreate: arrayOf({ type: "string" }),
          highValueOptionalFields: arrayOf({ type: "string" }),
          exampleQuestions: arrayOf({ type: "string" }),
          notes: arrayOf({ type: "string" })
        }
      }),
      conversationRules: arrayOf({ type: "string" }),
      entityConversationPlaybooks: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["focus", "openingQuestion", "coachingGoal", "askSequence"],
        properties: {
          focus: { type: "string" },
          openingQuestion: { type: "string" },
          coachingGoal: { type: "string" },
          askSequence: arrayOf({ type: "string" })
        }
      }),
      relationshipModel: arrayOf({ type: "string" }),
      entityRouteModel: {
        type: "object",
        additionalProperties: false,
        required: [
          "batchCrudEntities",
          "batchRoutes",
          "specializedCrudEntities",
          "actionEntities",
          "specializedDomainSurfaces",
          "readModelOnlySurfaces"
        ],
        properties: {
          batchCrudEntities: arrayOf({ type: "string" }),
          batchRoutes: {
            type: "object",
            additionalProperties: false,
            required: ["search", "create", "update", "delete", "restore"],
            properties: {
              search: { type: "string" },
              create: { type: "string" },
              update: { type: "string" },
              delete: { type: "string" },
              restore: { type: "string" }
            }
          },
          specializedCrudEntities: {
            type: "object",
            additionalProperties: {
              type: "object",
              additionalProperties: { type: "string" }
            }
          },
          actionEntities: {
            type: "object",
            additionalProperties: {
              type: "object",
              additionalProperties: true
            }
          },
          specializedDomainSurfaces: {
            type: "object",
            additionalProperties: {
              type: "object",
              additionalProperties: true
            }
          },
          readModelOnlySurfaces: {
            type: "object",
            additionalProperties: { type: "string" }
          }
        }
      },
      multiUserModel: {
        type: "object",
        additionalProperties: false,
        required: [
          "summary",
          "defaultUserScopeBehavior",
          "routeScoping",
          "relationshipGraphDefaults"
        ],
        properties: {
          summary: { type: "string" },
          defaultUserScopeBehavior: { type: "string" },
          routeScoping: arrayOf({ type: "string" }),
          relationshipGraphDefaults: arrayOf({ type: "string" })
        }
      },
      strategyContractModel: {
        type: "object",
        additionalProperties: false,
        required: [
          "draftSummary",
          "lockSummary",
          "unlockSummary",
          "alignmentSummary",
          "metricBreakdown"
        ],
        properties: {
          draftSummary: { type: "string" },
          lockSummary: { type: "string" },
          unlockSummary: { type: "string" },
          alignmentSummary: { type: "string" },
          metricBreakdown: arrayOf({ type: "string" })
        }
      },
      entityCatalog: arrayOf({
        type: "object",
        additionalProperties: false,
        required: [
          "entityType",
          "classification",
          "purpose",
          "minimumCreateFields",
          "relationshipRules",
          "searchHints",
          "fieldGuide",
          "preferredMutationPath"
        ],
        properties: {
          entityType: { type: "string" },
          classification: {
            type: "string",
            enum: [
              "batch_crud_entity",
              "specialized_crud_entity",
              "action_workflow_entity",
              "read_model_only_surface"
            ]
          },
          purpose: { type: "string" },
          minimumCreateFields: arrayOf({ type: "string" }),
          relationshipRules: arrayOf({ type: "string" }),
          searchHints: arrayOf({ type: "string" }),
          routeBase: nullable({ type: "string" }),
          preferredMutationPath: { type: "string" },
          preferredReadPath: nullable({ type: "string" }),
          preferredMutationTool: nullable({ type: "string" }),
          examples: arrayOf({ type: "string" }),
          fieldGuide: arrayOf({
            type: "object",
            additionalProperties: false,
            required: ["name", "type", "required", "description"],
            properties: {
              name: { type: "string" },
              type: { type: "string" },
              required: { type: "boolean" },
              description: { type: "string" },
              enumValues: arrayOf({ type: "string" }),
              defaultValue: {
                oneOf: [
                  { type: "string" },
                  { type: "number" },
                  { type: "boolean" },
                  { type: "null" }
                ]
              },
              nullable: { type: "boolean" }
            }
          })
        }
      }),
      toolInputCatalog: arrayOf({
        type: "object",
        additionalProperties: false,
        required: [
          "toolName",
          "summary",
          "whenToUse",
          "inputShape",
          "requiredFields",
          "notes",
          "example"
        ],
        properties: {
          toolName: { type: "string" },
          summary: { type: "string" },
          whenToUse: { type: "string" },
          inputShape: { type: "string" },
          requiredFields: arrayOf({ type: "string" }),
          notes: arrayOf({ type: "string" }),
          example: { type: "string" }
        }
      }),
      verificationPaths: {
        type: "object",
        additionalProperties: false,
        required: [
          "context",
          "xpMetrics",
          "weeklyReview",
          "sleepOverview",
          "sportsOverview",
          "lifeForce",
          "lifeForceProfile",
          "lifeForceWeekdayTemplate",
          "lifeForceFatigueSignals",
          "movementDay",
          "movementMonth",
          "movementTimeline",
          "movementAllTime",
          "movementPlaces",
          "movementTripDetail",
          "movementSelection",
          "movementUserBoxPreflight",
          "workbenchFlows",
          "workbenchFlowBySlug",
          "workbenchPublishedOutput",
          "workbenchRunDetail",
          "workbenchNodeResult",
          "workbenchLatestNodeOutput",
          "wikiSettings",
          "wikiSearch",
          "wikiHealth",
          "calendarOverview",
          "settingsBin",
          "batchSearch",
          "psycheSchemaCatalog",
          "psycheEventTypes",
          "psycheEmotions"
        ],
        properties: {
          context: { type: "string" },
          xpMetrics: { type: "string" },
          weeklyReview: { type: "string" },
          sleepOverview: { type: "string" },
          sportsOverview: { type: "string" },
          lifeForce: { type: "string" },
          lifeForceProfile: { type: "string" },
          lifeForceWeekdayTemplate: { type: "string" },
          lifeForceFatigueSignals: { type: "string" },
          movementDay: { type: "string" },
          movementMonth: { type: "string" },
          movementTimeline: { type: "string" },
          movementAllTime: { type: "string" },
          movementPlaces: { type: "string" },
          movementTripDetail: { type: "string" },
          movementSelection: { type: "string" },
          movementUserBoxPreflight: { type: "string" },
          workbenchFlows: { type: "string" },
          workbenchFlowBySlug: { type: "string" },
          workbenchPublishedOutput: { type: "string" },
          workbenchRunDetail: { type: "string" },
          workbenchNodeResult: { type: "string" },
          workbenchLatestNodeOutput: { type: "string" },
          wikiSettings: { type: "string" },
          wikiSearch: { type: "string" },
          wikiHealth: { type: "string" },
          calendarOverview: { type: "string" },
          settingsBin: { type: "string" },
          batchSearch: { type: "string" },
          psycheSchemaCatalog: { type: "string" },
          psycheEventTypes: { type: "string" },
          psycheEmotions: { type: "string" }
        }
      },
      recommendedPluginTools: {
        type: "object",
        additionalProperties: false,
        required: [
          "bootstrap",
          "readModels",
          "uiWorkflow",
          "entityWorkflow",
          "wikiWorkflow",
          "healthWorkflow",
          "rewardWorkflow",
          "workWorkflow",
          "calendarWorkflow",
          "insightWorkflow"
        ],
        properties: {
          bootstrap: arrayOf({ type: "string" }),
          readModels: arrayOf({ type: "string" }),
          uiWorkflow: arrayOf({ type: "string" }),
          entityWorkflow: arrayOf({ type: "string" }),
          wikiWorkflow: arrayOf({ type: "string" }),
          healthWorkflow: arrayOf({ type: "string" }),
          rewardWorkflow: arrayOf({ type: "string" }),
          workWorkflow: arrayOf({ type: "string" }),
          calendarWorkflow: arrayOf({ type: "string" }),
          insightWorkflow: arrayOf({ type: "string" })
        }
      },
      interactionGuidance: {
        type: "object",
        additionalProperties: false,
        required: [
          "conversationMode",
          "saveSuggestionPlacement",
          "saveSuggestionTone",
          "maxQuestionsPerTurn",
          "psycheExplorationRule",
          "psycheOpeningQuestionRule",
          "duplicateCheckRoute",
          "uiSuggestionRule",
          "browserFallbackRule",
          "writeConsentRule"
        ],
        properties: {
          conversationMode: { type: "string" },
          saveSuggestionPlacement: { type: "string" },
          saveSuggestionTone: { type: "string" },
          maxQuestionsPerTurn: { type: "integer" },
          psycheExplorationRule: { type: "string" },
          psycheOpeningQuestionRule: { type: "string" },
          duplicateCheckRoute: { type: "string" },
          uiSuggestionRule: { type: "string" },
          browserFallbackRule: { type: "string" },
          writeConsentRule: { type: "string" }
        }
      },
      connectionGuides: {
        type: "object",
        additionalProperties: {
          type: "object",
          additionalProperties: false,
          required: ["label", "installSteps", "verifyCommands", "configNotes"],
          properties: {
            label: { type: "string" },
            installSteps: arrayOf({ type: "string" }),
            verifyCommands: arrayOf({ type: "string" }),
            configNotes: arrayOf({ type: "string" })
          }
        }
      },
      mutationGuidance: {
        type: "object",
        additionalProperties: false,
        required: [
          "preferredBatchRoutes",
          "deleteDefault",
          "hardDeleteRequiresExplicitMode",
          "restoreSummary",
          "entityDeleteSummary",
          "batchingRule",
          "searchRule",
          "createRule",
          "updateRule",
          "createExample",
          "updateExample"
        ],
        properties: {
          preferredBatchRoutes: {
            type: "object",
            additionalProperties: false,
            required: ["create", "update", "delete", "restore", "search"],
            properties: {
              create: { type: "string" },
              update: { type: "string" },
              delete: { type: "string" },
              restore: { type: "string" },
              search: { type: "string" }
            }
          },
          deleteDefault: { type: "string", enum: ["soft", "hard"] },
          hardDeleteRequiresExplicitMode: { type: "boolean" },
          restoreSummary: { type: "string" },
          entityDeleteSummary: { type: "string" },
          batchingRule: { type: "string" },
          searchRule: { type: "string" },
          createRule: { type: "string" },
          updateRule: { type: "string" },
          createExample: { type: "string" },
          updateExample: { type: "string" }
        }
      }
    }
  };

  const deletedEntityRecord = {
    type: "object",
    additionalProperties: false,
    required: ["entityType", "entityId", "title", "deletedAt", "snapshot"],
    properties: {
      entityType: { type: "string" },
      entityId: { type: "string" },
      title: { type: "string" },
      subtitle: { type: ["string", "null"] },
      deletedAt: { type: "string", format: "date-time" },
      deletedByActor: { type: ["string", "null"] },
      deletedSource: { type: ["string", "null"] },
      deleteReason: { type: ["string", "null"] },
      snapshot: { type: "object", additionalProperties: true }
    }
  };

  const settingsBinPayload = {
    type: "object",
    additionalProperties: false,
    required: ["generatedAt", "totalCount", "countsByEntityType", "records"],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      totalCount: { type: "integer" },
      countsByEntityType: {
        type: "object",
        additionalProperties: { type: "integer" }
      },
      records: arrayOf({ $ref: "#/components/schemas/DeletedEntityRecord" })
    }
  };

  const batchEntityResult = {
    type: "object",
    additionalProperties: true,
    required: ["ok", "entityType"],
    properties: {
      ok: { type: "boolean" },
      entityType: { type: "string" },
      id: { type: "string" },
      clientRef: { type: "string" },
      entity: { type: "object", additionalProperties: true },
      matches: arrayOf({ type: "object", additionalProperties: true }),
      deletedRecord: { $ref: "#/components/schemas/DeletedEntityRecord" },
      error: {
        type: "object",
        additionalProperties: false,
        properties: {
          code: { type: "string" },
          message: { type: "string" }
        }
      }
    }
  };

  const agentTokenMutationResult = {
    type: "object",
    additionalProperties: false,
    required: ["token", "tokenSummary"],
    properties: {
      token: { type: "string" },
      tokenSummary: { $ref: "#/components/schemas/AgentTokenSummary" }
    }
  };

  const domain = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "slug",
      "title",
      "description",
      "themeColor",
      "sensitive",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      slug: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      themeColor: { type: "string" },
      sensitive: { type: "boolean" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const psycheValue = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "domainId",
      "title",
      "description",
      "valuedDirection",
      "whyItMatters",
      "linkedGoalIds",
      "linkedProjectIds",
      "linkedTaskIds",
      "committedActions",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      domainId: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      valuedDirection: { type: "string" },
      whyItMatters: { type: "string" },
      linkedGoalIds: arrayOf({ type: "string" }),
      linkedProjectIds: arrayOf({ type: "string" }),
      linkedTaskIds: arrayOf({ type: "string" }),
      committedActions: arrayOf({ type: "string" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const behaviorPattern = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "domainId",
      "title",
      "description",
      "targetBehavior",
      "cueContexts",
      "shortTermPayoff",
      "longTermCost",
      "preferredResponse",
      "linkedValueIds",
      "linkedSchemaLabels",
      "linkedModeLabels",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      domainId: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      targetBehavior: { type: "string" },
      cueContexts: arrayOf({ type: "string" }),
      shortTermPayoff: { type: "string" },
      longTermCost: { type: "string" },
      preferredResponse: { type: "string" },
      linkedValueIds: arrayOf({ type: "string" }),
      linkedSchemaLabels: arrayOf({ type: "string" }),
      linkedModeLabels: arrayOf({ type: "string" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const schemaCatalogEntry = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "slug",
      "title",
      "family",
      "schemaType",
      "description",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      slug: { type: "string" },
      title: { type: "string" },
      family: { type: "string" },
      schemaType: { type: "string", enum: ["maladaptive", "adaptive"] },
      description: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const eventType = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "domainId",
      "label",
      "description",
      "system",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      domainId: { type: "string" },
      label: { type: "string" },
      description: { type: "string" },
      system: { type: "boolean" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const emotionDefinition = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "domainId",
      "label",
      "description",
      "category",
      "system",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      domainId: { type: "string" },
      label: { type: "string" },
      description: { type: "string" },
      category: { type: "string" },
      system: { type: "boolean" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const behavior = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "domainId",
      "kind",
      "title",
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
      "linkedModeIds",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      domainId: { type: "string" },
      kind: { type: "string", enum: ["away", "committed", "recovery"] },
      title: { type: "string" },
      description: { type: "string" },
      commonCues: arrayOf({ type: "string" }),
      urgeStory: { type: "string" },
      shortTermPayoff: { type: "string" },
      longTermCost: { type: "string" },
      replacementMove: { type: "string" },
      repairPlan: { type: "string" },
      linkedPatternIds: arrayOf({ type: "string" }),
      linkedValueIds: arrayOf({ type: "string" }),
      linkedSchemaIds: arrayOf({ type: "string" }),
      linkedModeIds: arrayOf({ type: "string" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const beliefEntry = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "domainId",
      "schemaId",
      "statement",
      "beliefType",
      "originNote",
      "confidence",
      "evidenceFor",
      "evidenceAgainst",
      "flexibleAlternative",
      "linkedValueIds",
      "linkedBehaviorIds",
      "linkedModeIds",
      "linkedReportIds",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      domainId: { type: "string" },
      schemaId: nullable({ type: "string" }),
      statement: { type: "string" },
      beliefType: { type: "string", enum: ["absolute", "conditional"] },
      originNote: { type: "string" },
      confidence: { type: "integer" },
      evidenceFor: arrayOf({ type: "string" }),
      evidenceAgainst: arrayOf({ type: "string" }),
      flexibleAlternative: { type: "string" },
      linkedValueIds: arrayOf({ type: "string" }),
      linkedBehaviorIds: arrayOf({ type: "string" }),
      linkedModeIds: arrayOf({ type: "string" }),
      linkedReportIds: arrayOf({ type: "string" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const modeProfile = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "domainId",
      "family",
      "archetype",
      "title",
      "persona",
      "imagery",
      "symbolicForm",
      "facialExpression",
      "fear",
      "burden",
      "protectiveJob",
      "originContext",
      "firstAppearanceAt",
      "linkedPatternIds",
      "linkedBehaviorIds",
      "linkedValueIds",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      domainId: { type: "string" },
      family: {
        type: "string",
        enum: [
          "coping",
          "child",
          "critic_parent",
          "healthy_adult",
          "happy_child"
        ]
      },
      archetype: { type: "string" },
      title: { type: "string" },
      persona: { type: "string" },
      imagery: { type: "string" },
      symbolicForm: { type: "string" },
      facialExpression: { type: "string" },
      fear: { type: "string" },
      burden: { type: "string" },
      protectiveJob: { type: "string" },
      originContext: { type: "string" },
      firstAppearanceAt: nullable({ type: "string", format: "date-time" }),
      linkedPatternIds: arrayOf({ type: "string" }),
      linkedBehaviorIds: arrayOf({ type: "string" }),
      linkedValueIds: arrayOf({ type: "string" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const modeGuideSession = {
    type: "object",
    additionalProperties: false,
    required: ["id", "summary", "answers", "results", "createdAt", "updatedAt"],
    properties: {
      id: { type: "string" },
      summary: { type: "string" },
      answers: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["questionKey", "value"],
        properties: {
          questionKey: { type: "string" },
          value: { type: "string" }
        }
      }),
      results: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["family", "archetype", "label", "confidence", "reasoning"],
        properties: {
          family: {
            type: "string",
            enum: [
              "coping",
              "child",
              "critic_parent",
              "healthy_adult",
              "happy_child"
            ]
          },
          archetype: { type: "string" },
          label: { type: "string" },
          confidence: { type: "number" },
          reasoning: { type: "string" }
        }
      }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const triggerReport = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "domainId",
      "title",
      "status",
      "eventTypeId",
      "customEventType",
      "eventSituation",
      "occurredAt",
      "emotions",
      "thoughts",
      "behaviors",
      "consequences",
      "linkedPatternIds",
      "linkedValueIds",
      "linkedGoalIds",
      "linkedProjectIds",
      "linkedTaskIds",
      "linkedBehaviorIds",
      "linkedBeliefIds",
      "linkedModeIds",
      "modeOverlays",
      "schemaLinks",
      "modeTimeline",
      "nextMoves",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      domainId: { type: "string" },
      title: { type: "string" },
      status: { type: "string", enum: ["draft", "reviewed", "integrated"] },
      eventTypeId: nullable({ type: "string" }),
      customEventType: { type: "string" },
      eventSituation: { type: "string" },
      occurredAt: nullable({ type: "string", format: "date-time" }),
      emotions: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["id", "emotionDefinitionId", "label", "intensity", "note"],
        properties: {
          id: { type: "string" },
          emotionDefinitionId: nullable({ type: "string" }),
          label: { type: "string" },
          intensity: { type: "integer" },
          note: { type: "string" }
        }
      }),
      thoughts: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["id", "text", "parentMode", "criticMode", "beliefId"],
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          parentMode: { type: "string" },
          criticMode: { type: "string" },
          beliefId: nullable({ type: "string" })
        }
      }),
      behaviors: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["id", "text", "mode", "behaviorId"],
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          mode: { type: "string" },
          behaviorId: nullable({ type: "string" })
        }
      }),
      consequences: {
        type: "object",
        additionalProperties: false,
        required: [
          "selfShortTerm",
          "selfLongTerm",
          "othersShortTerm",
          "othersLongTerm"
        ],
        properties: {
          selfShortTerm: arrayOf({ type: "string" }),
          selfLongTerm: arrayOf({ type: "string" }),
          othersShortTerm: arrayOf({ type: "string" }),
          othersLongTerm: arrayOf({ type: "string" })
        }
      },
      linkedPatternIds: arrayOf({ type: "string" }),
      linkedValueIds: arrayOf({ type: "string" }),
      linkedGoalIds: arrayOf({ type: "string" }),
      linkedProjectIds: arrayOf({ type: "string" }),
      linkedTaskIds: arrayOf({ type: "string" }),
      linkedBehaviorIds: arrayOf({ type: "string" }),
      linkedBeliefIds: arrayOf({ type: "string" }),
      linkedModeIds: arrayOf({ type: "string" }),
      modeOverlays: arrayOf({ type: "string" }),
      schemaLinks: arrayOf({ type: "string" }),
      modeTimeline: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["id", "stage", "modeId", "label", "note"],
        properties: {
          id: { type: "string" },
          stage: { type: "string" },
          modeId: nullable({ type: "string" }),
          label: { type: "string" },
          note: { type: "string" }
        }
      }),
      nextMoves: arrayOf({ type: "string" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const psycheOverviewPayload = {
    type: "object",
    additionalProperties: false,
    required: [
      "generatedAt",
      "domain",
      "values",
      "patterns",
      "behaviors",
      "beliefs",
      "modes",
      "schemaPressure",
      "reports",
      "openInsights",
      "openNotes",
      "committedActions"
    ],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      domain: { $ref: "#/components/schemas/Domain" },
      values: arrayOf({ $ref: "#/components/schemas/PsycheValue" }),
      patterns: arrayOf({ $ref: "#/components/schemas/BehaviorPattern" }),
      behaviors: arrayOf({ $ref: "#/components/schemas/Behavior" }),
      beliefs: arrayOf({ $ref: "#/components/schemas/BeliefEntry" }),
      modes: arrayOf({ $ref: "#/components/schemas/ModeProfile" }),
      schemaPressure: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["schemaId", "title", "activationCount"],
        properties: {
          schemaId: { type: "string" },
          title: { type: "string" },
          activationCount: { type: "integer" }
        }
      }),
      reports: arrayOf({ $ref: "#/components/schemas/TriggerReport" }),
      openInsights: { type: "integer" },
      openNotes: { type: "integer" },
      committedActions: arrayOf({ type: "string" })
    }
  };

  const healthLink = {
    type: "object",
    additionalProperties: false,
    required: ["entityType", "entityId", "relationshipType"],
    properties: {
      entityType: { type: "string" },
      entityId: { type: "string" },
      relationshipType: { type: "string" }
    }
  };

  const sleepSession = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "externalUid",
      "pairingSessionId",
      "userId",
      "source",
      "sourceType",
      "sourceDevice",
      "startedAt",
      "endedAt",
      "timeInBedSeconds",
      "asleepSeconds",
      "awakeSeconds",
      "sleepScore",
      "regularityScore",
      "bedtimeConsistencyMinutes",
      "wakeConsistencyMinutes",
      "stageBreakdown",
      "recoveryMetrics",
      "links",
      "annotations",
      "provenance",
      "derived",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      externalUid: { type: "string" },
      pairingSessionId: nullable({ type: "string" }),
      userId: { type: "string" },
      source: { type: "string" },
      sourceType: { type: "string" },
      sourceDevice: { type: "string" },
      startedAt: { type: "string", format: "date-time" },
      endedAt: { type: "string", format: "date-time" },
      timeInBedSeconds: { type: "integer" },
      asleepSeconds: { type: "integer" },
      awakeSeconds: { type: "integer" },
      sleepScore: nullable({ type: "number" }),
      regularityScore: nullable({ type: "number" }),
      bedtimeConsistencyMinutes: nullable({ type: "number" }),
      wakeConsistencyMinutes: nullable({ type: "number" }),
      stageBreakdown: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["stage", "seconds"],
        properties: {
          stage: { type: "string" },
          seconds: { type: "integer" }
        }
      }),
      recoveryMetrics: { type: "object", additionalProperties: true },
      links: arrayOf({ $ref: "#/components/schemas/HealthLink" }),
      annotations: { type: "object", additionalProperties: true },
      provenance: { type: "object", additionalProperties: true },
      derived: { type: "object", additionalProperties: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const workoutSession = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "externalUid",
      "pairingSessionId",
      "userId",
      "source",
      "sourceType",
      "workoutType",
      "sourceDevice",
      "startedAt",
      "endedAt",
      "durationSeconds",
      "activeEnergyKcal",
      "totalEnergyKcal",
      "distanceMeters",
      "stepCount",
      "exerciseMinutes",
      "averageHeartRate",
      "maxHeartRate",
      "subjectiveEffort",
      "moodBefore",
      "moodAfter",
      "meaningText",
      "plannedContext",
      "socialContext",
      "links",
      "tags",
      "annotations",
      "provenance",
      "derived",
      "generatedFromHabitId",
      "generatedFromCheckInId",
      "reconciliationStatus",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      externalUid: { type: "string" },
      pairingSessionId: nullable({ type: "string" }),
      userId: { type: "string" },
      source: { type: "string" },
      sourceType: { type: "string" },
      workoutType: { type: "string" },
      sourceDevice: { type: "string" },
      startedAt: { type: "string", format: "date-time" },
      endedAt: { type: "string", format: "date-time" },
      durationSeconds: { type: "integer" },
      activeEnergyKcal: nullable({ type: "number" }),
      totalEnergyKcal: nullable({ type: "number" }),
      distanceMeters: nullable({ type: "number" }),
      stepCount: nullable({ type: "integer" }),
      exerciseMinutes: nullable({ type: "integer" }),
      averageHeartRate: nullable({ type: "number" }),
      maxHeartRate: nullable({ type: "number" }),
      subjectiveEffort: nullable({ type: "integer" }),
      moodBefore: { type: "string" },
      moodAfter: { type: "string" },
      meaningText: { type: "string" },
      plannedContext: { type: "string" },
      socialContext: { type: "string" },
      links: arrayOf({ $ref: "#/components/schemas/HealthLink" }),
      tags: arrayOf({ type: "string" }),
      annotations: { type: "object", additionalProperties: true },
      provenance: { type: "object", additionalProperties: true },
      derived: { type: "object", additionalProperties: true },
      generatedFromHabitId: nullable({ type: "string" }),
      generatedFromCheckInId: nullable({ type: "string" }),
      reconciliationStatus: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const sleepViewData = {
    type: "object",
    additionalProperties: false,
    required: [
      "summary",
      "weeklyTrend",
      "monthlyPattern",
      "stageAverages",
      "linkBreakdown",
      "sessions"
    ],
    properties: {
      summary: { type: "object", additionalProperties: true },
      weeklyTrend: arrayOf({ type: "object", additionalProperties: true }),
      monthlyPattern: arrayOf({ type: "object", additionalProperties: true }),
      stageAverages: arrayOf({ type: "object", additionalProperties: true }),
      linkBreakdown: arrayOf({ type: "object", additionalProperties: true }),
      sessions: arrayOf({ $ref: "#/components/schemas/SleepSession" })
    }
  };

  const fitnessViewData = {
    type: "object",
    additionalProperties: false,
    required: ["summary", "weeklyTrend", "typeBreakdown", "sessions"],
    properties: {
      summary: { type: "object", additionalProperties: true },
      weeklyTrend: arrayOf({ type: "object", additionalProperties: true }),
      typeBreakdown: arrayOf({ type: "object", additionalProperties: true }),
      sessions: arrayOf({ $ref: "#/components/schemas/WorkoutSession" })
    }
  };

  const document = {
    openapi: "3.1.0",
    info: {
      title: "Forge API",
      version: "v1",
      description:
        "Local-first execution, planning, memory, health, and Psyche API for the Forge runtime."
    },
    servers: [
      {
        url: "http://127.0.0.1:4317",
        description: "Default local Forge runtime"
      },
      {
        url: "/",
        description: "Embedded runtime-relative origin"
      }
    ],
    components: {
      schemas: {
        ValidationIssue: validationIssue,
        ErrorResponse: errorResponse,
        Tag: tag,
        Goal: goal,
        DashboardGoal: dashboardGoal,
        Project: project,
        CalendarSchedulingRules: calendarSchedulingRules,
        CalendarConnection: calendarConnection,
        CalendarResource: calendarResource,
        CalendarEventSource: calendarEventSource,
        CalendarEventLink: calendarEventLink,
        CalendarEvent: calendarEvent,
        WorkBlockTemplate: workBlockTemplate,
        WorkBlockInstance: workBlockInstance,
        TaskTimebox: taskTimebox,
        CalendarOverviewPayload: calendarOverviewPayload,
        TaskTimeSummary: taskTimeSummary,
        ProjectSummary: projectSummary,
        Task: task,
        TaskRun: taskRun,
        HabitCheckIn: habitCheckIn,
        Habit: habit,
        ActivityEvent: activityEvent,
        GamificationProfile: gamificationProfile,
        AchievementSignal: achievementSignal,
        MilestoneReward: milestoneReward,
        XpMomentumPulse: xpMomentumPulse,
        DashboardPayload: dashboardPayload,
        OverviewContext: overviewContext,
        TodayContext: todayContext,
        RiskContext: riskContext,
        ForgeSnapshot: forgeSnapshot,
        TaskContextPayload: taskContextPayload,
        ProjectBoardPayload: projectBoardPayload,
        InsightsPayload: insightsPayload,
        WeeklyReviewPayload: weeklyReviewPayload,
        SettingsPayload: settingsPayload,
        ExecutionSettings: executionSettings,
        TaskRunClaimInput: taskRunClaimInput,
        TaskRunHeartbeatInput: taskRunHeartbeatInput,
        TaskRunFinishInput: taskRunFinishInput,
        TaskRunFocusInput: taskRunFocusInput,
        WorkAdjustment: workAdjustment,
        WorkAdjustmentTargetSummary: workAdjustmentTargetSummary,
        WorkAdjustmentInput: workAdjustmentInput,
        WorkAdjustmentResult: workAdjustmentResult,
        SettingsUpdateInput: settingsUpdateInput,
        AgentOnboardingPayload: agentOnboardingPayload,
        DeletedEntityRecord: deletedEntityRecord,
        SettingsBinPayload: settingsBinPayload,
        BatchEntityResult: batchEntityResult,
        AgentIdentity: agentIdentity,
        AgentTokenSummary: agentTokenSummary,
        AgentTokenMutationResult: agentTokenMutationResult,
        Domain: domain,
        SchemaCatalogEntry: schemaCatalogEntry,
        EventType: eventType,
        EmotionDefinition: emotionDefinition,
        PsycheValue: psycheValue,
        BehaviorPattern: behaviorPattern,
        Behavior: behavior,
        BeliefEntry: beliefEntry,
        ModeProfile: modeProfile,
        ModeGuideSession: modeGuideSession,
        TriggerReport: triggerReport,
        NoteLink: noteLink,
        Note: note,
        NoteSummary: noteSummary,
        NotesSummaryByEntity: notesSummaryByEntity,
        HealthLink: healthLink,
        SleepSession: sleepSession,
        WorkoutSession: workoutSession,
        SleepViewData: sleepViewData,
        FitnessViewData: fitnessViewData,
        PsycheOverviewPayload: psycheOverviewPayload,
        Insight: insight,
        InsightFeedback: insightFeedback,
        ApprovalRequest: approvalRequest,
        AgentAction: agentAction,
        RewardRule: rewardRule,
        RewardLedgerEvent: rewardLedgerEvent,
        EventLogEntry: eventLogEntry,
        XpMetricsPayload: xpMetricsPayload,
        OperatorContextPayload: operatorContextPayload,
        OperatorOverviewPayload: operatorOverviewPayload
      },
      responses: {
        Error: jsonResponse(
          { $ref: "#/components/schemas/ErrorResponse" },
          "Error response"
        )
      }
    },
    paths: {
      "/api/v1/health": {
        get: {
          summary: "Get Forge API health and watchdog status",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["ok", "app", "now", "watchdog"],
                properties: {
                  ok: { type: "boolean" },
                  app: { type: "string", enum: ["forge"] },
                  now: { type: "string", format: "date-time" },
                  watchdog: {
                    type: "object",
                    required: [
                      "enabled",
                      "healthy",
                      "state",
                      "reason",
                      "status"
                    ],
                    properties: {
                      enabled: { type: "boolean" },
                      healthy: { type: "boolean" },
                      state: {
                        type: "string",
                        enum: ["disabled", "idle", "healthy", "degraded"]
                      },
                      reason: { anyOf: [{ type: "string" }, { type: "null" }] },
                      status: {
                        anyOf: [
                          { type: "object", additionalProperties: true },
                          { type: "null" }
                        ]
                      }
                    }
                  }
                }
              },
              "Forge health payload"
            )
          }
        }
      },
      "/api/v1/health/sleep": {
        get: {
          summary: "Read the Forge sleep overview surface",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["sleep"],
                properties: {
                  sleep: { $ref: "#/components/schemas/SleepViewData" }
                }
              },
              "Sleep overview"
            )
          }
        },
        post: {
          summary: "Create one manual sleep session",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["sleep"],
                properties: {
                  sleep: { $ref: "#/components/schemas/SleepSession" }
                }
              },
              "Created sleep session"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/health/fitness": {
        get: {
          summary: "Read the Forge sports and workout overview surface",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["fitness"],
                properties: {
                  fitness: { $ref: "#/components/schemas/FitnessViewData" }
                }
              },
              "Fitness overview"
            )
          }
        }
      },
      "/api/v1/health/workouts": {
        post: {
          summary: "Create one manual workout session",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["workout"],
                properties: {
                  workout: { $ref: "#/components/schemas/WorkoutSession" }
                }
              },
              "Created workout session"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/health/workouts/{id}": {
        get: {
          summary: "Read one workout session",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["workout"],
                properties: {
                  workout: { $ref: "#/components/schemas/WorkoutSession" }
                }
              },
              "Workout session"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update one workout session's reflective metadata",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["workout"],
                properties: {
                  workout: { $ref: "#/components/schemas/WorkoutSession" }
                }
              },
              "Updated workout session"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete one workout session immediately",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["workout"],
                properties: {
                  workout: { $ref: "#/components/schemas/WorkoutSession" }
                }
              },
              "Deleted workout session"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/health/sleep/{id}": {
        get: {
          summary: "Read one sleep session",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["sleep"],
                properties: {
                  sleep: { $ref: "#/components/schemas/SleepSession" }
                }
              },
              "Sleep session"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update one sleep session's reflective metadata",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["sleep"],
                properties: {
                  sleep: { $ref: "#/components/schemas/SleepSession" }
                }
              },
              "Updated sleep session"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete one sleep session immediately",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["sleep"],
                properties: {
                  sleep: { $ref: "#/components/schemas/SleepSession" }
                }
              },
              "Deleted sleep session"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/life-force": {
        get: {
          summary:
            "Read the current life-force overview with stats, drains, curve state, warnings, and recommendations",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["lifeForce", "templates"],
                properties: {
                  lifeForce: {
                    type: "object",
                    additionalProperties: true
                  },
                  templates: arrayOf({
                    type: "object",
                    additionalProperties: true
                  })
                }
              },
              "Life-force overview"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/life-force/profile": {
        patch: {
          summary: "Update the user-controlled life-force profile settings",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["lifeForce", "actor"],
                properties: {
                  lifeForce: {
                    type: "object",
                    additionalProperties: true
                  },
                  actor: { type: "string" }
                }
              },
              "Updated life-force profile"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/life-force/templates/{weekday}": {
        put: {
          summary: "Replace one weekday life-force curve template",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["weekday", "points", "actor"],
                properties: {
                  weekday: { type: "integer" },
                  points: arrayOf({
                    type: "object",
                    additionalProperties: true
                  }),
                  actor: { type: "string" }
                }
              },
              "Updated weekday curve template"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/life-force/fatigue-signals": {
        post: {
          summary: "Record a tired or recovered fatigue signal and rebuild life-force state",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["lifeForce", "actor"],
                properties: {
                  lifeForce: {
                    type: "object",
                    additionalProperties: true
                  },
                  actor: { type: "string" }
                }
              },
              "Updated life-force state after fatigue signal"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/movement/day": {
        get: {
          summary:
            "Read one day of movement detail with distance, stays, trips, gaps, and summaries",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["movement"],
                properties: {
                  movement: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Movement day detail"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/movement/month": {
        get: {
          summary: "Read one month of movement summary",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["movement"],
                properties: {
                  movement: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Movement month summary"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/movement/all-time": {
        get: {
          summary: "Read all-time movement summary including place and trip distribution",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["movement"],
                properties: {
                  movement: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Movement all-time summary"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/movement/timeline": {
        get: {
          summary:
            "Read the paginated movement timeline with stays, trips, missing spans, and projected boxes",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["movement"],
                properties: {
                  movement: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Movement timeline"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/movement/settings": {
        get: {
          summary: "Read movement capture settings",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["settings"],
                properties: {
                  settings: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Movement settings"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update movement capture settings",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["settings"],
                properties: {
                  settings: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Updated movement settings"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/movement/places": {
        get: {
          summary: "List known movement places",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["places"],
                properties: {
                  places: arrayOf({
                    type: "object",
                    additionalProperties: true
                  })
                }
              },
              "Movement places"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create one user-defined movement place",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["place"],
                properties: {
                  place: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Created movement place"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/movement/places/{id}": {
        patch: {
          summary: "Update one known movement place",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["place"],
                properties: {
                  place: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Updated movement place"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/movement/user-boxes": {
        post: {
          summary:
            "Create a user-defined movement overlay box such as a manual stay, trip, or missing-data override",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["box"],
                properties: {
                  box: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Created movement user box"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/movement/user-boxes/preflight": {
        post: {
          summary:
            "Analyze a proposed movement overlay before saving it, especially when replacing a missing gap or overlapping another box",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["preflight"],
                properties: {
                  preflight: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Movement user-box preflight"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/movement/user-boxes/{id}": {
        patch: {
          summary: "Update one user-defined movement overlay box",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["box"],
                properties: {
                  box: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Updated movement user box"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete one user-defined movement box",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: true
              },
              "Deleted movement user box"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/movement/automatic-boxes/{id}/invalidate": {
        post: {
          summary:
            "Hide one automatic movement box and project the resulting user-defined overlay",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["box"],
                properties: {
                  box: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Invalidated automatic movement box"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/movement/stays/{id}": {
        patch: {
          summary: "Update one recorded movement stay",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["stay"],
                properties: {
                  stay: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Updated movement stay"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete one recorded movement stay",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: true
              },
              "Deleted movement stay"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/movement/trips/{id}": {
        get: {
          summary: "Read one movement trip with its full detail",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["movement"],
                properties: {
                  movement: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Movement trip detail"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update one movement trip",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["trip"],
                properties: {
                  trip: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Updated movement trip"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete one movement trip",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: true
              },
              "Deleted movement trip"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/movement/trips/{id}/points/{pointId}": {
        patch: {
          summary: "Update one movement trip datapoint",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: true
              },
              "Updated movement trip point"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete one movement trip datapoint",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: true
              },
              "Deleted movement trip point"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/movement/selection": {
        post: {
          summary: "Aggregate one selected movement range or set of segments",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["movement"],
                properties: {
                  movement: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Movement selection aggregate"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/workbench/catalog/boxes": {
        get: {
          summary: "List registered Workbench boxes and their contracts",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["boxes"],
                properties: {
                  boxes: arrayOf({
                    type: "object",
                    additionalProperties: true
                  })
                }
              },
              "Workbench box catalog"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/workbench/flows": {
        get: {
          summary: "List Workbench flows and recent execution summaries",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["flows"],
                properties: {
                  flows: arrayOf({
                    type: "object",
                    additionalProperties: true
                  })
                }
              },
              "Workbench flow collection"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create one Workbench flow",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["flow"],
                properties: {
                  flow: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Created Workbench flow"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/workbench/flows/{id}": {
        get: {
          summary: "Read one Workbench flow with runs",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["flow", "runs"],
                properties: {
                  flow: {
                    type: "object",
                    additionalProperties: true
                  },
                  runs: arrayOf({
                    type: "object",
                    additionalProperties: true
                  })
                }
              },
              "Workbench flow detail"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update one Workbench flow",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["flow"],
                properties: {
                  flow: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Updated Workbench flow"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete one Workbench flow",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: true
              },
              "Deleted Workbench flow"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/workbench/flows/by-slug/{slug}": {
        get: {
          summary: "Read one Workbench flow by slug",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["flow"],
                properties: {
                  flow: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Workbench flow by slug"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/workbench/flows/{id}/run": {
        post: {
          summary: "Run one Workbench flow by id",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["flow", "run", "conversation"],
                properties: {
                  flow: {
                    type: "object",
                    additionalProperties: true
                  },
                  run: {
                    type: "object",
                    additionalProperties: true
                  },
                  conversation: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Workbench flow execution"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/workbench/run": {
        post: {
          summary: "Run one Workbench flow by payload with flowId",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["flow", "run", "conversation"],
                properties: {
                  flow: {
                    type: "object",
                    additionalProperties: true
                  },
                  run: {
                    type: "object",
                    additionalProperties: true
                  },
                  conversation: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Workbench flow execution"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/workbench/flows/{id}/chat": {
        post: {
          summary: "Continue or start one Workbench chat flow",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: true
              },
              "Workbench chat response"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/workbench/flows/{id}/output": {
        get: {
          summary: "Read the latest published whole-flow output",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: true
              },
              "Workbench published output"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/workbench/flows/{id}/runs": {
        get: {
          summary: "List Workbench runs for one flow",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["flow", "runs"],
                properties: {
                  flow: {
                    type: "object",
                    additionalProperties: true
                  },
                  runs: arrayOf({
                    type: "object",
                    additionalProperties: true
                  })
                }
              },
              "Workbench run list"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/workbench/flows/{id}/runs/{runId}": {
        get: {
          summary: "Read one Workbench run detail",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["flow", "run"],
                properties: {
                  flow: {
                    type: "object",
                    additionalProperties: true
                  },
                  run: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Workbench run detail"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/workbench/flows/{id}/runs/{runId}/nodes": {
        get: {
          summary: "List node results for one Workbench run",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["flow", "run", "nodeResults"],
                properties: {
                  flow: {
                    type: "object",
                    additionalProperties: true
                  },
                  run: {
                    type: "object",
                    additionalProperties: true
                  },
                  nodeResults: arrayOf({
                    type: "object",
                    additionalProperties: true
                  })
                }
              },
              "Workbench node results"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/workbench/flows/{id}/runs/{runId}/nodes/{nodeId}": {
        get: {
          summary: "Read one node result for one Workbench run",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["flow", "nodeResult"],
                properties: {
                  flow: {
                    type: "object",
                    additionalProperties: true
                  },
                  nodeResult: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Workbench node result"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/workbench/flows/{id}/nodes/{nodeId}/output": {
        get: {
          summary: "Read the latest successful output for one Workbench node",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["flow", "run", "nodeResult"],
                properties: {
                  flow: {
                    type: "object",
                    additionalProperties: true
                  },
                  run: {
                    type: "object",
                    additionalProperties: true
                  },
                  nodeResult: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Workbench latest node output"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/wiki/settings": {
        get: {
          summary: "Read wiki spaces plus enabled LLM and embedding profiles",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["settings"],
                properties: {
                  settings: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Wiki settings"
            )
          }
        }
      },
      "/api/v1/wiki/pages": {
        get: {
          summary: "List wiki or evidence pages inside one space",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["pages"],
                properties: {
                  pages: arrayOf({
                    type: "object",
                    additionalProperties: true
                  })
                }
              },
              "Wiki page list"
            )
          }
        },
        post: {
          summary: "Create a wiki page through the file-backed wiki surface",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["page"],
                properties: {
                  page: { type: "object", additionalProperties: true }
                }
              },
              "Created wiki page"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/wiki/pages/{id}": {
        get: {
          summary: "Read one wiki page with backlinks and attached metadata",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["page"],
                properties: {
                  page: { type: "object", additionalProperties: true }
                }
              },
              "Wiki page detail"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary:
            "Update an existing wiki page through the file-backed surface",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["page"],
                properties: {
                  page: { type: "object", additionalProperties: true }
                }
              },
              "Updated wiki page"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/wiki/search": {
        post: {
          summary:
            "Search the wiki with text, semantic, entity, or hybrid retrieval",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["results"],
                properties: {
                  results: arrayOf({
                    type: "object",
                    additionalProperties: true
                  })
                }
              },
              "Wiki search results"
            )
          }
        }
      },
      "/api/v1/wiki/health": {
        get: {
          summary: "Read wiki health signals for one space",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["health"],
                properties: {
                  health: { type: "object", additionalProperties: true }
                }
              },
              "Wiki health"
            )
          }
        }
      },
      "/api/v1/wiki/sync": {
        post: {
          summary:
            "Resync markdown files from the local wiki vault into Forge metadata",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: true
              },
              "Wiki sync result"
            )
          }
        }
      },
      "/api/v1/wiki/reindex": {
        post: {
          summary:
            "Recompute wiki embedding chunks for one space and optional profile",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: true
              },
              "Wiki reindex result"
            )
          }
        }
      },
      "/api/v1/wiki/ingest-jobs": {
        post: {
          summary:
            "Queue a wiki ingest job from raw text, local files, or a URL",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: true
              },
              "Queued wiki ingest job"
            )
          }
        }
      },
      "/api/v1/context": {
        get: {
          summary: "Get the full Forge snapshot for the routed app shell",
          responses: {
            "200": jsonResponse(
              { $ref: "#/components/schemas/ForgeSnapshot" },
              "Forge snapshot"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/operator/context": {
        get: {
          summary:
            "Get the operator-focused Forge context for agents and assistant workflows",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["context"],
                properties: {
                  context: {
                    $ref: "#/components/schemas/OperatorContextPayload"
                  }
                }
              },
              "Operator context"
            )
          }
        }
      },
      "/api/v1/users/directory": {
        get: {
          summary:
            "Read the live human and bot directory with ownership summaries and directional relationship graph",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["directory"],
                properties: {
                  directory: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "User directory"
            )
          }
        }
      },
      "/api/v1/preferences/workspace": {
        get: {
          summary:
            "Get the inferred Preferences workspace for one user, domain, and optional context",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["workspace"],
                properties: {
                  workspace: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Preferences workspace"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/preferences/game/start": {
        post: {
          summary:
            "Start the Preferences game for a domain or concept list and return the refreshed workspace",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["workspace"],
                properties: {
                  workspace: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Refreshed Preferences workspace"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/preferences/catalogs": {
        get: {
          summary: "List Preferences concept lists",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["catalogs"],
                properties: {
                  catalogs: arrayOf({
                    type: "object",
                    additionalProperties: true
                  })
                }
              },
              "Preferences catalogs"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a Preferences concept list",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["catalog"],
                properties: {
                  catalog: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Created Preferences catalog"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/preferences/catalogs/{id}": {
        get: {
          summary: "Get one Preferences concept list",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["catalog"],
                properties: {
                  catalog: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Preferences catalog"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a Preferences concept list",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["catalog"],
                properties: {
                  catalog: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Updated Preferences catalog"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a Preferences concept list",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["catalog"],
                properties: {
                  catalog: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Deleted Preferences catalog"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/preferences/catalog-items": {
        get: {
          summary: "List Preferences concept entries",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["items"],
                properties: {
                  items: arrayOf({
                    type: "object",
                    additionalProperties: true
                  })
                }
              },
              "Preferences catalog items"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a Preferences concept entry",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["item"],
                properties: {
                  item: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Created Preferences catalog item"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/preferences/catalog-items/{id}": {
        get: {
          summary: "Get one Preferences concept entry",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["item"],
                properties: {
                  item: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Preferences catalog item"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a Preferences concept entry",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["item"],
                properties: {
                  item: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Updated Preferences catalog item"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a Preferences concept entry",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["item"],
                properties: {
                  item: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Deleted Preferences catalog item"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/preferences/contexts": {
        get: {
          summary: "List Preferences contexts",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["contexts"],
                properties: {
                  contexts: arrayOf({
                    type: "object",
                    additionalProperties: true
                  })
                }
              },
              "Preferences contexts"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a Preferences context",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["context"],
                properties: {
                  context: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Created Preferences context"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/preferences/contexts/{id}": {
        get: {
          summary: "Get one Preferences context",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["context"],
                properties: {
                  context: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Preferences context"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a Preferences context",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["context"],
                properties: {
                  context: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Updated Preferences context"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a Preferences context",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["context"],
                properties: {
                  context: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Deleted Preferences context"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/preferences/contexts/merge": {
        post: {
          summary: "Merge one Preferences context into another",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["merge"],
                properties: {
                  merge: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Merged Preferences contexts"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/preferences/items": {
        get: {
          summary: "List Preferences items",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["items"],
                properties: {
                  items: arrayOf({
                    type: "object",
                    additionalProperties: true
                  })
                }
              },
              "Preferences items"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a standalone Preferences item",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["item"],
                properties: {
                  item: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Created Preferences item"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/preferences/items/{id}": {
        get: {
          summary: "Get one Preferences item",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["item"],
                properties: {
                  item: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Preferences item"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a Preferences item",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["item"],
                properties: {
                  item: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Updated Preferences item"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a Preferences item",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["item"],
                properties: {
                  item: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Deleted Preferences item"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/preferences/items/from-entity": {
        post: {
          summary:
            "Create or queue a Preferences item from an existing Forge entity",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["item"],
                properties: {
                  item: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Queued entity-backed Preferences item"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/preferences/judgments": {
        post: {
          summary: "Submit a pairwise Preferences judgment",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["judgment"],
                properties: {
                  judgment: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Created pairwise judgment"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/preferences/signals": {
        post: {
          summary: "Submit an absolute Preferences signal",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["signal"],
                properties: {
                  signal: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Created absolute signal"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/preferences/items/{id}/score": {
        patch: {
          summary:
            "Patch manual score state for a Preferences item and return the refreshed workspace",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["workspace"],
                properties: {
                  workspace: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Refreshed Preferences workspace"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/questionnaires": {
        get: {
          summary: "List questionnaire instruments available in the Psyche library",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["instruments"],
                properties: {
                  instruments: arrayOf({
                    type: "object",
                    additionalProperties: true
                  })
                }
              },
              "Questionnaire instrument collection"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a custom questionnaire instrument",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["instrument"],
                properties: {
                  instrument: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Created questionnaire instrument"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/questionnaires/{id}": {
        get: {
          summary: "Get one questionnaire instrument with version and history detail",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["instrument"],
                properties: {
                  instrument: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Questionnaire instrument detail"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update one questionnaire instrument through the direct route",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["instrument"],
                properties: {
                  instrument: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Updated questionnaire instrument"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Archive one questionnaire instrument through the direct route",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["instrument"],
                properties: {
                  instrument: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Archived questionnaire instrument"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/questionnaires/{id}/clone": {
        post: {
          summary: "Clone a questionnaire instrument into a new draftable custom copy",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["instrument"],
                properties: {
                  instrument: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Cloned questionnaire instrument"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/questionnaires/{id}/draft": {
        post: {
          summary: "Ensure a draft questionnaire version exists",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["instrument"],
                properties: {
                  instrument: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Questionnaire instrument with ensured draft"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update the current questionnaire draft version",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["instrument"],
                properties: {
                  instrument: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Questionnaire instrument with updated draft"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/questionnaires/{id}/publish": {
        post: {
          summary: "Publish the current questionnaire draft as a new version",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["instrument"],
                properties: {
                  instrument: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Published questionnaire instrument"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/questionnaires/{id}/runs": {
        post: {
          summary: "Start a questionnaire run for one user and instrument version",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["run", "instrument", "version", "answers", "scores", "history"],
                properties: {
                  run: {
                    type: "object",
                    additionalProperties: true
                  },
                  instrument: {
                    type: "object",
                    additionalProperties: true
                  },
                  version: {
                    type: "object",
                    additionalProperties: true
                  },
                  answers: arrayOf({
                    type: "object",
                    additionalProperties: true
                  }),
                  scores: arrayOf({
                    type: "object",
                    additionalProperties: true
                  }),
                  history: arrayOf({
                    type: "object",
                    additionalProperties: true
                  })
                }
              },
              "Started questionnaire run"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/questionnaire-runs/{id}": {
        get: {
          summary: "Get one questionnaire run with answers, scores, and version detail",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["run", "instrument", "version", "answers", "scores", "history"],
                properties: {
                  run: {
                    type: "object",
                    additionalProperties: true
                  },
                  instrument: {
                    type: "object",
                    additionalProperties: true
                  },
                  version: {
                    type: "object",
                    additionalProperties: true
                  },
                  answers: arrayOf({
                    type: "object",
                    additionalProperties: true
                  }),
                  scores: arrayOf({
                    type: "object",
                    additionalProperties: true
                  }),
                  history: arrayOf({
                    type: "object",
                    additionalProperties: true
                  })
                }
              },
              "Questionnaire run detail"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update an in-progress questionnaire run",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["run", "instrument", "version", "answers", "scores", "history"],
                properties: {
                  run: {
                    type: "object",
                    additionalProperties: true
                  },
                  instrument: {
                    type: "object",
                    additionalProperties: true
                  },
                  version: {
                    type: "object",
                    additionalProperties: true
                  },
                  answers: arrayOf({
                    type: "object",
                    additionalProperties: true
                  }),
                  scores: arrayOf({
                    type: "object",
                    additionalProperties: true
                  }),
                  history: arrayOf({
                    type: "object",
                    additionalProperties: true
                  })
                }
              },
              "Updated questionnaire run"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/questionnaire-runs/{id}/complete": {
        post: {
          summary: "Complete a questionnaire run and persist its final scores",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["run", "instrument", "version", "answers", "scores", "history"],
                properties: {
                  run: {
                    type: "object",
                    additionalProperties: true
                  },
                  instrument: {
                    type: "object",
                    additionalProperties: true
                  },
                  version: {
                    type: "object",
                    additionalProperties: true
                  },
                  answers: arrayOf({
                    type: "object",
                    additionalProperties: true
                  }),
                  scores: arrayOf({
                    type: "object",
                    additionalProperties: true
                  }),
                  history: arrayOf({
                    type: "object",
                    additionalProperties: true
                  })
                }
              },
              "Completed questionnaire run"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/self-observation/calendar": {
        get: {
          summary: "Read self-observation notes arranged as a calendar-ready reflection surface",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["calendar"],
                properties: {
                  calendar: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Self-observation calendar"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/operator/overview": {
        get: {
          summary:
            "Get the one-shot operator overview with full current state, route guidance, and optional Psyche summary",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["overview"],
                properties: {
                  overview: {
                    $ref: "#/components/schemas/OperatorOverviewPayload"
                  }
                }
              },
              "Operator overview"
            )
          }
        }
      },
      "/api/v1/domains": {
        get: {
          summary: "List canonical Forge domains",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["domains"],
                properties: {
                  domains: arrayOf({ $ref: "#/components/schemas/Domain" })
                }
              },
              "Domain collection"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/overview": {
        get: {
          summary: "Get the Psyche hub overview",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["overview"],
                properties: {
                  overview: {
                    $ref: "#/components/schemas/PsycheOverviewPayload"
                  }
                }
              },
              "Psyche overview"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/values": {
        get: {
          summary: "List ACT-style values",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["values"],
                properties: {
                  values: arrayOf({ $ref: "#/components/schemas/PsycheValue" })
                }
              },
              "Psyche value collection"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a Psyche value",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["value"],
                properties: {
                  value: { $ref: "#/components/schemas/PsycheValue" }
                }
              },
              "Created value"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/values/{id}": {
        get: {
          summary: "Get a Psyche value",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["value"],
                properties: {
                  value: { $ref: "#/components/schemas/PsycheValue" }
                }
              },
              "Psyche value"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a Psyche value",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["value"],
                properties: {
                  value: { $ref: "#/components/schemas/PsycheValue" }
                }
              },
              "Updated value"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a Psyche value",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["value"],
                properties: {
                  value: { $ref: "#/components/schemas/PsycheValue" }
                }
              },
              "Deleted value"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/patterns": {
        get: {
          summary: "List behavior patterns",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["patterns"],
                properties: {
                  patterns: arrayOf({
                    $ref: "#/components/schemas/BehaviorPattern"
                  })
                }
              },
              "Behavior pattern collection"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a behavior pattern",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["pattern"],
                properties: {
                  pattern: { $ref: "#/components/schemas/BehaviorPattern" }
                }
              },
              "Created behavior pattern"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/patterns/{id}": {
        get: {
          summary: "Get a behavior pattern",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["pattern"],
                properties: {
                  pattern: { $ref: "#/components/schemas/BehaviorPattern" }
                }
              },
              "Behavior pattern"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a behavior pattern",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["pattern"],
                properties: {
                  pattern: { $ref: "#/components/schemas/BehaviorPattern" }
                }
              },
              "Updated behavior pattern"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a behavior pattern",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["pattern"],
                properties: {
                  pattern: { $ref: "#/components/schemas/BehaviorPattern" }
                }
              },
              "Deleted behavior pattern"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/behaviors": {
        get: {
          summary: "List tracked Psyche behaviors",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["behaviors"],
                properties: {
                  behaviors: arrayOf({ $ref: "#/components/schemas/Behavior" })
                }
              },
              "Behavior collection"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a Psyche behavior",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["behavior"],
                properties: {
                  behavior: { $ref: "#/components/schemas/Behavior" }
                }
              },
              "Created behavior"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/behaviors/{id}": {
        get: {
          summary: "Get a Psyche behavior",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["behavior"],
                properties: {
                  behavior: { $ref: "#/components/schemas/Behavior" }
                }
              },
              "Behavior detail"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a Psyche behavior",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["behavior"],
                properties: {
                  behavior: { $ref: "#/components/schemas/Behavior" }
                }
              },
              "Updated behavior"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a Psyche behavior",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["behavior"],
                properties: {
                  behavior: { $ref: "#/components/schemas/Behavior" }
                }
              },
              "Deleted behavior"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/schema-catalog": {
        get: {
          summary: "List the fixed schema-therapy catalog",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["schemas"],
                properties: {
                  schemas: arrayOf({
                    $ref: "#/components/schemas/SchemaCatalogEntry"
                  })
                }
              },
              "Schema catalog"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/beliefs": {
        get: {
          summary: "List belief entries linked to schemas and reports",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["beliefs"],
                properties: {
                  beliefs: arrayOf({ $ref: "#/components/schemas/BeliefEntry" })
                }
              },
              "Belief collection"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a belief entry",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["belief"],
                properties: {
                  belief: { $ref: "#/components/schemas/BeliefEntry" }
                }
              },
              "Created belief"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/beliefs/{id}": {
        get: {
          summary: "Get a belief entry",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["belief"],
                properties: {
                  belief: { $ref: "#/components/schemas/BeliefEntry" }
                }
              },
              "Belief detail"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a belief entry",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["belief"],
                properties: {
                  belief: { $ref: "#/components/schemas/BeliefEntry" }
                }
              },
              "Updated belief"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a belief entry",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["belief"],
                properties: {
                  belief: { $ref: "#/components/schemas/BeliefEntry" }
                }
              },
              "Deleted belief"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/modes": {
        get: {
          summary: "List Psyche mode profiles",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["modes"],
                properties: {
                  modes: arrayOf({ $ref: "#/components/schemas/ModeProfile" })
                }
              },
              "Mode collection"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a Psyche mode profile",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["mode"],
                properties: {
                  mode: { $ref: "#/components/schemas/ModeProfile" }
                }
              },
              "Created mode"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/modes/{id}": {
        get: {
          summary: "Get a Psyche mode profile",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["mode"],
                properties: {
                  mode: { $ref: "#/components/schemas/ModeProfile" }
                }
              },
              "Mode detail"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a Psyche mode profile",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["mode"],
                properties: {
                  mode: { $ref: "#/components/schemas/ModeProfile" }
                }
              },
              "Updated mode"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a Psyche mode profile",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["mode"],
                properties: {
                  mode: { $ref: "#/components/schemas/ModeProfile" }
                }
              },
              "Deleted mode"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/mode-guides": {
        get: {
          summary: "List guided mode-identification sessions",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["sessions"],
                properties: {
                  sessions: arrayOf({
                    $ref: "#/components/schemas/ModeGuideSession"
                  })
                }
              },
              "Mode guide sessions"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a guided mode-identification session",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["session"],
                properties: {
                  session: { $ref: "#/components/schemas/ModeGuideSession" }
                }
              },
              "Created mode guide session"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/mode-guides/{id}": {
        get: {
          summary: "Get a guided mode-identification session",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["session"],
                properties: {
                  session: { $ref: "#/components/schemas/ModeGuideSession" }
                }
              },
              "Mode guide detail"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a guided mode-identification session",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["session"],
                properties: {
                  session: { $ref: "#/components/schemas/ModeGuideSession" }
                }
              },
              "Updated mode guide session"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a guided mode-identification session",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["session"],
                properties: {
                  session: { $ref: "#/components/schemas/ModeGuideSession" }
                }
              },
              "Deleted mode guide session"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/event-types": {
        get: {
          summary: "List seeded and custom Psyche event types",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["eventTypes"],
                properties: {
                  eventTypes: arrayOf({
                    $ref: "#/components/schemas/EventType"
                  })
                }
              },
              "Event type collection"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a custom Psyche event type",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["eventType"],
                properties: {
                  eventType: { $ref: "#/components/schemas/EventType" }
                }
              },
              "Created event type"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/event-types/{id}": {
        get: {
          summary: "Get a Psyche event type",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["eventType"],
                properties: {
                  eventType: { $ref: "#/components/schemas/EventType" }
                }
              },
              "Event type detail"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a custom Psyche event type",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["eventType"],
                properties: {
                  eventType: { $ref: "#/components/schemas/EventType" }
                }
              },
              "Updated event type"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a custom Psyche event type",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["eventType"],
                properties: {
                  eventType: { $ref: "#/components/schemas/EventType" }
                }
              },
              "Deleted event type"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/emotions": {
        get: {
          summary: "List seeded and custom Psyche emotions",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["emotions"],
                properties: {
                  emotions: arrayOf({
                    $ref: "#/components/schemas/EmotionDefinition"
                  })
                }
              },
              "Emotion collection"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a custom Psyche emotion",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["emotion"],
                properties: {
                  emotion: { $ref: "#/components/schemas/EmotionDefinition" }
                }
              },
              "Created emotion"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/emotions/{id}": {
        get: {
          summary: "Get a Psyche emotion definition",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["emotion"],
                properties: {
                  emotion: { $ref: "#/components/schemas/EmotionDefinition" }
                }
              },
              "Emotion detail"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a custom Psyche emotion definition",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["emotion"],
                properties: {
                  emotion: { $ref: "#/components/schemas/EmotionDefinition" }
                }
              },
              "Updated emotion"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a custom Psyche emotion definition",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["emotion"],
                properties: {
                  emotion: { $ref: "#/components/schemas/EmotionDefinition" }
                }
              },
              "Deleted emotion"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/reports": {
        get: {
          summary: "List trigger reports",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["reports"],
                properties: {
                  reports: arrayOf({
                    $ref: "#/components/schemas/TriggerReport"
                  })
                }
              },
              "Trigger report collection"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a trigger report",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["report"],
                properties: {
                  report: { $ref: "#/components/schemas/TriggerReport" }
                }
              },
              "Created trigger report"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/reports/{id}": {
        get: {
          summary: "Get a trigger report with linked notes and insights",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["report", "notes", "insights"],
                properties: {
                  report: { $ref: "#/components/schemas/TriggerReport" },
                  notes: arrayOf({ $ref: "#/components/schemas/Note" }),
                  insights: arrayOf({ $ref: "#/components/schemas/Insight" })
                }
              },
              "Trigger report detail"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a trigger report",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["report"],
                properties: {
                  report: { $ref: "#/components/schemas/TriggerReport" }
                }
              },
              "Updated trigger report"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a trigger report",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["report"],
                properties: {
                  report: { $ref: "#/components/schemas/TriggerReport" }
                }
              },
              "Deleted trigger report"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/notes": {
        get: {
          summary: "List notes linked to Forge entities",
          parameters: [
            {
              name: "linkedEntityType",
              in: "query",
              schema: { type: "string" }
            },
            { name: "linkedEntityId", in: "query", schema: { type: "string" } },
            {
              name: "anchorKey",
              in: "query",
              schema: { type: "string", nullable: true }
            },
            {
              name: "linkedTo",
              in: "query",
              schema: { type: "array", items: { type: "string" } }
            },
            {
              name: "tags",
              in: "query",
              schema: { type: "array", items: { type: "string" } }
            },
            {
              name: "textTerms",
              in: "query",
              schema: { type: "array", items: { type: "string" } }
            },
            { name: "author", in: "query", schema: { type: "string" } },
            {
              name: "updatedFrom",
              in: "query",
              schema: { type: "string", format: "date" }
            },
            {
              name: "updatedTo",
              in: "query",
              schema: { type: "string", format: "date" }
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 200 }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["notes"],
                properties: {
                  notes: arrayOf({ $ref: "#/components/schemas/Note" })
                }
              },
              "Note collection"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a note linked to one or more Forge entities",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["note"],
                properties: { note: { $ref: "#/components/schemas/Note" } }
              },
              "Created note"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/notes/{id}": {
        get: {
          summary: "Get a note",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["note"],
                properties: { note: { $ref: "#/components/schemas/Note" } }
              },
              "Note"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a note",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["note"],
                properties: { note: { $ref: "#/components/schemas/Note" } }
              },
              "Updated note"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a note",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["note"],
                properties: { note: { $ref: "#/components/schemas/Note" } }
              },
              "Deleted note"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/projects": {
        get: {
          summary: "List projects",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["projects"],
                properties: {
                  projects: arrayOf({
                    $ref: "#/components/schemas/ProjectSummary"
                  })
                }
              },
              "Project collection"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a project",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["project"],
                properties: {
                  project: { $ref: "#/components/schemas/Project" }
                }
              },
              "Created project"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/calendar/overview": {
        get: {
          summary:
            "Read connected calendars, mirrored events, work blocks, and timeboxes",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["calendar"],
                properties: {
                  calendar: {
                    $ref: "#/components/schemas/CalendarOverviewPayload"
                  }
                }
              },
              "Calendar overview"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/calendar/connections": {
        get: {
          summary: "List connected calendar providers",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["providers", "connections"],
                properties: {
                  providers: arrayOf({
                    type: "object",
                    additionalProperties: false,
                    required: [
                      "provider",
                      "label",
                      "supportsDedicatedForgeCalendar",
                      "connectionHelp"
                    ],
                    properties: {
                      provider: {
                        type: "string",
                        enum: ["google", "apple", "caldav"]
                      },
                      label: { type: "string" },
                      supportsDedicatedForgeCalendar: { type: "boolean" },
                      connectionHelp: { type: "string" }
                    }
                  }),
                  connections: arrayOf({
                    $ref: "#/components/schemas/CalendarConnection"
                  })
                }
              },
              "Calendar connections"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary:
            "Create a Google, Apple, or custom CalDAV calendar connection",
          description:
            "Forge first discovers the writable calendars for the account, then stores the chosen mirrored calendars and either reuses the existing shared Forge write target or saves a new one when needed.",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["connection"],
                properties: {
                  connection: {
                    $ref: "#/components/schemas/CalendarConnection"
                  }
                }
              },
              "Created calendar connection"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/calendar/connections/{id}/sync": {
        post: {
          summary: "Sync one connected calendar provider",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["connection"],
                properties: {
                  connection: {
                    $ref: "#/components/schemas/CalendarConnection"
                  }
                }
              },
              "Synced calendar connection"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/calendar/work-block-templates": {
        get: {
          summary: "List recurring work-block templates",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["templates"],
                properties: {
                  templates: arrayOf({
                    $ref: "#/components/schemas/WorkBlockTemplate"
                  })
                }
              },
              "Work-block templates"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a recurring work-block template",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["template"],
                properties: {
                  template: { $ref: "#/components/schemas/WorkBlockTemplate" }
                }
              },
              "Created work-block template"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/calendar/work-block-templates/{id}": {
        get: {
          summary: "Get one recurring work-block template",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["template"],
                properties: {
                  template: { $ref: "#/components/schemas/WorkBlockTemplate" }
                }
              },
              "Work-block template"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/calendar/timeboxes": {
        get: {
          summary: "List task timeboxes",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["timeboxes"],
                properties: {
                  timeboxes: arrayOf({
                    $ref: "#/components/schemas/TaskTimebox"
                  })
                }
              },
              "Task timeboxes"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a planned task timebox",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["timebox"],
                properties: {
                  timebox: { $ref: "#/components/schemas/TaskTimebox" }
                }
              },
              "Created task timebox"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/calendar/timeboxes/{id}": {
        get: {
          summary: "Get one task timebox",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["timebox"],
                properties: {
                  timebox: { $ref: "#/components/schemas/TaskTimebox" }
                }
              },
              "Task timebox"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/calendar/timeboxes/recommend": {
        post: {
          summary: "Suggest future timeboxes for a task",
          description:
            "Recommendations consider provider events, work blocks, scheduling rules, and planned duration.",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["timeboxes"],
                properties: {
                  timeboxes: arrayOf({
                    $ref: "#/components/schemas/TaskTimebox"
                  })
                }
              },
              "Suggested task timeboxes"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/calendar/events": {
        get: {
          summary: "List native and mirrored calendar events for a range",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["events"],
                properties: {
                  events: arrayOf({
                    $ref: "#/components/schemas/CalendarEvent"
                  })
                }
              },
              "Calendar events"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a native Forge calendar event",
          description:
            "Forge stores the event canonically first, then projects it to a connected writable calendar when a preferred calendar is selected.",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["event"],
                properties: {
                  event: { $ref: "#/components/schemas/CalendarEvent" }
                }
              },
              "Created calendar event"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/calendar/events/{id}": {
        get: {
          summary: "Get one Forge calendar event",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["event"],
                properties: {
                  event: { $ref: "#/components/schemas/CalendarEvent" }
                }
              },
              "Calendar event"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a Forge calendar event and sync remote projections",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["event"],
                properties: {
                  event: { $ref: "#/components/schemas/CalendarEvent" }
                }
              },
              "Updated calendar event"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary:
            "Delete a Forge calendar event and remove projected remote copies",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["event"],
                properties: {
                  event: { $ref: "#/components/schemas/CalendarEvent" }
                }
              },
              "Deleted calendar event"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/campaigns": {
        get: {
          deprecated: true,
          summary: "Deprecated alias for project listing",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["projects"],
                properties: {
                  projects: arrayOf({
                    $ref: "#/components/schemas/ProjectSummary"
                  })
                }
              },
              "Project collection"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/projects/{id}": {
        get: {
          summary: "Get a project summary",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["project"],
                properties: {
                  project: { $ref: "#/components/schemas/ProjectSummary" }
                }
              },
              "Project summary"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a project",
          description:
            "Project lifecycle is status-driven. Set status to paused to suspend, completed to finish, or active to restart. Updating a project to completed auto-completes linked unfinished tasks through the normal task completion flow.",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["project"],
                properties: {
                  project: { $ref: "#/components/schemas/Project" }
                }
              },
              "Updated project"
            ),
            "404": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a project",
          description:
            "Project DELETE defaults to soft delete. Pass mode=hard only when permanent removal is intended.",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["project"],
                properties: {
                  project: { $ref: "#/components/schemas/Project" }
                }
              },
              "Deleted project"
            ),
            "404": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/projects/{id}/board": {
        get: {
          summary: "Get the board and evidence for one project",
          responses: {
            "200": jsonResponse(
              { $ref: "#/components/schemas/ProjectBoardPayload" },
              "Project board"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/goals": {
        get: {
          summary: "List life goals",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["goals"],
                properties: {
                  goals: arrayOf({ $ref: "#/components/schemas/Goal" })
                }
              },
              "Goal collection"
            )
          }
        },
        post: {
          summary: "Create a life goal",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["goal"],
                properties: {
                  goal: { $ref: "#/components/schemas/Goal" }
                }
              },
              "Created goal"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/goals/{id}": {
        get: {
          summary: "Get a life goal",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["goal"],
                properties: {
                  goal: { $ref: "#/components/schemas/Goal" }
                }
              },
              "Goal"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a life goal",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["goal"],
                properties: {
                  goal: { $ref: "#/components/schemas/Goal" }
                }
              },
              "Updated goal"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a life goal",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["goal"],
                properties: {
                  goal: { $ref: "#/components/schemas/Goal" }
                }
              },
              "Deleted goal"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/habits": {
        get: {
          summary: "List habits with current streak and due-today state",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["habits"],
                properties: {
                  habits: arrayOf({ $ref: "#/components/schemas/Habit" })
                }
              },
              "Habit collection"
            )
          }
        },
        post: {
          summary: "Create a habit",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["habit"],
                properties: {
                  habit: { $ref: "#/components/schemas/Habit" }
                }
              },
              "Created habit"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/habits/{id}": {
        get: {
          summary: "Get a habit",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["habit"],
                properties: {
                  habit: { $ref: "#/components/schemas/Habit" }
                }
              },
              "Habit"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a habit",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["habit"],
                properties: {
                  habit: { $ref: "#/components/schemas/Habit" }
                }
              },
              "Updated habit"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a habit",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["habit"],
                properties: {
                  habit: { $ref: "#/components/schemas/Habit" }
                }
              },
              "Deleted habit"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/habits/{id}/check-ins": {
        post: {
          summary: "Record a habit outcome for one day",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["habit", "metrics"],
                properties: {
                  habit: { $ref: "#/components/schemas/Habit" },
                  metrics: { $ref: "#/components/schemas/XpMetricsPayload" }
                }
              },
              "Habit check-in result"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/habits/{id}/check-ins/{dateKey}": {
        delete: {
          summary: "Delete a habit check-in for one day",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["habit", "metrics"],
                properties: {
                  habit: { $ref: "#/components/schemas/Habit" },
                  metrics: { $ref: "#/components/schemas/XpMetricsPayload" }
                }
              },
              "Habit check-in deletion result"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/tags": {
        get: {
          summary: "List tags",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["tags"],
                properties: {
                  tags: arrayOf({ $ref: "#/components/schemas/Tag" })
                }
              },
              "Tag collection"
            )
          }
        },
        post: {
          summary: "Create a tag",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["tag"],
                properties: {
                  tag: { $ref: "#/components/schemas/Tag" }
                }
              },
              "Created tag"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/tags/{id}": {
        get: {
          summary: "Get a tag",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["tag"],
                properties: {
                  tag: { $ref: "#/components/schemas/Tag" }
                }
              },
              "Tag"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a tag",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["tag"],
                properties: {
                  tag: { $ref: "#/components/schemas/Tag" }
                }
              },
              "Updated tag"
            ),
            "404": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a tag",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["tag"],
                properties: {
                  tag: { $ref: "#/components/schemas/Tag" }
                }
              },
              "Deleted tag"
            ),
            "404": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/tasks": {
        get: {
          summary: "List tasks",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["tasks"],
                properties: {
                  tasks: arrayOf({ $ref: "#/components/schemas/Task" })
                }
              },
              "Task collection"
            )
          }
        },
        post: {
          summary: "Create a task",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["task"],
                properties: {
                  task: { $ref: "#/components/schemas/Task" }
                }
              },
              "Created task"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/operator/log-work": {
        post: {
          summary:
            "Log work that already happened by creating or updating a task and returning fresh XP state",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["task", "xp"],
                properties: {
                  task: { $ref: "#/components/schemas/Task" },
                  xp: { $ref: "#/components/schemas/XpMetricsPayload" }
                }
              },
              "Updated task and XP state"
            ),
            "201": jsonResponse(
              {
                type: "object",
                required: ["task", "xp"],
                properties: {
                  task: { $ref: "#/components/schemas/Task" },
                  xp: { $ref: "#/components/schemas/XpMetricsPayload" }
                }
              },
              "Created task and XP state"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/work-adjustments": {
        post: {
          summary:
            "Add or remove tracked work minutes on an existing task or project and return fresh XP state",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WorkAdjustmentInput" }
              }
            }
          },
          responses: {
            "201": jsonResponse(
              { $ref: "#/components/schemas/WorkAdjustmentResult" },
              "Created work adjustment and refreshed XP state"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/tasks/{id}": {
        get: {
          summary: "Get a task",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["task"],
                properties: {
                  task: { $ref: "#/components/schemas/Task" }
                }
              },
              "Task"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a task",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["task"],
                properties: {
                  task: { $ref: "#/components/schemas/Task" }
                }
              },
              "Updated task"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a task",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["task"],
                properties: {
                  task: { $ref: "#/components/schemas/Task" }
                }
              },
              "Deleted task"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/tasks/{id}/context": {
        get: {
          summary:
            "Get task detail context including project, goal, runs, and evidence",
          responses: {
            "200": jsonResponse(
              { $ref: "#/components/schemas/TaskContextPayload" },
              "Task detail payload"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/tasks/{id}/runs": {
        post: {
          summary: "Start or renew a live task timer for a task",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaskRunClaimInput" }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["taskRun"],
                properties: {
                  taskRun: { $ref: "#/components/schemas/TaskRun" }
                }
              },
              "Existing active task timer"
            ),
            "201": jsonResponse(
              {
                type: "object",
                required: ["taskRun"],
                properties: {
                  taskRun: { $ref: "#/components/schemas/TaskRun" }
                }
              },
              "Created task timer"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/tasks/{id}/uncomplete": {
        post: {
          summary: "Reopen a completed task and remove its completion XP",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["task"],
                properties: {
                  task: { $ref: "#/components/schemas/Task" }
                }
              },
              "Reopened task"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/task-runs": {
        get: {
          summary:
            "List task timers with optional task and active-state filters",
          parameters: [
            { name: "taskId", in: "query", schema: { type: "string" } },
            {
              name: "status",
              in: "query",
              schema: {
                type: "string",
                enum: ["active", "completed", "released", "timed_out"]
              }
            },
            { name: "active", in: "query", schema: { type: "boolean" } },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 100 }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["taskRuns"],
                properties: {
                  taskRuns: arrayOf({ $ref: "#/components/schemas/TaskRun" })
                }
              },
              "Task timers"
            )
          }
        }
      },
      "/api/v1/task-runs/{id}/heartbeat": {
        post: {
          summary: "Renew a live task timer heartbeat",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaskRunHeartbeatInput" }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["taskRun"],
                properties: {
                  taskRun: { $ref: "#/components/schemas/TaskRun" }
                }
              },
              "Updated task timer heartbeat"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/task-runs/{id}/focus": {
        post: {
          summary: "Mark one live task timer as the current primary timer",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaskRunFocusInput" }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["taskRun"],
                properties: {
                  taskRun: { $ref: "#/components/schemas/TaskRun" }
                }
              },
              "Focused task timer"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/task-runs/{id}/complete": {
        post: {
          summary: "Complete a live task timer and complete the task",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaskRunFinishInput" }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["taskRun"],
                properties: {
                  taskRun: { $ref: "#/components/schemas/TaskRun" }
                }
              },
              "Completed task timer"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/task-runs/{id}/release": {
        post: {
          summary:
            "Pause or release a live task timer without completing the task",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaskRunFinishInput" }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["taskRun"],
                properties: {
                  taskRun: { $ref: "#/components/schemas/TaskRun" }
                }
              },
              "Released task timer"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/activity": {
        get: {
          summary: "List visible activity events",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["activity"],
                properties: {
                  activity: arrayOf({
                    $ref: "#/components/schemas/ActivityEvent"
                  })
                }
              },
              "Activity archive"
            )
          }
        }
      },
      "/api/v1/activity/{id}/remove": {
        post: {
          summary:
            "Hide an activity event from the visible archive through a correction record",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["event"],
                properties: {
                  event: { $ref: "#/components/schemas/ActivityEvent" }
                }
              },
              "Correction event"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/metrics": {
        get: {
          summary: "Get gamification metrics",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["metrics"],
                properties: {
                  metrics: {
                    type: "object",
                    additionalProperties: false,
                    required: ["profile", "achievements", "milestoneRewards"],
                    properties: {
                      profile: {
                        $ref: "#/components/schemas/GamificationProfile"
                      },
                      achievements: arrayOf({
                        $ref: "#/components/schemas/AchievementSignal"
                      }),
                      milestoneRewards: arrayOf({
                        $ref: "#/components/schemas/MilestoneReward"
                      })
                    }
                  }
                }
              },
              "Gamification metrics"
            )
          }
        }
      },
      "/api/v1/metrics/xp": {
        get: {
          summary: "Get explainable XP metrics and reward-ledger state",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["metrics"],
                properties: {
                  metrics: { $ref: "#/components/schemas/XpMetricsPayload" }
                }
              },
              "XP metrics payload"
            )
          }
        }
      },
      "/api/v1/insights": {
        get: {
          summary: "Get deterministic coaching and stored insight feed",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["insights"],
                properties: {
                  insights: { $ref: "#/components/schemas/InsightsPayload" }
                }
              },
              "Insights payload"
            )
          }
        },
        post: {
          summary: "Store a structured insight",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["insight"],
                properties: {
                  insight: { $ref: "#/components/schemas/Insight" }
                }
              },
              "Created insight"
            )
          }
        }
      },
      "/api/v1/insights/{id}": {
        get: {
          summary: "Get one stored insight",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["insight"],
                properties: {
                  insight: { $ref: "#/components/schemas/Insight" }
                }
              },
              "Insight"
            )
          }
        },
        patch: {
          summary: "Update a stored insight",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["insight"],
                properties: {
                  insight: { $ref: "#/components/schemas/Insight" }
                }
              },
              "Updated insight"
            )
          }
        },
        delete: {
          summary: "Soft delete or permanently delete a stored insight",
          parameters: [
            {
              name: "mode",
              in: "query",
              schema: { type: "string", enum: ["soft", "hard"] }
            },
            { name: "reason", in: "query", schema: { type: "string" } }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["insight"],
                properties: {
                  insight: { $ref: "#/components/schemas/Insight" }
                }
              },
              "Deleted insight"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/insights/{id}/feedback": {
        post: {
          summary: "Record structured feedback for an insight",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["feedback"],
                properties: {
                  feedback: { $ref: "#/components/schemas/InsightFeedback" }
                }
              },
              "Insight feedback"
            )
          }
        }
      },
      "/api/v1/approval-requests": {
        get: {
          summary: "List approval requests",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["approvalRequests"],
                properties: {
                  approvalRequests: arrayOf({
                    $ref: "#/components/schemas/ApprovalRequest"
                  })
                }
              },
              "Approval requests"
            )
          }
        }
      },
      "/api/v1/approval-requests/{id}/approve": {
        post: {
          summary: "Approve and execute a pending agent action",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["approvalRequest"],
                properties: {
                  approvalRequest: {
                    $ref: "#/components/schemas/ApprovalRequest"
                  }
                }
              },
              "Approved request"
            )
          }
        }
      },
      "/api/v1/approval-requests/{id}/reject": {
        post: {
          summary: "Reject a pending agent action",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["approvalRequest"],
                properties: {
                  approvalRequest: {
                    $ref: "#/components/schemas/ApprovalRequest"
                  }
                }
              },
              "Rejected request"
            )
          }
        }
      },
      "/api/v1/agents": {
        get: {
          summary: "List registered agent identities",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["agents"],
                properties: {
                  agents: arrayOf({
                    $ref: "#/components/schemas/AgentIdentity"
                  })
                }
              },
              "Agent identities"
            )
          }
        }
      },
      "/api/v1/agents/onboarding": {
        get: {
          summary: "Get the live onboarding contract for new API agents",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["onboarding"],
                properties: {
                  onboarding: {
                    $ref: "#/components/schemas/AgentOnboardingPayload"
                  }
                }
              },
              "Agent onboarding payload"
            )
          }
        }
      },
      "/api/v1/agents/{id}/actions": {
        get: {
          summary: "List actions created by one agent",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["actions"],
                properties: {
                  actions: arrayOf({ $ref: "#/components/schemas/AgentAction" })
                }
              },
              "Agent actions"
            )
          }
        }
      },
      "/api/v1/agent-actions": {
        post: {
          summary:
            "Create an agent action that either executes directly or enters the approval queue",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["action", "approvalRequest"],
                properties: {
                  action: { $ref: "#/components/schemas/AgentAction" },
                  approvalRequest: nullable({
                    $ref: "#/components/schemas/ApprovalRequest"
                  })
                }
              },
              "Executed agent action"
            ),
            "202": jsonResponse(
              {
                type: "object",
                required: ["action", "approvalRequest"],
                properties: {
                  action: { $ref: "#/components/schemas/AgentAction" },
                  approvalRequest: nullable({
                    $ref: "#/components/schemas/ApprovalRequest"
                  })
                }
              },
              "Pending approval agent action"
            )
          }
        }
      },
      "/api/v1/rewards/rules": {
        get: {
          summary: "List reward rules",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["rules"],
                properties: {
                  rules: arrayOf({ $ref: "#/components/schemas/RewardRule" })
                }
              },
              "Reward rules"
            )
          }
        }
      },
      "/api/v1/rewards/rules/{id}": {
        get: {
          summary: "Get one reward rule",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["rule"],
                properties: {
                  rule: { $ref: "#/components/schemas/RewardRule" }
                }
              },
              "Reward rule"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a reward rule",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["rule"],
                properties: {
                  rule: { $ref: "#/components/schemas/RewardRule" }
                }
              },
              "Updated reward rule"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/rewards/ledger": {
        get: {
          summary: "List reward ledger events",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["ledger"],
                properties: {
                  ledger: arrayOf({
                    $ref: "#/components/schemas/RewardLedgerEvent"
                  })
                }
              },
              "Reward ledger"
            )
          }
        }
      },
      "/api/v1/rewards/bonus": {
        post: {
          summary: "Create a manual, explainable XP bonus entry",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["reward", "metrics"],
                properties: {
                  reward: { $ref: "#/components/schemas/RewardLedgerEvent" },
                  metrics: { $ref: "#/components/schemas/XpMetricsPayload" }
                }
              },
              "Manual reward bonus"
            )
          }
        }
      },
      "/api/v1/events": {
        get: {
          summary: "List canonical event log entries",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["events"],
                properties: {
                  events: arrayOf({
                    $ref: "#/components/schemas/EventLogEntry"
                  })
                }
              },
              "Event log"
            )
          }
        }
      },
      "/api/v1/session-events": {
        post: {
          summary: "Record bounded ambient engagement telemetry",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["sessionEvent", "rewardEvent"],
                properties: {
                  sessionEvent: { type: "object", additionalProperties: true },
                  rewardEvent: nullable({
                    $ref: "#/components/schemas/RewardLedgerEvent"
                  })
                }
              },
              "Recorded session event"
            )
          }
        }
      },
      "/api/v1/reviews/weekly": {
        get: {
          summary: "Get the weekly review payload",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["review"],
                properties: {
                  review: { $ref: "#/components/schemas/WeeklyReviewPayload" }
                }
              },
              "Weekly review payload"
            )
          }
        }
      },
      "/api/v1/reviews/weekly/finalize": {
        post: {
          summary: "Finalize the current weekly review cycle",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["review", "closure", "reward", "metrics"],
                properties: {
                  review: { $ref: "#/components/schemas/WeeklyReviewPayload" },
                  closure: {
                    type: "object",
                    required: [
                      "id",
                      "weekKey",
                      "weekStartDate",
                      "weekEndDate",
                      "windowLabel",
                      "actor",
                      "source",
                      "rewardId",
                      "activityEventId",
                      "createdAt"
                    ],
                    properties: {
                      id: { type: "string" },
                      weekKey: { type: "string" },
                      weekStartDate: { type: "string" },
                      weekEndDate: { type: "string" },
                      windowLabel: { type: "string" },
                      actor: nullable({ type: "string" }),
                      source: {
                        type: "string",
                        enum: ["ui", "openclaw", "agent", "system"]
                      },
                      rewardId: { type: "string" },
                      activityEventId: { type: "string" },
                      createdAt: { type: "string", format: "date-time" }
                    }
                  },
                  reward: { $ref: "#/components/schemas/RewardLedgerEvent" },
                  metrics: { $ref: "#/components/schemas/XpMetricsPayload" }
                }
              },
              "Existing weekly review closure"
            ),
            "201": jsonResponse(
              {
                type: "object",
                required: ["review", "closure", "reward", "metrics"],
                properties: {
                  review: { $ref: "#/components/schemas/WeeklyReviewPayload" },
                  closure: {
                    type: "object",
                    required: [
                      "id",
                      "weekKey",
                      "weekStartDate",
                      "weekEndDate",
                      "windowLabel",
                      "actor",
                      "source",
                      "rewardId",
                      "activityEventId",
                      "createdAt"
                    ],
                    properties: {
                      id: { type: "string" },
                      weekKey: { type: "string" },
                      weekStartDate: { type: "string" },
                      weekEndDate: { type: "string" },
                      windowLabel: { type: "string" },
                      actor: nullable({ type: "string" }),
                      source: {
                        type: "string",
                        enum: ["ui", "openclaw", "agent", "system"]
                      },
                      rewardId: { type: "string" },
                      activityEventId: { type: "string" },
                      createdAt: { type: "string", format: "date-time" }
                    }
                  },
                  reward: { $ref: "#/components/schemas/RewardLedgerEvent" },
                  metrics: { $ref: "#/components/schemas/XpMetricsPayload" }
                }
              },
              "Created weekly review closure"
            )
          }
        }
      },
      "/api/v1/settings": {
        get: {
          summary: "Get local operator settings",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["settings"],
                properties: {
                  settings: { $ref: "#/components/schemas/SettingsPayload" }
                }
              },
              "Settings payload"
            )
          }
        },
        patch: {
          summary: "Update local operator settings",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SettingsUpdateInput" }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["settings"],
                properties: {
                  settings: { $ref: "#/components/schemas/SettingsPayload" }
                }
              },
              "Updated settings"
            )
          }
        }
      },
      "/api/v1/settings/bin": {
        get: {
          summary:
            "Get the deleted-items bin with restore and hard-delete context",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["bin"],
                properties: {
                  bin: { $ref: "#/components/schemas/SettingsBinPayload" }
                }
              },
              "Settings bin payload"
            )
          }
        }
      },
      "/api/v1/entities/create": {
        post: {
          summary:
            "Create multiple Forge entities in one ordered batch request",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["results"],
                properties: {
                  results: arrayOf({
                    $ref: "#/components/schemas/BatchEntityResult"
                  })
                }
              },
              "Batch create results"
            )
          }
        }
      },
      "/api/v1/entities/update": {
        post: {
          summary:
            "Update multiple Forge entities in one ordered batch request",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["results"],
                properties: {
                  results: arrayOf({
                    $ref: "#/components/schemas/BatchEntityResult"
                  })
                }
              },
              "Batch update results"
            )
          }
        }
      },
      "/api/v1/entities/delete": {
        post: {
          summary:
            "Delete multiple Forge entities in one ordered batch request. Soft delete is the default.",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["results"],
                properties: {
                  results: arrayOf({
                    $ref: "#/components/schemas/BatchEntityResult"
                  })
                }
              },
              "Batch delete results"
            )
          }
        }
      },
      "/api/v1/entities/restore": {
        post: {
          summary:
            "Restore multiple soft-deleted Forge entities in one ordered batch request",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["results"],
                properties: {
                  results: arrayOf({
                    $ref: "#/components/schemas/BatchEntityResult"
                  })
                }
              },
              "Batch restore results"
            )
          }
        }
      },
      "/api/v1/entities/search": {
        post: {
          summary:
            "Search across multiple Forge entity types in one ordered batch request",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["results"],
                properties: {
                  results: arrayOf({
                    $ref: "#/components/schemas/BatchEntityResult"
                  })
                }
              },
              "Batch search results"
            )
          }
        }
      },
      "/api/v1/settings/tokens": {
        post: {
          summary: "Create an agent token",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["token"],
                properties: {
                  token: {
                    $ref: "#/components/schemas/AgentTokenMutationResult"
                  }
                }
              },
              "Created agent token"
            )
          }
        }
      }
    }
  };

  return annotateOpenApiDocument(document);
}
