import { z } from "zod";
import { LEGACY_WORKBENCH_PORT_KINDS, WORKBENCH_PORT_KINDS, normalizeWorkbenchPortKind } from "../../src/lib/workbench/nodes.js";
import { formatLocalDateKey } from "../../src/lib/date-keys.js";
export const taskStatusSchema = z.enum([
    "backlog",
    "focus",
    "in_progress",
    "blocked",
    "done"
]);
export const taskPrioritySchema = z.enum(["low", "medium", "high", "critical"]);
export const taskEffortSchema = z.enum(["light", "deep", "marathon"]);
export const taskEnergySchema = z.enum(["low", "steady", "high"]);
export const workItemLevelSchema = z.enum(["issue", "task", "subtask"]);
export const workItemExecutionModeSchema = z.enum(["afk", "hitl"]);
export const goalStatusSchema = z.enum(["active", "paused", "completed"]);
export const goalHorizonSchema = z.enum(["quarter", "year", "lifetime"]);
export const projectStatusSchema = z.enum(["active", "paused", "completed"]);
export const projectWorkflowStatusSchema = taskStatusSchema;
export const tagKindSchema = z.enum(["value", "category", "execution"]);
export const taskDueFilterSchema = z.enum(["overdue", "today", "week"]);
export const userKindSchema = z.enum(["human", "bot"]);
export const userAccessLevelSchema = z.enum(["view", "manage"]);
export const strategyStatusSchema = z.enum(["active", "paused", "completed"]);
export const taskRunStatusSchema = z.enum([
    "active",
    "completed",
    "released",
    "timed_out"
]);
export const taskTimerModeSchema = z.enum(["planned", "unlimited"]);
export const timeAccountingModeSchema = z.enum([
    "split",
    "parallel",
    "primary_only"
]);
export const workItemGitRefTypeSchema = z.enum([
    "commit",
    "branch",
    "pull_request"
]);
export const habitFrequencySchema = z.enum(["daily", "weekly"]);
export const habitPolaritySchema = z.enum(["positive", "negative"]);
export const habitStatusSchema = z.enum(["active", "paused", "archived"]);
export const habitCheckInStatusSchema = z.enum(["done", "missed"]);
export const habitOrderBySchema = z.enum([
    "needs_attention",
    "name",
    "streak",
    "created_at",
    "updated_at"
]);
export const calendarProviderSchema = z.enum([
    "google",
    "apple",
    "caldav",
    "microsoft",
    "macos_local"
]);
export const calendarConnectionStatusSchema = z.enum([
    "connected",
    "needs_attention",
    "error"
]);
export const calendarOwnershipSchema = z.enum(["external", "forge"]);
export const calendarEventOriginSchema = z.enum([
    "native",
    "google",
    "apple",
    "caldav",
    "microsoft",
    "macos_local",
    "derived"
]);
export const macosCalendarAccessStatusSchema = z.enum([
    "not_determined",
    "denied",
    "restricted",
    "full_access",
    "unavailable"
]);
export const calendarAvailabilitySchema = z.enum(["busy", "free"]);
export const calendarEventStatusSchema = z.enum([
    "confirmed",
    "tentative",
    "cancelled"
]);
export const workBlockKindSchema = z.enum([
    "main_activity",
    "secondary_activity",
    "third_activity",
    "rest",
    "holiday",
    "custom"
]);
export const calendarTimeboxStatusSchema = z.enum([
    "planned",
    "active",
    "completed",
    "cancelled"
]);
export const calendarTimeboxSourceSchema = z.enum([
    "manual",
    "suggested",
    "live_run"
]);
export const workAdjustmentEntityTypeSchema = z.enum(["task", "project"]);
export const taskResolutionKindSchema = z.enum(["completed", "split"]);
export const actionProfileModeSchema = z.enum([
    "impulse",
    "rate",
    "hybrid",
    "recovery",
    "container"
]);
export const actionProfileSourceMethodSchema = z.enum([
    "seeded",
    "inferred",
    "manual",
    "learned"
]);
export const actionCostBandSchema = z.enum([
    "tiny",
    "light",
    "standard",
    "heavy",
    "brutal"
]);
export const lifeForceStatKeySchema = z.enum([
    "life_force",
    "activation",
    "focus",
    "vigor",
    "composure",
    "flow"
]);
export const activityEntityTypeSchema = z.enum([
    "task",
    "habit",
    "goal",
    "project",
    "strategy",
    "domain",
    "psyche_value",
    "behavior_pattern",
    "behavior",
    "belief_entry",
    "mode_profile",
    "mode_guide_session",
    "trigger_report",
    "preference_catalog",
    "preference_catalog_item",
    "preference_context",
    "preference_item",
    "questionnaire_instrument",
    "questionnaire_run",
    "note",
    "event_type",
    "emotion_definition",
    "tag",
    "task_run",
    "system",
    "insight",
    "approval_request",
    "agent_action",
    "reward",
    "session",
    "calendar_connection",
    "calendar",
    "calendar_event",
    "work_block",
    "work_block_template",
    "task_timebox",
    "sleep_session",
    "workout_session"
]);
export const activitySourceSchema = z.enum([
    "ui",
    "openclaw",
    "agent",
    "system"
]);
export const diagnosticLogLevelSchema = z.preprocess((value) => {
    if (typeof value !== "string") {
        return value;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === "warn" ? "warning" : normalized;
}, z.enum([
    "debug",
    "info",
    "warning",
    "error"
]));
export const diagnosticLogSourceSchema = z.enum([
    "ui",
    "openclaw",
    "agent",
    "system",
    "server"
]);
export const agentTrustLevelSchema = z.enum([
    "standard",
    "trusted",
    "autonomous"
]);
export const autonomyModeSchema = z.enum([
    "approval_required",
    "scoped_write",
    "autonomous"
]);
export const approvalModeSchema = z.enum([
    "approval_by_default",
    "high_impact_only",
    "none"
]);
export const agentBootstrapModeSchema = z.enum([
    "disabled",
    "active_only",
    "scoped",
    "full"
]);
export const defaultAgentBootstrapPolicy = {
    mode: "active_only",
    goalsLimit: 5,
    projectsLimit: 8,
    tasksLimit: 10,
    habitsLimit: 6,
    strategiesLimit: 4,
    peoplePageLimit: 4,
    includePeoplePages: true
};
export const legacyAgentBootstrapPolicy = {
    mode: "full",
    goalsLimit: 25,
    projectsLimit: 25,
    tasksLimit: 25,
    habitsLimit: 20,
    strategiesLimit: 20,
    peoplePageLimit: 12,
    includePeoplePages: true
};
export const agentBootstrapPolicySchema = z.object({
    mode: agentBootstrapModeSchema.default(defaultAgentBootstrapPolicy.mode),
    goalsLimit: z.coerce
        .number()
        .int()
        .min(0)
        .max(100)
        .default(defaultAgentBootstrapPolicy.goalsLimit),
    projectsLimit: z.coerce
        .number()
        .int()
        .min(0)
        .max(100)
        .default(defaultAgentBootstrapPolicy.projectsLimit),
    tasksLimit: z.coerce
        .number()
        .int()
        .min(0)
        .max(100)
        .default(defaultAgentBootstrapPolicy.tasksLimit),
    habitsLimit: z.coerce
        .number()
        .int()
        .min(0)
        .max(100)
        .default(defaultAgentBootstrapPolicy.habitsLimit),
    strategiesLimit: z.coerce
        .number()
        .int()
        .min(0)
        .max(100)
        .default(defaultAgentBootstrapPolicy.strategiesLimit),
    peoplePageLimit: z.coerce
        .number()
        .int()
        .min(0)
        .max(50)
        .default(defaultAgentBootstrapPolicy.peoplePageLimit),
    includePeoplePages: z.boolean().default(defaultAgentBootstrapPolicy.includePeoplePages)
});
export const defaultAgentScopePolicy = {
    userIds: [],
    projectIds: [],
    tagIds: []
};
export const agentRuntimeProviderSchema = z.enum([
    "openclaw",
    "hermes",
    "codex"
]);
export const agentRuntimeConnectionModeSchema = z.enum([
    "operator_session",
    "managed_token",
    "plugin",
    "mcp",
    "api_server",
    "unknown"
]);
export const agentRuntimeSessionStatusSchema = z.enum([
    "connected",
    "stale",
    "reconnecting",
    "disconnected",
    "error"
]);
export const agentRuntimeEventLevelSchema = z.enum([
    "info",
    "warning",
    "error"
]);
export const insightOriginSchema = z.enum(["system", "user", "agent"]);
export const insightStatusSchema = z.enum([
    "open",
    "accepted",
    "dismissed",
    "snoozed",
    "applied",
    "expired"
]);
export const insightVisibilitySchema = z.enum([
    "visible",
    "pending_review",
    "archived"
]);
export const insightFeedbackTypeSchema = z.enum([
    "accepted",
    "dismissed",
    "applied",
    "snoozed"
]);
export const approvalRequestStatusSchema = z.enum([
    "pending",
    "approved",
    "rejected",
    "cancelled",
    "executed"
]);
export const actionRiskLevelSchema = z.enum(["low", "medium", "high"]);
export const agentActionStatusSchema = z.enum([
    "pending_approval",
    "approved",
    "rejected",
    "executed"
]);
export const crudEntityTypeSchema = z.enum([
    "goal",
    "project",
    "task",
    "strategy",
    "habit",
    "tag",
    "note",
    "insight",
    "calendar_event",
    "work_block_template",
    "task_timebox",
    "psyche_value",
    "behavior_pattern",
    "behavior",
    "belief_entry",
    "mode_profile",
    "mode_guide_session",
    "event_type",
    "emotion_definition",
    "trigger_report",
    "preference_catalog",
    "preference_catalog_item",
    "preference_context",
    "preference_item",
    "questionnaire_instrument",
    "sleep_session",
    "workout_session"
]);
export const rewardableEntityTypeSchema = z.enum([
    "system",
    "goal",
    "project",
    "task",
    "habit",
    "tag",
    "note",
    "insight",
    "psyche_value",
    "behavior_pattern",
    "behavior",
    "belief_entry",
    "mode_profile",
    "trigger_report"
]);
export const deleteModeSchema = z.enum(["soft", "hard"]);
export const noteKindSchema = z.enum(["evidence", "wiki"]);
export const wikiSpaceVisibilitySchema = z.enum(["personal", "shared"]);
export const wikiSearchModeSchema = z.enum([
    "text",
    "semantic",
    "entity",
    "hybrid"
]);
export const rewardRuleFamilySchema = z.enum([
    "completion",
    "consistency",
    "alignment",
    "recovery",
    "collaboration",
    "ambient"
]);
export const appLocaleSchema = z.enum(["en", "fr"]);
export const surfaceWidgetDensitySchema = z.enum([
    "dense",
    "compact",
    "comfortable"
]);
const trimmedString = z.string().trim();
const nonEmptyTrimmedString = trimmedString.min(1);
const rewardConfigValueSchema = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null()
]);
function isValidDateOnly(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }
    const [yearText, monthText, dayText] = value.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    return (candidate.getUTCFullYear() === year &&
        candidate.getUTCMonth() === month - 1 &&
        candidate.getUTCDate() === day);
}
function isValidDateTime(value) {
    return !Number.isNaN(Date.parse(value));
}
const dateOnlySchema = trimmedString.refine(isValidDateOnly, {
    message: "Expected a valid date in YYYY-MM-DD format"
});
const dateTimeSchema = trimmedString.refine(isValidDateTime, {
    message: "Expected a valid ISO date-time string"
});
const flexibleCalendarQueryDateSchema = trimmedString
    .refine((value) => isValidDateOnly(value) || isValidDateTime(value), {
    message: "Expected a valid ISO date-time string or YYYY-MM-DD date"
})
    .transform((value) => isValidDateOnly(value)
    ? `${value}T00:00:00.000Z`
    : new Date(value).toISOString());
const uniqueStringArraySchema = z
    .array(nonEmptyTrimmedString)
    .superRefine((values, context) => {
    const seen = new Set();
    values.forEach((value, index) => {
        if (seen.has(value)) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: [index],
                message: `Duplicate value '${value}' is not allowed`
            });
            return;
        }
        seen.add(value);
    });
});
export const agentScopePolicySchema = z.object({
    userIds: uniqueStringArraySchema.default(() => [...defaultAgentScopePolicy.userIds]),
    projectIds: uniqueStringArraySchema.default(() => [
        ...defaultAgentScopePolicy.projectIds
    ]),
    tagIds: uniqueStringArraySchema.default(() => [...defaultAgentScopePolicy.tagIds])
});
const integerMinuteSchema = z
    .number()
    .int()
    .min(0)
    .max(24 * 60);
