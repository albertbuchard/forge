import { workEntityTypes, workLinkTargetTypes } from "./work/types.js";

export type JsonSchema = Record<string, unknown>;

export const security = [{ operatorSession: [] }, { bearerAuth: [] }];
export const jsonContent = (schema: JsonSchema) => ({
  "application/json": { schema }
});
export const response = (
  description: string,
  schema: JsonSchema = { $ref: "#/components/schemas/WorkEnvelope" }
) => ({
  description,
  content: jsonContent(schema)
});
export const body = (schema: JsonSchema) => ({
  required: true,
  content: jsonContent(schema)
});
export const idParameter = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", minLength: 1, maxLength: 240 }
};
export const userParameter = {
  name: "userId",
  in: "query",
  required: false,
  description:
    "Selected Forge owner. Agent tokens remain bounded by their user, project, and tag scope policy.",
  schema: { type: "string", minLength: 1, maxLength: 240 }
};
export const listParameters = [
  userParameter,
  { name: "status", in: "query", schema: { type: "string" } },
  { name: "campaignId", in: "query", schema: { type: "string" } },
  { name: "employer", in: "query", schema: { type: "string" } },
  { name: "location", in: "query", schema: { type: "string" } },
  { name: "workModel", in: "query", schema: { type: "string" } },
  {
    name: "hardGate",
    in: "query",
    schema: { enum: ["pass", "fail", "unknown", "needs_review"] }
  },
  {
    name: "minimumScore",
    in: "query",
    schema: { type: "number", minimum: 0, maximum: 100 }
  },
  {
    name: "minimumCompensation",
    in: "query",
    description: "Requires work.compensation.read.",
    schema: { type: "number", minimum: 0 }
  },
  {
    name: "compensationCurrency",
    in: "query",
    description: "Requires work.compensation.read.",
    schema: { type: "string", pattern: "^[A-Z]{3}$" }
  },
  {
    name: "deadlineBefore",
    in: "query",
    schema: { type: "string", format: "date" }
  },
  { name: "hasNextAction", in: "query", schema: { type: "boolean" } },
  { name: "missingInformation", in: "query", schema: { type: "boolean" } },
  { name: "stale", in: "query", schema: { type: "boolean" } },
  {
    name: "archived",
    in: "query",
    schema: { enum: ["exclude", "include", "only"], default: "exclude" }
  },
  { name: "query", in: "query", schema: { type: "string", maxLength: 500 } },
  {
    name: "sort",
    in: "query",
    schema: {
      enum: [
        "updated_desc",
        "created_desc",
        "deadline_asc",
        "priority_desc",
        "score_desc"
      ]
    }
  },
  {
    name: "limit",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 50, default: 25 }
  },
  {
    name: "offset",
    in: "query",
    schema: { type: "integer", minimum: 0, default: 0 }
  }
];

export function readOperation(
  summary: string,
  description: string,
  parameters: unknown[] = [userParameter]
) {
  return {
    tags: ["Work"],
    summary,
    description: `Requires work.read or an authenticated local operator session. ${description}`,
    security,
    parameters,
    responses: {
      "200": response("Authorized Work data"),
      "401": { $ref: "#/components/responses/Error" },
      "403": { $ref: "#/components/responses/Error" },
      "404": { $ref: "#/components/responses/Error" }
    }
  };
}

export function writeOperation(
  summary: string,
  description: string,
  requestSchema: JsonSchema = { type: "object", additionalProperties: true },
  parameters: unknown[] = [userParameter],
  created = false
) {
  return {
    tags: ["Work"],
    summary,
    description: `Requires work.write or an authenticated local operator session. ${description}`,
    security,
    parameters,
    requestBody: body(requestSchema),
    responses: {
      [created ? "201" : "200"]: response(
        created ? "Created Work record" : "Updated Work record"
      ),
      "400": { $ref: "#/components/responses/Error" },
      "401": { $ref: "#/components/responses/Error" },
      "403": { $ref: "#/components/responses/Error" },
      "404": { $ref: "#/components/responses/Error" },
      "409": { $ref: "#/components/responses/Error" }
    }
  };
}

