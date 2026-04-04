import { z } from "zod";

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
export const goalStatusSchema = z.enum(["active", "paused", "completed"]);
export const goalHorizonSchema = z.enum(["quarter", "year", "lifetime"]);
export const projectStatusSchema = z.enum(["active", "paused", "completed"]);
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
export const habitFrequencySchema = z.enum(["daily", "weekly"]);
export const habitPolaritySchema = z.enum(["positive", "negative"]);
export const habitStatusSchema = z.enum(["active", "paused", "archived"]);
export const habitCheckInStatusSchema = z.enum(["done", "missed"]);
export const calendarProviderSchema = z.enum([
  "google",
  "apple",
  "caldav",
  "microsoft"
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
  "derived"
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
  "task_timebox"
]);
export const activitySourceSchema = z.enum([
  "ui",
  "openclaw",
  "agent",
  "system"
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
  "trigger_report"
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
export const rewardRuleFamilySchema = z.enum([
  "completion",
  "consistency",
  "alignment",
  "recovery",
  "collaboration",
  "ambient"
]);
export const appLocaleSchema = z.enum(["en", "fr"]);

const trimmedString = z.string().trim();
const nonEmptyTrimmedString = trimmedString.min(1);
const rewardConfigValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null()
]);

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

function isValidDateTime(value: string): boolean {
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
  .transform((value) =>
    isValidDateOnly(value)
      ? `${value}T00:00:00.000Z`
      : new Date(value).toISOString()
  );

const uniqueStringArraySchema = z
  .array(nonEmptyTrimmedString)
  .superRefine((values, context) => {
    const seen = new Set<string>();
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

export const userDirectoryPayloadSchema = z.object({
  users: z.array(userSummarySchema),
  grants: z.array(userAccessGrantSchema),
  ownership: z.array(userOwnershipSummarySchema),
  posture: z.object({
    accessModel: z.enum(["permissive", "directional_graph"]),
    summary: z.string(),
    futureReady: z.boolean()
  })
});

const ownershipShape = {
  userId: z.string().nullable().default(null),
  user: userSummarySchema.nullable().default(null)
};

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
    const seen = new Set<string>();
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
  contentMarkdown: nonEmptyTrimmedString,
  contentPlain: trimmedString,
  author: z.string().nullable(),
  source: activitySourceSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  links: z.array(noteLinkSchema).min(1),
  tags: uniqueNoteTagArraySchema.default([]),
  destroyAt: dateTimeSchema.nullable().default(null),
  ...ownershipShape
});

export const noteSummarySchema = z.object({
  count: z.number().int().nonnegative(),
  latestNoteId: z.string().nullable(),
  latestCreatedAt: z.string().nullable()
});

export const notesSummaryByEntitySchema = z.record(
  z.string(),
  noteSummarySchema
);

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
  targetPoints: z.number().int().nonnegative(),
  themeColor: z.string(),
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
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  owner: nonEmptyTrimmedString,
  goalId: z.string().nullable(),
  projectId: z.string().nullable(),
  dueDate: dateOnlySchema.nullable(),
  effort: taskEffortSchema,
  energy: taskEnergySchema,
  points: z.number().int().nonnegative(),
  sortOrder: z.number().int().nonnegative(),
  plannedDurationSeconds: z
    .number()
    .int()
    .min(60)
    .max(86_400)
    .nullable()
    .default(null),
  schedulingRules: calendarSchedulingRulesSchema.nullable().default(null),
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
  updatedAt: z.string(),
  ...ownershipShape
});

export const calendarConnectionSchema = z.object({
  id: z.string(),
  provider: calendarProviderSchema,
  label: nonEmptyTrimmedString,
  accountLabel: trimmedString,
  status: calendarConnectionStatusSchema,
  config: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()])
  ),
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
  isForgeCandidate: z.boolean()
});

export const calendarDiscoveryPayloadSchema = z.object({
  provider: calendarProviderSchema,
  accountLabel: trimmedString,
  serverUrl: nonEmptyTrimmedString.url(),
  principalUrl: z.string().nullable(),
  homeUrl: z.string().nullable(),
  calendars: z.array(calendarDiscoveryCalendarSchema)
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
  createdAt: z.string(),
  updatedAt: z.string(),
  ...ownershipShape
});

