import type {
  DataBackupEntry,
  DataExportFormat,
  DataManagementSettings,
  DataManagementState,
  DataRecoveryCandidate,
  DataRootSwitchMode
} from "./data-management-types";
import type {
  AgentAction,
  AgentOnboardingPayload,
  AgentIdentity,
  AgentTokenMutationResult,
  OperatorSession,
  CreateManualRewardGrantInput,
  ApprovalRequest,
  CalendarAvailability,
  CalendarConnection,
  CalendarDiscoveryPayload,
  MacOSLocalCalendarDiscoveryPayload,
  MacOSCalendarAccessStatus,
  CalendarEvent,
  GoogleCalendarOauthSession,
  MicrosoftCalendarOauthSession,
  CalendarOverviewPayload,
  CalendarResource,
  CalendarSchedulingRules,
  CompanionOverviewPayload,
  DiagnosticLogEntry,
  EventLogEntry,
  FitnessViewData,
  FinalizeWeeklyReviewResult,
  Goal,
  Habit,
  ForgeSnapshot,
  Insight,
  OperatorOverviewPayload,
  OperatorContextPayload,
  OperatorLogWorkInput,
  OperatorLogWorkResult,
  WorkAdjustmentResult,
  InsightFeedback,
  InsightsPayload,
  Note,
  Project,
  ProjectBoardPayload,
  ProjectSummary,
  LifeForcePayload,
  LifeForceProfilePatchInput,
  LifeForceTemplateUpdateInput,
  FatigueSignalInput,
  TaskSplitInput,
  PreferenceContext,
  PreferenceCatalog,
  PreferenceCatalogItem,
  PreferenceCatalogItemMutationInput,
  PreferenceCatalogItemPatchInput,
  PreferenceCatalogMutationInput,
  PreferenceCatalogPatchInput,
  PreferenceContextMergeInput,
  PreferenceContextMutationInput,
  PreferenceContextPatchInput,
  PreferenceGameStartInput,
  PreferenceItem,
  PreferenceItemMutationInput,
  PreferenceItemPatchInput,
  PreferenceScorePatchInput,
  PreferenceSignalInput,
  PreferenceWorkspacePayload,
  PreferenceWorkspaceQuery,
  PairwiseJudgment,
  AbsoluteSignal,
  EnqueuePreferenceEntityInput,
  PreferenceJudgmentInput,
  RewardLedgerEvent,
  RewardRule,
  SettingsPayload,
  SettingsBinPayload,
  MovementAllTimeData,
  MovementDayData,
  MovementKnownPlace,
  MovementMonthData,
  MovementSelectionAggregate,
  MovementSettingsPayload,
  MovementTimelineData,
  MovementUserBoxPreflight,
  MovementTripDetailData,
  ScreenTimeAllTimeData,
  ScreenTimeDayData,
  ScreenTimeMonthData,
  ScreenTimeSettingsPayload,
  Strategy,
  Tag,
  Task,
  TaskTimebox,
  TaskContext,
  TaskRun,
  TaskRunClaimInput,
  TaskRunFinishInput,
  TaskRunHeartbeatInput,
  UpdateRewardRuleInput,
  UserDirectoryPayload,
  UserSummary,
  WeeklyReviewPayload,
  WikiEmbeddingProfile,
  WikiHealthPayload,
  WikiIngestJobPayload,
  WikiLlmConnectionTestResult,
  WikiPageDetailPayload,
  WikiSearchResponse,
  WikiSettingsPayload,
  WikiSpace,
  WikiTreeNode,
  SleepViewData,
  WorkBlockTemplate,
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
  PsycheObservationCalendarPayload,
  PsycheValue,
  PsycheValueInput,
  SchemaCatalogEntry,
  TriggerReport,
  TriggerReportDetailPayload,
  TriggerReportInput
} from "./psyche-types";
import type {
  CreateQuestionnaireInstrumentInput,
  QuestionnaireInstrumentDetail,
  QuestionnaireInstrumentSummary,
  QuestionnaireRunDetail,
  QuestionnaireAnswerInput,
  UpdateQuestionnaireVersionInput
} from "./questionnaire-types";
import type {
  KnowledgeGraphEntityType,
  KnowledgeGraphFocusPayload,
  KnowledgeGraphPayload,
  KnowledgeGraphQuery
} from "./knowledge-graph-types";
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
import {
  dedupeCalendarDiscoveryPayload,
  dedupeCalendarOverviewPayload
} from "./calendar-name-deduper";
import { publishUiDiagnosticLog } from "./diagnostics";
import { resolveForgePath } from "./runtime-paths";
import { normalizeForgeSnapshot } from "./snapshot-normalizer";

function normalizeCalendarEventPlace(event: CalendarEvent): CalendarEvent {
  const fallbackLocation =
    typeof event.location === "string" ? event.location : "";
  const place = event.place ?? {
    label: fallbackLocation,
    address: "",
    timezone: "",
    latitude: null,
    longitude: null,
    source: "",
    externalPlaceId: ""
  };
  return {
    ...event,
    place: {
      label: place.label || fallbackLocation,
      address: place.address ?? "",
      timezone: place.timezone ?? "",
      latitude: place.latitude ?? null,
      longitude: place.longitude ?? null,
      source: place.source ?? "",
      externalPlaceId: place.externalPlaceId ?? ""
    }
  };
}

function normalizeCalendarOverviewPayload(
  payload: CalendarOverviewPayload
): CalendarOverviewPayload {
  return {
    ...dedupeCalendarOverviewPayload(payload),
    events: payload.events.map(normalizeCalendarEventPlace)
  };
}

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

  if (
    init?.body !== undefined &&
    !(typeof FormData !== "undefined" && init.body instanceof FormData) &&
    !headers.has("content-type")
  ) {
    headers.set("content-type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(resolveForgePath(path), {
      credentials: "same-origin",
      headers,
      ...init
    });
  } catch (error) {
    if (path !== "/api/v1/diagnostics/logs") {
      void publishUiDiagnosticLog({
        level: "error",
        scope: "frontend_api",
        eventKey: "request_network_failure",
        message: `API request failed before reaching Forge: ${path}`,
        route: path,
        functionName: "request",
        details: {
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack ?? null
                }
              : String(error)
        }
      });
    }
    throw error;
  }

  const body = await parseResponseBody(response);

  if (!response.ok) {
    const maybeBody =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : null;
    const details = Array.isArray(maybeBody?.details)
      ? (maybeBody.details as ForgeValidationIssue[])
      : [];
    if (path !== "/api/v1/diagnostics/logs") {
      void publishUiDiagnosticLog({
        level: response.status >= 500 ? "error" : "warning",
        scope: "frontend_api",
        eventKey: "request_failed",
        message: `API request failed: ${path}`,
        route: path,
        functionName: "request",
        details: {
          statusCode: response.status,
          code:
            typeof maybeBody?.code === "string"
              ? maybeBody.code
              : typeof maybeBody?.error === "string"
                ? maybeBody.error
                : "request_failed",
          response:
            typeof body === "string"
              ? body
              : body && typeof body === "object"
                ? body
                : null,
          validationIssues: details
        }
      });
    }
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
      details,
      response:
        typeof body === "string"
          ? body
          : body && typeof body === "object"
            ? (body as Record<string, unknown>)
            : null
    });
  }

  return body as T;
}

async function requestBlob(
  path: string,
  init?: RequestInit
): Promise<{ blob: Blob; fileName: string | null; mimeType: string }> {
  const headers = new Headers(init?.headers);
  headers.set("x-forge-source", "ui");
  const response = await fetch(resolveForgePath(path), {
    credentials: "same-origin",
    headers,
    ...init
  });
  if (!response.ok) {
    const body = await parseResponseBody(response);
    const maybeBody =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : null;
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
            : `Request failed: ${response.status}`,
      requestPath: path,
      details: [],
      response:
        typeof body === "string"
          ? body
          : body && typeof body === "object"
            ? (body as Record<string, unknown>)
            : null
    });
  }
  const disposition = response.headers.get("content-disposition");
  const fileNameMatch = disposition?.match(/filename=\"([^\"]+)\"/i);
  return {
    blob: await response.blob(),
    fileName: fileNameMatch?.[1] ?? null,
    mimeType: response.headers.get("content-type") || "application/octet-stream"
  };
}

function normalizeNestedNotes(
  notes: Array<{ contentMarkdown: string; author: string }>
) {
  return notes
    .map((note) => ({
      contentMarkdown: note.contentMarkdown.trim(),
      author: note.author.trim() || null
    }))
    .filter((note) => note.contentMarkdown.length > 0);
}

const USER_SCOPE_STORAGE_KEY = "forge.selected-user-ids";

