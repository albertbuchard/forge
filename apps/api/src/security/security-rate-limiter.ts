import type {
  RateAdmissionDecision,
  RateAdmissionRequest,
  SecurityRateLimiter
} from "./security-observability.js";
import type { DatabaseSync } from "node:sqlite";

type BucketPolicy = {
  capacity: number;
  refillPerSecond: number;
};

type BucketState = {
  tokens: number;
  updatedAtMilliseconds: number;
  lastSeenMilliseconds: number;
};

export type RateLimitStatePersistence = {
  load(): Array<{ key: string; state: BucketState }>;
  upsert(key: string, state: BucketState): void;
  delete(key: string): void;
  admitAtomically?(input: {
    keys: readonly string[];
    policy: BucketPolicy;
    cost: number;
    nowMilliseconds: number;
    maximumEntries: number;
    idleMilliseconds: number;
  }): RateAdmissionDecision;
};

export class SqliteRateLimitStatePersistence
  implements RateLimitStatePersistence
{
  constructor(private readonly database: DatabaseSync) {}

  load() {
    return (
      this.database
        .prepare(
          `SELECT bucket_key, tokens, updated_at_milliseconds,
                  last_seen_milliseconds
             FROM security_rate_limit_buckets`
        )
        .all() as Array<{
        bucket_key: string;
        tokens: number;
        updated_at_milliseconds: number;
        last_seen_milliseconds: number;
      }>
    ).map((row) => ({
      key: row.bucket_key,
      state: {
        tokens: row.tokens,
        updatedAtMilliseconds: row.updated_at_milliseconds,
        lastSeenMilliseconds: row.last_seen_milliseconds
      }
    }));
  }

  upsert(key: string, state: BucketState) {
    this.database
      .prepare(
        `INSERT INTO security_rate_limit_buckets (
           bucket_key, tokens, updated_at_milliseconds, last_seen_milliseconds
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(bucket_key) DO UPDATE SET
           tokens = excluded.tokens,
           updated_at_milliseconds = excluded.updated_at_milliseconds,
           last_seen_milliseconds = excluded.last_seen_milliseconds`
      )
      .run(
        key,
        state.tokens,
        state.updatedAtMilliseconds,
        state.lastSeenMilliseconds
      );
  }

  delete(key: string) {
    this.database
      .prepare("DELETE FROM security_rate_limit_buckets WHERE bucket_key = ?")
      .run(key);
  }

  admitAtomically(input: {
    keys: readonly string[];
    policy: BucketPolicy;
    cost: number;
    nowMilliseconds: number;
    maximumEntries: number;
    idleMilliseconds: number;
  }): RateAdmissionDecision {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          "DELETE FROM security_rate_limit_buckets WHERE last_seen_milliseconds < ?"
        )
        .run(input.nowMilliseconds - input.idleMilliseconds);
      const existingCount = Number(
        (
          this.database
            .prepare(
              "SELECT COUNT(*) AS count FROM security_rate_limit_buckets"
            )
            .get() as { count: number }
        ).count
      );
      const missingKeys = input.keys.filter(
        (key) =>
          !this.database
            .prepare(
              "SELECT 1 FROM security_rate_limit_buckets WHERE bucket_key = ?"
            )
            .get(key)
      );
      const overflow = Math.max(
        0,
        existingCount + missingKeys.length - input.maximumEntries
      );
      if (overflow > 0) {
        this.database.exec("ROLLBACK");
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil(input.idleMilliseconds / 1_000)
          ),
          reason: "rate_limit_state_capacity_exceeded"
        };
      }
      const candidates = input.keys.map((key) => {
        const existing = this.database
          .prepare(
            `SELECT tokens, updated_at_milliseconds, last_seen_milliseconds
               FROM security_rate_limit_buckets
              WHERE bucket_key = ?`
          )
          .get(key) as
          | {
              tokens: number;
              updated_at_milliseconds: number;
              last_seen_milliseconds: number;
            }
          | undefined;
        const elapsedMilliseconds = Math.max(
          0,
          input.nowMilliseconds -
            (existing?.updated_at_milliseconds ?? input.nowMilliseconds)
        );
        return {
          key,
          state: {
            tokens: Math.min(
              input.policy.capacity,
              (existing?.tokens ?? input.policy.capacity) +
                (elapsedMilliseconds / 1_000) *
                  input.policy.refillPerSecond
            ),
            updatedAtMilliseconds: Math.max(
              existing?.updated_at_milliseconds ?? input.nowMilliseconds,
              input.nowMilliseconds
            ),
            lastSeenMilliseconds: input.nowMilliseconds
          }
        };
      });
      const denied = candidates.find(
        ({ state }) => state.tokens < input.cost
      );
      if (denied) {
        this.database.exec("ROLLBACK");
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil(
              (input.cost - denied.state.tokens) /
                input.policy.refillPerSecond
            )
          ),
          reason: "security_rate_limit_exceeded"
        };
      }
      for (const { key, state } of candidates) {
        state.tokens -= input.cost;
        this.upsert(key, state);
      }
      this.database.exec("COMMIT");
      return {
        allowed: true,
        remaining: Math.floor(
          Math.min(...candidates.map(({ state }) => state.tokens))
        )
      };
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // Preserve the original admission failure.
      }
      throw error;
    }
  }
}

