import { createHash } from "node:crypto";
import { getDatabase } from "../db.js";
import { HttpError } from "../errors.js";
import { getVitalsViewData } from "../health.js";
import {
  listNotesPage,
  type NoteReadScope,
  type NotesPage
} from "../repositories/notes.js";
import type { Note } from "../types.js";
import {
  COMPARISON_FAMILIES,
  type ComparisonAlignment,
  type ComparisonCatalogItem,
  type ComparisonCatalogQuery,
  type ComparisonCatalogResponse,
  type ComparisonFamily,
  type ComparisonLane,
  type ComparisonPoint,
  type ComparisonQuery,
  type ComparisonResponse
} from "../comparison-types.js";
import { getPsycheMetricsViewData } from "./devrage.js";

const CATALOG_DEFAULT_LIMIT = 40;
const CATALOG_MAX_OFFSET = 10_000;
const COMPARISON_MAX_POINTS = 3_000;
const MILLISECONDS_PER_DAY = 86_400_000;
const EVIDENCE_REFERENCES_PER_POINT = 12;
const CURRENT_ONLY_LIMITATION =
  "Forge stores only the current record here. This event shows the current record at its stored update time; Forge does not reconstruct earlier value or content.";
const UNAVAILABLE_LIMITATION =
  "This selection is unavailable or your current access does not include it.";

type RawQuery = Record<string, unknown>;

type CatalogReader = {
  family: ComparisonFamily;
  total: number;
  page: (offset: number, limit: number) => ComparisonCatalogItem[];
};

type PreferenceCatalogRow = {
  item_id: string;
  item_label: string;
  item_description: string;
  context_id: string;
  context_name: string;
  user_id: string;
};

type PreferenceLaneRow = PreferenceCatalogRow & {
  profile_id: string;
  score_id: string | null;
  latent_score: number | null;
  score_updated_at: string | null;
};

type PreferenceSnapshotRow = {
  id: string;
  serialized_model_state_json: string;
  created_at: string;
};

type InsightCatalogRow = {
  id: string;
  title: string;
  summary: string;
  updated_at: string;
  evidence_json: string;
};

function requestError(code: string, message: string): never {
  throw new HttpError(400, code, message);
}

function assertOnlyQueryKeys(raw: RawQuery, allowed: readonly string[]) {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(raw).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) {
    requestError(
      "comparison_query_invalid",
      `Unsupported comparison query parameter: ${unexpected[0]}.`
    );
  }
}

function queryValues(raw: unknown, name: string): string[] {
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  if (values.some((value) => typeof value !== "string")) {
    requestError(
      "comparison_query_invalid",
      `${name} must be supplied as a text query parameter.`
    );
  }
  return (values as string[]).map((value) => value.trim());
}

function singleQueryValue(
  raw: unknown,
  name: string,
  options: { required?: boolean; maximumLength?: number } = {}
) {
  const values = queryValues(raw, name);
  if (values.length > 1) {
    requestError(
      "comparison_query_invalid",
      `${name} must be supplied exactly once.`
    );
  }
  const value = values[0] ?? "";
  if ((options.required || values.length > 0) && value.length === 0) {
    requestError("comparison_query_invalid", `${name} must not be empty.`);
  }
  if (value.length > (options.maximumLength ?? 512)) {
    requestError(
      "comparison_query_invalid",
      `${name} is longer than the supported limit.`
    );
  }
  return value;
}

function parseUserId(raw: unknown) {
  const userId = singleQueryValue(raw, "userId", {
    required: true,
    maximumLength: 160
  });
  if (/\p{C}/u.test(userId)) {
    requestError(
      "comparison_query_invalid",
      "userId contains unsupported control characters."
    );
  }
  return userId;
}

