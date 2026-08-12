import type { IncomingMessage, ServerResponse } from "node:http";
import {
  canBootstrapOperatorSession,
  callConfiguredForgeApi,
  expectForgeSuccess,
  readJsonRequestBody,
  readSingleHeaderValue,
  requireApiToken,
  writeForgeProxyResponse,
  writePluginError,
  writeRedirectResponse,
  type ForgeHttpMethod,
  type ForgePluginConfig
} from "./api-client.js";
import {
  getForgeRuntimeStatus,
  restartForgeRuntime,
  startForgeRuntime,
  stopForgeRuntime
} from "./local-runtime.js";
import {
  collectPublishedOnboardingApiRouteKeys,
  collectRequiredMirroredOnboardingApiRouteKeys,
  collectSupportedPluginApiRouteKeys,
  makeApiRouteKey,
  type ApiRouteKey
} from "./parity.js";
import type {
  ForgePluginCliApi,
  ForgePluginRouteApi,
  ForgeRegisteredHttpRoute
} from "./plugin-sdk-types.js";

type PluginRouteMatch = NonNullable<ForgeRegisteredHttpRoute["match"]>;

type ProxyRouteOperation = {
  kind?: "proxy";
  method: ForgeHttpMethod;
  pattern: RegExp;
  upstreamPath: string;
  target: (match: RegExpMatchArray, url: URL) => string;
  requiresToken?: boolean;
  requestBody?: "json";
};

type UiRedirectRouteOperation = {
  kind: "ui_redirect";
  method: "GET";
  pattern: RegExp;
};

type RouteOperation = ProxyRouteOperation | UiRedirectRouteOperation;
type ExactRouteOperation =
  | Omit<ProxyRouteOperation, "pattern">
  | Omit<UiRedirectRouteOperation, "pattern">;

type RouteGroup = {
  path: string;
  match: PluginRouteMatch;
  operations: RouteOperation[];
};

function passthroughSearch(path: string, url: URL) {
  return `${path}${url.search}`;
}

function methodNotAllowed(
  response: ServerResponse,
  allowedMethods: ForgeHttpMethod[]
) {
  response.setHeader("allow", allowedMethods.join(", "));
  response.statusCode = 405;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(
    JSON.stringify({
      ok: false,
      error: {
        code: "forge_plugin_method_not_allowed",
        message: `Allowed methods: ${allowedMethods.join(", ")}`
      }
    })
  );
}

function routeNotFound(response: ServerResponse, pathname: string) {
  response.statusCode = 404;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(
    JSON.stringify({
      ok: false,
      error: {
        code: "forge_plugin_route_not_found",
        message: `No Forge plugin route matches ${pathname}`
      }
    })
  );
}

async function resolveForgeUiUrl(config: ForgePluginConfig) {
  try {
    const onboarding = await runReadOnly(config, "/api/v1/agents/onboarding");
    if (
      typeof onboarding === "object" &&
      onboarding !== null &&
      "onboarding" in onboarding &&
      typeof onboarding.onboarding === "object" &&
      onboarding.onboarding !== null &&
      "webAppUrl" in onboarding.onboarding &&
      typeof onboarding.onboarding.webAppUrl === "string" &&
      onboarding.onboarding.webAppUrl.trim().length > 0
    ) {
      return onboarding.onboarding.webAppUrl;
    }
  } catch {
    // Use the configured fallback when onboarding is unavailable.
  }
  return config.webAppUrl;
}

