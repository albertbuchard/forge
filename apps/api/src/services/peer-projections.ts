import { createHash } from "node:crypto";
import { z } from "zod";
import {
  PEER_PROJECTION_IDS,
  peerProjectionIdSchema,
  type PeerProjectionId,
  type PeerShareRule
} from "../peer-sharing-types.js";

const boundedIsoRangeShape = {
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true })
};

function boundedIsoRangeSchema<T extends z.ZodRawShape>(extra: T) {
  return z
    .object({ ...boundedIsoRangeShape, ...extra })
    .strict()
    .superRefine((range, context) => {
      if (typeof range.startsAt !== "string" || typeof range.endsAt !== "string") {
        return;
      }
      if (Date.parse(range.startsAt) >= Date.parse(range.endsAt)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "The query end must be after its start.",
          path: ["endsAt"]
        });
      }
      if (
        Date.parse(range.endsAt) - Date.parse(range.startsAt) >
        366 * 86_400_000
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A single peer query cannot span more than 366 days.",
          path: ["endsAt"]
        });
      }
    });
}

const ianaTimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((timeZone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone }).format();
      return true;
    } catch {
      return false;
    }
  }, "A valid IANA time zone is required.");

const calendarAvailabilityInputSchema = boundedIsoRangeSchema({
  timezone: ianaTimeZoneSchema,
  precision: z.enum(["free_busy", "named"])
});

const selectedCalendarInputSchema = boundedIsoRangeSchema({
  timezone: ianaTimeZoneSchema,
  eventIds: z.array(z.string().trim().min(1).max(240)).min(1).max(500)
});

const goalsHorizonInputSchema = z
  .object({
    horizonMonths: z.number().int().min(1).max(24),
    goalIds: z.array(z.string().trim().min(1).max(240)).max(500).default([]),
    includeProgress: z.boolean().default(false)
  })
  .strict();

const cyclingAggregateInputSchema = boundedIsoRangeSchema({
  timezone: ianaTimeZoneSchema,
  granularity: z.enum(["week", "month", "quarter"]),
  metrics: z
    .array(z.enum(["duration", "distance", "activity_count", "energy"]))
    .min(1)
    .max(4)
});

const personProfileInputSchema = z
  .object({
    fields: z
      .array(
        z.enum([
          "displayName",
          "pronouns",
          "shortDescription",
          "timezone",
          "homePlaceLabel",
          "contactMethods",
          "facts"
        ])
      )
      .min(1)
      .max(32)
  })
  .strict();

const selectedRecordsInputSchema = z
  .object({
    recordIds: z.array(z.string().trim().min(1).max(240)).min(1).max(500),
    fields: z.array(z.string().trim().min(1).max(120)).min(1).max(128)
  })
  .strict();

const movementAggregateInputSchema = boundedIsoRangeSchema({
  timezone: ianaTimeZoneSchema,
  granularity: z.enum(["week", "month", "quarter"]),
  metrics: z
    .array(z.enum(["distance", "duration", "trip_count", "active_days"]))
    .min(1)
    .max(4)
});

const customSelectedEntitiesInputSchema = z
  .object({
    entityType: z.string().trim().min(1).max(80),
    entityIds: z.array(z.string().trim().min(1).max(240)).min(1).max(500),
    fields: z.array(z.string().trim().min(1).max(120)).min(1).max(128)
  })
  .strict();

const projectionTextSchema = z.string().max(20_000);
const projectionLabelSchema = z.string().trim().min(1).max(500);
const projectionStatusSchema = z.string().trim().min(1).max(80);
const projectionIsoDateTimeSchema = z.string().datetime({ offset: true });
const projectionRecordIdSchema = z.string().trim().min(1).max(500).nullable();

function nonEmptyProjectionFields<T extends z.ZodRawShape>(shape: T) {
  return z
    .object(shape)
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
      message: "A projection record must contain at least one field."
    });
}

function projectionOutputSchema(fieldsSchema: z.ZodTypeAny) {
  return z
    .object({
      records: z
        .array(
          z
            .object({
              recordId: projectionRecordIdSchema,
              fields: fieldsSchema
            })
            .strict()
        )
        .max(10_000)
    })
    .strict();
}

