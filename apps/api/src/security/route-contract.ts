import {
  FORGE_SECURITY_CONTRACT_VERSION,
  type RouteProtocolVerifier,
  type RouteSecurityClass,
  type RouteSecurityContract
} from "./contracts.js";
import { PEER_ROUTE_CONTRACTS, peerRouteKey } from "../peer-route-contract.js";
import {
  COMPANION_BOOTSTRAP_ACTION,
  isCompanionBootstrapRoute
} from "./companion-bootstrap-grant.js";

export type RouteRegistration = {
  method: string;
  routePath: string;
  sourceFile?: string;
  sourceLine?: number;
  explicitBodyLimit?: number;
};

const DATA_FREE_PUBLIC_ROUTES = new Set([
  "GET /api/health",
  "HEAD /api/health",
  "GET /",
  "HEAD /",
  "GET /*",
  "HEAD /*",
  "GET /__forge-ui-root-redirect",
  "HEAD /__forge-ui-root-redirect",
  "GET /__forge-ui-base-redirect",
  "HEAD /__forge-ui-base-redirect"
]);

const BOUNDED_AUTH_PROTOCOL_ROUTES = new Set([
  "POST /api/v1/auth/device",
  "POST /api/v1/auth/device/cancel",
  "POST /api/v1/auth/token",
  "POST /api/v1/auth/browser/refresh",
  "POST /api/v1/auth/local/begin",
  "POST /api/v1/auth/local/exchange",
  "POST /api/v1/auth/local/browser/begin",
  "POST /api/v1/auth/local/browser/challenge",
  "POST /api/v1/auth/local/browser/exchange",
  "POST /api/v1/mobile/pairing/verify"
]);

const VERIFIED_COMPANION_PROTOCOL_ROUTES = new Set([
  "POST /api/v1/mobile/pairing/heartbeat",
  "POST /api/v1/mobile/movement/bootstrap",
  "POST /api/v1/mobile/source-state",
  "POST /api/v1/mobile/movement/places",
  "POST /api/v1/mobile/movement/timeline",
  "POST /api/v1/mobile/movement/boxes/:id/detail",
  "POST /api/v1/mobile/movement/user-boxes",
  "POST /api/v1/mobile/movement/user-boxes/preflight",
  "PATCH /api/v1/mobile/movement/user-boxes/:id",
  "DELETE /api/v1/mobile/movement/user-boxes/:id",
  "POST /api/v1/mobile/movement/automatic-boxes/:id/invalidate",
  "PATCH /api/v1/mobile/movement/stays/:id",
  "PATCH /api/v1/mobile/movement/trips/:id",
  "POST /api/v1/mobile/watch/bootstrap",
  "POST /api/v1/mobile/watch/habits/:id/check-ins",
  "POST /api/v1/mobile/watch/capture-events:batch",
  "POST /api/v1/mobile/watch/actions:batch",
  "POST /api/v1/mobile/healthkit/sync-sessions",
  "GET /api/v1/mobile/healthkit/sync-sessions/:id",
  "POST /api/v1/mobile/healthkit/sync-sessions/:id/chunks",
  "POST /api/v1/mobile/healthkit/sync-sessions/:id/complete",
  "DELETE /api/v1/mobile/healthkit/sync-sessions/:id",
  "POST /api/v1/mobile/healthkit/sync"
]);

const VERIFIED_PEER_PROTOCOL_ROUTES = new Set(
  PEER_ROUTE_CONTRACTS.filter(
    (contract) =>
      contract.principalClasses.includes("companion_session") ||
      contract.principalClasses.includes("companion_consent")
  ).map(peerRouteKey)
);

const MIXED_PEER_PROTOCOL_ROUTES = new Set(
  PEER_ROUTE_CONTRACTS.filter(
    (contract) =>
      contract.principalClasses.includes("operator_session") &&
      (contract.principalClasses.includes("companion_session") ||
        contract.principalClasses.includes("companion_consent"))
  ).map(peerRouteKey)
);

