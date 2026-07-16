import { createHash, randomUUID } from "node:crypto";
import { listWorkoutSessions } from "../health.js";
import { listCalendarEvents } from "../repositories/calendar.js";
import { getEntityOwnerId } from "../repositories/entity-ownership.js";
import { listGoals } from "../repositories/goals.js";
import { listLifeEvents } from "../repositories/life-events.js";
import {
  applyAuthenticatedPeerRevocationPage,
  getAppliedPeerRevocationState,
  type AppliedPeerRevocationPage,
  type AppliedPeerRevocationState,
  type AuthenticatedPeerRevocationPage
} from "../repositories/peer-sharing.js";
import { listTasks } from "../repositories/tasks.js";
import { getUserById } from "../repositories/users.js";
import type {
  PeerCoreGateway,
  PeerInboundQueryClaim,
  PeerQueryPayload,
  PeerRevocationEventPage
} from "./peer-core-gateway.js";
import { validatePeerProjectionOutput } from "./peer-projections.js";

const QUERY_LEASE_MS = 30_000;
const QUERY_EVALUATION_TIMEOUT_MS = 10_000;
const COMMAND_WINDOW_MS = 12_000;
const IPC_SAFE_PAYLOAD_BYTES = 48 * 1_024;
const IDLE_BACKOFF_MS = 1_000;
const MAX_IDLE_BACKOFF_MS = 5_000;
const UNAVAILABLE_BACKOFF_MS = 2_000;
const MAX_UNAVAILABLE_BACKOFF_MS = 30_000;
const REVOCATION_PAGE_LIMIT = 64;

type Awaitable<T> = T | Promise<T>;

export type PeerWorkerCycle = {
  state: "worked" | "idle" | "deferred" | "unavailable";
  delayMs: number;
};

type CalendarRecord = {
  id: string;
  title: string;
  location?: string | null;
  startAt: string;
  endAt: string;
  timezone: string;
  availability?: string | null;
  status?: string | null;
};

type GoalRecord = {
  id: string;
  title: string;
  description: string;
  horizon: string;
  status: string;
};

type TaskRecord = {
  id: string;
  goalId?: string | null;
  status: string;
};

type WorkoutRecord = {
  id: string;
  userId: string;
  workoutType: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  activeEnergyKcal?: number | null;
  totalEnergyKcal?: number | null;
  distanceMeters?: number | null;
};

type LifeEventRecord = {
  id: string;
  title: string;
  eventType: string;
  startsAt: string;
  endsAt: string;
  placeLabel?: string | null;
  placeAddress?: string | null;
};

type UserRecord = {
  id: string;
  displayName: string;
  description: string;
};

export type PeerQueryCanonicalSources = {
  listCalendar(input: {
    ownerUserId: string;
    startsAt: string;
    endsAt: string;
  }): Awaitable<CalendarRecord[]>;
  listGoals(ownerUserId: string): Awaitable<GoalRecord[]>;
  listTasks(ownerUserId: string): Awaitable<TaskRecord[]>;
  listWorkouts(ownerUserId: string): Awaitable<WorkoutRecord[]>;
  listLifeEvents(ownerUserId: string): Awaitable<LifeEventRecord[]>;
  getUser(ownerUserId: string): Awaitable<UserRecord | null>;
};

