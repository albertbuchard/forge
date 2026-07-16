import assert from "node:assert/strict";
import test from "node:test";
import type {
  PeerCoreGateway,
  PeerInboundQueryClaim,
  PeerRevocationEvent,
  PeerRevocationEventPage
} from "./peer-core-gateway.js";
import {
  evaluatePeerInboundQuery,
  PeerQuerySourceWorker,
  PeerRevocationEventConsumer,
  type PeerQueryCanonicalSources,
  type PeerRevocationStore
} from "./peer-query-source-worker.js";
import { peerTypedQuestionSchema } from "./peer-typed-query.js";

const ownerA = "owner_source_a";
const ownerB = "owner_source_b";
const requester = {
  principalId: "remote_principal_shared",
  deviceId: "remote_device_shared",
  relationshipId: "1".repeat(32)
};
const interval = {
  startsAt: "2026-07-01T00:00:00.000Z",
  endsAt: "2026-08-01T00:00:00.000Z",
  timeZone: "UTC"
};

function claim(
  query: unknown,
  overrides: Partial<PeerInboundQueryClaim> = {}
): PeerInboundQueryClaim {
  return {
    claimId: "claim_source_test",
    queryId: "query_source_test",
    relationshipId: requester.relationshipId,
    requester,
    query: peerTypedQuestionSchema.parse(query),
    entityIdsAreOpaque: false,
    intervalTimeZoneAuthenticated: true,
    grantId: "grant_source_test",
    grantSequence: "1",
    grantVerificationId: "verification_source_test",
    verifiedGrantHash: "a".repeat(64),
    ruleId: "rule_source_test",
    maximumPayloadBytes: 48 * 1_024,
    redactedFields: [],
    receivedAt: "2026-07-16T09:59:00.000Z",
    expiresAt: "2026-07-16T11:00:00.000Z",
    leaseExpiresAt: "2026-07-16T10:00:30.000Z",
    ...overrides
  };
}

function sources(
  overrides: Partial<PeerQueryCanonicalSources> = {}
): PeerQueryCanonicalSources {
  return {
    listCalendar: async () => [],
    listGoals: async () => [],
    listTasks: async () => [],
    listWorkouts: async () => [],
    listLifeEvents: async () => [],
    getUser: async () => null,
    ...overrides
  };
}

test("calendar availability returns bounded canonical owner records", async () => {
  const seenOwners: string[] = [];
  const result = await evaluatePeerInboundQuery({
    ownerUserId: ownerA,
    now: new Date("2026-07-16T10:00:00.000Z"),
    claim: claim({
      projectionId: "calendar.availability.v1",
      parameters: {},
      interval: {
        startsAt: "2026-07-16T10:07:00.000Z",
        endsAt: "2026-07-16T12:00:00.000Z",
        timeZone: "Europe/Zurich"
      },
      entityIds: [],
      fields: ["start", "end", "busyState"],
      precision: "fifteen_minutes",
      maximumResultCount: 10
    }),
    sources: sources({
      listCalendar: async (input) => {
        seenOwners.push(input.ownerUserId);
        return [
          {
            id: "calendar_owner_a",
            title: "Private title must not escape",
            location: "Private location must not escape",
            startAt: "2026-07-16T10:08:00.000Z",
            endAt: "2026-07-16T10:22:00.000Z",
            timezone: "Europe/Zurich",
            availability: "busy",
            status: "confirmed"
          },
          {
            id: "calendar_cancelled",
            title: "Cancelled",
            startAt: "2026-07-16T11:00:00.000Z",
            endAt: "2026-07-16T11:30:00.000Z",
            timezone: "Europe/Zurich",
            status: "cancelled"
          }
        ];
      }
    })
  });

  assert.deepEqual(seenOwners, [ownerA]);
  assert.deepEqual(result, {
    payload: {
      records: [
        {
          recordId: "calendar_owner_a",
          fields: {
            start: "2026-07-16T10:07:00.000Z",
            end: "2026-07-16T10:30:00.000Z",
            busyState: "busy"
          }
        }
      ]
    },
    asOf: "2026-07-16T10:00:00.000Z",
    completeness: "complete",
    redactedFields: []
  });
});

