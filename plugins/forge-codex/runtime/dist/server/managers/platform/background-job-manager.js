import { AbstractManager } from "../base.js";
export class BackgroundJobManager extends AbstractManager {
    name = "BackgroundJobManager";
    queue = [];
    active = new Set();
    draining = false;
    start() {
        return;
    }
    enqueue(input) {
        this.queue.push(input);
        this.scheduleDrain();
    }
    isActive(jobId) {
        return this.active.has(jobId);
    }
    async stop() {
        this.draining = true;
        while (this.active.size > 0) {
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
    }
    scheduleDrain() {
        if (this.draining || this.queue.length === 0) {
            return;
        }
        queueMicrotask(() => {
            void this.drainNext();
        });
    }
    async drainNext() {
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
        }
        catch (error) {
            console.error(`[${this.name}] background job failed for ${next.label}:`, error);
        }
        finally {
            this.active.delete(next.id);
            this.scheduleDrain();
        }
    }
}