function readStoredUserIds(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(USER_SCOPE_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function resolveScopedUserIds(userIds?: string[]) {
  return userIds ?? readStoredUserIds();
}

function coerceUserIds(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : undefined;
}

function appendUserIds(search: URLSearchParams, userIds?: string[]) {
  for (const userId of resolveScopedUserIds(userIds)) {
    if (userId.trim()) {
      search.append("userIds", userId.trim());
    }
  }
}

export function ensureOperatorSession() {
  return request<{ session: OperatorSession }>("/api/v1/auth/operator-session");
}

export function revokeOperatorSession() {
  return request<{ revoked: boolean }>("/api/v1/auth/operator-session", {
    method: "DELETE"
  });
}

export function getForgeSnapshot(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<ForgeSnapshot>(`/api/v1/context${suffix}`).then(
    normalizeForgeSnapshot
  );
}

export function getLifeForce(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{
    lifeForce: LifeForcePayload;
    templates: Array<{
      weekday: number;
      baselineDailyAp: number;
      points: LifeForcePayload["currentCurve"];
    }>;
  }>(`/api/v1/life-force${suffix}`);
}

export function patchLifeForceProfile(
  patch: LifeForceProfilePatchInput,
  userIds?: string[] | unknown
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ lifeForce: LifeForcePayload }>(
    `/api/v1/life-force/profile${suffix}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function updateLifeForceTemplate(
  weekday: number,
  input: LifeForceTemplateUpdateInput,
  userIds?: string[] | unknown
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ weekday: number; points: LifeForcePayload["currentCurve"] }>(
    `/api/v1/life-force/templates/${weekday}${suffix}`,
    {
      method: "PUT",
      body: JSON.stringify(input)
    }
  );
}

export function createFatigueSignal(
  input: FatigueSignalInput,
  userIds?: string[] | unknown
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ lifeForce: LifeForcePayload }>(
    `/api/v1/life-force/fatigue-signals${suffix}`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function getKnowledgeGraph(
  userIds?: string[] | unknown,
  query?: KnowledgeGraphQuery
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  if (query?.q?.trim()) {
    search.set("q", query.q.trim());
  }
  for (const kind of query?.entityKinds ?? []) {
    search.append("entityKind", kind);
  }
  for (const relationKind of query?.relationKinds ?? []) {
    search.append("relationKind", relationKind);
  }
  for (const tag of query?.tags ?? []) {
    search.append("tag", tag);
  }
  for (const owner of query?.owners ?? []) {
    search.append("owner", owner);
  }
  if (query?.updatedFrom) {
    search.set("updatedFrom", query.updatedFrom);
  }
  if (query?.updatedTo) {
    search.set("updatedTo", query.updatedTo);
  }
  if (typeof query?.limit === "number" && Number.isFinite(query.limit)) {
    search.set("limit", String(query.limit));
  }
  if (query?.focusNodeId) {
    search.set("focusNodeId", query.focusNodeId);
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ graph: KnowledgeGraphPayload }>(
    `/api/v1/knowledge-graph${suffix}`
  ).then((response) => response.graph);
}

export function getKnowledgeGraphFocus(
  entityType: KnowledgeGraphEntityType,
  entityId: string,
  userIds?: string[] | unknown
) {
  const search = new URLSearchParams();
  search.set("entityType", entityType);
  search.set("entityId", entityId);
  appendUserIds(search, coerceUserIds(userIds));
  return request<{ focus: KnowledgeGraphFocusPayload }>(
    `/api/v1/knowledge-graph/focus?${search.toString()}`
  ).then((response) => response.focus);
}

export function getPreferenceWorkspace(query: PreferenceWorkspaceQuery) {
  const search = new URLSearchParams();
  if (query.userId) {
    search.set("userId", query.userId);
  }
  if (query.domain) {
    search.set("domain", query.domain);
  }
  if (query.contextId) {
    search.set("contextId", query.contextId);
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ workspace: PreferenceWorkspacePayload }>(
    `/api/v1/preferences/workspace${suffix}`
  );
}

export function startPreferenceGame(input: PreferenceGameStartInput) {
  return request<{ workspace: PreferenceWorkspacePayload }>(
    "/api/v1/preferences/game/start",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function createPreferenceCatalog(input: PreferenceCatalogMutationInput) {
  return request<{ catalog: PreferenceCatalog }>(
    "/api/v1/preferences/catalogs",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function patchPreferenceCatalog(
  catalogId: string,
  patch: PreferenceCatalogPatchInput
) {
  return request<{ catalog: PreferenceCatalog }>(
    `/api/v1/preferences/catalogs/${catalogId}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function deletePreferenceCatalog(catalogId: string) {
  return request<{ catalog: PreferenceCatalog }>(
    `/api/v1/preferences/catalogs/${catalogId}`,
    {
      method: "DELETE"
    }
  );
}

export function createPreferenceCatalogItem(
  input: PreferenceCatalogItemMutationInput
) {
  return request<{ item: PreferenceCatalogItem }>(
    "/api/v1/preferences/catalog-items",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function patchPreferenceCatalogItem(
  catalogItemId: string,
  patch: PreferenceCatalogItemPatchInput
) {
  return request<{ item: PreferenceCatalogItem }>(
    `/api/v1/preferences/catalog-items/${catalogItemId}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function deletePreferenceCatalogItem(catalogItemId: string) {
  return request<{ item: PreferenceCatalogItem }>(
    `/api/v1/preferences/catalog-items/${catalogItemId}`,
    {
      method: "DELETE"
    }
  );
}

export function createPreferenceContext(input: PreferenceContextMutationInput) {
  return request<{ context: PreferenceContext }>(
    "/api/v1/preferences/contexts",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function patchPreferenceContext(
  contextId: string,
  patch: PreferenceContextPatchInput
) {
  return request<{ context: PreferenceContext }>(
    `/api/v1/preferences/contexts/${contextId}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function mergePreferenceContexts(input: PreferenceContextMergeInput) {
  return request<{
    merge: { source: PreferenceContext; target: PreferenceContext };
  }>("/api/v1/preferences/contexts/merge", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function createPreferenceItem(input: PreferenceItemMutationInput) {
  return request<{ item: PreferenceItem }>("/api/v1/preferences/items", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function patchPreferenceItem(
  itemId: string,
  patch: PreferenceItemPatchInput
) {
  return request<{ item: PreferenceItem }>(
    `/api/v1/preferences/items/${itemId}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function enqueuePreferenceEntity(input: EnqueuePreferenceEntityInput) {
  return request<{ item: PreferenceItem }>(
    "/api/v1/preferences/items/from-entity",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function submitPairwisePreferenceJudgment(
  input: PreferenceJudgmentInput
) {
  return request<{ judgment: PairwiseJudgment }>(
    "/api/v1/preferences/judgments",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function submitPreferenceSignal(input: PreferenceSignalInput) {
  return request<{ signal: AbsoluteSignal }>("/api/v1/preferences/signals", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function patchPreferenceScore(
  itemId: string,
  patch: PreferenceScorePatchInput
) {
  return request<{ workspace: PreferenceWorkspacePayload }>(
    `/api/v1/preferences/items/${itemId}/score`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function getInsights(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ insights: InsightsPayload }>(`/api/v1/insights${suffix}`);
}

export function listDomains() {
  return request<{ domains: Domain[] }>("/api/v1/domains");
}

export function getPsycheOverview(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ overview: PsycheOverviewPayload }>(
    `/api/v1/psyche/overview${suffix}`
  );
}

export function listQuestionnaires(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ instruments: QuestionnaireInstrumentSummary[] }>(
    `/api/v1/psyche/questionnaires${suffix}`
  );
}

export function getQuestionnaire(instrumentId: string, userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ instrument: QuestionnaireInstrumentDetail }>(
    `/api/v1/psyche/questionnaires/${instrumentId}${suffix}`
  );
}

export function createQuestionnaire(input: CreateQuestionnaireInstrumentInput) {
  return request<{ instrument: QuestionnaireInstrumentDetail }>(
    "/api/v1/psyche/questionnaires",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function cloneQuestionnaire(
  instrumentId: string,
  input: { userId?: string | null } = {}
) {
  return request<{ instrument: QuestionnaireInstrumentDetail }>(
    `/api/v1/psyche/questionnaires/${instrumentId}/clone`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function ensureQuestionnaireDraft(instrumentId: string) {
  return request<{ instrument: QuestionnaireInstrumentDetail }>(
    `/api/v1/psyche/questionnaires/${instrumentId}/draft`,
    {
      method: "POST",
      body: JSON.stringify({})
    }
  );
}

export function updateQuestionnaireDraft(
  instrumentId: string,
  input: UpdateQuestionnaireVersionInput
) {
  return request<{ instrument: QuestionnaireInstrumentDetail }>(
    `/api/v1/psyche/questionnaires/${instrumentId}/draft`,
    {
      method: "PATCH",
      body: JSON.stringify(input)
    }
  );
}

export function publishQuestionnaireDraft(
  instrumentId: string,
  input: { label?: string } = {}
) {
  return request<{ instrument: QuestionnaireInstrumentDetail }>(
    `/api/v1/psyche/questionnaires/${instrumentId}/publish`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function startQuestionnaireRun(
  instrumentId: string,
  input: { versionId?: string | null; userId?: string | null } = {}
) {
  return request<QuestionnaireRunDetail>(
    `/api/v1/psyche/questionnaires/${instrumentId}/runs`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function getQuestionnaireRun(runId: string, userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<QuestionnaireRunDetail>(
    `/api/v1/psyche/questionnaire-runs/${runId}${suffix}`
  );
}

export function patchQuestionnaireRun(
  runId: string,
  input: {
    answers?: QuestionnaireAnswerInput[];
    progressIndex?: number | null;
  }
) {
  return request<QuestionnaireRunDetail>(
    `/api/v1/psyche/questionnaire-runs/${runId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input)
    }
  );
}

export function completeQuestionnaireAssessment(runId: string) {
  return request<QuestionnaireRunDetail>(
    `/api/v1/psyche/questionnaire-runs/${runId}/complete`,
    {
      method: "POST",
      body: JSON.stringify({})
    }
  );
}

export function listPsycheValues(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ values: PsycheValue[] }>(`/api/v1/psyche/values${suffix}`);
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

export function patchPsycheValue(
  valueId: string,
  patch: Partial<PsycheValueInput>
) {
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

export function listBehaviorPatterns(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ patterns: BehaviorPattern[] }>(
    `/api/v1/psyche/patterns${suffix}`
  );
}

export function getBehaviorPattern(patternId: string) {
  return request<{ pattern: BehaviorPattern }>(
    `/api/v1/psyche/patterns/${patternId}`
  );
}

export function createBehaviorPattern(input: BehaviorPatternInput) {
  return request<{ pattern: BehaviorPattern }>("/api/v1/psyche/patterns", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function patchBehaviorPattern(
  patternId: string,
  patch: Partial<BehaviorPatternInput>
) {
  return request<{ pattern: BehaviorPattern }>(
    `/api/v1/psyche/patterns/${patternId}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function deleteBehaviorPattern(patternId: string) {
  return request<{ pattern: BehaviorPattern }>(
    `/api/v1/psyche/patterns/${patternId}`,
    {
      method: "DELETE"
    }
  );
}

export function listBehaviors(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ behaviors: Behavior[] }>(
    `/api/v1/psyche/behaviors${suffix}`
  );
}

export function getBehavior(behaviorId: string) {
  return request<{ behavior: Behavior }>(
    `/api/v1/psyche/behaviors/${behaviorId}`
  );
}

export function createBehavior(input: BehaviorInput) {
  return request<{ behavior: Behavior }>("/api/v1/psyche/behaviors", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function patchBehavior(
  behaviorId: string,
  patch: Partial<BehaviorInput>
) {
  return request<{ behavior: Behavior }>(
    `/api/v1/psyche/behaviors/${behaviorId}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function deleteBehavior(behaviorId: string) {
  return request<{ behavior: Behavior }>(
    `/api/v1/psyche/behaviors/${behaviorId}`,
    {
      method: "DELETE"
    }
  );
}

export function listSchemaCatalog() {
  return request<{ schemas: SchemaCatalogEntry[] }>(
    "/api/v1/psyche/schema-catalog"
  );
}

export function listBeliefs(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ beliefs: BeliefEntry[] }>(`/api/v1/psyche/beliefs${suffix}`);
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

export function patchBelief(
  beliefId: string,
  patch: Partial<BeliefEntryInput>
) {
  return request<{ belief: BeliefEntry }>(
    `/api/v1/psyche/beliefs/${beliefId}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function deleteBelief(beliefId: string) {
  return request<{ belief: BeliefEntry }>(
    `/api/v1/psyche/beliefs/${beliefId}`,
    {
      method: "DELETE"
    }
  );
}

export function listModes(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ modes: ModeProfile[] }>(`/api/v1/psyche/modes${suffix}`);
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
  return request<{ sessions: ModeGuideSession[] }>(
    "/api/v1/psyche/mode-guides"
  );
}

export function getModeGuideSession(sessionId: string) {
  return request<{ session: ModeGuideSession }>(
    `/api/v1/psyche/mode-guides/${sessionId}`
  );
}

export function createModeGuideSession(input: ModeGuideSessionInput) {
  return request<{ session: ModeGuideSession }>("/api/v1/psyche/mode-guides", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function patchModeGuideSession(
  sessionId: string,
  patch: Partial<ModeGuideSessionInput>
) {
  return request<{ session: ModeGuideSession }>(
    `/api/v1/psyche/mode-guides/${sessionId}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function deleteModeGuideSession(sessionId: string) {
  return request<{ session: ModeGuideSession }>(
    `/api/v1/psyche/mode-guides/${sessionId}`,
    {
      method: "DELETE"
    }
  );
}

export function listEventTypes() {
  return request<{ eventTypes: EventType[] }>("/api/v1/psyche/event-types");
}

export function getEventType(eventTypeId: string) {
  return request<{ eventType: EventType }>(
    `/api/v1/psyche/event-types/${eventTypeId}`
  );
}

export function createEventType(input: EventTypeInput) {
  return request<{ eventType: EventType }>("/api/v1/psyche/event-types", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function patchEventType(
  eventTypeId: string,
  patch: Partial<EventTypeInput>
) {
  return request<{ eventType: EventType }>(
    `/api/v1/psyche/event-types/${eventTypeId}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function deleteEventType(eventTypeId: string) {
  return request<{ eventType: EventType }>(
    `/api/v1/psyche/event-types/${eventTypeId}`,
    {
      method: "DELETE"
    }
  );
}

export function listEmotionDefinitions() {
  return request<{ emotions: EmotionDefinition[] }>("/api/v1/psyche/emotions");
}

export function getEmotionDefinition(emotionId: string) {
  return request<{ emotion: EmotionDefinition }>(
    `/api/v1/psyche/emotions/${emotionId}`
  );
}

export function createEmotionDefinition(input: EmotionDefinitionInput) {
  return request<{ emotion: EmotionDefinition }>("/api/v1/psyche/emotions", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function patchEmotionDefinition(
  emotionId: string,
  patch: Partial<EmotionDefinitionInput>
) {
  return request<{ emotion: EmotionDefinition }>(
    `/api/v1/psyche/emotions/${emotionId}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function deleteEmotionDefinition(emotionId: string) {
  return request<{ emotion: EmotionDefinition }>(
    `/api/v1/psyche/emotions/${emotionId}`,
    {
      method: "DELETE"
    }
  );
}

export function listTriggerReports(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ reports: TriggerReport[] }>(
    `/api/v1/psyche/reports${suffix}`
  );
}

export function createTriggerReport(input: TriggerReportInput) {
  return request<{ report: TriggerReport }>("/api/v1/psyche/reports", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getTriggerReport(reportId: string) {
  return request<TriggerReportDetailPayload>(
    `/api/v1/psyche/reports/${reportId}`
  );
}

export function patchTriggerReport(
  reportId: string,
  patch: Partial<TriggerReportInput>
) {
  return request<{ report: TriggerReport }>(
    `/api/v1/psyche/reports/${reportId}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function deleteTriggerReport(reportId: string) {
  return request<{ report: TriggerReport }>(
    `/api/v1/psyche/reports/${reportId}`,
    {
      method: "DELETE"
    }
  );
}

export function listNotes(
  input: {
    linkedEntityType?: CrudEntityType;
    linkedEntityId?: string;
    anchorKey?: string | null;
    linkedTo?: Array<{
      entityType: CrudEntityType;
      entityId: string;
    }>;
    tags?: string[];
    textTerms?: string[];
    author?: string;
    query?: string;
    userIds?: string[];
    updatedFrom?: string;
    updatedTo?: string;
    limit?: number;
  } = {}
) {
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
  for (const link of input.linkedTo ?? []) {
    search.append("linkedTo", `${link.entityType}:${link.entityId}`);
  }
  for (const tag of input.tags ?? []) {
    if (tag.trim()) {
      search.append("tags", tag.trim());
    }
  }
  for (const term of input.textTerms ?? []) {
    if (term.trim()) {
      search.append("textTerms", term.trim());
    }
  }
  if (input.author) {
    search.set("author", input.author);
  }
  if (input.query) {
    search.set("query", input.query);
  }
  appendUserIds(search, input.userIds);
  if (input.updatedFrom) {
    search.set("updatedFrom", input.updatedFrom);
  }
  if (input.updatedTo) {
    search.set("updatedTo", input.updatedTo);
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
  tags?: string[];
  destroyAt?: string | null;
  frontmatter?: Record<string, unknown>;
  userId?: string | null;
  links: Array<{
    entityType: CrudEntityType;
    entityId: string;
    anchorKey?: string | null;
  }>;
}) {
  return request<{ note: Note }>("/api/v1/notes", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getNote(noteId: string) {
  return request<{ note: Note }>(`/api/v1/notes/${noteId}`);
}

export function patchNote(
  noteId: string,
  patch: {
    contentMarkdown?: string;
    author?: string | null;
    tags?: string[];
    destroyAt?: string | null;
    frontmatter?: Record<string, unknown>;
    userId?: string | null;
    links?: Array<{
      entityType: CrudEntityType;
      entityId: string;
      anchorKey?: string | null;
    }>;
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

export function getWikiSettings() {
  return request<{ settings: WikiSettingsPayload }>("/api/v1/wiki/settings");
}

export function createWikiSpace(input: {
  label: string;
  slug?: string;
  description?: string;
  ownerUserId?: string | null;
  visibility?: "personal" | "shared";
}) {
  return request<{ space: WikiSpace }>("/api/v1/wiki/spaces", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function listWikiSpaces() {
  return request<{ spaces: WikiSpace[] }>("/api/v1/wiki/spaces");
}

export function listWikiPages(
  input: {
    spaceId?: string;
    kind?: Note["kind"];
    limit?: number;
  } = {}
) {
  const search = new URLSearchParams();
  if (input.spaceId) {
    search.set("spaceId", input.spaceId);
  }
  if (input.kind) {
    search.set("kind", input.kind);
  }
  if (input.limit) {
    search.set("limit", String(input.limit));
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ pages: Note[] }>(`/api/v1/wiki/pages${suffix}`);
}

export function getWikiPage(pageId: string) {
  return request<WikiPageDetailPayload>(`/api/v1/wiki/pages/${pageId}`);
}

export function getWikiHome(input: { spaceId?: string } = {}) {
  const search = new URLSearchParams();
  if (input.spaceId?.trim()) {
    search.set("spaceId", input.spaceId.trim());
  }
  return request<WikiPageDetailPayload>(
    `/api/v1/wiki/home${search.size > 0 ? `?${search.toString()}` : ""}`
  );
}

export function getWikiPageBySlug(input: { slug: string; spaceId?: string }) {
  const search = new URLSearchParams();
  if (input.spaceId?.trim()) {
    search.set("spaceId", input.spaceId.trim());
  }
  return request<WikiPageDetailPayload>(
    `/api/v1/wiki/by-slug/${encodeURIComponent(input.slug)}${
      search.size > 0 ? `?${search.toString()}` : ""
    }`
  );
}

export function getWikiTree(
  input: {
    spaceId?: string;
    kind?: Note["kind"];
  } = {}
) {
  const search = new URLSearchParams();
  if (input.spaceId?.trim()) {
    search.set("spaceId", input.spaceId.trim());
  }
  if (input.kind) {
    search.set("kind", input.kind);
  }
  return request<{ tree: WikiTreeNode[] }>(
    `/api/v1/wiki/tree${search.size > 0 ? `?${search.toString()}` : ""}`
  );
}

export function createWikiPage(input: {
  kind?: Note["kind"];
  title: string;
  slug?: string;
  parentSlug?: string | null;
  indexOrder?: number;
  showInIndex?: boolean;
  aliases?: string[];
  summary?: string;
  contentMarkdown: string;
  author?: string | null;
  tags?: string[];
  spaceId?: string;
  frontmatter?: Record<string, unknown>;
  links?: Array<{
    entityType: CrudEntityType;
    entityId: string;
    anchorKey?: string | null;
  }>;
}) {
  return request<WikiPageDetailPayload>("/api/v1/wiki/pages", {
    method: "POST",
    body: JSON.stringify({
      kind: input.kind ?? "wiki",
      title: input.title,
      slug: input.slug ?? "",
      parentSlug: input.parentSlug ?? null,
      indexOrder: input.indexOrder ?? 0,
      showInIndex: input.showInIndex ?? true,
      aliases: input.aliases ?? [],
      summary: input.summary ?? "",
      contentMarkdown: input.contentMarkdown,
      author: input.author ?? null,
      tags: input.tags ?? [],
      spaceId: input.spaceId ?? "",
      frontmatter: input.frontmatter ?? {},
      links: input.links ?? []
    })
  });
}

export function patchWikiPage(
  pageId: string,
  patch: {
    kind?: Note["kind"];
    title?: string;
    slug?: string;
    parentSlug?: string | null;
    indexOrder?: number;
    showInIndex?: boolean;
    aliases?: string[];
    summary?: string;
    contentMarkdown?: string;
    author?: string | null;
    tags?: string[];
    spaceId?: string;
    frontmatter?: Record<string, unknown>;
    links?: Array<{
      entityType: CrudEntityType;
      entityId: string;
      anchorKey?: string | null;
    }>;
  }
) {
  return request<WikiPageDetailPayload>(`/api/v1/wiki/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deleteWikiPage(pageId: string, mode: DeleteMode = "soft") {
  const search = new URLSearchParams();
  search.set("mode", mode);
  return request<{ deleted: { id: string } }>(
    `/api/v1/wiki/pages/${pageId}?${search.toString()}`,
    {
      method: "DELETE"
    }
  );
}

export function searchWiki(input: {
  spaceId?: string;
  kind?: Note["kind"];
  mode?: "text" | "semantic" | "entity" | "hybrid";
  query?: string;
  profileId?: string;
  linkedEntity?: {
    entityType: CrudEntityType;
    entityId: string;
  };
  limit?: number;
}) {
  return request<WikiSearchResponse>("/api/v1/wiki/search", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getWikiHealth(input: { spaceId?: string } = {}) {
  const search = new URLSearchParams();
  if (input.spaceId?.trim()) {
    search.set("spaceId", input.spaceId.trim());
  }
  return request<{ health: WikiHealthPayload }>(
    `/api/v1/wiki/health${search.size > 0 ? `?${search.toString()}` : ""}`
  );
}

export function syncWikiVault(input: { spaceId?: string } = {}) {
  return request<{ updated: number }>("/api/v1/wiki/sync", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function reindexWiki(
  input: { spaceId?: string; profileId?: string } = {}
) {
  return request<{
    profilesIndexed: number;
    pagesIndexed: number;
    chunkCount: number;
  }>("/api/v1/wiki/reindex", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function createWikiLlmProfile(input: {
  id?: string;
  label: string;
  provider?: string;
  baseUrl?: string;
  model: string;
  apiKey?: string;
  systemPrompt?: string;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
  verbosity?: "low" | "medium" | "high";
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}) {
  return request<{ profile: import("./types").WikiLlmProfile }>(
    "/api/v1/wiki/settings/llm-profiles",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function testWikiLlmProfile(input: {
  profileId?: string;
  provider?: string;
  baseUrl?: string;
  model: string;
  apiKey?: string;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
  verbosity?: "low" | "medium" | "high";
}) {
  return request<{ result: WikiLlmConnectionTestResult }>(
    "/api/v1/wiki/settings/llm-profiles/test",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function createWikiEmbeddingProfile(input: {
  id?: string;
  label: string;
  provider?: string;
  baseUrl?: string;
  model?: string;
  dimensions?: number | null;
  chunkSize?: number;
  chunkOverlap?: number;
  apiKey?: string;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}) {
  return request<{ profile: WikiEmbeddingProfile }>(
    "/api/v1/wiki/settings/embedding-profiles",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function deleteWikiProfile(
  kind: "llm" | "embedding",
  profileId: string
) {
  return request<null>(`/api/v1/wiki/settings/${kind}-profiles/${profileId}`, {
    method: "DELETE"
  });
}

export function createWikiIngestJob(input: {
  spaceId?: string;
  titleHint?: string;
  sourceKind: "raw_text" | "local_path" | "url";
  sourceText?: string;
  sourcePath?: string;
  sourceUrl?: string;
  mimeType?: string;
  llmProfileId?: string;
  parseStrategy?: "auto" | "text_only" | "multimodal";
  entityProposalMode?: "none" | "suggest";
  userId?: string | null;
  createAsKind?: Note["kind"];
  linkedEntityHints?: Array<{
    entityType: CrudEntityType;
    entityId: string;
    anchorKey?: string | null;
  }>;
}) {
  return request<{
    job: WikiIngestJobPayload | null;
    page: Note | null;
  }>("/api/v1/wiki/ingest-jobs", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function createWikiIngestUploadJob(input: {
  spaceId?: string;
  titleHint?: string;
  llmProfileId?: string;
  parseStrategy?: "auto" | "text_only" | "multimodal";
  entityProposalMode?: "none" | "suggest";
  createAsKind?: Note["kind"];
  linkedEntityHints?: Array<{
    entityType: CrudEntityType;
    entityId: string;
    anchorKey?: string | null;
  }>;
  files: File[];
}) {
  const formData = new FormData();
  if (input.spaceId?.trim()) {
    formData.set("spaceId", input.spaceId.trim());
  }
  if (input.titleHint?.trim()) {
    formData.set("titleHint", input.titleHint.trim());
  }
  if (input.llmProfileId?.trim()) {
    formData.set("llmProfileId", input.llmProfileId.trim());
  }
  formData.set("parseStrategy", input.parseStrategy ?? "auto");
  formData.set("entityProposalMode", input.entityProposalMode ?? "suggest");
  formData.set("createAsKind", input.createAsKind ?? "wiki");
  formData.set(
    "linkedEntityHints",
    JSON.stringify(input.linkedEntityHints ?? [])
  );
  input.files.forEach((file) => {
    formData.append("files", file);
  });
  return request<{
    job: WikiIngestJobPayload | null;
    page: Note | null;
  }>("/api/v1/wiki/ingest-jobs/uploads", {
    method: "POST",
    body: formData
  });
}

export function listWikiIngestJobs(
  input: {
    spaceId?: string;
    limit?: number;
  } = {}
) {
  const search = new URLSearchParams();
  if (input.spaceId?.trim()) {
    search.set("spaceId", input.spaceId.trim());
  }
  if (typeof input.limit === "number") {
    search.set("limit", String(input.limit));
  }
  return request<{ jobs: WikiIngestJobPayload[] }>(
    `/api/v1/wiki/ingest-jobs${search.size > 0 ? `?${search.toString()}` : ""}`
  );
}

export function getWikiIngestJob(jobId: string) {
  return request<WikiIngestJobPayload>(`/api/v1/wiki/ingest-jobs/${jobId}`);
}

export function searchWikiPages(input: {
  spaceId?: string;
  kind?: "wiki" | "evidence";
  mode?: "text" | "semantic" | "entity" | "hybrid";
  query?: string;
  profileId?: string;
  limit?: number;
}) {
  return request<WikiSearchResponse>("/api/v1/wiki/search", {
    method: "POST",
    body: JSON.stringify({
      spaceId: input.spaceId,
      kind: input.kind,
      mode: input.mode ?? "text",
      query: input.query ?? "",
      profileId: input.profileId,
      limit: input.limit ?? 8
    })
  });
}

export function deleteWikiIngestJob(jobId: string) {
  return request<{ deleted: { id: string } }>(
    `/api/v1/wiki/ingest-jobs/${jobId}`,
    {
      method: "DELETE"
    }
  );
}

export function rerunWikiIngestJob(jobId: string) {
  return request<{
    job: WikiIngestJobPayload | null;
    page: Note | null;
  }>(`/api/v1/wiki/ingest-jobs/${jobId}/rerun`, {
    method: "POST"
  });
}

export function resumeWikiIngestJob(jobId: string) {
  return request<{
    job: WikiIngestJobPayload | null;
    resumed: boolean;
  }>(`/api/v1/wiki/ingest-jobs/${jobId}/resume`, {
    method: "POST"
  });
}

export function reviewWikiIngestJob(input: {
  jobId: string;
  decisions: Array<
    | { candidateId: string; keep: boolean }
    | {
        candidateId: string;
        action: "keep" | "discard" | "map_existing" | "merge_existing";
        mappedEntityType?: CrudEntityType;
        mappedEntityId?: string;
        targetNoteId?: string;
      }
  >;
}) {
  return request<{ job: WikiIngestJobPayload }>(
    `/api/v1/wiki/ingest-jobs/${input.jobId}/review`,
    {
      method: "POST",
      body: JSON.stringify({
        decisions: input.decisions
      })
    }
  );
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

export function patchInsight(
  insightId: string,
  patch: Partial<
    Pick<
      Insight,
      | "status"
      | "visibility"
      | "title"
      | "summary"
      | "recommendation"
      | "rationale"
      | "confidence"
      | "ctaLabel"
    >
  >
) {
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

export function submitInsightFeedback(
  insightId: string,
  feedbackType: InsightFeedback["feedbackType"],
  note = ""
) {
  return request<{ feedback: InsightFeedback }>(
    `/api/v1/insights/${insightId}/feedback`,
    {
      method: "POST",
      body: JSON.stringify({ feedbackType, note })
    }
  );
}

export function getWeeklyReview() {
  return request<{ review: WeeklyReviewPayload }>("/api/v1/reviews/weekly");
}

export function finalizeWeeklyReview() {
  return request<FinalizeWeeklyReviewResult>(
    "/api/v1/reviews/weekly/finalize",
    {
      method: "POST"
    }
  );
}

export function getCalendarOverview(
  input: {
    from?: string;
    to?: string;
    userIds?: string[] | unknown;
  } = {}
) {
  const search = new URLSearchParams();
  if (input.from) {
    search.set("from", input.from);
  }
  if (input.to) {
    search.set("to", input.to);
  }
  appendUserIds(search, coerceUserIds(input.userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ calendar: CalendarOverviewPayload }>(
    `/api/v1/calendar/overview${suffix}`
  ).then((response) => ({
    ...response,
    calendar: normalizeCalendarOverviewPayload(response.calendar)
  }));
}

export function getPsycheObservationCalendar(
  input: {
    from?: string;
    to?: string;
    userIds?: string[] | unknown;
  } = {}
) {
  const search = new URLSearchParams();
  if (input.from) {
    search.set("from", input.from);
  }
  if (input.to) {
    search.set("to", input.to);
  }
  appendUserIds(search, coerceUserIds(input.userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ calendar: PsycheObservationCalendarPayload }>(
    `/api/v1/psyche/self-observation/calendar${suffix}`
  );
}

export function exportPsycheObservationCalendar(
  input: {
    from?: string;
    to?: string;
    userIds?: string[] | unknown;
    tags?: string[];
    includeObservations?: boolean;
    includeActivity?: boolean;
    onlyHumanOwned?: boolean;
    search?: string;
    format: "json" | "csv" | "markdown" | "ics";
  }
) {
  const search = new URLSearchParams();
  if (input.from) {
    search.set("from", input.from);
  }
  if (input.to) {
    search.set("to", input.to);
  }
  if (input.search?.trim()) {
    search.set("search", input.search.trim());
  }
  if (input.includeObservations !== undefined) {
    search.set("includeObservations", String(input.includeObservations));
  }
  if (input.includeActivity !== undefined) {
    search.set("includeActivity", String(input.includeActivity));
  }
  if (input.onlyHumanOwned !== undefined) {
    search.set("onlyHumanOwned", String(input.onlyHumanOwned));
  }
  for (const tag of input.tags ?? []) {
    const trimmed = tag.trim();
    if (trimmed) {
      search.append("tags", trimmed);
    }
  }
  search.set("format", input.format);
  appendUserIds(search, coerceUserIds(input.userIds));
  return requestBlob(
    `/api/v1/psyche/self-observation/calendar/export?${search.toString()}`
  );
}

export function listCalendarConnections() {
  return request<{
    providers: CalendarOverviewPayload["providers"];
    connections: CalendarConnection[];
  }>("/api/v1/calendar/connections");
}

export function discoverCalendarConnection(
  input:
    | {
        provider: "apple";
        username: string;
        password: string;
      }
    | {
        provider: "caldav";
        serverUrl: string;
        username: string;
        password: string;
      }
) {
  return request<{ discovery: CalendarDiscoveryPayload }>(
    "/api/v1/calendar/discovery",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  ).then((response) => ({
    ...response,
    discovery: dedupeCalendarDiscoveryPayload(response.discovery)
  }));
}

export function getMacOSLocalCalendarStatus() {
  return request<{ status: MacOSCalendarAccessStatus }>(
    "/api/v1/calendar/macos-local/status"
  );
}

export function requestMacOSLocalCalendarAccess() {
  return request<{
    granted: boolean;
    status: MacOSCalendarAccessStatus;
    promptSuppressed?: boolean;
    openedSystemSettings?: boolean;
    message?: string;
  }>("/api/v1/calendar/macos-local/request-access", {
    method: "POST"
  });
}

export function discoverMacOSLocalCalendarSources() {
  return request<{ discovery: MacOSLocalCalendarDiscoveryPayload }>(
    "/api/v1/calendar/macos-local/discovery"
  ).then((response) => ({
    ...response,
    discovery: {
      ...response.discovery,
      sources: response.discovery.sources.map((source) => ({
        ...source,
        calendars: dedupeCalendarDiscoveryPayload({
          provider: "macos_local",
          accountLabel: source.accountLabel,
          serverUrl: "forge-macos-local://eventkit/",
          principalUrl: null,
          homeUrl: null,
          calendars: source.calendars
        }).calendars
      }))
    }
  }));
}

export function startGoogleCalendarOauth(input: {
  label?: string;
  browserOrigin?: string;
}) {
  return request<{ session: GoogleCalendarOauthSession }>(
    "/api/v1/calendar/oauth/google/start",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function getGoogleCalendarOauthSession(sessionId: string) {
  return request<{ session: GoogleCalendarOauthSession }>(
    `/api/v1/calendar/oauth/google/session/${sessionId}`
  ).then((response) => ({
    ...response,
    session: {
      ...response.session,
      discovery: response.session.discovery
        ? dedupeCalendarDiscoveryPayload(response.session.discovery)
        : null
    }
  }));
}

export function startMicrosoftCalendarOauth(input: { label?: string }) {
  return request<{ session: MicrosoftCalendarOauthSession }>(
    "/api/v1/calendar/oauth/microsoft/start",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function testMicrosoftCalendarOauthConfiguration(input: {
  clientId: string;
  tenantId?: string;
  redirectUri: string;
}) {
  return request<{
    result: {
      ok: true;
      message: string;
      normalizedConfig: {
        clientId: string;
        tenantId: string;
        redirectUri: string;
        usesClientSecret: false;
        readOnly: true;
      };
    };
  }>("/api/v1/calendar/oauth/microsoft/test-config", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getMicrosoftCalendarOauthSession(sessionId: string) {
  return request<{ session: MicrosoftCalendarOauthSession }>(
    `/api/v1/calendar/oauth/microsoft/session/${sessionId}`
  ).then((response) => ({
    ...response,
    session: {
      ...response.session,
      discovery: response.session.discovery
        ? dedupeCalendarDiscoveryPayload(response.session.discovery)
        : null
    }
  }));
}

export function discoverExistingCalendarConnection(connectionId: string) {
  return request<{ discovery: CalendarDiscoveryPayload }>(
    `/api/v1/calendar/connections/${connectionId}/discovery`
  ).then((response) => ({
    ...response,
    discovery: dedupeCalendarDiscoveryPayload(response.discovery)
  }));
}

export function createCalendarConnection(
  input:
    | {
        provider: "google";
        label: string;
        authSessionId: string;
        selectedCalendarUrls: string[];
        forgeCalendarUrl?: string | null;
        createForgeCalendar?: boolean;
      }
    | {
        provider: "apple";
        label: string;
        username: string;
        password: string;
        selectedCalendarUrls: string[];
        forgeCalendarUrl?: string | null;
        createForgeCalendar?: boolean;
      }
    | {
        provider: "caldav";
        label: string;
        serverUrl: string;
        username: string;
        password: string;
        selectedCalendarUrls: string[];
        forgeCalendarUrl?: string | null;
        createForgeCalendar?: boolean;
      }
    | {
        provider: "microsoft";
        label: string;
        authSessionId: string;
        selectedCalendarUrls: string[];
      }
    | {
        provider: "macos_local";
        label: string;
        sourceId: string;
        selectedCalendarUrls: string[];
        forgeCalendarUrl?: string | null;
        createForgeCalendar?: boolean;
        replaceConnectionIds?: string[];
      }
) {
  return request<{ connection: CalendarConnection }>(
    "/api/v1/calendar/connections",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function syncCalendarConnection(connectionId: string) {
  return request<{ connection: CalendarConnection }>(
    `/api/v1/calendar/connections/${connectionId}/sync`,
    {
      method: "POST"
    }
  );
}

export function patchCalendarConnection(
  connectionId: string,
  patch: Partial<{
    label: string;
    selectedCalendarUrls: string[];
  }>
) {
  return request<{ connection: CalendarConnection }>(
    `/api/v1/calendar/connections/${connectionId}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function deleteCalendarConnection(connectionId: string) {
  return request<{ connection: CalendarConnection }>(
    `/api/v1/calendar/connections/${connectionId}`,
    {
      method: "DELETE"
    }
  );
}

export function listCalendarResources() {
  return request<{ calendars: CalendarResource[] }>(
    "/api/v1/calendar/calendars"
  );
}

export function listWorkBlockTemplates() {
  return request<{ templates: WorkBlockTemplate[] }>(
    "/api/v1/calendar/work-block-templates"
  );
}

export function createWorkBlockTemplate(input: {
  title: string;
  kind: WorkBlockTemplate["kind"];
  color: string;
  timezone: string;
  weekDays: number[];
  startMinute: number;
  endMinute: number;
  startsOn?: string | null;
  endsOn?: string | null;
  blockingState: WorkBlockTemplate["blockingState"];
  activityPresetKey?: string | null;
  customSustainRateApPerHour?: number | null;
  userId?: string | null;
}) {
  return request<{ template: WorkBlockTemplate }>(
    "/api/v1/calendar/work-block-templates",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function patchWorkBlockTemplate(
  templateId: string,
  patch: Partial<{
    title: string;
    kind: WorkBlockTemplate["kind"];
    color: string;
    timezone: string;
    weekDays: number[];
    startMinute: number;
    endMinute: number;
    startsOn: string | null;
    endsOn: string | null;
    blockingState: WorkBlockTemplate["blockingState"];
    activityPresetKey: string | null;
    customSustainRateApPerHour: number | null;
    userId: string | null;
  }>
) {
  return request<{ template: WorkBlockTemplate }>(
    `/api/v1/calendar/work-block-templates/${templateId}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function deleteWorkBlockTemplate(templateId: string) {
  return request<{ template: WorkBlockTemplate }>(
    `/api/v1/calendar/work-block-templates/${templateId}`,
    {
      method: "DELETE"
    }
  );
}

export function listTaskTimeboxes(
  input: {
    from?: string;
    to?: string;
    userIds?: string[] | unknown;
  } = {}
) {
  const search = new URLSearchParams();
  if (input.from) {
    search.set("from", input.from);
  }
  if (input.to) {
    search.set("to", input.to);
  }
  appendUserIds(search, coerceUserIds(input.userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ timeboxes: TaskTimebox[] }>(
    `/api/v1/calendar/timeboxes${suffix}`
  );
}

export function createCalendarEvent(input: {
  title: string;
  description?: string;
  location?: string;
  place?: {
    label?: string;
    address?: string;
    timezone?: string;
    latitude?: number | null;
    longitude?: number | null;
    source?: string;
    externalPlaceId?: string;
  };
  startAt: string;
  endAt: string;
  timezone?: string;
  isAllDay?: boolean;
  availability?: CalendarAvailability;
  eventType?: string;
  categories?: string[];
  activityPresetKey?: string | null;
  customSustainRateApPerHour?: number | null;
  preferredCalendarId?: string | null;
  userId?: string | null;
  links?: Array<{
    entityType: CrudEntityType;
    entityId: string;
    relationshipType?: string;
  }>;
}) {
  return request<{ event: CalendarEvent }>("/api/v1/calendar/events", {
    method: "POST",
    body: JSON.stringify(input)
  }).then((response) => ({
    ...response,
    event: normalizeCalendarEventPlace(response.event)
  }));
}

export function patchCalendarEvent(
  eventId: string,
  patch: Partial<{
    title: string;
    description: string;
    location: string;
    place: {
      label?: string;
      address?: string;
      timezone?: string;
      latitude?: number | null;
      longitude?: number | null;
      source?: string;
      externalPlaceId?: string;
    };
    startAt: string;
    endAt: string;
    timezone: string;
    isAllDay: boolean;
    availability: CalendarAvailability;
    eventType: string;
    categories: string[];
    activityPresetKey: string | null;
    customSustainRateApPerHour: number | null;
    preferredCalendarId: string | null;
    userId: string | null;
    links: Array<{
      entityType: CrudEntityType;
      entityId: string;
      relationshipType?: string;
    }>;
  }>
) {
  return request<{ event: CalendarEvent }>(
    `/api/v1/calendar/events/${eventId}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  ).then((response) => ({
    ...response,
    event: normalizeCalendarEventPlace(response.event)
  }));
}

export function deleteCalendarEvent(eventId: string) {
  return request<{ event: CalendarEvent }>(
    `/api/v1/calendar/events/${eventId}`,
    {
      method: "DELETE"
    }
  );
}

export function createTaskTimebox(input: {
  taskId: string;
  projectId?: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  source?: TaskTimebox["source"];
  status?: TaskTimebox["status"];
  overrideReason?: string | null;
  activityPresetKey?: string | null;
  customSustainRateApPerHour?: number | null;
  userId?: string | null;
}) {
  return request<{ timebox: TaskTimebox }>("/api/v1/calendar/timeboxes", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function patchTaskTimebox(
  timeboxId: string,
  patch: Partial<{
    title: string;
    startsAt: string;
    endsAt: string;
    status: TaskTimebox["status"];
    overrideReason: string | null;
    activityPresetKey: string | null;
    customSustainRateApPerHour: number | null;
    userId: string | null;
  }>
) {
  return request<{ timebox: TaskTimebox }>(
    `/api/v1/calendar/timeboxes/${timeboxId}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function deleteTaskTimebox(timeboxId: string) {
  return request<{ timebox: TaskTimebox }>(
    `/api/v1/calendar/timeboxes/${timeboxId}`,
    {
      method: "DELETE"
    }
  );
}

export function recommendTaskTimeboxes(input: {
  taskId: string;
  from?: string;
  to?: string;
  limit?: number;
}) {
  return request<{ timeboxes: TaskTimebox[] }>(
    "/api/v1/calendar/timeboxes/recommend",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function listProjects(userIds?: string[]) {
  const search = new URLSearchParams();
  appendUserIds(search, userIds);
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ projects: ProjectSummary[] }>(`/api/v1/projects${suffix}`);
}

export function listHabits(
  input: {
    status?: Habit["status"];
    polarity?: Habit["polarity"];
    dueToday?: boolean;
    orderBy?:
      | "needs_attention"
      | "name"
      | "streak"
      | "created_at"
      | "updated_at";
    limit?: number;
    userIds?: string[];
  } = {}
) {
  const search = new URLSearchParams();
  appendUserIds(search, input.userIds);
  if (input.status) {
    search.set("status", input.status);
  }
  if (input.polarity) {
    search.set("polarity", input.polarity);
  }
  if (input.dueToday) {
    search.set("dueToday", "true");
  }
  if (input.orderBy) {
    search.set("orderBy", input.orderBy);
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

export function patchHabit(
  habitId: string,
  patch: Partial<HabitMutationInput>
) {
  return request<{ habit: Habit }>(`/api/v1/habits/${habitId}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...patch,
      linkedBehaviorId:
        patch.linkedBehaviorId === "" ? null : patch.linkedBehaviorId
    })
  });
}

export function deleteHabit(habitId: string) {
  return request<{ habit: Habit }>(`/api/v1/habits/${habitId}`, {
    method: "DELETE"
  });
}

export function createHabitCheckIn(
  habitId: string,
  input: { dateKey?: string; status: "done" | "missed"; note?: string }
) {
  return request<{ habit: Habit; metrics: XpMetricsPayload }>(
    `/api/v1/habits/${habitId}/check-ins`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function deleteHabitCheckIn(habitId: string, dateKey: string) {
  return request<{ habit: Habit; metrics: XpMetricsPayload }>(
    `/api/v1/habits/${habitId}/check-ins/${encodeURIComponent(dateKey)}`,
    {
      method: "DELETE"
    }
  );
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
  return request<{ context: OperatorContextPayload }>(
    "/api/v1/operator/context"
  );
}

export function getOperatorOverview() {
  return request<{ overview: OperatorOverviewPayload }>(
    "/api/v1/operator/overview"
  );
}

export function getSettings() {
  return request<{ settings: SettingsPayload }>("/api/v1/settings");
}

export function saveAiModelConnection(input: {
  id?: string;
  label: string;
  provider: import("./types").AiModelProvider;
  authMode?: import("./types").AiModelAuthMode;
  baseUrl?: string;
  model: string;
  apiKey?: string;
  oauthSessionId?: string;
  enabled?: boolean;
}) {
  return request<{ connection: import("./types").AiModelConnection }>(
    "/api/v1/settings/models/connections",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function deleteAiModelConnection(connectionId: string) {
  return request<{ deletedId: string }>(
    `/api/v1/settings/models/connections/${connectionId}`,
    {
      method: "DELETE"
    }
  );
}

export function testAiModelConnection(input: {
  connectionId?: string;
  provider?: import("./types").AiModelProvider;
  baseUrl?: string;
  model: string;
  apiKey?: string;
}) {
  return request<{ result: WikiLlmConnectionTestResult }>(
    "/api/v1/settings/models/connections/test",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function startOpenAiCodexOauth() {
  return request<{ session: import("./types").OpenAiCodexOauthSession }>(
    "/api/v1/settings/models/oauth/openai-codex/start",
    {
      method: "POST"
    }
  );
}

export function getOpenAiCodexOauthSession(sessionId: string) {
  return request<{ session: import("./types").OpenAiCodexOauthSession }>(
    `/api/v1/settings/models/oauth/openai-codex/session/${sessionId}`
  );
}

export function submitOpenAiCodexOauthManualCode(
  sessionId: string,
  codeOrUrl: string
) {
  return request<{ session: import("./types").OpenAiCodexOauthSession }>(
    `/api/v1/settings/models/oauth/openai-codex/session/${sessionId}/manual`,
    {
      method: "POST",
      body: JSON.stringify({ codeOrUrl })
    }
  );
}

export function getSurfaceAiProcessors(surfaceId: string) {
  return request<{ graph: import("./types").SurfaceProcessorGraphPayload }>(
    `/api/v1/surfaces/${surfaceId}/ai-processors`
  );
}

export function getSurfaceLayout(surfaceId: string) {
  return request<{
    layout: import("./types").SurfaceLayoutPayload | null;
  }>(`/api/v1/surfaces/${surfaceId}/layout`);
}

export function saveSurfaceLayout(
  surfaceId: string,
  payload: Pick<import("./types").SurfaceLayoutPayload, "order" | "widgets">
) {
  return request<{ layout: import("./types").SurfaceLayoutPayload }>(
    `/api/v1/surfaces/${surfaceId}/layout`,
    {
      method: "PUT",
      body: JSON.stringify(payload)
    }
  );
}

export function resetSurfaceLayout(surfaceId: string) {
  return request<{ layout: import("./types").SurfaceLayoutPayload | null }>(
    `/api/v1/surfaces/${surfaceId}/layout/reset`,
    {
      method: "POST"
    }
  );
}

export function createAiProcessor(input: {
  surfaceId: string;
  title: string;
  promptFlow?: string;
  contextInput?: string;
  toolConfig?: import("./types").AiProcessorTool[];
  agentIds?: string[];
  agentConfigs?: import("./types").AiProcessorAgentConfig[];
  triggerMode?: "manual" | "route" | "cron";
  cronExpression?: string;
  machineAccess?: { read: boolean; write: boolean; exec: boolean };
  endpointEnabled?: boolean;
}) {
  return request<{ processor: import("./types").AiProcessor }>(
    `/api/v1/surfaces/${input.surfaceId}/ai-processors`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function updateAiProcessor(
  processorId: string,
  patch: Partial<{
    title: string;
    promptFlow: string;
    contextInput: string;
    toolConfig: import("./types").AiProcessorTool[];
    agentIds: string[];
    agentConfigs: import("./types").AiProcessorAgentConfig[];
    triggerMode: "manual" | "route" | "cron";
    cronExpression: string;
    machineAccess: Partial<{ read: boolean; write: boolean; exec: boolean }>;
    endpointEnabled: boolean;
  }>
) {
  return request<{ processor: import("./types").AiProcessor }>(
    `/api/v1/ai-processors/${processorId}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function deleteAiProcessor(processorId: string) {
  return request<{ processor: import("./types").AiProcessor }>(
    `/api/v1/ai-processors/${processorId}`,
    { method: "DELETE" }
  );
}

export function createAiProcessorLink(input: {
  surfaceId: string;
  sourceWidgetId: string;
  targetProcessorId: string;
  accessMode?: "read" | "write" | "read_write" | "exec";
  capabilityMode?: "content" | "tool" | "mcp" | "processor";
  metadata?: Record<string, unknown>;
}) {
  return request<{ link: import("./types").AiProcessorLink }>(
    "/api/v1/ai-processor-links",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function deleteAiProcessorLink(linkId: string) {
  return request<{ link: import("./types").AiProcessorLink }>(
    `/api/v1/ai-processor-links/${linkId}`,
    { method: "DELETE" }
  );
}

export function runAiProcessor(
  processorId: string,
  input: {
    input?: string;
    context?: Record<string, unknown>;
    widgetSnapshots?: Record<string, unknown>;
  }
) {
  return request<{
    processor: import("./types").AiProcessor;
    output: { concatenated: string; byAgent: Record<string, string> };
  }>(`/api/v1/ai-processors/${processorId}/run`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getAiProcessorBySlug(slug: string) {
  return request<{ processor: import("./types").AiProcessor }>(
    `/api/v1/aiproc/${slug}`
  );
}

export function runAiProcessorBySlug(
  slug: string,
  input: {
    input?: string;
    context?: Record<string, unknown>;
    widgetSnapshots?: Record<string, unknown>;
  }
) {
  return request<{
    processor: import("./types").AiProcessor;
    output: { concatenated: string; byAgent: Record<string, string> };
  }>(`/api/v1/aiproc/${slug}/run`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function listWorkbenchBoxCatalog() {
  return request<{ boxes: import("./types").ForgeBoxCatalogEntry[] }>(
    "/api/v1/workbench/catalog/boxes"
  );
}

export function listWorkbenchFlows() {
  return request<{ flows: import("./types").AiConnector[] }>(
    "/api/v1/workbench/flows"
  );
}

export function createWorkbenchFlow(input: {
  title: string;
  description?: string;
  kind?: import("./types").AiConnectorKind;
  homeSurfaceId?: string | null;
  endpointEnabled?: boolean;
  publicInputs?: import("./types").AiConnectorPublicInput[];
  graph?: {
    nodes: import("./types").AiConnectorNode[];
    edges: import("./types").AiConnectorEdge[];
  };
}) {
  return request<{ flow: import("./types").AiConnector }>(
    "/api/v1/workbench/flows",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function getWorkbenchFlow(connectorId: string) {
  return request<{
    flow: import("./types").AiConnector;
    runs: import("./types").AiConnectorRun[];
    conversation: import("./types").AiConnectorConversation | null;
  }>(`/api/v1/workbench/flows/${connectorId}`);
}

export function updateWorkbenchFlow(
  connectorId: string,
  patch: Partial<{
    title: string;
    description: string;
    kind: import("./types").AiConnectorKind;
    homeSurfaceId: string | null;
    endpointEnabled: boolean;
    publicInputs: import("./types").AiConnectorPublicInput[];
    graph: {
      nodes: import("./types").AiConnectorNode[];
      edges: import("./types").AiConnectorEdge[];
    };
  }>
) {
  return request<{ flow: import("./types").AiConnector }>(
    `/api/v1/workbench/flows/${connectorId}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function deleteWorkbenchFlow(connectorId: string) {
  return request<{ flow: import("./types").AiConnector }>(
    `/api/v1/workbench/flows/${connectorId}`,
    {
      method: "DELETE"
    }
  );
}

export function runWorkbenchFlow(
  connectorId: string,
  input: {
    userInput?: string;
    inputs?: Record<string, unknown>;
    context?: Record<string, unknown>;
    boxSnapshots?: Record<string, unknown>;
    conversationId?: string | null;
    debug?: boolean;
  }
) {
  return request<{
    flow: import("./types").AiConnector;
    run: import("./types").AiConnectorRun;
    conversation: import("./types").AiConnectorConversation | null;
  }>(`/api/v1/workbench/flows/${connectorId}/run`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function chatWorkbenchFlow(
  connectorId: string,
  input: {
    userInput?: string;
    inputs?: Record<string, unknown>;
    context?: Record<string, unknown>;
    boxSnapshots?: Record<string, unknown>;
    conversationId?: string | null;
    debug?: boolean;
  }
) {
  return request<{
    flow: import("./types").AiConnector;
    run: import("./types").AiConnectorRun;
    conversation: import("./types").AiConnectorConversation | null;
  }>(`/api/v1/workbench/flows/${connectorId}/chat`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getWorkbenchFlowOutput(connectorId: string) {
  return request<{
    flow: import("./types").AiConnector;
    output: import("./types").AiConnectorRunResult | null;
  }>(`/api/v1/workbench/flows/${connectorId}/output`);
}

export function getWorkbenchFlowRuns(connectorId: string) {
  return request<{ runs: import("./types").AiConnectorRun[] }>(
    `/api/v1/workbench/flows/${connectorId}/runs`
  );
}

export function getWorkbenchFlowRun(connectorId: string, runId: string) {
  return request<{
    flow: import("./types").AiConnector;
    run: import("./types").AiConnectorRun;
  }>(`/api/v1/workbench/flows/${connectorId}/runs/${runId}`);
}

export function getWorkbenchFlowRunNodes(connectorId: string, runId: string) {
  return request<{
    flow: import("./types").AiConnector;
    nodeResults: import("./types").AiConnectorRunResult["nodeResults"];
  }>(`/api/v1/workbench/flows/${connectorId}/runs/${runId}/nodes`);
}

export function getWorkbenchFlowRunNode(
  connectorId: string,
  runId: string,
  nodeId: string
) {
  return request<{
    flow: import("./types").AiConnector;
    nodeResult: import("./types").AiConnectorRunResult["nodeResults"][number];
  }>(`/api/v1/workbench/flows/${connectorId}/runs/${runId}/nodes/${nodeId}`);
}

export function getWorkbenchFlowNodeOutput(connectorId: string, nodeId: string) {
  return request<{
    flow: import("./types").AiConnector;
    run: import("./types").AiConnectorRun;
    nodeResult: import("./types").AiConnectorRunResult["nodeResults"][number];
  }>(`/api/v1/workbench/flows/${connectorId}/nodes/${nodeId}/output`);
}

export function getCompanionOverview(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ overview: CompanionOverviewPayload }>(
    `/api/v1/health/overview${suffix}`
  );
}

export function getSleepView(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ sleep: SleepViewData }>(`/api/v1/health/sleep${suffix}`);
}

export function getFitnessView(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ fitness: FitnessViewData }>(
    `/api/v1/health/fitness${suffix}`
  );
}

export function getMovementDay(input?: {
  date?: string;
  userIds?: string[] | unknown;
}) {
  const search = new URLSearchParams();
  if (input?.date) {
    search.set("date", input.date);
  }
  appendUserIds(search, coerceUserIds(input?.userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ movement: MovementDayData }>(`/api/v1/movement/day${suffix}`);
}

export function getMovementMonth(input?: {
  month?: string;
  userIds?: string[] | unknown;
}) {
  const search = new URLSearchParams();
  if (input?.month) {
    search.set("month", input.month);
  }
  appendUserIds(search, coerceUserIds(input?.userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ movement: MovementMonthData }>(
    `/api/v1/movement/month${suffix}`
  );
}

export function getMovementAllTime(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ movement: MovementAllTimeData }>(
    `/api/v1/movement/all-time${suffix}`
  );
}

export function getScreenTimeDay(input?: {
  date?: string;
  userIds?: string[] | unknown;
}) {
  const search = new URLSearchParams();
  if (input?.date) {
    search.set("date", input.date);
  }
  appendUserIds(search, coerceUserIds(input?.userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ screenTime: ScreenTimeDayData }>(
    `/api/v1/screen-time/day${suffix}`
  );
}

export function getScreenTimeMonth(input?: {
  month?: string;
  userIds?: string[] | unknown;
}) {
  const search = new URLSearchParams();
  if (input?.month) {
    search.set("month", input.month);
  }
  appendUserIds(search, coerceUserIds(input?.userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ screenTime: ScreenTimeMonthData }>(
    `/api/v1/screen-time/month${suffix}`
  );
}

export function getScreenTimeAllTime(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ screenTime: ScreenTimeAllTimeData }>(
    `/api/v1/screen-time/all-time${suffix}`
  );
}

export function getScreenTimeSettings(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ settings: ScreenTimeSettingsPayload }>(
    `/api/v1/screen-time/settings${suffix}`
  );
}

export function patchScreenTimeSettings(
  patch: Partial<ScreenTimeSettingsPayload>,
  userIds?: string[] | unknown
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ settings: ScreenTimeSettingsPayload }>(
    `/api/v1/screen-time/settings${suffix}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function getMovementSettings(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ settings: MovementSettingsPayload }>(
    `/api/v1/movement/settings${suffix}`
  );
}

export function patchMovementSettings(
  patch: Partial<MovementSettingsPayload>,
  userIds?: string[] | unknown
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ settings: MovementSettingsPayload }>(
    `/api/v1/movement/settings${suffix}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function listMovementPlaces(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ places: MovementKnownPlace[] }>(
    `/api/v1/movement/places${suffix}`
  );
}

export function createMovementPlace(
  input: Partial<MovementKnownPlace> & {
    label: string;
    latitude: number;
    longitude: number;
  },
  userIds?: string[] | unknown
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ place: MovementKnownPlace }>(`/api/v1/movement/places${suffix}`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function patchMovementPlace(
  placeId: string,
  patch: Partial<MovementKnownPlace>
) {
  return request<{ place: MovementKnownPlace }>(
    `/api/v1/movement/places/${placeId}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function getMovementTripDetail(tripId: string) {
  return request<{ movement: MovementTripDetailData }>(
    `/api/v1/movement/trips/${tripId}`
  );
}

export function getMovementTimeline(input?: {
  before?: string;
  limit?: number;
  includeInvalid?: boolean;
  userIds?: string[] | unknown;
}) {
  const search = new URLSearchParams();
  if (input?.before) {
    search.set("before", input.before);
  }
  if (typeof input?.limit === "number") {
    search.set("limit", String(input.limit));
  }
  if (input?.includeInvalid) {
    search.set("includeInvalid", "true");
  }
  appendUserIds(search, coerceUserIds(input?.userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ movement: MovementTimelineData }>(
    `/api/v1/movement/timeline${suffix}`
  );
}

export function createMovementUserBox(
  input: Record<string, unknown>,
  userIds?: string[] | unknown
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ box: MovementTimelineData["segments"][number] }>(
    `/api/v1/movement/user-boxes${suffix}`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function preflightMovementUserBox(
  input: Record<string, unknown>,
  userIds?: string[] | unknown
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ preflight: MovementUserBoxPreflight }>(
    `/api/v1/movement/user-boxes/preflight${suffix}`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function patchMovementUserBox(
  boxId: string,
  patch: Record<string, unknown>,
  userIds?: string[] | unknown
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ box: MovementTimelineData["segments"][number] }>(
    `/api/v1/movement/user-boxes/${boxId}${suffix}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function deleteMovementUserBox(
  boxId: string,
  userIds?: string[] | unknown
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ deletedBoxId: string }>(
    `/api/v1/movement/user-boxes/${boxId}${suffix}`,
    {
      method: "DELETE"
    }
  );
}

export function invalidateAutomaticMovementBox(
  boxId: string,
  input: Record<string, unknown>,
  userIds?: string[] | unknown
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ box: MovementTimelineData["segments"][number] }>(
    `/api/v1/movement/automatic-boxes/${boxId}/invalidate${suffix}`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function getMovementSelectionAggregate(input: {
  stayIds?: string[];
  tripIds?: string[];
  startedAt?: string;
  endedAt?: string;
  userIds?: string[];
}) {
  return request<{ movement: MovementSelectionAggregate }>(
    "/api/v1/movement/selection",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function createCompanionPairingSession(input?: {
  label?: string;
  userId?: string | null;
  expiresInMinutes?: number;
  capabilities?: string[];
}) {
  return request<{
    session: CompanionOverviewPayload["pairings"][number];
    qrPayload: {
      kind: string;
      apiBaseUrl: string;
      sessionId: string;
      pairingToken: string;
      expiresAt: string;
      capabilities: string[];
    };
  }>("/api/v1/health/pairing-sessions", {
    method: "POST",
    body: JSON.stringify(input ?? {})
  });
}

export function revokeCompanionPairingSession(pairingSessionId: string) {
  return request<{
    session: CompanionOverviewPayload["pairings"][number];
  }>(`/api/v1/health/pairing-sessions/${pairingSessionId}`, {
    method: "DELETE"
  });
}

export function patchCompanionPairingSourceState(
  pairingSessionId: string,
  source: "health" | "movement" | "screenTime",
  desiredEnabled: boolean
) {
  return request<{
    session: CompanionOverviewPayload["pairings"][number];
  }>(`/api/v1/health/pairing-sessions/${pairingSessionId}/sources/${source}`, {
    method: "PATCH",
    body: JSON.stringify({ desiredEnabled })
  });
}

export function revokeAllCompanionPairingSessions(input?: {
  userIds?: string[];
  includeRevoked?: boolean;
}) {
  return request<{
    revokedCount: number;
    sessions: CompanionOverviewPayload["pairings"];
  }>("/api/v1/health/pairing-sessions/revoke-all", {
    method: "POST",
    body: JSON.stringify(input ?? {})
  });
}

export function patchWorkoutSession(
  workoutId: string,
  patch: Partial<{
    subjectiveEffort: number | null;
    moodBefore: string;
    moodAfter: string;
    meaningText: string;
    plannedContext: string;
    socialContext: string;
    tags: string[];
    links: Array<{
      entityType: string;
      entityId: string;
      relationshipType: string;
    }>;
  }>
) {
  return request<{ workout: import("./types").WorkoutSessionRecord }>(
    `/api/v1/health/workouts/${workoutId}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function patchSleepSession(
  sleepId: string,
  patch: Partial<{
    qualitySummary: string;
    notes: string;
    tags: string[];
    links: Array<{
      entityType: string;
      entityId: string;
      relationshipType: string;
    }>;
  }>
) {
  return request<{ sleep: import("./types").SleepSessionRecord }>(
    `/api/v1/health/sleep/${sleepId}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function listUsers() {
  return request<{ users: UserSummary[] }>("/api/v1/users");
}

export function getUserDirectory() {
  return request<{ directory: UserDirectoryPayload }>(
    "/api/v1/users/directory"
  );
}

export function patchUserAccessGrant(
  grantId: string,
  patch: Partial<{
    accessLevel: "view" | "manage";
    rights: Partial<UserDirectoryPayload["grants"][number]["config"]["rights"]>;
  }>
) {
  return request<{
    grant: UserDirectoryPayload["grants"][number];
  }>(`/api/v1/users/access-grants/${grantId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function createUser(input: {
  kind: "human" | "bot";
  handle: string;
  displayName: string;
  description?: string;
  accentColor?: string;
}) {
  return request<{ user: UserSummary }>("/api/v1/users", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function patchUser(
  userId: string,
  patch: Partial<{
    kind: "human" | "bot";
    handle: string;
    displayName: string;
    description: string;
    accentColor: string;
  }>
) {
  return request<{ user: UserSummary }>(`/api/v1/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function listStrategies(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ strategies: Strategy[] }>(`/api/v1/strategies${suffix}`);
}

export function createStrategy(input: {
  title: string;
  overview: string;
  endStateDescription: string;
  status: "active" | "paused" | "completed";
  targetGoalIds: string[];
  targetProjectIds: string[];
  linkedEntities: Array<{ entityType: CrudEntityType; entityId: string }>;
  graph: Strategy["graph"];
  userId?: string | null;
  isLocked?: boolean;
  lockedByUserId?: string | null;
}) {
  return request<{ strategy: Strategy }>("/api/v1/strategies", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getStrategy(strategyId: string) {
  return request<{ strategy: Strategy }>(`/api/v1/strategies/${strategyId}`);
}

export function patchStrategy(
  strategyId: string,
  patch: Partial<{
    title: string;
    overview: string;
    endStateDescription: string;
    status: "active" | "paused" | "completed";
    targetGoalIds: string[];
    targetProjectIds: string[];
    linkedEntities: Array<{ entityType: CrudEntityType; entityId: string }>;
    graph: Strategy["graph"];
    userId: string | null;
    isLocked: boolean;
    lockedByUserId: string | null;
  }>
) {
  return request<{ strategy: Strategy }>(`/api/v1/strategies/${strategyId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deleteStrategy(strategyId: string) {
  return request<{ strategy: Strategy }>(`/api/v1/strategies/${strategyId}`, {
    method: "DELETE"
  });
}

export function getSettingsBin() {
  return request<{ bin: SettingsBinPayload }>("/api/v1/settings/bin");
}

export function getDataManagementState() {
  return request<{ data: DataManagementState }>("/api/v1/settings/data");
}

export function patchDataManagementSettings(
  input: Partial<{
    backupDirectory: string;
    backupFrequencyHours: number | null;
    autoRepairEnabled: boolean;
  }>
) {
  return request<{
    settings: DataManagementSettings;
    data: DataManagementState;
  }>("/api/v1/settings/data", {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function scanDataRecoveryCandidates() {
  return request<{ candidates: DataRecoveryCandidate[] }>(
    "/api/v1/settings/data/scan",
    {
      method: "POST",
      body: JSON.stringify({})
    }
  );
}

export function createRuntimeDataBackup(note = "") {
  return request<{ backup: DataBackupEntry; data: DataManagementState }>(
    "/api/v1/settings/data/backups",
    {
      method: "POST",
      body: JSON.stringify({ note })
    }
  );
}

export function restoreRuntimeDataBackup(
  backupId: string,
  createSafetyBackup = true
) {
  return request<{ data: DataManagementState }>(
    `/api/v1/settings/data/backups/${backupId}/restore`,
    {
      method: "POST",
      body: JSON.stringify({ createSafetyBackup })
    }
  );
}

export function switchRuntimeDataRoot(input: {
  targetDataRoot: string;
  mode: DataRootSwitchMode;
  createSafetyBackup?: boolean;
}) {
  return request<{ data: DataManagementState }>(
    "/api/v1/settings/data/switch-root",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function downloadDataExport(format: DataExportFormat) {
  return requestBlob(`/api/v1/settings/data/export?format=${format}`);
}

export function listAgents() {
  return request<{ agents: AgentIdentity[] }>("/api/v1/agents");
}

export function getAgentOnboarding() {
  return request<{ onboarding: AgentOnboardingPayload }>(
    "/api/v1/agents/onboarding"
  );
}

export function listAgentActions(agentId: string) {
  return request<{ actions: AgentAction[] }>(
    `/api/v1/agents/${agentId}/actions`
  );
}

export function listApprovalRequests() {
  return request<{ approvalRequests: ApprovalRequest[] }>(
    "/api/v1/approval-requests"
  );
}

export function approveApprovalRequest(approvalRequestId: string, note = "") {
  return request<{ approvalRequest: ApprovalRequest }>(
    `/api/v1/approval-requests/${approvalRequestId}/approve`,
    {
      method: "POST",
      body: JSON.stringify({ note })
    }
  );
}

export function rejectApprovalRequest(approvalRequestId: string, note = "") {
  return request<{ approvalRequest: ApprovalRequest }>(
    `/api/v1/approval-requests/${approvalRequestId}/reject`,
    {
      method: "POST",
      body: JSON.stringify({ note })
    }
  );
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
  return request<{ reward: RewardLedgerEvent; metrics: XpMetricsPayload }>(
    "/api/v1/rewards/bonus",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function listRewardLedger(limit = 50) {
  return request<{ ledger: RewardLedgerEvent[] }>(
    `/api/v1/rewards/ledger?limit=${limit}`
  );
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
  return request<{ results: Array<Record<string, unknown>> }>(
    "/api/v1/entities/create",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
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
  return request<{ results: Array<Record<string, unknown>> }>(
    "/api/v1/entities/update",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
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
  return request<{ results: Array<Record<string, unknown>> }>(
    "/api/v1/entities/delete",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function restoreEntities(input: {
  operations: Array<{
    entityType: CrudEntityType;
    id: string;
    clientRef?: string;
  }>;
  atomic?: boolean;
}) {
  return request<{ results: Array<Record<string, unknown>> }>(
    "/api/v1/entities/restore",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function searchEntities(input: {
  searches: Array<{
    entityTypes?: CrudEntityType[];
    query?: string;
    ids?: string[];
    status?: string[];
    linkedTo?: { entityType: CrudEntityType; id: string };
    userIds?: string[];
    includeDeleted?: boolean;
    limit?: number;
    clientRef?: string;
  }>;
}) {
  return request<{ results: Array<Record<string, unknown>> }>(
    "/api/v1/entities/search",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function createAgentToken(input: CreateAgentTokenInput) {
  return request<{ token: AgentTokenMutationResult }>(
    "/api/v1/settings/tokens",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
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
  return request<{
    action: AgentAction;
    approvalRequest: ApprovalRequest | null;
  }>("/api/v1/agent-actions", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function rotateAgentToken(tokenId: string) {
  return request<{ token: AgentTokenMutationResult }>(
    `/api/v1/settings/tokens/${tokenId}/rotate`,
    {
      method: "POST"
    }
  );
}

export function revokeAgentToken(tokenId: string) {
  return request<{ token: { id: string } }>(
    `/api/v1/settings/tokens/${tokenId}/revoke`,
    {
      method: "POST"
    }
  );
}

export function listActivity(
  input: {
    limit?: number;
    entityType?: string;
    entityId?: string;
    includeCorrected?: boolean;
    userIds?: string[] | unknown;
  } = {}
) {
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
  appendUserIds(search, coerceUserIds(input.userIds));
  return request<{ activity: ForgeSnapshot["activity"] }>(
    `/api/v1/activity?${search.toString()}`
  );
}

export function listDiagnosticLogs(
  input: {
    limit?: number;
    level?: string;
    source?: string;
    scope?: string;
    route?: string;
    entityType?: string;
    entityId?: string;
    jobId?: string;
    search?: string;
    beforeCreatedAt?: string;
    beforeId?: string;
  } = {}
) {
  const search = new URLSearchParams();
  search.set("limit", String(input.limit ?? 200));
  if (input.level) {
    search.set("level", input.level);
  }
  if (input.source) {
    search.set("source", input.source);
  }
  if (input.scope) {
    search.set("scope", input.scope);
  }
  if (input.route) {
    search.set("route", input.route);
  }
  if (input.entityType) {
    search.set("entityType", input.entityType);
  }
  if (input.entityId) {
    search.set("entityId", input.entityId);
  }
  if (input.jobId) {
    search.set("jobId", input.jobId);
  }
  if (input.search) {
    search.set("search", input.search);
  }
  if (input.beforeCreatedAt) {
    search.set("beforeCreatedAt", input.beforeCreatedAt);
  }
  if (input.beforeId) {
    search.set("beforeId", input.beforeId);
  }
  return request<import("./types").DiagnosticLogListPayload>(
    `/api/v1/diagnostics/logs?${search.toString()}`
  );
}

export function createGoal(input: GoalMutationInput) {
  return request<{ goal: Goal }>("/api/v1/goals", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      notes: normalizeNestedNotes(input.notes)
    })
  });
}

export function createProject(input: ProjectMutationInput) {
  return request<{ project: Project }>("/api/v1/projects", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      notes: normalizeNestedNotes(input.notes)
    })
  });
}

export function patchProject(
  projectId: string,
  patch: Partial<ProjectMutationInput> & {
    schedulingRules?: CalendarSchedulingRules | null;
  }
) {
  return request<{ project: Project }>(`/api/v1/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function deleteProject(projectId: string, mode: DeleteMode = "soft") {
  const suffix = mode === "hard" ? "?mode=hard" : "";
  return request<{ project: Project }>(
    `/api/v1/projects/${projectId}${suffix}`,
    {
      method: "DELETE"
    }
  );
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
    dueDate: input.dueDate || null,
    plannedDurationSeconds:
      input.plannedDurationSeconds === undefined
        ? null
        : input.plannedDurationSeconds,
    notes: normalizeNestedNotes(input.notes)
  };
  return request<{ task: Task }>("/api/v1/tasks", {
    method: "POST",
    body: JSON.stringify(normalized)
  });
}

export function patchTask(
  taskId: string,
  patch: Partial<QuickTaskInput> & {
    status?: string;
    completedAt?: string;
    plannedDurationSeconds?: number | null;
    schedulingRules?: CalendarSchedulingRules | null;
    enforceTodayWorkLog?: boolean;
    completedTodayWorkSeconds?: number;
  }
) {
  return request<{ task: unknown }>(`/api/v1/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...patch,
      goalId: patch.goalId === "" ? null : patch.goalId,
      projectId: patch.projectId === "" ? null : patch.projectId,
      dueDate: patch.dueDate === "" ? null : patch.dueDate,
      plannedDurationSeconds:
        patch.plannedDurationSeconds === undefined
          ? undefined
          : patch.plannedDurationSeconds
    })
  });
}

export function splitTask(taskId: string, input: TaskSplitInput) {
  return request<{ parent: Task; children: Task[] }>(
    `/api/v1/tasks/${taskId}/split`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
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

export function createWorkAdjustment(input: {
  entityType: "task" | "project";
  entityId: string;
  deltaMinutes: number;
  note?: string;
}) {
  return request<WorkAdjustmentResult>("/api/v1/work-adjustments", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function removeActivityLog(
  eventId: string,
  reason = "Removed from the visible archive."
) {
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
  return request<{
    sessionEvent: unknown;
    rewardEvent: RewardLedgerEvent | null;
  }>("/api/v1/session-events", {
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

export function heartbeatTaskRun(
  taskRunId: string,
  input: TaskRunHeartbeatInput
) {
  return request<{ taskRun: TaskRun }>(
    `/api/v1/task-runs/${taskRunId}/heartbeat`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function focusTaskRun(
  taskRunId: string,
  input: { actor?: string } = {}
) {
  return request<{ taskRun: TaskRun }>(`/api/v1/task-runs/${taskRunId}/focus`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function completeTaskRun(taskRunId: string, input: TaskRunFinishInput) {
  return request<{ taskRun: TaskRun }>(
    `/api/v1/task-runs/${taskRunId}/complete`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function releaseTaskRun(taskRunId: string, input: TaskRunFinishInput) {
  return request<{ taskRun: TaskRun }>(
    `/api/v1/task-runs/${taskRunId}/release`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}