export function withTypedResponse(
  operation: JsonSchema,
  schema: JsonSchema,
  status = "200"
) {
  return {
    ...operation,
    responses: {
      ...((operation.responses as Record<string, unknown> | undefined) ?? {}),
      [status]: response(
        status === "201" ? "Created Work record" : "Authorized Work data",
        schema
      )
    }
  };
}

export function withReplayResponses(operation: JsonSchema, schema: JsonSchema) {
  return withTypedResponse(
    withTypedResponse(operation, schema, "201"),
    schema,
    "200"
  );
}

export function withOnlyTypedSuccess(
  operation: JsonSchema,
  schema: JsonSchema,
  status: string,
  description: string
) {
  const existing =
    (operation.responses as Record<string, unknown> | undefined) ?? {};
  return {
    ...operation,
    responses: {
      ...Object.fromEntries(
        Object.entries(existing).filter(([code]) => !/^2\d\d$/u.test(code))
      ),
      [status]: response(description, schema)
    }
  };
}

export const workOutputProperties = {
  id: { type: "string" },
  ownerUserId: { type: "string" },
  scopeProjectIds: { type: "array", items: { type: "string" } },
  scopeTagIds: { type: "array", items: { type: "string" } },
  revision: { type: "integer", minimum: 1 },
  createdAt: { type: "string", format: "date-time" },
  updatedAt: { type: "string", format: "date-time" },
  deletedAt: { type: ["string", "null"], format: "date-time" }
};

export function rootOutputSchema(input: JsonSchema, omitted: string[] = []) {
  const properties = {
    ...((input.properties as Record<string, unknown> | undefined) ?? {})
  };
  for (const key of ["id", "scope", ...omitted]) delete properties[key];
  return {
    type: "object",
    additionalProperties: true,
    required: ["id", "ownerUserId", "revision", "createdAt", "updatedAt"],
    properties: { ...properties, ...workOutputProperties }
  };
}

export const rootEnvelope = (
  property: string,
  ref: string,
  extras: Record<string, unknown> = {}
) => ({
  type: "object",
  additionalProperties: false,
  required: [property],
  properties: { [property]: { $ref: ref }, ...extras }
});

export const rootList = (ref: string) => ({
  type: "object",
  additionalProperties: false,
  required: ["items", "total", "limit", "offset", "hasMore"],
  properties: {
    items: { type: "array", items: { $ref: ref } },
    total: { type: "integer", minimum: 0 },
    limit: { type: "integer", minimum: 1, maximum: 50 },
    offset: { type: "integer", minimum: 0 },
    hasMore: { type: "boolean" }
  }
});

export const provenance = {
  type: "object",
  additionalProperties: false,
  properties: {
    sourceKind: {
      enum: ["user", "agent", "import", "external_source", "system"]
    },
    sourceLabel: { type: "string", maxLength: 240 },
    sourceUrl: { type: "string", maxLength: 2000 },
    sourceArtifactId: { type: "string", maxLength: 240 },
    observedAt: { type: ["string", "null"], format: "date-time" },
    actorId: { type: "string", maxLength: 240 },
    confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
    evidence: {
      type: "array",
      maxItems: 100,
      items: { type: "object", additionalProperties: true }
    }
  }
};

export const searchCostConstraints = {
  type: "object",
  additionalProperties: false,
  properties: {
    billingModel: {
      enum: [
        "free",
        "subscription",
        "per_request",
        "per_result",
        "other",
        "unknown"
      ]
    },
    maximumPerRun: { type: ["number", "null"], minimum: 0 },
    currency: { type: ["string", "null"], minLength: 3, maxLength: 3 },
    notes: { type: "string", maxLength: 2_000 }
  }
};

export const searchRateConstraints = {
  type: "object",
  additionalProperties: false,
  properties: {
    maximumRequests: {
      type: ["integer", "null"],
      minimum: 1,
      maximum: 1_000_000
    },
    windowSeconds: {
      type: ["integer", "null"],
      minimum: 1,
      maximum: 31_536_000
    },
    notes: { type: "string", maxLength: 2_000 }
  }
};

