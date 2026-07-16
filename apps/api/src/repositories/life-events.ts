import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDatabase, runInTransaction } from "../db.js";
import {
  createCalendarEvent,
  getCalendarEventById,
  listCalendarEvents,
  updateCalendarEvent
} from "./calendar.js";
import { recordActivityEvent } from "./activity-events.js";
import { decorateOwnedEntity, setEntityOwner } from "./entity-ownership.js";
import { filterDeletedEntities, isEntityDeleted } from "./deleted-entities.js";
import {
  listEntityLinksForSources,
  replaceEntityLinksForSource,
  type EntityLinkInput,
  type EntityLinkRecord
} from "./entity-links.js";
import {
  readTrustedArtifactTicketText,
  serializeArtifactPublicPayload
} from "../services/artifacts.js";
import {
  createLifeEventSchema,
  lifeEventCalendarProjectionSchema,
  lifeEventSegmentTypeSchema,
  lifeEventSchema,
  lifeEventTypeSchema,
  lifeEventTransportModeSchema,
  updateLifeEventSchema,
  type ActivitySource,
  type CalendarEvent,
  type LifeEvent,
  type LifeEventSegment,
  type LifeEventSegmentInput,
  type UpdateLifeEventInput
} from "../types.js";

const CALENDAR_RECONCILE_RANGE_DAYS = 2;
const SYSTEM_LINK_RELATIONSHIPS = new Set([
  "primary_calendar_projection",
  "matched_existing_calendar_event",
  "source_artifact",
  "ticket_artifact"
]);

type LifeEventRow = {
  id: string;
  title: string;
  short_description: string;
  description: string;
  event_type: string;
  status: string;
  importance: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  is_all_day: number;
  place_label: string;
  place_address: string;
  place_timezone: string;
  place_latitude: number | null;
  place_longitude: number | null;
  origin_label: string;
  origin_city: string;
  origin_country: string;
  origin_latitude: number | null;
  origin_longitude: number | null;
  destination_label: string;
  destination_city: string;
  destination_country: string;
  destination_latitude: number | null;
  destination_longitude: number | null;
  transport_mode: string | null;
  primary_calendar_event_id: string | null;
  calendar_sync_state: string;
  calendar_match_confidence: number | null;
  source_kind: string;
  source_artifact_id: string | null;
  extraction_status: string;
  extraction_summary_json: string;
  travel_details_json: string;
  display_style_json: string;
  metadata_json: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

type LifeEventSegmentRow = {
  id: string;
  life_event_id: string;
  segment_type: string;
  transport_mode: string | null;
  sequence_index: number;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  origin_label: string;
  origin_iata: string;
  origin_icao: string;
  origin_city: string;
  origin_country: string;
  origin_latitude: number | null;
  origin_longitude: number | null;
  destination_label: string;
  destination_iata: string;
  destination_icao: string;
  destination_city: string;
  destination_country: string;
  destination_latitude: number | null;
  destination_longitude: number | null;
  carrier_name: string;
  carrier_code: string;
  service_number: string;
  booking_reference: string;
  terminal: string;
  gate: string;
  seat: string;
  status: string;
  status_source: string;
  status_checked_at: string | null;
  route_geometry_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type ActivityContext = {
  source: ActivitySource;
  actor?: string | null;
  userIds?: readonly string[];
  projectIds?: readonly string[];
  tagIds?: readonly string[];
};

export const lifeEventTimelineQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  q: z.string().trim().max(200).default(""),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
  eventTypes: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) =>
      Array.isArray(value)
        ? value
        : typeof value === "string" && value.trim().length > 0
          ? value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
          : []
    )
});

export const lifeEventCalendarSyncInputSchema = z.object({
  projection: lifeEventCalendarProjectionSchema.default("link_or_create"),
  preferredCalendarId: z.string().trim().nullable().optional()
});

export const lifeEventFromCalendarInputSchema = z.object({
  calendarEventId: z.string().trim().min(1),
  eventType: lifeEventTypeSchema.default("custom"),
  importance: z
    .enum(["ordinary", "meaningful", "major", "life_changing"])
    .default("meaningful")
});

export const lifeEventTicketImportInputSchema = z
  .object({
    artifactId: z.string().trim().min(1),
    createDraft: z.boolean().default(false),
    useLlm: z.boolean().default(false),
    llmProfileId: z.string().trim().optional()
  })
  .strict();

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function defaultEndAt(startsAt: string) {
  const date = new Date(startsAt);
  date.setHours(date.getHours() + 1);
  return date.toISOString();
}

function linkRowsToInputs(rows: EntityLinkRecord[]): EntityLinkInput[] {
  return rows
    .filter((row) => !SYSTEM_LINK_RELATIONSHIPS.has(row.relationship))
    .map((row) => ({
      entityType: row.targetEntityType,
      entityId: row.targetEntityId,
      anchorKey: row.anchorKey,
      relationship: row.relationship
    }));
}

function buildStoredLinks(
  links: EntityLinkInput[] | undefined,
  event: Pick<LifeEvent, "primaryCalendarEventId" | "sourceArtifactId">
): EntityLinkInput[] {
  const next = [...(links ?? [])];
  if (event.primaryCalendarEventId) {
    next.push({
      entityType: "calendar_event",
      entityId: event.primaryCalendarEventId,
      relationship: "primary_calendar_projection"
    });
  }
  if (event.sourceArtifactId) {
    next.push({
      entityType: "artifact",
      entityId: event.sourceArtifactId,
      relationship: "ticket_artifact"
    });
  }
  return next;
}

