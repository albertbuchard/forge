import { ForgeApiError } from "./api-error.js";
import { dedupeCalendarDiscoveryPayload, dedupeCalendarOverviewPayload } from "./calendar-name-deduper.js";
import { publishUiDiagnosticLog } from "./diagnostics.js";
import { resolveForgePath } from "./runtime-paths.js";
import { normalizeForgeSnapshot } from "./snapshot-normalizer.js";
function normalizeCalendarEventPlace(event) {
    const fallbackLocation = typeof event.location === "string" ? event.location : "";
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
function normalizeCalendarOverviewPayload(payload) {
    return {
        ...dedupeCalendarOverviewPayload(payload),
        events: payload.events.map(normalizeCalendarEventPlace)
    };
}
async function parseResponseBody(response) {
    const text = await response.text();
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
async function request(path, init) {
    const headers = new Headers(init?.headers);
    headers.set("x-forge-source", "ui");
    if (init?.body !== undefined &&
        !(typeof FormData !== "undefined" && init.body instanceof FormData) &&
        !headers.has("content-type")) {
        headers.set("content-type", "application/json");
    }
    let response;
    try {
        response = await fetch(resolveForgePath(path), {
            credentials: "same-origin",
            headers,
            ...init
        });
    }
    catch (error) {
        if (path !== "/api/v1/diagnostics/logs") {
            void publishUiDiagnosticLog({
                level: "error",
                scope: "frontend_api",
                eventKey: "request_network_failure",
                message: `API request failed before reaching Forge: ${path}`,
                route: path,
                functionName: "request",
                details: {
                    error: error instanceof Error
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
        const maybeBody = typeof body === "object" && body !== null
            ? body
            : null;
        const details = Array.isArray(maybeBody?.details)
            ? maybeBody.details
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
                    code: typeof maybeBody?.code === "string"
                        ? maybeBody.code
                        : typeof maybeBody?.error === "string"
                            ? maybeBody.error
                            : "request_failed",
                    response: typeof body === "string"
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
            code: typeof maybeBody?.code === "string"
                ? maybeBody.code
                : typeof maybeBody?.error === "string"
                    ? maybeBody.error
                    : "request_failed",
            message: typeof maybeBody?.error === "string"
                ? maybeBody.error
                : typeof maybeBody?.message === "string"
                    ? maybeBody.message
                    : typeof body === "string"
                        ? body
                        : `Request failed: ${response.status}`,
            requestPath: path,
            details,
            response: typeof body === "string"
                ? body
                : body && typeof body === "object"
                    ? body
                    : null
        });
    }
    return body;
}
async function requestBlob(path, init) {
    const headers = new Headers(init?.headers);
    headers.set("x-forge-source", "ui");
    const response = await fetch(resolveForgePath(path), {
        credentials: "same-origin",
        headers,
        ...init
    });
    if (!response.ok) {
        const body = await parseResponseBody(response);
        const maybeBody = typeof body === "object" && body !== null
            ? body
            : null;
        throw new ForgeApiError({
            status: response.status,
            code: typeof maybeBody?.code === "string"
                ? maybeBody.code
                : typeof maybeBody?.error === "string"
                    ? maybeBody.error
                    : "request_failed",
            message: typeof maybeBody?.error === "string"
                ? maybeBody.error
                : typeof maybeBody?.message === "string"
                    ? maybeBody.message
                    : `Request failed: ${response.status}`,
            requestPath: path,
            details: [],
            response: typeof body === "string"
                ? body
                : body && typeof body === "object"
                    ? body
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
function normalizeNestedNotes(notes) {
    return notes
        .map((note) => ({
        contentMarkdown: note.contentMarkdown.trim(),
        author: note.author.trim() || null
    }))
        .filter((note) => note.contentMarkdown.length > 0);
}
const USER_SCOPE_STORAGE_KEY = "forge.selected-user-ids";
function readStoredUserIds() {
    if (typeof window === "undefined") {
        return [];
    }
    try {
        const raw = window.localStorage.getItem(USER_SCOPE_STORAGE_KEY);
        if (!raw) {
            return [];
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed
            .filter((entry) => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean);
    }
    catch {
        return [];
    }
}
function resolveScopedUserIds(userIds) {
    return userIds ?? readStoredUserIds();
}
function coerceUserIds(value) {
    return Array.isArray(value)
        ? value.filter((entry) => typeof entry === "string")
        : undefined;
}
function appendUserIds(search, userIds) {
    for (const userId of resolveScopedUserIds(userIds)) {
        if (userId.trim()) {
            search.append("userIds", userId.trim());
        }
    }
}
export function ensureOperatorSession() {
    return request("/api/v1/auth/operator-session");
}
export function revokeOperatorSession() {
    return request("/api/v1/auth/operator-session", {
        method: "DELETE"
    });
}
export function getForgeSnapshot(userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/context${suffix}`).then(normalizeForgeSnapshot);
}
export function getLifeForce(userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/life-force${suffix}`);
}
export function patchLifeForceProfile(patch, userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/life-force/profile${suffix}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function updateLifeForceTemplate(weekday, input, userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/life-force/templates/${weekday}${suffix}`, {
        method: "PUT",
        body: JSON.stringify(input)
    });
}
export function createFatigueSignal(input, userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/life-force/fatigue-signals${suffix}`, {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function getKnowledgeGraph(userIds, query) {
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
    return request(`/api/v1/knowledge-graph${suffix}`).then((response) => response.graph);
}
export function getKnowledgeGraphFocus(entityType, entityId, userIds) {
    const search = new URLSearchParams();
    search.set("entityType", entityType);
    search.set("entityId", entityId);
    appendUserIds(search, coerceUserIds(userIds));
    return request(`/api/v1/knowledge-graph/focus?${search.toString()}`).then((response) => response.focus);
}
export function getPreferenceWorkspace(query) {
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
    return request(`/api/v1/preferences/workspace${suffix}`);
}
export function startPreferenceGame(input) {
    return request("/api/v1/preferences/game/start", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function createPreferenceCatalog(input) {
    return request("/api/v1/preferences/catalogs", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function patchPreferenceCatalog(catalogId, patch) {
    return request(`/api/v1/preferences/catalogs/${catalogId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function deletePreferenceCatalog(catalogId) {
    return request(`/api/v1/preferences/catalogs/${catalogId}`, {
        method: "DELETE"
    });
}
export function createPreferenceCatalogItem(input) {
    return request("/api/v1/preferences/catalog-items", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function patchPreferenceCatalogItem(catalogItemId, patch) {
    return request(`/api/v1/preferences/catalog-items/${catalogItemId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function deletePreferenceCatalogItem(catalogItemId) {
    return request(`/api/v1/preferences/catalog-items/${catalogItemId}`, {
        method: "DELETE"
    });
}
export function createPreferenceContext(input) {
    return request("/api/v1/preferences/contexts", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function patchPreferenceContext(contextId, patch) {
    return request(`/api/v1/preferences/contexts/${contextId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function mergePreferenceContexts(input) {
    return request("/api/v1/preferences/contexts/merge", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function createPreferenceItem(input) {
    return request("/api/v1/preferences/items", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function patchPreferenceItem(itemId, patch) {
    return request(`/api/v1/preferences/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function enqueuePreferenceEntity(input) {
    return request("/api/v1/preferences/items/from-entity", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function submitPairwisePreferenceJudgment(input) {
    return request("/api/v1/preferences/judgments", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function submitPreferenceSignal(input) {
    return request("/api/v1/preferences/signals", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function patchPreferenceScore(itemId, patch) {
    return request(`/api/v1/preferences/items/${itemId}/score`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function getInsights(userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/insights${suffix}`);
}
export function listDomains() {
    return request("/api/v1/domains");
}
export function getPsycheOverview(userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/psyche/overview${suffix}`);
}
export function listQuestionnaires(userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/psyche/questionnaires${suffix}`);
}
export function getQuestionnaire(instrumentId, userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/psyche/questionnaires/${instrumentId}${suffix}`);
}
export function createQuestionnaire(input) {
    return request("/api/v1/psyche/questionnaires", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function cloneQuestionnaire(instrumentId, input = {}) {
    return request(`/api/v1/psyche/questionnaires/${instrumentId}/clone`, {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function ensureQuestionnaireDraft(instrumentId) {
    return request(`/api/v1/psyche/questionnaires/${instrumentId}/draft`, {
        method: "POST",
        body: JSON.stringify({})
    });
}
export function updateQuestionnaireDraft(instrumentId, input) {
    return request(`/api/v1/psyche/questionnaires/${instrumentId}/draft`, {
        method: "PATCH",
        body: JSON.stringify(input)
    });
}
export function publishQuestionnaireDraft(instrumentId, input = {}) {
    return request(`/api/v1/psyche/questionnaires/${instrumentId}/publish`, {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function startQuestionnaireRun(instrumentId, input = {}) {
    return request(`/api/v1/psyche/questionnaires/${instrumentId}/runs`, {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function getQuestionnaireRun(runId, userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/psyche/questionnaire-runs/${runId}${suffix}`);
}
export function patchQuestionnaireRun(runId, input) {
    return request(`/api/v1/psyche/questionnaire-runs/${runId}`, {
        method: "PATCH",
        body: JSON.stringify(input)
    });
}
export function completeQuestionnaireAssessment(runId) {
    return request(`/api/v1/psyche/questionnaire-runs/${runId}/complete`, {
        method: "POST",
        body: JSON.stringify({})
    });
}
export function listPsycheValues(userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/psyche/values${suffix}`);
}
export function getPsycheValue(valueId) {
    return request(`/api/v1/psyche/values/${valueId}`);
}
export function createPsycheValue(input) {
    return request("/api/v1/psyche/values", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function patchPsycheValue(valueId, patch) {
    return request(`/api/v1/psyche/values/${valueId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function deletePsycheValue(valueId) {
    return request(`/api/v1/psyche/values/${valueId}`, {
        method: "DELETE"
    });
}
export function listBehaviorPatterns(userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/psyche/patterns${suffix}`);
}
export function getBehaviorPattern(patternId) {
    return request(`/api/v1/psyche/patterns/${patternId}`);
}
export function createBehaviorPattern(input) {
    return request("/api/v1/psyche/patterns", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function patchBehaviorPattern(patternId, patch) {
    return request(`/api/v1/psyche/patterns/${patternId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function deleteBehaviorPattern(patternId) {
    return request(`/api/v1/psyche/patterns/${patternId}`, {
        method: "DELETE"
    });
}
export function listBehaviors(userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/psyche/behaviors${suffix}`);
}
export function getBehavior(behaviorId) {
    return request(`/api/v1/psyche/behaviors/${behaviorId}`);
}
export function createBehavior(input) {
    return request("/api/v1/psyche/behaviors", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function patchBehavior(behaviorId, patch) {
    return request(`/api/v1/psyche/behaviors/${behaviorId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function deleteBehavior(behaviorId) {
    return request(`/api/v1/psyche/behaviors/${behaviorId}`, {
        method: "DELETE"
    });
}
export function listSchemaCatalog() {
    return request("/api/v1/psyche/schema-catalog");
}
export function listBeliefs(userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/psyche/beliefs${suffix}`);
}
export function getBelief(beliefId) {
    return request(`/api/v1/psyche/beliefs/${beliefId}`);
}
export function createBelief(input) {
    return request("/api/v1/psyche/beliefs", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function patchBelief(beliefId, patch) {
    return request(`/api/v1/psyche/beliefs/${beliefId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function deleteBelief(beliefId) {
    return request(`/api/v1/psyche/beliefs/${beliefId}`, {
        method: "DELETE"
    });
}
export function listModes(userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/psyche/modes${suffix}`);
}
export function getMode(modeId) {
    return request(`/api/v1/psyche/modes/${modeId}`);
}
export function createMode(input) {
    return request("/api/v1/psyche/modes", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function patchMode(modeId, patch) {
    return request(`/api/v1/psyche/modes/${modeId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function deleteMode(modeId) {
    return request(`/api/v1/psyche/modes/${modeId}`, {
        method: "DELETE"
    });
}
export function listModeGuideSessions() {
    return request("/api/v1/psyche/mode-guides");
}
export function getModeGuideSession(sessionId) {
    return request(`/api/v1/psyche/mode-guides/${sessionId}`);
}
export function createModeGuideSession(input) {
    return request("/api/v1/psyche/mode-guides", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function patchModeGuideSession(sessionId, patch) {
    return request(`/api/v1/psyche/mode-guides/${sessionId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function deleteModeGuideSession(sessionId) {
    return request(`/api/v1/psyche/mode-guides/${sessionId}`, {
        method: "DELETE"
    });
}
export function listEventTypes() {
    return request("/api/v1/psyche/event-types");
}
export function getEventType(eventTypeId) {
    return request(`/api/v1/psyche/event-types/${eventTypeId}`);
}
export function createEventType(input) {
    return request("/api/v1/psyche/event-types", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function patchEventType(eventTypeId, patch) {
    return request(`/api/v1/psyche/event-types/${eventTypeId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function deleteEventType(eventTypeId) {
    return request(`/api/v1/psyche/event-types/${eventTypeId}`, {
        method: "DELETE"
    });
}
export function listEmotionDefinitions() {
    return request("/api/v1/psyche/emotions");
}
export function getEmotionDefinition(emotionId) {
    return request(`/api/v1/psyche/emotions/${emotionId}`);
}
export function createEmotionDefinition(input) {
    return request("/api/v1/psyche/emotions", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function patchEmotionDefinition(emotionId, patch) {
    return request(`/api/v1/psyche/emotions/${emotionId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function deleteEmotionDefinition(emotionId) {
    return request(`/api/v1/psyche/emotions/${emotionId}`, {
        method: "DELETE"
    });
}
export function listTriggerReports(userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/psyche/reports${suffix}`);
}
export function createTriggerReport(input) {
    return request("/api/v1/psyche/reports", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function getTriggerReport(reportId) {
    return request(`/api/v1/psyche/reports/${reportId}`);
}
export function patchTriggerReport(reportId, patch) {
    return request(`/api/v1/psyche/reports/${reportId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function deleteTriggerReport(reportId) {
    return request(`/api/v1/psyche/reports/${reportId}`, {
        method: "DELETE"
    });
}
export function listNotes(input = {}) {
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
    return request(`/api/v1/notes${suffix}`);
}
export function createNote(input) {
    return request("/api/v1/notes", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function getNote(noteId) {
    return request(`/api/v1/notes/${noteId}`);
}
export function patchNote(noteId, patch) {
    return request(`/api/v1/notes/${noteId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function deleteNote(noteId, mode = "soft") {
    const suffix = mode === "soft" ? "" : `?mode=${mode}`;
    return request(`/api/v1/notes/${noteId}${suffix}`, {
        method: "DELETE"
    });
}
export function getWikiSettings() {
    return request("/api/v1/wiki/settings");
}
export function createWikiSpace(input) {
    return request("/api/v1/wiki/spaces", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function listWikiSpaces() {
    return request("/api/v1/wiki/spaces");
}
export function listWikiPages(input = {}) {
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
    return request(`/api/v1/wiki/pages${suffix}`);
}
export function getWikiPage(pageId) {
    return request(`/api/v1/wiki/pages/${pageId}`);
}
export function getWikiHome(input = {}) {
    const search = new URLSearchParams();
    if (input.spaceId?.trim()) {
        search.set("spaceId", input.spaceId.trim());
    }
    return request(`/api/v1/wiki/home${search.size > 0 ? `?${search.toString()}` : ""}`);
}
export function getWikiPageBySlug(input) {
    const search = new URLSearchParams();
    if (input.spaceId?.trim()) {
        search.set("spaceId", input.spaceId.trim());
    }
    return request(`/api/v1/wiki/by-slug/${encodeURIComponent(input.slug)}${search.size > 0 ? `?${search.toString()}` : ""}`);
}
export function getWikiTree(input = {}) {
    const search = new URLSearchParams();
    if (input.spaceId?.trim()) {
        search.set("spaceId", input.spaceId.trim());
    }
    if (input.kind) {
        search.set("kind", input.kind);
    }
    return request(`/api/v1/wiki/tree${search.size > 0 ? `?${search.toString()}` : ""}`);
}
export function createWikiPage(input) {
    return request("/api/v1/wiki/pages", {
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
export function patchWikiPage(pageId, patch) {
    return request(`/api/v1/wiki/pages/${pageId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function deleteWikiPage(pageId, mode = "soft") {
    const search = new URLSearchParams();
    search.set("mode", mode);
    return request(`/api/v1/wiki/pages/${pageId}?${search.toString()}`, {
        method: "DELETE"
    });
}
export function searchWiki(input) {
    return request("/api/v1/wiki/search", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function getWikiHealth(input = {}) {
    const search = new URLSearchParams();
    if (input.spaceId?.trim()) {
        search.set("spaceId", input.spaceId.trim());
    }
    return request(`/api/v1/wiki/health${search.size > 0 ? `?${search.toString()}` : ""}`);
}
export function syncWikiVault(input = {}) {
    return request("/api/v1/wiki/sync", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function reindexWiki(input = {}) {
    return request("/api/v1/wiki/reindex", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function createWikiLlmProfile(input) {
    return request("/api/v1/wiki/settings/llm-profiles", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function testWikiLlmProfile(input) {
    return request("/api/v1/wiki/settings/llm-profiles/test", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function createWikiEmbeddingProfile(input) {
    return request("/api/v1/wiki/settings/embedding-profiles", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function deleteWikiProfile(kind, profileId) {
    return request(`/api/v1/wiki/settings/${kind}-profiles/${profileId}`, {
        method: "DELETE"
    });
}
export function createWikiIngestJob(input) {
    return request("/api/v1/wiki/ingest-jobs", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function createWikiIngestUploadJob(input) {
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
    formData.set("linkedEntityHints", JSON.stringify(input.linkedEntityHints ?? []));
    input.files.forEach((file) => {
        formData.append("files", file);
    });
    return request("/api/v1/wiki/ingest-jobs/uploads", {
        method: "POST",
        body: formData
    });
}
export function listWikiIngestJobs(input = {}) {
    const search = new URLSearchParams();
    if (input.spaceId?.trim()) {
        search.set("spaceId", input.spaceId.trim());
    }
    if (typeof input.limit === "number") {
        search.set("limit", String(input.limit));
    }
    return request(`/api/v1/wiki/ingest-jobs${search.size > 0 ? `?${search.toString()}` : ""}`);
}
export function getWikiIngestJob(jobId) {
    return request(`/api/v1/wiki/ingest-jobs/${jobId}`);
}
export function searchWikiPages(input) {
    return request("/api/v1/wiki/search", {
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
export function deleteWikiIngestJob(jobId) {
    return request(`/api/v1/wiki/ingest-jobs/${jobId}`, {
        method: "DELETE"
    });
}
export function rerunWikiIngestJob(jobId) {
    return request(`/api/v1/wiki/ingest-jobs/${jobId}/rerun`, {
        method: "POST"
    });
}
export function resumeWikiIngestJob(jobId) {
    return request(`/api/v1/wiki/ingest-jobs/${jobId}/resume`, {
        method: "POST"
    });
}
export function reviewWikiIngestJob(input) {
    return request(`/api/v1/wiki/ingest-jobs/${input.jobId}/review`, {
        method: "POST",
        body: JSON.stringify({
            decisions: input.decisions
        })
    });
}
export function createInsight(input) {
    return request("/api/v1/insights", {
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
export function patchInsight(insightId, patch) {
    return request(`/api/v1/insights/${insightId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function deleteInsight(insightId) {
    return request(`/api/v1/insights/${insightId}`, {
        method: "DELETE"
    });
}
export function submitInsightFeedback(insightId, feedbackType, note = "") {
    return request(`/api/v1/insights/${insightId}/feedback`, {
        method: "POST",
        body: JSON.stringify({ feedbackType, note })
    });
}
export function getWeeklyReview() {
    return request("/api/v1/reviews/weekly");
}
export function finalizeWeeklyReview() {
    return request("/api/v1/reviews/weekly/finalize", {
        method: "POST"
    });
}
export function getCalendarOverview(input = {}) {
    const search = new URLSearchParams();
    if (input.from) {
        search.set("from", input.from);
    }
    if (input.to) {
        search.set("to", input.to);
    }
    appendUserIds(search, coerceUserIds(input.userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/calendar/overview${suffix}`).then((response) => ({
        ...response,
        calendar: normalizeCalendarOverviewPayload(response.calendar)
    }));
}
export function getPsycheObservationCalendar(input = {}) {
    const search = new URLSearchParams();
    if (input.from) {
        search.set("from", input.from);
    }
    if (input.to) {
        search.set("to", input.to);
    }
    appendUserIds(search, coerceUserIds(input.userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/psyche/self-observation/calendar${suffix}`);
}
export function exportPsycheObservationCalendar(input) {
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
    return requestBlob(`/api/v1/psyche/self-observation/calendar/export?${search.toString()}`);
}
export function listCalendarConnections() {
    return request("/api/v1/calendar/connections");
}
export function discoverCalendarConnection(input) {
    return request("/api/v1/calendar/discovery", {
        method: "POST",
        body: JSON.stringify(input)
    }).then((response) => ({
        ...response,
        discovery: dedupeCalendarDiscoveryPayload(response.discovery)
    }));
}
export function getMacOSLocalCalendarStatus() {
    return request("/api/v1/calendar/macos-local/status");
}
export function requestMacOSLocalCalendarAccess() {
    return request("/api/v1/calendar/macos-local/request-access", {
        method: "POST"
    });
}
export function discoverMacOSLocalCalendarSources() {
    return request("/api/v1/calendar/macos-local/discovery").then((response) => ({
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
export function startGoogleCalendarOauth(input) {
    return request("/api/v1/calendar/oauth/google/start", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function getGoogleCalendarOauthSession(sessionId) {
    return request(`/api/v1/calendar/oauth/google/session/${sessionId}`).then((response) => ({
        ...response,
        session: {
            ...response.session,
            discovery: response.session.discovery
                ? dedupeCalendarDiscoveryPayload(response.session.discovery)
                : null
        }
    }));
}
export function startMicrosoftCalendarOauth(input) {
    return request("/api/v1/calendar/oauth/microsoft/start", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function testMicrosoftCalendarOauthConfiguration(input) {
    return request("/api/v1/calendar/oauth/microsoft/test-config", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function getMicrosoftCalendarOauthSession(sessionId) {
    return request(`/api/v1/calendar/oauth/microsoft/session/${sessionId}`).then((response) => ({
        ...response,
        session: {
            ...response.session,
            discovery: response.session.discovery
                ? dedupeCalendarDiscoveryPayload(response.session.discovery)
                : null
        }
    }));
}
export function discoverExistingCalendarConnection(connectionId) {
    return request(`/api/v1/calendar/connections/${connectionId}/discovery`).then((response) => ({
        ...response,
        discovery: dedupeCalendarDiscoveryPayload(response.discovery)
    }));
}
export function createCalendarConnection(input) {
    return request("/api/v1/calendar/connections", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function syncCalendarConnection(connectionId) {
    return request(`/api/v1/calendar/connections/${connectionId}/sync`, {
        method: "POST"
    });
}
export function patchCalendarConnection(connectionId, patch) {
    return request(`/api/v1/calendar/connections/${connectionId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function deleteCalendarConnection(connectionId) {
    return request(`/api/v1/calendar/connections/${connectionId}`, {
        method: "DELETE"
    });
}
export function listCalendarResources() {
    return request("/api/v1/calendar/calendars");
}
export function listWorkBlockTemplates() {
    return request("/api/v1/calendar/work-block-templates");
}
export function createWorkBlockTemplate(input) {
    return request("/api/v1/calendar/work-block-templates", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function patchWorkBlockTemplate(templateId, patch) {
    return request(`/api/v1/calendar/work-block-templates/${templateId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function deleteWorkBlockTemplate(templateId) {
    return request(`/api/v1/calendar/work-block-templates/${templateId}`, {
        method: "DELETE"
    });
}
export function listTaskTimeboxes(input = {}) {
    const search = new URLSearchParams();
    if (input.from) {
        search.set("from", input.from);
    }
    if (input.to) {
        search.set("to", input.to);
    }
    appendUserIds(search, coerceUserIds(input.userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/calendar/timeboxes${suffix}`);
}
export function createCalendarEvent(input) {
    return request("/api/v1/calendar/events", {
        method: "POST",
        body: JSON.stringify(input)
    }).then((response) => ({
        ...response,
        event: normalizeCalendarEventPlace(response.event)
    }));
}
export function patchCalendarEvent(eventId, patch) {
    return request(`/api/v1/calendar/events/${eventId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    }).then((response) => ({
        ...response,
        event: normalizeCalendarEventPlace(response.event)
    }));
}
export function deleteCalendarEvent(eventId) {
    return request(`/api/v1/calendar/events/${eventId}`, {
        method: "DELETE"
    });
}
export function createTaskTimebox(input) {
    return request("/api/v1/calendar/timeboxes", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function patchTaskTimebox(timeboxId, patch) {
    return request(`/api/v1/calendar/timeboxes/${timeboxId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function deleteTaskTimebox(timeboxId) {
    return request(`/api/v1/calendar/timeboxes/${timeboxId}`, {
        method: "DELETE"
    });
}
export function recommendTaskTimeboxes(input) {
    return request("/api/v1/calendar/timeboxes/recommend", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function listProjects(userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, userIds);
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/projects${suffix}`);
}
export function listHabits(input = {}) {
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
    return request(`/api/v1/habits${suffix}`);
}
export function createHabit(input) {
    return request("/api/v1/habits", {
        method: "POST",
        body: JSON.stringify({
            ...input,
            linkedBehaviorId: input.linkedBehaviorId || null
        })
    });
}
export function patchHabit(habitId, patch) {
    return request(`/api/v1/habits/${habitId}`, {
        method: "PATCH",
        body: JSON.stringify({
            ...patch,
            linkedBehaviorId: patch.linkedBehaviorId === "" ? null : patch.linkedBehaviorId
        })
    });
}
export function deleteHabit(habitId) {
    return request(`/api/v1/habits/${habitId}`, {
        method: "DELETE"
    });
}
export function createHabitCheckIn(habitId, input) {
    return request(`/api/v1/habits/${habitId}/check-ins`, {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function deleteHabitCheckIn(habitId, dateKey) {
    return request(`/api/v1/habits/${habitId}/check-ins/${encodeURIComponent(dateKey)}`, {
        method: "DELETE"
    });
}
export function listTags() {
    return request("/api/v1/tags");
}
export function getTag(tagId) {
    return request(`/api/v1/tags/${tagId}`);
}
export function createTag(input) {
    return request("/api/v1/tags", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function patchTag(tagId, patch) {
    return request(`/api/v1/tags/${tagId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function deleteTag(tagId) {
    return request(`/api/v1/tags/${tagId}`, {
        method: "DELETE"
    });
}
export function getGoal(goalId) {
    return request(`/api/v1/goals/${goalId}`);
}
export function getProject(projectId) {
    return request(`/api/v1/projects/${projectId}`);
}
export function getProjectBoard(projectId) {
    return request(`/api/v1/projects/${projectId}/board`);
}
export function getWorkItemsBoard(params) {
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
    return request(`/api/v1/work-items/board${suffix}`);
}
export function getWorkItemsHierarchy(params) {
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
    return request(`/api/v1/work-items/hierarchy${suffix}`);
}
export function getOperatorContext() {
    return request("/api/v1/operator/context");
}
export function getOperatorOverview() {
    return request("/api/v1/operator/overview");
}
export function getSettings() {
    return request("/api/v1/settings");
}
export function saveAiModelConnection(input) {
    return request("/api/v1/settings/models/connections", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function deleteAiModelConnection(connectionId) {
    return request(`/api/v1/settings/models/connections/${connectionId}`, {
        method: "DELETE"
    });
}
export function testAiModelConnection(input) {
    return request("/api/v1/settings/models/connections/test", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function startOpenAiCodexOauth() {
    return request("/api/v1/settings/models/oauth/openai-codex/start", {
        method: "POST"
    });
}
export function getOpenAiCodexOauthSession(sessionId) {
    return request(`/api/v1/settings/models/oauth/openai-codex/session/${sessionId}`);
}
export function submitOpenAiCodexOauthManualCode(sessionId, codeOrUrl) {
    return request(`/api/v1/settings/models/oauth/openai-codex/session/${sessionId}/manual`, {
        method: "POST",
        body: JSON.stringify({ codeOrUrl })
    });
}
export function getSurfaceAiProcessors(surfaceId) {
    return request(`/api/v1/surfaces/${surfaceId}/ai-processors`);
}
export function getSurfaceLayout(surfaceId) {
    return request(`/api/v1/surfaces/${surfaceId}/layout`);
}
export function saveSurfaceLayout(surfaceId, payload) {
    return request(`/api/v1/surfaces/${surfaceId}/layout`, {
        method: "PUT",
        body: JSON.stringify(payload)
    });
}
export function resetSurfaceLayout(surfaceId) {
    return request(`/api/v1/surfaces/${surfaceId}/layout/reset`, {
        method: "POST"
    });
}
export function createAiProcessor(input) {
    return request(`/api/v1/surfaces/${input.surfaceId}/ai-processors`, {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function updateAiProcessor(processorId, patch) {
    return request(`/api/v1/ai-processors/${processorId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function deleteAiProcessor(processorId) {
    return request(`/api/v1/ai-processors/${processorId}`, { method: "DELETE" });
}
export function createAiProcessorLink(input) {
    return request("/api/v1/ai-processor-links", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function deleteAiProcessorLink(linkId) {
    return request(`/api/v1/ai-processor-links/${linkId}`, { method: "DELETE" });
}
export function runAiProcessor(processorId, input) {
    return request(`/api/v1/ai-processors/${processorId}/run`, {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function getAiProcessorBySlug(slug) {
    return request(`/api/v1/aiproc/${slug}`);
}
export function runAiProcessorBySlug(slug, input) {
    return request(`/api/v1/aiproc/${slug}/run`, {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function listWorkbenchBoxCatalog() {
    return request("/api/v1/workbench/catalog/boxes");
}
export function listWorkbenchFlows() {
    return request("/api/v1/workbench/flows");
}
export function createWorkbenchFlow(input) {
    return request("/api/v1/workbench/flows", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function getWorkbenchFlow(connectorId) {
    return request(`/api/v1/workbench/flows/${connectorId}`);
}
export function updateWorkbenchFlow(connectorId, patch) {
    return request(`/api/v1/workbench/flows/${connectorId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function deleteWorkbenchFlow(connectorId) {
    return request(`/api/v1/workbench/flows/${connectorId}`, {
        method: "DELETE"
    });
}
export function runWorkbenchFlow(connectorId, input) {
    return request(`/api/v1/workbench/flows/${connectorId}/run`, {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function chatWorkbenchFlow(connectorId, input) {
    return request(`/api/v1/workbench/flows/${connectorId}/chat`, {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function getWorkbenchFlowOutput(connectorId) {
    return request(`/api/v1/workbench/flows/${connectorId}/output`);
}
export function getWorkbenchFlowRuns(connectorId) {
    return request(`/api/v1/workbench/flows/${connectorId}/runs`);
}
export function getWorkbenchFlowRun(connectorId, runId) {
    return request(`/api/v1/workbench/flows/${connectorId}/runs/${runId}`);
}
export function getWorkbenchFlowRunNodes(connectorId, runId) {
    return request(`/api/v1/workbench/flows/${connectorId}/runs/${runId}/nodes`);
}
export function getWorkbenchFlowRunNode(connectorId, runId, nodeId) {
    return request(`/api/v1/workbench/flows/${connectorId}/runs/${runId}/nodes/${nodeId}`);
}
export function getWorkbenchFlowNodeOutput(connectorId, nodeId) {
    return request(`/api/v1/workbench/flows/${connectorId}/nodes/${nodeId}/output`);
}
export function getCompanionOverview(userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/health/overview${suffix}`);
}
export function getSleepView(userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/health/sleep${suffix}`);
}
export function getSleepSessionRawDetail(sleepId) {
    return request(`/api/v1/health/sleep/${sleepId}/raw`);
}
export function getFitnessView(userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/health/fitness${suffix}`);
}
export function getVitalsView(userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/health/vitals${suffix}`);
}
export function getMovementDay(input) {
    const search = new URLSearchParams();
    if (input?.date) {
        search.set("date", input.date);
    }
    appendUserIds(search, coerceUserIds(input?.userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/movement/day${suffix}`);
}
export function getMovementMonth(input) {
    const search = new URLSearchParams();
    if (input?.month) {
        search.set("month", input.month);
    }
    appendUserIds(search, coerceUserIds(input?.userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/movement/month${suffix}`);
}
export function getMovementAllTime(userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/movement/all-time${suffix}`);
}
export function getScreenTimeDay(input) {
    const search = new URLSearchParams();
    if (input?.date) {
        search.set("date", input.date);
    }
    appendUserIds(search, coerceUserIds(input?.userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/screen-time/day${suffix}`);
}
export function getScreenTimeMonth(input) {
    const search = new URLSearchParams();
    if (input?.month) {
        search.set("month", input.month);
    }
    appendUserIds(search, coerceUserIds(input?.userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/screen-time/month${suffix}`);
}
export function getScreenTimeAllTime(userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/screen-time/all-time${suffix}`);
}
export function getScreenTimeSettings(userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/screen-time/settings${suffix}`);
}
export function patchScreenTimeSettings(patch, userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/screen-time/settings${suffix}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function getMovementSettings(userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/movement/settings${suffix}`);
}
export function patchMovementSettings(patch, userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/movement/settings${suffix}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function listMovementPlaces(userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/movement/places${suffix}`);
}
export function createMovementPlace(input, userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/movement/places${suffix}`, {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function patchMovementPlace(placeId, patch) {
    return request(`/api/v1/movement/places/${placeId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function patchMovementStay(stayId, patch) {
    return request(`/api/v1/movement/stays/${stayId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function getMovementTripDetail(tripId) {
    return request(`/api/v1/movement/trips/${tripId}`);
}
export function getMovementBoxDetail(boxId, userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/movement/boxes/${boxId}${suffix}`);
}
export function getMovementTimeline(input) {
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
    return request(`/api/v1/movement/timeline${suffix}`);
}
export function createMovementUserBox(input, userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/movement/user-boxes${suffix}`, {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function preflightMovementUserBox(input, userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/movement/user-boxes/preflight${suffix}`, {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function patchMovementUserBox(boxId, patch, userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/movement/user-boxes/${boxId}${suffix}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function deleteMovementUserBox(boxId, userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/movement/user-boxes/${boxId}${suffix}`, {
        method: "DELETE"
    });
}
export function invalidateAutomaticMovementBox(boxId, input, userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/movement/automatic-boxes/${boxId}/invalidate${suffix}`, {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function getMovementSelectionAggregate(input) {
    return request("/api/v1/movement/selection", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function createCompanionPairingSession(input) {
    return request("/api/v1/health/pairing-sessions", {
        method: "POST",
        body: JSON.stringify(input ?? {})
    });
}
export function revokeCompanionPairingSession(pairingSessionId) {
    return request(`/api/v1/health/pairing-sessions/${pairingSessionId}`, {
        method: "DELETE"
    });
}
export function patchCompanionPairingSourceState(pairingSessionId, source, desiredEnabled) {
    return request(`/api/v1/health/pairing-sessions/${pairingSessionId}/sources/${source}`, {
        method: "PATCH",
        body: JSON.stringify({ desiredEnabled })
    });
}
export function revokeAllCompanionPairingSessions(input) {
    return request("/api/v1/health/pairing-sessions/revoke-all", {
        method: "POST",
        body: JSON.stringify(input ?? {})
    });
}
export function patchWorkoutSession(workoutId, patch) {
    return request(`/api/v1/health/workouts/${workoutId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function patchSleepSession(sleepId, patch) {
    return request(`/api/v1/health/sleep/${sleepId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function listUsers() {
    return request("/api/v1/users");
}
export function getUserDirectory() {
    return request("/api/v1/users/directory");
}
export function patchUserAccessGrant(grantId, patch) {
    return request(`/api/v1/users/access-grants/${grantId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function createUser(input) {
    return request("/api/v1/users", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function patchUser(userId, patch) {
    return request(`/api/v1/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function listStrategies(userIds) {
    const search = new URLSearchParams();
    appendUserIds(search, coerceUserIds(userIds));
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return request(`/api/v1/strategies${suffix}`);
}
export function createStrategy(input) {
    return request("/api/v1/strategies", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function getStrategy(strategyId) {
    return request(`/api/v1/strategies/${strategyId}`);
}
export function patchStrategy(strategyId, patch) {
    return request(`/api/v1/strategies/${strategyId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function deleteStrategy(strategyId) {
    return request(`/api/v1/strategies/${strategyId}`, {
        method: "DELETE"
    });
}
export function getSettingsBin() {
    return request("/api/v1/settings/bin");
}
export function getDataManagementState() {
    return request("/api/v1/settings/data");
}
export function patchDataManagementSettings(input) {
    return request("/api/v1/settings/data", {
        method: "PATCH",
        body: JSON.stringify(input)
    });
}
export function scanDataRecoveryCandidates() {
    return request("/api/v1/settings/data/scan", {
        method: "POST",
        body: JSON.stringify({})
    });
}
export function createRuntimeDataBackup(note = "") {
    return request("/api/v1/settings/data/backups", {
        method: "POST",
        body: JSON.stringify({ note })
    });
}
export function restoreRuntimeDataBackup(backupId, createSafetyBackup = true) {
    return request(`/api/v1/settings/data/backups/${backupId}/restore`, {
        method: "POST",
        body: JSON.stringify({ createSafetyBackup })
    });
}
export function switchRuntimeDataRoot(input) {
    return request("/api/v1/settings/data/switch-root", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function downloadDataExport(format) {
    return requestBlob(`/api/v1/settings/data/export?format=${format}`);
}
export function listAgents() {
    return request("/api/v1/agents");
}
export function getAgentOnboarding() {
    return request("/api/v1/agents/onboarding");
}
export function listAgentActions(agentId) {
    return request(`/api/v1/agents/${agentId}/actions`);
}
export function listApprovalRequests() {
    return request("/api/v1/approval-requests");
}
export function approveApprovalRequest(approvalRequestId, note = "") {
    return request(`/api/v1/approval-requests/${approvalRequestId}/approve`, {
        method: "POST",
        body: JSON.stringify({ note })
    });
}
export function rejectApprovalRequest(approvalRequestId, note = "") {
    return request(`/api/v1/approval-requests/${approvalRequestId}/reject`, {
        method: "POST",
        body: JSON.stringify({ note })
    });
}
export function listRewardRules() {
    return request("/api/v1/rewards/rules");
}
export function getRewardRule(ruleId) {
    return request(`/api/v1/rewards/rules/${ruleId}`);
}
export function patchRewardRule(ruleId, patch) {
    return request(`/api/v1/rewards/rules/${ruleId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function createManualRewardGrant(input) {
    return request("/api/v1/rewards/bonus", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function listRewardLedger(limit = 50) {
    return request(`/api/v1/rewards/ledger?limit=${limit}`);
}
export function getXpMetrics() {
    return request("/api/v1/metrics/xp");
}
export function listEventLog(limit = 50) {
    return request(`/api/v1/events?limit=${limit}`);
}
export function patchSettings(input) {
    return request("/api/v1/settings", {
        method: "PATCH",
        body: JSON.stringify(input)
    });
}
export function createEntities(input) {
    return request("/api/v1/entities/create", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function updateEntities(input) {
    return request("/api/v1/entities/update", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function deleteEntities(input) {
    return request("/api/v1/entities/delete", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function restoreEntities(input) {
    return request("/api/v1/entities/restore", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function searchEntities(input) {
    return request("/api/v1/entities/search", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function createAgentToken(input) {
    return request("/api/v1/settings/tokens", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function createAgentAction(input) {
    return request("/api/v1/agent-actions", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function rotateAgentToken(tokenId) {
    return request(`/api/v1/settings/tokens/${tokenId}/rotate`, {
        method: "POST"
    });
}
export function revokeAgentToken(tokenId) {
    return request(`/api/v1/settings/tokens/${tokenId}/revoke`, {
        method: "POST"
    });
}
export function listActivity(input = {}) {
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
    return request(`/api/v1/activity?${search.toString()}`);
}
export function listDiagnosticLogs(input = {}) {
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
    return request(`/api/v1/diagnostics/logs?${search.toString()}`);
}
export function createGoal(input) {
    return request("/api/v1/goals", {
        method: "POST",
        body: JSON.stringify({
            ...input,
            notes: normalizeNestedNotes(input.notes)
        })
    });
}
export function createProject(input) {
    return request("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({
            ...input,
            notes: normalizeNestedNotes(input.notes)
        })
    });
}
export function patchProject(projectId, patch) {
    return request(`/api/v1/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function deleteProject(projectId, mode = "soft") {
    const suffix = mode === "hard" ? "?mode=hard" : "";
    return request(`/api/v1/projects/${projectId}${suffix}`, {
        method: "DELETE"
    });
}
export function patchGoal(goalId, patch) {
    return request(`/api/v1/goals/${goalId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
}
export function deleteGoal(goalId) {
    return request(`/api/v1/goals/${goalId}`, {
        method: "DELETE"
    });
}
export function createTask(input) {
    const normalized = {
        ...input,
        goalId: input.goalId || null,
        projectId: input.projectId || null,
        parentWorkItemId: input.parentWorkItemId || null,
        dueDate: input.dueDate || null,
        plannedDurationSeconds: input.plannedDurationSeconds === undefined
            ? null
            : input.plannedDurationSeconds,
        notes: normalizeNestedNotes(input.notes)
    };
    return request("/api/v1/tasks", {
        method: "POST",
        body: JSON.stringify(normalized)
    });
}
export function createWorkItem(input) {
    const normalized = {
        ...input,
        goalId: input.goalId || null,
        projectId: input.projectId || null,
        parentWorkItemId: input.parentWorkItemId || null,
        dueDate: input.dueDate || null,
        plannedDurationSeconds: input.plannedDurationSeconds === undefined
            ? null
            : input.plannedDurationSeconds,
        notes: normalizeNestedNotes(input.notes)
    };
    return request("/api/v1/work-items", {
        method: "POST",
        body: JSON.stringify(normalized)
    });
}
export function patchTask(taskId, patch) {
    return request(`/api/v1/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({
            ...patch,
            goalId: patch.goalId === "" ? null : patch.goalId,
            projectId: patch.projectId === "" ? null : patch.projectId,
            parentWorkItemId: patch.parentWorkItemId === "" ? null : patch.parentWorkItemId,
            dueDate: patch.dueDate === "" ? null : patch.dueDate,
            plannedDurationSeconds: patch.plannedDurationSeconds === undefined
                ? undefined
                : patch.plannedDurationSeconds
        })
    });
}
export function patchWorkItem(workItemId, patch) {
    return request(`/api/v1/work-items/${workItemId}`, {
        method: "PATCH",
        body: JSON.stringify({
            ...patch,
            goalId: patch.goalId === "" ? null : patch.goalId,
            projectId: patch.projectId === "" ? null : patch.projectId,
            parentWorkItemId: patch.parentWorkItemId === "" ? null : patch.parentWorkItemId,
            dueDate: patch.dueDate === "" ? null : patch.dueDate,
            plannedDurationSeconds: patch.plannedDurationSeconds === undefined
                ? undefined
                : patch.plannedDurationSeconds
        })
    });
}
export function splitTask(taskId, input) {
    return request(`/api/v1/tasks/${taskId}/split`, {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function deleteTask(taskId) {
    return request(`/api/v1/tasks/${taskId}`, {
        method: "DELETE"
    });
}
export function uncompleteTask(taskId) {
    return request(`/api/v1/tasks/${taskId}/uncomplete`, {
        method: "POST",
        body: JSON.stringify({})
    });
}
export function getTaskContext(taskId) {
    return request(`/api/v1/tasks/${taskId}/context`);
}
export function getWorkItemContext(workItemId) {
    return request(`/api/v1/work-items/${workItemId}/context`);
}
export function logOperatorWork(input) {
    return request("/api/v1/operator/log-work", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function createWorkAdjustment(input) {
    return request("/api/v1/work-adjustments", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function removeActivityLog(eventId, reason = "Removed from the visible archive.") {
    return request(`/api/v1/activity/${eventId}/remove`, {
        method: "POST",
        body: JSON.stringify({ reason })
    });
}
export function recordSessionEvent(input) {
    return request("/api/v1/session-events", {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function claimTaskRun(taskId, input) {
    return request(`/api/v1/tasks/${taskId}/runs`, {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function heartbeatTaskRun(taskRunId, input) {
    return request(`/api/v1/task-runs/${taskRunId}/heartbeat`, {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function focusTaskRun(taskRunId, input = {}) {
    return request(`/api/v1/task-runs/${taskRunId}/focus`, {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function completeTaskRun(taskRunId, input) {
    return request(`/api/v1/task-runs/${taskRunId}/complete`, {
        method: "POST",
        body: JSON.stringify(input)
    });
}
export function releaseTaskRun(taskRunId, input) {
    return request(`/api/v1/task-runs/${taskRunId}/release`, {
        method: "POST",
        body: JSON.stringify(input)
    });
}
