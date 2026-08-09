import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";

type CalendarLifeEventResponse = {
  action: "created_from_calendar_event" | "already_linked";
  lifeEvent: {
    id: string;
    title: string;
    eventType: string;
    primaryCalendarEventId: string;
    sourceKind: string;
    links: Array<{
      targetEntityType: string;
      targetEntityId: string;
      relationship: string;
    }>;
  };
  calendarEvent: {
    id: string;
    ownership: string;
    title: string;
    startAt: string;
    endAt: string;
    sourceMappings: Array<{
      provider: string;
      recurrenceInstanceId: string | null;
      remoteEtag: string | null;
    }>;
    links: Array<{
      entityType: string;
      entityId: string;
      relationshipType: string;
    }>;
  };
};

test("CAL-09 links one recurring provider occurrence without rewriting provider edits", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-cal-09-"));
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: false,
    devrageMetricSync: false
  });

  try {
    const operatorCookie = issueTestOperatorSessionCookie(app);
    const database = getDatabase();
    const createdAt = "2026-04-15T08:55:00.000Z";
    database
      .prepare(
        `INSERT INTO forge_events (
          id, ownership, origin_type, status, title, description, location,
          start_at, end_at, timezone, is_all_day, availability, event_type,
          categories_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "calevent_provider_occurrence",
        "external",
        "google",
        "confirmed",
        "Recurring provider visit",
        "Imported recurring occurrence",
        "Zurich",
        "2026-04-15T10:00:00.000Z",
        "2026-04-15T11:00:00.000Z",
        "Europe/Zurich",
        0,
        "busy",
        "visit",
        JSON.stringify(["recurring"]),
        createdAt,
        createdAt
      );
    database
      .prepare(
        `INSERT INTO forge_event_sources (
          id, forge_event_id, provider, remote_event_id, remote_uid,
          recurrence_instance_id, is_master_recurring, remote_href,
          remote_etag, sync_state, raw_payload_json, last_synced_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "caleventsource_provider_occurrence",
        "calevent_provider_occurrence",
        "google",
        "remote_recurring_visit_20260415",
        "recurring-visit@example.com",
        "20260415T100000Z",
        0,
        "https://calendar.google.test/event/occurrence",
        '"v1"',
        "synced",
        JSON.stringify({ title: "Recurring provider visit" }),
        createdAt,
        createdAt,
        createdAt
      );
    database
      .prepare(
        `INSERT INTO forge_event_links (
          id, forge_event_id, entity_type, entity_id, relationship_type,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "caleventlink_provider_context",
        "calevent_provider_occurrence",
        "note",
        "note_provider_context",
        "context",
        createdAt,
        createdAt
      );

    const createFromCalendar = () =>
      app.inject({
        method: "POST",
        url: "/api/v1/life-events/from-calendar-event",
        headers: { cookie: operatorCookie },
        payload: {
          calendarEventId: "calevent_provider_occurrence",
          eventType: "visit",
          importance: "meaningful"
        }
      });

    const firstResponse = await createFromCalendar();
    assert.equal(firstResponse.statusCode, 200, firstResponse.body);
    const first = firstResponse.json() as CalendarLifeEventResponse;
    assert.equal(first.action, "created_from_calendar_event");
    assert.equal(first.lifeEvent.eventType, "visit");
    assert.equal(first.lifeEvent.primaryCalendarEventId, first.calendarEvent.id);
    assert.equal(first.lifeEvent.sourceKind, "calendar");
    assert.equal(first.calendarEvent.ownership, "external");
    assert.ok(
      first.lifeEvent.links.some(
        (link) =>
          link.targetEntityType === "calendar_event" &&
          link.targetEntityId === "calevent_provider_occurrence" &&
          link.relationship === "primary_calendar_projection"
      )
    );
    assert.ok(
      first.calendarEvent.links.some(
        (link) =>
          link.entityType === "life_event" &&
          link.entityId === first.lifeEvent.id &&
          link.relationshipType === "life_event"
      )
    );
    assert.ok(
      first.calendarEvent.links.some(
        (link) =>
          link.entityType === "note" &&
          link.entityId === "note_provider_context" &&
          link.relationshipType === "context"
      )
    );
    assert.deepEqual(
      first.calendarEvent.sourceMappings.map((source) => ({
        provider: source.provider,
        recurrenceInstanceId: source.recurrenceInstanceId,
        remoteEtag: source.remoteEtag
      })),
      [
        {
          provider: "google",
          recurrenceInstanceId: "20260415T100000Z",
          remoteEtag: '"v1"'
        }
      ]
    );

    const repeatedResponse = await createFromCalendar();
    assert.equal(repeatedResponse.statusCode, 200);
    const repeated = repeatedResponse.json() as CalendarLifeEventResponse;
    assert.equal(repeated.action, "already_linked");
    assert.equal(repeated.lifeEvent.id, first.lifeEvent.id);
    assert.equal(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM life_events
             WHERE primary_calendar_event_id = ?`
          )
          .get("calevent_provider_occurrence") as { count: number }
      ).count,
      1
    );

    const providerUpdatedAt = "2026-04-15T09:15:00.000Z";
    database
      .prepare(
        `UPDATE forge_events
         SET title = ?, start_at = ?, end_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        "Provider-updated recurring visit",
        "2026-04-15T10:30:00.000Z",
        "2026-04-15T11:30:00.000Z",
        providerUpdatedAt,
        "calevent_provider_occurrence"
      );
    database
      .prepare(
        `UPDATE forge_event_sources
         SET remote_etag = ?, raw_payload_json = ?, last_synced_at = ?, updated_at = ?
         WHERE forge_event_id = ?`
      )
      .run(
        '"v2"',
        JSON.stringify({ title: "Provider-updated recurring visit" }),
        providerUpdatedAt,
        providerUpdatedAt,
        "calevent_provider_occurrence"
      );

    const afterProviderEditResponse = await createFromCalendar();
    assert.equal(afterProviderEditResponse.statusCode, 200);
    const afterProviderEdit =
      afterProviderEditResponse.json() as CalendarLifeEventResponse;
    assert.equal(afterProviderEdit.action, "already_linked");
    assert.equal(afterProviderEdit.lifeEvent.id, first.lifeEvent.id);
    assert.equal(afterProviderEdit.lifeEvent.title, "Recurring provider visit");
    assert.equal(
      afterProviderEdit.calendarEvent.title,
      "Provider-updated recurring visit"
    );
    assert.equal(
      afterProviderEdit.calendarEvent.startAt,
      "2026-04-15T10:30:00.000Z"
    );
    assert.equal(
      afterProviderEdit.calendarEvent.endAt,
      "2026-04-15T11:30:00.000Z"
    );
    assert.equal(
      afterProviderEdit.calendarEvent.sourceMappings[0]?.remoteEtag,
      '"v2"'
    );
    assert.equal(afterProviderEdit.calendarEvent.ownership, "external");
    assert.equal(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM life_events
             WHERE primary_calendar_event_id = ?`
          )
          .get("calevent_provider_occurrence") as { count: number }
      ).count,
      1
    );
    assert.equal(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM forge_event_links
             WHERE forge_event_id = ?
               AND entity_type = 'life_event'
               AND entity_id = ?
               AND relationship_type = 'life_event'`
          )
          .get("calevent_provider_occurrence", first.lifeEvent.id) as {
          count: number;
        }
      ).count,
      1
    );
    assert.equal(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM forge_event_links
             WHERE forge_event_id = ?
               AND entity_type = 'note'
               AND entity_id = 'note_provider_context'
               AND relationship_type = 'context'`
          )
          .get("calevent_provider_occurrence") as { count: number }
      ).count,
      1
    );
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
