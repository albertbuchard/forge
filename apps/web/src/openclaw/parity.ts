import { WORK_ROUTE_SPECS } from "./tools.js";

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
    | "movement"
    | "life_force"
    | "workbench"
    | "courses"
    | "attention"
    | "entity_navigation"
    | "artifact"
    | "life_event"
    | "preferences"
    | "questionnaires";
};

type UnknownRecord = Record<string, unknown>;

const REQUIRED_MIRRORED_SPECIALIZED_DOMAIN_SURFACES = new Set([
  "attention",
  "entityNavigation",
  "lifeEvents",
  "movement",
  "lifeForce",
  "life_force",
  "work",
  "workbench",
  "courses"
]);

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
    {
      method: "GET",
      path: "/api/v1/today/priority",
      purpose: "operator_context"
    },
    { method: "GET", path: "/api/v1/agents/onboarding", purpose: "onboarding" },
    { method: "GET", path: "/api/v1/doctor", purpose: "diagnostics" },
    { method: "POST", path: "/api/v1/doctor/fixes", purpose: "diagnostics" },
    { method: "GET", path: "/api/v1/psyche/overview", purpose: "psyche" },
    { method: "GET", path: "/api/v1/psyche/schema-catalog", purpose: "psyche" },
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
    { method: "GET", path: "/api/v1/health/training-load", purpose: "health" },
    { method: "PATCH", path: "/api/v1/health/workouts/:id", purpose: "health" },
    { method: "GET", path: "/api/v1/movement/day", purpose: "movement" },
    { method: "GET", path: "/api/v1/movement/month", purpose: "movement" },
    { method: "GET", path: "/api/v1/movement/all-time", purpose: "movement" },
    { method: "GET", path: "/api/v1/movement/timeline", purpose: "movement" },
    { method: "GET", path: "/api/v1/movement/places", purpose: "movement" },
    { method: "GET", path: "/api/v1/movement/boxes/:id", purpose: "movement" },
    { method: "POST", path: "/api/v1/movement/places", purpose: "movement" },
    {
      method: "PATCH",
      path: "/api/v1/movement/places/:id",
      purpose: "movement"
    },
    { method: "GET", path: "/api/v1/movement/trips/:id", purpose: "movement" },
    { method: "POST", path: "/api/v1/movement/selection", purpose: "movement" },
    { method: "GET", path: "/api/v1/movement/settings", purpose: "movement" },
    { method: "PATCH", path: "/api/v1/movement/settings", purpose: "movement" },
    {
      method: "POST",
      path: "/api/v1/movement/user-boxes",
      purpose: "movement"
    },
    {
      method: "POST",
      path: "/api/v1/movement/user-boxes/preflight",
      purpose: "movement"
    },
    {
      method: "PATCH",
      path: "/api/v1/movement/user-boxes/:id",
      purpose: "movement"
    },
    {
      method: "DELETE",
      path: "/api/v1/movement/user-boxes/:id",
      purpose: "movement"
    },
    {
      method: "POST",
      path: "/api/v1/movement/automatic-boxes/:id/invalidate",
      purpose: "movement"
    },
    {
      method: "PATCH",
      path: "/api/v1/movement/stays/:id",
      purpose: "movement"
    },
    {
      method: "DELETE",
      path: "/api/v1/movement/stays/:id",
      purpose: "movement"
    },
    {
      method: "PATCH",
      path: "/api/v1/movement/trips/:id",
      purpose: "movement"
    },
    {
      method: "DELETE",
      path: "/api/v1/movement/trips/:id",
      purpose: "movement"
    },
    {
      method: "PATCH",
      path: "/api/v1/movement/trips/:id/points/:pointId",
      purpose: "movement"
    },
    {
      method: "DELETE",
      path: "/api/v1/movement/trips/:id/points/:pointId",
      purpose: "movement"
    },
    { method: "GET", path: "/api/v1/life-force", purpose: "life_force" },
    {
      method: "PATCH",
      path: "/api/v1/life-force/profile",
      purpose: "life_force"
    },
    {
      method: "PUT",
      path: "/api/v1/life-force/templates/:weekday",
      purpose: "life_force"
    },
    {
      method: "POST",
      path: "/api/v1/life-force/fatigue-signals",
      purpose: "life_force"
    },
    {
      method: "GET",
      path: "/api/v1/workbench/catalog/boxes",
      purpose: "workbench"
    },
    { method: "GET", path: "/api/v1/workbench/flows", purpose: "workbench" },
    { method: "POST", path: "/api/v1/workbench/flows", purpose: "workbench" },
    {
      method: "GET",
      path: "/api/v1/workbench/flows/:id",
      purpose: "workbench"
    },
    {
      method: "PATCH",
      path: "/api/v1/workbench/flows/:id",
      purpose: "workbench"
    },
    {
      method: "DELETE",
      path: "/api/v1/workbench/flows/:id",
      purpose: "workbench"
    },
    {
      method: "GET",
      path: "/api/v1/workbench/flows/:id/versions",
      purpose: "workbench"
    },
    {
      method: "GET",
      path: "/api/v1/workbench/flows/:id/versions/:revision",
      purpose: "workbench"
    },
    {
      method: "POST",
      path: "/api/v1/workbench/flows/:id/restore",
      purpose: "workbench"
    },
    {
      method: "GET",
      path: "/api/v1/workbench/flows/by-slug/:slug",
      purpose: "workbench"
    },
    {
      method: "POST",
      path: "/api/v1/workbench/flows/:id/run",
      purpose: "workbench"
    },
    { method: "POST", path: "/api/v1/workbench/run", purpose: "workbench" },
    {
      method: "POST",
      path: "/api/v1/workbench/flows/:id/chat",
      purpose: "workbench"
    },
    {
      method: "GET",
      path: "/api/v1/workbench/flows/:id/output",
      purpose: "workbench"
    },
    {
      method: "GET",
      path: "/api/v1/workbench/flows/:id/runs",
      purpose: "workbench"
    },
    {
      method: "GET",
      path: "/api/v1/workbench/flows/:id/runs/:runId",
      purpose: "workbench"
    },
    {
      method: "POST",
      path: "/api/v1/workbench/flows/:id/runs/:runId/cancel",
      purpose: "workbench"
    },
    {
      method: "GET",
      path: "/api/v1/workbench/flows/:id/runs/:runId/nodes",
      purpose: "workbench"
    },
    {
      method: "GET",
      path: "/api/v1/workbench/flows/:id/runs/:runId/nodes/:nodeId",
      purpose: "workbench"
    },
    {
      method: "GET",
      path: "/api/v1/workbench/flows/:id/nodes/:nodeId/output",
      purpose: "workbench"
    },
    { method: "GET", path: "/api/v1/courses", purpose: "courses" },
    { method: "POST", path: "/api/v1/courses/import", purpose: "courses" },
    {
      method: "GET",
      path: "/api/v1/courses/:courseId/export",
      purpose: "courses"
    },
    {
      method: "GET",
      path: "/api/v1/courses/:courseId",
      purpose: "courses"
    },
    {
      method: "GET",
      path: "/api/v1/courses/:courseId/learn",
      purpose: "courses"
    },
    {
      method: "POST",
      path: "/api/v1/courses/:courseId/voice-session",
      purpose: "courses"
    },
    {
      method: "POST",
      path: "/api/v1/courses/:courseId/lessons/:lessonId/activities/:activityId/attempts",
      purpose: "courses"
    },
    {
      method: "POST",
      path: "/api/v1/courses/:courseId/upgrade",
      purpose: "courses"
    },
    { method: "GET", path: "/api/v1/concepts", purpose: "courses" },
    {
      method: "GET",
      path: "/api/v1/concepts/:conceptId",
      purpose: "courses"
    },
    { method: "GET", path: "/api/v1/attention-inbox", purpose: "attention" },
    {
      method: "POST",
      path: "/api/v1/attention-inbox/:id/snooze",
      purpose: "attention"
    },
    {
      method: "POST",
      path: "/api/v1/attention-inbox/:id/dismiss",
      purpose: "attention"
    },
    {
      method: "POST",
      path: "/api/v1/attention-inbox/:id/restore",
      purpose: "attention"
    },
    {
      method: "GET",
      path: "/api/v1/entity-navigation",
      purpose: "entity_navigation"
    },
    {
      method: "POST",
      path: "/api/v1/entity-navigation/touch",
      purpose: "entity_navigation"
    },
    { method: "GET", path: "/api/v1/artifacts", purpose: "artifact" },
    { method: "POST", path: "/api/v1/artifacts", purpose: "artifact" },
    { method: "GET", path: "/api/v1/artifacts/:id", purpose: "artifact" },
    { method: "PATCH", path: "/api/v1/artifacts/:id", purpose: "artifact" },
    { method: "POST", path: "/api/v1/artifacts/:id/scan", purpose: "artifact" },
    {
      method: "POST",
      path: "/api/v1/artifacts/:id/enrich",
      purpose: "artifact"
    },
    {
      method: "POST",
      path: "/api/v1/artifacts/:id/links",
      purpose: "artifact"
    },
    {
      method: "POST",
      path: "/api/v1/artifacts/:id/trust",
      purpose: "artifact"
    },
    {
      method: "GET",
      path: "/api/v1/artifacts/:id/versions",
      purpose: "artifact"
    },
    { method: "GET", path: "/api/v1/artifacts/:id/audit", purpose: "artifact" },
    {
      method: "GET",
      path: "/api/v1/life-events/timeline",
      purpose: "life_event"
    },
    { method: "GET", path: "/api/v1/life-events/:id", purpose: "life_event" },
    {
      method: "POST",
      path: "/api/v1/life-events/:id/calendar-sync",
      purpose: "life_event"
    },
    {
      method: "POST",
      path: "/api/v1/life-events/from-calendar-event",
      purpose: "life_event"
    },
    {
      method: "POST",
      path: "/api/v1/life-events/import-ticket",
      purpose: "life_event"
    },
    {
      method: "GET",
      path: "/api/v1/life-events/:id/travel-status",
      purpose: "life_event"
    },
    { method: "GET", path: "/api/v1/calendar/overview", purpose: "calendar" },
    {
      method: "GET",
      path: "/api/v1/calendar/macos-local/discovery",
      purpose: "calendar"
    },
    {
      method: "POST",
      path: "/api/v1/calendar/discovery",
      purpose: "calendar"
    },
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
      method: "PATCH",
      path: "/api/v1/calendar/connections/:id",
      purpose: "calendar"
    },
    {
      method: "DELETE",
      path: "/api/v1/calendar/connections/:id",
      purpose: "calendar"
    },
    {
      method: "GET",
      path: "/api/v1/calendar/connections/:id/discovery",
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
    {
      method: "GET",
      path: "/api/v1/preferences/workspace",
      purpose: "preferences"
    },
    {
      method: "POST",
      path: "/api/v1/preferences/game/start",
      purpose: "preferences"
    },
    {
      method: "POST",
      path: "/api/v1/preferences/catalogs",
      purpose: "preferences"
    },
    {
      method: "PATCH",
      path: "/api/v1/preferences/catalogs/:id",
      purpose: "preferences"
    },
    {
      method: "DELETE",
      path: "/api/v1/preferences/catalogs/:id",
      purpose: "preferences"
    },
    {
      method: "POST",
      path: "/api/v1/preferences/catalog-items",
      purpose: "preferences"
    },
    {
      method: "PATCH",
      path: "/api/v1/preferences/catalog-items/:id",
      purpose: "preferences"
    },
    {
      method: "DELETE",
      path: "/api/v1/preferences/catalog-items/:id",
      purpose: "preferences"
    },
    {
      method: "POST",
      path: "/api/v1/preferences/contexts",
      purpose: "preferences"
    },
    {
      method: "PATCH",
      path: "/api/v1/preferences/contexts/:id",
      purpose: "preferences"
    },
    {
      method: "POST",
      path: "/api/v1/preferences/contexts/merge",
      purpose: "preferences"
    },
    {
      method: "POST",
      path: "/api/v1/preferences/items",
      purpose: "preferences"
    },
    {
      method: "PATCH",
      path: "/api/v1/preferences/items/:id",
      purpose: "preferences"
    },
    {
      method: "POST",
      path: "/api/v1/preferences/items/from-entity",
      purpose: "preferences"
    },
    {
      method: "POST",
      path: "/api/v1/preferences/judgments",
      purpose: "preferences"
    },
    {
      method: "POST",
      path: "/api/v1/preferences/signals",
      purpose: "preferences"
    },
    {
      method: "PATCH",
      path: "/api/v1/preferences/items/:id/score",
      purpose: "preferences"
    },
    {
      method: "GET",
      path: "/api/v1/psyche/questionnaires",
      purpose: "questionnaires"
    },
    {
      method: "POST",
      path: "/api/v1/psyche/questionnaires",
      purpose: "questionnaires"
    },
    {
      method: "GET",
      path: "/api/v1/psyche/questionnaires/:id",
      purpose: "questionnaires"
    },
    {
      method: "POST",
      path: "/api/v1/psyche/questionnaires/:id/clone",
      purpose: "questionnaires"
    },
    {
      method: "POST",
      path: "/api/v1/psyche/questionnaires/:id/draft",
      purpose: "questionnaires"
    },
    {
      method: "PATCH",
      path: "/api/v1/psyche/questionnaires/:id/draft",
      purpose: "questionnaires"
    },
    {
      method: "POST",
      path: "/api/v1/psyche/questionnaires/:id/publish",
      purpose: "questionnaires"
    },
    {
      method: "POST",
      path: "/api/v1/psyche/questionnaires/:id/runs",
      purpose: "questionnaires"
    },
    {
      method: "GET",
      path: "/api/v1/psyche/questionnaire-runs/:id",
      purpose: "questionnaires"
    },
    {
      method: "PATCH",
      path: "/api/v1/psyche/questionnaire-runs/:id",
      purpose: "questionnaires"
    },
    {
      method: "POST",
      path: "/api/v1/psyche/questionnaire-runs/:id/complete",
      purpose: "questionnaires"
    },
    {
      method: "GET",
      path: "/api/v1/psyche/self-observation/calendar",
      purpose: "questionnaires"
    },
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
    ...Object.values(WORK_ROUTE_SPECS).map((spec) => ({
      method: spec.method,
      path: spec.path,
      purpose: "work" as const
    })),
    { method: "POST", path: "/api/v1/insights", purpose: "insights" }
  ];

