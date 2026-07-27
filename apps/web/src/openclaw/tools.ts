import {
  Type,
  type TObject,
  type TProperties,
  type TSchema
} from "@sinclair/typebox";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import {
  callConfiguredForgeApi,
  expectForgeSuccess,
  requireApiToken,
  type ForgePluginConfig
} from "./api-client.js";
import type { ForgePluginToolApi } from "./plugin-sdk-types.js";

type StaticLike<T> = T extends TObject ? Record<string, unknown> : never;

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

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value: unknown) {
  const text = normalizeText(value);
  return text.length > 0 ? text : undefined;
}

function omitToolFields(
  value: Record<string, unknown>,
  excludedKeys: readonly string[]
) {
  const excluded = new Set(excludedKeys);
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !excluded.has(key))
  );
}

function normalizeTaskRunStartRequest(params: Record<string, unknown>) {
  const taskId = normalizeText(params.taskId);
  if (!taskId) {
    throw new Error("forge_start_task_run requires a non-empty taskId.");
  }

  const actor = normalizeText(params.actor);
  if (!actor) {
    throw new Error("forge_start_task_run requires a non-empty actor.");
  }

  const timerMode = params.timerMode === "planned" ? "planned" : "unlimited";
  const plannedDurationSeconds =
    typeof params.plannedDurationSeconds === "number" &&
    Number.isInteger(params.plannedDurationSeconds)
      ? params.plannedDurationSeconds
      : null;

  if (timerMode === "planned" && plannedDurationSeconds === null) {
    throw new Error(
      "forge_start_task_run requires plannedDurationSeconds when timerMode is planned."
    );
  }

  return {
    taskId,
    body: {
      actor,
      timerMode,
      plannedDurationSeconds:
        timerMode === "planned" ? plannedDurationSeconds : null,
      overrideReason: normalizeOptionalText(params.overrideReason),
      isCurrent:
        typeof params.isCurrent === "boolean" ? params.isCurrent : undefined,
      leaseTtlSeconds:
        typeof params.leaseTtlSeconds === "number" &&
        Number.isInteger(params.leaseTtlSeconds)
          ? params.leaseTtlSeconds
          : undefined,
      note: normalizeOptionalText(params.note)
    }
  };
}

async function runRead(config: ForgePluginConfig, path: string) {
  const result = await callConfiguredForgeApi(config, {
    method: "GET",
    path
  });
  return expectForgeSuccess(result);
}

async function runReadBody(
  config: ForgePluginConfig,
  options: { path: string; body: unknown }
) {
  const result = await callConfiguredForgeApi(config, {
    method: "POST",
    path: options.path,
    body: options.body
  });
  return expectForgeSuccess(result);
}

async function runWrite(
  config: ForgePluginConfig,
  options: {
    method: "POST" | "PATCH" | "PUT" | "DELETE";
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
const todayPriorityReadSchema = Type.Object({
  userIds: Type.Optional(Type.Array(Type.String())),
  timeZone: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  candidateLimit: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 100, default: 24 })
  )
});
type SpecializedRouteSpec = {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  requiresToken?: boolean;
  requiresAgentToken?: boolean;
};

type PeoplePeerAgentRouteSpec = SpecializedRouteSpec & {
  operationId: string;
  requiredScopes: readonly string[];
  principalClasses: readonly string[];
  humanOnly: false;
  mcpExposed: true;
  paramsSchema: TObject;
  querySchema: TObject;
  bodySchema?: TObject;
};

const movementRouteSpecs = {
  day: { method: "GET", path: "/api/v1/movement/day" },
  month: { method: "GET", path: "/api/v1/movement/month" },
  allTime: { method: "GET", path: "/api/v1/movement/all-time" },
  timeline: { method: "GET", path: "/api/v1/movement/timeline" },
  places: { method: "GET", path: "/api/v1/movement/places" },
  settings: { method: "GET", path: "/api/v1/movement/settings" },
  boxDetail: { method: "GET", path: "/api/v1/movement/boxes/:id" },
  tripDetail: { method: "GET", path: "/api/v1/movement/trips/:id" },
  selection: { method: "POST", path: "/api/v1/movement/selection" },
  settingsUpdate: {
    method: "PATCH",
    path: "/api/v1/movement/settings",
    requiresToken: true
  },
  placeCreate: {
    method: "POST",
    path: "/api/v1/movement/places",
    requiresToken: true
  },
  placeUpdate: {
    method: "PATCH",
    path: "/api/v1/movement/places/:id",
    requiresToken: true
  },
  userBoxPreflight: {
    method: "POST",
    path: "/api/v1/movement/user-boxes/preflight",
    requiresToken: true
  },
  userBoxCreate: {
    method: "POST",
    path: "/api/v1/movement/user-boxes",
    requiresToken: true
  },
  userBoxUpdate: {
    method: "PATCH",
    path: "/api/v1/movement/user-boxes/:id",
    requiresToken: true
  },
  userBoxDelete: {
    method: "DELETE",
    path: "/api/v1/movement/user-boxes/:id",
    requiresToken: true
  },
  automaticBoxInvalidate: {
    method: "POST",
    path: "/api/v1/movement/automatic-boxes/:id/invalidate",
    requiresToken: true
  },
  stayUpdate: {
    method: "PATCH",
    path: "/api/v1/movement/stays/:id",
    requiresToken: true
  },
  stayDelete: {
    method: "DELETE",
    path: "/api/v1/movement/stays/:id",
    requiresToken: true
  },
  tripUpdate: {
    method: "PATCH",
    path: "/api/v1/movement/trips/:id",
    requiresToken: true
  },
  tripDelete: {
    method: "DELETE",
    path: "/api/v1/movement/trips/:id",
    requiresToken: true
  },
  tripPointUpdate: {
    method: "PATCH",
    path: "/api/v1/movement/trips/:id/points/:pointId",
    requiresToken: true
  },
  tripPointDelete: {
    method: "DELETE",
    path: "/api/v1/movement/trips/:id/points/:pointId",
    requiresToken: true
  }
} as const satisfies Record<string, SpecializedRouteSpec>;

const lifeForceRouteSpecs = {
  overview: { method: "GET", path: "/api/v1/life-force" },
  profile: {
    method: "PATCH",
    path: "/api/v1/life-force/profile",
    requiresToken: true
  },
  weekdayTemplate: {
    method: "PUT",
    path: "/api/v1/life-force/templates/:weekday",
    requiresToken: true
  },
  fatigueSignal: {
    method: "POST",
    path: "/api/v1/life-force/fatigue-signals",
    requiresToken: true
  }
} as const satisfies Record<string, SpecializedRouteSpec>;

const workbenchRouteSpecs = {
  boxCatalog: { method: "GET", path: "/api/v1/workbench/catalog/boxes" },
  listFlows: { method: "GET", path: "/api/v1/workbench/flows" },
  flowDetail: { method: "GET", path: "/api/v1/workbench/flows/:id" },
  flowById: { method: "GET", path: "/api/v1/workbench/flows/:id" },
  flowBySlug: {
    method: "GET",
    path: "/api/v1/workbench/flows/by-slug/:slug"
  },
  createFlow: {
    method: "POST",
    path: "/api/v1/workbench/flows",
    requiresToken: true
  },
  updateFlow: {
    method: "PATCH",
    path: "/api/v1/workbench/flows/:id",
    requiresToken: true
  },
  deleteFlow: {
    method: "DELETE",
    path: "/api/v1/workbench/flows/:id",
    requiresToken: true
  },
  runFlow: {
    method: "POST",
    path: "/api/v1/workbench/flows/:id/run",
    requiresToken: true
  },
  runByPayload: {
    method: "POST",
    path: "/api/v1/workbench/run",
    requiresToken: true
  },
  chatFlow: {
    method: "POST",
    path: "/api/v1/workbench/flows/:id/chat",
    requiresToken: true
  },
  publishedOutput: {
    method: "GET",
    path: "/api/v1/workbench/flows/:id/output"
  },
  runHistory: { method: "GET", path: "/api/v1/workbench/flows/:id/runs" },
  runs: { method: "GET", path: "/api/v1/workbench/flows/:id/runs" },
  runDetail: {
    method: "GET",
    path: "/api/v1/workbench/flows/:id/runs/:runId"
  },
  runNodes: {
    method: "GET",
    path: "/api/v1/workbench/flows/:id/runs/:runId/nodes"
  },
  nodeResult: {
    method: "GET",
    path: "/api/v1/workbench/flows/:id/runs/:runId/nodes/:nodeId"
  },
  latestNodeOutput: {
    method: "GET",
    path: "/api/v1/workbench/flows/:id/nodes/:nodeId/output"
  }
} as const satisfies Record<string, SpecializedRouteSpec>;

export const courseRouteSpecs = {
  listCourses: { method: "GET", path: "/api/v1/courses" },
  courseDetail: { method: "GET", path: "/api/v1/courses/:courseId" },
  learningSession: {
    method: "GET",
    path: "/api/v1/courses/:courseId/learn"
  },
  voiceLearningSession: {
    method: "POST",
    path: "/api/v1/courses/:courseId/voice-session",
    requiresToken: true
  },
  submitAttempt: {
    method: "POST",
    path: "/api/v1/courses/:courseId/lessons/:lessonId/activities/:activityId/attempts",
    requiresToken: true
  },
  upgradeEnrollment: {
    method: "POST",
    path: "/api/v1/courses/:courseId/upgrade",
    requiresToken: true
  },
  importCourse: {
    method: "POST",
    path: "/api/v1/courses/import",
    requiresToken: true
  },
  exportCourse: {
    method: "GET",
    path: "/api/v1/courses/:courseId/export"
  },
  listConcepts: { method: "GET", path: "/api/v1/concepts" },
  conceptDetail: { method: "GET", path: "/api/v1/concepts/:conceptId" }
} as const satisfies Record<string, SpecializedRouteSpec>;

