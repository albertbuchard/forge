import type { IncomingMessage, ServerResponse } from "node:http";
import {
  canBootstrapOperatorSession,
  callForgeApi,
  expectForgeSuccess,
  readJsonRequestBody,
  readSingleHeaderValue,
  requireApiToken,
  writeForgeProxyResponse,
  writePluginError,
  writeJsonResponse,
  type ForgeHttpMethod,
  type ForgePluginConfig
} from "./api-client.js";
import { FORGE_PLUGIN_ROUTE_EXCLUSIONS, makeApiRouteKey, type ApiRouteKey } from "./parity.js";
import type { ForgePluginCliApi, ForgePluginRouteApi, ForgeRegisteredHttpRoute } from "./plugin-sdk-types.js";

type PluginRouteMatch = NonNullable<ForgeRegisteredHttpRoute["match"]>;

type RouteOperation = {
  method: ForgeHttpMethod;
  pattern: RegExp;
  upstreamPath: string;
  target: (match: RegExpMatchArray, url: URL) => string;
  requiresToken?: boolean;
  requestBody?: "json";
};

type RouteGroup = {
  path: string;
  match: PluginRouteMatch;
  operations: RouteOperation[];
};

function passthroughSearch(path: string, url: URL) {
  return `${path}${url.search}`;
}

function encodePathSegment(value: string) {
  return encodeURIComponent(decodeURIComponent(value));
}

function methodNotAllowed(response: ServerResponse, allowedMethods: ForgeHttpMethod[]) {
  response.setHeader("allow", allowedMethods.join(", "));
  writeJsonResponse(response, 405, {
    ok: false,
    error: {
      code: "forge_plugin_method_not_allowed",
      message: `Allowed methods: ${allowedMethods.join(", ")}`
    }
  });
}

function routeNotFound(response: ServerResponse, pathname: string) {
  writeJsonResponse(response, 404, {
    ok: false,
    error: {
      code: "forge_plugin_route_not_found",
      message: `No Forge plugin route matches ${pathname}`
    }
  });
}

