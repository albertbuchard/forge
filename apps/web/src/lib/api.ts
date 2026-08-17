import type {
  DataBackupEntry,
  DataExportFormat,
  DataManagementSettings,
  DataManagementState,
  DataRecoveryCandidate,
  DataRootSwitchMode
} from "./data-management-types";
import type {
  ComparisonAlignment,
  ComparisonCatalogResponse,
  ComparisonFamily,
  ComparisonResponse
} from "./comparison-types";
import type {
  ProductFeedbackPayload,
  ProductImportItem,
  ProductImportPreview,
  ProductImportRun,
  ProductImportSource,
  ProductOnboardingState,
  ProductPackage,
  ProductPackageInstall,
  ProductPackagePreview,
  ProductReviewItem
} from "./product-launchpad-types";
import type {
  AssessmentFeedback,
  ConceptDetail,
  CourseDetail,
  CourseProgress,
  ForgeConcept,
  ForgeCourse,
  LearningSession
} from "./course-types";
import type {
  AgentAction,
  AgentOnboardingPayload,
  AgentIdentity,
  AgentRuntimeSessionHistory,
  AgentRuntimeSession,
  AgentTokenMutationResult,
  OperatorSession,
  CreateManualRewardGrantInput,
  ApprovalRequest,
  AttentionInboxPayload,
  AttentionInboxState,
  AttentionInboxStateRecord,
  AttentionPrimaryActionKey,
  AttentionResolutionCheckResponse,
  AttentionResolutionList,
  AttentionResolutionStartResult,
  EntityNavigationItem,
  EntityNavigationPayload,
  SavedView,
  Artifact,
  ArtifactAuditEvent,
  ArtifactDangerLevel,
  ArtifactEnrichmentApplyInput,
  ArtifactEnrichmentInput,
  ArtifactFormatFamily,
  ArtifactListResponse,
  ArtifactMetadataPatchInput,
  ArtifactState,
  ArtifactTrustPatchInput,
  ArtifactUploadInput,
  ArtifactVersion,
  CalendarAvailability,
  CalendarConnection,
  CalendarDiscoveryPayload,
  MacOSLocalCalendarDiscoveryPayload,
  MacOSCalendarAccessStatus,
  CalendarEvent,
  CalendarProjectionResult,
  GoogleCalendarOauthSession,
  MicrosoftCalendarOauthSession,
  CalendarOverviewPayload,
  CalendarResource,
  CalendarSchedulingRules,
  CompanionOverviewPayload,
  CompanionPairingQrPayload,
  CompanionPairingTransportMode,
  EventLogEntry,
  EntityLinkInput,
  FitnessViewData,
  TrainingLoadViewData,
  HealthZoneProfileRecord,
  GitHelperOverview,
  GitHelperSearchKind,
  GitHelperSearchResponse,
  FinalizeWeeklyReviewResult,
  Goal,
  Habit,
  ForgeSnapshot,
  Insight,
  OfflineTaskMutationInput,
  OfflineTaskMutationResponse,
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
  LifeEvent,
  LifeEventTicketImportResult,
  LifeEventTimelinePayload,
  FatigueSignalInput,
  TaskSplitInput,
  PreferenceContext,
  PreferenceDomain,
  PreferenceCatalog,
  PreferenceCatalogItemPage,
  PreferenceCatalogItem,
  PreferenceCatalogItemMutationInput,
  PreferenceCatalogItemPatchInput,
  PreferenceCatalogMutationInput,
  PreferenceCatalogPage,
  PreferenceCatalogPatchInput,
  PreferenceContextMergeInput,
  PreferenceContextMutationInput,
  PreferenceContextPatchInput,
  PreferenceGameStartInput,
  PreferenceItem,
  PreferenceItemMutationInput,
  PreferenceItemPatchInput,
  PreferenceItemScore,
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
  GamificationCatalogPayload,
  GamificationCelebration,
  GamificationAssetStatusPayload,
  GamificationEquipment,
  ForgeDoctorReport,
  DoctorFixResult,
  DeletedEntityRecord,
  SettingsPayload,
  SettingsBinPayload,
  MovementAllTimeData,
  MovementDayData,
  MovementKnownPlace,
  MovementBoxDetailData,
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
  WorkItem,
  TaskTimebox,
  TaskContext,
  TaskRun,
  TaskRunClaimInput,
  TaskRunCompleteInput,
  TaskRunReleaseInput,
  TaskRunHeartbeatInput,
  TodayPriorityDecision,
  DailyBriefing,
  UpdateRewardRuleInput,
  UserDirectoryPayload,
  UserDeactivationPreview,
  UserLifecycleReceipt,
  UserSummary,
  WeeklyReviewPayload,
  WikiEmbeddingProfile,
  WikiHealthPayload,
  WikiIngestJobPayload,
  WikiLlmConnectionTestResult,
  WikiPageDetailPayload,
  WikiPageSummary,
  WikiSearchResponse,
  WikiSettingsPayload,
  WikiSpace,
  WikiTreeNode,
  SleepViewData,
  WorkBlockTemplate,
  WorkoutSessionDetailPayload,
  XpMetricsPayload,
  CrudEntityType,
  CaptureConfirmation,
  CaptureIntent,
  CaptureProposal,
  CaptureReceipt,
  LocalSearchEntityKind,
  LocalSearchResponse,
  RelationshipProposalDecision,
  RelationshipProposalList,
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
  Flashcard,
  ModeGuideSession,
  ModeGuideSessionInput,
  ModeProfile,
  ModeProfileInput,
  PsycheMetricsViewData,
  PsycheOverviewPayload,
  PsycheObservationCalendarPayload,
  PsycheValue,
  PsycheValueInput,
  SchemaCatalogEntry,
  TriggerReport,
  TriggerReportDetailPayload,
  TriggerReportInput,
  TriggerReportPage
} from "./psyche-types";
import type { FlashcardInput } from "./psyche-schemas";
import type {
  CreateQuestionnaireInstrumentInput,
  QuestionnaireInstrumentDetail,
  QuestionnaireInstrumentSummary,
  QuestionnaireRunDetail,
  QuestionnaireAnswerInput,
  PublishQuestionnaireVersionInput,
  UpdateQuestionnaireVersionInput
} from "./questionnaire-types";
import type {
  KnowledgeGraphEntityType,
  KnowledgeGraphFocusPayload,
  KnowledgeGraphPayload,
  KnowledgeGraphQuery
} from "./knowledge-graph-types";
import type {
  NutritionAppearanceInput,
  NutritionCheckinInput,
  NutritionExperiment,
  NutritionExperimentInput,
  NutritionExperimentPatchInput,
  NutritionFoodLog,
  NutritionFoodLogInput,
  NutritionFoodLogPatchInput,
  NutritionFoodSearchResult,
  NutritionGutInput,
  NutritionSubjectiveInput,
  NutritionTarget,
  NutritionTargetPatchInput,
  WeightLossViewData
} from "./weight-loss-types";
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
import {
  BROWSER_CSRF_STORAGE_KEY,
  forgeBrowserRequestHeaders,
  noteBrowserSessionRejected,
  noteBrowserSessionUsable,
  readBrowserCsrfToken,
  responseProvesBrowserSession,
  UI_SOURCE_HEADER,
  UI_SOURCE_VALUE
} from "./browser-request-security";
import { publishUiDiagnosticLog } from "./diagnostics";
import { resolveForgePath } from "./runtime-paths";
import { normalizeForgeSnapshot } from "./snapshot-normalizer";
import type {
  MutationReceipt,
  MutationReceiptList,
  MutationReceiptUndoResult
} from "./mutation-receipts";

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

const DIAGNOSTICS_LOGS_PATH = "/api/v1/diagnostics/logs";
const LOCAL_BROWSER_BEGIN_PATH = "/api/v1/auth/local/browser/begin";
const LOCAL_BROWSER_EXCHANGE_PATH = "/api/v1/auth/local/browser/exchange";
const REMOTE_DEVICE_BEGIN_PATH = "/api/v1/auth/device";
const REMOTE_DEVICE_TOKEN_PATH = "/api/v1/auth/token";
const REMOTE_DEVICE_CANCEL_PATH = "/api/v1/auth/device/cancel";
const REMOTE_MASTER_PASSWORD_APPROVE_PATH =
  "/api/v1/auth/device/master-password/approve";
const REMOTE_BROWSER_REFRESH_PATH = "/api/v1/auth/browser/refresh";
const REMOTE_BROWSER_RENEWED_AT_KEY = "forge.browser.renewed-at";
const REMOTE_BROWSER_RENEWAL_INTERVAL_MS = 12 * 60 * 60 * 1_000;

type ParsedApiResponse = {
  response: Response;
  body: unknown;
};

function readResponseObject(body: unknown) {
  return typeof body === "object" && body !== null
    ? (body as Record<string, unknown>)
    : null;
}

function readApiErrorCode(body: unknown) {
  const maybeBody = readResponseObject(body);
  return typeof maybeBody?.code === "string"
    ? maybeBody.code
    : typeof maybeBody?.error === "string"
      ? maybeBody.error
      : "request_failed";
}

function readApiStatus(response: Response, body: unknown) {
  const statusCode = readResponseObject(body)?.statusCode;
  return typeof statusCode === "number" &&
    Number.isInteger(statusCode) &&
    statusCode >= 100 &&
    statusCode <= 599
    ? statusCode
    : response.status;
}

function isForgeFailure(response: Response, body: unknown) {
  return !response.ok || readApiStatus(response, body) >= 400;
}

function isAuthRequiredResponse(response: Response, body: unknown) {
  return (
    readApiStatus(response, body) === 401 &&
    [
      "auth_required",
      "gateway_authentication_required",
      "operator_browser_session_required"
    ].includes(readApiErrorCode(body))
  );
}

function rememberBrowserCsrfToken(value: string) {
  try {
    globalThis.localStorage?.setItem(BROWSER_CSRF_STORAGE_KEY, value);
  } catch {
    // A restrictive browser storage policy may disable same-origin storage.
    // The protected request will fail closed instead of persisting the
    // non-authenticating CSRF value.
  }
}

function readRemoteBrowserRenewedAt() {
  try {
    const value = Number(
      globalThis.localStorage?.getItem(REMOTE_BROWSER_RENEWED_AT_KEY)
    );
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function rememberRemoteBrowserRenewal(value = Date.now()) {
  try {
    globalThis.localStorage?.setItem(
      REMOTE_BROWSER_RENEWED_AT_KEY,
      String(value)
    );
  } catch {
    // This value is only a renewal throttle, never an authentication secret.
  }
}

function forgetRemoteBrowserRenewal() {
  try {
    globalThis.localStorage?.removeItem(REMOTE_BROWSER_RENEWED_AT_KEY);
  } catch {
    // A missing marker simply falls back to explicit pairing on expiry.
  }
}

function encodeBase64Url(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function isExactLoopbackHttpOrigin(value: string) {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) &&
      !parsed.username &&
      !parsed.password &&
      parsed.pathname === "/" &&
      !parsed.search &&
      !parsed.hash &&
      parsed.origin === value
    );
  } catch {
    return false;
  }
}

