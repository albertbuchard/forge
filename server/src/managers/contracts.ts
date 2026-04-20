export type ManagerContext = {
  now?: Date;
  correlationId?: string | null;
  requestId?: string | null;
};

export type ActorContext = {
  actor: string | null;
  source: "ui" | "agent" | "openclaw" | "system";
};

export type RequestContext = ManagerContext &
  ActorContext & {
    origin: string | null;
    host: string | null;
    ip: string | null;
  };

export type AuthContext = RequestContext & {
  token: {
    id: string;
    agentId: string | null;
    agentLabel: string | null;
    scopes: string[];
    trustLevel: string;
    autonomyMode: string;
    approvalMode: string;
    bootstrapPolicy: {
      mode: "disabled" | "active_only" | "scoped" | "full";
      goalsLimit: number;
      projectsLimit: number;
      tasksLimit: number;
      habitsLimit: number;
      strategiesLimit: number;
      peoplePageLimit: number;
      includePeoplePages: boolean;
    };
  } | null;
  session: {
    id: string;
    actorLabel: string;
    expiresAt: string;
  } | null;
};

export type CapabilityContext = AuthContext & {
  canManageOperator: boolean;
};

export type ManagerResult<T> = {
  value: T;
  auth: AuthContext;
};

export interface SubsystemManager {
  readonly name: string;
}

export interface ReadableManager<TQuery, TResult> extends SubsystemManager {
  read(query: TQuery, context: AuthContext): Promise<TResult> | TResult;
}

export interface WritableManager<TInput, TResult> extends SubsystemManager {
  write(input: TInput, context: AuthContext): Promise<TResult> | TResult;
}

export interface VersionedManager<TRecord, TPatch> extends SubsystemManager {
  create(input: TRecord, context: AuthContext): Promise<TRecord> | TRecord;
  update(id: string, patch: TPatch, context: AuthContext): Promise<TRecord | null> | TRecord | null;
}

export interface ExternalBackedManager<TProviderConfig> extends SubsystemManager {
  configure(config: TProviderConfig): Promise<void> | void;
}

export interface StoreAdapter<TRecord, TQuery = unknown, TPatch = unknown> {
  get(id: string): Promise<TRecord | null> | TRecord | null;
  list?(query: TQuery): Promise<TRecord[]> | TRecord[];
  create?(input: TRecord): Promise<TRecord> | TRecord;
  update?(id: string, patch: TPatch): Promise<TRecord | null> | TRecord | null;
}

export interface ExternalApiAdapter<TRequest, TResponse> {
  request(input: TRequest): Promise<TResponse> | TResponse;
}

export interface EventSinkAdapter<TEvent = Record<string, unknown>> {
  publish(event: TEvent): Promise<void> | void;
}

export interface SecretStoreAdapter {
  createSecret(prefix: string): string;
  hashSecret(value: string): string;
  secureEquals(left: string, right: string): boolean;
}

export interface SessionStoreAdapter<TSession> extends StoreAdapter<TSession, { activeOnly?: boolean }, Partial<TSession>> {}

export interface AssetStoreAdapter {
  resolveClientDir(): string;
  resolveDataDir(): string;
}

export interface SearchAdapter<TQuery, TResult> {
  query(input: TQuery): Promise<TResult> | TResult;
}

export class ManagerError extends Error {
  constructor(message: string, readonly code: string, readonly statusCode: number, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "ManagerError";
  }
}

export class AuthRequiredError extends ManagerError {
  constructor(message = "Authentication is required", details?: Record<string, unknown>) {
    super(message, "auth_required", 401, details);
  }
}

export class AuthorizationDeniedError extends ManagerError {
  constructor(message = "Authorization denied", details?: Record<string, unknown>) {
    super(message, "authorization_denied", 403, details);
  }
}

export class InsufficientScopeError extends ManagerError {
  constructor(message = "Insufficient scope", details?: Record<string, unknown>) {
    super(message, "insufficient_scope", 403, details);
  }
}

export class ApprovalRequiredError extends ManagerError {
  constructor(message = "Approval is required", details?: Record<string, unknown>) {
    super(message, "approval_required", 409, details);
  }
}

export class ConcurrencyConflictError extends ManagerError {
  constructor(message = "Concurrency conflict", details?: Record<string, unknown>) {
    super(message, "concurrency_conflict", 409, details);
  }
}

export class ProviderUnavailableError extends ManagerError {
  constructor(message = "Provider unavailable", details?: Record<string, unknown>) {
    super(message, "provider_unavailable", 503, details);
  }
}

export class ValidationFailedError extends ManagerError {
  constructor(message = "Validation failed", details?: Record<string, unknown>) {
    super(message, "validation_failed", 400, details);
  }
}