const calendarAvailabilityOutputSchema = projectionOutputSchema(
  nonEmptyProjectionFields({
    start: projectionIsoDateTimeSchema.optional(),
    end: projectionIsoDateTimeSchema.optional(),
    timezone: ianaTimeZoneSchema.optional(),
    busyState: z.enum(["free", "busy", "unknown"]).optional(),
    eventTitle: projectionLabelSchema.optional(),
    eventLocation: projectionTextSchema.optional()
  }).superRefine((fields, context) => {
    if (
      fields.start &&
      fields.end &&
      Date.parse(fields.start) >= Date.parse(fields.end)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An availability block must end after it starts.",
        path: ["end"]
      });
    }
  })
);

const selectedCalendarOutputSchema = projectionOutputSchema(
  nonEmptyProjectionFields({
    eventTitle: projectionLabelSchema.optional(),
    start: projectionIsoDateTimeSchema.optional(),
    end: projectionIsoDateTimeSchema.optional(),
    timezone: ianaTimeZoneSchema.optional(),
    eventLocation: projectionTextSchema.optional()
  })
);

const goalsHorizonOutputSchema = projectionOutputSchema(
  nonEmptyProjectionFields({
    goalTitle: projectionLabelSchema.optional(),
    goalSummary: projectionTextSchema.optional(),
    goalState: projectionStatusSchema.optional(),
    goalProgress: z.number().finite().min(0).max(100).optional()
  })
);

const cyclingAggregateOutputSchema = projectionOutputSchema(
  nonEmptyProjectionFields({
    duration: z.number().finite().nonnegative().optional(),
    distance: z.number().finite().nonnegative().optional(),
    activityCount: z.number().int().nonnegative().optional(),
    energy: z.number().finite().nonnegative().optional()
  })
);

const personProfileOutputSchema = projectionOutputSchema(
  nonEmptyProjectionFields({
    displayName: projectionLabelSchema.optional(),
    preferredName: projectionLabelSchema.optional(),
    pronouns: z.string().trim().max(160).optional(),
    relationshipLabel: projectionLabelSchema.optional(),
    shortDescription: projectionTextSchema.optional()
  })
);

const lifeEventsOutputSchema = projectionOutputSchema(
  nonEmptyProjectionFields({
    lifeEventTitle: projectionLabelSchema.optional(),
    lifeEventType: projectionStatusSchema.optional(),
    lifeEventPlace: projectionTextSchema.optional()
  })
);

const movementAggregateOutputSchema = projectionOutputSchema(
  nonEmptyProjectionFields({
    movementDuration: z.number().finite().nonnegative().optional(),
    movementDistance: z.number().finite().nonnegative().optional()
  })
);

const customSelectedEntitiesOutputSchema = projectionOutputSchema(
  nonEmptyProjectionFields({
    customTitle: projectionLabelSchema.optional(),
    customSummary: projectionTextSchema.optional(),
    customState: projectionStatusSchema.optional()
  })
);

export const peerProjectionOutputSchemas = {
  "calendar.availability.v1": calendarAvailabilityOutputSchema,
  "calendar.selected_events.v1": selectedCalendarOutputSchema,
  "goals.horizon_summary.v1": goalsHorizonOutputSchema,
  "health.cycling.aggregate.v1": cyclingAggregateOutputSchema,
  "person.profile.v1": personProfileOutputSchema,
  "life_events.selected.v1": lifeEventsOutputSchema,
  "movement.aggregate.v1": movementAggregateOutputSchema,
  "custom.selected_entities.v1": customSelectedEntitiesOutputSchema
} satisfies Record<PeerProjectionId, z.ZodTypeAny>;

const peerProjectionOutputFieldSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/);

export type PeerProjectionDefinition = {
  id: PeerProjectionId;
  version: 1;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  sensitivity: "basic" | "private" | "sensitive" | "restricted";
  maximumResponseBytes: number;
  cacheSeconds: number;
  broadShareEligible: boolean;
  allowedPrecisions: readonly string[];
  defaultPrecision: string;
  defaultFields: readonly string[];
  shareableFields: readonly string[] | null;
  permanentlyExcludedFields: readonly string[];
  aggregate: boolean;
};

