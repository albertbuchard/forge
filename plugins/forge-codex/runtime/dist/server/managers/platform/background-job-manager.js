import { AbstractManager } from "../base.js";
import { recordDiagnosticLog } from "../../repositories/diagnostic-logs.js";
export class BackgroundJobManager extends AbstractManager {
    maxConcurrentJobs;
    name = "BackgroundJobManager";
    queue = [];
    active = new Set();
    draining = false;
    constructor(maxConcurrentJobs = 3) {
        super();
        this.maxConcurrentJobs = maxConcurrentJobs;
    }
    start() {
        return;
    }
    enqueue(input) {
        if (this.has(input.id)) {
            this.recordLifecycleLog("info", "background_job_enqueue_skipped", {
                task: input,
                message: `Skipped duplicate background job ${input.label}.`,
                details: {
                    queueDepth: this.queue.length,
                    activeCount: this.active.size
                },
                functionName: "enqueue"
            });
            return;
        }
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
    isActive(jobId) {
        return this.active.has(jobId);
    }
    has(jobId) {
        return (this.active.has(jobId) || this.queue.some((task) => task.id === jobId));
    }
    async stop() {
        this.draining = true;
        while (this.active.size > 0) {
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
    }
    scheduleDrain() {
        if (this.draining ||
            this.queue.length === 0 ||
            this.active.size >= this.maxConcurrentJobs) {
            return;
        }
        queueMicrotask(() => {
            void this.drainAvailable();
        });
    }
    async drainAvailable() {
        if (this.draining) {
            return;
        }
        while (!this.draining &&
            this.queue.length > 0 &&
            this.active.size < this.maxConcurrentJobs) {
            const next = this.queue.shift();
            if (!next) {
                return;
            }
            this.active.add(next.id);
            void this.runTask(next);
        }
    }
    async runTask(next) {
        const startedAt = Date.now();
        this.recordLifecycleLog("info", "background_job_started", {
            task: next,
            message: `Started background job ${next.label}.`,
            details: {
                queueDepth: this.queue.length,
                activeCount: this.active.size,
                maxConcurrentJobs: this.maxConcurrentJobs
            },
            functionName: "runTask"
        });
        try {
            await next.handler();
            this.recordLifecycleLog("info", "background_job_completed", {
                task: next,
                message: `Completed background job ${next.label}.`,
                details: {
                    durationMs: Date.now() - startedAt,
                    queueDepth: this.queue.length,
                    activeCount: this.active.size,
                    maxConcurrentJobs: this.maxConcurrentJobs
                },
                functionName: "runTask"
            });
        }
        catch (error) {
            this.recordLifecycleLog("error", "background_job_failed", {
                task: next,
                message: `Background job failed for ${next.label}.`,
                details: {
                    durationMs: Date.now() - startedAt,
                    queueDepth: this.queue.length,
                    activeCount: this.active.size,
                    maxConcurrentJobs: this.maxConcurrentJobs,
                    error
                },
                functionName: "runTask"
            });
            console.error(`[${this.name}] background job failed for ${next.label}:`, error);
        }
        finally {
            this.active.delete(next.id);
            this.scheduleDrain();
        }
    }
    recordLifecycleLog(level, eventKey, input) {
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
        }
        catch {
            // Diagnostics should never block job execution.
        }
    }
}
