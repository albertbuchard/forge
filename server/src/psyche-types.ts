import { z } from "zod";
import { activityEventSchema, noteSchema, userSummarySchema } from "./types.js";

const trimmedString = z.string().trim();
const nonEmptyTrimmedString = trimmedString.min(1);
const uniqueStringArraySchema = z.array(nonEmptyTrimmedString);
const optionalOwnedUserIdSchema = z.string().trim().min(1).nullable().optional();
const ownedEntityFieldsSchema = {
  userId: optionalOwnedUserIdSchema,
  user: userSummarySchema.nullable().optional()
};

export const triggerReportStatusSchema = z.enum(["draft", "reviewed", "integrated"]);
export const behaviorKindSchema = z.enum(["away", "committed", "recovery"]);
export const beliefTypeSchema = z.enum(["absolute", "conditional"]);
export const modeFamilySchema = z.enum(["coping", "child", "critic_parent", "healthy_adult", "happy_child"]);
export const schemaTypeSchema = z.enum(["maladaptive", "adaptive"]);

export const PSYCHE_ENTITY_TYPES = [
  "psyche_value",
  "behavior_pattern",
  "behavior",
  "belief_entry",
  "mode_profile",
  "trigger_report"
] as const;

export const domainSchema = z.object({
  id: z.string(),
  slug: nonEmptyTrimmedString,
  title: nonEmptyTrimmedString,
  description: trimmedString,
  themeColor: z.string(),
  sensitive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const schemaCatalogEntrySchema = z.object({
  id: z.string(),
  slug: nonEmptyTrimmedString,
  title: nonEmptyTrimmedString,
  family: nonEmptyTrimmedString,
  schemaType: schemaTypeSchema,
  description: trimmedString,
  createdAt: z.string(),
  updatedAt: z.string()
});

export const eventTypeSchema = z.object({
  id: z.string(),
  domainId: z.string(),
  label: nonEmptyTrimmedString,
  description: trimmedString,
  system: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  ...ownedEntityFieldsSchema
});

export const emotionDefinitionSchema = z.object({
  id: z.string(),
  domainId: z.string(),
  label: nonEmptyTrimmedString,
  description: trimmedString,
  category: trimmedString,
  system: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  ...ownedEntityFieldsSchema
});

export const psycheValueSchema = z.object({
  id: z.string(),
  domainId: z.string(),
  title: nonEmptyTrimmedString,
  description: trimmedString,
  valuedDirection: trimmedString,
  whyItMatters: trimmedString,
  linkedGoalIds: uniqueStringArraySchema.default([]),
  linkedProjectIds: uniqueStringArraySchema.default([]),
  linkedTaskIds: uniqueStringArraySchema.default([]),
  committedActions: z.array(trimmedString).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  ...ownedEntityFieldsSchema
});

export const behaviorPatternSchema = z.object({
  id: z.string(),
  domainId: z.string(),
  title: nonEmptyTrimmedString,
  description: trimmedString,
  targetBehavior: trimmedString,
  cueContexts: z.array(trimmedString).default([]),
  shortTermPayoff: trimmedString,
  longTermCost: trimmedString,
  preferredResponse: trimmedString,
  linkedValueIds: uniqueStringArraySchema.default([]),
  linkedSchemaLabels: z.array(trimmedString).default([]),
  linkedModeLabels: z.array(trimmedString).default([]),
  linkedModeIds: uniqueStringArraySchema.default([]),
  linkedBeliefIds: uniqueStringArraySchema.default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  ...ownedEntityFieldsSchema
});

export const behaviorSchema = z.object({
  id: z.string(),
  domainId: z.string(),
  kind: behaviorKindSchema,
  title: nonEmptyTrimmedString,
  description: trimmedString,
  commonCues: z.array(trimmedString).default([]),
  urgeStory: trimmedString,
  shortTermPayoff: trimmedString,
  longTermCost: trimmedString,
  replacementMove: trimmedString,
  repairPlan: trimmedString,
  linkedPatternIds: uniqueStringArraySchema.default([]),
  linkedValueIds: uniqueStringArraySchema.default([]),
  linkedSchemaIds: uniqueStringArraySchema.default([]),
  linkedModeIds: uniqueStringArraySchema.default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  ...ownedEntityFieldsSchema
});

export const beliefEntrySchema = z.object({
  id: z.string(),
  domainId: z.string(),
  schemaId: z.string().nullable(),
  statement: nonEmptyTrimmedString,
  beliefType: beliefTypeSchema,
  originNote: trimmedString,
  confidence: z.number().int().min(0).max(100),
  evidenceFor: z.array(trimmedString).default([]),
  evidenceAgainst: z.array(trimmedString).default([]),
  flexibleAlternative: trimmedString,
  linkedValueIds: uniqueStringArraySchema.default([]),
  linkedBehaviorIds: uniqueStringArraySchema.default([]),
  linkedModeIds: uniqueStringArraySchema.default([]),
  linkedReportIds: uniqueStringArraySchema.default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  ...ownedEntityFieldsSchema
});

export const modeProfileSchema = z.object({
  id: z.string(),
  domainId: z.string(),
  family: modeFamilySchema,
  archetype: trimmedString,
  title: nonEmptyTrimmedString,
  persona: trimmedString,
  imagery: trimmedString,
  symbolicForm: trimmedString,
  facialExpression: trimmedString,
  fear: trimmedString,
  burden: trimmedString,
  protectiveJob: trimmedString,
  originContext: trimmedString,
  firstAppearanceAt: z.string().nullable(),
  linkedPatternIds: uniqueStringArraySchema.default([]),
  linkedBehaviorIds: uniqueStringArraySchema.default([]),
  linkedValueIds: uniqueStringArraySchema.default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  ...ownedEntityFieldsSchema
});

export const modeTimelineEntrySchema = z.object({
  id: z.string(),
  stage: nonEmptyTrimmedString,
  modeId: z.string().nullable(),
  label: nonEmptyTrimmedString,
  note: trimmedString.default("")
});

export const modeGuideAnswerSchema = z.object({
  questionKey: nonEmptyTrimmedString,
  value: nonEmptyTrimmedString
});

export const modeGuideResultSchema = z.object({
  family: modeFamilySchema,
  archetype: trimmedString,
  label: nonEmptyTrimmedString,
  confidence: z.number().min(0).max(1),
  reasoning: trimmedString
});

export const modeGuideSessionSchema = z.object({
  id: z.string(),
  summary: nonEmptyTrimmedString,
  answers: z.array(modeGuideAnswerSchema),
  results: z.array(modeGuideResultSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  ...ownedEntityFieldsSchema
});

export const triggerEmotionSchema = z.object({
  id: z.string(),
  emotionDefinitionId: z.string().nullable().default(null),
  label: nonEmptyTrimmedString,
  intensity: z.number().int().min(0).max(100),
  note: trimmedString.default("")
});

export const triggerThoughtSchema = z.object({
  id: z.string(),
  text: nonEmptyTrimmedString,
  parentMode: trimmedString.default(""),
  criticMode: trimmedString.default(""),
  beliefId: z.string().nullable().default(null)
});

export const triggerBehaviorSchema = z.object({
  id: z.string(),
  text: nonEmptyTrimmedString,
  mode: trimmedString.default(""),
  behaviorId: z.string().nullable().default(null)
});

export const triggerConsequencesSchema = z.object({
  selfShortTerm: z.array(trimmedString).default([]),
  selfLongTerm: z.array(trimmedString).default([]),
  othersShortTerm: z.array(trimmedString).default([]),
  othersLongTerm: z.array(trimmedString).default([])
});

export const triggerReportSchema = z.object({
  id: z.string(),
  domainId: z.string(),
  title: nonEmptyTrimmedString,
  status: triggerReportStatusSchema,
  eventTypeId: z.string().nullable(),
  customEventType: trimmedString,
  eventSituation: trimmedString,
  occurredAt: z.string().nullable(),
  emotions: z.array(triggerEmotionSchema).default([]),
  thoughts: z.array(triggerThoughtSchema).default([]),
  behaviors: z.array(triggerBehaviorSchema).default([]),
  consequences: triggerConsequencesSchema,
  linkedPatternIds: uniqueStringArraySchema.default([]),
  linkedValueIds: uniqueStringArraySchema.default([]),
  linkedGoalIds: uniqueStringArraySchema.default([]),
  linkedProjectIds: uniqueStringArraySchema.default([]),
  linkedTaskIds: uniqueStringArraySchema.default([]),
  linkedBehaviorIds: uniqueStringArraySchema.default([]),
  linkedBeliefIds: uniqueStringArraySchema.default([]),
  linkedModeIds: uniqueStringArraySchema.default([]),
  modeOverlays: z.array(trimmedString).default([]),
  schemaLinks: z.array(trimmedString).default([]),
  modeTimeline: z.array(modeTimelineEntrySchema).default([]),
  nextMoves: z.array(trimmedString).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  ...ownedEntityFieldsSchema
});

export const schemaPressureEntrySchema = z.object({
  schemaId: z.string(),
  title: nonEmptyTrimmedString,
  activationCount: z.number().int().nonnegative()
});

export const psycheOverviewPayloadSchema = z.object({
  generatedAt: z.string(),
  domain: domainSchema,
  values: z.array(psycheValueSchema),
  patterns: z.array(behaviorPatternSchema),
  behaviors: z.array(behaviorSchema),
  beliefs: z.array(beliefEntrySchema),
  modes: z.array(modeProfileSchema),
  reports: z.array(triggerReportSchema),
  schemaPressure: z.array(schemaPressureEntrySchema),
  openInsights: z.number().int().nonnegative(),
  openNotes: z.number().int().nonnegative(),
  committedActions: z.array(trimmedString)
});

export const psycheObservationEntrySchema = z.object({
  id: z.string(),
  observedAt: z.string(),
  tags: z.array(trimmedString).default([]),
  note: noteSchema,
  linkedPatterns: z.array(behaviorPatternSchema),
  linkedReports: z.array(triggerReportSchema)
});

export const psycheObservationActivityEntrySchema = z.object({
  id: z.string(),
  observedAt: z.string(),
  tags: z.array(trimmedString).default([]),
  event: activityEventSchema
});

export const psycheObservationCalendarPayloadSchema = z.object({
  generatedAt: z.string(),
  from: z.string(),
  to: z.string(),
  observations: z.array(psycheObservationEntrySchema),
  activity: z.array(psycheObservationActivityEntrySchema).default([]),
  availableTags: z.array(trimmedString)
});

export const createPsycheValueSchema = z.object({
  title: nonEmptyTrimmedString,
  description: trimmedString.default(""),
  valuedDirection: trimmedString.default(""),
  whyItMatters: trimmedString.default(""),
  linkedGoalIds: uniqueStringArraySchema.default([]),
  linkedProjectIds: uniqueStringArraySchema.default([]),
  linkedTaskIds: uniqueStringArraySchema.default([]),
  committedActions: z.array(trimmedString).default([]),
  userId: optionalOwnedUserIdSchema
});

export const updatePsycheValueSchema = createPsycheValueSchema.partial();

export const createBehaviorPatternSchema = z.object({
  title: nonEmptyTrimmedString,
  description: trimmedString.default(""),
  targetBehavior: trimmedString.default(""),
  cueContexts: z.array(trimmedString).default([]),
  shortTermPayoff: trimmedString.default(""),
  longTermCost: trimmedString.default(""),
  preferredResponse: trimmedString.default(""),
  linkedValueIds: uniqueStringArraySchema.default([]),
  linkedSchemaLabels: z.array(trimmedString).default([]),
  linkedModeLabels: z.array(trimmedString).default([]),
  linkedModeIds: uniqueStringArraySchema.default([]),
  linkedBeliefIds: uniqueStringArraySchema.default([]),
  userId: optionalOwnedUserIdSchema
});

export const updateBehaviorPatternSchema = createBehaviorPatternSchema.partial();

export const createBehaviorSchema = z.object({
  kind: behaviorKindSchema,
  title: nonEmptyTrimmedString,
  description: trimmedString.default(""),
  commonCues: z.array(trimmedString).default([]),
  urgeStory: trimmedString.default(""),
  shortTermPayoff: trimmedString.default(""),
  longTermCost: trimmedString.default(""),
  replacementMove: trimmedString.default(""),
  repairPlan: trimmedString.default(""),
  linkedPatternIds: uniqueStringArraySchema.default([]),
  linkedValueIds: uniqueStringArraySchema.default([]),
  linkedSchemaIds: uniqueStringArraySchema.default([]),
  linkedModeIds: uniqueStringArraySchema.default([]),
  userId: optionalOwnedUserIdSchema
});

export const updateBehaviorSchema = createBehaviorSchema.partial();

export const createBeliefEntrySchema = z.object({
  schemaId: z.string().nullable().default(null),
  statement: nonEmptyTrimmedString,
  beliefType: beliefTypeSchema,
  originNote: trimmedString.default(""),
  confidence: z.number().int().min(0).max(100).default(60),
  evidenceFor: z.array(trimmedString).default([]),
  evidenceAgainst: z.array(trimmedString).default([]),
  flexibleAlternative: trimmedString.default(""),
  linkedValueIds: uniqueStringArraySchema.default([]),
  linkedBehaviorIds: uniqueStringArraySchema.default([]),
  linkedModeIds: uniqueStringArraySchema.default([]),
  linkedReportIds: uniqueStringArraySchema.default([]),
  userId: optionalOwnedUserIdSchema
});

export const updateBeliefEntrySchema = createBeliefEntrySchema.partial();

export const createModeProfileSchema = z.object({
  family: modeFamilySchema,
  archetype: trimmedString.default(""),
  title: nonEmptyTrimmedString,
  persona: trimmedString.default(""),
  imagery: trimmedString.default(""),
  symbolicForm: trimmedString.default(""),
  facialExpression: trimmedString.default(""),
  fear: trimmedString.default(""),
  burden: trimmedString.default(""),
  protectiveJob: trimmedString.default(""),
  originContext: trimmedString.default(""),
  firstAppearanceAt: trimmedString.nullable().default(null),
  linkedPatternIds: uniqueStringArraySchema.default([]),
  linkedBehaviorIds: uniqueStringArraySchema.default([]),
  linkedValueIds: uniqueStringArraySchema.default([]),
  userId: optionalOwnedUserIdSchema
});

export const updateModeProfileSchema = createModeProfileSchema.partial();

export const createModeGuideSessionSchema = z.object({
  summary: nonEmptyTrimmedString,
  answers: z.array(modeGuideAnswerSchema).min(1),
  userId: optionalOwnedUserIdSchema
});

export const updateModeGuideSessionSchema = createModeGuideSessionSchema.partial();

export const createEventTypeSchema = z.object({
  label: nonEmptyTrimmedString,
  description: trimmedString.default(""),
  userId: optionalOwnedUserIdSchema
});

export const updateEventTypeSchema = createEventTypeSchema.partial();

export const createEmotionDefinitionSchema = z.object({
  label: nonEmptyTrimmedString,
  description: trimmedString.default(""),
  category: trimmedString.default(""),
  userId: optionalOwnedUserIdSchema
});

export const updateEmotionDefinitionSchema = createEmotionDefinitionSchema.partial();

export const createTriggerReportSchema = z.object({
  title: nonEmptyTrimmedString,
  status: triggerReportStatusSchema.default("draft"),
  eventTypeId: z.string().nullable().default(null),
  customEventType: trimmedString.default(""),
  eventSituation: trimmedString.default(""),
  occurredAt: trimmedString.nullable().default(null),
  emotions: z.array(triggerEmotionSchema.omit({ id: true }).extend({ id: z.string().optional() })).default([]),
  thoughts: z.array(triggerThoughtSchema.omit({ id: true }).extend({ id: z.string().optional() })).default([]),
  behaviors: z.array(triggerBehaviorSchema.omit({ id: true }).extend({ id: z.string().optional() })).default([]),
  consequences: triggerConsequencesSchema.default({
    selfShortTerm: [],
    selfLongTerm: [],
    othersShortTerm: [],
    othersLongTerm: []
  }),
  linkedPatternIds: uniqueStringArraySchema.default([]),
  linkedValueIds: uniqueStringArraySchema.default([]),
  linkedGoalIds: uniqueStringArraySchema.default([]),
  linkedProjectIds: uniqueStringArraySchema.default([]),
  linkedTaskIds: uniqueStringArraySchema.default([]),
  linkedBehaviorIds: uniqueStringArraySchema.default([]),
  linkedBeliefIds: uniqueStringArraySchema.default([]),
  linkedModeIds: uniqueStringArraySchema.default([]),
  modeOverlays: z.array(trimmedString).default([]),
  schemaLinks: z.array(trimmedString).default([]),
  modeTimeline: z.array(modeTimelineEntrySchema.omit({ id: true }).extend({ id: z.string().optional() })).default([]),
  nextMoves: z.array(trimmedString).default([]),
  userId: optionalOwnedUserIdSchema
});

export const updateTriggerReportSchema = createTriggerReportSchema.partial();

export type Domain = z.infer<typeof domainSchema>;
export type SchemaCatalogEntry = z.infer<typeof schemaCatalogEntrySchema>;
export type EventType = z.infer<typeof eventTypeSchema>;
export type EmotionDefinition = z.infer<typeof emotionDefinitionSchema>;
export type PsycheValue = z.infer<typeof psycheValueSchema>;
export type BehaviorPattern = z.infer<typeof behaviorPatternSchema>;
export type Behavior = z.infer<typeof behaviorSchema>;
export type BeliefEntry = z.infer<typeof beliefEntrySchema>;
export type ModeProfile = z.infer<typeof modeProfileSchema>;
export type ModeTimelineEntry = z.infer<typeof modeTimelineEntrySchema>;
export type ModeGuideSession = z.infer<typeof modeGuideSessionSchema>;
export type TriggerReport = z.infer<typeof triggerReportSchema>;
export type PsycheOverviewPayload = z.infer<typeof psycheOverviewPayloadSchema>;
export type PsycheObservationEntry = z.infer<typeof psycheObservationEntrySchema>;
export type PsycheObservationActivityEntry = z.infer<
  typeof psycheObservationActivityEntrySchema
>;
export type PsycheObservationCalendarPayload = z.infer<
  typeof psycheObservationCalendarPayloadSchema
>;
export type CreatePsycheValueInput = z.infer<typeof createPsycheValueSchema>;
export type UpdatePsycheValueInput = z.infer<typeof updatePsycheValueSchema>;
export type CreateBehaviorPatternInput = z.infer<typeof createBehaviorPatternSchema>;
export type UpdateBehaviorPatternInput = z.infer<typeof updateBehaviorPatternSchema>;
export type CreateBehaviorInput = z.infer<typeof createBehaviorSchema>;
export type UpdateBehaviorInput = z.infer<typeof updateBehaviorSchema>;
export type CreateBeliefEntryInput = z.infer<typeof createBeliefEntrySchema>;
export type UpdateBeliefEntryInput = z.infer<typeof updateBeliefEntrySchema>;
export type CreateModeProfileInput = z.infer<typeof createModeProfileSchema>;
export type UpdateModeProfileInput = z.infer<typeof updateModeProfileSchema>;
export type CreateModeGuideSessionInput = z.infer<typeof createModeGuideSessionSchema>;
export type UpdateModeGuideSessionInput = z.infer<typeof updateModeGuideSessionSchema>;
export type CreateEventTypeInput = z.infer<typeof createEventTypeSchema>;
export type UpdateEventTypeInput = z.infer<typeof updateEventTypeSchema>;
export type CreateEmotionDefinitionInput = z.infer<typeof createEmotionDefinitionSchema>;
export type UpdateEmotionDefinitionInput = z.infer<typeof updateEmotionDefinitionSchema>;
export type CreateTriggerReportInput = z.infer<typeof createTriggerReportSchema>;
export type UpdateTriggerReportInput = z.infer<typeof updateTriggerReportSchema>;
