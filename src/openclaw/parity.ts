export type ApiRouteKey = `${Uppercase<string>} ${string}`;

export type ForgeSupportedPluginApiRoute = {
  method: Uppercase<string>;
  path: string;
  purpose:
    | "diagnostics"
    | "calendar"
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
    | "health"
    | "preferences"
    | "questionnaires";
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
    { method: "GET", path: "/api/v1/movement/day", purpose: "health" },
    { method: "GET", path: "/api/v1/movement/month", purpose: "health" },
    { method: "GET", path: "/api/v1/movement/all-time", purpose: "health" },
    { method: "GET", path: "/api/v1/movement/timeline", purpose: "health" },
    { method: "GET", path: "/api/v1/movement/places", purpose: "health" },
    { method: "POST", path: "/api/v1/movement/places", purpose: "health" },
    { method: "PATCH", path: "/api/v1/movement/places/:id", purpose: "health" },
    { method: "GET", path: "/api/v1/movement/trips/:id", purpose: "health" },
    { method: "POST", path: "/api/v1/movement/selection", purpose: "health" },
    { method: "GET", path: "/api/v1/movement/settings", purpose: "health" },
    { method: "POST", path: "/api/v1/movement/user-boxes", purpose: "health" },
    {
      method: "POST",
      path: "/api/v1/movement/user-boxes/preflight",
      purpose: "health"
    },
    {
      method: "PATCH",
      path: "/api/v1/movement/user-boxes/:id",
      purpose: "health"
    },
    {
      method: "POST",
      path: "/api/v1/movement/automatic-boxes/:id/invalidate",
      purpose: "health"
    },
    { method: "PATCH", path: "/api/v1/movement/stays/:id", purpose: "health" },
    { method: "PATCH", path: "/api/v1/movement/trips/:id", purpose: "health" },
    {
      method: "PATCH",
      path: "/api/v1/movement/trips/:id/points/:pointId",
      purpose: "health"
    },
    { method: "GET", path: "/api/v1/life-force", purpose: "health" },
    { method: "PATCH", path: "/api/v1/life-force/profile", purpose: "health" },
    {
      method: "PUT",
      path: "/api/v1/life-force/templates/:weekday",
      purpose: "health"
    },
    {
      method: "POST",
      path: "/api/v1/life-force/fatigue-signals",
      purpose: "health"
    },
    { method: "GET", path: "/api/v1/workbench/catalog/boxes", purpose: "work" },
    { method: "GET", path: "/api/v1/workbench/flows", purpose: "work" },
    { method: "POST", path: "/api/v1/workbench/flows", purpose: "work" },
    { method: "GET", path: "/api/v1/workbench/flows/:id", purpose: "work" },
    { method: "PATCH", path: "/api/v1/workbench/flows/:id", purpose: "work" },
    { method: "DELETE", path: "/api/v1/workbench/flows/:id", purpose: "work" },
    {
      method: "GET",
      path: "/api/v1/workbench/flows/by-slug/:slug",
      purpose: "work"
    },
    {
      method: "POST",
      path: "/api/v1/workbench/flows/:id/run",
      purpose: "work"
    },
    { method: "POST", path: "/api/v1/workbench/run", purpose: "work" },
    {
      method: "POST",
      path: "/api/v1/workbench/flows/:id/chat",
      purpose: "work"
    },
    {
      method: "GET",
      path: "/api/v1/workbench/flows/:id/output",
      purpose: "work"
    },
    {
      method: "GET",
      path: "/api/v1/workbench/flows/:id/runs",
      purpose: "work"
    },
    {
      method: "GET",
      path: "/api/v1/workbench/flows/:id/runs/:runId",
      purpose: "work"
    },
    {
      method: "GET",
      path: "/api/v1/workbench/flows/:id/runs/:runId/nodes",
      purpose: "work"
    },
    {
      method: "GET",
      path: "/api/v1/workbench/flows/:id/runs/:runId/nodes/:nodeId",
      purpose: "work"
    },
    {
      method: "GET",
      path: "/api/v1/workbench/flows/:id/nodes/:nodeId/output",
      purpose: "work"
    },
    { method: "GET", path: "/api/v1/calendar/overview", purpose: "calendar" },
    {
      method: "GET",
      path: "/api/v1/calendar/connections",
      purpose: "calendar"
    },
    {
      method: "POST",
      path: "/api/v1/calendar/connections",
      purpose: "calendar"
    },
    {
      method: "POST",
      path: "/api/v1/calendar/connections/:id/sync",
      purpose: "calendar"
    },
    {
      method: "POST",
      path: "/api/v1/calendar/work-block-templates",
      purpose: "calendar"
    },
    {
      method: "POST",
      path: "/api/v1/calendar/timeboxes/recommend",
      purpose: "calendar"
    },
    { method: "POST", path: "/api/v1/calendar/timeboxes", purpose: "calendar" },
    { method: "GET", path: "/api/v1/preferences/workspace", purpose: "preferences" },
    { method: "POST", path: "/api/v1/preferences/game/start", purpose: "preferences" },
    { method: "POST", path: "/api/v1/preferences/catalogs", purpose: "preferences" },
    { method: "PATCH", path: "/api/v1/preferences/catalogs/:id", purpose: "preferences" },
    { method: "DELETE", path: "/api/v1/preferences/catalogs/:id", purpose: "preferences" },
    { method: "POST", path: "/api/v1/preferences/catalog-items", purpose: "preferences" },
    { method: "PATCH", path: "/api/v1/preferences/catalog-items/:id", purpose: "preferences" },
    { method: "DELETE", path: "/api/v1/preferences/catalog-items/:id", purpose: "preferences" },
    { method: "POST", path: "/api/v1/preferences/contexts", purpose: "preferences" },
    { method: "PATCH", path: "/api/v1/preferences/contexts/:id", purpose: "preferences" },
    { method: "POST", path: "/api/v1/preferences/contexts/merge", purpose: "preferences" },
    { method: "POST", path: "/api/v1/preferences/items", purpose: "preferences" },
    { method: "PATCH", path: "/api/v1/preferences/items/:id", purpose: "preferences" },
    { method: "POST", path: "/api/v1/preferences/items/from-entity", purpose: "preferences" },
    { method: "POST", path: "/api/v1/preferences/judgments", purpose: "preferences" },
    { method: "POST", path: "/api/v1/preferences/signals", purpose: "preferences" },
    { method: "PATCH", path: "/api/v1/preferences/items/:id/score", purpose: "preferences" },
    { method: "GET", path: "/api/v1/psyche/questionnaires", purpose: "questionnaires" },
    { method: "POST", path: "/api/v1/psyche/questionnaires", purpose: "questionnaires" },
    { method: "GET", path: "/api/v1/psyche/questionnaires/:id", purpose: "questionnaires" },
    { method: "POST", path: "/api/v1/psyche/questionnaires/:id/clone", purpose: "questionnaires" },
    { method: "POST", path: "/api/v1/psyche/questionnaires/:id/draft", purpose: "questionnaires" },
    { method: "PATCH", path: "/api/v1/psyche/questionnaires/:id/draft", purpose: "questionnaires" },
    { method: "POST", path: "/api/v1/psyche/questionnaires/:id/publish", purpose: "questionnaires" },
    { method: "POST", path: "/api/v1/psyche/questionnaires/:id/runs", purpose: "questionnaires" },
    { method: "GET", path: "/api/v1/psyche/questionnaire-runs/:id", purpose: "questionnaires" },
    { method: "PATCH", path: "/api/v1/psyche/questionnaire-runs/:id", purpose: "questionnaires" },
    { method: "POST", path: "/api/v1/psyche/questionnaire-runs/:id/complete", purpose: "questionnaires" },
    { method: "GET", path: "/api/v1/psyche/self-observation/calendar", purpose: "questionnaires" },
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
