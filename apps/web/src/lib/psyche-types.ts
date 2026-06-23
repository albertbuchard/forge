import type { ActivityEvent, Insight, Note, OwnedEntity } from "./types";

export interface Domain {
  id: string;
  slug: string;
  title: string;
  description: string;
  themeColor: string;
  sensitive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SchemaCatalogEntry {
  id: string;
  slug: string;
  title: string;
  family: string;
  schemaType: "maladaptive" | "adaptive";
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventType extends OwnedEntity {
  id: string;
  domainId: string;
  label: string;
  description: string;
  system: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmotionDefinition extends OwnedEntity {
  id: string;
  domainId: string;
  label: string;
  description: string;
  category: string;
  system: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PsycheValue extends OwnedEntity {
  id: string;
  domainId: string;
  title: string;
  description: string;
  valuedDirection: string;
  whyItMatters: string;
  linkedGoalIds: string[];
  linkedProjectIds: string[];
  linkedTaskIds: string[];
  committedActions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BehaviorPattern extends OwnedEntity {
  id: string;
  domainId: string;
  title: string;
  description: string;
  targetBehavior: string;
  cueContexts: string[];
  shortTermPayoff: string;
  longTermCost: string;
  preferredResponse: string;
  linkedValueIds: string[];
  linkedSchemaLabels: string[];
  linkedModeLabels: string[];
  linkedModeIds: string[];
  linkedBeliefIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Behavior extends OwnedEntity {
  id: string;
  domainId: string;
  kind: "away" | "committed" | "recovery";
  title: string;
  description: string;
  commonCues: string[];
  urgeStory: string;
  shortTermPayoff: string;
  longTermCost: string;
  replacementMove: string;
  repairPlan: string;
  linkedPatternIds: string[];
  linkedValueIds: string[];
  linkedSchemaIds: string[];
  linkedModeIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BeliefEntry extends OwnedEntity {
  id: string;
  domainId: string;
  schemaId: string | null;
  statement: string;
  beliefType: "absolute" | "conditional";
  originNote: string;
  confidence: number;
  evidenceFor: string[];
  evidenceAgainst: string[];
  flexibleAlternative: string;
  linkedValueIds: string[];
  linkedBehaviorIds: string[];
  linkedModeIds: string[];
  linkedReportIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ModeProfile extends OwnedEntity {
  id: string;
  domainId: string;
  family: "coping" | "child" | "critic_parent" | "healthy_adult" | "happy_child";
  archetype: string;
  title: string;
  persona: string;
  imagery: string;
  symbolicForm: string;
  facialExpression: string;
  fear: string;
  burden: string;
  protectiveJob: string;
  originContext: string;
  firstAppearanceAt: string | null;
  linkedPatternIds: string[];
  linkedBehaviorIds: string[];
  linkedValueIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ModeTimelineEntry {
  id: string;
  stage: string;
  modeId: string | null;
  label: string;
  note: string;
}

export interface ModeGuideAnswer {
  questionKey: string;
  value: string;
}

export interface ModeGuideResult {
  family: "coping" | "child" | "critic_parent" | "healthy_adult" | "happy_child";
  archetype: string;
  label: string;
  confidence: number;
  reasoning: string;
}

export interface ModeGuideSession extends OwnedEntity {
  id: string;
  summary: string;
  answers: ModeGuideAnswer[];
  results: ModeGuideResult[];
  createdAt: string;
  updatedAt: string;
}

export interface Flashcard extends OwnedEntity {
  id: string;
  domainId: string;
  title: string;
  message: string;
  triggerSentence: string;
  triggerSituation: string;
  tags: string[];
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  typography: "serif" | "sans" | "mono" | "display";
  imageUrl: string;
  imageAlt: string;
  layout: "centered" | "top_left" | "image_split" | "poster";
  visualStyle: "calm" | "urgent" | "warm" | "clinical" | "playful";
  linkedValueIds: string[];
  linkedBehaviorIds: string[];
  linkedPatternIds: string[];
  linkedBeliefIds: string[];
  linkedModeIds: string[];
  linkedReportIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TriggerEmotion {
  id: string;
  emotionDefinitionId: string | null;
  label: string;
  intensity: number;
  note: string;
}

export interface TriggerThought {
  id: string;
  text: string;
  parentMode: string;
  criticMode: string;
  beliefId: string | null;
}

export interface TriggerBehavior {
  id: string;
  text: string;
  mode: string;
  behaviorId: string | null;
}

export interface TriggerConsequences {
  selfShortTerm: string[];
  selfLongTerm: string[];
  othersShortTerm: string[];
  othersLongTerm: string[];
}

export interface TriggerReport extends OwnedEntity {
  id: string;
  domainId: string;
  title: string;
  status: "draft" | "reviewed" | "integrated";
  eventTypeId: string | null;
  customEventType: string;
  eventSituation: string;
  occurredAt: string | null;
  emotions: TriggerEmotion[];
  thoughts: TriggerThought[];
  behaviors: TriggerBehavior[];
  consequences: TriggerConsequences;
  linkedPatternIds: string[];
  linkedValueIds: string[];
  linkedGoalIds: string[];
  linkedProjectIds: string[];
  linkedTaskIds: string[];
  linkedBehaviorIds: string[];
  linkedBeliefIds: string[];
  linkedModeIds: string[];
  modeOverlays: string[];
  schemaLinks: string[];
  modeTimeline: ModeTimelineEntry[];
  nextMoves: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SchemaPressureEntry {
  schemaId: string;
  title: string;
  activationCount: number;
}

export interface DevrageMetricPayload {
  generatedAt: string;
  hasData: boolean;
  latestDateKey: string | null;
  rawSwearCount: number;
  swearingMessagePercent: number;
  averageMaxCumulativeRage: number;
  maxCumulativeRage: number;
  maxSwearingStreak: number;
  conversationsScanned: number;
  messagesScanned: number;
  messagesWithSwears: number;
  dailyAverage: {
    rawSwearCount: number;
    swearingMessagePercent: number;
    averageMaxCumulativeRage: number;
    maxCumulativeRage: number;
  };
  weeklyAverage: {
    rawSwearCount: number;
    swearingMessagePercent: number;
    averageMaxCumulativeRage: number;
    maxCumulativeRage: number;
  };
  history: Array<{
    dateKey: string;
    rawSwearCount: number;
    swearingMessagePercent: number;
    averageMaxCumulativeRage: number;
    maxCumulativeRage: number;
    maxSwearingStreak: number;
    conversationsScanned: number;
    messagesScanned: number;
    messagesWithSwears: number;
  }>;
  sync: {
    fullSyncCompletedAt: string | null;
    lastDailySyncAt: string | null;
    lastSyncedDateKey: string | null;
  };
}

export interface PsycheMetricDayRecord {
  dateKey: string;
  average: number | null;
  minimum: number | null;
  maximum: number | null;
  latest: number | null;
  total: number | null;
  sampleCount: number;
  latestSampleAt: string | null;
}

export interface PsycheMetricsViewData {
  summary: {
    hasData: boolean;
    trackedDays: number;
    metricCount: number;
    latestDateKey: string | null;
    latestMetricCount: number;
    categoryBreakdown: Array<{
      category: string;
      metricCount: number;
      coverageDays: number;
    }>;
  };
  context: {
    generatedAt: string;
    conversationsScanned: number;
    sourceCount: number;
    messagesScanned: number;
    messagesWithSwears: number;
    totalSwears: number;
    dailyAverage: {
      rawSwearCount: number;
      swearingMessagePercent: number;
      averageMaxCumulativeRage: number;
      maxCumulativeRage: number;
    };
    weeklyAverage: {
      rawSwearCount: number;
      swearingMessagePercent: number;
      averageMaxCumulativeRage: number;
      maxCumulativeRage: number;
    };
    sync: {
      fullSyncCompletedAt: string | null;
      lastDailySyncAt: string | null;
      lastSyncedDateKey: string | null;
    };
  };
  metrics: Array<{
    metric: string;
    label: string;
    category: string;
    unit: string;
    aggregation: "discrete" | "cumulative";
    latestValue: number | null;
    latestDateKey: string | null;
    baselineValue: number | null;
    deltaValue: number | null;
    coverageDays: number;
    days: PsycheMetricDayRecord[];
  }>;
}

export interface PsycheOverviewPayload {
  generatedAt: string;
  domain: Domain;
  values: PsycheValue[];
  patterns: BehaviorPattern[];
  behaviors: Behavior[];
  beliefs: BeliefEntry[];
  modes: ModeProfile[];
  flashcards: Flashcard[];
  reports: TriggerReport[];
  schemaPressure: SchemaPressureEntry[];
  devrageMetric: DevrageMetricPayload;
  openInsights: number;
  openNotes: number;
  committedActions: string[];
}

export interface TriggerReportDetailPayload {
  report: TriggerReport;
  notes: Note[];
  insights: Insight[];
}

export interface PsycheObservationEntry {
  id: string;
  observedAt: string;
  tags: string[];
  note: Note;
  linkedPatterns: BehaviorPattern[];
  linkedReports: TriggerReport[];
}

export interface PsycheObservationActivityEntry {
  id: string;
  observedAt: string;
  tags: string[];
  event: ActivityEvent;
}

export interface PsycheObservationCalendarPayload {
  generatedAt: string;
  from: string;
  to: string;
  observations: PsycheObservationEntry[];
  activity: PsycheObservationActivityEntry[];
  availableTags: string[];
}

export interface PsycheValueInput {
  title: string;
  description: string;
  valuedDirection: string;
  whyItMatters: string;
  linkedGoalIds: string[];
  linkedProjectIds: string[];
  linkedTaskIds: string[];
  committedActions: string[];
  userId?: string | null;
}

export interface BehaviorPatternInput {
  title: string;
  description: string;
  targetBehavior: string;
  cueContexts: string[];
  shortTermPayoff: string;
  longTermCost: string;
  preferredResponse: string;
  linkedValueIds: string[];
  linkedSchemaLabels: string[];
  linkedModeIds: string[];
  linkedBeliefIds: string[];
  userId?: string | null;
}

export interface BehaviorInput {
  kind: "away" | "committed" | "recovery";
  title: string;
  description: string;
  commonCues: string[];
  urgeStory: string;
  shortTermPayoff: string;
  longTermCost: string;
  replacementMove: string;
  repairPlan: string;
  linkedPatternIds: string[];
  linkedValueIds: string[];
  linkedSchemaIds: string[];
  linkedModeIds: string[];
  userId?: string | null;
}

export interface BeliefEntryInput {
  schemaId: string | null;
  statement: string;
  beliefType: "absolute" | "conditional";
  originNote: string;
  confidence: number;
  evidenceFor: string[];
  evidenceAgainst: string[];
  flexibleAlternative: string;
  linkedValueIds: string[];
  linkedBehaviorIds: string[];
  linkedModeIds: string[];
  linkedReportIds: string[];
  userId?: string | null;
}

export interface ModeProfileInput {
  family: "coping" | "child" | "critic_parent" | "healthy_adult" | "happy_child";
  archetype: string;
  title: string;
  persona: string;
  imagery: string;
  symbolicForm: string;
  facialExpression: string;
  fear: string;
  burden: string;
  protectiveJob: string;
  originContext: string;
  firstAppearanceAt: string | null;
  linkedPatternIds: string[];
  linkedBehaviorIds: string[];
  linkedValueIds: string[];
  userId?: string | null;
}

export interface ModeGuideSessionInput {
  summary: string;
  answers: ModeGuideAnswer[];
  userId?: string | null;
}

export interface EventTypeInput {
  label: string;
  description: string;
  userId?: string | null;
}

export interface EmotionDefinitionInput {
  label: string;
  description: string;
  category: string;
  userId?: string | null;
}

export interface TriggerReportInput {
  title: string;
  status: "draft" | "reviewed" | "integrated";
  eventTypeId: string | null;
  customEventType: string;
  eventSituation: string;
  occurredAt: string | null;
  emotions: TriggerEmotion[];
  thoughts: TriggerThought[];
  behaviors: TriggerBehavior[];
  consequences: TriggerConsequences;
  linkedPatternIds: string[];
  linkedValueIds: string[];
  linkedGoalIds: string[];
  linkedProjectIds: string[];
  linkedTaskIds: string[];
  linkedBehaviorIds: string[];
  linkedBeliefIds: string[];
  linkedModeIds: string[];
  modeOverlays: string[];
  schemaLinks: string[];
  modeTimeline: ModeTimelineEntry[];
  nextMoves: string[];
  userId?: string | null;
}
