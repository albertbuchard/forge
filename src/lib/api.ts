import type {
  AgentAction,
  AgentOnboardingPayload,
  AgentIdentity,
  AgentTokenMutationResult,
  OperatorSession,
  CreateManualRewardGrantInput,
  ApprovalRequest,
  EventLogEntry,
  Goal,
  Habit,
  ForgeSnapshot,
  Insight,
  OperatorOverviewPayload,
  OperatorContextPayload,
  OperatorLogWorkInput,
  OperatorLogWorkResult,
  InsightFeedback,
  InsightsPayload,
  Note,
  Project,
  ProjectBoardPayload,
  ProjectSummary,
  RewardLedgerEvent,
  RewardRule,
  SettingsPayload,
  SettingsBinPayload,
  Tag,
  Task,
  TaskContext,
  TaskRun,
  TaskRunClaimInput,
  TaskRunFinishInput,
  TaskRunHeartbeatInput,
  UpdateRewardRuleInput,
  WeeklyReviewPayload,
  XpMetricsPayload,
  CrudEntityType,
  DeleteMode
} from "./types";
import type {
  Behavior,
  BehaviorInput,
  BehaviorPattern,
  BehaviorPatternInput,
  BeliefEntry,
  BeliefEntryInput,
  Domain,
  EmotionDefinition,
  EmotionDefinitionInput,
  EventType,
  EventTypeInput,
  ModeGuideSession,
  ModeGuideSessionInput,
  ModeProfile,
  ModeProfileInput,
  PsycheOverviewPayload,
  PsycheValue,
  PsycheValueInput,
  SchemaCatalogEntry,
  TriggerReport,
  TriggerReportDetailPayload,
  TriggerReportInput
} from "./psyche-types";
import type {
  CreateAgentTokenInput,
  CreateInsightInput,
  GoalMutationInput,
  HabitMutationInput,
  ProjectMutationInput,
  QuickTaskInput,
  SettingsMutationInput,
  TagMutationInput
} from "./schemas";
import { ForgeApiError, type ForgeValidationIssue } from "./api-error";
import { resolveForgePath } from "./runtime-paths";
import { normalizeForgeSnapshot } from "./snapshot-normalizer";

