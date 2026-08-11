import {
  buildPeerOpenApiComponents,
  buildPeerOpenApiPaths
} from "./peer-openapi.js";
import { buildCourseOpenApiPaths } from "./course-openapi.js";
import { buildSecurityPairingOpenApiPaths } from "./security-pairing-openapi.js";
import {
  TASK_CLOSEOUT_LIMITS,
  crudEntityTypeSchema,
  localSearchEntityKindSchema
} from "./types.js";

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

function stringQueryParameter(name: string) {
  return {
    name,
    in: "query",
    required: false,
    schema: { type: "string" }
  };
}

function repeatedStringQueryParameter(name: string) {
  return {
    name,
    in: "query",
    required: false,
    schema: { type: "array", items: { type: "string" } },
    style: "form",
    explode: true
  };
}

function integerQueryParameter(name: string, minimum: number, maximum: number) {
  return {
    name,
    in: "query",
    required: false,
    schema: { type: "integer", minimum, maximum }
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

const mobileHealthSyncProgressSchema = {
  type: "object",
  required: ["chunkCount", "receivedBytes", "receivedCounts", "byteTotals"],
  properties: {
    chunkCount: { type: "number" },
    receivedBytes: { type: "number" },
    receivedCounts: {
      type: "object",
      additionalProperties: { type: "number" }
    },
    byteTotals: { type: "object", additionalProperties: { type: "number" } }
  }
};

const mobileHealthSyncUploadSchema = {
  type: "object",
  required: [
    "syncSessionId",
    "schemaVersion",
    "status",
    "targetChunkBytes",
    "maxChunkBytes",
    "payloadEncodings",
    "acceptedFamilies",
    "receivedChunkIds",
    "progress"
  ],
  properties: {
    syncSessionId: { type: "string" },
    schemaVersion: { type: "string" },
    status: {
      type: "string",
      enum: ["running", "completed", "failed", "aborted"]
    },
    targetChunkBytes: { type: "number" },
    maxChunkBytes: { type: "number" },
    payloadEncodings: arrayOf({ type: "string" }),
    acceptedFamilies: arrayOf({ type: "string" }),
    receivedChunkIds: arrayOf({ type: "string" }),
    progress: mobileHealthSyncProgressSchema
  }
};

const CALENDAR_PROVIDER_VALUES = [
  "google",
  "apple",
  "microsoft",
  "caldav",
  "macos_local"
];

const PREFERENCE_DOMAIN_VALUES = [
  "projects",
  "tasks",
  "strategies",
  "habits",
  "calendar",
  "sleep",
  "sports",
  "activities",
  "food",
  "places",
  "countries",
  "fashion",
  "people",
  "media",
  "tools",
  "custom"
];

const PREFERENCE_ITEM_STATUS_VALUES = [
  "liked",
  "disliked",
  "uncertain",
  "vetoed",
  "bookmarked",
  "favorite",
  "must_have",
  "neutral"
];

const REWARDABLE_ENTITY_TYPE_VALUES = [
  "system",
  "goal",
  "project",
  "task",
  "habit",
  "tag",
  "note",
  "insight",
  "psyche_value",
  "behavior_pattern",
  "behavior",
  "belief_entry",
  "mode_profile",
  "flashcard",
  "trigger_report"
];

const API_TAGS = [
  {
    name: "Meta",
    description: "OpenAPI discovery and route-level API metadata."
  },
  {
    name: "Health",
    description:
      "Runtime health, sleep, sports, workout, and mobile sync surfaces."
  },
  {
    name: "Movement",
    description:
      "Movement overviews, timeline history, known places, stays, trips, selection aggregates, and user-defined overlay routes."
  },
  {
    name: "Life Force",
    description: "Energy-budget, fatigue, and action-point modeling routes."
  },
  {
    name: "Auth",
    description: "Operator session bootstrapping for trusted local usage."
  },
  {
    name: "Platform",
    description:
      "Top-level runtime context and canonical Forge domain catalogs."
  },
  {
    name: "Operator",
    description: "Current work, overview, and operator-facing runtime state."
  },
  {
    name: "Users",
    description:
      "Forge user directory, ownership, and multi-user runtime surfaces."
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
    name: "Attention",
    description:
      "A bounded, deduplicated queue of existing Forge records that need review or a decision."
  },
  {
    name: "Mutation Receipts",
    description:
      "Owner-scoped recent-change receipts with bounded, idempotent Undo and truthful terminal states."
  },
  {
    name: "Navigation",
    description:
      "Canonical cross-surface pins and actor-scoped recently viewed Forge records."
  },
  {
    name: "Saved Views",
    description:
      "Named, user-owned Action Bar query, filter, and people-scope combinations."
  },
  {
    name: "Search",
    description:
      "Permission-first local lexical and released-relationship search across eligible Forge record families."
  },
  {
    name: "Relationship Proposals",
    description:
      "Owner-scoped, human-reviewed suggestions that never write a relationship before acceptance."
  },
  {
    name: "Entity Batch",
    description:
      "Batch create, update, delete, restore, and search operations across entity types."
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
    description:
      "Directed planning structures that sit above project execution."
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
    name: "Git",
    description: "Bounded operator-only Git reference discovery."
  },
  {
    name: "Habits",
    description: "Recurring commitments and habit check-ins."
  },
  {
    name: "Calendar",
    description:
      "Calendar connections, work blocks, timeboxes, and native Forge events."
  },
  {
    name: "Notes",
    description:
      "Markdown evidence records linked to one or more Forge entities."
  },
  {
    name: "Tags",
    description: "Tag CRUD for shared Forge classification."
  },
  {
    name: "Wiki",
    description:
      "SQLite-backed wiki settings, pages, ingest, sync, health, and search."
  },
  {
    name: "People",
    description:
      "Person records, bounded context reads, Wiki association review, and typed questions."
  },
  {
    name: "Peer sharing",
    description:
      "Human-approved Forge-to-Forge pairing, directional grants, devices, synchronization, and diagnostics."
  },
  {
    name: "Artifacts",
    description:
      "Trusted file artifact storage, metadata, static safety scans, human-only downloads, links, versions, and audit events."
  },
  {
    name: "Preferences",
    description:
      "Preference profiles, comparisons, concepts, contexts, and learned scores."
  },
  {
    name: "Comparisons",
    description:
      "Permission-first, single-user comparison catalogs and read-only timelines across six existing Forge record families."
  },
  {
    name: "Psyche",
    description:
      "Values, patterns, behaviors, beliefs, modes, reports, and related Psyche surfaces."
  },
  {
    name: "Questionnaires",
    description:
      "Psyche questionnaire libraries, runs, scoring, and self-observation calendar integration."
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
      "Life Events",
      "Notes",
      "Tags",
      "Activity",
      "Metrics",
      "Reviews",
      "Insights",
      "Attention",
      "Navigation",
      "Workbench"
    ]
  },
  {
    name: "Knowledge And Reflection",
    tags: [
      "People",
      "Wiki",
      "Artifacts",
      "Relationship Proposals",
      "Preferences",
      "Comparisons",
      "Psyche",
      "Questionnaires"
    ]
  },
  {
    name: "Platform And Agents",
    tags: [
      "Users",
      "Settings",
      "Agents",
      "Approvals",
      "Peer sharing",
      "Entity Batch"
    ]
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
  if (path.startsWith("/api/v1/health") || path.startsWith("/api/v1/mobile")) {
    return ["Health"];
  }
  if (path.startsWith("/api/v1/movement")) {
    return ["Movement"];
  }
  if (path.startsWith("/api/v1/life-force")) {
    return ["Life Force"];
  }
  if (path.startsWith("/api/v1/life-events")) {
    return ["Life Events"];
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
    path.startsWith("/api/v1/attention-inbox") ||
    path.startsWith("/api/v1/attention-resolutions")
  ) {
    return ["Attention"];
  }
  if (path.startsWith("/api/v1/mutation-receipts")) {
    return ["Mutation Receipts"];
  }
  if (path.startsWith("/api/v1/entity-navigation")) {
    return ["Navigation"];
  }
  if (path.startsWith("/api/v1/saved-views")) {
    return ["Saved Views"];
  }
  if (path.startsWith("/api/v1/local-search")) {
    return ["Search"];
  }
  if (path.startsWith("/api/v1/relationship-proposals")) {
    return ["Relationship Proposals"];
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
  if (path.startsWith("/api/v1/people")) {
    return ["People"];
  }
  if (path.startsWith("/api/v1/peers")) {
    return ["Peer sharing"];
  }
  if (path.startsWith("/api/v1/artifacts")) {
    return ["Artifacts"];
  }
  if (path.startsWith("/api/v1/comparisons")) {
    return ["Comparisons"];
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
  if (
    path.startsWith("/api/v1/projects") ||
    path.startsWith("/api/v1/campaigns")
  ) {
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
  if (path.startsWith("/api/v1/git-helper")) {
    return ["Git"];
  }
  if (
    path.startsWith("/api/v1/tasks") ||
    path.startsWith("/api/v1/work-items") ||
    path.startsWith("/api/v1/work-adjustments") ||
    path.startsWith("/api/v1/offline-mutations")
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
    path.startsWith("/api/v1/rewards") ||
    path.startsWith("/api/v1/gamification")
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

  const validationExpectedShape = {
    type: "object",
    additionalProperties: true,
    required: ["inputShape", "requiredFields", "notes"],
    properties: {
      toolName: { type: "string" },
      inputShape: { type: "string" },
      requiredFields: arrayOf({ type: "string" }),
      example: { type: ["string", "null"] },
      notes: arrayOf({ type: "string" })
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
      route: { type: "string" },
      validationSummary: { type: "string" },
      details: arrayOf({ $ref: "#/components/schemas/ValidationIssue" }),
      expectedShape: {
        $ref: "#/components/schemas/ValidationExpectedShape"
      }
    }
  };
  const comparisonFamily = {
    type: "string",
    enum: ["preference", "health", "psyche", "insight", "note", "wiki"]
  };
  const comparisonCatalogItem = {
    type: "object",
    additionalProperties: false,
    required: [
      "selector",
      "family",
      "title",
      "description",
      "valueKind",
      "unit",
      "availability",
      "sourceHref"
    ],
    properties: {
      selector: { type: "string" },
      family: { $ref: "#/components/schemas/ComparisonFamily" },
      title: { type: "string" },
      description: { type: "string" },
      valueKind: { type: "string", enum: ["number", "event"] },
      unit: nullable({ type: "string" }),
      availability: {
        type: "string",
        enum: ["history", "current_only"]
      },
      sourceHref: { type: "string" }
    }
  };
  const comparisonCatalogResponse = {
    type: "object",
    additionalProperties: false,
    required: [
      "userId",
      "query",
      "family",
      "items",
      "total",
      "limit",
      "nextCursor",
      "hasMore"
    ],
    properties: {
      userId: { type: "string" },
      query: { type: "string" },
      family: nullable({ $ref: "#/components/schemas/ComparisonFamily" }),
      items: arrayOf({ $ref: "#/components/schemas/ComparisonCatalogItem" }),
      total: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      nextCursor: nullable({ type: "string" }),
      hasMore: { type: "boolean" }
    }
  };
  const comparisonEvidenceReference = {
    type: "object",
    additionalProperties: false,
    required: ["key", "label"],
    properties: {
      key: { type: "string" },
      label: { type: "string" }
    }
  };
  const comparisonSourceReference = {
    type: "object",
    additionalProperties: false,
    required: ["entityType", "entityId", "href"],
    properties: {
      entityType: { type: "string" },
      entityId: { type: "string" },
      href: { type: "string" }
    }
  };
  const comparisonPoint = {
    type: "object",
    additionalProperties: false,
    required: [
      "at",
      "dateKey",
      "value",
      "label",
      "missingReason",
      "source",
      "evidence"
    ],
    properties: {
      at: { type: "string", format: "date-time" },
      dateKey: { type: "string", format: "date" },
      value: nullable({ type: "number" }),
      label: nullable({ type: "string" }),
      missingReason: nullable({
        type: "string",
        enum: ["not_recorded", "not_stored"]
      }),
      source: nullable({
        $ref: "#/components/schemas/ComparisonSourceReference"
      }),
      evidence: {
        type: "array",
        maxItems: 12,
        items: { $ref: "#/components/schemas/ComparisonEvidenceReference" }
      }
    }
  };
  const comparisonLane = {
    type: "object",
    additionalProperties: false,
    required: [
      "selector",
      "family",
      "title",
      "valueKind",
      "unit",
      "availability",
      "state",
      "limitation",
      "sourceHref",
      "points",
      "pointCount",
      "sourceReferenceCount",
      "sourceReferencesTruncated"
    ],
    properties: {
      selector: { type: "string" },
      family: nullable({ $ref: "#/components/schemas/ComparisonFamily" }),
      title: { type: "string" },
      valueKind: nullable({
        type: "string",
        enum: ["number", "event"]
      }),
      unit: nullable({ type: "string" }),
      availability: nullable({
        type: "string",
        enum: ["history", "current_only"]
      }),
      state: { type: "string", enum: ["available", "unavailable"] },
      limitation: nullable({ type: "string" }),
      sourceHref: nullable({ type: "string" }),
      points: arrayOf({ $ref: "#/components/schemas/ComparisonPoint" }),
      pointCount: { type: "integer", minimum: 0 },
      sourceReferenceCount: { type: "integer", minimum: 0 },
      sourceReferencesTruncated: { type: "boolean" }
    }
  };
  const comparisonTotals = {
    type: "object",
    additionalProperties: false,
    required: [
      "laneCount",
      "pointCount",
      "sourceReferenceCount",
      "sourceReferencesTruncated"
    ],
    properties: {
      laneCount: { type: "integer", minimum: 0, maximum: 8 },
      pointCount: { type: "integer", minimum: 0, maximum: 3000 },
      sourceReferenceCount: { type: "integer", minimum: 0 },
      sourceReferencesTruncated: { type: "boolean" }
    }
  };
  const comparisonResponse = {
    type: "object",
    additionalProperties: false,
    required: [
      "userId",
      "from",
      "to",
      "timeZone",
      "alignmentRequested",
      "alignmentApplied",
      "sharedAxisReason",
      "lanes",
      "totals"
    ],
    properties: {
      userId: { type: "string" },
      from: { type: "string", format: "date" },
      to: { type: "string", format: "date" },
      timeZone: { type: "string" },
      alignmentRequested: {
        type: "string",
        enum: ["separate_tracks", "shared_axis"]
      },
      alignmentApplied: {
        type: "string",
        enum: ["separate_tracks", "shared_axis"]
      },
      sharedAxisReason: nullable({ type: "string" }),
      lanes: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: { $ref: "#/components/schemas/ComparisonLane" }
      },
      totals: { $ref: "#/components/schemas/ComparisonTotals" }
    }
  };
  const localSearchTextEvidence = {
    type: "object",
    additionalProperties: false,
    required: ["kind", "label", "field", "excerpt", "matchedTerms"],
    properties: {
      kind: { type: "string", enum: ["text"] },
      label: { type: "string" },
      field: { type: "string" },
      excerpt: { type: "string", maxLength: 180 },
      matchedTerms: {
        type: "array",
        maxItems: 20,
        uniqueItems: true,
        items: { type: "string" }
      }
    }
  };
  const localSearchRelationshipEvidence = {
    type: "object",
    additionalProperties: false,
    required: [
      "kind",
      "label",
      "excerpt",
      "relationKind",
      "relatedEntityType",
      "relatedEntityId"
    ],
    properties: {
      kind: { type: "string", enum: ["relationship"] },
      label: { type: "string" },
      excerpt: { type: "string", maxLength: 180 },
      relationKind: { type: "string" },
      relatedEntityType: {
        type: "string",
        enum: [...crudEntityTypeSchema.options]
      },
      relatedEntityId: { type: "string" }
    }
  };
  const localSearchResult = {
    type: "object",
    additionalProperties: false,
    required: [
      "entityType",
      "entityId",
      "entityKind",
      "title",
      "detail",
      "category",
      "sourceHref",
      "graphHref",
      "score",
      "evidence"
    ],
    properties: {
      entityType: {
        type: "string",
        enum: [...crudEntityTypeSchema.options]
      },
      entityId: { type: "string" },
      entityKind: nullable({
        type: "string",
        enum: [...localSearchEntityKindSchema.options]
      }),
      title: { type: "string", maxLength: 120 },
      detail: { type: "string", maxLength: 220 },
      category: { type: "string" },
      sourceHref: { type: "string" },
      graphHref: nullable({ type: "string" }),
      score: { type: "number", minimum: 0 },
      evidence: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: {
          oneOf: [
            { $ref: "#/components/schemas/LocalSearchTextEvidence" },
            {
              $ref: "#/components/schemas/LocalSearchRelationshipEvidence"
            }
          ]
        }
      }
    }
  };
  const localSearchCoverage = {
    type: "object",
    additionalProperties: false,
    required: [
      "eligibleEntityTypes",
      "indexedDocuments",
      "indexedRelationships",
      "deletionTombstonesApplied",
      "scopeTombstonesApplied",
      "truncated"
    ],
    properties: {
      eligibleEntityTypes: {
        type: "array",
        minItems: crudEntityTypeSchema.options.length,
        maxItems: crudEntityTypeSchema.options.length,
        uniqueItems: true,
        items: {
          type: "string",
          enum: [...crudEntityTypeSchema.options]
        }
      },
      indexedDocuments: { type: "integer", minimum: 0, maximum: 3000 },
      indexedRelationships: { type: "integer", minimum: 0 },
      deletionTombstonesApplied: { type: "integer", minimum: 0 },
      scopeTombstonesApplied: { type: "integer", minimum: 0 },
      truncated: { type: "boolean", enum: [false] }
    }
  };
  const localSearchResponse = {
    type: "object",
    additionalProperties: false,
    required: ["query", "retrievalMode", "results", "coverage"],
    properties: {
      query: { type: "string", maxLength: 200 },
      retrievalMode: {
        type: "string",
        enum: ["local_lexical_structural"]
      },
      results: {
        type: "array",
        maxItems: 20,
        items: { $ref: "#/components/schemas/LocalSearchResult" }
      },
      coverage: { $ref: "#/components/schemas/LocalSearchCoverage" }
    }
  };
  const relationshipProposalEndpoint = {
    type: "object",
    additionalProperties: false,
    required: [
      "entityType",
      "entityId",
      "title",
      "detail",
      "sourceHref",
      "graphHref"
    ],
    properties: {
      entityType: {
        type: "string",
        enum: [...crudEntityTypeSchema.options]
      },
      entityId: { type: "string", minLength: 1, maxLength: 256 },
      title: { type: "string", minLength: 1, maxLength: 500 },
      detail: { type: "string", maxLength: 1000 },
      sourceHref: { type: "string", minLength: 1, maxLength: 2048 },
      graphHref: nullable({ type: "string", minLength: 1, maxLength: 2048 })
    }
  };
  const relationshipProposalEvidence = {
    type: "object",
    additionalProperties: false,
    required: ["sourceField", "targetField", "matchedTerms"],
    properties: {
      sourceField: { type: "string", minLength: 1, maxLength: 80 },
      targetField: { type: "string", minLength: 1, maxLength: 80 },
      matchedTerms: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        uniqueItems: true,
        items: { type: "string", minLength: 2, maxLength: 80 }
      }
    }
  };
  const relationshipProposal = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "ownerUserId",
      "source",
      "target",
      "relationship",
      "evidence",
      "explanation",
      "confidence",
      "generator",
      "status",
      "revision",
      "expiresAt",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string", minLength: 1, maxLength: 80 },
      ownerUserId: { type: "string", minLength: 1 },
      source: { $ref: "#/components/schemas/RelationshipProposalEndpoint" },
      target: { $ref: "#/components/schemas/RelationshipProposalEndpoint" },
      relationship: {
        type: "string",
        enum: ["supports", "informs", "related"]
      },
      evidence: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: { $ref: "#/components/schemas/RelationshipProposalEvidence" }
      },
      explanation: { type: "string", minLength: 1, maxLength: 800 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      generator: {
        type: "object",
        additionalProperties: false,
        required: ["id", "version"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 80 },
          version: { type: "string", minLength: 1, maxLength: 80 }
        }
      },
      status: { type: "string", enum: ["pending"] },
      revision: { type: "integer", minimum: 1 },
      expiresAt: { type: "string", format: "date-time" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };
  const relationshipProposalGeneration = {
    type: "object",
    additionalProperties: false,
    required: [
      "generator",
      "consideredDocuments",
      "comparisons",
      "created",
      "unauthorizedCandidateCount",
      "truncated"
    ],
    properties: {
      generator: {
        type: "object",
        additionalProperties: false,
        required: ["id", "version"],
        properties: {
          id: { type: "string" },
          version: { type: "string" }
        }
      },
      consideredDocuments: { type: "integer", minimum: 0, maximum: 750 },
      comparisons: { type: "integer", minimum: 0, maximum: 2000 },
      created: { type: "integer", minimum: 0, maximum: 120 },
      unauthorizedCandidateCount: { type: "integer", minimum: 0, maximum: 0 },
      truncated: { type: "boolean" }
    }
  };
  const relationshipProposalList = {
    type: "object",
    additionalProperties: false,
    required: ["proposals", "total", "shown", "limit", "generatedAt"],
    properties: {
      proposals: {
        type: "array",
        maxItems: 20,
        items: { $ref: "#/components/schemas/RelationshipProposal" }
      },
      total: { type: "integer", minimum: 0, maximum: 120 },
      shown: { type: "integer", minimum: 0, maximum: 20 },
      limit: { type: "integer", minimum: 1, maximum: 20 },
      generatedAt: { type: "string", format: "date-time" },
      generation: {
        $ref: "#/components/schemas/RelationshipProposalGeneration"
      }
    }
  };
  const relationshipProposalOwnerInput = {
    type: "object",
    additionalProperties: false,
    required: ["ownerUserId"],
    properties: {
      ownerUserId: { type: "string", minLength: 1 }
    }
  };
  const relationshipProposalDecisionInput = {
    type: "object",
    additionalProperties: false,
    required: ["ownerUserId", "expectedRevision"],
    properties: {
      ownerUserId: { type: "string", minLength: 1 },
      expectedRevision: { type: "integer", minimum: 1 }
    }
  };
  const relationshipProposalDecision = {
    type: "object",
    additionalProperties: false,
    required: ["status", "proposalId", "revision", "linkCreated", "replayed"],
    properties: {
      status: { type: "string", enum: ["accepted", "rejected"] },
      proposalId: { type: "string", minLength: 1 },
      revision: { type: "integer", minimum: 1 },
      linkCreated: { type: "boolean" },
      replayed: { type: "boolean" }
    }
  };
  const preferenceErrorResponses = (
    ...statuses: Array<400 | 401 | 403 | 404 | 409 | 500>
  ) =>
    Object.fromEntries(
      statuses.map((status) => [
        String(status),
        { $ref: "#/components/responses/Error" }
      ])
    );

  const userSummary = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "kind",
      "handle",
      "displayName",
      "description",
      "accentColor",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      kind: { type: "string", enum: ["human", "bot"] },
      handle: { type: "string" },
      displayName: { type: "string" },
      description: { type: "string" },
      accentColor: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
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

  const closeoutNoteLinkInput = {
    type: "object",
    additionalProperties: false,
    description:
      "The target must be live and accessible under the caller's capabilities and user, project, and tag scope. Missing, deleted, and inaccessible targets all return the same generic 404.",
    required: ["entityType", "entityId"],
    properties: {
      entityType: { type: "string", maxLength: 80 },
      entityId: { type: "string", minLength: 1, maxLength: 256 },
      anchorKey: nullable({ type: "string", maxLength: 256 })
    }
  };

  const closeoutNoteInput = {
    type: "object",
    additionalProperties: false,
    required: ["contentMarkdown"],
    properties: {
      kind: { type: "string", enum: ["evidence", "wiki"], default: "evidence" },
      title: { type: "string", maxLength: 512 },
      slug: { type: "string", maxLength: 256 },
      spaceId: { type: "string", maxLength: 256 },
      parentSlug: nullable({ type: "string", maxLength: 256 }),
      indexOrder: { type: "integer", default: 0 },
      showInIndex: { type: "boolean" },
      aliases: {
        type: "array",
        maxItems: 32,
        uniqueItems: true,
        items: { type: "string", maxLength: 160 }
      },
      summary: { type: "string", maxLength: 2000, default: "" },
      contentMarkdown: {
        type: "string",
        minLength: 1,
        maxLength: TASK_CLOSEOUT_LIMITS.closeoutNoteLength
      },
      author: nullable({
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.closeoutNoteAuthorLength
      }),
      links: {
        type: "array",
        maxItems: TASK_CLOSEOUT_LIMITS.closeoutNoteLinks,
        items: { $ref: "#/components/schemas/CloseoutNoteLinkInput" }
      },
      tags: {
        type: "array",
        maxItems: TASK_CLOSEOUT_LIMITS.closeoutNoteTags,
        uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 80 }
      },
      destroyAt: nullable({ type: "string", format: "date-time" }),
      sourcePath: { type: "string", maxLength: 1024, default: "" },
      frontmatter: {
        type: "object",
        additionalProperties: true,
        description: "JSON object limited to 4096 serialized characters."
      }
    }
  };

  const completionReport = {
    type: "object",
    additionalProperties: false,
    required: ["modifiedFiles", "workSummary", "linkedGitRefIds"],
    properties: {
      modifiedFiles: {
        type: "array",
        maxItems: TASK_CLOSEOUT_LIMITS.modifiedFiles,
        uniqueItems: true,
        items: {
          type: "string",
          minLength: 1,
          maxLength: TASK_CLOSEOUT_LIMITS.modifiedFileLength,
          description: "Safe repository-relative path without traversal."
        }
      },
      workSummary: {
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.workSummaryLength,
        default: ""
      },
      linkedGitRefIds: {
        type: "array",
        maxItems: TASK_CLOSEOUT_LIMITS.linkedGitRefIds,
        uniqueItems: true,
        items: {
          type: "string",
          minLength: 1,
          maxLength: TASK_CLOSEOUT_LIMITS.gitRefIdLength
        }
      }
    }
  };
  const completionReportInput = {
    type: completionReport.type,
    additionalProperties: completionReport.additionalProperties,
    properties: completionReport.properties
  };

  const safeGitUrl = nullable({
    type: "string",
    format: "uri",
    pattern: "^https?://",
    maxLength: TASK_CLOSEOUT_LIMITS.gitUrlLength
  });
  const workItemGitRefInput = {
    type: "object",
    additionalProperties: false,
    required: ["refType", "refValue"],
    properties: {
      id: {
        type: "string",
        minLength: 1,
        maxLength: TASK_CLOSEOUT_LIMITS.gitRefIdLength,
        pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"
      },
      refType: {
        type: "string",
        enum: ["commit", "branch", "pull_request"]
      },
      provider: {
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.gitProviderLength,
        default: "git"
      },
      repository: {
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.gitRepositoryLength,
        default: ""
      },
      refValue: {
        type: "string",
        minLength: 1,
        maxLength: TASK_CLOSEOUT_LIMITS.gitRefValueLength
      },
      url: safeGitUrl,
      displayTitle: {
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.gitDisplayTitleLength,
        default: ""
      }
    }
  };
  const workItemGitRef = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "workItemId",
      "refType",
      "provider",
      "repository",
      "refValue",
      "url",
      "rawUrl",
      "urlSafety",
      "displayTitle",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      ...workItemGitRefInput.properties,
      id: {
        type: "string",
        minLength: 1,
        maxLength: TASK_CLOSEOUT_LIMITS.gitRefIdLength
      },
      workItemId: { type: "string", minLength: 1 },
      rawUrl: nullable({
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.gitUrlLength,
        description:
          "Original URL when it is absent or safe. Unsafe legacy values are redacted to null."
      }),
      urlSafety: {
        type: "string",
        enum: ["absent", "safe", "unsafe"]
      },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const workItemBlockerLink = {
    type: "object",
    additionalProperties: false,
    required: ["entityType", "entityId"],
    properties: {
      entityType: {
        type: "string",
        minLength: 1,
        maxLength: TASK_CLOSEOUT_LIMITS.blockerEntityTypeLength
      },
      entityId: {
        type: "string",
        minLength: 1,
        maxLength: TASK_CLOSEOUT_LIMITS.blockerEntityIdLength
      },
      label: {
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.blockerLabelLength
      }
    }
  };

  const taskActionPointSummary = {
    type: "object",
    additionalProperties: false,
    required: [
      "costBand",
      "totalCostAp",
      "expectedDurationSeconds",
      "sustainRateApPerHour",
      "spentTodayAp",
      "spentTotalAp",
      "remainingAp"
    ],
    properties: {
      costBand: {
        type: "string",
        enum: ["tiny", "light", "standard", "heavy", "brutal"]
      },
      totalCostAp: { type: "number", minimum: 0 },
      expectedDurationSeconds: { type: "integer", minimum: 1 },
      sustainRateApPerHour: { type: "number", minimum: 0 },
      spentTodayAp: { type: "number", minimum: 0 },
      spentTotalAp: { type: "number", minimum: 0 },
      remainingAp: { type: "number", minimum: 0 }
    }
  };
  const taskSplitSuggestion = {
    type: "object",
    additionalProperties: false,
    required: ["shouldSplit", "reason", "thresholdSeconds"],
    properties: {
      shouldSplit: { type: "boolean" },
      reason: nullable({ type: "string" }),
      thresholdSeconds: { type: "integer", minimum: 1 }
    }
  };

  const task = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "title",
      "description",
      "level",
      "status",
      "priority",
      "owner",
      "goalId",
      "projectId",
      "parentWorkItemId",
      "dueDate",
      "effort",
      "energy",
      "points",
      "sortOrder",
      "plannedDurationSeconds",
      "schedulingRules",
      "resolutionKind",
      "splitParentTaskId",
      "aiInstructions",
      "executionMode",
      "acceptanceCriteria",
      "blockerLinks",
      "completionReport",
      "closeoutState",
      "gitRefs",
      "completedAt",
      "createdAt",
      "updatedAt",
      "tagIds",
      "userId",
      "user",
      "ownerUserId",
      "ownerUser",
      "assigneeUserIds",
      "assignees",
      "time",
      "actionPointSummary",
      "splitSuggestion"
    ],
    properties: {
      id: { type: "string" },
      title: { type: "string", minLength: 1 },
      description: { type: "string" },
      level: { type: "string", enum: ["issue", "task", "subtask"] },
      status: {
        type: "string",
        enum: ["backlog", "focus", "in_progress", "blocked", "done"]
      },
      priority: {
        type: "string",
        enum: ["low", "medium", "high", "critical"]
      },
      owner: { type: "string", minLength: 1 },
      goalId: nullable({ type: "string" }),
      projectId: nullable({ type: "string" }),
      parentWorkItemId: nullable({ type: "string" }),
      dueDate: nullable({ type: "string", format: "date" }),
      effort: { type: "string", enum: ["light", "deep", "marathon"] },
      energy: { type: "string", enum: ["low", "steady", "high"] },
      points: { type: "integer", minimum: 0 },
      sortOrder: { type: "integer", minimum: 0 },
      plannedDurationSeconds: nullable({
        type: "integer",
        minimum: 60,
        maximum: 604800
      }),
      schedulingRules: nullable({
        $ref: "#/components/schemas/CalendarSchedulingRules"
      }),
      resolutionKind: nullable({
        type: "string",
        enum: ["completed", "split"]
      }),
      splitParentTaskId: nullable({ type: "string" }),
      aiInstructions: { type: "string" },
      executionMode: nullable({ type: "string", enum: ["afk", "hitl"] }),
      acceptanceCriteria: {
        type: "array",
        maxItems: TASK_CLOSEOUT_LIMITS.acceptanceCriteria,
        uniqueItems: true,
        items: {
          type: "string",
          maxLength: TASK_CLOSEOUT_LIMITS.acceptanceCriterionLength
        }
      },
      blockerLinks: {
        type: "array",
        maxItems: TASK_CLOSEOUT_LIMITS.blockerLinks,
        items: { $ref: "#/components/schemas/WorkItemBlockerLink" }
      },
      completionReport: nullable({
        $ref: "#/components/schemas/CompletionReport"
      }),
      closeoutState: {
        type: "string",
        enum: ["not_applicable", "complete", "deferred"]
      },
      gitRefs: {
        type: "array",
        maxItems: TASK_CLOSEOUT_LIMITS.gitRefs,
        items: { $ref: "#/components/schemas/WorkItemGitRef" }
      },
      completedAt: nullable({ type: "string", format: "date-time" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      tagIds: arrayOf({ type: "string" }),
      userId: nullable({ type: "string" }),
      user: nullable({ $ref: "#/components/schemas/UserSummary" }),
      ownerUserId: nullable({ type: "string" }),
      ownerUser: nullable({ $ref: "#/components/schemas/UserSummary" }),
      assigneeUserIds: arrayOf({ type: "string" }),
      assignees: arrayOf({ $ref: "#/components/schemas/UserSummary" }),
      time: { $ref: "#/components/schemas/TaskTimeSummary" },
      actionPointSummary: {
        $ref: "#/components/schemas/TaskActionPointSummary"
      },
      splitSuggestion: { $ref: "#/components/schemas/TaskSplitSuggestion" }
    }
  };

  const taskRunGitContext = {
    type: "object",
    additionalProperties: false,
    required: [
      "provider",
      "repository",
      "branch",
      "baseBranch",
      "branchUrl",
      "pullRequestUrl",
      "pullRequestNumber",
      "compareUrl"
    ],
    properties: {
      provider: {
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.gitProviderLength
      },
      repository: {
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.gitRepositoryLength
      },
      branch: {
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.gitRefValueLength
      },
      baseBranch: {
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.gitRefValueLength
      },
      branchUrl: safeGitUrl,
      pullRequestUrl: safeGitUrl,
      pullRequestNumber: nullable({ type: "integer", minimum: 1 }),
      compareUrl: safeGitUrl
    }
  };
  const taskRunGitContextInput = {
    type: "object",
    additionalProperties: false,
    properties: taskRunGitContext.properties
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
      "timerMode",
      "plannedDurationSeconds",
      "elapsedWallSeconds",
      "creditedSeconds",
      "remainingSeconds",
      "overtimeSeconds",
      "isCurrent",
      "note",
      "leaseTtlSeconds",
      "claimedAt",
      "heartbeatAt",
      "leaseExpiresAt",
      "completedAt",
      "releasedAt",
      "timedOutAt",
      "overrideReason",
      "updatedAt",
      "userId",
      "user",
      "ownerUserId",
      "ownerUser",
      "assigneeUserIds",
      "assignees"
    ],
    properties: {
      id: { type: "string" },
      taskId: { type: "string" },
      taskTitle: { type: "string", minLength: 1 },
      actor: { type: "string", minLength: 1, maxLength: 160 },
      status: {
        type: "string",
        enum: ["active", "completed", "released", "timed_out"]
      },
      timerMode: { type: "string", enum: ["planned", "unlimited"] },
      plannedDurationSeconds: nullable({ type: "integer", minimum: 1 }),
      elapsedWallSeconds: { type: "integer", minimum: 0 },
      creditedSeconds: { type: "number", minimum: 0 },
      remainingSeconds: nullable({ type: "integer", minimum: 0 }),
      overtimeSeconds: { type: "integer", minimum: 0 },
      isCurrent: { type: "boolean" },
      note: {
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.runNoteLength
      },
      leaseTtlSeconds: { type: "integer", minimum: 1 },
      claimedAt: { type: "string", format: "date-time" },
      heartbeatAt: { type: "string", format: "date-time" },
      leaseExpiresAt: { type: "string", format: "date-time" },
      completedAt: nullable({ type: "string", format: "date-time" }),
      releasedAt: nullable({ type: "string", format: "date-time" }),
      timedOutAt: nullable({ type: "string", format: "date-time" }),
      overrideReason: nullable({ type: "string", maxLength: 1000 }),
      gitContext: nullable({ $ref: "#/components/schemas/TaskRunGitContext" }),
      updatedAt: { type: "string", format: "date-time" },
      userId: nullable({ type: "string" }),
      user: nullable({ $ref: "#/components/schemas/UserSummary" }),
      ownerUserId: nullable({ type: "string" }),
      ownerUser: nullable({ $ref: "#/components/schemas/UserSummary" }),
      assigneeUserIds: arrayOf({ type: "string" }),
      assignees: arrayOf({ $ref: "#/components/schemas/UserSummary" })
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
      provider: { type: "string", enum: CALENDAR_PROVIDER_VALUES },
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

  const calendarConnectionMutationInput = {
    type: "object",
    additionalProperties: true,
    required: ["provider", "label", "selectedCalendarUrls"],
    properties: {
      provider: { type: "string", enum: CALENDAR_PROVIDER_VALUES },
      label: { type: "string" },
      username: { type: "string" },
      password: { type: "string" },
      serverUrl: { type: "string", format: "uri" },
      authSessionId: { type: "string" },
      sourceId: { type: "string" },
      selectedCalendarUrls: {
        type: "array",
        minItems: 1,
        items: { type: "string", format: "uri" }
      },
      forgeCalendarUrl: nullable({ type: "string", format: "uri" }),
      createForgeCalendar: { type: "boolean" },
      replaceConnectionIds: arrayOf({ type: "string" })
    },
    oneOf: [
      {
        title: "Google Calendar connection",
        required: ["provider", "authSessionId"],
        properties: { provider: { const: "google" } }
      },
      {
        title: "Apple Calendar connection",
        required: ["provider", "username", "password"],
        properties: { provider: { const: "apple" } }
      },
      {
        title: "CalDAV connection",
        required: ["provider", "serverUrl", "username", "password"],
        properties: { provider: { const: "caldav" } }
      },
      {
        title: "Microsoft Calendar connection",
        required: ["provider", "authSessionId"],
        properties: { provider: { const: "microsoft" } }
      },
      {
        title: "macOS local Calendar connection",
        required: ["provider", "sourceId"],
        properties: { provider: { const: "macos_local" } }
      }
    ]
  };

  const calendarConnectionPatchInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      label: { type: "string" },
      selectedCalendarUrls: arrayOf({ type: "string" })
    }
  };

  const calendarDiscoveryInput = {
    type: "object",
    additionalProperties: true,
    required: ["provider"],
    properties: {
      provider: { type: "string", enum: ["apple", "caldav"] },
      serverUrl: { type: "string" },
      username: { type: "string" },
      password: { type: "string" }
    }
  };

  const calendarDiscoveryCalendar = {
    type: "object",
    additionalProperties: true,
    required: [
      "url",
      "displayName",
      "description",
      "color",
      "timezone",
      "isPrimary",
      "canWrite",
      "selectedByDefault",
      "isForgeCandidate"
    ],
    properties: {
      url: { type: "string" },
      displayName: { type: "string" },
      dedupedName: { type: "string" },
      description: { type: "string" },
      color: { type: "string" },
      timezone: { type: "string" },
      isPrimary: { type: "boolean" },
      canWrite: { type: "boolean" },
      selectedByDefault: { type: "boolean" },
      isForgeCandidate: { type: "boolean" },
      sourceId: nullable({ type: "string" }),
      sourceTitle: nullable({ type: "string" }),
      sourceType: nullable({ type: "string" }),
      calendarType: nullable({ type: "string" }),
      hostCalendarId: nullable({ type: "string" }),
      canonicalKey: nullable({ type: "string" })
    }
  };

  const calendarDiscoveryPayload = {
    type: "object",
    additionalProperties: true,
    required: [
      "provider",
      "accountLabel",
      "serverUrl",
      "principalUrl",
      "homeUrl",
      "calendars"
    ],
    properties: {
      provider: { type: "string", enum: CALENDAR_PROVIDER_VALUES },
      accountLabel: { type: "string" },
      serverUrl: { type: "string" },
      principalUrl: nullable({ type: "string" }),
      homeUrl: nullable({ type: "string" }),
      calendars: arrayOf(calendarDiscoveryCalendar)
    }
  };

  const macOSLocalCalendarDiscoveryPayload = {
    type: "object",
    additionalProperties: true,
    required: ["status", "requestedAt", "sources"],
    properties: {
      status: {
        type: "string",
        enum: [
          "not_determined",
          "denied",
          "restricted",
          "full_access",
          "unavailable"
        ]
      },
      requestedAt: { type: "string", format: "date-time" },
      sources: arrayOf({
        type: "object",
        additionalProperties: true,
        required: [
          "sourceId",
          "sourceTitle",
          "sourceType",
          "accountLabel",
          "accountIdentityKey",
          "calendars"
        ],
        properties: {
          sourceId: { type: "string" },
          sourceTitle: { type: "string" },
          sourceType: { type: "string" },
          accountLabel: { type: "string" },
          accountIdentityKey: { type: "string" },
          calendars: arrayOf(calendarDiscoveryCalendar)
        }
      })
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
      provider: { type: "string", enum: CALENDAR_PROVIDER_VALUES },
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

  const calendarProjectionResult = {
    type: "object",
    additionalProperties: false,
    required: ["state", "code", "message", "retryable"],
    properties: {
      state: {
        type: "string",
        enum: ["not_requested", "synced", "error"]
      },
      code: nullable({ type: "string" }),
      message: nullable({ type: "string" }),
      retryable: { type: "boolean" }
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
      "exclusionDates",
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
      exclusionDates: arrayOf({ type: "string", format: "date" }),
      blockingState: { type: "string", enum: ["allowed", "blocked"] },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const workBlockTemplateCreateInput = {
    type: "object",
    additionalProperties: false,
    required: ["title", "weekDays", "startMinute", "endMinute"],
    properties: {
      title: { type: "string", minLength: 1 },
      kind: {
        type: "string",
        enum: [
          "main_activity",
          "secondary_activity",
          "third_activity",
          "rest",
          "holiday",
          "custom"
        ],
        default: "custom"
      },
      color: {
        type: "string",
        pattern: "^#[0-9a-fA-F]{6}$",
        default: "#60a5fa"
      },
      timezone: { type: "string", default: "UTC" },
      weekDays: {
        type: "array",
        minItems: 1,
        maxItems: 7,
        items: { type: "integer", minimum: 0, maximum: 6 }
      },
      startMinute: { type: "integer", minimum: 0, maximum: 1440 },
      endMinute: { type: "integer", minimum: 0, maximum: 1440 },
      startsOn: nullable({ type: "string", format: "date" }),
      endsOn: nullable({ type: "string", format: "date" }),
      exclusionDates: {
        type: "array",
        maxItems: 366,
        items: { type: "string", format: "date" }
      },
      blockingState: {
        type: "string",
        enum: ["allowed", "blocked"],
        default: "blocked"
      },
      activityPresetKey: nullable({
        type: "string",
        enum: [
          "deep_work",
          "admin",
          "maintenance",
          "meeting",
          "recovery_break",
          "holiday_leisure",
          "light_context",
          "task_inherited"
        ]
      }),
      customSustainRateApPerHour: nullable({ type: "number", minimum: 0 }),
      userId: nullable({ type: "string", minLength: 1 })
    }
  };

  const workBlockTemplatePatchInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      ...workBlockTemplateCreateInput.properties,
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
      color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
      timezone: { type: "string" },
      blockingState: {
        type: "string",
        enum: ["allowed", "blocked"]
      }
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
      "actionProfile",
      "createdAt",
      "updatedAt",
      "userId",
      "user",
      "ownerUserId",
      "ownerUser",
      "assigneeUserIds",
      "assignees"
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
      actionProfile: nullable({
        type: "object",
        additionalProperties: true
      }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      userId: nullable({ type: "string" }),
      user: nullable({ $ref: "#/components/schemas/UserSummary" }),
      ownerUserId: nullable({ type: "string" }),
      ownerUser: nullable({ $ref: "#/components/schemas/UserSummary" }),
      assigneeUserIds: arrayOf({ type: "string" }),
      assignees: arrayOf({ $ref: "#/components/schemas/UserSummary" })
    }
  };

  const taskTimeboxCreateInput = {
    type: "object",
    additionalProperties: false,
    required: ["taskId", "title", "startsAt", "endsAt"],
    properties: {
      taskId: { type: "string", minLength: 1 },
      projectId: nullable({ type: "string", minLength: 1 }),
      title: { type: "string", minLength: 1 },
      startsAt: { type: "string", format: "date-time" },
      endsAt: { type: "string", format: "date-time" },
      source: {
        type: "string",
        enum: ["manual", "suggested", "live_run"],
        default: "manual"
      },
      status: {
        type: "string",
        enum: ["planned", "active", "completed", "cancelled"],
        default: "planned"
      },
      overrideReason: nullable({ type: "string", default: null }),
      activityPresetKey: nullable({
        type: "string",
        enum: [
          "deep_work",
          "admin",
          "maintenance",
          "meeting",
          "recovery_break",
          "holiday_leisure",
          "light_context",
          "task_inherited"
        ]
      }),
      customSustainRateApPerHour: nullable({ type: "number", minimum: 0 }),
      userId: nullable({ type: "string", minLength: 1 })
    }
  };

  const taskTimeboxPatchInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string", minLength: 1 },
      startsAt: { type: "string", format: "date-time" },
      endsAt: { type: "string", format: "date-time" },
      status: {
        type: "string",
        enum: ["planned", "active", "completed", "cancelled"]
      },
      overrideReason: nullable({ type: "string" }),
      activityPresetKey: nullable({
        type: "string",
        enum: [
          "deep_work",
          "admin",
          "maintenance",
          "meeting",
          "recovery_break",
          "holiday_leisure",
          "light_context",
          "task_inherited"
        ]
      }),
      customSustainRateApPerHour: nullable({ type: "number", minimum: 0 }),
      userId: nullable({ type: "string", minLength: 1 })
    }
  };

  const taskTimeboxRecommendationInput = {
    type: "object",
    additionalProperties: false,
    required: ["taskId"],
    properties: {
      taskId: { type: "string", minLength: 1 },
      from: { type: "string" },
      to: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 12, default: 6 },
      timezone: {
        type: "string",
        description:
          "Valid IANA timezone used to construct fallback wall-time windows."
      }
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
      "timezone",
      "dayBoundaryMode",
      "effectiveTimezone",
      "currentDateKey",
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
      timezone: {
        type: "string",
        description: "IANA timezone used as the habit's home day boundary."
      },
      dayBoundaryMode: {
        type: "string",
        enum: ["fixed", "travel"],
        description:
          "Fixed keeps the home timezone while traveling; travel follows a valid client timezone."
      },
      effectiveTimezone: { type: "string" },
      currentDateKey: { type: "string", format: "date" },
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
          "flashcard",
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
      "xpIntoLevel",
      "xpToNextLevel",
      "currentLevelStartXp",
      "nextLevelTotalXp",
      "levelCurveVersion",
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
      xpIntoLevel: { type: "integer" },
      xpToNextLevel: { type: "integer" },
      currentLevelStartXp: { type: "integer" },
      nextLevelTotalXp: { type: "integer" },
      levelCurveVersion: { type: "string" },
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

  const noteCreateContext = {
    type: "object",
    additionalProperties: false,
    required: ["version", "sourceEntityType", "sourceEntityId", "anchorKey"],
    properties: {
      version: { type: "integer", enum: [1] },
      sourceEntityType: {
        type: "string",
        enum: ["goal", "project", "task", "strategy", "habit", "trigger_report"]
      },
      sourceEntityId: { type: "string", minLength: 1, maxLength: 256 },
      anchorKey: nullable({ type: "string", maxLength: 120 })
    }
  };

  const note = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "kind",
      "title",
      "slug",
      "spaceId",
      "parentSlug",
      "indexOrder",
      "showInIndex",
      "aliases",
      "summary",
      "contentMarkdown",
      "contentPlain",
      "author",
      "source",
      "sourcePath",
      "frontmatter",
      "revisionHash",
      "lastSyncedAt",
      "createdAt",
      "updatedAt",
      "links",
      "unavailableLinkCount",
      "tags",
      "destroyAt",
      "userId",
      "user",
      "ownerUserId",
      "ownerUser",
      "assigneeUserIds",
      "assignees"
    ],
    properties: {
      id: { type: "string" },
      kind: { type: "string", enum: ["wiki", "evidence"] },
      title: { type: "string" },
      slug: { type: "string" },
      spaceId: { type: "string" },
      parentSlug: nullable({ type: "string" }),
      indexOrder: { type: "integer" },
      showInIndex: { type: "boolean" },
      aliases: arrayOf({ type: "string" }),
      summary: { type: "string" },
      contentMarkdown: { type: "string" },
      contentPlain: { type: "string" },
      author: nullable({ type: "string" }),
      source: { type: "string", enum: ["ui", "openclaw", "agent", "system"] },
      sourcePath: { type: "string" },
      frontmatter: {
        type: "object",
        additionalProperties: true,
        description:
          "Canonical Note metadata. Its linkedEntities mirror is projected with the same access policy as links, so unavailable identifiers are never exposed here."
      },
      revisionHash: { type: "string" },
      lastSyncedAt: nullable({ type: "string", format: "date-time" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      links: {
        ...arrayOf({ $ref: "#/components/schemas/NoteLink" }),
        description:
          "Only live linked targets accessible under the caller's capabilities and user, project, and tag scope. Omitted targets are counted without exposing their identifiers or the reason they are unavailable."
      },
      unavailableLinkCount: {
        type: "integer",
        minimum: 0,
        description:
          "Number of stored links omitted because the target is deleted, unavailable, or outside the caller's permissions and scope."
      },
      tags: arrayOf({ type: "string" }),
      destroyAt: nullable({ type: "string", format: "date-time" }),
      userId: nullable({ type: "string" }),
      user: nullable({ $ref: "#/components/schemas/UserSummary" }),
      ownerUserId: nullable({ type: "string" }),
      ownerUser: nullable({ $ref: "#/components/schemas/UserSummary" }),
      assigneeUserIds: arrayOf({ type: "string" }),
      assignees: arrayOf({ $ref: "#/components/schemas/UserSummary" })
    }
  };

  const noteMutationProperties = {
    kind: { type: "string", enum: ["wiki", "evidence"] },
    title: { type: "string" },
    slug: { type: "string" },
    spaceId: { type: "string" },
    parentSlug: nullable({ type: "string" }),
    indexOrder: { type: "integer" },
    showInIndex: { type: "boolean" },
    aliases: arrayOf({ type: "string" }),
    summary: { type: "string" },
    contentMarkdown: { type: "string", minLength: 1 },
    author: nullable({ type: "string" }),
    links: {
      type: "array",
      maxItems: 64,
      items: { $ref: "#/components/schemas/NoteLink" }
    },
    tags: {
      type: "array",
      maxItems: 24,
      items: { type: "string", minLength: 1, maxLength: 80 }
    },
    destroyAt: nullable({ type: "string", format: "date-time" }),
    sourcePath: { type: "string" },
    frontmatter: { type: "object", additionalProperties: true },
    userId: nullable({ type: "string", minLength: 1 })
  };

  const noteCreateInput = {
    type: "object",
    additionalProperties: false,
    required: ["contentMarkdown"],
    properties: {
      ...noteMutationProperties,
      createContext: { $ref: "#/components/schemas/NoteCreateContext" }
    }
  };

  const notePatchInput = {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
      ...noteMutationProperties,
      expectedRevisionHash: { type: "string" },
      revisionHash: { type: "string" },
      lastSyncedAt: nullable({ type: "string", format: "date-time" })
    }
  };

  const wikiPageSummary = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "kind",
      "title",
      "slug",
      "spaceId",
      "parentSlug",
      "indexOrder",
      "showInIndex",
      "aliases",
      "summary",
      "author",
      "source",
      "tags",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      kind: { type: "string", enum: ["wiki", "evidence"] },
      title: { type: "string" },
      slug: { type: "string" },
      spaceId: { type: "string" },
      parentSlug: nullable({ type: "string" }),
      indexOrder: { type: "integer" },
      showInIndex: { type: "boolean" },
      aliases: arrayOf({ type: "string" }),
      summary: { type: "string" },
      author: nullable({ type: "string" }),
      source: { type: "string", enum: ["ui", "openclaw", "agent", "system"] },
      tags: arrayOf({ type: "string" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const wikiPageListResponse = {
    type: "object",
    additionalProperties: false,
    required: ["pages", "limit", "offset", "hasMore", "nextOffset"],
    properties: {
      pages: arrayOf({ $ref: "#/components/schemas/WikiPageSummary" }),
      limit: { type: "integer", minimum: 1, maximum: 500 },
      offset: { type: "integer", minimum: 0, maximum: 9999 },
      hasMore: { type: "boolean" },
      nextOffset: nullable({ type: "integer", minimum: 0, maximum: 9999 })
    }
  };

  const wikiPageLinkInput = {
    type: "object",
    additionalProperties: false,
    required: ["entityType", "entityId"],
    properties: {
      entityType: { type: "string", minLength: 1 },
      entityId: { type: "string", minLength: 1 },
      anchorKey: nullable({ type: "string" })
    }
  };

  const wikiPageCreateInput = {
    type: "object",
    additionalProperties: false,
    required: ["contentMarkdown"],
    properties: {
      kind: { type: "string", enum: ["wiki", "evidence"], default: "wiki" },
      title: { type: "string" },
      slug: { type: "string" },
      spaceId: { type: "string" },
      parentSlug: nullable({ type: "string" }),
      indexOrder: { type: "integer", default: 0 },
      showInIndex: { type: "boolean" },
      aliases: arrayOf({ type: "string" }),
      summary: { type: "string", default: "" },
      contentMarkdown: { type: "string", minLength: 1 },
      author: nullable({ type: "string" }),
      links: arrayOf(wikiPageLinkInput),
      tags: arrayOf({ type: "string" }),
      destroyAt: nullable({ type: "string", format: "date-time" }),
      sourcePath: { type: "string" },
      frontmatter: { type: "object", additionalProperties: true },
      revisionHash: { type: "string" },
      lastSyncedAt: nullable({ type: "string", format: "date-time" }),
      userId: nullable({ type: "string", minLength: 1 })
    }
  };

  const wikiPagePatchInput = {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
      kind: { type: "string", enum: ["wiki", "evidence"] },
      title: { type: "string" },
      slug: { type: "string" },
      spaceId: { type: "string" },
      parentSlug: nullable({ type: "string" }),
      indexOrder: { type: "integer" },
      showInIndex: { type: "boolean" },
      aliases: arrayOf({ type: "string" }),
      summary: { type: "string" },
      contentMarkdown: { type: "string", minLength: 1 },
      author: nullable({ type: "string" }),
      links: arrayOf(wikiPageLinkInput),
      tags: arrayOf({ type: "string" }),
      destroyAt: nullable({ type: "string", format: "date-time" }),
      sourcePath: { type: "string" },
      frontmatter: { type: "object", additionalProperties: true },
      expectedRevisionHash: { type: "string" },
      revisionHash: { type: "string" },
      lastSyncedAt: nullable({ type: "string", format: "date-time" }),
      userId: nullable({ type: "string", minLength: 1 })
    }
  };

  const todayPriorityEvidence = {
    type: "object",
    additionalProperties: false,
    required: ["key", "label", "state", "detail"],
    properties: {
      key: {
        type: "string",
        enum: ["urgency", "schedule", "capacity", "active-context"]
      },
      label: { type: "string", minLength: 1 },
      state: {
        type: "string",
        enum: ["fresh", "stale", "missing", "loading", "error"]
      },
      detail: { type: "string", minLength: 1 }
    }
  };

  const todayRankedCandidate = {
    type: "object",
    additionalProperties: false,
    required: [
      "task",
      "score",
      "urgencyScore",
      "scheduleScore",
      "capacityScore",
      "activeContextScore",
      "hasActiveRun",
      "capacityFit",
      "requiredAp",
      "requiredApEstimated",
      "timebox",
      "evidence",
      "reason"
    ],
    properties: {
      task: { $ref: "#/components/schemas/Task" },
      score: { type: "number" },
      urgencyScore: { type: "number" },
      scheduleScore: { type: "number" },
      capacityScore: { type: "number" },
      activeContextScore: { type: "number" },
      hasActiveRun: { type: "boolean" },
      capacityFit: nullable({ type: "boolean" }),
      requiredAp: { type: "number", minimum: 0 },
      requiredApEstimated: { type: "boolean" },
      timebox: nullable({ $ref: "#/components/schemas/TaskTimebox" }),
      evidence: {
        type: "array",
        minItems: 4,
        maxItems: 4,
        items: { $ref: "#/components/schemas/TodayPriorityEvidence" }
      },
      reason: { type: "string", minLength: 1 }
    }
  };

  const todayPriorityDecision = {
    type: "object",
    additionalProperties: false,
    required: [
      "contractVersion",
      "generatedAt",
      "mode",
      "confidence",
      "decisionUserId",
      "task",
      "activeRun",
      "activeRunCount",
      "summary",
      "rankedCandidates",
      "selectedCandidate",
      "alternatives",
      "evidence",
      "blockedTaskCount",
      "needsRefresh",
      "isLoading"
    ],
    properties: {
      contractVersion: { type: "integer", enum: [1] },
      generatedAt: { type: "string", format: "date-time" },
      mode: {
        type: "string",
        enum: [
          "ready",
          "continue-active",
          "unresolved-active",
          "overloaded",
          "capacity-limited",
          "no-work"
        ]
      },
      confidence: { type: "string", enum: ["full", "limited"] },
      decisionUserId: nullable({ type: "string" }),
      task: nullable({ $ref: "#/components/schemas/Task" }),
      activeRun: nullable({ $ref: "#/components/schemas/TaskRun" }),
      activeRunCount: { type: "integer", minimum: 0 },
      summary: { type: "string", minLength: 1 },
      rankedCandidates: {
        type: "array",
        maxItems: 100,
        items: { $ref: "#/components/schemas/TodayRankedCandidate" }
      },
      selectedCandidate: nullable({
        $ref: "#/components/schemas/TodayRankedCandidate"
      }),
      alternatives: {
        type: "array",
        maxItems: 3,
        items: { $ref: "#/components/schemas/TodayRankedCandidate" }
      },
      evidence: {
        type: "array",
        minItems: 4,
        maxItems: 4,
        items: { $ref: "#/components/schemas/TodayPriorityEvidence" }
      },
      blockedTaskCount: { type: "integer", minimum: 0 },
      needsRefresh: { type: "boolean" },
      isLoading: { type: "boolean" }
    }
  };

  const wikiSearchInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      spaceId: { type: "string" },
      kind: { type: "string", enum: ["wiki", "evidence"] },
      mode: {
        type: "string",
        enum: ["text", "semantic", "entity", "hybrid"],
        default: "hybrid"
      },
      query: {
        type: "string",
        maxLength: 500,
        default: "",
        description:
          "Free-text query. Full-text retrieval uses at most the first 20 alphanumeric tokens."
      },
      profileId: { type: "string" },
      linkedEntity: {
        type: "object",
        additionalProperties: false,
        required: ["entityType", "entityId"],
        properties: {
          entityType: { type: "string" },
          entityId: { type: "string", minLength: 1 }
        }
      },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      offset: { type: "integer", minimum: 0, maximum: 999, default: 0 }
    }
  };

  const wikiSearchResult = {
    type: "object",
    additionalProperties: false,
    required: ["page", "score", "matchKind", "snippet"],
    properties: {
      page: { $ref: "#/components/schemas/WikiPageSummary" },
      score: { type: "number" },
      matchKind: {
        type: "string",
        enum: ["title", "alias", "content", "entity", "semantic", "recent"]
      },
      snippet: { type: "string", maxLength: 240 }
    }
  };

  const wikiSearchResponse = {
    type: "object",
    additionalProperties: false,
    required: [
      "mode",
      "profileId",
      "limit",
      "offset",
      "hasMore",
      "nextOffset",
      "warnings",
      "results"
    ],
    properties: {
      mode: {
        type: "string",
        enum: ["text", "semantic", "entity", "hybrid"]
      },
      profileId: nullable({ type: "string" }),
      limit: { type: "integer", minimum: 1, maximum: 50 },
      offset: { type: "integer", minimum: 0, maximum: 999 },
      hasMore: { type: "boolean" },
      nextOffset: nullable({ type: "integer", minimum: 0, maximum: 999 }),
      warnings: arrayOf({ type: "string" }),
      results: arrayOf({ $ref: "#/components/schemas/WikiSearchResult" })
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

  const agentBootstrapPolicy = {
    type: "object",
    additionalProperties: false,
    required: [
      "mode",
      "goalsLimit",
      "projectsLimit",
      "tasksLimit",
      "habitsLimit",
      "strategiesLimit",
      "peoplePageLimit",
      "includePeoplePages"
    ],
    properties: {
      mode: {
        type: "string",
        enum: ["disabled", "active_only", "scoped", "full"]
      },
      goalsLimit: { type: "integer", minimum: 0, maximum: 100 },
      projectsLimit: { type: "integer", minimum: 0, maximum: 100 },
      tasksLimit: { type: "integer", minimum: 0, maximum: 100 },
      habitsLimit: { type: "integer", minimum: 0, maximum: 100 },
      strategiesLimit: { type: "integer", minimum: 0, maximum: 100 },
      peoplePageLimit: { type: "integer", minimum: 0, maximum: 50 },
      includePeoplePages: { type: "boolean" }
    }
  };

  const agentScopePolicy = {
    type: "object",
    additionalProperties: false,
    required: ["userIds", "projectIds", "tagIds"],
    properties: {
      userIds: arrayOf({ type: "string" }),
      projectIds: arrayOf({ type: "string" }),
      tagIds: arrayOf({ type: "string" })
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
      "bootstrapPolicy",
      "scopePolicy",
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
      bootstrapPolicy: { $ref: "#/components/schemas/AgentBootstrapPolicy" },
      scopePolicy: { $ref: "#/components/schemas/AgentScopePolicy" },
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

  const nestedTaskNoteInput = {
    type: "object",
    additionalProperties: false,
    required: ["contentMarkdown"],
    properties: {
      kind: { type: "string", enum: ["evidence", "wiki"], default: "evidence" },
      title: { type: "string" },
      slug: { type: "string" },
      spaceId: { type: "string" },
      parentSlug: nullable({ type: "string" }),
      indexOrder: { type: "integer", default: 0 },
      showInIndex: { type: "boolean" },
      aliases: { type: "array", uniqueItems: true, items: { type: "string" } },
      summary: { type: "string", default: "" },
      contentMarkdown: { type: "string", minLength: 1 },
      author: nullable({ type: "string" }),
      links: {
        type: "array",
        maxItems: 64,
        items: { $ref: "#/components/schemas/CloseoutNoteLinkInput" }
      },
      tags: {
        type: "array",
        maxItems: 24,
        uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 80 }
      },
      destroyAt: nullable({ type: "string", format: "date-time" }),
      sourcePath: { type: "string", default: "" },
      frontmatter: { type: "object", additionalProperties: true }
    }
  };

  const taskMutationProperties = {
    title: { type: "string", minLength: 1 },
    description: { type: "string", default: "" },
    level: {
      type: "string",
      enum: ["issue", "task", "subtask"],
      default: "task"
    },
    status: {
      type: "string",
      enum: ["backlog", "focus", "in_progress", "blocked", "done"],
      default: "backlog"
    },
    priority: {
      type: "string",
      enum: ["low", "medium", "high", "critical"],
      default: "medium"
    },
    owner: { type: "string", minLength: 1, default: "Albert" },
    userId: nullable({ type: "string", minLength: 1 }),
    assigneeUserIds: {
      type: "array",
      uniqueItems: true,
      items: { type: "string", minLength: 1 }
    },
    goalId: nullable({ type: "string", minLength: 1 }),
    projectId: nullable({ type: "string", minLength: 1 }),
    parentWorkItemId: nullable({ type: "string", minLength: 1 }),
    dueDate: nullable({ type: "string", format: "date" }),
    effort: {
      type: "string",
      enum: ["light", "deep", "marathon"],
      default: "deep"
    },
    energy: {
      type: "string",
      enum: ["low", "steady", "high"],
      default: "steady"
    },
    points: { type: "integer", minimum: 5, maximum: 500, default: 40 },
    plannedDurationSeconds: nullable({
      type: "integer",
      minimum: 60,
      maximum: 604800
    }),
    schedulingRules: nullable({
      $ref: "#/components/schemas/CalendarSchedulingRules"
    }),
    sortOrder: { type: "integer", minimum: 0 },
    aiInstructions: { type: "string", default: "" },
    executionMode: nullable({ type: "string", enum: ["afk", "hitl"] }),
    acceptanceCriteria: {
      type: "array",
      maxItems: TASK_CLOSEOUT_LIMITS.acceptanceCriteria,
      uniqueItems: true,
      items: {
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.acceptanceCriterionLength
      }
    },
    blockerLinks: {
      type: "array",
      maxItems: TASK_CLOSEOUT_LIMITS.blockerLinks,
      items: { $ref: "#/components/schemas/WorkItemBlockerLink" }
    },
    completionReport: nullable({
      $ref: "#/components/schemas/CompletionReportInput"
    }),
    gitRefs: {
      type: "array",
      maxItems: TASK_CLOSEOUT_LIMITS.gitRefs,
      items: { $ref: "#/components/schemas/WorkItemGitRefInput" }
    },
    tagIds: {
      type: "array",
      uniqueItems: true,
      items: { type: "string" }
    },
    actionCostBand: {
      type: "string",
      enum: ["tiny", "light", "standard", "heavy", "brutal"],
      default: "standard"
    },
    notes: {
      type: "array",
      items: { $ref: "#/components/schemas/NestedTaskNoteInput" }
    }
  };
  const taskCreateInput = {
    type: "object",
    additionalProperties: false,
    required: ["title"],
    properties: taskMutationProperties
  };
  const taskPatchInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      ...taskMutationProperties,
      completedAt: { type: "string", format: "date-time" },
      resolutionKind: nullable({
        type: "string",
        enum: ["completed", "split"]
      }),
      splitParentTaskId: nullable({ type: "string" }),
      enforceTodayWorkLog: { type: "boolean" },
      completedTodayWorkSeconds: {
        type: "integer",
        minimum: 0,
        maximum: 604800
      }
    }
  };

  const operatorLogWorkInput = {
    type: "object",
    additionalProperties: false,
    anyOf: [{ required: ["taskId"] }, { required: ["title"] }],
    properties: {
      taskId: { type: "string", minLength: 1, maxLength: 256 },
      title: { type: "string", maxLength: 1000 },
      description: { type: "string", maxLength: 16000 },
      summary: {
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.workSummaryLength,
        default: ""
      },
      goalId: nullable({ type: "string", minLength: 1 }),
      projectId: nullable({ type: "string", minLength: 1 }),
      owner: { type: "string", minLength: 1 },
      userId: nullable({ type: "string", minLength: 1 }),
      status: {
        type: "string",
        enum: ["backlog", "focus", "in_progress", "blocked", "done"]
      },
      priority: {
        type: "string",
        enum: ["low", "medium", "high", "critical"]
      },
      dueDate: nullable({ type: "string", format: "date" }),
      effort: { type: "string", enum: ["light", "deep", "marathon"] },
      energy: { type: "string", enum: ["low", "steady", "high"] },
      points: { type: "integer", minimum: 5, maximum: 500 },
      tagIds: {
        type: "array",
        maxItems: 64,
        uniqueItems: true,
        items: { type: "string", maxLength: 256 }
      },
      completionReport: { $ref: "#/components/schemas/CompletionReportInput" },
      gitRefs: {
        type: "array",
        maxItems: TASK_CLOSEOUT_LIMITS.gitRefs,
        items: { $ref: "#/components/schemas/WorkItemGitRefInput" }
      },
      closeoutNote: { $ref: "#/components/schemas/CloseoutNoteInput" }
    }
  };

  const taskRunClaimInput = {
    type: "object",
    additionalProperties: false,
    required: ["actor"],
    properties: {
      actor: { type: "string", minLength: 1, maxLength: 160 },
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
      overrideReason: { type: "string", maxLength: 1000 },
      isCurrent: { type: "boolean", default: true },
      leaseTtlSeconds: {
        type: "integer",
        minimum: 1,
        maximum: 14400,
        default: 900
      },
      note: {
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.runNoteLength,
        default: ""
      },
      gitContext: nullable({
        $ref: "#/components/schemas/TaskRunGitContextInput"
      })
    }
  };

  const taskRunHeartbeatInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      actor: { type: "string", minLength: 1, maxLength: 160 },
      leaseTtlSeconds: {
        type: "integer",
        minimum: 1,
        maximum: 14400,
        default: 900
      },
      note: {
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.runNoteLength
      },
      overrideReason: { type: "string", maxLength: 1000 },
      gitContext: nullable({
        $ref: "#/components/schemas/TaskRunGitContextInput"
      })
    }
  };

  const taskRunReleaseInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      actor: { type: "string", minLength: 1, maxLength: 160 },
      note: {
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.runNoteLength,
        default: ""
      },
      closeoutNote: { $ref: "#/components/schemas/CloseoutNoteInput" }
    }
  };
  const taskRunCompleteInput = {
    ...taskRunReleaseInput,
    properties: {
      ...taskRunReleaseInput.properties,
      completionReport: { $ref: "#/components/schemas/CompletionReportInput" },
      gitRefs: {
        type: "array",
        maxItems: TASK_CLOSEOUT_LIMITS.gitRefs,
        items: { $ref: "#/components/schemas/WorkItemGitRefInput" }
      }
    }
  };

  const taskRunFocusInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      actor: { type: "string", minLength: 1 }
    }
  };

  const gitHelperRef = {
    type: "object",
    additionalProperties: false,
    required: [
      "key",
      "refType",
      "provider",
      "repository",
      "refValue",
      "url",
      "displayTitle",
      "subtitle"
    ],
    properties: {
      key: {
        type: "string",
        minLength: 1,
        maxLength: TASK_CLOSEOUT_LIMITS.gitRefValueLength + 32
      },
      refType: {
        type: "string",
        enum: ["commit", "branch", "pull_request"]
      },
      provider: {
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.gitProviderLength
      },
      repository: {
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.gitRepositoryLength
      },
      refValue: {
        type: "string",
        minLength: 1,
        maxLength: TASK_CLOSEOUT_LIMITS.gitRefValueLength
      },
      url: safeGitUrl,
      displayTitle: {
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.gitDisplayTitleLength
      },
      subtitle: {
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.gitDisplayTitleLength
      }
    }
  };
  const gitHelperOverview = {
    type: "object",
    additionalProperties: false,
    required: [
      "provider",
      "repository",
      "currentBranch",
      "baseBranch",
      "branches",
      "commits",
      "pullRequests",
      "warnings"
    ],
    properties: {
      provider: {
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.gitProviderLength
      },
      repository: {
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.gitHelperRepositoryLength
      },
      currentBranch: nullable({
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.gitRefValueLength
      }),
      baseBranch: {
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.gitRefValueLength
      },
      branches: {
        type: "array",
        maxItems: TASK_CLOSEOUT_LIMITS.gitHelperResults,
        items: { $ref: "#/components/schemas/GitHelperRef" }
      },
      commits: {
        type: "array",
        maxItems: TASK_CLOSEOUT_LIMITS.gitHelperResults,
        items: { $ref: "#/components/schemas/GitHelperRef" }
      },
      pullRequests: {
        type: "array",
        maxItems: TASK_CLOSEOUT_LIMITS.gitHelperResults,
        items: { $ref: "#/components/schemas/GitHelperRef" }
      },
      warnings: {
        type: "array",
        maxItems: TASK_CLOSEOUT_LIMITS.gitHelperWarnings,
        items: { type: "string", maxLength: 512 }
      }
    }
  };
  const gitHelperSearchResponse = {
    type: "object",
    additionalProperties: false,
    required: ["provider", "repository", "kind", "refs", "warnings"],
    properties: {
      provider: {
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.gitProviderLength
      },
      repository: {
        type: "string",
        maxLength: TASK_CLOSEOUT_LIMITS.gitHelperRepositoryLength
      },
      kind: {
        type: "string",
        enum: ["branch", "commit", "pull_request"]
      },
      refs: {
        type: "array",
        maxItems: TASK_CLOSEOUT_LIMITS.gitHelperResults,
        items: { $ref: "#/components/schemas/GitHelperRef" }
      },
      warnings: {
        type: "array",
        maxItems: TASK_CLOSEOUT_LIMITS.gitHelperWarnings,
        items: { type: "string", maxLength: 512 }
      }
    }
  };

  const habitCheckInInput = {
    type: "object",
    additionalProperties: false,
    required: ["status"],
    properties: {
      dateKey: { type: "string", format: "date", default: "2026-04-16" },
      timezone: {
        type: "string",
        description:
          "Current IANA device timezone. Used only by habits configured to follow travel."
      },
      status: { type: "string", enum: ["done", "missed"] },
      note: { type: "string", default: "" },
      description: {
        type: "string",
        description:
          "Optional replacement for the habit's current description. When provided, this overwrites habit.description."
      }
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
        enum: [
          "obsidian",
          "solar",
          "aurora",
          "ember",
          "paper",
          "dawn",
          "atelier",
          "custom",
          "system"
        ]
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
      "identityKey",
      "provider",
      "machineKey",
      "personaKey",
      "linkedUsers",
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
      identityKey: nullable({ type: "string" }),
      provider: nullable({
        type: "string",
        enum: ["openclaw", "hermes", "codex", "claude"]
      }),
      machineKey: nullable({ type: "string" }),
      personaKey: nullable({ type: "string" }),
      linkedUsers: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["userId", "role", "user"],
        properties: {
          userId: { type: "string" },
          role: { type: "string" },
          user: nullable({ $ref: "#/components/schemas/UserSummary" })
        }
      }),
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

  const agentRuntimeReconnectPlan = {
    type: "object",
    additionalProperties: false,
    required: ["summary", "commands", "notes", "automationSupported"],
    properties: {
      summary: { type: "string" },
      commands: arrayOf({ type: "string" }),
      notes: arrayOf({ type: "string" }),
      automationSupported: { type: "boolean" }
    }
  };

  const agentRuntimeSessionEvent = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "sessionId",
      "eventType",
      "level",
      "title",
      "summary",
      "metadata",
      "createdAt"
    ],
    properties: {
      id: { type: "string" },
      sessionId: { type: "string" },
      eventType: { type: "string" },
      level: { type: "string", enum: ["info", "warning", "error"] },
      title: { type: "string" },
      summary: { type: "string" },
      metadata: { type: "object", additionalProperties: true },
      createdAt: { type: "string", format: "date-time" }
    }
  };

  const agentRuntimeSession = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "agentId",
      "agentLabel",
      "agentType",
      "provider",
      "sessionKey",
      "sessionLabel",
      "actorLabel",
      "connectionMode",
      "status",
      "alive",
      "baseUrl",
      "webUrl",
      "dataRoot",
      "externalSessionId",
      "staleAfterSeconds",
      "reconnectCount",
      "reconnectRequestedAt",
      "lastError",
      "lastSeenAt",
      "lastHeartbeatAt",
      "startedAt",
      "endedAt",
      "createdAt",
      "updatedAt",
      "metadata",
      "recentEvents",
      "eventCount",
      "actionCount",
      "reconnectPlan"
    ],
    properties: {
      id: { type: "string" },
      agentId: nullable({ type: "string" }),
      agentLabel: { type: "string" },
      agentType: { type: "string" },
      provider: {
        type: "string",
        enum: ["openclaw", "hermes", "codex", "claude"]
      },
      sessionKey: { type: "string" },
      sessionLabel: { type: "string" },
      actorLabel: { type: "string" },
      connectionMode: {
        type: "string",
        enum: [
          "operator_session",
          "managed_token",
          "plugin",
          "mcp",
          "api_server",
          "unknown"
        ]
      },
      status: {
        type: "string",
        enum: ["connected", "stale", "reconnecting", "disconnected", "error"]
      },
      alive: { type: "boolean" },
      baseUrl: nullable({ type: "string" }),
      webUrl: nullable({ type: "string" }),
      dataRoot: nullable({ type: "string" }),
      externalSessionId: nullable({ type: "string" }),
      staleAfterSeconds: { type: "integer" },
      reconnectCount: { type: "integer" },
      reconnectRequestedAt: nullable({ type: "string", format: "date-time" }),
      lastError: nullable({ type: "string" }),
      lastSeenAt: { type: "string", format: "date-time" },
      lastHeartbeatAt: { type: "string", format: "date-time" },
      startedAt: { type: "string", format: "date-time" },
      endedAt: nullable({ type: "string", format: "date-time" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      metadata: { type: "object", additionalProperties: true },
      recentEvents: arrayOf({
        $ref: "#/components/schemas/AgentRuntimeSessionEvent"
      }),
      eventCount: { type: "integer" },
      actionCount: { type: "integer" },
      reconnectPlan: {
        $ref: "#/components/schemas/AgentRuntimeReconnectPlan"
      }
    }
  };

  const agentRuntimeSessionHistory = {
    type: "object",
    additionalProperties: false,
    required: ["session", "events", "actions"],
    properties: {
      session: { $ref: "#/components/schemas/AgentRuntimeSession" },
      events: arrayOf({
        $ref: "#/components/schemas/AgentRuntimeSessionEvent"
      }),
      actions: arrayOf({ $ref: "#/components/schemas/AgentAction" })
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

  const attentionInboxTarget = {
    type: "object",
    additionalProperties: false,
    required: ["entityType", "entityId", "label", "href"],
    properties: {
      entityType: nullable({ type: "string" }),
      entityId: nullable({ type: "string" }),
      label: { type: "string" },
      href: { type: "string" }
    }
  };

  const attentionPrimaryAction = {
    type: "object",
    additionalProperties: false,
    required: ["key", "label", "href", "sourceRef", "resolutionCondition"],
    properties: {
      key: {
        type: "string",
        enum: [
          "review_decision",
          "review_insight",
          "resolve_blocker",
          "review_due_work",
          "recover_companion_sync",
          "reconnect_runtime"
        ]
      },
      label: { type: "string" },
      href: {
        type: "string",
        pattern: "^/(?!/)",
        description: "Same-origin navigation target for the domain action."
      },
      sourceRef: {
        type: "string",
        description:
          "Stable, typed reference to the authoritative source record."
      },
      resolutionCondition: {
        type: "string",
        description:
          "Plain-language evidence condition Forge must confirm before issuing a receipt."
      }
    }
  };

  const attentionInboxItem = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "source",
      "kind",
      "severity",
      "state",
      "title",
      "reason",
      "detail",
      "target",
      "primaryAction",
      "allowedActions",
      "createdAt",
      "updatedAt",
      "sourceUpdatedAt",
      "dueAt",
      "snoozedUntil",
      "metadata"
    ],
    properties: {
      id: {
        type: "string",
        description:
          "Stable derived ID. Send this exact value, URL-encoded, to an attention action route."
      },
      source: {
        type: "string",
        enum: ["approval", "insight", "task", "companion_sync", "agent_session"]
      },
      kind: {
        type: "string",
        enum: [
          "decision",
          "review",
          "blocked_work",
          "overdue_work",
          "sync_problem",
          "runtime_problem"
        ]
      },
      severity: {
        type: "string",
        enum: ["notice", "important", "blocking"],
        description:
          "Evidence-derived priority. Forge does not manufacture urgency from age alone."
      },
      state: {
        type: "string",
        enum: ["active", "snoozed", "dismissed"]
      },
      title: { type: "string" },
      reason: {
        type: "string",
        description: "Why the record currently belongs in the queue."
      },
      detail: { type: "string" },
      target: { $ref: "#/components/schemas/AttentionInboxTarget" },
      primaryAction: { $ref: "#/components/schemas/AttentionPrimaryAction" },
      allowedActions: arrayOf({
        type: "string",
        enum: ["open", "approve", "reject", "snooze", "dismiss", "restore"]
      }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      sourceUpdatedAt: {
        type: "string",
        format: "date-time",
        description:
          "Version marker for the underlying evidence. A changed source automatically reactivates a previously snoozed or dismissed item."
      },
      dueAt: nullable({ type: "string" }),
      snoozedUntil: nullable({ type: "string", format: "date-time" }),
      metadata: { type: "object", additionalProperties: true }
    }
  };

  const attentionInboxSummary = {
    type: "object",
    additionalProperties: false,
    required: [
      "activeCount",
      "snoozedCount",
      "dismissedCount",
      "blockingCount",
      "importantCount",
      "sourceCounts"
    ],
    properties: {
      activeCount: { type: "integer", minimum: 0 },
      snoozedCount: { type: "integer", minimum: 0 },
      dismissedCount: { type: "integer", minimum: 0 },
      blockingCount: { type: "integer", minimum: 0 },
      importantCount: { type: "integer", minimum: 0 },
      sourceCounts: {
        type: "object",
        additionalProperties: false,
        required: [
          "approval",
          "insight",
          "task",
          "companion_sync",
          "agent_session"
        ],
        properties: {
          approval: { type: "integer", minimum: 0 },
          insight: { type: "integer", minimum: 0 },
          task: { type: "integer", minimum: 0 },
          companion_sync: { type: "integer", minimum: 0 },
          agent_session: { type: "integer", minimum: 0 }
        }
      }
    }
  };

  const attentionInboxPayload = {
    type: "object",
    additionalProperties: false,
    required: [
      "generatedAt",
      "state",
      "total",
      "offset",
      "limit",
      "hasMore",
      "summary",
      "items"
    ],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      state: {
        type: "string",
        enum: ["active", "snoozed", "dismissed"]
      },
      total: { type: "integer", minimum: 0 },
      offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      hasMore: { type: "boolean" },
      summary: { $ref: "#/components/schemas/AttentionInboxSummary" },
      items: arrayOf({ $ref: "#/components/schemas/AttentionInboxItem" })
    }
  };

  const attentionInboxStateRecord = {
    type: "object",
    additionalProperties: false,
    required: [
      "itemId",
      "state",
      "snoozedUntil",
      "sourceUpdatedAt",
      "note",
      "updatedAt"
    ],
    properties: {
      itemId: { type: "string" },
      state: {
        type: "string",
        enum: ["active", "snoozed", "dismissed"]
      },
      snoozedUntil: nullable({ type: "string", format: "date-time" }),
      sourceUpdatedAt: { type: "string", format: "date-time" },
      note: { type: "string" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const attentionResolutionAttempt = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "itemId",
      "source",
      "kind",
      "actionKey",
      "sourceRef",
      "sourceUpdatedAt",
      "title",
      "targetLabel",
      "targetHref",
      "status",
      "startedAt",
      "checkedAt"
    ],
    properties: {
      id: { type: "string", pattern: "^atra_[a-z0-9]+$" },
      itemId: { type: "string" },
      source: {
        type: "string",
        enum: ["approval", "insight", "task", "companion_sync", "agent_session"]
      },
      kind: {
        type: "string",
        enum: [
          "decision",
          "review",
          "blocked_work",
          "overdue_work",
          "sync_problem",
          "runtime_problem"
        ]
      },
      actionKey: {
        type: "string",
        enum: [
          "review_decision",
          "review_insight",
          "resolve_blocker",
          "review_due_work",
          "recover_companion_sync",
          "reconnect_runtime"
        ]
      },
      sourceRef: { type: "string" },
      sourceUpdatedAt: { type: "string", format: "date-time" },
      title: { type: "string" },
      targetLabel: { type: "string" },
      targetHref: { type: "string", pattern: "^/(?!/)" },
      status: {
        type: "string",
        enum: ["pending", "resolved", "unavailable"]
      },
      startedAt: { type: "string", format: "date-time" },
      checkedAt: nullable({ type: "string", format: "date-time" })
    }
  };

  const attentionResolutionReceipt = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "attemptId",
      "itemId",
      "source",
      "kind",
      "actionKey",
      "sourceRef",
      "sourceUpdatedAt",
      "title",
      "targetLabel",
      "targetHref",
      "evidenceCode",
      "evidenceSummary",
      "activityEventId",
      "resolvedAt"
    ],
    properties: {
      id: { type: "string", pattern: "^atrr_[a-z0-9]+$" },
      attemptId: { type: "string" },
      itemId: { type: "string" },
      source: {
        type: "string",
        enum: ["approval", "insight", "task", "companion_sync", "agent_session"]
      },
      kind: {
        type: "string",
        enum: [
          "decision",
          "review",
          "blocked_work",
          "overdue_work",
          "sync_problem",
          "runtime_problem"
        ]
      },
      actionKey: {
        type: "string",
        enum: [
          "review_decision",
          "review_insight",
          "resolve_blocker",
          "review_due_work",
          "recover_companion_sync",
          "reconnect_runtime"
        ]
      },
      sourceRef: { type: "string" },
      sourceUpdatedAt: { type: "string", format: "date-time" },
      title: { type: "string" },
      targetLabel: { type: "string" },
      targetHref: { type: "string", pattern: "^/(?!/)" },
      evidenceCode: { type: "string" },
      evidenceSummary: { type: "string" },
      activityEventId: { type: "string" },
      resolvedAt: { type: "string", format: "date-time" }
    }
  };

  const attentionResolutionStartResult = {
    type: "object",
    additionalProperties: false,
    required: ["attempt", "primaryAction", "replayed"],
    properties: {
      attempt: { $ref: "#/components/schemas/AttentionResolutionAttempt" },
      primaryAction: { $ref: "#/components/schemas/AttentionPrimaryAction" },
      replayed: { type: "boolean" }
    }
  };

  const attentionResolutionCheckResult = {
    type: "object",
    additionalProperties: false,
    required: ["attemptId", "itemId", "status", "explanation", "receipt"],
    properties: {
      attemptId: { type: "string" },
      itemId: { type: "string" },
      status: {
        type: "string",
        enum: ["resolved", "still_open", "stale", "deleted", "denied"]
      },
      explanation: { type: "string" },
      receipt: nullable({
        $ref: "#/components/schemas/AttentionResolutionReceipt"
      })
    }
  };

  const attentionResolutionCheckResponse = {
    type: "object",
    additionalProperties: false,
    required: ["results", "receipts"],
    properties: {
      results: arrayOf({
        $ref: "#/components/schemas/AttentionResolutionCheckResult"
      }),
      receipts: arrayOf({
        $ref: "#/components/schemas/AttentionResolutionReceipt"
      })
    }
  };

  const attentionResolutionList = {
    type: "object",
    additionalProperties: false,
    required: ["receipts", "total", "limit", "retention"],
    properties: {
      receipts: arrayOf({
        $ref: "#/components/schemas/AttentionResolutionReceipt"
      }),
      total: { type: "integer", minimum: 0, maximum: 5000 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      retention: {
        type: "object",
        additionalProperties: false,
        required: ["days", "maxPerActor"],
        properties: {
          days: { type: "integer", enum: [365] },
          maxPerActor: { type: "integer", enum: [5000] }
        }
      }
    }
  };

  const mutationReceipt = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "operation",
      "targetType",
      "targetId",
      "targetLabel",
      "ownerUserId",
      "summary",
      "status",
      "reversible",
      "explanation",
      "expiresAt",
      "createdAt",
      "undoneAt"
    ],
    properties: {
      id: { type: "string", pattern: "^mrc_[a-z0-9]+$" },
      operation: {
        type: "string",
        enum: [
          "entity_update",
          "entity_soft_delete",
          "entity_hard_delete",
          "task_update",
          "attention_state"
        ]
      },
      targetType: { type: "string" },
      targetId: { type: "string" },
      targetLabel: { type: "string" },
      ownerUserId: nullable({ type: "string" }),
      summary: { type: "string" },
      status: {
        type: "string",
        enum: ["available", "undone", "expired", "conflicted", "not_reversible"]
      },
      reversible: { type: "boolean" },
      explanation: { type: "string" },
      expiresAt: nullable({ type: "string", format: "date-time" }),
      createdAt: { type: "string", format: "date-time" },
      undoneAt: nullable({ type: "string", format: "date-time" })
    }
  };

  const offlineTaskMutationInput = {
    type: "object",
    additionalProperties: false,
    required: [
      "version",
      "sessionId",
      "idempotencyKey",
      "action",
      "taskId",
      "expectedUpdatedAt",
      "status"
    ],
    properties: {
      version: { type: "integer", const: 1 },
      sessionId: { type: "string", minLength: 1, maxLength: 200 },
      idempotencyKey: { type: "string", minLength: 1, maxLength: 128 },
      action: { type: "string", const: "task_status" },
      taskId: { type: "string", minLength: 1, maxLength: 200 },
      expectedUpdatedAt: { type: "string", format: "date-time" },
      status: {
        type: "string",
        enum: ["backlog", "focus", "in_progress", "blocked"]
      }
    }
  };

  const offlineTaskMutationReceipt = {
    type: "object",
    additionalProperties: false,
    required: [
      "version",
      "idempotencyKey",
      "action",
      "status",
      "summary",
      "task",
      "current",
      "mutationReceipt",
      "receivedAt"
    ],
    properties: {
      version: { type: "integer", const: 1 },
      idempotencyKey: { type: "string", minLength: 1, maxLength: 128 },
      action: { type: "string", const: "task_status" },
      status: {
        type: "string",
        enum: ["accepted", "conflicted", "rejected"]
      },
      summary: { type: "string" },
      task: nullable({
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "status", "updatedAt"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          status: {
            type: "string",
            enum: ["backlog", "focus", "in_progress", "blocked", "done"]
          },
          updatedAt: { type: "string", format: "date-time" }
        }
      }),
      current: nullable({
        type: "object",
        additionalProperties: false,
        required: ["status", "updatedAt"],
        properties: {
          status: {
            type: "string",
            enum: ["backlog", "focus", "in_progress", "blocked", "done"]
          },
          updatedAt: { type: "string", format: "date-time" }
        }
      }),
      mutationReceipt: nullable({
        $ref: "#/components/schemas/MutationReceipt"
      }),
      receivedAt: { type: "string", format: "date-time" }
    }
  };

  const offlineTaskMutationResponse = {
    type: "object",
    additionalProperties: false,
    required: ["receipt", "replayed"],
    properties: {
      receipt: { $ref: "#/components/schemas/OfflineTaskMutationReceipt" },
      replayed: { type: "boolean" }
    }
  };

  const entityNavigationItem = {
    type: "object",
    additionalProperties: false,
    required: [
      "pinId",
      "entityType",
      "entityId",
      "title",
      "detail",
      "category",
      "targetPath",
      "ownerUserId",
      "availability",
      "pinnedAt",
      "lastViewedAt",
      "viewCount"
    ],
    properties: {
      pinId: nullable({ type: "string" }),
      entityType: { $ref: "#/components/schemas/CrudEntityType" },
      entityId: { type: "string" },
      title: { type: "string" },
      detail: { type: "string" },
      category: { type: "string" },
      targetPath: {
        ...nullable({ type: "string" }),
        description:
          "Relative Forge web path. Deleted pins point to the settings bin; genuinely missing pins have no target path."
      },
      ownerUserId: nullable({ type: "string" }),
      availability: {
        type: "string",
        enum: ["available", "deleted", "missing"]
      },
      pinnedAt: nullable({ type: "string", format: "date-time" }),
      lastViewedAt: nullable({ type: "string", format: "date-time" }),
      viewCount: { type: "integer", minimum: 0 }
    }
  };

  const entityNavigationPayload = {
    type: "object",
    additionalProperties: false,
    required: [
      "generatedAt",
      "pinnedTotal",
      "recentTotal",
      "hiddenRecentCount",
      "pinned",
      "recent"
    ],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      pinnedTotal: { type: "integer", minimum: 0 },
      recentTotal: { type: "integer", minimum: 0 },
      hiddenRecentCount: {
        type: "integer",
        minimum: 0,
        description:
          "Recently viewed references hidden because the target is pinned, unavailable, or outside the caller's scope."
      },
      pinned: arrayOf({ $ref: "#/components/schemas/EntityNavigationItem" }),
      recent: arrayOf({ $ref: "#/components/schemas/EntityNavigationItem" })
    }
  };

  const entityNavigationPinInput = {
    type: "object",
    additionalProperties: false,
    required: ["entityType", "entityId"],
    properties: {
      entityType: { $ref: "#/components/schemas/CrudEntityType" },
      entityId: { type: "string", minLength: 1 },
      ownerUserId: nullable({ type: "string", minLength: 1 })
    }
  };

  const entityNavigationTouchInput = {
    type: "object",
    additionalProperties: false,
    required: ["entityType", "entityId"],
    properties: {
      entityType: { $ref: "#/components/schemas/CrudEntityType" },
      entityId: { type: "string", minLength: 1 }
    }
  };

  const actionBarFilterId = {
    type: "string",
    enum: [
      "goal",
      "project",
      "task",
      "strategy",
      "habit",
      "note",
      "wiki_page",
      "calendar_event",
      "psyche_value",
      "behavior_pattern",
      "behavior",
      "belief_entry",
      "mode_profile",
      "flashcard",
      "trigger_report"
    ]
  };

  const savedView = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "ownerUserId",
      "name",
      "query",
      "filterIds",
      "scopeMode",
      "scopeUserIds",
      "unavailableFilterIds",
      "unavailableScopeUserIds",
      "compatibility",
      "schemaVersion",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string", pattern: "^svw_[a-z0-9]+$" },
      ownerUserId: { type: "string" },
      name: { type: "string", minLength: 1, maxLength: 80 },
      query: { type: "string", maxLength: 200 },
      filterIds: { ...arrayOf(actionBarFilterId), maxItems: 16 },
      scopeMode: { type: "string", enum: ["all", "selected"] },
      scopeUserIds: { ...arrayOf({ type: "string" }), maxItems: 100 },
      unavailableFilterIds: {
        ...arrayOf({ type: "string" }),
        maxItems: 100
      },
      unavailableScopeUserIds: {
        ...arrayOf({ type: "string" }),
        maxItems: 100
      },
      compatibility: {
        type: "string",
        enum: ["ready", "unsupported"]
      },
      schemaVersion: { type: "integer", minimum: 1 },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const savedViewCreateInput = {
    type: "object",
    additionalProperties: false,
    required: ["ownerUserId", "name", "scopeMode"],
    properties: {
      ownerUserId: { type: "string", minLength: 1 },
      name: { type: "string", minLength: 1, maxLength: 80 },
      query: { type: "string", maxLength: 200, default: "" },
      filterIds: { ...arrayOf(actionBarFilterId), maxItems: 16 },
      scopeMode: { type: "string", enum: ["all", "selected"] },
      scopeUserIds: { ...arrayOf({ type: "string" }), maxItems: 100 }
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

  const gamificationCatalogItem = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "kind",
      "category",
      "tier",
      "difficulty",
      "hidden",
      "title",
      "summary",
      "requirement",
      "requirementText",
      "reward",
      "unlockType",
      "rewardPayload",
      "assetKey",
      "sheetKey",
      "rarity",
      "sortOrder"
    ],
    properties: {
      id: { type: "string" },
      kind: { type: "string", enum: ["trophy", "unlock"] },
      category: {
        type: "string",
        enum: [
          "xp_levels",
          "streaks",
          "tasks",
          "projects",
          "habits",
          "psyche",
          "wiki",
          "agents"
        ]
      },
      tier: { type: "string", enum: ["bronze", "silver", "gold", "platinum"] },
      difficulty: {
        type: "string",
        enum: ["intro", "standard", "hard", "legendary"]
      },
      hidden: { type: "boolean" },
      title: { type: "string" },
      summary: { type: "string" },
      requirement: {
        type: "object",
        additionalProperties: true,
        description:
          "Typed requirement: atomic metric threshold, allOf, or anyOf composite gate."
      },
      requirementText: { type: "string" },
      reward: { type: "string" },
      unlockType: nullable({
        type: "string",
        enum: [
          "mascot_skin",
          "mascot_pose",
          "hud_treatment",
          "streak_effect",
          "trophy_shelf",
          "icon_frame",
          "celebration_variant"
        ]
      }),
      rewardPayload: { type: "object", additionalProperties: true },
      assetKey: { type: "string" },
      sheetKey: { type: "string" },
      rarity: { type: "string", enum: ["common", "rare", "epic", "legendary"] },
      sortOrder: { type: "integer" }
    }
  };

  const gamificationCatalogEntry = {
    allOf: [
      { $ref: "#/components/schemas/GamificationCatalogItem" },
      {
        type: "object",
        required: [
          "unlocked",
          "unlockedAt",
          "progressCurrent",
          "progressTarget",
          "progressPercent",
          "celebrationSeenAt"
        ],
        properties: {
          unlocked: { type: "boolean" },
          unlockedAt: nullable({ type: "string", format: "date-time" }),
          progressCurrent: { type: "integer" },
          progressTarget: { type: "integer" },
          progressPercent: { type: "number" },
          celebrationSeenAt: nullable({ type: "string", format: "date-time" })
        }
      }
    ]
  };

  const gamificationMascotState = {
    type: "object",
    additionalProperties: false,
    required: [
      "mood",
      "spriteKey",
      "streakSpriteKey",
      "headline",
      "line",
      "pressureLevel",
      "missedDays",
      "lastActiveDateKey"
    ],
    properties: {
      mood: {
        type: "string",
        enum: [
          "idle",
          "forging",
          "wise",
          "celebrating",
          "pressure",
          "comeback",
          "exhausted",
          "proud",
          "absent"
        ]
      },
      spriteKey: { type: "string" },
      streakSpriteKey: { type: "string" },
      headline: { type: "string" },
      line: { type: "string" },
      pressureLevel: { type: "integer" },
      missedDays: { type: "integer" },
      lastActiveDateKey: nullable({ type: "string" })
    }
  };

  const gamificationEquipment = {
    type: "object",
    additionalProperties: false,
    required: [
      "selectedMascotSkin",
      "selectedHudTreatment",
      "selectedStreakEffect",
      "selectedTrophyShelf",
      "selectedCelebrationVariant",
      "updatedAt"
    ],
    properties: {
      selectedMascotSkin: nullable({ type: "string" }),
      selectedHudTreatment: nullable({ type: "string" }),
      selectedStreakEffect: nullable({ type: "string" }),
      selectedTrophyShelf: nullable({ type: "string" }),
      selectedCelebrationVariant: nullable({ type: "string" }),
      updatedAt: nullable({ type: "string", format: "date-time" })
    }
  };

  const gamificationCelebration = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "userId",
      "kind",
      "itemId",
      "title",
      "summary",
      "assetKey",
      "metadata",
      "createdAt",
      "seenAt"
    ],
    properties: {
      id: { type: "string" },
      userId: { type: "string" },
      kind: {
        type: "string",
        enum: ["xp", "level", "trophy", "unlock", "streak", "comeback"]
      },
      itemId: nullable({ type: "string" }),
      title: { type: "string" },
      summary: { type: "string" },
      assetKey: { type: "string" },
      metadata: { type: "object", additionalProperties: true },
      createdAt: { type: "string", format: "date-time" },
      seenAt: nullable({ type: "string", format: "date-time" })
    }
  };

  const gamificationScope = {
    type: "object",
    additionalProperties: false,
    required: ["mode", "userIds", "users", "label"],
    properties: {
      mode: {
        type: "string",
        enum: ["selected_user", "operator_fallback", "aggregate_fallback"]
      },
      userIds: arrayOf({ type: "string" }),
      users: arrayOf({ $ref: "#/components/schemas/UserSummary" }),
      label: { type: "string" }
    }
  };

  const gamificationCatalogPayload = {
    type: "object",
    additionalProperties: false,
    required: [
      "scope",
      "equipment",
      "items",
      "totalCount",
      "unlockedCount",
      "trophyCount",
      "unlockCount",
      "nextUnlock",
      "newestUnlock",
      "nextTargets",
      "recentlyUnlocked"
    ],
    properties: {
      scope: { $ref: "#/components/schemas/GamificationScope" },
      equipment: { $ref: "#/components/schemas/GamificationEquipment" },
      items: arrayOf({ $ref: "#/components/schemas/GamificationCatalogEntry" }),
      totalCount: { type: "integer" },
      unlockedCount: { type: "integer" },
      trophyCount: { type: "integer" },
      unlockCount: { type: "integer" },
      nextUnlock: nullable({
        $ref: "#/components/schemas/GamificationCatalogEntry"
      }),
      newestUnlock: nullable({
        $ref: "#/components/schemas/GamificationCatalogEntry"
      }),
      nextTargets: arrayOf({
        $ref: "#/components/schemas/GamificationCatalogEntry"
      }),
      recentlyUnlocked: arrayOf({
        $ref: "#/components/schemas/GamificationCatalogEntry"
      })
    }
  };

  const xpMetricsPayload = {
    type: "object",
    additionalProperties: false,
    required: [
      "timezone",
      "scope",
      "profile",
      "achievements",
      "milestoneRewards",
      "momentumPulse",
      "catalogPreview",
      "unlockedItemCount",
      "totalItemCount",
      "nextUnlock",
      "newestUnlock",
      "nextTargets",
      "equipment",
      "mascot",
      "celebrations",
      "recentLedger",
      "rules",
      "dailyAmbientXp",
      "dailyAmbientCap"
    ],
    properties: {
      timezone: {
        type: "string",
        description:
          "Validated IANA timezone used for daily streak and weekly XP boundaries."
      },
      scope: { $ref: "#/components/schemas/GamificationScope" },
      profile: { $ref: "#/components/schemas/GamificationProfile" },
      achievements: arrayOf({ $ref: "#/components/schemas/AchievementSignal" }),
      milestoneRewards: arrayOf({
        $ref: "#/components/schemas/MilestoneReward"
      }),
      momentumPulse: { $ref: "#/components/schemas/XpMomentumPulse" },
      catalogPreview: arrayOf({
        $ref: "#/components/schemas/GamificationCatalogEntry"
      }),
      unlockedItemCount: { type: "integer" },
      totalItemCount: { type: "integer" },
      nextUnlock: nullable({
        $ref: "#/components/schemas/GamificationCatalogEntry"
      }),
      newestUnlock: nullable({
        $ref: "#/components/schemas/GamificationCatalogEntry"
      }),
      nextTargets: arrayOf({
        $ref: "#/components/schemas/GamificationCatalogEntry"
      }),
      equipment: { $ref: "#/components/schemas/GamificationEquipment" },
      mascot: { $ref: "#/components/schemas/GamificationMascotState" },
      celebrations: arrayOf({
        $ref: "#/components/schemas/GamificationCelebration"
      }),
      recentLedger: arrayOf({ $ref: "#/components/schemas/RewardLedgerEvent" }),
      rules: arrayOf({ $ref: "#/components/schemas/RewardRule" }),
      dailyAmbientXp: { type: "integer" },
      dailyAmbientCap: { type: "integer" }
    }
  };

  const derivedDataProvenance = {
    type: "object",
    additionalProperties: false,
    required: [
      "generatedAt",
      "observedAt",
      "freshness",
      "completeness",
      "staleAfterSeconds",
      "sourceSummary",
      "statusDetail",
      "confidence",
      "sources",
      "evidence"
    ],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      observedAt: nullable({ type: "string", format: "date-time" }),
      freshness: {
        type: "string",
        enum: ["fresh", "stale", "future", "missing"]
      },
      completeness: {
        type: "string",
        enum: ["complete", "partial", "unknown"]
      },
      staleAfterSeconds: { type: "integer", minimum: 1 },
      sourceSummary: { type: "string" },
      statusDetail: { type: "string" },
      confidence: {
        type: "object",
        additionalProperties: false,
        required: ["level", "reason"],
        properties: {
          level: {
            type: "string",
            enum: ["high", "medium", "low", "unknown"]
          },
          reason: { type: "string" }
        }
      },
      sources: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "kind", "observedAt", "detailRoute"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          kind: {
            type: "string",
            enum: ["record", "aggregate", "derived", "device", "service"]
          },
          observedAt: nullable({ type: "string", format: "date-time" }),
          detailRoute: nullable({ type: "string" })
        }
      }),
      evidence: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["label", "reference", "observedAt"],
        properties: {
          label: { type: "string" },
          reference: { type: "string" },
          observedAt: nullable({ type: "string", format: "date-time" })
        }
      })
    }
  };

  const dailyBriefingStatement = {
    type: "object",
    additionalProperties: false,
    required: ["id", "text", "href", "observedAt", "freshness", "provenance"],
    properties: {
      id: { type: "string", minLength: 1, maxLength: 120 },
      text: { type: "string", minLength: 1, maxLength: 500 },
      href: nullable({ type: "string", minLength: 1, maxLength: 500 }),
      observedAt: nullable({ type: "string", format: "date-time" }),
      freshness: {
        type: "string",
        enum: ["fresh", "stale", "future", "missing"]
      },
      provenance: { $ref: "#/components/schemas/DerivedDataProvenance" }
    }
  };

  const dailyBriefingSection = {
    type: "object",
    additionalProperties: false,
    required: [
      "key",
      "label",
      "status",
      "statements",
      "omissionReason",
      "inspectedCount",
      "availableCount"
    ],
    properties: {
      key: {
        type: "string",
        enum: ["work", "schedule", "capacity", "recent_activity"]
      },
      label: { type: "string", minLength: 1, maxLength: 120 },
      status: {
        type: "string",
        enum: [
          "ready",
          "empty",
          "partial",
          "stale",
          "future",
          "conflict",
          "omitted"
        ]
      },
      statements: {
        type: "array",
        maxItems: 3,
        items: { $ref: "#/components/schemas/DailyBriefingStatement" }
      },
      omissionReason: nullable({
        type: "string",
        minLength: 1,
        maxLength: 500
      }),
      inspectedCount: { type: "integer", minimum: 0 },
      availableCount: { type: "integer", minimum: 0 }
    }
  };

  const dailyBriefing = {
    type: "object",
    additionalProperties: false,
    required: [
      "contractVersion",
      "generatedAt",
      "dateKey",
      "timeZone",
      "ownerUserId",
      "status",
      "headline",
      "sections"
    ],
    properties: {
      contractVersion: { type: "integer", enum: [1] },
      generatedAt: { type: "string", format: "date-time" },
      dateKey: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      timeZone: {
        type: "string",
        minLength: 1,
        maxLength: 100,
        description:
          "Validated IANA timezone used for local-day calendar and capacity boundaries."
      },
      ownerUserId: { type: "string", minLength: 1, maxLength: 240 },
      status: {
        type: "string",
        enum: ["ready", "partial", "conflict", "empty"]
      },
      headline: { type: "string", minLength: 1, maxLength: 500 },
      sections: {
        type: "array",
        minItems: 4,
        maxItems: 4,
        description:
          "Exactly four ordered lanes: work, schedule, capacity, and recent activity. The complete JSON response is capped at 64 KiB.",
        items: { $ref: "#/components/schemas/DailyBriefingSection" }
      }
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
      "provenance",
      "detailMode",
      "summary",
      "signalMatrix",
      "snapshot",
      "operator",
      "today",
      "yesterday",
      "calendar",
      "notes",
      "sleep",
      "fitness",
      "trainingLoad",
      "vitals",
      "lifeForce",
      "domains",
      "psyche",
      "onboarding",
      "capabilities",
      "warnings",
      "routeGuide"
    ],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      provenance: { $ref: "#/components/schemas/DerivedDataProvenance" },
      detailMode: { type: "string", enum: ["compact"] },
      summary: { type: "string" },
      signalMatrix: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["lane", "signal", "ids"],
        properties: {
          lane: { type: "string" },
          signal: { type: "string" },
          ids: arrayOf({ type: "string" })
        }
      }),
      snapshot: {
        type: "object",
        additionalProperties: true,
        description:
          "Compact strategic snapshot with counts, active goals/projects/tasks, short summaries, IDs, and /api/v1/context as the full drill-down route."
      },
      operator: {
        type: "object",
        additionalProperties: true,
        description:
          "Compact operator context with focus tasks, board counts, XP summary, recent activity, recent task runs, IDs, and /api/v1/operator/context as the full drill-down route."
      },
      today: {
        type: "object",
        additionalProperties: true,
        description:
          "Compact today context with directive, timeline summaries, habits, quests, and momentum."
      },
      yesterday: {
        type: "object",
        additionalProperties: true,
        description: "Compact yesterday context using the same shape as today."
      },
      calendar: {
        type: "object",
        additionalProperties: true,
        description:
          "Two-day calendar digest for today and yesterday with every same-day event, work-block, and timebox represented as compact ID/title/time records."
      },
      notes: {
        type: "object",
        additionalProperties: true,
        description:
          "Recent observed/updated note digest with IDs, titles, tags, links, and short previews. Full note bodies are intentionally omitted."
      },
      sleep: {
        type: "object",
        additionalProperties: true,
        description:
          "Compact sleep summary with latest night, trends, recent session IDs, and the full sleep route."
      },
      fitness: {
        type: "object",
        additionalProperties: true,
        description:
          "Compact sports summary with recent workout IDs and the full fitness route."
      },
      trainingLoad: {
        type: "object",
        additionalProperties: true,
        description:
          "Compact cardiovascular training-load summary with acute/chronic load, intensity distribution, and the full training-load route."
      },
      vitals: {
        type: "object",
        additionalProperties: true,
        description:
          "Compact vitals summary with latest metric values and the full vitals route."
      },
      lifeForce: {
        type: "object",
        additionalProperties: true,
        description:
          "Compact Life Force state for today's AP budget, drains, warnings, and recommendations."
      },
      domains: arrayOf({
        type: "object",
        additionalProperties: true
      }),
      psyche: nullable({
        type: "object",
        additionalProperties: true,
        description:
          "Compact Psyche digest with counts, values, patterns, beliefs, modes, recent reports, schema pressure, committed actions, IDs, and /api/v1/psyche/overview as the full drill-down route."
      }),
      onboarding: {
        type: "object",
        additionalProperties: true,
        description:
          "Compact onboarding subset with base URLs, effective scope policy, route families, and /api/v1/agents/onboarding as the full onboarding route."
      },
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
        enum: [
          "obsidian",
          "solar",
          "aurora",
          "ember",
          "paper",
          "dawn",
          "atelier",
          "custom",
          "system"
        ]
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

  const doctorFixProposal = {
    type: "object",
    additionalProperties: false,
    required: ["id", "kind", "title", "description", "requiresConfirmation"],
    properties: {
      id: { type: "string" },
      kind: { type: "string", enum: ["manual", "safe_auto_fix"] },
      title: { type: "string" },
      description: { type: "string" },
      requiresConfirmation: { type: "boolean" }
    }
  };

  const doctorCheck = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "group",
      "title",
      "status",
      "severity",
      "summary",
      "evidence",
      "affectedCount"
    ],
    properties: {
      id: { type: "string" },
      group: { type: "string" },
      title: { type: "string" },
      status: { type: "string", enum: ["pass", "warn", "fail", "skipped"] },
      severity: { type: "string", enum: ["info", "warning", "error"] },
      summary: { type: "string" },
      evidence: arrayOf({ type: "string" }),
      affectedCount: { type: "integer" },
      fix: { $ref: "#/components/schemas/DoctorFixProposal" }
    }
  };

  const forgeDoctorReport = {
    type: "object",
    additionalProperties: true,
    required: [
      "ok",
      "now",
      "integrity",
      "runtime",
      "health",
      "settingsFile",
      "settingsSummary",
      "checks",
      "issues",
      "fixProposals",
      "warnings"
    ],
    properties: {
      ok: { type: "boolean" },
      now: { type: "string", format: "date-time" },
      integrity: {
        type: "object",
        additionalProperties: true,
        required: ["score", "status", "headline", "lastCheckedAt"],
        properties: {
          score: { type: "integer" },
          status: { type: "string", enum: ["healthy", "warning", "critical"] },
          headline: { type: "string" },
          lastCheckedAt: { type: "string", format: "date-time" }
        }
      },
      runtime: { type: "object", additionalProperties: true },
      health: { type: "object", additionalProperties: true },
      settingsFile: { type: "object", additionalProperties: true },
      settingsSummary: { type: "object", additionalProperties: true },
      checks: arrayOf({ $ref: "#/components/schemas/DoctorCheck" }),
      issues: arrayOf({ $ref: "#/components/schemas/DoctorCheck" }),
      fixProposals: arrayOf({
        $ref: "#/components/schemas/DoctorFixProposal"
      }),
      warnings: arrayOf({ type: "string" })
    }
  };

  const doctorFixResult = {
    type: "object",
    additionalProperties: false,
    required: ["fixId", "status", "summary"],
    properties: {
      fixId: { type: "string" },
      status: { type: "string", enum: ["applied", "skipped", "failed"] },
      summary: { type: "string" }
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
      "defaultBootstrapPolicy",
      "effectiveBootstrapPolicy",
      "defaultScopePolicy",
      "effectiveScopePolicy",
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
      defaultBootstrapPolicy: {
        $ref: "#/components/schemas/AgentBootstrapPolicy"
      },
      effectiveBootstrapPolicy: {
        $ref: "#/components/schemas/AgentBootstrapPolicy"
      },
      defaultScopePolicy: {
        $ref: "#/components/schemas/AgentScopePolicy"
      },
      effectiveScopePolicy: {
        $ref: "#/components/schemas/AgentScopePolicy"
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
          "weightLoss",
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
          weightLoss: { type: "string" },
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
          "flashcard",
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
          flashcard: { type: "string" },
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
          "openingQuestion",
          "askSequence",
          "requiredForCreate",
          "highValueOptionalFields",
          "exampleQuestions",
          "notes",
          "routePosture",
          "apiAccessHint"
        ],
        properties: {
          focus: { type: "string" },
          useWhen: { type: "string" },
          coachingGoal: { type: "string" },
          openingQuestion: { type: "string" },
          askSequence: arrayOf({ type: "string" }),
          requiredForCreate: arrayOf({ type: "string" }),
          highValueOptionalFields: arrayOf({ type: "string" }),
          exampleQuestions: arrayOf({ type: "string" }),
          notes: arrayOf({ type: "string" }),
          routePosture: { type: "string" },
          apiAccessHint: { type: "string" }
        }
      }),
      conversationRules: arrayOf({ type: "string" }),
      entityConversationPlaybooks: arrayOf({
        type: "object",
        additionalProperties: false,
        required: [
          "focus",
          "openingQuestion",
          "coachingGoal",
          "askSequence",
          "routePosture",
          "apiAccessHint"
        ],
        properties: {
          focus: { type: "string" },
          openingQuestion: { type: "string" },
          coachingGoal: { type: "string" },
          askSequence: arrayOf({ type: "string" }),
          routePosture: { type: "string" },
          apiAccessHint: { type: "string" }
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
              additionalProperties: true
            }
          },
          actionEntities: {
            type: "object",
            additionalProperties: {
              type: "object",
              additionalProperties: true,
              required: [
                "classification",
                "aliases",
                "summary",
                "routeKeys",
                "routeTools",
                "methodRoutes",
                "notes"
              ],
              properties: {
                classification: {
                  type: "string",
                  enum: ["action_workflow_entity"]
                },
                aliases: arrayOf({ type: "string" }),
                summary: { type: "string" },
                routeKeys: arrayOf({ type: "string" }),
                routeTools: {
                  type: "object",
                  additionalProperties: { type: "string" }
                },
                methodRoutes: {
                  type: "object",
                  additionalProperties: { type: "string" }
                },
                notes: arrayOf({ type: "string" })
              }
            }
          },
          specializedDomainSurfaces: {
            type: "object",
            additionalProperties: {
              type: "object",
              additionalProperties: false,
              required: [
                "classification",
                "aliases",
                "routeTool",
                "summary",
                "routeKeys",
                "methodRoutes",
                "readRoutes",
                "writeRoutes",
                "routeSelectionQuestions",
                "notes"
              ],
              properties: {
                classification: {
                  type: "string",
                  enum: ["specialized_domain_surface"]
                },
                aliases: arrayOf({ type: "string" }),
                routeTool: { type: "string" },
                summary: { type: "string" },
                routeKeys: arrayOf({ type: "string" }),
                methodRoutes: {
                  type: "object",
                  additionalProperties: { type: "string" }
                },
                readRoutes: {
                  type: "object",
                  additionalProperties: { type: "string" }
                },
                writeRoutes: {
                  type: "object",
                  additionalProperties: { type: "string" }
                },
                routeSelectionQuestions: arrayOf({ type: "string" }),
                notes: arrayOf({ type: "string" })
              }
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
          "questionFlow",
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
              "specialized_domain_surface",
              "read_model_only_surface"
            ]
          },
          purpose: { type: "string" },
          minimumCreateFields: arrayOf({ type: "string" }),
          relationshipRules: arrayOf({ type: "string" }),
          searchHints: arrayOf({ type: "string" }),
          questionFlow: {
            type: "object",
            additionalProperties: false,
            required: [
              "openingQuestion",
              "coachingGoal",
              "askSequence",
              "questionStyle",
              "maxQuestionsPerTurn",
              "reflectionBeforeQuestion",
              "readinessCheck",
              "routePosture",
              "apiAccessHint"
            ],
            properties: {
              openingQuestion: { type: "string" },
              coachingGoal: { type: "string" },
              askSequence: arrayOf({ type: "string" }),
              questionStyle: {
                type: "string",
                enum: [
                  "therapist_like_active_listening",
                  "active_listening_structured",
                  "operational_fast_path",
                  "dedicated_route_active_listening",
                  "read_model_practical_scope"
                ]
              },
              maxQuestionsPerTurn: { type: "integer", enum: [1] },
              reflectionBeforeQuestion: { type: "boolean" },
              maxHypothesesPerTurn: { type: "integer", enum: [1] },
              hypothesisStyle: {
                type: "string",
                enum: ["tentative_functional_non_diagnostic"]
              },
              requiresFitOrCorrection: { type: "boolean", enum: [true] },
              readinessCheck: { type: "string" },
              routePosture: {
                type: "string",
                enum: [
                  "batch_crud_entity",
                  "specialized_crud_entity",
                  "action_workflow_entity",
                  "specialized_domain_surface",
                  "read_model_only_surface"
                ]
              },
              apiAccessHint: { type: "string" }
            }
          },
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
          "todayPriority",
          "xpMetrics",
          "weeklyReview",
          "sleepOverview",
          "sportsOverview",
          "trainingLoad",
          "weightLoss",
          "weightLossTarget",
          "weightLossDailyActiveCalories",
          "weightLossFoodsSearch",
          "weightLossFoodsBarcode",
          "weightLossFoodLogs",
          "weightLossFoodLogDetail",
          "weightLossParse",
          "weightLossBodyCheckins",
          "weightLossAppearanceCheckins",
          "weightLossSubjectiveCheckins",
          "weightLossGutCheckins",
          "weightLossPatterns",
          "weightLossExperiments",
          "weightLossExperimentDetail",
          "lifeForce",
          "lifeForceProfile",
          "lifeForceWeekdayTemplate",
          "lifeForceFatigueSignals",
          "movementDay",
          "movementMonth",
          "movementTimeline",
          "movementAllTime",
          "movementPlaces",
          "movementBoxDetail",
          "movementSettings",
          "movementSettingsUpdate",
          "movementTripDetail",
          "movementSelection",
          "movementUserBoxPreflight",
          "movementUserBoxUpdate",
          "movementUserBoxDelete",
          "movementAutomaticBoxInvalidate",
          "movementStayUpdate",
          "movementStayDelete",
          "movementTripUpdate",
          "movementTripDelete",
          "movementTripPointUpdate",
          "movementTripPointDelete",
          "workbenchBoxCatalog",
          "workbenchFlows",
          "workbenchFlowBySlug",
          "workbenchPublishedOutput",
          "workbenchRuns",
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
          todayPriority: { type: "string" },
          xpMetrics: { type: "string" },
          weeklyReview: { type: "string" },
          sleepOverview: { type: "string" },
          sportsOverview: { type: "string" },
          trainingLoad: { type: "string" },
          weightLoss: { type: "string" },
          weightLossTarget: { type: "string" },
          weightLossDailyActiveCalories: { type: "string" },
          weightLossFoodsSearch: { type: "string" },
          weightLossFoodsBarcode: { type: "string" },
          weightLossFoodLogs: { type: "string" },
          weightLossFoodLogDetail: { type: "string" },
          weightLossParse: { type: "string" },
          weightLossBodyCheckins: { type: "string" },
          weightLossAppearanceCheckins: { type: "string" },
          weightLossSubjectiveCheckins: { type: "string" },
          weightLossGutCheckins: { type: "string" },
          weightLossPatterns: { type: "string" },
          weightLossExperiments: { type: "string" },
          weightLossExperimentDetail: { type: "string" },
          lifeForce: { type: "string" },
          lifeForceProfile: { type: "string" },
          lifeForceWeekdayTemplate: { type: "string" },
          lifeForceFatigueSignals: { type: "string" },
          movementDay: { type: "string" },
          movementMonth: { type: "string" },
          movementTimeline: { type: "string" },
          movementAllTime: { type: "string" },
          movementPlaces: { type: "string" },
          movementBoxDetail: { type: "string" },
          movementSettings: { type: "string" },
          movementSettingsUpdate: { type: "string" },
          movementTripDetail: { type: "string" },
          movementSelection: { type: "string" },
          movementUserBoxPreflight: { type: "string" },
          movementUserBoxUpdate: { type: "string" },
          movementUserBoxDelete: { type: "string" },
          movementAutomaticBoxInvalidate: { type: "string" },
          movementStayUpdate: { type: "string" },
          movementStayDelete: { type: "string" },
          movementTripUpdate: { type: "string" },
          movementTripDelete: { type: "string" },
          movementTripPointUpdate: { type: "string" },
          movementTripPointDelete: { type: "string" },
          workbenchBoxCatalog: { type: "string" },
          workbenchFlows: { type: "string" },
          workbenchFlowBySlug: { type: "string" },
          workbenchPublishedOutput: { type: "string" },
          workbenchRuns: { type: "string" },
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
          "specializedDomainWorkflow",
          "artifactWorkflow",
          "attentionWorkflow",
          "entityNavigationWorkflow",
          "peopleWorkflow",
          "preferencesWorkflow",
          "questionnaireWorkflow",
          "selfObservationWorkflow",
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
          specializedDomainWorkflow: arrayOf({ type: "string" }),
          artifactWorkflow: arrayOf({ type: "string" }),
          attentionWorkflow: arrayOf({ type: "string" }),
          entityNavigationWorkflow: arrayOf({ type: "string" }),
          peopleWorkflow: arrayOf({ type: "string" }),
          preferencesWorkflow: arrayOf({ type: "string" }),
          questionnaireWorkflow: arrayOf({ type: "string" }),
          selfObservationWorkflow: arrayOf({ type: "string" }),
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
          "depthCalibrationRule",
          "operationLaneRule",
          "psycheExplorationRule",
          "specializedSurfaceRule",
          "reviewShortcutRule",
          "readModelWriteRule",
          "psycheOpeningQuestionRule",
          "psycheHypothesisRule",
          "mixedIntentSequencingRule",
          "duplicateDisambiguationRule",
          "destructiveActionRule",
          "followUpQuestionRule",
          "antiDriftRule",
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
          depthCalibrationRule: { type: "string" },
          operationLaneRule: { type: "string" },
          psycheExplorationRule: { type: "string" },
          specializedSurfaceRule: { type: "string" },
          reviewShortcutRule: { type: "string" },
          readModelWriteRule: { type: "string" },
          psycheOpeningQuestionRule: { type: "string" },
          psycheHypothesisRule: { type: "string" },
          mixedIntentSequencingRule: { type: "string" },
          duplicateDisambiguationRule: { type: "string" },
          destructiveActionRule: { type: "string" },
          followUpQuestionRule: { type: "string" },
          antiDriftRule: { type: "string" },
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
          "specializedRouteToolRule",
          "createExample",
          "updateExample",
          "specializedRouteToolExample",
          "specializedRouteToolExamples"
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
          specializedRouteToolRule: { type: "string" },
          createExample: { type: "string" },
          updateExample: { type: "string" },
          specializedRouteToolExample: { type: "string" },
          specializedRouteToolExamples: {
            type: "object",
            additionalProperties: { type: "string" }
          }
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

  const batchEntityValidationIssue = {
    type: "object",
    additionalProperties: false,
    required: ["path", "message"],
    properties: {
      path: { type: "string" },
      message: { type: "string" },
      code: { type: "string" },
      allowedValues: arrayOf({})
    }
  };

  const batchEntityInvalidValueGuidance = {
    type: "object",
    additionalProperties: false,
    required: ["path", "allowedValues", "message"],
    properties: {
      path: { type: "string" },
      allowedValues: arrayOf({}),
      message: { type: "string" }
    }
  };

  const batchEntityOperationError = {
    type: "object",
    additionalProperties: false,
    required: ["code", "message"],
    properties: {
      code: {
        type: "string",
        description:
          "Machine-readable operation error. Atomic batches use rolled_back for earlier successful operations whose transaction effects were undone and not_executed for later operations skipped after the failure.",
        examples: [
          "validation_failed",
          "not_found",
          "rolled_back",
          "not_executed"
        ]
      },
      message: { type: "string" },
      operationType: {
        type: "string",
        enum: ["create", "update", "delete", "restore", "search"]
      },
      entityType: { $ref: "#/components/schemas/CrudEntityType" },
      clientRef: { type: "string" },
      routeHint: { type: "string" },
      toolHint: { type: "string" },
      summary: { type: "string" },
      issues: arrayOf({
        $ref: "#/components/schemas/BatchEntityValidationIssue"
      }),
      missingRequiredFields: arrayOf({ type: "string" }),
      invalidValueGuidance: arrayOf({
        $ref: "#/components/schemas/BatchEntityInvalidValueGuidance"
      }),
      allowedTopLevelFields: arrayOf({ type: "string" }),
      minimalExamplePayload: {
        type: "object",
        additionalProperties: true
      }
    }
  };

  const batchEntityMutationResult = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "entityType"],
    properties: {
      ok: { type: "boolean" },
      entityType: { $ref: "#/components/schemas/CrudEntityType" },
      id: { type: "string" },
      clientRef: { type: "string" },
      entity: {
        description:
          "The created, updated, deleted, or restored entity returned by a successful mutation.",
        type: "object",
        additionalProperties: true
      },
      deletedRecord: {
        description:
          "A canonical deleted-record snapshot when a mutation surface returns one explicitly.",
        $ref: "#/components/schemas/DeletedEntityRecord"
      },
      projection: {
        description:
          "Downstream calendar projection outcome, present only for successful calendar-event mutations that request projection work.",
        $ref: "#/components/schemas/CalendarProjectionResult"
      },
      mutationReceipt: nullable({
        $ref: "#/components/schemas/MutationReceipt"
      }),
      error: { $ref: "#/components/schemas/BatchEntityOperationError" }
    },
    oneOf: [
      {
        title: "Mutation success",
        description:
          "The mutation committed. id and entity identify the resulting stored record; projection may accompany calendar-event mutations.",
        required: ["id", "entity"],
        properties: { ok: { const: true } }
      },
      {
        title: "Mutation failure",
        description:
          "The mutation did not commit. The error may be the original operation error, rolled_back, or not_executed for an atomic batch.",
        required: ["error"],
        properties: { ok: { const: false } }
      }
    ]
  };

  const batchEntitySearchMatch = {
    type: "object",
    additionalProperties: false,
    required: ["deleted", "entityType", "id", "entity"],
    properties: {
      deleted: { type: "boolean" },
      entityType: { $ref: "#/components/schemas/CrudEntityType" },
      id: { type: "string" },
      entity: { type: "object", additionalProperties: true },
      deletedRecord: { $ref: "#/components/schemas/DeletedEntityRecord" }
    }
  };

  const batchEntitySearchResult = {
    type: "object",
    additionalProperties: false,
    required: ["ok", "matches"],
    properties: {
      ok: { type: "boolean", const: true },
      clientRef: { type: "string" },
      matches: arrayOf({
        $ref: "#/components/schemas/BatchEntitySearchMatch"
      })
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
      "userId",
      "user",
      "ownerUserId",
      "ownerUser",
      "assigneeUserIds",
      "assignees",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      domainId: { type: "string" },
      label: { type: "string" },
      description: { type: "string" },
      system: { type: "boolean" },
      userId: {
        ...nullable({ type: "string" }),
        description:
          "Effective owner of a custom event type. Built-in entries are unowned and return null."
      },
      user: nullable({ $ref: "#/components/schemas/UserSummary" }),
      ownerUserId: nullable({ type: "string" }),
      ownerUser: nullable({ $ref: "#/components/schemas/UserSummary" }),
      assigneeUserIds: arrayOf({ type: "string" }),
      assignees: arrayOf({ $ref: "#/components/schemas/UserSummary" }),
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
      "userId",
      "user",
      "ownerUserId",
      "ownerUser",
      "assigneeUserIds",
      "assignees",
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
      userId: {
        ...nullable({ type: "string" }),
        description:
          "Effective owner of a custom emotion definition. Built-in entries are unowned and return null."
      },
      user: nullable({ $ref: "#/components/schemas/UserSummary" }),
      ownerUserId: nullable({ type: "string" }),
      ownerUser: nullable({ $ref: "#/components/schemas/UserSummary" }),
      assigneeUserIds: arrayOf({ type: "string" }),
      assignees: arrayOf({ $ref: "#/components/schemas/UserSummary" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const eventTypeCreateInput = {
    type: "object",
    additionalProperties: false,
    required: ["label"],
    properties: {
      label: { type: "string", minLength: 1, maxLength: 160 },
      description: { type: "string", maxLength: 2000, default: "" },
      userId: {
        ...nullable({ type: "string", minLength: 1 }),
        description:
          "Owner for the custom entry. Omit only when the effective token scope resolves to one user."
      }
    }
  };

  const eventTypePatchInput = {
    ...eventTypeCreateInput,
    required: [],
    minProperties: 1
  };

  const emotionDefinitionCreateInput = {
    type: "object",
    additionalProperties: false,
    required: ["label"],
    properties: {
      label: { type: "string", minLength: 1, maxLength: 160 },
      description: { type: "string", maxLength: 2000, default: "" },
      category: { type: "string", maxLength: 160, default: "" },
      userId: {
        ...nullable({ type: "string", minLength: 1 }),
        description:
          "Owner for the custom entry. Omit only when the effective token scope resolves to one user."
      }
    }
  };

  const emotionDefinitionPatchInput = {
    ...emotionDefinitionCreateInput,
    required: [],
    minProperties: 1
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
      results: {
        ...arrayOf({
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
        description:
          "Server-derived candidate interpretations. The array is populated only when the answers contain exactly one interpretation_stance of fits. Partly accepted, uncertain, declined, and unreviewed interpretations remain absent from results."
      },
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
      "bodyCues",
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
      "memoryClarity",
      "reflection",
      "hypothesis",
      "hypothesisFit",
      "hypothesisCorrection",
      "interpretationConsent",
      "revision",
      "userId",
      "user",
      "ownerUserId",
      "ownerUser",
      "assigneeUserIds",
      "assignees",
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
      bodyCues: arrayOf({ type: "string" }),
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
      memoryClarity: {
        type: "string",
        enum: ["unspecified", "clear", "partial", "uncertain"]
      },
      reflection: { type: "string" },
      hypothesis: { type: "string" },
      hypothesisFit: {
        type: "string",
        enum: ["not_reviewed", "fits", "partly_fits", "does_not_fit"]
      },
      hypothesisCorrection: { type: "string" },
      interpretationConsent: { type: "boolean" },
      revision: { type: "integer", minimum: 1 },
      userId: nullable({ type: "string" }),
      user: nullable({ $ref: "#/components/schemas/UserSummary" }),
      ownerUserId: nullable({ type: "string" }),
      ownerUser: nullable({ $ref: "#/components/schemas/UserSummary" }),
      assigneeUserIds: arrayOf({ type: "string" }),
      assignees: arrayOf({ $ref: "#/components/schemas/UserSummary" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const triggerReportMutationProperties = {
    title: { type: "string", minLength: 1, maxLength: 200 },
    status: {
      type: "string",
      enum: ["draft", "reviewed", "integrated"]
    },
    eventTypeId: nullable({ type: "string", maxLength: 160 }),
    customEventType: { type: "string", maxLength: 500 },
    eventSituation: { type: "string", maxLength: 6000 },
    occurredAt: nullable({ type: "string", format: "date-time" }),
    bodyCues: {
      type: "array",
      maxItems: 40,
      items: { type: "string", maxLength: 500 }
    },
    emotions: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "intensity"],
        properties: {
          id: { type: "string", maxLength: 160 },
          emotionDefinitionId: nullable({ type: "string", maxLength: 160 }),
          label: { type: "string", minLength: 1, maxLength: 500 },
          intensity: { type: "integer", minimum: 0, maximum: 100 },
          note: { type: "string", maxLength: 500 }
        }
      }
    },
    thoughts: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: {
          id: { type: "string", maxLength: 160 },
          text: { type: "string", minLength: 1, maxLength: 2000 },
          parentMode: { type: "string", maxLength: 500 },
          criticMode: { type: "string", maxLength: 500 },
          beliefId: nullable({ type: "string", maxLength: 160 })
        }
      }
    },
    behaviors: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: {
          id: { type: "string", maxLength: 160 },
          text: { type: "string", minLength: 1, maxLength: 2000 },
          mode: { type: "string", maxLength: 500 },
          behaviorId: nullable({ type: "string", maxLength: 160 })
        }
      }
    },
    consequences: {
      type: "object",
      additionalProperties: false,
      properties: {
        selfShortTerm: {
          type: "array",
          maxItems: 40,
          items: { type: "string", maxLength: 500 }
        },
        selfLongTerm: {
          type: "array",
          maxItems: 40,
          items: { type: "string", maxLength: 500 }
        },
        othersShortTerm: {
          type: "array",
          maxItems: 40,
          items: { type: "string", maxLength: 500 }
        },
        othersLongTerm: {
          type: "array",
          maxItems: 40,
          items: { type: "string", maxLength: 500 }
        }
      }
    },
    linkedPatternIds: {
      type: "array",
      maxItems: 100,
      items: { type: "string", maxLength: 160 }
    },
    linkedValueIds: {
      type: "array",
      maxItems: 100,
      items: { type: "string", maxLength: 160 }
    },
    linkedGoalIds: {
      type: "array",
      maxItems: 100,
      items: { type: "string", maxLength: 160 }
    },
    linkedProjectIds: {
      type: "array",
      maxItems: 100,
      items: { type: "string", maxLength: 160 }
    },
    linkedTaskIds: {
      type: "array",
      maxItems: 100,
      items: { type: "string", maxLength: 160 }
    },
    linkedBehaviorIds: {
      type: "array",
      maxItems: 100,
      items: { type: "string", maxLength: 160 }
    },
    linkedBeliefIds: {
      type: "array",
      maxItems: 100,
      items: { type: "string", maxLength: 160 }
    },
    linkedModeIds: {
      type: "array",
      maxItems: 100,
      items: { type: "string", maxLength: 160 }
    },
    modeOverlays: {
      type: "array",
      maxItems: 40,
      items: { type: "string", maxLength: 500 }
    },
    schemaLinks: {
      type: "array",
      maxItems: 40,
      items: { type: "string", maxLength: 500 }
    },
    modeTimeline: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["stage", "modeId", "label"],
        properties: {
          id: { type: "string", maxLength: 160 },
          stage: { type: "string", minLength: 1, maxLength: 80 },
          modeId: nullable({ type: "string", maxLength: 160 }),
          label: { type: "string", minLength: 1, maxLength: 160 },
          note: { type: "string", maxLength: 500 }
        }
      }
    },
    nextMoves: {
      type: "array",
      maxItems: 40,
      items: { type: "string", maxLength: 500 }
    },
    memoryClarity: {
      type: "string",
      enum: ["unspecified", "clear", "partial", "uncertain"],
      default: "unspecified"
    },
    reflection: { type: "string", maxLength: 6000 },
    hypothesis: { type: "string", maxLength: 6000 },
    hypothesisFit: {
      type: "string",
      enum: ["not_reviewed", "fits", "partly_fits", "does_not_fit"]
    },
    hypothesisCorrection: { type: "string", maxLength: 6000 },
    interpretationConsent: { type: "boolean" },
    userId: nullable({ type: "string", maxLength: 160 })
  };

  const triggerReportCreateInput = {
    type: "object",
    additionalProperties: false,
    required: ["title"],
    properties: triggerReportMutationProperties
  };

  const triggerReportPatchInput = {
    type: "object",
    additionalProperties: false,
    required: ["expectedRevision"],
    properties: {
      ...triggerReportMutationProperties,
      expectedRevision: { type: "integer", minimum: 1 }
    }
  };

  const triggerReportPage = {
    type: "object",
    additionalProperties: false,
    required: ["reports", "total", "limit", "nextCursor", "hasMore"],
    properties: {
      reports: arrayOf({ $ref: "#/components/schemas/TriggerReport" }),
      total: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      nextCursor: nullable({ type: "string" }),
      hasMore: { type: "boolean" }
    }
  };

  const devrageMetricPayload = {
    type: "object",
    additionalProperties: false,
    required: [
      "generatedAt",
      "hasData",
      "latestDateKey",
      "rawSwearCount",
      "swearingMessagePercent",
      "averageMaxCumulativeRage",
      "maxCumulativeRage",
      "maxSwearingStreak",
      "conversationsScanned",
      "messagesScanned",
      "messagesWithSwears",
      "dailyAverage",
      "weeklyAverage",
      "history",
      "sync"
    ],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      hasData: { type: "boolean" },
      latestDateKey: nullable({ type: "string" }),
      rawSwearCount: { type: "number" },
      swearingMessagePercent: { type: "number" },
      averageMaxCumulativeRage: { type: "number" },
      maxCumulativeRage: { type: "number" },
      maxSwearingStreak: { type: "integer" },
      conversationsScanned: { type: "integer" },
      messagesScanned: { type: "integer" },
      messagesWithSwears: { type: "integer" },
      dailyAverage: {
        type: "object",
        additionalProperties: false,
        required: [
          "rawSwearCount",
          "swearingMessagePercent",
          "averageMaxCumulativeRage",
          "maxCumulativeRage"
        ],
        properties: {
          rawSwearCount: { type: "number" },
          swearingMessagePercent: { type: "number" },
          averageMaxCumulativeRage: { type: "number" },
          maxCumulativeRage: { type: "number" }
        }
      },
      weeklyAverage: {
        type: "object",
        additionalProperties: false,
        required: [
          "rawSwearCount",
          "swearingMessagePercent",
          "averageMaxCumulativeRage",
          "maxCumulativeRage"
        ],
        properties: {
          rawSwearCount: { type: "number" },
          swearingMessagePercent: { type: "number" },
          averageMaxCumulativeRage: { type: "number" },
          maxCumulativeRage: { type: "number" }
        }
      },
      history: arrayOf({
        type: "object",
        additionalProperties: false,
        required: [
          "dateKey",
          "rawSwearCount",
          "swearingMessagePercent",
          "averageMaxCumulativeRage",
          "maxCumulativeRage",
          "maxSwearingStreak",
          "conversationsScanned",
          "messagesScanned",
          "messagesWithSwears"
        ],
        properties: {
          dateKey: { type: "string" },
          rawSwearCount: { type: "number" },
          swearingMessagePercent: { type: "number" },
          averageMaxCumulativeRage: { type: "number" },
          maxCumulativeRage: { type: "number" },
          maxSwearingStreak: { type: "integer" },
          conversationsScanned: { type: "integer" },
          messagesScanned: { type: "integer" },
          messagesWithSwears: { type: "integer" }
        }
      }),
      sync: {
        type: "object",
        additionalProperties: false,
        required: [
          "fullSyncCompletedAt",
          "lastDailySyncAt",
          "lastSyncedDateKey"
        ],
        properties: {
          fullSyncCompletedAt: nullable({
            type: "string",
            format: "date-time"
          }),
          lastDailySyncAt: nullable({ type: "string", format: "date-time" }),
          lastSyncedDateKey: nullable({ type: "string" })
        }
      }
    }
  };

  const psycheMetricSourceRecord = {
    type: "object",
    additionalProperties: false,
    required: [
      "sourceType",
      "sourceId",
      "label",
      "href",
      "observedAt",
      "recordedAt",
      "ownerUserId",
      "ownerDisplayName",
      "value",
      "sampleCount"
    ],
    properties: {
      sourceType: {
        type: "string",
        enum: ["trigger_report", "conversation"]
      },
      sourceId: { type: "string" },
      label: { type: "string" },
      href: nullable({ type: "string" }),
      observedAt: { type: "string", format: "date-time" },
      recordedAt: { type: "string", format: "date-time" },
      ownerUserId: nullable({ type: "string" }),
      ownerDisplayName: nullable({ type: "string" }),
      value: nullable({ type: "number" }),
      sampleCount: { type: "integer", minimum: 0 }
    }
  };

  const dailyMetricDayRecord = {
    type: "object",
    additionalProperties: false,
    required: [
      "dateKey",
      "average",
      "minimum",
      "maximum",
      "latest",
      "total",
      "sampleCount",
      "latestSampleAt",
      "sourceRecords"
    ],
    properties: {
      dateKey: { type: "string" },
      average: nullable({ type: "number" }),
      minimum: nullable({ type: "number" }),
      maximum: nullable({ type: "number" }),
      latest: nullable({ type: "number" }),
      total: nullable({ type: "number" }),
      sampleCount: { type: "integer", minimum: 0 },
      latestSampleAt: nullable({ type: "string", format: "date-time" }),
      sourceRecords: arrayOf(psycheMetricSourceRecord)
    }
  };

  const dailyMetricRecord = {
    type: "object",
    additionalProperties: false,
    required: [
      "metric",
      "label",
      "family",
      "category",
      "unit",
      "aggregation",
      "cadence",
      "sampleUnit",
      "definition",
      "confidence",
      "source",
      "latestValue",
      "latestDateKey",
      "baselineValue",
      "deltaValue",
      "coverageDays",
      "days"
    ],
    properties: {
      metric: { type: "string" },
      label: { type: "string" },
      family: {
        type: "string",
        enum: ["mood", "urges", "selfRegulation", "conversation", "other"]
      },
      category: { type: "string" },
      unit: { type: "string" },
      aggregation: { type: "string", enum: ["discrete", "cumulative"] },
      cadence: { type: "string", enum: ["daily", "event_based"] },
      sampleUnit: { type: "string" },
      definition: {
        type: "object",
        additionalProperties: false,
        required: [
          "description",
          "calculation",
          "interpretation",
          "missingness"
        ],
        properties: {
          description: { type: "string" },
          calculation: { type: "string" },
          interpretation: { type: "string" },
          missingness: { type: "string" }
        }
      },
      confidence: {
        type: "object",
        additionalProperties: false,
        required: ["status", "rationale"],
        properties: {
          status: { type: "string", enum: ["not_estimated"] },
          rationale: { type: "string" }
        }
      },
      source: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "label", "href", "ownerAttribution"],
        properties: {
          kind: {
            type: "string",
            enum: ["trigger_reports", "conversation_scanner"]
          },
          label: { type: "string" },
          href: nullable({ type: "string" }),
          ownerAttribution: {
            type: "string",
            enum: ["attributed", "unattributed", "mixed"]
          }
        }
      },
      latestValue: nullable({ type: "number" }),
      latestDateKey: nullable({ type: "string" }),
      baselineValue: nullable({ type: "number" }),
      deltaValue: nullable({ type: "number" }),
      coverageDays: { type: "integer", minimum: 0 },
      days: arrayOf(dailyMetricDayRecord)
    }
  };

  const psycheMetricsViewData = {
    type: "object",
    additionalProperties: false,
    required: ["summary", "context", "metrics"],
    properties: {
      summary: {
        type: "object",
        additionalProperties: false,
        required: [
          "hasData",
          "trackedDays",
          "metricCount",
          "latestDateKey",
          "latestMetricCount",
          "categoryBreakdown",
          "familyAvailability"
        ],
        properties: {
          hasData: { type: "boolean" },
          trackedDays: { type: "integer" },
          metricCount: { type: "integer" },
          latestDateKey: nullable({ type: "string" }),
          latestMetricCount: { type: "integer" },
          categoryBreakdown: arrayOf({
            type: "object",
            additionalProperties: false,
            required: ["category", "metricCount", "coverageDays"],
            properties: {
              category: { type: "string" },
              metricCount: { type: "integer" },
              coverageDays: { type: "integer" }
            }
          }),
          familyAvailability: arrayOf({
            type: "object",
            additionalProperties: false,
            required: ["family", "status", "metricCount", "reason"],
            properties: {
              family: {
                type: "string",
                enum: ["mood", "urges", "selfRegulation", "conversation"]
              },
              status: {
                type: "string",
                enum: ["available", "no_data", "unsupported"]
              },
              metricCount: { type: "integer", minimum: 0 },
              reason: { type: "string" }
            }
          })
        }
      },
      context: {
        type: "object",
        additionalProperties: false,
        required: [
          "generatedAt",
          "conversationsScanned",
          "sourceCount",
          "messagesScanned",
          "messagesWithSwears",
          "totalSwears",
          "dailyAverage",
          "weeklyAverage",
          "sync",
          "freshness",
          "ownerScope",
          "sources",
          "dataQualityWarnings"
        ],
        properties: {
          generatedAt: { type: "string", format: "date-time" },
          conversationsScanned: { type: "integer" },
          sourceCount: { type: "integer" },
          messagesScanned: { type: "integer" },
          messagesWithSwears: { type: "integer" },
          totalSwears: { type: "number" },
          dailyAverage: {
            type: "object",
            additionalProperties: false,
            required: [
              "rawSwearCount",
              "swearingMessagePercent",
              "averageMaxCumulativeRage",
              "maxCumulativeRage"
            ],
            properties: {
              rawSwearCount: { type: "number" },
              swearingMessagePercent: { type: "number" },
              averageMaxCumulativeRage: { type: "number" },
              maxCumulativeRage: { type: "number" }
            }
          },
          weeklyAverage: {
            type: "object",
            additionalProperties: false,
            required: [
              "rawSwearCount",
              "swearingMessagePercent",
              "averageMaxCumulativeRage",
              "maxCumulativeRage"
            ],
            properties: {
              rawSwearCount: { type: "number" },
              swearingMessagePercent: { type: "number" },
              averageMaxCumulativeRage: { type: "number" },
              maxCumulativeRage: { type: "number" }
            }
          },
          sync: {
            type: "object",
            additionalProperties: false,
            required: [
              "fullSyncCompletedAt",
              "lastDailySyncAt",
              "lastSyncedDateKey"
            ],
            properties: {
              fullSyncCompletedAt: nullable({
                type: "string",
                format: "date-time"
              }),
              lastDailySyncAt: nullable({
                type: "string",
                format: "date-time"
              }),
              lastSyncedDateKey: nullable({ type: "string" })
            }
          },
          freshness: {
            type: "object",
            additionalProperties: false,
            required: [
              "status",
              "lastSuccessfulAt",
              "lastAttemptAt",
              "warningCount",
              "warnings"
            ],
            properties: {
              status: {
                type: "string",
                enum: [
                  "current",
                  "stale",
                  "partial",
                  "not_synced",
                  "not_applicable"
                ]
              },
              lastSuccessfulAt: nullable({
                type: "string",
                format: "date-time"
              }),
              lastAttemptAt: nullable({
                type: "string",
                format: "date-time"
              }),
              warningCount: { type: "integer", minimum: 0 },
              warnings: arrayOf({ type: "string" })
            }
          },
          ownerScope: {
            type: "object",
            additionalProperties: false,
            required: [
              "mode",
              "effectiveUserIds",
              "availableOwners",
              "filterMode",
              "serverEnforced",
              "unattributedRecordCount",
              "limitation"
            ],
            properties: {
              mode: {
                type: "string",
                enum: ["unscoped_all_data", "scoped"]
              },
              effectiveUserIds: arrayOf({ type: "string" }),
              availableOwners: arrayOf({
                type: "object",
                additionalProperties: false,
                required: ["userId", "displayName"],
                properties: {
                  userId: { type: "string" },
                  displayName: { type: "string" }
                }
              }),
              filterMode: {
                type: "string",
                enum: ["all_data", "server_attribution"]
              },
              serverEnforced: { type: "boolean" },
              unattributedRecordCount: { type: "integer", minimum: 0 },
              limitation: { type: "string" }
            }
          },
          sources: arrayOf({
            type: "object",
            additionalProperties: false,
            required: [
              "sourceId",
              "label",
              "kind",
              "recordCount",
              "linkedRecordCount",
              "href",
              "ownerAttribution"
            ],
            properties: {
              sourceId: { type: "string" },
              label: { type: "string" },
              kind: {
                type: "string",
                enum: ["trigger_reports", "conversation_scanner"]
              },
              recordCount: { type: "integer", minimum: 0 },
              linkedRecordCount: { type: "integer", minimum: 0 },
              href: nullable({ type: "string" }),
              ownerAttribution: {
                type: "string",
                enum: ["attributed", "unattributed", "mixed"]
              }
            }
          }),
          dataQualityWarnings: arrayOf({ type: "string" })
        }
      },
      metrics: arrayOf(dailyMetricRecord)
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
      "devrageMetric",
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
      devrageMetric: devrageMetricPayload,
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
      "sourceSystem",
      "workoutTypeLabel",
      "activityFamily",
      "activityFamilyLabel",
      "activity",
      "details",
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
      sourceSystem: { type: "string" },
      sourceBundleIdentifier: nullable({ type: "string" }),
      sourceProductType: nullable({ type: "string" }),
      workoutType: { type: "string" },
      workoutTypeLabel: { type: "string" },
      activityFamily: { type: "string" },
      activityFamilyLabel: { type: "string" },
      activity: { type: "object", additionalProperties: true },
      details: { type: "object", additionalProperties: true },
      sourceDevice: { type: "string" },
      startedAt: { type: "string", format: "date-time" },
      endedAt: { type: "string", format: "date-time" },
      durationSeconds: { type: "integer" },
      activeEnergyKcal: nullable({ type: "number" }),
      totalEnergyKcal: nullable({ type: "number" }),
      distanceMeters: nullable({ type: "number" }),
      stepCount: nullable({ type: "integer" }),
      exerciseMinutes: nullable({ type: "number" }),
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
      analytics: { type: "object", additionalProperties: true },
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

  const workoutSessionSummaryOmittedProperties = new Set([
    "activity",
    "details",
    "annotations",
    "provenance",
    "derived"
  ]);
  const workoutSessionSummary = {
    ...workoutSession,
    required: [
      ...workoutSession.required.filter(
        (property) => !workoutSessionSummaryOmittedProperties.has(property)
      ),
      "detailLevel"
    ],
    properties: {
      ...Object.fromEntries(
        Object.entries(workoutSession.properties).filter(
          ([property]) => !workoutSessionSummaryOmittedProperties.has(property)
        )
      ),
      detailLevel: { type: "string", enum: ["summary"] }
    }
  };

  const workoutAnalysisSession = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "workoutType",
      "workoutTypeLabel",
      "activityFamily",
      "activityFamilyLabel",
      "startedAt",
      "durationSeconds",
      "analytics",
      "detailLevel"
    ],
    properties: {
      id: { type: "string" },
      workoutType: { type: "string" },
      workoutTypeLabel: { type: "string" },
      activityFamily: { type: "string" },
      activityFamilyLabel: { type: "string" },
      startedAt: { type: "string", format: "date-time" },
      durationSeconds: { type: "number" },
      analytics: {
        type: "object",
        additionalProperties: false,
        required: [
          "confidence",
          "dataQuality",
          "zoneDurations",
          "hrSummary",
          "load"
        ],
        properties: {
          confidence: { type: "string" },
          dataQuality: {
            type: "object",
            additionalProperties: false,
            required: ["heartRateSampleCount"],
            properties: {
              heartRateSampleCount: { type: "integer", minimum: 0 }
            }
          },
          zoneDurations: arrayOf({
            type: "object",
            additionalProperties: false,
            required: ["key", "label", "seconds", "percentage"],
            properties: {
              key: { type: "string" },
              label: { type: "string" },
              seconds: { type: "number", minimum: 0 },
              percentage: { type: "number", minimum: 0 }
            }
          }),
          hrSummary: {
            type: "object",
            additionalProperties: false,
            required: ["restingHr"],
            properties: {
              restingHr: nullable({ type: "number" })
            }
          },
          load: {
            type: "object",
            additionalProperties: false,
            required: ["trimp", "intensity"],
            properties: {
              trimp: nullable({ type: "number" }),
              intensity: nullable({ type: "number" })
            }
          }
        }
      },
      detailLevel: { type: "string", enum: ["analysis"] }
    }
  };

  const sportComparisonEntry = {
    type: "object",
    additionalProperties: false,
    required: [
      "workoutType",
      "workoutTypeLabel",
      "activityFamily",
      "activityFamilyLabel",
      "sessionCount",
      "sessionShare",
      "activeDayCount",
      "totalDurationSeconds",
      "durationShare",
      "averageSessionMinutes",
      "totalEnergyKcal",
      "energyShare",
      "energyCoverage",
      "energyKcalPerHour",
      "distanceMeters",
      "distanceShare",
      "distanceCoverage",
      "averageSpeedKph",
      "totalTrainingLoad",
      "trainingLoadShare",
      "trainingLoadCoverage",
      "trainingLoadPerHour",
      "averageHeartRateCoverage",
      "firstStartedAt",
      "lastStartedAt"
    ],
    properties: {
      workoutType: { type: "string" },
      workoutTypeLabel: { type: "string" },
      activityFamily: { type: "string" },
      activityFamilyLabel: { type: "string" },
      sessionCount: { type: "integer", minimum: 0 },
      sessionShare: { type: "number", minimum: 0, maximum: 1 },
      activeDayCount: { type: "integer", minimum: 0 },
      totalDurationSeconds: { type: "number", minimum: 0 },
      durationShare: { type: "number", minimum: 0, maximum: 1 },
      averageSessionMinutes: { type: "number", minimum: 0 },
      totalEnergyKcal: nullable({ type: "number", minimum: 0 }),
      energyShare: { type: "number", minimum: 0, maximum: 1 },
      energyCoverage: { type: "number", minimum: 0, maximum: 1 },
      energyKcalPerHour: nullable({ type: "number", minimum: 0 }),
      distanceMeters: nullable({ type: "number", minimum: 0 }),
      distanceShare: { type: "number", minimum: 0, maximum: 1 },
      distanceCoverage: { type: "number", minimum: 0, maximum: 1 },
      averageSpeedKph: nullable({ type: "number", minimum: 0 }),
      totalTrainingLoad: nullable({ type: "number", minimum: 0 }),
      trainingLoadShare: { type: "number", minimum: 0, maximum: 1 },
      trainingLoadCoverage: { type: "number", minimum: 0, maximum: 1 },
      trainingLoadPerHour: nullable({ type: "number", minimum: 0 }),
      averageHeartRateCoverage: nullable({
        type: "number",
        minimum: 0,
        maximum: 1
      }),
      firstStartedAt: { type: "string", format: "date-time" },
      lastStartedAt: { type: "string", format: "date-time" }
    }
  };

  const sportComparisonPeriod = {
    type: "object",
    additionalProperties: false,
    required: [
      "key",
      "label",
      "requestedDays",
      "startedAt",
      "endedAt",
      "totals",
      "sports"
    ],
    properties: {
      key: { type: "string", enum: ["all", "365d", "90d"] },
      label: { type: "string" },
      requestedDays: nullable({ type: "integer", minimum: 1 }),
      startedAt: nullable({ type: "string", format: "date-time" }),
      endedAt: { type: "string", format: "date-time" },
      totals: {
        type: "object",
        additionalProperties: false,
        required: [
          "sessionCount",
          "sportCount",
          "activeDayCount",
          "totalDurationSeconds",
          "totalEnergyKcal",
          "energyCoverage",
          "totalDistanceMeters",
          "distanceCoverage",
          "totalTrainingLoad",
          "trainingLoadCoverage",
          "oldestStartedAt",
          "newestStartedAt"
        ],
        properties: {
          sessionCount: { type: "integer", minimum: 0 },
          sportCount: { type: "integer", minimum: 0 },
          activeDayCount: { type: "integer", minimum: 0 },
          totalDurationSeconds: { type: "number", minimum: 0 },
          totalEnergyKcal: nullable({ type: "number", minimum: 0 }),
          energyCoverage: { type: "number", minimum: 0, maximum: 1 },
          totalDistanceMeters: nullable({ type: "number", minimum: 0 }),
          distanceCoverage: { type: "number", minimum: 0, maximum: 1 },
          totalTrainingLoad: nullable({ type: "number", minimum: 0 }),
          trainingLoadCoverage: {
            type: "number",
            minimum: 0,
            maximum: 1
          },
          oldestStartedAt: nullable({ type: "string", format: "date-time" }),
          newestStartedAt: nullable({ type: "string", format: "date-time" })
        }
      },
      sports: arrayOf({ $ref: "#/components/schemas/SportComparisonEntry" })
    }
  };

  const sportComparison = {
    type: "object",
    additionalProperties: false,
    required: ["modelVersion", "generatedAt", "periods"],
    properties: {
      modelVersion: {
        type: "string",
        enum: ["forge-sport-comparison-v1"]
      },
      generatedAt: { type: "string", format: "date-time" },
      periods: arrayOf({ $ref: "#/components/schemas/SportComparisonPeriod" })
    }
  };

  const sleepViewData = {
    type: "object",
    additionalProperties: false,
    required: [
      "summary",
      "latestNightFreshness",
      "latestNight",
      "calendarDays",
      "weeklyTrend",
      "monthlyPattern",
      "stageAverages",
      "linkBreakdown",
      "sessionRelations",
      "sessions"
    ],
    properties: {
      summary: { type: "object", additionalProperties: true },
      latestNightFreshness: {
        type: "object",
        additionalProperties: false,
        required: [
          "status",
          "isCurrent",
          "expectedDateKey",
          "actualDateKey",
          "sourceTimezone",
          "missingDateKeys"
        ],
        properties: {
          status: {
            type: "string",
            enum: ["current", "stale", "empty", "future"]
          },
          isCurrent: { type: "boolean" },
          expectedDateKey: { type: "string" },
          actualDateKey: nullable({ type: "string" }),
          sourceTimezone: { type: "string" },
          missingDateKeys: arrayOf({ type: "string" })
        }
      },
      latestNight: nullable({
        type: "object",
        additionalProperties: true
      }),
      calendarDays: arrayOf({ type: "object", additionalProperties: true }),
      weeklyTrend: arrayOf({ type: "object", additionalProperties: true }),
      monthlyPattern: arrayOf({ type: "object", additionalProperties: true }),
      stageAverages: arrayOf({ type: "object", additionalProperties: true }),
      linkBreakdown: arrayOf({ type: "object", additionalProperties: true }),
      sessionRelations: arrayOf({
        type: "object",
        additionalProperties: false,
        required: ["sleepId", "representativeSleepId", "role", "overlapRatio"],
        properties: {
          sleepId: { type: "string" },
          representativeSleepId: { type: "string" },
          role: {
            type: "string",
            enum: ["representative", "overlapping_record", "additional_session"]
          },
          overlapRatio: { type: "number", minimum: 0, maximum: 1 }
        }
      }),
      sessions: arrayOf({ $ref: "#/components/schemas/SleepSession" })
    }
  };

  const fitnessViewData = {
    type: "object",
    additionalProperties: false,
    required: [
      "summary",
      "weeklyTrend",
      "typeBreakdown",
      "sportComparison",
      "vitalsTrend",
      "analysisSessions",
      "sessions"
    ],
    properties: {
      summary: { type: "object", additionalProperties: true },
      weeklyTrend: arrayOf({ type: "object", additionalProperties: true }),
      typeBreakdown: arrayOf({ type: "object", additionalProperties: true }),
      sportComparison: { $ref: "#/components/schemas/SportComparison" },
      vitalsTrend: arrayOf({ type: "object", additionalProperties: true }),
      analysisSessions: arrayOf({
        oneOf: [
          { $ref: "#/components/schemas/WorkoutSession" },
          { $ref: "#/components/schemas/WorkoutSessionSummary" },
          { $ref: "#/components/schemas/WorkoutAnalysisSession" }
        ]
      }),
      sessions: arrayOf({
        oneOf: [
          { $ref: "#/components/schemas/WorkoutSession" },
          { $ref: "#/components/schemas/WorkoutSessionSummary" }
        ]
      })
    }
  };

  const trainingLoadViewData = {
    type: "object",
    additionalProperties: false,
    required: [
      "summary",
      "zoneTotals",
      "recentZoneTotals",
      "intensityDistribution",
      "recentIntensityDistribution",
      "dailyLoad",
      "weeklyLoad",
      "zoneTimeSeries",
      "trainingIntelligence",
      "activityBreakdown",
      "vitalsTrend",
      "sessionSignals",
      "targetModel"
    ],
    properties: {
      summary: { type: "object", additionalProperties: true },
      zoneTotals: arrayOf({ type: "object", additionalProperties: true }),
      recentZoneTotals: arrayOf({ type: "object", additionalProperties: true }),
      intensityDistribution: arrayOf({
        type: "object",
        additionalProperties: true
      }),
      recentIntensityDistribution: arrayOf({
        type: "object",
        additionalProperties: true
      }),
      dailyLoad: arrayOf({ type: "object", additionalProperties: true }),
      weeklyLoad: arrayOf({ type: "object", additionalProperties: true }),
      zoneTimeSeries: {
        type: "object",
        additionalProperties: false,
        required: ["daily", "weekly", "monthly"],
        properties: {
          daily: arrayOf({ type: "object", additionalProperties: true }),
          weekly: arrayOf({ type: "object", additionalProperties: true }),
          monthly: arrayOf({ type: "object", additionalProperties: true })
        }
      },
      trainingIntelligence: { type: "object", additionalProperties: true },
      activityBreakdown: arrayOf({
        type: "object",
        additionalProperties: true
      }),
      vitalsTrend: arrayOf({ type: "object", additionalProperties: true }),
      sessionSignals: arrayOf({ type: "object", additionalProperties: true }),
      targetModel: { type: "object", additionalProperties: true }
    }
  };

  const nutritionMealItemInput = {
    type: "object",
    additionalProperties: false,
    required: ["name"],
    description:
      "Meal item input. Pass foodId from /foods/search or /foods/barcode when reusing a catalog food. If foodId is omitted, Forge treats the item as a custom food and requires calories, proteinGrams, carbohydrateGrams, and fatGrams.",
    properties: {
      id: { type: "string" },
      foodId: nullable({ type: "string" }),
      name: { type: "string" },
      brand: nullable({ type: "string" }),
      quantity: { type: "number", exclusiveMinimum: 0 },
      unit: { type: "string", minLength: 1 },
      grams: nullable({ type: "number" }),
      calories: nullable({ type: "number" }),
      caloriesKcal: nullable({ type: "number" }),
      proteinGrams: nullable({ type: "number" }),
      proteinG: nullable({ type: "number" }),
      carbohydrateGrams: nullable({ type: "number" }),
      carbsG: nullable({ type: "number" }),
      fatGrams: nullable({ type: "number" }),
      fatG: nullable({ type: "number" }),
      fiberGrams: nullable({ type: "number" }),
      fiberG: nullable({ type: "number" }),
      sugarGrams: nullable({ type: "number" }),
      sugarG: nullable({ type: "number" }),
      sodiumMg: nullable({ type: "number" }),
      potassiumMg: nullable({ type: "number" }),
      caffeineMg: nullable({ type: "number" }),
      alcoholGrams: nullable({ type: "number" }),
      alcoholG: nullable({ type: "number" }),
      tags: arrayOf({ type: "string" }),
      nutrients: { type: "object", additionalProperties: true },
      confidence: nullable({ type: "number", minimum: 0, maximum: 1 })
    }
  };

  const nutritionLinkInput = {
    type: "object",
    additionalProperties: false,
    required: ["entityType", "entityId"],
    properties: {
      entityType: { type: "string" },
      entityId: { type: "string" },
      relationshipType: { type: "string" }
    }
  };

  const nutritionFoodLogInput = {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      loggedAt: { type: "string", format: "date-time" },
      timeZone: {
        type: "string",
        description:
          "IANA timezone used to derive the local dayKey when dayKey is omitted."
      },
      mealLabel: { type: "string" },
      source: {
        type: "string",
        enum: ["manual", "search", "barcode", "chatgpt", "photo", "saved_meal"]
      },
      confirmationState: {
        type: "string",
        enum: ["candidate", "confirmed", "needs_review", "discarded"]
      },
      userId: { type: "string" },
      placeId: nullable({ type: "string" }),
      stayId: nullable({ type: "string" }),
      workoutId: nullable({ type: "string" }),
      sleepId: nullable({ type: "string" }),
      dayKey: nullable({
        type: "string",
        pattern: "^\\d{4}-\\d{2}-\\d{2}$"
      }),
      imageRefs: arrayOf({ type: "string" }),
      parserProvenance: { type: "object", additionalProperties: true },
      links: arrayOf(nutritionLinkInput),
      notes: { type: "string" },
      items: {
        type: "array",
        minItems: 1,
        items: nutritionMealItemInput
      }
    }
  };

  const {
    userId: _nutritionFoodLogUserId,
    ...nutritionFoodLogPatchProperties
  } = nutritionFoodLogInput.properties;
  const nutritionFoodLogPatchInput = {
    ...nutritionFoodLogInput,
    required: [],
    properties: {
      ...nutritionFoodLogPatchProperties,
      items: arrayOf(nutritionMealItemInput)
    }
  };

  const nutritionScoreInput = () =>
    nullable({ type: "integer", minimum: 0, maximum: 10 });

  const nutritionBodyCheckinInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      userId: { type: "string" },
      checkedAt: { type: "string", format: "date-time" },
      weightKg: nullable({ type: "number" }),
      waistCm: nullable({ type: "number" }),
      hipCm: nullable({ type: "number" }),
      neckCm: nullable({ type: "number" }),
      chestCm: nullable({ type: "number" }),
      armCm: nullable({ type: "number" }),
      thighCm: nullable({ type: "number" }),
      bodyFatPercent: nullable({ type: "number" }),
      clothingFitScore: nutritionScoreInput(),
      notes: { type: "string" }
    }
  };

  const nutritionAppearanceCheckinInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      userId: { type: "string" },
      checkedAt: { type: "string", format: "date-time" },
      photoRefs: arrayOf({ type: "string" }),
      facePuffiness: nutritionScoreInput(),
      leanness: nutritionScoreInput(),
      muscularity: nutritionScoreInput(),
      posture: nutritionScoreInput(),
      bloatingLook: nutritionScoreInput(),
      confidenceScore: nutritionScoreInput(),
      notes: { type: "string" }
    }
  };

  const nutritionSubjectiveCheckinInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      userId: { type: "string" },
      checkedAt: { type: "string", format: "date-time" },
      mealLogId: nullable({ type: "string" }),
      timeRelation: {
        type: "string",
        enum: [
          "before_meal",
          "with_meal",
          "after_2h",
          "end_of_day",
          "unspecified"
        ]
      },
      hunger: nutritionScoreInput(),
      fullness: nutritionScoreInput(),
      cravings: nutritionScoreInput(),
      mood: nutritionScoreInput(),
      energy: nutritionScoreInput(),
      focus: nutritionScoreInput(),
      stress: nutritionScoreInput(),
      sleepiness: nutritionScoreInput(),
      crashScore: nutritionScoreInput(),
      notes: { type: "string" }
    }
  };

  const nutritionGutCheckinInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      userId: { type: "string" },
      checkedAt: { type: "string", format: "date-time" },
      mealLogId: nullable({ type: "string" }),
      bristolStoolType: nullable({
        type: "integer",
        minimum: 1,
        maximum: 7
      }),
      stoolFrequency: nullable({ type: "number" }),
      bloating: nutritionScoreInput(),
      gas: nutritionScoreInput(),
      reflux: nutritionScoreInput(),
      abdominalPain: nutritionScoreInput(),
      urgency: nutritionScoreInput(),
      nausea: nutritionScoreInput(),
      constipation: nutritionScoreInput(),
      diarrhea: nutritionScoreInput(),
      triggerTags: arrayOf({ type: "string" }),
      notes: { type: "string" }
    }
  };

  const questionnaireAnswerInput = {
    type: "object",
    additionalProperties: false,
    required: ["itemId"],
    properties: {
      itemId: { type: "string" },
      optionKey: nullable({ type: "string" }),
      valueText: { type: "string" },
      numericValue: nullable({ type: "number" }),
      answer: { type: "object", additionalProperties: true }
    }
  };

  const questionnaireRunStartInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      versionId: nullable({ type: "string" }),
      userId: nullable({ type: "string" })
    }
  };

  const questionnaireRunUpdateInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      answers: arrayOf(questionnaireAnswerInput),
      progressIndex: nullable({ type: "integer", minimum: 0 })
    }
  };

  const questionnaireRevisionProperties = {
    expectedDraftVersionId: {
      type: "string",
      description: "The exact draft version returned by the latest read."
    },
    expectedDraftUpdatedAt: {
      type: "string",
      format: "date-time",
      description:
        "The exact draft revision timestamp returned by the latest read. A stale value returns questionnaire_draft_revision_conflict."
    }
  };

  const questionnaireEditableProperties = {
    title: { type: "string", minLength: 1 },
    subtitle: { type: "string" },
    description: { type: "string" },
    aliases: arrayOf({ type: "string" }),
    symptomDomains: arrayOf({ type: "string" }),
    tags: arrayOf({ type: "string" }),
    sourceClass: {
      type: "string",
      enum: [
        "public_domain",
        "free_use",
        "open_access",
        "open_noncommercial",
        "free_clinician",
        "secondary_verified"
      ]
    },
    availability: {
      type: "string",
      enum: ["open", "free_clinician", "custom"]
    },
    isSelfReport: { type: "boolean" },
    definition: { type: "object", additionalProperties: true },
    scoring: { type: "object", additionalProperties: true },
    provenance: { type: "object", additionalProperties: true }
  };

  const questionnaireInstrumentUpdateInput = {
    type: "object",
    additionalProperties: false,
    required: ["expectedDraftVersionId", "expectedDraftUpdatedAt"],
    properties: {
      ...questionnaireRevisionProperties,
      ...questionnaireEditableProperties
    },
    description:
      "One or more questionnaire fields to update plus the exact draft revision returned by the latest read."
  };

  const questionnaireDraftUpdateInput = {
    type: "object",
    additionalProperties: false,
    required: [
      "expectedDraftVersionId",
      "expectedDraftUpdatedAt",
      "title",
      "subtitle",
      "description",
      "aliases",
      "symptomDomains",
      "tags",
      "sourceClass",
      "availability",
      "isSelfReport",
      "label",
      "definition",
      "scoring",
      "provenance"
    ],
    properties: {
      ...questionnaireRevisionProperties,
      ...questionnaireEditableProperties,
      label: { type: "string" }
    },
    description:
      "The complete editable questionnaire draft plus its required optimistic-concurrency identity."
  };

  const questionnaireDraftPublishInput = {
    type: "object",
    additionalProperties: false,
    required: ["expectedDraftVersionId", "expectedDraftUpdatedAt"],
    properties: {
      expectedDraftVersionId: {
        type: "string",
        description: "The exact draft version to publish."
      },
      expectedDraftUpdatedAt: {
        type: "string",
        format: "date-time",
        description:
          "The exact revision timestamp of the reviewed draft. A stale value returns questionnaire_draft_revision_conflict."
      },
      label: { type: "string" }
    }
  };

  const nutritionFoodLog = {
    type: "object",
    additionalProperties: true,
    required: ["id", "loggedAt", "items", "totals"],
    properties: {
      id: { type: "string" },
      userId: { type: "string" },
      loggedAt: { type: "string", format: "date-time" },
      mealLabel: nullable({ type: "string" }),
      source: { type: "string" },
      confirmationState: { type: "string" },
      totals: { type: "object", additionalProperties: { type: "number" } },
      items: arrayOf({ type: "object", additionalProperties: true })
    }
  };

  const nutritionFoodSearchResult = {
    type: "object",
    additionalProperties: true,
    required: ["id", "source", "name"],
    properties: {
      id: { type: "string" },
      source: { type: "string" },
      sourceId: nullable({ type: "string" }),
      name: { type: "string" },
      brand: nullable({ type: "string" }),
      barcode: nullable({ type: "string" }),
      servingLabel: nullable({ type: "string" }),
      servingGrams: nullable({ type: "number" }),
      calories: nullable({ type: "number" }),
      proteinGrams: nullable({ type: "number" }),
      carbohydrateGrams: nullable({ type: "number" }),
      fatGrams: nullable({ type: "number" }),
      fiberGrams: nullable({ type: "number" }),
      tags: arrayOf({ type: "string" })
    }
  };

  const nutritionExperimentAdherence = {
    type: "object",
    additionalProperties: true,
    properties: {
      plannedExposures: { type: "integer", minimum: 0, maximum: 1000 },
      completedExposures: { type: "integer", minimum: 0, maximum: 1000 },
      baselineObservationCount: {
        type: "integer",
        minimum: 0,
        maximum: 1000
      },
      interventionObservationCount: {
        type: "integer",
        minimum: 0,
        maximum: 1000
      },
      notes: { type: "string", maxLength: 4000 }
    },
    description:
      "Observed adherence and evidence counts. Completed exposures cannot exceed planned exposures."
  };

  const nutritionExperimentInputProperties = {
    userId: { type: "string" },
    hypothesisId: nullable({ type: "string" }),
    title: { type: "string", minLength: 1 },
    status: {
      type: "string",
      enum: ["planned", "running", "paused", "completed", "abandoned"]
    },
    hypothesis: {
      type: "string",
      minLength: 1,
      description:
        "Testable expectation that the intervention may support or challenge."
    },
    metricKey: {
      type: "string",
      minLength: 1,
      description: "Primary outcome used to interpret the experiment."
    },
    intervention: {
      type: "string",
      minLength: 1,
      description: "Specific food, timing, or fueling change being tested."
    },
    baselineStart: nullable({ type: "string", format: "date" }),
    baselineEnd: nullable({ type: "string", format: "date" }),
    interventionStart: nullable({ type: "string", format: "date" }),
    interventionEnd: nullable({ type: "string", format: "date" }),
    experimentStart: nullable({
      type: "string",
      format: "date",
      description: "Alias for interventionStart."
    }),
    experimentEnd: nullable({
      type: "string",
      format: "date",
      description: "Alias for interventionEnd."
    }),
    successCriteria: nullable({ type: "string" }),
    confounders: arrayOf({ type: "string" }),
    trackedOutcomes: arrayOf({ type: "string" }),
    protocol: { type: "object", additionalProperties: true },
    adherence: nutritionExperimentAdherence,
    resultSummary: { type: "string" }
  };

  const nutritionExperimentInput = {
    type: "object",
    additionalProperties: false,
    required: ["title"],
    properties: nutritionExperimentInputProperties
  };

  const nutritionExperimentPatchInputProperties = Object.fromEntries(
    Object.entries(nutritionExperimentInputProperties).filter(
      ([key]) => key !== "userId"
    )
  );

  const nutritionExperimentPatchInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      ...nutritionExperimentPatchInputProperties,
      conclusion: nullable({
        type: "string",
        description:
          "Result conclusion. Stored as the experiment result summary."
      })
    }
  };

  const nutritionExperiment = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "userId",
      "hypothesisId",
      "title",
      "status",
      "hypothesis",
      "metricKey",
      "intervention",
      "baselineStart",
      "baselineEnd",
      "interventionStart",
      "interventionEnd",
      "experimentStart",
      "experimentEnd",
      "successCriteria",
      "confounders",
      "trackedOutcomes",
      "protocol",
      "adherence",
      "resultSummary",
      "conclusion",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      userId: { type: "string" },
      hypothesisId: nullable({ type: "string" }),
      title: { type: "string" },
      status: {
        type: "string",
        enum: ["planned", "running", "paused", "completed", "abandoned"]
      },
      hypothesis: nullable({ type: "string" }),
      metricKey: nullable({ type: "string" }),
      intervention: nullable({ type: "string" }),
      baselineStart: nullable({ type: "string" }),
      baselineEnd: nullable({ type: "string" }),
      interventionStart: nullable({ type: "string" }),
      interventionEnd: nullable({ type: "string" }),
      experimentStart: nullable({ type: "string" }),
      experimentEnd: nullable({ type: "string" }),
      successCriteria: nullable({ type: "string" }),
      confounders: arrayOf({ type: "string" }),
      trackedOutcomes: arrayOf({ type: "string" }),
      protocol: { type: "object", additionalProperties: true },
      adherence: nutritionExperimentAdherence,
      resultSummary: { type: "string" },
      conclusion: nullable({ type: "string" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const weightLossViewData = {
    type: "object",
    additionalProperties: false,
    required: [
      "userId",
      "generatedAt",
      "target",
      "summary",
      "todayLedger",
      "recentMeals",
      "energyModel",
      "weightTrend",
      "foodQuality",
      "trainingFuel",
      "subjective",
      "gut",
      "hypotheses",
      "experiments",
      "dataQuality"
    ],
    properties: {
      userId: { type: "string" },
      generatedAt: { type: "string", format: "date-time" },
      target: { type: "object", additionalProperties: true },
      summary: { type: "object", additionalProperties: true },
      todayLedger: { type: "object", additionalProperties: true },
      recentMeals: arrayOf(nutritionFoodLog),
      bodyCheckins: arrayOf({ type: "object", additionalProperties: true }),
      appearanceCheckins: arrayOf({
        type: "object",
        additionalProperties: true
      }),
      energyModel: { type: "object", additionalProperties: true },
      weightTrend: { type: "object", additionalProperties: true },
      foodQuality: { type: "object", additionalProperties: true },
      trainingFuel: { type: "object", additionalProperties: true },
      subjective: { type: "object", additionalProperties: true },
      gut: { type: "object", additionalProperties: true },
      hypotheses: arrayOf({ type: "object", additionalProperties: true }),
      experiments: arrayOf({
        $ref: "#/components/schemas/NutritionExperiment"
      }),
      dataQuality: { type: "object", additionalProperties: true }
    }
  };

  const entityLink = {
    type: "object",
    required: [
      "sourceEntityType",
      "sourceEntityId",
      "targetEntityType",
      "targetEntityId",
      "anchorKey",
      "relationship",
      "createdByActor",
      "createdAt"
    ],
    properties: {
      sourceEntityType: { type: "string" },
      sourceEntityId: { type: "string" },
      targetEntityType: { type: "string" },
      targetEntityId: { type: "string" },
      anchorKey: nullable({ type: "string" }),
      relationship: { type: "string" },
      createdByActor: nullable({ type: "string" }),
      createdAt: { type: "string", format: "date-time" }
    }
  };

  const entityLinkInput = {
    type: "object",
    required: ["entityType", "entityId"],
    properties: {
      entityType: { type: "string", minLength: 1, maxLength: 64 },
      entityId: { type: "string", minLength: 1, maxLength: 512 },
      anchorKey: { type: "string", maxLength: 256 },
      relationship: { type: "string", maxLength: 64, default: "related" }
    }
  };

  const artifactEntityLinkInputs = {
    ...arrayOf(entityLinkInput),
    maxItems: 100
  };

  const crudEntityType = {
    type: "string",
    enum: [
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
      "life_event",
      "artifact",
      "person",
      "psyche_value",
      "behavior_pattern",
      "behavior",
      "belief_entry",
      "mode_profile",
      "mode_guide_session",
      "flashcard",
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
    ]
  };

  const batchCreateEntitiesInput = {
    type: "object",
    additionalProperties: false,
    required: ["operations"],
    properties: {
      atomic: { type: "boolean", default: false },
      operations: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["entityType", "data"],
          properties: {
            entityType: { $ref: "#/components/schemas/CrudEntityType" },
            clientRef: { type: "string" },
            idempotencyKey: {
              type: "string",
              minLength: 1,
              maxLength: 128,
              description:
                "Stable key for one intended create. Reuse only for an exact retry. Event and emotion vocabulary keys remain consumed after hard deletion."
            },
            data: { type: "object", additionalProperties: true }
          }
        }
      }
    }
  };

  const batchUpdateEntitiesInput = {
    type: "object",
    additionalProperties: false,
    required: ["operations"],
    properties: {
      atomic: { type: "boolean", default: false },
      operations: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["entityType", "id", "patch"],
          properties: {
            entityType: { $ref: "#/components/schemas/CrudEntityType" },
            id: { type: "string", minLength: 1 },
            clientRef: { type: "string" },
            patch: { type: "object", additionalProperties: true }
          }
        }
      }
    }
  };

  const batchDeleteEntitiesInput = {
    type: "object",
    additionalProperties: false,
    required: ["operations"],
    properties: {
      atomic: { type: "boolean", default: false },
      operations: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["entityType", "id"],
          properties: {
            entityType: { $ref: "#/components/schemas/CrudEntityType" },
            id: { type: "string", minLength: 1 },
            clientRef: { type: "string" },
            mode: {
              type: "string",
              enum: ["soft", "hard"],
              default: "soft"
            },
            reason: { type: "string", default: "" }
          }
        }
      }
    }
  };

  const batchRestoreEntitiesInput = {
    type: "object",
    additionalProperties: false,
    required: ["operations"],
    properties: {
      atomic: { type: "boolean", default: false },
      operations: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["entityType", "id"],
          properties: {
            entityType: { $ref: "#/components/schemas/CrudEntityType" },
            id: { type: "string", minLength: 1 },
            clientRef: { type: "string" }
          }
        }
      }
    }
  };

  const batchSearchEntitiesInput = {
    type: "object",
    additionalProperties: false,
    required: ["searches"],
    properties: {
      searches: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            entityTypes: arrayOf({
              $ref: "#/components/schemas/CrudEntityType"
            }),
            query: { type: "string" },
            ids: arrayOf({ type: "string" }),
            status: arrayOf({ type: "string" }),
            linkedTo: {
              type: "object",
              additionalProperties: false,
              required: ["entityType", "id"],
              properties: {
                entityType: {
                  $ref: "#/components/schemas/CrudEntityType"
                },
                id: { type: "string", minLength: 1 }
              }
            },
            userIds: {
              ...arrayOf({ type: "string" }),
              description:
                "Optional effective owner scope. For event_type and emotion_definition, custom entries are filtered to these owners while built-ins remain visible."
            },
            includeDeleted: { type: "boolean", default: false },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 200,
              default: 25
            },
            clientRef: { type: "string" }
          }
        }
      }
    }
  };

  const preferenceCatalogLinkInputs = {
    ...arrayOf({ $ref: "#/components/schemas/EntityLinkInput" }),
    maxItems: 100,
    default: []
  };

  const preferenceCatalogCreateInput = {
    type: "object",
    additionalProperties: false,
    required: ["userId", "domain", "title"],
    properties: {
      userId: { type: "string", minLength: 1 },
      domain: { type: "string", enum: PREFERENCE_DOMAIN_VALUES },
      title: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 4000, default: "" },
      scopeIn: { type: "string", maxLength: 4000, default: "" },
      scopeOut: { type: "string", maxLength: 4000, default: "" },
      slug: { type: "string", maxLength: 64 },
      links: preferenceCatalogLinkInputs
    }
  };

  const preferenceCatalogPatchInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 4000 },
      scopeIn: { type: "string", maxLength: 4000 },
      scopeOut: { type: "string", maxLength: 4000 },
      slug: { type: "string", maxLength: 64 },
      links: {
        ...arrayOf({ $ref: "#/components/schemas/EntityLinkInput" }),
        maxItems: 100
      }
    }
  };

  const preferenceDimensionVector = {
    type: "object",
    additionalProperties: false,
    required: [
      "novelty",
      "simplicity",
      "rigor",
      "aesthetics",
      "depth",
      "structure",
      "familiarity",
      "surprise"
    ],
    properties: Object.fromEntries(
      [
        "novelty",
        "simplicity",
        "rigor",
        "aesthetics",
        "depth",
        "structure",
        "familiarity",
        "surprise"
      ].map((key) => [key, { type: "number", minimum: -1, maximum: 1 }])
    )
  };

  const preferenceDimensionVectorInput = {
    ...preferenceDimensionVector,
    required: []
  };

  const preferenceCatalogItem = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "catalogId",
      "label",
      "description",
      "tags",
      "featureWeights",
      "position",
      "archived",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      catalogId: { type: "string", minLength: 1 },
      label: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 4000 },
      tags: {
        ...arrayOf({ type: "string", minLength: 1, maxLength: 100 }),
        maxItems: 100
      },
      featureWeights: {
        $ref: "#/components/schemas/PreferenceDimensionVector"
      },
      position: { type: "integer", minimum: 0 },
      archived: { type: "boolean" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const preferenceCatalogItemCreateInput = {
    type: "object",
    additionalProperties: false,
    required: ["catalogId", "label"],
    properties: {
      catalogId: { type: "string", minLength: 1 },
      label: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 4000, default: "" },
      tags: {
        ...arrayOf({ type: "string", minLength: 1, maxLength: 100 }),
        maxItems: 100,
        default: []
      },
      featureWeights: {
        $ref: "#/components/schemas/PreferenceDimensionVectorInput"
      },
      position: { type: "integer", minimum: 0 }
    }
  };

  const preferenceCatalogItemPatchInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      label: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 4000 },
      tags: {
        ...arrayOf({ type: "string", minLength: 1, maxLength: 100 }),
        maxItems: 100
      },
      featureWeights: {
        $ref: "#/components/schemas/PreferenceDimensionVectorInput"
      },
      position: { type: "integer", minimum: 0 }
    }
  };

  const preferenceCatalog = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "profileId",
      "userId",
      "user",
      "domain",
      "slug",
      "title",
      "description",
      "scopeIn",
      "scopeOut",
      "source",
      "createdSource",
      "createdByActor",
      "archived",
      "createdAt",
      "updatedAt",
      "links",
      "items",
      "itemCount",
      "itemsTruncated"
    ],
    properties: {
      id: { type: "string" },
      profileId: { type: "string" },
      userId: { type: "string" },
      user: nullable({ $ref: "#/components/schemas/UserSummary" }),
      domain: { type: "string", enum: PREFERENCE_DOMAIN_VALUES },
      slug: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      scopeIn: { type: "string" },
      scopeOut: { type: "string" },
      source: { type: "string", enum: ["seeded", "custom"] },
      createdSource: {
        type: "string",
        enum: ["ui", "openclaw", "agent", "system", "unknown"]
      },
      createdByActor: nullable({ type: "string" }),
      archived: { type: "boolean" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      links: arrayOf({ $ref: "#/components/schemas/EntityLink" }),
      items: arrayOf({ $ref: "#/components/schemas/PreferenceCatalogItem" }),
      itemCount: { type: "integer", minimum: 0 },
      matchingItemCount: { type: "integer", minimum: 0 },
      itemsTruncated: { type: "boolean" }
    }
  };

  const preferenceProfile = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "userId",
      "domain",
      "defaultContextId",
      "modelVersion",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      userId: { type: "string", minLength: 1 },
      domain: { type: "string", enum: PREFERENCE_DOMAIN_VALUES },
      defaultContextId: nullable({ type: "string" }),
      modelVersion: { type: "string", minLength: 1 },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      user: nullable({ $ref: "#/components/schemas/UserSummary" })
    }
  };

  const preferenceContext = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "profileId",
      "name",
      "description",
      "shareMode",
      "active",
      "isDefault",
      "decayDays",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      profileId: { type: "string", minLength: 1 },
      name: { type: "string", minLength: 1 },
      description: { type: "string" },
      shareMode: {
        type: "string",
        enum: ["shared", "isolated", "blended"]
      },
      active: { type: "boolean" },
      isDefault: { type: "boolean" },
      decayDays: { type: "integer", minimum: 7, maximum: 365 },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const preferenceItem = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "profileId",
      "label",
      "description",
      "tags",
      "featureWeights",
      "metadata",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      profileId: { type: "string", minLength: 1 },
      label: { type: "string", minLength: 1 },
      description: { type: "string" },
      tags: arrayOf({ type: "string", minLength: 1 }),
      featureWeights: {
        $ref: "#/components/schemas/PreferenceDimensionVector"
      },
      sourceEntityType: nullable({
        $ref: "#/components/schemas/CrudEntityType"
      }),
      sourceEntityId: nullable({ type: "string" }),
      linkedEntity: nullable({
        type: "object",
        additionalProperties: false,
        required: ["entityType", "entityId"],
        properties: {
          entityType: { $ref: "#/components/schemas/CrudEntityType" },
          entityId: { type: "string", minLength: 1 }
        }
      }),
      metadata: { type: "object", additionalProperties: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const pairwisePreferenceJudgment = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "profileId",
      "contextId",
      "userId",
      "leftItemId",
      "rightItemId",
      "outcome",
      "strength",
      "responseTimeMs",
      "source",
      "reasonTags",
      "createdAt"
    ],
    properties: {
      id: { type: "string" },
      profileId: { type: "string", minLength: 1 },
      contextId: { type: "string", minLength: 1 },
      userId: { type: "string", minLength: 1 },
      leftItemId: { type: "string", minLength: 1 },
      rightItemId: { type: "string", minLength: 1 },
      outcome: { type: "string", enum: ["left", "right", "tie", "skip"] },
      strength: { type: "number", minimum: 0.5, maximum: 2 },
      responseTimeMs: nullable({ type: "integer", minimum: 0 }),
      source: { type: "string", minLength: 1 },
      reasonTags: arrayOf({ type: "string", minLength: 1 }),
      createdAt: { type: "string", format: "date-time" }
    }
  };

  const absolutePreferenceSignal = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "profileId",
      "contextId",
      "userId",
      "ownerUserId",
      "itemId",
      "signalType",
      "strength",
      "modelWeight",
      "source",
      "actor",
      "createdAt"
    ],
    properties: {
      id: { type: "string" },
      profileId: { type: "string", minLength: 1 },
      contextId: { type: "string", minLength: 1 },
      userId: { type: "string", minLength: 1 },
      ownerUserId: { type: "string", minLength: 1 },
      itemId: { type: "string", minLength: 1 },
      signalType: {
        type: "string",
        enum: [
          "favorite",
          "veto",
          "must_have",
          "bookmark",
          "neutral",
          "compare_later"
        ]
      },
      strength: { type: "number", minimum: 0.5, maximum: 2 },
      modelWeight: { type: "number" },
      source: { type: "string", minLength: 1 },
      actor: nullable({ type: "string" }),
      createdAt: { type: "string", format: "date-time" }
    }
  };

  const preferenceItemScore = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "profileId",
      "contextId",
      "itemId",
      "latentScore",
      "confidence",
      "uncertainty",
      "evidenceCount",
      "pairwiseWins",
      "pairwiseLosses",
      "pairwiseTies",
      "signalCount",
      "effectiveSignal",
      "conflictCount",
      "status",
      "dominantDimensions",
      "explanation",
      "bookmarked",
      "compareLater",
      "frozen",
      "lastInferredAt",
      "lastJudgmentAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      profileId: { type: "string", minLength: 1 },
      contextId: { type: "string", minLength: 1 },
      itemId: { type: "string", minLength: 1 },
      latentScore: { type: "number" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      uncertainty: { type: "number", minimum: 0, maximum: 1 },
      evidenceCount: { type: "integer", minimum: 0 },
      pairwiseWins: { type: "integer", minimum: 0 },
      pairwiseLosses: { type: "integer", minimum: 0 },
      pairwiseTies: { type: "integer", minimum: 0 },
      signalCount: { type: "integer", minimum: 0 },
      effectiveSignal: nullable({
        $ref: "#/components/schemas/AbsolutePreferenceSignal"
      }),
      conflictCount: { type: "integer", minimum: 0 },
      status: { type: "string", enum: PREFERENCE_ITEM_STATUS_VALUES },
      dominantDimensions: arrayOf({
        type: "string",
        enum: Object.keys(preferenceDimensionVector.properties)
      }),
      explanation: arrayOf({ type: "string" }),
      manualStatus: nullable({
        type: "string",
        enum: PREFERENCE_ITEM_STATUS_VALUES
      }),
      manualScore: nullable({ type: "number" }),
      confidenceLock: nullable({ type: "number", minimum: 0, maximum: 1 }),
      bookmarked: { type: "boolean" },
      compareLater: { type: "boolean" },
      frozen: { type: "boolean" },
      lastInferredAt: { type: "string", format: "date-time" },
      lastJudgmentAt: nullable({ type: "string", format: "date-time" }),
      updatedAt: { type: "string", format: "date-time" },
      item: { $ref: "#/components/schemas/PreferenceItem" }
    }
  };

  const preferenceDimensionSummary = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "profileId",
      "contextId",
      "dimensionId",
      "leaning",
      "confidence",
      "movement",
      "contextSensitivity",
      "evidenceCount",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      profileId: { type: "string" },
      contextId: { type: "string" },
      dimensionId: {
        type: "string",
        enum: Object.keys(preferenceDimensionVector.properties)
      },
      leaning: { type: "number", minimum: -1, maximum: 1 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      movement: { type: "number", minimum: -1, maximum: 1 },
      contextSensitivity: { type: "number", minimum: 0, maximum: 1 },
      evidenceCount: { type: "integer", minimum: 0 },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const preferenceSnapshot = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "profileId",
      "contextId",
      "summaryMetrics",
      "serializedModelState",
      "createdAt"
    ],
    properties: {
      id: { type: "string" },
      profileId: { type: "string" },
      contextId: { type: "string" },
      summaryMetrics: { type: "object", additionalProperties: true },
      serializedModelState: { type: "object", additionalProperties: true },
      createdAt: { type: "string", format: "date-time" }
    }
  };

  const preferenceMapPoint = {
    type: "object",
    additionalProperties: false,
    required: [
      "itemId",
      "label",
      "x",
      "y",
      "score",
      "confidence",
      "uncertainty",
      "status",
      "clusterKey",
      "tags"
    ],
    properties: {
      itemId: { type: "string" },
      label: { type: "string" },
      x: { type: "number" },
      y: { type: "number" },
      score: { type: "number" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      uncertainty: { type: "number", minimum: 0, maximum: 1 },
      status: { type: "string", enum: PREFERENCE_ITEM_STATUS_VALUES },
      clusterKey: { type: "string" },
      tags: arrayOf({ type: "string" }),
      sourceEntityType: nullable({
        $ref: "#/components/schemas/CrudEntityType"
      }),
      sourceEntityId: nullable({ type: "string" })
    }
  };

  const preferenceWorkspace = {
    type: "object",
    additionalProperties: false,
    required: [
      "profile",
      "selectedContext",
      "contexts",
      "catalogs",
      "dimensions",
      "scores",
      "map",
      "history",
      "presentation",
      "evidenceCoverage",
      "compare",
      "summary",
      "libraries"
    ],
    properties: {
      profile: { $ref: "#/components/schemas/PreferenceProfile" },
      selectedContext: { $ref: "#/components/schemas/PreferenceContext" },
      contexts: arrayOf({ $ref: "#/components/schemas/PreferenceContext" }),
      catalogs: arrayOf({ $ref: "#/components/schemas/PreferenceCatalog" }),
      dimensions: arrayOf({
        $ref: "#/components/schemas/PreferenceDimensionSummary"
      }),
      scores: arrayOf({ $ref: "#/components/schemas/PreferenceItemScore" }),
      map: arrayOf({ $ref: "#/components/schemas/PreferenceMapPoint" }),
      history: {
        type: "object",
        additionalProperties: false,
        required: [
          "judgments",
          "signals",
          "itemLabels",
          "snapshots",
          "staleItemIds",
          "flippedItemIds"
        ],
        properties: {
          judgments: arrayOf({
            $ref: "#/components/schemas/PairwisePreferenceJudgment"
          }),
          signals: arrayOf({
            $ref: "#/components/schemas/AbsolutePreferenceSignal"
          }),
          itemLabels: {
            type: "object",
            description:
              "Bounded labels for only the item identifiers referenced by the returned judgment and signal history window.",
            additionalProperties: { type: "string" }
          },
          snapshots: arrayOf({
            $ref: "#/components/schemas/PreferenceSnapshot"
          }),
          staleItemIds: arrayOf({ type: "string" }),
          flippedItemIds: arrayOf({ type: "string" })
        }
      },
      presentation: {
        type: "object",
        additionalProperties: false,
        required: [
          "itemLimit",
          "itemOffset",
          "totalItems",
          "returnedItems",
          "hasMore",
          "nextOffset",
          "historyLimit"
        ],
        properties: {
          itemLimit: { type: "integer", minimum: 1, maximum: 100 },
          itemOffset: { type: "integer", minimum: 0 },
          totalItems: { type: "integer", minimum: 0 },
          returnedItems: { type: "integer", minimum: 0 },
          hasMore: { type: "boolean" },
          nextOffset: nullable({ type: "integer", minimum: 0 }),
          historyLimit: { type: "integer", minimum: 1, maximum: 100 }
        }
      },
      evidenceCoverage: {
        type: "object",
        additionalProperties: false,
        required: [
          "judgmentLimitPerContext",
          "totalJudgments",
          "consideredJudgments",
          "truncated",
          "contexts"
        ],
        properties: {
          judgmentLimitPerContext: { type: "integer", minimum: 1 },
          totalJudgments: { type: "integer", minimum: 0 },
          consideredJudgments: { type: "integer", minimum: 0 },
          truncated: { type: "boolean" },
          contexts: arrayOf({
            type: "object",
            additionalProperties: false,
            required: [
              "contextId",
              "totalJudgments",
              "consideredJudgments",
              "truncated"
            ],
            properties: {
              contextId: { type: "string" },
              totalJudgments: { type: "integer", minimum: 0 },
              consideredJudgments: { type: "integer", minimum: 0 },
              truncated: { type: "boolean" }
            }
          })
        }
      },
      compare: {
        type: "object",
        additionalProperties: false,
        required: ["nextPair", "pendingCount", "candidateCount"],
        properties: {
          nextPair: nullable({
            type: "object",
            additionalProperties: false,
            required: ["left", "right", "rationale", "score"],
            properties: {
              left: { $ref: "#/components/schemas/PreferenceItem" },
              right: { $ref: "#/components/schemas/PreferenceItem" },
              rationale: arrayOf({ type: "string" }),
              score: { type: "number" }
            }
          }),
          pendingCount: { type: "integer", minimum: 0 },
          candidateCount: { type: "integer", minimum: 0 }
        }
      },
      summary: {
        type: "object",
        additionalProperties: false,
        required: [
          "totalItems",
          "likedCount",
          "dislikedCount",
          "uncertainCount",
          "bookmarkedCount",
          "vetoedCount",
          "averageConfidence",
          "pendingComparisons"
        ],
        properties: {
          totalItems: { type: "integer", minimum: 0 },
          likedCount: { type: "integer", minimum: 0 },
          dislikedCount: { type: "integer", minimum: 0 },
          uncertainCount: { type: "integer", minimum: 0 },
          bookmarkedCount: { type: "integer", minimum: 0 },
          vetoedCount: { type: "integer", minimum: 0 },
          averageConfidence: { type: "number", minimum: 0, maximum: 1 },
          pendingComparisons: { type: "integer", minimum: 0 }
        }
      },
      libraries: {
        type: "object",
        additionalProperties: false,
        required: [
          "totalCatalogs",
          "totalCatalogItems",
          "seededCatalogCount",
          "customCatalogCount"
        ],
        properties: {
          totalCatalogs: { type: "integer", minimum: 0 },
          totalCatalogItems: { type: "integer", minimum: 0 },
          seededCatalogCount: { type: "integer", minimum: 0 },
          customCatalogCount: { type: "integer", minimum: 0 }
        }
      }
    }
  };

  const preferenceContextCreateInput = {
    type: "object",
    additionalProperties: false,
    required: ["userId", "domain", "name"],
    properties: {
      userId: { type: "string", minLength: 1 },
      domain: { type: "string", enum: PREFERENCE_DOMAIN_VALUES },
      name: { type: "string", minLength: 1 },
      description: { type: "string", default: "" },
      shareMode: {
        type: "string",
        enum: ["shared", "isolated", "blended"],
        default: "blended"
      },
      active: { type: "boolean", default: true },
      isDefault: { type: "boolean", default: false },
      decayDays: { type: "integer", minimum: 7, maximum: 365, default: 90 }
    }
  };
  const preferenceContextPatchInput = {
    ...preferenceContextCreateInput,
    required: [],
    properties: Object.fromEntries(
      Object.entries(preferenceContextCreateInput.properties).filter(
        ([key]) => key !== "userId" && key !== "domain"
      )
    )
  };
  const preferenceItemCreateInput = {
    type: "object",
    additionalProperties: false,
    required: ["userId", "domain", "label"],
    properties: {
      userId: { type: "string", minLength: 1 },
      domain: { type: "string", enum: PREFERENCE_DOMAIN_VALUES },
      label: { type: "string", minLength: 1 },
      description: { type: "string", default: "" },
      tags: arrayOf({ type: "string", minLength: 1 }),
      featureWeights: {
        $ref: "#/components/schemas/PreferenceDimensionVectorInput"
      },
      sourceEntityType: nullable({
        $ref: "#/components/schemas/CrudEntityType"
      }),
      sourceEntityId: nullable({ type: "string", minLength: 1 }),
      metadata: { type: "object", additionalProperties: true },
      queueForCompare: { type: "boolean", default: true }
    }
  };
  const preferenceItemPatchInput = {
    ...preferenceItemCreateInput,
    required: [],
    properties: Object.fromEntries(
      Object.entries(preferenceItemCreateInput.properties).filter(
        ([key]) => key !== "userId" && key !== "domain"
      )
    )
  };
  const preferenceEntityEnqueueInput = {
    type: "object",
    additionalProperties: false,
    required: ["userId", "domain", "entityType", "entityId"],
    properties: {
      userId: { type: "string", minLength: 1 },
      domain: { type: "string", enum: PREFERENCE_DOMAIN_VALUES },
      entityType: { $ref: "#/components/schemas/CrudEntityType" },
      entityId: { type: "string", minLength: 1 },
      label: { type: "string" },
      description: { type: "string" },
      tags: arrayOf({ type: "string", minLength: 1 })
    }
  };
  const preferenceJudgmentInput = {
    type: "object",
    additionalProperties: false,
    required: [
      "userId",
      "domain",
      "contextId",
      "leftItemId",
      "rightItemId",
      "outcome"
    ],
    properties: {
      userId: { type: "string", minLength: 1 },
      domain: { type: "string", enum: PREFERENCE_DOMAIN_VALUES },
      contextId: { type: "string", minLength: 1 },
      leftItemId: { type: "string", minLength: 1 },
      rightItemId: { type: "string", minLength: 1 },
      outcome: { type: "string", enum: ["left", "right", "tie", "skip"] },
      strength: { type: "number", minimum: 0.5, maximum: 2, default: 1 },
      responseTimeMs: nullable({ type: "integer", minimum: 0 }),
      reasonTags: {
        ...arrayOf({ type: "string", minLength: 1 }),
        maxItems: 100
      }
    }
  };
  const preferenceSignalInput = {
    type: "object",
    additionalProperties: false,
    required: ["userId", "domain", "contextId", "itemId", "signalType"],
    properties: {
      userId: { type: "string", minLength: 1 },
      domain: { type: "string", enum: PREFERENCE_DOMAIN_VALUES },
      contextId: { type: "string", minLength: 1 },
      itemId: { type: "string", minLength: 1 },
      signalType: {
        ...absolutePreferenceSignal.properties.signalType,
        description:
          "The direct mark to make effective in this context. neutral clears the current direct effect while preserving prior signal history."
      },
      strength: { type: "number", minimum: 0.5, maximum: 2, default: 1 }
    }
  };
  const preferenceScorePatchInput = {
    type: "object",
    additionalProperties: false,
    required: ["userId", "domain", "contextId"],
    properties: {
      userId: { type: "string", minLength: 1 },
      domain: { type: "string", enum: PREFERENCE_DOMAIN_VALUES },
      contextId: { type: "string", minLength: 1 },
      manualStatus: nullable({
        type: "string",
        enum: PREFERENCE_ITEM_STATUS_VALUES
      }),
      manualScore: nullable({ type: "number" }),
      confidenceLock: nullable({ type: "number", minimum: 0, maximum: 1 }),
      bookmarked: { type: "boolean" },
      compareLater: { type: "boolean" },
      frozen: { type: "boolean" }
    }
  };
  const preferenceWorkspaceRefreshInput = {
    type: "object",
    additionalProperties: false,
    required: ["userId", "domain"],
    properties: {
      userId: { type: "string", minLength: 1 },
      domain: { type: "string", enum: PREFERENCE_DOMAIN_VALUES },
      contextId: { type: "string", minLength: 1 },
      itemLimit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      itemOffset: { type: "integer", minimum: 0, default: 0 },
      historyLimit: { type: "integer", minimum: 1, maximum: 100, default: 50 }
    }
  };
  const preferenceGameStartInput = {
    type: "object",
    additionalProperties: false,
    required: ["userId", "domain"],
    properties: {
      userId: { type: "string", minLength: 1 },
      domain: { type: "string", enum: PREFERENCE_DOMAIN_VALUES },
      contextId: { type: "string", minLength: 1 },
      catalogId: { type: "string", minLength: 1 }
    }
  };

  const lifeEventSegment = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "lifeEventId",
      "segmentType",
      "transportMode",
      "sequenceIndex",
      "title",
      "startsAt",
      "endsAt",
      "timezone",
      "originLabel",
      "originIata",
      "originIcao",
      "originCity",
      "originCountry",
      "originLatitude",
      "originLongitude",
      "destinationLabel",
      "destinationIata",
      "destinationIcao",
      "destinationCity",
      "destinationCountry",
      "destinationLatitude",
      "destinationLongitude",
      "carrierName",
      "carrierCode",
      "serviceNumber",
      "bookingReference",
      "terminal",
      "gate",
      "seat",
      "status",
      "statusSource",
      "statusCheckedAt",
      "routeGeometry",
      "metadata",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      lifeEventId: { type: "string" },
      segmentType: {
        type: "string",
        enum: [
          "flight",
          "train",
          "car",
          "boat",
          "walking",
          "lodging",
          "activity",
          "checkpoint",
          "custom"
        ]
      },
      transportMode: nullable({
        type: "string",
        enum: [
          "plane",
          "train",
          "car",
          "boat",
          "walking",
          "public_transit",
          "other"
        ]
      }),
      sequenceIndex: { type: "integer", minimum: 0 },
      title: { type: "string" },
      startsAt: nullable({ type: "string", format: "date-time" }),
      endsAt: nullable({ type: "string", format: "date-time" }),
      timezone: { type: "string" },
      originLabel: { type: "string" },
      originIata: { type: "string" },
      originIcao: { type: "string" },
      originCity: { type: "string" },
      originCountry: { type: "string" },
      originLatitude: nullable({ type: "number" }),
      originLongitude: nullable({ type: "number" }),
      destinationLabel: { type: "string" },
      destinationIata: { type: "string" },
      destinationIcao: { type: "string" },
      destinationCity: { type: "string" },
      destinationCountry: { type: "string" },
      destinationLatitude: nullable({ type: "number" }),
      destinationLongitude: nullable({ type: "number" }),
      carrierName: { type: "string" },
      carrierCode: { type: "string" },
      serviceNumber: { type: "string" },
      bookingReference: { type: "string" },
      terminal: { type: "string" },
      gate: { type: "string" },
      seat: { type: "string" },
      status: { type: "string" },
      statusSource: { type: "string" },
      statusCheckedAt: nullable({ type: "string", format: "date-time" }),
      routeGeometry: { type: "object", additionalProperties: true },
      metadata: { type: "object", additionalProperties: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const lifeEvent = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "title",
      "shortDescription",
      "description",
      "eventType",
      "status",
      "importance",
      "startsAt",
      "endsAt",
      "timezone",
      "isAllDay",
      "placeLabel",
      "placeAddress",
      "placeTimezone",
      "placeLatitude",
      "placeLongitude",
      "originLabel",
      "originCity",
      "originCountry",
      "originLatitude",
      "originLongitude",
      "destinationLabel",
      "destinationCity",
      "destinationCountry",
      "destinationLatitude",
      "destinationLongitude",
      "transportMode",
      "primaryCalendarEventId",
      "calendarSyncState",
      "calendarMatchConfidence",
      "sourceKind",
      "sourceArtifactId",
      "extractionStatus",
      "extractionSummary",
      "travelDetails",
      "displayStyle",
      "metadata",
      "segments",
      "links",
      "deletedAt",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      shortDescription: { type: "string" },
      description: { type: "string" },
      eventType: {
        type: "string",
        enum: [
          "travel_flight",
          "travel_train",
          "travel_car",
          "travel_boat",
          "travel_trip",
          "travel_day",
          "stay",
          "lodging",
          "holiday",
          "vacation",
          "visit",
          "move",
          "festival",
          "conference",
          "retreat",
          "concert",
          "cinema",
          "meal",
          "party",
          "ceremony",
          "date",
          "friends",
          "family",
          "work_milestone",
          "work_phase",
          "thesis_milestone",
          "creative_work",
          "class_course",
          "exam",
          "deadline",
          "medical",
          "health_episode",
          "therapy",
          "administrative",
          "legal_financial",
          "errand",
          "celebration",
          "memory",
          "custom"
        ]
      },
      status: {
        type: "string",
        enum: ["planned", "happening", "completed", "cancelled", "tentative"]
      },
      importance: {
        type: "string",
        enum: ["ordinary", "meaningful", "major", "life_changing"]
      },
      startsAt: { type: "string", format: "date-time" },
      endsAt: { type: "string", format: "date-time" },
      timezone: { type: "string" },
      isAllDay: { type: "boolean" },
      placeLabel: { type: "string" },
      placeAddress: { type: "string" },
      placeTimezone: { type: "string" },
      placeLatitude: nullable({ type: "number" }),
      placeLongitude: nullable({ type: "number" }),
      originLabel: { type: "string" },
      originCity: { type: "string" },
      originCountry: { type: "string" },
      originLatitude: nullable({ type: "number" }),
      originLongitude: nullable({ type: "number" }),
      destinationLabel: { type: "string" },
      destinationCity: { type: "string" },
      destinationCountry: { type: "string" },
      destinationLatitude: nullable({ type: "number" }),
      destinationLongitude: nullable({ type: "number" }),
      transportMode: nullable({
        type: "string",
        enum: [
          "plane",
          "train",
          "car",
          "boat",
          "walking",
          "public_transit",
          "other"
        ]
      }),
      primaryCalendarEventId: nullable({ type: "string" }),
      calendarSyncState: {
        type: "string",
        enum: [
          "not_synced",
          "linked",
          "matched",
          "created",
          "disabled",
          "needs_review",
          "error"
        ]
      },
      calendarMatchConfidence: nullable({
        type: "number",
        minimum: 0,
        maximum: 1
      }),
      sourceKind: {
        type: "string",
        enum: ["manual", "calendar", "artifact_ticket", "agent", "import"]
      },
      sourceArtifactId: nullable({ type: "string" }),
      extractionStatus: {
        type: "string",
        enum: [
          "none",
          "pending",
          "drafted",
          "confirmed",
          "failed",
          "llm_unavailable"
        ]
      },
      extractionSummary: { type: "object", additionalProperties: true },
      travelDetails: { type: "object", additionalProperties: true },
      displayStyle: { type: "object", additionalProperties: true },
      metadata: { type: "object", additionalProperties: true },
      segments: arrayOf({ $ref: "#/components/schemas/LifeEventSegment" }),
      links: arrayOf({ $ref: "#/components/schemas/EntityLink" }),
      deletedAt: nullable({ type: "string", format: "date-time" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const lifeEventTimelinePayload = {
    type: "object",
    additionalProperties: false,
    required: [
      "events",
      "now",
      "nextLifeEventId",
      "limit",
      "offset",
      "total",
      "hasMore",
      "counts"
    ],
    properties: {
      events: arrayOf({ $ref: "#/components/schemas/LifeEvent" }),
      now: { type: "string", format: "date-time" },
      nextLifeEventId: nullable({ type: "string" }),
      limit: { type: "integer", minimum: 1, maximum: 500 },
      offset: { type: "integer", minimum: 0 },
      total: { type: "integer", minimum: 0 },
      hasMore: { type: "boolean" },
      counts: {
        type: "object",
        additionalProperties: false,
        required: ["past", "current", "upcoming"],
        properties: {
          past: { type: "integer", minimum: 0 },
          current: { type: "integer", minimum: 0 },
          upcoming: { type: "integer", minimum: 0 }
        }
      }
    }
  };

  const lifeEventCalendarSyncInput = {
    type: "object",
    properties: {
      projection: {
        type: "string",
        enum: ["link_or_create", "link_existing_only", "none"],
        default: "link_or_create"
      },
      preferredCalendarId: nullable({ type: "string" })
    }
  };

  const lifeEventFromCalendarInput = {
    type: "object",
    required: ["calendarEventId"],
    properties: {
      calendarEventId: { type: "string" },
      eventType: { type: "string", default: "custom" },
      importance: { type: "string", default: "meaningful" }
    }
  };

  const lifeEventTicketImportInput = {
    type: "object",
    additionalProperties: false,
    required: ["artifactId"],
    properties: {
      artifactId: { type: "string" },
      createDraft: { type: "boolean", default: false },
      useLlm: { type: "boolean", default: false },
      llmProfileId: { type: "string" }
    }
  };

  const artifactScanFinding = {
    type: "object",
    additionalProperties: false,
    required: ["code", "severity", "message"],
    properties: {
      code: { type: "string" },
      severity: {
        type: "string",
        enum: ["info", "low", "moderate", "high", "blocked"]
      },
      message: { type: "string" }
    }
  };

  const artifactScanResult = {
    type: "object",
    additionalProperties: false,
    required: [
      "scannedAt",
      "scannerVersion",
      "declaredExtension",
      "detectedMimeType",
      "extensionAllowed",
      "byteSize",
      "findings",
      "extractedTextAvailable",
      "extractedTextTruncated"
    ],
    properties: {
      scannedAt: { type: "string", format: "date-time" },
      scannerVersion: { type: "string" },
      declaredExtension: { type: "string" },
      detectedMimeType: { type: "string" },
      extensionAllowed: { type: "boolean" },
      byteSize: { type: "integer" },
      findings: arrayOf(artifactScanFinding),
      extractedTextAvailable: {
        type: "boolean",
        description:
          "Whether static scanning found text that may be used transiently by internal enrichment. Extracted plaintext is never persisted or returned."
      },
      extractedTextTruncated: { type: "boolean" }
    }
  };

  const artifactContentProtection = {
    type: "object",
    additionalProperties: false,
    required: [
      "mode",
      "encryptedAt",
      "algorithm",
      "kdf",
      "kdfParams",
      "passwordHint"
    ],
    properties: {
      mode: { type: "string", enum: ["plaintext", "password_encrypted"] },
      encryptedAt: nullable({ type: "string", format: "date-time" }),
      algorithm: nullable({
        type: "string",
        enum: ["libsodium-secretstream-xchacha20poly1305"]
      }),
      kdf: nullable({ type: "string", enum: ["argon2id"] }),
      kdfParams: nullable({
        type: "object",
        additionalProperties: false,
        required: ["memlimit", "opslimit", "parallelism"],
        properties: {
          memlimit: { type: "integer", minimum: 19922944 },
          opslimit: { type: "integer", minimum: 2 },
          parallelism: { type: "integer", enum: [1] }
        }
      }),
      passwordHint: nullable({ type: "string" })
    },
    description:
      "Safe content-protection metadata. It never includes password, salt, derived key, ciphertext header, plaintext snippets, or decrypted bytes."
  };

  const artifact = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "title",
      "shortDescription",
      "description",
      "originalFileName",
      "contentSha256",
      "byteSize",
      "storedContentSha256",
      "storedByteSize",
      "contentProtection",
      "detectedExtension",
      "declaredMimeType",
      "detectedMimeType",
      "formatFamily",
      "sourceKind",
      "sourceLabel",
      "uploadedByUserId",
      "uploadedByAgentId",
      "actingForUserId",
      "artifactState",
      "dangerScore",
      "dangerLevel",
      "downloadPolicy",
      "scanResults",
      "enrichmentResults",
      "metadata",
      "links",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      shortDescription: { type: "string" },
      description: { type: "string" },
      originalFileName: { type: "string" },
      contentSha256: { type: "string" },
      byteSize: { type: "integer" },
      storedContentSha256: { type: "string" },
      storedByteSize: { type: "integer" },
      contentProtection: artifactContentProtection,
      detectedExtension: { type: "string" },
      declaredMimeType: { type: "string" },
      detectedMimeType: { type: "string" },
      formatFamily: {
        type: "string",
        enum: [
          "spreadsheet",
          "document",
          "presentation",
          "pdf",
          "text",
          "structured_text",
          "image"
        ]
      },
      sourceKind: {
        type: "string",
        enum: [
          "upload",
          "agent_upload",
          "wiki_ingest",
          "external_reference",
          "manual"
        ]
      },
      sourceLabel: { type: "string" },
      uploadedByUserId: nullable({ type: "string" }),
      uploadedByAgentId: nullable({ type: "string" }),
      actingForUserId: nullable({ type: "string" }),
      artifactState: {
        type: "string",
        enum: ["active", "quarantined", "blocked", "archived", "metadata_only"]
      },
      dangerScore: { type: "integer", minimum: 0, maximum: 100 },
      dangerLevel: {
        type: "string",
        enum: ["low", "moderate", "high", "blocked"]
      },
      downloadPolicy: { type: "string", enum: ["human_only", "disabled"] },
      scanResults: artifactScanResult,
      enrichmentResults: { type: "object", additionalProperties: true },
      metadata: { type: "object", additionalProperties: true },
      links: arrayOf(entityLink),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const artifactSummary = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "title",
      "shortDescription",
      "originalFileName",
      "byteSize",
      "contentProtection",
      "detectedExtension",
      "formatFamily",
      "sourceKind",
      "sourceLabel",
      "artifactState",
      "dangerScore",
      "dangerLevel",
      "downloadPolicy",
      "links",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: artifact.properties.id,
      title: artifact.properties.title,
      shortDescription: artifact.properties.shortDescription,
      originalFileName: artifact.properties.originalFileName,
      byteSize: artifact.properties.byteSize,
      contentProtection: artifactContentProtection,
      detectedExtension: artifact.properties.detectedExtension,
      formatFamily: artifact.properties.formatFamily,
      sourceKind: artifact.properties.sourceKind,
      sourceLabel: artifact.properties.sourceLabel,
      artifactState: artifact.properties.artifactState,
      dangerScore: artifact.properties.dangerScore,
      dangerLevel: artifact.properties.dangerLevel,
      downloadPolicy: artifact.properties.downloadPolicy,
      links: artifact.properties.links,
      createdAt: artifact.properties.createdAt,
      updatedAt: artifact.properties.updatedAt
    },
    description:
      "Compact artifact metadata for bounded list responses. Read /api/v1/artifacts/{id} for full hashes, scanner evidence, enrichment, and user metadata. Physical storage paths and byte locators are never part of this public contract."
  };

  const artifactListResponse = {
    type: "object",
    additionalProperties: false,
    required: ["artifacts", "total", "limit", "offset", "hasMore"],
    properties: {
      artifacts: arrayOf({ $ref: "#/components/schemas/ArtifactSummary" }),
      total: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      offset: { type: "integer", minimum: 0 },
      hasMore: { type: "boolean" }
    }
  };

  const artifactUploadInput = {
    type: "object",
    additionalProperties: false,
    required: ["originalFileName", "contentBase64"],
    properties: {
      idempotencyKey: {
        type: "string",
        minLength: 8,
        maxLength: 200,
        pattern: "^[A-Za-z0-9._:-]+$",
        description:
          "Stable per-file retry key for MCP and plugin wrappers that cannot set request headers. When both forms are present it must equal Idempotency-Key."
      },
      title: { type: "string" },
      shortDescription: { type: "string" },
      description: { type: "string" },
      originalFileName: { type: "string" },
      declaredMimeType: { type: "string" },
      contentBase64: {
        type: "string",
        minLength: 4,
        pattern:
          "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
        description:
          "Non-empty canonical base64 file bytes without whitespace. Malformed, non-canonical, or zero-byte payloads return 400 artifact_invalid_base64. Forge stores and statically scans bytes; agents must not execute or open file contents."
      },
      sourceKind: {
        type: "string",
        enum: [
          "upload",
          "agent_upload",
          "wiki_ingest",
          "external_reference",
          "manual"
        ]
      },
      sourceLabel: { type: "string" },
      uploadedByUserId: nullable({ type: "string" }),
      uploadedByAgentId: nullable({ type: "string" }),
      actingForUserId: nullable({ type: "string" }),
      downloadPolicy: { type: "string", enum: ["human_only", "disabled"] },
      links: artifactEntityLinkInputs,
      metadata: { type: "object", additionalProperties: true },
      contentProtection: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            properties: {
              mode: {
                type: "string",
                enum: ["plaintext"],
                default: "plaintext"
              }
            }
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["mode", "password"],
            properties: {
              mode: { type: "string", enum: ["password_encrypted"] },
              password: {
                type: "string",
                description:
                  "Transient operator-entered password. Forge never returns, logs, or persists this value."
              },
              passwordHint: {
                type: "string",
                description:
                  "Optional safe hint visible in metadata responses. Do not put the password here."
              }
            }
          }
        ]
      },
      useLlmEnrichment: { type: "boolean" },
      llmProfileId: { type: "string" }
    }
  };

  const artifactPasswordDownloadInput = {
    type: "object",
    properties: {
      password: {
        type: "string",
        description:
          "Transient operator-entered password for encrypted artifact download. It is never stored or returned."
      }
    }
  };

  const artifactEncryptInput = {
    type: "object",
    required: ["password"],
    properties: {
      password: {
        type: "string",
        description:
          "Transient operator-entered password for encrypting existing plaintext artifact content. It is never stored or returned."
      },
      passwordHint: {
        type: "string",
        description:
          "Optional safe hint visible in metadata responses. Do not put the password here."
      }
    }
  };

  const artifactMetadataPatchInput = {
    type: "object",
    properties: {
      title: { type: "string" },
      shortDescription: { type: "string" },
      description: { type: "string" },
      sourceLabel: { type: "string" },
      links: artifactEntityLinkInputs,
      metadata: { type: "object", additionalProperties: true }
    }
  };

  const artifactTrustPatchInput = {
    type: "object",
    required: ["artifactState", "reason"],
    properties: {
      artifactState: {
        type: "string",
        enum: ["active", "quarantined", "blocked", "archived", "metadata_only"]
      },
      reason: { type: "string" },
      downloadPolicy: { type: "string", enum: ["human_only", "disabled"] }
    }
  };

  const artifactEnrichmentInput = {
    type: "object",
    additionalProperties: false,
    properties: {
      llmProfileId: { type: "string" },
      fillMissingOnly: { type: "boolean", default: true },
      explicitApiKey: {
        type: "string",
        description:
          "Optional transient key for the selected LLM provider. It is not persisted by Forge."
      }
    }
  };

  const artifactEnrichmentApplyInput = {
    type: "object",
    additionalProperties: false,
    required: ["proposalId"],
    properties: {
      proposalId: {
        type: "string",
        minLength: 1,
        maxLength: 128,
        description:
          "Exact current proposal identifier returned by the enrichment request after human review."
      }
    }
  };

  const artifactVersion = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "artifactId",
      "versionNumber",
      "contentSha256",
      "byteSize",
      "storedContentSha256",
      "storedByteSize",
      "contentProtection",
      "originalFileName",
      "scanResults",
      "enrichmentResults",
      "createdByActor",
      "createdAt"
    ],
    properties: {
      id: { type: "string" },
      artifactId: { type: "string" },
      versionNumber: { type: "integer" },
      contentSha256: { type: "string" },
      byteSize: { type: "integer" },
      storedContentSha256: { type: "string" },
      storedByteSize: { type: "integer" },
      contentProtection: artifactContentProtection,
      originalFileName: { type: "string" },
      scanResults: artifactScanResult,
      enrichmentResults: { type: "object", additionalProperties: true },
      createdByActor: nullable({ type: "string" }),
      createdAt: { type: "string", format: "date-time" }
    }
  };

  const artifactAuditEvent = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "artifactId",
      "eventType",
      "actor",
      "source",
      "metadata",
      "createdAt"
    ],
    properties: {
      id: { type: "string" },
      artifactId: { type: "string" },
      eventType: { type: "string" },
      actor: nullable({ type: "string" }),
      source: { type: "string", enum: ["ui", "openclaw", "agent", "system"] },
      metadata: { type: "object", additionalProperties: true },
      createdAt: { type: "string", format: "date-time" }
    }
  };

  const artifactVersionPage = {
    type: "object",
    additionalProperties: false,
    required: ["versions", "total", "limit", "offset", "hasMore"],
    properties: {
      versions: arrayOf({ $ref: "#/components/schemas/ArtifactVersion" }),
      total: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      offset: { type: "integer", minimum: 0 },
      hasMore: { type: "boolean" }
    }
  };

  const artifactAuditEventPage = {
    type: "object",
    additionalProperties: false,
    required: ["events", "total", "limit", "offset", "hasMore"],
    properties: {
      events: arrayOf({ $ref: "#/components/schemas/ArtifactAuditEvent" }),
      total: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      offset: { type: "integer", minimum: 0 },
      hasMore: { type: "boolean" }
    }
  };

  const workbenchRun = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "connectorId",
      "mode",
      "status",
      "userInput",
      "inputs",
      "context",
      "conversationId",
      "retryOfRunId",
      "flowSnapshot",
      "result",
      "error",
      "createdAt",
      "completedAt"
    ],
    properties: {
      id: { type: "string", minLength: 1 },
      connectorId: { type: "string", minLength: 1 },
      mode: { type: "string", enum: ["run", "chat"] },
      status: { type: "string", enum: ["running", "completed", "failed"] },
      userInput: { type: "string" },
      inputs: { type: "object", additionalProperties: true },
      context: { type: "object", additionalProperties: true },
      conversationId: nullable({ type: "string" }),
      retryOfRunId: nullable({ type: "string" }),
      flowSnapshot: nullable({
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "updatedAt",
          "graph",
          "publicInputs",
          "publishedOutputs"
        ],
        properties: {
          title: { type: "string" },
          updatedAt: { type: "string", format: "date-time" },
          graph: { type: "object", additionalProperties: true },
          publicInputs: arrayOf({ type: "object", additionalProperties: true }),
          publishedOutputs: arrayOf({
            type: "object",
            additionalProperties: true
          })
        }
      }),
      result: nullable({ type: "object", additionalProperties: true }),
      error: nullable({ type: "string" }),
      createdAt: { type: "string", format: "date-time" },
      completedAt: nullable({ type: "string", format: "date-time" })
    }
  };

  const workbenchRunSummary = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "connectorId",
      "mode",
      "status",
      "conversationId",
      "retryOfRunId",
      "outputPreview",
      "result",
      "hasResult",
      "error",
      "flowUpdatedAt",
      "createdAt",
      "completedAt"
    ],
    properties: {
      id: { type: "string", minLength: 1 },
      connectorId: { type: "string", minLength: 1 },
      mode: { type: "string", enum: ["run", "chat"] },
      status: { type: "string", enum: ["running", "completed", "failed"] },
      conversationId: nullable({ type: "string" }),
      retryOfRunId: nullable({ type: "string" }),
      outputPreview: { type: "string", maxLength: 332 },
      result: nullable({
        type: "object",
        additionalProperties: false,
        required: ["primaryText"],
        properties: {
          primaryText: { type: "string", maxLength: 332 }
        }
      }),
      hasResult: { type: "boolean" },
      error: nullable({ type: "string", maxLength: 512 }),
      flowUpdatedAt: nullable({ type: "string", format: "date-time" }),
      createdAt: { type: "string", format: "date-time" },
      completedAt: nullable({ type: "string", format: "date-time" })
    }
  };

  const workbenchReadMetadata = {
    type: "object",
    additionalProperties: false,
    required: [
      "contentType",
      "originalBytes",
      "returnedBytes",
      "redacted",
      "redactedPaths",
      "truncated"
    ],
    properties: {
      contentType: { type: "string", enum: ["text", "json", "mixed"] },
      originalBytes: { type: "integer", minimum: 0 },
      returnedBytes: { type: "integer", minimum: 0 },
      redacted: { type: "boolean" },
      redactedPaths: arrayOf({ type: "string" }),
      truncated: { type: "boolean" }
    }
  };

  const workbenchNodeResultSummary = {
    type: "object",
    additionalProperties: false,
    required: [
      "nodeId",
      "nodeType",
      "label",
      "outputKeys",
      "outputPreview",
      "hasPayload",
      "error",
      "timingMs"
    ],
    properties: {
      nodeId: { type: "string" },
      nodeType: { type: "string" },
      label: { type: "string" },
      outputKeys: arrayOf({ type: "string" }),
      outputPreview: { type: "string", maxLength: 332 },
      hasPayload: { type: "boolean" },
      error: nullable({ type: "string" }),
      timingMs: nullable({ type: "integer", minimum: 0 })
    }
  };

  const workbenchRunPage = {
    type: "object",
    required: ["runs", "total", "limit", "offset", "hasMore"],
    properties: {
      runs: arrayOf({ $ref: "#/components/schemas/WorkbenchRunSummary" }),
      total: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      offset: { type: "integer", minimum: 0 },
      hasMore: { type: "boolean" }
    }
  };

  const workbenchCatalogFacet = {
    type: "object",
    additionalProperties: false,
    required: ["value", "label", "count"],
    properties: {
      value: { type: "string" },
      label: { type: "string" },
      count: { type: "integer", minimum: 0 }
    }
  };

  const workbenchFlowCatalogItem = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "slug",
      "title",
      "description",
      "descriptionTruncated",
      "kind",
      "homeSurfaceId",
      "endpointEnabled",
      "status",
      "nodeCount",
      "edgeCount",
      "publicInputCount",
      "publishedOutputCount",
      "lastRunStatus",
      "lastRunAt",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { type: "string", minLength: 1 },
      slug: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1 },
      description: { type: "string", maxLength: 601 },
      descriptionTruncated: { type: "boolean" },
      kind: { type: "string", enum: ["functor", "chat"] },
      homeSurfaceId: nullable({ type: "string" }),
      endpointEnabled: { type: "boolean" },
      status: { type: "string", enum: ["enabled", "disabled"] },
      nodeCount: { type: "integer", minimum: 0 },
      edgeCount: { type: "integer", minimum: 0 },
      publicInputCount: { type: "integer", minimum: 0 },
      publishedOutputCount: { type: "integer", minimum: 0 },
      lastRunStatus: nullable({
        type: "string",
        enum: ["running", "completed", "failed"]
      }),
      lastRunAt: nullable({ type: "string", format: "date-time" }),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }
  };

  const workbenchFlowCatalogPage = {
    type: "object",
    additionalProperties: false,
    required: ["flows", "total", "limit", "offset", "hasMore", "facets"],
    properties: {
      flows: arrayOf({ $ref: "#/components/schemas/WorkbenchFlowCatalogItem" }),
      total: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      offset: { type: "integer", minimum: 0 },
      hasMore: { type: "boolean" },
      facets: {
        type: "object",
        additionalProperties: false,
        required: ["kinds", "homeSurfaces", "statuses"],
        properties: {
          kinds: arrayOf({
            $ref: "#/components/schemas/WorkbenchCatalogFacet"
          }),
          homeSurfaces: arrayOf({
            $ref: "#/components/schemas/WorkbenchCatalogFacet"
          }),
          statuses: arrayOf({
            $ref: "#/components/schemas/WorkbenchCatalogFacet"
          })
        }
      }
    }
  };

  const workbenchBoxPort = {
    type: "object",
    additionalProperties: false,
    required: ["key", "label", "kind", "required", "expandableKeys", "shape"],
    properties: {
      key: { type: "string", minLength: 1 },
      label: { type: "string", minLength: 1 },
      kind: { type: "string" },
      description: { type: "string" },
      required: { type: "boolean" },
      expandableKeys: arrayOf({ type: "string" }),
      modelName: { type: "string" },
      itemKind: { type: "string" },
      shape: arrayOf({ type: "object", additionalProperties: true }),
      exampleValue: { type: "string" }
    }
  };

  const workbenchBoxTool = {
    type: "object",
    additionalProperties: false,
    required: ["key", "label", "description", "accessMode"],
    properties: {
      key: { type: "string", minLength: 1 },
      label: { type: "string", minLength: 1 },
      description: { type: "string" },
      accessMode: {
        type: "string",
        enum: ["read", "write", "read_write", "exec"]
      },
      argsSchema: { type: "object", additionalProperties: true }
    }
  };

  const workbenchBoxCatalogItem = {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "surfaceId",
      "routePath",
      "title",
      "description",
      "category",
      "tags",
      "inputs",
      "params",
      "output",
      "tools",
      "source",
      "sourceFlowId",
      "sourceFlowEnabled"
    ],
    properties: {
      id: { type: "string", minLength: 1 },
      boxId: { type: "string" },
      surfaceId: nullable({ type: "string" }),
      routePath: nullable({ type: "string" }),
      title: { type: "string", minLength: 1 },
      label: { type: "string" },
      icon: nullable({ type: "string" }),
      description: { type: "string" },
      category: { type: "string", minLength: 1 },
      tags: arrayOf({ type: "string" }),
      capabilityModes: arrayOf({
        type: "string",
        enum: ["content", "tool", "action", "mcp"]
      }),
      inputs: arrayOf({ $ref: "#/components/schemas/WorkbenchBoxPort" }),
      params: arrayOf({ $ref: "#/components/schemas/WorkbenchBoxPort" }),
      output: arrayOf({ $ref: "#/components/schemas/WorkbenchBoxPort" }),
      tools: arrayOf({ $ref: "#/components/schemas/WorkbenchBoxTool" }),
      outputs: arrayOf({ $ref: "#/components/schemas/WorkbenchBoxPort" }),
      toolAdapters: arrayOf({ $ref: "#/components/schemas/WorkbenchBoxTool" }),
      snapshotResolverKey: { type: "string" },
      source: { type: "string", enum: ["forge", "flow_output"] },
      sourceFlowId: nullable({ type: "string" }),
      sourceFlowEnabled: nullable({ type: "boolean" })
    }
  };

  const workbenchBoxCatalogPage = {
    type: "object",
    additionalProperties: false,
    required: ["boxes", "total", "limit", "offset", "hasMore", "facets"],
    properties: {
      boxes: arrayOf({ $ref: "#/components/schemas/WorkbenchBoxCatalogItem" }),
      total: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      offset: { type: "integer", minimum: 0 },
      hasMore: { type: "boolean" },
      facets: {
        type: "object",
        additionalProperties: false,
        required: ["categories", "surfaces", "sources"],
        properties: {
          categories: arrayOf({
            $ref: "#/components/schemas/WorkbenchCatalogFacet"
          }),
          surfaces: arrayOf({
            $ref: "#/components/schemas/WorkbenchCatalogFacet"
          }),
          sources: arrayOf({
            $ref: "#/components/schemas/WorkbenchCatalogFacet"
          })
        }
      }
    }
  };

  const movementUserIdsParameter = {
    name: "userIds",
    in: "query",
    schema: { type: "array", items: { type: "string" } },
    style: "form",
    explode: true,
    description:
      "Optional repeated user scope. Mutations use the first selected user. Single-record reads use the first selected user when present and otherwise retain unrestricted operator lookup. A record-owner mismatch returns 404; a scoped token requesting users outside its policy returns 403."
  };

  const nutritionMutationUserIdsParameter = {
    name: "userIds",
    in: "query",
    schema: { type: "array", items: { type: "string" } },
    style: "form",
    explode: true,
    description:
      "Select exactly one Forge user for this mutation. A body userId must match this selection. Scoped tokens may select only an allowed user and default to their sole allowed user."
  };

  const nutritionIdempotencyKeyParameter = {
    name: "Idempotency-Key",
    in: "header",
    required: false,
    schema: { type: "string", minLength: 1, maxLength: 128 },
    description:
      "Stable retry key for one nutrition creation. An exact replay returns the original record with Idempotency-Replayed: true; reuse with a different payload returns 409."
  };

  const movementIdParameter = {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string" }
  };

  const movementPointIdParameter = {
    name: "pointId",
    in: "path",
    required: true,
    schema: { type: "string" }
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
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "Forge agent token. Task routes enforce token user, project, and tag scope."
        },
        operatorSession: {
          type: "apiKey",
          in: "cookie",
          name: "forge_operator_session",
          description: "Trusted local operator session cookie."
        }
      },
      schemas: {
        ...buildPeerOpenApiComponents(),
        ValidationIssue: validationIssue,
        ValidationExpectedShape: validationExpectedShape,
        ErrorResponse: errorResponse,
        ComparisonFamily: comparisonFamily,
        ComparisonCatalogItem: comparisonCatalogItem,
        ComparisonCatalogResponse: comparisonCatalogResponse,
        ComparisonEvidenceReference: comparisonEvidenceReference,
        ComparisonSourceReference: comparisonSourceReference,
        ComparisonPoint: comparisonPoint,
        ComparisonLane: comparisonLane,
        ComparisonTotals: comparisonTotals,
        ComparisonResponse: comparisonResponse,
        LocalSearchTextEvidence: localSearchTextEvidence,
        LocalSearchRelationshipEvidence: localSearchRelationshipEvidence,
        LocalSearchResult: localSearchResult,
        LocalSearchCoverage: localSearchCoverage,
        LocalSearchResponse: localSearchResponse,
        RelationshipProposalEndpoint: relationshipProposalEndpoint,
        RelationshipProposalEvidence: relationshipProposalEvidence,
        RelationshipProposal: relationshipProposal,
        RelationshipProposalGeneration: relationshipProposalGeneration,
        RelationshipProposalList: relationshipProposalList,
        RelationshipProposalOwnerInput: relationshipProposalOwnerInput,
        RelationshipProposalDecisionInput: relationshipProposalDecisionInput,
        RelationshipProposalDecision: relationshipProposalDecision,
        UserSummary: userSummary,
        Tag: tag,
        Goal: goal,
        DashboardGoal: dashboardGoal,
        Project: project,
        CalendarSchedulingRules: calendarSchedulingRules,
        CalendarConnection: calendarConnection,
        CalendarConnectionMutationInput: calendarConnectionMutationInput,
        CalendarConnectionPatchInput: calendarConnectionPatchInput,
        CalendarDiscoveryInput: calendarDiscoveryInput,
        CalendarDiscoveryPayload: calendarDiscoveryPayload,
        MacOSLocalCalendarDiscoveryPayload: macOSLocalCalendarDiscoveryPayload,
        CalendarResource: calendarResource,
        CalendarEventSource: calendarEventSource,
        CalendarEventLink: calendarEventLink,
        CalendarEvent: calendarEvent,
        CalendarProjectionResult: calendarProjectionResult,
        WorkBlockTemplate: workBlockTemplate,
        WorkBlockTemplateCreateInput: workBlockTemplateCreateInput,
        WorkBlockTemplatePatchInput: workBlockTemplatePatchInput,
        WorkBlockInstance: workBlockInstance,
        TaskTimebox: taskTimebox,
        TaskTimeboxCreateInput: taskTimeboxCreateInput,
        TaskTimeboxPatchInput: taskTimeboxPatchInput,
        TaskTimeboxRecommendationInput: taskTimeboxRecommendationInput,
        CalendarOverviewPayload: calendarOverviewPayload,
        TaskTimeSummary: taskTimeSummary,
        ProjectSummary: projectSummary,
        CloseoutNoteLinkInput: closeoutNoteLinkInput,
        CloseoutNoteInput: closeoutNoteInput,
        CompletionReport: completionReport,
        CompletionReportInput: completionReportInput,
        WorkItemGitRefInput: workItemGitRefInput,
        WorkItemGitRef: workItemGitRef,
        WorkItemBlockerLink: workItemBlockerLink,
        TaskActionPointSummary: taskActionPointSummary,
        TaskSplitSuggestion: taskSplitSuggestion,
        Task: task,
        TaskCreateInput: taskCreateInput,
        TaskPatchInput: taskPatchInput,
        NestedTaskNoteInput: nestedTaskNoteInput,
        TaskRun: taskRun,
        TaskRunGitContext: taskRunGitContext,
        TaskRunGitContextInput: taskRunGitContextInput,
        OperatorLogWorkInput: operatorLogWorkInput,
        GitHelperRef: gitHelperRef,
        GitHelperOverview: gitHelperOverview,
        GitHelperSearchResponse: gitHelperSearchResponse,
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
        DoctorFixProposal: doctorFixProposal,
        DoctorCheck: doctorCheck,
        ForgeDoctorReport: forgeDoctorReport,
        DoctorFixResult: doctorFixResult,
        ExecutionSettings: executionSettings,
        TaskRunClaimInput: taskRunClaimInput,
        TaskRunHeartbeatInput: taskRunHeartbeatInput,
        TaskRunCompleteInput: taskRunCompleteInput,
        TaskRunReleaseInput: taskRunReleaseInput,
        TaskRunFocusInput: taskRunFocusInput,
        HabitCheckInInput: habitCheckInInput,
        WorkAdjustment: workAdjustment,
        WorkAdjustmentTargetSummary: workAdjustmentTargetSummary,
        WorkAdjustmentInput: workAdjustmentInput,
        WorkAdjustmentResult: workAdjustmentResult,
        SettingsUpdateInput: settingsUpdateInput,
        AgentOnboardingPayload: agentOnboardingPayload,
        DeletedEntityRecord: deletedEntityRecord,
        SettingsBinPayload: settingsBinPayload,
        BatchEntityValidationIssue: batchEntityValidationIssue,
        BatchEntityInvalidValueGuidance: batchEntityInvalidValueGuidance,
        BatchEntityOperationError: batchEntityOperationError,
        BatchEntityMutationResult: batchEntityMutationResult,
        BatchEntitySearchMatch: batchEntitySearchMatch,
        BatchEntitySearchResult: batchEntitySearchResult,
        BatchCreateEntitiesInput: batchCreateEntitiesInput,
        BatchUpdateEntitiesInput: batchUpdateEntitiesInput,
        BatchDeleteEntitiesInput: batchDeleteEntitiesInput,
        BatchRestoreEntitiesInput: batchRestoreEntitiesInput,
        BatchSearchEntitiesInput: batchSearchEntitiesInput,
        AgentIdentity: agentIdentity,
        AgentRuntimeReconnectPlan: agentRuntimeReconnectPlan,
        AgentRuntimeSessionEvent: agentRuntimeSessionEvent,
        AgentRuntimeSession: agentRuntimeSession,
        AgentRuntimeSessionHistory: agentRuntimeSessionHistory,
        AgentBootstrapPolicy: agentBootstrapPolicy,
        AgentScopePolicy: agentScopePolicy,
        AgentTokenSummary: agentTokenSummary,
        AgentTokenMutationResult: agentTokenMutationResult,
        Domain: domain,
        SchemaCatalogEntry: schemaCatalogEntry,
        EventType: eventType,
        EventTypeCreateInput: eventTypeCreateInput,
        EventTypePatchInput: eventTypePatchInput,
        EmotionDefinition: emotionDefinition,
        EmotionDefinitionCreateInput: emotionDefinitionCreateInput,
        EmotionDefinitionPatchInput: emotionDefinitionPatchInput,
        PsycheValue: psycheValue,
        BehaviorPattern: behaviorPattern,
        Behavior: behavior,
        BeliefEntry: beliefEntry,
        ModeProfile: modeProfile,
        ModeGuideSession: modeGuideSession,
        TriggerReport: triggerReport,
        TriggerReportCreateInput: triggerReportCreateInput,
        TriggerReportPatchInput: triggerReportPatchInput,
        TriggerReportPage: triggerReportPage,
        NoteLink: noteLink,
        Note: note,
        NoteCreateContext: noteCreateContext,
        NoteCreateInput: noteCreateInput,
        NotePatchInput: notePatchInput,
        WikiPageSummary: wikiPageSummary,
        WikiPageListResponse: wikiPageListResponse,
        WikiPageCreateInput: wikiPageCreateInput,
        WikiPagePatchInput: wikiPagePatchInput,
        TodayPriorityEvidence: todayPriorityEvidence,
        TodayRankedCandidate: todayRankedCandidate,
        TodayPriorityDecision: todayPriorityDecision,
        DailyBriefingStatement: dailyBriefingStatement,
        DailyBriefingSection: dailyBriefingSection,
        DailyBriefing: dailyBriefing,
        WikiSearchInput: wikiSearchInput,
        WikiSearchResult: wikiSearchResult,
        WikiSearchResponse: wikiSearchResponse,
        WikiTreeNode: {
          type: "object",
          additionalProperties: false,
          required: ["page", "children"],
          properties: {
            page: { $ref: "#/components/schemas/WikiPageSummary" },
            children: arrayOf({ $ref: "#/components/schemas/WikiTreeNode" })
          }
        },
        NoteSummary: noteSummary,
        NotesSummaryByEntity: notesSummaryByEntity,
        CrudEntityType: crudEntityType,
        EntityLink: entityLink,
        EntityLinkInput: entityLinkInput,
        PreferenceCatalog: preferenceCatalog,
        PreferenceCatalogCreateInput: preferenceCatalogCreateInput,
        PreferenceCatalogPatchInput: preferenceCatalogPatchInput,
        PreferenceDimensionVector: preferenceDimensionVector,
        PreferenceDimensionVectorInput: preferenceDimensionVectorInput,
        PreferenceCatalogItem: preferenceCatalogItem,
        PreferenceCatalogItemCreateInput: preferenceCatalogItemCreateInput,
        PreferenceCatalogItemPatchInput: preferenceCatalogItemPatchInput,
        PreferenceProfile: preferenceProfile,
        PreferenceContext: preferenceContext,
        PreferenceContextCreateInput: preferenceContextCreateInput,
        PreferenceContextPatchInput: preferenceContextPatchInput,
        PreferenceItem: preferenceItem,
        PreferenceItemCreateInput: preferenceItemCreateInput,
        PreferenceItemPatchInput: preferenceItemPatchInput,
        PreferenceEntityEnqueueInput: preferenceEntityEnqueueInput,
        PairwisePreferenceJudgment: pairwisePreferenceJudgment,
        PreferenceJudgmentInput: preferenceJudgmentInput,
        AbsolutePreferenceSignal: absolutePreferenceSignal,
        PreferenceSignalInput: preferenceSignalInput,
        PreferenceItemScore: preferenceItemScore,
        PreferenceScorePatchInput: preferenceScorePatchInput,
        PreferenceDimensionSummary: preferenceDimensionSummary,
        PreferenceSnapshot: preferenceSnapshot,
        PreferenceMapPoint: preferenceMapPoint,
        PreferenceWorkspace: preferenceWorkspace,
        PreferenceWorkspaceRefreshInput: preferenceWorkspaceRefreshInput,
        PreferenceGameStartInput: preferenceGameStartInput,
        LifeEventSegment: lifeEventSegment,
        LifeEvent: lifeEvent,
        LifeEventTimelinePayload: lifeEventTimelinePayload,
        LifeEventCalendarSyncInput: lifeEventCalendarSyncInput,
        LifeEventFromCalendarInput: lifeEventFromCalendarInput,
        LifeEventTicketImportInput: lifeEventTicketImportInput,
        ArtifactScanFinding: artifactScanFinding,
        ArtifactScanResult: artifactScanResult,
        ArtifactContentProtection: artifactContentProtection,
        Artifact: artifact,
        ArtifactSummary: artifactSummary,
        ArtifactListResponse: artifactListResponse,
        ArtifactUploadInput: artifactUploadInput,
        ArtifactPasswordDownloadInput: artifactPasswordDownloadInput,
        ArtifactEncryptInput: artifactEncryptInput,
        ArtifactMetadataPatchInput: artifactMetadataPatchInput,
        ArtifactTrustPatchInput: artifactTrustPatchInput,
        ArtifactEnrichmentInput: artifactEnrichmentInput,
        ArtifactEnrichmentApplyInput: artifactEnrichmentApplyInput,
        ArtifactVersion: artifactVersion,
        ArtifactAuditEvent: artifactAuditEvent,
        ArtifactVersionPage: artifactVersionPage,
        ArtifactAuditEventPage: artifactAuditEventPage,
        WorkbenchRun: workbenchRun,
        WorkbenchRunSummary: workbenchRunSummary,
        WorkbenchRunPage: workbenchRunPage,
        WorkbenchReadMetadata: workbenchReadMetadata,
        WorkbenchNodeResultSummary: workbenchNodeResultSummary,
        WorkbenchCatalogFacet: workbenchCatalogFacet,
        WorkbenchFlowCatalogItem: workbenchFlowCatalogItem,
        WorkbenchFlowCatalogPage: workbenchFlowCatalogPage,
        WorkbenchBoxPort: workbenchBoxPort,
        WorkbenchBoxTool: workbenchBoxTool,
        WorkbenchBoxCatalogItem: workbenchBoxCatalogItem,
        WorkbenchBoxCatalogPage: workbenchBoxCatalogPage,
        HealthLink: healthLink,
        SleepSession: sleepSession,
        WorkoutSession: workoutSession,
        WorkoutSessionSummary: workoutSessionSummary,
        WorkoutAnalysisSession: workoutAnalysisSession,
        SportComparisonEntry: sportComparisonEntry,
        SportComparisonPeriod: sportComparisonPeriod,
        SportComparison: sportComparison,
        SleepViewData: sleepViewData,
        FitnessViewData: fitnessViewData,
        TrainingLoadViewData: trainingLoadViewData,
        NutritionMealItemInput: nutritionMealItemInput,
        NutritionFoodLogInput: nutritionFoodLogInput,
        NutritionFoodLogPatchInput: nutritionFoodLogPatchInput,
        NutritionFoodLog: nutritionFoodLog,
        NutritionBodyCheckinInput: nutritionBodyCheckinInput,
        NutritionAppearanceCheckinInput: nutritionAppearanceCheckinInput,
        NutritionSubjectiveCheckinInput: nutritionSubjectiveCheckinInput,
        NutritionGutCheckinInput: nutritionGutCheckinInput,
        NutritionFoodSearchResult: nutritionFoodSearchResult,
        NutritionExperimentInput: nutritionExperimentInput,
        NutritionExperimentPatchInput: nutritionExperimentPatchInput,
        NutritionExperiment: nutritionExperiment,
        WeightLossViewData: weightLossViewData,
        QuestionnaireAnswerInput: questionnaireAnswerInput,
        QuestionnaireInstrumentUpdateInput: questionnaireInstrumentUpdateInput,
        QuestionnaireDraftUpdateInput: questionnaireDraftUpdateInput,
        QuestionnaireDraftPublishInput: questionnaireDraftPublishInput,
        QuestionnaireRunStartInput: questionnaireRunStartInput,
        QuestionnaireRunUpdateInput: questionnaireRunUpdateInput,
        PsycheMetricsViewData: psycheMetricsViewData,
        PsycheOverviewPayload: psycheOverviewPayload,
        Insight: insight,
        InsightFeedback: insightFeedback,
        ApprovalRequest: approvalRequest,
        AttentionInboxTarget: attentionInboxTarget,
        AttentionPrimaryAction: attentionPrimaryAction,
        AttentionInboxItem: attentionInboxItem,
        AttentionInboxSummary: attentionInboxSummary,
        AttentionInboxPayload: attentionInboxPayload,
        AttentionInboxStateRecord: attentionInboxStateRecord,
        AttentionResolutionAttempt: attentionResolutionAttempt,
        AttentionResolutionReceipt: attentionResolutionReceipt,
        AttentionResolutionStartResult: attentionResolutionStartResult,
        AttentionResolutionCheckResult: attentionResolutionCheckResult,
        AttentionResolutionCheckResponse: attentionResolutionCheckResponse,
        AttentionResolutionList: attentionResolutionList,
        MutationReceipt: mutationReceipt,
        OfflineTaskMutationInput: offlineTaskMutationInput,
        OfflineTaskMutationReceipt: offlineTaskMutationReceipt,
        OfflineTaskMutationResponse: offlineTaskMutationResponse,
        EntityNavigationItem: entityNavigationItem,
        EntityNavigationPayload: entityNavigationPayload,
        EntityNavigationPinInput: entityNavigationPinInput,
        EntityNavigationTouchInput: entityNavigationTouchInput,
        ActionBarFilterId: actionBarFilterId,
        SavedView: savedView,
        SavedViewCreateInput: savedViewCreateInput,
        AgentAction: agentAction,
        RewardRule: rewardRule,
        RewardLedgerEvent: rewardLedgerEvent,
        EventLogEntry: eventLogEntry,
        GamificationCatalogItem: gamificationCatalogItem,
        GamificationCatalogEntry: gamificationCatalogEntry,
        GamificationCatalogPayload: gamificationCatalogPayload,
        GamificationEquipment: gamificationEquipment,
        GamificationMascotState: gamificationMascotState,
        GamificationCelebration: gamificationCelebration,
        GamificationScope: gamificationScope,
        XpMetricsPayload: xpMetricsPayload,
        DerivedDataProvenance: derivedDataProvenance,
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
      ...buildPeerOpenApiPaths(),
      ...buildCourseOpenApiPaths(),
      ...buildSecurityPairingOpenApiPaths(),
      "/api/v1/comparisons/catalog": {
        get: {
          tags: ["Comparisons"],
          summary: "List records that the caller can open and compare",
          description:
            "Requires base read scope before Forge parses the query or looks up a user. The request selects exactly one authorized Forge user. Invalid, unknown, and token-disallowed user IDs receive the same unavailable response. The catalog contains only authorized, openable preference, health, Psyche, insight, Note, and Wiki records. Its opaque cursor is bound to the exact user, family, and normalized search query and supports offsets no greater than 10,000. Notes and Wiki pages retain their Wiki-space and Psyche visibility rules.",
          security: [{ operatorSession: [] }, { bearerAuth: [] }],
          parameters: [
            {
              name: "userId",
              in: "query",
              required: true,
              description:
                "Exactly one Forge user. A scoped token may select only a user in its user scope policy.",
              schema: { type: "string", minLength: 1, maxLength: 160 }
            },
            {
              name: "query",
              in: "query",
              required: false,
              description:
                "Case-insensitive text search within the selected, authorized catalog.",
              schema: { type: "string", maxLength: 160, default: "" }
            },
            {
              name: "family",
              in: "query",
              required: false,
              description: "Return one of the six supported record families.",
              schema: { $ref: "#/components/schemas/ComparisonFamily" }
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 100,
                default: 40
              }
            },
            {
              name: "cursor",
              in: "query",
              required: false,
              description:
                "Opaque cursor returned by the preceding page. It cannot be reused with another user, family, or search query.",
              schema: { type: "string", maxLength: 1024 }
            }
          ],
          responses: {
            "200": jsonResponse(
              { $ref: "#/components/schemas/ComparisonCatalogResponse" },
              "Authorized comparison catalog page"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": {
              description:
                "Generic unavailable response for an unknown or token-disallowed user scope.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            }
          }
        }
      },
      "/api/v1/comparisons": {
        get: {
          tags: ["Comparisons"],
          summary: "Compare up to eight authorized Forge records",
          description:
            "Requires base read scope before Forge parses selectors or reads data. Forge applies the scoped-token user policy before returning any distinguishable user-validity result, then re-resolves every selector under that exact user and read permission. A malformed selector or query returns 400. A well-formed missing, deleted, hidden, or inaccessible selector becomes a generic unavailable lane that does not expose its family, title, source, or existence. Daily Health and Psyche numeric lanes cover every requested date and mark absent observations as not_recorded. Preference snapshots mark an item absent from their stored top 12 as not_stored. Forge never substitutes zero. Insight, Note, and Wiki lanes expose current-only events and do not reconstruct historical content. Responses above 3,000 points are rejected instead of truncated. A shared axis is applied only when every available lane is numeric and has exactly the same non-null unit.",
          security: [{ operatorSession: [] }, { bearerAuth: [] }],
          parameters: [
            {
              name: "userId",
              in: "query",
              required: true,
              description:
                "Exactly one Forge user. A scoped token may select only a user in its user scope policy.",
              schema: { type: "string", minLength: 1, maxLength: 160 }
            },
            {
              name: "selection",
              in: "query",
              required: true,
              style: "form",
              explode: true,
              description:
                "Repeat 1 to 8 unique selectors in display order. Supported forms are preference:itemId:contextId, health:metric, psyche:metric, insight:id, note:id, and wiki:id.",
              schema: {
                type: "array",
                minItems: 1,
                maxItems: 8,
                uniqueItems: true,
                items: { type: "string", minLength: 3, maxLength: 512 }
              }
            },
            {
              name: "from",
              in: "query",
              required: true,
              description: "Inclusive first local date in YYYY-MM-DD form.",
              schema: { type: "string", format: "date" }
            },
            {
              name: "to",
              in: "query",
              required: true,
              description:
                "Inclusive final local date. The inclusive range may contain at most 366 days.",
              schema: { type: "string", format: "date" }
            },
            {
              name: "timeZone",
              in: "query",
              required: true,
              description:
                "Valid IANA time zone used to assign stored timestamps to local dates.",
              schema: { type: "string", minLength: 1, maxLength: 100 }
            },
            {
              name: "alignment",
              in: "query",
              required: false,
              description:
                "separate_tracks is the default. shared_axis is accepted only when every available lane is numeric and has the same non-null unit.",
              schema: {
                type: "string",
                enum: ["separate_tracks", "shared_axis"],
                default: "separate_tracks"
              }
            }
          ],
          responses: {
            "200": jsonResponse(
              { $ref: "#/components/schemas/ComparisonResponse" },
              "Ordered comparison lanes with explicit gaps, sources, evidence, totals, and alignment result"
            ),
            "400": {
              description:
                "Malformed or oversized comparison. This includes invalid selectors, duplicate or excessive selections, an invalid or longer-than-366-day range, an invalid time zone, and responses above 3,000 points.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": {
              description:
                "Generic unavailable response for an unknown or token-disallowed user scope.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            }
          }
        }
      },
      "/api/v1/local-search": {
        get: {
          tags: ["Search"],
          summary: "Search authorized local Forge records",
          description:
            "Requires a trusted local operator session before Forge parses the query or validates a selected person. Search covers all 31 eligible Forge record families through a transient permission-filtered index. It uses bounded local word matching and one-hop relationships from the released Knowledge Graph; it does not use embeddings or claim general semantic understanding. Every result includes an exact source route and up to three text or relationship evidence references. Deleted records and records outside the selected people scope are removed before tokenization. Before indexing, Forge refuses more than 750 source records, 3 MiB of authorized indexable record text, or 750 authorized relationships rather than using unbounded memory. It never caches source content in a derived database table.",
          security: [{ operatorSession: [] }],
          parameters: [
            {
              name: "q",
              in: "query",
              required: false,
              description:
                "Search text. Either text or at least one record-family filter is required.",
              schema: { type: "string", maxLength: 200, default: "" }
            },
            {
              name: "entityType",
              in: "query",
              required: false,
              style: "form",
              explode: true,
              description:
                "Repeat to keep results within one or more Forge CRUD record families.",
              schema: {
                type: "array",
                maxItems: crudEntityTypeSchema.options.length,
                uniqueItems: true,
                items: {
                  type: "string",
                  enum: [...crudEntityTypeSchema.options]
                }
              }
            },
            {
              name: "entityKind",
              in: "query",
              required: false,
              style: "form",
              explode: true,
              description:
                "Repeat to keep released Knowledge Graph results within one or more visible kinds, including Note versus Wiki page.",
              schema: {
                type: "array",
                maxItems: localSearchEntityKindSchema.options.length,
                uniqueItems: true,
                items: {
                  type: "string",
                  enum: [...localSearchEntityKindSchema.options]
                }
              }
            },
            {
              name: "userIds",
              in: "query",
              required: false,
              style: "form",
              explode: true,
              description:
                "Repeat to select authorized Forge people. Any unknown person makes the whole request unavailable instead of widening scope.",
              schema: {
                type: "array",
                maxItems: 100,
                uniqueItems: true,
                items: { type: "string", minLength: 1 }
              }
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 20,
                default: 12
              }
            }
          ],
          responses: {
            "200": jsonResponse(
              { $ref: "#/components/schemas/LocalSearchResponse" },
              "Ranked authorized records with exact evidence and source routes"
            ),
            "400": {
              description:
                "Malformed or oversized query, or a request with neither search text nor a record-family filter.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            },
            "401": { $ref: "#/components/responses/Error" },
            "403": {
              description:
                "Agent tokens and other non-operator principals cannot use local search.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            },
            "404": {
              description:
                "Generic unavailable response for any unknown selected person.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            },
            "413": {
              description:
                "The request exceeds the transient local-search envelope of 750 source records, 3 MiB of authorized indexable record text, or 750 authorized relationships. Forge refuses the search before indexing records.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            }
          }
        }
      },
      "/api/v1/relationship-proposals": {
        get: {
          tags: ["Relationship Proposals"],
          summary: "List one owner's pending relationship suggestions",
          description:
            "Requires a trusted local operator session and one explicit owner. Forge reauthorizes both ordered endpoints before returning a suggestion, omits and expires stale suggestions without exposing their titles, and returns at most 20 of at most 120 pending suggestions with exact shown and total counts. Reading does not generate suggestions or write graph relationships.",
          security: [{ operatorSession: [] }],
          parameters: [
            {
              name: "ownerUserId",
              in: "query",
              required: true,
              schema: { type: "string", minLength: 1 }
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 20, default: 20 }
            }
          ],
          responses: {
            "200": jsonResponse(
              { $ref: "#/components/schemas/RelationshipProposalList" },
              "Owner-scoped pending suggestions with current authorized source routes"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": {
              description:
                "Agent tokens and other non-operator principals cannot inspect relationship proposals.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            },
            "404": {
              description: "Generic unavailable response for an unknown owner.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            }
          }
        }
      },
      "/api/v1/relationship-proposals/generate": {
        post: {
          tags: ["Relationship Proposals"],
          summary: "Find bounded relationship suggestions for one owner",
          description:
            "Requires a trusted local operator session. Authorization and exact ownership checks run before record selection, counting, tokenization, comparison, evidence collection, or persistence. The deterministic local generator accepts at most 750 authorized source records and 3 MiB of authorized source text, considers at most 2,000 pairs, and retains at most 120 pending suggestions for the owner. It supports ordered `supports` and `informs` relationships and symmetric `related` relationships with deterministic stored endpoint order. Suggestions expire after seven days. Generation saves only a private review queue; it never writes an entity link. Retained accepted or rejected history is never reopened by the same generator version, and resolved content is scrubbed before bounded 90-day retention.",
          security: [{ operatorSession: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/RelationshipProposalOwnerInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              { $ref: "#/components/schemas/RelationshipProposalList" },
              "Current pending suggestions and bounded generation receipt"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            "413": {
              description:
                "The authorized transient source set exceeds the local-search record, text-byte, or relationship envelope before proposal comparison begins.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            }
          }
        }
      },
      "/api/v1/relationship-proposals/{id}/accept": {
        post: {
          tags: ["Relationship Proposals"],
          summary: "Accept one current relationship suggestion",
          description:
            "Requires a trusted local operator session. The first pending decision compares the expected revision, reauthorizes both ordered current endpoints for the proposal owner, inserts the one proposed entity link, and commits the accepted state atomically. An exact accept replay returns the stored terminal result without revalidating or writing again. Reject-after-accept, stale, expired, unavailable, or revision-conflicting decisions return a stable conflict and do not change another relationship.",
          security: [{ operatorSession: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/RelationshipProposalDecisionInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["decision"],
                properties: {
                  decision: {
                    $ref: "#/components/schemas/RelationshipProposalDecision"
                  }
                }
              },
              "Atomic acceptance or exact idempotent replay"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            "409": {
              description:
                "The suggestion expired, became unavailable, changed revision, or was already rejected. No relationship was changed by this request.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            }
          }
        }
      },
      "/api/v1/relationship-proposals/{id}/reject": {
        post: {
          tags: ["Relationship Proposals"],
          summary: "Reject one current relationship suggestion",
          description:
            "Requires a trusted local operator session. The first pending decision compares the expected revision, records rejection, and scrubs stored evidence and explanation content without writing an entity link. An exact reject replay returns the stored terminal result without writing again. Accept-after-reject, expired, or revision-conflicting decisions return a stable conflict.",
          security: [{ operatorSession: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", minLength: 1 }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/RelationshipProposalDecisionInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["decision"],
                properties: {
                  decision: {
                    $ref: "#/components/schemas/RelationshipProposalDecision"
                  }
                }
              },
              "Rejection with no entity-link write, or exact idempotent replay"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            "409": {
              description:
                "The suggestion expired, changed revision, or was already accepted. No relationship was changed by this request.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            }
          }
        }
      },
      "/api/v1/artifacts": {
        get: {
          summary: "List artifact metadata",
          description:
            "Lists compact artifact metadata, danger state, and generic entity links within the authenticated token's user scope before counting or pagination. Read one artifact for full scanner, enrichment, hash, provenance, and user metadata. Public Artifact responses contain neither file bytes nor physical storage paths or byte locators.",
          parameters: [
            {
              name: "query",
              in: "query",
              schema: { type: "string", maxLength: 200 }
            },
            {
              name: "artifactState",
              in: "query",
              schema: {
                type: "string",
                enum: [
                  "active",
                  "quarantined",
                  "blocked",
                  "archived",
                  "metadata_only"
                ]
              }
            },
            {
              name: "dangerLevel",
              in: "query",
              schema: {
                type: "string",
                enum: ["low", "moderate", "high", "blocked"]
              }
            },
            {
              name: "formatFamily",
              in: "query",
              schema: {
                type: "string",
                enum: [
                  "spreadsheet",
                  "document",
                  "presentation",
                  "pdf",
                  "text",
                  "structured_text",
                  "image"
                ]
              }
            },
            {
              name: "linkedEntityType",
              in: "query",
              schema: { type: "string" }
            },
            { name: "linkedEntityId", in: "query", schema: { type: "string" } },
            {
              name: "limit",
              in: "query",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 100,
                default: 100
              }
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", minimum: 0 }
            }
          ],
          responses: {
            "200": jsonResponse(
              { $ref: "#/components/schemas/ArtifactListResponse" },
              "Artifact list"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Upload a trusted file artifact",
          description:
            "Stores one non-empty canonical-base64 file only for an authenticated human operator or a trusted/autonomous agent token with both artifact.create and artifact.uploadBytes. The canonical owner is actingForUserId, then uploadedByUserId, then the single scoped user; multi-user agent scopes must specify an owner and cannot name a user outside scope. Use one stable Idempotency-Key header or matching body idempotencyKey per queued file. Exact replays return the original artifact with Idempotency-Replayed: true; changed payloads return 409. An encrypted replay succeeds only after the supplied transient password decrypts the existing ciphertext; a wrong password returns 403 artifact_wrong_password and is never fingerprinted or persisted. Different artifacts with identical plaintext keep separate metadata rows and one logical plaintext identity. Plaintext uploads may reuse one verified physical blob, while encrypted uploads use independent randomized ciphertext representations. Forge scans plaintext before encryption, stores only ciphertext for encrypted uploads, and never returns or persists the password, extracted plaintext, a physical storage path, or a byte locator.",
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: false,
              description:
                "Stable actor-scoped retry key for one file. Use the same key after a timeout or canceled client request.",
              schema: {
                type: "string",
                minLength: 8,
                maxLength: 200,
                pattern: "^[A-Za-z0-9._:-]+$"
              }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ArtifactUploadInput" }
              }
            }
          },
          responses: {
            "200": {
              ...jsonResponse(
                {
                  type: "object",
                  required: ["artifact"],
                  properties: {
                    artifact: { $ref: "#/components/schemas/Artifact" }
                  }
                },
                "Idempotent replay of an already-created artifact"
              ),
              headers: {
                "Idempotency-Replayed": {
                  schema: { type: "string", enum: ["true"] }
                }
              }
            },
            "201": {
              ...jsonResponse(
                {
                  type: "object",
                  required: ["artifact"],
                  properties: {
                    artifact: { $ref: "#/components/schemas/Artifact" }
                  }
                },
                "Created artifact"
              ),
              headers: {
                "Idempotency-Replayed": {
                  schema: { type: "string", enum: ["false"] }
                }
              }
            },
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" },
            "413": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/artifacts/{id}": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        get: {
          summary: "Get artifact metadata",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["artifact"],
                properties: {
                  artifact: { $ref: "#/components/schemas/Artifact" }
                }
              },
              "Artifact metadata"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Patch artifact metadata",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ArtifactMetadataPatchInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["artifact"],
                properties: {
                  artifact: { $ref: "#/components/schemas/Artifact" }
                }
              },
              "Updated artifact"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/artifacts/{id}/download": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        get: {
          summary: "Download artifact bytes for a human operator",
          description:
            "Returns plaintext artifact bytes only to an authenticated human/operator session. Agent tokens are not allowed to download artifacts. For encrypted artifacts this GET route returns artifact_password_required; use the POST route with a request body password.",
          responses: {
            "200": {
              description: "Artifact file bytes",
              content: {
                "application/octet-stream": {
                  schema: { type: "string", format: "binary" }
                }
              }
            },
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary:
            "Download password-encrypted artifact bytes for a human operator",
          description:
            "Accepts a transient password in the JSON request body, decrypts server-side, and returns the original plaintext bytes only to an authenticated human/operator session. The password is never stored, logged, returned, or exposed to agent tools.",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ArtifactPasswordDownloadInput"
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Artifact file bytes",
              content: {
                "application/octet-stream": {
                  schema: { type: "string", format: "binary" }
                }
              }
            },
            "403": {
              description: "Wrong password or non-operator caller",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            },
            "409": {
              description: "Password required for encrypted artifact",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" }
                }
              }
            },
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/artifacts/{id}/encrypt": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        post: {
          summary: "Encrypt existing plaintext artifact content",
          description:
            "Human/operator-only route. Reads the current plaintext blob, encrypts it with a transient password, verifies decrypt-before-switch, updates artifact/version protection metadata, and preserves existing scan, danger score, metadata, audit history, and generic entity links. This route is not exposed to agent tools.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ArtifactEncryptInput" }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["artifact"],
                properties: {
                  artifact: { $ref: "#/components/schemas/Artifact" }
                }
              },
              "Encrypted artifact"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/artifacts/{id}/scan": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        post: {
          summary: "Rescan an artifact with the static safety scanner",
          description:
            "Plaintext artifacts are rescanned from stored bytes. Encrypted artifacts return artifact_content_encrypted and keep the existing scan result available; password-gated rescan is not implemented in this route.",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["artifact"],
                properties: {
                  artifact: { $ref: "#/components/schemas/Artifact" }
                }
              },
              "Rescanned artifact"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/artifacts/{id}/enrich": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        post: {
          summary: "Generate an LLM artifact-metadata proposal",
          description:
            "LLM enrichment receives safe metadata, scan findings, and a transient in-memory static text sample when plaintext storage permits rescanning. Artifact content is treated as untrusted data, the underlying byte buffer is zeroed after use, and long verbatim text spans are rejected from persisted output. The bounded proposal may contain title, short description, description, keywords, link suggestions, and danger interpretation, but this route does not apply any proposed metadata. A human operator must review and apply the exact current proposal through the separate apply route, and Forge never lowers the deterministic scanner danger score.",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ArtifactEnrichmentInput" }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["artifact"],
                properties: {
                  artifact: { $ref: "#/components/schemas/Artifact" }
                }
              },
              "Artifact with a reviewable enrichment proposal"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/artifacts/{id}/enrich/apply": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        post: {
          summary: "Apply an exact current enrichment proposal after review",
          description:
            "Human operator only. Applies the exact current proposal atomically after review. If metadata, stored content identity, protection or trust state, safety evidence, deletion state, or the current proposal changed after generation, Forge returns a stable conflict and applies nothing. Agent tokens cannot call this route.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ArtifactEnrichmentApplyInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["artifact"],
                properties: {
                  artifact: { $ref: "#/components/schemas/Artifact" }
                }
              },
              "Artifact with the reviewed enrichment proposal applied"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/artifacts/{id}/links": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        post: {
          summary: "Replace generic entity links for an artifact",
          description:
            "Stores artifact relationships through Forge's reusable entity_links model. Use this to connect artifacts to goals, projects, tasks, wiki-backed notes, Psyche records, calendar entities, and other supported Forge entities.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["links"],
                  properties: {
                    links: {
                      ...arrayOf({
                        $ref: "#/components/schemas/EntityLinkInput"
                      }),
                      maxItems: 100
                    }
                  }
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["artifact"],
                properties: {
                  artifact: { $ref: "#/components/schemas/Artifact" }
                }
              },
              "Relinked artifact"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/artifacts/{id}/trust": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        post: {
          summary: "Apply a trusted artifact state override",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ArtifactTrustPatchInput" }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["artifact"],
                properties: {
                  artifact: { $ref: "#/components/schemas/Artifact" }
                }
              },
              "Trust-updated artifact"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/artifacts/{id}/versions": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" }
          },
          {
            name: "limit",
            in: "query",
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 50
            }
          },
          {
            name: "offset",
            in: "query",
            schema: { type: "integer", minimum: 0, default: 0 }
          }
        ],
        get: {
          summary: "List artifact versions",
          responses: {
            "200": jsonResponse(
              { $ref: "#/components/schemas/ArtifactVersionPage" },
              "Artifact versions"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/artifacts/{id}/audit": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" }
          },
          {
            name: "limit",
            in: "query",
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 50
            }
          },
          {
            name: "offset",
            in: "query",
            schema: { type: "integer", minimum: 0, default: 0 }
          }
        ],
        get: {
          summary: "List artifact audit events",
          responses: {
            "200": jsonResponse(
              { $ref: "#/components/schemas/ArtifactAuditEventPage" },
              "Artifact audit events"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/life-events/timeline": {
        get: {
          summary: "Read the virtualized Life Events chronology",
          description:
            "Returns chronological Life Event records for the dedicated timeline view. Normal stored life_event create, update, delete, restore, and search still use shared batch entity routes.",
          parameters: [
            {
              name: "from",
              in: "query",
              schema: { type: "string", format: "date-time" }
            },
            {
              name: "to",
              in: "query",
              schema: { type: "string", format: "date-time" }
            },
            {
              name: "q",
              in: "query",
              schema: { type: "string", maxLength: 200 },
              description:
                "Search titles, descriptions, event types, places, origins, and destinations before pagination."
            },
            {
              name: "eventTypes",
              in: "query",
              schema: { type: "string" },
              description:
                "Comma-separated or repeated event type values such as travel_flight, concert, family, or custom."
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 500 }
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", minimum: 0 }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["timeline"],
                properties: {
                  timeline: {
                    $ref: "#/components/schemas/LifeEventTimelinePayload"
                  }
                }
              },
              "Life Events timeline"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/life-events/{id}": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        get: {
          summary: "Read one Life Event",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["lifeEvent"],
                properties: {
                  lifeEvent: { $ref: "#/components/schemas/LifeEvent" }
                }
              },
              "Life Event"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/life-events/{id}/calendar-sync": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        post: {
          summary: "Link or project a Life Event into the calendar",
          description:
            "Searches for an existing calendar_event first. If a match is found, Forge links through entity_links and calendar event links. If no match is found and projection is link_or_create, Forge creates a native calendar_event.",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/LifeEventCalendarSyncInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: [
                  "lifeEvent",
                  "calendarEvent",
                  "action",
                  "confidence"
                ],
                properties: {
                  lifeEvent: { $ref: "#/components/schemas/LifeEvent" },
                  calendarEvent: nullable({
                    $ref: "#/components/schemas/CalendarEvent"
                  }),
                  action: { type: "string" },
                  confidence: nullable({ type: "number" })
                }
              },
              "Calendar reconciliation result"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/life-events/from-calendar-event": {
        post: {
          summary: "Create or link a Life Event from a calendar event",
          description:
            "Calendar UI action for marking an existing calendar_event as a Life Event. The relationship is stored through generic entity_links and mirrored to the calendar event link list.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/LifeEventFromCalendarInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["lifeEvent", "calendarEvent", "action"],
                properties: {
                  lifeEvent: { $ref: "#/components/schemas/LifeEvent" },
                  calendarEvent: nullable({
                    $ref: "#/components/schemas/CalendarEvent"
                  }),
                  action: { type: "string" }
                }
              },
              "Life Event calendar conversion result"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/life-events/import-ticket": {
        post: {
          summary: "Draft or create a travel Life Event from a ticket artifact",
          description:
            "Uses only transient text from a fresh integrity-verified static scan of an active, plaintext, non-quarantined Artifact. Caller-supplied extracted text, Artifact descriptions, blocked, quarantined, archived, metadata-only, encrypted, or integrity-mismatched content is rejected. Agents must upload through Artifact Store first and must not download, execute, or parse stored bytes directly. Optional LLM extraction is only used when configured and approved.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/LifeEventTicketImportInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["draft", "artifact", "lifeEvent", "action"],
                properties: {
                  draft: { type: "object", additionalProperties: true },
                  artifact: { $ref: "#/components/schemas/Artifact" },
                  lifeEvent: nullable({
                    $ref: "#/components/schemas/LifeEvent"
                  }),
                  action: { type: "string" }
                }
              },
              "Ticket import result"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/life-events/{id}/travel-status": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        get: {
          summary: "Read Life Event travel status",
          description:
            "Returns scheduled travel status by default. Optional live providers such as OpenSky, FlightAware AeroAPI, AeroDataBox, Aviationstack, or ADS-B Exchange are provider abstractions and require configuration, rate limiting, and caching.",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["status"],
                properties: {
                  status: {
                    type: "object",
                    additionalProperties: true
                  }
                }
              },
              "Travel status"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
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
      "/api/v1/mobile/healthkit/sync-sessions": {
        post: {
          summary:
            "Start or resume a resumable mobile HealthKit upload session",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["sessionId", "pairingToken", "schemaVersion"],
                  properties: {
                    sessionId: { type: "string" },
                    pairingToken: { type: "string" },
                    schemaVersion: { type: "string" },
                    resumeSyncSessionId: nullable({ type: "string" }),
                    requestedFamilies: arrayOf({ type: "string" }),
                    sourceStates: arrayOf({
                      type: "object",
                      additionalProperties: true
                    }),
                    device: {
                      type: "object",
                      additionalProperties: true
                    }
                  }
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["upload"],
                properties: {
                  upload: mobileHealthSyncUploadSchema
                }
              },
              "Accepted upload session plus received chunk progress"
            )
          }
        }
      },
      "/api/v1/mobile/healthkit/sync-sessions/{id}": {
        get: {
          summary:
            "Inspect a mobile HealthKit upload session and accepted chunk progress",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "sessionId",
              in: "query",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "pairingToken",
              in: "query",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["upload"],
                properties: {
                  upload: mobileHealthSyncUploadSchema
                }
              },
              "Upload session status and accepted chunk progress"
            )
          }
        }
      },
      "/api/v1/mobile/healthkit/sync-sessions/{id}/chunks": {
        post: {
          summary:
            "Upload one idempotent HealthKit chunk into a resumable session",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: [
                    "sessionId",
                    "pairingToken",
                    "chunkId",
                    "family",
                    "sequence",
                    "records",
                    "byteCount",
                    "checksum"
                  ],
                  properties: {
                    sessionId: { type: "string" },
                    pairingToken: { type: "string" },
                    chunkId: { type: "string" },
                    family: { type: "string" },
                    sequence: { type: "number" },
                    records: { type: "number" },
                    byteCount: { type: "number" },
                    checksum: { type: "string" },
                    compression: nullable({ type: "string" }),
                    payloadEncoding: nullable({ type: "string" }),
                    payload: {}
                  }
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["chunk"],
                properties: {
                  chunk: {
                    type: "object",
                    additionalProperties: true,
                    required: ["accepted", "duplicate", "progress"],
                    properties: {
                      accepted: { type: "boolean" },
                      duplicate: { type: "boolean" },
                      progress: mobileHealthSyncProgressSchema
                    }
                  }
                }
              },
              "Chunk receipt with duplicate detection and aggregate progress"
            )
          }
        }
      },
      "/api/v1/doctor": {
        get: {
          summary:
            "Run Forge Doctor diagnostics for runtime, settings, storage, entities, hierarchy, rewards, and fix proposals",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["doctor"],
                properties: {
                  doctor: { $ref: "#/components/schemas/ForgeDoctorReport" }
                }
              },
              "Forge Doctor report"
            )
          }
        }
      },
      "/api/v1/doctor/fixes": {
        post: {
          summary: "Apply explicitly requested safe Forge Doctor fixes",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    fixIds: arrayOf({ type: "string" }),
                    applyAllSafe: { type: "boolean" }
                  }
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["results", "doctor"],
                properties: {
                  results: arrayOf({
                    $ref: "#/components/schemas/DoctorFixResult"
                  }),
                  doctor: { $ref: "#/components/schemas/ForgeDoctorReport" }
                }
              },
              "Forge Doctor fix result"
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
          parameters: [
            {
              name: "userIds",
              in: "query",
              schema: { type: "array", items: { type: "string" } },
              style: "form",
              explode: true,
              description: "Optional repeated user scope."
            },
            {
              name: "compact",
              in: "query",
              schema: { type: "boolean", default: false },
              description:
                "Omit workout session arrays for compact agent and overview reads."
            },
            {
              name: "sessionDetail",
              in: "query",
              schema: {
                type: "string",
                enum: ["full", "summary"],
                default: "full"
              },
              description:
                "Use summary for list rendering; read /api/v1/health/workouts/{id} for complete metadata before editing one workout."
            },
            {
              name: "analysisDetail",
              in: "query",
              schema: {
                type: "string",
                enum: ["full", "compact"],
                default: "full"
              },
              description:
                "Use compact for chart-ready analysis signals without repeating full workout list metadata. Existing clients keep the full analysis session shape by default."
            }
          ],
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
      "/api/v1/health/training-load": {
        get: {
          summary:
            "Read the Forge cardiovascular training load and target overview surface",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["trainingLoad"],
                properties: {
                  trainingLoad: {
                    $ref: "#/components/schemas/TrainingLoadViewData"
                  }
                }
              },
              "Training load overview"
            )
          }
        }
      },
      "/api/v1/health/weight-loss": {
        get: {
          tags: ["Health"],
          summary:
            "Read the Forge nutrition, weight-loss, food-effect, and body insight surface",
          parameters: [
            {
              name: "dateKey",
              in: "query",
              schema: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }
            },
            {
              name: "dayStartAt",
              in: "query",
              schema: { type: "string", format: "date-time" }
            },
            {
              name: "dayEndAt",
              in: "query",
              schema: { type: "string", format: "date-time" }
            },
            {
              name: "timeZone",
              in: "query",
              schema: { type: "string" },
              description:
                "IANA timezone used for default local-day calculation when dateKey is omitted."
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["weightLoss"],
                properties: {
                  weightLoss: {
                    $ref: "#/components/schemas/WeightLossViewData"
                  }
                }
              },
              "Weight loss overview"
            )
          }
        }
      },
      "/api/v1/health/weight-loss/target": {
        patch: {
          tags: ["Health"],
          summary: "Update nutrition and weight-loss targets",
          parameters: [nutritionMutationUserIdsParameter],
          requestBody: {
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["target"],
                properties: {
                  target: { type: "object", additionalProperties: true }
                }
              },
              "Updated nutrition target"
            )
          }
        }
      },
      "/api/v1/health/weight-loss/daily-active-calories": {
        patch: {
          tags: ["Health"],
          summary:
            "Set or clear the user-edited active calorie allowance for one weight-loss day",
          parameters: [nutritionMutationUserIdsParameter],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    userId: { type: "string" },
                    dayKey: {
                      type: "string",
                      pattern: "^\\d{4}-\\d{2}-\\d{2}$"
                    },
                    timeZone: {
                      type: "string",
                      description:
                        "IANA timezone used to derive the local dayKey when dayKey is omitted."
                    },
                    activeCaloriesKcal: {
                      type: ["number", "null"],
                      minimum: 0
                    },
                    notes: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["dayKey"],
                properties: {
                  dayKey: { type: "string" },
                  override: {
                    type: ["object", "null"],
                    additionalProperties: true
                  }
                }
              },
              "Updated daily active calorie override"
            )
          }
        }
      },
      "/api/v1/health/weight-loss/foods/search": {
        post: {
          tags: ["Health"],
          summary: "Search nutrition foods across local and public catalogs",
          description:
            "Searches Forge's local nutrition_food_catalog first, including custom foods, then public Open Food Facts and USDA-backed sources. Reuse returned ids as NutritionMealItemInput.foodId before creating a new custom food.",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["query"],
                  properties: {
                    query: { type: "string" },
                    limit: { type: "integer", minimum: 1, maximum: 30 }
                  }
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["foods"],
                properties: {
                  foods: arrayOf({
                    $ref: "#/components/schemas/NutritionFoodSearchResult"
                  })
                }
              },
              "Nutrition food search results"
            )
          }
        }
      },
      "/api/v1/health/weight-loss/foods/barcode": {
        post: {
          tags: ["Health"],
          summary: "Lookup one nutrition food by barcode",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["barcode"],
                  properties: { barcode: { type: "string" } }
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["food"],
                properties: {
                  food: nullable({
                    $ref: "#/components/schemas/NutritionFoodSearchResult"
                  })
                }
              },
              "Nutrition barcode lookup result"
            )
          }
        }
      },
      "/api/v1/health/weight-loss/food-logs": {
        post: {
          tags: ["Health"],
          summary: "Create a nutrition food log",
          description:
            "Creates one food log atomically. Supply a stable Idempotency-Key when a client may retry after a timeout or lost response; exact replay returns the original log with status 200 and Idempotency-Replayed: true, while changed content with the same key returns 409.",
          parameters: [
            nutritionMutationUserIdsParameter,
            nutritionIdempotencyKeyParameter
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/NutritionFoodLogInput" }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["log"],
                properties: {
                  log: { $ref: "#/components/schemas/NutritionFoodLog" }
                }
              },
              "Exact replay of a previously created nutrition food log"
            ),
            "201": jsonResponse(
              {
                type: "object",
                required: ["log"],
                properties: {
                  log: { $ref: "#/components/schemas/NutritionFoodLog" }
                }
              },
              "Created nutrition food log"
            )
          }
        }
      },
      "/api/v1/health/weight-loss/food-logs/{id}": {
        patch: {
          tags: ["Health"],
          summary: "Patch a nutrition food log",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            },
            nutritionMutationUserIdsParameter
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/NutritionFoodLogPatchInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["log"],
                properties: {
                  log: { $ref: "#/components/schemas/NutritionFoodLog" }
                }
              },
              "Updated nutrition food log"
            )
          }
        },
        delete: {
          tags: ["Health"],
          summary: "Delete a nutrition food log",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            },
            nutritionMutationUserIdsParameter
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["deleted"],
                properties: { deleted: { type: "boolean" } }
              },
              "Deleted nutrition food log"
            )
          }
        }
      },
      "/api/v1/health/weight-loss/parse": {
        post: {
          tags: ["Health"],
          summary:
            "Parse a food log through Forge's openai-codex ChatGPT subscription connection",
          parameters: [nutritionMutationUserIdsParameter],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    text: { type: "string" },
                    mealTime: { type: "string", format: "date-time" },
                    imageRefs: arrayOf({ type: "string" }),
                    connectionId: { type: "string" },
                    commitCandidate: { type: "boolean" }
                  }
                }
              }
            }
          },
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: [
                  "candidate",
                  "log",
                  "parseSummary",
                  "clarificationQuestions",
                  "uncertaintyReasons"
                ],
                properties: {
                  candidate: {
                    $ref: "#/components/schemas/NutritionFoodLogInput"
                  },
                  log: nullable({
                    $ref: "#/components/schemas/NutritionFoodLog"
                  }),
                  parseSummary: {
                    type: "object",
                    required: [
                      "itemCount",
                      "completeNutritionItemCount",
                      "catalogResolvedItemCount",
                      "chatGptEstimatedItemCount",
                      "chatGptValidatedItemCount",
                      "elapsedMs",
                      "llmCallCount"
                    ],
                    properties: {
                      itemCount: { type: "number" },
                      completeNutritionItemCount: { type: "number" },
                      catalogResolvedItemCount: { type: "number" },
                      chatGptEstimatedItemCount: { type: "number" },
                      chatGptValidatedItemCount: { type: "number" },
                      elapsedMs: { type: "number" },
                      llmCallCount: { type: "number" }
                    }
                  },
                  clarificationQuestions: arrayOf({ type: "string" }),
                  uncertaintyReasons: arrayOf({ type: "string" })
                }
              },
              "Parsed candidate nutrition food log"
            )
          }
        }
      },
      "/api/v1/health/weight-loss/body-checkins": {
        post: {
          tags: ["Health"],
          summary: "Create a body-composition check-in",
          parameters: [
            nutritionMutationUserIdsParameter,
            nutritionIdempotencyKeyParameter
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/NutritionBodyCheckinInput"
                }
              }
            }
          },
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["checkin"],
                properties: {
                  checkin: { type: "object", additionalProperties: true }
                }
              },
              "Created body check-in"
            )
          }
        }
      },
      "/api/v1/health/weight-loss/appearance-checkins": {
        post: {
          tags: ["Health"],
          summary: "Create an aesthetic appearance check-in",
          parameters: [
            nutritionMutationUserIdsParameter,
            nutritionIdempotencyKeyParameter
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/NutritionAppearanceCheckinInput"
                }
              }
            }
          },
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["checkin"],
                properties: {
                  checkin: { type: "object", additionalProperties: true }
                }
              },
              "Created appearance check-in"
            )
          }
        }
      },
      "/api/v1/health/weight-loss/subjective-checkins": {
        post: {
          tags: ["Health"],
          summary: "Create a subjective food-effect check-in",
          parameters: [
            nutritionMutationUserIdsParameter,
            nutritionIdempotencyKeyParameter
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/NutritionSubjectiveCheckinInput"
                }
              }
            }
          },
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["checkin"],
                properties: {
                  checkin: { type: "object", additionalProperties: true }
                }
              },
              "Created subjective check-in"
            )
          }
        }
      },
      "/api/v1/health/weight-loss/gut-checkins": {
        post: {
          tags: ["Health"],
          summary: "Create a gut-health food-effect check-in",
          parameters: [
            nutritionMutationUserIdsParameter,
            nutritionIdempotencyKeyParameter
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/NutritionGutCheckinInput"
                }
              }
            }
          },
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["checkin"],
                properties: {
                  checkin: { type: "object", additionalProperties: true }
                }
              },
              "Created gut check-in"
            )
          }
        }
      },
      "/api/v1/health/weight-loss/patterns": {
        get: {
          tags: ["Health"],
          summary: "Read current nutrition hypotheses and experiments",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["hypotheses", "experiments"],
                properties: {
                  hypotheses: arrayOf({
                    type: "object",
                    additionalProperties: true
                  }),
                  experiments: arrayOf({
                    $ref: "#/components/schemas/NutritionExperiment"
                  })
                }
              },
              "Nutrition pattern candidates"
            )
          }
        }
      },
      "/api/v1/health/weight-loss/experiments": {
        post: {
          tags: ["Health"],
          summary: "Create a nutrition N-of-1 experiment",
          description:
            "Creates a structured experiment. Agents should provide a testable hypothesis, one primary metric, and a specific intervention even though title is the only compatibility-required field. A scheduled baseline must end before the intervention starts.",
          parameters: [
            {
              name: "userIds",
              in: "query",
              required: false,
              schema: arrayOf({ type: "string" }),
              style: "form",
              explode: true,
              description:
                "Select exactly one Forge user. A body userId must match this selection, and scoped tokens may select only an allowed user."
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/NutritionExperimentInput"
                }
              }
            }
          },
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["experiment"],
                properties: {
                  experiment: {
                    $ref: "#/components/schemas/NutritionExperiment"
                  }
                }
              },
              "Created nutrition experiment"
            )
          }
        }
      },
      "/api/v1/health/weight-loss/experiments/{id}": {
        patch: {
          tags: ["Health"],
          summary: "Patch a nutrition N-of-1 experiment",
          description:
            "Updates method, status, adherence, evidence counts, or conclusion. Completion requires an explicit conclusion, at least one planned exposure, at least one completed exposure, at least two intervention observations, and at least two baseline observations when a baseline window was scheduled.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            },
            nutritionMutationUserIdsParameter
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/NutritionExperimentPatchInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["experiment"],
                properties: {
                  experiment: {
                    $ref: "#/components/schemas/NutritionExperiment"
                  }
                }
              },
              "Updated nutrition experiment"
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
          summary:
            "Record a tired or recovered fatigue signal and rebuild life-force state",
          description:
            "Records a current intensity-scaled signal with optional context. The newest signal replaces the previous short-term effect, expires after four hours, and cannot be future-dated.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["signalType"],
                  properties: {
                    signalType: {
                      type: "string",
                      enum: ["tired", "okay_again"]
                    },
                    intensity: {
                      type: "integer",
                      minimum: 1,
                      maximum: 10,
                      default: 5
                    },
                    observedAt: { type: "string", format: "date-time" },
                    note: { type: "string", maxLength: 500, default: "" }
                  }
                }
              }
            }
          },
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
          parameters: [
            movementUserIdsParameter,
            {
              name: "date",
              in: "query",
              schema: { type: "string", format: "date" },
              description: "Local calendar date. Defaults to today."
            },
            {
              name: "timeZone",
              in: "query",
              schema: {
                type: "string",
                maxLength: 100,
                example: "Europe/Zurich"
              },
              description:
                "IANA timezone that defines the selected local date and its DST-aware midnight boundaries. Defaults to the Forge runtime timezone."
            }
          ],
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
          parameters: [
            movementUserIdsParameter,
            {
              name: "month",
              in: "query",
              schema: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}$" },
              description: "Local calendar month in YYYY-MM form."
            }
          ],
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
          summary:
            "Read all-time movement summary including place and trip distribution",
          parameters: [movementUserIdsParameter],
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
          parameters: [
            movementUserIdsParameter,
            {
              name: "before",
              in: "query",
              schema: { type: "string" },
              description:
                "Opaque cursor returned by the previous timeline page."
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 360, default: 40 }
            },
            {
              name: "includeInvalid",
              in: "query",
              schema: { type: "boolean", default: false },
              description:
                "Include invalidated automatic boxes for data review."
            }
          ],
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
          parameters: [movementUserIdsParameter],
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
          parameters: [movementUserIdsParameter],
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
          parameters: [movementUserIdsParameter],
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
          parameters: [movementUserIdsParameter],
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
        parameters: [movementIdParameter],
        patch: {
          summary: "Update one known movement place",
          parameters: [movementUserIdsParameter],
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
          parameters: [movementUserIdsParameter],
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
          parameters: [movementUserIdsParameter],
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
        parameters: [movementIdParameter],
        patch: {
          summary: "Update one user-defined movement overlay box",
          parameters: [movementUserIdsParameter],
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
          parameters: [movementUserIdsParameter],
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
        parameters: [movementIdParameter],
        post: {
          summary:
            "Hide one automatic movement box and project the resulting user-defined overlay",
          parameters: [movementUserIdsParameter],
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
        parameters: [movementIdParameter],
        patch: {
          summary: "Update one recorded movement stay",
          parameters: [movementUserIdsParameter],
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
          parameters: [movementUserIdsParameter],
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
      "/api/v1/movement/boxes/{id}": {
        parameters: [movementIdParameter],
        get: {
          summary:
            "Read one movement box with projected detail, provenance, and raw linked evidence",
          parameters: [movementUserIdsParameter],
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
              "Movement box detail"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/movement/trips/{id}": {
        parameters: [movementIdParameter],
        get: {
          summary: "Read one movement trip with its full detail",
          parameters: [movementUserIdsParameter],
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
          parameters: [movementUserIdsParameter],
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
          parameters: [movementUserIdsParameter],
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
        parameters: [movementIdParameter, movementPointIdParameter],
        patch: {
          summary: "Update one movement trip datapoint",
          parameters: [movementUserIdsParameter],
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
          parameters: [movementUserIdsParameter],
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
          summary: "Search the bounded Workbench box catalog",
          description:
            "Returns one page of Forge node boxes and saved-flow published outputs. Full typed contracts are retained inside the bounded page; follow hasMore with offset to continue.",
          parameters: [
            {
              name: "q",
              in: "query",
              schema: { type: "string", maxLength: 200 }
            },
            {
              name: "category",
              in: "query",
              schema: {
                type: "array",
                maxItems: 20,
                items: { type: "string", minLength: 1, maxLength: 100 }
              },
              style: "form",
              explode: true
            },
            {
              name: "surfaceId",
              in: "query",
              schema: {
                type: "array",
                maxItems: 20,
                items: { type: "string", minLength: 1, maxLength: 100 }
              },
              style: "form",
              explode: true
            },
            {
              name: "source",
              in: "query",
              schema: {
                type: "array",
                maxItems: 2,
                items: { type: "string", enum: ["forge", "flow_output"] }
              },
              style: "form",
              explode: true
            },
            {
              name: "limit",
              in: "query",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 100,
                default: 24
              }
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", minimum: 0, default: 0 }
            }
          ],
          responses: {
            "200": jsonResponse(
              { $ref: "#/components/schemas/WorkbenchBoxCatalogPage" },
              "Bounded Workbench box catalog page"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/workbench/flows": {
        get: {
          summary: "Search the bounded Workbench flow catalog",
          description:
            "Returns compact flow summaries without graph bodies or run payloads. endpointEnabled describes the callable endpoint state; disabled flows remain discoverable and can still be opened for review or editing.",
          parameters: [
            {
              name: "q",
              in: "query",
              schema: { type: "string", maxLength: 200 }
            },
            {
              name: "kind",
              in: "query",
              schema: {
                type: "array",
                maxItems: 2,
                items: { type: "string", enum: ["functor", "chat"] }
              },
              style: "form",
              explode: true
            },
            {
              name: "homeSurfaceId",
              in: "query",
              schema: {
                type: "array",
                maxItems: 20,
                items: { type: "string", minLength: 1, maxLength: 100 }
              },
              style: "form",
              explode: true
            },
            {
              name: "status",
              in: "query",
              schema: {
                type: "array",
                maxItems: 2,
                items: { type: "string", enum: ["enabled", "disabled"] }
              },
              style: "form",
              explode: true
            },
            {
              name: "limit",
              in: "query",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 100,
                default: 24
              }
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", minimum: 0, default: 0 }
            }
          ],
          responses: {
            "200": jsonResponse(
              { $ref: "#/components/schemas/WorkbenchFlowCatalogPage" },
              "Bounded Workbench flow catalog page"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" }
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
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 100,
                default: 20
              }
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", minimum: 0, default: 0 }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: [
                  "flow",
                  "runs",
                  "total",
                  "limit",
                  "offset",
                  "hasMore",
                  "conversation"
                ],
                properties: {
                  flow: {
                    type: "object",
                    additionalProperties: true
                  },
                  runs: arrayOf({
                    $ref: "#/components/schemas/WorkbenchRun"
                  }),
                  total: { type: "integer", minimum: 0 },
                  limit: { type: "integer", minimum: 1, maximum: 100 },
                  offset: { type: "integer", minimum: 0 },
                  hasMore: { type: "boolean" },
                  conversation: nullable({
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
                  run: { $ref: "#/components/schemas/WorkbenchRun" },
                  conversation: nullable({
                    type: "object",
                    additionalProperties: true
                  })
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
                  run: { $ref: "#/components/schemas/WorkbenchRun" },
                  conversation: nullable({
                    type: "object",
                    additionalProperties: true
                  })
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
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 100,
                default: 20
              }
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", minimum: 0, default: 0 }
            }
          ],
          responses: {
            "200": jsonResponse(
              { $ref: "#/components/schemas/WorkbenchRunPage" },
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
                  run: { $ref: "#/components/schemas/WorkbenchRun" }
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
                required: ["flow", "nodeResults"],
                properties: {
                  flow: {
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
          summary:
            "List compact wiki or evidence page summaries inside one space",
          parameters: [
            { in: "query", name: "spaceId", schema: { type: "string" } },
            {
              in: "query",
              name: "kind",
              schema: { type: "string", enum: ["wiki", "evidence"] }
            },
            {
              in: "query",
              name: "limit",
              schema: { type: "integer", minimum: 1, maximum: 500, default: 50 }
            },
            {
              in: "query",
              name: "offset",
              schema: {
                type: "integer",
                minimum: 0,
                maximum: 9999,
                default: 0
              }
            },
            {
              in: "query",
              name: "includeHidden",
              schema: { type: "boolean", default: false }
            }
          ],
          responses: {
            "200": jsonResponse(
              { $ref: "#/components/schemas/WikiPageListResponse" },
              "Wiki page list"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a wiki page through the SQLite-backed wiki surface",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WikiPageCreateInput" }
              }
            }
          },
          responses: {
            "201": jsonResponse(
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
      "/api/v1/wiki/home": {
        get: {
          summary: "Read the home document for one readable wiki space",
          parameters: [
            { in: "query", name: "spaceId", schema: { type: "string" } }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["page"],
                properties: {
                  page: { type: "object", additionalProperties: true }
                }
              },
              "Wiki home page detail"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/wiki/tree": {
        get: {
          summary: "Browse a bounded hierarchy of compact wiki page summaries",
          parameters: [
            { in: "query", name: "spaceId", schema: { type: "string" } },
            {
              in: "query",
              name: "kind",
              schema: { type: "string", enum: ["wiki", "evidence"] }
            },
            {
              in: "query",
              name: "limit",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 500,
                default: 500
              }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["tree", "truncated"],
                properties: {
                  tree: arrayOf({ $ref: "#/components/schemas/WikiTreeNode" }),
                  truncated: { type: "boolean" }
                }
              },
              "Wiki page tree"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/wiki/pages/{id}": {
        get: {
          summary: "Read one wiki page with backlinks and attached metadata",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", minLength: 1 }
            }
          ],
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
            "Update an existing wiki page through the SQLite-backed surface",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", minLength: 1 }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WikiPagePatchInput" }
              }
            }
          },
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
        },
        delete: {
          summary: "Delete or hide one wiki page from the wiki surface",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", minLength: 1 }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["deleted"],
                properties: {
                  deleted: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id"],
                    properties: { id: { type: "string" } }
                  }
                }
              },
              "Deleted wiki page"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/wiki/by-slug/{slug}": {
        get: {
          summary: "Read one wiki page by slug or title-like slug",
          parameters: [
            {
              in: "path",
              name: "slug",
              required: true,
              schema: { type: "string", minLength: 1 }
            },
            { in: "query", name: "spaceId", schema: { type: "string" } }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["page"],
                properties: {
                  page: { type: "object", additionalProperties: true }
                }
              },
              "Wiki page detail by slug"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/wiki/search": {
        post: {
          summary:
            "Search compact wiki page summaries with ranked title, alias, content, entity, or semantic retrieval",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WikiSearchInput" }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              { $ref: "#/components/schemas/WikiSearchResponse" },
              "Wiki search results"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/wiki/health": {
        get: {
          summary: "Read wiki health signals for one space",
          parameters: [
            { in: "query", name: "spaceId", schema: { type: "string" } }
          ],
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
          summary: "Rebuild SQLite wiki search, link, and metadata indexes",
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
        get: {
          summary: "List bounded wiki ingest jobs in accessible spaces",
          parameters: [
            { in: "query", name: "spaceId", schema: { type: "string" } },
            {
              in: "query",
              name: "limit",
              schema: { type: "integer", minimum: 1, maximum: 200, default: 20 }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["jobs", "total"],
                properties: {
                  jobs: arrayOf({ type: "object", additionalProperties: true }),
                  total: { type: "integer", minimum: 0 }
                }
              },
              "Wiki ingest jobs"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary:
            "Queue a wiki ingest job from raw text, local files, or a URL",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true }
              }
            }
          },
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                additionalProperties: true
              },
              "Queued wiki ingest job"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/wiki/ingest-jobs/uploads": {
        post: {
          summary: "Queue a wiki ingest job from multipart uploads",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: { type: "object", additionalProperties: true }
              }
            }
          },
          responses: {
            "201": jsonResponse(
              { type: "object", additionalProperties: true },
              "Queued uploaded wiki ingest job"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/wiki/ingest-jobs/{id}": {
        get: {
          summary: "Read one accessible wiki ingest job",
          responses: {
            "200": jsonResponse(
              { type: "object", additionalProperties: true },
              "Wiki ingest job"
            ),
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete one eligible accessible wiki ingest job",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["deleted"],
                properties: {
                  deleted: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id"],
                    properties: { id: { type: "string" } }
                  }
                }
              },
              "Deleted wiki ingest job"
            ),
            "404": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/wiki/ingest-jobs/{id}/rerun": {
        post: {
          summary: "Queue a rerun of one completed accessible wiki ingest job",
          responses: {
            "201": jsonResponse(
              { type: "object", additionalProperties: true },
              "Queued wiki ingest rerun"
            ),
            "404": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/wiki/ingest-jobs/{id}/resume": {
        post: {
          summary: "Resume one recoverable accessible wiki ingest job",
          responses: {
            "200": jsonResponse(
              { type: "object", additionalProperties: true },
              "Wiki ingest resume status"
            ),
            "404": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/wiki/ingest-jobs/{id}/review": {
        post: {
          summary: "Review candidates from one accessible wiki ingest job",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              { type: "object", additionalProperties: true },
              "Reviewed wiki ingest job"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" }
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
      "/api/v1/today/priority": {
        get: {
          summary:
            "Read the canonical deterministic Today work-priority decision",
          parameters: [
            {
              name: "userIds",
              in: "query",
              schema: { type: "array", items: { type: "string" } },
              style: "form",
              explode: true,
              description:
                "Optional repeated user scope. Capacity evidence is applied only when exactly one authorized user is selected."
            },
            {
              name: "timeZone",
              in: "query",
              schema: { type: "string", minLength: 1, maxLength: 100 },
              description:
                "IANA timezone used for due dates, local-day capacity, and timeboxes."
            },
            {
              name: "candidateLimit",
              in: "query",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 100,
                default: 24
              }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["decision"],
                properties: {
                  decision: {
                    $ref: "#/components/schemas/TodayPriorityDecision"
                  }
                }
              },
              "Canonical Today priority decision"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/daily-briefing": {
        get: {
          summary:
            "Read one owner's deterministic, permission-first daily briefing",
          security: [{ operatorSession: [] }, { bearerAuth: [] }],
          description:
            "Returns a read-only briefing from authorized current work, today's calendar, an existing same-day Life Force snapshot, and recent recorded activity. Sources are owner-filtered before bounded ranking or limiting. Every statement carries source, freshness, and evidence provenance; unavailable or stale lanes state why they were omitted. The endpoint does not create, synchronize, or update records, does not invent recommendations, and does not make medical or causal claims. At most 101 tasks, 21 active runs, 41 calendar records, and 13 activity records are inspected; the response is capped at 64 KiB.",
          parameters: [
            {
              name: "userId",
              in: "query",
              required: true,
              schema: { type: "string", minLength: 1, maxLength: 240 },
              description:
                "Exactly one authorized owner whose briefing may be read."
            },
            {
              name: "timeZone",
              in: "query",
              schema: { type: "string", minLength: 1, maxLength: 100 },
              description:
                "Optional IANA timezone; defaults to the server's configured Forge timezone."
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["briefing"],
                properties: {
                  briefing: { $ref: "#/components/schemas/DailyBriefing" }
                }
              },
              "Owner-scoped deterministic daily briefing"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" }
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
            "Read the stored Preferences workspace without mutating or refreshing it",
          parameters: [
            { in: "query", name: "userId", schema: { type: "string" } },
            {
              in: "query",
              name: "domain",
              schema: { type: "string", enum: PREFERENCE_DOMAIN_VALUES }
            },
            { in: "query", name: "contextId", schema: { type: "string" } },
            {
              in: "query",
              name: "itemLimit",
              schema: { type: "integer", minimum: 1, maximum: 100, default: 50 }
            },
            {
              in: "query",
              name: "itemOffset",
              schema: { type: "integer", minimum: 0, default: 0 }
            },
            {
              in: "query",
              name: "historyLimit",
              schema: { type: "integer", minimum: 1, maximum: 100, default: 50 }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["workspace"],
                properties: {
                  workspace: {
                    $ref: "#/components/schemas/PreferenceWorkspace"
                  }
                }
              },
              "Preferences workspace"
            ),
            ...preferenceErrorResponses(400, 401, 403, 404, 500)
          }
        }
      },
      "/api/v1/preferences/workspace/refresh": {
        post: {
          summary:
            "Initialize or refresh one Preferences workspace with authenticated write provenance",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PreferenceWorkspaceRefreshInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["workspace"],
                properties: {
                  workspace: {
                    $ref: "#/components/schemas/PreferenceWorkspace"
                  }
                }
              },
              "Initialized or refreshed Preferences workspace"
            ),
            ...preferenceErrorResponses(400, 401, 403, 404, 500)
          }
        }
      },
      "/api/v1/preferences/game/start": {
        post: {
          summary:
            "Start the Preferences game for a domain or concept list and return the refreshed workspace",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PreferenceGameStartInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["workspace"],
                properties: {
                  workspace: {
                    $ref: "#/components/schemas/PreferenceWorkspace"
                  }
                }
              },
              "Refreshed Preferences workspace"
            ),
            ...preferenceErrorResponses(400, 401, 403, 404, 500)
          }
        }
      },
      "/api/v1/preferences/catalogs": {
        get: {
          summary: "List Preferences concept lists",
          description:
            "Returns an authenticated, owner-scoped, bounded catalog page. Normal agent reads should use POST /api/v1/entities/search with entityType preference_catalog.",
          parameters: [
            {
              in: "query",
              name: "domain",
              schema: { type: "string", enum: PREFERENCE_DOMAIN_VALUES }
            },
            {
              in: "query",
              name: "query",
              schema: { type: "string", maxLength: 200 }
            },
            {
              in: "query",
              name: "limit",
              schema: { type: "integer", minimum: 1, maximum: 100, default: 24 }
            },
            {
              in: "query",
              name: "offset",
              schema: { type: "integer", minimum: 0, default: 0 }
            },
            {
              in: "query",
              name: "cursor",
              schema: { type: "string", minLength: 1, maxLength: 2048 },
              description:
                "Opaque snapshot cursor returned by the preceding page. Do not combine it with a positive offset."
            },
            { in: "query", name: "userId", schema: { type: "string" } },
            {
              in: "query",
              name: "userIds",
              schema: arrayOf({ type: "string" })
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: [
                  "catalogs",
                  "limit",
                  "offset",
                  "hasMore",
                  "nextOffset",
                  "previousOffset",
                  "snapshotAt",
                  "nextCursor"
                ],
                properties: {
                  catalogs: arrayOf({
                    $ref: "#/components/schemas/PreferenceCatalog"
                  }),
                  limit: { type: "integer", minimum: 1, maximum: 100 },
                  offset: { type: "integer", minimum: 0 },
                  hasMore: { type: "boolean" },
                  nextOffset: nullable({ type: "integer", minimum: 0 }),
                  previousOffset: nullable({ type: "integer", minimum: 0 }),
                  snapshotAt: { type: "string", format: "date-time" },
                  nextCursor: nullable({ type: "string" })
                }
              },
              "Preferences catalogs"
            ),
            ...preferenceErrorResponses(400, 401, 403, 500)
          }
        },
        post: {
          summary: "Create a Preferences concept list",
          description:
            "Creates one owner-scoped catalog atomically with immutable creator provenance, general entity links, and deterministic duplicate handling. Accepts Idempotency-Key for safe retries. Agents should normally use POST /api/v1/entities/create.",
          parameters: [
            {
              in: "header",
              name: "Idempotency-Key",
              required: false,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PreferenceCatalogCreateInput"
                }
              }
            }
          },
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["catalog"],
                properties: {
                  catalog: { $ref: "#/components/schemas/PreferenceCatalog" }
                }
              },
              "Created Preferences catalog"
            ),
            ...preferenceErrorResponses(400, 401, 403, 404, 409, 500)
          }
        }
      },
      "/api/v1/preferences/catalogs/{id}": {
        get: {
          summary: "Get one Preferences concept list",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["catalog"],
                properties: {
                  catalog: { $ref: "#/components/schemas/PreferenceCatalog" }
                }
              },
              "Preferences catalog"
            ),
            ...preferenceErrorResponses(401, 403, 404, 500)
          }
        },
        patch: {
          summary: "Update a Preferences concept list",
          description:
            "Updates mutable purpose, boundary, slug, and general-link fields. Owner and creator provenance remain immutable.",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PreferenceCatalogPatchInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["catalog"],
                properties: {
                  catalog: { $ref: "#/components/schemas/PreferenceCatalog" }
                }
              },
              "Updated Preferences catalog"
            ),
            ...preferenceErrorResponses(400, 401, 403, 404, 409, 500)
          }
        },
        delete: {
          summary: "Archive a Preferences concept list",
          description:
            "Idempotently moves the catalog to Forge's reversible settings bin. Repeating the request returns the same archived catalog. Existing preference evidence is preserved; concepts that were active at archive time are restored with the catalog.",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["catalog"],
                properties: {
                  catalog: { $ref: "#/components/schemas/PreferenceCatalog" }
                }
              },
              "Archived Preferences catalog"
            ),
            ...preferenceErrorResponses(401, 403, 404, 500)
          }
        }
      },
      "/api/v1/preferences/catalog-items": {
        get: {
          summary: "List Preferences concept entries",
          description:
            "Returns an authenticated, owner-scoped, bounded page. Use the returned cursor to traverse one insertion-stable snapshot; offset remains available for legacy callers.",
          parameters: [
            {
              in: "query",
              name: "catalogId",
              schema: { type: "string", minLength: 1 }
            },
            {
              in: "query",
              name: "query",
              schema: { type: "string", maxLength: 200 }
            },
            {
              in: "query",
              name: "limit",
              schema: { type: "integer", minimum: 1, maximum: 200, default: 24 }
            },
            {
              in: "query",
              name: "offset",
              schema: { type: "integer", minimum: 0, default: 0 }
            },
            {
              in: "query",
              name: "cursor",
              schema: { type: "string", minLength: 1, maxLength: 2048 },
              description:
                "Opaque snapshot cursor returned by the preceding page. Do not combine it with a positive offset."
            },
            { in: "query", name: "userId", schema: { type: "string" } },
            {
              in: "query",
              name: "userIds",
              schema: arrayOf({ type: "string" })
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: [
                  "items",
                  "limit",
                  "offset",
                  "hasMore",
                  "nextOffset",
                  "previousOffset",
                  "snapshotAt",
                  "nextCursor"
                ],
                properties: {
                  items: arrayOf({
                    $ref: "#/components/schemas/PreferenceCatalogItem"
                  }),
                  limit: { type: "integer", minimum: 1, maximum: 200 },
                  offset: { type: "integer", minimum: 0 },
                  hasMore: { type: "boolean" },
                  nextOffset: nullable({ type: "integer", minimum: 0 }),
                  previousOffset: nullable({ type: "integer", minimum: 0 }),
                  snapshotAt: { type: "string", format: "date-time" },
                  nextCursor: nullable({ type: "string" })
                }
              },
              "Preferences catalog items"
            ),
            ...preferenceErrorResponses(400, 401, 403, 500)
          }
        },
        post: {
          summary: "Create a Preferences concept entry",
          description:
            "Creates one owner-scoped reusable concept. Active labels are unique within a catalog after trimming and case normalization.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PreferenceCatalogItemCreateInput"
                }
              }
            }
          },
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["item"],
                properties: {
                  item: { $ref: "#/components/schemas/PreferenceCatalogItem" }
                }
              },
              "Created Preferences catalog item"
            ),
            ...preferenceErrorResponses(400, 401, 403, 404, 409, 500)
          }
        }
      },
      "/api/v1/preferences/catalog-items/{id}": {
        get: {
          summary: "Get one Preferences concept entry",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", minLength: 1 }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["item"],
                properties: {
                  item: { $ref: "#/components/schemas/PreferenceCatalogItem" }
                }
              },
              "Preferences catalog item"
            ),
            ...preferenceErrorResponses(401, 403, 404, 500)
          }
        },
        patch: {
          summary: "Update a Preferences concept entry",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", minLength: 1 }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PreferenceCatalogItemPatchInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["item"],
                properties: {
                  item: { $ref: "#/components/schemas/PreferenceCatalogItem" }
                }
              },
              "Updated Preferences catalog item"
            ),
            ...preferenceErrorResponses(400, 401, 403, 404, 409, 500)
          }
        },
        delete: {
          summary: "Move a Preferences concept entry to the bin",
          description:
            "Idempotently archives the reusable concept in Forge's reversible settings bin. Its ownership, general entity links, and preference evidence are preserved. Restore it through POST /api/v1/entities/restore; permanent deletion remains an explicit bin action.",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", minLength: 1 }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["item"],
                properties: {
                  item: { $ref: "#/components/schemas/PreferenceCatalogItem" }
                }
              },
              "Archived Preferences catalog item"
            ),
            ...preferenceErrorResponses(401, 403, 404, 500)
          }
        }
      },
      "/api/v1/preferences/contexts": {
        get: {
          summary: "List Preferences contexts",
          parameters: [
            { in: "query", name: "userId", schema: { type: "string" } },
            {
              in: "query",
              name: "userIds",
              schema: arrayOf({ type: "string" })
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["contexts"],
                properties: {
                  contexts: arrayOf({
                    $ref: "#/components/schemas/PreferenceContext"
                  })
                }
              },
              "Preferences contexts"
            ),
            ...preferenceErrorResponses(400, 401, 403, 500)
          }
        },
        post: {
          summary: "Create a Preferences context",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PreferenceContextCreateInput"
                }
              }
            }
          },
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["context"],
                properties: {
                  context: { $ref: "#/components/schemas/PreferenceContext" }
                }
              },
              "Created Preferences context"
            ),
            ...preferenceErrorResponses(400, 401, 403, 404, 500)
          }
        }
      },
      "/api/v1/preferences/contexts/{id}": {
        get: {
          summary: "Get one Preferences context",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", minLength: 1 }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["context"],
                properties: {
                  context: { $ref: "#/components/schemas/PreferenceContext" }
                }
              },
              "Preferences context"
            ),
            ...preferenceErrorResponses(401, 403, 404, 500)
          }
        },
        patch: {
          summary: "Update a Preferences context",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", minLength: 1 }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PreferenceContextPatchInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["context"],
                properties: {
                  context: { $ref: "#/components/schemas/PreferenceContext" }
                }
              },
              "Updated Preferences context"
            ),
            ...preferenceErrorResponses(400, 401, 403, 404, 500)
          }
        },
        delete: {
          summary: "Delete a Preferences context",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", minLength: 1 }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["context"],
                properties: {
                  context: { $ref: "#/components/schemas/PreferenceContext" }
                }
              },
              "Deleted Preferences context"
            ),
            ...preferenceErrorResponses(400, 401, 403, 404, 500)
          }
        }
      },
      "/api/v1/preferences/contexts/merge": {
        post: {
          summary: "Merge one Preferences context into another",
          description:
            "Moves judgments and signals from one source context into one target context on the same preference profile, clears derived source scores and summaries, deactivates the source, and recomputes the target.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["sourceContextId", "targetContextId"],
                  properties: {
                    sourceContextId: { type: "string", minLength: 1 },
                    targetContextId: { type: "string", minLength: 1 }
                  }
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["merge"],
                properties: {
                  merge: {
                    type: "object",
                    additionalProperties: false,
                    required: ["source", "target"],
                    properties: {
                      source: {
                        $ref: "#/components/schemas/PreferenceContext"
                      },
                      target: { $ref: "#/components/schemas/PreferenceContext" }
                    }
                  }
                }
              },
              "Merged Preferences contexts"
            ),
            ...preferenceErrorResponses(400, 401, 403, 404, 500)
          }
        }
      },
      "/api/v1/preferences/items": {
        get: {
          summary: "List Preferences items",
          parameters: [
            { in: "query", name: "userId", schema: { type: "string" } },
            {
              in: "query",
              name: "userIds",
              schema: arrayOf({ type: "string" })
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["items"],
                properties: {
                  items: arrayOf({
                    $ref: "#/components/schemas/PreferenceItem"
                  })
                }
              },
              "Preferences items"
            ),
            ...preferenceErrorResponses(400, 401, 403, 500)
          }
        },
        post: {
          summary: "Create a standalone Preferences item",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PreferenceItemCreateInput"
                }
              }
            }
          },
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["item"],
                properties: {
                  item: { $ref: "#/components/schemas/PreferenceItem" }
                }
              },
              "Created Preferences item"
            ),
            ...preferenceErrorResponses(400, 401, 403, 404, 409, 500)
          }
        }
      },
      "/api/v1/preferences/items/{id}": {
        get: {
          summary: "Get one Preferences item",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", minLength: 1 }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["item"],
                properties: {
                  item: { $ref: "#/components/schemas/PreferenceItem" }
                }
              },
              "Preferences item"
            ),
            ...preferenceErrorResponses(401, 403, 404, 500)
          }
        },
        patch: {
          summary: "Update a Preferences item",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", minLength: 1 }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PreferenceItemPatchInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["item"],
                properties: {
                  item: { $ref: "#/components/schemas/PreferenceItem" }
                }
              },
              "Updated Preferences item"
            ),
            ...preferenceErrorResponses(400, 401, 403, 404, 409, 500)
          }
        },
        delete: {
          summary: "Delete a Preferences item",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", minLength: 1 }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["item"],
                properties: {
                  item: { $ref: "#/components/schemas/PreferenceItem" }
                }
              },
              "Deleted Preferences item"
            ),
            ...preferenceErrorResponses(401, 403, 404, 500)
          }
        }
      },
      "/api/v1/preferences/items/from-entity": {
        post: {
          summary:
            "Create or queue a Preferences item from an existing Forge entity",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PreferenceEntityEnqueueInput"
                }
              }
            }
          },
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["item"],
                properties: {
                  item: { $ref: "#/components/schemas/PreferenceItem" }
                }
              },
              "Queued entity-backed Preferences item"
            ),
            ...preferenceErrorResponses(400, 401, 403, 404, 500)
          }
        }
      },
      "/api/v1/preferences/judgments": {
        post: {
          summary: "Submit a pairwise Preferences judgment",
          description:
            "Judgment, activity, projection refresh, and an optional retry receipt commit atomically. Reuse the same Idempotency-Key only for an identical retry.",
          parameters: [
            {
              in: "header",
              name: "Idempotency-Key",
              required: false,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PreferenceJudgmentInput" }
              }
            }
          },
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["judgment"],
                properties: {
                  judgment: {
                    $ref: "#/components/schemas/PairwisePreferenceJudgment"
                  }
                }
              },
              "Created pairwise judgment"
            ),
            ...preferenceErrorResponses(400, 401, 403, 404, 409, 500)
          }
        }
      },
      "/api/v1/preferences/signals": {
        post: {
          summary: "Submit an absolute Preferences signal",
          description:
            "Records or replaces the effective direct mark for one item in one context and returns the recomputed score. Use one stable Idempotency-Key for an exact transport retry. The receipt binds the owner, domain, context, item, signal type, and strength; changed-payload key reuse returns 409 and an exact replay never replaces newer preference intent. neutral is a removal tombstone: it preserves prior signal history but contributes no direct weight, evidence count, or confidence.",
          parameters: [
            {
              in: "header",
              name: "Idempotency-Key",
              required: false,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PreferenceSignalInput" }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["signal", "score"],
                properties: {
                  signal: {
                    $ref: "#/components/schemas/AbsolutePreferenceSignal"
                  },
                  score: {
                    $ref: "#/components/schemas/PreferenceItemScore"
                  }
                }
              },
              "Exact idempotent replay with the current recomputed item score"
            ),
            "201": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["signal", "score"],
                properties: {
                  signal: {
                    $ref: "#/components/schemas/AbsolutePreferenceSignal"
                  },
                  score: {
                    $ref: "#/components/schemas/PreferenceItemScore"
                  }
                }
              },
              "Created absolute signal and recomputed item score"
            ),
            ...preferenceErrorResponses(400, 401, 403, 404, 409, 500)
          }
        }
      },
      "/api/v1/preferences/items/{id}/score": {
        patch: {
          summary:
            "Patch manual score state for a Preferences item and return the refreshed workspace",
          description:
            "Omitted override fields are unchanged. Explicit null clears manualStatus, manualScore, or confidenceLock.",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", minLength: 1 }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PreferenceScorePatchInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["workspace"],
                properties: {
                  workspace: {
                    $ref: "#/components/schemas/PreferenceWorkspace"
                  }
                }
              },
              "Refreshed Preferences workspace"
            ),
            ...preferenceErrorResponses(400, 401, 403, 404, 500)
          }
        }
      },
      "/api/v1/psyche/questionnaires": {
        get: {
          summary:
            "List questionnaire instruments available in the Psyche library",
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
          summary:
            "Get one questionnaire instrument with version and history detail",
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
          summary:
            "Update one questionnaire instrument through the direct route using its exact draft revision",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/QuestionnaireInstrumentUpdateInput"
                }
              }
            }
          },
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
          summary:
            "Archive one questionnaire instrument through the direct route",
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
          summary:
            "Clone a questionnaire instrument into a new draftable custom copy",
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
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/QuestionnaireDraftUpdateInput"
                }
              }
            }
          },
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
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/QuestionnaireDraftPublishInput"
                }
              }
            }
          },
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
          summary:
            "Start a questionnaire run for one user and instrument version",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/QuestionnaireRunStartInput"
                }
              }
            }
          },
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: [
                  "run",
                  "instrument",
                  "version",
                  "answers",
                  "scores",
                  "history"
                ],
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
          summary:
            "Get one questionnaire run with answers, scores, and version detail",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: [
                  "run",
                  "instrument",
                  "version",
                  "answers",
                  "scores",
                  "history"
                ],
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
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/QuestionnaireRunUpdateInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: [
                  "run",
                  "instrument",
                  "version",
                  "answers",
                  "scores",
                  "history"
                ],
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
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: [
                  "run",
                  "instrument",
                  "version",
                  "answers",
                  "scores",
                  "history"
                ],
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
          summary:
            "Read self-observation notes arranged as a calendar-ready reflection surface",
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
          description:
            "Returns only Notes visible through the caller's effective user, Wiki-space, and Psyche read scope.",
          security: [{ operatorSession: [] }, { bearerAuth: [] }],
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
            ),
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/knowledge-graph": {
        get: {
          summary: "Read the authorized Forge knowledge graph",
          description:
            "Builds the graph from the caller's effective user scope. Note, Wiki, and Psyche nodes use the same owner, Wiki-space, and Psyche visibility contract as their direct read routes.",
          security: [{ operatorSession: [] }, { bearerAuth: [] }],
          parameters: [
            repeatedStringQueryParameter("userIds"),
            repeatedStringQueryParameter("entityKind"),
            repeatedStringQueryParameter("relationKind"),
            repeatedStringQueryParameter("tag"),
            repeatedStringQueryParameter("owner"),
            stringQueryParameter("q"),
            stringQueryParameter("updatedFrom"),
            stringQueryParameter("updatedTo"),
            stringQueryParameter("focusNodeId"),
            integerQueryParameter("limit", 1, 2000)
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["graph"],
                properties: {
                  graph: { type: "object", additionalProperties: true }
                }
              },
              "Authorized knowledge graph"
            ),
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/knowledge-graph/focus": {
        get: {
          summary: "Read one authorized knowledge-graph neighborhood",
          description:
            "Returns a focused neighborhood only after applying the same user, Wiki-space, and Psyche visibility contract as the full graph.",
          security: [{ operatorSession: [] }, { bearerAuth: [] }],
          parameters: [
            {
              name: "entityType",
              in: "query",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "entityId",
              in: "query",
              required: true,
              schema: { type: "string" }
            },
            repeatedStringQueryParameter("userIds")
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["focus"],
                properties: {
                  focus: { type: "object", additionalProperties: true }
                }
              },
              "Authorized focused graph neighborhood"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" }
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
      "/api/v1/psyche/metrics": {
        get: {
          summary:
            "Get owner-scoped Psyche metrics with provenance and data-quality context",
          parameters: [
            {
              name: "userIds",
              in: "query",
              schema: { type: "array", items: { type: "string" } },
              style: "form",
              explode: true,
              description:
                "Optional repeated owner scope. Trigger-report evidence is limited to the effective authorized users. Conversation-scanner evidence is excluded from scoped responses because it has no canonical owner attribution."
            },
            {
              name: "timeZone",
              in: "query",
              schema: { type: "string", minLength: 1, maxLength: 100 },
              description:
                "IANA timezone used to assign dated trigger-report observations to local days."
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["metrics"],
                properties: {
                  metrics: {
                    $ref: "#/components/schemas/PsycheMetricsViewData"
                  }
                }
              },
              "Psyche metrics view"
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
          description:
            "Requires psyche.read for an agent token when Psyche authentication is enabled. Returns immutable built-in labels plus custom labels inside the effective owner scope. Agents should normally search event_type through the shared batch route POST /api/v1/entities/search, which additionally requires base read or write; this dedicated route powers the Psyche report vocabulary UI.",
          parameters: [
            {
              name: "userId",
              in: "query",
              schema: { type: "string", maxLength: 160 }
            },
            {
              name: "userIds",
              in: "query",
              style: "form",
              explode: true,
              schema: {
                type: "array",
                items: { type: "string", maxLength: 160 }
              }
            }
          ],
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
            "403": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a custom Psyche event type",
          description:
            "Requires psyche.write for an agent token when Psyche authentication is enabled. Creates one owner-scoped reusable label. Built-ins remain read-only. Labels are compared after Unicode NFKC default case folding plus punctuation and whitespace normalization. Duplicate active labels return 409 psyche_vocabulary_duplicate; matching labels in the bin return 409 psyche_vocabulary_label_in_bin. Reuse Idempotency-Key only for an identical retry: changed payload reuse returns 409 idempotency_conflict, a soft-deleted target returns 409 psyche_vocabulary_idempotency_target_in_bin, and a hard-deleted target returns terminal 409 psyche_vocabulary_idempotency_target_deleted without recreation. Agents should normally use POST /api/v1/entities/create with entityType event_type, which additionally requires base write.",
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: false,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/EventTypeCreateInput" }
              }
            }
          },
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
            "400": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/event-types/{id}": {
        get: {
          summary: "Get a Psyche event type",
          description:
            "Requires psyche.read for an agent token when Psyche authentication is enabled. Returns an immutable built-in or an owner-visible custom label. A custom label outside the effective user scope is returned as 404.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "userIds",
              in: "query",
              style: "form",
              explode: true,
              schema: { type: "array", items: { type: "string" } }
            }
          ],
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
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a custom Psyche event type",
          description:
            "Requires psyche.write for an agent token when Psyche authentication is enabled. Updates an owner-visible custom label. Built-ins return 409 system_vocabulary_immutable. Existing trigger reports retain their own stored event wording when a reusable label changes.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/EventTypePatchInput" }
              }
            }
          },
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
            "400": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a custom Psyche event type",
          description:
            "Requires psyche.write for an agent token when Psyche authentication is enabled. Soft-deletes by default so the custom label can be restored. Hard deletion removes the reusable record and permanently consumes any create idempotency key; a delayed identical retry returns 409 psyche_vocabulary_idempotency_target_deleted instead of recreating it. Trigger reports retain the user's stored event wording. Built-ins cannot be deleted and return 409 system_vocabulary_immutable.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "mode",
              in: "query",
              schema: {
                type: "string",
                enum: ["soft", "hard"],
                default: "soft"
              }
            },
            {
              name: "reason",
              in: "query",
              schema: { type: "string" }
            }
          ],
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
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/emotions": {
        get: {
          summary: "List seeded and custom Psyche emotions",
          description:
            "Requires psyche.read for an agent token when Psyche authentication is enabled. Returns immutable built-in emotion labels plus custom labels inside the effective owner scope. Reports still accept the user's own emotion words. Agents should normally search emotion_definition through the shared batch route POST /api/v1/entities/search, which additionally requires base read or write; this dedicated route powers the Psyche report vocabulary UI.",
          parameters: [
            {
              name: "userId",
              in: "query",
              schema: { type: "string", maxLength: 160 }
            },
            {
              name: "userIds",
              in: "query",
              style: "form",
              explode: true,
              schema: {
                type: "array",
                items: { type: "string", maxLength: 160 }
              }
            }
          ],
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
            "403": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a custom Psyche emotion",
          description:
            "Requires psyche.write for an agent token when Psyche authentication is enabled. Creates one owner-scoped reusable emotion label. Built-ins remain read-only. Labels are compared after Unicode NFKC default case folding plus punctuation and whitespace normalization. Duplicate active labels return 409 psyche_vocabulary_duplicate; matching labels in the bin return 409 psyche_vocabulary_label_in_bin. Reuse Idempotency-Key only for an identical retry: changed payload reuse returns 409 idempotency_conflict, a soft-deleted target returns 409 psyche_vocabulary_idempotency_target_in_bin, and a hard-deleted target returns terminal 409 psyche_vocabulary_idempotency_target_deleted without recreation. Agents should normally use POST /api/v1/entities/create with entityType emotion_definition, which additionally requires base write.",
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: false,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/EmotionDefinitionCreateInput"
                }
              }
            }
          },
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
            "400": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/emotions/{id}": {
        get: {
          summary: "Get a Psyche emotion definition",
          description:
            "Requires psyche.read for an agent token when Psyche authentication is enabled. Returns an immutable built-in or an owner-visible custom emotion definition. A custom label outside the effective user scope is returned as 404.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "userIds",
              in: "query",
              style: "form",
              explode: true,
              schema: { type: "array", items: { type: "string" } }
            }
          ],
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
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a custom Psyche emotion definition",
          description:
            "Requires psyche.write for an agent token when Psyche authentication is enabled. Updates an owner-visible custom emotion definition. Built-ins return 409 system_vocabulary_immutable. Trigger reports preserve each stored raw emotion label when a reusable definition changes.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/EmotionDefinitionPatchInput"
                }
              }
            }
          },
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
            "400": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a custom Psyche emotion definition",
          description:
            "Requires psyche.write for an agent token when Psyche authentication is enabled. Soft-deletes by default so the custom definition can be restored. Hard deletion clears reusable definition references and permanently consumes any create idempotency key; a delayed identical retry returns 409 psyche_vocabulary_idempotency_target_deleted instead of recreating it. Reports retain every stored raw emotion word. Built-ins cannot be deleted and return 409 system_vocabulary_immutable.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "mode",
              in: "query",
              schema: {
                type: "string",
                enum: ["soft", "hard"],
                default: "soft"
              }
            },
            {
              name: "reason",
              in: "query",
              schema: { type: "string" }
            }
          ],
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
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/reports": {
        get: {
          summary: "List trigger reports",
          description:
            "Returns one newest-first, owner-scoped keyset page. Agents normally read trigger_report through shared batch entity tools; this direct route powers the Psyche report view and exposes its exact pagination contract.",
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 100,
                default: 25
              }
            },
            {
              name: "cursor",
              in: "query",
              schema: { type: "string", maxLength: 1024 }
            },
            {
              name: "userId",
              in: "query",
              schema: { type: "string", maxLength: 160 }
            },
            {
              name: "userIds",
              in: "query",
              style: "form",
              explode: true,
              schema: {
                type: "array",
                items: { type: "string", maxLength: 160 }
              }
            }
          ],
          responses: {
            "200": jsonResponse(
              { $ref: "#/components/schemas/TriggerReportPage" },
              "Trigger report collection"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a trigger report",
          description:
            "Creates one owner-scoped report atomically with canonical general entity links. Reuse an Idempotency-Key only for an identical retry; a changed payload returns 409. A tentative hypothesis is accepted only after explicit interpretationConsent.",
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: false,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/TriggerReportCreateInput"
                }
              }
            }
          },
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
            "400": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/psyche/reports/{id}": {
        get: {
          summary: "Get a trigger report with linked notes and insights",
          description:
            "Returns the report only when it is inside the effective owner scope. Linked Wiki notes are filtered through Wiki ACLs before they are returned.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "userIds",
              in: "query",
              style: "form",
              explode: true,
              schema: { type: "array", items: { type: "string" } }
            }
          ],
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
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a trigger report",
          description:
            "Applies a revision-checked owner-scoped update and refreshes canonical general entity links in the same transaction. A stale expectedRevision returns 409.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/TriggerReportPatchInput"
                }
              }
            }
          },
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
            "400": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a trigger report",
          description:
            "Soft-deletes one report inside the effective owner scope. The general entity lifecycle routes remain the canonical batch path for agent-managed records.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
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
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/notes": {
        get: {
          summary: "Search and page accessible notes",
          description:
            "Returns newest-first keyset pages. linkedTo and textTerms use OR semantics within their own groups; tags use exact case-insensitive AND semantics. query tokenizes one full-text expression. Ownership, Wiki-space access, deleted/expired state, and Psyche scope are applied before total and pagination. Linked records that are no longer accessible are omitted from every Note and counted only in unavailableLinkCount. Filtering on an inaccessible linked target returns an empty page rather than revealing a relationship.",
          parameters: [
            {
              name: "kind",
              in: "query",
              schema: { $ref: "#/components/schemas/NoteKind" }
            },
            {
              name: "spaceId",
              in: "query",
              schema: { type: "string", maxLength: 128 }
            },
            {
              name: "slug",
              in: "query",
              schema: { type: "string", maxLength: 240 }
            },
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
              name: "includeAnchorless",
              in: "query",
              description:
                "When true with anchorKey, includes notes linked to the same entity without an anchor as well as notes on the requested anchor.",
              schema: { type: "boolean", default: false }
            },
            {
              name: "linkedTo",
              in: "query",
              description:
                "Repeat up to 24 entityType:entityId values. A note matching any supplied link is included.",
              style: "form",
              explode: true,
              schema: {
                type: "array",
                maxItems: 24,
                items: { type: "string", maxLength: 512 }
              }
            },
            {
              name: "tags",
              in: "query",
              description:
                "Repeat up to 24 exact tags. A note must contain every supplied tag.",
              style: "form",
              explode: true,
              schema: {
                type: "array",
                maxItems: 24,
                items: { type: "string", maxLength: 80 }
              }
            },
            {
              name: "textTerms",
              in: "query",
              description:
                "Repeat up to 12 alternatives with at most 12 searchable tokens each. A note matches when every token in any one term is found across body, author, title, summary, or tags.",
              style: "form",
              explode: true,
              schema: {
                type: "array",
                maxItems: 12,
                items: { type: "string", maxLength: 160 }
              }
            },
            {
              name: "query",
              in: "query",
              description:
                "One full-text expression with at most 16 searchable tokens; every token must match.",
              schema: { type: "string", maxLength: 512 }
            },
            {
              name: "author",
              in: "query",
              schema: { type: "string", maxLength: 160 }
            },
            {
              name: "userIds",
              in: "query",
              style: "form",
              explode: true,
              schema: {
                type: "array",
                maxItems: 32,
                items: { type: "string", maxLength: 128 }
              }
            },
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
              name: "observedFrom",
              in: "query",
              description:
                "Inclusive lower date bound using frontmatter.observedAt, falling back to createdAt.",
              schema: { type: "string", format: "date" }
            },
            {
              name: "observedTo",
              in: "query",
              description:
                "Inclusive upper date bound using frontmatter.observedAt, falling back to createdAt.",
              schema: { type: "string", format: "date" }
            },
            {
              name: "limit",
              in: "query",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 100,
                default: 40
              }
            },
            {
              name: "cursor",
              in: "query",
              description:
                "Opaque nextCursor from the preceding response. Cursors are stable over createdAt and id ordering.",
              schema: { type: "string", maxLength: 1024 }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["notes", "total", "limit", "nextCursor", "hasMore"],
                properties: {
                  notes: arrayOf({ $ref: "#/components/schemas/Note" }),
                  total: { type: "integer", minimum: 0 },
                  limit: { type: "integer", minimum: 1, maximum: 100 },
                  nextCursor: nullable({ type: "string" }),
                  hasMore: { type: "boolean" }
                }
              },
              "Bounded note page"
            ),
            "400": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a note linked to one or more Forge entities",
          description:
            "When createContext is present, Forge validates one exact live source link inside the same transaction that creates the note. Missing, deleted, unauthorized, duplicated, or mismatched source records do not create a note.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/NoteCreateInput" }
              }
            }
          },
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["note"],
                properties: { note: { $ref: "#/components/schemas/Note" } }
              },
              "Created note"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/notes/{id}": {
        get: {
          summary: "Get a note",
          description:
            "Returns only live linked records accessible under the caller's capabilities and scope. unavailableLinkCount reports how many stored links were omitted without exposing their identifiers or the reason.",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", minLength: 1 }
            }
          ],
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
          description:
            "Use expectedRevisionHash from the last read to prevent a stale editor from overwriting a newer revision. A replacement links list cannot silently delete stored links that were omitted from the caller's read projection.",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", minLength: 1 }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/NotePatchInput" }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["note"],
                properties: { note: { $ref: "#/components/schemas/Note" } }
              },
              "Updated note"
            ),
            "409": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Soft-delete or permanently delete a note",
          description:
            "The default soft delete moves the note to the Forge bin and preserves its snapshot for the shared entity restore route.",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", minLength: 1 }
            },
            {
              in: "query",
              name: "mode",
              schema: {
                type: "string",
                enum: ["soft", "hard"],
                default: "soft"
              }
            }
          ],
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
      "/api/v1/strategies": {
        get: {
          summary: "List strategies",
          parameters: [
            {
              name: "status",
              in: "query",
              schema: {
                type: "string",
                enum: ["active", "paused", "completed"]
              }
            },
            {
              name: "userIds",
              in: "query",
              schema: { type: "array", items: { type: "string" } }
            },
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
                required: ["strategies"],
                properties: {
                  strategies: arrayOf({ $ref: "#/components/schemas/Strategy" })
                }
              },
              "Strategy collection"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a strategy",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["strategy"],
                properties: {
                  strategy: { $ref: "#/components/schemas/Strategy" }
                }
              },
              "Created strategy"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/strategies/{id}": {
        get: {
          summary: "Get a strategy",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["strategy"],
                properties: {
                  strategy: { $ref: "#/components/schemas/Strategy" }
                }
              },
              "Strategy"
            ),
            "404": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update a strategy",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["strategy"],
                properties: {
                  strategy: { $ref: "#/components/schemas/Strategy" }
                }
              },
              "Updated strategy"
            ),
            "404": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a strategy",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["strategy"],
                properties: {
                  strategy: { $ref: "#/components/schemas/Strategy" }
                }
              },
              "Deleted strategy"
            ),
            "404": { $ref: "#/components/responses/Error" },
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
      "/api/v1/calendar/macos-local/discovery": {
        get: {
          summary:
            "Discover calendars already configured on this Mac through EventKit",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["discovery"],
                properties: {
                  discovery: {
                    $ref: "#/components/schemas/MacOSLocalCalendarDiscoveryPayload"
                  }
                }
              },
              "macOS local calendar discovery"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/calendar/discovery": {
        post: {
          summary:
            "Discover Apple or custom CalDAV calendars before creating a connection",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/CalendarDiscoveryInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["discovery"],
                properties: {
                  discovery: {
                    $ref: "#/components/schemas/CalendarDiscoveryPayload"
                  }
                }
              },
              "Calendar discovery"
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
                        enum: CALENDAR_PROVIDER_VALUES
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
            "Create a Google, Apple, Exchange Online, local Mac, or custom CalDAV calendar connection",
          description:
            "Forge first discovers the writable calendars for the account, then stores the chosen mirrored calendars and either reuses the existing shared Forge write target or saves a new one when needed.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/CalendarConnectionMutationInput"
                }
              }
            }
          },
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
      "/api/v1/calendar/connections/{id}": {
        patch: {
          summary:
            "Update one calendar connection label or selected mirrored calendars",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/CalendarConnectionPatchInput"
                }
              }
            }
          },
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
              "Updated calendar connection"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete one calendar connection and stop mirroring it",
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
              "Deleted calendar connection"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/calendar/connections/{id}/discovery": {
        get: {
          summary:
            "Rediscover available calendars for an existing calendar connection",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["discovery"],
                properties: {
                  discovery: {
                    $ref: "#/components/schemas/CalendarDiscoveryPayload"
                  }
                }
              },
              "Calendar connection discovery"
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
          description:
            "Creates one compact local-time recurrence rule. An end minute earlier than the start minute continues overnight; equal start and end minutes are invalid.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/WorkBlockTemplateCreateInput"
                }
              }
            }
          },
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
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
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
        },
        patch: {
          summary: "Update one recurring work-block template",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/WorkBlockTemplatePatchInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["template"],
                properties: {
                  template: { $ref: "#/components/schemas/WorkBlockTemplate" }
                }
              },
              "Updated work-block template"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete one recurring work-block template immediately",
          description:
            "Removes the template and its future derived instances. Work-block templates do not enter the settings bin and cannot be restored.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["template"],
                properties: {
                  template: { $ref: "#/components/schemas/WorkBlockTemplate" }
                }
              },
              "Deleted work-block template"
            ),
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/calendar/timeboxes": {
        get: {
          summary: "List a bounded, owner-scoped task-timebox range",
          parameters: [
            {
              name: "from",
              in: "query",
              required: false,
              schema: { type: "string" },
              description:
                "Inclusive ISO instant or YYYY-MM-DD range start. Defaults to seven days before now."
            },
            {
              name: "to",
              in: "query",
              required: false,
              schema: { type: "string" },
              description:
                "Exclusive ISO instant or YYYY-MM-DD range end. Defaults to 21 days after now; a range may span at most 732 days."
            },
            {
              name: "userIds",
              in: "query",
              required: false,
              schema: arrayOf({ type: "string" }),
              style: "form",
              explode: true,
              description:
                "Optional repeated user scope, intersected with the authenticated token's allowed users."
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["timeboxes"],
                properties: {
                  timeboxes: {
                    type: "array",
                    maxItems: 5000,
                    items: { $ref: "#/components/schemas/TaskTimebox" }
                  }
                }
              },
              "Task timeboxes"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Create a planned task timebox",
          description:
            "The task must exist in the caller's user scope. Project and owner must match the task. Calendar pressure or scheduling-rule conflicts require a specific overrideReason.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaskTimeboxCreateInput" }
              }
            }
          },
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
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/calendar/timeboxes/{id}": {
        get: {
          summary: "Get one owner-scoped task timebox",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
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
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" }
          }
        },
        patch: {
          summary: "Update one owner-scoped task timebox",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaskTimeboxPatchInput" }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["timebox"],
                properties: {
                  timebox: { $ref: "#/components/schemas/TaskTimebox" }
                }
              },
              "Updated task timebox"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete one owner-scoped task timebox",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["timebox", "projection"],
                properties: {
                  timebox: { $ref: "#/components/schemas/TaskTimebox" },
                  projection: {
                    $ref: "#/components/schemas/CalendarProjectionResult"
                  }
                }
              },
              "Task timebox deletion request and provider outcome"
            ),
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/calendar/timeboxes/recommend": {
        post: {
          summary: "Suggest bounded, conflict-free future timeboxes for a task",
          description:
            "Recommendations require read access to the task and consider provider events, work blocks, existing timeboxes, owner scope, scheduling rules, planned duration, and the requested IANA timezone. The search range is capped at 31 days and the result at 12 suggestions.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/TaskTimeboxRecommendationInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["timeboxes"],
                properties: {
                  timeboxes: {
                    type: "array",
                    maxItems: 12,
                    items: { $ref: "#/components/schemas/TaskTimebox" }
                  }
                }
              },
              "Suggested task timeboxes"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" }
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
            "Forge stores the event canonically first, then projects it to a connected writable calendar when selected. Provider failures do not discard the local record; inspect projection for the exact outcome.",
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                required: ["event", "projection"],
                properties: {
                  event: { $ref: "#/components/schemas/CalendarEvent" },
                  projection: {
                    $ref: "#/components/schemas/CalendarProjectionResult"
                  }
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
          description:
            "Mirrored provider events are read-only. Recurring provider records require an explicit recurrenceEditScope; whole-series edits from an expanded occurrence are rejected. Forge-owned event changes return a projection outcome so provider conflicts and outages are not reported as lost local saves.",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["event", "projection"],
                properties: {
                  event: { $ref: "#/components/schemas/CalendarEvent" },
                  projection: {
                    $ref: "#/components/schemas/CalendarProjectionResult"
                  }
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
          parameters: [
            {
              in: "query",
              name: "timezone",
              required: false,
              schema: { type: "string" },
              description:
                "Current IANA device timezone for habits that follow travel."
            }
          ],
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
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HabitCheckInInput" }
              }
            }
          },
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
          description:
            "When a token is supplied, results are intersected with its user, project, and tag scope.",
          security: [{ operatorSession: [] }, { bearerAuth: [] }, {}],
          parameters: [
            {
              name: "status",
              in: "query",
              schema: {
                type: "string",
                enum: ["backlog", "focus", "in_progress", "blocked", "done"]
              }
            },
            {
              name: "levels",
              in: "query",
              schema: {
                type: "array",
                items: { type: "string", enum: ["issue", "task", "subtask"] }
              },
              style: "form",
              explode: false
            },
            { name: "owner", in: "query", schema: { type: "string" } },
            { name: "goalId", in: "query", schema: { type: "string" } },
            { name: "projectId", in: "query", schema: { type: "string" } },
            {
              name: "parentWorkItemId",
              in: "query",
              schema: { type: "string" }
            },
            { name: "tagId", in: "query", schema: { type: "string" } },
            {
              name: "due",
              in: "query",
              schema: { type: "string", enum: ["overdue", "today", "week"] }
            },
            {
              name: "userIds",
              in: "query",
              schema: { type: "array", items: { type: "string" } },
              style: "form",
              explode: true
            },
            {
              name: "assigneeIds",
              in: "query",
              schema: { type: "array", items: { type: "string" } },
              style: "form",
              explode: true
            },
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
          description:
            "The created task must remain within the token's user, project, and tag scope. Forbidden task targets return 403 and are rolled back. Every structured link in an attached Note must point to a live record accessible to the caller; missing, deleted, and inaccessible linked records return the same generic 404 before any task, Note, Git, or activity write.",
          security: [{ operatorSession: [] }, { bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaskCreateInput" }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["task"],
                properties: {
                  task: { $ref: "#/components/schemas/Task" }
                }
              },
              "Exact idempotent replay of a previously created task"
            ),
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
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/operator/log-work": {
        post: {
          summary:
            "Log work that already happened by creating or updating a task and returning fresh XP state",
          description:
            "Atomically stores bounded completionReport, Git refs, and an optional closeout note. Summary text is not fabricated into completion evidence. Every structured closeout link must point to a live record accessible to the caller; missing, deleted, and inaccessible targets return the same generic 404 before any write.",
          security: [{ operatorSession: [] }, { bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OperatorLogWorkInput" }
              }
            }
          },
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
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/work-adjustments": {
        post: {
          summary:
            "Add or remove tracked work minutes on an existing task or project and return fresh XP state",
          description:
            "Use one stable Idempotency-Key for an exact transport retry. The first accepted request atomically stores the adjustment, reward, Activity event, and response. An exact replay returns that response without applying time or XP twice; reuse with a different payload returns 409.",
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: false,
              schema: { type: "string", minLength: 1, maxLength: 128 },
              description:
                "Stable key for one intended correction. Keep it unchanged only while retrying the same entity, signed minutes, and note."
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WorkAdjustmentInput" }
              }
            }
          },
          responses: {
            "200": {
              ...jsonResponse(
                { $ref: "#/components/schemas/WorkAdjustmentResult" },
                "Exact idempotent replay of a stored work adjustment response"
              ),
              headers: {
                "Idempotency-Replayed": {
                  schema: { type: "string", enum: ["true"] }
                }
              }
            },
            "201": jsonResponse(
              { $ref: "#/components/schemas/WorkAdjustmentResult" },
              "Created work adjustment and refreshed XP state"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/offline-mutations/task-status": {
        post: {
          summary: "Set a queued offline task status",
          description:
            "Operator-session only. Forge binds each stable idempotency key to the authenticated browser session and the canonical request fingerprint. Exact retries return the stored terminal receipt while it remains within the 30-day, newest-500-results-per-session retention window. After eviction, the expected task revision still prevents a silent overwrite, but the original terminal receipt is no longer guaranteed. A stale task revision returns a conflicted receipt without changing the task, a completed task remains online-only, and an unavailable task returns a rejected receipt without revealing whether it was deleted or never existed. Reusing a key for a changed request returns 409.",
          security: [{ operatorSession: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/OfflineTaskMutationInput"
                }
              }
            }
          },
          responses: {
            "200": {
              ...jsonResponse(
                { $ref: "#/components/schemas/OfflineTaskMutationResponse" },
                "Stored terminal result for the queued task-status edit"
              ),
              headers: {
                "Idempotency-Replayed": {
                  schema: { type: "string", enum: ["true", "false"] }
                }
              }
            },
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/tasks/{id}": {
        get: {
          summary: "Get a task",
          description:
            "An existing task outside token scope is reported as not found.",
          security: [{ operatorSession: [] }, { bearerAuth: [] }, {}],
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
          description:
            "The current task must be in scope; moving the resulting task outside token user, project, or tag scope returns 403 and rolls back. Every structured link in an attached Note must point to a live record accessible to the caller; missing, deleted, and inaccessible linked records return the same generic 404 before mutation. A changed task returns a ten-minute mutation receipt whose Undo is concurrency checked.",
          security: [{ operatorSession: [] }, { bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaskPatchInput" }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["task", "mutationReceipt"],
                properties: {
                  task: { $ref: "#/components/schemas/Task" },
                  mutationReceipt: nullable({
                    $ref: "#/components/schemas/MutationReceipt"
                  })
                }
              },
              "Updated task"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" }
          }
        },
        delete: {
          summary: "Delete a task",
          description:
            "Soft delete is the default and returns a ten-minute Undo receipt. mode=hard returns a terminal receipt that explains why the permanent deletion cannot be undone.",
          security: [{ operatorSession: [] }, { bearerAuth: [] }],
          parameters: [
            {
              name: "mode",
              in: "query",
              schema: {
                type: "string",
                enum: ["soft", "hard"],
                default: "soft"
              }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["task", "mutationReceipt"],
                properties: {
                  task: { $ref: "#/components/schemas/Task" },
                  mutationReceipt: {
                    $ref: "#/components/schemas/MutationReceipt"
                  }
                }
              },
              "Deleted task"
            ),
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/tasks/{id}/context": {
        get: {
          summary:
            "Get task detail context including project, goal, runs, and evidence",
          security: [{ operatorSession: [] }, { bearerAuth: [] }],
          responses: {
            "200": jsonResponse(
              { $ref: "#/components/schemas/TaskContextPayload" },
              "Task detail payload"
            ),
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/tasks/{id}/runs": {
        post: {
          summary: "Start or renew a live task timer for a task",
          security: [{ operatorSession: [] }, { bearerAuth: [] }],
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
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/tasks/{id}/uncomplete": {
        post: {
          summary: "Reopen a completed task and remove its completion XP",
          security: [{ operatorSession: [] }, { bearerAuth: [] }],
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
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/task-runs": {
        get: {
          summary:
            "List task timers with optional task and active-state filters",
          description:
            "When a token is supplied, runs are filtered through the owning task's user, project, and tag scope.",
          security: [{ operatorSession: [] }, { bearerAuth: [] }, {}],
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
              name: "userIds",
              in: "query",
              schema: { type: "array", items: { type: "string" } },
              style: "form",
              explode: true
            },
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
          security: [{ operatorSession: [] }, { bearerAuth: [] }],
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
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/task-runs/{id}/focus": {
        post: {
          summary: "Mark one live task timer as the current primary timer",
          security: [{ operatorSession: [] }, { bearerAuth: [] }],
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
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/task-runs/{id}/complete": {
        post: {
          summary: "Complete a live task timer and complete the task",
          description:
            "Atomically stores completionReport, Git refs, closeout note, task completion, timer transition, timebox, rewards, and activity. Exact terminal replays are resolved before present-day linked-record validation and continue to succeed if a formerly valid target later becomes unavailable. Changed closeout evidence returns 409 task_run_closeout_conflict. A new transition with a missing, deleted, or inaccessible linked target returns the same generic 404 before any write.",
          security: [{ operatorSession: [] }, { bearerAuth: [] }],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaskRunCompleteInput" }
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
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            "409": {
              $ref: "#/components/responses/Error",
              description:
                "Run is not active, actor differs, or closeout fingerprint conflicts (task_run_closeout_conflict)."
            },
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/task-runs/{id}/release": {
        post: {
          summary:
            "Pause or release a live task timer without completing the task",
          description:
            "Release accepts only a handoff note; it does not write completionReport or Git refs and does not complete the task. Exact terminal replays are resolved before present-day linked-record validation; changed evidence returns 409 task_run_handoff_conflict. A new transition with a missing, deleted, or inaccessible linked target returns the same generic 404 before any write.",
          security: [{ operatorSession: [] }, { bearerAuth: [] }],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaskRunReleaseInput" }
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
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/git-helper/overview": {
        get: {
          summary:
            "Get bounded Git references for the configured Forge repository",
          description:
            "Operator-session only. The response intentionally omits the absolute repository root.",
          security: [{ operatorSession: [] }],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["git"],
                properties: {
                  git: { $ref: "#/components/schemas/GitHelperOverview" }
                }
              },
              "Configured repository Git overview"
            ),
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/git-helper/search": {
        get: {
          summary: "Search bounded Git references",
          description:
            "Operator-session only. Branch and commit searches are restricted to the configured repository. Pull-request lookup accepts only canonical owner/repo.",
          security: [{ operatorSession: [] }],
          parameters: [
            {
              name: "kind",
              in: "query",
              required: true,
              schema: {
                type: "string",
                enum: ["branch", "commit", "pull_request"]
              }
            },
            {
              name: "query",
              in: "query",
              schema: {
                type: "string",
                maxLength: TASK_CLOSEOUT_LIMITS.gitHelperQueryLength,
                default: ""
              }
            },
            {
              name: "repository",
              in: "query",
              schema: {
                type: "string",
                maxLength: TASK_CLOSEOUT_LIMITS.gitHelperRepositoryLength,
                pattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$"
              }
            },
            {
              name: "limit",
              in: "query",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: TASK_CLOSEOUT_LIMITS.gitHelperResults,
                default: 12
              }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["git"],
                properties: {
                  git: { $ref: "#/components/schemas/GitHelperSearchResponse" }
                }
              },
              "Bounded Git reference search result"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/task-runs/watchdog": {
        get: {
          tags: ["Task Runs"],
          summary: "Read task-run watchdog status",
          security: [{ operatorSession: [] }],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["watchdog"],
                properties: {
                  watchdog: nullable({
                    type: "object",
                    additionalProperties: true
                  })
                }
              },
              "Watchdog status"
            ),
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/task-runs/watchdog/reconcile": {
        post: {
          tags: ["Task Runs"],
          summary: "Reconcile task-run watchdog state immediately",
          security: [{ operatorSession: [] }],
          responses: {
            "200": jsonResponse(
              { type: "object", additionalProperties: true },
              "Watchdog reconciliation result"
            ),
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/task-runs/recover": {
        post: {
          tags: ["Task Runs"],
          summary: "Recover expired task runs",
          security: [{ operatorSession: [] }],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    limit: { type: "integer", minimum: 1, maximum: 100 }
                  }
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["timedOutRuns"],
                properties: {
                  timedOutRuns: arrayOf({
                    $ref: "#/components/schemas/TaskRun"
                  })
                }
              },
              "Recovered expired task runs"
            ),
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/activity": {
        get: {
          summary: "List visible activity events",
          description:
            "Filters Note-linked events through the caller's effective user, Wiki-space, and Psyche read scope before returning metadata.",
          security: [{ operatorSession: [] }, { bearerAuth: [] }],
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
            ),
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/events/stream": {
        get: {
          summary: "Stream authorized Forge activity changes",
          description:
            "The initial cursor and every activity event are selected only after applying the caller's effective user, Wiki-space, and Psyche Note visibility scope.",
          security: [{ operatorSession: [] }, { bearerAuth: [] }],
          responses: {
            "200": {
              description: "Authorized server-sent event stream",
              content: {
                "text/event-stream": {
                  schema: { type: "string" }
                }
              }
            },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" }
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
          description:
            "Authenticated, read-only gamification summary. Token callers can read only the intersection of requested users and their configured user scope.",
          parameters: [
            {
              name: "userIds",
              in: "query",
              required: false,
              schema: arrayOf({ type: "string" }),
              style: "form",
              explode: true,
              description:
                "Selected Forge user IDs. Token callers are restricted to their allowed user scope."
            },
            {
              name: "timezone",
              in: "query",
              required: false,
              schema: { type: "string" },
              description:
                "Valid IANA timezone used for local-day progress calculations."
            }
          ],
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
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/metrics/xp": {
        get: {
          summary: "Get explainable XP metrics and reward-ledger state",
          parameters: [
            {
              name: "userIds",
              in: "query",
              required: false,
              schema: arrayOf({ type: "string" }),
              style: "form",
              explode: true,
              description:
                "Selected Forge user IDs. Token callers are restricted to their allowed user scope. Exactly one valid ID returns selected-user progression; an explicit invalid selection returns an empty scope rather than another user's progression."
            },
            {
              name: "timezone",
              in: "query",
              required: false,
              schema: { type: "string" },
              description:
                "Valid IANA timezone used for daily streak and Monday-through-Sunday XP boundaries. Defaults to the configured runtime timezone and then UTC."
            }
          ],
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
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/gamification/catalog": {
        get: {
          summary:
            "Get the source-controlled trophy and cosmetic unlock catalog with selected-user progress",
          description:
            "Authenticated, read-only catalog evaluation. This route never reconciles rewards, creates unlocks, or queues celebrations.",
          parameters: [
            {
              name: "userIds",
              in: "query",
              required: false,
              schema: arrayOf({ type: "string" }),
              style: "form",
              explode: true,
              description:
                "Selected Forge user IDs used to resolve catalog progress and unlock state. Token callers are restricted to their allowed user scope."
            },
            {
              name: "timezone",
              in: "query",
              required: false,
              schema: { type: "string" },
              description:
                "Valid IANA timezone used for local-day progress calculations."
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["catalog"],
                properties: {
                  catalog: {
                    $ref: "#/components/schemas/GamificationCatalogPayload"
                  }
                }
              },
              "Gamification catalog payload"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/gamification/reconcile": {
        post: {
          summary: "Reconcile durable gamification progression",
          description:
            "Authenticated write command that reconciles reward evidence, timezone-specific daily activity, unlocks, and queued celebrations for the effective user scope. Gamification GET routes remain read-only.",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    userIds: arrayOf({ type: "string", minLength: 1 }),
                    timezone: {
                      type: "string",
                      description: "Valid IANA timezone."
                    }
                  }
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["metrics"],
                properties: {
                  metrics: { $ref: "#/components/schemas/XpMetricsPayload" }
                }
              },
              "Reconciled XP metrics"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/gamification/assets": {
        get: {
          summary: "Get validated optional gamification art-pack status",
          description:
            "Requires read authorization. Returns the exact configured release metadata and local validation status for each optional style without installing or changing files.",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["assets"],
                properties: {
                  assets: {
                    type: "object",
                    additionalProperties: false,
                    required: ["version", "defaultStyle", "styles"],
                    properties: {
                      version: { type: "string" },
                      defaultStyle: {
                        type: "string",
                        enum: [
                          "dark-fantasy",
                          "dramatic-smithie",
                          "mind-locksmith"
                        ]
                      },
                      styles: arrayOf({
                        type: "object",
                        additionalProperties: false,
                        required: [
                          "id",
                          "label",
                          "description",
                          "previewUrl",
                          "fileName",
                          "downloadUrl",
                          "sha256",
                          "installed",
                          "spriteCount",
                          "expectedSpriteCount",
                          "installedAt"
                        ],
                        properties: {
                          id: {
                            type: "string",
                            enum: [
                              "dark-fantasy",
                              "dramatic-smithie",
                              "mind-locksmith"
                            ]
                          },
                          label: { type: "string" },
                          description: { type: "string" },
                          previewUrl: { type: "string" },
                          fileName: { type: "string" },
                          downloadUrl: { type: "string" },
                          sha256: {
                            type: "string",
                            pattern: "^[a-f0-9]{64}$"
                          },
                          installed: { type: "boolean" },
                          spriteCount: { type: "integer", minimum: 0 },
                          expectedSpriteCount: {
                            type: "integer",
                            minimum: 1
                          },
                          installedAt: nullable({
                            type: "string",
                            format: "date-time"
                          })
                        }
                      })
                    }
                  }
                }
              },
              "Gamification asset status"
            ),
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/gamification/assets/install": {
        post: {
          summary: "Install one validated optional gamification art pack",
          description:
            "Requires an operator session. Downloads the exact configured archive, verifies its checksum and complete file manifest in staging, then atomically commits the validated style.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["style"],
                  properties: {
                    style: {
                      type: "string",
                      enum: [
                        "dark-fantasy",
                        "dramatic-smithie",
                        "mind-locksmith"
                      ]
                    }
                  }
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["style"],
                properties: {
                  style: {
                    type: "object",
                    additionalProperties: false,
                    required: [
                      "id",
                      "label",
                      "description",
                      "previewUrl",
                      "fileName",
                      "downloadUrl",
                      "sha256",
                      "installed",
                      "spriteCount",
                      "expectedSpriteCount",
                      "installedAt"
                    ],
                    properties: {
                      id: { type: "string" },
                      label: { type: "string" },
                      description: { type: "string" },
                      previewUrl: { type: "string" },
                      fileName: { type: "string" },
                      downloadUrl: { type: "string" },
                      sha256: { type: "string" },
                      installed: { type: "boolean", const: true },
                      spriteCount: { type: "integer", minimum: 1 },
                      expectedSpriteCount: { type: "integer", minimum: 1 },
                      installedAt: { type: "string", format: "date-time" }
                    }
                  }
                }
              },
              "Installed and validated gamification art style"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "502": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/gamification/equipment": {
        get: {
          summary: "Get selected-user equipped gamification cosmetics",
          description:
            "Authenticated, read-only equipment view. Token callers are restricted to their allowed user scope.",
          parameters: [
            {
              name: "userIds",
              in: "query",
              required: false,
              schema: arrayOf({ type: "string" }),
              style: "form",
              explode: true,
              description:
                "Selected Forge user IDs. Token callers are restricted to their allowed user scope."
            },
            {
              name: "timezone",
              in: "query",
              required: false,
              schema: { type: "string" },
              description:
                "Valid IANA timezone used for local-day progress calculations."
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["equipment"],
                properties: {
                  equipment: {
                    $ref: "#/components/schemas/GamificationEquipment"
                  }
                }
              },
              "Equipped cosmetics"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" }
          }
        },
        put: {
          summary: "Equip unlocked gamification cosmetics",
          parameters: [
            {
              name: "userIds",
              in: "query",
              required: false,
              schema: arrayOf({ type: "string" }),
              style: "form",
              explode: true
            },
            {
              name: "timezone",
              in: "query",
              required: false,
              schema: { type: "string" },
              description:
                "Valid IANA timezone used for reconciliation and local-day progress calculations."
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    selectedMascotSkin: nullable({ type: "string" }),
                    selectedHudTreatment: nullable({ type: "string" }),
                    selectedStreakEffect: nullable({ type: "string" }),
                    selectedTrophyShelf: nullable({ type: "string" }),
                    selectedCelebrationVariant: nullable({ type: "string" })
                  }
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["equipment"],
                properties: {
                  equipment: {
                    $ref: "#/components/schemas/GamificationEquipment"
                  }
                }
              },
              "Updated equipped cosmetics"
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/gamification/celebrations/{id}/seen": {
        post: {
          summary: "Mark a queued gamification celebration as seen",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Celebration ID to mark consumed."
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["celebration"],
                properties: {
                  celebration: {
                    $ref: "#/components/schemas/GamificationCelebration"
                  }
                }
              },
              "Updated gamification celebration"
            ),
            "401": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" }
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
      "/api/v1/mutation-receipts": {
        get: {
          summary: "List recent change receipts for the current principal",
          description:
            "Requires read scope. Receipts are isolated to the current operator or token principal and can be narrowed by owner. Results are newest first and capped at 50. Expired, conflicted, already-undone, and irreversible changes remain truthful terminal records without an active Undo control.",
          parameters: [
            repeatedStringQueryParameter("userIds"),
            integerQueryParameter("limit", 1, 50)
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["receipts", "limit"],
                properties: {
                  receipts: arrayOf({
                    $ref: "#/components/schemas/MutationReceipt"
                  }),
                  limit: { type: "integer", minimum: 1, maximum: 50 }
                }
              },
              "Bounded mutation receipt list"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/mutation-receipts/{id}/undo": {
        post: {
          summary: "Undo one recent reversible change",
          description:
            "Requires write scope and an Idempotency-Key header. Forge applies the inverse only before expiry and only while the target still matches the exact post-change state. A replay with the same key returns the stored result. Expired, conflicted, irreversible, foreign-principal, and out-of-owner-scope receipts never mutate data.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "Idempotency-Key",
              in: "header",
              required: true,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["receipt", "replayed", "result"],
                properties: {
                  receipt: { $ref: "#/components/schemas/MutationReceipt" },
                  replayed: { type: "boolean" },
                  result: { type: "object", additionalProperties: true }
                }
              },
              "Applied or idempotently replayed Undo"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/attention-inbox": {
        get: {
          summary: "Read the current actor's bounded attention queue",
          description:
            "Requires an operator session or a token with read scope. Operator sessions can receive pending approvals, unresolved companion syncs, and stale agent runtime signals. Tokens receive only task and insight records allowed by their user, project, and tag scope. Results are deduplicated, sorted by evidence-derived severity and recency, and bounded per source.",
          parameters: [
            {
              name: "state",
              in: "query",
              schema: {
                type: "string",
                enum: ["active", "snoozed", "dismissed"],
                default: "active"
              }
            },
            {
              name: "limit",
              in: "query",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 100,
                default: 25
              }
            },
            {
              name: "offset",
              in: "query",
              schema: {
                type: "integer",
                minimum: 0,
                maximum: 10000,
                default: 0
              }
            },
            {
              name: "userId",
              in: "query",
              schema: { type: "string" },
              description:
                "Optional operator user filter. A scoped token can only narrow, never widen, its configured user policy."
            },
            {
              name: "userIds",
              in: "query",
              schema: arrayOf({ type: "string" }),
              style: "form",
              explode: true,
              description:
                "Optional repeated user filter. A scoped token can only narrow, never widen, its configured user policy."
            }
          ],
          responses: {
            "200": jsonResponse(
              { $ref: "#/components/schemas/AttentionInboxPayload" },
              "Attention inbox payload"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/attention-inbox/{id}/actions/start": {
        post: {
          summary: "Start evidence tracking for one Attention primary action",
          description:
            "Operator-session only; scoped tokens are rejected before Forge reads or reveals any source. Requires one stable Idempotency-Key. Forge first replays an exact retained key, otherwise re-reads the current user-scoped Attention item and binds the exact item, source kind, primary action key, stable sourceRef, and sourceUpdatedAt. A changed request under the same key returns 409. A stale source version, forged action key, hidden item, or missing item fails safely. This route records an attempt only: it never approves, rejects, updates, reconnects, executes, or otherwise performs the domain action. Queue snooze, dismiss, and restore are not resolution actions. Request bodies are limited to 4,096 bytes. Attempts and receipts contain no requested payload, health bytes, runtime commands or errors, credentials, or source detail.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description:
                "URL-encoded AttentionInboxItem.id from the current queue."
            },
            {
              name: "Idempotency-Key",
              in: "header",
              required: true,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            },
            {
              name: "userId",
              in: "query",
              schema: { type: "string" },
              description:
                "Optional operator user scope, resolved by the same policy as GET /api/v1/attention-inbox."
            },
            {
              name: "userIds",
              in: "query",
              schema: arrayOf({ type: "string" }),
              style: "form",
              explode: true,
              description:
                "Optional repeated operator user scope; it can narrow but never widen the source read."
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["actionKey", "sourceUpdatedAt"],
                  properties: {
                    actionKey: {
                      type: "string",
                      enum: [
                        "review_decision",
                        "review_insight",
                        "resolve_blocker",
                        "review_due_work",
                        "recover_companion_sync",
                        "reconnect_runtime"
                      ]
                    },
                    sourceUpdatedAt: { type: "string", format: "date-time" }
                  }
                }
              }
            }
          },
          "x-forge-maximum-body-bytes": 4096,
          responses: {
            "200": jsonResponse(
              { $ref: "#/components/schemas/AttentionResolutionStartResult" },
              "Created or exactly replayed resolution attempt"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/attention-resolutions/check": {
        post: {
          summary: "Check pending Attention resolution attempts",
          description:
            "Operator-session only; scoped tokens are rejected before any attempt or source lookup, so denial cannot be used to probe source existence. Requires one stable Idempotency-Key and processes at most 100 pending attempts in the requested user scope. An exact retained retry returns the byte-equivalent stored response; changed-scope key reuse returns 409. Forge performs bounded status-only reads from each authoritative source. Positive evidence is limited to: approval approved/rejected/executed; insight accepted/applied; the original blocker clearing on the existing authorized task even when that task remains overdue; an existing overdue task becoming done, losing its due date, or moving to today or later; a later completed companion sync for the same user beginning after the offending session; or a matching canonical provider and normalized agent-label group producing a connected heartbeat newer than both the attempt and source version. Hiding, snoozing, restoring, source deletion or denial, approval cancellation, insight dismissal/snooze/expiry, mobile abort or a new failure, runtime reconnecting/disconnected/old heartbeat, and candidate disappearance alone never create a receipt. Results may truthfully classify resolved, still_open, stale, deleted, or denied without returning source payload or operational detail. Each positive result atomically commits exactly one durable receipt and one safe Activity event; any failure rolls both back. Request bodies are limited to 1,024 bytes and must be empty.",
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: true,
              schema: { type: "string", minLength: 1, maxLength: 128 }
            },
            {
              name: "userId",
              in: "query",
              schema: { type: "string" },
              description:
                "Optional operator user scope, resolved by the same policy as the Attention queue."
            },
            {
              name: "userIds",
              in: "query",
              schema: arrayOf({ type: "string" }),
              style: "form",
              explode: true,
              description:
                "Optional repeated operator user scope; changed scope changes the idempotency fingerprint."
            }
          ],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  maxProperties: 0
                }
              }
            }
          },
          "x-forge-maximum-body-bytes": 1024,
          responses: {
            "200": jsonResponse(
              { $ref: "#/components/schemas/AttentionResolutionCheckResponse" },
              "Idempotent bounded resolution check"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/attention-resolutions": {
        get: {
          summary: "List durable Attention resolution receipts",
          description:
            "Operator-session only; scoped tokens are rejected before receipt lookup. Returns newest-first persisted evidence receipts, bounded to 100 per response and filtered through the same optional operator user scope as the Attention queue. These receipts are distinct from SYS-18 ten-minute Undo receipts and never make a domain change reversible. Forge publishes and enforces a 365-day, newest-5,000-records-per-actor storage and exact-replay window; within that window durable means persisted in the Forge database. Receipts store only safe queue identity, display, evidence-code, Activity-reference, and timestamp fields—never requested payloads, health bytes, runtime commands or errors, credentials, or source detail.",
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 100, default: 25 }
            },
            {
              name: "userId",
              in: "query",
              schema: { type: "string" },
              description:
                "Optional operator user scope, resolved by the same policy as the Attention queue."
            },
            {
              name: "userIds",
              in: "query",
              schema: arrayOf({ type: "string" }),
              style: "form",
              explode: true
            }
          ],
          responses: {
            "200": jsonResponse(
              { $ref: "#/components/schemas/AttentionResolutionList" },
              "Bounded durable Attention resolution receipt list"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/attention-inbox/{id}/snooze": {
        post: {
          summary: "Snooze an eligible attention item",
          description:
            "Requires write scope. The item must advertise snooze in allowedActions. Snoozes must end in the future and within one year. If the underlying source changes, Forge reactivates the item immediately.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "URL-encoded AttentionInboxItem.id."
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["until"],
                  properties: {
                    until: { type: "string", format: "date-time" },
                    note: { type: "string", maxLength: 500, default: "" }
                  }
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["attentionState", "mutationReceipt"],
                properties: {
                  attentionState: {
                    $ref: "#/components/schemas/AttentionInboxStateRecord"
                  },
                  mutationReceipt: {
                    $ref: "#/components/schemas/MutationReceipt"
                  }
                }
              },
              "Snoozed attention state"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/attention-inbox/{id}/dismiss": {
        post: {
          summary: "Dismiss an eligible attention item",
          description:
            "Requires write scope. The item must advertise dismiss in allowedActions. Blocked and overdue work cannot be dismissed; it can only be opened or snoozed. If the underlying source changes, Forge reactivates a dismissed item.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "URL-encoded AttentionInboxItem.id."
            }
          ],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    note: { type: "string", maxLength: 500, default: "" }
                  }
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["attentionState", "mutationReceipt"],
                properties: {
                  attentionState: {
                    $ref: "#/components/schemas/AttentionInboxStateRecord"
                  },
                  mutationReceipt: {
                    $ref: "#/components/schemas/MutationReceipt"
                  }
                }
              },
              "Dismissed attention state"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/attention-inbox/{id}/restore": {
        post: {
          summary: "Restore a snoozed or dismissed attention item",
          description:
            "Requires write scope. Restore is available only while the current source version remains snoozed or dismissed.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "URL-encoded AttentionInboxItem.id."
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["attentionState", "mutationReceipt"],
                properties: {
                  attentionState: {
                    $ref: "#/components/schemas/AttentionInboxStateRecord"
                  },
                  mutationReceipt: {
                    $ref: "#/components/schemas/MutationReceipt"
                  }
                }
              },
              "Restored attention state"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/entity-navigation": {
        get: {
          summary: "List canonical pins and the caller's recent records",
          description:
            "Requires read scope. Pins are shared or user-owned canonical references. Recents are isolated to the authenticated operator or token actor. Scoped tokens receive only targets allowed by their user, project, and tag policy. Pinned deleted or missing targets remain visible as unavailable; unavailable recents are hidden.",
          parameters: [
            {
              name: "pinnedLimit",
              in: "query",
              schema: {
                type: "integer",
                minimum: 0,
                maximum: 25,
                default: 6
              }
            },
            {
              name: "recentLimit",
              in: "query",
              schema: {
                type: "integer",
                minimum: 0,
                maximum: 25,
                default: 6
              }
            },
            {
              name: "userId",
              in: "query",
              schema: { type: "string" },
              description:
                "Optional operator user filter. A scoped token can only narrow, never widen, its configured user policy."
            },
            {
              name: "userIds",
              in: "query",
              schema: arrayOf({ type: "string" }),
              style: "form",
              explode: true,
              description:
                "Optional repeated user filter. A scoped token can only narrow, never widen, its configured user policy."
            }
          ],
          responses: {
            "200": jsonResponse(
              { $ref: "#/components/schemas/EntityNavigationPayload" },
              "Canonical navigation payload"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/entity-navigation/pins": {
        put: {
          summary: "Pin a Forge record",
          description:
            "Requires an authenticated human operator session. Agent tokens cannot create pins. The operation is idempotent for the same owner and entity reference, and every newly created pin is audited.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/EntityNavigationPinInput"
                }
              }
            }
          },
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["pin"],
                properties: {
                  pin: { $ref: "#/components/schemas/EntityNavigationItem" }
                }
              },
              "Pinned record"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/entity-navigation/pins/{id}": {
        delete: {
          summary: "Unpin a Forge record",
          description:
            "Requires an authenticated human operator session. Agent tokens cannot remove pins. Unpinning removes the active pin while preserving an append-only audit event.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "EntityNavigationItem.pinId."
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["unpinned", "pinId"],
                properties: {
                  unpinned: { type: "boolean", enum: [true] },
                  pinId: { type: "string" }
                }
              },
              "Unpinned record"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/entity-navigation/touch": {
        post: {
          summary: "Record that the current actor viewed a Forge record",
          description:
            "Requires write scope. The target must exist and be inside the caller's effective user, project, and tag scope. This route updates only the calling operator or token actor's recent history; it does not change pins or the target entity.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/EntityNavigationTouchInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["recent"],
                properties: {
                  recent: {
                    $ref: "#/components/schemas/EntityNavigationItem"
                  }
                }
              },
              "Updated actor recent record"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/saved-views": {
        get: {
          summary: "List one person's saved Action Bar views",
          description:
            "Requires an authenticated human operator session. Each owner can keep at most 20 views. Unsupported stored filters and deleted people are returned separately; a selected scope with no available people must not be applied as an all-people scope.",
          security: [{ operatorSession: [] }],
          parameters: [
            {
              name: "ownerUserId",
              in: "query",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "limit",
              in: "query",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 20,
                default: 20
              }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["savedViews"],
                properties: {
                  savedViews: arrayOf({
                    $ref: "#/components/schemas/SavedView"
                  })
                }
              },
              "Saved views"
            ),
            default: { $ref: "#/components/responses/Error" }
          }
        },
        post: {
          summary: "Save the current Action Bar view",
          description:
            "Requires an authenticated human operator session. Names are unique per owner, every referenced person must exist when the view is saved, and each owner can keep at most 20 views.",
          security: [{ operatorSession: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SavedViewCreateInput" }
              }
            }
          },
          responses: {
            "201": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["savedView"],
                properties: {
                  savedView: { $ref: "#/components/schemas/SavedView" }
                }
              },
              "Saved view"
            ),
            "409": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/saved-views/{id}": {
        delete: {
          summary: "Delete one person's saved view",
          description: "Requires an authenticated human operator session.",
          security: [{ operatorSession: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "ownerUserId",
              in: "query",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                additionalProperties: false,
                required: ["deleted", "savedViewId"],
                properties: {
                  deleted: { type: "boolean", enum: [true] },
                  savedViewId: { type: "string" }
                }
              },
              "Deleted saved view"
            ),
            "404": { $ref: "#/components/responses/Error" },
            default: { $ref: "#/components/responses/Error" }
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
      "/api/v1/agents/sessions": {
        get: {
          summary: "List registered live agent runtime sessions",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["sessions"],
                properties: {
                  sessions: arrayOf({
                    $ref: "#/components/schemas/AgentRuntimeSession"
                  })
                }
              },
              "Agent runtime sessions"
            )
          }
        },
        post: {
          summary: "Register or refresh a live agent runtime session",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["session"],
                properties: {
                  session: {
                    $ref: "#/components/schemas/AgentRuntimeSession"
                  }
                }
              },
              "Registered agent runtime session"
            )
          }
        }
      },
      "/api/v1/agents/sessions/heartbeat": {
        post: {
          summary: "Heartbeat an existing agent runtime session",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["session"],
                properties: {
                  session: {
                    $ref: "#/components/schemas/AgentRuntimeSession"
                  }
                }
              },
              "Updated runtime session"
            )
          }
        }
      },
      "/api/v1/agents/sessions/events": {
        post: {
          summary: "Append an event to an agent runtime session history",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["event"],
                properties: {
                  event: {
                    $ref: "#/components/schemas/AgentRuntimeSessionEvent"
                  }
                }
              },
              "Recorded runtime session event"
            )
          }
        }
      },
      "/api/v1/agents/sessions/{id}/history": {
        get: {
          summary:
            "Read one agent runtime session with event and action history",
          responses: {
            "200": jsonResponse(
              { $ref: "#/components/schemas/AgentRuntimeSessionHistory" },
              "Agent runtime session history"
            )
          }
        }
      },
      "/api/v1/agents/sessions/{id}/reconnect": {
        post: {
          summary:
            "Mark a runtime session for reconnect and return its reconnect plan",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["session"],
                properties: {
                  session: {
                    $ref: "#/components/schemas/AgentRuntimeSession"
                  }
                }
              },
              "Reconnect requested"
            )
          }
        }
      },
      "/api/v1/agents/sessions/{id}/disconnect": {
        post: {
          summary: "Mark a runtime session disconnected",
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["session"],
                properties: {
                  session: {
                    $ref: "#/components/schemas/AgentRuntimeSession"
                  }
                }
              },
              "Disconnected session"
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
            ),
            "401": { $ref: "#/components/responses/Error" }
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
            "401": { $ref: "#/components/responses/Error" },
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
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/rewards/ledger": {
        get: {
          summary: "List a bounded reward ledger",
          parameters: [
            {
              name: "entityType",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Exact Forge entity type filter."
            },
            {
              name: "entityId",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Exact Forge entity ID filter."
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 200,
                default: 50
              },
              description:
                "Maximum newest-first ledger entries returned; hard-capped at 200."
            }
          ],
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
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/rewards/bonus": {
        post: {
          summary: "Create a manual, explainable XP bonus entry",
          description:
            "Requires write and rewards.manage. Forge resolves the target owner from the stored target, applies token user/project/tag scope, ignores caller-supplied owner metadata, rejects server-owned manual, qualifiesForStreak, and idempotencyFingerprint metadata, and returns XP metrics for the authorized target owner.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "entityType",
                    "entityId",
                    "deltaXp",
                    "reasonTitle"
                  ],
                  properties: {
                    entityType: {
                      type: "string",
                      enum: REWARDABLE_ENTITY_TYPE_VALUES
                    },
                    entityId: { type: "string", minLength: 1 },
                    deltaXp: {
                      type: "integer",
                      not: { const: 0 }
                    },
                    reasonTitle: { type: "string", minLength: 1 },
                    reasonSummary: { type: "string", default: "" },
                    metadata: {
                      type: "object",
                      not: {
                        anyOf: [
                          { required: ["manual"] },
                          { required: ["qualifiesForStreak"] },
                          { required: ["idempotencyFingerprint"] }
                        ]
                      },
                      additionalProperties: {
                        anyOf: [
                          { type: "string" },
                          { type: "number" },
                          { type: "boolean" },
                          { type: "null" }
                        ]
                      },
                      default: {}
                    }
                  }
                }
              }
            }
          },
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
            ),
            "400": { $ref: "#/components/responses/Error" },
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" }
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
          description:
            "Records one idempotent session event. Supply the same IANA timezone used by XP reads so ambient daily caps and reporting share one local-day boundary.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["sessionId", "eventType"],
                  properties: {
                    sessionId: { type: "string", minLength: 1 },
                    eventType: { type: "string", minLength: 1 },
                    timezone: {
                      type: "string",
                      description: "Valid IANA timezone."
                    },
                    metrics: {
                      type: "object",
                      additionalProperties: {
                        anyOf: [
                          { type: "string" },
                          { type: "number" },
                          { type: "boolean" },
                          { type: "null" }
                        ]
                      },
                      default: {}
                    }
                  }
                }
              }
            }
          },
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
          parameters: [
            {
              in: "query",
              name: "timeZone",
              schema: { type: "string" },
              description:
                "IANA timezone used to derive the local Monday-through-Sunday review window."
            }
          ],
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
          parameters: [
            {
              in: "query",
              name: "timeZone",
              schema: { type: "string" },
              description:
                "IANA timezone used to select the local review cycle being finalized."
            }
          ],
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
          description:
            "Deleted Note snapshots are filtered through the same user, Wiki-space, and Psyche visibility contract as live Note reads.",
          security: [{ operatorSession: [] }, { bearerAuth: [] }],
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
            ),
            "401": { $ref: "#/components/responses/Error" },
            "403": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/entities/create": {
        post: {
          summary:
            "Create multiple Forge entities in one ordered batch request",
          description:
            "The default create route for normal stored entities. Agent tokens require base write. Creating or mutating event_type or emotion_definition additionally requires psyche.write when Psyche authentication is enabled. Creating a note linked to a Psyche entity requires the psyche.note scope. Structured links in task Notes must point to live records accessible to the caller; unavailable targets return a generic 404 before the batch writes anything.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/BatchCreateEntitiesInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["results"],
                properties: {
                  results: arrayOf({
                    $ref: "#/components/schemas/BatchEntityMutationResult"
                  })
                }
              },
              "Ordered batch create results. When atomic=true and one operation fails, earlier successful results use error.code rolled_back because their transaction effects were undone, the failing operation keeps its original error, and later skipped operations use error.code not_executed."
            ),
            "403": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/entities/update": {
        post: {
          summary:
            "Update multiple Forge entities in one ordered batch request",
          description:
            "Updates are owner scoped. Each changed successful result includes a ten-minute, concurrency-checked mutationReceipt; a no-op returns mutationReceipt=null. Agent tokens require base write. Updating event_type or emotion_definition additionally requires psyche.write when Psyche authentication is enabled. Updating a Psyche-linked note, or adding a Psyche link to a note, requires psyche.note. Structured links in task Notes must point to live records accessible to the caller; unavailable targets return a generic 404 before the batch writes anything. Updating a projected Note preserves stored links that the caller could not see.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/BatchUpdateEntitiesInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["results"],
                properties: {
                  results: arrayOf({
                    $ref: "#/components/schemas/BatchEntityMutationResult"
                  })
                }
              },
              "Ordered batch update results. When atomic=true and one operation fails, earlier successful results use error.code rolled_back because their transaction effects were undone, the failing operation keeps its original error, and later skipped operations use error.code not_executed."
            ),
            "403": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/entities/delete": {
        post: {
          summary:
            "Delete multiple Forge entities in one ordered batch request. Soft delete is the default.",
          description:
            "Every successful result includes mutationReceipt. Soft deletion returns a ten-minute Undo receipt; hard or immediate deletion returns a terminal receipt with no false Undo. Agent tokens require base write. Deleting event_type or emotion_definition additionally requires psyche.write when Psyche authentication is enabled. Deleting a Psyche-linked note requires psyche.note.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/BatchDeleteEntitiesInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["results"],
                properties: {
                  results: arrayOf({
                    $ref: "#/components/schemas/BatchEntityMutationResult"
                  })
                }
              },
              "Ordered batch delete results. When atomic=true and one operation fails, earlier successful results use error.code rolled_back because their transaction effects were undone, the failing operation keeps its original error, and later skipped operations use error.code not_executed."
            ),
            "403": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/entities/restore": {
        post: {
          summary:
            "Restore multiple soft-deleted Forge entities in one ordered batch request",
          description:
            "Agent tokens require base write. Restoring event_type or emotion_definition additionally requires psyche.write when Psyche authentication is enabled. Restoring a Psyche-linked note requires psyche.note.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/BatchRestoreEntitiesInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["results"],
                properties: {
                  results: arrayOf({
                    $ref: "#/components/schemas/BatchEntityMutationResult"
                  })
                }
              },
              "Ordered batch restore results. When atomic=true and one operation fails, earlier successful results use error.code rolled_back because their transaction effects were undone, the failing operation keeps its original error, and later skipped operations use error.code not_executed."
            ),
            "403": { $ref: "#/components/responses/Error" }
          }
        }
      },
      "/api/v1/entities/search": {
        post: {
          summary:
            "Search across multiple Forge entity types in one ordered batch request",
          description:
            "Agent tokens require base read or write. Explicit event_type or emotion_definition searches additionally require psyche.read when Psyche authentication is enabled; searches[].userIds selects the effective custom owner scope while built-ins remain visible. Normal note search uses the indexed Notes query and applies owner, Wiki-space, deleted/expired, and Psyche authorization before result limits. Psyche-linked notes require psyche.read. Note results omit inaccessible linked records and expose only unavailableLinkCount, never their identifiers or reasons.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/BatchSearchEntitiesInput"
                }
              }
            }
          },
          responses: {
            "200": jsonResponse(
              {
                type: "object",
                required: ["results"],
                properties: {
                  results: arrayOf({
                    $ref: "#/components/schemas/BatchEntitySearchResult"
                  })
                }
              },
              "Batch search results"
            ),
            "403": { $ref: "#/components/responses/Error" }
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