const artifactRouteSpecs = {
  list: { method: "GET", path: "/api/v1/artifacts" },
  createWithBytes: {
    method: "POST",
    path: "/api/v1/artifacts",
    requiresToken: true
  },
  readMetadata: { method: "GET", path: "/api/v1/artifacts/:id" },
  updateMetadata: {
    method: "PATCH",
    path: "/api/v1/artifacts/:id",
    requiresToken: true
  },
  rescan: {
    method: "POST",
    path: "/api/v1/artifacts/:id/scan",
    requiresToken: true
  },
  enrichWithLlm: {
    method: "POST",
    path: "/api/v1/artifacts/:id/enrich",
    requiresToken: true
  },
  replaceGenericLinks: {
    method: "POST",
    path: "/api/v1/artifacts/:id/links",
    requiresToken: true
  },
  trustState: {
    method: "POST",
    path: "/api/v1/artifacts/:id/trust",
    requiresToken: true
  },
  versions: { method: "GET", path: "/api/v1/artifacts/:id/versions" },
  audit: { method: "GET", path: "/api/v1/artifacts/:id/audit" }
} as const satisfies Record<string, SpecializedRouteSpec>;

const lifeEventRouteSpecs = {
  timeline: { method: "GET", path: "/api/v1/life-events/timeline" },
  read: { method: "GET", path: "/api/v1/life-events/:id" },
  calendarSync: {
    method: "POST",
    path: "/api/v1/life-events/:id/calendar-sync",
    requiresToken: true
  },
  fromCalendarEvent: {
    method: "POST",
    path: "/api/v1/life-events/from-calendar-event",
    requiresToken: true
  },
  importTicket: {
    method: "POST",
    path: "/api/v1/life-events/import-ticket",
    requiresToken: true
  },
  travelStatus: {
    method: "GET",
    path: "/api/v1/life-events/:id/travel-status"
  }
} as const satisfies Record<string, SpecializedRouteSpec>;

const attentionRouteSpecs = {
  list: { method: "GET", path: "/api/v1/attention-inbox" },
  snooze: {
    method: "POST",
    path: "/api/v1/attention-inbox/:id/snooze",
    requiresToken: true
  },
  dismiss: {
    method: "POST",
    path: "/api/v1/attention-inbox/:id/dismiss",
    requiresToken: true
  },
  restore: {
    method: "POST",
    path: "/api/v1/attention-inbox/:id/restore",
    requiresToken: true
  }
} as const satisfies Record<string, SpecializedRouteSpec>;

const entityNavigationRouteSpecs = {
  list: { method: "GET", path: "/api/v1/entity-navigation" },
  touch: {
    method: "POST",
    path: "/api/v1/entity-navigation/touch",
    requiresToken: true
  }
} as const satisfies Record<string, SpecializedRouteSpec>;

const calendarConnectionRouteSpecs = {
  list: { method: "GET", path: "/api/v1/calendar/connections" },
  discover: {
    method: "POST",
    path: "/api/v1/calendar/discovery",
    requiresToken: true
  },
  discoverMacOSLocal: {
    method: "GET",
    path: "/api/v1/calendar/macos-local/discovery"
  },
  rediscover: {
    method: "GET",
    path: "/api/v1/calendar/connections/:id/discovery"
  },
  create: {
    method: "POST",
    path: "/api/v1/calendar/connections",
    requiresToken: true
  },
  update: {
    method: "PATCH",
    path: "/api/v1/calendar/connections/:id",
    requiresToken: true
  },
  sync: {
    method: "POST",
    path: "/api/v1/calendar/connections/:id/sync",
    requiresToken: true
  },
  delete: {
    method: "DELETE",
    path: "/api/v1/calendar/connections/:id",
    requiresToken: true
  }
} as const satisfies Record<string, SpecializedRouteSpec>;

const wikiRouteSpecs = {
  list: { method: "GET", path: "/api/v1/wiki/pages" },
  search: {
    method: "POST",
    path: "/api/v1/wiki/search"
  },
  create: {
    method: "POST",
    path: "/api/v1/wiki/pages",
    requiresToken: true
  },
  read: { method: "GET", path: "/api/v1/wiki/pages/:id" },
  readBySlug: { method: "GET", path: "/api/v1/wiki/by-slug/:slug" },
  update: {
    method: "PATCH",
    path: "/api/v1/wiki/pages/:id",
    requiresToken: true
  },
  delete: {
    method: "DELETE",
    path: "/api/v1/wiki/pages/:id",
    requiresToken: true
  },
  health: { method: "GET", path: "/api/v1/wiki/health" },
  sync: {
    method: "POST",
    path: "/api/v1/wiki/sync",
    requiresToken: true
  },
  reindex: {
    method: "POST",
    path: "/api/v1/wiki/reindex",
    requiresToken: true
  },
  ingest: {
    method: "POST",
    path: "/api/v1/wiki/ingest-jobs",
    requiresToken: true
  }
} as const satisfies Record<string, SpecializedRouteSpec>;

const optionalString = () => Type.Optional(Type.String());
const optionalNullableString = () =>
  Type.Optional(Type.Union([Type.String(), Type.Null()]));
function literalUnion(
  values: readonly string[],
  options: Record<string, unknown> = {}
) {
  return Type.Union(
    values.map((value) => Type.Literal(value)) as [
      ReturnType<typeof Type.Literal>,
      ReturnType<typeof Type.Literal>,
      ...Array<ReturnType<typeof Type.Literal>>
    ],
    options
  );
}

const strictObject = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const peoplePeerIdSchema = () => Type.String({ minLength: 1, maxLength: 240 });
const peoplePeerVersionSchema = () =>
  Type.String({ minLength: 1, maxLength: 240 });
const peoplePeerCursorSchema = () =>
  Type.String({
    minLength: 8,
    maxLength: 2_048,
    pattern: "^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$"
  });
const peoplePeerHashSchema = () => Type.String({ pattern: "^[a-f0-9]{64}$" });
const peoplePeerIdempotencyKeySchema = () =>
  Type.String({
    minLength: 16,
    maxLength: 240,
    pattern: "^[A-Za-z0-9._:-]+$"
  });
const peoplePeerEmptySchema = () => strictObject({});
const personPathParamsSchema = () =>
  strictObject({ personId: peoplePeerIdSchema() });
const relationshipPathParamsSchema = () =>
  strictObject({ relationshipId: peoplePeerIdSchema() });
const peopleWikiDecisionSchema = () =>
  Type.Union([
    strictObject({
      wikiPageId: peoplePeerIdSchema(),
      action: Type.Literal("associate"),
      personId: peoplePeerIdSchema(),
      expectedWikiVersion: peoplePeerVersionSchema(),
      expectedPersonVersion: peoplePeerVersionSchema()
    }),
    strictObject({
      wikiPageId: peoplePeerIdSchema(),
      action: Type.Literal("create_person"),
      displayName: Type.String({ minLength: 1, maxLength: 160 }),
      preferredName: Type.Optional(Type.String({ maxLength: 160 })),
      relationshipCategory: Type.Optional(
        literalUnion([
          "family",
          "friend",
          "partner",
          "colleague",
          "community",
          "professional",
          "other"
        ])
      ),
      relationshipLabel: Type.Optional(Type.String({ maxLength: 240 })),
      shortDescription: Type.Optional(Type.String({ maxLength: 2000 })),
      aliases: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 160 }), {
          maxItems: 32
        })
      ),
      expectedWikiVersion: peoplePeerVersionSchema()
    }),
    strictObject({
      wikiPageId: peoplePeerIdSchema(),
      action: Type.Literal("skip"),
      expectedWikiVersion: peoplePeerVersionSchema()
    })
  ]);
const peopleWikiAssociationBaseSchema = () => ({
  userId: Type.Optional(peoplePeerIdSchema()),
  peopleRootPageId: peoplePeerIdSchema(),
  decisions: Type.Array(peopleWikiDecisionSchema(), {
    minItems: 1,
    maxItems: 100
  })
});
const listPeopleAgentQuerySchema = () =>
  strictObject({
    userId: Type.Optional(peoplePeerIdSchema()),
    query: Type.Optional(Type.String({ maxLength: 200 })),
    relationshipStatus: Type.Optional(
      literalUnion(["none", "pending", "active", "paused", "revoked"])
    ),
    source: Type.Optional(
      literalUnion(["local", "shared", "both"], { default: "both" })
    ),
    hasUpcomingSharedContext: Type.Optional(Type.Boolean()),
    sort: Type.Optional(
      literalUnion(["display_name", "updated_at", "next_shared_event"], {
        default: "display_name"
      })
    ),
    direction: Type.Optional(literalUnion(["asc", "desc"], { default: "asc" })),
    cursor: Type.Optional(peoplePeerCursorSchema()),
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 100, default: 50 })
    )
  });
const personContextAgentQuerySchema = () =>
  strictObject({
    includePrivate: Type.Optional(Type.Boolean({ default: false })),
    includeShared: Type.Optional(Type.Boolean({ default: true })),
    linkLimit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 200, default: 100 })
    ),
    projectionLimit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 100, default: 40 })
    )
  });
const peopleWikiCandidateScanBodySchema = () =>
  strictObject({
    userId: Type.Optional(peoplePeerIdSchema()),
    peopleRootPageId: peoplePeerIdSchema(),
    query: Type.Optional(Type.String({ maxLength: 200 })),
    cursor: Type.Optional(peoplePeerCursorSchema()),
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 100, default: 50 })
    )
  });
const peopleWikiAssociationPreviewBodySchema = () =>
  strictObject(peopleWikiAssociationBaseSchema());
const peopleWikiAssociationApplyBodySchema = () =>
  strictObject({
    userId: Type.Optional(peoplePeerIdSchema()),
    peopleRootPageId: peoplePeerIdSchema(),
    previewId: peoplePeerIdSchema(),
    previewHash: peoplePeerHashSchema(),
    idempotencyKey: peoplePeerIdempotencyKeySchema(),
    decisions: Type.Array(peopleWikiDecisionSchema(), {
      minItems: 1,
      maxItems: 100
    })
  });
const peerRequestsAgentQuerySchema = () =>
  strictObject({
    kind: Type.Optional(literalUnion(["pairing", "device", "grant"])),
    status: Type.Optional(
      literalUnion(["pending", "accepted", "rejected", "expired"])
    ),
    cursor: Type.Optional(peoplePeerCursorSchema()),
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 100, default: 50 })
    )
  });