const definitionList: PeerProjectionDefinition[] = [
  {
    id: "calendar.availability.v1",
    version: 1,
    inputSchema: calendarAvailabilityInputSchema,
    outputSchema: calendarAvailabilityOutputSchema,
    sensitivity: "private",
    maximumResponseBytes: 262_144,
    cacheSeconds: 900,
    broadShareEligible: true,
    allowedPrecisions: ["exact", "fifteen_minutes", "hour"],
    defaultPrecision: "fifteen_minutes",
    defaultFields: ["start", "end", "busyState"],
    shareableFields: [
      "start",
      "end",
      "timezone",
      "busyState",
      "eventTitle",
      "eventLocation"
    ],
    permanentlyExcludedFields: [
      "description",
      "participants",
      "linkedEntities",
      "providerRaw"
    ],
    aggregate: false
  },
  {
    id: "calendar.selected_events.v1",
    version: 1,
    inputSchema: selectedCalendarInputSchema,
    outputSchema: selectedCalendarOutputSchema,
    sensitivity: "sensitive",
    maximumResponseBytes: 524_288,
    cacheSeconds: 900,
    broadShareEligible: false,
    allowedPrecisions: ["exact"],
    defaultPrecision: "exact",
    defaultFields: ["eventTitle", "start", "end", "eventLocation"],
    shareableFields: [
      "eventTitle",
      "start",
      "end",
      "timezone",
      "eventLocation"
    ],
    permanentlyExcludedFields: ["privateNotes", "providerRaw"],
    aggregate: false
  },
  {
    id: "goals.horizon_summary.v1",
    version: 1,
    inputSchema: goalsHorizonInputSchema,
    outputSchema: goalsHorizonOutputSchema,
    sensitivity: "private",
    maximumResponseBytes: 262_144,
    cacheSeconds: 3_600,
    broadShareEligible: true,
    allowedPrecisions: ["exact"],
    defaultPrecision: "exact",
    defaultFields: ["goalTitle", "goalSummary", "goalState", "goalProgress"],
    shareableFields: [
      "goalTitle",
      "goalSummary",
      "goalState",
      "goalProgress"
    ],
    permanentlyExcludedFields: ["privateNotes", "psycheLinks", "agentHistory"],
    aggregate: false
  },
  {
    id: "health.cycling.aggregate.v1",
    version: 1,
    inputSchema: cyclingAggregateInputSchema,
    outputSchema: cyclingAggregateOutputSchema,
    sensitivity: "sensitive",
    maximumResponseBytes: 131_072,
    cacheSeconds: 3_600,
    broadShareEligible: false,
    allowedPrecisions: ["exact"],
    defaultPrecision: "exact",
    defaultFields: ["duration", "distance", "activityCount"],
    shareableFields: [
      "duration",
      "distance",
      "activityCount",
      "energy"
    ],
    permanentlyExcludedFields: [
      "rawSamples",
      "route",
      "places",
      "startLocation",
      "endLocation"
    ],
    aggregate: true
  },
  {
    id: "person.profile.v1",
    version: 1,
    inputSchema: personProfileInputSchema,
    outputSchema: personProfileOutputSchema,
    sensitivity: "private",
    maximumResponseBytes: 131_072,
    cacheSeconds: 86_400,
    broadShareEligible: true,
    allowedPrecisions: ["exact"],
    defaultPrecision: "exact",
    defaultFields: [
      "displayName",
      "preferredName",
      "pronouns",
      "relationshipLabel",
      "shortDescription"
    ],
    shareableFields: [
      "displayName",
      "preferredName",
      "pronouns",
      "relationshipLabel",
      "shortDescription"
    ],
    permanentlyExcludedFields: ["privateNotes", "actorBinding", "peerAudit"],
    aggregate: false
  },
  {
    id: "life_events.selected.v1",
    version: 1,
    inputSchema: selectedRecordsInputSchema,
    outputSchema: lifeEventsOutputSchema,
    sensitivity: "sensitive",
    maximumResponseBytes: 524_288,
    cacheSeconds: 3_600,
    broadShareEligible: false,
    allowedPrecisions: ["exact"],
    defaultPrecision: "exact",
    defaultFields: ["lifeEventTitle", "lifeEventType", "lifeEventPlace"],
    shareableFields: ["lifeEventTitle", "lifeEventType", "lifeEventPlace"],
    permanentlyExcludedFields: ["bookingReference", "ticketArtifact", "privateNotes"],
    aggregate: false
  },
  {
    id: "movement.aggregate.v1",
    version: 1,
    inputSchema: movementAggregateInputSchema,
    outputSchema: movementAggregateOutputSchema,
    sensitivity: "sensitive",
    maximumResponseBytes: 131_072,
    cacheSeconds: 3_600,
    broadShareEligible: false,
    allowedPrecisions: ["exact"],
    defaultPrecision: "exact",
    defaultFields: ["movementDuration", "movementDistance"],
    shareableFields: ["movementDuration", "movementDistance"],
    permanentlyExcludedFields: ["timeline", "places", "route", "rawPoints"],
    aggregate: true
  },
  {
    id: "custom.selected_entities.v1",
    version: 1,
    inputSchema: customSelectedEntitiesInputSchema,
    outputSchema: customSelectedEntitiesOutputSchema,
    sensitivity: "restricted",
    maximumResponseBytes: 524_288,
    cacheSeconds: 3_600,
    broadShareEligible: false,
    allowedPrecisions: ["exact"],
    defaultPrecision: "exact",
    defaultFields: ["customTitle", "customSummary", "customState"],
    shareableFields: ["customTitle", "customSummary", "customState"],
    permanentlyExcludedFields: [
      "secret",
      "token",
      "password",
      "artifactBytes",
      "rawHealthSamples",
      "privatePsyche"
    ],
    aggregate: false
  }
];

