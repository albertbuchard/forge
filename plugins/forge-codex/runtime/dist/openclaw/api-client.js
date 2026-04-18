import { userInfo } from "node:os";
import packageJson from "../../package.json" with { type: "json" };
import { ensureForgeRuntimeReady } from "./local-runtime.js";
const DEFAULT_REQUEST_BODY_LIMIT = 256_000;
const DEFAULT_RESPONSE_BODY_LIMIT = 2_000_000;
const operatorSessionStates = new Map();
export class ForgePluginError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = "ForgePluginError";
    }
}
function normalizeBaseUrl(baseUrl) {
    return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}
function normalizeOriginUrl(baseUrl) {
    return new URL(normalizeBaseUrl(baseUrl)).origin;
}
export function buildForgeBaseUrl(origin, port) {
    const url = new URL(origin.endsWith("/") ? origin : `${origin}/`);
    url.port = String(port);
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.origin;
}
export function buildForgeWebAppUrl(origin, port) {
    return `${buildForgeBaseUrl(origin, port)}/forge/`;
}
function isTailscaleIpv4(hostname) {
    const match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!match) {
        return false;
    }
    const [a, b] = match.slice(1).map((value) => Number(value));
    return Number.isInteger(a) && Number.isInteger(b) && a === 100 && b >= 64 && b <= 127;
}
export function canBootstrapOperatorSession(baseUrl) {
    const hostname = new URL(normalizeBaseUrl(baseUrl)).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.endsWith(".ts.net") || isTailscaleIpv4(hostname);
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function buildErrorBody(code, message) {
    return {
        ok: false,
        error: {
            code,
            message
        }
    };
}
async function readReadableStreamBody(stream, maxBytes) {
    const reader = stream.getReader();
    const chunks = [];
    let totalBytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            if (!value) {
                continue;
            }
            totalBytes += value.byteLength;
            if (totalBytes > maxBytes) {
                throw new ForgePluginError(502, "forge_plugin_response_too_large", `Forge response exceeded ${maxBytes} bytes`);
            }
            chunks.push(value);
        }
    }
    finally {
        reader.releaseLock();
    }
    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(merged);
}
async function readResponseBody(response, maxBytes = DEFAULT_RESPONSE_BODY_LIMIT) {
    if (!response.body) {
        return null;
    }
    const text = await readReadableStreamBody(response.body, maxBytes);
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    }
    catch {
        return {
            ok: false,
            error: {
                code: "forge_upstream_invalid_json",
                message: text
            }
        };
    }
}
function readOperatorSessionActorLabel(payload) {
    if (!isRecord(payload)) {
        return null;
    }
    const session = payload.session;
    if (!isRecord(session)) {
        return null;
    }
    const actorLabel = session.actorLabel;
    return typeof actorLabel === "string" && actorLabel.trim().length > 0
        ? actorLabel.trim()
        : null;
}
function fallbackActorLabel() {
    const username = userInfo().username.trim();
    return username.length > 0 ? username : "Local Operator";
}
function buildRequestHeaders(args) {
    const headers = {
        accept: "application/json",
        "x-forge-source": "openclaw",
        "x-forge-plugin-version": packageJson.version
    };
    if (args.actorLabel) {
        headers["x-forge-actor"] = args.actorLabel;
    }
    if (args.apiToken) {
        headers.authorization = `Bearer ${args.apiToken}`;
    }
    if (args.idempotencyKey) {
        headers["idempotency-key"] = args.idempotencyKey;
    }
    if (args.body !== undefined) {
        headers["content-type"] = "application/json";
    }
    for (const [name, value] of Object.entries(args.extraHeaders ?? {})) {
        if (typeof value === "string" && value.trim().length > 0) {
            headers[name] = value;
        }
    }
    return headers;
}
async function ensureOperatorSessionState(baseUrl, timeoutMs) {
    const origin = normalizeOriginUrl(baseUrl);
    const cached = operatorSessionStates.get(origin);
    if (cached) {
        return cached;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(new URL("/api/v1/auth/operator-session", normalizeBaseUrl(baseUrl)), {
            method: "GET",
            headers: {
                accept: "application/json",
                "x-forge-source": "openclaw"
            },
            signal: controller.signal
        });
        const setCookie = response.headers.get("set-cookie");
        if (!response.ok || !setCookie) {
            throw new ForgePluginError(401, "forge_plugin_session_bootstrap_failed", "Forge did not issue an operator session. Add a token or use a trusted local/Tailscale Forge URL.");
        }
        const cookie = setCookie.split(";")[0]?.trim();
        if (!cookie) {
            throw new ForgePluginError(401, "forge_plugin_session_bootstrap_failed", "Forge issued an unusable operator session cookie.");
        }
        const body = await readResponseBody(response);
        const state = {
            cookie,
            actorLabel: readOperatorSessionActorLabel(body)
        };
        operatorSessionStates.set(origin, state);
        return state;
    }
    catch (error) {
        if (error instanceof ForgePluginError) {
            throw error;
        }
        const message = error instanceof Error && error.name === "AbortError"
            ? `Forge operator-session bootstrap timed out after ${timeoutMs}ms`
            : error instanceof Error
                ? error.message
                : String(error);
        throw new ForgePluginError(502, "forge_plugin_session_bootstrap_failed", message);
    }
    finally {
        clearTimeout(timeout);
    }
}
export async function resolveForgeActorLabel(args) {
    const explicitActorLabel = args.actorLabel?.trim();
    if (explicitActorLabel) {
        return explicitActorLabel;
    }
    if (!args.apiToken && canBootstrapOperatorSession(args.baseUrl)) {
        const sessionState = await ensureOperatorSessionState(args.baseUrl, Math.max(1000, args.timeoutMs ?? 15_000));
        if (sessionState.actorLabel) {
            return sessionState.actorLabel;
        }
    }
    return fallbackActorLabel();
}
export async function resolveConfiguredForgeActorLabel(config) {
    return resolveForgeActorLabel({
        baseUrl: config.baseUrl,
        apiToken: config.apiToken,
        actorLabel: config.actorLabel,
        timeoutMs: config.timeoutMs
    });
}
export async function callForgeApi(args) {
    return callForgeApiInternal(args, false);
}
export async function callConfiguredForgeApi(config, args) {
    await ensureForgeRuntimeReady(config);
    return callForgeApi({
        baseUrl: config.baseUrl,
        apiToken: config.apiToken,
        actorLabel: config.actorLabel,
        timeoutMs: config.timeoutMs,
        ...args
    });
}
async function callForgeApiInternal(args, retriedWithFreshSession) {
    const controller = new AbortController();
    const timeoutMs = Math.max(1000, args.timeoutMs ?? 15_000);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const actorLabel = await resolveForgeActorLabel(args);
    const sessionState = !args.apiToken && canBootstrapOperatorSession(args.baseUrl)
        ? await ensureOperatorSessionState(args.baseUrl, timeoutMs)
        : null;
    try {
        const response = await fetch(new URL(args.path, normalizeBaseUrl(args.baseUrl)), {
            method: args.method,
            headers: {
                ...buildRequestHeaders({
                    ...args,
                    actorLabel
                }),
                ...(sessionState ? { cookie: sessionState.cookie } : {})
            },
            body: args.body === undefined ? undefined : JSON.stringify(args.body),
            signal: controller.signal
        });
        if (!args.apiToken && sessionState && response.status === 401 && !retriedWithFreshSession) {
            operatorSessionStates.delete(normalizeOriginUrl(args.baseUrl));
            return callForgeApiInternal(args, true);
        }
        const body = await readResponseBody(response);
        return {
            status: response.status,
            body: body ?? (response.ok ? { ok: true } : buildErrorBody("forge_upstream_empty_response", `Forge API ${response.status} returned no body`))
        };
    }
    catch (error) {
        if (error instanceof ForgePluginError) {
            throw error;
        }
        const message = error instanceof Error && error.name === "AbortError"
            ? `Forge API request timed out after ${timeoutMs}ms`
            : error instanceof Error
                ? error.message
                : String(error);
        throw new ForgePluginError(502, "forge_plugin_upstream_unreachable", message);
    }
    finally {
        clearTimeout(timeout);
    }
}
export async function readJsonRequestBody(request, options = {}) {
    const maxBytes = options.maxBytes ?? DEFAULT_REQUEST_BODY_LIMIT;
    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        totalBytes += buffer.byteLength;
        if (totalBytes > maxBytes) {
            throw new ForgePluginError(413, "forge_plugin_body_too_large", `Request body exceeded ${maxBytes} bytes`);
        }
        chunks.push(buffer);
    }
    if (chunks.length === 0) {
        return options.emptyObject ? {} : undefined;
    }
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (!raw) {
        return options.emptyObject ? {} : undefined;
    }
    try {
        return JSON.parse(raw);
    }
    catch (error) {
        throw new ForgePluginError(400, "forge_plugin_invalid_json", error instanceof Error ? error.message : "Request body must be valid JSON");
    }
}
export function readSingleHeaderValue(headers, name) {
    const raw = headers[name.toLowerCase()];
    if (Array.isArray(raw)) {
        return raw[0] ?? null;
    }
    return typeof raw === "string" ? raw : null;
}
export function requireApiToken(config) {
    if (config.apiToken.trim().length === 0 && !canBootstrapOperatorSession(config.baseUrl)) {
        throw new ForgePluginError(401, "forge_plugin_token_required", "Forge apiToken is required for remote plugin mutations when this target cannot use local or Tailscale operator-session bootstrap");
    }
}
export function writeJsonResponse(response, status, body) {
    response.statusCode = status;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify(body));
}
export function writeRedirectResponse(response, location) {
    response.statusCode = 302;
    response.setHeader("location", location);
    response.end("");
}
export function writeForgeProxyResponse(response, result) {
    writeJsonResponse(response, result.status, result.body);
}
export function writePluginError(response, error) {
    if (error instanceof ForgePluginError) {
        writeJsonResponse(response, error.status, buildErrorBody(error.code, error.message));
        return;
    }
    writeJsonResponse(response, 500, buildErrorBody("forge_plugin_internal_error", error instanceof Error ? error.message : String(error)));
}
export function expectForgeSuccess(result) {
    if (result.status >= 400) {
        const message = isRecord(result.body) &&
            isRecord(result.body.error) &&
            typeof result.body.error.message === "string"
            ? result.body.error.message
            : `Forge API returned ${result.status}`;
        throw new ForgePluginError(result.status, "forge_plugin_upstream_error", message);
    }
    return result.body;
}
