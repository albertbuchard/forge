import { ServiceError } from "./errors.js";

type WakeReason = "aborted" | "closed" | "notified" | "timeout";

interface Waiter {
  finish: (reason: WakeReason) => void;
}

export class PollCoordinator {
  readonly #channelCounts = new Map<string, number>();
  readonly #generations = new Map<string, number>();
  readonly #maxChannelConcurrent: number;
  readonly #maxGlobalConcurrent: number;
  readonly #maxTrackedChannels: number;
  readonly #waiters = new Map<string, Set<Waiter>>();
  #active = 0;
  #closed = false;

  public constructor(
    maxGlobalConcurrent: number,
    maxChannelConcurrent: number,
    maxTrackedChannels = 10_000
  ) {
    this.#maxGlobalConcurrent = maxGlobalConcurrent;
    this.#maxChannelConcurrent = maxChannelConcurrent;
    this.#maxTrackedChannels = Math.max(
      maxTrackedChannels,
      maxGlobalConcurrent
    );
  }

  public generation(channelHash: string): number {
    const generation = this.#generations.get(channelHash);
    if (generation !== undefined) {
      this.#generations.delete(channelHash);
      this.#generations.set(channelHash, generation);
      return generation;
    }
    this.#evictGenerationIfNeeded();
    this.#generations.set(channelHash, 0);
    return 0;
  }

  public async wait(
    channelHash: string,
    timeoutMs: number,
    sinceGeneration: number,
    signal?: AbortSignal
  ): Promise<WakeReason> {
    if (this.#closed) {
      throw new ServiceError(
        "SERVICE_CLOSING",
        503,
        "The service is shutting down."
      );
    }
    if (signal?.aborted === true) {
      return "aborted";
    }
    const channelActive = this.#channelCounts.get(channelHash) ?? 0;
    if (
      this.#active >= this.#maxGlobalConcurrent ||
      channelActive >= this.#maxChannelConcurrent
    ) {
      throw new ServiceError(
        "POLL_LIMIT_EXCEEDED",
        429,
        "The concurrent long-poll limit was exceeded.",
        {
          "retry-after": "1"
        }
      );
    }

    this.#active += 1;
    this.#channelCounts.set(channelHash, channelActive + 1);

    if (this.generation(channelHash) !== sinceGeneration) {
      this.#removeCount(channelHash);
      return "notified";
    }

    return new Promise<WakeReason>((resolve) => {
      let settled = false;
      const waiter: Waiter = {
        finish: (reason) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          this.#remove(channelHash, waiter);
          resolve(reason);
        }
      };
      const abort = (): void => waiter.finish("aborted");
      const timer = setTimeout(() => waiter.finish("timeout"), timeoutMs);
      timer.unref();

      const channelWaiters =
        this.#waiters.get(channelHash) ?? new Set<Waiter>();
      channelWaiters.add(waiter);
      this.#waiters.set(channelHash, channelWaiters);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted === true) {
        waiter.finish("closed");
      }
    });
  }

  public notify(channelHash: string): void {
    const waiters = this.#waiters.get(channelHash);
    if (waiters === undefined && !this.#generations.has(channelHash)) {
      return;
    }
    this.#generations.set(channelHash, this.generation(channelHash) + 1);
    if (waiters === undefined) {
      return;
    }
    for (const waiter of [...waiters]) {
      waiter.finish("notified");
    }
  }

  public close(): void {
    this.#closed = true;
    for (const waiters of this.#waiters.values()) {
      for (const waiter of [...waiters]) {
        waiter.finish("closed");
      }
    }
  }

  #remove(channelHash: string, waiter: Waiter): void {
    const waiters = this.#waiters.get(channelHash);
    waiters?.delete(waiter);
    if (waiters?.size === 0) {
      this.#waiters.delete(channelHash);
    }
    this.#removeCount(channelHash);
  }

  #removeCount(channelHash: string): void {
    const count = (this.#channelCounts.get(channelHash) ?? 1) - 1;
    if (count <= 0) {
      this.#channelCounts.delete(channelHash);
    } else {
      this.#channelCounts.set(channelHash, count);
    }
    this.#active = Math.max(0, this.#active - 1);
  }

  #evictGenerationIfNeeded(): void {
    if (this.#generations.size < this.#maxTrackedChannels) {
      return;
    }
    for (const candidate of this.#generations.keys()) {
      if (!this.#channelCounts.has(candidate)) {
        this.#generations.delete(candidate);
        return;
      }
    }
  }
}