function parsePositiveInteger(raw: unknown, name: string, fallback: number) {
  if (raw === undefined) return fallback;
  const value = singleQueryValue(raw, name, { required: true });
  if (!/^\d+$/.test(value)) {
    requestError("comparison_query_invalid", `${name} must be an integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    requestError(
      "comparison_query_invalid",
      `${name} must be between 1 and 100.`
    );
  }
  return parsed;
}

function isDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day
  );
}

function dayNumber(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day) / MILLISECONDS_PER_DAY;
}

function dateKeys(from: string, to: string) {
  const first = dayNumber(from);
  const last = dayNumber(to);
  const keys: string[] = [];
  for (let current = first; current <= last; current += 1) {
    keys.push(new Date(current * 86_400_000).toISOString().slice(0, 10));
  }
  return keys;
}

function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

function dateKeyInTimeZone(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function dateKeyAfter(value: string) {
  return new Date((dayNumber(value) + 1) * MILLISECONDS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

function firstInstantAtOrAfterDate(dateKey: string, timeZone: string) {
  const target = dayNumber(dateKey) * MILLISECONDS_PER_DAY;
  let lower = target - 3 * MILLISECONDS_PER_DAY;
  let upper = target + 3 * MILLISECONDS_PER_DAY;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    const middleDateKey = dateKeyInTimeZone(
      new Date(middle).toISOString(),
      timeZone
    );
    if (middleDateKey && middleDateKey >= dateKey) upper = middle;
    else lower = middle + 1;
  }
  return new Date(lower).toISOString();
}

function parseFamily(raw: unknown): ComparisonFamily | null {
  if (raw === undefined) return null;
  const family = singleQueryValue(raw, "family", {
    required: true,
    maximumLength: 32
  });
  if (!COMPARISON_FAMILIES.includes(family as ComparisonFamily)) {
    requestError(
      "comparison_query_invalid",
      `family must be one of: ${COMPARISON_FAMILIES.join(", ")}.`
    );
  }
  return family as ComparisonFamily;
}

export function parseComparisonCatalogQuery(raw: RawQuery) {
  assertOnlyQueryKeys(raw, ["userId", "query", "family", "limit", "cursor"]);
  return {
    userId: parseUserId(raw.userId),
    query:
      raw.query === undefined
        ? ""
        : singleQueryValue(raw.query, "query", { maximumLength: 160 }),
    family: parseFamily(raw.family),
    limit: parsePositiveInteger(raw.limit, "limit", CATALOG_DEFAULT_LIMIT),
    cursor:
      raw.cursor === undefined
        ? null
        : singleQueryValue(raw.cursor, "cursor", {
            required: true,
            maximumLength: 1_024
          })
  } satisfies ComparisonCatalogQuery;
}

function parseSelector(selector: string) {
  if (selector.length > 512 || /\p{C}/u.test(selector)) {
    requestError(
      "comparison_selection_invalid",
      "Each selection must be a supported, bounded selector."
    );
  }
  const parts = selector.split(":");
  const family = parts[0] as ComparisonFamily;
  const expectedParts = family === "preference" ? 3 : 2;
  if (
    !COMPARISON_FAMILIES.includes(family) ||
    parts.length !== expectedParts ||
    parts.some((part) => part.length === 0 || part.length > 240)
  ) {
    requestError(
      "comparison_selection_invalid",
      "A selection must use one supported selector: preference:itemId:contextId, health:metric, psyche:metric, insight:id, note:id, or wiki:id."
    );
  }
  return { family, parts };
}

export function parseComparisonQuery(raw: RawQuery) {
  assertOnlyQueryKeys(raw, [
    "userId",
    "selection",
    "from",
    "to",
    "timeZone",
    "alignment"
  ]);
  const selections = queryValues(raw.selection, "selection");
  if (selections.length < 1 || selections.length > 8) {
    requestError(
      "comparison_selection_invalid",
      "Supply between 1 and 8 selections."
    );
  }
  if (selections.some((selection) => selection.length === 0)) {
    requestError(
      "comparison_selection_invalid",
      "Selections must not be empty."
    );
  }
  if (new Set(selections).size !== selections.length) {
    requestError(
      "comparison_selection_invalid",
      "Each selection must be unique."
    );
  }
  selections.forEach(parseSelector);

  const from = singleQueryValue(raw.from, "from", {
    required: true,
    maximumLength: 10
  });
  const to = singleQueryValue(raw.to, "to", {
    required: true,
    maximumLength: 10
  });
  if (!isDateOnly(from) || !isDateOnly(to)) {
    requestError(
      "comparison_date_range_invalid",
      "from and to must be valid ISO dates in YYYY-MM-DD form."
    );
  }
  const inclusiveDays = dayNumber(to) - dayNumber(from) + 1;
  if (inclusiveDays < 1 || inclusiveDays > 366) {
    requestError(
      "comparison_date_range_invalid",
      "The inclusive comparison range must contain between 1 and 366 days."
    );
  }
  const timeZone = singleQueryValue(raw.timeZone, "timeZone", {
    required: true,
    maximumLength: 100
  });
  if (!isValidTimeZone(timeZone)) {
    requestError(
      "comparison_time_zone_invalid",
      "timeZone must be a valid IANA time zone."
    );
  }
  const rawAlignment =
    raw.alignment === undefined
      ? "separate_tracks"
      : singleQueryValue(raw.alignment, "alignment", {
          required: true,
          maximumLength: 32
        });
  if (
    !(["separate_tracks", "shared_axis"] as const).includes(
      rawAlignment as ComparisonAlignment
    )
  ) {
    requestError(
      "comparison_alignment_invalid",
      "alignment must be separate_tracks or shared_axis."
    );
  }

  return {
    userId: parseUserId(raw.userId),
    selections,
    from,
    to,
    timeZone,
    alignment: rawAlignment as ComparisonAlignment
  } satisfies ComparisonQuery;
}

export function comparisonScopeUnavailable(): never {
  throw new HttpError(
    404,
    "comparison_scope_unavailable",
    "The requested comparison scope is unavailable."
  );
}

function escapeSqlLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function catalogScopeKey(query: ComparisonCatalogQuery) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        userId: query.userId,
        query: query.query.normalize("NFKC"),
        family: query.family
      })
    )
    .digest("base64url");
}

function encodeCatalogCursor(offset: number, scope: string) {
  return Buffer.from(JSON.stringify({ version: 1, offset, scope })).toString(
    "base64url"
  );
}

function decodeCatalogCursor(cursor: string | null, scope: string) {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    ) as { version?: unknown; offset?: unknown; scope?: unknown };
    if (
      parsed.version !== 1 ||
      parsed.scope !== scope ||
      !Number.isSafeInteger(parsed.offset) ||
      (parsed.offset as number) < 0 ||
      (parsed.offset as number) > CATALOG_MAX_OFFSET
    ) {
      throw new Error("invalid cursor");
    }
    return parsed.offset as number;
  } catch {
    requestError(
      "comparison_catalog_cursor_invalid",
      "The catalog cursor is invalid for this user and filter."
    );
  }
}

function preferenceSourceHref(
  userId: string,
  itemId: string,
  contextId: string
) {
  const params = new URLSearchParams({
    tab: "table",
    userId,
    contextId,
    focusItem: itemId
  });
  return `/preferences?${params.toString()}`;
}

function preferenceCatalogReader(userId: string, query: string): CatalogReader {
  const normalizedQuery = query.normalize("NFKC").toLowerCase();
  const where = [
    "preference_profiles.user_id = ?",
    "preference_contexts.active = 1"
  ];
  const parameters: Array<string | number> = [userId];
  if (normalizedQuery) {
    const like = `%${escapeSqlLike(normalizedQuery)}%`;
    where.push(`(
      forge_nfkc_lower(preference_items.label) LIKE ? ESCAPE '\\'
      OR forge_nfkc_lower(preference_items.description) LIKE ? ESCAPE '\\'
      OR forge_nfkc_lower(preference_contexts.name) LIKE ? ESCAPE '\\'
      OR forge_nfkc_lower(preference_contexts.description) LIKE ? ESCAPE '\\'
    )`);
    parameters.push(like, like, like, like);
  }
  const fromSql = `FROM preference_items
    INNER JOIN preference_profiles
      ON preference_profiles.id = preference_items.profile_id
    INNER JOIN preference_contexts
      ON preference_contexts.profile_id = preference_profiles.id
    WHERE ${where.join(" AND ")}`;
  const count = getDatabase()
    .prepare(`SELECT COUNT(*) AS count ${fromSql}`)
    .get(...parameters) as { count: number };
  return {
    family: "preference",
    total: Number(count.count) || 0,
    page(offset, limit) {
      const rows = getDatabase()
        .prepare(
          `SELECT preference_items.id AS item_id,
                  preference_items.label AS item_label,
                  preference_items.description AS item_description,
                  preference_contexts.id AS context_id,
                  preference_contexts.name AS context_name,
                  preference_profiles.user_id AS user_id
           ${fromSql}
           ORDER BY preference_items.updated_at DESC,
                    preference_items.id ASC,
                    preference_contexts.is_default DESC,
                    preference_contexts.name ASC,
                    preference_contexts.id ASC
           LIMIT ? OFFSET ?`
        )
        .all(...parameters, limit, offset) as PreferenceCatalogRow[];
      return rows.map((row) => ({
        selector: `preference:${row.item_id}:${row.context_id}`,
        family: "preference",
        title: `${row.item_label} — ${row.context_name}`,
        description:
          row.item_description.trim() ||
          `Stored preference score in the ${row.context_name} context. Snapshots keep only their top 12 scores.`,
        valueKind: "number",
        unit: "score",
        availability: "history",
        sourceHref: preferenceSourceHref(
          row.user_id,
          row.item_id,
          row.context_id
        )
      }));
    }
  };
}

function includesQuery(
  item: Pick<ComparisonCatalogItem, "title" | "description">,
  query: string
) {
  if (!query) return true;
  const needle = query.normalize("NFKC").toLocaleLowerCase();
  return `${item.title}\n${item.description}`
    .normalize("NFKC")
    .toLocaleLowerCase()
    .includes(needle);
}

function arrayCatalogReader(
  family: ComparisonFamily,
  items: ComparisonCatalogItem[],
  query: string
): CatalogReader {
  const filtered = items.filter((item) => includesQuery(item, query));
  return {
    family,
    total: filtered.length,
    page: (offset, limit) => filtered.slice(offset, offset + limit)
  };
}

function healthCatalogReader(userId: string, query: string): CatalogReader {
  const view = getVitalsViewData([userId]);
  return arrayCatalogReader(
    "health",
    view.metrics.map((metric) => ({
      selector: `health:${metric.metric}`,
      family: "health" as const,
      title: metric.label,
      description: `Daily ${metric.label.toLocaleLowerCase()} from stored Health aggregates. Missing days remain explicit.`,
      valueKind: "number" as const,
      unit: metric.unit,
      availability: "history" as const,
      sourceHref: "/vitals"
    })),
    query
  );
}

function psycheCatalogReader(
  userId: string,
  query: string,
  canReadPsyche: boolean
): CatalogReader {
  if (!canReadPsyche) return arrayCatalogReader("psyche", [], query);
  const view = getPsycheMetricsViewData({ userIds: [userId] });
  return arrayCatalogReader(
    "psyche",
    view.metrics.map((metric) => ({
      selector: `psyche:${metric.metric}`,
      family: "psyche" as const,
      title: metric.label,
      description: metric.definition.description,
      valueKind: "number" as const,
      unit: metric.unit,
      availability: "history" as const,
      sourceHref: "/psyche"
    })),
    query
  );
}

function insightWhere(userId: string, query: string) {
  const where = [
    "entity_owners.entity_type = 'insight'",
    "entity_owners.role = 'owner'",
    "entity_owners.user_id = ?",
    "insights.visibility = 'visible'",
    `NOT EXISTS (
      SELECT 1 FROM deleted_entities
      WHERE deleted_entities.entity_type = 'insight'
        AND deleted_entities.entity_id = insights.id
    )`
  ];
  const parameters: Array<string | number> = [userId];
  const normalizedQuery = query.normalize("NFKC").toLowerCase();
  if (normalizedQuery) {
    const like = `%${escapeSqlLike(normalizedQuery)}%`;
    where.push(`(
      forge_nfkc_lower(insights.title) LIKE ? ESCAPE '\\'
      OR forge_nfkc_lower(insights.summary) LIKE ? ESCAPE '\\'
    )`);
    parameters.push(like, like);
  }
  return { where: where.join(" AND "), parameters };
}

function insightCatalogReader(userId: string, query: string): CatalogReader {
  const filter = insightWhere(userId, query);
  const count = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM insights
       INNER JOIN entity_owners
         ON entity_owners.entity_id = insights.id
       WHERE ${filter.where}`
    )
    .get(...filter.parameters) as { count: number };
  return {
    family: "insight",
    total: Number(count.count) || 0,
    page(offset, limit) {
      const rows = getDatabase()
        .prepare(
          `SELECT insights.id, insights.title, insights.summary,
                  insights.updated_at, insights.evidence_json
           FROM insights
           INNER JOIN entity_owners
             ON entity_owners.entity_id = insights.id
           WHERE ${filter.where}
           ORDER BY insights.created_at DESC, insights.id DESC
           LIMIT ? OFFSET ?`
        )
        .all(...filter.parameters, limit, offset) as InsightCatalogRow[];
      return rows.map((row) => ({
        selector: `insight:${row.id}`,
        family: "insight",
        title: row.title,
        description: row.summary,
        valueKind: "event",
        unit: null,
        availability: "current_only",
        sourceHref: `/knowledge-graph?focus=${encodeURIComponent(`insight:${row.id}`)}`
      }));
    }
  };
}

function noteSourceHref(note: Note) {
  if (note.kind === "wiki") {
    return `/wiki/page/${encodeURIComponent(note.slug)}?spaceId=${encodeURIComponent(note.spaceId)}`;
  }
  return `/notes?focus=${encodeURIComponent(note.id)}`;
}

function noteCatalogItem(note: Note): ComparisonCatalogItem {
  const family = note.kind === "wiki" ? "wiki" : "note";
  return {
    selector: `${family}:${note.id}`,
    family,
    title: note.title,
    description:
      note.summary.trim() ||
      (family === "wiki"
        ? "A current Wiki page event with its original source."
        : "A current Note event with its original source."),
    valueKind: "event",
    unit: null,
    availability: "current_only",
    sourceHref: noteSourceHref(note)
  };
}

function noteCatalogReader(
  family: "note" | "wiki",
  userId: string,
  query: string,
  noteScope: NoteReadScope,
  initialLimit: number
): CatalogReader {
  const kind = family === "wiki" ? "wiki" : "evidence";
  const readPage = (cursor?: string): NotesPage =>
    listNotesPage(
      {
        kind,
        query: query || undefined,
        userIds: [userId],
        limit: Math.min(Math.max(initialLimit, 1), 100),
        cursor
      },
      noteScope
    );
  const first = readPage();
  return {
    family,
    total: first.total,
    page(offset, limit) {
      if (offset < first.notes.length) {
        const available = first.notes.slice(offset, offset + limit);
        if (available.length === limit || !first.nextCursor) {
          return available.map(noteCatalogItem);
        }
        const collected = [...available];
        let cursor: string | null = first.nextCursor;
        while (cursor && collected.length < limit) {
          const page = readPage(cursor);
          collected.push(...page.notes.slice(0, limit - collected.length));
          cursor = page.nextCursor;
        }
        return collected.map(noteCatalogItem);
      }

      let consumed = first.notes.length;
      let cursor: string | null = first.nextCursor;
      while (cursor) {
        const page = readPage(cursor);
        if (consumed + page.notes.length > offset) {
          const start = offset - consumed;
          const collected = page.notes.slice(start, start + limit);
          cursor = page.nextCursor;
          while (cursor && collected.length < limit) {
            const next = readPage(cursor);
            collected.push(...next.notes.slice(0, limit - collected.length));
            cursor = next.nextCursor;
          }
          return collected.map(noteCatalogItem);
        }
        consumed += page.notes.length;
        cursor = page.nextCursor;
      }
      return [];
    }
  };
}

function catalogReaders(input: {
  query: ComparisonCatalogQuery;
  noteScope: NoteReadScope;
  canReadPsyche: boolean;
}) {
  const { query } = input;
  const readers: CatalogReader[] = [];
  const include = (family: ComparisonFamily) =>
    query.family === null || query.family === family;
  if (include("preference")) {
    readers.push(preferenceCatalogReader(query.userId, query.query));
  }
  if (include("health")) {
    readers.push(healthCatalogReader(query.userId, query.query));
  }
  if (include("psyche")) {
    readers.push(
      psycheCatalogReader(query.userId, query.query, input.canReadPsyche)
    );
  }
  if (include("insight")) {
    readers.push(insightCatalogReader(query.userId, query.query));
  }
  if (include("note")) {
    readers.push(
      noteCatalogReader(
        "note",
        query.userId,
        query.query,
        input.noteScope,
        query.limit
      )
    );
  }
  if (include("wiki")) {
    readers.push(
      noteCatalogReader(
        "wiki",
        query.userId,
        query.query,
        input.noteScope,
        query.limit
      )
    );
  }
  return readers;
}

export function listComparisonCatalog(input: {
  query: ComparisonCatalogQuery;
  noteScope: NoteReadScope;
  canReadPsyche: boolean;
}): ComparisonCatalogResponse {
  const readers = catalogReaders(input);
  const total = readers.reduce((sum, reader) => sum + reader.total, 0);
  const scope = catalogScopeKey(input.query);
  const offset = decodeCatalogCursor(input.query.cursor, scope);
  const items: ComparisonCatalogItem[] = [];
  let familyStart = 0;
  for (const reader of readers) {
    const familyEnd = familyStart + reader.total;
    if (offset < familyEnd && items.length < input.query.limit) {
      const localOffset = Math.max(0, offset - familyStart);
      items.push(...reader.page(localOffset, input.query.limit - items.length));
    }
    familyStart = familyEnd;
    if (items.length === input.query.limit) break;
  }
  const nextOffset = offset + items.length;
  const hasMore = nextOffset < total;
  if (hasMore && nextOffset > CATALOG_MAX_OFFSET) {
    requestError(
      "comparison_catalog_window_exceeded",
      "This catalog page is beyond the supported 10,000-record cursor window. Narrow the family or search query."
    );
  }
  return {
    userId: input.query.userId,
    query: input.query.query,
    family: input.query.family,
    items,
    total,
    limit: input.query.limit,
    nextCursor: hasMore ? encodeCatalogCursor(nextOffset, scope) : null,
    hasMore
  };
}

function unavailableLane(selector: string): ComparisonLane {
  return {
    selector,
    family: null,
    title: "Unavailable selection",
    valueKind: null,
    unit: null,
    availability: null,
    state: "unavailable",
    limitation: UNAVAILABLE_LIMITATION,
    sourceHref: null,
    points: [],
    pointCount: 0,
    sourceReferenceCount: 0,
    sourceReferencesTruncated: false
  };
}

function availableLane(
  lane: Omit<
    ComparisonLane,
    | "state"
    | "pointCount"
    | "sourceReferenceCount"
    | "sourceReferencesTruncated"
  >,
  options: {
    sourceReferenceCount?: number;
    sourceReferencesTruncated?: boolean;
  } = {}
): ComparisonLane {
  return {
    ...lane,
    state: "available",
    pointCount: lane.points.length,
    sourceReferenceCount:
      options.sourceReferenceCount ??
      lane.points.filter((point) => point.source !== null).length,
    sourceReferencesTruncated: options.sourceReferencesTruncated ?? false
  };
}

function pointInRange(dateKey: string | null, query: ComparisonQuery) {
  return Boolean(dateKey && dateKey >= query.from && dateKey <= query.to);
}

function parseJsonObject(raw: string) {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function preferenceLane(
  selector: string,
  itemId: string,
  contextId: string,
  query: ComparisonQuery,
  pointBudget: number
) {
  const row = getDatabase()
    .prepare(
      `SELECT preference_items.id AS item_id,
              preference_items.label AS item_label,
              preference_items.description AS item_description,
              preference_items.profile_id,
              preference_contexts.id AS context_id,
              preference_contexts.name AS context_name,
              preference_profiles.user_id,
              preference_item_scores.id AS score_id,
              preference_item_scores.latent_score,
              preference_item_scores.updated_at AS score_updated_at
       FROM preference_items
       INNER JOIN preference_profiles
         ON preference_profiles.id = preference_items.profile_id
       INNER JOIN preference_contexts
         ON preference_contexts.id = ?
        AND preference_contexts.profile_id = preference_items.profile_id
       LEFT JOIN preference_item_scores
         ON preference_item_scores.item_id = preference_items.id
        AND preference_item_scores.context_id = preference_contexts.id
       WHERE preference_items.id = ?
         AND preference_profiles.user_id = ?`
    )
    .get(contextId, itemId, query.userId) as PreferenceLaneRow | undefined;
  if (!row) return unavailableLane(selector);

  const sourceHref = preferenceSourceHref(
    row.user_id,
    row.item_id,
    row.context_id
  );
  const scoreDateKey = row.score_updated_at
    ? dateKeyInTimeZone(row.score_updated_at, query.timeZone)
    : null;
  const includesCurrentScore = Boolean(
    row.score_id &&
    row.score_updated_at &&
    row.latent_score !== null &&
    Number.isFinite(row.latent_score) &&
    pointInRange(scoreDateKey, query)
  );
  const snapshotBudget = pointBudget - (includesCurrentScore ? 1 : 0);
  if (snapshotBudget < 0) {
    requestError(
      "comparison_point_limit_exceeded",
      `Reduce the date range or selections so the response contains at most ${COMPARISON_MAX_POINTS} points.`
    );
  }
  const fromInstant = firstInstantAtOrAfterDate(query.from, query.timeZone);
  const toExclusive = firstInstantAtOrAfterDate(
    dateKeyAfter(query.to),
    query.timeZone
  );
  const snapshotFilter = `FROM preference_snapshots
       WHERE profile_id = ?
         AND context_id = ?
         AND created_at >= ?
         AND created_at < ?`;
  const snapshotCount = getDatabase()
    .prepare(`SELECT COUNT(*) AS count ${snapshotFilter}`)
    .get(row.profile_id, row.context_id, fromInstant, toExclusive) as {
    count: number;
  };
  if (Number(snapshotCount.count) > snapshotBudget) {
    requestError(
      "comparison_point_limit_exceeded",
      `Reduce the date range or selections so the response contains at most ${COMPARISON_MAX_POINTS} points.`
    );
  }
  const snapshots = getDatabase()
    .prepare(
      `SELECT id, serialized_model_state_json, created_at
       ${snapshotFilter}
       ORDER BY created_at ASC, id ASC
       LIMIT ?`
    )
    .all(
      row.profile_id,
      row.context_id,
      fromInstant,
      toExclusive,
      snapshotBudget + 1
    ) as PreferenceSnapshotRow[];
  const points: ComparisonPoint[] = snapshots.flatMap((snapshot) => {
    const dateKey = dateKeyInTimeZone(snapshot.created_at, query.timeZone);
    if (!pointInRange(dateKey, query)) return [];
    const modelState = parseJsonObject(snapshot.serialized_model_state_json);
    const topScores = Array.isArray(modelState.topScores)
      ? modelState.topScores
      : [];
    const selected = topScores.find(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        (entry as Record<string, unknown>).itemId === itemId
    ) as Record<string, unknown> | undefined;
    const value =
      selected &&
      typeof selected.latentScore === "number" &&
      Number.isFinite(selected.latentScore)
        ? selected.latentScore
        : null;
    return [
      {
        at: snapshot.created_at,
        dateKey: dateKey!,
        value,
        label: null,
        missingReason: value === null ? "not_stored" : null,
        source: {
          entityType: "preference_snapshot",
          entityId: snapshot.id,
          href: sourceHref
        },
        evidence: [
          {
            key: `preference_snapshot:${snapshot.id}`,
            label: "Stored top-12 preference snapshot"
          }
        ]
      } satisfies ComparisonPoint
    ];
  });

  if (includesCurrentScore) {
    points.push({
      at: row.score_updated_at!,
      dateKey: scoreDateKey!,
      value: row.latent_score!,
      label: null,
      missingReason: null,
      source: {
        entityType: "preference_item_score",
        entityId: row.score_id!,
        href: sourceHref
      },
      evidence: [
        {
          key: `preference_item_score:${row.score_id}`,
          label: "Stored current preference score"
        }
      ]
    });
  }
  points.sort((left, right) => left.at.localeCompare(right.at));
  return availableLane({
    selector,
    family: "preference",
    title: `${row.item_label} — ${row.context_name}`,
    valueKind: "number",
    unit: "score",
    availability: "history",
    limitation:
      "Preference history uses stored model snapshots. Each snapshot keeps only its top 12 scores, so an absent selected item is marked not stored. The current point is the stored current score.",
    sourceHref,
    points
  });
}

function primaryNumericValue(day: {
  aggregation?: string;
  latest: number | null;
  average: number | null;
  total: number | null;
  maximum: number | null;
}) {
  return day.aggregation === "cumulative"
    ? (day.total ?? day.latest)
    : (day.latest ?? day.average ?? day.maximum);
}

function healthLane(
  selector: string,
  metricKey: string,
  query: ComparisonQuery,
  view: ReturnType<typeof getVitalsViewData>
) {
  const metric = view.metrics.find((entry) => entry.metric === metricKey);
  if (!metric) return unavailableLane(selector);
  const byDate = new Map(metric.days.map((day) => [day.dateKey, day] as const));
  const points = dateKeys(query.from, query.to).map((dateKey) => {
    const day = byDate.get(dateKey);
    const value = day
      ? primaryNumericValue({ ...day, aggregation: metric.aggregation })
      : null;
    const recorded = value !== null && Number.isFinite(value);
    return {
      at: day?.latestSampleAt ?? `${dateKey}T00:00:00.000Z`,
      dateKey,
      value: recorded ? value : null,
      label: null,
      missingReason: recorded ? null : "not_recorded",
      source: recorded
        ? {
            entityType: "health_daily_summary",
            entityId: `${query.userId}:${metric.metric}:${dateKey}`,
            href: `/vitals?date=${encodeURIComponent(dateKey)}`
          }
        : null,
      evidence: recorded
        ? [
            {
              key: `health:${metric.metric}:${dateKey}`,
              label: `${metric.label} daily aggregate`
            }
          ]
        : []
    } satisfies ComparisonPoint;
  });
  return availableLane({
    selector,
    family: "health",
    title: metric.label,
    valueKind: "number",
    unit: metric.unit,
    availability: "history",
    limitation: null,
    sourceHref: "/vitals",
    points
  });
}

function psycheLane(
  selector: string,
  metricKey: string,
  query: ComparisonQuery,
  view: ReturnType<typeof getPsycheMetricsViewData> | null
) {
  const metric = view?.metrics.find((entry) => entry.metric === metricKey);
  if (!metric) return unavailableLane(selector);
  const byDate = new Map(metric.days.map((day) => [day.dateKey, day] as const));
  let sourceReferenceCount = 0;
  let sourceReferencesTruncated = false;
  const points = dateKeys(query.from, query.to).map((dateKey) => {
    const day = byDate.get(dateKey);
    const value = day
      ? primaryNumericValue({ ...day, aggregation: metric.aggregation })
      : null;
    const recorded = value !== null && Number.isFinite(value);
    const sourceRecords = day?.sourceRecords ?? [];
    sourceReferenceCount += sourceRecords.length || (recorded ? 1 : 0);
    sourceReferencesTruncated ||=
      sourceRecords.length > EVIDENCE_REFERENCES_PER_POINT;
    return {
      at: day?.latestSampleAt ?? `${dateKey}T00:00:00.000Z`,
      dateKey,
      value: recorded ? value : null,
      label: null,
      missingReason: recorded ? null : "not_recorded",
      source: recorded
        ? {
            entityType: "psyche_metric",
            entityId: `${query.userId}:${metric.metric}:${dateKey}`,
            href: `/psyche?date=${encodeURIComponent(dateKey)}`
          }
        : null,
      evidence: sourceRecords
        .slice(0, EVIDENCE_REFERENCES_PER_POINT)
        .map((source) => ({
          key: `${source.sourceType}:${source.sourceId}`,
          label: source.label
        }))
    } satisfies ComparisonPoint;
  });
  return availableLane(
    {
      selector,
      family: "psyche",
      title: metric.label,
      valueKind: "number",
      unit: metric.unit,
      availability: "history",
      limitation: metric.definition.interpretation,
      sourceHref: "/psyche",
      points
    },
    { sourceReferenceCount, sourceReferencesTruncated }
  );
}

function insightLane(
  selector: string,
  insightId: string,
  query: ComparisonQuery
) {
  const row = getDatabase()
    .prepare(
      `SELECT insights.id, insights.title, insights.summary,
              insights.updated_at, insights.evidence_json
       FROM insights
       INNER JOIN entity_owners
         ON entity_owners.entity_type = 'insight'
        AND entity_owners.entity_id = insights.id
        AND entity_owners.role = 'owner'
        AND entity_owners.user_id = ?
       WHERE insights.id = ?
         AND insights.visibility = 'visible'
         AND NOT EXISTS (
           SELECT 1 FROM deleted_entities
           WHERE deleted_entities.entity_type = 'insight'
             AND deleted_entities.entity_id = insights.id
         )`
    )
    .get(query.userId, insightId) as InsightCatalogRow | undefined;
  if (!row) return unavailableLane(selector);
  const sourceHref = `/knowledge-graph?focus=${encodeURIComponent(`insight:${row.id}`)}`;
  const dateKey = dateKeyInTimeZone(row.updated_at, query.timeZone);
  const rawEvidence = (() => {
    try {
      const parsed = JSON.parse(row.evidence_json) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();
  const evidence = rawEvidence
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        return [];
      const value = entry as Record<string, unknown>;
      return typeof value.entityType === "string" &&
        typeof value.entityId === "string" &&
        typeof value.label === "string"
        ? [
            {
              key: `${value.entityType}:${value.entityId}`,
              label: value.label
            }
          ]
        : [];
    })
    .slice(0, EVIDENCE_REFERENCES_PER_POINT);
  const points: ComparisonPoint[] = pointInRange(dateKey, query)
    ? [
        {
          at: row.updated_at,
          dateKey: dateKey!,
          value: null,
          label: row.title,
          missingReason: null,
          source: {
            entityType: "insight",
            entityId: row.id,
            href: sourceHref
          },
          evidence
        }
      ]
    : [];
  return availableLane(
    {
      selector,
      family: "insight",
      title: row.title,
      valueKind: "event",
      unit: null,
      availability: "current_only",
      limitation: CURRENT_ONLY_LIMITATION,
      sourceHref,
      points
    },
    {
      sourceReferenceCount: points.length > 0 ? rawEvidence.length + 1 : 0,
      sourceReferencesTruncated:
        rawEvidence.length > EVIDENCE_REFERENCES_PER_POINT
    }
  );
}

function noteLane(
  selector: string,
  noteId: string,
  family: "note" | "wiki",
  query: ComparisonQuery,
  noteScope: NoteReadScope
) {
  const page = listNotesPage(
    {
      ids: [noteId],
      kind: family === "wiki" ? "wiki" : "evidence",
      userIds: [query.userId],
      limit: 1
    },
    noteScope
  );
  const note = page.notes.find((entry) => entry.id === noteId);
  if (!note) return unavailableLane(selector);
  const sourceHref = noteSourceHref(note);
  const dateKey = dateKeyInTimeZone(note.updatedAt, query.timeZone);
  const points: ComparisonPoint[] = pointInRange(dateKey, query)
    ? [
        {
          at: note.updatedAt,
          dateKey: dateKey!,
          value: null,
          label: note.title,
          missingReason: null,
          source: {
            entityType: family,
            entityId: note.id,
            href: sourceHref
          },
          evidence: []
        }
      ]
    : [];
  return availableLane({
    selector,
    family,
    title: note.title,
    valueKind: "event",
    unit: null,
    availability: "current_only",
    limitation: CURRENT_ONLY_LIMITATION,
    sourceHref,
    points
  });
}

export function getComparison(input: {
  query: ComparisonQuery;
  noteScope: NoteReadScope;
  canReadPsyche: boolean;
}): ComparisonResponse {
  const needsHealth = input.query.selections.some((selector) =>
    selector.startsWith("health:")
  );
  const needsPsyche = input.query.selections.some((selector) =>
    selector.startsWith("psyche:")
  );
  const healthView = needsHealth
    ? getVitalsViewData([input.query.userId])
    : null;
  const psycheView =
    needsPsyche && input.canReadPsyche
      ? getPsycheMetricsViewData({
          userIds: [input.query.userId],
          timeZone: input.query.timeZone
        })
      : null;

  const lanes: ComparisonLane[] = [];
  let remainingPointBudget = COMPARISON_MAX_POINTS;
  for (const selector of input.query.selections) {
    const parsed = parseSelector(selector);
    let lane: ComparisonLane;
    switch (parsed.family) {
      case "preference":
        lane = preferenceLane(
          selector,
          parsed.parts[1]!,
          parsed.parts[2]!,
          input.query,
          remainingPointBudget
        );
        break;
      case "health":
        lane = healthLane(selector, parsed.parts[1]!, input.query, healthView!);
        break;
      case "psyche":
        lane = psycheLane(selector, parsed.parts[1]!, input.query, psycheView);
        break;
      case "insight":
        lane = insightLane(selector, parsed.parts[1]!, input.query);
        break;
      case "note":
        lane = noteLane(
          selector,
          parsed.parts[1]!,
          "note",
          input.query,
          input.noteScope
        );
        break;
      case "wiki":
        lane = noteLane(
          selector,
          parsed.parts[1]!,
          "wiki",
          input.query,
          input.noteScope
        );
        break;
    }
    if (lane.pointCount > remainingPointBudget) {
      requestError(
        "comparison_point_limit_exceeded",
        `Reduce the date range or selections so the response contains at most ${COMPARISON_MAX_POINTS} points.`
      );
    }
    lanes.push(lane);
    remainingPointBudget -= lane.pointCount;
  }

  const pointCount = lanes.reduce((sum, lane) => sum + lane.pointCount, 0);
  if (pointCount > COMPARISON_MAX_POINTS) {
    requestError(
      "comparison_point_limit_exceeded",
      `This comparison would return ${pointCount} points. Reduce the date range or selections so the response contains at most ${COMPARISON_MAX_POINTS} points.`
    );
  }

  const available = lanes.filter((lane) => lane.state === "available");
  const sharedUnits = new Set(available.map((lane) => lane.unit));
  const canShareAxis =
    available.length > 0 &&
    available.every(
      (lane) => lane.valueKind === "number" && lane.unit !== null
    ) &&
    sharedUnits.size === 1;
  const sharedAxisRefused =
    input.query.alignment === "shared_axis" && !canShareAxis;
  const alignmentApplied: ComparisonAlignment = sharedAxisRefused
    ? "separate_tracks"
    : input.query.alignment;
  const sourceReferenceCount = lanes.reduce(
    (sum, lane) => sum + lane.sourceReferenceCount,
    0
  );

  return {
    userId: input.query.userId,
    from: input.query.from,
    to: input.query.to,
    timeZone: input.query.timeZone,
    alignmentRequested: input.query.alignment,
    alignmentApplied,
    sharedAxisReason: sharedAxisRefused
      ? "Forge used separate tracks because every available selection must be numeric and use the same recorded unit before the values can share one axis."
      : null,
    lanes,
    totals: {
      laneCount: lanes.length,
      pointCount,
      sourceReferenceCount,
      sourceReferencesTruncated: lanes.some(
        (lane) => lane.sourceReferencesTruncated
      )
    }
  };
}
