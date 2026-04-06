import { randomUUID } from "node:crypto";
import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import { getQuestionnaireSeeds } from "../questionnaire-seeds.js";
import {
  createQuestionnaireInstrumentSchema,
  publishQuestionnaireVersionSchema,
  questionnaireDefinitionSchema,
  questionnaireInstrumentDetailSchema,
  questionnaireInstrumentSummarySchema,
  questionnaireRunDetailSchema,
  questionnaireRunSchema,
  questionnaireRunScoreSchema,
  questionnaireScoringSchema,
  questionnaireVersionSchema,
  startQuestionnaireRunSchema,
  updateQuestionnaireRunSchema,
  updateQuestionnaireVersionSchema,
  type CreateQuestionnaireInstrumentInput,
  type QuestionnaireDefinition,
  type QuestionnaireInstrumentDetail,
  type QuestionnaireInstrumentSummary,
  type QuestionnaireRun,
  type QuestionnaireRunDetail,
  type QuestionnaireScoreDefinition,
  type QuestionnaireScoreExpression,
  type QuestionnaireScoring,
  type QuestionnaireVersion,
  type UpdateQuestionnaireVersionInput
} from "../questionnaire-types.js";
import { recordActivityEvent } from "./activity-events.js";
import type { ActivitySource } from "../types.js";

type QuestionnaireContext = {
  source: ActivitySource;
  actor?: string | null;
};

type InstrumentRow = {
  id: string;
  key: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  aliases_json: string;
  symptom_domains_json: string;
  tags_json: string;
  source_class: QuestionnaireInstrumentSummary["sourceClass"];
  availability: QuestionnaireInstrumentSummary["availability"];
  is_self_report: number;
  is_system: number;
  status: "active" | "archived";
  owner_user_id: string | null;
  current_draft_version_id: string | null;
  current_published_version_id: string | null;
  created_at: string;
  updated_at: string;
};

