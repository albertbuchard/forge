import { DatabaseSync } from "node:sqlite";
import { z } from "zod";

import type {
  BackgroundJobAuthorization,
  BackgroundJobAuthorizationState,
  BackgroundJobAuthorizationStore
} from "../managers/platform/background-job-manager.js";
import type { SecurityClock } from "./security-runtime.js";

export const SECURITY_BACKGROUND_JOB_AUTHORIZATION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS security_background_job_authorizations (
  job_id TEXT PRIMARY KEY,
  principal_json TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  origin_request_id TEXT,
  origin_connection_id TEXT,
  budget_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('queued', 'running', 'completed', 'failed', 'denied')
  ),
  denial_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_security_background_job_state
  ON security_background_job_authorizations (state, updated_at);
`;

const principalSchema = z
  .object({
    kind: z.enum([
      "operator_session",
      "paired_client",
      "legacy_agent_token",
      "companion_session",
      "peer_device",
      "local_service",
      "system"
    ]),
    subjectId: z.string().min(1),
    ownerId: z.string().min(1),
    clientId: z.string().min(1).nullable(),
    installationId: z.string().min(1).nullable(),
    audience: z.string().min(1),
    scopes: z.array(z.string().min(1)).min(1),
    profile: z.enum([
      "viewer",
      "trusted_personal_assistant",
      "executor",
      "operator",
      "custom"
    ]),
    ownerSecurityEpoch: z.number().int().positive(),
    clientSecurityEpoch: z.number().int().positive().nullable(),
    authenticatedAt: z.string().datetime(),
    runtimeBinding: z.string().min(1).optional()
  })
  .strict();

const authorizationSchema = z
  .object({
    principal: principalSchema,
    action: z.string().trim().min(1).max(256),
    resource: z.string().trim().min(1).max(512),
    policyVersion: z.string().trim().min(1).max(128),
    originRequestId: z.string().trim().min(1).max(256).nullable().default(null),
    originConnectionId: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .nullable()
      .default(null),
    budget: z
      .object({
        maximumRuntimeMilliseconds: z.number().int().positive().max(86_400_000),
        maximumEffectInvocations: z.literal(1),
        capabilities: z.array(z.string().trim().min(1).max(256)).min(1).max(32)
      })
      .strict()
  })
  .strict();

const transitionReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9_.-]*$/);

type AuthorizationRow = {
  principal_json: string;
  action: string;
  resource: string;
  policy_version: string;
  origin_request_id: string | null;
  origin_connection_id: string | null;
  budget_json: string;
};

function parseAuthorization(input: unknown): BackgroundJobAuthorization {
  const parsed = authorizationSchema.parse(input);
  return {
    ...parsed,
    principal: {
      ...parsed.principal,
      scopes: Object.freeze([...parsed.principal.scopes])
    }
  };
}

export class SqliteBackgroundJobAuthorizationStore implements BackgroundJobAuthorizationStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly clock: SecurityClock = { now: () => new Date() }
  ) {}

  initializeSchema() {
    this.database.exec(SECURITY_BACKGROUND_JOB_AUTHORIZATION_SCHEMA_SQL);
  }

  persist(jobId: string, authorization: BackgroundJobAuthorization) {
    const normalizedJobId = z.string().trim().min(1).max(256).parse(jobId);
    const parsed = parseAuthorization(authorization);
    const now = this.clock.now().toISOString();
    this.database
      .prepare(
        `INSERT INTO security_background_job_authorizations (
           job_id, principal_json, action, resource, policy_version, state,
           origin_request_id, origin_connection_id, budget_json, denial_reason,
           created_at, updated_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, NULL, ?, ?, NULL)`
      )
      .run(
        normalizedJobId,
        JSON.stringify(parsed.principal),
        parsed.action,
        parsed.resource,
        parsed.policyVersion,
        parsed.originRequestId ?? null,
        parsed.originConnectionId ?? null,
        JSON.stringify(parsed.budget),
        now,
        now
      );
    const persisted = this.read(normalizedJobId);
    if (!persisted) {
      throw new Error(
        "Forge could not persist the background job authorization."
      );
    }
    return persisted;
  }

  read(jobId: string) {
    const normalizedJobId = z.string().trim().min(1).max(256).parse(jobId);
    const row = this.database
      .prepare(
        `SELECT principal_json, action, resource, policy_version,
                origin_request_id, origin_connection_id, budget_json
         FROM security_background_job_authorizations
         WHERE job_id = ?`
      )
      .get(normalizedJobId) as AuthorizationRow | undefined;
    if (!row) {
      return null;
    }
    return parseAuthorization({
      principal: JSON.parse(row.principal_json) as unknown,
      action: row.action,
      resource: row.resource,
      policyVersion: row.policy_version,
      originRequestId: row.origin_request_id,
      originConnectionId: row.origin_connection_id,
      budget: JSON.parse(row.budget_json) as unknown
    });
  }

  transition(
    jobId: string,
    state: BackgroundJobAuthorizationState,
    reason?: string
  ) {
    const normalizedJobId = z.string().trim().min(1).max(256).parse(jobId);
    const normalizedState = z
      .enum(["queued", "running", "completed", "failed", "denied"])
      .parse(state);
    const normalizedReason =
      reason === undefined ? null : transitionReasonSchema.parse(reason);
    if (normalizedState === "denied" && !normalizedReason) {
      throw new Error(
        "Forge requires a bounded reason for a denied background effect."
      );
    }
    const now = this.clock.now().toISOString();
    const terminal = ["completed", "failed", "denied"].includes(
      normalizedState
    );
    const result = this.database
      .prepare(
        `UPDATE security_background_job_authorizations
         SET state = ?, denial_reason = ?, updated_at = ?, completed_at = ?
         WHERE job_id = ?`
      )
      .run(
        normalizedState,
        normalizedReason,
        now,
        terminal ? now : null,
        normalizedJobId
      );
    if (result.changes !== 1) {
      throw new Error(
        "Forge refused a background authorization transition without a persisted job."
      );
    }
  }
}