export const calendarSchedulingRulesSchema = z.object({
    allowWorkBlockKinds: z.array(workBlockKindSchema).default([]),
    blockWorkBlockKinds: z.array(workBlockKindSchema).default([]),
    allowCalendarIds: uniqueStringArraySchema.default([]),
    blockCalendarIds: uniqueStringArraySchema.default([]),
    allowEventTypes: uniqueStringArraySchema.default([]),
    blockEventTypes: uniqueStringArraySchema.default([]),
    allowEventKeywords: uniqueStringArraySchema.default([]),
    blockEventKeywords: uniqueStringArraySchema.default([]),
    allowAvailability: z.array(calendarAvailabilitySchema).default([]),
    blockAvailability: z.array(calendarAvailabilitySchema).default([])
});
export const calendarContextConflictSchema = z.object({
    kind: z.enum(["external_event", "work_block"]),
    id: z.string(),
    title: z.string(),
    reason: z.string(),
    startsAt: z.string(),
    endsAt: z.string()
});
export const userSummarySchema = z.object({
    id: z.string(),
    kind: userKindSchema,
    handle: nonEmptyTrimmedString,
    displayName: nonEmptyTrimmedString,
    description: trimmedString,
    accentColor: z.string(),
    createdAt: z.string(),
    updatedAt: z.string()
});
export const userAccessRightsSchema = z.object({
    discoverable: z.boolean().default(true),
    canListUsers: z.boolean().default(true),
    canReadProfile: z.boolean().default(true),
    canReadEntities: z.boolean().default(true),
    canSearchEntities: z.boolean().default(true),
    canLinkEntities: z.boolean().default(true),
    canCoordinate: z.boolean().default(true),
    canAffectEntities: z.boolean().default(true),
    canManageStrategies: z.boolean().default(true),
    canCreateOnBehalf: z.boolean().default(true),
    canViewMetrics: z.boolean().default(true),
    canViewActivity: z.boolean().default(true)
});
export const userAccessGrantConfigSchema = z.object({
    self: z.boolean().default(false),
    mutable: z.boolean().default(false),
    linkedEntities: z.boolean().default(true),
    rights: userAccessRightsSchema.default({})
});
export const userAccessGrantSchema = z.object({
    id: z.string(),
    subjectUserId: z.string(),
    targetUserId: z.string(),
    accessLevel: userAccessLevelSchema,
    config: userAccessGrantConfigSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    subjectUser: userSummarySchema.nullable().default(null),
    targetUser: userSummarySchema.nullable().default(null)
});
export const updateUserAccessGrantSchema = z.object({
    accessLevel: userAccessLevelSchema.optional(),
    rights: userAccessRightsSchema.partial().optional()
});
export const userOwnershipSummarySchema = z.object({
    userId: z.string(),
    totalOwnedEntities: z.number().int().nonnegative(),
    entityCounts: z.record(z.string(), z.number().int().nonnegative())
});
export const userXpSummarySchema = z.object({
    userId: z.string(),
    totalXp: z.number().int(),
    weeklyXp: z.number().int(),
    rewardEventCount: z.number().int().nonnegative(),
    lastRewardAt: z.string().nullable()
});
export const userDirectoryPayloadSchema = z.object({
    users: z.array(userSummarySchema),
    grants: z.array(userAccessGrantSchema),
    ownership: z.array(userOwnershipSummarySchema),
    xp: z.array(userXpSummarySchema),
    posture: z.object({
        accessModel: z.enum(["permissive", "directional_graph"]),
        summary: z.string(),
        futureReady: z.boolean()
    })
});
const ownershipShape = {
    userId: z.string().nullable().default(null),
    user: userSummarySchema.nullable().default(null),
    ownerUserId: z.string().nullable().default(null),
    ownerUser: userSummarySchema.nullable().default(null),
    assigneeUserIds: z.array(z.string()).default([]),
    assignees: z.array(userSummarySchema).default([])
};
const blockerLinkSchema = z.object({
    entityType: z.string(),
    entityId: z.string(),
    label: trimmedString.optional()
});
const workItemGitRefSchema = z.object({
    id: z.string(),
    workItemId: z.string(),
    refType: workItemGitRefTypeSchema,
    provider: trimmedString.default("git"),
    repository: trimmedString.default(""),
    refValue: nonEmptyTrimmedString,
    url: trimmedString.nullable().default(null),
    displayTitle: trimmedString.default(""),
    createdAt: z.string(),
    updatedAt: z.string()
});
export const gitHelperSearchKindSchema = z.enum([
    "branch",
    "commit",
    "pull_request"
]);
export const gitHelperRefSchema = z.object({
    key: nonEmptyTrimmedString,
    refType: workItemGitRefTypeSchema,
    provider: trimmedString.default("git"),
    repository: trimmedString.default(""),
    refValue: nonEmptyTrimmedString,
    url: trimmedString.nullable().default(null),
    displayTitle: trimmedString.default(""),
    subtitle: trimmedString.default("")
});
export const gitHelperOverviewSchema = z.object({
    repoRoot: nonEmptyTrimmedString,
    provider: trimmedString.default("git"),
    repository: trimmedString.default(""),
    currentBranch: trimmedString.nullable().default(null),
    baseBranch: trimmedString.default("main"),
    branches: z.array(gitHelperRefSchema),
    commits: z.array(gitHelperRefSchema),
    pullRequests: z.array(gitHelperRefSchema),
    warnings: z.array(trimmedString).default([])
});
export const gitHelperSearchResponseSchema = z.object({
    provider: trimmedString.default("git"),
    repository: trimmedString.default(""),
    kind: gitHelperSearchKindSchema,
    refs: z.array(gitHelperRefSchema),
    warnings: z.array(trimmedString).default([])
});
const completionReportSchema = z.object({
    modifiedFiles: z.array(z.string()).default([]),
    workSummary: trimmedString.default(""),
    linkedGitRefIds: z.array(z.string()).default([])
});
export const tagSchema = z.object({
    id: z.string(),
    name: nonEmptyTrimmedString,
    kind: tagKindSchema,
    color: z.string(),
    description: z.string(),
    ...ownershipShape
});
export const taskTimeSummarySchema = z.object({
    totalTrackedSeconds: z.number().int().nonnegative(),
    totalCreditedSeconds: z.number().nonnegative(),
    liveTrackedSeconds: z.number().int().nonnegative().default(0),
    liveCreditedSeconds: z.number().nonnegative().default(0),
    manualAdjustedSeconds: z.number().int().default(0),
    activeRunCount: z.number().int().nonnegative(),
    hasCurrentRun: z.boolean(),
    currentRunId: z.string().nullable()
});
export const workAdjustmentSchema = z.object({
    id: z.string(),
    entityType: workAdjustmentEntityTypeSchema,
    entityId: z.string(),
    requestedDeltaMinutes: z
        .number()
        .int()
        .refine((value) => value !== 0, {
        message: "requestedDeltaMinutes must not be zero"
    }),
    appliedDeltaMinutes: z.number().int(),
    note: z.string(),
    actor: z.string().nullable(),
    source: activitySourceSchema,
    createdAt: z.string()
});
export const workAdjustmentTargetSummarySchema = z.object({
    entityType: workAdjustmentEntityTypeSchema,
    entityId: z.string(),
    title: z.string(),
    time: taskTimeSummarySchema
});
export const workAdjustmentResultSchema = z.object({
    adjustment: workAdjustmentSchema,
    target: workAdjustmentTargetSummarySchema,
    reward: z.lazy(() => rewardLedgerEventSchema).nullable(),
    metrics: z.lazy(() => xpMetricsPayloadSchema)
});
export const actionDemandWeightsSchema = z.object({
    activation: z.number().min(0).max(1),
    focus: z.number().min(0).max(1),
    vigor: z.number().min(0).max(1),
    composure: z.number().min(0).max(1),
    flow: z.number().min(0).max(1)
});
export const actionProfileSchema = z.object({
    id: z.string(),
    profileKey: nonEmptyTrimmedString,
    title: nonEmptyTrimmedString,
    entityType: trimmedString.nullable().default(null),
    mode: actionProfileModeSchema,
    startupAp: z.number().min(0).default(0),
    totalCostAp: z.number().min(0).default(0),
    expectedDurationSeconds: z.number().int().positive().nullable().default(null),
    sustainRateApPerHour: z.number().min(0).default(0),
    demandWeights: actionDemandWeightsSchema,
    doubleCountPolicy: z.enum([
        "primary_only",
        "secondary_weighted",
        "always_count",
        "container_only"
    ]),
    sourceMethod: actionProfileSourceMethodSchema,
    costBand: actionCostBandSchema.default("standard"),
    recoveryEffect: z.number().default(0),
    metadata: z.record(z.string(), z.unknown()).default({}),
    createdAt: z.string(),
    updatedAt: z.string()
});
export const taskActionPointSummarySchema = z.object({
    costBand: actionCostBandSchema,
    totalCostAp: z.number().min(0),
    expectedDurationSeconds: z.number().int().positive(),
    sustainRateApPerHour: z.number().min(0),
    spentTodayAp: z.number().min(0),
    spentTotalAp: z.number().min(0),
    remainingAp: z.number().min(0)
});
export const taskSplitSuggestionSchema = z.object({
    shouldSplit: z.boolean(),
    reason: trimmedString.nullable().default(null),
    thresholdSeconds: z.number().int().positive()
});
export const lifeForceStatStateSchema = z.object({
    key: lifeForceStatKeySchema,
    label: nonEmptyTrimmedString,
    level: z.number().int().min(1),
    xp: z.number().min(0),
    xpToNextLevel: z.number().min(0),
    costModifier: z.number().min(0)
});
export const lifeForceCurvePointSchema = z.object({
    minuteOfDay: z.number().int().min(0).max(24 * 60),
    rateApPerHour: z.number().min(0),
    locked: z.boolean().optional()
});
export const lifeForceDrainEntrySchema = z.object({
    id: z.string(),
    sourceType: nonEmptyTrimmedString,
    sourceId: nonEmptyTrimmedString,
    title: nonEmptyTrimmedString,
    role: z.enum(["primary", "secondary", "background", "recovery"]),
    apPerHour: z.number(),
    instantAp: z.number(),
    why: trimmedString.default(""),
    startedAt: z.string().nullable().default(null),
    endsAt: z.string().nullable().default(null)
});
export const lifeForceWarningSchema = z.object({
    id: z.string(),
    tone: z.enum(["info", "warning", "danger", "success"]),
    title: nonEmptyTrimmedString,
    detail: trimmedString.default("")
});
export const lifeForcePayloadSchema = z.object({
    userId: z.string(),
    dateKey: dateOnlySchema,
    baselineDailyAp: z.number().min(0),
    dailyBudgetAp: z.number().min(0),
    spentTodayAp: z.number(),
    remainingAp: z.number(),
    forecastAp: z.number(),
    plannedRemainingAp: z.number(),
    targetBandMinAp: z.number().min(0),
    targetBandMaxAp: z.number().min(0),
    instantCapacityApPerHour: z.number().min(0),
    instantFreeApPerHour: z.number(),
    overloadApPerHour: z.number().min(0),
    currentDrainApPerHour: z.number().min(0),
    fatigueBufferApPerHour: z.number().min(0),
    sleepRecoveryMultiplier: z.number().min(0),
    readinessMultiplier: z.number().min(0),
    fatigueDebtCarry: z.number().min(0),
    stats: z.array(lifeForceStatStateSchema),
    currentCurve: z.array(lifeForceCurvePointSchema),
    activeDrains: z.array(lifeForceDrainEntrySchema),
    plannedDrains: z.array(lifeForceDrainEntrySchema),
    warnings: z.array(lifeForceWarningSchema),
    recommendations: z.array(trimmedString),
    topTaskIdsNeedingSplit: z.array(z.string()),
    updatedAt: z.string()
});
export const noteLinkSchema = z.object({
    entityType: crudEntityTypeSchema,
    entityId: nonEmptyTrimmedString,
    anchorKey: trimmedString.nullable().default(null)
});
const noteTagSchema = nonEmptyTrimmedString.max(80);
const uniqueNoteTagArraySchema = z
    .array(noteTagSchema)
    .max(24)
    .superRefine((values, context) => {
    const seen = new Set();
    values.forEach((value, index) => {
        const normalized = value.toLowerCase();
        if (seen.has(normalized)) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: [index],
                message: `Duplicate note tag '${value}' is not allowed`
            });
            return;
        }
        seen.add(normalized);
    });
});
export const noteSchema = z.object({
    id: z.string(),
    kind: noteKindSchema.default("evidence"),
    title: nonEmptyTrimmedString,
    slug: nonEmptyTrimmedString,
    spaceId: nonEmptyTrimmedString,
    parentSlug: trimmedString.nullable().default(null),
    indexOrder: z.number().int().default(0),
    showInIndex: z.boolean().default(true),
    aliases: uniqueStringArraySchema.default([]),
    summary: trimmedString.default(""),
    contentMarkdown: nonEmptyTrimmedString,
    contentPlain: trimmedString,
    author: z.string().nullable(),
    source: activitySourceSchema,
    sourcePath: trimmedString.default(""),
    frontmatter: z.record(z.string(), z.unknown()).default({}),
    revisionHash: trimmedString.default(""),
    lastSyncedAt: dateTimeSchema.nullable().default(null),
    createdAt: z.string(),
    updatedAt: z.string(),
    links: z.array(noteLinkSchema).default([]),
    tags: uniqueNoteTagArraySchema.default([]),
    destroyAt: dateTimeSchema.nullable().default(null),
    ...ownershipShape
});
export const noteSummarySchema = z.object({
    count: z.number().int().nonnegative(),
    latestNoteId: z.string().nullable(),
    latestCreatedAt: z.string().nullable()
});
export const notesSummaryByEntitySchema = z.record(z.string(), noteSummarySchema);
export const goalSchema = z.object({
    id: z.string(),
    title: nonEmptyTrimmedString,
    description: trimmedString,
    horizon: goalHorizonSchema,
    status: goalStatusSchema,
    targetPoints: z.number().int().nonnegative(),
    themeColor: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    tagIds: uniqueStringArraySchema.default([]),
    ...ownershipShape
});
export const projectSchema = z.object({
    id: z.string(),
    goalId: z.string(),
    title: nonEmptyTrimmedString,
    description: trimmedString,
    status: projectStatusSchema,
    workflowStatus: projectWorkflowStatusSchema.default("backlog"),
    targetPoints: z.number().int().nonnegative(),
    themeColor: z.string(),
    productRequirementsDocument: trimmedString.default(""),
    schedulingRules: calendarSchedulingRulesSchema.default({
        allowWorkBlockKinds: [],
        blockWorkBlockKinds: [],
        allowCalendarIds: [],
        blockCalendarIds: [],
        allowEventTypes: [],
        blockEventTypes: [],
        allowEventKeywords: [],
        blockEventKeywords: [],
        allowAvailability: [],
        blockAvailability: []
    }),
    createdAt: z.string(),
    updatedAt: z.string(),
    ...ownershipShape
});
export const taskSchema = z.object({
    id: z.string(),
    title: nonEmptyTrimmedString,
    description: trimmedString,
    level: workItemLevelSchema.default("task"),
    status: taskStatusSchema,
    priority: taskPrioritySchema,
    owner: nonEmptyTrimmedString,
    goalId: z.string().nullable(),
    projectId: z.string().nullable(),
    parentWorkItemId: z.string().nullable().default(null),
    dueDate: dateOnlySchema.nullable(),
    effort: taskEffortSchema,
    energy: taskEnergySchema,
    points: z.number().int().nonnegative(),
    sortOrder: z.number().int().nonnegative(),
    plannedDurationSeconds: z
        .number()
        .int()
        .min(60)
        .max(7 * 86_400)
        .nullable()
        .default(86_400),
    schedulingRules: calendarSchedulingRulesSchema.nullable().default(null),
    resolutionKind: taskResolutionKindSchema.nullable().default(null),
    splitParentTaskId: z.string().nullable().default(null),
    aiInstructions: trimmedString.default(""),
    executionMode: workItemExecutionModeSchema.nullable().default(null),
    acceptanceCriteria: z.array(trimmedString).default([]),
    blockerLinks: z.array(blockerLinkSchema).default([]),
    completionReport: completionReportSchema.nullable().default(null),
    gitRefs: z.array(workItemGitRefSchema).default([]),
    completedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    tagIds: z.array(z.string()).default([]),
    ...ownershipShape,
    time: taskTimeSummarySchema.default({
        totalTrackedSeconds: 0,
        totalCreditedSeconds: 0,
        liveTrackedSeconds: 0,
        liveCreditedSeconds: 0,
        manualAdjustedSeconds: 0,
        activeRunCount: 0,
        hasCurrentRun: false,
        currentRunId: null
    }),
    actionPointSummary: taskActionPointSummarySchema.default({
        costBand: "standard",
        totalCostAp: 100,
        expectedDurationSeconds: 86_400,
        sustainRateApPerHour: 100 / 24,
        spentTodayAp: 0,
        spentTotalAp: 0,
        remainingAp: 100
    }),
    splitSuggestion: taskSplitSuggestionSchema.default({
        shouldSplit: false,
        reason: null,
        thresholdSeconds: 2 * 86_400
    })
});
export const taskRunSchema = z.object({
    id: z.string(),
    taskId: z.string(),
    taskTitle: nonEmptyTrimmedString,
    actor: nonEmptyTrimmedString,
    status: taskRunStatusSchema,
    timerMode: taskTimerModeSchema,
    plannedDurationSeconds: z.number().int().positive().nullable(),
    elapsedWallSeconds: z.number().int().nonnegative(),
    creditedSeconds: z.number().nonnegative(),
    remainingSeconds: z.number().int().nonnegative().nullable(),
    overtimeSeconds: z.number().int().nonnegative(),
    isCurrent: z.boolean(),
    note: trimmedString,
    leaseTtlSeconds: z.number().int().positive(),
    claimedAt: z.string(),
    heartbeatAt: z.string(),
    leaseExpiresAt: z.string(),
    completedAt: z.string().nullable(),
    releasedAt: z.string().nullable(),
    timedOutAt: z.string().nullable(),
    overrideReason: trimmedString.nullable().default(null),
    gitContext: z
        .object({
        provider: trimmedString.default(""),
        repository: trimmedString.default(""),
        branch: trimmedString.default(""),
        baseBranch: trimmedString.default("main"),
        branchUrl: trimmedString.nullable().default(null),
        pullRequestUrl: trimmedString.nullable().default(null),
        pullRequestNumber: z.number().int().positive().nullable().default(null),
        compareUrl: trimmedString.nullable().default(null)
    })
        .nullable()
        .optional(),
    updatedAt: z.string(),
    ...ownershipShape
});
export const calendarConnectionSchema = z.object({
    id: z.string(),
    provider: calendarProviderSchema,
    label: nonEmptyTrimmedString,
    accountLabel: trimmedString,
    status: calendarConnectionStatusSchema,
    config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    forgeCalendarId: z.string().nullable(),
    lastSyncedAt: z.string().nullable(),
    lastSyncError: trimmedString.nullable(),
    createdAt: z.string(),
    updatedAt: z.string()
});
export const calendarDiscoveryCalendarSchema = z.object({
    url: nonEmptyTrimmedString.url(),
    displayName: nonEmptyTrimmedString,
    description: trimmedString,
    color: z.string(),
    timezone: trimmedString,
    isPrimary: z.boolean(),
    canWrite: z.boolean(),
    selectedByDefault: z.boolean(),
    isForgeCandidate: z.boolean(),
    sourceId: trimmedString.nullable().default(null),
    sourceTitle: trimmedString.nullable().default(null),
    sourceType: trimmedString.nullable().default(null),
    calendarType: trimmedString.nullable().default(null),
    hostCalendarId: trimmedString.nullable().default(null),
    canonicalKey: trimmedString.nullable().default(null)
});
export const calendarDiscoveryPayloadSchema = z.object({
    provider: calendarProviderSchema,
    accountLabel: trimmedString,
    serverUrl: nonEmptyTrimmedString.url(),
    principalUrl: z.string().nullable(),
    homeUrl: z.string().nullable(),
    calendars: z.array(calendarDiscoveryCalendarSchema)
});
export const macosLocalCalendarSourceSchema = z.object({
    sourceId: nonEmptyTrimmedString,
    sourceTitle: trimmedString,
    sourceType: trimmedString,
    accountLabel: trimmedString,
    accountIdentityKey: trimmedString,
    calendars: z.array(calendarDiscoveryCalendarSchema)
});
export const macosLocalCalendarDiscoveryPayloadSchema = z.object({
    status: macosCalendarAccessStatusSchema,
    requestedAt: z.string(),
    sources: z.array(macosLocalCalendarSourceSchema)
});
export const calendarSchema = z.object({
    id: z.string(),
    connectionId: z.string(),
    remoteId: nonEmptyTrimmedString,
    title: nonEmptyTrimmedString,
    description: trimmedString,
    color: z.string(),
    timezone: nonEmptyTrimmedString,
    isPrimary: z.boolean(),
    canWrite: z.boolean(),
    selectedForSync: z.boolean(),
    forgeManaged: z.boolean(),
    sourceId: trimmedString.nullable().default(null),
    sourceTitle: trimmedString.nullable().default(null),
    sourceType: trimmedString.nullable().default(null),
    calendarType: trimmedString.nullable().default(null),
    hostCalendarId: trimmedString.nullable().default(null),
    canonicalKey: trimmedString.nullable().default(null),
    lastSyncedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string()
});
export const calendarEventSourceSchema = z.object({
    id: z.string(),
    provider: calendarProviderSchema,
    connectionId: z.string().nullable(),
    calendarId: z.string().nullable(),
    remoteCalendarId: trimmedString.nullable(),
    remoteEventId: nonEmptyTrimmedString,
    remoteUid: trimmedString.nullable(),
    recurrenceInstanceId: trimmedString.nullable(),
    isMasterRecurring: z.boolean(),
    remoteHref: trimmedString.nullable(),
    remoteEtag: trimmedString.nullable(),
    syncState: z.enum([
        "pending_create",
        "pending_update",
        "pending_delete",
        "synced",
        "error",
        "deleted"
    ]),
    lastSyncedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string()
});
export const calendarEventLinkSchema = z.object({
    id: z.string(),
    entityType: crudEntityTypeSchema,
    entityId: nonEmptyTrimmedString,
    relationshipType: nonEmptyTrimmedString.default("context"),
    createdAt: z.string(),
    updatedAt: z.string()
});
export const calendarEventSchema = z.object({
    id: z.string(),
    connectionId: z.string().nullable(),
    calendarId: z.string().nullable(),
    remoteId: trimmedString.nullable(),
    ownership: calendarOwnershipSchema,
    originType: calendarEventOriginSchema,
    status: calendarEventStatusSchema,
    title: nonEmptyTrimmedString,
    description: trimmedString,
    location: trimmedString,
    place: z
        .object({
        label: trimmedString,
        address: trimmedString,
        timezone: trimmedString,
        latitude: z.number().nullable(),
        longitude: z.number().nullable(),
        source: trimmedString,
        externalPlaceId: trimmedString
    })
        .default({
        label: "",
        address: "",
        timezone: "",
        latitude: null,
        longitude: null,
        source: "",
        externalPlaceId: ""
    }),
    startAt: z.string(),
    endAt: z.string(),
    timezone: nonEmptyTrimmedString,
    isAllDay: z.boolean(),
    availability: calendarAvailabilitySchema,
    eventType: trimmedString,
    categories: z.array(z.string()).default([]),
    sourceMappings: z.array(calendarEventSourceSchema).default([]),
    links: z.array(calendarEventLinkSchema).default([]),
    actionProfile: actionProfileSchema.nullable().default(null),
    remoteUpdatedAt: z.string().nullable(),
    deletedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    ...ownershipShape
});
export const workBlockTemplateSchema = z
    .object({
    id: z.string(),
    title: nonEmptyTrimmedString,
    kind: workBlockKindSchema,
    color: z.string(),
    timezone: nonEmptyTrimmedString,
    weekDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    startMinute: integerMinuteSchema,
    endMinute: integerMinuteSchema,
    startsOn: dateOnlySchema.nullable().default(null),
    endsOn: dateOnlySchema.nullable().default(null),
    blockingState: z.enum(["allowed", "blocked"]),
    actionProfile: actionProfileSchema.nullable().default(null),
    createdAt: z.string(),
    updatedAt: z.string(),
    ...ownershipShape
})
    .superRefine((value, context) => {
    if (value.endMinute <= value.startMinute) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["endMinute"],
            message: "endMinute must be greater than startMinute"
        });
    }
    if (value.startsOn && value.endsOn && value.endsOn < value.startsOn) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["endsOn"],
            message: "endsOn must be on or after startsOn"
        });
    }
});
export const workBlockInstanceSchema = z.object({
    id: z.string(),
    templateId: z.string(),
    dateKey: dateOnlySchema,
    startAt: z.string(),
    endAt: z.string(),
    title: nonEmptyTrimmedString,
    kind: workBlockKindSchema,
    color: z.string(),
    blockingState: z.enum(["allowed", "blocked"]),
    calendarEventId: z.string().nullable(),
    actionProfile: actionProfileSchema.nullable().default(null),
    createdAt: z.string(),
    updatedAt: z.string()
});
export const taskTimeboxSchema = z.object({
    id: z.string(),
    taskId: z.string(),
    projectId: z.string().nullable(),
    connectionId: z.string().nullable(),
    calendarId: z.string().nullable(),
    remoteEventId: z.string().nullable(),
    linkedTaskRunId: z.string().nullable(),
    status: calendarTimeboxStatusSchema,
    source: calendarTimeboxSourceSchema,
    title: nonEmptyTrimmedString,
    startsAt: z.string(),
    endsAt: z.string(),
    overrideReason: trimmedString.nullable(),
    actionProfile: actionProfileSchema.nullable().default(null),
    createdAt: z.string(),
    updatedAt: z.string(),
    ...ownershipShape
});
export const calendarOverviewPayloadSchema = z.object({
    generatedAt: z.string(),
    providers: z.array(z.object({
        provider: calendarProviderSchema,
        label: z.string(),
        supportsDedicatedForgeCalendar: z.boolean(),
        connectionHelp: z.string()
    })),
    connections: z.array(calendarConnectionSchema),
    calendars: z.array(calendarSchema),
    events: z.array(calendarEventSchema),
    workBlockTemplates: z.array(workBlockTemplateSchema),
    workBlockInstances: z.array(workBlockInstanceSchema),
    timeboxes: z.array(taskTimeboxSchema)
});
export const habitCheckInSchema = z.object({
    id: z.string(),
    habitId: z.string(),
    dateKey: z.string(),
    status: habitCheckInStatusSchema,
    note: z.string(),
    deltaXp: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string()
});
export const habitSchema = z.object({
    id: z.string(),
    title: nonEmptyTrimmedString,
    description: trimmedString,
    status: habitStatusSchema,
    polarity: habitPolaritySchema,
    frequency: habitFrequencySchema,
    targetCount: z.number().int().positive(),
    weekDays: z.array(z.number().int().min(0).max(6)).default([]),
    linkedGoalIds: uniqueStringArraySchema.default([]),
    linkedProjectIds: uniqueStringArraySchema.default([]),
    linkedTaskIds: uniqueStringArraySchema.default([]),
    linkedValueIds: uniqueStringArraySchema.default([]),
    linkedPatternIds: uniqueStringArraySchema.default([]),
    linkedBehaviorIds: uniqueStringArraySchema.default([]),
    linkedBeliefIds: uniqueStringArraySchema.default([]),
    linkedModeIds: uniqueStringArraySchema.default([]),
    linkedReportIds: uniqueStringArraySchema.default([]),
    linkedBehaviorId: z.string().nullable(),
    linkedBehaviorTitle: z.string().nullable(),
    linkedBehaviorTitles: z.array(z.string()).default([]),
    rewardXp: z.number().int().positive(),
    penaltyXp: z.number().int().positive(),
    generatedHealthEventTemplate: z
        .object({
        enabled: z.boolean().default(false),
        workoutType: trimmedString.default("workout"),
        title: trimmedString.default(""),
        durationMinutes: z
            .number()
            .int()
            .positive()
            .max(24 * 60)
            .default(45),
        xpReward: z.number().int().min(0).max(500).default(0),
        tags: uniqueStringArraySchema.default([]),
        links: z
            .array(z.object({
            entityType: trimmedString,
            entityId: nonEmptyTrimmedString,
            relationshipType: trimmedString.default("context")
        }))
            .default([]),
        notesTemplate: trimmedString.default("")
    })
        .default({
        enabled: false,
        workoutType: "workout",
        title: "",
        durationMinutes: 45,
        xpReward: 0,
        tags: [],
        links: [],
        notesTemplate: ""
    }),
    createdAt: z.string(),
    updatedAt: z.string(),
    lastCheckInAt: z.string().nullable(),
    lastCheckInStatus: habitCheckInStatusSchema.nullable(),
    streakCount: z.number().int().nonnegative(),
    completionRate: z.number().min(0).max(100),
    dueToday: z.boolean(),
    checkIns: z.array(habitCheckInSchema).default([]),
    ...ownershipShape
});
export const activityEventSchema = z.object({
    id: z.string(),
    entityType: activityEntityTypeSchema,
    entityId: z.string(),
    eventType: z.string(),
    title: z.string(),
    description: z.string(),
    actor: z.string().nullable(),
    source: activitySourceSchema,
    metadata: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
    ...ownershipShape
});
export const dashboardGoalSchema = goalSchema.extend({
    progress: z.number().min(0).max(100),
    totalTasks: z.number().int().nonnegative(),
    completedTasks: z.number().int().nonnegative(),
    earnedPoints: z.number().int().nonnegative(),
    momentumLabel: z.string(),
    tags: z.array(tagSchema)
});
export const dashboardStatsSchema = z.object({
    totalPoints: z.number().int().nonnegative(),
    completedThisWeek: z.number().int().nonnegative(),
    activeGoals: z.number().int().nonnegative(),
    alignmentScore: z.number().int().nonnegative(),
    focusTasks: z.number().int().nonnegative(),
    overdueTasks: z.number().int().nonnegative(),
    dueThisWeek: z.number().int().nonnegative()
});
export const executionBucketToneSchema = z.enum([
    "urgent",
    "accent",
    "neutral",
    "success"
]);
export const dashboardExecutionBucketSchema = z.object({
    id: z.enum(["overdue", "due_soon", "focus_now", "recently_completed"]),
    label: z.string(),
    summary: z.string(),
    tone: executionBucketToneSchema,
    tasks: z.array(taskSchema)
});
export const projectSummarySchema = projectSchema.extend({
    goalTitle: z.string(),
    activeTaskCount: z.number().int().nonnegative(),
    completedTaskCount: z.number().int().nonnegative(),
    totalTasks: z.number().int().nonnegative(),
    earnedPoints: z.number().int().nonnegative(),
    progress: z.number().min(0).max(100),
    nextTaskId: z.string().nullable(),
    nextTaskTitle: z.string().nullable(),
    momentumLabel: z.string(),
    time: taskTimeSummarySchema
});
export const gamificationProfileSchema = z.object({
    totalXp: z.number().int().nonnegative(),
    level: z.number().int().positive(),
    currentLevelXp: z.number().int().nonnegative(),
    nextLevelXp: z.number().int().positive(),
    weeklyXp: z.number().int().nonnegative(),
    streakDays: z.number().int().nonnegative(),
    comboMultiplier: z.number().nonnegative(),
    momentumScore: z.number().int().min(0).max(100),
    topGoalId: z.string().nullable(),
    topGoalTitle: z.string().nullable()
});
export const achievementTierSchema = z.enum([
    "bronze",
    "silver",
    "gold",
    "platinum"
]);
export const achievementSignalSchema = z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    tier: achievementTierSchema,
    progressLabel: z.string(),
    unlocked: z.boolean(),
    unlockedAt: z.string().nullable()
});
export const milestoneRewardSchema = z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    rewardLabel: z.string(),
    progressLabel: z.string(),
    current: z.number().int().nonnegative(),
    target: z.number().int().positive(),
    completed: z.boolean()
});
export const gamificationOverviewSchema = z.object({
    profile: gamificationProfileSchema,
    achievements: z.array(achievementSignalSchema),
    milestoneRewards: z.array(milestoneRewardSchema)
});
export const xpMomentumPulseSchema = z.object({
    status: z.enum(["surging", "steady", "recovering"]),
    headline: z.string(),
    detail: z.string(),
    celebrationLabel: z.string(),
    nextMilestoneId: z.string().nullable(),
    nextMilestoneLabel: z.string()
});
export const dashboardPayloadSchema = z.object({
    stats: dashboardStatsSchema,
    goals: z.array(dashboardGoalSchema),
    projects: z.array(projectSummarySchema),
    tasks: z.array(taskSchema),
    habits: z.array(habitSchema),
    tags: z.array(tagSchema),
    suggestedTags: z.array(tagSchema),
    owners: z.array(z.string()),
    executionBuckets: z.array(dashboardExecutionBucketSchema),
    gamification: gamificationProfileSchema,
    achievements: z.array(achievementSignalSchema),
    milestoneRewards: z.array(milestoneRewardSchema),
    recentActivity: z.array(activityEventSchema),
    notesSummaryByEntity: notesSummaryByEntitySchema.default({})
});
export const contextDomainBalanceSchema = z.object({
    tagId: z.string(),
    label: z.string(),
    color: z.string(),
    goalCount: z.number().int().nonnegative(),
    activeTaskCount: z.number().int().nonnegative(),
    completedPoints: z.number().int().nonnegative(),
    momentumLabel: z.string()
});
export const contextNeglectedGoalSchema = z.object({
    goalId: z.string(),
    title: z.string(),
    summary: z.string(),
    risk: z.enum(["low", "medium", "high"])
});
export const overviewContextSchema = z.object({
    generatedAt: z.string(),
    strategicHeader: z.object({
        streakDays: z.number().int().nonnegative(),
        level: z.number().int().positive(),
        totalXp: z.number().int().nonnegative(),
        currentLevelXp: z.number().int().nonnegative(),
        nextLevelXp: z.number().int().positive(),
        momentumScore: z.number().int().min(0).max(100),
        focusTasks: z.number().int().nonnegative(),
        overdueTasks: z.number().int().nonnegative()
    }),
    projects: z.array(projectSummarySchema),
    activeGoals: z.array(dashboardGoalSchema),
    topTasks: z.array(taskSchema),
    dueHabits: z.array(habitSchema),
    recentEvidence: z.array(activityEventSchema),
    achievements: z.array(achievementSignalSchema),
    domainBalance: z.array(contextDomainBalanceSchema),
    neglectedGoals: z.array(contextNeglectedGoalSchema)
});
export const todayQuestSchema = z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    rewardXp: z.number().int().positive(),
    progressLabel: z.string(),
    completed: z.boolean()
});
export const todayTimelineBucketSchema = z.object({
    id: z.enum([
        "completed",
        "active",
        "upcoming",
        "deferred",
        "in_progress",
        "ready",
        "blocked",
        "done"
    ]),
    label: z.string(),
    tasks: z.array(taskSchema)
});
export const todayContextSchema = z.object({
    generatedAt: z.string(),
    directive: z.object({
        task: taskSchema.nullable(),
        goalTitle: z.string().nullable(),
        rewardXp: z.number().int().nonnegative(),
        sessionLabel: z.string()
    }),
    timeline: z.array(todayTimelineBucketSchema),
    dueHabits: z.array(habitSchema),
    dailyQuests: z.array(todayQuestSchema),
    milestoneRewards: z.array(milestoneRewardSchema),
    recentHabitRewards: z
        .array(z.lazy(() => rewardLedgerEventSchema))
        .default([]),
    momentum: z.object({
        streakDays: z.number().int().nonnegative(),
        momentumScore: z.number().int().min(0).max(100),
        recoveryHint: z.string()
    })
});
export const riskContextSchema = z.object({
    generatedAt: z.string(),
    overdueTasks: z.array(taskSchema),
    blockedTasks: z.array(taskSchema),
    neglectedGoals: z.array(contextNeglectedGoalSchema),
    summary: z.string()
});
export const taskContextPayloadSchema = z.object({
    task: taskSchema,
    goal: goalSchema.nullable(),
    project: projectSummarySchema.nullable(),
    activeTaskRun: taskRunSchema.nullable(),
    taskRuns: z.array(taskRunSchema),
    activity: z.array(activityEventSchema),
    notesSummaryByEntity: notesSummaryByEntitySchema.default({})
});
export const projectBoardPayloadSchema = z.object({
    project: projectSummarySchema,
    goal: goalSchema,
    tasks: z.array(taskSchema),
    activity: z.array(activityEventSchema),
    notesSummaryByEntity: notesSummaryByEntitySchema.default({})
});
export const insightsHeatmapCellSchema = z.object({
    id: z.string(),
    label: z.string(),
    completed: z.number().int().nonnegative(),
    focus: z.number().int().nonnegative(),
    intensity: z.number().int().min(0).max(4)
});
export const insightsExecutionTrendSchema = z.object({
    label: z.string(),
    xp: z.number().int().nonnegative(),
    focusScore: z.number().int().min(0).max(100)
});
export const insightsDomainBalanceRowSchema = z.object({
    label: z.string(),
    value: z.number().int().min(0).max(100),
    color: z.string(),
    note: z.string()
});
export const coachingInsightSchema = z.object({
    title: z.string(),
    summary: z.string(),
    recommendation: z.string(),
    ctaLabel: z.string()
});
export const insightsPayloadSchema = z.object({
    generatedAt: z.string(),
    status: z.object({
        systemStatus: z.string(),
        streakDays: z.number().int().nonnegative(),
        momentumScore: z.number().int().min(0).max(100)
    }),
    momentumHeatmap: z.array(insightsHeatmapCellSchema),
    executionTrends: z.array(insightsExecutionTrendSchema),
    domainBalance: z.array(insightsDomainBalanceRowSchema),
    coaching: coachingInsightSchema,
    evidenceDigest: z.array(activityEventSchema),
    feed: z.array(z.lazy(() => insightSchema)),
    openCount: z.number().int().nonnegative()
});
export const weeklyReviewChartPointSchema = z.object({
    label: z.string(),
    xp: z.number().int().nonnegative(),
    focusHours: z.number().int().nonnegative()
});
export const weeklyReviewWinSchema = z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    rewardXp: z.number().int().nonnegative()
});
export const weeklyReviewCalibrationSchema = z.object({
    id: z.string(),
    title: z.string(),
    mode: z.enum(["accelerate", "maintain", "recover"]),
    note: z.string()
});
export const weeklyReviewPayloadSchema = z.object({
    generatedAt: z.string(),
    windowLabel: z.string(),
    weekKey: z.string(),
    weekStartDate: z.string(),
    weekEndDate: z.string(),
    momentumSummary: z.object({
        totalXp: z.number().int().nonnegative(),
        focusHours: z.number().int().nonnegative(),
        efficiencyScore: z.number().int().min(0).max(100),
        peakWindow: z.string()
    }),
    chart: z.array(weeklyReviewChartPointSchema),
    wins: z.array(weeklyReviewWinSchema),
    calibration: z.array(weeklyReviewCalibrationSchema),
    reward: z.object({
        title: z.string(),
        summary: z.string(),
        rewardXp: z.number().int().nonnegative()
    }),
    completion: z.object({
        finalized: z.boolean(),
        finalizedAt: z.string().nullable(),
        finalizedBy: z.string().nullable()
    })
});
export const weeklyReviewClosureSchema = z.object({
    id: z.string(),
    weekKey: z.string(),
    weekStartDate: z.string(),
    weekEndDate: z.string(),
    windowLabel: z.string(),
    actor: z.string().nullable(),
    source: activitySourceSchema,
    rewardId: z.string(),
    activityEventId: z.string(),
    createdAt: z.string()
});
export const finalizeWeeklyReviewResultSchema = z.object({
    review: weeklyReviewPayloadSchema,
    closure: weeklyReviewClosureSchema,
    reward: z.lazy(() => rewardLedgerEventSchema),
    metrics: z.lazy(() => xpMetricsPayloadSchema)
});
export const notificationPreferencesSchema = z.object({
    goalDriftAlerts: z.boolean(),
    dailyQuestReminders: z.boolean(),
    achievementCelebrations: z.boolean()
});
const hexColorSchema = z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color");
export const themePreferenceSchema = z.enum([
    "obsidian",
    "solar",
    "aurora",
    "ember",
    "paper",
    "dawn",
    "atelier",
    "custom",
    "system"
]);
export const customThemeSchema = z.object({
    label: z.string().trim().min(1).max(40),
    primary: hexColorSchema,
    secondary: hexColorSchema,
    tertiary: hexColorSchema,
    canvas: hexColorSchema,
    panel: hexColorSchema,
    panelHigh: hexColorSchema,
    panelLow: hexColorSchema,
    ink: hexColorSchema
});
export const executionSettingsSchema = z.object({
    maxActiveTasks: z.number().int().min(1).max(8),
    timeAccountingMode: timeAccountingModeSchema
});
export const microsoftCalendarAuthSettingsSchema = z.object({
    clientId: z.string(),
    tenantId: z.string(),
    redirectUri: z.string(),
    usesClientSecret: z.literal(false),
    readOnly: z.literal(true),
    authMode: z.literal("public_client_pkce"),
    isConfigured: z.boolean(),
    isReadyForSignIn: z.boolean(),
    setupMessage: z.string()
});
export const googleCalendarAuthSettingsSchema = z.object({
    clientId: z.string(),
    clientSecret: z.string(),
    storedClientId: z.string(),
    storedClientSecret: z.string(),
    appBaseUrl: z.string(),
    redirectUri: z.string(),
    allowedOrigins: z.array(z.string()),
    usesPkce: z.literal(true),
    requiresServerClientSecret: z.literal(false),
    oauthClientType: z.literal("desktop_app"),
    authMode: z.literal("localhost_pkce"),
    isConfigured: z.boolean(),
    isReadyForPairing: z.boolean(),
    isLocalOnly: z.literal(true),
    runtimeOrigin: z.string(),
    setupMessage: z.string()
});
export const aiModelProviderSchema = z.enum([
    "openai-api",
    "openai-codex",
    "openai-compatible",
    "mock"
]);
export const aiModelAuthModeSchema = z.enum(["api_key", "oauth"]);
export const aiModelConnectionStatusSchema = z.enum([
    "connected",
    "needs_attention"
]);
export const aiModelConnectionSchema = z.object({
    id: z.string(),
    label: z.string(),
    provider: aiModelProviderSchema,
    authMode: aiModelAuthModeSchema,
    baseUrl: z.string(),
    model: z.string(),
    accountLabel: z.string().nullable(),
    enabled: z.boolean(),
    status: aiModelConnectionStatusSchema,
    hasStoredCredential: z.boolean(),
    usesOAuth: z.boolean(),
    supportsCustomBaseUrl: z.boolean(),
    agentId: z.string(),
    agentLabel: z.string(),
    createdAt: z.string(),
    updatedAt: z.string()
});
export const forgeAgentModelSlotSchema = z.object({
    connectionId: z.string().nullable(),
    connectionLabel: z.string().nullable(),
    provider: aiModelProviderSchema.nullable(),
    baseUrl: z.string().nullable(),
    model: z.string()
});
export const modelSettingsPayloadSchema = z.object({
    forgeAgent: z.object({
        basicChat: forgeAgentModelSlotSchema,
        wiki: forgeAgentModelSlotSchema
    }),
    connections: z.array(aiModelConnectionSchema),
    oauth: z.object({
        openAiCodex: z.object({
            authorizeUrl: z.string(),
            callbackUrl: z.string(),
            setupMessage: z.string()
        })
    })
});
export const aiProcessorTriggerModeSchema = z.enum([
    "manual",
    "route",
    "cron"
]);
export const aiProcessorCapabilityModeSchema = z.enum([
    "content",
    "tool",
    "mcp",
    "processor"
]);
export const aiProcessorAccessModeSchema = z.enum([
    "read",
    "write",
    "read_write",
    "exec"
]);
export const aiProcessorMachineAccessSchema = z.object({
    read: z.boolean().default(false),
    write: z.boolean().default(false),
    exec: z.boolean().default(false)
});
export const aiProcessorAgentConfigSchema = z.object({
    agentId: nonEmptyTrimmedString,
    connectionId: trimmedString.nullable().default(null),
    model: trimmedString.default("")
});
export const aiProcessorToolSchema = z.object({
    key: nonEmptyTrimmedString,
    label: nonEmptyTrimmedString,
    description: trimmedString.default(""),
    endpoint: trimmedString.default(""),
    mode: aiProcessorCapabilityModeSchema.default("tool")
});
export const surfaceWidgetPreferencesSchema = z.object({
    hidden: z.boolean().default(false),
    fullWidth: z.boolean().default(false),
    titleVisible: z.boolean().default(true),
    descriptionVisible: z.boolean().default(true)
});
export const surfaceLayoutPayloadSchema = z.object({
    surfaceId: nonEmptyTrimmedString,
    order: z.array(nonEmptyTrimmedString).default([]),
    widgets: z.record(z.string(), surfaceWidgetPreferencesSchema).default({}),
    updatedAt: z.string()
});
export const writeSurfaceLayoutSchema = z.object({
    order: z.array(nonEmptyTrimmedString).default([]),
    widgets: z.record(z.string(), surfaceWidgetPreferencesSchema).default({})
});
export const aiProcessorSchema = z.object({
    id: z.string(),
    slug: z.string(),
    surfaceId: z.string(),
    title: z.string(),
    promptFlow: z.string(),
    contextInput: z.string(),
    toolConfig: z.array(aiProcessorToolSchema),
    agentIds: z.array(z.string()),
    agentConfigs: z.array(aiProcessorAgentConfigSchema),
    triggerMode: aiProcessorTriggerModeSchema,
    cronExpression: z.string(),
    machineAccess: aiProcessorMachineAccessSchema,
    endpointEnabled: z.boolean(),
    lastRunAt: z.string().nullable(),
    lastRunStatus: z.enum(["idle", "running", "completed", "failed"]).nullable(),
    lastRunOutput: z
        .object({
        concatenated: z.string(),
        byAgent: z.record(z.string(), z.string())
    })
        .nullable(),
    runHistory: z.array(z.object({
        id: z.string(),
        trigger: z.enum(["manual", "route", "cron"]),
        startedAt: z.string(),
        completedAt: z.string().nullable(),
        status: z.enum(["running", "completed", "failed"]),
        input: z.string(),
        output: z
            .object({
            concatenated: z.string(),
            byAgent: z.record(z.string(), z.string())
        })
            .nullable(),
        error: z.string().nullable()
    })),
    createdAt: z.string(),
    updatedAt: z.string()
});
export const aiProcessorLinkSchema = z.object({
    id: z.string(),
    surfaceId: z.string(),
    sourceWidgetId: z.string(),
    targetProcessorId: z.string(),
    accessMode: aiProcessorAccessModeSchema,
    capabilityMode: aiProcessorCapabilityModeSchema,
    metadata: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
    updatedAt: z.string()
});
export const surfaceProcessorGraphPayloadSchema = z.object({
    surfaceId: z.string(),
    processors: z.array(aiProcessorSchema),
    links: z.array(aiProcessorLinkSchema)
});
export const forgeBoxCapabilityModeSchema = z.enum([
    "content",
    "tool",
    "action",
    "mcp"
]);
export const forgeBoxToolAdapterSchema = z.object({
    key: nonEmptyTrimmedString,
    label: nonEmptyTrimmedString,
    description: trimmedString.default(""),
    accessMode: aiProcessorAccessModeSchema.default("read"),
    argsSchema: z.record(z.string(), z.unknown()).optional()
});
const workbenchPortKindSchema = z
    .enum([...WORKBENCH_PORT_KINDS, ...LEGACY_WORKBENCH_PORT_KINDS])
    .transform((value) => normalizeWorkbenchPortKind({ kind: value }));
