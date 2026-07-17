import { Type } from "@sinclair/typebox";
import {
  callConfiguredForgeApi,
  expectForgeSuccess
} from "../runtime/dist/openclaw/api-client.js";

const strictObject = (properties) =>
  Type.Object(properties, { additionalProperties: false });
const idSchema = () => Type.String({ minLength: 1, maxLength: 240 });
const versionSchema = () => Type.String({ minLength: 1, maxLength: 240 });
const cursorSchema = () =>
  Type.String({
    minLength: 8,
    maxLength: 2_048,
    pattern: "^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$"
  });
const hashSchema = () => Type.String({ pattern: "^[a-f0-9]{64}$" });
const idempotencyKeySchema = () =>
  Type.String({
    minLength: 16,
    maxLength: 240,
    pattern: "^[A-Za-z0-9._:-]+$"
  });
const emptySchema = () => strictObject({});
const personParamsSchema = () => strictObject({ personId: idSchema() });
const relationshipParamsSchema = () =>
  strictObject({ relationshipId: idSchema() });

function literalUnion(values, options = {}) {
  return Type.Union(
    values.map((value) => Type.Literal(value)),
    options
  );
}

const wikiDecisionSchema = () =>
  Type.Union([
    strictObject({
      wikiPageId: idSchema(),
      action: Type.Literal("associate"),
      personId: idSchema(),
      expectedWikiVersion: versionSchema(),
      expectedPersonVersion: versionSchema()
    }),
    strictObject({
      wikiPageId: idSchema(),
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
      expectedWikiVersion: versionSchema()
    }),
    strictObject({
      wikiPageId: idSchema(),
      action: Type.Literal("skip"),
      expectedWikiVersion: versionSchema()
    })
  ]);

const peopleWikiBaseProperties = () => ({
  userId: Type.Optional(idSchema()),
  peopleRootPageId: idSchema(),
  decisions: Type.Array(wikiDecisionSchema(), { minItems: 1, maxItems: 100 })
});

const listPeopleQuerySchema = () =>
  strictObject({
    userId: Type.Optional(idSchema()),
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
    cursor: Type.Optional(cursorSchema()),
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 100, default: 50 })
    )
  });

const personContextQuerySchema = () =>
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

const wikiCandidateScanBodySchema = () =>
  strictObject({
    userId: Type.Optional(idSchema()),
    peopleRootPageId: idSchema(),
    query: Type.Optional(Type.String({ maxLength: 200 })),
    cursor: Type.Optional(cursorSchema()),
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 100, default: 50 })
    )
  });

const wikiAssociationPreviewBodySchema = () =>
  strictObject(peopleWikiBaseProperties());

const wikiAssociationApplyBodySchema = () =>
  strictObject({
    userId: Type.Optional(idSchema()),
    peopleRootPageId: idSchema(),
    previewId: idSchema(),
    previewHash: hashSchema(),
    idempotencyKey: idempotencyKeySchema(),
    decisions: Type.Array(wikiDecisionSchema(), {
      minItems: 1,
      maxItems: 100
    })
  });

const peerRequestsQuerySchema = () =>
  strictObject({
    kind: Type.Optional(literalUnion(["pairing", "device", "grant"])),
    status: Type.Optional(
      literalUnion(["pending", "accepted", "rejected", "expired"])
    ),
    cursor: Type.Optional(cursorSchema()),
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 100, default: 50 })
    )
  });

const peerRelationshipsQuerySchema = () =>
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
    cursor: Type.Optional(cursorSchema()),
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 100, default: 50 })
    )
  });

const peerGrantsQuerySchema = () =>
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
    cursor: Type.Optional(cursorSchema()),
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 100, default: 50 })
    )
  });

const peerDiagnosticsQuerySchema = () =>
  strictObject({
    cursor: Type.Optional(cursorSchema()),
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 200, default: 100 })
    )
  });