const peerRelationshipsAgentQuerySchema = () =>
  strictObject({
    query: Type.Optional(Type.String({ maxLength: 200 })),
    status: Type.Optional(
      literalUnion([
        "pending_verification",
        "active",
        "paused",
        "revoked",
        "recovery_required"
      ])
    ),
    cursor: Type.Optional(peoplePeerCursorSchema()),
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 100, default: 50 })
    )
  });
const peerGrantsAgentQuerySchema = () =>
  strictObject({
    status: Type.Optional(
      literalUnion([
        "draft",
        "proposed",
        "active",
        "countered",
        "rejected",
        "revoked",
        "superseded",
        "expired",
        "conflicted"
      ])
    ),
    cursor: Type.Optional(peoplePeerCursorSchema()),
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 100, default: 50 })
    )
  });
const peerDiagnosticsAgentQuerySchema = () =>
  strictObject({
    cursor: Type.Optional(peoplePeerCursorSchema()),
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 200, default: 100 })
    )
  });
const personQuestionInterpretBodySchema = () =>
  strictObject({
    question: Type.String({ minLength: 1, maxLength: 1_000 }),
    timeZone: Type.String({ minLength: 1, maxLength: 100 }),
    referenceTime: Type.Optional(Type.String({ format: "date-time" }))
  });
const personQuestionIntervalSchema = () =>
  strictObject({
    startsAt: Type.String({ format: "date-time" }),
    endsAt: Type.String({ format: "date-time" }),
    timeZone: Type.String({ minLength: 1, maxLength: 64 })
  });
const personQuestionEntityIdsSchema = (maximum: number) =>
  Type.Optional(
    Type.Array(peoplePeerIdSchema(), { maxItems: maximum, default: [] })
  );
const personQuestionFieldsSchema = (values: readonly string[]) =>
  Type.Optional(
    Type.Array(literalUnion(values), {
      maxItems: values.length,
      default: []
    })
  );
const personQuestionMaximumResultCountSchema = () =>
  Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000, default: 100 }));
const personQuestionEmptyParametersSchema = () => strictObject({});
const personQuestionTypedQuerySchema = () =>
  Type.Union([
    strictObject({
      projectionId: Type.Literal("calendar.availability.v1"),
      parameters: personQuestionEmptyParametersSchema(),
      interval: personQuestionIntervalSchema(),
      entityIds: personQuestionEntityIdsSchema(0),
      fields: personQuestionFieldsSchema([
        "start",
        "end",
        "timezone",
        "busyState",
        "eventTitle",
        "eventLocation"
      ]),
      precision: literalUnion(["exact", "fifteen_minutes", "hour"]),
      maximumResultCount: personQuestionMaximumResultCountSchema()
    }),
    strictObject({
      projectionId: Type.Literal("calendar.selected_events.v1"),
      parameters: personQuestionEmptyParametersSchema(),
      interval: personQuestionIntervalSchema(),
      entityIds: personQuestionEntityIdsSchema(256),
      fields: personQuestionFieldsSchema([
        "start",
        "end",
        "timezone",
        "busyState",
        "eventTitle",
        "eventLocation"
      ]),
      precision: Type.Literal("exact"),
      maximumResultCount: personQuestionMaximumResultCountSchema()
    }),
    strictObject({
      projectionId: Type.Literal("goals.horizon_summary.v1"),
      parameters: personQuestionEmptyParametersSchema(),
      interval: personQuestionIntervalSchema(),
      entityIds: personQuestionEntityIdsSchema(0),
      fields: personQuestionFieldsSchema([
        "goalTitle",
        "goalSummary",
        "goalState",
        "goalProgress"
      ]),
      precision: Type.Literal("exact"),
      maximumResultCount: personQuestionMaximumResultCountSchema()
    }),
    strictObject({
      projectionId: Type.Literal("health.cycling.aggregate.v1"),
      parameters: strictObject({
        granularity: literalUnion(["day", "week", "month"]),
        units: peoplePeerIdSchema()
      }),
      interval: personQuestionIntervalSchema(),
      entityIds: personQuestionEntityIdsSchema(0),
      fields: personQuestionFieldsSchema([
        "duration",
        "distance",
        "activityCount",
        "energy"
      ]),
      precision: Type.Literal("exact"),
      maximumResultCount: personQuestionMaximumResultCountSchema()
    }),
    strictObject({
      projectionId: Type.Literal("person.profile.v1"),
      parameters: personQuestionEmptyParametersSchema(),
      interval: Type.Null(),
      entityIds: personQuestionEntityIdsSchema(0),
      fields: personQuestionFieldsSchema([
        "displayName",
        "preferredName",
        "pronouns",
        "relationshipLabel",
        "shortDescription"
      ]),
      precision: Type.Literal("exact"),
      maximumResultCount: personQuestionMaximumResultCountSchema()
    }),
    strictObject({
      projectionId: Type.Literal("life_events.selected.v1"),
      parameters: personQuestionEmptyParametersSchema(),
      interval: personQuestionIntervalSchema(),
      entityIds: personQuestionEntityIdsSchema(256),
      fields: personQuestionFieldsSchema([
        "lifeEventTitle",
        "lifeEventType",
        "lifeEventPlace"
      ]),
      precision: Type.Literal("exact"),
      maximumResultCount: personQuestionMaximumResultCountSchema()
    }),
    strictObject({
      projectionId: Type.Literal("movement.aggregate.v1"),
      parameters: strictObject({
        granularity: literalUnion(["day", "week", "month"])
      }),
      interval: personQuestionIntervalSchema(),
      entityIds: personQuestionEntityIdsSchema(0),
      fields: personQuestionFieldsSchema([
        "movementDuration",
        "movementDistance"
      ]),
      precision: Type.Literal("exact"),
      maximumResultCount: personQuestionMaximumResultCountSchema()
    }),
    strictObject({
      projectionId: Type.Literal("custom.selected_entities.v1"),
      parameters: personQuestionEmptyParametersSchema(),
      interval: Type.Null(),
      entityIds: personQuestionEntityIdsSchema(256),
      fields: personQuestionFieldsSchema([
        "customTitle",
        "customSummary",
        "customState"
      ]),
      precision: Type.Literal("exact"),
      maximumResultCount: personQuestionMaximumResultCountSchema()
    })
  ]);
const personQuestionExecuteBodySchema = () =>
  strictObject({
    interpretationId: peoplePeerIdSchema(),
    interpretationHash: peoplePeerHashSchema(),
    query: personQuestionTypedQuerySchema(),
    sourcePreference: Type.Optional(
      literalUnion(["live_then_cache", "live_only", "cache_only"], {
        default: "live_then_cache"
      })
    )
  });
const personQuestionHistoryAgentQuerySchema = () =>
  strictObject({
    cursor: Type.Optional(peoplePeerCursorSchema()),
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 100, default: 50 })
    )
  });

function peoplePeerAgentRouteSpec(
  input: Omit<
    PeoplePeerAgentRouteSpec,
    "humanOnly" | "mcpExposed" | "requiresAgentToken"
  >
): PeoplePeerAgentRouteSpec {
  return {
    ...input,
    humanOnly: false,
    mcpExposed: true,
    requiresAgentToken: true
  };
}

export const PEOPLE_AGENT_ROUTE_SPECS = {
  listPeopleReadModel: peoplePeerAgentRouteSpec({
    operationId: "listPeopleReadModel",
    method: "GET",
    path: "/api/v1/people",
    principalClasses: ["operator_session", "agent_token"],
    requiredScopes: ["people:read:basic"],
    paramsSchema: peoplePeerEmptySchema(),
    querySchema: listPeopleAgentQuerySchema()
  }),
  getPersonContext: peoplePeerAgentRouteSpec({
    operationId: "getPersonContext",
    method: "GET",
    path: "/api/v1/people/:personId/context",
    principalClasses: ["operator_session", "agent_token"],
    requiredScopes: ["people:read:basic"],
    paramsSchema: personPathParamsSchema(),
    querySchema: personContextAgentQuerySchema()
  }),
  scanPeopleWikiCandidates: peoplePeerAgentRouteSpec({
    operationId: "scanPeopleWikiCandidates",
    method: "POST",
    path: "/api/v1/people/wiki-candidates/scan",
    principalClasses: ["operator_session", "agent_token"],
    requiredScopes: ["people:read:basic", "wiki:read"],
    paramsSchema: peoplePeerEmptySchema(),
    querySchema: peoplePeerEmptySchema(),
    bodySchema: peopleWikiCandidateScanBodySchema()
  }),
  previewPeopleWikiAssociations: peoplePeerAgentRouteSpec({
    operationId: "previewPeopleWikiAssociations",
    method: "POST",
    path: "/api/v1/people/wiki-associations/preview",
    principalClasses: ["operator_session", "agent_token"],
    requiredScopes: ["people:write", "wiki:read"],
    paramsSchema: peoplePeerEmptySchema(),
    querySchema: peoplePeerEmptySchema(),
    bodySchema: peopleWikiAssociationPreviewBodySchema()
  }),
  applyPeopleWikiAssociations: peoplePeerAgentRouteSpec({
    operationId: "applyPeopleWikiAssociations",
    method: "POST",
    path: "/api/v1/people/wiki-associations/apply",
    principalClasses: ["operator_session", "agent_token"],
    requiredScopes: ["people:write", "wiki:read"],
    paramsSchema: peoplePeerEmptySchema(),
    querySchema: peoplePeerEmptySchema(),
    bodySchema: peopleWikiAssociationApplyBodySchema()
  }),
  interpretPersonQuestion: peoplePeerAgentRouteSpec({
    operationId: "interpretPersonQuestion",
    method: "POST",
    path: "/api/v1/people/:personId/questions/interpret",
    principalClasses: ["operator_session", "agent_token"],
    requiredScopes: ["people:read:basic", "peer:query"],
    paramsSchema: personPathParamsSchema(),
    querySchema: peoplePeerEmptySchema(),
    bodySchema: personQuestionInterpretBodySchema()
  }),
  executePersonQuestion: peoplePeerAgentRouteSpec({
    operationId: "executePersonQuestion",
    method: "POST",
    path: "/api/v1/people/:personId/questions/execute",
    principalClasses: ["operator_session", "agent_token"],
    requiredScopes: ["people:read:basic", "peer:query"],
    paramsSchema: personPathParamsSchema(),
    querySchema: peoplePeerEmptySchema(),
    bodySchema: personQuestionExecuteBodySchema()
  }),
  listPersonQuestionHistory: peoplePeerAgentRouteSpec({
    operationId: "listPersonQuestionHistory",
    method: "GET",
    path: "/api/v1/people/:personId/questions",
    principalClasses: ["operator_session", "agent_token"],
    requiredScopes: ["people:read:basic", "peer:query"],
    paramsSchema: personPathParamsSchema(),
    querySchema: personQuestionHistoryAgentQuerySchema()
  })
} as const satisfies Record<string, PeoplePeerAgentRouteSpec>;