export const forgeBoxPortShapeFieldSchema = z.object({
    key: nonEmptyTrimmedString,
    label: nonEmptyTrimmedString,
    kind: workbenchPortKindSchema.default("record"),
    description: trimmedString.optional(),
    required: z.boolean().default(false)
});
export const forgeBoxPortDefinitionSchema = z.object({
    key: nonEmptyTrimmedString,
    label: nonEmptyTrimmedString,
    kind: workbenchPortKindSchema.default("record"),
    description: trimmedString.optional(),
    required: z.boolean().default(false),
    expandableKeys: z.array(nonEmptyTrimmedString).default([]),
    modelName: trimmedString.optional(),
    itemKind: trimmedString.optional(),
    shape: z.array(forgeBoxPortShapeFieldSchema).default([]),
    exampleValue: trimmedString.optional()
});
export const aiConnectorPublicInputBindingSchema = z.object({
    nodeId: nonEmptyTrimmedString,
    targetKey: nonEmptyTrimmedString,
    targetKind: z.enum(["input", "param"]).default("input")
});
export const aiConnectorPublicInputSchema = forgeBoxPortDefinitionSchema.extend({
    defaultValue: z.unknown().optional(),
    bindings: z.array(aiConnectorPublicInputBindingSchema).default([])
});
export const forgeBoxCatalogEntrySchema = z.object({
    id: nonEmptyTrimmedString,
    boxId: trimmedString.optional(),
    surfaceId: trimmedString.nullable(),
    routePath: trimmedString.nullable(),
    title: nonEmptyTrimmedString,
    label: trimmedString.optional(),
    icon: trimmedString.nullable().optional(),
    description: trimmedString.default(""),
    category: nonEmptyTrimmedString,
    tags: z.array(nonEmptyTrimmedString).default([]),
    capabilityModes: z.array(forgeBoxCapabilityModeSchema).default(["content"]).optional(),
    inputs: z.array(forgeBoxPortDefinitionSchema).default([]),
    params: z.array(forgeBoxPortDefinitionSchema).default([]),
    output: z.array(forgeBoxPortDefinitionSchema).default([]),
    tools: z.array(forgeBoxToolAdapterSchema).default([]),
    outputs: z.array(forgeBoxPortDefinitionSchema).default([]).optional(),
    toolAdapters: z.array(forgeBoxToolAdapterSchema).default([]).optional(),
    snapshotResolverKey: trimmedString.optional()
});
export const forgeBoxSnapshotSchema = z.object({
    boxId: nonEmptyTrimmedString,
    label: nonEmptyTrimmedString,
    capturedAt: z.string(),
    contentText: z.string(),
    contentJson: z.record(z.string(), z.unknown()).nullable(),
    tools: z.array(forgeBoxToolAdapterSchema).default([])
});
export const aiConnectorKindSchema = z.enum(["functor", "chat"]);
export const aiConnectorNodeTypeSchema = z.enum([
    "box",
    "box_input",
    "value",
    "user_input",
    "functor",
    "chat",
    "output",
    "merge",
    "template",
    "pick_key"
]);
export const aiConnectorNodeModelConfigSchema = z.object({
    connectionId: trimmedString.nullable().default(null),
    provider: aiModelProviderSchema.nullable().default(null),
    baseUrl: trimmedString.nullable().default(null),
    model: trimmedString.default(""),
    thinking: trimmedString.nullable().default(null),
    verbosity: trimmedString.nullable().default(null)
});
export const aiConnectorNodeSchema = z.object({
    id: nonEmptyTrimmedString,
    type: aiConnectorNodeTypeSchema,
    position: z.object({
        x: z.number(),
        y: z.number()
    }),
    data: z.object({
        label: nonEmptyTrimmedString,
        description: trimmedString.default(""),
        boxId: trimmedString.nullable().optional(),
        prompt: trimmedString.optional(),
        promptTemplate: trimmedString.optional(),
        systemPrompt: trimmedString.optional(),
        outputKey: trimmedString.optional(),
        enabledToolKeys: z.array(nonEmptyTrimmedString).default([]),
        inputs: z.array(forgeBoxPortDefinitionSchema).default([]).optional(),
        outputs: z.array(forgeBoxPortDefinitionSchema).default([]).optional(),
        params: z.array(forgeBoxPortDefinitionSchema).default([]).optional(),
        paramValues: z.record(z.string(), z.unknown()).default({}).optional(),
        template: trimmedString.optional(),
        selectedKey: trimmedString.optional(),
        valueType: z
            .enum(["string", "number", "boolean", "null", "array", "object"])
            .optional(),
        valueLiteral: trimmedString.optional(),
        modelConfig: aiConnectorNodeModelConfigSchema.optional()
    })
});
export const aiConnectorEdgeSchema = z.object({
    id: nonEmptyTrimmedString,
    source: nonEmptyTrimmedString,
    target: nonEmptyTrimmedString,
    sourceHandle: trimmedString.nullable().optional(),
    targetHandle: trimmedString.nullable().optional(),
    label: trimmedString.nullable().optional()
});
export const aiConnectorOutputSchema = z.object({
    id: nonEmptyTrimmedString,
    nodeId: nonEmptyTrimmedString,
    label: nonEmptyTrimmedString,
    apiPath: nonEmptyTrimmedString
});
export const aiConnectorRunResultSchema = z.object({
    primaryText: z.string(),
    outputs: z.record(z.string(), z.object({
        label: z.string(),
        text: z.string(),
        json: z.record(z.string(), z.unknown()).nullable()
    })),
    nodeResults: z
        .array(z.object({
        nodeId: nonEmptyTrimmedString,
        nodeType: aiConnectorNodeTypeSchema,
        label: nonEmptyTrimmedString,
        input: z.array(z.object({
            sourceNodeId: nonEmptyTrimmedString,
            sourceHandle: trimmedString.nullable(),
            targetHandle: trimmedString.nullable(),
            text: z.string(),
            json: z.record(z.string(), z.unknown()).nullable()
        })),
        primaryText: z.string(),
        payload: z.record(z.string(), z.unknown()).nullable(),
        outputMap: z.record(z.string(), z.object({
            text: z.string(),
            json: z.record(z.string(), z.unknown()).nullable()
        })),
        tools: z.array(z.string()).default([]),
        logs: z.array(z.string()).default([]),
        error: z.string().nullable(),
        timingMs: z.number().int().nonnegative().nullable().optional()
    }))
        .default([]),
    debugTrace: z
        .object({
        nodes: z.array(z.object({
            nodeId: nonEmptyTrimmedString,
            nodeType: aiConnectorNodeTypeSchema,
            label: nonEmptyTrimmedString,
            input: z.array(z.object({
                sourceNodeId: nonEmptyTrimmedString,
                sourceHandle: trimmedString.nullable(),
                targetHandle: trimmedString.nullable(),
                text: z.string(),
                json: z.record(z.string(), z.unknown()).nullable()
            })),
            output: z.object({
                text: z.string(),
                json: z.record(z.string(), z.unknown()).nullable()
            }),
            tools: z.array(z.string()).default([]),
            logs: z.array(z.string()).default([]),
            error: z.string().nullable()
        })),
        errors: z.array(z.string()).default([])
    })
        .optional()
});
export const aiConnectorRunSchema = z.object({
    id: nonEmptyTrimmedString,
    connectorId: nonEmptyTrimmedString,
    mode: z.enum(["run", "chat"]),
    status: z.enum(["running", "completed", "failed"]),
    userInput: z.string(),
    inputs: z.record(z.string(), z.unknown()).default({}),
    context: z.record(z.string(), z.unknown()).default({}),
    conversationId: trimmedString.nullable(),
    result: aiConnectorRunResultSchema.nullable(),
    error: z.string().nullable(),
    createdAt: z.string(),
    completedAt: z.string().nullable()
});
export const aiConnectorConversationSchema = z.object({
    id: nonEmptyTrimmedString,
    connectorId: nonEmptyTrimmedString,
    provider: trimmedString.nullable(),
    externalConversationId: trimmedString.nullable(),
    transcript: z.array(z.object({
        role: z.enum(["system", "developer", "user", "assistant", "tool"]),
        text: z.string(),
        createdAt: z.string()
    })),
    createdAt: z.string(),
    updatedAt: z.string()
});
export const aiConnectorSchema = z.object({
    id: nonEmptyTrimmedString,
    slug: nonEmptyTrimmedString,
    title: nonEmptyTrimmedString,
    description: trimmedString.default(""),
    kind: aiConnectorKindSchema,
    homeSurfaceId: trimmedString.nullable(),
    endpointEnabled: z.boolean().default(true),
    graph: z.object({
        nodes: z.array(aiConnectorNodeSchema).default([]),
        edges: z.array(aiConnectorEdgeSchema).default([])
    }),
    publicInputs: z.array(aiConnectorPublicInputSchema).default([]),
    publishedOutputs: z.array(aiConnectorOutputSchema).default([]),
    lastRun: aiConnectorRunSchema.nullable(),
    legacyProcessorId: trimmedString.nullable().default(null),
    createdAt: z.string(),
    updatedAt: z.string()
});
export const openAiCodexOauthSessionSchema = z.object({
    id: z.string(),
    status: z.enum([
        "starting",
        "awaiting_browser",
        "awaiting_manual_input",
        "authorized",
        "error",
        "consumed",
        "expired"
    ]),
    authUrl: z.string().nullable(),
    accountLabel: z.string().nullable(),
    error: z.string().nullable(),
    createdAt: z.string(),
    expiresAt: z.string(),
    credentialExpiresAt: z.string().nullable()
});
export const agentTokenSummarySchema = z.object({
    id: z.string(),
    label: z.string(),
    tokenPrefix: z.string(),
    scopes: z.array(z.string()),
    agentId: z.string().nullable(),
    agentLabel: z.string().nullable(),
    trustLevel: agentTrustLevelSchema,
    autonomyMode: autonomyModeSchema,
    approvalMode: approvalModeSchema,
    description: z.string(),
    bootstrapPolicy: agentBootstrapPolicySchema,
    scopePolicy: agentScopePolicySchema,
    lastUsedAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    status: z.enum(["active", "revoked"])
});
export const agentIdentitySchema = z.object({
    id: z.string(),
    label: z.string(),
    agentType: z.string(),
    identityKey: z.string().nullable().default(null),
    provider: agentRuntimeProviderSchema.nullable().default(null),
    machineKey: z.string().nullable().default(null),
    personaKey: z.string().nullable().default(null),
    linkedUsers: z.array(z.object({
        userId: z.string(),
        role: z.string(),
        user: userSummarySchema.nullable().default(null)
    })).default([]),
    trustLevel: agentTrustLevelSchema,
    autonomyMode: autonomyModeSchema,
    approvalMode: approvalModeSchema,
    description: z.string(),
    tokenCount: z.number().int().nonnegative(),
    activeTokenCount: z.number().int().nonnegative(),
    createdAt: z.string(),
    updatedAt: z.string()
});
export const agentRuntimeReconnectPlanSchema = z.object({
    summary: z.string(),
    commands: z.array(z.string()),
    notes: z.array(z.string()),
    automationSupported: z.boolean()
});
export const agentRuntimeSessionEventSchema = z.object({
    id: z.string(),
    sessionId: z.string(),
    eventType: z.string(),
    level: agentRuntimeEventLevelSchema,
    title: z.string(),
    summary: z.string(),
    metadata: z.record(z.string(), z.unknown()),
    createdAt: z.string()
});
export const agentRuntimeSessionSchema = z.object({
    id: z.string(),
    agentId: z.string().nullable(),
    agentLabel: z.string(),
    agentType: z.string(),
    provider: agentRuntimeProviderSchema,
    sessionKey: z.string(),
    sessionLabel: z.string(),
    actorLabel: z.string(),
    connectionMode: agentRuntimeConnectionModeSchema,
    status: agentRuntimeSessionStatusSchema,
    alive: z.boolean(),
    baseUrl: z.string().nullable(),
    webUrl: z.string().nullable(),
    dataRoot: z.string().nullable(),
    externalSessionId: z.string().nullable(),
    staleAfterSeconds: z.number().int().positive(),
    reconnectCount: z.number().int().nonnegative(),
    reconnectRequestedAt: z.string().nullable(),
    lastError: z.string().nullable(),
    lastSeenAt: z.string(),
    lastHeartbeatAt: z.string(),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    metadata: z.record(z.string(), z.unknown()),
    recentEvents: z.array(agentRuntimeSessionEventSchema),
    eventCount: z.number().int().nonnegative(),
    actionCount: z.number().int().nonnegative(),
    reconnectPlan: agentRuntimeReconnectPlanSchema
});
export const agentRuntimeSessionHistorySchema = z.object({
    session: agentRuntimeSessionSchema,
    events: z.array(agentRuntimeSessionEventSchema),
    actions: z.array(z.lazy(() => agentActionSchema))
});
const agentRuntimeSessionLocatorBaseSchema = z.object({
    sessionId: trimmedString.optional(),
    provider: agentRuntimeProviderSchema.optional(),
    sessionKey: trimmedString.optional(),
    externalSessionId: trimmedString.nullable().optional()
});
const agentRuntimeSessionLocatorSchema = agentRuntimeSessionLocatorBaseSchema
    .superRefine((value, context) => {
    const hasSessionId = Boolean(value.sessionId?.trim());
    const hasCompositeKey = Boolean(value.provider) && Boolean(value.sessionKey?.trim());
    if (!hasSessionId && !hasCompositeKey) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["sessionId"],
            message: "Provide either sessionId or the provider + sessionKey locator."
        });
    }
});
export const createAgentRuntimeSessionSchema = z.object({
    provider: agentRuntimeProviderSchema,
    agentLabel: nonEmptyTrimmedString,
    agentType: trimmedString.default("assistant"),
    agentIdentityKey: trimmedString.optional(),
    machineKey: trimmedString.optional(),
    personaKey: trimmedString.optional(),
    linkedUserIds: uniqueStringArraySchema.default([]),
    actorLabel: nonEmptyTrimmedString,
    sessionKey: nonEmptyTrimmedString,
    sessionLabel: trimmedString.default(""),
    connectionMode: agentRuntimeConnectionModeSchema.default("unknown"),
    baseUrl: trimmedString.nullable().default(null),
    webUrl: trimmedString.nullable().default(null),
    dataRoot: trimmedString.nullable().default(null),
    externalSessionId: trimmedString.nullable().default(null),
    staleAfterSeconds: z.coerce.number().int().positive().max(3600).default(120),
    metadata: z.record(z.string(), z.unknown()).default({}),
    status: z
        .union([
        z.literal("connected"),
        z.literal("reconnecting"),
        z.literal("error")
    ])
        .default("connected"),
    lastError: trimmedString.nullable().default(null)
});
export const heartbeatAgentRuntimeSessionSchema = agentRuntimeSessionLocatorBaseSchema.extend({
    status: z
        .union([
        z.literal("connected"),
        z.literal("reconnecting"),
        z.literal("error")
    ])
        .optional(),
    summary: trimmedString.default(""),
    metadata: z.record(z.string(), z.unknown()).default({}),
    lastError: trimmedString.nullable().default(null)
}).superRefine((value, context) => {
    const hasSessionId = Boolean(value.sessionId?.trim());
    const hasCompositeKey = Boolean(value.provider) && Boolean(value.sessionKey?.trim());
    if (!hasSessionId && !hasCompositeKey) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["sessionId"],
            message: "Provide either sessionId or the provider + sessionKey locator."
        });
    }
});
export const createAgentRuntimeSessionEventSchema = agentRuntimeSessionLocatorBaseSchema.extend({
    eventType: nonEmptyTrimmedString,
    level: agentRuntimeEventLevelSchema.default("info"),
    title: nonEmptyTrimmedString,
    summary: trimmedString.default(""),
    metadata: z.record(z.string(), z.unknown()).default({}),
    status: agentRuntimeSessionStatusSchema.optional()
}).superRefine((value, context) => {
    const hasSessionId = Boolean(value.sessionId?.trim());
    const hasCompositeKey = Boolean(value.provider) && Boolean(value.sessionKey?.trim());
    if (!hasSessionId && !hasCompositeKey) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["sessionId"],
            message: "Provide either sessionId or the provider + sessionKey locator."
        });
    }
});
export const reconnectAgentRuntimeSessionSchema = z.object({
    note: trimmedString.default("")
});
export const disconnectAgentRuntimeSessionSchema = z.object({
    note: trimmedString.default(""),
    externalSessionId: trimmedString.nullable().default(null),
    lastError: trimmedString.nullable().default(null)
});
export const eventLogEntrySchema = z.object({
    id: z.string(),
    eventKind: z.string(),
    entityType: z.string(),
    entityId: z.string(),
    actor: z.string().nullable(),
    source: activitySourceSchema,
    causedByEventId: z.string().nullable(),
    metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    createdAt: z.string()
});
export const diagnosticLogEntrySchema = z.object({
    id: z.string(),
    level: diagnosticLogLevelSchema,
    source: diagnosticLogSourceSchema,
    scope: z.string(),
    eventKey: z.string(),
    message: z.string(),
    route: z.string().nullable(),
    functionName: z.string().nullable(),
    requestId: z.string().nullable(),
    entityType: z.string().nullable(),
    entityId: z.string().nullable(),
    jobId: z.string().nullable(),
    details: z.record(z.string(), z.unknown()),
    createdAt: z.string()
});
export const insightEvidenceSchema = z.object({
    entityType: z.string(),
    entityId: z.string(),
    label: z.string()
});
export const insightSchema = z.object({
    id: z.string(),
    originType: insightOriginSchema,
    originAgentId: z.string().nullable(),
    originLabel: z.string().nullable(),
    visibility: insightVisibilitySchema,
    status: insightStatusSchema,
    entityType: z.string().nullable(),
    entityId: z.string().nullable(),
    timeframeLabel: z.string().nullable(),
    title: z.string(),
    summary: z.string(),
    recommendation: z.string(),
    rationale: z.string(),
    confidence: z.number().min(0).max(1),
    ctaLabel: z.string(),
    evidence: z.array(insightEvidenceSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
    ...ownershipShape
});
export const insightFeedbackSchema = z.object({
    id: z.string(),
    insightId: z.string(),
    actor: z.string().nullable(),
    feedbackType: insightFeedbackTypeSchema,
    note: z.string(),
    createdAt: z.string()
});
export const approvalRequestSchema = z.object({
    id: z.string(),
    actionType: z.string(),
    status: approvalRequestStatusSchema,
    title: z.string(),
    summary: z.string(),
    entityType: z.string().nullable(),
    entityId: z.string().nullable(),
    requestedByAgentId: z.string().nullable(),
    requestedByTokenId: z.string().nullable(),
    requestedPayload: z.record(z.string(), z.unknown()),
    approvedBy: z.string().nullable(),
    approvedAt: z.string().nullable(),
    rejectedBy: z.string().nullable(),
    rejectedAt: z.string().nullable(),
    resolutionNote: z.string(),
    createdAt: z.string(),
    updatedAt: z.string()
});
export const agentActionSchema = z.object({
    id: z.string(),
    agentId: z.string().nullable(),
    tokenId: z.string().nullable(),
    actionType: z.string(),
    riskLevel: actionRiskLevelSchema,
    status: agentActionStatusSchema,
    title: z.string(),
    summary: z.string(),
    payload: z.record(z.string(), z.unknown()),
    idempotencyKey: z.string().nullable(),
    approvalRequestId: z.string().nullable(),
    outcome: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
    updatedAt: z.string(),
    completedAt: z.string().nullable()
});
export const rewardRuleSchema = z.object({
    id: z.string(),
    family: rewardRuleFamilySchema,
    code: z.string(),
    title: z.string(),
    description: z.string(),
    active: z.boolean(),
    config: z.record(z.string(), rewardConfigValueSchema),
    createdAt: z.string(),
    updatedAt: z.string()
});
export const rewardLedgerEventSchema = z.object({
    id: z.string(),
    ruleId: z.string().nullable(),
    eventLogId: z.string().nullable(),
    entityType: z.string(),
    entityId: z.string(),
    actor: z.string().nullable(),
    source: activitySourceSchema,
    deltaXp: z.number().int(),
    reasonTitle: z.string(),
    reasonSummary: z.string(),
    reversibleGroup: z.string().nullable(),
    reversedByRewardId: z.string().nullable(),
    metadata: z.record(z.string(), rewardConfigValueSchema),
    createdAt: z.string()
});
export const sessionEventSchema = z.object({
    id: z.string(),
    sessionId: z.string(),
    eventType: z.string(),
    actor: z.string().nullable(),
    source: activitySourceSchema,
    metrics: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    createdAt: z.string()
});
export const xpMetricsPayloadSchema = z.object({
    profile: gamificationProfileSchema,
    achievements: z.array(achievementSignalSchema),
    milestoneRewards: z.array(milestoneRewardSchema),
    momentumPulse: xpMomentumPulseSchema,
    recentLedger: z.array(rewardLedgerEventSchema),
    rules: z.array(rewardRuleSchema),
    dailyAmbientXp: z.number().int().nonnegative(),
    dailyAmbientCap: z.number().int().positive()
});
export const operatorContextPayloadSchema = z.object({
    generatedAt: z.string(),
    activeProjects: z.array(projectSummarySchema),
    focusTasks: z.array(taskSchema),
    dueHabits: z.array(habitSchema),
    currentBoard: z.object({
        backlog: z.array(taskSchema),
        focus: z.array(taskSchema),
        inProgress: z.array(taskSchema),
        blocked: z.array(taskSchema),
        done: z.array(taskSchema)
    }),
    recentActivity: z.array(activityEventSchema),
    recentTaskRuns: z.array(taskRunSchema),
    recommendedNextTask: taskSchema.nullable(),
    xp: xpMetricsPayloadSchema
});
export const updateRewardRuleSchema = z.object({
    title: nonEmptyTrimmedString.optional(),
    description: trimmedString.optional(),
    active: z.boolean().optional(),
    config: z.record(z.string(), rewardConfigValueSchema).optional()
});
export const createManualRewardGrantSchema = z.object({
    entityType: rewardableEntityTypeSchema,
    entityId: nonEmptyTrimmedString,
    deltaXp: z
        .number()
        .int()
        .refine((value) => value !== 0, {
        message: "deltaXp must not be zero"
    }),
    reasonTitle: nonEmptyTrimmedString,
    reasonSummary: trimmedString.default(""),
    metadata: z.record(z.string(), rewardConfigValueSchema).default({})
});
export const createWorkAdjustmentSchema = z.object({
    entityType: workAdjustmentEntityTypeSchema,
    entityId: nonEmptyTrimmedString,
    deltaMinutes: z
        .number()
        .int()
        .refine((value) => value !== 0, {
        message: "deltaMinutes must not be zero"
    }),
    note: trimmedString.default("")
});
export const settingsPayloadSchema = z.object({
    profile: z.object({
        operatorName: z.string(),
        operatorEmail: z.string(),
        operatorTitle: z.string()
    }),
    notifications: notificationPreferencesSchema,
    execution: executionSettingsSchema,
    themePreference: themePreferenceSchema,
    customTheme: customThemeSchema.nullable(),
    localePreference: appLocaleSchema,
    security: z.object({
        integrityScore: z.number().int().min(0).max(100),
        lastAuditAt: z.string(),
        storageMode: z.literal("local-first"),
        activeSessions: z.number().int().positive(),
        tokenCount: z.number().int().nonnegative(),
        psycheAuthRequired: z.boolean()
    }),
    calendarProviders: z.object({
        google: googleCalendarAuthSettingsSchema,
        microsoft: microsoftCalendarAuthSettingsSchema
    }),
    modelSettings: modelSettingsPayloadSchema,
    agents: z.array(agentIdentitySchema),
    agentTokens: z.array(agentTokenSummarySchema)
});
export const deletedEntityRecordSchema = z.object({
    entityType: crudEntityTypeSchema,
    entityId: nonEmptyTrimmedString,
    title: nonEmptyTrimmedString,
    subtitle: trimmedString,
    deletedAt: z.string(),
    deletedByActor: z.string().nullable(),
    deletedSource: activitySourceSchema,
    deleteReason: trimmedString,
    snapshot: z.record(z.string(), z.unknown())
});
export const settingsBinPayloadSchema = z.object({
    generatedAt: z.string(),
    totalCount: z.number().int().nonnegative(),
    countsByEntityType: z.record(z.string(), z.number().int().nonnegative()),
    records: z.array(deletedEntityRecordSchema)
});
export const createNoteLinkSchema = z.object({
    entityType: crudEntityTypeSchema,
    entityId: nonEmptyTrimmedString,
    anchorKey: trimmedString.nullable().default(null)
});
const repeatedTrimmedStringQuerySchema = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}, z.array(trimmedString));
const repeatedUnknownQuerySchema = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}, z.array(z.unknown()));
const noteLinkedEntityFilterSchema = z.object({
    entityType: crudEntityTypeSchema,
    entityId: nonEmptyTrimmedString
});
function parseLinkedEntityQueryValue(raw) {
    const separatorIndex = raw.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex >= raw.length - 1) {
        throw new Error("Expected linked entity filters in entityType:entityId format");
    }
    return {
        entityType: raw.slice(0, separatorIndex),
        entityId: raw.slice(separatorIndex + 1)
    };
}
export const createNoteSchema = z.object({
    kind: noteKindSchema.default("evidence"),
    title: trimmedString.optional(),
    slug: trimmedString.optional(),
    spaceId: trimmedString.optional(),
    parentSlug: trimmedString.nullable().optional(),
    indexOrder: z.number().int().default(0),
    showInIndex: z.boolean().optional(),
    aliases: uniqueStringArraySchema.default([]),
    summary: trimmedString.default(""),
    contentMarkdown: nonEmptyTrimmedString,
    author: trimmedString.nullable().default(null),
    links: z.array(createNoteLinkSchema).default([]),
    tags: uniqueNoteTagArraySchema.default([]),
    destroyAt: dateTimeSchema.nullable().default(null),
    sourcePath: trimmedString.default(""),
    frontmatter: z.record(z.string(), z.unknown()).default({}),
    revisionHash: trimmedString.default(""),
    lastSyncedAt: dateTimeSchema.nullable().optional(),
    userId: nonEmptyTrimmedString.nullable().optional()
});
export const nestedCreateNoteSchema = z.object({
    kind: noteKindSchema.default("evidence"),
    title: trimmedString.optional(),
    slug: trimmedString.optional(),
    spaceId: trimmedString.optional(),
    parentSlug: trimmedString.nullable().optional(),
    indexOrder: z.number().int().default(0),
    showInIndex: z.boolean().optional(),
    aliases: uniqueStringArraySchema.default([]),
    summary: trimmedString.default(""),
    contentMarkdown: nonEmptyTrimmedString,
    author: trimmedString.nullable().default(null),
    links: z.array(createNoteLinkSchema).default([]),
    tags: uniqueNoteTagArraySchema.default([]),
    destroyAt: dateTimeSchema.nullable().default(null),
    sourcePath: trimmedString.default(""),
    frontmatter: z.record(z.string(), z.unknown()).default({})
});
export const updateNoteSchema = z.object({
    kind: noteKindSchema.optional(),
    title: trimmedString.optional(),
    slug: trimmedString.optional(),
    spaceId: trimmedString.optional(),
    parentSlug: trimmedString.nullable().optional(),
    indexOrder: z.number().int().optional(),
    showInIndex: z.boolean().optional(),
    aliases: uniqueStringArraySchema.optional(),
    summary: trimmedString.optional(),
    contentMarkdown: nonEmptyTrimmedString.optional(),
    author: trimmedString.nullable().optional(),
    links: z.array(createNoteLinkSchema).optional(),
    tags: uniqueNoteTagArraySchema.optional(),
    destroyAt: dateTimeSchema.nullable().optional(),
    sourcePath: trimmedString.optional(),
    frontmatter: z.record(z.string(), z.unknown()).optional(),
    revisionHash: trimmedString.optional(),
    lastSyncedAt: dateTimeSchema.nullable().optional(),
    userId: nonEmptyTrimmedString.nullable().optional()
});
export const notesListQuerySchema = z
    .object({
    kind: noteKindSchema.optional(),
    spaceId: trimmedString.optional(),
    slug: trimmedString.optional(),
    linkedEntityType: crudEntityTypeSchema.optional(),
    linkedEntityId: nonEmptyTrimmedString.optional(),
    anchorKey: trimmedString.nullable().optional(),
    author: trimmedString.optional(),
    query: trimmedString.optional(),
    linkedTo: repeatedUnknownQuerySchema.transform((values, context) => values.map((value, index) => {
        try {
            if (typeof value === "string") {
                return noteLinkedEntityFilterSchema.parse(parseLinkedEntityQueryValue(value));
            }
            return noteLinkedEntityFilterSchema.parse(value);
        }
        catch (error) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["linkedTo", index],
                message: error instanceof Error ? error.message : "Invalid linkedTo filter"
            });
            return {
                entityType: "goal",
                entityId: "__invalid__"
            };
        }
    })),
    tags: repeatedTrimmedStringQuerySchema,
    textTerms: repeatedTrimmedStringQuerySchema,
    userIds: repeatedTrimmedStringQuerySchema,
    updatedFrom: dateOnlySchema.optional(),
    updatedTo: dateOnlySchema.optional(),
    limit: z.coerce.number().int().positive().max(200).optional()
})
    .superRefine((value, context) => {
    if (value.linkedEntityType !== undefined &&
        value.linkedEntityId === undefined) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["linkedEntityId"],
            message: "linkedEntityId is required when linkedEntityType is provided"
        });
    }
    if (value.updatedFrom &&
        value.updatedTo &&
        value.updatedTo < value.updatedFrom) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["updatedTo"],
            message: "updatedTo must be on or after updatedFrom"
        });
    }
});
export const taskListQuerySchema = z.object({
    status: taskStatusSchema.optional(),
    levels: z
        .preprocess((value) => {
        if (Array.isArray(value)) {
            return value;
        }
        if (typeof value === "string" && value.trim().length > 0) {
            return value.split(",").map((entry) => entry.trim());
        }
        return undefined;
    }, z.array(workItemLevelSchema).optional())
        .optional(),
    owner: nonEmptyTrimmedString.optional(),
    goalId: nonEmptyTrimmedString.optional(),
    projectId: nonEmptyTrimmedString.optional(),
    parentWorkItemId: nonEmptyTrimmedString.optional(),
    tagId: nonEmptyTrimmedString.optional(),
    due: taskDueFilterSchema.optional(),
    userIds: repeatedTrimmedStringQuerySchema.optional(),
    assigneeIds: repeatedTrimmedStringQuerySchema.optional(),
    limit: z.coerce.number().int().positive().max(100).optional()
});
export const taskRunListQuerySchema = z.object({
    taskId: nonEmptyTrimmedString.optional(),
    status: taskRunStatusSchema.optional(),
    active: z.coerce.boolean().optional(),
    userIds: repeatedTrimmedStringQuerySchema.optional(),
    limit: z.coerce.number().int().positive().max(100).optional()
});
export const activityListQuerySchema = z.object({
    entityType: activityEntityTypeSchema.optional(),
    entityId: nonEmptyTrimmedString.optional(),
    source: activitySourceSchema.optional(),
    from: flexibleCalendarQueryDateSchema.optional(),
    to: flexibleCalendarQueryDateSchema.optional(),
    includeCorrected: z.coerce.boolean().optional(),
    userIds: repeatedTrimmedStringQuerySchema.optional(),
    limit: z.coerce.number().int().positive().max(100).optional()
});
export const goalListQuerySchema = z.object({
    status: goalStatusSchema.optional(),
    horizon: goalHorizonSchema.optional(),
    tagId: nonEmptyTrimmedString.optional(),
    userIds: repeatedTrimmedStringQuerySchema.optional(),
    limit: z.coerce.number().int().positive().max(100).optional()
});
export const projectListQuerySchema = z.object({
    goalId: nonEmptyTrimmedString.optional(),
    status: projectStatusSchema.optional(),
    userIds: repeatedTrimmedStringQuerySchema.optional(),
    limit: z.coerce.number().int().positive().max(100).optional()
});
export const calendarOverviewQuerySchema = z.object({
    from: flexibleCalendarQueryDateSchema.optional(),
    to: flexibleCalendarQueryDateSchema.optional(),
    userIds: repeatedTrimmedStringQuerySchema.optional()
});
export const psycheObservationCalendarExportFormatSchema = z.enum([
    "json",
    "csv",
    "markdown",
    "ics"
]);
export const psycheObservationCalendarExportQuerySchema = z.object({
    from: flexibleCalendarQueryDateSchema.optional(),
    to: flexibleCalendarQueryDateSchema.optional(),
    userIds: repeatedTrimmedStringQuerySchema.optional(),
    tags: repeatedTrimmedStringQuerySchema.optional(),
    includeObservations: z.coerce.boolean().optional(),
    includeActivity: z.coerce.boolean().optional(),
    onlyHumanOwned: z.coerce.boolean().optional(),
    search: trimmedString.optional(),
    format: psycheObservationCalendarExportFormatSchema.default("markdown")
});
export const createCalendarConnectionSchema = z.discriminatedUnion("provider", [
    z.object({
        provider: z.literal("google"),
        label: nonEmptyTrimmedString,
        authSessionId: nonEmptyTrimmedString,
        selectedCalendarUrls: z.array(nonEmptyTrimmedString.url()).min(1),
        forgeCalendarUrl: nonEmptyTrimmedString.url().nullable().optional(),
        createForgeCalendar: z.boolean().optional().default(false)
    }),
    z.object({
        provider: z.literal("apple"),
        label: nonEmptyTrimmedString,
        username: nonEmptyTrimmedString,
        password: nonEmptyTrimmedString,
        selectedCalendarUrls: z.array(nonEmptyTrimmedString.url()).min(1),
        forgeCalendarUrl: nonEmptyTrimmedString.url().nullable().optional(),
        createForgeCalendar: z.boolean().optional().default(false)
    }),
    z.object({
        provider: z.literal("caldav"),
        label: nonEmptyTrimmedString,
        serverUrl: nonEmptyTrimmedString.url(),
        username: nonEmptyTrimmedString,
        password: nonEmptyTrimmedString,
        selectedCalendarUrls: z.array(nonEmptyTrimmedString.url()).min(1),
        forgeCalendarUrl: nonEmptyTrimmedString.url().nullable().optional(),
        createForgeCalendar: z.boolean().optional().default(false)
    }),
    z.object({
        provider: z.literal("microsoft"),
        label: nonEmptyTrimmedString,
        authSessionId: nonEmptyTrimmedString,
        selectedCalendarUrls: z.array(nonEmptyTrimmedString.url()).min(1)
    }),
    z.object({
        provider: z.literal("macos_local"),
        label: nonEmptyTrimmedString,
        sourceId: nonEmptyTrimmedString,
        selectedCalendarUrls: z.array(nonEmptyTrimmedString.url()).min(1),
        forgeCalendarUrl: nonEmptyTrimmedString.url().nullable().optional(),
        createForgeCalendar: z.boolean().optional().default(false),
        replaceConnectionIds: z.array(nonEmptyTrimmedString).optional().default([])
    })
]);
export const discoverCalendarConnectionSchema = z.discriminatedUnion("provider", [
    z.object({
        provider: z.literal("apple"),
        username: nonEmptyTrimmedString,
        password: nonEmptyTrimmedString
    }),
    z.object({
        provider: z.literal("caldav"),
        serverUrl: nonEmptyTrimmedString.url(),
        username: nonEmptyTrimmedString,
        password: nonEmptyTrimmedString
    })
]);
export const startMicrosoftCalendarOauthSchema = z.object({
    label: nonEmptyTrimmedString.optional()
});
export const startGoogleCalendarOauthSchema = z.object({
    label: nonEmptyTrimmedString.optional(),
    browserOrigin: trimmedString.optional()
});
export const testMicrosoftCalendarOauthConfigurationSchema = z.object({
    clientId: nonEmptyTrimmedString.regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, "Microsoft client IDs must use the standard app registration GUID format."),
    tenantId: trimmedString.default("common"),
    redirectUri: nonEmptyTrimmedString.url()
});
export const microsoftCalendarOauthSessionSchema = z.object({
    sessionId: nonEmptyTrimmedString,
    status: z.enum(["pending", "authorized", "error", "consumed", "expired"]),
    authUrl: z.string().url().nullable(),
    accountLabel: z.string().nullable(),
    error: z.string().nullable(),
    discovery: calendarDiscoveryPayloadSchema.nullable()
});
export const googleCalendarOauthSessionSchema = z.object({
    sessionId: nonEmptyTrimmedString,
    status: z.enum(["pending", "authorized", "error", "consumed", "expired"]),
    authUrl: z.string().url().nullable(),
    accountLabel: z.string().nullable(),
    error: z.string().nullable(),
    discovery: calendarDiscoveryPayloadSchema.nullable()
});
export const updateCalendarConnectionSchema = z.object({
    label: nonEmptyTrimmedString.optional(),
    selectedCalendarUrls: z.array(nonEmptyTrimmedString.url()).optional()
});
const workBlockTemplateMutationShape = {
    title: nonEmptyTrimmedString,
    kind: workBlockKindSchema.default("custom"),
    color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .default("#60a5fa"),
    timezone: nonEmptyTrimmedString.default("UTC"),
    weekDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    startMinute: integerMinuteSchema,
    endMinute: integerMinuteSchema,
    startsOn: dateOnlySchema.nullable().optional(),
    endsOn: dateOnlySchema.nullable().optional(),
    blockingState: z.enum(["allowed", "blocked"]).default("blocked"),
    userId: nonEmptyTrimmedString.nullable().optional()
};
export const createWorkBlockTemplateSchema = z
    .object({
    ...workBlockTemplateMutationShape,
    activityPresetKey: trimmedString.nullable().optional(),
    customSustainRateApPerHour: z.number().min(0).nullable().optional()
})
    .superRefine((value, context) => {
    if (value.endMinute <= value.startMinute) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["endMinute"],
            message: "endMinute must be greater than startMinute"
        });
    }
    if (value.startsOn && value.endsOn && value.endsOn < value.startsOn) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["endsOn"],
            message: "endsOn must be on or after startsOn"
        });
    }
});
export const updateWorkBlockTemplateSchema = z
    .object({
    title: nonEmptyTrimmedString.optional(),
    kind: workBlockKindSchema.optional(),
    color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
    timezone: nonEmptyTrimmedString.optional(),
    weekDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    startMinute: integerMinuteSchema.optional(),
    endMinute: integerMinuteSchema.optional(),
    startsOn: dateOnlySchema.nullable().optional(),
    endsOn: dateOnlySchema.nullable().optional(),
    blockingState: z.enum(["allowed", "blocked"]).optional(),
    activityPresetKey: trimmedString.nullable().optional(),
    customSustainRateApPerHour: z.number().min(0).nullable().optional(),
    userId: nonEmptyTrimmedString.nullable().optional()
})
    .superRefine((value, context) => {
    if (value.startMinute !== undefined &&
        value.endMinute !== undefined &&
        value.endMinute <= value.startMinute) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["endMinute"],
            message: "endMinute must be greater than startMinute"
        });
    }
    if (value.startsOn !== undefined &&
        value.endsOn !== undefined &&
        value.startsOn &&
        value.endsOn &&
        value.endsOn < value.startsOn) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["endsOn"],
            message: "endsOn must be on or after startsOn"
        });
    }
});
export const createTaskTimeboxSchema = z
    .object({
    taskId: nonEmptyTrimmedString,
    projectId: nonEmptyTrimmedString.nullable().optional(),
    title: nonEmptyTrimmedString,
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    source: calendarTimeboxSourceSchema.default("manual"),
    status: calendarTimeboxStatusSchema.default("planned"),
    overrideReason: trimmedString.nullable().default(null),
    activityPresetKey: trimmedString.nullable().optional(),
    customSustainRateApPerHour: z.number().min(0).nullable().optional(),
    userId: nonEmptyTrimmedString.nullable().optional()
})
    .superRefine((value, context) => {
    if (Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["endsAt"],
            message: "endsAt must be after startsAt"
        });
    }
});
export const updateTaskTimeboxSchema = z.object({
    title: nonEmptyTrimmedString.optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    status: calendarTimeboxStatusSchema.optional(),
    overrideReason: trimmedString.nullable().optional(),
    activityPresetKey: trimmedString.nullable().optional(),
    customSustainRateApPerHour: z.number().min(0).nullable().optional(),
    userId: nonEmptyTrimmedString.nullable().optional()
});
export const recommendTaskTimeboxesSchema = z.object({
    taskId: nonEmptyTrimmedString,
    from: flexibleCalendarQueryDateSchema.optional(),
    to: flexibleCalendarQueryDateSchema.optional(),
    limit: z.coerce.number().int().positive().max(12).optional()
});
export const updateCalendarEventSchema = z
    .object({
    title: nonEmptyTrimmedString.optional(),
    description: trimmedString.optional(),
    location: trimmedString.optional(),
    place: z
        .object({
        label: trimmedString.optional(),
        address: trimmedString.optional(),
        timezone: trimmedString.optional(),
        latitude: z.number().nullable().optional(),
        longitude: z.number().nullable().optional(),
        source: trimmedString.optional(),
        externalPlaceId: trimmedString.optional()
    })
        .optional(),
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional(),
    timezone: nonEmptyTrimmedString.optional(),
    isAllDay: z.boolean().optional(),
    availability: calendarAvailabilitySchema.optional(),
    eventType: trimmedString.optional(),
    categories: z.array(trimmedString).optional(),
    activityPresetKey: trimmedString.nullable().optional(),
    customSustainRateApPerHour: z.number().min(0).nullable().optional(),
    preferredCalendarId: nonEmptyTrimmedString.nullable().optional(),
    userId: nonEmptyTrimmedString.nullable().optional(),
    links: z
        .array(z.object({
        entityType: crudEntityTypeSchema,
        entityId: nonEmptyTrimmedString,
        relationshipType: nonEmptyTrimmedString.default("context")
    }))
        .optional()
})
    .superRefine((value, context) => {
    if (value.startAt !== undefined &&
        value.endAt !== undefined &&
        Date.parse(value.endAt) <= Date.parse(value.startAt)) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["endAt"],
            message: "endAt must be after startAt"
        });
    }
});
export const createCalendarEventSchema = z
    .object({
    title: nonEmptyTrimmedString,
    description: trimmedString.default(""),
    location: trimmedString.default(""),
    place: z
        .object({
        label: trimmedString.default(""),
        address: trimmedString.default(""),
        timezone: trimmedString.default(""),
        latitude: z.number().nullable().default(null),
        longitude: z.number().nullable().default(null),
        source: trimmedString.default(""),
        externalPlaceId: trimmedString.default("")
    })
        .default({
        label: "",
        address: "",
        timezone: "",
        latitude: null,
        longitude: null,
        source: "",
        externalPlaceId: ""
    }),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    timezone: nonEmptyTrimmedString.default("UTC"),
    isAllDay: z.boolean().default(false),
    availability: calendarAvailabilitySchema.default("busy"),
    eventType: trimmedString.default(""),
    categories: z.array(trimmedString).default([]),
    activityPresetKey: trimmedString.nullable().optional(),
    customSustainRateApPerHour: z.number().min(0).nullable().optional(),
    preferredCalendarId: nonEmptyTrimmedString.nullable().optional(),
    userId: nonEmptyTrimmedString.nullable().optional(),
    links: z
        .array(z.object({
        entityType: crudEntityTypeSchema,
        entityId: nonEmptyTrimmedString,
        relationshipType: nonEmptyTrimmedString.default("context")
    }))
        .default([])
})
    .superRefine((value, context) => {
    if (Date.parse(value.endAt) <= Date.parse(value.startAt)) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["endAt"],
            message: "endAt must be after startAt"
        });
    }
});
export const habitListQuerySchema = z.object({
    status: habitStatusSchema.optional(),
    polarity: habitPolaritySchema.optional(),
    dueToday: z.coerce.boolean().optional(),
    orderBy: habitOrderBySchema.optional(),
    userIds: repeatedTrimmedStringQuerySchema.optional(),
    limit: z.coerce.number().int().positive().max(100).optional()
});
export const createGoalSchema = z.object({
    title: nonEmptyTrimmedString,
    description: trimmedString.default(""),
    horizon: goalHorizonSchema.default("year"),
    status: goalStatusSchema.default("active"),
    targetPoints: z.number().int().min(25).max(10000).default(400),
    themeColor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .default("#c8a46b"),
    tagIds: uniqueStringArraySchema.default([]),
    notes: z.array(nestedCreateNoteSchema).default([]),
    userId: nonEmptyTrimmedString.nullable().optional()
});
export const updateGoalSchema = createGoalSchema.partial();
export const createTagSchema = z.object({
    name: nonEmptyTrimmedString,
    kind: tagKindSchema.default("category"),
    color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .default("#71717a"),
    description: trimmedString.default(""),
    userId: nonEmptyTrimmedString.nullable().optional()
});
export const updateTagSchema = createTagSchema.partial();
export const createProjectSchema = z.object({
    goalId: nonEmptyTrimmedString,
    title: nonEmptyTrimmedString,
    description: trimmedString.default(""),
    status: projectStatusSchema.default("active"),
    workflowStatus: projectWorkflowStatusSchema.default("backlog"),
    assigneeUserIds: uniqueStringArraySchema.default([]),
    targetPoints: z.number().int().min(25).max(10000).default(240),
    themeColor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .default("#c0c1ff"),
    productRequirementsDocument: trimmedString.default(""),
    schedulingRules: calendarSchedulingRulesSchema.default({
        allowWorkBlockKinds: [],
        blockWorkBlockKinds: [],
        allowCalendarIds: [],
        blockCalendarIds: [],
        allowEventTypes: [],
        blockEventTypes: [],
        allowEventKeywords: [],
        blockEventKeywords: [],
        allowAvailability: [],
        blockAvailability: []
    }),
    notes: z.array(nestedCreateNoteSchema).default([]),
    userId: nonEmptyTrimmedString.nullable().optional()
});
export const updateProjectSchema = createProjectSchema.partial();
export const taskMutationShape = {
    title: nonEmptyTrimmedString,
    description: trimmedString.default(""),
    level: workItemLevelSchema.default("task"),
    status: taskStatusSchema.default("backlog"),
    priority: taskPrioritySchema.default("medium"),
    owner: nonEmptyTrimmedString.default("Albert"),
    userId: nonEmptyTrimmedString.nullable().optional(),
    assigneeUserIds: uniqueStringArraySchema.default([]),
    goalId: nonEmptyTrimmedString.nullable().default(null),
    projectId: nonEmptyTrimmedString.nullable().default(null),
    parentWorkItemId: nonEmptyTrimmedString.nullable().default(null),
    dueDate: dateOnlySchema.nullable().default(null),
    effort: taskEffortSchema.default("deep"),
    energy: taskEnergySchema.default("steady"),
    points: z.number().int().min(5).max(500).default(40),
    plannedDurationSeconds: z
        .number()
        .int()
        .min(60)
        .max(7 * 86_400)
        .nullable()
        .default(86_400),
    schedulingRules: calendarSchedulingRulesSchema.nullable().default(null),
    sortOrder: z.number().int().nonnegative().optional(),
    aiInstructions: trimmedString.default(""),
    executionMode: workItemExecutionModeSchema.nullable().default(null),
    acceptanceCriteria: z.array(trimmedString).default([]),
    blockerLinks: z.array(blockerLinkSchema).default([]),
    completionReport: completionReportSchema.nullable().default(null),
    gitRefs: z
        .array(workItemGitRefSchema.omit({
        id: true,
        workItemId: true,
        createdAt: true,
        updatedAt: true
    }))
        .default([]),
    tagIds: uniqueStringArraySchema.default([]),
    actionCostBand: actionCostBandSchema.default("standard"),
    notes: z.array(nestedCreateNoteSchema).default([])
};
export const createTaskSchema = z.object(taskMutationShape);
const habitCheckInWriteSchema = z.object({
    dateKey: dateOnlySchema.default(() => formatLocalDateKey()),
    status: habitCheckInStatusSchema,
    note: trimmedString.default(""),
    description: trimmedString.optional()
});
const habitMutationShape = {
    title: nonEmptyTrimmedString,
    description: trimmedString.default(""),
    status: habitStatusSchema.default("active"),
    polarity: habitPolaritySchema.default("positive"),
    frequency: habitFrequencySchema.default("daily"),
    targetCount: z.number().int().min(1).max(14).default(1),
    weekDays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    linkedGoalIds: uniqueStringArraySchema.default([]),
    linkedProjectIds: uniqueStringArraySchema.default([]),
    linkedTaskIds: uniqueStringArraySchema.default([]),
    linkedValueIds: uniqueStringArraySchema.default([]),
    linkedPatternIds: uniqueStringArraySchema.default([]),
    linkedBehaviorIds: uniqueStringArraySchema.default([]),
    linkedBeliefIds: uniqueStringArraySchema.default([]),
    linkedModeIds: uniqueStringArraySchema.default([]),
    linkedReportIds: uniqueStringArraySchema.default([]),
    linkedBehaviorId: nonEmptyTrimmedString.nullable().default(null),
    rewardXp: z.number().int().min(1).max(100).default(12),
    penaltyXp: z.number().int().min(1).max(100).default(8),
    generatedHealthEventTemplate: z
        .object({
        enabled: z.boolean().default(false),
        workoutType: trimmedString.default("workout"),
        title: trimmedString.default(""),
        durationMinutes: z
            .number()
            .int()
            .positive()
            .max(24 * 60)
            .default(45),
        xpReward: z.number().int().min(0).max(500).default(0),
        tags: uniqueStringArraySchema.default([]),
        links: z
            .array(z.object({
            entityType: trimmedString,
            entityId: nonEmptyTrimmedString,
            relationshipType: trimmedString.default("context")
        }))
            .default([]),
        notesTemplate: trimmedString.default("")
    })
        .default({
        enabled: false,
        workoutType: "workout",
        title: "",
        durationMinutes: 45,
        xpReward: 0,
        tags: [],
        links: [],
        notesTemplate: ""
    }),
    userId: nonEmptyTrimmedString.nullable().optional()
};
export const createHabitSchema = z
    .object(habitMutationShape)
    .superRefine((value, context) => {
    if (value.frequency === "weekly" && value.weekDays.length === 0) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["weekDays"],
            message: "Select at least one weekday for weekly habits"
        });
    }
});
export const updateHabitSchema = z
    .object({
    title: nonEmptyTrimmedString.optional(),
    description: trimmedString.optional(),
    status: habitStatusSchema.optional(),
    polarity: habitPolaritySchema.optional(),
    frequency: habitFrequencySchema.optional(),
    targetCount: z.number().int().min(1).max(14).optional(),
    weekDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    linkedGoalIds: uniqueStringArraySchema.optional(),
    linkedProjectIds: uniqueStringArraySchema.optional(),
    linkedTaskIds: uniqueStringArraySchema.optional(),
    linkedValueIds: uniqueStringArraySchema.optional(),
    linkedPatternIds: uniqueStringArraySchema.optional(),
    linkedBehaviorIds: uniqueStringArraySchema.optional(),
    linkedBeliefIds: uniqueStringArraySchema.optional(),
    linkedModeIds: uniqueStringArraySchema.optional(),
    linkedReportIds: uniqueStringArraySchema.optional(),
    linkedBehaviorId: nonEmptyTrimmedString.nullable().optional(),
    rewardXp: z.number().int().min(1).max(100).optional(),
    penaltyXp: z.number().int().min(1).max(100).optional(),
    checkIn: habitCheckInWriteSchema.optional(),
    generatedHealthEventTemplate: z
        .object({
        enabled: z.boolean().optional(),
        workoutType: trimmedString.optional(),
        title: trimmedString.optional(),
        durationMinutes: z
            .number()
            .int()
            .positive()
            .max(24 * 60)
            .optional(),
        xpReward: z.number().int().min(0).max(500).optional(),
        tags: uniqueStringArraySchema.optional(),
        links: z
            .array(z.object({
            entityType: trimmedString,
            entityId: nonEmptyTrimmedString,
            relationshipType: trimmedString.default("context")
        }))
            .optional(),
        notesTemplate: trimmedString.optional()
    })
        .optional(),
    userId: nonEmptyTrimmedString.nullable().optional()
})
    .superRefine((value, context) => {
    if (value.frequency === "weekly" &&
        value.weekDays !== undefined &&
        value.weekDays.length === 0) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["weekDays"],
            message: "Select at least one weekday for weekly habits"
        });
    }
});
export const updateTaskSchema = z.object({
    title: nonEmptyTrimmedString.optional(),
    description: trimmedString.optional(),
    level: workItemLevelSchema.optional(),
    status: taskStatusSchema.optional(),
    completedAt: dateTimeSchema.optional(),
    priority: taskPrioritySchema.optional(),
    owner: nonEmptyTrimmedString.optional(),
    userId: nonEmptyTrimmedString.nullable().optional(),
    assigneeUserIds: uniqueStringArraySchema.optional(),
    goalId: nonEmptyTrimmedString.nullable().optional(),
    projectId: nonEmptyTrimmedString.nullable().optional(),
    parentWorkItemId: nonEmptyTrimmedString.nullable().optional(),
    dueDate: dateOnlySchema.nullable().optional(),
    effort: taskEffortSchema.optional(),
    energy: taskEnergySchema.optional(),
    points: z.number().int().min(5).max(500).optional(),
    plannedDurationSeconds: z
        .number()
        .int()
        .min(60)
        .max(7 * 86_400)
        .nullable()
        .optional(),
    schedulingRules: calendarSchedulingRulesSchema.nullable().optional(),
    resolutionKind: taskResolutionKindSchema.nullable().optional(),
    splitParentTaskId: z.string().nullable().optional(),
    aiInstructions: trimmedString.optional(),
    executionMode: workItemExecutionModeSchema.nullable().optional(),
    acceptanceCriteria: z.array(trimmedString).optional(),
    blockerLinks: z.array(blockerLinkSchema).optional(),
    completionReport: completionReportSchema.nullable().optional(),
    gitRefs: z
        .array(workItemGitRefSchema
        .omit({
        workItemId: true,
        createdAt: true,
        updatedAt: true
    })
        .partial({ id: true }))
        .optional(),
    enforceTodayWorkLog: z.boolean().optional(),
    completedTodayWorkSeconds: z
        .number()
        .int()
        .min(0)
        .max(7 * 86_400)
        .optional(),
    actionCostBand: actionCostBandSchema.optional(),
    sortOrder: z.number().int().nonnegative().optional(),
    tagIds: uniqueStringArraySchema.optional(),
    notes: z.array(nestedCreateNoteSchema).optional()
});
export const lifeForceProfilePatchSchema = z.object({
    baseDailyAp: z.number().int().min(50).max(500).optional(),
    readinessMultiplier: z.number().min(0.5).max(1.5).optional(),
    stats: z
        .record(lifeForceStatKeySchema, z.number().int().min(1).max(100))
        .optional()
});
export const lifeForceTemplateUpdateSchema = z.object({
    points: z.array(lifeForceCurvePointSchema).min(2)
});
export const fatigueSignalCreateSchema = z.object({
    signalType: z.enum(["tired", "okay_again"]),
    observedAt: dateTimeSchema.optional(),
    note: trimmedString.optional()
});
export const taskSplitCreateSchema = z.object({
    firstTitle: nonEmptyTrimmedString,
    secondTitle: nonEmptyTrimmedString,
    remainingRatio: z.number().min(0.1).max(0.9).default(0.5)
});
export const tagSuggestionRequestSchema = z.object({
    title: trimmedString.default(""),
    description: trimmedString.default(""),
    goalId: nonEmptyTrimmedString.nullable().default(null),
    selectedTagIds: uniqueStringArraySchema.default([])
});
export const taskRunClaimSchema = z
    .object({
    actor: nonEmptyTrimmedString,
    timerMode: taskTimerModeSchema.default("unlimited"),
    plannedDurationSeconds: z.coerce
        .number()
        .int()
        .min(60)
        .max(86_400)
        .nullable()
        .default(null),
    isCurrent: z.coerce.boolean().default(true),
    leaseTtlSeconds: z.coerce.number().int().min(1).max(14400).default(900),
    note: trimmedString.default(""),
    overrideReason: trimmedString.optional(),
    gitContext: taskRunSchema.shape.gitContext.optional()
})
    .superRefine((value, context) => {
    if (value.timerMode === "planned" &&
        value.plannedDurationSeconds === null) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["plannedDurationSeconds"],
            message: "plannedDurationSeconds is required when timerMode is planned"
        });
    }
    if (value.timerMode === "unlimited" &&
        value.plannedDurationSeconds !== null) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["plannedDurationSeconds"],
            message: "plannedDurationSeconds must be null when timerMode is unlimited"
        });
    }
});
export const taskRunHeartbeatSchema = z.object({
    actor: nonEmptyTrimmedString.optional(),
    leaseTtlSeconds: z.coerce.number().int().min(1).max(14400).default(900),
    note: trimmedString.optional(),
    overrideReason: trimmedString.optional(),
    gitContext: taskRunSchema.shape.gitContext.optional()
});
export const taskRunFinishSchema = z.object({
    actor: nonEmptyTrimmedString.optional(),
    note: trimmedString.default(""),
    closeoutNote: nestedCreateNoteSchema.optional()
});
export const taskRunFocusSchema = z.object({
    actor: nonEmptyTrimmedString.optional()
});
export const createHabitCheckInSchema = habitCheckInWriteSchema;
export const updateSettingsSchema = z.object({
    profile: z
        .object({
        operatorName: nonEmptyTrimmedString.optional(),
        operatorEmail: nonEmptyTrimmedString.optional(),
        operatorTitle: nonEmptyTrimmedString.optional()
    })
        .optional(),
    notifications: notificationPreferencesSchema.partial().optional(),
    execution: executionSettingsSchema.partial().optional(),
    themePreference: themePreferenceSchema.optional(),
    customTheme: customThemeSchema.nullable().optional(),
    localePreference: appLocaleSchema.optional(),
    security: z
        .object({
        psycheAuthRequired: z.boolean().optional()
    })
        .optional(),
    calendarProviders: z
        .object({
        google: z
            .object({
            clientId: trimmedString.optional(),
            clientSecret: trimmedString.optional()
        })
            .optional(),
        microsoft: z
            .object({
            clientId: trimmedString.optional(),
            tenantId: trimmedString.optional(),
            redirectUri: trimmedString.optional()
        })
            .optional()
    })
        .optional()
        .superRefine((value, context) => {
        if (!value) {
            return;
        }
        const google = value.google;
        if (!google) {
            return;
        }
        const hasClientIdField = google.clientId !== undefined;
        const hasClientSecretField = google.clientSecret !== undefined;
        const hasClientIdValue = (google.clientId?.length ?? 0) > 0;
        const hasClientSecretValue = (google.clientSecret?.length ?? 0) > 0;
        if (hasClientIdField !== hasClientSecretField) {
            const message = "When overriding Google OAuth credentials, provide both the client ID and client secret together, or clear both fields together.";
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["google", hasClientIdField ? "clientSecret" : "clientId"],
                message
            });
            return;
        }
        if (hasClientIdValue !== hasClientSecretValue) {
            const message = "When overriding Google OAuth credentials, provide both the client ID and client secret together, or clear both fields together.";
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["google", hasClientIdValue ? "clientSecret" : "clientId"],
                message
            });
        }
    }),
    modelSettings: z
        .object({
        forgeAgent: z
            .object({
            basicChat: z
                .object({
                connectionId: trimmedString.nullable().optional(),
                model: trimmedString.optional()
            })
                .optional(),
            wiki: z
                .object({
                connectionId: trimmedString.nullable().optional(),
                model: trimmedString.optional()
            })
                .optional()
        })
            .optional()
    })
        .optional()
});
export const upsertAiModelConnectionSchema = z
    .object({
    id: trimmedString.optional(),
    label: nonEmptyTrimmedString,
    provider: aiModelProviderSchema,
    authMode: aiModelAuthModeSchema.optional(),
    baseUrl: trimmedString.optional(),
    model: nonEmptyTrimmedString,
    apiKey: trimmedString.optional(),
    oauthSessionId: trimmedString.optional(),
    enabled: z.boolean().default(true)
})
    .superRefine((value, context) => {
    const authMode = value.authMode ??
        (value.provider === "openai-codex" ? "oauth" : "api_key");
    const isMockProvider = value.provider === "mock";
    if (value.provider === "openai-codex" && authMode !== "oauth") {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["authMode"],
            message: "OpenAI Codex connections must use OAuth."
        });
    }
    if (authMode === "api_key" &&
        !isMockProvider &&
        !value.id?.trim() &&
        !value.apiKey?.trim()) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["apiKey"],
            message: "API key is required for a new API-backed connection."
        });
    }
    if (authMode === "oauth" &&
        !value.id?.trim() &&
        !value.oauthSessionId?.trim()) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["oauthSessionId"],
            message: "OAuth session is required for a new OAuth-backed connection."
        });
    }
});
export const testAiModelConnectionSchema = z.object({
    connectionId: trimmedString.optional(),
    provider: aiModelProviderSchema.optional(),
    baseUrl: trimmedString.optional(),
    model: nonEmptyTrimmedString,
    apiKey: trimmedString.optional()
});
export const submitOpenAiCodexOauthManualCodeSchema = z.object({
    codeOrUrl: nonEmptyTrimmedString
});
export const createAiProcessorSchema = z.object({
    surfaceId: nonEmptyTrimmedString,
    title: nonEmptyTrimmedString,
    promptFlow: trimmedString.default(""),
    contextInput: trimmedString.default(""),
    toolConfig: z.array(aiProcessorToolSchema).default([]),
    agentIds: z.array(z.string().trim().min(1)).default([]),
    agentConfigs: z.array(aiProcessorAgentConfigSchema).default([]),
    triggerMode: aiProcessorTriggerModeSchema.default("manual"),
    cronExpression: trimmedString.default(""),
    machineAccess: aiProcessorMachineAccessSchema.default({
        read: false,
        write: false,
        exec: false
    }),
    endpointEnabled: z.boolean().default(true)
});
export const updateAiProcessorSchema = z.object({
    title: nonEmptyTrimmedString.optional(),
    promptFlow: trimmedString.optional(),
    contextInput: trimmedString.optional(),
    toolConfig: z.array(aiProcessorToolSchema).optional(),
    agentIds: z.array(z.string().trim().min(1)).optional(),
    agentConfigs: z.array(aiProcessorAgentConfigSchema).optional(),
    triggerMode: aiProcessorTriggerModeSchema.optional(),
    cronExpression: trimmedString.optional(),
    machineAccess: aiProcessorMachineAccessSchema.partial().optional(),
    endpointEnabled: z.boolean().optional()
});
export const createAiProcessorLinkSchema = z.object({
    surfaceId: nonEmptyTrimmedString,
    sourceWidgetId: nonEmptyTrimmedString,
    targetProcessorId: nonEmptyTrimmedString,
    accessMode: aiProcessorAccessModeSchema.default("read"),
    capabilityMode: aiProcessorCapabilityModeSchema.default("content"),
    metadata: z.record(z.string(), z.unknown()).default({})
});
export const runAiProcessorSchema = z.object({
    input: trimmedString.default(""),
    context: z.record(z.string(), z.unknown()).default({}),
    widgetSnapshots: z.record(z.string(), z.unknown()).default({})
});
export const createAiConnectorSchema = z.object({
    title: nonEmptyTrimmedString,
    description: trimmedString.default(""),
    kind: aiConnectorKindSchema.default("functor"),
    homeSurfaceId: trimmedString.nullable().default(null),
    endpointEnabled: z.boolean().default(true),
    publicInputs: z.array(aiConnectorPublicInputSchema).default([]),
    graph: z
        .object({
        nodes: z.array(aiConnectorNodeSchema).default([]),
        edges: z.array(aiConnectorEdgeSchema).default([])
    })
        .default({ nodes: [], edges: [] })
});
export const updateAiConnectorSchema = z.object({
    title: nonEmptyTrimmedString.optional(),
    description: trimmedString.optional(),
    kind: aiConnectorKindSchema.optional(),
    homeSurfaceId: trimmedString.nullable().optional(),
    endpointEnabled: z.boolean().optional(),
    publicInputs: z.array(aiConnectorPublicInputSchema).optional(),
    graph: z
        .object({
        nodes: z.array(aiConnectorNodeSchema).default([]),
        edges: z.array(aiConnectorEdgeSchema).default([])
    })
        .optional()
});
export const runAiConnectorSchema = z.object({
    userInput: trimmedString.default(""),
    inputs: z.record(z.string(), z.unknown()).default({}),
    context: z.record(z.string(), z.unknown()).default({}),
    boxSnapshots: z.record(z.string(), z.unknown()).default({}),
    conversationId: trimmedString.nullable().default(null),
    debug: z.boolean().default(false)
});
export const createAgentTokenSchema = z.object({
    label: nonEmptyTrimmedString,
    agentLabel: nonEmptyTrimmedString.default("Forge Agent"),
    agentType: nonEmptyTrimmedString.default("assistant"),
    description: trimmedString.default(""),
    trustLevel: agentTrustLevelSchema.default("standard"),
    autonomyMode: autonomyModeSchema.default("approval_required"),
    approvalMode: approvalModeSchema.default("approval_by_default"),
    scopes: uniqueStringArraySchema.default(["read", "write", "insights"]),
    bootstrapPolicy: agentBootstrapPolicySchema.default(defaultAgentBootstrapPolicy),
    scopePolicy: agentScopePolicySchema.default(defaultAgentScopePolicy)
});
export const activityArchiveQuerySchema = activityListQuerySchema.extend({
    groupBy: z.enum(["day", "entity"]).optional(),
    includeCorrected: z.coerce.boolean().optional()
});
export const eventsListQuerySchema = z.object({
    entityType: nonEmptyTrimmedString.optional(),
    entityId: nonEmptyTrimmedString.optional(),
    eventKind: nonEmptyTrimmedString.optional(),
    limit: z.coerce.number().int().positive().max(200).optional()
});
export const diagnosticLogListQuerySchema = z.object({
    level: diagnosticLogLevelSchema.optional(),
    source: diagnosticLogSourceSchema.optional(),
    scope: nonEmptyTrimmedString.optional(),
    route: nonEmptyTrimmedString.optional(),
    entityType: nonEmptyTrimmedString.optional(),
    entityId: nonEmptyTrimmedString.optional(),
    jobId: nonEmptyTrimmedString.optional(),
    search: nonEmptyTrimmedString.optional(),
    beforeCreatedAt: nonEmptyTrimmedString.optional(),
    beforeId: nonEmptyTrimmedString.optional(),
    limit: z.coerce.number().int().positive().max(500).optional()
});
export const createDiagnosticLogSchema = z.object({
    level: diagnosticLogLevelSchema.default("info"),
    source: diagnosticLogSourceSchema.optional(),
    scope: nonEmptyTrimmedString,
    eventKey: trimmedString.default(""),
    message: nonEmptyTrimmedString,
    route: trimmedString.nullable().optional(),
    functionName: trimmedString.nullable().optional(),
    requestId: trimmedString.nullable().optional(),
    entityType: trimmedString.nullable().optional(),
    entityId: trimmedString.nullable().optional(),
    jobId: trimmedString.nullable().optional(),
    details: z.record(z.string(), z.unknown()).default({})
});
export const rewardsLedgerQuerySchema = z.object({
    entityType: nonEmptyTrimmedString.optional(),
    entityId: nonEmptyTrimmedString.optional(),
    limit: z.coerce.number().int().positive().max(200).optional()
});
export const createInsightSchema = z.object({
    originType: insightOriginSchema.default("user"),
    originAgentId: nonEmptyTrimmedString.nullable().default(null),
    originLabel: trimmedString.nullable().default(null),
    visibility: insightVisibilitySchema.default("visible"),
    status: insightStatusSchema.default("open"),
    entityType: trimmedString.nullable().default(null),
    entityId: trimmedString.nullable().default(null),
    timeframeLabel: trimmedString.nullable().default(null),
    title: nonEmptyTrimmedString,
    summary: nonEmptyTrimmedString,
    recommendation: nonEmptyTrimmedString,
    rationale: trimmedString.default(""),
    confidence: z.number().min(0).max(1).default(0.7),
    ctaLabel: nonEmptyTrimmedString.default("Review insight"),
    evidence: z.array(insightEvidenceSchema).default([])
});
export const updateInsightSchema = createInsightSchema.partial();
export const createInsightFeedbackSchema = z.object({
    feedbackType: insightFeedbackTypeSchema,
    note: trimmedString.default(""),
    actor: trimmedString.nullable().default(null)
});
export const createAgentActionSchema = z.object({
    actionType: nonEmptyTrimmedString,
    riskLevel: actionRiskLevelSchema.default("medium"),
    title: nonEmptyTrimmedString,
    summary: trimmedString.default(""),
    payload: z.record(z.string(), z.unknown()).default({}),
    agentId: trimmedString.nullable().default(null),
    tokenId: trimmedString.nullable().default(null)
});
export const resolveApprovalRequestSchema = z.object({
    note: trimmedString.default(""),
    actor: trimmedString.nullable().default(null)
});
export const createSessionEventSchema = z.object({
    sessionId: nonEmptyTrimmedString,
    eventType: nonEmptyTrimmedString,
    metrics: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .default({})
});
export const removeActivityEventSchema = z.object({
    reason: trimmedString.default("Removed from the visible archive.")
});
export const entityDeleteQuerySchema = z.object({
    mode: deleteModeSchema.default("soft"),
    reason: trimmedString.default("")
});
const crudEntityLinkSchema = z.object({
    entityType: crudEntityTypeSchema,
    id: nonEmptyTrimmedString
});
const strategyGraphNodeEntityTypeSchema = z.enum(["project", "task"]);
function validateStrategyGraph(graph, context) {
    const nodeIds = new Set();
    for (const node of graph.nodes) {
        if (nodeIds.has(node.id)) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["nodes"],
                message: `Strategy graph node ${node.id} is duplicated`
            });
            return;
        }
        nodeIds.add(node.id);
    }
    const outgoing = new Map();
    const incomingCount = new Map();
    for (const nodeId of nodeIds) {
        outgoing.set(nodeId, []);
        incomingCount.set(nodeId, 0);
    }
    for (const edge of graph.edges) {
        if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["edges"],
                message: `Strategy graph edge ${edge.from} -> ${edge.to} references a missing node`
            });
            return;
        }
        if (edge.from === edge.to) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["edges"],
                message: "Strategy graph edges cannot point back to the same node"
            });
            return;
        }
        outgoing.get(edge.from).push(edge.to);
        incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) + 1);
    }
    const queue = Array.from(nodeIds).filter((nodeId) => (incomingCount.get(nodeId) ?? 0) === 0);
    if (queue.length === 0) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["edges"],
            message: "Strategy graph needs at least one starting node"
        });
        return;
    }
    let visited = 0;
    while (queue.length > 0) {
        const nodeId = queue.shift();
        visited += 1;
        for (const nextId of outgoing.get(nodeId) ?? []) {
            const nextIncoming = (incomingCount.get(nextId) ?? 0) - 1;
            incomingCount.set(nextId, nextIncoming);
            if (nextIncoming === 0) {
                queue.push(nextId);
            }
        }
    }
    if (visited !== nodeIds.size) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["edges"],
            message: "Strategy graph must stay directed and acyclic"
        });
        return;
    }
    const terminalCount = Array.from(nodeIds).filter((nodeId) => (outgoing.get(nodeId) ?? []).length === 0).length;
    if (terminalCount === 0) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["edges"],
            message: "Strategy graph needs at least one terminal end-state node"
        });
    }
}
export const strategyLinkedEntitySchema = z.object({
    entityType: crudEntityTypeSchema,
    entityId: nonEmptyTrimmedString
});
export const strategyGraphNodeSchema = z.object({
    id: nonEmptyTrimmedString,
    entityType: strategyGraphNodeEntityTypeSchema,
    entityId: nonEmptyTrimmedString,
    title: trimmedString.default(""),
    branchLabel: trimmedString.default(""),
    notes: trimmedString.default("")
});
export const strategyGraphEdgeSchema = z.object({
    from: nonEmptyTrimmedString,
    to: nonEmptyTrimmedString,
    label: trimmedString.default(""),
    condition: trimmedString.default("")
});
export const strategyGraphSchema = z
    .object({
    nodes: z.array(strategyGraphNodeSchema).min(1),
    edges: z.array(strategyGraphEdgeSchema).default([])
})
    .superRefine((graph, context) => validateStrategyGraph(graph, context));
