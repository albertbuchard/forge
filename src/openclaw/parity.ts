export type ApiRouteKey = `${Uppercase<string>} ${string}`;

export type ForgePluginRouteExclusion = {
  method: Uppercase<string>;
  path: string;
  reason:
    | "browser-session-telemetry"
    | "legacy-alias"
    | "operator-token-bootstrap"
    | "sse-forwarding";
};

export const FORGE_PLUGIN_ROUTE_EXCLUSIONS: ForgePluginRouteExclusion[] = [
  {
    method: "GET",
    path: "/api/v1/campaigns",
    reason: "legacy-alias"
  },
  {
    method: "POST",
    path: "/api/v1/settings/tokens",
    reason: "operator-token-bootstrap"
  },
  {
    method: "POST",
    path: "/api/v1/settings/tokens/:id/rotate",
    reason: "operator-token-bootstrap"
  },
  {
    method: "POST",
    path: "/api/v1/settings/tokens/:id/revoke",
    reason: "operator-token-bootstrap"
  },
  {
    method: "POST",
    path: "/api/v1/session-events",
    reason: "browser-session-telemetry"
  },
  {
    method: "GET",
    path: "/api/v1/events/stream",
    reason: "sse-forwarding"
  }
];

export function makeApiRouteKey(method: string, path: string): ApiRouteKey {
  const normalizedPath = path.replaceAll(/\{([^}]+)\}/g, ":$1");
  return `${method.toUpperCase()} ${normalizedPath}` as ApiRouteKey;
}

export function collectExcludedApiRouteKeys() {
  return new Set(FORGE_PLUGIN_ROUTE_EXCLUSIONS.map((route) => makeApiRouteKey(route.method, route.path)));
}
