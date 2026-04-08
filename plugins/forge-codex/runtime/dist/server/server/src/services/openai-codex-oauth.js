import { randomUUID } from "node:crypto";
import { loginOpenAICodex } from "@mariozechner/pi-ai/oauth";
import { openAiCodexOauthSessionSchema } from "../types.js";
const sessions = new Map();
const SESSION_TTL_MS = 15 * 60 * 1000;
function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((nextResolve, nextReject) => {
        resolve = nextResolve;
        reject = nextReject;
    });
    return { promise, resolve, reject };
}
function updateSession(sessionId, patch) {
    const existing = sessions.get(sessionId);
    if (!existing) {
        throw new Error(`Unknown OpenAI Codex OAuth session ${sessionId}`);
    }
    existing.publicSession = openAiCodexOauthSessionSchema.parse({
        ...existing.publicSession,
        ...patch
    });
    return existing.publicSession;
}
function requireRecord(sessionId) {
    const record = sessions.get(sessionId);
    if (!record) {
        throw new Error(`Unknown OpenAI Codex OAuth session ${sessionId}`);
    }
    const expiresAt = new Date(record.publicSession.expiresAt).getTime();
    if (Date.now() >= expiresAt && record.publicSession.status !== "authorized") {
        record.publicSession = openAiCodexOauthSessionSchema.parse({
            ...record.publicSession,
            status: "expired"
        });
    }
    return record;
}
function parseError(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
export async function startOpenAiCodexOauthSession(options = {}) {
    const id = `ocx_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const now = new Date();
    const record = {
        publicSession: openAiCodexOauthSessionSchema.parse({
            id,
            status: "starting",
            authUrl: null,
            accountLabel: null,
            error: null,
            createdAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
            credentialExpiresAt: null
        }),
        manualInput: createDeferred(),
        authReady: createDeferred(),
        credentials: null
    };
    sessions.set(id, record);
    const login = options.login ?? loginOpenAICodex;
    void login({
        onAuth: ({ url }) => {
            updateSession(id, {
                status: "awaiting_browser",
                authUrl: url,
                error: null
            });
            record.authReady.resolve();
        },
        onPrompt: async () => {
            updateSession(id, {
                status: "awaiting_manual_input"
            });
            record.authReady.resolve();
            return await record.manualInput.promise;
        },
        onManualCodeInput: async () => {
            updateSession(id, {
                status: "awaiting_manual_input"
            });
            record.authReady.resolve();
            return await record.manualInput.promise;
        }
    })
        .then((credentials) => {
        record.credentials = credentials;
        updateSession(id, {
            status: "authorized",
            accountLabel: typeof credentials.accountId === "string"
                ? credentials.accountId
                : null,
            credentialExpiresAt: typeof credentials.expires === "number"
                ? new Date(credentials.expires).toISOString()
                : null
        });
    })
        .catch((error) => {
        updateSession(id, {
            status: "error",
            error: parseError(error)
        });
        try {
            record.authReady.resolve();
        }
        catch {
            return;
        }
    });
    await Promise.race([
        record.authReady.promise,
        new Promise((resolve) => setTimeout(resolve, 250))
    ]);
    return record.publicSession;
}
export function getOpenAiCodexOauthSession(sessionId) {
    return requireRecord(sessionId).publicSession;
}
export function submitOpenAiCodexOauthManualInput(sessionId, codeOrUrl) {
    const record = requireRecord(sessionId);
    if (record.publicSession.status !== "awaiting_browser" &&
        record.publicSession.status !== "awaiting_manual_input" &&
        record.publicSession.status !== "starting") {
        throw new Error("OpenAI Codex OAuth session is not waiting for input.");
    }
    record.manualInput.resolve(codeOrUrl);
    return updateSession(sessionId, {
        status: "awaiting_manual_input"
    });
}
export function consumeOpenAiCodexOauthCredentials(sessionId) {
    const record = requireRecord(sessionId);
    if (record.publicSession.status !== "authorized" || !record.credentials) {
        throw new Error("OpenAI Codex OAuth session is not authorized yet.");
    }
    updateSession(sessionId, {
        status: "consumed"
    });
    return {
        kind: "oauth",
        provider: "openai-codex",
        access: String(record.credentials.access),
        refresh: String(record.credentials.refresh),
        expires: Number(record.credentials.expires),
        accountId: typeof record.credentials.accountId === "string"
            ? record.credentials.accountId
            : ""
    };
}