type VersionRow = {
  id: string;
  instrument_id: string;
  version_number: number;
  status: QuestionnaireVersion["status"];
  label: string;
  definition_json: string;
  scoring_json: string;
  provenance_json: string;
  is_read_only: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

type RunRow = {
  id: string;
  instrument_id: string;
  version_id: string;
  user_id: string | null;
  status: QuestionnaireRun["status"];
  progress_index: number;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
};

type AnswerRow = {
  item_id: string;
  option_key: string | null;
  value_text: string;
  numeric_value: number | null;
  answer_json: string;
  created_at: string;
  updated_at: string;
};

type RunScoreRow = {
  score_key: string;
  label: string;
  value_numeric: number | null;
  value_text: string | null;
  band_label: string;
  severity: string;
  sort_order: number;
  details_json: string;
  created_at: string;
};

type HistoryRow = {
  run_id: string;
  completed_at: string;
  score_label: string | null;
  score_value: number | null;
  band_label: string | null;
};

const DEFAULT_CUSTOM_USER_ID = "user_operator";

function nowIso() {
  return new Date().toISOString();
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function buildId(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
}

function createHttpError(options: {
  statusCode: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}) {
  return new HttpError(
    options.statusCode,
    options.code,
    options.message,
    options.details
  );
}

function slugify(text: string) {
  const normalized = text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `questionnaire-${randomUUID().slice(0, 8)}`;
}

function normalizeCustomOwner(userId: string | null | undefined) {
  return userId ?? DEFAULT_CUSTOM_USER_ID;
}

function isInstrumentVisible(row: InstrumentRow, userIds?: string[]) {
  if (row.is_system === 1) {
    return true;
  }
  if (!userIds || userIds.length === 0) {
    return true;
  }
  return row.owner_user_id ? userIds.includes(row.owner_user_id) : true;
}

function mapVersion(row: VersionRow): QuestionnaireVersion {
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

function selectPrimaryVersion(
  instrument: InstrumentRow,
  versions: QuestionnaireVersion[]
) {
  if (instrument.current_published_version_id) {
    return (
      versions.find((version) => version.id === instrument.current_published_version_id) ??
      null
    );
  }
  if (instrument.current_draft_version_id) {
    return (
      versions.find((version) => version.id === instrument.current_draft_version_id) ?? null
    );
  }
  return versions[0] ?? null;
}

function getHistoryForInstrument(instrumentId: string, userIds?: string[]) {
  const database = getDatabase();
  const rows = database
    .prepare(
      `
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
      `
    )
    .all(instrumentId, ...(userIds?.map((entry) => entry ?? "") ?? [])) as HistoryRow[];

  return rows.map((row) => ({
    runId: row.run_id,
    completedAt: row.completed_at,
    primaryScore: row.score_value,
    primaryScoreLabel: row.score_label ?? "",
    bandLabel: row.band_label ?? ""
  }));
}

function getLatestDraftRunId(
  instrumentId: string,
  versionId: string | null,
  userIds?: string[]
) {
  if (!versionId) {
    return null;
  }
  const database = getDatabase();
  const row = database
    .prepare(
      `
        SELECT id
        FROM questionnaire_runs
        WHERE instrument_id = ?
          AND version_id = ?
          AND status = 'draft'
          ${userIds && userIds.length > 0 ? `AND COALESCE(user_id, '') IN (${userIds.map(() => "?").join(",")})` : ""}
        ORDER BY updated_at DESC
        LIMIT 1
      `
    )
    .get(instrumentId, versionId, ...(userIds?.map((entry) => entry ?? "") ?? [])) as
    | { id: string }
    | undefined;
  return row?.id ?? null;
}

function getSummaryStats(instrumentId: string, userIds?: string[]) {
  const database = getDatabase();
  const completedRow = database
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM questionnaire_runs
        WHERE instrument_id = ?
          AND status = 'completed'
          ${userIds && userIds.length > 0 ? `AND COALESCE(user_id, '') IN (${userIds.map(() => "?").join(",")})` : ""}
      `
    )
    .get(instrumentId, ...(userIds?.map((entry) => entry ?? "") ?? [])) as { count: number };
  const latestRow = database
    .prepare(
      `
        SELECT id, completed_at
        FROM questionnaire_runs
        WHERE instrument_id = ?
          AND status = 'completed'
          ${userIds && userIds.length > 0 ? `AND COALESCE(user_id, '') IN (${userIds.map(() => "?").join(",")})` : ""}
        ORDER BY completed_at DESC
        LIMIT 1
      `
    )
    .get(instrumentId, ...(userIds?.map((entry) => entry ?? "") ?? [])) as
    | { id: string; completed_at: string }
    | undefined;

  return {
    completedRunCount: completedRow.count,
    latestRunId: latestRow?.id ?? null,
    latestRunAt: latestRow?.completed_at ?? null
  };
}

function mapSummary(row: InstrumentRow, versions: QuestionnaireVersion[], userIds?: string[]) {
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
    aliases: parseJson<string[]>(row.aliases_json),
    symptomDomains: parseJson<string[]>(row.symptom_domains_json),
    tags: parseJson<string[]>(row.tags_json),
    sourceClass: row.source_class,
    availability: row.availability,
    responseStyle: currentVersion?.definition.responseStyle ?? "unknown",
    presentationMode:
      currentVersion?.definition.presentationMode ?? "single_question",
    itemCount: currentVersion?.definition.items.length ?? 0,
    isSelfReport: row.is_self_report === 1,
    isSystem: row.is_system === 1,
    isReadOnly:
      row.is_system === 1 || currentVersion?.status !== "draft",
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

function getVersionRowsForInstrument(instrumentId: string) {
  return getDatabase()
    .prepare(
      `
        SELECT *
        FROM questionnaire_versions
        WHERE instrument_id = ?
        ORDER BY version_number DESC
      `
    )
    .all(instrumentId) as VersionRow[];
}

function getInstrumentRow(id: string) {
  return getDatabase()
    .prepare("SELECT * FROM questionnaire_instruments WHERE id = ?")
    .get(id) as InstrumentRow | undefined;
}

function getVersionRow(id: string) {
  return getDatabase()
    .prepare("SELECT * FROM questionnaire_versions WHERE id = ?")
    .get(id) as VersionRow | undefined;
}

function getRunRow(id: string) {
  return getDatabase()
    .prepare("SELECT * FROM questionnaire_runs WHERE id = ?")
    .get(id) as RunRow | undefined;
}

function getCurrentPublishedOrDraftVersion(instrument: InstrumentRow) {
  const versionId =
    instrument.current_published_version_id ?? instrument.current_draft_version_id;
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

function coerceNumber(value: number | string | boolean | null): number | null {
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

function compare(
  left: number | null,
  comparator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte",
  right: number | null
) {
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

function evaluateExpression(
  expression: QuestionnaireScoreExpression,
  answerMap: Map<string, number | null>,
  scoreMap: Map<string, number | string | boolean | null>
): number | string | boolean | null {
  switch (expression.kind) {
    case "const":
      return expression.value;
    case "answer":
      return answerMap.get(expression.itemId) ?? expression.defaultValue ?? null;
    case "score":
      return scoreMap.get(expression.scoreKey) ?? null;
    case "add": {
      const numbers = expression.values.map((value) =>
        coerceNumber(evaluateExpression(value, answerMap, scoreMap))
      );
      if (numbers.some((value) => value === null)) {
        return null;
      }
      const present = numbers.filter((value): value is number => value !== null);
      return present.reduce((sum, value) => sum + value, 0);
    }
    case "multiply": {
      const numbers = expression.values.map((value) =>
        coerceNumber(evaluateExpression(value, answerMap, scoreMap))
      );
      if (numbers.some((value) => value === null)) {
        return null;
      }
      const present = numbers.filter((value): value is number => value !== null);
      return present.reduce((product, value) => product * value, 1);
    }
    case "min": {
      const numbers = expression.values
        .map((value) => coerceNumber(evaluateExpression(value, answerMap, scoreMap)))
        .filter((value): value is number => value !== null);
      return numbers.length > 0 ? Math.min(...numbers) : null;
    }
    case "max": {
      const numbers = expression.values
        .map((value) => coerceNumber(evaluateExpression(value, answerMap, scoreMap)))
        .filter((value): value is number => value !== null);
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
        .filter((value): value is number => value !== null && value !== undefined);
      return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
    }
    case "average": {
      const values = expression.itemIds
        .map((itemId) => answerMap.get(itemId))
        .filter((value): value is number => value !== null && value !== undefined);
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
      const present = values.filter((value): value is number => value !== null);
      return present.reduce((sum, value) => sum + value, 0);
    }
    case "count_if": {
      const values = expression.itemIds
        .map((itemId) => answerMap.get(itemId))
        .filter((value): value is number => value !== null && value !== undefined);
      return values.filter((value) => compare(value, expression.comparator, expression.target)).length;
    }
    case "filtered_mean": {
      const values = expression.itemIds
        .map((itemId) => answerMap.get(itemId))
        .filter((value): value is number => value !== null && value !== undefined)
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

function collectDependentItemIds(expression: QuestionnaireScoreExpression): string[] {
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

function resolveMissingPolicy(
  definition: QuestionnaireScoreDefinition,
  answerMap: Map<string, number | null>
) {
  const policy = definition.missingPolicy ?? { mode: "require_all" as const };
  const itemIds = definition.dependsOnItemIds.length > 0
    ? definition.dependsOnItemIds
    : Array.from(new Set(collectDependentItemIds(definition.expression)));

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

function resolveBand(
  definition: QuestionnaireScoreDefinition,
  value: number | string | boolean | null
) {
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

function scoreRun(version: QuestionnaireVersion, answers: AnswerRow[]) {
  const answerMap = new Map<string, number | null>();
  for (const item of version.definition.items) {
    answerMap.set(item.id, null);
  }
  for (const answer of answers) {
    answerMap.set(answer.item_id, answer.numeric_value);
  }

  const scoreValueMap = new Map<string, number | string | boolean | null>();

  return version.scoring.scores.map((definition, index) => {
    const blockedByMissing = resolveMissingPolicy(definition, answerMap);
    let value: number | string | boolean | null = blockedByMissing
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
      valueText:
        typeof value === "string"
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
        dependsOnItemIds:
          definition.dependsOnItemIds.length > 0
            ? definition.dependsOnItemIds
            : Array.from(new Set(collectDependentItemIds(definition.expression)))
      }
    };
  });
}

function hydrateInstrumentDetail(row: InstrumentRow, userIds?: string[]): QuestionnaireInstrumentDetail {
  const versions = getVersionRowsForInstrument(row.id).map(mapVersion);
  const currentVersion = selectPrimaryVersion(row, versions);
  const draftVersion =
    row.current_draft_version_id
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

function assertEditableInstrument(row: InstrumentRow) {
  if (row.is_system === 1) {
    throw createHttpError({
      statusCode: 403,
      code: "questionnaire_read_only",
      message: "System questionnaire definitions cannot be edited directly."
    });
  }
}

function insertVersion(options: {
  id: string;
  instrumentId: string;
  versionNumber: number;
  status: QuestionnaireVersion["status"];
  label: string;
  definition: QuestionnaireDefinition;
  scoring: QuestionnaireScoring;
  provenance: unknown;
  isReadOnly: boolean;
  createdBy: string | null;
  publishedAt?: string | null;
}) {
  getDatabase()
    .prepare(
      `
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
      `
    )
    .run(
      options.id,
      options.instrumentId,
      options.versionNumber,
      options.status,
      options.label,
      JSON.stringify(options.definition),
      JSON.stringify(options.scoring),
      JSON.stringify(options.provenance),
      options.isReadOnly ? 1 : 0,
      options.createdBy,
      nowIso(),
      nowIso(),
      options.publishedAt ?? null
    );
}

export function ensureQuestionnaireSeeds() {
  const database = getDatabase();
  const hasTables = database
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = 'questionnaire_instruments'
      `
    )
    .get() as { name: string } | undefined;

  if (!hasTables) {
    return;
  }

  runInTransaction(() => {
    for (const seed of getQuestionnaireSeeds()) {
      const existing = database
        .prepare("SELECT id FROM questionnaire_instruments WHERE key = ?")
        .get(seed.key) as { id: string } | undefined;

      if (existing) {
        continue;
      }

      const now = nowIso();
      const instrumentId = `questionnaire_${seed.key}`;
      const versionId = `questionnaire_version_${seed.key}_v1`;
      database
        .prepare(
          `
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
          `
        )
        .run(
          instrumentId,
          seed.key,
          seed.slug,
          seed.title,
          seed.subtitle,
          seed.description,
          JSON.stringify(seed.aliases),
          JSON.stringify(seed.symptomDomains),
          JSON.stringify(seed.tags),
          seed.sourceClass,
          seed.availability,
          seed.isSelfReport ? 1 : 0,
          1,
          versionId,
          now,
          now
        );

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

export function listQuestionnaireInstruments(options: { userIds?: string[] } = {}) {
  const rows = getDatabase()
    .prepare(
      `
        SELECT *
        FROM questionnaire_instruments
        WHERE status != 'archived'
        ORDER BY is_system DESC, title COLLATE NOCASE ASC
      `
    )
    .all() as InstrumentRow[];

  const instruments = rows
    .filter((row) => isInstrumentVisible(row, options.userIds))
    .map((row) =>
      mapSummary(
        row,
        getVersionRowsForInstrument(row.id).map(mapVersion),
        options.userIds
      )
    );

  return { instruments };
}

export function getQuestionnaireInstrumentDetail(
  instrumentId: string,
  options: { userIds?: string[] } = {}
) {
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

export function createQuestionnaireInstrument(
  input: CreateQuestionnaireInstrumentInput,
  context: QuestionnaireContext
) {
  const parsed = createQuestionnaireInstrumentSchema.parse(input);
  return runInTransaction(() => {
    const database = getDatabase();
    const now = nowIso();
    const instrumentId = buildId("questionnaire");
    const versionId = buildId("questionnaire_version");
    const slugBase = slugify(parsed.title);
    const slug = `${slugBase}-${instrumentId.slice(-4)}`;

    database
      .prepare(
        `
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
        `
      )
      .run(
        instrumentId,
        slug.replaceAll("-", "_"),
        slug,
        parsed.title,
        parsed.subtitle,
        parsed.description,
        JSON.stringify(parsed.aliases),
        JSON.stringify(parsed.symptomDomains),
        JSON.stringify(parsed.tags),
        parsed.sourceClass,
        parsed.availability,
        parsed.isSelfReport ? 1 : 0,
        normalizeCustomOwner(parsed.userId),
        versionId,
        now,
        now
      );

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

export function cloneQuestionnaireInstrument(
  instrumentId: string,
  options: { userId?: string | null },
  context: QuestionnaireContext
) {
  const row = getInstrumentRow(instrumentId);
  if (!row) {
    throw createHttpError({
      statusCode: 404,
      code: "questionnaire_not_found",
      message: "Questionnaire instrument not found."
    });
  }
  const sourceVersion = getCurrentPublishedOrDraftVersion(row);
  return createQuestionnaireInstrument(
    {
      title: `${row.title} copy`,
      subtitle: row.subtitle,
      description: row.description,
      aliases: parseJson<string[]>(row.aliases_json),
      symptomDomains: parseJson<string[]>(row.symptom_domains_json),
      tags: Array.from(new Set([...parseJson<string[]>(row.tags_json), "custom-copy"])),
      sourceClass: row.source_class,
      availability: "custom",
      isSelfReport: row.is_self_report === 1,
      userId: options.userId ?? row.owner_user_id ?? DEFAULT_CUSTOM_USER_ID,
      versionLabel: `Draft from ${row.title}`,
      definition: sourceVersion.definition,
      scoring: sourceVersion.scoring,
      provenance: sourceVersion.provenance
    },
    context
  );
}

export function ensureQuestionnaireDraftVersion(
  instrumentId: string,
  context: QuestionnaireContext
) {
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
    const nextVersionNumber =
      Math.max(
        0,
        ...getVersionRowsForInstrument(instrumentId).map((entry) => entry.version_number)
      ) + 1;
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
      .prepare(
        `
          UPDATE questionnaire_instruments
          SET current_draft_version_id = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(versionId, nowIso(), instrumentId);

    return getQuestionnaireInstrumentDetail(instrumentId);
  });
}

export function updateQuestionnaireDraftVersion(
  instrumentId: string,
  input: UpdateQuestionnaireVersionInput,
  context: QuestionnaireContext
) {
  const parsed = updateQuestionnaireVersionSchema.parse(input);
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
      .prepare(
        `
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
        `
      )
      .run(
        parsed.title,
        parsed.subtitle,
        parsed.description,
        JSON.stringify(parsed.aliases),
        JSON.stringify(parsed.symptomDomains),
        JSON.stringify(parsed.tags),
        parsed.sourceClass,
        parsed.availability,
        parsed.isSelfReport ? 1 : 0,
        nowIso(),
        instrumentId
      );

    getDatabase()
      .prepare(
        `
          UPDATE questionnaire_versions
          SET
            label = ?,
            definition_json = ?,
            scoring_json = ?,
            provenance_json = ?,
            updated_at = ?
          WHERE id = ?
            AND status = 'draft'
        `
      )
      .run(
        parsed.label,
        JSON.stringify(parsed.definition),
        JSON.stringify(parsed.scoring),
        JSON.stringify(parsed.provenance),
        nowIso(),
        draftVersionId
      );

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

export function publishQuestionnaireDraftVersion(
  instrumentId: string,
  input: unknown,
  context: QuestionnaireContext
) {
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
      .prepare(
        `
          UPDATE questionnaire_versions
          SET status = 'published', label = ?, published_at = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(parsed.label || "Published", publishedAt, publishedAt, draftVersionId);
    getDatabase()
      .prepare(
        `
          UPDATE questionnaire_instruments
          SET
            current_published_version_id = ?,
            current_draft_version_id = NULL,
            updated_at = ?
          WHERE id = ?
        `
      )
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

function upsertRunAnswers(runId: string, answers: Array<ReturnType<typeof updateQuestionnaireRunSchema.parse>["answers"][number]>) {
  const database = getDatabase();
  const now = nowIso();
  const statement = database.prepare(
    `
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
    `
  );

  for (const answer of answers) {
    statement.run(
      buildId("questionnaire_answer"),
      runId,
      answer.itemId,
      answer.optionKey ?? null,
      answer.valueText,
      answer.numericValue ?? null,
      JSON.stringify(answer.answer),
      now,
      now
    );
  }
}

function listAnswerRows(runId: string) {
  return getDatabase()
    .prepare(
      `
        SELECT item_id, option_key, value_text, numeric_value, answer_json, created_at, updated_at
        FROM questionnaire_answers
        WHERE run_id = ?
        ORDER BY item_id
      `
    )
    .all(runId) as AnswerRow[];
}

function listRunScoreRows(runId: string) {
  return getDatabase()
    .prepare(
      `
        SELECT score_key, label, value_numeric, value_text, band_label, severity, sort_order, details_json, created_at
        FROM questionnaire_run_scores
        WHERE run_id = ?
        ORDER BY sort_order ASC, score_key ASC
      `
    )
    .all(runId) as RunScoreRow[];
}

function mapRun(row: RunRow) {
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

export function startQuestionnaireRun(
  instrumentId: string,
  input: unknown,
  context: QuestionnaireContext
) {
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
    const versionId =
      parsed.versionId ??
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
      .prepare(
        `
          SELECT *
          FROM questionnaire_runs
          WHERE instrument_id = ?
            AND version_id = ?
            AND COALESCE(user_id, '') = ?
            AND status = 'draft'
          ORDER BY updated_at DESC
          LIMIT 1
        `
      )
      .get(instrumentId, versionId, userId) as RunRow | undefined;

    if (existing) {
      return getQuestionnaireRunDetail(existing.id);
    }

    const now = nowIso();
    const runId = buildId("questionnaire_run");
    getDatabase()
      .prepare(
        `
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
        `
      )
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

export function updateQuestionnaireRun(
  runId: string,
  input: unknown,
  context: QuestionnaireContext
) {
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
      .prepare(
        `
          UPDATE questionnaire_runs
          SET progress_index = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(parsed.progressIndex ?? run.progress_index, nowIso(), runId);

    return getQuestionnaireRunDetail(runId);
  });
}

export function completeQuestionnaireRun(runId: string, context: QuestionnaireContext) {
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
    const answerIds = new Set(answers.map((entry) => entry.item_id));
    const missingRequired = version.definition.items
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
    const insertScore = getDatabase().prepare(
      `
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
      `
    );
    for (const score of scored) {
      insertScore.run(
        buildId("questionnaire_score"),
        runId,
        score.scoreKey,
        score.label,
        score.valueNumeric,
        score.valueText,
        score.bandLabel,
        score.severity,
        score.sortOrder,
        JSON.stringify(score.details),
        now
      );
    }

    getDatabase()
      .prepare(
        `
          UPDATE questionnaire_runs
          SET status = 'completed', completed_at = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(now, now, runId);

    const instrument = getInstrumentRow(run.instrument_id);
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

export function getQuestionnaireRunDetail(
  runId: string,
  options: { userIds?: string[] } = {}
) {
  const run = getRunRow(runId);
  if (!run) {
    throw createHttpError({
      statusCode: 404,
      code: "questionnaire_run_not_found",
      message: "Questionnaire run not found."
    });
  }
  if (
    options.userIds &&
    options.userIds.length > 0 &&
    run.user_id &&
    !options.userIds.includes(run.user_id)
  ) {
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
    answer: parseJson<Record<string, unknown>>(row.answer_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
  const scores = listRunScoreRows(runId).map((row) =>
    questionnaireRunScoreSchema.parse({
      scoreKey: row.score_key,
      label: row.label,
      valueNumeric: row.value_numeric,
      valueText: row.value_text,
      bandLabel: row.band_label,
      severity: row.severity,
      details: parseJson<Record<string, unknown>>(row.details_json),
      createdAt: row.created_at
    })
  );

  return questionnaireRunDetailSchema.parse({
    run: mapRun(run),
    instrument,
    version,
    answers,
    scores,
    history: getHistoryForInstrument(run.instrument_id, run.user_id ? [run.user_id] : undefined)
  });
}
