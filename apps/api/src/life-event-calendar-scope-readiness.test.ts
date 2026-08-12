import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildServer } from "./app.js";
import { closeDatabase } from "./db.js";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  getCalendarEventById
} from "./repositories/calendar.js";
import { createGoal } from "./repositories/goals.js";
import {
  createLifeEvent,
  getLifeEventById
} from "./repositories/life-events.js";
import { createProject } from "./repositories/projects.js";
import { createAgentToken } from "./repositories/settings.js";
import { createTag, deleteTag } from "./repositories/tags.js";
import { createUser } from "./repositories/users.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import { createAgentTokenSchema } from "./types.js";

type TestApp = Awaited<ReturnType<typeof buildServer>>;

async function withIsolatedForge(run: (app: TestApp) => Promise<void>) {
  const dataRoot = await mkdtemp(
    path.join(os.tmpdir(), "forge-life-event-calendar-scope-")
  );
  const app = await buildServer({
    dataRoot,
    seedDemoData: false,
    devrageMetricSync: false
  });
  try {
    await run(app);
  } finally {
    await app.close();
    closeDatabase();
    await rm(dataRoot, { recursive: true, force: true });
  }
}

function createPlanningFixture(label: string) {
  const user = createUser({
    kind: "human",
    handle: `calendar-scope-${label}`,
    displayName: `Calendar scope ${label}`,
    description: "",
    accentColor: "#336699"
  });
  const tag = createTag({
    name: `calendar-scope-${label}`,
    kind: "execution",
    color: "#336699",
    description: "",
    userId: user.id
  });
  const goal = createGoal({
    title: `Calendar scope ${label}`,
    description: "",
    horizon: "year",
    status: "active",
    targetPoints: 200,
    themeColor: "#336699",
    userId: user.id,
    tagIds: [tag.id],
    notes: []
  });
  const project = createProject({
    goalId: goal.id,
    title: `Calendar scope project ${label}`,
    userId: user.id
  });
  return { user, tag, goal, project };
}

function createScopedLifeEvent(input: {
  title: string;
  userId: string;
  links: Array<{
    entityType: string;
    entityId: string;
    relationship: string;
  }>;
}) {
  return createLifeEvent({
    title: input.title,
    startsAt: "2035-04-15T08:00:00.000Z",
    endsAt: "2035-04-15T09:00:00.000Z",
    timezone: "Europe/Zurich",
    userId: input.userId,
    links: input.links,
    calendarProjection: "none"
  });
}

function calendarPlace(label: string) {
  return {
    label,
    address: "",
    timezone: "Europe/Zurich",
    latitude: null,
    longitude: null,
    source: "scope_test",
    externalPlaceId: ""
  };
}

function issueScopedToken(input: {
  userId: string;
  projectIds?: string[];
  tagIds?: string[];
}) {
  return createAgentToken(
    createAgentTokenSchema.parse({
      label: "Life Event calendar scope token",
      agentLabel: "Life Event calendar scope agent",
      scopes: ["*"],
      scopePolicy: {
        userIds: [input.userId],
        projectIds: input.projectIds ?? [],
        tagIds: input.tagIds ?? []
      }
    }),
    { actor: "Life Event scope test", source: "system" }
  ).token;
}