function replaceLifeEventLinks(
  lifeEventId: string,
  links: EntityLinkInput[],
  actor?: string | null
) {
  replaceEntityLinksForSource({
    sourceEntityType: "life_event",
    sourceEntityId: lifeEventId,
    links,
    actor
  });
}

function mapSegment(row: LifeEventSegmentRow): LifeEventSegment {
  return {
    id: row.id,
    lifeEventId: row.life_event_id,
    segmentType: lifeEventSegmentTypeSchema.parse(row.segment_type),
    transportMode: row.transport_mode
      ? lifeEventTransportModeSchema.parse(row.transport_mode)
      : null,
    sequenceIndex: row.sequence_index,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone,
    originLabel: row.origin_label,
    originIata: row.origin_iata,
    originIcao: row.origin_icao,
    originCity: row.origin_city,
    originCountry: row.origin_country,
    originLatitude: row.origin_latitude,
    originLongitude: row.origin_longitude,
    destinationLabel: row.destination_label,
    destinationIata: row.destination_iata,
    destinationIcao: row.destination_icao,
    destinationCity: row.destination_city,
    destinationCountry: row.destination_country,
    destinationLatitude: row.destination_latitude,
    destinationLongitude: row.destination_longitude,
    carrierName: row.carrier_name,
    carrierCode: row.carrier_code,
    serviceNumber: row.service_number,
    bookingReference: row.booking_reference,
    terminal: row.terminal,
    gate: row.gate,
    seat: row.seat,
    status: row.status,
    statusSource: row.status_source,
    statusCheckedAt: row.status_checked_at,
    routeGeometry: parseJsonObject(row.route_geometry_json),
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function listSegments(lifeEventId: string): LifeEventSegment[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, life_event_id, segment_type, transport_mode, sequence_index, title,
              starts_at, ends_at, timezone,
              origin_label, origin_iata, origin_icao, origin_city, origin_country, origin_latitude, origin_longitude,
              destination_label, destination_iata, destination_icao, destination_city, destination_country,
              destination_latitude, destination_longitude,
              carrier_name, carrier_code, service_number, booking_reference, terminal, gate, seat,
              status, status_source, status_checked_at, route_geometry_json, metadata_json, created_at, updated_at
       FROM life_event_segments
       WHERE life_event_id = ?
       ORDER BY sequence_index ASC, starts_at ASC, created_at ASC`
    )
    .all(lifeEventId) as LifeEventSegmentRow[];
  return rows.map(mapSegment);
}

function mapLifeEvent(row: LifeEventRow): LifeEvent {
  return lifeEventSchema.parse(
    decorateOwnedEntity("life_event", {
      id: row.id,
      title: row.title,
      shortDescription: row.short_description,
      description: row.description,
      eventType: row.event_type,
      status: row.status,
      importance: row.importance,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      timezone: row.timezone,
      isAllDay: Boolean(row.is_all_day),
      placeLabel: row.place_label,
      placeAddress: row.place_address,
      placeTimezone: row.place_timezone,
      placeLatitude: row.place_latitude,
      placeLongitude: row.place_longitude,
      originLabel: row.origin_label,
      originCity: row.origin_city,
      originCountry: row.origin_country,
      originLatitude: row.origin_latitude,
      originLongitude: row.origin_longitude,
      destinationLabel: row.destination_label,
      destinationCity: row.destination_city,
      destinationCountry: row.destination_country,
      destinationLatitude: row.destination_latitude,
      destinationLongitude: row.destination_longitude,
      transportMode: row.transport_mode,
      primaryCalendarEventId: row.primary_calendar_event_id,
      calendarSyncState: row.calendar_sync_state,
      calendarMatchConfidence: row.calendar_match_confidence,
      sourceKind: row.source_kind,
      sourceArtifactId: row.source_artifact_id,
      extractionStatus: row.extraction_status,
      extractionSummary: parseJsonObject(row.extraction_summary_json),
      travelDetails: parseJsonObject(row.travel_details_json),
      displayStyle: parseJsonObject(row.display_style_json),
      metadata: parseJsonObject(row.metadata_json),
      segments: listSegments(row.id),
      links: listEntityLinksForSources("life_event", [row.id]),
      deletedAt: row.deleted_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })
  );
}

function getLifeEventRow(lifeEventId: string): LifeEventRow | undefined {
  return getDatabase()
    .prepare(
      `SELECT id, title, short_description, description, event_type, status, importance,
              starts_at, ends_at, timezone, is_all_day,
              place_label, place_address, place_timezone, place_latitude, place_longitude,
              origin_label, origin_city, origin_country, origin_latitude, origin_longitude,
              destination_label, destination_city, destination_country, destination_latitude, destination_longitude,
              transport_mode, primary_calendar_event_id, calendar_sync_state, calendar_match_confidence,
              source_kind, source_artifact_id, extraction_status, extraction_summary_json,
              travel_details_json, display_style_json, metadata_json, deleted_at, created_at, updated_at
       FROM life_events
       WHERE id = ?`
    )
    .get(lifeEventId) as LifeEventRow | undefined;
}

function putSegments(lifeEventId: string, segments: LifeEventSegmentInput[]) {
  const database = getDatabase();
  database
    .prepare(`DELETE FROM life_event_segments WHERE life_event_id = ?`)
    .run(lifeEventId);
  const insert = database.prepare(
    `INSERT INTO life_event_segments (
      id, life_event_id, segment_type, transport_mode, sequence_index, title, starts_at, ends_at, timezone,
      origin_label, origin_iata, origin_icao, origin_city, origin_country, origin_latitude, origin_longitude,
      destination_label, destination_iata, destination_icao, destination_city, destination_country, destination_latitude, destination_longitude,
      carrier_name, carrier_code, service_number, booking_reference, terminal, gate, seat,
      status, status_source, status_checked_at, route_geometry_json, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const timestamp = nowIso();
  for (const [index, segment] of segments.entries()) {
    insert.run(
      segment.id?.trim() || makeId("lifeseg"),
      lifeEventId,
      segment.segmentType,
      segment.transportMode ?? null,
      segment.sequenceIndex ?? index,
      segment.title,
      segment.startsAt ?? null,
      segment.endsAt ?? null,
      segment.timezone,
      segment.originLabel,
      segment.originIata,
      segment.originIcao,
      segment.originCity,
      segment.originCountry,
      segment.originLatitude ?? null,
      segment.originLongitude ?? null,
      segment.destinationLabel,
      segment.destinationIata,
      segment.destinationIcao,
      segment.destinationCity,
      segment.destinationCountry,
      segment.destinationLatitude ?? null,
      segment.destinationLongitude ?? null,
      segment.carrierName,
      segment.carrierCode,
      segment.serviceNumber,
      segment.bookingReference,
      segment.terminal,
      segment.gate,
      segment.seat,
      segment.status,
      segment.statusSource,
      segment.statusCheckedAt ?? null,
      JSON.stringify(segment.routeGeometry ?? {}),
      JSON.stringify(segment.metadata ?? {}),
      timestamp,
      timestamp
    );
  }
}

function calendarRangeFor(event: Pick<LifeEvent, "startsAt" | "endsAt">) {
  const from = new Date(event.startsAt);
  from.setUTCDate(from.getUTCDate() - CALENDAR_RECONCILE_RANGE_DAYS);
  const to = new Date(event.endsAt);
  to.setUTCDate(to.getUTCDate() + CALENDAR_RECONCILE_RANGE_DAYS);
  return { from: from.toISOString(), to: to.toISOString() };
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function scoreCalendarMatch(event: LifeEvent, calendarEvent: CalendarEvent) {
  let score = 0;
  if (normalizeText(event.title) === normalizeText(calendarEvent.title)) {
    score += 0.4;
  } else if (
    normalizeText(calendarEvent.title).includes(normalizeText(event.title)) ||
    normalizeText(event.title).includes(normalizeText(calendarEvent.title))
  ) {
    score += 0.2;
  }
  const startDiff = Math.abs(
    Date.parse(event.startsAt) - Date.parse(calendarEvent.startAt)
  );
  const endDiff = Math.abs(
    Date.parse(event.endsAt) - Date.parse(calendarEvent.endAt)
  );
  if (startDiff <= 5 * 60 * 1000) {
    score += 0.25;
  } else if (startDiff <= 60 * 60 * 1000) {
    score += 0.15;
  }
  if (endDiff <= 5 * 60 * 1000) {
    score += 0.15;
  } else if (endDiff <= 60 * 60 * 1000) {
    score += 0.08;
  }
  const place = normalizeText(
    event.placeLabel || event.destinationCity || event.originCity
  );
  const calendarLocation = normalizeText(
    calendarEvent.location || calendarEvent.place.label
  );
  if (
    place &&
    calendarLocation &&
    (calendarLocation.includes(place) || place.includes(calendarLocation))
  ) {
    score += 0.15;
  }
  if (
    calendarEvent.links.some(
      (link) => link.entityType === "life_event" && link.entityId === event.id
    )
  ) {
    score += 0.4;
  }
  return Math.min(1, score);
}

function findCalendarMatch(event: LifeEvent) {
  const range = calendarRangeFor(event);
  const matches = listCalendarEvents(range)
    .map((calendarEvent) => ({
      calendarEvent,
      confidence: scoreCalendarMatch(event, calendarEvent)
    }))
    .filter((match) => match.confidence >= 0.55)
    .sort((a, b) => b.confidence - a.confidence);
  return matches[0] ?? null;
}

function patchLifeEventCalendarState(
  lifeEventId: string,
  state: {
    primaryCalendarEventId: string | null;
    calendarSyncState: LifeEvent["calendarSyncState"];
    calendarMatchConfidence: number | null;
  }
) {
  getDatabase()
    .prepare(
      `UPDATE life_events
       SET primary_calendar_event_id = ?,
           calendar_sync_state = ?,
           calendar_match_confidence = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .run(
      state.primaryCalendarEventId,
      state.calendarSyncState,
      state.calendarMatchConfidence,
      nowIso(),
      lifeEventId
    );
}

function ensureCalendarLink(event: LifeEvent, calendarEventId: string) {
  const calendarEvent = getCalendarEventById(calendarEventId);
  if (!calendarEvent) {
    return;
  }
  const links = [
    ...calendarEvent.links
      .filter(
        (link) =>
          !(link.entityType === "life_event" && link.entityId === event.id)
      )
      .map((link) => ({
        entityType: link.entityType,
        entityId: link.entityId,
        relationshipType: link.relationshipType
      })),
    {
      entityType: "life_event" as const,
      entityId: event.id,
      relationshipType: "life_event"
    }
  ];
  updateCalendarEvent(calendarEventId, { links });
}

function buildCalendarInput(
  event: LifeEvent,
  preferredCalendarId?: string | null
) {
  const location =
    event.placeLabel ||
    event.placeAddress ||
    [event.destinationCity, event.destinationCountry]
      .filter(Boolean)
      .join(", ") ||
    [event.originCity, event.originCountry].filter(Boolean).join(", ");
  return {
    title: event.title,
    description: event.description || event.shortDescription,
    location,
    place: {
      label: event.placeLabel || location,
      address: event.placeAddress,
      timezone: event.placeTimezone || event.timezone,
      latitude: event.placeLatitude,
      longitude: event.placeLongitude,
      source: "life_event",
      externalPlaceId: ""
    },
    startAt: event.startsAt,
    endAt: event.endsAt,
    timezone: event.timezone,
    isAllDay: event.isAllDay,
    availability: "busy" as const,
    eventType: "life_event",
    categories: ["life_event", event.eventType],
    preferredCalendarId: preferredCalendarId ?? undefined,
    userId: event.userId,
    links: [
      {
        entityType: "life_event" as const,
        entityId: event.id,
        relationshipType: "life_event"
      }
    ]
  };
}

export function listLifeEvents(): LifeEvent[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, title, short_description, description, event_type, status, importance,
              starts_at, ends_at, timezone, is_all_day,
              place_label, place_address, place_timezone, place_latitude, place_longitude,
              origin_label, origin_city, origin_country, origin_latitude, origin_longitude,
              destination_label, destination_city, destination_country, destination_latitude, destination_longitude,
              transport_mode, primary_calendar_event_id, calendar_sync_state, calendar_match_confidence,
              source_kind, source_artifact_id, extraction_status, extraction_summary_json,
              travel_details_json, display_style_json, metadata_json, deleted_at, created_at, updated_at
       FROM life_events
       ORDER BY starts_at ASC, created_at ASC`
    )
    .all() as LifeEventRow[];
  return filterDeletedEntities("life_event", rows.map(mapLifeEvent));
}

export function listLifeEventTimeline(
  input: z.input<typeof lifeEventTimelineQuerySchema>
) {
  const query = lifeEventTimelineQuerySchema.parse(input);
  const clauses = [
    "deleted_at IS NULL",
    `NOT EXISTS (
      SELECT 1
      FROM deleted_entities
      WHERE entity_type = 'life_event' AND entity_id = life_events.id
    )`
  ];
  const params: Array<string | number> = [];
  if (query.from) {
    clauses.push("ends_at >= ?");
    params.push(query.from);
  }
  if (query.to) {
    clauses.push("starts_at <= ?");
    params.push(query.to);
  }
  if (query.eventTypes.length > 0) {
    clauses.push(
      `event_type IN (${query.eventTypes.map(() => "?").join(", ")})`
    );
    params.push(...query.eventTypes);
  }
  if (query.q) {
    const searchFields = [
      "title",
      "short_description",
      "description",
      "event_type",
      "place_label",
      "place_address",
      "origin_label",
      "origin_city",
      "destination_label",
      "destination_city"
    ];
    const segmentSearchFields = [
      "title",
      "carrier_name",
      "carrier_code",
      "service_number",
      "booking_reference",
      "terminal",
      "gate",
      "seat",
      "origin_label",
      "origin_iata",
      "origin_city",
      "destination_label",
      "destination_iata",
      "destination_city"
    ];
    const pattern = `%${escapeLikePattern(query.q.toLowerCase())}%`;
    clauses.push(
      `(${searchFields
        .map((field) => `LOWER(COALESCE(${field}, '')) LIKE ? ESCAPE '\\'`)
        .join(" OR ")} OR EXISTS (
          SELECT 1
          FROM life_event_segments
          WHERE life_event_segments.life_event_id = life_events.id
            AND (${segmentSearchFields
              .map(
                (field) =>
                  `LOWER(COALESCE(life_event_segments.${field}, '')) LIKE ? ESCAPE '\\'`
              )
              .concat(
                `LOWER(COALESCE(life_event_segments.carrier_code, '') || COALESCE(life_event_segments.service_number, '')) LIKE ? ESCAPE '\\'`
              )
              .join(" OR ")})
        ))`
    );
    params.push(
      ...searchFields.map(() => pattern),
      ...segmentSearchFields.map(() => pattern),
      pattern
    );
  }
  const whereClause = clauses.join(" AND ");
  const now = new Date();
  const nowIso = now.toISOString();
  const total = (
    getDatabase()
      .prepare(`SELECT COUNT(*) AS count FROM life_events WHERE ${whereClause}`)
      .get(...params) as { count: number }
  ).count;
  const counts = getDatabase()
    .prepare(
      `SELECT
         SUM(CASE WHEN ends_at < ? THEN 1 ELSE 0 END) AS past,
         SUM(CASE WHEN starts_at <= ? AND ends_at >= ? THEN 1 ELSE 0 END) AS current,
         SUM(CASE WHEN starts_at > ? THEN 1 ELSE 0 END) AS upcoming
       FROM life_events
       WHERE ${whereClause}`
    )
    .get(nowIso, nowIso, nowIso, nowIso, ...params) as {
    past: number | null;
    current: number | null;
    upcoming: number | null;
  };
  const rows = getDatabase()
    .prepare(
      `SELECT id, title, short_description, description, event_type, status, importance,
              starts_at, ends_at, timezone, is_all_day,
              place_label, place_address, place_timezone, place_latitude, place_longitude,
              origin_label, origin_city, origin_country, origin_latitude, origin_longitude,
              destination_label, destination_city, destination_country, destination_latitude, destination_longitude,
              transport_mode, primary_calendar_event_id, calendar_sync_state, calendar_match_confidence,
              source_kind, source_artifact_id, extraction_status, extraction_summary_json,
              travel_details_json, display_style_json, metadata_json, deleted_at, created_at, updated_at
       FROM life_events
       WHERE ${whereClause}
       ORDER BY starts_at ASC, created_at ASC, id ASC
       LIMIT ? OFFSET ?`
    )
    .all(...params, query.limit, query.offset) as LifeEventRow[];
  const events = filterDeletedEntities("life_event", rows.map(mapLifeEvent));
  const nextRow = getDatabase()
    .prepare(
      `SELECT id
       FROM life_events
       WHERE ${whereClause} AND ends_at >= ?
       ORDER BY starts_at ASC, created_at ASC, id ASC
       LIMIT 1`
    )
    .get(...params, now.toISOString()) as { id: string } | undefined;
  return {
    events,
    now: nowIso,
    nextLifeEventId: nextRow?.id ?? null,
    limit: query.limit,
    offset: query.offset,
    total,
    hasMore: query.offset + events.length < total,
    counts: {
      past: counts.past ?? 0,
      current: counts.current ?? 0,
      upcoming: counts.upcoming ?? 0
    }
  };
}

export function getLifeEventById(lifeEventId: string): LifeEvent | undefined {
  const row = getLifeEventRow(lifeEventId);
  if (!row || isEntityDeleted("life_event", lifeEventId)) {
    return undefined;
  }
  return mapLifeEvent(row);
}

export function createLifeEvent(
  input: z.input<typeof createLifeEventSchema>,
  activity?: ActivityContext
): LifeEvent {
  const parsed = createLifeEventSchema.parse(input);
  return runInTransaction(() => {
    const id = makeId("lifeevent");
    const timestamp = nowIso();
    const endsAt = parsed.endsAt ?? defaultEndAt(parsed.startsAt);
    getDatabase()
      .prepare(
        `INSERT INTO life_events (
          id, title, short_description, description, event_type, status, importance,
          starts_at, ends_at, timezone, is_all_day,
          place_label, place_address, place_timezone, place_latitude, place_longitude,
          origin_label, origin_city, origin_country, origin_latitude, origin_longitude,
          destination_label, destination_city, destination_country, destination_latitude, destination_longitude,
          transport_mode, primary_calendar_event_id, calendar_sync_state, calendar_match_confidence,
          source_kind, source_artifact_id, extraction_status, extraction_summary_json,
          travel_details_json, display_style_json, metadata_json, deleted_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        parsed.title,
        parsed.shortDescription,
        parsed.description,
        parsed.eventType,
        parsed.status,
        parsed.importance,
        parsed.startsAt,
        endsAt,
        parsed.timezone,
        parsed.isAllDay ? 1 : 0,
        parsed.placeLabel,
        parsed.placeAddress,
        parsed.placeTimezone,
        parsed.placeLatitude ?? null,
        parsed.placeLongitude ?? null,
        parsed.originLabel,
        parsed.originCity,
        parsed.originCountry,
        parsed.originLatitude ?? null,
        parsed.originLongitude ?? null,
        parsed.destinationLabel,
        parsed.destinationCity,
        parsed.destinationCountry,
        parsed.destinationLatitude ?? null,
        parsed.destinationLongitude ?? null,
        parsed.transportMode ?? null,
        parsed.primaryCalendarEventId ?? null,
        parsed.calendarSyncState,
        parsed.calendarMatchConfidence ?? null,
        parsed.sourceKind,
        parsed.sourceArtifactId ?? null,
        parsed.extractionStatus,
        JSON.stringify(parsed.extractionSummary),
        JSON.stringify(parsed.travelDetails),
        JSON.stringify(parsed.displayStyle),
        JSON.stringify(parsed.metadata),
        null,
        timestamp,
        timestamp
      );
    setEntityOwner("life_event", id, parsed.userId);
    putSegments(id, parsed.segments);
    let event = getLifeEventById(id)!;
    replaceLifeEventLinks(
      id,
      buildStoredLinks(parsed.links, event),
      activity?.actor ?? null
    );
    event = getLifeEventById(id)!;
    if (parsed.primaryCalendarEventId) {
      ensureCalendarLink(event, parsed.primaryCalendarEventId);
    } else if (parsed.calendarProjection !== "none") {
      syncLifeEventCalendar(id, {
        projection: parsed.calendarProjection
      });
      event = getLifeEventById(id)!;
    }
    if (activity) {
      recordActivityEvent({
        entityType: "life_event",
        entityId: event.id,
        eventType: "life_event_created",
        title: `Life Event created: ${event.title}`,
        description: event.shortDescription || event.description,
        actor: activity.actor ?? null,
        source: activity.source,
        metadata: {
          eventType: event.eventType,
          startsAt: event.startsAt,
          primaryCalendarEventId: event.primaryCalendarEventId
        }
      });
    }
    return event;
  });
}

export function updateLifeEvent(
  lifeEventId: string,
  input: UpdateLifeEventInput,
  activity?: ActivityContext
): LifeEvent | undefined {
  const current = getLifeEventById(lifeEventId);
  if (!current) {
    return undefined;
  }
  const parsed = updateLifeEventSchema.parse(input);
  return runInTransaction(() => {
    const next = {
      ...current,
      ...parsed,
      endsAt:
        parsed.endsAt ??
        (parsed.startsAt && !input.endsAt
          ? defaultEndAt(parsed.startsAt)
          : current.endsAt),
      updatedAt: nowIso()
    };
    if (Date.parse(next.endsAt) <= Date.parse(next.startsAt)) {
      throw new Error("endsAt must be after startsAt");
    }
    getDatabase()
      .prepare(
        `UPDATE life_events
         SET title = ?, short_description = ?, description = ?, event_type = ?, status = ?, importance = ?,
             starts_at = ?, ends_at = ?, timezone = ?, is_all_day = ?,
             place_label = ?, place_address = ?, place_timezone = ?, place_latitude = ?, place_longitude = ?,
             origin_label = ?, origin_city = ?, origin_country = ?, origin_latitude = ?, origin_longitude = ?,
             destination_label = ?, destination_city = ?, destination_country = ?, destination_latitude = ?, destination_longitude = ?,
             transport_mode = ?, primary_calendar_event_id = ?, calendar_sync_state = ?, calendar_match_confidence = ?,
             source_kind = ?, source_artifact_id = ?, extraction_status = ?, extraction_summary_json = ?,
             travel_details_json = ?, display_style_json = ?, metadata_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        next.title,
        next.shortDescription,
        next.description,
        next.eventType,
        next.status,
        next.importance,
        next.startsAt,
        next.endsAt,
        next.timezone,
        next.isAllDay ? 1 : 0,
        next.placeLabel,
        next.placeAddress,
        next.placeTimezone,
        next.placeLatitude,
        next.placeLongitude,
        next.originLabel,
        next.originCity,
        next.originCountry,
        next.originLatitude,
        next.originLongitude,
        next.destinationLabel,
        next.destinationCity,
        next.destinationCountry,
        next.destinationLatitude,
        next.destinationLongitude,
        next.transportMode,
        next.primaryCalendarEventId,
        next.calendarSyncState,
        next.calendarMatchConfidence,
        next.sourceKind,
        next.sourceArtifactId,
        next.extractionStatus,
        JSON.stringify(next.extractionSummary),
        JSON.stringify(next.travelDetails),
        JSON.stringify(next.displayStyle),
        JSON.stringify(next.metadata),
        next.updatedAt,
        lifeEventId
      );
    if (parsed.userId !== undefined) {
      setEntityOwner("life_event", lifeEventId, parsed.userId);
    }
    if (parsed.segments !== undefined) {
      putSegments(lifeEventId, parsed.segments);
    }
    let updated = getLifeEventById(lifeEventId)!;
    if (
      parsed.links !== undefined ||
      parsed.primaryCalendarEventId !== undefined ||
      parsed.sourceArtifactId !== undefined
    ) {
      const userLinks =
        parsed.links ?? linkRowsToInputs(current.links as EntityLinkRecord[]);
      replaceLifeEventLinks(
        lifeEventId,
        buildStoredLinks(userLinks, updated),
        activity?.actor ?? null
      );
      updated = getLifeEventById(lifeEventId)!;
    }
    if (parsed.primaryCalendarEventId) {
      ensureCalendarLink(updated, parsed.primaryCalendarEventId);
    }
    if (parsed.calendarProjection && parsed.calendarProjection !== "none") {
      syncLifeEventCalendar(lifeEventId, {
        projection: parsed.calendarProjection
      });
      updated = getLifeEventById(lifeEventId)!;
    }
    if (activity) {
      recordActivityEvent({
        entityType: "life_event",
        entityId: updated.id,
        eventType: "life_event_updated",
        title: `Life Event updated: ${updated.title}`,
        description: updated.shortDescription || updated.description,
        actor: activity.actor ?? null,
        source: activity.source,
        metadata: {
          eventType: updated.eventType,
          startsAt: updated.startsAt,
          calendarSyncState: updated.calendarSyncState
        }
      });
    }
    return updated;
  });
}

export function deleteLifeEvent(
  lifeEventId: string,
  activity?: ActivityContext
) {
  const existing = getLifeEventById(lifeEventId);
  if (!existing) {
    return undefined;
  }
  getDatabase()
    .prepare(`DELETE FROM life_events WHERE id = ?`)
    .run(lifeEventId);
  if (activity) {
    recordActivityEvent({
      entityType: "life_event",
      entityId: lifeEventId,
      eventType: "life_event_deleted",
      title: `Life Event deleted: ${existing.title}`,
      description: "Life Event record was permanently removed.",
      actor: activity.actor ?? null,
      source: activity.source,
      metadata: { eventType: existing.eventType }
    });
  }
  return existing;
}

export function syncLifeEventCalendar(
  lifeEventId: string,
  input: z.input<typeof lifeEventCalendarSyncInputSchema> = {}
) {
  const parsed = lifeEventCalendarSyncInputSchema.parse(input);
  const event = getLifeEventById(lifeEventId);
  if (!event) {
    return undefined;
  }
  return runInTransaction(() => {
    if (parsed.projection === "none") {
      patchLifeEventCalendarState(lifeEventId, {
        primaryCalendarEventId: event.primaryCalendarEventId,
        calendarSyncState: "disabled",
        calendarMatchConfidence: event.calendarMatchConfidence
      });
      return {
        lifeEvent: getLifeEventById(lifeEventId)!,
        calendarEvent: event.primaryCalendarEventId
          ? getCalendarEventById(event.primaryCalendarEventId)
          : null,
        action: "disabled" as const,
        confidence: event.calendarMatchConfidence
      };
    }

    if (event.primaryCalendarEventId) {
      const calendarEvent = getCalendarEventById(event.primaryCalendarEventId);
      if (calendarEvent) {
        updateCalendarEvent(
          event.primaryCalendarEventId,
          buildCalendarInput(event, parsed.preferredCalendarId)
        );
        ensureCalendarLink(event, event.primaryCalendarEventId);
        patchLifeEventCalendarState(lifeEventId, {
          primaryCalendarEventId: event.primaryCalendarEventId,
          calendarSyncState: "linked",
          calendarMatchConfidence: event.calendarMatchConfidence ?? 1
        });
        const updated = getLifeEventById(lifeEventId)!;
        replaceLifeEventLinks(
          lifeEventId,
          buildStoredLinks(
            linkRowsToInputs(updated.links as EntityLinkRecord[]),
            updated
          )
        );
        return {
          lifeEvent: updated,
          calendarEvent: getCalendarEventById(event.primaryCalendarEventId),
          action: "updated_existing_projection" as const,
          confidence: updated.calendarMatchConfidence
        };
      }
    }

    const match = findCalendarMatch(event);
    if (match) {
      patchLifeEventCalendarState(lifeEventId, {
        primaryCalendarEventId: match.calendarEvent.id,
        calendarSyncState: "matched",
        calendarMatchConfidence: match.confidence
      });
      const updated = getLifeEventById(lifeEventId)!;
      replaceLifeEventLinks(
        lifeEventId,
        buildStoredLinks(
          linkRowsToInputs(updated.links as EntityLinkRecord[]),
          updated
        )
      );
      ensureCalendarLink(updated, match.calendarEvent.id);
      return {
        lifeEvent: getLifeEventById(lifeEventId)!,
        calendarEvent: getCalendarEventById(match.calendarEvent.id),
        action: "matched_existing_calendar_event" as const,
        confidence: match.confidence
      };
    }

    if (parsed.projection === "link_existing_only") {
      patchLifeEventCalendarState(lifeEventId, {
        primaryCalendarEventId: null,
        calendarSyncState: "needs_review",
        calendarMatchConfidence: null
      });
      return {
        lifeEvent: getLifeEventById(lifeEventId)!,
        calendarEvent: null,
        action: "needs_review_no_match" as const,
        confidence: null
      };
    }

    const calendarEvent = createCalendarEvent(
      buildCalendarInput(event, parsed.preferredCalendarId)
    );
    patchLifeEventCalendarState(lifeEventId, {
      primaryCalendarEventId: calendarEvent.id,
      calendarSyncState: "created",
      calendarMatchConfidence: 1
    });
    const updated = getLifeEventById(lifeEventId)!;
    replaceLifeEventLinks(
      lifeEventId,
      buildStoredLinks(
        linkRowsToInputs(updated.links as EntityLinkRecord[]),
        updated
      )
    );
    return {
      lifeEvent: getLifeEventById(lifeEventId)!,
      calendarEvent,
      action: "created_calendar_event" as const,
      confidence: 1
    };
  });
}

export function createLifeEventFromCalendar(
  input: z.input<typeof lifeEventFromCalendarInputSchema>,
  activity?: ActivityContext
) {
  const parsed = lifeEventFromCalendarInputSchema.parse(input);
  const calendarEvent = getCalendarEventById(parsed.calendarEventId);
  if (!calendarEvent) {
    return undefined;
  }
  const existing = listLifeEvents().find(
    (event) => event.primaryCalendarEventId === calendarEvent.id
  );
  if (existing) {
    ensureCalendarLink(existing, calendarEvent.id);
    return {
      lifeEvent: existing,
      calendarEvent,
      action: "already_linked" as const
    };
  }
  const lifeEvent = createLifeEvent(
    {
      title: calendarEvent.title,
      shortDescription: calendarEvent.location || calendarEvent.eventType,
      description: calendarEvent.description,
      eventType: parsed.eventType,
      importance: parsed.importance,
      startsAt: calendarEvent.startAt,
      endsAt: calendarEvent.endAt,
      timezone: calendarEvent.timezone,
      isAllDay: calendarEvent.isAllDay,
      placeLabel: calendarEvent.place.label || calendarEvent.location,
      placeAddress: calendarEvent.place.address,
      placeTimezone: calendarEvent.place.timezone,
      placeLatitude: calendarEvent.place.latitude,
      placeLongitude: calendarEvent.place.longitude,
      primaryCalendarEventId: calendarEvent.id,
      calendarSyncState: "linked",
      calendarMatchConfidence: 1,
      calendarProjection: "none",
      sourceKind: "calendar",
      links: [
        {
          entityType: "calendar_event",
          entityId: calendarEvent.id,
          relationship: "primary_calendar_projection"
        }
      ]
    },
    activity
  );
  ensureCalendarLink(lifeEvent, calendarEvent.id);
  return {
    lifeEvent,
    calendarEvent: getCalendarEventById(calendarEvent.id),
    action: "created_from_calendar_event" as const
  };
}

function extractTicketDraft(text: string, originalFileName: string) {
  const haystack = text;
  const flightMatch = haystack.match(/\b([A-Z]{2,3})\s?(\d{2,4})\b/);
  const iataMatches = Array.from(
    new Set(
      (haystack.match(/\b[A-Z]{3}\b/g) ?? []).filter((code) => code !== "PDF")
    )
  );
  const dateMatch = haystack.match(/\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b/);
  const timeMatches = haystack.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/g) ?? [];
  const startsAt =
    dateMatch && timeMatches[0]
      ? new Date(
          `${dateMatch[1].replaceAll("/", "-")}T${timeMatches[0]}:00Z`
        ).toISOString()
      : new Date().toISOString();
  const endsAt =
    dateMatch && timeMatches[1]
      ? new Date(
          `${dateMatch[1].replaceAll("/", "-")}T${timeMatches[1]}:00Z`
        ).toISOString()
      : defaultEndAt(startsAt);
  const carrierCode = flightMatch?.[1] ?? "";
  const serviceNumber = flightMatch?.[2] ?? "";
  const originIata = iataMatches[0] ?? "";
  const destinationIata = iataMatches[1] ?? "";
  const title = flightMatch
    ? `Flight ${carrierCode}${serviceNumber}`
    : originalFileName
        .replace(/\.[^.]+$/, "")
        .replace(/[_-]+/g, " ")
        .trim() || "Travel event";
  return {
    title,
    shortDescription:
      originIata && destinationIata
        ? `${originIata} to ${destinationIata}`
        : "Ticket or travel confirmation draft",
    description:
      "Review the extracted ticket details before saving or projecting to calendar.",
    eventType: "travel_flight" as const,
    transportMode: "plane" as const,
    startsAt,
    endsAt,
    originLabel: originIata,
    destinationLabel: destinationIata,
    extractionSummary: {
      method: "deterministic_ticket_text",
      llmUsed: false,
      extractedCodes: iataMatches,
      flightNumber: flightMatch ? `${carrierCode}${serviceNumber}` : null
    },
    segments: [
      {
        segmentType: "flight" as const,
        transportMode: "plane" as const,
        sequenceIndex: 0,
        title,
        startsAt,
        endsAt,
        originIata,
        originLabel: originIata,
        destinationIata,
        destinationLabel: destinationIata,
        carrierCode,
        serviceNumber,
        status: "scheduled",
        statusSource: "ticket"
      }
    ]
  };
}

export async function importLifeEventTicket(
  input: z.input<typeof lifeEventTicketImportInputSchema>,
  activity?: ActivityContext
) {
  const parsed = lifeEventTicketImportInputSchema.parse(input);
  const trustedContent = await readTrustedArtifactTicketText(
    parsed.artifactId,
    activity ?? { source: "system" }
  );
  if (!trustedContent) {
    return undefined;
  }
  const { artifact, extractedText } = trustedContent;
  const publicArtifact = serializeArtifactPublicPayload(artifact);
  const draft = extractTicketDraft(extractedText, artifact.originalFileName);
  const llmNotice = parsed.useLlm
    ? {
        llmRequested: true,
        llmProfileId: parsed.llmProfileId ?? null,
        llmStatus:
          "not_called_from_agent_route; use configured artifact enrichment or explicit operator-approved LLM extraction"
      }
    : { llmRequested: false };
  const lifeEventInput = {
    ...draft,
    sourceKind: "artifact_ticket" as const,
    sourceArtifactId: artifact.id,
    extractionStatus: parsed.useLlm
      ? ("llm_unavailable" as const)
      : ("drafted" as const),
    extractionSummary: {
      ...draft.extractionSummary,
      artifactId: artifact.id,
      artifactDangerScore: artifact.dangerScore,
      artifactDangerLevel: artifact.dangerLevel,
      ...llmNotice
    },
    metadata: {
      ticketArtifactOriginalFileName: artifact.originalFileName,
      ticketArtifactFormatFamily: artifact.formatFamily
    },
    links: [
      {
        entityType: "artifact",
        entityId: artifact.id,
        relationship: "ticket_artifact"
      }
    ],
    calendarProjection: "link_or_create" as const
  };
  if (!parsed.createDraft) {
    return {
      draft: lifeEventInput,
      artifact: publicArtifact,
      lifeEvent: null,
      action: "drafted_from_ticket" as const
    };
  }
  const lifeEvent = createLifeEvent(lifeEventInput, activity);
  return {
    draft: lifeEventInput,
    artifact: publicArtifact,
    lifeEvent,
    action: "created_draft_from_ticket" as const
  };
}

export function getLifeEventTravelStatus(lifeEventId: string) {
  const event = getLifeEventById(lifeEventId);
  if (!event) {
    return undefined;
  }
  const flightSegment = event.segments.find(
    (segment) => segment.segmentType === "flight"
  );
  const status =
    event.status === "cancelled"
      ? "cancelled"
      : Date.now() < Date.parse(event.startsAt)
        ? "scheduled"
        : Date.now() <= Date.parse(event.endsAt)
          ? "in_progress"
          : "completed";
  return {
    lifeEventId: event.id,
    status,
    source: "scheduled",
    provider: null,
    providerConfigured: false,
    providerOptions: [
      "Lufthansa Open API / SWISS flight status",
      "OpenSky Network ADS-B states",
      "FlightAware AeroAPI",
      "AeroDataBox",
      "Aviationstack",
      "ADS-B Exchange"
    ],
    checkedAt: nowIso(),
    flightNumber: flightSegment
      ? `${flightSegment.carrierCode}${flightSegment.serviceNumber}`.trim() ||
        null
      : null,
    message:
      "Live travel providers are optional. This response uses scheduled Life Event data because no provider is configured."
  };
}
