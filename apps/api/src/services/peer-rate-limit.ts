export class PeerRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Peer operation rate limit exceeded.");
    this.name = "PeerRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

type Bucket = {
  windowStartedAt: number;
  count: number;
  lastSeenAt: number;
};

export class PeerOperationRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly maximumBuckets = 10_000,
    private readonly windowMs = 60_000
  ) {}

  consume(input: {
    operationId: string;
    principalId: string;
    limit: number;
    now?: Date;
  }) {
    const now = (input.now ?? new Date()).getTime();
    if (
      !Number.isFinite(now) ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100_000
    ) {
      throw new Error("Peer rate-limit input is invalid.");
    }
    const key = `${input.operationId}\0${input.principalId}`;
    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStartedAt >= this.windowMs) {
      bucket = { windowStartedAt: now, count: 0, lastSeenAt: now };
      this.buckets.set(key, bucket);
    }
    bucket.lastSeenAt = now;
    if (bucket.count >= input.limit) {
      throw new PeerRateLimitError(
        Math.max(
          1,
          Math.ceil((bucket.windowStartedAt + this.windowMs - now) / 1_000)
        )
      );
    }
    bucket.count += 1;
    if (this.buckets.size > this.maximumBuckets) {
      this.compact(now);
    }
    return {
      limit: input.limit,
      remaining: Math.max(0, input.limit - bucket.count),
      resetsAt: new Date(bucket.windowStartedAt + this.windowMs).toISOString()
    };
  }

  private compact(now: number) {
    const staleBefore = now - this.windowMs * 2;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastSeenAt < staleBefore) {
        this.buckets.delete(key);
      }
    }
    if (this.buckets.size <= this.maximumBuckets) {
      return;
    }
    const oldest = [...this.buckets.entries()]
      .sort((left, right) => left[1].lastSeenAt - right[1].lastSeenAt)
      .slice(0, this.buckets.size - this.maximumBuckets);
    for (const [key] of oldest) {
      this.buckets.delete(key);
    }
  }
}