const questionInterpretBodySchema = () =>
  strictObject({
    question: Type.String({ minLength: 1, maxLength: 1_000 }),
    timeZone: Type.String({ minLength: 1, maxLength: 100 }),
    referenceTime: Type.Optional(Type.String({ format: "date-time" }))
  });

const questionIntervalSchema = () =>
  strictObject({
    startsAt: Type.String({ format: "date-time" }),
    endsAt: Type.String({ format: "date-time" }),
    timeZone: Type.String({ minLength: 1, maxLength: 64 })
  });

const questionEntityIdsSchema = (maximum) =>
  Type.Optional(Type.Array(idSchema(), { maxItems: maximum, default: [] }));
const questionFieldsSchema = (values) =>
  Type.Optional(
    Type.Array(literalUnion(values), {
      maxItems: values.length,
      default: []
    })
  );
const questionMaximumResultCountSchema = () =>
  Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000, default: 100 }));
const questionEmptyParametersSchema = () => strictObject({});

const questionTypedQuerySchema = () =>
  Type.Union([
    strictObject({
      projectionId: Type.Literal("calendar.availability.v1"),
      parameters: questionEmptyParametersSchema(),
      interval: questionIntervalSchema(),
      entityIds: questionEntityIdsSchema(0),
      fields: questionFieldsSchema([
        "start",
        "end",
        "timezone",
        "busyState",
        "eventTitle",
        "eventLocation"
      ]),
      precision: literalUnion(["exact", "fifteen_minutes", "hour"]),
      maximumResultCount: questionMaximumResultCountSchema()
    }),
    strictObject({
      projectionId: Type.Literal("calendar.selected_events.v1"),
      parameters: questionEmptyParametersSchema(),
      interval: questionIntervalSchema(),
      entityIds: questionEntityIdsSchema(256),
      fields: questionFieldsSchema([
        "start",
        "end",
        "timezone",
        "busyState",
        "eventTitle",
        "eventLocation"
      ]),
      precision: Type.Literal("exact"),
      maximumResultCount: questionMaximumResultCountSchema()
    }),
    strictObject({
      projectionId: Type.Literal("goals.horizon_summary.v1"),
      parameters: questionEmptyParametersSchema(),
      interval: questionIntervalSchema(),
      entityIds: questionEntityIdsSchema(0),
      fields: questionFieldsSchema([
        "goalTitle",
        "goalSummary",
        "goalState",
        "goalProgress"
      ]),
      precision: Type.Literal("exact"),
      maximumResultCount: questionMaximumResultCountSchema()
    }),
    strictObject({
      projectionId: Type.Literal("health.cycling.aggregate.v1"),
      parameters: strictObject({
        granularity: literalUnion(["day", "week", "month"]),
        units: idSchema()
      }),
      interval: questionIntervalSchema(),
      entityIds: questionEntityIdsSchema(0),
      fields: questionFieldsSchema([
        "duration",
        "distance",
        "activityCount",
        "energy"
      ]),
      precision: Type.Literal("exact"),
      maximumResultCount: questionMaximumResultCountSchema()
    }),
    strictObject({
      projectionId: Type.Literal("person.profile.v1"),
      parameters: questionEmptyParametersSchema(),
      interval: Type.Null(),
      entityIds: questionEntityIdsSchema(0),
      fields: questionFieldsSchema([
        "displayName",
        "preferredName",
        "pronouns",
        "relationshipLabel",
        "shortDescription"
      ]),
      precision: Type.Literal("exact"),
      maximumResultCount: questionMaximumResultCountSchema()
    }),
    strictObject({
      projectionId: Type.Literal("life_events.selected.v1"),
      parameters: questionEmptyParametersSchema(),
      interval: questionIntervalSchema(),
      entityIds: questionEntityIdsSchema(256),
      fields: questionFieldsSchema([
        "lifeEventTitle",
        "lifeEventType",
        "lifeEventPlace"
      ]),
      precision: Type.Literal("exact"),
      maximumResultCount: questionMaximumResultCountSchema()
    }),
    strictObject({
      projectionId: Type.Literal("movement.aggregate.v1"),
      parameters: strictObject({
        granularity: literalUnion(["day", "week", "month"])
      }),
      interval: questionIntervalSchema(),
      entityIds: questionEntityIdsSchema(0),
      fields: questionFieldsSchema(["movementDuration", "movementDistance"]),
      precision: Type.Literal("exact"),
      maximumResultCount: questionMaximumResultCountSchema()
    }),
    strictObject({
      projectionId: Type.Literal("custom.selected_entities.v1"),
      parameters: questionEmptyParametersSchema(),
      interval: Type.Null(),
      entityIds: questionEntityIdsSchema(256),
      fields: questionFieldsSchema([
        "customTitle",
        "customSummary",
        "customState"
      ]),
      precision: Type.Literal("exact"),
      maximumResultCount: questionMaximumResultCountSchema()
    })
  ]);