const defaultCanonicalSources: PeerQueryCanonicalSources = {
  listCalendar: ({ ownerUserId, startsAt, endsAt }) =>
    listCalendarEvents({
      from: startsAt,
      to: endsAt,
      userIds: [ownerUserId]
    }).filter(
      (event) => getEntityOwnerId("calendar_event", event.id) === ownerUserId
    ) as CalendarRecord[],
  listGoals: (ownerUserId) =>
    listGoals().filter(
      (goal) => getEntityOwnerId("goal", goal.id) === ownerUserId
    ) as GoalRecord[],
  listTasks: (ownerUserId) =>
    listTasks().filter(
      (task) => getEntityOwnerId("task", task.id) === ownerUserId
    ) as TaskRecord[],
  listWorkouts: (ownerUserId) =>
    listWorkoutSessions([ownerUserId]).filter(
      (workout) => workout.userId === ownerUserId
    ) as WorkoutRecord[],
  listLifeEvents: (ownerUserId) =>
    listLifeEvents().filter(
      (event) => getEntityOwnerId("life_event", event.id) === ownerUserId
    ) as LifeEventRecord[],
  getUser: (ownerUserId) => {
    const user = getUserById(ownerUserId);
    return user && user.id === ownerUserId ? (user as UserRecord) : null;
  }
};

function workerIdentifier(prefix: string, ownerUserId: string) {
  return `${prefix}_${createHash("sha256")
    .update(ownerUserId, "utf8")
    .digest("hex")}`;
}

function commandIdentifier(prefix: string, parts: readonly string[]) {
  const hash = createHash("sha256").update(`${prefix}\0`, "utf8");
  for (const part of parts) hash.update(part, "utf8").update("\0", "utf8");
  return `${prefix}_${hash.digest("hex")}`;
}

function boundedText(value: string | null | undefined, maximum: number) {
  const normalized = value?.trim() ?? "";
  return normalized.length === 0 ? null : normalized.slice(0, maximum);
}

function selectFields(
  allowed: readonly string[],
  values: Record<string, unknown>
): Record<string, unknown> {
  const selected: Record<string, unknown> = {};
  for (const field of allowed) {
    const value = values[field];
    if (value !== undefined && value !== null) selected[field] = value;
  }
  return selected;
}

function clippedRange(input: {
  startsAt: string;
  endsAt: string;
  intervalStartsAt: string;
  intervalEndsAt: string;
  precision: "exact" | "fifteen_minutes" | "hour";
}) {
  const intervalStart = Date.parse(input.intervalStartsAt);
  const intervalEnd = Date.parse(input.intervalEndsAt);
  const quantum =
    input.precision === "fifteen_minutes"
      ? 15 * 60 * 1_000
      : input.precision === "hour"
        ? 60 * 60 * 1_000
        : 1;
  const sourceStart = Math.max(Date.parse(input.startsAt), intervalStart);
  const sourceEnd = Math.min(Date.parse(input.endsAt), intervalEnd);
  if (sourceStart >= sourceEnd) return null;
  const startsAt = Math.max(
    intervalStart,
    Math.floor(sourceStart / quantum) * quantum
  );
  const endsAt = Math.min(
    intervalEnd,
    Math.ceil(sourceEnd / quantum) * quantum
  );
  return startsAt < endsAt
    ? {
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString()
      }
    : null;
}

function utcBucketKey(
  timestamp: string,
  granularity: "day" | "week" | "month"
) {
  const date = new Date(timestamp);
  if (granularity === "month") return date.toISOString().slice(0, 7);
  if (granularity === "day") return date.toISOString().slice(0, 10);
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) +
      mondayOffset * 86_400_000
  );
  return monday.toISOString().slice(0, 10);
}

function safelyValidatePayload(input: {
  claim: PeerInboundQueryClaim;
  records: PeerQueryPayload["records"];
  completeness: "complete" | "partial" | "unknown";
}) {
  let completeness = input.completeness;
  let records = input.records.slice(0, input.claim.query.maximumResultCount);
  if (records.length < input.records.length) completeness = "partial";
  const maximumPayloadBytes = Math.min(
    input.claim.maximumPayloadBytes,
    IPC_SAFE_PAYLOAD_BYTES
  );
  while (true) {
    try {
      const validated = validatePeerProjectionOutput({
        projectionId: input.claim.query.projectionId,
        payload: { records },
        effectiveFields: input.claim.query.fields,
        maximumResultCount: input.claim.query.maximumResultCount,
        maximumPayloadBytes
      });
      if (
        validated.payload.records.some((record) => record.recordId === null)
      ) {
        throw new Error(
          "Peer source projection produced an unbound record id."
        );
      }
      return {
        payload: {
          records: validated.payload.records.map((record) => ({
            recordId: record.recordId!,
            fields: record.fields
          }))
        },
        completeness
      };
    } catch (error) {
      if (records.length === 0) throw error;
      records = records.slice(0, -1);
      completeness = "partial";
    }
  }
}

