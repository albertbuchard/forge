import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";

const issueOperatorSessionCookie = issueTestOperatorSessionCookie;

test("life_event batch create, update, link search, calendar sync, and ticket import work", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-life-events-"));
  const app = await buildServer({ dataRoot: rootDir, seedDemoData: true });

  try {
    const operatorCookie = await issueOperatorSessionCookie(app);
    const snapshotResponse = await app.inject({
      method: "GET",
      url: "/api/v1/context",
      headers: { cookie: operatorCookie }
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
    const createdResult = (
      createResponse.json() as {
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
      }
    ).results[0]!;
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
    const updated = (
      updateResponse.json() as {
        results: Array<{
          ok: boolean;
          entity: {
            title: string;
            destinationLabel: string;
            metadata: Record<string, unknown>;
            links: Array<{ targetEntityType: string; relationship: string }>;
          };
        }>;
      }
    ).results[0]!;
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
    const periodCreated = (
      periodCreateResponse.json() as {
        results: Array<{
          ok: boolean;
          id: string;
          entity: {
            eventType: string;
            startsAt: string;
            endsAt: string;
          };
        }>;
      }
    ).results[0]!;
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
    assert.deepEqual(invalidIntervalBody.results[0]!.error?.issues?.[0], {
      path: "endsAt",
      message: "endsAt must be after startsAt",
      code: "custom"
    });

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
    const matches = (
      searchResponse.json() as {
        results: Array<{ matches: Array<{ id: string }> }>;
      }
    ).results[0]!.matches;
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
    assert.equal(
      periodSyncBody.calendarEvent.startAt,
      "2026-06-01T10:00:00.000Z"
    );
    assert.equal(
      periodSyncBody.calendarEvent.endAt,
      "2026-09-01T09:00:00.000Z"
    );

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
    const calendarEvent = (
      calendarCreated.json() as {
        event: { id: string };
      }
    ).event;
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
    assert.equal(
      fromCalendarBody.lifeEvent.primaryCalendarEventId,
      calendarEvent.id
    );

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
    const artifact = (uploadResponse.json() as { artifact: { id: string } })
      .artifact;
    const ticketPreviewResponse = await app.inject({
      method: "POST",
      url: "/api/v1/life-events/import-ticket",
      headers: { cookie: operatorCookie },
      payload: {
        artifactId: artifact.id,
        createDraft: false,
        useLlm: false
      }
    });
    assert.equal(
      ticketPreviewResponse.statusCode,
      200,
      ticketPreviewResponse.body
    );
    const previewFingerprint = (
      ticketPreviewResponse.json() as { previewFingerprint: string }
    ).previewFingerprint;
    const ticketResponse = await app.inject({
      method: "POST",
      url: "/api/v1/life-events/import-ticket",
      headers: { cookie: operatorCookie },
      payload: {
        artifactId: artifact.id,
        createDraft: true,
        useLlm: false,
        previewFingerprint
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
        total: number;
        counts: { past: number; current: number; upcoming: number };
      };
    };
    assert.ok(
      timeline.timeline.events.some((event) => event.id === createdResult.id)
    );
    assert.ok(
      timeline.timeline.events.some((event) => event.id === periodCreated.id)
    );
    assert.equal(typeof timeline.timeline.nextLifeEventId, "string");
    assert.equal(
      timeline.timeline.counts.past +
        timeline.timeline.counts.current +
        timeline.timeline.counts.upcoming,
      timeline.timeline.total
    );

    const segmentSearchResponse = await app.inject({
      method: "GET",
      url: "/api/v1/life-events/timeline?q=LX638&limit=10",
      headers: { cookie: operatorCookie }
    });
    assert.equal(segmentSearchResponse.statusCode, 200);
    const segmentSearch = segmentSearchResponse.json() as {
      timeline: { events: Array<{ id: string }>; total: number };
    };
    assert.ok(segmentSearch.timeline.total >= 1);
    assert.ok(
      segmentSearch.timeline.events.some(
        (event) => event.id === createdResult.id
      )
    );

    const literalWildcardResponse = await app.inject({
      method: "GET",
      url: "/api/v1/life-events/timeline?q=%25&limit=10",
      headers: { cookie: operatorCookie }
    });
    assert.equal(literalWildcardResponse.statusCode, 200);
    assert.equal(
      (literalWildcardResponse.json() as { timeline: { total: number } })
        .timeline.total,
      0
    );

    const boundedTimelineResponse = await app.inject({
      method: "GET",
      url: "/api/v1/life-events/timeline?limit=1&offset=0",
      headers: { cookie: operatorCookie }
    });
    assert.equal(boundedTimelineResponse.statusCode, 200);
    const boundedTimeline = boundedTimelineResponse.json() as {
      timeline: {
        events: Array<{ id: string }>;
        total: number;
        hasMore: boolean;
        limit: number;
        offset: number;
      };
    };
    assert.equal(boundedTimeline.timeline.events.length, 1);
    assert.ok(boundedTimeline.timeline.total >= 3);
    assert.equal(boundedTimeline.timeline.hasMore, true);
    assert.equal(boundedTimeline.timeline.limit, 1);
    assert.equal(boundedTimeline.timeline.offset, 0);

    const searchedTimelineResponse = await app.inject({
      method: "GET",
      url: "/api/v1/life-events/timeline?q=Lisbon&limit=1&offset=0",
      headers: { cookie: operatorCookie }
    });
    assert.equal(searchedTimelineResponse.statusCode, 200);
    const searchedTimeline = searchedTimelineResponse.json() as {
      timeline: {
        events: Array<{ id: string; title: string }>;
        total: number;
        hasMore: boolean;
      };
    };
    assert.equal(searchedTimeline.timeline.total, 1);
    assert.equal(searchedTimeline.timeline.hasMore, false);
    assert.equal(searchedTimeline.timeline.events.length, 1);
    assert.equal(searchedTimeline.timeline.events[0]?.id, periodCreated.id);
    assert.equal(
      searchedTimeline.timeline.events[0]?.title,
      "Summer stay in Lisbon"
    );

    const tiedCreateResponse = await app.inject({
      method: "POST",
      url: "/api/v1/entities/create",
      headers: { cookie: operatorCookie },
      payload: {
        atomic: true,
        operations: ["A", "B"].map((suffix) => ({
          entityType: "life_event",
          data: {
            title: `Tied event ${suffix}`,
            eventType: "custom",
            startsAt: "2027-01-01T10:00:00.000Z",
            endsAt: "2027-01-01T11:00:00.000Z",
            calendarProjection: "none"
          }
        }))
      }
    });
    assert.equal(tiedCreateResponse.statusCode, 200);
    const tiedIds = (
      tiedCreateResponse.json() as { results: Array<{ id: string }> }
    ).results.map((result) => result.id);
    getDatabase()
      .prepare(
        `UPDATE life_events
         SET created_at = '2026-07-01T00:00:00.000Z'
         WHERE id IN (?, ?)`
      )
      .run(...tiedIds);
    const tiedPages = await Promise.all(
      [0, 1].map((offset) =>
        app.inject({
          method: "GET",
          url: `/api/v1/life-events/timeline?q=Tied%20event&limit=1&offset=${offset}`,
          headers: { cookie: operatorCookie }
        })
      )
    );
    const pagedTiedIds = tiedPages.map(
      (response) =>
        (
          response.json() as {
            timeline: { events: Array<{ id: string }> };
          }
        ).timeline.events[0]!.id
    );
    assert.deepEqual(pagedTiedIds, [...tiedIds].sort());
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
