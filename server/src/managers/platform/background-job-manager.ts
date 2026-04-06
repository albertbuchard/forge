import { AbstractManager } from "../base.js";
import { recordDiagnosticLog } from "../../repositories/diagnostic-logs.js";

type BackgroundJobTask = {
  id: string;
  label: string;
  handler: () => Promise<void>;
};

export class BackgroundJobManager extends AbstractManager {
  readonly name = "BackgroundJobManager";
  private readonly queue: BackgroundJobTask[] = [];
  private active = new Set<string>();
  private draining = false;

  start() {
    return;
  }

  enqueue(input: BackgroundJobTask) {
    this.queue.push(input);
    this.recordLifecycleLog("info", "background_job_enqueued", {
      task: input,
      message: `Enqueued background job ${input.label}.`,
      details: {
        queueDepth: this.queue.length,
        activeCount: this.active.size
      },
      functionName: "enqueue"
    });
    this.scheduleDrain();
  }

  isActive(jobId: string) {
    return this.active.has(jobId);
  }

  async stop() {
    this.draining = true;
    while (this.active.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private scheduleDrain() {
    if (this.draining || this.queue.length === 0) {
      return;
    }
    queueMicrotask(() => {
      void this.drainNext();
    });
  }

  private async drainNext() {
    if (this.draining || this.active.size > 0) {
      return;
    }
    const next = this.queue.shift();
    if (!next) {
      return;
    }
    this.active.add(next.id);
    const startedAt = Date.now();
    this.recordLifecycleLog("info", "background_job_started", {
      task: next,
      message: `Started background job ${next.label}.`,
      details: {
        queueDepth: this.queue.length,
        activeCount: this.active.size
      },
      functionName: "drainNext"
    });
    try {
      await next.handler();
      this.recordLifecycleLog("info", "background_job_completed", {
        task: next,
        message: `Completed background job ${next.label}.`,
        details: {
          durationMs: Date.now() - startedAt,
          queueDepth: this.queue.length,
          activeCount: this.active.size
        },
        functionName: "drainNext"
      });
    } catch (error) {
      this.recordLifecycleLog("error", "background_job_failed", {
        task: next,
        message: `Background job failed for ${next.label}.`,
        details: {
          durationMs: Date.now() - startedAt,
          queueDepth: this.queue.length,
          activeCount: this.active.size,
          error
        },
        functionName: "drainNext"
      });
      console.error(
        `[${this.name}] background job failed for ${next.label}:`,
        error
      );
    } finally {
      this.active.delete(next.id);
      this.scheduleDrain();
    }
  }

  private recordLifecycleLog(
    level: "info" | "error",
    eventKey: string,
    input: {
      task: BackgroundJobTask;
      message: string;
      details?: Record<string, unknown>;
      functionName: string;
    }
  ) {
    try {
      recordDiagnosticLog({
        level,
        source: "system",
        scope: "background_job",
        eventKey,
        message: input.message,
        functionName: input.functionName,
        entityType: "background_job",
        entityId: input.task.id,
        jobId: input.task.id,
        details: {
          label: input.task.label,
          ...(input.details ?? {})
        }
      });
    } catch {
      // Diagnostics should never block job execution.
    }
  }
}
