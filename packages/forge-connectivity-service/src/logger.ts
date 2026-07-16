export type SafeLogLevel = "error" | "info" | "silent" | "warn";

export type SafeLogWriter = (line: string) => void;

const LEVEL_WEIGHT: Record<Exclude<SafeLogLevel, "silent">, number> = {
  error: 3,
  warn: 2,
  info: 1
};
const SAFE_HTTP_METHODS = new Set(["DELETE", "GET", "POST", "PUT"]);

export class SafeLogger {
  readonly #level: SafeLogLevel;
  readonly #now: () => number;
  readonly #writer: SafeLogWriter;

  public constructor(
    level: SafeLogLevel,
    writer: SafeLogWriter = (line) => process.stdout.write(`${line}\n`),
    now = Date.now
  ) {
    this.#level = level;
    this.#writer = writer;
    this.#now = now;
  }

  public startup(): void {
    this.#write("info", "service_started", {});
  }

  public shutdown(signal?: "SIGINT" | "SIGTERM"): void {
    this.#write(
      "info",
      "service_stopped",
      signal === undefined ? {} : { signal }
    );
  }

  public routeCompleted(
    method: string,
    route: string,
    statusCode: number,
    durationMs: number
  ): void {
    this.#write("info", "request_completed", {
      durationBucketMs: durationBucket(durationMs),
      method: SAFE_HTTP_METHODS.has(method) ? method : "OTHER",
      route,
      statusClass: `${Math.floor(statusCode / 100)}xx`
    });
  }

  public requestRejected(
    route: string,
    code: string,
    statusCode: number
  ): void {
    this.#write("warn", "request_rejected", {
      code,
      route,
      statusClass: `${Math.floor(statusCode / 100)}xx`
    });
  }

  public cleanupFailed(code: string): void {
    this.#write("error", "cleanup_failed", { code });
  }

  public fatal(code: string): void {
    this.#write("error", "service_fatal", { code });
  }

  #write(
    level: Exclude<SafeLogLevel, "silent">,
    event: string,
    fields: Readonly<Record<string, string | number>>
  ): void {
    if (
      this.#level === "silent" ||
      LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.#level]
    ) {
      return;
    }
    this.#writer(
      JSON.stringify({
        timestamp: new Date(this.#now()).toISOString(),
        level,
        event,
        ...fields
      })
    );
  }
}

function durationBucket(durationMs: number): number {
  const buckets = [
    5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000
  ];
  return buckets.find((bucket) => durationMs <= bucket) ?? 60_000;
}