export async function evaluatePeerInboundQuery(input: {
  ownerUserId: string;
  claim: PeerInboundQueryClaim;
  sources?: PeerQueryCanonicalSources;
  now?: Date;
}): Promise<{
  payload: PeerQueryPayload;
  asOf: string;
  completeness: "complete" | "partial" | "unknown";
  redactedFields: string[];
}> {
  const sources = input.sources ?? defaultCanonicalSources;
  const query = input.claim.query;
  const now = input.now ?? new Date();
  if (
    !Number.isFinite(now.getTime()) ||
    Date.parse(input.claim.expiresAt) <= now.getTime() ||
    query.fields.length === 0 ||
    query.fields.some((field) => input.claim.redactedFields.includes(field))
  ) {
    throw new Error("Inbound peer query claim is no longer evaluable.");
  }
  if (
    query.interval !== null &&
    !input.claim.intervalTimeZoneAuthenticated &&
    query.interval.timeZone !== "UTC"
  ) {
    throw new Error("Unauthenticated peer query time zone was not normalized.");
  }
  if (input.claim.entityIdsAreOpaque && query.entityIds.length > 0) {
    const validated = safelyValidatePayload({
      claim: input.claim,
      records: [],
      completeness: "unknown"
    });
    return {
      ...validated,
      asOf: now.toISOString(),
      redactedFields: input.claim.redactedFields
    };
  }

  let records: PeerQueryPayload["records"] = [];
  let completeness: "complete" | "partial" | "unknown" = "complete";
  switch (query.projectionId) {
    case "calendar.availability.v1": {
      const events = await sources.listCalendar({
        ownerUserId: input.ownerUserId,
        startsAt: query.interval.startsAt,
        endsAt: query.interval.endsAt
      });
      records = events.flatMap((event) => {
        if (event.status === "cancelled" || event.status === "canceled") {
          return [];
        }
        const range = clippedRange({
          startsAt: event.startAt,
          endsAt: event.endAt,
          intervalStartsAt: query.interval.startsAt,
          intervalEndsAt: query.interval.endsAt,
          precision: query.precision
        });
        if (!range) return [];
        const fields = selectFields(query.fields, {
          start: range.startsAt,
          end: range.endsAt,
          timezone: event.timezone,
          busyState:
            event.availability === "free"
              ? "free"
              : event.availability === "busy"
                ? "busy"
                : "unknown",
          eventTitle: boundedText(event.title, 500),
          eventLocation: boundedText(event.location, 20_000)
        });
        return Object.keys(fields).length > 0
          ? [{ recordId: event.id, fields }]
          : [];
      });
      break;
    }
    case "calendar.selected_events.v1": {
      const selected = new Set(query.entityIds);
      const events = await sources.listCalendar({
        ownerUserId: input.ownerUserId,
        startsAt: query.interval.startsAt,
        endsAt: query.interval.endsAt
      });
      records = events.flatMap((event) => {
        if (!selected.has(event.id)) return [];
        const range = clippedRange({
          startsAt: event.startAt,
          endsAt: event.endAt,
          intervalStartsAt: query.interval.startsAt,
          intervalEndsAt: query.interval.endsAt,
          precision: "exact"
        });
        if (!range) return [];
        const fields = selectFields(query.fields, {
          eventTitle: boundedText(event.title, 500),
          start: range.startsAt,
          end: range.endsAt,
          timezone: event.timezone,
          eventLocation: boundedText(event.location, 20_000)
        });
        return Object.keys(fields).length > 0
          ? [{ recordId: event.id, fields }]
          : [];
      });
      break;
    }
    case "goals.horizon_summary.v1": {
      const durationDays =
        (Date.parse(query.interval.endsAt) -
          Date.parse(query.interval.startsAt)) /
        86_400_000;
      const horizons =
        durationDays <= 93
          ? new Set(["quarter"])
          : new Set(["quarter", "year"]);
      const [goals, tasks] = await Promise.all([
        sources.listGoals(input.ownerUserId),
        sources.listTasks(input.ownerUserId)
      ]);
      records = goals.flatMap((goal) => {
        if (!horizons.has(goal.horizon)) return [];
        const goalTasks = tasks.filter((task) => task.goalId === goal.id);
        const progress =
          goalTasks.length === 0
            ? goal.status === "completed"
              ? 100
              : 0
            : (goalTasks.filter((task) => task.status === "done").length /
                goalTasks.length) *
              100;
        const fields = selectFields(query.fields, {
          goalTitle: boundedText(goal.title, 500),
          goalSummary: boundedText(goal.description, 20_000),
          goalState: boundedText(goal.status, 80),
          goalProgress: Math.round(progress * 100) / 100
        });
        return Object.keys(fields).length > 0
          ? [{ recordId: goal.id, fields }]
          : [];
      });
      break;
    }
    case "health.cycling.aggregate.v1": {
      if (query.parameters.units !== "metric") {
        completeness = "unknown";
        records = [];
        break;
      }
      const buckets = new Map<
        string,
        {
          duration: number;
          distance: number;
          activityCount: number;
          energy: number;
        }
      >();
      const workouts = await sources.listWorkouts(input.ownerUserId);
      for (const workout of workouts) {
        const type = workout.workoutType.toLocaleLowerCase("en-US");
        if (
          !["cycling", "hand_cycling"].includes(type) ||
          Date.parse(workout.startedAt) < Date.parse(query.interval.startsAt) ||
          Date.parse(workout.startedAt) >= Date.parse(query.interval.endsAt)
        ) {
          continue;
        }
        const key = utcBucketKey(
          workout.startedAt,
          query.parameters.granularity
        );
        const bucket = buckets.get(key) ?? {
          duration: 0,
          distance: 0,
          activityCount: 0,
          energy: 0
        };
        bucket.duration += Math.max(0, workout.durationSeconds);
        bucket.distance += Math.max(0, workout.distanceMeters ?? 0);
        bucket.activityCount += 1;
        bucket.energy += Math.max(
          0,
          workout.activeEnergyKcal ?? workout.totalEnergyKcal ?? 0
        );
        buckets.set(key, bucket);
      }
      records = [...buckets.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, values]) => ({
          recordId: `cycling_${query.parameters.granularity}_${key}`,
          fields: selectFields(query.fields, values)
        }))
        .filter((record) => Object.keys(record.fields).length > 0);
      break;
    }
    case "person.profile.v1": {
      const user = await sources.getUser(input.ownerUserId);
      if (!user) {
        completeness = "unknown";
        break;
      }
      const fields = selectFields(query.fields, {
        displayName: boundedText(user.displayName, 500),
        shortDescription: boundedText(user.description, 20_000)
      });
      if (Object.keys(fields).length > 0) {
        records = [{ recordId: user.id, fields }];
        if (
          query.fields.some(
            (field) => !["displayName", "shortDescription"].includes(field)
          )
        ) {
          completeness = "partial";
        }
      } else {
        completeness = "unknown";
      }
      break;
    }
    case "life_events.selected.v1": {
      const selected = new Set(query.entityIds);
      const events = await sources.listLifeEvents(input.ownerUserId);
      records = events.flatMap((event) => {
        if (
          !selected.has(event.id) ||
          Date.parse(event.endsAt) <= Date.parse(query.interval.startsAt) ||
          Date.parse(event.startsAt) >= Date.parse(query.interval.endsAt)
        ) {
          return [];
        }
        const fields = selectFields(query.fields, {
          lifeEventTitle: boundedText(event.title, 500),
          lifeEventType: boundedText(event.eventType, 80),
          lifeEventPlace: boundedText(
            [event.placeLabel, event.placeAddress].filter(Boolean).join(", "),
            20_000
          )
        });
        return Object.keys(fields).length > 0
          ? [{ recordId: event.id, fields }]
          : [];
      });
      break;
    }
    case "movement.aggregate.v1":
    case "custom.selected_entities.v1":
      completeness = "unknown";
      records = [];
      break;
  }

  const validated = safelyValidatePayload({
    claim: input.claim,
    records,
    completeness
  });
  return {
    ...validated,
    asOf: now.toISOString(),
    redactedFields: input.claim.redactedFields
  };
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  if (milliseconds <= 0 || signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    timer.unref();
    function finish() {
      signal.removeEventListener("abort", finish);
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

async function withTimeout<T>(input: {
  task: Promise<T>;
  timeoutMs: number;
  signal: AbortSignal;
}) {
  return await Promise.race([
    input.task,
    new Promise<T>((_resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Peer source evaluation exceeded its time limit."));
      }, input.timeoutMs);
      timer.unref();
      const clear = () => clearTimeout(timer);
      input.task.then(clear, clear);
      input.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new Error("Peer source evaluation was cancelled."));
        },
        { once: true }
      );
    })
  ]);
}