export const peerProjectionRegistry = new Map(
  definitionList.map((definition) => [definition.id, definition] as const)
);

if (
  PEER_PROJECTION_IDS.some((projectionId) => !peerProjectionRegistry.has(projectionId)) ||
  peerProjectionRegistry.size !== PEER_PROJECTION_IDS.length
) {
  throw new Error("Peer projection registry is not exhaustive.");
}

export function getPeerProjectionDefinition(
  projectionId: PeerProjectionId
): PeerProjectionDefinition {
  const parsed = peerProjectionIdSchema.parse(projectionId);
  const definition = peerProjectionRegistry.get(parsed);
  if (!definition) {
    throw new Error(`Unsupported peer projection: ${parsed}`);
  }
  return definition;
}

export function parsePeerProjectionInput(
  projectionId: PeerProjectionId,
  input: unknown
): unknown {
  return getPeerProjectionDefinition(projectionId).inputSchema.parse(input);
}

const PEER_PROJECTION_OUTPUT_MAX_DEPTH = 32;
const PEER_PROJECTION_OUTPUT_MAX_NODES = 20_000;
const PEER_PROJECTION_OUTPUT_MAX_KEYS = 10_000;
const UNSAFE_PEER_OUTPUT_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype"
]);
const PROTECTED_CUSTOM_FIELD_PATTERN =
  /(?:secret|token|password|credential|privatekey|apikey|artifactbytes|rawhealth|privatepsyche)/i;

type PeerProjectionOutputEnvelope = {
  records: Array<{
    recordId: string | null;
    fields: Record<string, unknown>;
  }>;
};

export type ValidatedPeerProjectionOutput = {
  payload: PeerProjectionOutputEnvelope;
  resultCount: number;
  payloadBytes: number;
  redactedFields: string[];
};

