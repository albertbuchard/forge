import type { FastifyReply } from "fastify";
import { AbstractAuditedManager } from "../base.js";
import { AuthRequiredError } from "../contracts.js";
import type { DatabaseManager } from "./database-manager.js";
import type { SecretsManager } from "./secrets-manager.js";
import type { ConfigurationManager } from "./configuration-manager.js";
import type { AuditManager } from "./audit-manager.js";

export type OperatorSession = {
  id: string;
  actorLabel: string;
  expiresAt: string;
};

type OperatorSessionRow = {
  id: string;
  actor_label: string;
  expires_at: string;
  revoked_at: string | null;
};

function cookieHeaderValue(name: string, value: string, maxAgeSeconds: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export class SessionManager extends AbstractAuditedManager {
  readonly name = "SessionManager";

  constructor(
    private readonly databaseManager: DatabaseManager,
    private readonly secretsManager: SecretsManager,
    private readonly configurationManager: ConfigurationManager,
    private readonly auditManager: AuditManager
  ) {
    super();
  }

  ensureLocalOperatorSession(
    headers: Record<string, unknown>,
    reply: FastifyReply
  ): OperatorSession {
    void headers;
    void reply;
    throw new AuthRequiredError(
      "Header and network location based operator-session bootstrap is disabled. Use the verified local owner exchange."
    );
  }

  revokeCurrentSession(headers: Record<string, unknown>, reply: FastifyReply) {
    const session = this.readSessionFromHeaders(headers);
    if (!session) {
      reply.header(
        "Set-Cookie",
        cookieHeaderValue(
          this.configurationManager.readRuntimeConfig().sessionCookieName,
          "",
          0
        )
      );
      return false;
    }

    this.databaseManager
      .getConnection()
      .prepare(
        `UPDATE operator_sessions SET revoked_at = ?, updated_at = ? WHERE id = ?`
      )
      .run(new Date().toISOString(), new Date().toISOString(), session.id);
    reply.header(
      "Set-Cookie",
      cookieHeaderValue(
        this.configurationManager.readRuntimeConfig().sessionCookieName,
        "",
        0
      )
    );
    return true;
  }

  readSessionFromHeaders(
    headers: Record<string, unknown>
  ): OperatorSession | null {
    const rawCookie = headers.cookie;
    const cookieHeader = Array.isArray(rawCookie)
      ? rawCookie[0]
      : typeof rawCookie === "string"
        ? rawCookie
        : "";
    if (!cookieHeader) {
      return null;
    }

    const pairs = cookieHeader.split(";").map((entry: string) => entry.trim());
    const needle = `${this.configurationManager.readRuntimeConfig().sessionCookieName}=`;
    const sessionCookie = pairs.find((entry: string) =>
      entry.startsWith(needle)
    );
    if (!sessionCookie) {
      return null;
    }

    const sessionToken = decodeURIComponent(sessionCookie.slice(needle.length));
    if (!sessionToken) {
      return null;
    }

    const row = this.databaseManager
      .getConnection()
      .prepare(
        `SELECT id, actor_label, expires_at, revoked_at
         FROM operator_sessions
         WHERE session_hash = ?`
      )
      .get(this.secretsManager.hashSecret(sessionToken)) as
      | OperatorSessionRow
      | undefined;

    if (!row || row.revoked_at) {
      return null;
    }

    if (Date.parse(row.expires_at) <= Date.now()) {
      this.databaseManager
        .getConnection()
        .prepare(
          `UPDATE operator_sessions SET revoked_at = ?, updated_at = ? WHERE id = ?`
        )
        .run(new Date().toISOString(), new Date().toISOString(), row.id);
      return null;
    }

    this.databaseManager
      .getConnection()
      .prepare(
        `UPDATE operator_sessions SET last_used_at = ?, updated_at = ? WHERE id = ?`
      )
      .run(new Date().toISOString(), new Date().toISOString(), row.id);

    return {
      id: row.id,
      actorLabel: row.actor_label,
      expiresAt: row.expires_at
    };
  }
}
