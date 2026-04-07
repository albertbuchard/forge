import { z } from "zod";

const trimmedString = z.string().trim();
const nonEmptyTrimmedString = trimmedString.min(1);
const stringArraySchema = z.array(nonEmptyTrimmedString);

export const questionnaireSourceClassSchema = z.enum([
  "public_domain",
  "free_use",
  "open_access",
  "open_noncommercial",
  "free_clinician",
  "secondary_verified"
]);

export const questionnaireAvailabilitySchema = z.enum([
  "open",
  "free_clinician",
  "custom"
]);

export const questionnairePresentationModeSchema = z.enum([
  "single_question",
  "batched_likert"
]);

export const questionnaireVersionStatusSchema = z.enum([
  "draft",
  "published",
  "archived"
]);

export const questionnaireInstrumentStatusSchema = z.enum([
  "active",
  "archived"
]);

export const questionnaireRunStatusSchema = z.enum([
  "draft",
  "completed",
  "abandoned"
]);

export const questionnaireComparatorSchema = z.enum([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte"
]);

export const questionnaireScoreValueTypeSchema = z.enum([
  "number",
  "text",
  "boolean",
  "percent"
]);

export const questionnaireMissingModeSchema = z.enum([
  "require_all",
  "allow_partial",
  "min_answered"
]);

export const questionnaireOptionSchema = z.object({
  key: nonEmptyTrimmedString,
  label: nonEmptyTrimmedString,
  value: z.number(),
  description: trimmedString.default("")
});

export const questionnaireFlowRuleSchema = z.object({
  script: nonEmptyTrimmedString
});

export const questionnaireItemSchema = z.object({
  id: nonEmptyTrimmedString,
  prompt: nonEmptyTrimmedString,
  shortLabel: trimmedString.default(""),
  description: trimmedString.default(""),
  helperText: trimmedString.default(""),
  required: z.boolean().default(true),
  visibility: questionnaireFlowRuleSchema.nullable().default(null),
  options: z.array(questionnaireOptionSchema).min(1),
  tags: stringArraySchema.default([])
});

export const questionnaireSectionSchema = z.object({
  id: nonEmptyTrimmedString,
  title: nonEmptyTrimmedString,
  description: trimmedString.default(""),
  visibility: questionnaireFlowRuleSchema.nullable().default(null),
  itemIds: stringArraySchema.min(1)
});

export const questionnaireDefinitionSchema = z.object({
  locale: nonEmptyTrimmedString.default("en"),
  instructions: trimmedString.default(""),
  completionNote: trimmedString.default(""),
  presentationMode: questionnairePresentationModeSchema,
  responseStyle: nonEmptyTrimmedString,
  itemIds: stringArraySchema.min(1),
  items: z.array(questionnaireItemSchema).min(1),
  sections: z.array(questionnaireSectionSchema).min(1),
  pageSize: z.number().int().min(1).max(64).nullable().default(null)
});

export const questionnaireConstExpressionSchema = z.object({
  kind: z.literal("const"),
  value: z.union([z.number(), z.string(), z.boolean(), z.null()])
});

export const questionnaireAnswerExpressionSchema = z.object({
  kind: z.literal("answer"),
  itemId: nonEmptyTrimmedString,
  defaultValue: z.number().nullable().optional()
});

export const questionnaireScoreExpressionRefSchema = z.object({
  kind: z.literal("score"),
  scoreKey: nonEmptyTrimmedString
});