test("Life Event calendar routes enforce scope before counts, reads, and actions", async () => {
  await withIsolatedForge(async (app) => {
    const allowed = createPlanningFixture("allowed");
    const foreign = createPlanningFixture("foreign");
    const allowedLifeEvent = createScopedLifeEvent({
      title: "Allowed unprojected milestone",
      userId: allowed.user.id,
      links: [
        {
          entityType: "project",
          entityId: allowed.project.id,
          relationship: "project_context"
        },
        {
          entityType: "project",
          entityId: foreign.project.id,
          relationship: "private_context"
        }
      ]
    });
    const foreignLifeEvent = createScopedLifeEvent({
      title: "Foreign milestone",
      userId: foreign.user.id,
      links: [
        {
          entityType: "project",
          entityId: foreign.project.id,
          relationship: "project_context"
        }
      ]
    });
    const token = issueScopedToken({
      userId: allowed.user.id,
      projectIds: [allowed.project.id]
    });
    const headers = { authorization: `Bearer ${token}` };

    const timeline = await app.inject({
      method: "GET",
      url: "/api/v1/life-events/timeline?from=2035-04-01T00%3A00%3A00.000Z&to=2035-04-30T23%3A59%3A59.999Z&limit=1",
      headers
    });
    assert.equal(timeline.statusCode, 200, timeline.body);
    const timelineBody = timeline.json() as {
      timeline: {
        events: Array<{
          id: string;
          links: Array<{
            targetEntityType: string;
            targetEntityId: string;
          }>;
          unavailableLinkCount: number;
        }>;
        total: number;
        hasMore: boolean;
        nextLifeEventId: string | null;
        counts: { upcoming: number };
      };
    };
    assert.deepEqual(
      timelineBody.timeline.events.map((event) => event.id),
      [allowedLifeEvent.id]
    );
    assert.equal(timelineBody.timeline.total, 1);
    assert.equal(timelineBody.timeline.hasMore, false);
    assert.equal(timelineBody.timeline.nextLifeEventId, allowedLifeEvent.id);
    assert.equal(timelineBody.timeline.counts.upcoming, 1);
    assert.deepEqual(
      timelineBody.timeline.events[0]?.links.map((link) => ({
        entityType: link.targetEntityType,
        entityId: link.targetEntityId
      })),
      [{ entityType: "project", entityId: allowed.project.id }]
    );
    assert.equal(timelineBody.timeline.events[0]?.unavailableLinkCount, 1);

    const allowedRead = await app.inject({
      method: "GET",
      url: `/api/v1/life-events/${allowedLifeEvent.id}`,
      headers
    });
    assert.equal(allowedRead.statusCode, 200, allowedRead.body);
    assert.equal(
      (allowedRead.json() as { lifeEvent: { unavailableLinkCount: number } })
        .lifeEvent.unavailableLinkCount,
      1
    );

    for (const request of [
      {
        method: "GET",
        url: `/api/v1/life-events/${foreignLifeEvent.id}`
      },
      {
        method: "GET",
        url: `/api/v1/life-events/${foreignLifeEvent.id}/travel-status`
      },
      {
        method: "POST",
        url: `/api/v1/life-events/${foreignLifeEvent.id}/calendar-sync`,
        payload: { projection: "link_or_create" }
      }
    ] as const) {
      const response = await app.inject({ ...request, headers });
      assert.equal(response.statusCode, 404, response.body);
    }
    assert.equal(
      getLifeEventById(foreignLifeEvent.id)?.primaryCalendarEventId,
      null
    );

    const allowedCalendarEvent = createCalendarEvent({
      title: "Allowed provider-independent event",
      description: "",
      location: "Zurich",
      place: calendarPlace("Zurich"),
      startAt: "2035-04-16T08:00:00.000Z",
      endAt: "2035-04-16T09:00:00.000Z",
      timezone: "Europe/Zurich",
      isAllDay: false,
      availability: "busy",
      eventType: "meeting",
      categories: [],
      userId: allowed.user.id,
      links: [
        {
          entityType: "project",
          entityId: allowed.project.id,
          relationshipType: "project_context"
        }
      ]
    });
    const foreignCalendarEvent = createCalendarEvent({
      title: "Foreign calendar event",
      description: "",
      location: "Geneva",
      place: calendarPlace("Geneva"),
      startAt: "2035-04-17T08:00:00.000Z",
      endAt: "2035-04-17T09:00:00.000Z",
      timezone: "Europe/Zurich",
      isAllDay: false,
      availability: "busy",
      eventType: "meeting",
      categories: [],
      userId: foreign.user.id,
      links: [
        {
          entityType: "project",
          entityId: foreign.project.id,
          relationshipType: "project_context"
        }
      ]
    });
    const allowedLifeEventWithForeignProjection = createLifeEvent({
      title: "Allowed milestone with a foreign projection",
      startsAt: foreignCalendarEvent.startAt,
      endsAt: foreignCalendarEvent.endAt,
      timezone: foreignCalendarEvent.timezone,
      primaryCalendarEventId: foreignCalendarEvent.id,
      sourceKind: "calendar",
      userId: allowed.user.id,
      links: [
        {
          entityType: "project",
          entityId: allowed.project.id,
          relationship: "project_context"
        },
        {
          entityType: "calendar_event",
          entityId: foreignCalendarEvent.id,
          relationship: "primary_calendar_projection"
        }
      ],
      calendarProjection: "none"
    });
    const projectedRead = await app.inject({
      method: "GET",
      url: `/api/v1/life-events/${allowedLifeEventWithForeignProjection.id}`,
      headers
    });
    assert.equal(projectedRead.statusCode, 200, projectedRead.body);
    assert.equal(
      (
        projectedRead.json() as {
          lifeEvent: { primaryCalendarEventId: string | null };
        }
      ).lifeEvent.primaryCalendarEventId,
      null
    );
    const foreignTitleBeforeSync = getCalendarEventById(
      foreignCalendarEvent.id
    )?.title;
    const repairedProjection = await app.inject({
      method: "POST",
      url: `/api/v1/life-events/${allowedLifeEventWithForeignProjection.id}/calendar-sync`,
      headers,
      payload: { projection: "link_or_create" }
    });
    assert.equal(repairedProjection.statusCode, 200, repairedProjection.body);
    const repairedProjectionBody = repairedProjection.json() as {
      lifeEvent: { primaryCalendarEventId: string | null };
      calendarEvent: {
        id: string;
        userId: string | null;
        links: Array<{ entityType: string; entityId: string }>;
      };
    };
    assert.notEqual(
      repairedProjectionBody.calendarEvent.id,
      foreignCalendarEvent.id
    );
    assert.equal(repairedProjectionBody.calendarEvent.userId, allowed.user.id);
    assert.ok(
      repairedProjectionBody.calendarEvent.links.some(
        (link) =>
          link.entityType === "project" && link.entityId === allowed.project.id
      )
    );
    assert.equal(
      getCalendarEventById(foreignCalendarEvent.id)?.title,
      foreignTitleBeforeSync
    );
    const createdFromCalendar = await app.inject({
      method: "POST",
      url: "/api/v1/life-events/from-calendar-event",
      headers,
      payload: { calendarEventId: allowedCalendarEvent.id }
    });
    assert.equal(createdFromCalendar.statusCode, 200, createdFromCalendar.body);
    const createdLifeEvent = (
      createdFromCalendar.json() as {
        lifeEvent: {
          id: string;
          links: Array<{
            targetEntityType: string;
            targetEntityId: string;
          }>;
        };
      }
    ).lifeEvent;
    assert.ok(
      createdLifeEvent.links.some(
        (link) =>
          link.targetEntityType === "project" &&
          link.targetEntityId === allowed.project.id
      )
    );
    const createdRead = await app.inject({
      method: "GET",
      url: `/api/v1/life-events/${createdLifeEvent.id}`,
      headers
    });
    assert.equal(createdRead.statusCode, 200, createdRead.body);

    const deniedFromCalendar = await app.inject({
      method: "POST",
      url: "/api/v1/life-events/from-calendar-event",
      headers,
      payload: { calendarEventId: foreignCalendarEvent.id }
    });
    assert.equal(deniedFromCalendar.statusCode, 404, deniedFromCalendar.body);

    const allowedSourceWithForeignExisting = createCalendarEvent({
      title: "Allowed source with inaccessible existing Life Event",
      description: "",
      location: "Bern",
      place: calendarPlace("Bern"),
      startAt: "2035-04-18T08:00:00.000Z",
      endAt: "2035-04-18T09:00:00.000Z",
      timezone: "Europe/Zurich",
      isAllDay: false,
      availability: "busy",
      eventType: "meeting",
      categories: [],
      userId: allowed.user.id,
      links: [
        {
          entityType: "project",
          entityId: allowed.project.id,
          relationshipType: "project_context"
        }
      ]
    });
    const foreignExisting = createLifeEvent({
      title: "Foreign existing derived record",
      startsAt: allowedSourceWithForeignExisting.startAt,
      endsAt: allowedSourceWithForeignExisting.endAt,
      timezone: allowedSourceWithForeignExisting.timezone,
      primaryCalendarEventId: allowedSourceWithForeignExisting.id,
      sourceKind: "calendar",
      userId: foreign.user.id,
      links: [
        {
          entityType: "calendar_event",
          entityId: allowedSourceWithForeignExisting.id,
          relationship: "primary_calendar_projection"
        }
      ],
      calendarProjection: "none"
    });
    const reverseLinkCountBefore = getCalendarEventById(
      allowedSourceWithForeignExisting.id
    )?.links.filter(
      (link) =>
        link.entityType === "life_event" && link.entityId === foreignExisting.id
    ).length;
    const deniedExistingReplay = await app.inject({
      method: "POST",
      url: "/api/v1/life-events/from-calendar-event",
      headers,
      payload: { calendarEventId: allowedSourceWithForeignExisting.id }
    });
    assert.equal(deniedExistingReplay.statusCode, 404);
    assert.equal(
      getCalendarEventById(allowedSourceWithForeignExisting.id)?.links.filter(
        (link) =>
          link.entityType === "life_event" &&
          link.entityId === foreignExisting.id
      ).length,
      reverseLinkCountBefore
    );

    const indirectLifeEvent = createScopedLifeEvent({
      title: "Milestone scoped through a calendar event",
      userId: allowed.user.id,
      links: [
        {
          entityType: "calendar_event",
          entityId: allowedCalendarEvent.id,
          relationship: "calendar_context"
        }
      ]
    });
    const indirectReadBeforeDelete = await app.inject({
      method: "GET",
      url: `/api/v1/life-events/${indirectLifeEvent.id}`,
      headers
    });
    assert.equal(
      indirectReadBeforeDelete.statusCode,
      200,
      indirectReadBeforeDelete.body
    );
    deleteCalendarEvent(allowedCalendarEvent.id);
    const indirectReadAfterDelete = await app.inject({
      method: "GET",
      url: `/api/v1/life-events/${indirectLifeEvent.id}`,
      headers
    });
    assert.equal(indirectReadAfterDelete.statusCode, 404);

    const tagOnlyLifeEvent = createScopedLifeEvent({
      title: "Milestone scoped through a live tag",
      userId: allowed.user.id,
      links: [
        {
          entityType: "tag",
          entityId: allowed.tag.id,
          relationship: "tag_context"
        }
      ]
    });
    const tagToken = issueScopedToken({
      userId: allowed.user.id,
      tagIds: [allowed.tag.id]
    });
    const tagHeaders = { authorization: `Bearer ${tagToken}` };
    const tagReadBeforeDelete = await app.inject({
      method: "GET",
      url: `/api/v1/life-events/${tagOnlyLifeEvent.id}`,
      headers: tagHeaders
    });
    assert.equal(tagReadBeforeDelete.statusCode, 200, tagReadBeforeDelete.body);
    deleteTag(allowed.tag.id);
    const tagReadAfterDelete = await app.inject({
      method: "GET",
      url: `/api/v1/life-events/${tagOnlyLifeEvent.id}`,
      headers: tagHeaders
    });
    assert.equal(tagReadAfterDelete.statusCode, 404);

    const operatorCookie = issueTestOperatorSessionCookie(app);
    const invalidExplicitUser = await app.inject({
      method: "GET",
      url: "/api/v1/life-events/timeline?userIds=user_that_does_not_exist",
      headers: { cookie: operatorCookie }
    });
    assert.equal(invalidExplicitUser.statusCode, 200, invalidExplicitUser.body);
    assert.equal(
      (invalidExplicitUser.json() as { timeline: { total: number } }).timeline
        .total,
      0
    );
  });
});
