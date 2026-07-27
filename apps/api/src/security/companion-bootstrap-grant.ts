import type { ForgePrincipal } from "./contracts.js";

export const COMPANION_BOOTSTRAP_ACTION = "companion.pair";
export const COMPANION_BOOTSTRAP_PROFILE = "trusted_personal_assistant";
export const COMPANION_BOOTSTRAP_ROUTE =
  "POST /api/v1/health/pairing-sessions";
export const COMPANION_BOOTSTRAP_SCOPES = [
  COMPANION_BOOTSTRAP_ACTION
] as const;
const COMPANION_BOOTSTRAP_EFFECTIVE_SCOPES = [
  COMPANION_BOOTSTRAP_ACTION,
  `profile:${COMPANION_BOOTSTRAP_PROFILE}`
] as const;
export const COMPANION_BOOTSTRAP_CAPABILITIES = [
  "healthkit.sleep",
  "healthkit.fitness",
  "background-sync",
  "location-ready",
  "watch-ready"
] as const;

export function isCompanionBootstrapRequest(input: {
  profile: ForgePrincipal["profile"];
  scopes: readonly string[];
  clientType: "api" | "browser";
}) {
  return (
    input.clientType === "api" &&
    input.profile === COMPANION_BOOTSTRAP_PROFILE &&
    input.scopes.length === COMPANION_BOOTSTRAP_SCOPES.length &&
    input.scopes.every(
      (scope, index) => scope === COMPANION_BOOTSTRAP_SCOPES[index]
    )
  );
}

export function isCompanionBootstrapGrant(input: {
  profile: ForgePrincipal["profile"];
  scopes: readonly string[];
  clientType?: "api" | "browser";
}) {
  return (
    input.clientType === "api" &&
    input.profile === COMPANION_BOOTSTRAP_PROFILE &&
    input.scopes.length === COMPANION_BOOTSTRAP_EFFECTIVE_SCOPES.length &&
    [...input.scopes]
      .sort()
      .every(
        (scope, index) =>
          scope === [...COMPANION_BOOTSTRAP_EFFECTIVE_SCOPES].sort()[index]
      )
  );
}

export function isCompanionBootstrapRoute(input: {
  method: string;
  routePath: string;
}) {
  return `${input.method.toUpperCase()} ${input.routePath}` ===
    COMPANION_BOOTSTRAP_ROUTE;
}