export const calendarOverviewPayloadSchema = z.object({
  generatedAt: z.string(),
  providers: z.array(
    z.object({
      provider: calendarProviderSchema,
      label: z.string(),
      supportsDedicatedForgeCalendar: z.boolean(),
      connectionHelp: z.string()
    })
  ),
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
      durationMinutes: z.number().int().positive().max(24 * 60).default(45),
      xpReward: z.number().int().min(0).max(500).default(0),
      tags: uniqueStringArraySchema.default([]),
      links: z
        .array(
          z.object({
            entityType: trimmedString,
            entityId: nonEmptyTrimmedString,
            relationshipType: trimmedString.default("context")
          })
        )
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
  metadata: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()])
  ),
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

export const themePreferenceSchema = z.enum(["obsidian", "solar", "system"]);
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
  trustLevel: agentTrustLevelSchema,
  autonomyMode: autonomyModeSchema,
  approvalMode: approvalModeSchema,
  description: z.string(),
  tokenCount: z.number().int().nonnegative(),
  activeTokenCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const eventLogEntrySchema = z.object({
  id: z.string(),
  eventKind: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  actor: z.string().nullable(),
  source: activitySourceSchema,
  causedByEventId: z.string().nullable(),
  metadata: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()])
  ),
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
  metrics: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()])
  ),
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
    microsoft: microsoftCalendarAuthSettingsSchema
  }),
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

function parseLinkedEntityQueryValue(raw: string) {
  const separatorIndex = raw.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= raw.length - 1) {
    throw new Error(
      "Expected linked entity filters in entityType:entityId format"
    );
  }
  return {
    entityType: raw.slice(0, separatorIndex),
    entityId: raw.slice(separatorIndex + 1)
  };
}

export const createNoteSchema = z.object({
  contentMarkdown: nonEmptyTrimmedString,
  author: trimmedString.nullable().default(null),
  links: z.array(createNoteLinkSchema).min(1),
  tags: uniqueNoteTagArraySchema.default([]),
  destroyAt: dateTimeSchema.nullable().default(null),
  userId: nonEmptyTrimmedString.nullable().optional()
});

export const nestedCreateNoteSchema = z.object({
  contentMarkdown: nonEmptyTrimmedString,
  author: trimmedString.nullable().default(null),
  links: z.array(createNoteLinkSchema).default([]),
  tags: uniqueNoteTagArraySchema.default([]),
  destroyAt: dateTimeSchema.nullable().default(null)
});

export const updateNoteSchema = z.object({
  contentMarkdown: nonEmptyTrimmedString.optional(),
  author: trimmedString.nullable().optional(),
  links: z.array(createNoteLinkSchema).min(1).optional(),
  tags: uniqueNoteTagArraySchema.optional(),
  destroyAt: dateTimeSchema.nullable().optional(),
  userId: nonEmptyTrimmedString.nullable().optional()
});

export const notesListQuerySchema = z
  .object({
    linkedEntityType: crudEntityTypeSchema.optional(),
    linkedEntityId: nonEmptyTrimmedString.optional(),
    anchorKey: trimmedString.nullable().optional(),
    author: trimmedString.optional(),
    query: trimmedString.optional(),
    linkedTo: repeatedUnknownQuerySchema.transform((values, context) =>
      values.map((value, index) => {
        try {
          if (typeof value === "string") {
            return noteLinkedEntityFilterSchema.parse(
              parseLinkedEntityQueryValue(value)
            );
          }
          return noteLinkedEntityFilterSchema.parse(value);
        } catch (error) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["linkedTo", index],
            message:
              error instanceof Error ? error.message : "Invalid linkedTo filter"
          });
          return {
            entityType: "goal",
            entityId: "__invalid__"
          } as z.infer<typeof noteLinkedEntityFilterSchema>;
        }
      })
    ),
    tags: repeatedTrimmedStringQuerySchema,
    textTerms: repeatedTrimmedStringQuerySchema,
    userIds: repeatedTrimmedStringQuerySchema,
    updatedFrom: dateOnlySchema.optional(),
    updatedTo: dateOnlySchema.optional(),
    limit: z.coerce.number().int().positive().max(200).optional()
  })
  .superRefine((value, context) => {
    if (
      value.linkedEntityType !== undefined &&
      value.linkedEntityId === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["linkedEntityId"],
        message: "linkedEntityId is required when linkedEntityType is provided"
      });
    }
    if (
      value.updatedFrom &&
      value.updatedTo &&
      value.updatedTo < value.updatedFrom
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["updatedTo"],
        message: "updatedTo must be on or after updatedFrom"
      });
    }
  });