async function forwardOperation(
  request: IncomingMessage,
  response: ServerResponse,
  config: ForgePluginConfig,
  operation: RouteOperation,
  match: RegExpMatchArray,
  url: URL
) {
  if (operation.kind === "ui_redirect") {
    writeRedirectResponse(response, await resolveForgeUiUrl(config));
    return;
  }

  if (operation.requiresToken) {
    requireApiToken(config);
  }

  const body =
    operation.requestBody === "json"
      ? await readJsonRequestBody(request, { emptyObject: true })
      : undefined;
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

async function handleGroup(
  request: IncomingMessage,
  response: ServerResponse,
  config: ForgePluginConfig,
  group: RouteGroup
) {
  try {
    const method = (request.method ?? "GET").toUpperCase() as ForgeHttpMethod;
    const url = new URL(request.url ?? group.path, "http://openclaw.local");
    const pathname = url.pathname;

    const matchingOperations = group.operations
      .map((operation) => {
        const match = pathname.match(operation.pattern);
        return match ? { operation, match } : null;
      })
      .filter(
        (
          entry
        ): entry is { operation: RouteOperation; match: RegExpMatchArray } =>
          entry !== null
      );

    if (matchingOperations.length === 0) {
      routeNotFound(response, pathname);
      return;
    }

    const matchedOperation = matchingOperations.find(
      (entry) => entry.operation.method === method
    );
    if (!matchedOperation) {
      methodNotAllowed(response, [
        ...new Set(matchingOperations.map((entry) => entry.operation.method))
      ]);
      return;
    }

    await forwardOperation(
      request,
      response,
      config,
      matchedOperation.operation,
      matchedOperation.match,
      url
    );
  } catch (error) {
    writePluginError(response, error);
  }
}

const exact = (path: string, operation: ExactRouteOperation): RouteGroup => ({
  path,
  match: "exact",
  operations: [
    { ...operation, pattern: new RegExp(`^${path.replaceAll("/", "\\/")}$`) }
  ]
});

export const FORGE_PLUGIN_ROUTE_GROUPS: RouteGroup[] = [
  exact("/forge/v1/health", {
    method: "GET",
    upstreamPath: "/api/v1/health",
    target: (_match: RegExpMatchArray, url: URL) =>
      passthroughSearch("/api/v1/health", url)
  }),
  exact("/forge/v1/operator/overview", {
    method: "GET",
    upstreamPath: "/api/v1/operator/overview",
    target: (_match: RegExpMatchArray, url: URL) =>
      passthroughSearch("/api/v1/operator/overview", url)
  }),
  exact("/forge/v1/operator/context", {
    method: "GET",
    upstreamPath: "/api/v1/operator/context",
    target: (_match: RegExpMatchArray, url: URL) =>
      passthroughSearch("/api/v1/operator/context", url)
  }),
  exact("/forge/v1/today/priority", {
    method: "GET",
    upstreamPath: "/api/v1/today/priority",
    target: (_match: RegExpMatchArray, url: URL) =>
      passthroughSearch("/api/v1/today/priority", url)
  }),
  exact("/forge/v1/agents/onboarding", {
    method: "GET",
    upstreamPath: "/api/v1/agents/onboarding",
    target: (_match: RegExpMatchArray, url: URL) =>
      passthroughSearch("/api/v1/agents/onboarding", url)
  }),
  exact("/forge/v1/doctor", {
    method: "GET",
    upstreamPath: "/api/v1/doctor",
    target: (_match: RegExpMatchArray, url: URL) =>
      passthroughSearch("/api/v1/doctor", url)
  }),
  exact("/forge/v1/doctor/fixes", {
    method: "POST",
    upstreamPath: "/api/v1/doctor/fixes",
    requestBody: "json",
    requiresToken: true,
    target: (_match: RegExpMatchArray, url: URL) =>
      passthroughSearch("/api/v1/doctor/fixes", url)
  }),
  exact("/forge/v1/users/directory", {
    method: "GET",
    upstreamPath: "/api/v1/users/directory",
    target: (_match: RegExpMatchArray, url: URL) =>
      passthroughSearch("/api/v1/users/directory", url)
  }),
  exact("/forge/v1/psyche/overview", {
    method: "GET",
    upstreamPath: "/api/v1/psyche/overview",
    target: (_match: RegExpMatchArray, url: URL) =>
      passthroughSearch("/api/v1/psyche/overview", url)
  }),
  exact("/forge/v1/psyche/schema-catalog", {
    method: "GET",
    upstreamPath: "/api/v1/psyche/schema-catalog",
    target: (_match: RegExpMatchArray, url: URL) =>
      passthroughSearch("/api/v1/psyche/schema-catalog", url)
  }),
  exact("/forge/v1/metrics/xp", {
    method: "GET",
    upstreamPath: "/api/v1/metrics/xp",
    target: (_match: RegExpMatchArray, url: URL) =>
      passthroughSearch("/api/v1/metrics/xp", url)
  }),
  exact("/forge/v1/reviews/weekly", {
    method: "GET",
    upstreamPath: "/api/v1/reviews/weekly",
    target: (_match: RegExpMatchArray, url: URL) =>
      passthroughSearch("/api/v1/reviews/weekly", url)
  }),
  exact("/forge/v1/wiki/settings", {
    method: "GET",
    upstreamPath: "/api/v1/wiki/settings",
    target: (_match: RegExpMatchArray, url: URL) =>
      passthroughSearch("/api/v1/wiki/settings", url)
  }),
  exact("/forge/v1/wiki/health", {
    method: "GET",
    upstreamPath: "/api/v1/wiki/health",
    target: (_match: RegExpMatchArray, url: URL) =>
      passthroughSearch("/api/v1/wiki/health", url)
  }),
  exact("/forge/v1/health/sleep", {
    method: "GET",
    upstreamPath: "/api/v1/health/sleep",
    target: (_match: RegExpMatchArray, url: URL) =>
      passthroughSearch("/api/v1/health/sleep", url)
  }),
  exact("/forge/v1/health/fitness", {
    method: "GET",
    upstreamPath: "/api/v1/health/fitness",
    target: (_match: RegExpMatchArray, url: URL) =>
      passthroughSearch("/api/v1/health/fitness", url)
  }),
  exact("/forge/v1/health/training-load", {
    method: "GET",
    upstreamPath: "/api/v1/health/training-load",
    target: (_match: RegExpMatchArray, url: URL) =>
      passthroughSearch("/api/v1/health/training-load", url)
  }),
  {
    path: "/forge/v1/movement",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/movement\/day$/,
        upstreamPath: "/api/v1/movement/day",
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/movement/day", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/movement\/month$/,
        upstreamPath: "/api/v1/movement/month",
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/movement/month", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/movement\/all-time$/,
        upstreamPath: "/api/v1/movement/all-time",
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/movement/all-time", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/movement\/timeline$/,
        upstreamPath: "/api/v1/movement/timeline",
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/movement/timeline", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/movement\/places$/,
        upstreamPath: "/api/v1/movement/places",
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/movement/places", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/movement\/boxes\/([^/]+)$/,
        upstreamPath: "/api/v1/movement/boxes/:id",
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/movement/boxes/${match[1]}`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/movement\/places$/,
        upstreamPath: "/api/v1/movement/places",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/movement/places", url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/movement\/places\/([^/]+)$/,
        upstreamPath: "/api/v1/movement/places/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/movement/places/${match[1]}`, url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/movement\/trips\/([^/]+)$/,
        upstreamPath: "/api/v1/movement/trips/:id",
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/movement/trips/${match[1]}`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/movement\/selection$/,
        upstreamPath: "/api/v1/movement/selection",
        requestBody: "json",
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/movement/selection", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/movement\/settings$/,
        upstreamPath: "/api/v1/movement/settings",
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/movement/settings", url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/movement\/settings$/,
        upstreamPath: "/api/v1/movement/settings",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/movement/settings", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/movement\/user-boxes$/,
        upstreamPath: "/api/v1/movement/user-boxes",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/movement/user-boxes", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/movement\/user-boxes\/preflight$/,
        upstreamPath: "/api/v1/movement/user-boxes/preflight",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/movement/user-boxes/preflight", url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/movement\/user-boxes\/([^/]+)$/,
        upstreamPath: "/api/v1/movement/user-boxes/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/movement/user-boxes/${match[1]}`, url)
      },
      {
        method: "DELETE",
        pattern: /^\/forge\/v1\/movement\/user-boxes\/([^/]+)$/,
        upstreamPath: "/api/v1/movement/user-boxes/:id",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/movement/user-boxes/${match[1]}`, url)
      },
      {
        method: "POST",
        pattern:
          /^\/forge\/v1\/movement\/automatic-boxes\/([^/]+)\/invalidate$/,
        upstreamPath: "/api/v1/movement/automatic-boxes/:id/invalidate",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(
            `/api/v1/movement/automatic-boxes/${match[1]}/invalidate`,
            url
          )
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/movement\/stays\/([^/]+)$/,
        upstreamPath: "/api/v1/movement/stays/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/movement/stays/${match[1]}`, url)
      },
      {
        method: "DELETE",
        pattern: /^\/forge\/v1\/movement\/stays\/([^/]+)$/,
        upstreamPath: "/api/v1/movement/stays/:id",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/movement/stays/${match[1]}`, url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/movement\/trips\/([^/]+)$/,
        upstreamPath: "/api/v1/movement/trips/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/movement/trips/${match[1]}`, url)
      },
      {
        method: "DELETE",
        pattern: /^\/forge\/v1\/movement\/trips\/([^/]+)$/,
        upstreamPath: "/api/v1/movement/trips/:id",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/movement/trips/${match[1]}`, url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/movement\/trips\/([^/]+)\/points\/([^/]+)$/,
        upstreamPath: "/api/v1/movement/trips/:id/points/:pointId",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(
            `/api/v1/movement/trips/${match[1]}/points/${match[2]}`,
            url
          )
      },
      {
        method: "DELETE",
        pattern: /^\/forge\/v1\/movement\/trips\/([^/]+)\/points\/([^/]+)$/,
        upstreamPath: "/api/v1/movement/trips/:id/points/:pointId",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(
            `/api/v1/movement/trips/${match[1]}/points/${match[2]}`,
            url
          )
      }
    ]
  },
  {
    path: "/forge/v1/life-force",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/life-force$/,
        upstreamPath: "/api/v1/life-force",
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/life-force", url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/life-force\/profile$/,
        upstreamPath: "/api/v1/life-force/profile",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/life-force/profile", url)
      },
      {
        method: "PUT",
        pattern: /^\/forge\/v1\/life-force\/templates\/([^/]+)$/,
        upstreamPath: "/api/v1/life-force/templates/:weekday",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/life-force/templates/${match[1]}`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/life-force\/fatigue-signals$/,
        upstreamPath: "/api/v1/life-force/fatigue-signals",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/life-force/fatigue-signals", url)
      }
    ]
  },
  {
    path: "/forge/v1/workbench",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/workbench\/catalog\/boxes$/,
        upstreamPath: "/api/v1/workbench/catalog/boxes",
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/workbench/catalog/boxes", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/workbench\/flows$/,
        upstreamPath: "/api/v1/workbench/flows",
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/workbench/flows", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/workbench\/flows$/,
        upstreamPath: "/api/v1/workbench/flows",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/workbench/flows", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/workbench\/flows\/by-slug\/([^/]+)$/,
        upstreamPath: "/api/v1/workbench/flows/by-slug/:slug",
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/workbench/flows/by-slug/${match[1]}`, url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/workbench\/flows\/([^/]+)\/versions$/,
        upstreamPath: "/api/v1/workbench/flows/:id/versions",
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/workbench/flows/${match[1]}/versions`, url)
      },
      {
        method: "GET",
        pattern:
          /^\/forge\/v1\/workbench\/flows\/([^/]+)\/versions\/([1-9][0-9]*)$/,
        upstreamPath: "/api/v1/workbench/flows/:id/versions/:revision",
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(
            `/api/v1/workbench/flows/${match[1]}/versions/${match[2]}`,
            url
          )
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/workbench\/flows\/([^/]+)\/restore$/,
        upstreamPath: "/api/v1/workbench/flows/:id/restore",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/workbench/flows/${match[1]}/restore`, url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/workbench\/flows\/([^/]+)$/,
        upstreamPath: "/api/v1/workbench/flows/:id",
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/workbench/flows/${match[1]}`, url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/workbench\/flows\/([^/]+)$/,
        upstreamPath: "/api/v1/workbench/flows/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/workbench/flows/${match[1]}`, url)
      },
      {
        method: "DELETE",
        pattern: /^\/forge\/v1\/workbench\/flows\/([^/]+)$/,
        upstreamPath: "/api/v1/workbench/flows/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/workbench/flows/${match[1]}`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/workbench\/flows\/([^/]+)\/run$/,
        upstreamPath: "/api/v1/workbench/flows/:id/run",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/workbench/flows/${match[1]}/run`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/workbench\/run$/,
        upstreamPath: "/api/v1/workbench/run",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/workbench/run", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/workbench\/flows\/([^/]+)\/chat$/,
        upstreamPath: "/api/v1/workbench/flows/:id/chat",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/workbench/flows/${match[1]}/chat`, url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/workbench\/flows\/([^/]+)\/output$/,
        upstreamPath: "/api/v1/workbench/flows/:id/output",
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/workbench/flows/${match[1]}/output`, url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/workbench\/flows\/([^/]+)\/runs$/,
        upstreamPath: "/api/v1/workbench/flows/:id/runs",
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/workbench/flows/${match[1]}/runs`, url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/workbench\/flows\/([^/]+)\/runs\/([^/]+)$/,
        upstreamPath: "/api/v1/workbench/flows/:id/runs/:runId",
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(
            `/api/v1/workbench/flows/${match[1]}/runs/${match[2]}`,
            url
          )
      },
      {
        method: "POST",
        pattern:
          /^\/forge\/v1\/workbench\/flows\/([^/]+)\/runs\/([^/]+)\/cancel$/,
        upstreamPath: "/api/v1/workbench/flows/:id/runs/:runId/cancel",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(
            `/api/v1/workbench/flows/${match[1]}/runs/${match[2]}/cancel`,
            url
          )
      },
      {
        method: "GET",
        pattern:
          /^\/forge\/v1\/workbench\/flows\/([^/]+)\/runs\/([^/]+)\/nodes$/,
        upstreamPath: "/api/v1/workbench/flows/:id/runs/:runId/nodes",
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(
            `/api/v1/workbench/flows/${match[1]}/runs/${match[2]}/nodes`,
            url
          )
      },
      {
        method: "GET",
        pattern:
          /^\/forge\/v1\/workbench\/flows\/([^/]+)\/runs\/([^/]+)\/nodes\/([^/]+)$/,
        upstreamPath: "/api/v1/workbench/flows/:id/runs/:runId/nodes/:nodeId",
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(
            `/api/v1/workbench/flows/${match[1]}/runs/${match[2]}/nodes/${match[3]}`,
            url
          )
      },
      {
        method: "GET",
        pattern:
          /^\/forge\/v1\/workbench\/flows\/([^/]+)\/nodes\/([^/]+)\/output$/,
        upstreamPath: "/api/v1/workbench/flows/:id/nodes/:nodeId/output",
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(
            `/api/v1/workbench/flows/${match[1]}/nodes/${match[2]}/output`,
            url
          )
      }
    ]
  },
  {
    path: "/forge/v1/courses",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/courses$/,
        upstreamPath: "/api/v1/courses",
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/courses", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/courses\/import$/,
        upstreamPath: "/api/v1/courses/import",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/courses/import", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/courses\/([^/]+)\/export$/,
        upstreamPath: "/api/v1/courses/:courseId/export",
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/courses/${match[1]}/export`, url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/courses\/([^/]+)\/learn$/,
        upstreamPath: "/api/v1/courses/:courseId/learn",
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/courses/${match[1]}/learn`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/courses\/([^/]+)\/voice-session$/,
        upstreamPath: "/api/v1/courses/:courseId/voice-session",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/courses/${match[1]}/voice-session`, url)
      },
      {
        method: "POST",
        pattern:
          /^\/forge\/v1\/courses\/([^/]+)\/lessons\/([^/]+)\/activities\/([^/]+)\/attempts$/,
        upstreamPath:
          "/api/v1/courses/:courseId/lessons/:lessonId/activities/:activityId/attempts",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(
            `/api/v1/courses/${match[1]}/lessons/${match[2]}/activities/${match[3]}/attempts`,
            url
          )
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/courses\/([^/]+)\/upgrade$/,
        upstreamPath: "/api/v1/courses/:courseId/upgrade",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/courses/${match[1]}/upgrade`, url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/courses\/([^/]+)$/,
        upstreamPath: "/api/v1/courses/:courseId",
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/courses/${match[1]}`, url)
      }
    ]
  },
  {
    path: "/forge/v1/concepts",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/concepts$/,
        upstreamPath: "/api/v1/concepts",
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/concepts", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/concepts\/([^/]+)$/,
        upstreamPath: "/api/v1/concepts/:conceptId",
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/concepts/${match[1]}`, url)
      }
    ]
  },
  {
    path: "/forge/v1/attention",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/attention$/,
        upstreamPath: "/api/v1/attention-inbox",
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/attention-inbox", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/attention\/([^/]+)\/snooze$/,
        upstreamPath: "/api/v1/attention-inbox/:id/snooze",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/attention-inbox/${match[1]}/snooze`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/attention\/([^/]+)\/dismiss$/,
        upstreamPath: "/api/v1/attention-inbox/:id/dismiss",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/attention-inbox/${match[1]}/dismiss`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/attention\/([^/]+)\/restore$/,
        upstreamPath: "/api/v1/attention-inbox/:id/restore",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/attention-inbox/${match[1]}/restore`, url)
      }
    ]
  },
  {
    path: "/forge/v1/entity-navigation",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/entity-navigation$/,
        upstreamPath: "/api/v1/entity-navigation",
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/entity-navigation", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/entity-navigation\/touch$/,
        upstreamPath: "/api/v1/entity-navigation/touch",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/entity-navigation/touch", url)
      }
    ]
  },
  {
    path: "/forge/v1/artifacts",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/artifacts$/,
        upstreamPath: "/api/v1/artifacts",
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/artifacts", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/artifacts$/,
        upstreamPath: "/api/v1/artifacts",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/artifacts", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/artifacts\/([^/]+)$/,
        upstreamPath: "/api/v1/artifacts/:id",
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/artifacts/${match[1]}`, url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/artifacts\/([^/]+)$/,
        upstreamPath: "/api/v1/artifacts/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/artifacts/${match[1]}`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/artifacts\/([^/]+)\/scan$/,
        upstreamPath: "/api/v1/artifacts/:id/scan",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/artifacts/${match[1]}/scan`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/artifacts\/([^/]+)\/enrich$/,
        upstreamPath: "/api/v1/artifacts/:id/enrich",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/artifacts/${match[1]}/enrich`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/artifacts\/([^/]+)\/links$/,
        upstreamPath: "/api/v1/artifacts/:id/links",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/artifacts/${match[1]}/links`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/artifacts\/([^/]+)\/trust$/,
        upstreamPath: "/api/v1/artifacts/:id/trust",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/artifacts/${match[1]}/trust`, url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/artifacts\/([^/]+)\/versions$/,
        upstreamPath: "/api/v1/artifacts/:id/versions",
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/artifacts/${match[1]}/versions`, url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/artifacts\/([^/]+)\/audit$/,
        upstreamPath: "/api/v1/artifacts/:id/audit",
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/artifacts/${match[1]}/audit`, url)
      }
    ]
  },
  {
    path: "/forge/v1/life-events",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/life-events\/timeline$/,
        upstreamPath: "/api/v1/life-events/timeline",
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/life-events/timeline", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/life-events\/from-calendar-event$/,
        upstreamPath: "/api/v1/life-events/from-calendar-event",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/life-events/from-calendar-event", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/life-events\/import-ticket$/,
        upstreamPath: "/api/v1/life-events/import-ticket",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/life-events/import-ticket", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/life-events\/([^/]+)$/,
        upstreamPath: "/api/v1/life-events/:id",
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/life-events/${match[1]}`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/life-events\/([^/]+)\/calendar-sync$/,
        upstreamPath: "/api/v1/life-events/:id/calendar-sync",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(
            `/api/v1/life-events/${match[1]}/calendar-sync`,
            url
          )
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/life-events\/([^/]+)\/travel-status$/,
        upstreamPath: "/api/v1/life-events/:id/travel-status",
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(
            `/api/v1/life-events/${match[1]}/travel-status`,
            url
          )
      }
    ]
  },
  {
    path: "/forge/v1/calendar",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/calendar\/overview$/,
        upstreamPath: "/api/v1/calendar/overview",
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/calendar/overview", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/calendar\/macos-local\/discovery$/,
        upstreamPath: "/api/v1/calendar/macos-local/discovery",
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/calendar/macos-local/discovery", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/calendar\/discovery$/,
        upstreamPath: "/api/v1/calendar/discovery",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/calendar/discovery", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/calendar\/connections$/,
        upstreamPath: "/api/v1/calendar/connections",
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/calendar/connections", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/calendar\/connections$/,
        upstreamPath: "/api/v1/calendar/connections",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/calendar/connections", url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/calendar\/connections\/([^/]+)$/,
        upstreamPath: "/api/v1/calendar/connections/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/calendar/connections/${match[1]}`, url)
      },
      {
        method: "DELETE",
        pattern: /^\/forge\/v1\/calendar\/connections\/([^/]+)$/,
        upstreamPath: "/api/v1/calendar/connections/:id",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/calendar/connections/${match[1]}`, url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/calendar\/connections\/([^/]+)\/discovery$/,
        upstreamPath: "/api/v1/calendar/connections/:id/discovery",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(
            `/api/v1/calendar/connections/${match[1]}/discovery`,
            url
          )
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/calendar\/connections\/([^/]+)\/sync$/,
        upstreamPath: "/api/v1/calendar/connections/:id/sync",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(
            `/api/v1/calendar/connections/${match[1]}/sync`,
            url
          )
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/calendar\/work-block-templates$/,
        upstreamPath: "/api/v1/calendar/work-block-templates",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/calendar/work-block-templates", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/calendar\/timeboxes\/recommend$/,
        upstreamPath: "/api/v1/calendar/timeboxes/recommend",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/calendar/timeboxes/recommend", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/calendar\/timeboxes$/,
        upstreamPath: "/api/v1/calendar/timeboxes",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/calendar/timeboxes", url)
      }
    ]
  },
  exact("/forge/v1/preferences/workspace", {
    method: "GET",
    upstreamPath: "/api/v1/preferences/workspace",
    target: (_match: RegExpMatchArray, url: URL) =>
      passthroughSearch("/api/v1/preferences/workspace", url)
  }),
  exact("/forge/v1/psyche/self-observation/calendar", {
    method: "GET",
    upstreamPath: "/api/v1/psyche/self-observation/calendar",
    target: (_match: RegExpMatchArray, url: URL) =>
      passthroughSearch("/api/v1/psyche/self-observation/calendar", url)
  }),
  exact("/forge/v1/operator/log-work", {
    method: "POST",
    upstreamPath: "/api/v1/operator/log-work",
    requestBody: "json",
    requiresToken: true,
    target: (_match: RegExpMatchArray, url: URL) =>
      passthroughSearch("/api/v1/operator/log-work", url)
  }),
  exact("/forge/v1/work-adjustments", {
    method: "POST",
    upstreamPath: "/api/v1/work-adjustments",
    requestBody: "json",
    requiresToken: true,
    target: (_match: RegExpMatchArray, url: URL) =>
      passthroughSearch("/api/v1/work-adjustments", url)
  }),
  exact("/forge/v1/insights", {
    method: "POST",
    upstreamPath: "/api/v1/insights",
    requestBody: "json",
    requiresToken: true,
    target: (_match: RegExpMatchArray, url: URL) =>
      passthroughSearch("/api/v1/insights", url)
  }),
  {
    path: "/forge/v1/preferences",
    match: "prefix",
    operations: [
      {
        method: "POST",
        pattern: /^\/forge\/v1\/preferences\/game\/start$/,
        upstreamPath: "/api/v1/preferences/game/start",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/preferences/game/start", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/preferences\/catalogs$/,
        upstreamPath: "/api/v1/preferences/catalogs",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/preferences/catalogs", url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/preferences\/catalogs\/([^/]+)$/,
        upstreamPath: "/api/v1/preferences/catalogs/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/preferences/catalogs/${match[1]}`, url)
      },
      {
        method: "DELETE",
        pattern: /^\/forge\/v1\/preferences\/catalogs\/([^/]+)$/,
        upstreamPath: "/api/v1/preferences/catalogs/:id",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/preferences/catalogs/${match[1]}`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/preferences\/catalog-items$/,
        upstreamPath: "/api/v1/preferences/catalog-items",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/preferences/catalog-items", url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/preferences\/catalog-items\/([^/]+)$/,
        upstreamPath: "/api/v1/preferences/catalog-items/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(
            `/api/v1/preferences/catalog-items/${match[1]}`,
            url
          )
      },
      {
        method: "DELETE",
        pattern: /^\/forge\/v1\/preferences\/catalog-items\/([^/]+)$/,
        upstreamPath: "/api/v1/preferences/catalog-items/:id",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(
            `/api/v1/preferences/catalog-items/${match[1]}`,
            url
          )
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/preferences\/contexts$/,
        upstreamPath: "/api/v1/preferences/contexts",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/preferences/contexts", url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/preferences\/contexts\/([^/]+)$/,
        upstreamPath: "/api/v1/preferences/contexts/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/preferences/contexts/${match[1]}`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/preferences\/contexts\/merge$/,
        upstreamPath: "/api/v1/preferences/contexts/merge",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/preferences/contexts/merge", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/preferences\/items$/,
        upstreamPath: "/api/v1/preferences/items",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/preferences/items", url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/preferences\/items\/([^/]+)$/,
        upstreamPath: "/api/v1/preferences/items/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/preferences/items/${match[1]}`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/preferences\/items\/from-entity$/,
        upstreamPath: "/api/v1/preferences/items/from-entity",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/preferences/items/from-entity", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/preferences\/judgments$/,
        upstreamPath: "/api/v1/preferences/judgments",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/preferences/judgments", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/preferences\/signals$/,
        upstreamPath: "/api/v1/preferences/signals",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/preferences/signals", url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/preferences\/items\/([^/]+)\/score$/,
        upstreamPath: "/api/v1/preferences/items/:id/score",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/preferences/items/${match[1]}/score`, url)
      }
    ]
  },
  {
    path: "/forge/v1/psyche/questionnaires",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/psyche\/questionnaires$/,
        upstreamPath: "/api/v1/psyche/questionnaires",
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/psyche/questionnaires", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/psyche\/questionnaires$/,
        upstreamPath: "/api/v1/psyche/questionnaires",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/psyche/questionnaires", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/psyche\/questionnaires\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/questionnaires/:id",
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/psyche/questionnaires/${match[1]}`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/psyche\/questionnaires\/([^/]+)\/clone$/,
        upstreamPath: "/api/v1/psyche/questionnaires/:id/clone",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(
            `/api/v1/psyche/questionnaires/${match[1]}/clone`,
            url
          )
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/psyche\/questionnaires\/([^/]+)\/draft$/,
        upstreamPath: "/api/v1/psyche/questionnaires/:id/draft",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(
            `/api/v1/psyche/questionnaires/${match[1]}/draft`,
            url
          )
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/psyche\/questionnaires\/([^/]+)\/draft$/,
        upstreamPath: "/api/v1/psyche/questionnaires/:id/draft",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(
            `/api/v1/psyche/questionnaires/${match[1]}/draft`,
            url
          )
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/psyche\/questionnaires\/([^/]+)\/publish$/,
        upstreamPath: "/api/v1/psyche/questionnaires/:id/publish",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(
            `/api/v1/psyche/questionnaires/${match[1]}/publish`,
            url
          )
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/psyche\/questionnaires\/([^/]+)\/runs$/,
        upstreamPath: "/api/v1/psyche/questionnaires/:id/runs",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(
            `/api/v1/psyche/questionnaires/${match[1]}/runs`,
            url
          )
      }
    ]
  },
  {
    path: "/forge/v1/psyche/questionnaire-runs",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/psyche\/questionnaire-runs\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/questionnaire-runs/:id",
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(
            `/api/v1/psyche/questionnaire-runs/${match[1]}`,
            url
          )
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/psyche\/questionnaire-runs\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/questionnaire-runs/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(
            `/api/v1/psyche/questionnaire-runs/${match[1]}`,
            url
          )
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/psyche\/questionnaire-runs\/([^/]+)\/complete$/,
        upstreamPath: "/api/v1/psyche/questionnaire-runs/:id/complete",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(
            `/api/v1/psyche/questionnaire-runs/${match[1]}/complete`,
            url
          )
      }
    ]
  },
  {
    path: "/forge/v1/wiki/pages",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/wiki\/pages$/,
        upstreamPath: "/api/v1/wiki/pages",
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/wiki/pages", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/wiki\/pages$/,
        upstreamPath: "/api/v1/wiki/pages",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/wiki/pages", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/wiki\/pages\/([^/]+)$/,
        upstreamPath: "/api/v1/wiki/pages/:id",
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/wiki/pages/${match[1]}`, url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/wiki\/pages\/([^/]+)$/,
        upstreamPath: "/api/v1/wiki/pages/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/wiki/pages/${match[1]}`, url)
      }
    ]
  },
  {
    path: "/forge/v1/wiki",
    match: "prefix",
    operations: [
      {
        method: "POST",
        pattern: /^\/forge\/v1\/wiki\/search$/,
        upstreamPath: "/api/v1/wiki/search",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/wiki/search", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/wiki\/sync$/,
        upstreamPath: "/api/v1/wiki/sync",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/wiki/sync", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/wiki\/reindex$/,
        upstreamPath: "/api/v1/wiki/reindex",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/wiki/reindex", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/wiki\/ingest-jobs$/,
        upstreamPath: "/api/v1/wiki/ingest-jobs",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/wiki/ingest-jobs", url)
      }
    ]
  },
  {
    path: "/forge/v1/health",
    match: "prefix",
    operations: [
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/health\/sleep\/([^/]+)$/,
        upstreamPath: "/api/v1/health/sleep/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/health/sleep/${match[1]}`, url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/health\/workouts\/([^/]+)$/,
        upstreamPath: "/api/v1/health/workouts/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/health/workouts/${match[1]}`, url)
      }
    ]
  },
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
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/entities/search", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/entities\/create$/,
        upstreamPath: "/api/v1/entities/create",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/entities/create", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/entities\/update$/,
        upstreamPath: "/api/v1/entities/update",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/entities/update", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/entities\/delete$/,
        upstreamPath: "/api/v1/entities/delete",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/entities/delete", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/entities\/restore$/,
        upstreamPath: "/api/v1/entities/restore",
        requestBody: "json",
        requiresToken: true,
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/entities/restore", url)
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
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/tasks/${match[1]}/runs`, url)
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
        target: (_match: RegExpMatchArray, url: URL) =>
          passthroughSearch("/api/v1/task-runs", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/task-runs\/([^/]+)\/heartbeat$/,
        upstreamPath: "/api/v1/task-runs/:id/heartbeat",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/task-runs/${match[1]}/heartbeat`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/task-runs\/([^/]+)\/focus$/,
        upstreamPath: "/api/v1/task-runs/:id/focus",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/task-runs/${match[1]}/focus`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/task-runs\/([^/]+)\/complete$/,
        upstreamPath: "/api/v1/task-runs/:id/complete",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/task-runs/${match[1]}/complete`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/task-runs\/([^/]+)\/release$/,
        upstreamPath: "/api/v1/task-runs/:id/release",
        requestBody: "json",
        requiresToken: true,
        target: (match: RegExpMatchArray, url: URL) =>
          passthroughSearch(`/api/v1/task-runs/${match[1]}/release`, url)
      }
    ]
  },
  exact("/forge/v1/ui", {
    kind: "ui_redirect",
    method: "GET"
  })
];

