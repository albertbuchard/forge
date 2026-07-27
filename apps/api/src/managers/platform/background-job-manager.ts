import { AbstractManager } from "../base.js";
import { recordDiagnosticLog } from "../../repositories/diagnostic-logs.js";
import type { ForgePrincipal } from "../../security/contracts.js";
import type { GatewayAuditSink } from "../../security/access-gateway.js";

export type BackgroundJobAuthorization = {
  readonly principal: ForgePrincipal;
  readonly action: string;
  readonly resource: string;
  readonly policyVersion: string;
  readonly originRequestId?: string | null;
  readonly originConnectionId?: string | null;
  readonly budget: {
    readonly maximumRuntimeMilliseconds: number;
    readonly maximumEffectInvocations: number;
    readonly capabilities: readonly string[];
  };
};

export type BackgroundJobAuthorizationPolicy = (
  authorization: BackgroundJobAuthorization
) => boolean;

export type BackgroundJobAuthorizationState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "denied";

export type BackgroundJobAuthorizationStore = {
  persist(
    jobId: string,
    authorization: BackgroundJobAuthorization
  ): BackgroundJobAuthorization;
  read(jobId: string): BackgroundJobAuthorization | null;
  transition(
    jobId: string,
    state: BackgroundJobAuthorizationState,
    reason?: string
  ): void;
};

export type BackgroundJobTask = {
  id: string;
  label: string;
  authorization: BackgroundJobAuthorization;
  resumePersistedAuthorization?: boolean;
  handler: (execution: { signal: AbortSignal }) => Promise<void>;
};

export class BackgroundJobAuthorizationError extends Error {
  readonly code = "background_job_authorization_required";

  constructor() {
    super(
      "Background job dispatch requires a current gateway-verified principal."
    );
    this.name = "BackgroundJobAuthorizationError";
  }
}

function immutableAuthorization(
  authorization: BackgroundJobAuthorization
): BackgroundJobAuthorization {
  const principal = Object.freeze({
    ...authorization.principal,
    scopes: Object.freeze([...authorization.principal.scopes])
  });
  return Object.freeze({
    principal,
    action: authorization.action,
    resource: authorization.resource,
    policyVersion: authorization.policyVersion,
    originRequestId: authorization.originRequestId ?? null,
    originConnectionId: authorization.originConnectionId ?? null,
    budget: Object.freeze({
      ...authorization.budget,
      capabilities: Object.freeze([...authorization.budget.capabilities])
    })
  });
}

export class BackgroundJobManager extends AbstractManager {
  readonly name = "BackgroundJobManager";
  private readonly queue: BackgroundJobTask[] = [];
  private active = new Set<string>();
  private draining = false;
  private authorizationPolicy: BackgroundJobAuthorizationPolicy | null = null;
  private securityAudit: GatewayAuditSink | null = null;

  constructor(
    private readonly maxConcurrentJobs = 3,
    authorizationPolicy?: BackgroundJobAuthorizationPolicy,
    private authorizationStore: BackgroundJobAuthorizationStore | null = null
  ) {
    super();
    this.authorizationPolicy = authorizationPolicy ?? null;
  }

  start() {
    return;
  }

  configureAuthorization(
    policy: BackgroundJobAuthorizationPolicy,
    store?: BackgroundJobAuthorizationStore
  ) {
    if (this.authorizationPolicy) {
      throw new Error(
        "Background job authorization has already been configured."
      );
    }
    this.authorizationPolicy = policy;
    this.authorizationStore = store ?? null;
  }

  configureSecurityAudit(audit: GatewayAuditSink) {
    if (this.securityAudit) {
      throw new Error("Background job security audit is already configured.");
    }
    this.securityAudit = audit;
  }

  authorize(authorization: BackgroundJobAuthorization) {
    if (!this.authorizationPolicy || !this.authorizationPolicy(authorization)) {
      throw new BackgroundJobAuthorizationError();
    }
    return immutableAuthorization(authorization);
  }