function inspectPeerProjectionJson(value: unknown): string | null {
  const pending: Array<{ value: unknown; depth: number }> = [
    { value, depth: 0 }
  ];
  const visited = new WeakSet<object>();
  let nodeCount = 0;
  let keyCount = 0;

  while (pending.length > 0) {
    const current = pending.pop()!;
    nodeCount += 1;
    if (nodeCount > PEER_PROJECTION_OUTPUT_MAX_NODES) {
      return `Peer projection output exceeds ${PEER_PROJECTION_OUTPUT_MAX_NODES} JSON nodes.`;
    }
    if (current.depth > PEER_PROJECTION_OUTPUT_MAX_DEPTH) {
      return `Peer projection output exceeds depth ${PEER_PROJECTION_OUTPUT_MAX_DEPTH}.`;
    }
    if (
      current.value === null ||
      typeof current.value === "string" ||
      typeof current.value === "boolean"
    ) {
      continue;
    }
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) {
        return "Peer projection output numbers must be finite.";
      }
      continue;
    }
    if (typeof current.value !== "object") {
      return "Peer projection output must contain JSON-compatible values only.";
    }
    if (visited.has(current.value)) {
      return "Peer projection output must not contain cycles or shared object references.";
    }
    visited.add(current.value);

    if (Array.isArray(current.value)) {
      if (Object.getPrototypeOf(current.value) !== Array.prototype) {
        return "Peer projection arrays must use the standard Array prototype.";
      }
      const ownKeys = Reflect.ownKeys(current.value);
      for (const key of ownKeys) {
        if (typeof key !== "string") {
          return "Peer projection output must not contain symbol keys.";
        }
        if (key === "length") {
          continue;
        }
        const index = Number(key);
        if (
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= current.value.length ||
          String(index) !== key
        ) {
          return "Peer projection arrays must not contain named properties.";
        }
      }
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          current.value,
          String(index)
        );
        if (!descriptor || !("value" in descriptor)) {
          return "Peer projection arrays must be dense data arrays without accessors.";
        }
        pending.push({ value: descriptor.value, depth: current.depth + 1 });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(current.value);
    if (prototype !== Object.prototype && prototype !== null) {
      return "Peer projection objects must use a plain or null prototype.";
    }
    const keys = Reflect.ownKeys(current.value);
    keyCount += keys.length;
    if (keyCount > PEER_PROJECTION_OUTPUT_MAX_KEYS) {
      return `Peer projection output exceeds ${PEER_PROJECTION_OUTPUT_MAX_KEYS} object keys.`;
    }
    for (const key of keys) {
      if (typeof key !== "string") {
        return "Peer projection output must not contain symbol keys.";
      }
      if (UNSAFE_PEER_OUTPUT_KEYS.has(key)) {
        return `Peer projection output key ${JSON.stringify(key)} is forbidden.`;
      }
      const descriptor = Object.getOwnPropertyDescriptor(current.value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return "Peer projection objects must contain enumerable data properties only.";
      }
      pending.push({ value: descriptor.value, depth: current.depth + 1 });
    }
  }
  return null;
}

function projectionFieldIsPermanentlyExcluded(
  definition: PeerProjectionDefinition,
  field: string
) {
  const normalized = field.toLocaleLowerCase("en-US");
  if (
    definition.permanentlyExcludedFields.some((excluded) => {
      const normalizedExcluded = excluded.toLocaleLowerCase("en-US");
      return (
        normalized === normalizedExcluded ||
        normalized.startsWith(`${normalizedExcluded}.`)
      );
    })
  ) {
    return true;
  }
  return (
    definition.id === "custom.selected_entities.v1" &&
    PROTECTED_CUSTOM_FIELD_PATTERN.test(field.replaceAll(".", ""))
  );
}