type PendingQueryResponse = {
  claim: PeerInboundQueryClaim;
  commandId: string;
  approvalDeadline: string;
  authorizationIssuedAt: string;
  payload: PeerQueryPayload;
  asOf: string;
  completeness: "complete" | "partial" | "unknown";
  redactedFields: string[];
};

export class PeerQuerySourceWorker {
  readonly workerId: string;
  private readonly abortController = new AbortController();
  private loopPromise: Promise<void> | null = null;
  private pendingResponse: PendingQueryResponse | null = null;
  private idleBackoffMs = IDLE_BACKOFF_MS;
  private unavailableBackoffMs = UNAVAILABLE_BACKOFF_MS;

  constructor(
    private readonly input: {
      ownerUserId: string;
      gateway: PeerCoreGateway;
      sources?: PeerQueryCanonicalSources;
      now?: () => Date;
      delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
      evaluationTimeoutMs?: number;
      workerId?: string;
    }
  ) {
    this.workerId =
      input.workerId ??
      workerIdentifier("peer_query_worker", input.ownerUserId);
  }

  start() {
    if (!this.loopPromise) this.loopPromise = this.runLoop();
  }

  async stop() {
    this.abortController.abort();
    await this.loopPromise;
  }

  private now() {
    return (this.input.now ?? (() => new Date()))();
  }