const LEGACY_SCOPE_COMPATIBILITY = new Map<string, readonly string[]>([
  ["POST /api/v1/entities/create", ["write"]],
  ["GET /api/v1/artifacts", ["artifact.readMetadata"]],
  ["POST /api/v1/artifacts", ["artifact.create", "artifact.uploadBytes"]],
  ["GET /api/v1/artifacts/:id", ["artifact.readMetadata"]],
  ["PATCH /api/v1/artifacts/:id", ["artifact.updateMetadata"]],
  ["POST /api/v1/artifacts/:id/scan", ["artifact.updateMetadata"]],
  [
    "POST /api/v1/artifacts/:id/enrich",
    ["artifact.updateMetadata", "artifact.enrichWithLlm"]
  ],
  [
    "POST /api/v1/artifacts/:id/links",
    ["artifact.updateMetadata", "artifact.link"]
  ],
  [
    "POST /api/v1/artifacts/:id/trust",
    ["artifact.manageTrust", "artifact.overrideQuarantine"]
  ],
  ["GET /api/v1/artifacts/:id/versions", ["artifact.readMetadata"]],
  ["GET /api/v1/artifacts/:id/audit", ["artifact.readMetadata"]],
  ["POST /api/v1/entities/search", ["read"]],
  ["POST /api/v1/entities/update", ["write"]],
  ["POST /api/v1/entities/delete", ["write"]],
  ["POST /api/v1/entities/restore", ["write"]],
  ["GET /api/v1/events/stream", ["read"]],
  ["GET /api/v1/context", ["read", "write"]],
  ["GET /api/v1/operator/context", ["read", "write"]],
  ["GET /api/v1/operator/overview", ["read", "write"]],
  ["GET /api/dashboard", ["read", "write"]],
  ["GET /api/openclaw/context", ["read", "write"]],
  ["GET /api/context/overview", ["read", "write"]],
  ["POST /api/v1/tasks/:id/runs", ["write"]],
  ["POST /api/v1/tasks/:id/split", ["write"]],
  ["GET /api/v1/task-runs", ["read"]],
  ["GET /api/v1/comparisons/catalog", ["read"]],
  ["GET /api/v1/comparisons", ["read"]],
  ["POST /api/v1/task-runs/:id/heartbeat", ["write"]],
  ["POST /api/v1/task-runs/:id/release", ["write"]],
  ["POST /api/v1/task-runs/:id/focus", ["write"]],
  ["POST /api/v1/task-runs/:id/complete", ["write"]],
  ["GET /api/v1/psyche/overview", ["psyche.read", "psyche.write"]],
  [
    "POST /api/v1/psyche/questionnaires/:id/runs",
    ["psyche.write", "psyche.read"]
  ],
  ["GET /api/v1/psyche/questionnaire-runs/:id", ["psyche.read"]],
  ["PATCH /api/v1/psyche/questionnaire-runs/:id", ["psyche.write"]],
  [
    "POST /api/v1/psyche/questionnaire-runs/:id/complete",
    ["psyche.write"]
  ],
  ["GET /api/v1/settings", ["read"]],
  ["POST /api/v1/insights", ["write", "insights"]],
  ["POST /api/v1/insights/:id/feedback", ["write", "insights"]],
  ["POST /api/v1/agent-actions", ["write"]],
  ["POST /api/v1/agents/sessions/:id/disconnect", ["write"]],
  ["POST /api/v1/life-events/import-ticket", ["write"]],
  ["GET /api/v1/attention-inbox", ["read"]],
  ["POST /api/v1/attention-inbox/:id/snooze", ["write"]],
  ["GET /api/v1/mutation-receipts", ["read"]],
  ["POST /api/v1/mutation-receipts/:id/undo", ["write"]],
  ["GET /api/v1/entity-navigation", ["read"]],
  ["POST /api/v1/entity-navigation/touch", ["write"]],
  ["POST /api/v1/habits", ["write"]],
  ["GET /api/v1/habits", ["read"]],
  ["GET /api/v1/habits/:id", ["read"]],
  ["PATCH /api/v1/habits/:id", ["write"]],
  ["DELETE /api/v1/habits/:id", ["write"]],
  ["POST /api/v1/health/weight-loss/body-checkins", ["write"]],
  ["POST /api/v1/health/weight-loss/appearance-checkins", ["write"]],
  ["POST /api/v1/health/weight-loss/food-logs", ["write"]],
  ["GET /api/v1/health/fitness", ["read"]],
  ["GET /api/v1/health/workouts/:id/detail", ["read"]],
  ["GET /api/v1/notes", ["read"]],
  ["POST /api/v1/notes", ["write"]],
  ["GET /api/v1/notes/:id", ["read"]],
  ["PATCH /api/v1/notes/:id", ["write"]],
  ["DELETE /api/v1/notes/:id", ["write"]],
  ["POST /api/v1/calendar/timeboxes/recommend", ["read", "write"]],
  ["POST /api/v1/calendar/timeboxes", ["write"]],
  ["GET /api/v1/calendar/timeboxes", ["read"]],
  ["GET /api/v1/calendar/timeboxes/:id", ["read"]],
  ["PATCH /api/v1/calendar/timeboxes/:id", ["write"]],
  ["DELETE /api/v1/calendar/timeboxes/:id", ["write"]],
  ["GET /api/v1/projects", ["read"]],
  ["GET /api/v1/tasks", ["read"]],
  ["GET /api/tasks", ["read"]],
  ["GET /api/v1/work-items", ["read"]],
  ["PATCH /api/v1/goals/:id", ["write"]],
  ["GET /api/v1/projects/:id", ["read"]],
  ["PATCH /api/v1/projects/:id", ["write"]],
  ["DELETE /api/v1/projects/:id", ["write"]],
  ["GET /api/v1/tasks/:id", ["read"]],
  ["PATCH /api/v1/tasks/:id", ["write"]],
  ["DELETE /api/v1/tasks/:id", ["write"]],
  ["GET /api/tasks/:id", ["read"]],
  ["PATCH /api/tasks/:id", ["write"]],
  ["GET /api/v1/work-items/:id", ["read"]],
  ["PATCH /api/v1/work-items/:id", ["write"]],
  ["DELETE /api/v1/work-items/:id", ["write"]],
  ["GET /api/v1/preferences/catalogs/:id", ["read"]],
  ["PATCH /api/v1/preferences/catalogs/:id", ["write"]],
  ["GET /api/v1/preferences/workspace", ["read"]],
  ["POST /api/v1/preferences/workspace/refresh", ["write"]],
  ["POST /api/v1/preferences/items/from-entity", ["write"]],
  ["PATCH /api/v1/preferences/items/:id/score", ["write"]],
  ["GET /api/v1/knowledge-graph", ["read"]],
  ["GET /api/v1/knowledge-graph/focus", ["read"]],
  ["GET /api/v1/activity", ["read"]],
  ["GET /api/v1/projects/:id/board", ["read"]],
  ["GET /api/v1/tasks/:id/context", ["read"]],
  ["GET /api/v1/work-items/:id/context", ["read"]],
  ["POST /api/v1/habits/:id/check-ins", ["write"]],
  ["PATCH /api/v1/health/weight-loss/food-logs/:id", ["write"]],
  ["POST /api/v1/wiki/pages", ["write"]],
  ["PATCH /api/v1/wiki/pages/:id", ["write"]],
  ["DELETE /api/v1/wiki/pages/:id", ["write"]],
  [
    "GET /api/v1/agents/onboarding",
    ["read", "write", "psyche.read", "psyche.write"]
  ],
  ["POST /api/v1/psyche/event-types", ["psyche.write"]],
  ["GET /api/v1/psyche/event-types", ["psyche.read", "psyche.write"]],
  ["GET /api/v1/psyche/event-types/:id", ["psyche.read", "psyche.write"]],
  ["PATCH /api/v1/psyche/event-types/:id", ["psyche.write"]],
  ["DELETE /api/v1/psyche/event-types/:id", ["psyche.write"]],
  ["POST /api/v1/psyche/emotions", ["psyche.write"]],
  ["GET /api/v1/psyche/emotions", ["psyche.read", "psyche.write"]],
  ["GET /api/v1/psyche/emotions/:id", ["psyche.read", "psyche.write"]],
  ["PATCH /api/v1/psyche/emotions/:id", ["psyche.write"]],
  ["DELETE /api/v1/psyche/emotions/:id", ["psyche.write"]],
  ["GET /api/v1/today/priority", ["read", "write"]],
  ["GET /api/v1/psyche/reports", ["psyche.read", "psyche.write"]],
  ["POST /api/v1/psyche/reports", ["psyche.write"]],
  ["GET /api/v1/psyche/reports/:id", ["psyche.read", "psyche.write"]],
  ["PATCH /api/v1/psyche/reports/:id", ["psyche.write"]],
  ["DELETE /api/v1/psyche/reports/:id", ["psyche.write"]],
  ["GET /api/v1/metrics", ["read"]],
  ["GET /api/v1/metrics/xp", ["read"]],
  ["GET /api/v1/gamification/assets", ["read"]],
  ["GET /api/v1/gamification/catalog", ["read"]],
  ["GET /api/v1/gamification/equipment", ["read"]],
  ["POST /api/v1/gamification/reconcile", ["write", "rewards.manage"]],
  ["PATCH /api/v1/rewards/rules/:id", ["write", "rewards.manage"]],
  ["POST /api/v1/rewards/bonus", ["write", "rewards.manage"]],
  ["POST /api/v1/work-adjustments", ["write", "rewards.manage"]],
  ["POST /api/v1/operator/log-work", ["write", "rewards.manage"]],
  ["GET /api/v1/preferences/contexts", ["read"]],
  ["GET /api/v1/preferences/contexts/:id", ["read"]],
  ["POST /api/v1/preferences/contexts", ["write"]],
  ["PATCH /api/v1/preferences/contexts/:id", ["write"]],
  ["GET /api/v1/preferences/items", ["read"]],
  ["GET /api/v1/preferences/items/:id", ["read"]],
  ["POST /api/v1/preferences/items", ["write"]],
  ["PATCH /api/v1/preferences/items/:id", ["write"]],
  ["POST /api/v1/preferences/catalogs", ["write"]],
  ["POST /api/v1/preferences/game/start", ["write"]],
  ["GET /api/v1/preferences/catalogs", ["read"]],
  ["GET /api/v1/preferences/catalog-items", ["read"]],
  ["POST /api/v1/preferences/judgments", ["write"]],
  ["POST /api/v1/preferences/signals", ["write"]],
  ["GET /api/v1/wiki/spaces", ["read"]],
  ["GET /api/v1/wiki/pages", ["read"]],
  ["GET /api/v1/wiki/pages/:id", ["read"]],
  ["POST /api/v1/wiki/search", ["read"]],
  ["GET /api/v1/wiki/health", ["read"]],
  ["POST /api/v1/wiki/sync", ["write"]],
  ["POST /api/v1/wiki/reindex", ["write"]],
  ["POST /api/v1/wiki/ingest-jobs", ["write"]],
  ["POST /api/v1/wiki/ingest-jobs/uploads", ["write"]],
  ["GET /api/v1/wiki/ingest-jobs", ["read"]],
  ["GET /api/v1/wiki/ingest-jobs/:id", ["read"]],
  ["POST /api/v1/wiki/ingest-jobs/:id/rerun", ["write"]],
  ["POST /api/v1/wiki/ingest-jobs/:id/resume", ["write"]],
  ["DELETE /api/v1/wiki/ingest-jobs/:id", ["write"]],
  ["POST /api/v1/wiki/ingest-jobs/:id/review", ["write"]],
  ["GET /api/v1/movement/day", ["read"]],
  ["GET /api/v1/movement/places", ["read"]],
  ["GET /api/v1/movement/trips/:id", ["read"]],
  ["PATCH /api/v1/movement/places/:id", ["write"]],
  ["PATCH /api/v1/movement/stays/:id", ["write"]],
  ["DELETE /api/v1/movement/stays/:id", ["write"]],
  ["PATCH /api/v1/movement/trips/:id", ["write"]],
  ["DELETE /api/v1/movement/trips/:id", ["write"]],
  ["PATCH /api/v1/movement/trips/:id/points/:pointId", ["write"]],
  ["DELETE /api/v1/movement/trips/:id/points/:pointId", ["write"]]
]);

