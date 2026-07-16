interface Bucket {
  lastRefillMs: number;
  tokens: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export class TokenBucketRateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #capacity: number;
  readonly #maxKeys: number;
  readonly #refillPerMs: number;
  #overflowBucket: Bucket | undefined;

  public constructor(
    requestsPerMinute: number,
    maxKeys: number,
    burstCapacity = requestsPerMinute
  ) {
    if (
      !Number.isSafeInteger(requestsPerMinute) ||
      requestsPerMinute < 1 ||
      !Number.isSafeInteger(maxKeys) ||
      maxKeys < 1 ||
      !Number.isSafeInteger(burstCapacity) ||
      burstCapacity < 1 ||
      burstCapacity > requestsPerMinute
    ) {
      throw new RangeError("Rate limiter bounds are invalid.");
    }
    this.#capacity = burstCapacity;
    this.#refillPerMs = requestsPerMinute / 60_000;
    this.#maxKeys = maxKeys;
  }

  public consume(key: string, nowMs: number): RateLimitDecision {
    if (!Number.isFinite(nowMs)) {
      throw new RangeError("Rate limiter time must be finite.");
    }
    let bucket = this.#buckets.get(key);
    if (bucket === undefined) {
      this.#evictRefilledBucket(nowMs);
      if (this.#buckets.size < this.#maxKeys) {
        bucket = this.#newBucket(nowMs);
        this.#buckets.set(key, bucket);
      } else {
        this.#overflowBucket ??= this.#newBucket(nowMs);
        bucket = this.#overflowBucket;
      }
    } else {
      this.#buckets.delete(key);
      this.#buckets.set(key, bucket);
    }

    const elapsed = Math.max(0, nowMs - bucket.lastRefillMs);
    bucket.tokens = Math.min(
      this.#capacity,
      bucket.tokens + elapsed * this.#refillPerMs
    );
    bucket.lastRefillMs = Math.max(bucket.lastRefillMs, nowMs);

    if (bucket.tokens < 1) {
      return {
        allowed: false,
        retryAfterSeconds: (1 - bucket.tokens) / this.#refillPerMs / 1_000
      };
    }

    bucket.tokens -= 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  #evictRefilledBucket(nowMs: number): void {
    if (this.#buckets.size < this.#maxKeys) {
      return;
    }
    for (const [candidate, bucket] of this.#buckets) {
      const elapsed = Math.max(0, nowMs - bucket.lastRefillMs);
      if (bucket.tokens + elapsed * this.#refillPerMs >= this.#capacity) {
        this.#buckets.delete(candidate);
        return;
      }
    }
  }

  #newBucket(nowMs: number): Bucket {
    return { lastRefillMs: nowMs, tokens: this.#capacity };
  }
}