  async runOnce(): Promise<PeerWorkerCycle> {
    const respond = this.input.gateway.respondInboundQuery;
    const claimInbound = this.input.gateway.claimInboundQuery;
    if (!respond || !claimInbound) {
      return { state: "unavailable", delayMs: this.nextUnavailableBackoff() };
    }
    if (this.pendingResponse) {
      const pending = this.pendingResponse;
      if (
        Date.parse(pending.approvalDeadline) <= this.now().getTime() ||
        Date.parse(pending.claim.leaseExpiresAt) <= this.now().getTime()
      ) {
        this.pendingResponse = null;
        return { state: "deferred", delayMs: IDLE_BACKOFF_MS };
      }
      const result = await respond.call(this.input.gateway, {
        commandId: pending.commandId,
        approvalDeadline: pending.approvalDeadline,
        authorizationIssuedAt: pending.authorizationIssuedAt,
        ownerUserId: this.input.ownerUserId,
        workerId: this.workerId,
        claimId: pending.claim.claimId,
        queryId: pending.claim.queryId,
        payload: pending.payload,
        asOf: pending.asOf,
        completeness: pending.completeness,
        redactedFields: pending.redactedFields
      });
      if (
        result.queryId !== pending.claim.queryId ||
        result.provenance.relationshipId !== pending.claim.relationshipId ||
        result.provenance.remotePrincipalId !==
          pending.claim.requester.principalId ||
        result.provenance.remoteDeviceId !== pending.claim.requester.deviceId
      ) {
        throw new Error(
          "Peer query response provenance changed after evaluation."
        );
      }
      this.pendingResponse = null;
      this.resetBackoff();
      return { state: "worked", delayMs: 0 };
    }

    const issuedAt = this.now();
    const approvalDeadline = new Date(
      issuedAt.getTime() + COMMAND_WINDOW_MS
    ).toISOString();
    const claimed = await claimInbound.call(this.input.gateway, {
      commandId: commandIdentifier("pq_claim", [
        this.input.ownerUserId,
        this.workerId,
        issuedAt.toISOString(),
        randomUUID()
      ]),
      approvalDeadline,
      authorizationIssuedAt: issuedAt.toISOString(),
      ownerUserId: this.input.ownerUserId,
      workerId: this.workerId,
      leaseMs: QUERY_LEASE_MS
    });
    if (!claimed.claim) {
      const delayMs = this.idleBackoffMs;
      this.idleBackoffMs = Math.min(
        MAX_IDLE_BACKOFF_MS,
        this.idleBackoffMs * 2
      );
      this.unavailableBackoffMs = UNAVAILABLE_BACKOFF_MS;
      return { state: "idle", delayMs };
    }
    const claim = claimed.claim;
    const evaluationStarted = this.now();
    try {
      const evaluated = await withTimeout({
        task: evaluatePeerInboundQuery({
          ownerUserId: this.input.ownerUserId,
          claim,
          sources: this.input.sources,
          now: evaluationStarted
        }),
        timeoutMs:
          this.input.evaluationTimeoutMs ?? QUERY_EVALUATION_TIMEOUT_MS,
        signal: this.abortController.signal
      });
      const responseIssuedAt = this.now();
      const responseDeadlineMs = Math.min(
        responseIssuedAt.getTime() + COMMAND_WINDOW_MS,
        Date.parse(claim.leaseExpiresAt) - 250,
        Date.parse(claim.expiresAt) - 250
      );
      if (responseDeadlineMs <= responseIssuedAt.getTime()) {
        return {
          state: "deferred",
          delayMs: Math.max(
            250,
            Date.parse(claim.leaseExpiresAt) - this.now().getTime()
          )
        };
      }
      this.pendingResponse = {
        claim,
        commandId: commandIdentifier("pq_respond", [
          this.input.ownerUserId,
          this.workerId,
          claim.queryId,
          claim.claimId
        ]),
        approvalDeadline: new Date(responseDeadlineMs).toISOString(),
        authorizationIssuedAt: responseIssuedAt.toISOString(),
        ...evaluated
      };
      return await this.runOnce();
    } catch {
      return {
        state: "deferred",
        delayMs: Math.max(
          250,
          Date.parse(claim.leaseExpiresAt) - this.now().getTime()
        )
      };
    }
  }