const REVIEWED_BODY_LIMIT_OVERRIDES = new Map<string, number>([
  ["POST /api/v1/artifacts", 150 * 1024 * 1024],
  ["POST /api/v1/mobile/healthkit/sync-sessions/:id/chunks", 40_000_000],
  ["POST /api/v1/mobile/healthkit/sync", 8_000_000],
  ["POST /api/v1/offline-mutations/task-status", 16 * 1024],
  ["POST /api/v1/attention-inbox/:id/actions/start", 4 * 1024],
  ["POST /api/v1/attention-resolutions/check", 1024],
  ["POST /api/v1/courses/import", 12 * 1024 * 1024]
]);

const EXACT_ROUTE_OPERATIONS = new Map<string, string>([
  ["POST /api/v1/offline-mutations/task-status", "update"],
  ["POST /api/v1/attention-inbox/:id/actions/start", "start"],
  ["POST /api/v1/attention-resolutions/check", "check"]
]);

function normalizeMethod(method: string) {
  return method.trim().toUpperCase();
}

function normalizeRoutePath(routePath: string) {
  const trimmed = routePath.trim();
  if (trimmed === "/") {
    return trimmed;
  }
  return trimmed.replace(/\/+$/, "");
}

function resourceForRoute(routePath: string) {
  const template = routePath
    .split("/")
    .map((segment) => {
      if (segment === "*") {
        return "{wildcard}";
      }
      if (segment.startsWith(":")) {
        const parameter = segment
          .slice(1)
          .replace(/\([^)]*\)/g, "")
          .replace(/[^a-zA-Z0-9_]/g, "");
        return `{${parameter || "id"}}`;
      }
      return segment.replaceAll(":", "%3A");
    })
    .join("/");
  return `forge://route${template.startsWith("/") ? "" : "/"}${template}`;
}

