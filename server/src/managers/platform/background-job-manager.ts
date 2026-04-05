import { AbstractManager } from "../base.js";

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
    try {
      await next.handler();
    } catch (error) {
      console.error(
        `[${this.name}] background job failed for ${next.label}:`,
        error
      );
    } finally {
      this.active.delete(next.id);
      this.scheduleDrain();
    }
  }
}
