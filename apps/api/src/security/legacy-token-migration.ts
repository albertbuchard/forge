import type { DatabaseSync } from "node:sqlite";

import type { AgentTokenSummary } from "../types.js";
import type { ForgePrincipal } from "./contracts.js";

export type LegacyTokenMode = "local_migration" | "tailnet_gate" | "disabled";
export type LegacyTokenTransport =
  | "direct_loopback"
  | "tailnet_forwarded"
  | "other_network";

type LegacyTokenMigrationRow = {
  token_id: string;
  owner_id: string;
  installation_id: string;
  audience: string;
  profile: ForgePrincipal["profile"];
  scopes_json: string;
  migrated_at: string;
  expires_at: string;
  revoked_at: string | null;
};

function canonicalScopes(scopes: readonly string[]) {
  return [...new Set(scopes)].sort();
}

export function legacyTokenProfile(token: {
  scopes: readonly string[];
  trustLevel: string;
}): ForgePrincipal["profile"] {
  if (
    token.scopes.some(
      (scope) =>
        scope === "*" ||
        scope.startsWith("machine.") ||
        scope.startsWith("secret.") ||
        scope.startsWith("admin.")
    )
  ) {
    return "executor";
  }
  if (token.trustLevel === "trusted" || token.trustLevel === "autonomous") {
    return "trusted_personal_assistant";
  }
  return token.scopes.includes("write") ? "custom" : "viewer";
}

export class LegacyTokenMigrationService {
  constructor(
    private readonly database: DatabaseSync,
    readonly ownerId: string,
    readonly installationId: string,
    readonly audience: string,
    readonly mode: LegacyTokenMode = "local_migration",
    private readonly now: () => Date = () => new Date(),
    private readonly maximumLifetimeSeconds = 30 * 24 * 60 * 60,
    readonly creationEnabled = mode === "local_migration"
  ) {}

  backfill(tokens: readonly AgentTokenSummary[]) {
    for (const token of tokens) {
      this.register(token);
    }
  }

  register(token: AgentTokenSummary) {
    if (
      !Number.isSafeInteger(this.maximumLifetimeSeconds) ||
      this.maximumLifetimeSeconds <= 0 ||
      this.maximumLifetimeSeconds > 30 * 24 * 60 * 60
    ) {
      throw new Error("Forge legacy-token migration lifetime is invalid.");
    }
    const migratedAt = this.now();
    const expiresAt = new Date(
      migratedAt.getTime() + this.maximumLifetimeSeconds * 1_000
    );
    this.database
      .prepare(
        `INSERT OR IGNORE INTO security_legacy_token_migrations (
           token_id, owner_id, installation_id, audience, profile, scopes_json,
           migrated_at, expires_at, revoked_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        token.id,
        this.ownerId,
        this.installationId,
        this.audience,
        legacyTokenProfile(token),
        JSON.stringify(canonicalScopes(token.scopes)),
        migratedAt.toISOString(),
        expiresAt.toISOString(),
        token.revokedAt
      );
    return this.read(token.id);
  }

  authorize(
    token: AgentTokenSummary,
    transport: LegacyTokenTransport = "other_network"
  ) {
    // Legacy bearer credentials are accepted only on a direct loopback
    // connection. A proxy-to-loopback connection, including Tailscale Serve,
    // must use the paired renewable-credential flow because ordinary HTTP
    // headers cannot prove the proxy's identity.
    if (this.mode === "disabled" || transport !== "direct_loopback") {
      return false;
    }
    let row = this.read(token.id);
    if (
      !row &&
      this.mode === "local_migration" &&
      transport === "direct_loopback"
    ) {
      row = this.register(token);
    }
    if (
      !row ||
      row.revoked_at ||
      token.revokedAt ||
      row.owner_id !== this.ownerId ||
      row.installation_id !== this.installationId ||
      row.audience !== this.audience ||
      row.profile !== legacyTokenProfile(token) ||
      row.expires_at <= this.now().toISOString()
    ) {
      return false;
    }
    let recordedScopes: unknown;
    try {
      recordedScopes = JSON.parse(row.scopes_json);
    } catch {
      return false;
    }
    if (
      !Array.isArray(recordedScopes) ||
      JSON.stringify(recordedScopes) !==
        JSON.stringify(canonicalScopes(token.scopes))
    ) {
      return false;
    }
    return true;
  }

  canCreate(transport: LegacyTokenTransport) {
    return this.creationEnabled && transport === "direct_loopback";
  }

  revoke(tokenId: string, revokedAt = this.now().toISOString()) {
    this.database
      .prepare(
        `UPDATE security_legacy_token_migrations
         SET revoked_at = COALESCE(revoked_at, ?)
         WHERE token_id = ?`
      )
      .run(revokedAt, tokenId);
  }

  read(tokenId: string) {
    return (
      (this.database
        .prepare(
          `SELECT token_id, owner_id, installation_id, audience, profile,
                  scopes_json, migrated_at, expires_at, revoked_at
           FROM security_legacy_token_migrations
           WHERE token_id = ?`
        )
        .get(tokenId) as LegacyTokenMigrationRow | undefined) ?? null
    );
  }
}

export function legacyTokenModeFromEnvironment(
  env: NodeJS.ProcessEnv = process.env
): LegacyTokenMode {
  const value = env.FORGE_LEGACY_TOKEN_MODE?.trim().toLowerCase();
  if (!value || value === "local_migration") return "local_migration";
  if (value === "tailnet_gate") return "tailnet_gate";
  if (value === "disabled") return "disabled";
  throw new Error(
    "FORGE_LEGACY_TOKEN_MODE must be local_migration, tailnet_gate, or disabled."
  );
}