test("goal horizon summary uses canonical goals and task progress", async () => {
  const result = await evaluatePeerInboundQuery({
    ownerUserId: ownerA,
    now: new Date("2026-07-16T10:00:00.000Z"),
    claim: claim({
      projectionId: "goals.horizon_summary.v1",
      parameters: {},
      interval: {
        startsAt: "2026-07-01T00:00:00.000Z",
        endsAt: "2026-09-30T00:00:00.000Z",
        timeZone: "UTC"
      },
      entityIds: [],
      fields: ["goalTitle", "goalState", "goalProgress"],
      precision: "exact",
      maximumResultCount: 10
    }),
    sources: sources({
      listGoals: async (owner) => {
        assert.equal(owner, ownerA);
        return [
          {
            id: "goal_quarter",
            title: "Ship the bridge",
            description: "Owner canonical goal",
            horizon: "quarter",
            status: "active"
          },
          {
            id: "goal_year",
            title: "Year goal",
            description: "Outside the attenuated horizon",
            horizon: "year",
            status: "active"
          }
        ];
      },
      listTasks: async (owner) => {
        assert.equal(owner, ownerA);
        return [
          { id: "task_done", goalId: "goal_quarter", status: "done" },
          { id: "task_open", goalId: "goal_quarter", status: "open" }
        ];
      }
    })
  });

  assert.deepEqual(result.payload.records, [
    {
      recordId: "goal_quarter",
      fields: {
        goalTitle: "Ship the bridge",
        goalState: "active",
        goalProgress: 50
      }
    }
  ]);
  assert.equal(result.completeness, "complete");
});

test("cycling aggregate uses canonical cycling sessions only", async () => {
  const result = await evaluatePeerInboundQuery({
    ownerUserId: ownerA,
    now: new Date("2026-07-16T10:00:00.000Z"),
    claim: claim({
      projectionId: "health.cycling.aggregate.v1",
      parameters: { granularity: "day", units: "metric" },
      interval,
      entityIds: [],
      fields: ["duration", "distance", "activityCount", "energy"],
      precision: "exact",
      maximumResultCount: 10
    }),
    sources: sources({
      listWorkouts: async (owner) => {
        assert.equal(owner, ownerA);
        return [
          {
            id: "ride_one",
            userId: ownerA,
            workoutType: "cycling",
            startedAt: "2026-07-10T08:00:00.000Z",
            endedAt: "2026-07-10T08:30:00.000Z",
            durationSeconds: 1_800,
            activeEnergyKcal: 220,
            distanceMeters: 8_500
          },
          {
            id: "ride_two",
            userId: ownerA,
            workoutType: "hand_cycling",
            startedAt: "2026-07-10T18:00:00.000Z",
            endedAt: "2026-07-10T18:15:00.000Z",
            durationSeconds: 900,
            totalEnergyKcal: 110,
            distanceMeters: 3_000
          },
          {
            id: "run",
            userId: ownerA,
            workoutType: "running",
            startedAt: "2026-07-10T12:00:00.000Z",
            endedAt: "2026-07-10T12:20:00.000Z",
            durationSeconds: 1_200,
            distanceMeters: 4_000
          }
        ];
      }
    })
  });

  assert.deepEqual(result.payload.records, [
    {
      recordId: "cycling_day_2026-07-10",
      fields: {
        duration: 2_700,
        distance: 11_500,
        activityCount: 2,
        energy: 330
      }
    }
  ]);
});