export const automaticEligibility = {
  type: "object",
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean" },
    minimumScore: { type: ["number", "null"], minimum: 0, maximum: 100 },
    minimumConfidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
    requireHardGatePass: { type: "boolean" },
    requireNoUnresolvedFacts: { type: "boolean" },
    allowedRoleClasses: {
      type: "array",
      maxItems: 100,
      items: { type: "string" }
    },
    excludedEmployerClasses: {
      type: "array",
      maxItems: 100,
      items: { type: "string" }
    }
  }
};

export const compensationGate = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "operator"],
  properties: {
    kind: {
      enum: [
        "minimum_base",
        "minimum_total",
        "minimum_hourly",
        "minimum_daily",
        "currency",
        "user_confirmation"
      ]
    },
    operator: {
      enum: ["greater_than_or_equal", "equals", "known", "review_required"]
    },
    amount: { type: ["number", "null"], minimum: 0 },
    currency: { type: ["string", "null"], minLength: 3, maxLength: 3 },
    period: { type: ["string", "null"], maxLength: 80 },
    notes: { type: "string", maxLength: 2_000 }
  }
};

export const legalAnswerGate = {
  type: "object",
  additionalProperties: false,
  required: ["category", "requirement"],
  properties: {
    category: { type: "string", minLength: 1, maxLength: 240 },
    requirement: {
      enum: [
        "approved_response_required",
        "user_confirmation_required",
        "never_automate"
      ]
    },
    notes: { type: "string", maxLength: 2_000 }
  }
};

export const searchRunCost = {
  type: "object",
  additionalProperties: false,
  properties: {
    amount: { type: ["number", "null"], minimum: 0 },
    currency: { type: ["string", "null"], minLength: 3, maxLength: 3 },
    billingUnit: { type: "string", maxLength: 120 },
    notes: { type: "string", maxLength: 2_000 }
  }
};

export const stringArray = { type: "array", items: { type: "string" } };
export const jsonObject = { type: "object", additionalProperties: true };
export const jsonArray = { type: "array", items: jsonObject };
export const nullableString = { type: ["string", "null"] };
export const nullableDateTime = {
  type: ["string", "null"],
  format: "date-time"
};

export const scope = {
  type: "object",
  additionalProperties: false,
  properties: {
    projectIds: { type: "array", maxItems: 50, items: { type: "string" } },
    tagIds: { type: "array", maxItems: 100, items: { type: "string" } }
  }
};

export const money = {
  type: "object",
  additionalProperties: false,
  properties: {
    amount: { type: ["number", "null"] },
    currency: { type: ["string", "null"], pattern: "^[A-Z]{3}$" },
    basis: { enum: ["gross", "net", "unknown"] },
    period: {
      enum: ["hour", "day", "week", "month", "year", "one_time", "unknown"]
    },
    negotiable: { type: ["boolean", "null"] },
    unknown: { type: "boolean" }
  }
};

export const workLocation = {
  type: "object",
  additionalProperties: false,
  properties: {
    label: { type: "string", maxLength: 500 },
    country: { type: "string", maxLength: 160 },
    region: { type: "string", maxLength: 240 },
    city: { type: "string", maxLength: 240 },
    commuteMinutesEachWay: {
      type: ["number", "null"],
      minimum: 0,
      maximum: 1440
    },
    unknown: { type: "boolean" }
  }
};

export const workWorkload = {
  type: "object",
  additionalProperties: false,
  properties: {
    contractedWeeklyHours: {
      type: ["number", "null"],
      minimum: 0,
      maximum: 168
    },
    actualWeeklyHours: { type: ["number", "null"], minimum: 0, maximum: 168 },
    fullTimeEquivalent: { type: ["number", "null"], minimum: 0, maximum: 5 },
    unknown: { type: "boolean" }
  }
};

export const noticePeriod = {
  type: "object",
  additionalProperties: false,
  properties: {
    value: { type: ["integer", "null"], minimum: 0, maximum: 1000 },
    unit: { type: ["string", "null"], enum: ["days", "weeks", "months", null] },
    negotiable: { type: ["boolean", "null"] },
    conditions: { type: "string", maxLength: 2000 },
    unknown: { type: "boolean" }
  }
};

