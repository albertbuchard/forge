import assert from "node:assert/strict";
import test from "node:test";
import {
  hashPeerQueryCacheIdentity,
  peerQueryCacheIdentity,
  peerTypedQuestionSchema
} from "./peer-typed-query.js";

const interval = {
  startsAt: "2026-07-19T22:00:00.000Z",
  endsAt: "2026-07-20T22:00:00.000Z",
  timeZone: "Europe/Zurich"
};

test("the three initial People questions use the exact Rust query contract", () => {
  const calendar = peerTypedQuestionSchema.parse({
    projectionId: "calendar.availability.v1",
    parameters: {},
    interval,
    entityIds: [],
    fields: ["start", "end", "busyState"],
    precision: "fifteen_minutes",
    maximumResultCount: 100
  });
  const goals = peerTypedQuestionSchema.parse({
    projectionId: "goals.horizon_summary.v1",
    parameters: {},
    interval,
    entityIds: [],
    fields: ["goalTitle", "goalSummary", "goalState", "goalProgress"],
    precision: "exact",
    maximumResultCount: 100
  });
  const cycling = peerTypedQuestionSchema.parse({
    projectionId: "health.cycling.aggregate.v1",
    parameters: { granularity: "week", units: "metric" },
    interval,
    entityIds: [],
    fields: ["duration", "distance", "activityCount", "energy"],
    precision: "exact",
    maximumResultCount: 100
  });

  assert.equal(calendar.projectionId, "calendar.availability.v1");
  assert.equal(goals.projectionId, "goals.horizon_summary.v1");
  assert.equal(cycling.projectionId, "health.cycling.aggregate.v1");
});

test("typed queries reject unknown keys, wrong parameters, fields, and precision", () => {
  for (const query of [
    {
      projectionId: "calendar.availability.v1",
      parameters: { granularity: "week" },
      interval,
      entityIds: [],
      fields: ["start"],
      precision: "fifteen_minutes",
      maximumResultCount: 100
    },
    {
      projectionId: "goals.horizon_summary.v1",
      parameters: {},
      interval,
      entityIds: [],
      fields: ["eventTitle"],
      precision: "exact",
      maximumResultCount: 100
    },
    {
      projectionId: "health.cycling.aggregate.v1",
      parameters: { granularity: "quarter", units: "metric" },
      interval,
      entityIds: [],
      fields: ["duration"],
      precision: "exact",
      maximumResultCount: 100
    },
    {
      projectionId: "health.cycling.aggregate.v1",
      parameters: { granularity: "week", units: "metric" },
      interval,
      entityIds: [],
      fields: ["duration"],
      precision: "week",
      maximumResultCount: 100,
      unexpected: true
    }
  ]) {
    assert.equal(peerTypedQuestionSchema.safeParse(query).success, false);
  }
});

test("cache identity binds interval, parameters, fields, and entity ids", () => {
  const base = {
    projectionId: "calendar.availability.v1" as const,
    parameters: {},
    interval,
    entityIds: [],
    fields: ["start", "end", "busyState"] as const,
    precision: "fifteen_minutes" as const,
    maximumResultCount: 100
  };
  const later = {
    ...base,
    interval: {
      ...interval,
      startsAt: "2026-07-20T22:00:00.000Z",
      endsAt: "2026-07-21T22:00:00.000Z"
    }
  };

  assert.notEqual(
    hashPeerQueryCacheIdentity(base),
    hashPeerQueryCacheIdentity(later)
  );
  assert.deepEqual(
    peerQueryCacheIdentity({
      ...base,
      fields: ["busyState", "start", "end"]
    }),
    peerQueryCacheIdentity(base)
  );
});