export function collectMirroredApiRouteKeys(): Set<ApiRouteKey> {
  return new Set(
    FORGE_PLUGIN_ROUTE_GROUPS.flatMap((group) =>
      group.operations.flatMap((operation) =>
        "upstreamPath" in operation
          ? [makeApiRouteKey(operation.method, operation.upstreamPath)]
          : []
      )
    )
  );
}

export function buildRouteParityReport(
  pathMap: Record<string, Record<string, unknown>>,
  onboarding?: unknown
) {
  const mirrored = collectMirroredApiRouteKeys();
  const supported = collectSupportedPluginApiRouteKeys();
  const publishedByOnboarding =
    collectPublishedOnboardingApiRouteKeys(onboarding);
  const requiredMirrorsFromOnboarding =
    collectRequiredMirroredOnboardingApiRouteKeys(onboarding);
  const openApiRoutes = new Set(
    Object.entries(pathMap)
      .flatMap(([path, methods]) =>
        Object.keys(methods).map((method) => makeApiRouteKey(method, path))
      )
      .filter(
        (key) =>
          key.startsWith("GET /api/v1") ||
          key.startsWith("POST /api/v1") ||
          key.startsWith("PUT /api/v1") ||
          key.startsWith("PATCH /api/v1") ||
          key.startsWith("DELETE /api/v1")
      )
  );

  const missingFromPlugin = [...supported]
    .filter((key) => !mirrored.has(key))
    .sort();
  const missingFromOpenApi = [...supported]
    .filter((key) => !openApiRoutes.has(key))
    .sort();
  const unexpectedMirrors = [...mirrored]
    .filter((key) => !supported.has(key))
    .sort();
  const missingPublishedFromOpenApi = [...publishedByOnboarding]
    .filter((key) => !openApiRoutes.has(key))
    .sort();
  const missingRequiredMirrors = [...requiredMirrorsFromOnboarding]
    .filter((key) => !mirrored.has(key))
    .sort();

  return {
    supported: [...supported].sort(),
    mirrored: [...mirrored].sort(),
    publishedByOnboarding: [...publishedByOnboarding].sort(),
    requiredMirrorsFromOnboarding: [...requiredMirrorsFromOnboarding].sort(),
    missingFromPlugin,
    missingFromOpenApi,
    unexpectedMirrors,
    missingPublishedFromOpenApi,
    missingRequiredMirrors
  };
}

