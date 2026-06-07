import { Agent as HttpAgent, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { resolveGamificationSpriteAssetPath } from "./services/gamification-assets.js";
const distDir = path.join(process.cwd(), "dist");
const packagedRuntimeDistDir = path.join(process.cwd(), "plugins", "forge-codex", "runtime", "dist");
const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2"
};
const gamificationSpriteRoutePrefix = "/gamification/sprites/";
function normalizeBasePath(value) {
    if (!value || value === "/") {
        return "/";
    }
    const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
    return withLeadingSlash.endsWith("/")
        ? withLeadingSlash
        : `${withLeadingSlash}/`;
}
function normalizeAbsoluteUrl(value) {
    const url = new URL(value);
    url.pathname = normalizeBasePath(url.pathname);
    return url;
}
function getDefaultBasePath() {
    return process.env.FORGE_BASE_PATH ?? "/forge/";
}
function getDevWebOrigin() {
    const value = process.env.FORGE_DEV_WEB_ORIGIN?.trim();
    return value && value.length > 0 ? value : null;
}
function shouldAutostartDevWeb(env) {
    const value = env.FORGE_DEV_WEB_AUTOSTART?.trim().toLowerCase();
    return value !== "0" && value !== "false" && value !== "no";
}
function getDevWebCommand(env) {
    const value = env.FORGE_DEV_WEB_COMMAND?.trim();
    return value && value.length > 0 ? value : "npm run dev:web";
}
function getDefaultDevWebOriginPort(origin) {
    if (origin?.port && origin.port.trim().length > 0) {
        return origin.port;
    }
    if (origin?.protocol === "https:") {
        return "443";
    }
    return "3027";
}
function getDefaultViteCliPath(cwd) {
    const candidate = path.join(cwd, "node_modules", "vite", "bin", "vite.js");
    return existsSync(candidate) ? candidate : null;
}
function buildManagedDevWebLaunch(input) {
    const explicitCommand = input.env.FORGE_DEV_WEB_COMMAND?.trim();
    if (explicitCommand && explicitCommand.length > 0) {
        return {
            command: explicitCommand,
            env: input.env,
            shell: true
        };
    }
    const viteCliPath = getDefaultViteCliPath(input.cwd);
    if (!viteCliPath) {
        return {
            command: getDevWebCommand(input.env),
            env: input.env,
            shell: true
        };
    }
    const host = input.env.FORGE_DEV_WEB_HOST?.trim() || "127.0.0.1";
    const port = input.env.FORGE_DEV_WEB_PORT?.trim() ||
        getDefaultDevWebOriginPort(input.origin);
    return {
        command: process.execPath,
        args: [viteCliPath, "--host", host, "--port", port],
        env: {
            ...input.env,
            FORGE_BASE_PATH: getDefaultBasePath()
        },
        shell: false
    };
}
function stripBasePath(requestPath, basePath) {
    const normalizedBasePath = normalizeBasePath(basePath);
    if (normalizedBasePath === "/") {
        return requestPath;
    }
    const normalizedRoot = normalizedBasePath.slice(0, -1);
    if (requestPath === normalizedRoot) {
        return "/";
    }
    if (requestPath.startsWith(normalizedBasePath)) {
        const stripped = requestPath.slice(normalizedRoot.length);
        return stripped.startsWith("/") ? stripped : `/${stripped}`;
    }
    return requestPath;
}
function resolveAsset(clientDir, requestPath) {
    if (requestPath === "/") {
        return path.join(clientDir, "index.html");
    }
    const safePath = requestPath.replace(/^\/+/, "");
    return path.join(clientDir, safePath);
}
async function resolveBuiltAsset(clientDir, requestPath) {
    if (requestPath.startsWith(gamificationSpriteRoutePrefix)) {
        const relativeSpritePath = requestPath.slice(gamificationSpriteRoutePrefix.length);
        return resolveGamificationSpriteAssetPath(relativeSpritePath);
    }
    return resolveAsset(clientDir, requestPath);
}
async function getClientDir() {
    try {
        await access(path.join(distDir, "index.html"));
        return distDir;
    }
    catch {
        await access(path.join(packagedRuntimeDistDir, "index.html"));
        return packagedRuntimeDistDir;
    }
}
function parseRequestTarget(requestPath) {
    return new URL(requestPath, "http://forge.local");
}
function copyProxyHeaders(response, reply) {
    for (const [name, value] of response.headers) {
        const lowerName = name.toLowerCase();
        if (hopByHopHeaders.has(lowerName)) {
            continue;
        }
        reply.header(name, value);
    }
}
function isHtmlResponse(contentType) {
    const values = Array.isArray(contentType) ? contentType : [contentType];
    return values.some((value) => typeof value === "string" && value.toLowerCase().includes("text/html"));
}
function forceUncachedHtml(reply) {
    reply.header("Cache-Control", "no-store, max-age=0, must-revalidate");
    reply.header("Pragma", "no-cache");
}
const hopByHopHeaders = new Set([
    "connection",
    "content-length",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade"
]);
function buildDevWebTarget(origin, pathname, search) {
    const target = new URL(pathname.startsWith("/") ? pathname.slice(1) : pathname, origin);
    target.search = search;
    return target;
}
async function proxyDevAsset(input) {
    const target = buildDevWebTarget(input.origin, input.pathname, input.search);
    const response = await input.fetchImpl(target, { redirect: "manual" });
    input.reply.code(response.status);
    copyProxyHeaders(response, input.reply);
    if (isHtmlResponse(response.headers.get("content-type") ?? undefined)) {
        forceUncachedHtml(input.reply);
    }
    else if (!response.headers.has("cache-control")) {
        input.reply.header("Cache-Control", "no-store, max-age=0, must-revalidate");
    }
    if (!response.body) {
        return "";
    }
    return Buffer.from(await response.arrayBuffer());
}
export function createKeepAliveDevAssetProxy() {
    const httpAgent = new HttpAgent({
        keepAlive: true,
        maxFreeSockets: 8,
        maxSockets: 32
    });
    const httpsAgent = new HttpsAgent({
        keepAlive: true,
        maxFreeSockets: 8,
        maxSockets: 32
    });
    return {
        fetch(input) {
            const target = buildDevWebTarget(input.origin, input.pathname, input.search);
            const isHttps = target.protocol === "https:";
            const request = isHttps ? httpsRequest : httpRequest;
            const agent = isHttps ? httpsAgent : httpAgent;
            return new Promise((resolve, reject) => {
                const proxyRequest = request(target, {
                    agent,
                    headers: {
                        Accept: "*/*",
                        Host: target.host
                    },
                    method: "GET"
                }, (response) => {
                    input.reply.code(response.statusCode ?? 502);
                    for (const [name, value] of Object.entries(response.headers)) {
                        if (!value || hopByHopHeaders.has(name.toLowerCase())) {
                            continue;
                        }
                        input.reply.header(name, value);
                    }
                    if (isHtmlResponse(response.headers["content-type"])) {
                        forceUncachedHtml(input.reply);
                    }
                    else if (!response.headers["cache-control"]) {
                        input.reply.header("Cache-Control", "no-store, max-age=0, must-revalidate");
                    }
                    const chunks = [];
                    response.on("data", (chunk) => {
                        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                    });
                    response.on("end", () => {
                        resolve(Buffer.concat(chunks));
                    });
                    response.on("error", reject);
                });
                proxyRequest.on("error", reject);
                proxyRequest.end();
            });
        },
        close() {
            httpAgent.destroy();
            httpsAgent.destroy();
        }
    };
}
function createDevAssetProxy(fetchImpl) {
    if (fetchImpl !== fetch) {
        return {
            fetch(input) {
                return proxyDevAsset({ ...input, fetchImpl });
            },
            close() { }
        };
    }
    return createKeepAliveDevAssetProxy();
}
function writeProxyUpgradeResponse(socket, response) {
    const statusCode = response.statusCode ?? 101;
    const statusMessage = response.statusMessage ?? "Switching Protocols";
    const headerLines = [];
    for (let index = 0; index < response.rawHeaders.length; index += 2) {
        const name = response.rawHeaders[index];
        const value = response.rawHeaders[index + 1];
        if (name && value) {
            headerLines.push(`${name}: ${value}`);
        }
    }
    socket.write(`HTTP/${response.httpVersion} ${statusCode} ${statusMessage}\r\n${headerLines.join("\r\n")}\r\n\r\n`);
}
async function proxyDevWebSocket(input) {
    const requestTarget = parseRequestTarget(input.request.url ?? "/");
    const normalizedRequestPath = stripBasePath(requestTarget.pathname, getDefaultBasePath());
    if (!normalizedRequestPath.startsWith("/__vite_hmr")) {
        return false;
    }
    const devWebOrigin = await input.devWebRuntime.ensureReady();
    if (!devWebOrigin) {
        input.socket.destroy();
        return true;
    }
    const target = buildDevWebTarget(devWebOrigin, normalizedRequestPath, requestTarget.search);
    const proxyRequest = (target.protocol === "https:" ? httpsRequest : httpRequest)(target, {
        headers: {
            ...input.request.headers,
            host: target.host
        }
    });
    proxyRequest.on("upgrade", (response, proxySocket, proxyHead) => {
        const closeBothSockets = () => {
            proxySocket.destroy();
            input.socket.destroy();
        };
        proxySocket.on("error", closeBothSockets);
        input.socket.on("error", closeBothSockets);
        writeProxyUpgradeResponse(input.socket, response);
        if (proxyHead.length > 0) {
            input.socket.write(proxyHead);
        }
        if (input.head.length > 0) {
            proxySocket.write(input.head);
        }
        proxySocket.pipe(input.socket).pipe(proxySocket);
    });
    proxyRequest.on("response", () => {
        input.socket.destroy();
    });
    proxyRequest.on("error", () => {
        input.socket.destroy();
    });
    proxyRequest.end();
    return true;
}
async function waitForProcessExit(child, timeoutMs = 5_000) {
    if (child.exitCode !== null) {
        return;
    }
    await Promise.race([
        new Promise((resolve) => {
            child.once("exit", () => resolve());
            child.once("close", () => resolve());
        }),
        delay(timeoutMs).then(() => { })
    ]);
}
export function createManagedDevWebRuntime(options = {}) {
    const env = options.env ?? process.env;
    const originValue = env.FORGE_DEV_WEB_ORIGIN?.trim();
    const origin = originValue ? normalizeAbsoluteUrl(originValue) : null;
    const cwd = options.cwd ?? process.cwd();
    const fetchImpl = options.fetchImpl ?? fetch;
    const spawnImpl = options.spawnImpl ?? spawn;
    const autostart = shouldAutostartDevWeb(env);
    const waitTimeoutMs = Number(env.FORGE_DEV_WEB_START_TIMEOUT_MS ?? 30_000);
    const pollIntervalMs = 500;
    let child = null;
    let startupPromise = null;
    async function probe() {
        if (!origin) {
            return null;
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1_500);
        try {
            const response = await fetchImpl(origin, {
                method: "GET",
                redirect: "manual",
                signal: controller.signal
            });
            return response.status < 500 ? origin : null;
        }
        catch {
            return null;
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async function waitUntilReady(processRef) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < waitTimeoutMs) {
            const readyOrigin = await probe();
            if (readyOrigin) {
                return readyOrigin;
            }
            if (processRef.exitCode !== null) {
                break;
            }
            await delay(pollIntervalMs);
        }
        return null;
    }
    async function ensureReady() {
        if (!origin) {
            return null;
        }
        const readyOrigin = await probe();
        if (readyOrigin || !autostart) {
            return readyOrigin;
        }
        if (!startupPromise) {
            startupPromise = (async () => {
                if (!child || child.exitCode !== null) {
                    const launch = buildManagedDevWebLaunch({ cwd, env, origin });
                    const nextChild = launch.shell
                        ? spawnImpl(launch.command, {
                            cwd,
                            env: launch.env,
                            shell: true,
                            stdio: "inherit"
                        })
                        : spawnImpl(launch.command, launch.args ?? [], {
                            cwd,
                            env: launch.env,
                            stdio: "inherit"
                        });
                    child = nextChild;
                    nextChild.once("exit", () => {
                        if (child === nextChild) {
                            child = null;
                        }
                    });
                }
                const startedOrigin = await waitUntilReady(child);
                startupPromise = null;
                return startedOrigin;
            })().catch((error) => {
                startupPromise = null;
                throw error;
            });
        }
        return startupPromise;
    }
    async function stop() {
        if (!child || child.exitCode !== null) {
            return;
        }
        const childRef = child;
        childRef.kill("SIGTERM");
        await waitForProcessExit(childRef);
        if (childRef.exitCode === null) {
            childRef.kill("SIGKILL");
            await waitForProcessExit(childRef, 1_000);
        }
        child = null;
    }
    return {
        ensureReady,
        stop
    };
}
async function serveAsset(requestPath, reply, options) {
    const requestTarget = parseRequestTarget(requestPath);
    if (requestTarget.pathname.startsWith("/api")) {
        reply.code(404);
        return { error: "Not found" };
    }
    const normalizedRequestPath = stripBasePath(requestTarget.pathname, getDefaultBasePath());
    const handlesLocalGamificationSprite = normalizedRequestPath.startsWith(gamificationSpriteRoutePrefix);
    const devWebOrigin = handlesLocalGamificationSprite
        ? null
        : await options.devWebRuntime.ensureReady();
    if (devWebOrigin) {
        try {
            return await options.devAssetProxy.fetch({
                origin: devWebOrigin,
                pathname: normalizedRequestPath,
                search: requestTarget.search,
                reply
            });
        }
        catch {
            reply.header("X-Forge-Web-Fallback", "built");
        }
    }
    const clientDir = await getClientDir();
    const assetPath = await resolveBuiltAsset(clientDir, normalizedRequestPath);
    const ext = path.extname(assetPath);
    try {
        const payload = await readFile(assetPath);
        reply.type(contentTypes[ext] ?? "application/octet-stream");
        reply.header("Cache-Control", "no-store, max-age=0, must-revalidate");
        if (ext === ".html") {
            forceUncachedHtml(reply);
        }
        return payload;
    }
    catch {
        if (!path.extname(normalizedRequestPath)) {
            try {
                const payload = await readFile(path.join(clientDir, "index.html"));
                reply.type(contentTypes[".html"]);
                forceUncachedHtml(reply);
                return payload;
            }
            catch {
                reply.code(503);
                return {
                    code: "frontend_not_built",
                    error: "Forge frontend build output is missing. Run the Vite build before serving the modern web client.",
                    statusCode: 503
                };
            }
        }
        reply.code(404);
        return { error: "Asset not found" };
    }
}
export async function registerWebRoutes(app, options = {}) {
    const devWebRuntime = options.devWebRuntime ?? createManagedDevWebRuntime();
    const fetchImpl = options.fetchImpl ?? fetch;
    const devAssetProxy = options.devAssetProxy ?? createDevAssetProxy(fetchImpl);
    const basePath = normalizeBasePath(getDefaultBasePath());
    app.addHook("onClose", async () => {
        await devWebRuntime.stop();
        devAssetProxy.close();
    });
    app.server.on("upgrade", (request, socket, head) => {
        void (async () => {
            await proxyDevWebSocket({
                devWebRuntime,
                request,
                socket,
                head
            });
        })();
    });
    app.get("/__forge-ui-root-redirect", async (_request, reply) => {
        if (basePath !== "/") {
            reply.redirect(basePath, 302);
            return;
        }
        return serveAsset("/", reply, { devWebRuntime, devAssetProxy });
    });
    app.get("/__forge-ui-base-redirect", async (_request, reply) => {
        reply.redirect(basePath, 302);
    });
    app.get("/", async (_request, reply) => serveAsset("/", reply, { devWebRuntime, devAssetProxy }));
    app.get("/*", async (request, reply) => serveAsset(request.url, reply, { devWebRuntime, devAssetProxy }));
}
