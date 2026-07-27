import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import type {
  CompatibilityAuthorization,
  CredentialStateReader
} from "./access-credential.js";
import type {
  BrowserSessionRecord,
  BrowserSessionRepository
} from "./browser-session-service.js";
import type { ForgePrincipal } from "./contracts.js";
import type { DpopReplayStore } from "./dpop.js";
import type {
  LocalTransaction,
  LocalTransactionRepository
} from "./local-owner-assertion.js";
import type {
  OwnerAuthenticator,
  OwnerSecurityRepository
} from "./owner-step-up-service.js";
import type {
  PairingRepository,
  PairingRequest,
  PairingStatus
} from "./pairing-service.js";
import type {
  RefreshFamilyRepository,
  RefreshRotationResult
} from "./refresh-family-service.js";
import {
  createOpaqueSecret,
  type KeyedSecretDigester,
  type OpaqueSecretSource,
  type SecurityClock
} from "./security-runtime.js";

export const SECURITY_CREDENTIAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS security_owners (
  owner_id TEXT PRIMARY KEY,
  security_epoch INTEGER NOT NULL DEFAULT 1 CHECK (security_epoch >= 1),
  created_at TEXT NOT NULL,
  recovered_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS security_installation (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  installation_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS security_clients (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES security_owners(owner_id),
  subject_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  key_thumbprint TEXT NOT NULL,
  audience TEXT NOT NULL,
  profile TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  client_epoch INTEGER NOT NULL DEFAULT 1 CHECK (client_epoch >= 1),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  revocation_reason TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS security_access_revocations (
  token_id TEXT PRIMARY KEY,
  revoked_at TEXT NOT NULL,
  reason TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS security_compatibility_authorizations (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES security_clients(id),
  owner_id TEXT NOT NULL REFERENCES security_owners(owner_id),
  audience TEXT NOT NULL,
  profile TEXT NOT NULL CHECK (profile = 'viewer'),
  scopes_json TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode = 'compatibility_bearer'),
  reason TEXT NOT NULL,
  authorized_by TEXT NOT NULL,
  authorized_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revocation_reason TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS security_pairing_requests (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES security_owners(owner_id),
  owner_epoch INTEGER NOT NULL,
  installation_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_key_thumbprint TEXT NOT NULL,
  audience TEXT NOT NULL,
  requested_scopes_json TEXT NOT NULL,
  requested_profile TEXT NOT NULL,
  device_digest TEXT NOT NULL UNIQUE,
  user_code_digest TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'approved', 'denied', 'cancelled', 'consumed', 'expired')
  ),
  poll_interval_seconds INTEGER NOT NULL CHECK (poll_interval_seconds >= 5),
  next_poll_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  approval_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_security_pairing_pending_install
  ON security_pairing_requests (installation_id, status, expires_at);

CREATE TABLE IF NOT EXISTS security_pairing_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  failures INTEGER NOT NULL CHECK (failures >= 0),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS security_browser_sessions (
  id TEXT PRIMARY KEY,
  session_digest TEXT NOT NULL UNIQUE,
  csrf_digest TEXT NOT NULL,
  principal_json TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES security_owners(owner_id),
  owner_epoch INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  idle_expires_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS security_refresh_families (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES security_clients(id),
  owner_id TEXT NOT NULL REFERENCES security_owners(owner_id),
  installation_id TEXT NOT NULL,
  audience TEXT NOT NULL,
  profile TEXT NOT NULL,
  key_thumbprint TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  owner_epoch INTEGER NOT NULL CHECK (owner_epoch >= 1),
  client_epoch INTEGER NOT NULL CHECK (client_epoch >= 1),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  inactive_expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revocation_reason TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS security_refresh_tokens (
  digest TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES security_refresh_families(id) ON DELETE CASCADE,
  issued_at TEXT NOT NULL,
  used_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS security_dpop_replays (
  key_thumbprint TEXT NOT NULL,
  token_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (key_thumbprint, token_id)
) STRICT;

CREATE TABLE IF NOT EXISTS security_local_transactions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES security_owners(owner_id),
  install_id TEXT NOT NULL,
  browser_origin TEXT NOT NULL,
  browser_nonce_digest TEXT NOT NULL,
  owner_epoch INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  assertion_issued_at TEXT,
  exchanged_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS security_owner_authenticators (
  credential_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES security_owners(owner_id),
  label TEXT NOT NULL,
  origin TEXT NOT NULL,
  relying_party_id TEXT NOT NULL,
  enrolled_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS security_mobile_request_nonces (
  pairing_session_id TEXT NOT NULL
    REFERENCES companion_pairing_sessions(id) ON DELETE CASCADE,
  nonce_digest TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (pairing_session_id, nonce_digest)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_security_mobile_nonce_expiry
  ON security_mobile_request_nonces (pairing_session_id, expires_at);

CREATE TABLE IF NOT EXISTS security_mobile_pairing_credentials (
  pairing_session_id TEXT PRIMARY KEY
    REFERENCES companion_pairing_sessions(id) ON DELETE CASCADE,
  token_digest TEXT NOT NULL UNIQUE,
  token_ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL,
  rotated_at TEXT,
  revoked_at TEXT
) STRICT;
`;

export const SECURITY_PAIRING_CLIENT_METADATA_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS security_pairing_client_metadata (
  pairing_request_id TEXT PRIMARY KEY
    REFERENCES security_pairing_requests(id) ON DELETE CASCADE,
  client_type TEXT NOT NULL CHECK (client_type IN ('api', 'browser'))
) STRICT;
`;

type ClientRow = {
  id: string;
  owner_id: string;
  subject_id: string;
  installation_id: string;
  key_thumbprint: string;
  audience: string;
  profile: ForgePrincipal["profile"];
  scopes_json: string;
  client_epoch: number;
  owner_epoch: number;
  created_at: string;
  revoked_at: string | null;
  client_type: "api" | "browser" | null;
};

type ClientListRow = ClientRow & {
  client_name: string | null;
  client_type: "api" | "browser" | null;
};

function mapClient(row: ClientRow) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    subjectId: row.subject_id,
    installationId: row.installation_id,
    keyThumbprint: row.key_thumbprint,
    audience: row.audience,
    profile: row.profile,
    scopes: parseStringArray(row.scopes_json),
    ownerSecurityEpoch: row.owner_epoch,
    clientSecurityEpoch: row.client_epoch,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    clientType: row.client_type ?? undefined
  };
}

type PairingRow = {
  id: string;
  owner_id: string;
  owner_epoch: number;
  installation_id: string;
  client_name: string;
  client_type: "api" | "browser";
  client_key_thumbprint: string;
  audience: string;
  requested_scopes_json: string;
  requested_profile: string;
  device_digest: string;
  user_code_digest: string;
  status: PairingStatus;
  poll_interval_seconds: number;
  next_poll_at: string;
  expires_at: string;
  approval_json: string | null;
  created_at: string;
  updated_at: string;
};

type RefreshRow = {
  digest: string;
  used_at: string | null;
  family_id: string;
  client_id: string;
  owner_id: string;
  installation_id: string;
  audience: string;
  profile: string;
  key_thumbprint: string;
  scopes_json: string;
  owner_epoch: number;
  client_epoch: number;
  expires_at: string;
  inactive_expires_at: string;
  revoked_at: string | null;
  current_owner_epoch: number;
  current_client_epoch: number;
  client_revoked_at: string | null;
};

type BrowserSessionRow = {
  id: string;
  session_digest: string;
  csrf_digest: string;
  principal_json: string;
  owner_epoch: number;
  created_at: string;
  last_used_at: string;
  idle_expires_at: string;
  absolute_expires_at: string;
  revoked_at: string | null;
};

type LocalTransactionRow = {
  id: string;
  owner_id: string;
  install_id: string;
  browser_origin: string;
  browser_nonce_digest: string;
  owner_epoch: number;
  created_at: string;
  expires_at: string;
  assertion_issued_at: string | null;
  exchanged_at: string | null;
};

type OwnerAuthenticatorRow = {
  credential_id: string;
  owner_id: string;
  label: string;
  origin: string;
  relying_party_id: string;
  enrolled_at: string;
  revoked_at: string | null;
};

function parseStringArray(value: string) {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((entry) => typeof entry === "string")
  ) {
    throw new Error("Forge security scope storage is invalid.");
  }
  return parsed;
}

function parsePrincipal(value: string): ForgePrincipal {
  const parsed = JSON.parse(value) as ForgePrincipal;
  if (
    !parsed ||
    typeof parsed.ownerId !== "string" ||
    typeof parsed.ownerSecurityEpoch !== "number"
  ) {
    throw new Error("Forge browser principal storage is invalid.");
  }
  return parsed;
}

function mapPairing(row: PairingRow): PairingRequest {
  const approval = row.approval_json
    ? (JSON.parse(row.approval_json) as PairingRequest["approval"])
    : null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerSecurityEpoch: row.owner_epoch,
    installationId: row.installation_id,
    clientName: row.client_name,
    clientType: row.client_type,
    clientKeyThumbprint: row.client_key_thumbprint,
    audience: row.audience,
    requestedScopes: parseStringArray(row.requested_scopes_json),
    requestedProfile: row.requested_profile,
    deviceDigest: row.device_digest,
    userCodeDigest: row.user_code_digest,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    pollIntervalSeconds: row.poll_interval_seconds,
    nextPollAt: row.next_poll_at,
    approval
  };
}

function mapOwnerAuthenticator(row: OwnerAuthenticatorRow): OwnerAuthenticator {
  return {
    credentialId: row.credential_id,
    ownerUserId: row.owner_id,
    label: row.label,
    origin: row.origin,
    relyingPartyId: row.relying_party_id,
    enrolledAt: row.enrolled_at,
    revokedAt: row.revoked_at
  };
}

export class SqliteSecurityStore
  implements
    CredentialStateReader,
    DpopReplayStore,
    PairingRepository,
    BrowserSessionRepository,
    LocalTransactionRepository,
    OwnerSecurityRepository,
    RefreshFamilyRepository
{
  constructor(
    private readonly database: DatabaseSync,
    private readonly clock: SecurityClock,
    private readonly secrets: OpaqueSecretSource,
    private readonly digester: KeyedSecretDigester,
    private readonly absoluteRefreshLifetimeSeconds = 30 * 24 * 60 * 60,
    private readonly inactivityRefreshLifetimeSeconds = 7 * 24 * 60 * 60
  ) {}

  initializeSchema() {
    this.database.exec("PRAGMA foreign_keys = ON;");
    this.database.exec("PRAGMA busy_timeout = 5000;");
    this.database.exec(SECURITY_CREDENTIAL_SCHEMA_SQL);
    this.database.exec(SECURITY_PAIRING_CLIENT_METADATA_SCHEMA_SQL);
  }

  ensureOwner(ownerId: string) {
    const now = this.clock.now().toISOString();
    this.database
      .prepare(
        `INSERT OR IGNORE INTO security_owners (
           owner_id, security_epoch, created_at, recovered_at
         ) VALUES (?, 1, ?, NULL)`
      )
      .run(ownerId, now);
    return this.readOwnerSecurityEpoch(ownerId);
  }

  ensureInstallation() {
    const createdAt = this.clock.now().toISOString();
    this.database
      .prepare(
        `INSERT OR IGNORE INTO security_installation (
           singleton, installation_id, created_at
         ) VALUES (1, ?, ?)`
      )
      .run(`install_${randomUUID()}`, createdAt);
    const row = this.database
      .prepare(
        `SELECT installation_id FROM security_installation
         WHERE singleton = 1`
      )
      .get() as { installation_id: string } | undefined;
    if (!row?.installation_id) {
      throw new Error("Forge security installation identity is unavailable.");
    }
    return row.installation_id;
  }

  readOwnerSecurityEpoch(ownerId: string) {
    const row = this.database
      .prepare(`SELECT security_epoch FROM security_owners WHERE owner_id = ?`)
      .get(ownerId) as { security_epoch: number } | undefined;
    return row?.security_epoch ?? null;
  }

  registerClient(input: {
    id: string;
    ownerId: string;
    subjectId: string;
    installationId: string;
    keyThumbprint: string;
    audience: string;
    profile: ForgePrincipal["profile"];
    scopes: readonly string[];
    clientSecurityEpoch?: number;
  }) {
    this.ensureOwner(input.ownerId);
    const now = this.clock.now().toISOString();
    this.database
      .prepare(
        `INSERT INTO security_clients (
          id, owner_id, subject_id, installation_id, key_thumbprint, audience,
          profile, scopes_json, client_epoch, created_at, revoked_at,
          revocation_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
      )
      .run(
        input.id,
        input.ownerId,
        input.subjectId,
        input.installationId,
        input.keyThumbprint,
        input.audience,
        input.profile,
        JSON.stringify([...new Set(input.scopes)].sort()),
        input.clientSecurityEpoch ?? 1,
        now
      );
  }

  readClient(clientId: string) {
    const row = this.database
      .prepare(
        `SELECT client.id, client.owner_id, client.subject_id,
                client.installation_id, client.key_thumbprint,
                client.audience, client.profile,
                client.scopes_json, client.client_epoch, owner.security_epoch AS owner_epoch,
                client.created_at, client.revoked_at,
                metadata.client_type
         FROM security_clients client
         JOIN security_owners owner ON owner.owner_id = client.owner_id
         LEFT JOIN security_pairing_client_metadata metadata
           ON metadata.pairing_request_id = client.subject_id
         WHERE client.id = ?`
      )
      .get(clientId) as ClientRow | undefined;
    return row ? mapClient(row) : null;
  }

  listClients(ownerId: string) {
    const rows = this.database
      .prepare(
        `SELECT client.id, client.owner_id, client.subject_id,
                client.installation_id, client.key_thumbprint,
                client.audience, client.profile,
                client.scopes_json, client.client_epoch,
                owner.security_epoch AS owner_epoch,
                client.created_at, client.revoked_at,
                request.client_name,
                metadata.client_type
         FROM security_clients client
         JOIN security_owners owner ON owner.owner_id = client.owner_id
         LEFT JOIN security_pairing_requests request
           ON request.id = client.subject_id
         LEFT JOIN security_pairing_client_metadata metadata
           ON metadata.pairing_request_id = request.id
         WHERE client.owner_id = ?
         ORDER BY client.created_at DESC, client.id ASC`
      )
      .all(ownerId) as ClientListRow[];
    return rows.map((row) => ({
      ...mapClient(row),
      clientName: row.client_name ?? "Registered Forge client",
      clientType: row.client_type ?? "api"
    }));
  }

  revokeClient(clientId: string, reason: string) {
    const now = this.clock.now().toISOString();
    return this.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE security_clients
           SET revoked_at = COALESCE(revoked_at, ?),
               revocation_reason = COALESCE(revocation_reason, ?),
               client_epoch = client_epoch
                 + CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END
           WHERE id = ?`
        )
        .run(now, reason, clientId);
      this.database
        .prepare(
          `UPDATE security_refresh_families
           SET revoked_at = COALESCE(revoked_at, ?),
               revocation_reason = COALESCE(revocation_reason, ?)
           WHERE client_id = ?`
        )
        .run(now, reason, clientId);
      return Number(result.changes) > 0;
    });
  }

  consumeActiveClient(clientId: string, reason: string) {
    const now = this.clock.now().toISOString();
    return this.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE security_clients
           SET revoked_at = ?,
               revocation_reason = ?,
               client_epoch = client_epoch + 1
           WHERE id = ?
             AND revoked_at IS NULL`
        )
        .run(now, reason, clientId);
      if (Number(result.changes) !== 1) {
        return false;
      }
      this.database
        .prepare(
          `UPDATE security_refresh_families
           SET revoked_at = COALESCE(revoked_at, ?),
               revocation_reason = COALESCE(revocation_reason, ?)
           WHERE client_id = ?`
        )
        .run(now, reason, clientId);
      return true;
    });
  }

  revokeAccessToken(tokenId: string, reason: string) {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO security_access_revocations (
           token_id, revoked_at, reason
         ) VALUES (?, ?, ?)`
      )
      .run(tokenId, this.clock.now().toISOString(), reason);
  }

  isCredentialActive(input: {
    tokenId: string;
    subjectId: string;
    clientId: string;
    installationId: string;
    ownerId: string;
    audience: string;
    profile: ForgePrincipal["profile"];
    scopes: readonly string[];
    keyThumbprint: string | null;
    compatibilityAuthorizationId: string | null;
    ownerSecurityEpoch: number;
    clientSecurityEpoch: number;
  }) {
    const client = this.readClient(input.clientId);
    if (
      !client ||
      client.subjectId !== input.subjectId ||
      client.installationId !== input.installationId ||
      client.ownerId !== input.ownerId ||
      client.audience !== input.audience ||
      client.profile !== input.profile ||
      client.ownerSecurityEpoch !== input.ownerSecurityEpoch ||
      client.clientSecurityEpoch !== input.clientSecurityEpoch ||
      client.revokedAt ||
      (input.keyThumbprint !== null &&
        client.keyThumbprint !== input.keyThumbprint) ||
      input.scopes.some((scope) => !client.scopes.includes(scope))
    ) {
      return false;
    }
    if (input.compatibilityAuthorizationId !== null) {
      const authorization = this.readCompatibilityAuthorization(
        input.compatibilityAuthorizationId
      );
      if (
        !authorization ||
        authorization.clientId !== input.clientId ||
        authorization.ownerId !== input.ownerId ||
        authorization.audience !== input.audience ||
        authorization.profile !== input.profile ||
        authorization.mode !== "compatibility_bearer" ||
        authorization.revokedAt ||
        Date.parse(authorization.expiresAt) <= this.clock.now().getTime() ||
        input.scopes.some((scope) => !authorization.scopes.includes(scope))
      ) {
        return false;
      }
    }
    const revocation = this.database
      .prepare(
        `SELECT token_id FROM security_access_revocations WHERE token_id = ?`
      )
      .get(input.tokenId);
    return !revocation;
  }

  createCompatibilityAuthorization(authorization: CompatibilityAuthorization) {
    const client = this.readClient(authorization.clientId);
    if (
      !client ||
      client.revokedAt ||
      client.ownerId !== authorization.ownerId ||
      client.audience !== authorization.audience ||
      client.profile !== authorization.profile ||
      authorization.profile !== "viewer" ||
      authorization.mode !== "compatibility_bearer" ||
      authorization.scopes.some((scope) => !client.scopes.includes(scope)) ||
      !authorization.reason.trim() ||
      !authorization.authorizedBy.trim() ||
      Date.parse(authorization.expiresAt) <=
        Date.parse(authorization.authorizedAt)
    ) {
      throw new Error(
        "Forge compatibility authorization exceeds the registered client grant."
      );
    }
    this.database
      .prepare(
        `INSERT INTO security_compatibility_authorizations (
          id, client_id, owner_id, audience, profile, scopes_json, mode,
          reason, authorized_by, authorized_at, expires_at, revoked_at,
          revocation_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
      )
      .run(
        authorization.id,
        authorization.clientId,
        authorization.ownerId,
        authorization.audience,
        authorization.profile,
        JSON.stringify([...new Set(authorization.scopes)].sort()),
        authorization.mode,
        authorization.reason,
        authorization.authorizedBy,
        authorization.authorizedAt,
        authorization.expiresAt
      );
  }

  readCompatibilityAuthorization(authorizationId: string) {
    const row = this.database
      .prepare(
        `SELECT id, client_id, owner_id, audience, profile, scopes_json, mode,
                reason, authorized_by, authorized_at, expires_at, revoked_at
         FROM security_compatibility_authorizations WHERE id = ?`
      )
      .get(authorizationId) as
      | {
          id: string;
          client_id: string;
          owner_id: string;
          audience: string;
          profile: "viewer";
          scopes_json: string;
          mode: "compatibility_bearer";
          reason: string;
          authorized_by: string;
          authorized_at: string;
          expires_at: string;
          revoked_at: string | null;
        }
      | undefined;
    return row
      ? {
          id: row.id,
          clientId: row.client_id,
          ownerId: row.owner_id,
          audience: row.audience,
          profile: row.profile,
          scopes: parseStringArray(row.scopes_json),
          mode: row.mode,
          reason: row.reason,
          authorizedBy: row.authorized_by,
          authorizedAt: row.authorized_at,
          expiresAt: row.expires_at,
          revokedAt: row.revoked_at
        }
      : null;
  }

  revokeCompatibilityAuthorization(id: string, reason: string) {
    const now = this.clock.now().toISOString();
    return (
      this.database
        .prepare(
          `UPDATE security_compatibility_authorizations
           SET revoked_at = COALESCE(revoked_at, ?),
               revocation_reason = COALESCE(revocation_reason, ?)
           WHERE id = ? AND revoked_at IS NULL`
        )
        .run(now, reason, id).changes === 1
    );
  }

  createPairingRequestWithCaps(input: {
    record: PairingRequest;
    maximumPendingPerInstallation: number;
    maximumPendingPerOwner: number;
    maximumPendingGlobally: number;
    admissionNetworkBucketKey: string;
    admissionInstallationBucketKey: string;
    admissionWindowSeconds: number;
    maximumAdmissionAttempts: number;
  }) {
    return this.transaction(() => {
      const currentOwnerEpoch = this.readOwnerSecurityEpoch(
        input.record.ownerId
      );
      if (currentOwnerEpoch !== input.record.ownerSecurityEpoch) {
        return false;
      }
      if (
        !this.claimRateLimitInCurrentTransaction({
          bucketKey: input.admissionNetworkBucketKey,
          now: input.record.createdAt,
          windowSeconds: input.admissionWindowSeconds,
          maximumAttempts: input.maximumAdmissionAttempts
        }) ||
        !this.claimRateLimitInCurrentTransaction({
          bucketKey: input.admissionInstallationBucketKey,
          now: input.record.createdAt,
          windowSeconds: input.admissionWindowSeconds,
          maximumAttempts: input.maximumAdmissionAttempts
        })
      ) {
        return false;
      }
      const perInstallation = this.database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM security_pairing_requests
           WHERE owner_id = ? AND installation_id = ?
             AND status IN ('pending', 'approved') AND expires_at > ?`
        )
        .get(
          input.record.ownerId,
          input.record.installationId,
          input.record.createdAt
        ) as { count: number };
      const global = this.database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM security_pairing_requests
           WHERE status IN ('pending', 'approved') AND expires_at > ?`
        )
        .get(input.record.createdAt) as { count: number };
      const perOwner = this.database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM security_pairing_requests
           WHERE owner_id = ? AND status IN ('pending', 'approved')
             AND expires_at > ?`
        )
        .get(input.record.ownerId, input.record.createdAt) as { count: number };
      if (
        perInstallation.count >= input.maximumPendingPerInstallation ||
        perOwner.count >= input.maximumPendingPerOwner ||
        global.count >= input.maximumPendingGlobally
      ) {
        return false;
      }
      this.database
        .prepare(
          `INSERT INTO security_pairing_requests (
            id, owner_id, owner_epoch, installation_id, client_name,
            client_key_thumbprint, audience, requested_scopes_json,
            requested_profile, device_digest, user_code_digest, status,
            poll_interval_seconds, next_poll_at, expires_at, approval_json,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
        )
        .run(
          input.record.id,
          input.record.ownerId,
          input.record.ownerSecurityEpoch,
          input.record.installationId,
          input.record.clientName,
          input.record.clientKeyThumbprint,
          input.record.audience,
          JSON.stringify(input.record.requestedScopes),
          input.record.requestedProfile,
          input.record.deviceDigest,
          input.record.userCodeDigest,
          input.record.status,
          input.record.pollIntervalSeconds,
          input.record.nextPollAt,
          input.record.expiresAt,
          input.record.createdAt,
          input.record.updatedAt
        );
      this.database
        .prepare(
          `INSERT INTO security_pairing_client_metadata (
             pairing_request_id, client_type
           ) VALUES (?, ?)`
        )
        .run(input.record.id, input.record.clientType ?? "api");
      return true;
    });
  }

  readPairingAdmissionRetryAfterSeconds(input: {
    ownerId: string;
    installationId: string;
    now: string;
    maximumPendingPerInstallation: number;
    maximumPendingPerOwner: number;
    maximumPendingGlobally: number;
    admissionNetworkBucketKey: string;
    admissionInstallationBucketKey: string;
    admissionWindowSeconds: number;
    maximumAdmissionAttempts: number;
  }) {
    const nowMs = Date.parse(input.now);
    const retryAfterSeconds: number[] = [];
    const appendPendingRetry = (
      rows: Array<{ expires_at: string }>,
      maximumPending: number
    ) => {
      if (rows.length < maximumPending) return;
      const release = rows[rows.length - maximumPending];
      if (!release) return;
      retryAfterSeconds.push(
        Math.max(1, Math.ceil((Date.parse(release.expires_at) - nowMs) / 1_000))
      );
    };
    const activeStatusClause =
      "status IN ('pending', 'approved') AND expires_at > ?";
    appendPendingRetry(
      this.database
        .prepare(
          `SELECT expires_at FROM security_pairing_requests
           WHERE owner_id = ? AND installation_id = ?
             AND ${activeStatusClause}
           ORDER BY expires_at ASC`
        )
        .all(input.ownerId, input.installationId, input.now) as Array<{
        expires_at: string;
      }>,
      input.maximumPendingPerInstallation
    );
    appendPendingRetry(
      this.database
        .prepare(
          `SELECT expires_at FROM security_pairing_requests
           WHERE owner_id = ? AND ${activeStatusClause}
           ORDER BY expires_at ASC`
        )
        .all(input.ownerId, input.now) as Array<{ expires_at: string }>,
      input.maximumPendingPerOwner
    );
    appendPendingRetry(
      this.database
        .prepare(
          `SELECT expires_at FROM security_pairing_requests
           WHERE ${activeStatusClause}
           ORDER BY expires_at ASC`
        )
        .all(input.now) as Array<{ expires_at: string }>,
      input.maximumPendingGlobally
    );

    const rateRows = this.database
      .prepare(
        `SELECT window_started_at, failures
         FROM security_pairing_rate_limits
         WHERE bucket_key IN (?, ?)`
      )
      .all(
        input.admissionNetworkBucketKey,
        input.admissionInstallationBucketKey
      ) as Array<{ window_started_at: string; failures: number }>;
    for (const row of rateRows) {
      if (row.failures < input.maximumAdmissionAttempts) continue;
      const releaseMs =
        Date.parse(row.window_started_at) +
        input.admissionWindowSeconds * 1_000;
      retryAfterSeconds.push(
        Math.max(1, Math.ceil((releaseMs - nowMs) / 1_000))
      );
    }

    return Math.max(1, ...retryAfterSeconds);
  }

  findPairingByDeviceDigest(deviceDigest: string) {
    return this.findPairing("device_digest", deviceDigest);
  }

  findPairingByUserCodeDigest(userCodeDigest: string) {
    return this.findPairing("user_code_digest", userCodeDigest);
  }

  readPairingRequest(id: string) {
    return this.findPairing("id", id);
  }

  claimPairingApprovalAttempt(input: {
    bucketKey: string;
    now: string;
    windowSeconds: number;
    maximumAttempts: number;
  }) {
    return this.transaction(() =>
      this.claimRateLimitInCurrentTransaction(input)
    );
  }

  claimPairingPollNetworkAttempt(input: {
    bucketKey: string;
    now: string;
    windowSeconds: number;
    maximumAttempts: number;
  }) {
    return this.transaction(() =>
      this.claimRateLimitInCurrentTransaction(input)
    );
  }

  claimPairingPollClientAttempt(input: {
    installationBucketKey: string;
    clientBucketKey: string;
    now: string;
    windowSeconds: number;
    maximumInstallationAttempts: number;
    maximumClientAttempts: number;
  }) {
    return this.transaction(
      () =>
        this.claimRateLimitInCurrentTransaction({
          bucketKey: input.installationBucketKey,
          now: input.now,
          windowSeconds: input.windowSeconds,
          maximumAttempts: input.maximumInstallationAttempts
        }) &&
        this.claimRateLimitInCurrentTransaction({
          bucketKey: input.clientBucketKey,
          now: input.now,
          windowSeconds: input.windowSeconds,
          maximumAttempts: input.maximumClientAttempts
        })
    );
  }

  approvePairingRequest(input: {
    id: string;
    approval: NonNullable<PairingRequest["approval"]>;
    now: string;
  }) {
    this.ensureOwner(input.approval.ownerId);
    const currentEpoch = this.readOwnerSecurityEpoch(input.approval.ownerId);
    if (currentEpoch !== input.approval.ownerSecurityEpoch) {
      return false;
    }
    return (
      this.database
        .prepare(
          `UPDATE security_pairing_requests
           SET status = 'approved', approval_json = ?, updated_at = ?
           WHERE id = ? AND owner_id = ? AND owner_epoch = ?
             AND status = 'pending' AND expires_at > ?`
        )
        .run(
          JSON.stringify(input.approval),
          input.now,
          input.id,
          input.approval.ownerId,
          input.approval.ownerSecurityEpoch,
          input.now
        ).changes === 1
    );
  }

  transitionPairingRequest(input: {
    id: string;
    fromStatuses: readonly PairingStatus[];
    toStatus: PairingStatus;
    now: string;
  }) {
    if (input.fromStatuses.length === 0) {
      return false;
    }
    const placeholders = input.fromStatuses.map(() => "?").join(", ");
    return (
      this.database
        .prepare(
          `UPDATE security_pairing_requests
           SET status = ?, updated_at = ?
           WHERE id = ? AND status IN (${placeholders})`
        )
        .run(input.toStatus, input.now, input.id, ...input.fromStatuses)
        .changes === 1
    );
  }

  updatePairingPoll(input: {
    id: string;
    expectedNextPollAt: string;
    pollIntervalSeconds: number;
    nextPollAt: string;
    now: string;
  }) {
    return (
      this.database
        .prepare(
          `UPDATE security_pairing_requests
           SET poll_interval_seconds = ?, next_poll_at = ?, updated_at = ?
           WHERE id = ? AND next_poll_at = ?
             AND status IN ('pending', 'approved')`
        )
        .run(
          input.pollIntervalSeconds,
          input.nextPollAt,
          input.now,
          input.id,
          input.expectedNextPollAt
        ).changes === 1
    );
  }

  createBrowserSession(record: BrowserSessionRecord) {
    this.database
      .prepare(
        `INSERT INTO security_browser_sessions (
          id, session_digest, csrf_digest, principal_json, owner_id, owner_epoch,
          created_at, last_used_at, idle_expires_at, absolute_expires_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(
        record.id,
        record.sessionDigest,
        record.csrfDigest,
        JSON.stringify(record.principal),
        record.principal.ownerId,
        record.ownerSecurityEpoch,
        record.createdAt,
        record.lastUsedAt,
        record.idleExpiresAt,
        record.absoluteExpiresAt
      );
  }

  findBrowserSessionByDigest(sessionDigest: string) {
    const row = this.database
      .prepare(
        `SELECT id, session_digest, csrf_digest, principal_json, owner_epoch,
                created_at, last_used_at, idle_expires_at, absolute_expires_at,
                revoked_at
         FROM security_browser_sessions WHERE session_digest = ?`
      )
      .get(sessionDigest) as BrowserSessionRow | undefined;
    return row
      ? {
          id: row.id,
          sessionDigest: row.session_digest,
          csrfDigest: row.csrf_digest,
          principal: parsePrincipal(row.principal_json),
          ownerSecurityEpoch: row.owner_epoch,
          createdAt: row.created_at,
          lastUsedAt: row.last_used_at,
          idleExpiresAt: row.idle_expires_at,
          absoluteExpiresAt: row.absolute_expires_at,
          revokedAt: row.revoked_at
        }
      : null;
  }

  readBrowserSessionById(sessionId: string) {
    const row = this.database
      .prepare(
        `SELECT id, session_digest, csrf_digest, principal_json, owner_epoch,
                created_at, last_used_at, idle_expires_at, absolute_expires_at,
                revoked_at
         FROM security_browser_sessions WHERE id = ?`
      )
      .get(sessionId) as BrowserSessionRow | undefined;
    return row
      ? {
          id: row.id,
          sessionDigest: row.session_digest,
          csrfDigest: row.csrf_digest,
          principal: parsePrincipal(row.principal_json),
          ownerSecurityEpoch: row.owner_epoch,
          createdAt: row.created_at,
          lastUsedAt: row.last_used_at,
          idleExpiresAt: row.idle_expires_at,
          absoluteExpiresAt: row.absolute_expires_at,
          revokedAt: row.revoked_at
        }
      : null;
  }

  touchBrowserSession(input: {
    id: string;
    expectedSessionDigest: string;
    lastUsedAt: string;
    idleExpiresAt: string;
  }) {
    return (
      this.database
        .prepare(
          `UPDATE security_browser_sessions
           SET last_used_at = ?, idle_expires_at = ?
           WHERE id = ? AND session_digest = ? AND revoked_at IS NULL
             AND idle_expires_at > ? AND absolute_expires_at > ?`
        )
        .run(
          input.lastUsedAt,
          input.idleExpiresAt,
          input.id,
          input.expectedSessionDigest,
          input.lastUsedAt,
          input.lastUsedAt
        ).changes === 1
    );
  }

  rotateBrowserSession(input: {
    id: string;
    expectedSessionDigest: string;
    nextSessionDigest: string;
    nextCsrfDigest: string;
  }) {
    return (
      this.database
        .prepare(
          `UPDATE security_browser_sessions
           SET session_digest = ?, csrf_digest = ?
           WHERE id = ? AND session_digest = ? AND revoked_at IS NULL`
        )
        .run(
          input.nextSessionDigest,
          input.nextCsrfDigest,
          input.id,
          input.expectedSessionDigest
        ).changes === 1
    );
  }

  revokeBrowserSession(id: string, revokedAt: string) {
    return (
      this.database
        .prepare(
          `UPDATE security_browser_sessions
           SET revoked_at = COALESCE(revoked_at, ?)
           WHERE id = ? AND revoked_at IS NULL`
        )
        .run(revokedAt, id).changes === 1
    );
  }

  issueRefreshFamily(input: {
    clientId: string;
    ownerId: string;
    installationId: string;
    audience: string;
    profile: string;
    keyThumbprint: string;
    scopes: readonly string[];
    ownerSecurityEpoch: number;
    clientSecurityEpoch: number;
  }) {
    const client = this.readClient(input.clientId);
    if (
      !client ||
      client.revokedAt ||
      client.ownerId !== input.ownerId ||
      client.installationId !== input.installationId ||
      client.keyThumbprint !== input.keyThumbprint ||
      client.audience !== input.audience ||
      client.profile !== input.profile ||
      input.scopes.some((scope) => !client.scopes.includes(scope)) ||
      client.ownerSecurityEpoch !== input.ownerSecurityEpoch ||
      client.clientSecurityEpoch !== input.clientSecurityEpoch
    ) {
      throw new Error("Forge refresh family requires a current active client.");
    }
    const now = this.clock.now();
    const familyId = `rff_${randomUUID()}`;
    const refreshToken = createOpaqueSecret(this.secrets, "fg_refresh");
    this.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO security_refresh_families (
            id, client_id, owner_id, installation_id, audience, profile,
            key_thumbprint, scopes_json, owner_epoch, client_epoch, created_at,
            expires_at, inactive_expires_at, revoked_at, revocation_reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
        )
        .run(
          familyId,
          input.clientId,
          input.ownerId,
          input.installationId,
          input.audience,
          input.profile,
          input.keyThumbprint,
          JSON.stringify([...new Set(input.scopes)].sort()),
          input.ownerSecurityEpoch,
          input.clientSecurityEpoch,
          now.toISOString(),
          new Date(
            now.getTime() + this.absoluteRefreshLifetimeSeconds * 1000
          ).toISOString(),
          new Date(
            now.getTime() + this.inactivityRefreshLifetimeSeconds * 1000
          ).toISOString()
        );
      this.database
        .prepare(
          `INSERT INTO security_refresh_tokens (
             digest, family_id, issued_at, used_at
           ) VALUES (?, ?, ?, NULL)`
        )
        .run(
          this.digester.digest("refresh-token", refreshToken),
          familyId,
          now.toISOString()
        );
    });
    return { familyId, refreshToken };
  }

  rotateRefresh(input: {
    refreshToken: string;
    clientId: string;
    installationId: string;
    keyThumbprint: string;
    audience: string;
    afterMarkUsed?: () => void;
  }): RefreshRotationResult {
    return this.transaction(() => {
      const digest = this.digester.digest("refresh-token", input.refreshToken);
      const row = this.database
        .prepare(
          `SELECT token.digest, token.used_at, family.id AS family_id,
                  family.client_id, family.owner_id, family.audience,
                  family.installation_id, family.profile,
                  family.key_thumbprint, family.scopes_json,
                  family.owner_epoch, family.client_epoch, family.expires_at,
                  family.inactive_expires_at, family.revoked_at,
                  owner.security_epoch AS current_owner_epoch,
                  client.client_epoch AS current_client_epoch,
                  client.revoked_at AS client_revoked_at
           FROM security_refresh_tokens token
           JOIN security_refresh_families family ON family.id = token.family_id
           JOIN security_clients client ON client.id = family.client_id
           JOIN security_owners owner ON owner.owner_id = family.owner_id
           WHERE token.digest = ?`
        )
        .get(digest) as RefreshRow | undefined;
      if (
        !row ||
        row.client_id !== input.clientId ||
        row.installation_id !== input.installationId ||
        row.key_thumbprint !== input.keyThumbprint ||
        row.audience !== input.audience
      ) {
        return { status: "invalid" };
      }
      const now = this.clock.now();
      if (row.used_at) {
        if (!row.client_revoked_at) {
          this.revokeCompromisedClientInCurrentTransaction(
            row.client_id,
            now.toISOString(),
            "refresh_reuse_detected"
          );
        }
        return {
          status: "reuse_detected",
          familyId: row.family_id,
          clientId: row.client_id
        };
      }
      if (row.revoked_at) {
        return { status: "expired", familyId: row.family_id };
      }
      if (
        row.client_revoked_at ||
        row.owner_epoch !== row.current_owner_epoch ||
        row.client_epoch !== row.current_client_epoch ||
        Date.parse(row.expires_at) <= now.getTime() ||
        Date.parse(row.inactive_expires_at) <= now.getTime()
      ) {
        this.database
          .prepare(
            `UPDATE security_refresh_families
             SET revoked_at = COALESCE(revoked_at, ?),
                 revocation_reason = COALESCE(revocation_reason, 'expired_or_stale')
             WHERE id = ?`
          )
          .run(now.toISOString(), row.family_id);
        return { status: "expired", familyId: row.family_id };
      }
      const used = this.database
        .prepare(
          `UPDATE security_refresh_tokens
           SET used_at = ? WHERE digest = ? AND used_at IS NULL`
        )
        .run(now.toISOString(), digest);
      if (Number(used.changes) !== 1) {
        throw new Error("Forge refresh rotation lost its atomic claim.");
      }
      input.afterMarkUsed?.();
      const refreshToken = createOpaqueSecret(this.secrets, "fg_refresh");
      this.database
        .prepare(
          `INSERT INTO security_refresh_tokens (
             digest, family_id, issued_at, used_at
           ) VALUES (?, ?, ?, NULL)`
        )
        .run(
          this.digester.digest("refresh-token", refreshToken),
          row.family_id,
          now.toISOString()
        );
      this.database
        .prepare(
          `UPDATE security_refresh_families
           SET inactive_expires_at = ?
           WHERE id = ? AND revoked_at IS NULL`
        )
        .run(
          new Date(
            now.getTime() + this.inactivityRefreshLifetimeSeconds * 1000
          ).toISOString(),
          row.family_id
        );
      return {
        status: "rotated",
        refreshToken,
        familyId: row.family_id,
        ownerSecurityEpoch: row.owner_epoch,
        clientSecurityEpoch: row.client_epoch
      };
    });
  }

  revokeRefreshFamily(familyId: string, reason: string) {
    const now = this.clock.now().toISOString();
    return (
      this.database
        .prepare(
          `UPDATE security_refresh_families
           SET revoked_at = COALESCE(revoked_at, ?),
               revocation_reason = COALESCE(revocation_reason, ?)
           WHERE id = ? AND revoked_at IS NULL`
        )
        .run(now, reason, familyId).changes === 1
    );
  }

  createLocalTransaction(record: LocalTransaction) {
    this.database
      .prepare(
        `INSERT INTO security_local_transactions (
          id, owner_id, install_id, browser_origin, browser_nonce_digest,
          owner_epoch, created_at, expires_at, assertion_issued_at, exchanged_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
      )
      .run(
        record.id,
        record.ownerUserId,
        record.installId,
        record.browserOrigin,
        record.browserNonceDigest,
        record.ownerSecurityEpoch,
        record.createdAt,
        record.expiresAt
      );
  }

  readLocalTransaction(id: string) {
    const row = this.database
      .prepare(
        `SELECT id, owner_id, install_id, browser_origin, browser_nonce_digest,
                owner_epoch, created_at, expires_at, assertion_issued_at,
                exchanged_at
         FROM security_local_transactions WHERE id = ?`
      )
      .get(id) as LocalTransactionRow | undefined;
    return row
      ? {
          id: row.id,
          ownerUserId: row.owner_id,
          installId: row.install_id,
          browserOrigin: row.browser_origin,
          browserNonceDigest: row.browser_nonce_digest,
          ownerSecurityEpoch: row.owner_epoch,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
          assertionIssuedAt: row.assertion_issued_at,
          exchangedAt: row.exchanged_at
        }
      : null;
  }

  claimLocalAssertion(input: { id: string; issuedAt: string; now: string }) {
    return (
      this.database
        .prepare(
          `UPDATE security_local_transactions
           SET assertion_issued_at = ?
           WHERE id = ? AND assertion_issued_at IS NULL
             AND exchanged_at IS NULL AND expires_at > ?`
        )
        .run(input.issuedAt, input.id, input.now).changes === 1
    );
  }

  consumeLocalTransaction(input: {
    id: string;
    exchangedAt: string;
    now: string;
  }) {
    return (
      this.database
        .prepare(
          `UPDATE security_local_transactions
           SET exchanged_at = ?
           WHERE id = ? AND assertion_issued_at IS NOT NULL
             AND exchanged_at IS NULL AND expires_at > ?`
        )
        .run(input.exchangedAt, input.id, input.now).changes === 1
    );
  }

  createOwnerAuthenticator(record: OwnerAuthenticator) {
    try {
      return (
        this.database
          .prepare(
            `INSERT INTO security_owner_authenticators (
              credential_id, owner_id, label, origin, relying_party_id,
              enrolled_at, revoked_at
            ) VALUES (?, ?, ?, ?, ?, ?, NULL)`
          )
          .run(
            record.credentialId,
            record.ownerUserId,
            record.label,
            record.origin,
            record.relyingPartyId,
            record.enrolledAt
          ).changes === 1
      );
    } catch {
      return false;
    }
  }

  readOwnerAuthenticator(ownerId: string, credentialId: string) {
    const row = this.database
      .prepare(
        `SELECT credential_id, owner_id, label, origin, relying_party_id,
                enrolled_at, revoked_at
         FROM security_owner_authenticators
         WHERE owner_id = ? AND credential_id = ?`
      )
      .get(ownerId, credentialId) as OwnerAuthenticatorRow | undefined;
    return row ? mapOwnerAuthenticator(row) : null;
  }

  listOwnerAuthenticators(ownerId: string) {
    const rows = this.database
      .prepare(
        `SELECT credential_id, owner_id, label, origin, relying_party_id,
                enrolled_at, revoked_at
         FROM security_owner_authenticators
         WHERE owner_id = ? ORDER BY enrolled_at, credential_id`
      )
      .all(ownerId) as OwnerAuthenticatorRow[];
    return rows.map(mapOwnerAuthenticator);
  }

  recoverOwnerSecurity(input: {
    ownerId: string;
    lostCredentialIds: readonly string[];
    replacement: OwnerAuthenticator;
    recoveredAt: string;
  }) {
    return this.transaction(() => {
      const owner = this.readOwnerSecurityEpoch(input.ownerId);
      if (!owner) {
        throw new Error("Forge owner security state is unavailable.");
      }
      this.database
        .prepare(
          `UPDATE security_owner_authenticators
           SET revoked_at = COALESCE(revoked_at, ?)
           WHERE owner_id = ?`
        )
        .run(input.recoveredAt, input.ownerId);
      this.database
        .prepare(
          `UPDATE security_compatibility_authorizations
           SET revoked_at = COALESCE(revoked_at, ?),
               revocation_reason = COALESCE(revocation_reason, 'owner_recovery')
           WHERE owner_id = ?`
        )
        .run(input.recoveredAt, input.ownerId);
      void input.lostCredentialIds;
      const inserted = this.database
        .prepare(
          `INSERT INTO security_owner_authenticators (
            credential_id, owner_id, label, origin, relying_party_id,
            enrolled_at, revoked_at
          ) VALUES (?, ?, ?, ?, ?, ?, NULL)`
        )
        .run(
          input.replacement.credentialId,
          input.ownerId,
          input.replacement.label,
          input.replacement.origin,
          input.replacement.relyingPartyId,
          input.replacement.enrolledAt
        );
      if (inserted.changes !== 1) {
        throw new Error("Forge replacement authenticator could not be stored.");
      }
      this.database
        .prepare(
          `UPDATE security_owners
           SET security_epoch = security_epoch + 1, recovered_at = ?
           WHERE owner_id = ?`
        )
        .run(input.recoveredAt, input.ownerId);
      this.database
        .prepare(
          `UPDATE security_clients
           SET revoked_at = COALESCE(revoked_at, ?),
               revocation_reason = COALESCE(revocation_reason, 'owner_recovery'),
               client_epoch = client_epoch + CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END
           WHERE owner_id = ?`
        )
        .run(input.recoveredAt, input.ownerId);
      this.database
        .prepare(
          `UPDATE security_refresh_families
           SET revoked_at = COALESCE(revoked_at, ?),
               revocation_reason = COALESCE(revocation_reason, 'owner_recovery')
           WHERE owner_id = ?`
        )
        .run(input.recoveredAt, input.ownerId);
      this.database
        .prepare(
          `UPDATE security_browser_sessions
           SET revoked_at = COALESCE(revoked_at, ?)
           WHERE owner_id = ?`
        )
        .run(input.recoveredAt, input.ownerId);
      this.database
        .prepare(
          `UPDATE security_pairing_requests
           SET status = 'cancelled', updated_at = ?
           WHERE owner_id = ? AND status IN ('pending', 'approved')`
        )
        .run(input.recoveredAt, input.ownerId);
      this.database
        .prepare(
          `UPDATE security_local_transactions
           SET exchanged_at = COALESCE(exchanged_at, ?)
           WHERE owner_id = ? AND exchanged_at IS NULL`
        )
        .run(input.recoveredAt, input.ownerId);
      const next = this.readOwnerSecurityEpoch(input.ownerId);
      if (!next || next !== owner + 1) {
        throw new Error("Forge owner recovery did not advance its epoch.");
      }
      return next;
    });
  }

  claim(input: {
    keyThumbprint: string;
    tokenId: string;
    now: Date;
    expiresAt: Date;
  }) {
    return this.transaction(() => {
      this.database
        .prepare(`DELETE FROM security_dpop_replays WHERE expires_at <= ?`)
        .run(input.now.toISOString());
      const result = this.database
        .prepare(
          `INSERT OR IGNORE INTO security_dpop_replays (
             key_thumbprint, token_id, expires_at
           ) VALUES (?, ?, ?)`
        )
        .run(input.keyThumbprint, input.tokenId, input.expiresAt.toISOString());
      return Number(result.changes) === 1;
    });
  }

  private findPairing(
    column: "id" | "device_digest" | "user_code_digest",
    value: string
  ) {
    const row = this.database
      .prepare(
        `SELECT request.id, request.owner_id, request.owner_epoch,
                request.installation_id, request.client_name,
                COALESCE(metadata.client_type, 'api') AS client_type,
                request.client_key_thumbprint, request.audience,
                requested_scopes_json, requested_profile,
                device_digest, user_code_digest, status, poll_interval_seconds,
                next_poll_at, expires_at, approval_json, created_at, updated_at
         FROM security_pairing_requests request
         LEFT JOIN security_pairing_client_metadata metadata
           ON metadata.pairing_request_id = request.id
         WHERE request.${column} = ?`
      )
      .get(value) as PairingRow | undefined;
    return row ? mapPairing(row) : null;
  }

  private revokeCompromisedClientInCurrentTransaction(
    clientId: string,
    revokedAt: string,
    reason: string
  ) {
    this.database
      .prepare(
        `UPDATE security_clients
         SET revoked_at = COALESCE(revoked_at, ?),
             revocation_reason = COALESCE(revocation_reason, ?),
             client_epoch = client_epoch + CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END
         WHERE id = ?`
      )
      .run(revokedAt, reason, clientId);
    this.database
      .prepare(
        `UPDATE security_refresh_families
         SET revoked_at = COALESCE(revoked_at, ?),
             revocation_reason = COALESCE(revocation_reason, ?)
         WHERE client_id = ?`
      )
      .run(revokedAt, reason, clientId);
  }

  private claimRateLimitInCurrentTransaction(input: {
    bucketKey: string;
    now: string;
    windowSeconds: number;
    maximumAttempts: number;
  }) {
    const windowFloor = new Date(
      Date.parse(input.now) - input.windowSeconds * 1000
    ).toISOString();
    this.database
      .prepare(
        `DELETE FROM security_pairing_rate_limits
         WHERE updated_at <= ?`
      )
      .run(windowFloor);
    const row = this.database
      .prepare(
        `SELECT window_started_at, failures
         FROM security_pairing_rate_limits WHERE bucket_key = ?`
      )
      .get(input.bucketKey) as
      | { window_started_at: string; failures: number }
      | undefined;
    if (
      row &&
      row.window_started_at > windowFloor &&
      row.failures >= input.maximumAttempts
    ) {
      return false;
    }
    if (!row || row.window_started_at <= windowFloor) {
      this.database
        .prepare(
          `INSERT INTO security_pairing_rate_limits (
             bucket_key, window_started_at, failures, updated_at
           ) VALUES (?, ?, 1, ?)
           ON CONFLICT(bucket_key) DO UPDATE SET
             window_started_at = excluded.window_started_at,
             failures = 1,
             updated_at = excluded.updated_at`
        )
        .run(input.bucketKey, input.now, input.now);
    } else {
      this.database
        .prepare(
          `UPDATE security_pairing_rate_limits
           SET failures = failures + 1, updated_at = ?
           WHERE bucket_key = ?`
        )
        .run(input.now, input.bucketKey);
    }
    return true;
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}