export const taskListQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  owner: nonEmptyTrimmedString.optional(),
  goalId: nonEmptyTrimmedString.optional(),
  projectId: nonEmptyTrimmedString.optional(),
  tagId: nonEmptyTrimmedString.optional(),
  due: taskDueFilterSchema.optional(),
  userIds: repeatedTrimmedStringQuerySchema.optional(),
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

export const createCalendarConnectionSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("google"),
    label: nonEmptyTrimmedString,
    username: nonEmptyTrimmedString,
    clientId: nonEmptyTrimmedString,
    clientSecret: nonEmptyTrimmedString,
    refreshToken: nonEmptyTrimmedString,
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
  })
]);

export const discoverCalendarConnectionSchema = z.discriminatedUnion(
  "provider",
  [
    z.object({
      provider: z.literal("google"),
      username: nonEmptyTrimmedString,
      clientId: nonEmptyTrimmedString,
      clientSecret: nonEmptyTrimmedString,
      refreshToken: nonEmptyTrimmedString
    }),
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
  ]
);

export const startMicrosoftCalendarOauthSchema = z.object({
  label: nonEmptyTrimmedString.optional()
});

export const testMicrosoftCalendarOauthConfigurationSchema = z.object({
  clientId: nonEmptyTrimmedString.regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    "Microsoft client IDs must use the standard app registration GUID format."
  ),
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
  .object(workBlockTemplateMutationShape)
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
    userId: nonEmptyTrimmedString.nullable().optional()
  })
  .superRefine((value, context) => {
    if (
      value.startMinute !== undefined &&
      value.endMinute !== undefined &&
      value.endMinute <= value.startMinute
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endMinute"],
        message: "endMinute must be greater than startMinute"
      });
    }
    if (
      value.startsOn !== undefined &&
      value.endsOn !== undefined &&
      value.startsOn &&
      value.endsOn &&
      value.endsOn < value.startsOn
    ) {
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
    preferredCalendarId: nonEmptyTrimmedString.nullable().optional(),
    userId: nonEmptyTrimmedString.nullable().optional(),
    links: z
      .array(
        z.object({
          entityType: crudEntityTypeSchema,
          entityId: nonEmptyTrimmedString,
          relationshipType: nonEmptyTrimmedString.default("context")
        })
      )
      .optional()
  })
  .superRefine((value, context) => {
    if (
      value.startAt !== undefined &&
      value.endAt !== undefined &&
      Date.parse(value.endAt) <= Date.parse(value.startAt)
    ) {
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
    preferredCalendarId: nonEmptyTrimmedString.nullable().optional(),
    userId: nonEmptyTrimmedString.nullable().optional(),
    links: z
      .array(
        z.object({
          entityType: crudEntityTypeSchema,
          entityId: nonEmptyTrimmedString,
          relationshipType: nonEmptyTrimmedString.default("context")
        })
      )
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
  targetPoints: z.number().int().min(25).max(10000).default(240),
  themeColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#c0c1ff"),
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
  status: taskStatusSchema.default("backlog"),
  priority: taskPrioritySchema.default("medium"),
  owner: nonEmptyTrimmedString.default("Albert"),
  userId: nonEmptyTrimmedString.nullable().optional(),
  goalId: nonEmptyTrimmedString.nullable().default(null),
  projectId: nonEmptyTrimmedString.nullable().default(null),
  dueDate: dateOnlySchema.nullable().default(null),
  effort: taskEffortSchema.default("deep"),
  energy: taskEnergySchema.default("steady"),
  points: z.number().int().min(5).max(500).default(40),
  plannedDurationSeconds: z
    .number()
    .int()
    .min(60)
    .max(86_400)
    .nullable()
    .default(null),
  schedulingRules: calendarSchedulingRulesSchema.nullable().default(null),
  sortOrder: z.number().int().nonnegative().optional(),
  tagIds: uniqueStringArraySchema.default([]),
  notes: z.array(nestedCreateNoteSchema).default([])
};

export const createTaskSchema = z.object(taskMutationShape);
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
      durationMinutes: z.number().int().positive().max(24 * 60).default(45),
      xpReward: z.number().int().min(0).max(500).default(0),
      tags: uniqueStringArraySchema.default([]),
      links: z
        .array(
          z.object({
            entityType: trimmedString,
            entityId: nonEmptyTrimmedString,
            relationshipType: trimmedString.default("context")
          })
        )
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
    generatedHealthEventTemplate: z
      .object({
        enabled: z.boolean().optional(),
        workoutType: trimmedString.optional(),
        title: trimmedString.optional(),
        durationMinutes: z.number().int().positive().max(24 * 60).optional(),
        xpReward: z.number().int().min(0).max(500).optional(),
        tags: uniqueStringArraySchema.optional(),
        links: z
          .array(
            z.object({
              entityType: trimmedString,
              entityId: nonEmptyTrimmedString,
              relationshipType: trimmedString.default("context")
            })
          )
          .optional(),
        notesTemplate: trimmedString.optional()
      })
      .optional(),
    userId: nonEmptyTrimmedString.nullable().optional()
  })
  .superRefine((value, context) => {
    if (
      value.frequency === "weekly" &&
      value.weekDays !== undefined &&
      value.weekDays.length === 0
    ) {
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
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  owner: nonEmptyTrimmedString.optional(),
  userId: nonEmptyTrimmedString.nullable().optional(),
  goalId: nonEmptyTrimmedString.nullable().optional(),
  projectId: nonEmptyTrimmedString.nullable().optional(),
  dueDate: dateOnlySchema.nullable().optional(),
  effort: taskEffortSchema.optional(),
  energy: taskEnergySchema.optional(),
  points: z.number().int().min(5).max(500).optional(),
  plannedDurationSeconds: z
    .number()
    .int()
    .min(60)
    .max(86_400)
    .nullable()
    .optional(),
  schedulingRules: calendarSchedulingRulesSchema.nullable().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  tagIds: uniqueStringArraySchema.optional(),
  notes: z.array(nestedCreateNoteSchema).optional()
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
    overrideReason: trimmedString.optional()
  })
  .superRefine((value, context) => {
    if (
      value.timerMode === "planned" &&
      value.plannedDurationSeconds === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["plannedDurationSeconds"],
        message: "plannedDurationSeconds is required when timerMode is planned"
      });
    }
    if (
      value.timerMode === "unlimited" &&
      value.plannedDurationSeconds !== null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["plannedDurationSeconds"],
        message:
          "plannedDurationSeconds must be null when timerMode is unlimited"
      });
    }
  });