export function registerForgePluginRoutes(
  api: ForgePluginRouteApi,
  config: ForgePluginConfig
) {
  for (const group of FORGE_PLUGIN_ROUTE_GROUPS) {
    api.registerHttpRoute({
      path: group.path,
      auth: "plugin",
      match: group.match,
      handler: (request, response) =>
        handleGroup(request, response, config, group)
    });
  }
}

function createCliAction(config: ForgePluginConfig, path: string) {
  return async () => {
    const result = await callConfiguredForgeApi(config, {
      method: "GET",
      path
    });
    const data = expectForgeSuccess(result);
    console.log(JSON.stringify(data, null, 2));
  };
}

async function runReadOnly(config: ForgePluginConfig, path: string) {
  return expectForgeSuccess(
    await callConfiguredForgeApi(config, {
      method: "GET",
      path
    })
  );
}

async function runPost(config: ForgePluginConfig, path: string, body: unknown) {
  return expectForgeSuccess(
    await callConfiguredForgeApi(config, {
      method: "POST",
      path,
      body
    })
  );
}

export async function runRouteCheck(config: ForgePluginConfig) {
  const [openapi, onboarding] = await Promise.all([
    runReadOnly(config, "/api/v1/openapi.json"),
    runReadOnly(config, "/api/v1/agents/onboarding")
  ]);
  const pathMap =
    typeof openapi === "object" &&
    openapi !== null &&
    "paths" in openapi &&
    typeof openapi.paths === "object" &&
    openapi.paths !== null
      ? (openapi.paths as Record<string, Record<string, unknown>>)
      : {};
  return buildRouteParityReport(pathMap, onboarding);
}