test("same requester receives independent canonical owner partitions", async () => {
  const source = sources({
    getUser: async (owner) => ({
      id: owner,
      displayName: owner === ownerA ? "Owner A" : "Owner B",
      description: "private"
    })
  });
  const profileClaim = claim({
    projectionId: "person.profile.v1",
    parameters: {},
    interval: null,
    entityIds: [],
    fields: ["displayName"],
    precision: "exact",
    maximumResultCount: 1
  });

  const [left, right] = await Promise.all([
    evaluatePeerInboundQuery({
      ownerUserId: ownerA,
      claim: profileClaim,
      sources: source,
      now: new Date("2026-07-16T10:00:00.000Z")
    }),
    evaluatePeerInboundQuery({
      ownerUserId: ownerB,
      claim: { ...profileClaim, claimId: "claim_owner_b" },
      sources: source,
      now: new Date("2026-07-16T10:00:00.000Z")
    })
  ]);

  assert.deepEqual(left.payload.records, [
    { recordId: ownerA, fields: { displayName: "Owner A" } }
  ]);
  assert.deepEqual(right.payload.records, [
    { recordId: ownerB, fields: { displayName: "Owner B" } }
  ]);
});

test("claim fields, entity opacity, interval, and result limits are enforced", async () => {
  let calendarReads = 0;
  const opaque = await evaluatePeerInboundQuery({
    ownerUserId: ownerA,
    claim: claim(
      {
        projectionId: "calendar.selected_events.v1",
        parameters: {},
        interval,
        entityIds: ["opaque_entity"],
        fields: ["eventTitle"],
        precision: "exact",
        maximumResultCount: 1
      },
      { entityIdsAreOpaque: true }
    ),
    sources: sources({
      listCalendar: async () => {
        calendarReads += 1;
        return [];
      }
    }),
    now: new Date("2026-07-16T10:00:00.000Z")
  });
  assert.deepEqual(opaque.payload.records, []);
  assert.equal(opaque.completeness, "unknown");
  assert.equal(calendarReads, 0);

  await assert.rejects(
    evaluatePeerInboundQuery({
      ownerUserId: ownerA,
      claim: claim(
        {
          projectionId: "calendar.availability.v1",
          parameters: {},
          interval,
          entityIds: [],
          fields: ["eventTitle"],
          precision: "exact",
          maximumResultCount: 1
        },
        { redactedFields: ["eventTitle"] }
      ),
      sources: sources(),
      now: new Date("2026-07-16T10:00:00.000Z")
    }),
    /no longer evaluable/
  );

  const bounded = await evaluatePeerInboundQuery({
    ownerUserId: ownerA,
    claim: claim({
      projectionId: "calendar.availability.v1",
      parameters: {},
      interval,
      entityIds: [],
      fields: ["eventTitle"],
      precision: "exact",
      maximumResultCount: 1
    }),
    sources: sources({
      listCalendar: async () => [
        {
          id: "event_one",
          title: "One",
          startAt: "2026-07-10T10:00:00.000Z",
          endAt: "2026-07-10T11:00:00.000Z",
          timezone: "UTC"
        },
        {
          id: "event_two",
          title: "Two",
          startAt: "2026-07-11T10:00:00.000Z",
          endAt: "2026-07-11T11:00:00.000Z",
          timezone: "UTC"
        }
      ]
    }),
    now: new Date("2026-07-16T10:00:00.000Z")
  });
  assert.deepEqual(bounded.payload.records, [
    { recordId: "event_one", fields: { eventTitle: "One" } }
  ]);
  assert.equal(bounded.completeness, "partial");
});

function queryClaimResult(activeClaim: PeerInboundQueryClaim | null) {
  return {
    claim: activeClaim,
    provenance: {
      protocolVersion: "forge-peer/1" as const,
      ownerUserId: ownerA,
      relationshipId: activeClaim?.relationshipId ?? null,
      localPrincipalId: "local_principal",
      localDeviceId: "local_device",
      remotePrincipalId: activeClaim?.requester.principalId ?? null,
      remoteDeviceId: activeClaim?.requester.deviceId ?? null,
      evidenceHash: "b".repeat(64),
      authenticatedAt: "2026-07-16T10:00:00.000Z"
    }
  };
}