  enqueue(input: BackgroundJobTask) {
    let authorization: BackgroundJobAuthorization;
    try {
      authorization = this.authorize(input.authorization);
    } catch {
      this.recordLifecycleLog("error", "background_job_dispatch_denied", {
        task: input,
        message: `Denied background job dispatch for ${input.label}.`,
        details: {
          action: input.authorization.action,
          resource: input.authorization.resource,
          policyVersion: input.authorization.policyVersion,
          principalKind: input.authorization.principal.kind,
          subjectId: input.authorization.principal.subjectId,
          clientId: input.authorization.principal.clientId
        },
        functionName: "enqueue"
      });
      throw new BackgroundJobAuthorizationError();
    }
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
      this.scheduleDrain();
      return;
    }
    if (this.authorizationStore && input.resumePersistedAuthorization) {
      const persisted = this.authorizationStore.read(input.id);
      if (
        !persisted ||
        JSON.stringify(persisted) !== JSON.stringify(authorization)
      ) {
        throw new BackgroundJobAuthorizationError();
      }
      authorization = immutableAuthorization(persisted);
    } else if (this.authorizationStore) {
      authorization = immutableAuthorization(
        this.authorizationStore.persist(input.id, authorization)
      );
    }
    this.queue.push({
      ...input,
      authorization
    });
    this.recordLifecycleLog("info", "background_job_enqueued", {
      task: input,
      message: `Enqueued background job ${input.label}.`,
      details: {
        queueDepth: this.queue.length,
        activeCount: this.active.size,
        action: input.authorization.action,
        resource: input.authorization.resource,
        policyVersion: input.authorization.policyVersion,
        principalKind: input.authorization.principal.kind,
        subjectId: input.authorization.principal.subjectId,
        clientId: input.authorization.principal.clientId
      },
      functionName: "enqueue"
    });
    this.scheduleDrain();
  }

  isActive(jobId: string) {
    return this.active.has(jobId);
  }

  has(jobId: string) {
    return (
      this.active.has(jobId) || this.queue.some((task) => task.id === jobId)
    );
  }

  async stop() {
    this.draining = true;
    while (this.active.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private scheduleDrain() {
    if (
      this.draining ||
      this.queue.length === 0 ||
      this.active.size >= this.maxConcurrentJobs
    ) {
      return;
    }
    queueMicrotask(() => {
      void this.drainAvailable();
    });
  }

  private async drainAvailable() {
    if (this.draining) {
      return;
    }
    while (
      !this.draining &&
      this.queue.length > 0 &&
      this.active.size < this.maxConcurrentJobs
    ) {
      const next = this.queue.shift();
      if (!next) {
        return;
      }
      this.active.add(next.id);
      void this.runTask(next);
    }
  }

  private async runTask(next: BackgroundJobTask) {
    const startedAt = Date.now();
    try {
      const persistedAuthorization = this.authorizationStore
        ? this.authorizationStore.read(next.id)
        : next.authorization;
      if (!persistedAuthorization) {
        throw new BackgroundJobAuthorizationError();
      }
      next.authorization = this.authorize(persistedAuthorization);
      this.authorizationStore?.transition(next.id, "running");
    } catch {
      try {
        this.authorizationStore?.transition(
          next.id,
          "denied",
          "effect_time_authorization_denied"
        );
      } catch {
        // A persistence failure must not leave a denied job marked active.
      }
      this.recordLifecycleLog("error", "background_job_effect_denied", {
        task: next,
        message: `Denied background job effect for ${next.label}.`,
        details: {
          action: next.authorization.action,
          resource: next.authorization.resource,
          policyVersion: next.authorization.policyVersion,
          principalKind: next.authorization.principal.kind,
          subjectId: next.authorization.principal.subjectId,
          clientId: next.authorization.principal.clientId
        },
        functionName: "runTask"
      });
      this.active.delete(next.id);
      this.scheduleDrain();
      return;
    }
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
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        next.authorization.budget.maximumRuntimeMilliseconds
      );
      timeout.unref?.();
      try {
        await Promise.race([
          next.handler({ signal: controller.signal }),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener(
              "abort",
              () => reject(new Error("background_job_runtime_budget_exceeded")),
              { once: true }
            );
          })
        ]);
      } finally {
        clearTimeout(timeout);
      }
      this.authorizationStore?.transition(next.id, "completed");
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
    } catch (error) {
      try {
        this.authorizationStore?.transition(
          next.id,
          "failed",
          "handler_failed"
        );
      } catch {
        // The original failure remains authoritative for diagnostics.
      }
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
    const authorization = input.task.authorization;
    try {
      this.securityAudit?.record({
        requestId: authorization.originRequestId ?? input.task.id,
        connectionId: authorization.originConnectionId ?? null,
        jobId: input.task.id,
        method: "BACKGROUND",
        routePath: "internal",
        action: authorization.action,
        resource: authorization.resource,
        outcome: level === "error" ? "denied" : "admitted",
        reason: eventKey,
        principalKind: authorization.principal.kind,
        subjectId: authorization.principal.subjectId,
        clientId: authorization.principal.clientId,
        policyVersion: "forge-access-gateway/1"
      });
    } catch {
      // Security-audit persistence failures remain visible to the ledger verifier.
    }
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
