import { canBootstrapOperatorSession, callConfiguredForgeApi, expectForgeSuccess, readJsonRequestBody, readSingleHeaderValue, requireApiToken, writeForgeProxyResponse, writePluginError, writeRedirectResponse } from "./api-client.js";
import { stopForgeRuntime } from "./local-runtime.js";
import { collectSupportedPluginApiRouteKeys, makeApiRouteKey } from "./parity.js";
function passthroughSearch(path, url) {
    return `${path}${url.search}`;
}
function methodNotAllowed(response, allowedMethods) {
    response.setHeader("allow", allowedMethods.join(", "));
    response.statusCode = 405;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify({
        ok: false,
        error: {
            code: "forge_plugin_method_not_allowed",
            message: `Allowed methods: ${allowedMethods.join(", ")}`
        }
    }));
}
function routeNotFound(response, pathname) {
    response.statusCode = 404;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify({
        ok: false,
        error: {
            code: "forge_plugin_route_not_found",
            message: `No Forge plugin route matches ${pathname}`
        }
    }));
}
async function resolveForgeUiUrl(config) {
    try {
        const onboarding = await runReadOnly(config, "/api/v1/agents/onboarding");
        if (typeof onboarding === "object" &&
            onboarding !== null &&
            "onboarding" in onboarding &&
            typeof onboarding.onboarding === "object" &&
            onboarding.onboarding !== null &&
            "webAppUrl" in onboarding.onboarding &&
            typeof onboarding.onboarding.webAppUrl === "string" &&
            onboarding.onboarding.webAppUrl.trim().length > 0) {
            return onboarding.onboarding.webAppUrl;
        }
    }
    catch {
        // Use the configured fallback when onboarding is unavailable.
    }
    return config.webAppUrl;
}
async function forwardOperation(request, response, config, operation, match, url) {
    if (operation.kind === "ui_redirect") {
        writeRedirectResponse(response, await resolveForgeUiUrl(config));
        return;
    }
    if (operation.requiresToken) {
        requireApiToken(config);
    }
    const body = operation.requestBody === "json" ? await readJsonRequestBody(request, { emptyObject: true }) : undefined;
    const result = await callConfiguredForgeApi(config, {
        method: operation.method,
        path: operation.target(match, url),
        body,
        idempotencyKey: readSingleHeaderValue(request.headers, "idempotency-key"),
        extraHeaders: {
            "if-match": readSingleHeaderValue(request.headers, "if-match")
        }
    });
    writeForgeProxyResponse(response, result);
}
async function handleGroup(request, response, config, group) {
    try {
        const method = (request.method ?? "GET").toUpperCase();
        const url = new URL(request.url ?? group.path, "http://openclaw.local");
        const pathname = url.pathname;
        const matchingOperations = group.operations
            .map((operation) => {
            const match = pathname.match(operation.pattern);
            return match ? { operation, match } : null;
        })
            .filter((entry) => entry !== null);
        if (matchingOperations.length === 0) {
            routeNotFound(response, pathname);
            return;
        }
        const matchedOperation = matchingOperations.find((entry) => entry.operation.method === method);
        if (!matchedOperation) {
            methodNotAllowed(response, [...new Set(matchingOperations.map((entry) => entry.operation.method))]);
            return;
        }
        await forwardOperation(request, response, config, matchedOperation.operation, matchedOperation.match, url);
    }
    catch (error) {
        writePluginError(response, error);
    }
}
const exact = (path, operation) => ({
    path,
    match: "exact",
    operations: [{ ...operation, pattern: new RegExp(`^${path.replaceAll("/", "\\/")}$`) }]
});
export const FORGE_PLUGIN_ROUTE_GROUPS = [
    exact("/forge/v1/health", {
        method: "GET",
        upstreamPath: "/api/v1/health",
        target: (_match, url) => passthroughSearch("/api/v1/health", url)
    }),
    exact("/forge/v1/operator/overview", {
        method: "GET",
        upstreamPath: "/api/v1/operator/overview",
        target: (_match, url) => passthroughSearch("/api/v1/operator/overview", url)
    }),
    exact("/forge/v1/operator/context", {
        method: "GET",
        upstreamPath: "/api/v1/operator/context",
        target: (_match, url) => passthroughSearch("/api/v1/operator/context", url)
    }),
    exact("/forge/v1/agents/onboarding", {
        method: "GET",
        upstreamPath: "/api/v1/agents/onboarding",
        target: (_match, url) => passthroughSearch("/api/v1/agents/onboarding", url)
    }),
    exact("/forge/v1/psyche/overview", {
        method: "GET",
        upstreamPath: "/api/v1/psyche/overview",
        target: (_match, url) => passthroughSearch("/api/v1/psyche/overview", url)
    }),
    exact("/forge/v1/metrics/xp", {
        method: "GET",
        upstreamPath: "/api/v1/metrics/xp",
        target: (_match, url) => passthroughSearch("/api/v1/metrics/xp", url)
    }),
    exact("/forge/v1/reviews/weekly", {
        method: "GET",
        upstreamPath: "/api/v1/reviews/weekly",
        target: (_match, url) => passthroughSearch("/api/v1/reviews/weekly", url)
    }),
    exact("/forge/v1/operator/log-work", {
        method: "POST",
        upstreamPath: "/api/v1/operator/log-work",
        requestBody: "json",
        requiresToken: true,
        target: (_match, url) => passthroughSearch("/api/v1/operator/log-work", url)
    }),
    exact("/forge/v1/insights", {
        method: "POST",
        upstreamPath: "/api/v1/insights",
        requestBody: "json",
        requiresToken: true,
        target: (_match, url) => passthroughSearch("/api/v1/insights", url)
    }),
    {
        path: "/forge/v1/entities",
        match: "prefix",
        operations: [
            {
                method: "POST",
                pattern: /^\/forge\/v1\/entities\/search$/,
                upstreamPath: "/api/v1/entities/search",
                requestBody: "json",
                requiresToken: true,
                target: (_match, url) => passthroughSearch("/api/v1/entities/search", url)
            },
            {
                method: "POST",
                pattern: /^\/forge\/v1\/entities\/create$/,
                upstreamPath: "/api/v1/entities/create",
                requestBody: "json",
                requiresToken: true,
                target: (_match, url) => passthroughSearch("/api/v1/entities/create", url)
            },
            {
                method: "POST",
                pattern: /^\/forge\/v1\/entities\/update$/,
                upstreamPath: "/api/v1/entities/update",
                requestBody: "json",
                requiresToken: true,
                target: (_match, url) => passthroughSearch("/api/v1/entities/update", url)
            },
            {
                method: "POST",
                pattern: /^\/forge\/v1\/entities\/delete$/,
                upstreamPath: "/api/v1/entities/delete",
                requestBody: "json",
                requiresToken: true,
                target: (_match, url) => passthroughSearch("/api/v1/entities/delete", url)
            },
            {
                method: "POST",
                pattern: /^\/forge\/v1\/entities\/restore$/,
                upstreamPath: "/api/v1/entities/restore",
                requestBody: "json",
                requiresToken: true,
                target: (_match, url) => passthroughSearch("/api/v1/entities/restore", url)
            }
        ]
    },
    {
        path: "/forge/v1/tasks",
        match: "prefix",
        operations: [
            {
                method: "POST",
                pattern: /^\/forge\/v1\/tasks\/([^/]+)\/runs$/,
                upstreamPath: "/api/v1/tasks/:id/runs",
                requestBody: "json",
                requiresToken: true,
                target: (match, url) => passthroughSearch(`/api/v1/tasks/${match[1]}/runs`, url)
            }
        ]
    },
    {
        path: "/forge/v1/task-runs",
        match: "prefix",
        operations: [
            {
                method: "GET",
                pattern: /^\/forge\/v1\/task-runs$/,
                upstreamPath: "/api/v1/task-runs",
                target: (_match, url) => passthroughSearch("/api/v1/task-runs", url)
            },
            {
                method: "POST",
                pattern: /^\/forge\/v1\/task-runs\/([^/]+)\/heartbeat$/,
                upstreamPath: "/api/v1/task-runs/:id/heartbeat",
                requestBody: "json",
                requiresToken: true,
                target: (match, url) => passthroughSearch(`/api/v1/task-runs/${match[1]}/heartbeat`, url)
            },
            {
                method: "POST",
                pattern: /^\/forge\/v1\/task-runs\/([^/]+)\/focus$/,
                upstreamPath: "/api/v1/task-runs/:id/focus",
                requestBody: "json",
                requiresToken: true,
                target: (match, url) => passthroughSearch(`/api/v1/task-runs/${match[1]}/focus`, url)
            },
            {
                method: "POST",
                pattern: /^\/forge\/v1\/task-runs\/([^/]+)\/complete$/,
                upstreamPath: "/api/v1/task-runs/:id/complete",
                requestBody: "json",
                requiresToken: true,
                target: (match, url) => passthroughSearch(`/api/v1/task-runs/${match[1]}/complete`, url)
            },
            {
                method: "POST",
                pattern: /^\/forge\/v1\/task-runs\/([^/]+)\/release$/,
                upstreamPath: "/api/v1/task-runs/:id/release",
                requestBody: "json",
                requiresToken: true,
                target: (match, url) => passthroughSearch(`/api/v1/task-runs/${match[1]}/release`, url)
            }
        ]
    },
    exact("/forge/v1/ui", {
        kind: "ui_redirect",
        method: "GET"
    })
];
export function collectMirroredApiRouteKeys() {
    return new Set(FORGE_PLUGIN_ROUTE_GROUPS.flatMap((group) => group.operations.flatMap((operation) => ("upstreamPath" in operation ? [makeApiRouteKey(operation.method, operation.upstreamPath)] : []))));
}
export function buildRouteParityReport(pathMap) {
    const mirrored = collectMirroredApiRouteKeys();
    const supported = collectSupportedPluginApiRouteKeys();
    const openApiRoutes = new Set(Object.entries(pathMap)
        .flatMap(([path, methods]) => Object.keys(methods).map((method) => makeApiRouteKey(method, path)))
        .filter((key) => key.startsWith("GET /api/v1") || key.startsWith("POST /api/v1") || key.startsWith("PATCH /api/v1") || key.startsWith("DELETE /api/v1")));
    const missingFromPlugin = [...supported].filter((key) => !mirrored.has(key)).sort();
    const missingFromOpenApi = [...supported].filter((key) => !openApiRoutes.has(key)).sort();
    const unexpectedMirrors = [...mirrored].filter((key) => !supported.has(key)).sort();
    return {
        supported: [...supported].sort(),
        mirrored: [...mirrored].sort(),
        missingFromPlugin,
        missingFromOpenApi,
        unexpectedMirrors
    };
}
export function registerForgePluginRoutes(api, config) {
    for (const group of FORGE_PLUGIN_ROUTE_GROUPS) {
        api.registerHttpRoute({
            path: group.path,
            auth: "plugin",
            match: group.match,
            handler: (request, response) => handleGroup(request, response, config, group)
        });
    }
}
function createCliAction(config, path) {
    return async () => {
        const result = await callConfiguredForgeApi(config, {
            method: "GET",
            path
        });
        const data = expectForgeSuccess(result);
        console.log(JSON.stringify(data, null, 2));
    };
}
async function runReadOnly(config, path) {
    return expectForgeSuccess(await callConfiguredForgeApi(config, {
        method: "GET",
        path
    }));
}
async function runRouteCheck(config) {
    const openapi = await runReadOnly(config, "/api/v1/openapi.json");
    const pathMap = typeof openapi === "object" && openapi !== null && "paths" in openapi && typeof openapi.paths === "object" && openapi.paths !== null
        ? openapi.paths
        : {};
    return buildRouteParityReport(pathMap);
}
async function runDoctor(config) {
    const [health, overview, onboarding, routeParity, uiUrl] = await Promise.all([
        runReadOnly(config, "/api/v1/health"),
        runReadOnly(config, "/api/v1/operator/overview"),
        runReadOnly(config, "/api/v1/agents/onboarding"),
        runRouteCheck(config),
        resolveForgeUiUrl(config)
    ]);
    const overviewBody = typeof overview === "object" && overview !== null && "overview" in overview && typeof overview.overview === "object" && overview.overview !== null
        ? overview.overview
        : null;
    const capabilities = overviewBody && typeof overviewBody.capabilities === "object" && overviewBody.capabilities !== null
        ? overviewBody.capabilities
        : null;
    const overviewWarnings = Array.isArray(overviewBody?.warnings) ? overviewBody.warnings.filter((entry) => typeof entry === "string") : [];
    const warnings = [];
    const canBootstrap = canBootstrapOperatorSession(config.baseUrl);
    if (config.apiToken.trim().length === 0 && canBootstrap) {
        warnings.push("Forge apiToken is blank, but this target can bootstrap a local or Tailscale operator session for protected reads and writes.");
    }
    else if (config.apiToken.trim().length === 0) {
        warnings.push("Forge apiToken is missing, and this target cannot use local or Tailscale operator-session bootstrap. Protected writes will fail.");
    }
    if (overviewWarnings.length > 0) {
        warnings.push(...overviewWarnings);
    }
    if (capabilities && capabilities.canReadPsyche === false) {
        warnings.push("The configured token cannot read Psyche state. Sensitive reflection summaries will stay partial.");
    }
    if (routeParity.missingFromPlugin.length > 0) {
        warnings.push(`Plugin route coverage is missing ${routeParity.missingFromPlugin.length} curated route${routeParity.missingFromPlugin.length === 1 ? "" : "s"}. Run forge route-check.`);
    }
    if (routeParity.missingFromOpenApi.length > 0) {
        warnings.push(`Forge OpenAPI is missing ${routeParity.missingFromOpenApi.length} curated route${routeParity.missingFromOpenApi.length === 1 ? "" : "s"} expected by the plugin.`);
    }
    if (routeParity.unexpectedMirrors.length > 0) {
        warnings.push(`Plugin still mirrors ${routeParity.unexpectedMirrors.length} unexpected route${routeParity.unexpectedMirrors.length === 1 ? "" : "s"} outside the curated contract.`);
    }
    return {
        ok: (config.apiToken.trim().length > 0 || canBootstrap) &&
            routeParity.missingFromPlugin.length === 0 &&
            routeParity.missingFromOpenApi.length === 0 &&
            routeParity.unexpectedMirrors.length === 0,
        origin: config.origin,
        port: config.port,
        baseUrl: config.baseUrl,
        webAppUrl: uiUrl,
        actorLabel: config.actorLabel,
        apiTokenConfigured: config.apiToken.trim().length > 0,
        operatorSessionBootstrapAvailable: canBootstrap,
        warnings,
        health,
        overview,
        onboarding,
        routeParity
    };
}
export function registerForgePluginCli(api, config) {
    api.registerCli?.(({ program }) => {
        const command = program.command("forge").description("Inspect and operate Forge through the OpenClaw plugin");
        command.command("health").description("Check Forge health").action(createCliAction(config, "/api/v1/health"));
        command.command("overview").description("Fetch the one-shot Forge operator overview").action(createCliAction(config, "/api/v1/operator/overview"));
        command.command("onboarding").description("Print the Forge agent onboarding contract").action(createCliAction(config, "/api/v1/agents/onboarding"));
        command.command("ui").description("Print the Forge UI entrypoint").action(async () => {
            console.log(JSON.stringify({ webAppUrl: await resolveForgeUiUrl(config), pluginUiRoute: "/forge/v1/ui" }, null, 2));
        });
        command.command("stop").description("Stop the local Forge runtime when it was auto-started by the OpenClaw plugin").action(async () => {
            console.log(JSON.stringify(await stopForgeRuntime(config), null, 2));
        });
        command.command("doctor").description("Run plugin connectivity and curated route diagnostics").action(async () => {
            console.log(JSON.stringify(await runDoctor(config), null, 2));
        });
        command.command("route-check").description("Compare curated plugin route coverage against the live Forge OpenAPI paths").action(async () => {
            console.log(JSON.stringify(await runRouteCheck(config), null, 2));
        });
    }, { commands: ["forge"] });
}