export function makeApiRouteKey(method: string, path: string): ApiRouteKey {
  const normalizedPath = path.replaceAll(/\{([^}]+)\}/g, ":$1");
  return `${method.toUpperCase()} ${normalizedPath}` as ApiRouteKey;
}

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : null;
}

function getOnboardingRouteModel(payload: unknown): UnknownRecord | null {
  const payloadRecord = asRecord(payload);
  const onboarding = asRecord(payloadRecord?.onboarding) ?? payloadRecord;
  return asRecord(onboarding?.entityRouteModel);
}

function addMethodRoute(target: Set<ApiRouteKey>, value: unknown) {
  if (typeof value === "string") {
    const match = /^([A-Za-z]+)\s+(.+)$/.exec(value.trim());
    if (match) {
      target.add(makeApiRouteKey(match[1], match[2]));
    }
    return;
  }

  const route = asRecord(value);
  if (typeof route?.method === "string" && typeof route.path === "string") {
    target.add(makeApiRouteKey(route.method, route.path));
  }
}

function addEntityMethodRoutes(
  target: Set<ApiRouteKey>,
  entityMap: unknown,
  includedNames?: Set<string>
) {
  const entities = asRecord(entityMap);
  if (!entities) {
    return;
  }

  for (const [name, value] of Object.entries(entities)) {
    if (includedNames && !includedNames.has(name)) {
      continue;
    }
    const methodRoutes = asRecord(asRecord(value)?.methodRoutes);
    if (!methodRoutes) {
      continue;
    }
    for (const methodRoute of Object.values(methodRoutes)) {
      addMethodRoute(target, methodRoute);
    }
  }
}

