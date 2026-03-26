import { z } from "zod";

export const taskStatusSchema = z.enum(["backlog", "focus", "in_progress", "blocked", "done"]);
export const taskPrioritySchema = z.enum(["low", "medium", "high", "critical"]);
export const taskEffortSchema = z.enum(["light", "deep", "marathon"]);
export const taskEnergySchema = z.enum(["low", "steady", "high"]);
export const goalStatusSchema = z.enum(["active", "paused", "completed"]);
export const goalHorizonSchema = z.enum(["quarter", "year", "lifetime"]);
export const projectStatusSchema = z.enum(["active", "paused", "completed"]);
export const tagKindSchema = z.enum(["value", "category", "execution"]);
export const taskDueFilterSchema = z.enum(["overdue", "today", "week"]);
export const taskRunStatusSchema = z.enum(["active", "completed", "released", "timed_out"]);
export const taskTimerModeSchema = z.enum(["planned", "unlimited"]);
export const timeAccountingModeSchema = z.enum(["split", "parallel", "primary_only"]);
export const activityEntityTypeSchema = z.enum([
  "task",
  "goal",
  "project",
  "domain",
  "psyche_value",
  "behavior_pattern",
  "behavior",
  "belief_entry",
  "mode_profile",
  "trigger_report",
  "comment",
  "event_type",
  "emotion_definition",
  "tag",
  "task_run",
  "system",
  "insight",
  "approval_request",
  "agent_action",
  "reward",
  "session"
]);
export const activitySourceSchema = z.enum(["ui", "openclaw", "agent", "system"]);
export const agentTrustLevelSchema = z.enum(["standard", "trusted", "autonomous"]);
export const autonomyModeSchema = z.enum(["approval_required", "scoped_write", "autonomous"]);
export const approvalModeSchema = z.enum(["approval_by_default", "high_impact_only", "none"]);
export const insightOriginSchema = z.enum(["system", "user", "agent"]);
export const insightStatusSchema = z.enum(["open", "accepted", "dismissed", "snoozed", "applied", "expired"]);
export const insightVisibilitySchema = z.enum(["visible", "pending_review", "archived"]);
export const insightFeedbackTypeSchema = z.enum(["accepted", "dismissed", "applied", "snoozed"]);
export const approvalRequestStatusSchema = z.enum(["pending", "approved", "rejected", "cancelled", "executed"]);
export const actionRiskLevelSchema = z.enum(["low", "medium", "high"]);
export const agentActionStatusSchema = z.enum(["pending_approval", "approved", "rejected", "executed"]);
export const crudEntityTypeSchema = z.enum([
  "goal",
  "project",
  "task",
  "tag",
  "comment",
  "insight",
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
const rewardConfigValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

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

const dateOnlySchema = trimmedString.refine(isValidDateOnly, {
  message: "Expected a valid date in YYYY-MM-DD format"
});

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

export const tagSchema = z.object({
  id: z.string(),
  name: nonEmptyTrimmedString,
  kind: tagKindSchema,
  color: z.string(),
  description: z.string()
});

export const taskTimeSummarySchema = z.object({
  totalTrackedSeconds: z.number().int().nonnegative(),
  totalCreditedSeconds: z.number().nonnegative(),
  activeRunCount: z.number().int().nonnegative(),
  hasCurrentRun: z.boolean(),
  currentRunId: z.string().nullable()
});

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
  tagIds: uniqueStringArraySchema.default([])
});

