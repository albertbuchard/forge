import { z } from "zod";

const trimmed = z.string().trim();
const nonEmpty = trimmed.min(1);
const uniqueStrings = z.array(nonEmpty).transform((values) => Array.from(new Set(values)));

export const psycheValueSchema = z.object({
  title: nonEmpty,
  description: trimmed,
  valuedDirection: nonEmpty,
  whyItMatters: trimmed,
  linkedGoalIds: z.array(z.string()).default([]),
  linkedProjectIds: z.array(z.string()).default([]),
  linkedTaskIds: z.array(z.string()).default([]),
  committedActions: z.array(trimmed).default([])
});

export const behaviorPatternSchema = z.object({
  title: nonEmpty,
  description: trimmed,
  targetBehavior: nonEmpty,
  cueContexts: z.array(trimmed).default([]),
  shortTermPayoff: trimmed,
  longTermCost: trimmed,
  preferredResponse: nonEmpty,
  linkedValueIds: z.array(z.string()).default([]),
  linkedSchemaLabels: uniqueStrings.default([]),
  linkedModeIds: z.array(z.string()).default([]),
  linkedBeliefIds: z.array(z.string()).default([])
});

export const behaviorSchema = z.object({
  kind: z.enum(["away", "committed", "recovery"]),
  title: nonEmpty,
  description: trimmed,
  commonCues: z.array(trimmed).default([]),
  urgeStory: trimmed,
  shortTermPayoff: trimmed,
  longTermCost: trimmed,
  replacementMove: trimmed,
  repairPlan: trimmed,
  linkedPatternIds: z.array(z.string()).default([]),
  linkedValueIds: z.array(z.string()).default([]),
  linkedSchemaIds: z.array(z.string()).default([]),
  linkedModeIds: z.array(z.string()).default([])
});

export const beliefEntrySchema = z.object({
  schemaId: z.string().nullable(),
  statement: nonEmpty,
  beliefType: z.enum(["absolute", "conditional"]),
  originNote: trimmed,
  confidence: z.number().int().min(0).max(100),
  evidenceFor: z.array(trimmed).default([]),
  evidenceAgainst: z.array(trimmed).default([]),
  flexibleAlternative: trimmed,
  linkedValueIds: z.array(z.string()).default([]),
  linkedBehaviorIds: z.array(z.string()).default([]),
  linkedModeIds: z.array(z.string()).default([]),
  linkedReportIds: z.array(z.string()).default([])
});

export const modeProfileSchema = z.object({
  family: z.enum(["coping", "child", "critic_parent", "healthy_adult", "happy_child"]),
  archetype: trimmed,
  title: nonEmpty,
  persona: trimmed,
  imagery: trimmed,
  symbolicForm: trimmed,
  facialExpression: trimmed,
  fear: trimmed,
  burden: trimmed,
  protectiveJob: trimmed,
  originContext: trimmed,
  firstAppearanceAt: z.string().trim().nullable(),
  linkedPatternIds: z.array(z.string()).default([]),
  linkedBehaviorIds: z.array(z.string()).default([]),
  linkedValueIds: z.array(z.string()).default([])
});

export const modeGuideSessionSchema = z.object({
  summary: nonEmpty,
  answers: z.array(
    z.object({
      questionKey: nonEmpty,
      value: nonEmpty
    })
  ).min(1)
});

export const eventTypeSchema = z.object({
  label: nonEmpty,
  description: trimmed
});

export const emotionDefinitionSchema = z.object({
  label: nonEmpty,
  description: trimmed,
  category: trimmed
});

export const triggerEmotionSchema = z.object({
  id: nonEmpty,
  emotionDefinitionId: z.string().nullable(),
  label: nonEmpty,
  intensity: z.number().int().min(0).max(100),
  note: trimmed
});

export const triggerThoughtSchema = z.object({
  id: nonEmpty,
  text: nonEmpty,
  parentMode: trimmed,
  criticMode: trimmed,
  beliefId: z.string().nullable()
});

export const triggerBehaviorSchema = z.object({
  id: nonEmpty,
  text: nonEmpty,
  mode: trimmed,
  behaviorId: z.string().nullable()
});

export const modeTimelineEntrySchema = z.object({
  id: nonEmpty,
  stage: nonEmpty,
  modeId: z.string().nullable(),
  label: nonEmpty,
  note: trimmed
});

export const triggerReportSchema = z.object({
  title: nonEmpty,
  status: z.enum(["draft", "reviewed", "integrated"]).default("draft"),
  eventTypeId: z.string().nullable(),
  customEventType: trimmed,
  eventSituation: nonEmpty,
  occurredAt: z.string().trim().nullable(),
  emotions: z.array(triggerEmotionSchema).default([]),
  thoughts: z.array(triggerThoughtSchema).default([]),
  behaviors: z.array(triggerBehaviorSchema).default([]),
  consequences: z.object({
    selfShortTerm: z.array(trimmed).default([]),
    selfLongTerm: z.array(trimmed).default([]),
    othersShortTerm: z.array(trimmed).default([]),
    othersLongTerm: z.array(trimmed).default([])
  }),
  linkedPatternIds: z.array(z.string()).default([]),
  linkedValueIds: z.array(z.string()).default([]),
  linkedGoalIds: z.array(z.string()).default([]),
  linkedProjectIds: z.array(z.string()).default([]),
  linkedTaskIds: z.array(z.string()).default([]),
  linkedBehaviorIds: z.array(z.string()).default([]),
  linkedBeliefIds: z.array(z.string()).default([]),
  linkedModeIds: z.array(z.string()).default([]),
  modeOverlays: z.array(trimmed).default([]),
  schemaLinks: z.array(trimmed).default([]),
  modeTimeline: z.array(modeTimelineEntrySchema).default([]),
  nextMoves: z.array(trimmed).default([])
});

export const commentSchema = z.object({
  entityType: nonEmpty,
  entityId: nonEmpty,
  anchorKey: trimmed.nullable().optional(),
  body: nonEmpty,
  author: trimmed.nullable().optional()
});

export type PsycheValueInput = z.infer<typeof psycheValueSchema>;
export type BehaviorPatternInput = z.infer<typeof behaviorPatternSchema>;
export type BehaviorInput = z.infer<typeof behaviorSchema>;
export type BeliefEntryInput = z.infer<typeof beliefEntrySchema>;
export type ModeProfileInput = z.infer<typeof modeProfileSchema>;
export type ModeGuideSessionInput = z.infer<typeof modeGuideSessionSchema>;
export type EventTypeInput = z.infer<typeof eventTypeSchema>;
export type EmotionDefinitionInput = z.infer<typeof emotionDefinitionSchema>;
export type TriggerReportInput = z.infer<typeof triggerReportSchema>;
export type CommentInput = z.infer<typeof commentSchema>;