export type QuestionnaireScoreExpression =
  | z.infer<typeof questionnaireConstExpressionSchema>
  | z.infer<typeof questionnaireAnswerExpressionSchema>
  | z.infer<typeof questionnaireScoreExpressionRefSchema>
  | {
      kind: "add" | "multiply" | "min" | "max";
      values: QuestionnaireScoreExpression[];
    }
  | {
      kind: "subtract" | "divide";
      left: QuestionnaireScoreExpression;
      right: QuestionnaireScoreExpression;
      zeroValue?: number | null;
    }
  | {
      kind: "sum" | "average";
      itemIds: string[];
    }
  | {
      kind: "weighted_sum";
      terms: Array<{ itemId: string; weight: number }>;
    }
  | {
      kind: "count_if" | "filtered_mean";
      itemIds: string[];
      comparator: z.infer<typeof questionnaireComparatorSchema>;
      target: number;
    }
  | {
      kind: "compare";
      comparator: z.infer<typeof questionnaireComparatorSchema>;
      left: QuestionnaireScoreExpression;
      right: QuestionnaireScoreExpression;
    }
  | {
      kind: "if";
      condition: QuestionnaireScoreExpression;
      then: QuestionnaireScoreExpression;
      else: QuestionnaireScoreExpression;
    }
  | {
      kind: "round";
      value: QuestionnaireScoreExpression;
      digits: number;
    };

export const questionnaireScoreExpressionSchema: z.ZodType<QuestionnaireScoreExpression> =
  z.lazy(() =>
    z.union([
      questionnaireConstExpressionSchema,
      questionnaireAnswerExpressionSchema,
      questionnaireScoreExpressionRefSchema,
      z.object({
        kind: z.enum(["add", "multiply", "min", "max"]),
        values: z.array(questionnaireScoreExpressionSchema).min(1)
      }),
      z.object({
        kind: z.enum(["subtract", "divide"]),
        left: questionnaireScoreExpressionSchema,
        right: questionnaireScoreExpressionSchema,
        zeroValue: z.number().nullable().optional()
      }),
      z.object({
        kind: z.enum(["sum", "average"]),
        itemIds: stringArraySchema.min(1)
      }),
      z.object({
        kind: z.literal("weighted_sum"),
        terms: z
          .array(
            z.object({
              itemId: nonEmptyTrimmedString,
              weight: z.number()
            })
          )
          .min(1)
      }),
      z.object({
        kind: z.enum(["count_if", "filtered_mean"]),
        itemIds: stringArraySchema.min(1),
        comparator: questionnaireComparatorSchema,
        target: z.number()
      }),
      z.object({
        kind: z.literal("compare"),
        comparator: questionnaireComparatorSchema,
        left: questionnaireScoreExpressionSchema,
        right: questionnaireScoreExpressionSchema
      }),
      z.object({
        kind: z.literal("if"),
        condition: questionnaireScoreExpressionSchema,
        then: questionnaireScoreExpressionSchema,
        else: questionnaireScoreExpressionSchema
      }),
      z.object({
        kind: z.literal("round"),
        value: questionnaireScoreExpressionSchema,
        digits: z.number().int().min(0).max(6)
      })
    ])
  );

export const questionnaireMissingPolicySchema = z.object({
  mode: questionnaireMissingModeSchema,
  minAnswered: z.number().int().min(0).nullable().optional()
});

export const questionnaireScoreBandSchema = z.object({
  label: nonEmptyTrimmedString,
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  severity: trimmedString.default("")
});

export const questionnaireScoreDefinitionSchema = z.object({
  key: nonEmptyTrimmedString,
  label: nonEmptyTrimmedString,
  description: trimmedString.default(""),
  valueType: questionnaireScoreValueTypeSchema.default("number"),
  expression: questionnaireScoreExpressionSchema,
  dependsOnItemIds: stringArraySchema.default([]),
  missingPolicy: questionnaireMissingPolicySchema
    .default({ mode: "require_all" })
    .optional(),
  bands: z.array(questionnaireScoreBandSchema).default([]),
  roundTo: z.number().int().min(0).max(6).nullable().optional(),
  unitLabel: trimmedString.default("")
});

export const questionnaireScoringSchema = z.object({
  scores: z.array(questionnaireScoreDefinitionSchema).min(1)
});

export const questionnaireProvenanceSourceSchema = z.object({
  label: nonEmptyTrimmedString,
  url: nonEmptyTrimmedString,
  citation: trimmedString.default(""),
  notes: trimmedString.default("")
});

