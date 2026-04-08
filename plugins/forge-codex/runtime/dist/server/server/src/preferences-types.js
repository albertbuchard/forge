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
    createdAt: z.string(),
    updatedAt: z.string()
});
export const preferenceCatalogSchema = z.object({
    id: z.string(),
    profileId: nonEmptyTrimmedString,
    domain: preferenceDomainSchema,
    slug: nonEmptyTrimmedString,
    title: nonEmptyTrimmedString,
    description: trimmedString.default(""),
    source: preferenceCatalogSourceSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    items: z.array(preferenceCatalogItemSchema).default([])
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
    itemId: nonEmptyTrimmedString,
    signalType: preferenceSignalTypeSchema,
    strength: z.number().min(0.5).max(2),
    source: nonEmptyTrimmedString,
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
        snapshots: z.array(preferenceSnapshotSchema),
        staleItemIds: z.array(nonEmptyTrimmedString).default([]),
        flippedItemIds: z.array(nonEmptyTrimmedString).default([])
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
export const preferenceWorkspaceQuerySchema = z.object({
    userId: nonEmptyTrimmedString.optional(),
    domain: preferenceDomainSchema.optional(),
    contextId: nonEmptyTrimmedString.optional()
});
export const createPreferenceContextSchema = z.object({
    userId: nonEmptyTrimmedString,
    domain: preferenceDomainSchema,
    name: nonEmptyTrimmedString,
    description: trimmedString.default(""),
    shareMode: preferenceContextShareModeSchema.default("blended"),
    active: z.boolean().default(true),
    isDefault: z.boolean().default(false),
    decayDays: z.number().int().min(7).max(365).default(90)
});
export const updatePreferenceContextSchema = createPreferenceContextSchema
    .omit({ userId: true, domain: true })
    .partial();
export const mergePreferenceContextsSchema = z.object({
    sourceContextId: nonEmptyTrimmedString,
    targetContextId: nonEmptyTrimmedString
});
export const createPreferenceItemSchema = z.object({
    userId: nonEmptyTrimmedString,
    domain: preferenceDomainSchema,
    label: nonEmptyTrimmedString,
    description: trimmedString.default(""),
    tags: z.array(nonEmptyTrimmedString).default([]),
    featureWeights: preferenceDimensionVectorSchema.default({}),
    sourceEntityType: crudEntityTypeSchema.nullable().optional(),
    sourceEntityId: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
    queueForCompare: z.boolean().default(true)
});
export const updatePreferenceItemSchema = createPreferenceItemSchema
    .omit({ userId: true, domain: true })
    .partial();
export const createPreferenceCatalogSchema = z.object({
    userId: nonEmptyTrimmedString,
    domain: preferenceDomainSchema,
    title: nonEmptyTrimmedString,
    description: trimmedString.default(""),
    slug: trimmedString.optional()
});
export const updatePreferenceCatalogSchema = createPreferenceCatalogSchema
    .omit({ userId: true, domain: true })
    .partial();
export const createPreferenceCatalogItemSchema = z.object({
    catalogId: nonEmptyTrimmedString,
    label: nonEmptyTrimmedString,
    description: trimmedString.default(""),
    tags: z.array(nonEmptyTrimmedString).default([]),
    featureWeights: preferenceDimensionVectorSchema.default({}),
    position: z.number().int().min(0).optional()
});
export const updatePreferenceCatalogItemSchema = createPreferenceCatalogItemSchema
    .omit({ catalogId: true })
    .partial();
export const enqueueEntityPreferenceItemSchema = z.object({
    userId: nonEmptyTrimmedString,
    domain: preferenceDomainSchema,
    entityType: crudEntityTypeSchema,
    entityId: nonEmptyTrimmedString,
    label: trimmedString.optional(),
    description: trimmedString.optional(),
    tags: z.array(nonEmptyTrimmedString).default([])
});
export const submitPairwiseJudgmentSchema = z.object({
    userId: nonEmptyTrimmedString,
    domain: preferenceDomainSchema,
    contextId: nonEmptyTrimmedString,
    leftItemId: nonEmptyTrimmedString,
    rightItemId: nonEmptyTrimmedString,
    outcome: preferenceJudgmentOutcomeSchema,
    strength: z.number().min(0.5).max(2).default(1),
    responseTimeMs: z.number().int().nullable().optional(),
    reasonTags: z.array(nonEmptyTrimmedString).default([])
});
export const submitAbsoluteSignalSchema = z.object({
    userId: nonEmptyTrimmedString,
    domain: preferenceDomainSchema,
    contextId: nonEmptyTrimmedString,
    itemId: nonEmptyTrimmedString,
    signalType: preferenceSignalTypeSchema,
    strength: z.number().min(0.5).max(2).default(1)
});
export const updatePreferenceScoreSchema = z.object({
    userId: nonEmptyTrimmedString,
    domain: preferenceDomainSchema,
    contextId: nonEmptyTrimmedString,
    manualStatus: preferenceItemStatusSchema.nullable().optional(),
    manualScore: z.number().nullable().optional(),
    confidenceLock: z.number().min(0).max(1).nullable().optional(),
    bookmarked: z.boolean().optional(),
    compareLater: z.boolean().optional(),
    frozen: z.boolean().optional()
});
export const startPreferenceGameSchema = z.object({
    userId: nonEmptyTrimmedString,
    domain: preferenceDomainSchema,
    contextId: nonEmptyTrimmedString.optional(),
    catalogId: nonEmptyTrimmedString.optional()
});