function addBatchRoutes(target: Set<ApiRouteKey>, routeModel: UnknownRecord) {
  const batchRoutes = asRecord(routeModel.batchRoutes);
  if (!batchRoutes) {
    return;
  }
  for (const path of Object.values(batchRoutes)) {
    if (typeof path === "string") {
      target.add(makeApiRouteKey("POST", path));
    }
  }
}

export function collectPublishedOnboardingApiRouteKeys(payload: unknown) {
  const routes = new Set<ApiRouteKey>();
  const routeModel = getOnboardingRouteModel(payload);
  if (!routeModel) {
    return routes;
  }

  addBatchRoutes(routes, routeModel);
  addEntityMethodRoutes(routes, routeModel.specializedCrudEntities);
  addEntityMethodRoutes(routes, routeModel.actionEntities);
  addEntityMethodRoutes(routes, routeModel.specializedDomainSurfaces);

  const readModels = asRecord(routeModel.readModelOnlySurfaces);
  if (readModels) {
    for (const path of Object.values(readModels)) {
      if (typeof path === "string") {
        routes.add(makeApiRouteKey("GET", path));
      }
    }
  }

  return routes;
}

export function collectRequiredMirroredOnboardingApiRouteKeys(
  payload: unknown
) {
  const routes = new Set<ApiRouteKey>();
  const routeModel = getOnboardingRouteModel(payload);
  if (!routeModel) {
    return routes;
  }

  addBatchRoutes(routes, routeModel);
  addEntityMethodRoutes(routes, routeModel.actionEntities);
  addEntityMethodRoutes(
    routes,
    routeModel.specializedDomainSurfaces,
    REQUIRED_MIRRORED_SPECIALIZED_DOMAIN_SURFACES
  );
  return routes;
}

export function collectSupportedPluginApiRouteKeys() {
  return new Set(
    FORGE_SUPPORTED_PLUGIN_API_ROUTES.map((route) =>
      makeApiRouteKey(route.method, route.path)
    )
  );
}