export const taskRunHeartbeatSchema = z.object({
  actor: nonEmptyTrimmedString.optional(),
  leaseTtlSeconds: z.coerce.number().int().min(1).max(14400).default(900),
  note: trimmedString.optional(),
  overrideReason: trimmedString.optional()
});

export const taskRunFinishSchema = z.object({
  actor: nonEmptyTrimmedString.optional(),
  note: trimmedString.default(""),
  closeoutNote: nestedCreateNoteSchema.optional()
});

export const taskRunFocusSchema = z.object({
  actor: nonEmptyTrimmedString.optional()
});

export const createHabitCheckInSchema = z.object({
  dateKey: dateOnlySchema.default(new Date().toISOString().slice(0, 10)),
  status: habitCheckInStatusSchema,
  note: trimmedString.default("")
});

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
  localePreference: appLocaleSchema.optional(),
  security: z
    .object({
      psycheAuthRequired: z.boolean().optional()
    })
    .optional(),
  calendarProviders: z
    .object({
      microsoft: z
        .object({
          clientId: trimmedString.optional(),
          tenantId: trimmedString.optional(),
          redirectUri: trimmedString.optional()
        })
        .optional()
    })
    .optional()
});

export const createAgentTokenSchema = z.object({
  label: nonEmptyTrimmedString,
  agentLabel: nonEmptyTrimmedString.default("Forge Agent"),
  agentType: nonEmptyTrimmedString.default("assistant"),
  description: trimmedString.default(""),
  trustLevel: agentTrustLevelSchema.default("standard"),
  autonomyMode: autonomyModeSchema.default("approval_required"),
  approvalMode: approvalModeSchema.default("approval_by_default"),
  scopes: uniqueStringArraySchema.default(["read", "write", "insights"])
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
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()])
    )
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