export const PEER_AGENT_ROUTE_SPECS = {
  listPeerRequests: peoplePeerAgentRouteSpec({
    operationId: "listPeerRequests",
    method: "GET",
    path: "/api/v1/peers/requests",
    principalClasses: ["operator_session", "agent_token", "companion_session"],
    requiredScopes: ["peer:status"],
    paramsSchema: peoplePeerEmptySchema(),
    querySchema: peerRequestsAgentQuerySchema()
  }),
  listPeerRelationships: peoplePeerAgentRouteSpec({
    operationId: "listPeerRelationships",
    method: "GET",
    path: "/api/v1/peers/relationships",
    principalClasses: ["operator_session", "agent_token", "companion_session"],
    requiredScopes: ["peer:status"],
    paramsSchema: peoplePeerEmptySchema(),
    querySchema: peerRelationshipsAgentQuerySchema()
  }),
  getPeerRelationship: peoplePeerAgentRouteSpec({
    operationId: "getPeerRelationship",
    method: "GET",
    path: "/api/v1/peers/relationships/:relationshipId",
    principalClasses: ["operator_session", "agent_token", "companion_session"],
    requiredScopes: ["peer:status"],
    paramsSchema: relationshipPathParamsSchema(),
    querySchema: peoplePeerEmptySchema()
  }),
  listPeerDevices: peoplePeerAgentRouteSpec({
    operationId: "listPeerDevices",
    method: "GET",
    path: "/api/v1/peers/relationships/:relationshipId/devices",
    principalClasses: ["operator_session", "agent_token", "companion_session"],
    requiredScopes: ["peer:status"],
    paramsSchema: relationshipPathParamsSchema(),
    querySchema: peoplePeerEmptySchema()
  }),
  listPeerGrants: peoplePeerAgentRouteSpec({
    operationId: "listPeerGrants",
    method: "GET",
    path: "/api/v1/peers/relationships/:relationshipId/grants",
    principalClasses: ["operator_session", "agent_token", "companion_session"],
    requiredScopes: ["peer:status"],
    paramsSchema: relationshipPathParamsSchema(),
    querySchema: peerGrantsAgentQuerySchema()
  }),
  getPeerSyncStatus: peoplePeerAgentRouteSpec({
    operationId: "getPeerSyncStatus",
    method: "GET",
    path: "/api/v1/peers/relationships/:relationshipId/sync",
    principalClasses: ["operator_session", "agent_token", "companion_session"],
    requiredScopes: ["peer:status"],
    paramsSchema: relationshipPathParamsSchema(),
    querySchema: peoplePeerEmptySchema()
  }),
  getPeerDiagnostics: peoplePeerAgentRouteSpec({
    operationId: "getPeerDiagnostics",
    method: "GET",
    path: "/api/v1/peers/relationships/:relationshipId/diagnostics",
    principalClasses: ["operator_session", "agent_token", "companion_session"],
    requiredScopes: ["peer:status"],
    paramsSchema: relationshipPathParamsSchema(),
    querySchema: peerDiagnosticsAgentQuerySchema()
  })
} as const satisfies Record<string, PeoplePeerAgentRouteSpec>;
const preferenceDomainInputSchema = () =>
  literalUnion([
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
  ]);
const optionalDeleteMode = () =>
  Type.Optional(Type.Union([Type.Literal("soft"), Type.Literal("hard")]));
const optionalBoolean = () => Type.Optional(Type.Boolean());
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
  replaceConnectionIds: Type.Optional(Type.Array(Type.String({ minLength: 1 })))
});
const healthLinkInputSchema = () =>
  Type.Object({
    entityType: Type.String({ minLength: 1 }),
    entityId: Type.String({ minLength: 1 }),
    relationshipType: Type.Optional(Type.String({ minLength: 1 }))
  });
const nutritionMealItemInputSchema = () =>
  Type.Object({
    id: optionalString(),
    foodId: Type.Optional(optionalNullableString()),
    name: Type.String({ minLength: 1 }),
    brand: optionalNullableString(),
    quantity: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    unit: optionalNullableString(),
    grams: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    calories: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    caloriesKcal: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    proteinGrams: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    proteinG: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    carbohydrateGrams: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    carbsG: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    fatGrams: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    fatG: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    fiberGrams: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    fiberG: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    sugarGrams: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    sugarG: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    sodiumMg: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    potassiumMg: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    caffeineMg: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    alcoholGrams: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    alcoholG: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    tags: Type.Optional(Type.Array(Type.String())),
    nutrients: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    confidence: Type.Optional(
      Type.Union([Type.Number({ minimum: 0, maximum: 1 }), Type.Null()])
    )
  });
const nutritionUserScopeSchema = () =>
  Type.Optional(Type.Array(Type.String({ minLength: 1 })));
const nutritionFoodLogSchema = () =>
  Type.Object({
    userIds: nutritionUserScopeSchema(),
    loggedAt: optionalString(),
    dayKey: Type.Optional(
      Type.Union([
        Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
        Type.Null()
      ])
    ),
    timeZone: optionalString(),
    mealLabel: optionalNullableString(),
    source: Type.Optional(
      Type.Union([
        Type.Literal("manual"),
        Type.Literal("search"),
        Type.Literal("barcode"),
        Type.Literal("chatgpt"),
        Type.Literal("photo"),
        Type.Literal("saved_meal")
      ])
    ),
    confirmationState: Type.Optional(
      Type.Union([
        Type.Literal("candidate"),
        Type.Literal("confirmed"),
        Type.Literal("needs_review"),
        Type.Literal("discarded")
      ])
    ),
    placeId: optionalNullableString(),
    stayId: optionalNullableString(),
    workoutId: optionalNullableString(),
    sleepId: optionalNullableString(),
    imageRefs: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    parserProvenance: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    links: Type.Optional(Type.Array(healthLinkInputSchema())),
    notes: optionalNullableString(),
    items: Type.Array(nutritionMealItemInputSchema(), { minItems: 1 })
  });
const nutritionFoodLogPatchSchema = () =>
  Type.Object(
    {
      foodLogId: Type.String({ minLength: 1 }),
      userIds: nutritionUserScopeSchema(),
      loggedAt: Type.Optional(Type.String({ format: "date-time" })),
      dayKey: Type.Optional(
        Type.Union([
          Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
          Type.Null()
        ])
      ),
      timeZone: optionalString(),
      mealLabel: optionalString(),
      source: Type.Optional(
        Type.Union([
          Type.Literal("manual"),
          Type.Literal("search"),
          Type.Literal("barcode"),
          Type.Literal("chatgpt"),
          Type.Literal("photo"),
          Type.Literal("saved_meal")
        ])
      ),
      confirmationState: Type.Optional(
        Type.Union([
          Type.Literal("candidate"),
          Type.Literal("confirmed"),
          Type.Literal("needs_review"),
          Type.Literal("discarded")
        ])
      ),
      notes: optionalString(),
      placeId: optionalNullableString(),
      stayId: optionalNullableString(),
      workoutId: optionalNullableString(),
      sleepId: optionalNullableString(),
      imageRefs: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      parserProvenance: Type.Optional(
        Type.Record(Type.String(), Type.Unknown())
      ),
      links: Type.Optional(Type.Array(healthLinkInputSchema())),
      items: Type.Optional(
        Type.Array(nutritionMealItemInputSchema(), { minItems: 1 })
      )
    },
    {
      additionalProperties: false
    }
  );
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

const taskCloseoutLimits = {
  workSummaryLength: 8_000,
  modifiedFiles: 256,
  modifiedFileLength: 512,
  linkedGitRefIds: 64,
  gitRefs: 64,
  gitRefIdLength: 128,
  gitProviderLength: 64,
  gitRepositoryLength: 255,
  gitRefValueLength: 512,
  gitUrlLength: 2_048,
  gitDisplayTitleLength: 512
} as const;

const completionReportInputSchema = () =>
  strictObject({
    modifiedFiles: Type.Optional(
      Type.Array(
        Type.String({
          minLength: 1,
          maxLength: taskCloseoutLimits.modifiedFileLength,
          description: "Safe repository-relative path without traversal."
        }),
        {
          maxItems: taskCloseoutLimits.modifiedFiles,
          uniqueItems: true
        }
      )
    ),
    workSummary: Type.Optional(
      Type.String({
        maxLength: taskCloseoutLimits.workSummaryLength,
        default: ""
      })
    ),
    linkedGitRefIds: Type.Optional(
      Type.Array(
        Type.String({
          minLength: 1,
          maxLength: taskCloseoutLimits.gitRefIdLength
        }),
        {
          maxItems: taskCloseoutLimits.linkedGitRefIds,
          uniqueItems: true
        }
      )
    )
  });