export async function runDoctor(config: ForgePluginConfig) {
  const [doctorResponse, overview, onboarding, routeParity, uiUrl] =
    await Promise.all([
      runReadOnly(config, "/api/v1/doctor"),
      runReadOnly(config, "/api/v1/operator/overview"),
      runReadOnly(config, "/api/v1/agents/onboarding"),
      runRouteCheck(config),
      resolveForgeUiUrl(config)
    ]);

  const doctorBody =
    typeof doctorResponse === "object" &&
    doctorResponse !== null &&
    "doctor" in doctorResponse &&
    typeof doctorResponse.doctor === "object" &&
    doctorResponse.doctor !== null
      ? (doctorResponse.doctor as Record<string, unknown>)
      : null;
  const overviewBody =
    typeof overview === "object" &&
    overview !== null &&
    "overview" in overview &&
    typeof overview.overview === "object" &&
    overview.overview !== null
      ? (overview.overview as Record<string, unknown>)
      : null;
  const capabilities =
    overviewBody &&
    typeof overviewBody.capabilities === "object" &&
    overviewBody.capabilities !== null
      ? (overviewBody.capabilities as Record<string, unknown>)
      : null;
  const warnings = Array.isArray(doctorBody?.warnings)
    ? doctorBody.warnings.filter(
        (entry): entry is string => typeof entry === "string"
      )
    : [];
  const canBootstrap = canBootstrapOperatorSession(config.baseUrl);
  const pairedCredentialConfigured =
    (config.remoteCredentialId?.trim().length ?? 0) > 0;

  if (
    config.apiToken.trim().length === 0 &&
    !pairedCredentialConfigured &&
    canBootstrap
  ) {
    warnings.push(
      "Forge apiToken is blank, but this direct-localhost target can use automatic verified local-owner access for protected reads and writes."
    );
  } else if (
    config.apiToken.trim().length === 0 &&
    !pairedCredentialConfigured
  ) {
    warnings.push(
      "Forge apiToken is missing, and this target is not direct localhost. Complete remote pairing and configure the resulting scoped credential; Tailscale reachability alone does not authorize protected access."
    );
  }
  if (capabilities && capabilities.canReadPsyche === false) {
    warnings.push(
      "The configured token cannot read Psyche state. Sensitive reflection summaries will stay partial."
    );
  }
  if (routeParity.missingFromPlugin.length > 0) {
    warnings.push(
      `Plugin route coverage is missing ${routeParity.missingFromPlugin.length} curated route${routeParity.missingFromPlugin.length === 1 ? "" : "s"}. Run forge route-check.`
    );
  }
  if (routeParity.missingFromOpenApi.length > 0) {
    warnings.push(
      `Forge OpenAPI is missing ${routeParity.missingFromOpenApi.length} curated route${routeParity.missingFromOpenApi.length === 1 ? "" : "s"} expected by the plugin.`
    );
  }
  if (routeParity.unexpectedMirrors.length > 0) {
    warnings.push(
      `Plugin still mirrors ${routeParity.unexpectedMirrors.length} unexpected route${routeParity.unexpectedMirrors.length === 1 ? "" : "s"} outside the curated contract.`
    );
  }
  if (routeParity.missingPublishedFromOpenApi.length > 0) {
    warnings.push(
      `Forge OpenAPI is missing ${routeParity.missingPublishedFromOpenApi.length} route${routeParity.missingPublishedFromOpenApi.length === 1 ? "" : "s"} published by live onboarding.`
    );
  }
  if (routeParity.missingRequiredMirrors.length > 0) {
    warnings.push(
      `Plugin route coverage is missing ${routeParity.missingRequiredMirrors.length} route${routeParity.missingRequiredMirrors.length === 1 ? "" : "s"} required by a mirrored live onboarding surface.`
    );
  }

  return {
    ...(doctorBody ?? {}),
    ok:
      doctorBody?.ok === true &&
      (config.apiToken.trim().length > 0 ||
        pairedCredentialConfigured ||
        canBootstrap) &&
      routeParity.missingFromPlugin.length === 0 &&
      routeParity.missingFromOpenApi.length === 0 &&
      routeParity.unexpectedMirrors.length === 0 &&
      routeParity.missingPublishedFromOpenApi.length === 0 &&
      routeParity.missingRequiredMirrors.length === 0,
    origin: config.origin,
    port: config.port,
    baseUrl: config.baseUrl,
    webAppUrl: uiUrl,
    actorLabel: config.actorLabel,
    apiTokenConfigured: config.apiToken.trim().length > 0,
    pairedCredentialConfigured,
    operatorSessionBootstrapAvailable: canBootstrap,
    warnings,
    overview,
    onboarding,
    routeParity
  };
}