function actionNamespaceForRoute(routePath: string) {
  const segments = routePath
    .split("/")
    .filter(Boolean)
    .filter((segment) => !segment.startsWith(":") && segment !== "*")
    .map((segment) =>
      segment
        .replace(/\([^)]*\)/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase()
    )
    .filter(Boolean);
  if (segments[0] === "api" && segments[1] === "v1") {
    segments.splice(0, 2);
  } else if (segments[0] === "api") {
    segments.splice(0, 1);
  }
  return segments.join(".") || "root";
}

function operationForRoute(method: string, routePath: string) {
  const exactOperation = EXACT_ROUTE_OPERATIONS.get(`${method} ${routePath}`);
  if (exactOperation) {
    return exactOperation;
  }
  if (method === "GET" || method === "HEAD") {
    return "read";
  }
  if (method === "DELETE") {
    return "delete";
  }
  if (method === "PATCH" || method === "PUT") {
    return "update";
  }
  if (method === "OPTIONS") {
    return "preflight";
  }
  const terminal = routePath.split("/").filter(Boolean).at(-1) ?? "";
  const explicitOperation = terminal
    .replace(/^:/, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  const explicitPostOperations = new Set([
    "approve",
    "archive",
    "batch",
    "begin",
    "cancel",
    "challenge",
    "chat",
    "complete",
    "deny",
    "dismiss",
    "discover",
    "discovery",
    "enrich",
    "exchange",
    "export",
    "heartbeat",
    "import",
    "invalidate",
    "preview",
    "recover",
    "refresh",
    "release",
    "rescan",
    "restore",
    "review",
    "revoke",
    "rotate",
    "run",
    "scan",
    "search",
    "split",
    "step_up",
    "sync",
    "token",
    "trust",
    "verify"
  ]);
  if (explicitOperation && explicitPostOperations.has(explicitOperation)) {
    return explicitOperation;
  }
  return "create";
}

function actionForRoute(
  method: string,
  routePath: string,
  securityClass: RouteSecurityClass
) {
  if (isCompanionBootstrapRoute({ method, routePath })) {
    return COMPANION_BOOTSTRAP_ACTION;
  }
  if (securityClass === "public_static_or_health") {
    return method === "OPTIONS"
      ? "system.cors.preflight"
      : routePath === "/api/health"
        ? "system.health.read"
        : "ui.static.read";
  }
  if (securityClass === "bounded_auth_protocol") {
    return "auth.protocol";
  }
  if (securityClass === "verified_protocol") {
    return `companion.${method === "GET" || method === "HEAD" ? "read" : "write"}`;
  }
  return `${actionNamespaceForRoute(routePath)}.${operationForRoute(method, routePath)}`;
}

function bodyLimitForClass(
  method: string,
  routePath: string,
  securityClass: RouteSecurityClass,
  explicitBodyLimit?: number
) {
  if (method === "GET" || method === "HEAD") {
    return 0;
  }
  if (explicitBodyLimit !== undefined) {
    if (!Number.isSafeInteger(explicitBodyLimit) || explicitBodyLimit <= 0) {
      throw new Error(
        `Forge route ${method} ${routePath} has an invalid explicit body limit.`
      );
    }
    return explicitBodyLimit;
  }
  const reviewedOverride = REVIEWED_BODY_LIMIT_OVERRIDES.get(
    `${method} ${routePath}`
  );
  if (reviewedOverride !== undefined) {
    return reviewedOverride;
  }
  if (securityClass === "bounded_auth_protocol") {
    return 16 * 1024;
  }
  return 1024 * 1024;
}

function classify(
  method: string,
  routePath: string
): {
  securityClass: RouteSecurityClass;
  protocolVerifier: RouteProtocolVerifier;
} {
  const key = `${method} ${routePath}`;
  if (method === "OPTIONS" || DATA_FREE_PUBLIC_ROUTES.has(key)) {
    return {
      securityClass: "public_static_or_health",
      protocolVerifier: "none"
    };
  }
  if (BOUNDED_AUTH_PROTOCOL_ROUTES.has(key)) {
    return {
      securityClass: "bounded_auth_protocol",
      protocolVerifier: routePath.startsWith("/api/v1/auth/local/")
        ? "local_owner_assertion"
        : routePath === "/api/v1/mobile/pairing/verify"
          ? "companion_pairing"
          : "forge_pairing"
    };
  }
  if (VERIFIED_COMPANION_PROTOCOL_ROUTES.has(key)) {
    return {
      securityClass: "verified_protocol",
      protocolVerifier: "companion_pairing"
    };
  }
  if (VERIFIED_PEER_PROTOCOL_ROUTES.has(key)) {
    return {
      securityClass: "verified_protocol",
      protocolVerifier: "peer_signature"
    };
  }
  return {
    securityClass: "protected",
    protocolVerifier: "none"
  };
}

export function resolveRouteSecurityContract(
  registration: RouteRegistration
): RouteSecurityContract {
  const method = normalizeMethod(registration.method);
  const routePath = normalizeRoutePath(registration.routePath);
  const { securityClass, protocolVerifier } = classify(method, routePath);
  return {
    version: FORGE_SECURITY_CONTRACT_VERSION,
    method,
    routePath,
    securityClass,
    action: actionForRoute(method, routePath, securityClass),
    resource: resourceForRoute(routePath),
    protocolVerifier,
    allowsAnonymousAdmission:
      securityClass === "public_static_or_health" ||
      securityClass === "bounded_auth_protocol",
    allowedApplicationPrincipalKinds: MIXED_PEER_PROTOCOL_ROUTES.has(
      `${method} ${routePath}`
    )
      ? ["operator_session"]
      : [],
    acceptedLegacyScopes:
      LEGACY_SCOPE_COMPATIBILITY.get(`${method} ${routePath}`) ?? [],
    maximumBodyBytes: bodyLimitForClass(
      method,
      routePath,
      securityClass,
      registration.explicitBodyLimit
    )
  };
}

export function reviewedBodyLimitOverrides() {
  return new Map(REVIEWED_BODY_LIMIT_OVERRIDES);
}

export function reviewedLegacyScopeCompatibility() {
  return new Map(LEGACY_SCOPE_COMPATIBILITY);
}

export function materializeRouteSecurityContracts(
  registrations: readonly RouteRegistration[]
) {
  const contracts = new Map<string, RouteSecurityContract>();
  for (const registration of registrations) {
    const contract = resolveRouteSecurityContract(registration);
    const key = `${contract.method} ${contract.routePath}`;
    const existing = contracts.get(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(contract)) {
      throw new Error(`Conflicting Forge security contracts for ${key}.`);
    }
    contracts.set(key, contract);
  }
  return contracts;
}