const questionExecuteBodySchema = () =>
  strictObject({
    interpretationId: idSchema(),
    interpretationHash: hashSchema(),
    query: questionTypedQuerySchema(),
    sourcePreference: Type.Optional(
      literalUnion(["live_then_cache", "live_only", "cache_only"], {
        default: "live_then_cache"
      })
    )
  });

const questionHistoryQuerySchema = () =>
  strictObject({
    cursor: Type.Optional(cursorSchema()),
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 100, default: 50 })
    )
  });

const PEOPLE_ROUTES = {
  listPeopleReadModel: {
    method: "GET",
    path: "/api/v1/people",
    params: emptySchema(),
    query: listPeopleQuerySchema()
  },
  getPersonContext: {
    method: "GET",
    path: "/api/v1/people/:personId/context",
    params: personParamsSchema(),
    query: personContextQuerySchema()
  },
  scanPeopleWikiCandidates: {
    method: "POST",
    path: "/api/v1/people/wiki-candidates/scan",
    params: emptySchema(),
    query: emptySchema(),
    body: wikiCandidateScanBodySchema()
  },
  previewPeopleWikiAssociations: {
    method: "POST",
    path: "/api/v1/people/wiki-associations/preview",
    params: emptySchema(),
    query: emptySchema(),
    body: wikiAssociationPreviewBodySchema()
  },
  applyPeopleWikiAssociations: {
    method: "POST",
    path: "/api/v1/people/wiki-associations/apply",
    params: emptySchema(),
    query: emptySchema(),
    body: wikiAssociationApplyBodySchema()
  },
  interpretPersonQuestion: {
    method: "POST",
    path: "/api/v1/people/:personId/questions/interpret",
    params: personParamsSchema(),
    query: emptySchema(),
    body: questionInterpretBodySchema()
  },
  executePersonQuestion: {
    method: "POST",
    path: "/api/v1/people/:personId/questions/execute",
    params: personParamsSchema(),
    query: emptySchema(),
    body: questionExecuteBodySchema()
  },
  listPersonQuestionHistory: {
    method: "GET",
    path: "/api/v1/people/:personId/questions",
    params: personParamsSchema(),
    query: questionHistoryQuerySchema()
  }
};