export async function applyDoctorFixes(
  config: ForgePluginConfig,
  input: { fixIds?: string[]; applyAllSafe?: boolean }
) {
  return runPost(config, "/api/v1/doctor/fixes", input);
}

function getSafeDoctorFixIds(doctor: Record<string, unknown>) {
  const issues = Array.isArray(doctor.issues) ? doctor.issues : [];
  return issues
    .map((issue) =>
      typeof issue === "object" &&
      issue !== null &&
      "fix" in issue &&
      typeof issue.fix === "object" &&
      issue.fix !== null &&
      (issue.fix as Record<string, unknown>).kind === "safe_auto_fix" &&
      typeof (issue.fix as Record<string, unknown>).id === "string"
        ? ((issue.fix as Record<string, unknown>).id as string)
        : null
    )
    .filter((fixId): fixId is string => Boolean(fixId));
}

function formatDoctorSummary(doctor: Record<string, unknown>) {
  const integrity =
    typeof doctor.integrity === "object" && doctor.integrity !== null
      ? (doctor.integrity as Record<string, unknown>)
      : {};
  const issues = Array.isArray(doctor.issues) ? doctor.issues : [];
  const warnings = Array.isArray(doctor.warnings) ? doctor.warnings : [];
  const lines = [
    `Forge Doctor: ${doctor.ok === true ? "ok" : "attention needed"}`,
    `Integrity: ${typeof integrity.score === "number" ? integrity.score : "unknown"}%`,
    typeof integrity.headline === "string" ? integrity.headline : null,
    `Issues: ${issues.length}`,
    warnings.length > 0 ? "" : null,
    ...warnings.slice(0, 8).map((warning) => `- ${String(warning)}`)
  ].filter((line): line is string => line !== null);
  return lines.join("\n");
}

