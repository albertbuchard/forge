import assert from "node:assert/strict";
import test from "node:test";
import {
  assessAggregateQueryPrivacy,
  buildBroadShareRules,
  fingerprintAggregateQuery,
  getPeerProjectionDefinition,
  interpretPeopleQuestion,
  parsePeerProjectionInput,
  validatePeerProjectionOutput,
  validateProjectionRule
} from "./peer-projections.js";

test("projection registry contains every initial typed query", () => {
  assert.equal(getPeerProjectionDefinition("calendar.availability.v1").version, 1);
  assert.equal(getPeerProjectionDefinition("health.cycling.aggregate.v1").aggregate, true);
});

test("calendar query input is bounded and timezone explicit", () => {
  assert.throws(() =>
    parsePeerProjectionInput("calendar.availability.v1", {
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: "2028-01-01T00:00:00.000Z",
      timezone: "Europe/Zurich",
      precision: "free_busy"
    })
  );
});

test("every registered projection publishes and enforces an output schema", () => {
  const outputs = {
    "calendar.availability.v1": {
      records: [
        {
          recordId: null,
          fields: {
            start: "2026-07-20T08:00:00.000Z",
            end: "2026-07-20T09:00:00.000Z",
            busyState: "busy"
          }
        }
      ]
    },
    "calendar.selected_events.v1": {
      records: [
        {
          recordId: "event_1",
          fields: {
            eventTitle: "Train",
            start: "2026-07-20T08:00:00.000Z",
            end: "2026-07-20T09:00:00.000Z"
          }
        }
      ]
    },
    "goals.horizon_summary.v1": {
      records: [
        {
          recordId: "goal_1",
          fields: {
            goalTitle: "Finish thesis",
            goalState: "active",
            goalProgress: 42
          }
        }
      ]
    },
    "health.cycling.aggregate.v1": {
      records: [
        {
          recordId: null,
          fields: {
            distance: 42_000,
            activityCount: 3
          }
        }
      ]
    },
    "person.profile.v1": {
      records: [
        {
          recordId: null,
          fields: { displayName: "Jon", preferredName: "Jon" }
        }
      ]
    },
    "life_events.selected.v1": {
      records: [
        {
          recordId: "life_event_1",
          fields: {
            lifeEventTitle: "Festival",
            lifeEventType: "festival"
          }
        }
      ]
    },
    "movement.aggregate.v1": {
      records: [
        {
          recordId: null,
          fields: { movementDistance: 10_000 }
        }
      ]
    },
    "custom.selected_entities.v1": {
      records: [
        {
          recordId: "project_1",
          fields: { customTitle: "Forge", customState: "Active" }
        }
      ]
    }
  } as const;

  for (const [projectionId, payload] of Object.entries(outputs)) {
    assert.doesNotThrow(() =>
      getPeerProjectionDefinition(
        projectionId as keyof typeof outputs
      ).outputSchema.parse(payload)
    );
  }
});

test("projection output validation applies the active grant field intersection", () => {
  const result = validatePeerProjectionOutput({
    projectionId: "calendar.availability.v1",
    payload: {
      records: [
        {
          recordId: null,
          fields: {
            start: "2026-07-20T08:00:00.000Z",
            end: "2026-07-20T09:00:00.000Z",
            busyState: "busy",
            eventTitle: "Private appointment"
          }
        }
      ]
    },
    effectiveFields: ["start", "end", "busyState"],
    maximumResultCount: 10,
    maximumPayloadBytes: 16_384
  });

  assert.equal(result.resultCount, 1);
  assert.deepEqual(result.redactedFields, ["eventTitle"]);
  assert.deepEqual(result.payload.records[0]?.fields, {
    start: "2026-07-20T08:00:00.000Z",
    end: "2026-07-20T09:00:00.000Z",
    busyState: "busy"
  });
});

