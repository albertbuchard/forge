import { AbstractManager } from "../base.js";
function readSingleHeaderValue(value) {
    if (Array.isArray(value)) {
        return value[0] ?? null;
    }
    return typeof value === "string" ? value : null;
}
function normalizeSource(value) {
    if (value === "ui" || value === "agent" || value === "openclaw" || value === "system") {
        return value;
    }
    return null;
}
export class AuthenticationManager extends AbstractManager {
    sessionManager;
    tokenManager;
    name = "AuthenticationManager";
    constructor(sessionManager, tokenManager) {
        super();
        this.sessionManager = sessionManager;
        this.tokenManager = tokenManager;
    }
    authenticate(headers) {
        const sourceHeader = readSingleHeaderValue(headers["x-forge-source"]);
        const actorHeader = readSingleHeaderValue(headers["x-forge-actor"]);
        const bearer = this.parseBearerToken(headers);
        const token = bearer ? this.tokenManager.verifyBearerToken(bearer) : null;
        const session = this.sessionManager.readSessionFromHeaders(headers);
        const sourceOverride = normalizeSource(sourceHeader);
        const actor = token?.agentLabel ?? session?.actorLabel ?? actorHeader ?? null;
        const source = token ? sourceOverride ?? "agent" : sourceOverride ?? (session ? "ui" : "ui");
        return {
            now: new Date(),
            correlationId: null,
            requestId: null,
            origin: readSingleHeaderValue(headers.origin),
            host: readSingleHeaderValue(headers.host),
            ip: null,
            actor,
            source,
            token,
            session
        };
    }
    parseBearerToken(headers) {
        const raw = readSingleHeaderValue(headers.authorization);
        if (!raw) {
            return null;
        }
        const [scheme, token] = raw.trim().split(/\s+/, 2);
        if (scheme?.toLowerCase() !== "bearer" || !token) {
            return null;
        }
        return token;
    }
}