const DEFAULT_POLICIES = {
  pairing_attempt: { capacity: 60, refillPerSecond: 0.5 },
  pairing_poll: { capacity: 30, refillPerSecond: 0.5 },
  authentication_failure: { capacity: 12, refillPerSecond: 0.1 },
  request: { capacity: 600, refillPerSecond: 20 },
  stream: { capacity: 20, refillPerSecond: 0.25 },
  mcp_tool: { capacity: 120, refillPerSecond: 2 },
  ai_cost: { capacity: 500_000, refillPerSecond: 500_000 / 3600 },
  background_job: { capacity: 120, refillPerSecond: 1 },
  machine_execution: { capacity: 30, refillPerSecond: 0.25 }
} as const satisfies Record<RateAdmissionRequest["bucket"], BucketPolicy>;

function positiveFinite(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }
  return value;
}

export class InMemorySecurityRateLimiter implements SecurityRateLimiter {
  private readonly states = new Map<string, BucketState>();
  private readonly policies: Record<
    RateAdmissionRequest["bucket"],
    BucketPolicy
  >;

  constructor(
    options: {
      policies?: Partial<
        Record<RateAdmissionRequest["bucket"], BucketPolicy>
      >;
      privateMaximumEntries?: number;
      privateIdleMilliseconds?: number;
      persistence?: RateLimitStatePersistence;
    } = {}
  ) {
    this.policies = Object.fromEntries(
      Object.entries(DEFAULT_POLICIES).map(([bucket, defaults]) => {
        const supplied =
          options.policies?.[bucket as RateAdmissionRequest["bucket"]];
        return [
          bucket,
          {
            capacity: positiveFinite(
              supplied?.capacity ?? defaults.capacity,
              `${bucket} capacity`
            ),
            refillPerSecond: positiveFinite(
              supplied?.refillPerSecond ?? defaults.refillPerSecond,
              `${bucket} refill`
            )
          }
        ];
      })
    ) as Record<RateAdmissionRequest["bucket"], BucketPolicy>;
    this.maximumEntries = options.privateMaximumEntries ?? 20_000;
    this.idleMilliseconds =
      options.privateIdleMilliseconds ?? 24 * 60 * 60 * 1_000;
    this.persistence = options.persistence ?? null;
    if (!Number.isSafeInteger(this.maximumEntries) || this.maximumEntries < 1) {
      throw new Error("Rate limiter maximum entries must be a positive integer.");
    }
    if (
      !Number.isSafeInteger(this.idleMilliseconds) ||
      this.idleMilliseconds < 1
    ) {
      throw new Error(
        "Rate limiter idle retention must be a positive integer."
      );
    }
    for (const { key, state } of this.persistence?.load() ?? []) {
      if (
        Number.isFinite(state.tokens) &&
        Number.isFinite(state.updatedAtMilliseconds) &&
        Number.isFinite(state.lastSeenMilliseconds)
      ) {
        this.states.set(key, state);
      }
    }
  }

