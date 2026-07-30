import type { ForgePrincipalKind } from "./contracts.js";
import { redactSecretValues } from "./secret-redaction.js";

export type SecurityAuditEvent = {
  eventId: string;
  occurredAt: string;
  subjectId: string | null;
  principalKind: ForgePrincipalKind | "anonymous";
  clientId: string | null;
  action: string;
  resource: string;
  outcome: "allowed" | "denied" | "error";
  reason: string;
  policyVersion: number;
  requestId: string | null;
  connectionId: string | null;
  jobId: string | null;
  transportContext: {
    remoteAddress: string | null;
    tailscaleIdentity: string | null;
  };
  detail: Record<string, string | number | boolean | null>;
};

export interface SecurityAuditSink {
  record(event: SecurityAuditEvent): void;
}

export type RateAdmissionRequest = {
  bucket:
    | "pairing_attempt"
    | "pairing_poll"
    | "local_owner_auth"
    | "authentication_failure"
    | "request"
    | "stream"
    | "mcp_tool"
    | "ai_cost"
    | "background_job"
    | "machine_execution";
  principalId: string | null;
  clientId: string | null;
  installationId: string | null;
  networkId: string | null;
  action: string;
  cost: number;
  now: Date;
};

export type RateAdmissionDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number; reason: string };

export interface SecurityRateLimiter {
  admit(request: RateAdmissionRequest): RateAdmissionDecision;
}

const SENSITIVE_DETAIL_KEY =
  /(authorization|cookie|token|secret|password|assertion|proof|credential|code)/i;

export function redactSecurityAuditDetail(
  detail: Record<string, unknown>
): Record<string, string | number | boolean | null> {
  const redacted: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (SENSITIVE_DETAIL_KEY.test(key)) {
      redacted[key] = "[redacted]";
      continue;
    }
    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      redacted[key] = value;
    } else if (typeof value === "string") {
      redacted[key] = redactSecretValues(value).value;
    } else {
      redacted[key] = "[structured value omitted]";
    }
  }
  return redacted;
}
