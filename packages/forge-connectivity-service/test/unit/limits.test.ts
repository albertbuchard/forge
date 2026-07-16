import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PollCoordinator } from "../../src/poll-coordinator.js";
import { TokenBucketRateLimiter } from "../../src/rate-limiter.js";

describe("token bucket rate limiting", () => {
  it("bounds bursts and refills continuously", () => {
    const limiter = new TokenBucketRateLimiter(2, 10);
    assert.equal(limiter.consume("channel", 0).allowed, true);
    assert.equal(limiter.consume("channel", 0).allowed, true);
    const denied = limiter.consume("channel", 0);
    assert.equal(denied.allowed, false);
    assert.equal(Math.ceil(denied.retryAfterSeconds), 30);
    assert.equal(limiter.consume("channel", 30_000).allowed, true);
  });

  it("does not reset a depleted channel during identity churn", () => {
    const limiter = new TokenBucketRateLimiter(1, 2);
    assert.equal(limiter.consume("victim", 0).allowed, true);
    assert.equal(limiter.consume("victim", 0).allowed, false);
    assert.equal(limiter.consume("churn-a", 0).allowed, true);
    assert.equal(limiter.consume("churn-b", 0).allowed, true);
    assert.equal(limiter.consume("churn-c", 0).allowed, false);
    assert.equal(limiter.consume("victim", 0).allowed, false);
    assert.equal(limiter.consume("victim", 60_000).allowed, true);
  });

  it("does not double-refill when the wall clock moves backward", () => {
    const limiter = new TokenBucketRateLimiter(2, 1);
    assert.equal(limiter.consume("channel", 1_000).allowed, true);
    assert.equal(limiter.consume("channel", 1_000).allowed, true);
    assert.equal(limiter.consume("channel", 0).allowed, false);
    assert.equal(limiter.consume("channel", 30_000).allowed, false);
    assert.equal(limiter.consume("channel", 31_000).allowed, true);
  });
});

describe("long-poll admission", () => {
  it("enforces per-channel concurrency and wakes waiters", async () => {
    const coordinator = new PollCoordinator(2, 1);
    const generation = coordinator.generation("channel");
    const first = coordinator.wait("channel", 1_000, generation);

    await assert.rejects(
      coordinator.wait("channel", 1_000, generation),
      /concurrent long-poll limit/
    );
    coordinator.notify("channel");
    assert.equal(await first, "notified");
    coordinator.close();
  });

  it("does not miss a notification observed before waiter registration", async () => {
    const coordinator = new PollCoordinator(2, 1);
    const generation = coordinator.generation("channel");
    coordinator.notify("channel");
    assert.equal(
      await coordinator.wait("channel", 1_000, generation),
      "notified"
    );
    coordinator.close();
  });

  it("releases admission immediately for an already-aborted request", async () => {
    const coordinator = new PollCoordinator(1, 1);
    const abort = new AbortController();
    abort.abort();

    assert.equal(
      await coordinator.wait(
        "channel",
        1_000,
        coordinator.generation("channel"),
        abort.signal
      ),
      "aborted"
    );
    const generation = coordinator.generation("channel");
    const admitted = coordinator.wait("channel", 1_000, generation);
    coordinator.notify("channel");
    assert.equal(await admitted, "notified");
    coordinator.close();
  });
});