  private nextUnavailableBackoff() {
    const delay = this.unavailableBackoffMs;
    this.unavailableBackoffMs = Math.min(
      MAX_UNAVAILABLE_BACKOFF_MS,
      this.unavailableBackoffMs * 2
    );
    return delay;
  }

  private resetBackoff() {
    this.idleBackoffMs = IDLE_BACKOFF_MS;
    this.unavailableBackoffMs = UNAVAILABLE_BACKOFF_MS;
  }

  private async runLoop() {
    while (!this.abortController.signal.aborted) {
      let cycle: PeerWorkerCycle;
      try {
        cycle = await this.runOnce();
      } catch {
        cycle = {
          state: "unavailable",
          delayMs: this.nextUnavailableBackoff()
        };
      }
      await (this.input.delay ?? abortableDelay)(
        cycle.delayMs,
        this.abortController.signal
      );
    }
  }
}

export type PeerRevocationStore = {
  getState(input: {
    ownerUserId: string;
    consumerId: string;
  }): Awaitable<AppliedPeerRevocationState | null>;
  applyPage(input: {
    ownerUserId: string;
    consumerId: string;
    afterCursor: string;
    page: AuthenticatedPeerRevocationPage;
    now?: Date;
  }): Awaitable<AppliedPeerRevocationPage>;
};

