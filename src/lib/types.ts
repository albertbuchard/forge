export type TaskStatus =
  | "backlog"
  | "focus"
  | "in_progress"
  | "blocked"
  | "done";
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
export type CalendarConnectionStatus =
  | "connected"
  | "needs_attention"
  | "error";
export type CalendarEventOrigin =
  | "native"
  | "google"
  | "apple"
  | "caldav"
  | "microsoft"
  | "derived";
export type CalendarAvailability = "busy" | "free";
export type WorkBlockKind =
  | "main_activity"
  | "secondary_activity"
  | "third_activity"
  | "rest"
  | "holiday"
  | "custom";
export type CalendarTimeboxStatus =
  | "planned"
  | "active"
  | "completed"
  | "cancelled";
export type CalendarTimeboxSource = "manual" | "suggested" | "live_run";
export type WorkAdjustmentEntityType = "task" | "project";
export type CrudEntityType =
  | "goal"
  | "project"
  | "task"
  | "strategy"
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

export type UserKind = "human" | "bot";

export interface UserSummary {
  id: string;
  kind: UserKind;
  handle: string;
  displayName: string;
  description: string;
  accentColor: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserAccessRights {
  discoverable: boolean;
  canListUsers: boolean;
  canReadProfile: boolean;
  canReadEntities: boolean;
  canSearchEntities: boolean;
  canLinkEntities: boolean;
  canCoordinate: boolean;
  canAffectEntities: boolean;
  canManageStrategies: boolean;
  canCreateOnBehalf: boolean;
  canViewMetrics: boolean;
  canViewActivity: boolean;
}

export interface UserAccessGrantConfig {
  self: boolean;
  mutable: boolean;
  linkedEntities: boolean;
  rights: UserAccessRights;
}

export interface UserAccessGrant {
  id: string;
  subjectUserId: string;
  targetUserId: string;
  accessLevel: "view" | "manage";
  config: UserAccessGrantConfig;
  createdAt: string;
  updatedAt: string;
  subjectUser: UserSummary | null;
  targetUser: UserSummary | null;
}

export interface UserOwnershipSummary {
  userId: string;
  totalOwnedEntities: number;
  entityCounts: Record<string, number>;
}

export interface UserXpSummary {
  userId: string;
  totalXp: number;
  weeklyXp: number;
  rewardEventCount: number;
  lastRewardAt: string | null;
}

export interface UserDirectoryPayload {
  users: UserSummary[];
  grants: UserAccessGrant[];
  ownership: UserOwnershipSummary[];
  xp: UserXpSummary[];
  posture: {
    accessModel: "permissive" | "directional_graph";
    summary: string;
    futureReady: boolean;
  };
}

export interface OwnedEntity {
  userId?: string | null;
  user?: UserSummary | null;
}

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

export interface Note extends OwnedEntity {
  id: string;
  kind: "evidence" | "wiki";
  title: string;
  slug: string;
  spaceId: string;
  parentSlug: string | null;
  indexOrder: number;
  showInIndex: boolean;
  aliases: string[];
  summary: string;
  contentMarkdown: string;
  contentPlain: string;
  author: string | null;
  source: "ui" | "openclaw" | "agent" | "system";
  sourcePath: string;
  frontmatter: Record<string, unknown>;
  revisionHash: string;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  links: NoteLink[];
  tags?: string[];
  destroyAt?: string | null;
}

export interface WikiSpace {
  id: string;
  slug: string;
  label: string;
  description: string;
  ownerUserId: string | null;
  visibility: "personal" | "shared";
  createdAt: string;
  updatedAt: string;
}

export interface WikiLinkEdge {
  sourceNoteId: string;
  targetType: "page" | "entity" | "unresolved";
  targetNoteId: string | null;
  targetEntityType: CrudEntityType | null;
  targetEntityId: string | null;
  label: string;
  rawTarget: string;
  isEmbed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WikiMediaAsset {
  id: string;
  spaceId: string;
  noteId: string | null;
  label: string;
  mimeType: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
  checksum: string;
  transcriptNoteId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WikiLlmProfile {
  id: string;
  label: string;
  provider: string;
  baseUrl: string;
  model: string;
  secretId: string | null;
  systemPrompt: string;
  enabled: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WikiEmbeddingProfile {
  id: string;
  label: string;
  provider: string;
  baseUrl: string;
  model: string;
  secretId: string | null;
  dimensions: number | null;
  chunkSize: number;
  chunkOverlap: number;
  enabled: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WikiSettingsPayload {
  spaces: WikiSpace[];
  llmProfiles: WikiLlmProfile[];
  embeddingProfiles: WikiEmbeddingProfile[];
}

export interface WikiHealthPayload {
  space: WikiSpace;
  indexPath: string;
  rawDirectoryPath: string;
  pageCount: number;
  wikiPageCount: number;
  evidencePageCount: number;
  assetCount: number;
  rawSourceCount: number;
  unresolvedLinks: Array<{
    sourceNoteId: string;
    sourceSlug: string;
    sourceTitle: string;
    rawTarget: string;
    updatedAt: string;
  }>;
  orphanPages: Array<{
    id: string;
    slug: string;
    title: string;
    kind: Note["kind"];
    updatedAt: string;
  }>;
  missingSummaries: Array<{
    id: string;
    slug: string;
    title: string;
    updatedAt: string;
  }>;
  enabledEmbeddingProfiles: Array<{
    id: string;
    label: string;
    model: string;
  }>;
  enabledLlmProfiles: Array<{
    id: string;
    label: string;
    model: string;
  }>;
}

export interface WikiPageDetailPayload {
  page: Note;
  backlinks: WikiLinkEdge[];
  backlinkSourceNotes: Note[];
  assets: WikiMediaAsset[];
  backlinksBySourceId: Record<string, Note | null>;
}

export interface WikiTreeNode {
  page: Note;
  children: WikiTreeNode[];
}

export interface WikiSearchResult {
  page: Note;
  score: number;
}

export interface WikiSearchResponse {
  mode: "text" | "semantic" | "entity" | "hybrid";
  profileId: string | null;
  results: WikiSearchResult[];
}

export interface WikiIngestJobItem {
  id: string;
  itemType: string;
  status: string;
  noteId: string | null;
  mediaAssetId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WikiIngestJobLogEntry {
  id: string;
  level: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface WikiIngestJobAsset {
  id: string;
  status: string;
  sourceKind: string;
  sourceLocator: string;
  fileName: string;
  mimeType: string;
  filePath: string;
  sizeBytes: number;
  checksum: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WikiIngestJobCandidate {
  id: string;
  sourceAssetId: string | null;
  candidateType: string;
  status: string;
  title: string;
  summary: string;
  targetKey: string;
  payload: Record<string, unknown>;
  publishedNoteId: string | null;
  publishedEntityType: string | null;
  publishedEntityId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WikiIngestJobPayload {
  job: {
    id: string;
    spaceId: string;
    llmProfileId: string | null;
    status: string;
    phase: string;
    progressPercent: number;
    totalFiles: number;
    processedFiles: number;
    createdPageCount: number;
    createdEntityCount: number;
    acceptedCount: number;
    rejectedCount: number;
    latestMessage: string;
    sourceKind: string;
    sourceLocator: string;
    mimeType: string;
    titleHint: string;
    summary: string;
    pageNoteId: string | null;
    createdByActor: string | null;
    errorMessage: string;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
  };
  items: WikiIngestJobItem[];
  logs: WikiIngestJobLogEntry[];
  assets: WikiIngestJobAsset[];
  candidates: WikiIngestJobCandidate[];
}

export interface NoteSummary {
  count: number;
  latestNoteId: string | null;
  latestCreatedAt: string | null;
}

export type NotesSummaryByEntity = Record<string, NoteSummary>;

export interface Tag extends OwnedEntity {
  id: string;
  name: string;
  kind: "value" | "category" | "execution";
  color: string;
  description: string;
}

export interface Goal extends OwnedEntity {
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

export interface Project extends OwnedEntity {
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

export interface Task extends OwnedEntity {
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

export interface ActivityEvent extends OwnedEntity {
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

export interface TaskRun extends OwnedEntity {
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

export interface CalendarEvent extends OwnedEntity {
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
  place: {
    label: string;
    address: string;
    timezone: string;
    latitude: number | null;
    longitude: number | null;
    source: string;
    externalPlaceId: string;
  };
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
  syncState:
    | "pending_create"
    | "pending_update"
    | "pending_delete"
    | "synced"
    | "error"
    | "deleted";
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

export interface WorkBlockTemplate extends OwnedEntity {
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

export interface TaskTimebox extends OwnedEntity {
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

export interface Habit extends OwnedEntity {
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
  generatedHealthEventTemplate: {
    enabled: boolean;
    workoutType: string;
    title: string;
    durationMinutes: number;
    xpReward: number;
    tags: string[];
    links: Array<{
      entityType: string;
      entityId: string;
      relationshipType: string;
    }>;
    notesTemplate: string;
  };
  createdAt: string;
  updatedAt: string;
  lastCheckInAt: string | null;
  lastCheckInStatus: HabitCheckInStatus | null;
  streakCount: number;
  completionRate: number;
  dueToday: boolean;
  checkIns: HabitCheckIn[];
}

export interface CompanionPairingSession {
  id: string;
  userId: string;
  label: string;
  status:
    | "pending"
    | "paired"
    | "healthy"
    | "stale"
    | "permission_denied"
    | "error"
    | "revoked";
  capabilities: string[];
  deviceName: string | null;
  platform: string | null;
  appVersion: string | null;
  apiBaseUrl: string;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  pairedAt: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompanionOverviewPayload {
  pairings: CompanionPairingSession[];
  importRuns: HealthImportRun[];
  healthState:
    | "disconnected"
    | "connected"
    | "partially_connected"
    | "stale_sync"
    | "healthy_sync";
  lastSyncAt: string | null;
  counts: {
    sleepSessions: number;
    workouts: number;
    reflectiveSleepSessions: number;
    linkedWorkouts: number;
    habitGeneratedWorkouts: number;
    reconciledWorkouts: number;
  };
  permissions: {
    healthKitAuthorized: boolean;
    backgroundRefreshEnabled: boolean;
    locationReady: boolean;
    motionReady: boolean;
  };
}

export interface HealthImportRun {
  id: string;
  pairingSessionId: string | null;
  userId: string;
  source: string;
  sourceDevice: string;
  status: string;
  payloadSummary: Record<string, unknown>;
  importedCount: number;
  createdCount: number;
  updatedCount: number;
  mergedCount: number;
  errorMessage: string | null;
  importedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface HealthLink {
  entityType: string;
  entityId: string;
  relationshipType: string;
}

export interface SleepSessionRecord {
  id: string;
  externalUid: string;
  pairingSessionId: string | null;
  userId: string;
  source: string;
  sourceType: string;
  sourceDevice: string;
  startedAt: string;
  endedAt: string;
  timeInBedSeconds: number;
  asleepSeconds: number;
  awakeSeconds: number;
  sleepScore: number | null;
  regularityScore: number | null;
  bedtimeConsistencyMinutes: number | null;
  wakeConsistencyMinutes: number | null;
  stageBreakdown: Array<{ stage: string; seconds: number }>;
  recoveryMetrics: Record<string, unknown>;
  links: HealthLink[];
  annotations: Record<string, unknown>;
  provenance: Record<string, unknown>;
  derived: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WorkoutSessionRecord {
  id: string;
  externalUid: string;
  pairingSessionId: string | null;
  userId: string;
  source: string;
  sourceType: string;
  workoutType: string;
  sourceDevice: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  activeEnergyKcal: number | null;
  totalEnergyKcal: number | null;
  distanceMeters: number | null;
  stepCount: number | null;
  exerciseMinutes: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  subjectiveEffort: number | null;
  moodBefore: string;
  moodAfter: string;
  meaningText: string;
  plannedContext: string;
  socialContext: string;
  links: HealthLink[];
  tags: string[];
  annotations: Record<string, unknown>;
  provenance: Record<string, unknown>;
  derived: Record<string, unknown>;
  generatedFromHabitId: string | null;
  generatedFromCheckInId: string | null;
  reconciliationStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface SleepViewData {
  summary: {
    totalSleepSeconds: number;
    averageSleepSeconds: number;
    averageTimeInBedSeconds: number;
    averageSleepScore: number;
    averageRegularityScore: number;
    averageEfficiency: number;
    averageRestorativeShare: number;
    reflectiveNightCount: number;
    linkedNightCount: number;
    averageBedtimeConsistencyMinutes: number;
    averageWakeConsistencyMinutes: number;
    latestBedtime: string | null;
    latestWakeTime: string | null;
  };
  weeklyTrend: Array<{
    id: string;
    dateKey: string;
    sleepHours: number;
    score: number;
    regularity: number;
  }>;
  monthlyPattern: Array<{
    id: string;
    dateKey: string;
    onsetHour: number;
    wakeHour: number;
    sleepHours: number;
  }>;
  stageAverages: Array<{
    stage: string;
    averageSeconds: number;
  }>;
  linkBreakdown: Array<{
    entityType: string;
    count: number;
  }>;
  sessions: SleepSessionRecord[];
}

export interface FitnessViewData {
  summary: {
    workoutCount: number;
    weeklyVolumeSeconds: number;
    exerciseMinutes: number;
    energyBurnedKcal: number;
    distanceMeters: number;
    workoutTypes: string[];
    averageSessionMinutes: number;
    averageEffort: number;
    linkedSessionCount: number;
    plannedSessionCount: number;
    importedSessionCount: number;
    habitGeneratedSessionCount: number;
    reconciledSessionCount: number;
    topWorkoutType: string | null;
    streakDays: number;
  };
  weeklyTrend: Array<{
    id: string;
    dateKey: string;
    workoutType: string;
    durationMinutes: number;
    energyKcal: number;
  }>;
  typeBreakdown: Array<{
    workoutType: string;
    sessionCount: number;
    totalMinutes: number;
    energyKcal: number;
  }>;
  sessions: WorkoutSessionRecord[];
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

export interface Insight extends OwnedEntity {
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

export interface StrategyLinkedEntity {
  entityType: CrudEntityType;
  entityId: string;
}

export interface StrategyGraphNode {
  id: string;
  entityType: "project" | "task";
  entityId: string;
  title: string;
  branchLabel: string;
  notes: string;
}

export interface StrategyGraphEdge {
  from: string;
  to: string;
  label: string;
  condition: string;
}

export interface StrategyGraph {
  nodes: StrategyGraphNode[];
  edges: StrategyGraphEdge[];
}

export interface StrategyMetrics {
  alignmentScore: number;
  planCoverageScore: number;
  sequencingScore: number;
  scopeDisciplineScore: number;
  qualityScore: number;
  targetProgressScore: number;
  completedNodeCount: number;
  startedNodeCount: number;
  readyNodeCount: number;
  totalNodeCount: number;
  completedTargetCount: number;
  totalTargetCount: number;
  offPlanEntityCount: number;
  offPlanActiveEntityCount: number;
  offPlanCompletedEntityCount: number;
  activeNodeIds: string[];
  nextNodeIds: string[];
  blockedNodeIds: string[];
  outOfOrderNodeIds: string[];
}

export interface Strategy extends OwnedEntity {
  id: string;
  title: string;
  overview: string;
  endStateDescription: string;
  status: "active" | "paused" | "completed";
  targetGoalIds: string[];
  targetProjectIds: string[];
  linkedEntities: StrategyLinkedEntity[];
  graph: StrategyGraph;
  metrics: StrategyMetrics;
  isLocked: boolean;
  lockedAt: string | null;
  lockedByUserId: string | null;
  lockedByUser: UserSummary | null;
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
  family:
    | "completion"
    | "consistency"
    | "alignment"
    | "recovery"
    | "collaboration"
    | "ambient";
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
    psycheAuthRequired?: boolean;
  };
  calendarProviders: {
    microsoft: {
      clientId: string;
      tenantId: string;
      redirectUri: string;
      usesClientSecret: false;
      readOnly: true;
      authMode: "public_client_pkce";
      isConfigured: boolean;
      isReadyForSignIn: boolean;
      setupMessage: string;
    };
  };
  agents: AgentIdentity[];
  agentTokens: AgentTokenSummary[];
}

export type MicrosoftCalendarAuthSettings =
  SettingsPayload["calendarProviders"]["microsoft"];

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
  multiUserModel: {
    summary: string;
    defaultUserScopeBehavior: string;
    routeScoping: string[];
    relationshipGraphDefaults: string[];
  };
  strategyContractModel: {
    draftSummary: string;
    lockSummary: string;
    unlockSummary: string;
    alignmentSummary: string;
    metricBreakdown: string[];
  };
  entityCatalog: AgentOnboardingEntityGuide[];
  toolInputCatalog: AgentOnboardingToolGuide[];
  connectionGuides: {
    openclaw: {
      label: string;
      installSteps: string[];
      verifyCommands: string[];
      configNotes: string[];
    };
    hermes: {
      label: string;
      installSteps: string[];
      verifyCommands: string[];
      configNotes: string[];
    };
  };
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
  users: UserSummary[];
  strategies: Strategy[];
  userScope: {
    selectedUserIds: string[];
    selectedUsers: UserSummary[];
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

export type PreferenceDomain =
  | "projects"
  | "tasks"
  | "strategies"
  | "habits"
  | "calendar"
  | "sleep"
  | "sports"
  | "activities"
  | "food"
  | "places"
  | "countries"
  | "fashion"
  | "people"
  | "media"
  | "tools"
  | "custom";

export type PreferenceCatalogSource = "seeded" | "custom";

export type PreferenceContextShareMode = "shared" | "isolated" | "blended";
export type PreferenceJudgmentOutcome = "left" | "right" | "tie" | "skip";
export type PreferenceSignalType =
  | "favorite"
  | "veto"
  | "must_have"
  | "bookmark"
  | "neutral"
  | "compare_later";
export type PreferenceDimensionId =
  | "novelty"
  | "simplicity"
  | "rigor"
  | "aesthetics"
  | "depth"
  | "structure"
  | "familiarity"
  | "surprise";
export type PreferenceItemStatus =
  | "liked"
  | "disliked"
  | "uncertain"
  | "vetoed"
  | "bookmarked"
  | "favorite"
  | "must_have"
  | "neutral";

export interface PreferenceDimensionVector {
  novelty: number;
  simplicity: number;
  rigor: number;
  aesthetics: number;
  depth: number;
  structure: number;
  familiarity: number;
  surprise: number;
}

export interface PreferenceLinkedEntity {
  entityType: CrudEntityType;
  entityId: string;
}

export interface PreferenceProfile {
  id: string;
  userId: string;
  domain: PreferenceDomain;
  defaultContextId: string | null;
  modelVersion: string;
  createdAt: string;
  updatedAt: string;
  user?: UserSummary | null;
}

export interface PreferenceContext {
  id: string;
  profileId: string;
  name: string;
  description: string;
  shareMode: PreferenceContextShareMode;
  active: boolean;
  isDefault: boolean;
  decayDays: number;
  createdAt: string;
  updatedAt: string;
}

export interface PreferenceItem {
  id: string;
  profileId: string;
  label: string;
  description: string;
  tags: string[];
  featureWeights: PreferenceDimensionVector;
  sourceEntityType?: CrudEntityType | null;
  sourceEntityId?: string | null;
  linkedEntity?: PreferenceLinkedEntity | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PreferenceCatalogItem {
  id: string;
  catalogId: string;
  label: string;
  description: string;
  tags: string[];
  featureWeights: PreferenceDimensionVector;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface PreferenceCatalog {
  id: string;
  profileId: string;
  domain: PreferenceDomain;
  slug: string;
  title: string;
  description: string;
  source: PreferenceCatalogSource;
  createdAt: string;
  updatedAt: string;
  items: PreferenceCatalogItem[];
}

export interface PairwiseJudgment {
  id: string;
  profileId: string;
  contextId: string;
  userId: string;
  leftItemId: string;
  rightItemId: string;
  outcome: PreferenceJudgmentOutcome;
  strength: number;
  responseTimeMs: number | null;
  source: string;
  reasonTags: string[];
  createdAt: string;
}

export interface AbsoluteSignal {
  id: string;
  profileId: string;
  contextId: string;
  userId: string;
  itemId: string;
  signalType: PreferenceSignalType;
  strength: number;
  source: string;
  createdAt: string;
}

export interface PreferenceItemScore {
  id: string;
  profileId: string;
  contextId: string;
  itemId: string;
  latentScore: number;
  confidence: number;
  uncertainty: number;
  evidenceCount: number;
  pairwiseWins: number;
  pairwiseLosses: number;
  pairwiseTies: number;
  signalCount: number;
  conflictCount: number;
  status: PreferenceItemStatus;
  dominantDimensions: PreferenceDimensionId[];
  explanation: string[];
  manualStatus?: PreferenceItemStatus | null;
  manualScore?: number | null;
  confidenceLock?: number | null;
  bookmarked: boolean;
  compareLater: boolean;
  frozen: boolean;
  lastInferredAt: string;
  lastJudgmentAt: string | null;
  updatedAt: string;
  item?: PreferenceItem;
}

export interface PreferenceDimensionSummary {
  id: string;
  profileId: string;
  contextId: string;
  dimensionId: PreferenceDimensionId;
  leaning: number;
  confidence: number;
  movement: number;
  contextSensitivity: number;
  evidenceCount: number;
  updatedAt: string;
}

export interface PreferenceSnapshot {
  id: string;
  profileId: string;
  contextId: string;
  summaryMetrics: Record<string, unknown>;
  serializedModelState: Record<string, unknown>;
  createdAt: string;
}

export interface PreferenceMapPoint {
  itemId: string;
  label: string;
  x: number;
  y: number;
  score: number;
  confidence: number;
  uncertainty: number;
  status: PreferenceItemStatus;
  clusterKey: string;
  tags: string[];
  sourceEntityType?: CrudEntityType | null;
  sourceEntityId?: string | null;
}

export interface PreferenceComparePair {
  left: PreferenceItem;
  right: PreferenceItem;
  rationale: string[];
  score: number;
}

export interface PreferenceWorkspacePayload {
  profile: PreferenceProfile;
  selectedContext: PreferenceContext;
  contexts: PreferenceContext[];
  catalogs: PreferenceCatalog[];
  dimensions: PreferenceDimensionSummary[];
  scores: PreferenceItemScore[];
  map: PreferenceMapPoint[];
  history: {
    judgments: PairwiseJudgment[];
    signals: AbsoluteSignal[];
    snapshots: PreferenceSnapshot[];
    staleItemIds: string[];
    flippedItemIds: string[];
  };
  compare: {
    nextPair: PreferenceComparePair | null;
    pendingCount: number;
    candidateCount: number;
  };
  summary: {
    totalItems: number;
    likedCount: number;
    dislikedCount: number;
    uncertainCount: number;
    bookmarkedCount: number;
    vetoedCount: number;
    averageConfidence: number;
    pendingComparisons: number;
  };
  libraries: {
    totalCatalogs: number;
    totalCatalogItems: number;
    seededCatalogCount: number;
    customCatalogCount: number;
  };
}

export interface PreferenceWorkspaceQuery {
  userId?: string;
  domain?: PreferenceDomain;
  contextId?: string;
}

export interface PreferenceContextMutationInput {
  userId: string;
  domain: PreferenceDomain;
  name: string;
  description?: string;
  shareMode?: PreferenceContextShareMode;
  active?: boolean;
  isDefault?: boolean;
  decayDays?: number;
}

export interface PreferenceContextPatchInput {
  name?: string;
  description?: string;
  shareMode?: PreferenceContextShareMode;
  active?: boolean;
  isDefault?: boolean;
  decayDays?: number;
}

export interface PreferenceContextMergeInput {
  sourceContextId: string;
  targetContextId: string;
}

export interface PreferenceItemMutationInput {
  userId: string;
  domain: PreferenceDomain;
  label: string;
  description?: string;
  tags?: string[];
  featureWeights?: Partial<PreferenceDimensionVector>;
  sourceEntityType?: CrudEntityType | null;
  sourceEntityId?: string | null;
  metadata?: Record<string, unknown>;
  queueForCompare?: boolean;
}

export interface PreferenceItemPatchInput {
  label?: string;
  description?: string;
  tags?: string[];
  featureWeights?: Partial<PreferenceDimensionVector>;
  sourceEntityType?: CrudEntityType | null;
  sourceEntityId?: string | null;
  metadata?: Record<string, unknown>;
  queueForCompare?: boolean;
}

export interface EnqueuePreferenceEntityInput {
  userId: string;
  domain: PreferenceDomain;
  entityType: CrudEntityType;
  entityId: string;
  label?: string;
  description?: string;
  tags?: string[];
}

export interface PreferenceJudgmentInput {
  userId: string;
  domain: PreferenceDomain;
  contextId: string;
  leftItemId: string;
  rightItemId: string;
  outcome: PreferenceJudgmentOutcome;
  strength?: number;
  responseTimeMs?: number | null;
  reasonTags?: string[];
}

export interface PreferenceSignalInput {
  userId: string;
  domain: PreferenceDomain;
  contextId: string;
  itemId: string;
  signalType: PreferenceSignalType;
  strength?: number;
}

export interface PreferenceScorePatchInput {
  userId: string;
  domain: PreferenceDomain;
  contextId: string;
  manualStatus?: PreferenceItemStatus | null;
  manualScore?: number | null;
  confidenceLock?: number | null;
  bookmarked?: boolean;
  compareLater?: boolean;
  frozen?: boolean;
}

export interface PreferenceCatalogMutationInput {
  userId: string;
  domain: PreferenceDomain;
  title: string;
  description?: string;
  slug?: string;
}

export interface PreferenceCatalogPatchInput {
  title?: string;
  description?: string;
  slug?: string;
}

export interface PreferenceCatalogItemMutationInput {
  catalogId: string;
  label: string;
  description?: string;
  tags?: string[];
  featureWeights?: Partial<PreferenceDimensionVector>;
  position?: number;
}

export interface PreferenceCatalogItemPatchInput {
  label?: string;
  description?: string;
  tags?: string[];
  featureWeights?: Partial<PreferenceDimensionVector>;
  position?: number;
}

export interface PreferenceGameStartInput {
  userId: string;
  domain: PreferenceDomain;
  contextId?: string;
  catalogId?: string;
}