  private readonly maximumEntries: number;
  private readonly idleMilliseconds: number;
  private readonly persistence: RateLimitStatePersistence | null;

  private keys(request: RateAdmissionRequest) {
    const identities = [
      request.principalId ? `principal:${request.principalId}` : null,
      request.clientId ? `client:${request.clientId}` : null,
      request.installationId
        ? `installation:${request.installationId}`
        : null,
      request.networkId ? `network:${request.networkId}` : null
    ].filter((value): value is string => Boolean(value));
    if (identities.length === 0) {
      identities.push("anonymous:unknown");
    }
    return [...new Set(identities)].map(
      (identity) => JSON.stringify([request.bucket, identity, request.action])
    );
  }

  private prune(nowMilliseconds: number) {
    if (this.states.size < this.maximumEntries) {
      return;
    }
    for (const [key, state] of this.states) {
      if (
        nowMilliseconds - state.lastSeenMilliseconds >
        this.idleMilliseconds
      ) {
        this.states.delete(key);
        this.persistence?.delete(key);
      }
    }
    while (this.states.size >= this.maximumEntries) {
      const oldest = this.states.keys().next().value as string | undefined;
      if (!oldest) break;
      this.states.delete(oldest);
      this.persistence?.delete(oldest);
    }
  }

  admit(request: RateAdmissionRequest): RateAdmissionDecision {
    const policy = this.policies[request.bucket];
    const cost = positiveFinite(request.cost, "Rate admission cost");
    if (cost > policy.capacity) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(cost / policy.refillPerSecond),
        reason: "request_cost_exceeds_bucket_capacity"
      };
    }
    const nowMilliseconds = request.now.getTime();
    if (!Number.isFinite(nowMilliseconds)) {
      throw new Error("Rate admission time must be valid.");
    }
    const keys = this.keys(request);
    if (this.persistence?.admitAtomically) {
      return this.persistence.admitAtomically({
        keys,
        policy,
        cost,
        nowMilliseconds,
        maximumEntries: this.maximumEntries,
        idleMilliseconds: this.idleMilliseconds
      });
    }
    if (keys.some((key) => !this.states.has(key))) {
      this.prune(nowMilliseconds);
    }
    const candidates = keys.map((key) => {
      const existing = this.states.get(key);
      const state = {
        tokens: existing?.tokens ?? policy.capacity,
        updatedAtMilliseconds:
          existing?.updatedAtMilliseconds ?? nowMilliseconds,
        lastSeenMilliseconds: nowMilliseconds
      };
      const elapsedMilliseconds = Math.max(
        0,
        nowMilliseconds - state.updatedAtMilliseconds
      );
      state.tokens = Math.min(
        policy.capacity,
        state.tokens + (elapsedMilliseconds / 1_000) * policy.refillPerSecond
      );
      state.updatedAtMilliseconds = Math.max(
        state.updatedAtMilliseconds,
        nowMilliseconds
      );
      return { key, state };
    });
    const denied = candidates.find(({ state }) => state.tokens < cost);
    if (denied) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((cost - denied.state.tokens) / policy.refillPerSecond)
        ),
        reason: "security_rate_limit_exceeded"
      };
    }
    for (const { key, state } of candidates) {
      state.tokens -= cost;
      this.states.delete(key);
      this.states.set(key, state);
      this.persistence?.upsert(key, state);
    }
    return {
      allowed: true,
      remaining: Math.floor(
        Math.min(...candidates.map(({ state }) => state.tokens))
      )
    };
  }
}