test("projection output validation rejects schema, count, and byte-limit violations", () => {
  const base = {
    projectionId: "goals.horizon_summary.v1" as const,
    effectiveFields: ["goalTitle"],
    maximumResultCount: 1,
    maximumPayloadBytes: 16_384
  };
  assert.throws(
    () =>
      validatePeerProjectionOutput({
        ...base,
        payload: {
          records: [
            { recordId: "goal_1", fields: { goalTitle: "One" } },
            { recordId: "goal_2", fields: { goalTitle: "Two" } }
          ]
        }
      }),
    /record authorization ceiling/
  );
  assert.throws(
    () =>
      validatePeerProjectionOutput({
        ...base,
        maximumPayloadBytes: 32,
        payload: {
          records: [
            { recordId: "goal_1", fields: { goalTitle: "A long title" } }
          ]
        }
      }),
    /byte authorization ceiling/
  );
  assert.throws(
    () =>
      validatePeerProjectionOutput({
        ...base,
        payload: {
          records: [
            {
              recordId: "goal_1",
              fields: { goalTitle: "Goal", privateNotes: "No" }
            }
          ]
        }
      }),
    /unrecognized key|privateNotes/
  );
});

test("projection output validation rejects non-JSON and pathological object graphs", () => {
  const input = {
    projectionId: "custom.selected_entities.v1" as const,
    effectiveFields: ["value"],
    maximumResultCount: 10,
    maximumPayloadBytes: 262_144
  };
  assert.throws(
    () =>
      validatePeerProjectionOutput({
        ...input,
        payload: {
          records: [{ recordId: "record_1", fields: { value: Number.NaN } }]
        }
      }),
    /finite/
  );

  const cyclic: { records: unknown[]; self?: unknown } = { records: [] };
  cyclic.self = cyclic;
  assert.throws(
    () => validatePeerProjectionOutput({ ...input, payload: cyclic }),
    /cycles|shared object references/
  );

  let getterCalled = false;
  const accessor = Object.defineProperty({}, "records", {
    enumerable: true,
    get() {
      getterCalled = true;
      return [];
    }
  });
  assert.throws(
    () => validatePeerProjectionOutput({ ...input, payload: accessor }),
    /data properties/
  );
  assert.equal(getterCalled, false);

  let nested: unknown = "value";
  for (let depth = 0; depth < 40; depth += 1) {
    nested = { child: nested };
  }
  assert.throws(
    () =>
      validatePeerProjectionOutput({
        ...input,
        payload: {
          records: [{ recordId: "record_1", fields: { value: nested } }]
        }
      }),
    /depth/
  );
});

test("custom projection output rejects protected fields even when a caller requests them", () => {
  assert.throws(
    () =>
      validatePeerProjectionOutput({
        projectionId: "custom.selected_entities.v1",
        payload: {
          records: [
            {
              recordId: "record_1",
              fields: { apiToken: "must-not-leave-the-source" }
            }
          ]
        },
        effectiveFields: ["apiToken"],
        maximumResultCount: 10,
        maximumPayloadBytes: 16_384
      }),
    /unrecognized key|apiToken/
  );
});

test("broad share excludes health, movement, selected events, and custom records", () => {
  const rules = buildBroadShareRules({ approvedDeviceIds: ["remote_phone"] });
  const projections = rules.map((rule) => rule.projectionId);
  assert.deepEqual(projections.sort(), [
    "calendar.availability.v1",
    "goals.horizon_summary.v1",
    "person.profile.v1"
  ]);
  assert.ok(
    rules
      .find((rule) => rule.projectionId === "person.profile.v1")
      ?.fields.exclude.includes("privateNotes")
  );
});

test("projection rule validation rejects permanently excluded fields", () => {
  const rule = buildBroadShareRules({ approvedDeviceIds: ["remote_phone"] })[0]!;
  assert.throws(
    () =>
      validateProjectionRule({
        ...rule,
        fields: { ...rule.fields, include: [...rule.fields.include, "providerRaw"] }
      }),
    /cannot share/
  );
});

