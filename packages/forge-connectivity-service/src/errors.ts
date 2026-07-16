export const SERVICE_ERROR_CODES = [
  "AMBIGUOUS_REQUEST_HEADERS",
  "AUTH_INVALID",
  "AUTH_REPLAYED",
  "AUTH_STALE",
  "BLOB_INVALID",
  "BLOB_TOO_LARGE",
  "CONTENT_ENCODING_UNSUPPORTED",
  "CONTENT_TYPE_UNSUPPORTED",
  "CREDENTIAL_NOT_ALLOWED",
  "CURSOR_INVALID",
  "IDEMPOTENCY_CONFLICT",
  "IDEMPOTENCY_REQUIRED",
  "INTERNAL_ERROR",
  "NOT_FOUND",
  "POLL_LIMIT_EXCEEDED",
  "QUOTA_EXCEEDED",
  "RATE_LIMITED",
  "REPLAY_CONFLICT",
  "REQUEST_BODY_NOT_ALLOWED",
  "SENSITIVE_METADATA_NOT_ALLOWED",
  "SERVICE_CLOSING",
  "STORAGE_UNAVAILABLE",
  "VALIDATION_ERROR"
] as const;

export type ServiceErrorCode = (typeof SERVICE_ERROR_CODES)[number];

export class ServiceError extends Error {
  public readonly code: ServiceErrorCode;
  public readonly headers: Readonly<Record<string, string>>;
  public readonly statusCode: number;

  public constructor(
    code: ServiceErrorCode,
    statusCode: number,
    message: string,
    headers: Readonly<Record<string, string>> = {}
  ) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.statusCode = statusCode;
    this.headers = headers;
  }
}

export function unauthorized(
  code: "AUTH_INVALID" | "AUTH_REPLAYED" | "AUTH_STALE"
): ServiceError {
  const messages: Record<typeof code, string> = {
    AUTH_INVALID: "A valid ForgeChannel request signature is required.",
    AUTH_REPLAYED: "The signed request nonce has already been used.",
    AUTH_STALE: "The signed request timestamp is outside the accepted window."
  };
  return new ServiceError(code, 401, messages[code], {
    "www-authenticate": 'ForgeChannel realm="forge-connectivity", version="1"'
  });
}

export function rateLimited(retryAfterSeconds: number): ServiceError {
  return new ServiceError(
    "RATE_LIMITED",
    429,
    "The request rate limit was exceeded.",
    {
      "retry-after": String(Math.max(1, Math.ceil(retryAfterSeconds)))
    }
  );
}
