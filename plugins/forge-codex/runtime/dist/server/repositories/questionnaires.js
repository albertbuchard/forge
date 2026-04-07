import { randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import { getQuestionnaireSeeds } from "../questionnaire-seeds.js";
import { getQuestionnaireVisibilityState, validateQuestionnaireFlow } from "../questionnaire-flow.js";
import { createQuestionnaireInstrumentSchema, questionnaireInstrumentSummarySchema, publishQuestionnaireVersionSchema, questionnaireDefinitionSchema, questionnaireInstrumentDetailSchema, questionnaireRunDetailSchema, questionnaireRunSchema, questionnaireRunScoreSchema, questionnaireScoringSchema, questionnaireVersionSchema, startQuestionnaireRunSchema, updateQuestionnaireRunSchema, updateQuestionnaireVersionSchema } from "../questionnaire-types.js";
import { recordActivityEvent } from "./activity-events.js";
import { createNote } from "./notes.js";
const DEFAULT_CUSTOM_USER_ID = "user_operator";
const SELF_OBSERVATION_TAG = "Self-observation";
function nowIso() {
    return new Date().toISOString();
}
function parseJson(value) {
    return JSON.parse(value);
}
function buildId(prefix) {
    return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
}
function createHttpError(options) {
    return new HttpError(options.statusCode, options.code, options.message, options.details);
}
function slugify(text) {
    const normalized = text
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return normalized || `questionnaire-${randomUUID().slice(0, 8)}`;
}
function normalizeCustomOwner(userId) {
    return userId ?? DEFAULT_CUSTOM_USER_ID;
}
function isInstrumentVisible(row, userIds) {
    if (row.is_system === 1) {
        return true;
    }
    if (!userIds || userIds.length === 0) {
        return true;
    }
    return row.owner_user_id ? userIds.includes(row.owner_user_id) : true;
}
function mapVersion(row) {
    return questionnaireVersionSchema.parse({
        id: row.id,
        instrumentId: row.instrument_id,
        versionNumber: row.version_number,
        status: row.status,
        label: row.label,
        isReadOnly: row.is_read_only === 1,
        definition: questionnaireDefinitionSchema.parse(parseJson(row.definition_json)),
        scoring: questionnaireScoringSchema.parse(parseJson(row.scoring_json)),
        provenance: parseJson(row.provenance_json),
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        publishedAt: row.published_at
    });
}
function selectPrimaryVersion(instrument, versions) {
    if (instrument.current_published_version_id) {
        return (versions.find((version) => version.id === instrument.current_published_version_id) ??
            null);
    }
    if (instrument.current_draft_version_id) {
        return (versions.find((version) => version.id === instrument.current_draft_version_id) ?? null);
    }
    return versions[0] ?? null;
}
function getHistoryForInstrument(instrumentId, userIds) {
    const database = getDatabase();
    const rows = database
        .prepare(`
        SELECT
          runs.id AS run_id,
          runs.completed_at,
          scores.label AS score_label,
          scores.value_numeric AS score_value,
          scores.band_label
        FROM questionnaire_runs runs
        LEFT JOIN questionnaire_run_scores scores
          ON scores.run_id = runs.id
         AND scores.sort_order = (
           SELECT MIN(inner_scores.sort_order)
           FROM questionnaire_run_scores inner_scores
           WHERE inner_scores.run_id = runs.id
             AND inner_scores.value_numeric IS NOT NULL
         )
        WHERE runs.instrument_id = ?
          AND runs.status = 'completed'
          ${userIds && userIds.length > 0 ? `AND COALESCE(runs.user_id, '') IN (${userIds.map(() => "?").join(",")})` : ""}
        ORDER BY runs.completed_at DESC
        LIMIT 40
      `)
        .all(instrumentId, ...(userIds?.map((entry) => entry ?? "") ?? []));
    return rows.map((row) => ({
        runId: row.run_id,
        completedAt: row.completed_at,
        primaryScore: row.score_value,
        primaryScoreLabel: row.score_label ?? "",
        bandLabel: row.band_label ?? ""
    }));
}
function getLatestDraftRunId(instrumentId, versionId, userIds) {
    if (!versionId) {
        return null;
    }
    const database = getDatabase();
    const row = database
        .prepare(`
        SELECT id
        FROM questionnaire_runs
        WHERE instrument_id = ?
          AND version_id = ?
          AND status = 'draft'
          ${userIds && userIds.length > 0 ? `AND COALESCE(user_id, '') IN (${userIds.map(() => "?").join(",")})` : ""}
        ORDER BY updated_at DESC
        LIMIT 1
      `)
        .get(instrumentId, versionId, ...(userIds?.map((entry) => entry ?? "") ?? []));
    return row?.id ?? null;
}
function getSummaryStats(instrumentId, userIds) {
    const database = getDatabase();
    const completedRow = database
        .prepare(`
        SELECT COUNT(*) AS count
        FROM questionnaire_runs
        WHERE instrument_id = ?
          AND status = 'completed'
          ${userIds && userIds.length > 0 ? `AND COALESCE(user_id, '') IN (${userIds.map(() => "?").join(",")})` : ""}
      `)
        .get(instrumentId, ...(userIds?.map((entry) => entry ?? "") ?? []));
    const latestRow = database
        .prepare(`
        SELECT id, completed_at
        FROM questionnaire_runs
        WHERE instrument_id = ?
          AND status = 'completed'
          ${userIds && userIds.length > 0 ? `AND COALESCE(user_id, '') IN (${userIds.map(() => "?").join(",")})` : ""}
        ORDER BY completed_at DESC
        LIMIT 1
      `)
        .get(instrumentId, ...(userIds?.map((entry) => entry ?? "") ?? []));
    return {
        completedRunCount: completedRow.count,
        latestRunId: latestRow?.id ?? null,
        latestRunAt: latestRow?.completed_at ?? null
    };
}
function mapSummary(row, versions, userIds) {
    const currentVersion = selectPrimaryVersion(row, versions);
    const stats = getSummaryStats(row.id, userIds);
    const primarySourceUrl = currentVersion?.provenance.sources[0]?.url ?? "";
    return questionnaireInstrumentSummarySchema.parse({
        id: row.id,
        key: row.key,
        slug: row.slug,
        title: row.title,
        subtitle: row.subtitle,
        description: row.description,
        aliases: parseJson(row.aliases_json),
        symptomDomains: parseJson(row.symptom_domains_json),
        tags: parseJson(row.tags_json),
        sourceClass: row.source_class,
        availability: row.availability,
        responseStyle: currentVersion?.definition.responseStyle ?? "unknown",
        presentationMode: currentVersion?.definition.presentationMode ?? "single_question",
        itemCount: currentVersion?.definition.items.length ?? 0,
        isSelfReport: row.is_self_report === 1,
        isSystem: row.is_system === 1,
        isReadOnly: row.is_system === 1 || currentVersion?.status !== "draft",
        ownerUserId: row.owner_user_id,
        currentVersionId: currentVersion?.id ?? null,
        currentVersionNumber: currentVersion?.versionNumber ?? null,
        latestRunId: stats.latestRunId,
        latestRunAt: stats.latestRunAt,
        completedRunCount: stats.completedRunCount,
        primarySourceUrl,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
function assertValidQuestionnaireDefinition(definition) {
    validateQuestionnaireFlow(definition);
}
function getVersionRowsForInstrument(instrumentId) {
    return getDatabase()
        .prepare(`
        SELECT *
        FROM questionnaire_versions
        WHERE instrument_id = ?
        ORDER BY version_number DESC
      `)
        .all(instrumentId);
}
function getInstrumentRow(id) {
    return getDatabase()
        .prepare("SELECT * FROM questionnaire_instruments WHERE id = ?")
        .get(id);
}
function getVersionRow(id) {
    return getDatabase()
        .prepare("SELECT * FROM questionnaire_versions WHERE id = ?")
        .get(id);
}
function getRunRow(id) {
    return getDatabase()
        .prepare("SELECT * FROM questionnaire_runs WHERE id = ?")
        .get(id);
}
function getCurrentPublishedOrDraftVersion(instrument) {
    const versionId = instrument.current_published_version_id ?? instrument.current_draft_version_id;
    if (!versionId) {
        throw createHttpError({
            statusCode: 404,
            code: "questionnaire_version_missing",
            message: "No questionnaire version is available for this instrument."
        });
    }
    const row = getVersionRow(versionId);
    if (!row) {
        throw createHttpError({
            statusCode: 404,
            code: "questionnaire_version_missing",
            message: "Questionnaire version not found."
        });
    }
    return mapVersion(row);
}
function coerceNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "boolean") {
        return value ? 1 : 0;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
function compare(left, comparator, right) {
    if (left === null || right === null) {
        return false;
    }
    switch (comparator) {
        case "eq":
            return left === right;
        case "neq":
            return left !== right;
        case "gt":
            return left > right;
        case "gte":
            return left >= right;
        case "lt":
            return left < right;
        case "lte":
            return left <= right;
        default:
            return false;
    }
}
function evaluateExpression(expression, answerMap, scoreMap) {
    switch (expression.kind) {
        case "const":
            return expression.value;
        case "answer":
            return answerMap.get(expression.itemId) ?? expression.defaultValue ?? null;
        case "score":
            return scoreMap.get(expression.scoreKey) ?? null;
        case "add": {
            const numbers = expression.values.map((value) => coerceNumber(evaluateExpression(value, answerMap, scoreMap)));
            if (numbers.some((value) => value === null)) {
                return null;
            }
            const present = numbers.filter((value) => value !== null);
            return present.reduce((sum, value) => sum + value, 0);
        }
        case "multiply": {
            const numbers = expression.values.map((value) => coerceNumber(evaluateExpression(value, answerMap, scoreMap)));
            if (numbers.some((value) => value === null)) {
                return null;
            }
            const present = numbers.filter((value) => value !== null);
            return present.reduce((product, value) => product * value, 1);
        }
        case "min": {
            const numbers = expression.values
                .map((value) => coerceNumber(evaluateExpression(value, answerMap, scoreMap)))
                .filter((value) => value !== null);
            return numbers.length > 0 ? Math.min(...numbers) : null;
        }
        case "max": {
            const numbers = expression.values
                .map((value) => coerceNumber(evaluateExpression(value, answerMap, scoreMap)))
                .filter((value) => value !== null);
            return numbers.length > 0 ? Math.max(...numbers) : null;
        }
        case "subtract": {
            const left = coerceNumber(evaluateExpression(expression.left, answerMap, scoreMap));
            const right = coerceNumber(evaluateExpression(expression.right, answerMap, scoreMap));
            return left === null || right === null ? null : left - right;
        }
        case "divide": {
            const left = coerceNumber(evaluateExpression(expression.left, answerMap, scoreMap));
            const right = coerceNumber(evaluateExpression(expression.right, answerMap, scoreMap));
            if (left === null || right === null) {
                return null;
            }
            if (right === 0) {
                return expression.zeroValue ?? null;
            }
            return left / right;
        }
        case "sum": {
            const values = expression.itemIds
                .map((itemId) => answerMap.get(itemId))
                .filter((value) => value !== null && value !== undefined);
            return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
        }
        case "average": {
            const values = expression.itemIds
                .map((itemId) => answerMap.get(itemId))
                .filter((value) => value !== null && value !== undefined);
            return values.length > 0
                ? values.reduce((sum, value) => sum + value, 0) / values.length
                : null;
        }
        case "weighted_sum": {
            const values = expression.terms.map((term) => {
                const current = answerMap.get(term.itemId);
                return current === null || current === undefined ? null : current * term.weight;
            });
            if (values.some((value) => value === null)) {
                return null;
            }
            const present = values.filter((value) => value !== null);
            return present.reduce((sum, value) => sum + value, 0);
        }
        case "count_if": {
            const values = expression.itemIds
                .map((itemId) => answerMap.get(itemId))
                .filter((value) => value !== null && value !== undefined);
            return values.filter((value) => compare(value, expression.comparator, expression.target)).length;
        }
        case "filtered_mean": {
            const values = expression.itemIds
                .map((itemId) => answerMap.get(itemId))
                .filter((value) => value !== null && value !== undefined)
                .filter((value) => compare(value, expression.comparator, expression.target));
            return values.length > 0
                ? values.reduce((sum, value) => sum + value, 0) / values.length
                : null;
        }
        case "compare": {
            const left = coerceNumber(evaluateExpression(expression.left, answerMap, scoreMap));
            const right = coerceNumber(evaluateExpression(expression.right, answerMap, scoreMap));
            return compare(left, expression.comparator, right);
        }
        case "if": {
            const condition = evaluateExpression(expression.condition, answerMap, scoreMap);
            return condition ? evaluateExpression(expression.then, answerMap, scoreMap) : evaluateExpression(expression.else, answerMap, scoreMap);
        }
        case "round": {
            const value = coerceNumber(evaluateExpression(expression.value, answerMap, scoreMap));
            if (value === null) {
                return null;
            }
            const factor = 10 ** expression.digits;
            return Math.round(value * factor) / factor;
        }
        default:
            return null;
    }
}
function collectDependentItemIds(expression) {
    switch (expression.kind) {
        case "answer":
            return [expression.itemId];
        case "sum":
        case "average":
        case "count_if":
        case "filtered_mean":
            return [...expression.itemIds];
        case "weighted_sum":
            return expression.terms.map((term) => term.itemId);
        case "add":
        case "multiply":
        case "min":
        case "max":
            return expression.values.flatMap((value) => collectDependentItemIds(value));
        case "subtract":
        case "divide":
        case "compare":
            return [
                ...collectDependentItemIds(expression.left),
                ...collectDependentItemIds(expression.right)
            ];
        case "if":
            return [
                ...collectDependentItemIds(expression.condition),
                ...collectDependentItemIds(expression.then),
                ...collectDependentItemIds(expression.else)
            ];
        case "round":
            return collectDependentItemIds(expression.value);
        default:
            return [];
    }
}
function resolveMissingPolicy(definition, answerMap, visibleItemIds) {
    const policy = definition.missingPolicy ?? { mode: "require_all" };
    const itemIds = (definition.dependsOnItemIds.length > 0
        ? definition.dependsOnItemIds
        : Array.from(new Set(collectDependentItemIds(definition.expression)))).filter((itemId) => !visibleItemIds || visibleItemIds.has(itemId));
    if (itemIds.length === 0) {
        return false;
    }
    const answered = itemIds.filter((itemId) => {
        const value = answerMap.get(itemId);
        return value !== null && value !== undefined;
    }).length;
    if (policy.mode === "allow_partial") {
        return answered === 0;
    }
    if (policy.mode === "min_answered") {
        return answered < (policy.minAnswered ?? itemIds.length);
    }
    return answered < itemIds.length;
}
function resolveBand(definition, value) {
    const numeric = coerceNumber(value);
    if (numeric === null) {
        return { bandLabel: "", severity: "" };
    }
    const band = definition.bands.find((entry) => {
        const minOk = entry.min === null || entry.min === undefined || numeric >= entry.min;
        const maxOk = entry.max === null || entry.max === undefined || numeric <= entry.max;
        return minOk && maxOk;
    });
    return {
        bandLabel: band?.label ?? "",
        severity: band?.severity ?? ""
    };
}
function formatScoreForNote(score) {
    const value = score.valueText ??
        (typeof score.valueNumeric === "number" ? String(score.valueNumeric) : "Not scored");
    return score.bandLabel ? `${value} (${score.bandLabel})` : value;
}
function buildCompletionNoteContent(options) {
    const answerRowsByItemId = new Map(options.answers.map((answer) => [answer.item_id, answer]));
    const scoreLines = options.scores
        .map((score) => `- ${score.label}: ${formatScoreForNote(score)}`)
        .join("\n");
    const answerLines = options.version.definition.items
        .map((item) => {
        const answer = answerRowsByItemId.get(item.id);
        const label = answer?.value_text ||
            item.options.find((option) => option.key === answer?.option_key)?.label ||
            "No answer";
        const numeric = typeof answer?.numeric_value === "number"
            ? ` (${answer.numeric_value})`
            : "";
        return `- ${item.prompt}: ${label}${numeric}`;
    })
        .join("\n");
    return [
        `# ${options.instrument.title}`,
        "",
        `Completed at: ${options.completedAt}`,
        options.version.label ? `Version: ${options.version.label}` : "",
        "",
        "## Scores",
        scoreLines || "- No scores",
        "",
        "## Answers",
        answerLines || "- No answers"
    ]
        .filter(Boolean)
        .join("\n");
}
function scoreRun(version, answers) {
    const visibility = getQuestionnaireVisibilityState(version.definition, answers);
    const answerMap = new Map();
    for (const item of version.definition.items) {
        answerMap.set(item.id, null);
    }
    for (const answer of answers) {
        answerMap.set(answer.item_id, visibility.visibleItemIds.has(answer.item_id) ? answer.numeric_value : null);
    }
    const scoreValueMap = new Map();
    return version.scoring.scores.map((definition, index) => {
        const blockedByMissing = resolveMissingPolicy(definition, answerMap, visibility.visibleItemIds);
        let value = blockedByMissing
            ? null
            : evaluateExpression(definition.expression, answerMap, scoreValueMap);
        if (typeof value === "number" && definition.roundTo !== null && definition.roundTo !== undefined) {
            const factor = 10 ** definition.roundTo;
            value = Math.round(value * factor) / factor;
        }
        scoreValueMap.set(definition.key, value);
        const { bandLabel, severity } = resolveBand(definition, value);
        return {
            sortOrder: index,
            scoreKey: definition.key,
            label: definition.label,
            valueNumeric: typeof value === "number" ? value : coerceNumber(value),
            valueText: typeof value === "string"
                ? value
                : typeof value === "boolean"
                    ? String(value)
                    : null,
            bandLabel,
            severity,
            details: {
                description: definition.description,
                valueType: definition.valueType,
                unitLabel: definition.unitLabel,
                missingPolicy: definition.missingPolicy ?? { mode: "require_all" },
                dependsOnItemIds: definition.dependsOnItemIds.length > 0
                    ? definition.dependsOnItemIds
                    : Array.from(new Set(collectDependentItemIds(definition.expression)))
            }
        };
    });
}
function hydrateInstrumentDetail(row, userIds) {
    const versions = getVersionRowsForInstrument(row.id).map(mapVersion);
    const currentVersion = selectPrimaryVersion(row, versions);
    const draftVersion = row.current_draft_version_id
        ? versions.find((version) => version.id === row.current_draft_version_id) ?? null
        : null;
    const summary = mapSummary(row, versions, userIds);
    return questionnaireInstrumentDetailSchema.parse({
        ...summary,
        status: row.status,
        currentVersion,
        draftVersion,
        versions,
        history: getHistoryForInstrument(row.id, userIds),
        latestDraftRunId: getLatestDraftRunId(row.id, currentVersion?.id ?? null, userIds)
    });
}
function assertEditableInstrument(row) {
    if (row.is_system === 1) {
        throw createHttpError({
            statusCode: 403,
            code: "questionnaire_read_only",
            message: "System questionnaire definitions cannot be edited directly."
        });
    }
}
function insertVersion(options) {
    getDatabase()
        .prepare(`
        INSERT INTO questionnaire_versions (
          id,
          instrument_id,
          version_number,
          status,
          label,
          definition_json,
          scoring_json,
          provenance_json,
          is_read_only,
          created_by,
          created_at,
          updated_at,
          published_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .run(options.id, options.instrumentId, options.versionNumber, options.status, options.label, JSON.stringify(options.definition), JSON.stringify(options.scoring), JSON.stringify(options.provenance), options.isReadOnly ? 1 : 0, options.createdBy, nowIso(), nowIso(), options.publishedAt ?? null);
}
export function ensureQuestionnaireSeeds() {
    const database = getDatabase();
    const hasTables = database
        .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = 'questionnaire_instruments'
      `)
        .get();
    if (!hasTables) {
        return;
    }
    runInTransaction(() => {
        for (const seed of getQuestionnaireSeeds()) {
            assertValidQuestionnaireDefinition(seed.definition);
            const existing = database
                .prepare("SELECT id FROM questionnaire_instruments WHERE key = ?")
                .get(seed.key);
            if (existing) {
                continue;
            }
            const now = nowIso();
            const instrumentId = `questionnaire_${seed.key}`;
            const versionId = `questionnaire_version_${seed.key}_v1`;
            database
                .prepare(`
            INSERT INTO questionnaire_instruments (
              id,
              key,
              slug,
              title,
              subtitle,
              description,
              aliases_json,
              symptom_domains_json,
              tags_json,
              source_class,
              availability,
              is_self_report,
              is_system,
              status,
              owner_user_id,
              current_draft_version_id,
              current_published_version_id,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, NULL, ?, ?, ?)
          `)
                .run(instrumentId, seed.key, seed.slug, seed.title, seed.subtitle, seed.description, JSON.stringify(seed.aliases), JSON.stringify(seed.symptomDomains), JSON.stringify(seed.tags), seed.sourceClass, seed.availability, seed.isSelfReport ? 1 : 0, 1, versionId, now, now);
            insertVersion({
                id: versionId,
                instrumentId,
                versionNumber: 1,
                status: "published",
                label: "Seeded v1",
                definition: seed.definition,
                scoring: seed.scoring,
                provenance: seed.provenance,
                isReadOnly: true,
                createdBy: "system",
                publishedAt: now
            });
        }
    });
}
export function listQuestionnaireInstruments(options = {}) {
    const rows = getDatabase()
        .prepare(`
        SELECT *
        FROM questionnaire_instruments
        WHERE status != 'archived'
        ORDER BY is_system DESC, title COLLATE NOCASE ASC
      `)
        .all();
    const instruments = rows
        .filter((row) => isInstrumentVisible(row, options.userIds))
        .map((row) => mapSummary(row, getVersionRowsForInstrument(row.id).map(mapVersion), options.userIds));
    return { instruments };
}
export function getQuestionnaireInstrumentDetail(instrumentId, options = {}) {
    const row = getInstrumentRow(instrumentId);
    if (!row || !isInstrumentVisible(row, options.userIds)) {
        throw createHttpError({
            statusCode: 404,
            code: "questionnaire_not_found",
            message: "Questionnaire instrument not found."
        });
    }
    return { instrument: hydrateInstrumentDetail(row, options.userIds) };
}
export function createQuestionnaireInstrument(input, context) {
    const parsed = createQuestionnaireInstrumentSchema.parse(input);
    assertValidQuestionnaireDefinition(parsed.definition);
    return runInTransaction(() => {
        const database = getDatabase();
        const now = nowIso();
        const instrumentId = buildId("questionnaire");
        const versionId = buildId("questionnaire_version");
        const slugBase = slugify(parsed.title);
        const slug = `${slugBase}-${instrumentId.slice(-4)}`;
        database
            .prepare(`
          INSERT INTO questionnaire_instruments (
            id,
            key,
            slug,
            title,
            subtitle,
            description,
            aliases_json,
            symptom_domains_json,
            tags_json,
            source_class,
            availability,
            is_self_report,
            is_system,
            status,
            owner_user_id,
            current_draft_version_id,
            current_published_version_id,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, NULL, ?, ?)
        `)
            .run(instrumentId, slug.replaceAll("-", "_"), slug, parsed.title, parsed.subtitle, parsed.description, JSON.stringify(parsed.aliases), JSON.stringify(parsed.symptomDomains), JSON.stringify(parsed.tags), parsed.sourceClass, parsed.availability, parsed.isSelfReport ? 1 : 0, normalizeCustomOwner(parsed.userId), versionId, now, now);
        insertVersion({
            id: versionId,
            instrumentId,
            versionNumber: 1,
            status: "draft",
            label: parsed.versionLabel,
            definition: parsed.definition,
            scoring: parsed.scoring,
            provenance: parsed.provenance,
            isReadOnly: false,
            createdBy: context.actor ?? null
        });
        recordActivityEvent({
            entityType: "questionnaire_instrument",
            entityId: instrumentId,
            eventType: "questionnaire_instrument_created",
            title: `Questionnaire created: ${parsed.title}`,
            description: "A custom questionnaire draft was created in Psyche.",
            actor: context.actor ?? null,
            source: context.source,
            metadata: {
                versionId,
                availability: parsed.availability
            }
        });
        return getQuestionnaireInstrumentDetail(instrumentId);
    });
}
export const updateQuestionnaireInstrumentSchema = createQuestionnaireInstrumentSchema
    .omit({ versionLabel: true })
    .partial();
export function listQuestionnaireInstrumentEntities(options = {}) {
    return listQuestionnaireInstruments(options).instruments;
}
export function getQuestionnaireInstrumentEntityById(instrumentId, options = {}) {
    return getQuestionnaireInstrumentDetail(instrumentId, options).instrument;
}
export function updateQuestionnaireInstrument(instrumentId, patch, context) {
    const parsed = updateQuestionnaireInstrumentSchema.parse(patch);
    const detail = getQuestionnaireInstrumentDetail(instrumentId);
    const currentVersion = detail.instrument.draftVersion ??
        detail.instrument.currentVersion;
    if (!currentVersion) {
        throw createHttpError({
            statusCode: 404,
            code: "questionnaire_version_missing",
            message: "No questionnaire version is available for this instrument."
        });
    }
    return updateQuestionnaireDraftVersion(instrumentId, {
        title: parsed.title ?? detail.instrument.title,
        subtitle: parsed.subtitle ?? detail.instrument.subtitle,
        description: parsed.description ?? detail.instrument.description,
        aliases: parsed.aliases ?? detail.instrument.aliases,
        symptomDomains: parsed.symptomDomains ?? detail.instrument.symptomDomains,
        tags: parsed.tags ?? detail.instrument.tags,
        sourceClass: parsed.sourceClass ?? detail.instrument.sourceClass,
        availability: parsed.availability ?? detail.instrument.availability,
        isSelfReport: parsed.isSelfReport ?? detail.instrument.isSelfReport,
        label: currentVersion.label,
        definition: parsed.definition ?? currentVersion.definition,
        scoring: parsed.scoring ?? currentVersion.scoring,
        provenance: parsed.provenance ?? currentVersion.provenance
    }, context).instrument;
}
export function deleteQuestionnaireInstrument(instrumentId, context) {
    return runInTransaction(() => {
        const row = getInstrumentRow(instrumentId);
        if (!row) {
            throw createHttpError({
                statusCode: 404,
                code: "questionnaire_not_found",
                message: "Questionnaire instrument not found."
            });
        }
        assertEditableInstrument(row);
        const detail = getQuestionnaireInstrumentDetail(instrumentId);
        getDatabase()
            .prepare(`
          UPDATE questionnaire_instruments
          SET status = 'archived', updated_at = ?
          WHERE id = ?
        `)
            .run(nowIso(), instrumentId);
        recordActivityEvent({
            entityType: "questionnaire_instrument",
            entityId: instrumentId,
            eventType: "questionnaire_archived",
            title: `Questionnaire archived: ${row.title}`,
            description: "A questionnaire instrument was archived.",
            actor: context.actor ?? null,
            source: context.source
        });
        return detail.instrument;
    });
}
export function cloneQuestionnaireInstrument(instrumentId, options, context) {
    const row = getInstrumentRow(instrumentId);
    if (!row) {
        throw createHttpError({
            statusCode: 404,
            code: "questionnaire_not_found",
            message: "Questionnaire instrument not found."
        });
    }
    const sourceVersion = getCurrentPublishedOrDraftVersion(row);
    return createQuestionnaireInstrument({
        title: `${row.title} copy`,
        subtitle: row.subtitle,
        description: row.description,
        aliases: parseJson(row.aliases_json),
        symptomDomains: parseJson(row.symptom_domains_json),
        tags: Array.from(new Set([...parseJson(row.tags_json), "custom-copy"])),
        sourceClass: row.source_class,
        availability: "custom",
        isSelfReport: row.is_self_report === 1,
        userId: options.userId ?? row.owner_user_id ?? DEFAULT_CUSTOM_USER_ID,
        versionLabel: `Draft from ${row.title}`,
        definition: sourceVersion.definition,
        scoring: sourceVersion.scoring,
        provenance: sourceVersion.provenance
    }, context);
}
export function ensureQuestionnaireDraftVersion(instrumentId, context) {
    return runInTransaction(() => {
        const row = getInstrumentRow(instrumentId);
        if (!row) {
            throw createHttpError({
                statusCode: 404,
                code: "questionnaire_not_found",
                message: "Questionnaire instrument not found."
            });
        }
        assertEditableInstrument(row);
        if (row.current_draft_version_id) {
            return getQuestionnaireInstrumentDetail(instrumentId);
        }
        const sourceVersion = getCurrentPublishedOrDraftVersion(row);
        const nextVersionNumber = Math.max(0, ...getVersionRowsForInstrument(instrumentId).map((entry) => entry.version_number)) + 1;
        const versionId = buildId("questionnaire_version");
        insertVersion({
            id: versionId,
            instrumentId,
            versionNumber: nextVersionNumber,
            status: "draft",
            label: `Draft ${nextVersionNumber}`,
            definition: sourceVersion.definition,
            scoring: sourceVersion.scoring,
            provenance: sourceVersion.provenance,
            isReadOnly: false,
            createdBy: context.actor ?? null
        });
        getDatabase()
            .prepare(`
          UPDATE questionnaire_instruments
          SET current_draft_version_id = ?, updated_at = ?
          WHERE id = ?
        `)
            .run(versionId, nowIso(), instrumentId);
        return getQuestionnaireInstrumentDetail(instrumentId);
    });
}
export function updateQuestionnaireDraftVersion(instrumentId, input, context) {
    const parsed = updateQuestionnaireVersionSchema.parse(input);
    assertValidQuestionnaireDefinition(parsed.definition);
    return runInTransaction(() => {
        const row = getInstrumentRow(instrumentId);
        if (!row) {
            throw createHttpError({
                statusCode: 404,
                code: "questionnaire_not_found",
                message: "Questionnaire instrument not found."
            });
        }
        assertEditableInstrument(row);
        const detail = ensureQuestionnaireDraftVersion(instrumentId, context);
        const draftVersionId = detail.instrument.draftVersion?.id;
        if (!draftVersionId) {
            throw createHttpError({
                statusCode: 400,
                code: "questionnaire_draft_missing",
                message: "No editable draft version is available."
            });
        }
        getDatabase()
            .prepare(`
          UPDATE questionnaire_instruments
          SET
            title = ?,
            subtitle = ?,
            description = ?,
            aliases_json = ?,
            symptom_domains_json = ?,
            tags_json = ?,
            source_class = ?,
            availability = ?,
            is_self_report = ?,
            updated_at = ?
          WHERE id = ?
        `)
            .run(parsed.title, parsed.subtitle, parsed.description, JSON.stringify(parsed.aliases), JSON.stringify(parsed.symptomDomains), JSON.stringify(parsed.tags), parsed.sourceClass, parsed.availability, parsed.isSelfReport ? 1 : 0, nowIso(), instrumentId);
        getDatabase()
            .prepare(`
          UPDATE questionnaire_versions
          SET
            label = ?,
            definition_json = ?,
            scoring_json = ?,
            provenance_json = ?,
            updated_at = ?
          WHERE id = ?
            AND status = 'draft'
        `)
            .run(parsed.label, JSON.stringify(parsed.definition), JSON.stringify(parsed.scoring), JSON.stringify(parsed.provenance), nowIso(), draftVersionId);
        recordActivityEvent({
            entityType: "questionnaire_instrument",
            entityId: instrumentId,
            eventType: "questionnaire_draft_updated",
            title: `Questionnaire draft updated: ${parsed.title}`,
            description: "A questionnaire draft definition was updated.",
            actor: context.actor ?? null,
            source: context.source,
            metadata: {
                versionId: draftVersionId
            }
        });
        return getQuestionnaireInstrumentDetail(instrumentId);
    });
}
export function publishQuestionnaireDraftVersion(instrumentId, input, context) {
    const parsed = publishQuestionnaireVersionSchema.parse(input ?? {});
    return runInTransaction(() => {
        const row = getInstrumentRow(instrumentId);
        if (!row) {
            throw createHttpError({
                statusCode: 404,
                code: "questionnaire_not_found",
                message: "Questionnaire instrument not found."
            });
        }
        assertEditableInstrument(row);
        const draftVersionId = row.current_draft_version_id;
        if (!draftVersionId) {
            throw createHttpError({
                statusCode: 400,
                code: "questionnaire_draft_missing",
                message: "No draft version is available to publish."
            });
        }
        const publishedAt = nowIso();
        getDatabase()
            .prepare(`
          UPDATE questionnaire_versions
          SET status = 'published', label = ?, published_at = ?, updated_at = ?
          WHERE id = ?
        `)
            .run(parsed.label || "Published", publishedAt, publishedAt, draftVersionId);
        getDatabase()
            .prepare(`
          UPDATE questionnaire_instruments
          SET
            current_published_version_id = ?,
            current_draft_version_id = NULL,
            updated_at = ?
          WHERE id = ?
        `)
            .run(draftVersionId, publishedAt, instrumentId);
        recordActivityEvent({
            entityType: "questionnaire_instrument",
            entityId: instrumentId,
            eventType: "questionnaire_version_published",
            title: `Questionnaire published: ${row.title}`,
            description: "A questionnaire draft version was published.",
            actor: context.actor ?? null,
            source: context.source,
            metadata: {
                versionId: draftVersionId
            }
        });
        return getQuestionnaireInstrumentDetail(instrumentId);
    });
}
function upsertRunAnswers(runId, answers) {
    const database = getDatabase();
    const now = nowIso();
    const statement = database.prepare(`
      INSERT INTO questionnaire_answers (
        id,
        run_id,
        item_id,
        option_key,
        value_text,
        numeric_value,
        answer_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, item_id) DO UPDATE SET
        option_key = excluded.option_key,
        value_text = excluded.value_text,
        numeric_value = excluded.numeric_value,
        answer_json = excluded.answer_json,
        updated_at = excluded.updated_at
    `);
    for (const answer of answers) {
        statement.run(buildId("questionnaire_answer"), runId, answer.itemId, answer.optionKey ?? null, answer.valueText, answer.numericValue ?? null, JSON.stringify(answer.answer), now, now);
    }
}
function listAnswerRows(runId) {
    return getDatabase()
        .prepare(`
        SELECT item_id, option_key, value_text, numeric_value, answer_json, created_at, updated_at
        FROM questionnaire_answers
        WHERE run_id = ?
        ORDER BY item_id
      `)
        .all(runId);
}
function listRunScoreRows(runId) {
    return getDatabase()
        .prepare(`
        SELECT score_key, label, value_numeric, value_text, band_label, severity, sort_order, details_json, created_at
        FROM questionnaire_run_scores
        WHERE run_id = ?
        ORDER BY sort_order ASC, score_key ASC
      `)
        .all(runId);
}
function mapRun(row) {
    return questionnaireRunSchema.parse({
        id: row.id,
        instrumentId: row.instrument_id,
        versionId: row.version_id,
        userId: row.user_id,
        status: row.status,
        startedAt: row.started_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at,
        progressIndex: row.progress_index
    });
}
export function startQuestionnaireRun(instrumentId, input, context) {
    const parsed = startQuestionnaireRunSchema.parse(input ?? {});
    return runInTransaction(() => {
        const row = getInstrumentRow(instrumentId);
        if (!row) {
            throw createHttpError({
                statusCode: 404,
                code: "questionnaire_not_found",
                message: "Questionnaire instrument not found."
            });
        }
        const versionId = parsed.versionId ??
            row.current_published_version_id ??
            row.current_draft_version_id;
        if (!versionId) {
            throw createHttpError({
                statusCode: 404,
                code: "questionnaire_version_missing",
                message: "No questionnaire version is available for this instrument."
            });
        }
        const version = getVersionRow(versionId);
        if (!version) {
            throw createHttpError({
                statusCode: 404,
                code: "questionnaire_version_missing",
                message: "Questionnaire version not found."
            });
        }
        const userId = normalizeCustomOwner(parsed.userId);
        const existing = getDatabase()
            .prepare(`
          SELECT *
          FROM questionnaire_runs
          WHERE instrument_id = ?
            AND version_id = ?
            AND COALESCE(user_id, '') = ?
            AND status = 'draft'
          ORDER BY updated_at DESC
          LIMIT 1
        `)
            .get(instrumentId, versionId, userId);
        if (existing) {
            return getQuestionnaireRunDetail(existing.id);
        }
        const now = nowIso();
        const runId = buildId("questionnaire_run");
        getDatabase()
            .prepare(`
          INSERT INTO questionnaire_runs (
            id,
            instrument_id,
            version_id,
            user_id,
            status,
            progress_index,
            started_at,
            updated_at,
            completed_at
          )
          VALUES (?, ?, ?, ?, 'draft', 0, ?, ?, NULL)
        `)
            .run(runId, instrumentId, versionId, userId, now, now);
        recordActivityEvent({
            entityType: "questionnaire_run",
            entityId: runId,
            eventType: "questionnaire_run_started",
            title: `Questionnaire started: ${row.title}`,
            description: "A questionnaire run was started or resumed.",
            actor: context.actor ?? null,
            source: context.source,
            metadata: {
                instrumentId,
                versionId
            }
        });
        return getQuestionnaireRunDetail(runId);
    });
}
export function updateQuestionnaireRun(runId, input, context) {
    const parsed = updateQuestionnaireRunSchema.parse(input ?? {});
    return runInTransaction(() => {
        const run = getRunRow(runId);
        if (!run) {
            throw createHttpError({
                statusCode: 404,
                code: "questionnaire_run_not_found",
                message: "Questionnaire run not found."
            });
        }
        if (run.status !== "draft") {
            throw createHttpError({
                statusCode: 409,
                code: "questionnaire_run_locked",
                message: "Only draft questionnaire runs can be updated."
            });
        }
        upsertRunAnswers(runId, parsed.answers);
        getDatabase()
            .prepare(`
          UPDATE questionnaire_runs
          SET progress_index = ?, updated_at = ?
          WHERE id = ?
        `)
            .run(parsed.progressIndex ?? run.progress_index, nowIso(), runId);
        return getQuestionnaireRunDetail(runId);
    });
}
export function completeQuestionnaireRun(runId, context) {
    return runInTransaction(() => {
        const run = getRunRow(runId);
        if (!run) {
            throw createHttpError({
                statusCode: 404,
                code: "questionnaire_run_not_found",
                message: "Questionnaire run not found."
            });
        }
        if (run.status !== "draft") {
            return getQuestionnaireRunDetail(runId);
        }
        const versionRow = getVersionRow(run.version_id);
        if (!versionRow) {
            throw createHttpError({
                statusCode: 404,
                code: "questionnaire_version_missing",
                message: "Questionnaire version not found."
            });
        }
        const version = mapVersion(versionRow);
        const answers = listAnswerRows(runId);
        const visibility = getQuestionnaireVisibilityState(version.definition, answers);
        const answerIds = new Set(answers
            .filter((entry) => visibility.visibleItemIds.has(entry.item_id))
            .map((entry) => entry.item_id));
        const missingRequired = version.definition.items
            .filter((entry) => visibility.visibleItemIds.has(entry.id))
            .filter((entry) => entry.required)
            .filter((entry) => !answerIds.has(entry.id))
            .map((entry) => entry.prompt);
        if (missingRequired.length > 0) {
            throw createHttpError({
                statusCode: 400,
                code: "questionnaire_missing_answers",
                message: "Complete all required questionnaire items before finishing the run.",
                details: {
                    missingItems: missingRequired
                }
            });
        }
        const scored = scoreRun(version, answers);
        getDatabase()
            .prepare("DELETE FROM questionnaire_run_scores WHERE run_id = ?")
            .run(runId);
        const now = nowIso();
        const insertScore = getDatabase().prepare(`
        INSERT INTO questionnaire_run_scores (
          id,
          run_id,
          score_key,
          label,
          value_numeric,
          value_text,
          band_label,
          severity,
          sort_order,
          details_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
        for (const score of scored) {
            insertScore.run(buildId("questionnaire_score"), runId, score.scoreKey, score.label, score.valueNumeric, score.valueText, score.bandLabel, score.severity, score.sortOrder, JSON.stringify(score.details), now);
        }
        getDatabase()
            .prepare(`
          UPDATE questionnaire_runs
          SET status = 'completed', completed_at = ?, updated_at = ?
          WHERE id = ?
        `)
            .run(now, now, runId);
        const instrument = getInstrumentRow(run.instrument_id);
        if (instrument) {
            const contentMarkdown = buildCompletionNoteContent({
                instrument,
                version,
                answers,
                scores: scored,
                completedAt: now
            });
            const primaryScore = scored.find((entry) => entry.valueNumeric !== null || entry.valueText !== null);
            createNote({
                kind: "evidence",
                title: `${instrument.title} self observation`,
                aliases: [],
                indexOrder: 0,
                summary: primaryScore !== undefined
                    ? `${primaryScore.label}: ${formatScoreForNote(primaryScore)}`
                    : `${instrument.title} completed`,
                contentMarkdown,
                author: context.actor ?? "Questionnaire",
                links: [],
                tags: [SELF_OBSERVATION_TAG],
                destroyAt: null,
                sourcePath: "",
                frontmatter: {
                    observedAt: now,
                    questionnaireInstrumentId: instrument.id,
                    questionnaireRunId: runId,
                    questionnaireVersionId: run.version_id
                },
                revisionHash: "",
                userId: run.user_id
            }, context);
        }
        recordActivityEvent({
            entityType: "questionnaire_run",
            entityId: runId,
            eventType: "questionnaire_run_completed",
            title: `Questionnaire completed: ${instrument?.title ?? run.instrument_id}`,
            description: "A questionnaire run was completed and scored.",
            actor: context.actor ?? null,
            source: context.source,
            metadata: {
                instrumentId: run.instrument_id,
                versionId: run.version_id,
                scoreCount: scored.length
            }
        });
        return getQuestionnaireRunDetail(runId);
    });
}
export function getQuestionnaireRunDetail(runId, options = {}) {
    const run = getRunRow(runId);
    if (!run) {
        throw createHttpError({
            statusCode: 404,
            code: "questionnaire_run_not_found",
            message: "Questionnaire run not found."
        });
    }
    if (options.userIds &&
        options.userIds.length > 0 &&
        run.user_id &&
        !options.userIds.includes(run.user_id)) {
        throw createHttpError({
            statusCode: 404,
            code: "questionnaire_run_not_found",
            message: "Questionnaire run not found."
        });
    }
    const instrumentRow = getInstrumentRow(run.instrument_id);
    const versionRow = getVersionRow(run.version_id);
    if (!instrumentRow || !versionRow) {
        throw createHttpError({
            statusCode: 404,
            code: "questionnaire_context_missing",
            message: "The questionnaire context for this run is no longer available."
        });
    }
    const versions = getVersionRowsForInstrument(instrumentRow.id).map(mapVersion);
    const instrument = mapSummary(instrumentRow, versions, options.userIds);
    const version = mapVersion(versionRow);
    const answers = listAnswerRows(runId).map((row) => ({
        itemId: row.item_id,
        optionKey: row.option_key,
        valueText: row.value_text,
        numericValue: row.numeric_value,
        answer: parseJson(row.answer_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }));
    const scores = listRunScoreRows(runId).map((row) => questionnaireRunScoreSchema.parse({
        scoreKey: row.score_key,
        label: row.label,
        valueNumeric: row.value_numeric,
        valueText: row.value_text,
        bandLabel: row.band_label,
        severity: row.severity,
        details: parseJson(row.details_json),
        createdAt: row.created_at
    }));
    return questionnaireRunDetailSchema.parse({
        run: mapRun(run),
        instrument,
        version,
        answers,
        scores,
        history: getHistoryForInstrument(run.instrument_id, run.user_id ? [run.user_id] : undefined)
    });
}