test("query response retry is stable, idempotent, and evaluated once", async () => {
  let responseAttempts = 0;
  let sourceReads = 0;
  const responseInputs: unknown[] = [];
  const activeClaim = claim({
    projectionId: "person.profile.v1",
    parameters: {},
    interval: null,
    entityIds: [],
    fields: ["displayName"],
    precision: "exact",
    maximumResultCount: 1
  });
  const gateway = {
    claimInboundQuery: async () => queryClaimResult(activeClaim),
    respondInboundQuery: async (input: Record<string, unknown>) => {
      responseAttempts += 1;
      responseInputs.push(input);
      if (responseAttempts === 1) throw new Error("transport unavailable");
      return {
        queryId: activeClaim.queryId,
        envelopeId: "envelope_response",
        provenance: {
          ...queryClaimResult(activeClaim).provenance,
          relationshipId: activeClaim.relationshipId
        }
      };
    }
  } as unknown as PeerCoreGateway;
  const worker = new PeerQuerySourceWorker({
    ownerUserId: ownerA,
    gateway,
    workerId: "query_worker_retry",
    now: () => new Date("2026-07-16T10:00:00.000Z"),
    sources: sources({
      getUser: async () => {
        sourceReads += 1;
        return { id: ownerA, displayName: "Canonical", description: "" };
      }
    })
  });

  assert.deepEqual(await worker.runOnce(), {
    state: "deferred",
    delayMs: 30_000
  });
  assert.deepEqual(await worker.runOnce(), { state: "worked", delayMs: 0 });
  assert.equal(sourceReads, 1);
  assert.equal(responseAttempts, 2);
  assert.deepEqual(responseInputs[0], responseInputs[1]);
});

test("query worker uses bounded idle and unavailable backoff", async () => {
  const idle = new PeerQuerySourceWorker({
    ownerUserId: ownerA,
    gateway: {
      claimInboundQuery: async () => queryClaimResult(null),
      respondInboundQuery: async () => assert.fail("no response is expected")
    } as unknown as PeerCoreGateway,
    now: () => new Date("2026-07-16T10:00:00.000Z")
  });
  assert.deepEqual(await idle.runOnce(), { state: "idle", delayMs: 1_000 });
  assert.deepEqual(await idle.runOnce(), { state: "idle", delayMs: 2_000 });
  assert.deepEqual(await idle.runOnce(), { state: "idle", delayMs: 4_000 });
  assert.deepEqual(await idle.runOnce(), { state: "idle", delayMs: 5_000 });

  const unavailable = new PeerQuerySourceWorker({
    ownerUserId: ownerA,
    gateway: {} as PeerCoreGateway
  });
  assert.deepEqual(await unavailable.runOnce(), {
    state: "unavailable",
    delayMs: 2_000
  });
  assert.deepEqual(await unavailable.runOnce(), {
    state: "unavailable",
    delayMs: 4_000
  });
});

test("failed evaluation leaves the durable lease for restart recovery", async () => {
  let now = new Date("2026-07-16T10:00:00.000Z");
  let leaseHeld = false;
  const activeClaim = claim(
    {
      projectionId: "person.profile.v1",
      parameters: {},
      interval: null,
      entityIds: [],
      fields: ["displayName"],
      precision: "exact",
      maximumResultCount: 1
    },
    { leaseExpiresAt: "2026-07-16T10:00:30.000Z" }
  );
  const gateway = {
    claimInboundQuery: async () => {
      if (leaseHeld && now < new Date(activeClaim.leaseExpiresAt)) {
        return queryClaimResult(null);
      }
      leaseHeld = true;
      return queryClaimResult(activeClaim);
    },
    respondInboundQuery: async () => assert.fail("evaluation must fail")
  } as unknown as PeerCoreGateway;
  const first = new PeerQuerySourceWorker({
    ownerUserId: ownerA,
    gateway,
    now: () => now,
    sources: sources({
      getUser: async () => {
        throw new Error("read failed");
      }
    })
  });
  assert.equal((await first.runOnce()).state, "deferred");

  const restarted = new PeerQuerySourceWorker({
    ownerUserId: ownerA,
    gateway,
    now: () => now,
    sources: sources({ getUser: async () => null })
  });
  assert.equal((await restarted.runOnce()).state, "idle");
  now = new Date("2026-07-16T10:00:31.000Z");
  assert.notEqual((await restarted.runOnce()).state, "idle");
});

