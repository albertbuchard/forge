export class ManagerError extends Error {
    code;
    statusCode;
    details;
    constructor(message, code, statusCode, details) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
        this.name = "ManagerError";
    }
}
export class AuthRequiredError extends ManagerError {
    constructor(message = "Authentication is required", details) {
        super(message, "auth_required", 401, details);
    }
}
export class AuthorizationDeniedError extends ManagerError {
    constructor(message = "Authorization denied", details) {
        super(message, "authorization_denied", 403, details);
    }
}
export class InsufficientScopeError extends ManagerError {
    constructor(message = "Insufficient scope", details) {
        super(message, "insufficient_scope", 403, details);
    }
}
export class ApprovalRequiredError extends ManagerError {
    constructor(message = "Approval is required", details) {
        super(message, "approval_required", 409, details);
    }
}
export class ConcurrencyConflictError extends ManagerError {
    constructor(message = "Concurrency conflict", details) {
        super(message, "concurrency_conflict", 409, details);
    }
}
export class ProviderUnavailableError extends ManagerError {
    constructor(message = "Provider unavailable", details) {
        super(message, "provider_unavailable", 503, details);
    }
}
export class ValidationFailedError extends ManagerError {
    constructor(message = "Validation failed", details) {
        super(message, "validation_failed", 400, details);
    }
}