export function validatePeerProjectionOutput(input: {
  projectionId: PeerProjectionId;
  payload: unknown;
  effectiveFields: readonly string[];
  maximumResultCount: number;
  maximumPayloadBytes: number;
}): ValidatedPeerProjectionOutput {
  const definition = getPeerProjectionDefinition(input.projectionId);
  const structuralError = inspectPeerProjectionJson(input.payload);
  if (structuralError) {
    throw new Error(structuralError);
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(input.payload);
  } catch {
    throw new Error("Peer projection output could not be serialized safely.");
  }
  const payloadBytes = Buffer.byteLength(serialized, "utf8");
  const maximumPayloadBytes = Math.min(
    definition.maximumResponseBytes,
    input.maximumPayloadBytes
  );
  if (
    !Number.isInteger(maximumPayloadBytes) ||
    maximumPayloadBytes < 0 ||
    payloadBytes > maximumPayloadBytes
  ) {
    throw new Error(
      `Peer projection output exceeds its ${maximumPayloadBytes}-byte authorization ceiling.`
    );
  }
  if (
    !Number.isInteger(input.maximumResultCount) ||
    input.maximumResultCount < 1
  ) {
    throw new Error("Peer projection result limit is invalid.");
  }

  const parsed = definition.outputSchema.parse(
    JSON.parse(serialized)
  ) as PeerProjectionOutputEnvelope;
  if (parsed.records.length > input.maximumResultCount) {
    throw new Error(
      `Peer projection output exceeds its ${input.maximumResultCount}-record authorization ceiling.`
    );
  }

  const effectiveFields = new Set(
    input.effectiveFields.map((field) =>
      peerProjectionOutputFieldSchema.parse(field)
    )
  );
  if (effectiveFields.size === 0) {
    throw new Error("Peer projection output has no authorized fields.");
  }
  const redactedFields = new Set<string>();
  const records = parsed.records.map((record) => {
    const fields: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(record.fields)) {
      if (projectionFieldIsPermanentlyExcluded(definition, field)) {
        throw new Error(
          `Peer projection output contains permanently excluded field ${field}.`
        );
      }
      if (effectiveFields.has(field)) {
        fields[field] = value;
      } else {
        redactedFields.add(field);
      }
    }
    if (Object.keys(fields).length === 0) {
      throw new Error(
        "Peer projection output record contains no fields authorized by the active grant."
      );
    }
    return { recordId: record.recordId, fields };
  });

  return {
    payload: { records },
    resultCount: records.length,
    payloadBytes,
    redactedFields: [...redactedFields].sort()
  };
}

export function validateProjectionRule(rule: PeerShareRule): void {
  const definition = getPeerProjectionDefinition(rule.projectionId);
  const normalizedExcluded = definition.permanentlyExcludedFields.map((field) =>
    field.toLocaleLowerCase("en-US")
  );
  const forbidden = rule.fields.include.filter((field) => {
    const normalized = field.toLocaleLowerCase("en-US");
    return normalizedExcluded.some(
      (excluded) => normalized === excluded || normalized.startsWith(`${excluded}.`)
    );
  });
  if (forbidden.length > 0) {
    throw new Error(
      `Projection ${rule.projectionId} cannot share: ${forbidden.join(", ")}.`
    );
  }
  if (definition.aggregate && rule.aggregation === null) {
    throw new Error(`Projection ${rule.projectionId} requires an aggregation policy.`);
  }
  if (!definition.aggregate && rule.aggregation !== null) {
    throw new Error(`Projection ${rule.projectionId} does not accept aggregation policy.`);
  }
  if (!definition.allowedPrecisions.includes(rule.precision)) {
    throw new Error(
      `Projection ${rule.projectionId} does not support precision ${rule.precision}.`
    );
  }
  if (rule.maximumPayloadBytes > definition.maximumResponseBytes) {
    throw new Error(
      `Projection ${rule.projectionId} exceeds its response byte ceiling.`
    );
  }
  if (definition.shareableFields !== null) {
    const shareable = new Set(definition.shareableFields);
    const unknown = rule.fields.include.filter((field) => !shareable.has(field));
    if (unknown.length > 0) {
      throw new Error(
        `Projection ${rule.projectionId} has unknown share fields: ${unknown.join(", ")}.`
      );
    }
  } else {
    const unsafeCustomFields = rule.fields.include.filter((field) =>
      /(secret|token|password|credential|privatekey|apikey|artifactbytes|rawhealth|privatepsyche)/i.test(
        field.replaceAll(".", "")
      )
    );
    if (unsafeCustomFields.length > 0) {
      throw new Error(
        `Custom projections cannot share protected fields: ${unsafeCustomFields.join(", ")}.`
      );
    }
  }
}