export function registerForgePluginCli(
  api: ForgePluginCliApi,
  config: ForgePluginConfig
) {
  api.registerCli?.(
    ({ program }) => {
      const command = program
        .command("forge")
        .description("Inspect and operate Forge through the OpenClaw plugin");
      command
        .command("health")
        .description("Check Forge health")
        .action(createCliAction(config, "/api/v1/health"));
      command
        .command("overview")
        .description("Fetch the one-shot Forge operator overview")
        .action(createCliAction(config, "/api/v1/operator/overview"));
      command
        .command("onboarding")
        .description("Print the Forge agent onboarding contract")
        .action(createCliAction(config, "/api/v1/agents/onboarding"));
      command
        .command("ui")
        .description("Print the Forge UI entrypoint")
        .action(async () => {
          console.log(
            JSON.stringify(
              {
                webAppUrl: await resolveForgeUiUrl(config),
                pluginUiRoute: "/forge/v1/ui"
              },
              null,
              2
            )
          );
        });
      command
        .command("start")
        .description(
          "Start the local Forge runtime when it is managed by the OpenClaw plugin"
        )
        .action(async () => {
          console.log(JSON.stringify(await startForgeRuntime(config), null, 2));
        });
      command
        .command("stop")
        .description(
          "Stop the local Forge runtime when it was auto-started by the OpenClaw plugin"
        )
        .action(async () => {
          console.log(JSON.stringify(await stopForgeRuntime(config), null, 2));
        });
      command
        .command("restart")
        .description(
          "Restart the local Forge runtime when it is managed by the OpenClaw plugin"
        )
        .action(async () => {
          console.log(
            JSON.stringify(await restartForgeRuntime(config), null, 2)
          );
        });
      command
        .command("status")
        .description(
          "Report whether the local Forge runtime is running and whether it is plugin-managed"
        )
        .action(async () => {
          console.log(
            JSON.stringify(await getForgeRuntimeStatus(config), null, 2)
          );
        });
      command
        .command("doctor")
        .description("Run Forge Doctor diagnostics")
        .option("--json", "Print the full machine-readable Doctor payload")
        .option("--fix", "Apply safe Doctor fixes after diagnostics")
        .action(async (rawOptions?: unknown) => {
          const options = (rawOptions ?? {}) as {
            json?: boolean;
            fix?: boolean;
          };
          const doctor = (await runDoctor(config)) as Record<string, unknown>;
          if (options.fix) {
            const fixIds = getSafeDoctorFixIds(doctor);
            if (fixIds.length > 0) {
              const fixResult = await applyDoctorFixes(config, { fixIds });
              const refreshedDoctor = (await runDoctor(config)) as Record<
                string,
                unknown
              >;
              const payload = {
                doctor: refreshedDoctor,
                fixResult
              };
              console.log(
                options.json
                  ? JSON.stringify(payload, null, 2)
                  : `${formatDoctorSummary(refreshedDoctor)}\n\nApplied fixes: ${fixIds.join(", ")}`
              );
              return;
            }
          }
          console.log(
            options.json
              ? JSON.stringify(doctor, null, 2)
              : formatDoctorSummary(doctor)
          );
        });
      command
        .command("route-check")
        .description(
          "Compare curated and live-onboarding plugin route coverage against Forge OpenAPI"
        )
        .action(async () => {
          console.log(JSON.stringify(await runRouteCheck(config), null, 2));
        });
    },
    {
      commands: ["forge"],
      descriptors: [
        {
          name: "forge",
          description: "Inspect and operate Forge through the OpenClaw plugin",
          hasSubcommands: true
        }
      ]
    }
  );
}