async function forwardOperation(
  request: IncomingMessage,
  response: ServerResponse,
  config: ForgePluginConfig,
  operation: RouteOperation,
  match: RegExpMatchArray,
  url: URL
) {
  if (operation.requiresToken) {
    requireApiToken(config);
  }

  const body = operation.requestBody === "json" ? await readJsonRequestBody(request, { emptyObject: true }) : undefined;
  const result = await callForgeApi({
    baseUrl: config.baseUrl,
    apiToken: config.apiToken,
    actorLabel: config.actorLabel,
    timeoutMs: config.timeoutMs,
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
      .filter((entry): entry is { operation: RouteOperation; match: RegExpMatchArray } => entry !== null);

    if (matchingOperations.length === 0) {
      routeNotFound(response, pathname);
      return;
    }

    const matchedOperation = matchingOperations.find((entry) => entry.operation.method === method);
    if (!matchedOperation) {
      methodNotAllowed(
        response,
        [...new Set(matchingOperations.map((entry) => entry.operation.method))]
      );
      return;
    }

    await forwardOperation(request, response, config, matchedOperation.operation, matchedOperation.match, url);
  } catch (error) {
    writePluginError(response, error);
  }
}

const exact = (path: string, operation: Omit<RouteOperation, "pattern">): RouteGroup => ({
  path,
  match: "exact",
  operations: [{ ...operation, pattern: new RegExp(`^${path.replaceAll("/", "\\/")}$`) }]
});

export const FORGE_PLUGIN_ROUTE_GROUPS: RouteGroup[] = [
  exact("/forge/v1/health", {
    method: "GET",
    upstreamPath: "/api/v1/health",
    target: (_match, url) => passthroughSearch("/api/v1/health", url)
  }),
  exact("/forge/v1/openapi.json", {
    method: "GET",
    upstreamPath: "/api/v1/openapi.json",
    target: (_match, url) => passthroughSearch("/api/v1/openapi.json", url)
  }),
  exact("/forge/v1/context", {
    method: "GET",
    upstreamPath: "/api/v1/context",
    target: (_match, url) => passthroughSearch("/api/v1/context", url)
  }),
  exact("/forge/v1/domains", {
    method: "GET",
    upstreamPath: "/api/v1/domains",
    target: (_match, url) => passthroughSearch("/api/v1/domains", url)
  }),
  {
    path: "/forge/v1/goals",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/goals$/,
        upstreamPath: "/api/v1/goals",
        target: (_match, url) => passthroughSearch("/api/v1/goals", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/goals$/,
        upstreamPath: "/api/v1/goals",
        requestBody: "json",
        requiresToken: true,
        target: (_match, url) => passthroughSearch("/api/v1/goals", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/goals\/([^/]+)$/,
        upstreamPath: "/api/v1/goals/:id",
        target: (match, url) => passthroughSearch(`/api/v1/goals/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/goals\/([^/]+)$/,
        upstreamPath: "/api/v1/goals/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/goals/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "DELETE",
        pattern: /^\/forge\/v1\/goals\/([^/]+)$/,
        upstreamPath: "/api/v1/goals/:id",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/goals/${encodePathSegment(match[1] ?? "")}`, url)
      }
    ]
  },
  {
    path: "/forge/v1/projects",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/projects$/,
        upstreamPath: "/api/v1/projects",
        target: (_match, url) => passthroughSearch("/api/v1/projects", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/projects$/,
        upstreamPath: "/api/v1/projects",
        requestBody: "json",
        requiresToken: true,
        target: (_match, url) => passthroughSearch("/api/v1/projects", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/projects\/([^/]+)$/,
        upstreamPath: "/api/v1/projects/:id",
        target: (match, url) => passthroughSearch(`/api/v1/projects/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/projects\/([^/]+)$/,
        upstreamPath: "/api/v1/projects/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/projects/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "DELETE",
        pattern: /^\/forge\/v1\/projects\/([^/]+)$/,
        upstreamPath: "/api/v1/projects/:id",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/projects/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/projects\/([^/]+)\/board$/,
        upstreamPath: "/api/v1/projects/:id/board",
        target: (match, url) => passthroughSearch(`/api/v1/projects/${encodePathSegment(match[1] ?? "")}/board`, url)
      }
    ]
  },
  {
    path: "/forge/v1/tasks",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/tasks$/,
        upstreamPath: "/api/v1/tasks",
        target: (_match, url) => passthroughSearch("/api/v1/tasks", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/tasks$/,
        upstreamPath: "/api/v1/tasks",
        requestBody: "json",
        requiresToken: true,
        target: (_match, url) => passthroughSearch("/api/v1/tasks", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/tasks\/([^/]+)$/,
        upstreamPath: "/api/v1/tasks/:id",
        target: (match, url) => passthroughSearch(`/api/v1/tasks/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/tasks\/([^/]+)$/,
        upstreamPath: "/api/v1/tasks/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/tasks/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "DELETE",
        pattern: /^\/forge\/v1\/tasks\/([^/]+)$/,
        upstreamPath: "/api/v1/tasks/:id",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/tasks/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/tasks\/([^/]+)\/context$/,
        upstreamPath: "/api/v1/tasks/:id/context",
        target: (match, url) => passthroughSearch(`/api/v1/tasks/${encodePathSegment(match[1] ?? "")}/context`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/tasks\/([^/]+)\/runs$/,
        upstreamPath: "/api/v1/tasks/:id/runs",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/tasks/${encodePathSegment(match[1] ?? "")}/runs`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/tasks\/([^/]+)\/uncomplete$/,
        upstreamPath: "/api/v1/tasks/:id/uncomplete",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/tasks/${encodePathSegment(match[1] ?? "")}/uncomplete`, url)
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
        target: (match, url) => passthroughSearch(`/api/v1/task-runs/${encodePathSegment(match[1] ?? "")}/heartbeat`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/task-runs\/([^/]+)\/complete$/,
        upstreamPath: "/api/v1/task-runs/:id/complete",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/task-runs/${encodePathSegment(match[1] ?? "")}/complete`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/task-runs\/([^/]+)\/focus$/,
        upstreamPath: "/api/v1/task-runs/:id/focus",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/task-runs/${encodePathSegment(match[1] ?? "")}/focus`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/task-runs\/([^/]+)\/release$/,
        upstreamPath: "/api/v1/task-runs/:id/release",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/task-runs/${encodePathSegment(match[1] ?? "")}/release`, url)
      }
    ]
  },
  {
    path: "/forge/v1/tags",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/tags$/,
        upstreamPath: "/api/v1/tags",
        target: (_match, url) => passthroughSearch("/api/v1/tags", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/tags$/,
        upstreamPath: "/api/v1/tags",
        requestBody: "json",
        requiresToken: true,
        target: (_match, url) => passthroughSearch("/api/v1/tags", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/tags\/([^/]+)$/,
        upstreamPath: "/api/v1/tags/:id",
        target: (match, url) => passthroughSearch(`/api/v1/tags/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/tags\/([^/]+)$/,
        upstreamPath: "/api/v1/tags/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/tags/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "DELETE",
        pattern: /^\/forge\/v1\/tags\/([^/]+)$/,
        upstreamPath: "/api/v1/tags/:id",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/tags/${encodePathSegment(match[1] ?? "")}`, url)
      }
    ]
  },
  {
    path: "/forge/v1/activity",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/activity$/,
        upstreamPath: "/api/v1/activity",
        target: (_match, url) => passthroughSearch("/api/v1/activity", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/activity\/([^/]+)\/remove$/,
        upstreamPath: "/api/v1/activity/:id/remove",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/activity/${encodePathSegment(match[1] ?? "")}/remove`, url)
      }
    ]
  },
  {
    path: "/forge/v1/metrics",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/metrics$/,
        upstreamPath: "/api/v1/metrics",
        target: (_match, url) => passthroughSearch("/api/v1/metrics", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/metrics\/xp$/,
        upstreamPath: "/api/v1/metrics/xp",
        target: (_match, url) => passthroughSearch("/api/v1/metrics/xp", url)
      }
    ]
  },
  {
    path: "/forge/v1/operator",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/operator\/overview$/,
        upstreamPath: "/api/v1/operator/overview",
        target: (_match, url) => passthroughSearch("/api/v1/operator/overview", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/operator\/context$/,
        upstreamPath: "/api/v1/operator/context",
        target: (_match, url) => passthroughSearch("/api/v1/operator/context", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/operator\/log-work$/,
        upstreamPath: "/api/v1/operator/log-work",
        requestBody: "json",
        requiresToken: true,
        target: (_match, url) => passthroughSearch("/api/v1/operator/log-work", url)
      }
    ]
  },
  {
    path: "/forge/v1/comments",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/comments$/,
        upstreamPath: "/api/v1/comments",
        target: (_match, url) => passthroughSearch("/api/v1/comments", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/comments$/,
        upstreamPath: "/api/v1/comments",
        requestBody: "json",
        requiresToken: true,
        target: (_match, url) => passthroughSearch("/api/v1/comments", url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/comments\/([^/]+)$/,
        upstreamPath: "/api/v1/comments/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/comments/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/comments\/([^/]+)$/,
        upstreamPath: "/api/v1/comments/:id",
        target: (match, url) => passthroughSearch(`/api/v1/comments/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "DELETE",
        pattern: /^\/forge\/v1\/comments\/([^/]+)$/,
        upstreamPath: "/api/v1/comments/:id",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/comments/${encodePathSegment(match[1] ?? "")}`, url)
      }
    ]
  },
  {
    path: "/forge/v1/insights",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/insights$/,
        upstreamPath: "/api/v1/insights",
        target: (_match, url) => passthroughSearch("/api/v1/insights", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/insights$/,
        upstreamPath: "/api/v1/insights",
        requestBody: "json",
        requiresToken: true,
        target: (_match, url) => passthroughSearch("/api/v1/insights", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/insights\/([^/]+)$/,
        upstreamPath: "/api/v1/insights/:id",
        target: (match, url) => passthroughSearch(`/api/v1/insights/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/insights\/([^/]+)$/,
        upstreamPath: "/api/v1/insights/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/insights/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "DELETE",
        pattern: /^\/forge\/v1\/insights\/([^/]+)$/,
        upstreamPath: "/api/v1/insights/:id",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/insights/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/insights\/([^/]+)\/feedback$/,
        upstreamPath: "/api/v1/insights/:id/feedback",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/insights/${encodePathSegment(match[1] ?? "")}/feedback`, url)
      }
    ]
  },
  {
    path: "/forge/v1/psyche",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/psyche\/overview$/,
        upstreamPath: "/api/v1/psyche/overview",
        target: (_match, url) => passthroughSearch("/api/v1/psyche/overview", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/psyche\/values$/,
        upstreamPath: "/api/v1/psyche/values",
        target: (_match, url) => passthroughSearch("/api/v1/psyche/values", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/psyche\/values$/,
        upstreamPath: "/api/v1/psyche/values",
        requestBody: "json",
        requiresToken: true,
        target: (_match, url) => passthroughSearch("/api/v1/psyche/values", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/psyche\/values\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/values/:id",
        target: (match, url) => passthroughSearch(`/api/v1/psyche/values/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/psyche\/values\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/values/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/psyche/values/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "DELETE",
        pattern: /^\/forge\/v1\/psyche\/values\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/values/:id",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/psyche/values/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/psyche\/patterns$/,
        upstreamPath: "/api/v1/psyche/patterns",
        target: (_match, url) => passthroughSearch("/api/v1/psyche/patterns", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/psyche\/patterns$/,
        upstreamPath: "/api/v1/psyche/patterns",
        requestBody: "json",
        requiresToken: true,
        target: (_match, url) => passthroughSearch("/api/v1/psyche/patterns", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/psyche\/patterns\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/patterns/:id",
        target: (match, url) => passthroughSearch(`/api/v1/psyche/patterns/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/psyche\/patterns\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/patterns/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/psyche/patterns/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "DELETE",
        pattern: /^\/forge\/v1\/psyche\/patterns\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/patterns/:id",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/psyche/patterns/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/psyche\/behaviors$/,
        upstreamPath: "/api/v1/psyche/behaviors",
        target: (_match, url) => passthroughSearch("/api/v1/psyche/behaviors", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/psyche\/behaviors$/,
        upstreamPath: "/api/v1/psyche/behaviors",
        requestBody: "json",
        requiresToken: true,
        target: (_match, url) => passthroughSearch("/api/v1/psyche/behaviors", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/psyche\/behaviors\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/behaviors/:id",
        target: (match, url) => passthroughSearch(`/api/v1/psyche/behaviors/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/psyche\/behaviors\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/behaviors/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/psyche/behaviors/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "DELETE",
        pattern: /^\/forge\/v1\/psyche\/behaviors\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/behaviors/:id",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/psyche/behaviors/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/psyche\/schema-catalog$/,
        upstreamPath: "/api/v1/psyche/schema-catalog",
        target: (_match, url) => passthroughSearch("/api/v1/psyche/schema-catalog", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/psyche\/beliefs$/,
        upstreamPath: "/api/v1/psyche/beliefs",
        target: (_match, url) => passthroughSearch("/api/v1/psyche/beliefs", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/psyche\/beliefs$/,
        upstreamPath: "/api/v1/psyche/beliefs",
        requestBody: "json",
        requiresToken: true,
        target: (_match, url) => passthroughSearch("/api/v1/psyche/beliefs", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/psyche\/beliefs\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/beliefs/:id",
        target: (match, url) => passthroughSearch(`/api/v1/psyche/beliefs/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/psyche\/beliefs\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/beliefs/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/psyche/beliefs/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "DELETE",
        pattern: /^\/forge\/v1\/psyche\/beliefs\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/beliefs/:id",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/psyche/beliefs/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/psyche\/modes$/,
        upstreamPath: "/api/v1/psyche/modes",
        target: (_match, url) => passthroughSearch("/api/v1/psyche/modes", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/psyche\/modes$/,
        upstreamPath: "/api/v1/psyche/modes",
        requestBody: "json",
        requiresToken: true,
        target: (_match, url) => passthroughSearch("/api/v1/psyche/modes", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/psyche\/modes\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/modes/:id",
        target: (match, url) => passthroughSearch(`/api/v1/psyche/modes/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/psyche\/modes\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/modes/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/psyche/modes/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "DELETE",
        pattern: /^\/forge\/v1\/psyche\/modes\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/modes/:id",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/psyche/modes/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/psyche\/mode-guides$/,
        upstreamPath: "/api/v1/psyche/mode-guides",
        target: (_match, url) => passthroughSearch("/api/v1/psyche/mode-guides", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/psyche\/mode-guides$/,
        upstreamPath: "/api/v1/psyche/mode-guides",
        requestBody: "json",
        requiresToken: true,
        target: (_match, url) => passthroughSearch("/api/v1/psyche/mode-guides", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/psyche\/mode-guides\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/mode-guides/:id",
        target: (match, url) => passthroughSearch(`/api/v1/psyche/mode-guides/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/psyche\/mode-guides\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/mode-guides/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/psyche/mode-guides/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "DELETE",
        pattern: /^\/forge\/v1\/psyche\/mode-guides\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/mode-guides/:id",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/psyche/mode-guides/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/psyche\/event-types$/,
        upstreamPath: "/api/v1/psyche/event-types",
        target: (_match, url) => passthroughSearch("/api/v1/psyche/event-types", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/psyche\/event-types$/,
        upstreamPath: "/api/v1/psyche/event-types",
        requestBody: "json",
        requiresToken: true,
        target: (_match, url) => passthroughSearch("/api/v1/psyche/event-types", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/psyche\/event-types\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/event-types/:id",
        target: (match, url) => passthroughSearch(`/api/v1/psyche/event-types/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/psyche\/event-types\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/event-types/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/psyche/event-types/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "DELETE",
        pattern: /^\/forge\/v1\/psyche\/event-types\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/event-types/:id",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/psyche/event-types/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/psyche\/emotions$/,
        upstreamPath: "/api/v1/psyche/emotions",
        target: (_match, url) => passthroughSearch("/api/v1/psyche/emotions", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/psyche\/emotions$/,
        upstreamPath: "/api/v1/psyche/emotions",
        requestBody: "json",
        requiresToken: true,
        target: (_match, url) => passthroughSearch("/api/v1/psyche/emotions", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/psyche\/emotions\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/emotions/:id",
        target: (match, url) => passthroughSearch(`/api/v1/psyche/emotions/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/psyche\/emotions\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/emotions/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/psyche/emotions/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "DELETE",
        pattern: /^\/forge\/v1\/psyche\/emotions\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/emotions/:id",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/psyche/emotions/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/psyche\/reports$/,
        upstreamPath: "/api/v1/psyche/reports",
        target: (_match, url) => passthroughSearch("/api/v1/psyche/reports", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/psyche\/reports$/,
        upstreamPath: "/api/v1/psyche/reports",
        requestBody: "json",
        requiresToken: true,
        target: (_match, url) => passthroughSearch("/api/v1/psyche/reports", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/psyche\/reports\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/reports/:id",
        target: (match, url) => passthroughSearch(`/api/v1/psyche/reports/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/psyche\/reports\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/reports/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/psyche/reports/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "DELETE",
        pattern: /^\/forge\/v1\/psyche\/reports\/([^/]+)$/,
        upstreamPath: "/api/v1/psyche/reports/:id",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/psyche/reports/${encodePathSegment(match[1] ?? "")}`, url)
      }
    ]
  },
  {
    path: "/forge/v1/approval-requests",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/approval-requests$/,
        upstreamPath: "/api/v1/approval-requests",
        target: (_match, url) => passthroughSearch("/api/v1/approval-requests", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/approval-requests\/([^/]+)\/approve$/,
        upstreamPath: "/api/v1/approval-requests/:id/approve",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/approval-requests/${encodePathSegment(match[1] ?? "")}/approve`, url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/approval-requests\/([^/]+)\/reject$/,
        upstreamPath: "/api/v1/approval-requests/:id/reject",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/approval-requests/${encodePathSegment(match[1] ?? "")}/reject`, url)
      }
    ]
  },
  {
    path: "/forge/v1/agents",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/agents\/onboarding$/,
        upstreamPath: "/api/v1/agents/onboarding",
        target: (_match, url) => passthroughSearch("/api/v1/agents/onboarding", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/agents$/,
        upstreamPath: "/api/v1/agents",
        target: (_match, url) => passthroughSearch("/api/v1/agents", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/agents\/([^/]+)\/actions$/,
        upstreamPath: "/api/v1/agents/:id/actions",
        target: (match, url) => passthroughSearch(`/api/v1/agents/${encodePathSegment(match[1] ?? "")}/actions`, url)
      }
    ]
  },
  exact("/forge/v1/agent-actions", {
    method: "POST",
    upstreamPath: "/api/v1/agent-actions",
    requestBody: "json",
    requiresToken: true,
    target: (_match, url) => passthroughSearch("/api/v1/agent-actions", url)
  }),
  {
    path: "/forge/v1/rewards",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/rewards\/rules$/,
        upstreamPath: "/api/v1/rewards/rules",
        target: (_match, url) => passthroughSearch("/api/v1/rewards/rules", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/rewards\/rules\/([^/]+)$/,
        upstreamPath: "/api/v1/rewards/rules/:id",
        target: (match, url) => passthroughSearch(`/api/v1/rewards/rules/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/rewards\/rules\/([^/]+)$/,
        upstreamPath: "/api/v1/rewards/rules/:id",
        requestBody: "json",
        requiresToken: true,
        target: (match, url) => passthroughSearch(`/api/v1/rewards/rules/${encodePathSegment(match[1] ?? "")}`, url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/rewards\/ledger$/,
        upstreamPath: "/api/v1/rewards/ledger",
        target: (_match, url) => passthroughSearch("/api/v1/rewards/ledger", url)
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/rewards\/bonus$/,
        upstreamPath: "/api/v1/rewards/bonus",
        requestBody: "json",
        requiresToken: true,
        target: (_match, url) => passthroughSearch("/api/v1/rewards/bonus", url)
      }
    ]
  },
  {
    path: "/forge/v1/events",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/events$/,
        upstreamPath: "/api/v1/events",
        target: (_match, url) => passthroughSearch("/api/v1/events", url)
      },
      {
        method: "GET",
        pattern: /^\/forge\/v1\/events\/meta$/,
        upstreamPath: "/api/v1/events/meta",
        target: (_match, url) => passthroughSearch("/api/v1/events/meta", url)
      }
    ]
  },
  {
    path: "/forge/v1/reviews",
    match: "prefix",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/reviews\/weekly$/,
        upstreamPath: "/api/v1/reviews/weekly",
        target: (_match, url) => passthroughSearch("/api/v1/reviews/weekly", url)
      }
    ]
  },
  {
    path: "/forge/v1/settings",
    match: "exact",
    operations: [
      {
        method: "GET",
        pattern: /^\/forge\/v1\/settings$/,
        upstreamPath: "/api/v1/settings",
        target: (_match, url) => passthroughSearch("/api/v1/settings", url)
      },
      {
        method: "PATCH",
        pattern: /^\/forge\/v1\/settings$/,
        upstreamPath: "/api/v1/settings",
        requestBody: "json",
        requiresToken: true,
        target: (_match, url) => passthroughSearch("/api/v1/settings", url)
      }
    ]
  },
  exact("/forge/v1/settings/bin", {
    method: "GET",
    upstreamPath: "/api/v1/settings/bin",
    target: (_match, url) => passthroughSearch("/api/v1/settings/bin", url)
  }),
  {
    path: "/forge/v1/entities",
    match: "prefix",
    operations: [
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
      },
      {
        method: "POST",
        pattern: /^\/forge\/v1\/entities\/search$/,
        upstreamPath: "/api/v1/entities/search",
        requestBody: "json",
        requiresToken: true,
        target: (_match, url) => passthroughSearch("/api/v1/entities/search", url)
      }
    ]
  }
];

export function collectMirroredApiRouteKeys(): Set<ApiRouteKey> {
  return new Set(
    FORGE_PLUGIN_ROUTE_GROUPS.flatMap((group) =>
      group.operations.map((operation) => makeApiRouteKey(operation.method, operation.upstreamPath))
    )
  );
}

export function buildRouteParityReport(pathMap: Record<string, Record<string, unknown>>) {
  const mirrored = collectMirroredApiRouteKeys();
  const excluded = new Set(FORGE_PLUGIN_ROUTE_EXCLUSIONS.map((route) => makeApiRouteKey(route.method, route.path)));
  const allRelevant = Object.entries(pathMap)
    .flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => makeApiRouteKey(method, path))
    )
    .filter(
      (key) =>
        key.startsWith("GET /api/v1") ||
        key.startsWith("POST /api/v1") ||
        key.startsWith("PATCH /api/v1") ||
        key.startsWith("DELETE /api/v1")
    );

  const uncovered = allRelevant.filter((key) => !mirrored.has(key) && !excluded.has(key));
  return {
    mirrored: [...mirrored].sort(),
    excluded: [...excluded].sort(),
    uncovered: uncovered.sort()
  };
}

export function registerForgePluginRoutes(api: ForgePluginRouteApi, config: ForgePluginConfig) {
  for (const group of FORGE_PLUGIN_ROUTE_GROUPS) {
    api.registerHttpRoute({
      path: group.path,
      auth: "plugin",
      match: group.match,
      handler: (request, response) => handleGroup(request, response, config, group)
    });
  }
}

function createCliAction(config: ForgePluginConfig, path: string) {
  return async () => {
    const result = await callForgeApi({
      baseUrl: config.baseUrl,
      apiToken: config.apiToken,
      actorLabel: config.actorLabel,
      timeoutMs: config.timeoutMs,
      method: "GET",
      path
    });
    const data = expectForgeSuccess(result);
    console.log(JSON.stringify(data, null, 2));
  };
}

async function runDoctor(config: ForgePluginConfig) {
  const [health, overview, onboarding, routeParity] = await Promise.all([
    runReadOnly(config, "/api/v1/health"),
    runReadOnly(config, "/api/v1/operator/overview"),
    runReadOnly(config, "/api/v1/agents/onboarding"),
    runRouteCheck(config)
  ]);
  const overviewBody =
    typeof overview === "object" && overview !== null && "overview" in overview && typeof overview.overview === "object" && overview.overview !== null
      ? (overview.overview as Record<string, unknown>)
      : null;
  const capabilities =
    overviewBody && typeof overviewBody.capabilities === "object" && overviewBody.capabilities !== null
      ? (overviewBody.capabilities as Record<string, unknown>)
      : null;
  const overviewWarnings = Array.isArray(overviewBody?.warnings) ? overviewBody.warnings.filter((entry): entry is string => typeof entry === "string") : [];
  const uncoveredRoutes = routeParity.uncovered;
  const warnings: string[] = [];
  const canBootstrap = canBootstrapOperatorSession(config.baseUrl);
  if (config.apiToken.trim().length === 0 && canBootstrap) {
    warnings.push("Forge apiToken is blank, but this base URL can bootstrap a local or Tailscale operator session for protected reads and writes.");
  } else if (config.apiToken.trim().length === 0) {
    warnings.push("Forge apiToken is missing, and this base URL cannot use local or Tailscale operator-session bootstrap. Protected writes will fail.");
  }
  if (overviewWarnings.length > 0) {
    warnings.push(...overviewWarnings);
  }
  if (capabilities && capabilities.canReadPsyche === false) {
    warnings.push("The configured token cannot read Psyche state. Sensitive reflection routes and summaries will stay partial.");
  }
  if (capabilities && capabilities.canManageRewards === false) {
    warnings.push("The configured token cannot manage rewards. Reward-rule tuning and manual bonus XP are unavailable.");
  }
  if (uncoveredRoutes.length > 0) {
    warnings.push(`Plugin parity is incomplete for ${uncoveredRoutes.length} stable API route${uncoveredRoutes.length === 1 ? "" : "s"}. Run forge route-check.`);
  }
  return {
    ok: (config.apiToken.trim().length > 0 || canBootstrap) && uncoveredRoutes.length === 0,
    baseUrl: config.baseUrl,
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

async function runReadOnly(config: ForgePluginConfig, path: string) {
  return expectForgeSuccess(
    await callForgeApi({
      baseUrl: config.baseUrl,
      apiToken: config.apiToken,
      actorLabel: config.actorLabel,
      timeoutMs: config.timeoutMs,
      method: "GET",
      path
    })
  );
}

async function runRouteCheck(config: ForgePluginConfig) {
  const openapi = await runReadOnly(config, "/api/v1/openapi.json");
  const pathMap =
    typeof openapi === "object" && openapi !== null && "paths" in openapi && typeof openapi.paths === "object" && openapi.paths !== null
      ? (openapi.paths as Record<string, Record<string, unknown>>)
      : {};
  return buildRouteParityReport(pathMap);
}

export function registerForgePluginCli(api: ForgePluginCliApi, config: ForgePluginConfig) {
  api.registerCli?.(
    ({ program }) => {
      const command = program.command("forge").description("Inspect and operate Forge through the OpenClaw plugin");
      command.command("health").description("Check Forge health").action(createCliAction(config, "/api/v1/health"));
      command.command("context").description("Fetch the Forge operating context").action(createCliAction(config, "/api/v1/context"));
      command.command("overview").description("Fetch the one-shot Forge operator overview").action(createCliAction(config, "/api/v1/operator/overview"));
      command.command("openapi").description("Print the live Forge OpenAPI document").action(createCliAction(config, "/api/v1/openapi.json"));
      command.command("goals").description("List Forge life goals").action(createCliAction(config, "/api/v1/goals"));
      command.command("projects").description("List Forge projects").action(createCliAction(config, "/api/v1/projects"));
      command.command("metrics-xp").description("Inspect Forge XP metrics").action(createCliAction(config, "/api/v1/metrics/xp"));
      command.command("doctor").description("Run plugin connectivity and onboarding diagnostics").action(async () => {
        console.log(JSON.stringify(await runDoctor(config), null, 2));
      });
      command.command("onboarding").description("Print the Forge agent onboarding contract").action(createCliAction(config, "/api/v1/agents/onboarding"));
      command.command("comments").description("List all visible Forge comments").action(createCliAction(config, "/api/v1/comments"));
      command.command("psyche-overview").description("Inspect the Psyche overview read model").action(createCliAction(config, "/api/v1/psyche/overview"));
      command.command("route-check").description("Compare plugin route coverage against the live Forge OpenAPI paths").action(async () => {
        console.log(JSON.stringify(await runRouteCheck(config), null, 2));
      });
    },
    { commands: ["forge"] }
  );
}