export const projectSchema = z.object({
  id: z.string(),
  goalId: z.string(),
  title: nonEmptyTrimmedString,
  description: trimmedString,
  status: projectStatusSchema,
  targetPoints: z.number().int().nonnegative(),
  themeColor: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
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
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  tagIds: z.array(z.string()).default([]),
  time: taskTimeSummarySchema.default({
    totalTrackedSeconds: 0,
    totalCreditedSeconds: 0,
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
  updatedAt: z.string()
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
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  createdAt: z.string()
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

export const executionBucketToneSchema = z.enum(["urgent", "accent", "neutral", "success"]);

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

export const achievementTierSchema = z.enum(["bronze", "silver", "gold", "platinum"]);

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
  tags: z.array(tagSchema),
  suggestedTags: z.array(tagSchema),
  owners: z.array(z.string()),
  executionBuckets: z.array(dashboardExecutionBucketSchema),
  gamification: gamificationProfileSchema,
  achievements: z.array(achievementSignalSchema),
  milestoneRewards: z.array(milestoneRewardSchema),
  recentActivity: z.array(activityEventSchema)
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
  id: z.enum(["completed", "active", "upcoming", "deferred", "in_progress", "ready", "blocked", "done"]),
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
  dailyQuests: z.array(todayQuestSchema),
  milestoneRewards: z.array(milestoneRewardSchema),
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
  activity: z.array(activityEventSchema)
});

export const projectBoardPayloadSchema = z.object({
  project: projectSummarySchema,
  goal: goalSchema,
  tasks: z.array(taskSchema),
  activity: z.array(activityEventSchema)
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
  })
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
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
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
  updatedAt: z.string()
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
  entityType: nonEmptyTrimmedString,
  entityId: nonEmptyTrimmedString,
  deltaXp: z.number().int().refine((value) => value !== 0, {
    message: "deltaXp must not be zero"
  }),
  reasonTitle: nonEmptyTrimmedString,
  reasonSummary: trimmedString.default(""),
  metadata: z.record(z.string(), rewardConfigValueSchema).default({})
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

export const taskListQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  owner: nonEmptyTrimmedString.optional(),
  goalId: nonEmptyTrimmedString.optional(),
  projectId: nonEmptyTrimmedString.optional(),
  tagId: nonEmptyTrimmedString.optional(),
  due: taskDueFilterSchema.optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

export const taskRunListQuerySchema = z.object({
  taskId: nonEmptyTrimmedString.optional(),
  status: taskRunStatusSchema.optional(),
  active: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

export const activityListQuerySchema = z.object({
  entityType: activityEntityTypeSchema.optional(),
  entityId: nonEmptyTrimmedString.optional(),
  source: activitySourceSchema.optional(),
  includeCorrected: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

export const projectListQuerySchema = z.object({
  goalId: nonEmptyTrimmedString.optional(),
  status: projectStatusSchema.optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

export const createGoalSchema = z.object({
  title: nonEmptyTrimmedString,
  description: trimmedString.default(""),
  horizon: goalHorizonSchema.default("year"),
  status: goalStatusSchema.default("active"),
  targetPoints: z.number().int().min(25).max(10000).default(400),
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#c8a46b"),
  tagIds: uniqueStringArraySchema.default([])
});

export const updateGoalSchema = createGoalSchema.partial();

export const createTagSchema = z.object({
  name: nonEmptyTrimmedString,
  kind: tagKindSchema.default("category"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#71717a"),
  description: trimmedString.default("")
});

export const updateTagSchema = createTagSchema.partial();

export const createProjectSchema = z.object({
  goalId: nonEmptyTrimmedString,
  title: nonEmptyTrimmedString,
  description: trimmedString.default(""),
  status: projectStatusSchema.default("active"),
  targetPoints: z.number().int().min(25).max(10000).default(240),
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#c0c1ff")
});

export const updateProjectSchema = createProjectSchema.partial();

export const taskMutationShape = {
  title: nonEmptyTrimmedString,
  description: trimmedString.default(""),
  status: taskStatusSchema.default("backlog"),
  priority: taskPrioritySchema.default("medium"),
  owner: nonEmptyTrimmedString.default("Albert"),
  goalId: nonEmptyTrimmedString.nullable().default(null),
  projectId: nonEmptyTrimmedString.nullable().default(null),
  dueDate: dateOnlySchema.nullable().default(null),
  effort: taskEffortSchema.default("deep"),
  energy: taskEnergySchema.default("steady"),
  points: z.number().int().min(5).max(500).default(40),
  sortOrder: z.number().int().nonnegative().optional(),
  tagIds: uniqueStringArraySchema.default([])
};

export const createTaskSchema = z.object(taskMutationShape);
export const updateTaskSchema = z.object({
  title: nonEmptyTrimmedString.optional(),
  description: trimmedString.optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  owner: nonEmptyTrimmedString.optional(),
  goalId: nonEmptyTrimmedString.nullable().optional(),
  projectId: nonEmptyTrimmedString.nullable().optional(),
  dueDate: dateOnlySchema.nullable().optional(),
  effort: taskEffortSchema.optional(),
  energy: taskEnergySchema.optional(),
  points: z.number().int().min(5).max(500).optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  tagIds: uniqueStringArraySchema.optional()
});

export const tagSuggestionRequestSchema = z.object({
  title: trimmedString.default(""),
  description: trimmedString.default(""),
  goalId: nonEmptyTrimmedString.nullable().default(null),
  selectedTagIds: uniqueStringArraySchema.default([])
});

export const taskRunClaimSchema = z.object({
  actor: nonEmptyTrimmedString,
  timerMode: taskTimerModeSchema.default("unlimited"),
  plannedDurationSeconds: z.coerce.number().int().min(60).max(86_400).nullable().default(null),
  isCurrent: z.coerce.boolean().default(true),
  leaseTtlSeconds: z.coerce.number().int().min(1).max(14400).default(900),
  note: trimmedString.default("")
}).superRefine((value, context) => {
  if (value.timerMode === "planned" && value.plannedDurationSeconds === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["plannedDurationSeconds"],
      message: "plannedDurationSeconds is required when timerMode is planned"
    });
  }
  if (value.timerMode === "unlimited" && value.plannedDurationSeconds !== null) {
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
  note: trimmedString.optional()
});

export const taskRunFinishSchema = z.object({
  actor: nonEmptyTrimmedString.optional(),
  note: trimmedString.default("")
});

export const taskRunFocusSchema = z.object({
  actor: nonEmptyTrimmedString.optional()
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
  metrics: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({})
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

export const batchCreateEntitiesSchema = z.object({
  atomic: z.boolean().default(false),
  operations: z.array(
    z.object({
      entityType: crudEntityTypeSchema,
      clientRef: trimmedString.optional(),
      data: z.record(z.string(), z.unknown())
    })
  ).min(1)
});

export const batchUpdateEntitiesSchema = z.object({
  atomic: z.boolean().default(false),
  operations: z.array(
    z.object({
      entityType: crudEntityTypeSchema,
      id: nonEmptyTrimmedString,
      clientRef: trimmedString.optional(),
      patch: z.record(z.string(), z.unknown())
    })
  ).min(1)
});

export const batchDeleteEntitiesSchema = z.object({
  atomic: z.boolean().default(false),
  operations: z.array(
    z.object({
      entityType: crudEntityTypeSchema,
      id: nonEmptyTrimmedString,
      clientRef: trimmedString.optional(),
      mode: deleteModeSchema.default("soft"),
      reason: trimmedString.default("")
    })
  ).min(1)
});

export const batchRestoreEntitiesSchema = z.object({
  atomic: z.boolean().default(false),
  operations: z.array(
    z.object({
      entityType: crudEntityTypeSchema,
      id: nonEmptyTrimmedString,
      clientRef: trimmedString.optional()
    })
  ).min(1)
});

export const batchSearchEntitiesSchema = z.object({
  searches: z.array(
    z.object({
      entityTypes: z.array(crudEntityTypeSchema).optional(),
      query: trimmedString.optional(),
      ids: uniqueStringArraySchema.optional(),
      status: uniqueStringArraySchema.optional(),
      linkedTo: crudEntityLinkSchema.optional(),
      includeDeleted: z.boolean().default(false),
      limit: z.number().int().positive().max(200).default(25),
      clientRef: trimmedString.optional()
    })
  ).min(1)
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
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    dueDate: dateOnlySchema.nullable().optional(),
    effort: taskEffortSchema.optional(),
    energy: taskEnergySchema.optional(),
    points: z.number().int().min(5).max(500).optional(),
    tagIds: uniqueStringArraySchema.optional()
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
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreateTagInput = z.infer<typeof createTagSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type CoachingInsight = z.infer<typeof coachingInsightSchema>;
export type DashboardGoal = z.infer<typeof dashboardGoalSchema>;
export type DashboardPayload = z.infer<typeof dashboardPayloadSchema>;
export type DashboardExecutionBucket = z.infer<typeof dashboardExecutionBucketSchema>;
export type DashboardStats = z.infer<typeof dashboardStatsSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type ProjectBoardPayload = z.infer<typeof projectBoardPayloadSchema>;
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
export type SettingsPayload = z.infer<typeof settingsPayloadSchema>;
export type OperatorContextPayload = z.infer<typeof operatorContextPayloadSchema>;
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;
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
export type GoalStatus = z.infer<typeof goalStatusSchema>;
export type Tag = z.infer<typeof tagSchema>;
export type TagKind = z.infer<typeof tagKindSchema>;
export type Task = z.infer<typeof taskSchema>;
export type TaskTimeSummary = z.infer<typeof taskTimeSummarySchema>;
export type TaskDueFilter = z.infer<typeof taskDueFilterSchema>;
export type ActivityListQuery = z.infer<typeof activityListQuerySchema>;
export type EventsListQuery = z.infer<typeof eventsListQuerySchema>;
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;
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
export type UpdateInsightInput = z.infer<typeof updateInsightSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type UpdateRewardRuleInput = z.infer<typeof updateRewardRuleSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type CreateAgentTokenInput = z.infer<typeof createAgentTokenSchema>;
export type CreateAgentActionInput = z.infer<typeof createAgentActionSchema>;
export type CreateInsightFeedbackInput = z.infer<typeof createInsightFeedbackSchema>;
export type CreateInsightInput = z.infer<typeof createInsightSchema>;
export type CreateManualRewardGrantInput = z.infer<typeof createManualRewardGrantSchema>;
export type CreateSessionEventInput = z.infer<typeof createSessionEventSchema>;
export type OperatorLogWorkInput = z.infer<typeof operatorLogWorkSchema>;
export type OperatorLogWorkResult = z.infer<typeof operatorLogWorkResultSchema>;
export type RemoveActivityEventInput = z.infer<typeof removeActivityEventSchema>;
export type ResolveApprovalRequestInput = z.infer<typeof resolveApprovalRequestSchema>;
export type UncompleteTaskInput = z.infer<typeof uncompleteTaskSchema>;
export type EntityDeleteQuery = z.infer<typeof entityDeleteQuerySchema>;
export type BatchCreateEntitiesInput = z.infer<typeof batchCreateEntitiesSchema>;
export type BatchUpdateEntitiesInput = z.infer<typeof batchUpdateEntitiesSchema>;
export type BatchDeleteEntitiesInput = z.infer<typeof batchDeleteEntitiesSchema>;
export type BatchRestoreEntitiesInput = z.infer<typeof batchRestoreEntitiesSchema>;
export type BatchSearchEntitiesInput = z.infer<typeof batchSearchEntitiesSchema>;
