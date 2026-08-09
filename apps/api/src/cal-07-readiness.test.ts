import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import { lifeEventTypeSchema } from "./types.js";

const EXPECTED_LIFE_EVENT_TYPES = [
  "travel_flight",
  "travel_train",
  "travel_car",
  "travel_boat",
  "travel_trip",
  "travel_day",
  "stay",
  "lodging",
  "holiday",
  "vacation",
  "visit",
  "move",
  "festival",
  "conference",
  "retreat",
  "concert",
  "cinema",
  "meal",
  "party",
  "ceremony",
  "date",
  "friends",
  "family",
  "work_milestone",
  "work_phase",
  "thesis_milestone",
  "creative_work",
  "class_course",
  "exam",
  "deadline",
  "medical",
  "health_episode",
  "therapy",
  "administrative",
  "legal_financial",
  "errand",
  "celebration",
  "memory",
  "custom"
] as const;

test("CAL-07 keeps the complete Life Event type contract", () => {
  assert.deepEqual(lifeEventTypeSchema.options, EXPECTED_LIFE_EVENT_TYPES);
  assert.equal(lifeEventTypeSchema.options.length, 39);
});

test("CAL-07 reads an unknown legacy type as Custom without losing its source value", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-cal-07-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: false });

  try {
    const operatorCookie = issueTestOperatorSessionCookie(app);
    const timestamp = "2026-08-09T12:00:00.000Z";
    getDatabase()
      .prepare(
        `INSERT INTO life_events (
          id, title, event_type, starts_at, ends_at, timezone,
          metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "lifeevent_legacy_community",
        "Legacy community gathering",
        "community_hackathon",
        "2026-09-01T17:00:00.000Z",
        "2026-09-01T21:00:00.000Z",
        "Europe/Zurich",
        JSON.stringify({ importedFrom: "legacy-fixture" }),
        timestamp,
        timestamp
      );

    const readResponse = await app.inject({
      method: "GET",
      url: "/api/v1/life-events/lifeevent_legacy_community",
      headers: { cookie: operatorCookie }
    });
    assert.equal(readResponse.statusCode, 200);
    const readEvent = (
      readResponse.json() as {
        lifeEvent: {
          eventType: string;
          metadata: Record<string, unknown>;
        };
      }
    ).lifeEvent;
    assert.equal(readEvent.eventType, "custom");
    assert.deepEqual(readEvent.metadata, {
      importedFrom: "legacy-fixture",
      legacyEventType: "community_hackathon"
    });

    const timelineResponse = await app.inject({
      method: "GET",
      url: "/api/v1/life-events/timeline?q=Legacy%20community&limit=10",
      headers: { cookie: operatorCookie }
    });
    assert.equal(timelineResponse.statusCode, 200);
    const timelineEvents = (
      timelineResponse.json() as {
        timeline: {
          events: Array<{
            id: string;
            eventType: string;
            metadata: Record<string, unknown>;
          }>;
        };
      }
    ).timeline.events;
    assert.deepEqual(
      timelineEvents.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        legacyEventType: event.metadata.legacyEventType
      })),
      [
        {
          id: "lifeevent_legacy_community",
          eventType: "custom",
          legacyEventType: "community_hackathon"
        }
      ]
    );

    const updateResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/update",
      headers: { cookie: operatorCookie },
      payload: {
        atomic: true,
        operations: [
          {
            entityType: "life_event",
            id: "lifeevent_legacy_community",
            patch: { title: "Community gathering" }
          }
        ]
      }
    });
    assert.equal(updateResponse.statusCode, 200);
    const updatedResult = (
      updateResponse.json() as {
        results: Array<{
          ok: boolean;
          entity: {
            eventType: string;
            metadata: Record<string, unknown>;
          };
        }>;
      }
    ).results[0]!;
    assert.equal(updatedResult.ok, true);
    assert.equal(updatedResult.entity.eventType, "custom");
    assert.equal(
      updatedResult.entity.metadata.legacyEventType,
      "community_hackathon"
    );

    const stored = getDatabase()
      .prepare(
        "SELECT event_type, metadata_json FROM life_events WHERE id = ?"
      )
      .get("lifeevent_legacy_community") as {
      event_type: string;
      metadata_json: string;
    };
    assert.equal(stored.event_type, "custom");
    assert.deepEqual(JSON.parse(stored.metadata_json), {
      importedFrom: "legacy-fixture",
      legacyEventType: "community_hackathon"
    });
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