const workItemGitRefInputSchema = () =>
  strictObject({
    id: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: taskCloseoutLimits.gitRefIdLength,
        pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"
      })
    ),
    refType: Type.Union([
      Type.Literal("commit"),
      Type.Literal("branch"),
      Type.Literal("pull_request")
    ]),
    provider: Type.Optional(
      Type.String({
        maxLength: taskCloseoutLimits.gitProviderLength,
        default: "git"
      })
    ),
    repository: Type.Optional(
      Type.String({
        maxLength: taskCloseoutLimits.gitRepositoryLength,
        default: ""
      })
    ),
    refValue: Type.String({
      minLength: 1,
      maxLength: taskCloseoutLimits.gitRefValueLength
    }),
    url: Type.Optional(
      Type.Union([
        Type.String({
          format: "uri",
          pattern: "^https?://",
          maxLength: taskCloseoutLimits.gitUrlLength
        }),
        Type.Null()
      ])
    ),
    displayTitle: Type.Optional(
      Type.String({
        maxLength: taskCloseoutLimits.gitDisplayTitleLength,
        default: ""
      })
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
  return search.size > 0
    ? `${path}${path.includes("?") ? "&" : "?"}${search.toString()}`
    : path;
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

function buildRouteKeySchema(routeSpecs: Record<string, SpecializedRouteSpec>) {
  const routeGuide = Object.entries(routeSpecs)
    .map(([routeKey, spec]) => `${routeKey}: ${spec.method} ${spec.path}`)
    .join("; ");
  return Type.Union(
    Object.keys(routeSpecs).map((routeKey) => Type.Literal(routeKey)) as [
      ReturnType<typeof Type.Literal>,
      ReturnType<typeof Type.Literal>,
      ...Array<ReturnType<typeof Type.Literal>>
    ],
    {
      description: `Dedicated route key. Exact routes: ${routeGuide}. For any :placeholder shown in a route, fill pathParams with that exact placeholder name; do not put raw paths or ids into routeKey.`
    }
  );
}

function specializedRouteParametersSchema(
  routeSpecs: Record<string, SpecializedRouteSpec>
) {
  return Type.Object({
    routeKey: buildRouteKeySchema(routeSpecs),
    pathParams: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description:
          "Path parameters required by the selected route key. Use the exact :placeholder names shown in the routeKey description, such as id, weekday, slug, runId, nodeId, or pointId."
      })
    ),
    query: Type.Optional(
      Type.Record(Type.String(), Type.Any(), {
        description:
          "Optional query parameters for the selected dedicated route."
      })
    ),
    body: Type.Optional(
      Type.Any({
        description:
          "JSON body for POST, PATCH, and PUT route keys. Omit for GET and DELETE route keys."
      })
    )
  });
}

function peoplePeerRouteParametersSchema(
  routeSpecs: Record<string, PeoplePeerAgentRouteSpec>
) {
  const variants = Object.values(routeSpecs).map((spec) => {
    const contract = `${spec.operationId}: ${spec.method} ${spec.path}; scopes: ${spec.requiredScopes.join(", ")}; principals: ${spec.principalClasses.join(", ")}.`;
    const properties: TProperties = {
      routeKey: Type.Literal(spec.operationId, { description: contract })
    };
    if (Object.keys(spec.paramsSchema.properties).length > 0) {
      properties.pathParams = spec.paramsSchema;
    }
    if (Object.keys(spec.querySchema.properties).length > 0) {
      properties.query = Type.Optional(spec.querySchema);
    }
    if (spec.bodySchema) {
      properties.body = spec.bodySchema;
    }
    return strictObject(properties);
  });
  return Type.Union(variants as unknown as [TSchema, TSchema, ...TSchema[]], {
    description:
      "Choose one published MCP operation id. Each variant fixes the exact method, path parameters, query fields, JSON body, principal classes, and local token scopes accepted by Forge."
  });
}

function appendAnyQueryParams(path: string, query: unknown) {
  if (!query || typeof query !== "object") {
    return path;
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (value === null || value === undefined) {
      continue;
    }
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item === null || item === undefined) {
        continue;
      }
      search.append(key, String(item));
    }
  }
  return search.size > 0 ? `${path}?${search.toString()}` : path;
}