export const workSchedule = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", maxLength: 4000 },
    shifts: stringArray,
    workingDays: {
      type: "array",
      maxItems: 7,
      uniqueItems: true,
      items: {
        enum: [
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
          "sunday"
        ]
      }
    },
    timezone: { type: "string", maxLength: 120 },
    officeDaysPerWeek: { type: ["number", "null"], minimum: 0, maximum: 7 },
    travelPercent: { type: ["number", "null"], minimum: 0, maximum: 100 },
    onCallResponsibility: { type: "string", maxLength: 4000 },
    flexibility: { type: "string", maxLength: 4000 },
    unknown: { type: "boolean" }
  }
};

export const workCompensationComponent = {
  type: "object",
  additionalProperties: false,
  properties: {
    description: { type: "string", maxLength: 4000 },
    unknown: { type: "boolean" }
  }
};

export const workBenefit = {
  type: "object",
  additionalProperties: false,
  required: ["type"],
  properties: {
    type: {
      enum: [
        "paid_leave",
        "health_coverage",
        "pension",
        "parental_leave",
        "learning_budget",
        "education_budget",
        "conference_access",
        "protected_research_time",
        "equipment",
        "flexible_hours",
        "sabbatical",
        "wellness",
        "other"
      ]
    },
    label: { type: "string", maxLength: 500 },
    description: { type: "string", maxLength: 4000 },
    amount: { type: ["number", "null"], minimum: 0 },
    currency: { type: ["string", "null"], pattern: "^[A-Z]{3}$" },
    period: { enum: ["day", "week", "month", "year", "one_time", "unknown"] },
    days: { type: ["number", "null"], minimum: 0 },
    unknown: { type: "boolean" }
  }
};

export const workCompensation = {
  type: "object",
  additionalProperties: false,
  properties: {
    base: { anyOf: [money, { type: "null" }] },
    total: { anyOf: [money, { type: "null" }] },
    hourlyRate: { anyOf: [money, { type: "null" }] },
    dailyRate: { anyOf: [money, { type: "null" }] },
    bonus: workCompensationComponent,
    commission: workCompensationComponent,
    equity: workCompensationComponent,
    pension: workCompensationComponent,
    other: jsonObject
  }
};

export const offerCompensation = {
  ...workCompensation,
  properties: {
    ...(workCompensation.properties as Record<string, unknown>),
    benefits: { type: "array", maxItems: 100, items: workBenefit }
  }
};

export const opportunityHours = {
  type: "object",
  additionalProperties: false,
  properties: {
    minimum: { type: ["number", "null"], minimum: 0, maximum: 168 },
    maximum: { type: ["number", "null"], minimum: 0, maximum: 168 },
    value: { type: ["number", "null"], minimum: 0, maximum: 168 },
    unknown: { type: "boolean" }
  }
};

export const opportunityDuration = {
  type: "object",
  additionalProperties: false,
  properties: {
    value: { type: ["number", "null"], minimum: 0 },
    unit: {
      type: ["string", "null"],
      enum: ["days", "weeks", "months", "years", null]
    },
    description: { type: "string", maxLength: 2000 },
    fixedTerm: { type: ["boolean", "null"] },
    endDate: { type: ["string", "null"], format: "date" },
    unknown: { type: "boolean" }
  }
};

export const opportunityTravel = {
  type: "object",
  additionalProperties: false,
  properties: {
    percent: { type: ["number", "null"], minimum: 0, maximum: 100 },
    ceilingPercent: { type: ["number", "null"], minimum: 0, maximum: 100 },
    frequency: { type: "string", maxLength: 240 },
    description: { type: "string", maxLength: 2000 },
    unknown: { type: "boolean" }
  }
};

export const opportunitySponsorship = {
  type: "object",
  additionalProperties: false,
  properties: {
    needed: { type: ["boolean", "null"] },
    available: { type: ["boolean", "null"] },
    acceptable: { type: ["boolean", "null"] },
    status: { type: "string", maxLength: 240 },
    description: { type: "string", maxLength: 2000 },
    unknown: { type: "boolean" }
  }
};

export const applicationRoute = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", maxLength: 500 },
    url: { type: ["string", "null"], format: "uri", maxLength: 2000 },
    channel: {
      enum: [
        "web_portal",
        "email",
        "recruiter",
        "referral",
        "api",
        "other",
        "unknown"
      ]
    },
    instructions: { type: "string", maxLength: 4000 }
  }
};