export function buildBroadShareRules(options: {
  approvedDeviceIds: string[];
  rollingFutureDays?: number;
}): PeerShareRule[] {
  if (options.approvedDeviceIds.length === 0) {
    throw new Error("Broad share requires at least one explicitly approved device.");
  }
  return definitionList
    .filter((definition) => definition.broadShareEligible)
    .map((definition) => {
      const hasTimeRange = definition.id === "calendar.availability.v1";
      return {
      id: `broad_${definition.id.replaceAll(".", "_")}`,
      effect: "allow" as const,
      projectionId: definition.id,
      entitySelector: null,
      fields: {
        include: [...definition.defaultFields],
        exclude: [...definition.permanentlyExcludedFields]
      },
      time: {
        startsAt: null,
        endsAt: null,
        rollingPastDays: hasTimeRange ? 0 : null,
        rollingFutureDays: hasTimeRange ? (options.rollingFutureDays ?? 90) : null
      },
      precision: definition.defaultPrecision,
      aggregation: null,
      approvedDeviceIds: Array.from(new Set(options.approvedDeviceIds)),
      devicePolicy: "explicit" as const,
      maximumResultCount: 100,
      maximumPayloadBytes: Math.min(definition.maximumResponseBytes, 262_144)
      };
    });
}

export type AggregateQueryAudit = {
  projectionId: PeerProjectionId;
  startsAt: string;
  endsAt: string;
  queriedAt: string;
  queryFingerprint: string;
  snapshotId: string;
  cost: number;
};

export type AggregatePrivacyDecision =
  | { allowed: true; cost: number; remainingBudget: number }
  | {
      allowed: false;
      reason:
        | "query_frequency"
        | "privacy_budget"
        | "differencing_risk"
        | "invalid_query";
    };

function canonicalizeQueryValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeQueryValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalizeQueryValue(nested)])
    );
  }
  return value;
}

export function fingerprintAggregateQuery(input: {
  projectionId: PeerProjectionId;
  startsAt: string;
  endsAt: string;
  timezone: string;
  granularity: "day" | "week" | "month" | "quarter";
  metrics: string[];
}): string {
  const parsedProjectionId = peerProjectionIdSchema.parse(input.projectionId);
  const { projectionId: _projectionId, ...rangeInput } = input;
  const parsedRange = boundedIsoRangeSchema({
    timezone: ianaTimeZoneSchema,
    granularity: z.enum(["day", "week", "month", "quarter"]),
    metrics: z.array(z.string().trim().min(1).max(80)).min(1).max(32)
  }).parse(rangeInput);
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonicalizeQueryValue({
          ...parsedRange,
          metrics: [...new Set(parsedRange.metrics)].sort(),
          projectionId: parsedProjectionId
        })
      )
    )
    .digest("hex");
}

function overlapRatio(
  left: { startsAt: string; endsAt: string },
  right: { startsAt: string; endsAt: string }
) {
  const leftStart = Date.parse(left.startsAt);
  const leftEnd = Date.parse(left.endsAt);
  const rightStart = Date.parse(right.startsAt);
  const rightEnd = Date.parse(right.endsAt);
  const overlap = Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart));
  const shorter = Math.min(leftEnd - leftStart, rightEnd - rightStart);
  return shorter <= 0 ? 0 : overlap / shorter;
}