test("query worker shutdown cancels its wait without another cycle", async () => {
  let delays = 0;
  const worker = new PeerQuerySourceWorker({
    ownerUserId: ownerA,
    gateway: {} as PeerCoreGateway,
    delay: async (_milliseconds, signal) => {
      delays += 1;
      await new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    }
  });
  worker.start();
  await new Promise((resolve) => setImmediate(resolve));
  await worker.stop();
  assert.equal(delays, 1);
});

function revocationEvent(
  kind: PeerRevocationEvent["kind"] = "grant"
): PeerRevocationEvent {
  const deviceTarget = kind === "device" || kind === "credential_retirement";
  return {
    cursor: "1",
    eventHash: "c".repeat(64),
    previousEventHash: "0".repeat(64),
    kind,
    source: "local_operator",
    relationshipId: "1".repeat(32),
    grantId: kind === "grant" ? "grant_revoked" : null,
    deviceId: deviceTarget ? "device_revoked" : null,
    targetCertificate: deviceTarget ? "C".repeat(64) : null,
    targetCertificateHash: deviceTarget ? "d".repeat(64) : null,
    targetCertificateSerial: deviceTarget ? "1" : null,
    reason: "revoked",
    occurredAt: "2026-07-16T09:59:00.000Z",
    authenticatedRemotePrincipalId: null,
    authenticatedRemoteDeviceId: null,
    signingDeviceId: "local_signing_device",
    signingCertificate: "S".repeat(64),
    signingCertificateHash: "e".repeat(64),
    signature: "A".repeat(86)
  };
}

function revocationPage(event = revocationEvent()): PeerRevocationEventPage {
  return {
    events: [event],
    acknowledgedCursor: "0",
    nextCursor: "1",
    hasMore: false,
    provenance: {
      protocolVersion: "forge-peer/1",
      ownerUserId: ownerA,
      relationshipId: null,
      localPrincipalId: "local_principal",
      localDeviceId: "local_device",
      remotePrincipalId: null,
      remoteDeviceId: null,
      evidenceHash: "f".repeat(64),
      authenticatedAt: "2026-07-16T10:00:00.000Z"
    },
    evidence: {
      protocol: "forge-peer-daemon-evidence/v1",
      statementType: "revocation_event_page",
      statementHash: "9".repeat(64),
      ownerUserId: ownerA,
      localPrincipalId: "local_principal",
      localDeviceId: "local_device",
      signingCertificateHash: "8".repeat(64),
      issuedAt: "2026-07-16T10:00:00.000Z",
      signature: "Z".repeat(86)
    }
  };
}

test("revocation processing orders authority invalidation, apply, then ack", async () => {
  const order: string[] = [];
  const page = revocationPage(revocationEvent("device"));
  const store: PeerRevocationStore = {
    getState: async () => null,
    applyPage: async (input) => {
      assert.equal(input.ownerUserId, ownerA);
      assert.equal("evidence" in input.page, false);
      assert.deepEqual(input.page.events, page.events);
      order.push("apply");
      return {
        consumerId: input.consumerId,
        throughCursor: "1",
        eventHash: page.events[0]!.eventHash,
        appliedAt: "2026-07-16T10:00:00.000Z",
        eventCount: 1,
        replayed: false
      };
    }
  };
  const gateway = {
    listRevocationEvents: async (input: { ownerUserId: string }) => {
      assert.equal(input.ownerUserId, ownerA);
      return page;
    },
    ackRevocationEvents: async (input: {
      ownerUserId: string;
      consumerId: string;
      throughCursor: string;
      eventHash: string;
    }) => {
      assert.equal(input.ownerUserId, ownerA);
      order.push("ack");
      return {
        consumerId: input.consumerId,
        acknowledgedCursor: input.throughCursor,
        eventHash: input.eventHash,
        acknowledgedAt: "2026-07-16T10:00:00.000Z",
        provenance: page.provenance
      };
    }
  } as unknown as PeerCoreGateway;
  const consumer = new PeerRevocationEventConsumer({
    ownerUserId: ownerA,
    gateway,
    store,
    consumerId: "revocation_consumer_order",
    now: () => new Date("2026-07-16T10:00:00.000Z"),
    invalidateAuthorization: async (events) => {
      assert.deepEqual(events, page.events);
      order.push("invalidate");
    }
  });

  assert.deepEqual(await consumer.runOnce(), {
    state: "worked",
    delayMs: 1_000
  });
  assert.deepEqual(order, ["invalidate", "apply", "ack"]);
});

