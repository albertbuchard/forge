import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";

async function issueOperatorSessionCookie(
  app: Awaited<ReturnType<typeof buildServer>>
) {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/auth/operator-session",
    headers: { host: "127.0.0.1:4317" }
  });
  assert.equal(response.statusCode, 200);
  const cookie = response.cookies[0];
  assert.ok(cookie);
  return `${cookie.name}=${cookie.value}`;
}

test("life_event batch create, update, link search, calendar sync, and ticket import work", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-life-events-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const snapshotResponse = await app.inject({
      method: "GET",
      url: "/api/v1/context"
    });
    assert.equal(snapshotResponse.statusCode, 200);
    const snapshot = snapshotResponse.json() as {
      goals: Array<{ id: string }>;
    };
    const goalId = snapshot.goals[0]!.id;

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie: operatorCookie },
      payload: {
        atomic: true,
        operations: [
          {
            entityType: "life_event",
            clientRef: "flight-a",
            data: {
              title: "Flight to Paris",
              shortDescription: "Family visit",
              description: "Going to see grandmother in Paris.",
              eventType: "travel_flight",
              importance: "major",
              startsAt: "2026-08-01T07:30:00.000Z",
              endsAt: "2026-08-01T09:10:00.000Z",
              timezone: "Europe/Zurich",
              placeLabel: "Paris",
              originLabel: "Zurich Airport",
              originCity: "Zurich",
              originCountry: "Switzerland",
              destinationLabel: "Paris Charles de Gaulle",
              destinationCity: "Paris",
              destinationCountry: "France",
              transportMode: "plane",
              calendarProjection: "none",
              links: [
                {
                  entityType: "goal",
                  entityId: goalId,
                  relationship: "context"
                }
              ],
              segments: [
                {
                  segmentType: "flight",
                  transportMode: "plane",
                  title: "LX638",
                  startsAt: "2026-08-01T07:30:00.000Z",
                  endsAt: "2026-08-01T09:10:00.000Z",
                  originLabel: "Zurich Airport",
                  originIata: "ZRH",
                  destinationLabel: "Paris Charles de Gaulle",
                  destinationIata: "CDG",
                  carrierCode: "LX",
                  serviceNumber: "638"
                }
              ]
            }
          }
        ]
      }
    });
    assert.equal(createResponse.statusCode, 200);
    const createdResult = (createResponse.json() as {
      results: Array<{
        ok: boolean;
        id: string;
        entity: {
          id: string;
          title: string;
          primaryCalendarEventId: string | null;
          links: Array<{
            targetEntityType: string;
            targetEntityId: string;
            relationship: string;
          }>;
        };
      }>;
    }).results[0]!;
    assert.equal(createdResult.ok, true);
    assert.equal(createdResult.entity.title, "Flight to Paris");
    assert.equal(createdResult.entity.primaryCalendarEventId, null);
    assert.ok(
      createdResult.entity.links.some(
        (link) =>
          link.targetEntityType === "goal" &&
          link.targetEntityId === goalId &&
          link.relationship === "context"
      )
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
            id: createdResult.id,
            patch: {
              title: "Flight to Paris CDG",
              destinationLabel: "CDG Terminal 2",
              metadata: { checkedBy: "life-events-test" },
              links: [
                {
                  entityType: "goal",
                  entityId: goalId,
                  relationship: "trip_context"
                }
              ]
            }
          }
        ]
      }
    });
    assert.equal(updateResponse.statusCode, 200);
    const updated = (updateResponse.json() as {
      results: Array<{
        ok: boolean;
        entity: {
          title: string;
          destinationLabel: string;
          metadata: Record<string, unknown>;
          links: Array<{ targetEntityType: string; relationship: string }>;
        };
      }>;
    }).results[0]!;
    assert.equal(updated.ok, true);
    assert.equal(updated.entity.title, "Flight to Paris CDG");
    assert.equal(updated.entity.destinationLabel, "CDG Terminal 2");
    assert.equal(updated.entity.metadata.checkedBy, "life-events-test");
    assert.ok(
      updated.entity.links.some(
        (link) =>
          link.targetEntityType === "goal" &&
          link.relationship === "trip_context"
      )
    );

    const periodCreateResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie: operatorCookie },
      payload: {
        atomic: true,
        operations: [
          {
            entityType: "life_event",
            clientRef: "long-stay",
            data: {
              title: "Summer stay in Lisbon",
              shortDescription: "Working from Portugal for the summer.",
              eventType: "stay",
              importance: "major",
              startsAt: "2026-06-01T10:00:00.000Z",
              endsAt: "2026-09-01T09:00:00.000Z",
              timezone: "Europe/Lisbon",
              placeLabel: "Lisbon",
              calendarProjection: "none"
            }
          }
        ]
      }
    });
    assert.equal(periodCreateResponse.statusCode, 200);
    const periodCreated = (periodCreateResponse.json() as {
      results: Array<{
        ok: boolean;
        id: string;
        entity: {
          eventType: string;
          startsAt: string;
          endsAt: string;
        };
      }>;
    }).results[0]!;
    assert.equal(periodCreated.ok, true);
    assert.equal(periodCreated.entity.eventType, "stay");
    assert.equal(periodCreated.entity.startsAt, "2026-06-01T10:00:00.000Z");
    assert.equal(periodCreated.entity.endsAt, "2026-09-01T09:00:00.000Z");

    const invalidIntervalResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie: operatorCookie },
      payload: {
        atomic: true,
        operations: [
          {
            entityType: "life_event",
            data: {
              title: "Broken festival",
              eventType: "festival",
              startsAt: "2026-08-04T10:00:00.000Z",
              endsAt: "2026-08-03T10:00:00.000Z",
              calendarProjection: "none"
            }
          }
        ]
      }
    });
    assert.equal(invalidIntervalResponse.statusCode, 200);
    const invalidIntervalBody = invalidIntervalResponse.json() as {
      results: Array<{
        ok: boolean;
        error?: {
          issues?: Array<{ path: string; message: string; code: string }>;
        };
      }>;
    };
    assert.equal(invalidIntervalBody.results[0]!.ok, false);
    assert.deepEqual(
      invalidIntervalBody.results[0]!.error?.issues?.[0],
      {
        path: "endsAt",
        message: "endsAt must be after startsAt",
        code: "custom"
      }
    );

    const searchResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/search",
      headers: { cookie: operatorCookie },
      payload: {
        searches: [
          {
            entityTypes: ["life_event"],
            linkedTo: { entityType: "goal", id: goalId },
            limit: 10
          }
        ]
      }
    });
    assert.equal(searchResponse.statusCode, 200);
    const matches = (searchResponse.json() as {
      results: Array<{ matches: Array<{ id: string }> }>;
    }).results[0]!.matches;
    assert.ok(matches.some((match) => match.id === createdResult.id));

    const syncResponse = await app.inject({
      method: "POST",
      url: `/api/v1/life-events/${createdResult.id}/calendar-sync`,
      headers: { cookie: operatorCookie },
      payload: { projection: "link_or_create" }
    });
    assert.equal(syncResponse.statusCode, 200);
    const syncBody = syncResponse.json() as {
      action: string;
      lifeEvent: {
        id: string;
        primaryCalendarEventId: string | null;
        calendarSyncState: string;
        links: Array<{ targetEntityType: string; relationship: string }>;
      };
      calendarEvent: {
        id: string;
        links: Array<{ entityType: string; entityId: string }>;
      };
    };
    assert.equal(syncBody.action, "created_calendar_event");
    assert.equal(
      syncBody.lifeEvent.primaryCalendarEventId,
      syncBody.calendarEvent.id
    );
    assert.equal(syncBody.lifeEvent.calendarSyncState, "created");
    assert.ok(
      syncBody.lifeEvent.links.some(
        (link) =>
          link.targetEntityType === "calendar_event" &&
          link.relationship === "primary_calendar_projection"
      )
    );
    assert.ok(
      syncBody.calendarEvent.links.some(
        (link) =>
          link.entityType === "life_event" && link.entityId === createdResult.id
      )
    );

    const periodSyncResponse = await app.inject({
      method: "POST",
      url: `/api/v1/life-events/${periodCreated.id}/calendar-sync`,
      headers: { cookie: operatorCookie },
      payload: { projection: "link_or_create" }
    });
    assert.equal(periodSyncResponse.statusCode, 200);
    const periodSyncBody = periodSyncResponse.json() as {
      calendarEvent: { startAt: string; endAt: string };
      lifeEvent: { calendarSyncState: string };
    };
    assert.equal(periodSyncBody.lifeEvent.calendarSyncState, "created");
    assert.equal(periodSyncBody.calendarEvent.startAt, "2026-06-01T10:00:00.000Z");
    assert.equal(periodSyncBody.calendarEvent.endAt, "2026-09-01T09:00:00.000Z");

    const calendarCreated = await app.inject({
      method: "POST",
      url: "/api/v1/calendar/events",
      headers: { cookie: operatorCookie },
      payload: {
        title: "Cinema night",
        startAt: "2026-08-02T18:00:00.000Z",
        endAt: "2026-08-02T20:30:00.000Z",
        timezone: "Europe/Zurich"
      }
    });
    assert.equal(calendarCreated.statusCode, 201);
    const calendarEvent = (calendarCreated.json() as {
      event: { id: string };
    }).event;
    const fromCalendarResponse = await app.inject({
      method: "POST",
      url: "/api/v1/life-events/from-calendar-event",
      headers: { cookie: operatorCookie },
      payload: {
        calendarEventId: calendarEvent.id,
        eventType: "cinema"
      }
    });
    assert.equal(fromCalendarResponse.statusCode, 200);
    const fromCalendarBody = fromCalendarResponse.json() as {
      action: string;
      lifeEvent: { eventType: string; primaryCalendarEventId: string };
    };
    assert.equal(fromCalendarBody.action, "created_from_calendar_event");
    assert.equal(fromCalendarBody.lifeEvent.eventType, "cinema");
    assert.equal(fromCalendarBody.lifeEvent.primaryCalendarEventId, calendarEvent.id);

    const uploadResponse = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: { cookie: operatorCookie },
      payload: {
        title: "LX638 ticket",
        originalFileName: "LX638-ZRH-CDG-ticket.txt",
        declaredMimeType: "text/plain",
        contentBase64: Buffer.from(
          "Flight LX638 ZRH CDG 2026-08-01 07:30 09:10",
          "utf8"
        ).toString("base64"),
        sourceLabel: "Life Events ticket test"
      }
    });
    assert.equal(uploadResponse.statusCode, 201);
    const artifact = (uploadResponse.json() as { artifact: { id: string } }).artifact;
    const ticketResponse = await app.inject({
      method: "POST",
      url: "/api/v1/life-events/import-ticket",
      headers: { cookie: operatorCookie },
      payload: {
        artifactId: artifact.id,
        createDraft: true,
        useLlm: false
      }
    });
    assert.equal(ticketResponse.statusCode, 200);
    const ticketBody = ticketResponse.json() as {
      action: string;
      lifeEvent: {
        id: string;
        eventType: string;
        sourceArtifactId: string;
        links: Array<{ targetEntityType: string; relationship: string }>;
      };
    };
    assert.equal(ticketBody.action, "created_draft_from_ticket");
    assert.equal(ticketBody.lifeEvent.eventType, "travel_flight");
    assert.equal(ticketBody.lifeEvent.sourceArtifactId, artifact.id);
    assert.ok(
      ticketBody.lifeEvent.links.some(
        (link) =>
          link.targetEntityType === "artifact" &&
          link.relationship === "ticket_artifact"
      )
    );

    const timelineResponse = await app.inject({
      method: "GET",
      url: "/api/v1/life-events/timeline?limit=50",
      headers: { cookie: operatorCookie }
    });
    assert.equal(timelineResponse.statusCode, 200);
    const timeline = timelineResponse.json() as {
      timeline: {
        events: Array<{ id: string }>;
        nextLifeEventId: string | null;
      };
    };
    assert.ok(
      timeline.timeline.events.some((event) => event.id === createdResult.id)
    );
    assert.ok(
      timeline.timeline.events.some((event) => event.id === periodCreated.id)
    );
    assert.equal(typeof timeline.timeline.nextLifeEventId, "string");
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