export function assessAggregateQueryPrivacy(options: {
  projectionId: PeerProjectionId;
  startsAt: string;
  endsAt: string;
  queryFingerprint: string;
  snapshotId: string;
  now: Date;
  history: AggregateQueryAudit[];
  maximumQueriesPerDay: number;
  privacyBudget: number;
}): AggregatePrivacyDecision {
  const candidateStart = Date.parse(options.startsAt);
  const candidateEnd = Date.parse(options.endsAt);
  if (
    !Number.isFinite(candidateStart) ||
    !Number.isFinite(candidateEnd) ||
    candidateStart >= candidateEnd ||
    !Number.isFinite(options.now.getTime()) ||
    !/^[a-f0-9]{64}$/.test(options.queryFingerprint) ||
    options.snapshotId.trim().length === 0 ||
    !Number.isInteger(options.maximumQueriesPerDay) ||
    options.maximumQueriesPerDay < 1 ||
    !Number.isFinite(options.privacyBudget) ||
    options.privacyBudget < 0 ||
    options.history.some(
      (entry) =>
        !Number.isFinite(Date.parse(entry.startsAt)) ||
        !Number.isFinite(Date.parse(entry.endsAt)) ||
        Date.parse(entry.startsAt) >= Date.parse(entry.endsAt) ||
        !Number.isFinite(Date.parse(entry.queriedAt)) ||
        !Number.isFinite(entry.cost) ||
        entry.cost < 0 ||
        !/^[a-f0-9]{64}$/.test(entry.queryFingerprint) ||
        entry.snapshotId.trim().length === 0
    )
  ) {
    return { allowed: false, reason: "invalid_query" };
  }
  const since = options.now.getTime() - 86_400_000;
  const recent = options.history.filter(
    (entry) =>
      entry.projectionId === options.projectionId && Date.parse(entry.queriedAt) >= since
  );
  const exactReplay = recent.some(
    (entry) =>
      entry.queryFingerprint === options.queryFingerprint &&
      entry.snapshotId === options.snapshotId &&
      entry.startsAt === options.startsAt &&
      entry.endsAt === options.endsAt
  );
  const spent = recent.reduce((total, entry) => total + entry.cost, 0);
  if (exactReplay) {
    return {
      allowed: true,
      cost: 0,
      remainingBudget: Math.max(0, options.privacyBudget - spent)
    };
  }
  if (recent.length >= options.maximumQueriesPerDay) {
    return { allowed: false, reason: "query_frequency" };
  }
  const candidate = { startsAt: options.startsAt, endsAt: options.endsAt };
  const overlappingDifferentQuery = recent.some(
    (entry) =>
      entry.snapshotId === options.snapshotId &&
      entry.queryFingerprint !== options.queryFingerprint &&
      overlapRatio(entry, candidate) > 0
  );
  if (overlappingDifferentQuery) {
    return { allowed: false, reason: "differencing_risk" };
  }
  const cost = 1;
  if (spent + cost > options.privacyBudget) {
    return { allowed: false, reason: "privacy_budget" };
  }
  return {
    allowed: true,
    cost,
    remainingBudget: options.privacyBudget - spent - cost
  };
}

export type InterpretedPeopleQuestion =
  | {
      supported: true;
      projectionId: PeerProjectionId;
      confidence: number;
      requestedPrecision: string;
      requiresTimeResolution: boolean;
    }
  | { supported: false; reason: "unsupported_projection" | "question_empty" };

export function interpretPeopleQuestion(question: string): InterpretedPeopleQuestion {
  const normalized = question.trim().toLocaleLowerCase("en-US");
  if (!normalized) {
    return { supported: false, reason: "question_empty" };
  }
  if (
    /\b(cycl(?:e|ing|ed|ist|ists)?|bike|bikes|biking|bicycle|bicycles|ride distance|ride time)\b/.test(
      normalized
    )
  ) {
    return {
      supported: true,
      projectionId: "health.cycling.aggregate.v1",
      confidence: 0.95,
      requestedPrecision: "exact",
      requiresTimeResolution: true
    };
  }
  if (/\b(goal|priority|aim|next few months|working toward)\b/.test(normalized)) {
    return {
      supported: true,
      projectionId: "goals.horizon_summary.v1",
      confidence: 0.9,
      requestedPrecision: "exact",
      requiresTimeResolution: true
    };
  }
  if (/\b(available|availability|free|busy)\b/.test(normalized)) {
    return {
      supported: true,
      projectionId: "calendar.availability.v1",
      confidence: 0.85,
      requestedPrecision: "fifteen_minutes",
      requiresTimeResolution: true
    };
  }
  if (/\b(doing|plans?|schedule|calendar|next monday)\b/.test(normalized)) {
    return {
      supported: true,
      projectionId: "calendar.availability.v1",
      confidence: 0.85,
      requestedPrecision: "exact",
      requiresTimeResolution: true
    };
  }
  return { supported: false, reason: "unsupported_projection" };
}