const defaultRevocationStore: PeerRevocationStore = {
  getState: getAppliedPeerRevocationState,
  applyPage: applyAuthenticatedPeerRevocationPage
};

type PendingRevocationAck = {
  state: AppliedPeerRevocationState;
  commandId: string;
  approvalDeadline: string;
  authorizationIssuedAt: string;
};

export class PeerRevocationEventConsumer {
  readonly consumerId: string;
  private readonly abortController = new AbortController();
  private loopPromise: Promise<void> | null = null;
  private pendingAck: PendingRevocationAck | null = null;
  private idleBackoffMs = IDLE_BACKOFF_MS;
  private unavailableBackoffMs = UNAVAILABLE_BACKOFF_MS;

  constructor(
    private readonly input: {
      ownerUserId: string;
      gateway: PeerCoreGateway;
      store?: PeerRevocationStore;
      invalidateAuthorization?: (
        events: PeerRevocationEventPage["events"]
      ) => Awaitable<void>;
      now?: () => Date;
      delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
      consumerId?: string;
    }
  ) {
    this.consumerId =
      input.consumerId ??
      workerIdentifier("peer_revocation_consumer", input.ownerUserId);
  }

  start() {
    if (!this.loopPromise) this.loopPromise = this.runLoop();
  }

  async stop() {
    this.abortController.abort();
    await this.loopPromise;
  }

  private now() {
    return (this.input.now ?? (() => new Date()))();
  }

  private prepareAck(state: AppliedPeerRevocationState) {
    const issuedAt = new Date(state.appliedAt);
    this.pendingAck = {
      state,
      commandId: commandIdentifier("pr_ack", [
        this.input.ownerUserId,
        this.consumerId,
        state.throughCursor,
        state.eventHash
      ]),
      approvalDeadline: new Date(
        issuedAt.getTime() + COMMAND_WINDOW_MS
      ).toISOString(),
      authorizationIssuedAt: issuedAt.toISOString()
    };
  }

  private async sendPendingAck() {
    const ack = this.input.gateway.ackRevocationEvents;
    if (!ack || !this.pendingAck)
      throw new Error("Peer revocation ack is unavailable.");
    const pending = this.pendingAck;
    const result = await ack.call(this.input.gateway, {
      commandId: pending.commandId,
      approvalDeadline: pending.approvalDeadline,
      authorizationIssuedAt: pending.authorizationIssuedAt,
      ownerUserId: this.input.ownerUserId,
      consumerId: this.consumerId,
      throughCursor: pending.state.throughCursor,
      eventHash: pending.state.eventHash
    });
    if (
      result.consumerId !== this.consumerId ||
      result.acknowledgedCursor !== pending.state.throughCursor ||
      result.eventHash !== pending.state.eventHash
    ) {
      throw new Error(
        "Peer revocation ack receipt changed its applied cursor."
      );
    }
    this.pendingAck = null;
  }

