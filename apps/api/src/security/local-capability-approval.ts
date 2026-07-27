import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

import type { ForgePrincipal } from "./contracts.js";

export const LOCAL_OWNER_LEGACY_EXECUTION_CAPABILITY =
  "local_owner_legacy_host_execution" as const;
export const LOCAL_OWNER_LEGACY_WARNING_VERSION = 1 as const;
export const LOCAL_OWNER_LEGACY_WARNING =
  "This setting lets explicitly authorized same-machine owner sessions and local legacy executor clients run unrestricted commands as your operating-system account. Commands can read, change, or delete anything that your account can access. Remote and paired clients remain excluded.";

export class LocalCapabilityApprovalError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LocalCapabilityApprovalError";
    this.code = code;
  }
}

function requireRecentLocalOwner(input: {
  principal: ForgePrincipal;
  directOwnerChannel: boolean;
  now: Date;
  maximumAuthenticationAgeMilliseconds: number;
}) {
  const authenticatedAt = Date.parse(input.principal.authenticatedAt);
  if (
    !input.directOwnerChannel ||
    input.principal.kind !== "operator_session" ||
    input.principal.profile !== "operator" ||
    !input.principal.scopes.includes("*") ||
    !Number.isFinite(authenticatedAt) ||
    authenticatedAt > input.now.getTime() ||
    input.now.getTime() - authenticatedAt >
      input.maximumAuthenticationAgeMilliseconds
  ) {
    throw new LocalCapabilityApprovalError(
      "recent_local_owner_required",
      "Changing unrestricted local execution requires a recent, direct same-machine owner session."
    );
  }
}

export class LocalCapabilityApprovalService {
  private readonly now: () => Date;
  private readonly maximumAuthenticationAgeMilliseconds: number;

  constructor(
    private readonly database: DatabaseSync,
    private readonly ownerId: string,
    private readonly installationId: string,
    options: {
      now?: () => Date;
      maximumAuthenticationAgeMilliseconds?: number;
    } = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.maximumAuthenticationAgeMilliseconds =
      options.maximumAuthenticationAgeMilliseconds ?? 5 * 60 * 1_000;
  }

  read() {
    const row = this.database
      .prepare(
        `SELECT warning_version, approved_at, approved_by_subject_id, revoked_at
           FROM security_local_capability_approvals
          WHERE owner_id = ?
            AND installation_id = ?
            AND capability_id = ?`
      )
      .get(
        this.ownerId,
        this.installationId,
        LOCAL_OWNER_LEGACY_EXECUTION_CAPABILITY
      ) as
      | {
          warning_version: number;
          approved_at: string;
          approved_by_subject_id: string;
          revoked_at: string | null;
        }
      | undefined;
    const enabled = Boolean(
      row &&
      row.warning_version === LOCAL_OWNER_LEGACY_WARNING_VERSION &&
      !row.revoked_at
    );
    return Object.freeze({
      capability: LOCAL_OWNER_LEGACY_EXECUTION_CAPABILITY,
      enabled,
      warningVersion: LOCAL_OWNER_LEGACY_WARNING_VERSION,
      warning: LOCAL_OWNER_LEGACY_WARNING,
      approvedAt: enabled ? row!.approved_at : null,
      revokedAt: row?.revoked_at ?? null
    });
  }

  approve(input: {
    principal: ForgePrincipal;
    directOwnerChannel: boolean;
    warningVersion: number;
    acknowledged: boolean;
  }) {
    const now = this.now();
    requireRecentLocalOwner({
      principal: input.principal,
      directOwnerChannel: input.directOwnerChannel,
      now,
      maximumAuthenticationAgeMilliseconds:
        this.maximumAuthenticationAgeMilliseconds
    });
    if (
      input.warningVersion !== LOCAL_OWNER_LEGACY_WARNING_VERSION ||
      input.acknowledged !== true
    ) {
      throw new LocalCapabilityApprovalError(
        "warning_acknowledgement_required",
        "The current unrestricted-execution warning must be explicitly acknowledged."
      );
    }
    const timestamp = now.toISOString();
    const warningSha256 = createHash("sha256")
      .update(LOCAL_OWNER_LEGACY_WARNING, "utf8")
      .digest("hex");
    this.database
      .prepare(
        `INSERT INTO security_local_capability_approvals (
           owner_id,
           installation_id,
           capability_id,
           warning_version,
           warning_sha256,
           approved_at,
           approved_by_subject_id,
           revoked_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
         ON CONFLICT(owner_id, installation_id, capability_id) DO UPDATE SET
           warning_version = excluded.warning_version,
           warning_sha256 = excluded.warning_sha256,
           approved_at = excluded.approved_at,
           approved_by_subject_id = excluded.approved_by_subject_id,
           revoked_at = NULL,
           updated_at = excluded.updated_at`
      )
      .run(
        this.ownerId,
        this.installationId,
        LOCAL_OWNER_LEGACY_EXECUTION_CAPABILITY,
        LOCAL_OWNER_LEGACY_WARNING_VERSION,
        warningSha256,
        timestamp,
        input.principal.subjectId,
        timestamp
      );
    return this.read();
  }

  revoke(input: { principal: ForgePrincipal; directOwnerChannel: boolean }) {
    const now = this.now();
    requireRecentLocalOwner({
      principal: input.principal,
      directOwnerChannel: input.directOwnerChannel,
      now,
      maximumAuthenticationAgeMilliseconds:
        this.maximumAuthenticationAgeMilliseconds
    });
    const timestamp = now.toISOString();
    this.database
      .prepare(
        `UPDATE security_local_capability_approvals
            SET revoked_at = ?,
                updated_at = ?
          WHERE owner_id = ?
            AND installation_id = ?
            AND capability_id = ?
            AND revoked_at IS NULL`
      )
      .run(
        timestamp,
        timestamp,
        this.ownerId,
        this.installationId,
        LOCAL_OWNER_LEGACY_EXECUTION_CAPABILITY
      );
    return this.read();
  }
}