function validateStrategyGraph(
  graph: {
    nodes: Array<{ id: string }>;
    edges: Array<{ from: string; to: string }>;
  },
  context: z.RefinementCtx
) {
  const nodeIds = new Set<string>();
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

  const outgoing = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
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
    outgoing.get(edge.from)!.push(edge.to);
    incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) + 1);
  }

  const queue = Array.from(nodeIds).filter(
    (nodeId) => (incomingCount.get(nodeId) ?? 0) === 0
  );
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
    const nodeId = queue.shift()!;
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

  const terminalCount = Array.from(nodeIds).filter(
    (nodeId) => (outgoing.get(nodeId) ?? []).length === 0
  ).length;
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
  completedNodeCount: z.number().int().nonnegative(),
  totalNodeCount: z.number().int().positive(),
  completedTargetCount: z.number().int().nonnegative(),
  totalTargetCount: z.number().int().nonnegative(),
  offPlanEntityCount: z.number().int().nonnegative().default(0),
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
    .array(
      z.object({
        entityType: crudEntityTypeSchema,
        clientRef: trimmedString.optional(),
        data: z.record(z.string(), z.unknown())
      })
    )
    .min(1)
});

export const batchUpdateEntitiesSchema = z.object({
  atomic: z.boolean().default(false),
  operations: z
    .array(
      z.object({
        entityType: crudEntityTypeSchema,
        id: nonEmptyTrimmedString,
        clientRef: trimmedString.optional(),
        patch: z.record(z.string(), z.unknown())
      })
    )
    .min(1)
});

export const batchDeleteEntitiesSchema = z.object({
  atomic: z.boolean().default(false),
  operations: z
    .array(
      z.object({
        entityType: crudEntityTypeSchema,
        id: nonEmptyTrimmedString,
        clientRef: trimmedString.optional(),
        mode: deleteModeSchema.default("soft"),
        reason: trimmedString.default("")
      })
    )
    .min(1)
});

export const batchRestoreEntitiesSchema = z.object({
  atomic: z.boolean().default(false),
  operations: z
    .array(
      z.object({
        entityType: crudEntityTypeSchema,
        id: nonEmptyTrimmedString,
        clientRef: trimmedString.optional()
      })
    )
    .min(1)
});

