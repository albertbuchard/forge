import { createHash } from "node:crypto";
import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(240);
const fieldSchema = z.enum([
  "start",
  "end",
  "timezone",
  "busyState",
  "eventTitle",
  "eventLocation",
  "goalTitle",
  "goalSummary",
  "goalState",
  "goalProgress",
  "duration",
  "distance",
  "activityCount",
  "energy",
  "displayName",
  "preferredName",
  "pronouns",
  "relationshipLabel",
  "shortDescription",
  "lifeEventTitle",
  "lifeEventType",
  "lifeEventPlace",
  "movementDuration",
  "movementDistance",
  "customTitle",
  "customSummary",
  "customState"
]);
const precisionSchema = z.enum([
  "exact",
  "fifteen_minutes",
  "hour",
  "day",
  "week",
  "month",
  "aggregate_only"
]);
const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "A valid IANA time zone is required.");

export const peerQueryIntervalSchema = z
  .object({
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    timeZone: timeZoneSchema
  })
  .strict()
  .superRefine((interval, context) => {
    const startsAt = Date.parse(interval.startsAt);
    const endsAt = Date.parse(interval.endsAt);
    if (startsAt >= endsAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The question interval end must be after its start.",
        path: ["endsAt"]
      });
    } else if (endsAt - startsAt > 366 * 86_400_000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A peer query interval cannot exceed 366 days.",
        path: ["endsAt"]
      });
    }
  });

function uniqueArray<T extends z.ZodTypeAny>(schema: T, maximum: number) {
  return z
    .array(schema)
    .max(maximum)
    .superRefine((values, context) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Duplicate values are not allowed."
        });
      }
    });
}

const entityIdsSchema = uniqueArray(identifierSchema, 256).default([]);
const emptyEntityIdsSchema = z.array(identifierSchema).max(0).default([]);
const fieldsSchema = uniqueArray(fieldSchema, 64).default([]);
const projectionFields = <T extends [string, ...string[]]>(values: T) =>
  uniqueArray(z.enum(values), values.length).default([]);
const calendarFieldsSchema = projectionFields([
  "start",
  "end",
  "timezone",
  "busyState",
  "eventTitle",
  "eventLocation"
]);
const goalFieldsSchema = projectionFields([
  "goalTitle",
  "goalSummary",
  "goalState",
  "goalProgress"
]);
const cyclingFieldsSchema = projectionFields([
  "duration",
  "distance",
  "activityCount",
  "energy"
]);
const profileFieldsSchema = projectionFields([
  "displayName",
  "preferredName",
  "pronouns",
  "relationshipLabel",
  "shortDescription"
]);
const lifeEventFieldsSchema = projectionFields([
  "lifeEventTitle",
  "lifeEventType",
  "lifeEventPlace"
]);
const movementFieldsSchema = projectionFields([
  "movementDuration",
  "movementDistance"
]);
const customFieldsSchema = projectionFields([
  "customTitle",
  "customSummary",
  "customState"
]);
const emptyParametersSchema = z.object({}).strict();
const commonQueryShape = {
  entityIds: entityIdsSchema,
  fields: fieldsSchema,
  precision: precisionSchema,
  maximumResultCount: z.number().int().min(1).max(1_000).default(100)
};
const intervalQueryShape = {
  ...commonQueryShape,
  interval: peerQueryIntervalSchema
};

export const peerTypedQuestionSchema = z.discriminatedUnion("projectionId", [
  z
    .object({
      projectionId: z.literal("calendar.availability.v1"),
      parameters: emptyParametersSchema,
      ...intervalQueryShape,
      entityIds: emptyEntityIdsSchema,
      fields: calendarFieldsSchema,
      precision: z.enum(["exact", "fifteen_minutes", "hour"])
    })
    .strict(),
  z
    .object({
      projectionId: z.literal("calendar.selected_events.v1"),
      parameters: emptyParametersSchema,
      ...intervalQueryShape,
      fields: calendarFieldsSchema,
      precision: z.literal("exact")
    })
    .strict(),
  z
    .object({
      projectionId: z.literal("goals.horizon_summary.v1"),
      parameters: emptyParametersSchema,
      ...intervalQueryShape,
      entityIds: emptyEntityIdsSchema,
      fields: goalFieldsSchema,
      precision: z.literal("exact")
    })
    .strict(),
  z
    .object({
      projectionId: z.literal("health.cycling.aggregate.v1"),
      parameters: z
        .object({
          granularity: z.enum(["day", "week", "month"]),
          units: z.string().trim().min(1).max(240)
        })
        .strict(),
      ...intervalQueryShape,
      entityIds: emptyEntityIdsSchema,
      fields: cyclingFieldsSchema,
      precision: z.literal("exact")
    })
    .strict(),
  z
    .object({
      projectionId: z.literal("person.profile.v1"),
      parameters: emptyParametersSchema,
      interval: z.null(),
      ...commonQueryShape,
      entityIds: emptyEntityIdsSchema,
      fields: profileFieldsSchema,
      precision: z.literal("exact")
    })
    .strict(),
  z
    .object({
      projectionId: z.literal("life_events.selected.v1"),
      parameters: emptyParametersSchema,
      ...intervalQueryShape,
      fields: lifeEventFieldsSchema,
      precision: z.literal("exact")
    })
    .strict(),
  z
    .object({
      projectionId: z.literal("movement.aggregate.v1"),
      parameters: z
        .object({ granularity: z.enum(["day", "week", "month"]) })
        .strict(),
      ...intervalQueryShape,
      entityIds: emptyEntityIdsSchema,
      fields: movementFieldsSchema,
      precision: z.literal("exact")
    })
    .strict(),
  z
    .object({
      projectionId: z.literal("custom.selected_entities.v1"),
      parameters: emptyParametersSchema,
      interval: z.null(),
      ...commonQueryShape,
      fields: customFieldsSchema,
      precision: z.literal("exact")
    })
    .strict()
]);

export type PeerTypedQuestion = z.infer<typeof peerTypedQuestionSchema>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, nested]) => [key, canonicalize(nested)])
    );
  }
  return value;
}

export function peerQueryCacheIdentity(query: PeerTypedQuestion | unknown) {
  const parsed = peerTypedQuestionSchema.parse(query);
  return {
    projectionId: parsed.projectionId,
    interval: parsed.interval,
    parameters: parsed.parameters,
    fields: [...parsed.fields].sort(),
    entityIds: [...parsed.entityIds].sort()
  };
}

export function hashPeerQueryCacheIdentity(
  query: PeerTypedQuestion | unknown
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(peerQueryCacheIdentity(query))), "utf8")
    .digest("hex");
}