function resolveRouteTemplate(
  template: string,
  pathParams: Record<string, unknown> = {}
) {
  return template.replace(/:([A-Za-z0-9_]+)/g, (_match, key) => {
    const value = pathParams[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Missing pathParams.${key} for ${template}.`);
    }
    return encodeURIComponent(value.trim());
  });
}

async function callSpecializedRoute(
  config: ForgePluginConfig,
  routeSpecs: Record<string, SpecializedRouteSpec>,
  params: Record<string, unknown>
) {
  const routeKey = normalizeText(params.routeKey);
  const spec = routeSpecs[routeKey];
  if (!spec) {
    throw new Error(`Unknown specialized Forge route key: ${routeKey}`);
  }
  if (spec.requiresAgentToken && config.apiToken.trim().length === 0) {
    throw new Error(
      "People and peer-sharing agent tools require a configured Forge agent token with the route's published local scopes; an operator session cannot substitute for that token."
    );
  }
  if (spec.requiresToken && !spec.requiresAgentToken) {
    requireApiToken(config);
  }
  const path = appendAnyQueryParams(
    resolveRouteTemplate(
      spec.path,
      (params.pathParams ?? {}) as Record<string, unknown>
    ),
    params.query
  );
  const body =
    spec.method === "GET" || spec.method === "DELETE"
      ? undefined
      : (params.body ?? {});
  return expectForgeSuccess(
    await callConfiguredForgeApi(config, {
      method: spec.method,
      path,
      body
    })
  );
}

function registerPeoplePeerRouteTool(
  api: ForgePluginToolApi,
  config: ForgePluginConfig,
  options: {
    name: string;
    label: string;
    description: string;
    routeSpecs: Record<string, PeoplePeerAgentRouteSpec>;
  }
) {
  api.registerTool({
    name: options.name,
    label: options.label,
    description: options.description,
    parameters: peoplePeerRouteParametersSchema(options.routeSpecs),
    async execute(_toolCallId, params) {
      return jsonResult(
        await callSpecializedRoute(
          config,
          options.routeSpecs,
          (params ?? {}) as Record<string, unknown>
        )
      );
    }
  });
}

function registerSpecializedRouteTool(
  api: ForgePluginToolApi,
  config: ForgePluginConfig,
  options: {
    name: string;
    label: string;
    description: string;
    routeSpecs: Record<string, SpecializedRouteSpec>;
  }
) {
  api.registerTool({
    name: options.name,
    label: options.label,
    description: options.description,
    parameters: specializedRouteParametersSchema(options.routeSpecs),
    async execute(_toolCallId, params) {
      return jsonResult(
        await callSpecializedRoute(
          config,
          options.routeSpecs,
          (params ?? {}) as Record<string, unknown>
        )
      );
    }
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

function registerReadBodyTool<T extends TObject<TProperties>>(
  api: ForgePluginToolApi,
  config: ForgePluginConfig,
  options: {
    name: string;
    label: string;
    description: string;
    parameters: T;
    path: string;
  }
) {
  api.registerTool({
    name: options.name,
    label: options.label,
    description: options.description,
    parameters: options.parameters,
    async execute(_toolCallId, params) {
      return jsonResult(
        await runReadBody(config, {
          path: options.path,
          body: params ?? {}
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
      "Start here for most Forge work. Read the compact progressive overview with current priorities, today/yesterday context, health, calendar, psyche signals, note previews, IDs, and drill-down routes before searching or mutating.",
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
    name: "forge_get_doctor",
    label: "Forge Doctor",
    description:
      "Run Forge Doctor diagnostics for runtime health, settings, SQLite storage, entity links, hierarchy consistency, rewards, gamification state, and proposed fixes.",
    path: () => "/api/v1/doctor"
  });

  registerWriteTool(api, config, {
    name: "forge_apply_doctor_fix",
    label: "Apply Forge Doctor Fix",
    description:
      "Apply explicitly approved Forge Doctor safe fixes. Do not call this unless the user has approved the specific fix id or asked for Doctor autofix.",
    parameters: Type.Object({
      fixIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      applyAllSafe: Type.Optional(Type.Boolean())
    }),
    method: "POST",
    path: "/api/v1/doctor/fixes"
  });

  registerSpecializedRouteTool(api, config, {
    name: "forge_call_attention_route",
    label: "Forge Attention Route",
    description:
      "Call one allowed dedicated Attention route to list the current actor's bounded queue or snooze, dismiss, and restore an eligible item. Use the stable item id returned by list through pathParams.id. Do not invent attention records or use batch CRUD for this derived queue.",
    routeSpecs: attentionRouteSpecs
  });

  registerSpecializedRouteTool(api, config, {
    name: "forge_call_entity_navigation_route",
    label: "Forge Entity Navigation Route",
    description:
      "Call the dedicated Entity Navigation list or touch route. List returns bounded canonical pins and this agent's own recent records. Touch records that this agent viewed an existing in-scope record. Human pin and unpin operations are intentionally unavailable to agents.",
    routeSpecs: entityNavigationRouteSpecs
  });

  registerSpecializedRouteTool(api, config, {
    name: "forge_call_calendar_connection_route",
    label: "Forge Calendar Connection Route",
    description:
      "Call one allowed dedicated Calendar Connection lifecycle route for list, provider discovery, macOS-local discovery, rediscovery, create, selected-calendar update, sync, or delete. Read the current connection first for existing-record changes and do not use batch CRUD for calendar connections.",
    routeSpecs: calendarConnectionRouteSpecs
  });

  registerSpecializedRouteTool(api, config, {
    name: "forge_call_wiki_route",
    label: "Forge Wiki Route",
    description:
      "Call one allowed dedicated Wiki lifecycle route for list, search, create, id or slug read, update, delete, health, sync, reindex, or ingest. Read the exact page before existing-page changes and do not use batch CRUD for wiki pages.",
    routeSpecs: wikiRouteSpecs
  });

  registerSpecializedRouteTool(api, config, {
    name: "forge_call_movement_route",
    label: "Forge Movement Route",
    description:
      "Call one allowed dedicated Movement route after the conversation has narrowed to day, month, all-time, timeline, place, trip detail, selection aggregate, overlay, or repair work. Do not use this for normal stored entities; those stay on batch CRUD.",
    routeSpecs: movementRouteSpecs
  });

  registerSpecializedRouteTool(api, config, {
    name: "forge_call_life_force_route",
    label: "Forge Life Force Route",
    description:
      "Call one allowed dedicated Life Force route after the conversation has narrowed to overview, profile update, weekday template, or fatigue signal. Do not use batch CRUD for Life Force.",
    routeSpecs: lifeForceRouteSpecs
  });

  registerSpecializedRouteTool(api, config, {
    name: "forge_call_workbench_route",
    label: "Forge Workbench Route",
    description:
      "Call one allowed dedicated Workbench route after the conversation has narrowed to flow catalog, flow CRUD, execution, run history, published output, node result, or latest node output. Flow and box catalogs are bounded pages: start with limit 24, use their published q and repeated facet filters, and continue with offset only while hasMore is true. Workbench exposes enabled or disabled endpoint state, not includeArchived. Do not use batch CRUD for Workbench.",
    routeSpecs: workbenchRouteSpecs
  });

  registerSpecializedRouteTool(api, config, {
    name: "forge_call_course_route",
    label: "Forge Course Route",
    description:
      "Call one allowed dedicated Course or Concept route after the conversation has narrowed to installed-course discovery, progress or syllabus detail, a learner-safe visual or voice lesson session, one activity attempt, an explicit enrollment upgrade, validated package import/export, concept search, due review, or cross-course mastery evidence. For voice learning, start voiceLearningSession with the chosen week and day, teach its learner-safe blocks in source order one manageable block at a time, and use the exact returned course, lesson, and activity identifiers. Before submitAttempt, add punctuation and paragraph breaks without changing Albert's words. Show him every proposed deletion, replacement, uncertain mathematical symbol, or uncertain recognition and obtain explicit confirmation; then read the entire formatted answer back and obtain final explicit confirmation. Submit only answerMarkdown with deliveryMode voice, the current voiceSessionToken, voiceConfirmation true, and one stable idempotencyKey. Never send audio, recording metadata, or a separate voice transcript. Use returned feedback and progress to choose the next teaching block. Before upgradeEnrollment, read the exact course release state, explain what changes and which passed evidence can carry forward, and obtain the learner's explicit choice. Do not use batch CRUD for Course or Concept.",
    routeSpecs: courseRouteSpecs
  });

  registerSpecializedRouteTool(api, config, {
    name: "forge_call_artifact_route",
    label: "Forge Artifact Route",
    description:
      "Call one allowed dedicated Artifact Store route for paged metadata listing with limit/offset, trusted upload, metadata update, static rescan, LLM metadata enrichment, generic entity-link replacement, trust state, versions, or audit. For createWithBytes, put one stable per-file idempotencyKey in the body and reuse it only for an exact transport retry; Forge normalizes agent provenance and rejects changed-payload key reuse. Use shared batch CRUD for artifact metadata delete/restore. Agents may read contentProtection metadata and password hints, but must not receive, store, submit, or route artifact passwords. Do not expose download, password download, decrypt, open, execute, preview, or transform stored file bytes as an agent.",
    routeSpecs: artifactRouteSpecs
  });

  registerSpecializedRouteTool(api, config, {
    name: "forge_call_life_event_route",
    label: "Forge Life Event Route",
    description:
      "Call one allowed dedicated Life Events route for timeline reads, one-event reads, calendar linking or creation, marking a calendar event as a Life Event, ticket artifact import, or travel-status reads. Use shared batch CRUD for normal stored life_event create, update, delete, restore, and search. Use generic entity_links for relationships.",
    routeSpecs: lifeEventRouteSpecs
  });

  registerPeoplePeerRouteTool(api, config, {
    name: "forge_call_people_route",
    label: "Forge People Route",
    description:
      "Call one MCP-exposed People read or reviewed Wiki-association operation, or interpret, execute, and review a typed question against an existing directional grant. Person create, search, update, soft delete, restore, and general links stay on shared batch CRUD. Every call requires a configured agent token with the published People, Wiki, or peer-query scopes. For typed answers preserve result.state plus metadata source, freshness, precision, completeness, and redactedFields; never infer withheld fields. Agents cannot pair Forge installations or change consent, grants, devices, credentials, or human-presence approvals.",
    routeSpecs: PEOPLE_AGENT_ROUTE_SPECS
  });

  registerPeoplePeerRouteTool(api, config, {
    name: "forge_call_peer_route",
    label: "Forge Peer Status And Query Route",
    description:
      "Call one MCP-exposed peer request, relationship, device, grant, sync-status, or diagnostic operation using an existing human-approved relationship. Every call requires a configured agent token with peer:status. This tool cannot create or accept pairing, request a resync, widen or revoke consent, accept or counter grants, approve or remove devices, manage credentials, or perform a human-presence ceremony.",
    routeSpecs: PEER_AGENT_ROUTE_SPECS
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
    name: "forge_get_psyche_schema_catalog",
    label: "Forge Psyche Schema Catalog",
    description:
      "Read the read-only Psyche schema catalog before linking a belief_entry to schemaId or discussing a schema theme. Schema catalog entries are reference concepts, not user-owned belief records.",
    path: () => "/api/v1/psyche/schema-catalog"
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
    label: "KarpaWiki Settings",
    description:
      "Read the current wiki spaces plus enabled LLM and embedding profiles before search, ingest, or page writes.",
    path: () => "/api/v1/wiki/settings"
  });

  registerReadTool(api, config, {
    name: "forge_list_wiki_pages",
    label: "Forge List Wiki Pages",
    description:
      "List compact wiki or evidence page summaries inside one space with bounded offset pagination.",
    parameters: Type.Object({
      spaceId: optionalString(),
      kind: Type.Optional(
        Type.Union([Type.Literal("wiki"), Type.Literal("evidence")])
      ),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 9999 }))
    }),
    path: (params) =>
      withQueryParams("/api/v1/wiki/pages", params as Record<string, unknown>, [
        "spaceId",
        "kind",
        "limit",
        "offset"
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
    label: "KarpaWiki Health",
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

  registerReadBodyTool(api, config, {
    name: "forge_search_wiki",
    label: "Forge Search Wiki",
    description:
      "Search compact wiki page summaries with ranked title, alias, content, entity, or semantic matches and bounded offset pagination.",
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
      query: Type.Optional(Type.String({ maxLength: 500 })),
      profileId: optionalString(),
      linkedEntity: Type.Optional(
        Type.Object({
          entityType: Type.String({ minLength: 1 }),
          entityId: Type.String({ minLength: 1 })
        })
      ),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 999 }))
    }),
    path: "/api/v1/wiki/search"
  });

  api.registerTool({
    name: "forge_upsert_wiki_page",
    label: "Forge Upsert Wiki Page",
    description:
      "Create a new wiki page or update an existing one through the SQLite-backed wiki surface.",
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
    label: "Forge Refresh Wiki Indexes",
    description: "Rebuild SQLite wiki search, link, and metadata indexes.",
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
    name: "forge_get_today_priority",
    label: "Forge Today Priority",
    description:
      "Read Forge's canonical deterministic decision for the next useful work, including active-run conflicts, task-timebox timing, Life Force capacity, ranked alternatives, and explicit no-work or overload states.",
    parameters: todayPriorityReadSchema,
    path: (params) =>
      withQueryParams("/api/v1/today/priority", params, [
        "userIds",
        "timeZone",
        "candidateLimit"
      ])
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
      "Read the compact sports overview with training volume, workout-type comparisons, energy and load coverage, and effort signals. Use workout_session search or detail reads when individual sessions are needed.",
    parameters: scopedReadSchema,
    path: (params) =>
      withUserIds(
        "/api/v1/health/fitness?compact=1",
        params.userIds as string[] | undefined
      )
  });

  registerReadTool(api, config, {
    name: "forge_get_training_load_overview",
    label: "Forge Training Load Overview",
    description:
      "Read the cardiovascular training-load surface with acute/chronic load, HR zone-time buckets, smart training modes, weekly targets, next-workout guidance, and data-quality flags.",
    parameters: scopedReadSchema,
    path: (params) =>
      withUserIds(
        "/api/v1/health/training-load",
        params.userIds as string[] | undefined
      )
  });

  registerReadTool(api, config, {
    name: "forge_get_weight_loss_overview",
    label: "Forge Weight Loss Overview",
    description:
      "Read the weight-loss and nutrition insight surface with calorie ledger, protein/fiber targets, energy balance, body trend, subjective energy, gut comfort, aesthetic check-ins, hypotheses, experiments, and data-quality flags.",
    parameters: scopedReadSchema,
    path: (params) =>
      withUserIds(
        "/api/v1/health/weight-loss",
        params.userIds as string[] | undefined
      )
  });

  api.registerTool({
    name: "forge_search_nutrition_foods",
    label: "Forge Search Nutrition Foods",
    description:
      "Search local, Open Food Facts, and USDA-backed nutrition foods before logging a concrete food item.",
    parameters: Type.Object({
      userIds: nutritionUserScopeSchema(),
      query: Type.String({ minLength: 1 }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 }))
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: withUserIds(
            "/api/v1/health/weight-loss/foods/search",
            typed.userIds as string[] | undefined
          ),
          body: { query: typed.query, limit: typed.limit }
        })
      );
    }
  });

  api.registerTool({
    name: "forge_search_foods",
    label: "Forge Search Foods",
    description:
      "Search local, Open Food Facts, and USDA-backed nutrition foods before logging a concrete food item. This is the short alias for forge_search_nutrition_foods.",
    parameters: Type.Object({
      userIds: nutritionUserScopeSchema(),
      query: Type.String({ minLength: 1 }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 }))
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: withUserIds(
            "/api/v1/health/weight-loss/foods/search",
            typed.userIds as string[] | undefined
          ),
          body: { query: typed.query, limit: typed.limit }
        })
      );
    }
  });

  api.registerTool({
    name: "forge_lookup_nutrition_barcode",
    label: "Forge Lookup Nutrition Barcode",
    description:
      "Lookup a packaged food by barcode through Forge's nutrition catalog adapters.",
    parameters: Type.Object({
      userIds: nutritionUserScopeSchema(),
      barcode: Type.String({ minLength: 1 })
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: withUserIds(
            "/api/v1/health/weight-loss/foods/barcode",
            typed.userIds as string[] | undefined
          ),
          body: { barcode: typed.barcode }
        })
      );
    }
  });

  api.registerTool({
    name: "forge_log_food",
    label: "Forge Log Food",
    description:
      "Create a confirmed or candidate food log. Search first and pass foodId when reusing a catalog food; for custom foods without foodId, caloriesKcal, proteinG, carbsG, and fatG are required.",
    parameters: nutritionFoodLogSchema(),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      const body = omitToolFields(typed, ["userIds"]);
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: withUserIds(
            "/api/v1/health/weight-loss/food-logs",
            typed.userIds as string[] | undefined
          ),
          body
        })
      );
    }
  });

  api.registerTool({
    name: "forge_update_food_log",
    label: "Forge Update Food Log",
    description:
      "Edit one existing nutrition food log by its exact foodLogId. Read the weight-loss overview first to identify the intended log, then send only the fields that should change.",
    parameters: nutritionFoodLogPatchSchema(),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      const foodLogId = normalizeText(typed.foodLogId);
      if (!foodLogId) {
        throw new Error(
          "forge_update_food_log requires a non-empty foodLogId."
        );
      }
      const body = omitToolFields(typed, ["foodLogId", "userIds"]);
      return jsonResult(
        await runWrite(config, {
          method: "PATCH",
          path: withUserIds(
            `/api/v1/health/weight-loss/food-logs/${encodeURIComponent(foodLogId)}`,
            typed.userIds as string[] | undefined
          ),
          body
        })
      );
    }
  });

  api.registerTool({
    name: "forge_parse_food_log_with_chatgpt",
    label: "Forge Parse Food Log With ChatGPT",
    description:
      "Use Forge's openai-codex ChatGPT subscription connection to parse natural-language food text or a photo description into a candidate nutrition log. This must not use the metered OpenAI API.",
    parameters: Type.Object({
      userIds: nutritionUserScopeSchema(),
      text: optionalString(),
      imageDescription: optionalString(),
      loggedAt: optionalString(),
      mealLabel: optionalString()
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: withUserIds(
            "/api/v1/health/weight-loss/parse",
            typed.userIds as string[] | undefined
          ),
          body: {
            text: typed.text,
            imageDescription: typed.imageDescription,
            loggedAt: typed.loggedAt,
            mealLabel: typed.mealLabel
          }
        })
      );
    }
  });

  api.registerTool({
    name: "forge_log_body_checkin",
    label: "Forge Log Body Check-In",
    description:
      "Record body-composition check-ins such as weight, waist, hip, neck, body-fat estimate, and notes for trend calculations.",
    parameters: Type.Object({
      userIds: nutritionUserScopeSchema(),
      checkedAt: optionalString(),
      weightKg: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      waistCm: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      hipCm: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      neckCm: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      chestCm: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      armCm: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      thighCm: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      bodyFatPercent: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      clothingFitScore: Type.Optional(
        Type.Union([Type.Number({ minimum: 0, maximum: 10 }), Type.Null()])
      ),
      notes: optionalNullableString()
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      const body = omitToolFields(typed, ["userIds"]);
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: withUserIds(
            "/api/v1/health/weight-loss/body-checkins",
            typed.userIds as string[] | undefined
          ),
          body
        })
      );
    }
  });

  api.registerTool({
    name: "forge_log_appearance_checkin",
    label: "Forge Log Appearance Check-In",
    description:
      "Record aesthetic-look metrics such as muscle fullness, leanness, vascularity, face puffiness, visual bloat, posture confidence, outfit fit, and overall aesthetic score.",
    parameters: Type.Object({
      userIds: nutritionUserScopeSchema(),
      checkedAt: optionalString(),
      photoRefs: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      facePuffiness: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      leanness: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      muscularity: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      posture: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      bloatingLook: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      confidenceScore: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      notes: optionalNullableString()
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      const body = omitToolFields(typed, ["userIds"]);
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: withUserIds(
            "/api/v1/health/weight-loss/appearance-checkins",
            typed.userIds as string[] | undefined
          ),
          body
        })
      );
    }
  });

  api.registerTool({
    name: "forge_log_subjective_food_effect",
    label: "Forge Log Subjective Food Effect",
    description:
      "Record subjective food-effect metrics such as energy, mood, focus, libido, sleepiness, soreness, stress, hunger, cravings, and workout performance.",
    parameters: Type.Object({
      userIds: nutritionUserScopeSchema(),
      checkedAt: optionalString(),
      mealLogId: optionalNullableString(),
      timeRelation: Type.Optional(
        Type.Union([
          Type.Literal("before_meal"),
          Type.Literal("with_meal"),
          Type.Literal("after_2h"),
          Type.Literal("end_of_day"),
          Type.Literal("unspecified")
        ])
      ),
      hunger: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      fullness: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      cravings: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      mood: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      energy: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      focus: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      stress: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      sleepiness: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      crashScore: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      notes: optionalNullableString()
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      const body = omitToolFields(typed, ["userIds"]);
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: withUserIds(
            "/api/v1/health/weight-loss/subjective-checkins",
            typed.userIds as string[] | undefined
          ),
          body
        })
      );
    }
  });

  api.registerTool({
    name: "forge_log_gut_checkin",
    label: "Forge Log Gut Check-In",
    description:
      "Record gut-health food-effect metrics such as bloating, abdominal pain, gas, reflux, nausea, stool type, stool frequency, and suspected triggers.",
    parameters: Type.Object({
      userIds: nutritionUserScopeSchema(),
      checkedAt: optionalString(),
      bloating: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      abdominalPain: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      gas: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      reflux: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      nausea: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      mealLogId: optionalNullableString(),
      bristolStoolType: Type.Optional(
        Type.Union([Type.Integer({ minimum: 1, maximum: 7 }), Type.Null()])
      ),
      stoolFrequency: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      urgency: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      constipation: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      diarrhea: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      triggerTags: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      notes: optionalNullableString()
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      const body = omitToolFields(typed, ["userIds"]);
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: withUserIds(
            "/api/v1/health/weight-loss/gut-checkins",
            typed.userIds as string[] | undefined
          ),
          body
        })
      );
    }
  });

  registerReadTool(api, config, {
    name: "forge_get_nutrition_patterns",
    label: "Forge Nutrition Patterns",
    description:
      "Read current food-effect hypotheses and nutrition experiments, including links between meals, sport fueling, energy, gut comfort, cravings, and aesthetic look.",
    parameters: scopedReadSchema,
    path: (params) =>
      withUserIds(
        "/api/v1/health/weight-loss/patterns",
        params.userIds as string[] | undefined
      )
  });

  api.registerTool({
    name: "forge_start_nutrition_experiment",
    label: "Forge Start Nutrition Experiment",
    description:
      "Create a structured N-of-1 nutrition experiment, such as carb timing, caffeine timing, low-FODMAP trial, sodium/puffiness test, fiber ramp, or pre-training fueling.",
    parameters: Type.Object({
      userIds: nutritionUserScopeSchema(),
      title: Type.String({ minLength: 1 }),
      hypothesis: Type.String({ minLength: 1 }),
      metricKey: Type.String({ minLength: 1 }),
      intervention: Type.String({ minLength: 1 }),
      baselineStart: optionalNullableString(),
      baselineEnd: optionalNullableString(),
      experimentStart: optionalNullableString(),
      experimentEnd: optionalNullableString(),
      status: Type.Optional(
        Type.Union([
          Type.Literal("planned"),
          Type.Literal("running"),
          Type.Literal("paused"),
          Type.Literal("completed"),
          Type.Literal("abandoned")
        ])
      ),
      successCriteria: optionalNullableString(),
      confounders: Type.Optional(Type.Array(Type.String()))
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      const body = omitToolFields(typed, ["userIds"]);
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: withUserIds(
            "/api/v1/health/weight-loss/experiments",
            typed.userIds as string[] | undefined
          ),
          body
        })
      );
    }
  });

  api.registerTool({
    name: "forge_update_nutrition_experiment",
    label: "Forge Update Nutrition Experiment",
    description:
      "Patch a nutrition experiment's status, dates, success criteria, intervention, hypothesis, or conclusion after new evidence arrives.",
    parameters: Type.Object({
      userIds: nutritionUserScopeSchema(),
      experimentId: Type.String({ minLength: 1 }),
      title: optionalString(),
      hypothesis: optionalString(),
      metricKey: optionalString(),
      intervention: optionalString(),
      baselineStart: optionalNullableString(),
      baselineEnd: optionalNullableString(),
      experimentStart: optionalNullableString(),
      experimentEnd: optionalNullableString(),
      status: Type.Optional(
        Type.Union([
          Type.Literal("planned"),
          Type.Literal("running"),
          Type.Literal("paused"),
          Type.Literal("completed"),
          Type.Literal("abandoned")
        ])
      ),
      successCriteria: optionalNullableString(),
      confounders: Type.Optional(Type.Array(Type.String())),
      conclusion: optionalNullableString()
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      const body = omitToolFields(typed, ["userIds", "experimentId"]);
      return jsonResult(
        await runWrite(config, {
          method: "PATCH",
          path: withUserIds(
            `/api/v1/health/weight-loss/experiments/${typed.experimentId as string}`,
            typed.userIds as string[] | undefined
          ),
          body
        })
      );
    }
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
      domain: Type.Optional(preferenceDomainInputSchema()),
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
      domain: preferenceDomainInputSchema(),
      contextId: optionalString(),
      catalogId: optionalString()
    }),
    method: "POST",
    path: "/api/v1/preferences/game/start"
  });

  registerWriteTool(api, config, {
    name: "forge_merge_preferences_contexts",
    label: "Forge Merge Preferences Contexts",
    description:
      "Merge one source preference context into one target context after reviewing both contexts and confirming that their distinction is no longer useful.",
    parameters: Type.Object({
      sourceContextId: Type.String({ minLength: 1 }),
      targetContextId: Type.String({ minLength: 1 })
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
      domain: preferenceDomainInputSchema(),
      entityType: Type.String({ minLength: 1 }),
      entityId: Type.String({ minLength: 1 }),
      label: optionalString(),
      description: optionalString(),
      tags: Type.Optional(Type.Array(Type.String({ minLength: 1 })))
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
      userId: Type.String({ minLength: 1 }),
      domain: preferenceDomainInputSchema(),
      contextId: Type.String({ minLength: 1 }),
      leftItemId: Type.String({ minLength: 1 }),
      rightItemId: Type.String({ minLength: 1 }),
      outcome: literalUnion(["left", "right", "tie", "skip"]),
      strength: Type.Optional(Type.Number({ minimum: 0.5, maximum: 2 })),
      responseTimeMs: Type.Optional(
        Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])
      ),
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
      userId: Type.String({ minLength: 1 }),
      domain: preferenceDomainInputSchema(),
      contextId: Type.String({ minLength: 1 }),
      itemId: Type.String({ minLength: 1 }),
      signalType: literalUnion([
        "favorite",
        "veto",
        "must_have",
        "bookmark",
        "neutral",
        "compare_later"
      ]),
      strength: Type.Optional(Type.Number({ minimum: 0.5, maximum: 2 }))
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
      userId: Type.String({ minLength: 1 }),
      domain: preferenceDomainInputSchema(),
      contextId: Type.String({ minLength: 1 }),
      manualStatus: Type.Optional(
        Type.Union([
          Type.Literal("liked"),
          Type.Literal("disliked"),
          Type.Literal("uncertain"),
          Type.Literal("vetoed"),
          Type.Literal("bookmarked"),
          Type.Literal("favorite"),
          Type.Literal("must_have"),
          Type.Literal("neutral"),
          Type.Null()
        ])
      ),
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
            userId: typed.userId,
            domain: typed.domain,
            contextId: typed.contextId,
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
    description: "Start one questionnaire answer session for a specific user.",
    parameters: Type.Object({
      questionnaireId: Type.String({ minLength: 1 }),
      userId: Type.String({ minLength: 1 }),
      versionId: optionalNullableString()
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: `/api/v1/psyche/questionnaires/${typed.questionnaireId as string}/runs`,
          body: {
            userId: typed.userId,
            versionId: typed.versionId
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
      answers: Type.Optional(
        Type.Array(
          Type.Object({
            itemId: Type.String({ minLength: 1 }),
            optionKey: optionalNullableString(),
            valueText: optionalString(),
            numericValue: Type.Optional(
              Type.Union([Type.Number(), Type.Null()])
            ),
            answer: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
          })
        )
      ),
      progressIndex: Type.Optional(
        Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])
      )
    }),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runWrite(config, {
          method: "PATCH",
          path: `/api/v1/psyche/questionnaire-runs/${typed.runId as string}`,
          body: {
            answers: typed.answers,
            progressIndex: typed.progressIndex
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
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
          clientRef: optionalString()
        }),
        { minItems: 1, maxItems: 50 }
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
          idempotencyKey: Type.Optional(
            Type.String({ minLength: 1, maxLength: 128 })
          ),
          clientRef: optionalString()
        }),
        { minItems: 1, maxItems: 100 }
      )
    }),
    method: "POST",
    path: "/api/v1/entities/create"
  });

  registerWriteTool(api, config, {
    name: "forge_update_entities",
    label: "Update Forge Entities",
    description:
      "Update one or more Forge entities through the ordered batch workflow. Pass `operations` as an array. Each operation must include `entityType`, `id`, and `patch`. This is the preferred update path for calendar_event, work_block_template, task_timebox, preferences basic CRUD entities, questionnaire_instrument, and official habit outcome logging through `habit.patch.checkIn`.",
    parameters: Type.Object({
      atomic: Type.Optional(Type.Boolean()),
      operations: Type.Array(
        Type.Object({
          entityType: Type.String({ minLength: 1 }),
          id: Type.String({ minLength: 1 }),
          patch: Type.Record(Type.String(), Type.Any()),
          clientRef: optionalString()
        }),
        { minItems: 1, maxItems: 100 }
      )
    }),
    method: "POST",
    path: "/api/v1/entities/update"
  });

  registerWriteTool(api, config, {
    name: "forge_delete_entities",
    label: "Delete Forge Entities",
    description:
      "Delete Forge entities in one batch request. Pass `operations` as an array with `entityType` and `id`. Delete defaults to soft mode unless hard is requested explicitly. preference_catalog and preference_catalog_item use reversible soft deletion and forge_restore_entities; preference_context, preference_item, calendar-domain records, and questionnaire_instrument retain immediate deletion.",
    parameters: Type.Object({
      atomic: Type.Optional(Type.Boolean()),
      operations: Type.Array(
        Type.Object({
          entityType: Type.String({ minLength: 1 }),
          id: Type.String({ minLength: 1 }),
          mode: optionalDeleteMode(),
          reason: optionalString(),
          clientRef: optionalString()
        }),
        { minItems: 1, maxItems: 100 }
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
        }),
        { minItems: 1, maxItems: 100 }
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
      const typed = normalizeTaskRunStartRequest(
        params as Record<string, unknown>
      );
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: `/api/v1/tasks/${typed.taskId}/runs`,
          body: typed.body
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
      "Finish an active task run and atomically store bounded completionReport, canonical gitRefs, an optional linked closeoutNote, task state, time, rewards, and activity. An exact terminal replay is idempotent; changed closeout evidence conflicts. A quick or native completion may truthfully leave closeoutState deferred, so read the task back and inspect its closeout state and evidence.",
    parameters: Type.Object(
      {
        taskRunId: Type.String({ minLength: 1 }),
        actor: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
        note: Type.Optional(Type.String({ maxLength: 4_000 })),
        completionReport: Type.Optional(completionReportInputSchema()),
        gitRefs: Type.Optional(
          Type.Array(workItemGitRefInputSchema(), {
            maxItems: taskCloseoutLimits.gitRefs
          })
        ),
        closeoutNote: Type.Optional(noteInputSchema())
      },
      { additionalProperties: false }
    ),
    async execute(_toolCallId, params) {
      const typed = params as Record<string, unknown>;
      return jsonResult(
        await runWrite(config, {
          method: "POST",
          path: `/api/v1/task-runs/${typed.taskRunId as string}/complete`,
          body: {
            actor: typed.actor,
            note: typed.note,
            completionReport: typed.completionReport,
            gitRefs: typed.gitRefs,
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
      "Stop an active task run without completing the task. Release accepts actor, note, and closeoutNote only; it never accepts completionReport or gitRefs. Use closeoutNote when blockers or handoff context should become a durable linked note.",
    parameters: Type.Object(
      {
        taskRunId: Type.String({ minLength: 1 }),
        actor: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
        note: Type.Optional(Type.String({ maxLength: 4_000 })),
        closeoutNote: Type.Optional(noteInputSchema())
      },
      { additionalProperties: false }
    ),
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
    parameters: Type.Object(
      {
        title: Type.String({ minLength: 1 }),
        kind: Type.Optional(
          Type.Union([
            Type.Literal("main_activity"),
            Type.Literal("secondary_activity"),
            Type.Literal("third_activity"),
            Type.Literal("rest"),
            Type.Literal("holiday"),
            Type.Literal("custom")
          ])
        ),
        color: Type.Optional(Type.String({ minLength: 1 })),
        timezone: Type.Optional(Type.String({ minLength: 1 })),
        weekDays: Type.Array(Type.Integer({ minimum: 0, maximum: 6 })),
        startMinute: Type.Integer({ minimum: 0, maximum: 1440 }),
        endMinute: Type.Integer({ minimum: 0, maximum: 1440 }),
        startsOn: Type.Optional(
          Type.Union([Type.String({ minLength: 1 }), Type.Null()])
        ),
        endsOn: Type.Optional(
          Type.Union([Type.String({ minLength: 1 }), Type.Null()])
        ),
        exclusionDates: Type.Optional(
          Type.Array(Type.String({ minLength: 1 }), { maxItems: 366 })
        ),
        blockingState: Type.Optional(
          Type.Union([Type.Literal("allowed"), Type.Literal("blocked")])
        ),
        activityPresetKey: Type.Optional(
          Type.Union([
            Type.Literal("deep_work"),
            Type.Literal("admin"),
            Type.Literal("maintenance"),
            Type.Literal("meeting"),
            Type.Literal("recovery_break"),
            Type.Literal("holiday_leisure"),
            Type.Literal("light_context"),
            Type.Literal("task_inherited"),
            Type.Null()
          ])
        ),
        customSustainRateApPerHour: Type.Optional(
          Type.Union([Type.Number({ minimum: 0 }), Type.Null()])
        ),
        userId: optionalNullableString()
      },
      { additionalProperties: false }
    ),
    method: "POST",
    path: "/api/v1/calendar/work-block-templates"
  });

  registerReadBodyTool(api, config, {
    name: "forge_recommend_task_timeboxes",
    label: "Forge Recommend Task Timeboxes",
    description:
      "Read up to 12 future task-timebox suggestions that fit the task owner, requested timezone, current calendar pressure, and scheduling rules.",
    parameters: Type.Object(
      {
        taskId: Type.String({ minLength: 1 }),
        from: optionalString(),
        to: optionalString(),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })),
        timezone: optionalString()
      },
      { additionalProperties: false }
    ),
    path: "/api/v1/calendar/timeboxes/recommend"
  });

  registerWriteTool(api, config, {
    name: "forge_create_task_timebox",
    label: "Forge Create Task Timebox",
    description:
      "Create a planned task timebox directly in Forge's calendar domain. This is a planning helper; agents can also use forge_create_entities with entityType task_timebox.",
    parameters: Type.Object(
      {
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
        ),
        status: Type.Optional(
          Type.Union([
            Type.Literal("planned"),
            Type.Literal("active"),
            Type.Literal("completed"),
            Type.Literal("cancelled")
          ])
        ),
        overrideReason: optionalNullableString(),
        activityPresetKey: Type.Optional(
          Type.Union([
            Type.Literal("deep_work"),
            Type.Literal("admin"),
            Type.Literal("maintenance"),
            Type.Literal("meeting"),
            Type.Literal("recovery_break"),
            Type.Literal("holiday_leisure"),
            Type.Literal("light_context"),
            Type.Literal("task_inherited"),
            Type.Null()
          ])
        ),
        customSustainRateApPerHour: Type.Optional(
          Type.Union([Type.Number({ minimum: 0 }), Type.Null()])
        ),
        userId: optionalNullableString()
      },
      { additionalProperties: false }
    ),
    method: "POST",
    path: "/api/v1/calendar/timeboxes"
  });
}