export const batchSearchEntitiesSchema = z.object({
  searches: z
    .array(
      z.object({
        entityTypes: z.array(crudEntityTypeSchema).optional(),
        query: trimmedString.optional(),
        ids: uniqueStringArraySchema.optional(),
        status: uniqueStringArraySchema.optional(),
        linkedTo: crudEntityLinkSchema.optional(),
        userIds: uniqueStringArraySchema.optional(),
        includeDeleted: z.boolean().default(false),
        limit: z.number().int().positive().max(200).default(25),
        clientRef: trimmedString.optional()
      })
    )
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

export type CreateGoalInput = z.infer<typeof createGoalSchema>;
export type CreateHabitCheckInInput = z.infer<typeof createHabitCheckInSchema>;
export type CreateHabitInput = z.infer<typeof createHabitSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreateStrategyInput = z.infer<typeof createStrategySchema>;
export type CreateTagInput = z.infer<typeof createTagSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type CoachingInsight = z.infer<typeof coachingInsightSchema>;
export type DashboardGoal = z.infer<typeof dashboardGoalSchema>;
export type DashboardPayload = z.infer<typeof dashboardPayloadSchema>;
export type DashboardExecutionBucket = z.infer<
  typeof dashboardExecutionBucketSchema
>;
export type DashboardStats = z.infer<typeof dashboardStatsSchema>;
export type CalendarAvailability = z.infer<typeof calendarAvailabilitySchema>;
export type CalendarConnection = z.infer<typeof calendarConnectionSchema>;
export type CalendarConnectionStatus = z.infer<
  typeof calendarConnectionStatusSchema
>;
export type CalendarEvent = z.infer<typeof calendarEventSchema>;
export type CalendarEventLink = z.infer<typeof calendarEventLinkSchema>;
export type CalendarEventOrigin = z.infer<typeof calendarEventOriginSchema>;
export type CalendarEventSource = z.infer<typeof calendarEventSourceSchema>;
export type CalendarOverviewPayload = z.infer<
  typeof calendarOverviewPayloadSchema
>;
export type CalendarOwnership = z.infer<typeof calendarOwnershipSchema>;
export type CalendarProvider = z.infer<typeof calendarProviderSchema>;
export type CalendarSchedulingRules = z.infer<
  typeof calendarSchedulingRulesSchema
>;
export type CalendarTimeboxStatus = z.infer<typeof calendarTimeboxStatusSchema>;
export type CalendarTimeboxSource = z.infer<typeof calendarTimeboxSourceSchema>;
export type WorkBlockKind = z.infer<typeof workBlockKindSchema>;
export type WorkBlockInstance = z.infer<typeof workBlockInstanceSchema>;
export type WorkBlockTemplate = z.infer<typeof workBlockTemplateSchema>;
export type TaskTimebox = z.infer<typeof taskTimeboxSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type ProjectBoardPayload = z.infer<typeof projectBoardPayloadSchema>;
export type Note = z.infer<typeof noteSchema>;
export type NoteLink = z.infer<typeof noteLinkSchema>;
export type NoteSummary = z.infer<typeof noteSummarySchema>;
export type NotesSummaryByEntity = z.infer<typeof notesSummaryByEntitySchema>;
export type AchievementSignal = z.infer<typeof achievementSignalSchema>;
export type GamificationProfile = z.infer<typeof gamificationProfileSchema>;
export type GamificationOverview = z.infer<typeof gamificationOverviewSchema>;
export type XpMomentumPulse = z.infer<typeof xpMomentumPulseSchema>;
export type ContextDomainBalance = z.infer<typeof contextDomainBalanceSchema>;
export type ContextNeglectedGoal = z.infer<typeof contextNeglectedGoalSchema>;
export type MilestoneReward = z.infer<typeof milestoneRewardSchema>;
export type OverviewContext = z.infer<typeof overviewContextSchema>;
export type TaskContextPayload = z.infer<typeof taskContextPayloadSchema>;
export type InsightsHeatmapCell = z.infer<typeof insightsHeatmapCellSchema>;
export type InsightsPayload = z.infer<typeof insightsPayloadSchema>;
export type TodayContext = z.infer<typeof todayContextSchema>;
export type TodayQuest = z.infer<typeof todayQuestSchema>;
export type TodayTimelineBucket = z.infer<typeof todayTimelineBucketSchema>;
export type RiskContext = z.infer<typeof riskContextSchema>;
export type WeeklyReviewPayload = z.infer<typeof weeklyReviewPayloadSchema>;
export type WeeklyReviewClosure = z.infer<typeof weeklyReviewClosureSchema>;
export type FinalizeWeeklyReviewResult = z.infer<
  typeof finalizeWeeklyReviewResultSchema
>;
export type SettingsPayload = z.infer<typeof settingsPayloadSchema>;
export type MicrosoftCalendarAuthSettings = z.infer<
  typeof microsoftCalendarAuthSettingsSchema
>;
export type OperatorContextPayload = z.infer<
  typeof operatorContextPayloadSchema
>;
export type NotificationPreferences = z.infer<
  typeof notificationPreferencesSchema
>;
export type ThemePreference = z.infer<typeof themePreferenceSchema>;
export type ExecutionSettings = z.infer<typeof executionSettingsSchema>;
export type AppLocale = z.infer<typeof appLocaleSchema>;
export type AgentIdentity = z.infer<typeof agentIdentitySchema>;
export type AgentTokenSummary = z.infer<typeof agentTokenSummarySchema>;
export type AgentTokenMutationResult = {
  token: string;
  tokenSummary: AgentTokenSummary;
};
export type AgentTrustLevel = z.infer<typeof agentTrustLevelSchema>;
export type AutonomyMode = z.infer<typeof autonomyModeSchema>;
export type ApprovalMode = z.infer<typeof approvalModeSchema>;
export type EventLogEntry = z.infer<typeof eventLogEntrySchema>;
export type InsightEvidence = z.infer<typeof insightEvidenceSchema>;
export type Insight = z.infer<typeof insightSchema>;
export type InsightFeedback = z.infer<typeof insightFeedbackSchema>;
export type CrudEntityType = z.infer<typeof crudEntityTypeSchema>;
export type DeleteMode = z.infer<typeof deleteModeSchema>;
export type DeletedEntityRecord = z.infer<typeof deletedEntityRecordSchema>;
export type SettingsBinPayload = z.infer<typeof settingsBinPayloadSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;
export type AgentAction = z.infer<typeof agentActionSchema>;
export type RewardRule = z.infer<typeof rewardRuleSchema>;
export type RewardLedgerEvent = z.infer<typeof rewardLedgerEventSchema>;
export type SessionEvent = z.infer<typeof sessionEventSchema>;
export type XpMetricsPayload = z.infer<typeof xpMetricsPayloadSchema>;
export type ActivityEvent = z.infer<typeof activityEventSchema>;
export type ActivityEntityType = z.infer<typeof activityEntityTypeSchema>;
export type ActivitySource = z.infer<typeof activitySourceSchema>;
export type Goal = z.infer<typeof goalSchema>;
export type GoalListQuery = z.infer<typeof goalListQuerySchema>;
export type GoalStatus = z.infer<typeof goalStatusSchema>;
export type Habit = z.infer<typeof habitSchema>;
export type HabitCheckIn = z.infer<typeof habitCheckInSchema>;
export type HabitListQuery = z.infer<typeof habitListQuerySchema>;
export type Tag = z.infer<typeof tagSchema>;
export type TagKind = z.infer<typeof tagKindSchema>;
export type Task = z.infer<typeof taskSchema>;
export type TaskTimeSummary = z.infer<typeof taskTimeSummarySchema>;
export type TaskDueFilter = z.infer<typeof taskDueFilterSchema>;
export type ActivityListQuery = z.infer<typeof activityListQuerySchema>;
export type EventsListQuery = z.infer<typeof eventsListQuerySchema>;
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;
export type Strategy = z.infer<typeof strategySchema>;
export type StrategyGraph = z.infer<typeof strategyGraphSchema>;
export type StrategyListQuery = z.infer<typeof strategyListQuerySchema>;
export type StrategyStatus = z.infer<typeof strategyStatusSchema>;
export type CalendarOverviewQuery = z.infer<typeof calendarOverviewQuerySchema>;
export type RewardsLedgerQuery = z.infer<typeof rewardsLedgerQuerySchema>;
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;
export type TaskRun = z.infer<typeof taskRunSchema>;
export type TaskRunClaimInput = z.input<typeof taskRunClaimSchema>;
export type TaskRunFinishInput = z.infer<typeof taskRunFinishSchema>;
export type TaskRunFocusInput = z.input<typeof taskRunFocusSchema>;
export type TaskRunHeartbeatInput = z.infer<typeof taskRunHeartbeatSchema>;
export type TaskRunListQuery = z.infer<typeof taskRunListQuerySchema>;
export type TaskRunStatus = z.infer<typeof taskRunStatusSchema>;
export type TaskTimerMode = z.infer<typeof taskTimerModeSchema>;
export type TimeAccountingMode = z.infer<typeof timeAccountingModeSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;
export type UpdateHabitInput = z.infer<typeof updateHabitSchema>;
export type UpdateInsightInput = z.infer<typeof updateInsightSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type UpdateStrategyInput = z.infer<typeof updateStrategySchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UpdateCalendarConnectionInput = z.infer<
  typeof updateCalendarConnectionSchema
>;
export type UpdateWorkBlockTemplateInput = z.infer<
  typeof updateWorkBlockTemplateSchema
>;
export type UpdateTaskTimeboxInput = z.infer<typeof updateTaskTimeboxSchema>;
export type UpdateCalendarEventInput = z.infer<
  typeof updateCalendarEventSchema
>;
export type UpdateRewardRuleInput = z.infer<typeof updateRewardRuleSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type CreateAgentTokenInput = z.infer<typeof createAgentTokenSchema>;
export type CreateAgentActionInput = z.infer<typeof createAgentActionSchema>;
export type CreateInsightFeedbackInput = z.infer<
  typeof createInsightFeedbackSchema
>;
export type CreateInsightInput = z.infer<typeof createInsightSchema>;
export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type NestedCreateNoteInput = z.infer<typeof nestedCreateNoteSchema>;
export type CreateManualRewardGrantInput = z.infer<
  typeof createManualRewardGrantSchema
>;
export type CreateWorkAdjustmentInput = z.infer<
  typeof createWorkAdjustmentSchema
>;
export type CreateSessionEventInput = z.infer<typeof createSessionEventSchema>;
export type CreateCalendarEventInput = z.infer<
  typeof createCalendarEventSchema
>;
export type CreateCalendarConnectionInput = z.infer<
  typeof createCalendarConnectionSchema
>;
export type DiscoverCalendarConnectionInput = z.infer<
  typeof discoverCalendarConnectionSchema
>;
export type StartMicrosoftCalendarOauthInput = z.infer<
  typeof startMicrosoftCalendarOauthSchema
>;
export type TestMicrosoftCalendarOauthConfigurationInput = z.infer<
  typeof testMicrosoftCalendarOauthConfigurationSchema
>;
export type CreateWorkBlockTemplateInput = z.infer<
  typeof createWorkBlockTemplateSchema
>;
export type CreateTaskTimeboxInput = z.infer<typeof createTaskTimeboxSchema>;
export type RecommendTaskTimeboxesInput = z.infer<
  typeof recommendTaskTimeboxesSchema
>;
export type WorkAdjustment = z.infer<typeof workAdjustmentSchema>;
export type WorkAdjustmentEntityType = z.infer<
  typeof workAdjustmentEntityTypeSchema
>;
export type CalendarDiscoveryCalendar = z.infer<
  typeof calendarDiscoveryCalendarSchema
>;
export type CalendarDiscoveryPayload = z.infer<
  typeof calendarDiscoveryPayloadSchema
>;
export type MicrosoftCalendarOauthSession = z.infer<
  typeof microsoftCalendarOauthSessionSchema
>;
export type WorkAdjustmentResult = z.infer<typeof workAdjustmentResultSchema>;
export type OperatorLogWorkInput = z.infer<typeof operatorLogWorkSchema>;
export type OperatorLogWorkResult = z.infer<typeof operatorLogWorkResultSchema>;
export type RemoveActivityEventInput = z.infer<
  typeof removeActivityEventSchema
>;
export type ResolveApprovalRequestInput = z.infer<
  typeof resolveApprovalRequestSchema
>;
export type UncompleteTaskInput = z.infer<typeof uncompleteTaskSchema>;
export type EntityDeleteQuery = z.infer<typeof entityDeleteQuerySchema>;
export type BatchCreateEntitiesInput = z.infer<
  typeof batchCreateEntitiesSchema
>;
export type BatchUpdateEntitiesInput = z.infer<
  typeof batchUpdateEntitiesSchema
>;
export type BatchDeleteEntitiesInput = z.infer<
  typeof batchDeleteEntitiesSchema
>;
export type BatchRestoreEntitiesInput = z.infer<
  typeof batchRestoreEntitiesSchema
>;
export type BatchSearchEntitiesInput = z.infer<
  typeof batchSearchEntitiesSchema
>;
export type NotesListQuery = z.input<typeof notesListQuerySchema>;
export type UserAccessLevel = z.infer<typeof userAccessLevelSchema>;
export type UserAccessGrant = z.infer<typeof userAccessGrantSchema>;
export type UserAccessGrantConfig = z.infer<typeof userAccessGrantConfigSchema>;
export type UserAccessRights = z.infer<typeof userAccessRightsSchema>;
export type UserDirectoryPayload = z.infer<typeof userDirectoryPayloadSchema>;
export type UserKind = z.infer<typeof userKindSchema>;
export type UserOwnershipSummary = z.infer<typeof userOwnershipSummarySchema>;
export type UserSummary = z.infer<typeof userSummarySchema>;
export type UpdateUserAccessGrantInput = z.infer<
  typeof updateUserAccessGrantSchema
>;