export const strategyMetricSchema = z.object({
    alignmentScore: z.number().int().min(0).max(100),
    planCoverageScore: z.number().int().min(0).max(100),
    sequencingScore: z.number().int().min(0).max(100),
    scopeDisciplineScore: z.number().int().min(0).max(100),
    qualityScore: z.number().int().min(0).max(100),
    targetProgressScore: z.number().int().min(0).max(100),
    completedNodeCount: z.number().int().nonnegative(),
    startedNodeCount: z.number().int().nonnegative(),
    readyNodeCount: z.number().int().nonnegative(),
    totalNodeCount: z.number().int().positive(),
    completedTargetCount: z.number().int().nonnegative(),
    totalTargetCount: z.number().int().nonnegative(),
    offPlanEntityCount: z.number().int().nonnegative().default(0),
    offPlanActiveEntityCount: z.number().int().nonnegative().default(0),
    offPlanCompletedEntityCount: z.number().int().nonnegative().default(0),
    activeNodeIds: z.array(z.string()).default([]),
    nextNodeIds: z.array(z.string()).default([]),
    blockedNodeIds: z.array(z.string()).default([]),
    outOfOrderNodeIds: z.array(z.string()).default([])
});
export const strategySchema = z.object({
    id: z.string(),
    title: nonEmptyTrimmedString,
    overview: trimmedString,
    endStateDescription: trimmedString,
    status: strategyStatusSchema,
    targetGoalIds: uniqueStringArraySchema.default([]),
    targetProjectIds: uniqueStringArraySchema.default([]),
    linkedEntities: z.array(strategyLinkedEntitySchema).default([]),
    graph: strategyGraphSchema,
    metrics: strategyMetricSchema,
    isLocked: z.boolean().default(false),
    lockedAt: z.string().nullable().default(null),
    lockedByUserId: z.string().nullable().default(null),
    lockedByUser: userSummarySchema.nullable().default(null),
    createdAt: z.string(),
    updatedAt: z.string(),
    ...ownershipShape
});
export const strategyListQuerySchema = z.object({
    status: strategyStatusSchema.optional(),
    userIds: repeatedTrimmedStringQuerySchema.optional(),
    limit: z.coerce.number().int().positive().max(100).optional()
});
export const createUserSchema = z.object({
    kind: userKindSchema,
    handle: nonEmptyTrimmedString,
    displayName: nonEmptyTrimmedString,
    description: trimmedString.default(""),
    accentColor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .default("#c0c1ff")
});
export const updateUserSchema = createUserSchema.partial();
export const createStrategySchema = z.object({
    title: nonEmptyTrimmedString,
    overview: trimmedString.default(""),
    endStateDescription: trimmedString.default(""),
    status: strategyStatusSchema.default("active"),
    targetGoalIds: uniqueStringArraySchema.default([]),
    targetProjectIds: uniqueStringArraySchema.default([]),
    linkedEntities: z.array(strategyLinkedEntitySchema).default([]),
    graph: strategyGraphSchema,
    userId: nonEmptyTrimmedString.nullable().optional(),
    isLocked: z.boolean().default(false),
    lockedByUserId: nonEmptyTrimmedString.nullable().optional()
});
export const updateStrategySchema = z.object({
    title: nonEmptyTrimmedString.optional(),
    overview: trimmedString.optional(),
    endStateDescription: trimmedString.optional(),
    status: strategyStatusSchema.optional(),
    targetGoalIds: uniqueStringArraySchema.optional(),
    targetProjectIds: uniqueStringArraySchema.optional(),
    linkedEntities: z.array(strategyLinkedEntitySchema).optional(),
    graph: strategyGraphSchema.optional(),
    userId: nonEmptyTrimmedString.nullable().optional(),
    isLocked: z.boolean().optional(),
    lockedByUserId: nonEmptyTrimmedString.nullable().optional()
});
export const batchCreateEntitiesSchema = z.object({
    atomic: z.boolean().default(false),
    operations: z
        .array(z.object({
        entityType: crudEntityTypeSchema,
        clientRef: trimmedString.optional(),
        data: z.record(z.string(), z.unknown())
    }))
        .min(1)
});
export const batchUpdateEntitiesSchema = z.object({
    atomic: z.boolean().default(false),
    operations: z
        .array(z.object({
        entityType: crudEntityTypeSchema,
        id: nonEmptyTrimmedString,
        clientRef: trimmedString.optional(),
        patch: z.record(z.string(), z.unknown())
    }))
        .min(1)
});
export const batchDeleteEntitiesSchema = z.object({
    atomic: z.boolean().default(false),
    operations: z
        .array(z.object({
        entityType: crudEntityTypeSchema,
        id: nonEmptyTrimmedString,
        clientRef: trimmedString.optional(),
        mode: deleteModeSchema.default("soft"),
        reason: trimmedString.default("")
    }))
        .min(1)
});
export const batchRestoreEntitiesSchema = z.object({
    atomic: z.boolean().default(false),
    operations: z
        .array(z.object({
        entityType: crudEntityTypeSchema,
        id: nonEmptyTrimmedString,
        clientRef: trimmedString.optional()
    }))
        .min(1)
});
export const batchSearchEntitiesSchema = z.object({
    searches: z
        .array(z.object({
        entityTypes: z.array(crudEntityTypeSchema).optional(),
        query: trimmedString.optional(),
        ids: uniqueStringArraySchema.optional(),
        status: uniqueStringArraySchema.optional(),
        linkedTo: crudEntityLinkSchema.optional(),
        userIds: uniqueStringArraySchema.optional(),
        includeDeleted: z.boolean().default(false),
        limit: z.number().int().positive().max(200).default(25),
        clientRef: trimmedString.optional()
    }))
        .min(1)
});
export const uncompleteTaskSchema = z.object({
    status: taskStatusSchema.exclude(["done"]).default("focus")
});
export const operatorLogWorkSchema = z
    .object({
    taskId: nonEmptyTrimmedString.optional(),
    title: trimmedString.optional(),
    description: trimmedString.optional(),
    summary: trimmedString.default(""),
    goalId: nonEmptyTrimmedString.nullable().optional(),
    projectId: nonEmptyTrimmedString.nullable().optional(),
    owner: nonEmptyTrimmedString.optional(),
    userId: nonEmptyTrimmedString.nullable().optional(),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    dueDate: dateOnlySchema.nullable().optional(),
    effort: taskEffortSchema.optional(),
    energy: taskEnergySchema.optional(),
    points: z.number().int().min(5).max(500).optional(),
    tagIds: uniqueStringArraySchema.optional(),
    closeoutNote: nestedCreateNoteSchema.optional()
})
    .superRefine((value, context) => {
    if (!value.taskId && (!value.title || value.title.trim().length === 0)) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["title"],
            message: "Either taskId or title is required"
        });
    }
});
export const operatorLogWorkResultSchema = z.object({
    task: taskSchema,
    xp: xpMetricsPayloadSchema
});