test("aggregate privacy guard rejects repeated overlapping windows", () => {
  const firstFingerprint = "a".repeat(64);
  const secondFingerprint = "b".repeat(64);
  const history = [
    {
      projectionId: "health.cycling.aggregate.v1" as const,
      startsAt: "2026-06-01T00:00:00.000Z",
      endsAt: "2026-07-01T00:00:00.000Z",
      queriedAt: "2026-07-15T10:00:00.000Z",
      queryFingerprint: firstFingerprint,
      snapshotId: "snapshot_1",
      cost: 1
    },
    {
      projectionId: "health.cycling.aggregate.v1" as const,
      startsAt: "2026-06-02T00:00:00.000Z",
      endsAt: "2026-07-01T00:00:00.000Z",
      queriedAt: "2026-07-15T10:05:00.000Z",
      queryFingerprint: secondFingerprint,
      snapshotId: "snapshot_1",
      cost: 3
    }
  ];
  assert.deepEqual(
    assessAggregateQueryPrivacy({
      projectionId: "health.cycling.aggregate.v1",
      startsAt: "2026-06-03T00:00:00.000Z",
      endsAt: "2026-07-01T00:00:00.000Z",
      queryFingerprint: "c".repeat(64),
      snapshotId: "snapshot_1",
      now: new Date("2026-07-15T12:00:00.000Z"),
      history,
      maximumQueriesPerDay: 30,
      privacyBudget: 30
    }),
    { allowed: false, reason: "differencing_risk" }
  );
});

test("aggregate privacy permits only exact same-snapshot replays at zero cost", () => {
  const query = {
    projectionId: "health.cycling.aggregate.v1" as const,
    startsAt: "2026-06-01T00:00:00.000Z",
    endsAt: "2026-07-01T00:00:00.000Z",
    timezone: "Europe/Zurich",
    granularity: "week" as const,
    metrics: ["distance", "duration"]
  };
  const queryFingerprint = fingerprintAggregateQuery(query);
  const history = [
    {
      projectionId: query.projectionId,
      startsAt: query.startsAt,
      endsAt: query.endsAt,
      queriedAt: "2026-07-15T10:00:00.000Z",
      queryFingerprint,
      snapshotId: "snapshot_1",
      cost: 1
    }
  ];
  assert.deepEqual(
    assessAggregateQueryPrivacy({
      projectionId: query.projectionId,
      startsAt: query.startsAt,
      endsAt: query.endsAt,
      queryFingerprint,
      snapshotId: "snapshot_1",
      now: new Date("2026-07-15T12:00:00.000Z"),
      history,
      maximumQueriesPerDay: 30,
      privacyBudget: 30
    }),
    { allowed: true, cost: 0, remainingBudget: 29 }
  );
  assert.deepEqual(
    assessAggregateQueryPrivacy({
      projectionId: query.projectionId,
      startsAt: query.startsAt,
      endsAt: query.endsAt,
      queryFingerprint: "d".repeat(64),
      snapshotId: "snapshot_1",
      now: new Date("2026-07-15T12:00:00.000Z"),
      history,
      maximumQueriesPerDay: 30,
      privacyBudget: 30
    }),
    { allowed: false, reason: "differencing_risk" }
  );
});

test("people questions map locally to registered projections", () => {
  const calendar = interpretPeopleQuestion("What is Jon doing next Monday?");
  const goals = interpretPeopleQuestion(
    "What is Jon's big goal for the next few months?"
  );
  const cycling = interpretPeopleQuestion("How much is Jon cycling?");
  assert.equal(
    calendar.supported ? calendar.projectionId : null,
    "calendar.availability.v1"
  );
  assert.equal(calendar.supported ? calendar.requestedPrecision : null, "exact");
  const availability = interpretPeopleQuestion("Is Jon free next Monday?");
  assert.equal(
    availability.supported ? availability.requestedPrecision : null,
    "fifteen_minutes"
  );
  assert.equal(
    goals.supported ? goals.projectionId : null,
    "goals.horizon_summary.v1"
  );
  assert.equal(
    cycling.supported ? cycling.projectionId : null,
    "health.cycling.aggregate.v1"
  );
});