const PEER_ROUTES = {
  listPeerRequests: {
    method: "GET",
    path: "/api/v1/peers/requests",
    params: emptySchema(),
    query: peerRequestsQuerySchema()
  },
  listPeerRelationships: {
    method: "GET",
    path: "/api/v1/peers/relationships",
    params: emptySchema(),
    query: peerRelationshipsQuerySchema()
  },
  getPeerRelationship: {
    method: "GET",
    path: "/api/v1/peers/relationships/:relationshipId",
    params: relationshipParamsSchema(),
    query: emptySchema()
  },
  listPeerDevices: {
    method: "GET",
    path: "/api/v1/peers/relationships/:relationshipId/devices",
    params: relationshipParamsSchema(),
    query: emptySchema()
  },
  listPeerGrants: {
    method: "GET",
    path: "/api/v1/peers/relationships/:relationshipId/grants",
    params: relationshipParamsSchema(),
    query: peerGrantsQuerySchema()
  },
  getPeerSyncStatus: {
    method: "GET",
    path: "/api/v1/peers/relationships/:relationshipId/sync",
    params: relationshipParamsSchema(),
    query: emptySchema()
  },
  getPeerDiagnostics: {
    method: "GET",
    path: "/api/v1/peers/relationships/:relationshipId/diagnostics",
    params: relationshipParamsSchema(),
    query: peerDiagnosticsQuerySchema()
  }
};

function parametersSchema(routes) {
  const variants = Object.entries(routes).map(([operationId, route]) => {
    const properties = { routeKey: Type.Literal(operationId) };
    if (Object.keys(route.params.properties).length > 0) {
      properties.pathParams = route.params;
    }
    if (Object.keys(route.query.properties).length > 0) {
      properties.query = Type.Optional(route.query);
    }
    if (route.body) properties.body = route.body;
    return strictObject(properties);
  });
  const schema = Type.Union(variants);
  schema.type = "object";
  return schema;
}

function resolvePath(template, pathParams = {}) {
  return template.replace(/:([A-Za-z0-9_]+)/g, (_match, key) => {
    const value = pathParams[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Missing pathParams.${key} for ${template}.`);
    }
    return encodeURIComponent(value.trim());
  });
}

function appendQuery(path, query) {
  if (!query || typeof query !== "object") return path;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== null && item !== undefined) search.append(key, String(item));
    }
  }
  return search.size > 0 ? `${path}?${search.toString()}` : path;
}

function jsonResult(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload
  };
}

function buildRouteTool(config, { name, label, description, routes }) {
  return {
    name,
    label,
    description,
    parameters: parametersSchema(routes),
    async execute(_toolCallId, params = {}) {
      if (!config.apiToken?.trim()) {
        throw new Error(
          "People and peer-sharing agent tools require a configured Forge agent token with the route's published local scopes; an operator session cannot substitute for that token."
        );
      }
      const route = routes[params.routeKey];
      if (!route) {
        throw new Error(`Unknown People or peer route key: ${params.routeKey}`);
      }
      const path = appendQuery(
        resolvePath(route.path, params.pathParams),
        params.query
      );
      const payload = await expectForgeSuccess(
        await callConfiguredForgeApi(config, {
          method: route.method,
          path,
          body:
            route.method === "GET" || route.method === "DELETE"
              ? undefined
              : (params.body ?? {})
        })
      );
      return jsonResult(payload);
    }
  };
}

export function buildPeoplePeerCompatibilityTools(config) {
  return [
    buildRouteTool(config, {
      name: "forge_call_people_route",
      label: "Forge People Route",
      description:
        "Call one MCP-exposed People read or reviewed Wiki-association operation, or interpret, execute, and review a typed question against an existing directional grant. Person CRUD and general links stay on shared batch CRUD. Preserve result state, source, freshness, precision, completeness, and redactedFields; never infer withheld fields. Agents cannot pair Forge installations or change consent, grants, devices, credentials, or human-presence approvals.",
      routes: PEOPLE_ROUTES
    }),
    buildRouteTool(config, {
      name: "forge_call_peer_route",
      label: "Forge Peer Status And Query Route",
      description:
        "Call one MCP-exposed peer request, relationship, device, grant, sync-status, or diagnostic operation using an existing human-approved relationship. This tool cannot create or accept pairing, request a resync, widen or revoke consent, accept or counter grants, approve or remove devices, manage credentials, or perform a human-presence ceremony.",
      routes: PEER_ROUTES
    })
  ];
}
