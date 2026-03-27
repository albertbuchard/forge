import { randomUUID } from "node:crypto";
import { AbstractAuditedManager } from "../base.js";
import { getSettings } from "../../repositories/settings.js";
import { isTrustedOperatorNetworkEntry } from "./trusted-network.js";
function cookieHeaderValue(name, value, maxAgeSeconds) {
    return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}
export class SessionManager extends AbstractAuditedManager {
    databaseManager;
    secretsManager;
    configurationManager;
    auditManager;
    name = "SessionManager";
    constructor(databaseManager, secretsManager, configurationManager, auditManager) {
        super();
        this.databaseManager = databaseManager;
        this.secretsManager = secretsManager;
        this.configurationManager = configurationManager;
        this.auditManager = auditManager;
    }
    ensureLocalOperatorSession(headers, reply) {
        const existing = this.readSessionFromHeaders(headers);
        if (existing) {
            return existing;
        }
        if (!this.isLocalOperatorRequest(headers)) {
            throw new Error("Operator session bootstrap is only available on local loopback origins.");
        }
        const settings = getSettings();
        const actorLabel = settings.profile.operatorName?.trim() || "Local Operator";
        const issuedAt = new Date();
        const expiresAt = new Date(issuedAt.getTime() + this.configurationManager.readRuntimeConfig().sessionTtlSeconds * 1000);
        const sessionToken = this.secretsManager.createSecret("fg_session");
        const sessionId = `ses_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
        this.databaseManager
            .getConnection()
            .prepare(`INSERT INTO operator_sessions (
          id, session_hash, actor_label, issued_at, last_used_at, expires_at, revoked_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
            .run(sessionId, this.secretsManager.hashSecret(sessionToken), actorLabel, issuedAt.toISOString(), issuedAt.toISOString(), expiresAt.toISOString(), issuedAt.toISOString(), issuedAt.toISOString());
        reply.header("Set-Cookie", cookieHeaderValue(this.configurationManager.readRuntimeConfig().sessionCookieName, sessionToken, this.configurationManager.readRuntimeConfig().sessionTtlSeconds));
        const session = {
            id: sessionId,
            actorLabel,
            expiresAt: expiresAt.toISOString()
        };
        this.auditManager.record("operator.session_issued", "operator_session", sessionId, {
            actor: actorLabel,
            source: "ui",
            origin: null,
            host: null,
            ip: null,
            token: null,
            session
        }, {
            actorLabel
        });
        return session;
    }
    revokeCurrentSession(headers, reply) {
        const session = this.readSessionFromHeaders(headers);
        if (!session) {
            reply.header("Set-Cookie", cookieHeaderValue(this.configurationManager.readRuntimeConfig().sessionCookieName, "", 0));
            return false;
        }
        this.databaseManager
            .getConnection()
            .prepare(`UPDATE operator_sessions SET revoked_at = ?, updated_at = ? WHERE id = ?`)
            .run(new Date().toISOString(), new Date().toISOString(), session.id);
        reply.header("Set-Cookie", cookieHeaderValue(this.configurationManager.readRuntimeConfig().sessionCookieName, "", 0));
        return true;
    }
    readSessionFromHeaders(headers) {
        const rawCookie = headers.cookie;
        const cookieHeader = Array.isArray(rawCookie) ? rawCookie[0] : typeof rawCookie === "string" ? rawCookie : "";
        if (!cookieHeader) {
            return null;
        }
        const pairs = cookieHeader.split(";").map((entry) => entry.trim());
        const needle = `${this.configurationManager.readRuntimeConfig().sessionCookieName}=`;
        const sessionCookie = pairs.find((entry) => entry.startsWith(needle));
        if (!sessionCookie) {
            return null;
        }
        const sessionToken = decodeURIComponent(sessionCookie.slice(needle.length));
        if (!sessionToken) {
            return null;
        }
        const row = this.databaseManager
            .getConnection()
            .prepare(`SELECT id, actor_label, expires_at, revoked_at
         FROM operator_sessions
         WHERE session_hash = ?`)
            .get(this.secretsManager.hashSecret(sessionToken));
        if (!row || row.revoked_at) {
            return null;
        }
        if (Date.parse(row.expires_at) <= Date.now()) {
            this.databaseManager
                .getConnection()
                .prepare(`UPDATE operator_sessions SET revoked_at = ?, updated_at = ? WHERE id = ?`)
                .run(new Date().toISOString(), new Date().toISOString(), row.id);
            return null;
        }
        this.databaseManager
            .getConnection()
            .prepare(`UPDATE operator_sessions SET last_used_at = ?, updated_at = ? WHERE id = ?`)
            .run(new Date().toISOString(), new Date().toISOString(), row.id);
        return {
            id: row.id,
            actorLabel: row.actor_label,
            expiresAt: row.expires_at
        };
    }
    isLocalOperatorRequest(headers) {
        const rawOrigin = Array.isArray(headers.origin) ? headers.origin[0] : headers.origin;
        const rawHost = Array.isArray(headers.host) ? headers.host[0] : headers.host;
        const candidates = [typeof rawOrigin === "string" ? rawOrigin : "", typeof rawHost === "string" ? rawHost : ""].filter(Boolean);
        return candidates.some((entry) => isTrustedOperatorNetworkEntry(entry));
    }
}
