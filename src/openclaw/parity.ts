export type ApiRouteKey = `${Uppercase<string>} ${string}`;

export type ForgeSupportedPluginApiRoute = {
  method: Uppercase<string>;
  path: string;
  purpose:
    | "diagnostics"
    | "overview"
    | "operator_context"
    | "onboarding"
    | "psyche"
    | "xp"
    | "weekly_review"
    | "entities"
    | "work"
    | "insights"
    | "wiki"
    | "health";
};

export const FORGE_SUPPORTED_PLUGIN_API_ROUTES: ForgeSupportedPluginApiRoute[] =
  [
    { method: "GET", path: "/api/v1/health", purpose: "diagnostics" },
    {
      method: "GET",
      path: "/api/v1/users/directory",
      purpose: "operator_context"
    },
    { method: "GET", path: "/api/v1/operator/overview", purpose: "overview" },
    {
      method: "GET",
      path: "/api/v1/operator/context",
      purpose: "operator_context"
    },
    { method: "GET", path: "/api/v1/agents/onboarding", purpose: "onboarding" },
    { method: "GET", path: "/api/v1/psyche/overview", purpose: "psyche" },
    { method: "GET", path: "/api/v1/metrics/xp", purpose: "xp" },
    { method: "GET", path: "/api/v1/reviews/weekly", purpose: "weekly_review" },
    { method: "GET", path: "/api/v1/wiki/settings", purpose: "wiki" },
    { method: "GET", path: "/api/v1/wiki/pages", purpose: "wiki" },
    { method: "GET", path: "/api/v1/wiki/pages/:id", purpose: "wiki" },
    { method: "GET", path: "/api/v1/wiki/health", purpose: "wiki" },
    { method: "POST", path: "/api/v1/wiki/search", purpose: "wiki" },
    { method: "POST", path: "/api/v1/wiki/pages", purpose: "wiki" },
    { method: "PATCH", path: "/api/v1/wiki/pages/:id", purpose: "wiki" },
    { method: "POST", path: "/api/v1/wiki/sync", purpose: "wiki" },
    { method: "POST", path: "/api/v1/wiki/reindex", purpose: "wiki" },
    { method: "POST", path: "/api/v1/wiki/ingest-jobs", purpose: "wiki" },
    { method: "GET", path: "/api/v1/health/sleep", purpose: "health" },
    { method: "PATCH", path: "/api/v1/health/sleep/:id", purpose: "health" },
    { method: "GET", path: "/api/v1/health/fitness", purpose: "health" },
    { method: "PATCH", path: "/api/v1/health/workouts/:id", purpose: "health" },
    { method: "POST", path: "/api/v1/entities/search", purpose: "entities" },
    { method: "POST", path: "/api/v1/entities/create", purpose: "entities" },
    { method: "POST", path: "/api/v1/entities/update", purpose: "entities" },
    { method: "POST", path: "/api/v1/entities/delete", purpose: "entities" },
    { method: "POST", path: "/api/v1/entities/restore", purpose: "entities" },
    { method: "POST", path: "/api/v1/operator/log-work", purpose: "work" },
    { method: "POST", path: "/api/v1/work-adjustments", purpose: "work" },
    { method: "POST", path: "/api/v1/tasks/:id/runs", purpose: "work" },
    { method: "GET", path: "/api/v1/task-runs", purpose: "work" },
    {
      method: "POST",
      path: "/api/v1/task-runs/:id/heartbeat",
      purpose: "work"
    },
    { method: "POST", path: "/api/v1/task-runs/:id/focus", purpose: "work" },
    { method: "POST", path: "/api/v1/task-runs/:id/complete", purpose: "work" },
    { method: "POST", path: "/api/v1/task-runs/:id/release", purpose: "work" },
    { method: "POST", path: "/api/v1/insights", purpose: "insights" }
  ];

export function makeApiRouteKey(method: string, path: string): ApiRouteKey {
  const normalizedPath = path.replaceAll(/\{([^}]+)\}/g, ":$1");
  return `${method.toUpperCase()} ${normalizedPath}` as ApiRouteKey;
}

export function collectSupportedPluginApiRouteKeys() {
  return new Set(
    FORGE_SUPPORTED_PLUGIN_API_ROUTES.map((route) =>
      makeApiRouteKey(route.method, route.path)
    )
  );
}
