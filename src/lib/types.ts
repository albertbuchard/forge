export type TaskStatus = "backlog" | "focus" | "in_progress" | "blocked" | "done";
export type TaskPriority = "low" | "medium" | "high" | "critical";
export type TaskEffort = "light" | "deep" | "marathon";
export type TaskEnergy = "low" | "steady" | "high";
export type AppLocale = "en" | "fr";
export type TaskTimerMode = "planned" | "unlimited";
export type TimeAccountingMode = "split" | "parallel" | "primary_only";
export type HabitFrequency = "daily" | "weekly";
export type HabitPolarity = "positive" | "negative";
export type HabitStatus = "active" | "paused" | "archived";
export type HabitCheckInStatus = "done" | "missed";
export type CalendarProvider = "google" | "apple" | "caldav" | "microsoft";
export type CalendarConnectionStatus = "connected" | "needs_attention" | "error";
export type CalendarEventOrigin = "native" | "google" | "apple" | "caldav" | "microsoft" | "derived";
export type CalendarAvailability = "busy" | "free";
export type WorkBlockKind =
  | "main_activity"
  | "secondary_activity"
  | "third_activity"
  | "rest"
  | "holiday"
  | "custom";
export type CalendarTimeboxStatus = "planned" | "active" | "completed" | "cancelled";
export type CalendarTimeboxSource = "manual" | "suggested" | "live_run";
export type WorkAdjustmentEntityType = "task" | "project";
export type CrudEntityType =
  | "goal"
  | "project"
  | "task"
  | "habit"
  | "tag"
  | "note"
  | "insight"
  | "calendar_event"
  | "work_block_template"
  | "task_timebox"
  | "psyche_value"
  | "behavior_pattern"
  | "behavior"
  | "belief_entry"
  | "mode_profile"
  | "mode_guide_session"
  | "event_type"
  | "emotion_definition"
  | "trigger_report";
export type RewardableEntityType =
  | "system"
  | "goal"
  | "project"
  | "task"
  | "habit"
  | "tag"
  | "note"
  | "insight"
  | "psyche_value"
  | "behavior_pattern"
  | "behavior"
  | "belief_entry"
  | "mode_profile"
  | "trigger_report";
export type DeleteMode = "soft" | "hard";

export interface TaskTimeSummary {
  totalTrackedSeconds: number;
  totalCreditedSeconds: number;
  liveTrackedSeconds: number;
  liveCreditedSeconds: number;
  manualAdjustedSeconds: number;
  activeRunCount: number;
  hasCurrentRun: boolean;
  currentRunId: string | null;
}

export interface WorkAdjustment {
  id: string;
  entityType: WorkAdjustmentEntityType;
  entityId: string;
  requestedDeltaMinutes: number;
  appliedDeltaMinutes: number;
  note: string;
  actor: string | null;
  source: "ui" | "openclaw" | "agent" | "system";
  createdAt: string;
}

export interface WorkAdjustmentTargetSummary {
  entityType: WorkAdjustmentEntityType;
  entityId: string;
  title: string;
  time: TaskTimeSummary;
}

export interface WorkAdjustmentResult {
  adjustment: WorkAdjustment;
  target: WorkAdjustmentTargetSummary;
  reward: RewardLedgerEvent | null;
  metrics: XpMetricsPayload;
}

export interface NoteLink {
  entityType: CrudEntityType;
  entityId: string;
  anchorKey: string | null;
}

export interface Note {
  id: string;
  contentMarkdown: string;
  contentPlain: string;
  author: string | null;
  source: "ui" | "openclaw" | "agent" | "system";
  createdAt: string;
  updatedAt: string;
  links: NoteLink[];
}

export interface NoteSummary {
  count: number;
  latestNoteId: string | null;
  latestCreatedAt: string | null;
}

export type NotesSummaryByEntity = Record<string, NoteSummary>;

export interface Tag {
  id: string;
  name: string;
  kind: "value" | "category" | "execution";
  color: string;
  description: string;
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  horizon: "quarter" | "year" | "lifetime";
  status: "active" | "paused" | "completed";
  targetPoints: number;
  themeColor: string;
  createdAt: string;
  updatedAt: string;
  tagIds: string[];
}