test("revocation crashes never ack before apply and replay ack after commit", async () => {
  const page = revocationPage();
  let now = new Date("2026-07-16T10:00:00.000Z");
  let state: Awaited<ReturnType<PeerRevocationStore["getState"]>> = null;
  let applyCalls = 0;
  let ackCalls = 0;
  const ackInputs: Array<Record<string, unknown>> = [];
  const store: PeerRevocationStore = {
    getState: async () => state,
    applyPage: async (input) => {
      applyCalls += 1;
      state = {
        consumerId: input.consumerId,
        throughCursor: "1",
        eventHash: page.events[0]!.eventHash,
        appliedAt: "2026-07-16T10:00:00.000Z"
      };
      return { ...state, eventCount: 1, replayed: false };
    }
  };
  const gateway = {
    listRevocationEvents: async () => ({
      ...page,
      acknowledgedCursor: "0",
      events: state ? [] : page.events,
      nextCursor: state ? "1" : page.nextCursor
    }),
    ackRevocationEvents: async (input: Record<string, unknown>) => {
      ackCalls += 1;
      ackInputs.push(input);
      if (ackCalls === 1) throw new Error("crash after apply");
      return {
        consumerId: input.consumerId,
        acknowledgedCursor: input.throughCursor,
        eventHash: input.eventHash,
        acknowledgedAt: "2026-07-16T10:00:01.000Z",
        provenance: page.provenance
      };
    }
  } as unknown as PeerCoreGateway;
  const input = {
    ownerUserId: ownerA,
    gateway,
    store,
    consumerId: "revocation_consumer_replay",
    now: () => now,
    invalidateAuthorization: async () => undefined
  };
  await assert.rejects(
    new PeerRevocationEventConsumer(input).runOnce(),
    /crash/
  );
  assert.equal(applyCalls, 1);
  assert.equal(ackCalls, 1);

  now = new Date("2026-07-16T10:00:15.000Z");
  const replay = new PeerRevocationEventConsumer(input);
  assert.deepEqual(await replay.runOnce(), { state: "worked", delayMs: 0 });
  assert.equal(applyCalls, 1);
  assert.equal(ackCalls, 2);
  assert.deepEqual(ackInputs[1], ackInputs[0]);
});

test("revocation invalidation failure is fail-closed before apply and ack", async () => {
  let applies = 0;
  let acks = 0;
  const page = revocationPage(revocationEvent("relationship"));
  const consumer = new PeerRevocationEventConsumer({
    ownerUserId: ownerA,
    gateway: {
      listRevocationEvents: async () => page,
      ackRevocationEvents: async () => {
        acks += 1;
        throw new Error("must not ack");
      }
    } as unknown as PeerCoreGateway,
    store: {
      getState: async () => null,
      applyPage: async () => {
        applies += 1;
        throw new Error("must not apply");
      }
    },
    invalidateAuthorization: async () => {
      throw new Error("authority persistence failed");
    }
  });
  await assert.rejects(consumer.runOnce(), /authority persistence failed/);
  assert.equal(applies, 0);
  assert.equal(acks, 0);
});