export const questionnaireProvenanceSchema = z.object({
  retrievalDate: nonEmptyTrimmedString,
  sourceClass: questionnaireSourceClassSchema,
  scoringNotes: trimmedString.default(""),
  sources: z.array(questionnaireProvenanceSourceSchema).min(1)
});

export const questionnaireVersionSchema = z.object({
  id: z.string(),
  instrumentId: z.string(),
  versionNumber: z.number().int().min(1),
  status: questionnaireVersionStatusSchema,
  label: trimmedString.default(""),
  isReadOnly: z.boolean(),
  definition: questionnaireDefinitionSchema,
  scoring: questionnaireScoringSchema,
  provenance: questionnaireProvenanceSchema,
  createdBy: trimmedString.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  publishedAt: z.string().nullable()
});

export const questionnaireHistoryPointSchema = z.object({
  runId: z.string(),
  completedAt: z.string(),
  primaryScore: z.number().nullable(),
  primaryScoreLabel: trimmedString.default(""),
  bandLabel: trimmedString.default("")
});

export const questionnaireInstrumentSummarySchema = z.object({
  id: z.string(),
  key: nonEmptyTrimmedString,
  slug: nonEmptyTrimmedString,
  title: nonEmptyTrimmedString,
  subtitle: trimmedString.default(""),
  description: trimmedString.default(""),
  aliases: stringArraySchema.default([]),
  symptomDomains: stringArraySchema.default([]),
  tags: stringArraySchema.default([]),
  sourceClass: questionnaireSourceClassSchema,
  availability: questionnaireAvailabilitySchema,
  responseStyle: nonEmptyTrimmedString,
  presentationMode: questionnairePresentationModeSchema,
  itemCount: z.number().int().min(0),
  isSelfReport: z.boolean(),
  isSystem: z.boolean(),
  isReadOnly: z.boolean(),
  ownerUserId: trimmedString.nullable(),
  currentVersionId: z.string().nullable(),
  currentVersionNumber: z.number().int().min(1).nullable(),
  latestRunId: z.string().nullable(),
  latestRunAt: z.string().nullable(),
  completedRunCount: z.number().int().min(0),
  primarySourceUrl: trimmedString.default(""),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const questionnaireInstrumentDetailSchema =
  questionnaireInstrumentSummarySchema.extend({
    status: questionnaireInstrumentStatusSchema,
    currentVersion: questionnaireVersionSchema.nullable(),
    draftVersion: questionnaireVersionSchema.nullable(),
    versions: z.array(questionnaireVersionSchema),
    history: z.array(questionnaireHistoryPointSchema),
    latestDraftRunId: z.string().nullable()
  });

export const questionnaireAnswerSchema = z.object({
  itemId: nonEmptyTrimmedString,
  optionKey: trimmedString.nullable(),
  valueText: trimmedString.default(""),
  numericValue: z.number().nullable(),
  answer: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const questionnaireRunScoreSchema = z.object({
  scoreKey: nonEmptyTrimmedString,
  label: nonEmptyTrimmedString,
  valueNumeric: z.number().nullable(),
  valueText: trimmedString.nullable(),
  bandLabel: trimmedString.default(""),
  severity: trimmedString.default(""),
  details: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string()
});

export const questionnaireRunSchema = z.object({
  id: z.string(),
  instrumentId: z.string(),
  versionId: z.string(),
  userId: trimmedString.nullable(),
  status: questionnaireRunStatusSchema,
  startedAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  progressIndex: z.number().int().min(0)
});

export const questionnaireRunDetailSchema = z.object({
  run: questionnaireRunSchema,
  instrument: questionnaireInstrumentSummarySchema,
  version: questionnaireVersionSchema,
  answers: z.array(questionnaireAnswerSchema),
  scores: z.array(questionnaireRunScoreSchema),
  history: z.array(questionnaireHistoryPointSchema)
});

export const questionnaireAnswerInputSchema = z.object({
  itemId: nonEmptyTrimmedString,
  optionKey: trimmedString.nullable().optional(),
  valueText: trimmedString.default(""),
  numericValue: z.number().nullable().optional(),
  answer: z.record(z.string(), z.unknown()).default({})
});

export const startQuestionnaireRunSchema = z.object({
  versionId: z.string().trim().min(1).nullable().optional(),
  userId: z.string().trim().min(1).nullable().optional()
});

export const updateQuestionnaireRunSchema = z.object({
  answers: z.array(questionnaireAnswerInputSchema).default([]),
  progressIndex: z.number().int().min(0).nullable().optional()
});

export const createQuestionnaireInstrumentSchema = z.object({
  title: nonEmptyTrimmedString,
  subtitle: trimmedString.default(""),
  description: trimmedString.default(""),
  aliases: stringArraySchema.default([]),
  symptomDomains: stringArraySchema.default([]),
  tags: stringArraySchema.default([]),
  sourceClass: questionnaireSourceClassSchema.default("secondary_verified"),
  availability: questionnaireAvailabilitySchema.default("custom"),
  isSelfReport: z.boolean().default(true),
  userId: z.string().trim().min(1).nullable().optional(),
  versionLabel: trimmedString.default("Draft 1"),
  definition: questionnaireDefinitionSchema,
  scoring: questionnaireScoringSchema,
  provenance: questionnaireProvenanceSchema
});

export const updateQuestionnaireVersionSchema = z.object({
  title: nonEmptyTrimmedString,
  subtitle: trimmedString.default(""),
  description: trimmedString.default(""),
  aliases: stringArraySchema.default([]),
  symptomDomains: stringArraySchema.default([]),
  tags: stringArraySchema.default([]),
  sourceClass: questionnaireSourceClassSchema,
  availability: questionnaireAvailabilitySchema,
  isSelfReport: z.boolean(),
  label: trimmedString.default(""),
  definition: questionnaireDefinitionSchema,
  scoring: questionnaireScoringSchema,
  provenance: questionnaireProvenanceSchema
});

export const publishQuestionnaireVersionSchema = z.object({
  label: trimmedString.default("")
});

export type QuestionnaireOption = z.infer<typeof questionnaireOptionSchema>;
export type QuestionnaireFlowRule = z.infer<typeof questionnaireFlowRuleSchema>;
export type QuestionnaireItem = z.infer<typeof questionnaireItemSchema>;
export type QuestionnaireSection = z.infer<typeof questionnaireSectionSchema>;
export type QuestionnaireDefinition = z.infer<typeof questionnaireDefinitionSchema>;
export type QuestionnaireScoring = z.infer<typeof questionnaireScoringSchema>;
export type QuestionnaireScoreDefinition = z.infer<typeof questionnaireScoreDefinitionSchema>;
export type QuestionnaireProvenance = z.infer<typeof questionnaireProvenanceSchema>;
export type QuestionnaireVersion = z.infer<typeof questionnaireVersionSchema>;
export type QuestionnaireInstrumentSummary = z.infer<
  typeof questionnaireInstrumentSummarySchema
>;
export type QuestionnaireInstrumentDetail = z.infer<
  typeof questionnaireInstrumentDetailSchema
>;
export type QuestionnaireRun = z.infer<typeof questionnaireRunSchema>;
export type QuestionnaireRunScore = z.infer<typeof questionnaireRunScoreSchema>;
export type QuestionnaireRunDetail = z.infer<typeof questionnaireRunDetailSchema>;
export type QuestionnaireAnswerInput = z.infer<typeof questionnaireAnswerInputSchema>;
export type CreateQuestionnaireInstrumentInput = z.infer<
  typeof createQuestionnaireInstrumentSchema
>;
export type UpdateQuestionnaireVersionInput = z.infer<
  typeof updateQuestionnaireVersionSchema
>;