  async runOnce(): Promise<PeerWorkerCycle> {
    const list = this.input.gateway.listRevocationEvents;
    const ack = this.input.gateway.ackRevocationEvents;
    if (!list || !ack) {
      return { state: "unavailable", delayMs: this.nextUnavailableBackoff() };
    }
    const store = this.input.store ?? defaultRevocationStore;
    const localState = await store.getState({
      ownerUserId: this.input.ownerUserId,
      consumerId: this.consumerId
    });
    const afterCursor = localState?.throughCursor ?? "0";
    const page = await list.call(this.input.gateway, {
      ownerUserId: this.input.ownerUserId,
      consumerId: this.consumerId,
      afterCursor,
      limit: REVOCATION_PAGE_LIMIT
    });
    const pageProvenance = page.provenance;
    if (
      pageProvenance.ownerUserId !== this.input.ownerUserId ||
      pageProvenance.relationshipId !== null ||
      pageProvenance.remotePrincipalId !== null ||
      pageProvenance.remoteDeviceId !== null
    ) {
      throw new Error(
        "Peer revocation page provenance is not bound to its exact local owner."
      );
    }
    if (BigInt(page.acknowledgedCursor) > BigInt(afterCursor)) {
      throw new Error(
        "Daemon revocation acknowledgement is ahead of local apply state."
      );
    }
    if (BigInt(page.acknowledgedCursor) < BigInt(afterCursor)) {
      if (!localState)
        throw new Error("Local revocation checkpoint is unavailable.");
      if (
        !this.pendingAck ||
        this.pendingAck.state.throughCursor !== localState.throughCursor ||
        Date.parse(this.pendingAck.approvalDeadline) <= this.now().getTime()
      ) {
        this.prepareAck(localState);
      }
      await this.sendPendingAck();
      this.resetBackoff();
      return { state: "worked", delayMs: 0 };
    }
    this.pendingAck = null;
    if (page.events.length === 0) {
      const delayMs = this.idleBackoffMs;
      this.idleBackoffMs = Math.min(
        MAX_IDLE_BACKOFF_MS,
        this.idleBackoffMs * 2
      );
      return { state: "idle", delayMs };
    }
    await this.input.invalidateAuthorization?.(page.events);
    const authenticatedPage: AuthenticatedPeerRevocationPage = {
      events: page.events,
      acknowledgedCursor: page.acknowledgedCursor,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      provenance: {
        protocolVersion: pageProvenance.protocolVersion,
        ownerUserId: pageProvenance.ownerUserId,
        relationshipId: null,
        localPrincipalId: pageProvenance.localPrincipalId,
        localDeviceId: pageProvenance.localDeviceId,
        remotePrincipalId: null,
        remoteDeviceId: null,
        evidenceHash: pageProvenance.evidenceHash,
        authenticatedAt: pageProvenance.authenticatedAt
      }
    };
    const applied = await store.applyPage({
      ownerUserId: this.input.ownerUserId,
      consumerId: this.consumerId,
      afterCursor,
      page: authenticatedPage,
      now: this.now()
    });
    this.prepareAck(applied);
    await this.sendPendingAck();
    this.resetBackoff();
    return { state: "worked", delayMs: page.hasMore ? 0 : IDLE_BACKOFF_MS };
  }

  private nextUnavailableBackoff() {
    const delay = this.unavailableBackoffMs;
    this.unavailableBackoffMs = Math.min(
      MAX_UNAVAILABLE_BACKOFF_MS,
      this.unavailableBackoffMs * 2
    );
    return delay;
  }

  private resetBackoff() {
    this.idleBackoffMs = IDLE_BACKOFF_MS;
    this.unavailableBackoffMs = UNAVAILABLE_BACKOFF_MS;
  }

  private async runLoop() {
    while (!this.abortController.signal.aborted) {
      let cycle: PeerWorkerCycle;
      try {
        cycle = await this.runOnce();
      } catch {
        cycle = {
          state: "unavailable",
          delayMs: this.nextUnavailableBackoff()
        };
      }
      await (this.input.delay ?? abortableDelay)(
        cycle.delayMs,
        this.abortController.signal
      );
    }
  }
}