async function parseResponseBody(response: Response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("x-forge-source", "ui");

  if (init?.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(resolveForgePath(path), {
    credentials: "same-origin",
    headers,
    ...init
  });

  const body = await parseResponseBody(response);

  if (!response.ok) {
    const maybeBody = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
    const details = Array.isArray(maybeBody?.details)
      ? (maybeBody.details as ForgeValidationIssue[])
      : [];
    throw new ForgeApiError({
      status: response.status,
      code:
        typeof maybeBody?.code === "string"
          ? maybeBody.code
          : typeof maybeBody?.error === "string"
            ? maybeBody.error
            : "request_failed",
      message:
        typeof maybeBody?.error === "string"
          ? maybeBody.error
          : typeof maybeBody?.message === "string"
            ? maybeBody.message
            : typeof body === "string"
              ? body
              : `Request failed: ${response.status}`,
      requestPath: path,
      details
    });
  }

  return body as T;
}

export function ensureOperatorSession() {
  return request<{ session: OperatorSession }>("/api/v1/auth/operator-session");
}

export function revokeOperatorSession() {
  return request<{ revoked: boolean }>("/api/v1/auth/operator-session", {
    method: "DELETE"
  });
}

export function getForgeSnapshot() {
  return request<ForgeSnapshot>("/api/v1/context").then(normalizeForgeSnapshot);
}

export function getInsights() {
  return request<{ insights: InsightsPayload }>("/api/v1/insights");
}

export function listDomains() {
  return request<{ domains: Domain[] }>("/api/v1/domains");
}

export function getPsycheOverview() {
  return request<{ overview: PsycheOverviewPayload }>("/api/v1/psyche/overview");
}

export function listPsycheValues() {
  return request<{ values: PsycheValue[] }>("/api/v1/psyche/values");
}

export function getPsycheValue(valueId: string) {
  return request<{ value: PsycheValue }>(`/api/v1/psyche/values/${valueId}`);
}

export function createPsycheValue(input: PsycheValueInput) {
  return request<{ value: PsycheValue }>("/api/v1/psyche/values", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function patchPsycheValue(valueId: string, patch: Partial<PsycheValueInput>) {
  return request<{ value: PsycheValue }>(`/api/v1/psyche/values/${valueId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deletePsycheValue(valueId: string) {
  return request<{ value: PsycheValue }>(`/api/v1/psyche/values/${valueId}`, {
    method: "DELETE"
  });
}

export function listBehaviorPatterns() {
  return request<{ patterns: BehaviorPattern[] }>("/api/v1/psyche/patterns");
}

export function getBehaviorPattern(patternId: string) {
  return request<{ pattern: BehaviorPattern }>(`/api/v1/psyche/patterns/${patternId}`);
}

export function createBehaviorPattern(input: BehaviorPatternInput) {
  return request<{ pattern: BehaviorPattern }>("/api/v1/psyche/patterns", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function patchBehaviorPattern(patternId: string, patch: Partial<BehaviorPatternInput>) {
  return request<{ pattern: BehaviorPattern }>(`/api/v1/psyche/patterns/${patternId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deleteBehaviorPattern(patternId: string) {
  return request<{ pattern: BehaviorPattern }>(`/api/v1/psyche/patterns/${patternId}`, {
    method: "DELETE"
  });
}

export function listBehaviors() {
  return request<{ behaviors: Behavior[] }>("/api/v1/psyche/behaviors");
}

export function getBehavior(behaviorId: string) {
  return request<{ behavior: Behavior }>(`/api/v1/psyche/behaviors/${behaviorId}`);
}

export function createBehavior(input: BehaviorInput) {
  return request<{ behavior: Behavior }>("/api/v1/psyche/behaviors", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function patchBehavior(behaviorId: string, patch: Partial<BehaviorInput>) {
  return request<{ behavior: Behavior }>(`/api/v1/psyche/behaviors/${behaviorId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deleteBehavior(behaviorId: string) {
  return request<{ behavior: Behavior }>(`/api/v1/psyche/behaviors/${behaviorId}`, {
    method: "DELETE"
  });
}

export function listSchemaCatalog() {
  return request<{ schemas: SchemaCatalogEntry[] }>("/api/v1/psyche/schema-catalog");
}

export function listBeliefs() {
  return request<{ beliefs: BeliefEntry[] }>("/api/v1/psyche/beliefs");
}

export function getBelief(beliefId: string) {
  return request<{ belief: BeliefEntry }>(`/api/v1/psyche/beliefs/${beliefId}`);
}

export function createBelief(input: BeliefEntryInput) {
  return request<{ belief: BeliefEntry }>("/api/v1/psyche/beliefs", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function patchBelief(beliefId: string, patch: Partial<BeliefEntryInput>) {
  return request<{ belief: BeliefEntry }>(`/api/v1/psyche/beliefs/${beliefId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deleteBelief(beliefId: string) {
  return request<{ belief: BeliefEntry }>(`/api/v1/psyche/beliefs/${beliefId}`, {
    method: "DELETE"
  });
}

export function listModes() {
  return request<{ modes: ModeProfile[] }>("/api/v1/psyche/modes");
}

export function getMode(modeId: string) {
  return request<{ mode: ModeProfile }>(`/api/v1/psyche/modes/${modeId}`);
}

export function createMode(input: ModeProfileInput) {
  return request<{ mode: ModeProfile }>("/api/v1/psyche/modes", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function patchMode(modeId: string, patch: Partial<ModeProfileInput>) {
  return request<{ mode: ModeProfile }>(`/api/v1/psyche/modes/${modeId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deleteMode(modeId: string) {
  return request<{ mode: ModeProfile }>(`/api/v1/psyche/modes/${modeId}`, {
    method: "DELETE"
  });
}

export function listModeGuideSessions() {
  return request<{ sessions: ModeGuideSession[] }>("/api/v1/psyche/mode-guides");
}

export function getModeGuideSession(sessionId: string) {
  return request<{ session: ModeGuideSession }>(`/api/v1/psyche/mode-guides/${sessionId}`);
}

export function createModeGuideSession(input: ModeGuideSessionInput) {
  return request<{ session: ModeGuideSession }>("/api/v1/psyche/mode-guides", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function patchModeGuideSession(sessionId: string, patch: Partial<ModeGuideSessionInput>) {
  return request<{ session: ModeGuideSession }>(`/api/v1/psyche/mode-guides/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deleteModeGuideSession(sessionId: string) {
  return request<{ session: ModeGuideSession }>(`/api/v1/psyche/mode-guides/${sessionId}`, {
    method: "DELETE"
  });
}

export function listEventTypes() {
  return request<{ eventTypes: EventType[] }>("/api/v1/psyche/event-types");
}

export function getEventType(eventTypeId: string) {
  return request<{ eventType: EventType }>(`/api/v1/psyche/event-types/${eventTypeId}`);
}

export function createEventType(input: EventTypeInput) {
  return request<{ eventType: EventType }>("/api/v1/psyche/event-types", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function patchEventType(eventTypeId: string, patch: Partial<EventTypeInput>) {
  return request<{ eventType: EventType }>(`/api/v1/psyche/event-types/${eventTypeId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deleteEventType(eventTypeId: string) {
  return request<{ eventType: EventType }>(`/api/v1/psyche/event-types/${eventTypeId}`, {
    method: "DELETE"
  });
}

export function listEmotionDefinitions() {
  return request<{ emotions: EmotionDefinition[] }>("/api/v1/psyche/emotions");
}

export function getEmotionDefinition(emotionId: string) {
  return request<{ emotion: EmotionDefinition }>(`/api/v1/psyche/emotions/${emotionId}`);
}

export function createEmotionDefinition(input: EmotionDefinitionInput) {
  return request<{ emotion: EmotionDefinition }>("/api/v1/psyche/emotions", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function patchEmotionDefinition(emotionId: string, patch: Partial<EmotionDefinitionInput>) {
  return request<{ emotion: EmotionDefinition }>(`/api/v1/psyche/emotions/${emotionId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deleteEmotionDefinition(emotionId: string) {
  return request<{ emotion: EmotionDefinition }>(`/api/v1/psyche/emotions/${emotionId}`, {
    method: "DELETE"
  });
}

export function listTriggerReports() {
  return request<{ reports: TriggerReport[] }>("/api/v1/psyche/reports");
}

export function createTriggerReport(input: TriggerReportInput) {
  return request<{ report: TriggerReport }>("/api/v1/psyche/reports", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getTriggerReport(reportId: string) {
  return request<TriggerReportDetailPayload>(`/api/v1/psyche/reports/${reportId}`);
}

export function patchTriggerReport(reportId: string, patch: Partial<TriggerReportInput>) {
  return request<{ report: TriggerReport }>(`/api/v1/psyche/reports/${reportId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deleteTriggerReport(reportId: string) {
  return request<{ report: TriggerReport }>(`/api/v1/psyche/reports/${reportId}`, {
    method: "DELETE"
  });
}

export function listNotes(input: {
  linkedEntityType?: CrudEntityType;
  linkedEntityId?: string;
  anchorKey?: string | null;
  author?: string;
  query?: string;
  limit?: number;
} = {}) {
  const search = new URLSearchParams();
  if (input.linkedEntityType) {
    search.set("linkedEntityType", input.linkedEntityType);
  }
  if (input.linkedEntityId) {
    search.set("linkedEntityId", input.linkedEntityId);
  }
  if (input.anchorKey !== undefined && input.anchorKey !== null) {
    search.set("anchorKey", input.anchorKey);
  }
  if (input.author) {
    search.set("author", input.author);
  }
  if (input.query) {
    search.set("query", input.query);
  }
  if (input.limit) {
    search.set("limit", String(input.limit));
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ notes: Note[] }>(`/api/v1/notes${suffix}`);
}

export function createNote(input: {
  contentMarkdown: string;
  author?: string | null;
  links: Array<{ entityType: CrudEntityType; entityId: string; anchorKey?: string | null }>;
}) {
  return request<{ note: Note }>("/api/v1/notes", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function patchNote(
  noteId: string,
  patch: {
    contentMarkdown?: string;
    author?: string | null;
    links?: Array<{ entityType: CrudEntityType; entityId: string; anchorKey?: string | null }>;
  }
) {
  return request<{ note: Note }>(`/api/v1/notes/${noteId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deleteNote(noteId: string, mode: DeleteMode = "soft") {
  const suffix = mode === "soft" ? "" : `?mode=${mode}`;
  return request<{ note: Note }>(`/api/v1/notes/${noteId}${suffix}`, {
    method: "DELETE"
  });
}

export function createInsight(input: CreateInsightInput) {
  return request<{ insight: Insight }>("/api/v1/insights", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      originAgentId: input.originAgentId || null,
      originLabel: input.originLabel || null,
      entityType: input.entityType || null,
      entityId: input.entityId || null,
      timeframeLabel: input.timeframeLabel || null,
      visibility: "visible",
      status: "open",
      evidence: []
    })
  });
}

export function patchInsight(insightId: string, patch: Partial<Pick<Insight, "status" | "visibility" | "title" | "summary" | "recommendation" | "rationale" | "confidence" | "ctaLabel">>) {
  return request<{ insight: Insight }>(`/api/v1/insights/${insightId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deleteInsight(insightId: string) {
  return request<{ insight: Insight }>(`/api/v1/insights/${insightId}`, {
    method: "DELETE"
  });
}

export function submitInsightFeedback(insightId: string, feedbackType: InsightFeedback["feedbackType"], note = "") {
  return request<{ feedback: InsightFeedback }>(`/api/v1/insights/${insightId}/feedback`, {
    method: "POST",
    body: JSON.stringify({ feedbackType, note })
  });
}

export function getWeeklyReview() {
  return request<{ review: WeeklyReviewPayload }>("/api/v1/reviews/weekly");
}

export function listProjects() {
  return request<{ projects: ProjectSummary[] }>("/api/v1/projects");
}

export function listHabits(input: {
  status?: Habit["status"];
  polarity?: Habit["polarity"];
  dueToday?: boolean;
  limit?: number;
} = {}) {
  const search = new URLSearchParams();
  if (input.status) {
    search.set("status", input.status);
  }
  if (input.polarity) {
    search.set("polarity", input.polarity);
  }
  if (input.dueToday) {
    search.set("dueToday", "true");
  }
  if (input.limit) {
    search.set("limit", String(input.limit));
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ habits: Habit[] }>(`/api/v1/habits${suffix}`);
}

export function createHabit(input: HabitMutationInput) {
  return request<{ habit: Habit }>("/api/v1/habits", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      linkedBehaviorId: input.linkedBehaviorId || null
    })
  });
}

export function patchHabit(habitId: string, patch: Partial<HabitMutationInput>) {
  return request<{ habit: Habit }>(`/api/v1/habits/${habitId}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...patch,
      linkedBehaviorId: patch.linkedBehaviorId === "" ? null : patch.linkedBehaviorId
    })
  });
}

export function deleteHabit(habitId: string) {
  return request<{ habit: Habit }>(`/api/v1/habits/${habitId}`, {
    method: "DELETE"
  });
}

export function createHabitCheckIn(habitId: string, input: { dateKey?: string; status: "done" | "missed"; note?: string }) {
  return request<{ habit: Habit; metrics: XpMetricsPayload }>(`/api/v1/habits/${habitId}/check-ins`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function listTags() {
  return request<{ tags: Tag[] }>("/api/v1/tags");
}

export function getTag(tagId: string) {
  return request<{ tag: Tag }>(`/api/v1/tags/${tagId}`);
}

export function createTag(input: TagMutationInput) {
  return request<{ tag: Tag }>("/api/v1/tags", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function patchTag(tagId: string, patch: Partial<TagMutationInput>) {
  return request<{ tag: Tag }>(`/api/v1/tags/${tagId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deleteTag(tagId: string) {
  return request<{ tag: Tag }>(`/api/v1/tags/${tagId}`, {
    method: "DELETE"
  });
}

export function getGoal(goalId: string) {
  return request<{ goal: Goal }>(`/api/v1/goals/${goalId}`);
}

export function getProject(projectId: string) {
  return request<{ project: ProjectSummary }>(`/api/v1/projects/${projectId}`);
}

export function getProjectBoard(projectId: string) {
  return request<ProjectBoardPayload>(`/api/v1/projects/${projectId}/board`);
}

export function getOperatorContext() {
  return request<{ context: OperatorContextPayload }>("/api/v1/operator/context");
}

export function getOperatorOverview() {
  return request<{ overview: OperatorOverviewPayload }>("/api/v1/operator/overview");
}

export function getSettings() {
  return request<{ settings: SettingsPayload }>("/api/v1/settings");
}

export function getSettingsBin() {
  return request<{ bin: SettingsBinPayload }>("/api/v1/settings/bin");
}

export function listAgents() {
  return request<{ agents: AgentIdentity[] }>("/api/v1/agents");
}

export function getAgentOnboarding() {
  return request<{ onboarding: AgentOnboardingPayload }>("/api/v1/agents/onboarding");
}

export function listAgentActions(agentId: string) {
  return request<{ actions: AgentAction[] }>(`/api/v1/agents/${agentId}/actions`);
}

export function listApprovalRequests() {
  return request<{ approvalRequests: ApprovalRequest[] }>("/api/v1/approval-requests");
}

export function approveApprovalRequest(approvalRequestId: string, note = "") {
  return request<{ approvalRequest: ApprovalRequest }>(`/api/v1/approval-requests/${approvalRequestId}/approve`, {
    method: "POST",
    body: JSON.stringify({ note })
  });
}

export function rejectApprovalRequest(approvalRequestId: string, note = "") {
  return request<{ approvalRequest: ApprovalRequest }>(`/api/v1/approval-requests/${approvalRequestId}/reject`, {
    method: "POST",
    body: JSON.stringify({ note })
  });
}

export function listRewardRules() {
  return request<{ rules: RewardRule[] }>("/api/v1/rewards/rules");
}

export function getRewardRule(ruleId: string) {
  return request<{ rule: RewardRule }>(`/api/v1/rewards/rules/${ruleId}`);
}

export function patchRewardRule(ruleId: string, patch: UpdateRewardRuleInput) {
  return request<{ rule: RewardRule }>(`/api/v1/rewards/rules/${ruleId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function createManualRewardGrant(input: CreateManualRewardGrantInput) {
  return request<{ reward: RewardLedgerEvent; metrics: XpMetricsPayload }>("/api/v1/rewards/bonus", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function listRewardLedger(limit = 50) {
  return request<{ ledger: RewardLedgerEvent[] }>(`/api/v1/rewards/ledger?limit=${limit}`);
}

export function getXpMetrics() {
  return request<{ metrics: XpMetricsPayload }>("/api/v1/metrics/xp");
}

export function listEventLog(limit = 50) {
  return request<{ events: EventLogEntry[] }>(`/api/v1/events?limit=${limit}`);
}

export function patchSettings(input: Partial<SettingsMutationInput>) {
  return request<{ settings: SettingsPayload }>("/api/v1/settings", {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function createEntities(input: {
  operations: Array<{
    entityType: CrudEntityType;
    data: Record<string, unknown>;
    clientRef?: string;
  }>;
  atomic?: boolean;
}) {
  return request<{ results: Array<Record<string, unknown>> }>("/api/v1/entities/create", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateEntities(input: {
  operations: Array<{
    entityType: CrudEntityType;
    id: string;
    patch: Record<string, unknown>;
    clientRef?: string;
  }>;
  atomic?: boolean;
}) {
  return request<{ results: Array<Record<string, unknown>> }>("/api/v1/entities/update", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function deleteEntities(input: {
  operations: Array<{
    entityType: CrudEntityType;
    id: string;
    mode?: DeleteMode;
    reason?: string;
    clientRef?: string;
  }>;
  atomic?: boolean;
}) {
  return request<{ results: Array<Record<string, unknown>> }>("/api/v1/entities/delete", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function restoreEntities(input: {
  operations: Array<{
    entityType: CrudEntityType;
    id: string;
    clientRef?: string;
  }>;
  atomic?: boolean;
}) {
  return request<{ results: Array<Record<string, unknown>> }>("/api/v1/entities/restore", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function searchEntities(input: {
  searches: Array<{
    entityTypes?: CrudEntityType[];
    query?: string;
    ids?: string[];
    status?: string[];
    linkedTo?: { entityType: CrudEntityType; id: string };
    includeDeleted?: boolean;
    limit?: number;
    clientRef?: string;
  }>;
}) {
  return request<{ results: Array<Record<string, unknown>> }>("/api/v1/entities/search", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function createAgentToken(input: CreateAgentTokenInput) {
  return request<{ token: AgentTokenMutationResult }>("/api/v1/settings/tokens", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function createAgentAction(input: {
  actionType: string;
  riskLevel: "low" | "medium" | "high";
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  agentId?: string | null;
  tokenId?: string | null;
}) {
  return request<{ action: AgentAction; approvalRequest: ApprovalRequest | null }>("/api/v1/agent-actions", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function rotateAgentToken(tokenId: string) {
  return request<{ token: AgentTokenMutationResult }>(`/api/v1/settings/tokens/${tokenId}/rotate`, {
    method: "POST"
  });
}

export function revokeAgentToken(tokenId: string) {
  return request<{ token: { id: string } }>(`/api/v1/settings/tokens/${tokenId}/revoke`, {
    method: "POST"
  });
}

export function listActivity(input: {
  limit?: number;
  entityType?: string;
  entityId?: string;
  includeCorrected?: boolean;
} = {}) {
  const search = new URLSearchParams();
  search.set("limit", String(input.limit ?? 100));
  if (input.entityType) {
    search.set("entityType", input.entityType);
  }
  if (input.entityId) {
    search.set("entityId", input.entityId);
  }
  if (input.includeCorrected) {
    search.set("includeCorrected", "true");
  }
  return request<{ activity: ForgeSnapshot["activity"] }>(`/api/v1/activity?${search.toString()}`);
}

export function createGoal(input: GoalMutationInput) {
  return request<{ goal: Goal }>("/api/v1/goals", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function createProject(input: ProjectMutationInput) {
  return request<{ project: Project }>("/api/v1/projects", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function patchProject(projectId: string, patch: Partial<ProjectMutationInput>) {
  return request<{ project: Project }>(`/api/v1/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deleteProject(projectId: string) {
  return request<{ project: Project }>(`/api/v1/projects/${projectId}`, {
    method: "DELETE"
  });
}

export function patchGoal(goalId: string, patch: Partial<GoalMutationInput>) {
  return request<{ goal: Goal }>(`/api/v1/goals/${goalId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deleteGoal(goalId: string) {
  return request<{ goal: Goal }>(`/api/v1/goals/${goalId}`, {
    method: "DELETE"
  });
}

export function createTask(input: QuickTaskInput) {
  const normalized = {
    ...input,
    goalId: input.goalId || null,
    projectId: input.projectId || null,
    dueDate: input.dueDate || null
  };
  return request<{ task: Task }>("/api/v1/tasks", {
    method: "POST",
    body: JSON.stringify(normalized)
  });
}

export function patchTask(taskId: string, patch: Partial<QuickTaskInput> & { status?: string }) {
  return request<{ task: unknown }>(`/api/v1/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...patch,
      goalId: patch.goalId === "" ? null : patch.goalId,
      projectId: patch.projectId === "" ? null : patch.projectId,
      dueDate: patch.dueDate === "" ? null : patch.dueDate
    })
  });
}

export function deleteTask(taskId: string) {
  return request<{ task: unknown }>(`/api/v1/tasks/${taskId}`, {
    method: "DELETE"
  });
}

export function uncompleteTask(taskId: string) {
  return request<{ task: unknown }>(`/api/v1/tasks/${taskId}/uncomplete`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function getTaskContext(taskId: string) {
  return request<TaskContext>(`/api/v1/tasks/${taskId}/context`);
}

export function logOperatorWork(input: OperatorLogWorkInput) {
  return request<OperatorLogWorkResult>("/api/v1/operator/log-work", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function removeActivityLog(eventId: string, reason = "Removed from the visible archive.") {
  return request<{ event: unknown }>(`/api/v1/activity/${eventId}/remove`, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}

export function recordSessionEvent(input: {
  sessionId: string;
  eventType: string;
  metrics: Record<string, string | number | boolean | null>;
}) {
  return request<{ sessionEvent: unknown; rewardEvent: RewardLedgerEvent | null }>("/api/v1/session-events", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function claimTaskRun(taskId: string, input: TaskRunClaimInput) {
  return request<{ taskRun: TaskRun }>(`/api/v1/tasks/${taskId}/runs`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function heartbeatTaskRun(taskRunId: string, input: TaskRunHeartbeatInput) {
  return request<{ taskRun: TaskRun }>(`/api/v1/task-runs/${taskRunId}/heartbeat`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function focusTaskRun(taskRunId: string, input: { actor?: string } = {}) {
  return request<{ taskRun: TaskRun }>(`/api/v1/task-runs/${taskRunId}/focus`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function completeTaskRun(taskRunId: string, input: TaskRunFinishInput) {
  return request<{ taskRun: TaskRun }>(`/api/v1/task-runs/${taskRunId}/complete`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function releaseTaskRun(taskRunId: string, input: TaskRunFinishInput) {
  return request<{ taskRun: TaskRun }>(`/api/v1/task-runs/${taskRunId}/release`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}
