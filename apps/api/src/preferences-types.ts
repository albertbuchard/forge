import { z } from "zod";
import { crudEntityTypeSchema, userSummarySchema } from "./types.js";

const trimmedString = z.string().trim();
const nonEmptyTrimmedString = trimmedString.min(1);

export const preferenceDomainSchema = z.enum([
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

export const preferenceCatalogSourceSchema = z.enum(["seeded", "custom"]);

export const preferenceCatalogCreatedSourceSchema = z.enum([
  "ui",
  "openclaw",
  "agent",
  "system",
  "unknown"
]);

export const preferenceCatalogLinkInputSchema = z
  .object({
    entityType: crudEntityTypeSchema,
    entityId: nonEmptyTrimmedString,
    anchorKey: trimmedString.max(256).optional().default(""),
    relationship: trimmedString.max(64).optional().default("related")
  })
  .strict();

export const preferenceCatalogLinkSchema = z.object({
  sourceEntityType: nonEmptyTrimmedString,
  sourceEntityId: nonEmptyTrimmedString,
  targetEntityType: nonEmptyTrimmedString,
  targetEntityId: nonEmptyTrimmedString,
  anchorKey: trimmedString.nullable(),
  relationship: nonEmptyTrimmedString,
  createdByActor: z.string().nullable(),
  createdAt: z.string()
});

export const preferenceContextShareModeSchema = z.enum([
  "shared",
  "isolated",
  "blended"
]);

export const preferenceJudgmentOutcomeSchema = z.enum([
  "left",
  "right",
  "tie",
  "skip"
]);

export const preferenceSignalTypeSchema = z.enum([
  "favorite",
  "veto",
  "must_have",
  "bookmark",
  "neutral",
  "compare_later"
]);

export const PREFERENCE_SIGNAL_MODEL_WEIGHTS = {
  favorite: 1.25,
  veto: -1.6,
  must_have: 1.5,
  bookmark: 0.35,
  neutral: 0,
  compare_later: 0.2
} as const;

export const preferenceDimensionIdSchema = z.enum([
  "novelty",
  "simplicity",
  "rigor",
  "aesthetics",
  "depth",
  "structure",
  "familiarity",
  "surprise"
]);

export const preferenceItemStatusSchema = z.enum([
  "liked",
  "disliked",
  "uncertain",
  "vetoed",
  "bookmarked",
  "favorite",
  "must_have",
  "neutral"
]);

export const preferenceDimensionVectorSchema = z.object({
  novelty: z.number().min(-1).max(1).default(0),
  simplicity: z.number().min(-1).max(1).default(0),
  rigor: z.number().min(-1).max(1).default(0),
  aesthetics: z.number().min(-1).max(1).default(0),
  depth: z.number().min(-1).max(1).default(0),
  structure: z.number().min(-1).max(1).default(0),
  familiarity: z.number().min(-1).max(1).default(0),
  surprise: z.number().min(-1).max(1).default(0)
});

export const preferenceLinkedEntitySchema = z.object({
  entityType: crudEntityTypeSchema,
  entityId: nonEmptyTrimmedString
});

export const preferenceProfileSchema = z.object({
  id: z.string(),
  userId: nonEmptyTrimmedString,
  domain: preferenceDomainSchema,
  defaultContextId: z.string().nullable(),
  modelVersion: nonEmptyTrimmedString,
  createdAt: z.string(),
  updatedAt: z.string(),
  user: userSummarySchema.nullable().optional()
});

export const preferenceContextSchema = z.object({
  id: z.string(),
  profileId: nonEmptyTrimmedString,
  name: nonEmptyTrimmedString,
  description: trimmedString.default(""),
  shareMode: preferenceContextShareModeSchema,
  active: z.boolean(),
  isDefault: z.boolean(),
  decayDays: z.number().int().min(7).max(365),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const preferenceItemSchema = z.object({
  id: z.string(),
  profileId: nonEmptyTrimmedString,
  label: nonEmptyTrimmedString,
  description: trimmedString.default(""),
  tags: z.array(nonEmptyTrimmedString).default([]),
  featureWeights: preferenceDimensionVectorSchema,
  sourceEntityType: crudEntityTypeSchema.nullable().optional(),
  sourceEntityId: z.string().nullable().optional(),
  linkedEntity: preferenceLinkedEntitySchema.nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const preferenceCatalogItemSchema = z.object({
  id: z.string(),
  catalogId: nonEmptyTrimmedString,
  label: nonEmptyTrimmedString,
  description: trimmedString.default(""),
  tags: z.array(nonEmptyTrimmedString).default([]),
  featureWeights: preferenceDimensionVectorSchema,
  position: z.number().int().min(0),
  archived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const preferenceCatalogSchema = z.object({
  id: z.string(),
  profileId: nonEmptyTrimmedString,
  userId: nonEmptyTrimmedString,
  user: userSummarySchema.nullable(),
  domain: preferenceDomainSchema,
  slug: nonEmptyTrimmedString,
  title: nonEmptyTrimmedString,
  description: trimmedString.default(""),
  scopeIn: trimmedString.default(""),
  scopeOut: trimmedString.default(""),
  source: preferenceCatalogSourceSchema,
  createdSource: preferenceCatalogCreatedSourceSchema,
  createdByActor: z.string().nullable(),
  archived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  links: z.array(preferenceCatalogLinkSchema).default([]),
  items: z.array(preferenceCatalogItemSchema).default([]),
  itemCount: z.number().int().nonnegative(),
  matchingItemCount: z.number().int().nonnegative().optional(),
  itemsTruncated: z.boolean()
});

export const pairwiseJudgmentSchema = z.object({
  id: z.string(),
  profileId: nonEmptyTrimmedString,
  contextId: nonEmptyTrimmedString,
  userId: nonEmptyTrimmedString,
  leftItemId: nonEmptyTrimmedString,
  rightItemId: nonEmptyTrimmedString,
  outcome: preferenceJudgmentOutcomeSchema,
  strength: z.number().min(0.5).max(2),
  responseTimeMs: z.number().int().nullable(),
  source: nonEmptyTrimmedString,
  reasonTags: z.array(nonEmptyTrimmedString).default([]),
  createdAt: z.string()
});

export const absoluteSignalSchema = z.object({
  id: z.string(),
  profileId: nonEmptyTrimmedString,
  contextId: nonEmptyTrimmedString,
  userId: nonEmptyTrimmedString,
  ownerUserId: nonEmptyTrimmedString,
  itemId: nonEmptyTrimmedString,
  signalType: preferenceSignalTypeSchema,
  strength: z.number().min(0.5).max(2),
  modelWeight: z.number(),
  // Existing databases may contain provider-specific source labels from before
  // authenticated activity provenance was standardized. New writes still use
  // ActivitySource, while reads preserve those historical labels verbatim.
  source: nonEmptyTrimmedString,
  actor: z.string().nullable(),
  createdAt: z.string()
});

export const preferenceItemScoreSchema = z.object({
  id: z.string(),
  profileId: nonEmptyTrimmedString,
  contextId: nonEmptyTrimmedString,
  itemId: nonEmptyTrimmedString,
  latentScore: z.number(),
  confidence: z.number().min(0).max(1),
  uncertainty: z.number().min(0).max(1),
  evidenceCount: z.number().int().min(0),
  pairwiseWins: z.number().int().min(0),
  pairwiseLosses: z.number().int().min(0),
  pairwiseTies: z.number().int().min(0),
  signalCount: z.number().int().min(0),
  effectiveSignal: absoluteSignalSchema.nullable().default(null),
  conflictCount: z.number().int().min(0),
  status: preferenceItemStatusSchema,
  dominantDimensions: z.array(preferenceDimensionIdSchema).default([]),
  explanation: z.array(trimmedString).default([]),
  manualStatus: preferenceItemStatusSchema.nullable().optional(),
  manualScore: z.number().nullable().optional(),
  confidenceLock: z.number().min(0).max(1).nullable().optional(),
  bookmarked: z.boolean(),
  compareLater: z.boolean(),
  frozen: z.boolean(),
  lastInferredAt: z.string(),
  lastJudgmentAt: z.string().nullable(),
  updatedAt: z.string(),
  item: preferenceItemSchema.optional()
});

export const preferenceDimensionSummarySchema = z.object({
  id: z.string(),
  profileId: nonEmptyTrimmedString,
  contextId: nonEmptyTrimmedString,
  dimensionId: preferenceDimensionIdSchema,
  leaning: z.number().min(-1).max(1),
  confidence: z.number().min(0).max(1),
  movement: z.number().min(-1).max(1),
  contextSensitivity: z.number().min(0).max(1),
  evidenceCount: z.number().int().min(0),
  updatedAt: z.string()
});

export const preferenceSnapshotSchema = z.object({
  id: z.string(),
  profileId: nonEmptyTrimmedString,
  contextId: nonEmptyTrimmedString,
  summaryMetrics: z.record(z.string(), z.unknown()),
  serializedModelState: z.record(z.string(), z.unknown()),
  createdAt: z.string()
});

export const preferenceMapPointSchema = z.object({
  itemId: nonEmptyTrimmedString,
  label: nonEmptyTrimmedString,
  x: z.number(),
  y: z.number(),
  score: z.number(),
  confidence: z.number().min(0).max(1),
  uncertainty: z.number().min(0).max(1),
  status: preferenceItemStatusSchema,
  clusterKey: trimmedString,
  tags: z.array(nonEmptyTrimmedString).default([]),
  sourceEntityType: crudEntityTypeSchema.nullable().optional(),
  sourceEntityId: z.string().nullable().optional()
});

export const preferenceComparePairSchema = z.object({
  left: preferenceItemSchema,
  right: preferenceItemSchema,
  rationale: z.array(trimmedString).default([]),
  score: z.number()
});

export const preferenceWorkspacePayloadSchema = z.object({
  profile: preferenceProfileSchema,
  selectedContext: preferenceContextSchema,
  contexts: z.array(preferenceContextSchema),
  catalogs: z.array(preferenceCatalogSchema),
  dimensions: z.array(preferenceDimensionSummarySchema),
  scores: z.array(preferenceItemScoreSchema),
  map: z.array(preferenceMapPointSchema),
  history: z.object({
    judgments: z.array(pairwiseJudgmentSchema),
    signals: z.array(absoluteSignalSchema),
    itemLabels: z
      .record(nonEmptyTrimmedString, nonEmptyTrimmedString)
      .default({}),
    snapshots: z.array(preferenceSnapshotSchema),
    staleItemIds: z.array(nonEmptyTrimmedString).default([]),
    flippedItemIds: z.array(nonEmptyTrimmedString).default([])
  }),
  presentation: z.object({
    itemLimit: z.number().int().positive(),
    itemOffset: z.number().int().min(0),
    totalItems: z.number().int().min(0),
    returnedItems: z.number().int().min(0),
    hasMore: z.boolean(),
    nextOffset: z.number().int().min(0).nullable(),
    historyLimit: z.number().int().positive()
  }),
  evidenceCoverage: z.object({
    judgmentLimitPerContext: z.number().int().positive(),
    totalJudgments: z.number().int().min(0),
    consideredJudgments: z.number().int().min(0),
    truncated: z.boolean(),
    contexts: z.array(
      z.object({
        contextId: nonEmptyTrimmedString,
        totalJudgments: z.number().int().min(0),
        consideredJudgments: z.number().int().min(0),
        truncated: z.boolean()
      })
    )
  }),
  compare: z.object({
    nextPair: preferenceComparePairSchema.nullable(),
    pendingCount: z.number().int().min(0),
    candidateCount: z.number().int().min(0)
  }),
  summary: z.object({
    totalItems: z.number().int().min(0),
    likedCount: z.number().int().min(0),
    dislikedCount: z.number().int().min(0),
    uncertainCount: z.number().int().min(0),
    bookmarkedCount: z.number().int().min(0),
    vetoedCount: z.number().int().min(0),
    averageConfidence: z.number().min(0).max(1),
    pendingComparisons: z.number().int().min(0)
  }),
  libraries: z.object({
    totalCatalogs: z.number().int().min(0),
    totalCatalogItems: z.number().int().min(0),
    seededCatalogCount: z.number().int().min(0),
    customCatalogCount: z.number().int().min(0)
  })
});

export const preferenceWorkspaceQuerySchema = z
  .object({
    userId: nonEmptyTrimmedString.optional(),
    domain: preferenceDomainSchema.optional(),
    contextId: nonEmptyTrimmedString.optional(),
    itemLimit: z.coerce.number().int().positive().max(100).default(50),
    itemOffset: z.coerce.number().int().min(0).default(0),
    historyLimit: z.coerce.number().int().positive().max(100).default(50)
  })
  .strict();

export const refreshPreferenceWorkspaceSchema =
  preferenceWorkspaceQuerySchema.extend({
    userId: nonEmptyTrimmedString,
    domain: preferenceDomainSchema
  });

const preferencePageCursorSchema = nonEmptyTrimmedString.max(2048);

export const preferenceCatalogListQuerySchema = z
  .object({
    domain: preferenceDomainSchema.optional(),
    query: trimmedString.max(200).optional(),
    limit: z.coerce.number().int().positive().max(100).default(24),
    offset: z.coerce.number().int().min(0).default(0),
    cursor: preferencePageCursorSchema.optional()
  })
  .superRefine((value, context) => {
    if (value.cursor && value.offset > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["offset"],
        message: "offset must be zero when cursor is provided"
      });
    }
  });

export const preferenceCatalogItemListQuerySchema = z
  .object({
    catalogId: nonEmptyTrimmedString.optional(),
    query: trimmedString.max(200).optional(),
    limit: z.coerce.number().int().positive().max(200).default(24),
    offset: z.coerce.number().int().min(0).default(0),
    cursor: preferencePageCursorSchema.optional()
  })
  .superRefine((value, context) => {
    if (value.cursor && value.offset > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["offset"],
        message: "offset must be zero when cursor is provided"
      });
    }
  });

export const createPreferenceContextSchema = z
  .object({
    userId: nonEmptyTrimmedString,
    domain: preferenceDomainSchema,
    name: nonEmptyTrimmedString,
    description: trimmedString.default(""),
    shareMode: preferenceContextShareModeSchema.default("blended"),
    active: z.boolean().default(true),
    isDefault: z.boolean().default(false),
    decayDays: z.number().int().min(7).max(365).default(90)
  })
  .strict();

export const updatePreferenceContextSchema = createPreferenceContextSchema
  .omit({ userId: true, domain: true })
  .partial();

export const mergePreferenceContextsSchema = z
  .object({
    sourceContextId: nonEmptyTrimmedString,
    targetContextId: nonEmptyTrimmedString
  })
  .strict();

const preferenceItemMutationFieldsSchema = z
  .object({
    userId: nonEmptyTrimmedString,
    domain: preferenceDomainSchema,
    label: nonEmptyTrimmedString,
    description: trimmedString.default(""),
    tags: z.array(nonEmptyTrimmedString).default([]),
    featureWeights: preferenceDimensionVectorSchema.default({}),
    sourceEntityType: crudEntityTypeSchema.nullable().optional(),
    sourceEntityId: nonEmptyTrimmedString.nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
    queueForCompare: z.boolean().default(true)
  })
  .strict();

export const createPreferenceItemSchema =
  preferenceItemMutationFieldsSchema.superRefine((value, context) => {
    if (Boolean(value.sourceEntityType) !== Boolean(value.sourceEntityId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [value.sourceEntityType ? "sourceEntityId" : "sourceEntityType"],
        message: "sourceEntityType and sourceEntityId must be provided together"
      });
    }
  });

export const updatePreferenceItemSchema = preferenceItemMutationFieldsSchema
  .omit({ userId: true, domain: true })
  .partial();

export const createPreferenceCatalogSchema = z
  .object({
    userId: nonEmptyTrimmedString,
    domain: preferenceDomainSchema,
    title: nonEmptyTrimmedString.max(200),
    description: trimmedString.max(4000).default(""),
    scopeIn: trimmedString.max(4000).default(""),
    scopeOut: trimmedString.max(4000).default(""),
    slug: trimmedString.max(64).optional(),
    links: z.array(preferenceCatalogLinkInputSchema).max(100).default([])
  })
  .strict();

export const updatePreferenceCatalogSchema = createPreferenceCatalogSchema
  .omit({ userId: true, domain: true })
  .partial();

export const createPreferenceCatalogItemSchema = z
  .object({
    catalogId: nonEmptyTrimmedString,
    label: nonEmptyTrimmedString.max(200),
    description: trimmedString.max(4000).default(""),
    tags: z.array(nonEmptyTrimmedString.max(100)).max(100).default([]),
    featureWeights: preferenceDimensionVectorSchema.default({}),
    position: z.number().int().min(0).optional()
  })
  .strict();

export const updatePreferenceCatalogItemSchema =
  createPreferenceCatalogItemSchema
    .omit({ catalogId: true })
    .partial()
    .strict();

export const enqueueEntityPreferenceItemSchema = z
  .object({
    userId: nonEmptyTrimmedString,
    domain: preferenceDomainSchema,
    entityType: crudEntityTypeSchema,
    entityId: nonEmptyTrimmedString,
    label: trimmedString.optional(),
    description: trimmedString.optional(),
    tags: z.array(nonEmptyTrimmedString).default([])
  })
  .strict();

export const submitPairwiseJudgmentSchema = z
  .object({
    userId: nonEmptyTrimmedString,
    domain: preferenceDomainSchema,
    contextId: nonEmptyTrimmedString,
    leftItemId: nonEmptyTrimmedString,
    rightItemId: nonEmptyTrimmedString,
    outcome: preferenceJudgmentOutcomeSchema,
    strength: z.number().min(0.5).max(2).default(1),
    responseTimeMs: z.number().int().nullable().optional(),
    reasonTags: z.array(nonEmptyTrimmedString).max(100).default([])
  })
  .strict();

export const submitAbsoluteSignalSchema = z
  .object({
    userId: nonEmptyTrimmedString,
    domain: preferenceDomainSchema,
    contextId: nonEmptyTrimmedString,
    itemId: nonEmptyTrimmedString,
    signalType: preferenceSignalTypeSchema,
    strength: z.number().min(0.5).max(2).default(1)
  })
  .strict();

export const updatePreferenceScoreSchema = z
  .object({
    userId: nonEmptyTrimmedString,
    domain: preferenceDomainSchema,
    contextId: nonEmptyTrimmedString,
    manualStatus: preferenceItemStatusSchema.nullable().optional(),
    manualScore: z.number().nullable().optional(),
    confidenceLock: z.number().min(0).max(1).nullable().optional(),
    bookmarked: z.boolean().optional(),
    compareLater: z.boolean().optional(),
    frozen: z.boolean().optional()
  })
  .strict();

export const startPreferenceGameSchema = z
  .object({
    userId: nonEmptyTrimmedString,
    domain: preferenceDomainSchema,
    contextId: nonEmptyTrimmedString.optional(),
    catalogId: nonEmptyTrimmedString.optional()
  })
  .strict();

export type PreferenceDomain = z.infer<typeof preferenceDomainSchema>;
export type PreferenceContextShareMode = z.infer<
  typeof preferenceContextShareModeSchema
>;
export type PreferenceJudgmentOutcome = z.infer<
  typeof preferenceJudgmentOutcomeSchema
>;
export type PreferenceSignalType = z.infer<typeof preferenceSignalTypeSchema>;
export type PreferenceDimensionId = z.infer<typeof preferenceDimensionIdSchema>;
export type PreferenceItemStatus = z.infer<typeof preferenceItemStatusSchema>;
export type PreferenceDimensionVector = z.infer<
  typeof preferenceDimensionVectorSchema
>;
export type PreferenceProfile = z.infer<typeof preferenceProfileSchema>;
export type PreferenceContext = z.infer<typeof preferenceContextSchema>;
export type PreferenceItem = z.infer<typeof preferenceItemSchema>;
export type PreferenceCatalogSource = z.infer<
  typeof preferenceCatalogSourceSchema
>;
export type PreferenceCatalogCreatedSource = z.infer<
  typeof preferenceCatalogCreatedSourceSchema
>;
export type PreferenceCatalogLinkInput = z.infer<
  typeof preferenceCatalogLinkInputSchema
>;
export type PreferenceCatalogLink = z.infer<typeof preferenceCatalogLinkSchema>;
export type PreferenceCatalogItem = z.infer<typeof preferenceCatalogItemSchema>;
export type PreferenceCatalog = z.infer<typeof preferenceCatalogSchema>;
export type PairwiseJudgment = z.infer<typeof pairwiseJudgmentSchema>;
export type AbsoluteSignal = z.infer<typeof absoluteSignalSchema>;
export type PreferenceItemScore = z.infer<typeof preferenceItemScoreSchema>;
export type PreferenceDimensionSummary = z.infer<
  typeof preferenceDimensionSummarySchema
>;
export type PreferenceSnapshot = z.infer<typeof preferenceSnapshotSchema>;
export type PreferenceMapPoint = z.infer<typeof preferenceMapPointSchema>;
export type PreferenceComparePair = z.infer<typeof preferenceComparePairSchema>;
export type PreferenceWorkspacePayload = z.infer<
  typeof preferenceWorkspacePayloadSchema
>;
export type PreferenceWorkspaceQuery = z.input<
  typeof preferenceWorkspaceQuerySchema
>;
export type CreatePreferenceContextInput = z.infer<
  typeof createPreferenceContextSchema
>;
export type UpdatePreferenceContextInput = z.infer<
  typeof updatePreferenceContextSchema
>;
export type MergePreferenceContextsInput = z.infer<
  typeof mergePreferenceContextsSchema
>;
export type CreatePreferenceItemInput = z.infer<
  typeof createPreferenceItemSchema
>;
export type UpdatePreferenceItemInput = z.infer<
  typeof updatePreferenceItemSchema
>;
export type CreatePreferenceCatalogInput = z.infer<
  typeof createPreferenceCatalogSchema
>;
export type UpdatePreferenceCatalogInput = z.infer<
  typeof updatePreferenceCatalogSchema
>;
export type CreatePreferenceCatalogItemInput = z.infer<
  typeof createPreferenceCatalogItemSchema
>;
export type UpdatePreferenceCatalogItemInput = z.infer<
  typeof updatePreferenceCatalogItemSchema
>;
export type EnqueueEntityPreferenceItemInput = z.infer<
  typeof enqueueEntityPreferenceItemSchema
>;
export type SubmitPairwiseJudgmentInput = z.infer<
  typeof submitPairwiseJudgmentSchema
>;
export type SubmitAbsoluteSignalInput = z.infer<
  typeof submitAbsoluteSignalSchema
>;
export type UpdatePreferenceScoreInput = z.infer<
  typeof updatePreferenceScoreSchema
>;
export type StartPreferenceGameInput = z.infer<
  typeof startPreferenceGameSchema
>;
