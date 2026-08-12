import type { ForgePrincipal, RouteSecurityContract } from "./contracts.js";
import {
  isCompanionBootstrapGrant,
  isCompanionBootstrapRoute
} from "./companion-bootstrap-grant.js";

export type RouteAuthorizationRisk =
  | "ordinary"
  | "executor"
  | "operator_administration";

const OPERATOR_ADMINISTRATION_PREFIXES = [
  "/api/task-runs/watchdog",
  "/api/task-runs/recover",
  "/api/v1/approval-requests",
  "/api/v1/diagnostics/",
  "/api/v1/doctor",
  "/api/v1/git-helper/",
  "/api/v1/settings/data",
  "/api/v1/settings/tokens",
  "/api/v1/settings/bin",
  "/api/v1/settings/models/connections",
  "/api/v1/settings/models/oauth/",
  "/api/v1/wiki/settings",
  "/api/v1/users",
  "/api/v1/users/access-grants/",
  "/api/v1/auth/device/approve",
  "/api/v1/auth/device/review",
  "/api/v1/auth/device/step-up",
  "/api/v1/auth/device/deny",
  "/api/v1/auth/clients",
  "/api/v1/peers/invitations",
  "/api/v1/peers/pairings/",
  "/api/v1/peers/human-presence",
  "/api/v1/peers/companion-enrollments",
  "/api/v1/peers/grants/"
] as const;

const OPERATOR_ADMINISTRATION_EXACT_ROUTES = new Set([
  "PATCH /api/v1/settings"
]);

const EXECUTOR_ROUTES = new Set([
  "POST /api/v1/ai-processors/:id/run",
  "POST /api/v1/aiproc/:slug/run",
  "POST /api/v1/workbench/run",
  "POST /api/v1/workbench/flows/:id/run",
  "POST /api/v1/workbench/flows/:id/chat",
  "POST /api/v1/workbench/flows/:id/runs/:runId/cancel"
]);

const REVIEWED_VIEWER_SAFE_POST_ROUTES = new Set([
  "POST /api/v1/entities/search",
  "POST /api/v1/wiki/search"
]);

export const REVIEWED_ORDINARY_SENSITIVE_ROUTES = new Set([
  "POST /api/v1/entities/restore",
  "POST /api/v1/attention-inbox/:id/restore"
]);

const REVIEWED_SENSITIVE_ROUTE_TERMS =
  /(?:credential|secret|token|oauth|export|backup|restore|approval|invitation|grant|pairing|diagnostic|doctor|git-helper|watchdog)/i;

function methodRouteKey(contract: RouteSecurityContract) {
  return `${contract.method} ${contract.routePath}`;
}

export function routeAuthorizationRisk(
  contract: RouteSecurityContract
): RouteAuthorizationRisk {
  const key = methodRouteKey(contract);
  if (
    OPERATOR_ADMINISTRATION_EXACT_ROUTES.has(key) ||
    OPERATOR_ADMINISTRATION_PREFIXES.some((prefix) =>
      contract.routePath.startsWith(prefix)
    )
  ) {
    return "operator_administration";
  }
  if (EXECUTOR_ROUTES.has(key)) {
    return "executor";
  }
  if (REVIEWED_ORDINARY_SENSITIVE_ROUTES.has(key)) {
    return "ordinary";
  }
  if (REVIEWED_SENSITIVE_ROUTE_TERMS.test(contract.routePath)) {
    // Security-sensitive route vocabulary must never silently fall back to an
    // ordinary client profile. Any newly added route with these terms is
    // operator-only until it receives an explicit narrower classification.
    return "operator_administration";
  }
  return "ordinary";
}

export function profileAllowsRoute(
  principal: ForgePrincipal,
  contract: RouteSecurityContract
) {
  if (isCompanionBootstrapRoute(contract)) {
    return (
      principal.kind === "paired_client" && isCompanionBootstrapGrant(principal)
    );
  }
  const risk = routeAuthorizationRisk(contract);
  if (risk === "operator_administration") {
    return principal.profile === "operator";
  }
  if (risk === "executor") {
    return principal.profile === "executor" || principal.profile === "operator";
  }
  const hasExactLegacyMutationCapability =
    principal.kind === "legacy_agent_token" &&
    contract.acceptedLegacyScopes.some(
      (scope) => scope !== "read" && principal.scopes.includes(scope)
    );
  if (
    principal.profile === "viewer" &&
    !["GET", "HEAD", "OPTIONS"].includes(contract.method) &&
    !REVIEWED_VIEWER_SAFE_POST_ROUTES.has(methodRouteKey(contract)) &&
    !hasExactLegacyMutationCapability
  ) {
    return false;
  }
  return true;
}

export function requiredProfileForRoute(
  contract: RouteSecurityContract
): "viewer" | "executor" | "operator" {
  const risk = routeAuthorizationRisk(contract);
  if (risk === "operator_administration") {
    return "operator";
  }
  if (risk === "executor") {
    return "executor";
  }
  return "viewer";
}