export interface CalendarSchedulingRules {
  allowWorkBlockKinds: WorkBlockKind[];
  blockWorkBlockKinds: WorkBlockKind[];
  allowCalendarIds: string[];
  blockCalendarIds: string[];
  allowEventTypes: string[];
  blockEventTypes: string[];
  allowEventKeywords: string[];
  blockEventKeywords: string[];
  allowAvailability: CalendarAvailability[];
  blockAvailability: CalendarAvailability[];
}

export interface Project {
  id: string;
  goalId: string;
  title: string;
  description: string;
  status: "active" | "paused" | "completed";
  targetPoints: number;
  themeColor: string;
  schedulingRules: CalendarSchedulingRules;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  owner: string;
  goalId: string | null;
  projectId: string | null;
  dueDate: string | null;
  effort: TaskEffort;
  energy: TaskEnergy;
  points: number;
  plannedDurationSeconds: number | null;
  schedulingRules: CalendarSchedulingRules | null;
  sortOrder: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tagIds: string[];
  time: TaskTimeSummary;
}

export interface ActivityEvent {
  id: string;
  entityType: string;
  entityId: string;
  eventType: string;
  title: string;
  description: string;
  actor: string | null;
  source: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export interface EventLogEntry {
  id: string;
  eventKind: string;
  entityType: string;
  entityId: string;
  actor: string | null;
  source: "ui" | "openclaw" | "agent" | "system";
  causedByEventId: string | null;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export interface TaskRun {
  id: string;
  taskId: string;
  taskTitle: string;
  actor: string;
  status: "active" | "completed" | "released" | "timed_out";
  timerMode: TaskTimerMode;
  plannedDurationSeconds: number | null;
  elapsedWallSeconds: number;
  creditedSeconds: number;
  remainingSeconds: number | null;
  overtimeSeconds: number;
  isCurrent: boolean;
  note: string;
  leaseTtlSeconds: number;
  claimedAt: string;
  heartbeatAt: string;
  leaseExpiresAt: string;
  completedAt: string | null;
  releasedAt: string | null;
  timedOutAt: string | null;
  overrideReason: string | null;
  updatedAt: string;
}

export interface CalendarConnection {
  id: string;
  provider: CalendarProvider;
  label: string;
  accountLabel: string;
  status: CalendarConnectionStatus;
  config: Record<string, string | number | boolean | null>;
  forgeCalendarId: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarDiscoveryCalendar {
  url: string;
  displayName: string;
  description: string;
  color: string;
  timezone: string;
  isPrimary: boolean;
  canWrite: boolean;
  selectedByDefault: boolean;
  isForgeCandidate: boolean;
}

export interface CalendarDiscoveryPayload {
  provider: CalendarProvider;
  accountLabel: string;
  serverUrl: string;
  principalUrl: string | null;
  homeUrl: string | null;
  calendars: CalendarDiscoveryCalendar[];
}

export interface MicrosoftCalendarOauthSession {
  sessionId: string;
  status: "pending" | "authorized" | "error" | "consumed" | "expired";
  authUrl: string | null;
  accountLabel: string | null;
  error: string | null;
  discovery: CalendarDiscoveryPayload | null;
}

export interface CalendarResource {
  id: string;
  connectionId: string;
  remoteId: string;
  title: string;
  description: string;
  color: string;
  timezone: string;
  isPrimary: boolean;
  canWrite: boolean;
  selectedForSync: boolean;
  forgeManaged: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEvent {
  id: string;
  connectionId: string | null;
  calendarId: string | null;
  remoteId: string | null;
  ownership: "external" | "forge";
  originType: CalendarEventOrigin;
  status: "confirmed" | "tentative" | "cancelled";
  title: string;
  description: string;
  location: string;
  startAt: string;
  endAt: string;
  timezone: string;
  isAllDay: boolean;
  availability: CalendarAvailability;
  eventType: string;
  categories: string[];
  sourceMappings: CalendarEventSource[];
  links: CalendarEventLink[];
  remoteUpdatedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEventSource {
  id: string;
  provider: CalendarProvider;
  connectionId: string | null;
  calendarId: string | null;
  remoteCalendarId: string | null;
  remoteEventId: string;
  remoteUid: string | null;
  recurrenceInstanceId: string | null;
  isMasterRecurring: boolean;
  remoteHref: string | null;
  remoteEtag: string | null;
  syncState: "pending_create" | "pending_update" | "pending_delete" | "synced" | "error" | "deleted";
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEventLink {
  id: string;
  entityType: CrudEntityType;
  entityId: string;
  relationshipType: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkBlockTemplate {
  id: string;
  title: string;
  kind: WorkBlockKind;
  color: string;
  timezone: string;
  weekDays: number[];
  startMinute: number;
  endMinute: number;
  startsOn: string | null;
  endsOn: string | null;
  blockingState: "allowed" | "blocked";
  createdAt: string;
  updatedAt: string;
}

export interface WorkBlockInstance {
  id: string;
  templateId: string;
  dateKey: string;
  startAt: string;
  endAt: string;
  title: string;
  kind: WorkBlockKind;
  color: string;
  blockingState: "allowed" | "blocked";
  calendarEventId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskTimebox {
  id: string;
  taskId: string;
  projectId: string | null;
  connectionId: string | null;
  calendarId: string | null;
  remoteEventId: string | null;
  linkedTaskRunId: string | null;
  status: CalendarTimeboxStatus;
  source: CalendarTimeboxSource;
  title: string;
  startsAt: string;
  endsAt: string;
  overrideReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarOverviewPayload {
  generatedAt: string;
  providers: Array<{
    provider: CalendarProvider;
    label: string;
    supportsDedicatedForgeCalendar: boolean;
    connectionHelp: string;
  }>;
  connections: CalendarConnection[];
  calendars: CalendarResource[];
  events: CalendarEvent[];
  workBlockTemplates: WorkBlockTemplate[];
  workBlockInstances: WorkBlockInstance[];
  timeboxes: TaskTimebox[];
}

export interface HabitCheckIn {
  id: string;
  habitId: string;
  dateKey: string;
  status: HabitCheckInStatus;
  note: string;
  deltaXp: number;
  createdAt: string;
  updatedAt: string;
}

export interface Habit {
  id: string;
  title: string;
  description: string;
  status: HabitStatus;
  polarity: HabitPolarity;
  frequency: HabitFrequency;
  targetCount: number;
  weekDays: number[];
  linkedGoalIds: string[];
  linkedProjectIds: string[];
  linkedTaskIds: string[];
  linkedValueIds: string[];
  linkedPatternIds: string[];
  linkedBehaviorIds: string[];
  linkedBeliefIds: string[];
  linkedModeIds: string[];
  linkedReportIds: string[];
  linkedBehaviorId: string | null;
  linkedBehaviorTitle: string | null;
  linkedBehaviorTitles: string[];
  rewardXp: number;
  penaltyXp: number;
  createdAt: string;
  updatedAt: string;
  lastCheckInAt: string | null;
  lastCheckInStatus: HabitCheckInStatus | null;
  streakCount: number;
  completionRate: number;
  dueToday: boolean;
  checkIns: HabitCheckIn[];
}

export interface TaskRunClaimInput {
  actor: string;
  timerMode: TaskTimerMode;
  plannedDurationSeconds: number | null;
  overrideReason?: string | null;
  isCurrent?: boolean;
  leaseTtlSeconds: number;
  note: string;
}

export interface TaskRunHeartbeatInput {
  actor?: string;
  leaseTtlSeconds: number;
  note?: string;
}

export interface TaskRunFinishInput {
  actor?: string;
  note: string;
  closeoutNote?: {
    contentMarkdown: string;
    author?: string | null;
    links?: NoteLink[];
  };
}

export interface AchievementSignal {
  id: string;
  title: string;
  summary: string;
  tier: "bronze" | "silver" | "gold" | "platinum";
  progressLabel: string;
  unlocked: boolean;
  unlockedAt: string | null;
}

export interface MilestoneReward {
  id: string;
  title: string;
  summary: string;
  rewardLabel: string;
  progressLabel: string;
  current: number;
  target: number;
  completed: boolean;
}

export interface ProjectSummary extends Project {
  goalTitle: string;
  activeTaskCount: number;
  completedTaskCount: number;
  totalTasks: number;
  earnedPoints: number;
  progress: number;
  nextTaskId: string | null;
  nextTaskTitle: string | null;
  momentumLabel: string;
  time: TaskTimeSummary;
}

export interface TaskContext {
  task: Task;
  goal: Goal | null;
  project: ProjectSummary | null;
  activeTaskRun: TaskRun | null;
  taskRuns: TaskRun[];
  activity: ActivityEvent[];
  notesSummaryByEntity: NotesSummaryByEntity;
}

export interface ProjectBoardPayload {
  project: ProjectSummary;
  goal: Goal;
  tasks: Task[];
  activity: ActivityEvent[];
  notesSummaryByEntity: NotesSummaryByEntity;
}

export interface InsightsHeatmapCell {
  id: string;
  label: string;
  completed: number;
  focus: number;
  intensity: number;
}

export interface InsightsPayload {
  generatedAt: string;
  status: {
    systemStatus: string;
    streakDays: number;
    momentumScore: number;
  };
  momentumHeatmap: InsightsHeatmapCell[];
  executionTrends: Array<{
    label: string;
    xp: number;
    focusScore: number;
  }>;
  domainBalance: Array<{
    label: string;
    value: number;
    color: string;
    note: string;
  }>;
  coaching: {
    title: string;
    summary: string;
    recommendation: string;
    ctaLabel: string;
  };
  evidenceDigest: ActivityEvent[];
  feed: Insight[];
  openCount: number;
}

export interface WeeklyReviewPayload {
  generatedAt: string;
  windowLabel: string;
  weekKey: string;
  weekStartDate: string;
  weekEndDate: string;
  momentumSummary: {
    totalXp: number;
    focusHours: number;
    efficiencyScore: number;
    peakWindow: string;
  };
  chart: Array<{
    label: string;
    xp: number;
    focusHours: number;
  }>;
  wins: Array<{
    id: string;
    title: string;
    summary: string;
    rewardXp: number;
  }>;
  calibration: Array<{
    id: string;
    title: string;
    mode: "accelerate" | "maintain" | "recover";
    note: string;
  }>;
  reward: {
    title: string;
    summary: string;
    rewardXp: number;
  };
  completion: {
    finalized: boolean;
    finalizedAt: string | null;
    finalizedBy: string | null;
  };
}

export interface WeeklyReviewClosure {
  id: string;
  weekKey: string;
  weekStartDate: string;
  weekEndDate: string;
  windowLabel: string;
  actor: string | null;
  source: "ui" | "openclaw" | "agent" | "system";
  rewardId: string;
  activityEventId: string;
  createdAt: string;
}

export interface FinalizeWeeklyReviewResult {
  review: WeeklyReviewPayload;
  closure: WeeklyReviewClosure;
  reward: RewardLedgerEvent;
  metrics: XpMetricsPayload;
}

export interface AgentTokenSummary {
  id: string;
  label: string;
  tokenPrefix: string;
  scopes: string[];
  agentId: string | null;
  agentLabel: string | null;
  trustLevel: "standard" | "trusted" | "autonomous";
  autonomyMode: "approval_required" | "scoped_write" | "autonomous";
  approvalMode: "approval_by_default" | "high_impact_only" | "none";
  description: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
  status: "active" | "revoked";
}

export interface AgentIdentity {
  id: string;
  label: string;
  agentType: string;
  trustLevel: "standard" | "trusted" | "autonomous";
  autonomyMode: "approval_required" | "scoped_write" | "autonomous";
  approvalMode: "approval_by_default" | "high_impact_only" | "none";
  description: string;
  tokenCount: number;
  activeTokenCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface InsightEvidence {
  entityType: string;
  entityId: string;
  label: string;
}

export interface Insight {
  id: string;
  originType: "system" | "user" | "agent";
  originAgentId: string | null;
  originLabel: string | null;
  visibility: "visible" | "pending_review" | "archived";
  status: "open" | "accepted" | "dismissed" | "snoozed" | "applied" | "expired";
  entityType: string | null;
  entityId: string | null;
  timeframeLabel: string | null;
  title: string;
  summary: string;
  recommendation: string;
  rationale: string;
  confidence: number;
  ctaLabel: string;
  evidence: InsightEvidence[];
  createdAt: string;
  updatedAt: string;
}

export interface InsightFeedback {
  id: string;
  insightId: string;
  actor: string | null;
  feedbackType: "accepted" | "dismissed" | "applied" | "snoozed";
  note: string;
  createdAt: string;
}

export interface ApprovalRequest {
  id: string;
  actionType: string;
  status: "pending" | "approved" | "rejected" | "cancelled" | "executed";
  title: string;
  summary: string;
  entityType: string | null;
  entityId: string | null;
  requestedByAgentId: string | null;
  requestedByTokenId: string | null;
  requestedPayload: Record<string, unknown>;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  resolutionNote: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentAction {
  id: string;
  agentId: string | null;
  tokenId: string | null;
  actionType: string;
  riskLevel: "low" | "medium" | "high";
  status: "pending_approval" | "approved" | "rejected" | "executed";
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  idempotencyKey: string | null;
  approvalRequestId: string | null;
  outcome: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface RewardRule {
  id: string;
  family: "completion" | "consistency" | "alignment" | "recovery" | "collaboration" | "ambient";
  code: string;
  title: string;
  description: string;
  active: boolean;
  config: Record<string, string | number | boolean | null>;
  createdAt: string;
  updatedAt: string;
}

export interface RewardLedgerEvent {
  id: string;
  ruleId: string | null;
  eventLogId: string | null;
  entityType: string;
  entityId: string;
  actor: string | null;
  source: "ui" | "openclaw" | "agent" | "system";
  deltaXp: number;
  reasonTitle: string;
  reasonSummary: string;
  reversibleGroup: string | null;
  reversedByRewardId: string | null;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export interface OperatorContextPayload {
  generatedAt: string;
  activeProjects: ProjectSummary[];
  focusTasks: Task[];
  dueHabits: Habit[];
  currentBoard: {
    backlog: Task[];
    focus: Task[];
    inProgress: Task[];
    blocked: Task[];
    done: Task[];
  };
  recentActivity: ActivityEvent[];
  recentTaskRuns: TaskRun[];
  recommendedNextTask: Task | null;
  xp: XpMetricsPayload;
}

export interface OperatorSession {
  id: string;
  actorLabel: string;
  expiresAt: string;
}

export interface OperatorOverviewPayload {
  generatedAt: string;
  snapshot: ForgeSnapshot;
  operator: OperatorContextPayload;
  domains: Array<{
    id: string;
    slug: string;
    label: string;
    description: string;
    sensitive: boolean;
  }>;
  psyche: import("./psyche-types").PsycheOverviewPayload | null;
  onboarding: AgentOnboardingPayload;
  capabilities: {
    tokenPresent: boolean;
    scopes: string[];
    canReadPsyche: boolean;
    canWritePsyche: boolean;
    canManageModes: boolean;
    canManageRewards: boolean;
  };
  warnings: string[];
  routeGuide: {
    preferredStart: string;
    mainRoutes: Array<{
      id: string;
      path: string;
      summary: string;
      requiredScope: string | null;
    }>;
  };
}

export interface UpdateRewardRuleInput {
  title?: string;
  description?: string;
  active?: boolean;
  config?: Record<string, string | number | boolean | null>;
}

export interface CreateManualRewardGrantInput {
  entityType: RewardableEntityType;
  entityId: string;
  deltaXp: number;
  reasonTitle: string;
  reasonSummary?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface OperatorLogWorkInput {
  taskId?: string;
  title?: string;
  description?: string;
  summary?: string;
  owner?: string;
  goalId?: string | null;
  projectId?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  effort?: TaskEffort;
  energy?: TaskEnergy;
  dueDate?: string | null;
  points?: number;
  tagIds?: string[];
  closeoutNote?: {
    contentMarkdown: string;
    author?: string | null;
    links?: NoteLink[];
  };
}

export interface OperatorLogWorkResult {
  task: Task;
  xp: XpMetricsPayload;
}

export interface XpMomentumPulse {
  status: "surging" | "steady" | "recovering";
  headline: string;
  detail: string;
  celebrationLabel: string;
  nextMilestoneId: string | null;
  nextMilestoneLabel: string;
}

export interface XpMetricsPayload {
  profile: ForgeSnapshot["metrics"];
  achievements: AchievementSignal[];
  milestoneRewards: MilestoneReward[];
  momentumPulse: XpMomentumPulse;
  recentLedger: RewardLedgerEvent[];
  rules: RewardRule[];
  dailyAmbientXp: number;
  dailyAmbientCap: number;
}

export interface SettingsPayload {
  profile: {
    operatorName: string;
    operatorEmail: string;
    operatorTitle: string;
  };
  notifications: {
    goalDriftAlerts: boolean;
    dailyQuestReminders: boolean;
    achievementCelebrations: boolean;
  };
  execution: {
    maxActiveTasks: number;
    timeAccountingMode: TimeAccountingMode;
  };
  themePreference: "obsidian" | "solar" | "system";
  localePreference: AppLocale;
  security: {
    integrityScore: number;
    lastAuditAt: string;
    storageMode: "local-first";
    activeSessions: number;
    tokenCount: number;
  };
  agents: AgentIdentity[];
  agentTokens: AgentTokenSummary[];
}

export interface DeletedEntityRecord {
  entityType: CrudEntityType;
  entityId: string;
  title: string;
  subtitle: string | null;
  deletedAt: string;
  deletedByActor: string | null;
  deletedSource: string | null;
  deleteReason: string | null;
  snapshot: Record<string, unknown>;
}

export interface SettingsBinPayload {
  generatedAt: string;
  totalCount: number;
  countsByEntityType: Partial<Record<CrudEntityType, number>>;
  records: DeletedEntityRecord[];
}

export interface AgentOnboardingFieldGuide {
  name: string;
  type: string;
  required: boolean;
  description: string;
  enumValues?: string[];
  defaultValue?: string | number | boolean | null;
  nullable?: boolean;
}

export interface AgentOnboardingEntityGuide {
  entityType: CrudEntityType;
  purpose: string;
  minimumCreateFields: string[];
  relationshipRules: string[];
  searchHints: string[];
  fieldGuide: AgentOnboardingFieldGuide[];
  examples?: string[];
}

export interface AgentOnboardingToolGuide {
  toolName: string;
  summary: string;
  whenToUse: string;
  inputShape: string;
  requiredFields: string[];
  notes: string[];
  example: string;
}

export interface AgentOnboardingPsychePlaybook {
  focus: string;
  useWhen: string;
  coachingGoal: string;
  askSequence: string[];
  requiredForCreate: string[];
  highValueOptionalFields: string[];
  exampleQuestions: string[];
  notes: string[];
}

export interface AgentOnboardingPayload {
  forgeBaseUrl: string;
  webAppUrl: string;
  apiBaseUrl: string;
  openApiUrl: string;
  healthUrl: string;
  settingsUrl: string;
  tokenCreateUrl: string;
  pluginBasePath: string;
  defaultConnectionMode: "operator_session" | "managed_token";
  defaultActorLabel: string;
  defaultTimeoutMs: number;
  recommendedScopes: string[];
  recommendedTrustLevel: "standard" | "trusted" | "autonomous";
  recommendedAutonomyMode: "approval_required" | "scoped_write" | "autonomous";
  recommendedApprovalMode: "approval_by_default" | "high_impact_only" | "none";
  authModes: {
    operatorSession: {
      label: string;
      summary: string;
      tokenRequired: boolean;
      trustedTargets: string[];
    };
    managedToken: {
      label: string;
      summary: string;
      tokenRequired: boolean;
    };
  };
  tokenRecovery: {
    rawTokenStoredByForge: boolean;
    recoveryAction: string;
    rotationSummary: string;
    settingsSummary: string;
  };
  requiredHeaders: {
    authorization: string;
    source: string;
    actor: string;
  };
  conceptModel: {
    goal: string;
    project: string;
    task: string;
    taskRun: string;
    note: string;
    insight: string;
    psyche: string;
  };
  psycheSubmoduleModel: {
    value: string;
    behaviorPattern: string;
    behavior: string;
    beliefEntry: string;
    schemaCatalog: string;
    modeProfile: string;
    modeGuideSession: string;
    eventType: string;
    emotionDefinition: string;
    triggerReport: string;
  };
  psycheCoachingPlaybooks: AgentOnboardingPsychePlaybook[];
  relationshipModel: string[];
  entityCatalog: AgentOnboardingEntityGuide[];
  toolInputCatalog: AgentOnboardingToolGuide[];
  verificationPaths: {
    context: string;
    xpMetrics: string;
    weeklyReview: string;
    settingsBin: string;
    batchSearch: string;
    psycheSchemaCatalog: string;
    psycheEventTypes: string;
    psycheEmotions: string;
  };
  recommendedPluginTools: {
    bootstrap: string[];
    readModels: string[];
    uiWorkflow: string[];
    entityWorkflow: string[];
    workWorkflow: string[];
    insightWorkflow: string[];
  };
  interactionGuidance: {
    conversationMode: string;
    saveSuggestionPlacement: string;
    saveSuggestionTone: string;
    maxQuestionsPerTurn: number;
    duplicateCheckRoute: string;
    uiSuggestionRule: string;
    browserFallbackRule: string;
    writeConsentRule: string;
  };
  mutationGuidance: {
    preferredBatchRoutes: {
      create: string;
      update: string;
      delete: string;
      restore: string;
      search: string;
    };
    deleteDefault: DeleteMode;
    hardDeleteRequiresExplicitMode: boolean;
    restoreSummary: string;
    entityDeleteSummary: string;
    batchingRule: string;
    searchRule: string;
    createRule: string;
    updateRule: string;
    createExample: string;
    updateExample: string;
  };
}

export interface AgentTokenMutationResult {
  token: string;
  tokenSummary: AgentTokenSummary;
}

export interface DashboardGoal extends Goal {
  progress: number;
  totalTasks: number;
  completedTasks: number;
  earnedPoints: number;
  momentumLabel: string;
  tags: Tag[];
}

export interface ContextDomainBalance {
  tagId: string;
  label: string;
  color: string;
  goalCount: number;
  activeTaskCount: number;
  completedPoints: number;
  momentumLabel: string;
}

export interface ContextNeglectedGoal {
  goalId: string;
  title: string;
  summary: string;
  risk: "low" | "medium" | "high";
}

export interface ForgeSnapshot {
  meta: {
    apiVersion: "v1";
    transport: "rest+sse";
    generatedAt: string;
    backend: string;
    mode: "transitional-node" | "rust-target";
  };
  metrics: {
    totalXp: number;
    level: number;
    currentLevelXp: number;
    nextLevelXp: number;
    weeklyXp: number;
    streakDays: number;
    comboMultiplier: number;
    momentumScore: number;
    topGoalId: string | null;
    topGoalTitle: string | null;
  };
  dashboard: {
    stats: {
      totalPoints: number;
      completedThisWeek: number;
      activeGoals: number;
      alignmentScore: number;
      focusTasks: number;
      overdueTasks: number;
      dueThisWeek: number;
    };
    goals: DashboardGoal[];
    projects: ProjectSummary[];
    tasks: Task[];
    habits: Habit[];
    tags: Tag[];
    suggestedTags: Tag[];
    owners: string[];
    executionBuckets: Array<{
      id: string;
      label: string;
      summary: string;
      tone: "urgent" | "accent" | "neutral" | "success";
      tasks: Task[];
    }>;
    gamification: ForgeSnapshot["metrics"];
    achievements: AchievementSignal[];
    milestoneRewards: MilestoneReward[];
    recentActivity: ActivityEvent[];
    notesSummaryByEntity: NotesSummaryByEntity;
  };
  overview: {
    generatedAt: string;
    strategicHeader: {
      streakDays: number;
      level: number;
      totalXp: number;
      currentLevelXp: number;
      nextLevelXp: number;
      momentumScore: number;
      focusTasks: number;
      overdueTasks: number;
    };
    projects: ProjectSummary[];
    activeGoals: DashboardGoal[];
    topTasks: Task[];
    dueHabits: Habit[];
    recentEvidence: ActivityEvent[];
    achievements: AchievementSignal[];
    domainBalance: ContextDomainBalance[];
    neglectedGoals: ContextNeglectedGoal[];
  };
  today: {
    generatedAt: string;
    directive: {
      task: Task | null;
      goalTitle: string | null;
      rewardXp: number;
      sessionLabel: string;
    };
    timeline: Array<{
      id: string;
      label: string;
      tasks: Task[];
    }>;
    dueHabits: Habit[];
    dailyQuests: Array<{
      id: string;
      title: string;
      summary: string;
      rewardXp: number;
      progressLabel: string;
      completed: boolean;
    }>;
    milestoneRewards: MilestoneReward[];
    recentHabitRewards: RewardLedgerEvent[];
    momentum: {
      streakDays: number;
      momentumScore: number;
      recoveryHint: string;
    };
  };
  risk: {
    generatedAt: string;
    overdueTasks: Task[];
    blockedTasks: Task[];
    neglectedGoals: ContextNeglectedGoal[];
    summary: string;
  };
  goals: Goal[];
  projects: ProjectSummary[];
  tags: Tag[];
  tasks: Task[];
  habits: Habit[];
  activity: ActivityEvent[];
  activeTaskRuns: TaskRun[];
}