function validateLocalBrowserHandlerUrl(input: {
  value: unknown;
  transactionId: string;
  browserOrigin: string;
  browserNonce: string;
}) {
  if (typeof input.value !== "string") {
    return null;
  }
  try {
    const parsed = new URL(input.value);
    const keys = [...parsed.searchParams.keys()].sort();
    const apiOrigin = parsed.searchParams.get("apiOrigin");
    if (
      parsed.protocol !== "forge:" ||
      parsed.hostname !== "local-auth" ||
      parsed.pathname !== "" ||
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      keys.join(",") !== "apiOrigin,browserNonce,browserOrigin,transactionId" ||
      !apiOrigin ||
      !isExactLoopbackHttpOrigin(apiOrigin) ||
      parsed.searchParams.get("browserOrigin") !== input.browserOrigin ||
      parsed.searchParams.get("transactionId") !== input.transactionId ||
      parsed.searchParams.get("browserNonce") !== input.browserNonce
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function invokeLocalBrowserOwnerHandler(handlerUrl: string) {
  if (typeof document === "undefined" || !document.body) {
    throw new Error("The Forge browser owner handler cannot be opened.");
  }
  const link = document.createElement("a");
  link.href = handlerUrl;
  link.hidden = true;
  link.rel = "noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function isDiagnosticsLogPath(path: string) {
  return path === DIAGNOSTICS_LOGS_PATH;
}

function canReplayRequestBody(init?: RequestInit) {
  if (init?.body === undefined || init.body === null) {
    return true;
  }
  if (typeof init.body === "string") {
    return true;
  }
  if (
    typeof URLSearchParams !== "undefined" &&
    init.body instanceof URLSearchParams
  ) {
    return true;
  }
  if (typeof FormData !== "undefined" && init.body instanceof FormData) {
    return true;
  }
  if (typeof Blob !== "undefined" && init.body instanceof Blob) {
    return true;
  }
  if (typeof ArrayBuffer !== "undefined" && init.body instanceof ArrayBuffer) {
    return true;
  }
  if (ArrayBuffer.isView(init.body)) {
    return true;
  }
  return false;
}

function shouldBootstrapAndRetryBrowserSession(input: {
  path: string;
  init?: RequestInit;
  response: Response;
  body: unknown;
}) {
  return (
    input.path !== LOCAL_BROWSER_BEGIN_PATH &&
    input.path !== LOCAL_BROWSER_EXCHANGE_PATH &&
    input.path !== REMOTE_DEVICE_BEGIN_PATH &&
    input.path !== REMOTE_DEVICE_TOKEN_PATH &&
    input.path !== REMOTE_DEVICE_CANCEL_PATH &&
    input.path !== REMOTE_MASTER_PASSWORD_APPROVE_PATH &&
    isAuthRequiredResponse(input.response, input.body) &&
    canReplayRequestBody(input.init)
  );
}

function createApiError(path: string, response: Response, body: unknown) {
  const maybeBody = readResponseObject(body);
  const details = Array.isArray(maybeBody?.details)
    ? (maybeBody.details as ForgeValidationIssue[])
    : [];
  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfterSeconds =
    retryAfterHeader !== null && /^\d+$/.test(retryAfterHeader)
      ? Number(retryAfterHeader)
      : null;
  return new ForgeApiError({
    status: readApiStatus(response, body),
    code: readApiErrorCode(body),
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
          : null,
    retryAfterSeconds
  });
}

function publishRequestFailure(
  path: string,
  response: Response,
  body: unknown
) {
  if (isDiagnosticsLogPath(path)) {
    return;
  }
  const maybeBody = readResponseObject(body);
  const status = readApiStatus(response, body);
  const details = Array.isArray(maybeBody?.details)
    ? (maybeBody.details as ForgeValidationIssue[])
    : [];
  void publishUiDiagnosticLog({
    level: status >= 500 ? "error" : "warning",
    scope: "frontend_api",
    eventKey: "request_failed",
    message: `API request failed: ${path}`,
    route: path,
    functionName: "request",
    details: {
      statusCode: status,
      code: readApiErrorCode(body),
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

async function sendApiRequest(
  path: string,
  init?: RequestInit
): Promise<ParsedApiResponse> {
  const response = await fetchApi(path, init);
  const body = await parseResponseBody(response);
  if (
    response.ok &&
    readApiStatus(response, body) >= 400 &&
    path !== DIAGNOSTICS_LOGS_PATH
  ) {
    noteBrowserSessionRejected();
  }
  return { response, body };
}

async function fetchApi(path: string, init?: RequestInit) {
  const hadBrowserCsrf = readBrowserCsrfToken() !== null;
  const headers = forgeBrowserRequestHeaders(init?.headers);

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
      ...init,
      credentials: "same-origin",
      headers
    });
    if (path !== DIAGNOSTICS_LOGS_PATH) {
      if (response.ok && hadBrowserCsrf && responseProvesBrowserSession(path)) {
        noteBrowserSessionUsable();
      } else if (response.status === 401 || response.status === 403) {
        noteBrowserSessionRejected();
      }
    }
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "AbortError"
    ) {
      throw error;
    }
    if (!isDiagnosticsLogPath(path)) {
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

  return response;
}

type PreparedLocalBrowserAuthorization = {
  transactionId: string;
  browserOrigin: string;
  browserNonce: string;
  handlerUrl: string;
  privateKey: CryptoKey;
  approvalMode: LocalBrowserApprovalMode;
  handlerLaunched: boolean;
};

type LocalBrowserApprovalMode = "automatic" | "interactive";

let browserSessionBootstrapPromise: Promise<void> | null = null;
let remoteBrowserRenewalPromise: Promise<boolean> | null = null;
let browserAuthorizationPreparationPromise: Promise<PreparedLocalBrowserAuthorization> | null =
  null;
let preparedLocalBrowserAuthorization: PreparedLocalBrowserAuthorization | null =
  null;
let browserSessionBootstrapBlocked = false;

async function performRemoteBrowserRenewal() {
  const renewed = await sendApiRequest(REMOTE_BROWSER_REFRESH_PATH, {
    method: "POST"
  });
  if (!renewed.response.ok) {
    if (renewed.response.status === 401 || renewed.response.status === 403) {
      forgetRemoteBrowserRenewal();
      return false;
    }
    throw createApiError(
      REMOTE_BROWSER_REFRESH_PATH,
      renewed.response,
      renewed.body
    );
  }
  const body = readResponseObject(renewed.body);
  if (typeof body?.csrfToken !== "string") {
    throw new ForgeApiError({
      status: 502,
      code: "browser_refresh_response_invalid",
      message: "Forge returned an invalid paired-browser renewal response.",
      requestPath: REMOTE_BROWSER_REFRESH_PATH,
      details: []
    });
  }
  rememberBrowserCsrfToken(body.csrfToken);
  rememberRemoteBrowserRenewal();
  return true;
}

async function renewRemoteBrowserSession(force: boolean) {
  const lastRenewedAt = readRemoteBrowserRenewedAt();
  if (
    lastRenewedAt === null ||
    (!force && Date.now() - lastRenewedAt < REMOTE_BROWSER_RENEWAL_INTERVAL_MS)
  ) {
    return false;
  }
  if (!remoteBrowserRenewalPromise) {
    remoteBrowserRenewalPromise = (async () => {
      const locks = (
        globalThis.navigator as Navigator & {
          locks?: {
            request<T>(name: string, callback: () => Promise<T>): Promise<T>;
          };
        }
      )?.locks;
      const renewAfterCrossTabCheck = async () => {
        const current = readRemoteBrowserRenewedAt();
        if (
          !force &&
          current !== null &&
          Date.now() - current < REMOTE_BROWSER_RENEWAL_INTERVAL_MS
        ) {
          return false;
        }
        return performRemoteBrowserRenewal();
      };
      return locks
        ? locks.request("forge-remote-browser-renewal", renewAfterCrossTabCheck)
        : renewAfterCrossTabCheck();
    })().finally(() => {
      remoteBrowserRenewalPromise = null;
    });
  }
  return remoteBrowserRenewalPromise;
}

function assertLocalBrowserAuthorizationSupport() {
  if (
    typeof window === "undefined" ||
    !isExactLoopbackHttpOrigin(window.location.origin)
  ) {
    throw new ForgeApiError({
      status: 401,
      code: "browser_pairing_required",
      message:
        "This browser is not authorized for Forge. Local loopback browsers can use the owner handler; remote browsers must complete device pairing.",
      requestPath: LOCAL_BROWSER_BEGIN_PATH,
      details: []
    });
  }
  if (!globalThis.crypto?.subtle) {
    throw new ForgeApiError({
      status: 503,
      code: "browser_proof_unavailable",
      message:
        "This browser cannot create the proof required for secure local authorization.",
      requestPath: LOCAL_BROWSER_BEGIN_PATH,
      details: []
    });
  }
}

async function prepareLocalBrowserAuthorizationTransaction(
  approvalMode: LocalBrowserApprovalMode
) {
  assertLocalBrowserAuthorizationSupport();
  if (preparedLocalBrowserAuthorization?.approvalMode === approvalMode) {
    return preparedLocalBrowserAuthorization;
  }
  if (preparedLocalBrowserAuthorization) {
    preparedLocalBrowserAuthorization = null;
  }
  if (!browserAuthorizationPreparationPromise) {
    browserAuthorizationPreparationPromise = (async () => {
      const browserOrigin = window.location.origin;
      const browserNonceBytes = new Uint8Array(32);
      globalThis.crypto.getRandomValues(browserNonceBytes);
      const browserNonce = encodeBase64Url(browserNonceBytes);
      const browserKeys = await globalThis.crypto.subtle.generateKey(
        {
          name: "ECDSA",
          namedCurve: "P-256"
        },
        true,
        ["sign", "verify"]
      );
      const browserPublicKey = await globalThis.crypto.subtle.exportKey(
        "jwk",
        browserKeys.publicKey
      );
      const begin = await sendApiRequest(LOCAL_BROWSER_BEGIN_PATH, {
        method: "POST",
        body: JSON.stringify({
          browserOrigin,
          browserNonce,
          browserPublicKey,
          approvalMode
        })
      });
      if (!begin.response.ok) {
        publishRequestFailure(
          LOCAL_BROWSER_BEGIN_PATH,
          begin.response,
          begin.body
        );
        throw createApiError(
          LOCAL_BROWSER_BEGIN_PATH,
          begin.response,
          begin.body
        );
      }
      const transaction = readResponseObject(begin.body);
      const transactionId =
        typeof transaction?.transactionId === "string"
          ? transaction.transactionId
          : "";
      if (!/^[A-Za-z0-9._-]{16,160}$/.test(transactionId)) {
        throw new ForgeApiError({
          status: 502,
          code: "local_browser_transaction_invalid",
          message:
            "Forge returned an invalid local browser authorization transaction.",
          requestPath: LOCAL_BROWSER_BEGIN_PATH,
          details: []
        });
      }
      const handlerUrl = validateLocalBrowserHandlerUrl({
        value: transaction?.handlerUrl,
        transactionId,
        browserOrigin,
        browserNonce
      });
      if (!handlerUrl) {
        throw new ForgeApiError({
          status: 502,
          code: "local_browser_handler_invalid",
          message:
            "Forge returned an invalid local browser owner-handler request.",
          requestPath: LOCAL_BROWSER_BEGIN_PATH,
          details: []
        });
      }
      const prepared = {
        transactionId,
        browserOrigin,
        browserNonce,
        handlerUrl,
        privateKey: browserKeys.privateKey,
        approvalMode,
        handlerLaunched: transaction?.handlerLaunched === true
      };
      preparedLocalBrowserAuthorization = prepared;
      return prepared;
    })().finally(() => {
      browserAuthorizationPreparationPromise = null;
    });
  }
  return browserAuthorizationPreparationPromise;
}

async function exchangePreparedLocalBrowserAuthorization() {
  const prepared = preparedLocalBrowserAuthorization;
  if (!prepared) {
    throw new ForgeApiError({
      status: 409,
      code: "local_browser_transaction_missing",
      message: "Prepare local browser authorization before approving it.",
      requestPath: LOCAL_BROWSER_EXCHANGE_PATH,
      details: []
    });
  }
  const proofPayload = new TextEncoder().encode(
    [
      "forge-local-browser-exchange/1",
      prepared.transactionId,
      prepared.browserOrigin,
      prepared.browserNonce
    ].join("\n")
  );
  const browserProof = encodeBase64Url(
    await globalThis.crypto.subtle.sign(
      {
        name: "ECDSA",
        hash: "SHA-256"
      },
      prepared.privateKey,
      proofPayload
    )
  );
  const { response, body } = await sendApiRequest(LOCAL_BROWSER_EXCHANGE_PATH, {
    method: "POST",
    body: JSON.stringify({
      transactionId: prepared.transactionId,
      browserOrigin: prepared.browserOrigin,
      browserNonce: prepared.browserNonce,
      browserProof
    })
  });
  if (isForgeFailure(response, body)) {
    preparedLocalBrowserAuthorization = null;
    publishRequestFailure(LOCAL_BROWSER_EXCHANGE_PATH, response, body);
    throw createApiError(LOCAL_BROWSER_EXCHANGE_PATH, response, body);
  }
  const parsed = readResponseObject(body);
  if (typeof parsed?.csrfToken !== "string") {
    preparedLocalBrowserAuthorization = null;
    throw new ForgeApiError({
      status: 502,
      code: "local_browser_exchange_invalid",
      message: "Forge returned an invalid browser authorization response.",
      requestPath: LOCAL_BROWSER_EXCHANGE_PATH,
      details: []
    });
  }
  rememberBrowserCsrfToken(parsed.csrfToken);
  preparedLocalBrowserAuthorization = null;
  browserSessionBootstrapBlocked = false;
}

export function getPreparedLocalBrowserAuthorizationUrl() {
  return preparedLocalBrowserAuthorization?.handlerUrl ?? null;
}

export async function prepareLocalBrowserAuthorization() {
  const prepared =
    await prepareLocalBrowserAuthorizationTransaction("interactive");
  return prepared.handlerUrl;
}

export async function completePreparedLocalBrowserAuthorization() {
  await exchangePreparedLocalBrowserAuthorization();
}

export async function authorizePreparedLocalBrowser() {
  const prepared = preparedLocalBrowserAuthorization;
  if (!prepared) {
    throw new ForgeApiError({
      status: 409,
      code: "local_browser_transaction_missing",
      message: "Prepare local browser authorization before approving it.",
      requestPath: LOCAL_BROWSER_EXCHANGE_PATH,
      details: []
    });
  }
  if (!prepared.handlerLaunched) {
    invokeLocalBrowserOwnerHandler(prepared.handlerUrl);
  }
  await exchangePreparedLocalBrowserAuthorization();
}

export function retryLocalBrowserAuthorization() {
  browserSessionBootstrapBlocked = false;
}

type RemoteBrowserPairing = {
  requestId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalSeconds: number;
  masterPasswordAvailable: boolean;
  privateKey: CryptoKey;
  publicJwk: JsonWebKey;
  cancelProof?: string;
};

function randomProofId(prefix: string) {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}-${encodeBase64Url(bytes)}`;
}

async function p256Thumbprint(publicJwk: JsonWebKey) {
  if (
    publicJwk.kty !== "EC" ||
    publicJwk.crv !== "P-256" ||
    typeof publicJwk.x !== "string" ||
    typeof publicJwk.y !== "string"
  ) {
    throw new Error("Forge browser pairing produced an invalid public key.");
  }
  const canonical = JSON.stringify({
    crv: publicJwk.crv,
    kty: publicJwk.kty,
    x: publicJwk.x,
    y: publicJwk.y
  });
  return encodeBase64Url(
    await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonical)
    )
  );
}

async function signPairingProof(
  pairing: RemoteBrowserPairing,
  operation: "poll" | "cancel" | "master_key_approve"
) {
  const encodedHeader = encodeBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        alg: "ES256",
        typ: "forge-pairing+jwt",
        jwk: pairing.publicJwk
      })
    )
  );
  const encodedPayload = encodeBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        request_id: pairing.requestId,
        operation,
        iat: Math.floor(Date.now() / 1_000),
        jti: randomProofId("browser-pairing")
      })
    )
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await globalThis.crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    pairing.privateKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${encodeBase64Url(signature)}`;
}

export async function beginRemoteBrowserPairing() {
  if (
    typeof window === "undefined" ||
    !globalThis.crypto?.subtle ||
    window.location.protocol !== "https:"
  ) {
    throw new ForgeApiError({
      status: 400,
      code: "remote_browser_https_required",
      message: "Remote Forge browser pairing requires HTTPS.",
      requestPath: REMOTE_DEVICE_BEGIN_PATH,
      details: []
    });
  }
  const keys = await globalThis.crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const publicJwk = await globalThis.crypto.subtle.exportKey(
    "jwk",
    keys.publicKey
  );
  const started = await sendApiRequest(REMOTE_DEVICE_BEGIN_PATH, {
    method: "POST",
    body: JSON.stringify({
      clientName: `Forge browser on ${navigator.platform || "this device"}`,
      clientType: "browser",
      clientKeyThumbprint: await p256Thumbprint(publicJwk),
      requestedScopes: ["read", "write"],
      requestedProfile: "trusted_personal_assistant"
    })
  });
  if (!started.response.ok) {
    throw createApiError(
      REMOTE_DEVICE_BEGIN_PATH,
      started.response,
      started.body
    );
  }
  const body = readResponseObject(started.body);
  if (
    typeof body?.requestId !== "string" ||
    typeof body.deviceCode !== "string" ||
    typeof body.userCode !== "string" ||
    typeof body.verificationUri !== "string" ||
    typeof body.expiresIn !== "number" ||
    typeof body.interval !== "number" ||
    typeof body.masterPasswordAvailable !== "boolean"
  ) {
    throw new ForgeApiError({
      status: 502,
      code: "remote_pairing_response_invalid",
      message: "Forge returned an invalid remote pairing response.",
      requestPath: REMOTE_DEVICE_BEGIN_PATH,
      details: []
    });
  }
  const pairing: RemoteBrowserPairing = {
    requestId: body.requestId,
    deviceCode: body.deviceCode,
    userCode: body.userCode,
    verificationUri: body.verificationUri,
    expiresAt: Date.now() + body.expiresIn * 1_000,
    intervalSeconds: Math.max(5, body.interval),
    masterPasswordAvailable: body.masterPasswordAvailable,
    privateKey: keys.privateKey,
    publicJwk
  };
  pairing.cancelProof = await signPairingProof(pairing, "cancel");
  return pairing;
}

export async function approveRemoteBrowserPairingWithMasterPassword(
  pairing: RemoteBrowserPairing,
  password: string
) {
  const approved = await sendApiRequest(REMOTE_MASTER_PASSWORD_APPROVE_PATH, {
    method: "POST",
    body: JSON.stringify({
      requestId: pairing.requestId,
      userCode: pairing.userCode,
      password,
      clientProof: await signPairingProof(pairing, "master_key_approve")
    })
  });
  if (!approved.response.ok) {
    throw createApiError(
      REMOTE_MASTER_PASSWORD_APPROVE_PATH,
      approved.response,
      approved.body
    );
  }
}

export async function pollRemoteBrowserPairing(pairing: RemoteBrowserPairing) {
  if (Date.now() >= pairing.expiresAt) {
    return { status: "expired_token" as const };
  }
  const polled = await sendApiRequest(REMOTE_DEVICE_TOKEN_PATH, {
    method: "POST",
    body: JSON.stringify({
      grantType: "device_code",
      deviceCode: pairing.deviceCode,
      clientProof: await signPairingProof(pairing, "poll")
    })
  });
  const body = readResponseObject(polled.body);
  if (polled.response.ok) {
    if (typeof body?.csrfToken !== "string") {
      throw new ForgeApiError({
        status: 502,
        code: "remote_pairing_exchange_invalid",
        message: "Forge returned an invalid browser session exchange.",
        requestPath: REMOTE_DEVICE_TOKEN_PATH,
        details: []
      });
    }
    rememberBrowserCsrfToken(body.csrfToken);
    rememberRemoteBrowserRenewal();
    return { status: "approved" as const };
  }
  if (
    body?.status === "authorization_pending" ||
    body?.status === "slow_down" ||
    body?.status === "access_denied" ||
    body?.status === "expired_token"
  ) {
    const intervalSeconds =
      typeof body.intervalSeconds === "number"
        ? Math.max(5, body.intervalSeconds)
        : pairing.intervalSeconds;
    return { status: body.status, intervalSeconds };
  }
  throw createApiError(REMOTE_DEVICE_TOKEN_PATH, polled.response, polled.body);
}

export async function cancelRemoteBrowserPairing(
  pairing: RemoteBrowserPairing
) {
  const cancelled = await sendApiRequest(REMOTE_DEVICE_CANCEL_PATH, {
    method: "POST",
    body: JSON.stringify({
      deviceCode: pairing.deviceCode,
      clientProof: await signPairingProof(pairing, "cancel")
    })
  });
  if (!cancelled.response.ok) {
    throw createApiError(
      REMOTE_DEVICE_CANCEL_PATH,
      cancelled.response,
      cancelled.body
    );
  }
}

export async function refreshRemoteBrowserPairingCancelProof(
  pairing: RemoteBrowserPairing
) {
  pairing.cancelProof = await signPairingProof(pairing, "cancel");
}

export function cancelRemoteBrowserPairingOnPageExit(
  pairing: RemoteBrowserPairing
) {
  if (!pairing.cancelProof) return;
  void globalThis
    .fetch(REMOTE_DEVICE_CANCEL_PATH, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        deviceCode: pairing.deviceCode,
        clientProof: pairing.cancelProof
      }),
      keepalive: true
    })
    .catch(() => {
      // The request expires quickly even if the browser cannot finish unload.
    });
}

export type RemotePairingReview = {
  requestId: string;
  clientName: string;
  clientType: "api" | "browser";
  audience: string;
  requestedScopes: string[];
  requestedProfile:
    | "viewer"
    | "trusted_personal_assistant"
    | "executor"
    | "operator"
    | "custom";
  expiresAt: string;
  installationFingerprint: string;
  endpoint: {
    origin: string | null;
    fingerprint: string;
  };
  boundaries: {
    resources: {
      profile: string;
      scopes: string[];
      enforcement: "profile_scopes_and_route_policy";
    };
    egress: {
      requestedScopes: string[];
      enforcement: "capability_policy_and_destination_validation";
      default: "denied_unless_capability_explicitly_allows";
    };
  };
};

export type RemotePairingRequest = RemotePairingReview & {
  status: "pending" | "approved";
  approvedAt: string | null;
  clientId: string | null;
};

export type MasterPasswordStatus = {
  configured: boolean;
  configuredAt: string | null;
  updatedAt: string | null;
  minimumLength: number;
  maximumLength: number;
};

export function getMasterPasswordStatus() {
  return request<MasterPasswordStatus>("/api/v1/auth/master-password");
}

export function setMasterPassword(input: {
  password: string;
  confirmation: string;
  currentPassword?: string;
}) {
  return request<MasterPasswordStatus>("/api/v1/auth/master-password", {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function listRemotePairingRequests() {
  return request<{ requests: RemotePairingRequest[] }>(
    "/api/v1/auth/device/requests"
  );
}

export function approveRemotePairingRequest(
  requestId: string,
  userCode: string
) {
  return request<{
    requestId: string;
    clientId: string;
    clientName: string;
    audience: string;
    scopes: string[];
    profile: RemotePairingReview["requestedProfile"];
  }>(`/api/v1/auth/device/requests/${encodeURIComponent(requestId)}/approve`, {
    method: "POST",
    body: JSON.stringify({ userCode })
  });
}

export function denyRemotePairingRequest(requestId: string) {
  return request<{ denied: boolean }>(
    `/api/v1/auth/device/requests/${encodeURIComponent(requestId)}/deny`,
    {
      method: "POST",
      body: JSON.stringify({})
    }
  );
}

export function reviewRemotePairing(userCode: string) {
  return request<RemotePairingReview>("/api/v1/auth/device/review", {
    method: "POST",
    body: JSON.stringify({ userCode })
  });
}

export function approveRemotePairing(
  userCode: string,
  review: RemotePairingReview
) {
  return request("/api/v1/auth/device/approve", {
    method: "POST",
    body: JSON.stringify({
      userCode,
      scopes: review.requestedScopes,
      profile: review.requestedProfile
    })
  });
}

export type PrivilegedPairingStepUpOptions = {
  challengeId: string;
  ceremony: "register" | "authenticate";
  options: unknown;
  review: RemotePairingReview;
};

export function beginPrivilegedPairingStepUp(
  userCode: string,
  credentialLabel = "Forge owner passkey"
) {
  return request<PrivilegedPairingStepUpOptions>(
    "/api/v1/auth/device/step-up/options",
    {
      method: "POST",
      body: JSON.stringify({ userCode, credentialLabel })
    }
  );
}

export function completePrivilegedPairingStepUp(input: {
  userCode: string;
  review: RemotePairingReview;
  challengeId: string;
  response: unknown;
  credentialLabel?: string;
}) {
  return request("/api/v1/auth/device/step-up/verify", {
    method: "POST",
    body: JSON.stringify({
      userCode: input.userCode,
      requestId: input.review.requestId,
      scopes: input.review.requestedScopes,
      profile: input.review.requestedProfile,
      challengeId: input.challengeId,
      response: input.response,
      credentialLabel: input.credentialLabel ?? "Forge owner passkey"
    })
  });
}

export function denyRemotePairing(userCode: string) {
  return request("/api/v1/auth/device/deny", {
    method: "POST",
    body: JSON.stringify({ userCode })
  });
}

export type RemoteClientRegistration = {
  id: string;
  clientName: string;
  clientType: "api" | "browser";
  audience: string;
  profile: RemotePairingReview["requestedProfile"];
  scopes: string[];
  createdAt: string;
  revokedAt: string | null;
  activationState: "awaiting_client" | "active" | "expired" | "revoked";
};

export function listRemoteClients() {
  return request<{ clients: RemoteClientRegistration[] }>(
    "/api/v1/auth/clients"
  );
}

export function revokeRemoteClient(clientId: string) {
  return request<{ revoked: boolean }>(
    `/api/v1/auth/clients/${encodeURIComponent(clientId)}/revoke`,
    { method: "POST" }
  );
}

async function bootstrapBrowserSession() {
  if (browserSessionBootstrapBlocked) {
    throw new ForgeApiError({
      status: 401,
      code: "browser_pairing_required",
      message:
        "This browser is not authorized for Forge. Use the visible local authorization control, or complete remote device pairing.",
      requestPath: LOCAL_BROWSER_BEGIN_PATH,
      details: []
    });
  }
  if (!browserSessionBootstrapPromise) {
    browserSessionBootstrapPromise = (async () => {
      const prepared =
        await prepareLocalBrowserAuthorizationTransaction("automatic");
      if (!prepared.handlerLaunched) {
        invokeLocalBrowserOwnerHandler(prepared.handlerUrl);
      }
      try {
        await exchangePreparedLocalBrowserAuthorization();
      } catch (error) {
        try {
          await prepareLocalBrowserAuthorizationTransaction("interactive");
        } catch {
          // The original exchange error is more useful. A failed replacement
          // staging attempt does not launch or retry the owner handler.
        }
        throw error;
      }
    })()
      .catch((error) => {
        browserSessionBootstrapBlocked = true;
        throw error;
      })
      .finally(() => {
        browserSessionBootstrapPromise = null;
      });
  }
  await browserSessionBootstrapPromise;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const remoteRenewalEligible =
    path !== REMOTE_BROWSER_REFRESH_PATH &&
    path !== REMOTE_DEVICE_BEGIN_PATH &&
    path !== REMOTE_DEVICE_TOKEN_PATH &&
    path !== REMOTE_DEVICE_CANCEL_PATH &&
    path !== REMOTE_MASTER_PASSWORD_APPROVE_PATH;
  if (remoteRenewalEligible) {
    await renewRemoteBrowserSession(false);
  }
  let { response, body } = await sendApiRequest(path, init);

  if (shouldBootstrapAndRetryBrowserSession({ path, init, response, body })) {
    const renewed =
      remoteRenewalEligible && readRemoteBrowserRenewedAt() !== null
        ? await renewRemoteBrowserSession(true)
        : false;
    if (!renewed) {
      await bootstrapBrowserSession();
    }
    ({ response, body } = await sendApiRequest(path, init));
  }

  if (isForgeFailure(response, body)) {
    publishRequestFailure(path, response, body);
    throw createApiError(path, response, body);
  }

  return body as T;
}

export function requestForgeBrowserJson(
  path: string,
  init?: RequestInit
): Promise<unknown> {
  return request<unknown>(path, init);
}

async function requestBlob(
  path: string,
  init?: RequestInit
): Promise<{ blob: Blob; fileName: string | null; mimeType: string }> {
  let response = await fetchApi(path, init);
  let body: unknown = null;
  if (!response.ok) {
    body = await parseResponseBody(response);
  }
  if (shouldBootstrapAndRetryBrowserSession({ path, init, response, body })) {
    await bootstrapBrowserSession();
    response = await fetchApi(path, init);
    body = response.ok ? null : await parseResponseBody(response);
  }
  if (!response.ok) {
    publishRequestFailure(path, response, body);
    throw createApiError(path, response, body);
  }
  const disposition = response.headers.get("content-disposition");
  const fileNameMatch = disposition?.match(/filename="([^"]+)"/i);
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
  search.set("profile", "shell");
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<ForgeSnapshot>(`/api/v1/context${suffix}`).then(
    normalizeForgeSnapshot
  );
}

export function getTodayPriorityDecision(input: {
  userIds?: string[] | unknown;
  timeZone?: string;
  candidateLimit?: number;
}) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(input.userIds));
  if (input.timeZone?.trim()) {
    search.set("timeZone", input.timeZone.trim());
  }
  if (typeof input.candidateLimit === "number") {
    search.set("candidateLimit", String(input.candidateLimit));
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ decision: TodayPriorityDecision }>(
    `/api/v1/today/priority${suffix}`
  );
}

export function getDailyBriefing(input: { userId: string; timeZone?: string }) {
  const search = new URLSearchParams({ userId: input.userId });
  if (input.timeZone?.trim()) {
    search.set("timeZone", input.timeZone.trim());
  }
  return request<{ briefing: DailyBriefing }>(
    `/api/v1/daily-briefing?${search.toString()}`
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

export function getLifeEventsTimeline(input?: {
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
  offset?: number;
  eventTypes?: string[];
  userIds?: string[];
}) {
  const search = new URLSearchParams();
  if (input?.from) {
    search.set("from", input.from);
  }
  if (input?.to) {
    search.set("to", input.to);
  }
  if (input?.q) {
    search.set("q", input.q);
  }
  if (typeof input?.limit === "number") {
    search.set("limit", String(input.limit));
  }
  if (typeof input?.offset === "number") {
    search.set("offset", String(input.offset));
  }
  for (const eventType of input?.eventTypes ?? []) {
    search.append("eventTypes", eventType);
  }
  appendUserIds(search, input?.userIds);
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ timeline: LifeEventTimelinePayload }>(
    `/api/v1/life-events/timeline${suffix}`
  );
}

export function getLifeEvent(id: string) {
  return request<{ lifeEvent: LifeEvent }>(
    `/api/v1/life-events/${encodeURIComponent(id)}`
  );
}

export function syncLifeEventCalendar(
  id: string,
  input: {
    projection?: "link_or_create" | "link_existing_only" | "none";
    preferredCalendarId?: string | null;
  } = {}
) {
  return request<{
    lifeEvent: LifeEvent;
    calendarEvent: CalendarEvent | null;
    action: string;
    confidence: number | null;
  }>(`/api/v1/life-events/${id}/calendar-sync`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function createLifeEventFromCalendar(input: {
  calendarEventId: string;
  eventType?: string;
  importance?: string;
}) {
  return request<{
    lifeEvent: LifeEvent;
    calendarEvent: CalendarEvent | null;
    action: string;
  }>("/api/v1/life-events/from-calendar-event", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function importLifeEventTicket(input: {
  artifactId: string;
  extractedText?: string;
  createDraft?: boolean;
  useLlm?: boolean;
  llmProfileId?: string;
  previewFingerprint?: string;
}) {
  return request<LifeEventTicketImportResult>(
    "/api/v1/life-events/import-ticket",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function getLifeEventTravelStatus(id: string) {
  return request<{
    status: {
      lifeEventId: string;
      status: string;
      source: string;
      provider: string | null;
      providerConfigured: boolean;
      providerOptions: string[];
      checkedAt: string;
      flightNumber: string | null;
      message: string;
    };
  }>(`/api/v1/life-events/${id}/travel-status`);
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

export function getRelationshipProposals(ownerUserId: string, limit = 20) {
  const search = new URLSearchParams({
    ownerUserId,
    limit: String(limit)
  });
  return request<RelationshipProposalList>(
    `/api/v1/relationship-proposals?${search.toString()}`
  );
}

export function generateRelationshipProposals(ownerUserId: string) {
  return request<RelationshipProposalList>(
    "/api/v1/relationship-proposals/generate",
    {
      method: "POST",
      body: JSON.stringify({ ownerUserId })
    }
  );
}

export function decideRelationshipProposal(input: {
  proposalId: string;
  ownerUserId: string;
  expectedRevision: number;
  action: "accept" | "reject";
}) {
  return request<{ decision: RelationshipProposalDecision }>(
    `/api/v1/relationship-proposals/${encodeURIComponent(input.proposalId)}/${input.action}`,
    {
      method: "POST",
      body: JSON.stringify({
        ownerUserId: input.ownerUserId,
        expectedRevision: input.expectedRevision
      })
    }
  );
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
  if (query.itemLimit !== undefined) {
    search.set("itemLimit", String(query.itemLimit));
  }
  if (query.itemOffset !== undefined) {
    search.set("itemOffset", String(query.itemOffset));
  }
  if (query.historyLimit !== undefined) {
    search.set("historyLimit", String(query.historyLimit));
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ workspace: PreferenceWorkspacePayload }>(
    `/api/v1/preferences/workspace${suffix}`
  );
}

export function refreshPreferenceWorkspace(
  input: PreferenceWorkspaceQuery & {
    userId: string;
    domain: PreferenceDomain;
  }
) {
  return request<{ workspace: PreferenceWorkspacePayload }>(
    "/api/v1/preferences/workspace/refresh",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
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
  const { idempotencyKey, ...body } = input;
  return request<{ catalog: PreferenceCatalog }>(
    "/api/v1/preferences/catalogs",
    {
      method: "POST",
      headers: {
        "Idempotency-Key": idempotencyKey ?? crypto.randomUUID()
      },
      body: JSON.stringify(body)
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

export function getPreferenceCatalogs(query: {
  userId?: string;
  domain?: string;
  query?: string;
  limit?: number;
  offset?: number;
  cursor?: string;
}) {
  const search = new URLSearchParams();
  if (query.userId) search.set("userId", query.userId);
  if (query.domain) search.set("domain", query.domain);
  if (query.query?.trim()) search.set("query", query.query.trim());
  if (typeof query.limit === "number") search.set("limit", String(query.limit));
  if (typeof query.offset === "number")
    search.set("offset", String(query.offset));
  if (query.cursor) search.set("cursor", query.cursor);
  return request<PreferenceCatalogPage>(
    `/api/v1/preferences/catalogs?${search.toString()}`
  );
}

export function getPreferenceCatalogItems(query: {
  catalogId: string;
  query?: string;
  limit?: number;
  offset?: number;
  cursor?: string;
}) {
  const search = new URLSearchParams({ catalogId: query.catalogId });
  if (query.query?.trim()) {
    search.set("query", query.query.trim());
  }
  if (typeof query.limit === "number") {
    search.set("limit", String(query.limit));
  }
  if (typeof query.offset === "number") {
    search.set("offset", String(query.offset));
  }
  if (query.cursor) {
    search.set("cursor", query.cursor);
  }
  return request<PreferenceCatalogItemPage>(
    `/api/v1/preferences/catalog-items?${search.toString()}`
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
  const { idempotencyKey, ...body } = input;
  return request<{
    judgment: PairwiseJudgment;
    mutationReceipt: MutationReceipt;
  }>("/api/v1/preferences/judgments", {
    method: "POST",
    headers: {
      "Idempotency-Key": idempotencyKey ?? crypto.randomUUID()
    },
    body: JSON.stringify(body)
  });
}

export function submitPreferenceSignal(input: PreferenceSignalInput) {
  const { idempotencyKey, ...body } = input;
  return request<{ signal: AbsoluteSignal; score: PreferenceItemScore }>(
    "/api/v1/preferences/signals",
    {
      method: "POST",
      headers: {
        "Idempotency-Key": idempotencyKey ?? crypto.randomUUID()
      },
      body: JSON.stringify(body)
    }
  );
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

export function getPsycheMetricsView(
  input: { userIds?: string[] | unknown; timeZone?: string } = {}
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(input.userIds));
  if (input.timeZone?.trim()) {
    search.set("timeZone", input.timeZone.trim());
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ metrics: PsycheMetricsViewData }>(
    `/api/v1/psyche/metrics${suffix}`
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

export function getQuestionnaire(
  instrumentId: string,
  userIds?: string[] | unknown
) {
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
  input: PublishQuestionnaireVersionInput
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

export function getQuestionnaireRun(
  runId: string,
  userIds?: string[] | unknown
) {
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

function readBatchEntity<T>(result: Record<string, unknown>): T {
  if (result.ok !== true || !result.entity) {
    const error =
      typeof result.error === "object" && result.error !== null
        ? JSON.stringify(result.error)
        : "Batch entity operation failed.";
    throw new Error(error);
  }
  return result.entity as T;
}

export async function listFlashcards(userIds?: string[] | unknown) {
  const response = await searchEntities({
    searches: [
      {
        entityTypes: ["flashcard"],
        userIds: coerceUserIds(userIds),
        limit: 200
      }
    ]
  });
  const matches = (response.results[0]?.matches ?? []) as Flashcard[];
  return { flashcards: matches };
}

export async function createFlashcard(input: FlashcardInput) {
  const response = await createEntities({
    operations: [{ entityType: "flashcard", data: input }],
    atomic: true
  });
  return { flashcard: readBatchEntity<Flashcard>(response.results[0] ?? {}) };
}

export async function patchFlashcard(
  flashcardId: string,
  patch: Partial<FlashcardInput>
) {
  const response = await updateEntities({
    operations: [{ entityType: "flashcard", id: flashcardId, patch }],
    atomic: true
  });
  return { flashcard: readBatchEntity<Flashcard>(response.results[0] ?? {}) };
}

export async function deleteFlashcard(flashcardId: string) {
  const response = await deleteEntities({
    operations: [{ entityType: "flashcard", id: flashcardId }],
    atomic: true
  });
  return { flashcard: readBatchEntity<Flashcard>(response.results[0] ?? {}) };
}

export function listEventTypes(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ eventTypes: EventType[] }>(
    `/api/v1/psyche/event-types${suffix}`
  );
}

export function getEventType(eventTypeId: string) {
  return request<{ eventType: EventType }>(
    `/api/v1/psyche/event-types/${eventTypeId}`
  );
}

export function createEventType(
  input: EventTypeInput,
  options?: { idempotencyKey?: string }
) {
  return request<{ eventType: EventType }>("/api/v1/psyche/event-types", {
    method: "POST",
    headers: options?.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : undefined,
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

export function listEmotionDefinitions(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ emotions: EmotionDefinition[] }>(
    `/api/v1/psyche/emotions${suffix}`
  );
}

export function getEmotionDefinition(emotionId: string) {
  return request<{ emotion: EmotionDefinition }>(
    `/api/v1/psyche/emotions/${emotionId}`
  );
}

export function createEmotionDefinition(
  input: EmotionDefinitionInput,
  options?: { idempotencyKey?: string }
) {
  return request<{ emotion: EmotionDefinition }>("/api/v1/psyche/emotions", {
    method: "POST",
    headers: options?.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : undefined,
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

export function listTriggerReports(
  userIds?: string[] | unknown,
  options?: { limit?: number; cursor?: string | null }
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  if (options?.limit) {
    search.set("limit", String(options.limit));
  }
  if (options?.cursor) {
    search.set("cursor", options.cursor);
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<TriggerReportPage>(`/api/v1/psyche/reports${suffix}`);
}

export function createTriggerReport(
  input: TriggerReportInput,
  options?: { idempotencyKey?: string }
) {
  return request<{ report: TriggerReport }>("/api/v1/psyche/reports", {
    method: "POST",
    headers: options?.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : undefined,
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
  patch: Partial<TriggerReportInput> & { expectedRevision: number }
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
    includeAnchorless?: boolean;
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
    observedFrom?: string;
    observedTo?: string;
    limit?: number;
    cursor?: string;
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
  if (input.includeAnchorless) {
    search.set("includeAnchorless", "true");
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
  if (input.observedFrom) {
    search.set("observedFrom", input.observedFrom);
  }
  if (input.observedTo) {
    search.set("observedTo", input.observedTo);
  }
  if (input.limit) {
    search.set("limit", String(input.limit));
  }
  if (input.cursor) {
    search.set("cursor", input.cursor);
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{
    notes: Note[];
    total: number;
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  }>(`/api/v1/notes${suffix}`);
}

export function createNote(input: {
  title?: string;
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
  createContext?: {
    version: 1;
    sourceEntityType:
      | "goal"
      | "project"
      | "task"
      | "strategy"
      | "habit"
      | "trigger_report";
    sourceEntityId: string;
    anchorKey: string | null;
  };
}) {
  return request<{ note: Note }>("/api/v1/notes", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function listArtifacts(
  options: {
    query?: string;
    artifactState?: ArtifactState;
    dangerLevel?: ArtifactDangerLevel;
    formatFamily?: ArtifactFormatFamily;
    linkedEntityType?: string;
    linkedEntityId?: string;
    limit?: number;
    offset?: number;
  } = {}
) {
  const search = new URLSearchParams();
  if (options.query?.trim()) {
    search.set("query", options.query.trim());
  }
  if (options.artifactState) {
    search.set("artifactState", options.artifactState);
  }
  if (options.dangerLevel) {
    search.set("dangerLevel", options.dangerLevel);
  }
  if (options.formatFamily) {
    search.set("formatFamily", options.formatFamily);
  }
  if (options.linkedEntityType?.trim() && options.linkedEntityId?.trim()) {
    search.set("linkedEntityType", options.linkedEntityType.trim());
    search.set("linkedEntityId", options.linkedEntityId.trim());
  }
  if (options.limit) {
    search.set("limit", String(options.limit));
  }
  if (typeof options.offset === "number") {
    search.set("offset", String(options.offset));
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<ArtifactListResponse>(`/api/v1/artifacts${suffix}`);
}

export function getArtifact(artifactId: string) {
  return request<{ artifact: Artifact }>(
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}`
  );
}

export type ArtifactUploadRequestOptions = {
  idempotencyKey?: string;
  signal?: AbortSignal;
  onProgress?: (percentage: number) => void;
};

function artifactUploadAbortError() {
  const error = new Error("Artifact upload canceled.");
  error.name = "AbortError";
  return error;
}

function parseArtifactUploadResponseBody(raw: string): unknown {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function uploadArtifactWithProgress(
  input: ArtifactUploadInput,
  options: ArtifactUploadRequestOptions,
  retryWithFreshSession = true
): Promise<{ artifact: Artifact }> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(artifactUploadAbortError());
      return;
    }

    const path = "/api/v1/artifacts";
    const xhr = new XMLHttpRequest();
    let settled = false;
    const cleanup = () => {
      options.signal?.removeEventListener("abort", abortUpload);
    };
    const settleWithError = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };
    const abortUpload = () => xhr.abort();

    xhr.open("POST", resolveForgePath(path), true);
    xhr.withCredentials = true;
    xhr.setRequestHeader("content-type", "application/json");
    xhr.setRequestHeader(UI_SOURCE_HEADER, UI_SOURCE_VALUE);
    const csrfToken = readBrowserCsrfToken();
    if (csrfToken) {
      xhr.setRequestHeader("x-forge-csrf", csrfToken);
    }
    const idempotencyKey = options.idempotencyKey ?? input.idempotencyKey;
    if (idempotencyKey) {
      xhr.setRequestHeader("Idempotency-Key", idempotencyKey);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        options.onProgress?.(
          Math.max(
            0,
            Math.min(100, Math.round((event.loaded / event.total) * 100))
          )
        );
      }
    };
    xhr.onerror = () => {
      settleWithError(
        new Error("Artifact upload failed before Forge responded.")
      );
    };
    xhr.onabort = () => settleWithError(artifactUploadAbortError());
    xhr.onload = () => {
      if (settled) {
        return;
      }
      cleanup();
      const body = parseArtifactUploadResponseBody(xhr.responseText);
      const response = new Response(xhr.responseText, {
        status: xhr.status,
        statusText: xhr.statusText,
        headers: {
          "content-type":
            xhr.getResponseHeader("content-type") ?? "application/json"
        }
      });
      if (
        retryWithFreshSession &&
        shouldBootstrapAndRetryBrowserSession({
          path,
          init: { method: "POST", body: JSON.stringify(input) },
          response,
          body
        })
      ) {
        settled = true;
        void bootstrapBrowserSession()
          .then(() => {
            if (options.signal?.aborted) {
              throw artifactUploadAbortError();
            }
            return uploadArtifactWithProgress(input, options, false);
          })
          .then(resolve, reject);
        return;
      }
      if (!response.ok) {
        publishRequestFailure(path, response, body);
        settleWithError(createApiError(path, response, body));
        return;
      }
      settled = true;
      options.onProgress?.(100);
      resolve(body as { artifact: Artifact });
    };
    options.signal?.addEventListener("abort", abortUpload, { once: true });
    options.onProgress?.(0);
    xhr.send(JSON.stringify(input));
  });
}

export function uploadArtifact(
  input: ArtifactUploadInput,
  options: ArtifactUploadRequestOptions = {}
) {
  const idempotencyKey = options.idempotencyKey ?? input.idempotencyKey;
  if (options.onProgress && typeof XMLHttpRequest !== "undefined") {
    return uploadArtifactWithProgress(input, options);
  }
  return request<{ artifact: Artifact }>("/api/v1/artifacts", {
    method: "POST",
    body: JSON.stringify(input),
    signal: options.signal,
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined
  });
}

export function patchArtifact(
  artifactId: string,
  patch: ArtifactMetadataPatchInput
) {
  return request<{ artifact: Artifact }>(
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function downloadArtifact(artifactId: string) {
  return requestBlob(
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}/download`
  );
}

export function downloadArtifactWithPassword(
  artifactId: string,
  password: string
) {
  return requestBlob(
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}/download`,
    {
      method: "POST",
      body: JSON.stringify({ password })
    }
  );
}

export function encryptArtifact(
  artifactId: string,
  input: { password: string; passwordHint?: string }
) {
  return request<{ artifact: Artifact }>(
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}/encrypt`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function rescanArtifact(artifactId: string) {
  return request<{ artifact: Artifact }>(
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}/scan`,
    { method: "POST" }
  );
}

export function enrichArtifact(
  artifactId: string,
  input: ArtifactEnrichmentInput = {}
) {
  return request<{ artifact: Artifact }>(
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}/enrich`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function applyArtifactEnrichment(
  artifactId: string,
  input: ArtifactEnrichmentApplyInput
) {
  return request<{ artifact: Artifact }>(
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}/enrich/apply`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function replaceArtifactEntityLinks(
  artifactId: string,
  links: EntityLinkInput[]
) {
  return request<{ artifact: Artifact }>(
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}/links`,
    {
      method: "POST",
      body: JSON.stringify({ links })
    }
  );
}

export function patchArtifactTrust(
  artifactId: string,
  input: ArtifactTrustPatchInput
) {
  return request<{ artifact: Artifact }>(
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}/trust`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function listArtifactVersions(
  artifactId: string,
  options: { limit?: number; offset?: number } = {}
) {
  const search = new URLSearchParams();
  if (options.limit) {
    search.set("limit", String(options.limit));
  }
  if (typeof options.offset === "number") {
    search.set("offset", String(options.offset));
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{
    versions: ArtifactVersion[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  }>(`/api/v1/artifacts/${encodeURIComponent(artifactId)}/versions${suffix}`);
}

export function listArtifactAuditEvents(
  artifactId: string,
  options: { limit?: number; offset?: number } = {}
) {
  const search = new URLSearchParams();
  if (options.limit) {
    search.set("limit", String(options.limit));
  }
  if (typeof options.offset === "number") {
    search.set("offset", String(options.offset));
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{
    events: ArtifactAuditEvent[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  }>(`/api/v1/artifacts/${encodeURIComponent(artifactId)}/audit${suffix}`);
}

export function getNote(noteId: string) {
  return request<{ note: Note }>(`/api/v1/notes/${encodeURIComponent(noteId)}`);
}

export function patchNote(
  noteId: string,
  patch: {
    title?: string;
    contentMarkdown?: string;
    author?: string | null;
    tags?: string[];
    destroyAt?: string | null;
    frontmatter?: Record<string, unknown>;
    userId?: string | null;
    expectedRevisionHash?: string;
    links?: Array<{
      entityType: CrudEntityType;
      entityId: string;
      anchorKey?: string | null;
    }>;
  }
) {
  return request<{ note: Note }>(
    `/api/v1/notes/${encodeURIComponent(noteId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function deleteNote(noteId: string, mode: DeleteMode = "soft") {
  const suffix = mode === "soft" ? "" : `?mode=${mode}`;
  return request<{ note: Note }>(
    `/api/v1/notes/${encodeURIComponent(noteId)}${suffix}`,
    {
      method: "DELETE"
    }
  );
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
    offset?: number;
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
  if (typeof input.offset === "number") {
    search.set("offset", String(input.offset));
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{
    pages: WikiPageSummary[];
    limit: number;
    offset: number;
    hasMore: boolean;
    nextOffset: number | null;
  }>(`/api/v1/wiki/pages${suffix}`);
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
  return request<{ tree: WikiTreeNode[]; truncated: boolean }>(
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
    expectedRevisionHash?: string;
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

export function searchWiki(
  input: {
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
    offset?: number;
  },
  options: { signal?: AbortSignal } = {}
) {
  return request<WikiSearchResponse>("/api/v1/wiki/search", {
    method: "POST",
    body: JSON.stringify(input),
    signal: options.signal
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
  return request<{ jobs: WikiIngestJobPayload[]; total: number }>(
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
  offset?: number;
}) {
  return request<WikiSearchResponse>("/api/v1/wiki/search", {
    method: "POST",
    body: JSON.stringify({
      spaceId: input.spaceId,
      kind: input.kind,
      mode: input.mode ?? "text",
      query: input.query ?? "",
      profileId: input.profileId,
      limit: input.limit ?? 8,
      offset: input.offset ?? 0
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

export function getWeeklyReview(timeZone?: string) {
  const search = new URLSearchParams();
  if (timeZone) {
    search.set("timeZone", timeZone);
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ review: WeeklyReviewPayload }>(
    `/api/v1/reviews/weekly${suffix}`
  );
}

export function finalizeWeeklyReview(timeZone?: string) {
  const search = new URLSearchParams();
  if (timeZone) {
    search.set("timeZone", timeZone);
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<FinalizeWeeklyReviewResult>(
    `/api/v1/reviews/weekly/finalize${suffix}`,
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

export function exportPsycheObservationCalendar(input: {
  from?: string;
  to?: string;
  userIds?: string[] | unknown;
  tags?: string[];
  includeObservations?: boolean;
  includeActivity?: boolean;
  onlyHumanOwned?: boolean;
  search?: string;
  format: "json" | "csv" | "markdown" | "ics";
}) {
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
  exclusionDates?: string[];
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
    exclusionDates: string[];
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
  return request<{
    event: CalendarEvent;
    projection: CalendarProjectionResult;
  }>("/api/v1/calendar/events", {
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
    recurrenceEditScope: "single" | "series";
    userId: string | null;
    links: Array<{
      entityType: CrudEntityType;
      entityId: string;
      relationshipType?: string;
    }>;
  }>
) {
  return request<{
    event: CalendarEvent;
    projection: CalendarProjectionResult;
  }>(`/api/v1/calendar/events/${eventId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  }).then((response) => ({
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
  timezone?: string;
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
    timezone?: string;
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
  if (input.timezone) {
    search.set("timezone", input.timezone);
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
  input: {
    dateKey?: string;
    status: "done" | "missed";
    note?: string;
    description?: string;
    timezone?: string;
  }
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

export function getWorkItemsBoard(params?: {
  projectId?: string;
  goalId?: string;
  levels?: string[];
  userIds?: string[] | unknown;
  assigneeIds?: string[] | unknown;
}) {
  const query = new URLSearchParams();
  if (params?.projectId) {
    query.set("projectId", params.projectId);
  }
  if (params?.goalId) {
    query.set("goalId", params.goalId);
  }
  if (Array.isArray(params?.levels) && params.levels.length > 0) {
    query.set("levels", params.levels.join(","));
  }
  if (Array.isArray(params?.userIds)) {
    for (const userId of params.userIds) {
      if (typeof userId === "string" && userId.trim().length > 0) {
        query.append("userIds", userId);
      }
    }
  }
  if (Array.isArray(params?.assigneeIds)) {
    for (const userId of params.assigneeIds) {
      if (typeof userId === "string" && userId.trim().length > 0) {
        query.append("assigneeIds", userId);
      }
    }
  }
  const suffix = query.toString().length > 0 ? `?${query.toString()}` : "";
  return request<{
    goals: Goal[];
    strategies: Strategy[];
    projects: ProjectSummary[];
    workItems: WorkItem[];
  }>(`/api/v1/work-items/board${suffix}`);
}

export function getWorkItemsHierarchy(params?: {
  projectId?: string;
  goalId?: string;
  levels?: string[];
  userIds?: string[] | unknown;
  assigneeIds?: string[] | unknown;
}) {
  const query = new URLSearchParams();
  if (params?.projectId) {
    query.set("projectId", params.projectId);
  }
  if (params?.goalId) {
    query.set("goalId", params.goalId);
  }
  if (Array.isArray(params?.levels) && params.levels.length > 0) {
    query.set("levels", params.levels.join(","));
  }
  if (Array.isArray(params?.userIds)) {
    for (const userId of params.userIds) {
      if (typeof userId === "string" && userId.trim().length > 0) {
        query.append("userIds", userId);
      }
    }
  }
  if (Array.isArray(params?.assigneeIds)) {
    for (const userId of params.assigneeIds) {
      if (typeof userId === "string" && userId.trim().length > 0) {
        query.append("assigneeIds", userId);
      }
    }
  }
  const suffix = query.toString().length > 0 ? `?${query.toString()}` : "";
  return request<{
    goals: Goal[];
    strategies: Strategy[];
    projects: ProjectSummary[];
    workItems: WorkItem[];
  }>(`/api/v1/work-items/hierarchy${suffix}`);
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

export function getForgeDoctor() {
  return request<{ doctor: ForgeDoctorReport }>("/api/v1/doctor");
}

export function applyForgeDoctorFixes(input: {
  fixIds?: string[];
  applyAllSafe?: boolean;
}) {
  return request<{
    results: DoctorFixResult[];
    doctor: ForgeDoctorReport;
  }>("/api/v1/doctor/fixes", {
    method: "POST",
    body: JSON.stringify(input)
  });
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

function appendWorkbenchCatalogValues(
  search: URLSearchParams,
  key: string,
  values: string[] | undefined
) {
  for (const value of values ?? []) {
    search.append(key, value);
  }
}

export function listWorkbenchBoxCatalog(
  input: {
    q?: string;
    categories?: string[];
    surfaceIds?: string[];
    sources?: Array<"forge" | "flow_output">;
    limit?: number;
    offset?: number;
  } = {}
) {
  const search = new URLSearchParams();
  if (input.q?.trim()) search.set("q", input.q.trim());
  appendWorkbenchCatalogValues(search, "category", input.categories);
  appendWorkbenchCatalogValues(search, "surfaceId", input.surfaceIds);
  appendWorkbenchCatalogValues(search, "source", input.sources);
  if (input.limit !== undefined) search.set("limit", String(input.limit));
  if (input.offset !== undefined) search.set("offset", String(input.offset));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<import("./types").WorkbenchBoxCatalogPage>(
    `/api/v1/workbench/catalog/boxes${suffix}`
  );
}

export function listWorkbenchFlows(
  input: {
    q?: string;
    kinds?: import("./types").AiConnectorKind[];
    homeSurfaceIds?: string[];
    statuses?: Array<"enabled" | "disabled">;
    limit?: number;
    offset?: number;
  } = {}
) {
  const search = new URLSearchParams();
  if (input.q?.trim()) search.set("q", input.q.trim());
  appendWorkbenchCatalogValues(search, "kind", input.kinds);
  appendWorkbenchCatalogValues(search, "homeSurfaceId", input.homeSurfaceIds);
  appendWorkbenchCatalogValues(search, "status", input.statuses);
  if (input.limit !== undefined) search.set("limit", String(input.limit));
  if (input.offset !== undefined) search.set("offset", String(input.offset));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<import("./types").WorkbenchFlowCatalogPage>(
    `/api/v1/workbench/flows${suffix}`
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
    runs: import("./types").AiConnectorRunSummary[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
    conversation: import("./types").AiConnectorConversation | null;
  }>(`/api/v1/workbench/flows/${connectorId}`);
}

export function updateWorkbenchFlow(
  connectorId: string,
  patch: { expectedRevision: number } & Partial<{
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

export function listWorkbenchFlowVersions(
  connectorId: string,
  input: { limit?: number; offset?: number } = {}
) {
  const search = new URLSearchParams();
  if (input.limit !== undefined) search.set("limit", String(input.limit));
  if (input.offset !== undefined) search.set("offset", String(input.offset));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<import("./types").WorkbenchFlowVersionPage>(
    `/api/v1/workbench/flows/${connectorId}/versions${suffix}`
  );
}

export function getWorkbenchFlowVersion(connectorId: string, revision: number) {
  return request<{ version: import("./types").WorkbenchFlowVersionDetail }>(
    `/api/v1/workbench/flows/${connectorId}/versions/${revision}`
  );
}

export function restoreWorkbenchFlowVersion(
  connectorId: string,
  input: { revision: number; expectedRevision: number }
) {
  return request<{ flow: import("./types").AiConnector }>(
    `/api/v1/workbench/flows/${connectorId}/restore`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function deleteWorkbenchFlow(
  connectorId: string,
  expectedRevision: number
) {
  return request<{ flow: import("./types").AiConnector }>(
    `/api/v1/workbench/flows/${connectorId}`,
    {
      method: "DELETE",
      body: JSON.stringify({ expectedRevision })
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
    retryOfRunId?: string | null;
    idempotencyKey?: string | null;
    timeoutMs?: number;
    debug?: boolean;
  }
) {
  return request<{
    flow: import("./types").AiConnector;
    run: import("./types").AiConnectorRun;
    readMetadata: import("./types").WorkbenchReadMetadata | null;
    conversation: import("./types").AiConnectorConversation | null;
  }>(`/api/v1/workbench/flows/${connectorId}/run`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function cancelWorkbenchFlowRun(
  connectorId: string,
  runId: string,
  reason = ""
) {
  return request<{
    flow: import("./types").AiConnector;
    run: import("./types").AiConnectorRun;
  }>(`/api/v1/workbench/flows/${connectorId}/runs/${runId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason })
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
    retryOfRunId?: string | null;
    idempotencyKey?: string | null;
    timeoutMs?: number;
    debug?: boolean;
  }
) {
  return request<{
    flow: import("./types").AiConnector;
    run: import("./types").AiConnectorRun;
    readMetadata: import("./types").WorkbenchReadMetadata | null;
    conversation: import("./types").AiConnectorConversation | null;
  }>(`/api/v1/workbench/flows/${connectorId}/chat`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getWorkbenchFlowOutput(connectorId: string) {
  return request<{
    flow: import("./types").AiConnector;
    state: "no_output" | "current" | "stale";
    stale: boolean;
    latestRun: import("./types").AiConnectorRunSummary | null;
    sourceRun: import("./types").AiConnectorRunSummary | null;
    output: import("./types").AiConnectorRunResult | null;
    readMetadata: import("./types").WorkbenchReadMetadata | null;
  }>(`/api/v1/workbench/flows/${connectorId}/output`);
}

export function getWorkbenchFlowRuns(
  connectorId: string,
  input: { limit?: number; offset?: number } = {}
) {
  const search = new URLSearchParams();
  if (typeof input.limit === "number") {
    search.set("limit", String(input.limit));
  }
  if (typeof input.offset === "number") {
    search.set("offset", String(input.offset));
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{
    runs: import("./types").AiConnectorRunSummary[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  }>(`/api/v1/workbench/flows/${connectorId}/runs${suffix}`);
}

export function getWorkbenchFlowRun(connectorId: string, runId: string) {
  return request<{
    flow: import("./types").AiConnector;
    run: import("./types").AiConnectorRun;
    readMetadata: import("./types").WorkbenchReadMetadata;
  }>(`/api/v1/workbench/flows/${connectorId}/runs/${runId}`);
}

export function getWorkbenchFlowRunNodes(connectorId: string, runId: string) {
  return request<{
    flow: import("./types").AiConnector;
    nodeResults: import("./types").AiConnectorNodeResultSummary[];
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
    readMetadata: import("./types").WorkbenchReadMetadata;
  }>(`/api/v1/workbench/flows/${connectorId}/runs/${runId}/nodes/${nodeId}`);
}

export function getWorkbenchFlowNodeOutput(
  connectorId: string,
  nodeId: string
) {
  return request<{
    flow: import("./types").AiConnector;
    state: "no_output" | "available" | "stale";
    stale: boolean;
    nodeExistsInCurrentFlow: boolean;
    latestRun: import("./types").AiConnectorRunSummary | null;
    run: import("./types").AiConnectorRunSummary | null;
    nodeResult:
      | import("./types").AiConnectorRunResult["nodeResults"][number]
      | null;
    readMetadata: import("./types").WorkbenchReadMetadata | null;
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

export function getSleepSession(sleepId: string) {
  return request<{ sleep: import("./types").SleepSessionRecord }>(
    `/api/v1/health/sleep/${encodeURIComponent(sleepId)}`
  );
}

export function getSleepSessionRawDetail(sleepId: string) {
  return request<import("./types").SleepSessionDetailPayload>(
    `/api/v1/health/sleep/${encodeURIComponent(sleepId)}/raw`
  );
}

export function getFitnessView(
  userIds?: string[] | unknown,
  options: {
    compact?: boolean;
    sessionDetail?: "full" | "summary";
    analysisDetail?: "full" | "compact";
  } = {}
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  if (options.compact) {
    search.set("compact", "1");
  }
  if (options.sessionDetail) {
    search.set("sessionDetail", options.sessionDetail);
  }
  if (options.analysisDetail) {
    search.set("analysisDetail", options.analysisDetail);
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ fitness: FitnessViewData }>(
    `/api/v1/health/fitness${suffix}`
  );
}

export function getWorkoutSession(
  workoutId: string,
  userIds?: string[] | unknown
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ workout: import("./types").WorkoutSessionRecord }>(
    `/api/v1/health/workouts/${encodeURIComponent(workoutId)}${suffix}`
  );
}

export function getTrainingLoadView(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ trainingLoad: TrainingLoadViewData }>(
    `/api/v1/health/training-load${suffix}`
  );
}

export function getWorkoutDetail(
  workoutId: string,
  resolution: "adaptive" | "raw" = "adaptive",
  userIds?: string[] | unknown
) {
  const search = new URLSearchParams({ resolution });
  appendUserIds(search, coerceUserIds(userIds));
  return request<WorkoutSessionDetailPayload>(
    `/api/v1/health/workouts/${encodeURIComponent(workoutId)}/detail?${search.toString()}`
  );
}

export function getHealthZoneProfile(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ zoneProfile: HealthZoneProfileRecord }>(
    `/api/v1/health/zone-profile${suffix}`
  );
}

export function getVitalsView(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ vitals: import("./types").VitalsViewData }>(
    `/api/v1/health/vitals${suffix}`
  );
}

export function getWeightLossView(
  userIds?: string[] | unknown,
  options?: {
    dateKey?: string;
    dayStartAt?: string;
    dayEndAt?: string;
    timeZone?: string;
  }
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  if (options?.dateKey) {
    search.set("dateKey", options.dateKey);
  }
  if (options?.dayStartAt) {
    search.set("dayStartAt", options.dayStartAt);
  }
  if (options?.dayEndAt) {
    search.set("dayEndAt", options.dayEndAt);
  }
  if (options?.timeZone) {
    search.set("timeZone", options.timeZone);
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ weightLoss: WeightLossViewData }>(
    `/api/v1/health/weight-loss${suffix}`
  );
}

export function updateNutritionTarget(
  patch: NutritionTargetPatchInput,
  userIds?: string[] | unknown
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ target: NutritionTarget }>(
    `/api/v1/health/weight-loss/target${suffix}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function updateNutritionDailyActiveCalories(
  patch: {
    dayKey?: string;
    timeZone?: string;
    activeCaloriesKcal?: number | null;
    notes?: string;
  },
  userIds?: string[] | unknown
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{
    dayKey: string;
    override: WeightLossViewData["energyModel"]["todayActiveOverride"];
  }>(`/api/v1/health/weight-loss/daily-active-calories${suffix}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function searchNutritionFoods(input: {
  query: string;
  limit?: number;
  userIds?: string[] | unknown;
}) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(input.userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ foods: NutritionFoodSearchResult[] }>(
    `/api/v1/health/weight-loss/foods/search${suffix}`,
    {
      method: "POST",
      body: JSON.stringify({ query: input.query, limit: input.limit })
    }
  );
}

export function lookupNutritionBarcode(input: {
  barcode: string;
  userIds?: string[] | unknown;
}) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(input.userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ food: NutritionFoodSearchResult | null }>(
    `/api/v1/health/weight-loss/foods/barcode${suffix}`,
    {
      method: "POST",
      body: JSON.stringify({ barcode: input.barcode })
    }
  );
}

export function createNutritionFoodLog(
  input: NutritionFoodLogInput,
  userIds?: string[] | unknown,
  idempotencyKey?: string
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ log: NutritionFoodLog }>(
    `/api/v1/health/weight-loss/food-logs${suffix}`,
    {
      method: "POST",
      headers: idempotencyKey
        ? { "Idempotency-Key": idempotencyKey }
        : undefined,
      body: JSON.stringify(input)
    }
  );
}

export function createNutritionFoodLogMutationKey() {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `weight-loss-food-log-${suffix}`;
}

export function patchNutritionFoodLog(
  foodLogId: string,
  patch: NutritionFoodLogPatchInput,
  userIds?: string[] | unknown
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ log: NutritionFoodLog }>(
    `/api/v1/health/weight-loss/food-logs/${foodLogId}${suffix}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function deleteNutritionFoodLog(
  foodLogId: string,
  userIds?: string[] | unknown
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ deleted: boolean }>(
    `/api/v1/health/weight-loss/food-logs/${foodLogId}${suffix}`,
    { method: "DELETE" }
  );
}

export function parseNutritionFoodLogWithChatGpt(input: {
  text?: string;
  mealTime?: string;
  imageRefs?: string[];
  connectionId?: string;
  commitCandidate?: boolean;
  userIds?: string[] | unknown;
}) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(input.userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{
    candidate: NutritionFoodLogInput;
    log: NutritionFoodLog | null;
    parseSummary: {
      itemCount: number;
      completeNutritionItemCount: number;
      catalogResolvedItemCount: number;
      chatGptEstimatedItemCount: number;
      chatGptValidatedItemCount: number;
      elapsedMs: number;
      llmCallCount: number;
    };
    clarificationQuestions: string[];
    uncertaintyReasons: string[];
  }>(`/api/v1/health/weight-loss/parse${suffix}`, {
    method: "POST",
    body: JSON.stringify({
      text: input.text,
      mealTime: input.mealTime,
      imageRefs: input.imageRefs,
      connectionId: input.connectionId,
      commitCandidate: input.commitCandidate
    })
  });
}

export function createNutritionBodyCheckin(
  input: NutritionCheckinInput,
  userIds?: string[] | unknown,
  idempotencyKey?: string
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ checkin: Record<string, unknown> }>(
    `/api/v1/health/weight-loss/body-checkins${suffix}`,
    {
      method: "POST",
      headers: idempotencyKey
        ? { "Idempotency-Key": idempotencyKey }
        : undefined,
      body: JSON.stringify(input)
    }
  );
}

export function createNutritionCheckinMutationKey() {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `weight-loss-checkin-${suffix}`;
}

export function createNutritionAppearanceCheckin(
  input: NutritionAppearanceInput,
  userIds?: string[] | unknown,
  idempotencyKey?: string
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ checkin: Record<string, unknown> }>(
    `/api/v1/health/weight-loss/appearance-checkins${suffix}`,
    {
      method: "POST",
      headers: idempotencyKey
        ? { "Idempotency-Key": idempotencyKey }
        : undefined,
      body: JSON.stringify(input)
    }
  );
}

export function createNutritionSubjectiveCheckin(
  input: NutritionSubjectiveInput,
  userIds?: string[] | unknown,
  idempotencyKey?: string
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ checkin: Record<string, unknown> }>(
    `/api/v1/health/weight-loss/subjective-checkins${suffix}`,
    {
      method: "POST",
      headers: idempotencyKey
        ? { "Idempotency-Key": idempotencyKey }
        : undefined,
      body: JSON.stringify(input)
    }
  );
}

export function createNutritionGutCheckin(
  input: NutritionGutInput,
  userIds?: string[] | unknown,
  idempotencyKey?: string
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ checkin: Record<string, unknown> }>(
    `/api/v1/health/weight-loss/gut-checkins${suffix}`,
    {
      method: "POST",
      headers: idempotencyKey
        ? { "Idempotency-Key": idempotencyKey }
        : undefined,
      body: JSON.stringify(input)
    }
  );
}

export function getNutritionPatterns(userIds?: string[] | unknown) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{
    hypotheses: WeightLossViewData["hypotheses"];
    experiments: WeightLossViewData["experiments"];
  }>(`/api/v1/health/weight-loss/patterns${suffix}`);
}

export function createNutritionExperiment(
  input: NutritionExperimentInput,
  userIds?: string[] | unknown
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ experiment: NutritionExperiment }>(
    `/api/v1/health/weight-loss/experiments${suffix}`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function patchNutritionExperiment(
  experimentId: string,
  patch: NutritionExperimentPatchInput,
  userIds?: string[] | unknown
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ experiment: NutritionExperiment }>(
    `/api/v1/health/weight-loss/experiments/${experimentId}${suffix}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function getMovementDay(input?: {
  date?: string;
  timeZone?: string;
  userIds?: string[] | unknown;
}) {
  const search = new URLSearchParams();
  if (input?.date) {
    search.set("date", input.date);
  }
  if (input?.timeZone) {
    search.set("timeZone", input.timeZone);
  }
  appendUserIds(search, coerceUserIds(input?.userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ movement: MovementDayData }>(
    `/api/v1/movement/day${suffix}`
  );
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
  return request<{ place: MovementKnownPlace }>(
    `/api/v1/movement/places${suffix}`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function patchMovementPlace(
  placeId: string,
  patch: Partial<MovementKnownPlace>,
  userIds?: string[] | unknown
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ place: MovementKnownPlace }>(
    `/api/v1/movement/places/${placeId}${suffix}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch)
    }
  );
}

export function patchMovementStay(
  stayId: string,
  patch: {
    placeExternalUid?: string | null;
    placeLabel?: string;
  },
  userIds?: string[] | unknown
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request(`/api/v1/movement/stays/${stayId}${suffix}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

export function getMovementTripDetail(
  tripId: string,
  userIds?: string[] | unknown
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ movement: MovementTripDetailData }>(
    `/api/v1/movement/trips/${tripId}${suffix}`
  );
}

export function getMovementBoxDetail(
  boxId: string,
  userIds?: string[] | unknown
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ movement: MovementBoxDetailData }>(
    `/api/v1/movement/boxes/${boxId}${suffix}`
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
  placeIds?: string[];
  startedAt?: string;
  endedAt?: string;
  from?: string;
  to?: string;
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
  transportMode?: CompanionPairingTransportMode;
  capabilities?: string[];
}) {
  return request<{
    session: CompanionOverviewPayload["pairings"][number];
    qrPayload: CompanionPairingQrPayload;
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

export function getUserDeactivationPreview(
  userId: string,
  replacementUserId: string
) {
  const search = new URLSearchParams({ replacementUserId });
  return request<{ preview: UserDeactivationPreview }>(
    `/api/v1/users/${userId}/deactivation-preview?${search.toString()}`
  );
}

export function deactivateUser(input: {
  userId: string;
  replacementUserId: string;
  reason: string;
  disconnectActiveSessions: boolean;
  idempotencyKey: string;
}) {
  return request<{ receipt: UserLifecycleReceipt; user: UserSummary }>(
    `/api/v1/users/${input.userId}/deactivate`,
    {
      method: "POST",
      body: JSON.stringify({
        replacementUserId: input.replacementUserId,
        reason: input.reason,
        disconnectActiveSessions: input.disconnectActiveSessions,
        idempotencyKey: input.idempotencyKey
      })
    }
  );
}

export function reactivateUser(input: {
  userId: string;
  reason: string;
  idempotencyKey: string;
}) {
  return request<{ receipt: UserLifecycleReceipt; user: UserSummary }>(
    `/api/v1/users/${input.userId}/reactivate`,
    {
      method: "POST",
      body: JSON.stringify({
        reason: input.reason,
        idempotencyKey: input.idempotencyKey
      })
    }
  );
}

export function setUserOwnershipDefault(input: {
  userId: string;
  ownerUserId: string;
  idempotencyKey: string;
}) {
  return request<{ receipt: UserLifecycleReceipt }>(
    `/api/v1/users/${input.userId}/ownership-default`,
    {
      method: "PUT",
      body: JSON.stringify({
        ownerUserId: input.ownerUserId,
        idempotencyKey: input.idempotencyKey
      })
    }
  );
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
    backupRetentionDays: number | null;
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

export function listAgentRuntimeSessions() {
  return request<{ sessions: AgentRuntimeSession[] }>(
    "/api/v1/agents/sessions"
  );
}

export function getAgentRuntimeSessionHistory(sessionId: string) {
  return request<AgentRuntimeSessionHistory>(
    `/api/v1/agents/sessions/${sessionId}/history`
  );
}

export function reconnectAgentRuntimeSession(sessionId: string, note = "") {
  return request<{ session: AgentRuntimeSession }>(
    `/api/v1/agents/sessions/${sessionId}/reconnect`,
    {
      method: "POST",
      body: JSON.stringify({ note })
    }
  );
}

export function disconnectAgentRuntimeSession(
  sessionId: string,
  input: { note?: string; lastError?: string | null } = {}
) {
  return request<{ session: AgentRuntimeSession }>(
    `/api/v1/agents/sessions/${sessionId}/disconnect`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
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

export function getAttentionInbox(
  options: {
    state?: AttentionInboxState;
    limit?: number;
    offset?: number;
    userIds?: string[];
  } = {}
) {
  const search = new URLSearchParams();
  if (options.state) {
    search.set("state", options.state);
  }
  if (options.limit) {
    search.set("limit", String(options.limit));
  }
  if (typeof options.offset === "number") {
    search.set("offset", String(options.offset));
  }
  appendUserIds(search, options.userIds ?? []);
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<AttentionInboxPayload>(`/api/v1/attention-inbox${suffix}`);
}

export function createAttentionResolutionIdempotencyKey(prefix = "attention") {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

export function startAttentionResolutionAction(
  itemId: string,
  input: {
    actionKey: AttentionPrimaryActionKey;
    sourceUpdatedAt: string;
    userIds?: string[];
    idempotencyKey?: string;
  }
) {
  const search = new URLSearchParams();
  appendUserIds(search, input.userIds ?? []);
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<AttentionResolutionStartResult>(
    `/api/v1/attention-inbox/${encodeURIComponent(itemId)}/actions/start${suffix}`,
    {
      method: "POST",
      headers: {
        "Idempotency-Key":
          input.idempotencyKey ??
          createAttentionResolutionIdempotencyKey("attention_start")
      },
      body: JSON.stringify({
        actionKey: input.actionKey,
        sourceUpdatedAt: input.sourceUpdatedAt
      })
    }
  );
}

export function checkAttentionResolutions(
  options: { userIds?: string[]; idempotencyKey?: string } = {}
) {
  const search = new URLSearchParams();
  appendUserIds(search, options.userIds ?? []);
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<AttentionResolutionCheckResponse>(
    `/api/v1/attention-resolutions/check${suffix}`,
    {
      method: "POST",
      headers: {
        "Idempotency-Key":
          options.idempotencyKey ??
          createAttentionResolutionIdempotencyKey("attention_check")
      }
    }
  );
}

export function getAttentionResolutions(
  options: { userIds?: string[]; limit?: number } = {}
) {
  const search = new URLSearchParams();
  appendUserIds(search, options.userIds ?? []);
  if (typeof options.limit === "number") {
    search.set("limit", String(options.limit));
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<AttentionResolutionList>(
    `/api/v1/attention-resolutions${suffix}`
  );
}

export function getMutationReceipts(
  options: { userIds?: string[]; limit?: number } = {}
) {
  const search = new URLSearchParams();
  appendUserIds(search, options.userIds ?? []);
  if (typeof options.limit === "number") {
    search.set("limit", String(options.limit));
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<MutationReceiptList>(`/api/v1/mutation-receipts${suffix}`);
}

export function createMutationReceiptUndoKey() {
  return `undo_${globalThis.crypto.randomUUID()}`;
}

export function undoMutationReceipt(
  receiptId: string,
  idempotencyKey = createMutationReceiptUndoKey()
) {
  return request<MutationReceiptUndoResult>(
    `/api/v1/mutation-receipts/${encodeURIComponent(receiptId)}/undo`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey }
    }
  );
}

export function snoozeAttentionInboxItem(
  itemId: string,
  input: { until: string; note?: string }
) {
  return request<{
    attentionState: AttentionInboxStateRecord;
    mutationReceipt: MutationReceipt;
  }>(`/api/v1/attention-inbox/${encodeURIComponent(itemId)}/snooze`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function dismissAttentionInboxItem(itemId: string, note = "") {
  return request<{
    attentionState: AttentionInboxStateRecord;
    mutationReceipt: MutationReceipt;
  }>(`/api/v1/attention-inbox/${encodeURIComponent(itemId)}/dismiss`, {
    method: "POST",
    body: JSON.stringify({ note })
  });
}

export function restoreAttentionInboxItem(itemId: string) {
  return request<{
    attentionState: AttentionInboxStateRecord;
    mutationReceipt: MutationReceipt;
  }>(`/api/v1/attention-inbox/${encodeURIComponent(itemId)}/restore`, {
    method: "POST"
  });
}

export function getEntityNavigation(
  options: {
    pinnedLimit?: number;
    recentLimit?: number;
    userIds?: string[];
  } = {}
) {
  const search = new URLSearchParams();
  if (typeof options.pinnedLimit === "number") {
    search.set("pinnedLimit", String(options.pinnedLimit));
  }
  if (typeof options.recentLimit === "number") {
    search.set("recentLimit", String(options.recentLimit));
  }
  appendUserIds(search, options.userIds ?? []);
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<EntityNavigationPayload>(`/api/v1/entity-navigation${suffix}`);
}

export function pinEntityNavigation(input: {
  entityType: CrudEntityType;
  entityId: string;
  ownerUserId?: string | null;
}) {
  return request<{ pin: EntityNavigationItem }>(
    "/api/v1/entity-navigation/pins",
    {
      method: "PUT",
      body: JSON.stringify(input)
    }
  );
}

export function unpinEntityNavigation(pinId: string) {
  return request<{ unpinned: true; pinId: string }>(
    `/api/v1/entity-navigation/pins/${encodeURIComponent(pinId)}`,
    { method: "DELETE" }
  );
}

export function touchEntityNavigation(input: {
  entityType: CrudEntityType;
  entityId: string;
}) {
  return request<{ recent: EntityNavigationItem }>(
    "/api/v1/entity-navigation/touch",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function getSavedViews(ownerUserId: string, limit = 20) {
  const search = new URLSearchParams({
    ownerUserId,
    limit: String(limit)
  });
  return request<{ savedViews: SavedView[] }>(
    `/api/v1/saved-views?${search.toString()}`
  );
}

export function createSavedView(input: {
  ownerUserId: string;
  name: string;
  query: string;
  filterIds: string[];
  scopeMode: "all" | "selected";
  scopeUserIds: string[];
}) {
  return request<{ savedView: SavedView }>("/api/v1/saved-views", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function deleteSavedView(savedViewId: string, ownerUserId: string) {
  const search = new URLSearchParams({ ownerUserId });
  return request<{ deleted: true; savedViewId: string }>(
    `/api/v1/saved-views/${encodeURIComponent(savedViewId)}?${search.toString()}`,
    { method: "DELETE" }
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

export function getXpMetrics(
  userIds?: string[] | unknown,
  timezone?: string | null
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  if (timezone?.trim()) {
    search.set("timezone", timezone.trim());
  }
  const suffix = search.toString() ? `?${search}` : "";
  return request<{ metrics: XpMetricsPayload }>(`/api/v1/metrics/xp${suffix}`);
}

export function getGamificationCatalog(
  userIds?: string[] | unknown,
  timezone?: string | null
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  if (timezone?.trim()) {
    search.set("timezone", timezone.trim());
  }
  const suffix = search.toString() ? `?${search}` : "";
  return request<{ catalog: GamificationCatalogPayload }>(
    `/api/v1/gamification/catalog${suffix}`
  );
}

export function getGamificationAssetStatus() {
  return request<{ assets: GamificationAssetStatusPayload }>(
    "/api/v1/gamification/assets"
  );
}

export function installGamificationAssetStyle(
  style: GamificationAssetStatusPayload["defaultStyle"]
) {
  return request<{ style: GamificationAssetStatusPayload["styles"][number] }>(
    "/api/v1/gamification/assets/install",
    {
      method: "POST",
      body: JSON.stringify({ style })
    }
  );
}

export function getGamificationEquipment(
  userIds?: string[] | unknown,
  timezone?: string | null
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  if (timezone?.trim()) {
    search.set("timezone", timezone.trim());
  }
  const suffix = search.toString() ? `?${search}` : "";
  return request<{ equipment: GamificationEquipment }>(
    `/api/v1/gamification/equipment${suffix}`
  );
}

export function updateGamificationEquipment(
  input: Partial<Omit<GamificationEquipment, "updatedAt">>,
  userIds?: string[] | unknown,
  timezone?: string | null
) {
  const search = new URLSearchParams();
  appendUserIds(search, coerceUserIds(userIds));
  if (timezone?.trim()) {
    search.set("timezone", timezone.trim());
  }
  const suffix = search.toString() ? `?${search}` : "";
  return request<{ equipment: GamificationEquipment }>(
    `/api/v1/gamification/equipment${suffix}`,
    {
      method: "PUT",
      body: JSON.stringify(input)
    }
  );
}

export function markGamificationCelebrationSeen(celebrationId: string) {
  return request<{ celebration: GamificationCelebration }>(
    `/api/v1/gamification/celebrations/${celebrationId}/seen`,
    {
      method: "POST"
    }
  );
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
  return request<{
    results: Array<
      Record<string, unknown> & { mutationReceipt?: MutationReceipt | null }
    >;
  }>("/api/v1/entities/update", {
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
  return request<{
    results: Array<
      Record<string, unknown> & { mutationReceipt?: MutationReceipt | null }
    >;
  }>("/api/v1/entities/delete", {
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
  return request<{
    results: Array<{
      ok?: boolean;
      error?: { message?: string };
      [key: string]: unknown;
    }>;
  }>("/api/v1/entities/restore", {
    method: "POST",
    body: JSON.stringify(input)
  }).then((response) => {
    const failed = response.results.find((result) => result.ok !== true);
    if (failed) {
      throw new Error(
        failed.error?.message || "Forge could not restore the selected record."
      );
    }
    return response;
  });
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

export function searchLocalRecords(input: {
  query?: string;
  entityTypes?: CrudEntityType[];
  entityKinds?: LocalSearchEntityKind[];
  userIds?: string[];
  limit?: number;
}) {
  const params = new URLSearchParams();
  const query = input.query?.replace(/\s+/g, " ").trim();
  if (query) params.set("q", query);
  for (const entityType of input.entityTypes ?? []) {
    params.append("entityType", entityType);
  }
  for (const entityKind of input.entityKinds ?? []) {
    params.append("entityKind", entityKind);
  }
  for (const userId of input.userIds ?? []) {
    params.append("userIds", userId);
  }
  if (input.limit !== undefined) {
    params.set("limit", String(input.limit));
  }
  return request<LocalSearchResponse>(
    `/api/v1/local-search?${params.toString()}`
  );
}

export function proposeCapture(intent: CaptureIntent) {
  return request<{ proposal: CaptureProposal }>("/api/v1/capture/proposals", {
    method: "POST",
    body: JSON.stringify({ intent })
  });
}

export function confirmCapture(input: CaptureConfirmation) {
  return request<{ receipt: CaptureReceipt }>("/api/v1/capture/confirm", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function listLaunchpadPackages() {
  return request<{ packages: ProductPackage[] }>("/api/v1/launchpad/packages");
}

export function listLaunchpadPackageInstalls(ownerUserId: string) {
  return request<{ installs: ProductPackageInstall[] }>(
    `/api/v1/launchpad/package-installs?ownerUserId=${encodeURIComponent(ownerUserId)}`
  );
}

export function removeLaunchpadPackageInstall(
  installId: string,
  ownerUserId: string
) {
  return request<{
    removal: {
      installId: string;
      status: "removed";
      removedAt?: string;
      replayed: boolean;
    };
  }>(
    `/api/v1/launchpad/package-installs/${encodeURIComponent(installId)}/remove`,
    {
      method: "POST",
      body: JSON.stringify({ ownerUserId, expectedStatus: "installed" })
    }
  );
}

export function getLaunchpadOnboarding(ownerUserId: string) {
  return request<{ onboarding: ProductOnboardingState }>(
    `/api/v1/launchpad/onboarding?ownerUserId=${encodeURIComponent(ownerUserId)}`
  );
}

export function updateLaunchpadOnboarding(
  input: Pick<
    ProductOnboardingState,
    "ownerUserId" | "outcomeKey" | "currentStep" | "status"
  >
) {
  return request<{ onboarding: ProductOnboardingState }>(
    "/api/v1/launchpad/onboarding",
    { method: "PUT", body: JSON.stringify(input) }
  );
}

export function previewLaunchpadPackage(input: {
  ownerUserId: string;
  packageId: string;
}) {
  return request<{ preview: ProductPackagePreview }>(
    "/api/v1/launchpad/packages/preview",
    { method: "POST", body: JSON.stringify(input) }
  );
}

export function installLaunchpadPackage(input: {
  ownerUserId: string;
  packageId: string;
  manifestSha256: string;
  idempotencyKey: string;
}) {
  return request<{
    install: {
      installId: string;
      packageId: string;
      status: "installed";
      createdEntities: Array<{
        ref: string;
        entityType: CrudEntityType;
        entityId: string;
        title: string;
        href: string;
      }>;
      installedAt: string;
      replayed: boolean;
    };
  }>("/api/v1/launchpad/packages/install", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function previewLaunchpadImport(input: {
  ownerUserId: string;
  sourceKind: ProductImportSource;
  sourceLabel: string;
  items: ProductImportItem[];
}) {
  return request<{ preview: ProductImportPreview }>(
    "/api/v1/launchpad/imports/preview",
    { method: "POST", body: JSON.stringify(input) }
  );
}

export function commitLaunchpadImport(input: {
  ownerUserId: string;
  previewId: string;
  payloadFingerprint: string;
  idempotencyKey: string;
  decisions: Array<{ sourceId: string; action: "create" | "skip" }>;
}) {
  return request<{
    import: {
      importId: string;
      status: "committed";
      created: Array<{
        sourceId: string;
        entityType: CrudEntityType;
        entityId: string;
        title: string;
        href: string;
      }>;
      skipped: Array<{ sourceId: string; reason: string }>;
      replayed: boolean;
    };
  }>("/api/v1/launchpad/imports/commit", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function listLaunchpadImports(ownerUserId: string) {
  return request<{ imports: ProductImportRun[] }>(
    `/api/v1/launchpad/imports?ownerUserId=${encodeURIComponent(ownerUserId)}`
  );
}

export function rollbackLaunchpadImport(importId: string, ownerUserId: string) {
  return request<{
    rollback: {
      importId: string;
      status: "rolled_back";
      rolledBackAt?: string;
      replayed: boolean;
    };
  }>(`/api/v1/launchpad/imports/${encodeURIComponent(importId)}/rollback`, {
    method: "POST",
    body: JSON.stringify({ ownerUserId, expectedStatus: "committed" })
  });
}

export function listLaunchpadReviews(ownerUserId: string) {
  return request<{ items: ProductReviewItem[] }>(
    `/api/v1/launchpad/reviews?ownerUserId=${encodeURIComponent(ownerUserId)}`
  );
}

export function decideLaunchpadReview(
  itemId: string,
  input: {
    ownerUserId: string;
    expectedRevision: number;
    decision: "accept" | "reject";
  }
) {
  return request<{ decision: Record<string, unknown> }>(
    `/api/v1/launchpad/reviews/${encodeURIComponent(itemId)}/decision`,
    { method: "POST", body: JSON.stringify(input) }
  );
}

export function getLaunchpadFeedback(ownerUserId: string) {
  return request<{ feedback: ProductFeedbackPayload }>(
    `/api/v1/launchpad/feedback?ownerUserId=${encodeURIComponent(ownerUserId)}`
  );
}

export function updateLaunchpadFeedback(input: {
  ownerUserId: string;
  enabled: boolean;
  consentVersion: "privacy-feedback-v1" | null;
}) {
  return request<{ feedback: ProductFeedbackPayload }>(
    "/api/v1/launchpad/feedback",
    { method: "PUT", body: JSON.stringify(input) }
  );
}

export function deleteLaunchpadFeedback(ownerUserId: string) {
  return request<{ deleted: number }>(
    `/api/v1/launchpad/feedback/events?ownerUserId=${encodeURIComponent(ownerUserId)}`,
    { method: "DELETE" }
  );
}

export async function getDeletedPlanningRecord(
  entityType: Extract<CrudEntityType, "goal" | "project" | "task">,
  entityId: string
): Promise<DeletedEntityRecord | null> {
  const response = await searchEntities({
    searches: [
      {
        entityTypes: [entityType],
        ids: [entityId],
        includeDeleted: true,
        limit: 1
      }
    ]
  });
  const operation = response.results[0] as
    | {
        ok?: boolean;
        error?: { message?: string };
        matches?: Array<{
          deleted?: boolean;
          deletedRecord?: DeletedEntityRecord;
        }>;
      }
    | undefined;
  if (operation?.ok !== true) {
    throw new Error(
      operation?.error?.message ||
        "Forge could not inspect the deleted planning record."
    );
  }
  return (
    operation.matches?.find(
      (match) => match.deleted === true && match.deletedRecord
    )?.deletedRecord ?? null
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
    source?: "ui" | "openclaw" | "agent" | "system";
    from?: string;
    to?: string;
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
  if (input.source) {
    search.set("source", input.source);
  }
  if (input.from) {
    search.set("from", input.from);
  }
  if (input.to) {
    search.set("to", input.to);
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
  return request<
    import("./types").DiagnosticLogListPayload & {
      retention: { days: number; maximumEntries: number };
    }
  >(`/api/v1/diagnostics/logs?${search.toString()}`);
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
    parentWorkItemId: input.parentWorkItemId || null,
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

export function createWorkItem(input: QuickTaskInput) {
  const normalized = {
    ...input,
    goalId: input.goalId || null,
    projectId: input.projectId || null,
    parentWorkItemId: input.parentWorkItemId || null,
    dueDate: input.dueDate || null,
    plannedDurationSeconds:
      input.plannedDurationSeconds === undefined
        ? null
        : input.plannedDurationSeconds,
    notes: normalizeNestedNotes(input.notes)
  };
  return request<{ workItem: WorkItem }>("/api/v1/work-items", {
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
  return request<{ task: unknown; mutationReceipt: MutationReceipt | null }>(
    `/api/v1/tasks/${taskId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        ...patch,
        goalId: patch.goalId === "" ? null : patch.goalId,
        projectId: patch.projectId === "" ? null : patch.projectId,
        parentWorkItemId:
          patch.parentWorkItemId === "" ? null : patch.parentWorkItemId,
        dueDate: patch.dueDate === "" ? null : patch.dueDate,
        plannedDurationSeconds:
          patch.plannedDurationSeconds === undefined
            ? undefined
            : patch.plannedDurationSeconds
      })
    }
  );
}

export function submitOfflineTaskStatusMutation(
  input: OfflineTaskMutationInput
) {
  return request<OfflineTaskMutationResponse>(
    "/api/v1/offline-mutations/task-status",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function patchWorkItem(
  workItemId: string,
  patch: Partial<QuickTaskInput> & {
    status?: string;
    completedAt?: string;
    plannedDurationSeconds?: number | null;
    schedulingRules?: CalendarSchedulingRules | null;
    enforceTodayWorkLog?: boolean;
    completedTodayWorkSeconds?: number;
  }
) {
  return request<{ workItem: WorkItem }>(`/api/v1/work-items/${workItemId}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...patch,
      goalId: patch.goalId === "" ? null : patch.goalId,
      projectId: patch.projectId === "" ? null : patch.projectId,
      parentWorkItemId:
        patch.parentWorkItemId === "" ? null : patch.parentWorkItemId,
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
  return request<{ task: unknown; mutationReceipt: MutationReceipt }>(
    `/api/v1/tasks/${taskId}`,
    {
      method: "DELETE"
    }
  );
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

export function getWorkItemContext(workItemId: string) {
  return request<TaskContext>(`/api/v1/work-items/${workItemId}/context`);
}

export function logOperatorWork(input: OperatorLogWorkInput) {
  return request<OperatorLogWorkResult>("/api/v1/operator/log-work", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

const implicitWorkAdjustmentRetryKeys = new Map<string, string>();

function rememberImplicitWorkAdjustmentRetryKey(
  fingerprint: string,
  retryKey: string
) {
  if (
    !implicitWorkAdjustmentRetryKeys.has(fingerprint) &&
    implicitWorkAdjustmentRetryKeys.size >= 50
  ) {
    const oldestFingerprint = implicitWorkAdjustmentRetryKeys
      .keys()
      .next().value;
    if (oldestFingerprint) {
      implicitWorkAdjustmentRetryKeys.delete(oldestFingerprint);
    }
  }
  implicitWorkAdjustmentRetryKeys.set(fingerprint, retryKey);
}

export async function createWorkAdjustment(input: {
  entityType: "task" | "project";
  entityId: string;
  deltaMinutes: number;
  note?: string;
  idempotencyKey?: string;
}) {
  const { idempotencyKey, ...adjustment } = input;
  const fingerprint = JSON.stringify(adjustment);
  const retryKey =
    idempotencyKey ??
    implicitWorkAdjustmentRetryKeys.get(fingerprint) ??
    globalThis.crypto.randomUUID();
  if (!idempotencyKey) {
    rememberImplicitWorkAdjustmentRetryKey(fingerprint, retryKey);
  }
  const result = await request<WorkAdjustmentResult>(
    "/api/v1/work-adjustments",
    {
      method: "POST",
      headers: { "Idempotency-Key": retryKey },
      body: JSON.stringify(adjustment)
    }
  );
  if (
    !idempotencyKey &&
    implicitWorkAdjustmentRetryKeys.get(fingerprint) === retryKey
  ) {
    implicitWorkAdjustmentRetryKeys.delete(fingerprint);
  }
  return result;
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
  timezone?: string;
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

export function getGitHelperOverview() {
  return request<{ git: GitHelperOverview }>("/api/v1/git-helper/overview");
}

export function searchGitHelperRefs(input: {
  kind: GitHelperSearchKind;
  query?: string;
  repository?: string;
}) {
  const search = new URLSearchParams();
  search.set("kind", input.kind);
  if (input.query?.trim()) {
    search.set("query", input.query.trim());
  }
  if (input.repository?.trim()) {
    search.set("repository", input.repository.trim());
  }
  return request<{ git: GitHelperSearchResponse }>(
    `/api/v1/git-helper/search?${search.toString()}`
  );
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

export function completeTaskRun(
  taskRunId: string,
  input: TaskRunCompleteInput
) {
  return request<{ taskRun: TaskRun }>(
    `/api/v1/task-runs/${taskRunId}/complete`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function releaseTaskRun(taskRunId: string, input: TaskRunReleaseInput) {
  return request<{ taskRun: TaskRun }>(
    `/api/v1/task-runs/${taskRunId}/release`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

function withCourseUser(path: string, userId?: string) {
  if (!userId) return path;
  const search = new URLSearchParams({ userId });
  return `${path}?${search.toString()}`;
}

export function listForgeCourses(userId?: string) {
  return request<{
    courses: Array<ForgeCourse & { progress: CourseProgress }>;
  }>(withCourseUser("/api/v1/courses", userId));
}

export function getForgeCourse(courseId: string, userId?: string) {
  return request<CourseDetail>(
    withCourseUser(`/api/v1/courses/${encodeURIComponent(courseId)}`, userId)
  );
}

export function upgradeForgeCourseEnrollment(
  courseId: string,
  userId?: string
) {
  return request<{
    upgraded: boolean;
    receiptId?: string;
    fromVersion: string;
    toVersion: string;
    carriedActivityIds: string[];
    remainingActivityIds: string[];
  }>(`/api/v1/courses/${encodeURIComponent(courseId)}/upgrade`, {
    method: "POST",
    body: JSON.stringify(userId ? { userId } : {})
  });
}

export function importForgeCourse(coursePackage: unknown) {
  return request<{
    course: ForgeCourse;
    imported: {
      conceptsDefined: number;
      conceptsReferenced: number;
      concepts: number;
      modules: number;
      lessons: number;
    };
  }>("/api/v1/courses/import", {
    method: "POST",
    body: JSON.stringify(coursePackage)
  });
}

export function exportForgeCourse(courseId: string) {
  return requestBlob(`/api/v1/courses/${encodeURIComponent(courseId)}/export`);
}

export function getForgeLearningSession(input: {
  courseId: string;
  lessonId?: string;
  userId?: string;
  signal?: AbortSignal;
}) {
  const search = new URLSearchParams();
  if (input.lessonId) search.set("lessonId", input.lessonId);
  if (input.userId) search.set("userId", input.userId);
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<LearningSession>(
    `/api/v1/courses/${encodeURIComponent(input.courseId)}/learn${suffix}`,
    { signal: input.signal }
  );
}

export function submitForgeCourseAttempt(input: {
  courseId: string;
  lessonId: string;
  activityId: string;
  userId?: string;
  answerMarkdown: string;
  idempotencyKey: string;
}) {
  return request<{
    attemptId: string;
    status: "assessed" | "needs_review";
    score: number | null;
    grade: string | null;
    pointsAwarded: number;
    feedback: AssessmentFeedback;
    deliveryMode: "visual" | "voice";
    lessonAttemptOrdinal: number;
    activityAttemptOrdinal: number;
    progress: CourseProgress;
    nextLessonId: string | null;
  }>(
    `/api/v1/courses/${encodeURIComponent(input.courseId)}/lessons/${encodeURIComponent(input.lessonId)}/activities/${encodeURIComponent(input.activityId)}/attempts`,
    {
      method: "POST",
      body: JSON.stringify({
        userId: input.userId,
        answerMarkdown: input.answerMarkdown,
        idempotencyKey: input.idempotencyKey
      })
    }
  );
}

export function listForgeConcepts(
  input: {
    userId?: string;
    courseId?: string;
    query?: string;
    dueOnly?: boolean;
  } = {}
) {
  const search = new URLSearchParams();
  if (input.userId) search.set("userId", input.userId);
  if (input.courseId) search.set("courseId", input.courseId);
  if (input.query?.trim()) search.set("query", input.query.trim());
  if (input.dueOnly) search.set("dueOnly", "true");
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return request<{ concepts: ForgeConcept[] }>(`/api/v1/concepts${suffix}`);
}

export function getForgeConcept(conceptId: string, userId?: string) {
  return request<ConceptDetail>(
    withCourseUser(`/api/v1/concepts/${encodeURIComponent(conceptId)}`, userId)
  );
}

export function listComparisonCatalog(input: {
  userId: string;
  query?: string;
  family?: ComparisonFamily;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}) {
  const search = new URLSearchParams({ userId: input.userId });
  if (input.query?.trim()) search.set("query", input.query.trim());
  if (input.family) search.set("family", input.family);
  if (input.limit !== undefined) search.set("limit", String(input.limit));
  if (input.cursor) search.set("cursor", input.cursor);
  return request<ComparisonCatalogResponse>(
    `/api/v1/comparisons/catalog?${search.toString()}`,
    { signal: input.signal }
  );
}

export function getComparison(input: {
  userId: string;
  selections: string[];
  from: string;
  to: string;
  timeZone: string;
  alignment: ComparisonAlignment;
  signal?: AbortSignal;
}) {
  const search = new URLSearchParams({
    userId: input.userId,
    from: input.from,
    to: input.to,
    timeZone: input.timeZone,
    alignment: input.alignment
  });
  for (const selection of input.selections) {
    search.append("selection", selection);
  }
  return request<ComparisonResponse>(
    `/api/v1/comparisons?${search.toString()}`,
    { signal: input.signal }
  );
}
